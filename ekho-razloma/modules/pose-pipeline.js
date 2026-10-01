/* Module "pose-pipeline" — PosePipeline: the ONE writer of the pilot's skeleton (ARCH-INTERACT.md, steps 3–4).
 *
 *  Writers (interaction.js legs / lean / look / arms, physbody.js springs, the contact layer in interaction.js and
 *  rock-brain.js hands) no longer touch bones while they run: they hand the pipeline a PoseRequest
 *  { slot, source, type, data, apply } and the pipeline applies every request of the frame in ONE fixed order, after
 *  all modules have decided (so the legs, the spine and the hands are solved from the same root, and the rock-brain's
 *  lean / dip / look of THIS frame are read, not last frame's):
 *
 *      clip base (mixer) → pelvis → legs → spine → look → arms (climb / push) → springs → contact → hands → after-hooks
 *
 *  (the springs sit before the hands: a spine spring applied after the hand IK would carry the palms off the rock; this
 *  is also the order the old writers ran in.) `data` describes the request (limbTarget / spineLean / pelvisOffset /
 *  look / spring) for the pose solver of step 5; `apply(data, dt)` performs the write. After-hooks read the finished
 *  pose (rock-brain's reach / hands-in-air checks).
 *
 *  Switches: POSE.K.on (all) and POSE.K.<writer> = false → that writer goes back to writing at once (the old path).
 *  `?nopose` in the URL = everything on the old path (A/B). An exception in the pipeline switches it off for good
 *  (POSE.STATS.err) and every writer falls back on the next frame.
 *  PoseSolver (step 5, K.solve): after the requests are applied the body VOLUMES from BODYSPEC (helmet sphere, chest /
 *  pelvis capsules, upper / fore arms, thighs / shins — the debugDraw() shapes) are measured against the DRAWN triangles of
 *  the rocks near the pilot (three-mesh-bvh via INTERACT.bvhGeo, signed by ray parity) and the palm centres (BODYSPEC.palm_*)
 *  against the surface. A body volume more than 2 cm inside → one step of the compromise chain per frame, in this order:
 *  pelvis back (the drawn body slides away from the rock, the feet stay) → less spine lean → palms higher; nothing left →
 *  the pose is rejected (event PoseRejected; rock-brain bans that action here and lets go). The correction is a feedback
 *  (MOD, read by the writers next frame): the requests themselves stay one-shot. Palm feedback: the palm centre is pulled
 *  to ±2 cm of the surface (MOD.palm, along the contact normal). It is gone (relaxed) once nothing is within 3 cm.
 *  Independent check: the pilot's bones are snapshotted right after the mixer (A.update); at the start of the pipeline
 *  any bone that changed since = a write outside the pipeline (POSE.STATS.foreign, per bone).
 */
