#!/usr/bin/env node
/* stand.mjs — test bench ("стенд") for open-world.html
 *
 *   node tools/stand.mjs <label> [options]        run views + collision tests, write stand/<label>/
 *   node tools/stand.mjs compare <labelA> <labelB> write stand/compare.html (side by side)
 *
 * Options:
 *   --views a,b,c      subset of views (default: all 8)
 *   --station-spots    also render 4 camera spots around the station (station_n/e/s/w); every view gets a black-frame check (summary.blackFrames)
 *   --quality high     preset passed to window.DBG.setQuality (if the build has it)
 *   --size 1400x800    viewport
 *   --no-collide       skip collision tests        --only-collide  skip views
 *   --tests a,b        subset of collision tests (kestrel_n,kestrel_e,kestrel_s,kestrel_w,boulder,tree,climb_crate,jump_boulder)
 *   --headful          show the browser             --unlimited     disable vsync (fps headroom)
 *   --page open-world.html   page to open (relative to the game dir)
 *   --no-wasm          CSP without 'wasm-unsafe-eval': Rapier cannot start, the game runs its 2D fallback colliders
 *   --cold             fresh browser profile (cold CDN cache) instead of tools/.chrome-profile
 *   --settle 1500      ms to wait after a teleport before the screenshot
 *   --eval "<js>"      evaluate an expression in the page after the new game starts and print it (debugging)
 *
 * Serves the game directory with an emulated claude.ai artifact CSP and only the file types
 * the artifact host serves, so anything that would break there breaks here too.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'stand');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const EXTRA_VIEWS = ['crash_colliders', 'wf_camp', 'wf_ruins', 'wf_ship', 'climb_crate', 'station_n', 'station_e', 'station_s', 'station_w'];   // station_*: --station-spots   // not in the default set: --views wf_camp,...
const VIEWS = ['crash_close', 'crash_wide', 'station', 'forest', 'boulders', 'rift_rim', 'sea_horizon', 'player_rock'];

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (argv[0] === 'compare') { writeCompare(argv[1] || 'before', argv[2] || 'after'); process.exit(0); }
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run-' + Date.now();
const [VW, VH] = String(opt('size', '1400x800')).split('x').map(Number);
const views = (opt('views') ? String(opt('views')).split(',') : VIEWS).concat(opt('station-spots') ? ['station_n', 'station_e', 'station_s', 'station_w'] : []);
const settle = Number(opt('settle', 1500));

/* ---------------------------------------------------------------- server */
const CSP_USED = opt('no-wasm') ? CSP.replace(" 'wasm-unsafe-eval'", '') : CSP;   // --no-wasm: exercise the non-physics fallback
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    let p = path.join(ROOT, u === '/' ? '/open-world.html' : u);
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const ext = path.extname(p).toLowerCase();
    if (!MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, { 'Content-Security-Policy': CSP_USED }).end('not served'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Security-Policy': CSP_USED, 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ------------------------------------------------------------ page helpers (run in the page) */
const PAGE_LIB = () => {
  const D = window.DBG, T = D.THREE;
  const L = window.__stand = {};
  L.median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  L.measure = (ms) => new Promise((res) => {
    const r = D.renderer, ts = [];
    r.info.autoReset = false; r.info.reset();
    const f = (t) => { ts.push(t); if (t - ts[0] < ms) requestAnimationFrame(f); else done(); };
    const done = () => {
      const n = Math.max(1, ts.length - 1), dts = []; for (let i = 1; i < ts.length; i++) dts.push(ts[i] - ts[i - 1]);
      const calls = r.info.render.calls / n, tris = r.info.render.triangles / n; r.info.autoReset = true;
      const sorted = [...dts].sort((a, b) => a - b);
      res({ fps: +(1000 / L.median(dts)).toFixed(1), frameMsMedian: +L.median(dts).toFixed(2), frameMsP95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(2),
        frames: n, drawCalls: Math.round(calls), triangles: Math.round(tris) });
    };
    requestAnimationFrame(f);
  });
  // visible-geometry raycast (what the eye sees), not the physics
  L.skip = (o) => o.isSprite || o.isPoints || o.isLine || (o.material && (o.material.isShaderMaterial || o.material.transparent && o.material.depthWrite === false)) || o === D.terrainMesh;
  L.visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  L.meshesUnder = (root, filter) => { const out = []; root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !L.skip(o) && L.visible(o) && (!filter || filter(o))) out.push(o); }); return out; };
  L.ray = (objs, o, d, far = 60) => {
    for (const m of objs) if (m.isInstancedMesh) { m.boundingSphere = null; m.boundingBox = null; }   // instance sets change (forest LOD): never trust a cached bound
    const rc = new T.Raycaster(new T.Vector3(o.x, o.y, o.z), new T.Vector3(d.x, d.y, d.z).normalize(), 0, far);
    const h = rc.intersectObjects(objs, false); return h.length ? h[0] : null;
  };
  L.player = () => ({ x: D.player.x, y: D.player.y, z: D.player.z, onGround: D.player.onGround });
  L.teleport = (x, z, yaw, y) => {   // ground level unless y is given (DBG.teleport alone would land on top of whatever is there)
    if (D.teleport) return D.teleport(x, z, yaw, y !== undefined ? y : D.groundH(x, z));
    const p = D.player; p.x = x; p.z = z; p.y = y !== undefined ? y : D.groundH(x, z); p.vx = p.vz = p.vy = 0;
    if (D.PH && D.PH.ok) D.PH.ch.setPosition(p.x, p.y + 0.05, p.z);
    if (yaw !== undefined) D.cam.yaw = yaw;
  };
  L.closeDialogs = () => { let n = 0; while (D.Dialog && D.Dialog.active && n++ < 20) D.Dialog.close(); };
  L.instanceMeshesFor = (list0) => { // InstancedMeshes whose instance 0 matrix equals list0
    const out = []; D.scene.traverse((o) => { if (o.isInstancedMesh && o.count > 0) { const a = o.instanceMatrix.array; let ok = true; for (let i = 0; i < 16; i++) if (Math.abs(a[i] - list0.elements[i]) > 1e-4) { ok = false; break; } if (ok) out.push(o); } }); return out;
  };
  L.boulders = () => {
    if (D.targets && D.targets.boulders) return D.targets.boulders();
    const list = D.DECOR && D.DECOR.boulders; if (!list || !list.length) return { list: [], meshes: [] };
    return { list: list.map((m) => { const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(); m.decompose(p, q, s); return { x: p.x, y: p.y, z: p.z, s: s.x }; }), meshes: L.instanceMeshesFor(list[0]) };
  };
  return true;
};

