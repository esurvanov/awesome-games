/* Module "rock-lab" — a test ground for the pilot ↔ rock interaction, only with `?rocklab` in the URL (no flag: nothing).
 *
 *  Copies of the real rocks (the drawn parts of one mid-size instance per kind, same geometry + material, and a Passport
 *  entry built from the same world-space vertices in the same order — so the interaction passport, the exact-collider
 *  stream, BVH snapping and modules/rock-brain.js treat a copy exactly like the original) are put on locally flat, open
 *  ground near a quiet part of the island, each with ≥ 14 m of free ground around it (the run-up of the gallery's run
 *  scenario). Plus: a gap (two rocks, 0.8 m drawn clearance), a low flat seat (0.45 m), a rock on a slope. The ground
 *  vegetation pools (tufts / shrubs / decals) and WorldFill clutter are hidden in this mode so nothing covers the contact.
 *
 *  FROZEN (ARCH-INTERACT.md step 1): the layout is built only after the world has settled (the Passport list unchanged for
 *  4 s — async model loads decide what is "occupied"), each spot goes to its fixed centre from LAYOUT (version below), and
 *  the result carries a fingerprint (ROCKLAB.hash: spot ids + centres + rock heights) so two loads can be compared. A
 *  baseline is only comparable with a run of the same ROCKLAB.version + hash.
 *  Scenes beyond one copy per kind: seat (flat 0.45 m), seat_uneven (0.5 m, tilted top), gap (0.7 m), slope, ledge (a
 *  0.6 m face: knee / foot), overhang (a tall face leaning over the approach from side 0: duck), drop (a flat top 1.2 m:
 *  step / jump down, scenario `down`), dome (a rounded 1.1 m boulder).
 *
 *  window.ROCKLAB = { on, ready, version, hash, spots, err, stats } — spots in tools/rockgallery/page.js format (id, label,
 *  kind, e, e2, x, z, r, size, h, spread, ang0, lab: true, scens: extra scenarios). `node tools/rockgallery/run.mjs <label> --lab`.
 */
