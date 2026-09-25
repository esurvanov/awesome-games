// Offline world-placement validator: describes placed objects in short text and asks TypeSafe (jev) to score
// physical plausibility 1–5. Writes tools/reports/world-validation.{json,md} with the worst items.
//
//   node tools/validate-world.mjs [--dump server/cache/world-dump.json] [--max 50] [--dry]
//
// Get a dump: run `node server/server.mjs`, open http://localhost:8790/tools/dump-world.html (or headless Chrome),
// or call AI.dumpWorld(ctx) in the game console. Token use is kept small: code pre-filters by geometry,
// samples a few normal items as a baseline, adds 3 synthetic control items, and sends ONE batched request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemOne, loadKey, USD_PER_INPUT_TOKEN } from '../server/typesafe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const DUMP = path.resolve(arg('dump', path.join(ROOT, 'server/cache/world-dump.json')));
const MAX = +arg('max', 50), DRY = process.argv.includes('--dry');
const OUT = path.join(HERE, 'reports');

/* ---------- label dictionary: raw scene names → what the object is, and how it is meant to sit ---------- */
const KNOWN = [
  [/Barrel_01/i, 'metal fuel barrel', 'stands on the ground'], [/wooden_crate/i, 'wooden crate', 'stands on the ground'], [/military_crate/i, 'military crate', 'stands on the ground'],
  [/propane/i, 'propane tank', 'stands on the ground'], [/HDU_lowRez/i, 'prefab habitat module (building)', 'rests on flat ground'], [/^guam$/i, 'radome dome (building)', 'rests on flat ground'],
  [/^dish$/i, 'radio dish antenna', 'stands on the ground'], [/MMSEV/i, 'expedition rover vehicle', 'wheels on the ground'], [/street_lamp/i, 'street lamp post', 'post planted in the ground'],
  [/boulder/i, 'large boulder', 'partly sunk into the ground is natural'], [/^icosahedron/i, 'rock', 'partly sunk into the ground is natural'], [/bark/i, 'spruce tree (trunk)', 'trunk base in the ground'],
  [/spruce tree/i, 'spruce tree', 'trunk base in the ground'], [/stone_fire_pit/i, 'stone campfire ring', 'lies flat on the ground'], [/ship_kestrel/i, 'crashed spaceship wreck', 'crashed, partly dug into the snow is natural'],
  [/cargo_crate/i, 'cargo container next to the wreck', 'stands on the ground'], [/power_cell/i, 'glowing power cell pickup on lake ice', 'a pickup that hovers slightly by design'],
  [/^skimmer$/i, 'hover-bike', 'hovers ~0.7 m above ground by design'], [/^fox$/i, 'fox (animal)', 'stands on the ground'], [/^stag/i, 'stag (deer)', 'stands on the ground'],
  [/^player$|pelvis/i, 'player character', 'stands on the ground'], [/wf_clutter_grass/i, 'grass tuft', 'grows from the ground'], [/wf_clutter_shrub/i, 'small shrub', 'grows from the ground'],
  [/wf_clutter_stone/i, 'small stone', 'lies on the ground'], [/wf_clutter_shard/i, 'ice shard', 'sticks out of the ground or ice'], [/wf_clutter_wood/i, 'fallen log or stump', 'lies on the ground'],
  [/group of 9/i, 'ancient stone ruin (arch with an echo stone)', 'stands on the ground; ruins may be half-buried'], [/group of 2$/i, 'glowing crystal shard pickup with a light halo', 'hovers near the ground by design'],
];
const SKIP = /leaves|wf_birds|wf_gusts|wf_flags|^box$|^mesh#inst|group of 32/i; // canopy parts, sky/fx systems, unlabelled helpers

