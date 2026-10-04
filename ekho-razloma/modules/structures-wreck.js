/* modules/structures-wreck.js — the crash site and what lies around it: the Kestrel wreck (parts, collider, ground fit), the debris trail, the cargo case with the cutter, ship parts, the power cell at the lake, the scanned rocks placed by tryRocks. Moved out of modules/structures.js unchanged. Classic script, loaded BEFORE structures.js: window.createStructuresWreck(deps) → the builders and updates listed in its return; bind({...}) takes what is declared elsewhere in structures.js (the C ctx, THREE, V3 and other blocks' exports). */
(function () {
  'use strict';
  window.createStructuresWreck = function (X) {
    const { ST, count, rr, warn, need, clamp, H, flatCache, groundTilt, flatten, taken, spawn, flat, snowify, TAU, findSpot, mat4, partsGroup, register } = X;
    let C, THREE, V3;   // assigned later in the source module: set through bind()
  /* ============ incoming3: Kestrel wreck, debris trail, cargo case, ship parts, lake cell, rocks (FIX-WORLD) ============ */
  // visible ground = heightfield + loose snow (what the player and the QA height map see)
  const VIS = (x, z) => H(x, z) + (typeof C.snowDepthAt === 'function' ? Math.max(0, C.snowDepthAt(x, z) || 0) : 0);
  // the snow surface exactly as drawn (terrain snowField: micro relief, drifts, presses) when the terrain provides it
  const DRAWN = (x, z) => { const f = C.snowField; if (f && f.sample) { const q = f.sample(x, z); if (q && Number.isFinite(q[0])) return q[0]; } return VIS(x, z); };
  const visUnder = (x, z, yaw, box, s = 1) => { const c = Math.cos(yaw), sn = Math.sin(yaw); let sum = 0, n = 0, mn = 1e9;
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) { const lx = (box.min.x + (box.max.x - box.min.x) * i / 2) * s * 0.8, lz = (box.min.z + (box.max.z - box.min.z) * j / 2) * s * 0.8, h = VIS(x + lx * c + lz * sn, z - lx * sn + lz * c); sum += h; n++; mn = Math.min(mn, h); }
    return { mean: sum / n, min: mn }; };
  const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // terrain snow (shader + drift skirt) when the terrain module is there, else the own top-snow patch
  function cover(mat, o) {
    if (!mat || !mat.isMeshStandardMaterial || mat.transparent) return;
    if (typeof C.snowCover === 'function') { try { C.snowCover(mat, o); return; } catch (e) { /* own snow below */ } }
    snowify(mat, o.amount);
  }
  // Height that buries `target` of a placement the way the QA placed-object check measures it (tools/qa/qa-page.js):
  // footprint split 3×3, per cell the lowest vertex vs the visible surface, share of the cell's vertical extent under
  // it, averaged; and never floating (lowest cell gap ≤ maxGap). `extra`: snow the terrain will still pile against it.
  function ptsOf(F) {
    if (F._pts) return F._pts;
    let n = 0; for (const p of F.parts) n += p.geo.attributes.position.count;
    const step = Math.max(1, Math.ceil(n / 4000)), out = [];
    for (const p of F.parts) { const P = p.geo.attributes.position; for (let i = 0; i < P.count; i += step) out.push(P.getX(i), P.getY(i), P.getZ(i)); }
    return (F._pts = new Float32Array(out));
  }
  function seatY(F, M0, target, o = {}) {
    const pts = ptsOf(F), n = pts.length / 3, e = M0.elements, W = new Float32Array(pts.length);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      W[i * 3] = wx; W[i * 3 + 1] = wy; W[i * 3 + 2] = wz; if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz; }
    const N = o.grid || 3, lo = new Array(N * N).fill(null), top = new Array(N * N).fill(-1e9);
    for (let i = 0; i < n; i++) { const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
      const ci = Math.min(N - 1, Math.floor((x - x0) / Math.max(1e-3, x1 - x0) * N)), cj = Math.min(N - 1, Math.floor((z - z0) / Math.max(1e-3, z1 - z0) * N)), k = ci * N + cj;
      if (!lo[k] || y < lo[k][1]) lo[k] = [x, y, z]; if (y > top[k]) top[k] = y; }
    const surf = o.surf || VIS, cells = [];
    for (let k = 0; k < N * N; k++) if (lo[k]) cells.push({ y: lo[k][1], h: top[k] - lo[k][1], s: surf(lo[k][0], lo[k][2]) + (o.extra || 0) });
    const bur = (dy) => { let a = 0, c = 0; for (const q of cells) if (q.h > 0.02) { a += clamp((q.s - q.y - dy) / q.h, 0, 1); c++; } return c ? a / c : 0; };
    const gap = (dy) => { let g = 1e9; for (const q of cells) g = Math.min(g, q.y + dy - q.s); return g; };
    let sLo = 1e9, sHi = -1e9, yLo = 1e9, yHi = -1e9; for (const q of cells) { sLo = Math.min(sLo, q.s); sHi = Math.max(sHi, q.s); yLo = Math.min(yLo, q.y); yHi = Math.max(yHi, q.y + q.h); }
    let a = sLo - yHi - 2, b = sHi - yLo + 2; for (let it = 0; it < 48; it++) { const m = (a + b) / 2; if (bur(m) > target) a = m; else b = m; }
    let dy = (a + b) / 2; const maxGap = o.maxGap ?? 0.04;
    if (gap(dy) > maxGap) dy -= gap(dy) - maxGap;
    return { dy, buried: bur(dy), gap: gap(dy) };
  }
  const withY = (M, dy) => { const m = M.clone(); m.elements[13] += dy; return m; };
  // one node of a glTF, flattened in its own space (origin = the node's base centre)
  function nodeF(gl, name) {
    const key = (gl.scene.userData.source || '') + '#' + name; if (flatCache[key]) return flatCache[key];
    const n = gl.scene.getObjectByName(name); if (!n) { warn('no node', name); return null; }
    const c = n.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1);
    const g = new THREE.Group(); g.add(c); return (flatCache[key] = flatten(g));
  }
  // an open shell drawn double-sided shows its inside as flipped front faces (QA: "back faces"); an explicit inner
  // shell (reversed winding, flipped normals) with single-sided materials renders the same thing with correct lighting
  function shellInside(geo) {
    const T3 = THREE || window.THREE, n = geo.attributes.position.count, g = new T3.BufferGeometry();
    for (const k of Object.keys(geo.attributes)) {
      let a = geo.attributes[k];
      if (a.isInterleavedBufferAttribute) {   // de-interleave (glTF skinned meshes interleave skin data): the doubled index reaches past the shared buffer otherwise → the whole draw is dropped
        const d = a.data, raw = new d.array.constructor(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) raw[i * a.itemSize + c] = d.array[i * d.stride + a.offset + c];
        a = new T3.BufferAttribute(raw, a.itemSize, a.normalized);
      }
      const arr = new a.array.constructor(a.array.length * 2); arr.set(a.array); arr.set(a.array, a.array.length);
      if (k === 'normal') for (let i = a.array.length; i < arr.length; i++) arr[i] = -arr[i];
      g.setAttribute(k, new T3.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    const src = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i), idx = new Uint32Array(src.length * 2);
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: src.length, materialIndex: 0 }];
    let o = 0;   // per material: its outer triangles, then the same triangles reversed on the duplicated (inner) vertices
    for (const gr of groups) {
      const s0 = o;
      for (let t = gr.start; t < gr.start + gr.count; t++) idx[o++] = src[t];
      for (let t = gr.start; t < gr.start + gr.count; t += 3) { idx[o++] = src[t] + n; idx[o++] = src[t + 2] + n; idx[o++] = src[t + 1] + n; }
      g.addGroup(s0, o - s0, gr.materialIndex);
    }
    g.setIndex(new T3.BufferAttribute(idx.subarray(0, o), 1));
    if (!geo.groups || !geo.groups.length) g.clearGroups();
    g.userData = Object.assign({}, geo.userData); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function solidShells(F) {   // flattened parts: double-sided opaque → explicit two shells, single-sided
    for (const p of F.parts) {
      if (p.mat.side !== THREE.DoubleSide || p.mat.transparent || p.mat.alphaTest > 0 || p._shell) continue;
      p.geo = shellInside(p.geo); p.mat = p.mat.clone(); delete p.mat.userData.trSnow; p.mat.side = THREE.FrontSide; p._shell = true;
    }
  }
  // collider parts: only triangles entirely above world height y at placement M (pier piles reach down through the ice)
  function clipBelow(F, y, M) {
    const e = M.elements, wy = (P, i) => e[1] * P.getX(i) + e[5] * P.getY(i) + e[9] * P.getZ(i) + e[13];
    const parts = [];
    for (const p of F.parts) {
      const P = p.geo.attributes.position, ix = p.geo.index ? p.geo.index.array : Array.from({ length: P.count }, (_, i) => i), keep = [];
      for (let t = 0; t < ix.length; t += 3) if (Math.min(wy(P, ix[t]), wy(P, ix[t + 1]), wy(P, ix[t + 2])) > y) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      if (!keep.length) continue;
      const remap = new Map(), pos = [], idx = keep.map((v) => { let j = remap.get(v); if (j === undefined) { j = remap.size; remap.set(v, j); pos.push(P.getX(v), P.getY(v), P.getZ(v)); } return j; });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeBoundingBox(); parts.push({ geo: g, mat: p.mat, name: p.name });
    }
    return { parts, box: F.box };
  }
  function solidOpen(F) {   // thin open pieces (skin panels, cowling ring, door): inner shell for every opaque part
    for (const p of F.parts) { if (p.mat.transparent || p._shell) continue; p.geo = shellInside(p.geo); if (p.mat.side !== THREE.FrontSide) { p.mat = p.mat.clone(); delete p.mat.userData.trSnow; p.mat.side = THREE.FrontSide; } p._shell = true; }
  }
  ST.shellInside = shellInside;

  /* ---- Kestrel: DC-3-like wreck, nose dug in, tail break open, right wing stub up (left one torn off) ----
   * CAMP.md: the pack's hull is 12.75 m long but already 2.46 m wide (a real DC-3: 19.7 m long, fuselage ≈ 2.6–2.8 m) →
   * stretched to real size along the fuselage (×1.55 → 19.7 m) and ×1.15 across (2.83 m wide, 2.7 m tall); the wing stub is
   * counter-scaled along the chord so it grows ×1.15 uniformly (a ×1.55 chord would read as a wing twice too deep). The debris
   * trail is laid out ×1.55 longer; the tail / wing sections follow the hull (×1.15); small pieces were already real-size. */
  const KES = { yaw: 0.7, buryTail: 0.3, buryNose: 1.15, roll: -0.08, ok: false, S: { x: 1.15, y: 1.15, z: 1.55, toArray() { return [this.x, this.y, this.z]; } }, trail: 1.55, big: 1.15 };
  function fixKestrelUV(mat, ru, rv) {
    if (mat.userData.kesUV) return; mat.userData.kesUV = true;
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
      const t = mat[slot]; if (t) { t.repeat.set(ru, rv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
    }
  }
  function buildKestrel() {
    const K = C.WORLD.kestrel; if (!K) return;
    const k = K.g; k.rotation.order = 'YXZ'; k.rotation.set(0, KES.yaw, 0);
    need('ship_kestrel', (gl) => {
      const root = gl.scene, wrap = new THREE.Group(); wrap.name = 'kestrel_wreck'; wrap.rotation.y = Math.PI; wrap.add(root); wrap.userData.struct = true; k.add(wrap);
      wrap.scale.set(KES.S.x, KES.S.y, KES.S.z);
      const wings = root.getObjectByName('Wings');   // the stub: ×S.x along its chord too (uniform), about its own centre
      if (wings) { root.updateMatrixWorld(true); wings.updateMatrix(); const wb = new THREE.Box3().setFromObject(wings), inv = wings.parent.matrixWorld.clone().invert(), cz = wb.getCenter(new V3()).applyMatrix4(inv), f = KES.S.x / KES.S.z;
        wings.matrix.premultiply(new THREE.Matrix4().makeTranslation(cz.x, cz.y, cz.z).multiply(new THREE.Matrix4().makeScale(1, 1, f)).multiply(new THREE.Matrix4().makeTranslation(-cz.x, -cz.y, -cz.z)));
        wings.matrixAutoUpdate = false; wings.matrixWorldNeedsUpdate = true; }
      KES.len = +(new THREE.Box3().setFromObject(root.getObjectByName('Fus_Inner') || root).getSize(new V3()).toArray().sort((a, b) => b - a)[0]).toFixed(2);
      // the baked atlases carry the weathered aluminium (metal .45 + real roughness): colours/metal untouched; snow on top
      root.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
        for (const m of [].concat(o.material)) { if (/Glass/i.test(m.name)) continue;
          // REALISM-QA rule 5: the panel-line texture tiles (UV goes well past [0,1] — a genuine repeat, baked for the
          // pack's original 12.75 m hull); the ×1.55/×1.15 real-size stretch (CAMP.md) carried the tile frequency with
          // it, so each panel/rivet row is now ×1.55 too long (Fus_*) — repeat.x runs along the fuselage length, .y
          // around its girth. The wing stub ends up uniformly ×S.x after its own chord counter-scale below.
          if (/kestrel_fus_(front|rear)/i.test(m.name)) fixKestrelUV(m, KES.S.z, KES.S.x);
          else if (/kestrel_wings/i.test(m.name)) fixKestrelUV(m, KES.S.x, KES.S.x);
          cover(m, /Primer/i.test(m.name) ? { amount: 0.4, minUp: 0.72, soft: 0.2, skirt: 0.1 } : { amount: 0.95, minUp: 0.58, soft: 0.24, skirt: 0.4 }); } });
      fitKestrel(k, wrap);
      K.base && K.base.pos && K.base.pos.copy(k.position);
      if (C.WORLD.kestrelBase) { C.WORLD.kestrelBase.pos.copy(k.position); C.WORLD.kestrelBase.rot.copy(k.rotation); }
      // exact trimesh of the drawn wreck: fuselage top, wing stub, cabin floor (through the tail break / cargo door)
      k.updateMatrixWorld(true);
      C.WORLD.kestrelCol = C.Passport.register(wrap, 'solid', { name: 'kestrel' });
      // ending glows: the radial engine's front + the open tail; smoke from the engine
      const eb = new THREE.Box3(); root.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => /Engine/i.test(m.name))) eb.expandByObject(o); });
      const toK = (v) => k.worldToLocal(v);
      const eng = eb.isEmpty() ? wrap.localToWorld(new V3(2.9, 1.0, 2.4)) : new V3((eb.min.x + eb.max.x) / 2, (eb.min.y + eb.max.y) / 2, (eb.min.z + eb.max.z) / 2);
      const tail = wrap.localToWorld(new V3(0, 1.4, -6.2));
      if (K.engines && K.engines[0]) K.engines[0].position.copy(toK(eng.clone()));
      if (K.engines && K.engines[1]) K.engines[1].position.copy(toK(tail.clone()));
      K.exhaust = toK(tail.clone());
      if (C.WORLD.shipSmoke) C.WORLD.shipSmoke.set(eng.x, eng.y + 0.6, eng.z);
      KES.ok = true; count('kestrel');
    });
  }
  function fitKestrel(k, wrap) {
    const yaw = KES.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);   // k +Z (tail side), k +X (model left)
    const at = (lx, lz) => H(k.position.x + rx * lx + fx * lz, k.position.z + rz * lx + fz * lz);
    const sAcross = (at(2.5 * KES.S.x, 0) - at(-2.5 * KES.S.x, 0)) / (5 * KES.S.x);
    k.rotation.set(0, yaw, Math.atan(sAcross) + KES.roll, 'YXZ'); k.updateMatrixWorld(true);
    // belly line in wrap space: lowest hull point under the centre line (ray from below)
    const meshes = []; wrap.traverse((o) => { if (o.isMesh && !/Glass/i.test([].concat(o.material)[0].name)) meshes.push(o); });
    const rc = new THREE.Raycaster(), zs = [], belly = [];
    for (let z = -5.4; z <= 6.6; z += 0.6) {
      const o = wrap.localToWorld(new V3(0, -4, z)), d = wrap.localToWorld(new V3(0, 1, z)).sub(wrap.localToWorld(new V3(0, 0, z))).normalize();
      rc.set(o, d); rc.far = 16; const h = rc.intersectObjects(meshes, false)[0];
      if (h) { const y = wrap.worldToLocal(h.point.clone()).y; if (y < 0.9) { zs.push(z); belly.push(y); } }   // skip the open tail / nose curve
    }
    if (zs.length < 4) { for (let z = -5.4; z <= 6.6; z += 0.6) { zs.push(z); belly.push(0.3); } }
    // nose (model +Z) dug in deeper than the open tail: depth under the terrain runs buryTail → buryNose
    const want = (z) => KES.buryTail + (KES.buryNose - KES.buryTail) * clamp((z + 5.4) / 12, 0, 1);
    const err = () => { k.updateMatrixWorld(true); let sa = 0, sz = 0, szz = 0, sze = 0, n = zs.length;
      zs.forEach((z, i) => { const p = wrap.localToWorld(new V3(0, belly[i], z)), e = (H(p.x, p.z) - p.y) - want(z); sa += e; sz += z; szz += z * z; sze += z * e; });
      const b = (n * sze - sz * sa) / Math.max(1e-6, n * szz - sz * sz); return { mean: sa / n, slope: b }; };
    for (let it = 0; it < 5; it++) {
      const e0 = err(); k.position.y += e0.mean;
      const a = err(), d = 0.01; k.rotation.x += d; const b = err(); k.rotation.x -= d;
      const g = (b.slope - a.slope) / d; if (Math.abs(g) > 1e-6) k.rotation.x = clamp(k.rotation.x - a.slope / g, -0.25, 0.25);
    }
    const e1 = err(); k.position.y += e1.mean;
    // keep the QA burial measure (share of the drawn wreck under the visible snow) well under 30 %: the low wing root otherwise
    // counts as buried even when the hull itself is only 0.3–1 m in
    k.updateMatrixWorld(true); const WF = flatten(wrap), q = seatY(WF, wrap.matrixWorld.clone(), 0.2, { maxGap: 0.05 });   // 0.2 + the drift the terrain piles on later
    if (q.dy > 0) { k.position.y += q.dy; KES.raised = +q.dy.toFixed(2); }
    KES.fit = { len: KES.len, scale: KES.S.toArray(), pitch: +k.rotation.x.toFixed(3), roll: +k.rotation.z.toFixed(3), y: +k.position.y.toFixed(2), residual: +err().mean.toFixed(3), belly: belly.map((v) => +v.toFixed(2)) };
    ST.stats.kestrel = KES.fit;
  }

  /* ---- debris: the pieces of the Kestrel along its crash trail (tail and wing section, skin, engine, cabin parts) ---- */
  const DEB = { list: [], key: null, keyT: 0, t: 0 };
  function buildKestrelParts() {
    need('ship_kestrel_debris', (gl) => {
      for (const f of [placeDebris, spireParts, lakeCell]) { try { f(gl); } catch (e) { warn('debris', f.name, e.message); } }
    });
  }
  function placeDebris(gl) {
    const k = C.WORLD.kestrel.g, yaw = KES.yaw, bx = Math.sin(yaw), bz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);   // behind (k +Z) · left of the wreck (k +X)
    const cp = C.POI.crash, kx = k.position.x, kz = k.position.z;
    taken.push([kx, kz, 11], [C.WORLD.crate.position.x, C.WORLD.crate.position.z, 2.2], [cp.x - 3, cp.z + 10, 2.2]);   // wreck, cargo case, start spot
    // [node, metres behind, metres to the left, big?]
    const plan = [['TailSection', 27, 2.5, 1], ['WingSection', 5, 17, 1],
      ['debris_cargo_door', 1.5, 8.5], ['debris_wheel', -1.5, -8], ['debris_skin_panel_a', 9.5, -2.5], ['debris_prop_blade', 8, 4.8], ['debris_cowling', 12.5, 3.2],
      ['debris_window_frame', 11.5, -5.5], ['debris_skin_strip', 15, -3.5], ['debris_cable_bundle', 17.5, 0.8], ['debris_seat', 20, -2.2], ['debris_skin_panel_b', 21.5, 5]];
    for (let [name, along, lat, big] of plan) {
      const F = nodeF(gl, name); if (!F) continue;
      solidOpen(F);
      for (const p of F.parts) if (!/Glass/i.test(p.mat.name)) cover(p.mat, { amount: 0.8, minUp: 0.6, soft: 0.24, skirt: big ? 0.35 : 0.1 });
      const sc = big ? KES.big : 1; along *= KES.trail; if (big) lat *= KES.big;   // trail laid out for the real-size hull
      const x0 = kx + bx * along + lx * lat + rr(-1, 1), z0 = kz + bz * along + lz * lat + rr(-1, 1);
      const ry = big ? yaw + rr(-0.5, 0.5) + (name === 'WingSection' ? Math.PI / 2 : 0) : rr(0, TAU);
      const sp = findSpot(x0, z0, ry, F.box, sc, big ? { maxDeg: 16, maxRise: 1.1, R: 9, step: 1 } : { maxDeg: 24, maxRise: 0.35, R: 4, step: 0.6 });
      if (!sp) { warn('debris: no ground for', name); continue; }
      const rad = Math.hypot(F.box.max.x - F.box.min.x, F.box.max.z - F.box.min.z) * 0.5 * sc; taken.push([sp.x, sp.z, rad * 0.8]);
      const hgt = (F.box.max.y - F.box.min.y) * sc, item = { name, F, x: sp.x, z: sp.z, ry, big: !!big, hgt, s: sc };
      [item.rx, item.rz] = groundTilt(sp.x, sp.z, ry, F.box, sc, big ? 0.22 : 0.3);
      if (!big) { item.rx += rr(-0.06, 0.06); item.rz += rr(-0.06, 0.06); }
      item.meshes = spawn(F, [new THREE.Matrix4()], { name: 'kestrel_' + name });
      seatDebris(item); DEB.list.push(item); count('debris');
    }
  }
  // (re)seat on the visible snow: small pieces rest on it (a few cm in), sections sink through the loose snow
  function seatDebris(it) {
    const F = it.F, M0 = mat4(it.x, 0, it.z, it.ry, it.s || 1, it.rx, it.rz), fit = seatY(F, M0, it.big ? 0.12 : 0.1, it.big ? { maxGap: 0.03 } : { maxGap: 0.01, grid: 4, surf: DRAWN });   // small pieces: same 4×4 cells + drawn snow as REALISM-QA rule 4
    const y = fit.dy, M = withY(M0, y); it.fit = { buried: +fit.buried.toFixed(3), gap: +fit.gap.toFixed(3) };
    for (const m of it.meshes) { m.matrix.copy(M); m.matrixWorldNeedsUpdate = true; }
    if (it.entries) for (const e of it.entries) C.Passport.remove(e);
    const col = partsGroup(F.parts); col.matrixAutoUpdate = false; col.matrix.copy(M); col.updateMatrixWorld(true);   // one entry named like the old boxes ('debris')
    it.entries = [].concat(C.Passport.register(col, 'solid', { name: it.big ? 'kestrel_' + (it.name === 'TailSection' ? 'tail' : 'wing') : 'debris' }));
    it.y = y;
  }
  // the terrain re-stamps drifts when the set of solids changes: re-seat the small pieces once the snow settled
  function updateDebris(dt) {
    if (!DEB.list.length) return;
    const T = window.Terrain, key = T && T.S ? T.S.obstKey : null;
    DEB.t += dt;
    if (key !== DEB.key) { DEB.key = key; DEB.keyT = DEB.t; DEB.pending = true; }
    if (DEB.pending && DEB.t - DEB.keyT > 1.5) { DEB.pending = false; for (const it of DEB.list) if (!it.big) seatDebris(it); ST.stats.debrisSeats = (ST.stats.debrisSeats || 0) + 1; }
  }

  /* ---- ship parts on the spire altars: cowling, propeller blade, cable loom from the wreck ---- */
  function spireParts(gl) {
    const names = ['debris_cowling', 'debris_prop_blade', 'debris_cable_bundle'];
    (C.WORLD.spires || []).forEach((s, i) => {
      const F = nodeF(gl, names[i % 3]); if (!F || !s.part) return;
      const size = F.box.getSize(new V3()), c = F.box.getCenter(new V3()), sc = 1.15 / Math.max(size.x, size.y, size.z);
      const inner = new THREE.Group(); inner.scale.setScalar(sc); inner.rotation.set(0.45, 0, 0.3);
      for (const p of F.parts) { const mat = p.mat.clone(); mat.onBeforeCompile = () => {}; delete mat.userData.trSnow; const m = new THREE.Mesh(p.geo, mat); m.position.copy(c).negate(); m.castShadow = true; m.userData.noCollide = true; inner.add(m); }
      for (const o of s.part.children.slice()) if (o.isMesh) s.part.remove(o);
      s.part.add(inner); s.part.userData.struct = true; count('spire_part');
    });
  }

  /* ---- lake: the power cell (the Kestrel's dented tank with its straps) frozen into a hole in the ice ---- */
  function lakeCell(gl) {
    const cell = C.WORLD.cell, holder = cell && cell.getObjectByName('cell_prop'); if (!holder) return;
    const F = nodeF(gl, 'debris_oil_tank'); if (!F) return;
    const c = F.box.getCenter(new V3()), inner = new THREE.Group(); inner.rotation.set(0.12, 0.6, 0.42); inner.position.y = 0.12;
    for (const p of F.parts) { const mat = p.mat.clone(); delete mat.userData.trSnow; if (mat.emissive) { mat.emissive.setHex(0x2ab8ff); mat.emissiveIntensity = 0.12; } cover(mat, { amount: 0.5, minUp: 0.7, soft: 0.2, skirt: 0 });
      const m = new THREE.Mesh(p.geo, mat); m.position.copy(c).negate(); m.castShadow = true; m.userData.noCollide = true; inner.add(m); }
    inner.scale.setScalar(1.1); holder.add(inner); holder.userData.struct = true; holder.userData.qaPassable = 'pickup (taken with E, then hidden)'; count('cell');
  }

  /* ---- cargo case (tool): lid opens (clip Open), the pulse cutter lifts out and flies into the pilot's hand ---- */
  const CASE = { root: null, mixer: null, open: null, cutter: null, t: -1, from: null };
  function buildCase() {
    const crate = C.WORLD.crate; if (!crate) return;
    need('prop_cargo_case', (gl) => {
      const root = gl.scene;
      root.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        for (const m of [].concat(o.material)) if (!/Cutter|Foam/i.test(m.name)) cover(m, { amount: 0.55, minUp: 0.72, soft: 0.2, skirt: 0.15 }); });
      const box = new THREE.Box3(new V3(-0.76, 0, -0.47), new V3(0.76, 0.9, 0.47)), yaw = 0.4, x = crate.position.x, z = crate.position.z;
      const [rx, rz] = groundTilt(x, z, yaw, box, 1, 0.14), v = visUnder(x, z, yaw, box, 1);
      crate.position.y = v.mean - 0.05; root.rotation.set(rx, yaw, rz, 'YXZ'); crate.add(root); crate.updateMatrixWorld(true);
      for (const o of crate.children) if (o.isMesh && !o.userData.struct) o.visible = false;   // v1 fallback, if any
      if (C.WORLD.crateGlow) { C.WORLD.crateGlow.position.set(0, 0.95, 0); C.WORLD.crateGlowS = 1.6; }
      const body = root.getObjectByName('CaseBody'); body && body.updateMatrixWorld(true);
      C.Passport.register(body || root, 'solid', { name: 'tool_crate' });
      CASE.root = root; CASE.cutter = root.getObjectByName('PulseCutter');
      CASE.mixer = new THREE.AnimationMixer(root);
      const clip = (gl.animations || []).find((a) => a.name === 'Open');
      if (clip) { CASE.open = CASE.mixer.clipAction(clip); CASE.open.setLoop(THREE.LoopOnce, 1); CASE.open.clampWhenFinished = true; CASE.open.play(); CASE.open.paused = true; CASE.mixer.update(0); }   // the glTF rest pose has the lid up: hold frame 0 (closed)
      root.userData.struct = true; count('cargo_case');
      if (C.G.hasTool) ST.caseOpened();
    });
  }
  ST.openCase = function () {
    if (!CASE.root || CASE.t >= 0) return;
    if (CASE.open) { CASE.open.reset(); CASE.open.play(); }
    CASE.t = 0;
  };
  ST.caseOpened = function () {   // saved game with the tool taken: lid open, recess empty
    if (!CASE.root) return;
    if (CASE.open) { CASE.open.reset(); CASE.open.play(); CASE.mixer.update(CASE.open.getClip().duration + 0.01); }
    if (CASE.cutter) CASE.cutter.visible = false;
    CASE.t = 99;
  };
  function updateCase(dt) {
    if (!CASE.mixer) return;
    if (CASE.t < 0 || CASE.t > 3) { if (CASE.t >= 0 && CASE.t < 99) CASE.mixer.update(dt); return; }
    CASE.t += dt; CASE.mixer.update(dt);
    const cu = CASE.cutter; if (!cu || !cu.visible) return;
    const t = CASE.t;
    if (t > 0.45 && t <= 0.9) { if (!CASE.y0) CASE.y0 = cu.position.y; cu.position.y = CASE.y0 + smooth01(0.45, 0.9, t) * 0.38; cu.rotation.x += dt * 0.8; }
    else if (t > 0.9) {
      if (!CASE.from) { C.scene.attach(cu); CASE.from = cu.position.clone(); CASE.s0 = cu.scale.x; }
      const hand = C.AV && C.AV.hand, to = new V3(); if (hand) hand.getWorldPosition(to); else to.set(C.player.x, C.player.y + 1.1, C.player.z);
      const k = smooth01(0.9, 1.35, t); cu.position.lerpVectors(CASE.from, to, k); cu.scale.setScalar(CASE.s0 * (1 - 0.6 * k));
      if (t >= 1.35) cu.visible = false;
    }
  }

  /* ---- rocks: the 300 procedural boulders of the decor → real scans (boulder, two closed-back rock faces) ---- */
  const ROCK = { done: false, f1: null, f2: null, cell: 200 };
  function gradeRock(mat) {
    // INT-LIGHT: was desat .5 / grade [.92,.95,1.02] — barely a no-op, so these rock-face scans (the "boulder" and
    // "outcrop" look-gate subjects both use F1/F2, not the vegetation-owned boulder scan) kept whatever warm/tan
    // tone the raw photogrammetry scan had (look-gate: "warm tan boulders"). Now uses the SAME cool basalt grade
    // STYLE.material('rock_basalt') documents for the rest of the island's rocks (desat .7–.75, grade .55/.6/.72 —
    // vegetation.js rockMaterialPatch's "flat & outcrop" variant), plus a small ambient floor so deep moon-shadow
    // reads as dark basalt, not a flat near-black silhouette ("shadow blacker than the photos").
    if (!mat || mat.userData.fwGrade) return; mat.userData.fwGrade = true;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.emissive = mat.emissive || new THREE.Color(); mat.emissive.setRGB(0.018, 0.022, 0.03); mat.emissiveIntensity = 1;
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float fwL = dot(diffuseColor.rgb, vec3(.3, .55, .15)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(fwL), .72) * vec3(.55, .6, .72); }`); };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|fwgrade2'; };
    mat.needsUpdate = true;
  }
  function buildRocks() {
    if (!C.DECOR || !C.DECOR.rocks || !C.DECOR.rocks.length) return;
    need('rock_rock_face_02_closed', (g) => { ROCK.f2 = g; });
    need('rock_rock_face_01_closed', (g) => { ROCK.f1 = g; });
  }
  function tryRocks() {
    if (ROCK.done || !ROCK.f1 || !ROCK.f2) return;
    const D = C.DECOR, bm = D && D.boulderMeshes; if (!bm || !bm.length) return;
    ROCK.done = true;
    try { placeRocks(); } catch (e) { warn('rocks', e.message); console.error(e); }
  }
  function placeRocks() {
    const bParts = C.DECOR.boulderMeshes.map((im) => { im.geometry.computeBoundingBox(); return { geo: im.geometry, mat: im.material, name: 'boulder' }; });
    const bBox = new THREE.Box3(); for (const p of bParts) bBox.union(p.geo.boundingBox);
    const FB = { parts: bParts, box: bBox };
    const F2 = flat('rock_rock_face_02_closed', ROCK.f2), F1 = flat('rock_rock_face_01_closed', ROCK.f1);
    // snow pillow on top faces (d01–d05): minUp lowered + amount/soft raised so a visible cap forms on these large
    // rock-face scans the way it already does on the vegetation-owned boulder scan (rockMaterialPatch's own cap) —
    // was amount .8/minUp .6/soft .22, too tight to show on anything but the flattest top face (look-gate: "no snow
    // cap / pillow").
    for (const F of [F1, F2]) for (const p of F.parts) { gradeRock(p.mat); cover(p.mat, { amount: 1, minUp: 0.42, soft: 0.32, skirt: 0.4 }); }
    const models = [{ F: FB, w: bBox.max.x - bBox.min.x, key: 'b' }, { F: F2, w: F2.box.max.x - F2.box.min.x, key: 'f2' }, { F: F1, w: F1.box.max.x - F1.box.min.x, key: 'f1' }];
    const groups = new Map(), st = { n: 0, bury: [] };
    let sd = 7331; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    for (const R of C.DECOR.rocks) {
      const [x, , z, s, yaw, syk] = R, mi = s < 1.3 ? 0 : s < 2.1 ? 1 : 2, Md = models[mi], F = Md.F;
      const k = 2.3 * s / Math.max(0.5, Md.w) * (0.9 + r() * 0.2), ky = k * (syk || 1) * (mi ? 0.85 : 1);
      if (Math.hypot(x - C.POI.crash.x, z - C.POI.crash.z) < 34) continue;   // the crash trail keeps its own debris
      const [rx, rz] = groundTilt(x, z, yaw, F.box, k, 0.45);
      const hgt = (F.box.max.y - F.box.min.y) * ky;
      // 12–20 % of the height under the visible snow, counting the drift the terrain will pile against it
      // 12–20 % of it under the visible snow, counting the drift the terrain will pile against it
      const drift = Math.min(0.26, hgt * 0.16) * smooth01(0.3, 1.2, hgt) * 0.5, want = 0.12 + r() * 0.08;
      const M0 = new THREE.Matrix4().compose(new V3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), new V3(k, ky, k));
      const fit = seatY(F, M0, want, { extra: drift, grid: 4, surf: DRAWN }), M = withY(M0, fit.dy);   // DRAWN + 4×4 grid: matches REALISM-QA's own burial cells (was VIS + 3×3 — a handful of rocks on drifted/uneven ground read 33–40 % buried against the real surface despite fitting to a 12–20 % target against the approximate one)
      const cx = Math.floor(x / ROCK.cell), cz = Math.floor(z / ROCK.cell), key = Md.key + ':' + cx + ':' + cz;
      if (!groups.has(key)) groups.set(key, { Md, mats: [] }); groups.get(key).mats.push(M); st.n++; st.bury.push(fit.buried); (ST.stats.rockFits = ST.stats.rockFits || []).push([+x.toFixed(1), +z.toFixed(1), mi, +hgt.toFixed(2), +want.toFixed(2), +fit.buried.toFixed(2), +fit.gap.toFixed(2), +drift.toFixed(2)]);
    }
    // one instanced mesh per model and 200 m cell (frustum-culled per cell); colliders: convex hull per rock
    for (const { Md, mats } of groups.values()) {
      spawn(Md.F, mats, { name: 'rock', instanced: true });
      register(Md.F, mats, 'solid', { name: 'rock', shape: 'hull' });
    }
    count('rock', st.n); ST.stats.rocks = { placed: st.n, meshes: groups.size, buryMean: +(st.bury.reduce((a, b) => a + b, 0) / Math.max(1, st.bury.length)).toFixed(3) };
    // small clutter stones of WorldFill: same scan, decimated
    if (window.WorldFill && WorldFill.setStoneGeometry) { try { WorldFill.setStoneGeometry(bParts[0].geo); } catch (e) { warn('stones', e.message); } }
  }

  /* ---- NASA hab module (struct_hab_module, placed by open-world.html placeStatic) — GROUNDBLEND item 5 ----
   * The pack's only material (glTF 'lambert2SG') has a base-colour texture and NO metallicRoughness block → glTF
   * defaults metalness 1 / roughness 1: a fully metallic, fully rough shell has no diffuse term at all, so the moon and
   * the baked sky light never reached its albedo — it rendered as a dark grey blob lit only by blurry env reflections.
   * Painted composite panels: metalness 0.05, roughness ≈ 0.6 with world-space micro variation (the 1024² atlas spreads
   * ~12 m of hull, ≈ 1–2 cm/texel with painted-in shading: it needs detail on top, not a sharper copy of itself), plus
   * faint roof-edge streaks. Snow on top / snow skirt / grime at the base / contact AO come from modules/groundblend.js.
   *
   * ASSET-QUALITY-1: the blotch/streak/roughness noise above only ever modulates the existing 1024² colour map — it
   * breaks up the flat *tone*, but a soft source photo stays soft: no new edge/rivet/seam frequency was ever added, so
   * up close the panels still read as a blurry photo instead of built hardware. No source texture is authored here
   * (out of scope, see ASSET-QUALITY-1.md); the `normal_fragment_maps` hook below adds a small procedural
   * detail-normal perturbation instead (see its own comment for what was tried first and rejected) — a modest,
   * real sharpening of what the eye reads as "surface detail", independent of the (unchanged) colour-map
   * resolution. */
  const HAB = { t: 0, n: 0 };
  function fixHabMat(mat) {
    if (!mat || !mat.isMeshStandardMaterial || mat.userData.habFix) return false;
    mat.userData.habFix = true; mat.metalness = 0.05; mat.roughness = 0.62; mat.metalnessMap = null; mat.envMapIntensity = 0.6;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHabW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vHabW = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vHabW;
        float habH(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float habN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(mix(habH(i), habH(i + vec3(1,0,0)), f.x), mix(habH(i + vec3(0,1,0)), habH(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(habH(i + vec3(0,0,1)), habH(i + vec3(1,0,1)), f.x), mix(habH(i + vec3(0,1,1)), habH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        { float n1 = habN(vHabW * 3.1), n2 = habN(vHabW * 17.);            // panel-scale blotches + fine grit
          float st = habN(vec3(vHabW.x * 4.3, vHabW.y * .25, vHabW.z * 4.3));   // vertical run-off streaks
          diffuseColor.rgb *= (.9 + .12 * n1 + .06 * n2) * (1. - .1 * smoothstep(.55, .9, st)); }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (habN(vHabW * 5.7) - .5) * .3, .35, .95);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { // procedural detail-normal overlay (no source texture): a first attempt used the full Mikkelsen
          // tangent-free derivative bump (dividing the screen-space height gradient through the surface-derivative
          // determinant) and it was **rejected on look-gate** — near-tangent screen directions on this cylindrical
          // hull send that determinant toward 0, blowing the perturbation up into a harsh camo/dazzle pattern that
          // hid the decals entirely (see ASSET-QUALITY-1.md, "what was tried and rejected"). Safe replacement:
          // perturb normal.xy by a small CLAMPED screen-space gradient of the same coarse noise field (no
          // division anywhere, so no blow-up) — a gentle micro-facet cue instead of a chaotic flip.
          float habBH = habN(vHabW * 2.2) * .6 + habN(vHabW * 8.0) * .4;
          vec2 habG = clamp(vec2(dFdx(habBH), dFdy(habBH)) * 0.7, vec2(-0.15), vec2(0.15));   // CAMP.md: the pack now carries a real 2k normal map (seams, rivets) — this is only broad panel waviness
          normal = normalize(normal + vec3(habG, 0.0));
        }`); };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|hab2'; };
    mat.needsUpdate = true; return true;
  }
  function updateHab(dt) {
    if ((HAB.t -= dt) > 0 || HAB.n > 60) return; HAB.t = 1; HAB.n++;   // baked.js clones the material after load: keep checking a minute
    C.scene.traverse((o) => { if (o.isMesh && (o.userData.source === 'struct_hab_module' || (o.geometry && o.geometry.userData && o.geometry.userData.source === 'struct_hab_module') || /HDU_lowRez/.test(o.name))) {
      if (fixHabMat(o.material)) ST.stats.habFixed = (ST.stats.habFixed || 0) + 1; } });
  }

    return { seatY, smooth01, DRAWN, updateDebris, buildCase, VIS, solidShells, cover, shellInside, buildKestrelParts, visUnder, tryRocks, withY, buildRocks, buildKestrel, clipBelow, updateCase, updateHab, bind(o) { if ("C" in o) C = o.C; if ("THREE" in o) THREE = o.THREE; if ("V3" in o) V3 = o.V3; } };
  };
})();
