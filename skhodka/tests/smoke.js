// Дымовой тест всей игры: страница без ошибок, заставка → анкета → чат → зал, часы идут, пауза, клик по человеку →
// разговор, карта → ответ, заказ, ходьба по клику, перемотка вечера до конца → итог с общим фото, «Ещё суббота»;
// то же открытие из file:// (двойной щелчок по index.html). node smoke.js
import { serve } from './serve.js';
import { launch, watch, enterHall, skipTo, simFor, presentList, clickPerson } from './game.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { srv, url } = await serve();
const b = await launch();
let fails = 0;
const ok = (cond, msg, extra = '') => { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + msg + (extra !== '' ? '  ' + extra : '')); if (!cond) fails++; };

// ─── сервер ───
console.log('http://');
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; watch(pg, errs);
await pg.goto(url + '?seed=11');
await pg.waitForSelector('.scr.title [data-go]');
await pg.waitForTimeout(500);
ok(errs.length === 0, 'заставка без ошибок', errs.join(' | '));
ok(await pg.evaluate(() => !!(SKHODKA.sc && SKHODKA.pp && SKHODKA.ui && SKHODKA.loop)), 'сцена, люди, интерфейс, цикл собраны');

const t0 = Date.now();
await enterHall(pg);
const s0 = await pg.evaluate(() => { const G = SKHODKA, w = G.w; return { seed: w.seed, hour: w.hour, hud: !G.ui.hud.el.hidden, look: !!(w.player.look && w.player.look.top), glasses: !!w.player.look.glasses, name: w.player.name, role: w.player.role }; });
ok(s0.hud && s0.seed === 11, 'анкета → чат → зал, HUD виден, сид из адреса', `${Date.now() - t0} мс, seed ${s0.seed}`);
ok(s0.look && s0.glasses && s0.name === 'Егор' && s0.role === 'backend', 'игрок — из анкеты (имя, роль, очки в 3D-облике)');
await pg.waitForTimeout(1500);
const h1 = await pg.evaluate(() => SKHODKA.w.hour);
ok(h1 > s0.hour, 'часы идут сами', `+${((h1 - s0.hour) * 3600).toFixed(0)} игровых с за 1,5 с`);

// пауза: Esc — стоп, Esc — дальше
await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
const hp = await pg.evaluate(() => SKHODKA.w.hour); await pg.waitForTimeout(600);
const hp2 = await pg.evaluate(() => ({ h: SKHODKA.w.hour, menu: !SKHODKA.ui.M.hidden, paused: SKHODKA.paused }));
ok(hp2.h === hp && hp2.menu && hp2.paused, 'Esc — пауза: часы стоят, меню открыто');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
ok(await pg.evaluate(h => SKHODKA.w.hour > h && !SKHODKA.paused, hp), 'Esc — снова идёт');

// в зале к 20:15 — люди; клик по ближайшему видимому → подход → разговор
await skipTo(pg, 20.25);
await pg.evaluate(() => { const w = SKHODKA.w; window.__lines = []; w.bus.on('talk:line', d => window.__lines.push(d)); });
const ppl = (await presentList(pg)).sort((a, b) => a.d - b.d);
ok(ppl.length >= 8, 'к 20:15 в зале люди', ppl.length + ' чел.');
let target = null;
for (const p of ppl) if (await clickPerson(pg, p.id)) { target = p; break; }
ok(!!target, 'клик мышью по человеку в 3D дошёл до зала', target ? target.name : '');
// под курсором мог оказаться сосед — разговор ведём с тем, кого выбрал клик
const tid = await pg.evaluate(() => { const w = SKHODKA.w; return w.player.goal?.kind === 'approach' ? w.player.goal.id : w.talk.cur?.id ?? null; });
ok(tid != null, 'клик = подойти к нему', tid === target?.id ? '' : 'сосед');
for (let i = 0; i < 40 && !(await pg.$('.talk:not([hidden]) .t-cards .card')); i++) { await simFor(pg, 0.5); await pg.waitForTimeout(40); }
const talk = await pg.evaluate(() => ({ id: SKHODKA.w.talk.cur?.id, cards: document.querySelectorAll('.talk .t-cards .card').length, focus: !!SKHODKA.sc.ctl.saved }));
ok(talk.id === tid && talk.cards >= 3, 'разговор начался: панель и карты', `${talk.cards} карты`);
ok(talk.focus, 'камера наехала на разговор');
const n0 = await pg.evaluate(() => window.__lines.filter(l => l.who !== 'me').length);
await pg.click('.talk .t-cards .card');
await simFor(pg, 2.5); await pg.waitForTimeout(150);
const n1 = await pg.evaluate(() => window.__lines.filter(l => l.who !== 'me').length);
const said = await pg.$eval('.talk .say:not(.me) span', e => e.textContent).catch(() => '');
ok(n1 > n0 && said.length > 3, 'карта → ответ собеседника', `«${said.slice(0, 50)}»`);
await pg.click('.talk [data-bye2]'); await pg.waitForTimeout(100);
ok(await pg.evaluate(() => !SKHODKA.w.talk.cur && document.querySelector('.talk').hidden), '«Уйти» закрывает разговор');

