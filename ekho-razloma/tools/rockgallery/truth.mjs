#!/usr/bin/env node
// truth.mjs <label> [<label2>]  — honest numbers from BODYCONTACT (result.json cards[].truth, cm, negative = inside the rock)
//   per action: cards, % with a non-boot part inside > 1 cm, palm gap median / min, fingers, forearm inside, torso gap distribution
//   (torso rows: expect=touch → should be 0–3 cm; expect=avoid (hands carry the contact) → should NOT touch, > 3 cm)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (l) => JSON.parse(fs.readFileSync(path.join(HERE, 'out', l, 'result.json'), 'utf8')).cards.filter((c) => c.truth);
const med = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
const pct = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]; };
const f = (x) => (x == null ? '—' : String(x));
for (const label of process.argv.slice(2)) {
  const cards = load(label); console.log(`\n=== ${label}: ${cards.length} cards with truth ===`);
  const n = cards.length, p = (k) => (n ? Math.round(100 * cards.filter(k).length / n) : 0);
  console.log(`non-boot part inside >1 cm: ${cards.filter((c) => c.truth.insideOver1).length}/${n} (${p((c) => c.truth.insideOver1)}%)  · any incl. boots >1 cm: ${p((c) => c.truth.anyInsideOver1)}%`);
  const byPart = {}; for (const c of cards) { const t = c.truth; if (t.worstInsideCm > 1 && t.worstInsidePart) { const k = t.worstInsidePart.replace(/_[lr]$/, ''); byPart[k] = (byPart[k] || 0) + 1; } }
  console.log('worst part when inside >1 cm (cards): ' + JSON.stringify(byPart) + ' · deepest ' + Math.max(0, ...cards.map((c) => c.truth.worstInsideCm || 0)) + ' cm');
  const acts = {};
  for (const c of cards) for (const [a, A] of Object.entries(c.truth.byAction || {})) { const R = acts[a] = acts[a] || { expect: A.expect, cards: 0, ins: 0, palm: [], fing: [], fore: [], torso: [], palmIn: 0, foreIn: 0, fingIn: 0 };
    R.cards++; if (c.truth.insideOver1) R.ins++; if (A.palmMed != null) { R.palm.push(A.palmMed); if (A.palmMin < -1) R.palmIn++; } if (A.fingersMed != null) { R.fing.push(A.fingersMed); if (A.fingersMin < -1) R.fingIn++; }
    if (A.foreMin != null) { R.fore.push(A.foreMin); if (A.foreMin < -1) R.foreIn++; } if (A.torsoMed != null) R.torso.push(A.torsoMed); }
  console.log('\naction'.padEnd(22) + 'cards  inside>1  palmMed  palmWorst  palm<-1  fingMed  fing<-1  foreWorst fore<-1  torso p10/med/p90  torsoExpect');
  for (const [a, R] of Object.entries(acts).sort((x, y) => y[1].cards - x[1].cards)) {
    console.log(a.padEnd(22) + String(R.cards).padEnd(7) + (Math.round(100 * R.ins / R.cards) + '%').padEnd(9) + f(med(R.palm)).padEnd(9) + f(pct(R.palm, 0)).padEnd(11) + (R.palm.length ? R.palmIn + '/' + R.palm.length : '—').padEnd(9)
      + f(med(R.fing)).padEnd(9) + (R.fing.length ? R.fingIn + '/' + R.fing.length : '—').padEnd(9) + f(pct(R.fore, 0)).padEnd(10) + (R.fore.length ? R.foreIn + '/' + R.fore.length : '—').padEnd(9)
      + (R.torso.length ? [pct(R.torso, 0.1), med(R.torso), pct(R.torso, 0.9)].join('/') : '—').padEnd(18) + f(R.expect));
  }
  const allPalm = cards.flatMap((c) => c.truth.palmGapMedCm == null ? [] : [c.truth.palmGapMedCm]);
  console.log(`\npalm median gap over cards: ${f(med(allPalm))} cm · cards with palm inside (min<-1): ${cards.filter((c) => c.truth.palmGapMinCm != null && c.truth.palmGapMinCm < -1).length}/${allPalm.length}`);
}