(function () {
  let C = null;
  const K = { on: !/[?&]nopose\b/.test(location.search) && !window.POSE_OFF, legs: true, lean: true, look: true, arms: true, springs: true, hands: true, palmSpec: true, audit: true, solve: true, fix: true, palmFix: true, bcEvery: 2, pull: true };
  if (window.POSE_K) Object.assign(K, window.POSE_K);   // tools: window.POSE_K = { fix: false, palmSpec: false … } before load (A/B runs)
  const SLOTS = ['pelvis', 'legs', 'spine', 'look', 'arms', 'springs', 'contact', 'hands'];
  const RANK = Object.fromEntries(SLOTS.map((s, i) => [s, i]));
  const STATS = { frames: 0, applied: 0, bySource: {}, ms: 0, msMax: 0, err: null, foreign: {}, foreignFrames: 0, last: [] };
  let Q = [], AFTER = [], failed = false, A = null, bones = null, snap = null, T3 = null;
  // the corrections the solver asks the writers for (they read it while they build the next frame's pose)
  const MOD = { back: { x: 0, z: 0 }, lean: 1, handUp: 0, palm: { l: 0, r: 0 } };
  const TOL = 0.01, BACK_MAX = 0.14, PULL_MAX = 0.22, PULL_GAP = 0.05, LEAN_MIN = 0.25, HANDUP_MAX = 0.08, REJECT_S = 0.6;
  const SOL = { on: false, n: 0, ms: 0, msMax: 0, depth: 0, part: null, gap: 9, dir: null, lvl: 0, rejT: 0, rejected: 0, adjusted: 0, byPart: {}, worst: {}, worstOwn: {}, palm: { l: null, r: null }, last: null, near: 0 };
  const HANDLERS = {};
  const emit = (name, data) => { for (const fn of HANDLERS[name] || []) { try { fn(data); } catch (e) { console.warn('[pose-pipeline] ' + name + ' handler', e); } } };
  const on = (name, fn) => { (HANDLERS[name] = HANDLERS[name] || []).push(fn); };

  const ready = () => !!(A && A.mixer);
  // the palm of the drawn glove: the contact meta's own (meta.palm.<l|r>.inHand — where the clips lay the palm on the surface,
  // wrist = surface point − R_hand · inHand); else BODYSPEC.palm_* (measured on the glove by the same clips)
  const palmSpec = (side) => {
    const m = A && A.contactMeta && A.contactMeta.palm && A.contactMeta.palm[side.replace('_', '')];
    if (m && m.inHand) return { normal: m.normalHand || [side === '_l' ? 1 : -1, 0, 0], center: m.inHand };
    const p = window.BODYSPEC && BODYSPEC['palm' + side]; return p && p.normal && p.center ? p : null;
  };
  function active(name) { return K.on && K[name] !== false && !failed && ready(); }
  function request(r) { r.seq = Q.length; Q.push(r); }
  function after(fn) { AFTER.push(fn); }

  function hook() {   // snapshot right after the mixer: the audit's reference pose
    A = C.AV && C.AV.player; if (!A || !A.mixer || A.__poseHook) return;
    const root = A.mixer.getRoot(); bones = []; root.traverse((o) => { if (o.isBone) bones.push(o); });
    snap = bones.map((b) => b.quaternion.clone());
    const orig = A.update.bind(A);
    A.update = function (dt) { const r = orig(dt); rebase(); return r; };
    A.__poseHook = true;
  }
  // the reference pose = the mixer's output (+ interaction.js restoring the bones the clip does not animate, which calls this)
  function rebase() { if (!bones) return; A.__snapped = true; if (K.audit) for (let i = 0; i < bones.length; i++) snap[i].copy(bones[i].quaternion); }
  function audit() {
    if (!K.audit || !bones || !K.on) return;
    const PB = C.physbody; if (PB && PB.owns && PB.owns()) return;   // a ragdoll / get-up owns the whole body (exception, PHYSBODY.md)
    let any = false;
    for (let i = 0; i < bones.length; i++) if (!bones[i].quaternion.equals(snap[i])) { const n = bones[i].name; STATS.foreign[n] = (STATS.foreign[n] || 0) + 1; any = true; }
    if (any) STATS.foreignFrames++;
  }

  /* ---------------------------------------------------------------- PoseSolver (step 5) */
  let VOL = null, PALMS = null, _cp = {}, _ray = null, _root = null, _pa = null, _pb = null, _pq = null, _pp = null;
  function build() {
    if (VOL && PALMS) return true;
    const S = window.BODYSPEC; if (!S || !S.ready || !bones || !T3) return false;
    const by = {}; for (const b of bones) by[b.name.toLowerCase()] = b;
    // the measured limb radii include the puffy suit and the neighbouring torso vertices the fit hands to the nearest segment
    // (arm 0.17 / 0.15 m, thigh / shin 0.18 m): as volumes they sit 2-3x over the drawn limb. K.limbK scales them down to the
    // depth the drawn vertices reach (calibrated against tools/rockgallery's vertex test on the frozen lab)
    const out = [], cap = (part, f, t, r) => { const k = 1; if (by[f] && by[t] && r > 0.01) out.push({ part, a: by[f], b: by[t], r: r * k }); };
    if (by.head && S.helmet) out.push({ part: 'head', a: by.head, off: new T3.Vector3(S.helmet.center[0], S.helmet.center[1], S.helmet.center[2]), r: S.helmet.r });
    if (S.chest) cap('torso', 'spine_02', 'neck_01', S.chest.r);
    if (S.pelvis) cap('torso', 'pelvis', 'spine_02', S.pelvis.r);
    for (const sd of ['l', 'r']) { cap('arm', 'upperarm_' + sd, 'lowerarm_' + sd, S.arm.upperR); cap('arm', 'lowerarm_' + sd, 'hand_' + sd, S.arm.foreR); cap('leg', 'thigh_' + sd, 'calf_' + sd, S.leg.thighR); cap('leg', 'calf_' + sd, 'foot_' + sd, S.leg.shinR); }
    VOL = out; PALMS = {};
    for (const sd of ['l', 'r']) { const p = palmSpec('_' + sd) || S['palm_' + sd]; if (by['hand_' + sd] && p && p.center) PALMS[sd] = { bone: by['hand_' + sd], c: new T3.Vector3(p.center[0], p.center[1], p.center[2]) }; }
    return out.length > 0;
  }
  // signed distance of a world point to the nearest DRAWN rock triangle (> 0 outside, < 0 inside: parity of an upward ray);
  // rocks = [{ e, g }]. out = { d, inside, px, py, pz (the closest surface point) }
  const _o = { d: 9, inside: false, px: 0, py: 0, pz: 0 };
  function sdist(p, rocks) {
    let best = 9, bg = null;
    for (const rk of rocks) {
      const b = rk.e.box; if (p.x < b.min[0] - 0.7 || p.x > b.max[0] + 0.7 || p.z < b.min[2] - 0.7 || p.z > b.max[2] + 0.7 || p.y > b.max[1] + 0.7 || p.y < b.min[1] - 0.7) continue;
      const r = rk.g.boundsTree.closestPointToPoint(p, _cp); if (!r || r.distance >= best) continue;
      best = r.distance; bg = rk.g; _o.px = r.point.x; _o.py = r.point.y; _o.pz = r.point.z;
    }
    _o.inside = false;
    if (bg && best < 0.9) {
      if (!_ray) _ray = new T3.Ray(); _ray.origin.copy(p); _ray.direction.set(0, 1, 0);
      let hits = []; try { hits = bg.boundsTree.raycast(_ray, T3.DoubleSide) || []; } catch (e) { hits = []; }
      _o.inside = hits.length % 2 === 1;
    }
    _o.d = best; return _o;
  }
  function rocksNear() {
    const RB = window.ROCKBRAIN, I = window.INTERACT, P = C.player; if (!RB || !I || !I.bvhGeo || !RB.rockNear) return null;
    const out = [];
    for (const e of RB.rockNear()) {
      if (e.alive === false || !e.box) continue; const b = e.box;
      if (P.x < b.min[0] - 1.3 || P.x > b.max[0] + 1.3 || P.z < b.min[2] - 1.3 || P.z > b.max[2] + 1.3) continue;
      const g = I.bvhGeo(e); if (g && g.boundsTree) out.push({ e, g });
    }
    return out.length ? out : null;
  }
  const relaxMod = (dt, k) => {
    const f = Math.exp(-k * dt); MOD.back.x *= f; MOD.back.z *= f; MOD.handUp *= f; MOD.lean += (1 - MOD.lean) * (1 - f); MOD.palm.l *= f; MOD.palm.r *= f;
    if (Math.abs(MOD.back.x) + Math.abs(MOD.back.z) < 1e-4) MOD.back.x = MOD.back.z = 0; if (MOD.handUp < 1e-4) MOD.handUp = 0; if (MOD.lean > 0.9995) MOD.lean = 1;
    if (Math.abs(MOD.palm.l) < 1e-4) MOD.palm.l = 0; if (Math.abs(MOD.palm.r) < 1e-4) MOD.palm.r = 0;
  };
  function solve(dt) {
    const t0 = performance.now(), RB = window.ROCKBRAIN, own = !!(RB && (RB.state === 'act' || RB.state === 'hold'));
    const rocks = build() ? rocksNear() : null;
    SOL.near = rocks ? rocks.length : 0;
    if (!rocks) { SOL.depth = 0; SOL.gap = 9; SOL.part = null; SOL.byPart = {}; SOL.rejT = 0; SOL.lvl = 0; relaxMod(dt, 4); return; }
    _root = _root || A.mixer.getRoot(); _root.updateMatrixWorld(true);
    const pa = _pa, q = _pq, p = _pp;
    let depth = 0, dpart = null, gap = 9, dx = 0, dz = 0, byPart = {}, cgap = 9, cx = 0, cz = 0;
    // the REAL drawn suit against the drawn rock (BODYCONTACT: no shrunk volumes); every K.bcEvery-th frame, held in between
    const BCm = window.BODYCONTACT;
    if (own && BCm) {
      if ((SOL.bcN = (SOL.bcN || 0) + 1) % K.bcEvery === 0 || !SOL.bc) SOL.bc = BCm.measure(rocks, { margin: 0.5 });
      const R = SOL.bc, CO = window.CORE, plan = RB && RB.plan, pn = CO && plan ? CO.pairOf(plan.name) : null, PR = pn ? CO.PAIRS[pn] : null;
      SOL.pair = pn;
      if (R) {
        // violations = how far a part sits inside the surface BEYOND what its pair allows (CORE.PAIRS clear / touch tolerances, cm)
        for (const k in R.parts) {
          const P = R.parts[k], kind = k.replace(/_[lr]$/, ''); if (P.minSignedCm == null || kind === 'boot') continue;
          const allow = PR ? (PR.clear[kind] != null ? PR.clear[kind] : PR.touch[kind] != null ? PR.touch[kind] + 1 : 1.5) : 1;
          const dep = (-P.minSignedCm - allow) / 100; if (dep > (byPart[kind] || 0)) byPart[kind] = dep;
          if (dep > depth && P.vertex && P.point) { depth = dep; dpart = k; const ux = P.vertex[0] - P.point[0], uz = P.vertex[2] - P.point[2], hl = Math.hypot(ux, uz) || 1; dx = ux / hl; dz = uz / hl; }
        }
        // the part the pair draws toward the surface: its gap (cm → m) and the way out of the surface (horizontal)
        const pt = PR && PR.pull ? R.kinds[PR.pull.part] : null;
        if (pt && pt.minSignedCm != null && pt.vertex && pt.point) { cgap = pt.minSignedCm / 100 - PR.pull.gapCm / 100 + PULL_GAP; const ux = pt.vertex[0] - pt.point[0], uz = pt.vertex[2] - pt.point[2], hl = Math.hypot(ux, uz) || 1; cx = ux / hl; cz = uz / hl; }
        gap = cgap;
      }
    }
    SOL.n++; SOL.depth = depth; SOL.part = dpart; SOL.gap = gap; SOL.byPart = byPart;
    for (const k in byPart) { if (byPart[k] > (SOL.worst[k] || 0)) SOL.worst[k] = byPart[k]; if (own && byPart[k] > (SOL.worstOwn[k] || 0)) SOL.worstOwn[k] = byPart[k]; }
    // palms
    const hands = own && RB.hands ? RB.hands() : [];
    for (const sd of ['l', 'r']) {
      const pm = PALMS[sd]; if (!pm) continue;
      pm.bone.getWorldPosition(pa); pm.bone.getWorldQuaternion(q); pa.add(p.copy(pm.c).applyQuaternion(q));
      const o = sdist(pa, rocks), d = o.d > 0.9 ? 9 : o.inside ? -o.d : o.d;
      SOL.palm[sd] = d;
      if (K.fix && K.palmFix && hands.includes('hand_' + (sd === 'l' ? 'l' : 'r'))) {
        if (d > 0.01) MOD.palm[sd] = Math.max(-0.02, MOD.palm[sd] - Math.min(d - 0.005, 0.01));
        else if (d < -0.005) MOD.palm[sd] = Math.min(0.08, MOD.palm[sd] + Math.min(-d, 0.02));
      }
    }
    // the compromise chain (only while rock-brain acts: a stride past a rock / a step-up / a climb are not reposed)
    let lvl = 0;
    if (!K.fix) { lvl = 0; } else if (own && depth > TOL) {
      // the push-out room is measured ALONG the way out (a body that was drawn toward the surface has all the room to move back)
      const ex = depth - TOL, along = MOD.back.x * dx + MOD.back.z * dz;
      if (along < BACK_MAX - 1e-3 && (dx || dz)) {
        const add = Math.min(ex + 0.004, 0.04, BACK_MAX - along); let nx = MOD.back.x + dx * add, nz = MOD.back.z + dz * add; const nl = Math.hypot(nx, nz);
        if (nl > PULL_MAX) { nx *= PULL_MAX / nl; nz *= PULL_MAX / nl; }
        MOD.back.x = nx; MOD.back.z = nz; lvl = 1;
      } else if (MOD.lean > LEAN_MIN + 1e-3) { MOD.lean = Math.max(LEAN_MIN, MOD.lean - 0.12); lvl = 2; }
      else if (MOD.handUp < HANDUP_MAX - 1e-3) { MOD.handUp = Math.min(HANDUP_MAX, MOD.handUp + 0.012); lvl = 3; }
      else lvl = 4;
      SOL.adjusted++;
    } else if (own && K.pull && depth <= TOL && cgap > PULL_GAP && cgap < 0.5 && (cx || cz)) {
      // nothing inside and the chest hangs off the rock: slide the drawn body toward it (the missing direction of the chain)
      const add = Math.min(cgap - PULL_GAP + 0.004, 0.006); let nx = MOD.back.x - cx * add, nz = MOD.back.z - cz * add; const nl = Math.hypot(nx, nz);
      if (nl > PULL_MAX) { nx *= PULL_MAX / nl; nz *= PULL_MAX / nl; }
      MOD.back.x = nx; MOD.back.z = nz; lvl = -1; SOL.pulled = (SOL.pulled || 0) + 1;
    } else if (own && depth < 0.01 && gap > 0.03 && !K.pull) relaxMod(dt, 0.8);
    else if (!own) relaxMod(dt, 4);
    SOL.lvl = lvl;
    if (!K.fix) SOL.rejT = 0; else if (lvl === 4) SOL.rejT += dt; else if (depth <= TOL) SOL.rejT = 0;
    if (K.fix && own && SOL.rejT > REJECT_S) {
      SOL.rejected++; SOL.rejT = 0; SOL.last = { part: dpart, depthCm: +(depth * 100).toFixed(1), at: C.T };
      emit('PoseRejected', { part: dpart, depth, reason: 'volume inside the drawn rock' });
    }
    const ms = performance.now() - t0; SOL.ms = SOL.ms * 0.95 + ms * 0.05; SOL.msMax = Math.max(SOL.msMax * 0.999, ms);
  }
  // pelvis back: the drawn body slides horizontally on the feet (the wrap sits under the character group)
  function applyBack() {
    const B = (C.interaction || window.INTERACTION) && (C.interaction || window.INTERACTION).B; if (!B || !B.wrap || !B.wrap.parent) return;
    if (!MOD.back.x && !MOD.back.z) return;
    B.wrap.parent.getWorldQuaternion(_pq).invert(); _pp.set(MOD.back.x, 0, MOD.back.z).applyQuaternion(_pq);
    const sc = B.wrap.parent.getWorldScale(_pa).x || 1;
    B.wrap.position.x += _pp.x / sc; B.wrap.position.z += _pp.z / sc; B.wrap.updateMatrixWorld(true);
  }
  function run(dt) {
    const t0 = performance.now();
    Q.sort((a, b) => (RANK[a.slot] - RANK[b.slot]) || (a.seq - b.seq));
    const last = [];
    for (const r of Q) {
      r.apply(r.data, dt); STATS.applied++;
      if (r.slot === 'pelvis' && K.solve) applyBack();
      STATS.bySource[r.source] = (STATS.bySource[r.source] || 0) + 1; last.push(r.slot + ':' + r.source);
    }
    if (K.solve) solve(dt);
    for (const fn of AFTER) fn();
    STATS.last = last; Q = []; AFTER = [];
    const ms = performance.now() - t0; STATS.ms = STATS.ms * 0.95 + ms * 0.05; STATS.msMax = Math.max(STATS.msMax * 0.999, ms);
  }

  window.POSE = {
    K, STATS, SLOTS, active, request, after, rebase, MOD, SOL, on,
    // the palm targets of a hold, corrected by the solver's palm feedback / 'hands higher' (a new hit or the same one)
    hit(fn) { return (c) => { const h = fn(c); if (!h || !K.on || !K.solve || failed) return h; const sd = c.bone === 'hand_l' ? 'l' : c.bone === 'hand_r' ? 'r' : null; if (!sd) return h; const off = MOD.palm[sd], up = MOD.handUp; if (!off && !up) return h; return { point: h.point.clone().addScaledVector(h.normal, off).add({ x: 0, y: up, z: 0 }), normal: h.normal }; }; },
    get queue() { return Q.map((r) => r.slot + ':' + r.source); },
    get failed() { return failed; },
    reset() { failed = false; MOD.back.x = MOD.back.z = 0; MOD.lean = 1; MOD.handUp = 0; MOD.palm.l = MOD.palm.r = 0; SOL.worst = {}; SOL.worstOwn = {}; SOL.n = 0; SOL.adjusted = 0; SOL.rejected = 0; STATS.err = null; STATS.foreign = {}; STATS.foreignFrames = 0; },
  };
  (window.GameModules = window.GameModules || []).push({
    // after interaction (50) and rock-brain (49): the host walks the modules from the highest order down
    name: 'pose-pipeline', order: 46,
    init(ctx) { C = ctx; T3 = ctx.THREE; _pa = new T3.Vector3(); _pb = new T3.Vector3(); _pp = new T3.Vector3(); _pq = new T3.Quaternion(); ctx.pose = window.POSE; },
    update(dt) {
      if (!A || !A.__poseHook) hook();
      // the measured palm (BODYSPEC.palm_*: hand-local normal + contact centre) for the hand IK; off → the old wrist offset
      if (window.ANIMLIB) ANIMLIB.palmSpec = K.on && K.palmSpec && !failed && ((A && A.contactMeta && A.contactMeta.palm) || (window.BODYSPEC && BODYSPEC.palm_l && BODYSPEC.palm_r)) ? palmSpec : null;
      if (!ready()) { Q = []; AFTER = []; return; }
      STATS.frames++;
      if (A.__snapped) { A.__snapped = false; audit(); }
      if (failed) { Q = []; AFTER = []; return; }
      try { run(dt); } catch (e) { failed = true; STATS.err = String(e && e.stack || e).slice(0, 400); console.warn('[pose-pipeline] off:', e); Q = []; AFTER = []; }
    },
  });
})();
