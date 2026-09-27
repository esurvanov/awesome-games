/* lg-page.js — LOOK-GATE framings (window.LG), injected after qa-page.js + qa-views.js.
 *
 * Every shot is a free camera (DBG.camOv) placed to match the COMPOSITION of the reference photos: camera height,
 * distance to the subject, vertical FOV. The pilot is parked behind the camera unless the shot needs him (contact).
 *   LG.shots.<name>()   → { pos:[x,y,z], look:[x,y,z], fov, note, follow?: () => [x,y,z] }   (sets up the world)
 *   LG.motions.<name>   → { setup() → { pos, look, fov, only, follow, note }, async run() }
 * Only reads the game through DBG / DBG.MODCTX and drives it with the same inputs the QA takes use.
 */
(() => {
  const D = window.DBG, T = D.THREE, C = D.MODCTX, QA = window.QA, QAV = window.QAV;
  const LG = window.LG = { shots: {}, motions: {} };
  const W = D.WORLD, POI = D.POI, P = D.player;
  const gh = (x, z) => D.groundH(x, z);
  const surf = (x, z) => gh(x, z) + (C.snowDepthAt ? C.snowDepthAt(x, z) : 0);
  const slope = (x, z) => (C.slopeAt ? C.slopeAt(x, z, 1) : 0);
  const land = (x, z) => D.getH(x, z) > 0.6 && !(C.inRift && C.inRift(x, z));
  const nearTree = (x, z, r) => D.FOREST.list.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < r * r);
  const spotNear = (x, z, d, a = 0, maxSlope = 22) => {
    for (let k = 0; k < 36; k++) { const aa = a + k * 0.37, dd = d + (k >> 3) * 1.5, sx = x + Math.sin(aa) * dd, sz = z + Math.cos(aa) * dd;
      if (land(sx, sz) && slope(sx, sz) < maxSlope) return { x: sx, z: sz, a: aa }; }
    return { x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, a };
  };
  const eye = (x, z, h = 1.6) => [x, surf(x, z) + h, z];
  const fcen = () => { const L = D.FOREST.list; let sx = 0, sz = 0; for (const t of L) { sx += t[0]; sz += t[2]; } return { x: sx / L.length, z: sz / L.length }; };
  // park the pilot `back` m behind the camera (terrain rings / streaming follow the player; keep him close but out of frame)
  const park = (pos, look, back = 3) => { const dx = pos[0] - look[0], dz = pos[2] - look[2], l = Math.hypot(dx, dz) || 1; const x = pos[0] + dx / l * back, z = pos[2] + dz / l * back;
    QA.place(x, z, { look: [look[0], look[1], look[2]] }); };
  const cam = (pos, look, fov) => { D.camOv = { pos: pos.slice(), look: look.slice() }; if (fov) { D.camera.fov = fov; D.camera.updateProjectionMatrix(); } };
  LG.cam = cam;
  LG.hud = (on) => { const cv = D.renderer.domElement; for (const el of document.body.children) if (!el.contains(cv)) el.style.visibility = on ? '' : 'hidden'; };
  let follow = null;
  LG.follow = (fn) => { follow = fn; };
  const tick = () => { requestAnimationFrame(tick); if (follow && D.camOv) { try { const p = follow(); if (p) { if (p.look) { D.camOv.look = p.look; if (p.pos) D.camOv.pos = p.pos; } else D.camOv.look = p; } } catch (e) { follow = null; } } };
  requestAnimationFrame(tick);
  LG.cleanup = () => { follow = null; D.camOv = null; D.camera.fov = 62; D.camera.updateProjectionMatrix(); QAV.cleanup(); };
  const S = LG.shots, M = LG.motions;

  /* ------------------------------------------------------------------ helpers shared by shots */
  const openSnow = () => { const c = fcen(); let best = null;   // flattest treeless spot near the crash, looking away from the forest
    for (let r = 20; r < 120; r += 8) for (let a = 0; a < 6.28; a += 0.35) { const x = POI.crash.x + Math.sin(a) * r, z = POI.crash.z + Math.cos(a) * r;
      if (!land(x, z) || slope(x, z) > 8 || nearTree(x, z, 45)) continue; const s = slope(x, z) + r * 0.02; if (!best || s < best.s) best = { x, z, s }; }
    best = best || { x: POI.crash.x, z: POI.crash.z + 30 }; const a = Math.atan2(best.x - c.x, best.z - c.z); return { x: best.x, z: best.z, dx: Math.sin(a), dz: Math.cos(a) }; };
  LG.openSnow = openSnow;
  const bigBoulder = () => { const B = D.targets.boulders().list; let b = null; for (const c of B) { if (c.s < 2.2) continue; const d = Math.hypot(c.x - POI.crash.x, c.z - POI.crash.z); if (!b || d < b.d) b = Object.assign({}, c, { d }); } return b; };
  // horizontal physics ray from `from` toward (x, z): the solid's surface point
  const hitToward = (from, x, z, y) => { const dx = x - from.x, dz = z - from.z, l = Math.hypot(dx, dz) || 1; const h = D.PH.P.raycast({ x: from.x, y, z: from.z }, { x: dx / l, y: 0, z: dz / l }, l + 4, { groups: D.PH.P.groups.STATIC }); return h ? { x: h.point.x, z: h.point.z, dx: dx / l, dz: dz / l } : null; };

  // camera spot at `d` m from a target (tx, ty, tz) with an unobstructed sight line: terrain / snow under the line, no tree
  // crown (≈ 3 m) along the first 85 %, on land, gentle slope. Tries 24 bearings from a0 outward, then ±25 % distance.
  const TREE_R = 3.2;
  const sightCost = (cx, cy, cz, tx, ty, tz, skipTree) => { let c = 0; const n = 28;
    for (let i = 1; i < n; i++) { const f = i / n, x = cx + (tx - cx) * f, z = cz + (tz - cz) * f, y = cy + (ty - cy) * f;
      if (surf(x, z) > y - 0.15) c += 3;
      if (f < 0.85) for (const t of D.FOREST.list) { if (skipTree && t === skipTree) continue; if ((t[0] - x) ** 2 + (t[2] - z) ** 2 < TREE_R * TREE_R && y < gh(t[0], t[2]) + 14) { c += 2; break; } } }
    return c; };
  const clearSpot = (tx, ty, tz, d, h = 1.6, a0 = 0, o = {}) => { let best = null;
    for (const k of [1, 0.8, 1.25, 0.65, 1.5]) for (let j = 0; j < 24; j++) { const a = a0 + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.26, dd = d * k, x = tx + Math.sin(a) * dd, z = tz + Math.cos(a) * dd;
      if (!land(x, z) || slope(x, z) > (o.maxSlope || 24) || nearTree(x, z, o.treeClear || 2.5)) continue;
      const cy = surf(x, z) + h, c = sightCost(x, cy, z, tx, ty, tz, o.skipTree) + Math.abs(k - 1) * 2 + Math.ceil(j / 2) * 0.05;
      if (!best || c < best.c) best = { x, z, a, c, d: dd }; if (best.c < 0.5) return best; }
    return best || { x: tx + Math.sin(a0) * d, z: tz + Math.cos(a0) * d, a: a0, c: 99, d }; };
  LG.clearSpot = clearSpot;

  /* ------------------------------------------------------------------ shots */
  // ❄ open snow field at night — eye height, 24–28 mm (vfov ≈ 50), horizon in the upper third (a04, a05, h02)
  S.snow_open = () => { const o = openSnow(); const pos = eye(o.x, o.z, 1.6), look = [o.x + o.dx * 40, surf(o.x, o.z) - 1.5, o.z + o.dz * 40]; park(pos, look); return { pos, look, fov: 50, note: 'open snow, eye 1.6 m, looking away from the forest' }; };
  // 👣 footprint trail — the pilot walked 4–5 m away from the camera (c06, c02, c05)
  S.footprints = async () => { const o = openSnow(); const x0 = o.x - o.dx * 10, z0 = o.z - o.dz * 10;
    QA.place(x0, z0, { look: [x0 + o.dx * 30, gh(x0, z0) + 1, z0 + o.dz * 30] }); await QA.wait(500);
    QA.keys(['KeyW'], true); await QA.wait(1600); QA.keys(['KeyW'], false); await QA.wait(1200);
    const pos = [x0 - o.dx * 1.4, surf(x0, z0) + 1.7, z0 - o.dz * 1.4], look = [x0 + o.dx * 3.5, surf(x0 + o.dx * 3.5, z0 + o.dz * 3.5), z0 + o.dz * 3.5];
    LG._trail = { x0, z0, dx: o.dx, dz: o.dz }; return { pos, look, fov: 55, keepPilot: true, note: `trail of ${Math.hypot(P.x - x0, P.z - z0).toFixed(1)} m, eye 1.7 m behind its start` }; };
  // 👢 boots close-up — the pilot stands still, camera 1.3 m in front / side, looking down (c01, c04)
  S.boots = async () => { const o = openSnow(); const x = o.x + o.dz * 6, z = o.z - o.dx * 6; QA.place(x, z, { look: [x + o.dx * 20, gh(x, z) + 1, z + o.dz * 20] }); await QA.wait(400);
    QA.keys(['KeyW'], true); await QA.wait(1200); QA.keys(['KeyW'], false); await QA.wait(2200);
    const f = P.face, fx = -Math.sin(f), fz = -Math.cos(f), sx = fz, sz = -fx;   // pilot faces -(sin f, cos f)? use velocity-free: body forward from face
    const px = P.x, pz = P.z, y = P.y; const pos = [px + fx * 1.5 + sx * 0.9, y + 1.45, pz + fz * 1.5 + sz * 0.9], look = [px - fx * 0.5, y + 0.1, pz - fz * 0.5];
    return { pos, look, fov: 50, keepPilot: true, note: 'pilot boots + own prints, camera 1.75 m, looking down ~40°' }; };
  // 🌬 deep drift / wind-shaped snow — deepest loose snow near the crash, pilot standing in it at 3.5 m (d06, c05, d05)
  S.deep_drift = () => { let best = null; for (let i = -70; i <= 70; i += 3) for (let j = -70; j <= 70; j += 3) { const x = POI.crash.x + i, z = POI.crash.z + j; if (!land(x, z) || slope(x, z) > 15) continue; const d = C.snowDepthAt ? C.snowDepthAt(x, z) : 0; if (!best || d > best.d) best = { x, z, d }; }
    if (!best) return { skip: 'no loose snow' }; D.teleport(best.x, best.z, undefined, gh(best.x, best.z)); P.face = 0.6;
    const s = clearSpot(best.x, surf(best.x, best.z) + 0.8, best.z, 3.6, 1.6, 2.2); const pos = eye(s.x, s.z, 1.6), look = [best.x, surf(best.x, best.z) + 0.3, best.z];
    return { pos, look, fov: 55, keepPilot: true, note: `deepest loose snow (${(best.d * 100).toFixed(0)} cm), pilot in it at 3.6 m` }; };
  // 🪨 boulder with the pilot at touching distance — camera 6 m, eye height (d01, d04, e06)
  S.boulder = async () => { const b = bigBoulder(); if (!b) return { skip: 'no boulder ≥ 2.2' };
    const cs = clearSpot(b.x, gh(b.x, b.z) + b.s * 0.35, b.z, b.s * 0.9 + 4.5, 1.6, 0.7); const y = gh(b.x, b.z) + 0.9;
    // pilot on the camera-facing side, a little to the right, 0.38 m from the rock surface (physics ray, else mesh ray)
    const ax = cs.x - b.x, az = cs.z - b.z, al = Math.hypot(ax, az) || 1, ux = ax / al, uz = az / al, rx = uz, rz = -ux;
    const from = { x: cs.x + rx * b.s * 0.45, z: cs.z + rz * b.s * 0.45 };
    let h = hitToward(from, b.x, b.z, y); if (h && Math.hypot(h.x - b.x, h.z - b.z) > b.s * 1.3) h = null;   // something else on the way
    if (!h) { const dx = b.x - from.x, dz = b.z - from.z, l = Math.hypot(dx, dz); const rc = new T.Raycaster(new T.Vector3(from.x, y, from.z), new T.Vector3(dx / l, 0, dz / l), 0.3, l + 3);
      rc.camera = D.camera; let hits = []; for (const ch of D.scene.children) { try { hits.push(...rc.intersectObject(ch, true)); } catch (e) { /* odd object */ } } hits.sort((a, b2) => a.distance - b2.distance);
      const hit = hits.find((q) => q.object.isMesh && !q.object.isSkinnedMesh && QA.visibleChain(q.object) && !(q.object.material && q.object.material.transparent) && q.distance > 0.5 && Math.hypot(q.point.x - b.x, q.point.z - b.z) < b.s * 1.3);
      if (hit) h = { x: hit.point.x, z: hit.point.z, dx: dx / l, dz: dz / l }; }
    if (!h) { const dx = b.x - from.x, dz = b.z - from.z, l = Math.hypot(dx, dz); h = { x: b.x - dx / l * b.s * 0.75, z: b.z - dz / l * b.s * 0.75, dx: dx / l, dz: dz / l, guess: true }; }
    let px = from.x, pz = from.z; if (h) { px = h.x - h.dx * 0.38; pz = h.z - h.dz * 0.38; }
    const fa = h ? Math.atan2(-h.dx, -h.dz) : 0; D.teleport(px, pz, fa, gh(px, pz)); P.face = fa;
    await QA.wait(1800);   // INT-CONTACT: modules/interaction.js's contact layer needs ~1-1.5 s (sense refresh + steer + enter clip) to settle into its held lean/hand-on-rock pose before the still shot
    const pos = eye(cs.x, cs.z, 1.6), look = [b.x * 0.8 + px * 0.2, gh(b.x, b.z) + b.s * 0.35, b.z * 0.8 + pz * 0.2];
    return { pos, look, fov: 50, keepPilot: true, note: `boulder s ${b.s.toFixed(1)}, pilot ${h.guess ? '≈ at the rock (surface guessed)' : '0.38 m from its surface'}, camera ${Math.hypot(cs.x - b.x, cs.z - b.z).toFixed(1)} m` }; };
  // ⛰ rock outcrop from below, 10 m (d03, d02)
  S.outcrop = () => { const Mx = D.DECOR.rocksOutcrop || []; if (!Mx.length) return { skip: 'no outcrops' }; let best = null;
    for (const m of Mx) { const p = new T.Vector3().setFromMatrixPosition(m); const d = Math.hypot(p.x - POI.crash.x, p.z - POI.crash.z); if (!best || d < best.d) best = { p, d }; }
    const p = best.p, e = 0.8, gx = gh(p.x + e, p.z) - gh(p.x - e, p.z), gz = gh(p.x, p.z + e) - gh(p.x, p.z - e), gl = Math.hypot(gx, gz) || 1;
    const s = clearSpot(p.x, p.y + 1.5, p.z, 11, 1.6, Math.atan2(-gx, -gz), { maxSlope: 30 }); const pos = eye(s.x, s.z, 1.6), look = [p.x, p.y + 1.5, p.z]; park(pos, look);
    return { pos, look, fov: 55, note: 'outcrop, 11 m, clear sight line' }; };
  // 🧱 ruin wall, 5 m (no direct photo — stone material vs d03/d02, snow on ledges vs d02)
  S.ruin_wall = () => { const R = window.WorldFill && WorldFill.stats.ruins; if (!R || !R.length) return { skip: 'no ruins' }; const c = R[0], s = clearSpot(c.x, gh(c.x, c.z) + 1.3, c.z, 5.5, 1.6, 1.2);
    const pos = eye(s.x, s.z, 1.6), look = [c.x, gh(c.x, c.z) + 1.3, c.z]; park(pos, look); return { pos, look, fov: 55, note: 'stone ruin at 5.5 m' }; };
  // 🌲 one spruce at 2 m, looking up the trunk into the crown (b06, b05, b01)
  S.tree_close = () => { const c = fcen(), L = D.FOREST.list; let best = null;
    for (const t of L) { const d = Math.hypot(t[0] - POI.crash.x, t[2] - POI.crash.z); let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 36) n++; const sc = d + n * 30; if (!best || sc < best.sc) best = { t, sc }; }
    const t = best.t, a = Math.atan2(t[0] - c.x, t[2] - c.z), s = clearSpot(t[0], gh(t[0], t[2]) + 3.5, t[2], 6, 1.6, a, { skipTree: t, treeClear: 3.5 }); const pos = eye(s.x, s.z, 1.6), look = [t[0], gh(t[0], t[2]) + 3.5, t[2]]; park(pos, look, 2);
    return { pos, look, fov: 60, note: `spruce, ${s.d.toFixed(1)} m from the trunk (≈ 1–2 m from the branch tips)` }; };
  // 🌲🌲 forest edge at 30–40 m (b02, b03, b04)
  S.forest_mid = () => { const c = fcen(), a = Math.atan2(POI.crash.x - c.x, POI.crash.z - c.z); let d = 5; while (d < 250 && nearTree(c.x + Math.sin(a) * d, c.z + Math.cos(a) * d, 12)) d += 3;
    const s = spotNear(c.x + Math.sin(a) * d, c.z + Math.cos(a) * d, 0.5, 0, 20); const pos = eye(s.x, s.z, 1.6), look = [c.x, surf(s.x, s.z) + 4, c.z]; park(pos, look);
    return { pos, look, fov: 50, note: `forest edge, nearest tree ≈ 12 m` }; };
  // 🌲… forest at 150 m (b04 background, a05, i04)
  S.forest_far = () => { const c = fcen(), a = Math.atan2(POI.crash.x - c.x, POI.crash.z - c.z); let d = 5; while (d < 400 && nearTree(c.x + Math.sin(a) * d, c.z + Math.cos(a) * d, 150)) d += 5;
    const s = spotNear(c.x + Math.sin(a) * d, c.z + Math.cos(a) * d, 0.5, 0, 20); const pos = eye(s.x, s.z, 1.6), look = [c.x, surf(s.x, s.z) + 6, c.z]; park(pos, look);
    return { pos, look, fov: 45, note: 'nearest trees ≈ 150 m (impostor range)' }; };
  // 🌾 grass tufts from 2.5 m, camera 1.3 m (e03, e04, e05)
  const bestVeg = (kind, cx, cz, R = 70) => { let best = null; for (let i = -R; i <= R; i += 5) for (let j = -R; j <= R; j += 5) { const x = cx + i, z = cz + j; if (!land(x, z) || slope(x, z) > 18 || nearTree(x, z, 8)) continue;
    const n = D.Passport.passablesNear(x, z, 3, []).filter((p) => p.kind === kind).length; if (!best || n > best.n) best = { x, z, n }; } return best; };
  S.grass = () => { const g = bestVeg('grass', POI.crash.x, POI.crash.z, 80); if (!g || !g.n) return { skip: 'no grass' }; const s = spotNear(g.x, g.z, 2.6, 0.9, 25);
    const pos = eye(s.x, s.z, 1.3), look = [g.x, surf(g.x, g.z) + 0.1, g.z]; park(pos, look); return { pos, look, fov: 55, note: `grass (${g.n} tufts in 3 m) at 2.6 m` }; };
  S.heather = () => { const g = bestVeg('shrub', POI.crash.x, POI.crash.z, 90) || bestVeg('shrub', POI.lake.x, POI.lake.z, 60); if (!g || !g.n) return { skip: 'no shrubs' }; const s = spotNear(g.x, g.z, 4, 2.0, 25);
    const pos = eye(s.x, s.z, 1.6), look = [g.x, surf(g.x, g.z) + 0.2, g.z]; park(pos, look); return { pos, look, fov: 55, note: `heather / shrubs (${g.n} in 3 m) at 4 m` }; };
  // 🦌 stag side-on at 18 m, 70–85 mm (vfov ≈ 25) like i03–i05
  const stagCam = (s, d = 18) => clearSpot(s.x, gh(s.x, s.z) + 0.9, s.z, d, 1.5, s.yaw + Math.PI / 2, { maxSlope: 30 });
  S.stag = () => { const s = D.STAGS[0]; if (!s) return { skip: 'no stags' }; for (const q of D.STAGS) { q.st = 'graze'; q.t = 30; }
    const c = stagCam(s); const pos = eye(c.x, c.z, 1.5), look = [s.x, gh(s.x, s.z) + 1.0, s.z]; park(pos, look, 40);
    return { pos, look, fov: 26, note: 'stag side-on, 18 m, tele' }; };
  // 🧊 sea ice from the coast (g02, g01, g03)
  S.sea_ice = () => { let d = 250; const a = 0.6; while (d < 440 && D.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d + 6), z = Math.sin(a) * (d + 6);
    const pos = [x, Math.max(surf(x, z), 0.3) + 1.7, z], look = [Math.cos(a) * 520, 0, Math.sin(a) * 520]; park(pos, look, 6); return { pos, look, fov: 50, note: 'on the shore ice, looking out to sea' }; };
  // 🏔 mountain ring from the coast (h04, h01, h05)
  S.mountains = () => { let d = 250; const a = 1.9; while (d < 440 && D.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d - 14), z = Math.sin(a) * (d - 14);
    const pos = eye(x, z, 1.7), look = [Math.cos(a) * 1500, 110, Math.sin(a) * 1500]; park(pos, look); return { pos, look, fov: 40, note: 'coast → mountain ring' }; };
  // 🏠 station at night, 35 m (f01, f02, f04, f05)
  S.station_night = () => { const c = W.stationW(0, 0), dd = W.stationW(0, 30); const s = spotNear(dd.x, dd.z, 0.5, 0, 20);
    const pos = eye(s.x, s.z, 1.6), look = [c.x, (POI.station.h || gh(c.x, c.z)) + 3, c.z]; park(pos, look); return { pos, look, fov: 45, note: `station from ${Math.hypot(s.x - c.x, s.z - c.z).toFixed(0)} m` }; };
  // ✈ wreck from 20 m, low camera (j01, j02, j03, j05)
  S.wreck = () => { const b = new T.Box3().setFromObject(W.kestrel.g), c = b.getCenter(new T.Vector3()), R = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    const s = spotNear(c.x, c.z, R + 14, 3.6, 20); const pos = eye(s.x, s.z, 1.4), look = [c.x, c.y - 0.3, c.z]; park(pos, look); return { pos, look, fov: 45, note: `Kestrel from ${Math.hypot(s.x - c.x, s.z - c.z).toFixed(0)} m` }; };
  S.wreck_close = () => { const e = D.Passport.list.filter((q) => q.name === 'debris')[0]; if (!e) return { skip: 'no debris' }; const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, s = spotNear(cx, cz, 3, 2.0);
    const pos = eye(s.x, s.z, 1.6), look = [cx, e.box.min[1] + 0.3, cz]; park(pos, look); return { pos, look, fov: 55, note: 'wreck debris at 3 m' }; };

  // 🦶 GROUNDBLEND: where objects meet the snow, framed like the player's close third-person camera (≈ 4–5 m behind,
  // 2.2–2.5 m up, looking down ~20°) — the view the "pasted on the snow" complaint came from
  const tp = (tx, tz, d, a0, h = 2.3, o = {}) => { const s = clearSpot(tx, surf(tx, tz) + 0.3, tz, d, h, a0, o); return eye(s.x, s.z, h); };
  S.rock_close = () => { const B = D.targets.boulders().list; let b = null;
    for (const c of B) { if (c.s < 0.9 || c.s > 2.2 || slope(c.x, c.z) > 14) continue; const d = Math.hypot(c.x - POI.crash.x, c.z - POI.crash.z); if (!b || d < b.d) b = Object.assign({}, c, { d }); }
    if (!b) return { skip: 'no boulder 0.9–2.2' }; const pos = tp(b.x, b.z, b.s * 0.6 + 4.2, 0.4), look = [b.x, surf(b.x, b.z) + b.s * 0.15, b.z]; park(pos, look);
    return { pos, look, fov: 55, note: `boulder s ${b.s.toFixed(1)} from a third-person height, ${Math.hypot(pos[0] - b.x, pos[2] - b.z).toFixed(1)} m` }; };
  S.tuft_close = () => { const g = bestVeg('grass', POI.crash.x, POI.crash.z, 80); if (!g || !g.n) return { skip: 'no grass' };
    const pos = tp(g.x, g.z, 3.2, 1.3, 2.0), look = [g.x, surf(g.x, g.z), g.z]; park(pos, look); return { pos, look, fov: 55, note: `tufts (${g.n} in 3 m), third-person 3.2 m` }; };
  S.heather_close = () => { const g = bestVeg('shrub', POI.crash.x, POI.crash.z, 90) || bestVeg('shrub', POI.lake.x, POI.lake.z, 60); if (!g || !g.n) return { skip: 'no shrubs' };
    const pos = tp(g.x, g.z, 3.4, 2.4, 2.1), look = [g.x, surf(g.x, g.z) + 0.1, g.z]; park(pos, look); return { pos, look, fov: 55, note: `heather (${g.n} in 3 m), third-person 3.4 m` }; };
  S.hab_close = () => { const e = D.Passport.list.filter((q) => q.name === 'struct_hab_module' && q.box).sort((a, b) => (b.box.min[0] + b.box.max[0]) - (a.box.min[0] + a.box.max[0]))[0]; if (!e) return { skip: 'no hab module' };   // deterministic: the eastern one
    const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, R = Math.max(e.box.max[0] - e.box.min[0], e.box.max[2] - e.box.min[2]) / 2;
    const pos = tp(cx, cz, R + 5, 2.6, 2.3, { maxSlope: 30 }), look = [cx, e.box.min[1] + 1.2, cz]; park(pos, look);
    return { pos, look, fov: 55, note: `NASA hab module from ${Math.hypot(pos[0] - cx, pos[2] - cz).toFixed(1)} m, third-person height` }; };

  /* ------------------------------------------------------------------ motion strips (camera pans with the subject) */
  // pilot walking across the view, side-on at 4 m, knee-to-head framing: foot plants / sliding / trail forming
  M.pilot_walk = { setup() { const o = openSnow(); const x0 = o.x + o.dz * 14 - o.dx * 3, z0 = o.z - o.dx * 14 - o.dz * 3;
      QA.place(x0, z0, { look: [x0 + o.dx * 30, gh(x0, z0) + 1, z0 + o.dz * 30] });
      const cx = x0 + o.dx * 2.5 + o.dz * 4.2, cz = z0 + o.dz * 2.5 - o.dx * 4.2; const pos = eye(cx, cz, 1.1);
      return { pos, look: [x0, surf(x0, z0) + 0.8, z0], fov: 50, only: ['player'], follow: () => [P.x, P.y + 0.7, P.z], note: 'walk, side-on 4.2 m' }; },
    async run() { await QA.wait(250); QA.keys(['KeyW'], true); await QA.wait(2600); QA.keys(['KeyW'], false); await QA.wait(500); } };
  // stag grazing (the game has no walk gait: graze ↔ run)
  M.stag_graze = { setup() { const s = D.STAGS[0]; if (!s) return { skip: 'no stags' }; for (const q of D.STAGS) { q.st = 'graze'; q.t = 30; }
      const c = stagCam(s); const pos = eye(c.x, c.z, 1.5); park(pos, [s.x, 0, s.z], 40);
      return { pos, look: [s.x, gh(s.x, s.z) + 1, s.z], fov: 26, only: ['stag'], follow: () => [s.x, gh(s.x, s.z) + 1, s.z], note: 'graze, 18 m tele' }; },
    async run() { await QA.wait(2600); } };
  // stag fleeing across the view at ~20 m, the camera pans (i01, i06)
  M.stag_flee = { setup() { const s = D.STAGS[0]; if (!s) return { skip: 'no stags' }; for (const q of D.STAGS) { q.st = 'graze'; q.t = 30; }
      const c = stagCam(s, 20); const pos = eye(c.x, c.z, 1.5); park(pos, [s.x, 0, s.z], 45);
      const ax = s.x - c.x, az = s.z - c.z, al = Math.hypot(ax, az) || 1; this.s = s; this.dir = [az / al, -ax / al];   // across the line of sight
      return { pos, look: [s.x, gh(s.x, s.z) + 1, s.z], fov: 32, only: ['stag'], follow: () => [s.x, gh(s.x, s.z) + 1, s.z], note: 'flee across the view, 20 m' }; },
    async run() { const s = this.s; s.st = 'flee'; s.t = 8; s.fx = this.dir[0]; s.fz = this.dir[1]; s.A.loop('run', 0.15); await QA.wait(2400); } };

  // 🪨 pilot walks up to a boulder and leans — INT-CONTACT's modules/interaction.js CT: steer the last few cm to the
  // clip's stand-off, then hand/shoulder IK onto the real raycast hit. Same boulder as S.boulder, but reached on foot
  // (hold W into it) instead of teleported straight onto the touch point, so the strip shows the whole
  // steer → enter → loop sequence, not just the held pose.
  M.pilot_lean_boulder = { setup() {
      const b = bigBoulder(); if (!b) return { skip: 'no boulder ≥ 2.2' };
      const y = gh(b.x, b.z) + 0.9, cs = clearSpot(b.x, y, b.z, b.s * 0.9 + 5.5, 1.6, 0.7);
      const ax = cs.x - b.x, az = cs.z - b.z, al = Math.hypot(ax, az) || 1, ux = ax / al, uz = az / al;
      // close enough that the walk-in + contact steer/enter settles inside the strip's ~1.3 s thumbnail window
      // (QA.startRec caps thumbnails, not the take's own duration — a longer run() still measures fine, but only
      // its first ~1.3 s is visible in the .strip.jpg, so the interesting part has to happen early)
      const from = { x: b.x + ux * (b.s * 0.5 + 2.0), z: b.z + uz * (b.s * 0.5 + 2.0) };
      const h = hitToward(from, b.x, b.z, y), fa = h ? Math.atan2(-h.dx, -h.dz) : Math.atan2(-ux, -uz);
      D.teleport(from.x, from.z, fa, gh(from.x, from.z)); P.face = fa;
      const rx = uz, rz = -ux, pos = eye(cs.x + rx * 1.6, cs.z + rz * 1.6, 1.5);
      return { pos, look: [b.x, y, b.z], fov: 50, only: ['player'], follow: () => [P.x, P.y + 1.1, P.z], note: 'walks up to the boulder and leans (contact layer)' }; },
    async run() { QA.keys(['KeyW'], true); await QA.wait(2000); QA.keys(['KeyW'], false); await QA.wait(2000); } };
  // 🌲 pilot walks into a low krummholz branch — clear_branch (arm sweep, INT-CONTACT) alongside the existing
  // shakeTree snow curtain (vegetation module)
  M.pilot_branch = { setup() {
      const L = D.FOREST.list.filter((t) => t.v === 7); if (!L.length) return { skip: 'no krummholz' };
      let best = null; for (const t of L) { const d = Math.hypot(t[0] - POI.crash.x, t[2] - POI.crash.z); if (!best || d < best.d) best = { t, d }; }
      const t = best.t, a = Math.atan2(t[0] - POI.crash.x, t[2] - POI.crash.z), from = { x: t[0] + Math.sin(a) * 3.5, z: t[2] + Math.cos(a) * 3.5 };
      D.teleport(from.x, from.z, a + Math.PI, gh(from.x, from.z)); P.face = a + Math.PI;
      const rx = Math.cos(a), rz = -Math.sin(a), pos = eye(from.x + rx * 3.2, from.z + rz * 3.2, 1.5);
      return { pos, look: [t[0], gh(t[0], t[2]) + 1.1, t[2]], fov: 48, only: ['player'], follow: () => [P.x, P.y + 1.1, P.z], note: `walks into a krummholz at ${best.d.toFixed(1)} m` }; },
    async run() { await QA.wait(200); QA.keys(['KeyW'], true); await QA.wait(2600); QA.keys(['KeyW'], false); await QA.wait(1400); } };

  // one motion strip: setup → camera → record thumbnails with QA.startRec → run
  LG.take = async (name, o = {}) => {
    const m = M[name]; if (!m) return { skip: 'unknown' };
    LG.cleanup(); await QA.wait(150);
    const s = m.setup(); if (s.skip) { LG.cleanup(); return s; }
    cam(s.pos, s.look, s.fov); if (s.follow) LG.follow(s.follow);
    await QA.wait(1500); QA.closeDialogs();
    QA.startRec({ only: s.only, every: o.every || 3, tw: o.tw || 480, th: o.th || 320, maxThumbs: o.max || 16, feetNear: 60 });
    await m.run(); const rec = QA.stopRec();
    const out = { note: s.note, fov: s.fov, frames: rec.frames.length, dur: rec.frames.length ? rec.frames[rec.frames.length - 1].t : 0, thumbs: rec.thumbs };
    LG.cleanup(); return out;
  };
})();
