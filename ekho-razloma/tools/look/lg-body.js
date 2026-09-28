/* lg-body.js — LOOK-GATE framings for PHYSBODY (injected after lg-page.js): the pilot's body reacting physically — a stop
 * from a jog, a shoulder grazing a rock, a shardling's hit, a fall from a ledge + getting up, a walk across a 25° slope.
 * Everything is filmed by the REAL gameplay camera (camOv = null, third person, following), like the player sees it.
 * Motion strips here are longer than the default take (fall + get-up is ~4 s): LG.take gets per-motion record options.
 */
(() => {
  const D = window.DBG, LG = window.LG, QA = window.QA, P = D.player, PB = window.PHYSBODY;
  const S = LG.shots, M = LG.motions;
  const gh = (x, z) => D.groundH(x, z);
  const origTake = LG.take;
  LG.take = (name, o = {}) => origTake(name, Object.assign({}, M[name] && M[name].rec, o));
  // the gameplay camera, `dist` m behind, turned `yawOff` from the pilot's facing (0 = straight behind)
  const playCam = (dist, pitch, yawOff) => { LG.follow(null); D.camOv = null; D.cam.dist = dist; D.cam.boom = dist; D.cam.pitch = pitch; D.cam.yaw = P.face + yawOff; D.camera.fov = 62; D.camera.updateProjectionMatrix(); };
  const frozen = async () => { await QA.wait(700); const c = D.camera, f = new D.THREE.Vector3(); c.getWorldDirection(f);
    return { pos: c.position.toArray(), look: [c.position.x + f.x * 10, c.position.y + f.y * 10, c.position.z + f.z * 10], fov: 62, keepPilot: true }; };
  const put = (x, z, yaw, y) => { D.teleport(x, z, yaw, y); P.face = yaw; P.c.g.rotation.y = yaw; D.cam.yaw = yaw; };
  const initial = () => ({ pos: [P.x + 3, P.y + 2, P.z + 3], look: [P.x, P.y + 1, P.z], fov: 62, only: ['player'] });

  // 🛑 jog on open snow, let go of W: planted boots hold, one settle step, the chest sways
  const stopSetup = (k) => { const s = PB.flatSpot(4 + k); put(s.x, s.z, 0.9); return Object.assign(initial(), { note: 'jog 1.4 s → stop, gameplay camera 4.5 m from the side' }); };
  M.body_stop = { rec: { every: 6, max: 20 }, setup() { return stopSetup(0); },
    async run() { playCam(4.5, 0.3, 1.9); await QA.wait(300); QA.keys(['KeyW'], true); await QA.wait(1400); QA.keys(['KeyW'], false); await QA.wait(1500); } };
  S.body_stop_end = async () => { stopSetup(1); await QA.wait(1300); QA.keys(['KeyW'], true); await QA.wait(1400); QA.keys(['KeyW'], false); await QA.wait(900); playCam(3.6, 0.35, 1.9); return Object.assign(await frozen(), { note: '0.9 s after the stop, side, 3.6 m' }); };

  // 🪨 walk into a wall-like rock face / wall at 30°: the capsule slides along it, the near shoulder and arm meet it
  const bumpSetup = () => { const w = PB.findWall(); if (!w) return null; put(w.x, w.z, w.yaw); return w; };
  M.body_bump = { rec: { every: 5, max: 20 }, setup() { return bumpSetup() ? Object.assign(initial(), { note: 'walks past a rock, the shoulder grazes it; gameplay camera behind-side 4 m' }) : { skip: 'no rock' }; },
    async run() { playCam(4, 0.28, -0.7); await QA.wait(300); QA.keys(['KeyW'], true); await QA.wait(2200); QA.keys(['KeyW'], false); await QA.wait(700); } };
  S.body_bump_end = async () => { if (!bumpSetup()) return { skip: 'no rock' }; await QA.wait(1300); QA.keys(['KeyW'], true); await QA.wait(1100); P.aimT = 0; D.G.pause = true; playCam(3.4, 0.25, -0.9); D.G.pause = false; const r = await frozen(); QA.keys(['KeyW'], false); return Object.assign(r, { note: 'mid-graze, behind-side 3.4 m' }); };

  // 👊 a shardling comes and hits (the game's own attack): upper body knocked back, recovers
  let foe = null;
  const pushSetup = () => { const s = PB.flatSpot(6); put(s.x, s.z, 0.4); D.enemies.forEach((q) => { if (!q.dead && Math.hypot(q.x - s.x, q.z - s.z) < 25) { q.st = 'idle'; q.x = q.hx; q.z = q.hz; } }); P.hp = 99; P.inv = 0; D.G.safeUntil = 0;
    if (foe) { foe.dead = true; foe.g.visible = false; } foe = D.spawnShardling(s.x - Math.sin(0.4) * 3.2, s.z - Math.cos(0.4) * 3.2, null); foe.st = 'chase'; return s; };
  const pushEnd = () => { if (foe) { foe.dead = true; foe.g.visible = false; foe.st = 'idle'; foe = null; } P.hp = P.hpMax; };
  M.body_push = { rec: { every: 4, max: 20 }, setup() { if (!D.spawnShardling) return { skip: 'no spawnShardling' }; pushSetup(); return Object.assign(initial(), { note: 'a shardling runs in and hits; side camera 4.2 m' }); },
    async run() { playCam(4.6, 0.26, 0.55); const lh = P.lastHurt, t0 = performance.now(); while (performance.now() - t0 < 5000 && P.lastHurt === lh) await QA.wait(30); await QA.wait(1100); pushEnd(); } };
  S.body_push_end = async () => { if (!D.spawnShardling) return { skip: 'no spawnShardling' }; pushSetup(); playCam(4.2, 0.26, 0.55); const lh = P.lastHurt, t0 = performance.now();
    while (performance.now() - t0 < 5000 && P.lastHurt === lh) await QA.wait(20); await QA.wait(120); D.G.pause = true; const r = await frozen(); D.G.pause = false; pushEnd(); return Object.assign(r, { note: '0.12 s after the hit (peak of the knock-back)' }); };

  // 🪂 walk off a ledge ≥ 5.6 m (a rock / structure top) → ragdoll → get up; no such ledge: a 7.5 m drop
  const fallSetup = () => { const L = PB.findLedge(5.6);
    if (L) { const yaw = Math.atan2(-Math.sin(L.dirA), -Math.cos(L.dirA)); put(L.x, L.z, yaw); return { note: `walks off ${L.name} (${L.drop.toFixed(1)} m drop) → ragdoll → get up`, ledge: true }; }
    const s = PB.flatSpot(7); put(s.x, s.z, 0.3, gh(s.x, s.z) + 7.5); return { note: 'dropped from 7.5 m (no ledge found) → ragdoll → get up', ledge: false }; };
  M.body_fall = { rec: { every: 10, max: 24 }, setup() { this.f = fallSetup(); return Object.assign(initial(), { note: this.f.note }); },
    async run() { playCam(5.5, 0.35, 1.2); if (this.f.ledge) QA.keys(['KeyW'], true); const t0 = performance.now();
      while (performance.now() - t0 < 3000 && !PB.RG.st) await QA.wait(30); QA.keys(['KeyW'], false);
      while (performance.now() - t0 < 8000 && PB.RG.st) await QA.wait(50); await QA.wait(400); } };
  S.body_fall_end = async () => { const f = fallSetup(); playCam(4.5, 0.4, 1.2); if (f.ledge) QA.keys(['KeyW'], true); const t0 = performance.now();
    while (performance.now() - t0 < 3000 && !PB.RG.st) await QA.wait(20); QA.keys(['KeyW'], false);
    while (performance.now() - t0 < 5000 && (PB.RG.st === 'rag' || PB.RG.st === 'roll')) await QA.wait(20);   // the moment the ragdoll lies still
    D.G.pause = true; playCam(4, 0.5, 1.2); const r = await frozen(); D.G.pause = false; while (PB.RG.st) await QA.wait(50);
    return Object.assign(r, { note: 'ragdoll at rest, just before the get-up · ' + f.note }); };

  // ⛰ walk across a 25° slope (foot IK + snow surface)
  const slopeSetup = () => { const s = PB.findSlope(25); if (!s) return null; put(s.x, s.z, s.upYaw + Math.PI / 2); return s; };
  M.body_slope = { rec: { every: 5, max: 20 }, setup() { return slopeSetup() ? Object.assign(initial(), { note: 'walks across a 25° slope, camera downhill side 4.5 m' }) : { skip: 'no 25° slope' }; },
    async run() { playCam(4.5, 0.2, -1.5); await QA.wait(300); QA.keys(['KeyW'], true); await QA.wait(1800); QA.keys(['KeyW'], false); await QA.wait(900); } };
  S.body_slope_end = async () => { if (!slopeSetup()) return { skip: 'no 25° slope' }; await QA.wait(1300); QA.keys(['KeyW'], true); await QA.wait(1500); QA.keys(['KeyW'], false); await QA.wait(900); playCam(3.4, 0.15, -1.5);
    return Object.assign(await frozen(), { note: 'standing on the 25° slope after walking across, downhill side' }); };
})();
