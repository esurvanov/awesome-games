#!/usr/bin/env node
/* texunits.mjs — texture-unit budget check (TEXUNITS.md). Visits views so every material compiles, then lists every
 * compiled program's sampler count vs the GPU limits and the console "Trying to use N texture units" warnings.
 *   node tools/qa/texunits.mjs [--size 1512x860] [--dpr 2] [--quality high] [--presets all|low,med,...] [--views forest,boulder,...] [--out file.json] [--no-lock]
 * exit 1 = FAIL (a program over budget or the three.js warning seen).
 * Library use: import { texUnitVerdict } from './texunits.mjs' → verdict from a QA.texUnits() result + console warnings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEXWARN = /Trying to use (\d+) texture units|TEXBUDGET/;
export function texUnitVerdict(tu, warnings = [], errors = []) {
  const warn = [...warnings, ...errors].filter((s) => TEXWARN.test(s));
  const over = (tu && tu.over) || [];
  const pass = !!tu && over.length === 0 && warn.length === 0;
  return { pass, limits: tu && tu.limits, programs: tu && tu.programs, over: over.map((p) => ({ total: p.total, frag: p.frag, vert: p.vert, materials: p.materials.slice(0, 6), samplers: p.samplers })),
    maxTotal: tu && tu.top && tu.top[0] ? tu.top[0].total : null, warnings: [...new Set(warn)].slice(0, 20),
    note: !tu ? 'QA.texUnits() failed' : pass ? `all ${tu.programs} programs ≤ ${tu.limits.frag} units (max ${tu.top[0] && tu.top[0].total})` : `${over.length} program(s) over budget, ${warn.length} warning line(s)` };
}

export const TEX_VIEWS = ['forest_deep', 'forest', 'forest_edge', 'boulder', 'outcrop_front', 'grass', 'shrubs', 'station_door', 'crate_close', 'kestrel_side', 'lake_shore', 'camp', 'ruins', 'rift_rim', 'mountains', 'pilot_hands', 'stags', 'fox'];
export const TEX_PRESETS = ['low', 'med', 'high', 'ultra'];

// visit views (compiles their materials) then measure; H from harness.openGame, qa-views.js injected by the caller or here
// presets: every quality preset in turn (programs from earlier presets stay in renderer.info.programs while their
// materials keep them) — the budget must hold for all of them, the player's machine may pick any
export async function runTexUnits(H, views = TEX_VIEWS, log = console.log, presets = null) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (!(await H.page.evaluate(() => !!window.QAV))) await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-views.js'), 'utf8'));
  // deep forest: the densest tree cell (≥ 20 trees within 30 m), pilot among the trunks
  await H.page.evaluate(() => { QAV.views.forest_deep = QAV.views.forest_deep || (() => { const L = DBG.FOREST.list; let best = null;
    for (let i = 0; i < L.length; i += 2) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 900) n++; if (!best || n > best.n) best = { t, n }; }
    const c = best.t; for (let r = 1.5; r < 12; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) { const x = c[0] + Math.sin(a) * r, z = c[2] + Math.cos(a) * r;
      if (!L.some((u) => (u[0] - x) ** 2 + (u[2] - z) ** 2 < 2.2)) { QA.place(x, z, { look: [c[0], DBG.groundH(c[0], c[2]) + 3, c[2]] }); return { note: 'deep forest' }; } } return { skip: 'no spot' }; }); });
  const before = await H.page.evaluate(() => DBG.Q && DBG.Q.name);
  for (const pr of presets || [null]) {
    if (pr) { await H.page.evaluate((q) => DBG.setQuality(q), pr); log('  preset ' + pr); }
    for (const v of views) {
      try { await H.page.evaluate(async (v) => { QAV.cleanup && QAV.cleanup(); const r = QAV.views[v] ? QAV.views[v]() : null; await QA.frames(40); if (r && r.after) r.after(); }, v); }
      catch (e) { log('  view ' + v + ' failed: ' + e.message.slice(0, 120)); }
    }
    await H.page.evaluate(() => { const R = DBG.renderer, prev = R.getRenderTarget(); try { if (DBG.post && DBG.post.sceneRT) R.setRenderTarget(DBG.post.sceneRT); R.compile(DBG.scene, DBG.camera); } finally { R.setRenderTarget(prev); } });
  }
  if (presets && before) await H.page.evaluate((q) => DBG.setQuality(q), before);
  // + compile every material of every visible object (not only the ones in some view's frustum), into the scene target
  await H.page.evaluate(() => { const R = DBG.renderer, prev = R.getRenderTarget(); try { if (DBG.post && DBG.post.sceneRT) R.setRenderTarget(DBG.post.sceneRT); R.compile(DBG.scene, DBG.camera); } finally { R.setRenderTarget(prev); } });
  await H.page.evaluate(() => QA.frames(20));
  const tu = await H.page.evaluate(() => QA.texUnits());
  return { tu, verdict: texUnitVerdict(tu, H.warnings, H.errors) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { openGame } = await import('./harness.mjs');
  const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
  const size = String(opt('size', '1400x800')).split('x').map(Number);
  const H = await openGame({ label: 'texunits', size, dpr: +opt('dpr', 1), quality: opt('quality', 'high'), lock: !opt('no-lock'), query: opt('query', '') });
  let code = 1;
  try {
    await H.newGame();
    const views = opt('views') ? String(opt('views')).split(',') : TEX_VIEWS;
    const presets = opt('presets') ? (opt('presets') === true || opt('presets') === 'all' ? TEX_PRESETS : String(opt('presets')).split(',')) : null;
    const { tu, verdict } = await runTexUnits(H, views, console.log, presets);
    console.log(`limits: fragment ${tu.limits.frag} · vertex ${tu.limits.vert} · combined ${tu.limits.comb} · programs ${tu.programs}`);
    for (const p of tu.top) console.log(`${p.over ? 'OVER' : '  ok'} total ${String(p.total).padStart(2)} (v ${p.vert} / f ${p.frag})  ${p.name}  ${p.materials.slice(0, 3).join(' | ')}`);
    for (const p of tu.over) console.log('\nOVER', p.total, p.name, '\n  mats:', p.materials.join(' | '), '\n  samplers:', p.samplers.join(', '));
    console.log('\nwarnings:', verdict.warnings.length ? verdict.warnings.join('\n  ') : 'none');
    if (tu.runtime) console.log('runtime guard:', JSON.stringify(tu.runtime).slice(0, 600));
    console.log(verdict.pass ? 'PASS' : 'FAIL', '—', verdict.note);
    if (opt('out')) fs.writeFileSync(String(opt('out')), JSON.stringify({ tu, verdict, errors: H.errors }, null, 1));
    code = verdict.pass ? 0 : 1;
  } finally { await H.close(); }
  process.exit(code);
}
