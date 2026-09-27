#!/usr/bin/env node
/* snow-contact-cost.mjs — frame-time cost of SNOW-CONTACT (the object-pressed snow map + contact patch), A/B in one page.
 *
 *   node tools/snow-contact-cost.mjs <label> [--presets high,low] [--size 1400x800] [--dsf 1] [--rounds 3] [--ms 2500]
 *   → stand/<label>/cost.json
 * The pilot walks back and forth on open snow (W / S) under the gameplay camera: the worst case for this system (patch on
 * screen, boots pressing every frame, the fine window moving every ~2.4 m). vsync off (--unlimited), contact on / off
 * alternating (Terrain.CM.setOn), frame times from rAF deltas: median, p90, max. Takes the benchmark lock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';

const argv = process.argv.slice(2);
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'sc-cost';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const presets = String(opt('presets', 'high,low')).split(','), size = String(opt('size', '1400x800')).split('x').map(Number), dsf = Number(opt('dsf', 1));
const rounds = Number(opt('rounds', 3)), ms = Number(opt('ms', 2500));
const log = (...a) => console.log('[sc-cost]', ...a);
const dir = path.join(OUT, label); fs.mkdirSync(dir, { recursive: true });
const H = await openGame({ label: 'sc-cost ' + label, quality: presets[0], size, unlimited: true, log });
const out = { label, date: new Date().toISOString(), size, dsf, gpu: H.gpu, load: H.load, presets: {} };
try {
  if (dsf !== 1) { await H.page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: dsf }); await sleep(800); }
  await H.newGame();
  await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'snowcontact-page.js'), 'utf8'));
  await H.page.evaluate(() => { const cv = DBG.renderer.domElement; for (const el of document.body.children) if (!el.contains(cv)) el.style.visibility = 'hidden'; });
  out.canvas = await H.page.evaluate(() => { const c = DBG.renderer.domElement; return [c.width, c.height]; });
  if (opt('variants')) await H.page.evaluate((v) => { window.__scVariants = v; }, String(opt('variants')).split(','));
  if (argv.includes('--finish')) await H.page.evaluate(() => { window.__scFinish = true; });   // serialise CPU + GPU per frame: frame time ≈ CPU + GPU work
  for (const pr of presets) {
    await H.page.evaluate((p) => { if (window.AI && AI.quality) AI.quality.set(p, 99999); else DBG.setQuality(p); }, pr); await sleep(1500);
    const r = await H.page.evaluate(async (rounds, ms) => {
      const s = SC.openSnow(0.06, 0), yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); QA.place(s.x, s.z, { yaw, dist: 4.2, pitch: 0.32 }); DBG.cam.yaw = yaw; await QA.wait(1500);
      let dirK = 'KeyW'; const flip = setInterval(() => { QA.keys([dirK], false); dirK = dirK === 'KeyW' ? 'KeyS' : 'KeyW'; QA.keys([dirK], true); }, 1400); QA.keys([dirK], true);
      const gl = DBG.renderer.getContext(), fin = !!window.__scFinish; const sample = (msw) => new Promise((res) => { const d = []; let last = performance.now(); const t0 = last; const f = () => { if (fin) gl.finish(); const t = performance.now(); d.push(t - last); last = t; if (t - t0 < msw) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); });
      const st = (d) => { const a = d.slice(2).sort((x, y) => x - y); return { med: +a[a.length >> 1].toFixed(2), p90: +a[Math.floor(a.length * 0.9)].toFixed(2), max: +a[a.length - 1].toFixed(2), n: a.length }; };
      const V = (window.__scVariants || ['on', 'noRead', 'off']), res = { stats: null }, CM = Terrain.CM; for (const v of V) res[v] = [];
      const setV = (v) => { CM.setOn(v !== 'off'); CM.noProbe = v === 'noRead' || v === 'noProbe'; CM.noMirror = v === 'noRead' || v === 'noMirror'; CM.probeEvery = /^probe(\d+)$/.test(v) ? +v.slice(5) : 1; };
      for (let k = 0; k < rounds; k++) for (const v of V) {
        setV(v); await QA.wait(500); const r0 = CM.stats.recenters; const d = await sample(ms);
        res[v].push(Object.assign(st(d), { recenters: CM.stats.recenters - r0 }));
      }
      setV('on');
      clearInterval(flip); QA.release(); Terrain.CM.setOn(true);
      res.stats = { preset: DBG.Q.name, cpuMs: +Terrain.CM.stats.cpuMs.toFixed(3), patchVerts: Terrain.CM.patch ? Terrain.CM.patch.geometry.attributes.position.count : 0, res: Terrain.CM.res, ext: Terrain.CM.ext };
      return res;
    }, rounds, ms);
    const med = (a, k) => { const v = a.map((x) => x[k]).sort((x, y) => x - y); return v[v.length >> 1]; };
    r.summary = {}; for (const k of Object.keys(r)) if (Array.isArray(r[k]) && r[k].length) r.summary[k] = { med: med(r[k], 'med'), p90: med(r[k], 'p90'), max: Math.max(...r[k].map((x) => x.max)) };
    out.presets[pr] = r; log(pr, JSON.stringify(r.summary), JSON.stringify(r.stats));
  }
  out.errors = H.errors.slice(0, 10);
} finally {
  fs.writeFileSync(path.join(dir, 'cost.json'), JSON.stringify(out, null, 1)); log('→', path.join(dir, 'cost.json'));
  await H.close();
}