/* ------------------------------------------------------------------ views */
// each view: returns {cam: {pos, look}} for a free camera or {player: {...}} for third person
const VIEW_DEF = {
  crash_close: `(() => { const P = DBG.POI.crash, k = DBG.WORLD.kestrel.g.position; const x = P.x - 3, z = P.z + 10; return { player: { x, z, yaw: Math.atan2(x - k.x, z - k.z) }, camDist: 7.5, pitch: 0.28 }; })()`,
  crash_colliders: `(() => { const k = DBG.WORLD.kestrel.g.position, x = k.x + 18, z = k.z + 14; DBG.teleport(k.x - 9, k.z + 9, 0); setTimeout(() => DBG.toggleColliderView && DBG.toggleColliderView(true), 50);
    return { player: { x: k.x - 9, z: k.z + 9, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 8, z], look: [k.x, k.y, k.z] } }; })()`,
  wf_camp: `(() => { const c = WorldFill.stats.camp; const x = c.x + 16, z = c.z + 12; return { player: { x: c.x + 8, z: c.z + 8, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 5, z], look: [c.x, DBG.groundH(c.x, c.z) + 1, c.z] } }; })()`,
  wf_ruins: `(() => { const c = WorldFill.stats.ruins[0]; const x = c.x + 14, z = c.z + 10; return { player: { x: c.x + 6, z: c.z + 9, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 4, z], look: [c.x, DBG.groundH(c.x, c.z) + 2, c.z] } }; })()`,
  wf_ship: `(() => { const c = WorldFill.stats.ship; const d = Math.hypot(c.x, c.z), ux = c.x / d, uz = c.z / d, x = c.x - ux * 30, z = c.z - uz * 30; return { player: { x, z, yaw: 0 }, cam: { pos: [x, 6, z], look: [c.x, 2, c.z] } }; })()`,
  climb_crate: `(() => { const c = DBG.WORLD.stationW(5, -8), st = DBG.WORLD.stationW(0, 0), a = Math.atan2(c.x - st.x, c.z - st.z), x = c.x + Math.sin(a) * 0.9, z = c.z + Math.cos(a) * 0.9;
    return { player: { x: c.x, z: c.z, y: DBG.POI.station.h + 1.22, yaw: Math.atan2(x - c.x, z - c.z) }, camDist: 5, pitch: 0.25 }; })()`,
  // station ring (black-frame hunt): 25 m out, 6 m up, 4 azimuths
  ...Object.fromEntries([['n', 0], ['e', 1.571], ['s', 3.142], ['w', 4.712]].map(([k, a]) => ['station_' + k, `(() => { const s = DBG.POI.station, x = s.x + Math.sin(${a}) * 25, z = s.z + Math.cos(${a}) * 25;
    return { player: { x: s.x + Math.sin(${a}) * 12, z: s.z + Math.cos(${a}) * 12, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 6, z], look: [s.x, s.h + 2, s.z] } }; })()`])),
  crash_wide: `(() => { const k = DBG.WORLD.kestrel.g.position, x = k.x + 30, z = k.z + 26; return { player: { x: k.x - 14, z: k.z + 14, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 11, z], look: [k.x, k.y + 1, k.z] } }; })()`,
  station: `(() => { const s = DBG.POI.station, c = DBG.POI.crash, a = Math.atan2(c.x - s.x, c.z - s.z) + 0.5, x = s.x + Math.sin(a) * 42, z = s.z + Math.cos(a) * 42; return { player: { x: s.x + Math.sin(a) * 20, z: s.z + Math.cos(a) * 20, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 9, z], look: [s.x, s.h + 3, s.z] } }; })()`,
  forest: `(() => { const L = DBG.FOREST.list; let best = L[0], bn = -1; for (let i = 0; i < L.length; i += 3) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 400) n++; if (n > bn) { bn = n; best = t; } }
    const x = best[0] + 3, z = best[2] + 3, g = DBG.groundH(x, z); return { player: { x, z, yaw: 0 }, cam: { pos: [x, g + 2.2, z], look: [x - 14, g + 3.5, z - 10] } }; })()`,
  boulders: `(() => { const B = window.__stand.boulders().list; let best = B[0], bn = -1; for (const b of B) { let n = 0; for (const u of B) if ((u.x - b.x) ** 2 + (u.z - b.z) ** 2 < 1600) n++; if (n > bn) { bn = n; best = b; } }
    const x = best.x + 9, z = best.z + 7; return { player: { x: x + 3, z: z + 3, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 3.2, z], look: [best.x, best.y + 1, best.z] } }; })()`,
  rift_rim: `(() => { const r = DBG.POI.rift, x = r.x + 20, z = r.z + 88; return { player: { x, z: z + 4, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 6, z], look: [r.x, 8, r.z] } }; })()`,
  sea_horizon: `(() => { let d = 250; const a = 1.9; while (d < 440 && DBG.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d - 14), z = Math.sin(a) * (d - 14);
    return { player: { x, z, yaw: 0 }, cam: { pos: [x, DBG.groundH(x, z) + 4, z], look: [Math.cos(a) * 1200, 20, Math.sin(a) * 1200] } }; })()`,
  player_rock: `(() => { const B = window.__stand.boulders(); let best = null; for (const b of B.list) { if (b.s < 2.2 || b.s > 3.2) continue; const d = Math.hypot(b.x - DBG.POI.crash.x, b.z - DBG.POI.crash.z); if (!best || d < best.d) best = { ...b, d }; }
    best = best || B.list[0]; const top = window.__stand.ray(B.meshes, { x: best.x, y: best.y + 30, z: best.z }, { x: 0, y: -1, z: 0 }, 80);
    const y = top ? top.point.y : best.y + best.s; return { player: { x: best.x, z: best.z, y: y + 0.05, yaw: 2.2 }, camDist: 4.2, pitch: 0.18, rock: best }; })()`,
};

