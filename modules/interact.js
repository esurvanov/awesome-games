/* Module "interact" — interaction passport + mediator (INTERACT.md).
 *
 *  passport  every interactable KIND carries named contact points (modules/interact-data.js, written by
 *            tools/interact/author.mjs): wall patches (hands / shoulder on a vertical face), tops (palms on a ledge,
 *            vault, step over), push faces, trunk rings (shoulder lean). One set per kind; each placed instance maps
 *            it through its own transform (instances: an affine solved from 4 of its own drawn vertices; single objects
 *            and pushables: their Object3D matrix; trunks: the fitted cylinder).
 *  mediator  INTERACT.plan(intent, entries, pilot, meta) → the best {clip, stand, yaw, targets} for the pilot's intent
 *            (Unity XR "interaction manager" role): points in reach for the clip's height range, a free stand spot on
 *            walkable ground, least walk + turn. Hand/foot targets are snapped onto the DRAWN mesh of that one entry
 *            (three-mesh-bvh on Passport's pre-hull triangles), computed once when the plan is made.
 *  fallback  kinds without points (or no valid point) → null: the contact layer keeps its probe + BVH raycast path.
 *
 * Reads ctx.Passport / ctx.PH / ctx.groundH; writes nothing to the scene. Cost: work only when a contact starts
 * (a few dozen rays), nothing per frame.
 */
