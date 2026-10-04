/* modules/interaction-body.js — the pilot's body in motion: the phase-synced gait blend space (walk, jog, run on one shared phase), leg warping to the ground, lean into turns and slopes, head look, arms and the push-hands pose. Moved out of modules/interaction.js unchanged. Classic script, loaded BEFORE interaction.js: window.createInteractionBody(deps) → { makeGait, bodyUpdate, PUSH, bind({ C, V3, Q, T3, footfall, stepsFromPose }) }. */
(function () {
  'use strict';
  window.createInteractionBody = function (X) {
    const { B, K, clamp, _p, RK, damp, _q, smooth, wpos, SUB, wrapA, solve2, worldDelta, TOUCH, STATS, strideSpeed, wquat, hitDown, snowDepth, up, setWorldQuat } = X;
    let C, V3, T3, Q, footfall, stepsFromPose;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ gait blend space (phase-synced) */
  // One gait family (walk / jog / run …) plays at ONE shared phase: every clip is aligned on the same foot's forward-most
  // point, weights follow the speed through transition bands, and the shared cycle rate = speed ÷ blended stride length
  // (stride length = measured contact speed × clip duration). The planted foot therefore stays put at every speed a clip
  // or a blend of two can reach; above rateMax the rate is capped (the owner clamps the speed there: gait.vMax).
  function gaitPhase(root, clip, foot, ref, fwd) {
    const clone = T3.SkeletonUtils.clone(root), mx = new T3.AnimationMixer(clone), act = mx.clipAction(clip); act.play();
    const f = clone.getObjectByName(foot), r = clone.getObjectByName(ref); let best = -1e9, bt = 0; const zs = [];
    if (f && r) for (let i = 0; i < 64; i++) {
      mx.setTime(clip.duration * i / 64); clone.updateMatrixWorld(true);
      const z = (_p[0].setFromMatrixPosition(f.matrixWorld).z - _p[1].setFromMatrixPosition(r.matrixWorld).z) * fwd; zs.push(z);
      if (z > best) { best = z; bt = i / 64; }
    }
    // foot position (forward of the reference bone) per phase, phase 0 = forward-most point (heel strike)
    const i0 = Math.round(bt * 64), zp = zs.length ? zs.map((_, j) => zs[(i0 + j) % 64]) : null;
    act.stop(); mx.uncacheRoot(clone); return { off: bt, zp };
  }
  // o: { root, keys, stride {k: m/s}, bands [[a, b]] between keys[i] and keys[i+1] (m/s), idle?, idleLo, idleHi, foot, ref, fwd (±1: model forward axis z),
  //      rateMax, speed() → signed m/s along the facing, enabled() }
  function makeGait(A, o) {
    const G = { on: false, phase: 0, fade: 1, fadeDur: 0.2, keys: o.keys.filter((k) => A.acts[k] && o.stride[k] > 0.05), dur: {}, len: {}, off: {}, w: {}, f: 0, o };
    if (!G.keys.length) return null;
    G.zp = {}; for (const k of G.keys) { const c = A.acts[k].getClip(), ph = gaitPhase(o.root, c, o.foot, o.ref, o.fwd); G.dur[k] = c.duration; G.len[k] = o.stride[k] * c.duration; G.off[k] = ph.off; G.zp[k] = ph.zp; }
    // start phase per clip: in the stance half (heel strike → the foot's rearmost point), where the foot sits where the
    // idle stance has it: starting from a standstill the planted foot does not move
    let zIdle = 0; if (o.idle && A.acts[o.idle]) { const c2 = T3.SkeletonUtils.clone(o.root), m2 = new T3.AnimationMixer(c2); m2.clipAction(A.acts[o.idle].getClip()).play(); m2.setTime(0); c2.updateMatrixWorld(true);
      const f = c2.getObjectByName(o.foot), r = c2.getObjectByName(o.ref); if (f && r) zIdle = (_p[0].setFromMatrixPosition(f.matrixWorld).z - _p[1].setFromMatrixPosition(r.matrixWorld).z) * o.fwd; m2.uncacheRoot(c2); }
    G.start = {}; for (const k of G.keys) { const z = G.zp[k]; let j1 = 0; if (z) { for (let j = 1; j < 64; j++) if (z[j] < z[j1]) j1 = j; let bj = 0, bd = 1e9; for (let j = 0; j <= j1; j++) { const d = Math.abs(z[j] - zIdle); if (d < bd) { bd = d; bj = j; } } G.start[k] = bj / 64; } else G.start[k] = 0.1; }
    G.zIdle = zIdle;
    const last = G.keys[G.keys.length - 1]; G.vMax = o.stride[last] * o.rateMax;
    const isG = (k) => G.keys.includes(k) || (o.idle && k === o.idle);
    G.startKey = () => { const w = o.want ? o.want() : 0, b0 = o.bands.length ? o.bands[0][1] : 0; return w >= b0 && G.keys.length > 1 ? G.keys[1] : G.keys[0]; };
    const origLoop = A.loop.bind(A), origOnce = A.once.bind(A), origSpeed = A.speed.bind(A), origUpdate = A.update.bind(A);
    G.enter = (fade) => {
      const prev = A.cur && A.acts[A.cur];
      if (prev && !isG(A.cur)) { prev.fadeOut(fade); G.fade = 0; G.fadeDur = Math.max(0.05, fade); } else G.fade = 1;
      if (Math.abs(o.speed()) < 1.2) G.phase = G.start[G.startKey()];   // from a standstill: the idle stance's planted foot stays
      for (const k of G.keys.concat(o.idle && A.acts[o.idle] ? [o.idle] : [])) { const a = A.acts[k]; a.stopFading(); a.enabled = true; a.setLoop(T3.LoopRepeat, Infinity); if (!a.isRunning()) { a.reset(); a.play(); } if (k === o.idle && A.cur !== o.idle) a.setEffectiveWeight(0); }
      G.on = true;
    };
    G.exit = (fade) => {
      for (const k of G.keys.concat(o.idle && A.acts[o.idle] ? [o.idle] : [])) { const a = A.acts[k]; if (a.getEffectiveWeight() > 1e-3) { a.setEffectiveTimeScale(k === o.idle ? 1 : Math.max(0.05, Math.abs(G.f) * G.dur[k])); a.fadeOut(fade); } else a.stop(); }
      G.on = false;
    };
    A.loop = (k, fade = 0.2) => {
      if (A.lock > 0) return;
      if (o.enabled() && (G.keys.includes(k) || (G.on && k === o.idle))) { if (!G.on) G.enter(fade); return; }
      if (G.on) { G.exit(fade); if (A.cur === k) A.cur = null; }   // else the new clip cross-fades from the dominant gait clip
      return origLoop(k, fade);
    };
    A.once = (k, dur, fade = 0.12) => { if (G.on) { G.exit(fade); if (A.cur === k) A.cur = null; } return origOnce(k, dur, fade); };
    A.speed = (k, s) => (G.on && isG(k) ? undefined : origSpeed(k, s));
    A.update = (dt) => {
      if (G.on && !o.enabled()) { G.exit(0.2); const k = o.idle || G.keys[0]; if (A.cur === k) A.cur = null; origLoop(k, 0.2); }
      if (G.on) G.step(dt);
      return origUpdate(dt);
    };
    G.step = (dt) => {
      const v = o.speed(), av = Math.abs(v);
      if (av < 0.1) G.still = (G.still || 0) + dt; else { if (G.still > 0.25) G.phase = G.start[G.startKey()]; G.still = 0; }   // restart from a standstill
      // weights follow max(speed, wanted speed) while speeding up (a run starts in the jog, not through the walk) and
      // hold while braking (the stop happens in the gait it was in); a slow walk (wanted speed low) uses the walk clip
      const want = o.want ? o.want() : av, b0 = o.bands.length ? o.bands[0][1] : 0;
      // at the stop the gait weights ease into the walk pose over ~0.1 s (they snapped: a foot high in a jog's flight phase
      // jumped up to 0.6 m to the walk pose's foot in one frame — PHYSBODY.md)
      let wv = want + 0.3 < av ? Math.max(av, G.hold || 0) : Math.max(av, Math.min(want, b0)); if (av < 0.05) wv = G.hold === undefined ? Math.min(want, b0) : damp(G.hold, Math.min(want, b0), 20, dt); G.hold = wv;
      for (const k of G.keys) G.w[k] = 0;
      G.w[G.keys[0]] = 1;
      for (let j = 0; j < G.keys.length - 1; j++) {
        const [a, b] = o.bands[j], t = clamp((wv - a) / (b - a), 0, 1); if (t <= 0) break;
        G.w[G.keys[j]] = 1 - t; G.w[G.keys[j + 1]] = t; if (t < 1) break;
      }
      let L = 0, top = G.keys[0], tw = -1; for (const k of G.keys) { L += G.w[k] * G.len[k]; if (G.w[k] > tw) { tw = G.w[k]; top = k; } }
      let f = L > 1e-4 ? v / L : 0; const fMax = o.rateMax / G.dur[top]; f = clamp(f, -fMax, fMax); G.f = f;
      G.phase = ((G.phase + f * dt) % 1 + 1) % 1;
      const wiT = o.idle && A.acts[o.idle] ? 1 - clamp((av - o.idleLo) / (o.idleHi - o.idleLo), 0, 1) : 0;
      G.wi = G.wi === undefined ? wiT : damp(G.wi, wiT, wiT > G.wi ? 7 : 9, dt); const wi = G.wi;   // settle into idle over ~0.3 s (no pelvis snap at a stop)
      G.fade = Math.min(1, G.fade + dt / G.fadeDur);
      for (const k of G.keys) { const a = A.acts[k]; a.setEffectiveTimeScale(0); a.time = ((G.phase + G.off[k]) % 1) * G.dur[k]; a.setEffectiveWeight(G.w[k] * (1 - wi) * G.fade); }
      if (wi > 0 || (o.idle && A.acts[o.idle] && A.acts[o.idle].isRunning())) { const a = A.acts[o.idle]; a.setEffectiveTimeScale(1); a.setEffectiveWeight(wi * G.fade); }
      A.cur = wi > 0.5 ? o.idle : top;
    };
    return G;
  }
  function bodySetup() {
    const A = C.AV.player; if (!A || !A.mixer) return false;
    const root = A.mixer.getRoot(), wrap = root.parent; if (!wrap) return false;
    B.A = A; B.root = root; B.wrap = wrap;
    for (const n of TOUCH.concat(['pelvis', 'ball_l', 'ball_r'])) { const b = root.getObjectByName(n); if (!b) { if (/thigh|calf|foot/.test(n)) return false; } else B.bones[n] = b; }
    B.legs = ['l', 'r'].map((s) => ({ s, thigh: B.bones['thigh_' + s], calf: B.bones['calf_' + s], foot: B.bones['foot_' + s], ball: B.bones['ball_' + s], n: new V3(), anim: new V3(), ballAnim: new V3(),
      wq: new Q(), g: { y: 0, nx: 0, ny: 1, nz: 0, tag: null }, gb: 0, h: 0, hPrev: 0, planted: true, up: 0, tgt: new V3(),
      locked: false, lockX: 0, lockZ: 0, plantF: 0, lk: 0, offX: 0, offZ: 0, step: null, lift: 0 }));
    for (const n of TOUCH) if (B.bones[n]) B.saved.set(B.bones[n], { anim: new Q(), ik: new Q(), has: false });
    // stride speeds of the locomotion clips (m/s at timeScale 1) → playback rate follows the real ground speed
    try {
      for (const k of ['walk', 'jog', 'run']) if (A.acts[k]) B.stride[k] = strideSpeed(root, A.acts[k].getClip(), [['foot_l', 'ball_l'], ['foot_r', 'ball_r']], 'pelvis');
      const idle = A.acts.idle && A.acts.idle.getClip();
      if (idle) { const c2 = T3.SkeletonUtils.clone(root), m2 = new T3.AnimationMixer(c2); m2.clipAction(idle).play(); m2.setTime(0); c2.updateMatrixWorld(true); const f = c2.getObjectByName('foot_l'), fb = c2.getObjectByName('ball_l'); const p = new V3().setFromMatrixPosition(f.matrixWorld); const r0 = new V3().setFromMatrixPosition(c2.matrixWorld); B.hRest = clamp(p.y - r0.y, 0.05, 0.16); if (fb) B.hRestBall = clamp(new V3().setFromMatrixPosition(fb.matrixWorld).y - r0.y, 0, 0.06); m2.uncacheRoot(c2); }
    } catch (e) { console.warn('[interaction] stride sampling failed', e); }
    const orig = A.speed.bind(A);
    A.speed = (k, s) => {
      const v = B.stride[k];
      if (K.stride && v > 0.3 && SUB.body) { const P = C.player, hs = Math.hypot(P.vx, P.vz); s = clamp(hs / v, K.strideMin, K.strideMax); }
      return orig(k, s);
    };
    // walk ↔ jog ↔ sprint as one phase-synced blend space (replaces per-clip rates + crossfades between gaits)
    try {
      B.gait = makeGait(A, { root, keys: ['walk', 'jog', 'run'], stride: B.stride, bands: K.gaitBands, idle: 'idle', idleLo: 0.12, idleHi: 0.8, foot: 'foot_l', ref: 'pelvis', fwd: 1, rateMax: 1.9,
        enabled: () => K.gait && SUB.body, want: () => C.player.wantS || 0,
        speed: () => { const P = C.player, c = P.c.g, hs = Math.hypot(P.vx, P.vz), d = -P.vx * Math.sin(c.rotation.y) - P.vz * Math.cos(c.rotation.y); return d < -0.3 * hs ? -hs : hs; } });
    } catch (e) { console.warn('[interaction] gait setup failed', e); B.gait = null; }
    B.ready = true; return true;
  }
  // bones the mixer did not rewrite this frame still hold last frame's IK: put their animation pose back first
  function restoreBones() {
    for (const [b, s] of B.saved) { if (s.has && b.quaternion.equals(s.ik)) b.quaternion.copy(s.anim); s.anim.copy(b.quaternion); s.has = false; }
  }
  function markBones() { for (const [b, s] of B.saved) { s.ik.copy(b.quaternion); s.has = true; } }

  function bodyUpdate(dt) {
    if (!B.ready && !bodySetup()) return;
    const A = B.A, P = C.player, G = C.G, c = P.c;
    const mixT = A.mixer.time; if (mixT === B.prevMixT) return; B.prevMixT = mixT;   // bones not re-posed this frame
    restoreBones(); if (window.POSE) POSE.rebase();   // the pipeline's audit reference: clip pose + the restored bones
    const play = C.mode === 'play' || C.mode === 'menu';
    const climbing = C.CLIMB && C.CLIMB.t >= 0, riding = G.riding, dead = G.deadT > 0;
    // the controller's onGround flickers for single frames at a stop / on a crest (snap-to-ground): a flicker must not
    // drop the leg IK or the planted-foot pins (the boot would jump to the clip's foot for a frame = a scuff in the print).
    // Airborne for real = off the ground > 0.1 s, or rising (a jump takes off at 10 m/s)
    B.airT = P.onGround || C.mode === 'menu' ? 0 : (B.airT || 0) + dt;
    const grounded = play && !riding && !dead && !climbing && (P.onGround || C.mode === 'menu' || (B.airT < 0.1 && (P.vy || 0) < 1));
    B.wLegs = damp(B.wLegs, grounded && K.ik ? 1 : 0, grounded ? 10 : 18, dt);
    B.wrap.position.y = 0; B.wrap.position.x = 0; B.wrap.position.z = 0;
    c.g.updateMatrixWorld(true);
    // own vectors (not the shared scratch _p): the pose pipeline applies the requests after other code reused the scratch
    const face = c.g.rotation.y, F = (B.F || (B.F = new V3())).set(-Math.sin(face), 0, -Math.cos(face)), R = (B.R || (B.R = new V3())).set(Math.cos(face), 0, -Math.sin(face));
    const hs = Math.hypot(P.vx, P.vz);
    // PHYSBODY (modules/physbody.js): a ragdoll / fall clip / get-up owns the whole body — no feet to place, no look, no arms
    const PB = C.physbody;
    if (PB && PB.owns && PB.owns()) {
      B.wLegs = 0; B.pelvis = 0; for (const L of B.legs) { L.lk = 0; L.offX = L.offZ = 0; L.step = null; L.up = 1; }
      try { PB.pose(dt, F); } catch (e) { /* physbody guards itself */ }
      markBones(); return;
    }
    // ---- ground under each foot (animation pose, no offsets)
    let minD = 1e9, sinkT = 0;
    for (const L of B.legs) {
      wpos(L.foot, L.anim); if (L.ball) wpos(L.ball, L.ballAnim); wquat(L.foot, L.wq);
      L.hPrev = L.h; L.h = L.anim.y - P.y;
      L.cPrev = L.c; L.c = Math.min(L.h - B.hRest, L.ball ? L.ballAnim.y - P.y - B.hRestBall : 1);   // contact: heel or toe down
      // foot-lock (PHYSBODY, replaces POLISH-1's walk<->idle-blend-only lock): a planted foot holds its world x/z for its
      // WHOLE stance, not only during the walk<->idle cross-blend. The clip's stance foot drifts a few cm against the
      // ground whenever the phase-synced stride and the real ground speed disagree (acceleration, braking, the idle
      // blend, turning) and the terrain presses whatever the boot covers every frame, so any drift is a smeared print.
      // The pinned point is the part of the sole that carries the weight: the heel (ankle x/z) from heel strike until the
      // ball comes down, then the ball — the switch is continuous (the ball is pinned where it is at that instant), so
      // heel strike -> flat -> toe-off rolls over the right pivot instead of sliding. Lift-off releases the lock with the
      // foot already in the air: the offset (pinned - clip) decays over ~0.15 s of swing, never while the boot touches
      // the snow (a damped follower on the ground crawls = smear; see POLISH-1.md). A pin further than K.lockMax from
      // the clip (turning on the spot, teleport) re-plants at the clip's foot: one clean new print, no crawl.
      // Only x/z are pinned: height, sole tilt and snow sink read the live pose and the ground under the pinned point.
      { const ballH = L.ball ? L.ballAnim.y - P.y - B.hRestBall : 1, heelH = L.h - B.hRest;
        // STOP-SLIDE: this used to engage at <2cm while the snow sink below (line ~399) started ramping in from <8cm —
        // for those middle few cm the boot was already pressing the loose snow at its still-swinging (unlocked) x/z, so
        // the print smeared from wherever the foot was mid-descent to wherever it actually planted (13-18 cm on a stop).
        // Engaging the x/z pin at the SAME height the sink ramp starts means the boot is already pinned before it presses
        // anything: no swinging position ever gets pressed.
        const dn = L.lk ? Math.min(heelH, ballH) < 0.08 : Math.min(heelH, ballH) < 0.045;   // hysteresis: plant < 4.5 cm, lift > 8 cm
        const bdx = L.ball ? L.ballAnim.x - L.anim.x : 0, bdz = L.ball ? L.ballAnim.z - L.anim.z : 0;
        const other = B.legs[0] === L ? B.legs[1] : B.legs[0];
        // the other foot carries the weight: planted, or its own settle step already past the middle (a shuffle, never a hop)
        const otherDown = other && ((other.lk > 0 && !other.step) || (other.step && other.step.t > other.step.dur * 0.55));
        const stepTo = (ox, oz) => { L.step = { t: 0, dur: K.stepDur, sx: L.anim.x + ox, sz: L.anim.z + oz }; L.lk = 0; };
        L.lift = 0;
        if (!K.footLock || !grounded || riding) { L.lk = 0; L.offX = L.offZ = 0; L.step = null; }
        else if (L.step) {   // settle step: lift the boot off its print, set it down where the clip has it (clean new print)
          // the boot first rises out of its print in place, travels only while clear of the snow, then sinks into the new one
          const S = L.step; S.t += dt; const u = clamp(S.t / S.dur, 0, 1), e = smooth(0.15, 0.85, u);
          // from the world spot it left to wherever the clip's foot is NOW (the clip is still settling into its stance)
          L.offX = (S.sx - L.anim.x) * (1 - e); L.offZ = (S.sz - L.anim.z) * (1 - e); L.lift = K.stepLift * Math.sin(Math.PI * u);
          if (u >= 1) { L.step = null; L.lift = 0; L.offX = L.offZ = 0; STATS.settleSteps = (STATS.settleSteps || 0) + 1; if (SUB.steps) footfall(L, 1); }
        } else if (dn) {
          const cx = L.anim.x + (L.offX || 0), cz = L.anim.z + (L.offZ || 0);   // where the foot is drawn right now
          if (!L.lk) { if (L.ball && ballH < 0.02 && heelH >= 0.02) { L.lk = 2; L.lockX = cx + bdx; L.lockZ = cz + bdz; } else { L.lk = 1; L.lockX = cx; L.lockZ = cz; } }
          else if (L.lk === 1 && L.ball && ballH < 0.02) { L.lk = 2; L.lockX += bdx; L.lockZ += bdz; }   // flat: pivot moves heel -> ball, same point
          const ax = L.lk === 2 ? L.lockX - bdx : L.lockX, az = L.lk === 2 ? L.lockZ - bdz : L.lockZ, ox = ax - L.anim.x, oz = az - L.anim.z, dev = Math.hypot(ox, oz);
          L.offX = ox; L.offZ = oz;
          // standing (stopped / turning on the spot) and the clip's foot has moved away from the pinned one (walk -> idle
          // settles into a different stance, a turn rotates the stance): take a settle step, one foot at a time
          if (otherDown && (dev > K.lockMax || (dev > K.lockStep && hs < 0.5))) stepTo(ox, oz);
          if (dev > 0.6) { L.step = null; L.lk = 0; L.offX = L.offZ = 0; }   // teleport / respawn: re-plant at the clip's foot
        } else if (L.lk || L.offX || L.offZ) {   // swing: release in the air
          // only once the boot is clear of the snow (the planted sink fades out between 2 and 8 cm of lift): a boot still
          // in its print that moved sideways would drag the print along
          L.lk = 0; const k = Math.exp(-K.lockRelease * dt * smooth(0.06, 0.11, L.c)); L.offX = (L.offX || 0) * k; L.offZ = (L.offZ || 0) * k;
          if (Math.abs(L.offX) + Math.abs(L.offZ) < 1e-4) L.offX = L.offZ = 0;
        }
        L.locked = L.lk > 0; }
      L.plantF = (1 - smooth(0.04, 0.2, L.c)) * (L.step ? 1 - Math.sin(Math.PI * clamp(L.step.t / L.step.dur, 0, 1)) : 1);
      const px = L.anim.x + (L.offX || 0), pz = L.anim.z + (L.offZ || 0);
      const h = riding ? null : hitDown(px, P.y + 0.75, pz, K.ikRay);
      if (h) { L.g = h; } else { L.g = { y: P.y - 0.02, nx: 0, ny: 1, nz: 0, tag: null }; }
      const ny = clamp(L.g.ny, 0.6, 1);
      // loose snow (terrain module) lies above the physics ground: a boot compresses it and rests K.snowFloat of the way up
      // on terrain the boot stands on the DRAWN snow (terrain module, SNOW-CONTACT: the object-pressed snow map read back
      // from the GPU). Swinging, the foot follows that surface; planting, it sinks into the loose snow — footPress = the
      // share of the loose snow a boot compresses — unless an older, deeper print is already there. The terrain draws the
      // boot itself into its snow map, so the print under the planted boot IS the boot sole: foot and print coincide.
      L.snow = 0; L.onSnow = K.snowSurface && !riding && L.g.tag && L.g.tag.kind === 'terrain' && typeof C.snowContact === 'function';
      let gy = L.g.y;
      if (L.onSnow) { const sx = L.ball ? px + (L.ballAnim.x - L.anim.x) / 2 : px, sz = L.ball ? pz + (L.ballAnim.z - L.anim.z) / 2 : pz;
        try { const q = C.snowContact(sx, sz);
          if (isFinite(q.s0) && Math.abs(q.s0 - L.g.y) < 1) {
            // swing: on the undisturbed snow (exact CPU replay of what the GPU draws); planted: sunk footPress × loose depth,
            // never below the compacted layer the terrain draws. An older print here has the same depth (same rule, same spot)
            const su = L.step ? clamp(L.step.t / L.step.dur, 0, 1) : 0;
            // STOP-SLIDE: this ramp's top end (was 0.08) now matches the x/z pin's engage height above (0.045) — sink
            // only starts once the boot is already pinned in x/z, so it always presses the spot it ends up resting on,
            // never a swinging one. Still a ramp by HEIGHT, not by time locked, so a fast running plant still reaches
            // full depth the instant the boot is flat (no shallow prints from a short stance).
            const plant = (1 - smooth(0.02, 0.045, L.c)) * (L.step ? 1 - smooth(0, 0.2, su) + smooth(0.8, 1, su) : 1), sink = (C.footPress ? C.footPress(sx, sz) : 0.5) * q.dep;
            gy = q.s0 + (Math.max(q.s0 - sink, q.floor) - q.s0) * plant;
          } } catch (e) { /* terrain busy */ } }
      else if (!riding && L.g.tag && L.g.tag.kind === 'terrain') L.snow = Math.min(snowDepth(px, pz), 0.6) * K.snowFloat;
      L.gy = gy;
      L.tgt.set(px, gy + L.snow + Math.max(L.h, 0) / ny + (L.lift || 0), pz);
      minD = Math.min(minD, L.tgt.y - L.anim.y);
    }
    // a deck with gaps (pier planks, grating): one foot's ray found the solid, the other fell through to the terrain below
    { const [a, b] = B.legs; if (a && b && a.g.tag && b.g.tag) for (const [s1, s2] of [[a, b], [b, a]]) if (s1.g.tag.kind === 'solid' && s2.g.tag.kind === 'terrain' && s2.gy < s1.g.y - 0.12 && Math.abs(s1.g.y - P.y) < 0.15) {
      const ny = clamp(s1.g.ny, 0.6, 1); s2.gy = s1.g.y; s2.tgt.y = s1.g.y + Math.max(s2.h, 0) / ny; s2.onSnow = false; } }
    minD = Math.min(...B.legs.map((L) => L.tgt.y - L.anim.y));
    B.sink = 0;   // snow sink is the snow float above (terrain draws loose snow over the hard ground)
    // ---- pelvis offset: the lower foot must reach its ground; the other bends its knee
    const pel = grounded ? clamp(minD - B.sink, K.pelvisMin, K.pelvisMax) : 0;
    B.pelvis = damp(B.pelvis, pel * B.wLegs, 16, dt);
    if (P.sliding && !riding) {   // face down the slope while sliding
      const L0 = B.legs[0].g; const dl = Math.hypot(L0.nx, L0.nz);
      if (dl > 0.2) { const want = Math.atan2(-L0.nx, -L0.nz); B.slideYaw = B.slideYaw === null ? face : B.slideYaw + wrapA(want - B.slideYaw) * Math.min(1, dt * 6); c.g.rotation.y = B.slideYaw; }
    } else B.slideYaw = null;
    // POSE (modules/pose-pipeline.js): with the pipeline on, every bone write below is a PoseRequest applied after all
    // modules decided (same order as here: pelvis → legs → spine → look → arms → springs), reading the rock-brain's
    // lean / dip / look of THIS frame; off (POSE.K.<name> = false) → written at once, as before
    const PP = window.POSE, pp = (n) => !!(PP && PP.active(n));
    const ppLegs = pp('legs'), ppLean = pp('lean'), ppLook = pp('look'), ppArms = pp('arms'), ppSprings = pp('springs');
    // ---- lean into turns / slopes / speed (spine), plus slide stance
    if (ppLean) PP.request({ slot: 'spine', source: 'lean', type: 'spineLean', data: B.lean, apply: () => leanUpdate(dt, F, R, hs, grounded) });
    else leanUpdate(dt, F, R, hs, grounded);
    if (ppLegs) {
      PP.request({ slot: 'pelvis', source: 'legs', type: 'pelvisOffset', data: { dy: B.pelvis }, apply: () => { B.wrap.position.y = B.pelvis - RK.dip; c.g.updateMatrixWorld(true); } });
      PP.request({ slot: 'legs', source: 'legs', type: 'limbTarget', data: B.legs.map((L) => ({ bone: L.foot.name, point: L.tgt, weight: B.wLegs, normal: L.g })), apply: () => legsApply(climbing, R) });
    } else { B.wrap.position.y = B.pelvis - RK.dip; c.g.updateMatrixWorld(true); legsApply(climbing, R); }
    if (ppLook) PP.request({ slot: 'look', source: 'look', type: 'look', data: B.look, apply: () => lookUpdate(dt, F, R) }); else lookUpdate(dt, F, R);
    if (ppArms) PP.request({ slot: 'arms', source: 'arms', type: 'limbTarget', data: B.arms, apply: () => armsUpdate(dt, F, R) }); else armsUpdate(dt, F, R);
    if (PB && PB.pose) {   // springs + collision tips on the upper body
      if (ppSprings) PP.request({ slot: 'springs', source: 'physbody', type: 'spring', data: null, apply: () => { try { PB.pose(dt, F); } catch (e) { /* physbody guards itself */ } } });
      else { try { PB.pose(dt, F); } catch (e) { /* physbody guards itself */ } }
    }
    // the IK'd pose is remembered once every bone write of the frame is done (restoreBones() puts back what the mixer skips)
    if (ppLegs || ppLean || ppLook || ppArms || ppSprings) PP.after(markBones); else markBones();
    stepsFromPose(dt, grounded, hs);
  }
  // legs onto the ground (after the pelvis offset): two-bone IK + the sole on the ground normal; the climb's foot lock
  function legsApply(climbing, R) {
    if (B.wLegs > 0.001) for (const L of B.legs) {
      const tgt = _p[18].copy(L.anim); tgt.y += B.pelvis;
      tgt.lerp(_p[19].set(L.tgt.x, L.tgt.y - B.sink, L.tgt.z), B.wLegs);
      solve2(L.thigh, L.calf, L.foot, tgt, R, L.n);
      // foot sole to the ground normal while planted (swing keeps the clip's foot)
      const plant = L.plantF * B.wLegs;
      if (plant > 0.01) {
        const n = _p[20].set(L.g.nx, L.g.ny, L.g.nz); if (n.y < Math.cos(K.tiltMax)) { n.y = 0; n.setLength(Math.sin(K.tiltMax)); n.y = Math.cos(K.tiltMax); } n.normalize();
        const tilt = _q[2].setFromUnitVectors(up(), n); _q[3].identity().slerp(tilt, plant);
        setWorldQuat(L.foot, _q[4].copy(L.wq).premultiply(_q[3]));
      }
    }
    // climbing: the left foot, once on the top, stays where it landed while the body rises over it (CLIMB.footLock)
    const fk = climbing && C.CLIMB.footLock;
    if (fk && fk.w > 0.01 && B.legs[0]) { const L = B.legs[0], cur = wpos(L.foot, _p[18]); cur.lerp(_p[19].set(fk.x, fk.y, fk.z), fk.w); solve2(L.thigh, L.calf, L.foot, cur, R, L.n); }
  }
  function leanUpdate(dt, F, R, hs, grounded) {
    const P = C.player, L = B.lean, sp = B.bones.spine_01; if (!sp) return;
    const face = P.face; if (L.prevFace === null) L.prevFace = face;
    const yawRate = wrapA(face - L.prevFace) / Math.max(dt, 1e-3); L.prevFace = face;
    const acc = (hs - L.prevHs) / Math.max(dt, 1e-3); L.prevHs = hs;
    const g0 = B.legs[0].g, g1 = B.legs[1].g, slope = grounded ? -(g0.nx + g1.nx) * 0.5 * F.x - (g0.nz + g1.nz) * 0.5 * F.z : 0;   // >0 = uphill ahead
    const push = B.arms.mode === 'push' ? B.arms.w : 0;
    const lk = window.POSE && window.POSE.MOD && window.POSE.active('lean') && window.POSE.K.solve ? window.POSE.MOD.lean : 1;   // PoseSolver: 'less lean' step
    const rollT = grounded ? clamp(-yawRate * hs * 0.018, -0.28, 0.28) + RK.roll * lk : 0;
    const pitchT = grounded ? clamp(clamp(-(hs / 11) * 0.1 - clamp(acc, -20, 20) * 0.004 - slope * 0.45 - push * 0.3, -0.45, 0.2) + RK.pitch * lk, -0.6, 0.5) : 0;
    L.roll = damp(L.roll, rollT * K.lean, 6, dt); L.pitch = damp(L.pitch, pitchT * K.lean, 5, dt);
    if (Math.abs(L.roll) + Math.abs(L.pitch) < 1e-4) return;
    const q = _q[5].setFromAxisAngle(F, L.roll).multiply(_q[6].setFromAxisAngle(R, L.pitch));
    worldDelta(sp, q);
  }
  function lookTarget() {
    const P = C.player, out = _p[21];
    if (C.G.riding || C.CLIMB && C.CLIMB.t >= 0 || P.aimT > 0) return null;
    if (RK.lookOn) return out.set(RK.lookPt.x, RK.lookPt.y, RK.lookPt.z);
    let best = null, bd = K.lookRange;
    const orm = C.orm && C.orm.pos;
    if (orm && C.G.stage >= 1) { const d = Math.hypot(orm.x - P.x, orm.z - P.z); if (d < 9 || C.Dialog && C.Dialog.active && d < 14) { best = out.set(orm.x, C.orm.g.position.y + 1.62, orm.z); bd = 0; } }
    if (!best) for (const it of C.INTER || []) {
      try { if (it.when && !it.when()) continue; const p = it.pos(); if (!p) continue; const d = Math.hypot(p.x - P.x, p.z - P.z); if (d < bd && d > 0.6) { bd = d; best = out.set(p.x, (p.y !== undefined ? p.y : P.y) + 0.4, p.z); } } catch (e) { /* stale item */ }
    }
    const f = C.fox; if (!best && f && f.g && Math.hypot(f.x - P.x, f.z - P.z) < 5) best = out.set(f.x, f.g.position.y + 0.35, f.z);
    return best;
  }
  function lookUpdate(dt, F, R) {
    if (!SUB.look || !K.look) return;
    const head = B.bones.Head, neck = B.bones.neck_01; if (!head || !neck) return;
    const L = B.look, tgt = lookTarget();
    let yawT = 0, pitchT = 0, wT = 0;
    if (tgt) {
      const hp = wpos(head, _p[9]), dx = tgt.x - hp.x, dy = tgt.y - hp.y, dz = tgt.z - hp.z, hl = Math.hypot(dx, dz);
      const dyaw = wrapA(Math.atan2(-dx, -dz) - C.player.c.g.rotation.y);
      if (Math.abs(dyaw) < 2.0 && hl > 0.3) { yawT = clamp(dyaw, -1.1, 1.1); pitchT = clamp(Math.atan2(dy, hl), -0.5, 0.45); wT = 1; }
    }
    L.w = damp(L.w, wT, 3, dt); L.yaw = damp(L.yaw, yawT, 5, dt); L.pitch = damp(L.pitch, pitchT, 5, dt);
    if (L.w < 0.01) return;
    const y = L.yaw * L.w, p = L.pitch * L.w;
    const Y = _p[10].set(0, 1, 0);
    worldDelta(neck, _q[7].setFromAxisAngle(Y, y * 0.4).multiply(_q[8].setFromAxisAngle(R, p * 0.4)));
    const R2 = _p[11].copy(R).applyAxisAngle(Y, y * 0.4);
    worldDelta(head, _q[7].setFromAxisAngle(Y, y * 0.6).multiply(_q[8].setFromAxisAngle(R2, p * 0.6)));
  }
  // hands: on the ledge edge while climbing, on the prop while pushing
  function armsUpdate(dt, F, R) {
    if (!SUB.arms) return;
    const P = C.player, CL = C.CLIMB, Aa = B.arms, b = B.bones;
    if (!b.upperarm_l || !b.upperarm_r) return;
    let mode = null, wT = 0;
    if (CL && CL.t >= 0) {
      if (Aa.lastClimb < 0 || !Aa.edge) {   // climb just started: find the edge between the start and the top
        const dx = CL.to.x - CL.from.x, dz = CL.to.z - CL.from.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
        let dist = 0.5; if (C.PH.ok) { const h = C.PH.P.raycast({ x: CL.from.x, y: CL.from.y + 0.6, z: CL.from.z }, { x: ux, y: 0, z: uz }, 1.6, { groups: C.PH.P.groups.STATIC }); if (h) dist = h.distance; }
        Aa.edge = { x: CL.from.x + ux * (dist + 0.06), y: CL.to.y + 0.03, z: CL.from.z + uz * (dist + 0.06), ux, uz };
      }
      const k = CL.t / CL.dur; mode = 'climb'; wT = smooth(0.0, 0.12, k) * (1 - smooth(0.5, 0.78, k));
    } else Aa.edge = null;
    Aa.lastClimb = CL ? CL.t : -1;
    const push = pushState(F);
    if (!mode && push) { mode = 'push'; wT = push.w; }
    if (!mode && RK.armW > 0.01) { mode = 'rock'; wT = RK.armW; }
    Aa.w = damp(Aa.w, wT, mode === 'climb' ? 30 : mode === 'rock' ? 14 : 8, dt);
    if (mode) Aa.mode = mode; else if (Aa.w < 0.01) Aa.mode = null;
    if (Aa.w < 0.01 || !Aa.mode) return;
    for (const s of ['l', 'r']) {
      const hand = b['hand_' + s], cur = wpos(hand, _p[12]), tgt = _p[13];
      const pv = wpos(b.pelvis || b.spine_01, _p[14]), side = (cur.x - pv.x) * R.x + (cur.z - pv.z) * R.z >= 0 ? 1 : -1;   // which side of the body this hand is on
      if (Aa.mode === 'climb' && Aa.edge) { const e = Aa.edge, rx = -e.uz, rz = e.ux; tgt.set(e.x + rx * 0.24 * side, e.y, e.z + rz * 0.24 * side); }
      else if (Aa.mode === 'rock') tgt.copy(RK.hands[side]);
      else if (Aa.mode === 'push' && Aa.push) { const pp = Aa.push, hh = pp.hands && pp.hands[side]; if (hh) tgt.copy(hh); else tgt.set(pp.x + R.x * 0.22 * side, pp.y, pp.z + R.z * 0.22 * side); }
      else continue;
      if (Aa.mode === 'climb') { const sp = wpos(b['upperarm_' + s], _p[14]); if (sp.distanceTo(tgt) > 0.95) continue; }   // out of reach early in the clip: let the clip lead
      tgt.lerp(cur, 1 - Aa.w);
      if (!Aa[s]) Aa[s] = new V3();
      solve2(b['upperarm_' + s], b['lowerarm_' + s], hand, tgt, _p[20].set(0, -1, 0), Aa[s]);
    }
  }
  const PUSH = { list: [], t: 0, prop: null, speed: 0 };
  // INTERACT: each palm on the DRAWN prop (not the physics hull): a horizontal ray at the hand's spot onto the prop's own
  // mesh; a prop lower than the hands gets the palms on its top, just behind the near edge. Wrist = surface + palm (3.5 cm)
  function pushHands(e, pp, F) {
    const I = window.INTERACT; if (!I || !K.passport) return null;
    const out = {}, Rx = -F.z, Rz = F.x;
    for (const side of [1, -1]) {
      const x = pp.x + Rx * 0.22 * side, z = pp.z + Rz * 0.22 * side;
      let h = I.castOn(e, x - F.x * 0.4, pp.y, z - F.z * 0.4, F.x, 0, F.z, 1.0), n = h && h.normal;
      if (!h) { h = I.castOn(e, x + F.x * 0.08, pp.y + 0.5, z + F.z * 0.08, 0, -1, 0, 0.9); n = h && h.normal; }   // low prop: onto its top
      if (!h) return null;
      out[side] = new V3(h.point.x + n.x * 0.035, h.point.y + n.y * 0.035, h.point.z + n.z * 0.035);
    }
    return out;
  }
  function pushState(F) {
    const P = C.player, PH = C.PH; if (!PH.ok || !C.Passport || C.G.riding || !P.onGround) { PUSH.prop = null; return null; }
    PUSH.t -= 1;
    if (PUSH.t <= 0) { PUSH.t = 20; PUSH.list = (C.Passport.byRole.pushable || []).filter((e) => e.debris && e.debris.mesh && e.alive); }
    const moving = C.keys && (C.keys.KeyW || C.keys.KeyA || C.keys.KeyS || C.keys.KeyD || C.keys.ArrowUp || C.keys.ArrowDown || C.keys.ArrowLeft || C.keys.ArrowRight);
    let best = null, bd = 1.8;
    for (const e of PUSH.list) { const m = e.debris.mesh.position, d = Math.hypot(m.x - P.x, m.z - P.z); if (d < bd) { bd = d; best = e; } }
    PUSH.prop = null; B.arms.push = null;
    if (!best || !moving) return null;
    let h = null; for (const hy of [0.95, 0.6, 0.35]) { h = PH.P.raycast({ x: P.x, y: P.y + hy, z: P.z }, { x: F.x, y: 0, z: F.z }, 1.05, { groups: PH.P.groups.PROP, debris: true }); if (h) break; }
    if (!h) return null;
    PUSH.prop = best; B.arms.push = { x: h.point.x - F.x * 0.04, y: clamp(h.point.y + 0.08, P.y + 0.45, P.y + 1.2), z: h.point.z - F.z * 0.04, col: h.collider };
    B.arms.push.hands = pushHands(best, B.arms.push, F);
    return { w: smooth(1.05, 0.5, h.distance) };
  }


    return { makeGait, bodyUpdate, PUSH, bind(o) { if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; if ("T3" in o) T3 = o.T3; if ("Q" in o) Q = o.Q; if ("footfall" in o) footfall = o.footfall; if ("stepsFromPose" in o) stepsFromPose = o.stepsFromPose; } };
  };
})();
