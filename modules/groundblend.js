/* Module "groundblend" — ONE rule for how every object meets the snow (GROUNDBLEND.md).
 *
 * Before: each object met the snow through its own ad-hoc rule or none (a skirt on some materials, read from a 0.88 m
 * nearest-texel height grid → stair-stepped; a separate sink per vegetation kind; no contact darkening once GTAO went).
 * Now every lit static material in the scene is patched once, automatically, by the same shader chunk:
 *
 *   1. snow skirt   fragments near the snow surface blend into snow (albedo, roughness, normal) with a noisy edge whose
 *                   height follows the local loose-snow depth — the base reads as embedded, no crisp cut line
 *   2. snow on top  terrain's snowCover (ctx.snowCover) on every static prop/rock/structure that lacked it, and its top
 *                   term is multiplied by a sky-visibility term (less snow under overhangs)
 *   3. contact AO   objects: darkening near the snow line from the same world AO field the ground uses (+ an analytic
 *                   band beyond the field) · ground: a world-space AO ring around every static object, sampled by the
 *                   terrain materials (chained onBeforeCompile, like baked.js — terrain.js itself is not edited)
 *   4. grime        structures: a noisy grime / meltwater band just above the snow line (ground-contact weathering)
 *   5. vegetation   modules/vegetation.js aligns tufts/shrubs/decals per vertex to the same snow surface on the GPU
 *                   (GroundBlend.glslVertex), sunk like before but onto the drawn surface instead of the physics one
 *
 * Data (all world-anchored around the player, 96 m window, 256² texels = 0.375 m):
 *   CPU surface   ctx.snowField (hook, see below) › ctx.snowSurfaceAt (terrain: exactly what the terrain draws) ›
 *                 groundH + snowDepthAt. RG32F toroidal DataTexture (R surface y, G loose depth), rolling refresh.
 *   top map       orthographic top-down render of the static objects (layer 12) → highest object y per texel
 *   field tGb     one combine pass → RGBA32F: R surface y · G ground AO (horizon test over 24 taps ≤ 2 m) · B top y · A depth
 *   far           beyond the window objects fall back to terrain's own tDD (smooth height + depth, bilinear)
 *
 * Hook for the terrain agent: if `ctx.snowField` appears as `{ sample(x, z) → [surfaceY, depth] }` it replaces the CPU
 * sampler (one line: see surfaceSampler()).
 *
 * Knobs: Q.gb (on), Q.gbAniso (texture anisotropy on patched materials). A/B: `?off=gb` or `GroundBlend.setOn(false)`.
 * Chaining: my onBeforeCompile wrapper injects only while it is the material's outermost onBeforeCompile; the 0.5 s
 * scan re-wraps a material another module chained after me (one recompile) — so I always see the final shader text
 * (snowCover's chunk, baked.js lightmaps, vegetation's SAFE_END) and never apply twice.
 */