function describe(it) {
  const k = KNOWN.find(([re]) => re.test(it.label)); if (!k) return null;
  const [, what, rule] = k;
  const gap = it.gap, slope = it.slopeDeg;
  const gapTxt = gap > 0.15 ? `its lowest point is ${gap.toFixed(1)} m ABOVE the ground under its centre (a gap)` : gap < -0.3 ? `its lowest point is ${(-gap).toFixed(1)} m BELOW the ground surface (sunk in)` : 'it touches the ground';
  const slopeTxt = slope >= 35 ? `very steep ground (${slope}°)` : slope >= 20 ? `steep ground (${slope}°)` : slope >= 10 ? `gently sloping ground (${slope}°)` : `flat ground (${slope}°)`;
  const size = `${it.size[0].toFixed(1)}×${it.size[1].toFixed(1)}×${it.size[2].toFixed(1)} m`;
  const water = it.water ? ' The ground under it is below sea level (sea ice / water).' : '';
  const uneven = Math.abs(it.floatMax - it.sinkMax) > 1.5 ? ` Ground under its footprint varies (one side ${it.floatMax.toFixed(1)} m gap, other side ${Math.max(0, it.sinkMax).toFixed(1)} m buried).` : '';
  return { what, text: `A ${what} (${size}) on ${slopeTxt}; ${gapTxt}.${uneven}${water} Normal placement: ${rule}.`, rule };
}
function suspicion(it, rule) {
  const hover = /hover|floats/.test(rule), sunkOk = /sunk|dug|buried/.test(rule);
  let s = 0;
  if (!hover) s += Math.max(0, it.gap - 0.15) * 3;
  if (!sunkOk) s += Math.max(0, -it.gap - 0.4) * 1.5;
  s += Math.max(0, it.slopeDeg - (/tree|rock|boulder|shard|grass|shrub|stone/.test(rule + it.label) ? 38 : 18)) / 6;
  if (it.water && !/shard|ship|stone/.test(it.label)) s += 2;
  return s;
}

const CONTROLS = [
  { id: 'ctl_tent', text: 'A canvas tent (2.2×1.7×3.4 m) on very steep ground (35°); its lowest point is 0.9 m ABOVE the ground under its centre (a gap). Normal placement: pitched on flat ground.', expect: 'bad' },
  { id: 'ctl_barrel', text: 'A metal fuel barrel (0.6×0.9×0.6 m) on flat ground (2°); its lowest point is 1.2 m ABOVE the ground under its centre (a gap). Normal placement: stands on the ground.', expect: 'bad' },
  { id: 'ctl_crate', text: 'A wooden crate (0.9×0.9×0.9 m) on flat ground (3°); it touches the ground. Normal placement: stands on the ground.', expect: 'good' },
];

/* ---------- main ---------- */
if (!fs.existsSync(DUMP)) { console.error('No dump at ' + DUMP + '\nOpen http://localhost:8790/tools/dump-world.html with the server running, or pass --dump file.json'); process.exit(1); }
const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
const pool = [];
for (const it0 of dump.items || []) {
  if (SKIP.test(it0.label)) continue;
  // over the sea the walkable surface is the sea ice at y=0, not the seabed (older dumps measured the seabed)
  const it = it0.groundY < 0 ? { ...it0, gap: +(it0.gap + it0.groundY).toFixed(2), floatMax: +(it0.floatMax + it0.groundY).toFixed(2), sinkMax: +(it0.sinkMax - it0.groundY).toFixed(2), slopeDeg: 0, groundY: 0 } : it0;
  const d = describe(it); if (!d) continue;
  pool.push({ ...it, desc: d.text, what: d.what, sus: suspicion(it, d.rule) });
}
pool.sort((a, b) => b.sus - a.sus);
const suspicious = pool.filter((p) => p.sus > 0.3).slice(0, Math.max(0, MAX - 8 - CONTROLS.length));
let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const normal = pool.filter((p) => p.sus <= 0.3).sort(() => rng() - 0.5).slice(0, 8);
const sample = [...suspicious, ...normal];
console.log(`dump: ${dump.count} items · describable ${pool.length} · suspicious ${pool.filter((p) => p.sus > 0.3).length} · sending ${sample.length} + ${CONTROLS.length} controls`);

