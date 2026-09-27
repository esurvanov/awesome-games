// Снимки для глаз: 3D от первого лица (день у Чми, ночная лента, КПП, салон, разговор с продавцом, телефон, мобильный)
// и карта сверху. node shots.js   (GPU: ANGLE=metal по умолчанию, ANGLE=swiftshader — программный)
import { chromium, devices } from 'playwright';
import { serve } from './serve.js';
import { at } from './scenes.js';
import fs from 'node:fs';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=' + (process.env.ANGLE || 'metal'), '--enable-unsafe-swiftshader'] });
const errs = [];
async function open(opt) {
  const pg = await b.newPage(opt);
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.type() + ' ' + m.text()); });
  await pg.goto(url); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  await pg.waitForTimeout(300);
  return pg;
}
const start = async pg => {
  await pg.click('#st-new');
  await pg.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 60000 });
  await pg.evaluate(() => LARS.setSpeed(0));
};
const clean = pg => pg.evaluate(() => { const G = window.LARS; if (G.fp) G.fp.hintOff = true; G.pending.length = 0; G.Modal.closeAll(); G.menu.hide(); G.w.player.sleeping = false; document.getElementById('toasts').innerHTML = ''; });
const pg = await open({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const shot = async (p, n, wait = 900) => { await clean(p); await p.waitForTimeout(wait); await clean(p); await p.waitForTimeout(120); await p.screenshot({ path: OUT + n + '.png' }); console.log('shot', n); };
await pg.screenshot({ path: OUT + '01-start.png' });
await start(pg);
await pg.evaluate(at('2022-09-25 21:10', 0, 0, 0, -0.05, true)); await shot(pg, '02-3d-car-night');
await pg.evaluate(at('2022-09-25 23:40', 5200, -7.6, 0.02, 0.02)); await shot(pg, '03-3d-night-ribbon');
await pg.evaluate(at('2022-09-26 11:00', 9900, -5.6, 0.1, 0.03)); await shot(pg, '04-3d-day-chmi');
await pg.evaluate(at('2022-09-26 13:10', 0, 0, 0, -0.08, true)); await shot(pg, '05-3d-inside-car');
await pg.evaluate(at('2022-09-26 15:30', 70, 7.5, -0.12, 0.12)); await shot(pg, '06-3d-checkpoint-day');
// разговор с продавцом: смотрим на Заура, E → меню
await pg.evaluate(at('2022-09-26 17:30', 9720, -5, 0, 0));
await pg.evaluate(() => { const G = LARS, w = G.w, s = w.econ.sellers.find(o => o.npc === 'zaur'); const q = w.road.at(s.s + 1.5, s.side * 6.2); w.player.x = q.x; w.player.y = q.y; G.fp.yaw = Math.atan2(s.x - q.x, -(s.y - q.y)); G.fp.pitch = 0.02; G.fp.eyeY = null; });
await clean(pg); await pg.waitForTimeout(700); await clean(pg);
await pg.evaluate(() => { const G = LARS, s = G.w.econ.sellers.find(o => o.npc === 'zaur'); G.openMenu({ kind: 'seller', seller: s, npc: s.npc }); }); await pg.waitForTimeout(250);
await pg.evaluate(() => { const b = [...document.querySelectorAll('#menu .acts .btn')].find(b => /Поговорить/.test(b.textContent)); b && b.click(); }); await pg.waitForTimeout(250);
await pg.evaluate(() => { LARS.setSpeed(0); LARS.pending.length = 0; LARS.Modal.closeAll(); document.getElementById('toasts').innerHTML = ''; }); await pg.waitForTimeout(60);
await pg.screenshot({ path: OUT + '08-3d-seller-talk.png' }); console.log('shot 08-3d-seller-talk');
await clean(pg);
await pg.evaluate(at('2022-09-26 21:40', 120, 5.5, -0.1, 0.1)); await shot(pg, '07-3d-checkpoint-night');
await pg.evaluate(at('2022-09-27 07:40', 17300, -6, -0.35, 0.1)); await shot(pg, '09-3d-morning-balta');
await pg.evaluate(at('2022-09-29 16:00', 3300, -6, 0.2, 0.06)); await shot(pg, '10-3d-drizzle-nlars');
await pg.evaluate(() => { LARS.w.player.needs.charge = 64; LARS.openPhone(); }); await pg.waitForTimeout(300); await pg.screenshot({ path: OUT + '11-3d-phone.png' }); console.log('shot 11-3d-phone');
await clean(pg);
// карта сверху (M)
await pg.evaluate(() => { const G = LARS; G.setMode('map'); G.input.follow = false; const p = G.w.player; G.view.cam.x = p.x; G.view.cam.y = p.y; G.view.cam.z = 4; }); await shot(pg, '12-map-near', 400);
await pg.evaluate(() => { LARS.view.cam.z = 0.05; }); await shot(pg, '13-map-far', 300);
await pg.close();
// телефон: мобильная раскладка
const mp = await open({ ...devices['iPhone 13'] });
await mp.tap('#st-new');
await mp.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 60000 });
await mp.evaluate(() => LARS.setSpeed(0));
await mp.evaluate(at('2022-09-26 12:00', 9900, -5.6, 0.1, 0.03)); await clean(mp); await mp.waitForTimeout(900); await clean(mp);
await mp.screenshot({ path: OUT + '14-mobile-3d.png' }); console.log('shot 14-mobile-3d');
await mp.evaluate(at('2022-09-26 22:30', 6800, -7.6, 0, 0.02)); await clean(mp); await mp.waitForTimeout(900); await clean(mp);
await mp.screenshot({ path: OUT + '15-mobile-night.png' }); console.log('shot 15-mobile-night');
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close(); srv.close();
