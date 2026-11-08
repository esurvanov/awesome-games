/* modules/physbody-ragdoll.js — layer 3 of the body physics: the event ragdoll (Rapier bodies and joints for a knock-down), the fall / knock-back / get-up clips, the hand-over between the clip and the ragdoll. Moved out of modules/physbody.js unchanged. Classic script, loaded BEFORE physbody.js: window.createPhysbodyRagdoll(deps) → { RG, owns, freezeTick, trigger, buildRagdoll, poseRagdoll, ragUpdate, abortRag, poseBlend, seqUpdate, bind({...}) }. */
(function () {
  'use strict';
  window.createPhysbodyRagdoll = function (X) {
    const { S, _p, K, wpos, STATS, _q, wquat, clamp } = X;
    let C, V3, Q, T3;   // assigned later in the source module: set through bind()
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


    return { RG, owns, freezeTick, trigger, buildRagdoll, poseRagdoll, ragUpdate, abortRag, poseBlend, seqUpdate, bind(o) { if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; if ("Q" in o) Q = o.Q; if ("T3" in o) T3 = o.T3; } };
  };
})();
