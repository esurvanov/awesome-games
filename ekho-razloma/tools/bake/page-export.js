/* page-export.js — runs INSIDE the game page (open-world.html#dbg), injected by tools/bake/export-scene.mjs.
 * window.BAKE_EXPORT(opts) → plain JSON (typed arrays as base64) describing every STATIC object for the offline bake.
 *
 * Static = what tools/bake/BAKE.md calls "bakeable": visible, not under a dynamic root (pilot, fox, snowmobile, Orm,
 * golem, stags, enemies, pushable props — same list as the game's cached-shadow classifier), not skinned, lit material
 * (MeshStandard/Physical/Lambert/Phong), opaque (alpha-tested allowed). FIX-PERF scatter proxies (userData.perfProxy)
 * are skipped — their untouched sources carry the full instance lists. Camera-streamed ground clutter (veg_ tufts,
 * shrubs, decals; wf_clutter_*) is skipped (stays dynamic). Trees come from the vegetation module's BatchedMeshes
 * (every tree of the island, not only the near ones). The terrain is re-sampled from the RENDERED snow surface
 * (Terrain.snowSurfaceAt) on a fine grid.
 *
 * IDs are stable across loads (seeded world): see bakeId() — the runtime must compute the same key (BAKE.md §IDs).
 */
(function () {
  const b64 = (ta) => { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const r2 = (v, q) => Math.round(v / q) * q;

  // stable id of a non-instanced mesh: name path from its top-level ancestor + world position (0.5 m grid)
  // names only (unnamed nodes by type): child indices shift whenever any module adds an object, names do not
  function namePath(o, scene) { const p = []; for (let q = o; q && q !== scene; q = q.parent) p.unshift(q.name || q.type); return p.join('/'); }
  function bakeId(o, scene) {
    const e = o.matrixWorld.elements, m = Array.isArray(o.material) ? o.material[0] : o.material;
    return namePath(o, scene) + '|' + ((m && m.name) || (m && m.type) || '') + '@' + [r2(e[12], 0.5), r2(e[13], 0.5), r2(e[14], 0.5)].map((v) => v.toFixed(1)).join(',');
  }
  window.BAKE_ID = { bakeId, namePath };

  const CAT = [
    [/crystal_amber|PulseCutter|Case_|Cutter_/i, 'pickup'],   // collectible shards, the cutter case: vanish / animate
    [/kestrel|Cable_|Glass_Broken|Interior_Primer|Seat_Leather/i, 'wreck'],
    [/crystal/i, 'crystal'],
    [/ruin|echo|ancient/i, 'ruin'],
    [/iceberg|ice_chunk|pressure_ridge|rubble|seaIce/i, 'ice'],
    [/boulder|rock|outcrop|cairn|inuksuk|stone/i, 'rock'],
    [/mountain/i, 'backdrop'],
  ];
  const category = (path, mname) => { for (const [re, c] of CAT) if (re.test(path) || re.test(mname || '')) return c; return 'structure'; };

  function albedoOf(m) {   // linear rgb: colour × mean of the albedo map (sRGB decoded)
    const c = m.color ? [m.color.r, m.color.g, m.color.b] : [0.5, 0.5, 0.5];
    const img = m.map && m.map.image;
    if (img && (img.width || img.videoWidth)) {
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 16; const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data; const a = [0, 0, 0]; let n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; for (let k = 0; k < 3; k++) a[k] += Math.pow(d[i + k] / 255, 2.2); n++; }
        if (n) for (let k = 0; k < 3; k++) c[k] *= a[k] / n;
      } catch (e) { /* tainted / not drawable: colour only */ }
    }
    return c;
  }
  function alphaPng(m) {   // alpha-tested foliage: the map as PNG (≤ 512 px) so Cycles sees the same holes
    const img = m.map && m.map.image; if (!img || !(img.width)) return null;
    const s = Math.min(1, 512 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
    const g = cv.getContext('2d'); if (m.map.flipY === false) { g.drawImage(img, 0, 0, cv.width, cv.height); } else { g.translate(0, cv.height); g.scale(1, -1); g.drawImage(img, 0, 0, cv.width, cv.height); }
    return cv.toDataURL('image/png').split(',')[1];
  }

  window.BAKE_EXPORT = function (opts = {}) {
    const D = window.DBG, C = D.MODCTX, T = D.THREE, scene = D.scene;
    scene.updateMatrixWorld(true);
    const out = { meta: {}, geos: [], mats: [], objects: [], lights: [], skipped: {} };
    const skip = (why) => { out.skipped[why] = (out.skipped[why] || 0) + 1; };

    /* ---- dynamic roots (same set as SHADOW.dynRoots in open-world.html) ---- */
    const roots = new Set([D.player.c.g, D.fox && D.fox.g, D.sk && D.sk.g, C.orm && C.orm.g].filter(Boolean));
    if (D.boss && D.boss.g) roots.add(D.boss.g);
    for (const s of D.STAGS || []) if (s.g) roots.add(s.g);
    for (const e of D.enemies || []) if (e.g) roots.add(e.g);
    for (const e of (D.Passport.byRole.pushable || [])) if (e.obj) roots.add(e.obj);

    /* ---- geometry / material tables ---- */
    const geoIdx = new Map(), matIdx = new Map();
    function addGeo(g, key) {
      key = key || g.uuid; if (geoIdx.has(key)) return geoIdx.get(key);
      const pos = g.attributes.position, n = pos.count, P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
      let N = null; if (g.attributes.normal) { const a = g.attributes.normal; N = new Float32Array(n * 3); for (let i = 0; i < n; i++) { N[i * 3] = a.getX(i); N[i * 3 + 1] = a.getY(i); N[i * 3 + 2] = a.getZ(i); } }
      let UV = null; if (g.attributes.uv) { const a = g.attributes.uv; UV = new Float32Array(n * 2); for (let i = 0; i < n; i++) { UV[i * 2] = a.getX(i); UV[i * 2 + 1] = a.getY(i); } }
      let COL = null; if (g.attributes.color) { const a = g.attributes.color; COL = new Float32Array(n * 3); for (let i = 0; i < n; i++) { COL[i * 3] = a.getX(i); COL[i * 3 + 1] = a.getY(i); COL[i * 3 + 2] = a.getZ(i); } }
      let I; if (g.index) I = Uint32Array.from(g.index.array); else { I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; }
      const e = { key, name: g.name || '', n, tris: I.length / 3, P: b64(P), N: N && b64(N), UV: UV && b64(UV), COL: COL && b64(COL), I: b64(I) };
      out.geos.push(e); geoIdx.set(key, out.geos.length - 1); return out.geos.length - 1;
    }
    // sub-geometry of a BatchedMesh (geometry id → its vertex / index range)
    function addBatchGeo(b, gid) {
      const key = b.uuid + ':' + gid; if (geoIdx.has(key)) return geoIdx.get(key);
      const r = b.getGeometryRangeAt(gid), src = b.geometry, g = new T.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'color']) { const a = src.attributes[k]; if (!a) continue; g.setAttribute(k, new T.BufferAttribute(a.array.slice(r.vertexStart * a.itemSize, (r.vertexStart + r.vertexCount) * a.itemSize), a.itemSize)); }
      if (src.index && r.indexCount > 0) { const ia = src.index.array.slice(r.indexStart, r.indexStart + r.indexCount); for (let i = 0; i < ia.length; i++) ia[i] -= r.vertexStart; g.setIndex(new T.BufferAttribute(Uint32Array.from(ia), 1)); }
      g.name = b.name + '_g' + gid; return addGeo(g, key);
    }
    function addMat(m) {
      if (matIdx.has(m)) return matIdx.get(m);
      const e = { name: m.name || m.type, type: m.type, albedo: albedoOf(m), rough: m.roughness !== undefined ? m.roughness : 1, metal: m.metalness || 0,
        emissive: m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : [0, 0, 0], emissiveI: m.emissiveIntensity !== undefined ? m.emissiveIntensity : 1,
        alphaTest: m.alphaTest || 0, side: m.side, vertexColors: !!m.vertexColors, alphaPng: null };
      if ((m.alphaTest > 0 || (m.transparent && m.map)) && m.map) e.alphaPng = alphaPng(m);
      out.mats.push(e); matIdx.set(m, out.mats.length - 1); return out.mats.length - 1;
    }
    const LIT = /MeshStandardMaterial|MeshPhysicalMaterial|MeshLambertMaterial|MeshPhongMaterial/;
    const STREAMED = /^(veg_tufts|veg_shrub|veg_decals|veg_tree|wf_clutter|terrain_detail)/;
    const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible && !p.userData.perfHidden) return false; return true; };

    /* ---- scene walk ---- */
    const walk = (o, dyn) => {
      if (!dyn && roots.has(o)) dyn = true;
      if (o.isLight && (o.isPointLight || o.isSpotLight) && o.visible && !dyn) {
        const p = new T.Vector3().setFromMatrixPosition(o.matrixWorld);
        out.lights.push({ type: o.type, name: o.name || '', color: [o.color.r, o.color.g, o.color.b], intensity: o.intensity, distance: o.distance || 0, decay: o.decay || 2, pos: p.toArray(), parent: o.parent && o.parent.name });
      }
      if (o.isMesh || o.isInstancedMesh || o.isBatchedMesh) {
        const name = o.name || '', m = Array.isArray(o.material) ? o.material[0] : o.material;
        let why = null;
        if (dyn) why = 'dynamic';
        else if (o.isSkinnedMesh) why = 'skinned';
        else if (o.userData.perfProxy) why = 'perfProxy';
        else if (!vis(o)) why = 'hidden';
        else if (STREAMED.test(name)) why = 'streamed';
        else if (!m || !LIT.test(m.type)) why = 'unlit/shader';
        else if (m.transparent && !m.alphaTest && m.opacity < 0.99) why = 'transparent';
        else if (m.transparent && m.depthWrite === false) why = 'transparent';
        else if (name === 'terrain') why = 'terrain(resampled)';
        else if (o.isInstancedMesh && o.count === 0) why = 'empty';
        if (why) skip(why);
        else {
          const path = namePath(o, scene), gi = addGeo(o.geometry), mi = addMat(m);
          const rec = { id: null, path, name, cat: category(path, m.name), geo: gi, mat: mi, cast: !!o.castShadow, matrix: o.matrixWorld.toArray() };
          if (o.isInstancedMesh) {
            const inst = new Float32Array(o.count * 16), mm = new T.Matrix4(), mw = new T.Matrix4();
            for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, mm); mw.multiplyMatrices(o.matrixWorld, mm); inst.set(mw.elements, i * 16); }
            rec.instances = b64(inst); rec.count = o.count; rec.matrix = null;
            const bb = o.geometry.attributes.position.count;
            rec.id = 'inst:' + name + '|' + (m.name || m.type) + '|' + bb + '|' + o.count + '@' + [r2(inst[12], 0.5), r2(inst[14], 0.5)].join(',');
          } else rec.id = bakeId(o, scene);
          out.objects.push(rec);
        }
      }
      for (const c of o.children) walk(c, dyn);
    };
    walk(scene, false);
    // duplicate ids (identical twins at the same spot): suffix #k in traversal order
    { const seen = {}; for (const r of out.objects) { const k = r.id; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) r.id = k + '#' + (seen[k] - 1); } }

    /* ---- trees: every tree of the island from the vegetation BatchedMeshes ---- */
    const V = window.VEG, F = V && V._ && V._.F;
    out.trees = [];
    if (F) for (const G of F.groups) {
      const b = G.b, m = G.mat, mi = addMat(m), per = new Map();   // geometry id → [tree matrices…]
      for (const [t, ids] of G.inst) for (const id of ids) { const gid = b.getGeometryIdAt(id); if (!per.has(gid)) per.set(gid, { sp: new Set(), m: [] }); const e = per.get(gid); e.sp.add(t.v); e.m.push(...t.mReal.elements); e.trees = (e.trees || []); e.trees.push(t.i); }
      for (const [gid, e] of per) {
        const gi = addBatchGeo(b, gid), spn = [...e.sp].map((s) => V.SP[s].name);
        out.trees.push({ id: 'tree:' + b.name + '|' + gid, group: b.name, gid, species: spn, geo: gi, mat: mi, count: e.m.length / 16, instances: b64(new Float32Array(e.m)), treeIdx: e.trees, leaves: /leaves|needles/i.test(m.name) });
      }
    }

    /* ---- terrain: rendered snow surface on a fine grid + albedo for the bounce ---- */
    const TR = window.Terrain, RES = opts.terrainRes || 1024, W = C.W, cell = W / RES, VN = RES + 1;
    const Hh = new Float32Array(VN * VN), ALB = new Uint8Array(VN * VN * 3);
    const surf = TR && TR.snowSurfaceAt ? (x, z) => TR.snowSurfaceAt(x, z) : (x, z) => C.getH(x, z);
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const toS = (v) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(v, 0), 1 / 2.2) * 255)));
    for (let iz = 0; iz < VN; iz++) for (let ix = 0; ix < VN; ix++) {
      const x = ix * cell - W / 2, z = iz * cell - W / 2, i = iz * VN + ix;
      Hh[i] = Math.max(surf(x, z), -4);
    }
    for (let iz = 0; iz < VN; iz++) for (let ix = 0; ix < VN; ix++) {
      const i = iz * VN + ix, x = ix * cell - W / 2, z = iz * cell - W / 2;
      const hx = Hh[iz * VN + Math.min(ix + 1, RES)] - Hh[iz * VN + Math.max(ix - 1, 0)], hz = Hh[Math.min(iz + 1, RES) * VN + ix] - Hh[Math.max(iz - 1, 0) * VN + ix];
      const ny = 2 * cell / Math.hypot(hx, 2 * cell, hz);
      // snow / rock split of the terrain shader (snowMask = smoothstep(.7, .86, n.y)); rift violet, lake ice, shore
      const dr = C.riftD(x, z), rock = sm(62, 42, dr) * 0.9;
      const snowK = sm(0.7, 0.86, ny) * (1 - rock);
      let r = 0.052 + (0.47 - 0.052) * snowK, g = 0.066 + (0.52 - 0.066) * snowK, b = 0.11 + (0.62 - 0.11) * snowK;   // linear: rock ≈ vec3(.35,.43,.65)×rock tex, snow ≈ .47,.52,.62
      if (dr < 72) { const t = sm(72, 45, dr); r *= 1 - 0.62 * t; g *= 1 - 0.79 * t; b *= 1 - 0.1 * t; }
      if (Hh[i] < 0.3) { r *= 0.8; g *= 0.9; b *= 1.02; }
      ALB[i * 3] = toS(r); ALB[i * 3 + 1] = toS(g); ALB[i * 3 + 2] = toS(b);
    }
    out.terrain = { res: RES, W, cell, origin: [-W / 2, -W / 2], H: b64(Hh), albedo: b64(ALB), source: TR && TR.snowSurfaceAt ? 'Terrain.snowSurfaceAt' : 'getH' };

    /* ---- sea (receiver / bounce only) ---- */
    out.sea = { y: 0, albedo: [0.25, 0.4, 0.5] };

    /* ---- lights, sky, fog ---- */
    const col = (c) => [c.r, c.g, c.b];
    const md = D.moon.position.clone().normalize();
    out.env = {
      moon: { dir: md.toArray(), color: col(D.moon.color), intensity: D.moon.intensity, note: 'three DirectionalLight: light travels from +dir towards the origin' },
      aurora: { dir: D.aurLight.position.clone().normalize().toArray(), color: col(D.aurLight.color), intensity: D.aurLight.intensity },
      hemi: { sky: col(D.hemi.color), ground: col(D.hemi.groundColor), intensity: D.hemi.intensity },
      envIntensity: scene.environmentIntensity, backgroundIntensity: scene.backgroundIntensity, exposure: D.renderer.toneMappingExposure, toneMapping: D.renderer.toneMapping,
      fog: scene.fog ? { type: scene.fog.isFogExp2 ? 'exp2' : 'linear', color: col(scene.fog.color), near: scene.fog.near, far: scene.fog.far, density: scene.fog.density } : null,
      sky: { texture: 'assets/sky.jpg', mapping: 'equirect', uniforms: Object.fromEntries(Object.entries(D.skyU).filter(([k, v]) => typeof v.value === 'number').map(([k, v]) => [k, v.value])) },
      style: window.STYLE ? { palette: { moon: STYLE.palette.moon, hemiSky: STYLE.palette.hemiSky, hemiGround: STYLE.palette.hemiGround, auroraA: STYLE.palette.auroraA, fog: STYLE.palette.fog } } : null,
    };
    out.meta = { date: new Date().toISOString(), quality: C.Q.name, pois: C.POI, wf: window.WorldFill && WorldFill.stats ? { camp: WorldFill.stats.camp && { x: WorldFill.stats.camp.x, z: WorldFill.stats.camp.z }, ship: WorldFill.stats.ship, pier: WorldFill.stats.pier, ruins: WorldFill.stats.ruins } : null,
      kestrel: D.WORLD.kestrel ? D.WORLD.kestrel.g.position.toArray() : null, trees: V ? V.trees.length : 0 };
    return out;
  };
})();
