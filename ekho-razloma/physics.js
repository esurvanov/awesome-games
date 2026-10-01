/* physics.js — Rapier-backed physics for open-world.html
 *
 * Classic script (no `type="module"` needed). Loads Rapier (WASM embedded as base64,
 * no extra fetches) via dynamic import from jsDelivr, exposes:
 *   window.Phys       — API object (usable after PhysReady resolves)
 *   window.PhysReady  — Promise<Phys>
 *
 * Coordinates: world units = metres, Y up. Positions of characters are FEET positions
 * (same convention as `player.y` in open-world.html).
 *
 * Override the engine URL (e.g. for Node tests / offline) by setting
 * globalThis.PHYS_RAPIER_URL before this script runs.
 */
(function (root) {
  'use strict';
  const RAPIER_URL = root.PHYS_RAPIER_URL || 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.20.0/dist/rapier.mjs';

  // collision groups (membership bits). STATIC = terrain, ice and exact 'solid' shapes (camera collides with these);
  // TRUNK = thin tree/pole colliders (block bodies, ignored by the camera ray)
  const G_STATIC = 1, G_CHAR = 2, G_DEBRIS = 4, G_PROP = 8, G_VEHICLE = 16, G_TRUNK = 32, G_ALL = 0xffff;
  const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

  let R = null, world = null, cfg = null;
  const debris = [], vehicles = [], characters = [], tags = new Map(); // collider handle -> tag
  let acc = 0, alpha = 0, dirtyStatic = false, dirtyEpoch = 0, stepCount = 0;
  const FIXED = 1 / 60, MAX_SUB = 5;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const len3 = (v) => Math.hypot(v.x, v.y, v.z);
  // rotate vector by quaternion
  function qrot(q, v, out = v3()) {
    const { x, y, z } = v, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
  }
  function slerpInto(out, a, b, t) { // nlerp is enough for small per-step deltas
    let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, s = d < 0 ? -1 : 1;
    out.x = a.x + (b.x * s - a.x) * t; out.y = a.y + (b.y * s - a.y) * t; out.z = a.z + (b.z * s - a.z) * t; out.w = a.w + (b.w * s - a.w) * t;
    const l = Math.hypot(out.x, out.y, out.z, out.w) || 1; out.x /= l; out.y /= l; out.z /= l; out.w /= l; return out;
  }
  function need() { if (!world) throw new Error('Phys: call Phys.init() after PhysReady'); }
  function flushQueries() { // make freshly-added static colliders visible to queries before first step
    if (!dirtyStatic) return;
    const ts = world.timestep; world.timestep = 1e-6; world.step(); world.timestep = ts; dirtyStatic = false;
  }
  function tag(col, t) { tags.set(col.handle, t); return col; }

  /* ------------------------------------------------------------------ init */
  function init(o) {
    const { H, VN, CELL, W } = o;
    const seaLevel = o.seaLevel ?? 0;
    cfg = { gravity: o.gravity ?? 20, seaLevel, W, CELL, VN };
    world = new R.World(v3(0, -cfg.gravity, 0));
    world.timestep = FIXED;
    const RES = VN - 1;
    // Rapier heightfield = column-major matrix, row index -> local z, column index -> local x.
    // hs[iz + ix*VN] = H[iz*VN + ix] reproduces getH() exactly, including the
    // (a,b,d)/(b,c,d) triangle split (verified in tests: max error ~1e-5 m).
    const hs = new Float32Array(VN * VN);
    for (let iz = 0; iz < VN; iz++) for (let ix = 0; ix < VN; ix++) hs[iz + ix * VN] = H[iz * VN + ix];
    const hf = R.ColliderDesc.heightfield(RES, RES, hs, v3(W, 1, W))
      .setFriction(0.8).setCollisionGroups(groups(G_STATIC, G_ALL));
    tag(world.createCollider(hf), { kind: 'terrain' });
    // frozen sea: a thick slab whose top is y = seaLevel (walkable, covers terrain below 0)
    const sea = R.ColliderDesc.cuboid(W * 2, 5, W * 2).setTranslation(0, seaLevel - 5, 0)
      .setFriction(0.15).setCollisionGroups(groups(G_STATIC, G_ALL));
    tag(world.createCollider(sea), { kind: 'ice' });
    world.step(); // build broad-phase so queries work immediately
    return api;
  }

  /* --------------------------------------------------------------- statics */
  function addStaticCylinder(x, z, r, yBottom, height, userTag, group) {
    need();
    const d = R.ColliderDesc.cylinder(height / 2, r).setTranslation(x, yBottom + height / 2, z)
      .setFriction(0.5).setCollisionGroups(groups(group ?? G_STATIC, G_ALL));
    dirtyStatic = true; dirtyEpoch++;
    return tag(world.createCollider(d), userTag || { kind: 'static' });
  }
  // exact static mesh (object passport 'solid'): world-space vertices + triangle indices
  function addStaticTrimesh(vertices, indices, userTag, o = {}) {
    need();
    const v = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
    const ix = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
    const TF = R.TriMeshFlags, flags = TF && !o.raw ? (TF.FIX_INTERNAL_EDGES | TF.DELETE_BAD_TOPOLOGY_TRIANGLES | TF.DELETE_DEGENERATE_TRIANGLES) : undefined; // fixed internal edges: no bumps sliding over seams
    let d = null;
    try { d = flags !== undefined ? R.ColliderDesc.trimesh(v, ix, flags) : R.ColliderDesc.trimesh(v, ix); } catch (e) { d = null; }
    if (!d) d = R.ColliderDesc.trimesh(v, ix);
    d.setFriction(o.friction ?? 0.6).setCollisionGroups(groups(o.group ?? G_STATIC, G_ALL));
    dirtyStatic = true; dirtyEpoch++;
    return tag(world.createCollider(d), Object.assign({ kind: 'static' }, userTag, { center: vertsCenter(v) }));
  }
  // static convex hull of world-space points (small rocks, crystals)
  function addStaticConvex(points, userTag, o = {}) {
    need();
    const pv = points instanceof Float32Array ? points : new Float32Array(points);
    const d = R.ColliderDesc.convexHull(pv);
    if (!d) return null;
    d.setFriction(o.friction ?? 0.6).setCollisionGroups(groups(o.group ?? G_STATIC, G_ALL));
    dirtyStatic = true; dirtyEpoch++;
    return tag(world.createCollider(d), Object.assign({ kind: 'static' }, userTag, { center: vertsCenter(pv) }));
  }
  function addStaticBox(c, he, q, userTag) {
    need();
    const d = R.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(c.x, c.y, c.z)
      .setFriction(0.6).setCollisionGroups(groups(G_STATIC, G_ALL));
    if (q) d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    dirtyStatic = true; dirtyEpoch++;
    return tag(world.createCollider(d), userTag || { kind: 'static' });
  }
  function removeCollider(col) { if (col) { tags.delete(col.handle); world.removeCollider(col, true); dirtyEpoch++; } }
  // world-space AABB centre of a flat [x,y,z,...] array: 'solid' colliders bake world-space vertices with the collider's
  // own translation left at the Rapier default (0,0,0) — .translation() on them always reads back (0,0,0), it is NOT
  // where the mesh actually sits (unstick() used to push players away from the map origin instead of the obstacle).
  function vertsCenter(v) {
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i + 2 < v.length; i += 3) {
      const x = v[i], y = v[i + 1], z = v[i + 2];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    return { x: (mnx + mxx) / 2, y: (mny + mxy) / 2, z: (mnz + mxz) / 2 };
  }

  /* ------------------------------------------------------------- raycast */
  const _ray = { o: v3(), d: v3() };
  function raycast(origin, dir, maxDist = 1000, opts = {}) {
    need(); flushQueries();
    const l = len3(dir) || 1;
    const ray = new R.Ray(v3(origin.x, origin.y, origin.z), v3(dir.x / l, dir.y / l, dir.z / l));
    // default: ignore characters and debris shards (camera / aiming)
    const filter = opts.groups ?? (G_STATIC | G_TRUNK | G_PROP | G_VEHICLE | (opts.debris ? G_DEBRIS : 0) | (opts.characters ? G_CHAR : 0));
    const hit = world.castRayAndGetNormal(ray, maxDist, true, undefined, groups(G_ALL, filter), opts.excludeCollider, opts.excludeBody);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      distance: t,
      point: v3(ray.origin.x + ray.dir.x * t, ray.origin.y + ray.dir.y * t, ray.origin.z + ray.dir.z * t),
      normal: v3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider, tag: tags.get(hit.collider.handle) || null,
    };
  }
  // swept sphere (camera boom, ledge probes). Same filters as raycast.
  function sphereCast(origin, dir, maxDist, radius, opts = {}) {
    need(); flushQueries();
    const l = len3(dir) || 1, d = v3(dir.x / l, dir.y / l, dir.z / l);
    const filter = opts.groups ?? (G_STATIC | G_TRUNK | G_PROP | G_VEHICLE);
    const hit = world.castShape(v3(origin.x, origin.y, origin.z), { x: 0, y: 0, z: 0, w: 1 }, d, new R.Ball(radius), 0, maxDist, false, undefined, groups(G_ALL, filter), opts.excludeCollider, opts.excludeBody);
    if (!hit) return null;
    const t = hit.time_of_impact ?? hit.toi;
    return { distance: t, point: v3(origin.x + d.x * t, origin.y + d.y * t, origin.z + d.z * t), normal: hit.normal1 ? v3(hit.normal1.x, hit.normal1.y, hit.normal1.z) : null,
      collider: hit.collider, tag: tags.get(hit.collider.handle) || null };
  }
  // ground height (terrain/ice/static tops) under x,z — handy replacement for groundH()
  function groundY(x, z, fromY = 500) { const h = raycast(v3(x, fromY, z), v3(0, -1, 0), fromY + 50, { groups: G_STATIC }); return h ? h.point.y : cfg.seaLevel; }
  // like groundY/raycast, but a stack of colliders at this x,z (a jutting crystal shard over a rock ledge, a low
  // overhanging branch over the true floor) can put something un-walkable as the very first hit; a caller that just
  // takes that first hit (spawn/teleport placement, the character controller's own unstick()) perches the character
  // on a surface it immediately slides or falls off. This walks down through the stack instead, returning the first
  // hit at or under maxSlope (default 45°, matching the character's own walkable threshold), or the raw first hit
  // if nothing in range qualifies (still better than finding nothing at all).
  function groundYWalkable(x, z, opts = {}) {
    const cosMax = opts.cosMax ?? Math.SQRT1_2, maxIter = opts.maxIter ?? 6;
    let y = opts.fromY ?? 500, bottom = opts.bottom ?? y - 100, first = null;
    for (let i = 0; i < maxIter && y > bottom; i++) {
      const h = raycast(v3(x, y, z), v3(0, -1, 0), y - bottom, { groups: G_STATIC, excludeCollider: opts.excludeCollider });
      if (!h) break;
      if (!first) first = h;
      if (h.normal.y >= cosMax - 1e-3) return h;
      y = h.point.y - 0.05;
    }
    return first;
  }

  /* ----------------------------------------------------------- character */
  function createCharacter(o = {}) {
    need(); flushQueries();
    const P = {
      radius: o.radius ?? 0.4, height: o.height ?? 1.8,
      gravity: o.gravity ?? 28,          // game used 28
      jumpHeight: o.jumpHeight ?? 2.0,   // -> v0 = sqrt(2 g h) ≈ 10.6 m/s (game used 10.5)
      groundAccel: o.groundAccel ?? 60,  // m/s² towards desired velocity
      groundDecel: o.groundDecel ?? 45,  // m/s² friction when no input
      airAccel: o.airAccel ?? 9,         // reduced air control
      airDrag: o.airDrag ?? 0.05,
      maxSlope: (o.maxSlopeDeg ?? 45) * Math.PI / 180,
      slideFriction: o.slideFriction ?? 0.15,
      stepHeight: o.stepHeight ?? 0.4,
      snap: o.snapDistance ?? 0.5,
      coyote: o.coyoteTime ?? 0.12, buffer: o.jumpBuffer ?? 0.12,
      mass: o.mass ?? 80, skin: 0.02,
      unstickEvery: Math.max(1, o.unstickEvery | 0 || 1),   // weak profiles: check less often (still forced right after a teleport/placement)
    };
    // slim: next to a solid the slim.test(tag) accepts (rocks), the capsule narrows to slim.r — a 0.4 m radius keeps the
    // body axis ~45 cm off a drawn rock face (chest ~30 cm off it) and no 0.6–0.8 m gap between two rocks lets it in.
    // The height and the feet stay put (half-cylinder + radius constant); growing back is gradual and only into free space.
    P.radiusBase = P.radius; const slim = o.slim && o.slim.r > 0.1 && o.slim.r < P.radius ? o.slim : null;
    let halfCyl = Math.max(0.01, P.height / 2 - P.radius);
    const centerOff = P.height / 2 + P.skin;               // feet -> capsule center
    const col = world.createCollider(R.ColliderDesc.capsule(halfCyl, P.radius)
      .setTranslation(o.x ?? 0, (o.y ?? 0) + centerOff, o.z ?? 0)
      .setCollisionGroups(groups(G_CHAR, G_STATIC | G_TRUNK | G_PROP | G_VEHICLE)));
    tag(col, { kind: 'character' });
    const kcc = world.createCharacterController(P.skin);
    kcc.setUp(v3(0, 1, 0));
    kcc.setMaxSlopeClimbAngle(P.maxSlope);
    kcc.setMinSlopeSlideAngle(P.maxSlope + 0.02);
    kcc.enableAutostep(P.stepHeight, 0.15, false);
    kcc.enableSnapToGround(P.snap);
    kcc.setSlideEnabled(true);
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(P.mass);
    const kccGroups = groups(G_CHAR, G_STATIC | G_TRUNK | G_PROP | G_VEHICLE);
    const cosMax = Math.cos(P.maxSlope);

    const s = {
      vel: v3(), pos: v3(o.x ?? 0, o.y ?? 0, o.z ?? 0), prev: v3(o.x ?? 0, o.y ?? 0, o.z ?? 0),
      acc: 0, grounded: false, walkable: false, coyoteT: 0, bufT: 0, jumping: false, enabled: true,
      normal: v3(0, 1, 0), slideDir: null, airT: 0, actual: v3(),
      unstickN: 0, forceUnstick: true, staticSeen: dirtyEpoch,   // first move() always checks (spawn may start inside something)
    };
    const out = { position: v3(), velocity: v3(), grounded: false, landed: false, landingSpeed: 0, slideDir: null, groundNormal: v3(0, 1, 0), sliding: false, jumped: false };
    const tmpT = v3();

    let probeBall = new R.Ball(P.radius * 0.9); const qId = { x: 0, y: 0, z: 0, w: 1 }, down = v3(0, -1, 0);
    const probeGroups = groups(G_ALL, G_STATIC | G_PROP | G_VEHICLE);
    function probeGround(c) {
      const foot = v3(c.x, c.y - halfCyl, c.z);
      // 1) straight ray: exact support under the feet (step tops, flat ground)
      const h = world.castRayAndGetNormal(new R.Ray(foot, down), P.radius + 0.35, true, undefined, probeGroups, col);
      if (h && h.normal.y >= cosMax - 1e-3) return { d: h.timeOfImpact - P.radius, n: h.normal };
      // 2) sphere sweep: catches steep slopes the ray misses (contact is off to the side)
      const sh = world.castShape(foot, qId, down, probeBall, 0, 0.3, false, undefined, probeGroups, col);
      if (sh) { const n = sh.normal1, k = n.y < 0 ? -1 : 1; return { d: sh.time_of_impact - P.radius * 0.1, n: v3(n.x * k, n.y * k, n.z * k) }; }
      return h ? { d: h.timeOfImpact - P.radius, n: h.normal } : null;
    }

    function sub(dt, desired, jumpNow) {
      const v = s.vel;
      if (jumpNow) s.bufT = P.buffer;
      // --- horizontal control
      let tx = desired.x || 0, tz = desired.z || 0;
      // a goal (setGoal): the wanted velocity is toward the point, at most goal.v, never past it — the way others "place" the body
      // (the pose / rock modules) without writing its position: the controller still collides, steps, slides
      if (s.goal) { const c0 = col.translation(), gx = s.goal.x - c0.x, gz = s.goal.z - c0.z, gl = Math.hypot(gx, gz); if (gl < 0.001) { tx = 0; tz = 0; } else { const sp = Math.min(s.goal.v, gl / dt); tx = gx / gl * sp; tz = gz / gl * sp; } }
      const hasInput = tx * tx + tz * tz > 1e-4;
      if (s.walkable) {
        const a = hasInput ? P.groundAccel : P.groundDecel;
        let dx = tx - v.x, dz = tz - v.z; const dl = Math.hypot(dx, dz), m = a * dt;
        if (dl > m) { dx *= m / dl; dz *= m / dl; }
        v.x += dx; v.z += dz;
      } else if (s.slideDir) { // steep slope: gravity along the plane, tiny control
        const n = s.normal, g = P.gravity;
        // g_par = g_vec - (g_vec·n) n, with g_vec = (0,-g,0)
        const gx = -(-g * n.y) * n.x, gy = -g - (-g * n.y) * n.y, gz = -(-g * n.y) * n.z;
        const fr = P.slideFriction * g * n.y; // kinetic friction decel
        const sp = Math.hypot(v.x, v.y, v.z);
        v.x += gx * dt; v.y += gy * dt; v.z += gz * dt;
        if (sp > 0.01) { const k = Math.max(0, 1 - fr * dt / sp); v.x *= k; v.y *= k; v.z *= k; }
        if (hasInput) { v.x += tx * 0.15 * dt; v.z += tz * 0.15 * dt; }
      } else { // air
        if (hasInput) {
          let dx = tx - v.x, dz = tz - v.z; const dl = Math.hypot(dx, dz), m = P.airAccel * dt;
          if (dl > m) { dx *= m / dl; dz *= m / dl; }
          v.x += dx; v.z += dz;
        }
        const k = Math.exp(-P.airDrag * dt); v.x *= k; v.z *= k;
      }
      // --- jump (buffer + coyote)
      let jumped = false;
      if (s.bufT > 0 && s.coyoteT > 0 && !s.jumping) {
        v.y = Math.sqrt(2 * P.gravity * P.jumpHeight);
        s.bufT = 0; s.coyoteT = 0; s.jumping = true; jumped = true; s.walkable = false;
      }
      // --- gravity
      const vy0 = v.y;
      if (!s.slideDir) v.y -= P.gravity * dt;
      if (s.walkable && v.y < -2) v.y = -2; // keep contact on ground, no accumulated fall
      const preVy = v.y;
      // --- resolve with KCC
      if (v.y > 0.5) kcc.disableSnapToGround(); else kcc.enableSnapToGround(P.snap);
      tmpT.x = v.x * dt; tmpT.y = (s.slideDir ? v.y : (vy0 + v.y) * 0.5) * dt; tmpT.z = v.z * dt; // trapezoid: exact ballistic arcs
      kcc.computeColliderMovement(col, tmpT, undefined, kccGroups);
      const mv = kcc.computedMovement();
      const c = col.translation();
      const nc = v3(c.x + mv.x, c.y + mv.y, c.z + mv.z);
      col.setTranslation(nc);
      // --- post: ground classification
      const g = kcc.computedGrounded();
      const pr = probeGround(nc);
      const wasAir = !s.walkable && !s.slideDir;
      s.normal = pr ? v3(pr.n.x, pr.n.y, pr.n.z) : v3(0, 1, 0);
      const near = pr && pr.d < 0.12;
      const onGround = (g || near) && preVy <= 0.5;
      s.walkable = onGround && s.normal.y >= cosMax - 1e-3;
      const steep = onGround && !s.walkable;
      if (steep) {
        const h = Math.hypot(s.normal.x, s.normal.z) || 1;
        s.slideDir = { x: s.normal.x / h, z: s.normal.z / h };
      } else s.slideDir = null;
      // --- velocity from actual movement (walls / ceilings / slopes kill momentum)
      const ax = mv.x / dt, ay = mv.y / dt, az = mv.z / dt;
      s.actual.x = ax; s.actual.y = ay; s.actual.z = az;
      // on walkable ground keep the intended velocity (the character keeps pushing, which lets
      // autostep work); in the air / while sliding, collisions eat momentum.
      if (!s.walkable) { const hv2 = v.x * v.x + v.z * v.z, ah2 = ax * ax + az * az; if (ah2 < hv2 * 0.998) { v.x = ax; v.z = az; } }
      if (steep) { v.y = ay; }
      else if (s.walkable) { v.y = 0; }
      else if (v.y > 0 && ay < v.y * 0.9) v.y = ay; // bonked a ceiling
      // --- landing / timers
      let landed = false, landingSpeed = 0;
      if (s.walkable) {
        if (wasAir || s.airT > 0.05) { landed = s.airT > 0.05; landingSpeed = Math.max(0, -preVy); }
        s.coyoteT = P.coyote; s.jumping = false; s.airT = 0;
      } else {
        s.coyoteT -= dt; s.airT += dt;
        if (s.jumping && v.y <= 0) s.jumping = false;
      }
      s.bufT -= dt;
      return { landed, landingSpeed, jumped };
    }

    // Un-stick: a capsule that starts *inside* a trimesh (teleport, respawn, a collider appearing around the player)
    // makes the controller grind through every overlapping triangle each substep (tens of ms per frame). Detect real
    // penetration with a slightly shrunk capsule and lift the character onto the surface above (or push it out).
    // Margin was 0.12 (only caught a spawn dropped deep inside something); walking (not spawning) into a concave
    // notch of a scanned rock/crystal/prop can wedge the capsule 5-27 cm deep and rest there forever (REALISM-QA
    // negative gaps) without ever tripping a 0.12 m core. 0.06 still leaves a 3x margin over the 2 cm skin, so
    // ordinary resting/pushing contact (which the KCC itself keeps within skin) never triggers it.
    let coreShape = new R.Capsule(Math.max(0.01, halfCyl - 0.05), Math.max(0.05, P.radius - 0.06));
    function applyRadius(r) {
      P.radius = r; halfCyl = Math.max(0.01, P.height / 2 - r);
      col.setShape(new R.Capsule(halfCyl, r)); probeBall = new R.Ball(r * 0.9);
      coreShape = new R.Capsule(Math.max(0.01, halfCyl - 0.05), Math.max(0.05, r - 0.06));
    }
    // does a capsule of radius r at the current centre overlap anything solid (terrain / ice excluded, like unstick)?
    function overlapsAt(r) {
      const c = col.translation(); let hit = false;
      world.intersectionsWithShape(c, qId, new R.Capsule(Math.max(0.01, P.height / 2 - r), r), (other) => { const t = tags.get(other.handle); if (!t || (t.kind !== 'terrain' && t.kind !== 'ice')) { hit = true; return false; } return true; }, undefined, groups(G_ALL, G_STATIC | G_TRUNK | G_PROP), col);
      return hit;
    }
    // a slim-able solid within reach of the base-radius body (chest / knee height, + slim.reach, default 0.18 m)?
    let slimProbe = slim ? new R.Ball(P.radiusBase + (slim.reach > 0 ? slim.reach : 0.18)) : null, slimReach = slim && slim.reach > 0 ? slim.reach : 0.18;
    function nearSlimSolid() {
      const c = col.translation(); let near = false;
      if (slim.reach > 0 && Math.abs(slim.reach - slimReach) > 1e-4) { slimReach = slim.reach; slimProbe = new R.Ball(P.radiusBase + slimReach); }   // the caller set it from BodySpec after creation
      for (const dy of [-0.35, 0.35]) {
        world.intersectionsWithShape(v3(c.x, c.y + dy, c.z), qId, slimProbe, (other) => { const t = tags.get(other.handle); if (t && slim.test(t)) { near = true; return false; } return true; }, undefined, groups(G_ALL, G_STATIC), col);
        if (near) break;
      }
      return near;
    }
    // the slim radius for the wall the body is next to. A circle cannot be flush with a wall in front (chest half-depth, ~0.1 m)
    // AND with one at the side (shoulder half-width, ~0.27 m): with slim.shape = { front, back, side } (metres from the capsule
    // axis to the drawn chest front / back / shoulder, BodySpec) and slim.facing() = [fx, fz] (where the drawn chest looks), the
    // body is an ellipse and the radius is its support distance toward the nearest wall (ray fan at pelvis + chest height; the
    // wall direction = minus the hit normal). Radius = support - skin, so the drawn chest/back/shoulder just meets the face.
    // No wall found by the rays, or no shape/facing yet: slim.r (the conservative circle).
    const SLIM_DIRS = []; for (let i = 0; i < 12; i++) SLIM_DIRS.push([Math.cos(i * Math.PI / 6), Math.sin(i * Math.PI / 6)]);
    function slimRadius() {
      const sh = slim.shape, fc = slim.facing && slim.facing();
      if (!sh || !fc) return slim.r;
      const c = col.translation(), len = P.radiusBase + (slim.reach > 0 ? slim.reach : 0.18) + 0.1;
      let best = 1e9, nx = 0, nz = 0;
      for (const dy of [0.0, 0.35]) for (const d of SLIM_DIRS) {
        const hit = world.castRayAndGetNormal(new R.Ray(v3(c.x, c.y + dy, c.z), v3(d[0], 0, d[1])), len, true, undefined, groups(G_ALL, G_STATIC), col);
        if (!hit || hit.timeOfImpact >= best) continue;
        const t = tags.get(hit.collider.handle); if (!t || !slim.test(t)) continue;
        const hl = Math.hypot(hit.normal.x, hit.normal.z); if (hl < 0.35) continue;   // floor / roof of a rock: not a wall
        best = hit.timeOfImpact; nx = -hit.normal.x / hl; nz = -hit.normal.z / hl;    // body → wall
      }
      if (best > 1e8) return slim.r;
      const fl = Math.hypot(fc[0], fc[1]) || 1, al = (nx * fc[0] + nz * fc[1]) / fl, la = (nx * -fc[1] + nz * fc[0]) / fl;   // along the facing / across it
      const e = al >= 0 ? sh.front : sh.back, h = Math.hypot(e * al, sh.side * la);
      return Math.max(0.06, Math.min(slim.r, h - P.skin));   // never wider than slim.r (the old circle: the shoulder-ish cap)
    }
    function slimStep() {
      if (!slim || !s.enabled) return;
      if ((s.slimN = ((s.slimN || 0) + 1) % 3) === 0) { s.slimNear = nearSlimSolid(); s.slimWant = s.slimNear ? slimRadius() : P.radiusBase; }   // 3 frames ≈ 50 ms: cheap, still ahead of a run (0.6 m)
      const want = s.slimNear ? (s.slimWant || slim.r) : P.radiusBase;
      if (want < P.radius - 1e-3) { applyRadius(want); out.slim = true; }        // narrowing never creates an overlap: at once
      else if (want > P.radius + 1e-3) {                                          // widening: 1.5 cm a frame, only into free space
        const r = Math.min(want, P.radius + 0.015);
        if (!overlapsAt(r)) applyRadius(r);
        out.slim = P.radius < P.radiusBase - 1e-3;
      }
    }
    const stuckGroups = groups(G_ALL, G_STATIC | G_TRUNK);
    function unstick() {
      const c = col.translation(); let hit = null, hitTag = null;
      world.intersectionsWithShape(c, qId, coreShape, (other) => { const t = tags.get(other.handle); if (!t || (t.kind !== 'terrain' && t.kind !== 'ice')) { hit = other; hitTag = t; return false; } return true; }, undefined, stuckGroups, col);
      if (!hit) return false;
      const feetY = c.y - centerOff;
      // a lift only counts if the surface above is actually standable, at the character's own walkable slope (cosMax)
      // — not just "not a near-vertical wall". A single first-hit ray can land on the tip/edge of an overhang (a
      // jutting crystal shard a few metres above the real ledge below it): groundYWalkable walks down past any such
      // un-walkable hits to the first real standable surface in range, so the character doesn't perch on the shard
      // and immediately slide/fall off it again next frame; fall through to the push-out if nothing qualifies.
      // The lift only helps when it actually moves the character (a real "embedded from above/inside" case, e.g.
      // spire-E's overhang): a capsule wedged sideways into a rock's notch at normal standing height finds the same
      // ground it is already resting on directly below it, so a lift there would be a silent no-op and the sideways
      // overlap this margin now also catches would never resolve — fall through to the horizontal push instead.
      const top = groundYWalkable(c.x, c.z, { fromY: feetY + 40, bottom: feetY - P.height * 1.5, cosMax, excludeCollider: col });
      if (top && top.normal.y >= cosMax - 1e-3 && Math.abs(top.point.y + centerOff + 0.02 - c.y) > 0.08) { col.setTranslation(v3(c.x, top.point.y + centerOff + 0.02, c.z)); }
      else { // no reachable/standable top (tall wall, overhang), or already at the right height (a sideways notch):
        // push out horizontally away from the obstacle's real world-space centre. NOTE: hit.translation() is the
        // wrong reference here — 'solid' colliders (addStaticTrimesh/addStaticConvex) bake world-space vertices with
        // the collider's own transform left at the Rapier default (0,0,0), so .translation() always reads back the
        // map origin, not the mesh. That silently pushed players away from (0,0,0) instead of away from the
        // rock/spire/altar they were stuck in — barely noticeable near the origin, but a multi-metre misdirection
        // far from it (e.g. the east spire at ~x292,z-110), which read back as the character drifting off the
        // standable altar area with onGround=false until it wandered out of interact range.
        // step size: 0.5 m clears even a deep spawn-inside case in a few iterations (k < 4 above); with the lower
        // 0.06 m margin this same push now also fires for shallow walked-into notches, where 0.5 m overshoots into a
        // visible standoff on the other side. 0.15 m still clears a typical 6-27 cm notch in one or two iterations
        // (retried next frame if not) without the overshoot; a genuinely deep embed just takes a couple more frames.
        const o = (hitTag && hitTag.center) || hit.translation();
        let dx = c.x - o.x, dz = c.z - o.z; const l = Math.hypot(dx, dz) || 1; col.setTranslation(v3(c.x + dx / l * 0.15, c.y, c.z + dz / l * 0.15)); }
      s.vel.y = Math.min(s.vel.y, 0); s.prev = v3(col.translation().x, col.translation().y - centerOff, col.translation().z); out.unstuck = (out.unstuck || 0) + 1;
      return true;
    }
    const ch = {
      collider: col, controller: kcc, params: P, state: out, unstick,
      move(dt, desired = { x: 0, z: 0 }, jumpPressed = false) {
        out.landed = false; out.landingSpeed = 0; out.jumped = false;
        if (!s.enabled) return out;
        flushQueries();
        if (s.goal && s.goal.n-- <= 0) s.goal = null;   // a goal lives for the next two moves unless it is set again
        // unstick is an exact-shape overlap query against every nearby static/trunk collider — real cost on a weak
        // profile in a dense forest. Only worth paying every single frame right after something could actually have
        // changed (a teleport/placement, or a static collider added/removed nearby — Passport's exact-mesh streaming);
        // otherwise a periodic check (P.unstickEvery, 1 = every frame, unchanged default) still catches it within a
        // few frames, which is what the original bug (spire-E, commit 9616747) needed anyway.
        slimStep();
        if (s.forceUnstick || s.staticSeen !== dirtyEpoch || (s.unstickN = (s.unstickN + 1) % P.unstickEvery) === 0) {
          for (let k = 0; k < 4 && unstick(); k++) { /* lift out of whatever we were placed inside */ }
          s.forceUnstick = false; s.staticSeen = dirtyEpoch;
        }
        s.acc += Math.min(Math.max(dt, 0) || 0, 0.1);
        let first = true, n = 0;
        while (s.acc >= FIXED && n < 8) {
          const c = col.translation(); s.prev.x = c.x; s.prev.y = c.y - centerOff; s.prev.z = c.z;
          const r = sub(FIXED, desired, jumpPressed && first);
          if (r.landed) { out.landed = true; out.landingSpeed = Math.max(out.landingSpeed, r.landingSpeed); }
          if (r.jumped) out.jumped = true;
          first = false; s.acc -= FIXED; n++;
        }
        if (first && jumpPressed) s.bufT = P.buffer; // no substep this frame: buffer the press
        const c = col.translation(), a = s.acc / FIXED;
        s.pos.x = c.x; s.pos.y = c.y - centerOff; s.pos.z = c.z;
        out.position.x = s.prev.x + (s.pos.x - s.prev.x) * a;
        out.position.y = s.prev.y + (s.pos.y - s.prev.y) * a;
        out.position.z = s.prev.z + (s.pos.z - s.prev.z) * a;
        out.velocity.x = s.actual.x; out.velocity.y = s.vel.y; out.velocity.z = s.actual.z; // horizontal = real displacement rate
        out.grounded = s.walkable; out.sliding = !!s.slideDir; out.slideDir = s.slideDir;
        out.groundNormal = s.normal;
        return out;
      },
      setPosition(x, y, z) {
        col.setTranslation(v3(x, y + centerOff, z)); s.prev = v3(x, y, z); s.pos = v3(x, y, z);
        s.vel = v3(); s.acc = 0; out.position = v3(x, y, z); s.forceUnstick = true;
      },
      // horizontal goal: walk to (x, z) at up to v m/s (a desired velocity for the controller, refreshed every frame by the caller)
      setGoal(x, z, v = 1.2) { s.goal = { x, z, v, n: 2 }; },
      clearGoal() { s.goal = null; },
      setVelocity(x, y, z) { s.vel.x = x; s.vel.y = y; s.vel.z = z; if (y > 0.5) { s.walkable = false; s.jumping = true; } },
      addVelocity(x, y, z) { ch.setVelocity(s.vel.x + x, s.vel.y + y, s.vel.z + z); },
      setEnabled(on) { s.enabled = on; col.setEnabled(on); if (on) s.acc = 0; },
      setUnstickEvery(n) { P.unstickEvery = Math.max(1, n | 0 || 1); s.forceUnstick = true; },   // quality switch: recheck once, then follow the new interval
      destroy() { world.removeCharacterController(kcc); removeCollider(col); characters.splice(characters.indexOf(ch), 1); },
    };
    characters.push(ch);
    return ch;
  }

  /* -------------------------------------------------------------- debris */
  const MAX_DEBRIS = 160, PROP_FAR = 40; let propTick = 0, propFixes = 0;
  // box / upright-cylinder fit of a prop's local points (null = keep the convex hull): the points must span the
  // primitive's faces (box: the xz outline fills its rectangle; cylinder: equal x/z extents and every mid-height point
  // on the same radius), so a genuinely irregular prop stays a hull
  function fitPrimitive(pts) {
    const n = pts.length / 3; if (n < 8) return null;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    if (Math.min(dx, dy, dz) < 0.08) return null;   // a sheet (broken / flat prop): leave it alone
    // outline occupancy on a 12 × 12 grid of the xz rectangle, and radial spread of the mid-height ring
    const G = 12, occ = new Uint8Array(G * G), rs = [];
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      occ[Math.min(G - 1, Math.floor((x - x0) / dx * G)) * G + Math.min(G - 1, Math.floor((z - z0) / dz * G))] = 1;
      if (y > y0 + dy * 0.2 && y < y1 - dy * 0.2) rs.push(Math.hypot(x - cx, z - cz));
    }
    // corners of the outline: a box fills them, a cylinder leaves them empty
    let corner = 0; for (const [i, j] of [[0, 0], [0, G - 1], [G - 1, 0], [G - 1, G - 1]]) corner += occ[i * G + j];
    const round = Math.abs(dx - dz) / Math.max(dx, dz) < 0.12 && corner <= 1;
    if (round && rs.length >= 8) {
      rs.sort((a, b) => a - b); const r = rs[Math.floor(rs.length * 0.9)], rMid = rs[rs.length >> 1];
      if (rMid / r > 0.8 && r > 0.05) {   // hollow shell or solid: the outer ring dominates → round
        const b = Math.min(0.02, r * 0.1, dy * 0.1);
        return { cd: R.ColliderDesc.roundCylinder(dy / 2 - b, r - b, b).setTranslation(cx, cy, cz), info: { kind: 'cylinder', r: +r.toFixed(3), h: +dy.toFixed(3) } };
      }
    }
    if (corner >= 3) {
      const b = Math.min(0.015, Math.min(dx, dy, dz) * 0.08);
      return { cd: R.ColliderDesc.roundCuboid(dx / 2 - b, dy / 2 - b, dz / 2 - b, b).setTranslation(cx, cy, cz), info: { kind: 'box', size: [+dx.toFixed(3), +dy.toFixed(3), +dz.toFixed(3)] } };
    }
    return null;
  }
  function spawnDebris(mesh, o = {}) {
    need();
    const shape = o.shape || 'box', mass = o.mass ?? 1;
    let fitInfo = null;
    const p = o.position || mesh.position, q = o.quaternion || mesh.quaternion;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(o.linearDamping ?? 0.05).setAngularDamping(o.angularDamping ?? (shape === 'sphere' ? 0.8 : 0.3))
      .setCcdEnabled(o.ccd ?? true);
    if (o.velocity) bd.setLinvel(o.velocity.x, o.velocity.y, o.velocity.z);
    if (o.angularVelocity) bd.setAngvel(o.angularVelocity);
    const body = world.createRigidBody(bd);
    let cd;
    const sc = mesh.scale || { x: 1, y: 1, z: 1 };
    if (shape === 'sphere') cd = R.ColliderDesc.ball(typeof o.size === 'number' ? o.size : (o.size?.x ?? 0.25));
    else if (shape === 'convex') {
      let pts = o.points;
      if (!pts) {
        const arr = mesh.geometry.attributes.position.array; pts = new Float32Array(arr.length);
        for (let i = 0; i < arr.length; i += 3) { pts[i] = arr[i] * sc.x; pts[i + 1] = arr[i + 1] * sc.y; pts[i + 2] = arr[i + 2] * sc.z; }
      }
      // pushable props (INTERACT.md): a crate / drum / barrel whose points fill a box or an upright cylinder gets that exact
      // primitive — it topples over a clean edge, rolls round and rests on a flat face; a scanned prop's hull of hundreds of
      // near-coplanar faces rocks between them at rest (jitter) and rolls like a polygon
      const fitted = o.prop && o.fit !== false && root.PHYS_PROP_FIT !== false && !root.INTERACT_OFF ? fitPrimitive(pts) : null;
      if (fitted) { cd = fitted.cd; fitInfo = fitted.info; }
      else cd = R.ColliderDesc.convexHull(pts instanceof Float32Array ? pts : new Float32Array(pts));
      if (!cd) cd = R.ColliderDesc.ball(0.2);
    } else {
      const s = typeof o.size === 'number' ? { x: o.size, y: o.size, z: o.size } : (o.size || { x: 0.5, y: 0.5, z: 0.5 });
      cd = R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2); // size = full extents
    }
    const prop = !!o.prop;
    cd.setMass(mass).setFriction(o.friction ?? 0.7).setRestitution(o.restitution ?? 0.25)
      .setCollisionGroups(prop ? groups(G_PROP, G_ALL) : groups(G_DEBRIS, G_STATIC | G_TRUNK | G_DEBRIS | G_PROP | G_VEHICLE));
    const col = world.createCollider(cd, body);
    const d = {
      mesh, body, collider: col, prop, t: 0, life: o.lifetime ?? (prop ? Infinity : 8), fade: o.fade ?? 0.5,
      baseScale: { x: sc.x, y: sc.y, z: sc.z }, onDespawn: o.onDespawn, keepMesh: !!o.keepMesh,
      prevP: v3(p.x, p.y, p.z), prevQ: { x: q.x, y: q.y, z: q.z, w: q.w }, sleepT: 0, fit: fitInfo,
    };
    tag(col, { kind: prop ? 'prop' : 'debris', ref: d, userData: o.userData });
    debris.push(d);
    if (!prop) { let n = 0; for (const e of debris) if (!e.prop) n++; if (n > MAX_DEBRIS) { const i = debris.findIndex((e) => !e.prop); if (i >= 0) killDebris(debris[i], i); } }
    return d;
  }
  function killDebris(d, i) {
    tags.delete(d.collider.handle); world.removeRigidBody(d.body);
    if (!d.keepMesh && d.mesh.parent) d.mesh.parent.remove(d.mesh);
    if (d.onDespawn) d.onDespawn(d);
    debris.splice(i ?? debris.indexOf(d), 1);
  }

  /* ----------------------------------------------------------- explosion */
  function applyExplosion(c, radius, force, opts = {}) {
    need();
    const up = opts.upBias ?? 0.35;
    const push = (p, applyFn) => {
      let dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z; const d = Math.hypot(dx, dy, dz);
      if (d > radius) return;
      const f = force * (1 - d / radius) / (d || 1);
      dx *= f; dy = dy * f + force * (1 - d / radius) * up; dz *= f;
      applyFn(dx, dy, dz);
    };
    for (const d of debris) { const p = d.body.translation(); push(p, (x, y, z) => d.body.applyImpulse(v3(x, y, z), true)); }
    for (const vh of vehicles) { const p = vh.body.translation(); push(p, (x, y, z) => vh.body.applyImpulse(v3(x, y, z), true)); }
    if (opts.characters !== false) for (const ch of characters) {
      const p = ch.collider.translation(); push(p, (x, y, z) => ch.addVelocity(x / ch.params.mass, y / ch.params.mass, z / ch.params.mass));
    }
  }

  /* -------------------------------------------------------- hover vehicle */
  function createHoverVehicle(o = {}) {
    need(); flushQueries();
    const P = {
      mass: o.mass ?? 250, half: o.halfExtents ?? v3(1.0, 0.3, 1.9),
      hover: o.hoverHeight ?? 1.2, accel: o.accel ?? 30, reverseAccel: o.reverseAccel ?? 22,
      maxSpeed: o.maxSpeed ?? 44, boostSpeed: o.boostSpeed ?? 58, reverseMax: o.reverseMax ?? 12,
      turnRate: o.turnRate ?? 1.9, grip: o.grip ?? 6, driftGrip: o.driftGrip ?? 1.2,
      jump: o.jumpSpeed ?? 9, coast: o.coastDrag ?? 0.9, drag: o.drag ?? 0.35,
      stiffness: o.stiffness ?? 1, damping: o.damping ?? 0.9,
    };
    const x = o.x ?? 0, z = o.z ?? 0, y = o.y ?? (groundY(x, z) + P.hover);
    const yaw = o.yaw ?? 0;
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.05).setAngularDamping(2.5).setCcdEnabled(true).setCanSleep(false));
    const col = world.createCollider(R.ColliderDesc.cuboid(P.half.x, P.half.y, P.half.z)
      .setMass(P.mass).setFriction(0.15).setRestitution(0.1)
      .setCollisionGroups(groups(G_VEHICLE, G_ALL & ~G_CHAR)), body);
    tag(col, { kind: 'vehicle' });
    const g = cfg.gravity;
    // springs: equilibrium exactly at hover height; zeta ≈ damping
    const k = P.mass * g / 4 / 0.35 * P.stiffness, c = 2 * Math.sqrt(k * P.mass / 4) * P.damping;
    const corners = [v3(P.half.x * 0.85, 0, P.half.z * 0.8), v3(-P.half.x * 0.85, 0, P.half.z * 0.8), v3(P.half.x * 0.85, 0, -P.half.z * 0.8), v3(-P.half.x * 0.85, 0, -P.half.z * 0.8)];
    const maxRay = P.hover * 2.2;
    const rayGroups = groups(G_VEHICLE, G_STATIC | G_PROP);   // hover pads ride on terrain + solids, not on trunks
    const inp = { throttle: 0, steer: 0, boost: false, jump: false };
    const out = { position: v3(x, y, z), quaternion: { x: 0, y: 0, z: 0, w: 1 }, velocity: v3(), speed: 0, grounded: false, height: 0, yaw, bank: 0, impact: 0 };
    let lastV = null;
    const prevP = v3(x, y, z), prevQ = { x: 0, y: 0, z: 0, w: 1 };
    let grounded = false, hitSpeed = 0;
    const w0 = v3(), dn = v3(), up = v3(), fw = v3(), rt = v3();

    function pre(dt) {
      const p = body.translation(), q = body.rotation(), lv = body.linvel();
      qrot(q, { x: 0, y: 1, z: 0 }, up); qrot(q, { x: 0, y: 0, z: -1 }, fw); qrot(q, { x: 1, y: 0, z: 0 }, rt);
      dn.x = -up.x; dn.y = -up.y; dn.z = -up.z;
      let hits = 0, hsum = 0, sx = 0, sz = 0;
      for (const cl of corners) {
        qrot(q, cl, w0); w0.x += p.x; w0.y += p.y; w0.z += p.z;
        const h = world.castRay(new R.Ray(w0, dn), maxRay, true, undefined, rayGroups, col, body);
        if (!h) continue;
        hits++; hsum += h.timeOfImpact;
        const pv = body.velocityAtPoint ? body.velocityAtPoint(w0) : lv;
        const vAlong = pv.x * up.x + pv.y * up.y + pv.z * up.z; // + = moving away from ground
        let F = P.mass * g / 4 + k * (P.hover - h.timeOfImpact) - c * vAlong;
        F = clamp(F, 0, P.mass * g * 3);
        body.applyImpulseAtPoint(v3(up.x * F * dt, up.y * F * dt, up.z * F * dt), w0, true);
        sx += up.x * F * dt; sz += up.z * F * dt; // horizontal part of pad thrust (slides it downhill)
      }
      grounded = hits > 0;
      out.height = hits ? hsum / hits : maxRay;
      // planar frame (forward/right projected on horizontal)
      const fl = Math.hypot(fw.x, fw.z) || 1, fx = fw.x / fl, fz = fw.z / fl, rx = -fz, rz = fx;
      const vf = lv.x * fx + lv.z * fz, vr = lv.x * rx + lv.z * rz;
      const m = P.mass;
      if (grounded) {
        // thrust
        const vmax = inp.boost ? P.boostSpeed : P.maxSpeed;
        let a = 0;
        if (inp.throttle > 0) a = inp.throttle * P.accel * (inp.boost ? 1.3 : 1) * clamp(1 - vf / vmax, 0, 1);
        else if (inp.throttle < 0) a = inp.throttle * (vf > 0 ? P.accel * 1.3 : P.reverseAccel * clamp(1 + vf / P.reverseMax, 0, 1));
        a -= vf * (inp.throttle === 0 ? P.coast : P.drag) * 0.5;
        // lateral grip (drift when boosting + hard steer)
        const drifting = inp.boost && Math.abs(inp.steer) > 0.5 || inp.drift;
        const gl = drifting ? P.driftGrip : P.grip;
        const ar = -vr * Math.min(gl, 1 / dt);
        let ix = (fx * a + rx * ar) * m * dt, iz = (fz * a + rz * ar) * m * dt;
        // parking brake: idle + slow -> hold position (otherwise it would drift down slopes)
        if (inp.throttle === 0 && Math.hypot(lv.x, lv.z) < 3) { const kb = Math.min(10, 1 / dt); ix = -lv.x * kb * m * dt - sx; iz = -lv.z * kb * m * dt - sz; }
        body.applyImpulse(v3(ix, 0, iz), true);
        if (inp.jump) { body.applyImpulse(v3(0, P.jump * m, 0), true); inp.jump = false; }
      } else {
        // airborne: self-right slowly
        const av = body.angvel(), K = 6, D = 2;
        const tx = up.z * K - av.x * D, tz = -up.x * K - av.z * D; // torque ~ up × worldUp
        body.applyTorqueImpulse(v3(tx * m * dt * 0.8, 0, tz * m * dt * 0.8), true);
      }
      inp.jump = false;
      // yaw control around world up (arcade-precise, physically applied via angvel)
      const av = body.angvel();
      const tgt = -inp.steer * P.turnRate * clamp(Math.abs(vf) / 12, 0.35, 1) * (vf < -0.5 ? -1 : 1) * (grounded ? 1 : 0.4);
      const blend = Math.min(1, 10 * dt);
      body.setAngvel(v3(av.x, av.y + (tgt - av.y) * blend, av.z), true);
      out.bank = -inp.steer * clamp(vf / 40, 0, 1) * 0.35;
    }
    const vh = {
      body, collider: col, state: out, params: P, _pre: pre,
      _save() { const p = body.translation(), q = body.rotation(); prevP.x = p.x; prevP.y = p.y; prevP.z = p.z; prevQ.x = q.x; prevQ.y = q.y; prevQ.z = q.z; prevQ.w = q.w; },
      _sync(a) {
        const p = body.translation(), q = body.rotation(), lv = body.linvel();
        // impact = horizontal speed lost since last sync (crash into rocks/pillars -> shake/sound)
        if (lastV) { const lost = Math.hypot(lastV.x, lastV.z) - Math.hypot(lv.x, lv.z); out.impact = lost > 0 ? lost : 0; }
        lastV = { x: lv.x, z: lv.z };
        out.position.x = prevP.x + (p.x - prevP.x) * a; out.position.y = prevP.y + (p.y - prevP.y) * a; out.position.z = prevP.z + (p.z - prevP.z) * a;
        slerpInto(out.quaternion, prevQ, q, a);
        out.velocity.x = lv.x; out.velocity.y = lv.y; out.velocity.z = lv.z;
        qrot(q, { x: 0, y: 0, z: -1 }, fw); out.yaw = Math.atan2(-fw.x, -fw.z);
        out.speed = -(lv.x * Math.sin(out.yaw) + lv.z * Math.cos(out.yaw));
        out.grounded = grounded;
        if (o.mesh) { o.mesh.position.set(out.position.x, out.position.y, out.position.z); o.mesh.quaternion.set(out.quaternion.x, out.quaternion.y, out.quaternion.z, out.quaternion.w); }
      },
      /** throttle -1..1, steer -1..1 (+1 = right), boost bool, jump bool (edge). Forces are applied in Phys.step. */
      update(dt, throttle = 0, steer = 0, boost = false, jump = false, drift = false) {
        inp.throttle = clamp(throttle, -1, 1); inp.steer = clamp(steer, -1, 1); inp.boost = !!boost; inp.drift = !!drift;
        if (jump && grounded) inp.jump = true;
        return out;
      },
      teleport(x, y, z, yaw = 0) {
        body.setTranslation(v3(x, y, z), true); body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
        body.setLinvel(v3(), true); body.setAngvel(v3(), true); vh._save(); vh._sync(1);
      },
      setEnabled(on) { body.setEnabled(on); },
      destroy() { tags.delete(col.handle); world.removeRigidBody(body); vehicles.splice(vehicles.indexOf(vh), 1); },
    };
    vh._save(); vh._sync(1);
    vehicles.push(vh);
    return vh;
  }

  /* ------------------------------------------------------------- ragdoll (PHYSBODY.md) */
  // Event ragdoll of the pilot: ~11 dynamic capsules + impulse joints, only alive for the 1–2 s of a fall / heavy hit.
  // Group BODY: collides with the world (terrain, solids, trunks, props, vehicles), never with the character capsule,
  // debris or itself (limbs may pass through the torso — no self-collision pairs to solve). Query filters used by the
  // game (camera, feet, contact probes) do not include BODY, so a lying ragdoll never blocks them.
  const G_BODY = 64, ragdolls = [];
  // parts: [{ p: {x,y,z} centre, q: {x,y,z,w} collider rotation (capsule axis = local Y), shape: 'capsule'|'ball'|'box',
  //           r, hh (capsule half height), he: {x,y,z} (box), mass, v: {x,y,z}, w: {x,y,z} }]  (world space)
  // joints: [{ a, b (part indices), anchor: {x,y,z} world, hinge?: {x,y,z} world axis, limits?: [min, max] rad }]
  // Every body starts with the IDENTITY rotation (the collider carries the part's rotation): all body frames agree at
  // creation, so a hinge axis is the same vector in both bodies' local space (Rapier's revolute takes one local axis).
  function createRagdoll(parts, joints, o = {}) {
    need(); flushQueries();
    const filt = groups(G_BODY, G_STATIC | G_TRUNK | G_PROP | G_VEHICLE), bodies = [], cols = [], js = [];
    for (const d of parts) {
      // CCD only where asked (the heavy trunk parts): continuous sweeps for all 11 parts were most of the ragdoll's cost
      const bd = R.RigidBodyDesc.dynamic().setTranslation(d.p.x, d.p.y, d.p.z).setLinearDamping(o.linDamp ?? 0.25).setAngularDamping(o.angDamp ?? 2.5)
        .setCcdEnabled(!!d.ccd).setCanSleep(true);
      if (d.v) bd.setLinvel(d.v.x, d.v.y, d.v.z); if (d.w) bd.setAngvel(d.w);
      const b = world.createRigidBody(bd);
      const cd = d.shape === 'ball' ? R.ColliderDesc.ball(d.r) : d.shape === 'box' ? R.ColliderDesc.cuboid(d.he.x, d.he.y, d.he.z) : R.ColliderDesc.capsule(d.hh, d.r);
      cd.setRotation({ x: d.q.x, y: d.q.y, z: d.q.z, w: d.q.w }).setMass(d.mass || 1).setFriction(o.friction ?? 0.9).setRestitution(o.restitution ?? 0.02).setCollisionGroups(filt);
      const c = world.createCollider(cd, b); tag(c, { kind: 'ragdoll' });
      bodies.push(b); cols.push(c);
    }
    for (const J of joints) {
      const A = parts[J.a].p, B = parts[J.b].p, an = J.anchor;
      const a1 = v3(an.x - A.x, an.y - A.y, an.z - A.z), a2 = v3(an.x - B.x, an.y - B.y, an.z - B.z);
      const data = J.hinge ? R.JointData.revolute(a1, a2, v3(J.hinge.x, J.hinge.y, J.hinge.z)) : R.JointData.spherical(a1, a2);
      const j = world.createImpulseJoint(data, bodies[J.a], bodies[J.b], true);
      if (J.hinge && J.limits && j.setLimits) { try { j.setLimits(J.limits[0], J.limits[1]); } catch (e) { /* older build: free hinge */ } }
      js.push(j);
    }
    const prev = bodies.map((b) => ({ p: Object.assign({}, b.translation()), q: Object.assign({}, b.rotation()) }));
    const rd = {
      bodies, colliders: cols, joints: js,
      _save() { for (let i = 0; i < bodies.length; i++) { const p = bodies[i].translation(), q = bodies[i].rotation(); const s = prev[i]; s.p.x = p.x; s.p.y = p.y; s.p.z = p.z; s.q.x = q.x; s.q.y = q.y; s.q.z = q.z; s.q.w = q.w; } },
      // pose of part i interpolated to the render time (same alpha as debris / vehicles)
      pose(i, outP, outQ) {
        const b = bodies[i], p = b.translation(), q = b.rotation(), s = prev[i];
        outP.x = s.p.x + (p.x - s.p.x) * alpha; outP.y = s.p.y + (p.y - s.p.y) * alpha; outP.z = s.p.z + (p.z - s.p.z) * alpha;
        slerpInto(outQ, s.q, q, alpha); return outP;
      },
      maxSpeed() { let m = 0; for (const b of bodies) { const v = b.linvel(); m = Math.max(m, Math.hypot(v.x, v.y, v.z)); } return m; },
      impulse(i, imp, at) { const b = bodies[i]; if (at) b.applyImpulseAtPoint(v3(imp.x, imp.y, imp.z), v3(at.x, at.y, at.z), true); else b.applyImpulse(v3(imp.x, imp.y, imp.z), true); },
      torque(i, t) { bodies[i].applyTorqueImpulse(v3(t.x, t.y, t.z), true); },
      // parts whose shape, shrunk by `margin`, still overlaps the static world = penetrating deeper than `margin`
      penetrating(margin = 0.05) {
        let n = 0; const flt = groups(G_ALL, G_STATIC | G_TRUNK);
        for (let i = 0; i < bodies.length; i++) {
          const sh = cols[i].shape, t = cols[i].translation(), r = cols[i].rotation(); let s2 = null;
          if (sh.radius !== undefined && sh.halfHeight !== undefined) s2 = new R.Capsule(sh.halfHeight, Math.max(0.005, sh.radius - margin));
          else if (sh.radius !== undefined) s2 = new R.Ball(Math.max(0.005, sh.radius - margin));
          else if (sh.halfExtents) s2 = new R.Cuboid(Math.max(0.005, sh.halfExtents.x - margin), Math.max(0.005, sh.halfExtents.y - margin), Math.max(0.005, sh.halfExtents.z - margin));
          if (!s2) continue; let hit = false;
          world.intersectionsWithShape(t, r, s2, () => { hit = true; return false; }, undefined, flt, cols[i]);
          if (hit) n++;
        }
        return n;
      },
      destroy() { for (const j of js) { try { world.removeImpulseJoint(j, true); } catch (e) { /* removed with body */ } } for (const c of cols) tags.delete(c.handle); for (const b of bodies) world.removeRigidBody(b); const k = ragdolls.indexOf(rd); if (k >= 0) ragdolls.splice(k, 1); },
    };
    ragdolls.push(rd);
    return rd;
  }

  // nearest world surface to a point (PHYSBODY: the shoulders' contact probes). dist < 0 = the point is inside.
  function nearestSurface(p, o = {}) {
    need(); flushQueries();
    const h = world.projectPoint(v3(p.x, p.y, p.z), false, undefined, groups(G_ALL, o.groups ?? (G_STATIC | G_TRUNK | G_PROP)));
    if (!h) return null;
    const q = h.point, dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z, d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return null;
    const s = h.isInside ? -1 : 1;
    return { point: v3(q.x, q.y, q.z), dist: d * s, normal: v3(dx / d * s, dy / d * s, dz / d * s), tag: tags.get(h.collider.handle) || null };
  }

  /* ---------------------------------------------------------------- step */
  function step(dt) {
    need();
    acc += Math.min(Math.max(dt, 0) || 0, 0.25);
    let n = 0;
    while (acc >= FIXED) {
      if (n >= MAX_SUB) { acc = 0; break; } // spiral-of-death guard
      for (const d of debris) { const p = d.body.translation(), q = d.body.rotation(); d.prevP.x = p.x; d.prevP.y = p.y; d.prevP.z = p.z; d.prevQ.x = q.x; d.prevQ.y = q.y; d.prevQ.z = q.z; d.prevQ.w = q.w; }
      for (const vh of vehicles) { vh._save(); if (vh.body.isEnabled()) vh._pre(FIXED); }
      for (const rd of ragdolls) rd._save();   // PHYSBODY ragdoll: render-time interpolation like debris
      world.step(); dirtyStatic = false; stepCount++;
      acc -= FIXED; n++;
    }
    alpha = acc / FIXED;
    // pushable props far from every character (> PROP_FAR m) and nearly still go to sleep: the solver only ever works on
    // the few props next to the pilot (a sleeping body costs nothing and wakes on contact / impulse)
    if (++propTick % 30 === 0 && characters.length) {
      for (const d of debris) {
        if (!d.prop || d.body.isSleeping()) continue;
        const p = d.body.translation(), lv = d.body.linvel(); let near = false;
        for (const ch of characters) { const c = ch.collider.translation(); if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < PROP_FAR * PROP_FAR) { near = true; break; } }
        if (!near && lv.x * lv.x + lv.y * lv.y + lv.z * lv.z < 0.25) d.body.sleep();
      }
      // a prop never rests under the ground: one that tunnelled (spawned inside the heightfield, knocked through a seam)
      // is put back on top of the static surface above it, still, and awake so it settles there
      for (const d of debris) {
        if (!d.prop) continue;
        const p = d.body.translation(), h = world.castRay(new R.Ray(v3(p.x, p.y + 60, p.z), v3(0, -1, 0)), 120, true, undefined, groups(G_ALL, G_STATIC));
        if (h) { const gy = p.y + 60 - h.timeOfImpact; if (p.y < gy - 0.12) { d.body.setTranslation(v3(p.x, gy + 0.6, p.z), true); d.body.setLinvel(v3(), true); d.body.setAngvel(v3(), true); d.body.wakeUp(); propFixes++; } }
      }
    }
    // debris sync + lifetime
    const qi = { x: 0, y: 0, z: 0, w: 1 };
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], p = d.body.translation(), q = d.body.rotation();
      d.t += dt;
      if (d.body.isSleeping()) d.sleepT += dt; else d.sleepT = 0;
      if (p.y < -60 || d.t > d.life + d.fade) { killDebris(d, i); continue; }
      const m = d.mesh;
      m.position.set(d.prevP.x + (p.x - d.prevP.x) * alpha, d.prevP.y + (p.y - d.prevP.y) * alpha, d.prevP.z + (p.z - d.prevP.z) * alpha);
      slerpInto(qi, d.prevQ, q, alpha); m.quaternion.set(qi.x, qi.y, qi.z, qi.w);
      if (d.t > d.life) { const k = Math.max(0.01, 1 - (d.t - d.life) / d.fade); m.scale.set(d.baseScale.x * k, d.baseScale.y * k, d.baseScale.z * k); }
    }
    for (const vh of vehicles) vh._sync(alpha);
    return n;
  }

  function stats() { return { propFixes, bodies: world.bodies.len(), colliders: world.colliders.len(), debris: debris.length, vehicles: vehicles.length, characters: characters.length, steps: stepCount }; }

  const api = {
    RAPIER: null, get world() { return world; }, get config() { return cfg; }, FIXED,
    groups: { STATIC: G_STATIC, CHAR: G_CHAR, DEBRIS: G_DEBRIS, PROP: G_PROP, VEHICLE: G_VEHICLE, TRUNK: G_TRUNK },
    init, addStaticCylinder, addStaticBox, addStaticTrimesh, addStaticConvex, removeCollider, createCharacter, spawnDebris, applyExplosion,
    createHoverVehicle, raycast, sphereCast, groundY, groundYWalkable, step, stats, debris,
    /** push whatever a raycast hit (debris / props / vehicle); impulse in N·s */
    applyImpulseAt(collider, point, impulse) {
      const b = collider && collider.parent(); if (!b || !b.isDynamic()) return false;
      b.applyImpulseAtPoint(v3(impulse.x, impulse.y, impulse.z), v3(point.x, point.y, point.z), true); return true;
    },
    clearDebris() { for (let i = debris.length - 1; i >= 0; i--) if (!debris[i].prop) killDebris(debris[i], i); },
    removeDebris(d) { const i = debris.indexOf(d); if (i >= 0) killDebris(d, i); },
  };
  Object.assign(api, { createRagdoll, ragdolls, nearestSurface });   // PHYSBODY.md (groups.BODY = 64)
  api.groups.BODY = G_BODY;
  root.Phys = api;
  root.PhysReady = import(RAPIER_URL).then(async (m) => {
    R = m.default || m;
    try { await R.init(); } catch (e) {
      const csp = /Content Security|unsafe-eval|CompileError/i.test(String(e && e.message));
      throw new Error(csp ? 'Phys: WebAssembly compilation blocked by CSP (page needs script-src \'wasm-unsafe-eval\')' : 'Phys: Rapier init failed: ' + (e && e.message));
    }
    api.RAPIER = R;
    return api;
  });
  root.PhysReady.catch(() => {});   // consumers get the rejection through their own .then/.catch; never an unhandled one
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