(function () {
  let C = null, T3 = null;
  const K = { on: true, reach: 2.2, maxStandMove: 1.6, maxTurn: 2.4, snapDist: 0.6, nearPts: 14 };
  const STATS = { plans: 0, hits: 0, misses: 0, snapFail: 0, lastMs: 0, maxMs: 0, loaded: false, kinds: 0, why: {} };
  const why = (k) => { STATS.why[k] = (STATS.why[k] || 0) + 1; };
  const src = (document.currentScript && document.currentScript.src) || '';
  const DATA_URL = src ? src.replace(/interact\.js(\?.*)?$/, 'interact-data.js') : 'modules/interact-data.js';
  const base = (n) => String(n || '').replace(/#\d+$/, '');
  const kindKey = (e) => (e.role === 'trunk' ? base(e.name) + '|trunk' : base(e.name) + '|' + (e.geo ? e.geo.vn : 0));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  /* ---------------------------------------------------------------- data */
  let DATA = window.INTERACT_DATA || null;
  function loadData() {
    if (DATA || typeof document === 'undefined' || window.INTERACT_OFF) return;   // A/B: no passport → every contact takes the probe path
    const s = document.createElement('script'); s.src = DATA_URL; s.async = true;
    s.onload = () => { DATA = window.INTERACT_DATA || null; STATS.loaded = !!DATA; STATS.kinds = DATA ? Object.keys(DATA.kinds).length : 0; };
    s.onerror = () => { STATS.loadError = DATA_URL; };
    document.head.appendChild(s);
  }
  function kindOf(e) {
    if (!DATA || !e) return null;
    const key = kindKey(e), k = DATA.kinds[key] || (DATA.alias && DATA.alias[key] && DATA.kinds[DATA.alias[key]]); if (k) return k;
    if (e.role === 'trunk') return DATA.kinds['*|trunk'] || null;
    return null;
  }

  /* ---------------------------------------------------------------- transforms */
  // affine a → b from 4 point pairs (instances registered with Passport.registerInstances keep the vertex order of the
  // model, so 4 anchor vertices of the reference instance and the same 4 of any other instance fix its transform)
  function solveAffine(a, b) {
    const d = (p, i) => [p[i][0] - p[0][0], p[i][1] - p[0][1], p[i][2] - p[0][2]];
    const A = new T3.Matrix3().set(...[0, 1, 2].flatMap((r) => [d(a, 1)[r], d(a, 2)[r], d(a, 3)[r]]));
    const B = new T3.Matrix3().set(...[0, 1, 2].flatMap((r) => [d(b, 1)[r], d(b, 2)[r], d(b, 3)[r]]));
    if (Math.abs(A.determinant()) < 1e-9) return null;
    const L = B.multiply(A.clone().invert()), e = L.elements;   // column-major
    const t = [0, 1, 2].map((r) => b[0][r] - (e[r] * a[0][0] + e[r + 3] * a[0][1] + e[r + 6] * a[0][2]));
    return new T3.Matrix4().set(e[0], e[3], e[6], t[0], e[1], e[4], e[7], t[1], e[2], e[5], e[8], t[2], 0, 0, 0, 1);
  }
  const XF = new Map();   // entry id → { M, N (normal matrix), ok } for static (anchor) frames
  function frameOf(e, kind) {
    if (kind.frame === 'obj') {
      const o = e.role === 'pushable' && e.debris ? e.debris.mesh : e.obj; if (!o) return null;
      o.updateWorldMatrix(true, false);
      const M = o.matrixWorld.clone(); if (kind.pre) M.multiply(new T3.Matrix4().fromArray(kind.pre));
      return { M, N: new T3.Matrix3().getNormalMatrix(M), live: true };
    }
    if (kind.frame !== 'anchors') return null;
    let f = XF.get(e.id); if (f) return f.ok ? f : null;
    f = { ok: false };
    try {
      const V = e.geo.v, an = kind.anchors, a = [], b = [];
      for (const [i, x, y, z] of an) { a.push([x, y, z]); b.push([V[i * 3], V[i * 3 + 1], V[i * 3 + 2]]); }
      const M = solveAffine(a.slice(0, 4), b.slice(0, 4));
      if (M) {
        let worst = 0; const v = new T3.Vector3();
        for (let k = 4; k < a.length; k++) { v.set(a[k][0], a[k][1], a[k][2]).applyMatrix4(M); worst = Math.max(worst, Math.hypot(v.x - b[k][0], v.y - b[k][1], v.z - b[k][2])); }
        if (worst < 0.02) { f = { ok: true, M, N: new T3.Matrix3().getNormalMatrix(M), resid: worst }; }
        else f.resid = worst;
      }
    } catch (err) { f.err = String(err); }
    XF.set(e.id, f);
    return f.ok ? f : null;
  }

  /* ---------------------------------------------------------------- points in world space */
  // point record (data file): [x, y, z, nx, ny, nz, ex, ez, type, y0, y1, w]
  //   type 1 = wall patch (vertical-ish face; y0..y1 its vertical extent, w its flat width), 2 = top (palms on a
  //   ledge / vault / step: p on the top a hand's depth in from the edge, e = outward edge direction), 3 = push face
  const PTS = new Map();   // entry id → world points (static frames)
  function worldPoints(e, kind) {
    const f = frameOf(e, kind); if (!f) return null;
    if (!f.live && PTS.has(e.id)) return PTS.get(e.id);
    const out = [], v = new T3.Vector3(), n = new T3.Vector3(), ed = new T3.Vector3(), lo = new T3.Vector3(), hi = new T3.Vector3();
    for (const r of kind.pts) {
      v.set(r[0], r[1], r[2]).applyMatrix4(f.M); n.set(r[3], r[4], r[5]).applyMatrix3(f.N).normalize();
      ed.set(r[6], 0, r[7]).applyMatrix3(f.N); ed.y = 0; if (ed.lengthSq() < 1e-8) ed.set(n.x, 0, n.z); ed.normalize();
      lo.set(r[0], r[9], r[2]).applyMatrix4(f.M); hi.set(r[0], r[10], r[2]).applyMatrix4(f.M);
      const s = f.M.elements, sx = Math.hypot(s[0], s[1], s[2]);
      out.push({ x: v.x, y: v.y, z: v.z, nx: n.x, ny: n.y, nz: n.z, ex: ed.x, ez: ed.z, type: r[8], y0: Math.min(lo.y, hi.y), y1: Math.max(lo.y, hi.y), w: (r[11] || 0) * sx });
    }
    if (!f.live) PTS.set(e.id, out);
    return out;
  }
  // trunk rings: points all round the fitted cylinder at the heights the kind lists; radius at height = base × ratio
  function trunkPoints(e, kind, px, pz) {
    const t = e.trunk; if (!t) return null;
    const dx = px - t.x, dz = pz - t.z, d = Math.hypot(dx, dz) || 1, out = [];
    const g = C.groundH(t.x, t.z), ratio = (h) => { const R = kind.rAt || [[0, 1]]; let r = R[0][1]; for (const [hh, rr] of R) if (h >= hh) r = rr; return r; };
    for (let k = -3; k <= 3; k++) {   // the side facing the pilot ± 3 × 20°
      const a = Math.atan2(dx, dz) + k * 0.35, ux = Math.sin(a), uz = Math.cos(a);
      for (const h of kind.heights || [1.35]) { const r = t.r * ratio(h); out.push({ x: t.x + ux * r, y: g + h, z: t.z + uz * r, nx: ux, ny: 0, nz: uz, ex: ux, ez: uz, type: 1, y0: g + 0.9, y1: g + 2.0, w: 0, trunk: true, r }); }
    }
    void d; return out;
  }

  /* ---------------------------------------------------------------- drawn-surface snapping (three-mesh-bvh) */
  const BVH = new WeakMap(); let _ray = null;
  function bvhGeo(e) {
    if (!e || !e.geo || !e.geo.vn || e.geo.i.length / 3 > 60000) return null;
    if (BVH.has(e)) return BVH.get(e);
    let g = null;
    try { if (T3.BufferGeometry.prototype.computeBoundsTree) { g = new T3.BufferGeometry(); g.setAttribute('position', new T3.BufferAttribute(e.geo.v, 3)); g.setIndex(new T3.BufferAttribute(e.geo.i, 1)); g.computeBoundsTree(); } }
    catch (err) { g = null; }
    BVH.set(e, g); return g;
  }
  const _rc = { r: null };
  // first hit of a ray on this entry's drawn triangles → {point, normal (toward the ray origin), distance} | null
  function castOn(e, ox, oy, oz, dx, dy, dz, far) {
    if (!_ray) _ray = new T3.Ray();
    if (e.role === 'pushable') {   // moves: its Passport triangles are stale → raycast the drawn prop itself
      const o = e.debris ? e.debris.mesh : e.obj; if (!o) return null;
      if (!_rc.r) _rc.r = new T3.Raycaster();
      _rc.r.set(new T3.Vector3(ox, oy, oz), new T3.Vector3(dx, dy, dz)); _rc.r.far = far;
      const h = _rc.r.intersectObject(o, true).filter((q) => q.object.material && q.object.material.visible !== false)[0]; if (!h) return null;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.x * dx + n.y * dy + n.z * dz > 0) n.negate();
      return { point: h.point.clone(), normal: n, distance: h.distance };
    }
    if (e.role === 'trunk') {   // cylinder (fitted to the drawn bark ring), radius per height from the kind data
      const t = e.trunk, kind = kindOf(e); const g = C.groundH(t.x, t.z);
      const ratio = kind && kind.rAt ? (() => { let r = kind.rAt[0][1]; for (const [hh, rr] of kind.rAt) if (oy - g >= hh) r = rr; return r; })() : 1;
      const r = t.r * ratio, fx = ox - t.x, fz = oz - t.z, a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r, disc = b * b - 4 * a * c;
      if (a < 1e-9 || disc < 0) return null;
      const s = (-b - Math.sqrt(disc)) / (2 * a); if (s < 0 || s > far) return null;
      const p = new T3.Vector3(ox + dx * s, oy + dy * s, oz + dz * s), n = new T3.Vector3(p.x - t.x, 0, p.z - t.z).normalize();
      return { point: p, normal: n, distance: s };
    }
    const g = bvhGeo(e); if (!g || !g.boundsTree) return null;
    _ray.origin.set(ox, oy, oz); _ray.direction.set(dx, dy, dz).normalize();
    let h = null; try { h = g.boundsTree.raycastFirst(_ray, T3.DoubleSide); } catch (err) { return null; }
    if (!h || h.distance > far) return null;
    const n = h.face.normal.clone(); if (n.dot(_ray.direction) > 0) n.negate();
    return { point: h.point.clone(), normal: n, distance: h.distance };
  }

  /* ---------------------------------------------------------------- environment checks (physics) */
  const GC = new Map();   // ground under a stand spot, per plan() call (several clips test the same spots)
  function groundAt(x, z, yTop) {
    const k = Math.round(x * 20) + ',' + Math.round(z * 20); if (GC.has(k)) return GC.get(k);
    const g = groundAt0(x, z, yTop); GC.set(k, g); return g;
  }
  function groundAt0(x, z, yTop) {
    const PH = C.PH;
    if (PH.ok) { const h = PH.P.raycast({ x, y: yTop, z }, { x: 0, y: -1, z: 0 }, 6, { groups: PH.P.groups.STATIC }); if (h) return { y: h.point.y, ny: h.normal ? h.normal.y : 1, tag: h.tag }; }
    return { y: C.groundH(x, z), ny: 1, tag: { kind: 'terrain' } };
  }
  // stand spot free for a 0.4 m capsule: nothing within 0.36 m at knee and chest height except the target itself in front
  function standFree(x, y, z, fx, fz, e) {
    const PH = C.PH; if (!PH.ok) return true;
    const grp = PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP;
    for (const hy of [0.55, 1.25]) for (const [dx, dz] of [[-fz, fx], [fz, -fx], [-fx, -fz], [fx * 0.7 - fz * 0.7, fz * 0.7 + fx * 0.7], [fx * 0.7 + fz * 0.7, fz * 0.7 - fx * 0.7]]) {
      const h = PH.P.raycast({ x, y: y + hy, z }, { x: dx, y: 0, z: dz }, 0.36, { groups: grp });
      if (h && !(h.tag && h.tag.passport === e.id)) return false;
    }
    return true;
  }
  // the pilot can get from where it is to the stand spot without passing through a solid (knee-height sweep)
  function pathFree(P, x, z, e) {
    const PH = C.PH; if (!PH.ok) return true;
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); if (d < 0.05) return true;
    // a sphere smaller than the capsule: the pilot is usually already touching the object (a start overlap is not a block)
    const h = PH.P.sphereCast({ x: P.x, y: P.y + 0.7, z: P.z }, { x: dx / d, y: 0, z: dz / d }, d, 0.22, { groups: PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP });
    return !h || h.distance >= d - 0.02 || h.distance < 0.01;
  }

  /* ---------------------------------------------------------------- mediator */
  // clip families the pilot has (ANIMLIB contact set): which point type they use and how the character stands to it
  //   lat = which hand's lateral offset lands on the point (character space, +X = left), dist = feet → surface along −n
  function clipSpec(meta, name) {
    const m = meta && meta.clips[name + '_loop'] || meta && meta.clips[name]; if (!m) return null;
    const hands = (m.contacts || []).filter((c) => /^hand|^foot|^upperarm/.test(c.bone));
    if (!hands.length) return null;
    const c0 = hands[0], pt = c0.surface.point;
    const lat = hands.reduce((a, c) => a + c.surface.point[0], 0) / hands.length, fwd = hands.reduce((a, c) => a + c.surface.point[2], 0) / hands.length;
    return { name, clip: meta.clips[name + '_loop'] ? name + '_loop' : name, enter: meta.clips[name + '_in'] ? name + '_in' : null, contacts: hands, lat, fwd, h: pt[1], type: c0.surface.type,
      nL: [c0.surface.normal[0], c0.surface.normal[2]], heightRange: c0.heightRange, dist: c0.approach.distance, facing: c0.approach.facing, bone: c0.bone };
  }
  // intent → candidate clips (order = preference when scores tie)
  const FAMILY = {
    rest_on_rock: ['hand_wall_both', 'lean_hands_ledge', 'lean_shoulder_r', 'lean_shoulder_l', 'hand_wall_r', 'hand_wall_l'],
    touch_surface: ['hand_wall_r', 'hand_wall_l', 'hand_wall_both'],
    cross_obstacle: ['vault_1m', 'step_over'],
  };
  const PREF = { hand_wall_both: 0, lean_hands_ledge: 0, lean_shoulder_r: 0.15, lean_shoulder_l: 0.15, hand_wall_r: 0.1, hand_wall_l: 0.1, vault_1m: 0, step_over: 0.1 };
  // the object decides what is possible: an intent it cannot serve falls back to what it offers (a 4 m boulder read as a
  // low obstacle by the knee probe has no top to vault → rest a hand on it instead)
  const THEN = { cross_obstacle: ['rest_on_rock'], touch_surface: ['rest_on_rock'], rest_on_rock: [] };
  // one candidate: point q + clip spec → stand spot, yaw, the surface height it needs, or null.
  // General rule for every clip: the clip's authored contact (character space: +Z forward, +X left, surface normal nL)
  // must land on q with nL turned onto the world outward direction e:  yaw = atan2(ex, ez) − atan2(−nL.x, −nL.z),
  // stand S = q − left·px − forward·pz  (px, pz = the clip's contact point, averaged over its hands)
  function fit(q, sp, e, P) {
    const wall = sp.type === 'wall' || sp.type === 'object_face';
    if (wall ? q.type !== 1 : q.type !== 2) return null;
    if (sp.name === 'hand_wall_both' && (q.trunk || q.w < 0.3)) { why('fit:narrow'); return null; }   // two palms need a flat face ≥ 0.3 m wide
    let a = sp.nL[0], b = sp.nL[1]; if (Math.hypot(a, b) < 0.3) { a = -sp.facing[0]; b = -sp.facing[2]; }
    const yaw = wrapA(Math.atan2(q.ex, q.ez) - Math.atan2(-a, -b));
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), lx = -Math.cos(yaw), lz = Math.sin(yaw);
    // walls: the contact lands on q. Tops: q is on the rim; the feet stay a capsule radius off the face (the clip's own
    // front distance for vault / step over), the palms land (fwd − that) in from the rim
    const dEdge = wall ? sp.fwd : /vault|step_over/.test(sp.name) ? sp.dist[1] : Math.max(0.42, sp.fwd - 0.08);
    const sx = wall ? q.x - lx * sp.lat - fx * sp.fwd : q.x + q.ex * dEdge - lx * sp.lat, sz = wall ? q.z - lz * sp.lat - fz * sp.fwd : q.z + q.ez * dEdge - lz * sp.lat;
    const g = groundAt(sx, sz, q.y + 1.2); if (!g || g.ny < 0.72 || (g.tag && g.tag.passport === e.id)) { why('fit:ground'); return null; }
    if (Math.abs(P.y - g.y) > 0.5) { why('fit:level'); return null; }
    const h = q.y - g.y;
    if (wall) { const want = g.y + sp.h; if (want < q.y0 - 0.05 || want > q.y1 + 0.05) { why('fit:span'); return null; } }   // the patch spans the clip's hand / shoulder height
    else {
      // the vault clip plants palms for a 0.8–1.2 m top (lower tops are out of arm reach mid-vault), step over ≤ 0.5 m
      const lo = sp.name === 'vault_1m' ? 0.88 : sp.name === 'step_over' ? 0.15 : sp.heightRange[0] - 0.05, hi = sp.name === 'vault_1m' ? 1.22 : sp.name === 'step_over' ? 0.5 : sp.heightRange[1] + 0.05;
      if (h < lo || h > hi) { why('fit:height'); return null; }
    }
    const move = Math.hypot(sx - P.x, sz - P.z), turn = Math.abs(wrapA(yaw - P.face));
    if (move > K.maxStandMove) { why('fit:far'); return null; } if (turn > K.maxTurn) { why('fit:turn'); return null; }
    return { yaw, sx, sy: g.y, sz, h, move, turn, score: move + 0.35 * turn + (PREF[sp.name] || 0) };
  }
  // world targets for every hand/foot contact of the clip, snapped onto the drawn mesh of the entry
  function targetsFor(plan, sp, e, q) {
    const out = {}, yaw = plan.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), lx = -Math.cos(yaw), lz = Math.sin(yaw);
    for (const c of sp.contacts) {
      if (!/^hand|^foot/.test(c.bone) || c.hold === false) continue;     // shoulders / back: placement only; pass-through contacts (step-over foot clearance) follow the clip
      const p = c.surface.point, hs = plan.heightScale || 1;
      const wx = plan.sx + lx * p[0] + fx * p[2], wz = plan.sz + lz * p[0] + fz * p[2];
      let hit = null;
      if (c.surface.type === 'wall' || c.surface.type === 'object_face') {
        const wy = plan.sy + p[1];
        // from 0.35 m out along the surface normal, straight at the surface
        hit = castOn(e, wx + q.ex * 0.35, wy, wz + q.ez * 0.35, -q.ex, 0, -q.ez, 0.35 + K.snapDist);
        if (!hit) hit = castOn(e, wx - fx * 0.2, wy, wz - fz * 0.2, fx, 0, fz, 0.2 + K.snapDist);
      } else {   // tops: straight down onto the top at the hand's spot
        hit = castOn(e, wx, q.y + 0.45, wz, 0, -1, 0, 1.0);
        if (hit && (Math.abs(hit.point.y - q.y) > 0.25 || hit.normal.y < 0.55)) hit = null;   // each palm on the top, near the rim height
        // within the arm's reach of the clip's own palm height (vault: keyed for a 1.0 m top; ledge: IK raises / lowers ±0.2 m)
        if (hit && c.hold && Math.abs(hit.point.y - (plan.sy + p[1])) > (c.surface.type === 'obstacle_top' ? 0.12 : 0.2)) { why('reach'); hit = null; }
      }
      if (!hit) { STATS.snapFail++; why('snap:' + c.surface.type + ':' + plan.name); STATS.lastSnap = { name: plan.name, bone: c.bone, wx: +wx.toFixed(2), wz: +wz.toFixed(2), q: [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)], e: [+q.ex.toFixed(2), +q.ez.toFixed(2)], sy: +plan.sy.toFixed(2) }; return null; }
      out[c.bone] = { point: hit.point, normal: hit.normal };
    }
    return out;
  }
  // plan(intent, entries[], P = {x, y, z, face}, meta) → { clip, enter, entry, point, yaw, stand:{x,y,z}, targets, heightScale } | null
  function plan(intent, entries, P, meta) {
    if (!K.on || !DATA || !meta || !FAMILY[intent]) return null;
    for (const it of [intent].concat(THEN[intent] || [])) { const p = plan1(it, entries, P, meta); if (p) { p.asked = intent; return p; } }
    return null;
  }
  function plan1(intent, entries, P, meta) {
    GC.clear();
    const fam = FAMILY[intent]; if (!fam) return null;
    const t0 = performance.now(); STATS.plans++;
    const cands = [];
    for (const e of entries) {
      if (!e || !e.alive) continue;
      const kind = kindOf(e); if (!kind) continue;
      const pts = e.role === 'trunk' ? trunkPoints(e, kind, P.x, P.z) : worldPoints(e, kind); if (!pts) continue;
      // cost bound: only the nearest points on the pilot's side go through the ray-based checks (≤ 14 per entry)
      const near = pts.filter((q) => Math.hypot(q.x - P.x, q.z - P.z) <= K.reach + 1.2 && q.ex * (P.x - q.x) + q.ez * (P.z - q.z) >= -0.2)
        .sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, K.nearPts);
      for (const name of fam) {
        const sp = clipSpec(meta, name); if (!sp) continue;
        for (const q of near) {
          const f = fit(q, sp, e, P); if (f) cands.push({ e, q, sp, f });
        }
      }
    }
    cands.sort((a, b) => a.f.score - b.f.score);
    let best = null;
    for (const c of cands.slice(0, 10)) {
      const { e, sp } = c; let f = c.f, q = c.q;
      if (sp.type === 'wall') {   // the face at the clip's own contact height (a shoulder has no IK: the stand spot must be exact)
        const y = f.sy + sp.h, h = castOn(e, q.x + q.ex * 0.6, y, q.z + q.ez * 0.6, -q.ex, 0, -q.ez, 1.3);
        if (!h || h.normal.y > 0.6 || h.normal.y < -0.6) { why('recast'); continue; }
        const nh = Math.hypot(h.normal.x, h.normal.z), q2 = { x: h.point.x, y: h.point.y, z: h.point.z, ex: h.normal.x / nh, ez: h.normal.z / nh, type: 1, y0: q.y0, y1: q.y1, w: q.w, trunk: q.trunk };
        const f2 = fit(q2, sp, e, P); if (!f2) { why('recastFit'); continue; }
        f = f2; q = q2;
      }
      if (!standFree(f.sx, f.sy, f.sz, -Math.sin(f.yaw), -Math.cos(f.yaw), e)) { why('standBlocked'); continue; }
      if (!pathFree(P, f.sx, f.sz, e)) { why('pathBlocked'); continue; }
      const pl = { intent, clip: sp.clip, enter: sp.enter, name: sp.name, entry: e, entryId: e.id, kind: kindKey(e), point: { x: q.x, y: q.y, z: q.z }, normal: { x: q.ex, y: 0, z: q.ez },
        yaw: f.yaw, sx: f.sx, sy: f.sy, sz: f.sz, stand: { x: f.sx, y: f.sy, z: f.sz }, heightScale: sp.name === 'vault_1m' ? clamp(f.h / 1.0, 0.55, 1.25) : 1, standOff: sp.dist ? sp.dist[1] : 0.45, h: f.h };
      let tg = targetsFor(pl, sp, e, q); if (!tg) continue;
      // two palms on a faceted / curved face: square the pilot to the two snapped palm spots (mean of their normals, stand
      // centred on their midpoint) and snap again — otherwise one arm ends straight and its glove tilts off the surface
      if (sp.type === 'wall' && tg.hand_l && tg.hand_r) {
        const a = tg.hand_l, b = tg.hand_r; let ex = a.normal.x + b.normal.x, ez = a.normal.z + b.normal.z; const el = Math.hypot(ex, ez);
        if (el > 0.5) { ex /= el; ez /= el;
          const yaw2 = wrapA(Math.atan2(ex, ez) - Math.atan2(-sp.nL[0], -sp.nL[1])), mx = (a.point.x + b.point.x) / 2, mz = (a.point.z + b.point.z) / 2;
          const q2 = { x: mx, y: q.y, z: mz, ex, ez, type: 1, y0: q.y0, y1: q.y1, w: q.w };
          const pl2 = Object.assign({}, pl, { yaw: yaw2, sx: mx + ex * sp.fwd, sz: mz + ez * sp.fwd }); pl2.stand = { x: pl2.sx, y: pl.sy, z: pl2.sz };
          const tg2 = Math.abs(wrapA(yaw2 - pl.yaw)) < 0.6 && standFree(pl2.sx, pl.sy, pl2.sz, -Math.sin(yaw2), -Math.cos(yaw2), e) ? targetsFor(pl2, sp, e, q2) : null;
          if (tg2) { Object.assign(pl, pl2); tg = tg2; why('squared'); } } }
      pl.targets = tg; best = pl;
      if (/^upperarm/.test(sp.bone)) pl.shoulder = { bone: sp.bone, x: q.x, y: q.y, z: q.z, ex: q.ex, ez: q.ez };   // placement-only contact: kept on the face in play
      break;
    }
    const ms = performance.now() - t0; STATS.lastMs = +ms.toFixed(2); STATS.maxMs = Math.max(STATS.maxMs, ms);
    if (best) STATS.hits++; else { STATS.misses++; if (!cands.length) why('noCandidate:' + intent); }
    STATS.lastCands = cands.length;
    return best;
  }
  // entries a contact probe touched (physics tags carry the Passport id)
  const byId = new Map();
  function entryById(id) {
    if (id == null) return null;
    const c = byId.get(id); if (c && c.alive) return c;
    for (const e of (C.Passport && C.Passport.list) || []) if (e.id === id) { byId.set(id, e); return e; }
    return null;
  }
  function hasPoints(e) { return !!kindOf(e); }
  // passport self-check for one entry: every mapped point must lie on this instance's drawn surface (cast from 0.3 m out
  // along its normal) → { n, on (≤ 3 cm), worstCm, frame resid }
  function verify(e) {
    const kind = kindOf(e); if (!kind || e.role === 'trunk') return null;
    const f = frameOf(e, kind); if (!f) return { error: 'no frame', resid: XF.get(e.id) && XF.get(e.id).resid };
    const pts = worldPoints(e, kind); let on = 0, worst = 0, n = 0;
    for (const q of pts) { n++; const h = castOn(e, q.x + q.nx * 0.3, q.y + q.ny * 0.3, q.z + q.nz * 0.3, -q.nx, -q.ny, -q.nz, 0.8); const d = h ? Math.abs(h.distance - 0.3) : 1; worst = Math.max(worst, d); if (d <= 0.03) on++; }
    return { n, on, worstCm: +(worst * 100).toFixed(1), resid: f.resid !== undefined ? +(f.resid * 100).toFixed(3) : null };
  }

  window.INTERACT = { K, STATS, plan, entryById, kindOf, kindKey, hasPoints, verify, worldPoints: (e) => { const k = kindOf(e); return k && (e.role === 'trunk' ? trunkPoints(e, k, e.trunk.x + 1, e.trunk.z) : worldPoints(e, k)); },
    castOn: (...a) => castOn(...a), bvhGeo: (e) => bvhGeo(e), frameOf: (e) => { const k = kindOf(e); return k ? frameOf(e, k) : null; }, get data() { return DATA; }, set data(d) { DATA = d; PTS.clear(); XF.clear(); }, solveAffine: (a, b) => solveAffine(a, b) };
  (window.GameModules = window.GameModules || []).push({
    name: 'interact', order: 45,
    init(ctx) { C = ctx; T3 = ctx.THREE; loadData(); ctx.interact = window.INTERACT; },
  });
})();
