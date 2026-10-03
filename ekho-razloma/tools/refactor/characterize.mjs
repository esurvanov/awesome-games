// Characterization snapshot for the domain refactor (docs/architecture/migration-plan.ru.html).
//   node tools/refactor/characterize.mjs snap <label>          → stand/refactor/<label>.json
//   node tools/refactor/characterize.mjs diff <labelA> <labelB> → prints every difference, exit 1 when any
// Dumps what the refactor must not change: Passport contents, creatures, story stages, save contents, weather, module order.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, OUT } from '../qa/harness.mjs';

const DIR = path.join(OUT, 'refactor');
const [cmd, a, b] = process.argv.slice(2);

async function page() {
  const r = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const v3 = (o) => (o ? { x: r(o.x), y: r(o.y), z: r(o.z) } : null);
  const D = window.DBG;
  // wait until the footprint queue is empty and the passport has stopped changing (streamed hulls settle with time)
  { let last = -1, still = 0; for (let i = 0; i < 120 && still < 6; i++) { await new Promise((q) => setTimeout(q, 500)); const n = D.Passport.pendingFootprints + '/' + D.Passport.list.length + '/' + D.Passport.list.filter((e) => e.exact).length; still = n === last ? still + 1 : 0; last = n; } }
  // 'debris' pieces appear and vanish with timing, so they stay out of the snapshot
  const passport = D.Passport.list.filter((e) => e.alive !== false && e.name !== 'debris').map((e) => {
    const b = e.box || null;
    return { name: String(e.name).replace(/#\d+$/, ''), role: e.role, shape: e.shape || null, family: e.family || null, vol: { colliders: (e.colliders || []).length, circles: (e.circles || []).length, geo: e.geo ? e.geo.v.length : 0, exact: !!e.exact }, trunk: e.trunk ? v3(e.trunk) : null, pass: e.pass ? { x: r(e.pass.x), z: r(e.pass.z), r: r(e.pass.r) } : null,
      box: b && b.min ? { min: [].concat(b.min.x !== undefined ? [b.min.x, b.min.y, b.min.z] : Array.from(b.min)).map(r), max: [].concat(b.max.x !== undefined ? [b.max.x, b.max.y, b.max.z] : Array.from(b.max)).map(r) } : null,
      c0: e.circles && e.circles[0] ? { x: r(e.circles[0].x), z: r(e.circles[0].z), r: r(e.circles[0].r) } : null };
  }).map((p) => { const c = p.c0 || p.trunk || p.pass || { x: 0, z: 0 }; p.at = `${p.name}@${Math.round(c.x)},${Math.round(c.z)}`;   // whole metres: float noise must not reorder the list
     return p; })
    .sort((p, q) => (p.at < q.at ? -1 : p.at > q.at ? 1 : JSON.stringify(p) < JSON.stringify(q) ? -1 : 1));   // ids and #N depend on async load order: key by kind and place
  const volTotals = passport.reduce((t, p) => { for (const k in p.vol) t[k] = (t[k] || 0) + (+p.vol[k] || 0); return t; }, {});
  // coverage: every kind has a family, and the registered role agrees with CORE.roleOf (phase 2.2)
  const cov = { noFamily: [], roleMismatch: [], byFamily: {} };
  passport.forEach((p) => { if (!p.family) { if (!cov.noFamily.includes(p.name)) cov.noFamily.push(p.name); } else cov.byFamily[p.family] = (cov.byFamily[p.family] || 0) + 1;
    const want = window.CORE && window.CORE.roleOf ? window.CORE.roleOf(p.name) : null; const k = p.name + ':' + p.role + '≠' + want; if (want && want !== p.role && !cov.roleMismatch.includes(k)) cov.roleMismatch.push(k); });
  const beings = {}; D.Passport.beings().forEach((b) => { const k = b.family + '/' + b.kind; beings[k] = (beings[k] || 0) + 1; });
  const kinds = {}; passport.forEach((p) => { const k = p.name; kinds[k] = (kinds[k] || 0) + 1; });
  const r0 = (n) => Math.round(n / 2) * 2;   // creatures drift a little between runs: compare on a 2 m grid
  const stags = D.STAGS.map((s) => ({ x: r0(s.x), z: r0(s.z), st: s.st }));
  const fox = { x: r0(D.fox.x), z: r0(D.fox.z), st: D.fox.st, joined: D.fox.joined };
  const enemies = D.enemies.map((e) => ({ x: r(e.x), z: r(e.z), st: e.st, hp: e.hp, zone: e.zone && (e.zone.id || e.zone.name || true) }));
  const boss = D.boss ? { x: r(D.boss.x || 0), z: r(D.boss.z || 0), hp: D.boss.hp, dead: !!D.boss.dead } : null;
  const sk = { x: r(D.sk.x), z: r(D.sk.z), unlocked: D.sk.unlocked, mounted: D.sk.mounted };
  const stages = D.STAGES.map((s, i) => { let t = null; try { t = s.tgt ? v3(s.tgt()) : null; } catch (e) { t = 'err'; } return { i, ch: s.ch, text: s.text, tgt: t }; });
  const G = {}; for (const k of ['mode', 'stage', 'hasTool', 'hasCell', 'shards', 'echoes', 'deaths', 'ending', 'riding', 'aurora']) G[k] = D.G[k];
  let save = null; try { D.save(); save = D.store.get('eor-save', null); } catch (e) { save = 'err:' + e.message; }
  return { passport: { count: passport.length, kinds, items: passport, coverage: cov }, beings, creatures: { stags, fox, enemies, boss, sk, orm: D.MODCTX.orm ? v3(D.MODCTX.orm.pos) : null },
    story: { G, stages, zones: D.ZONES.length }, save, weather: { storm: r(D.WX.storm) },
    modules: D.MODS.map((m) => ({ name: m.name, order: m.order })), player: v3(D.player) };
}

function flat(o, p = '', out = {}) {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) flat(o[k], p ? p + '.' + k : k, out); else out[p] = o;
  return out;
}

