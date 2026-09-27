// Снимки игры для глаз → docs/screenshots/game-*.png: заставка, анкета, чат, зал в 19:10 и в пик, разговор,
// телефон, события (дождь, саксофон, караоке), общее фото и итог (с фото; на телефоне — вечер без фото); телефонная раскладка. node shots.js  (ONLY=talk — выборочно)
import { devices } from 'playwright';
import { serve } from './serve.js';
import { launch, watch, enterHall, skipTo, simFor, presentList, clickPerson } from './game.js';
import fs from 'node:fs';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve();
const b = await launch();
const errs = [];
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const shot = async (pg, n) => { if (only.length && !only.some(o => n.includes(o))) return; await pg.screenshot({ path: `${OUT}game-${n}.png` }); console.log('shot', n); };
// убрать всплывашки и отдать камеру игре
const calm = pg => pg.evaluate(() => { document.querySelector('.toasts').innerHTML = ''; SKHODKA.sc.ctl.userT = 99; });
const ev = (pg, id, on = true) => pg.evaluate(([id, on]) => { const w = SKHODKA.w, e = w.idx.EVENTS[id]; if (on) w.dir.start(e); else { const x = w.events.find(x => x.id === id); if (x) w.dir.stop(x); } }, [id, on]);
// разговор с ближайшим, кто сидит или стоит в зале
async function talkNearest(pg) {
  const ppl = (await presentList(pg)).filter(p => p.state !== 'walk').sort((a, b) => a.d - b.d);
  for (const p of ppl) if (await clickPerson(pg, p.id)) break;
  for (let i = 0; i < 40 && !(await pg.evaluate(() => !!SKHODKA.w.talk.cur)); i++) { await simFor(pg, 0.5); await pg.waitForTimeout(30); }
  for (let k = 0; k < 3; k++) { const c = await pg.$('.talk .t-cards .card'); if (c) await c.click(); await simFor(pg, 1.6); }
}

