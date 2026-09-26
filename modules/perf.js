/* modules/perf.js — FIX-PERF: instanced scatter by distance (main pass) and by the shadow cache (shadow pass).
 *
 * The big instanced scatter sets (rocks, boulders, flat rocks, outcrops, sea ice, bergs, pressure ridges, crystals,
 * ruins, poles) were single InstancedMeshes spanning the island (or a 200 m cell): every view drew every instance at
 * full detail and every shadow cascade re-drew all of them. Here each set becomes a GROUP (same geometry + material,
 * all source meshes merged, world-space instance list) drawn by three proxies:
 *   near  — full geometry, instances within lodDist of the camera
 *   far   — decimated geometry (vertex clustering, ~25 % triangles), lodDist … drawDist
 *   cast  — shadow casters only (layer 20 = SHADOW's static pass, never the main pass): instances within the
 *           category's cast distance of the shadow-cache centre (small rocks 40 m, rocks 90 m, big rock 150 m,
 *           structures unlimited; sea ice only within 40 m of the shore). Refilled when the cache recentres.
 * near / far are refilled when the camera moved > 6 m (a few hundred matrices, no geometry work).
 * The source meshes stay in the scene untouched for raycasts, Passport, re-seating and QA (they just never draw:
 * intersectsFrustum → false); any change to them (instance matrices, count, visibility, material) rebuilds the group.
 * Knobs (Q, per preset): perfDraw (× draw distances), perfLod (× LOD distances), perfCast (× cast distances).
 * Off switch for A/B: PERF.setOn(false) (or ?noperf).
 */
