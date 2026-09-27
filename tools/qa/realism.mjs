#!/usr/bin/env node
/* realism.mjs — realism rules as hard checks (REALISM-QA.md, PLAN-REALISM.md §6/§9/§14). Run by tools/qa.mjs, or alone:
 *
 *   node tools/qa/realism.mjs rules   [--rules sizes,albedo,frame,ground,texel,facet,repeat,weather] [--out f.json]
 *   node tools/qa/realism.mjs collide [--hull] [--kinds rock,boulder,...] [--dirs 4] [--n 2] [--no-cost] [--out f.json]
 *   node tools/qa/realism.mjs air     [--views forest_deep,camp] [--throttle 4] [--secs 5]
 *
 * One browser, under the shared benchmark lock (tools/qa/hygiene.mjs), closed at the end. exit 1 = a FAIL row.
 * Library: import { runRules, runCollide, runAir, injectRealism } from './realism.mjs' — each returns rows
 *   { group, check, subject, value, pass (true | false | 'warn' | null), offenders?: [names] }.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
import { injectRealism, SIZES } from './realism-common.mjs';
export { injectRealism, SIZES };

/* ------------------------------------------------------------------ Part B: exact collisions */
// kinds whose collider was a single convex hull (now exact near the pilot) + the trimesh kinds for comparison
export const HULL_KINDS = ['rock', 'st_crystal_tree', 'st_rift_crystal', 'st_rift_cluster'];
export const MESH_KINDS = ['boulder', 'rock_flat', 'rock_outcrop', 'ice_chunk', 'iceberg_small', 'st_ruin_column', 'st_ruin_wall', 'st_ruin_arch', 'st_inuksuk', 'st_cairn',
  'struct_hab_module', 'station_module', 'st_tent_polar', 'st_tent_polar_stove', 'st_snowcat', 'vehicle_rover_sev', 'tool_crate', 'st_sledge'];
export const GAP_MAX = 0.03;   // PLAN-REALISM §9: capsule ↔ visible surface ≤ 3 cm (the controller's own skin is 2 cm)

