#!/usr/bin/env node
/* atmo-shots.mjs — screenshots of every atmosphere preset from a few fixed cameras (modules/atmosphere.js).
 *   node tools/atmo-shots.mjs [label] [--presets a,b] [--shots sea,moon,rift,lake] [--size 1400x800]
 * Output: stand/<label>/<preset>__<shot>.png + fps per shot in shots.json. Fresh browser profile (never touches others). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'atmo-presets';
const presets = String(opt('presets', 'clear_aurora,calm_mist,overcast,blizzard,aurora_flare,rift_glow')).split(',');
const shots = String(opt('shots', 'sea,moon,rift')).split(',');
const [VW, VH] = String(opt('size', '1400x800')).split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOT = {
  // coast looking out over the sea ice to the mountain ring
  sea: `(() => { let d = 250; const a = 1.9; while (d < 440 && DBG.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d - 14), z = Math.sin(a) * (d - 14);
    return { p: [x, z], cam: { pos: [x, DBG.groundH(x, z) + 4, z], look: [Math.cos(a) * 1200, 20, Math.sin(a) * 1200] } }; })()`,
  // in the forest, facing the moon (light shafts through the trees)
  moon: `(() => { const L = DBG.FOREST.list; let best = L[0], bn = -1; for (let i = 0; i < L.length; i += 3) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 400) n++; if (n > bn) { bn = n; best = t; } }
    const M = DBG.MODCTX.MOON_DIR, h = Math.hypot(M.x, M.z), x = best[0] - M.x / h * 45, z = best[2] - M.z / h * 45, g = DBG.groundH(x, z);
    return { p: [x, z], cam: { pos: [x, g + 2.2, z], look: [x + M.x / h * 100, g + 2.2 + 26, z + M.z / h * 100] } }; })()`,
  rift: `(() => { const r = DBG.POI.rift, x = r.x + 20, z = r.z + 88; return { p: [x, z + 4], cam: { pos: [x, DBG.groundH(x, z) + 6, z], look: [r.x, 8, r.z] } }; })()`,
  lake: `(() => { const l = DBG.POI.lake, x = l.x + 70, z = l.z + 40; return { p: [x, z], cam: { pos: [x, DBG.groundH(x, z) + 5, z], look: [l.x, l.h, l.z] } }; })()`,
  player: `(() => { const P = DBG.POI.crash; return { p: [P.x - 3, P.z + 10], player: true }; })()`,
};

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); const p = path.join(ROOT, u === '/' ? '/open-world.html' : u);
  const ext = path.extname(p).toLowerCase();
  if (!p.startsWith(ROOT) || !MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const dir = path.join(ROOT, 'stand', label); fs.mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000, defaultViewport: { width: VW, height: VH, deviceScaleFactor: 1 },
  args: [...(argv.includes('--unlimited') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []), '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`] });
const out = { errors: [], shots: {} };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => out.errors.push(String(e && (e.stack || e.message)).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) out.errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/open-world.html#dbg`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 120000, polling: 250 });
  await page.evaluate(() => { DBG.setQuality && DBG.setQuality('high'); DBG.newGame(); });
  await sleep(1500);
  const close = () => page.evaluate(() => { let n = 0; while (DBG.Dialog.active && n++ < 20) DBG.Dialog.close(); DBG.G.pause = false; const p = document.getElementById('pause'); if (p) p.hidden = true; });
  await close();
  if (opt('eval')) console.log('[atmo] eval =>', JSON.stringify(await page.evaluate(opt('eval'))));
  const fps = () => page.evaluate(() => new Promise((res) => { const ts = []; const f = (t) => { ts.push(t); if (t - ts[0] < 1500) requestAnimationFrame(f); else { const d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]); d.sort((a, b) => a - b); res(+(1000 / d[d.length >> 1]).toFixed(1)); } }; requestAnimationFrame(f); }));
  if (opt('prof')) {   // --prof sea : fps with each atmosphere part switched off in turn (use with --unlimited)
    const code = SHOT[opt('prof')];
    await page.evaluate((code) => { const d = eval(code); DBG.camOv = d.cam || null; DBG.teleport(d.p[0], d.p[1], 0, DBG.groundH(d.p[0], d.p[1])); DBG.MODCTX.setAtmosphere('clear_aurora', 0.05); }, code);
    await sleep(2000);
    const T = {
      all: '0',
      noMountains: 'DBG.MODCTX.atmosphere.mountains.forEach(m => m.visible = false)',
      noIce: 'DBG.MODCTX.atmosphere.ice.forEach(m => m.visible = false)',
      noSnow: 'DBG.MODCTX.atmosphere.snowNear.visible = DBG.MODCTX.atmosphere.snowFar.visible = false',
      noShafts: 'DBG.MODCTX.atmosphere.shafts && (DBG.MODCTX.atmosphere.shafts.k = 0)',
      noSky: 'DBG.MODCTX.atmosphere.sky.visible = false',
      noBreath: 'DBG.scene.getObjectByName("atm_breath").visible = false',
    };
    const restore = 'DBG.MODCTX.atmosphere.mountains.forEach(m => m.visible = true); DBG.MODCTX.atmosphere.ice.forEach(m => m.visible = true); DBG.MODCTX.atmosphere.snowNear.visible = DBG.MODCTX.atmosphere.snowFar.visible = true; DBG.MODCTX.atmosphere.sky.visible = true; DBG.scene.getObjectByName("atm_breath").visible = true';
    const best = {};
    for (let round = 0; round < 4; round++) for (const k of Object.keys(T)) {
      await page.evaluate(restore); await page.evaluate(T[k]); await sleep(400);
      const a = await fps(); best[k] = Math.max(best[k] || 0, a);
      if (round === 0 && argv.includes('--snap')) await page.screenshot({ path: path.join(dir, 'prof_' + k + '.png') });
    }
    for (const k of Object.keys(T)) console.log('[prof]', k.padEnd(12), best[k], 'fps (best of 4)');
  }
  const QS = opt('qualities') ? String(opt('qualities')).split(',') : [null];
  for (const qq of QS) { if (qq) await page.evaluate((q) => { window.__Q = q; }, qq);
  for (const pr of (opt('prof') ? [] : presets)) {
    for (const s of shots) {
      await page.evaluate((code, pr) => {
        const d = eval(code); DBG.camOv = d.cam || null;
        DBG.teleport(d.p[0], d.p[1], 0, DBG.groundH(d.p[0], d.p[1]));
        if (window.__Q) DBG.setQuality(window.__Q); DBG.MODCTX.setAtmosphere(pr, 0.05); DBG.WX.storm = pr === 'blizzard' ? 1 : 0;
      }, SHOT[s], pr);
      await sleep(1800); await close();
      const f = await fps();
      const file = path.join(dir, `${qq ? qq + '_' : ''}${pr}__${s}.png`); await page.screenshot({ path: file });
      const st = await page.evaluate(() => { const A = DBG.MODCTX.atmosphere; return { name: A.name, w: A.weights, snow: A.snowNear && A.snowNear.geometry.instanceCount, far: A.snowFar && A.snowFar.geometry.drawRange.count, shaftK: A.shafts && +A.shafts.k.toFixed(3), cam: DBG.camera.position.toArray().map(v => +v.toFixed(1)), pl: [DBG.player.x, DBG.player.y, DBG.player.z].map(v => +(+v).toFixed(1)), mode: DBG.G.mode, ui: DBG.G.ui, q: DBG.Q.name }; });
      out.shots[`${pr}__${s}`] = { fps: f, state: st };
      console.log('[atmo]', pr.padEnd(13), s.padEnd(6), f, 'fps', JSON.stringify(st));
    }
  }
  }
  await page.evaluate(() => DBG.MODCTX.setAtmosphere('auto'));
} catch (e) { console.error('[atmo] failed', e); out.errors.push(String(e)); }
fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(out, null, 2));
if (out.errors.length) console.log('[atmo] errors', out.errors.slice(0, 10));
await browser.close(); srv.close();