/* --------------------------------------------------------------- collisions */
// walk into a target and compare the stop distance with the visible surface (ray against drawn meshes)
async function collideTests(page, log) {
  const res = [];
  // walk: hold W towards the target, sample the capsule-to-drawn-surface gap every 80 ms, keep the closest approach.
  // Rays are double-sided, so standing *inside* a mesh shows up as a negative gap (walk-through), stopping short as a
  // positive one (invisible air). Pass = closest approach within ±0.3 m of the visible surface.
  const only = opt('tests') ? String(opt('tests')).split(',') : null;
  const walk = async (name, setup) => {
    if (only && !only.includes(name)) return;
    const s = await page.evaluate(setup);
    if (!s || s.err) { res.push({ name, ok: false, err: s ? s.err : 'no target' }); return; }
    const r = await page.evaluate(async (s) => {
      const L = window.__stand, T = DBG.THREE, p = DBG.player, objs = eval(s.objs), R = s.radius, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      if (!(DBG.PH && DBG.PH.ok)) s.sample = true;   // 2D fallback: the pilot slides along circles, so closest approach counts
      L.teleport(s.x, s.z, s.yaw); DBG.cam.pitch = 0.3; await wait(350); s.yawFwd = Math.atan2(-Math.sin(s.yaw), -Math.cos(s.yaw)) ;
      const sides = []; for (const o of objs) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { sides.push([m, m.side]); m.side = T.DoubleSide; } }
      // capsule (r 0.4, h 1.8, feet at p.y): horizontal radius at height h above the feet
      const capR = (h) => h < 0.4 ? Math.sqrt(Math.max(0, 0.16 - (0.4 - h) ** 2)) : h > 1.4 ? Math.sqrt(Math.max(0, 0.16 - (h - 1.4) ** 2)) : 0.4;
      const gapNow = (dense) => {
        let best = null;
        const hs = s.heights || (dense ? [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 1.6, 1.7] : [0.25, 0.7, 1.2, 1.6]);
        const angs = []; if (dense) for (let a = -90; a <= 90; a += 6) angs.push(s.yawFwd + a * Math.PI / 180); else for (let a = 0; a < 360; a += 10) angs.push(a * Math.PI / 180);
        for (const ang of angs) for (const hy of hs) {
          const d = { x: Math.sin(ang), y: 0, z: Math.cos(ang) }, h = L.ray(objs, { x: p.x, y: p.y + hy, z: p.z }, d, 20);
          if (h && (!best || h.distance - capR(hy) < best.gap)) best = { gap: h.distance - capR(hy), hy, dir: 'side', obj: h.object.name || h.object.type };
        }
        if (s.heights) return best;
        const dn = L.ray(objs, { x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: -1, z: 0 }, 3);
        if (dn && (!best || dn.distance - 0.5 < best.gap)) best = { gap: dn.distance - 0.5, dir: 'below', obj: dn.object.name || dn.object.type };
        // resting on a rounded rock with the edge of the capsule's bottom: rays straight down from the capsule surface
        for (const [ox, oz] of [[0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28], [0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) {
          const o = Math.hypot(ox, oz), y0 = 0.4 - Math.sqrt(0.16 - o * o), h = L.ray(objs, { x: p.x + ox, y: p.y + y0 + 0.3, z: p.z + oz }, { x: 0, y: -1, z: 0 }, 1.5);
          if (h && (!best || h.distance - 0.3 < best.gap)) best = { gap: h.distance - 0.3, dir: 'below', obj: h.object.name || h.object.type };
        }
        // a surface above the capsule top (wing edge the pilot walks under) or inside it (penetration)
        for (const [ox, oz] of [[0, 0], [0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28]]) {
          const o = Math.hypot(ox, oz), y0 = 0.4 - Math.sqrt(0.16 - o * o) + 0.01, span = 1.4 + Math.sqrt(0.16 - o * o) - y0;
          const up = L.ray(objs, { x: p.x + ox, y: p.y + y0, z: p.z + oz }, { x: 0, y: 1, z: 0 }, span + 0.8);
          if (up && (!best || up.distance - span < best.gap)) best = { gap: up.distance - span, dir: up.distance < span ? 'inside' : 'above', obj: up.object.name || up.object.type };
        }
        return best;
      };
      // walk until the pilot has stopped (or timeout). Only light probes while walking (the game must keep its frame
      // rate, heavy raycasts would stall it); round trunks make the pilot slide around, so for them (s.sample) the
      // closest approach while walking is what counts.
      DBG.keys.KeyW = true; let min = null, still = 0, last = [p.x, p.z, p.y]; const t0 = performance.now(), trace = [];
      while (performance.now() - t0 < s.walkMs) {
        await wait(100);
        const moved = Math.hypot(p.x - last[0], p.y - last[2], p.z - last[1]) + (DBG.CLIMB && DBG.CLIMB.t >= 0 ? 1 : 0); last = [p.x, p.z, p.y];
        let g = null; if (s.sample) { g = gapNow(); if (g && (!min || g.gap < min.gap)) min = Object.assign(g, { at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], t: Math.round(performance.now() - t0) }); }
        trace.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), g ? +g.gap.toFixed(2) : null, (p.onGround ? 'g' : 'a') + (p.sliding ? 's' : '') + (DBG.CLIMB && DBG.CLIMB.t >= 0 ? 'c' : '')]);
        if (moved < 0.02) { if (++still >= 4) break; } else still = 0;
      }
      DBG.keys.KeyW = false; await wait(300);
      // what physically stopped the pilot (Passport tag), for diagnosis
      let blocker = null;
      if (DBG.PH && DBG.PH.ok && DBG.PH.P.sphereCast) for (const hy of [0.45, 0.9, 1.4]) { const b = DBG.PH.P.sphereCast({ x: p.x, y: p.y + hy, z: p.z }, { x: Math.sin(s.yawFwd), y: 0, z: Math.cos(s.yawFwd) }, 1.5, 0.38);
        if (b && (!blocker || b.distance < blocker.d)) blocker = { d: +b.distance.toFixed(3), hy, tag: b.tag && (b.tag.name || b.tag.kind) }; }
      { const g = gapNow(true); if (g && (!min || g.gap < min.gap)) min = Object.assign(g, { at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], t: 'final' }); }   // dense probe where it stopped
      for (const [m, sd] of sides) m.side = sd;
      return { start: [+s.x.toFixed(2), +s.z.toFixed(2)], end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], travelled: +Math.hypot(p.x - s.x, p.z - s.z).toFixed(2),
        gap: min ? +min.gap.toFixed(3) : null, closest: min, blocker, trace };
    }, s);
    r.name = name; r.ok = r.gap !== null && Math.abs(r.gap) <= 0.3; res.push(r);
    log(`  collide ${name}: closest gap ${r.gap} m ${r.closest ? '(' + r.closest.dir + ')' : ''} ${r.ok ? 'OK' : 'FAIL'}${r.blocker ? ' · stopped by ' + r.blocker.tag + ' @' + r.blocker.d : ''}`);
  };
  const R = 0.4;
  // Kestrel wreck: from 4 sides (nose, tail, both flanks) — the old r=6.5 cylinder showed up as invisible air on some
  for (const [k, a] of [['kestrel_n', 0], ['kestrel_e', 1.571], ['kestrel_s', 3.142], ['kestrel_w', 4.712]])
    await walk(k, `(() => { const k = DBG.WORLD.kestrel.g, c = new DBG.THREE.Box3().setFromObject(k).getCenter(new DBG.THREE.Vector3());
      const a = k.rotation.y + ${a}, x = c.x + Math.sin(a) * 16, z = c.z + Math.cos(a) * 16; return { x, z, yaw: Math.atan2(x - c.x, z - c.z), radius: ${R}, objs: "window.__stand.meshesUnder(DBG.WORLD.kestrel.g)", walkMs: 7000 }; })()`);
  // boulder (low enough to be a wall, big enough to hit)
  await walk('boulder', `(() => { const B = window.__stand.boulders(); const L = window.__stand; let b = null;
    for (const c of B.list) { if (c.s < 2.4) continue; const d = Math.hypot(c.x - DBG.POI.crash.x, c.z - DBG.POI.crash.z); if (!b || d < b.d) b = { ...c, d }; }
    if (!b) return { err: 'no boulder' }; const a = 0.7, x = b.x + Math.sin(a) * 10, z = b.z + Math.cos(a) * 10;
    return { x, z, yaw: Math.atan2(x - b.x, z - b.z), radius: ${R}, objs: "window.__stand.boulders().meshes.concat(DBG.DECOR.rockMesh ? [DBG.DECOR.rockMesh] : [])", walkMs: 6000 }; })()`);   // all rocks: small ones lie around big ones
  // tree trunk (bark part only: needles/branches are passable by design)
  await walk('tree', `(() => { const F = DBG.FOREST, L = F.list; let t = null;
    for (const c of L) { if (c.v !== 0) continue; let lone = true; for (const u of L) if (u !== c && (u[0] - c[0]) ** 2 + (u[2] - c[2]) ** 2 < 49) { lone = false; break; } if (!lone) continue;
      const d = Math.hypot(c[0] - DBG.POI.crash.x, c[2] - DBG.POI.crash.z); if (!t || d < t.d) t = Object.assign([...c], { d, v: c.v }); }
    if (!t) return { err: 'no lone spruce' };
    // aim at the trunk axis (a round trunk hit off-centre makes the character slide around it, which is correct but not a stop test)
    const pe = DBG.Passport && DBG.Passport.byRole.trunk.find((e) => Math.hypot(e.trunk.x - t[0], e.trunk.z - t[2]) < 1.5), cx = pe ? pe.trunk.x : t[0], cz = pe ? pe.trunk.z : t[2];
    const a = 1.2, x = cx + Math.sin(a) * 7, z = cz + Math.cos(a) * 7;
    return { x, z, yaw: Math.atan2(x - cx, z - cz), radius: ${R}, objs: "(DBG.FOREST.parts[0] || []).filter((m) => /bark/i.test(m.material.name))", walkMs: 2600, heights: [0.15, 0.45], sample: true }; })()`);   // below the lowest branches: trunk only
  // ledge climb: a 1.2 m station crate — walk at it, press jump in front of it, must end standing on top
  if ((!only || only.includes('climb_crate')) && await page.evaluate(() => !!(DBG.CLIMB && DBG.WORLD.stationW))) {
    const s = await page.evaluate(() => { const c = DBG.WORLD.stationW(5, -8), st = DBG.WORLD.stationW(0, 0), a = Math.atan2(c.x - st.x, c.z - st.z), x = c.x + Math.sin(a) * 3.2, z = c.z + Math.cos(a) * 3.2;
      return { x, z, cx: c.x, cz: c.z, yaw: Math.atan2(x - c.x, z - c.z), top: DBG.POI.station.h + 1.2 }; });
    await page.evaluate((s) => { window.__stand.teleport(s.x, s.z, s.yaw); }, s); await sleep(400);
    await page.evaluate(() => { DBG.keys.KeyW = true; });
    let climbed = false;
    for (let i = 0; i < 60; i++) { await sleep(40); const d = await page.evaluate((s) => [Math.hypot(DBG.player.x - s.cx, DBG.player.z - s.cz), DBG.CLIMB.t], s);
      if (d[1] >= 0) climbed = true; if (!climbed && d[0] < 1.6) await page.evaluate(() => DBG.pressed.add('Space')); if (climbed && d[1] < 0) break; }
    await page.evaluate(() => { DBG.keys.KeyW = false; }); await sleep(500);
    const r = await page.evaluate((s) => ({ end: [+DBG.player.x.toFixed(2), +DBG.player.y.toFixed(2), +DBG.player.z.toFixed(2)], onGround: !!DBG.player.onGround, top: +s.top.toFixed(2) }), s);
    r.name = 'climb_crate'; r.climbed = climbed; r.ok = climbed && r.onGround && Math.abs(r.end[1] - s.top) < 0.25; res.push(r);
    log(`  climb onto crate (1.2 m): ${r.ok ? 'OK' : 'FAIL'} climbed=${climbed} y=${r.end[1]} top=${r.top}`);
  }
  // jump onto a boulder: must end grounded on top
  if (!only || only.includes('jump_boulder')) {
    const s = await page.evaluate(`(() => { const B = window.__stand.boulders(), L = window.__stand; let pick = null;
      for (const b of B.list) { const top = L.ray(B.meshes, { x: b.x, y: b.y + 40, z: b.z }, { x: 0, y: -1, z: 0 }, 90); if (!top) continue;
        const h = top.point.y - DBG.groundH(b.x, b.z); if (h < 0.9 || h > 1.6) continue;
        // prefer rocks too high to simply walk onto (>= 1.1 m), then the nearest to the crash site
        const d = Math.hypot(b.x - DBG.POI.crash.x, b.z - DBG.POI.crash.z) + (h < 1.1 ? 1e4 : 0); if (!pick || d < pick.d) pick = { ...b, top: top.point.y, h, d }; }
      if (!pick) return { err: 'no jumpable boulder' }; const a = 2.0, x = pick.x + Math.sin(a) * 6, z = pick.z + Math.cos(a) * 6;
      return { x, z, yaw: Math.atan2(x - pick.x, z - pick.z), rock: pick }; })()`);
    if (s.err) res.push({ name: 'jump_boulder', ok: false, err: s.err });
    else {
      // walk up to the rock until the pilot touches it, stop, then a standing jump with forward air control (like a player)
      await page.evaluate((s) => { window.__stand.teleport(s.x, s.z, s.yaw); }, s);
      await sleep(400);
      const trace = [];
      const snap = async () => trace.push(await page.evaluate((s) => { const p = DBG.player; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +Math.hypot(p.x - s.rock.x, p.z - s.rock.z).toFixed(2), p.onGround ? 1 : 0, DBG.CLIMB ? +DBG.CLIMB.t.toFixed(2) : -1]; }, s));
      await page.evaluate(() => { DBG.keys.KeyW = true; });
      let last = null;
      for (let i = 0; i < 80; i++) { await sleep(40); const q = await page.evaluate(() => [DBG.player.x, DBG.player.z]); if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.01) break; last = q; }
      await page.evaluate(() => { DBG.keys.KeyW = false; }); await sleep(350); await snap();
      await page.evaluate(() => { DBG.pressed.add('Space'); }); await sleep(60);
      await page.evaluate(() => { DBG.keys.KeyW = true; });
      for (let i = 0; i < 40; i++) { await sleep(40); await snap(); const g = await page.evaluate(() => DBG.player.onGround && (!DBG.CLIMB || DBG.CLIMB.t < 0)); if (i > 4 && g) break; }
      await page.evaluate(() => { DBG.keys.KeyW = false; });
      await sleep(1000); await snap();
      const r = await page.evaluate((s) => { const p = DBG.player; return { end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], onGround: !!p.onGround, rockTop: +s.rock.top.toFixed(2), rockH: +s.rock.h.toFixed(2),
        aboveGround: +(p.y - DBG.groundH(p.x, p.z)).toFixed(2), distToRock: +Math.hypot(p.x - s.rock.x, p.z - s.rock.z).toFixed(2) }; }, s);
      r.trace = trace; r.name = 'jump_boulder'; r.ok = r.onGround && r.aboveGround > 0.5 && Math.abs(r.end[1] - r.rockTop) < 0.6; res.push(r);
      log(`  jump onto boulder (h ${r.rockH} m): ${r.ok ? 'OK' : 'FAIL'} y=${r.end[1]} top=${r.rockTop} grounded=${r.onGround}`);
    }
  }
  return res;
}

