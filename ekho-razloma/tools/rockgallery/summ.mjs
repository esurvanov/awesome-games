#!/usr/bin/env node
// summ.mjs <label> [<label>...]  — per-place summary of rockgallery result.json (judge numbers). First label = reference.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const labs = process.argv.slice(2);
const load = (l) => JSON.parse(fs.readFileSync(path.join(HERE, 'out', l, 'result.json'), 'utf8')).cards.filter((c) => c.judge);
const kind = (c) => String(c.spot).split('|')[0].replace(/_?\d+$/, '');
function agg(cards) {
  const n = cards.length, f = (p) => cards.filter(p).length;
  return { n, contact: f((c) => c.judge.contact), inside2: f((c) => c.judge.penCm > 2), insideS: +cards.reduce((a, c) => a + c.judge.insideS, 0).toFixed(1),
    penMax: +Math.max(0, ...cards.map((c) => c.judge.penCm)).toFixed(1), airCards: f((c) => c.judge.airS > 0.3), airS: +cards.reduce((a, c) => a + c.judge.airS, 0).toFixed(1),
    idle1: f((c) => c.judge.idleNearS > 1), tele: cards.reduce((a, c) => a + c.judge.teleports, 0), snaps: cards.reduce((a, c) => a + c.judge.snaps, 0), touchS: +cards.reduce((a, c) => a + c.judge.touchS, 0).toFixed(1) };
}
const key = (c) => [c.spot, c.side, c.scen].join('|');
let data = labs.map((l) => ({ l, cards: load(l) }));
{ const common = data.map((d) => new Set(d.cards.map(key))).reduce((a, b) => new Set([...a].filter((x) => b.has(x)))); data = data.map((d) => ({ l: d.l, cards: d.cards.filter((c) => common.has(key(c))) })); }
const line = (name, a) => name.padEnd(12) + Object.entries(a).map(([k, v]) => (k + '=' + v).padEnd(13)).join('');
console.log('ALL'); for (const d of data) console.log(line(d.l, agg(d.cards)));
const kinds = [...new Set(data[0].cards.map(kind))].sort();
for (const k of kinds) { console.log('\n' + k); for (const d of data) console.log(line(d.l, agg(d.cards.filter((c) => kind(c) === k)))); }
// per-card deltas vs the reference (keys spot|side|scen)
const ref = new Map(data[0].cards.map((c) => [key(c), c]));
for (const d of data.slice(1)) {
  const worse = [], better = [];
  for (const c of d.cards) { const r = ref.get(key(c)); if (!r) continue;
    const s = (x) => (x.judge.penCm > 2 ? 1 : 0) + (x.judge.airS > 0.3 ? 1 : 0) + (x.judge.idleNearS > 1 ? 1 : 0) + (x.judge.contact ? 0 : 1);
    if (s(c) > s(r)) worse.push(key(c)); else if (s(c) < s(r)) better.push(key(c)); }
  console.log(`\n${d.l} vs ${labs[0]}: worse ${worse.length}, better ${better.length}`); if (process.env.V) console.log(' worse: ' + worse.join('\n        ') + '\n better: ' + better.join('\n         '));
}
