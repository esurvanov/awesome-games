#!/usr/bin/env node
/* look-compare.mjs — player-eye screenshots next to the chosen reference photos + measure.py numbers.
 *
 *   node tools/look-compare.mjs [label] [--views forest,boulder,…] [--out dir] [--eval "<js>"] [--checks] [--placed] [--quality high]
 *
 * Views = QAV eye views (tools/qa/qa-views.js) + a few look-only views defined here (north_mtn, forest_far, sky, sea).
 * Writes <out>/<view>.png, <out>/measure.json and <out>/index.html (screenshot | reference photos | metric table with
 * the night_master target ranges). Default out: stand/look-compare. Runs under the benchmark lock (harness).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'look-compare';
const out = path.resolve(opt('out', path.join(OUT, label)));
// view → reference photos (references/selected.txt) and the targets.json key for measure.py
const MAP = {
  forest: { refs: ['b01', 'b03', 'b04', 'b06'], cat: 'b', title: '🌲 лес · forest' },
  forest_edge: { refs: ['b04', 'b06', 'h05'], cat: 'b', title: '🌲 опушка · forest edge' },
  forest_far: { refs: ['b03', 'b06', 'h04'], cat: 'b', title: '🌲 лес вдали · far forest' },
  boulder: { refs: ['d01', 'd02', 'd03', 'd05'], cat: 'd', title: '🪨 валун · boulder' },
  outcrop_front: { refs: ['d02', 'd05'], cat: 'd', title: '🪨 скала · outcrop' },
  grass: { refs: ['e02', 'e05', 'e06'], cat: 'e', title: '🌾 трава · grass' },
  shrubs: { refs: ['e03', 'e06', 'e02'], cat: 'e', title: '🌿 кусты · shrubs' },
  sea: { refs: ['g01', 'g02', 'g03', 'g06'], cat: 'g', title: '🧊 морской лёд · sea ice' },
  mountains: { refs: ['h04', 'h05', 'g01'], cat: 'h', title: '🏔 горы (кольцо) · mountain ring' },
  north_mtn: { refs: ['h04', 'h05'], cat: 'h', title: '🏔 горы острова · island mountains' },
  sky: { refs: ['a01', 'a02', 'a04', 'a06'], cat: 'a', title: '🌌 сияние · aurora' },
};
const views = (opt('views', Object.keys(MAP).join(','))).split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });

// look-only views (not QA invariants): defined in the page next to QAV
const EXTRA = `(() => {
  const D = DBG, V = QAV.views, POI = D.POI, gh = (x, z) => D.groundH(x, z);
  const flat = (x, z, r = 40) => { for (let k = 0; k < 60; k++) { const a = k * 2.4, d = (k / 60) * r, sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d; if (D.getH(sx, sz) > 0.8 && (!D.MODCTX.slopeAt || D.MODCTX.slopeAt(sx, sz, 1) < 14)) return [sx, sz]; } return [x, z]; };
  V.north_mtn = () => { const [x, z] = flat(POI.crash.x, POI.crash.z - 20, 40); QA.place(x, z, { look: [x, 75, Math.min(z - 200, -260)], pitch: 0.0 }); return { note: 'island mountains to the north' }; };
  V.forest_far = () => { const L = D.FOREST.list; let sx = 0, sz = 0; for (const t of L) { sx += t[0]; sz += t[2]; } const cx = sx / L.length, cz = sz / L.length;
    const a = Math.atan2(POI.crash.x - cx, POI.crash.z - cz), [x, z] = flat(cx + Math.sin(a) * 120, cz + Math.cos(a) * 120, 40); QA.place(x, z, { look: [cx, gh(cx, cz) + 6, cz], pitch: 0.06 }); return { note: 'forest from 120 m (near → impostor)' }; };
  V.sky = () => { const [x, z] = flat(POI.crash.x + 20, POI.crash.z - 30, 40); QA.place(x, z, { yaw: 3.3, pitch: -0.35 }); return { note: 'aurora over the snow' }; };
  V.sea = () => { let d = 250; const a = 0.6; while (d < 440 && D.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d - 10), z = Math.sin(a) * (d - 10);
    QA.place(x, z, { look: [Math.cos(a) * 700, 2, Math.sin(a) * 700], pitch: 0.12 }); return { note: 'sea ice from the coast' }; };
})();`;

const H = await openGame({ label: 'look ' + label, quality: opt('quality', 'high') });
const res = {};
try {
  await H.newGame();
  await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-views.js'), 'utf8'));
  await H.page.evaluate(EXTRA);
  for (const ex of argv.filter((a, i) => argv[i - 1] === '--eval')) console.log('>>', ex.slice(0, 80), JSON.stringify(await H.page.evaluate(ex)).slice(0, 4000));
  await sleep(2500);
  for (const v of views) {
    const info = await H.page.evaluate((v) => { QAV.cleanup(); const r = QAV.views[v] ? QAV.views[v]() : { skip: 'unknown' }; window.__after = r && r.after; return r ? { note: r.note, skip: r.skip } : {}; }, v);
    if (info.skip) { console.log('skip', v, info.skip); continue; }
    await sleep(2200);
    await H.page.evaluate(() => { QA.closeDialogs(); DBG.G.pause = true; });
    await sleep(250);
    const file = path.join(out, v + '.png');
    await H.page.screenshot({ path: file });
    const r = { note: info.note };
    if (flag('checks')) {
      const c = await H.page.evaluate(async () => { const r = await QA.viewChecks({ magenta: false }); return { backfaces: r.backfaces, dark: r.dark, pixels: r.pixels }; });
      r.backfaces = { holes: c.backfaces.holes, ds: c.backfaces.dsBack, top: c.backfaces.top.slice(0, 4).map((t) => t.name + ' ' + t.px) }; r.dark = c.dark;
    }
    await H.page.evaluate(() => { try { if (window.__after) window.__after(); } catch (e) { /* */ } QAV.cleanup(); });
    try { r.m = JSON.parse(execFileSync('python3', ['-B', '-W', 'ignore', '-c', `import sys,json;sys.path.insert(0,'${path.join(ROOT, 'references')}');import measure;print(json.dumps(measure.measure('${file}')))`]).toString()); } catch (e) { r.m = null; }
    res[v] = r;
    const m = r.m || {};
    console.log(`${v.padEnd(12)} Ymed ${m.Y_median} p95 ${m.Y_p95} lit/sh ${m.lit_shadow_ratio} B/R lit ${m.snow_blue_over_red_lit} sh ${m.snow_blue_over_red_shadow} lit ${m.snow_lit_rgb} sh ${m.snow_shadow_rgb} sky ${m.sky_rgb} aur ${m.aurora_rgb} mich ${m.michelson_p05_p95}` + (r.backfaces ? ` · holes ${r.backfaces.holes} ${r.backfaces.top.join(', ')}` : '') + (r.dark ? ` · dark ${r.dark.frac} ${r.dark.top.slice(0, 3).map((t) => t.name + ' ' + t.ofObject).join(', ')}` : ''));
  }
  if (flag('placed')) {
    const p = await H.page.evaluate(() => QA.placedCheck());
    res._placed = p;
    console.log('placed: floating', p.floating, JSON.stringify(p.floatingByKind.map((k) => [k.kind, k.n, k.worst.float])), '\nburied', p.buried, JSON.stringify(p.buriedByKind.map((k) => [k.kind, k.n, k.worst.buried])));
  }
  res._fps = await H.page.evaluate(async () => { DBG.G.pause = false; const t0 = performance.now(); let n = 0; await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return +(n / ((performance.now() - t0) / 1000)).toFixed(1); });
  res._errors = H.errors.slice(0, 10);
  console.log('fps (last view, 1.5 s)', res._fps, 'errors', H.errors.length, H.errors.slice(0, 3));
} finally { await H.close(); }
fs.writeFileSync(path.join(out, 'measure.json'), JSON.stringify(res, null, 1));