(function () {
  'use strict';
  const OFF = new Set(((/[?&]off=([^&#]*)/.exec(location.search) || [])[1] || '').split(','));
  const GB = window.GroundBlend = { on: !OFF.has('gb'), ready: false, stats: { patched: 0, terrain: 0, snowAdded: 0, rewrapped: 0, aniso: 0, errors: [], cpuMs: 0, topMs: 0, fills: 0, tops: 0 }, mats: [] };
  let C, THREE, R;
  const N = 256, T = 0.375, SIZE = N * T, SNAP = 16 * T, LAYER = 12, LAYER_SHRUB = 13, LAYER_TUFT = 14, KEY = 'gb1';

  /* ------------------------------------------------------------------ shared uniforms (exist before any compile) */
  const U = GB.U = {
    tGb: { value: null }, tGbSh: { value: null }, uGbWin: { value: null }, uGbOn: { value: 0 },
    tGbFar: { value: null }, uGbFar: { value: null },   // terrain tDD (whole island): x = W, y = on
    uGbSnowC: { value: null },
  };

  /* ------------------------------------------------------------------ GLSL */
  const GLSL_NOISE = `
    float gbHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float gbVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(gbHash(i), gbHash(i + vec2(1., 0.)), f.x), mix(gbHash(i + vec2(0., 1.)), gbHash(i + vec2(1., 1.)), f.x), f.y); }`;
  const GLSL_FIELD = `
    uniform sampler2D tGb; uniform vec4 uGbWin; uniform float uGbOn;
    // near field: R surface y, G ground AO, B top y, A loose depth; w = 1 inside the window, fading at its edge
    vec4 gbField(vec2 xz, out float w){ vec2 uv = (xz - uGbWin.xy) / uGbWin.z; vec2 e = min(uv, 1. - uv);
      w = smoothstep(0., uGbWin.w, min(e.x, e.y)) * uGbOn; return texture(tGb, uv); }`;
  // vertex-stage surface (vegetation alignment): near field, else terrain tDD, else no data (returns -1e4)
  const GLSL_VERTEX = `
    uniform sampler2D tGb, tGbFar; uniform vec4 uGbWin; uniform float uGbOn; uniform vec2 uGbFar;
    vec2 gbSurfV(vec2 xz){   // x: surface y, y: loose depth
      vec2 uv = (xz - uGbWin.xy) / uGbWin.z; vec2 e = min(uv, 1. - uv); float w = smoothstep(0., uGbWin.w, min(e.x, e.y)) * uGbOn;
      vec2 s = vec2(-1e4, 0.);
      if (uGbFar.y > .5) { vec4 f = textureLod(tGbFar, (xz + uGbFar.x * .5) / uGbFar.x, 0.); s = vec2(f.x + f.y + f.z, f.z); }
      else if (w < .999) return w > 0. ? textureLod(tGb, uv, 0.).ra : s;
      if (w > 0.) s = mix(s, textureLod(tGb, uv, 0.).ra, w);
      return s; }`;
  GB.glslVertex = GLSL_VERTEX;
  GB.attachVertex = (sh) => { Object.assign(sh.uniforms, { tGb: U.tGb, tGbFar: U.tGbFar, uGbWin: U.uGbWin, uGbOn: U.uGbOn, uGbFar: U.uGbFar }); return GLSL_VERTEX; };

  const VERT_W = `
    { vec4 gbp = vec4(transformed, 1.);
      #ifdef USE_BATCHING
        gbp = batchingMatrix * gbp;
      #endif
      #ifdef USE_INSTANCING
        gbp = instanceMatrix * gbp;
      #endif
      vGbW = (modelMatrix * gbp).xyz; }`;

  // uGbM: x skirt base (m), y skirt per m of loose depth, z AO strength, w AO reach (m) · uGbM2: x grime, y sky-occlusion use, z skirt amount
  function fragHead(sc, far) {
    return `
    uniform vec4 uGbM, uGbM2; uniform vec3 uGbSnowC;
    ${!sc && far ? 'uniform sampler2D tScDD; uniform float uScW;' : ''}
    varying vec3 vGbW;
    ${GLSL_NOISE}
    ${GLSL_FIELD}`;
  }
  // early in main(): surface / depth / sky / noise at this fragment (used by snowCover's top term, the skirt and AO)
  const FRAG_EARLY = (far) => `
    float gbDh = 1e3, gbDep = 0., gbSky = 1., gbAoF = 1., gbW = 0.;
    float gbNz = gbVN(vGbW.xz * 2.3 + vGbW.y * 1.7) * .6 + gbVN(vGbW.xz * .61 - vGbW.y * .5) * .4;
    if (uGbOn > .5) {
      vec4 gq = gbField(vGbW.xz, gbW);
      ${far ? `vec4 gf = texture(tScDD, (vGbW.xz + uScW * .5) / uScW); float gSurf = mix(gf.x + gf.y + gf.z, gq.r, gbW); gbDep = mix(gf.z, gq.a, gbW);
      gbDh = vGbW.y - gSurf;` : `if (gbW > 0.) { gbDh = vGbW.y - gq.r; gbDep = gq.a; }`}
      gbSky = 1. - smoothstep(.7, 1.8, gq.b - vGbW.y) * gbW * uGbM2.y;
      gbAoF = mix(1., gq.g, gbW);
    }`;
  // after snowCover's block, before emissive: the skirt (+ grime band for structures)
  const FRAG_SKIRT = (sc) => `
    if (gbDh < 3.) {
      vec3 gbWN = normalize((vec4(normal, 0.) * viewMatrix).xyz);
      float gbBand = uGbM.x + uGbM.y * clamp(gbDep, 0., .45);
      // height blend: snow fills to ≈ band with a noisy, fairly crisp edge (crevices and up-facing ledges first, bumps
      // poke through) — a partial blend over the whole band reads as a pale haze skirt, not as snow piled against it
      float gbL = dot(diffuseColor.rgb, vec3(.3, .55, .15));
      float gbE = gbDh - gbBand * (.75 + (gbNz - .5) * 1.1) - max(gbWN.y, 0.) * gbBand * .45 + (gbL - .2) * .25 * gbBand;
      float gbSk = (1. - smoothstep(-.35 * gbBand, .12 * gbBand, gbE)) * smoothstep(.012, .07, gbDep) * smoothstep(-.7, -.2, gbWN.y) * uGbM2.z;
      if (uGbM2.x > 0.) {   // grime / meltwater band just above the snow line, broken into vertical streaks
        float gs = gbVN(vec2(dot(vGbW.xz, vec2(.8, .6)) * 3.1, vGbW.y * .35)) * .7 + gbVN(vGbW.xz * 7.3) * .3;
        float gr = (1. - smoothstep(.05, .45 + gs * .9, gbDh)) * smoothstep(-.05, .06, gbDh) * uGbM2.x;
        diffuseColor.rgb *= 1. - gr * (.22 + .18 * gs);
        #ifdef STANDARD
          roughnessFactor = min(1., roughnessFactor + gr * .15);
        #endif
      }
      if (gbSk > .002) {
        ${sc ? `vec2 gsuv = vGbW.xz * (1. / 3.4) + vGbW.y * .07, gdx = dFdx(gsuv), gdy = dFdy(gsuv);
        vec3 gsA = textureGrad(tScD, gsuv, gdx, gdy).rgb * vec3(.97, .985, 1.) * (.88 + .24 * gbNz);
        vec3 gsN = textureGrad(tScN, gsuv, gdx, gdy).rgb;` : `vec3 gsA = uGbSnowC * (.88 + .24 * gbNz); vec3 gsN = vec3(.5, .5, .8);`}
        diffuseColor.rgb = mix(diffuseColor.rgb, gsA, gbSk);
        #ifdef STANDARD
          roughnessFactor = mix(roughnessFactor, gsN.z, gbSk); metalnessFactor = mix(metalnessFactor, 0., gbSk);
        #endif
        vec3 gbUp = normalize((viewMatrix * vec4(vec3(gsN.x * 2. - 1., 1.8, gsN.y * 2. - 1.), 0.)).xyz);
        normal = normalize(mix(normal, gbUp, gbSk * .85));
      }
    }`;
  // after aomap: contact darkening (indirect fully, direct partly — what GTAO used to give)
  const FRAG_AO = `
    {
      float gbC = 1. - smoothstep(0., uGbM.w, max(gbDh, 0.));                  // 1 at the snow line → 0 at the reach
      float gbA = 1. - uGbM.z * gbC;                                           // analytic band (beyond the field too)
      gbA = min(gbA, mix(1., gbAoF, gbC));                                     // the ground's own AO field: seamless across the contact line
      #ifdef USE_LIGHTMAP
        gbA = mix(1., gbA, .55);                                               // baked objects already carry part of it
      #endif
      gbA = mix(1., max(gbA, .35), uGbOn);
      reflectedLight.indirectDiffuse *= gbA; reflectedLight.indirectSpecular *= gbA;
      reflectedLight.directDiffuse *= mix(1., gbA, .3);
    }`;
  // terrain: the ground ring. Sampled per VERTEX: the terrain's fragment stage already uses all 16 texture units on this
  // GPU (TR_DETAIL + baked: a fragment sampler failed to link, measured), the vertex stage has 13 free. The detail rings
  // are 0.22 / 0.44 / 0.88 m grids within ±10 / 21 / 42 m — finer than the 0.375 m field where it is seen; faded by 55 m.
  const TER_V = `
    { vec2 guv = (vGbW.xz - uGbWin.xy) / uGbWin.z; vec2 ge = min(guv, 1. - guv);
      float gw = smoothstep(0., uGbWin.w, min(ge.x, ge.y)) * uGbOn * smoothstep(55., 38., distance(vGbW, cameraPosition));
      vGbAO = mix(1., textureLod(tGb, guv, 0.).g, gw); vGbSh = mix(1., textureLod(tGbSh, guv, 0.).r, gw); }`;
  const TER_AO = `
    reflectedLight.indirectDiffuse *= vGbAO; reflectedLight.indirectSpecular *= vGbAO;
    reflectedLight.directDiffuse *= mix(1., vGbAO, .4) * vGbSh; reflectedLight.directSpecular *= mix(1., vGbAO, .4) * vGbSh;`;

  /* ------------------------------------------------------------------ material classes */
  const CLS = {   // m: skirt base, skirt/m depth, AO strength, AO reach · m2: grime, sky use, skirt amount, cap threshold
    rock:   { m: [0.07, 0.9, 0.32, 0.45], m2: [0.0, 0.5, 1, 0.5], snow: { amount: 0.75, minUp: 0.55, soft: 0.22, skirt: 0 } },
    struct: { m: [0.09, 1.0, 0.3, 0.7], m2: [1.0, 0.8, 1, 0.62], snow: { amount: 0.85, minUp: 0.66, soft: 0.15, skirt: 0 } },
    prop:   { m: [0.035, 0.45, 0.3, 0.4], m2: [0.0, 0.8, 0.8, 0.62], snow: { amount: 0.7, minUp: 0.66, soft: 0.15, skirt: 0 } },
    bark:   { m: [0.05, 1.1, 0.25, 0.4], m2: [0.0, 0.0, 1, 0.7], snow: null },
    ice:    { m: [0.04, 0.6, 0.2, 0.5], m2: [0.0, 0.0, 0.7, 0.7], snow: null },
  };
  const RX_SKIP = /^(veg_tufts|veg_shrub|veg_decal|veg_tree_imp)|needles|leaves|mountain|crystal|shard|heart|glow|beam|rune|scan|ring|objective|marker|bolt|fx_|spark|flag|wire|cord|rope|cable|guy_|glass|window|lamp_glow|smoke|aurora|sky|moon|star/i;
  const RX_TER = /^(terrain|terrain_detail|sea|lake|ice_hole|wf_seaIce)/i;
  function nameChain(o, m) { let s = (m && m.name || '') + '|' + (o.userData && o.userData.source || ''); for (let q = o, k = 0; q && k < 4; q = q.parent, k++) s += '|' + (q.name || '') + '|' + (q.userData && q.userData.source || ''); return s; }
  function dynamicRoots() {
    const out = []; const add = (g) => { if (g && g.isObject3D) out.push(g); };
    const p = C.player; add(p && p.c && p.c.g); add(C.AV && C.AV.player && C.AV.player.root);
    add(C.fox && (C.fox.g || C.fox.root)); for (const s of C.STAGS || []) add(s.g || s.root);
    for (const e of C.enemies || []) add(e.g || e.mesh); add(C.boss && (C.boss.g || C.boss.root)); add(C.sk && (C.sk.g || C.sk.root));
    return out;
  }
  const flatRoots = () => [C.sea, C.lakeIce, C.fpMesh, C.WORLD_TERRAIN && C.WORLD_TERRAIN.mesh].filter((g) => g && g.isObject3D);   // sea / lake ice / footprints / terrain
  function under(o, roots) { for (let q = o; q; q = q.parent) if (roots.includes(q)) return true; return false; }
  function classify(o, m, roots) {
    if (!m || m.isShaderMaterial || m.isMeshBasicMaterial || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return null;
    if (o.isSkinnedMesh || (m.transparent && !m.alphaTest) || m.depthWrite === false || m.userData.gbSkip || o.userData.gbSkip) return null;
    const n = nameChain(o, m);
    if (RX_TER.test(o.name || '')) return null;
    if (/bark/i.test(n) && /veg_tree/i.test(n)) return 'bark';
    if (/(^|\|)veg_/.test(n)) return null;              // tufts / shrubs / decals / impostors: vegetation.js aligns them itself
    if (RX_SKIP.test(n) || /snowmobile/i.test(n)) return null;
    if (under(o, roots) || under(o, flatRoots())) return null;
    if (!o.isInstancedMesh && o.geometry) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere && g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > 400) return null; }
    if (/iceberg|ice_chunk|pressure_ridge|rubble/i.test(n)) return 'ice';
    if (/rock|boulder|stone|cairn|inuksuk|ruin|altar|echo|plinth|firepit|outcrop|golem/i.test(n)) return 'rock';
    if (/crate|drum|barrel|tank|generator|jerrycan|clutter|debris|wood|log|stump|sledge|seat|case|cutter|pole/i.test(n)) return 'prop';
    return 'struct';
  }

  /* ------------------------------------------------------------------ patching (chained, outermost-only) */
  const PARAMS = new WeakMap();      // material → { cls, u }
  function wrap(mat, cls) {
    let P = PARAMS.get(mat);
    if (!P) {
      const c = CLS[cls];
      P = { cls, u: { uGbM: { value: new THREE.Vector4(...c.m) }, uGbM2: { value: new THREE.Vector4(...c.m2) } } };
      PARAMS.set(mat, P);
    }
    let prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    if (prev && prev.__gb && prev.__gbMat === mat) { prev = prev.__gbPrev; prevKey = prevKey && prevKey.__gbPrev; }   // re-wrap of my own outermost wrapper
    const params = P;
    const fn = function (sh, r) {
      const self = this || mat;                          // some chains call prev(sh, r) without a receiver
      if (prev) prev.call(self, sh, r);
      if (self.onBeforeCompile !== fn) return;           // not outermost: the outer wrapper does the work
      try { inject(sh, PARAMS.get(self) || params); } catch (e) { GB.stats.errors.push('inject ' + (self.name || self.type) + ': ' + e.message); }
    };
    fn.__gb = true; fn.__gbPrev = prev; fn.__gbMat = mat;
    const key = function () { return (prevKey ? prevKey.call(this || mat) : '') + '|' + KEY + (GB.on ? '1' : '0'); };
    key.__gbPrev = prevKey;
    mat.onBeforeCompile = fn; mat.customProgramCacheKey = key; mat.needsUpdate = true;
    return fn;
  }
  function inject(sh, P) {
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    if (!GB.on || fs.includes('GB_PATCHED')) return;
    if (!vs.includes('#include <fog_vertex>') || !fs.includes('#include <aomap_fragment>') || !fs.includes('#include <emissivemap_fragment>')) { GB.stats.errors.push('anchors missing: ' + sh.shaderName); return; }
    const sc = fs.includes('uniform sampler2D tScD, tScN, tScDD');   // terrain snowCover chunk present: reuse its samplers
    const far = sc || !!U.tGbFar.value;
    Object.assign(sh.uniforms, P.u, { tGb: U.tGb, uGbWin: U.uGbWin, uGbOn: U.uGbOn, uGbSnowC: U.uGbSnowC });
    if (!sc && far) Object.assign(sh.uniforms, { tScDD: U.tGbFar, uScW: { get value() { return U.uGbFar.value.x; } } });
    vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vGbW;').replace('#include <fog_vertex>', '#include <fog_vertex>' + VERT_W);
    fs = fs.replace('#include <common>', '#include <common>\n// GB_PATCHED\n' + fragHead(sc, far));
    if (sc) {   // snowCover: top snow × sky visibility; its own (nearest-texel) skirt replaced by ours
      // one cap rule: threshold at most the class's (rocks .5 — boulder tops at 30–40° hold snow, d01/d04), × sky
      fs = fs.replace('smoothstep(uScP.x, uScP.x + uScP.y,', 'smoothstep(min(uScP.x, uGbM2.w), min(uScP.x, uGbM2.w) + uScP.y,')
        .replace('* uScAmt;', '* max(uScAmt, .55) * gbSky;').replace('if (uScP.z > 0.)', 'if (false)');
    }
    fs = fs.replace(/void main\(\)\s*\{/, (m) => m + '\n' + FRAG_EARLY(far))
      .replace('#include <emissivemap_fragment>', FRAG_SKIRT(sc) + '\n#include <emissivemap_fragment>')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO);
    sh.vertexShader = vs; sh.fragmentShader = fs;
  }
  // terrain materials: ground AO ring only (one extra sampler)
  const TWRAP = new WeakSet();
  function wrapTerrain(mat) {
    if (TWRAP.has(mat) && mat.onBeforeCompile && mat.onBeforeCompile.__gbT) return false;
    let prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    if (prev && prev.__gbT && prev.__gbMat === mat) { prev = prev.__gbPrev; prevKey = prevKey && prevKey.__gbPrev; }
    const fn = function (sh, r) {
      const self = this || mat;
      if (prev) prev.call(self, sh, r);
      if (self.onBeforeCompile !== fn || !GB.on || GB.terrainOff || sh.fragmentShader.includes('GB_TER')) return;
      if (!sh.fragmentShader.includes('#include <aomap_fragment>') || !sh.vertexShader.includes('#include <fog_vertex>')) { GB.stats.errors.push('terrain anchors missing'); return; }
      Object.assign(sh.uniforms, { tGb: U.tGb, tGbSh: U.tGbSh, uGbWin: U.uGbWin, uGbOn: U.uGbOn });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n// GB_TER\nuniform sampler2D tGb, tGbSh; uniform vec4 uGbWin; uniform float uGbOn; vec3 vGbW; varying float vGbAO, vGbSh;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>' + VERT_W + TER_V);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n// GB_TER\nvarying float vGbAO, vGbSh;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + TER_AO);
    };
    fn.__gbT = true; fn.__gbPrev = prev; fn.__gbMat = mat;
    const key = function () { return (prevKey ? prevKey.call(this || mat) : '') + '|gbT3' + (GB.on && !GB.terrainOff ? '1' : '0'); };
    key.__gbPrev = prevKey;
    mat.onBeforeCompile = fn; mat.customProgramCacheKey = key; mat.needsUpdate = true; TWRAP.add(mat);
    return true;
  }
  function terrainMats() {
    const out = []; const T0 = C.WORLD_TERRAIN && C.WORLD_TERRAIN.mesh; if (T0 && T0.material) out.push(T0.material);
    const d = C.scene.getObjectByName('terrain_detail'); if (d) d.traverse((o) => { if (o.isMesh && o.material) out.push(o.material); });
    return out;
  }
  function setAniso(mat) {
    const a = Math.min(C.Q.gbAniso || 8, R.capabilities.getMaxAnisotropy());
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap']) {
      const t = mat[k]; if (t && t.isTexture && !t.isRenderTargetTexture && t.anisotropy < a) { t.anisotropy = a; t.needsUpdate = true; GB.stats.aniso++; }
    }
  }

  /* ------------------------------------------------------------------ scan: find + (re)patch materials, mark top-map casters */
  const SEEN = new WeakMap();   // material → wrapper I installed last
  function scan() {
    const roots = dynamicRoots(); let changed = false;
    C.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        let P = PARAMS.get(m), cls = P && P.cls;
        if (!P) { if (SEEN.has(m)) continue; cls = classify(o, m, roots); if (!cls) { SEEN.set(m, null); continue; } }
        if (!P) {
          const c = CLS[cls];
          if (c.snow && !m.userData.trSnow && C.snowCover) { C.snowCover(m, c.snow); GB.stats.snowAdded++; }
          setAniso(m);
          SEEN.set(m, wrap(m, cls)); GB.stats.patched++; GB.mats.push(new WeakRef(m)); changed = true;
        } else if (m.onBeforeCompile !== SEEN.get(m) && !(m.onBeforeCompile && m.onBeforeCompile.__gb && m.onBeforeCompile.__gbMat === m)) {
          SEEN.set(m, wrap(m, cls)); GB.stats.rewrapped++;     // another module chained after me: stay outermost
        }
        if (cls && cls !== 'ice' && !o.layers.isEnabled(LAYER)) { o.layers.enable(LAYER); changed = true; }
      }
    });
    for (const o of C.scene.children) {   // vegetation pools (camera-centred InstancedMeshes): soft occluders in the top map
      const L = o.isInstancedMesh && (/^veg_shrub_(leaves|twigs)$/.test(o.name) ? LAYER_SHRUB : o.name === 'veg_tufts' ? LAYER_TUFT : 0);
      if (L && !o.layers.isEnabled(L)) { o.layers.enable(L); changed = true; }
    }
    for (const m of terrainMats()) if (wrapTerrain(m)) GB.stats.terrain++;
    return changed;
  }

  /* ------------------------------------------------------------------ CPU surface (toroidal RG32F) */
  const CPU = { data: null, tex: null, cx: NaN, cz: NaN, queue: [], row: 0, dirty: false, upT: 0 };
  function surfaceSampler() {
    const f = C.snowField;   // hook: the terrain agent's object-driven deformation field, when it exists
    if (f && typeof f.sample === 'function') return (x, z) => f.sample(x, z);
    const ss = typeof C.snowSurfaceAt === 'function' ? C.snowSurfaceAt : null, sd = typeof C.snowDepthAt === 'function' ? C.snowDepthAt : () => 0;
    return (x, z) => { const d = sd(x, z); return [ss ? ss(x, z) : C.groundH(x, z) + d, d]; };
  }
  const wrapI = (g) => ((g % N) + N) % N;
  // fill world texel rect [gx0, gx1) × [gz0, gz1) (world texel indices), time-boxed; returns true when done
  function fillRect(r, budgetMs) {
    const t0 = performance.now(), S = surfaceSampler(), D = CPU.data;
    while (r.gz < r.gz1) {
      const j = wrapI(r.gz), z = (r.gz + 0.5) * T;
      for (let gx = r.gx0; gx < r.gx1; gx++) { const s = S((gx + 0.5) * T, z), k = (j * N + wrapI(gx)) * 2; D[k] = s[0]; D[k + 1] = s[1]; }
      r.gz++; CPU.dirty = true;
      if (performance.now() - t0 > budgetMs) return false;
    }
    return true;
  }
  function recentre(px, pz, force) {
    const cx = Math.round(px / SNAP) * SNAP, cz = Math.round(pz / SNAP) * SNAP;
    if (!force && cx === CPU.cx && cz === CPU.cz) return false;
    const g0x = Math.round((cx - SIZE / 2) / T), g0z = Math.round((cz - SIZE / 2) / T);
    if (force || !isFinite(CPU.cx) || Math.abs(cx - CPU.cx) >= SIZE || Math.abs(cz - CPU.cz) >= SIZE) CPU.queue = [{ gx0: g0x, gx1: g0x + N, gz: g0z, gz1: g0z + N }];
    else {   // only the newly exposed strips
      const o0x = Math.round((CPU.cx - SIZE / 2) / T), o0z = Math.round((CPU.cz - SIZE / 2) / T);
      if (g0x > o0x) CPU.queue.unshift({ gx0: o0x + N, gx1: g0x + N, gz: g0z, gz1: g0z + N });
      if (g0x < o0x) CPU.queue.unshift({ gx0: g0x, gx1: o0x, gz: g0z, gz1: g0z + N });
      if (g0z > o0z) CPU.queue.unshift({ gx0: g0x, gx1: g0x + N, gz: o0z + N, gz1: g0z + N });
      if (g0z < o0z) CPU.queue.unshift({ gx0: g0x, gx1: g0x + N, gz: g0z, gz1: o0z });
    }
    CPU.cx = cx; CPU.cz = cz; CPU.g0x = g0x; CPU.g0z = g0z;
    return true;
  }

  /* ------------------------------------------------------------------ GPU: top map + combine */
  const G = GB._G = {};
  function initGPU() {
    CPU.data = new Float32Array(N * N * 2);
    CPU.tex = new THREE.DataTexture(CPU.data, N, N, THREE.RGFormat, THREE.FloatType);
    CPU.tex.wrapS = CPU.tex.wrapT = THREE.RepeatWrapping; CPU.tex.minFilter = CPU.tex.magFilter = THREE.LinearFilter; CPU.tex.generateMipmaps = false; CPU.tex.needsUpdate = true;
    const rtOpt = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false };
    G.top = new THREE.WebGLRenderTarget(N, N, Object.assign({}, rtOpt, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    G.out = new THREE.WebGLRenderTarget(N, N, rtOpt);
    G.topCam = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, 1, 1200);
    G.topCam.layers.set(LAYER); G.topCam.up.set(0, 0, -1);
    const topMat = (str) => new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: `#include <common>
        #include <batching_pars_vertex>
        varying float vY;
        void main(){
          #include <batching_vertex>
          vec4 p = vec4(position, 1.);
          #ifdef USE_BATCHING
            p = batchingMatrix * p;
          #endif
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          vec4 w = modelMatrix * p; vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: 'varying float vY; void main(){ gl_FragColor = vec4(vY, ' + str.toFixed(2) + ', 0., 1.); }',
    });
    // passes: solids (full occluders) · shrubs · tufts (soft occluders: a bush over snow shades a patch under it)
    G.passes = [[LAYER, topMat(1)], [LAYER_SHRUB, topMat(0.85)], [LAYER_TUFT, topMat(0.3)]];
    G.cmb = new THREE.ShaderMaterial({
      uniforms: { tCpu: { value: CPU.tex }, tTop: { value: G.top.texture }, uWin: { value: new THREE.Vector4() }, uCpuS: { value: 1 / (N * T) } },
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `precision highp float;
        uniform sampler2D tCpu, tTop; uniform vec4 uWin; uniform float uCpuS; varying vec2 vUv;
        void main(){
          vec2 xz = uWin.xy + vUv * uWin.z;
          vec2 c = texture(tCpu, xz * uCpuS).rg; vec2 tuv = vec2(vUv.x, 1. - vUv.y); vec2 tc = texture(tTop, tuv).rg; float s = c.r, top = tc.r;   // top camera: screen up = −z
          // horizon test over two golden-angle spirals: 16 taps ≤ 2 m (rocks, walls, buildings) and 8 taps ≤ 0.6 m (bushes,
          // tufts, small props): how much sky the objects around take from this ground point
          float occL = 0., wL = 0., occS = 0., wS = 0.;
          for (int k = 0; k < 16; k++) {
            float fk = float(k) + .5, r = sqrt(fk / 16.) * 2., a = fk * 2.39996; vec2 o = vec2(cos(a), sin(a)) * r;
            vec2 t = texture(tTop, tuv + vec2(o.x, -o.y) / uWin.z).rg; float h = max(0., t.r - s - .03);
            float w = 1. - r / 2.5; occL += w * clamp(h / (r * .9 + .12), 0., 1.) * t.g; wL += w;
          }
          for (int k = 0; k < 8; k++) {
            float fk = float(k) + .5, r = sqrt(fk / 8.) * .6, a = fk * 2.39996 + 1.1; vec2 o = vec2(cos(a), sin(a)) * r;
            vec2 t = texture(tTop, tuv + vec2(o.x, -o.y) / uWin.z).rg; float h = max(0., t.r - s - .02);
            occS += clamp(h / (r * .7 + .06), 0., 1.) * t.g; wS += 1.;
          }
          float ao = 1. - .6 * max(occL / wL, occS / wS * .8);
          ao = min(ao, mix(1., .55, smoothstep(.03, .3, top - s) * tc.g));   // under an object / an elevated floor
          gl_FragColor = vec4(s, clamp(ao, .45, 1.), top, c.g);
        }`,
    });
    // soft moon shadows of the vegetation (it casts none in the shadow maps: too many cards to redraw) — a height-field
    // ray march toward the moon through the top map, soft occluders only (solids have real shadow maps). Terrain only.
    G.shRT = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false });
    G.shMat = new THREE.ShaderMaterial({
      uniforms: { tCpu: { value: CPU.tex }, tTop: { value: G.top.texture }, uWin: G.cmb.uniforms.uWin, uCpuS: G.cmb.uniforms.uCpuS, uMoon: { value: new THREE.Vector3(0.3, 0.8, 0.2) } },
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `precision highp float;
        uniform sampler2D tCpu, tTop; uniform vec4 uWin; uniform float uCpuS; uniform vec3 uMoon; varying vec2 vUv;
        void main(){
          vec2 xz = uWin.xy + vUv * uWin.z; float s = texture(tCpu, xz * uCpuS).r;
          vec2 d = normalize(uMoon.xz + 1e-5); float k = uMoon.y / max(length(uMoon.xz), .05), sh = 0.;
          for (int i = 1; i <= 10; i++) {
            float t = float(i) * .17; vec2 q = (xz + d * t - uWin.xy) / uWin.z;
            vec2 o = texture(tTop, vec2(q.x, 1. - q.y)).rg;
            if (o.g < .95) sh = max(sh, smoothstep(0., .06, o.r - (s + k * t)) * o.g * (1. - t / 2.2));
          }
          gl_FragColor = vec4(1. - .6 * sh, 0., 0., 1.);
        }`,
    });
    G.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), G.cmb); G.quad.frustumCulled = false;
    G.qScene = new THREE.Scene(); G.qScene.add(G.quad); G.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    U.tGb.value = G.out.texture; U.tGbSh.value = G.shRT.texture;
  }
  function renderTop() {
    const t0 = performance.now(), sc = C.scene, sm = R.shadowMap, bg = sc.background, ov = sc.overrideMaterial, rt = R.getRenderTarget(), au = sm.autoUpdate, nu = sm.needsUpdate;
    const cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(), ac = R.autoClear;
    G.topCam.position.set(CPU.cx, 600, CPU.cz); G.topCam.lookAt(CPU.cx, 0, CPU.cz); G.topCam.updateMatrixWorld();
    try {
      sm.autoUpdate = false; sm.needsUpdate = false; sc.background = null;
      R.setRenderTarget(G.top); R.setClearColor(0x000000, 1); R.autoClear = false;
      R.setClearColor(new THREE.Color(-1e4, 0, 0), 1); R.clear(true, true, false);
      for (const [L, m] of G.passes) { G.topCam.layers.set(L); sc.overrideMaterial = m; R.render(sc, G.topCam); }   // no clear between: the highest surface wins
    } finally {
      sc.overrideMaterial = ov; sc.background = bg; sm.autoUpdate = au; sm.needsUpdate = nu; R.autoClear = ac; R.setClearColor(cc, ca); R.setRenderTarget(rt);
    }
    GB.stats.tops++; GB.stats.topMs = +(performance.now() - t0).toFixed(2);
  }
  function combine() {
    const rt = R.getRenderTarget();
    G.cmb.uniforms.uWin.value.set(CPU.cx - SIZE / 2, CPU.cz - SIZE / 2, SIZE, 0);
    R.setRenderTarget(G.out); G.quad.material = G.cmb; R.render(G.qScene, G.qCam);
    if (C.MOON_DIR) G.shMat.uniforms.uMoon.value.copy(C.MOON_DIR);
    R.setRenderTarget(G.shRT); G.quad.material = G.shMat; R.render(G.qScene, G.qCam); G.quad.material = G.cmb;
    R.setRenderTarget(rt);
    U.uGbWin.value.set(CPU.cx - SIZE / 2, CPU.cz - SIZE / 2, SIZE, 0.08);
  }

  /* ------------------------------------------------------------------ verification helpers (QA / GROUNDBLEND.md) */
  // every patched material: compiled? program runnable? (a failed onBeforeCompile patch otherwise falls back silently)
  GB.verify = () => {
    const out = { patched: 0, compiled: 0, notYet: 0, failed: [], withSnowCover: 0, terrainOk: 0, terrainFailed: [] };
    const progOk = (m) => { const p = R.properties.get(m); const pr = p && p.currentProgram; if (!pr) return null; return !(pr.diagnostics && pr.diagnostics.runnable === false); };
    for (const w of GB.mats) { const m = w.deref(); if (!m) continue; out.patched++; if (m.userData.trSnow) out.withSnowCover++; const ok = progOk(m); if (ok === null) out.notYet++; else if (ok) out.compiled++; else out.failed.push(m.name || m.type); }
    for (const m of terrainMats()) { const ok = progOk(m); if (ok) out.terrainOk++; else if (ok === false) out.terrainFailed.push(m.name || m.type); }
    out.shaderErrors = GB.stats.errors.slice(0, 20);
    return out;
  };
  GB.setOn = (on) => { GB.on = !!on; U.uGbOn.value = GB.on && GB.ready ? 1 : 0; for (const w of GB.mats) { const m = w.deref(); if (m) m.needsUpdate = true; } for (const m of terrainMats()) m.needsUpdate = true; };
  GB.surfaceAt = (x, z) => { const S = surfaceSampler(); return S(x, z); };
  // debug: read the field back around (x, z) → rows of 'ch' channel (0 R surf · 1 G ao · 2 B top · 3 A depth)
  GB.dbgField = (x, z, half = 6, ch = 1) => {
    const buf = new Float32Array(N * N * 4); R.readRenderTargetPixels(G.out, 0, 0, N, N, buf);
    const w = U.uGbWin.value, rows = [];
    for (let zz = z - half; zz <= z + half; zz += T * 2) { let row = ''; for (let xx = x - half; xx <= x + half; xx += T * 2) {
      const i = Math.floor((xx - w.x) / T), j = Math.floor((zz - w.y) / T); const v = i >= 0 && j >= 0 && i < N && j < N ? buf[(j * N + i) * 4 + ch] : NaN;
      row += ch === 1 ? (v > 0.97 ? '.' : v > 0.9 ? ':' : v > 0.8 ? '+' : v > 0.7 ? '*' : '#') : (v.toFixed(1) + ' '); } rows.push(row); }
    return rows;
  };

  function hookShaderErrors() {
    const dbg = R.debug; const prev = dbg.onShaderError;
    dbg.onShaderError = function (gl, program, vs, fs) {
      try {
        const src = (gl.getShaderSource(fs) || '') + (gl.getShaderSource(vs) || '');
        if (/GB_PATCHED|GB_TER/.test(src)) {
          const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(program) || '');
          GB.stats.errors.push('compile: ' + log.slice(0, 300));
          if (/GB_TER/.test(src) && !GB.terrainOff) { GB.terrainOff = true; for (const m of terrainMats()) m.needsUpdate = true; }   // e.g. out of texture units: drop the ground ring, keep the terrain
        }
      } catch (e) { /* diagnostics only */ }
      if (prev) return prev.apply(this, arguments);
      console.error('THREE.WebGLProgram: shader error', gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
    };
  }

  /* ------------------------------------------------------------------ module */
  let scanT = 0, topT = 0, needTop = true, needCmb = true;
  function init(ctx) {
    C = ctx; THREE = ctx.THREE; R = ctx.renderer;
    U.uGbWin.value = new THREE.Vector4(0, 0, 1, 0.08); U.uGbFar.value = new THREE.Vector2(ctx.W || 900, 0);
    U.uGbSnowC.value = new THREE.Vector3(0.36, 0.365, 0.38);
    for (const [k, v] of Object.entries({ low: 4, med: 8, high: 8, ultra: 16 })) if (ctx.QUALITY[k] && ctx.QUALITY[k].gbAniso === undefined) ctx.QUALITY[k].gbAniso = v;
    for (const k of Object.keys(ctx.QUALITY)) if (ctx.QUALITY[k].gb === undefined) ctx.QUALITY[k].gb = true;
    initGPU();
    hookShaderErrors();
    if (window.Terrain && Terrain.U && Terrain.U.tDD) { U.tGbFar.value = Terrain.U.tDD.value; U.uGbFar.value.set(ctx.W, 1); }
    ctx.groundBlend = GB;
    if (!GB.on) return;
    scan();
  }
  function update(dt, ctx) {
    C = ctx;
    const want = GB.on && ctx.Q.gb !== false;
    if (want !== (U.uGbOn.value > 0.5) && GB.ready) U.uGbOn.value = want ? 1 : 0;
    if (!GB.on) return;
    if (!U.tGbFar.value && window.Terrain && Terrain.U && Terrain.U.tDD) { U.tGbFar.value = Terrain.U.tDD.value; U.uGbFar.value.set(ctx.W, 1); }
    if ((scanT -= dt) <= 0) { scanT = 0.5; if (scan()) needTop = true; }
    const p = ctx.player; if (!p) return;
    if (recentre(p.x, p.z, false)) { needTop = true; needCmb = true; }
    // CPU: pending strips first (time-boxed), then a rolling refresh of one row per frame (drifts, trails)
    const t0 = performance.now();
    if (!GB.ready) { while (CPU.queue.length) { if (fillRect(CPU.queue[0], 1e9)) CPU.queue.shift(); } GB.stats.fills++; }
    else if (CPU.queue.length) { if (fillRect(CPU.queue[0], 1.5)) CPU.queue.shift(); if (!CPU.queue.length) needCmb = true; }
    else { const gz = CPU.g0z + (CPU.row = (CPU.row + 1) % N); fillRect({ gx0: CPU.g0x, gx1: CPU.g0x + N, gz, gz1: gz + 1 }, 1e9); }
    GB.stats.cpuMs = +(performance.now() - t0).toFixed(2);
    if (CPU.dirty && ((CPU.upT -= dt) <= 0 || !GB.ready || needCmb)) { CPU.tex.needsUpdate = true; CPU.dirty = false; CPU.upT = 0.25; needCmb = true; }
    if ((topT -= dt) <= 0) { topT = 3; needTop = true; }
    if (needTop) { renderTop(); needTop = false; needCmb = true; }
    if (needCmb && !CPU.queue.length) { combine(); needCmb = false; if (!GB.ready) { GB.ready = true; U.uGbOn.value = want ? 1 : 0; } }
  }
  (window.GameModules = window.GameModules || []).push({ name: 'groundblend', order: 60, init, update });
})();