/* -------------------------------------------------------------------- main */
async function run() {
  const srv = await serve(), port = srv.address().port;
  const dir = path.join(OUT, label); fs.mkdirSync(dir, { recursive: true });
  const log = (...a) => console.log('[stand]', ...a);
  const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`, '--autoplay-policy=no-user-gesture-required'];
  if (opt('unlimited')) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  // persistent profile = warm HTTP cache for the CDN modules (repeat runs load in ~3 s); --cold uses a fresh profile
  const userDataDir = opt('cold') ? undefined : path.join(ROOT, 'tools', '.chrome-profile');
  // other GPU-heavy headless browsers (another agent's renders) halve vsync-locked fps: report them, never touch them
  let others = 0; try { others = Number(execSync("ps -Ao args | grep -c '[G]oogle Chrome --allow-pre-commit-input'").toString().trim()) || 0; } catch (e) { others = 0; }
  if (others) log(`note: ${others} other headless Chrome instance(s) running — fps may be lower than on an idle machine`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: !opt('headful'), args, userDataDir, protocolTimeout: 900000, defaultViewport: { width: VW, height: VH, deviceScaleFactor: 1 } });
  const closeAll = BROWSER_CLOSE = async () => { try { await browser.close(); } catch (e) { /* already closed */ } try { srv.close(); } catch (e) { /* */ } };
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => closeAll().then(() => process.exit(130)));
  const page = await browser.newPage();
  const errors = [], failed = [], warnings = [];
  // 'Failed to load resource' console lines are duplicates of the `failed` list (which has the URL); favicon is browser noise
  page.on('console', (m) => { const t = m.type(), s = m.text(); if (t === 'error') { if (!/^Failed to load resource/.test(s)) errors.push(s); } else if (t === 'warning' || t === 'warn') warnings.push(s); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) failed.push(r.status() + ' ' + r.url()); });
  const url = `http://127.0.0.1:${port}/${opt('page', 'open-world.html')}#dbg`;
  log('open', url);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 90000, polling: 250 }); }
  catch (e) { log('loader never finished'); log('errors:', errors.slice(0, 20)); log('failed:', failed.slice(0, 20)); await page.screenshot({ path: path.join(dir, 'load-fail.png') }); await browser.close(); srv.close(); process.exit(2); }
  const loadMs = Date.now() - t0;
  const loader = await page.evaluate(() => [...document.querySelectorAll('.lmod')].map((e) => ({ id: e.id.replace('lm-', ''), ok: e.classList.contains('ok'), bad: e.classList.contains('bad') })));
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  log(`loaded in ${loadMs} ms · gpu: ${gpu} · modules ok ${loader.filter((m) => m.ok).length}/${loader.length}`);
  await page.evaluate(PAGE_LIB);
  const quality = opt('quality', 'high');
  const qApplied = await page.evaluate((q) => { if (DBG.setQuality) { DBG.setQuality(q); return q; } return null; }, quality);
  // new game, skip intro
  await page.evaluate(() => { if (DBG.newGame) DBG.newGame(); else document.getElementById('bNew').click(); });
  await sleep(1200);
  await page.evaluate(() => { window.__stand.closeDialogs(); if (DBG.G.pause) DBG.G.pause = false; document.getElementById('pause').hidden = true; });
  await sleep(300);
  await page.evaluate(() => window.__stand.closeDialogs());
  if (opt('eval')) { for (const ex of [].concat(opt('eval'))) { try { log('eval', ex, '=>', JSON.stringify(await page.evaluate(ex), null, 1)); } catch (e) { log('eval failed', ex, e.message); } } }
  const result = { label, date: new Date().toISOString(), url, size: [VW, VH], gpu, otherHeadlessChromes: others, quality: qApplied, loadMs, loader, views: {}, collisions: null, errors, failed, warnings: warnings.slice(0, 40) };

  if (!opt('only-collide')) for (const v of views) {
    const def = VIEW_DEF[v]; if (!def) { log('unknown view', v); continue; }
    const info = await page.evaluate((code) => {
      const d = eval(code); window.__stand.closeDialogs();
      DBG.camOv = d.cam || null;
      if (d.player) window.__stand.teleport(d.player.x, d.player.z, d.player.yaw, d.player.y);
      if (d.camDist) DBG.cam.dist = d.camDist; else DBG.cam.dist = 7.5;
      if (d.pitch !== undefined) DBG.cam.pitch = d.pitch;
      return { cam: d.cam || null, player: d.player || null, rock: d.rock || null };
    }, def);
    await sleep(settle);
    await page.evaluate(() => window.__stand.closeDialogs());
    const m = await page.evaluate(() => window.__stand.measure(2000));
    const file = path.join(dir, v + '.png');
    await page.screenshot({ path: file });
    // black-frame check: mean luminance of the screenshot (HUD margins cropped); a NaN pixel + bloom blackens the whole frame
    const lum = await page.evaluate(async (b) => { const im = new Image(); im.src = 'data:image/png;base64,' + b; await im.decode(); const c = document.createElement('canvas'), w = 140, h = 80; c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, w, h); const d = g.getImageData(14, 10, w - 28, h - 24).data; let s = 0, n = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; n++; if (l < 6) dark++; } return { mean: s / n, dark: dark / n }; }, fs.readFileSync(file).toString('base64'));
    m.luma = +lum.mean.toFixed(1); m.black = lum.dark > 0.85;
    if (m.black) log(`  !! BLACK FRAME: ${v} (mean luma ${m.luma})`);
    const st = await page.evaluate(() => window.__stand.player());
    result.views[v] = Object.assign(m, { player: st, setup: info });
    log(`  ${v.padEnd(12)} ${String(m.fps).padStart(5)} fps · ${m.drawCalls} calls · ${(m.triangles / 1e6).toFixed(2)}M tris`);
  }
  await page.evaluate(() => { DBG.camOv = null; DBG.cam.dist = 7.5; });
  if (!opt('no-collide')) { log('collision tests'); result.collisions = await collideTests(page, log); }
  const fpsList = Object.values(result.views).map((v) => v.fps);
  result.summary = { fpsMedian: fpsList.length ? [...fpsList].sort((a, b) => a - b)[fpsList.length >> 1] : null, fpsMin: fpsList.length ? Math.min(...fpsList) : null,
    errors: errors.length, failed: failed.length, modulesOk: loader.filter((m) => m.ok).length, modules: loader.length, blackFrames: Object.values(result.views).filter((x) => x.black).length,
    collisionsOk: result.collisions ? result.collisions.filter((c) => c.ok).length : null, collisions: result.collisions ? result.collisions.length : null };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  log('summary', JSON.stringify(result.summary));
  if (errors.length) log('errors:', errors.slice(0, 10));
  if (failed.length) log('failed:', failed.slice(0, 10));
  await browser.close(); srv.close();
}