/* ------------------------------------------------------------------ sheet */
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', 'targets.json'), 'utf8'));
const NM = T.night_master;
const rows = [   // metric, target range (night_master targets), how to show
  ['Y_median', NM.targets.frame_Y_median, 'кадр · медиана'], ['Y_p95', NM.targets.frame_Y_p95, 'кадр · p95'],
  ['lit_shadow_ratio', NM.targets.lit_to_shadow_luminance, 'свет / тень'], ['snow_blue_over_red_lit', [1.0, 1.25], 'синева света B/R'],
  ['snow_blue_over_red_shadow', [1.3, 1.65], 'синева тени B/R'], ['michelson_p05_p95', NM.targets.global_michelson, 'контраст'],
];
const rgb = (a) => (a ? `rgb(${a.join(',')})` : 'transparent');
const refRel = (id) => path.relative(out, path.join(ROOT, 'references', 'img', id + '.jpg'));
const refM = (cat) => (T.categories[cat] || {}).measured || {};
let html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Look compare</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--bg:#0e1320;--card:#161d2e;--tx:#dfe6f3;--mut:#8b97b0;--ok:#4fd18b;--bad:#ff6b6b;--mid:#f0b54a}
body{margin:0;background:var(--bg);color:var(--tx);font:13px/1.35 system-ui,sans-serif;padding:12px}
h1{font-size:17px;margin:4px 0 12px}.v{background:var(--card);border-radius:10px;padding:10px;margin:0 0 14px}
.v h2{font-size:14px;margin:0 0 8px}.row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:8px}
.shot img{width:100%;border-radius:6px;display:block}.refs{display:grid;grid-template-columns:1fr 1fr;gap:4px}.refs img{width:100%;height:100%;max-height:150px;object-fit:cover;border-radius:4px}
table{border-collapse:collapse;width:100%;margin-top:6px}td{padding:2px 6px;border-bottom:1px solid #243049;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok)}.bad{color:var(--bad)}.sw{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:middle;margin-right:3px;border:1px solid #fff3}
@media(max-width:700px){.row{grid-template-columns:1fr}}</style></head><body><h1>🎯 Игра ↔ референсы · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</h1>`;
for (const v of views) {
  const r = res[v]; if (!r || !r.m) continue; const mp = MAP[v] || { refs: [], cat: 'night_master', title: v }, m = r.m, rm = refM(mp.cat);
  html += `<div class="v"><h2>${mp.title}</h2><div class="row"><div class="shot"><img src="${v}.png" alt="${v}"></div><div><div class="refs">${mp.refs.map((id) => `<img src="${refRel(id)}" alt="${id}" title="${id}">`).join('')}</div>
<table><tr><td></td><td class="n">игра</td><td class="n">цель</td><td class="n">фото ${mp.cat}</td></tr>`;
  for (const [k, rg, name] of rows) { const val = m[k]; const ok = val != null && val >= rg[0] && val <= rg[1];
    html += `<tr><td>${name}</td><td class="n ${val == null ? '' : ok ? 'ok' : 'bad'}">${val == null ? '—' : (ok ? '✓ ' : '✗ ') + val}</td><td class="n">${rg[0]}–${rg[1]}</td><td class="n">${rm[k] ? rm[k].median : '—'}</td></tr>`; }
  html += `<tr><td>снег свет · тень</td><td class="n"><span class="sw" style="background:${rgb(m.snow_lit_rgb)}"></span><span class="sw" style="background:${rgb(m.snow_shadow_rgb)}"></span></td><td class="n"><span class="sw" style="background:#707091"></span><span class="sw" style="background:#353a3c"></span></td><td class="n"><span class="sw" style="background:${rm.snow_lit_rgb ? '#' + rm.snow_lit_rgb.hex.slice(1) : 'transparent'}"></span><span class="sw" style="background:${rm.snow_shadow_rgb ? rm.snow_shadow_rgb.hex : 'transparent'}"></span></td></tr>`;
  html += `<tr><td>небо · сияние</td><td class="n"><span class="sw" style="background:${rgb(m.sky_rgb)}"></span><span class="sw" style="background:${rgb(m.aurora_rgb)}"></span></td><td class="n"><span class="sw" style="background:#1d3240"></span><span class="sw" style="background:#356c4b"></span></td><td class="n"><span class="sw" style="background:${rm.sky_rgb ? rm.sky_rgb.hex : 'transparent'}"></span><span class="sw" style="background:${rm.aurora_rgb ? rm.aurora_rgb.hex : 'transparent'}"></span></td></tr></table></div></div></div>`;
}
html += '</body></html>';
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('sheet', path.join(out, 'index.html'));
