/* modules/animal-gait.js — how the stags and the fox move: steering around solids, hoof and paw prints, stride-matched gait, slope alignment, the fox's pounce. Moved out of modules/interaction.js unchanged. Classic script, loaded BEFORE interaction.js: window.createAnimalGait(deps) → { ST, FX, stagUpdate(dt), foxUpdate(dt), bind({ C, V3, Q, T3 }) }; interaction.js calls bind() in its init and the two updates every frame (SUB.stags / SUB.fox switch them). */
(function () {
  'use strict';
  window.createAnimalGait = function (X) {
    const { K, clamp, damp, rnd, STATS, smooth, strideSpeed, wrapA, snowDepth, wpos, _p, hasStamp, makeGait, SUB, sfx } = X;
    let C, V3, T3, Q;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ animals steer around solids (INTERACT.md)
   * Look-ahead rays against Passport solids / trunks / props (the terrain and sea-ice colliders are excluded: the ground
   * is not an obstacle); the heading turns to the free direction closest to where the animal wants to go, keeping the
   * side it already chose (no left/right dithering). Stags: before the game moves them (their flee heading is ours);
   * fox: its step this frame is re-aimed after the game made it. */
  K.avoid = true; K.avoidTurn = 5.5;
  const AVD = { exc: null, n: 0 };
  const OFFS = [0, 0.3, 0.6, 0.9, 1.2, 1.55, 1.9, 2.3];
  function groundHandles() {
    const P = C.PH.P, ex = new Set();
    for (const [x, z] of [[0, 0], [300, 300], [-300, -300], [450, 450]]) { const h = P.raycast({ x, y: 400, z }, { x: 0, y: -1, z: 0 }, 800, { groups: P.groups.STATIC }); if (h && h.tag && (h.tag.kind === 'terrain' || h.tag.kind === 'ice')) ex.add(h.collider.handle); }
    return ex;
  }
  let _aRay = null;
  function solidRay(ox, oy, oz, dx, dz, len) {
    const P = C.PH.P, R = P.RAPIER, W = P.world; if (!R || !W) return null;
    if (!AVD.exc || !AVD.exc.size) AVD.exc = groundHandles();
    if (!_aRay) _aRay = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    _aRay.origin = { x: ox, y: oy, z: oz }; _aRay.dir = { x: dx, y: 0, z: dz }; AVD.n++;
    const G = P.groups, h = W.castRay(_aRay, len, true, undefined, (0xffff << 16) | (G.STATIC | G.TRUNK | G.PROP), undefined, undefined, (col) => !AVD.exc.has(col.handle));
    return h ? h.timeOfImpact : null;
  }
  // is the corridor (width 2·half, rays at the given heights above the ground) along angle a free for `len` m?
  function corridorFree(x, gy, z, a, len, half, hs) {
    const dx = Math.sin(a), dz = Math.cos(a), rx = dz, rz = -dx;
    for (const hy of hs) for (const o of [0, half, -half]) if (solidRay(x + rx * o, gy + hy, z + rz * o, dx, dz, len) !== null) return false;
    return true;
  }
  // free heading closest to `want`, preferring the side chosen last time (mem.side); null = keep `want`
  function steerAround(x, gy, z, want, len, half, hs, mem) {
    if (corridorFree(x, gy, z, want, len, half, hs)) { mem.side = 0; return { a: want, blocked: false }; }
    const first = mem.side || 1;
    for (const o of OFFS) { if (!o) continue; for (const sg of [first, -first]) { const a = want + o * sg; if (corridorFree(x, gy, z, a, len, half, hs)) { mem.side = sg; return { a, blocked: true, off: o * sg }; } } }
    return { a: want + Math.PI * (mem.side || 1) * 0.5, blocked: true, off: null };   // boxed in: turn away hard
  }

  /* ------------------------------------------------------------------ stags */
  const ST = { ready: false, feet: ['Backleg_L002', 'Backleg_R002', 'Frontleg_L002', 'Frontleg_R002'], sole: [0.119, 0.119, 0.13, 0.13], runV: 0, per: new Map(), bbT: 0, bbI: 0 };
  function stagSetup() {
    const S = C.STAGS; if (!S || !S.length) return false;
    const s0 = S[0], root = s0.A.mixer.getRoot();
    // sole height of each hoof bone in the bind pose (hoof bone → lowest vertex), from the skinned bounds
    try {
      root.updateMatrixWorld(true); const gy = s0.g.position.y;
      const fb = ST.feet.map((n) => root.getObjectByName(n)); if (fb.some((b) => !b)) return false;
      // run clip stride (hooves relative to the hip)
      if (s0.A.acts.run) ST.runV = strideSpeed(root, s0.A.acts.run.getClip(), ST.feet.map((n) => [n]), 'Hip');
      void gy;
    } catch (e) { console.warn('[interaction] stag stride', e); }
    for (const s of S) {
      const wrap = s.A.mixer.getRoot().parent, root2 = s.A.mixer.getRoot();
      ST.per.set(s, { wrap, feet: ST.feet.map((n) => root2.getObjectByName(n)), off: 0, roll: 0, pitch: 0, dir: null, wantX: s.fx, wantZ: s.fz, wroteX: null, wroteZ: null, lastYaw: s.yaw,
        prevH: [0, 0, 0, 0], up: [1, 1, 1, 1], trailN: 0, skins: [] });
      root2.traverse((o) => { if (o.isSkinnedMesh) ST.per.get(s).skins.push(o); });
      try { hoofPoints(ST.per.get(s)); } catch (e) { console.warn('[interaction] stag hoof points', e); }
    }
    ST.ready = true; return true;
  }
  // SNOW-CONTACT: the real bottom of each hoof. The hoof vertices move rigidly with their hoof bone, so they are stored once
  // in bone space (vertices ≥ 70 % weighted to that bone) and the lowest one is found per frame (≈ 40 points × 4 hooves).
  // A constant bone → sole offset was up to 6 cm off in the grazing pose (hooves hovering or buried).
  function hoofPoints(S) {
    S.hoof = S.feet.map(() => null); const v = new V3(), M = new T3.Matrix4();
    for (const sm of S.skins) {
      const g = sm.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position; if (!si || !sw) continue;
      S.feet.forEach((b, fi) => {
        if (!b) return; const k = sm.skeleton.bones.indexOf(b); if (k < 0) return;
        M.multiplyMatrices(sm.skeleton.boneInverses[k], sm.bindMatrix);   // bind space → this bone's space (pose independent)
        const pts = S.hoof[fi] || [];
        for (let i = 0; i < pos.count; i++) { let w = 0; for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === k) w += sw.getComponent(i, c); if (w < 0.7) continue;
          v.fromBufferAttribute(pos, i).applyMatrix4(M); pts.push(v.x, v.y, v.z); }
        S.hoof[fi] = pts;
      });
    }
    S.hoof = S.hoof.map((a) => { if (!a || a.length < 9) return null; const n = a.length / 3, step = Math.max(1, Math.floor(n / 48)), out = []; for (let i = 0; i < n; i += step) out.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); return new Float32Array(out); });
  }
  function hoofSole(S, i, boneY) {   // lowest world y of hoof i (falls back to the old constant offset)
    const P = S.hoof && S.hoof[i]; if (!P) return boneY - ST.sole[i];
    const e = S.feet[i].matrixWorld.elements; let m = Infinity;
    for (let k = 0; k < P.length; k += 3) { const y = e[1] * P[k] + e[5] * P[k + 1] + e[9] * P[k + 2] + e[13]; if (y < m) m = y; }
    return m;
  }
  const _qY = [];
  function stagUpdate(dt) {
    if (!ST.ready && !stagSetup()) return;
    if (!_qY.length) { _qY.push(new Q(), new Q(), new Q(), new V3(1, 0, 0), new V3(0, 0, 1)); }   // [0] = model → group: the stag model faces +Z (no flip)
    const cam = C.camera.position, P = C.player;
    for (const s of C.STAGS) {
      const S = ST.per.get(s); if (!S) continue;
      // ---- flee turning: the game snaps the run direction; we turn it at a finite rate (the yaw follows)
      if (s.st === 'flee') {
        if (S.wroteX === null || Math.abs(s.fx - S.wroteX) > 1e-6 || Math.abs(s.fz - S.wroteZ) > 1e-6) { S.wantX = s.fx; S.wantZ = s.fz; if (S.dir === null) S.dir = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)); }
        let want = Math.atan2(S.wantX, S.wantZ), turnK = K.stagTurn;
        if (K.avoid && C.PH.ok) {   // look ahead ~0.9 s (≥ 3 m) plus half a body; re-evaluated 20× a second
          S.avT = (S.avT || 0) - dt;
          if (S.avT <= 0) { S.avT = 0.05; const gy = C.groundH(s.x, s.z), look = clamp((S.v || 0) * 0.9, 3, 9) + 1.0;
            S.av = steerAround(s.x, gy, s.z, want, look, 0.3, [0.5, 1.1], S.avMem || (S.avMem = {}));
            // something right ahead of the current heading: turn harder and ease off
            S.close = !corridorFree(s.x, gy, s.z, S.dir, 2.4, 0.3, [0.5, 1.1]); }
          if (S.av && S.av.blocked) { want = S.av.a; turnK = K.avoidTurn; }
          if (S.close) S.v = Math.min(S.v || 0, 4);
        }
        const d = wrapA(want - S.dir), mx = turnK * dt;
        S.dir += clamp(d, -mx, mx); S.turn = clamp(d, -mx, mx) / Math.max(dt, 1e-3);
        // speed ramps up from a standstill (the game moves them at a flat 11 m/s × |f|)
        // top speed = what the fastest available gait strides at (hooves stay planted: rate = speed ÷ stride). Once the
        // ANIMLIB GaitBlender is built this must be the gallop clip's own measured speed (11 m/s, ANIMLIB.md gaitTable),
        // not the legacy flat Run clip's stride × stagRate: that stale ceiling (unchanged since before the blender
        // existed) sat at ≈ 4 m/s — squarely between the trot (3.0) and canter (6.0) bands — so a fleeing stag topped
        // out and stayed there for the whole flight, running trot ~30 % faster than its authored stride forever instead
        // of crossfading up into canter/gallop where the blender's own numbers hold (QA motion FAIL: stride ratio 2.0/1.6).
        const gTop = S.gait && s.gaitMeta && s.gaitMeta.gaitTable && s.gaitMeta.gaitTable.gallop && s.gaitMeta.gaitTable.gallop.speed;
        const top = gTop ? Math.min(K.stagTop, gTop) : (ST.runV > 0.5 ? Math.min(K.stagTop, ST.runV * K.stagRate) : K.stagTop);
        // accel capped at ≤ 7 m/s² (ANIMLIB.md: gait changes need their full stride) even though `top` can now be much
        // higher than before — ramping over the old fixed 0.9 s at a bigger top would blow past that.
        S.v = Math.min(top, (S.v || 0) + dt * Math.min(top / 0.9, 7));
        const m = S.v / 11; s.fx = Math.sin(S.dir) * m; s.fz = Math.cos(S.dir) * m; S.wroteX = s.fx; S.wroteZ = s.fz;
        if (!S.gait && ST.runV > 0.5 && s.A.acts.run) s.A.acts.run.setEffectiveTimeScale(clamp(S.v / ST.runV, 0.3, K.stagRate));
      } else {
        S.dir = s.yaw; S.wroteX = null; S.turn = damp(S.turn || 0, 0, 6, dt);
        // coast the speed down through the gait bands instead of snapping to idle: a flat st==='flee'→'graze' switch used
        // to cut straight from the Run clip to Idle mid-stride ("rears in place" in the QA baseline)
        S.v = damp(S.v || 0, 0, 2.2, dt); if (S.v < 0.12) S.v = 0;
      }
      // 20-clip phase-synced gait set (ANIMLIB.md): built lazily once anim_stag_gaits merges into s.A.acts
      // (open-world.html, after the pack loads) — replaces the flat Run clip with speed-matched walk/trot/canter/gallop.
      // Only one driver touches s.A.mixer per frame (s.gaitDriving tells open-world's updateStags to skip its own
      // s.A.update(dt) this frame): while fleeing, or still coasting down from it, the blender owns the mixer.
      if (K.gaitBlend && !S.gait && !S.gaitFailed && s.gaitMeta && window.ANIMLIB) {
        // the stag's idle clip is not always named 'Idle' (clipAction(undefined) threw here every frame): take whatever idle it has
        try { const clips = {}; for (const k in s.A.acts) clips[k] = s.A.acts[k].getClip(); const idle = clips.Idle ? 'Idle' : Object.keys(clips).find((k) => /idle/i.test(k)) || null;
          S.gait = new ANIMLIB.GaitBlender(s.A.mixer, clips, s.gaitMeta, { idle }); }
        catch (e) { S.gait = null; S.gaitFailed = true; console.warn('[interaction] stag gait blender', e); }
      }
      if (S.gait && (s.st === 'flee' || S.v > 0.15)) {
        s.gaitDriving = true;
        try {
          S.gait.update(dt, S.v, S.turn || 0);
          // the game's own state machine still calls s.A.loop('run', …) to start a flee (open-world.html updateStags)
          // — the GaitBlender only owns walk/trot/canter/gallop + idle, it never touches that action, so whatever
          // weight the crossfade left it at (usually 1, and never faded back out: nothing else re-triggers .loop()
          // while fleeing) kept blending its pose ADDITIVELY under the blender's own on the same bones (three.js
          // accumulates weighted per-action contributions, it does not renormalize across actions that were never
          // told about each other) — a real double-drive, and the actual cause of the measured foot sliding (QA motion
          // FAIL stags_flee/2 stride ratio 2.0 / 1.6): the feet-analysis clip list showed "run×1.00" driving the whole
          // flee, the 20-clip blend riding on top of it rather than replacing it.
          const r = s.A.acts.run; if (r && r.getEffectiveWeight() > 0) r.setEffectiveWeight(0);
        } catch (e) { s.gaitDriving = false; }
      } else s.gaitDriving = false;
      const camD = Math.hypot(s.x - cam.x, s.z - cam.z);
      if (camD > 160 || !s.g.visible) continue;
      // ---- slope alignment (plane through front/back/left/right ground samples) + bank in turns
      const yaw = s.g.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx, gy = s.g.position.y;
      const hF = C.groundH(s.x + fx * 0.9, s.z + fz * 0.9), hB = C.groundH(s.x - fx * 0.9, s.z - fz * 0.9), hR = C.groundH(s.x + rx * 0.35, s.z + rz * 0.35), hL = C.groundH(s.x - rx * 0.35, s.z - rz * 0.35);
      const pitchT = Math.atan2(hF - hB, 1.8) * K.stagAlign, rollT = Math.atan2(hR - hL, 0.7) * K.stagAlign - clamp((S.turn || 0) * 0.08, -0.25, 0.25);
      S.pitch = damp(S.pitch, pitchT, 8, dt); S.roll = damp(S.roll, rollT, 8, dt);
      const standing = s.st !== 'flee'; if (!standing) { S.pf = damp(S.pf || 0, 0, 6, dt); S.rf = damp(S.rf || 0, 0, 6, dt); }
      const q = _qY[1].setFromAxisAngle(_qY[3], -(S.pitch + (S.pf || 0))).premultiply(_qY[2].setFromAxisAngle(_qY[4], S.roll + (S.rf || 0)));
      S.wrap.quaternion.copy(q).multiply(_qY[0]);
      S.wrap.position.y = 0; s.g.updateMatrixWorld(true);
      // ---- ground: hooves on the DRAWN snow (SNOW-CONTACT: the object-pressed map); a planted hoof sinks into the loose
      // snow like a boot and the hoof mesh itself presses that print. Standing: a plane through the 4 hoof errors sets
      // height, pitch and roll (all four hooves down on uneven snow); running: the lowest hoof touches down
      let gap = 1e9; const fit = [0, 0, 0, 0, 0, 0, 0, 0, 0], sv = C.snowContact, fp = C.footPress, gx = s.g.position.x, gz = s.g.position.z;
      for (let i = 0; i < 4; i++) {
        const b = S.feet[i]; if (!b) continue; const p = wpos(b, _p[9]), sole = hoofSole(S, i, p.y);
        let g; if (typeof sv === 'function') { const q = sv(p.x, p.z, camD > 25); g = q.s0; if (!S.up[i]) { const fw = C.snowFine ? 0.3 + 0.7 * C.snowFine(p.x, p.z) : 1; g = Math.max(q.s0 - (fp ? fp(p.x, p.z) : 0.5) * q.dep * fw, q.floor); } if (!isFinite(g)) g = C.groundH(p.x, p.z); }
        else g = C.groundH(p.x, p.z) + Math.min(snowDepth(p.x, p.z), 0.6) * K.snowFloat;
        const e = sole - g; gap = Math.min(gap, e);
        if (standing) { const a = (p.x - gx) * fx + (p.z - gz) * fz, bb = (p.x - gx) * rx + (p.z - gz) * rz; fit[0] += 1; fit[1] += a; fit[2] += bb; fit[3] += a * a; fit[4] += a * bb; fit[5] += bb * bb; fit[6] += e; fit[7] += e * a; fit[8] += e * bb; }
        // hoof plants → trail (terrain deformation if present; else the shared footprint decal near the player)
        const hh = sole - g; if (hh > 0.1) S.up[i] = 1;
        else if (S.up[i] && hh < 0.03) {
          S.up[i] = 0; if (s.st !== 'flee') continue;
          if (!hasStamp() && (S.trailN++ & 1) === 0 && Math.hypot(p.x - P.x, p.z - P.z) < 70) C.addFootprint(p.x, p.z, yaw + Math.PI);   // no terrain module: decal prints
          if (Math.random() < 0.6) C.emit(p.x, g + 0.05, p.z, rnd(-0.8, 0.8) - fx * 2, rnd(0.6, 1.6), rnd(-0.8, 0.8) - fz * 2, 0.6, 0xdce6f6, 0.4, 2.5, 2);
        }
      }
      let offT = -gap;
      if (standing && fit[0] >= 3) {   // least-squares plane e = c0 + c1·a (forward) + c2·b (right) → height, pitch, roll
        const [n, sa, sb, saa, sab, sbb, se, sea, seb] = fit, M = [[n, sa, sb], [sa, saa, sab], [sb, sab, sbb]], r = [se, sea, seb];
        const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        const D0 = det(M);
        if (Math.abs(D0) > 1e-6) {
          const col = (k) => M.map((row, i) => row.map((v, j) => (j === k ? r[i] : v))), c0 = det(col(0)) / D0, c1 = det(col(1)) / D0, c2 = det(col(2)) / D0;
          offT = -c0; const k = Math.min(1, dt * 10);
          S.pf = clamp((S.pf || 0) - Math.atan(c1) * k, -0.35, 0.35); S.rf = clamp((S.rf || 0) - Math.atan(c2) * k, -0.35, 0.35);
        }
      }
      // a teleport / spawn (≥ 2 m in one frame) snaps the height: rate-limited, the hooves would spend frames on the hard ground
      // and press holes deeper than the hoof (SNOW-CONTACT: every object presses the snow map with its own shape)
      const jumped = S.px !== undefined && Math.hypot(s.x - S.px, s.z - S.pz) > 2; S.px = s.x; S.pz = s.z;
      if (gap < 1e8) { if (jumped) S.off = clamp(offT, -1.2, 1.2); else { const w = damp(S.off, clamp(offT, -1.2, 1.2), 12, dt); S.off += clamp(w - S.off, -3 * dt, 3 * dt); } S.wrap.position.y = S.off; }   // ≤ 1.5 m/s: no body snap when standing ↔ running switches the fit
    }
    // keep each stag's skinned bounds honest for tools that read bounding boxes (world validator): one per 0.4 s
    ST.bbT -= dt;
    if (ST.bbT <= 0 && C.STAGS.length) {
      ST.bbT = 0.4; const s = C.STAGS[ST.bbI++ % C.STAGS.length], S = ST.per.get(s);
      if (S && s.g.visible) { s.g.updateMatrixWorld(true); for (const m of S.skins) { m.skeleton.update(); m.computeBoundingBox(); m.computeBoundingSphere(); } }
    }
  }

  /* ------------------------------------------------------------------ fox */
  const FX = { ready: false, wrap: null, stride: {}, prevSt: null, pounce: -1, pitch: 0, roll: 0, off: 0, q: null };
  function foxSetup() {
    const f = C.fox; if (!f || !f.anim) return false;
    const root = f.anim.mixer.getRoot(); FX.wrap = root.parent;
    try {
      // stride from the hind paws: the clips' front paws sweep slower than the hind ones; the hind paws carry the body
      for (const k of ['walk', 'run']) if (f.anim.acts[k]) FX.stride[k] = strideSpeed(root, f.anim.acts[k].getClip(), [['b_LeftFoot02_018'], ['b_RightFoot02_022']], 'b_Hip_01');
    } catch (e) { /* keep the game's rates */ }
    // walk ↔ run as one phase-synced gait (see makeGait); the fox's top speed is what the run clip strides at rateMax
    // (updateFox clamps its wanted speed to fox.vMax), so paws never skate
    try {
      FX.gait = makeGait(f.anim, { root, keys: ['walk', 'run'], stride: FX.stride, bands: [[1.2, 2.4]], idle: 'sit', idleLo: 0.15, idleHi: 0.7, foot: 'b_LeftFoot02_018', ref: 'b_Hip_01', fwd: 1,
        rateMax: K.foxRate, enabled: () => SUB.fox && K.gait, speed: () => f.speed || 0, want: () => f.speed || 0 });
      if (FX.gait) f.vMax = FX.gait.vMax;
    } catch (e) { console.warn('[interaction] fox gait', e); }
    try {
      if (FX.gait && K.foxLegs !== false) FX.legs = legWarp(f.anim, root, FX.gait, [
        { name: 'FR', foot: 'b_RightHand_08', bones: ['b_RightUpperArm_06', 'b_RightForeArm_07', 'b_RightHand_08'] },
        { name: 'FL', foot: 'b_LeftHand_011', bones: ['b_LeftUpperArm_09', 'b_LeftForeArm_010', 'b_LeftHand_011'] },
        { name: 'HL', foot: 'b_LeftFoot02_018', bones: ['b_LeftLeg01_015', 'b_LeftLeg02_016', 'b_LeftFoot01_017', 'b_LeftFoot02_018'] },
        { name: 'HR', foot: 'b_RightFoot02_022', bones: ['b_RightLeg01_019', 'b_RightLeg02_020', 'b_RightFoot01_021', 'b_RightFoot02_022'] }]);
    } catch (e) { console.warn('[interaction] fox legs', e); }
    FX.q = [new Q().setFromAxisAngle(new V3(0, 1, 0), Math.PI), new Q(), new Q(), new V3(1, 0, 0), new V3(0, 0, 1)];
    FX.ready = true; return true;
  }
  // FIX-PERF: per-leg retime. In the fox clips the paws sweep back at different speeds during their stance (front ≈ 3×
  // slower than hind, and not even left = right), so at any rate one pair skates. Each leg whose stance speed differs
  // from the body's stride gets its own action on a warped clock: its stance plays at the rate that keeps the paw
  // planted (stance speed × warp slope = body stride), its swing takes the rest of the cycle, the stance centre stays
  // where the clip has it (legs keep their order in the gait). Body tracks keep the gait's phase.
  function legWarp(A, root, G, legs) {
    const mixer = A.mixer, N = 64, W = { acts: {}, tab: {} };
    for (const k of G.keys) {
      const act0 = A.acts[k], clip = act0.getClip(), dur = clip.duration, L = G.len[k];
      const clone = T3.SkeletonUtils.clone(root), mx = new T3.AnimationMixer(clone), a = mx.clipAction(clip); a.play();
      const hip = clone.getObjectByName(G.o.ref), fw = G.o.fwd || 1, rows = legs.map(() => []);
      for (let i = 0; i <= N; i++) {
        mx.setTime(dur * i / N); clone.updateMatrixWorld(true); const h = new V3().setFromMatrixPosition(hip.matrixWorld);
        legs.forEach((lg, j) => { const f = clone.getObjectByName(lg.foot), p = new V3().setFromMatrixPosition(f.matrixWorld); rows[j].push([(p.z - h.z) * fw, p.y]); });
      }
      a.stop(); mx.uncacheRoot(clone);
      const warped = [];
      legs.forEach((lg, j) => {
        const r = rows[j], ys = r.map((q) => q[1]), y0 = Math.min(...ys), tol = Math.max(0.012, (Math.max(...ys) - y0) * 0.12);
        const st = []; for (let i = 0; i < N; i++) st.push(r[i][1] - y0 < tol && r[i + 1][1] - y0 < tol);
        const v = []; for (let i = 0; i < N; i++) if (st[i]) { const d = r[i][0] - r[i + 1][0]; if (d > 0) v.push(d); }
        if (v.length < 3) return;
        v.sort((x, y) => x - y); const vs = v[v.length >> 1];
        const fs = st.filter(Boolean).length / N; let sl = Math.min(3.5, Math.max(0.4, (L / N) / vs));
        if (Math.abs(sl - 1) < 0.12) return;
        if (fs / sl > 0.85) sl = fs / 0.85;
        const q = (1 - fs) / (1 - fs / sl);
        // body phase at each clip step, stance centre anchored
        const P = [0]; for (let i = 0; i < N; i++) P.push(P[i] + (st[i] ? 1 / (N * sl) : 1 / (N * q)));
        const tot = P[N]; for (let i = 0; i <= N; i++) P[i] /= tot;
        let c0 = 0, best = -1; for (let i = 0; i < N; i++) { let run = 0; while (run < N && st[(i + run) % N]) run++; if (run > best && (i === 0 || !st[i - 1])) { best = run; c0 = (i + run / 2) / N; } }
        const Pc = P[Math.floor(c0 * N)] + (P[Math.floor(c0 * N) + 1] - P[Math.floor(c0 * N)]) * (c0 * N % 1);
        // inverse: body phase b → leg clip phase w with P(w) − Pc = b − c0
        const inv = new Float32Array(N + 1);
        for (let t = 0; t <= N; t++) { const pb = t / N; let i = 0; while (i < N - 1 && P[i + 1] < pb) i++; const f = (pb - P[i]) / Math.max(1e-6, P[i + 1] - P[i]); inv[t] = (i + Math.min(1, Math.max(0, f))) / N; }
        warped.push({ lg, inv, c0, Pc, sl: +sl.toFixed(2), q: +q.toFixed(2), fs: +fs.toFixed(2) });
      });
      if (!warped.length) continue;
      const bonesOf = (lg) => new Set(lg.bones);
      const isLeg = (tr, lg) => bonesOf(lg).has(tr.name.split('.')[0]);
      const body = new T3.AnimationClip(clip.name + '_body', dur, clip.tracks.filter((tr) => !warped.some((w) => isLeg(tr, w.lg))));
      const nb = mixer.clipAction(body); act0.stop(); A.acts[k] = nb;
      W.acts[k] = warped.map((w) => { const c = new T3.AnimationClip(clip.name + '_' + w.lg.name, dur, clip.tracks.filter((tr) => isLeg(tr, w.lg)).map((tr) => tr.clone()));
        const la = mixer.clipAction(c); la.setLoop(T3.LoopRepeat, Infinity); la.play(); la.setEffectiveWeight(0); la.setEffectiveTimeScale(0); return { la, w, dur }; });
      W.tab[k] = warped.map((w) => ({ leg: w.lg.name, slope: w.sl, swing: w.q, stance: w.fs }));
    }
    const legTime = (e, b) => { const w = e.w, pb = (((w.Pc + (b - w.c0)) % 1) + 1) % 1, t = pb * N, i = Math.min(N - 1, Math.floor(t)); return (w.inv[i] + (w.inv[i + 1] - w.inv[i]) * (t - i)) * e.dur; };
    const sync = (warp) => {
      for (const k in W.acts) {
        const main = A.acts[k], wt = main.isRunning() ? main.getEffectiveWeight() : 0, b = warp ? ((G.phase + G.off[k]) % 1) : (main.time / main.getClip().duration) % 1;
        for (const e of W.acts[k]) { e.la.enabled = wt > 1e-3; e.la.setEffectiveWeight(wt); e.la.time = warp ? legTime(e, b) : main.time; }
      }
    };
    const step = G.step; G.step = (dt) => { step(dt); sync(true); };
    const upd = A.update; A.update = (dt) => { if (!G.on) sync(false); return upd(dt); };
    return W;
  }
  // the game moved the fox straight at its target this frame; re-aim that step around solids (and never into one)
  function foxAvoid(dt) {
    const f = C.fox; if (!K.avoid || !C.PH.ok) { FX.px = f.x; FX.pz = f.z; return; }
    if (FX.px === undefined || Math.hypot(f.x - FX.px, f.z - FX.pz) > 3) { FX.px = f.x; FX.pz = f.z; return; }   // spawn / teleport
    const mx = f.x - FX.px, mz = f.z - FX.pz, L = Math.hypot(mx, mz);
    if (L > 1e-4) {
      const want = Math.atan2(mx, mz), gy = C.groundH(FX.px, FX.pz), look = L + 0.5 + Math.min(1.2, (f.speed || 0) * 0.12);
      const r = steerAround(FX.px, gy, FX.pz, want, look, 0.12, [0.28], FX.avMem || (FX.avMem = {}));
      if (r.blocked) {
        const a = r.off === null ? want : r.a, nx = FX.px + Math.sin(a) * L, nz = FX.pz + Math.cos(a) * L;
        if (r.off !== null && solidRay(FX.px, gy + 0.28, FX.pz, Math.sin(a), Math.cos(a), L + 0.2) === null) { f.x = nx; f.z = nz; }
        else { f.x = FX.px; f.z = FX.pz; }   // boxed in: hold, the next frames pick a side
        const oy = f.g.position.y - f.y; f.y = C.groundH(f.x, f.z); f.g.position.set(f.x, f.y + oy, f.z);
        f.yaw += wrapA(Math.atan2(-Math.sin(a), -Math.cos(a)) - f.yaw) * Math.min(1, dt * 10); f.g.rotation.y = f.yaw;
        STATS.foxDetours = (STATS.foxDetours || 0) + 1;
      }
    }
    FX.px = f.x; FX.pz = f.z;
  }
  function foxUpdate(dt) {
    if (!FX.ready && !foxSetup()) return;
    foxAvoid(dt);
    const f = C.fox, yaw = f.g.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // pounce: the moment the fox reaches what it was seeking, it leaps and dives nose-first into the snow
    if (FX.prevSt === 'seek' && f.st === 'wait' && FX.pounce < 0) { FX.pounce = 0; STATS.pounces++; }
    FX.prevSt = f.st;
    let py = 0, pz = 0, pp = 0;
    if (FX.pounce >= 0) {
      const t = FX.pounce += dt;
      if (t < 0.25) { const k = t / 0.25; py = -0.08 * k; pp = 0.15 * k; }                                    // crouch, weight back
      else if (t < 0.75) { const k = (t - 0.25) / 0.5; py = Math.sin(k * Math.PI) * 0.75 - 0.3 * k * k; pz = -0.7 * k; pp = 0.5 - 1.8 * k; }   // arc up, nose down
      else if (t < 1.45) { const k = (t - 0.75) / 0.7; py = -0.3 + 0.3 * smooth(0.5, 1, k); pz = -0.7 * (1 - smooth(0.4, 1, k)); pp = -1.3 * (1 - smooth(0.35, 1, k)); }   // buried, then out
      else FX.pounce = -1;
      if (t - dt < 0.75 && t >= 0.75) {
        const x = f.x + fx * 0.7, z = f.z + fz * 0.7, g = C.groundH(x, z);
        for (let i = 0; i < 22; i++) { const a = rnd(0, 6.283), s = rnd(0.8, 2.4); C.emit(x, g + 0.05, z, Math.sin(a) * s, rnd(1, 2.6), Math.cos(a) * s, rnd(0.5, 0.9), 0xe4ecfa, rnd(0.3, 0.5), 3, 3); }
        sfx('pounce');   // the fox's own body presses the hole it dives into (SNOW-CONTACT)
      }
    }
    // slope alignment
    const hF = C.groundH(f.x + fx * 0.3, f.z + fz * 0.3), hB = C.groundH(f.x - fx * 0.3, f.z - fz * 0.3), hR = C.groundH(f.x + rx * 0.12, f.z + rz * 0.12), hL = C.groundH(f.x - rx * 0.12, f.z - rz * 0.12);
    FX.pitch = damp(FX.pitch, Math.atan2(hF - hB, 0.6) * K.foxAlign, 8, dt); FX.roll = damp(FX.roll, Math.atan2(hR - hL, 0.24) * K.foxAlign, 8, dt);
    const Qs = FX.q, q = Qs[1].setFromAxisAngle(Qs[3], FX.pitch + pp).premultiply(Qs[2].setFromAxisAngle(Qs[4], FX.roll));
    FX.wrap.quaternion.copy(q).multiply(Qs[0]);
    // paws: on the drawn snow, sunk a little into the loose snow (a light animal: half a boot's share); the paw meshes then
    // press exactly that into the terrain's snow map (SNOW-CONTACT)
    let fsT = Math.min(snowDepth(f.x, f.z), 0.6) * K.snowFloat;
    if (typeof C.snowContact === 'function') { try { const q = C.snowContact(f.x, f.z), sink = (C.footPress ? C.footPress(f.x, f.z) : 0.5) * 0.5 * q.dep * (C.snowFine ? 0.3 + 0.7 * C.snowFine(f.x, f.z) : 1); const y = Math.max(q.s0 - sink, q.floor) - C.groundH(f.x, f.z); if (isFinite(y)) fsT = clamp(y, 0, 0.6); } catch (e) { /* terrain busy */ } }
    FX.snow = damp(FX.snow || 0, fsT, 4, dt);
    FX.wrap.position.set(0, py + FX.snow, pz);   // fox group local: -z is forward
  }


    return { ST, FX, stagUpdate, foxUpdate, bind(o) { if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; if ("T3" in o) T3 = o.T3; if ("Q" in o) Q = o.Q; } };
  };
})();
