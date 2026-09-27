/* lg-snow.js — LOOK-GATE framings for SNOW-CONTACT (injected after lg-page.js): the player's own gameplay camera while
 * walking on open snow, right after a landing and after a roll — the situations the user judged the prints in.
 * Shots return the gameplay camera's pose (camOv = null for ~0.8 s so the real third-person camera settles, then its pose is
 * frozen for the screenshot). The motion strip films the walk with the real gameplay camera following.
 */
(() => {
  const D = window.DBG, LG = window.LG, QA = window.QA, P = D.player;
  const gh = (x, z) => D.groundH(x, z);
  const nearTree = (x, z, r) => D.FOREST.list.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < r * r);
  const land = (x, z) => D.getH(x, z) > 0.6 && !(D.MODCTX.inRift && D.MODCTX.inRift(x, z));
  const slope = (x, z) => (D.MODCTX.slopeAt ? D.MODCTX.slopeAt(x, z, 1) : 0);
  // open flat snow with a walkable 12 m run (k-th such spot, spots ≥ 16 m apart so no take walks over another's prints)
  const spots = () => { const out = [];
    for (let r = 20; r < 150; r += 6) for (let a = 0; a < 6.28; a += 0.3) { const x = D.POI.crash.x + Math.sin(a) * r, z = D.POI.crash.z + Math.cos(a) * r;
      if (!land(x, z) || slope(x, z) > 6 || nearTree(x, z, 20)) continue; const d = D.MODCTX.snowDepthAt ? D.MODCTX.snowDepthAt(x, z) : 0; if (d < 0.06) continue;
      let ok = true; for (let k = 0; k < 12 && ok; k++) { const xx = x + Math.sin(a + 1.2) * k, zz = z + Math.cos(a + 1.2) * k; if (slope(xx, zz) > 8 || !land(xx, zz)) ok = false; }
      if (ok && out.every((q) => Math.hypot(q.x - x, q.z - z) > 16)) out.push({ x, z, dirA: a + 1.2, s: slope(x, z) + r * 0.01 }); }
    return out.sort((p, q) => p.s - q.s); };
  let SP = null; const spot = (k) => { SP = SP || spots(); return SP[Math.min(k, SP.length - 1)]; };
  const start = async (k) => { const s = spot(k), yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); QA.place(s.x, s.z, { yaw }); D.cam.yaw = yaw; await QA.wait(1500); return s; };
  // freeze the real gameplay camera: dist / pitch / yaw offset from the pilot's facing
  const playCam = async (dist, pitch, yawOff) => {
    D.camOv = null; D.cam.dist = dist; D.cam.boom = dist; D.cam.pitch = pitch; D.cam.yaw = P.face + yawOff; D.camera.fov = 62; D.camera.updateProjectionMatrix();
    await QA.wait(800); const c = D.camera, f = new D.THREE.Vector3(); c.getWorldDirection(f);
    return { pos: c.position.toArray(), look: [c.position.x + f.x * 10, c.position.y + f.y * 10, c.position.z + f.z * 10], fov: 62 }; };
  const S = LG.shots, M = LG.motions;
  // 🚶 walked 3 s, stopped: default gameplay camera (7.5 m) turned to see the trail beside the pilot
  S.walk_play = async () => { await start(0); QA.keys(['KeyW'], true); await QA.wait(3000); QA.keys(['KeyW'], false); await QA.wait(1200);
    const c = await playCam(7.5, 0.32, 2.3); return Object.assign(c, { keepPilot: true, note: 'gameplay camera 7.5 m after a 3 s walk, trail beside the pilot' }); };
  // 👢 same, close third person (4.2 m, like the user's screenshots)
  S.walk_close = async () => { await start(1); QA.keys(['KeyW'], true); await QA.wait(2600); QA.keys(['KeyW'], false); await QA.wait(1200);
    const c = await playCam(4.2, 0.42, 2.6); return Object.assign(c, { keepPilot: true, note: 'gameplay camera 4.2 m, boots in their prints + the trail' }); };
  // 🦘 jump while walking, landed: the two boots in their own prints (no crater)
  S.land_play = async () => { await start(2); QA.keys(['KeyW'], true); await QA.wait(900); D.pressed.add('Space'); await QA.wait(450); QA.keys(['KeyW'], false); await QA.wait(1500);
    const c = await playCam(4.2, 0.45, 2.4); return Object.assign(c, { keepPilot: true, note: 'after a running jump, gameplay camera 4.2 m' }); };
  // 🤸 roll: the body's trough
  S.roll_play = async () => { await start(3); QA.keys(['KeyW'], true); await QA.wait(600); D.pressed.add('KeyC'); await QA.wait(900); QA.keys(['KeyW'], false); await QA.wait(1200);
    const c = await playCam(4.5, 0.5, 2.8); return Object.assign(c, { keepPilot: true, note: 'after a roll, gameplay camera 4.5 m' }); };
  // 🎞 walking, filmed by the real gameplay camera following (close third person)
  M.walk_play = { setup() { const s = spot(4), yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); QA.place(s.x, s.z, { yaw }); D.cam.yaw = yaw;
      return { pos: [s.x + 3, gh(s.x, s.z) + 2, s.z + 3], look: [s.x, gh(s.x, s.z) + 1, s.z], fov: 62, only: ['player'], note: 'walk, real gameplay camera 4.2 m following' }; },
    async run() { LG.follow(null); D.camOv = null; D.cam.dist = 4.2; D.cam.boom = 4.2; D.cam.pitch = 0.36; await QA.wait(300); QA.keys(['KeyW'], true); await QA.wait(2600); QA.keys(['KeyW'], false); await QA.wait(500); } };
})();
