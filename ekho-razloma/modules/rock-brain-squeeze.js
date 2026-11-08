/* modules/rock-brain-squeeze.js — squeezing sideways through a gap between rocks, and touching a face while walking past it. Moved out of modules/rock-brain.js unchanged. Classic script, loaded BEFORE rock-brain.js: window.createRockBrainSqueeze(deps) → { gapAhead, PH_off, squeeze, squeezeEnd, walkTouchPick, walkTouch, bind({...}) }. */
(function () {
  'use strict';
  window.createRockBrainSqueeze = function (X) {
    const { S, rej, feel, cast, STATS, damp, play, AV, clamp, avail, ground, axes, noteStart, RK, audit, LEGACY, spec, wrapA } = X;
    let C, T3;   // assigned later in the source module: set through bind()
  /* ---------------------------------------------------------------- squeeze through a gap */
  // two faces facing each other across the way, 0.55–0.95 m apart at hip / chest height: the pilot turns chest to one of
  // them and side-steps through (squeeze_side_r / _l: lead palm on the front face, the other on the face behind), kept on
  // the gap's midline; the clip pauses when the input stops, runs backwards when it reverses; out of the gap → walk on
  // the gap the squeeze clips cover: req.gap of squeeze_side_r_loop (old literal 0.55 / 0.95, STATS.audit)
  const GAP = { lo: 0.55, hi: 0.95, from: 'legacy' };
  function gapDerive() {
    if (GAP.from === 'meta') return;
    const meta = C.AV && C.AV.player && C.AV.player.contactMeta, m = meta && meta.clips && meta.clips.squeeze_side_r_loop, g = m && m.req && m.req.gap; if (!g) return;
    audit('squeeze_side', 'gap', LEGACY.squeeze_side.gap, g); GAP.lo = g[0]; GAP.hi = g[1]; GAP.from = 'meta';
  }
  function sides(x, y, z, px, pz, far) {
    const a = cast(x, y, z, px, 0, pz, far), b = cast(x, y, z, -px, 0, -pz, far);
    if (!a || !b) { if (a || b) rej('gap:ray1'); else rej('gap:ray0'); return null; }
    const na = Math.hypot(a.normal.x, a.normal.z), nb = Math.hypot(b.normal.x, b.normal.z); if (na < 0.35 || nb < 0.35) { rej('gap:flat'); return null; }
    return { a, b, w: a.distance + b.distance, nax: a.normal.x / na, naz: a.normal.z / na, nbx: b.normal.x / nb, nbz: b.normal.z / nb };
  }
  function gapAhead(P, D, hs) {
    if (!avail('squeeze_side_r') || !avail('squeeze_side_l')) { rej('gap:noClip'); return false; }
    gapDerive();
    STATS.gapTries = (STATS.gapTries || 0) + 1;
    if (S.gapMiss && C.T < S.gapMiss.until && Math.hypot(P.x - S.gapMiss.x, P.z - S.gapMiss.z) < 0.6) return false;
    const px = -D.z, pz = D.x;
    let best = null;
    for (const ahead of [0.35, 0.7]) {
      const qx = P.x + D.x * ahead, qz = P.z + D.z * ahead, g = ground(qx, qz, P.y);
      if (Math.abs(g.y - P.y) > 0.3) { rej('gap:level'); continue; }
      const hi = sides(qx, g.y + 1.1, qz, px, pz, 1.3), lo = sides(qx, g.y + 0.6, qz, px, pz, 1.3); if (!hi || !lo) { if (hi || lo) rej('gap:oneSide'); continue; }
      const w = Math.min(hi.w, lo.w); if (w < GAP.lo || w > GAP.hi) { rej(w < GAP.lo ? 'gap:narrow' : 'gap:wide'); continue; }
      if (hi.nax * hi.nbx + hi.naz * hi.nbz > -0.6) { rej('gap:facing'); continue; }               // the two faces look at each other
      if (Math.abs(hi.nax * D.x + hi.naz * D.z) > 0.5) { rej('gap:axis'); continue; }            // the gap runs the way the pilot goes
      // not a dead end: the way on is open for a body length
      const on = cast(qx, g.y + 1.0, qz, D.x, 0, D.z, 1.2); if (on && on.distance < 0.8) { rej('gap:deadEnd'); continue; }
      best = { ahead, hi, w, g }; break;
    }
    if (!best) return false;
    if (hs > 2.2) { P.speedCap = 1.8; return true; }   // brake into it
    const h = best.hi, F = h.b, fnx = h.nbx, fnz = h.nbz;   // chest to one of the two faces (either works: the clip is mirrored)
    const yaw = Math.atan2(fnx, fnz);   // facing −n: forward (−sin yaw, −cos yaw) = −n
    const X = axes(yaw), rx = -X.lx, rz = -X.lz, name = rx * D.x + rz * D.z >= 0 ? 'squeeze_side_r' : 'squeeze_side_l';
    const sp = spec(name); if (!sp) return false;
    S.sq = { name, sp, D: { x: D.x, z: D.z }, yaw, n: { x: fnx, z: fnz }, eF: F.e, lost: 0, t: 0, phase: sp.enter ? 'enter' : 'main', dir: 1, stuck: 0, gy: best.g.y };
    PH_off(true); S.state = 'squeeze'; S.t = 0; STATS.squeezes = (STATS.squeezes || 0) + 1; noteStart({ name, intent: 'pass', e: F.e });
    if (sp.enter) play(sp.enter, true, 0.2); else play(sp.clip, false, 0.2);
    return true;
  }
  function PH_off(off) { const PH = C.PH; if (!PH || !PH.ok) return; if (off) PH.ch.setEnabled(false); else { PH.ch.setEnabled(true); PH.ch.setPosition(C.player.x, C.player.y, C.player.z); } }
  function heldOut(P, vx, vz) { const o = C.PH.ch.move(0, { x: 0, z: 0 }); if (o && o.velocity) { o.velocity.x = vx; o.velocity.z = vz; o.velocity.y = 0; o.grounded = true; o.sliding = false; } P.vx = vx; P.vz = vz; P.vy = 0; P.onGround = true; }
  function squeeze(dt, P, i) {
    const Q = S.sq, A = AV(), I = window.INTERACTION, R = RK(); S.t += dt; Q.t += dt;
    if (!A || !I) { squeezeEnd(P, false); return; }
    const sp = Q.sp, D = Q.D, along = i.on ? i.x * D.x + i.z * D.z : 0;
    if (Q.phase === 'enter' && Q.t >= (A.acts[sp.enter] ? A.acts[sp.enter].getClip().duration : 0.6) - 0.03) { A.lock = 0; Q.phase = 'main'; play(sp.clip, false, 0.15); }
    // the walls at the body: re-read every frame, the body kept between them (front face at the clip's own distance share)
    const g = ground(P.x, P.z, P.y), sd = sides(P.x, g.y + 1.0, P.z, Q.n.x, Q.n.z, 0.9);
    if (!sd || sd.w > GAP.hi + 0.25) { Q.lost += dt; if (Q.lost > 0.2) { squeezeEnd(P, true); return; } } else Q.lost = 0;
    let x = P.x, z = P.z, y = Math.abs(g.y - P.y) < 0.3 ? damp(P.y, g.y, 12, dt) : P.y;
    if (sd) {
      // sd.a is along +n (behind the pilot: the face at its back), sd.b along −n (the face in front)
      const want = sd.w * 0.48 - sd.b.distance;   // + = move toward the back face (along +n)
      const m = clamp(want, -0.5 * dt, 0.5 * dt); x += Q.n.x * m; z += Q.n.z * m;
      const nb = Math.hypot(sd.b.normal.x, sd.b.normal.z), fx = sd.b.normal.x / nb, fz = sd.b.normal.z / nb; Q.n.x = damp(Q.n.x, fx, 6, dt); Q.n.z = damp(Q.n.z, fz, 6, dt); const l = Math.hypot(Q.n.x, Q.n.z); Q.n.x /= l; Q.n.z /= l;
      Q.yaw = Math.atan2(Q.n.x, Q.n.z); const sg = (D.x * -Q.n.z + D.z * Q.n.x) >= 0 ? 1 : -1; D.x = -Q.n.z * sg; D.z = Q.n.x * sg;   // the way through stays along the faces
    }
    // side-step: the clip's own pace (≈ 0.28 m/s) while the input goes along the gap; paused without it; backwards when reversed
    const dir = along > 0.3 ? 1 : along < -0.3 ? -1 : 0, v = 0.3 * dir;
    let vx = 0, vz = 0;
    if (dir && Q.phase === 'main') {
      const block = cast(x, g.y + 0.9, z, D.x * dir, 0, D.z * dir, 0.35);
      if (!block) { vx = D.x * v; vz = D.z * v; x += vx * dt; z += vz * dt; Q.stuck = 0; } else Q.stuck += dt;
    }
    if (Q.phase === 'main') A.speed(sp.clip, dir === 0 ? 0 : dir);
    if (!i.on) { Q.idleT = (Q.idleT || 0) + dt; if (Q.idleT > 6) { squeezeEnd(P, false); return; } } else Q.idleT = 0;
    P.x = x; P.z = z; P.y = y; P.face += clamp(wrapA(Q.yaw - P.face), -5 * dt, 5 * dt); P.c.g.rotation.y = P.face; P.c.g.position.set(x, y, z);
    C.PH.ch.setPosition(x, y, z); heldOut(P, vx, vz);
    // palms: each on its own face at the clip's contact height (front face straight ahead, the other straight behind)
    const X = axes(P.face), tg = {};
    for (const c of sp.contacts) {
      if (!/^hand/.test(c.bone)) continue; const p = c.surface.point, front = p[2] > 0;
      const ox = x + X.lx * p[0], oz = z + X.lz * p[0], oy = y + p[1], dx = front ? X.fx : -X.fx, dz = front ? X.fz : -X.fz;
      const h = cast(ox, oy, oz, dx, 0, dz, 0.9); if (h && Math.abs(h.normal.y) < 0.7) tg[c.bone] = { point: h.point.clone(), normal: h.normal.clone().normalize() };
    }
    Q.targets = tg;
    const layer = I.CT && I.CT.layer; if (layer && A.cur && A.acts[A.cur]) { if (I.layerHands) I.layerHands(A.acts[A.cur], (c) => tg[c.bone] || null, 'rock-squeeze', 'hands'); else { try { layer.update(A.acts[A.cur], (c) => tg[c.bone] || null, 1); } catch (e) { /* no hand contacts */ } } }
    if (R) { R.lookOn = true; Object.assign(R.lookPt, { x: x + D.x * dir * 2 - Q.n.x * 0.3, y: y + 1.5, z: z + D.z * dir * 2 - Q.n.z * 0.3 }); }
    const fp = Q.feel || (Q.feel = { rock: true }); fp.targets = tg; fp.normal = Q.n; fp.point = tg.hand_r ? tg.hand_r.point : tg.hand_l ? tg.hand_l.point : null;
    if (fp.point) { feel.active = true; feel.plan = fp; feel.trace = dir ? 1 : 0; feel.m = { w: 1, ny: 0, flat: false }; }
    if (Q.stuck > 1.2) { S.gapMiss = { x, z, until: C.T + 4 }; squeezeEnd(P, false); }
  }
  function squeezeEnd(P, out) {
    const Q = S.sq, A = AV(); PH_off(false);
    if (A) { A.lock = 0; if (Q) A.speed(Q.sp.clip, 1); }
    if (out && Q) { P.face = Math.atan2(-Q.D.x, -Q.D.z); P.c.g.rotation.y = P.face; C.PH.ch.setVelocity(Q.D.x * 1.2, 0, Q.D.z * 1.2); }
    S.gapMiss = S.gapMiss && C.T < S.gapMiss.until ? S.gapMiss : { x: P.x, z: P.z, until: C.T + 1.5 };
    S.state = 'release'; S.t = 0; S.sq = null; S.lastEnd = C.T;
  }
  // walking past a face: the near hand trails over it (arm IK over the walk / jog, no clip)
  let limb = { l: null, r: null };
  function walkTouchPick(P, vdir) {
    const Rv = { x: -vdir.z, z: vdir.x };   // right of the motion
    for (const side of [1, -1]) {
      const h = cast(P.x, P.y + 1.15, P.z, Rv.x * side, 0, Rv.z * side, 0.95); if (!h) continue;
      const nl = Math.hypot(h.normal.x, h.normal.z); if (nl < 0.6) continue;
      const nx = h.normal.x / nl, nz = h.normal.z / nl; if (Math.abs(nx * vdir.x + nz * vdir.z) > 0.45) continue;
      if (h.distance < 0.3) continue;
      S.state = 'walktouch'; S.t = 0; const W = S.wt; W.side = side; W.e = h.e; W.w = 0; W.miss = 0; W.feel = null;
      noteStart({ name: 'touch_walk_' + (side > 0 ? 'r' : 'l'), intent: 'walk', e: h.e });
      return true;
    }
    return false;
  }
  function walkTouch(dt, P, i, hs) {
    const W = S.wt, A = AV(), R = RK(); S.t += dt;
    if (i.on && P.onGround && hs > 0.2 && gapAhead(P, { x: P.vx / hs, z: P.vz / hs }, hs)) { if (S.state === 'squeeze') S.wt.w = 0; return; }
    const vdir = hs > 0.3 ? { x: P.vx / hs, z: P.vz / hs } : { x: -Math.sin(P.face), z: -Math.cos(P.face) }, Rv = { x: -vdir.z, z: vdir.x };
    let tgt = null, n = null;
    if (hs > 0.5 && hs < 5 && P.onGround) {
      const h = cast(P.x + vdir.x * 0.12, P.y + 1.12, P.z + vdir.z * 0.12, Rv.x * W.side, 0, Rv.z * W.side, 0.85, W.e);
      if (h && Math.abs(h.normal.y) < 0.6) { n = h.normal.clone().normalize(); tgt = h.point.clone().addScaledVector(n, 0.035); }
    }
    W.miss = tgt ? 0 : W.miss + dt;
    W.w = damp(W.w, tgt ? 1 : 0, tgt ? 5 : 8, dt);
    if (tgt) { W.tgt = tgt; W.n = n; }
    if (W.w < 0.02 && W.miss > 0.25) { S.state = 'free'; S.lastEnd = C.T; S.wtEnd = { t: C.T, e: W.e }; return; }
    if (!A || !A.contact || !W.tgt) return;
    const root = A.contact.root, key = W.side > 0 ? 'r' : 'l';
    if (!limb[key]) try { limb[key] = new window.ANIMLIB.LimbIK(root, 'hand_' + (W.side > 0 ? 'r' : 'l')); } catch (e) { limb[key] = null; }
    const sh = root.getObjectByName('upperarm_' + key); if (!sh || !limb[key]) return;
    const sp = sh.getWorldPosition(new T3.Vector3()), reach = sp.distanceTo(W.tgt), w = W.w * clamp((0.7 - reach) / 0.12, 0, 1);
    if (w > 0.01) {
      const L = limb[key], t = W.tgt.clone(), n = W.n.clone(), PP = window.POSE;
      const sf = t.clone().addScaledVector(n, -0.035);   // the surface point (W.tgt is 3.5 cm out: the old wrist offset)
      if (PP && PP.active('hands')) PP.request({ slot: 'hands', source: 'rock-walktouch', type: 'limbTarget', data: { bone: 'hand_' + key, point: sf, normal: n, weight: w }, apply: () => L.solve(t, w, n, sf) });
      else L.solve(t, w, n, sf);
      STATS.walkTouchFrames++;
    }
    if (R) { R.roll += 0.05 * W.side * W.w; R.lookOn = W.w > 0.3; Object.assign(R.lookPt, { x: W.tgt.x + vdir.x * 1.2, y: W.tgt.y + 0.1, z: W.tgt.z + vdir.z * 1.2 }); }
    const fp = W.feel || (W.feel = { rock: true, targets: {} }); fp.targets = { ['hand_' + key]: { point: W.tgt, normal: W.n } }; fp.normal = { x: W.n.x, z: W.n.z }; fp.point = W.tgt;
    feel.active = w > 0.3; feel.trace = w; feel.plan = fp;
    feel.m = { w: 0.6, ny: 0, flat: false };
    void i;
  }


    return { gapAhead, PH_off, squeeze, squeezeEnd, walkTouchPick, walkTouch, bind(o) { if ("C" in o) C = o.C; if ("T3" in o) T3 = o.T3; } };
  };
})();
