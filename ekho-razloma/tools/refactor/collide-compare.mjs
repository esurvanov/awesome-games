// Compare a `node tools/qa/realism.mjs collide --out f.json` run with the pre-refactor baseline (tools/refactor/baseline/collide-base.json).
//   node tools/refactor/collide-compare.mjs <run.json>
// Per-row verdicts of this net are noisy by themselves: placement of structures differs from run to run, so identical code flips 6–9 of 49 rows
// (measured: old↔old 8, new↔new 7, old↔new 6–9). The gate therefore fails only on a clear shift: more than 14 flipped rows, or 7+ more FAIL rows than the baseline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (p) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return new Map((j.rows || j).filter((r) => r && r.check).map((r) => [r.check + ' | ' + r.subject, r])); };
const A = load(path.join(HERE, 'baseline', 'collide-base.json')), B = load(path.resolve(process.argv[2] || ''));
let flips = 0; const fails = (m) => [...m.values()].filter((r) => r.pass === false).length;
for (const k of new Set([...A.keys(), ...B.keys()])) if ((A.get(k) || {}).pass !== (B.get(k) || {}).pass) flips++;
const fa = fails(A), fb = fails(B), bad = flips > 14 || fb - fa >= 7;
console.log(`collide: ${B.size} rows · flipped vs baseline ${flips} (noise level 6–9) · FAIL ${fa} → ${fb}`);
console.log(bad ? '❌ collision shift' : '✅ within noise'); process.exit(bad ? 1 : 0);
