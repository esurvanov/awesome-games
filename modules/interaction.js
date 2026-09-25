/* Module "interaction" — how bodies meet the world (wave 2). See INTERACTION.md.
 *
 *  pilot   foot IK (two-bone, ground rays), pelvis offset, foot tilt to the ground normal, stride-matched playback,
 *          lean into turns/slopes, boots settle into loose snow, head look-at, hands on the ledge / on pushed props
 *  world   footsteps by surface (own WebAudio), landing puffs + stamp, brushing trees shakes them, prop push feel, slide
 *  ice     thin lake ice cracks under the pilot (growing segment mesh + sound), lower traction on sea ice
 *  animals stags: ground offset from the skinned pose, body aligned to the slope, gradual turning while fleeing,
 *          stride-matched run, hoof trails; fox: slope align, stride match, pounce into the snow at a find
 *  camera  step bob, landing dip — only when a sphere-cast says the offset stays out of solids
 *
 * Every subsystem is guarded: an exception disables that subsystem only (see SUB), never the module or the game.
 */
(function () {
  let C = null, T3 = null;
  const SUB = { body: true, look: true, arms: true, steps: true, world: true, ice: true, stags: true, fox: true, camera: true };
  const ERR = {};
  const K = {                       // knobs (documented in INTERACTION.md)
    ik: true, ikRay: 1.7, pelvisMin: -0.5, pelvisMax: 0.12, tiltMax: 0.6, stride: true, strideMin: 0.55, strideMax: 1.9,
    lean: 1, look: true, lookRange: 6, snowFloat: 0.3, bob: 0.018, dip: 1, iceAccel: 0.3, iceDecel: 0.14, stepVol: 1,
    stagTurn: 2.4, stagTop: 9.5, stagAlign: 0.85, foxAlign: 0.8, trees: true,
  };
  const STATS = { ms: 0, msMax: 0, frames: 0, steps: 0, cracks: 0, shakes: 0, lands: 0, pounces: 0, trails: 0 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function guard(name, fn) {
    if (!SUB[name]) return;
    try { fn(); } catch (e) { SUB[name] = false; ERR[name] = String(e && e.stack || e); console.warn('[interaction] ' + name + ' disabled:', e); }
  }

  /* ------------------------------------------------------------------ math scratch */
  let V3, Q, _p = [], _q = [];
  const up = () => _p[15].set(0, 1, 0);
  function setupMath() {
    V3 = T3.Vector3; Q = T3.Quaternion;
    for (let i = 0; i < 24; i++) _p.push(new V3());
    for (let i = 0; i < 12; i++) _q.push(new Q());
  }
  const _ts = () => _p[23];
  function wpos(o, out) { return out.setFromMatrixPosition(o.matrixWorld); }
  function wquat(o, out) { o.matrixWorld.decompose(_p[22], out, _ts()); return out; }
  // rotate a bone by a world-space delta: local = parentWorld⁻¹ · dq · world
  function worldDelta(bone, dq) {
    const pq = wquat(bone.parent, _q[10]), wq = wquat(bone, _q[11]);
    wq.premultiply(dq); pq.invert(); bone.quaternion.copy(pq.multiply(wq));
    bone.updateMatrixWorld(true);
  }
  function setWorldQuat(bone, wq) { const pq = wquat(bone.parent, _q[10]).invert(); bone.quaternion.copy(pq.multiply(wq)); bone.updateMatrixWorld(true); }
  // analytic two-bone IK: a (hip/shoulder) → b (knee/elbow) → c (ankle/wrist) reaches T; the bend plane of the pose is kept
  function solve2(a, b, c, T, hint, lastN) {
    const pa = wpos(a, _p[0]), pb = wpos(b, _p[1]), pc = wpos(c, _p[2]);
    const la = pa.distanceTo(pb), lb = pb.distanceTo(pc);
    const u = _p[3].subVectors(pa, pb), v = _p[4].subVectors(pc, pb);
    const th = u.angleTo(v), n = _p[5].crossVectors(u, v);
    if (n.lengthSq() < 1e-10) n.copy(lastN && lastN.lengthSq() > 0 ? lastN : hint); n.normalize(); if (lastN) lastN.copy(n);
    const d = clamp(_p[6].subVectors(T, pa).length(), Math.abs(la - lb) + 1e-3, (la + lb) * 0.9995);
    const th2 = Math.acos(clamp((la * la + lb * lb - d * d) / (2 * la * lb), -1, 1));
    worldDelta(b, _q[0].setFromAxisAngle(n, th2 - th));
    wpos(c, pc);
    const from = _p[7].subVectors(pc, pa).normalize(), to = _p[8].subVectors(T, pa).normalize();
    worldDelta(a, _q[1].setFromUnitVectors(from, to));
  }

  /* ------------------------------------------------------------------ ground + surface */
  function hitDown(x, y, z, len) {
    const PH = C.PH;
    if (PH.ok) {
      const h = PH.P.raycast({ x, y, z }, { x: 0, y: -1, z: 0 }, len, { groups: PH.P.groups.STATIC });
      if (h) return { y: h.point.y, nx: h.normal ? h.normal.x : 0, ny: h.normal ? h.normal.y : 1, nz: h.normal ? h.normal.z : 0, tag: h.tag || null };
    }
    const gy = C.groundH(x, z); if (gy > y || gy < y - len) return null;
    const e = 0.6, hx = C.groundH(x + e, z) - C.groundH(x - e, z), hz = C.groundH(x, z + e) - C.groundH(x, z - e), l = Math.hypot(hx, 2 * e, hz);
    return { y: gy, nx: -hx / l, ny: 2 * e / l, nz: -hz / l, tag: { kind: 'terrain' } };
  }
  const SURF_NAMES = [
    [/kestrel|ship|station|snowcat|barrel|debris|tool_crate|struct_|vehicle_|rover|generator|propane|mast|pole|radome|dish|hab/i, 'metal'],
    [/pier|crate|sledge|tent|wood|plank|deck/i, 'wood'],
    [/^ice|pressure_ridge|floe/i, 'ice'],
    [/boulder|rock|arch|colonnade|ruin|cairn|echo|spire|altar|fire|stone|heart|platform|pillar|crystal/i, 'rock'],
  ];
  function normSurf(r) {
    if (!r) return null; const s = String(typeof r === 'string' ? r : (r.type || r.kind || r.surface || r.name || '')).toLowerCase();
    if (/ice/.test(s)) return 'ice'; if (/metal|steel|hull/.test(s)) return 'metal'; if (/wood|plank/.test(s)) return 'wood';
    if (/rock|stone|gravel/.test(s)) return 'rock'; if (/snow|powder|drift|crust/.test(s)) return 'snow'; return null;
  }
  const inLake = (x, z) => { const L = C.POI.lake; return L.h !== undefined && (x - L.x) ** 2 + (z - L.z) ** 2 < 48.5 * 48.5; };
  function surfaceAt(x, y, z, hit) {
    const tag = hit && hit.tag;
    if (tag && tag.kind === 'solid' && tag.name) { for (const [re, s] of SURF_NAMES) if (re.test(tag.name)) return s; return 'rock'; }
    if (tag && tag.kind === 'prop') return 'metal';
    if (inLake(x, z) && Math.abs(y - C.POI.lake.h) < 0.5) return 'ice';
    if (C.getH(x, z) <= 0.08) return 'ice';
    if (typeof C.surfaceAt === 'function') { try { const s = normSurf(C.surfaceAt(x, z, y)); if (s) return s; } catch (e) { /* their bug, our fallback */ } }
    if (hit && hit.ny < 0.74) return 'rock';
    return 'snow';
  }
  function snowDepth(x, z) {
    if (typeof C.snowDepthAt === 'function') { try { const d = +C.snowDepthAt(x, z); return isFinite(d) ? Math.max(0, d) : 0; } catch (e) { return 0; } }
    return 0;
  }
  // terrain deformation (terrain module: ctx.snowStamp({x, z, dx, dz, len, wid, type, str})). The terrain module tracks
  // the pilot, fox and stags itself; we only stamp events it cannot know about (landing, the fox's dive).
  const hasStamp = () => typeof C.snowStamp === 'function';
  function stamp(x, z, len, wid, type, str, yaw) {
    if (!hasStamp()) return false;
    try { C.snowStamp({ x, z, dx: Math.sin(yaw || 0), dz: Math.cos(yaw || 0), len, wid, type, str }); STATS.trails++; return true; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ audio (own context; the game's Sound is closed) */
  const AU = { ac: null, out: null, nb: null, scrape: null, scrapeG: null, scrapeF: null };
  function auInit() {
    try {
      if (AU.ac) { if (AU.ac.state === 'suspended') AU.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = AU.ac = new AC();
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.connect(ac.destination);
      AU.out = ac.createGain(); AU.out.gain.value = 0.55; AU.out.connect(comp);
      AU.nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = AU.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ac.createBufferSource(); s.buffer = AU.nb; s.loop = true;                 // scrape / slide loop
      AU.scrapeF = ac.createBiquadFilter(); AU.scrapeF.type = 'bandpass'; AU.scrapeF.frequency.value = 700; AU.scrapeF.Q.value = 0.8;
      AU.scrapeG = ac.createGain(); AU.scrapeG.gain.value = 0; s.connect(AU.scrapeF); AU.scrapeF.connect(AU.scrapeG); AU.scrapeG.connect(AU.out); s.start();
    } catch (e) { AU.ac = null; }
  }
  const auOK = () => AU.ac && AU.ac.state === 'running' && !(C.Sound && C.Sound.muted);
  function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  function nz(t, dur, peak, type, f, q = 0.8, f2) {
    const ac = AU.ac, s = ac.createBufferSource(); s.buffer = AU.nb;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); env(g, t, 0.002, peak, dur); s.connect(fl); fl.connect(g); g.connect(AU.out); s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
  }
  function tone(type, f, t, dur, peak, f2, a = 0.002) {
    const ac = AU.ac, o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); env(g, t, a, peak, dur); o.connect(g); g.connect(AU.out); o.start(t); o.stop(t + dur + 0.05);
  }
  const SFX = {
    snow(k) { const t = AU.ac.currentTime; nz(t, 0.13, 0.05 * k, 'lowpass', rnd(900, 1300), 0.7); for (let i = 0; i < 4; i++) nz(t + rnd(0.005, 0.07), 0.012, 0.03 * k, 'bandpass', rnd(1800, 4200), 2); },
    ice(k) { const t = AU.ac.currentTime; nz(t, 0.012, 0.07 * k, 'highpass', 4000, 1); tone('sine', rnd(2400, 3400), t, 0.07, 0.012 * k); nz(t, 0.05, 0.03 * k, 'lowpass', 500, 1); },
    rock(k) { const t = AU.ac.currentTime; nz(t, 0.05, 0.06 * k, 'bandpass', rnd(1000, 1500), 1.2); tone('sine', 130, t, 0.06, 0.05 * k, 70); nz(t + 0.01, 0.02, 0.02 * k, 'highpass', 5000); },
    metal(k) { const t = AU.ac.currentTime, b = rnd(380, 460); nz(t, 0.02, 0.05 * k, 'highpass', 3000); [1, 2.76, 4.07].forEach((m, i) => tone('triangle', b * m, t, 0.22 - i * 0.05, 0.022 * k / (i + 1))); tone('sine', 95, t, 0.1, 0.05 * k, 60); },
    wood(k) { const t = AU.ac.currentTime; nz(t, 0.07, 0.06 * k, 'bandpass', rnd(420, 560), 2.2); tone('sine', rnd(170, 200), t, 0.09, 0.07 * k, 120); tone('sine', 410, t + 0.004, 0.05, 0.015 * k); },
    land(k, surf) { const t = AU.ac.currentTime; tone('sine', 95, t, 0.25, 0.25 * k, 38); (SFX[surf] || SFX.snow)(Math.min(1.6, 1 + k)); nz(t, 0.25, 0.08 * k, 'lowpass', 700, 0.7, 150); },
    brush(k) { const t = AU.ac.currentTime; nz(t, 0.45, 0.05 * k, 'bandpass', 1400, 0.6, 500); nz(t + 0.12, 0.5, 0.03 * k, 'lowpass', 900, 0.7, 200); },
    crack(k) {                                        // thin lake ice: clicks, the "singing" pew, a low boom when it's big
      const t = AU.ac.currentTime; for (let i = 0; i < 3 + k * 4; i++) nz(t + rnd(0, 0.12 + 0.2 * k), 0.015, 0.05 + 0.05 * k, 'highpass', rnd(2500, 5000), 1.5);
      tone('sine', rnd(2600, 3600), t + 0.02, 0.35 + 0.3 * k, 0.02 + 0.03 * k, rnd(400, 700), 0.004);
      if (k > 0.5) { tone('sine', 70, t, 0.9, 0.12 * k, 35, 0.01); nz(t, 0.6, 0.05 * k, 'lowpass', 300, 0.8, 80); }
    },
    pounce() { const t = AU.ac.currentTime; nz(t, 0.25, 0.08, 'lowpass', 1200, 0.7, 300); },
  };
  function sfx(name, ...a) { if (!auOK()) return; try { SFX[name](...a); } catch (e) { /* audio is decoration */ } }

  /* ------------------------------------------------------------------ pilot body */
  const B = {
    ready: false, A: null, root: null, wrap: null, bones: {}, saved: new Map(), prevMixT: -1, wLegs: 0, pelvis: 0, sink: 0,
    stride: {}, hRest: 0.1, hRestBall: 0.015, legs: [], lean: { roll: 0, pitch: 0, prevFace: null, prevHs: 0 }, look: { yaw: 0, pitch: 0, w: 0, target: null },
    arms: { w: 0, mode: null, L: null, R: null, lastClimb: -1, edge: null, n: null, push: null },
    err: { heel: [0, 0], toe: [0, 0] }, lastSurf: 'snow', slideYaw: null,
  };
  const TOUCH = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'spine_01', 'spine_02', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'];
  // horizontal speed of the planted contact relative to the body, at timeScale 1. limbs: [[heelBone, toeBone?], ...];
  // per frame and limb the contact is whichever bone sits closest to its own lowest height (heel strike → toe off)
  function strideSpeed(root, clip, limbs, refName) {
    const clone = T3.SkeletonUtils.clone(root), mx = new T3.AnimationMixer(clone), act = mx.clipAction(clip); act.play();
    const ref = clone.getObjectByName(refName), lb = limbs.map((l) => l.map((n) => clone.getObjectByName(n)).filter(Boolean));
    if (!ref || lb.some((l) => !l.length)) return 0;
    const N = 60, dt = clip.duration / N, rows = [];
    for (let i = 0; i <= N; i++) {
      mx.setTime(i * dt); clone.updateMatrixWorld(true);
      const r = new V3().setFromMatrixPosition(ref.matrixWorld);
      rows.push(lb.map((l) => l.map((b) => { const p = new V3().setFromMatrixPosition(b.matrixWorld); return [p.x - r.x, p.y, p.z - r.z]; })));
    }
    const mins = lb.map((l, k) => l.map((_, j) => Math.min(...rows.map((row) => row[k][j][1]))));
    const span = Math.max(...lb.map((l, k) => Math.max(...rows.map((row) => row[k][0][1])) - mins[k][0]));
    const tol = Math.max(0.012, span * 0.08), v = [];
    for (let i = 1; i <= N; i++) for (let k = 0; k < lb.length; k++) {
      let j = 0, best = 1e9; for (let q = 0; q < lb[k].length; q++) { const h = rows[i][k][q][1] - mins[k][q]; if (h < best) { best = h; j = q; } }
      if (best > tol || rows[i - 1][k][j][1] - mins[k][j] > tol) continue;
      const a0 = rows[i - 1][k][j], b0 = rows[i][k][j]; v.push(Math.hypot(b0[0] - a0[0], b0[2] - a0[2]) / dt);
    }
    act.stop(); mx.uncacheRoot(clone);
    v.sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0;
  }
  function bodySetup() {
    const A = C.AV.player; if (!A || !A.mixer) return false;
    const root = A.mixer.getRoot(), wrap = root.parent; if (!wrap) return false;
    B.A = A; B.root = root; B.wrap = wrap;
    for (const n of TOUCH.concat(['pelvis', 'ball_l', 'ball_r'])) { const b = root.getObjectByName(n); if (!b) { if (/thigh|calf|foot/.test(n)) return false; } else B.bones[n] = b; }
    B.legs = ['l', 'r'].map((s) => ({ s, thigh: B.bones['thigh_' + s], calf: B.bones['calf_' + s], foot: B.bones['foot_' + s], ball: B.bones['ball_' + s], n: new V3(), anim: new V3(), ballAnim: new V3(),
      wq: new Q(), g: { y: 0, nx: 0, ny: 1, nz: 0, tag: null }, gb: 0, h: 0, hPrev: 0, planted: true, up: 0, tgt: new V3() }));
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
    restoreBones();
    const play = C.mode === 'play' || C.mode === 'menu';
    const climbing = C.CLIMB && C.CLIMB.t >= 0, riding = G.riding, dead = G.deadT > 0;
    const grounded = play && !riding && !dead && !climbing && (P.onGround || C.mode === 'menu');
    B.wLegs = damp(B.wLegs, grounded && K.ik ? 1 : 0, grounded ? 10 : 18, dt);
    B.wrap.position.y = 0; B.wrap.position.x = 0; B.wrap.position.z = 0;
    c.g.updateMatrixWorld(true);
    const face = c.g.rotation.y, F = _p[16].set(-Math.sin(face), 0, -Math.cos(face)), R = _p[17].set(Math.cos(face), 0, -Math.sin(face));
    const hs = Math.hypot(P.vx, P.vz);
    // ---- ground under each foot (animation pose, no offsets)
    let minD = 1e9, sinkT = 0;
    for (const L of B.legs) {
      wpos(L.foot, L.anim); if (L.ball) wpos(L.ball, L.ballAnim); wquat(L.foot, L.wq);
      L.hPrev = L.h; L.h = L.anim.y - P.y;
      L.cPrev = L.c; L.c = Math.min(L.h - B.hRest, L.ball ? L.ballAnim.y - P.y - B.hRestBall : 1);   // contact: heel or toe down
      const h = riding ? null : hitDown(L.anim.x, P.y + 0.75, L.anim.z, K.ikRay);
      if (h) { L.g = h; } else { L.g = { y: P.y - 0.02, nx: 0, ny: 1, nz: 0, tag: null }; }
      const ny = clamp(L.g.ny, 0.6, 1);
      // loose snow (terrain module) lies above the physics ground: a boot compresses it and rests K.snowFloat of the way up
      L.snow = !riding && L.g.tag && L.g.tag.kind === 'terrain' ? Math.min(snowDepth(L.anim.x, L.anim.z), 0.6) * K.snowFloat : 0;
      L.tgt.set(L.anim.x, L.g.y + L.snow + Math.max(L.h, 0) / ny, L.anim.z);
      minD = Math.min(minD, L.tgt.y - L.anim.y);
    }
    B.sink = 0;   // snow sink is the snow float above (terrain draws loose snow over the hard ground)
    // ---- pelvis offset: the lower foot must reach its ground; the other bends its knee
    const pel = grounded ? clamp(minD - B.sink, K.pelvisMin, K.pelvisMax) : 0;
    B.pelvis = damp(B.pelvis, pel * B.wLegs, 16, dt);
    // ---- lean into turns / slopes / speed (spine), plus slide stance
    leanUpdate(dt, F, R, hs, grounded);
    B.wrap.position.y = B.pelvis;
    if (P.sliding && !riding) {   // face down the slope while sliding
      const L0 = B.legs[0].g; const dl = Math.hypot(L0.nx, L0.nz);
      if (dl > 0.2) { const want = Math.atan2(-L0.nx, -L0.nz); B.slideYaw = B.slideYaw === null ? face : B.slideYaw + wrapA(want - B.slideYaw) * Math.min(1, dt * 6); c.g.rotation.y = B.slideYaw; }
    } else B.slideYaw = null;
    c.g.updateMatrixWorld(true);
    // ---- legs
    if (B.wLegs > 0.001) for (const L of B.legs) {
      const tgt = _p[18].copy(L.anim); tgt.y += B.pelvis;
      tgt.lerp(_p[19].set(L.tgt.x, L.tgt.y - B.sink, L.tgt.z), B.wLegs);
      solve2(L.thigh, L.calf, L.foot, tgt, R, L.n);
      // foot sole to the ground normal while planted (swing keeps the clip's foot)
      const plant = (1 - smooth(0.04, 0.2, L.c)) * B.wLegs;
      if (plant > 0.01) {
        const n = _p[20].set(L.g.nx, L.g.ny, L.g.nz); if (n.y < Math.cos(K.tiltMax)) { n.y = 0; n.setLength(Math.sin(K.tiltMax)); n.y = Math.cos(K.tiltMax); } n.normalize();
        const tilt = _q[2].setFromUnitVectors(up(), n); _q[3].identity().slerp(tilt, plant);
        setWorldQuat(L.foot, _q[4].copy(L.wq).premultiply(_q[3]));
      }
    }
    lookUpdate(dt, F, R);
    armsUpdate(dt, F, R);
    markBones();
    stepsFromPose(dt, grounded, hs);
  }
  function leanUpdate(dt, F, R, hs, grounded) {
    const P = C.player, L = B.lean, sp = B.bones.spine_01; if (!sp) return;
    const face = P.face; if (L.prevFace === null) L.prevFace = face;
    const yawRate = wrapA(face - L.prevFace) / Math.max(dt, 1e-3); L.prevFace = face;
    const acc = (hs - L.prevHs) / Math.max(dt, 1e-3); L.prevHs = hs;
    const g0 = B.legs[0].g, g1 = B.legs[1].g, slope = grounded ? -(g0.nx + g1.nx) * 0.5 * F.x - (g0.nz + g1.nz) * 0.5 * F.z : 0;   // >0 = uphill ahead
    const push = B.arms.mode === 'push' ? B.arms.w : 0;
    const rollT = grounded ? clamp(-yawRate * hs * 0.018, -0.28, 0.28) : 0;
    const pitchT = grounded ? clamp(-(hs / 11) * 0.1 - clamp(acc, -20, 20) * 0.004 - slope * 0.45 - push * 0.3, -0.45, 0.2) : 0;
    L.roll = damp(L.roll, rollT * K.lean, 6, dt); L.pitch = damp(L.pitch, pitchT * K.lean, 5, dt);
    if (Math.abs(L.roll) + Math.abs(L.pitch) < 1e-4) return;
    const q = _q[5].setFromAxisAngle(F, L.roll).multiply(_q[6].setFromAxisAngle(R, L.pitch));
    worldDelta(sp, q);
  }
  function lookTarget() {
    const P = C.player, out = _p[21];
    if (C.G.riding || C.CLIMB && C.CLIMB.t >= 0 || P.aimT > 0) return null;
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
    Aa.w = damp(Aa.w, wT, mode === 'climb' ? 30 : 8, dt);
    if (mode) Aa.mode = mode; else if (Aa.w < 0.01) Aa.mode = null;
    if (Aa.w < 0.01 || !Aa.mode) return;
    for (const s of ['l', 'r']) {
      const hand = b['hand_' + s], cur = wpos(hand, _p[12]), tgt = _p[13];
      const pv = wpos(b.pelvis || b.spine_01, _p[14]), side = (cur.x - pv.x) * R.x + (cur.z - pv.z) * R.z >= 0 ? 1 : -1;   // which side of the body this hand is on
      if (Aa.mode === 'climb' && Aa.edge) { const e = Aa.edge, rx = -e.uz, rz = e.ux; tgt.set(e.x + rx * 0.24 * side, e.y, e.z + rz * 0.24 * side); }
      else if (Aa.mode === 'push' && Aa.push) { const pp = Aa.push; tgt.set(pp.x + R.x * 0.22 * side, pp.y, pp.z + R.z * 0.22 * side); }
      else continue;
      if (Aa.mode === 'climb') { const sp = wpos(b['upperarm_' + s], _p[14]); if (sp.distanceTo(tgt) > 0.95) continue; }   // out of reach early in the clip: let the clip lead
      tgt.lerp(cur, 1 - Aa.w);
      if (!Aa[s]) Aa[s] = new V3();
      solve2(b['upperarm_' + s], b['lowerarm_' + s], hand, tgt, _p[20].set(0, -1, 0), Aa[s]);
    }
  }
  const PUSH = { list: [], t: 0, prop: null, speed: 0 };
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
    return { w: smooth(1.05, 0.5, h.distance) };
  }

  /* ------------------------------------------------------------------ footsteps from the pose */
  function stepsFromPose(dt, grounded, hs) {
    if (!SUB.steps) return;
    const P = C.player;
    for (const L of B.legs) {
      const rel = L.c;
      if (rel > 0.07) L.up = 1;
      if (L.up && rel < 0.03 && L.c <= (L.cPrev === undefined ? 1 : L.cPrev) + 1e-4 && grounded && hs > 0.8) {
        L.up = 0; footfall(L, hs);
      }
    }
    if (!grounded) for (const L of B.legs) L.up = 1;
  }
  function footfall(L, hs) {
    const P = C.player, x = L.anim.x, z = L.anim.z, y = L.g.y, surf = surfaceAt(x, y, z, L.g);
    B.lastSurf = surf; STATS.steps++;
    const k = clamp(0.45 + hs / 11, 0.4, 1.3) * K.stepVol;
    sfx(surf, k);
    const col = surf === 'snow' ? 0xdce6f6 : surf === 'ice' ? 0xcfeaf6 : surf === 'rock' ? 0x8f96a4 : 0x9aa4b4;
    if (surf === 'snow' || surf === 'ice') for (let i = 0; i < (hs > 8 ? 4 : 2); i++) C.emit(x, y + 0.05, z, rnd(-0.6, 0.6) + P.vx * 0.05, rnd(0.4, 1.1), rnd(-0.6, 0.6) + P.vz * 0.05, 0.45, col, 0.28, 3, 2.5);
    if (surf === 'ice' && inLake(x, z)) ICE.crackAt(x, z, 0.25 + hs / 16);
  }

  /* ------------------------------------------------------------------ world: landing, trees, benders, push, slide */
  const W = { wasGround: true, minVy: 0, air: 0, treeGrid: null, treeList: null, treeCd: new Map(), slide: 0 };
  const treeList = () => (window.VEG && VEG.trees && VEG.trees.length ? VEG.trees : C.FOREST && C.FOREST.list || []);
  function worldSetup() {
    const list = W.treeList = treeList();
    W.treeGrid = new Map();
    list.forEach((t, i) => { const k = Math.floor(t[0] / 8) * 4096 + Math.floor(t[2] / 8); if (!W.treeGrid.has(k)) W.treeGrid.set(k, []); W.treeGrid.get(k).push(i); });
  }
  function worldUpdate(dt) {
    const P = C.player, G = C.G; if (C.mode !== 'play') return;
    if (!W.treeGrid || W.treeList !== treeList() || W.treeN !== W.treeList.length) { worldSetup(); W.treeN = W.treeList.length; }
    const riding = G.riding, hs = riding ? Math.abs(C.sk.speed || 0) : Math.hypot(P.vx, P.vz);
    const px = riding ? C.sk.x : P.x, pz = riding ? C.sk.z : P.z;
    // ---- landing: puff ring + thud + camera dip
    if (!riding && C.CLIMB.t < 0) {
      if (!P.onGround) { W.air += dt; W.minVy = Math.min(W.minVy, P.vy); }
      else if (!W.wasGround && W.air > 0.12) {
        const v = -W.minVy; if (v > 3) land(v);
      }
      if (P.onGround) { W.air = 0; W.minVy = 0; }
      W.wasGround = P.onGround;
    }
    // ---- trees: brushing through the lower branches shakes snow off
    if (K.trees && hs > 1.4 && W.treeList.length) {
      const i0 = Math.floor(px / 8), j0 = Math.floor(pz / 8), now = C.T;
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        const a = W.treeGrid.get(i * 4096 + j); if (!a) continue;
        for (const ti of a) {
          const t = W.treeList[ti], sc = t.s || t[3] || 1, d = Math.hypot(t[0] - px, t[2] - pz), r = Math.min(2.4, 1.0 + 0.5 * sc) + (riding ? 0.8 : 0);
          if (d > r) continue;
          const last = W.treeCd.get(ti) || -9; if (now - last < 1.6) continue; W.treeCd.set(ti, now);
          shake(ti, t, clamp(hs / 9, 0.3, 1.2), (t[0] - px) / (d || 1), (t[2] - pz) / (d || 1));
        }
      }
    }
    // ---- pushing props: extra shove + scrape sound, spray at the base
    let scrape = 0;
    if (PUSH.prop && B.arms.push && C.PH.ok) {
      const e = PUSH.prop, F = _p[16], mass = e.opts && e.opts.mass || 20;
      try { C.PH.P.applyImpulseAt(B.arms.push.col, B.arms.push, { x: F.x * mass * 1.6 * dt, y: 0, z: F.z * mass * 1.6 * dt }); } catch (err) { /* body asleep / removed */ }
      const lv = e.debris.body && e.debris.body.linvel ? e.debris.body.linvel() : null, sp = lv ? Math.hypot(lv.x, lv.z) : 0;
      scrape = clamp(sp / 2.5, 0, 1);
      if (sp > 0.4 && Math.random() < dt * 20) { const m = e.debris.mesh.position; C.emit(m.x + rnd(-0.4, 0.4), C.groundH(m.x, m.z) + 0.05, m.z + rnd(-0.4, 0.4), rnd(-0.5, 0.5), rnd(0.3, 0.9), rnd(-0.5, 0.5), 0.5, 0xdce6f6, 0.3, 3, 2); }
    }
    // ---- slide: spray + hiss
    if (P.sliding && !riding) { W.slide = damp(W.slide, 1, 6, dt); if (Math.random() < dt * 30) C.emit(P.x + rnd(-0.3, 0.3), P.y + 0.08, P.z + rnd(-0.3, 0.3), rnd(-1.2, 1.2) + P.vx * 0.3, rnd(0.6, 1.8), rnd(-1.2, 1.2) + P.vz * 0.3, 0.7, 0xdce6f6, 0.45, 2, 1.5); }
    else W.slide = damp(W.slide, 0, 8, dt);
    if (auOK() && AU.scrapeG) {
      const g = Math.max(scrape * 0.07, W.slide * 0.09 * clamp(Math.hypot(P.vx, P.vy, P.vz) / 8, 0.3, 1));
      AU.scrapeG.gain.setTargetAtTime(g, AU.ac.currentTime, 0.06); AU.scrapeF.frequency.setTargetAtTime(W.slide > scrape ? 1100 : 450, AU.ac.currentTime, 0.1);
    } else if (AU.scrapeG && AU.ac) AU.scrapeG.gain.setTargetAtTime(0, AU.ac.currentTime, 0.05);
  }
  function land(v) {
    const P = C.player, h = hitDown(P.x, P.y + 0.5, P.z, 1.5), surf = surfaceAt(P.x, P.y, P.z, h); STATS.lands++;
    const k = clamp((v - 3) / 12, 0.1, 1);
    sfx('land', k, surf);
    const col = surf === 'snow' ? 0xdce6f6 : surf === 'ice' ? 0xcfeaf6 : 0x9aa2b0, n = Math.round(8 + k * 22);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + rnd(-0.2, 0.2), s = rnd(1.5, 3.5) * (0.6 + k); C.emit(P.x + Math.sin(a) * 0.3, P.y + 0.06, P.z + Math.cos(a) * 0.3, Math.sin(a) * s, rnd(0.3, 1.2) * (0.5 + k), Math.cos(a) * s, rnd(0.5, 0.9), col, rnd(0.35, 0.6), 3.5, 2); }
    CAM.dipV -= (0.8 + v * 0.12) * K.dip;
    if (surf === 'ice' && inLake(P.x, P.z)) ICE.crackAt(P.x, P.z, 0.6 + k);
    if (surf === 'snow') stamp(P.x, P.z, 0.7, 0.6, 'blob', 0.5 + 0.5 * k, 0);
  }
  function shake(ti, t, s, dx, dz) {
    STATS.shakes++;
    if (typeof C.shakeTree === 'function') {   // vegetation: branch wobble + snow puff; false = that tree is still settling
      let r = false; try { r = C.shakeTree(t[0], t[2], s, dx, dz); } catch (e) { r = false; }
      if (r !== false) sfx('brush', clamp(s, 0.4, 1));
      return;
    }
    const sc = t.s || t[3] || 1, ty = t.y !== undefined ? t.y : t[1];   // fallback: a curtain of snow from the branches
    for (let i = 0; i < 26 * s; i++) { const a = rnd(0, 6.283), r = rnd(0.4, 1.6) * sc; C.emit(t[0] + Math.sin(a) * r, ty + rnd(1.2, 4.5) * sc, t[2] + Math.cos(a) * r, rnd(-0.3, 0.3), rnd(-0.5, 0.2), rnd(-0.3, 0.3), rnd(1.2, 2.2), 0xe8f0ff, rnd(0.25, 0.5), 1.2, 3); }
    sfx('brush', clamp(s, 0.4, 1));
  }

  /* ------------------------------------------------------------------ ice: lake cracks + sea-ice traction */
  const ICE = {
    geo: null, mesh: null, pos: null, col: null, n: 0, MAX: 6000, branches: [], dirty: 0, standT: 0, lastX: 1e9, lastZ: 1e9, base: null, trac: 1, y: 0,
    // cracks are thin quads lying on the ice (sharp at any distance, no texture uploads); a ring buffer of segments
    setup() {
      const L = C.POI.lake; if (L.h === undefined) return false;
      const M = this.MAX, g = this.geo = new T3.BufferGeometry();
      this.pos = new Float32Array(M * 12); this.col = new Float32Array(M * 12);
      const nrm = new Float32Array(M * 12); for (let i = 0; i < M * 4; i++) nrm[i * 3 + 1] = 1;
      const idx = new Uint32Array(M * 6); for (let i = 0; i < M; i++) { const v = i * 4, o = i * 6; idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], o); }
      g.setAttribute('position', new T3.BufferAttribute(this.pos, 3).setUsage(T3.DynamicDrawUsage));
      g.setAttribute('color', new T3.BufferAttribute(this.col, 3).setUsage(T3.DynamicDrawUsage));
      g.setAttribute('normal', new T3.BufferAttribute(nrm, 3)); g.setIndex(new T3.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
      g.boundingSphere = new T3.Sphere(new T3.Vector3(L.x, L.h, L.z), 60);
      const mat = new T3.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x2c6a8c, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0,
        transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const m = this.mesh = new T3.Mesh(g, mat); m.renderOrder = 2; m.userData.noCollide = true; m.name = 'lake_cracks'; m.frustumCulled = false; m.receiveShadow = true;
      this.y = L.h + 0.042; C.scene.add(m); return true;
    },
    seg(x0, z0, x1, z1, w, bright) {
      const i = this.n % this.MAX, dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, px = -dz / l * w * 0.5, pz = dx / l * w * 0.5, y = this.y, P = this.pos, o = i * 12;
      P[o] = x0 + px; P[o + 1] = y; P[o + 2] = z0 + pz; P[o + 3] = x0 - px; P[o + 4] = y; P[o + 5] = z0 - pz;
      P[o + 6] = x1 + px; P[o + 7] = y; P[o + 8] = z1 + pz; P[o + 9] = x1 - px; P[o + 10] = y; P[o + 11] = z1 - pz;
      const c = C.lin(bright), cb = C.lin(Math.min(1, bright * 1.06)); for (let k = 0; k < 4; k++) { this.col[o + k * 3] = c * 0.9; this.col[o + k * 3 + 1] = c * 0.97; this.col[o + k * 3 + 2] = cb; }
      this.n++; this.dirty++;
    },
    crackAt(x, z, k) {
      if (!this.mesh && !this.setup()) return;
      if (Math.hypot(x - this.lastX, z - this.lastZ) < 0.35 && k < 0.5) return;
      this.lastX = x; this.lastZ = z; STATS.cracks++;
      const n = 3 + Math.round(k * 4);
      for (let i = 0; i < n && this.branches.length < 300; i++) {
        const a = i / n * Math.PI * 2 + rnd(-0.4, 0.4);
        this.branches.push({ x, z, a, left: rnd(0.5, 1.5) * (0.6 + k * 1.8), w: rnd(0.016, 0.03) * (0.8 + k * 0.5), gen: 0, v: rnd(3, 7) });
      }
      for (let i = 0; i < 6; i++) { const a = rnd(0, 6.283), r0 = rnd(0.05, 0.15), r1 = r0 + rnd(0.08, 0.25) * (0.5 + k); this.seg(x + Math.cos(a) * r0, z + Math.sin(a) * r0, x + Math.cos(a) * r1, z + Math.sin(a) * r1, 0.012, 0.85); }
      sfx('crack', clamp(k, 0.2, 1));
    },
    grow(dt) {
      if (!this.branches.length) return;
      const keep = [];
      for (const b of this.branches) {
        let t = Math.min(b.left, b.v * dt); if (t <= 0) continue; b.left -= t;
        while (t > 0) {   // jagged: 6–12 cm pieces
          const st = Math.min(t, rnd(0.06, 0.12)); t -= st;
          const a = b.a + rnd(-0.45, 0.45), nx = b.x + Math.cos(a) * st, nz = b.z + Math.sin(a) * st;
          this.seg(b.x, b.z, nx, nz, b.w * (0.6 + 0.4 * Math.min(1, b.left + 0.2)), 0.8 + 0.2 / (1 + b.gen));
          b.x = nx; b.z = nz; b.a = a * 0.6 + b.a * 0.4;
        }
        if (b.gen < 2 && Math.random() < dt * 2.4) keep.push({ x: b.x, z: b.z, a: b.a + (Math.random() < 0.5 ? 1 : -1) * rnd(0.5, 1.1), left: b.left * rnd(0.4, 0.8) + 0.2, w: b.w * 0.65, gen: b.gen + 1, v: b.v * 0.8 });
        if (b.left > 0) keep.push(b);
      }
      this.branches = keep.slice(0, 300);
    },
    update(dt) {
      const P = C.player, G = C.G;
      // traction on sea ice (and a little on the lake)
      if (C.PH.ok && C.PH.ch && C.PH.ch.params) {
        const pr = C.PH.ch.params; if (!this.base) this.base = { a: pr.groundAccel, d: pr.groundDecel };
        const onSea = !G.riding && P.onGround && C.getH(P.x, P.z) <= 0.08 && P.y < 0.6;
        const onLake = !G.riding && P.onGround && inLake(P.x, P.z) && Math.abs(P.y - C.POI.lake.h) < 0.4;
        const t = onSea ? 1 : onLake ? 0.5 : 0; this.trac = damp(this.trac, t, 4, dt);
        pr.groundAccel = this.base.a * (1 - this.trac * (1 - K.iceAccel)); pr.groundDecel = this.base.d * (1 - this.trac * (1 - K.iceDecel));
        // standing still on thin ice: it keeps complaining
        if (onLake) { this.standT += dt; if (this.standT > 1.4 && Math.hypot(P.vx, P.vz) < 0.5) { this.standT = 0; this.lastX = 1e9; this.crackAt(P.x + rnd(-0.3, 0.3), P.z + rnd(-0.3, 0.3), 0.35); } }
        else this.standT = 0;
      }
      if (this.mesh) {
        this.grow(dt);
        if (this.dirty) {
          const g = this.geo, cnt = Math.min(this.n, this.MAX), first = (this.n - Math.min(this.dirty, this.MAX)) % this.MAX, len = Math.min(this.dirty, this.MAX);
          for (const at of [g.attributes.position, g.attributes.color]) {
            at.clearUpdateRanges();
            if (first + len <= this.MAX) at.addUpdateRange(first * 12, len * 12); else { at.addUpdateRange(first * 12, (this.MAX - first) * 12); at.addUpdateRange(0, (first + len - this.MAX) * 12); }
            at.needsUpdate = true;
          }
          g.setDrawRange(0, cnt * 6); this.dirty = 0;
        }
      }
    },
  };

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

    }
    ST.ready = true; return true;
  }
  const _qY = [];
  function stagUpdate(dt) {
    if (!ST.ready && !stagSetup()) return;
    if (!_qY.length) { _qY.push(new Q().setFromAxisAngle(new V3(0, 1, 0), Math.PI), new Q(), new Q(), new V3(1, 0, 0), new V3(0, 0, 1)); }
    const cam = C.camera.position, P = C.player;
    for (const s of C.STAGS) {
      const S = ST.per.get(s); if (!S) continue;
      // ---- flee turning: the game snaps the run direction; we turn it at a finite rate (the yaw follows)
      if (s.st === 'flee') {
        if (S.wroteX === null || Math.abs(s.fx - S.wroteX) > 1e-6 || Math.abs(s.fz - S.wroteZ) > 1e-6) { S.wantX = s.fx; S.wantZ = s.fz; if (S.dir === null) S.dir = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)); }
        const want = Math.atan2(S.wantX, S.wantZ), d = wrapA(want - S.dir), mx = K.stagTurn * dt;
        S.dir += clamp(d, -mx, mx); S.turn = clamp(d, -mx, mx) / Math.max(dt, 1e-3);
        // speed ramps up from a standstill (the game moves them at a flat 11 m/s × |f|)
        S.v = Math.min(K.stagTop, (S.v || 0) + dt * K.stagTop / 0.9);
        const m = S.v / 11; s.fx = Math.sin(S.dir) * m; s.fz = Math.cos(S.dir) * m; S.wroteX = s.fx; S.wroteZ = s.fz;
        if (ST.runV > 0.5 && s.A.acts.run) s.A.acts.run.setEffectiveTimeScale(clamp(S.v / ST.runV, 0.8, 2.0));
      } else { S.dir = s.yaw; S.wroteX = null; S.turn = 0; S.v = 0; }
      const camD = Math.hypot(s.x - cam.x, s.z - cam.z);
      if (camD > 160 || !s.g.visible) continue;
      // ---- slope alignment (plane through front/back/left/right ground samples) + bank in turns
      const yaw = s.g.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx, gy = s.g.position.y;
      const hF = C.groundH(s.x + fx * 0.9, s.z + fz * 0.9), hB = C.groundH(s.x - fx * 0.9, s.z - fz * 0.9), hR = C.groundH(s.x + rx * 0.35, s.z + rz * 0.35), hL = C.groundH(s.x - rx * 0.35, s.z - rz * 0.35);
      const pitchT = Math.atan2(hF - hB, 1.8) * K.stagAlign, rollT = Math.atan2(hR - hL, 0.7) * K.stagAlign - clamp((S.turn || 0) * 0.08, -0.25, 0.25);
      S.pitch = damp(S.pitch, pitchT, 8, dt); S.roll = damp(S.roll, rollT, 8, dt);
      const q = _qY[1].setFromAxisAngle(_qY[3], -S.pitch).premultiply(_qY[2].setFromAxisAngle(_qY[4], S.roll));
      S.wrap.quaternion.copy(q).multiply(_qY[0]);
      S.wrap.position.y = 0; s.g.updateMatrixWorld(true);
      // ---- ground offset: lowest hoof sole on its ground (the old code put the group origin on the centre height only)
      let gap = 1e9;
      for (let i = 0; i < 4; i++) {
        const b = S.feet[i]; if (!b) continue; const p = wpos(b, _p[9]), sole = p.y - ST.sole[i], g = C.groundH(p.x, p.z) + Math.min(snowDepth(p.x, p.z), 0.6) * K.snowFloat;
        gap = Math.min(gap, sole - g);
        // hoof plants → trail (terrain deformation if present; else the shared footprint decal near the player)
        const hh = p.y - g; if (hh > ST.sole[i] + 0.12) S.up[i] = 1;
        else if (S.up[i] && hh < ST.sole[i] + 0.04 && s.st === 'flee') {
          S.up[i] = 0;
          if (!hasStamp() && (S.trailN++ & 1) === 0 && Math.hypot(p.x - P.x, p.z - P.z) < 70) C.addFootprint(p.x, p.z, yaw + Math.PI);   // no terrain module: decal prints
          if (Math.random() < 0.6) C.emit(p.x, g + 0.05, p.z, rnd(-0.8, 0.8) - fx * 2, rnd(0.6, 1.6), rnd(-0.8, 0.8) - fz * 2, 0.6, 0xdce6f6, 0.4, 2.5, 2);
        }
      }
      if (gap < 1e8) { S.off = damp(S.off, clamp(-gap, -1.2, 1.2), 12, dt); S.wrap.position.y = S.off; }
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
      for (const k of ['walk', 'run']) if (f.anim.acts[k]) FX.stride[k] = strideSpeed(root, f.anim.acts[k].getClip(), [['b_LeftFoot02_018'], ['b_RightFoot02_022'], ['b_LeftHand_011'], ['b_RightHand_08']], 'b_Hip_01');
    } catch (e) { /* keep the game's rates */ }
    const orig = f.anim.speed.bind(f.anim), origLoop = f.anim.loop.bind(f.anim);
    // the fox moves far faster than its walk clip strides: past 2.2 m/s it trots with the run clip, rate from the real speed
    f.anim.loop = (k, fade) => origLoop(SUB.fox && k === 'walk' && f.speed > 2.2 && f.anim.acts.run ? 'run' : k, fade);
    f.anim.speed = (k, s) => { if (SUB.fox && k === 'walk' && f.speed > 2.2) k = 'run'; const v = FX.stride[k]; if (K.stride && v > 0.2 && SUB.fox) s = clamp(f.speed / v, 0.6, 2.6); return orig(k, s); };
    FX.q = [new Q().setFromAxisAngle(new V3(0, 1, 0), Math.PI), new Q(), new Q(), new V3(1, 0, 0), new V3(0, 0, 1)];
    FX.ready = true; return true;
  }
  function foxUpdate(dt) {
    if (!FX.ready && !foxSetup()) return;
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
        stamp(x, z, 0.55, 0.4, 'blob', 0.9, yaw); sfx('pounce');
      }
    }
    // slope alignment
    const hF = C.groundH(f.x + fx * 0.3, f.z + fz * 0.3), hB = C.groundH(f.x - fx * 0.3, f.z - fz * 0.3), hR = C.groundH(f.x + rx * 0.12, f.z + rz * 0.12), hL = C.groundH(f.x - rx * 0.12, f.z - rz * 0.12);
    FX.pitch = damp(FX.pitch, Math.atan2(hF - hB, 0.6) * K.foxAlign, 8, dt); FX.roll = damp(FX.roll, Math.atan2(hR - hL, 0.24) * K.foxAlign, 8, dt);
    const Qs = FX.q, q = Qs[1].setFromAxisAngle(Qs[3], FX.pitch + pp).premultiply(Qs[2].setFromAxisAngle(Qs[4], FX.roll));
    FX.wrap.quaternion.copy(q).multiply(Qs[0]);
    FX.snow = damp(FX.snow || 0, Math.min(snowDepth(f.x, f.z), 0.6) * K.snowFloat, 4, dt);   // paws rest on compressed snow, like the pilot's boots
    FX.wrap.position.set(0, py + FX.snow, pz);   // fox group local: -z is forward
  }

  /* ------------------------------------------------------------------ camera feel */
  const CAM = { bob: 0, bobV: 0, dip: 0, dipV: 0, lastSteps: 0, applied: 0 };
  function camUpdate(dt) {
    const P = C.player, G = C.G, cam = C.camera;
    if (C.mode !== 'play' || G.pause || G.ui || window.DBG && window.DBG.camOv) { CAM.dip = CAM.dipV = CAM.bob = CAM.bobV = 0; return; }
    const hs = G.riding ? 0 : Math.hypot(P.vx, P.vz);
    if (STATS.steps !== CAM.lastSteps) { CAM.lastSteps = STATS.steps; if (P.onGround) CAM.bobV -= K.bob * 9 * clamp(hs / 7, 0.3, 1.4); }
    // two critically-damped-ish springs
    const kS = 160, cS = 2 * Math.sqrt(kS) * 0.75;
    CAM.bobV += (-kS * CAM.bob - cS * CAM.bobV) * dt; CAM.bob += CAM.bobV * dt;
    const kD = 70, cD = 2 * Math.sqrt(kD) * 0.8;
    CAM.dipV += (-kD * CAM.dip - cD * CAM.dipV) * dt; CAM.dip += CAM.dipV * dt;
    let dy = clamp(CAM.bob, -0.05, 0.03) + clamp(CAM.dip, -0.4, 0.08);
    const boom = C.cam.boom || C.cam.dist; dy *= clamp(boom / 3, 0.25, 1);   // close to a wall: smaller moves
    if (Math.abs(dy) < 1e-4) return;
    // stay outside solids (Passport 'solid' + terrain), as the game's own boom does
    if (C.PH.ok) {
      const h = C.PH.P.sphereCast({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: 0, y: Math.sign(dy), z: 0 }, Math.abs(dy) + 0.05, 0.22, { groups: C.PH.P.groups.STATIC });
      if (h) dy = Math.sign(dy) * Math.max(0, h.distance - 0.05);
    }
    const gmin = C.groundH(cam.position.x, cam.position.z) + 0.5;
    if (dy < 0) dy = Math.max(dy, Math.min(0, gmin - cam.position.y));
    cam.position.y += dy; CAM.applied = dy;
  }

  /* ------------------------------------------------------------------ tests (tools/stand.mjs --eval "INTERACTION.testIK()") */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function footErr() {
    // heel = ankle bone, toe = ball bone; height above the ground straight below minus the same height on flat ground
    const P = C.player, out = [];
    for (const L of B.legs) {
      const a = wpos(L.foot, new V3()), b = L.ball ? wpos(L.ball, new V3()) : null;
      const ga = hitDown(a.x, a.y + 0.6, a.z, 2), gb = b ? hitDown(b.x, b.y + 0.6, b.z, 2) : null;
      out.push({ ankle: ga ? (a.y - ga.y) * ga.ny : NaN, ball: gb ? (b.y - gb.y) * gb.ny : NaN, nY: ga ? ga.ny : 1, animH: L.h });   // distance to the ground plane
    }
    return out;
  }
  async function sampleFeet(ms) {
    const rows = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { await wait(50); rows.push(footErr()); }
    return rows;
  }
  function findSlope(deg) {
    const want = Math.cos(deg * Math.PI / 180); let best = null;
    for (let i = 0; i < 20000; i++) {
      const x = (Math.random() - 0.5) * 700, z = (Math.random() - 0.5) * 700;
      if (C.getH(x, z) < 3 || C.inRift(x, z, 10) || C.nearPOI(x, z, 12)) continue;
      const ny = C.normalY(x, z); if (Math.abs(ny - want) > 0.01) continue;
      // planar: normals around agree, no solids/trees in 3 m
      let ok = true; for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (Math.abs(C.normalY(x + ox, z + oz) - want) > 0.02) { ok = false; break; }
      if (!ok) continue;
      const h = hitDown(x, C.getH(x, z) + 30, z, 40); if (!h || (h.tag && h.tag.kind !== 'terrain') || Math.abs(h.y - C.getH(x, z)) > 0.05) continue;
      if (C.FOREST && C.FOREST.list.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 25)) continue;
      best = { x, z, ny }; break;
    }
    return best;
  }
  function findFlat() {
    for (let i = 0; i < 20000; i++) {
      const x = (Math.random() - 0.5) * 600, z = (Math.random() - 0.5) * 600;
      if (C.getH(x, z) < 3 || C.inRift(x, z, 10) || C.nearPOI(x, z, 12)) continue;
      let ok = C.normalY(x, z) > 0.998; for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (C.normalY(x + ox, z + oz) < 0.997) ok = false;
      if (!ok) continue; const h = hitDown(x, C.getH(x, z) + 30, z, 40); if (!h || (h.tag && h.tag.kind !== 'terrain')) continue;
      return { x, z };
    }
    return null;
  }
  async function place(x, z, yaw) {
    const D = window.DBG; D.teleport(x, z, yaw); C.player.face = yaw; C.player.c.g.rotation.y = yaw; await wait(1300);
  }
  function stat(rows, key, ref) {   // max |err| over samples and both feet (planted feet only when walking)
    let mx = 0, sum = 0, n = 0;
    for (const r of rows) for (const f of r) { if (!isFinite(f[key])) continue; const e = Math.abs(f[key] - ref); mx = Math.max(mx, e); sum += e; n++; }
    return { max: +mx.toFixed(3), mean: +(sum / Math.max(1, n)).toFixed(3), n };
  }
  async function testIK(deg = 25) {
    if (!B.ready) return { error: 'pilot not ready' };
    const D = window.DBG; if (!D) return { error: 'needs #dbg' };
    const out = { slopeDeg: deg };
    const flat = findFlat(), sl = findSlope(deg); if (!flat || !sl) return { error: 'no test ground', flat, sl };
    out.flatAt = [+flat.x.toFixed(1), +flat.z.toFixed(1)]; out.slopeAt = [+sl.x.toFixed(1), +sl.z.toFixed(1)];
    const run = async (ik) => {
      K.ik = ik; const r = {};
      await place(flat.x, flat.z, 0); const fr = await sampleFeet(500);
      const refA = fr.flat().reduce((a, f) => a + f.ankle, 0) / (fr.length * 2), refB = fr.flat().reduce((a, f) => a + f.ball, 0) / (fr.length * 2);
      r.flatRef = { ankle: +refA.toFixed(3), ball: +refB.toFixed(3) };
      // downhill direction from the normal; stand across the slope, then facing uphill and downhill
      const e = 1, gx = C.getH(sl.x + e, sl.z) - C.getH(sl.x - e, sl.z), gz = C.getH(sl.x, sl.z + e) - C.getH(sl.x, sl.z - e);
      const upYaw = Math.atan2(-gx, -gz);   // face = atan2(-dx,-dz): forward along +gradient
      for (const [name, yaw] of [['across', upYaw + Math.PI / 2], ['uphill', upYaw], ['downhill', upYaw + Math.PI]]) {
        await place(sl.x, sl.z, yaw); const rows = await sampleFeet(600);
        r[name] = { ankle: stat(rows, 'ankle', refA), ball: stat(rows, 'ball', refB), pelvis: +B.pelvis.toFixed(3) };
      }
      return r;
    };
    const sfWas = K.snowFloat; K.snowFloat = 0;   // measure against the hard ground
    out.ikOff = await run(false);
    out.ikOn = await run(true);
    K.snowFloat = sfWas; K.ik = true;
    const worst = (r) => Math.max(...['across', 'uphill', 'downhill'].flatMap((k) => [r[k].ankle.max, r[k].ball.max]));
    out.maxErrOff = +worst(out.ikOff).toFixed(3); out.maxErrOn = +worst(out.ikOn).toFixed(3); out.pass = out.maxErrOn < 0.05;
    return out;
  }
  async function testWalk(deg = 25) {   // walk across the slope; ankle error on planted frames
    const D = window.DBG, sl = findSlope(deg); if (!sl) return { error: 'no slope' };
    const e = 1, gx = C.getH(sl.x + e, sl.z) - C.getH(sl.x - e, sl.z), gz = C.getH(sl.x, sl.z + e) - C.getH(sl.x, sl.z - e), across = Math.atan2(-gx, -gz) + Math.PI / 2;
    await place(sl.x, sl.z, across); D.cam.yaw = across; await wait(200);
    D.keys.KeyW = true; const rows = []; const t0 = performance.now();
    while (performance.now() - t0 < 1600) { await wait(33); const fe = footErr(); rows.push(fe.filter((f) => f.animH < B.hRest + 0.02)); }
    D.keys.KeyW = false;
    const all = rows.flat(), ref = B.hRest - 0.0;
    return { planted: all.length, ankle: stat([all], 'ankle', all.reduce((a, f) => a + f.ankle, 0) / Math.max(1, all.length)), steps: STATS.steps };
  }

  /* ------------------------------------------------------------------ module */
  // switch everything off / on (A/B measurements: tools/stand.mjs --eval "INTERACTION.off()")
  function off() {
    for (const k in SUB) SUB[k] = false;
    if (B.wrap) B.wrap.position.set(0, 0, 0);
    for (const [s, S] of ST.per) { S.wrap.position.set(0, 0, 0); S.wrap.quaternion.setFromAxisAngle(new V3(0, 1, 0), Math.PI); if (s.st === 'flee' && S.wroteX !== null) { const l = Math.hypot(s.fx, s.fz) || 1; s.fx /= l; s.fz /= l; } }
    if (FX.wrap) { FX.wrap.position.set(0, 0, 0); FX.wrap.quaternion.setFromAxisAngle(new V3(0, 1, 0), Math.PI); }
    if (ICE.base && C.PH.ch) { C.PH.ch.params.groundAccel = ICE.base.a; C.PH.ch.params.groundDecel = ICE.base.d; }
    return 'interaction off';
  }
  function on() { for (const k in SUB) SUB[k] = true; return 'interaction on'; }
  window.INTERACTION = { off, on, K, SUB, ERR, STATS, AU, B, ST, FX, ICE, CAM, W, testIK, testWalk, surfaceAt: (x, z) => { const h = hitDown(x, C.groundH(x, z) + 30, z, 60); return surfaceAt(x, h ? h.y : C.groundH(x, z), z, h); } };
  (window.GameModules = window.GameModules || []).push({
    name: 'interaction',
    order: 50,
    init(ctx) {
      C = ctx; T3 = ctx.THREE; setupMath();
      // own audio context: resumes on the first user gesture (like the game's)
      const go = () => auInit(); addEventListener('keydown', go, { passive: true }); addEventListener('pointerdown', go, { passive: true });
      // footsteps are ours while our audio runs: the game's generic step would double them (skimmer impacts pass through)
      const S = ctx.Sound, orig = S && S.step;
      if (orig) S.step = function () { if (SUB.steps && B.ready && auOK() && !C.G.riding) return; return orig.apply(this, arguments); };
      ctx.surfaceAtPlayer = () => B.lastSurf;
      ctx.interaction = window.INTERACTION;
    },
    update(dt, ctx) {
      const t0 = performance.now();
      guard('body', () => bodyUpdate(dt));
      guard('world', () => worldUpdate(dt));
      guard('ice', () => ICE.update(dt));
      guard('stags', () => stagUpdate(dt));
      guard('fox', () => foxUpdate(dt));
      guard('camera', () => camUpdate(dt));
      const ms = performance.now() - t0; STATS.frames++; STATS.ms = STATS.ms * 0.95 + ms * 0.05; STATS.msMax = Math.max(STATS.msMax * 0.999, ms);
    },
  });
})();
