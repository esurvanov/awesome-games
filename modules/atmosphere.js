/* Module "atmosphere" — sky, fog, weather looks, horizon and sea-ice set dressing (wave 2). See ATMOSPHERE.md.
 *
 *   ctx.setAtmosphere(name, seconds?)  'clear_aurora' | 'calm_mist' | 'overcast' | 'blizzard' | 'aurora_flare' | 'rift_glow' | 'auto'
 *   ctx.atmosphere                     { name, auto, weights, params, presets }  (live state, read-only by convention)
 *   ctx.ATMO_PRESETS                   the preset table (editable)
 *   ctx.bakeAO(mesh, opts?)            cheap baked sky-visibility / contact AO into an existing vertex colour attribute
 *
 * Owns: horizon mountain ring (env_mountain_ring) + model icebergs / pressure ridges (env_*), global height fog + moon
 * in-scatter (patched fog chunks), sky shader (seamless aurora, cloud veil, moon halo), moon light shafts (screen-space
 * pass on the scene depth), aurora reflections on sea/lake ice, layered falling snow (near streaks + far flakes),
 * breath vapour (player, stags), preset blending tied to WX (blizzards) and G.aurora / G.ending (story).
 * Hides (never deletes): worldfill `wf_mountains` mesh, the game's 1400-flake SNOW points. Nothing else.
 */
