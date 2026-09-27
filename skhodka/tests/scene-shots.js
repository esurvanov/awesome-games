// Скриншоты зала с ракурсов, как на фото из _ref, + замер FPS (низкое качество, CPU ×4).
// node scene-shots.js   (ONLY=bar,long — выборочно; PEOPLE=1 — с людьми на местах; CPU=4 — замедление для замера)
import { chromium } from 'playwright';
import { serve } from './serve.js';
import fs from 'node:fs';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
pg.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/deprecated|build\/three/i.test(m.text())) errs.push(m.type() + ' ' + m.text()); });
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = n => !only.length || only.includes(n);
const ppl = process.env.PEOPLE ? '&people=1' : '';
const open = async (q, wait = 900) => { await pg.goto(url + 'dev/scene.html?clean=1&q=high' + ppl + '&' + q); await pg.waitForFunction(() => window.frames > 5, null, { timeout: 60000 }); await pg.waitForTimeout(wait); };
const shot = async n => { await pg.screenshot({ path: OUT + 'scene-' + n + '.png' }); console.log('shot', n); };

// ракурсы (см. VIEWS в dev/scene.html) ↔ фото: bar — 01-57-02, entry — 01-57-29/01-58-13, long — 01-56-25,
// back — 01-56-36, column — 01-59-08, booth — 01-57-17, facade — 01-57-51, game — общий вид игры;
// bartop/stage/wc/aisles — ракурсы пометок автора _ref/notes/15.31.09 · 15.31.38 · 15.31.51 · 15.32.01
const SHOTS = [
  ['game', 'view=game&hour=20'], ['bar', 'view=bar&hour=20.5'], ['dusk', 'view=entry&hour=19.4'], ['entry', 'view=entry&hour=21'], ['long', 'view=long&hour=21'],
  ['back', 'view=back&hour=19.3'], ['column', 'view=column&hour=21.5&fx=birthday'], ['booth', 'view=booth&hour=22'],
  ['facade', 'view=facade&hour=21.5'], ['facade-dusk', 'view=facade&hour=19.2'], ['top', 'view=top&hour=21'],
  // ракурсы пометок автора (_ref/notes/15.31.09 … 15.32.01): стойка сверху, сцена, угол с туалетом, проходы
  ['bartop', 'view=bartop&hour=21'], ['stage', 'view=stage&hour=22&fx=sax'], ['wc', 'view=wc&hour=21'], ['aisles', 'view=aisles&hour=21'],
  ['night-fx', 'view=game&hour=24&fx=garland,football,sax'], ['rain', 'view=facade&hour=22&fx=rain,garland'], ['strobe', 'view=game&hour=23.5&fx=strobe,smell'],
];
for (const [n, q] of SHOTS) if (want(n)) { await open(q); await shot(n); }

// выбор мышью: место, пол
if (want('pick')) {
  await open('view=game&hour=20');
  const r = await pg.evaluate(() => {
    const out = {}, L_ = L.use('content/layout').LAYOUT, s = L_.seatById['long3.0'];
    const p = SC.toScreen(s.x, 0.5, s.z); out.seat = SC.pick(p.x, p.y);
    const f = SC.toScreen(4.9, 0, 12.9); out.floor = SC.pick(f.x, f.y);
    const sky = SC.toScreen(4, 30, 60); out.sky = SC.pick(sky.x, Math.max(1, sky.y));
    return out;
  });
  console.log('pick', JSON.stringify(r));
}

if (want('perf')) {
  const gpu = await pg.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
  console.log('GPU', gpu);
  for (const [q, cpu] of [['low', 1], ['low', +(process.env.CPU || 4)], ['mid', 1], ['high', 1]]) {
    await pg.goto(url + `dev/scene.html?clean=1&q=${q}&view=game&hour=22&fx=garland`);
    await pg.waitForFunction(() => window.frames > 5, null, { timeout: 60000 });
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await pg.waitForTimeout(1000);
    const f0 = await pg.evaluate(() => window.frames); const t0 = Date.now();
    await pg.waitForTimeout(5000);
    const f1 = await pg.evaluate(() => window.frames); const info = await pg.evaluate(() => ({ calls: SC.renderer.info.render.calls, tris: SC.renderer.info.render.triangles, build: Math.round(SC.buildMs), ms: SC.ms.toFixed(2) }));
    console.log(`FPS q=${q} cpu×${cpu}: ${((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1)}  CPU на кадр ${info.ms} мс, draw calls ${info.calls}, tris ${info.tris}, build ${info.build} ms`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'console clean');
await b.close(); srv.close();
