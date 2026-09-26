/* Module "baked" — offline night-light bake runtime (BAKE.md §Runtime). Ships as plain PNG (lightmaps/AO) + base64
 * JS sidecars for UV2/tree-AO (assets/baked/manifest.json ties it together) — NO KTX2/Basis/WASM/Worker: the CDN
 * Basis transcoder's own glue code calls eval()/new Function() somewhere in its Emscripten startup path, which the
 * artifact CSP's script-src blocks ('wasm-unsafe-eval' only covers WebAssembly.instantiate, not eval) — BAKED.ready
 * never became true under that CSP (see BAKE.md §A/B, INT-LIGHT.md). Plain PNGs are a normal artifact-served file
 * type and load exactly like every other texture in this game (sky.jpg, packs, …): no fetch-to-blob, no worker.
 *
 *   <script src="modules/baked.js"></script>   (after style.js, with the other modules/*.js — see open-world.html)
 * It loads assets/baked/manifest.json (same-origin fetch) and each texture by a plain THREE.TextureLoader().load(...).
 *
 * What it does (unchanged from the original KTX2 reference design, only the texture I/O differs):
 *   terrain  base mesh + the terrain module's detail rings: world-space lightmap (terrain atlas + POI tile atlas in
 *            one lookup), sampled by world XZ. Baked irradiance REPLACES hemisphere + IBL-diffuse irradiance there.
 *   objects  every unique static mesh listed in manifest.atlases: geometry → toNonIndexed() + uv1 from the UV2 pack,
 *            material clone with lightMap (channel 1, intensity π·scale), same hemi/IBL replacement.
 *   moon     baked visibility (alpha) is used by getSunShadow() where no shadow cascade covers the point
 *            (acc + rem · bakeVis) → the coarse cascade can shrink (Q.shadowDist) without losing far shadows.
 *   trees    per-part crown AO (vertex attribute on the shared BatchedMesh geometry) scales the SAME world-space
 *            ambient term as bare ground, fixing flat-card / black-core foliage (see loadTrees/patchTreeMat).
 *   knobs    BAKED.on (A/B), BAKED.k (intensity multiplier), BAKED.gtaoOff, BAKED.shadowDist, BAKED.stats.
 *
 * Texture orientation: the shipped PNGs were produced by decoding the previous wave's KTX2 bake output (Basis
 * Universal, encoded with -y_flip to counteract three's forced flipY=false on compressed textures) back to plain
 * RGBA — `basisu -unpack` dumps rows in stored (already y-flipped) order, confirmed by a round-trip test with a
 * marked test image. So every baked texture here is loaded with `flipY = false`, reproducing byte-for-byte the same
 * GPU row order the original KTX2 path used — the UV math below is untouched from the reference implementation.
 */
