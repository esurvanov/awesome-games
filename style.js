/* style.js — shared style dictionary for "Эхо Разлома" (window.STYLE, also ctx.STYLE via MODCTX). See STYLE.md.
 *
 * Every value here is what the game ALREADY uses (read from open-world.html, modules/*.js and the glTF packs on
 * 2026-09-25) — a common vocabulary to migrate to, not a new art direction. Colours:
 *   hex        = display (sRGB) values, as you would type them in `color: 0x…` (three decodes them to linear)
 *   lin [r,g,b] = linear values, as used inside shaders (`vec3(...)`); STYLE.hex(lin) / STYLE.lin(hex) convert
 * Helpers: STYLE.material(name, overrides) → MeshStandardMaterial · STYLE.light(preset) → light rig numbers ·
 *          STYLE.tag(obj, { owner, source, intentional }) → provenance for tools/inventory.mjs and tools/eye.mjs.
 */
(function () {
  const S = window.STYLE = window.STYLE || {};
  S.version = 1;
  const toS = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255);
  S.hex = (lin) => (toS(lin[0]) << 16) | (toS(lin[1]) << 8) | toS(lin[2]);                       // linear triple → sRGB hex
  S.lin = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255].map((v) => Math.pow(v, 2.2));   // sRGB hex → linear

  /* ------------------------------------------------------------------ palette (sRGB hex) */
  S.palette = {
    // night sky / fog / atmosphere (atmosphere.js clear_aurora; the other presets in S.atmosphere)
    fog: 0x1b2b55, heightFog: 0x22355f, auroraA: 0x33ffa8, auroraB: 0xa852ff, riftFog: 0x2a1d55, riftAurora: 0x8a6bff,
    // light colours (open-world.html RENDERER block)
    moon: 0xb4c6ff, hemiSky: 0x7d9de0, hemiGround: 0x2c3c70, auroraLight: 0x5cf5c0,
    // UI / emitter accents already used across HUD, glows and beams
    ice: 0x7fe3ff, amber: 0xffb347, aurora: 0x5cf5c0, violet: 0xc49bff, pink: 0xff4d9d, danger: 0xff5c7d,
    beacon: 0xffb347, spireBeam: 0x7fe3ff, heartBeam: 0xb77bff, stationWarm: 0xffb070, fire: 0xff9a40,
  };

  /* ------------------------------------------------------------------ material presets (MeshStandardMaterial params) */
  // `from` names the current source of truth; `lin` keeps shader-side constants for custom shaders.
  S.materials = {
    snow: { color: 0xbdc4d0, roughness: 0.8, metalness: 0, lin: { base: [0.52, 0.56, 0.64], packedTint: [0.46, 0.55, 0.78], onObjects: [0.60, 0.66, 0.78] },
      from: 'terrain.js snowFlat vec3(.52,.56,.64), roughness .8 (wind-packed .45); structures/terrain snowCover on objects vec3(.60,.66,.78) rough .88' },
    snow_on_objects: { color: 0xcad3e4, roughness: 0.88, metalness: 0, from: 'structures.js snowify / terrain snowCover' },
    ice_sea: { color: 0xffffff, roughness: 0.2, metalness: 0, envMapIntensity: 0.8, lin: { deep: [0.02, 0.05, 0.08] }, maps: 'tr_iceS_d/n.jpg, tile 9 m', from: 'terrain.js iceMaterial (sea)' },
    ice_lake: { color: 0xffffff, roughness: 0.1, metalness: 0, envMapIntensity: 1.1, lin: { deep: [0.004, 0.018, 0.035] }, maps: 'tr_iceC_d/n.jpg, tile 5.5 m', from: 'terrain.js iceMaterial (lake)' },
    rock_basalt: { color: 0x8e96a8, roughness: 0.9, metalness: 0, grade: { desat: 0.55, mul: [0.62, 0.68, 0.8] }, cliffTint: [0.74, 0.8, 0.94], lichen: 0.55,
      from: 'vegetation.js rockMaterialPatch (boulders desat .55 grade .62/.68/.80; flat & outcrops desat .7–.75 grade .55/.60/.72) + terrain cliff tint' },
    metal_painted: { color: 0xaebcd2, roughness: 0.35, metalness: 0.55, from: 'Kestrel hull (buildKestrel std 0xaebcd2 .55/.35); glTF wreck forced metalness ≥ .5, roughness ≤ .5' },
    metal_bare: { color: 0x888a8f, roughness: 0.5, metalness: 0.8, from: 'station dome seam_steel #888a8f .8/.5; snowmobile steel #c2c4c7 1/.35; tent poles #949498 .9/.4' },
    metal_dark: { color: 0x2e3542, roughness: 0.45, metalness: 0.75, from: 'crash debris std 0x2e3542 (v1 primitive — to be replaced)' },
    fabric_suit: { color: 0xe58851, roughness: 1, metalness: 0, side: 'double', from: 'pilot_aces lambert3S.002 #e58851 (untextured glTF colours: helmet #f7f7f7, visor #000000, boots #727272/#dcdcdc)' },
    fabric_tent: { color: 0xd95a41, roughness: 0.7, metalness: 0, from: 'prop_tent_tunnel guy_cord #d95a41 .7; nylon textured' },
    wood_weathered: { color: 0xffffff, roughness: 1, metalness: 0, maps: 'glTF map+normal (pier planks/poles, crates)', from: 'struct_pier_wood, prop_crate_wood (glTF metalness 1 × metalRoughness map)' },
    foliage_needle: { color: 0xffffff, roughness: 0.88, metalness: 0, alphaTest: 0.42, vertexColors: true, from: 'vegetation.js needles' },
    bark: { color: 0xe7e4e1, roughness: 0.95, metalness: 0, lin: [0.8, 0.78, 0.76], from: 'vegetation.js pbark (dbark lin .85)' },
    foliage_grass: { color: 0xffffff, roughness: 0.95, metalness: 0, alphaTest: 0.42, from: 'vegetation.js tufts / shrub leaves (leaves double-sided)' },
    glass: { color: 0x34414c, roughness: 0.08, metalness: 0.2, emissive: 0xffb468, emissiveIntensity: 0.45, from: 'station window_glass #34414c .2/.08; lit windows emissive 0xffb468 × .45–.5' },
    glass_cockpit: { color: 0x0a1a2c, roughness: 0.08, metalness: 1, emissive: 0x1d9dff, emissiveIntensity: 0.5, from: 'buildKestrel cockpit' },
    crystal: { color: 0x8fc8ff, roughness: 0.1, metalness: 0.2, emissive: 0x3a1a9a, emissiveIntensity: 1.2,
      variants: { spire: [0x1b5fb0, 1.0], spireTaken: [0x1b5fb0, 0.15], rift: [0x4a1a9a, 1.2], heart: [0x8a4dff, 1.3], shard: [0xff7a10, 1.1], shardling: [0x3a1a9a, 1.5] },
      from: 'structures.js crystal materials (emissive hex, intensity)' },
    fur_fox: { color: 0xe8edf5, roughness: 0.95, metalness: 0, from: 'open-world.html fox tint (map removed)' },
  };

  /* ------------------------------------------------------------------ light rig + atmosphere presets */
  S.lights = {
    moon: { color: 0xb4c6ff, intensity: 2.8, shadow: { dist: { low: 90, med: 170, high: 250, ultra: 320 }, bias: -0.0004, normalBias: 0.035 } },
    hemi: { sky: 0x7d9de0, ground: 0x2c3c70, intensity: 1.2 },
    aurora: { color: 0x5cf5c0, intensity: 0.7 },
    point_cd: { station: 40, spire: 140, cell: 30, heart: 600, fire: 24 },   // candela() values
    toneMapping: 'ACESFilmic', exposure: 0.8, glowGain: 2.4, bloom: { strength: 0.5, radius: 0.45, threshold: 1.15 },
  };
  // exposure / light per atmosphere preset (atmosphere.js PRESETS; that table stays the runtime source)
  S.atmosphere = {
    clear_aurora: { moon: 2.8, hemi: 1.2, aurLight: 0.7, bloom: 0.5, exposure: 0.8, fog: 0x1b2b55, fogNear: 90, fogFar: 640 },
    calm_mist: { moon: 2.4, hemi: 1.35, aurLight: 0.35, bloom: 0.62, exposure: 0.82, fog: 0x27385f, fogNear: 25, fogFar: 430 },
    overcast: { moon: 1.0, hemi: 1.55, aurLight: 0.05, bloom: 0.4, exposure: 0.85, fog: 0x1d2334, fogNear: 45, fogFar: 470 },
    blizzard: { moon: 1.3, hemi: 1.7, aurLight: 0.15, bloom: 0.45, exposure: 0.85, fog: 0x2b3858, fogNear: 6, fogFar: 160 },
    aurora_flare: { moon: 2.4, hemi: 1.1, aurLight: 1.5, bloom: 0.85, exposure: 0.8, fog: 0x173052, fogNear: 110, fogFar: 720 },
    rift_glow: { moon: 2.3, hemi: 1.1, aurLight: 0.9, bloom: 0.9, exposure: 0.8, fog: 0x2a1d55, fogNear: 60, fogFar: 540 },
  };
  S.light = (preset = 'clear_aurora') => { const a = S.atmosphere[preset] || S.atmosphere.clear_aurora, L = S.lights;
    return { moon: { color: L.moon.color, intensity: a.moon }, hemi: { sky: L.hemi.sky, ground: L.hemi.ground, intensity: a.hemi }, aurora: { color: L.aurora.color, intensity: a.aurLight }, exposure: a.exposure, bloom: a.bloom }; };

  /* ------------------------------------------------------------------ scale rules (metres, 1 unit = 1 m) */
  S.scale = {
    human: { pilot: 1.9, hermit: 1.84 }, fox: 0.55, stag: 'glTF native (armature × 0.305)', snowmobileRideHeight: -1.02,
    trees: { spruce_snowladen: 11.44, spruce_young: 6.76, spruce_dense: 16.65, fir_windbent: 9.36, krummholz: 2.64, pine_scots: 14.0, snag: 7.6, perInstance: [0.7, 1.35] },
    ruins: [1.0, 1.3], spire: 0.9, heart: 7, kestrelFallback: 2.6,
    snow: { looseOpen: 0.22, looseCamp: 0.14, drift: 0.34, bootFloat: 0.3 },
    placement: { maxSlopeDeg: 20, masonrySinkM: 0.06, walkableDeg: 45, ledgeClimbM: [0.8, 1.6] },
    camera: { dist: 7.5, fov: 62, near: 0.1, far: 3000 },
  };

  /* ------------------------------------------------------------------ impostor bake */
  // current: vegetation.js bakeSpecies — neutral "daylight" rig, runtime gain removes part of it (the cardboard look).
  // nightBake: the rig the next wave should bake with so billboards match the moonlit near trees without a gain hack.
  S.impostor = {
    current: { ambient: { color: 0xffffff, intensity: Math.PI * 0.72 }, key: { color: 0xffffff, intensity: 0.9 }, clear: [0.03, 0.05, 0.035], views: 8, cell: 256, gain: { mid: 0.86, far: 0.8 }, alphaTest: 0.38 },
    nightBake: { ambient: { color: 0x7d9de0, ground: 0x2c3c70, intensity: 1.2 }, key: { color: 0xb4c6ff, intensity: 2.8, dir: 'MOON_DIR' }, exposure: 0.8, toneMapping: 'ACESFilmic (applied at runtime, not baked)',
      store: 'albedo + normal atlas, lit at runtime by the scene lights (preferred) — or baked with this rig at gain 1', views: 8, cell: 256, lodBands: { near2mid: 14, mid2far: 30 } },
  };

  /* ------------------------------------------------------------------ helpers */
  // new MeshStandardMaterial from a preset (THREE is read lazily: style.js loads before the engine bootstrap)
  S.material = (name, over = {}) => {
    const T = window.THREE, p = S.materials[name]; if (!T || !p) return null;
    const m = new T.MeshStandardMaterial({ name: 'style:' + name, color: p.color, roughness: p.roughness, metalness: p.metalness });
    if (p.emissive !== undefined) { m.emissive.setHex(p.emissive); m.emissiveIntensity = p.emissiveIntensity || 1; }
    if (p.envMapIntensity !== undefined) m.envMapIntensity = p.envMapIntensity;
    if (p.alphaTest) m.alphaTest = p.alphaTest;
    if (p.vertexColors) m.vertexColors = true;
    if (p.side === 'double') m.side = T.DoubleSide;
    for (const k in over) { if (k === 'color' || k === 'emissive') m[k].setHex(over[k]); else m[k] = over[k]; }
    m.userData.style = name; return m;
  };
  // provenance / QA tags: owner (module name), source ('pack:<name>' | 'primitive:<Box>' | free text), intentional
  // ('fx' | 'beam' | 'ui' | 'helper' …: primitives the QA must not report as v1 leftovers)
  S.tag = function (obj, t) { if (!obj || !obj.userData) return obj; const u = obj.userData; for (const k in t) if (t[k] !== undefined) u[k === 'intentional' ? 'qaIntentional' : k === 'source' ? 'qaSource' : k] = t[k]; return obj; };
})();
