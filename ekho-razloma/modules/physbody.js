/* Module "physbody" — the pilot's body reacts physically (PHYSBODY.md). Three layers, cheapest first:
 *
 *  1 springs      spine, head, upper arms, forearms: spring-damper secondary motion. Each chain has a tip (neck, top of
 *                 the head, elbow, wrist) that is a point mass following the animated tip in world space; the bone is
 *                 turned so it points at the simulated tip (the spring-bone idea of @pixiv/three-vrm-springbone, reduced
 *                 to what this non-VRM rig needs). Driven by the root's rigid-body acceleration (speed-up, braking,
 *                 turning, landing, bumps — scaled by an "active control" factor per chain), wind gusts (WX) and kicks
 *                 (hits, pushes, shoulder contacts). Pure JS, same code with or without WebAssembly.
 *  2 upper body   the same tips are collision bodies: each frame a sphere sweep (Rapier, the game's world geometry: terrain,
 *                 solids, trunks, props) stops a tip at the first surface, removes its velocity into it and hands part
 *                 of the correction to the chest — an elbow that meets a rock turns the arm and the shoulders away, the
 *                 spring pulls the pose back afterwards. Legs are not touched (animation + foot IK in interaction.js).
 *  3 ragdoll      only on events — a fall from height, a heavy hit (the golem), sliding into something at speed: 11
 *                 Rapier capsules + joints (physics.js createRagdoll) for 1–2 s, then LayToIdle (UAL1, CC0) gets up from
 *                 the ragdoll's pose. Without WebAssembly: Hit_Knockback → LayToIdle clips instead.
 *
 * interaction.js calls PHYSBODY.pose() inside its body update (after the leg IK, before its bone bookkeeping) and skips
 * its own legs / look / arms while PHYSBODY.owns() (ragdoll, fall clip, get-up). Every layer is guarded: an exception
 * turns that layer off, never the game.
 */