// ─── ноутбук ───
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
watch(pg, errs);
await pg.goto(url + '?seed=21');
await pg.waitForSelector('.scr.title [data-go]'); await pg.waitForTimeout(900);
await shot(pg, '01-title');
await pg.click('.scr.title [data-go]');
await pg.fill('#pf-name', 'Егор'); await pg.click('[data-k="glasses"][data-v="true"]'); await pg.click('[data-k="beard"][data-v="\\"full\\""]').catch(() => {});
await shot(pg, '02-profile');
await pg.click('[data-next]'); await pg.click('[data-role="backend"]'); await pg.click('[data-next]');
for (const t of ['ai', 'sea', 'georgian']) await pg.click(`[data-topic="${t}"]`);
await pg.click('[data-next]'); await pg.click('[data-need="flat"]'); await pg.click('[data-offer="job"]'); await pg.click('[data-next]');
await pg.waitForSelector('.scr.prechat [data-go]'); await pg.click('.poll-o[data-v="yes"]'); await pg.waitForTimeout(200);
await shot(pg, '03-prechat');
await pg.click('.scr.prechat [data-go]');
await pg.waitForFunction(() => SKHODKA.w && !SKHODKA.ui.screenOn);
await skipTo(pg, 19.17); await calm(pg); await pg.waitForTimeout(1500); await calm(pg);
await shot(pg, '04-hall-1910');
await skipTo(pg, 21.5); await pg.evaluate(() => SKHODKA.sc.ctl.home()); await calm(pg); await pg.waitForTimeout(1800); await calm(pg);
await shot(pg, '05-hall-peak-2130');
await talkNearest(pg); await pg.evaluate(() => { document.querySelector('.toasts').innerHTML = ''; }); await pg.waitForTimeout(900);
await shot(pg, '06-talk');
await pg.click('.talk [data-bye2]').catch(() => {});
// телефон в зале
await pg.click('.hud [data-phone]'); await pg.waitForTimeout(400); await shot(pg, '07-phone'); await pg.click('.phone [data-close]');
// события: саксофон на сцене у стойки, ливень за витриной
const stageCam = pg => pg.evaluate(() => { const g = SKHODKA.sc.ctl.goal, st = L.use('content/layout').LAYOUT.stage; Object.assign(g, { x: st.x - 1.2, z: st.z + 0.4, yaw: 1.15, pitch: 0.7, dist: 7.5 }); SKHODKA.sc.ctl.userT = -30; });
await ev(pg, 'sax'); await skipTo(pg, 21.62); await stageCam(pg); await calm(pg); await stageCam(pg); await pg.waitForTimeout(1500);
await pg.evaluate(() => { document.querySelector('.toasts').innerHTML = ''; }); await pg.evaluate(() => SKHODKA.w.bus.emit('toast', { icon: 'sax', text: 'Заиграл саксофон', tone: 'ev' }));
await pg.waitForTimeout(300); await shot(pg, '08-event-sax');
await ev(pg, 'sax', false); await ev(pg, 'rain');
await pg.evaluate(() => { const g = SKHODKA.sc.ctl.goal; Object.assign(g, { x: 4.6, z: 1.5, yaw: 0.05, pitch: 0.62, dist: 11 }); SKHODKA.sc.ctl.userT = -30; });
await calm(pg); await pg.evaluate(() => { SKHODKA.sc.ctl.userT = -30; }); await pg.waitForTimeout(1600);
await shot(pg, '09-event-rain');
await ev(pg, 'rain', false);
// караоке на сцене у стойки: певица с микрофоном, розово-синий свет, часть зала поёт
await skipTo(pg, 22.98); await ev(pg, 'karaoke'); await skipTo(pg, 23.12);
await stageCam(pg); await calm(pg); await stageCam(pg); await pg.waitForTimeout(1600);
await shot(pg, '16-event-karaoke');
// общее фото и итог
await pg.evaluate(() => SKHODKA.sc.ctl.home());
await skipTo(pg, 24.2);
for (let i = 0; i < 80 && !(await pg.evaluate(() => SKHODKA.w.score.photo)); i++) {
  await pg.evaluate(() => { const w = SKHODKA.w; if (w.talk.cur) w.act({ type: 'endTalk' }); if (w.player.goal?.kind !== 'photo') w.act({ type: 'photo' }); });
  await simFor(pg, 1); await pg.waitForTimeout(30);
}
await simFor(pg, 12); await pg.waitForTimeout(400); await calm(pg); await pg.waitForTimeout(300);
await shot(pg, '10-photo-gather');
await skipTo(pg, 26, { batch: 1800 });
await pg.waitForSelector('.scr.end'); await pg.waitForTimeout(500);
await shot(pg, '11-end');
await pg.close();

// ─── телефон ───
const mp = await b.newPage({ ...devices['iPhone 13'] });
watch(mp, errs, 'm ');
await mp.goto(url + '?seed=21');
await enterHall(mp);
await skipTo(mp, 21.3); await calm(mp); await mp.waitForTimeout(1500); await calm(mp);
await shot(mp, '12-mobile-hall');
await talkNearest(mp); await mp.evaluate(() => { document.querySelector('.toasts').innerHTML = ''; }); await mp.waitForTimeout(900);
await shot(mp, '13-mobile-talk');
await mp.tap('.talk [data-bye2]').catch(() => {});
await mp.tap('.hud [data-phone]'); await mp.waitForTimeout(400); await shot(mp, '14-mobile-phone'); await mp.tap('.phone [data-close]');
// вечер без общего фото → итог «фото не было», снимок конца вечера
await mp.evaluate(() => { const w = SKHODKA.w; w.dir.plan = w.dir.plan.filter(p => !p.ev.effect.photo); w.dir.fired.push('photo'); });
await skipTo(mp, 26, { batch: 1800 }); await mp.waitForSelector('.scr.end'); await mp.waitForTimeout(500);
await shot(mp, '15-mobile-end');

console.log(errs.length ? 'ОШИБКИ:\n' + errs.join('\n') : 'консоль чистая');
await b.close(); srv.close();
process.exit(errs.length ? 1 : 0);
