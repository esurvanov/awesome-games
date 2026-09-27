/* realism-rules.mjs — verdicts for the realism rules 1–8 (REALISM-QA.md). Measurements come from realism-page.js
 * (window.QR); every threshold lives in RULES below with its source (also tabled in QA.md).
 *   runRules(H, log, { rules })  → { rows, data }     rows: { group, check, subject, value, pass, offenders }
 *   runAir(H, log, { views, cdp, throttle, secs })   → { rows, data }   (H opened with ?q=air at 1280×800 @2x)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectRealism, SIZES } from './realism-common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const GROUP = 'реализм';
export const RULES = {
  sizes: { src: 'tools/qa/sizes.json (per-kind sources); PLAN-REALISM §6.1 ±15 %' },
  albedo: { fail: [30, 240], warn: [50, 240], snowMax: 245, src: 'PBR albedo charts: darkest natural ~30–50 sRGB (charcoal 50), fresh snow ~240–245 (racoon-artworks PBR guide; DONTNOD PBR chart)' },
  frame: { views: ['forest', 'camp', 'lake_shore', 'mountains'], target: 'night_master',
    // outside the photos' [min, max] → WARN; beyond this extra margin → FAIL (log = multiplicative, abs = additive)
    margin: { Y_median: ['log', 2], Y_p95: ['log', 2], snow_lit_Y: ['log', 2], snow_shadow_Y: ['log', 2], lit_shadow_ratio: ['log', 1.5],
      snow_blue_over_red_lit: ['abs', 0.25], snow_blue_over_red_shadow: ['abs', 0.25], dark_frac_midband: ['abs', 0.15], michelson_p05_p95: ['abs', 0.1] },
    src: 'references/targets.json night_master (17 user-selected night photos, references/measure.py method)' },
  ground: { gapMax: 0.03, buriedMax: 0.3, buriedKind: { krummholz: 0.7 }, src: 'PLAN-REALISM §6.4 (gap 0 cm, base sunk); 3 cm = one snow-contact texel; buried ≤ 30 % = existing placed-object rule (QA.md c′); krummholz grows half inside the snowpack (≤ 70 %)' },
  texel: { ratio: 3, radius: 20, src: 'PLAN-REALISM §6.5: neighbours within 20 m differ by > 3× in albedo px/m → one looks blurred next to the other (texel-density practice: one density per scene tier)' },
  facet: { theta: 20, px: 24, span: 0.4, screen: 1720, share: 0.12, src: 'smooth-shaded edge bending > 20° and > 24 px long when the object fills 40 % of a 1720 px-high Retina frame = a visible corner on the silhouette' },
  repeat: { deg: 6, scale: 0.04, near: 2.5, src: 'two copies within 2.2 × their radius (≥ 2.5 m) with < 6° rotation, < 4 % scale and the same tint read as a copy-paste' },
  weather: { src: 'PLAN-REALISM §6.8: a static prop carries top snow (snowCover / rock snow patch) and base contact grime (groundblend tGb)' },
  air: { fps: 30, throttle: 4, size: [1280, 800], dpr: 2, views: ['forest_deep', 'camp'], src: 'PLAN-REALISM §1/§10: MacBook Air 2020 Intel, 30 fps steady; CPU ×4 slowdown as the stand-in (risk 1)' },
};
const ALL = ['sizes', 'albedo', 'frame', 'ground', 'texel', 'facet', 'repeat', 'weather'];
const fmt = (x) => (x == null ? '—' : typeof x === 'number' ? +x.toFixed(3) : x);
const counts = (list, key = (x) => x) => { const m = new Map(); for (const x of list) { const k = key(x); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };

// page.evaluate with a deadline: one stuck rule must not hold the benchmark lock for everyone
async function ev(H, what, fn, arg, ms = 90000) {
  let t; const dead = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ': no answer in ' + ms / 1000 + ' s')), ms); });
  try { return await Promise.race([H.page.evaluate(fn, arg), dead]); } finally { clearTimeout(t); }
}
export async function runRules(H, log = console.log, o = {}) {
  await injectRealism(H);
  const want = o.rules || ALL, rows = [], data = {};
  const add = (check, subject, value, pass, offenders = []) => rows.push({ group: GROUP, check, subject, value, pass, offenders });

  /* 1. sizes */
  if (want.includes('sizes')) {
    const S = data.sizes = await ev(H, 'sizes', () => QR.sizes());
    const K = SIZES.kinds;
    for (const [key, spec] of Object.entries(K)) {
      const dims = ['h', 'l', 'w', 'trunkH', 'stature', 'shoulder'].filter((d) => spec[d]);
      let meas;
      if (spec.actor) meas = S.actors.filter((a) => a.id === spec.actor && !a.skip).map((a, i) => Object.assign({ kind: key, id: i }, a));
      else { const re = spec.match ? new RegExp(spec.match) : null; meas = S.rows.filter((r) => (re ? re.test(r.kind) : r.kind === key)); }
      if (!meas.length) { add('size as in life', key, 'not in the world', null); continue; }
      const bad = [];
      for (const r of meas) for (const d of dims) { const v = r[d]; if (v == null) continue; const [a, b] = spec[d]; if (v < a || v > b) bad.push({ r, d, v }); }
      const rng = dims.map((d) => { const vs = meas.map((r) => r[d]).filter((v) => v != null); return vs.length ? `${d} ${fmt(Math.min(...vs))}–${fmt(Math.max(...vs))} (want ${spec[d][0]}–${spec[d][1]})` : `${d} —`; }).join(' · ');
      add('size as in life (m)', key + ` ×${meas.length}`, rng + (bad.length ? ' · off: ' + counts(bad, (b) => `${b.r.kind} ${b.d}`).map(([k, n]) => `${k} ×${n}`).join(', ') : ''), !bad.length,
        bad.slice(0, 20).map((b) => `${b.r.kind}${b.r.id != null ? '#' + b.r.id : ''} ${b.d}=${fmt(b.v)}`));
    }
    log(`  sizes: ${rows.filter((r) => r.check.startsWith('size')).filter((r) => r.pass === false).length} kinds off`);
  }

  /* 2. albedo */
  if (want.includes('albedo')) {
    const A = data.albedo = await ev(H, 'albedo', () => QR.albedo()), C = RULES.albedo;
    const ok = A.filter((a) => !a.skip), fail = ok.filter((a) => a.v < C.fail[0] || a.v > (a.snow ? C.snowMax : C.fail[1])), warn = ok.filter((a) => !fail.includes(a) && a.v < C.warn[0]);
    const lab = (a) => `${a.mat}${a.mesh ? ' (' + a.mesh + ')' : ''} ${a.v}`;
    add(`albedo ${C.fail[0]}–${C.fail[1]} sRGB (snow ≤ ${C.snowMax})`, `${ok.length} materials`, fail.length ? fail.map(lab).join(', ') : `all inside · min ${Math.min(...ok.map((a) => a.v))} · max ${Math.max(...ok.map((a) => a.v))}`, !fail.length, fail.map(lab));
    add(`albedo strict ${C.warn[0]}–${C.warn[1]} (WARN below ${C.warn[0]})`, `${ok.length} materials`, warn.length ? warn.map(lab).join(', ') : '0', warn.length ? 'warn' : true, warn.map(lab));
    const sk = A.filter((a) => a.skip); if (sk.length) add('albedo: texture not readable', `${sk.length} materials`, sk.slice(0, 8).map((a) => a.mat).join(', '), null);
    log(`  albedo: ${ok.length} materials · FAIL ${fail.length} · WARN ${warn.length}`);
  }

  /* 3. frame vs night photos */
  if (want.includes('frame')) {
    const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'references', 'targets.json'), 'utf8'))[RULES.frame.target].measured;
    data.frame = {};
    for (const v of o.views || RULES.frame.views) {
      log('  frame view ' + v);
      const m = await ev(H, 'frame ' + v, async (v) => { QAV.cleanup && QAV.cleanup(); const r = QAV.views[v] ? QAV.views[v]() : { skip: 'no view' }; if (r && r.skip) return r; await QA.frames(45); if (r && r.after) r.after(); await QA.frames(5); return QR.frameMeasure(); }, v).catch((e) => ({ skip: e.message }));
      data.frame[v] = m; if (m.skip) { add('frame ↔ night photos', v, m.skip, null); continue; }
      let worst = true; const notes = [];
      for (const [k, [mode, mg]] of Object.entries(RULES.frame.margin)) {
        const t = T[k], x = m[k]; if (!t || x == null || t.min == null) continue;
        const lo = mode === 'log' ? t.min / mg : t.min - mg, hi = mode === 'log' ? t.max * mg : t.max + mg;
        if (x >= t.min && x <= t.max) continue;
        const st = x < lo || x > hi ? false : 'warn'; notes.push(`${k} ${x} (photos ${t.min}–${t.max}${st === false ? ', far' : ''})`);
        if (st === false) worst = false; else if (worst === true) worst = 'warn';
      }
      add('frame ↔ night photos (luminance / snow colour / contrast)', v, notes.length ? notes.join(' · ') : `all ${Object.keys(RULES.frame.margin).length} metrics inside the photos' range`, worst, notes);
    }
    log('  frame: ' + Object.keys(data.frame).join(', '));
  }

  /* 4. grounding on the drawn snow */
  if (want.includes('ground')) {
    const G = data.ground = await ev(H, 'ground', () => QR.grounding()), C = RULES.ground;
    const fl = G.rows.filter((r) => r.minGap > C.gapMax), bu = G.rows.filter((r) => r.buried > (C.buriedKind[r.kind] || C.buriedMax)), air = G.rows.filter((r) => r.air > C.airWarn && r.minGap <= C.gapMax);
    const by = (L, f) => counts(L, (r) => r.kind).map(([k, n]) => { const w = L.filter((r) => r.kind === k).sort((a, b) => f(b) - f(a))[0]; return `${k} ×${n} (worst ${fmt(f(w))} @ ${w.pos.map(Math.round)})`; }).join(', ');
    add(`base on the drawn snow: gap ≤ ${C.gapMax * 100} cm ${G.field ? '(ctx.snowField)' : '(CPU surface: no snowField)'}`, `${G.rows.length} objects`, fl.length ? by(fl, (r) => r.minGap) : '0', !fl.length, fl.map((r) => `${r.kind}#${r.id}`));
    add(`buried ≤ ${C.buriedMax * 100} % of the height`, `${G.rows.length} objects`, bu.length ? by(bu, (r) => r.buried) : '0', !bu.length, bu.map((r) => `${r.kind}#${r.id}`));
    log(`  ground: ${G.rows.length} objects · floating ${fl.length} · buried ${bu.length} · edge air ${air.length}`);
  }

  /* 4b. drawn without a collider (invisible-air's opposite: walk-through rocks) */
  if (want.includes('ground')) {
    const U = data.uncollided = await ev(H, 'uncollided', () => QR.uncollided());
    add('every drawn rock / prop / structure has a collider', 'drawn instances ≥ 0.3 m', U.length ? U.map((u) => `${u.name} ×${u.n} (largest r ${u.r} m @ ${u.at.map(Math.round)})`).join(', ') : '0', !U.length, U.map((u) => u.name));
    log(`  uncollided: ${U.reduce((a, u) => a + u.n, 0)} instances`);
  }

  /* 5. texel density */
  if (want.includes('texel')) {
    const X = await ev(H, 'texel', () => QR.texel()), C = RULES.texel;
    const CS = C.radius, grid = new Map(), key = (x, z) => Math.floor(x / CS) + ',' + Math.floor(z / CS);
    for (const q of X) { const k = key(q.p[0], q.p[2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q); }
    const flags = new Map(), per = new Map();
    for (const q of X) {
      const gx = Math.floor(q.p[0] / CS), gz = Math.floor(q.p[2] / CS), nb = [];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const u of grid.get((gx + i) + ',' + (gz + j)) || []) if (u.name !== q.name && Math.hypot(u.p[0] - q.p[0], u.p[2] - q.p[2]) < CS) nb.push(u.d);
      const P = per.get(q.name) || { name: q.name, n: 0, d: q.d, tex: q.tex, tree: q.tree, bad: 0, ratios: [] }; P.n++; per.set(q.name, P);
      if (nb.length < 2) continue; nb.sort((a, b) => a - b); const med = nb[nb.length >> 1], r = q.d / med; P.ratios.push(r);
      if (r > C.ratio || r < 1 / C.ratio) P.bad++;
    }
    const L = [...per.values()].map((P) => { P.ratios.sort((a, b) => a - b); P.med = P.ratios.length ? P.ratios[P.ratios.length >> 1] : null; return P; });
    const off = L.filter((P) => P.ratios.length && P.bad / P.ratios.length > 0.5);
    data.texel = L.map((P) => ({ name: P.name, pxPerM: P.d, tex: P.tex, instances: P.n, neighbourRatio: P.med && +P.med.toFixed(2), flagged: P.bad }));
    add(`texel density within ${C.ratio}× of neighbours (${C.radius} m)`, `${L.length} meshes`, off.length ? off.map((P) => `${P.name} ${Math.round(P.d)} px/m ×${P.med.toFixed(1)} of neighbours`).join(', ') : `all within · ${Math.round(Math.min(...L.map((P) => P.d)))}–${Math.round(Math.max(...L.map((P) => P.d)))} px/m`, !off.length, off.map((P) => P.name));
    log(`  texel: ${L.length} meshes · outliers ${off.length}`);
  }

  /* 6a. faceting */
  if (want.includes('facet')) {
    const C = RULES.facet, F = data.facet = await ev(H, 'facet', (c) => QR.facet(c), C);
    const off = F.filter((f) => f.facetedShare > C.share);
    add(`faceting: smooth edges bending > ${C.theta}° and > ${C.px} px (object at ${C.span * 100} % of the frame) ≤ ${C.share * 100} %`, `${F.length} models`,
      off.length ? off.sort((a, b) => b.facetedShare - a.facetedShare).map((f) => `${f.names[0]} ${Math.round(f.facetedShare * 100)} % (${f.tris} tris)`).join(', ') : `max ${Math.round(Math.max(...F.map((f) => f.facetedShare)) * 100)} %`, !off.length, off.map((f) => f.names[0]));
    log(`  facet: ${F.length} models · faceted ${off.length}`);
  }

  /* 6b. repetition */
  if (want.includes('repeat')) {
    const C = RULES.repeat, P = data.repeat = await ev(H, 'repeat', (c) => QR.repetition(c), C);
    add('no identical neighbours (same model, rotation < 6°, scale < 4 %, tint)', 'instanced props', P.length ? counts(P, (p) => p.name).map(([k, n]) => `${k} ×${n} (e.g. ${P.find((p) => p.name === k).a.map(Math.round)})`).join(', ') : '0 pairs', !P.length, P.slice(0, 20).map((p) => `${p.name} @${p.a.map(Math.round)}`));
    log(`  repeat: ${P.length} identical pairs`);
  }

  /* 6c. weathering */
  if (want.includes('weather')) {
    const W = data.weather = await ev(H, 'weather', () => QR.weathering());
    const FANT = /^(spire|echo|orm|st_rift|st_crystal|heart)/;   // fantasy set pieces carry their own look
    const Wr = W.filter((w) => !FANT.test(w.kind)), noSnow = Wr.filter((w) => w.compiled && !w.snow), noGrime = Wr.filter((w) => w.compiled && !w.grime);
    const lab = (w) => `${w.kind}:${w.mat}`;
    add('weathering: top snow on static props', `${W.length} materials`, noSnow.length ? counts(noSnow, (w) => w.kind).map(([k, n]) => `${k} ×${n}`).join(', ') : 'all', !noSnow.length, noSnow.map(lab));
    add('weathering: base contact grime on static props', `${W.length} materials`, noGrime.length ? counts(noGrime, (w) => w.kind).map(([k, n]) => `${k} ×${n}`).join(', ') : 'all', !noGrime.length, noGrime.map(lab));
    log(`  weather: ${W.length} materials · no snow ${noSnow.length} · no grime ${noGrime.length}`);
  }
  return { rows, data };
}

