// Compare a `node tools/qa/realism.mjs collide --out f.json` run with the pre-refactor baseline (tools/refactor/baseline/collide-base.json).
//   node tools/refactor/collide-compare.mjs <run.json>
// The baseline is a run of the ORIGINAL game (commit 12f312f, with the AI layer). Per-row verdicts of this net are noisy by themselves: the placement of
// structures differs between runs and the AI layer's quality director and events act during the walks. Measured: original↔original flips 6–9 rows of 49
// and 31 / 36 FAIL rows; the data-model version 35 / 37 FAIL rows, 6–10 flips against the original. The gate fails only on a clear shift:
// more than 16 flipped rows, or 10+ more FAIL rows than the baseline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (p) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return new Map((j.rows || j).filter((r) => r && r.check).map((r) => [r.check + ' | ' + r.subject, r])); };
const A = load(path.join(HERE, 'baseline', 'collide-base.json')), B = load(path.resolve(process.argv[2] || ''));
let flips = 0; const fails = (m) => [...m.values()].filter((r) => r.pass === false).length;
for (const k of new Set([...A.keys(), ...B.keys()])) if ((A.get(k) || {}).pass !== (B.get(k) || {}).pass) flips++;
const fa = fails(A), fb = fails(B), bad = flips > 16 || fb - fa >= 10;
console.log(`collide: ${B.size} rows · flipped vs baseline ${flips} (noise level 6–10) · FAIL ${fa} → ${fb}`);
console.log(bad ? '❌ collision shift' : '✅ within noise'); process.exit(bad ? 1 : 0);
