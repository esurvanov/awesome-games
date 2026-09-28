/* realism-page.js — in-page library window.QR for the realism rules (REALISM-QA.md), injected after qa-page.js.
 * Reads the game only through window.DBG / DBG.MODCTX / window.QA. Sections:
 *   collision · exact shape: walk into a Passport entry, gap capsule ↔ VISIBLE surface (THREE.Raycaster on the drawn
 *               meshes, independent of the physics), seam snags, jump on top, physics step cost
 *   rules     · sizes (Passport boxes + actors), albedo, frame stats vs the night photos, grounding on the drawn snow,
 *               texel density, faceting, repetition, weathering  (appended below)
 */
(() => {
  if (window.QR && window.QR.__v) return;
  const D = window.DBG, T = D.THREE, C = D.MODCTX;
  const QR = window.QR = { __v: 1 };
  const r3 = (x) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1000) / 1000);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const kindOf = (e) => String(e.name).replace(/#\d+$/, '');
  const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  QR.kindOf = kindOf; QR.visible = visible;

  /* ------------------------------------------------------------------ visible geometry (what the eye sees) */
  // every drawn opaque mesh except terrain, actors, sprites, grass/shrub/decals (passable by design)
  const PASSABLE = /grass|tuft|shrub|bush|sedge|moss|lichen_decal|decal|foot|print|snowfx|particle|glow|beam|aurora|sky|fog|flake|spark|smoke|flame|ember|impost/i;
  const actorRoots = () => QA.actorGroups ? QA.actorGroups() : [D.player.c && D.player.c.g].filter(Boolean);
  const GROUNDS = /terrain|ground|snowfield|seaice|sea_?ice|^sea$|lake|atm_mountains|atm_env|skirt|far$/i;
  // box (optional, an entry's world box [min, max]): only meshes / instances that overlap it — the target's own drawing
  QR.drawnNear = (x, y, z, R, box) => {
    const out = [], acts = new Set(actorRoots()), c = new T.Vector3(x, y, z), s = new T.Sphere(), M = new T.Matrix4();
    const bx = box ? new T.Box3(new T.Vector3(...box.min).subScalar(0.3), new T.Vector3(...box.max).addScalar(0.3)) : null;
    const ok = () => s.distanceToPoint(c) < R && (!bx || bx.intersectsSphere(s));
    D.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || o.isSkinnedMesh || o === D.terrainMesh || o.isSprite || GROUNDS.test(o.name || '')) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.isShaderMaterial || (m.transparent && m.depthWrite === false) || PASSABLE.test(o.name || '') || PASSABLE.test(m.name || '')) return;
      for (let p = o; p; p = p.parent) if (acts.has(p)) return;
      if (!visible(o)) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.isInstancedMesh) {   // per instance (one mesh holds a 200 m cell): only instances near the point count
        let near = false; for (let k = 0; k < o.count && !near; k++) { o.getMatrixAt(k, M); M.premultiply(o.matrixWorld); s.copy(o.geometry.boundingSphere).applyMatrix4(M); if (ok()) near = true; }
        if (near) out.push(o);
      } else { s.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); if (ok()) out.push(o); }
    });
    return out;
  };
  const RC = new T.Raycaster();
  // InstancedMesh: per instance through a plain Mesh. open-world.html sets InstancedMesh.prototype.raycast =
  // three-mesh-bvh acceleratedRaycast, which treats an InstancedMesh as ONE mesh at its own matrix (the instances are
  // never visited) — every stock raycast against instanced rocks/boulders/crystals misses (REALISM-QA.md, found here).
  const _tm = new T.Mesh(), _im = new T.Matrix4(), _sp = new T.Sphere();
  QR.raycastObject = (rc, o, out) => {
    if (!o.isInstancedMesh) { o.raycast(rc, out); return out; }
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    _tm.geometry = g; _tm.material = o.material; const n0 = out.length;
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, _im); _im.premultiply(o.matrixWorld); _sp.copy(g.boundingSphere).applyMatrix4(_im); if (!rc.ray.intersectsSphere(_sp)) continue;
      _tm.matrixWorld.copy(_im); const a = out.length; T.Mesh.prototype.raycast.call(_tm, rc, out);
      for (let i = a; i < out.length; i++) { out[i].object = o; out[i].instanceId = k; }
    }
    return out;
  };
  QR.ray = (objs, o, d, far = 30) => {
    RC.set(new T.Vector3(o.x, o.y, o.z), new T.Vector3(d.x, d.y, d.z).normalize()); RC.near = 0; RC.far = far;
    let best = null; for (const m of objs) { const hs = QR.raycastObject(RC, m, []); for (const h of hs) if (h.distance <= far && (!best || h.distance < best.distance)) best = h; } return best;
  };
  const withDouble = (objs, fn) => { const sides = []; for (const o of objs) for (const m of [].concat(o.material)) { sides.push([m, m.side]); m.side = T.DoubleSide; } try { return fn(); } finally { for (const [m, s] of sides) m.side = s; } };

  /* ------------------------------------------------------------------ collision: exact shape vs visible surface */
  const CAP = { r: 0.4, h: 1.8, skin: 0.02 };   // physics.js character capsule: bottom at player.y + skin
  const capR = (h0) => { const h = h0 - CAP.skin; return h < CAP.r ? Math.sqrt(Math.max(0, CAP.r ** 2 - (CAP.r - h) ** 2)) : h > CAP.h - CAP.r ? Math.sqrt(Math.max(0, CAP.r ** 2 - (h - (CAP.h - CAP.r)) ** 2)) : CAP.r; };
  // horizontal gap from the capsule to the drawn surface, fan ±70° around the walking direction, heights 0.3–1.7 m
  // gap = distance from each ray hit to the capsule's axis segment − radius: rays from the axis in a full circle at 10
  // heights, plus straight down from the bottom ring (standing on something invisible shows up as a gap below)
  const _a = new T.Vector3(), _b = new T.Vector3(), _q = new T.Vector3(), _seg = new T.Line3();
  QR.capsuleGap = (pt) => { const p = D.player; _a.set(p.x, p.y + CAP.skin + CAP.r, p.z); _b.set(p.x, p.y + CAP.skin + CAP.h - CAP.r, p.z); _seg.set(_a, _b); _seg.closestPointToPoint(pt, true, _q); return _q.distanceTo(pt) - CAP.r; };
  QR.gapAt = (objs) => {
    const p = D.player; let best = null;
    const probe = (o, d, far, dir) => { const h = QR.ray(objs, o, d, far); if (h) { const g = QR.capsuleGap(h.point); if (!best || g < best.gap) best = { gap: g, dir, obj: h.object.name || h.object.type, at: [r3(h.point.x), r3(h.point.y), r3(h.point.z)] }; } };
    withDouble(objs, () => {
      for (let a = 0; a < 360; a += 4) for (const hy of [0.12, 0.25, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.75]) {
        const ang = a * Math.PI / 180; probe({ x: p.x, y: p.y + hy, z: p.z }, { x: Math.sin(ang), y: 0, z: Math.cos(ang) }, 4, 'side');
      }
      for (let a = 0; a < 360; a += 45) for (const o of [0.15, 0.3]) probe({ x: p.x + Math.sin(a * Math.PI / 180) * o, y: p.y + 0.5, z: p.z + Math.cos(a * Math.PI / 180) * o }, { x: 0, y: -1, z: 0 }, 1.5, 'below');
      probe({ x: p.x, y: p.y + 1, z: p.z }, { x: 0, y: -1, z: 0 }, 2, 'below');
    });
    return best;
  };
  // the target's own drawing: meshes of e.obj, or instanced meshes named like the kind (st_rock ↔ rock); snow skirts,
  // pebbles and decals around it are passable and never count
  QR.targetMeshes = (e, x, y, z, R) => {
    const near = QR.drawnNear(x, y, z, R, e.box).filter((o) => !/skirt|clutter|pebble|decal/i.test(o.name || ''));
    if (e.obj) { const own = new Set(); e.obj.traverse((o) => own.add(o)); const a = near.filter((o) => own.has(o)); if (a.length) return a; }
    const k = kindOf(e).replace(/^st_/, ''), b = near.filter((o) => (o.name || '').replace(/^st_/, '') === k), src = b.length ? b : near;
    // instanced: only the instance(s) whose bounds centre lies in the entry's box — neighbours of the same model (with
    // their own colliders) must not count as this object's surface
    const out = [], bx = new T.Box3(new T.Vector3(...e.box.min).subScalar(0.25), new T.Vector3(...e.box.max).addScalar(0.25)), M = new T.Matrix4(), c = new T.Vector3();
    for (const o of src) {
      if (!o.isInstancedMesh) { out.push(o); continue; }
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); c.copy(o.geometry.boundingSphere.center).applyMatrix4(M);
        if (bx.containsPoint(c)) { const m = new T.Mesh(o.geometry, o.material); m.name = o.name + '#' + i; m.matrixAutoUpdate = false; m.matrix.copy(M); m.matrixWorld.copy(M); out.push(m); } }
    }
    return out.length ? out : src;
  };
  // drawn solid-looking instances (rocks, boulders, crystals, ruins, ice, props) with no Passport collider around them
  QR.uncollided = () => {
    const ents = D.Passport.list.filter((e) => e.alive && e.box && (e.role === 'solid' || e.role === 'pushable' || e.role === 'trunk')).map((e) => {
      if (e.role !== 'pushable' || !e.obj) return e;   // pushables move: their box now, not at registration
      const b = new T.Box3().setFromObject(e.obj); return b.isEmpty() ? e : { box: { min: b.min.toArray(), max: b.max.toArray() } }; });
    const grid = new Map(), CS = 16, key = (x, z) => Math.floor(x / CS) + ',' + Math.floor(z / CS);
    for (const e of ents) for (let i = Math.floor(e.box.min[0] / CS); i <= Math.floor(e.box.max[0] / CS); i++) for (let j = Math.floor(e.box.min[2] / CS); j <= Math.floor(e.box.max[2] / CS); j++) { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e); }
    const out = new Map(), M = new T.Matrix4(), c = new T.Vector3();
    for (const p of QR.props()) {
      if (p.tree || (() => { for (let q = p.m; q; q = q.parent) if (q.userData && q.userData.qaPassable) return true; return false; })() || !/rock|boulder|crystal|ruin|ice|berg|ridge|crate|drum|barrel|cairn|inuksuk|pole|tent|hab|station|kestrel|wreck|sledge|snowcat|rover/i.test(p.nc)) continue;
      const g = p.m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      const n = p.m.isInstancedMesh ? p.m.count : 1;
      for (let i = 0; i < n; i++) {
        if (p.m.isInstancedMesh) { p.m.getMatrixAt(i, M); M.premultiply(p.m.matrixWorld); } else M.copy(p.m.matrixWorld);
        c.copy(g.boundingSphere.center).applyMatrix4(M); const r = g.boundingSphere.radius * M.getMaxScaleOnAxis(); if (r < 0.3) continue;
        // the drawn instance's core (half its bounding sphere) must touch a collider box: the centre alone missed tall
        // models whose collider is only the part above the ice / ground (pier: piles clipped below the lake ice)
        const rc = r * 0.5, hit = (grid.get(key(c.x, c.z)) || []).some((e) => { const dx = Math.max(e.box.min[0] - 0.3 - c.x, 0, c.x - e.box.max[0] - 0.3), dy = Math.max(e.box.min[1] - 1 - c.y, 0, c.y - e.box.max[1] - 1), dz = Math.max(e.box.min[2] - 0.3 - c.z, 0, c.z - e.box.max[2] - 0.3); return dx * dx + dy * dy + dz * dz <= rc * rc; });
        if (!hit) { const k = p.name; const o = out.get(k) || { name: k, n: 0, r: 0, at: null }; o.n++; if (r > o.r) { o.r = r3(r); o.at = [r3(c.x), r3(c.y), r3(c.z)]; } out.set(k, o); }
      }
    }
    return [...out.values()].sort((a, b) => b.n - a.n);
  };
  const entryCentre = (e) => [(e.box.min[0] + e.box.max[0]) / 2, (e.box.min[1] + e.box.max[1]) / 2, (e.box.min[2] + e.box.max[2]) / 2];
  const halfDiag = (e) => Math.hypot(e.box.max[0] - e.box.min[0], e.box.max[2] - e.box.min[2]) / 2;
  // a start spot `dist` m out from the entry along azimuth a: not inside another solid's box / trunk, on walkable ground
  function clearStart(e, a, dist) {
    const [cx, , cz] = entryCentre(e);
    for (let k = 0; k < 18; k++) {
      const aa = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35, x = cx + Math.sin(aa) * dist, z = cz + Math.cos(aa) * dist;
      let ok = D.normalY ? true : true;
      for (const u of D.Passport.list) {
        if (u === e || !u.alive || !u.box || (u.role !== 'solid' && u.role !== 'trunk' && u.role !== 'pushable')) continue;
        const b = u.box; if (x > b.min[0] - 0.8 && x < b.max[0] + 0.8 && z > b.min[2] - 0.8 && z < b.max[2] + 0.8) { ok = false; break; }
        // the straight walk line must not cross another solid before the target
        if (u.role === 'solid' || u.role === 'pushable') { for (let t = 0.15; t < 0.85; t += 0.1) { const qx = x + (cx - x) * t, qz = z + (cz - z) * t; if (qx > b.min[0] - 0.4 && qx < b.max[0] + 0.4 && qz > b.min[2] - 0.4 && qz < b.max[2] + 0.4 && Math.hypot(qx - cx, qz - cz) > halfDiag(e) * 0.6) { ok = false; break; } } if (!ok) break; }
      }
      if (ok && D.getH(x, z) > 0.3) return { x, z, a: aa };
    }
    return null;
  }
  const boxDist = (e, x, z) => Math.hypot(Math.max(e.box.min[0] - x, 0, x - e.box.max[0]), Math.max(e.box.min[2] - z, 0, z - e.box.max[2]));
  // walk at the entry (glance = angle between the walk line and the line to its centre, 0 = straight in)
  QR.walkInto = async (e, a, o = {}) => {
    const [cx, cy, cz] = entryCentre(e), dist = halfDiag(e) + (o.dist || 3.5), st = clearStart(e, a, dist);
    if (!st) return { skip: 'no clear start' };
    // aim point: the centre, or o.offset m to the side of it (a walk that grazes the surface)
    const ux = cx - st.x, uz = cz - st.z, ul = Math.hypot(ux, uz) || 1, tx = cx + (-uz / ul) * (o.offset || 0), tz = cz + (ux / ul) * (o.offset || 0);
    const yaw = Math.atan2(st.x - tx, st.z - tz);   // camera yaw: W walks towards -yaw dir
    const p = D.player; QA.release(); D.teleport(st.x, st.z, yaw, D.groundH(st.x, st.z)); D.cam.pitch = 0.3; await wait(400);
    const yawFwd = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
    const trace = []; let still = 0, last = [p.x, p.y, p.z], last0 = [p.x, p.z]; const t0 = performance.now(), ms = o.ms || 4500;
    D.keys.KeyW = true;
    while (performance.now() - t0 < ms) {
      await wait(100);
      const mv = Math.hypot(p.x - last[0], p.y - last[1], p.z - last[2]); last = [p.x, p.y, p.z];
      trace.push([r3(p.x), r3(p.y), r3(p.z), r3(Math.hypot(p.x - last0[0], p.z - last0[1]) * 10), p.onGround ? 1 : 0, r3(p.y - D.groundH(p.x, p.z)), r3(boxDist(e, p.x, p.z))]); last0 = [p.x, p.z];
      if (!o.full && mv < 0.02) { if (++still >= 4) break; } else still = 0;
    }
    D.keys.KeyW = false; await wait(250);
    const objs = QR.targetMeshes(e, p.x, p.y + 1, p.z, 4);
    const gap = QR.gapAt(objs);
    // the same probe against the collider's own triangles (Passport e.geo): tells a physics penetration (both negative)
    // from a drawn-vs-collider mismatch (only the drawn one off)
    let colGap = null; if (e.geo) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(e.geo.v, 3)); g.setIndex(new T.BufferAttribute(e.geo.i, 1)); g.computeBoundingSphere();
      const cm = new T.Mesh(g, new T.MeshBasicMaterial({ side: T.DoubleSide })); cm.updateMatrixWorld(true); const cg = QR.gapAt([cm]); colGap = cg ? r3(cg.gap) : null; g.dispose(); }
    // the physics contact (Rapier) for the record: the static the capsule would hit moving on
    let blocker = null;
    const PH = D.PH;
    if (PH && PH.ok && PH.P.sphereCast) for (const hy of [0.45, 0.9, 1.4]) { const b = PH.P.sphereCast({ x: p.x, y: p.y + hy, z: p.z }, { x: Math.sin(yawFwd), y: 0, z: Math.cos(yawFwd) }, 1.2, 0.38);
      if (b && (!blocker || b.distance < blocker.d)) blocker = { d: r3(b.distance), hy, tag: b.tag && (b.tag.name || b.tag.kind), exact: b.tag && b.tag.exact }; }
    const travelled = Math.hypot(p.x - st.x, p.z - st.z), reach = boxDist(e, p.x, p.z);
    return { start: [r3(st.x), r3(st.z)], end: [r3(p.x), r3(p.y), r3(p.z)], travelled: r3(travelled), reached: reach < 1.2, boxDist: r3(reach), gap: gap ? r3(gap.gap) : null, colGap, gapAt: gap, blocker, trace, stopped: still >= 4 };
  };
  // seam snag: walk at 50° past the surface so the controller slides along it; a smooth surface keeps the pilot moving
  // (speed dips below 35 % of the free-walk speed for ≥ 0.3 s or vertical pops > 12 cm per 0.1 s while grounded = snag)
  QR.slideAlong = async (e, a) => {
    const r = await QR.walkInto(e, a, { offset: halfDiag(e) * 0.45, ms: 3500, full: true, dist: 2.5 });
    if (r.skip) return r;
    const sp = r.trace.map((t) => t[3]), free = Math.max(...sp.slice(0, 8)) || 1;
    let run = 0, stops = 0, pops = 0; const touch = r.trace.findIndex((t, i) => i > 3 && t[6] < 0.8 && t[3] < free * 0.8);
    for (let i = Math.max(1, touch); touch >= 0 && i < r.trace.length; i++) {
      if (r.trace[i][6] > 1.5) break;   // left the rock behind
      if (r.trace[i][3] < free * 0.35) { if (++run === 3) stops++; } else run = 0;
      if (r.trace[i][4] && r.trace[i - 1][4] && Math.abs(r.trace[i][5] - r.trace[i - 1][5]) > 0.12) pops++;
    }
    const slid = touch >= 0 ? Math.hypot(r.trace[r.trace.length - 1][0] - r.trace[touch][0], r.trace[r.trace.length - 1][2] - r.trace[touch][2]) : 0;
    return { start: r.start, end: r.end, freeSpeed: r3(free), touchedAt: touch, trace: r.trace, slid: r3(slid), stops, pops, blocker: r.blocker };
  };
  // jump onto the entry (top 0.8–1.7 m above the ground): walk up, stand, jump with W held, end grounded on top
  QR.jumpOnto = async (e) => {
    const [cx, , cz] = entryCentre(e), objs = QR.drawnNear(cx, e.box.max[1], cz, halfDiag(e) + 1);
    const top = withDouble(objs, () => QR.ray(objs, { x: cx, y: e.box.max[1] + 5, z: cz }, { x: 0, y: -1, z: 0 }, 20));
    if (!top) return { skip: 'no top' };
    const h = top.point.y - D.groundH(cx, cz);
    const r = await QR.walkInto(e, 2.0, { ms: 3000 });
    if (r.skip) return r;
    const p = D.player; D.pressed.add('Space'); await wait(60); D.keys.KeyW = true;
    for (let i = 0; i < 30; i++) { await wait(50); if (i > 5 && p.onGround && (!D.CLIMB || D.CLIMB.t < 0)) break; }
    await wait(250); D.keys.KeyW = false; await wait(900);
    const onTop = p.onGround && p.y > D.groundH(p.x, p.z) + 0.5 && Math.abs(p.y - top.point.y) < 0.6;
    return { h: r3(h), top: r3(top.point.y), end: [r3(p.x), r3(p.y), r3(p.z)], grounded: !!p.onGround, onTop };
  };
  // pick up to n alive entries of a kind: nearest to the crash site, spread apart, top ≥ 0.6 m over the ground
  QR.pick = (kind, n = 2, o = {}) => {
    const ref = o.ref || [D.POI.crash.x, D.POI.crash.z];
    const L = D.Passport.list.filter((e) => e.alive && e.role === 'solid' && kindOf(e) === kind && e.box && (e.box.max[1] - D.groundH(...[entryCentre(e)[0], entryCentre(e)[2]])) > (o.minTop || 0.6) && (!o.filter || o.filter(e)));
    L.sort((a, b) => Math.hypot(entryCentre(a)[0] - ref[0], entryCentre(a)[2] - ref[1]) - Math.hypot(entryCentre(b)[0] - ref[0], entryCentre(b)[2] - ref[1]));
    const out = []; for (const e of L) { if (out.every((u) => Math.hypot(entryCentre(u)[0] - entryCentre(e)[0], entryCentre(u)[2] - entryCentre(e)[2]) > 30)) out.push(e); if (out.length >= n) break; }
    return out;
  };
  // physics cost while walking around at a spot (ms per call of Phys.step and of the character move)
  QR.physCost = async (x, z, ms = 5000) => {
    const P = D.PH.P, ch = D.PH.ch, os = P.step, om = ch.move, st = [], mv = [];
    QA.place(x, z, { yaw: 0 }); await wait(500);
    P.step = function (dt) { const t = performance.now(); const r = os.call(this, dt); st.push(performance.now() - t); return r; };
    ch.move = function (...a) { const t = performance.now(); const r = om.apply(this, a); mv.push(performance.now() - t); return r; };
    const X = D.Passport.EXACT, b0 = X ? { n: X.builds, ms: X.ms } : null;
    D.keys.KeyW = true; const t0 = performance.now();
    try { while (performance.now() - t0 < ms) { await wait(350); D.cam.yaw += 0.7; } } finally { D.keys.KeyW = false; P.step = os; ch.move = om; }
    const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return r3(s[Math.min(s.length - 1, Math.floor(s.length * f))]); };
    const mean = (a) => r3(a.reduce((s, v) => s + v, 0) / Math.max(1, a.length));
    return { stepMean: mean(st), stepP95: q(st, 0.95), moveMean: mean(mv), moveP95: q(mv, 0.95), frames: st.length, exactNear: X ? X.n : null, buildsDuring: X ? X.builds - b0.n : null, buildMsDuring: X ? r3(X.ms - b0.ms) : null };
  };
  // the densest spot of hull-registered (or any solid) entries
  QR.denseSpot = () => { const L = D.Passport.list.filter((e) => e.alive && e.role === 'solid' && e.box && kindOf(e) === 'rock'); let best = null;
    for (let i = 0; i < L.length; i += 2) { const [cx, , cz] = entryCentre(L[i]); let n = 0; for (const u of L) { const [ux, , uz] = entryCentre(u); if ((ux - cx) ** 2 + (uz - cz) ** 2 < 400) n++; } if (!best || n > best.n) best = { x: cx, z: cz, n }; }
    if (best) { const s = clearStart(L.find((e) => Math.hypot(entryCentre(e)[0] - best.x, entryCentre(e)[2] - best.z) < 1e-3) || L[0], 0.5, 6); if (s) { best.x = s.x; best.z = s.z; } }
    return best; };

  /* ================================================================== rules (Part A) */
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const srgb8 = (l) => { l = Math.max(0, Math.min(1, l)); return Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)); };
  const LIN8 = new Float32Array(256).map((_, i) => lin(i / 255));
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const matsOf = (o) => [].concat(o.material || []).filter(Boolean);
  const litMat = (m) => m && !m.isShaderMaterial && !m.isMeshBasicMaterial && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
  const TREE = /veg_tree|tree|bark|needle|leaves|spruce|fir_|birch|snag|krummholz|impost/i;
  const FX = /glow|beam|rune|scan|marker|bolt|fx_|spark|smoke|flame|ember|aurora|sky|moon|star|glass|window|screen|lamp_glow|crystal|shard|heart|spire|portal|echo_fx|hologram|objective/i;
  const nameChain = (o, m) => { let t = (m && m.name) || ''; for (let q = o, k = 0; q && k < 4; q = q.parent, k++) t += '|' + (q.name || '') + '|' + ((q.userData && q.userData.source) || ''); return t; };
  // drawn static meshes the player can walk up to: not terrain / actors / passables (grass, decals) / fx
  // a single continuous surface (the frozen sea, the lake ice sheet) has no in-scene .name (only the JS variable is
  // named) and its own geometry footprint is a whole terrain feature, never a "prop" — GROUNDS misses it by name, so
  // its huge bounding sphere (a real prop tops out around the Kestrel's ~20 m) wrongly "covers" every Passport box in
  // reach and gets attributed to whichever one QR.weathering finds first (REALISM-QA rule 6, wf_fire_ring / st_rowboat
  // false positives — the lake ice sheet, 49 m radius, still reaches the rowboat that sits on the shore next to it).
  // groundblend.js already knows these by direct reference (its flatRoots()); do the same instead of guessing a name,
  // with the size cap only as a backstop for anything else built the same way.
  const flatTerrain = () => new Set([C.sea, C.lakeIce, C.fpMesh, C.WORLD_TERRAIN && C.WORLD_TERRAIN.mesh].filter(Boolean));
  const PROP_R_MAX = 250;
  QR.props = (o = {}) => {
    const acts = new Set(actorRoots()), flat = flatTerrain(), out = [];
    D.scene.traverse((m) => {
      if (!(m.isMesh || m.isInstancedMesh) || m.isSkinnedMesh || m.isSprite || m === D.terrainMesh || flat.has(m) || GROUNDS.test(m.name || '')) return;
      const mat = matsOf(m)[0]; if (!litMat(mat) || (mat.transparent && mat.depthWrite === false)) return;
      const nc = nameChain(m, mat);
      if (PASSABLE.test(nc) || (!o.fx && FX.test(nc))) return;
      for (let q = m; q; q = q.parent) if (acts.has(q)) return;
      if (!visible(m) || (m.isInstancedMesh && m.count < 1)) return;
      const g = m.geometry; if (g) { if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere && g.boundingSphere.radius > PROP_R_MAX) return; }
      out.push({ m, name: m.name || (m.parent && m.parent.name) || m.type, tree: TREE.test(nc), nc });
    });
    return out;
  };
  const _M = new T.Matrix4(), _P = new T.Vector3(), _Q = new T.Quaternion(), _S = new T.Vector3();
  const instancesOf = (m) => { const out = []; if (m.isInstancedMesh) { for (let k = 0; k < m.count; k++) { m.getMatrixAt(k, _M); _M.premultiply(m.matrixWorld); _M.decompose(_P, _Q, _S); out.push({ k, p: [_P.x, _P.y, _P.z], q: [_Q.x, _Q.y, _Q.z, _Q.w], s: [_S.x, _S.y, _S.z] }); } }
    else { m.matrixWorld.decompose(_P, _Q, _S); out.push({ k: 0, p: [_P.x, _P.y, _P.z], q: [_Q.x, _Q.y, _Q.z, _Q.w], s: [_S.x, _S.y, _S.z] }); } return out; };

  /* ---- 1. sizes: Passport boxes, oriented footprint, trunk height, actors ---- */
  function oriented(v, n) {   // min-area rectangle of the xz points (3° steps) → [long, short]
    const step = Math.max(1, Math.floor(n / 600)); let best = null;
    for (let a = 0; a < 90; a += 3) { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
      for (let k = 0; k < n; k += step) { const x = v[k * 3], z = v[k * 3 + 2], u = x * c + z * s, w = -x * s + z * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < w0) w0 = w; if (w > w1) w1 = w; }
      const A = (u1 - u0) * (w1 - w0); if (!best || A < best.A) best = { A, a: u1 - u0, b: w1 - w0 }; }
    return best ? [Math.max(best.a, best.b), Math.min(best.a, best.b)] : [0, 0];
  }
  function skinnedPoints(root, every = 5) {
    const pts = [], v = new T.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (!o.isSkinnedMesh || !visible(o)) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i += every) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); } });
    return pts;
  }
  function actorSize(id, root) {
    if (!root) return { id, skip: 'no actor' };
    const pts = skinnedPoints(root); if (pts.length < 9) return { id, skip: 'no skinned mesh' };
    let y0 = 1e9, y1 = -1e9; for (let i = 1; i < pts.length; i += 3) { y0 = Math.min(y0, pts[i]); y1 = Math.max(y1, pts[i]); }
    const bones = []; root.traverse((o) => { if (o.isBone) { o.getWorldPosition(_P); bones.push({ n: o.name, y: _P.y, parentBone: !!(o.parent && o.parent.isBone), parentName: o.parent && o.parent.name }); } });
    // withers: the first neck bone (its parent is not a neck bone) — at the top of the shoulder blades; else the highest spine bone
    const neck = bones.filter((b) => /neck/i.test(b.n) && !/neck/i.test(b.parentName || '') && !/head/i.test(b.n));
    const spine = bones.filter((b) => /spine|chest|thorax|back|shoulder|scapula|clavicle/i.test(b.n) && !/tail/i.test(b.n));
    const w = neck.length ? neck.sort((a, b) => a.y - b.y)[0] : spine.sort((a, b) => b.y - a.y)[0];
    // shoulder in the REST (bind) pose — the live pose may be sitting / grazing: bone bind position = inverse(boneInverse),
    // vertices at bind = bindMatrix × position; scaled by (current world scale ÷ bind-time scale)
    let rest = null, restBone = null;
    if (w) root.traverse((o) => { if (rest || !o.isSkinnedMesh) return; const sk = o.skeleton, bi = sk.bones.findIndex((b) => b.name === w.n); if (bi < 0) return;
      const bp = new T.Vector3().setFromMatrixPosition(sk.boneInverses[bi].clone().invert()), P = o.geometry.attributes.position, v = new T.Vector3(); let mn = 1e9, top = -1e9;
      const s0 = new T.Vector3().setFromMatrixScale(o.bindMatrix).y, s1 = new T.Vector3().setFromMatrixScale(o.matrixWorld).y, k = s1 / (s0 || 1), rad = 0.05 / k;
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.bindMatrix); mn = Math.min(mn, v.y);
        if (v.y > bp.y - 0.02 / k && Math.hypot(v.x - bp.x, v.z - bp.z) < rad) top = Math.max(top, v.y); }
      // shoulder height as measured on a living animal: ground → top of the coat straight above the withers joint
      // (the base-of-neck bone, rest pose); the bone itself sits 3–6 cm inside the body
      rest = ((top > -1e8 ? top : bp.y) - mn) * k; restBone = (bp.y - mn) * k; });
    return { id, stature: r3(y1 - y0), shoulderPose: w ? r3(w.y - y0) : null, shoulder: rest != null ? r3(rest) : w ? r3(w.y - y0) : null, shoulderAtBone: r3(restBone), shoulderBone: w ? w.n : null, bones: bones.length };
  }
  QR.sizes = () => {
    const rows = [];
    for (const e of D.Passport.list) {
      if (!e.alive || !e.box) continue;
      const k = kindOf(e), c = entryCentre(e), pos = [r3(c[0]), r3(e.box.min[1]), r3(c[2])];
      if (e.role === 'trunk' && e.trunk) rows.push({ kind: k, id: e.id, pos, trunkH: r3((e.trunk.y1 - (e.trunk.y0 + 0.6)) / (e.opts.topFrac || 0.9)) });
      else if (e.geo && e.geo.vn) { const [l, w] = oriented(e.geo.v, e.geo.vn); rows.push({ kind: k, id: e.id, pos, h: r3(e.box.max[1] - e.box.min[1]), l: r3(l), w: r3(w) }); }
    }
    const actors = [actorSize('player', D.player.c && D.player.c.g), actorSize('fox', D.fox && D.fox.g), ...(D.STAGS || []).map((s, i) => actorSize('stags', s.g))];
    return { rows, actors };
  };

  /* ---- 2. albedo: texture average × colour × vertex colour, sRGB 8-bit ---- */
  const avgCache = new Map(), cv = document.createElement('canvas'), cg = cv.getContext('2d', { willReadFrequently: true });
  function texAvg(t) {
    if (!t) return [1, 1, 1, 'none'];
    if (avgCache.has(t.uuid)) return avgCache.get(t.uuid);
    let res = null; const img = t.image, srgbTex = t.colorSpace === T.SRGBColorSpace;
    try {
      if (img && img.data && img.width) {   // DataTexture
        const d = img.data, n = img.width * img.height, ch = Math.round(d.length / n) || 4, f = !(d instanceof Uint8Array || d instanceof Uint8ClampedArray);
        let r = 0, g = 0, b = 0, wsum = 0; const st = Math.max(1, Math.floor(n / 4096));
        for (let i = 0; i < n; i += st) { const o = i * ch, a = ch === 4 ? (f ? d[o + 3] : d[o + 3] / 255) : 1; const cvt = (x) => (f ? x : srgbTex ? LIN8[x] : x / 255);
          r += cvt(d[o]) * a; g += cvt(d[o + (ch > 1 ? 1 : 0)]) * a; b += cvt(d[o + (ch > 2 ? 2 : 0)]) * a; wsum += a; }
        res = wsum ? [r / wsum, g / wsum, b / wsum, 'data'] : null;
      } else if (img && (img.width || img.videoWidth) && (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement || typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap || img instanceof HTMLCanvasElement || typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)) {
        cv.width = 48; cv.height = 48; cg.clearRect(0, 0, 48, 48); cg.drawImage(img, 0, 0, 48, 48);
        const d = cg.getImageData(0, 0, 48, 48).data; let r = 0, g = 0, b = 0, wsum = 0;
        for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; const cvt = (x) => (srgbTex ? LIN8[x] : x / 255); r += cvt(d[i]) * a; g += cvt(d[i + 1]) * a; b += cvt(d[i + 2]) * a; wsum += a; }
        res = wsum ? [r / wsum, g / wsum, b / wsum, 'image'] : null;
      }
    } catch (err) { res = null; }
    avgCache.set(t.uuid, res); return res;
  }
  function vcolAvg(geo) {
    const C0 = geo.attributes.color; if (!C0) return [1, 1, 1];
    let r = 0, g = 0, b = 0; const st = Math.max(1, Math.floor(C0.count / 3000)); let n = 0;
    for (let i = 0; i < C0.count; i += st) { r += C0.getX(i); g += C0.getY(i); b += C0.getZ(i); n++; }
    return [r / n, g / n, b / n];
  }
  const SNOW = /snow|frost|drift|powder|ice_?cap|rime/i;
  QR.albedo = () => {
    const seen = new Map(), acts = actorRoots();
    const visit = (o, actor) => { for (const m of matsOf(o)) { if (!litMat(m)) continue; const key = m.uuid + (m.vertexColors ? '|' + o.geometry.uuid : '');
      if (seen.has(key)) { seen.get(key).meshes++; continue; }
      const nc = nameChain(o, m); if (FX.test(nc) && !actor) continue;
      if (m.emissiveIntensity > 0.5 && m.emissive && lum(m.emissive.r, m.emissive.g, m.emissive.b) > 0.2) continue;   // self-lit
      if (/lamp|light|bulb|emit/i.test(m.name || '')) continue;
      if (!m.map && m.onBeforeCompile && m.onBeforeCompile.toString().length > 40 && m.color && m.color.r > 0.98 && m.color.g > 0.98 && m.color.b > 0.98) { seen.set(key, { mat: m.name || '(unnamed)', mesh: o.name, skip: 'albedo from a shader patch (no map, white colour)', meshes: 1 }); continue; }
      const t = texAvg(m.map); if (!t) { seen.set(key, { mat: m.name || '(unnamed)', mesh: o.name, skip: 'texture unreadable', meshes: 1 }); continue; }
      const vc = m.vertexColors ? vcolAvg(o.geometry) : [1, 1, 1], c = m.color || { r: 1, g: 1, b: 1 };
      const L = [c.r * t[0] * vc[0], c.g * t[1] * vc[1], c.b * t[2] * vc[2]];
      seen.set(key, { mat: m.name || '(unnamed)', mesh: o.name || (o.parent && o.parent.name) || '', actor: !!actor, snow: SNOW.test(m.name || '') || SNOW.test(o.name || ''), src: t[3],
        rgb: L.map(srgb8), v: srgb8(lum(...L)), meshes: 1 }); } };
    for (const p of QR.props({ fx: false })) visit(p.m, false);
    for (const a of acts) a.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && visible(o)) visit(o, true); });
    return [...seen.values()];
  };

  /* ---- 3. frame vs the night photos: references/measure.py, same method, on the final frame ---- */
  QR.frameMeasure = () => new Promise((res) => requestAnimationFrame(() => {
    const src = D.renderer.domElement, W0 = src.width, H0 = src.height, sc = 400 / Math.max(W0, H0), W = Math.round(W0 * sc), H = Math.round(H0 * sc);
    cv.width = W; cv.height = H; cg.drawImage(src, 0, 0, W, H); const d = cg.getImageData(0, 0, W, H).data;
    const px = []; for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    const Y = (p) => 0.2126 * LIN8[p[0]] + 0.7152 * LIN8[p[1]] + 0.0722 * LIN8[p[2]];
    const sat = (p) => { const mx = Math.max(...p); return mx ? (mx - Math.min(...p)) / mx : 0; };
    const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const med = (a) => pct(a, 0.5);
    const ys = px.map(Y), row = (r) => px.slice(r * W, (r + 1) * W);
    const isA = (p) => p[1] > p[0] * 1.3 && p[1] > p[2] * 1.05 && p[1] > 60;
    let snow = []; for (let r = Math.floor(H * 0.4); r < H; r++) for (const p of row(r)) if (sat(p) < 0.45 && p[2] >= p[0] - 15 && Math.max(...p) > 40) snow.push(p);
    snow.sort((a, b) => Y(a) - Y(b));
    const lit = snow.slice(Math.floor(snow.length * 0.8)), shd = snow.slice(Math.floor(snow.length * 0.1), Math.floor(snow.length * 0.3));
    const medRGB = (a) => (a.length >= 30 ? [0, 1, 2].map((i) => med(a.map((p) => p[i]))) : null);
    const band = []; for (let r = Math.floor(H * 0.35); r < Math.floor(H * 0.75); r++) band.push(...row(r));
    const ly = lit.length ? med(lit.map(Y)) : null, sy = shd.length ? med(shd.map(Y)) : null, y95 = pct(ys, 0.95), y05 = pct(ys, 0.05);
    res({ Y_median: r3(med(ys)), Y_p05: r3(y05), Y_p95: r3(y95), snow_lit_rgb: medRGB(lit), snow_shadow_rgb: medRGB(shd), snow_lit_Y: r3(ly), snow_shadow_Y: r3(sy),
      lit_shadow_ratio: ly != null && sy != null ? +((ly + 0.005) / (sy + 0.005)).toFixed(2) : null,
      snow_blue_over_red_lit: lit.length ? r3(med(lit.map((p) => p[2] / Math.max(1, p[0])))) : null, snow_blue_over_red_shadow: shd.length ? r3(med(shd.map((p) => p[2] / Math.max(1, p[0])))) : null,
      dark_frac_midband: r3(band.filter((p) => Y(p) < 0.02).length / Math.max(1, band.length)), michelson_p05_p95: r3((y95 - y05) / (y95 + y05 + 1e-6)), size: [W, H] });
  }));

  /* ---- 4. grounding on the DRAWN snow (ctx.snowField) ---- */
  const surfDrawn = (x, z) => { const f = C.snowField; if (f && f.sample) { const s = f.sample(x, z); if (s && Number.isFinite(s[0])) return s[0]; } return QA.surfCPU(x, z); };
  QR.grounding = () => {
    const rows = [], PH = D.PH, ok = PH && PH.ok, G = ok ? PH.P.groups : null;
    for (const e of D.Passport.list) {
      if (!e.alive || (e.role !== 'solid' && e.role !== 'pushable')) continue;
      let verts = null;
      if (e.role === 'pushable' && e.obj) { const b = new T.Box3().setFromObject(e.obj, true); if (b.isEmpty()) continue; verts = []; for (const x of [b.min.x, (b.min.x + b.max.x) / 2, b.max.x]) for (const z of [b.min.z, (b.min.z + b.max.z) / 2, b.max.z]) verts.push(x, b.min.y, z); verts.push((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2); }
      else if (e.geo) verts = e.geo.v;
      if (!verts || verts.length < 9) continue;
      const n = verts.length / 3; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < n; i++) { const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const N = 4, cell = {}, top = {};
      for (let i = 0; i < n; i++) { const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2], ci = Math.min(N - 1, Math.floor((x - x0) / Math.max(1e-3, x1 - x0) * N)), cj = Math.min(N - 1, Math.floor((z - z0) / Math.max(1e-3, z1 - z0) * N)), k = ci * N + cj;
        if (!cell[k] || y < cell[k][1]) cell[k] = [x, y, z]; if (top[k] === undefined || y > top[k]) top[k] = y; }
      const gaps = [], bur = [];
      for (const [k, [x, y, z]] of Object.entries(cell)) {
        const s = surfDrawn(x, z); let g = y - s;
        if (ok && g > 0.03) { const h = PH.P.raycast({ x, y: y - 0.01, z }, { x: 0, y: -1, z: 0 }, 6, { groups: G.STATIC | G.PROP }); if (h && h.tag && h.tag.kind !== 'terrain' && h.tag.passport !== e.id) g = Math.min(g, h.distance - 0.01); }   // resting on another object
        gaps.push(g); const colH = top[k] - y; if (colH > 0.02) bur.push(Math.min(1, Math.max(0, (s - y) / colH)));
      }
      const minGap = Math.min(...gaps), buried = bur.length ? bur.reduce((a, b) => a + b, 0) / bur.length : 0;
      rows.push({ kind: kindOf(e), id: e.id, role: e.role, minGap: r3(minGap), maxGap: r3(Math.max(...gaps)), air: r3(gaps.filter((g) => g > 0.1).length / gaps.length), buried: r3(buried), height: r3(y1 - y0), pos: [r3((x0 + x1) / 2), r3(y0), r3((z0 + z1) / 2)] });
    }
    return { rows, field: !!(C.snowField && C.snowField.sample) };
  };

  /* ---- 5. texel density (px of the albedo map per metre) ---- */
  const geoCache = new Map();
  function uvStats(geo, ch = 0) {
    const ck = geo.uuid + '|' + ch; if (geoCache.has(ck)) return geoCache.get(ck);
    const P = geo.attributes.position, U = geo.attributes[ch ? 'uv' + ch : 'uv'] || geo.attributes.uv; let res = null;
    if (P && U) { const I = geo.index, n = I ? I.count : P.count, st = Math.max(1, Math.floor(n / 3 / 4000)) * 3; let wa = 0, ua = 0; const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
      for (let t = 0; t + 2 < n; t += st) { const i0 = I ? I.getX(t) : t, i1 = I ? I.getX(t + 1) : t + 1, i2 = I ? I.getX(t + 2) : t + 2;
        a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2); wa += b.sub(a).cross(c.sub(a)).length() / 2;
        const u0 = U.getX(i0), v0 = U.getY(i0), u1 = U.getX(i1) - u0, v1 = U.getY(i1) - v0, u2 = U.getX(i2) - u0, v2 = U.getY(i2) - v0; ua += Math.abs(u1 * v2 - u2 * v1) / 2; }
      res = { wa, ua }; }
    geoCache.set(ck, res); return res;
  }
  QR.texel = () => {
    const out = [];
    for (const p of QR.props()) {
      const m = matsOf(p.m)[0], t = m.map; if (!t || !t.image || !(t.image.width)) continue;
      const u = uvStats(p.m.geometry, t.channel || 0); if (!u || u.wa < 1e-6 || u.ua < 1e-9) continue;
      const rep = (t.repeat ? t.repeat.x * t.repeat.y : 1), dens0 = Math.sqrt(t.image.width * t.image.height * u.ua * rep / u.wa);   // px per local metre
      const inst = instancesOf(p.m); if (!inst.length) continue;
      for (const q of inst.length > 400 ? inst.filter((_, i) => i % Math.ceil(inst.length / 400) === 0) : inst) { const sc = Math.cbrt(Math.abs(q.s[0] * q.s[1] * q.s[2])) || 1; out.push({ name: p.name, mat: m.name, tree: p.tree, p: q.p.map(r3), d: +(dens0 / sc).toFixed(1), tex: [t.image.width, t.image.height] }); }
    }
    return out;
  };

  /* ---- 6a. faceting: smooth-shaded edges whose faces bend > θ and are long on screen ---- */
  // Recalibrated (REALISM-QA 2): (1) the frame is filled by the whole MODEL, not by each of its parts — a tent stake or a
  // stove pipe was blown up to 40 % of the frame on its own; parts of one placed model (same name / same top ancestor)
  // share the model's size. (2) A rough scanned surface bends > 20° everywhere, convex and concave alike (the grain);
  // polygonal corners there are not visible as such. A model whose bent edges are ≥ 30 % concave counts only the edges
  // longer than 2.5 × its median bent edge (flat facets standing out of the grain). (3) Crystals / shards are cut facets
  // by design.
  const FACETED_BY_DESIGN = /crystal|shard|spire|heart|rune|ice_?berg|pressure_ridge|wf_ice/i;
  QR.facet = (o = {}) => {
    const theta = (o.theta || 20) * Math.PI / 180, pxMin = o.px || 10, screen = o.screen || 1720, span = o.span || 0.4, res = new Map();
    const props = QR.props({ fx: true }), modelKey = (m) => { let q = m; while (q.parent && q.parent !== D.scene && (!q.name || q.name === 'Mesh' || /^(Object3D|Group|Mesh)$/.test(q.name))) q = q.parent; return q.name ? q.name : q.uuid; };
    const wsize = (m) => { const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); let sc = m.matrixWorld.getMaxScaleOnAxis(); if (m.isInstancedMesh && m.count) { m.getMatrixAt(0, _M); sc *= _S.setFromMatrixScale(_M).x; } return { d: g.boundingSphere.radius * 2 * sc, sc }; };
    const modelSize = new Map(); for (const p of props) { const k = modelKey(p.m), w = wsize(p.m).d; modelSize.set(k, Math.max(modelSize.get(k) || 0, w)); }
    for (const p of props) {
      const g = p.m.geometry; if (res.has(g.uuid)) { res.get(g.uuid).names.add(p.name); continue; }
      if (FACETED_BY_DESIGN.test(p.nc)) continue;
      const P = g.attributes.position, N = g.attributes.normal; if (!P || !N) continue;
      const W = wsize(p.m); if (W.d < 0.05) continue; const mk = modelKey(p.m), size = Math.max(W.d, modelSize.get(mk) || 0) / W.sc;   // model size in this geometry's units
      // weld by position + normal: a shared (pos, normal) vertex = smooth shading across the edge
      const key = new Array(P.count), map = new Map();
      for (let i = 0; i < P.count; i++) { const k = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4) + ',' + Math.round(N.getX(i) * 50) + ',' + Math.round(N.getY(i) * 50) + ',' + Math.round(N.getZ(i) * 50);
        let id = map.get(k); if (id === undefined) map.set(k, id = map.size); key[i] = id; }
      const I = g.index, n = I ? I.count : P.count, fn = [], fc = [], edges = new Map(); const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
      for (let t = 0; t + 2 < n; t += 3) { const i0 = I ? I.getX(t) : t, i1 = I ? I.getX(t + 1) : t + 1, i2 = I ? I.getX(t + 2) : t + 2;
        a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2); const nn = new T.Vector3().subVectors(b, a).cross(c.clone().sub(a)); if (nn.lengthSq() < 1e-14) continue; nn.normalize(); const f = fn.push(nn) - 1; fc.push(a.clone().add(b).add(c).multiplyScalar(1 / 3));
        for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) { const ku = key[u], kv = key[v], ek = ku < kv ? ku + '_' + kv : kv + '_' + ku; let E = edges.get(ek); if (!E) edges.set(ek, E = { f: [], L: a.fromBufferAttribute(P, u).distanceTo(b.fromBufferAttribute(P, v)) }); E.f.push(f); } }
      let Ls = 0; const bent = [];
      for (const E of edges.values()) { if (E.f.length !== 2) continue; const [f0, f1] = E.f, ang = Math.acos(Math.max(-1, Math.min(1, fn[f0].dot(fn[f1])))); Ls += E.L;
        if (ang > theta) bent.push({ L: E.L, concave: fn[f0].dot(b.subVectors(fc[f1], fc[f0])) > 0 }); }
      const bentL = bent.reduce((q, e) => q + e.L, 0), concShare = bentL ? bent.filter((e) => e.concave).reduce((q, e) => q + e.L, 0) / bentL : 0, rough = concShare >= 0.3;
      // a decimated LOD of a scan halves the grain triangle count but keeps the same coarse bends, so its bent edges are
      // relatively longer as a share of the (smaller) mesh — the median itself shrinks less than a real facet would;
      // scale the multiplier down with edge count so a coarse LOD isn't flagged for the same grain a fine LOD passes
      const med = bent.length ? bent.map((e) => e.L).sort((x, y) => x - y)[bent.length >> 1] : 0, minL = Math.max(pxMin / (span * screen) * size, rough ? (2.5 + 300 / Math.max(30, bent.length)) * med : 0);
      let Lf = 0, nf = 0; for (const e of bent) if (e.L > minL) { Lf += e.L; nf++; }
      res.set(g.uuid, { names: new Set([p.name]), model: mk, tris: Math.round(n / 3), size: r3(size * W.sc), smoothLen: r3(Ls), facetedShare: Ls ? r3(Lf / Ls) : 0, facetedEdges: nf, concaveShare: r3(concShare), rough, tree: p.tree });
    }
    return [...res.values()].map((r) => Object.assign(r, { names: [...r.names].slice(0, 4) }));
  };

  /* ---- 6b. repetition: identical instances side by side (same geometry, rotation, scale, tint) ---- */
  QR.repetition = (o = {}) => {
    const byGeo = new Map();
    for (const p of QR.props()) {
      const g = p.m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      for (const q of instancesOf(p.m)) {
        const r = g.boundingSphere.radius * Math.max(...q.s.map(Math.abs)); if (r < (o.minR || 0.25)) continue;
        let tint = null; if (p.m.instanceColor) { const c = p.m.instanceColor; tint = [c.getX(q.k), c.getY(q.k), c.getZ(q.k)]; }
        if (!byGeo.has(g.uuid)) byGeo.set(g.uuid, { name: p.name, list: [] }); byGeo.get(g.uuid).list.push(Object.assign(q, { r, tint }));
      }
    }
    const pairs = [], qa = new T.Quaternion(), qb = new T.Quaternion();
    for (const { name, list } of byGeo.values()) {
      const grid = new Map(), CS = 8, key = (x, z) => Math.floor(x / CS) + ',' + Math.floor(z / CS);
      for (const q of list) { const k = key(q.p[0], q.p[2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q); }
      for (const q of list) { const gx = Math.floor(q.p[0] / CS), gz = Math.floor(q.p[2] / CS);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const u of grid.get((gx + i) + ',' + (gz + j)) || []) {
          if (u === q || u.p[0] + u.p[2] * 1e-3 < q.p[0] + q.p[2] * 1e-3) continue;
          const d = Math.hypot(u.p[0] - q.p[0], u.p[2] - q.p[2]); if (d < 0.05 || d > Math.max(o.near || 2.5, 2.2 * Math.max(q.r, u.r))) continue;   // d < 5 cm = parts of one object
          qa.fromArray(q.q); qb.fromArray(u.q); const ang = qa.angleTo(qb) * 180 / Math.PI, sr = Math.abs(u.s[0] / q.s[0] - 1);
          const td = q.tint && u.tint ? Math.max(...q.tint.map((v, k) => Math.abs(v - u.tint[k]))) : 0;
          if (ang < (o.deg || 6) && sr < (o.scale || 0.04) && td < 0.02) pairs.push({ name, a: q.p.map(r3), b: u.p.map(r3), d: r3(d), deg: r3(ang), scale: r3(sr) });
        } }
    }
    const seen = new Set(); return pairs.filter((p) => { const k = p.a.join() + '|' + p.b.join(); if (seen.has(k)) return false; seen.add(k); return true; });
  };

  /* ---- 6c. weathering: static props carry top snow + base contact grime (compiled uniforms) ---- */
  // thin parts (guy cords, cables, ropes, stakes, wires, straps): no top face to hold snow, no base on the ground —
  // groundblend skips them by design (RX_SKIP), so the rule does too
  const THIN = /cord|cable|rope|guy_|stake|wire|strap/i;
  QR.weathering = () => {
    const R = D.renderer, prev = R.getRenderTarget();
    try { if (D.post && D.post.sceneRT) R.setRenderTarget(D.post.sceneRT); R.compile(D.scene, D.camera); } finally { R.setRenderTarget(prev); }
    const boxes = D.Passport.list.filter((e) => e.alive && e.box && (e.role === 'solid' || e.role === 'pushable'));
    const out = new Map(), bb = new T.Box3(), sp = new T.Sphere();
    for (const p of QR.props()) {
      if (p.tree) continue;
      const g = p.m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      const inst = instancesOf(p.m).slice(0, 50); let hit = null;
      for (const q of inst) { sp.center.set(...q.p); sp.radius = g.boundingSphere.radius * Math.max(...q.s.map(Math.abs)); hit = boxes.find((e) => { bb.min.set(...e.box.min); bb.max.set(...e.box.max); return bb.intersectsSphere(sp); }); if (hit) break; }
      if (!hit) continue;   // not a collider-backed prop (fx, interior, far scenery)
      for (const m of matsOf(p.m)) { if (!litMat(m) || THIN.test(m.name || '')) continue; const k = m.uuid; if (out.has(k)) { out.get(k).meshes.add(p.name); continue; }
        const u = (R.properties.get(m) || {}).uniforms || {}; const names = Object.keys(u);
        const snowK = names.filter((n) => /^(uSc|tSc|tVSnow|tSnow|uVSnow|uSnow|uCap)/.test(n)), amt = u.uScAmt ? u.uScAmt.value : null;
        out.set(k, { mat: m.name || '(unnamed)', kind: kindOf(hit), meshes: new Set([p.name]), compiled: names.length > 0, snow: snowK.length > 0 && amt !== 0, snowAmt: amt, grime: names.some((n) => /^(tGb|uGbM)/.test(n)), uniforms: names.filter((n) => /^(u|t)[A-Z]/.test(n)).slice(0, 14) });
      }
    }
    return [...out.values()].map((r) => Object.assign(r, { meshes: [...r.meshes].slice(0, 4) }));
  };
})();