/* ------------------------------------------------------------ compare page */
function writeCompare(a, b) {
  const rd = (l) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, l, 'result.json'), 'utf8')); } catch (e) { return null; } };
  const A = rd(a), B = rd(b);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NAMES = { crash_close: 'Обломки · близко', crash_wide: 'Обломки · общий', station: 'Станция', forest: 'Лес', boulders: 'Валуны', rift_rim: 'Край Разлома', sea_horizon: 'Море · горизонт', player_rock: 'Пилот на камне' };
  const ICO = { fps: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>', calls: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>',
    tri: '<svg viewBox="0 0 24 24"><path d="M12 3l9 17H3z"/></svg>', ok: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>', bad: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    err: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2zM12 10v5M12 18v.5"/></svg>', box: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/></svg>' };
  const tile = (icon, val, sub, cls = '') => `<div class="tile ${cls}">${icon}<b>${esc(val)}</b><small>${esc(sub)}</small></div>`;
  const delta = (x, y, better) => { if (x == null || y == null) return ''; const d = y - x; const good = better === 'up' ? d >= 0 : d <= 0; return `<em class="${good ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}</em>`; };
  const bar = (v, max, cls) => `<span class="bar"><i class="${cls}" style="width:${Math.min(100, (v || 0) / max * 100).toFixed(1)}%"></i></span>`;
  const views = [...new Set([...(A ? Object.keys(A.views) : []), ...(B ? Object.keys(B.views) : [])])];
  const colRows = (() => {
    const names = [...new Set([...(A && A.collisions || []).map((c) => c.name), ...(B && B.collisions || []).map((c) => c.name)])];
    const cell = (c) => !c ? '<td>—</td>' : `<td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? ICO.ok : ICO.bad}<span>${c.gap != null ? (c.gap > 0 ? '+' : '') + c.gap.toFixed(2) + ' м' : c.rockTop != null ? 'y ' + c.end[1] + ' / верх ' + c.rockTop : c.err ? esc(c.err) : c.top != null ? '' : 'мимо'}</span></td>`;
    return names.map((n) => `<tr><th>${{ kestrel_n: 'Кестрел · нос', kestrel_e: 'Кестрел · борт', kestrel_s: 'Кестрел · хвост', kestrel_w: 'Кестрел · борт 2', boulder: 'Валун', tree: 'Ствол', jump_boulder: 'Прыжок на валун', climb_crate: 'Подъём на ящик' }[n] || n}</th>${cell((A && A.collisions || []).find((c) => c.name === n))}${cell((B && B.collisions || []).find((c) => c.name === n))}</tr>`).join('');
  })();
  const sumA = A && A.summary || {}, sumB = B && B.summary || {};
  const UA = rd(a + '-unl'), UB = rd(b + '-unl');   // optional: same views with vsync off (headroom)
  const maxFps = 65;
  const html = `<!doctype html><meta charset="utf-8"><title>Стенд · сравнение</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0a0f1e;--panel:#121a30;--ink:#e8f0ff;--dim:#8a9cc0;--ok:#5cf5c0;--bad:#ff5c7d;--a:#8a9cc0;--b:#7fe3ff;--line:rgba(127,227,255,.18)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.35 system-ui,-apple-system,sans-serif;padding:16px}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
h1{display:flex;gap:10px;align-items:center;font-size:18px;margin:0 0 12px}.chip{display:inline-flex;gap:6px;align-items:center;padding:3px 10px;border-radius:99px;background:var(--panel);border:1px solid var(--line);font-size:12px;color:var(--dim)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px}.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:2px}
.tile b{font-size:20px;font-variant-numeric:tabular-nums}.tile small{color:var(--dim);font-size:11px}.tile.ok{border-color:rgba(92,245,192,.5)}.tile.bad{border-color:rgba(255,92,125,.5)}
em{font-style:normal;font-size:12px;margin-left:6px}em.up{color:var(--ok)}em.dn{color:var(--bad)}
.view{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px;margin-bottom:12px}.vh{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.vh b{font-size:15px;margin-right:auto}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair figure{margin:0;position:relative}.pair img{width:100%;display:block;border-radius:8px;cursor:zoom-in}
.pair figcaption{position:absolute;left:8px;top:8px}.m{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.bar{display:inline-block;width:70px;height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}.bar i{display:block;height:100%}.bar i.a{background:var(--a)}.bar i.b{background:var(--b)}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line)}
td{white-space:nowrap}td svg{vertical-align:-4px;margin-right:6px}td.ok{color:var(--ok)}td.bad{color:var(--bad)}thead th{color:var(--dim);font-weight:600;font-size:12px}
.zoom{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;place-items:center;z-index:9}.zoom img{max-width:98vw;max-height:96vh}.zoom.on{display:grid}
@media(max-width:700px){.pair{grid-template-columns:1fr}}
</style>
<h1>${ICO.box}Стенд <span class="chip">${esc(a)}</span>→<span class="chip" style="color:var(--b)">${esc(b)}</span></h1>
<div class="tiles">
${tile(ICO.fps, (sumB.fpsMedian ?? '—') + ' fps', 'медиана · было ' + (sumA.fpsMedian ?? '—'), (sumB.fpsMedian || 0) >= 55 ? 'ok' : 'bad')}
${tile(ICO.ok, (sumB.collisionsOk ?? '—') + '/' + (sumB.collisions ?? '—'), 'столкновения · было ' + (sumA.collisionsOk ?? '—') + '/' + (sumA.collisions ?? '—'), sumB.collisionsOk === sumB.collisions ? 'ok' : 'bad')}
${tile(ICO.err, (sumB.errors ?? '—'), 'ошибок JS · было ' + (sumA.errors ?? '—'), sumB.errors ? 'bad' : 'ok')}
${tile(ICO.box, (sumB.modulesOk ?? '—') + '/' + (sumB.modules ?? '—'), 'модулей загружено', sumB.modulesOk === sumB.modules ? 'ok' : 'bad')}
${UA && UB ? tile(ICO.fps, UB.summary.fpsMedian + ' fps', 'без vsync · было ' + UA.summary.fpsMedian) : ''}
${tile(ICO.calls, Math.round(Object.values(B ? B.views : {}).reduce((q, v) => q + v.drawCalls, 0) / Math.max(1, Object.keys(B ? B.views : {}).length)), 'вызовов · было ' + Math.round(Object.values(A ? A.views : {}).reduce((q, v) => q + v.drawCalls, 0) / Math.max(1, Object.keys(A ? A.views : {}).length)))}
</div>
<table><thead><tr><th>Столкновение</th><th>${esc(a)}</th><th>${esc(b)}</th></tr></thead><tbody>${colRows}</tbody></table>
${views.map((v) => { const va = A && A.views[v], vb = B && B.views[v]; return `<div class="view"><div class="vh"><b>${esc(NAMES[v] || v)}</b>
<span class="m">${ICO.fps}${bar(va && va.fps, maxFps, 'a')}${va ? va.fps : '—'} → ${bar(vb && vb.fps, maxFps, 'b')}${vb ? vb.fps : '—'}${delta(va && va.fps, vb && vb.fps, 'up')}</span>
<span class="m">${ICO.calls}${va ? va.drawCalls : '—'} → ${vb ? vb.drawCalls : '—'}${delta(va && va.drawCalls, vb && vb.drawCalls, 'down')}</span>
<span class="m">${ICO.tri}${va ? (va.triangles / 1e6).toFixed(2) : '—'}M → ${vb ? (vb.triangles / 1e6).toFixed(2) : '—'}M</span></div>
<div class="pair"><figure>${va ? `<img src="${esc(a)}/${v}.png" loading="lazy">` : ''}<figcaption class="chip">${esc(a)}</figcaption></figure><figure>${vb ? `<img src="${esc(b)}/${v}.png" loading="lazy">` : ''}<figcaption class="chip" style="color:var(--b)">${esc(b)}</figcaption></figure></div></div>`; }).join('\n')}
<div class="zoom" id="z"><img id="zi"></div>
<script>document.querySelectorAll('.pair img').forEach(i=>i.onclick=()=>{zi.src=i.src;z.classList.add('on')});z.onclick=()=>z.classList.remove('on');</script>`;
  fs.writeFileSync(path.join(OUT, 'compare.html'), html);
  console.log('[stand] wrote', path.join(OUT, 'compare.html'));
}

let BROWSER_CLOSE = null;
run().catch(async (e) => { console.error('[stand] FAILED', e); if (BROWSER_CLOSE) await BROWSER_CLOSE(); process.exit(1); });
