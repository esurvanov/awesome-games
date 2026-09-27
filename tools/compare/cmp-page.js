/* cmp-page.js — before/after shot scripts (window.CMP), injected into BOTH builds after the game has loaded.
 * Uses only DBG hooks that exist in the old published build (63b9ea8) as well as in HEAD: teleport, cam, keys,
 * pressed, Dialog, WORLD, POI, FOREST, STAGS, targets.boulders, Passport.passablesNear, MODCTX.fpMesh.
 * Every shot uses the player's own third-person follow camera (DBG.camOv stays null); only its distance / pitch /
 * yaw are set like a player would with the mouse. Inputs are real key state (DBG.keys / DBG.pressed).
 *   CMP.shots.<name> = { setup() → info, async run() → info, post() → info (camera for the "after" still) }
 */
(() => {
  const D = window.DBG, C = D.MODCTX, P = D.player, POI = D.POI, W = D.WORLD;
  const CMP = window.CMP = { shots: {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gh = (x, z) => D.groundH(x, z);
  const slope = (x, z) => (C.slopeAt ? C.slopeAt(x, z, 1) : 0);
  const land = (x, z) => D.getH(x, z) > 0.6 && !(C.inRift && C.inRift(x, z));
  const treeDist = (x, z) => { let m = 1e9; for (const t of D.FOREST.list) { const d = (t[0] - x) ** 2 + (t[2] - z) ** 2; if (d < m) m = d; } return Math.sqrt(m); };
  const bouldersList = () => (D.targets && D.targets.boulders ? D.targets.boulders().list : []);
  const rockDist = (x, z) => { let m = 1e9; for (const b of bouldersList()) m = Math.min(m, Math.hypot(b.x - x, b.z - z) - b.s); return m; };
  // open flat snow: walkable, flat, away from trees and rocks
  const openSpot = (x, z, a = 0, maxSlope = 7) => {
    for (let k = 0; k < 80; k++) { const aa = a + k * 0.61, dd = (k >> 3) * 4, sx = x + Math.sin(aa) * dd, sz = z + Math.cos(aa) * dd;
      if (land(sx, sz) && slope(sx, sz) < maxSlope && treeDist(sx, sz) > 14 && rockDist(sx, sz) > 8) return { x: sx, z: sz }; }
    return { x, z };
  };
  CMP.cam0 = { dist: D.cam.dist, pitch: D.cam.pitch };
  // same preset in both builds: the AI frame-rate governor may drop quality on a slow frame (or because of our own capture)
  CMP.qualityAuto = (D.Q && D.Q.name) || null;
  CMP.lockQuality = (q = 'high') => { if (window.AI && AI.quality && AI.quality.set) AI.quality.set(q, 1e7); else if (D.setQuality) D.setQuality(q); return D.Q && D.Q.name; };
  CMP.closeDialogs = () => { let n = 0; while (D.Dialog.active && n++ < 40) { D.Dialog.choosing = false; if (D.Dialog.close) D.Dialog.close(); else D.Dialog.active = false; }
    D.Dialog.active = false; const el = document.getElementById('dialog'); if (el) el.hidden = true; };
  CMP.calm = () => { if (D.WX) { D.WX.storm = 0; D.WX.target = 0; D.WX.t = 9999; } D.G.pause = false; const p = document.getElementById('pause'); if (p) p.hidden = true; CMP.closeDialogs(); };
  CMP.release = () => { for (const k in D.keys) D.keys[k] = false; };
  const keys = (l, on) => { for (const k of [].concat(l)) D.keys[k] = !!on; };
  const tap = (code) => { D.pressed.add(code); };
  // teleport + face `yaw` (camera sits behind at +yaw), camera distance / pitch like the mouse wheel / mouse would
  CMP.place = (x, z, yaw, o = {}) => {
    CMP.release(); CMP.calm(); D.camOv = null;
    const f = CMP.fix; if (f && f.x != null) { x = f.x; z = f.z; yaw = f.yaw; }   // the AFTER build stands exactly where the BEFORE build stood
    D.teleport(x, z, yaw); P.face = yaw; P.vx = P.vz = 0;
    D.cam.dist = o.dist || CMP.cam0.dist; D.cam.boom = D.cam.dist; D.cam.pitch = o.pitch !== undefined ? o.pitch : CMP.cam0.pitch;
    return { x: +x.toFixed(2), z: +z.toFixed(2), yaw: +yaw.toFixed(3) };
  };
  const yawTo = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);   // stand at (x,z), face (tx,tz)
  CMP.info = () => ({ quality: (D.Q && D.Q.name) || null, qualityAuto: CMP.qualityAuto, crash: [POI.crash.x, POI.crash.z], cam0: CMP.cam0, trees: D.FOREST.list.length, stags: D.STAGS.length,
    contactLayer: !!(window.INTERACTION && window.INTERACTION.CT), T: +C.T.toFixed(2) });
  // flat footprint decals born since t0 (old stamp system; HEAD presses real geometry instead and stamps none)
  const decalsSince = (t0) => { const m = C.fpMesh; if (!m) return null; const a = m.geometry.attributes.aBorn; if (!a) return null; let n = 0; for (const v of a.array) if (v >= t0) n++; return n; };
  const S = CMP.shots;

  /* 1a — walk on open snow, follow camera: the trail is in the foreground */
  S.snow_walk = {
    setup() { const s = openSpot(POI.crash.x - 12, POI.crash.z + 30, 0.3); this.s = s; this.T0 = C.T; return CMP.place(s.x, s.z, 0.6); },
    async run() { await wait(300); keys('KeyW', true); await wait(3000); keys('KeyW', false); await wait(900); return { walkedM: +Math.hypot(P.x - this.s.x, P.z - this.s.z).toFixed(1), decals: decalsSince(this.T0) }; },
    post() { D.cam.yaw = P.face + Math.PI; D.cam.pitch = 0.5; D.cam.dist = 6; D.cam.boom = 6; return { note: 'camera swung to look back along the trail' }; },
  };
  /* 1b — boots close-up while walking, then standing */
  S.boots = {
    setup() { const s = openSpot(POI.crash.x + 20, POI.crash.z + 45, 1.2); this.s = s; this.T0 = C.T; const r = CMP.place(s.x, s.z, 1.4, { dist: 2.6, pitch: 0.62 }); return r; },
    async run() { await wait(300); keys('KeyW', true); await wait(2400); keys('KeyW', false); await wait(1200); return { decals: decalsSince(this.T0) }; },
    post() { D.cam.yaw = P.face + 1.35; D.cam.dist = 3.0; D.cam.boom = 3.0; D.cam.pitch = 0.95; return { pitch: D.cam.pitch }; },
  };
  /* 2 — jump landing + roll on snow, then look at what is left */
  S.jump_roll = {
    setup() { const s = openSpot(POI.crash.x - 35, POI.crash.z + 55, 2.0); this.s = s; this.T0 = C.T; return CMP.place(s.x, s.z, 2.1, { pitch: 0.4 }); },
    async run() { await wait(300); keys('KeyW', true); await wait(500); tap('Space'); await wait(1100); keys('KeyW', false); await wait(500);
      keys('KeyW', true); await wait(60); tap('KeyC'); await wait(700); keys('KeyW', false); await wait(900); return { decals: decalsSince(this.T0) }; },
    post() { D.cam.yaw = P.face + 2.7; D.cam.pitch = 0.62; D.cam.dist = 6; D.cam.boom = 6; return { note: 'looking back at the landing + roll marks' }; },
  };
  /* 3 — walk into a big boulder until the contact pose engages */
  const bigBoulder = () => { let b = null; for (const c of bouldersList()) { if (c.s < 2.4) continue; const d = Math.hypot(c.x - POI.crash.x, c.z - POI.crash.z); if (!b || d < b.d) b = Object.assign({ d }, c); } return b; };
  S.boulder_lean = {
    setup() { const b = bigBoulder(); if (!b) return { skip: 'no boulder' }; this.b = b;
      // approach from the flattest side, ~s*0.9+3 m out
      let best = null; for (let a = 0; a < 6.28; a += 0.26) { const r = b.s * 0.9 + 3, x = b.x + Math.sin(a) * r, z = b.z + Math.cos(a) * r; if (!land(x, z)) continue; const sl = slope(x, z); if (!best || sl < best.sl) best = { x, z, sl, a }; }
      const r = CMP.place(best.x, best.z, yawTo(best.x, best.z, b.x, b.z), { dist: 5.5, pitch: 0.28 }); r.boulder = [+b.x.toFixed(1), +b.z.toFixed(1), +b.s.toFixed(2)]; return r; },
    async run() { const CT = window.INTERACTION && window.INTERACTION.CT; await wait(300); keys('KeyW', true); const t0 = performance.now(); let engaged = false;
      while (performance.now() - t0 < 4000) { await wait(50); if (CT && CT.state === 'play') { engaged = true; break; } }
      keys('KeyW', false); if (!CT) await wait(0); await wait(1600);
      return { contactEngaged: CT ? engaged : 'no contact layer in this build', clip: CT && CT.pick ? CT.pick.clip : null, distToRock: +(Math.hypot(P.x - this.b.x, P.z - this.b.z) - this.b.s).toFixed(2) }; },
    post() { // a little to the side of the approach path (the camera came that way, so it is outside the rock in both builds; the old build has no camera collision)
      D.cam.yaw = P.face + 0.35; D.cam.dist = 5.5; D.cam.boom = 5.5; D.cam.pitch = 0.32; return { yawOff: 0.35 }; },
  };
  /* 4a — rock close-up: snow on top, where it meets the ground */
  S.rock_close = {
    setup() { const B = bouldersList().filter((c) => c.s >= 1.6 && c.s < 3.2); let b = null; for (const c of B) { const d = Math.hypot(c.x - POI.crash.x + 40, c.z - POI.crash.z - 10); if (!b || d < b.d) b = Object.assign({ d }, c); }
      if (!b) return { skip: 'no rock' }; let best = null; for (let a = 0; a < 6.28; a += 0.26) { const r = b.s + 2.2, x = b.x + Math.sin(a) * r, z = b.z + Math.cos(a) * r; if (!land(x, z)) continue; const sl = slope(x, z); if (!best || sl < best.sl) best = { x, z, sl }; }
      // pilot stands beside the rock, camera close and a bit high so the rock top and its base are both in frame
      const y = yawTo(best.x, best.z, b.x, b.z) + 0.55; const r = CMP.place(best.x, best.z, y, { dist: 3.4, pitch: 0.36 }); r.rock = [+b.x.toFixed(1), +b.z.toFixed(1), +b.s.toFixed(2)]; return r; },
  };
  /* 4b — tufts / heather close */
  const bestVeg = (kind, cx, cz, R = 90) => { let best = null; for (let i = -R; i <= R; i += 6) for (let j = -R; j <= R; j += 6) { const x = cx + i, z = cz + j; if (!land(x, z) || slope(x, z) > 18 || treeDist(x, z) < 8) continue;
    const n = D.Passport.passablesNear(x, z, 4, []).filter((p) => !kind || p.kind === kind).length; if (!best || n > best.n) best = { x, z, n }; } return best; };
  S.tufts = {
    setup() { const g = bestVeg(null, POI.crash.x, POI.crash.z) || { x: POI.crash.x, z: POI.crash.z + 20, n: 0 }; this.g = g; const r = CMP.place(g.x, g.z, 1.1, { dist: 3.6, pitch: 0.42 }); r.vegIn4m = g.n; return r; },
    async run() { await wait(300); keys('KeyW', true); await wait(1800); keys('KeyW', false); await wait(700); return {}; },
    post() { D.cam.yaw = P.face + 0.9; return {}; },
  };
  /* 5a — forest edge: start ~14 m from the nearest tree, walk in */
  const fcen = () => { const L = D.FOREST.list; let sx = 0, sz = 0; for (const t of L) { sx += t[0]; sz += t[2]; } return { x: sx / L.length, z: sz / L.length }; };
  S.forest_edge = {
    setup() { const c = fcen(), a = Math.atan2(c.x - POI.crash.x, c.z - POI.crash.z); let x = POI.crash.x, z = POI.crash.z;
      for (let d = 0; d < 600; d += 2) { x = POI.crash.x + Math.sin(a) * d; z = POI.crash.z + Math.cos(a) * d; if (treeDist(x, z) < 14 && land(x, z)) break; }
      const r = CMP.place(x, z, yawTo(x, z, c.x, c.z), { pitch: 0.12 }); r.nearestTreeM = +treeDist(x, z).toFixed(1); return r; },
    async run() { await wait(300); keys('KeyW', true); const t0 = performance.now(); while (performance.now() - t0 < 3000 && treeDist(P.x, P.z) > 6) await wait(30); keys('KeyW', false); await wait(700); return { nearestTreeM: +treeDist(P.x, P.z).toFixed(1) }; },
    post() { return { nearestTreeM: +treeDist(P.x, P.z).toFixed(1) }; },
  };
  /* 5b — mid forest: the densest patch */
  S.forest_mid = {
    setup() { const L = D.FOREST.list; let best = L[0], bn = -1; for (let i = 0; i < L.length; i += 3) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 400) n++; if (n > bn) { bn = n; best = t; } }
      let x = best[0] + 2.5, z = best[2] + 2.5; for (let k = 0; k < 20 && !land(x, z); k++) { x += 1; z += 1; }
      const r = CMP.place(x, z, 0.8, { pitch: 0.14 }); r.treesIn20m = bn; return r; },
    async run() { await wait(300); keys('KeyW', true); await wait(2600); keys('KeyW', false); await wait(500); return {}; },
  };
  /* 6 — station camp at Orm's fire: stand by the fire, slow camera turn over 5 s (black-frame hunt) */
  S.station_fire = {
    setup() { const f = W.stationW(3, 11), st = W.stationW(0, 0), a = Math.atan2(f.x - st.x, f.z - st.z), x = f.x + Math.sin(a) * 6, z = f.z + Math.cos(a) * 6;
      const r = CMP.place(x, z, yawTo(x, z, st.x, st.z), { pitch: 0.2 }); r.fire = [+f.x.toFixed(1), +f.z.toFixed(1)]; return r; },
    async run() { const y0 = D.cam.yaw, t0 = performance.now(); while (performance.now() - t0 < 5000) { D.cam.yaw = y0 + Math.sin((performance.now() - t0) / 5000 * Math.PI * 2) * 0.9; await wait(16); } D.cam.yaw = y0; return {}; },
  };
  /* 8 — stags: walk at the herd until it flees */
  S.stags = {
    setup() { const s0 = D.STAGS.filter((s) => land(s.x, s.z)).sort((a, b) => Math.hypot(a.x - POI.crash.x, a.z - POI.crash.z) - Math.hypot(b.x - POI.crash.x, b.z - POI.crash.z))[0] || D.STAGS[0];
      if (!s0) return { skip: 'no stags' }; this.s0 = s0; CMP.fix = null;   // stags wander: framed relative to the stag, not a fixed spot
      for (const s of D.STAGS) if (s.st === 'flee') { s.st = 'graze'; s.t = 3; }
      // a clear line of sight: pilot on open flat snow 34 m out, camera spot free of trees, terrain below the eye line to the stag
      let x = s0.x + 30, z = s0.z, bestS = -1;
      for (let a = 0; a < 6.28; a += 0.13) { const dx = Math.sin(a), dz = Math.cos(a), xx = s0.x + dx * 30, zz = s0.z + dz * 30, cx = s0.x + dx * 35.5, cz = s0.z + dz * 35.5;
        if (!land(xx, zz) || slope(xx, zz) > 12 || treeDist(xx, zz) < 6 || treeDist(cx, cz) < 5 || rockDist(cx, cz) < 2) continue;
        const ey = gh(cx, cz) + 2.6, sy = gh(s0.x, s0.z) + 1; let ok = true, minGap = 1e9;
        for (let t = 0.05; t < 0.97; t += 0.03) { const px = cx + (s0.x - cx) * t, pz = cz + (s0.z - cz) * t, gap = ey + (sy - ey) * t - gh(px, pz); if (gap < 0.4 || treeDist(px, pz) < 1.5) { ok = false; break; } minGap = Math.min(minGap, gap); }
        if (ok && minGap > bestS) { bestS = minGap; x = xx; z = zz; } }
      const r = CMP.place(x, z, yawTo(x, z, s0.x, s0.z) + 0.22, { pitch: 0.1, dist: 5.5 }); r.stag = [+s0.x.toFixed(1), +s0.z.toFixed(1), s0.st]; return r; },
    // the pilot walks at the herd until it flees; the CLIP then uses the one noted exception to the player's camera: a
    // tracking camera 7 m beside the stag (at 30 m the player's camera shows a stag a few pixels tall — no gait to judge)
    async run() { const s0 = this.s0; D.cam.yaw = yawTo(P.x, P.z, s0.x, s0.z) + 0.22; P.face = D.cam.yaw;
      const ux = s0.x - P.x, uz = s0.z - P.z, ul = Math.hypot(ux, uz) || 1, px = -uz / ul, pz = ux / ul;   // perpendicular to pilot → stag
      const side = gh(s0.x + px * 7, s0.z + pz * 7) < gh(s0.x - px * 7, s0.z - pz * 7) ? 1 : -1;       // the lower side: no hill in the lens
      let track = true; const follow = async () => { while (track) { const y = gh(s0.x, s0.z); const cx = s0.x + px * 8 * side, cz = s0.z + pz * 8 * side;
        D.camOv = { pos: [cx, Math.max(gh(cx, cz) + 1.6, y + 2.6), cz], look: [s0.x, y + 0.8, s0.z] }; await wait(8); } };
      const fl = follow();
      keys('KeyW', true); const t0 = performance.now(); let tf = 0;
      while (performance.now() - t0 < 6000) { await wait(40); if (!tf && s0.st === 'flee') { tf = performance.now(); keys('KeyW', false); } if (tf && performance.now() - tf > 2800) break; }
      CMP.release(); track = false; await fl; D.camOv = null;
      return { fledAfterS: tf ? +((tf - t0) / 1000).toFixed(1) : null, stagState: s0.st, trackingCam: true }; },
  };
})();
