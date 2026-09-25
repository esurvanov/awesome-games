#!/usr/bin/env node
/* terrain-shots.mjs — close-up checks for modules/terrain.js (snow trails, drifts, ice, API, paired cost)
 *
 *   node tools/terrain-shots.mjs <label> [--page open-world.html] [--unlimited] [--cost]
 *
 * Writes stand/<label>/tr_*.png and stand/<label>/terrain.json:
 *   walk trail (pilot walks a loop, camera looks down at the prints) · skimmer tracks · lee drift at a boulder ·
 *   sea ice · lake ice · API samples (snowDepthAt / surfaceAt / slopeAt) ·
 *   --cost: fps with the terrain module's rings + materials on vs. the original terrain (same page, same view, paired).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'terrain-shots';
const dir = path.join(ROOT, 'stand', label); fs.mkdirSync(dir, { recursive: true });

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); const p = path.join(ROOT, u === '/' ? '/open-world.html' : u);
  const ext = path.extname(p).toLowerCase();
  if (!p.startsWith(ROOT) || !MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=1400,800'];
if (opt('unlimited')) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, userDataDir: path.join(ROOT, 'tools', '.chrome-profile'), protocolTimeout: 600000, defaultViewport: { width: 1400, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /THREE|terrain/i.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const log = (...a) => console.log('[terrain]', ...a);
try {
  await page.goto(`http://127.0.0.1:${srv.address().port}/${opt('page', 'open-world.html')}#dbg`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 120000, polling: 250 });
  await page.evaluate(() => { if (window.AI && AI.quality) AI.quality.set('high', 1e6); DBG.setQuality && DBG.setQuality('high'); DBG.newGame(); });
  await sleep(1500);
  await page.evaluate(() => { while (DBG.Dialog && DBG.Dialog.active) DBG.Dialog.close(); DBG.G.pause = false; const p = document.getElementById('pause'); if (p) p.hidden = true; DBG.WX.storm = 0; DBG.WX.target = 0; DBG.WX.t = 999; if (window.AI && AI.quality) AI.quality.set('high', 1e6); DBG.setQuality('high'); });
  const out = { errors };
  const shot = async (name) => { await sleep(700); await page.evaluate(() => { while (DBG.Dialog && DBG.Dialog.active) DBG.Dialog.close(); }); await page.screenshot({ path: path.join(dir, name + '.png') }); log('shot', name); };
  const fps = (ms = 1500) => page.evaluate((ms) => new Promise((res) => { const t = []; const f = (x) => { t.push(x); if (x - t[0] < ms) requestAnimationFrame(f); else { const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]); d.sort((a, b) => a - b); res(+(1000 / d[d.length >> 1]).toFixed(1)); } }; requestAnimationFrame(f); }), ms);

  // 1. walk a loop on open snow near the wreck, then look down at the trail
  const W0 = await page.evaluate(() => { const P = DBG.POI.crash; const x = P.x + 26, z = P.z + 22; DBG.teleport(x, z, 0); DBG.camOv = null; DBG.cam.dist = 6; DBG.cam.pitch = 0.5; return { x, z }; });
  for (const [k, ms] of [['KeyW', 1600], ['KeyD', 900], ['KeyS', 1300], ['KeyA', 700]]) { await page.evaluate((k) => { DBG.keys[k] = true; }, k); await sleep(ms); await page.evaluate((k) => { DBG.keys[k] = false; }, k); }
  await page.evaluate(() => { DBG.keys.ShiftLeft = true; DBG.keys.KeyW = true; }); await sleep(900); await page.evaluate(() => { DBG.keys.ShiftLeft = false; DBG.keys.KeyW = false; });
  await sleep(400);
  out.walk = await page.evaluate((w) => { const p = DBG.player, T = window.Terrain; return { from: w, to: [p.x, p.z], stamps: T && T.DEF ? T.DEF.mir.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) : null, depthHere: T && T.snowDepthAt(p.x, p.z), depthFresh: T && T.snowDepthAt(p.x + 5, p.z + 5), surface: T && T.surfaceAt(p.x, p.z, p.y) }; }, W0);
  await page.evaluate((w) => { const p = DBG.player, g = DBG.groundH((p.x + w.x) / 2, (p.z + w.z) / 2); DBG.camOv = { pos: [p.x + 4.5, g + 4.2, p.z + 5.5], look: [(p.x + w.x) / 2, g, (p.z + w.z) / 2] }; }, W0);
  await shot('tr_walk_trail');
  await page.evaluate((w) => { const p = DBG.player, dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d, g = DBG.groundH(p.x, p.z);
    DBG.camOv = { pos: [p.x + uz * 1.5 - ux * 0.5, g + 1.6, p.z - ux * 1.5 - uz * 0.5], look: [p.x + ux * 2.5, g, p.z + uz * 2.5] }; }, W0);
  await shot('tr_walk_close');
  // 2. skimmer tracks
  const sk = await page.evaluate(() => { try { const P = DBG.POI.crash, x = P.x + 60, z = P.z - 30; DBG.teleport(x, z, 0); DBG.camOv = null; const s = DBG.sk; if (!s) return 'no sk'; s.x = x + 2; s.z = z; s.y = DBG.groundH(x + 2, z) + 1; if (DBG.PH.ok && DBG.PH.vh) DBG.PH.vh.teleport(s.x, s.y + 0.2, s.z, 0); DBG.mount(); return DBG.G.riding; } catch (e) { return 'err ' + e.message; } });
  out.skimmer = sk;
  if (sk === true) {
    await page.evaluate(() => { DBG.keys.KeyW = true; }); await sleep(1800); await page.evaluate(() => { DBG.keys.KeyA = true; }); await sleep(900); await page.evaluate(() => { DBG.keys.KeyA = false; DBG.keys.KeyW = false; }); await sleep(1500);
    await page.evaluate(() => { const s = DBG.sk, g = DBG.groundH(s.x, s.z); DBG.camOv = { pos: [s.x + 9, g + 7, s.z + 9], look: [s.x - 3, g, s.z + 3] }; });
    await shot('tr_skimmer_tracks');
    await page.evaluate(() => { try { DBG.mount(); } catch (e) { /* toggle off */ } });
  }
  // 3. lee drift behind a boulder (wind blows towards +x)
  out.drift = await page.evaluate(() => {
    const T = window.Terrain, L = DBG.DECOR.boulders || []; if (!L.length || !T) return null;
    const p = new DBG.THREE.Vector3(), q = new DBG.THREE.Quaternion(), s = new DBG.THREE.Vector3(); let best = null;
    for (const m of L) { m.decompose(p, q, s); const d = Math.hypot(p.x - DBG.POI.crash.x, p.z - DBG.POI.crash.z); if (!best || d < best.d) best = { x: p.x, y: p.y, z: p.z, s: s.x, d }; }
    const w = T.windDir, samples = [];
    for (const k of [-6, -3, 0, 3, 6, 9, 12]) { const x = best.x + w.x * (best.s + k), z = best.z + w.z * (best.s + k); samples.push([k, +T.snowDepthAt(x, z).toFixed(3)]); }
    const cx = best.x + w.x * (best.s * 3 + 6) - w.z * 7, cz = best.z + w.z * (best.s * 3 + 6) + w.x * 7, g = DBG.groundH(cx, cz);
    DBG.camOv = { pos: [cx, g + 3.5, cz], look: [best.x + w.x * best.s * 1.5, best.y + 0.3, best.z + w.z * best.s * 1.5] }; DBG.teleport(best.x - 30, best.z - 30, 0);
    return { boulder: best, leeProfile: samples };
  });
  await shot('tr_boulder_drift');
  // 4. sea ice, lake ice
  await page.evaluate(() => { let d = 250; const a = 1.9; while (d < 440 && DBG.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d + 20), z = Math.sin(a) * (d + 20); DBG.teleport(x - 10, z, 0); DBG.camOv = { pos: [x, 2.2, z], look: [x + Math.cos(a) * 25, 0, z + Math.sin(a) * 25] }; });
  await shot('tr_sea_ice');
  await page.evaluate(() => { const L = DBG.POI.lake; DBG.teleport(L.x + 30, L.z + 30, 0); DBG.camOv = { pos: [L.x + 40, L.h + 3, L.z + 22], look: [L.x, L.h, L.z] }; });
  await shot('tr_lake_ice');
  // 5. API samples
  out.api = await page.evaluate(() => {
    const T = window.Terrain, P = DBG.POI, r = {};
    const pts = { crash: [P.crash.x + 26, P.crash.z + 22], station: [P.station.x, P.station.z], lake: [P.lake.x, P.lake.z], sea: [0, 430], rift: [P.rift.x, P.rift.z], north: [30, -200], spireN: [P.spireN.x, P.spireN.z] };
    for (const [k, [x, z]] of Object.entries(pts)) r[k] = { depth: +T.snowDepthAt(x, z).toFixed(3), surface: T.surfaceAt(x, z), slope: +T.slopeAt(x, z).toFixed(1) };
    r.kestrelTop = (() => { const k = DBG.WORLD.kestrel.g.position; return T.surfaceAt(k.x, k.z, k.y + 1.2); })();
    r.initMs = +T.S.initMs.toFixed(0); r.levels = T.S.levels.length; r.grid = T.S.N; r.deform = [T.DEF.res, T.DEF.ext];
    return r;
  });
  // 6. GPU cost of the scene pass (timer queries), terrain module on / rings off / original terrain — same view, alternating
  if (opt('cost')) {
    await page.evaluate(() => {
      const gl = DBG.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), pass = DBG.post.render, orig = pass.render.bind(pass);
      const G = window.__gpu = { res: [], pend: [] };
      pass.render = function (r, w, rb) {
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); orig(r, w, rb); gl.endQuery(ext.TIME_ELAPSED_EXT); G.pend.push(q);
        while (G.pend.length && gl.getQueryParameter(G.pend[0], gl.QUERY_RESULT_AVAILABLE)) { const qq = G.pend.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) G.res.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(qq); }
      };
      const T = window.Terrain;
      G.mode = (m0) => {
        const [m, ...flags] = m0.split('-'); T.S.noDef = flags.includes('nodef'); T.S.noHole = flags.includes('nohole'); T.S.dbgFlat = flags.includes('flat');
        T.S.root.visible = m === 'full'; T.S.hole.value.z = m === 'full' ? T.S.hole.value.z : -1;
        T.S.base.material = m === 'old' ? T.S.origMat : T.S.newMat;
        if (T.S.sea) T.S.sea.material = m === 'old' ? T.S.seaOrig : T.S.seaMat;
        if (T.S.lake) T.S.lake.material = m === 'old' ? T.S.lakeOrig : T.S.lakeMat;
        T.S.frozen = m !== 'full';
      };
    });
    const gpu = (ms) => page.evaluate((ms) => new Promise((res) => { window.__gpu.res = []; setTimeout(() => { const a = window.__gpu.res.slice().sort((x, y) => x - y); res(a.length ? +a[a.length >> 1].toFixed(2) : null); }, ms); }), ms);
    out.cost = [];
    const VIEWS = { crash: 'const P = DBG.POI; return [P.crash.x + 20, P.crash.z + 20, 0.28]', forest: 'const t = DBG.FOREST.list[0]; return [t[0] + 3, t[2] + 3, 0.2]', rift: 'const P = DBG.POI; return [P.rift.x + 20, P.rift.z + 88, 0.3]', sea: 'return [0, 380, 0.2]', mountains: 'return [30, -150, 0.1]', lake: 'const P = DBG.POI; return [P.lake.x + 40, P.lake.z + 30, 0.3]' };
    for (const [v, code] of Object.entries(VIEWS)) {
      await page.evaluate((code) => { const c = new Function(code)(); DBG.teleport(c[0], c[1], 0.8); DBG.camOv = null; DBG.cam.dist = 7.5; DBG.cam.pitch = c[2]; }, code);
      await sleep(1500);
      const MODES = String(opt('modes', 'full,rings_off,old')).split(',');   // full:<levels>:<grid> tries a ring layout
      const r = { view: v }; for (const m of MODES) r[m] = [];
      const setMode = (m) => page.evaluate((m) => { const [k, L, N] = m.split(':'); if (L) { DBG.Q.terrainLevels = +L; DBG.Q.terrainGrid = +N; } window.__gpu.mode(k); }, m);
      for (let k = 0; k < 3; k++) for (const m of MODES) { await setMode(m); await sleep(400); r[m].push(await gpu(900)); }
      await page.evaluate(() => { window.__gpu.mode('full'); DBG.Q.terrainLevels = DBG.QUALITY.high.terrainLevels; DBG.Q.terrainGrid = DBG.QUALITY.high.terrainGrid; });
      for (const m of MODES) { const a = r[m].filter((x) => x != null).sort((x, y) => x - y); r[m] = a[a.length >> 1]; }
      out.cost.push(r); log('scene-pass GPU ms', v, MODES.map((m) => m + ' ' + r[m]).join(' · '));
    }
  }
  fs.writeFileSync(path.join(dir, 'terrain.json'), JSON.stringify(out, null, 2));
  log(JSON.stringify(out, null, 1).slice(0, 3000));
} finally { await browser.close(); srv.close(); }