(function () {
  'use strict';
  const BAKED = window.BAKED = { on: true, k: 1, ready: false, stats: { terrainMats: 0, objects: 0, treeParts: 0, missing: [] }, gtaoOff: true, shadowDist: null };
  let C, THREE, man, texT = null, texTiles = null, loader = null;
  const PI = Math.PI;

  /* ---- shared chunk: the moon's cached-shadow lookup reads the baked visibility where no cascade covers ---- */
  function patchSunChunk() {
    const CH = THREE.ShaderChunk; let s = CH.shadowmap_pars_fragment;
    if (s.includes('bakeVis')) return true;
    const a = s.indexOf('\t\tfloat getSunShadow('), r = s.indexOf('\t\t\treturn acc + rem;');
    if (a < 0 || r < 0) { console.warn('[baked] getSunShadow layout changed — baked far moon shadows off'); return false; }
    s = s.slice(0, r) + '\t\t\treturn acc + rem * bakeVis;' + s.slice(r + '\t\t\treturn acc + rem;'.length);
    s = s.slice(0, a) + '\t\tfloat bakeVis = 1.0;\n' + s.slice(a);
    CH.shadowmap_pars_fragment = s; return true;
  }

  const GLSL_DECODE = `
    vec3 bakeDec(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }`;
  // terrain: world-space lookup (island atlas + POI tile atlas)
  const GLSL_TER_F = `
    uniform sampler2D tBakeT, tBakeTiles; uniform vec4 uBakeT; uniform vec4 uBakeTile[16]; uniform vec4 uBakeTileC[16]; uniform int uBakeNT; uniform float uBakeK;
    varying vec2 vBakeXZ;` + GLSL_DECODE + `
    vec4 bakeTerrain(){
      vec4 t = texture2D(tBakeT, (vBakeXZ - uBakeT.xy) * uBakeT.z);
      vec3 irr = bakeDec(t.rgb) * uBakeT.w; float vis = t.a;
      for (int i = 0; i < 16; i++) {
        if (i >= uBakeNT) break;
        vec2 l = (vBakeXZ - uBakeTile[i].xy) * uBakeTile[i].z;
        if (l.x <= 0. || l.y <= 0. || l.x >= 1. || l.y >= 1.) continue;
        float w = smoothstep(0., .08, min(min(l.x, 1. - l.x), min(l.y, 1. - l.y)));
        vec4 q = texture2D(tBakeTiles, uBakeTileC[i].xy + l * uBakeTileC[i].z);
        irr = mix(irr, bakeDec(q.rgb) * uBakeTile[i].w, w); vis = mix(vis, q.a, w);
        break;
      }
      return vec4(irr * uBakeK, vis);
    }`;
  const FRAG_BEFORE_LIGHTS = (src) => `
    #if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
      bakeVis = bk.a;
    #endif
    #include <lights_fragment_begin>`;
  const FRAG_MAPS = `
    #if defined( RE_IndirectDiffuse )
      irradiance = bk.rgb * PI;   // baked sky + bounce replace hemisphere / ambient
    #endif
    #include <lights_fragment_maps>
    #if defined( RE_IndirectDiffuse )
      iblIrradiance *= 0.0;       // and the IBL diffuse term (specular reflections stay)
    #endif`;

  function chain(mat, key, fn) {
    if (mat.userData.baked === key) return false;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); if (BAKED.on) fn(sh); };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|' + key + (BAKED.on ? '1' : '0'); };
    mat.userData.baked = key; mat.needsUpdate = true; return true;
  }
  const TER_U = {};
  function patchTerrainMat(mat) {
    return chain(mat, 'bkT', (sh) => {
      Object.assign(sh.uniforms, TER_U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBakeXZ;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vBakeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_TER_F)
        .replace('#include <lights_fragment_begin>', 'vec4 bk = bakeTerrain();\n' + FRAG_BEFORE_LIGHTS())
        .replace('#include <lights_fragment_maps>', FRAG_MAPS);
    });
  }
  // trees: no lightMap UV (foliage cards share one atlas texture across the whole species) — the ambient term comes
  // from the SAME world-space terrain/tile lookup as bare ground (bakeTerrain(), by the tree's own world position),
  // scaled per vertex by the baked crown AO (treeAO.x). That is the "flat cards with black cores" fix: instead of one
  // flat ambient value per card, the crown's own self-occlusion (branches, needle density) now varies vertex to
  // vertex, and the trunk / crown centre — no longer a uniformly-lit cut-out — reads as a solid, layered shape.
  // treeAO.y (upper-hemisphere sky visibility) is reserved for a future canopy-gap term; not applied here.
  const GLSL_TREE_V = `attribute vec2 treeAO;\nvarying vec2 vBakeXZ;\nvarying vec2 vTreeAO;`;
  const GLSL_TREE_F = GLSL_TER_F.replace('varying vec2 vBakeXZ;', 'varying vec2 vBakeXZ;\nvarying vec2 vTreeAO;');
  function patchTreeMat(mat) {
    return chain(mat, 'bkTree', (sh) => {
      Object.assign(sh.uniforms, TER_U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_TREE_V)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vBakeXZ = (modelMatrix * vec4(transformed, 1.0)).xz; vTreeAO = treeAO;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_TREE_F)
        .replace('#include <lights_fragment_begin>', 'vec4 bk = bakeTerrain(); bk.rgb *= mix(0.35, 1.0, vTreeAO.x);\n' + FRAG_BEFORE_LIGHTS())
        .replace('#include <lights_fragment_maps>', FRAG_MAPS);
    });
  }
  // objects: three's own lightMap slot (uv1, decoded manually — colorSpace stays NoColorSpace so three doesn't also
  // apply its own sRGB decode) + the same hemi/IBL replacement
  function patchObjectMat(mat, scale) {
    return chain(mat, 'bkO', (sh) => {
      sh.uniforms.uBakeK = TER_U.uBakeK;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBakeK;' + GLSL_DECODE)
        .replace('#include <lights_fragment_begin>', `
          #ifdef USE_LIGHTMAP
            vec4 bkT = texture2D(lightMap, vLightMapUv); vec4 bk = vec4(bakeDec(bkT.rgb) * lightMapIntensity / PI * uBakeK, bkT.a);
          #else
            vec4 bk = vec4(0.0, 0.0, 0.0, 1.0);
          #endif
          ` + FRAG_BEFORE_LIGHTS())
        .replace('#include <lights_fragment_maps>', FRAG_MAPS.replace('#include <lights_fragment_maps>', `
          #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
            vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ); radiance += iblRadiance;
          #endif`));
    });
  }

  /* ---- ids: must equal tools/bake/page-export.js bakeId() ---- */
  const r2 = (v, q) => Math.round(v / q) * q;
  function namePath(o) { const p = []; for (let q = o; q && q !== C.scene; q = q.parent) p.unshift(q.name || q.type); return p.join('/'); }
  function bakeId(o) { const e = o.matrixWorld.elements, m = Array.isArray(o.material) ? o.material[0] : o.material;
    return namePath(o) + '|' + ((m && m.name) || (m && m.type) || '') + '@' + [r2(e[12], 0.5), r2(e[13], 0.5), r2(e[14], 0.5)].map((v) => v.toFixed(1)).join(','); }

  const loadScript = (src) => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error(src)); document.head.appendChild(s); });
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  // plain PNG load — same-origin, no fetch-to-blob, no worker, no wasm. flipY = false: see file header (§Texture orientation).
  const getTex = (file) => new Promise((ok, bad) => {
    loader.load(C.ASSET + 'baked/' + file + '.png', (t) => { t.flipY = false; t.needsUpdate = true; ok(t); }, undefined, (e) => bad(new Error(file + '.png: ' + (e && e.message || e))));
  });

  async function load() {
    const t0 = performance.now();
    man = await (await fetch(C.ASSET + 'baked/manifest.json')).json();
    loader = new THREE.TextureLoader();
    // terrain + tiles
    texT = await getTex(man.terrain.file); texT.anisotropy = 4;
    TER_U.tBakeT = { value: texT }; TER_U.uBakeK = { value: BAKED.k };
    TER_U.uBakeT = { value: new THREE.Vector4(man.terrain.origin[0], man.terrain.origin[1], 1 / man.terrain.size, man.terrain.scale) };
    TER_U.uBakeTile = { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }; TER_U.uBakeTileC = { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }; TER_U.uBakeNT = { value: 0 };
    if (man.tileAtlas) {
      texTiles = await getTex(man.tileAtlas.file); texTiles.anisotropy = 4;
      man.tileAtlas.tiles.forEach((t, i) => { if (i < 16) { TER_U.uBakeTile.value[i].set(t.origin[0], t.origin[1], 1 / t.size, t.scale); TER_U.uBakeTileC.value[i].set(t.cell[0], t.cell[1], t.cell[2], 0); } });
      TER_U.uBakeNT.value = Math.min(16, man.tileAtlas.tiles.length);
    }
    TER_U.tBakeTiles = { value: texTiles || texT };
    // objects
    if (man.atlases.length) {
      await loadScript(C.ASSET + 'baked/' + man.uv2.pack);
      const uv = b64(window.__PACK[man.uv2.key]); delete window.__PACK[man.uv2.key];
      const U16 = new Uint16Array(uv.buffer);
      const want = new Map();
      for (const a of man.atlases) for (const o of a.objects) want.set(o.id, { a, o });
      const atlasTex = {}, matCache = new Map();
      const found = [];
      C.scene.updateMatrixWorld(true);
      C.scene.traverse((m) => { if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh) { const id = bakeId(m); if (want.has(id)) found.push([m, want.get(id)]); } });
      // duplicate ids (#k): assign in traversal order, like the exporter
      const seen = {};
      C.scene.traverse((m) => { if (!(m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh)) return; const id0 = bakeId(m); seen[id0] = (seen[id0] || 0) + 1; if (seen[id0] > 1) { const id = id0 + '#' + (seen[id0] - 1); if (want.has(id)) found.push([m, want.get(id)]); } });
      for (const [m, { a, o }] of found) {
        if (Array.isArray(m.material)) { BAKED.stats.missing.push(o.id + ' (multi-material)'); continue; }
        if (!atlasTex[a.file]) { atlasTex[a.file] = await getTex(a.file); atlasTex[a.file].channel = 1; }   // gamma-encoded, decoded in the shader (bakeDec)
        const g0 = m.geometry, n = (g0.index ? g0.index.count : g0.attributes.position.count);
        if (n !== o.corners) { BAKED.stats.missing.push(o.id + ' (corners ' + n + ' vs ' + o.corners + ')'); continue; }
        const g = g0.index ? g0.toNonIndexed() : g0.clone();
        const f = new Float32Array(n * 2), base = o.offset / 2;
        for (let i = 0; i < n * 2; i++) f[i] = U16[base + i] / 65535;
        g.setAttribute('uv1', new THREE.BufferAttribute(f, 2));
        m.geometry = g;
        const key = m.material.uuid + a.file;
        let mat = matCache.get(key);
        if (!mat) { mat = m.material.clone(); mat.onBeforeCompile = m.material.onBeforeCompile; mat.customProgramCacheKey = m.material.customProgramCacheKey; mat.lightMap = atlasTex[a.file]; mat.lightMapIntensity = PI * a.scale; patchObjectMat(mat, a.scale); matCache.set(key, mat); }
        m.material = mat; BAKED.stats.objects++;
      }
      const ids = new Set(found.map(([, w]) => w.o.id)); for (const k of want.keys()) if (!ids.has(k)) BAKED.stats.missing.push(k);
    }
    await loadTrees();
    BAKED.stats.loadMs = Math.round(performance.now() - t0);
    BAKED.ready = true;
    applyTerrain();
  }
  // trees: per-part crown AO (tools/bake/bake.py "trees" job) → a treeAO vertex attribute on the SHARED BatchedMesh
  // geometry, written into that part's own vertex range (getGeometryRangeAt), same id scheme as page-export.js:
  // 'tree:' + group name (the BatchedMesh) + '|' + geometry id. One id can cover many world instances (every spruce
  // of that species/part shares the geometry) — exactly the "instanced" bake mode, just vertex- instead of texel-based.
  async function loadTrees() {
    if (!man.trees) return;
    await loadScript(C.ASSET + 'baked/' + man.trees.pack);
    const raw = b64(window.__PACK[man.trees.key]); delete window.__PACK[man.trees.key];
    const F = window.VEG && window.VEG._ && window.VEG._.F;
    if (!F) { BAKED.stats.missing.push('trees: VEG not ready'); return; }
    const byName = new Map(F.groups.map((g) => [g.b.name, g.b]));
    for (const p of man.trees.parts) {
      const idm = /^tree:(.+)\|(\d+)$/.exec(p.id);
      if (!idm) { BAKED.stats.missing.push(p.id + ' (bad id)'); continue; }
      const b = byName.get(idm[1]);
      if (!b) { BAKED.stats.missing.push(p.id + ' (no group)'); continue; }
      let r; try { r = b.getGeometryRangeAt(Number(idm[2])); } catch (e) { r = null; }
      if (!r || r.vertexCount !== p.verts) { BAKED.stats.missing.push(p.id + ' (verts ' + (r && r.vertexCount) + ' vs ' + p.verts + ')'); continue; }
      const geo = b.geometry;
      let attr = geo.getAttribute('treeAO');
      if (!attr) { attr = new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2).fill(1), 2); geo.setAttribute('treeAO', attr); }
      for (let i = 0; i < p.verts; i++) { attr.array[(r.vertexStart + i) * 2] = raw[p.offset + i * 2] / 255; attr.array[(r.vertexStart + i) * 2 + 1] = raw[p.offset + i * 2 + 1] / 255; }
      attr.needsUpdate = true;
      if (patchTreeMat(Array.isArray(b.material) ? b.material[0] : b.material)) BAKED.stats.treeParts = (BAKED.stats.treeParts || 0) + 1;
    }
  }
  function terrainMats() {
    const out = []; const T = C.WORLD_TERRAIN && C.WORLD_TERRAIN.mesh; if (T) out.push(T.material);
    const d = C.scene.getObjectByName('terrain_detail'); if (d) d.traverse((o) => { if (o.isMesh) out.push(o.material); });
    return out;
  }
  function applyTerrain() { if (!BAKED.ready) return; for (const m of terrainMats()) if (patchTerrainMat(m)) BAKED.stats.terrainMats++; }

  function setOn(on) {
    BAKED.on = on;
    C.scene.traverse((o) => { if (o.material && o.material.userData && o.material.userData.baked) o.material.needsUpdate = true; });
    applyQ();
  }
  function applyQ() {
    // GTAO: the baked AO / sky occlusion covers static surfaces; keep the screen-space pass off while baked
    if (BAKED.gtaoOff && C.post && C.post.gtao) C.post.gtao.enabled = !BAKED.on && !!C.Q.ao;
    // baked far moon shadows: the coarse cascade only has to cover dynamic casters + near detail
    if (BAKED._sd0 === undefined) BAKED._sd0 = C.Q.shadowDist;
    const want = BAKED.on && BAKED.shadowDist ? BAKED.shadowDist : BAKED._sd0;
    if (C.Q.shadowDist !== want) { C.Q.shadowDist = want; if (C.SHADOW && C.SHADOW.on) C.SHADOW.configure(); }
  }
  BAKED.setOn = setOn;

  function init(ctx) {
    C = ctx; THREE = ctx.THREE; BAKED.ctx = ctx;
    patchSunChunk();
    load().catch((e) => { console.warn('[baked] load failed', e); BAKED.error = String(e && e.message || e); });
  }
  let tq = 0;
  function update(dt) {
    if (!BAKED.ready) return;
    TER_U.uBakeK.value = BAKED.k;
    if ((tq += dt) > 0.5) { tq = 0; applyTerrain(); applyQ(); }   // detail rings are rebuilt on quality changes
  }
  (window.GameModules = window.GameModules || []).push({ name: 'baked', order: 50, init, update });
})();
