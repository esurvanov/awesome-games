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
    // vegCardLod (NATURE): beyond this distance (m) a near tree draws its thinned needle mesh (cardLod)
    // treeNearDensity: share of trees drawn as real models inside the near radius (the rest switch to the impostor at
    // 0.45 × the radius) · texBias: mip bias of tree/ground-plant maps · aniso: anisotropic filtering of their maps
    low: { vegTreeMid: 210, vegGrassR: 36, vegShrubR: 45, vegDecalR: 28, vegCardLod: 18, treeNearDensity: 0.8 , treeNearScale: 0.75 },
    med: { vegTreeMid: 260, vegGrassR: 50, vegShrubR: 60, vegDecalR: 40, vegCardLod: 20, treeNearScale: 0.7, treeNearDensity: 0.85 },
    high: { vegTreeMid: 300, vegGrassR: 60, vegShrubR: 72, vegDecalR: 48, vegCardLod: 24, treeNearScale: 0.65 },
    ultra: { vegTreeMid: 380, vegGrassR: 80, vegShrubR: 100, vegDecalR: 64, vegCardLod: 45 , treeNearScale: 0.9 },
    // needleAABias (NEEDLE-AA): extra mip levels the needle cutout TEST samples beyond uVTexBias (colour stays sharp).
    // air only: no MSAA there (alphaToCoverage is a no-op), and FSR's RCAS re-sharpens whatever aliasing survives —
    // a coarser, stable alpha for the pass/discard decision reads as a calmer edge under upscale instead of a
    // per-pixel flicker. 0 (unset) elsewhere: identical shader text and output to before this change.
    air: { vegTreeMid: 170, vegGrassR: 28, vegShrubR: 36, vegDecalR: 22, vegCardLod: 14, rockLod: 1, treeNearDensity: 0.55, texBias: -0.8, aniso: 2 , treeNearScale: 0.7, needleAABias: 1.6 },
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
  // snow lying on branch tops (b03/b04/b06): world-up normals + 3D value noise → clumps of 0.3–0.8 m; the SAME function
  // runs on the near models and on the impostors (from the atlas normal), so both LODs carry the same snow.
  const GLSL_VSNOW = `
uniform float uVSnowK; uniform vec3 uVSnowC;
float vsH(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vsN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(vsH(i), vsH(i + vec3(1, 0, 0)), f.x), mix(vsH(i + vec3(0, 1, 0)), vsH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vsH(i + vec3(0, 0, 1)), vsH(i + vec3(1, 0, 1)), f.x), mix(vsH(i + vec3(0, 1, 1)), vsH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
vec3 vegSnow(vec3 alb, vec3 n, vec3 wp, float k){
  float nz = vsN(wp * .9) * .65 + vsN(wp * 2.6 + 7.) * .35;
  float m = smoothstep(.02, .5, n.y + (nz - .5) * 1.35) * k * uVSnowK;   // wider, chunkier clumps (b03/b04): heavier engulfing snow, not fine speckle
  return mix(alb, uVSnowC * (.85 + .25 * nz), clamp(m, 0., .97));
}`;
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
  

  /* ================================================================== init */
  function init(ctx) {
    C = ctx; THREE = ctx.THREE; V3 = THREE.Vector3; scene = ctx.scene; renderer = ctx.renderer; camera = ctx.camera;
    C.FOREST.onShadowCenter = () => { F.dirty = true; try { updateForest(); } catch (e) { /* before the forest exists */ } };   // shadow cache moved: cast set now, before its tiles render
    if (C.SHADOW) {   // cached shadow tiles: the per-tree shadow fade (uVSR) is measured from the cache centre, not the moving camera
      const keep = new THREE.Vector3();
      (C.SHADOW.beforeStatic = C.SHADOW.beforeStatic || []).push((x, y, z) => { if (U.uVCam) { keep.copy(U.uVCam.value); U.uVCam.value.set(x, y, z); } });
      (C.SHADOW.afterStatic = C.SHADOW.afterStatic || []).push(() => { if (U.uVCam) U.uVCam.value.copy(keep); });
    }
    for (const q in KNOBS) if (ctx.QUALITY[q]) for (const k in KNOBS[q]) if (ctx.QUALITY[q][k] === undefined) ctx.QUALITY[q][k] = KNOBS[q][k];
    const kq = KNOBS[ctx.Q.name] || KNOBS.high; for (const k in kq) if (ctx.Q[k] === undefined) ctx.Q[k] = kq[k];
    Object.assign(U, {
      uVT: { value: 0 }, uVStorm: { value: 0 }, uVWind: { value: new THREE.Vector2(WIND[0], WIND[1]) }, uVCam: { value: new V3() },
      uVFade: { value: new THREE.Vector4(175, 14, 300, 30) },   // near R, band, mid R, band
      uVActors: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
      uVShake: { value: Array.from({ length: 6 }, () => new THREE.Vector4(1e5, 1e5, 0, -99)) }, uVShakeD: { value: Array.from({ length: 6 }, () => new THREE.Vector4(1, 0, 0, 0)) }, uVSR: { value: 90 },
      uVGrass: { value: new THREE.Vector4(64, 10, 95, 14) },   // tuft R, band, shrub R, band
      uVBB: { value: new THREE.Vector3(1, 1, 1) },
      uVMoonDir: { value: new V3(0.77, 0.36, 0.56).normalize() }, uVMoonCol: { value: new THREE.Color() }, uVHemiS: { value: new THREE.Color() },
      uVTexBias: { value: 0 }, uVAlphaAA: { value: 0 },
      uVSnowK: { value: 1 }, uVSnowC: { value: new THREE.Color().setRGB(0.56, 0.6, 0.67) },   // branch snow: linear albedo (≈ ground snow)
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
      // tree_pine_scots (8) is retired: its flat crown read as a dark blob at night and its trunk was inside-out
      const w = [[3, 0.32], [4, 0.2], [5, 0.18], [0, 0.13], [1, 0.08], [6, 0.03], [2, 0.03], [9, 0.03]];
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

  // --- tree materials (near): wind, shake wobble, alpha-to-coverage LOD fade (no screen-door dither — B. Golus,
  // "Anti-aliased Alpha Test"), mip-aware alpha sharpening ---
  // NOTE: an earlier version of this patch also wired a per-vertex baked crown-AO attribute (assets/baked/treeao.js)
  // in here. It hit an unresolved 'treeAO'/'vTreeAO' redefinition error from the GLSL compiler on every tree material
  // (BatchedMesh + custom onBeforeCompile) that couldn't be root-caused quickly under this session's shared-lock time
  // pressure — reverted rather than risk shipping a broken shader or spending more of the team's benchmark queue time
  // on speculative fixes. See INT-VEG.md "Open" for the state this was left in.
  //
  // ASSET-QUALITY-1: no new attribute, no new sampler this time. The needle geometry already ships a per-vertex
  // 'color' attribute (itemSize 4, alpha channel always 1 → unused) that is already near-greyscale (R≈G≈B for
  // every sampled vertex) and already correlates with distance from the local trunk axis (r ≈ 0.44 measured via
  // tools/qa/probe.mjs on the live 'veg_tree_needles' BatchedMesh) — i.e. it is baked per-vertex crown shading /
  // AO from the source authoring, just applied as a weak *linear* tint (mean 0.73, sd 0.19, 98.5% of vertices in
  // 0.4–1.0) that all but disappears under the scene's hemisphere/moon fill light. `vegCrownAO` below re-reads
  // that same raw value and reshapes it with an S-curve + floor so the existing signal actually reads as depth
  // instead of a flat card, with zero new texture units.
  const GLSL_CROWN_AO = `
#if defined(USE_COLOR_ALPHA) || defined(USE_COLOR)
  { float vAo = clamp(vColor.r, 0.0, 1.0);
    float vAoK = mix(0.4, 1.0, smoothstep(0.42, 0.95, vAo));
    diffuseColor.rgb *= vAoK; }
#endif`;
  function patchTreeNear(mat, needles, depth, mul = 1) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev && !depth) prev(sh, r);
      sharedUniforms(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying float vVFade; varying vec3 vVW;')
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
          ${depth ? 'vVFade *= 1. - smoothstep(uVSR - 10., uVSR, vD);' : ''}
          vVW = (modelMatrix * vM * vec4(transformed, 1.)).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVFade; varying vec3 vVW; uniform float uVTexBias, uVAlphaAA;\n' + GLSL_DITHER + (depth ? '' : GLSL_VSNOW));
      if (depth) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vegDither() > vVFade) discard;');
      } else {
        // near↔far LOD fade + the needle cutout's own texture alpha are folded into diffuseColor.a (no discard here);
        // material.alphaTest + alphaToCoverage (set where these materials are built) make three's built-in
        // <alphatest_fragment> chunk resolve both as real MSAA sub-pixel coverage on the scene's multisampled render
        // target — no screen-door dither pattern on the LOD transition or on the needle-card cutout edges.
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
            diffuseColor *= texture2D(map, vMapUv, uVTexBias);   // NATURE: Q.texBias (sharper when upscaled from a low render scale)
          #endif
          float vmp = 0.;
          { vec2 vd1 = dFdx(vMapUv * 1024.), vd2 = dFdy(vMapUv * 1024.); vmp = max(0., .5 * log2(max(dot(vd1, vd1), dot(vd2, vd2)))); }
          diffuseColor.a = clamp(diffuseColor.a * (1. + vmp * .3), 0., 1.);
          ${needles ? `#ifdef USE_MAP
          // NEEDLE-AA (air, TEXUNITS-free: reuses the same 'map' sampler): the pass/discard decision reads a coarser
          // mip than the colour (uVTexBias + uVAlphaAA) — a temporally stable edge under FSR's low-res render + RCAS
          // sharpen, instead of one that flickers a pixel at a time. Not a dither: no per-pixel noise for RCAS to
          // amplify, just a calmer signal for the built-in alphatest_fragment discard below. 0 elsewhere (unchanged).
          if (uVAlphaAA > 0.001) { float aC = clamp(texture2D(map, vMapUv, uVTexBias + uVAlphaAA).a * (1. + vmp * .3), 0., 1.); diffuseColor.a = mix(diffuseColor.a, aC, .85); }
          #endif` : ''}
          diffuseColor.a *= clamp(vVFade, 0., 1.);
          diffuseColor.a *= smoothstep(.5, 1.7, length(vVW - cameraPosition));   // NATURE: cards brushing the lens dissolve (no full-screen needle overdraw when the camera grazes a crown)`);
        if (needles) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>${GLSL_CROWN_AO}`);
      }
      if (!depth && needles) {
        // NATURE: crown-volume normals must not be flipped on the back face of a double-sided card (the flip turns half
        // the crown's cards inward → black flecks); snow lies on the upper side of near-horizontal boughs (the card's own
        // face orientation from screen derivatives) in clumps, not on the whole upper hemisphere of the crown — the
        // spherical normals alone made every crown a white dome with dark gaps ("white smears"); light through the
        // needles when the moon is behind the crown (translucency).
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uVMoonDir, uVMoonCol, uVHemiS;')
          .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { vec3 nw = normalize((vec4(normal, 0.) * viewMatrix).xyz);
            vec3 fw = cross(dFdx(vVW), dFdy(vVW)); float fl = abs(fw.y) / max(length(fw), 1e-6);   // 1 = horizontal card
            float nz = vsN(vVW * 1.9);   // one octave: this runs under ×4–8 needle overdraw
            float m = smoothstep(-.25, .55, nw.y + (nz - .5) * 1.1) * mix(.25, 1., smoothstep(.3, .8, fl)) * smoothstep(.34, .6, nz + fl * .2) * uVSnowK;
            vec3 alb0 = diffuseColor.rgb;
            diffuseColor.rgb = mix(alb0, uVSnowC * (.85 + .25 * nz), clamp(m * 1.25, 0., .96));
            vec3 Vv = normalize(cameraPosition - vVW); float bk = pow(max(dot(-Vv, uVMoonDir), 0.), 3.);
            totalEmissiveRadiance += alb0 * (1. - clamp(m, 0., 1.)) * (uVMoonCol * bk * .45 + uVHemiS * .06); }`);
      }
      if (!depth) sh.fragmentShader = SAFE_END(needles ? sh.fragmentShader : sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          diffuseColor.rgb = vegSnow(diffuseColor.rgb, normalize((vec4(normal, 0.) * viewMatrix).xyz), vVW, .7);`));
    };
    mat.customProgramCacheKey = () => 'vegTree' + (needles ? 'N' : 'B') + (depth ? 'D' : '') + mul;
    return mat;
  }
  function depthFor(mat, needles, mul) {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map || null, alphaTest: mat.alphaTest || 0, side: mat.side });
    return patchTreeNear(d, needles, true, mul);
  }

  /* NATURE — card LOD for the near trees (the forest's main cost is needle-card overdraw, TEXUNITS.md: hiding the near
   * trees saves 5–7 ms). Beyond Q.vegCardLod m a tree draws a thinned copy of its needle mesh: the cards (connected
   * components) are thinned to `keep`, the inner ones first (hidden behind the outer shell anyway), and every kept card
   * grows ×grow about its centre so the crown keeps its coverage and silhouette with ≈ half the layers. */
  function cardLod(geo, keep = 0.34, grow = 1.42) {
    const I = geo.index ? geo.index.array : null; if (!I) return null;
    const P = geo.attributes.position, nV = P.count, par = new Int32Array(nV); for (let i = 0; i < nV; i++) par[i] = i;
    const f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (let t = 0; t < I.length; t += 3) { const a = f(I[t]); par[f(I[t + 1])] = a; par[f(I[t + 2])] = a; }
    const comps = new Map();
    for (let t = 0; t < I.length; t += 3) { const r = f(I[t]); let c = comps.get(r); if (!c) comps.set(r, (c = { tris: [], vs: new Set() })); c.tris.push(t); c.vs.add(I[t]).add(I[t + 1]).add(I[t + 2]); }
    let rMax = 1e-3; const list = [...comps.values()];
    for (const c of list) { let x = 0, y = 0, z = 0; for (const v of c.vs) { x += P.getX(v); y += P.getY(v); z += P.getZ(v); } const n = c.vs.size; c.c = [x / n, y / n, z / n]; c.r = Math.hypot(c.c[0], c.c[2]); rMax = Math.max(rMax, c.r); }
    list.forEach((c, k) => { c.s = C.hash2(k * 13 + 1, 77) * 0.55 + (c.r / rMax) * 0.45; });
    const cut = list.map((c) => c.s).sort((a, b) => b - a)[Math.max(0, Math.floor(list.length * keep) - 1)];
    const map = new Int32Array(nV).fill(-1), keepV = [], idx = [];
    for (const c of list) { if (c.s < cut) continue; for (const v of c.vs) { map[v] = keepV.length; keepV.push([v, c.c]); } for (const t of c.tris) idx.push(map[I[t]], map[I[t + 1]], map[I[t + 2]]); }
    const o = new THREE.BufferGeometry();
    for (const k in geo.attributes) {
      const a = geo.attributes[k], sz = a.itemSize, arr = new Float32Array(keepV.length * sz);
      keepV.forEach(([v, cc], i) => { for (let q = 0; q < sz; q++) arr[i * sz + q] = a.getComponent(v, q); if (k === 'position') for (let q = 0; q < 3; q++) arr[i * 3 + q] = cc[q] + (arr[i * 3 + q] - cc[q]) * grow; });
      o.setAttribute(k, new THREE.BufferAttribute(arr, sz, a.normalized));
    }
    o.setIndex(idx); o.userData.cardLod = { cards: list.length, kept: list.filter((c) => c.s >= cut).length };
    return o;
  }
  // group = one BatchedMesh pair (cast / no-cast) per material shared by several species
  function makeGroup(key, mat, parts, needles, mul = 1) {
    // parts: [{ sp, geo }]
    const geos = [];
    let nv = 0, ni = 0;
    for (const p of parts) { if (!geos.includes(p.geo)) { geos.push(p.geo); nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : 0; } }
    const lod = new Map();   // needle geometry → its thinned far copy
    if (needles) for (const g of geos) { const l = cardLod(g); if (l) { lod.set(g, l); nv += l.attributes.position.count; ni += l.index.count; } }
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
    const gid = new Map(), gidL = new Map();
    for (const g of geos) { gid.set(g, b.addGeometry(g)); if (lod.has(g)) gidL.set(gid.get(g), b.addGeometry(lod.get(g))); }
    G.lodOf = gidL; G.lodIds = new Map();   // instance id → [near geometry id, far geometry id]
    for (const t of trees) {
      const ids = [];
      for (const p of parts) if (p.sp === t.v) { const g0 = gid.get(p.geo), id = b.addInstance(g0); b.setMatrixAt(id, t.mReal); b.setVisibleAt(id, false); ids.push(id); if (gidL.has(g0)) G.lodIds.set(id, [g0, gidL.get(g0)]); }
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
  // NATURE (Q.treeNearDensity): a thinned-out tree keeps its real model only within 0.45 × the near radius
  const THIN = 0.45, thinK = (t, dens) => (dens >= 1 || C.hash2(t.i * 3 + 11, 29) < dens ? 1 : THIN);
  function syncImpostorNear(dens) {
    for (const m of IMP.meshes) { const a = m.geometry.attributes.aT2, L = m.userData.trees; if (!a || !L) continue;
      L.forEach((t, i) => { a.array[i * 4 + 1] = (SP[t.v].nearMul || 1) * thinK(t, dens); }); a.needsUpdate = true; }
  }
  function setTreeLod(t, far) {
    for (const G of F.groups) { const ids = G.inst.get(t); if (!ids) continue; for (const id of ids) { const L = G.lodIds && G.lodIds.get(id); if (L) G.b.setGeometryIdAt(id, L[far ? 1 : 0]); } }
  }
  let lastFX = 1e9, lastFZ = 1e9;
  function updateForest() {
    const cx = camera.position.x, cz = camera.position.z, R = C.FOREST.R * (C.Q.treeNearScale || 1),   // NATURE: Q.treeNearScale
      SR = C.FOREST.shadowR, mid = C.Q.vegTreeMid || 300;
    U.uVFade.value.set(R, 14, Math.max(mid, R + 40), 30); U.uVSR.value = SR;
    if (!F.dirty && (cx - lastFX) ** 2 + (cz - lastFZ) ** 2 < 1) return;
    F.dirty = false; lastFX = cx; lastFZ = cz;
    // FIX-PERF: with cached moon shadows the cast set follows the cache centre (changes only when the cache is rebuilt)
    const sa = C.FOREST.shadowAt, sx = sa ? sa.x : cx, sz = sa ? sa.z : cz;
    const S2 = SR * SR;
    let nNear = 0, nCast = 0, nFar = 0; const LD = C.Q.vegCardLod || 30, dens = C.Q.treeNearDensity !== undefined ? C.Q.treeNearDensity : 1;
    if (dens !== F.dens) { F.dens = dens; syncImpostorNear(dens); }
    for (const t of F.trees) {
      // shadow LOD per tree: tall trees cast up to shadowR, small ones stop earlier (alpha-tested foliage in 2 cascades is the
      // most expensive part of the shadow pass)
      const cr = Math.min(SR, 30 + 3.2 * (SP[t.v].H || 8) * t.s), d2 = (t[0] - cx) ** 2 + (t[2] - cz) ** 2, nr = R * (SP[t.v].nearMul || 1) * thinK(t, dens) + 1.5;
      const st = d2 < nr * nr ? ((t[0] - sx) ** 2 + (t[2] - sz) ** 2 < Math.min(S2, cr * cr) ? 1 : 2) : 0;
      if (st) nNear++; if (st === 1) nCast++;
      if (st !== t.st) { setTreeState(t, st); t.st = st; }
      if (st) { const fl = t.far ? d2 > (LD - 2) * (LD - 2) : d2 > LD * LD; if (fl !== !!t.far) { t.far = fl; setTreeLod(t, fl); } if (fl) nFar++; }
    }
    VEG.stats.nearTrees = nNear; VEG.stats.castTrees = nCast; VEG.stats.cardLodTrees = nFar;
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

  /* NATURE — "flat paws": needle cards lit like paper. Spherical (crown-volume) normals: every needle vertex gets the
   * normal of the crown's surface of revolution at its height (radial out + the cone's up-tilt from the measured crown
   * profile), blended with the card's own normal (turned to face outward), so the crown shades as one volume — lit side,
   * shadow side, darker core — instead of each card as a sheet of paper. Done once on the CPU at load: zero runtime cost. */
  function sphereNormals(geo, blend = 0.8, lift = 0.18) {
    const P = geo.attributes.position, N = geo.attributes.normal; if (!P || !N) return geo;
    const n = P.count, NB = 20; let y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { const y = P.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const dy = Math.max(1e-3, (y1 - y0) / NB), R = new Float32Array(NB);
    for (let i = 0; i < n; i++) { const b = clamp(Math.floor((P.getY(i) - y0) / dy), 0, NB - 1); R[b] = Math.max(R[b], Math.hypot(P.getX(i), P.getZ(i))); }
    const Rs = R.map((_, b) => (R[Math.max(0, b - 1)] + 2 * R[b] + R[Math.min(NB - 1, b + 1)]) / 4);
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = Math.hypot(x, z), f = (y - y0) / dy - 0.5, b = clamp(Math.floor(f), 0, NB - 2);
      const dR = (Rs[b + 1] - Rs[b]) / dy, ux = r > 1e-3 ? x / r : 0, uz = r > 1e-3 ? z / r : 0;
      let sx = ux, sy = clamp(-dR, -0.3, 2.5) + lift, sz = uz; const tip = sstep(0.82, 1, (y - y0) / (y1 - y0)); sy += tip * 1.5;   // the leader points up
      let l = Math.hypot(sx, sy, sz); sx /= l; sy /= l; sz /= l;
      let cx = N.getX(i), cy = N.getY(i), cz = N.getZ(i); if (cx * sx + cy * sy + cz * sz < 0) { cx = -cx; cy = -cy; cz = -cz; }
      const nx = sx * blend + cx * (1 - blend), ny = sy * blend + cy * (1 - blend), nz = sz * blend + cz * (1 - blend); l = Math.hypot(nx, ny, nz) || 1;
      N.setXYZ(i, nx / l, ny / l, nz / l);
    }
    N.needsUpdate = true; VEG.stats.sphereNormals = (VEG.stats.sphereNormals || 0) + n;
    return geo;
  }

  // --- adopt the game's 3 pass-1 species once its loader callbacks built them ---
  function adoptGameTrees() {
    const FO = C.FOREST;
    for (let vi = 0; vi < 3; vi++) {
      if (F.adopted[vi] || !FO.parts[vi] || !FO.parts[vi].length || !FO.parts[vi][0].isInstancedMesh) continue;
      // NATURE: the spruces carry a second, coincident copy of every needle card ('leaves_snow', a white sprig drawn over
      // the green one) — twice the needle overdraw for a crown painted solid white. Dropped: branch snow is the shared
      // clumped vegSnow of every other species. The green cards get crown-volume normals.
      for (const im of FO.parts[vi]) if (/leaves_snow/i.test(im.material.name || '')) { if (im.parent) im.parent.remove(im); }
      const src = FO.parts[vi].filter((im) => !/leaves_snow/i.test(im.material.name || '')).map((im) => ({ geo: sanitize(im.geometry), mat: im.material }));
      if (vi < 2) for (const s of src) if (/leaves/i.test(s.mat.name || '')) sphereNormals(s.geo, 0.8);
      for (const im of FO.parts[vi].concat(FO.mid[vi] || [])) { if (im.parent) im.parent.remove(im); }
      VEG.stats.droppedSnowLayer = (VEG.stats.droppedSnowLayer || 0) + FO.parts[vi].length - src.length;
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
    if (!m.alphaTest) m.alphaTest = 0.5;   // activate USE_ALPHATEST so the LOD fade can ride the scene's alpha-to-coverage
    m.alphaToCoverage = true;
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
    A.tuft = makeRT(1024, 1024); A.leaf = makeRT(1024, 1024); A.decal = makeRT(1024, 1024);
    for (const rt of [A.tuft, A.leaf, A.decal]) clearRT(rt, 0.05, 0.07, 0.05);
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
  /* ------------------------------------------------------------------ far LOD: night-relightable octahedral impostors
   * One LOD beyond the real models (no cards/billboard mix): hemi-octahedral 8×8 atlases (albedo + world normal + depth,
   * assets/veg/imp, baked by assets/incoming3/impostors/tools/bake-impostors.mjs). The material is a MeshStandardMaterial
   * whose map/normal come from the atlas, so the moon, hemisphere, aurora light, fog/height fog and tone mapping are exactly
   * the near trees' (no baked light, gain 1). One instanced quad per species (≤ 9 draws), ray-plane + 1 parallax step,
   * 4 frames blended; screen-door cross-fade with the near models over uVFade.y metres (complementary dither). */
  const IMP = { base: 'veg/imp/', meta: {}, meshes: [], shade: 0.7, snow: 0.6 };
  const IMP_META = {   // from assets/incoming3/impostors/<name>.json (center, radius, frameHalf, height); grid 8, cell 128 px
    tree_spruce_tall_snow: [[0.0837, 7, 0.3433], 8.2275, 8.4743, 14],
    tree_spruce_small_snow: [[-0.0809, 2.8952, -0.045], 3.4215, 3.5241, 6.2096],
    tree_dead_birch: [[-0.2099, 5.1789, -0.2683], 5.327, 5.4868, 10.3578],
    tree_spruce_snowladen: [[0, 5.61, 0], 6.5754, 6.7727, 11.22],
    tree_spruce_young_dusted: [[0, 3.315, 0], 4.1041, 4.2272, 6.63],
    tree_spruce_dense_tall: [[0, 8.16, 0], 9.025, 9.2958, 16.32],
    tree_fir_windbent: [[0, 4.59, 0], 4.9985, 5.1485, 9.18],
    tree_spruce_krummholz: [[0, 1.224, 0], 1.8161, 1.8706, 2.448],
    tree_snag_dead: [[0, 3.726, 0], 3.8248, 3.9396, 7.452],
  };
  const GLSL_OCT = `
vec2 impEnc(vec3 d){ d.y = max(d.y, 0.); d /= (abs(d.x) + d.y + abs(d.z)); return vec2(d.x + d.z, d.x - d.z); }
vec3 impDec(vec2 g){ float x = (g.x + g.y) * .5, z = (g.x - g.y) * .5; return normalize(vec3(x, 1. - abs(x) - abs(z), z)); }
void impBasis(vec3 D, out vec3 T, out vec3 B){ T = cross(vec3(0., 1., 0.), D); T = dot(T, T) < 1e-8 ? vec3(1., 0., 0.) : normalize(T); B = cross(D, T); }`;
  function impostorMaterial(s) {
    const sp = SP[s], M = IMP_META[sp.name], k = sp.impK || 1;
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.02, alphaToCoverage: true });
    m.name = 'veg_imp_' + sp.name;
    const u = {
      tImpA: { value: IMP.tex[s].a }, tImpN: { value: IMP.tex[s].n }, tImpD: { value: IMP.tex[s].d },
      uImpC: { value: new V3(M[0][0] * k, M[0][1] * k, M[0][2] * k) }, uImpK: { value: new THREE.Vector2(IMP.shade, IMP.snow) }, uImpR: { value: new THREE.Vector3(M[1] * k, M[2] * k, 8) },   // radius, frameHalf, grid
    };
    m.userData.imp = u;
    m.onBeforeCompile = (sh) => {
      sharedUniforms(sh); Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
${GLSL_COMMON}${GLSL_OCT}
attribute vec4 aT; attribute vec4 aT2;
uniform vec3 uImpC; uniform vec3 uImpR;
varying vec3 vIRo; varying vec3 vIP; varying vec2 vICs; varying float vIFade; varying vec3 vIW;`)
        .replace('#include <beginnormal_vertex>', `
float iS = aT2.x, icy = cos(aT.w), isy = sin(aT.w);
vec3 iRel = (cameraPosition - aT.xyz) / iS; vec3 iRo = vec3(icy * iRel.x - isy * iRel.z, iRel.y, isy * iRel.x + icy * iRel.z);   // camera in tree space
vec3 iV = normalize(iRo - uImpC); vec3 iT, iB; impBasis(iV, iT, iB);
vec3 iP = uImpC + iV * (.5 * uImpR.x) + (iT * position.x + iB * position.y) * (uImpR.y * 1.1);
vIRo = iRo; vIP = iP; vICs = vec2(icy, isy);
vec3 objectNormal = vec3(icy * iV.x + isy * iV.z, iV.y, -isy * iV.x + icy * iV.z);`)
        .replace('#include <begin_vertex>', `
vec3 transformed = aT.xyz + iS * vec3(icy * iP.x + isy * iP.z, iP.y, -isy * iP.x + icy * iP.z);
float iK = clamp((iP.y - uImpC.y * .3) * iS / 12., 0., 1.4); iK *= iK; transformed.xz += vegSway(aT.xz, iK, 1.1);   // same sway as the near model
vIW = transformed;
float iD = length(aT.xz - uVCam.xz), iNR = uVFade.x * aT2.y;
vIFade = smoothstep(iNR - uVFade.y, iNR, iD);                                  // 0 inside the near radius → 1 outside
if (iD < iNR - uVFade.y - 1.) transformed = aT.xyz - vec3(0., 1e4, 0.);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
${GLSL_DITHER}${GLSL_OCT}${GLSL_VSNOW}
uniform sampler2D tImpA, tImpN, tImpD; uniform vec3 uImpC; uniform vec3 uImpR; uniform vec2 uImpK;
varying vec3 vIRo; varying vec3 vIP; varying vec2 vICs; varying float vIFade; varying vec3 vIW;
vec3 iAccC; vec3 iAccN; float iAccA;
void impFrame(vec2 fr, float w, vec3 ro, vec3 rd){
  if (w <= 0.) return;
  float G = uImpR.z; vec3 D = impDec(fr / (G - 1.) * 2. - 1.); vec3 T, B; impBasis(D, T, B);
  float dn = dot(rd, D); if (abs(dn) < 1e-4) return;
  vec2 c0 = fr / G; vec2 ins = vec2(.5 / 128.);
  vec3 q = ro + rd * (dot(uImpC - ro, D) / dn) - uImpC;
  vec2 uv = vec2(dot(q, T), dot(q, B)) / (2. * uImpR.y) + .5;
  float s = (texture2D(tImpD, c0 + clamp(uv, ins, 1. - ins) / G).r * 2. - 1.) * uImpR.x;
  q = ro + rd * (dot(uImpC + D * s - ro, D) / dn) - uImpC;
  uv = vec2(dot(q, T), dot(q, B)) / (2. * uImpR.y) + .5;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return;
  vec2 a = c0 + clamp(uv, ins, 1. - ins) / G;
  vec4 c = texture2D(tImpA, a); float wa = w * c.a;
  iAccC += c.rgb * wa; iAccN += (texture2D(tImpN, a).xyz * 2. - 1.) * wa; iAccA += wa;
}
vec3 impNW;`)
        .replace('#include <map_fragment>', `
{ vec3 ro = vIRo, rd = normalize(vIP - vIRo); vec3 V = normalize(ro - uImpC); float G = uImpR.z;
  vec2 f = (impEnc(V) * .5 + .5) * (G - 1.); vec2 b = clamp(floor(f), vec2(0.), vec2(G - 2.)); vec2 w = clamp(f - b, 0., 1.);
  iAccC = vec3(0.); iAccN = vec3(0.); iAccA = 0.;
  impFrame(b, (1. - w.x) * (1. - w.y), ro, rd); impFrame(b + vec2(1., 0.), w.x * (1. - w.y), ro, rd);
  impFrame(b + vec2(0., 1.), (1. - w.x) * w.y, ro, rd); impFrame(b + vec2(1., 1.), w.x * w.y, ro, rd);
  if (iAccA < 1e-3) discard;
  diffuseColor.rgb *= iAccC / iAccA;
  vec3 nl = normalize(iAccN + vec3(0., 1e-4, 0.));
  impNW = normalize(vec3(vICs.x * nl.x + vICs.y * nl.z, nl.y, -vICs.y * nl.x + vICs.x * nl.z));
  diffuseColor.rgb = vegSnow(diffuseColor.rgb, impNW, vIW, uImpK.y) * uImpK.x;   // x: crown self-shadow the atlas lacks
  // alpha-to-coverage: fold the ray-hit coverage AND the near/impostor cross-fade into alpha instead of two dithered
  // discards — the scene's MSAA target resolves both as real sub-pixel coverage (Golus, alpha-to-coverage): no
  // screen-door pattern on the impostor's own cutout or on the near/impostor LOD transition.
  diffuseColor.a = smoothstep(.25, .65, iAccA) * clamp(vIFade, 0., 1.);
}`)
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(impNW, 0.)).xyz);');
      sh.fragmentShader = SAFE_END(sh.fragmentShader);
    };
    m.customProgramCacheKey = () => 'vegImp2';
    return m;
  }
  function loadImpostors() {
    IMP.tex = [];
    const L = VEG.TL || (VEG.TL = new THREE.TextureLoader(C.MANAGER));
    const ld = (f, srgb) => { const t = L.load(C.ASSET + IMP.base + f, undefined, undefined, () => console.warn('[veg] impostor texture failed', f)); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
    SP.forEach((sp, s) => { if (IMP_META[sp.name]) IMP.tex[s] = { a: ld(sp.name + '_albedo.png', true), n: ld(sp.name + '_normal.png', false), d: ld(sp.name + '_depth.png', false) }; });
  }
  function buildImpostors() {
    const quad = new THREE.PlaneGeometry(2, 2);
    for (let s = 0; s < NSP; s++) {
      const trees = F.trees.filter((t) => t.v === s); if (!trees.length || !IMP.tex[s]) continue;
      const sp = SP[s], M = IMP_META[sp.name];
      sp.impK = sp.H ? sp.H / M[3] : 1;   // the game's pass-1 meshes may be rescaled by prepModel: match the bake to the drawn model
      const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv); g.setAttribute('normal', quad.attributes.normal);
      const aT = new Float32Array(trees.length * 4), aT2 = new Float32Array(trees.length * 4);
      trees.forEach((t, i) => { aT.set([t[0], t.y, t[2], t.yaw], i * 4); aT2.set([t.s, sp.nearMul || 1, C.hash2(t.i, 33), 0], i * 4); });
      g.setAttribute('aT', new THREE.InstancedBufferAttribute(aT, 4)); g.setAttribute('aT2', new THREE.InstancedBufferAttribute(aT2, 4)); g.instanceCount = trees.length;
      const mesh = new THREE.Mesh(g, impostorMaterial(s)); mesh.name = 'veg_tree_imp_' + sp.name; mesh.userData.trees = trees;
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      scene.add(mesh); IMP.meshes.push(mesh);
    }
    F.mid = IMP.meshes; F.far = null; F.dens = undefined; F.dirty = true;
    VEG.stats.impostors = F.trees.length; VEG.stats.impostorDraws = IMP.meshes.length;
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
    loadImpostors();
    // tuft cards / shrub leaves / decals → 2x2 atlases (glTF uv: flipY false, cell k at ((k%2)*512, floor(k/2)*512))
    const TUFTS = ['veg_tuft_dry_tussock', 'veg_tuft_sedge', 'veg_tuft_seedgrass', 'veg_tuft_frosted'];
    const LEAVES = ['veg_shrub_dwarf_birch_leaf', 'veg_shrub_dwarf_willow_leaf', 'veg_shrub_crowberry_leaf'];
    const DECALS = ['veg_decal_lichen_pale', 'veg_decal_moss_olive', 'veg_decal_lichen_orange'];
    const into = (rt, list, flip) => list.forEach((n, k) => loadTex(n + '.png', true, flip, (t) => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; A.queue.push(() => { blit(rt, t, (k % 2) * 512, Math.floor(k / 2) * 512, 512, 512); t.dispose(); }); }));
    into(A.tuft, TUFTS, false); into(A.leaf, LEAVES, false); into(A.decal, DECALS, true);
    TEX.lichen = loadTex('veg_decal_lichen_orange.png', true, true);
    C.loadPacked('veg_set', C.ASSET, onVegSet);
    C.loadPacked('rock_namaqualand_boulder_02', C.ASSET, (g) => { R.flat = g; });
    // NATURE: Poly Haven CC0 scans (tools/pack-rocks.mjs: 3 LODs, normal map re-baked for LOD0, AO in the albedo)
    for (const n of ['namaqualand_boulder_06', 'rock_07', 'rock_09']) C.loadPacked('rock_ph_' + n, C.ASSET, (g) => { (R.ph = R.ph || {})[n] = g; }, () => { (R.ph = R.ph || {})[n] = null; });
    // outcrops: the closed-back scan (assets/incoming3, packed as rock_rock_face_02_closed) when present, else the open one
    const face = (n) => C.loadPacked(n, C.ASSET, (g) => { R.face = g; R.faceName = n; });
    try { fetch(C.ASSET + 'pack/rock_rock_face_02_closed.js', { method: 'HEAD' }).then((r) => face(r.ok ? 'rock_rock_face_02_closed' : 'rock_rock_face_02'), () => face('rock_rock_face_02')); } catch (e) { face('rock_rock_face_02'); }
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
  // trunk base under the drawn snow: register, read the fitted trunk base of every instance, lower the trees whose base
  // is above (lowest snow surface around the trunk − 12 cm), re-register. Wind-bent firs lean: their base sits off the
  // origin, on the downhill side of a ridge, hence the 1.5 m floats before this pass.
  function seatTrees(trees, holder, name) {
    const P = Passport(), surf = (x, z) => (C.groundH ? C.groundH(x, z) : C.getH(x, z)) + depthAt(x, z);
    let es = P.registerInstances(holder, trees.map((t) => t.mReal), 'trunk', { part: /bark/i, name });
    let moved = 0;
    trees.forEach((t, k) => {
      const e = es[k]; if (!e || !e.trunk) return;
      const tr = e.trunk, rr = tr.r + 0.35; let lo = surf(tr.x, tr.z);
      for (let a = 0; a < 8; a++) lo = Math.min(lo, surf(tr.x + Math.cos(a * TAU / 8) * rr, tr.z + Math.sin(a * TAU / 8) * rr));
      const gap = tr.y0 + 0.6 - (lo - 0.12);
      if (gap > 0) { t.y -= gap; t.mReal.elements[13] -= gap; moved++; VEG.stats.seatMax = Math.max(VEG.stats.seatMax || 0, +gap.toFixed(2)); }
    });
    if (moved) { for (const e of es) P.remove(e); es = P.registerInstances(holder, trees.map((t) => t.mReal), 'trunk', { part: /bark/i, name }); }
    VEG.stats.seated = (VEG.stats.seated || 0) + moved;
    return es;
  }
  /* NATURE (look-gate pilot_branch): the krummholz is a dense 2.6 m needle mat around a thin leader, but its only collider
   * was the trunk cylinder — the pilot walked into the mat and stood half hidden in it, the camera too. A low convex
   * dome per instance, fitted to the dense part of the skirt (70th percentile of the needle radius under 1.3 m), is
   * registered as a 'solid' hull: the pilot and the camera boom stop at the needles. Rounded top: nothing to stand on. */
  function krummholzSolids(P, trees) {
    let ps = null; for (const p of P.parts) if (p.name === 'needles') ps = p.geo.attributes.position;
    if (!ps) return;
    const rs = []; let top = 0;
    for (let i = 0; i < ps.count; i++) { const y = ps.getY(i); if (y < 1.3) rs.push(Math.hypot(ps.getX(i), ps.getZ(i))); top = Math.max(top, y); }
    rs.sort((a, b) => a - b); const R = rs[Math.floor(rs.length * 0.85)] || 0.9, H = Math.min(1.25, top * 0.5);
    const g = new THREE.CylinderGeometry(R * 0.35, R, H, 10, 2); g.translate(0, H / 2 - 0.1, 0);
    const Pp = Passport(); VEG.krummholzSolids = Pp.registerInstances(g, trees.map((t) => t.mReal), 'solid', { shape: 'hull', name: 'krummholz', exact: false });
    VEG.stats.krummholz = { R: +R.toFixed(2), H: +H.toFixed(2), n: trees.length };
  }
  /* NATURE — the wind-bent fir read as a black stick with white smears (a 4 k-tri model: bare pole + a few flagged
   * cards). Rebuilt from the young spruce: same bark and needle cards, ×k taller, a slight downwind lean, and the
   * windward cards stripped from the middle of the crown (a "flag tree": branches on the lee side, a full skirt at the
   * foot where the snow sheltered it, a tuft at the top). Wind = +X in model space, as the old asset. */
  function flagTree(src, k) {
    const lean = (x, y) => x + y * y * 0.006;
    const parts = src.parts.map((p) => {
      const g = p.geo.clone(); g.scale(k, k, k);
      const P = g.attributes.position; let yMax = 0; for (let i = 0; i < P.count; i++) yMax = Math.max(yMax, P.getY(i));
      if (p.name === 'needles' && g.index) {
        const I = g.index.array, nV = P.count, par = new Int32Array(nV); for (let i = 0; i < nV; i++) par[i] = i;
        const f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
        for (let t = 0; t < I.length; t += 3) { const a = f(I[t]); par[f(I[t + 1])] = a; par[f(I[t + 2])] = a; }
        const cen = new Map(); for (let i = 0; i < nV; i++) { const r = f(i); let c = cen.get(r); if (!c) cen.set(r, (c = [0, 0, 0, 0])); c[0] += P.getX(i); c[1] += P.getY(i); c[2] += P.getZ(i); c[3]++; }
        const keep = new Map(); let k2 = 0;
        for (const [r, c] of cen) { const x = c[0] / c[3], y = c[1] / c[3] / yMax, z = c[2] / c[3], rr = Math.hypot(x, z) || 1;
          const lee = x / rr;   // +1 downwind side
          keep.set(r, y < 0.2 || y > 0.86 || lee > -0.1 + 0.5 * C.hash2(k2++, 5)); }
        const idx = []; for (let t = 0; t < I.length; t += 3) if (keep.get(f(I[t]))) idx.push(I[t], I[t + 1], I[t + 2]);
        g.setIndex(idx);
        for (let i = 0; i < nV; i++) { const x = P.getX(i), y = P.getY(i) / yMax; if (x > 0 && y > 0.2) P.setX(i, x * (1 + 0.35 * y)); }   // lee branches stream out
      }
      for (let i = 0; i < P.count; i++) P.setX(i, lean(P.getX(i), P.getY(i)));
      P.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
      return Object.assign({}, p, { geo: g });
    });
    VEG.stats.windbent = 'flagged young spruce ×' + k;
    return { node: src.node, parts };
  }
  function buildNewSpecies() {
    const needles = new THREE.MeshStandardMaterial({ name: 'needles', map: TEX.needles, alphaTest: 0.42, alphaToCoverage: true, vertexColors: true, roughness: 0.88, metalness: 0 });
    const pbark = new THREE.MeshStandardMaterial({ name: 'bark', map: TEX.pbark, normalMap: TEX.pbarkN, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.95, metalness: 0 }); pbark.color.setRGB(0.8, 0.78, 0.76);
    const dbark = new THREE.MeshStandardMaterial({ name: 'bark', map: TEX.dbark, normalMap: TEX.dbarkN, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.95, metalness: 0 }); dbark.color.setRGB(0.85, 0.85, 0.85);
    const gN = [], gP = [], gD = [];
    if (PACK.tree_spruce_young_dusted && PACK.tree_fir_windbent) PACK.tree_fir_windbent = flagTree(PACK.tree_spruce_young_dusted, 1.35);
    for (let s = 3; s < NSP; s++) {
      const P = PACK[SP[s].name]; if (!P) { console.warn('[veg] missing', SP[s].name); continue; }
      for (const p of P.parts) {
        if (p.name === 'needles') { if (!p.geo.attributes.color) continue; gN.push({ sp: s, geo: p.geo }); }
        else (s === 9 ? gD : gP).push({ sp: s, geo: p.geo });
      }
      // trunk colliders: cylinder fitted to the bark base ring, one per tree (same Passport path as the pass-1 trees)
      const holder = new THREE.Group(); for (const p of P.parts) if (p.name === 'bark') { const m = new THREE.Mesh(p.geo, pbark); m.name = 'bark'; holder.add(m); }
      const trees = F.trees.filter((t) => t.v === s);
      if (trees.length) try { seatTrees(trees, holder, SP[s].name); } catch (e) { console.warn('[veg] trunk colliders', SP[s].name, e); }
      if (s === 7 && trees.length) try { krummholzSolids(P, trees); } catch (e) { console.warn('[veg] krummholz solids', e); }
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
      const plant = kind === 'tuft' || kind === 'leaf';
      // GROUNDBLEND: one ground-contact rule — the base sits on the DRAWN snow surface (GPU field, per vertex near the base),
      // sunk like before (tufts 7 cm + ≤ 6 cm of loose snow, shrubs 4 cm + ≤ 12 cm, decals 1.5 cm above), instead of the
      // CPU physics height + snow depth (the render surface differs by −8…+25 cm plus the sastrugi relief → floating tufts)
      const gb = window.GroundBlend && window.GroundBlend.attachVertex ? window.GroundBlend.attachVertex(sh) : '';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nuniform vec4 uVGrass; varying float vVFade; varying vec3 vVWp; varying float vVHb;' + (kind === 'decal' ? '\nattribute float aCell;' : '') + (gb ? '\n#define VEG_GB\n' + gb : ''))
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
          vVWp = vW + vOff; vVHb = position.y * sqrt(vS2);
          vVFade = 1. - smoothstep(${kind === 'tuft' ? 'uVGrass.x - uVGrass.y, uVGrass.x' : 'uVGrass.z - uVGrass.w, uVGrass.z'}, vD);`}
          #ifdef VEG_GB
          { vec2 gs0 = gbSurfV(vOrg.xz);
            if (gs0.x > -1e3) {
              vec3 gWv = (modelMatrix * vM * vec4(position, 1.)).xyz; vec2 gsv = gbSurfV(gWv.xz);
              float gHb = max(position.y, 0.) * sqrt(vS2);
              float gSink = ${kind === 'tuft' ? '.02 + min(gs0.y, .03)' : kind === 'decal' ? '-.015' : '.03 + min(gs0.y, .06)'};   // NATURE: was .035+≤.05 / .045+≤.1 — short tufts and the low heather mats vanished into the snow
              float dy = gs0.x - vOrg.y - gSink
                + (gsv.x - gs0.x) * (1. - smoothstep(.02, .3, gHb));   // the base follows the surface under it, the tips follow the origin
              transformed += inverse(mat3(vM)) * vec3(0., dy, 0.);   // exact for tilted, non-uniformly scaled instances
              ${kind === 'decal' ? '' : 'vVWp.y += dy; vVHb = gHb - gSink;   // height above the snow surface: the snow-coloured base starts AT the surface'}
            } }
          #endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vVFade; varying vec3 vVWp; varying float vVHb;\nuniform vec3 uVMoonDir, uVMoonCol, uVHemiS, uVSnowC; uniform float uVTexBias;\n' + GLSL_DITHER)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + (kind === 'twig' ? '\n if (vegDither() > vVFade) discard;' : ''))
        .replace('#include <map_fragment>', `#ifdef USE_MAP
            diffuseColor *= texture2D(map, vMapUv, uVTexBias);   // NATURE: Q.texBias (sharper when upscaled from a low render scale)
          #endif
          ${kind === 'decal' ? 'diffuseColor.a *= vVFade * .55;' : `{ vec2 dx = dFdx(vMapUv * 1024.), dy = dFdy(vMapUv * 1024.); float mp = max(0., .5 * log2(max(dot(dx, dx), dot(dy, dy)))); diffuseColor.a = clamp(diffuseColor.a * (1. + mp * .3), 0., 1.); }
          ${plant ? 'diffuseColor.a *= clamp(vVFade, 0., 1.);' : ''}`}
          ${plant ? `{ // photo texture → relative detail (≈ 1); the albedo itself comes from the instance colour (STYLE.palette straw / heather)
            vec2 cc = floor(clamp(vMapUv, 0., .999) * 2.); float ci = cc.x + 2. * cc.y;
            vec4 ref = ${kind === 'tuft' ? 'vec4(.056, .054, .074, .071)' : 'vec4(.105, .106, .034, .1)'};
            float rl = ci < .5 ? ref.x : ci < 1.5 ? ref.y : ci < 2.5 ? ref.z : ref.w;
            float tl = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
            diffuseColor.rgb = clamp(mix(vec3(tl), diffuseColor.rgb * (tl / max(dot(diffuseColor.rgb, vec3(.3333)), 1e-4)), ${kind === 'tuft' ? '.3' : '.1'}) / rl, .3, 1.7); }` : ''}`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + (kind === 'leaf' ? '\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif' : ''))
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + (plant || kind === 'twig' ? `
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz), ${kind === 'tuft' ? '.75' : kind === 'leaf' ? '.12' : '.35'}));   // NATURE: heather keeps its mound normals (was .4 → flat, evenly lit disc from above)   // thin blades: lit like the snow they stand in` : ''))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + (plant ? `
          { float gbPn = fract(sin(dot(floor(vVWp.xz * 11.), vec2(12.9898, 78.233))) * 43758.5453);   // patchy, not a ring on every plant
            float snowBase = (1. - smoothstep(-.01, ${kind === 'tuft' ? '.05' : '.05'} * (.4 + 1.2 * gbPn), vVHb)) * (.45 + .55 * step(.35, gbPn)), snowRim = snowBase * (1. - snowBase) * 4.;
            diffuseColor.rgb = mix(diffuseColor.rgb, uVSnowC, snowBase * .8) + uVSnowC * snowRim * .3; }   // snow at the base + a brighter rim where the blade breaks the surface
          { vec3 Vv = normalize(cameraPosition - vVWp); float bk = pow(max(dot(-Vv, uVMoonDir), 0.), ${kind === 'tuft' ? '4.' : '2.2'});   // light through the blades (backlit glow)
            totalEmissiveRadiance += diffuseColor.rgb * (uVMoonCol * (${kind === 'tuft' ? '.14 + 1.1' : '.16 + .9'} * bk) + uVHemiS * ${kind === 'tuft' ? '.12' : '.26'}); }   // heather: wider, less view-dependent transmission — never a flat dark ball` : ''));
      sh.fragmentShader = SAFE_END(sh.fragmentShader);
    };
    m.customProgramCacheKey = () => 'vegGround' + kind + (window.GroundBlend ? 'gb' : '');
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
    for (const g of GR.leafGeo) if (g) sphereNormals(g, 0.7, 0.35);   // NATURE: heather/shrub crowns shade as mounds, not flat card fans
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
  // ground plant albedo (linear) from the style palette: dry straw / sedge / seed grass / frosted; birch rust, willow, crowberry heather
  let _pal = null;
  const PAL = () => _pal || (_pal = (() => { const P = (C.STYLE && C.STYLE.palette) || {}, L = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map((v) => Math.pow(v, 2.2));
    return { tuft: [P.strawDry || 0xb69a6a, P.strawSedge || 0xa8987a, P.strawSeed || 0xc2a878, P.strawFrost || 0xb4b0a4].map(L),
      tuftAlt: [P.strawGrey || 0x9c968a, P.strawRust || 0x9a7452, P.strawOlive || 0x8c8a66].map(L),
      shrub: [P.heatherBirch || 0x7c5038, P.heatherWillow || 0x7a6c52, P.heatherCrow || 0x5e4a42].map(L) }; })());
  function genChunk(ci, cj) {
    const CS = GR.CS, r = mulberry(ihash(ci, cj, 4711)), dens = C.Q.grass || 1;
    const out = { tuft: [], shrub: [], decal: [], pass: [] };
    const lk = LAKE(), sites = siteList();
    const bad = (x, z, h) => h < 0.35 || C.riftD(x, z) < 58 || C.nearPOI(x, z, -8) || sites.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 196);
    // tufts
    const nT = Math.round(70 * dens);   // NATURE: was 58
    for (let k = 0; k < nT; k++) {
      const x = (ci + r()) * CS, z = (cj + r()) * CS, h = C.getH(x, z); if (bad(x, z, h)) continue;
      const ny = C.normalY(x, z); if (ny < 0.6) continue;
      const dl = Math.hypot(x - lk.x, z - lk.z); if (dl < 50.5) continue;
      const shore = dl < 66 ? sstep(66, 52, dl) : 0, rk = rockNear(x, z), nearR = rk < 2.8 ? sstep(2.8, 0.3, rk) : 0;
      const bare = snowFree(x, z, ny), coast = h < 2.2 ? 0.35 : 0;
      const p = 0.045 + 0.8 * bare + 0.7 * nearR + 0.8 * shore + coast;
      if (r() > p * (0.55 + 0.9 * C.fbm(x * 0.05 - 3, z * 0.05 + 8, 2))) continue;
      const w = r(); let v;
      if (shore > 0.3) v = w < 0.6 ? 1 : w < 0.85 ? 0 : 2;
      else if (h > 34 || bare < 0.35) v = w < 0.45 ? 3 : w < 0.85 ? 0 : 2;
      else v = w < 0.52 ? 0 : w < 0.75 ? 1 : w < 0.9 ? 2 : 3;
      // size by exposure: tall on bare wind-scoured ground, short stubs poking out of deeper snow — wide per-instance
      // variance (not the same tuft copy-pasted everywhere); the lean angle is added at bake time (bakeChunk)
      const s = (0.55 + r() * 1.05) * (0.75 + 0.5 * bare), sy = s * (0.8 + r() * 0.75), frost = v === 3 || bare < 0.35 ? 0.1 : 0;
      const c0 = PAL().tuft[v], alt = PAL().tuftAlt[(r() * PAL().tuftAlt.length) | 0], mixA = r() * 0.45, br = 0.82 + r() * 0.36;
      const col = [0, 1, 2].map((k) => ((c0[k] * (1 - mixA) + alt[k] * mixA) * br) * (1 - frost) + frost * 0.5);
      out.tuft.push([v, x, h + Math.max(0, depthAt(x, z) - 0.06) - 0.07, z, r() * TAU, s, sy, col]);
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
        const c0 = PAL().shrub[sp], br = 0.72 + r() * 0.7, hue = (r() - 0.5) * 0.12, tint = [c0[0] * br * (1 + hue), c0[1] * br, c0[2] * br * (1 - hue)];
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
    for (const [v, x, y, z, ry, sc, sy, c] of ch.data.tuft) {
      e.set((C.hash2(x, z + 3) - 0.5) * 0.24, ry, (C.hash2(z, x + 3) - 0.5) * 0.24); q.setFromEuler(e);   // a lean, not perfectly upright every time
      m.compose(p.set(x, y, z), q, s.set(sc, sy, sc)); B.tuft[v].push(m.elements.slice(), c);
    }
    for (const [v, x, y, z, ry, sc, c] of ch.data.shrub) {
      e.set((C.hash2(x, z) - 0.5) * 0.15, ry, (C.hash2(z, x) - 0.5) * 0.15); q.setFromEuler(e);
      // crowberry/willow (heather, e05/e06): flatten into a low tangled mat instead of a ball on a stem; birch stays upright
      const hv = 0.8 + C.hash2(x * 3.1, z * 1.7) * 0.5;   // NATURE: uneven mound heights (e05/e06), less flattened (was 0.58 / 0.76)
      const sy2 = (v === 2 ? sc * 0.72 : v === 1 ? sc * 0.85 : sc) * hv, sxz = v === 2 ? sc * 1.18 : v === 1 ? sc * 1.08 : sc;
      m.compose(p.set(x, y, z), q, s.set(sxz, sy2, sxz)); B.shrub[v].push(m.elements.slice(), c);
    }
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
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          ${o.cap ? `{ // snow pillow 5–30 cm on the up-facing top (d01–d05): grows along world up, thickest on flat tops
            mat4 cM = modelMatrix;
            #ifdef USE_INSTANCING
              cM = cM * instanceMatrix;
            #endif
            vec3 cN = normalize(mat3(cM) * objectNormal); vec3 cW = (cM * vec4(position, 1.)).xyz;
            float cT = ${o.cap.toFixed(3)} * smoothstep(.45, .92, cN.y) * (.55 + .45 * sin(cW.x * 1.7 + cW.z * 1.3) * sin(cW.z * 2.1 - cW.x * .7));
            transformed += (transpose(mat3(cM)) * vec3(0., cT, 0.)) / max(dot(cM[1].xyz, cM[1].xyz), 1e-4); }` : ''}`)
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
  /* Seating by the QA invariant itself (tools/qa/qa-page.js placedCheck): lowest vertex of each 3×3 footprint cell of the
   * collider vs the visible surface (ground + loose snow); buried share = mean over cells of the column under the surface.
   * seatDy solves that share = target exactly (monotone in dy → bisection) instead of guessing a sink depth per model. */
  // REALISM-QA rule 4: the surface as drawn (terrain snowField) and the rule's own 4×4 cells, so seat and check agree
  const SURF = (x, z) => { const f = C.snowField; if (f && f.sample) { const q = f.sample(x, z); if (q && Number.isFinite(q[0])) return q[0]; } return (C.groundH ? C.groundH(x, z) : C.getH(x, z)) + depthAt(x, z); };
  const SEAT_N = 4;
  function seatDy(v, target) {
    const n = v.length / 3; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { const x = v[i * 3], z = v[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const lo = [], top = [];
    const N = SEAT_N;
    for (let i = 0; i < n; i++) { const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2]; const ci = Math.min(N - 1, Math.floor((x - x0) / Math.max(1e-3, x1 - x0) * N)), cj = Math.min(N - 1, Math.floor((z - z0) / Math.max(1e-3, z1 - z0) * N)), k = ci * N + cj;
      if (!lo[k] || y < lo[k][1]) lo[k] = [x, y, z]; if (top[k] === undefined || y > top[k]) top[k] = y; }
    const cs = []; for (let k = 0; k < N * N; k++) if (lo[k] && top[k] - lo[k][1] > 0.02) cs.push([lo[k][1], top[k] - lo[k][1], SURF(lo[k][0], lo[k][2])]);
    if (!cs.length) return 0;
    const f = (dy) => { let a = 0; for (const [y, h, sf] of cs) a += clamp((sf - (y + dy)) / h, 0, 1); return a / cs.length; };
    let a = -40, b = 40; for (let it = 0; it < 40; it++) { const m = (a + b) / 2; if (f(m) > target) a = m; else b = m; }
    return (a + b) / 2;
  }
  // every rock set: its matrices, the instanced meshes drawing them, how to (re)register its colliders
  function reseatRocks(why) {
    const t0 = performance.now(); let moved = 0, worst = 0;
    for (const S of R.sets) {
      const ch = [];
      S.list.forEach((M, k) => { const e = S.entries[k]; if (!e || !e.geo) return; const t = 0.12 + 0.08 * C.hash2(k * 3 + 1, S.seed), dy = seatDy(e.geo.v, t);
        if (Math.abs(dy) > 0.01) { M.elements[13] += dy; ch.push(k); worst = Math.max(worst, Math.abs(dy)); } });
      if (!ch.length) continue; moved += ch.length;
      for (const im of S.meshes) { S.list.forEach((M, i) => im.setMatrixAt(i, M)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere(); }
      for (const e of S.entries) Passport().remove(e);
      S.entries = S.register();
      if (S.after) S.after(S.entries);
    }
    VEG.stats.reseat = (VEG.stats.reseat || []).concat([{ why, moved, worst: +worst.toFixed(2), ms: Math.round(performance.now() - t0) }]).slice(-6);
  }
  const SNOWC = () => typeof C.snowCover === 'function';   // terrain module: snow shading + drifts around every Passport solid
  const GROUND = (x, z) => C.getH(x, z) + Math.min(depthAt(x, z), 0.35) * 0.8;   // rendered snow surface (approx.)
  const LOWEST = (x, z, rad) => { let m = C.getH(x, z); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; m = Math.min(m, C.getH(x + Math.cos(a) * rad, z + Math.sin(a) * rad)); } return m; };
  /* NATURE — Poly Haven scans. phModel: one LOD of a rock_ph pack as a model root, rotated so its long axis is X and
   * scaled to `span` m along it (the scans are at real size: rock_09 is a 15 cm stone, used here as a slab). The LOD is
   * picked by the preset (Q.rockLod: 0 = 4.5–4.8 k tris, 1 = 1.4 k on air); the normal map was baked for LOD0. */
  function phModel(g, span, lod) {
    const L = lod !== undefined ? lod : (C.Q.rockLod || 0), src = g.scene.getObjectByName('LOD' + L) || g.scene.getObjectByName('LOD0');
    const m = src.clone(); m.position.set(0, 0, 0); m.rotation.set(0, Math.PI / 2, 0); m.scale.set(1, 1, 1);
    const root = new THREE.Group(); root.add(m); root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(root), k = span / Math.max(1e-3, b.max.x - b.min.x); m.scale.setScalar(k);
    m.material.roughness = 0.9; m.material.metalness = 0; m.material.side = THREE.FrontSide;
    return { scene: root };
  }
  // the 70 game boulders (rock_boulder_01, 3 k tris, 1.3 × 1.0 × 1.8 m) → namaqualand_boulder_06: same InstancedMeshes
  // (other modules hold them), new geometry baked into the old model's frame, the scan's textures copied into the
  // existing (already patched) material
  function swapBoulders(D) {
    const im0 = D.boulderMeshes[0], old = im0.geometry; old.computeBoundingBox(); const ob = old.boundingBox;
    const r = phModel(R.ph.namaqualand_boulder_06, Math.max(ob.max.x - ob.min.x, ob.max.z - ob.min.z)), mesh = r.scene.children[0];
    r.scene.updateMatrixWorld(true); const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);
    // long axis along the old model's long axis (Z for boulder_01)
    if (ob.max.z - ob.min.z > ob.max.x - ob.min.x) g.rotateY(Math.PI / 2);
    g.computeBoundingBox(); g.translate(0, ob.min.y - g.boundingBox.min.y, 0); g.computeBoundingSphere();
    g.userData.source = 'rock_ph_namaqualand_boulder_06';
    const sm = mesh.material, m = im0.material;
    m.map = sm.map; m.normalMap = sm.normalMap; m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null; m.roughness = 0.9; m.metalness = 0; m.needsUpdate = true;
    for (const im of D.boulderMeshes) { im.geometry = im === im0 ? g : im.geometry; if (im !== im0) im.visible = false; }
    VEG.stats.boulderScan = { tris: g.index ? g.index.count / 3 : 0, from: old.index ? old.index.count / 3 : 0 };
  }
  function rocksStep() {
    const D = C.DECOR;
    if (R.done || !D.boulderMeshes || !D.boulders || !R.flat || !R.face || !GR.ready) return;
    if ((!R.ph || Object.keys(R.ph).length < 3) && tAcc < 45) return;   // NATURE: wait for the scan packs (≤ 45 s, then the old models)
    R.done = true;
    const P = Passport(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3();
    const skirts = [];
    // --- boulders (rock_boulder_01, 1.8 x 1.0 x ~1.2 m model): re-seat against the lowest ground under the footprint ---
    if (R.ph && R.ph.namaqualand_boulder_06) swapBoulders(D);
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
    for (const im of D.boulderMeshes) { D.boulders.forEach((M, i) => im.setMatrixAt(i, M)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere(); rockMaterialPatch(im.material, { desat: 0.8, grade: [0.5, 0.52, 0.57], lichen: 0.45, snow: SNOWC() ? 0 : 1, cap: 0.24 }); }   // NATURE: neutral dark basalt (d01–d05), was a blue-green cast
    for (const en of D.boulderEntries || []) P.remove(en);
    const holder = new THREE.Group(); holder.add(new THREE.Mesh(bgeo, D.boulderMeshes[0].material));
    D.boulderEntries = P.registerInstances(holder, D.boulders, 'solid', { name: 'boulder' });
    R.sets = [{ name: 'boulder', seed: 11, list: D.boulders, meshes: D.boulderMeshes, entries: D.boulderEntries, register: () => P.registerInstances(holder, D.boulders, 'solid', { name: 'boulder' }), after: (en) => { D.boulderEntries = en; } }];
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
      const rl = []; for (let i = 0; i < RM.count; i++) { const Mi = new THREE.Matrix4(); RM.getMatrixAt(i, Mi); rl.push(Mi); }
      const regR = () => [].concat(P.register(RM, 'solid', { shape: 'hull', name: 'rock' }));
      R.sets.push({ name: 'rock', seed: 13, list: rl, meshes: [RM], entries: regR(), register: regR });
    }
    // --- new rocks: flat namaqualand boulders + rock-face outcrops on slopes ---
    const addModel = (g, name, list, patch) => {
      const root = C.prepModel(g.scene, 0), parts = C.bakeParts(root), meshes = [];
      for (const { geo, mat } of parts) { sanitize(geo); if (!/_back$/i.test(mat.name || '')) mat.side = THREE.FrontSide; rockMaterialPatch(mat, Object.assign({}, patch, { snow: SNOWC() ? 0 : 1 })); if (SNOWC()) try { C.snowCover(mat, { amount: 1, minUp: 0.55, soft: 0.2, skirt: 0.35 }); } catch (e) { /* own snow off: none */ } const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((M, i) => im.setMatrixAt(i, M)); im.castShadow = true; im.receiveShadow = true; im.name = name; scene.add(im); meshes.push(im); }
      const entries = P.registerInstances(root, list, 'solid', { name });
      R.sets.push({ name, seed: name.length * 7, list, meshes, entries, register: () => P.registerInstances(root, list, 'solid', { name }) });
      return { meshes, entries };
    };
    const rr = mulberry(4242 + 17);
    { // flat boulders: scattered + next to big boulders (NATURE: Poly Haven rock_09 / rock_07 slabs when loaded)
      const phF = R.ph && R.ph.rock_09 && R.ph.rock_07 ? [phModel(R.ph.rock_09, 1.25), phModel(R.ph.rock_07, 1.4)] : null;
      const g = phF ? phF[0] : R.flat, root = g.scene; root.updateMatrixWorld(true); const b3 = new THREE.Box3().setFromObject(root), list = [];
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
      const fp = { desat: 0.8, grade: [0.5, 0.52, 0.57], lichen: 0.6, snow: 1, cap: 0.2 };
      if (phF) {   // every 3rd slot → rock_07 (thicker block), scaled to the same footprint as the rock_09 slab it replaces
        const bA = new THREE.Box3().setFromObject(phF[0].scene), bB = new THREE.Box3().setFromObject(phF[1].scene);
        const la = [], lb = []; list.forEach((M, k) => { if (k % 3 === 2) { M.elements[13] += (bA.min.y - bB.min.y) * Math.hypot(M.elements[4], M.elements[5], M.elements[6]); lb.push(M); } else la.push(M); });
        R.flatMesh = addModel(phF[0], 'rock_flat', la, fp); if (lb.length) R.flatMesh2 = addModel(phF[1], 'rock_flat_b', lb, fp);
        D.rocksFlat = la.concat(lb); VEG.stats.rockScans = 'polyhaven';
      } else { R.flatMesh = addModel(g, 'rock_flat', list, fp); D.rocksFlat = list; }
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
      R.faceMesh = addModel(g, 'rock_outcrop', list, { desat: 0.7, grade: [0.55, 0.6, 0.72], lichen: 0.6, snow: 1, cap: 0.22 });
      D.rocksOutcrop = list;
    }
    reseatRocks('placed');
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
        if (C.SHADOW && C.SHADOW.on) { if (o.castShadow !== s.cs0 && s.csSet === o.castShadow) o.castShadow = s.cs0; s.csSet = o.castShadow; }   // cached shadows: cast distance is the cache's job (vs its centre)
        else if (s.cs0 && (!o.isInstancedMesh || o.frustumCulled)) {
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
            // layers 20–22 belong to the cached moon shadows (open-world SHADOW): never part of the owner's baseline
            const SHB = 7 << 20, cur = o.layers.mask & ~SHB, keep = o.layers.mask & SHB;
            // owner changed layers: take over ONLY the bits the owner flipped. Before, the whole current mask became the
            // baseline — if the object was tiny-hidden at that moment (layer 0 off, e.g. seen from far at load) and
            // another module then enabled a layer of its own (groundblend 12, terrain contact), layer 0 was lost for
            // good: the object stayed out of the main pass forever while still casting its cached shadow (TEXUNITS.md)
            if (s.maskSet !== undefined && cur !== s.maskSet) { const diff = cur ^ s.maskSet; s.mask0 = s.mask0 === undefined ? cur : (s.mask0 & ~diff) | (cur & diff); }
            if (s.mask0 === undefined) s.mask0 = cur;
            const want = tiny ? (s.mask0 & ~1) : s.mask0;
            if (cur !== want) o.layers.mask = want | keep; s.maskSet = want; if (tiny) hid++;
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
  let tAcc = 0;
  function update(dt, ctx) {
    tAcc += dt;
    U.uVT.value = tAcc; U.uVStorm.value = (C.WX && C.WX.storm) || 0; U.uVCam.value.copy(camera.position);
    U.uVTexBias.value = C.Q.texBias || 0;
    U.uVAlphaAA.value = C.Q.needleAABias || 0;   // NEEDLE-AA: >0 only in air (KNOBS)
    { const an = Math.min(C.Q.aniso || 4, renderer.capabilities.getMaxAnisotropy());   // NATURE: Q.aniso on the vegetation maps
      if (an !== VEG.aniso) { VEG.aniso = an; for (const t of Object.values(TEX).concat([A.tuft, A.leaf, A.decal].filter(Boolean).map((r) => r.texture))) if (t && t.anisotropy !== an) { t.anisotropy = an; if (t.image) t.needsUpdate = !t.isRenderTargetTexture; } } }
    if (C.MOON_DIR) U.uVMoonDir.value.copy(C.MOON_DIR);
    if (C.moon) U.uVMoonCol.value.copy(C.moon.color).multiplyScalar(C.moon.intensity / Math.PI);
    if (C.hemi) U.uVHemiS.value.copy(C.hemi.color).multiplyScalar(C.hemi.intensity / Math.PI);
    while (A.queue.length) A.queue.shift()();
    adoptGameTrees();
    if (!F.mid && VEG.ready.vegSet && ((F.adopted[0] && F.adopted[1] && F.adopted[2]) || tAcc > 40)) buildImpostors();
    updateForest();
    rocksStep();
    // the terrain re-stamps its drifts when the set of solids changes (our rocks included): re-seat against the new snow
    { const TS = window.Terrain && window.Terrain.S; if (R.done && R.sets && TS && TS.obstKey && TS.obstKey !== R.seatKey && !TS.obstPending) { R.seatKey = TS.obstKey; reseatRocks('drifts ' + TS.obstKey); } }
    updateGround();
    autoBump(dt);
    director(dt);
  }

  if (/[?&]noveg\b/.test(location.search)) return;   // A/B switch for the bench: open-world.html?noveg
  (window.GameModules = window.GameModules || []).push({ name: 'vegetation', order: -10, init, update });
})();