(function () {
  'use strict';

  /* ============================ presets ============================ */
  // colours are display hex (decoded to linear once); intensities in the game's physical units
  const PRESETS = {
    clear_aurora: { fog: 0x1a2c46, fogNear: 90, fogFar: 640, hfDen: 0.010, hfH: 7, hfMax: 0.55, hfCol: 0x20344f, scatter: 0.55,
      skyExp: 1.0, stars: 1.0, veil: 0.0, storm: 0.0, aur: 1.0, aurA: 0x4dff8e, aurB: 0xa852ff, aurCycle: 0,
      moon: 4.4, hemi: 0.75, aurLight: 0.12, bloom: 0.5, exposure: 0.64, envK: 0.3,
      snow: 0.30, snowFar: 0.35, wind: 1.0, fall: 1.3, streak: 0, shafts: 0.5, haze: 1.0, iceAur: 1.0, breath: 1.0 },
    calm_mist: { fog: 0x27385f, fogNear: 25, fogFar: 430, hfDen: 0.045, hfH: 9, hfMax: 0.88, hfCol: 0x2f4371, scatter: 1.4,
      skyExp: 0.8, stars: 0.6, veil: 0.15, storm: 0.0, aur: 0.45, aurA: 0x33ffa8, aurB: 0x8a6bff, aurCycle: 0,
      moon: 2.8, hemi: 0.9, aurLight: 0.2, bloom: 0.62, exposure: 0.82,
      snow: 0.12, snowFar: 0.15, wind: 0.25, fall: 0.7, streak: 0, shafts: 1.0, haze: 1.5, iceAur: 0.5, breath: 1.3 },
    overcast: { fog: 0x1d2334, fogNear: 45, fogFar: 470, hfDen: 0.014, hfH: 8, hfMax: 0.6, hfCol: 0x232b3f, scatter: 0.15,
      skyExp: 0.35, stars: 0.05, veil: 0.85, storm: 0.3, aur: 0.06, aurA: 0x33ffa8, aurB: 0xa852ff, aurCycle: 0,
      moon: 1.0, hemi: 1.25, aurLight: 0.03, bloom: 0.4, exposure: 0.85,
      snow: 0.55, snowFar: 0.6, wind: 3.0, fall: 1.5, streak: 0.15, shafts: 0.0, haze: 1.6, iceAur: 0.1, breath: 1.0 },
    blizzard: { fog: 0x2b3858, fogNear: 6, fogFar: 160, hfDen: 0.03, hfH: 14, hfMax: 0.7, hfCol: 0x34456b, scatter: 0.35,
      skyExp: 0.3, stars: 0.0, veil: 1.0, storm: 1.0, aur: 0.22, aurA: 0x33ffa8, aurB: 0xa852ff, aurCycle: 0,
      moon: 1.3, hemi: 1.45, aurLight: 0.08, bloom: 0.45, exposure: 0.85,
      snow: 1.0, snowFar: 1.0, wind: 22, fall: 4.5, streak: 1.0, shafts: 0.0, haze: 3.0, iceAur: 0.1, breath: 0.6 },
    aurora_flare: { fog: 0x173052, fogNear: 110, fogFar: 720, hfDen: 0.008, hfH: 6, hfMax: 0.5, hfCol: 0x1d4a5a, scatter: 0.35,
      skyExp: 1.05, stars: 1.0, veil: 0.0, storm: 0.0, aur: 2.2, aurA: 0x3dffb0, aurB: 0xc25cff, aurCycle: 1,
      moon: 3.0, hemi: 0.7, aurLight: 0.9, bloom: 0.85, exposure: 0.8,
      snow: 0.2, snowFar: 0.25, wind: 0.6, fall: 1.0, streak: 0, shafts: 0.3, haze: 0.9, iceAur: 1.8, breath: 1.0 },
    rift_glow: { fog: 0x2a1d55, fogNear: 60, fogFar: 540, hfDen: 0.022, hfH: 10, hfMax: 0.7, hfCol: 0x3b2672, scatter: 0.6,
      skyExp: 0.85, stars: 0.8, veil: 0.1, storm: 0.0, aur: 0.9, aurA: 0x8a6bff, aurB: 0xff5cc8, aurCycle: 0,
      moon: 3.0, hemi: 0.75, aurLight: 0.5, bloom: 0.9, exposure: 0.8,
      snow: 0.3, snowFar: 0.3, wind: 0.8, fall: 1.1, streak: 0, shafts: 0.4, haze: 1.1, iceAur: 1.0, breath: 1.0 },
  };
  const COLOR_KEYS = ['fog', 'hfCol', 'aurA', 'aurB', 'moonCol', 'hemiSky', 'hemiGnd'];
  // night palette (FIX-LOOK, references/targets.json night_master): near-neutral moon (lit snow B/R 1.0–1.2), blue sky
  // ambient (shadows bluer than lit snow, B/R 1.3–1.6), weaker ambient vs moon (lit/shadow 3–6×), greener aurora (#356c4b).
  // Values mirror STYLE.palette (style.js) when present.
  const PAL = (k, d) => (window.STYLE && window.STYLE.palette && window.STYLE.palette[k] !== undefined ? window.STYLE.palette[k] : d);
  const NIGHT = { moonCol: PAL('moon', 0xf0eae4), hemiSky: PAL('hemiSky', 0x7c93d4), hemiGnd: PAL('hemiGround', 0x252c48), envK: 0.6 };
  for (const k in PRESETS) for (const c in NIGHT) if (PRESETS[k][c] === undefined) PRESETS[k][c] = NIGHT[c];
  // quality knobs added to QUALITY presets (see ATMOSPHERE.md)
  const QKNOBS = {
    low:   { atmSnow: 700,  atmSnowFar: 1500, atmShafts: 0,  atmShaftScale: 0.35, atmIceMax: 0.5 },
    med:   { atmSnow: 1500, atmSnowFar: 3200, atmShafts: 14, atmShaftScale: 0.4,  atmIceMax: 0.8, aoScale: 0.35 },
    high:  { atmSnow: 2400, atmSnowFar: 5200, atmShafts: 22, atmShaftScale: 0.5,  atmIceMax: 1 },
    ultra: { atmSnow: 3200, atmSnowFar: 7000, atmShafts: 32, atmShaftScale: 0.5,  atmIceMax: 1 },
  };
  const SNOW_MAX = 3200, SNOWFAR_MAX = 7000;

  let C = null, THREE = null;
  const A = {           // public state (ctx.atmosphere)
    name: 'clear_aurora', auto: true, manual: null, transition: 4,
    weights: { base: 'clear_aurora', rift: 0, mist: 0, blizzard: 0 },
    params: null, target: null, presets: PRESETS, hidden: [], stats: {},
  };
  const HF = { x: 0, y: 0.1, z: 0, w: 0 }, HC = { x: 0, y: 0, z: 0, w: 0 }, MD = { x: 0.77, y: 0.36, z: 0.56, w: 0 };   // fog chunk uniforms (shared by reference)

  /* ============================ params ============================ */
  function decode(p) {
    const o = {};
    for (const k in p) o[k] = COLOR_KEYS.includes(k) ? new THREE.Color(p[k]) : p[k];
    return o;
  }
  let DEC = {};
  function blendInto(out, a, b, t) {   // out = mix(a, b, t)
    for (const k in a) {
      if (a[k] && a[k].isColor) out[k].copy(a[k]).lerp(b[k], t);
      else out[k] = a[k] + (b[k] - a[k]) * t;
    }
    return out;
  }
  function copyInto(out, a) { for (const k in a) { if (a[k] && a[k].isColor) out[k].copy(a[k]); else out[k] = a[k]; } return out; }

  // name: preset or 'auto' · seconds: blend time (default 4) · hold: seconds before returning to 'auto' (default: stays)
  function setAtmosphere(name, seconds, hold) {
    if (name === 'auto' || !name) { A.auto = true; A.manual = null; A.holdT = 0; if (seconds > 0) A.transition = seconds; return 'auto'; }
    if (!PRESETS[name]) return A.name;
    DEC[name] = decode(PRESETS[name]);   // pick up edits to the table
    A.auto = false; A.manual = name; A.transition = seconds > 0 ? seconds : 4; A.holdT = hold > 0 ? hold : 0;
    const WX = C && C.WX;
    if (WX) {
      if (name === 'blizzard') { WX.target = 1; WX.t = Math.max(WX.t, 40); }
      else if (WX.target === 1) { WX.target = 0; WX.t = 150 + Math.random() * 80; }
    }
    return name;
  }

  /* ============================ shader chunk patch: height fog + moon in-scatter ============================ */
  function patchFogChunks() {
    const SC = THREE.ShaderChunk;
    if (SC.fog_fragment.includes('atmHF')) return;
    SC.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vAtmW;\n#endif\n';
    SC.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvAtmW = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif\n';
    SC.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vAtmW;
	uniform vec4 atmHF; uniform vec4 atmHC; uniform vec4 atmMD;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
    // atmHF = (density at base, 1/falloff height, base y, max amount) · atmHC = height-fog colour · atmMD = (moon dir, in-scatter)
    SC.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 atmV = vAtmW - cameraPosition; float atmD = length( atmV ); vec3 atmDir = atmV / max( atmD, 1e-3 );
	float atmSc = atmMD.w * pow( max( dot( atmDir, atmMD.xyz ), 0.0 ), 8.0 );
	float atmBy = atmHF.y * atmV.y;
	float atmK = abs( atmBy ) > 1e-3 ? ( 1.0 - exp( - clamp( atmBy, -12.0, 60.0 ) ) ) / atmBy : 1.0;
	float atmH = 1.0 - exp( - atmHF.x * exp( - clamp( atmHF.y * ( cameraPosition.y - atmHF.z ), -6.0, 40.0 ) ) * atmD * atmK );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, atmHC.rgb * ( 1.0 + atmSc * 1.5 ), min( atmH, atmHF.w ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * ( 1.0 + atmSc ), fogFactor );
#endif
`;
    const add = (u) => { if (u && u.fogColor && !u.atmHF) { u.atmHF = { value: HF }; u.atmHC = { value: HC }; u.atmMD = { value: MD }; } };
    add(THREE.UniformsLib.fog);
    for (const k in THREE.ShaderLib) add(THREE.ShaderLib[k].uniforms);
    // already-compiled built-in materials pick the new chunk + uniforms up on their next compile
    C.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (!m.isShaderMaterial) m.needsUpdate = true; });
  }

  /* ============================ sky shader (seamless aurora, veil, halo, exposure) ============================ */
  const NOISE = `
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1.,0.)), u.x), mix(h21(i+vec2(0.,1.)), h21(i+vec2(1.,1.)), u.x), u.y); }
float fb(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }`;
  function patchSky() {
    const skyU = C.skyU; let sky = null;
    C.scene.traverse((o) => { if (!sky && o.material && o.material.uniforms === skyU) sky = o; });
    if (!sky) return false;
    Object.assign(skyU, { uExp: { value: 1 }, uStarK: { value: 1 }, uVeil: { value: 0 }, uScat: { value: 0.5 }, uMoonDir: { value: C.MOON_DIR.clone() } });
    const m = sky.material;
    m.fragmentShader = `uniform float uTime, uInt, uStorm, uStars, uExp, uStarK, uVeil, uScat; uniform vec3 uFog, uA, uB, uMoonDir; uniform sampler2D tSky; varying vec3 vDir; ${NOISE}
  void main(){
    vec3 d = normalize(vDir); float y = d.y;
    vec2 suv = vec2(atan(d.z, d.x) * .15915494 + .5, asin(clamp(y, -1., 1.)) * .31830989 + .5);
    vec3 ph = texture2D(tSky, suv).rgb;
    float lum = dot(ph, vec3(.2126, .7152, .0722));
    vec3 photo = (ph * ph * vec3(.07, .085, .16) + vec3(1., .97, .9) * smoothstep(.78, 1., lum) * 1.1) * uExp;
    float md = max(dot(d, uMoonDir), 0.);
    vec3 fogH = uFog * (1. + uScat * pow(md, 8.));                       // same in-scatter as the fog chunk: no seam at the horizon
    vec3 col = mix(fogH, photo, smoothstep(-.01, .2, y));
    if (y < 0.) col = fogH;
    // cloud veil (overcast / blizzard): moonlit undersides, hides stars and aurora
    float veil = 0.;
    if (uVeil > .005) {
      vec2 cp = d.xz / (max(y, 0.) + .12) * 1.3 + vec2(uTime * .012, uTime * .004);
      float cl = smoothstep(.35, .75, fb(cp)) * smoothstep(-.02, .12, y);
      veil = clamp(uVeil * (.55 + .45 * cl), 0., 1.) * step(0., y);
    }
    vec2 uv = vec2(atan(d.x, -d.z), asin(clamp(y, -1., 1.))) * 170.;
    vec2 id = floor(uv); float r = h21(id);
    col += vec3(.6, .75, 1.) * step(.983, r) * smoothstep(.42, 0., length(fract(uv) - .5)) * (.55 + .45 * sin(uTime * 2.2 + r * 90.)) * smoothstep(.03, .25, y) * uStars * uStarK * (1. - veil);
    float az = atan(d.x, -d.z); vec2 cs = vec2(cos(az), sin(az));      // periodic in azimuth: no seam behind the camera
    vec3 aur = vec3(0.);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float n = fb(cs * 2.4 + vec2(fi * 7.3 + uTime * .03, fi * 3.1 - uTime * .02));
      float edge = .14 + fi * .08 + .05 * sin(az * 2. + uTime * .09 + fi) + (n - .5) * .18;
      float e = y - edge;
      float c = smoothstep(-.012, .015, e) * exp(-max(e, 0.) * (5.5 - fi));
      float rays = .45 + .55 * vn(cs * 44. + vec2(uTime * .25 + fi * 13., fi * 5.));
      aur += mix(uA, uB, clamp(e * 4.5, 0., 1.)) * c * rays * (.35 + .5 * n) * (1. - fi * .22) * uInt * .55;
    }
    aur += uA * exp(-abs(y) * 14.) * .02 * uInt;
    col += aur * (1. - veil * .85);
    vec3 cloudC = uFog * (1.05 + .5 * pow(md, 3.)) + vec3(.5, .56, .7) * pow(md, 24.) * .12;
    col = mix(col, cloudC, veil * .9);
    col += vec3(.55, .62, .8) * (pow(md, 60.) * .07 + pow(md, 10.) * .025) * uScat;   // moon halo in haze
    col = mix(col, uFog * 1.3, uStorm * .85);
    gl_FragColor = vec4(col, 1.);
  }`;
    m.needsUpdate = true;
    A.sky = sky;
    return true;
  }

  /* ============================ horizon: real-heightmap mountain ring ============================ */
  const MU = {};   // mountain uniforms (shared by both rings)
  function mountainMaterial(src, layer) {
    const m = src.clone();
    m.fog = false;
    const uLayer = { value: layer };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, MU, { uAtmLayer: uLayer });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAtmP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvAtmP = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uAtmFog, uAtmMoon, uAtmRim, uAtmSnowK; uniform vec4 uAtmHaze; uniform float uAtmScat, uAtmLayer; varying vec3 vAtmP;`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  vec3 aV = vAtmP - cameraPosition; float aD = length(aV); vec3 aDir = aV / aD;
  float md = max(dot(aDir, uAtmMoon), 0.);
  // moonlit rim on silhouettes seen toward the moon
  float rim = pow(1. - abs(dot(normalize(vNormal), normalize(vViewPosition))), 4.) * (.25 + .75 * pow(md, 2.));
  gl_FragColor.rgb = gl_FragColor.rgb * uAtmSnowK + uAtmRim * rim;
  // aerial perspective: distance haze + ground haze that reaches the fog colour exactly at sea level (no seam with the ice)
  float hz = exp(-max(vAtmP.y, 0.) / uAtmHaze.y);
  float ap = 1. - exp(-aD * uAtmHaze.x * (1. + uAtmLayer * .6));
  ap = max(min(ap, uAtmHaze.z), hz);
  ap = mix(ap, 1., uAtmHaze.w);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uAtmFog * (1. + uAtmScat * pow(md, 8.)) * (1. + .3 * uAtmHaze.w), clamp(ap, 0., 1.));
}`);
    };
    m.customProgramCacheKey = () => 'atmMountain';
    return m;
  }
  function buildMountains() {
    Object.assign(MU, {
      uAtmFog: { value: C.FOG }, uAtmMoon: { value: C.MOON_DIR.clone().normalize() }, uAtmRim: { value: new THREE.Color(0.10, 0.13, 0.22) },
      uAtmHaze: { value: new THREE.Vector4(0.00055, 70, 0.9, 0) }, uAtmScat: { value: 0.5 }, uAtmSnowK: { value: new THREE.Color(1, 1, 1) },
    });
    C.loadPacked('env_mountain_ring', C.ASSET, (g) => {
      const parts = C.bakeParts(g.scene);
      if (!parts.length) return;
      const geo = parts[0].geo, base = parts[0].mat;
      const rings = [
        { r: 1650, k: 0.85, yaw: 0.0, layer: 0 },    // near massifs: 1290–1650 m, peaks ~300 m (≈ 10°)
        { r: 2500, k: 1.0, yaw: 2.2, layer: 1 },     // far layer: 1950–2500 m, peaks ~535 m, hazier
      ];
      A.mountains = [];
      for (const R of rings) {
        const mesh = new THREE.Mesh(geo, mountainMaterial(base, R.layer));
        mesh.scale.set(R.r, R.r * R.k, R.r); mesh.rotation.y = R.yaw; mesh.position.y = -2;
        mesh.name = 'atm_mountains_' + R.layer; mesh.renderOrder = -5 + R.layer * -1; mesh.frustumCulled = false;
        mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.noCollide = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        C.scene.add(mesh); A.mountains.push(mesh);
      }
      hideOld();
    });
  }
  function hideOld() {
    C.scene.traverse((o) => {
      if (o.name === 'wf_mountains' && o.visible && A.mountains && A.mountains.length) { o.visible = false; A.hidden.push('wf_mountains'); }
    });
  }

  /* ============================ sea ice: model icebergs / pressure ridges ============================ */
  const ICE_MODELS = ['env_iceberg_large', 'env_iceberg_tabular', 'env_iceberg_small', 'env_pressure_ridge', 'env_ice_chunk'];
  function buildIce() {
    const got = {}; let left = ICE_MODELS.length;
    for (const name of ICE_MODELS) {
      C.loadPacked(name, C.ASSET, (g) => {
        const parts = C.bakeParts(g.scene); if (parts.length) got[name] = parts[0];
        if (--left === 0) placeIce(got);
      });
    }
  }
  // dy that makes the QA buried share (mean over the 3×3 footprint cells of the column below the surface) = target
  function seatDy(v, target, surf) {
    const n = v.length / 3; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { const x = v[i * 3], z = v[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const lo = [], top = [];
    for (let i = 0; i < n; i++) { const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2]; const ci = Math.min(2, Math.floor((x - x0) / Math.max(1e-3, x1 - x0) * 3)), cj = Math.min(2, Math.floor((z - z0) / Math.max(1e-3, z1 - z0) * 3)), k = ci * 3 + cj;
      if (!lo[k] || y < lo[k][1]) lo[k] = [x, y, z]; if (top[k] === undefined || y > top[k]) top[k] = y; }
    const cs = []; for (let k = 0; k < 9; k++) if (lo[k] && top[k] - lo[k][1] > 0.02) cs.push([lo[k][1], top[k] - lo[k][1], surf(lo[k][0], lo[k][2])]);
    if (!cs.length) return 0;
    const f = (dy) => { let a = 0; for (const [y, h, s] of cs) a += Math.min(1, Math.max(0, (s - (y + dy)) / h)); return a / cs.length; };
    let a = -40, b = 40; for (let it = 0; it < 40; it++) { const m = (a + b) / 2; if (f(m) > target) a = m; else b = m; }
    return (a + b) / 2;
  }
  function placeIce(got) {
    const t0 = performance.now();
    const getH = C.getH, TAU = Math.PI * 2;
    let seed = 90210; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const rr = (a, b) => a + rnd() * (b - a);
    const seaAt = (x, z) => getH(x, z) < -0.6;
    const seaDisk = (x, z, r) => { if (!seaAt(x, z)) return false; for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; if (!seaAt(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false; } return true; };
    // occupancy: worldfill bergs/floes (tall vertices of wf_seaIce), every passport collider, anything already placed
    const OG = 6, occ = new Set(), key = (i, j) => i * 100003 + j;
    const mark = (x, z, r) => { for (let i = Math.floor((x - r) / OG); i <= Math.floor((x + r) / OG); i++) for (let j = Math.floor((z - r) / OG); j <= Math.floor((z + r) / OG); j++) occ.add(key(i, j)); };
    const busy = (x, z, r) => { for (let i = Math.floor((x - r) / OG); i <= Math.floor((x + r) / OG); i++) for (let j = Math.floor((z - r) / OG); j <= Math.floor((z + r) / OG); j++) if (occ.has(key(i, j))) return true; return false; };
    C.scene.traverse((o) => {
      if (!o.isMesh || !/^wf_(seaIce|built|stone)$/.test(o.name)) return;
      const P = o.geometry.attributes.position; o.updateMatrixWorld(); const v = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 2) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); if (v.y > 0.6 && Math.hypot(v.x, v.z) > 250) mark(v.x, v.z, 3); }
    });
    for (const e of (C.Passport.list || [])) { const b = e.box; if (!b || !b.min) continue; const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2; if (Math.hypot(cx, cz) > 250) mark(cx, cz, Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2); }
    const POIS = Object.values(C.POI || {}).filter((p) => p && p.x !== undefined);
    const clearOfPOI = (x, z, r) => POIS.every((p) => Math.hypot(p.x - x, p.z - z) > r + 40);

    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const inst = {};   // name -> { near: [], far: [] } of { m, x, z, r }
    const R = 430 + 40;   // colliders only where the pilot / skimmer can reach
    const put = (name, n, tries, dMin, dMax, sMin, sMax, sink, ext) => {
      const part = got[name]; if (!part) return;
      part.geo.computeBoundingBox(); const bb = part.geo.boundingBox, rad = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2, hgt = bb.max.y - bb.min.y;
      inst[name] = inst[name] || [];
      for (let k = 0, c = 0; k < tries && c < n; k++) {
        const a = rr(0, TAU), d = rr(dMin, dMax), x = Math.cos(a) * d, z = Math.sin(a) * d, s = rr(sMin, sMax), r = rad * s;
        if (busy(x, z, r + 2) || !seaDisk(x, z, r + 3) || !clearOfPOI(x, z, r)) continue;
        const yaw = ext && ext.yaw !== undefined ? ext.yaw(x, z) : rr(0, TAU);
        E.set(rr(-0.03, 0.03), yaw, rr(-0.03, 0.03)); Q.setFromEuler(E); S.set(s, s * rr(0.85, 1.15), s); P.set(x, -sink * s - hgt * 0.02 * s, z);
        M.compose(P, Q, S);
        inst[name].push({ m: M.clone(), x, z, d, r }); mark(x, z, r + 1); c++;
      }
    };
    // bergs out on the pack, pressure ridges as short chains along floe edges, growlers and bergy bits everywhere
    put('env_iceberg_large', 9, 600, 560, 1080, 1.4, 2.8, 0.45);
    put('env_iceberg_tabular', 9, 600, 520, 1060, 1.3, 2.6, 0.35);
    put('env_iceberg_small', 28, 900, 340, 900, 0.7, 2.0, 0.4);
    // ridges: chains of 3–5 segments, each rotated ±15° from the chain direction
    if (got.env_pressure_ridge) {
      const part = got.env_pressure_ridge; part.geo.computeBoundingBox();
      inst.env_pressure_ridge = [];
      for (let ch = 0, k = 0; ch < 9 && k < 400; k++) {
        const a0 = rr(0, TAU), d0 = rr(335, 820); let x = Math.cos(a0) * d0, z = Math.sin(a0) * d0;
        if (busy(x, z, 12) || !seaDisk(x, z, 14) || !clearOfPOI(x, z, 10)) continue;
        const dir = a0 + Math.PI / 2 + rr(-0.5, 0.5), segs = 3 + ((rnd() * 3) | 0); let ok = 0;
        for (let sI = 0; sI < segs; sI++) {
          const s = rr(0.75, 1.25), yaw = -dir + rr(-0.26, 0.26);
          if (!seaDisk(x, z, 9 * s) || (sI > 0 && busy(x, z, 5))) break;
          E.set(0, yaw, 0); Q.setFromEuler(E); S.set(s, s * rr(0.8, 1.3), s); P.set(x, -0.35 * s, z); M.compose(P, Q, S);
          inst.env_pressure_ridge.push({ m: M.clone(), x, z, d: Math.hypot(x, z), r: 8 * s }); ok++;
          x += Math.cos(dir) * 13.5 * s; z += Math.sin(dir) * 13.5 * s;
        }
        for (const it of inst.env_pressure_ridge.slice(-ok)) mark(it.x, it.z, it.r);
        if (ok) ch++;
      }
    }
    put('env_ice_chunk', 90, 1500, 300, 760, 0.4, 2.0, 0.3);

    // seat every reachable piece by the QA burial invariant (share of each footprint column under the snow/ice surface,
    // tools/qa/qa-page.js placedCheck): 12–18 % buried, i.e. sitting IN the sea ice, open undersides still hidden
    {
      const surf = (x, z) => Math.max(getH(x, z), 0) + (C.snowDepthAt ? C.snowDepthAt(x, z) : 0), Vv = new THREE.Vector3();
      for (const name of Object.keys(inst)) {
        const pos = got[name].geo.attributes.position, step = Math.max(1, Math.floor(pos.count / 1500));
        inst[name].forEach((it, k) => {
          if (it.d - it.r >= R) return;
          const v = []; for (let i = 0; i < pos.count; i += step) { Vv.fromBufferAttribute(pos, i).applyMatrix4(it.m); v.push(Vv.x, Vv.y, Vv.z); }
          it.m.elements[13] += seatDy(v, 0.12 + 0.06 * rnd(), surf);
        });
      }
    }
    // build: instanced meshes split into 6 angular sectors per model (frustum culling works per sector)
    A.ice = []; let tris = 0, cols = 0;
    const SECT = 6;
    for (const name of Object.keys(inst)) {
      const part = got[name], list = inst[name]; if (!list.length) continue;
      const bySec = Array.from({ length: SECT }, () => []);
      for (const it of list) bySec[Math.floor(((Math.atan2(it.z, it.x) + Math.PI) / TAU) * SECT) % SECT].push(it);
      const cast = name === 'env_pressure_ridge' || name === 'env_ice_chunk' || name === 'env_iceberg_small';
      const mat = part.mat;
      for (const sec of bySec) {
        if (!sec.length) continue;
        const im = new THREE.InstancedMesh(part.geo, mat, sec.length);
        sec.forEach((it, i) => im.setMatrixAt(i, it.m));
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox && im.computeBoundingBox();
        im.name = 'atm_' + name; im.castShadow = cast; im.receiveShadow = true;
        im.matrixAutoUpdate = false; im.updateMatrix();
        C.scene.add(im); A.ice.push(im);
        tris += (part.geo.index ? part.geo.index.count : part.geo.attributes.position.count) / 3 * sec.length;
        const near = sec.filter((it) => it.d - it.r < R).map((it) => it.m);
        if (near.length) { try { C.Passport.registerInstances(part.geo, near, 'solid', { name: name.replace('env_', '') }); cols += near.length; } catch (e) { console.warn('[atmosphere] collider', name, e); } }
      }
    }
    A.stats.ice = { instances: Object.fromEntries(Object.entries(inst).map(([k, v]) => [k, v.length])), meshes: A.ice.length, tris: Math.round(tris), colliders: cols, ms: Math.round(performance.now() - t0) };
  }

  /* ============================ light shafts (screen-space, from the scene depth) ============================ */
  function makeShaftPass() {
    const post = C.post, composer = post.composer || C.composer;
    if (!post || !composer || !post.sceneRT || !post.sceneRT.depthTexture || !THREE.Pass || !THREE.FullScreenQuad) return null;
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const rays = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: post.sceneRT.depthTexture }, uMoon: { value: new THREE.Vector2(0.5, 0.5) }, uN: { value: 22 }, uNear: { value: 0.1 }, uFar: { value: 3000 }, uAspect: { value: 1.75 }, uLen: { value: 0.55 } },
      vertexShader: vs, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tDepth; uniform vec2 uMoon; uniform float uN, uNear, uFar, uAspect, uLen; varying vec2 vUv;
        float lit(vec2 uv){
          if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return .0;
          float z = texture2D(tDepth, uv).x; if (z >= .99999) return 1.;
          float zn = z * 2. - 1.; float lz = 2. * uNear * uFar / (uFar + uNear - zn * (uFar - uNear));
          return smoothstep(300., 1400., lz) * .5;                              // far hazy ground/mountains: partly lit fog
        }
        void main(){
          vec2 dl = uMoon - vUv; float L = length(dl * vec2(uAspect, 1.));
          vec2 st = dl * min(1., uLen / max(L, 1e-3)) / uN;
          float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));   // interleaved gradient noise
          vec2 p = vUv + st * j; float acc = 0., w = 1., ws = 0.;
          for (int i = 0; i < 32; i++) { if (float(i) >= uN) break; acc += lit(p) * w; ws += w; w *= .96; p += st; }
          acc /= max(ws, 1e-3);
          float self = lit(vUv);
          float fall = exp(-L * 2.6);
          gl_FragColor = vec4(vec3(acc * fall * (1. - .75 * self) + self * exp(-L * 9.) * .25), 1.);
        }`,
    });
    const comp = new THREE.ShaderMaterial({
      uniforms: { tRays: { value: null }, uCol: { value: new THREE.Color(0.5, 0.6, 0.95) }, uK: { value: 0 } },
      vertexShader: vs, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
      fragmentShader: 'uniform sampler2D tRays; uniform vec3 uCol; uniform float uK; varying vec2 vUv; void main(){ gl_FragColor = vec4(uCol * texture2D(tRays, vUv).r * uK, 1.); }',
    });
    const P = new (class ShaftPass extends THREE.Pass {
      constructor() { super(); this.needsSwap = false; this.qa = new THREE.FullScreenQuad(rays); this.qb = new THREE.FullScreenQuad(comp); this.rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: false }); this.w = 8; this.h = 8; this.k = 0; }
      setSize(w, h) { this.w = w; this.h = h; const s = (C.Q.atmShaftScale || 0.5); this.rt.setSize(Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))); rays.uniforms.uAspect.value = w / Math.max(1, h); }
      render(r, w, readBuffer) {
        if (this.k < 0.003) return;
        const ac = r.autoClear; r.autoClear = false;
        r.setRenderTarget(this.rt); this.qa.render(r);
        comp.uniforms.tRays.value = this.rt.texture; comp.uniforms.uK.value = this.k;
        r.setRenderTarget(readBuffer); this.qb.render(r);
        r.autoClear = ac;
      }
    })();
    P.rays = rays; P.comp = comp;
    const idx = composer.passes.indexOf(post.gtao);
    composer.insertPass(P, idx >= 0 ? idx + 1 : 1);
    return P;
  }

  /* ============================ aurora reflections on sea / lake ice ============================ */
  const IU = { uAtmA: null, uAtmB: null, uAtmI: { value: 1 }, uAtmT: { value: 0 } };
  function patchIce(mesh, k) {
    const m = mesh.material; if (!m || m.userData.atmIce) return;
    m.userData.atmIce = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey && m.customProgramCacheKey.bind(m);
    const uK = { value: k };
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      Object.assign(sh.uniforms, IU, { uAtmK: uK });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAtmIce;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvAtmIce = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uAtmA, uAtmB; uniform float uAtmI, uAtmT, uAtmK; varying vec3 vAtmIce;
float atmH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float atmN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f); return mix(mix(atmH(i), atmH(i+vec2(1.,0.)), u.x), mix(atmH(i+vec2(0.,1.)), atmH(i+vec2(1.,1.)), u.x), u.y); }`)
        .replace('#include <fog_fragment>', `{
  vec3 iv = normalize(vAtmIce - cameraPosition);
  vec2 wob = vec2(atmN(vAtmIce.xz * .35), atmN(vAtmIce.zx * .35 + 7.)) - .5;
  vec3 rd = reflect(iv, normalize(vec3(wob.x * .06, 1., wob.y * .06)));
  float az = atan(rd.x, -rd.z); vec2 cs = vec2(cos(az), sin(az));
  float n = atmN(cs * 2.4 * 2. + vec2(uAtmT * .06, 0.));
  float edge = .14 + .05 * sin(az * 2. + uAtmT * .09) + (n - .5) * .18;
  float e = rd.y - edge;
  float c = smoothstep(-.02, .02, e) * exp(-max(e, 0.) * 5.5);
  float rays = .45 + .55 * atmN(cs * 44. + vec2(uAtmT * .25, 0.));
  float fres = .08 + .92 * pow(1. - clamp(-iv.y, 0., 1.), 5.);
  gl_FragColor.rgb += mix(uAtmA, uAtmB, clamp(e * 4.5, 0., 1.)) * c * rays * (.35 + .5 * n) * fres * uAtmI * uAtmK;
}
#include <fog_fragment>`);
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|atmIce';
    m.needsUpdate = true;
  }
  function findIce() {
    C.scene.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
      const p = o.geometry && o.geometry.parameters;
      if (o.geometry.type === 'PlaneGeometry' && p && p.width >= 4000) patchIce(o, 0.22);         // frozen sea
      else if (o.geometry.type === 'CircleGeometry' && p && p.radius > 30 && p.radius < 80) patchIce(o, 0.5);   // lake ice
    });
  }

  /* ============================ falling snow: near streaks + far flakes (GPU-driven) ============================ */
  const SU = { uT: { value: 0 }, uCam: { value: null }, uVel: { value: null }, uStreak: { value: 0 }, uCol: { value: null }, uScale: { value: 400 }, uFogFar: { value: 640 } };
  function buildSnow() {
    SU.uCam.value = new THREE.Vector3(); SU.uVel.value = new THREE.Vector3(1, -1.3, 0.2); SU.uCol.value = new THREE.Color(0.16, 0.18, 0.24);
    // near layer: camera-facing quads, stretched along the screen-space velocity (motion streaks in a blizzard)
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(SNOW_MAX * 4); for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = 0;
    const near = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: Object.assign({ uBox: { value: 26 }, uSize: { value: 0.028 } }, SU),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aSeed; uniform float uT, uBox, uSize, uStreak; uniform vec3 uCam, uVel; varying vec2 vC; varying float vA;
        void main(){
          float spd = .75 + .5 * aSeed.w;
          vec3 vel = uVel * spd + vec3(sin(uT * .7 + aSeed.x * 40.), 0., cos(uT * .6 + aSeed.z * 40.)) * .35 * (1. - uStreak * .7);
          vec3 p = aSeed.xyz * uBox + vel * uT;
          p = mod(p - uCam + uBox * .5, uBox) - uBox * .5;
          vec4 mv = viewMatrix * vec4(p + uCam, 1.);
          vec3 vv = mat3(viewMatrix) * vel;
          float vl = length(vv.xy);
          vec2 dir = vl > 1e-3 ? vv.xy / vl : vec2(0., 1.), perp = vec2(-dir.y, dir.x);
          float size = uSize * (.6 + .8 * aSeed.w);
          float len = size + uStreak * min(vl * .025, .45);
          mv.xy += perp * position.x * size + dir * position.y * len;
          gl_Position = projectionMatrix * mv;
          vC = position.xy;
          vA = smoothstep(.3 + uStreak * .6, 1.2 + uStreak * 1.6, -mv.z) * (1. - smoothstep(uBox * .32, uBox * .5, length(p))) * mix(1., clamp(size / len * 10., .3, 1.), uStreak) * (.6 + .4 * aSeed.y);
        }`,
      fragmentShader: `uniform vec3 uCol; varying vec2 vC; varying float vA;
        void main(){ float a = (1. - vC.x * vC.x) * (1. - abs(vC.y)); gl_FragColor = vec4(uCol * a * vA, 1.); }`,
    }));
    near.frustumCulled = false; near.name = 'atm_snow_near'; near.renderOrder = 5; near.userData.noCollide = true;
    // far layer: points in a large box, dimmed with distance/fog
    const fg = new THREE.BufferGeometry(), fp = new Float32Array(SNOWFAR_MAX * 3);
    for (let i = 0; i < fp.length; i++) fp[i] = Math.random();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setDrawRange(0, 0);
    const far = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: Object.assign({ uBox: { value: 110 }, uSize: { value: 0.05 } }, SU),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uT, uBox, uSize, uScale, uStreak, uFogFar; uniform vec3 uCam, uVel; varying float vA;
        void main(){
          vec4 s = vec4(position.xyz, 0.);
          float w = fract(s.x * 13.7 + s.y * 7.1);
          vec3 vel = uVel * (.75 + .5 * w);
          vec3 p = s.xyz * uBox + vel * uT;
          p = mod(p - uCam + uBox * .5, uBox) - uBox * .5;
          vec4 mv = viewMatrix * vec4(p + uCam, 1.);
          gl_Position = projectionMatrix * mv;
          float d = length(p);
          gl_PointSize = max(1., uSize * (.6 + .8 * w) * uScale / max(-mv.z, .1) * (1. + uStreak));
          vA = smoothstep(9., 15., d) * (1. - smoothstep(uBox * .3, uBox * .5, d)) * (1. - smoothstep(uFogFar * .25, uFogFar * .6, d)) * (.5 + .5 * w);
        }`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ float r = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, r); gl_FragColor = vec4(uCol * a * vA, 1.); }`,
    }));
    far.frustumCulled = false; far.name = 'atm_snow_far'; far.renderOrder = 5; far.userData.noCollide = true;
    C.scene.add(near); C.scene.add(far);
    A.snowNear = near; A.snowFar = far;
    // hide the game's single-layer flakes (1400 points, partMat) — replaced by the two layers above
    C.scene.traverse((o) => { if (o.isPoints && o !== far && o.geometry.attributes.position && o.geometry.attributes.position.count === 1400 && o.visible) { o.visible = false; A.hidden.push('game SNOW points (1400)'); } });
  }

  /* ============================ breath vapour (player, stags) ============================ */
  const BN = 96;
  const B = { i: 0, pos: null, vel: null, age: null, life: null, size: null, pl: { t: 0, puff: 0 }, st: [] };
  function buildBreath() {
    B.pos = new Float32Array(BN * 3); B.vel = new Float32Array(BN * 3); B.age = new Float32Array(BN).fill(1); B.life = new Float32Array(BN).fill(1); B.size = new Float32Array(BN);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3)); g.setAttribute('aAge', new THREE.BufferAttribute(B.age, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(B.size, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uScale: SU.uScale, uCol: { value: new THREE.Color(0.2, 0.23, 0.3) }, uK: { value: 1 } },
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aAge, aSize; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * (.35 + 1.4 * aAge) * uScale / max(-mv.z, .1); vA = aAge < 1. ? smoothstep(0., .12, aAge) * pow(1. - aAge, 1.6) : 0.; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uK; varying float vA;
        void main(){ float r = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., r); a *= a; gl_FragColor = vec4(uCol, a * vA * .34 * uK); }`,
    }));
    pts.frustumCulled = false; pts.name = 'atm_breath'; pts.renderOrder = 6; pts.userData.noCollide = true;
    C.scene.add(pts); B.pts = pts;
  }
  function puff(x, y, z, fx, fz, big) {
    const i = B.i; B.i = (B.i + 1) % BN; const o = i * 3;
    B.pos[o] = x + (Math.random() - 0.5) * 0.05; B.pos[o + 1] = y; B.pos[o + 2] = z + (Math.random() - 0.5) * 0.05;
    const sp = 0.55 + Math.random() * 0.35;
    B.vel[o] = fx * sp; B.vel[o + 1] = 0.08 + Math.random() * 0.1; B.vel[o + 2] = fz * sp;
    B.age[i] = 0; B.life[i] = (big ? 1.6 : 1.2) + Math.random() * 0.5; B.size[i] = big ? 0.5 : 0.32;
  }
  function updateBreath(dt, P) {
    const ctx = C, G = ctx.G, pl = ctx.player, WX = ctx.WX;
    const wind = SU.uVel.value;
    const on = G.mode === 'play' && P.breath > 0.05;
    if (on && pl && pl.c && pl.c.g.visible !== false && !G.riding) {
      const spd = Math.hypot(pl.vx || 0, pl.vz || 0);
      const period = spd > 6 ? 1.3 : spd > 1.5 ? 2.1 : 3.4;
      B.pl.t += dt;
      if (B.pl.t > period) { B.pl.t = 0; B.pl.puff = 0.45; }
      if (B.pl.puff > 0) {
        B.pl.puff -= dt;
        if (Math.random() < dt * 22 * P.breath) {
          const f = pl.face || 0, fx = -Math.sin(f), fz = -Math.cos(f);
          puff(pl.x + fx * 0.28, (pl.y || 0) + 1.66, pl.z + fz * 0.28, fx, fz, false);
        }
      }
    }
    // stags within 70 m of the camera
    const cam = ctx.camera.position;
    if (on && ctx.STAGS) for (let s = 0; s < ctx.STAGS.length; s++) {
      const st = ctx.STAGS[s]; if (!st.g || !st.g.visible) continue;
      if ((st.x - cam.x) ** 2 + (st.z - cam.z) ** 2 > 4900) continue;
      let b = B.st[s]; if (!b) { b = B.st[s] = { t: Math.random() * 3, puff: 0, h: 0, l: 0 };
        const box = new THREE.Box3().setFromObject(st.g); const sz = box.getSize(new THREE.Vector3()); b.h = Math.min(Math.max(sz.y * 0.78, 1.1), 2.4); b.l = Math.min(Math.max(Math.max(sz.x, sz.z) * 0.46, 0.7), 1.6); }
      b.t += dt; const per = st.st === 'flee' ? 1.1 : 3.8;
      if (b.t > per) { b.t = 0; b.puff = 0.5; }
      if (b.puff > 0) { b.puff -= dt; if (Math.random() < dt * 18 * P.breath) { const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw); puff(st.x + fx * b.l, st.g.position.y + b.h, st.z + fz * b.l, fx, fz, true); } }
    }
    const drag = Math.exp(-2.2 * dt), wk = 0.12 * (WX ? 1 + WX.storm * 3 : 1);
    for (let i = 0; i < BN; i++) {
      if (B.age[i] >= 1) continue;
      const o = i * 3;
      B.vel[o] = B.vel[o] * drag + wind.x * wk * dt; B.vel[o + 1] = B.vel[o + 1] * drag + 0.12 * dt; B.vel[o + 2] = B.vel[o + 2] * drag + wind.z * wk * dt;
      B.pos[o] += B.vel[o] * dt; B.pos[o + 1] += B.vel[o + 1] * dt; B.pos[o + 2] += B.vel[o + 2] * dt;
      B.age[i] = Math.min(1, B.age[i] + dt / B.life[i]);
    }
    const g = B.pts.geometry; g.attributes.position.needsUpdate = true; g.attributes.aAge.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }

  /* ============================ cheap light baking: sky visibility + contact AO into vertex colours ============================ */
  const BAKE = { queue: [], done: new WeakSet() };
  function bakeAO(mesh, opts) {
    if (!mesh || !mesh.isMesh || mesh.isInstancedMesh) return false;
    const geo = mesh.geometry, col = geo.attributes.color;
    if (!col || BAKE.done.has(geo)) return false;
    BAKE.done.add(geo);
    BAKE.queue.push({ mesh, geo, i: 0, o: Object.assign({ min: 0.5, contact: 1.4, strength: 1 }, opts || {}) });
    return true;
  }
  const _v = { p: null, n: null, m3: null };
  function stepBake(budget) {
    const job = BAKE.queue[0]; if (!job) return;
    const { mesh, geo, o } = job, P = geo.attributes.position, N = geo.attributes.normal, Cc = geo.attributes.color, getH = C.getH;
    if (!_v.p) { _v.p = new THREE.Vector3(); _v.n = new THREE.Vector3(); _v.m3 = new THREE.Matrix3(); }
    mesh.updateMatrixWorld(); _v.m3.getNormalMatrix(mesh.matrixWorld);
    const end = Math.min(P.count, job.i + budget), D = [[1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0], [-0.5, -0.866], [0.5, -0.866]];
    for (let i = job.i; i < end; i++) {
      const p = _v.p.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
      const n = N ? _v.n.fromBufferAttribute(N, i).applyMatrix3(_v.m3).normalize() : _v.n.set(0, 1, 0);
      const g = Math.max(getH(p.x, p.z), 0), hA = p.y - g;
      if (hA > 40) continue;
      // contact: faces near the ground that don't look up get darker
      const contact = 1 - (1 - smooth(0, o.contact, hA)) * (1 - Math.max(n.y, 0) * 0.75) * 0.5;
      const under = n.y < 0 ? 1 - (-n.y) * 0.3 * (1 - smooth(0.5, 4, hA)) : 1;
      // terrain horizon (valleys, cliff feet): mean elevation angle in 6 directions at 8 and 22 m
      let occl = 0;
      for (const d of D) { const a = (getH(p.x + d[0] * 8, p.z + d[1] * 8) - p.y) / 8, b = (getH(p.x + d[0] * 22, p.z + d[1] * 22) - p.y) / 22; occl += Math.max(0, Math.max(a, b)); }
      const sky = 1 - Math.min(0.35, occl / 6 * 0.45);
      const ao = Math.max(o.min, 1 - (1 - contact * under * sky) * o.strength);
      Cc.setXYZ(i, Cc.getX(i) * ao, Cc.getY(i) * ao, Cc.getZ(i) * ao);
    }
    job.i = end;
    if (job.i >= P.count) { Cc.needsUpdate = true; BAKE.queue.shift(); A.stats.baked = (A.stats.baked || 0) + P.count; }
  }
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  /* ============================ selection + blending ============================ */
  const TMP = {};
  function computeTarget(out) {
    const G = C.G, WX = C.WX, cam = C.camera.position;
    let base = 'clear_aurora';
    let wr = 0, wm = 0;
    if (A.auto) {
      if (G.ending === 'take') base = 'overcast';
      else if (G.ending === 'free' || G.aurora > 1.5) base = 'aurora_flare';
      else if (G.aurora < 0.5) base = 'overcast';
      if (base === 'clear_aurora') {
        // rift proximity → rift_glow; the lake and a slow ambient cycle → calm_mist
        const rd = C.riftD ? C.riftD(cam.x, cam.z) : 1e9;
        wr = 1 - smooth(25, 150, rd);
        const lk = C.POI && C.POI.lake; const ld = lk ? Math.hypot(cam.x - lk.x, cam.z - lk.z) : 1e9;
        const cyc = smooth(0.55, 0.9, Math.sin(C.T / 190 - 1.3));
        wm = Math.max((1 - smooth(50, 140, ld)) * 0.65, cyc * 0.8) * (1 - wr);
      }
    } else base = A.manual;
    copyInto(out, DEC[base]);
    if (wr > 0.001) blendInto(out, out, DEC.rift_glow, wr);
    if (wm > 0.001) blendInto(out, out, DEC.calm_mist, wm);
    const wb = base === 'blizzard' ? 0 : WX ? WX.storm : 0;
    if (wb > 0.001) blendInto(out, out, DEC.blizzard, wb);
    A.weights.base = base; A.weights.rift = +wr.toFixed(2); A.weights.mist = +wm.toFixed(2); A.weights.blizzard = +wb.toFixed(2);
    // name = the dominant look
    let name = base, w = 1 - Math.max(wr, wm, wb);
    if (wr > w) { name = 'rift_glow'; w = wr; } if (wm > w) { name = 'calm_mist'; w = wm; } if (wb > w) name = 'blizzard';
    A.name = name;
    return out;
  }

  const _c = { a: null, cam: null, fwd: null };
  let envT = 0, lastQ = '';
  function apply(dt) {
    const P = A.params, ctx = C, Q = ctx.Q, G = ctx.G;
    // fog
    ctx.FOG.copy(P.fog);
    const fog = ctx.scene.fog; if (fog) { fog.color.copy(P.fog); if (fog.isFog) { fog.near = P.fogNear; fog.far = P.fogFar; } }
    const lakeH = ctx.POI && ctx.POI.lake && ctx.POI.lake.h !== undefined ? ctx.POI.lake.h : 0;
    HF.x = P.hfDen; HF.y = 1 / Math.max(0.5, P.hfH); HF.z = lakeH * 0.6; HF.w = P.hfMax;
    HC.x = P.hfCol.r; HC.y = P.hfCol.g; HC.z = P.hfCol.b;
    MD.w = P.scatter;
    // sky
    const U = ctx.skyU;
    if (U.uExp) { U.uExp.value = P.skyExp; U.uStarK.value = P.stars; U.uVeil.value = P.veil; U.uScat.value = P.scatter; }
    U.uStorm.value = P.storm;
    // aurora: preset intensity; story value (G.aurora) is folded in by the preset choice
    U.uInt.value = P.aur;
    const aA = U.uA.value, aB = U.uB.value;
    aA.copy(P.aurA); aB.copy(P.aurB);
    if (P.aurCycle > 0.01) { _c.a = _c.a || new THREE.Color(); _c.a.setHSL((ctx.T * 0.03) % 1, 0.9, 0.6); aA.lerp(_c.a, P.aurCycle); }
    ctx.aurLight.color.copy(aA); ctx.aurLight.intensity = P.aurLight;
    ctx.moon.intensity = P.moon; ctx.hemi.intensity = P.hemi;
    ctx.moon.color.copy(P.moonCol); ctx.hemi.color.copy(P.hemiSky); ctx.hemi.groundColor.copy(P.hemiGnd);
    ctx.scene.environmentIntensity = P.envK;   // sky reflections (aurora-green, blue) on every PBR material
    if (ctx.post && ctx.post.bloom) ctx.post.bloom.strength = P.bloom;
    ctx.renderer.toneMappingExposure = P.exposure;
    // mountains
    if (MU.uAtmHaze) {
      MU.uAtmHaze.value.set(0.0008 * P.haze, 110 + 40 * P.hfMax, 0.9, Math.min(1, P.storm));
      MU.uAtmScat.value = P.scatter;
      const lit = Math.min(1.1, 0.35 + P.moon / 2.8 * 0.65); MU.uAtmSnowK.value.setRGB(lit, lit, lit);
      MU.uAtmRim.value.setRGB(0.10, 0.13, 0.22).multiplyScalar(P.moon / 2.8);
    }
    // ice reflections
    if (IU.uAtmA) { IU.uAtmI.value = P.aur * P.iceAur * (Q.atmIceMax !== undefined ? Q.atmIceMax : 1); IU.uAtmT.value = ctx.T; }
    // snow
    if (A.snowNear) {
      SU.uT.value = ctx.T % 3000; SU.uCam.value.copy(ctx.camera.position);
      SU.uVel.value.set(P.wind * 0.98, -P.fall, P.wind * 0.18);
      SU.uStreak.value = P.streak; SU.uFogFar.value = P.fogFar;
      const lit = (0.035 + 0.02 * P.moon + 0.03 * P.hemi) * (1 + P.streak * 0.8); SU.uCol.value.setRGB(lit * 0.9, lit * 0.96, lit * 1.1);
      SU.uScale.value = ctx.renderer.domElement.height * 0.5 / Math.tan(ctx.camera.fov * Math.PI / 360);
      A.snowNear.geometry.instanceCount = Math.min(SNOW_MAX, Math.round((Q.atmSnow || 2400) * P.snow));
      A.snowFar.geometry.setDrawRange(0, Math.min(SNOWFAR_MAX, Math.round((Q.atmSnowFar || 5200) * P.snowFar)));
    }
    if (B.pts) { const lit = 0.1 + 0.05 * P.moon + 0.05 * P.hemi; B.pts.material.uniforms.uCol.value.setRGB(lit * 0.92, lit * 0.97, lit * 1.08); B.pts.material.uniforms.uK.value = Math.min(1.4, P.breath); }
    // light shafts
    const SP = A.shafts;
    if (SP) {
      const n = Q.atmShafts || 0;
      let k = 0;
      if (n > 0 && P.shafts > 0.01) {
        const cam = ctx.camera; _c.fwd = _c.fwd || new THREE.Vector3(); _c.cam = _c.cam || new THREE.Vector3();
        cam.getWorldDirection(_c.fwd);
        const facing = _c.fwd.dot(ctx.MOON_DIR);
        if (facing > -0.1) {
          _c.cam.copy(cam.position).addScaledVector(ctx.MOON_DIR, 1000).project(cam);
          SP.rays.uniforms.uMoon.value.set(_c.cam.x * 0.5 + 0.5, _c.cam.y * 0.5 + 0.5);
          const off = Math.max(Math.abs(_c.cam.x), Math.abs(_c.cam.y));
          k = P.shafts * smooth(-0.1, 0.45, facing) * (1 - smooth(1.2, 2.4, off)) * (1 - P.veil * 0.8) * 0.26 * (P.moon / 2.8);
        }
        SP.rays.uniforms.uN.value = n; SP.rays.uniforms.uNear.value = cam.near; SP.rays.uniforms.uFar.value = cam.far;
        SP.comp.uniforms.uCol.value.copy(ctx.moon.color);
      }
      SP.k = k; SP.enabled = k > 0.003;
    }
    // quality switch → shaft target size
    if (Q.name !== lastQ) { lastQ = Q.name; if (SP) SP.setSize(SP.w, SP.h); }
    // environment re-bake when the look changed (throttled, cheap 128² PMREM)
    if (ctx.ENV) {
      const key = P.fog.r * 40 + P.fog.g * 40 + P.fog.b * 40 + P.veil * 2 + P.skyExp;
      envT += dt;
      if (A._envKey === undefined) A._envKey = key;
      if (Math.abs(key - A._envKey) > 0.08 && envT > 2) { ctx.ENV.dirty = true; A._envKey = key; envT = 0; }
    }
  }

  /* ============================ module ============================ */
  function init(ctx) {
    C = ctx; THREE = ctx.THREE;
    for (const k in PRESETS) DEC[k] = decode(PRESETS[k]);
    A.params = decode(PRESETS.clear_aurora); A.target = decode(PRESETS.clear_aurora);
    // quality knobs
    for (const q in QKNOBS) if (ctx.QUALITY[q]) Object.assign(ctx.QUALITY[q], QKNOBS[q]);
    // FIX-LOOK: moon shadows stay crisp to ≥ 80 m (targets.json: readable to 80–150 m in full moon). Same 2 cascades and
    // map size (no cost change): split λ .85 → .38 moves the first cascade's far edge from ≈ 23 m to ≈ 80 m on high/ultra.
    for (const [q, v] of [['med', 0.5], ['high', 0.38], ['ultra', 0.38]]) if (ctx.QUALITY[q]) ctx.QUALITY[q].split = v;
    if (ctx.QUALITY[ctx.Q.name]) { ctx.Q.split = ctx.QUALITY[ctx.Q.name].split; if (ctx.moon && ctx.moon.shadow) ctx.moon.shadow.splitLambda = ctx.Q.split; }
    if (ctx.QUALITY[ctx.Q.name]) Object.assign(ctx.Q, QKNOBS[ctx.Q.name] || {});
    ctx.setAtmosphere = setAtmosphere;
    Object.defineProperty(ctx, 'atmosphere', { get: () => A, configurable: true });
    ctx.ATMO_PRESETS = PRESETS;
    ctx.bakeAO = bakeAO;
    patchFogChunks();
    patchSky();
    buildMountains();
    buildIce();
    IU.uAtmA = ctx.skyU.uA; IU.uAtmB = ctx.skyU.uB;
    findIce();
    buildSnow();
    buildBreath();
    try { A.shafts = makeShaftPass(); } catch (e) { console.warn('[atmosphere] shafts off', e); A.shafts = null; }
    A.t = 0;
  }

  function update(dt, ctx) {
    if (ctx !== C) C = ctx;
    A.t += dt;
    if (!A.auto) {
      if (A.holdT > 0 && (A.holdT -= dt) <= 0) setAtmosphere('auto', 6);
      else if (A.manual === 'blizzard' && ctx.WX && ctx.WX.target === 0) setAtmosphere('auto', 8);   // the game ended the storm
    }
    computeTarget(A.target);
    const k = 1 - Math.exp(-dt * 3 / Math.max(0.05, A.transition));
    blendInto(A.params, A.params, A.target, k);
    apply(dt);
    updateBreath(Math.min(dt, 0.05), A.params);
    // late work: the game or other modules may add/replace meshes after init
    if ((A.t > 1 && A.t < 1.2) || ((A.t | 0) % 5 === 0 && A.t % 5 < dt)) {
      hideOld(); findIce();
      ctx.scene.traverse((o) => { if (o.isMesh && (o.name === 'wf_stone' || o.name === 'wf_built' || o.userData.bakeAO)) bakeAO(o, o.userData.bakeAO); });
    }
    if (BAKE.queue.length) stepBake(6000);
  }

  // ?noatmo in the page URL skips the module (A/B measurements: node tools/stand.mjs x --page 'open-world.html?noatmo')
  if (!/[?&]noatmo\b/.test(location.search)) (window.GameModules = window.GameModules || []).push({ name: 'atmosphere', order: -10, init, update });
})();
