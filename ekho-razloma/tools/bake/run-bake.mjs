#!/usr/bin/env node
/* run-bake.mjs — the full offline bake, step by step, each Blender run under the benchmark lock (tools/.stand.lock).
 *
 *   node tools/bake/run-bake.mjs [--blender /path/to/Blender] [--in tools/bake/out] [--steps terrain,tiles,objects,instanced,trees]
 *                                [--quick] [--extra "--samples 96"]
 *
 * Cycles saturates the GPU: an fps benchmark running at the same time would measure the bake, not the game. So every
 * step (≤ ~15 min: a terrain quadrant, a few tiles, one object atlas, …) holds the lock like a benchmark does and
 * releases it in between, so queued stand/QA runs interleave (their lock wait times out after 30 min).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock } from '../qa/hygiene.mjs';
import { GAME } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const BL = opt('blender', process.env.BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender');
const IN = path.resolve(opt('in', path.join(GAME, 'tools', 'bake', 'out')));
const STEPS = String(opt('steps', 'terrain,tiles,objects,instanced,trees')).split(',');
const EXTRA = opt('extra') ? String(opt('extra')).split(' ').filter(Boolean) : [];
if (opt('quick')) EXTRA.push('--quick');
const log = (...a) => console.log('[run-bake]', ...a);

// tile sites in batches of 4 (names from the export manifest, same rules as bake.py tile_sites)
function sites() {
  const M = JSON.parse(fs.readFileSync(path.join(IN, 'export.json'), 'utf8')).meta, P = M.pois, s = [];
  for (const k of ['crash', 'station', 'lake', 'rift', 'spireN', 'spireW', 'spireE']) if (P[k]) s.push([k, P[k].x, P[k].z]);
  const wf = M.wf || {}; if (wf.camp) s.push(['camp', wf.camp.x, wf.camp.z]); if (wf.ship) s.push(['ship', wf.ship.x, wf.ship.z]); if (wf.pier) s.push(['pier', wf.pier.x, wf.pier.z]);
  (wf.ruins || []).forEach((r, i) => s.push(['ruins' + i, r.x, r.z]));
  const out = []; for (const a of s) if (!out.some((b) => Math.hypot(a[1] - b[1], a[2] - b[2]) < 128 * 0.35)) out.push(a);
  return out.map((a) => a[0]);
}
const plan = [];
for (const st of STEPS) {
  if (st === 'terrain') for (const q of [0, 1, 2, 3]) plan.push(['terrain q' + q, ['--jobs', 'terrain', '--quad', String(q)]]);
  else if (st === 'tiles') { const S = sites(); for (let i = 0; i < S.length; i += 4) plan.push(['tiles ' + S.slice(i, i + 4).join(','), ['--jobs', 'tiles', '--sites', S.slice(i, i + 4).join(',')]]); }
  else if (st === 'objects') for (const a of ['crash', 'station', 'camp', 'misc']) plan.push(['atlas ' + a, ['--jobs', 'objects', '--only', a]]);
  else plan.push([st, ['--jobs', st]]);
}
// objects: bake.py resets the atlas list when the objects job starts; --only keeps the others (merge below)
const run = (label, args) => new Promise((ok, bad) => {
  const t0 = Date.now(), lf = path.join(IN, 'bake', 'log-' + label.replace(/[^\w]+/g, '_') + '.txt');
  fs.mkdirSync(path.dirname(lf), { recursive: true });
  const p = spawn(BL, ['-b', '--factory-startup', '-P', path.join(GAME, 'tools', 'bake', 'bake.py'), '--', '--in', IN, ...args, ...EXTRA], { stdio: ['ignore', 'pipe', 'pipe'] });
  const out = fs.createWriteStream(lf); p.stdout.pipe(out); p.stderr.pipe(out);
  p.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (/^\[bake/.test(l)) log('  ' + l); });
  p.on('exit', (c) => { log(`${label}: exit ${c} in ${((Date.now() - t0) / 60e3).toFixed(1)} min`); c === 0 ? ok() : bad(new Error(label + ' failed, see ' + lf)); });
});
for (const [label, args] of plan) {
  const release = await acquireLock('bake ' + label, { log });
  try { await run(label, args); } finally { release(); }
}
log('all steps done');
