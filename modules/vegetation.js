/* Module "vegetation" — VEGETATION & ROCKS (wave 2). Owner: vegetation agent. Docs: VEGETATION.md
 *
 *  1. FOREST   10 species (7 new conifers + the 3 pass-1 trees), placed by altitude / exposure / rift distance.
 *              near: real models in BatchedMeshes (one draw per material, per-tree visibility, shadows only < shadowR)
 *              mid : 16-tri cross cards (one instanced draw for every species, shared 2048x2560 impostor atlas)
 *              far : camera-facing billboards, 8 views blended (one instanced draw)
 *              dithered cross-fade between the three, wind sway in the vertex shaders, branch wobble + snow puff.
 *              The game's cone impostors and its tree InstancedMeshes are retired (updateForest is short-circuited).
 *  2. GROUND   photo tufts (4 variants), dwarf birch / willow / crowberry, lichen & moss decals in camera-centred
 *              16 m chunks; placed where snow is thin (slopes, wind-scoured ridges, lake shore, around rocks).
 *              Wind sway (stronger in WX.storm), bending away from player / fox / stags / shardlings.
 *              Hides WorldFill's triangle grass + primitive shrubs (meshes 'wf_clutter_grass', 'wf_clutter_shrub').
 *  3. ROCKS    boulders re-seated (buried 20-35 % against the lowest ground under them, tilted), procedural rocks
 *              re-seated, + flat namaqualand boulders and rock-face outcrops; snow skirts; top snow + lichen shader;
 *              every rock registered with Passport 'solid'.
 *  ctx API added: ctx.shakeTree(x, z, strength) · ctx.VEG (state/knobs) · Passport provider for passables.
 */