if (cmd === 'snap') {
  const H = await openGame({ label: 'characterize', quality: 'high', cold: true });
  try {
    await H.newGame();
    const snap = await H.page.evaluate(page);
    snap.errors = H.errors.slice(0, 20); snap.loader = H.loader;
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, a + '.json'), JSON.stringify(snap, null, 1));
    console.log(`snapshot ${a}: passport ${snap.passport.count} · stags ${snap.creatures.stags.length} · enemies ${snap.creatures.enemies.length} · modules ${snap.modules.length} · errors ${snap.errors.length}`);
  } finally { await H.close(); }
} else if (cmd === 'diff') {
  // kinds placed by modules/structures.js: their spot differs between identical runs (placement depends on async load order,
  // from centimetres up to tens of metres) — compare name and count only. Everything else must match.
  const WOBBLE = /^(st_|echo\d+$|kestrel)/;
  const read = (l) => JSON.parse(fs.readFileSync(path.join(DIR, l + '.json'), 'utf8'));
  const ja = read(a), jb = read(b); let n = 0; const say = (...m) => { n++; if (n <= 60) console.log(...m); };
  // passport items are matched by kind and place (nearest unused entry within 0.6 m), not by list index: one rock rounding the other way
  // would otherwise shift every index after it and report hundreds of false differences
  const ctr = (it) => it.c0 || it.trunk || it.pass || { x: 0, z: 0 };
  const stable = (j) => j.passport.items.filter((it) => !WOBBLE.test(it.name));
  const A = stable(ja), B = stable(jb), used = new Set();
  const near = (p, q) => Math.hypot(ctr(p).x - ctr(q).x, ctr(p).z - ctr(q).z);
  const close = (x, y, t) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= t : JSON.stringify(x) === JSON.stringify(y));
  for (const p of A) {
    let best = -1, bd = 0.6;
    B.forEach((q, i) => { if (!used.has(i) && q.name === p.name && q.role === p.role && q.shape === p.shape) { const d = near(p, q); if (d <= bd) { bd = d; best = i; } } });
    if (best < 0) { say('missing in B:', p.name, p.role, JSON.stringify(ctr(p))); continue; }
    used.add(best); const q = B[best];
    if (p.box && q.box) { for (const w of ['min', 'max']) p.box[w].forEach((v, i) => { if (!close(v, q.box[w][i], 0.15)) say(`${p.name}@${Math.round(ctr(p).x)},${Math.round(ctr(p).z)} box.${w}.${i}:`, v, '→', q.box[w][i]); }); }
    else if (JSON.stringify(p.box) !== JSON.stringify(q.box)) say(p.name, 'box presence differs');
  }
  B.forEach((q, i) => { if (!used.has(i)) say('extra in B:', q.name, q.role, JSON.stringify(ctr(q))); });
  // everything else: flat compare (passport items and the wobbling kinds are handled above / by count)
  const rest = (j) => { const c = JSON.parse(JSON.stringify(j)); delete c.passport.items; return flat(c); };
  const RA = rest(ja), RB = rest(jb);
  const same = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= 0.06 : JSON.stringify(x) === JSON.stringify(y));
  for (const k of new Set([...Object.keys(RA), ...Object.keys(RB)])) if (!/\.vol\.|\.at$|\.family$|^passport\.coverage|^beings|^save\.time$/.test(k) && !same(RA[k], RB[k])) say(k, ':', JSON.stringify(RA[k]), '→', JSON.stringify(RB[k]));
  console.log(n ? `${n} differences` : 'no differences'); process.exit(n ? 1 : 0);
} else { console.log('usage: snap <label> | diff <a> <b>'); process.exit(2); }