export async function runCollide(H, log = console.log, o = {}) {
  await injectRealism(H);
  const kinds = o.kinds || [...HULL_KINDS, ...MESH_KINDS], out = { kinds: {}, rows: [] };
  const mode = await H.page.evaluate(() => DBG.Passport.EXACT ? (DBG.Passport.EXACT.on ? 'exact near the pilot' : 'hull (?colhull)') : 'hull (no EXACT)');
  log('  collider mode: ' + mode);
  for (const kind of kinds) {
    const hull = HULL_KINDS.includes(kind), n = o.n || (hull ? 2 : 1), dirs = o.dirs || (hull ? 4 : 2);
    const picks = await H.page.evaluate((k, n) => QR.pick(k, n).map((e) => e.id), kind, n);
    if (!picks.length) { out.kinds[kind] = { skip: 'none placed' }; continue; }
    const R = out.kinds[kind] = { walks: [], slides: [], jump: null };
    for (const id of picks) {
      for (let d = 0; d < dirs; d++) {
        const r = await H.page.evaluate(async (id, a) => { const e = DBG.Passport.list.find((q) => q.id === id); const r = await QR.walkInto(e, a); delete r.trace; return r; }, id, d * 2 * Math.PI / dirs + 0.4);
        R.walks.push(Object.assign({ id, dir: d }, r));
      }
      if (hull || id === picks[0]) {
        const s = await H.page.evaluate(async (id) => { const e = DBG.Passport.list.find((q) => q.id === id); return QR.slideAlong(e, 1.3); }, id);
        R.slides.push(Object.assign({ id }, s));
      }
    }
    const jump = await H.page.evaluate(async (k) => { const e = QR.pick(k, 6, { filter: (e) => { const h = e.box.max[1] - DBG.groundH((e.box.min[0] + e.box.max[0]) / 2, (e.box.min[2] + e.box.max[2]) / 2); return h > 0.8 && h < 1.7; } })[0]; return e ? QR.jumpOnto(e) : { skip: 'no 0.8–1.7 m instance' }; }, kind);
    R.jump = jump;
    const stopped = R.walks.filter((w) => !w.skip && w.stopped && w.reached && w.gap != null), gaps = stopped.map((w) => w.gap);
    R.gapMax = gaps.length ? Math.max(...gaps.map(Math.abs)) : null; R.gapWorst = gaps.length ? gaps.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;
    R.gapMedian = gaps.length ? gaps.slice().sort((a, b) => a - b)[gaps.length >> 1] : null;
    R.snags = R.slides.reduce((a, s) => a + (s.stops || 0), 0); R.pops = R.slides.reduce((a, s) => a + (s.pops || 0), 0);
    const bad = stopped.filter((w) => Math.abs(w.gap) > GAP_MAX);
    log(`  ${kind.padEnd(18)} gaps ${R.walks.map((w) => w.skip ? 'skip' : !w.reached ? 'unreached ' + w.boxDist : !w.stopped ? 'no stop' : w.gap == null ? 'no hit' : w.gap.toFixed(3) + (w.gapAt ? w.gapAt.dir[0] : '') + (w.colGap != null && Math.abs(w.colGap - w.gap) > 0.01 ? '/c' + w.colGap : '')).join(' ')} · worst ${R.gapWorst} · slides ${R.slides.map((s) => s.skip || `${s.slid} m, stops ${s.stops}, pops ${s.pops}`).join(' | ')} · jump ${jump.skip || (jump.onTop ? 'on top' : 'FAIL y ' + jump.end[1] + ' / ' + jump.top)}`);
    out.rows.push({ group: 'столкновения', check: `gap capsule ↔ visible surface when stopped ≤ ${GAP_MAX * 100} cm (${mode})`, subject: kind, value: `${gaps.length}/${R.walks.length} walks stopped at it · worst ${R.gapWorst} m · median ${R.gapMedian} m` + (bad.length ? ' · ' + bad.map((w) => `#${w.id} dir ${w.dir}: ${w.gap} (${w.blocker ? w.blocker.tag : '?'})`).join(', ') : ''), pass: gaps.length ? !bad.length : null, offenders: bad.map((w) => `${kind}#${w.id}`) });
    out.rows.push({ group: 'столкновения', check: 'no seam snags sliding along (stops / vertical pops)', subject: kind, value: R.slides.map((s) => s.skip || `slid ${s.slid} m · stops ${s.stops} · pops ${s.pops}`).join(' | '), pass: R.slides.some((s) => !s.skip) ? !(R.snags || R.pops) : null });
    if (!jump.skip) out.rows.push({ group: 'столкновения', check: 'jump onto a 0.8–1.7 m instance ends on top', subject: kind, value: `h ${jump.h} · end y ${jump.end[1]} / top ${jump.top}`, pass: jump.onTop });
  }
  if (!o.noCost) {
    const spot = await H.page.evaluate(() => QR.denseSpot());
    if (spot) {
      if (o.cdp) await o.cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle || 4 });
      try { out.cost = await H.page.evaluate((s) => QR.physCost(s.x, s.z, 6000), spot); } finally { if (o.cdp) await o.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
      out.cost.spot = spot; out.cost.throttle = o.cdp ? o.throttle || 4 : 1;
      out.cost.exact = await H.page.evaluate(() => DBG.Passport.EXACT ? { n: DBG.Passport.EXACT.n, builds: DBG.Passport.EXACT.builds, ms: +DBG.Passport.EXACT.ms.toFixed(1), maxMs: +DBG.Passport.EXACT.maxMs.toFixed(2) } : null);
      log(`  physics cost (CPU ×${out.cost.throttle}, ${spot.n} rocks within 20 m): step ${out.cost.stepMean} ms (p95 ${out.cost.stepP95}) · character ${out.cost.moveMean} ms (p95 ${out.cost.moveP95}) · exact ${JSON.stringify(out.cost.exact)}`);
      out.rows.push({ group: 'столкновения', check: 'physics cost at the densest rock spot (CPU ×4): Phys.step + character move', subject: 'mean ms / frame', value: `step ${out.cost.stepMean} (p95 ${out.cost.stepP95}) · move ${out.cost.moveMean} (p95 ${out.cost.moveP95}) · exact entries ${out.cost.exact ? out.cost.exact.n : '—'} · build max ${out.cost.exact ? out.cost.exact.maxMs : '—'} ms`, pass: out.cost.stepMean + out.cost.moveMean < 4 ? true : 'warn' });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ CLI */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { openGame } = await import('./harness.mjs');
  const argv = process.argv.slice(2), mode = argv[0] || 'rules', opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
  const list = (k) => (opt(k) && opt(k) !== true ? String(opt(k)).split(',') : null);
  const extra = { rules: {}, collide: { query: opt('hull') ? '?colhull' : '' }, air: {} }[mode] || {};
  const H = await openGame(Object.assign({ label: 'realism ' + mode, quality: 'high' }, extra, mode === 'air' ? { size: [1280, 800], dpr: 2, query: '?q=air' } : {}));
  let res = null, code = 0;
  try {
    console.log('[realism] new game'); await H.newGame(); await new Promise((r) => setTimeout(r, 1500)); console.log('[realism] ' + mode);
    const cdp = await H.page.target().createCDPSession();
    if (mode === 'collide') res = await runCollide(H, console.log, { kinds: list('kinds'), dirs: +opt('dirs', 0) || undefined, n: +opt('n', 0) || undefined, noCost: !!opt('no-cost'), cdp, throttle: +opt('throttle', 4) });
    else if (mode === 'rules') res = await (await import('./realism-rules.mjs')).runRules(H, console.log, { rules: list('rules') });
    else if (mode === 'air') res = await (await import('./realism-rules.mjs')).runAir(H, console.log, { views: list('views'), cdp, throttle: +opt('throttle', 4), secs: +opt('secs', 5) });
    for (const r of res.rows) console.log(`${r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : r.pass === 'warn' ? 'WARN' : ' -- '}  ${r.subject.padEnd(22)} ${r.check} :: ${String(r.value).slice(0, 300)}`);
    code = res.rows.some((r) => r.pass === false) ? 1 : 0;
    if (H.errors.length) console.log('JS errors:', H.errors.slice(0, 5));
    const outF = opt('out') || path.join(ROOT, 'stand', 'realism-' + mode + (opt('hull') ? '-hull' : '') + '.json');
    fs.mkdirSync(path.dirname(outF), { recursive: true }); fs.writeFileSync(outF, JSON.stringify(Object.assign(res, { errors: H.errors }), null, 1)); console.log('→', outF);
  } finally { await H.close(); }
  process.exit(code);
}
