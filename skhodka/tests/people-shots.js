// Скриншоты людей для глаз + замер FPS. node people-shots.js  (ONLY=close,poses — выборочно; CPU=4 — замедление)
import { chromium } from 'playwright';
import { serve } from './serve.js';
import fs from 'node:fs';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', ...(process.env.NOVSYNC ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
pg.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/deprecated|build\/three/i.test(m.text())) errs.push(m.type() + ' ' + m.text()); });
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = n => !only.length || only.includes(n);
const open = async (q, wait = 1500) => { await pg.goto(url + 'dev/people.html?' + q); await pg.waitForFunction(() => window.STATS && STATS.frames > 5); await pg.waitForTimeout(wait); };
const shot = async n => { await pg.screenshot({ path: OUT + 'people-' + n + '.png' }); console.log('shot', n); };
const camJS = (a) => pg.evaluate(a => DEV.cam(...a), a);

if (want('crowd')) { await open('mode=crowd'); await shot('crowd'); await camJS([0, 4.5, 4.5, 0, 0.6, -1.5]); await pg.waitForTimeout(300); await shot('crowd-mid'); await camJS([0, 16, 10, 0, 0, -0.5]); await pg.waitForTimeout(300); await shot('crowd-far'); }
if (want('close')) { await open('mode=close', 2600); await shot('close'); }
if (want('lineup')) { await open('mode=lineup'); await shot('lineup'); }
if (want('poses')) { await open('mode=poses'); await shot('poses'); await camJS([3.5, 1.6, 2.8, -0.4, 0.7, -0.2]); await pg.waitForTimeout(300); await shot('poses-side'); }
if (want('sit')) { await open('mode=sit'); await shot('sit'); }
if (want('odd')) { await open('mode=odd'); await shot('odd'); }
if (want('perf')) {
  const gpu = await pg.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
  console.log('GPU', gpu);
  for (const cpu of [1, +(process.env.CPU || 4)]) {
    await open('mode=perf&n=40', 500);
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await pg.evaluate(() => { STATS.f0 = STATS.frames; STATS.t0 = performance.now(); STATS.up0 = 0; });
    await pg.waitForTimeout(5000);
    const r = await pg.evaluate(() => ({ fps: (STATS.frames - STATS.f0) / ((performance.now() - STATS.t0) / 1000), upMs: STATS.upMs, calls: STATS.calls, tris: STATS.tris }));
    console.log(`perf CPU×${cpu}: ${r.fps.toFixed(1)} fps, люди.update ${r.upMs.toFixed(2)} мс, ${r.calls} вызовов, ${r.tris} треугольников`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    if (cpu === 1) await shot('perf40');
  }
}
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close(); srv.close();
