// Быстрый взгляд на 3D (для разработки): node look.js имя '2022-09-26 11:00|s м|смещение м|поворот|наклон|1=в машине'
// снимок — в OUT (по умолчанию временная папка); WEBGL1=1 — проверить запасной WebGL1, ANGLE=swiftshader — программный GPU
import { chromium } from 'playwright';
import os from 'node:os';
import { serve } from './serve.js';
import { at } from './scenes.js';
const OUT = process.env.OUT || os.tmpdir() + '/';
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=' + (process.env.ANGLE || 'metal'), '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
const errs = [];
if (process.env.WEBGL1) await pg.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, o) { return t === 'webgl2' ? null : g.call(this, t, o); }; });
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 3000)); });
await pg.goto(url); await pg.evaluate(() => localStorage.clear()); await pg.reload();
await pg.click('#st-new');
await pg.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 60000 });
await pg.evaluate(() => { LARS.setSpeed(0); LARS.pending.length = 0; LARS.Modal.closeAll(); document.getElementById('toasts').innerHTML = ''; });
let scene = process.argv[3] || '';
if (scene.includes('|')) { const [t, s0, off, yaw, pitch, car] = scene.split('|'); scene = at(t, +s0, +off, +yaw, +(pitch || -0.02), car === '1'); }
if (process.env.EXTRA) scene += ';' + process.env.EXTRA;
if (scene) await pg.evaluate(scene);
await pg.waitForTimeout(+(process.env.WAIT || 1500));
await pg.evaluate(() => { LARS.pending.length = 0; LARS.Modal.closeAll(); document.getElementById('toasts').innerHTML = ''; });
await pg.waitForTimeout(300);
await pg.screenshot({ path: OUT + (process.argv[2] || 'look') + '.png' });
const info = await pg.evaluate(() => { const v = LARS.view3; return v ? { ok: v.ok, build: Math.round(v.buildMs), scene: Math.round(v.sc.ms), stats: v.stats, cam: v.cam, rs: v.rs, fps: Math.round(LARS.loop.fps), ms: LARS.loop.ms.toFixed(1), mode: LARS.mode } : null; });
console.log(JSON.stringify(info));
console.log(errs.join('\n') || 'no errors');
await b.close(); srv.close();
