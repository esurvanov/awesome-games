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
  const playCam = async (dist, pitch, yaw) => {
    D.camOv = null; D.cam.dist = dist; D.cam.boom = dist; D.cam.pitch = pitch; D.cam.yaw = yaw; D.camera.fov = 62; D.camera.updateProjectionMatrix();
    await QA.wait(900); const c = D.camera, f = new D.THREE.Vector3(); c.getWorldDirection(f);
    return { pos: c.position.toArray(), look: [c.position.x + f.x * 10, c.position.y + f.y * 10, c.position.z + f.z * 10], fov: 62, keepPilot: true }; };
  const S = LG.shots, M = LG.motions;
  // Camera yaw is `D.cam.yaw`, the azimuth from the pilot TO the camera (camera = look + boom·(sin yaw, …, cos yaw),
  // open-world.html updateCamera) — so a yaw close to the object's own bulk direction puts the camera INSIDE that bulk
  // regardless of `dist`; more boom distance just fails further out (tried, see git history: bigger dist/pitch for
  // lean_wreck/lean_tree did not fix it, because the old `P.face + yawOff` anchor measures the offset from the pilot's
  // facing — which points INTO the object during a lean/touch — so an offset that "feels" like a 3/4 turn can still
  // land well inside the object's silhouette for anything wider than a person (Kestrel hull, tree canopy).
  // Fix: anchor yaw on the direction AWAY from the object's own bulk (the touched surface's own outward normal, or
  // failing that the object-centre→pilot line) plus a small lateral swing for a 3/4 angle, and pick whichever swing
  // side (left/right of "away") ends up with the camera farther from the object's centre.
  const away = (e) => { const c = cen(e), n = CT().plan && CT().plan.normal; if (n && (n.x || n.z)) return Math.atan2(n.x, n.z); return Math.atan2(P.x - c.x, P.z - c.z); };
  const clearance = (e, yaw, dist) => { const c = cen(e), x = P.x + Math.sin(yaw) * dist, z = P.z + Math.cos(yaw) * dist; return Math.hypot(x - c.x, z - c.z); };
  const shot = (re, want, note, lateral = 0.6, dist = 4.2, pitch = 0.3) => async () => {
    const e = await engage(re, want); if (!e) return { skip: 'contact never engaged on ' + re };
    await QA.wait(600);
    const a = away(e), y1 = a + lateral, y2 = a - lateral;
    const yaw = clearance(e, y1, dist) >= clearance(e, y2, dist) ? y1 : y2;
    const r = await playCam(dist, pitch, yaw);
    return Object.assign(r, { note: `${note}: ${e.name}, ${CT().pick && CT().pick.clip}` }); };
  S.lean_wall = shot(/^st_ruin_wall$|^st_ruin_arch$/, /hand_wall|lean_shoulder|ledge/, 'palms / shoulder on the ruin wall');
  S.lean_wreck = shot(/^kestrel(_wing|_tail)?$/, null, 'contact on the Kestrel wreck', 0.5, 6.5, 0.4);
  // NATURE: a conifer's canopy is wide *and* wraps down near the ground from every direction *and* overhead, so no
  // single horizontal yaw steers the boom clear of it (INTERACT.md "Next wave") — tried, didn't fix `lean_tree`, only
  // `lean_wreck` (a hull is wide but low; a canopy is wide and tall). dead_birch / snag_dead are bare, sparse-branch
  // trees with a clear trunk and no low canopy to block the boom — same "shoulder/palm on a trunk" contact, camera
  // actually gets a clean shot. spruce_tall_snow / fir_windbent dropped from this shot's own tree pool (still used
  // elsewhere; nothing else reads this regex).
  S.lean_tree = shot(/^tree_(dead_birch|snag_dead)$/, /lean_shoulder|hand_wall/, 'shoulder / palm on a trunk', 0.5, 4.0, 0.15);
  // pushing: W held into a crate / drum by the station; frozen mid-push. Was one fixed angle (a = 0.6) — missed every
  // engaging side on a given instance (INTERACT.md: crate_wood engages only 2/4 approach angles, unrelated to this
  // camera code); retries several angles / entries the same way `engage()` does for the other subjects, but the success
  // condition is the push mechanic itself (arms.mode 'push', not the CT contact layer, which pushables never use).
  async function walkInPush(e, a) {
    const c = cen(e), R = rad(e) + 1.6, sx = c.x + Math.sin(a) * R, sz = c.z + Math.cos(a) * R;
    D.teleport(sx, sz, a); P.face = a; P.c.g.rotation.y = a; D.cam.yaw = a; reset(); await QA.wait(700);
    QA.keys(['KeyW'], true); const t0 = performance.now(); const Aa = window.INTERACTION.B.arms;
    while (performance.now() - t0 < 2200) { await QA.wait(50); if (Aa.mode === 'push' && Aa.w > 0.5) return true; }
    QA.keys(['KeyW'], false); await QA.wait(200);
    return false;
  }
  async function engagePush(re, angles = 8, maxEntries = 3) {
    for (const e of entries(re).slice(0, maxEntries)) for (let k = 0; k < angles; k++) { if (await walkInPush(e, k / angles * Math.PI * 2 + 0.3)) return e; QA.keys(['KeyW'], false); }
    return null;
  }
  const PUSHABLE_RE = /^(crate_wood_02|drum_blue|prop_crate_military|crate_wood|prop_barrel_01|barrel_steel|prop_crate_wood)$/;
  S.push_crate = async () => {
    const e = await engagePush(PUSHABLE_RE); if (!e) return { skip: 'push never engaged on ' + PUSHABLE_RE };
    await QA.wait(600); QA.keys(['KeyW'], true); await QA.wait(500);
    D.camOv = null; D.cam.dist = 4.2; D.cam.boom = 4.2; D.cam.pitch = 0.3; D.cam.yaw = P.face + 2.2; D.camera.fov = 62; D.camera.updateProjectionMatrix(); await QA.wait(500);
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