// заказ: кнопка → меню → пиво → принесли (силы растут)
const e0 = await pg.evaluate(() => { SKHODKA.w.player.energy = 0.4; return 0.4; });
await pg.click('.acts [data-order]'); await pg.click('.a-menu [data-it="beer"]');
await simFor(pg, 8);
const e1 = await pg.evaluate(() => ({ e: SKHODKA.w.player.energy, prop: SKHODKA.w.player.prop }));
ok(e1.e > e0 && e1.prop === 'beer', 'заказ пива: принесли, силы выросли', `${e0} → ${e1.e.toFixed(2)}`);

// клик по полу → идёт
const fl = await pg.evaluate(() => { const G = SKHODKA, P = G.w.player; G.sc.ctl.userT = 99;
  let best = null;
  for (let y = 120; y < innerHeight - 120; y += 40) for (let x = 120; x < innerWidth - 120; x += 40) {
    const h = G.sc.pick(x, y), el = document.elementFromPoint(x, y);
    if (!h || h.kind !== 'floor' || !el || el.id !== 'view' || h.z < 1) continue;
    const d = Math.hypot(h.x - P.x, h.z - P.z);
    if (d > 1.5 && (!best || d < best.d)) best = { x, y, d };
  }
  return best; });
if (fl) { await pg.mouse.click(fl.x, fl.y); await pg.waitForTimeout(80); }
ok(!!fl && await pg.evaluate(() => SKHODKA.w.player.goal?.kind === 'walk' || !!SKHODKA.w.player.nav), 'клик по полу — игрок идёт, метка на полу', fl ? '' : 'нет свободной точки пола');

// весь вечер — пачками шагов симуляции → итог
const tEnd = Date.now();
await skipTo(pg, 26, { batch: 1800 });
await pg.waitForSelector('.scr.end', { timeout: 30000 });
const end = await pg.evaluate(() => ({ img: document.querySelector('.snap img')?.src || '', rank: document.querySelector('.rank b')?.textContent, tiles: [...document.querySelectorAll('.bt b')].map(b => b.textContent), over: SKHODKA.w.over, photo: SKHODKA.w.score.photo }));
ok(end.over && !!end.rank && end.rank !== '[object Object]', 'вечер закончился → итог со званием', `«${end.rank}» · ${end.tiles.join(' · ')} · ${((Date.now() - tEnd) / 1000).toFixed(1)} с`);
ok(end.img.startsWith('data:image/') && end.img.length > 20000, 'на итоге — снимок общего фото', `${(end.img.length / 1024).toFixed(0)} КБ`);

// «Ещё суббота» → чат → новый вечер
await pg.click('[data-again]');
await pg.waitForSelector('.scr.prechat [data-go]'); await pg.click('.scr.prechat [data-go]');
await pg.waitForFunction(() => SKHODKA.w && !SKHODKA.w.over && !SKHODKA.ui.screenOn);
const again = await pg.evaluate(() => ({ seed: SKHODKA.w.seed, h: SKHODKA.w.hour, people: SKHODKA.pp.map.size, name: SKHODKA.w.player.name }));
ok(again.seed !== 11 && again.h < 19.1 && again.name === 'Егор', '«Ещё суббота» — новый вечер с той же анкетой', `seed ${again.seed}, в 3D ${again.people}`);
await pg.waitForTimeout(500);
ok(errs.length === 0, 'без ошибок в консоли', errs.slice(0, 5).join(' | '));
await pg.close();

// ─── file:// — двойной щелчок по index.html ───
console.log('file://');
const fp = await b.newPage({ viewport: { width: 1280, height: 800 } });
const ferrs = []; watch(fp, ferrs);
await fp.goto('file://' + path.join(ROOT, 'index.html'));
await enterHall(fp);
await skipTo(fp, 19.6);
await fp.waitForTimeout(600);
const f = await fp.evaluate(() => ({ n: SKHODKA.pp.map.size, h: SKHODKA.w.hour, calls: SKHODKA.sc.renderer.info.render.calls }));
ok(f.n >= 3 && f.calls > 10, 'из file:// — зал, люди, отрисовка', `${f.n} в 3D, ${f.calls} вызовов`);
ok(ferrs.length === 0, 'из file:// без ошибок', ferrs.slice(0, 5).join(' | '));

await b.close(); srv.close();
console.log(fails ? `\n${fails} FAIL` : '\nвсё зелёное');
process.exit(fails ? 1 : 0);