/* 7. air profile fps (its own browser: ?q=air, 1280×800 @2x, CPU ×4) */
export async function runAir(H, log = console.log, o = {}) {
  await injectRealism(H);
  const C = RULES.air, rows = [], data = {};
  const has = await H.page.evaluate(() => ({ air: !!(DBG.QUALITY && DBG.QUALITY.air), q: DBG.Q && DBG.Q.name, lowend: !!window.LowEnd }));
  data.preset = has;
  if (!has.air) { rows.push({ group: GROUP, check: `air profile ≥ ${C.fps} fps (CPU ×${C.throttle}, 1280×800 @2x)`, subject: 'air', value: 'no QUALITY.air preset yet', pass: null }); return { rows, data }; }
  if (has.q !== 'air') await H.page.evaluate(() => DBG.setQuality('air'));
  // deep forest: the densest tree cell (same spot as tools/qa/texunits.mjs)
  await H.page.evaluate(() => { if (!QAV.views.forest_deep) QAV.views.forest_deep = () => { const L = DBG.FOREST.list; let best = null;
    for (let i = 0; i < L.length; i += 2) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 900) n++; if (!best || n > best.n) best = { t, n }; }
    const c = best.t; for (let r = 1.5; r < 12; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) { const x = c[0] + Math.sin(a) * r, z = c[2] + Math.cos(a) * r; if (!L.some((u) => (u[0] - x) ** 2 + (u[2] - z) ** 2 < 2.2)) { QA.place(x, z, { look: [c[0], DBG.groundH(c[0], c[2]) + 3, c[2]] }); return { note: 'deep forest' }; } } return { skip: 'no spot' }; }; });
  for (const v of o.views || C.views) {
    await H.page.evaluate(async (v) => { QAV.cleanup && QAV.cleanup(); QAV.views[v](); await QA.frames(30); }, v);
    if (o.cdp) await o.cdp.send('Emulation.setCPUThrottlingRate', { rate: o.throttle || C.throttle });
    let r;
    try {
      // frames the game actually DREW (LowEnd.stats().drawn counts one per rendered frame): the 30 fps cap and the idle
      // loop skip rAF ticks, so rAF timestamps measured the display refresh (59.9 on every run), not the game
      r = await H.page.evaluate((ms) => new Promise((res) => {
        const cnt = () => (window.LowEnd && LowEnd.stats ? (LowEnd.stats() || {}).drawn : null);
        const ts = [], c0 = cnt(), t0 = performance.now(); let last = c0;
        const f = () => { const c = cnt(), t = performance.now(); if (c !== last) { for (let k = last; k < c; k++) ts.push(t); last = c; }
          if (t - t0 < ms) { requestAnimationFrame(f); return; }
          const n = c0 == null ? null : c - c0, d = []; for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]); d.sort((a, b) => a - b);
          const st = window.LowEnd && LowEnd.stats ? LowEnd.stats() || {} : {};
          res({ fps: n == null ? null : +(n * 1000 / (t - t0)).toFixed(1), drawn: n, low1: d.length ? +(1000 / d[Math.floor(d.length * 0.99)]).toFixed(1) : null, counter: c0 == null ? 'none (no LowEnd)' : 'LowEnd drawn', scale: st.scale ?? null, cap: st.cap ?? null, q: DBG.Q.name }); };
        requestAnimationFrame(f); }), (o.secs || 5) * 1000);
    } finally { if (o.cdp) await o.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
    data[v] = r; log(`  air ${v}: ${r.fps} drawn fps (${r.drawn} frames, 1 % low ${r.low1}) · preset ${r.q} · scale ${r.scale}`);
    rows.push({ group: GROUP, check: `air profile ≥ ${C.fps} drawn fps (CPU ×${o.throttle || C.throttle}, ${H.size.join('×')} @${o.dpr || 2}x)`, subject: v, value: `${r.fps} fps drawn (${r.drawn} frames in ${o.secs || 5} s, ${r.counter}) · 1 % low ${r.low1} · render scale ${r.scale ?? '—'}`, pass: r.fps == null ? null : r.fps >= C.fps * 0.97 });
  }
  return { rows, data };
}