(function () {
  'use strict';
  const VEG = window.VEG = { stats: {}, ready: {}, trees: [], knobs: null };
  let C, THREE, V3, scene, renderer, camera;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ihash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return h ^ (h >>> 16); };
  const WIND = [1, 0.18]; { const l = Math.hypot(WIND[0], WIND[1]); WIND[0] /= l; WIND[1] /= l; }   // same as WorldFill (snow drifts to +x)

  /* ------------------------------------------------------------------ quality knobs (added to QUALITY presets) */
  const KNOBS = {
    low: { vegTreeMid: 210, vegGrassR: 36, vegShrubR: 45, vegDecalR: 28 },
    med: { vegTreeMid: 260, vegGrassR: 50, vegShrubR: 60, vegDecalR: 40 },
    high: { vegTreeMid: 300, vegGrassR: 60, vegShrubR: 72, vegDecalR: 48 },
    ultra: { vegTreeMid: 380, vegGrassR: 80, vegShrubR: 100, vegDecalR: 64 },
  };

  /* ------------------------------------------------------------------ shared uniforms + GLSL */
  const U = {};
  const GLSL_COMMON = `
uniform float uVT, uVStorm, uVSR; uniform vec2 uVWind; uniform vec3 uVCam; uniform vec4 uVFade; uniform vec4 uVActors[8]; uniform vec4 uVShake[6]; uniform vec4 uVShakeD[6];
float vegH21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 vegSway(vec2 org, float k, float amp){
  float ph = dot(org, vec2(.131, .077));
  float gust = .55 + .45 * sin(uVT * .71 - dot(org, uVWind) * .045) * sin(uVT * .23 + ph);
  float a = amp * (.18 + .82 * uVStorm) * (.4 + .6 * gust) * k;
  vec2 d = uVWind * a * (1. + .35 * sin(uVT * 1.9 + ph * 3.));
  d += vec2(-uVWind.y, uVWind.x) * a * .3 * sin(uVT * 2.7 + ph * 5.);
  return d;
}`;
  const GLSL_DITHER = `float vegDither(){ return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))); }`;
  // last line of defence: a NaN/Inf pixel would be smeared over the whole frame by bloom (black screen)
  const SAFE_END = (fs) => fs.replace(/}\s*$/, '  gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0., 0., 0., 1.) : min(gl_FragColor, vec4(64.));\n}');
  function sharedUniforms(sh) { for (const k in U) sh.uniforms[k] = U[k]; }

  /* ------------------------------------------------------------------ species */
  // sc: scale range · S: billboard cell size (m) · align: +X downwind · snow: puff amount when shaken · src: game|pack
  const NEW_MUL = 0.47;   // pass-2 species: real models to 0.47 x treeNear (≈82 m on high), cross cards beyond
  const SP = [
    { name: 'tree_spruce_tall_snow', src: 'game', sc: [0.6, 0.95], snow: 1, nearMul: 0.36 },
    { name: 'tree_spruce_small_snow', src: 'game', sc: [0.85, 1.35], snow: 1, nearMul: 0.36 },
    { name: 'tree_dead_birch', src: 'game', sc: [0.6, 0.9], snow: 0.15, nearMul: 0.4 },
    { name: 'tree_spruce_snowladen', S: 11.44, sc: [0.8, 1.25], snow: 1.4, nearMul: NEW_MUL },
    { name: 'tree_spruce_young_dusted', S: 6.76, sc: [0.8, 1.3], snow: 0.8, nearMul: NEW_MUL },
    { name: 'tree_spruce_dense_tall', S: 16.65, sc: [0.75, 1.1], snow: 0.5, nearMul: NEW_MUL },
    { name: 'tree_fir_windbent', S: 9.36, sc: [0.75, 1.15], align: true, snow: 0.4, nearMul: NEW_MUL },
    { name: 'tree_spruce_krummholz', S: 2.64, sc: [0.7, 1.35], align: true, snow: 0.5, nearMul: NEW_MUL },
    { name: 'tree_pine_scots', S: 14.0, sc: [0.75, 1.1], snow: 0.4, nearMul: NEW_MUL },
    { name: 'tree_snag_dead', S: 7.6, sc: [0.7, 1.2], snow: 0.1, nearMul: NEW_MUL },
  ];
  const NSP = SP.length;
  
  const ATL = { W: 2048, H: 2560, bw: 0.5, bh: 0.2 };   // species block s: 1024x512 at ((s%2)*1024, floor(s/2)*512)

  /* ================================================================== init */
  function init(ctx) {
    C = ctx; THREE = ctx.THREE; V3 = THREE.Vector3; scene = ctx.scene; renderer = ctx.renderer; camera = ctx.camera;
    for (const q in KNOBS) if (ctx.QUALITY[q]) for (const k in KNOBS[q]) if (ctx.QUALITY[q][k] === undefined) ctx.QUALITY[q][k] = KNOBS[q][k];
    const kq = KNOBS[ctx.Q.name] || KNOBS.high; for (const k in kq) if (ctx.Q[k] === undefined) ctx.Q[k] = kq[k];
    Object.assign(U, {
      uVT: { value: 0 }, uVStorm: { value: 0 }, uVWind: { value: new THREE.Vector2(WIND[0], WIND[1]) }, uVCam: { value: new V3() },
      uVFade: { value: new THREE.Vector4(175, 14, 300, 30) },   // near R, band, mid R, band
      uVActors: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
      uVShake: { value: Array.from({ length: 6 }, () => new THREE.Vector4(1e5, 1e5, 0, -99)) }, uVShakeD: { value: Array.from({ length: 6 }, () => new THREE.Vector4(1, 0, 0, 0)) }, uVSR: { value: 90 },
      uVGrass: { value: new THREE.Vector4(64, 10, 95, 14) },   // tuft R, band, shrub R, band
      uVBB: { value: new THREE.Vector3(1, 1, 1) },
    });
    VEG.U = U; VEG.SP = SP; VEG._ = { F, GR, R, A };   // internals (debug / stand)
    ctx.VEG = VEG;
    ctx.shakeTree = shakeTree;
    hideWorldFillClutter();
    Passport().providers.push(passablesNear);
    ctx.vegPassablesNear = passablesNear;
    setupForest();
    setupAtlas();
    loadAssets();
    setupGround();
  }
  const Passport = () => C.Passport;

  /* ------------------------------------------------------------------ WorldFill: hide the old triangle grass / shrubs */
  function hideWorldFillClutter() {
    const hidden = [];
    for (const n of ['wf_clutter_grass', 'wf_clutter_shrub']) { const o = scene.getObjectByName(n); if (o) { o.visible = false; hidden.push(n); } }
    const P = Passport(), i = window.WorldFill ? P.providers.indexOf(window.WorldFill.passablesNear) : -1;
    if (i >= 0) P.providers.splice(i, 1);   // its grass/shrub cells are replaced by ours
    VEG.stats.hiddenWorldFill = hidden;
  }

  /* ================================================================== FOREST */
  const F = { trees: [], groups: [], adopted: [], grid: new Map(), GS: 12 };
  function convexity(x, z, r) { const h = C.getH(x, z); let s = 0; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; s += C.getH(x + Math.cos(a) * r, z + Math.sin(a) * r); } return h - s / 6; }
  function setupForest() {
    const FO = C.FOREST, list = FO.list, r = mulberry(9001);
    const snagZone = (x, z) => { const d = C.riftD(x, z); return d > 96 && d < 150; };
    // species for the pass-1 positions: altitude, exposure (convexity), rift proximity
    const pick = (x, z, h, rr) => {
      const cv = convexity(x, z, 14), dr = C.riftD(x, z);
      if (dr < 118 && rr < 0.22) return 9;
      if (h > 46) return rr < 0.45 ? 7 : rr < 0.8 ? 4 : 1;
      if (cv > 1.4 && h > 12) return rr < 0.6 ? 6 : 4;
      const w = [[3, 0.27], [4, 0.2], [5, 0.15], [0, 0.13], [1, 0.08], [8, 0.08], [6, 0.03], [2, 0.03], [9, 0.03]];
      let a = 0; for (const [s, p] of w) { a += p; if (rr < a) return s; } return 3;
    };
    for (let i = 0; i < list.length; i++) { const t = list[i]; t.v = pick(t[0], t[2], C.getH(t[0], t[2]), r()); }
    // extra trees: krummholz treeline, wind-bent firs on ridges, dead snags on the rift outskirts
    const occupied = (x, z, d) => { for (const t of list) if ((t[0] - x) ** 2 + (t[2] - z) ** 2 < d * d) return true; return false; };
    const sites = (() => { const s = []; const st = window.WorldFill && window.WorldFill.stats; if (st) { if (st.camp) s.push(st.camp); if (st.ship) s.push(st.ship); if (st.pier) s.push(st.pier); for (const q of st.ruins || []) s.push(q); } return s.filter((q) => q && isFinite(q.x)); })();
    const nearSite = (x, z, d) => sites.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < d * d);
    const add = (v, want, test) => {
      let n = 0;
      for (let k = 0; k < want * 60 && n < want; k++) {
        const x = (r() - 0.5) * 780, z = (r() - 0.5) * 780, h = C.getH(x, z);
        if (h < 1.5 || C.nearPOI(x, z, 6) || C.inRift(x, z, 8) || nearSite(x, z, 18) || !test(x, z, h)) continue;
        if (occupied(x, z, v === 7 ? 3.5 : 6)) continue;
        const t = [x, h - 0.2, z, 1, r() * TAU]; t.v = v; t.extra = true; list.push(t); n++;
        if (v === 7) for (let c = 0, m = 1 + (r() * 4 | 0); c < m; c++) {   // krummholz grows in small groups
          const a = r() * TAU, d = 2.5 + r() * 5, cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, ch = C.getH(cx, cz);
          if (C.normalY(cx, cz) < 0.7 || occupied(cx, cz, 2.4)) continue; const u = [cx, ch - 0.2, cz, 1, r() * TAU]; u.v = 7; u.extra = true; list.push(u);
        }
      }
      return n;
    };
    add(7, 70, (x, z, h) => h > 38 && h < 80 && C.normalY(x, z) > 0.72 && C.fbm(x * 0.02 + 5, z * 0.02 - 9, 3) > 0.47);
    add(6, 45, (x, z, h) => h > 14 && h < 62 && C.normalY(x, z) > 0.8 && convexity(x, z, 14) > 1.6);
    add(9, 18, (x, z, h) => snagZone(x, z) && C.normalY(x, z) > 0.8);
    // transforms: t.mReal is what the game registers trunk colliders with (species 0-2) and what we draw
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s3 = new V3();
    const downwind = Math.atan2(-WIND[1], WIND[0]);
    list.forEach((t, i) => {
      const sp = SP[t.v], a = sp.sc[0], b = sp.sc[1], rs = a + (b - a) * C.hash2(i * 7 + 3, 91);
      const yaw = sp.align ? downwind + (C.hash2(i, 17) - 0.5) * 0.7 : t[4];
      const tilt = t.v === 9 ? (C.hash2(i, 5) - 0.5) * 0.12 : 0;
      const h = C.getH(t[0], t[2]);
      e.set(tilt, yaw, 0); q.setFromEuler(e);
      t.mReal = new THREE.Matrix4().compose(p.set(t[0], h - 0.3, t[2]), q, s3.set(rs, rs, rs));
      t.s = rs; t.yaw = yaw; t.y = h - 0.3; t.i = i; t.st = -1; t.shakeT = -9;
    });
    F.trees = VEG.trees = list;
    for (const t of list) { const k = Math.floor(t[0] / F.GS) * 65536 + Math.floor(t[2] / F.GS); let a = F.grid.get(k); if (!a) F.grid.set(k, (a = [])); a.push(t); }
    // retire the game's forest driver: updateForest() returns early forever (lx/lz follow the camera, dirty stays false)
    let R = FO.R, SR = FO.shadowR;
    Object.defineProperty(FO, 'dirty', { configurable: true, get: () => false, set: (v) => { if (v) F.dirty = true; } });
    Object.defineProperty(FO, 'lx', { configurable: true, get: () => camera.position.x, set() {} });
    Object.defineProperty(FO, 'lz', { configurable: true, get: () => camera.position.z, set() {} });
    Object.defineProperty(FO, 'R', { configurable: true, get: () => R, set: (v) => { R = v; F.dirty = true; } });
    Object.defineProperty(FO, 'shadowR', { configurable: true, get: () => SR, set: (v) => { SR = v; F.dirty = true; } });
    if (FO.far) { FO.far.visible = false; FO.far.count = 0; }
    FO.mid = [];
    VEG.stats.trees = list.length; VEG.stats.species = SP.map((sp, i) => list.filter((t) => t.v === i).length);
  }

  // --- tree materials (near): wind, shake wobble, dithered fade-out at the near radius ---
  function patchTreeNear(mat, needles, depth, mul = 1) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev && !depth) prev(sh, r);
      sharedUniforms(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying float vVFade;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_BATCHING
            mat4 vM = batchingMatrix;
          #else
            mat4 vM = mat4(1.);
          #endif
          vec3 vOrg = (modelMatrix * vM[3]).xyz; float vS2 = dot(vM[0].xyz, vM[0].xyz);
          float vK = clamp(position.y / 12., 0., 1.4); vK *= vK;
          vec3 vOff = vec3(0.); vOff.xz = vegSway(vOrg.xz, vK, 1.1);
          ${needles && !depth ? 'vOff += vec3(sin(uVT * 5.3 + dot(position, vec3(2.1, 1.3, 1.7))), 0., cos(uVT * 4.1 + dot(position, vec3(1.7, 2.3, 1.1)))) * .025 * clamp(position.y / 3., 0., 1.) * (.3 + uVStorm);' : ''}
          ${depth ? '' : `for (int i = 0; i < 6; i++) { vec4 s = uVShake[i]; if (abs(vOrg.x - s.x) + abs(vOrg.z - s.y) < .6) { float tt = uVT - s.w; float a = s.z * exp(-2.2 * tt) * sin(tt * 10.5) * step(0., tt);
            vOff.xz += uVShakeD[i].xy * a * vK * 1.6; vOff.y -= abs(a) * vK * .15; } }`}
          vOff.y -= length(vOff.xz) * .12 * vK;
          transformed += (transpose(mat3(vM)) * vOff) / max(vS2, 1e-4);
          float vD = length(vOrg.xz - uVCam.xz); vVFade = 1. - smoothstep(uVFade.x * ${mul.toFixed(2)} - uVFade.y, uVFade.x * ${mul.toFixed(2)}, vD);
          ${depth ? 'vVFade *= 1. - smoothstep(uVSR - 10., uVSR, vD);' : ''}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVFade;\n' + GLSL_DITHER)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vegDither() > vVFade) discard;');
      if (!depth) sh.fragmentShader = SAFE_END(sh.fragmentShader);
    };
    mat.customProgramCacheKey = () => 'vegTree' + (needles ? 'N' : 'B') + (depth ? 'D' : '') + mul;
    return mat;
  }
  function depthFor(mat, needles, mul) {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map || null, alphaTest: mat.alphaTest || 0, side: mat.side });
    return patchTreeNear(d, needles, true, mul);
  }

  // group = one BatchedMesh pair (cast / no-cast) per material shared by several species
  function makeGroup(key, mat, parts, needles, mul = 1) {
    // parts: [{ sp, geo }]
    const geos = [];
    let nv = 0, ni = 0;
    for (const p of parts) { if (!geos.includes(p.geo)) { geos.push(p.geo); nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : 0; } }
    const spSet = new Set(parts.map((p) => p.sp)), trees = F.trees.filter((t) => spSet.has(t.v));
    if (!trees.length) return null;
    let nInst = 0; for (const t of trees) nInst += parts.filter((p) => p.sp === t.v).length;
    // one BatchedMesh per material: one draw call for every visible tree of these species; shadows only from trees
    // inside shadowR (their instances are switched off just for the shadow passes)
    const b = new THREE.BatchedMesh(Math.max(1, nInst), nv, Math.max(ni, 3), mat);
    b.name = 'veg_tree_' + key; b.castShadow = true; b.receiveShadow = true; b.frustumCulled = false; b.sortObjects = true;
    b.customDepthMaterial = depthFor(mat, needles, mul);
    const G = { key, mat, b, inst: new Map(), noCast: new Set(), nVis: 0, nCast: 0 };
    b.onBeforeShadow = function (r, o, cam, shCam, geo, dm) {
      const info = this._instanceInfo; for (const id of G.noCast) if (info[id]) info[id].visible = false;
      try { THREE.BatchedMesh.prototype.onBeforeShadow.call(this, r, o, cam, shCam, geo, dm); } finally { for (const id of G.noCast) if (info[id]) info[id].visible = true; }
    };
    scene.add(b);
    const gid = new Map();
    for (const g of geos) gid.set(g, b.addGeometry(g));
    for (const t of trees) {
      const ids = [];
      for (const p of parts) if (p.sp === t.v) { const id = b.addInstance(gid.get(p.geo)); b.setMatrixAt(id, t.mReal); b.setVisibleAt(id, false); ids.push(id); }
      G.inst.set(t, ids);
    }
    for (const t of trees) if (t.st > 0) { for (const id of G.inst.get(t)) { b.setVisibleAt(id, true); if (t.st === 2) G.noCast.add(id); } G.nVis++; if (t.st === 1) G.nCast++; }
    b.visible = G.nVis > 0; b.castShadow = G.nCast > 0;
    F.groups.push(G); F.dirty = true;
    return G;
  }
  function setTreeState(t, st) {
    for (const G of F.groups) {
      const ids = G.inst.get(t); if (!ids) continue;
      const was = t.st;   // previous state (updated by the caller after this)
      for (const id of ids) { G.b.setVisibleAt(id, st > 0); if (st === 2) G.noCast.add(id); else G.noCast.delete(id); }
      G.nVis += (st > 0 ? 1 : 0) - (was > 0 ? 1 : 0); G.nCast += (st === 1 ? 1 : 0) - (was === 1 ? 1 : 0);
      G.b.visible = G.nVis > 0; G.b.castShadow = G.nCast > 0;   // no draw call (main / 2 cascades) for an empty batch
    }
  }
  let lastFX = 1e9, lastFZ = 1e9;
  function updateForest() {
    const cx = camera.position.x, cz = camera.position.z, R = C.FOREST.R, SR = C.FOREST.shadowR, mid = C.Q.vegTreeMid || 300;
    U.uVFade.value.set(R, 14, Math.max(mid, R + 40), 30); U.uVSR.value = SR;
    if (!F.dirty && (cx - lastFX) ** 2 + (cz - lastFZ) ** 2 < 1) return;
    F.dirty = false; lastFX = cx; lastFZ = cz;
    const S2 = SR * SR;
    let nNear = 0, nCast = 0;
    for (const t of F.trees) {
      // shadow LOD per tree: tall trees cast up to shadowR, small ones stop earlier (alpha-tested foliage in 2 cascades is the
      // most expensive part of the shadow pass)
      const cr = Math.min(SR, 30 + 3.2 * (SP[t.v].H || 8) * t.s), d2 = (t[0] - cx) ** 2 + (t[2] - cz) ** 2, nr = R * (SP[t.v].nearMul || 1) + 1.5, st = d2 < Math.min(S2, cr * cr) ? 1 : d2 < nr * nr ? 2 : 0;
      if (st) nNear++; if (st === 1) nCast++;
      if (st !== t.st) { setTreeState(t, st); t.st = st; }
    }
    VEG.stats.nearTrees = nNear; VEG.stats.castTrees = nCast;
  }
  // trees within r of (x, z) (spatial grid)
  function treesNear(x, z, r, out = []) {
    const G = F.GS;
    for (let i = Math.floor((x - r) / G); i <= Math.floor((x + r) / G); i++) for (let j = Math.floor((z - r) / G); j <= Math.floor((z + r) / G); j++) {
      const a = F.grid.get(i * 65536 + j); if (a) for (const t of a) if ((t[0] - x) ** 2 + (t[2] - z) ** 2 < r * r) out.push(t);
    }
    return out;
  }
  VEG.treesNear = treesNear;

  // --- adopt the game's 3 pass-1 species once its loader callbacks built them ---
  function adoptGameTrees() {
    const FO = C.FOREST;
    for (let vi = 0; vi < 3; vi++) {
      if (F.adopted[vi] || !FO.parts[vi] || !FO.parts[vi].length || !FO.parts[vi][0].isInstancedMesh) continue;
      const src = FO.parts[vi].map((im) => ({ geo: sanitize(im.geometry), mat: im.material }));
      for (const im of FO.parts[vi].concat(FO.mid[vi] || [])) { if (im.parent) im.parent.remove(im); }
      F.adopted[vi] = src;
      // bounds for the impostor bake
      const bb = new THREE.Box3(); for (const s of src) { s.geo.computeBoundingBox(); bb.union(s.geo.boundingBox); }
      SP[vi].H = bb.max.y; SP[vi].S = Math.max(bb.max.y, 2 * Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z)) * 1.03;
      SP[vi].bake = src;
    }
    // species 0/1 share bark/leaves/leaves_snow textures → one group per material name; birch alone
    if (F.adopted[0] && F.adopted[1] && !F.gameGroups) {
      F.gameGroups = true;
      const byName = {};
      for (const vi of [0, 1]) for (const s of F.adopted[vi]) (byName[s.mat.name] = byName[s.mat.name] || { mat: s.mat, parts: [] }).parts.push({ sp: vi, geo: s.geo });
      for (const n in byName) { const m = nearMat(byName[n].mat, SP[0].nearMul); makeGroup('e_' + n, m, byName[n].parts, /leaves/i.test(n), SP[0].nearMul); }
      publishParts();
    }
    if (F.adopted[2] && !F.birchGroup) {
      F.birchGroup = true;
      for (const s of F.adopted[2]) makeGroup('e_birch_' + s.mat.name, nearMat(s.mat, SP[2].nearMul), [{ sp: 2, geo: s.geo }], false, SP[2].nearMul);
      publishParts();
    }
  }
  function nearMat(src, mul) {
    const m = src.clone(); m.name = src.name;
    if (m.transparent && m.alphaTest === 0) { m.transparent = false; m.alphaTest = 0.3; }
    return patchTreeNear(m, /leaves|needles/i.test(src.name), false, mul);
  }
  // FOREST.parts[vi] = near meshes of that species (stand.mjs raycasts FOREST.parts[0] bark for the trunk test)
  function publishParts() {
    const FO = C.FOREST; FO.parts = [];
    for (let vi = 0; vi < NSP; vi++) FO.parts[vi] = F.groups.filter((G) => [...G.inst.keys()].some((t) => t.v === vi)).map((G) => G.b);
  }

  /* ------------------------------------------------------------------ impostor atlas (render target) */
  const A = {};
  function makeRT(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: true });
    rt.texture.anisotropy = 4; rt.texture.name = 'vegAtlas';
    return rt;
  }
  function setupAtlas() {
    A.tree = makeRT(ATL.W, ATL.H);
    A.tuft = makeRT(1024, 1024); A.leaf = makeRT(1024, 1024); A.decal = makeRT(1024, 1024);
    for (const rt of [A.tree, A.tuft, A.leaf, A.decal]) clearRT(rt, 0.05, 0.07, 0.05);
    A.blitMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }' });
    A.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), A.blitMat); A.quad.frustumCulled = false;
    A.qScene = new THREE.Scene(); A.qScene.add(A.quad); A.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    A.queue = [];
  }
  function withRT(rt, x, y, w, h, fn) {
    const prevRT = renderer.getRenderTarget(), prevAC = renderer.autoClear, cc = new THREE.Color(); renderer.getClearColor(cc); const ca = renderer.getClearAlpha();
    const prevSh = renderer.shadowMap.autoUpdate;
    rt.viewport.set(x, y, w, h); rt.scissor.set(x, y, w, h); rt.scissorTest = true;
    renderer.setRenderTarget(rt); renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
    try { fn(); } finally {
      rt.viewport.set(0, 0, rt.width, rt.height); rt.scissor.set(0, 0, rt.width, rt.height); rt.scissorTest = false;
      renderer.setRenderTarget(prevRT); renderer.autoClear = prevAC; renderer.setClearColor(cc, ca); renderer.shadowMap.autoUpdate = prevSh;
    }
  }
  function clearRT(rt, r, g, b) { withRT(rt, 0, 0, rt.width, rt.height, () => { renderer.setClearColor(new THREE.Color().setRGB(r, g, b), 0); renderer.clear(true, true, false); }); }
  function blit(rt, tex, x, y, w, h) { A.blitMat.uniforms.tSrc.value = tex; withRT(rt, x, y, w, h, () => renderer.render(A.qScene, A.qCam)); A.blitMat.uniforms.tSrc.value = null; }
  function blockPx(s) { return [(s % 2) * 1024, Math.floor(s / 2) * 512]; }
  // bake a species (the game's pass-1 trees) into its 4x2 block: orthographic views every 45°, neutral light ≈ albedo
  function bakeSpecies(s) {
    const sp = SP[s], S = sp.S, [bx, by] = blockPx(s);
    const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.72)); const dl = new THREE.DirectionalLight(0xffffff, 0.9); sc.add(dl); sc.add(dl.target);
    const g = new THREE.Group(); sc.add(g);
    for (const p of sp.bake) { const m = p.mat.clone(); m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => 'vegBake' + m.type; if (m.transparent && !m.alphaTest) { m.transparent = false; m.alphaTest = 0.3; } g.add(new THREE.Mesh(p.geo, m)); }
    const cam = new THREE.OrthographicCamera(-S / 2, S / 2, S, 0, 0.1, 200);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, col = i % 4, row = Math.floor(i / 4);
      cam.position.set(Math.sin(a) * 80, 0, Math.cos(a) * 80); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      dl.position.set(Math.sin(a + 0.5) * 50, 60, Math.cos(a + 0.5) * 50);
      withRT(A.tree, bx + col * 256, by + (1 - row) * 256, 256, 256, () => { renderer.setClearColor(new THREE.Color().setRGB(0.03, 0.05, 0.035), 0); renderer.clear(true, true, false); renderer.render(sc, cam); });
    }
    g.traverse((o) => { if (o.material) o.material.dispose(); });
    sp.baked = true;
  }

  /* ------------------------------------------------------------------ mid (cross cards) + far (billboards) */
  function midGeometry() {
    // 4 vertical planes at 0/45/90/135°, both faces; face looking along azimuth a shows view a (atlas cell), base at y=0
    const pos = [], uv = [], view = [], idx = [];
    for (let k = 0; k < 4; k++) for (const back of [0, 1]) {
      const vi = k + back * 4, a = vi * Math.PI / 4, rx = Math.cos(a), rz = -Math.sin(a), b = pos.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(rx * (u - 0.5), v, rz * (u - 0.5)); uv.push(u, v); view.push(vi); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aView', new THREE.Float32BufferAttribute(view, 1)); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx); return g;
  }
  function farGeometry() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]); return g;
  }
  function impostorAttrs(g) {
    const n = F.trees.length, aT = new Float32Array(n * 4), aT2 = new Float32Array(n * 4);
    F.trees.forEach((t, i) => { aT.set([t[0], t.y, t[2], t.yaw], i * 4); aT2.set([(SP[t.v].S || 10) * t.s, t.v, C.hash2(i, 33), SP[t.v].nearMul || 1], i * 4); });
    g.setAttribute('aT', new THREE.InstancedBufferAttribute(aT, 4)); g.setAttribute('aT2', new THREE.InstancedBufferAttribute(aT2, 4));
    g.instanceCount = n;
  }
  function refreshImpostorSizes() {
    for (const m of [F.mid, F.far]) { if (!m) continue; const a = m.geometry.attributes.aT2; F.trees.forEach((t, i) => { a.array[i * 4] = (SP[t.v].S || 10) * t.s; }); a.needsUpdate = true; }
  }
  const GLSL_ATLAS = `
vec2 vegCell(float sp, float view, vec2 uv){
  float col = mod(view, 4.), row = floor(view / 4.);
  vec2 blk = vec2(mod(sp, 2.) * .5, floor(sp / 2. + .01) * .2);
  vec2 c = vec2((col + clamp(uv.x, .004, .996)) / 4., ((1. - row) + clamp(uv.y, .004, .996)) / 2.);
  return blk + c * vec2(.5, .2);
}`;
  function impostorMaterial(kind) {
    const m = new THREE.MeshStandardMaterial({ map: A.tree.texture, alphaTest: 0.38, roughness: 0.92, metalness: 0, side: THREE.FrontSide, alphaToCoverage: true });
    m.name = 'veg_' + kind;
    m.userData.gain = { value: new THREE.Vector3().setScalar(kind === 'far' ? 0.8 : 0.86) };
    m.onBeforeCompile = (sh) => {
      sharedUniforms(sh); sh.uniforms.uVBB = m.userData.gain;
      const far = kind === 'far';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
${GLSL_COMMON}${GLSL_ATLAS}
attribute vec4 aT; attribute vec4 aT2; ${far ? '' : 'attribute float aView;'}
varying vec2 vA0; varying vec2 vA1; varying float vBl; varying float vVF0; varying float vVF1;`)
        .replace('#include <beginnormal_vertex>', `
float vcy = cos(aT.w), vsy = sin(aT.w);
vec3 vToC = uVCam - aT.xyz; vec2 vDir = vToC.xz / max(length(vToC.xz), 1e-3);
${far ? `vec3 vRight = vec3(vDir.y, 0., -vDir.x);
  float vAz = atan(vDir.x, vDir.y) - aT.w; float vF = mod(vAz / .785398 + 16., 8.); float vI0 = floor(vF); vBl = vF - vI0;
  vA0 = vegCell(aT2.y, vI0, uv); vA1 = vegCell(aT2.y, mod(vI0 + 1., 8.), uv);
  vec3 objectNormal = normalize(vec3(vDir.x, 0., vDir.y) * .75 + vRight * (position.x * 1.1) + vec3(0., (position.y - .42) * .9 + .3, 0.));`
    : `vA0 = vegCell(aT2.y, aView, uv); vA1 = vA0; vBl = 0.;
  vec3 vCn = normalize(vec3(position.x * 2., (position.y - .45) * .6 + .35, position.z * 2.));
  vec3 objectNormal = vec3(vcy * vCn.x + vsy * vCn.z, vCn.y, -vsy * vCn.x + vcy * vCn.z);`}`)
        .replace('#include <begin_vertex>', `
${far ? 'vec3 transformed = aT.xyz + vRight * position.x * aT2.x + vec3(0., position.y * aT2.x, 0.);'
    : 'vec3 vLp = position * aT2.x; vec3 transformed = aT.xyz + vec3(vcy * vLp.x + vsy * vLp.z, vLp.y, -vsy * vLp.x + vcy * vLp.z);'}
float vK = clamp(position.y * aT2.x / 12., 0., 1.4); vK *= vK; transformed.xz += vegSway(aT.xz, vK, 1.1);
float vD = length(vToC.xz);
float vNR = uVFade.x * aT2.w; vVF0 = smoothstep(vNR - uVFade.y, vNR, vD);   // near → mid (per-species radius)
vVF1 = 1. - smoothstep(uVFade.z - uVFade.w, uVFade.z, vD);        // mid → far
${far ? 'if (vD < uVFade.z - uVFade.w - 1.) transformed = vec3(0., -1e5, 0.);' : 'if (vD < vNR - uVFade.y - 1. || vD > uVFade.z + 1.) transformed = vec3(0., -1e5, 0.);'}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uVBB; varying vec2 vA0; varying vec2 vA1; varying float vBl; varying float vVF0; varying float vVF1;
${GLSL_DITHER}`)
        .replace('#include <map_fragment>', `
vec4 vTc = texture2D(map, vA0); ${far ? 'vTc = mix(vTc, texture2D(map, vA1), vBl);' : ''}
vec2 vDx = dFdx(vA0 * vec2(${ATL.W}., ${ATL.H}.)), vDy = dFdy(vA0 * vec2(${ATL.W}., ${ATL.H}.));
float vMip = max(0., .5 * log2(max(dot(vDx, vDx), dot(vDy, vDy))));
vTc.a = clamp(vTc.a * (1. + vMip * .28), 0., 1.);
diffuseColor *= vec4(vTc.rgb * uVBB, vTc.a);
float vDi = vegDither();
${far ? 'if (vDi < vVF1) discard;' : 'if (vDi < 1. - vVF0 || vDi >= vVF1) discard;'}`);
      sh.fragmentShader = SAFE_END(sh.fragmentShader);
    };
    m.customProgramCacheKey = () => 'vegImp' + kind;
    return m;
  }
  function buildImpostors() {
    const gm = midGeometry(); impostorAttrs(gm);
    const gf = farGeometry(); impostorAttrs(gf);
    F.mid = new THREE.Mesh(gm, impostorMaterial('mid')); F.mid.name = 'veg_tree_mid';
    F.far = new THREE.Mesh(gf, impostorMaterial('far')); F.far.name = 'veg_tree_far';
    for (const m of [F.mid, F.far]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; scene.add(m); }
    VEG.stats.impostors = F.trees.length;
  }

  /* ================================================================== assets */
  const TEX = {};
  function loadTex(file, srgb, flipY, cb) {
    const L = VEG.TL || (VEG.TL = new THREE.TextureLoader(C.MANAGER));
    const t = L.load(C.ASSET + 'veg/' + file, (tt) => cb && cb(tt), undefined, () => console.warn('[veg] texture failed', file));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = flipY; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  function loadAssets() {
    TEX.needles = loadTex('foliage_atlas.png', true, false);
    TEX.pbark = loadTex('bark_pine_color.jpg', true, false); TEX.pbarkN = loadTex('bark_pine_normal.jpg', false, false);
    TEX.dbark = loadTex('bark_dead_color.jpg', true, false); TEX.dbarkN = loadTex('bark_dead_normal.jpg', false, false);
    TEX.sbark = loadTex('shrub_bark.jpg', true, false);
    // billboards → species blocks of the impostor atlas
    SP.forEach((sp, s) => { if (sp.src === 'game') return; loadTex(sp.name + '_billboard.png', true, true, (t) => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; A.queue.push(() => { const [x, y] = blockPx(s); blit(A.tree, t, x, y, 1024, 512); t.dispose(); sp.baked = true; }); }); });
    // tuft cards / shrub leaves / decals → 2x2 atlases (glTF uv: flipY false, cell k at ((k%2)*512, floor(k/2)*512))
    const TUFTS = ['veg_tuft_dry_tussock', 'veg_tuft_sedge', 'veg_tuft_seedgrass', 'veg_tuft_frosted'];
    const LEAVES = ['veg_shrub_dwarf_birch_leaf', 'veg_shrub_dwarf_willow_leaf', 'veg_shrub_crowberry_leaf'];
    const DECALS = ['veg_decal_lichen_pale', 'veg_decal_moss_olive', 'veg_decal_lichen_orange'];
    const into = (rt, list, flip) => list.forEach((n, k) => loadTex(n + '.png', true, flip, (t) => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; A.queue.push(() => { blit(rt, t, (k % 2) * 512, Math.floor(k / 2) * 512, 512, 512); t.dispose(); }); }));
    into(A.tuft, TUFTS, false); into(A.leaf, LEAVES, false); into(A.decal, DECALS, true);
    TEX.lichen = loadTex('veg_decal_lichen_orange.png', true, true);
    C.loadPacked('veg_set', C.ASSET, onVegSet);
    C.loadPacked('rock_namaqualand_boulder_02', C.ASSET, (g) => { R.flat = g; });
    C.loadPacked('rock_rock_face_02', C.ASSET, (g) => { R.face = g; });
  }
  const PACK = {};
  function onVegSet(g) {
    const root = g.scene; root.updateMatrixWorld(true);
    for (const node of root.children) {
      const parts = [];
      node.traverse((o) => { if (o.isMesh) { const geo = sanitize(o.geometry.clone()); geo.applyMatrix4(o.matrixWorld); parts.push({ geo, name: o.material.name, mat: o.material, extras: o.material.userData || {} }); } });
      PACK[node.name] = { node, parts };
    }
    buildNewSpecies();
    buildGroundAssets();
    VEG.ready.vegSet = true;
  }
  // some source meshes carry NaN vertex colours (6 verts in the needle set) → NaN pixels → bloom turns the frame black
  function sanitize(geo) {
    for (const k in geo.attributes) { const at = geo.attributes[k], a = at.array; let bad = 0; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { a[i] = k === 'color' ? 1 : 0; bad++; } if (bad) { at.needsUpdate = true; VEG.stats.nanFixed = (VEG.stats.nanFixed || 0) + bad; } }
    const N = geo.attributes.normal;   // zero-length normals → normalize(0) = NaN in the lighting
    if (N) { let z = 0; for (let i = 0; i < N.count; i++) { const x = N.getX(i), y = N.getY(i), w = N.getZ(i), l = Math.hypot(x, y, w); if (!(l > 1e-6)) { N.setXYZ(i, 0, 1, 0); z++; } else if (Math.abs(l - 1) > 1e-3) N.setXYZ(i, x / l, y / l, w / l); } if (z) { N.needsUpdate = true; VEG.stats.zeroNormals = (VEG.stats.zeroNormals || 0) + z; } }
    return geo;
  }
  function buildNewSpecies() {
    const needles = new THREE.MeshStandardMaterial({ name: 'needles', map: TEX.needles, alphaTest: 0.42, vertexColors: true, roughness: 0.88, metalness: 0 });
    const pbark = new THREE.MeshStandardMaterial({ name: 'bark', map: TEX.pbark, normalMap: TEX.pbarkN, roughness: 0.95, metalness: 0 }); pbark.color.setRGB(0.8, 0.78, 0.76);
    const dbark = new THREE.MeshStandardMaterial({ name: 'bark', map: TEX.dbark, normalMap: TEX.dbarkN, roughness: 0.95, metalness: 0 }); dbark.color.setRGB(0.85, 0.85, 0.85);
    const gN = [], gP = [], gD = [];
    for (let s = 3; s < NSP; s++) {
      const P = PACK[SP[s].name]; if (!P) { console.warn('[veg] missing', SP[s].name); continue; }
      for (const p of P.parts) {
        if (p.name === 'needles') { if (!p.geo.attributes.color) continue; gN.push({ sp: s, geo: p.geo }); }
        else (s === 9 ? gD : gP).push({ sp: s, geo: p.geo });
      }
      // trunk colliders: cylinder fitted to the bark base ring, one per tree (same Passport path as the pass-1 trees)
      const holder = new THREE.Group(); for (const p of P.parts) if (p.name === 'bark') { const m = new THREE.Mesh(p.geo, pbark); m.name = 'bark'; holder.add(m); }
      const mats = F.trees.filter((t) => t.v === s).map((t) => t.mReal);
      if (mats.length) try { Passport().registerInstances(holder, mats, 'trunk', { part: /bark/i, name: SP[s].name }); } catch (e) { console.warn('[veg] trunk colliders', SP[s].name, e); }
      const bb = new THREE.Box3(); for (const p of P.parts) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); } SP[s].H = bb.max.y;
    }
    // COLOR_0 layouts must match inside one batch
    const cs = gN.length && gN[0].geo.attributes.color.itemSize; for (const p of gN) if (p.geo.attributes.color.itemSize !== cs) { const a = p.geo.attributes.color, n = new Float32Array(a.count * cs); for (let i = 0; i < a.count; i++) for (let k = 0; k < cs; k++) n[i * cs + k] = k < a.itemSize ? a.getComponent(i, k) : 1; p.geo.setAttribute('color', new THREE.BufferAttribute(n, cs)); }
    makeGroup('needles', patchTreeNear(needles, true, false, NEW_MUL), gN, true, NEW_MUL);
    makeGroup('pbark', patchTreeNear(pbark, false, false, NEW_MUL), gP, false, NEW_MUL);
    makeGroup('dbark', patchTreeNear(dbark, false, false, NEW_MUL), gD, false, NEW_MUL);
    publishParts();
  }

  /* ================================================================== GROUND: tufts, shrubs, decals */
  const GR = { chunks: new Map(), CS: 16, want: new Set(), gen: [], rocks: [], rockGrid: new Map() };
  function setupGround() { GR.ready = false; }
  function groundMaterial(map, kind) {
    const m = new THREE.MeshStandardMaterial({ map, alphaTest: kind === 'decal' ? 0 : 0.42, roughness: 0.95, metalness: 0, side: kind === 'leaf' ? THREE.DoubleSide : THREE.FrontSide,
      alphaToCoverage: kind !== 'decal', transparent: kind === 'decal', depthWrite: kind !== 'decal', polygonOffset: kind === 'decal', polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    m.name = 'veg_' + kind;
    m.onBeforeCompile = (sh) => {
      sharedUniforms(sh); sh.uniforms.uVGrass = U.uVGrass;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nuniform vec4 uVGrass; varying float vVFade;' + (kind === 'decal' ? '\nattribute float aCell;' : ''))
        .replace('#include <uv_vertex>', '#include <uv_vertex>' + (kind === 'decal' ? '\n vMapUv = vec2(mod(aCell, 2.) * .5, floor(aCell / 2. + .01) * .5) + clamp(uv, .004, .996) * .5;' : ''))
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            mat4 vM = instanceMatrix;
          #else
            mat4 vM = mat4(1.);
          #endif
          vec3 vOrg = (modelMatrix * vM[3]).xyz; float vS2 = dot(vM[1].xyz, vM[1].xyz);
          float vD = length(vOrg.xz - uVCam.xz);
          ${kind === 'decal' ? 'vVFade = 1. - smoothstep(uVGrass.x * .8 - 8., uVGrass.x * .8, vD);' : `
          float vHn = clamp(position.y / ${kind === 'tuft' ? '.55' : '.7'}, 0., 1.5); float vK = vHn * vHn;
          vec3 vOff = vec3(0.); vOff.xz = vegSway(vOrg.xz * 3.1, vK, ${kind === 'tuft' ? '.35' : '.22'});
          vOff.xz += vec2(sin(uVT * 3.7 + dot(position.xz, vec2(9., 7.)) + vOrg.x), cos(uVT * 3.1 + dot(position.xz, vec2(7., 11.)) + vOrg.z)) * .025 * vK * (.4 + uVStorm);
          vec3 vW = (modelMatrix * vM * vec4(position, 1.)).xyz;
          for (int i = 0; i < 8; i++) { vec4 a = uVActors[i]; vec2 dd = vW.xz - a.xz; float dl = length(dd);
            if (a.w > 0. && dl < a.w && abs(vW.y - a.y) < 2.5) { float f = (1. - dl / a.w); f *= f; vOff.xz += dd / max(dl, .05) * f * a.w * .55 * vK; vOff.y -= f * .35 * vK * ${kind === 'tuft' ? '.5' : '.35'}; } }
          transformed += (transpose(mat3(vM)) * vOff) / max(vS2, 1e-4);
          vVFade = 1. - smoothstep(${kind === 'tuft' ? 'uVGrass.x - uVGrass.y, uVGrass.x' : 'uVGrass.z - uVGrass.w, uVGrass.z'}, vD);`}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVFade;\n' + GLSL_DITHER)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + (kind === 'decal' ? '' : ' if (vegDither() > vVFade) discard;'))
        .replace('#include <map_fragment>', `#include <map_fragment>
          ${kind === 'decal' ? 'diffuseColor.a *= vVFade;' : `{ vec2 dx = dFdx(vMapUv * 1024.), dy = dFdy(vMapUv * 1024.); float mp = max(0., .5 * log2(max(dot(dx, dx), dot(dy, dy)))); diffuseColor.a = clamp(diffuseColor.a * (1. + mp * .3), 0., 1.); }`}`);
      sh.fragmentShader = SAFE_END(sh.fragmentShader);
    };
    m.customProgramCacheKey = () => 'vegGround' + kind;
    return m;
  }
  // remap a glTF mesh's uv (0..1) into cell k of a 2x2 atlas (flipY=false convention: v=0 is the image top)
  function toCell(geo, k, scale) {
    const uv = geo.attributes.uv; if (!uv) return geo;
    const cx = (k % 2) * 0.5, cy = Math.floor(k / 2) * 0.5;
    for (let i = 0; i < uv.count; i++) { const u = clamp(uv.getX(i), 0.003, 0.997), v = clamp(uv.getY(i), 0.003, 0.997); uv.setXY(i, cx + u * 0.5, cy + v * 0.5); }
    uv.needsUpdate = true; return geo;
  }
  // far shrub LOD: every n-th leaf quad, grown about its centre (keeps the crown's coverage with 1/n of the cards)
  function lodQuads(g, n, grow) {
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, I = g.index.array, pos = [], nor = [], uv = [], idx = [];
    for (let q = 0; q * 6 < I.length; q += n) {
      const vs = [I[q * 6], I[q * 6 + 1], I[q * 6 + 2], I[q * 6 + 5]]; let cx = 0, cy = 0, cz = 0;
      for (const v of vs) { cx += P.getX(v) / 4; cy += P.getY(v) / 4; cz += P.getZ(v) / 4; }
      const b = pos.length / 3;
      for (const v of vs) { pos.push(cx + (P.getX(v) - cx) * grow, cy + (P.getY(v) - cy) * grow, cz + (P.getZ(v) - cz) * grow); nor.push(N.getX(v), N.getY(v), N.getZ(v)); uv.push(UV.getX(v), UV.getY(v)); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); o.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); o.setIndex(idx);
    return o;
  }
  function stripTo(geo, keep) { for (const k of Object.keys(geo.attributes)) if (!keep.includes(k)) geo.deleteAttribute(k); if (!geo.index) { const n = geo.attributes.position.count; geo.setIndex([...Array(n).keys()]); } return geo; }
  function buildGroundAssets() {
    const TUFTS = ['veg_tuft_dry_tussock', 'veg_tuft_sedge', 'veg_tuft_seedgrass', 'veg_tuft_frosted'], SHR = ['veg_shrub_dwarf_birch', 'veg_shrub_dwarf_willow', 'veg_shrub_crowberry'];
    GR.tuftGeo = TUFTS.map((n, k) => { const p = PACK[n].parts[0]; return toCell(stripTo(p.geo, ['position', 'normal', 'uv']), k); });
    GR.leafGeo = []; GR.twigGeo = []; GR.twigCol = [];
    SHR.forEach((n, k) => {
      for (const p of PACK[n].parts) {
        if (p.name === 'leaves') GR.leafGeo[k] = toCell(stripTo(p.geo, ['position', 'normal', 'uv']), k);
        else { const g = stripTo(p.geo, ['position', 'normal', 'uv']); const sc = (p.mat.userData && p.mat.userData.uvScale) || [1, 1]; const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sc[0], uv.getY(i) * sc[1]); GR.twigGeo[k] = g; GR.twigCol[k] = p.mat.color.clone(); }
      }
    });
    GR.leafLod = GR.leafGeo.map((g) => lodQuads(g, 3, 1.6));
    GR.shrubH = SHR.map((n) => { const b = new THREE.Box3(); for (const p of PACK[n].parts) { p.geo.computeBoundingBox(); b.union(p.geo.boundingBox); } return b.max.y; });
    // true instancing (one real draw per pool): ANGLE/Metal emulates BatchedMesh multi-draw as one draw per instance
    const pool = (name, geo, max, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, max); im.name = name; im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      scene.add(im); return im;
    };
    const mT = groundMaterial(A.tuft.texture, 'tuft'), mL = groundMaterial(A.leaf.texture, 'leaf'), mW = groundMaterial(TEX.sbark, 'twig'); mW.alphaTest = 0; mW.alphaToCoverage = false;
    GR.P = {
      tuft: GR.tuftGeo.map((g, k) => pool('veg_tufts', g, 5000, mT)),
      leafN: GR.leafGeo.map((g) => pool('veg_shrub_leaves', g, 600, mL)),
      leafL: GR.leafLod.map((g) => pool('veg_shrub_leaves', g, 1600, mL)),
      twig: GR.twigGeo.map((g) => pool('veg_shrub_twigs', g, 600, mW)),
    };
    const dq = new THREE.PlaneGeometry(1, 1); dq.rotateX(-Math.PI / 2);
    const dp = pool('veg_decals', dq, 3000, groundMaterial(A.decal.texture, 'decal')); dp.renderOrder = -1;
    dp.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(3000), 1).setUsage(THREE.DynamicDrawUsage));
    GR.P.decal = [dp];
    GR.ready = true;
  }

  // ---- placement fields ----
  const depthAt = (x, z) => { if (typeof C.snowDepthAt === 'function') { try { const d = C.snowDepthAt(x, z); return Number.isFinite(d) ? d : 0.1; } catch (e) { /* terrain not ready */ } } return 0.1; };
  function snowFree(x, z, ny) {
    const cv = convexity(x, z, 9), scoured = sstep(0.25, 1.4, cv);
    if (typeof C.snowDepthAt === 'function') {   // terrain module: loose snow depth (m) on top of the heightfield
      const d = depthAt(x, z), thin = 1 - sstep(0.03, 0.2, d), rocky = 1 - sstep(0.62, 0.8, ny);
      return clamp(Math.max(thin * 0.9, scoured * 0.85, rocky * 0.8), 0, 1);
    }
    const s = sstep(0.7, 0.86, ny + (C.vnoise(x * 0.09 + 3, z * 0.09) - 0.5) * 0.3);   // the old terrain shader's snow mask
    const patch = sstep(0.58, 0.7, C.fbm(x * 0.028 + 71, z * 0.028 - 13, 3));
    return clamp(Math.max(1 - s, scoured * 0.85, patch * 0.7), 0, 1);
  }
  function rockNear(x, z) {
    const G = 8; let best = 1e9;
    for (let i = Math.floor(x / G) - 1; i <= Math.floor(x / G) + 1; i++) for (let j = Math.floor(z / G) - 1; j <= Math.floor(z / G) + 1; j++) {
      const a = GR.rockGrid.get(i * 65536 + j); if (a) for (const r of a) { const d = Math.hypot(r.x - x, r.z - z) - r.r; if (d < best) best = d; }
    }
    return best;
  }
  function addRockToGrid(x, z, r) { const G = 8, k = Math.floor(x / G) * 65536 + Math.floor(z / G); let a = GR.rockGrid.get(k); if (!a) GR.rockGrid.set(k, (a = [])); a.push({ x, z, r }); GR.rocks.push({ x, z, r }); }
  const LAKE = () => C.POI.lake;
  function genChunk(ci, cj) {
    const CS = GR.CS, r = mulberry(ihash(ci, cj, 4711)), dens = C.Q.grass || 1;
    const out = { tuft: [], shrub: [], decal: [], pass: [] };
    const lk = LAKE(), sites = siteList();
    const bad = (x, z, h) => h < 0.35 || C.riftD(x, z) < 58 || C.nearPOI(x, z, -8) || sites.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 196);
    // tufts
    const nT = Math.round(46 * dens);
    for (let k = 0; k < nT; k++) {
      const x = (ci + r()) * CS, z = (cj + r()) * CS, h = C.getH(x, z); if (bad(x, z, h)) continue;
      const ny = C.normalY(x, z); if (ny < 0.6) continue;
      const dl = Math.hypot(x - lk.x, z - lk.z); if (dl < 50.5) continue;
      const shore = dl < 66 ? sstep(66, 52, dl) : 0, rk = rockNear(x, z), nearR = rk < 2.8 ? sstep(2.8, 0.3, rk) : 0;
      const bare = snowFree(x, z, ny), coast = h < 2.2 ? 0.35 : 0;
      const p = 0.025 + 0.8 * bare + 0.7 * nearR + 0.8 * shore + coast;
      if (r() > p * (0.55 + 0.9 * C.fbm(x * 0.05 - 3, z * 0.05 + 8, 2))) continue;
      const w = r(); let v;
      if (shore > 0.3) v = w < 0.6 ? 1 : w < 0.85 ? 0 : 2;
      else if (h > 34 || bare < 0.35) v = w < 0.45 ? 3 : w < 0.85 ? 0 : 2;
      else v = w < 0.52 ? 0 : w < 0.75 ? 1 : w < 0.9 ? 2 : 3;
      const s = 0.75 + r() * 0.75, sy = s * (0.8 + r() * 0.4), bright = 1.05 + r() * 0.3, frost = v === 3 || bare < 0.35 ? 0.08 : 0;
      out.tuft.push([v, x, h + Math.max(0, depthAt(x, z) - 0.1) - 0.03, z, r() * TAU, s, sy, [bright * 0.94 + frost, bright * 0.96 + frost, bright + frost * 1.2]]);
      out.pass.push([x, z, 0.22 * s, 0.5 * sy, 0]);
    }
    // shrub clusters: birch + crowberry on bare ground, willow near water
    const nS = r() < 0.9 * dens ? 1 + (r() < 0.45 ? 1 : 0) : 0;
    for (let k = 0; k < nS; k++) {
      const x0 = (ci + r()) * CS, z0 = (cj + r()) * CS, h0 = C.getH(x0, z0); if (bad(x0, z0, h0) || h0 > 44) continue;
      const ny0 = C.normalY(x0, z0); if (ny0 < 0.7) continue;
      const dl = Math.hypot(x0 - lk.x, z0 - lk.z); if (dl < 52) continue;
      const wet = dl < 78 || h0 < 3, bare = snowFree(x0, z0, ny0), rk = rockNear(x0, z0);
      if (r() > 0.08 + bare * 0.9 + (wet ? 0.5 : 0) + (rk < 3 ? 0.4 : 0)) continue;
      const m = 3 + (r() * 6 | 0);
      for (let c = 0; c < m; c++) {
        const a = r() * TAU, d = Math.sqrt(r()) * 2.8, x = x0 + Math.cos(a) * d, z = z0 + Math.sin(a) * d, h = C.getH(x, z);
        if (C.normalY(x, z) < 0.65 || rockNear(x, z) < 0.2) continue;
        const sp = wet && r() < 0.6 ? 1 : r() < 0.55 ? 0 : 2, s = (sp === 0 ? 0.9 : 0.8) + r() * (sp === 0 ? 0.9 : 0.8);
        const tint = sp === 0 ? [0.72 + r() * 0.12, 0.66 + r() * 0.08, 0.64 + r() * 0.08] : [0.9 + r() * 0.2, 0.92 + r() * 0.18, 0.9 + r() * 0.15];
        out.shrub.push([sp, x, h + Math.max(0, depthAt(x, z) - 0.12) - 0.04, z, r() * TAU, s, tint]);
        out.pass.push([x, z, 0.4 * s * (sp === 1 ? 1.1 : 0.8), GR.shrubH[sp] * s, 1]);
      }
    }
    // lichen / moss decals on bare ground and at rock feet
    const nD = Math.round(7 * dens);
    for (let k = 0; k < nD; k++) {
      const x = (ci + r()) * CS, z = (cj + r()) * CS, h = C.getH(x, z); if (bad(x, z, h)) continue;
      const ny = C.normalY(x, z); if (ny < 0.72) continue;
      const rk = rockNear(x, z), bare = snowFree(x, z, ny), dd = depthAt(x, z); if (dd > 0.07 || r() > bare * 0.8 + (rk < 1.5 ? 0.7 : 0)) continue;
      const cell = rk < 1.2 && r() < 0.5 ? 2 : r() < 0.6 ? 0 : 1, s = 0.7 + r() * 1.9;
      out.decal.push([cell, x, h + dd + 0.02, z, r() * TAU, s]);
    }
    return out;
  }
  let _sites = null;
  function siteList() {
    if (_sites) return _sites;
    const s = [], st = window.WorldFill && window.WorldFill.stats;
    if (st) { for (const q of [st.camp, st.ship, st.pier].concat(st.ruins || [])) if (q && isFinite(q.x)) s.push(q); }
    return (_sites = s);
  }
  function bakeChunk(ch) {   // per-chunk instance arrays, built once
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3(), up = new V3(0, 1, 0), n = new V3(), qy = new THREE.Quaternion();
    const B = ch.b = { tuft: [[], [], [], []], shrub: [[], [], []], decal: [] };
    for (const [v, x, y, z, ry, sc, sy, c] of ch.data.tuft) { e.set(0, ry, 0); q.setFromEuler(e); m.compose(p.set(x, y, z), q, s.set(sc, sy, sc)); B.tuft[v].push(m.elements.slice(), c); }
    for (const [v, x, y, z, ry, sc, c] of ch.data.shrub) { e.set((C.hash2(x, z) - 0.5) * 0.15, ry, (C.hash2(z, x) - 0.5) * 0.15); q.setFromEuler(e); m.compose(p.set(x, y, z), q, s.set(sc, sc, sc)); B.shrub[v].push(m.elements.slice(), c); }
    for (const [v, x, y, z, ry, sc] of ch.data.decal) {
      const e1 = 0.9, nx = C.getH(x - e1, z) - C.getH(x + e1, z), nz = C.getH(x, z - e1) - C.getH(x, z + e1); n.set(nx, 2 * e1, nz).normalize();
      q.setFromUnitVectors(up, n); qy.setFromAxisAngle(up, ry); q.multiply(qy); m.compose(p.set(x, y, z), q, s.set(sc, 1, sc)); B.decal.push(m.elements.slice(), v);
    }
  }
  function activate(ch) { if (!ch.b) bakeChunk(ch); ch.on = true; GR.dirty = true; }
  function deactivate(ch) { if (!ch.on) return; ch.on = false; GR.dirty = true; }
  // refill the pools from the active chunks (only when the set of chunks / their LOD changed)
  function rebuildPools() {
    GR.dirty = false; const P = GR.P, fill = new Map();
    const put = (im, mat, col, cell) => {
      let n = fill.get(im) || 0; if (n >= im.instanceMatrix.count) { VEG.stats.poolFull = (VEG.stats.poolFull || 0) + 1; return; }
      im.instanceMatrix.array.set(mat, n * 16); if (col) im.instanceColor.array.set(col, n * 3); if (cell !== undefined) im.geometry.attributes.aCell.array[n] = cell; fill.set(im, n + 1);
    };
    for (const ch of GR.chunks.values()) {
      if (!ch.on) continue; const B = ch.b;
      for (let v = 0; v < 4; v++) { const a = B.tuft[v]; for (let k = 0; k < a.length; k += 2) put(P.tuft[v], a[k], a[k + 1]); }
      for (let v = 0; v < 3; v++) { const a = B.shrub[v]; for (let k = 0; k < a.length; k += 2) { put((ch.near ? P.leafN : P.leafL)[v], a[k], a[k + 1]); if (ch.near) put(P.twig[v], a[k], [GR.twigCol[v].r, GR.twigCol[v].g, GR.twigCol[v].b]); } }
      for (let k = 0; k < B.decal.length; k += 2) put(P.decal[0], B.decal[k], [1, 1, 1], B.decal[k + 1]);
    }
    let total = 0;
    for (const list of Object.values(P)) for (const im of list) {
      const n = fill.get(im) || 0; im.count = n; total += n; im.visible = n > 0;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, n * 3); im.instanceColor.needsUpdate = true;
      if (im.geometry.attributes.aCell) { const c = im.geometry.attributes.aCell; c.clearUpdateRanges(); c.addUpdateRange(0, n); c.needsUpdate = true; }
    }
    VEG.stats.groundInstances = total;
  }
  let gLastKey = null;
  const chunkNear = (ch, cam) => Math.hypot((ch.i + 0.5) * GR.CS - cam.x, (ch.j + 0.5) * GR.CS - cam.z) < 20;
  function updateGround() {
    if (!GR.ready || (!R.done && tAcc - (GR.readyT || (GR.readyT = tAcc)) < 20)) return;
    const cam = camera.position, CS = GR.CS, Rg = Math.max(C.Q.vegShrubR || 95, C.Q.vegGrassR || 64) + 6;
    U.uVGrass.value.set(C.Q.vegGrassR || 64, 10, C.Q.vegShrubR || 95, 14);
    const ci = Math.floor(cam.x / CS), cj = Math.floor(cam.z / CS), key = ci * 65536 + cj, rc = Math.ceil(Rg / CS);
    if (key !== gLastKey) {
      gLastKey = key; GR.want.clear(); const list = [];
      for (let i = ci - rc; i <= ci + rc; i++) for (let j = cj - rc; j <= cj + rc; j++) {
        const d = Math.hypot((i + 0.5) * CS - cam.x, (j + 0.5) * CS - cam.z); if (d < Rg + CS * 0.72) { GR.want.add(i * 65536 + j); list.push([d, i, j]); }
      }
      list.sort((a, b) => a[0] - b[0]); GR.gen = list;
      for (const [k, ch] of GR.chunks) if (!GR.want.has(k)) { deactivate(ch); if (GR.chunks.size > 900) GR.chunks.delete(k); }
    }
    // generate/activate nearest first; a teleport fills the inner ring synchronously
    const t0 = performance.now(), tmax = GR.first ? 2.5 : 400; GR.first = true;   // ms per frame for new chunks
    while (GR.gen.length && performance.now() - t0 < tmax) {
      const [, i, j] = GR.gen.shift(), k = i * 65536 + j; if (!GR.want.has(k)) continue;
      let ch = GR.chunks.get(k); if (!ch) { const g0 = performance.now(); ch = { i, j, data: genChunk(i, j), on: false }; GR.chunks.set(k, ch); const gm = performance.now() - g0; VEG.stats.genMsMax = Math.max(VEG.stats.genMsMax || 0, +gm.toFixed(2)); VEG.stats.genN = (VEG.stats.genN || 0) + 1; VEG.stats.genMsSum = +((VEG.stats.genMsSum || 0) + gm).toFixed(1); }
      if (!ch.on) { ch.near = chunkNear(ch, cam); activate(ch); }
    }
    // shrub detail: full crowns + twigs only in chunks near the camera
    if (GR.lodKey !== key) {
      GR.lodKey = key;
      for (const ch of GR.chunks.values()) {
        if (!ch.on) continue; const nr = chunkNear(ch, cam); if (nr === ch.near) continue; ch.near = nr;
        if (ch.data.shrub.length) GR.dirty = true;
      }
    }
    if (GR.dirty && tAcc - (GR.lastBuild || -9) > 0.12) { GR.lastBuild = tAcc; rebuildPools(); }
    // actors that bend grass: player, fox, stags, shardlings (nearest 8)
    const act = U.uVActors.value, P = C.player; let n = 0;
    const put = (x, y, z, r) => { if (n < 8 && (x - cam.x) ** 2 + (z - cam.z) ** 2 < 90 * 90) act[n++].set(x, y, z, r); };
    if (P) put(P.x, P.y, P.z, 1.1);
    if (C.fox && C.fox.g && C.fox.g.visible !== false) put(C.fox.x, C.fox.y || C.getH(C.fox.x, C.fox.z), C.fox.z, 0.7);
    for (const s of C.STAGS || []) put(s.x, C.getH(s.x, s.z), s.z, 1.3);
    for (const e of C.enemies || []) if (e.hp > 0) put(e.x, (e.y || 0) - 1.3, e.z, 1.2);
    for (; n < 8; n++) act[n].set(0, -1e4, 0, 0);
    VEG.stats.chunks = [...GR.chunks.values()].filter((c) => c.on).length;
  }
  // Passport provider: tufts and shrubs near (x, z) → [{x, z, r, h, kind}]
  function passablesNear(x, z, r, out = []) {
    const CS = GR.CS;
    for (let i = Math.floor((x - r - 2) / CS); i <= Math.floor((x + r + 2) / CS); i++) for (let j = Math.floor((z - r - 2) / CS); j <= Math.floor((z + r + 2) / CS); j++) {
      const ch = GR.chunks.get(i * 65536 + j); if (!ch) continue;
      for (const p of ch.data.pass) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < (r + p[2]) ** 2) out.push({ x: p[0], z: p[1], r: p[2], h: p[3], kind: p[4] ? 'shrub' : 'grass', src: 'veg' });
    }
    return out;
  }

  /* ================================================================== ROCKS */
  const R = { done: false };
  function rockMaterialPatch(mat, o) {
    // cool grading toward the dark basalt terrain + snow on up-facing surfaces + orange lichen on the flanks
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.tVLichen = { value: TEX.lichen }; sh.uniforms.tVSnow = { value: C.TX.snow }; sh.uniforms.tVSnowN = { value: C.TX.snowN };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vVWp; varying vec3 vVWn;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          vec4 vwp = vec4(transformed, 1.); vec3 vwn = objectNormal;
          #ifdef USE_INSTANCING
            vwp = instanceMatrix * vwp; vwn = mat3(instanceMatrix) * vwn;
          #endif
          vVWp = (modelMatrix * vwp).xyz; vVWn = normalize(mat3(modelMatrix) * vwn);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D tVLichen, tVSnow, tVSnowN; varying vec3 vVWp; varying vec3 vVWn;
        float vrH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vrN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(vrH(i), vrH(i + vec2(1, 0)), f.x), mix(vrH(i + vec2(0, 1)), vrH(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wn = vVWn / max(length(vVWn), 1e-5);
          float lum = dot(diffuseColor.rgb, vec3(.3, .55, .15));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), ${o.desat.toFixed(2)}) * vec3(${o.grade.map((v) => v.toFixed(3)).join(', ')});
          float nz = vrN(vVWp.xz * .9) * .6 + vrN(vVWp.xz * 3.1) * .4;
          vec4 lc = texture2D(tVLichen, vVWp.xz * .45 + vVWp.y * .13);
          float lm = lc.a * smoothstep(.05, .35, wn.y) * (1. - smoothstep(.62, .8, wn.y)) * smoothstep(.5, .7, nz) * ${o.lichen.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, lc.rgb * .8, lm);
          float sm = smoothstep(.52, .8, wn.y + (nz - .5) * .45) * ${o.snow.toFixed(2)};
          vec3 sc = texture2D(tVSnow, vVWp.xz * .35).rgb * vec3(.86, .92, 1.02) * .95;
          diffuseColor.rgb = mix(diffuseColor.rgb, sc, sm);
          vVSnowM = sm;
        }`)
        .replace('void main() {', 'float vVSnowM = 0.;\nvoid main() {')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, .8, vVSnowM);');
      sh.fragmentShader = SAFE_END(sh.fragmentShader);
    };
    const pk = mat.customProgramCacheKey;
    mat.customProgramCacheKey = function () { return (pk ? pk.call(this) : '') + '|vegRock' + JSON.stringify(o); };
    mat.needsUpdate = true;
  }
  const SNOWC = () => typeof C.snowCover === 'function';   // terrain module: snow shading + drifts around every Passport solid
  const GROUND = (x, z) => C.getH(x, z) + Math.min(depthAt(x, z), 0.35) * 0.8;   // rendered snow surface (approx.)
  const LOWEST = (x, z, rad) => { let m = C.getH(x, z); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; m = Math.min(m, C.getH(x + Math.cos(a) * rad, z + Math.sin(a) * rad)); } return m; };
  function rocksStep() {
    const D = C.DECOR;
    if (R.done || !D.boulderMeshes || !D.boulders || !R.flat || !R.face || !GR.ready) return;
    R.done = true;
    const P = Passport(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3();
    const skirts = [];
    // --- boulders (rock_boulder_01, 1.8 x 1.0 x ~1.2 m model): re-seat against the lowest ground under the footprint ---
    const bgeo = sanitize(D.boulderMeshes[0].geometry); bgeo.computeBoundingBox(); const bb = bgeo.boundingBox;
    const r0 = mulberry(777);
    D.boulders.forEach((M, i) => {
      M.decompose(p, q, s); const x = p.x, z = p.z, sc = s.x; e.setFromQuaternion(q, 'YXZ');
      const yaw = e.y, sy = sc * (0.75 + r0() * 0.45), sx = sc * (0.9 + r0() * 0.25), sz = sc * (0.9 + r0() * 0.25);
      const foot = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * Math.max(sx, sz) * 0.8;
      const bury = 0.2 + r0() * 0.15, hgt = (bb.max.y - bb.min.y) * sy;
      const y = Math.min(GROUND(x, z) - bury * hgt, LOWEST(x, z, foot * 0.6) - 0.06 * hgt) - bb.min.y * sy;
      e.set((r0() - 0.5) * 0.3, yaw, (r0() - 0.5) * 0.3, 'YXZ'); q.setFromEuler(e);
      M.compose(p.set(x, y, z), q, s.set(sx, sy, sz));
      skirts.push([x, z, foot * 1.05, hgt]); addRockToGrid(x, z, foot);
    });
    for (const im of D.boulderMeshes) { D.boulders.forEach((M, i) => im.setMatrixAt(i, M)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere(); rockMaterialPatch(im.material, { desat: 0.55, grade: [0.62, 0.68, 0.8], lichen: 0.55, snow: SNOWC() ? 0 : 1 }); }
    for (const en of D.boulderEntries || []) P.remove(en);
    const holder = new THREE.Group(); holder.add(new THREE.Mesh(bgeo, D.boulderMeshes[0].material));
    D.boulderEntries = P.registerInstances(holder, D.boulders, 'solid', { name: 'boulder' });
    // --- procedural basalt rocks (game DECOR.rockMesh): re-seat on slopes ---
    const RM = D.rockMesh;
    if (RM && RM.count) {
      for (const en of P.list.filter((en) => /^rock#/.test(en.name))) P.remove(en);
      const M = new THREE.Matrix4();
      for (let i = 0; i < RM.count; i++) {
        RM.getMatrixAt(i, M); M.decompose(p, q, s);
        const foot = 1.0 * s.x, y = LOWEST(p.x, p.z, foot * 0.8) + 0.05 * s.y;
        M.compose(p.set(p.x, Math.min(p.y, y), p.z), q, s); RM.setMatrixAt(i, M);
        skirts.push([p.x, p.z, foot * 0.95, s.y * 0.7]); addRockToGrid(p.x, p.z, foot);
      }
      RM.instanceMatrix.needsUpdate = true; RM.computeBoundingSphere && RM.computeBoundingSphere();
      P.register(RM, 'solid', { shape: 'hull', name: 'rock' });
    }
    // --- new rocks: flat namaqualand boulders + rock-face outcrops on slopes ---
    const addModel = (g, name, list, patch) => {
      const root = C.prepModel(g.scene, 0), parts = C.bakeParts(root), meshes = [];
      for (const { geo, mat } of parts) { sanitize(geo); mat.side = THREE.FrontSide; rockMaterialPatch(mat, Object.assign({}, patch, { snow: SNOWC() ? 0 : 1 })); if (SNOWC()) try { C.snowCover(mat, { amount: 0.8, minUp: 0.6, soft: 0.22, skirt: 0.35 }); } catch (e) { /* own snow off: none */ } const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((M, i) => im.setMatrixAt(i, M)); im.castShadow = true; im.receiveShadow = true; im.name = name; scene.add(im); meshes.push(im); }
      const entries = P.registerInstances(root, list, 'solid', { name });
      return { meshes, entries };
    };
    const rr = mulberry(4242 + 17);
    { // flat boulders: scattered + next to big boulders
      const g = R.flat, root = g.scene; root.updateMatrixWorld(true); const b3 = new THREE.Box3().setFromObject(root), list = [];
      const tryAt = (x, z) => {
        const h = C.getH(x, z); if (h < 0.8 || C.nearPOI(x, z, 4) || C.inRift(x, z, -30) || C.normalY(x, z) < 0.6 || rockNear(x, z) < 0.5 || treesNear(x, z, 3).length) return;
        const sc = 0.7 + rr() * 1.3, sy = sc * (0.7 + rr() * 0.5), foot = Math.max(b3.max.x - b3.min.x, b3.max.z - b3.min.z) * 0.5 * sc * 0.8;
        const hg = (b3.max.y - b3.min.y) * sy, y = Math.min(GROUND(x, z) - (0.2 + rr() * 0.15) * hg, LOWEST(x, z, foot * 0.6) - 0.06 * hg) - b3.min.y * sy;
        e.set((rr() - 0.5) * 0.2, rr() * TAU, (rr() - 0.5) * 0.2, 'YXZ'); q.setFromEuler(e);
        list.push(new THREE.Matrix4().compose(p.set(x, y, z), q, s.set(sc, sy, sc * (0.85 + rr() * 0.3))));
        skirts.push([x, z, foot * 1.05, (b3.max.y - b3.min.y) * sy]); addRockToGrid(x, z, foot);
      };
      for (const M of D.boulders.slice(0, 40)) { M.decompose(p, q, s); const a = rr() * TAU, d = 2.2 * s.x + 1 + rr() * 2; tryAt(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d); }
      for (let k = 0; k < 2000 && list.length < 70; k++) tryAt((rr() - 0.5) * 760, (rr() - 0.5) * 760);
      R.flatMesh = addModel(g, 'rock_flat', list, { desat: 0.75, grade: [0.55, 0.6, 0.72], lichen: 0.8, snow: 1 });
      D.rocksFlat = list;
    }
    { // outcrops: rock face (open back −Z) pushed into slopes, face looking downhill
      const g = R.face, root = g.scene; root.updateMatrixWorld(true); const b3 = new THREE.Box3().setFromObject(root), list = [];
      for (let k = 0; k < 4000 && list.length < 34; k++) {
        const x = (rr() - 0.5) * 760, z = (rr() - 0.5) * 760, h = C.getH(x, z), ny = C.normalY(x, z);
        if (h < 3 || ny > 0.86 || ny < 0.5 || C.nearPOI(x, z, 8) || C.inRift(x, z, -20) || rockNear(x, z) < 3 || treesNear(x, z, 5).length) continue;
        const ex = C.getH(x + 1, z) - C.getH(x - 1, z), ez = C.getH(x, z + 1) - C.getH(x, z - 1), downhill = Math.atan2(-ex, -ez);
        const sc = 0.9 + rr() * 1.1, sy = sc * (0.8 + rr() * 0.4), depth = (b3.max.z - b3.min.z) * sc;
        const bx = x - Math.sin(downhill) * depth * 0.35, bz = z - Math.cos(downhill) * depth * 0.35;
        const y = LOWEST(x, z, depth * 0.5) - b3.min.y * sy - 0.25 * (b3.max.y - b3.min.y) * sy;
        e.set(-0.12 - rr() * 0.12, downhill + (rr() - 0.5) * 0.4, 0, 'YXZ'); q.setFromEuler(e);
        list.push(new THREE.Matrix4().compose(p.set(bx, y, bz), q, s.set(sc, sy, sc)));
        const w = (b3.max.x - b3.min.x) * sc * 0.5;
        skirts.push([x, z, w, (b3.max.y - b3.min.y) * sy * 0.6]); addRockToGrid(bx, bz, w);
      }
      R.faceMesh = addModel(g, 'rock_outcrop', list, { desat: 0.7, grade: [0.55, 0.6, 0.72], lichen: 0.6, snow: 1 });
      D.rocksOutcrop = list;
    }
    if (!SNOWC()) buildSkirts(skirts);   // with the terrain module the drifts come from its obstacle stamps + snowCover skirt
    VEG.stats.rocks = { boulders: D.boulders.length, procedural: RM ? RM.count : 0, flat: D.rocksFlat.length, outcrops: D.rocksOutcrop.length, skirts: skirts.length };
    // ground chunks generated before the rock list existed must be re-rolled (rock proximity feeds placement)
    for (const [k, ch] of GR.chunks) { deactivate(ch); GR.chunks.delete(k); } gLastKey = null;
  }
  // snow drift ring around every rock base, conformed to the terrain; one merged mesh, terrain snow shader, passable
  function buildSkirts(list) {
    const pos = [], idx = [], rk = [], col = [], SEG = 20, RINGS = [0.55, 0.85, 1.12, 1.4];
    for (const [x, z, rad, hgt] of list) {
      const base = pos.length / 3, lift = Math.min(0.45, 0.18 + hgt * 0.12), ph = C.hash2(x, z) * TAU;
      for (let ri = 0; ri < RINGS.length; ri++) for (let k = 0; k < SEG; k++) {
        const a = k / SEG * TAU, wob = 1 + 0.18 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 5 - ph), rr = rad * RINGS[ri] * wob;
        const lee = 0.75 + 0.5 * Math.max(0, Math.cos(a) * WIND[0] + Math.sin(a) * WIND[1]);   // drift piles up downwind
        const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, gy = C.getH(px, pz);
        const hh = ri === 0 ? lift * lee : ri === 1 ? lift * 0.75 * lee : ri === 2 ? lift * 0.3 * lee : -0.04;
        pos.push(px, gy + hh, pz); rk.push(0); col.push(1, 1, 1);
      }
      for (let ri = 0; ri < RINGS.length - 1; ri++) for (let k = 0; k < SEG; k++) {
        const a = base + ri * SEG + k, b = base + ri * SEG + (k + 1) % SEG, c2 = a + SEG, d = b + SEG;
        idx.push(a, c2, b, b, c2, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aRock', new THREE.Float32BufferAttribute(rk, 1)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    C.patchSurface(m, { snowS: 0.16, rockS: 0.055, lo: 0.3, hi: 0.55, glitter: 1 });
    const mesh = new THREE.Mesh(g, m); mesh.name = 'veg_rock_skirts'; mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noCollide = true;
    scene.add(mesh); R.skirts = mesh;
  }

  /* ================================================================== shake: branch wobble + snow puff */
  let shakeSlot = 0;
  function shakeTree(x, z, strength = 1, dx, dz) {
    const cand = treesNear(x, z, 3.2); if (!cand.length) return false;
    let t = cand[0], bd = 1e9; for (const c of cand) { const d = (c[0] - x) ** 2 + (c[2] - z) ** 2; if (d < bd) { bd = d; t = c; } }
    const now = U.uVT.value; if (now - t.shakeT < 0.9) return false; t.shakeT = now;
    const a = clamp(strength, 0.1, 2);
    let ux = dx, uz = dz; if (!(Math.hypot(ux || 0, uz || 0) > 1e-3)) { const h = C.hash2(t[0], t[2]) * TAU; ux = Math.cos(h); uz = Math.sin(h); } const ul = Math.hypot(ux, uz);
    U.uVShake.value[shakeSlot].set(t[0], t[2], 0.35 * a, now); U.uVShakeD.value[shakeSlot].set(ux / ul, uz / ul, 0, 0); shakeSlot = (shakeSlot + 1) % 6;
    const sp = SP[t.v], H = (sp.H || 8) * t.s, n = Math.round(clamp(a * sp.snow * 110, 0, 220));
    if (C.emit) for (let k = 0; k < n; k++) {
      const hh = H * (0.25 + Math.random() * 0.7), rad = (sp.S || 6) * t.s * 0.32 * (1 - hh / H * 0.7) * Math.sqrt(Math.random()), an = Math.random() * TAU;
      const px = t[0] + Math.cos(an) * rad, pz = t[2] + Math.sin(an) * rad;
      const fine = Math.random() < 0.7;   // mostly fine powder, a few clumps
      C.emit(px, t.y + hh, pz, Math.cos(an) * 0.5 + WIND[0] * 0.5 + (dx || 0) * 0.6, -0.2 - Math.random() * (fine ? 0.4 : 1.2), Math.sin(an) * 0.5 + WIND[1] * 0.5 + (dz || 0) * 0.6,
        (fine ? 1.8 : 1.1) + Math.random() * 1.2, fine ? 0xb8c6dc : 0xd6e0f0, fine ? 0.12 + Math.random() * 0.16 : 0.24 + Math.random() * 0.2, fine ? 2.6 : 1.2, fine ? 0.9 : 3.2);
    }
    if (VEG.onShake) try { VEG.onShake(t, a); } catch (e) { /* listener */ }
    return true;
  }
  // bumping into a trunk (player on foot or riding) shakes the tree
  let bumpCd = 0;
  function autoBump(dt) {
    bumpCd -= dt; const P = C.player; if (!P || bumpCd > 0 || C.mode !== 'play' || C.interaction || window.INTERACTION) return;   // interaction module does the brushing
    const sp = Math.hypot(P.vx || 0, P.vz || 0); if (sp < 1.5) return;
    for (const t of treesNear(P.x, P.z, 1.9)) {
      const d = Math.hypot(t[0] - P.x, t[2] - P.z), tr = 0.35 * t.s + 0.55;
      if (d < tr + 0.35 && Math.abs(P.y - t.y) < 3) { if (shakeTree(t[0], t[2], clamp(sp / 7, 0.3, 1.5))) bumpCd = 0.4; break; }
    }
  }

  /* ================================================================== DRAW-CALL DIRECTOR
   * Scene-wide, 4 Hz, reversible (docs: VEGETATION.md §4):
   *  a) shadow LOD — a caster stops casting beyond 30 m + 18 × its bounding radius (a stag ≈ 57 m, a crate ≈ 38 m,
   *     a hut ≈ 120 m); every shadow caster costs 2 draw calls (2 cascades).
   *  b) skinned meshes (stags, hermit, fox …) that were exempt from frustum culling get a padded bounding sphere
   *     (pose sphere × 1.5 + 0.8 m) and are culled again when off-screen (main pass and shadow cascades).
   * Opt out per object with userData.vegKeep = true. The player's model is never touched. If another system changes
   * castShadow itself, that value becomes the new baseline. */
  const DIR = { t: 0, st: new WeakMap(), on: true, stats: {} };
  function directorInit(o, s) {
    let r = 0.5;
    try {
      if (o.isSkinnedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); r = o.boundingSphere.radius; }
      else if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); r = o.boundingSphere.radius; }
      else if (o.geometry) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); r = o.geometry.boundingSphere.radius; }
    } catch (e) { r = 1e4; }
    s.r = isFinite(r) ? r : 1e4; s.cs0 = o.castShadow; s.csSet = o.castShadow;
  }
  function director(dt) {
    DIR.t -= dt; if (DIR.t > 0 || !DIR.on) return; DIR.t = 0.25;
    const cam = camera.position, v = DIR.v || (DIR.v = new V3()), ms = DIR.ms || (DIR.ms = new V3()), pg = C.player && C.player.c && C.player.c.g;
    let off = 0, culled = 0, n = 0, hid = 0;
    const walk = (o) => {
      if (o === pg || o.userData.vegKeep || (o.name && o.name.startsWith('veg_'))) return;   // player subtree, our own meshes
      if (!o.visible) return;
      if (o.isMesh && !o.isBatchedMesh) {
        let s = DIR.st.get(o); if (!s) { s = {}; directorInit(o, s); DIR.st.set(o, s); }
        if (o.castShadow !== s.csSet) s.cs0 = o.castShadow;   // changed by its owner: new baseline
        if (o.isSkinnedMesh && !o.frustumCulled && !s.fc) { s.fc = true; try { o.computeBoundingSphere(); o.boundingSphere.radius = o.boundingSphere.radius * 1.5 + 0.8; o.frustumCulled = true; s.r = o.boundingSphere.radius; culled++; } catch (e) { /* keep as is */ } }
        if (s.cs0 && (!o.isInstancedMesh || o.frustumCulled)) {
          const sp = o.isSkinnedMesh || o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere;
          v.copy(sp ? sp.center : v.set(0, 0, 0)).applyMatrix4(o.matrixWorld);
          ms.setFromMatrixScale(o.matrixWorld); const r = s.r * Math.max(ms.x, ms.y, ms.z);
          const want = v.distanceTo(cam) - r < 30 + 18 * r;
          o.castShadow = want; s.csSet = want; if (!want) off++;
        }
        // c) tiny + far: below ~5 px on screen (emissive: ~2 px) the object leaves the main pass (layer 0 off)
        if (!o.isInstancedMesh && !o.isSkinnedMesh && o.frustumCulled && o.geometry && o.geometry.boundingSphere) {
          const m = o.material, emi = m && m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity || 1) > 0.3;
          if (m && !m.transparent) {
            v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld); ms.setFromMatrixScale(o.matrixWorld);
            const r = s.r * Math.max(ms.x, ms.y, ms.z), d = v.distanceTo(cam), tiny = r < 2.5 && r / Math.max(d, 1) < (emi ? 0.002 : 0.0036);
            if (s.maskSet !== undefined && o.layers.mask !== s.maskSet) { s.mask0 = o.layers.mask; }   // owner changed layers
            if (s.mask0 === undefined) s.mask0 = o.layers.mask;
            const want = tiny ? (s.mask0 & ~1) : s.mask0;
            if (o.layers.mask !== want) o.layers.mask = want; s.maskSet = want; if (tiny) hid++;
          }
        }
        n++;
      }
      for (const c of o.children) walk(c);
    };
    walk(scene);
    DIR.stats = { meshes: n, shadowOff: off, cullOn: culled, tinyHidden: hid }; VEG.stats.director = DIR.stats;
  }
  VEG.director = DIR;

  /* ================================================================== update */
  let tAcc = 0, bakedGame = [false, false, false];
  function update(dt, ctx) {
    tAcc += dt;
    U.uVT.value = tAcc; U.uVStorm.value = (C.WX && C.WX.storm) || 0; U.uVCam.value.copy(camera.position);
    while (A.queue.length) A.queue.shift()();
    adoptGameTrees();
    for (let vi = 0; vi < 3; vi++) if (!bakedGame[vi] && SP[vi].bake) { bakedGame[vi] = true; bakeSpecies(vi); refreshImpostorSizes(); }
    if (!F.mid && VEG.ready.vegSet) buildImpostors();
    updateForest();
    rocksStep();
    updateGround();
    autoBump(dt);
    director(dt);
  }

  if (/[?&]noveg\b/.test(location.search)) return;   // A/B switch for the bench: open-world.html?noveg
  (window.GameModules = window.GameModules || []).push({ name: 'vegetation', order: -10, init, update });
})();