(function () {
  const ON = /[?&]rocklab\b/.test(location.search);
  const VERSION = 'lab-v1';
  const LAB = window.ROCKLAB = { on: ON, ready: false, version: VERSION, hash: null, spots: [], err: null, stats: {}, site: null };
  if (!ON) return;
  let C = null, T3 = null, tries = 0, hideT = 0, settleN = -1, settleT = 0;
  const base = (n) => String(n || '').replace(/#\d+$/, '');
  const kindKey = (e) => base(e.name) + '|' + (e.geo ? e.geo.vn : 0);
  const center = (e) => { const b = e.box; return { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 }; };
  const rad = (e) => { const b = e.box; return Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2; };
  const height = (e) => e.box.max[1] - e.box.min[1];
  const KINDS = ['boulder|2845', 'rock_flat|2521', 'rock_outcrop|4648', 'rock|2515', 'rock|4648', 'rock|4716'];
  const SITE = { x: -100, z: 100, R: 260 };   // the quietest gently rolling part of the island (few solids / trunks, far from POIs)
  let seq = 9000;

  /* ---------------------------------------------------------------- ground */
  // ground spread on the rock's own footprint + the ring the pilot stands on (inner), and out to the run-up (outer)
  function ringSpread(x, z, r) {
    let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    for (const rr of [0, r * 0.5, r + 1.5, r + 4, r + 8]) for (let k = 0; k < (rr ? 12 : 1); k++) {
      const a = k * Math.PI / 6, h = C.getH(x + Math.sin(a) * rr, z + Math.cos(a) * rr);
      lo2 = Math.min(lo2, h); hi2 = Math.max(hi2, h); if (rr <= r + 1.5) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
    }
    return { spread: hi - lo, outer: hi2 - lo2, lo: lo2 };
  }
  // snow ground all round (no lake / sea ice, no bare rock)
  function dry(x, z, R) {
    for (const rr of [0, R * 0.5, R]) for (let k = 0; k < (rr ? 8 : 1); k++) { const a = k * Math.PI / 4, s = C.surfaceAt(x + Math.sin(a) * rr, z + Math.cos(a) * rr); if (s !== 'snow' && s !== 'deep_snow') return false; }
    return true;
  }
  // anything already there (Passport solids / trunks / props, and the lab's own copies), as circles
  let OCC = null;
  function occupied() {
    if (OCC) return OCC;
    OCC = [];
    for (const e of C.Passport.list) if (e.alive && e.box && e.role !== 'trigger' && e.role !== 'passable') { const c = center(e); OCC.push({ x: c.x, z: c.z, r: e.role === 'trunk' ? Math.max(e.trunk ? e.trunk.r : 0.3, 3.2) : rad(e) }); }   // trunks: their crown
    return OCC;
  }
  function freeAt(x, z, r, clear) { for (const o of occupied()) if (Math.hypot(o.x - x, o.z - z) < o.r + r + clear) return false; return true; }
  // a spot for a rock of radius r: locally flat (or sloped), dry, free ground; nearest to the site centre first
  let GRID = null;   // candidate centres, nearest to the site first
  // LAYOUT[version][spot id] = fixed centre. Empty for an id → the search below (then printed in ROCKLAB.stats.layout so it
  // can be pasted here and frozen).
  // lab-v1: found by the search on a settled world (2026-09-29) and frozen here
  const LAYOUT = { 'lab-v1': { "boulder|2845": { x: -87, z: 110 }, "rock_flat|2521": { x: -105, z: 83 }, "rock_outcrop|4648": { x: -195, z: 182 }, "rock|2515": { x: -66, z: 125 }, "rock|4648": { x: -36, z: 221 }, "rock|4716": { x: 90, z: 248 }, "seat": { x: -129, z: -52 }, "seat_uneven": { x: 132, z: 143 }, "drop": { x: -90, z: 92 }, "gap": { x: 111, z: 242 }, "slope": { x: -72, z: 89 }, "ledge": { x: -39, z: 59 }, "dome": { x: -84, z: 44 }, "overhang": { x: -123, z: 191 } } };
  function findSpot(r, o = {}) {
    const fx = o.id && LAYOUT[VERSION] && LAYOUT[VERSION][o.id];
    if (fx) { const g = ringSpread(fx.x, fx.z, r); return { x: fx.x, z: fx.z, d: 0, spread: g.spread, fixed: true }; }
    if (!GRID) { GRID = []; for (let i = -SITE.R; i <= SITE.R; i += 3) for (let j = -SITE.R; j <= SITE.R; j += 3) { const d = Math.hypot(i, j), x = SITE.x + i, z = SITE.z + j; if (d <= SITE.R && Math.hypot(x, z) < 360) GRID.push({ x, z, d }); } GRID.sort((a, b) => a.d - b.d); }
    const sp = o.slope ? null : [0.4, 0.6, 0.9];
    for (const lim of sp || [0]) for (const q of GRID) {
      const { x, z } = q;
      if (C.POI.lake && Math.hypot(x - C.POI.lake.x, z - C.POI.lake.z) < 80) continue;   // the frozen lake is flat, but it is ice
      if (!freeAt(x, z, r, o.clear || 14)) continue;
      const g = ringSpread(x, z, r); if (g.lo < 1.2) continue;
      if (o.slope ? (g.spread < 1.4 || g.spread > 3.5) : (g.spread > lim || g.outer > lim * 2.5)) continue;
      if (!dry(x, z, r + 4)) continue;
      if (o.id) LAB.stats.layout[o.id] = { x, z };
      return { x, z, d: q.d, spread: g.spread };
    }
    return null;
  }

  /* ---------------------------------------------------------------- the drawn parts of one Passport entry */
  // a scene mesh (or one instance of an instanced mesh) belongs to the entry when its vertices ARE the entry's vertices
  // (Passport keeps them in world space): vertex 0 / middle / last of the part, transformed, found in the entry's set
  function drawnParts(e) {
    const V = e.geo.v, q = (x) => Math.round(x * 200), key = (x, y, z) => q(x) + ',' + q(y) + ',' + q(z), set = new Set();
    for (let k = 0; k < e.geo.vn; k++) set.add(key(V[k * 3], V[k * 3 + 1], V[k * 3 + 2]));
    const b = e.box, v = new T3.Vector3(), W = new T3.Matrix4(), Mi = new T3.Matrix4(), bs = new T3.Sphere(), out = [];
    const near = (s) => s.center.x > b.min[0] - s.radius && s.center.x < b.max[0] + s.radius && s.center.z > b.min[2] - s.radius && s.center.z < b.max[2] + s.radius;
    const match = (g, M) => {
      const P = g.attributes.position, n = P.count; if (!n || n > e.geo.vn) return false;
      for (const k of [0, n >> 1, n - 1]) { v.fromBufferAttribute(P, k).applyMatrix4(M); if (!set.has(key(v.x, v.y, v.z))) return false; }
      return true;
    };
    C.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.userData.rockLab) return;
      if (/^(veg_|wf_|fx|sky|terrain|sea)/i.test(o.name || '')) return;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      o.updateWorldMatrix(true, false);
      if (o.isInstancedMesh) {
        for (let k = 0; k < o.count; k++) {
          o.getMatrixAt(k, Mi); W.multiplyMatrices(o.matrixWorld, Mi); bs.copy(g.boundingSphere).applyMatrix4(W); if (!near(bs)) continue;
          if (match(g, W)) out.push({ o, k, W: W.clone() });
        }
      } else { bs.copy(g.boundingSphere).applyMatrix4(o.matrixWorld); if (near(bs) && match(g, o.matrixWorld)) out.push({ o, k: -1, W: o.matrixWorld.clone() }); }
    });
    return out;
  }

  /* ---------------------------------------------------------------- one copy */
  // M = where the copy goes: T(to) · Ry(yaw) · S(1, sy, 1) · T(−bottom centre of the source)
  // R = Rx(tilt.rx) · Rz(tilt.rz) · Ry(yaw) (world-frame tilt after the turn); the lowest vertex after R sits at to.y
  function rockRot(yaw, tilt) { const R = new T3.Matrix4(); if (tilt) R.makeRotationX(tilt.rx || 0).multiply(new T3.Matrix4().makeRotationZ(tilt.rz || 0)); return R.multiply(new T3.Matrix4().makeRotationY(yaw)); }
  function copyRock(src, parts, to, yaw, sy, bury, tilt, us = 1) {
    const c = center(src), y0 = src.box.min[1];
    const L = rockRot(yaw, tilt).multiply(new T3.Matrix4().makeScale(us, sy, us)).multiply(new T3.Matrix4().makeTranslation(-c.x, -y0, -c.z));
    let lo = 0; if (tilt) { lo = Infinity; const w = new T3.Vector3(), V0 = src.geo.v; for (let k = 0; k < src.geo.vn; k++) { w.set(V0[k * 3], V0[k * 3 + 1], V0[k * 3 + 2]).applyMatrix4(L); if (w.y < lo) lo = w.y; } }
    const M = new T3.Matrix4().makeTranslation(to.x, to.y - lo, to.z).multiply(L);
    // the Passport entry: the same vertices in the same order (interact passport anchors, kind key = name|vertex count)
    const V = src.geo.v, P = new Float32Array(V.length), v = new T3.Vector3();
    for (let k = 0; k < src.geo.vn; k++) { v.set(V[k * 3], V[k * 3 + 1], V[k * 3 + 2]).applyMatrix4(M); P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z; }
    const e = C.Passport.register({ positions: P, indices: src.geo.i }, 'solid', Object.assign({}, src.opts, { cell: undefined, rockLab: true, name: base(src.name) + '#' + (++seq), shape: src.shape }));
    // the drawn copy: same geometry + material; instanced parts stay instanced (same shader variant as the original)
    const meshes = [];
    for (const p of parts) {
      const W = new T3.Matrix4().multiplyMatrices(M, p.W); let m;
      if (p.o.isInstancedMesh) {
        m = new T3.InstancedMesh(p.o.geometry, p.o.material, 1); m.setMatrixAt(0, W); m.instanceMatrix.needsUpdate = true;
        if (p.o.instanceColor) { const col = new T3.Color(); p.o.getColorAt(p.k, col); m.instanceColor = new T3.InstancedBufferAttribute(new Float32Array(3), 3); m.setColorAt(0, col); }
      } else { m = new T3.Mesh(p.o.geometry, p.o.material); m.matrixAutoUpdate = false; m.matrix.copy(W); m.matrixWorldNeedsUpdate = true; }
      m.name = 'rocklab_' + base(src.name); m.userData.rockLab = true; m.frustumCulled = false; m.castShadow = p.o.castShadow; m.receiveShadow = p.o.receiveShadow;
      C.scene.add(m); meshes.push(m);
    }
    OCC && OCC.push({ x: to.x, z: to.z, r: rad(e) });
    return { e, meshes, bury };
  }
  // the ground the copy sits on: lowest of the footprint's samples minus the source's own burial (rocks are seated
  // 12–20 % under the snow in the game — structures.js seatY)
  function burialOf(e) {
    const b = e.box, c = center(e); let lo = Infinity;
    for (let k = 0; k < 9; k++) { const a = k * Math.PI / 4, rr = k === 8 ? 0 : rad(e) * 0.6; lo = Math.min(lo, C.getH(c.x + Math.sin(a) * rr, c.z + Math.cos(a) * rr)); }
    return clamp(lo - b.min[1], 0.03, height(e) * 0.35);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function groundUnder(x, z, r) { let lo = Infinity; for (let k = 0; k < 9; k++) { const a = k * Math.PI / 4, rr = k === 8 ? 0 : r * 0.6; lo = Math.min(lo, C.getH(x + Math.sin(a) * rr, z + Math.cos(a) * rr)); } return lo; }
  // SRC[version][kind] = the centre of the island instance each copy is made from (frozen: "the median-size instance"
  // depends on how many instances have loaded yet — a restart under load picked another one → another lab)
  const SRC = { 'lab-v1': { "boulder|2845": { x: 182.21, z: -21.68 }, "rock_flat|2521": { x: 107.06, z: -122.25 }, "rock_outcrop|4648": { x: -63.35, z: -271.67 }, "rock|2515": { x: -181.24, z: -241.68 }, "rock|4648": { x: 7.28, z: -243.87 }, "rock|4716": { x: 261.27, z: 117.7 } } };
  function source(kind) {
    const list = C.Passport.list.filter((e) => e.alive && e.role === 'solid' && e.geo && kindKey(e) === kind && !e.opts.rockLab);
    if (!list.length) return null;
    const fx = SRC[VERSION] && SRC[VERSION][kind];
    if (fx) { let best = null, bd = 0.5; for (const e of list) { const c = center(e), d = Math.hypot(c.x - fx.x, c.z - fx.z); if (d < bd) { bd = d; best = e; } } return best; }
    // not frozen yet: a mid-size instance of the kind
    list.sort((a, b) => rad(a) - rad(b)); return list[Math.floor(list.length / 2)];
  }
  function spotRec(id, label, kind, e, x, z, extra) {
    return Object.assign({ id, label, kind, e, x, z, r: rad(e), size: +(rad(e) * 2).toFixed(1), h: +(height(e)).toFixed(2), spread: 0, ang0: 0, lab: true }, extra || {});
  }

  /* ---------------------------------------------------------------- build */
  function build() {
    const t0 = performance.now(), spots = [], st = LAB.stats; st.parts = {}; st.layout = {};
    const srcs = {}; st.src = {}; for (const k of KINDS) { srcs[k] = source(k); if (!srcs[k]) throw new Error('no source ' + k); const c = center(srcs[k]); st.src[k] = { x: +c.x.toFixed(2), z: +c.z.toFixed(2) }; }
    const partsOf = {}; for (const k of KINDS) { partsOf[k] = drawnParts(srcs[k]); st.parts[k] = partsOf[k].length; if (!partsOf[k].length) throw new Error('no drawn parts for ' + k); }
    const place = (k, o = {}) => {
      const us = o.us || 1, s = srcs[k], r = rad(s) * (o.rs || us), f = findSpot(r, Object.assign({ id: k }, o)); if (!f) throw new Error('no free ground for ' + (o.id || k) + (o.slope ? ' (slope)' : ''));
      const sy = (o.sy || 1) * us, bury = o.bury !== undefined ? o.bury : burialOf(s), y = groundUnder(f.x, f.z, r) - bury * sy;
      const cp = copyRock(s, partsOf[k], { x: f.x, y, z: f.z }, o.yaw || 0, sy, bury * sy, o.tilt, us);
      return { cp, f };
    };
    // one per kind
    for (const k of KINDS) {
      const { cp, f } = place(k);
      spots.push(spotRec(k, k.split('|')[0] + ' ' + height(cp.e).toFixed(1) + ' м', k, cp.e, f.x, f.z, { spread: +f.spread.toFixed(2) }));
    }
    // seat: the flat rock, scaled and lifted until its flat top is 0.45 m over the snow along its edges (measured with
    // downward rays on the drawn triangles; the box height is not the seat height — the rock is seated into the snow)
    const flat = (id, target, level, tilt0, word, extra) => {
      const k = 'rock_flat|2521', s = srcs[k], gh = (x, z) => (C.groundH ? C.groundH(x, z) : C.getH(x, z));
      const f = findSpot(rad(s), { id }); if (!f) throw new Error('no free ground for ' + id);
      const probe = (e) => {
        const b = e.box, hits = [];
        for (let x = b.min[0]; x <= b.max[0]; x += 0.08) for (let z = b.min[2]; z <= b.max[2]; z += 0.08) {
          const h = window.INTERACT.castOn(e, x, b.max[1] + 0.5, z, 0, -1, 0, 3); if (h && h.normal.y > 0.85) hits.push({ x, z, y: h.point.y });
        }
        if (!hits.length) return null;
        const ys = hits.map((h) => h.y).sort((p, q) => p - q), top = ys[Math.floor(ys.length * 0.7)];
        const cx = hits.reduce((a, h) => a + h.x, 0) / hits.length, cz = hits.reduce((a, h) => a + h.z, 0) / hits.length;
        // per side (+z, +x, −z, −x = the gallery's sides 0..3): the top along the last 0.45 m before that edge (where the
        // thighs rest), its flatness, and the snow 0.35 m outside the edge (where the feet are)
        const sides = [0, 1, 2, 3].map((k2) => { const a = k2 * Math.PI / 2, ux = Math.sin(a), uz = Math.cos(a);
          let far = -Infinity; for (const h of hits) far = Math.max(far, (h.x - cx) * ux + (h.z - cz) * uz);
          const band = hits.filter((h) => { const d = (h.x - cx) * ux + (h.z - cz) * uz, sd = Math.abs((h.x - cx) * uz - (h.z - cz) * ux); return d > far - 0.45 && sd < 0.25; });
          if (!band.length) return { side: k2, hCm: null, depthCm: 0 };
          const by = band.map((h) => h.y).sort((p, q) => p - q), ty = by[band.length >> 1], flatCm = Math.round((by[Math.floor(by.length * 0.9)] - by[Math.floor(by.length * 0.1)]) * 100);
          const g = gh(cx + ux * (far + 0.35), cz + uz * (far + 0.35));
          return { side: k2, hCm: Math.round((ty - g) * 100), flatCm, depthCm: 45 }; });
        return { top, sides, n: hits.length };
      };
      let cp = null, pr = null, sy = target / height(s), dy = 0; const tilt = { rx: tilt0 ? tilt0.rx : 0, rz: tilt0 ? tilt0.rz : 0 };
      for (let it = 0; it < 8; it++) {
        const bury = burialOf(s) * sy, y = groundUnder(f.x, f.z, rad(s)) - bury + dy;
        cp = copyRock(s, partsOf[k], { x: f.x, y, z: f.z }, 0, sy, bury, tilt); pr = probe(cp.e); st.seatIter = it + 1;
        if (!pr) break;
        if (pr.sides.some((q) => q.hCm === null)) break;
        const h = pr.sides.map((q) => q.hCm / 100), mean = h.reduce((a, v) => a + v, 0) / h.length;
        if ((Math.max(...h) - Math.min(...h) < 0.05 || !level) && Math.abs(mean - target) < 0.015 || it === 7) break;
        for (const mesh of cp.meshes) C.scene.remove(mesh); C.Passport.remove(cp.e);
        // level the edges: +z edge higher than −z → turn about x (positive rx lowers +z); +x higher than −x → negative rz
        const span = Math.max(0.8, rad(s) * 1.4);
        if (level) { tilt.rx = clamp(tilt.rx + Math.atan((h[0] - h[2]) / span) * 0.6, -0.25, 0.25); tilt.rz = clamp(tilt.rz - Math.atan((h[1] - h[3]) / span) * 0.6, -0.25, 0.25); }
        dy += target - mean;
      }
      st[id] = { tiltDeg: [Math.round(tilt.rx * 57.3), Math.round(tilt.rz * 57.3)], sides: pr ? pr.sides : null };
      const tc = Math.round(target * 100), best = pr ? pr.sides.filter((q) => q.hCm !== null).reduce((a, q) => (Math.abs(q.hCm - tc) < Math.abs(a.hCm - tc) ? q : a)) : null;
      spots.push(spotRec(id, word + ' ' + (best ? (best.hCm / 100).toFixed(2) : '?') + ' м', k, cp.e, f.x, f.z, Object.assign({ spread: +f.spread.toFixed(2), seatSides: pr && pr.sides }, extra || {})));
    };
    flat('seat', 0.45, true, null, 'сиденье', { scens: ['sit'] });
    flat('seat_uneven', 0.5, false, { rx: 0.14, rz: -0.08 }, 'неровное сиденье', { scens: ['sit'] });
    flat('drop', 1.2, true, null, 'спуск с', { scens: ['down'] });
    // gap: two copies of one rock kind, the SAME steep face of each turned to the other (B = A + 180°), 0.72 m of drawn
    // clearance at body height (0.4 / 0.8 / 1.2 m over the snow) along ≥ 1.5 m of corridor. The kind + yaw are chosen by
    // how flat and vertical that face is (its +x extreme per 0.2 m height band × 0.15 m slice, from the drawn vertices)
    {
      const gh = (x, z) => (C.groundH ? C.groundH(x, z) : C.getH(x, z));
      const cands = [], NZ = 10, NH = 5;   // cells: 5 height bands (0.4–1.4 m) × 10 slices (1.5 m of corridor)
      for (const k of ['boulder|2845', 'rock|4716', 'rock|4648', 'rock_outcrop|4648']) {
        const s = srcs[k], V = s.geo.v, c = center(s), bury = burialOf(s);
        if (height(s) - bury < 1.7) continue;
        const loc = new Float32Array(s.geo.vn * 3); for (let q = 0; q < s.geo.vn; q++) { loc[q * 3] = V[q * 3] - c.x; loc[q * 3 + 1] = V[q * 3 + 1] - s.box.min[1]; loc[q * 3 + 2] = V[q * 3 + 2] - c.z; }
        const Mt = new T3.Matrix4(), w = new T3.Vector3(), tv = new Float32Array(s.geo.vn * 3);
        for (let yi = 0; yi < 72; yi++) for (let ri = -8; ri <= 8; ri++) {
          const yaw = yi * Math.PI / 36, tilt = { rx: 0, rz: ri * 0.06 }; Mt.copy(rockRot(yaw, tilt));
          let lo = Infinity; for (let q = 0; q < s.geo.vn; q++) { w.set(loc[q * 3], loc[q * 3 + 1], loc[q * 3 + 2]).applyMatrix4(Mt); tv[q * 3] = w.x; tv[q * 3 + 1] = w.y; tv[q * 3 + 2] = w.z; if (w.y < lo) lo = w.y; }
          const f = new Float32Array(NZ * NH).fill(-Infinity);
          for (let q = 0; q < s.geo.vn; q++) {
            const x = tv[q * 3], ly = tv[q * 3 + 1] - lo - bury, z = tv[q * 3 + 2]; if (ly < 0.4 || ly >= 1.4 || Math.abs(z) >= 0.75) continue;
            const i = Math.floor((ly - 0.4) / 0.2) * NZ + Math.floor((z + 0.75) / 0.15); if (x > f[i]) f[i] = x;
          }
          let miss = 0, fmax = -Infinity; for (const v of f) { if (v === -Infinity) miss++; else fmax = Math.max(fmax, v); } if (miss > 4) continue;
          // the rest of the rock (3.5 m of corridor each way, 0–2 m up) must not stick out past the face into the corridor
          let out = -Infinity; for (let q = 0; q < s.geo.vn; q++) { const ly = tv[q * 3 + 1] - lo - bury, az = Math.abs(tv[q * 3 + 2]); if (ly > 0.05 && ly < 2 && az >= 0.75 && az < 3.5 && tv[q * 3] > out) out = tv[q * 3]; }
          let fmin = Infinity; for (const v of f) if (v !== -Infinity) fmin = Math.min(fmin, v);
          if (out > fmax + 0.02) continue;
          cands.push({ k, yaw, tilt, bury, f, own: fmax - fmin });
        }
      }
      // the corridor width in cell (h, z) = off − fA(h, z) − fB(h, −z) (B is turned 180°: its local z runs the other way).
      // Best pair = the smallest spread of fA + fB over the cells both have; the two rocks may be different kinds.
      cands.sort((p, q) => p.own - q.own); cands.length = Math.min(cands.length, 240);   // the flattest single faces (the pair search is n²)
      const pairs = [];
      for (const A of cands) for (const Bc of cands) {
        let lo = Infinity, hi = -Infinity, n = 0;
        for (let h = 0; h < NH; h++) for (let z = 0; z < NZ; z++) { const a = A.f[h * NZ + z], b = Bc.f[h * NZ + (NZ - 1 - z)]; if (a === -Infinity || b === -Infinity) continue; const v = a + b; n++; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (n >= NZ * NH - 6 && hi - lo < 0.6) pairs.push({ A, B: Bc, spread: hi - lo, maxX: hi / 2 });
      }
      if (!pairs.length) throw new Error('no rock face for the gap');
      pairs.sort((p, q) => p.spread - q.spread);
      // the vertex profile is only a shortlist: the 10 best pairs are placed and measured with rays on the drawn triangles,
      // the one with the most even corridor wins (all 42 samples hit, nothing across the corridor's middle line)
      const W = 0.68, short = pairs.slice(0, 10), rMax = Math.max(...short.map((p) => Math.max(rad(srcs[p.A.k]), rad(srcs[p.B.k]))));
      const f = findSpot(Math.max(...short.map((p) => p.maxX)) + W / 2 + rMax, { clear: 11, id: 'gap' }); if (!f) throw new Error('no free ground for the gap');
      const g0 = gh(f.x, f.z);
      const measure = (a, b) => { const out = { min: Infinity, max: -Infinity, n: 0, byH: {} };
        for (let dz = -0.75; dz <= 0.75001; dz += 0.25) for (const hy of [0.4, 0.6, 0.8, 1.0, 1.2, 1.4]) {
          const y = g0 + hy, l = window.INTERACT.castOn(a.e, f.x, y, f.z + dz, -1, 0, 0, 8), rr = window.INTERACT.castOn(b.e, f.x, y, f.z + dz, 1, 0, 0, 8);
          if (!l || !rr) continue; const w = l.distance + rr.distance; out.n++; out.min = Math.min(out.min, w); out.max = Math.max(out.max, w);
          out.byH[hy] = Math.min(out.byH[hy] === undefined ? Infinity : out.byH[hy], w); }
        return out; };
      const drop = (cp) => { for (const mesh of cp.meshes) C.scene.remove(mesh); C.Passport.remove(cp.e); };
      let best = null; st.gapTried = [];
      for (const pick of short) {
        let a = null, b = null, m = null, cur = 2 * pick.maxX + W;
        for (let it = 0; it < 5; it++) {
          // B turned 180° about the vertical, its roll mirrored (both faces lean the same way relative to the corridor)
          a = copyRock(srcs[pick.A.k], partsOf[pick.A.k], { x: f.x - cur / 2, y: g0 - pick.A.bury, z: f.z }, pick.A.yaw, 1, pick.A.bury, pick.A.tilt);
          b = copyRock(srcs[pick.B.k], partsOf[pick.B.k], { x: f.x + cur / 2, y: g0 - pick.B.bury, z: f.z }, pick.B.yaw + Math.PI, 1, pick.B.bury, { rx: 0, rz: -pick.B.tilt.rz });
          m = measure(a, b);
          if (!m.n || Math.abs(m.min - W) < 0.02 || it === 4) break;
          drop(a); drop(b); cur -= m.min - W;
        }
        // through: nothing of either rock across the corridor's middle line at 0.3–1.6 m, 3.5 m each way
        let blocked = 0; for (const hy of [0.3, 0.9, 1.6]) for (const dir of [1, -1]) for (const e of [a.e, b.e]) if (window.INTERACT.castOn(e, f.x, g0 + hy, f.z, 0, 0, dir, 3.5)) blocked++;
        const score = m.n < 42 || blocked ? Infinity : m.max - m.min;
        st.gapTried.push({ k: pick.A.k + '/' + pick.B.k, minCm: Math.round(m.min * 100), maxCm: Math.round(m.max * 100), n: m.n, blocked });
        if (!best || score < best.score) { if (best) { drop(best.a); drop(best.b); } best = { a, b, m, cur, pick, blocked, score }; } else { drop(a); drop(b); }
      }
      const { a, b, m, cur, pick, blocked } = best, r = Math.max(rad(srcs[pick.A.k]), rad(srcs[pick.B.k])), k = pick.A.k === pick.B.k ? pick.A.k : pick.A.k + ' + ' + pick.B.k;
      st.gap = { kind: k, minCm: m.n ? Math.round(m.min * 100) : null, maxCm: m.n ? Math.round(m.max * 100) : null,
        byHcm: Object.fromEntries(Object.entries(m.byH).map(([h, w]) => [h, Math.round(w * 100)])), samples: m.n, blocked, lengthM: 1.5 };
      spots.push(Object.assign(spotRec('gap', 'щель ' + (m.n ? m.min.toFixed(2) : '?') + ' м', k, a.e, f.x, f.z, { e2: b.e, ang0: 0, size: m.n ? +m.min.toFixed(2) : W, spread: +f.spread.toFixed(2) }), { r: 1.2, rAcross: cur / 2 + r }));
    }
    // a rock on a slope
    {
      const k = 'rock|2515'; const { cp, f } = place(k, { slope: true, id: 'slope' });
      spots.push(spotRec('slope', 'на склоне ' + height(cp.e).toFixed(1) + ' м', k, cp.e, f.x, f.z, { spread: +f.spread.toFixed(2) }));
    }
    // scaled copies: the height OVER THE SNOW (box height minus the burial) set by a uniform scale
    const scaled = (id, k, want, word, o = {}) => {
      const s = srcs[k], us = want / Math.max(0.2, height(s) - burialOf(s));
      const { cp, f } = place(k, Object.assign({ id, us }, o));
      const vis = height(cp.e) - burialOf(s) * us;
      spots.push(spotRec(id, word + ' ' + vis.toFixed(2) + ' м', k, cp.e, f.x, f.z, { spread: +f.spread.toFixed(2), us: +us.toFixed(3) }));
    };
    scaled('ledge', 'rock|4716', 0.6, 'уступ');                                  // knee / foot on a low face
    scaled('dome', 'boulder|2845', 1.1, 'купол');                                // a rounded top: no flat face, no flat top
    scaled('overhang', 'rock|4716', 2.6, 'нависание', { tilt: { rx: 0.42, rz: 0 } });   // its top leans out over side 0 (+z)
    for (const sp of spots) sp.h = +(sp.h).toFixed(2);
    LAB.spots = spots; LAB.site = SITE; st.ms = Math.round(performance.now() - t0);
    LAB.hash = spots.map((q) => q.id + '@' + q.x.toFixed(1) + ',' + q.z.toFixed(1) + ':' + q.h).join(';') + '|' + JSON.stringify(st.src);
    LAB.hash = VERSION + '#' + [...LAB.hash].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36);
    LAB.ready = true;
  }
  function hideClutter() {
    let n = 0;
    C.scene.traverse((o) => { if (o.isMesh && /^(veg_tufts|veg_shrub|veg_decals|wf_clutter)/.test(o.name || '') && o.visible) { o.visible = false; n++; } });
    LAB.stats.hidden = (LAB.stats.hidden || 0) + n;
  }

  (window.GameModules = window.GameModules || []).push({
    name: 'rock-lab', order: 90,
    init(ctx) { C = ctx; T3 = ctx.THREE; },
    update(dt) {
      hideT -= dt; if (hideT <= 0) { hideT = 1; try { hideClutter(); } catch (e) { /* pools not built yet */ } }
      if (LAB.ready || LAB.err || !C.Passport || !C.PH || !C.PH.ok) return;
      // wait until every source kind is registered (rocks come from async model loads)
      const have = new Set(C.Passport.list.filter((e) => e.alive && e.geo).map(kindKey));
      if (!KINDS.every((k) => have.has(k))) { if (++tries > 3000) LAB.err = 'source kinds missing: ' + KINDS.filter((k) => !have.has(k)).join(', '); return; }
      // settled: the Passport list has not changed for 4 s (late async loads change what is "occupied" → another layout)
      if (SRC[VERSION] && Object.keys(SRC[VERSION]).length && !KINDS.every((k) => source(k))) { if (++tries > 6000) LAB.err = 'frozen source instances missing'; return; }
      const n = C.Passport.list.length; if (n !== settleN) { settleN = n; settleT = 0; return; }
      settleT += dt; if (settleT < 4) return; LAB.stats.settledAt = n;
      try { build(); } catch (e) { LAB.err = String(e && e.message || e); console.warn('rock-lab', e); }
    },
  });
})();