const items = {}; sample.forEach((p) => { items['i' + p.id] = p.desc; }); CONTROLS.forEach((c) => { items[c.id] = c.text; });
const questions = {};
for (const k of Object.keys(items)) questions[k] = { type: 'score', instructions: `Placed 3D object \`items.${k}\` in a snowy arctic island game. How physically plausible is this placement? Judge only the placement (contact with ground, slope, floating, sinking), not the object itself.`,
  criteria: ['clearly broken: floating in the air, badly buried, or impossible on this slope', 'implausible: most players would notice something wrong', 'questionable: slightly off', 'plausible', 'natural and correct'] };
if (DRY) { for (const [k, v] of Object.entries(items).slice(0, 12)) console.log(k, '·', v); console.log('… dry run, no API call'); process.exit(0); }

const key = loadKey(); if (!key) { console.error('TYPESAFE_API_KEY not set (env or .env)'); process.exit(1); }
const t0 = Date.now();
const r = await systemOne({ key, state: { game: 'Snowy arctic island, third-person adventure. Objects were placed by a procedural generator.', items }, questions, deadlineMs: 30000, maxRetries: 3 });
const ms = Date.now() - t0, usd = r.usage.input_tokens * USD_PER_INPUT_TOKEN;
const scoreOf = (k) => r.answers[k] ? +(r.answers[k].score + 1).toFixed(2) : null; // legend 0..4 → 1..5
const rows = sample.map((p) => ({ id: p.id, what: p.what, label: p.label, x: p.x, z: p.z, poi: p.poi, gap: p.gap, slopeDeg: p.slopeDeg, suspicion: +p.sus.toFixed(2), score: scoreOf('i' + p.id), confidence: r.answers['i' + p.id] ? +r.answers['i' + p.id].confidence.toFixed(2) : null, desc: p.desc }))
  .sort((a, b) => a.score - b.score);
const controls = CONTROLS.map((c) => ({ id: c.id, expect: c.expect, score: scoreOf(c.id), pass: c.expect === 'bad' ? scoreOf(c.id) <= 2.5 : scoreOf(c.id) >= 3.5 }));
const worst = rows.filter((x) => x.score <= 2.5);
const report = { at: new Date().toISOString(), dump: path.relative(ROOT, DUMP), dumpItems: dump.count, sent: sample.length + CONTROLS.length, model: r.model, ms, tokens: r.usage, usd: +usd.toFixed(6), controls, worst, all: rows };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'world-validation.json'), JSON.stringify(report, null, 1));
const md = [
  `# World placement check`, '',
  `| 📦 dump | 📨 sent | ⏱ | 🪙 tokens | 💵 | ✅ controls |`, `|---|---|---|---|---|---|`,
  `| ${dump.count} | ${report.sent} | ${ms} ms | ${r.usage.input_tokens} | $${usd.toFixed(5)} | ${controls.filter((c) => c.pass).length}/${controls.length} |`, '',
  `## 🔴 Worst (score ≤ 2.5 of 5)`, '', `| score | object | where | gap m | slope | x, z |`, `|---|---|---|---|---|---|`,
  ...worst.map((w) => `| ${w.score} | ${w.what} | ${w.poi} | ${w.gap} | ${w.slopeDeg}° | ${w.x}, ${w.z} |`),
  worst.length ? '' : '_none_', '',
  `## 🧪 Controls`, '', ...controls.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.id} (expect ${c.expect}) → ${c.score}`), '',
  `## All scored`, '', `| score | object | gap | slope | suspicion |`, `|---|---|---|---|---|`, ...rows.map((w) => `| ${w.score} | ${w.what} | ${w.gap} | ${w.slopeDeg}° | ${w.suspicion} |`),
].join('\n');
fs.writeFileSync(path.join(OUT, 'world-validation.md'), md + '\n');
console.log(`scored ${rows.length} + ${controls.length} controls in ${ms} ms · ${r.usage.input_tokens} tokens · $${usd.toFixed(5)}`);
console.log('controls:', controls.map((c) => `${c.id}=${c.score}${c.pass ? '✓' : '✗'}`).join(' '));
console.log('worst:'); for (const w of worst.slice(0, 10)) console.log(`  ${w.score}  ${w.what} @${w.poi} gap ${w.gap} slope ${w.slopeDeg}° (${w.x}, ${w.z})`);
console.log('→ tools/reports/world-validation.md');
