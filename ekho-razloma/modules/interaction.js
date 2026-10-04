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
  const SUB = { body: true, look: true, arms: true, steps: true, world: true, ice: true, stags: true, fox: true, camera: true, contact: true };
  const ERR = {};
  const K = {                       // knobs (documented in INTERACTION.md)
    ik: true, ikRay: 1.7, pelvisMin: -0.5, pelvisMax: 0.4, tiltMax: 0.6, stride: true, strideMin: 0.55, strideMax: 1.9,
    lean: 1, look: true, lookRange: 6, snowFloat: 0.3, bob: 0.018, dip: 1, iceAccel: 0.3, iceDecel: 0.14, stepVol: 1,
    stagTurn: 2.4, stagTop: 9.5, stagAlign: 0.85, foxAlign: 0.8, trees: true,
    gait: true, gaitBands: [[1.5, 3.5], [8.0, 9.5]], stagRate: 2.4, foxRate: 4.5, footStamp: true, foxLegs: false,
    gaitBlend: true,   // stags: ANIMLIB 20-clip walk/trot/canter/gallop blender (replaces the flat Run clip while fleeing)
    contact: true, contactRange: 1.7, contactAsk: 1.2,   // pilot: rock/wall/branch/ledge contact layer (INT-CONTACT)
    contactBVH: true,   // CONTACT-SURFACE: hand/foot IK aims at the drawn mesh (three-mesh-bvh), not the physics hull
    footLock: true, lockMax: 0.22, lockRelease: 16, lockStep: 0.06, stepDur: 0.22, stepLift: 0.06,   // PHYSBODY: planted foot pinned for the whole stance (heel -> ball pivot)
    snowSurface: true,  // feet stand on the drawn snow (SNOW-CONTACT); testIK turns it off to measure against the hard ground
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
  // SNOW-CONTACT: nothing here draws prints. The terrain module presses its snow map with the objects' own geometry
  // (boots, body, paws, hooves, skis), every frame, from below; this module only places the feet on / into that surface
  // and makes the contact event (sound + puff) when a foot plants. hasStamp = a terrain module is present (else the
  // game's old decal prints are the fallback for the stags).
  const hasStamp = () => typeof C.snowStamp === 'function';

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

  /* ------------------------------------------------------------------ contact: lean on a rock, hand on a wall, brace a
   * slope, step over / vault low obstacles, brush a branch, inspect/pick up — the "bumps into a rock from a distance"
   * fix. ANIMLIB.md's 37 pilot/hermit clips (assets/pack/anim_pilot_contact.js) carry, per clip, which hand/foot holds
   * where on the real surface and the ideal stand-off; ANIMLIB.chooseContact(intent, sense, meta) turns a probed
   * "sense" + a high-level intent into {clip, enter, standOff}. The intent itself (which of the 7 actions, if any) is
   * asked of Jev (CONTACT_INTENT, ai-content.js) only when the probed surface state actually changes near the player;
   * offline / low-confidence falls back to AI_CONTENT.contactRules (deterministic, same file). */
  const CT = { ready: false, meta: null, layer: null, state: 'idle', phase: null, pick: null, t: 0, sense: null,
    wantIntent: 'none', wantSrc: 'rules', askKey: '', askAt: -9, senseT: 0, plan: null, keyT: 0 };
  // INTERACT (modules/interact.js): kinds with authored contact points go through the mediator — stand spot, facing
  // and hand/foot targets come from the object's interaction passport; unmarked surfaces keep the probe + BVH path below
  K.passport = true; K.passportOnly = true; K.steerSpeed = 1.4; K.steerTurn = 4.5; K.steerMax = 2.2;
  // ROCKS (Passport names rock*, st_rock*, boulder*) belong to modules/rock-brain.js: while it is on, this generic
  // contact path never acts on a rock (contactDecide / contactStep / contactUpdate below) — one owner, no competing rules.
  const ROCK_RE = window.CORE ? window.CORE.surfaceRe : /^(st_)?(rock|boulder)/i;   // the family list lives in modules/contact-core.js
  const rockOwner = () => !!(window.ROCKBRAIN && window.ROCKBRAIN.K.on);
  // the physics tag of some scans carries only the Passport id, not the name: resolve the entry's own name
  const rockTag = (h) => {
    if (!h || !h.tag) return false;
    let n = h.tag.name;
    if (!n && h.tag.passport != null && window.INTERACT) { const e = window.INTERACT.entryById(h.tag.passport); n = e && e.name; }
    return !!(n && ROCK_RE.test(String(n)));
  };
  function contactReady() {
    const A = C.AV && C.AV.player;
    if (A && A.contact && A.contactMeta) { CT.meta = A.contactMeta; CT.layer = A.contact; CT.ready = true; }
    return CT.ready;
  }
  // one probe: horizontal ray at height `oy` above the feet, then a downward ray to the real top of whatever it hit
  // (= "height = top of the hit surface above the feet", per ANIMLIB.md's sense spec)
  function probeDir(ox, oz, len, oy) {
    const P = C.player, PH = C.PH;
    // rocks/walls/ruins are STATIC, tree trunks are their own TRUNK group, static/pushable props are PROP (see
    // physics.js) — a contact probe wants all three (unlike hitDown()'s foot-ground ray, which stays STATIC-only)
    const grp = PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP;
    const h = PH.P.raycast({ x: P.x, y: P.y + oy, z: P.z }, { x: ox, y: 0, z: oz }, len, { groups: grp });
    if (!h) return null;
    // "height" = real top of the surface above the feet, sampled at 3 points along the ray PAST the hit (0.05 / 0.35 /
    // 0.65 m further in) rather than only at the exact hit XZ, and taking the tallest: a photogrammetry rock/wall is
    // craggy, so a single vertical column at the near edge can land on a low crack or foot of the rock and read as
    // knee-height even when the same surface is a 3 m wall a few dozen cm further in (this under-read is what made
    // senseKind() classify tall rocks/walls as a step-over "obstacle" — see CONTACT-SURFACE.md).
    let height = 0;
    for (const push of [0.05, 0.35, 0.65]) {
      const hx = P.x + ox * (h.distance + push), hz = P.z + oz * (h.distance + push);
      const top = PH.P.raycast({ x: hx, y: P.y + 3.5, z: hz }, { x: 0, y: -1, z: 0 }, 4.2, { groups: grp });
      if (top) height = Math.max(height, clamp(top.point.y - P.y, 0, 3));
    }
    if (height === 0) height = 1.2;   // no vertical sample landed on the object at all (rare: a razor-thin edge) — the old constant default
    const nx = h.normal ? h.normal.x : -ox, ny = h.normal ? h.normal.y : 0, nz = h.normal ? h.normal.z : -oz;
    return { dist: h.distance, height, nx, ny, nz, px: h.point.x, py: h.point.y, pz: h.point.z, tag: h.tag };
  }
  function contactSense() {
    const P = C.player, PH = C.PH; if (!PH.ok) return null;
    const face = P.c.g.rotation.y, fx = -Math.sin(face), fz = -Math.cos(face), rx = Math.cos(face), rz = -Math.sin(face);
    const front = probeDir(fx, fz, K.contactRange, 1.0), left = probeDir(-rx, -rz, 1.15, 1.0), right = probeDir(rx, rz, 1.15, 1.0), back = probeDir(-fx, -fz, 1.15, 1.0);
    const knee = probeDir(fx, fz, 1.5, 0.38), obstacle = knee && knee.height <= 1.3 && knee.height > 0.12 ? knee : null;
    // slope AHEAD (not just under the player's own feet): signed rise angle over the next 1.2 m along facing —
    // positive = uphill, what climb_slope / brace_slope actually needs
    const slope = Math.atan2(C.groundH(P.x + fx * 1.2, P.z + fz * 1.2) - C.groundH(P.x, P.z), 1.2);
    const g0 = B.legs[0] ? B.legs[0].g : null;
    return { front, left, right, back, knee, obstacle, ground: { slope, normal: g0 ? [g0.nx, g0.ny, g0.nz] : [0, 1, 0] }, speed: Math.hypot(P.vx, P.vz), onIce: B.lastSurf === 'ice' };
  }
  // coarse surface classification for the Jev question + the rule fallback (chooseContact does its own, finer-grained
  // thresholding once an intent is picked)
  function senseKind(sense) {
    const f = sense.front;
    // a pushable prop directly ahead (or under the knee probe) is never a lean / vault / step-over target: the
    // dedicated push mechanic (pushState() in armsUpdate) owns it. Before this check, a waist-high crate satisfying
    // the knee+chest obstacle_top height window got read as a low obstacle and vaulted/stepped-over — and a taller
    // one (object_face, below) still competed with push at walking speed (< 1.4 m/s) — either way CT took over
    // control before the pilot ever got close enough to push (INTERACT.md: crate_wood engage rate, pilot_push look-gate).
    if ((f && f.tag && f.tag.kind === 'prop') || (sense.obstacle && sense.obstacle.tag && sense.obstacle.tag.kind === 'prop')) return { surface: 'none', height: 0, dist: 3 };
    // `obstacle` (the knee-height probe) is only a genuine low object when the chest-height probe flew OVER it (per
    // its own doc: "a chest-height ray flies over anything short"). If the front probe ALSO reads a wall/ledge height
    // right there, the surface keeps going up past knee height — it is not a crate to vault, it is the base of a
    // taller rock/wall the knee ray happened to catch (found live: 3–5 m boulders read as 0.4 m "obstacles" and got
    // vaulted instead of leaned on — see CONTACT-SURFACE.md).
    if (sense.obstacle && (!f || f.height <= 1.3)) return { surface: 'obstacle_top', height: sense.obstacle.height, dist: sense.obstacle.dist };
    if (!f) return { surface: 'none', height: 0, dist: 3 };
    if (f.tag && f.tag.name && /branch|krummholz|shrub/i.test(f.tag.name)) return { surface: 'branch', height: f.height, dist: f.dist };
    if (sense.ground.slope > 0.5 && f.dist > 1.1) return { surface: 'slope', height: f.height, dist: f.dist };
    if (f.tag && f.tag.kind === 'prop') return { surface: 'object_face', height: f.height, dist: f.dist };
    if (f.height > 0.45 && f.height < 0.95) return { surface: 'ledge', height: f.height, dist: f.dist };
    if (f.height >= 0.95) return { surface: 'wall', height: f.height, dist: f.dist };
    return { surface: 'ground', height: f.height, dist: f.dist };
  }
  function contactDecide() {
    const sense = CT.sense; if (!sense) { CT.wantIntent = 'none'; return; }
    const P = C.player, G = C.G, AC = window.AI_CONTENT;
    const kind = senseKind(sense);
    const state = G.riding ? 'riding' : C.Creatures.inCombat() ? 'combat'
      : (C.CLIMB && C.CLIMB.t >= 0) ? 'climbing' : P.sliding ? 'sliding' : sense.speed > 6 ? 'running' : sense.speed > 0.15 ? 'walking' : 'idle';
    const animalsNear = C.Creatures.animalsNear(P.x, P.z);   // stags within 30 m, a fox that has joined within 15 m (modules/creatures.js)
    const npcNear = !!(C.orm && C.orm.pos && Math.hypot(C.orm.pos.x - P.x, C.orm.pos.z - P.z) < 10);
    const raw = { surface: kind.surface, height: kind.height || 0, distance: clamp(kind.dist, 0, 3), angleDeg: 0, speed: sense.speed, state,
      stamina: clamp(P.hp / Math.max(1, P.hpMax), 0, 1), cold: clamp((C.WX && C.WX.storm) || 0, 0, 1), animalsNear: Math.min(9, animalsNear), npcNear, onIce: sense.onIce };
    CT.wantIntent = AC && AC.contactRules ? AC.contactRules(raw) : 'none'; CT.wantState = state;
    // a rock ahead (or under the knee probe) is rock-brain's: no generic intent on it
    if (rockOwner() && rkFront(sense)) { CT.wantIntent = 'none'; return; }
    const key = raw.surface + '|' + Math.round(raw.distance * 4) + '|' + raw.state + '|' + Math.round(raw.height * 4) + '|' + (raw.onIce ? 1 : 0);
    if (window.AI && window.AI.available && window.AI.ask && (key !== CT.askKey) && (C.T - CT.askAt > K.contactAsk)) {
      CT.askKey = key; CT.askAt = C.T; STATS.contactAsks = (STATS.contactAsks || 0) + 1;
      window.AI.ask('CONTACT_INTENT', raw).then((r) => { if (r && r.intent) { CT.wantIntent = r.intent; CT.wantSrc = r.src; } });
    }
  }
  function playPick(A, name) {
    const m = CT.meta.clips[name]; if (!A.acts[name]) return false;
    if (m && m.loop === false) A.once(name, m.duration, 0.15); else A.loop(name, 0.2);
    return true;
  }

  /* ---- CONTACT-SURFACE: hand/foot IK aims at the RENDERED surface, not the physics collider ------------------
   * physics.js/open-world.html give rocks/boulders/outcrops a convex-HULL collider (Passport.register(..., 'solid',
   * {shape:'hull'}), see structures.js/vegetation.js) — a fine approximation for walking on, but on a cracked or
   * curved scan the hull and the drawn mesh disagree by several cm, so a hand IK'd onto the hull hovers in front of
   * what the player actually sees. Passport already keeps the EXACT drawn-mesh vertices in world space for every
   * 'solid' entry (e.geo, built before any hull simplification — see open-world.html Passport.make()/toPhys()), so
   * the correction needs no scene traversal and no new geometry extraction: wrap e.geo in a throwaway BufferGeometry,
   * build a three-mesh-bvh tree on it once (lazily, only for entries a hand ever actually reaches, cached forever by
   * entry identity), and raycast that instead. Any failure (library not loaded, geometry too big, nothing found)
   * silently keeps the physics hit — this is a correction layer, never the only path. */
  // NOTE: T3 (ctx.THREE) is only assigned once init(ctx) runs, well after this IIFE's top-level code — a `const`
  // computed from T3 here would freeze at null forever. Lazily construct on first real use instead.
  let _bvhRay = null;
  function bvhRay() { if (!_bvhRay && T3 && T3.Ray) _bvhRay = new T3.Ray(); return _bvhRay; }
  const bvhCache = new WeakMap();   // Passport entry -> BufferGeometry (with .boundsTree) | null, built lazily
  const passportIdCache = new Map();   // physics tag.passport (number) -> Passport entry | null, resolved lazily
  function bvhGeoFor(e) {
    if (!e || !e.geo || !e.geo.vn || !e.geo.i || e.geo.i.length / 3 > 20000) return null;   // guard: never build for something terrain-scale that slipped through
    if (bvhCache.has(e)) return bvhCache.get(e);
    let geo = null;
    try {
      if (T3.BufferGeometry.prototype.computeBoundsTree) {
        geo = new T3.BufferGeometry();
        geo.setAttribute('position', new T3.BufferAttribute(e.geo.v, 3));
        geo.setIndex(new T3.BufferAttribute(e.geo.i, 1));
        geo.computeBoundsTree();
      }
    } catch (err) { geo = null; }
    bvhCache.set(e, geo);
    return geo;
  }
  // Resolve the EXACT Passport entry the physics ray already hit (its collider carries `{kind,name,passport:e.id}`
  // as its tag, see open-world.html Passport.toPhys()) — a linear scan over Passport.list, but only the first time a
  // given id is ever touched (cached after by id; a nearest-neighbourhood search was tried first and dropped: with
  // several small rocks/props often clustered around one big boulder, "nearest plausible BVH hit" sometimes landed
  // on a NEIGHBOUR's geometry instead of the boulder actually being touched — exact id lookup can't do that).
  function entryByPassportId(id) {
    if (id == null) return null;
    if (passportIdCache.has(id)) return passportIdCache.get(id);
    let found = null; for (const e of (C.Passport && C.Passport.list) || []) if (e.id === id) { found = e; break; }
    passportIdCache.set(id, found);
    return found;
  }
  function faceNormalTowards(hit, dx, dz) {
    const n = hit.face && hit.face.normal ? hit.face.normal : null; if (!n) return null;
    if (n.x * dx + n.z * dz > 0) n.negate();   // three-mesh-bvh returns the raw winding normal; face it back at the ray origin like the physics hit's normal
    return n;
  }
  // BVH raycast against the ONE Passport entry the physics probe already hit, same ray, its exact drawn geometry;
  // used only to correct the point/normal (`dist` sanity-checks against the physics distance as a last-ditch guard).
  function bvhRaycastTag(ox, oy, oz, dx, dz, dist, tag) {
    const ray = bvhRay(); if (!ray || !tag) return null;
    const e = entryByPassportId(tag.passport);
    const geo = bvhGeoFor(e); if (!geo || !geo.boundsTree) return null;
    ray.origin.set(ox, oy, oz); ray.direction.set(dx, 0, dz);
    let hit = null; try { hit = geo.boundsTree.raycastFirst(ray, T3.DoubleSide); } catch (err) { return null; }
    return hit && Math.abs(hit.distance - dist) < 0.6 ? hit : null;
  }
  // hand/foot IK target for a clip's contact window: obstacle-top contacts (vault, step_over) pin to the knee-height
  // probe, everything else (wall, ledge_top, slope) pins to the front probe — approach.facing is always [0,0,1] in
  // this clip set (the surface is authored to be in front of the character; bone side just says which hand, not which
  // side to probe)
  function contactHit(c) {
    if (CT.plan) { const t = CT.plan.targets && CT.plan.targets[c.bone]; return t ? { point: t.point, normal: t.normal } : null; }
    const s = CT.sense; if (!s) return null;
    const P = C.player, PH = C.PH;
    let physHit = null, ox = P.x, oy = P.y + 1.0, oz = P.z, dx = 0, dz = 0, dist = 3, tag = null;
    if (c.surface && c.surface.type === 'obstacle_top') {
      if (!s.obstacle) return null;
      // fallback: the shared knee-height probe point, same for both hands (the original behaviour) — but the clip's
      // own metadata carries a per-hand LATERAL offset here too (surface.point[0], ±0.2 m, same convention as the
      // wall/ledge branch below), and its own note says the vertical key is authored for a 1 m obstacle and meant to
      // be scaled by (real top ÷ 1 m) — exactly `chooseContact`'s own `heightScale` on the picked clip. Re-probing
      // per hand at that scaled height, like the wall branch already does, is what turned a 37–47 cm miss (both
      // hands aimed at one shared point well below the vault clip's actual hand height) into a close match.
      physHit = { point: new V3(s.obstacle.px, s.obstacle.py, s.obstacle.pz), normal: new V3(s.obstacle.nx, s.obstacle.ny, s.obstacle.nz) };
      const face = P.c.g.rotation.y, fx = -Math.sin(face), fz = -Math.cos(face), lx = -Math.cos(face), lz = Math.sin(face);
      const hs = (CT.pick && CT.pick.heightScale) || 1, lo = (c.surface.point && c.surface.point[0]) || 0, ly = ((c.surface.point && c.surface.point[1]) || 0.38) * hs;
      ox = P.x + lx * lo; oy = P.y + ly; oz = P.z + lz * lo; dx = fx; dz = fz; dist = s.obstacle.dist; tag = s.obstacle.tag;
      if (PH.ok) {
        const h = PH.P.raycast({ x: ox, y: oy, z: oz }, { x: dx, y: 0, z: dz }, K.contactRange, { groups: PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP });
        if (h) { const n = h.normal || { x: -dx, y: 0, z: -dz }; physHit = { point: new V3(h.point.x, h.point.y, h.point.z), normal: new V3(n.x, n.y, n.z) }; dist = h.distance; tag = h.tag; }
      }
    } else if (PH.ok && c.surface && c.surface.point) {
      // the periodic front/knee probes are ONE point straight ahead — good enough to classify the surface and steer to
      // it, but the two hands of a *_both clip sit ~0.2 m apart sideways (see the clip's own surface.point[0], character
      // space, +X = left) and a boulder is rarely flat across that span. Re-probe per hand, at query time (cheap: 2
      // rays, only while a hold is looping), offset by the clip's own local point so each hand pins to what is really
      // under IT, not a shared centre point.
      // world forward = rotate the model's local +Z by (face + π) (the wrap group's 180° flip, see attach()); world
      // left (local +X, ANIMLIB.md's convention) by the same rotation = (-cos(face), sin(face))
      const face = P.c.g.rotation.y, fx = -Math.sin(face), fz = -Math.cos(face), lx = -Math.cos(face), lz = Math.sin(face);
      const lo = c.surface.point[0] || 0, ly = c.surface.point[1] || 0;
      ox = P.x + lx * lo; oy = P.y + ly; oz = P.z + lz * lo; dx = fx; dz = fz;
      const h = PH.P.raycast({ x: ox, y: oy, z: oz }, { x: dx, y: 0, z: dz }, K.contactRange, { groups: PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP });
      if (h) { const n = h.normal || { x: -dx, y: 0, z: -dz }; physHit = { point: new V3(h.point.x, h.point.y, h.point.z), normal: new V3(n.x, n.y, n.z) }; dist = h.distance; tag = h.tag; }
    } else if (s.front) {
      physHit = { point: new V3(s.front.px, s.front.py, s.front.pz), normal: new V3(s.front.nx, s.front.ny, s.front.nz) };
      const face = P.c.g.rotation.y; dx = -Math.sin(face); dz = -Math.cos(face); dist = s.front.dist; tag = s.front.tag;
    }
    if (!physHit) return null;
    if (K.contactBVH && tag) {
      try {
        const bh = bvhRaycastTag(ox, oy, oz, dx, dz, dist, tag);
        if (bh) { const n = faceNormalTowards(bh, dx, dz); if (n) return { point: bh.point.clone(), normal: n.clone().normalize() }; }
      } catch (err) { /* correction only: any failure keeps the physics hit below */ }
    }
    return physHit;
  }
  function contactExit() { CT.state = 'idle'; CT.pick = null; CT.phase = null; CT.plan = null; CT.keyT = 0; }
  const moveKeys = () => { const k = C.keys; return !!(k && (k.KeyW || k.KeyA || k.KeyS || k.KeyD || k.ArrowUp || k.ArrowDown || k.ArrowLeft || k.ArrowRight)); };
  // the Passport entries the probes touched (their physics tags carry the entry id)
  function sensedEntries(s) {
    const I = window.INTERACT, out = []; if (!I || !s) return out;
    for (const pr of [s.front, s.knee, s.left, s.right]) { const e = pr && pr.tag ? I.entryById(pr.tag.passport) : null; if (e && !out.includes(e)) out.push(e); }
    return out;
  }

  // is the thing a probe touched a rock (rock-brain's)? Some rocks sit in a terrain hump: the probes hit the ground
  // collider right at the rock — a terrain hit inside a rock's box counts as that rock
  let _rkList = null, _rkN = -1;
  function rockEntryNear(x, z, pad) {
    const L = (C.Passport && C.Passport.list) || []; if (!_rkList || _rkN !== L.length) { _rkList = L.filter((e) => e.alive && e.box && ROCK_RE.test(String(e.name || ''))); _rkN = L.length; }
    let best = null, bd = 1e9;
    for (const e of _rkList) { const b = e.box; if (!e.alive || x < b.min[0] - pad || x > b.max[0] + pad || z < b.min[2] - pad || z > b.max[2] + pad) continue; const d = Math.hypot(x - (b.min[0] + b.max[0]) / 2, z - (b.min[2] + b.max[2]) / 2); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  const rkOne = (h) => { if (!h) return null; if (rockTag(h)) return h; if (h.tag && h.tag.kind === 'terrain') { const e = rockEntryNear(h.px, h.pz, 0.8); if (e) { h.rockEntry = e; return h; } } return null; };
  const rkFront = (s) => (s ? (rkOne(s.front) || rkOne(s.knee)) : null);
  // mediator: kinds with an interaction passport get their stand spot / facing / targets from it
  function contactPlan() {
    const I = window.INTERACT; if (!K.passport || !I || !CT.sense) return { marked: false, plan: null };
    const ents = sensedEntries(CT.sense).filter((e) => !(rockOwner() && ROCK_RE.test(String(e.name || '')))), marked = ents.some((e) => I.hasPoints(e)); if (!marked) return { marked: false, plan: null };
    const P = C.player; let plan = null;
    // the same situation that just failed is not re-planned every 0.2 s (standing still next to a rock with no valid point)
    const key = CT.wantIntent + '|' + ents.map((e) => e.id).join(',') + '|' + Math.round(P.x * 8) + ',' + Math.round(P.z * 8) + ',' + Math.round(P.face * 8);
    if (CT.missKey === key && C.T - CT.missAt < 1.5) return { marked, plan: null };
    try { plan = I.plan(CT.wantIntent, ents, { x: P.x, y: P.y, z: P.z, face: P.face }, CT.meta); } catch (e) { plan = null; STATS.planErr = String(e && e.message); }
    if (!plan) { CT.missKey = key; CT.missAt = C.T; }
    return { marked, plan };
  }
  function contactStep(dt) {
    const A = C.AV.player;
    if (CT.state === 'idle') {
      if (CT.wantIntent !== 'none' && CT.sense && !(rockOwner() && rkFront(CT.sense))) {
        const mp = contactPlan();
        if (mp.plan && A.acts[mp.plan.clip] && CT.meta.clips[mp.plan.clip]) {
          CT.plan = mp.plan; CT.pick = { clip: mp.plan.clip, enter: mp.plan.enter, standOff: mp.plan.standOff, heightScale: mp.plan.heightScale }; CT.state = 'steer'; CT.t = 0; CT.keyT = 0; STATS.planned = (STATS.planned || 0) + 1;
          return;
        }
        if (mp.marked && K.passportOnly) return;   // marked kind, no valid point from here: no contact (never a hand in the air)
        let pick = null; try { pick = window.ANIMLIB.chooseContact(CT.wantIntent, CT.sense, CT.meta); } catch (e) { pick = null; }
        if (pick && A.acts[pick.clip] && CT.meta.clips[pick.clip]) { CT.pick = pick; CT.state = 'steer'; }
      }
      return;
    }
    const pick = CT.pick; if (!pick) { contactExit(); return; }
    const P = C.player;
    if (CT.plan) { planStep(dt, A, P); return; }
    // no per-frame key/velocity check here on purpose: a player who keeps holding W into a wall they've already
    // reached is capsule-blocked, but a kinematic character controller can keep reporting a non-trivial "grinding"
    // velocity for several frames while it's blocked (or during the steer nudge itself) — gating cancellation on
    // that every frame flip-flopped the state (idle→steer→play→idle…) and, worse, kept restarting the one-shot enter
    // clip from t=0 (A.once() always restarts) so it never reached the loop hold. contactDecide() already re-derives
    // CT.wantIntent from distance/speed/state every 0.2 s (contactRules' own gates) — that's the single source of
    // truth for "should this still be happening", checked here, not re-derived per frame from raw motion.
    if (CT.state === 'steer') {
      if (CT.steerDist == null || CT.wantIntent === 'none') { contactExit(); return; }
      const standOff = pick.standOff || 0.45, need = CT.steerDist - standOff, face = P.c.g.rotation.y;
      if (Math.abs(need) > 0.03) {   // the capsule already stopped the player a few cm out; close the last bit smoothly.
        // track the closing distance locally (not the probe, which only refreshes every 0.2 s / ~12 frames — using the
        // stale value directly would keep pushing at a near-constant rate for that whole window and overshoot)
        const dx = -Math.sin(face), dz = -Math.cos(face), step = clamp(need, -0.35, 0.35) * Math.min(1, dt * 4);
        P.x += dx * step; P.z += dz * step; CT.steerDist -= step; if (C.PH.ok) C.PH.ch.setPosition(P.x, P.y, P.z);
        return;
      }
      CT.state = 'play'; CT.t = 0; CT.phase = pick.enter ? 'enter' : 'main';
      playPick(A, pick.enter || pick.clip);
    } else if (CT.state === 'play') {
      const cmMain = CT.meta.clips[pick.clip];
      CT.t += dt;
      if (CT.phase === 'enter') {   // committed once started: a clean 0.6 s transition, never re-triggered mid-way
        const cm = CT.meta.clips[pick.enter || pick.clip], dur = cm ? cm.duration : 0.6;
        if (CT.t >= dur - 0.03) { CT.phase = 'main'; CT.t = 0; playPick(A, pick.clip); }
      } else {
        if (CT.wantIntent === 'none' && cmMain && cmMain.loop) { contactExit(); return; }   // holds end once the reason is gone (re-decided every 0.2 s)
        if (!cmMain || cmMain.loop === false) { if (CT.t >= (cmMain ? cmMain.duration : 0.6) - 0.03) { contactExit(); return; } }   // one-shot main clip (vault, step_over, pickup, crouch) finished
        else playPick(A, pick.clip);   // re-assert the hold (idempotent: same key each frame, no crossfade churn)
      }
    }
    if (A.cur && CT.layer && A.acts[A.cur]) layerHands(A.acts[A.cur], contactHit, 'contact');
  }
  // RK: the channel modules/rock-brain.js drives the body through (it decides; this module only applies it next frame):
  // spine pitch / roll (leanUpdate), knees (pelvis dip), the head's look-at, both arms onto hand points (armsUpdate)
  const RK = { pitch: 0, roll: 0, dip: 0, armW: 0, hands: { 1: { x: 0, y: 0, z: 0 }, '-1': { x: 0, y: 0, z: 0 } }, lookPt: { x: 0, y: 0, z: 0 }, lookOn: false };
  const rkReset = () => { RK.pitch = RK.roll = RK.dip = 0; RK.lookOn = false; RK.armW = 0; };
  // planned contact: walk the last bit to the stand spot while turning to the planned facing, then play; the hold ends
  // when the player moves (a movement key held past the enter clip) or the pose is knocked off the stand spot
  // the contact clip's hand / foot IK (ANIMLIB ContactLayer): a PoseRequest when the pose pipeline owns the hands
  function layerHands(act, hit, source, slot) {
    const PP = window.POSE, lay = CT.layer; if (!lay || !act) return;
    const hit2 = PP && PP.hit && PP.active('hands') ? PP.hit(hit) : hit;   // PoseSolver: palm feedback / palms higher
    const go = () => { try { lay.update(act, hit2, 1); } catch (e) { /* clip has no hand/foot contacts */ } };
    if (PP && PP.active('hands')) PP.request({ slot: slot || 'contact', source, type: 'limbTarget', data: { clip: act.getClip().name, hit }, apply: go }); else go();
  }
  function planStep(dt, A, P) {
    const pl = CT.plan, PH = C.PH;
    if (CT.state === 'steer') {
      CT.t += dt;
      if (moveKeys()) { CT.keyT += dt; if (CT.keyT > 0.5) contactExit(); return; }   // the player is steering: wait, then give up
      const dx = pl.sx - P.x, dz = pl.sz - P.z, d = Math.hypot(dx, dz), dy = wrapA(pl.yaw - P.face);
      if (CT.t > K.steerMax || d > 2.5) { contactExit(); return; }
      if (d > 0.01 || Math.abs(dy) > 0.02) {
        const st = Math.min(d, K.steerSpeed * dt); if (d > 1e-4) { P.x += dx / d * st; P.z += dz / d * st; }
        P.face += clamp(dy, -K.steerTurn * dt, K.steerTurn * dt); P.c.g.rotation.y = P.face; P.c.g.position.x = P.x; P.c.g.position.z = P.z;
        if (PH.ok) PH.ch.setPosition(P.x, P.y, P.z);
        return;
      }
      P.x = pl.sx; P.z = pl.sz; P.face = pl.yaw; P.c.g.rotation.y = pl.yaw; if (PH.ok) PH.ch.setPosition(P.x, P.y, P.z);
      CT.state = 'play'; CT.t = 0; CT.phase = pl.enter ? 'enter' : 'main'; CT.keyT = 0; pl.at = { x: P.x, z: P.z };
      playPick(A, pl.enter || pl.clip);
    } else if (CT.state === 'play') {
      const cmMain = CT.meta.clips[pl.clip]; CT.t += dt;
      if (CT.phase === 'enter') {
        const cm = CT.meta.clips[pl.enter], dur = cm ? cm.duration : 0.6;
        if (CT.t >= dur - 0.03) { CT.phase = 'main'; CT.t = 0; playPick(A, pl.clip); }
      } else {
        const oneShot = !cmMain || cmMain.loop === false;
        if (oneShot) { if (CT.t >= (cmMain ? cmMain.duration : 0.6) - 0.03) { contactExit(); return; } }
        else {
          if (moveKeys()) { CT.keyT += dt; if (CT.keyT > 0.12) { contactExit(); return; } } else CT.keyT = 0;
          if (Math.hypot(P.x - pl.at.x, P.z - pl.at.z) > 0.25 || CT.wantState === 'combat' || CT.wantState === 'riding') { contactExit(); return; }
          playPick(A, pl.clip);
        }
      }
      // hold still on the stand spot (the capsule may be nudged by the controller's own snap)
      if (!moveKeys()) { P.face = pl.yaw; P.c.g.rotation.y = pl.yaw; }
      // a shoulder lean has no limb IK: slide the pilot along the surface normal until the shoulder (bone + the clip's
      // 10 cm of shoulder) meets the face — the capsule may have been pushed off it by a lower bulge (wheels, a plinth)
      if (pl.shoulder && CT.phase === 'main' && !moveKeys() && B.root) {
        const sb = B.root.getObjectByName(pl.shoulder.bone); if (sb) { const w = wpos(sb, _p[18]), q = pl.shoulder;
          const d = (w.x - q.x) * q.ex + (w.z - q.z) * q.ez - 0.1 * B.root.getWorldScale(_p[19]).x, st = clamp(d, -0.3, 0.3) * Math.min(1, dt * 6);
          if (Math.abs(d) > 0.01 && Math.abs(pl.slid || 0) < 0.45) { P.x -= q.ex * st; P.z -= q.ez * st; pl.at.x -= q.ex * st; pl.at.z -= q.ez * st; pl.slid = (pl.slid || 0) + st; if (PH.ok) PH.ch.setPosition(P.x, P.y, P.z); } } }
    }
    if (A.cur && CT.layer && A.acts[A.cur]) layerHands(A.acts[A.cur], contactHit, 'contact');
  }
  function contactUpdate(dt) {
    if (!K.contact || !B.ready || (!CT.ready && !contactReady())) return;
    const P = C.player, G = C.G;
    const active = (C.mode === 'play' || C.mode === 'menu') && P.onGround && !G.riding && G.deadT <= 0 && !(C.CLIMB && C.CLIMB.t >= 0) && P.aimT <= 0 && B.arms.mode !== 'push';
    rkReset();
    if (!active) { if (CT.state !== 'idle') contactExit(); return; }
    if (rockOwner() && window.ROCKBRAIN.owns()) { if (CT.state !== 'idle') contactExit(); return; }   // rock-brain is acting: no generic contact
    CT.senseT -= dt;
    if (CT.senseT <= 0) { CT.senseT = 0.2; CT.sense = contactSense(); contactDecide(); CT.steerDist = CT.sense && CT.sense.front ? CT.sense.front.dist : null; }
    contactStep(dt);
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
  // SNOW-CONTACT: one contact event per plant — footfall(): the step sound + a puff at the boot. The print is not drawn
  // here (no stamp, no re-stamp while the foot slides): the terrain module's snow map is pressed by the boot mesh itself.
  function footfall(L, hs) {
    const P = C.player, x = L.anim.x, z = L.anim.z, y = L.gy !== undefined ? L.gy : L.g.y, surf = surfaceAt(x, L.g.y, z, L.g);
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
      const e = PUSH.prop, F = B.F || _p[16], mass = e.opts && e.opts.mass || 20;
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
    // SNOW-CONTACT: no landing stamp — the two boots press their own prints (the terrain draws them into the snow map)
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

  const ANIM = window.createAnimalGait({ K, clamp, damp, rnd, STATS, smooth, strideSpeed, wrapA, snowDepth, wpos, _p, hasStamp, makeGait, SUB, sfx });   // animal-gait.js
  const { ST, FX, stagUpdate, foxUpdate } = ANIM;
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
    // measure against the hard ground: loose snow off — both the old float (K.snowFloat) and the SNOW-CONTACT drawn-snow
    // surface (K.snowSurface). The latter was added after this test and bypassed its snowFloat switch, so the test read
    // "snow thickness under the boot on the slope minus on the flat spot" (4–9 cm, random with the spots) as IK error.
    // Feet on the DRAWN snow are checked by tools/eye.mjs (feet on the visible surface) and tools/snow-contact.mjs.
    const sfWas = K.snowFloat, ssWas = K.snowSurface; K.snowFloat = 0; K.snowSurface = false;
    try { out.ikOff = await run(false); out.ikOn = await run(true); }
    finally { K.snowFloat = sfWas; K.snowSurface = ssWas; K.ik = true; }
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
  // walk the pilot into the nearest sizeable boulder and measure hand-to-surface IK error once the contact layer
  // settles into its hold (tools/stand.mjs <label> --eval "INTERACTION.testContact()")
  async function testContact() {
    const D = window.DBG; if (!D) return { error: 'needs #dbg' };
    if (!B.ready || (!CT.ready && !contactReady())) return { error: 'contact layer not ready' };
    const P = C.player;
    let best = null;
    for (const e of (C.Passport && C.Passport.list) || []) {
      if (!e.name || !/boulder|rock/i.test(e.name) || !e.box) continue;
      const sx = e.box.max[0] - e.box.min[0], sy = e.box.max[1] - e.box.min[1], sz = e.box.max[2] - e.box.min[2], size = Math.max(sx, sy, sz);
      if (size < 2.0) continue;
      const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, d = Math.hypot(cx - P.x, cz - P.z);
      if (!best || d < best.d) best = { x: cx, z: cz, size, d };
    }
    if (!best) return { error: 'no boulder ≥ 2 m found' };
    // ux,uz points from the boulder OUT to wherever the player already is (so `from` stays clear on that same side);
    // the face must point the other way, back AT the boulder (forward = -sin(face),-cos(face), see contactSense) —
    // i.e. face = atan2(ux, uz), not atan2(-ux,-uz) (that walked the pilot away from the rock, not into it)
    const dx = P.x - best.x, dz = P.z - best.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
    const from = { x: best.x + ux * (best.size * 0.7 + 3.2), z: best.z + uz * (best.size * 0.7 + 3.2) }, fa = Math.atan2(ux, uz);
    await place(from.x, from.z, fa);
    D.keys.KeyW = true;
    const t0 = performance.now();
    while (performance.now() - t0 < 4000 && CT.state !== 'play') await wait(50);
    D.keys.KeyW = false;
    if (CT.state !== 'play') return { error: 'contact never engaged (steered ' + CT.state + ')', wantIntent: CT.wantIntent, playerAt: [+P.x.toFixed(2), +P.z.toFixed(2)], boulderAt: [+best.x.toFixed(2), +best.z.toFixed(2), best.size], sense: CT.sense, ready: CT.ready };
    await wait(1200);   // settle into the held pose (enter clip finished, loop holding)
    const A = C.AV.player, m = CT.meta.clips[A.cur], out = { intent: CT.wantIntent, clip: A.cur, errors: [] };
    if (m && m.contacts) {
      const scale = B.root.getWorldScale(new V3()).x;
      for (const c of m.contacts) {
        if (!c.bone.startsWith('hand')) continue;
        const bone = B.root.getObjectByName(c.bone); if (!bone) continue;
        const wp = wpos(bone, new V3()), hit = contactHit(c); if (!hit) continue;
        const tgt = hit.point.clone().add(hit.normal.clone().multiplyScalar(0.035 * scale));
        out.errors.push({ bone: c.bone, cm: +(wp.distanceTo(tgt) * 100).toFixed(2) });
      }
    }
    out.maxCm = out.errors.length ? Math.max(...out.errors.map((e) => e.cm)) : null;
    out.pass = out.maxCm !== null ? out.maxCm < 3 : null;
    return out;
  }
  // independent self-check: hand-to-VISIBLE-mesh distance, a fresh THREE.Raycaster against the drawn scene from a
  // point safely outside any solid, along the surface normal — NOT the module's own bvhCache/e.geo shortcut, so a
  // bug that makes contactHit() agree with itself (IK reaches its own wrong target) can't hide behind a 0 cm result.
  // Found live: a naive skinned-mesh filter alone still let the ray hit the pilot's OWN rigid attachments (gloves,
  // gear — plain unskinned Meshes parented under the avatar rig sitting right next to the hand) before ever
  // reaching the rock, so every measurement came back "nothing found"; exclude anything under B.root/B.wrap too.
  function isAvatarPart(o) { for (let p = o; p; p = p.parent) if (p === B.root || p === B.wrap) return true; return false; }
  function visibleGap(handWp, normal) {
    try {
      const originOut = handWp.clone().add(normal.clone().multiplyScalar(0.5));
      const rc = new T3.Raycaster(originOut, normal.clone().negate(), 0, 1.2);
      rc.camera = C.camera;   // THREE.Sprite.raycast requires this (glow/fx billboards in the scene); harmless otherwise
      const hits = rc.intersectObjects(C.scene.children, true).filter((h) => !h.object.isSkinnedMesh && !isAvatarPart(h.object) && h.object.visible !== false);
      return hits.length ? +((hits[0].distance - 0.5) * 100).toFixed(2) : null;   // cm: >0 hand hovers off the surface, <0 past/inside it, null = ray found nothing (rare)
    } catch (err) { return null; }
  }
  // like testContact() but walks the pilot into up to `count` DISTINCT nearby solids (different Passport name
  // patterns where possible: procedural rock, scanned rock face, boulder, flat rock, a structure) and reports both
  // metrics per hand — tools/stand.mjs <label> --eval "INTERACTION.testContactSurface()"
  async function testContactSurface(count = 5) {
    const D = window.DBG; if (!D) return { error: 'needs #dbg' };
    if (!B.ready || (!CT.ready && !contactReady())) return { error: 'contact layer not ready' };
    const P = C.player, patterns = [/^rock#/, /^rock_flat/, /^boulder/, /^rock(?!_flat)/i, /kestrel|hab|ruin|st_|wall/i];
    const used = new Set(), targets = [];
    for (const pat of patterns) {
      let best = null;
      for (const e of (C.Passport && C.Passport.list) || []) {
        if (used.has(e.id) || !e.name || !pat.test(e.name) || !e.box) continue;
        const sx = e.box.max[0] - e.box.min[0], sy = e.box.max[1] - e.box.min[1], sz = e.box.max[2] - e.box.min[2], size = Math.max(sx, sy, sz);
        if (size < 2.2) continue;
        const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, d = Math.hypot(cx - P.x, cz - P.z);
        if (!best || d < best.d) best = { id: e.id, name: e.name, x: cx, z: cz, size: +size.toFixed(2), d };
      }
      if (best) { used.add(best.id); targets.push(best); }
      if (targets.length >= count) break;
    }
    const out = [];
    for (const t of targets) {
      const dx = P.x - t.x, dz = P.z - t.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const from = { x: t.x + ux * (t.size * 0.7 + 3.2), z: t.z + uz * (t.size * 0.7 + 3.2) }, fa = Math.atan2(ux, uz);
      await place(from.x, from.z, fa);
      D.keys.KeyW = true;
      const t0 = performance.now();
      while (performance.now() - t0 < 4000 && CT.state !== 'play') await wait(50);
      D.keys.KeyW = false;
      if (CT.state !== 'play') { out.push({ name: t.name, size: t.size, error: 'never engaged (steered ' + CT.state + ')', wantIntent: CT.wantIntent }); continue; }
      // sample repeatedly through the hold instead of one fixed wait: a loop hold (hand_wall_both_loop) stays pinned
      // indefinitely, but a one-shot clip (vault_1m, step_over) only has hand IK active inside its own brief
      // window+blendOut (e.g. 0.36–0.67 s of a 1.6 s clip) — a single measurement taken later just compares the
      // unconstrained tail of the animation to a stale target and reports a huge, meaningless "error". Track, per
      // hand, the SMALLEST error seen across samples (= how well the IK actually converged at its best moment).
      const A = C.AV.player, best = new Map(); let lastClip = A.cur, lastIntent = CT.wantIntent;
      const t1 = performance.now();
      while (performance.now() - t1 < 1500 && CT.state === 'play') {
        const m = CT.meta.clips[A.cur]; lastClip = A.cur; lastIntent = CT.wantIntent;
        if (m && m.contacts) {
          const scale = B.root.getWorldScale(new V3()).x;
          for (const c of m.contacts) {
            if (!c.bone.startsWith('hand')) continue;
            const bone = B.root.getObjectByName(c.bone); if (!bone) continue;
            const wp = wpos(bone, new V3()), hit = contactHit(c); if (!hit) continue;
            const tgt = hit.point.clone().add(hit.normal.clone().multiplyScalar(0.035 * scale));
            const cm = +(wp.distanceTo(tgt) * 100).toFixed(2), gap = visibleGap(wp, hit.normal);
            const prev = best.get(c.bone);
            if (!prev || cm < prev.targetCm) best.set(c.bone, { bone: c.bone, targetCm: cm, visibleGapCm: gap });
          }
        }
        await wait(70);
      }
      const row = { name: t.name, size: t.size, intent: lastIntent, clip: lastClip, hands: [...best.values()] };
      row.maxTargetCm = row.hands.length ? Math.max(...row.hands.map((h) => h.targetCm)) : null;
      row.maxVisibleGapCm = row.hands.length ? Math.max(...row.hands.map((h) => Math.abs(h.visibleGapCm ?? 99))) : null;
      out.push(row);
      contactExit(); await wait(100);
    }
    return out;
  }

  /* ------------------------------------------------------------------ module */
  // switch everything off / on (A/B measurements: tools/stand.mjs --eval "INTERACTION.off()")
  function off() {
    for (const k in SUB) SUB[k] = false;
    CT.state = 'idle'; CT.pick = null; CT.phase = null;
    if (B.wrap) B.wrap.position.set(0, 0, 0);
    for (const [s, S] of ST.per) { S.wrap.position.set(0, 0, 0); S.wrap.quaternion.identity(); if (s.st === 'flee' && S.wroteX !== null) { const l = Math.hypot(s.fx, s.fz) || 1; s.fx /= l; s.fz /= l; } }
    if (FX.wrap) { FX.wrap.position.set(0, 0, 0); FX.wrap.quaternion.setFromAxisAngle(new V3(0, 1, 0), Math.PI); }
    if (ICE.base && C.PH.ch) { C.PH.ch.params.groundAccel = ICE.base.a; C.PH.ch.params.groundDecel = ICE.base.d; }
    return 'interaction off';
  }
  function on() { for (const k in SUB) SUB[k] = true; return 'interaction on'; }
  window.INTERACTION = { off, on, K, SUB, ERR, STATS, AU, B, ST, FX, ICE, CAM, W, CT, RK, layerHands: (a, h, s, sl) => layerHands(a, h, s, sl), rkFront: (x) => rkFront(x), rockTag: (x) => rockTag(x), contactTarget: (c) => contactHit(c), testIK, testWalk, testContact, testContactSurface, strideSpeed: (...a) => strideSpeed(...a), makeGait: (...a) => makeGait(...a), surfaceAt: (x, z) => { const h = hitDown(x, C.groundH(x, z) + 30, z, 60); return surfaceAt(x, h ? h.y : C.groundH(x, z), z, h); } };
  (window.GameModules = window.GameModules || []).push({
    name: 'interaction',
    order: 50,
    init(ctx) {
      C = ctx; T3 = ctx.THREE; setupMath(); ANIM.bind({ C, T3, V3, Q });   // the animals' gait lives in modules/animal-gait.js
      if (window.INTERACT_OFF) { K.passport = false; K.avoid = false; }   // A/B: the pre-INTERACT behaviour (tools/interact/run.mjs --init)
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
      guard('contact', () => contactUpdate(dt));
      guard('world', () => worldUpdate(dt));
      guard('ice', () => ICE.update(dt));
      guard('stags', () => stagUpdate(dt));
      guard('fox', () => foxUpdate(dt));
      guard('camera', () => camUpdate(dt));
      const ms = performance.now() - t0; STATS.frames++; STATS.ms = STATS.ms * 0.95 + ms * 0.05; STATS.msMax = Math.max(STATS.msMax * 0.999, ms);
    },
  });
})();