(function () {
  'use strict';
  const PERF = window.PERF = { on: !/[?&]noperf\b/.test(location.search), groups: [], stats: {}, ready: false };
  let C, THREE, V3, scene, camera;
  const SKIP = /^(veg_|wf_clutter|wf_|terrain|Character|Hermit)/;
  const LS = 20;

  /* ---------- decimation: vertex clustering, keeps hard edges (normal octant) and uv islands (uv bucket) apart ---------- */
  function simplify(geo, ratio) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, n = pos.count;
    const idx = geo.index ? geo.index.array : null, T = idx ? idx.length : n;
    if (T < 600 || geo.groups.length > 1 || geo.morphAttributes.position) return null;
    geo.computeBoundingBox(); const bb = geo.boundingBox, diag = bb.getSize(new V3()).length();
    const target = (T / 3) * ratio;
    const cluster = (cell) => {
      const map = new Map(), rep = new Int32Array(n); let m = 0;
      for (let i = 0; i < n; i++) {
        const ix = Math.floor((pos.getX(i) - bb.min.x) / cell), iy = Math.floor((pos.getY(i) - bb.min.y) / cell), iz = Math.floor((pos.getZ(i) - bb.min.z) / cell);
        let k = ix + ',' + iy + ',' + iz;
        if (nor) k += (nor.getX(i) > 0 ? 'a' : 'b') + (nor.getY(i) > 0 ? 'a' : 'b') + (nor.getZ(i) > 0 ? 'a' : 'b');
        if (uv) k += '|' + Math.floor(uv.getX(i) * 4) + ',' + Math.floor(uv.getY(i) * 4);
        let id = map.get(k); if (id === undefined) { id = m++; map.set(k, id); } rep[i] = id;
      }
      let tris = 0; const out = [];
      for (let t = 0; t < T; t += 3) {
        const a = rep[idx ? idx[t] : t], b = rep[idx ? idx[t + 1] : t + 1], c = rep[idx ? idx[t + 2] : t + 2];
        if (a !== b && b !== c && a !== c) { out.push(a, b, c); tris++; }
      }
      return { rep, m, tris, out };
    };
    let lo = diag / 400, hi = diag / 2, best = null;
    for (let it = 0; it < 16; it++) { const cell = (lo + hi) / 2, r = cluster(cell); if (r.tris > target) lo = cell; else { hi = cell; best = r; } }
    if (!best || best.tris < 12) return null;
    // attributes: position / normal averaged per cluster, everything else from the cluster's first vertex
    const g = new THREE.BufferGeometry(), cnt = new Float32Array(best.m), first = new Int32Array(best.m).fill(-1);
    for (let i = 0; i < n; i++) { const r = best.rep[i]; cnt[r]++; if (first[r] < 0) first[r] = i; }
    for (const name in geo.attributes) {
      const a = geo.attributes[name], isz = a.itemSize, arr = new Float32Array(best.m * isz);
      if (name === 'position' || name === 'normal') {
        for (let i = 0; i < n; i++) { const r = best.rep[i]; for (let k = 0; k < isz; k++) arr[r * isz + k] += a.getComponent(i, k) / cnt[r]; }
        if (name === 'normal') for (let r = 0; r < best.m; r++) { const x = arr[r * 3], y = arr[r * 3 + 1], z = arr[r * 3 + 2], l = Math.hypot(x, y, z) || 1; arr[r * 3] = x / l; arr[r * 3 + 1] = y / l; arr[r * 3 + 2] = z / l; }
      } else for (let r = 0; r < best.m; r++) for (let k = 0; k < isz; k++) arr[r * isz + k] = a.getComponent(first[r], k);
      g.setAttribute(name, new THREE.BufferAttribute(arr, isz, a.normalized));
    }
    g.setIndex(best.m > 65535 ? new THREE.Uint32BufferAttribute(best.out, 1) : new THREE.Uint16BufferAttribute(best.out, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g.name = (geo.name || 'geo') + '_lod'; g.userData = Object.assign({}, geo.userData, { perfLodOf: geo.uuid });
    return g;
  }
  const LODS = new Map();   // geometry uuid → decimated geometry (or null)
  const lodOf = (geo) => { if (!LODS.has(geo.uuid)) { let g = null; try { g = simplify(geo, 0.25); } catch (e) { g = null; } LODS.set(geo.uuid, g); } return LODS.get(geo.uuid); };

  /* ---------- groups ---------- */
  const matKey = (m) => Array.isArray(m) ? m.map((x) => x.uuid).join('+') : m.uuid;
  const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  function effVisible(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  function srcSig(o) { const e = o.matrixWorld.elements; return [o.instanceMatrix.version, o.count, effVisible(o) ? 1 : 0, o.castShadow ? 1 : 0, matKey(o.material), o.geometry.uuid, e[12].toFixed(2), e[13].toFixed(2), e[14].toFixed(2)].join('|'); }
  function isCandidate(o) {
    if (!o.isInstancedMesh || o.isSkinnedMesh || o.userData.perfProxy || o.userData.perfSkip || o.count < 4 || SKIP.test(o.name || '')) return false;
    if (o.material && (Array.isArray(o.material) || o.material.transparent)) return false;
    o.computeBoundingSphere(); _s.setFromMatrixScale(o.matrixWorld);
    return o.boundingSphere.radius * Math.max(_s.x, _s.y, _s.z) > 30;   // spread over the island (not a local cluster)
  }
  let _s;
  function category(name, r) {
    const n = name || '';
    if (/ice|berg|pressure_ridge|floe/i.test(n)) return { cast: 90, shore: true, lod: [30, 22, 60, 170], draw: Infinity };
    if (/rock|boulder|stone|outcrop/i.test(n)) return { cast: r < 1.5 ? 40 : r < 4 ? 90 : 150, lod: [20, 22, 35, 150], draw: 110 + 120 * r };
    return { cast: Infinity, lod: [25, 20, 40, 160], draw: Infinity };   // structures: full shadow range, fog ends the view
  }
  function nearShore(x, z) {
    if (C.getH(x, z) > 0) return true;
    for (const d of [10, 20, 30, 40]) for (let a = 0; a < 8; a++) if (C.getH(x + Math.cos(a * 0.785) * d, z + Math.sin(a * 0.785) * d) > 0) return true;
    return false;
  }
  function makeProxy(G, geo, cap, kind) {
    const src = G.srcs[0], im = new THREE.InstancedMesh(geo, G.mat, Math.max(1, cap));
    im.name = src.name; im.userData = Object.assign({}, src.userData, { perfProxy: kind, perfGroup: G.key });
    im.count = 0; im.frustumCulled = true; im.receiveShadow = src.receiveShadow; im.castShadow = false;
    if (src.customDepthMaterial) im.customDepthMaterial = src.customDepthMaterial;
    if (src.customDistanceMaterial) im.customDistanceMaterial = src.customDistanceMaterial;
    if (G.color) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (kind === 'cast') { im.layers.mask = 0; im.castShadow = true; im.receiveShadow = false; im.userData.shOwned = true; im.userData.shCastDist = Infinity; }
    im.matrixAutoUpdate = false; im.matrix.identity(); im.matrixWorld.identity();
    scene.add(im);
    return im;
  }
  function buildGroup(G) {
    // instance list in world space
    G.inst = []; G.color = G.srcs.some((s) => s.instanceColor);
    const M = new THREE.Matrix4(), W = new THREE.Matrix4(), c = new THREE.Color();
    const gs = G.geo.boundingSphere || (G.geo.computeBoundingSphere(), G.geo.boundingSphere);
    let rSum = 0;
    for (const s of G.srcs) {
      if (!effVisible(s)) continue;
      s.updateWorldMatrix(true, false);
      for (let i = 0; i < s.count; i++) {
        s.getMatrixAt(i, M); W.multiplyMatrices(s.matrixWorld, M);
        const e = W.elements, sc = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
        const ctr = gs.center.clone().applyMatrix4(W), r = gs.radius * sc; rSum += r;
        const it = { m: W.clone(), x: ctr.x, y: ctr.y, z: ctr.z, r, cast: s.castShadow };
        if (G.color && s.instanceColor) { s.getColorAt(i, c); it.c = [c.r, c.g, c.b]; }
        G.inst.push(it);
      }
    }
    const rMean = G.inst.length ? rSum / G.inst.length : 1;
    G.cat = category(G.srcs[0].name, rMean);
    if (G.cat.shore) for (const it of G.inst) if (it.cast) it.cast = nearShore(it.x, it.z);
    const [l0, lk, lmin, lmax] = G.cat.lod;
    for (const it of G.inst) { it.lod = Math.min(lmax, Math.max(lmin, l0 + lk * it.r)); it.draw = G.cat.draw === Infinity ? 1e9 : Math.max(it.lod + 20, 110 + 120 * it.r); it.cdist = G.cat.cast === Infinity ? 1e9 : G.cat.cast; }
    const N = G.inst.length;
    G.lodGeo = triCount(G.geo) >= 600 ? lodOf(G.geo) : null;
    for (const k of ['near', 'far', 'cast']) if (G[k]) { scene.remove(G[k]); G[k].dispose(); G[k] = null; }
    G.near = makeProxy(G, G.geo, N, 'near');
    G.far = G.lodGeo ? makeProxy(G, G.lodGeo, N, 'far') : null;
    G.cast = G.inst.some((it) => it.cast) ? makeProxy(G, G.geo, N, 'cast') : null;
    for (const s of G.srcs) { s.frustumCulled = true; s.intersectsFrustum = hidden; s.userData.perfHidden = true; G.sig.set(s, srcSig(s)); }
    G.dirtyMain = true; G.dirtyCast = true;
  }
  function hidden() { return false; }
  function fill(im, list, G) {
    const a = im.instanceMatrix.array; let k = 0;
    for (const it of list) { a.set(it.m.elements, k * 16); if (im.instanceColor && it.c) im.instanceColor.array.set(it.c, k * 3); k++; }
    im.count = k; im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, k * 16); im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.boundingSphere = null; if (k) im.computeBoundingSphere();
    im.visible = k > 0;
  }
  // main pass: near / far sets around the camera
  function compactMain(G, cx, cz) {
    const Q = C.Q, kl = Q.perfLod || 1, kd = Q.perfDraw || 1, near = [], far = [];
    for (const it of G.inst) {
      const d = Math.hypot(it.x - cx, it.z - cz) - it.r;
      if (d < it.lod * kl || !G.far) { if (d < it.draw * kd) near.push(it); }
      else if (d < it.draw * kd) far.push(it);
    }
    fill(G.near, near, G); if (G.far) fill(G.far, far, G);
    const engine = !(C.SHADOW && C.SHADOW.on);   // engine cascades: the main proxies cast like the sources did
    G.near.castShadow = engine && G.srcs[0].castShadow; if (G.far) G.far.castShadow = engine && G.srcs[0].castShadow;
    PERF.stats.mainInst = (PERF.stats.mainInst || 0) + near.length + far.length;
  }
  // shadow cache: casters around its centre
  function compactCast(G, ax, az) {
    if (!G.cast) return;
    const kc = C.Q.perfCast || 1, R1 = (C.Q.shadowDist || 250) * 1.5 + 60, list = [];
    for (const it of G.inst) { if (!it.cast) continue; const d = Math.hypot(it.x - ax, it.z - az) - it.r; if (d < Math.min(it.cdist * kc, R1)) list.push(it); }
    fill(G.cast, list, G); G.cast.visible = list.length > 0 && !!(C.SHADOW && C.SHADOW.on);
  }

  /* ---------- discovery / sync ---------- */
  const SRC = new Set();
  function discover() {
    const found = [];
    scene.traverse((o) => { if (!SRC.has(o) && isCandidate(o)) found.push(o); });
    if (!found.length) return;
    for (const o of found) {
      SRC.add(o);
      const key = o.geometry.uuid + '/' + matKey(o.material);
      let G = PERF.groups.find((g) => g.key === key);
      if (!G) { G = { key, geo: o.geometry, mat: o.material, srcs: [], sig: new Map() }; PERF.groups.push(G); }
      G.srcs.push(o); G.rebuild = true;
    }
  }
  function sync() {
    for (const G of PERF.groups) {
      if (!G.rebuild) for (const s of G.srcs) { if (!s.parent || G.sig.get(s) !== srcSig(s)) { G.rebuild = true; break; } }
      if (G.rebuild) {
        G.srcs = G.srcs.filter((s) => { if (s.parent) return true; SRC.delete(s); return false; });
        G.rebuild = false;
        if (!G.srcs.length) { for (const k of ['near', 'far', 'cast']) if (G[k]) { scene.remove(G[k]); G[k] = null; } continue; }
        buildGroup(G); PERF.stats.rebuilds = (PERF.stats.rebuilds || 0) + 1;
        if (C.SHADOW && C.SHADOW.center) { const c = C.SHADOW.center[0]; compactCast(G, c.ax, c.az); if (C.SHADOW.rebuild) C.SHADOW.rebuild(); }
      }
    }
  }
  function restore() {
    for (const G of PERF.groups) { for (const k of ['near', 'far', 'cast']) if (G[k]) { scene.remove(G[k]); G[k].dispose(); G[k] = null; } for (const s of G.srcs) { delete s.intersectsFrustum; delete s.userData.perfHidden; SRC.delete(s); } }
    PERF.groups = [];
  }

  let t = 0, lx = 1e9, lz = 1e9, discoverT = 0, syncT = 0;
  function update(dt) {
    if (!PERF.on) return;
    t += dt; discoverT -= dt; syncT -= dt;
    if (discoverT <= 0) { discoverT = t < 40 ? 1 : 5; discover(); }   // packs keep arriving for ~20 s
    if (syncT <= 0) { syncT = 0.5; sync(); }
    const cx = camera.position.x, cz = camera.position.z;
    if ((cx - lx) ** 2 + (cz - lz) ** 2 > 36 || PERF.groups.some((G) => G.dirtyMain)) {
      lx = cx; lz = cz; PERF.stats.mainInst = 0;
      for (const G of PERF.groups) if (G.near) { compactMain(G, cx, cz); G.dirtyMain = false; }
    }
    let tris = 0, inst = 0; for (const G of PERF.groups) { if (G.near) { tris += G.near.count * triCount(G.near.geometry); inst += G.inst.length; } if (G.far) tris += G.far.count * triCount(G.far.geometry); }
    PERF.stats.groups = PERF.groups.length; PERF.stats.instances = inst; PERF.stats.mainTris = Math.round(tris);
  }
  // the shadow cache recentres → refill every group's casters before its tiles render
  function onShadowCenter(ax, az) { if (!PERF.on) return; let n = 0; for (const G of PERF.groups) { compactCast(G, ax, az); if (G.cast) n += G.cast.count; } PERF.stats.castInst = n; }
  PERF.setOn = (on) => { PERF.on = !!on; if (!PERF.on) restore(); else { discoverT = 0; syncT = 0; lx = 1e9; } if (C.SHADOW && C.SHADOW.rebuild) C.SHADOW.rebuild(); return PERF.on; };
  PERF.simplify = (g, r) => simplify(g, r);

  (window.GameModules = window.GameModules || []).push({
    name: 'perf', order: 50,
    init(ctx) {
      C = ctx; THREE = ctx.THREE; V3 = THREE.Vector3; scene = ctx.scene; camera = ctx.camera; _s = new V3();
      if (C.SHADOW) (C.SHADOW.onCenter = C.SHADOW.onCenter || []).push(onShadowCenter);
    },
    update,
  });
})();
