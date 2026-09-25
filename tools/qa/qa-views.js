/* qa-views.js — player-eye views, feet spots and motion takes (window.QAV). Injected after qa-page.js.
 * Every view uses the real over-the-shoulder gameplay camera (DBG.cam yaw/pitch/dist, camOv = null) at human
 * distances; a view returns { look, note, feet: [actor ids to test on the visible surface] }.
 */
(() => {
  const D = window.DBG, T = D.THREE, C = D.MODCTX, QA = window.QA;
  const QAV = window.QAV = {};
  const W = D.WORLD, POI = D.POI, P = D.player;
  const gh = (x, z) => D.groundH(x, z);
  const slope = (x, z) => (C.slopeAt ? C.slopeAt(x, z, 1) : 0);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const boxOf = (o) => new T.Box3().setFromObject(o);
  // a walkable spot at distance d from (x, z) along angle a, searching around if the first guess is bad
  const spotNear = (x, z, d, a = 0, maxSlope = 22) => {
    for (let k = 0; k < 24; k++) { const aa = a + k * 0.52, dd = d + (k >> 3) * 1.5, sx = x + Math.sin(aa) * dd, sz = z + Math.cos(aa) * dd;
      if (D.getH(sx, sz) > 0.6 && slope(sx, sz) < maxSlope && !(C.inRift && C.inRift(sx, sz))) return { x: sx, z: sz, a: aa }; }
    return { x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, a };
  };
  const look = (x, z, dy = 1) => [x, gh(x, z) + dy, z];
  QAV.cleanup = () => { QA.release(); D.G.pause = false; QA.closeDialogs(); if (D.G.riding) D.pressed.add('KeyE'); D.cam.dist = 7.5; };
  // passables (grass / shrubs from the vegetation provider) around a point
  const vegCount = (x, z, r, kind) => D.Passport.passablesNear(x, z, r, []).filter((p) => !kind || p.kind === kind).length;
  const nearTree = (x, z, r) => D.FOREST.list.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < r * r);
  const bestVeg = (kind, cx, cz, R = 60) => { let best = null;
    for (let i = -R; i <= R; i += 6) for (let j = -R; j <= R; j += 6) { const x = cx + i, z = cz + j; if (D.getH(x, z) < 0.6 || slope(x, z) > 20 || nearTree(x, z, 8)) continue; const n = vegCount(x, z, 4, kind); if (!best || n > best.n) best = { x, z, n }; }
    return best; };
  // point on top of the Kestrel (physics ray, tag 'kestrel', flat, 0.6–3 m above the snow)
  QAV.kestrelTop = () => { const b = boxOf(W.kestrel.g), c = b.getCenter(new T.Vector3()); let best = null;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) { const x = b.min.x + (b.max.x - b.min.x) * i / 12, z = b.min.z + (b.max.z - b.min.z) * j / 12;
      const h = D.PH.P.raycast({ x, y: b.max.y + 5, z }, { x: 0, y: -1, z: 0 }, 30, { groups: D.PH.P.groups.STATIC }); if (!h || !h.tag || !/kestrel/.test(h.tag.name || '') || h.normal.y < 0.85) continue;
      const above = h.point.y - gh(x, z); if (above < 0.6 || above > 3) continue; const d = Math.hypot(x - c.x, z - c.z); if (!best || d < best.d) best = { x, z, y: h.point.y, above, d }; }
    return best; };
  // a spot in front of a climbable ledge of the Kestrel (DBG.ledgeAhead must accept it)
  QAV.kestrelLedge = () => { const b = boxOf(W.kestrel.g), c = b.getCenter(new T.Vector3()), R = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    for (let a = 0; a < 6.28; a += 0.13) for (let d = R + 1; d > 1; d -= 0.5) {
      const x = c.x + Math.sin(a) * d, z = c.z + Math.cos(a) * d, dx = -Math.sin(a), dz = -Math.cos(a);
      D.teleport(x, z, undefined, gh(x, z)); if (P.y - gh(x, z) > 0.2) continue;
      const L = D.ledgeAhead(dx, dz); if (L) return { x, z, dx, dz, h: L.h, top: L.y }; }
    return null; };
  const freshEnemy = (x, z, st = 'idle') => { const e = D.spawnShardling(x, z, null); e.st = st; return e; };
  QAV.clearEnemies = () => { for (const e of D.enemies) { e.dead = true; D.scene.remove(e.g); } };
  const standOn = (x, z, y) => { D.teleport(x, z, undefined, y); };

  /* ------------------------------------------------------------------ eye views */
  const V = QAV.views = {};
  V.crate_close = () => { const c = W.crate.position, s = spotNear(c.x, c.z, 2.6, 0.9); QA.place(s.x, s.z, { look: [c.x, c.y + 0.5, c.z], pitch: 0.22 }); return { note: 'tool container, 2.6 m', feet: ['player'] }; };
  V.debris = () => { const e = D.Passport.list.filter((q) => q.name === 'debris')[0]; const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, s = spotNear(cx, cz, 2.2, 2.0);
    QA.place(s.x, s.z, { look: [cx, e.box.min[1], cz], pitch: 0.3 }); return { note: 'wreck debris, 2.2 m', feet: ['player'] }; };
  V.kestrel_side = () => { const b = boxOf(W.kestrel.g), c = b.getCenter(new T.Vector3()), s = spotNear(c.x, c.z, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 + 2, 3.6);
    QA.place(s.x, s.z, { look: [c.x, c.y, c.z], pitch: 0.2 }); return { note: 'standing next to the Kestrel', feet: ['player'] }; };
  V.kestrel_wing = () => { const t = QAV.kestrelTop(); if (!t) return { skip: 'no flat top on the wreck' }; const c = boxOf(W.kestrel.g).getCenter(new T.Vector3());
    QA.place(t.x, t.z, { onTop: true, yaw: Math.atan2(t.x - c.x, t.z - c.z) + 2.2, pitch: 0.32 }); return { note: `on the Kestrel, ${t.above.toFixed(1)} m above the snow`, feet: ['player'] }; };
  V.forest = () => { const L = D.FOREST.list; let best = L[0], bn = -1; for (let i = 0; i < L.length; i += 3) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 400) n++; if (n > bn) { bn = n; best = t; } }
    const s = spotNear(best[0] + 2.5, best[2] + 2.5, 0.5, 0); QA.place(s.x, s.z, { yaw: 0.8, pitch: 0.12 }); return { note: `inside the densest forest (${bn} trees in 20 m)`, feet: ['player'] }; };
  V.forest_edge = () => { const L = D.FOREST.list; let sx = 0, sz = 0; for (const t of L) { sx += t[0]; sz += t[2]; } const cx = sx / L.length, cz = sz / L.length;
    const s = spotNear(POI.crash.x, POI.crash.z, 30, Math.atan2(cx - POI.crash.x, cz - POI.crash.z)); QA.place(s.x, s.z, { look: [cx, gh(s.x, s.z) + 8, cz], pitch: 0.05 }); return { note: 'looking across the forest: near models → cards → billboards', feet: [] }; };
  V.boulder = () => { const B = D.targets.boulders().list; let b = null; for (const c of B) { if (c.s < 2.4) continue; const d = dist(c, POI.crash); if (!b || d < b.d) b = Object.assign({}, c, { d }); }
    const s = spotNear(b.x, b.z, b.s * 1.6 + 2, 0.7); QA.place(s.x, s.z, { look: [b.x, b.y + b.s * 0.5, b.z], pitch: 0.18 }); return { note: 'next to a big boulder', feet: ['player'] }; };
  const outcrop = (back) => { const M = D.DECOR.rocksOutcrop || []; if (!M.length) return { skip: 'no outcrops' };
    let best = null; for (const m of M) { const p = new T.Vector3().setFromMatrixPosition(m); const d = dist(p, POI.crash); if (!best || d < best.d) best = { p, d, m }; }
    const p = best.p, e = 0.8, gx = gh(p.x + e, p.z) - gh(p.x - e, p.z), gz = gh(p.x, p.z + e) - gh(p.x, p.z - e), gl = Math.hypot(gx, gz) || 1, ux = gx / gl, uz = gz / gl;   // uphill
    const sgn = back ? 1 : -1, s = spotNear(p.x + ux * 7 * sgn, p.z + uz * 7 * sgn, 0.5, 0, 38);
    QA.place(s.x, s.z, { look: [p.x, p.y + 1, p.z], pitch: back ? 0.45 : 0.15 }); return { note: back ? 'rock outcrop from uphill (its open back)' : 'rock outcrop from below', feet: ['player'] }; };
  V.outcrop_front = () => outcrop(false);
  V.outcrop_back = () => outcrop(true);
  V.grass = () => { const g = bestVeg('grass', POI.crash.x, POI.crash.z, 70) || { x: POI.crash.x, z: POI.crash.z + 20, n: 0 }; QA.place(g.x, g.z, { yaw: 1.1, pitch: 0.12, dist: 5.5 }); return { note: `grass patch (${g.n} tufts in 4 m)`, feet: ['player'] }; };
  V.shrubs = () => { const g = bestVeg('shrub', POI.crash.x, POI.crash.z, 90) || bestVeg('shrub', POI.lake.x, POI.lake.z, 60) || { x: POI.crash.x, z: POI.crash.z, n: 0 }; QA.place(g.x + 1.5, g.z + 1.5, { look: [g.x, gh(g.x, g.z) + 0.4, g.z], pitch: 0.2, dist: 5.5 }); return { note: `shrub cluster (${g.n} in 4 m)`, feet: ['player'] }; };
  V.station_door = () => { const d = W.stationW(0, 11.5), c = W.stationW(0, 0); QA.place(d.x, d.z, { look: [c.x, POI.station.h + 2.5, c.z], pitch: 0.15 }); return { note: 'at the station dome door', feet: ['player'] }; };
  V.orm = () => { const o = D.MODCTX.orm.pos, s = spotNear(o.x, o.z, 3.2, D.WORLD.stationYaw || 0); QA.place(s.x, s.z, { look: [o.x, o.y + 1.5, o.z], pitch: 0.12, dist: 5 }); return { note: 'talking distance to Orm', feet: ['player'] }; };
  V.pier = () => { const p = window.WorldFill && WorldFill.stats.pier; if (!p) return { skip: 'no pier' }; const L = POI.lake, a = Math.atan2(L.x - p.x, L.z - p.z);
    const x = p.x + Math.sin(a) * 3, z = p.z + Math.cos(a) * 3; QA.place(x, z, { onTop: true, look: [L.x, POI.lake.h || 1, L.z], pitch: 0.2 }); return { note: 'on the pier, looking over the lake', feet: ['player'] }; };
  V.lake_shore = () => { const L = POI.lake, a = 2.4; const s = spotNear(L.x + Math.sin(a) * 52, L.z + Math.cos(a) * 52, 0.5, 0); QA.place(s.x, s.z, { look: [L.x, 1, L.z], pitch: 0.18 }); return { note: 'lake shore', feet: ['player'] }; };
  V.camp = () => { const c = WorldFill.stats.camp, s = spotNear(c.x, c.z, 9, 2.5); QA.place(s.x, s.z, { look: look(c.x, c.z, 1.2), pitch: 0.2 }); return { note: 'camp (tents, sledge, snowcat)', feet: ['player'] }; };
  V.ruins = () => { const c = WorldFill.stats.ruins[0], s = spotNear(c.x, c.z, 6, 1.2); QA.place(s.x, s.z, { look: look(c.x, c.z, 2), pitch: 0.15 }); return { note: 'stone ruins, 6 m', feet: ['player'] }; };
  V.rift_rim = () => { const r = POI.rift; let x = r.x + 20, z = r.z + 88; const s = spotNear(x, z, 0.5, 0); QA.place(s.x, s.z, { look: [r.x, 8, r.z], pitch: 0.3 }); return { note: 'rift rim', feet: ['player'] }; };
  V.mountains = () => { let d = 250; const a = 1.9; while (d < 440 && D.getH(Math.cos(a) * d, Math.sin(a) * d) > 0.2) d += 2; const x = Math.cos(a) * (d - 14), z = Math.sin(a) * (d - 14);
    QA.place(x, z, { look: [Math.cos(a) * 1500, 60, Math.sin(a) * 1500], pitch: 0.02 }); return { note: 'coast, looking at the mountain ring', feet: [] }; };
  V.beam = () => { const c = W.crate.position, s = spotNear(c.x, c.z, 75, 2.2); QA.place(s.x, s.z, { look: [c.x, c.y + 25, c.z], pitch: -0.05 }); return { note: 'objective beam at 75 m', feet: ['player'] }; };
  V.pilot_hands = () => { const s = spotNear(POI.crash.x - 3, POI.crash.z + 12, 0.5, 0); QA.place(s.x, s.z, { yaw: 0.5 }); D.G.hasTool = true; P.face = 0.5 + Math.PI; P.aimT = 3; D.cam.dist = 2.2; D.cam.boom = 2.2; D.cam.pitch = 0.05;
    return { note: 'close-up of the pilot facing the camera (hands, tool)', feet: ['player'], after: () => { D.G.hasTool = false; P.aimT = 0; } }; };
  V.snowmobile = () => { const s = spotNear(POI.crash.x + 15, POI.crash.z + 20, 0.5, 0, 12); D.sk.unlocked = true; QA.place(s.x, s.z, { yaw: 0.4 }); D.sk.x = s.x + 2; D.sk.z = s.z; D.sk.yaw = 0.4;
    D.mount(); D.cam.pitch = 0.25; return { note: 'riding the snowmobile (parked)', feet: [], after: () => { if (D.G.riding) QAV.dismount(); } }; };
  V.stags = () => { const s0 = D.STAGS[0]; if (!s0) return { skip: 'no stags' }; const s = spotNear(s0.x, s0.z, 30, 0.3); QA.place(s.x, s.z, { look: [s0.x, gh(s0.x, s0.z) + 1.2, s0.z], pitch: 0.1, dist: 4 }); return { note: 'herd at 30 m (outside the flee radius)', feet: ['stag'] }; };
  V.fox = () => { const f = D.fox, s = spotNear(f.x, f.z, 3.5, 1.0); QA.place(s.x, s.z, { look: [f.x, gh(f.x, f.z) + 0.3, f.z], pitch: 0.25, dist: 4 }); return { note: 'fox at 3.5 m', feet: ['fox', 'player'] }; };
  V.enemies = () => { const s = spotNear(POI.crash.x - 20, POI.crash.z - 25, 0.5, 0, 15); QA.place(s.x, s.z, { yaw: 0.9 }); const fx = -Math.sin(0.9), fz = -Math.cos(0.9);
    for (let i = -1; i <= 1; i++) freshEnemy(s.x + fx * 9 + fz * i * 2.5, s.z + fz * 9 - fx * i * 2.5, 'recover'); D.enemies.forEach((e) => (e.t = 99));
    return { note: '3 shardlings at 9 m', feet: ['player'], after: () => QAV.clearEnemies() }; };
  QAV.viewOrder = ['crate_close', 'debris', 'kestrel_side', 'kestrel_wing', 'forest', 'forest_edge', 'boulder', 'outcrop_front', 'outcrop_back', 'grass', 'shrubs', 'station_door', 'orm', 'pier', 'lake_shore',
    'camp', 'ruins', 'rift_rim', 'mountains', 'beam', 'pilot_hands', 'fox', 'stags', 'enemies', 'snowmobile'];
  QAV.dismount = () => { D.pressed.add('KeyE'); };

  /* ------------------------------------------------------------------ feet spots (pilot idle on every surface type) */
  const F = QAV.feet = {};
  F.flat_snow = () => { const s = spotNear(POI.crash.x - 10, POI.crash.z + 25, 0.5, 0, 6); standOn(s.x, s.z); return 'flat snow'; };
  F.slope_25 = () => { for (let r = 20; r < 200; r += 7) for (let a = 0; a < 6.28; a += 0.4) { const x = POI.crash.x + Math.sin(a) * r, z = POI.crash.z + Math.cos(a) * r, sl = slope(x, z); if (sl > 22 && sl < 28 && D.getH(x, z) > 1) { standOn(x, z); return `slope ${sl.toFixed(0)}°`; } } return null; };
  F.deep_snow = () => { let best = null; for (let i = -60; i <= 60; i += 3) for (let j = -60; j <= 60; j += 3) { const x = POI.crash.x + i, z = POI.crash.z + j; if (slope(x, z) > 15) continue; const d = C.snowDepthAt ? C.snowDepthAt(x, z) : 0; if (!best || d > best.d) best = { x, z, d }; }
    if (!best) return null; standOn(best.x, best.z); return `deepest loose snow near the crash (${(best.d * 100).toFixed(0)} cm)`; };
  F.rock_top = () => { const B = D.targets.boulders(); let pick = null; for (const b of B.list) { if (b.s < 1.8) continue; const h = D.PH.P.raycast({ x: b.x, y: b.y + 30, z: b.z }, { x: 0, y: -1, z: 0 }, 60, { groups: D.PH.P.groups.STATIC }); if (!h || h.normal.y < 0.9) continue; const d = dist(b, POI.crash); if (!pick || d < pick.d) pick = { x: b.x, z: b.z, d }; }
    if (!pick) return null; D.teleport(pick.x, pick.z); return 'top of a boulder'; };
  F.kestrel_wing = () => { const t = QAV.kestrelTop(); if (!t) return null; D.teleport(t.x, t.z); return 'Kestrel wing (metal)'; };
  F.crate_top = () => { const c = W.stationW(5, -8); D.teleport(c.x, c.z); return 'station crate stack'; };
  F.lake_ice = () => { const L = POI.lake; standOn(L.x + 8, L.z + 6, gh(L.x + 8, L.z + 6)); return 'lake ice'; };
  QAV.feetOrder = ['flat_snow', 'slope_25', 'deep_snow', 'rock_top', 'kestrel_wing', 'crate_top', 'lake_ice'];

  /* ------------------------------------------------------------------ motion takes */
  // setup() → { only: actor ids/kinds to record, cam? } ; run() drives inputs (async) ; after() cleans up
  const M = QAV.motions = {};
  const hold = async (keys, ms) => { QA.keys(keys, true); await QA.wait(ms); QA.keys(keys, false); };
  M.walk = { setup() { const s = spotNear(POI.crash.x - 12, POI.crash.z + 30, 0.5, 0, 8); QA.place(s.x, s.z, { yaw: 0.6, pitch: 0.25 }); return { only: ['player'] }; },
    async run() { await QA.wait(300); await hold(['KeyW'], 2600); await QA.wait(300); } };
  M.run_turn = { setup() { const s = spotNear(POI.crash.x - 30, POI.crash.z + 40, 0.5, 0, 10); QA.place(s.x, s.z, { yaw: 1.4, pitch: 0.25 }); return { only: ['player'] }; },
    async run() { await QA.wait(200); QA.keys(['ShiftLeft', 'KeyW'], true); await QA.wait(1400); QA.keys(['KeyA'], true); await QA.wait(900); QA.keys(['KeyA'], false); QA.keys(['KeyD'], true); await QA.wait(700); QA.release(); await QA.wait(400); } };
  M.strafe_back = { setup() { const s = spotNear(POI.crash.x - 5, POI.crash.z + 45, 0.5, 0, 8); QA.place(s.x, s.z, { yaw: 2.0, pitch: 0.25 }); return { only: ['player'] }; },
    async run() { await QA.wait(200); await hold(['KeyS'], 1400); await hold(['KeyD'], 1200); await QA.wait(300); } };
  M.climb_crate = { setup() { const c = W.stationW(5, -8), st = W.stationW(0, 0), a = Math.atan2(c.x - st.x, c.z - st.z), x = c.x + Math.sin(a) * 3.2, z = c.z + Math.cos(a) * 3.2;
      this.c = c; QA.place(x, z, { yaw: Math.atan2(x - c.x, z - c.z), pitch: 0.2, dist: 5 }); D.cam.yaw += 0.9; return { only: ['player'], every: 3 }; },
    async run() { QA.keys(['KeyW'], true); let climbed = false; for (let i = 0; i < 70; i++) { await QA.wait(40); const d = Math.hypot(P.x - this.c.x, P.z - this.c.z); if (D.CLIMB.t >= 0) climbed = true; if (!climbed && d < 1.6) D.pressed.add('Space'); if (climbed && D.CLIMB.t < 0) break; }
      QA.release(); await QA.wait(700); return { climbed }; } };
  M.climb_kestrel = { setup() { const L = QAV.kestrelLedge(); if (!L) return { skip: 'no climbable ledge on the Kestrel' }; this.L = L; D.teleport(L.x - L.dx * 1.5, L.z - L.dz * 1.5, Math.atan2(-L.dx, -L.dz));
      P.face = Math.atan2(-L.dx, -L.dz); D.cam.yaw = P.face + 1.0; D.cam.pitch = 0.25; D.cam.dist = 5.5; return { only: ['player'], every: 3, note: `ledge ${L.h.toFixed(2)} m` }; },
    async run() { let climbed = false; D.cam.yaw = P.face + 1.0; QA.keys(['KeyW'], true);
      for (let i = 0; i < 80; i++) { await QA.wait(40); if (D.CLIMB.t >= 0) climbed = true; if (!climbed && i > 4) D.pressed.add('Space'); if (climbed && D.CLIMB.t < 0) break; }
      QA.release(); await QA.wait(800); return { climbed, ledge: this.L.h }; } };
  M.ride = { setup() { const s = spotNear(POI.crash.x + 40, POI.crash.z - 10, 0.5, 0, 10); D.sk.unlocked = true; QA.place(s.x, s.z, { yaw: 1.2 }); D.sk.x = s.x; D.sk.z = s.z + 2; D.sk.yaw = 1.2; D.sk.speed = 0;
      D.mount(); return { only: ['snowmobile'], every: 5 }; },
    async run() { await QA.wait(200); QA.keys(['KeyW'], true); await QA.wait(1600); QA.keys(['KeyA'], true); await QA.wait(900); QA.keys(['KeyA'], false); await QA.wait(700); QA.release(); await QA.wait(900); D.pressed.add('KeyE'); await QA.wait(300); } };
  M.stags_flee = { setup() { const s0 = D.STAGS[0]; if (!s0) return { skip: 'no stags' }; const s = spotNear(s0.x, s0.z, 20, 0.3); QA.place(s.x, s.z, { look: [s0.x, gh(s0.x, s0.z) + 1, s0.z], pitch: 0.12, dist: 5 });
      return { only: ['stag'], every: 5 }; },
    async run() { await QA.wait(4200); } };
  M.stags_flee2 = { setup() { const s0 = D.STAGS[3] || D.STAGS[0]; if (!s0) return { skip: 'no stags' }; for (const s of D.STAGS) { s.st = 'graze'; s.t = 1; } const s = spotNear(s0.x, s0.z, 16, 2.4); QA.place(s.x, s.z, { look: [s0.x, gh(s0.x, s0.z) + 1, s0.z], pitch: 0.12, dist: 5 });
      return { only: ['stag'], every: 5 }; },
    async run() { await QA.wait(4200); } };
  M.fox_follow = { setup() { const f = D.fox; f.joined = true; f.st = 'follow'; f.seekT = 99; const s = spotNear(POI.crash.x - 5, POI.crash.z + 30, 0.5, 0, 8); QA.place(s.x, s.z, { yaw: 0.2, pitch: 0.3 }); f.x = s.x + 4; f.z = s.z + 5;
      return { only: ['fox', 'player'], every: 5 }; },
    async run() { await QA.wait(500); await hold(['KeyW'], 1800); QA.keys(['ShiftLeft', 'KeyW'], true); await QA.wait(1500); QA.release(); await QA.wait(1200); } };
  M.fox_seek = { setup() { const f = D.fox; let best = null; for (const s of W.shards) if (!s.taken) { const d = dist(s, f); if (!best || d < best.d) best = { s, d }; }
      if (!best) return { skip: 'no shard' }; f.joined = true; const a = Math.atan2(f.x - best.s.x, f.z - best.s.z); f.x = best.s.x + Math.sin(a) * 22; f.z = best.s.z + Math.cos(a) * 22; f.target = best.s; f.st = 'seek'; f.seekT = 14;
      const s = spotNear(f.x, f.z, 6, a); QA.place(s.x, s.z, { look: [best.s.x, gh(best.s.x, best.s.z) + 1, best.s.z], pitch: 0.2, dist: 6 }); return { only: ['fox'], every: 4 }; },
    async run() { await QA.wait(3200); } };
  M.shardlings = { setup() { QAV.clearEnemies(); const s = spotNear(POI.crash.x - 25, POI.crash.z - 20, 0.5, 0, 12); QA.place(s.x, s.z, { yaw: 0.9, pitch: 0.2 }); P.hp = P.hpMax = 99;
      const fx = -Math.sin(0.9), fz = -Math.cos(0.9); for (let i = -1; i <= 1; i++) freshEnemy(s.x + fx * 22 + fz * i * 5, s.z + fz * 22 - fx * i * 5, 'chase'); return { only: ['shardling'], every: 4 }; },
    async run() { await QA.wait(3000); }, after() { QAV.clearEnemies(); } };
  M.boss = { setup() { QAV.clearEnemies(); D.setStage(6, true); const r = POI.rift, x = r.x + 4, z = r.z + 30; D.teleport(x, z); P.hp = P.hpMax = 99; D.cam.yaw = Math.atan2(x - r.x, z - r.z); D.cam.pitch = 0.25; D.cam.dist = 9;
      return { only: ['boss'], every: 6, waitFor: () => D.boss.active }; },
    async run() { for (let i = 0; i < 30 && !D.boss.active; i++) await QA.wait(100); QA.closeDialogs(); await QA.wait(2600); QA.closeDialogs(); await QA.wait(3500); } };
  QAV.motionOrder = ['walk', 'run_turn', 'strafe_back', 'climb_crate', 'climb_kestrel', 'ride', 'fox_follow', 'fox_seek', 'stags_flee', 'stags_flee2', 'shardlings', 'boss'];
})();
/* ------------------------------------------------------------------ one motion take, end to end (in the page) */
(() => {
  const D = window.DBG, QA = window.QA, QAV = window.QAV;
  QAV.take = async (name) => {
    const m = QAV.motions[name]; if (!m) return { name, skip: 'unknown take' };
    QAV.cleanup(); await QA.wait(150);
    const s = m.setup() || {}; if (s.skip) { QAV.cleanup(); return { name, skip: s.skip }; }
    await QA.wait(600); QA.closeDialogs();
    const run = m.run();   // inputs start now; the boss take activates its actor while running
    if (s.waitFor) for (let i = 0; i < 40 && !s.waitFor(); i++) await QA.wait(100);
    if (s.waitFor) { QA.closeDialogs(); await QA.wait(500); }
    const ids = QA.startRec({ only: s.only, every: s.every || 5, feetNear: 90 });
    const extra = await run; const rec = QA.stopRec();
    if (m.after) try { m.after(); } catch (e) { /* */ }
    const out = { name, note: s.note || '', actors: ids.map((a) => a.id), frames: rec.frames.length, dur: rec.frames.length ? rec.frames[rec.frames.length - 1].t : 0, extra: extra || null, facing: [], feet: [], continuity: [] };
    for (const a of ids) {
      const f = QA.analyzeFacing(rec, a.id); if (f.samples) out.facing.push(f);
      if (a.feet.length) { const ft = QA.analyzeFeet(rec, a.id); if (ft.steps) out.feet.push(ft); }
      if (a.kind === 'player' || a.kind === 'stag' || a.kind === 'fox' || a.kind === 'boss') out.continuity.push(QA.analyzeContinuity(rec, a.id, a.kind === 'player' ? 6 : 10));
    }
    out.pixels = QA.analyzePixels(rec);
    // camera inside geometry: every 4th frame of the take (static world, recorded camera)
    const cams = []; for (let i = 0; i < rec.frames.length; i += 4) { const f = rec.frames[i]; const c = QA.cameraCheck(f.cam, f.look); if (!c.pass) cams.push({ t: f.t, underground: c.underground, inside: c.inside, blocked: c.blocked, nearest: c.nearest }); }
    out.camera = { checked: Math.ceil(rec.frames.length / 4), bad: cams.length, first: cams.slice(0, 4), pass: cams.length === 0 };
    // thumbnails + labels (speed, facing dot, state of the first actor)
    const main = ids[0] && ids[0].id, fac = out.facing.find((f) => f.id === main);
    out.thumbs = rec.thumbs.map((t) => { const fr = rec.frames.find((f) => f.t >= t.t) || {}; const s0 = fac && fac.series.reduce((b, x) => (Math.abs(x.t - t.t) < Math.abs(b.t - t.t) ? x : b), { t: 1e9 });
      return { t: t.t, url: t.url, label: `${t.t.toFixed(2)} s` + (s0 && s0.sp != null ? ` · ${s0.sp.toFixed(1)} m/s` : '') + (s0 && s0.dot != null ? ` · dot ${s0.dot.toFixed(2)}` : '') + (fr.climb >= 0 ? ' · climb' : '') + (fr.a && fr.a[main] && fr.a[main].st ? ' · ' + fr.a[main].st : '') }; });
    QAV.cleanup(); await QA.wait(200);
    return out;
  };
  // contact sheet: thumbnails in a grid with labels → PNG data URL
  QAV.sheet = async (thumbs, title, cols = 6) => {
    if (!thumbs.length) return null;
    const imgs = await Promise.all(thumbs.map((t) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = t.url; })));
    const tw = imgs[0] ? imgs[0].width : 320, th = imgs[0] ? imgs[0].height : 183, pad = 4, head = 26, rows = Math.ceil(thumbs.length / cols);
    const c = document.createElement('canvas'); c.width = cols * (tw + pad) + pad; c.height = head + rows * (th + pad + 16) + pad; const g = c.getContext('2d');
    g.fillStyle = '#0a0f1e'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#e8f0ff'; g.font = '600 15px system-ui, sans-serif'; g.fillText(title, 8, 18);
    thumbs.forEach((t, i) => { const x = pad + (i % cols) * (tw + pad), y = head + Math.floor(i / cols) * (th + pad + 16); if (imgs[i]) g.drawImage(imgs[i], x, y); g.fillStyle = '#8a9cc0'; g.font = '11px system-ui, sans-serif'; g.fillText(t.label, x + 2, y + th + 12); });
    return c.toDataURL('image/png');
  };
})();
