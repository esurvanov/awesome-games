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
      if (I && I.CT && I.CT.state === 'play') return 0;
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
      if (d.id === 'spine' && K.upper && C.PH.ok && C.PH.P.nearestSurface && !(I && I.CT && I.CT.state === 'play') && !(I && I.B && I.B.arms && I.B.arms.mode === 'push')) {
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

  /* ------------------------------------------------------------------ layer 3: event ragdoll (Rapier) / fall clips */
  const RG = { st: null, t: 0, rd: null, parts: null, snap: null, still: 0, why: '', pen: 0, clips: null, ragW: null, face: 0, savedContact: null, t0: 0, log: [] };
  const RAG = [   // part, bone it drives, capsule from → to (bone names / extension), radius, mass
    { n: 'pelvis', bone: 'pelvis', a: 'thigh_l', b: 'thigh_r', r: 0.12, m: 12 },
    { n: 'torso', bone: 'spine_02', a: 'spine_02', b: 'neck_01', r: 0.15, m: 22 },
    { n: 'head', bone: 'neck_01', a: 'neck_01', b: 'Head', ext: 2.1, r: 0.11, m: 5 },
    { n: 'upper_l', bone: 'upperarm_l', a: 'upperarm_l', b: 'lowerarm_l', r: 0.055, m: 2.5 },
    { n: 'upper_r', bone: 'upperarm_r', a: 'upperarm_r', b: 'lowerarm_r', r: 0.055, m: 2.5 },
    { n: 'fore_l', bone: 'lowerarm_l', a: 'lowerarm_l', b: 'hand_l', ext: 1.35, r: 0.05, m: 1.8 },
    { n: 'fore_r', bone: 'lowerarm_r', a: 'lowerarm_r', b: 'hand_r', ext: 1.35, r: 0.05, m: 1.8 },
    { n: 'thigh_l', bone: 'thigh_l', a: 'thigh_l', b: 'calf_l', r: 0.075, m: 8 },
    { n: 'thigh_r', bone: 'thigh_r', a: 'thigh_r', b: 'calf_r', r: 0.075, m: 8 },
    { n: 'calf_l', bone: 'calf_l', a: 'calf_l', b: 'foot_l', ext: 1.12, r: 0.06, m: 4 },
    { n: 'calf_r', bone: 'calf_r', a: 'calf_r', b: 'foot_r', ext: 1.12, r: 0.06, m: 4 },
  ];
  const JOINTS = [   // parent, child, anchor bone, hinge (elbow / knee) or ball
    [0, 1, 'spine_02'], [1, 2, 'neck_01'], [1, 3, 'upperarm_l'], [1, 4, 'upperarm_r'], [3, 5, 'lowerarm_l', 'elbow'], [4, 6, 'lowerarm_r', 'elbow'],
    [0, 7, 'thigh_l'], [0, 8, 'thigh_r'], [7, 9, 'calf_l', 'knee'], [8, 10, 'calf_r', 'knee'],
  ];
  function clipsReady() {
    const A = S.A; if (!A || !RG.clips) return false;
    for (const c of RG.clips) if (!A.acts[c.name]) A.acts[c.name] = A.mixer.clipAction(c);
    return !!(A.acts.pb_getup && A.acts.pb_knock);
  }
  const owns = () => !!RG.st;
  function freezeStart() {
    const P = C.player, PH = C.PH, I = window.INTERACTION;
    RG.hold = { x: P.x, y: P.y, z: P.z };
    if (PH.ok && PH.ch) { PH.ch.setEnabled(false); }
    if (I && I.K) { RG.savedContact = I.K.contact; I.K.contact = false; if (I.CT) { I.CT.state = 'idle'; I.CT.pick = null; I.CT.phase = null; } }
    for (const c of S.chains) { c.has = false; c.w = 0; }
  }
  function freezeEnd() {
    const P = C.player, PH = C.PH, I = window.INTERACTION;
    if (PH.ok && PH.ch && !C.G.riding) { PH.ch.setEnabled(true); PH.ch.setPosition(P.x, P.y + 0.05, P.z); PH.ch.setVelocity(0, 0, 0); const o = PH.ch.state; if (o && o.velocity) o.velocity.x = o.velocity.z = 0; }
    if (I && I.K && RG.savedContact !== null) I.K.contact = RG.savedContact;
    RG.savedContact = null;
    if (RG.solverSaved != null) { try { const w = C.PH.ok && C.PH.P.world; if (w) w.numSolverIterations = RG.solverSaved; } catch (e) { /* world gone */ } RG.solverSaved = null; }
    if (S.A) S.A.lock = 0;
    RG.st = null; RG.t = 0;
  }
  // keep the body where the event put it: no walking while lying / getting up (the game still reads the keys)
  function freezeTick() {
    const P = C.player, PH = C.PH, h = RG.hold; if (!h) return;
    P.x = h.x; P.y = h.y; P.z = h.z; P.vx = P.vz = 0;
    if (PH.ok && PH.ch) { PH.ch.setPosition(h.x, h.y, h.z); const o = PH.ch.state; if (o && o.velocity) { o.velocity.x = o.velocity.y = o.velocity.z = 0; } }
    P.c.g.position.set(h.x, h.y, h.z);
  }
  function groundY(x, z, from) {
    const PH = C.PH; if (PH.ok) { const hh = PH.P.raycast({ x, y: from + 1.5, z }, { x: 0, y: -1, z: 0 }, 6, { groups: PH.P.groups.STATIC }); if (hh) return hh.point.y; }
    return C.groundH(x, z);
  }
  function trigger(why, imp) {
    const G = C.G, P = C.player;
    if (RG.st || !S.ready || C.mode !== 'play' || G.riding || G.deadT > 0 || (C.CLIMB && C.CLIMB.t >= 0)) return false;
    RG.why = why; RG.t = 0; RG.t0 = performance.now(); RG.pen = 0; RG.still = 0; RG.log = [];
    console.warn('[physbody] ' + why + ' → ' + (K.ragdoll && C.PH.ok ? 'ragdoll' : 'fall clip') + ' at ' + P.x.toFixed(1) + ',' + P.z.toFixed(1));   // visible in QA logs
    const useRag = K.ragdoll && C.PH.ok && C.PH.P.createRagdoll;
    if (useRag && buildRagdoll(imp)) {
      RG.st = 'rag'; STATS.ragdolls++; freezeStart(); S.A.lock = 99;
      // cheaper solve while the ragdoll is live (1-2 s, rare): the whole world briefly gets fewer solver iterations —
      // restored in freezeEnd(). A ragdoll lying down / getting up needs no more contact precision than that.
      try { const w = C.PH.P.world; if (w) { RG.solverSaved = w.numSolverIterations; w.numSolverIterations = K.ragSolverIter; } } catch (e) { RG.solverSaved = null; }
      return true;
    }
    if (!clipsReady()) return false;
    // no WebAssembly (or no ragdoll): knocked back onto the back, then get up — same clips the ragdoll hands over to
    RG.st = 'clip'; STATS.fallClips++; freezeStart();
    if (imp && Math.hypot(imp.x, imp.z) > 0.5) { P.face = Math.atan2(imp.x, imp.z); P.c.g.rotation.y = P.face; }   // knocked away from the hit
    S.A.lock = 0; S.A.once('pb_knock', RG.clips.find((c) => c.name === 'pb_knock').duration - 0.02, 0.12);
    return true;
  }
  function buildRagdoll(imp) {
    const b = S.bones, P = C.player, PH = C.PH; S.root.updateMatrixWorld(true);
    const pos = (n) => wpos(b[n], new V3());
    const parts = [], meta = [];
    // a hard landing eats most of the run-up (legs buckle, the snow brakes): ~half the horizontal speed goes into the tumble
    const hk = RG.why === 'fall' ? 0.5 : 1, up = new V3(0, 1, 0), vel = new V3(P.vx * hk, Math.max(-3, Math.min(3, P.vy || 0)), P.vz * hk);
    const F = new V3(-Math.sin(P.c.g.rotation.y), 0, -Math.cos(P.c.g.rotation.y));
    for (const R of RAG) {
      let a = pos(R.a), e = pos(R.b);
      if (R.n === 'pelvis') { const pv = pos('pelvis'); a.y = e.y = (a.y + e.y) / 2 * 0.5 + pv.y * 0.5; }
      if (R.ext) e = a.clone().add(e.sub(a).multiplyScalar(R.ext));
      const dir = e.clone().sub(a), L = dir.length(); dir.divideScalar(L || 1);
      const c = a.clone().add(e).multiplyScalar(0.5); c.y += 0.03;
      const q = new Q().setFromUnitVectors(up, dir);
      const v = vel.clone();
      if (imp) { const k = R.n === 'torso' || R.n === 'head' ? 1.25 : R.n.startsWith('upper') || R.n.startsWith('fore') ? 1.1 : 0.7; v.x += imp.x * k; v.y += (imp.y || 0) * k; v.z += imp.z * k; }
      // tip over backwards (lands on the back, where the get-up starts): chest back, hips forward
      if (R.n === 'torso' || R.n === 'head') v.addScaledVector(F, -1.4); if (R.n.startsWith('thigh') || R.n === 'pelvis') v.addScaledVector(F, 0.6);
      parts.push({ p: c, q, shape: 'capsule', r: R.r, hh: Math.max(0.02, L / 2 - R.r * 0.6), mass: R.m, v, ccd: K.ragCcd && (R.n === 'pelvis' || R.n === 'torso') });
      meta.push({ R, c0: c.clone(), bw: wquat(b[R.bone], new Q()).clone(), bp: pos(R.bone) });
    }
    const joints = [];
    for (const [pa, ch, an, kind] of JOINTS) {
      const J = { a: pa, b: ch, anchor: pos(an) };
      if (kind) {   // hinge: bend plane of the limb; limits keep the elbow / knee from bending backwards
        const u = parts[pa].p.clone().sub(J.anchor).negate().normalize(), f = parts[ch].p.clone().sub(J.anchor).normalize();
        let ax = new V3().crossVectors(u, f); const bend = Math.acos(clamp(u.dot(f), -1, 1));
        if (ax.lengthSq() < 0.0025) ax = kind === 'knee' ? new V3(Math.cos(P.c.g.rotation.y), 0, -Math.sin(P.c.g.rotation.y)).negate() : new V3(Math.cos(P.c.g.rotation.y), 0, -Math.sin(P.c.g.rotation.y));
        ax.normalize(); J.hinge = ax; J.limits = [0.03 - bend, (kind === 'knee' ? 2.5 : 2.6) - bend];
      }
      joints.push(J);
    }
    let rd = null; try { rd = PH.P.createRagdoll(parts, joints, { angDamp: 2.2, linDamp: 0.2 }); } catch (e) { STATS.err = 'ragdoll: ' + e.message; return false; }
    RG.rd = rd; RG.meta = meta;
    // bones outside the ragdoll keep their local pose from this instant (fingers, feet, spine_01/03, clavicles, Head)
    RG.snap = new Map(); for (const o of S.order) RG.snap.set(o, { q: o.quaternion.clone(), p: o.position.clone() });
    RG.bodyOf = new Map(); meta.forEach((m, i) => RG.bodyOf.set(S.bones[m.R.bone], i));
    return true;
  }
  const _rp = { x: 0, y: 0, z: 0 }, _rq = { x: 0, y: 0, z: 0, w: 1 };
  // write the ragdoll into the skeleton: ragdoll bones get body rotation × their start rotation (the bodies started with
  // the identity), the pelvis also its position; everything else its frozen local pose — parents first
  function poseRagdoll() {
    const rd = RG.rd; if (!rd) return;
    const g = C.player.c.g; g.updateMatrixWorld(true);
    const pw = _q[3], m4 = _p[25].m || (_p[25].m = new T3.Matrix4()), inv = _p[26].m || (_p[26].m = new T3.Matrix4());
    for (const o of S.order) {
      const s = RG.snap.get(o); o.quaternion.copy(s.q); o.position.copy(s.p);
      const i = RG.bodyOf.get(o);
      if (i !== undefined) {
        const M = RG.meta[i]; rd.pose(i, _rp, _rq);
        const bq = _q[4].set(_rq.x, _rq.y, _rq.z, _rq.w);
        const wq = _q[5].copy(bq).multiply(M.bw);
        o.parent.updateWorldMatrix(false, false); wquat(o.parent, pw);
        o.quaternion.copy(pw.invert().multiply(wq));
        if (M.R.bone === 'pelvis') {   // world position: body transform applied to the bone's start offset
          const off = _p[27].subVectors(M.bp, M.c0).applyQuaternion(bq).add(_p[28].set(_rp.x, _rp.y, _rp.z));
          inv.copy(o.parent.matrixWorld).invert(); o.position.copy(off.applyMatrix4(inv));
        }
      }
      o.updateMatrix(); o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    void m4;
  }
  function ragUpdate(dt) {
    const rd = RG.rd, P = C.player;
    RG.t += dt;
    // the camera and the game follow the pelvis: player = ground under the pelvis body
    rd.pose(0, _rp, _rq); const px = _rp.x, pz = _rp.z;
    if (!Number.isFinite(px + _rp.y + pz)) { STATS.nan++; abortRag(); return; }
    RG.hold = { x: px, y: groundY(px, pz, _rp.y), z: pz };
    if (K.checkPen) RG.pen = Math.max(RG.pen, rd.penetrating(0.05));   // test-only: 11 shape queries
    const sp = rd.maxSpeed(); RG.still = sp < K.settleV ? RG.still + dt : 0;
    if (RG.st === 'rag' && RG.t > K.ragMin && (RG.still > K.settleT || RG.t > K.ragMax)) {
      if (faceDown() && K.rollMax > 0) { RG.st = 'roll'; RG.rollT = 0; }
      else startGetup();
    } else if (RG.st === 'roll') {   // on the chest: roll over onto the back (the get-up starts on the back) — no
      // stomach get-up clip exists (UAL1 has none, see PHYSBODY.md), so this stays a physical roll; kept quick and
      // brief rather than a slow visible tumble: stronger torque flips it in a few frames, a short min-gate lets it
      // cut to the get-up as soon as it's over (was 9/4 torque, 0.25 s min, 0.7 s cap — visibly rolled for up to 0.7 s)
      RG.rollT += dt;
      const ax = axisHeadToFeet(); const s = RG.rollSign || (RG.rollSign = 1), tq = K.rollTorque;
      rd.torque(1, { x: ax.x * tq * s * dt * 60 * 0.05, y: ax.y * tq * s * dt * 60 * 0.05, z: ax.z * tq * s * dt * 60 * 0.05 });
      rd.torque(0, { x: ax.x * tq * 0.44 * s * dt * 60 * 0.05, y: ax.y * tq * 0.44 * s * dt * 60 * 0.05, z: ax.z * tq * 0.44 * s * dt * 60 * 0.05 });
      if (!faceDown() && RG.rollT > K.rollMinS || RG.rollT > K.rollMax) startGetup();
    }
  }
  function chestNormal() {
    const b = S.bones, cl = wpos(b.clavicle_l, _p[13]), cr = wpos(b.clavicle_r, _p[14]), nk = wpos(b.neck_01, _p[15]), pv = wpos(b.pelvis, _p[16]);
    return _p[17].subVectors(cl, cr).cross(_p[18].subVectors(nk, pv)).normalize();
  }
  // chest normal: in the rest pose (clavicle_l − clavicle_r) × (neck − pelvis) points forward (+ = chest); face down = it points down
  const faceDown = () => chestNormal().y < -0.3;
  function axisHeadToFeet() { const b = S.bones; return _p[19].subVectors(wpos(b.pelvis, _p[13]), wpos(b.Head, _p[14])).normalize(); }
  function abortRag() { if (RG.rd) { try { RG.rd.destroy(); } catch (e) { /* world gone */ } } RG.rd = null; freezeEnd(); }
  // hand the ragdoll's pose to LayToIdle: the character is turned / placed so the clip's lying body lies where the ragdoll
  // lies (clip start: on the back, head behind, feet ahead, pelvis 0.24 m behind the root), then the bones blend into the clip
  function startGetup() {
    const P = C.player, b = S.bones;
    const pv = wpos(b.pelvis, new V3()), hd = wpos(b.Head, new V3());
    const fx = pv.x - hd.x, fz = pv.z - hd.z, l = Math.hypot(fx, fz) || 1;
    const face = Math.atan2(-fx / l, -fz / l);
    // world bone rotations of the ragdoll's last pose, re-expressed after the root moves
    RG.from = new Map(); for (const o of S.order) RG.from.set(o, wquat(o, new Q()).clone());
    RG.fromPelvis = pv.clone();
    const x = pv.x + fx / l * 0.24, z = pv.z + fz / l * 0.24;
    RG.hold = { x, y: groundY(x, z, pv.y), z };
    P.face = face; P.c.g.rotation.set(0, face, 0); P.c.g.position.set(RG.hold.x, RG.hold.y, RG.hold.z); P.x = x; P.y = RG.hold.y; P.z = z;
    if (RG.rd) { try { RG.rd.destroy(); } catch (e) { /* */ } RG.rd = null; }
    RG.tRag = RG.t; RG.st = 'blend'; RG.bt = 0;
    if (clipsReady()) { S.A.lock = 0; S.A.once('pb_getup', RG.clips.find((c) => c.name === 'pb_getup').duration - 0.02, 0); }
    else { S.A.lock = 0; S.A.loop('idle', 0.3); }
    STATS.getups++;
  }
  function poseBlend(dt) {   // ragdoll pose → clip pose, parents first, over K.blendOut
    RG.bt += dt; const w = clamp(RG.bt / K.blendOut, 0, 1), e = w * w * (3 - 2 * w);
    const pw = _q[6], rq = _q[7];
    C.player.c.g.updateMatrixWorld(true);
    for (const o of S.order) {
      const from = RG.from.get(o); if (!from) continue;
      o.parent.updateWorldMatrix(false, false); wquat(o.parent, pw);
      rq.copy(pw.invert()).multiply(from);   // local rotation that reproduces the ragdoll's world rotation
      o.quaternion.copy(rq.slerp(o.quaternion, e));
      if (o === S.bones.pelvis) { const inv = _p[29].m || (_p[29].m = new T3.Matrix4()); inv.copy(o.parent.matrixWorld).invert(); const lp = _p[24].copy(RG.fromPelvis).applyMatrix4(inv); o.position.lerpVectors(lp, o.position, e); }
      o.updateMatrix(); o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    if (w >= 1) RG.st = 'getup';
  }
  function seqUpdate(dt) {   // fall-clip sequence and the get-up's end
    const A = S.A; if (RG.st !== 'rag' && RG.st !== 'roll') RG.t += dt;   // (ragUpdate advances the clock while the ragdoll runs)
    if (RG.st === 'clip' && A.lock <= 0.001) { RG.st = 'getup'; A.once('pb_getup', RG.clips.find((c) => c.name === 'pb_getup').duration - 0.02, 0.05); STATS.getups++; RG.tRag = RG.t; }
    else if ((RG.st === 'getup' || RG.st === 'blend') && A.lock <= 0.001) { RG.tGetup = RG.t - (RG.tRag || 0); RG.last = { why: RG.why, ragS: +(RG.tRag || 0).toFixed(2), getupS: +RG.tGetup.toFixed(2), pen: RG.pen }; freezeEnd(); A.loop('idle', 0.25); }
  }

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

  /* ------------------------------------------------------------------ tests (tools/physbody.mjs) */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function flatSpot(k = 0) {
    const D = window.DBG, out = [];
    for (let r = 18; r < 160 && out.length <= k; r += 5) for (let a = 0; a < 6.28 && out.length <= k; a += 0.35) {
      const x = C.POI.crash.x + Math.sin(a) * r, z = C.POI.crash.z + Math.cos(a) * r;
      if (C.getH(x, z) < 1 || C.normalY(x, z) < 0.995 || C.inRift(x, z, 8)) continue;
      if ((C.FOREST && C.FOREST.list || []).some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 36)) continue;
      if (C.PH.ok) { const h = C.PH.P.raycast({ x, y: C.groundH(x, z) + 30, z }, { x: 0, y: -1, z: 0 }, 40, { groups: C.PH.P.groups.STATIC }); if (!h || !h.tag || h.tag.kind !== 'terrain') continue; }
      if (out.every((q) => Math.hypot(q.x - x, q.z - z) > 10)) out.push({ x, z });
    }
    void D; return out[k] || out[out.length - 1];
  }
  function findSlope(deg = 25) {   // planar terrain patch of `deg`, no solids / trees around (same rule as INTERACTION.testIK)
    const want = Math.cos(deg * Math.PI / 180);
    for (let i = 0; i < 30000; i++) {
      const x = (Math.random() - 0.5) * 600, z = (Math.random() - 0.5) * 600;
      if (C.getH(x, z) < 3 || C.inRift(x, z, 10) || C.nearPOI(x, z, 12)) continue;
      if (Math.abs(C.normalY(x, z) - want) > 0.012) continue;
      let ok = true; for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [4, 0], [-4, 0]]) if (Math.abs(C.normalY(x + ox, z + oz) - want) > 0.03) { ok = false; break; }
      if (!ok) continue;
      if (C.PH.ok) { const h = C.PH.P.raycast({ x, y: C.getH(x, z) + 30, z }, { x: 0, y: -1, z: 0 }, 40, { groups: C.PH.P.groups.STATIC }); if (!h || (h.tag && h.tag.kind !== 'terrain')) continue; }
      if ((C.FOREST && C.FOREST.list || []).some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 64)) continue;
      const e = 1, gx = C.getH(x + e, z) - C.getH(x - e, z), gz = C.getH(x, z + e) - C.getH(x, z - e);
      return { x, z, upYaw: Math.atan2(-gx, -gz) };
    }
    return null;
  }
  // a solid (rock / structure) at least `minH` tall with a walkable top: stand on the top, the edge in `dir`
  function findLedge(minH = 5.6) {
    const PH = C.PH; if (!PH.ok) return null; const P = C.player; let best = null;
    for (const e of (C.Passport && C.Passport.list) || []) {
      if (!e.box || !e.name) continue; const sy = e.box.max[1] - e.box.min[1], sx = e.box.max[0] - e.box.min[0], sz = e.box.max[2] - e.box.min[2];
      if (sy < minH || sy > 14 || Math.min(sx, sz) < 2.5) continue;
      const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2;
      const top = PH.P.raycast({ x: cx, y: e.box.max[1] + 2, z: cz }, { x: 0, y: -1, z: 0 }, sy + 3, { groups: PH.P.groups.STATIC });
      if (!top || top.normal.y < 0.8 || top.point.y - C.groundH(cx, cz) < minH) continue;
      // walk-off direction: towards the lowest ground within 8 m
      let dir = null, drop = 0;
      for (let a = 0; a < 6.28; a += 0.4) { const x = cx + Math.sin(a) * (Math.max(sx, sz) / 2 + 2), z = cz + Math.cos(a) * (Math.max(sx, sz) / 2 + 2), g = C.groundH(x, z), d = top.point.y - g;
        if (d > drop) { drop = d; dir = a; } }
      if (drop < minH) continue;
      const dd = Math.hypot(cx - P.x, cz - P.z);
      if (!best || dd < best.dd) best = { x: top.point.x, z: top.point.z, y: top.point.y, dirA: dir, drop, name: e.name, dd };
    }
    return best;
  }
  const place = async (x, z, yaw, ms = 1300) => { const D = window.DBG; D.teleport(x, z, yaw); C.player.face = yaw; C.player.c.g.rotation.y = yaw; D.cam.yaw = yaw; await wait(ms); };
  // records chain angles (deg) and the signed offset along `dir` every frame for `ms`
  function recordChains(ms, dir) {
    return new Promise((resolve) => {
      const rows = [], t0 = performance.now();
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        const r = { t }; for (const c of S.chains) { r[c.d.id] = c.ang * 180 / Math.PI; r[c.d.id + '_s'] = dir ? (c.sAng.x * dir.x + c.sAng.z * dir.z) : 0; }
        r.g = !!C.player.onGround; r.st = RG.st || '';
        const pe = S.bones.pelvis.matrixWorld.elements, he = S.bones.Head.matrixWorld.elements; r.nan = !Number.isFinite(pe[12] + pe[13] + pe[14] + he[12] + he[13] + he[14]);
        rows.push(r); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(rows);
      };
      requestAnimationFrame(tick);
    });
  }
  function settleStats(rows, id, tHit) {   // peak, time back to ≤ 15 % of peak (and staying), overshoot of the signed offset
    const R = rows.filter((r) => r.t >= tHit);
    let pk = 0, tp = 0; for (const r of R) if (r[id] > pk) { pk = r[id]; tp = r.t; }
    let tb = 0; for (let i = R.length - 1; i >= 0; i--) { if (R[i][id] > Math.max(0.15 * pk, 0.8)) { tb = i + 1 < R.length ? R[i + 1].t - tHit : 9; break; } }
    const s = R.map((r) => r[id + '_s']), smax = Math.max(...s.map(Math.abs)), sgn = Math.sign(s[s.findIndex((v) => Math.abs(v) === smax)] || 1);
    const after = R.filter((r) => r.t > tp).map((r) => r[id + '_s'] * sgn), over = Math.max(0, -Math.min(0, ...after));
    return { peakDeg: +pk.toFixed(1), tPeak: +(tp - tHit).toFixed(2), backS: +tb.toFixed(2), overshootPct: smax > 1e-4 ? +(over / smax * 100).toFixed(1) : 0 };
  }
  async function testPush(o = {}) {
    if (!S.ready) return { error: 'not ready' };
    const s = flatSpot(o.k || 0); if (!s) return { error: 'no flat spot' };
    await place(s.x, s.z, 0.6, 1800);
    const dir = { x: Math.sin(1.1), z: Math.cos(1.1) };
    const recP = recordChains(1500, dir); await wait(250);
    hit(dir.x, dir.z, o.k2 || 1);
    const rows = await recP;
    const th = rows.find((r, i) => i && r.spine > 0.3) || rows[0], tH = th.t - 0.02;
    const out = { spot: [+s.x.toFixed(1), +s.z.toFixed(1)], nanFrames: rows.filter((r) => r.nan).length, frames: rows.length };
    for (const id of ['spine', 'head', 'upper_l', 'upper_r', 'fore_l', 'fore_r']) out[id] = settleStats(rows, id, tH);
    out.worstBackS = Math.max(...['spine', 'head', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].map((k) => out[k].backS));
    out.worstOvershootPct = Math.max(...['spine', 'head', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].map((k) => out[k].overshootPct));
    out.pass = out.worstBackS <= 0.6 && out.worstOvershootPct < 15 && !out.nanFrames;
    return out;
  }
  // a real shardling walks up and hits the pilot (the game's own attack → playerHurt → this module)
  async function testHit() {
    const D = window.DBG; if (!S.ready || !D.spawnShardling) return { error: 'not ready' };
    const s = flatSpot(1); await place(s.x, s.z, 0, 1500);
    const P = C.player; P.hp = 99; P.inv = 0; C.G.safeUntil = 0;
    const e = D.spawnShardling(s.x + 3, s.z - 2, null); e.st = 'chase';
    const h0 = STATS.hits, lh = P.lastHurt, t0 = performance.now();
    while (performance.now() - t0 < 8000 && P.lastHurt === lh) await nextFrame();
    if (P.lastHurt === lh) { e.hp = 0; e.dead = true; e.g.visible = false; return { error: 'shardling never hit' }; }
    const rows = await recordChains(1200, { x: P.vx, z: P.vz });
    e.dead = true; e.g.visible = false; e.st = 'idle'; P.hp = P.hpMax;
    const out = { hitsSeen: STATS.hits - h0, nanFrames: rows.filter((r) => r.nan).length };
    for (const id of ['spine', 'head', 'upper_l', 'fore_l']) out[id] = settleStats(rows, id, 0);
    out.worstBackS = Math.max(...['spine', 'head', 'upper_l', 'fore_l'].map((k) => out[k].backS));
    // the game's knock-back is a hop (12 m/s + 5 m/s up): its landing is a second, separate excitation — settle from there
    const iAir = rows.findIndex((r) => !r.g), iLand = iAir >= 0 ? rows.findIndex((r, i) => i > iAir && r.g) : -1;
    if (iLand > 0) { out.hopLandS = +rows[iLand].t.toFixed(2); out.afterLanding = {}; for (const id of ['spine', 'head', 'upper_l', 'fore_l']) out.afterLanding[id] = settleStats(rows, id, rows[iLand].t);
      out.afterLandingWorstBackS = Math.max(...Object.values(out.afterLanding).map((q) => q.backS)); }
    return out;
  }
  // walk into a wall-like solid (tall rock face, ruin wall, hab, wreck) at 30° to its face: the capsule slides along it, the
  // near shoulder / arm meet it, the chest turns away and recovers; nothing penetrates, nothing explodes
  function findWall(o = {}) {
    const PH = C.PH; if (!PH.ok) return null;
    const cands = [];
    for (const e of (C.Passport && C.Passport.list) || []) {
      if (!e.name || !e.box || !/rock|ruin|wall|hab|station|kestrel|boulder/i.test(e.name)) continue;
      const sy = e.box.max[1] - e.box.min[1], sx = e.box.max[0] - e.box.min[0], sz = e.box.max[2] - e.box.min[2]; if (sy < 2.4 || Math.max(sx, sz) < 2.5) continue;
      const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2;
      cands.push({ x: cx, z: cz, r: Math.max(sx, sz) / 2, d: Math.hypot(cx - C.POI.crash.x, cz - C.POI.crash.z), name: e.name });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const t of cands.slice(o.skip || 0, (o.skip || 0) + 12)) {
      // a clear, flat approach 5 m out; the face point and its normal at shoulder height
      for (let a = 0; a < 6.28; a += 0.5) {
        const sx = t.x + Math.sin(a) * (t.r + 4.5), sz = t.z + Math.cos(a) * (t.r + 4.5), gy = C.groundH(sx, sz);
        if (C.normalY(sx, sz) < 0.97) continue;
        const dx = t.x - sx, dz = t.z - sz, dl = Math.hypot(dx, dz);
        const h = PH.P.raycast({ x: sx, y: gy + 1.4, z: sz }, { x: dx / dl, y: 0, z: dz / dl }, t.r + 5, { groups: PH.P.groups.STATIC });
        const h2 = PH.P.raycast({ x: sx, y: gy + 0.5, z: sz }, { x: dx / dl, y: 0, z: dz / dl }, t.r + 5, { groups: PH.P.groups.STATIC });
        if (!h || !h2 || !h.normal || Math.abs(h.normal.y) > 0.35 || h.distance < 2.5 || Math.abs(h.distance - h2.distance) > 0.35) continue;   // a wall-ish face, not an overhang / slope
        const nl = Math.hypot(h.normal.x, h.normal.z), nx = h.normal.x / nl, nz = h.normal.z / nl;
        // walk direction: into the face at 30° (−n rotated 60° toward the tangent)
        const wa = Math.atan2(-nx, -nz) + (o.side || 1) * 1.05, wx = Math.sin(wa), wz = Math.cos(wa);
        const start = { x: h.point.x - wx * 3.2 + nx * 0.2, z: h.point.z - wz * 3.2 + nz * 0.2 };
        return { name: t.name, x: start.x, z: start.z, yaw: Math.atan2(-wx, -wz) };
      }
    }
    return null;
  }
  async function testBump(o = {}) {
    const D = window.DBG, PH = C.PH; if (!S.ready || !PH.ok) return { error: PH.ok ? 'not ready' : 'no physics (fallback: no collision layer)' };
    const w = findWall(o); if (!w) return { error: 'no wall-like face found' };
    await place(w.x, w.z, w.yaw, 1400);
    const c0 = STATS.contacts, s0 = STATS.shoulder || 0; D.keys.KeyW = true;
    const rows = await recordChains(2400, null); D.keys.KeyW = false;
    const mx = (id) => +Math.max(...rows.map((r) => r[id])).toFixed(1);
    return { target: w.name, contacts: STATS.contacts - c0, shoulderFrames: (STATS.shoulder || 0) - s0, maxDeg: { spine: mx('spine'), head: mx('head'), upper_l: mx('upper_l'), upper_r: mx('upper_r'), fore_l: mx('fore_l'), fore_r: mx('fore_r') }, nanFrames: rows.filter((r) => r.nan).length };
  }
  // fall from a height (a rock top if one is tall enough, else a drop from 7 m): ragdoll (or fall clip), get up
  async function testFall(o = {}) {
    const D = window.DBG, P = C.player; if (!S.ready) return { error: 'not ready' };
    const s = flatSpot(2); await place(s.x, s.z, 0.3, 1200);
    const h = o.h || 7.5, gy = C.groundH(s.x, s.z);
    D.teleport(s.x, s.z, 0.3, gy + h); P.vx = P.vz = 0; if (C.PH.ok) C.PH.ch.setVelocity(1.5 * Math.sin(-0.3), 0, 1.5 * -Math.cos(0.3));
    const out = { mode: C.PH.ok ? 'ragdoll' : 'clip', dropM: h }; K.checkPen = true;
    const t0 = performance.now(); let tStart = null, tGetup = null, tEnd = null, nan = 0, pen = 0, frames = 0, minHead = 9;
    while (performance.now() - t0 < 9000) {
      await nextFrame(); frames++;
      if (RG.st && tStart === null) tStart = performance.now();
      if ((RG.st === 'blend' || RG.st === 'getup') && tGetup === null) tGetup = performance.now();
      if (tStart !== null && !RG.st) { tEnd = performance.now(); break; }
      for (const n of ['pelvis', 'Head', 'hand_l', 'foot_r']) { const e = S.bones[n].matrixWorld.elements; if (!Number.isFinite(e[12] + e[13] + e[14])) nan++; }
      if (RG.rd) pen = Math.max(pen, RG.rd.penetrating(0.05));
      if (RG.st) minHead = Math.min(minHead, S.bones.Head.matrixWorld.elements[13] - P.y);
    }
    K.checkPen = false; out.triggered = tStart !== null; out.why = RG.last ? RG.last.why : RG.why;
    out.ragS = tStart && tGetup ? +((tGetup - tStart) / 1000).toFixed(2) : null; out.getupS = tGetup && tEnd ? +((tEnd - tGetup) / 1000).toFixed(2) : null;
    out.penetratingParts5cm = Math.max(pen, RG.last ? RG.last.pen : 0); out.nanFrames = nan; out.frames = frames; out.headLowestM = +minHead.toFixed(2);
    await wait(400); out.standingAfter = { onGround: P.onGround, chEnabled: C.PH.ok ? !!C.PH.ch.collider.isEnabled() : null, pelvisH: +(S.bones.pelvis.matrixWorld.elements[13] - P.y).toFixed(2) };
    out.pass = out.triggered && out.getupS !== null && out.getupS <= 2 && !nan && out.penetratingParts5cm === 0;
    return out;
  }
  // ms per frame of each layer: walking (springs + collision tips), then a ragdoll (bodies + pose + Rapier step delta)
  async function cost(o = {}) {
    const D = window.DBG, P = C.player, PHP = C.PH.ok ? C.PH.P : null;
    let stepMs = 0, stepN = 0; const origStep = PHP && PHP.step;
    if (PHP) PHP.step = function (dt) { const t = performance.now(); const r = origStep.call(this, dt); stepMs += performance.now() - t; stepN++; return r; };
    const s = flatSpot(3); await place(s.x, s.z, 0, 1500);
    const meas = async (ms) => { let a = 0, n = 0, mx = 0; stepMs = 0; stepN = 0; const t0 = performance.now(); let f0 = STATS.frames;
      const hook = () => { const v = RG.st ? STATS.msRag : STATS.msSpring; a += v; n++; mx = Math.max(mx, v); };
      while (performance.now() - t0 < ms) { await nextFrame(); hook(); }
      return { avgMs: +(a / Math.max(1, n)).toFixed(3), frames: STATS.frames - f0, stepMs: stepN ? +(stepMs / stepN).toFixed(3) : null, fps: +((STATS.frames - f0) / (ms / 1000)).toFixed(1) }; };
    const out = {};
    const sp0 = K.springs; K.springs = false; await wait(300); out.idleOff = await meas(1500); K.springs = sp0;
    D.keys.KeyW = true; await wait(600); out.walkSprings = await meas(2000); D.keys.KeyW = false;
    const sa = []; for (let i = 0; i < 40; i++) { const t = performance.now(); springs(1 / 30, _p[40] || (_p[40] = new V3(0, 0, -1))); sa.push(performance.now() - t); }
    sa.sort((a, b) => a - b); out.springsDirectMs = { median: +sa[20].toFixed(3), p90: +sa[36].toFixed(3) };
    await wait(800); out.idleOn = await meas(1200);
    if (C.PH.ok) { trigger('test', { x: 2, y: 2, z: 0 }); out.ragdoll = await meas(1100); out.ragStepDeltaMs = out.ragdoll.stepMs !== null && out.idleOn.stepMs !== null ? +(out.ragdoll.stepMs - out.idleOn.stepMs).toFixed(3) : null; }
    while (RG.st) await wait(100);
    if (PHP) PHP.step = origStep;
    return out;
  }
  // stop after a walk: horizontal travel of each boot while it is pressing the snow (terrain contact), from the key
  // release to 1.8 s later — the print smears exactly by this much. Needs tools/qa/snowcontact-page.js (window.SC).
  async function testStop(o = {}) {
    const SC = window.SC, P = C.player, D = window.DBG; if (!SC) return { error: 'needs SC (snowcontact-page.js)' };
    const s = SC.openSnow(0.06, o.skip || 0); if (!s) return { error: 'no open snow' };
    const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); await place(s.x, s.z, yaw, 1500);
    const sets = SC.soles('player'); D.keys.KeyW = true; await wait(o.walkMs || 2600); D.keys.KeyW = false;
    const segs = sets.map(() => []), cur = sets.map(() => null), t0 = performance.now();
    while (performance.now() - t0 < 1800) {
      await nextFrame();
      sets.forEach((set, k) => {
        const sn = SC.soleNow(set, 0.02); if (!sn) return; const s0 = C.snowContact ? C.snowContact(sn.ax, sn.az).s0 : C.groundH(sn.ax, sn.az);
        const pressing = sn.minY < s0 - 0.005;
        if (pressing) { if (!cur[k]) { cur[k] = { x0: sn.ax, z0: sn.az, mx: 0, n: 0 }; segs[k].push(cur[k]); } const c = cur[k]; c.mx = Math.max(c.mx, Math.hypot(sn.ax - c.x0, sn.az - c.z0)); c.n++; }
        else cur[k] = null;
      });
    }
    const all = segs.flat().filter((c) => c.n >= 3), mx = all.length ? Math.max(...all.map((c) => c.mx)) : null;
    return { contactSlideCm: mx === null ? null : +(mx * 100).toFixed(2), segments: all.length, perSeg: all.map((c) => +(c.mx * 100).toFixed(1)), settleSteps: window.INTERACTION && INTERACTION.STATS.settleSteps };
  }

  window.PHYSBODY = { K, STATS, S, RG, EV, owns, pose, update, kick, hit, trigger, mode: () => (C && C.PH && C.PH.ok ? 'rapier' : 'js'), testPush, testHit, testBump, testFall, testStop, cost, flatSpot, findSlope, findLedge, findWall };
  (window.GameModules = window.GameModules || []).push({
    name: 'physbody',
    order: 55,   // updated before interaction (the host walks the list backwards): events first, then interaction poses
    init(ctx) {
      C = ctx; T3 = ctx.THREE; V3 = T3.Vector3; Q = T3.Quaternion;
      if (window.PHYSBODY_OFF) { K.springs = K.upper = K.ragdoll = K.events = false; if (window.INTERACTION) INTERACTION.K.footLock = false; }   // A/B: the whole layer off (tests / bisecting)
      for (let i = 0; i < 42; i++) _p.push(new V3()); for (let i = 0; i < 12; i++) _q.push(new Q());
      ctx.physbody = window.PHYSBODY;
      // the fall / knock-back / get-up clips (UAL1, CC0 — cut out of the pilot's own pack: tools/anim/extract_clips.mjs)
      if (ctx.loadPacked) try { ctx.loadPacked('anim_pilot_fall', ctx.ASSET || 'assets/', (g) => { RG.clips = g.animations; }); } catch (e) { console.warn('[physbody] clips', e); }
    },
    update(dt) { update(dt); },
  });
})();
