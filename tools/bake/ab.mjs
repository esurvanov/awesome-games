#!/usr/bin/env node
/* ab.mjs — A/B the baked-lighting runtime (runtime/baked.js) against the live hemisphere/IBL + full shadow-distance
 * path it replaces. NEVER touches the real repo: --root must be a scratch copy (tools/bake/BAKE.md §A/B).
 *
 *   node tools/bake/ab.mjs --root /path/to/scratch/game [--views crash,forest,vista] [--warm 20000]
 *
 * The scratch copy needs: assets/baked/ (this bake's output), the <script> tags for tools/bake/ktx2-csp.js +
 * assets/baked/basis_wasm.js + modules/baked.js in open-world.html (BAKE.md §Runtime lists them). Toggles
 * DBG.BAKED.setOn(false/true) — which also reverts GTAO and the cached-shadow distance (see modules/baked.js
 * applyQ()) — so the A/B measures the whole replacement, not just the texture sample.
 *
 * Uses tools/bake/lib.mjs's openWorld(): the benchmark lock is ALWAYS the real repo's tools/.stand.lock, even when
 * root is a scratch copy (lib.mjs resolves it relative to its own path, not root) — one GPU-heavy browser at a time
 * on this machine, coordinated with every other stand/qa/bake run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openWorld, sleep } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const ROOT = path.resolve(opt('root'));
if (!fs.existsSync(path.join(ROOT, 'assets', 'baked', 'manifest.json'))) throw new Error('no assets/baked/manifest.json under --root ' + ROOT + ' (copy the bake output in first)');
const OUT = path.resolve(opt('out', path.join(ROOT, '..', 'ab-results')));
fs.mkdirSync(OUT, { recursive: true });
const WARM = Number(opt('warm', 20000));
const MEASURE_MS = Number(opt('measure', 1200));
const REPEAT = Number(opt('repeat', 3));

// same views as tools/stand.mjs VIEW_DEF, but as real functions (not code strings run through eval() in the page —
// the artifact CSP's script-src has no 'unsafe-eval', only 'wasm-unsafe-eval'; a plain in-page eval() throws a CSP
// pageerror. Puppeteer's page.evaluate(fn) does not need eval — it calls fn directly via CDP — so passing the
// function itself, never a string, sidesteps the restriction entirely.)
// each applies its own teleport + camera override directly (in-page — no return value needed, so no need to marshal
// the def back out to Node and re-apply it in a second evaluate() call).
const VIEWS = {
  crash_wide: () => { const k = DBG.WORLD.kestrel.g.position, x = k.x + 30, z = k.z + 26, p = { x: k.x - 14, z: k.z + 14, yaw: 0 };
    DBG.camOv = { pos: [x, DBG.groundH(x, z) + 11, z], look: [k.x, k.y + 1, k.z] }; DBG.teleport(p.x, p.z, p.yaw, DBG.groundH(p.x, p.z)); },
  forest: () => { const L = DBG.FOREST.list; let best = L[0], bn = -1; for (let i = 0; i < L.length; i += 3) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 400) n++; if (n > bn) { bn = n; best = t; } }
    const x = best[0] + 3, z = best[2] + 3, g = DBG.groundH(x, z); DBG.camOv = { pos: [x, g + 2.2, z], look: [x - 14, g + 3.5, z - 10] }; DBG.teleport(x, z, 0, g); },
  rift_rim: () => { const r = DBG.POI.rift, x = r.x + 20, z = r.z + 88; DBG.camOv = { pos: [x, DBG.groundH(x, z) + 6, z], look: [r.x, 8, r.z] }; DBG.teleport(x, z + 4, 0, DBG.groundH(x, z + 4)); },
  sea_horizon: () => { let d = 250; const a = 1.9; while (d < 440 && DBG.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d - 14), z = Math.sin(a) * (d - 14);
    DBG.camOv = { pos: [x, DBG.groundH(x, z) + 4, z], look: [Math.cos(a) * 1200, 20, Math.sin(a) * 1200] }; DBG.teleport(x, z, 0, DBG.groundH(x, z)); },
};
const views = (opt('views') ? String(opt('views')).split(',') : Object.keys(VIEWS));

const PAGE_LIB = () => {
  const D = window.DBG;
  const L = window.__ab = {};
  L.median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  L.measure = (ms) => new Promise((res) => {
    const r = D.renderer, ts = [];
    r.info.autoReset = false; r.info.reset();
    const f = (t) => { ts.push(t); if (t - ts[0] < ms) requestAnimationFrame(f); else done(); };
    const done = () => {
      const n = Math.max(1, ts.length - 1), dts = []; for (let i = 1; i < ts.length; i++) dts.push(ts[i] - ts[i - 1]);
      const calls = r.info.render.calls / n, tris = r.info.render.triangles / n; r.info.autoReset = true;
      res({ fps: +(1000 / L.median(dts)).toFixed(1), frameMsMedian: +L.median(dts).toFixed(2), frames: n, drawCalls: Math.round(calls), triangles: Math.round(tris) });
    };
    requestAnimationFrame(f);
  });
};

function spread(nums) { const s = [...nums].sort((a, b) => a - b), med = s[s.length >> 1]; return { median: med, min: s[0], max: s[s.length - 1] }; }

async function main() {
  const H = await openWorld({ root: ROOT, label: 'bake A/B', warm: WARM, quality: 'high', size: [1400, 800], echo: !!opt('echo'), unlimited: !opt('capped') });
  const results = { date: new Date().toISOString(), root: ROOT, views: {} };
  try {
    await H.page.evaluate(PAGE_LIB);
    const ready = await H.page.waitForFunction(() => window.BAKED && window.BAKED.ready, { timeout: 30000 }).then(() => true).catch((e) => e.message);
    H.log('BAKED.ready:', ready);
    const stats = await H.page.evaluate(() => window.BAKED.stats);
    H.log('BAKED.stats', JSON.stringify(stats));
    for (const v of views) {
      const def = VIEWS[v]; if (!def) { H.log('unknown view', v); continue; }
      await H.page.evaluate(def);
      await sleep(1200); await H.closeDialogs();
      const runState = async (name, on) => {
        await H.page.evaluate((on) => { if (window.BAKED) BAKED.setOn(on); }, on);
        await sleep(900); await H.closeDialogs();
        const reps = []; for (let k = 0; k < REPEAT; k++) reps.push(await H.page.evaluate((ms) => window.__ab.measure(ms), MEASURE_MS));
        const fps = spread(reps.map((r) => r.fps)); const mid = reps.slice().sort((a, b) => a.fps - b.fps)[reps.length >> 1];
        const shot = path.join(OUT, `${v}.${name}.png`); await H.page.screenshot({ path: shot });
        H.log(`  ${v.padEnd(12)} ${name.padEnd(6)} ${String(fps.median).padStart(5)} fps (${reps.map((r) => r.fps).join('/')}) · ${mid.drawCalls} calls · ${(mid.triangles / 1e6).toFixed(2)}M tris`);
        return { fps: fps.median, fpsSamples: reps.map((r) => r.fps), frameMsMedian: mid.frameMsMedian, drawCalls: mid.drawCalls, triangles: mid.triangles, shot };
      };
      const baked = await runState('baked', true);
      const legacy = await runState('legacy', false);
      await H.page.evaluate(() => { if (window.BAKED) BAKED.setOn(true); });
      results.views[v] = { baked, legacy, speedup: +(legacy.frameMsMedian / baked.frameMsMedian).toFixed(2), fpsGain: +(baked.fps - legacy.fps).toFixed(1), drawCallDelta: legacy.drawCalls - baked.drawCalls };
    }
    results.stats = stats;
  } finally { await H.close(); }
  fs.writeFileSync(path.join(OUT, 'ab-result.json'), JSON.stringify(results, null, 2));
  console.log('[ab] wrote', path.join(OUT, 'ab-result.json'));
  for (const [v, r] of Object.entries(results.views)) console.log(`[ab] ${v}: baked ${r.baked.fps} fps / legacy ${r.legacy.fps} fps · ${r.speedup}x frame time · ${r.drawCallDelta >= 0 ? '-' : '+'}${Math.abs(r.drawCallDelta)} draw calls`);
}
main().catch((e) => { console.error(e); process.exit(1); });
