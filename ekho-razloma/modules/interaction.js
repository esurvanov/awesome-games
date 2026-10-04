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
  const CONTACT = window.createInteractionContact({ K, B, clamp, STATS, _p, wrapA, wpos });   // interaction-contact.js
  const { CT, rockTag, contactReady, contactHit, contactExit, rkFront, RK, layerHands, contactUpdate } = CONTACT;
  const BODY = window.createInteractionBody({ B, K, clamp, _p, RK, damp, _q, smooth, wpos, SUB, wrapA, solve2, worldDelta, TOUCH, STATS, strideSpeed, wquat, hitDown, snowDepth, up, setWorldQuat });   // interaction-body.js
  const { makeGait, bodyUpdate, PUSH } = BODY;
  const CAMFX = window.createInteractionCamera({ clamp, STATS, K });   // interaction-camera.js
  const { CAM, camUpdate } = CAMFX;
  const GROUND = window.createInteractionGround({ rnd, AU, clamp, B, K, sfx, STATS, inLake, damp, surfaceAt, PUSH, SUB, _p, auOK, hitDown, CAM });   // interaction-ground.js
  const { stepsFromPose, footfall, W, worldUpdate, land, ICE } = GROUND;

  const ANIM = window.createAnimalGait({ K, clamp, damp, rnd, STATS, smooth, strideSpeed, wrapA, snowDepth, wpos, _p, hasStamp, makeGait, SUB, sfx });   // animal-gait.js
  const { ST, FX, stagUpdate, foxUpdate } = ANIM;

  const TESTS = window.createInteractionTests({ CT, B, K, wpos, hitDown, contactReady, contactHit, STATS, contactExit });   // interaction-tests.js
  const { wait, place, testIK, testWalk, testContact, testContactSurface } = TESTS;

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
      C = ctx; T3 = ctx.THREE; setupMath(); ANIM.bind({ C, T3, V3, Q }); TESTS.bind({ C, T3, V3, Q }); CAMFX.bind({ C }); GROUND.bind({ C, T3 }); CONTACT.bind({ C, T3, V3, Q }); BODY.bind({ C, T3, V3, Q, footfall, stepsFromPose });   // the animals' gait and the measurement helpers live in modules/animal-gait.js and interaction-tests.js
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