(function () {
  let C = null, T3 = null, V3 = null, Q = null;
  const K = {
    springs: true, upper: true, ragdoll: true, events: true,
    // k: stiffness (1/s²) · z: damping ratio · a: how much of the root's acceleration the tip feels (the rest the body
    // cancels by itself, a person is not a sack) · r: collision radius · max: largest bend (rad) · vp: vertical lag → forward bend
    ch: {
      spine: { k: 260, z: 0.8, a: 0.18, r: 0.15, max: 0.42, vp: 0.9, wind: 3.5 },
      head: { k: 260, z: 0.8, a: 0.15, r: 0.12, max: 0.38, vp: 0.9, wind: 2.5 },
      upper: { k: 130, z: 0.72, a: 0.2, r: 0.075, max: 0.9, vp: 0, wind: 4 },
      fore: { k: 140, z: 0.72, a: 0.22, r: 0.06, max: 0.85, vp: 0, wind: 4.5 },
    },
    accMax: 900, sub: 1 / 120, snap: 0.8, shoulderR: 0.27,
    hitKick: 1, couple: 0.45, wind: 1,
    checkPen: false, ragCcd: false, fallV: 15.5, fallH: 4.5, slideHitDv: 6, heavyR: 10, ragMin: 0.7, ragMax: 2.0, settleV: 0.45, settleT: 0.25,
    rollMax: 0.4, rollMinS: 0.12, rollTorque: 16,   // face-down roll onto the back: hard cap, min time before an early exit, torso torque (was 0.7 / 0.25 / 9)
    blendOut: 0.3,
    ragSolverIter: 2,   // world.numSolverIterations while a ragdoll is live (default 4): rare, ~1-2 s, brief quality dip is not visible
  };
  const STATS = { frames: 0, msSpring: 0, msRag: 0, msSpringMax: 0, contacts: 0, kicks: 0, hits: 0, ragdolls: 0, fallClips: 0, getups: 0, nan: 0, err: null };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  let _p = [], _q = [];
  const wpos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
  function wquat(o, out) { o.matrixWorld.decompose(_p[30], out, _p[31]); return out; }
  function worldDelta(bone, dq) {   // rotate a bone by a world-space delta: local = parentWorld⁻¹ · dq · world
    const pq = wquat(bone.parent, _q[10]), wq = wquat(bone, _q[11]);
    wq.premultiply(dq); pq.invert(); bone.quaternion.copy(pq.multiply(wq)); bone.updateMatrixWorld(true);
  }
  const len0 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const fin = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

  /* ------------------------------------------------------------------ setup */
  const S = { ready: false, bones: {}, chains: [], root: null, rootPrev: null, rootV: null, rootVPrev: null, yawPrev: 0, kicks: [], wind: 0, gustT: 0 };
  const CHAINS = [   // order matters: each chain reads its target after the ones before it have bent the skeleton
    { id: 'spine', p: 'spine', pivot: 'spine_01', tip: 'neck_01', rot: [['spine_01', 0.34], ['spine_02', 0.33], ['spine_03', 0.33]] },
    { id: 'head', p: 'head', pivot: 'neck_01', tip: 'Head', ext: 1.3, rot: [['neck_01', 0.4], ['Head', 0.6]] },
    { id: 'upper_l', p: 'upper', pivot: 'upperarm_l', tip: 'lowerarm_l', rot: [['upperarm_l', 1]], arm: 'l' },
    { id: 'upper_r', p: 'upper', pivot: 'upperarm_r', tip: 'lowerarm_r', rot: [['upperarm_r', 1]], arm: 'r' },
    { id: 'fore_l', p: 'fore', pivot: 'lowerarm_l', tip: 'hand_l', ext: 1.25, rot: [['lowerarm_l', 1]], arm: 'l' },
    { id: 'fore_r', p: 'fore', pivot: 'lowerarm_r', tip: 'hand_r', ext: 1.25, rot: [['lowerarm_r', 1]], arm: 'r' },
  ];
  function setup() {
    const A = C.AV && C.AV.player; if (!A || !A.mixer) return false;
    const root = A.mixer.getRoot(); S.root = root; S.A = A;
    for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r']) {
      const b = root.getObjectByName(n); if (!b) return false; S.bones[n] = b;
    }
    S.order = []; root.traverse((o) => { if (o.isBone) S.order.push(o); });
    S.chains = CHAINS.map((d) => ({ d, par: K.ch[d.p], x: new V3(), y: new V3(), yv: new V3(), t: new V3(), tPrev: new V3(), lp: new V3(), vr: new V3(), has: false, w: 0, ang: 0, sAng: new V3(), hit: 0 }));
    S.ready = true; return true;
  }

  /* ------------------------------------------------------------------ layer 1 + 2: springs with collision tips */
  // world position of a chain's tip on the CURRENT (already partly bent) skeleton
  function tipPos(c, out) {
    const b = S.bones, d = c.d, tp = wpos(b[d.tip], out);
    if (d.ext) { const pv = wpos(b[d.pivot], _p[20]); tp.sub(pv).multiplyScalar(d.ext).add(pv); }
    return tp;
  }
  function kick(filter, vx, vy, vz) {   // velocity kick on the tips' offsets (m/s)
    for (const c of S.chains) { const g = typeof filter === 'function' ? filter(c) : filter === 'all' || c.d.id === filter || c.d.p === filter ? 1 : 0; if (g) c.yv.x += vx * g, c.yv.y += vy * g, c.yv.z += vz * g; }
    STATS.kicks++;
  }
  function chainWeight(c, P, I) {
    const G = C.G, CL = C.CLIMB;
    if (!K.springs || G.riding || G.deadT > 0 || (CL && CL.t >= 0) || C.mode !== 'play') return 0;
    if (c.d.arm) {   // hands held by something else: climbing edge, pushed prop, contact layer hold, aiming
      if (P.aimT > 0) return 0;
      const arms = I && I.B && I.B.arms; if (arms && arms.mode && arms.w > 0.01) return 1 - arms.w;
      if ((I && I.CT && I.CT.state === 'play') || (window.ROCKBRAIN && ROCKBRAIN.ownsAnim())) return 0;
    }
    return 1;
  }
  const _col = { o: { x: 0, y: 0, z: 0 }, d: { x: 0, y: 0, z: 0 } };
  function collide(c, from, to) {   // sphere sweep from → to against the world; returns the corrected position + normal
    const PH = C.PH; if (!PH.ok || !K.upper) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz); if (L < 1e-3) return null;
    _col.o.x = from.x; _col.o.y = from.y; _col.o.z = from.z; _col.d.x = dx / L; _col.d.y = dy / L; _col.d.z = dz / L;
    const G = PH.P.groups, h = PH.P.sphereCast(_col.o, _col.d, L, c.par.r, { groups: G.STATIC | G.TRUNK | G.PROP });
    if (!h || !h.normal) return null;
    const n = h.normal; let nx = n.x, ny = n.y, nz = n.z; if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    const s = Math.max(0, h.distance - 0.005);
    return { x: from.x + _col.d.x * s, y: from.y + _col.d.y * s, z: from.z + _col.d.z * s, nx, ny, nz, tag: h.tag };
  }
  function springs(dt, F) {
    const P = C.player, I = window.INTERACTION, g = C.player.c.g;
    // root rigid motion: the tips feel how the whole body is carried (translation + yaw), not the clip's own limb swings
    const rp = _p[0].set(P.x, P.y, P.z);
    if (!S.rootPrev) { S.rootPrev = rp.clone(); S.rootV = new V3(); S.rootVPrev = new V3(); S.yawPrev = g.rotation.y; }
    const jump = rp.distanceTo(S.rootPrev) > 3;   // teleport / respawn
    S.rootV.subVectors(rp, S.rootPrev).divideScalar(Math.max(dt, 1e-3)); if (jump) S.rootV.set(0, 0, 0);
    const acc = _p[1].subVectors(S.rootV, S.rootVPrev).divideScalar(Math.max(dt, 1e-3)); if (acc.length() > K.accMax) acc.setLength(K.accMax);
    let dyaw = g.rotation.y - S.yawPrev; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    const yawRate = jump ? 0 : dyaw / Math.max(dt, 1e-3);
    S.rootPrev.copy(rp); S.rootVPrev.copy(S.rootV); S.yawPrev = g.rotation.y;
    // wind: blizzard strength with slow gusts, blowing the way the falling snow drifts (+x, a little +z)
    S.gustT += dt; const storm = (C.WX && C.WX.storm) || 0;
    const gust = storm * (0.55 + 0.3 * Math.sin(S.gustT * 0.9) + 0.25 * Math.sin(S.gustT * 2.3 + 1.1) + 0.15 * Math.sin(S.gustT * 5.1)) * K.wind;
    S.wind = gust;
    const n = Math.max(1, Math.min(8, Math.ceil(dt / K.sub))), h = dt / n;
    for (const c of S.chains) {
      const par = c.par, d = c.d, b = S.bones;
      const wT = chainWeight(c, P, I); c.w = damp(c.w, wT, wT > c.w ? 6 : 12, dt);
      const t = tipPos(c, c.t), pv = wpos(b[d.pivot], _p[2]);
      if (!c.has || jump || c.w < 0.002) { c.y.set(0, 0, 0); c.yv.set(0, 0, 0); c.x.copy(t); c.has = true; c.ang = 0; if (c.w < 0.002) continue; }
      // rigid-body acceleration of this tip: root acceleration + yaw (centripetal + angular acceleration ignored: small)
      const rx = t.x - P.x, rz = t.z - P.z;
      const ax = acc.x - yawRate * yawRate * rx, ay = acc.y, az = acc.z - yawRate * yawRate * rz;
      const kk = par.k, cc = 2 * par.z * Math.sqrt(par.k), al = par.a;
      const ex = S.wind * par.wind * 0.98, ez = S.wind * par.wind * 0.18;
      for (let i = 0; i < n; i++) {   // implicit Euler on the offset y = tip − target (stable at any fps)
        const den = 1 + h * cc + h * h * kk;
        c.yv.x = (c.yv.x + h * (-kk * c.y.x - al * ax + ex)) / den; c.y.x += h * c.yv.x;
        c.yv.y = (c.yv.y + h * (-kk * c.y.y - al * ay)) / den; c.y.y += h * c.yv.y;
        c.yv.z = (c.yv.z + h * (-kk * c.y.z - al * az + ez)) / den; c.y.z += h * c.yv.z;
      }
      if (!fin(c.y) || !fin(c.yv) || c.y.length() > K.snap) { c.y.set(0, 0, 0); c.yv.set(0, 0, 0); STATS.nan += fin(c.y) ? 0 : 1; }
      // layer 2: the tip is a body in the world — sweep from where it was drawn to where the spring puts it
      const want = _p[3].addVectors(t, c.y);
      c.hit = Math.max(0, c.hit - dt);
      const hc = collide(c, c.x, want);
      if (hc) {
        const cx = hc.x - want.x, cy = hc.y - want.y, cz = hc.z - want.z;   // push-out correction
        c.y.x += cx; c.y.y += cy; c.y.z += cz;
        // world velocity of the tip = target velocity + offset velocity; remove the part going into the surface
        const vt = _p[4].subVectors(t, c.tPrev).divideScalar(Math.max(dt, 1e-3));
        const vn = (vt.x + c.yv.x) * hc.nx + (vt.y + c.yv.y) * hc.ny + (vt.z + c.yv.z) * hc.nz;
        if (vn < 0) { c.yv.x -= vn * hc.nx; c.yv.y -= vn * hc.ny; c.yv.z -= vn * hc.nz; c.yv.multiplyScalar(0.85); }
        // an arm stopped by a rock turns the shoulders (and a little the head) away from it
        if (d.arm) { const k = K.couple / Math.max(dt, 1 / 60); for (const o of S.chains) if (o.d.id === 'spine' || o.d.id === 'head') { const f = o.d.id === 'spine' ? 0.35 : 0.15; o.yv.x += cx * k * f; o.yv.y += cy * k * f * 0.3; o.yv.z += cz * k * f; } }
        if (c.hit <= 0) STATS.contacts++;
        c.hit = 0.25;
      }
      // the shoulders: wider than the tips, they meet a rock face the capsule only grazes (the controller's capsule is
      // 0.4 m wide at every height; a shoulder is 0.22 m from the centre line) — probe spheres at the shoulder joints ride
      // on the chest offset and push it away from whatever they sink into
      if (d.id === 'spine' && K.upper && C.PH.ok && C.PH.P.nearestSurface && !(I && I.CT && I.CT.state === 'play') && !(window.ROCKBRAIN && ROCKBRAIN.ownsAnim()) && !(I && I.B && I.B.arms && I.B.arms.mode === 'push')) {
        const lever = Math.max(0.2, len0(t, pv));
        for (const sn of ['upperarm_l', 'upperarm_r']) {
          const sp = wpos(b[sn], _p[21]), lam = clamp(sp.distanceTo(pv) / lever, 0.5, 1.2);
          const ctr = _p[22].copy(sp).addScaledVector(c.y, lam), h2 = C.PH.P.nearestSurface(ctr, { groups: C.PH.P.groups.STATIC | C.PH.P.groups.TRUNK });
          if (!h2 || h2.dist >= K.shoulderR || (h2.tag && h2.tag.kind === 'terrain')) continue;
          const push = (K.shoulderR - h2.dist) / lam, n2 = h2.normal;
          c.y.x += n2.x * push; c.y.z += n2.z * push;   // horizontal: the chest gives way sideways / backwards
          const vn = c.yv.x * n2.x + c.yv.z * n2.z; if (vn < 0) { c.yv.x -= vn * n2.x; c.yv.z -= vn * n2.z; }
          if (c.hit <= 0) STATS.contacts++; c.hit = 0.25; STATS.shoulder = (STATS.shoulder || 0) + 1;
        }
      }
      c.x.addVectors(t, c.y); c.tPrev.copy(t);
      // bend: rotation turning the animated pivot→tip direction to the simulated one (vertical lag → forward bend)
      const d0 = _p[5].subVectors(t, pv), len = d0.length(); if (len < 1e-4) continue; d0.divideScalar(len);
      const d1 = _p[6].subVectors(c.x, pv);
      if (par.vp) { const vy = c.y.y; d1.x += F.x * -vy * par.vp; d1.z += F.z * -vy * par.vp; d1.y -= vy; }
      d1.normalize();
      let ang = Math.acos(clamp(d0.dot(d1), -1, 1));
      if (ang > par.max) {   // clamp: the tip is dragged along the cone (no hyper-bent limb, no runaway offset)
        const ax2 = _p[7].crossVectors(d0, d1); if (ax2.lengthSq() < 1e-10) continue; ax2.normalize();
        d1.copy(d0).applyAxisAngle(ax2, par.max); ang = par.max;
        const nx = _p[8].copy(pv).addScaledVector(d1, _p[9].subVectors(c.x, pv).length());
        if (!par.vp) { c.y.subVectors(nx, t); c.x.copy(nx); }
      }
      c.ang = ang * c.w;
      c.sAng.subVectors(c.x, t);   // signed offset (tests read it along the push direction)
      if (ang < 1e-4) continue;
      const q = _q[0].setFromUnitVectors(d0, d1);
      for (const [bn, f] of d.rot) worldDelta(b[bn], _q[1].identity().slerp(q, f * c.w));
    }
  }

  /* ------------------------------------------------------------------ events: hits, bumps, landings, slides */
  const EV = { lastHurt: null, vPrev: null, air: 0, minVy: 0, wasG: true, slideV: 0, hp: null };
  function events(dt) {
    const P = C.player, G = C.G; if (!K.events || C.mode !== 'play' || G.riding || G.deadT > 0) { EV.vPrev = null; return; }
    const v = _p[12].set(P.vx, P.vy || 0, P.vz);
    if (EV.lastHurt === null) EV.lastHurt = P.lastHurt;
    // hit: the game adds a 12 m/s knock-back along the hit direction in the same frame (playerHurt)
    if (P.lastHurt !== EV.lastHurt) {
      EV.lastHurt = P.lastHurt;
      let dx = 0, dz = 0; if (EV.vPrev) { dx = v.x - EV.vPrev.x; dz = v.z - EV.vPrev.z; } const l = Math.hypot(dx, dz);
      if (l > 1) { dx /= l; dz /= l; } else { const f = C.player.c.g.rotation.y; dx = Math.sin(f); dz = Math.cos(f); }   // unknown: from the front
      const B = C.boss, heavy = B && B.active && !B.dead && Math.hypot(B.x - P.x, B.z - P.z) < K.heavyR;
      STATS.hits++;
      if (heavy && !RG.st) trigger('hit', { x: dx * 6, y: 3, z: dz * 6 });
      else hit(dx, dz, 1);
    }
    // landing from height: fall speed at touchdown
    if (!P.onGround) { if (EV.air === 0) EV.topY = P.y; EV.air += dt; EV.minVy = Math.min(EV.minVy, P.vy || 0); EV.topY = Math.max(EV.topY, P.y); }
    else {
      if (!EV.wasG && EV.air > 0.15) {
        const vl = -EV.minVy;
        // a real drop: fast AND from well above where it lands (a knock-back hop off a 3 m altar is a landing, not a fall)
        if (vl > K.fallV && (EV.topY || P.y) - P.y > K.fallH && !RG.st) trigger('fall', null);   // the body keeps (part of) its running speed, see buildRagdoll
        else if (vl > 3) landKick(vl);
      }
      EV.air = 0; EV.minVy = 0;
    }
    EV.wasG = P.onGround;
    // sliding down a steep face into something: the speed dies in one frame
    if (EV.vPrev && P.sliding !== undefined) {
      const was = Math.hypot(EV.vPrev.x, EV.vPrev.z), now = Math.hypot(v.x, v.z);   // horizontal: the slope flattening out is not an impact
      if (EV.sliding && was > 7 && was - now > K.slideHitDv && !RG.st) trigger('slide', { x: EV.vPrev.x * 0.5, y: 1, z: EV.vPrev.z * 0.5 });
    }
    EV.sliding = !!P.sliding;
    EV.vPrev = EV.vPrev || new V3(); EV.vPrev.copy(v);
  }
  // a push / hit: the chest and head go with it, the arms fly a little up and out, the springs bring them back
  function hit(dx, dz, k = 1) {
    const s = K.hitKick * k;
    kick('spine', dx * 2.8 * s, 0, dz * 2.8 * s); kick('head', dx * 1.6 * s, 0.3 * s, dz * 1.6 * s);
    kick('upper', dx * 2.0 * s, 1.2 * s, dz * 2.0 * s); kick('fore', dx * 2.6 * s, 1.6 * s, dz * 2.6 * s);
  }
  function landKick(v) {   // touchdown: head nods, chest folds, arms drop — scaled by the landing speed
    const s = clamp((v - 3) / 12, 0, 1.2);
    kick('spine', 0, -1.6 * s, 0); kick('head', 0, -2.2 * s, 0); kick('upper', 0, -1.5 * s, 0); kick('fore', 0, -2.0 * s, 0);
  }

  const RAGD = window.createPhysbodyRagdoll({ S, _p, K, wpos, STATS, _q, wquat, clamp });   // physbody-ragdoll.js
  const { RG, owns, freezeTick, trigger, buildRagdoll, poseRagdoll, ragUpdate, abortRag, poseBlend, seqUpdate } = RAGD;
  /* ------------------------------------------------------------------ per-frame entry points */
  // interaction.js bodyUpdate → after the leg IK / look / arms, before it records the bones
  function pose(dt, F) {
    if (!S.ready && !setup()) return;
    const t0 = performance.now();
    try {
      if (RG.st === 'rag' || RG.st === 'roll') poseRagdoll();
      else if (RG.st === 'blend') poseBlend(dt);
      else if (!RG.st) springs(dt, F);
      if (!RG.st || RG.st === 'rag') { const pv = S.bones.pelvis.matrixWorld.elements; if (!Number.isFinite(pv[12] + pv[13] + pv[14])) { STATS.nan++; if (RG.st) abortRag(); } }
    } catch (e) { STATS.err = String(e && e.stack || e).slice(0, 400); if (RG.st) { try { abortRag(); } catch (e2) { /* */ } } else K.springs = false; console.warn('[physbody] pose disabled', e); }
    const ms = performance.now() - t0;
    if (RG.st) STATS.msRag = STATS.msRag * 0.9 + ms * 0.1; else { STATS.msSpring = STATS.msSpring * 0.95 + ms * 0.05; STATS.msSpringMax = Math.max(STATS.msSpringMax * 0.995, ms); }
  }
  function update(dt) {
    if (!S.ready && !setup()) return;
    STATS.frames++;
    const t0 = performance.now();
    try {
      // the game (or a test / the QA bot) moved the pilot while it lay or got up: that move wins, the sequence ends
      if (RG.st && RG.hold && Math.hypot(C.player.x - RG.hold.x, C.player.z - RG.hold.z) > 1.5) { STATS.teleportAborts = (STATS.teleportAborts || 0) + 1; const p = { x: C.player.x, y: C.player.y, z: C.player.z }; abortRag(); C.player.x = p.x; C.player.y = p.y; C.player.z = p.z; if (C.PH.ok && C.PH.ch) C.PH.ch.setPosition(p.x, p.y, p.z); }
      if (RG.st && (C.G.deadT > 0 || C.mode !== 'play' || C.G.riding)) abortRag();   // died / quit mid-fall: the game takes over
      if (!RG.st) events(dt);
      if (RG.st === 'rag' || RG.st === 'roll') ragUpdate(dt);
      if (RG.st) { seqUpdate(dt); if (RG.st) freezeTick(); }
    } catch (e) { STATS.err = String(e && e.stack || e).slice(0, 400); console.warn('[physbody] update', e); try { abortRag(); } catch (e2) { /* */ } }
    if (RG.st) STATS.msRag = STATS.msRag * 0.9 + (performance.now() - t0) * 0.1;
  }

  const PBTESTS = window.createPhysbodyTests({ RG, STATS, S, K, _p, hit, springs, trigger });   // physbody-tests.js
  const { flatSpot, findSlope, findLedge, testPush, testHit, findWall, testBump, testFall, cost, testStop } = PBTESTS;

  window.PHYSBODY = { K, STATS, S, RG, EV, owns, pose, update, kick, hit, trigger, mode: () => (C && C.PH && C.PH.ok ? 'rapier' : 'js'), testPush, testHit, testBump, testFall, testStop, cost, flatSpot, findSlope, findLedge, findWall };
  (window.GameModules = window.GameModules || []).push({
    name: 'physbody',
    order: 55,   // updated before interaction (the host walks the list backwards): events first, then interaction poses
    init(ctx) {
      C = ctx; T3 = ctx.THREE; V3 = T3.Vector3; Q = T3.Quaternion;
      PBTESTS.bind({ C, V3 }); RAGD.bind({ C, T3, V3, Q });   // the ragdoll layer and the measurement helpers live in physbody-ragdoll.js and physbody-tests.js
      if (window.PHYSBODY_OFF) { K.springs = K.upper = K.ragdoll = K.events = false; if (window.INTERACTION) INTERACTION.K.footLock = false; }   // A/B: the whole layer off (tests / bisecting)
      for (let i = 0; i < 42; i++) _p.push(new V3()); for (let i = 0; i < 12; i++) _q.push(new Q());
      ctx.physbody = window.PHYSBODY;
      // the fall / knock-back / get-up clips (UAL1, CC0 — cut out of the pilot's own pack: tools/anim/extract_clips.mjs)
      if (ctx.loadPacked) try { ctx.loadPacked('anim_pilot_fall', ctx.ASSET || 'assets/', (g) => { RG.clips = g.animations; }); } catch (e) { console.warn('[physbody] clips', e); }
    },
    update(dt) { update(dt); },
  });
})();
