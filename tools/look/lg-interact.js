/* lg-interact.js — LOOK-GATE framings for the interaction passport (INTERACT.md), injected after lg-page.js.
 * The pilot really walks up to the object (W held, released when the contact layer takes over), the contact plays, then
 * the shot is taken from the player's own third-person camera (camOv off, real boom, frozen for the screenshot).
 *   pilot_wall  ruin wall (palms / shoulder)   pilot_wreck  the Kestrel      pilot_tree  shoulder on a trunk
 *   pilot_push  pushing a crate / drum (+ motion strip)
 */
(() => {
  const D = window.DBG, LG = window.LG, QA = window.QA, P = D.player, CT = () => window.INTERACTION.CT;
  const gh = (x, z) => D.groundH(x, z);
  const base = (n) => String(n || '').replace(/#\d+$/, '');
  const cen = (e) => e.trunk ? { x: e.trunk.x, z: e.trunk.z } : e.role === 'pushable' && e.debris ? { x: e.debris.mesh.position.x, z: e.debris.mesh.position.z } : { x: (e.box.min[0] + e.box.max[0]) / 2, z: (e.box.min[2] + e.box.max[2]) / 2 };
  const rad = (e) => e.trunk ? e.trunk.r : Math.hypot(e.box.max[0] - e.box.min[0], e.box.max[2] - e.box.min[2]) / 2;
  const entries = (re) => D.Passport.list.filter((e) => e.alive && re.test(base(e.name)) && D.getH(cen(e).x, cen(e).z) > 0.6)
    .sort((a, b) => Math.hypot(cen(a).x - D.POI.crash.x, cen(a).z - D.POI.crash.z) - Math.hypot(cen(b).x - D.POI.crash.x, cen(b).z - D.POI.crash.z));
  const reset = () => { const c = CT(); c.state = 'idle'; c.pick = null; c.plan = null; c.sense = null; c.wantIntent = 'none'; c.senseT = 0.3; };
  // walk at e from angle a: true once the contact is holding (main phase)
  async function walkIn(e, a, want) {
    const c = cen(e), R = rad(e) + 1.9, sx = c.x + Math.sin(a) * R, sz = c.z + Math.cos(a) * R;
    D.teleport(sx, sz, a); P.face = a; P.c.g.rotation.y = a; D.cam.yaw = a; reset(); await QA.wait(900);
    QA.keys(['KeyW'], true); const t0 = performance.now(); let moved = 0, still = 0;
    while (performance.now() - t0 < 3500) { await QA.wait(50); const sp = Math.hypot(P.vx, P.vz); if (sp > 0.8) moved = 1; still = sp < 0.25 && moved ? still + 50 : 0; if (CT().state !== 'idle' || still > 250) break; }
    QA.keys(['KeyW'], false);
    const t1 = performance.now();
    while (performance.now() - t1 < 3500) { await QA.wait(50); const x = CT(); if (x.state === 'play' && x.phase === 'main' && (!want || want.test(x.pick && x.pick.clip || ''))) return true; }
    return false;
  }
  async function engage(re, want, angles = 8, maxEntries = 4) {
    for (const e of entries(re).slice(0, maxEntries)) for (let k = 0; k < angles; k++) { if (await walkIn(e, k / angles * Math.PI * 2 + 0.3, want)) return e; }
    return null;
  }
  const playCam = async (dist, pitch, yawOff) => {
    D.camOv = null; D.cam.dist = dist; D.cam.boom = dist; D.cam.pitch = pitch; D.cam.yaw = P.face + yawOff; D.camera.fov = 62; D.camera.updateProjectionMatrix();
    await QA.wait(900); const c = D.camera, f = new D.THREE.Vector3(); c.getWorldDirection(f);
    return { pos: c.position.toArray(), look: [c.position.x + f.x * 10, c.position.y + f.y * 10, c.position.z + f.z * 10], fov: 62, keepPilot: true }; };
  const S = LG.shots, M = LG.motions;
  const shot = (re, want, note, yawOff = 2.5, dist = 4.2) => async () => {
    const e = await engage(re, want); if (!e) return { skip: 'contact never engaged on ' + re };
    await QA.wait(600); const r = await playCam(dist, 0.3, yawOff);
    return Object.assign(r, { note: `${note}: ${e.name}, ${CT().pick && CT().pick.clip}` }); };
  S.lean_wall = shot(/^st_ruin_wall$|^st_ruin_arch$/, /hand_wall|lean_shoulder|ledge/, 'palms / shoulder on the ruin wall');
  S.lean_wreck = shot(/^kestrel(_wing|_tail)?$/, null, 'contact on the Kestrel wreck');
  S.lean_tree = shot(/^tree_(dead_birch|snag_dead|spruce_tall_snow|fir_windbent)$/, /lean_shoulder|hand_wall/, 'shoulder / palm on a trunk', 2.0);
  // pushing: W held into a crate / drum by the station; frozen mid-push
  S.push_crate = async () => {
    const L = entries(/^(crate_wood_02|drum_blue|prop_crate_military|crate_wood|prop_barrel_01|barrel_steel)$/); if (!L.length) return { skip: 'no pushable' };
    const e = L[0], c = cen(e), a = 0.6, R = rad(e) + 1.6;
    D.teleport(c.x + Math.sin(a) * R, c.z + Math.cos(a) * R, a); P.face = a; D.cam.yaw = a; reset(); await QA.wait(900);
    QA.keys(['KeyW'], true); await QA.wait(1500);
    D.camOv = null; D.cam.dist = 4.2; D.cam.boom = 4.2; D.cam.pitch = 0.3; D.cam.yaw = P.face + 2.2; await QA.wait(500);
    QA.keys(['KeyW'], false);
    const cm = D.camera, f = new D.THREE.Vector3(); cm.getWorldDirection(f);
    return { pos: cm.position.toArray(), look: [cm.position.x + f.x * 10, cm.position.y + f.y * 10, cm.position.z + f.z * 10], fov: 62, keepPilot: true, note: 'pushing ' + e.name + ', hands ' + (window.INTERACTION.B.arms.mode || '-') };
  };
  M.pilot_push = { setup() {
      const L = entries(/^(crate_wood_02|drum_blue|prop_crate_military|crate_wood)$/); if (!L.length) return { skip: 'no pushable' };
      const e = L[L.length > 1 ? 1 : 0], c = cen(e), a = 2.2, R = rad(e) + 1.4; this.e = e;
      D.teleport(c.x + Math.sin(a) * R, c.z + Math.cos(a) * R, a); P.face = a; D.cam.yaw = a; reset();
      const rx = Math.cos(a), rz = -Math.sin(a), pos = [c.x + Math.sin(a) * R + rx * 3.5, gh(c.x, c.z) + 1.6, c.z + Math.cos(a) * R + rz * 3.5];
      return { pos, look: [c.x, gh(c.x, c.z) + 0.6, c.z], fov: 50, only: ['player'], follow: () => [P.x, P.y + 0.8, P.z], note: 'pushes ' + e.name + ' across the snow' }; },
    async run() { await QA.wait(300); QA.keys(['KeyW'], true); await QA.wait(2600); QA.keys(['KeyW'], false); await QA.wait(1200); } };
})();
