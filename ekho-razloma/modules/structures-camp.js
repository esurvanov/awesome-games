/* modules/structures-camp.js — the station dome and modules, the polar pyramid tent (procedural, CAMP.md) and the slots WorldFill leaves for the camp, poles, pier, ruins and cairns. Moved out of modules/structures.js unchanged. Classic script, loaded BEFORE structures.js: window.createStructuresCamp(deps) → { buildStation, pushable, buildSlots, fitLog, bind({...}) }. */
(function () {
  'use strict';
  window.createStructuresCamp = function (X) {
    const { ST, need, flat, count, snowify, TAU, H, spawn, mat4, rr, register, noCords, warn, partsGroup, groundUnder, taken, clamp, findSpot, groundTilt } = X;
    let THREE, V3, C, cover, DRAWN, smooth01, shellInside, solidShells, visUnder, seatY, clipBelow;   // assigned later in the source module: set through bind()
  /* ============================ station ============================ */
  function buildStation() {
    const st = C.WORLD.station; if (!st) return;
    const base = st.position.y, yaw = st.rotation.y;
    const lg = (lx, lz) => { const v = C.WORLD.stationW(lx, lz); return H(v.x, v.z) - base; };
    const lgMin = (lx, lz, box, ry, s = 1) => { const c = Math.cos(ry), sn = Math.sin(ry); let m = 1e9;
      for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) { const bx = (box.min.x + (box.max.x - box.min.x) * i / 2) * s * 0.85, bz = (box.min.z + (box.max.z - box.min.z) * j / 2) * s * 0.85; m = Math.min(m, lg(lx + bx * c + bz * sn, lz - bx * sn + bz * c)); }
      return m; };
    const addLocal = (F, lx, ly, lz, ry, name, o = {}) => {
      const g = new THREE.Group(); g.position.set(lx, ly, lz); g.rotation.y = ry; if (o.s) g.scale.setScalar(o.s); st.add(g);
      spawn(F, [new THREE.Matrix4()], { parent: g, name, cast: true });
      st.updateMatrixWorld(true);
      if (o.role !== 'none') C.Passport.register(o.colFilter ? (() => { const r = partsGroup(F.parts, o.colFilter); r.matrix.copy(g.matrixWorld); r.matrixAutoUpdate = false; r.updateMatrixWorld(true); return r; })() : g, o.role || 'solid', { name });
      count(name); return g;
    };
    // geodesic dome: centred on the station origin, door (+Z) toward the crash site like the old dome
    need('struct_station_dome', (gl) => {
      const F = flat('struct_station_dome', gl), dn = gl.scene.getObjectByName('Dome'), ant = gl.scene.getObjectByName('Antenna');
      const db = new THREE.Box3().setFromObject(dn), cx = (db.min.x + db.max.x) / 2, cz = (db.min.z + db.max.z) / 2;
      for (const p of F.parts) { if (/glass/i.test(p.name)) { p.mat = p.mat.clone(); p.mat.emissive.setHex(0xffb468); p.mat.emissiveIntensity = 0.5; } else snowify(p.mat); }
      const y = Math.min(lg(0, 0), lgMin(0, 0, { min: new V3(-6, 0, -6), max: new V3(6, 0, 9) }, 0)) - 0.12;
      addLocal(F, -cx, y, -cz, 0, 'station_dome');
      if (ant && C.WORLD.blink) { const ab = new THREE.Box3().setFromObject(ant); C.WORLD.blink.position.set((ab.min.x + ab.max.x) / 2 - cx, y + ab.max.y + 0.15, (ab.min.z + ab.max.z) / 2 - cz); }
    });
    // insulated module on stilts: long axis along local X (old cylinder), stairs toward the back
    need('struct_station_module', (gl) => {
      const F = flat('struct_station_module', gl);
      for (const p of F.parts) { if (/glass/i.test(p.name)) { p.mat = p.mat.clone(); p.mat.emissive.setHex(0xffb468); p.mat.emissiveIntensity = 0.45; } else snowify(p.mat); }
      const lx = 12.8, lz = -3.2, ry = Math.PI / 2;
      addLocal(F, lx, lgMin(lx, lz, F.box, ry) - 0.08, lz, ry, 'station_module');
    });
    // crate stack (the 1.2 m ledge-climb crate of the bench) + loose drums/crate by the door
    need('prop_crate_military', (gl) => {
      const F = flat('prop_crate_military', gl), h = F.box.max.y - F.box.min.y, sy = 1.2 / (h * 3);
      const stack = { parts: F.parts, box: F.box }, mats = [];
      for (let k = 0; k < 3; k++) for (const side of [-1, 1]) mats.push(mat4(rr(-0.03, 0.03), -F.box.min.y * sy + k * h * sy, side < 0 ? 0 : 0.52, rr(-0.04, 0.04), 1, 0, 0, sy));   // (5,-8) = middle of a column, not the seam (bench ledge climb)
      const g = new THREE.Group(), lx = 5, lz = -8, ry = 1; g.position.set(lx, lgMin(lx, lz, { min: new V3(-0.62, 0, -0.27), max: new V3(0.62, 0, 0.79) }, ry) + 0.0, lz); g.rotation.y = ry; st.add(g);
      for (const M of mats) spawn(stack, [M], { parent: g, name: 'crate_stack' });
      st.updateMatrixWorld(true); C.Passport.register(g, 'solid', { name: 'crate_stack' }); count('crate_stack');
    });
    need('prop_drum_plastic_blue', (gl) => {
      const F = flat('prop_drum_plastic_blue', gl);
      for (const [lx, lz] of [[-10.6, 8.2], [-10.1, 9.1]]) { const v = C.WORLD.stationW(lx, lz); pushable(F, v.x, v.z, rr(0, TAU), 16, 'drum_blue'); }
    });
    need('prop_crate_wood_02', (gl) => { const F = flat('prop_crate_wood_02', gl), v = C.WORLD.stationW(-11.4, 7.1); pushable(F, v.x, v.z, yaw + 0.5, 18, 'crate_wood_02'); });
    // CAMP.md station dressing (f01/f04: a lived-in base): a fuel-drum depot on the lee side (one instanced draw, static),
    // a loaded sledge parked by the dome — cheap: 1 + 5 draws, no physics bodies
    need('prop_barrel_01', (gl) => {
      const F = flat('prop_barrel_01', gl), g = new THREE.Group(), lx = -7.5, lz = -10.5, ry = 0.35, mats = [];
      for (const p of F.parts) snowify(p.mat, 0.8);
      [[0, 0], [0.6, 0.05], [1.2, -0.02], [0.3, 0.55], [0.9, 0.58]].forEach(([x, z], i) => mats.push(mat4(x, 0, z, rr(0, TAU), 1, 0, 0)));
      mats.push(mat4(1.9, F.box.max.x, 0.3, 0.3, 1, 0, Math.PI / 2));   // one lying on its side
      g.position.set(lx, lgMin(lx + 0.6, lz + 0.3, { min: new V3(-1, 0, -0.6), max: new V3(1, 0, 0.6) }, ry) - 0.03, lz); g.rotation.y = ry; st.add(g);
      spawn(F, mats, { parent: g, name: 'drum_depot', instanced: true }); st.updateMatrixWorld(true);
      register(F, mats.map((M) => g.matrixWorld.clone().multiply(M)), 'solid', { name: 'st_drum_depot' }); count('drum_depot', mats.length);
    });
    need('prop_sledge_loaded', (gl) => {
      const F = flat('prop_sledge_loaded', gl); for (const p of F.parts) snowify(p.mat, 1);
      const lx = -3.5, lz = -12, ry = 1.2; addLocal(F, lx, lgMin(lx, lz, F.box, ry, 0.9) - 0.05, lz, ry, 'station_sledge', { colFilter: noCords, s: 0.9 });   // 4.1 m (sizes.json st_sledge ≤ 4.5)
    });
  }
  // kickable prop: one Mesh, direct child of the scene (Passport 'pushable' → physics body)
  function pushable(F, x, z, ry, mass, name, o = {}) {
    const p = F.parts[0]; if (!p) return null;
    snowify(p.mat, 0.8);
    const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = m.receiveShadow = true; m.name = name;
    const sc = o.scale || 1; if (sc !== 1) m.scale.setScalar(sc);   // REALISM-QA rule 6 (repetition): break "same model, same everywhere" for two copies close together (e.g. a crate stacked on a same-kind crate) — deterministic, unlike rotation on a dynamic rigid body (settles a bit under gravity/contact, an authored yaw gap can shrink by the time it's measured)
    const snowH = Math.max(0, DRAWN(x, z) - H(x, z));   // groundUnder samples bare H (slope needs solid ground); the loose snow it ignores is what QA's burial check measures against — add it back so a crate doesn't read as sunk into drift it was never seated on
    if (o.lying) { const r = (F.box.max.x - F.box.min.x) / 2 * sc; m.rotation.set(0, ry, Math.PI / 2); m.position.set(x, H(x, z) + snowH + r + 0.02, z); }
    else { const g = groundUnder(x, z, ry, F.box); m.rotation.set(0, ry, 0); m.position.set(x, (o.onTop ?? g.max + snowH) - F.box.min.y * sc + 0.01 + (o.up || 0), z); }
    const px = ST.hullProxy(m); px.userData.struct = true; C.scene.add(px); px.updateMatrixWorld(true);
    C.Passport.register(px, 'pushable', { name, mass }); count(name); return px;
  }
  // Rapier's convexHull panics ('unreachable') on the dense scanned prop meshes: the physics body gets an invisible
  // proxy mesh whose vertices are the prop's points clustered to 6 cm; the drawn prop rides on it as a child
  ST.hullProxy = function (mesh) {
    const P = mesh.geometry.attributes.position, seen = new Set(), pts = [], q = 0.06;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q);
      if (!seen.has(k)) { seen.add(k); pts.push(x, y, z); }
    }
    while ((pts.length / 3) % 3) pts.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeBoundingSphere();
    const px = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false })); px.name = mesh.name + '_body';
    px.position.copy(mesh.position); px.quaternion.copy(mesh.quaternion); px.scale.copy(mesh.scale);
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1); mesh.userData.noCollide = true; px.add(mesh);
    return px;
  };

  /* ============================ polar pyramid tent (procedural — CAMP.md) ============================
   * Scott / Arctic-Oven style camp tent: 2.5 m square base, 2.3 m apex. Four poles run from the base corners to the apex
   * under the canvas (their tips cross above it); the canvas sags between them; a snow valance lies flat on the snow,
   * weighed down with cut snow blocks; guy lines to wooden stakes; a sleeve door on the +Z face. Variant 'stove': a stove
   * pipe through a jack on the −X face (smoke: open-world.html FIRE region reads ST.stove) + warm light through the canvas.
   * Canvas: per-panel atlas assets/camp/tent_canvas.jpg (generated offline: seams, ridge tapes, dirt, tide marks, patch —
   * uv1) × the Poly Haven rough_linen weave (CC0) as normal + roughness tiles (uv). 6 materials, ≈ 3.3k triangles. */
  const TENT = { B: 1.25, H: 2.3, tex: null, F: {} };
  function tentTextures() {
    if (TENT.tex) return TENT.tex;
    const L = new THREE.TextureLoader(), ld = (n, srgb, rep) => { const t = L.load(C.ASSET + 'camp/' + n); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
    const map = ld('tent_canvas.jpg', true, false); map.channel = 1;
    return (TENT.tex = { map, nor: ld('tent_weave_n.jpg', false, true), rough: ld('tent_weave_r.jpg', false, true) });
  }
  const tb = () => ({ p: [], uv: [], uv1: [], c: [], ix: [] });
  // parametric patch: fn(u, v) → [x, y, z, u0, v0, u1, v1, shade]; wound so that its front faces `out(p)`
  function tgrid(b, nu, nv, fn, out) {
    const o = b.p.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const r = fn(i / nu, j / nv); b.p.push(r[0], r[1], r[2]); b.uv.push(r[3], r[4]); b.uv1.push(r[5], r[6]); const s = r[7] ?? 1; b.c.push(s, s, s); }
    const P = (u, v) => new V3().fromArray(fn(u, v)), p0 = P(0.5, 0.5), n = P(0.52, 0.5).sub(p0).cross(P(0.5, 0.52).sub(p0)), flip = out ? n.dot(out(p0)) < 0 : false;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = o + j * (nu + 1) + i, a1 = a + 1, c = a + nu + 1, d = c + 1;
      if (flip) b.ix.push(a, c, a1, a1, c, d); else b.ix.push(a, a1, c, a1, d, c); }
  }
  // tube along a → b (radius r, n sides), capped by nothing (thin: stakes, cords, poles, pipe)
  function ttube(b, a, e, r, n, v1, r1) {
    const d = e.clone().sub(a), L = d.length(); d.normalize();
    const s = Math.abs(d.y) < 0.9 ? new V3(0, 1, 0).cross(d).normalize() : new V3(1, 0, 0).cross(d).normalize(), t = d.clone().cross(s);
    tgrid(b, n, 1, (u, v) => { const ang = u * TAU, rr0 = (r1 ?? r) * v + r * (1 - v), q = a.clone().addScaledVector(d, v * L).addScaledVector(s, Math.cos(ang) * rr0).addScaledVector(t, Math.sin(ang) * rr0);
      return [q.x, q.y, q.z, u, v * L, 0.5, v1 ?? 0.1]; }, (p) => { const w = p.clone().sub(a); return w.sub(d.clone().multiplyScalar(w.dot(d))); });
  }
  function tgeo(b) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(b.uv1, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    g.setIndex(b.ix); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  function polarTentF(variant) {
    if (TENT.F[variant]) return TENT.F[variant];
    const { B, H } = TENT, stove = variant === 'stove', tx = tentTextures();
    const hsh = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const corner = [[-B, -B], [B, -B], [B, B], [-B, B]], SL = Math.hypot(H, B), TILE = 0.27;
    const canvas = tb(), valance = tb(), snow = tb(), wood = tb(), cord = tb(), metal = tb(), stake = tb();
    const outH = (p) => new V3(p.x, 0, p.z);   // panels face away from the axis
    const panelPt = (k, u, v) => {
      const a = corner[k], c = corner[(k + 1) % 4], mx = (a[0] + c[0]) / 2 / B, mz = (a[1] + c[1]) / 2 / B;
      const bx = a[0] + (c[0] - a[0]) * u, bz = a[1] + (c[1] - a[1]) * u;
      let x = bx * (1 - v), y = H * v, z = bz * (1 - v);
      const sag = 0.19 * Math.sin(Math.PI * u) * Math.pow(1 - v, 0.9) * smooth01(0, 0.22, v)       // canvas cupped in between the corner poles
        + 0.012 * Math.sin(u * 19 + k * 2.1) * Math.sin(v * 13 + k) * Math.sin(Math.PI * u)          // loose wrinkles
        - Math.max(0, 0.07 - v) * 0.9;                                                                  // foot flares out into the valance
      x -= mx * sag; z -= mz * sag;
      return { x, y, z, mx, mz };
    };
    const jack = { k: 3, u: 0.5, v: 0.62 }, door = { k: 2, u: 0.5, v: 0.24 };
    for (let k = 0; k < 4; k++) {
      const tint = [1, 0.95, 1.03, 0.97][k];
      tgrid(canvas, 16, 14, (u, v) => {
        const q = panelPt(k, u, v); let sh = tint * (0.97 + 0.06 * hsh(Math.round(u * 16), Math.round(v * 14) + k * 31));
        if (stove && k === jack.k) { const du = (u - jack.u) * 2.5, dv = v - jack.v; sh *= 1 - 0.55 * Math.exp(-(du * du) / 0.03 - Math.max(0, dv) * Math.max(0, dv) / 0.05 - Math.min(0, dv) * Math.min(0, dv) / 0.004); }   // soot above the stove jack
        return [q.x, q.y, q.z, (u - 0.5) * 2 * B * (1 - v) / TILE, v * SL / TILE, u, 0.03 + v * 0.97, sh];
      }, outH);
      // valance: a 0.42 m flap lying on the snow, trapezoids that meet on the corner diagonals
      const a = corner[k], c = corner[(k + 1) % 4], ex = (c[0] - a[0]) / (2 * B), ez = (c[1] - a[1]) / (2 * B), mx = ez, mz = -ex, w = 0.42;
      tgrid(valance, 12, 2, (u, v) => { const o = v * w, x = a[0] + (c[0] - a[0]) * u + mx * o + ex * (u - 0.5) * 2 * o, z = a[1] + (c[1] - a[1]) * u + mz * o + ez * (u - 0.5) * 2 * o;
        const y = 0.05 + 0.03 * Math.sin(Math.PI * v) - 0.025 * v + 0.012 * Math.sin(u * 23 + k);
        return [x, y, z, x / TILE, z / TILE, u, v * 0.028, 0.9 + 0.1 * hsh(u * 12, k)]; }, () => new V3(0, 1, 0));
      // cut snow blocks weighing the valance down
      for (let i = 0; i < 3; i++) {
        const u = 0.18 + i * 0.32 + (hsh(k, i) - 0.5) * 0.1, o = 0.2 + hsh(i, k) * 0.06, sx = 0.38 + hsh(k + 3, i) * 0.12, sy = 0.2 + hsh(k, i + 5) * 0.08, sz = 0.26 + hsh(i + 2, k) * 0.08;
        const cx = a[0] + (c[0] - a[0]) * u + mx * o, cz = a[1] + (c[1] - a[1]) * u + mz * o, yaw = Math.atan2(ex, ez) + (hsh(k, i + 9) - 0.5) * 0.5;
        const box = new THREE.BoxGeometry(sx, sy, sz, 2, 1, 2).toNonIndexed(), P = box.attributes.position;
        for (let q = 0; q < P.count; q++) { const x0 = P.getX(q), y0 = P.getY(q), z0 = P.getZ(q), j = hsh(x0 * 7 + cx, z0 * 7 + y0 * 3 + cz) - 0.5;   // chipped, uneven blocks
          const cs = Math.cos(yaw), sn = Math.sin(yaw), x1 = x0 * (1 + j * 0.12), z1 = z0 * (1 - j * 0.1), y1 = y0 + (y0 > 0 ? j * 0.05 : 0);
          const base = snow.p.length / 3; snow.p.push(cx + x1 * cs + z1 * sn, 0.05 + sy / 2 - 0.04 + y1, cz - x1 * sn + z1 * cs); snow.uv.push(0, 0); snow.uv1.push(0, 0); snow.c.push(1, 1, 1); snow.ix.push(base); }
      }
      // corner pole tips crossing above the apex
      const dir = new V3(-a[0], H, -a[1]).normalize();
      ttube(wood, new V3(-a[0] * 0.02, H - 0.08, -a[1] * 0.02), new V3(0, H, 0).addScaledVector(dir, 0.34), 0.022, 16);   // was 5 sides: REALISM-QA facet rule (dihedral > 20°) — a round pole tip
      // guy lines: corner ridge → stake on the diagonal, mid-face → stake straight out
      const gy = (p0, p1) => { let prev = p0; for (let s = 1; s <= 4; s++) { const t = s / 4, q = p0.clone().lerp(p1, t); q.y -= 0.05 * 4 * t * (1 - t); ttube(cord, prev, q, 0.006, 3); prev = q; } };
      const ridge = new V3(a[0] * 0.45, H * 0.55, a[1] * 0.45), sd = new V3(a[0], 0, a[1]).normalize(), st1 = new V3(a[0], 0, a[1]).addScaledVector(sd, 1.25);
      gy(ridge, st1.clone().setY(0.14));
      const mid = panelPt(k, 0.5, 0.42), st2 = new V3(mid.mx * (B + 1.55), 0, mid.mz * (B + 1.55));
      gy(new V3(mid.x, mid.y, mid.z), st2.clone().setY(0.12));
      for (const s0 of [st1, st2]) { const lean = s0.clone().setY(0).normalize().multiplyScalar(0.06); ttube(stake, s0.clone().setY(-0.22), s0.clone().add(lean).setY(0.17), 0.022, 4, 0.1, 0.018); }
    }
    // sleeve door on the +Z face: a canvas tube gathered and tied off, drooping
    { const P0 = panelPt(door.k, door.u, door.v), m = new V3(P0.mx, 0, P0.mz), side = new V3(m.z, 0, -m.x), R0 = 0.3;
      const cen = (t) => new V3(P0.x, P0.y, P0.z).addScaledVector(m, -0.1 + 0.7 * t).add(new V3(0, -0.34 * t * t, 0));
      tgrid(canvas, 14, 8, (u, t) => { const r = R0 * (1 - 0.78 * Math.pow(t, 1.3)) * (1 + 0.05 * Math.sin(u * 31 + t * 7)), a = u * TAU, q = cen(t).addScaledVector(side, Math.cos(a) * r).add(new V3(0, Math.sin(a) * r * (0.75 - 0.35 * t), 0));   // flattens as it droops
        return [q.x, q.y, q.z, u * TAU * R0 / TILE, t * 0.7 / TILE, u, 0.08 + t * 0.22, 0.9]; }, (p) => { const t = clamp((p.clone().sub(new V3(P0.x, P0.y, P0.z)).dot(m) + 0.1) / 0.7, 0, 1); return p.clone().sub(cen(t)); });
      ttube(cord, cen(0.98).addScaledVector(side, -0.1), cen(0.98).addScaledVector(side, 0.1), 0.02, 5);   // the tie
    }
    // stove pipe through a jack on the −X face, elbow, up past the apex, rain cap
    let stoveTop = null;
    if (stove) {
      const J = panelPt(jack.k, jack.u, jack.v), m = new V3(J.mx, 0, J.mz), j0 = new V3(J.x, J.y, J.z), e = j0.clone().addScaledVector(m, 0.3), top = e.clone().setY(H + 0.5);
      ttube(metal, j0.clone().addScaledVector(m, -0.08), e, 0.055, 18); ttube(metal, e.clone().addScaledVector(m, 0.055).setY(e.y - 0.05), top, 0.055, 18);   // was 8 sides: same rule — a round stove pipe
      ttube(metal, j0.clone().addScaledVector(m, -0.01), j0.clone().addScaledVector(m, 0.02), 0.14, 18);   // flashing ring on the jack (was 10 sides)
      ttube(metal, top.clone().setY(top.y + 0.06), top.clone().setY(top.y + 0.14), 0.12, 18, 0.1, 0.03);  // rain cap (was 8 sides)
      stoveTop = top.clone().setY(top.y + 0.16);
    }
    // wind-packed drift against the windward (−X) side
    { const dr = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2).toNonIndexed(), P = dr.attributes.position;
      for (let q = 0; q < P.count; q++) { const x = P.getX(q) * 0.55 - B - 0.42, y = P.getY(q) * 0.3 - 0.06, z = P.getZ(q) * 1.7; const base = snow.p.length / 3; snow.p.push(x, y, z); snow.uv.push(0, 0); snow.uv1.push(0, 0); snow.c.push(1, 1, 1); snow.ix.push(base); } }
    // materials
    const canvasM = new THREE.MeshStandardMaterial({ name: 'canvas', map: tx.map, normalMap: tx.nor, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: tx.rough, roughness: 1, metalness: 0, vertexColors: true });
    if (stove) { canvasM.emissive = new THREE.Color(0xff8a3a); canvasM.emissiveMap = tx.map; canvasM.emissiveIntensity = 0.17; canvasM.name = 'canvas_lit'; glowOnCanvas(canvasM); }
    const valM = new THREE.MeshStandardMaterial({ name: 'valance', map: tx.map, normalMap: tx.nor, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, metalness: 0, vertexColors: true });
    const snowM = new THREE.MeshStandardMaterial({ name: 'snow_block', color: 0xe4eaf4, roughness: 0.92, metalness: 0 });
    const woodM = new THREE.MeshStandardMaterial({ name: 'pole_wood', color: 0x46352a, roughness: 0.75, metalness: 0 });
    const cordM = new THREE.MeshStandardMaterial({ name: 'guy_cord', color: 0x8c8474, roughness: 0.9, metalness: 0 });
    const stakeM = new THREE.MeshStandardMaterial({ name: 'guy_stake', color: 0x4a3a2c, roughness: 0.85, metalness: 0 });
    const metalM = new THREE.MeshStandardMaterial({ name: 'stove_pipe', color: 0x34322f, roughness: 0.5, metalness: 0.65 });
    cover(canvasM, { amount: 0.45, minUp: 0.4, soft: 0.3, skirt: 0.18 }); cover(valM, { amount: 0.62, minUp: 0.5, soft: 0.6, skirt: 0.12 });
    cover(snowM, { amount: 1, minUp: -1.2, soft: 0.3, skirt: 0 }); cover(woodM, { amount: 0.6, minUp: 0.7, soft: 0.2, skirt: 0.1 }); cover(stakeM, { amount: 0.5, minUp: 0.7, soft: 0.2, skirt: 0.25 }); cover(metalM, { amount: 0.7, minUp: 0.7, soft: 0.2, skirt: 0 });
    const parts = [];
    const add = (b, mat, name, shell) => { if (!b.p.length) return; let g = tgeo(b); if (shell) g = shellInside(g); parts.push({ geo: g, mat, name }); };
    add(canvas, canvasM, 'canvas', true); add(valance, valM, 'valance'); add(snow, snowM, 'snow_block'); add(wood, woodM, 'pole_wood'); add(cord, cordM, 'guy_cord'); add(stake, stakeM, 'guy_stake'); add(metal, metalM, 'stove_pipe');
    const box = new THREE.Box3(new V3(-B - 0.45, 0, -B - 0.45), new V3(B + 0.45, H + 0.3, B + 0.45));   // footprint = canvas + valance (stakes may sink)
    let tris = 0; for (const p of parts) tris += p.geo.index.count / 3;
    return (TENT.F[variant] = { parts, box, stoveTop, tris, proc: true });
  }
  // light through the canvas only where it is canvas: snow laid over it by the shared snow rule (unsaturated) doesn't glow
  function glowOnCanvas(mat) {
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', `{ float tgMx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), tgSat = (tgMx - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) / max(tgMx, 1e-3);
        totalEmissiveRadiance *= smoothstep(.25, .55, tgSat) * (.55 + .45 * smoothstep(.2, 1.2, vTgH)); }
      #include <lights_fragment_begin>`).replace('#include <common>', '#include <common>\nvarying float vTgH;');
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTgH;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vTgH = position.y;'); };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|tentglow'; };
  }
  const tentCol = (p) => !/cord|guy|valance/i.test(p.name);   // guy lines, stakes and the flat valance are passable

  /* ============================ WorldFill slots: camp, poles, pier, ruins, cairns ============================ */
  const KIND = {
    tent_polar_stove: { proc: 'stove', role: 'solid', fit: 'tilt', colFilter: tentCol },
    tent_polar: { proc: 'plain', role: 'solid', fit: 'tilt', colFilter: tentCol },
    tent_dome: { pack: 'prop_tent_dome', role: 'solid', fit: 'tilt', snow: 1, colFilter: noCords, shell: true },
    tent_tunnel: { pack: 'prop_tent_tunnel', role: 'solid', fit: 'tilt', snow: 1, colFilter: noCords, shell: true },
    sledge: { pack: 'prop_sledge_loaded', role: 'solid', fit: 'tilt', snow: 1, colFilter: noCords },
    snowcat: { pack: 'vehicle_snowcat', role: 'solid', fit: 'tilt', snow: 1 },
    crate_wood: { pack: 'prop_crate_wood_02', role: 'pushable' },
    drum_blue: { pack: 'prop_drum_plastic_blue', role: 'pushable' },
    barrel_steel: { pack: 'prop_barrel_01', role: 'pushable' },
    pole: { pack: 'prop_power_pole', role: 'trunk', exact: true, snow: 0.6 },
    pole_tr: { pack: 'prop_power_pole_transformer', role: 'trunk', exact: true, snow: 0.6 },
    pier: { pack: 'struct_pier_wood', role: 'solid', exact: true, snow: 1, iceClip: true },
    rowboat: { pack: 'prop_rowboat', role: 'solid', exact: true, snow: 1 },
    ruin_arch: { pack: 'struct_ruin_arch', role: 'solid', fit: 'upright', snow: 1, R: 10, maxRise: 0.85 },
    ruin_column: { pack: 'struct_ruin_column', role: 'solid', fit: 'upright', snow: 1, R: 8, maxRise: 0.8 },
    ruin_wall: { pack: 'struct_ruin_wall', role: 'solid', fit: 'upright', snow: 1, R: 8, maxRise: 0.85 },
    cairn: { pack: 'prop_cairn', role: 'solid', fit: 'upright', snow: 1, R: 10, maxRise: 0.35 },
    inuksuk: { pack: 'prop_inuksuk', role: 'solid', fit: 'upright', snow: 1, R: 8, maxRise: 0.3 },
  };
  function buildSlots() {
    const slots = (window.WorldFill && WorldFill.slots) || [];
    const byKind = {};
    for (const s of slots) (byKind[s.kind] = byKind[s.kind] || []).push(s);
    for (const kind in byKind) {
      const K = KIND[kind]; if (!K) { warn('unknown slot kind', kind); continue; }
      const load = K.proc ? (cb) => cb(null) : (cb) => need(K.pack, cb);
      load((gl) => {
        const F = K.proc ? polarTentF(K.proc) : flat(K.pack, gl);
        if (K.shell) solidShells(F);   // open fabric shells: explicit inner side instead of double-sided
        if (K.snow) for (const p of F.parts) snowify(p.mat, K.snow);
        const list = byKind[kind], mats = [], fallen = [];
        if (kind === 'pier' && list.length && list[0].m) respacePier(list, F);
        for (const s of list) {
          if (K.role === 'pushable') { placePushSlot(F, s, kind); continue; }
          if (s.m) { const M = new THREE.Matrix4().fromArray(s.m); (s.fallen ? fallen : mats).push(M); taken.push([s.x, s.z, 1]); continue; }
          const sc = s.s || 1, sp = findSpot(s.x, s.z, s.yaw, F.box, sc, { maxDeg: 20, maxRise: (K.maxRise ?? 0.5) * sc, R: s.site === 'camp' ? 3.5 : K.R || 8 });
          if (!sp) { warn('no ground for', kind, s.x.toFixed(0), s.z.toFixed(0)); continue; }
          if (!sp.ok) warn(kind, 'best-effort ground', sp.g.slope.toFixed(0) + '°', 'rise', sp.g.rise.toFixed(2));
          if (sp.r > 0.5) ST.stats.moved.push({ kind, from: [s.x, s.z], to: [sp.x, sp.z], r: +sp.r.toFixed(1) });
          const rad = Math.hypot(F.box.max.x - F.box.min.x, F.box.max.z - F.box.min.z) * 0.5 * sc; taken.push([sp.x, sp.z, rad * 0.8]);
          let rx = 0, rz = 0, y;
          if (K.fit === 'tilt') { [rx, rz] = groundTilt(sp.x, sp.z, s.yaw, F.box, sc, K.proc ? 0.06 : 0.2); y = (K.proc ? visUnder(sp.x, sp.z, s.yaw, F.box, sc).mean : sp.g.mean) - (s.sink || 0.04) - F.box.min.y * sc; if (s.tilt) { rx += s.tilt[0]; rz += s.tilt[1]; } }   // polar tents: pitched on the visible snow, nearly upright
          else y = seatY(F, mat4(sp.x, 0, sp.z, s.yaw, sc), 0.05, { maxGap: 0.02, grid: 4, surf: DRAWN }).dy;   // upright masonry: ~5 % under the visible snow (+ the drift piled later), never floats — DRAWN + 4×4 grid: same surface/cells REALISM-QA's own burial check samples (was VIS + 3×3: missed drift piled against cairns/inuksuit on uneven ground, read up to 46 % buried)
          mats.push(mat4(sp.x, y, sp.z, s.yaw, sc, rx, rz));
          s.placed = { x: sp.x, y, z: sp.z };
          fitLog(kind, sp, y + F.box.min.y * sc, K.fit);
        }
        if (mats.length) {
          const sm = spawn(F, mats, { name: kind, instanced: mats.length > 1 });
          if (kind === 'pier' && mats.length > 1) {   // REALISM-QA rule 6 (repetition): sections of different age — older ones greyer, darker
            const tints = [[1, 1, 1], [0.84, 0.82, 0.8], [0.93, 0.93, 0.95]], c = new THREE.Color();
            for (const m of sm) if (m.isInstancedMesh) { mats.forEach((_, i) => m.setColorAt(i, c.setRGB(...tints[i % 3]))); m.instanceColor.needsUpdate = true; }
          }
          if (F.stoveTop) ST.stove = F.stoveTop.clone().applyMatrix4(mats[0]);   // smoke source for the FIRE region of open-world.html
          if (F.proc) ST.stats.tents = Object.assign(ST.stats.tents || {}, { [kind]: { n: mats.length, tris: F.tris, calls: F.parts.length, at: mats.map((M) => new V3().setFromMatrixPosition(M).toArray().map((v) => +v.toFixed(2))) } });
          if (K.iceClip) for (const M of mats) register(clipBelow(F, (C.POI.lake.h ?? 0) - 0.05, M), [M], K.role, { name: 'st_' + kind });   // piles below the ice: nothing to collide with
          else register(F, mats, K.role, { name: 'st_' + kind, colFilter: K.colFilter, topFrac: K.role === 'trunk' ? 1 : undefined });
          count(kind, mats.length);
        }
        if (fallen.length) { spawn(F, fallen, { name: kind + '_fallen', instanced: fallen.length > 1 }); register(F, fallen, 'solid', { name: 'st_' + kind + '_fallen' }); count(kind + '_fallen', fallen.length); }
      });
    }
  }
  // pier sections: WorldFill spaces them by the nominal 12.4 m; lay them end to end by the measured section length
  function respacePier(list, F) {
    // lay the sections deck to deck (the model has a frame-only end), starting where the bank meets the ice
    // the walkable deck: longest run of top-level plank hits along the section axis (model space)
    const probe = partsGroup(F.parts), top = F.box.max.y, rc = new THREE.Raycaster(); let run = null, cur = null, deckY = -1e9;
    const hitAt = (z) => { rc.set(new V3(0, top + 2, z), new V3(0, -1, 0)); const h = rc.intersectObject(probe, true)[0]; return h ? h.point.y : null; };
    for (let z = F.box.min.z; z <= F.box.max.z; z += 0.25) { const y = hitAt(z); if (y !== null && y < top - 0.6) deckY = Math.max(deckY, y); }
    for (let z = F.box.min.z; z <= F.box.max.z + 0.25; z += 0.25) {
      const y = z <= F.box.max.z ? hitAt(z) : null, ok = y !== null && Math.abs(y - deckY) < 0.25;
      if (ok) { if (!cur) cur = [z, z]; else cur[1] = z; } else if (cur) { if (!run || cur[1] - cur[0] > run[1] - run[0]) run = cur; cur = null; }
    }
    if (!run) run = [F.box.min.z, F.box.max.z];
    const L = run[1] - run[0] + 0.15, cz = (run[0] + run[1]) / 2; ST.stats.pierDeck = { run, deckY: +deckY.toFixed(2) };
    const m0 = new THREE.Matrix4().fromArray(list[0].m), p0 = new V3().setFromMatrixPosition(m0), lz = new V3(0, 0, 1).transformDirection(m0), dir = lz.clone();
    const p1 = list.length > 1 ? new V3().setFromMatrixPosition(new THREE.Matrix4().fromArray(list[1].m)) : null;
    const nominal = p1 ? p1.clone().sub(p0).length() : 12.4;
    if (p1 && p1.clone().sub(p0).dot(dir) < 0) dir.negate();
    const lh = C.POI.lake.h !== undefined ? C.POI.lake.h : H(p0.x, p0.z);
    const shore = p0.clone().addScaledVector(dir, -nominal / 2);
    for (let k = 0; k < 40 && H(shore.x, shore.z) > lh + 0.05; k++) shore.addScaledVector(dir, 0.25);   // bank → where it meets the ice (deck 0.2 m above)
    shore.addScaledVector(dir, -0.1);
    list.forEach((s, k) => { const c = shore.clone().addScaledVector(dir, L * (k + 0.5)); const m = new THREE.Matrix4().fromArray(s.m); m.setPosition(c.x - lz.x * cz, deckY > -1e8 ? lh + 0.2 - deckY : p0.y, c.z - lz.z * cz); s.m = m.elements.slice(); s.x = c.x; s.z = c.z; });
    ST.stats.pierSection = +L.toFixed(2);
  }
  // placement report: terrain slope under the footprint, base height vs the lowest / highest ground sample
  function fitLog(kind, sp, base, fit) {
    const f = ST.stats.fit = ST.stats.fit || { n: 0, maxSlope: 0, maxFloat: -9, maxSink: 0, list: [] };
    const float = +(base - sp.g.min).toFixed(2), sink = +(sp.g.max - base).toFixed(2);
    f.n++; f.maxSlope = Math.max(f.maxSlope, +sp.g.slope.toFixed(1)); f.maxFloat = Math.max(f.maxFloat, float); f.maxSink = Math.max(f.maxSink, sink);
    f.list.push({ kind, x: +sp.x.toFixed(1), z: +sp.z.toFixed(1), slope: +sp.g.slope.toFixed(1), float, sink, fit });
  }
  function placePushSlot(F, s, kind) {
    const K = { crate_wood: 18, drum_blue: 16, barrel_steel: 22 }[kind] || 15;
    if (s.up) { // stacked on the crate below: rest on its top
      const g = groundUnder(s.x, s.z, s.yaw, F.box); pushable(F, s.x, s.z, s.yaw, s.push || K, kind, { onTop: g.max + (F.box.max.y - F.box.min.y) * (s.scale || 1) + 0.01, scale: s.scale });
    } else pushable(F, s.x, s.z, s.yaw, s.push || K, kind, { lying: s.lying, scale: s.scale });
  }


    return { buildStation, pushable, buildSlots, fitLog, bind(o) { if ("THREE" in o) THREE = o.THREE; if ("V3" in o) V3 = o.V3; if ("C" in o) C = o.C; if ("cover" in o) cover = o.cover; if ("DRAWN" in o) DRAWN = o.DRAWN; if ("smooth01" in o) smooth01 = o.smooth01; if ("shellInside" in o) shellInside = o.shellInside; if ("solidShells" in o) solidShells = o.solidShells; if ("visUnder" in o) visUnder = o.visUnder; if ("seatY" in o) seatY = o.seatY; if ("clipBelow" in o) clipBelow = o.clipBelow; } };
  };
})();
