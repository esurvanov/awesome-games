/* Module "terrain" — terrain detail rings, snow materials, snow depth + deformation, sea/lake ice.
 * Owned by the TERRAIN & SNOW agent (wave 2). See TERRAIN.md.
 *
 * Public API (also on ctx / MODCTX and window.Terrain):
 *   snowDepthAt(x, z)          loose snow depth in metres (drifts deeper, trails compressed)
 *   surfaceAt(x, z, y?)        'snow' | 'deep_snow' | 'ice' | 'rock' | 'metal' | 'wood'  (y = feet height: objects)
 *   slopeAt(x, z, r = 1)       physics ground slope in degrees
 *   snowCover(target, opts)    snow accumulation shader chunk for any Mesh*Material / Object3D
 *   snowContact(x, z)          { s0 undisturbed snow y, floor compacted y, dep loose depth, surf, press } (SNOW-CONTACT)
 *   snowFine(x, z)             1 where the fine object-pressed map (real print geometry) covers (x, z)
 *   snowField.sample(x, z)     [surface y, loose depth] (groundblend hook)
 *   addFootprint / stamp(...)  API shims only (no caller): an analytic shape pressed into the fine map
 *   windDir                    {x, z} prevailing wind (blows towards)
 * SNOW-CONTACT.md: snow is pressed by the objects' own geometry (drawn from below into a fine map), no stamps.
 * The physics heightfield H is never modified: the rendered snow sits on top of it (loose snow the feet sink into).
 */
(function () {
  const TR = (window.Terrain = window.Terrain || {});
  let ctx, THREE, renderer, scene;
  const DMAX = 1.0;                         // depth texture range (m)
  const DN = 1024;                          // world snow-depth / smooth-height texture resolution
  const DSC = 0.5;                          // coarse deformation map: metres per unit (RGBA8: R depression, G rim)
  const KNOBS = {                           // added to QUALITY presets (see TERRAIN.md, SNOW-CONTACT.md)
    // contact* (SNOW-CONTACT): the fine object-pressed snow map around the pilot (texels, window m), the real-geometry
    // snow patch drawn from it (m, vertex step in map texels), static props pressing it too (0/1)
    low:   { terrainLevels: 3, terrainGrid: 64,  deformRes: 512,  deformExt: 96,  contactRes: 512,  contactExt: 12.8, contactPatch: 5, contactStep: 2, contactStatic: 1 },
    med:   { terrainLevels: 4, terrainGrid: 64,  deformRes: 1024, deformExt: 128, contactRes: 768,  contactExt: 14.4, contactPatch: 6, contactStep: 2, contactStatic: 1 },
    high:  { terrainLevels: 4, terrainGrid: 96,  deformRes: 1024, deformExt: 128, contactRes: 1024, contactExt: 16,   contactPatch: 7, contactStep: 2, contactStatic: 1 },
    ultra: { terrainLevels: 4, terrainGrid: 160, deformRes: 1024, deformExt: 128, contactRes: 1024, contactExt: 16,   contactPatch: 8, contactStep: 1, contactStatic: 1 },
  };

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  /* ================================================================ GLSL */
  const GLSL_NOISE = /* glsl */`
    float trHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float trVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(trHash(i), trHash(i + vec2(1., 0.)), f.x), mix(trHash(i + vec2(0., 1.)), trHash(i + vec2(1., 1.)), f.x), f.y); }
    float trLum(vec3 c){ return dot(c, vec3(.3, .55, .15)); }
    // integer lattice hash (SNOW-CONTACT): bit-identical on the CPU (Math.imul), so the CPU replay of the snow micro
    // relief equals what the GPU draws (the float hash differs between float32 GPU and float64 JS by up to ~2 cm)
    float trHashI(ivec2 i){ uvec2 u = uvec2(i + 1048576); uint h = u.x * 1597334677u ^ u.y * 3812015801u;   // offset: lattice coords stay positive (no signed→unsigned conversion)
      h = h * 747796405u + 2891336453u;
      h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u; h = (h >> 22u) ^ h; return float(h >> 8u) * (1. / 16777216.); }
    float trVNI(vec2 p){ vec2 fl = floor(p); ivec2 i = ivec2(fl); vec2 f = p - fl; f = f * f * (3. - 2. * f);
      return mix(mix(trHashI(i), trHashI(i + ivec2(1, 0)), f.x), mix(trHashI(i + ivec2(0, 1)), trHashI(i + ivec2(1, 1)), f.x), f.y); }
  `;
  const GLSL_MS = /* glsl */`
    // rotated multi-scale sampling (continuous uv → implicit derivatives, no textureGrad): second tap rotated + scaled,
    // luminance-aware blend by a low-frequency weight; the second tap's normal is rotated back. rot = 0 → scale only.
    void trMS(sampler2D td, sampler2D tn, vec2 uv, float w, float rot, out vec3 c, out vec3 n){
      float cr = cos(rot), sr = sin(rot); mat2 R = mat2(cr, sr, -sr, cr);
      vec2 uv2 = R * uv * .71 + vec2(.37, .61);
      vec3 ca = texture(td, uv).rgb, cb = texture(td, uv2).rgb;
      vec3 na = texture(tn, uv).rgb, nb = texture(tn, uv2).rgb;
      float b = smoothstep(.3, .7, w + (trLum(cb) - trLum(ca)) * .5);
      vec2 nbx = transpose(R) * (nb.xy * 2. - 1.);
      c = mix(ca, cb, b); n = vec3(mix(na.xy * 2. - 1., nbx, b) * .5 + .5, mix(na.z, nb.z, b));
    }
  `;
  // terrain tint (same as the game's tintColor, decoded to linear): brightness jitter, rift violet, shore blue
  const GLSL_TINT = /* glsl */`
    void trTint(vec2 p, float y, float ra){
      float dr = 80. - 40. * ra;
      vec3 t = vec3(1.);
      float s = smoothstep(.9, 0., y); t = mix(t, vec3(.8, .93, 1.05), s);
      float r = smoothstep(72., 45., dr); t = mix(t, vec3(.62, .46, .95), r);
      t *= .9 + trVN(p * .04 + vec2(3., 0.)) * .2;
      vTint = pow(t, vec3(2.2)); vRock = smoothstep(62., 42., dr) * .9;
    }
  `;
  // snow surface functions (no varyings: shared by the rings, the contact patch and the contact passes)
  // exact snow surface = smooth(H) + loose snow (depth texture) + micro relief − deformation
  const GLSL_SNOWFN = /* glsl */`
    uniform sampler2D tBase, tDD, tDef;
    uniform float uW, uHsN, uDT; uniform vec4 uDef; uniform float uDefOn; uniform vec2 uWind;
    float trHs(vec2 p){
      vec2 g = (p + uW * .5) / (uW / uHsN) - .5; vec2 i = floor(g), f = g - i; float m = uHsN - 1.;
      ivec2 a = ivec2(clamp(i, vec2(0.), vec2(m))), b = ivec2(clamp(i + 1., vec2(0.), vec2(m)));
      vec2 q00 = texelFetch(tDD, a, 0).rg, q10 = texelFetch(tDD, ivec2(b.x, a.y), 0).rg, q01 = texelFetch(tDD, ivec2(a.x, b.y), 0).rg, q11 = texelFetch(tDD, b, 0).rg;
      float h00 = q00.x + q00.y, h10 = q10.x + q10.y, h01 = q01.x + q01.y, h11 = q11.x + q11.y;   // hi + lo halves
      return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
    }
    float trHb(vec2 p){   // the far mesh: same triangle split as getH()
      vec2 g = (p + uW * .5) / (uW / 256.); vec2 i = clamp(floor(g), vec2(0.), vec2(255.)); vec2 f = clamp(g - i, 0., 1.); ivec2 a = ivec2(i);
      float ha = texelFetch(tBase, a, 0).r, hb = texelFetch(tBase, a + ivec2(0, 1), 0).r, hc = texelFetch(tBase, a + ivec2(1, 1), 0).r, hd = texelFetch(tBase, a + ivec2(1, 0), 0).r;
      if (f.x + f.y <= 1.) return ha + (hd - ha) * f.x + (hb - ha) * f.y;
      return hc + (hb - hc) * (1. - f.x) + (hd - hc) * (1. - f.y);
    }
    float trRiftA(vec2 p){
      vec2 g = (p + uW * .5) / (uW / 256.); vec2 i = clamp(floor(g), vec2(0.), vec2(255.)); vec2 f = clamp(g - i, 0., 1.); ivec2 a = ivec2(i);
      return mix(mix(texelFetch(tBase, a, 0).g, texelFetch(tBase, a + ivec2(1, 0), 0).g, f.x), mix(texelFetch(tBase, a + ivec2(0, 1), 0).g, texelFetch(tBase, a + ivec2(1, 1), 0).g, f.x), f.y);
    }
    float trLodW(float lambda, float s){ return clamp(lambda / s * .33 - 1., 0., 1.); }
    // INT-SNOW (FIX-LOOK follow-up): sastrugi used to be one wavelength, one direction, everywhere the snow was thick
    // enough (uniform "corduroy"). Now: (a) a slow patch mask makes them rare — sparse wind-exposed streaks, not a
    // blanket; (b) the wind axis fans out ±~70° patch to patch instead of one exact direction; (c) the spacing itself
    // varies ~0.55–1.4×. The caller also fades this out in the deepest drifts (smooth mounds there, see trSnow/snowSurfaceAt).
    float trMicro(vec2 p, float s, float expo){
      vec2 w = uWind;
      float rot = (trVNI(p * .012 + 151.) - .5) * 2.6;
      float cr = cos(rot), sr = sin(rot); vec2 wv = vec2(w.x * cr - w.y * sr, w.x * sr + w.y * cr);
      vec2 q = vec2(dot(p, wv), dot(p, vec2(-wv.y, wv.x)));
      float h = (trVNI(p * .14) - .5) * .15 * trLodW(7., s) + (trVNI(p * .37 + 17.) - .5) * .07 * trLodW(2.7, s);
      float freqJ = .55 + .85 * trVNI(p * .021 + 71.);
      float patchM = smoothstep(.6, .88, trVNI(p * .017 + 91.));   // INT-LIGHT: 'patch' is a reserved GLSL word on some ANGLE/Metal drivers — renaming only, same value
      float sa = trVNI(vec2(q.x * .21 * freqJ, q.y * 1.25 * freqJ) + 5.); sa = 1. - abs(sa * 2. - 1.); sa *= sa;           // sastrugi: long along the (locally fanned) wind
      float sb = trVNI(vec2(q.x * .55 * freqJ, q.y * 3.2 * freqJ) + 11.); sb = 1. - abs(sb * 2. - 1.);
      h += ((sa - .45) * .13 * trLodW(.8, s) + (sb - .5) * .045 * trLodW(.31, s)) * expo * patchM;
      return clamp(h, -.16, .16);
    }
    // SNOW-CONTACT: the coarse map holds metres (× ${DSC}): R = mean depression pressed by objects, G = mean rim
    vec2 trDefAt(vec2 p, float s){
      vec2 uv = (p - uDef.xy) / uDef.z + .5; vec2 e = min(uv, 1. - uv);
      float edge = clamp(min(e.x, e.y) * uDef.z / 4., 0., 1.);
      if (edge <= 0. || uDefOn < .5) return vec2(0.);
      return textureLod(tDef, uv, max(0., log2(s / uDef.w))).rg * edge * ${DSC.toFixed(2)};
    }
    // undisturbed loose snow above the smooth ground (m): depth field + micro relief, nothing pressed
    float trSnowU(vec2 p, float s, out float dep, out float grv){
      vec2 dg = textureLod(tDD, (p + uW * .5) / uW, max(0., log2(s / uDT))).ba;
      dep = dg.r * ${DMAX.toFixed(2)}; grv = dg.g;
      float m = trMicro(p, s, smoothstep(.03, .14, dep) * (1. - smoothstep(.2, .34, dep))) * smoothstep(.0, .08, dep);
      return max(dep + m, 0.);
    }
    // drawn loose snow: undisturbed − what objects pressed (never below the compacted 20 %) + displaced rim
    float trSnow(vec2 p, float s, out float dep, out float grv){
      float loose = trSnowU(p, s, dep, grv);
      vec2 pr = trDefAt(p, s);
      return max(loose - pr.x, loose * .2) + pr.y;
    }
  `;
  const GLSL_DETAIL_V = /* glsl */`
    uniform vec4 uLv; uniform vec2 uLvL;
    varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vRock; varying float vDepth; varying float vGrav;
    ${GLSL_NOISE}
    ${GLSL_TINT}
    ${GLSL_SNOWFN}
  `;
  const GLSL_DETAIL_MAIN = /* glsl */`
    vec2 trG = position.xz; float trN = uLv.w, trS = uLv.z;
    vec2 trP0 = uLv.xy + (trG - trN * .5) * trS;
    float trCh = max(abs(trP0.x - uLv.x), abs(trP0.y - uLv.y)) / (trN * .5 * trS);
    float trA = clamp((trCh - (1. - 28. / trN)) / (20. / trN), 0., 1.);
    vec2 trGm = trG - mod(trG, 2.) * trA;
    vec2 trP = uLv.xy + (trGm - trN * .5) * trS;
    float trSp = trS * exp2(trA);
    float trDep, trGrv, trD2, trG2;
    float trH = trHs(trP) + trSnow(trP, trSp, trDep, trGrv);
    float e1 = uW / uHsN, e2 = max(trSp, .12);
    vec2 trGr = vec2(trHs(trP + vec2(e1, 0.)) - trHs(trP - vec2(e1, 0.)), trHs(trP + vec2(0., e1)) - trHs(trP - vec2(0., e1))) / (2. * e1)
      + vec2(trSnow(trP + vec2(e2, 0.), trSp, trD2, trG2) - trSnow(trP - vec2(e2, 0.), trSp, trD2, trG2),
             trSnow(trP + vec2(0., e2), trSp, trD2, trG2) - trSnow(trP - vec2(0., e2), trSp, trD2, trG2)) / (2. * e2);
    vec3 trNrm = normalize(vec3(-trGr.x, 1., -trGr.y));
    if (uLvL.y > .5) trH = mix(trH, trHb(trP), trA);
    vW = vec3(trP.x, trH, trP.y); vN = trNrm;
    trTint(trP, trH, trRiftA(trP)); vDepth = trDep; vGrav = trGrv;
    vec3 objectNormal = trNrm;
    #ifdef USE_TANGENT
      vec3 objectTangent = vec3(1., 0., 0.);
    #endif
  `;
  // SNOW-CONTACT near map (shared by the patch vertex stage and the ring/patch fragment stage):
  //   tNR  RG32F   R the drawn snow surface (world y) per texel: undisturbed − pressed by objects + displaced rim,
  //                G compaction (share of the loose snow pressed down) — the only near-map texture the fragment stage reads
  //   tNS  RGBA32F undisturbed surface y, loose depth, compacted floor y, gravel mask (baked when the window moves)
  //   tNP  RGBA16F R depression by any object (m), G depression by moving objects only (the rim source)
  // uCM = (window centre x, z, extent m, resolution)
  const GLSL_CM = /* glsl */`
    uniform sampler2D tNR; uniform vec4 uCM; uniform float uCMOn; uniform vec4 uPc;
    float cmH(ivec2 t){ return texelFetch(tNR, clamp(t, ivec2(0), ivec2(int(uCM.w) - 1)), 0).r; }
    // height (x) + gradient (yz) of the drawn surface at a world point: central differences at the 4 surrounding texels,
    // blended bilinearly (C0-continuous normal, no faceting at texel scale)
    vec3 cmHG(vec2 p){
      float e = uCM.z / uCM.w; vec2 g = (p - uCM.xy) / e + uCM.w * .5 - .5; ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
      float h00 = cmH(i), h10 = cmH(i + ivec2(1, 0)), h01 = cmH(i + ivec2(0, 1)), h11 = cmH(i + ivec2(1, 1));
      float hm0 = cmH(i + ivec2(-1, 0)), hm1 = cmH(i + ivec2(-1, 1)), h20 = cmH(i + ivec2(2, 0)), h21 = cmH(i + ivec2(2, 1));
      float h0m = cmH(i + ivec2(0, -1)), h1m = cmH(i + ivec2(1, -1)), h02 = cmH(i + ivec2(0, 2)), h12 = cmH(i + ivec2(1, 2));
      vec2 g00 = vec2(h10 - hm0, h01 - h0m), g10 = vec2(h20 - h00, h11 - h1m), g01 = vec2(h11 - hm1, h02 - h00), g11 = vec2(h21 - h01, h12 - h10);
      return vec3(mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y), mix(mix(g00, g10, f.x), mix(g01, g11, f.x), f.y) / (2. * e));
    }
    float cmPress(vec2 p){
      float e = uCM.z / uCM.w; vec2 g = (p - uCM.xy) / e + uCM.w * .5 - .5; ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i); ivec2 m = ivec2(int(uCM.w) - 1);
      float a = texelFetch(tNR, clamp(i, ivec2(0), m), 0).g, b = texelFetch(tNR, clamp(i + ivec2(1, 0), ivec2(0), m), 0).g;
      float c = texelFetch(tNR, clamp(i + ivec2(0, 1), ivec2(0), m), 0).g, d = texelFetch(tNR, clamp(i + ivec2(1, 1), ivec2(0), m), 0).g;
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
  `;
  // contact patch vertex stage: a grid of real geometry on the near map's texel centres (uPt = first texel x, z, step,
  // quads per side; the outermost ring of vertices is a skirt 15 cm down). In its last uPc.w metres it morphs into the
  // surface the detail ring under it draws (same formula + the ring's own spacing), so the two meet without a step.
  const GLSL_PATCH_V = /* glsl */`
    uniform vec4 uPt; uniform vec4 uRL[4]; uniform sampler2D tNS;
    ${GLSL_CM}
    float trRingSp(vec2 p){
      for (int L = 0; L < 4; L++) { vec4 l = uRL[L]; if (l.z <= 0.) break;
        float ch = max(abs(p.x - l.x), abs(p.y - l.y)) / (l.w * .5 * l.z);
        if (ch < 1.) { float a = clamp((ch - (1. - 28. / l.w)) / (20. / l.w), 0., 1.); return l.z * exp2(a); } }
      return 3.5;
    }
  `;
  const GLSL_PATCH_MAIN = /* glsl */`
    ivec2 pg = ivec2(position.xz); int pn = int(uPt.w), ps = int(uPt.z);
    bool skirt = pg.x < 0 || pg.y < 0 || pg.x > pn || pg.y > pn;
    pg = clamp(pg, ivec2(0), ivec2(pn));
    ivec2 tc = ivec2(uPt.xy) + pg * ps;
    float ce = uCM.z / uCM.w, cst = float(ps) * ce;
    vec2 trP = uCM.xy - uCM.z * .5 + (vec2(tc) + .5) * ce;
    float trH = cmH(tc);
    vec3 trNrm = normalize(vec3(-(cmH(tc + ivec2(ps, 0)) - cmH(tc - ivec2(ps, 0))) / (2. * cst), 1., -(cmH(tc + ivec2(0, ps)) - cmH(tc - ivec2(0, ps))) / (2. * cst)));
    vec4 trSN = texelFetch(tNS, tc, 0);
    float trDep = trSN.y, trGrv = trSN.w;
    { vec2 dc = abs(trP - uPc.xy); float bw = smoothstep(uPc.z - uPc.w, uPc.z - ce, max(dc.x, dc.y));
      if (bw > 0.) { float d2, g2; float hr = trHs(trP) + trSnow(trP, trRingSp(trP), d2, g2); trH = mix(trH, hr, bw); } }
    if (skirt) trH -= .15;
    vW = vec3(trP.x, trH, trP.y); vN = trNrm;
    trTint(trP, trH, trRiftA(trP)); vDepth = trDep; vGrav = trGrv;
    vec3 objectNormal = trNrm;
    #ifdef USE_TANGENT
      vec3 objectTangent = vec3(1., 0., 0.);
    #endif
  `;
  // far mesh vertex: attributes, lowered under the detail rings
  const GLSL_BASE_V = /* glsl */`
    attribute vec3 aD; uniform vec4 uHole;
    varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vRock; varying float vDepth; varying float vGrav;
    ${GLSL_NOISE}
    ${GLSL_TINT}
  `;
  // shared fragment: layered snow / rock / gravel with anti-tiling and height blending
  const GLSL_FRAG_HEAD = /* glsl */`
    // TEXUNITS: the 5 detail albedos / 4 packed normal-roughness maps live in two texture arrays (layers: 0 fresh snow,
    // 1 wind crust, 2 rock, 3 cliff, 4 gravel albedo) — 9 samplers → 2; the terrain programs were 17–22 units > 16
    uniform sampler2DArray tTrD, tTrN; uniform sampler2D tNz;
    uniform vec2 uWind; uniform vec3 uSunV; uniform vec2 uScanC; uniform float uScanR, uScanA, uTime;
    #ifdef TR_DETAIL
      uniform float uDbgFlat;
      // SNOW-CONTACT: the drawn near surface (tNR) gives the exact per-pixel normal of what objects pressed — the same
      // data the contact patch is built from, so ring and patch shade identically where they meet
      ${GLSL_CM}
    #endif
    varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vRock; varying float vDepth; varying float vGrav;
    ${GLSL_NOISE}
    // no-tile sampling (index noise picks one of 8 offsets, 2 taps, luminance-aware blend) for albedo + packed normal/rough
    void trNT(float ld, float ln, vec2 uv, vec2 dx, vec2 dy, float k, out vec3 c, out vec3 n){
      float l = k * 8.; float ia = floor(l), f = fract(l);
      vec2 oa = sin(vec2(3., 7.) * ia), ob = sin(vec2(3., 7.) * (ia + 1.));
      vec3 ca = textureGrad(tTrD, vec3(uv + oa, ld), dx, dy).rgb, cb = textureGrad(tTrD, vec3(uv + ob, ld), dx, dy).rgb;
      float b = smoothstep(.2, .8, f - .1 * dot(ca - cb, vec3(1.)));
      c = mix(ca, cb, b); n = mix(textureGrad(tTrN, vec3(uv + oa, ln), dx, dy).rgb, textureGrad(tTrN, vec3(uv + ob, ln), dx, dy).rgb, b);
    }
    vec2 trNrmXY(vec3 n){ return n.xy * 2. - 1.; }
    // triplanar (FIX-LOOK): steep faces sample the side planes instead of a stretched top-down projection
    void trTri(float ld, float ln, vec3 P, vec3 gN, vec3 dPx, vec3 dPy, float sc, out vec3 c, out vec3 hn, out float r){
      vec3 bw = pow(abs(gN), vec3(4.)); bw /= dot(bw, vec3(1.)); vec3 pc = P * sc, gx = dPx * sc, gy = dPy * sc;
      c = vec3(0.); hn = vec3(0.); r = 0.;
      if (bw.x > .02) { vec3 t = textureGrad(tTrN, vec3(pc.zy, ln), gx.zy, gy.zy).rgb; c += textureGrad(tTrD, vec3(pc.zy, ld), gx.zy, gy.zy).rgb * bw.x; r += t.z * bw.x; vec2 n = t.xy * 2. - 1.; hn += vec3(0., n.y, n.x) * bw.x; }
      if (bw.y > .02) { vec3 t = textureGrad(tTrN, vec3(pc.xz, ln), gx.xz, gy.xz).rgb; c += textureGrad(tTrD, vec3(pc.xz, ld), gx.xz, gy.xz).rgb * bw.y; r += t.z * bw.y; vec2 n = t.xy * 2. - 1.; hn += vec3(n.x, 0., n.y) * bw.y; }
      if (bw.z > .02) { vec3 t = textureGrad(tTrN, vec3(pc.xy, ln), gx.xy, gy.xy).rgb; c += textureGrad(tTrD, vec3(pc.xy, ld), gx.xy, gy.xy).rgb * bw.z; r += t.z * bw.z; vec2 n = t.xy * 2. - 1.; hn += vec3(n.x, n.y, 0.) * bw.z; }
    }
    // GLSL_MS on the arrays (same maths)
    void trMS(float ld, float ln, vec2 uv, float w, float rot, out vec3 c, out vec3 n){
      float cr = cos(rot), sr = sin(rot); mat2 R = mat2(cr, sr, -sr, cr);
      vec2 uv2 = R * uv * .71 + vec2(.37, .61);
      vec3 ca = texture(tTrD, vec3(uv, ld)).rgb, cb = texture(tTrD, vec3(uv2, ld)).rgb;
      vec3 na = texture(tTrN, vec3(uv, ln)).rgb, nb = texture(tTrN, vec3(uv2, ln)).rgb;
      float b = smoothstep(.3, .7, w + (trLum(cb) - trLum(ca)) * .5);
      vec2 nbx = transpose(R) * (nb.xy * 2. - 1.);
      c = mix(ca, cb, b); n = vec3(mix(na.xy * 2. - 1., nbx, b) * .5 + .5, mix(na.z, nb.z, b));
    }
  `;
  const GLSL_FRAG_MAT = /* glsl */`
    vec3 P = vW; vec3 gN = normalize(vN);
    { // macro relief on steep ground (FIX-LOOK, h04/h05 couloirs): noise gradient bends the normal where the 3.5 m
      // far mesh has no geometry for gullies/ribs; zero on flat snow, so the rings and the far mesh still meet exactly
      float st = smoothstep(.93, .6, gN.y); if (st > .01) { vec2 q = P.xz * (1. / 37.); float e = .04;
        float h0 = texture(tNz, q).r, hx = texture(tNz, q + vec2(e, 0.)).r, hz = texture(tNz, q + vec2(0., e)).r;
        vec2 g = vec2(hx - h0, hz - h0) / e;
        gN = normalize(gN + vec3(g.x, 0., g.y) * .3 * st); } }
    float up = gN.y;
    vec3 dPx = dFdx(P), dPy = dFdy(P);
    float trDist = length(vViewPosition);
    vec4 nzA = texture(tNz, P.xz * (1. / 260.)), nzB = texture(tNz, P.xz * (1. / 47.) + .37);
    float depth = vDepth;
    float press = 0., rim = 0.; vec3 dN = vec3(0.);
    #ifdef TR_DETAIL
    // SNOW-CONTACT: normal of the surface the objects actually pressed (tNR — the same texels the contact patch's
    // geometry is built from). No parallax, no painted outline: inside the patch the depression is real geometry;
    // on the ring around it this is the exact normal of that geometry. press = compaction (share of the loose snow
    // pushed down), used only for a slight roughness / albedo change of packed snow.
    { vec2 cuv = (P.xz - uCM.xy) / uCM.z + .5;
      if (uCMOn > .5 && all(greaterThan(cuv, vec2(.004))) && all(lessThan(cuv, vec2(.996)))) {
        vec3 hg = cmHG(P.xz); vec3 cmN = normalize(vec3(-hg.y, 1., -hg.z));
        vec2 ec = min(cuv, 1. - cuv); float fd = smoothstep(.01, .08, min(ec.x, ec.y));
        #ifndef TR_PATCH
          fd *= 1. - smoothstep(22., 34., trDist);
        #endif
        // LOOKGATE (👣 footprints): the pressed surface's exact normal, used at full strength, reads as a sharp bright
        // cut-paper rim under directional light where the wall meets the untouched snow — soften its contrast and
        // break its smoothness with a little fine noise so it shades like loose compacted snow, not folded card
        vec2 wn2 = vec2(trVN(P.xz * 41. + 5.2), trVN(P.xz * 41. - 8.7)) - .5;
        dN = (cmN - gN) * fd * .7 + vec3(wn2.x, 0., wn2.y) * .12 * fd;
        press = cmPress(P.xz) * fd * smoothstep(.01, .05, depth);
      } }
    #endif
    // ---- layer weights ----
    float wC = max(smoothstep(.72, .56, up + (nzA.r - .5) * .14), vRock * .9);
    float wR = smoothstep(.93, .8, up + (nzB.g - .5) * .1) * (1. - wC) * (1. - smoothstep(.2, .5, depth));
    float wG = clamp(vGrav * 1.25 - .1, 0., 1.) * (1. - wC);
    float wS = clamp(1. - wC - wR - wG * .85, 0., 1.);
    vec3 cS = vec3(.6), cR = vec3(.3), cC = vec3(.2), cG = vec3(.3);
    vec3 nS3 = vec3(0.), nR3 = vec3(0.), nC3 = vec3(0.), nG3 = vec3(0.);
    float rS = .8, rR = .9, rC = .9, rG = .9;
    vec2 wd = uWind, wp = vec2(-wd.y, wd.x);
    vec3 snowFlat = vec3(.55, .57, .6) * (.9 + .2 * nzA.g);
    {
      // fresh powder everywhere except exposed ground: thin snow (wind-scoured) on slopes / ridges or scoured gravel
      // patches gets the wind-packed crust. SNOW-CONTACT: before, any flat with ~10 cm of snow was half crust — the
      // crust texture is wind-aligned, so whole flats showed dark one-direction ripples (INT-SNOW's A/B finding).
      float mF = 1. - smoothstep(.075, .03, depth + (nzA.b - .5) * .04) * max(smoothstep(.985, .93, up), smoothstep(.15, .45, vGrav));
      vec3 cF = vec3(.6), cW = vec3(.6), tF = vec3(.5, .5, .8), tW = vec3(.5, .5, .8);
      // layer branches: implicit derivatives only misbehave where the skipped layer's weight is < 1 %
      if (mF > .01) trMS(0., 0., P.xz * (1. / 3.4), nzB.a, 1.1, cF, tF);
      if (mF < .99) trMS(1., 1., vec2(dot(P.xz, wp), dot(P.xz, wd)) * (1. / 4.2), nzB.b, 0., cW, tW);
      vec2 nF = trNrmXY(tF), nW = trNrmXY(tW);
      vec2 hW = wp * nW.x + wd * nW.y;
      cS = mix(cW * vec3(.98, .99, 1.01), cF, mF) * vec3(.97, .985, 1.) * (.88 + .24 * nzA.g);   // near-neutral albedo: the blue comes from the sky light (FIX-LOOK)
      nS3 = vec3(mix(hW.x * .4, nF.x * .8, mF), 0., mix(hW.y * .4, nF.y * .8, mF));   // FIX-LOOK: crisper wind-crust relief (lit/shadow contrast)
      rS = mix(tW.z, tF.z, mF);
      snowFlat = cS;
      // packed snow in a print: a little denser / smoother, no painted outline (walls shade by their real normal)
      cS = cS * mix(vec3(1.), vec3(.93, .95, .98), press);
      rS = mix(rS, .74, press);   // LOOKGATE: was .62 — less gloss, so the wall doesn't catch a hard bright highlight
    }
    if (wR > .003) {
      if (up > .88) { vec3 t; trNT(2., 2., P.xz / 11., dPx.xz / 11., dPy.xz / 11., nzA.a, cR, t); vec2 n = trNrmXY(t); nR3 = vec3(n.x, 0., n.y) * .8; rR = t.z; }
      else { vec3 hn; trTri(2., 2., P, gN, dPx, dPy, 1. / 11., cR, hn, rR); nR3 = hn * .8; }
      cR *= vec3(.86, .9, 1.); }
    if (wG > .003) { vec3 t; trNT(4., 2., P.xz / 2.6, dPx.xz / 2.6, dPy.xz / 2.6, nzB.r, cG, t); vec2 n = trNrmXY(t); nG3 = vec3(n.x, 0., n.y) * .8; rG = .75 + t.z * .25; cG *= vec3(.88, .92, 1.); }
    if (wC > .003) {
      vec3 bw = pow(abs(gN), vec3(4.)); bw /= dot(bw, vec3(1.)); const float sc = 1. / 7.5; vec3 pc = P * sc, gx = dPx * sc, gy = dPy * sc;
      vec3 c = vec3(0.), hn = vec3(0.); float r = 0.;
      if (bw.x > .02) { vec3 t = textureGrad(tTrN, vec3(pc.zy, 3.), gx.zy, gy.zy).rgb; c += textureGrad(tTrD, vec3(pc.zy, 3.), gx.zy, gy.zy).rgb * bw.x; r += t.z * bw.x; vec2 n = trNrmXY(t); hn += vec3(0., n.y, n.x) * bw.x; }
      if (bw.y > .02) { vec3 t = textureGrad(tTrN, vec3(pc.xz, 3.), gx.xz, gy.xz).rgb; c += textureGrad(tTrD, vec3(pc.xz, 3.), gx.xz, gy.xz).rgb * bw.y; r += t.z * bw.y; vec2 n = trNrmXY(t); hn += vec3(n.x, 0., n.y) * bw.y; }
      if (bw.z > .02) { vec3 t = textureGrad(tTrN, vec3(pc.xy, 3.), gx.xy, gy.xy).rgb; c += textureGrad(tTrD, vec3(pc.xy, 3.), gx.xy, gy.xy).rgb * bw.z; r += t.z * bw.z; vec2 n = trNrmXY(t); hn += vec3(n.x, n.y, 0.) * bw.z; }
      cC = c * vec3(.74, .8, .94); rC = r; nC3 = hn * 1.2;
      float ledge = smoothstep(.6, .86, normalize(gN + nC3).y + (nzB.r - .5) * .3) * (1. - vRock) * .9;   // snow held on ledges
      cC = mix(cC, snowFlat, ledge); rC = mix(rC, .8, ledge); nC3 *= 1. - ledge * .7;
    }
    // ---- height blend (rock pokes through thin snow, deep snow buries it) ----
    vec4 lw = vec4(wS, wR, wC, wG);
    vec4 lh = vec4(.5 + min(depth, .6) * 1.2 + trLum(cS) * .2, trLum(cR) * 1.3, trLum(cC) * .9 + .1, trLum(cG));
    vec4 lt = (lw + lh * .5) * step(.003, lw);
    float lm = max(max(lt.x, lt.y), max(lt.z, lt.w)) - .16;
    vec4 lb = max(lt - lm, 0.); lb /= max(dot(lb, vec4(1.)), 1e-4);
    vec3 trAlb = (cS * lb.x + cR * lb.y + cC * lb.z + cG * lb.w) * vTint;
    float trRough = clamp(rS * lb.x + rR * lb.y + rC * lb.z + rG * lb.w, .2, 1.);
    vec3 trWN = normalize(gN + nS3 * lb.x + nR3 * lb.y + nC3 * lb.z + nG3 * lb.w + dN);
    float trSnowW = lb.x * (1. - press);
  `;
  const GLSL_FRAG_EMIT = /* glsl */`
    { // snow sparkle: sparse random facets that flash when they mirror the moon (or the sky) into the eye. Each
      // candidate cell used to light up as a flat filled square (a grid of tiny bright tiles) — give it a soft round
      // shape at a jittered spot inside the cell instead, so it reads as a random grain catching the light, not a tile.
      vec2 gc = floor(P.xz * 26.); float hh = trHash(gc);
      if (hh > .965 && trDist < 38. && trSnowW > .2) {
        vec2 fOff = vec2(trHash(gc + 4.1), trHash(gc + 8.3)) * .6 + .2;
        float fMask = 1. - smoothstep(.14, .42, length(fract(P.xz * 26.) - fOff));
        vec3 V = normalize(cameraPosition - P);
        vec3 fn = normalize(vec3((trHash(gc + 3.1) - .5) * 1.5, 1., (trHash(gc + 7.7) - .5) * 1.5));
        float g1 = smoothstep(.975, .998, dot(fn, normalize(V + uSunV))), g2 = smoothstep(.985, .999, dot(fn, normalize(V + vec3(0., 1., 0.))));
        totalEmissiveRadiance += vec3(.7, .85, 1.) * fMask * (g1 * 3. + g2 * .8) * trSnowW * (1. - smoothstep(18., 38., trDist));
      }
    }
    { float sd = length(P.xz - uScanC);
      float ring = smoothstep(uScanR - 6., uScanR, sd) * (1. - smoothstep(uScanR, uScanR + .8, sd));
      vec2 gg = abs(fract(P.xz / 3.) - .5);
      float grid = smoothstep(.46, .5, max(gg.x, gg.y)) * (1. - smoothstep(uScanR - 40., uScanR, sd)) * step(sd, uScanR) * .35;
      totalEmissiveRadiance += vec3(.1, .8, 1.) * (ring * 1.8 + grid) * uScanA; }
  `;

  /* ============================================================ helpers */
  function makeNoiseTex() {
    const N = 256, d = new Uint8Array(N * N * 4);
    const lat = (p, seed) => { const g = new Float32Array(p * p); let s = seed; for (let i = 0; i < p * p; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; } return g; };
    const chans = [[8, 16, 32], [4, 8, 16], [16, 32, 64], [32, 64, 128]];
    for (let c = 0; c < 4; c++) {
      const oct = chans[c].map((p, k) => ({ p, g: lat(p, 1234 + c * 97 + k * 13), a: 1 / (k + 1) }));
      const sum = oct.reduce((a, o) => a + o.a, 0);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let v = 0;
        for (const o of oct) {
          const fx = x / N * o.p, fy = y / N * o.p, ix = Math.floor(fx), iy = Math.floor(fy); let tx = fx - ix, ty = fy - iy;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          const P = o.p, a = o.g[(iy % P) * P + ix % P], b = o.g[(iy % P) * P + (ix + 1) % P], cc = o.g[((iy + 1) % P) * P + ix % P], dd = o.g[((iy + 1) % P) * P + (ix + 1) % P];
          v += ((a + (b - a) * tx) * (1 - ty) + (cc + (dd - cc) * tx) * ty) * o.a;
        }
        v /= sum; v = clamp((v - 0.5) * 1.8 + 0.5, 0, 1);
        d[(y * N + x) * 4 + c] = v * 255;
      }
    }
    const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
  }
  function dataTex(arr, w, h, format, type, filter, mip) {
    const t = new THREE.DataTexture(arr, w, h, format, type);
    t.magFilter = filter; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : filter; t.generateMipmaps = !!mip;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
  }

  /* ============================================================== state */
  const S = { W: 900, wind: [1, 0.18], Dbase: null, D: null, Gm: null, obstKey: '', obstT: 0, levels: [], hole: null, lvKey: '' };
  const U = {};   // shared uniforms

  /* ------------------------------------------------ snow depth field (CPU) */
  // depth: wind (lee slopes deeper, windward thin), curvature (hollows fill), slope (steep = bare), POIs, lake, sea, rift
  function buildBaseDepth() {
    const { H, VN, CELL, W, POI, riftD } = ctx, [wx, wz] = S.wind;
    const HALF = W / 2, dv = new Float32Array(VN * VN), gv = new Float32Array(VN * VN), tv = new Float32Array(VN * VN);
    const Hc = (i, j) => H[clamp(j, 0, VN - 1) * VN + clamp(i, 0, VN - 1)];
    for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) {
      const x = i * CELL - HALF, z = j * CELL - HALF, h = Hc(i, j);
      const gx = (Hc(i + 1, j) - Hc(i - 1, j)) / (2 * CELL), gz = (Hc(i, j + 1) - Hc(i, j - 1)) / (2 * CELL);
      const up = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const lap = (Hc(i + 2, j) + Hc(i - 2, j) + Hc(i, j + 2) + Hc(i, j - 2)) / 4 - h;
      const gw = gx * wx + gz * wz;                   // > 0: ground rises downwind (windward face) → scoured
      let d = 0.1 + clamp(lap * 0.03, -0.05, 0.08) + clamp(-gw * 0.22, -0.05, 0.08);
      d *= smooth(0.6, 0.86, up);
      if (h > 55) d *= 1 - smooth(55, 110, h) * 0.5;
      d *= smooth(-0.6, 0.5, h);                      // shore / sea
      const dl = Math.hypot(x - POI.lake.x, z - POI.lake.z); d *= smooth(48, 54, dl);
      const dr = riftD(x, z); d *= smooth(46, 66, dr);
      let g = smooth(0.05, 0.015, d) * smooth(0.5, 1.5, h) * 0.8, pt = 0;
      for (const [k, r, gm, dmax] of [['station', 34, 0.55, 0.04], ['crash', 22, 0.12, 0.07], ['spireN', 18, 0.35, 0.05], ['spireW', 18, 0.35, 0.05], ['spireE', 18, 0.35, 0.05]]) {
        const p = POI[k]; if (!p) continue; const dd = Math.hypot(x - p.x, z - p.z); const t = smooth(r * 1.4, r * 0.8, dd);
        if (t > 0) { d = d + (Math.min(d, dmax) - d) * t; g = Math.max(g, gm * t); pt = Math.max(pt, t); }
      }
      g = Math.max(g, smooth(62, 50, dr) * 0.5 * smooth(40, 50, dr));
      dv[j * VN + i] = clamp(d, 0, 0.22); gv[j * VN + i] = g; tv[j * VN + i] = pt;
    }
    // upsample to DN² + fine noise
    const Db = new Float32Array(DN * DN), Gm = new Float32Array(DN * DN), Cap = new Float32Array(DN * DN), T = W / DN;
    for (let j = 0; j < DN; j++) {
      const z = -HALF + (j + 0.5) * T, gz = (z + HALF) / CELL, jz = Math.min(VN - 2, Math.floor(gz)), fz = gz - jz;
      for (let i = 0; i < DN; i++) {
        const x = -HALF + (i + 0.5) * T, gx = (x + HALF) / CELL, ix = Math.min(VN - 2, Math.floor(gx)), fx = gx - ix;
        const a = jz * VN + ix, b = a + 1, c = a + VN, e = c + 1;
        let d = (dv[a] * (1 - fx) + dv[b] * fx) * (1 - fz) + (dv[c] * (1 - fx) + dv[e] * fx) * fz;
        const g = (gv[a] * (1 - fx) + gv[b] * fx) * (1 - fz) + (gv[c] * (1 - fx) + gv[e] * fx) * fz;
        Cap[j * DN + i] = 0.34 - 0.2 * ((tv[a] * (1 - fx) + tv[b] * fx) * (1 - fz) + (tv[c] * (1 - fx) + tv[e] * fx) * fz);   // camps / wreck: actors walk here
        if (d > 0.03) d += (ctx.vnoise(x * 0.13, z * 0.13) - 0.5) * 0.04 + (ctx.vnoise(x * 0.041 + 7, z * 0.041) - 0.5) * 0.05;
        Db[j * DN + i] = Math.max(0, d); Gm[j * DN + i] = g > 0.01 ? clamp(g * (0.35 + 1.3 * ctx.vnoise(x * 0.09 + 11, z * 0.09)), 0, 1) : 0;
      }
    }
    S.Dbase = Db; S.Gm = Gm; S.Cap = Cap; S.D = new Float32Array(Db);
  }
  // obstacles: lee-side drift tails + a soft skirt around every solid; tree wells around trunks
  function collectObstacles() {
    const P = ctx.Passport, out = [];
    for (const e of P.byRole.solid || []) {
      if (!e.alive || !e.box) continue;
      const b = e.box, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, hx = (b.max[0] - b.min[0]) / 2, hz = (b.max[2] - b.min[2]) / 2;
      const hgt = b.max[1] - ctx.getH(cx, cz); if (hgt < 0.35 || b.min[1] > ctx.getH(cx, cz) + 1.2) continue;
      const circ = (e.circles || []).filter((c) => !c.off);
      if (circ.length > 1 || Math.max(hx, hz) > 6) {   // big / multi-part objects: local height of the drawn part under each circle
        const v = e.geo && e.geo.v;
        for (const c of circ) {
          let top = -1e9; const g0 = ctx.getH(c.x, c.z), r2 = c.r * c.r;
          if (v) for (let q = 0; q < v.length; q += 3) { const dx = v[q] - c.x, dz = v[q + 2] - c.z; if (dx * dx + dz * dz < r2 && v[q + 1] > top) top = v[q + 1]; }
          const lh = v ? top - g0 : hgt; if (lh > 0.35) out.push([c.x, c.z, c.r, Math.min(lh, 4)]);
        }
      }
      else out.push([cx, cz, Math.max(0.3, Math.min(hx, hz) * 0.5 + Math.max(hx, hz) * 0.4), Math.min(hgt, 4)]);
    }
    for (const e of P.byRole.trunk || []) if (e.alive && e.trunk) out.push([e.trunk.x, e.trunk.z, e.trunk.r, -1]);
    return out;
  }
  function stampObstacles(list) {
    const { W } = ctx, HALF = W / 2, T = W / DN, D = S.D, [wx, wz] = S.wind;
    D.set(S.Dbase);
    for (const [x, z, r, h] of list) {
      if (h < 0) {   // tree well
        const R = 2.4; const i0 = Math.max(0, Math.floor((x - R + HALF) / T)), i1 = Math.min(DN - 1, Math.ceil((x + R + HALF) / T)), j0 = Math.max(0, Math.floor((z - R + HALF) / T)), j1 = Math.min(DN - 1, Math.ceil((z + R + HALF) / T));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = -HALF + (i + 0.5) * T - x, pz = -HALF + (j + 0.5) * T - z, d = Math.hypot(px, pz); D[j * DN + i] *= 0.3 + 0.7 * smooth(r + 0.2, r + 2.0, d); }
        continue;
      }
      const L = Math.min(16, r * 1.5 + h * 3.5), A = Math.min(0.26, h * 0.16) * smooth(0.3, 1.2, h), As = Math.min(0.12, h * 0.06), sw = 0.45 + 0.15 * r;
      const R = r + L;
      const i0 = Math.max(0, Math.floor((x - R + HALF) / T)), i1 = Math.min(DN - 1, Math.ceil((x + R + HALF) / T)), j0 = Math.max(0, Math.floor((z - R + HALF) / T)), j1 = Math.min(DN - 1, Math.ceil((z + R + HALF) / T));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * DN + i; if (S.Dbase[k] <= 0.005 && S.Gm[k] > 0.5) continue;
        const px = -HALF + (i + 0.5) * T - x, pz = -HALF + (j + 0.5) * T - z, d = Math.hypot(px, pz);
        const s = px * wx + pz * wz, q = -px * wz + pz * wx;
        let add = As * Math.exp(-(((d - r) / sw) ** 2)) * (s < 0 ? 0.55 : 1);
        if (s > 0 && s < L) { const hw = r * (1 + 0.45 * s / L), t = s / L; add = Math.max(add, A * Math.exp(-((q / hw) ** 2)) * Math.min(1, s / (r * 0.7 + 0.3)) * (1 - t) ** 1.6); }
        if (add > 0.002) D[k] = Math.min(Math.max(S.Cap[k], S.Dbase[k]), D[k] + add * smooth(0, 0.06, S.Dbase[k]));
      }
    }
  }
  // tDD (RGBA16F, DN²): smooth render height as hi + lo halves (exact to ~1e-4 m), loose snow depth (m), gravel/scour mask
  function uploadDepth() {
    const D = S.D, G = S.Gm, h2 = THREE.DataUtils.toHalfFloat;
    let a = S.ddArr;
    if (!a) {
      a = S.ddArr = new Uint16Array(DN * DN * 4);
      for (let k = 0; k < DN * DN; k++) { const h = S.Hs[k], hi = Math.round(h * 2) / 2; a[k * 4] = h2(hi); a[k * 4 + 1] = h2(h - hi); }
    }
    for (let k = 0; k < DN * DN; k++) { a[k * 4 + 2] = h2(D[k]); a[k * 4 + 3] = h2(G[k]); }
    if (!S.ddTex) { S.ddTex = dataTex(a, DN, DN, THREE.RGBAFormat, THREE.HalfFloatType, THREE.LinearFilter, true); U.tDD = { value: S.ddTex }; }
    else S.ddTex.needsUpdate = true;
    updateBaseMesh();
  }
  function sampleD(x, z) {   // bilinear on the depth grid (m)
    const HALF = S.W / 2, T = S.W / DN, gx = (x + HALF) / T - 0.5, gz = (z + HALF) / T - 0.5;
    const i = clamp(Math.floor(gx), 0, DN - 2), j = clamp(Math.floor(gz), 0, DN - 2), fx = clamp(gx - i, 0, 1), fz = clamp(gz - j, 0, 1), D = S.D, k = j * DN + i;
    return (D[k] * (1 - fx) + D[k + 1] * fx) * (1 - fz) + (D[k + DN] * (1 - fx) + D[k + DN + 1] * fx) * fz;
  }
  function sampleG(x, z) {
    const HALF = S.W / 2, T = S.W / DN, i = clamp(Math.round((x + HALF) / T - 0.5), 0, DN - 1), j = clamp(Math.round((z + HALF) / T - 0.5), 0, DN - 1);
    return S.Gm[j * DN + i];
  }

  /* ------------------------------------------ smooth height (render only) */
  // Catmull-Rom of H, deviation from the physics triangles soft-clamped (−0.08 … +0.25 m)
  function buildSmoothH() {
    const { H, VN, CELL, W } = ctx, HALF = W / 2, T = W / DN, out = new Float32Array(DN * DN), rows = new Float32Array(DN * VN);
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const ix = new Int32Array(DN), fx = new Float32Array(DN);
    for (let i = 0; i < DN; i++) { const g = (-HALF + (i + 0.5) * T + HALF) / CELL; ix[i] = Math.min(VN - 2, Math.floor(g)); fx[i] = g - ix[i]; }
    const at = (r, c) => H[r * VN + clamp(c, 0, VN - 1)];
    for (let r = 0; r < VN; r++) for (let i = 0; i < DN; i++) { const c = ix[i]; rows[r * DN + i] = cr(at(r, c - 1), at(r, c), at(r, c + 1), at(r, c + 2), fx[i]); }
    for (let j = 0; j < DN; j++) {
      const r = ix[j], t = fx[j], r0 = Math.max(0, r - 1), r3 = Math.min(VN - 1, r + 2);
      for (let i = 0; i < DN; i++) {
        const hc = cr(rows[r0 * DN + i], rows[r * DN + i], rows[(r + 1) * DN + i], rows[r3 * DN + i], t);
        const c = ix[i], u = fx[i], a = H[r * VN + c], b = H[(r + 1) * VN + c], cc = H[(r + 1) * VN + c + 1], d = H[r * VN + c + 1];
        const hl = u + t <= 1 ? a + (d - a) * u + (b - a) * t : cc + (b - cc) * (1 - u) + (d - cc) * (1 - t);
        const dv = hc - hl; out[j * DN + i] = hl + (dv > 0 ? 0.25 * Math.tanh(dv / 0.25) : 0.08 * Math.tanh(dv / 0.08));
      }
    }
    return out;
  }

  /* ------------------------------------------------------ far (base) mesh */
  function initBaseMesh() {
    const mesh = ctx.WORLD_TERRAIN.mesh, geo = mesh.geometry, { VN } = ctx;
    S.base = mesh; S.baseY0 = new Float32Array(VN * VN);
    const pos = geo.attributes.position; for (let i = 0; i < VN * VN; i++) S.baseY0[i] = pos.getY(i);
    geo.setAttribute('aD', new THREE.BufferAttribute(new Float32Array(VN * VN * 3), 3));
    // tBase (RG32F, 257²): far-mesh height (H + averaged snow, exact seam for the last ring) + rift parameter
    S.baseArr = new Float32Array(VN * VN * 2); S.riftA = new Float32Array(VN * VN);
    for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) { const k = j * VN + i; S.riftA[k] = clamp((80 - ctx.riftD(i * ctx.CELL - ctx.W / 2, j * ctx.CELL - ctx.W / 2)) / 40, 0, 1); S.baseArr[k * 2 + 1] = S.riftA[k]; }
    U.tBase = { value: dataTex(S.baseArr, VN, VN, THREE.RGFormat, THREE.FloatType, THREE.NearestFilter, false) };
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uHole: S.hole });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_BASE_V)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
          if (max(abs(position.x - uHole.x), abs(position.z - uHole.y)) < uHole.z) transformed.y -= 30000.;   // beyond the far plane: not rasterized
          vW = position; vN = normalize(objectNormal); trTint(position.xz, position.y, aD.z); vDepth = aD.x; vGrav = aD.y;`);
      patchFrag(sh);
    };
    mat.customProgramCacheKey = () => 'trBase2';
    S.origMat = mesh.material; S.newMat = mat; mesh.material = mat;
  }
  // far mesh heights = H + (averaged) loose snow, so it meets the detail rings; normals + textures refreshed
  function updateBaseMesh() {
    const { VN, CELL, W } = ctx, geo = S.base.geometry, pos = geo.attributes.position, aD = geo.attributes.aD, HALF = W / 2, T = W / DN;
    for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) {
      const x = i * CELL - HALF, z = j * CELL - HALF, ci = (x + HALF) / T - 0.5, cj = (z + HALF) / T - 0.5;
      let s = 0, g = 0, n = 0;
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = clamp(Math.round(ci + a), 0, DN - 1), jj = clamp(Math.round(cj + b), 0, DN - 1); s += S.D[jj * DN + ii]; g += S.Gm[jj * DN + ii]; n++; }
      const k = j * VN + i, d = s / n; aD.setXYZ(k, d, g / n, S.riftA[k]);
      pos.setY(k, S.baseY0[k] + d); S.baseArr[k * 2] = S.baseY0[k] + d;
    }
    pos.needsUpdate = true; aD.needsUpdate = true; geo.computeVertexNormals();
    U.tBase.value.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  function patchFrag(sh) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_FRAG_HEAD)
      .replace('#include <map_fragment>', '#ifdef TR_DETAIL\n if (uDbgFlat > .5) { gl_FragColor = vec4(.3, .3, .35, 1.); return; }\n#endif\n'
        // the contact patch draws the ground here (real pressed geometry): the ring underneath steps aside
        + '#if defined(TR_DETAIL) && !defined(TR_PATCH)\n if (uPc.w > 0. && max(abs(vW.x - uPc.x), abs(vW.z - uPc.y)) < uPc.z - .5 * uCM.z / uCM.w) discard;\n#endif\n'
        + GLSL_FRAG_MAT + '\n diffuseColor.rgb *= trAlb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * trRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(trWN, 0.)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + GLSL_FRAG_EMIT);
  }

  /* ---------------------------------------------------- detail rings (near) */
  function gridGeo(N, hole) {
    const V = N + 1, pos = new Float32Array(V * V * 3), idx = [];
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) { const k = (j * V + i) * 3; pos[k] = i; pos[k + 1] = 0; pos[k + 2] = j; }
    const h0 = N / 4 + 1, h1 = (3 * N) / 4 - 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (hole && i >= h0 && i < h1 && j >= h0 && j < h1) continue;
      const a = j * V + i, b = (j + 1) * V + i, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(V * V > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); return g;
  }
  function buildLevels() {
    for (const L of S.levels) { S.root.remove(L.mesh); L.mesh.material.dispose(); }
    if (S.gFull) { S.gFull.dispose(); S.gHole.dispose(); }
    S.levels = [];
    const Q = ctx.Q, nL = Q.terrainLevels | 0, N = Math.max(16, Math.round((Q.terrainGrid || 128) / 8) * 8);
    S.lvKey = nL + ':' + N; S.N = N; S.nL = nL;
    CM.rebake = true;   // the fine map bakes its micro relief at the finest ring's spacing
    if (nL <= 0) { S.hole.value.set(0, 0, -1, 0); return; }
    S.gFull = gridGeo(N, false); S.gHole = gridGeo(N, true);
    const s0 = ctx.CELL / 2 ** nL;
    for (let L = 0; L < nL; L++) {
      const lvU = { uLv: { value: new THREE.Vector4(0, 0, s0 * 2 ** L, N) }, uLvL: { value: new THREE.Vector2(L, L === nL - 1 ? 1 : 0) } };
      const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
      mat.defines = { TR_DETAIL: '' };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U, lvU);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_DETAIL_V)
          .replace('#include <beginnormal_vertex>', GLSL_DETAIL_MAIN)
          .replace('#include <begin_vertex>', 'vec3 transformed = vW;');
        patchFrag(sh);
      };
      mat.customProgramCacheKey = () => 'trDetail2';
      const mesh = new THREE.Mesh(L === 0 ? S.gFull : S.gHole, mat);
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'terrain_detail_' + L;
      mesh.raycast = () => {}; mesh.userData.noCollide = true; mesh.matrixAutoUpdate = false;
      S.root.add(mesh); S.levels.push({ mesh, u: lvU, s: s0 * 2 ** L });
    }
  }
  function updateLevels() {
    const key = (ctx.Q.terrainLevels | 0) + ':' + Math.max(16, Math.round((ctx.Q.terrainGrid || 128) / 8) * 8);
    if (key !== S.lvKey) buildLevels();
    if (!S.levels.length) return;
    const cx = ctx.camera.position.x, cz = ctx.camera.position.z;
    for (const L of S.levels) { const s2 = L.s * 2; L.u.uLv.value.x = Math.round(cx / s2) * s2; L.u.uLv.value.y = Math.round(cz / s2) * s2; }
    const last = S.levels[S.levels.length - 1];
    S.hole.value.set(last.u.uLv.value.x, last.u.uLv.value.y, S.frozen || S.noHole ? -1 : (S.N / 2 - 3) * last.s, 0);
  }

  /* ------------------------------------------------------ coarse deformation map (the whole trail window) */
  // DEF: 128 m × 12.5 cm around the pilot, RGBA8: R = mean depression (m ÷ DSC), G = mean displaced rim (m ÷ DSC).
  // SNOW-CONTACT: nothing is stamped into it any more. It is (a) copied, texel by texel as a box mean, from the fine
  // contact map wherever that map covers it, (b) pressed directly by moving objects that are outside the fine map
  // (stags / fox / skimmer far from the pilot), (c) carried along when its window moves, refilled by blizzards. The rings
  // read it in their vertex stage (trSnow) — the same data the fine map was made from, only coarser.
  const DEF = { res: 0, ext: 128, cx: 0, cz: 0, rt: [], cur: 0, mirN: 0, mir: null, mirC: 0.5, mirCx: 0, mirCz: 0 };
  const QUAD_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
  function initDeform() {
    DEF.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    DEF.copyU = { tPrev: { value: null }, uOff: { value: new THREE.Vector2() }, uKeep: { value: 1 } };
    DEF.copyMat = new THREE.ShaderMaterial({
      uniforms: DEF.copyU, depthTest: false, depthWrite: false, toneMapped: false, vertexShader: QUAD_V,
      fragmentShader: `uniform sampler2D tPrev; uniform vec2 uOff; uniform float uKeep; varying vec2 vUv;
        void main(){ vec2 uv = vUv + uOff; vec4 c = textureLod(tPrev, uv, 0.); if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) c = vec4(0.); gl_FragColor = c * uKeep; }`,
    });
    DEF.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), DEF.copyMat); DEF.quad.frustumCulled = false;
    DEF.quadScene = new THREE.Scene(); DEF.quadScene.add(DEF.quad);
    U.tDef = { value: null }; U.uDbgFlat = { value: 0 }; U.uDef = { value: new THREE.Vector4(0, 0, 128, 0.125) }; U.uDefOn = { value: 0 };
    allocDeform();
  }
  function allocDeform() {
    const res = ctx.Q.deformRes || 1024, ext = ctx.Q.deformExt || 128;
    if (res === DEF.res && ext === DEF.ext && DEF.rt.length) return;
    for (const r of DEF.rt) r.dispose();
    DEF.res = res; DEF.ext = ext;
    const mk = () => new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false, stencilBuffer: false });
    DEF.rt = [mk(), mk()]; DEF.cur = 0; DEF.fresh = true;
    DEF.mirN = Math.round(ext / DEF.mirC); DEF.mir = new Float32Array(DEF.mirN * DEF.mirN);
    const p = ctx.player; DEF.cx = snapDef(p.x); DEF.cz = snapDef(p.z); DEF.mirCx = DEF.cx; DEF.mirCz = DEF.cz;
    U.tDef.value = DEF.rt[0].texture; U.uDef.value.set(DEF.cx, DEF.cz, ext, ext / res); if (CM.downU) CM.downU.uDefW.value.set(DEF.cx, DEF.cz, ext, res);
    if (CM.ok) CM.fromCoarse = false;
  }
  const snapDef = (v) => { const q = (DEF.ext / DEF.res) * 8; return Math.round(v / q) * q; };
  function withTarget(rt, fn) {
    const r = renderer, prev = r.getRenderTarget(), auto = r.autoClear, cc = S._cc || (S._cc = new THREE.Color()); r.getClearColor(cc); const ca = r.getClearAlpha();
    const sh = r.shadowMap.enabled; r.shadowMap.enabled = false;   // never let an off-screen pass consume / redo the cached moon shadow update
    r.autoClear = false; r.setRenderTarget(rt); try { fn(r); } finally { r.setRenderTarget(prev); r.autoClear = auto; r.setClearColor(cc, ca); r.shadowMap.enabled = sh; }
  }
  // full-screen pass into rt (optionally scissored to rect = [x, y, w, h] texels)
  function pass(rt, mat, rect, clear) {
    DEF.quad.material = mat;
    if (rect) { rt.scissor.set(rect[0], rect[1], rect[2], rect[3]); rt.scissorTest = true; }
    try { withTarget(rt, (r) => { if (clear) { r.setClearColor(0, 0); r.clear(true, false, false); } r.render(DEF.quadScene, DEF.cam); }); }
    finally { if (rect) rt.scissorTest = false; }
  }
  function recenterDeform(nx, nz, keep) {
    const src = DEF.rt[DEF.cur], dst = DEF.rt[1 - DEF.cur];
    DEF.copyU.tPrev.value = src.texture; DEF.copyU.uOff.value.set((nx - DEF.cx) / DEF.ext, (nz - DEF.cz) / DEF.ext); DEF.copyU.uKeep.value = keep;
    pass(dst, DEF.copyMat, null, true);
    // CPU press cache follows (integer cells: the window moves in whole metres) and fades with the refill
    const n = DEF.mirN, mm = DEF.mir, o = new Float32Array(n * n), di = Math.round((nx - DEF.mirCx) / DEF.mirC), dj = Math.round((nz - DEF.mirCz) / DEF.mirC);
    for (let j = 0; j < n; j++) { const sj = j + dj; if (sj < 0 || sj >= n) continue; for (let i = 0; i < n; i++) { const si = i + di; if (si >= 0 && si < n) o[j * n + i] = mm[sj * n + si] * keep; } }
    DEF.mir = o; DEF.mirCx = nx; DEF.mirCz = nz;
    DEF.cur = 1 - DEF.cur; DEF.cx = nx; DEF.cz = nz;
    U.tDef.value = DEF.rt[DEF.cur].texture; U.uDef.value.set(nx, nz, DEF.ext, DEF.ext / DEF.res);
    if (CM.downU) CM.downU.uDefW.value.set(nx, nz, DEF.ext, DEF.res);
  }
  // CPU mirror of the coarse map (0.5 m cells, share of the loose snow pressed down): snow depth / slow-down / surface
  // queries. Refreshed from the GPU by an async readback every 0.5 s (mirrorUpdate).
  function pressAt(x, z) {
    const n = DEF.mirN, i = Math.floor((x - DEF.mirCx) / DEF.mirC + n / 2), j = Math.floor((z - DEF.mirCz) / DEF.mirC + n / 2);
    return !DEF.mir || i < 0 || j < 0 || i >= n || j >= n ? 0 : DEF.mir[j * n + i];
  }

  /* ------------------------------------------------------ SNOW-CONTACT: objects press the snow with their own shape */
  // One map, one rule, no hand-authored print shapes:
  //   every frame each moving object near the pilot (pilot incl. the skinned boots, fox, stags, hermit, shardlings, golem,
  //   skimmer, pushed props) is drawn from BELOW into tNP by an orthographic camera: per texel, how far the object's
  //   lowest point lies under the undisturbed snow surface (clamped to the compacted floor). MAX blending keeps the
  //   deepest press ever made → a boot leaves exactly its sole, a roll the body, the skimmer its skis. Static props press
  //   once when they enter the window (their collider proxies).
  //   tNR = undisturbed − press + rim (rim = displaced snow: the blurred moving-object press minus the press, × kRim).
  //   The contact patch (real geometry near the pilot) is built from tNR; the rings shade with its exact normal. A planted
  //   boot sinks into the loose snow (interaction.js) and this map then holds exactly that boot — so the boot stands in its
  //   own print by construction. Nothing is read back to the CPU at run time (see pressCache).
  const CM = { ok: false, on: true, res: 0, ext: 0, e: 0, cx: 0, cz: 0, cur: 0, P: [], S: null, R: null, rebake: true,
    roots: [], rootsT: 0, kRim: 0.32, layer: 30,   // LOOKGATE (👣 footprints): was .45 — a taller, crisper rim reads as a cut-paper edge
    stats: { frames: 0, recenters: 0, actorDraws: 0, coarseDraws: 0, regionTexels: 0, cpuMs: 0, staticTris: 0 } };
  const CONTACT_V = `#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying float vCy; varying vec2 vCxz;
void main() {
#include <batching_vertex>
#include <skinbase_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
  vec4 cw = vec4(transformed, 1.);
  #ifdef USE_BATCHING
    cw = batchingMatrix * cw;
  #endif
  #ifdef USE_INSTANCING
    cw = instanceMatrix * cw;
  #endif
  cw = modelMatrix * cw; vCy = cw.y; vCxz = cw.xz;
}`;
  function contactMat(coarse, dyn) {
    const uniforms = coarse ? Object.assign({}, U, { uDyn: { value: dyn } }) : { tNS: U.tNS, uDyn: { value: dyn } };
    return new THREE.ShaderMaterial({
      uniforms, vertexShader: CONTACT_V, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      fragmentShader: coarse
        ? `${GLSL_NOISE}\n${GLSL_SNOWFN}\nvarying float vCy; varying vec2 vCxz; uniform float uDyn;
           void main(){ float d, g; float hs = trHs(vCxz), s0 = hs + trSnowU(vCxz, uDef.w, d, g);
             float pen = clamp(s0 - vCy, 0., max(.8 * (s0 - hs), 0.)); gl_FragColor = vec4(pen / ${DSC.toFixed(2)}, 0., 0., 0.); }`
        : `uniform sampler2D tNS; uniform float uDyn; varying float vCy; varying vec2 vCxz;
           void main(){ vec4 s = texelFetch(tNS, ivec2(gl_FragCoord.xy), 0);
             float pen = clamp(s.x - vCy, 0., max(s.x - s.z, 0.)); gl_FragColor = vec4(pen, pen * uDyn, 0., 0.); }`,
    });
  }
  function initContact() {
    const ext = renderer.extensions;
    CM.ok = !!(ext && ext.has && ext.has('EXT_color_buffer_float'));
    if (!CM.ok) { console.warn('[terrain] SNOW-CONTACT off: float render targets unsupported (no object prints, flat snow)'); return; }
    U.tNR = { value: null }; U.tNS = { value: null }; U.tNP = { value: null }; U.uCM = { value: new THREE.Vector4(0, 0, 16, 1024) }; U.uCMOn = { value: 0 };
    U.uPc = { value: new THREE.Vector4(0, 0, 1, 0) };
    CM.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 120); CM.cam.up.set(0, 0, 1); CM.cam.layers.set(CM.layer);
    CM.camC = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 120); CM.camC.up.set(0, 0, 1); CM.camC.layers.set(CM.layer);
    CM.matDyn = contactMat(false, 1); CM.matStat = contactMat(false, 0); CM.matCoarse = contactMat(true, 1);
    const fsHead = `${GLSL_NOISE}\n${GLSL_SNOWFN}\nvarying vec2 vUv;`;
    // bake: undisturbed surface of the new window (S0, loose depth, compacted floor, gravel)
    CM.bakeMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U), depthTest: false, depthWrite: false, toneMapped: false, vertexShader: QUAD_V,
      fragmentShader: `${fsHead}
        void main(){ float e = uCM.z / uCM.w; vec2 p = uCM.xy - uCM.z * .5 + gl_FragCoord.xy * e; float d, g;
          float hs = trHs(p), l = trSnowU(p, uMicroS, d, g); gl_FragColor = vec4(hs + l, d, hs + .2 * l, g); }`.replace('varying vec2 vUv;', 'varying vec2 vUv; uniform vec4 uCM; uniform float uMicroS;') });
    // micro relief at the finest RING's spacing (not the fine map's 1.6 cm): the patch must draw the same snow relief the
    // ring would there — only object presses add detail (finer octaves = uniform ripples, LOOKGATE 🦓)
    CM.bakeMat.uniforms.uMicroS = CM.microS = { value: 0.22 };
    // shift: carry the press over to the moved window; newly covered texels start from the coarse map (old trails)
    CM.shiftU = { tPrev: { value: null }, uOld: { value: new THREE.Vector4() }, uKeep: { value: 1 } };
    CM.shiftMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, CM.shiftU), depthTest: false, depthWrite: false, toneMapped: false, vertexShader: QUAD_V,
      fragmentShader: `${fsHead} uniform vec4 uCM; uniform sampler2D tPrev, tNS; uniform vec4 uOld; uniform float uKeep;
        void main(){ float e = uCM.z / uCM.w; vec2 p = uCM.xy - uCM.z * .5 + gl_FragCoord.xy * e; vec4 s = texelFetch(tNS, ivec2(gl_FragCoord.xy), 0);
          vec2 ou = (p - uOld.xy) / uOld.z + .5; vec2 d;
          if (uOld.w > .5 && all(greaterThan(ou, vec2(0.))) && all(lessThan(ou, vec2(1.)))) d = textureLod(tPrev, ou, 0.).rg * uKeep;
          else { float c = trDefAt(p, e).x; d = vec2(c); }
          d = min(d, vec2(max(s.x - s.z, 0.))); gl_FragColor = vec4(d, 0., 0.); }` });
    // surface: drawn height = S0 − press + rim; rim from the moving-object press blurred over ≈ 2.5 / 5.5 cm rings
    // surface: drawn height = S0 − press + rim. The press is shown with sloped walls (a cone dilation of the object's own
    // press: the bottom stays exactly the sole, the wall leans out ≈ 60°, with a world-anchored crumble), never a one-texel
    // vertical step; the rim is the moving-object press blurred over ≈ 2–7 cm minus the press, × kRim (displaced snow).
    CM.surfU = { uRim: { value: new THREE.Vector4(1.7, CM.kRim, 2.1, 0) } };   // LOOKGATE: wider ring step (was 1.5) — a gentler rim falloff, less cut-paper edge
    CM.surfMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, CM.surfU), depthTest: false, depthWrite: false, toneMapped: false, vertexShader: QUAD_V,
      fragmentShader: `uniform sampler2D tNS, tNP; uniform vec4 uCM; uniform vec4 uRim; varying vec2 vUv;
        float sh1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float svn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(sh1(i), sh1(i + vec2(1., 0.)), f.x), mix(sh1(i + vec2(0., 1.)), sh1(i + vec2(1., 1.)), f.x), f.y); }
        void main(){ ivec2 t = ivec2(gl_FragCoord.xy); vec4 s = texelFetch(tNS, t, 0); vec2 uv = gl_FragCoord.xy / uCM.w; vec2 c = texelFetch(tNP, t, 0).rg;
          float e = uCM.z / uCM.w, pmax = max(s.x - s.z, 0.), loose = pmax * 1.25;
          vec2 wp = uCM.xy - uCM.z * .5 + gl_FragCoord.xy * e;
          float kS = uRim.x * mix(.7, 1.35, svn(wp / .035));
          // conservative coverage: a texel an object only partly covered (its centre missed by the rasterizer) is pressed
          // too — else the edge of a boot sits in a one-texel wall / rim
          // (bilinear taps at 1.3 texel: a rounded contour — a 3 × 3 texel max outlined every print with a one-texel staircase)
          vec2 cc = c;
          for (int k = 0; k < 8; k++) { float a = float(k) * .7854 + .3927; cc = max(cc, textureLod(tNP, uv + vec2(cos(a), sin(a)) * 1.3 / uCM.w, 0.).rg); }
          float dil = cc.x, b = cc.y * 3., w = 3.;
          for (int ring = 1; ring <= 3; ring++) { float r = 1.3 + float(ring) * uRim.z, wt = 3.5 - float(ring);
            for (int k = 0; k < 8; k++) { float a = (float(k) + .5 * float(ring)) * .7854; vec2 v = textureLod(tNP, uv + vec2(cos(a), sin(a)) * r / uCM.w, 0.).rg;
              dil = max(dil, v.x - kS * (r - 1.3) * e); b += v.y * wt; w += wt; } }
          b /= w;
          float d = min(c.x, pmax), dd = min(dil, pmax);
          // LOOKGATE (👣 footprints): a perfectly smooth ridge of the same height all the way round reads as a folded
          // card, not loose snow — break its crest up a little so it looks crumbled, not moulded
          float rim = uRim.y * max(b - cc.y, 0.) * smoothstep(0., .03, loose) * (.62 + .6 * svn(wp / .05 + 19.));
          gl_FragColor = vec4(s.x - dd + rim, clamp(d / max(loose, .01), 0., 1.), 0., 1.); }` });
    // down: fine → coarse (box mean of the drawn depression and rim over each 12.5 cm coarse texel; overwrite: the fine map is exact)
    CM.downU = { tNRf: { value: null }, uDefW: { value: new THREE.Vector4() } };
    CM.downMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, CM.downU), depthTest: false, depthWrite: false, toneMapped: false, vertexShader: QUAD_V,
      fragmentShader: `uniform sampler2D tNS, tNP, tNR; uniform vec4 uCM, uDefW; varying vec2 vUv;
        void main(){ float ec = uDefW.z / uDefW.w, e = uCM.z / uCM.w; vec2 pc = uDefW.xy - uDefW.z * .5 + gl_FragCoord.xy * ec;
          vec2 g0 = (pc - ec * .5 - uCM.xy) / e + uCM.w * .5; float n = ec / e; float sd = 0., sr = 0., k = 0.;
          for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { ivec2 t = ivec2(g0 + (vec2(float(i), float(j)) + .5) * n * .25);
            t = clamp(t, ivec2(0), ivec2(int(uCM.w) - 1)); float s0 = texelFetch(tNS, t, 0).x, h = texelFetch(tNR, t, 0).r;
            sd += max(s0 - h, 0.); sr += max(h - s0, 0.); k += 1.; }   // exactly what is drawn: below / above the undisturbed snow
          gl_FragColor = vec4(sd / k / ${DSC.toFixed(2)}, sr / k / ${DSC.toFixed(2)}, 0., 1.); }` });
    // stamp shim (ctx.snowStamp / addFootprint — no caller left in this game): the old analytic shapes, pressed into tNP
    initStampShim();
    allocContact();
  }
  function allocContact() {
    if (!CM.ok) return;
    const res = ctx.Q.contactRes || 1024, ext = ctx.Q.contactExt || 16;
    if (res !== CM.res || ext !== CM.ext || !CM.S) {
      for (const r of CM.P) r.dispose(); if (CM.S) { CM.S.dispose(); CM.R.dispose(); }
      const mk = (type, format, filter) => new THREE.WebGLRenderTarget(res, res, { type, format, minFilter: filter, magFilter: filter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
      CM.P = [mk(THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter), mk(THREE.HalfFloatType, THREE.RGBAFormat, THREE.LinearFilter)];
      CM.S = mk(THREE.FloatType, THREE.RGBAFormat, THREE.NearestFilter); CM.R = mk(THREE.FloatType, THREE.RGFormat, THREE.NearestFilter);
      CM.res = res; CM.ext = ext; CM.e = ext / res; CM.cur = 0; CM.fresh = true;
      const p = ctx.player; CM.cx = snapCM(p.x); CM.cz = snapCM(p.z);
      U.tNS.value = CM.S.texture; U.tNR.value = CM.R.texture; U.tNP.value = CM.P[0].texture;
      U.uCM.value.set(CM.cx, CM.cz, ext, res);
      }
    const key = (ctx.Q.contactPatch || 7) + ':' + (ctx.Q.contactStep || 1) + ':' + res + ':' + ext;
    if (key !== CM.patchKey) buildPatch(key);
  }
  const snapCM = (v) => { const q = CM.e * 8; return Math.round(v / q) * q; };
  // (re)centre the fine window on (nx, nz): bake the undisturbed surface, carry the press over (or start from the coarse
  // map), press the static props once, rebuild the drawn surface — all full-window passes, ≈ 1–2 ms, every ~2.4 m walked
  function recenterContact(nx, nz, keep = 1) {
    const ox = CM.cx, oz = CM.cz, oldOK = !CM.fresh;
    CM.cx = nx; CM.cz = nz; U.uCM.value.set(nx, nz, CM.ext, CM.res);
    CM.microS.value = microS(); CM.bakeMat.uniforms.uCM = U.uCM; pass(CM.S, CM.bakeMat, null, false);
    const src = CM.P[CM.cur], dst = CM.P[1 - CM.cur];
    CM.shiftU.tPrev.value = src.texture; CM.shiftU.uOld.value.set(ox, oz, CM.ext, oldOK ? 1 : 0); CM.shiftU.uKeep.value = keep;
    CM.shiftMat.uniforms.uCM = U.uCM; CM.shiftMat.uniforms.tNS = U.tNS;
    pass(dst, CM.shiftMat, null, true);
    CM.cur = 1 - CM.cur; U.tNP.value = CM.P[CM.cur].texture; CM.fresh = false;
    if (ctx.Q.contactStatic !== 0) drawStatic();
    CM.stats.recenters++; (CM.log || (CM.log = [])).push([+ox.toFixed(2), +oz.toFixed(2), +nx.toFixed(2), +nz.toFixed(2), oldOK ? 1 : 0, +keep.toFixed(3)]); if (CM.log.length > 60) CM.log.shift();
    CM.fullSurf = true;
  }
  // fresh snowfall: the press fades in place (same window, no re-bake); objects still resting in it press again
  function refillContact(keep) {
    const src = CM.P[CM.cur], dst = CM.P[1 - CM.cur];
    CM.shiftU.tPrev.value = src.texture; CM.shiftU.uOld.value.set(CM.cx, CM.cz, CM.ext, 1); CM.shiftU.uKeep.value = keep;
    pass(dst, CM.shiftMat, null, true);
    CM.cur = 1 - CM.cur; U.tNP.value = CM.P[CM.cur].texture;
    if (ctx.Q.contactStatic !== 0) drawStatic();
    CM.fullSurf = true;
  }
  function surfaceRegion(rect) { CM.surfMat.uniforms.uCM = U.uCM; pass(CM.R, CM.surfMat, rect, false); }
  function camFor(cam, cx, cz, ext, y) { cam.left = -ext / 2; cam.right = ext / 2; cam.top = ext / 2; cam.bottom = -ext / 2; cam.near = 0; cam.far = 140; cam.updateProjectionMatrix();
    cam.position.set(cx, y - 70, cz); cam.lookAt(cx, y + 30, cz); cam.updateMatrixWorld(true); }

  /* ---- what presses: moving objects (refreshed every 0.5 s) + static props (on window move) */
  const RX_NOCONTACT = /glow|beam|flare|halo|shadow|aura|trail|spark|light|fx|laser|scan/i;
  function contactMeshes(root) {
    const out = [];
    root.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || o.isInstancedMesh && o.count > 64) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (o.userData.noContact || RX_NOCONTACT.test(o.name || '') || ms.some((m) => !m || m.isShaderMaterial || m.isMeshBasicMaterial || (m.transparent && m.depthWrite === false) || m.blending === THREE.AdditiveBlending)) { o.layers.disable(CM.layer); return; }
      o.layers.enable(CM.layer); out.push(o);
    });
    return out;
  }
  function refreshRoots() {
    const c = ctx, list = [];
    const add = (root, r, kind) => { if (root && root.isObject3D) list.push({ root, r, kind }); };
    if (c.player && c.player.c) add(c.player.c.g, 1.3, 'pilot');
    if (c.orm && c.orm.g) add(c.orm.g, 1.3, 'hermit');
    if (c.fox && c.fox.g) add(c.fox.g, 1.2, 'fox');
    for (const s of c.STAGS || []) add(s.g, 2.2, 'stag');
    for (const e of c.enemies || []) if (!e.dead) add(e.g, 1.8, 'shardling');
    if (c.boss && c.boss.g) add(c.boss.g, 5, 'golem');
    if (c.sk && c.sk.g) add(c.sk.g, 3.2, 'skimmer');
    for (const e of (c.Passport && c.Passport.byRole.pushable) || []) if (e.alive && e.obj) add(e.obj, 1.2, 'prop');
    for (const a of list) a.meshes = contactMeshes(a.root);
    CM.roots = list.filter((a) => a.meshes.length);
  }
  function drawRoots(list, mat, rt, cam) {
    const saved = [];
    for (const a of list) for (const m of a.meshes) { saved.push(m, m.material); m.material = mat; }
    try { withTarget(rt, (r) => { for (const a of list) { if (!a.root.parent && a.root.type !== 'Scene') continue; r.render(a.root, cam); } }); }
    finally { for (let i = 0; i < saved.length; i += 2) saved[i].material = saved[i + 1]; }
  }
  // static props: Passport solids in the window, small enough to rest on / in the snow (collider proxies, world space)
  function drawStatic() {
    const P = ctx.Passport; if (!P) return;
    const h = CM.ext / 2, x0 = CM.cx - h, x1 = CM.cx + h, z0 = CM.cz - h, z1 = CM.cz + h, pos = [], idx = [];
    for (const e of P.byRole.solid || []) {
      const b = e.box, g = e.geo; if (!e.alive || !b || !g || b.max[0] < x0 || b.min[0] > x1 || b.max[2] < z0 || b.min[2] > z1) continue;
      if (Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) > 3.2 || b.max[1] - b.min[1] > 2.6) continue;   // no wreck / buildings / big rocks (they sit in their drifts)
      const base = pos.length / 3; for (let k = 0; k < g.vn * 3; k++) pos.push(g.v[k]); for (let k = 0; k < g.i.length; k++) idx.push(g.i[k] + base);
    }
    CM.stats.staticTris = idx.length / 3; if (!idx.length) return;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, CM.matStat); mesh.frustumCulled = false; mesh.layers.set(CM.layer);
    camFor(CM.cam, CM.cx, CM.cz, CM.ext, ctx.groundH(CM.cx, CM.cz));
    withTarget(CM.P[CM.cur], (r) => r.render(mesh, CM.cam));
    geo.dispose();
  }
  const clampRect = (x0, y0, x1, y1, n) => { x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(n, Math.ceil(x1)); y1 = Math.min(n, Math.ceil(y1)); return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null; };
  function contactFrame(dt) {
    const t0 = performance.now(), c = ctx;
    allocContact();
    const want = CM.on && !S.noDef && U.uDefOn.value > 0.5;
    U.uCMOn.value = want ? 1 : 0; if (!want) { U.uPc.value.w = 0; if (CM.patch) CM.patch.visible = false; return; }
    // follow the pilot (CM.focus = {x, z}: debug / test override — the fine window and patch follow that point instead)
    // the window centre sits between the pilot and the camera (the trail the player looks at), the pilot ≥ 3.2 m inside it
    const thr = CM.ext * 0.15, pf = CM.focus || c.player, cam = c.camera.position; let wdx = cam.x - pf.x, wdz = cam.z - pf.z; const wdl = Math.hypot(wdx, wdz);
    const woff = CM.focus ? 0 : Math.min(wdl * 0.5, Math.max(0, CM.ext / 2 - 3.2)); if (wdl > 1e-3) { wdx /= wdl; wdz /= wdl; }
    const p = { x: pf.x + wdx * woff, z: pf.z + wdz * woff };
    if (CM.fresh || Math.abs(p.x - CM.cx) > thr || Math.abs(p.z - CM.cz) > thr || CM.rebake) {
      const far = CM.fresh || Math.abs(p.x - CM.cx) > CM.ext * 0.9 || Math.abs(p.z - CM.cz) > CM.ext * 0.9;
      if (far) CM.fresh = true;
      recenterContact(CM.rebake && !far ? CM.cx : snapCM(p.x), CM.rebake && !far ? CM.cz : snapCM(p.z)); CM.rebake = false;
    }
    // moving objects press (near: fine map; far: coarse map)
    CM.rootsT -= dt; if (CM.rootsT <= 0) { CM.rootsT = 0.5; refreshRoots(); }
    const h = CM.ext / 2, near = [], far = [], regions = []; if (!_cv) _cv = new THREE.Vector3();
    for (const a of CM.roots) {
      const wp = a.root.getWorldPosition(_cv); if (!a.root.visible || !isFinite(wp.x)) continue;
      const inN = Math.abs(wp.x - CM.cx) < h + a.r && Math.abs(wp.z - CM.cz) < h + a.r;
      const fullyN = Math.abs(wp.x - CM.cx) < h - a.r - 0.5 && Math.abs(wp.z - CM.cz) < h - a.r - 0.5;
      if (inN) { near.push(a); regions.push([wp.x - a.r, wp.z - a.r, wp.x + a.r, wp.z + a.r]); }
      if (!fullyN && Math.abs(wp.x - DEF.cx) < DEF.ext / 2 + a.r && Math.abs(wp.z - DEF.cz) < DEF.ext / 2 + a.r) far.push(a);
    }
    if (near.length) { camFor(CM.cam, CM.cx, CM.cz, CM.ext, c.groundH(CM.cx, CM.cz)); drawRoots(near, CM.matDyn, CM.P[CM.cur], CM.cam); CM.stats.actorDraws += near.length; }
    // coarse map: its mip chain is regenerated after every render into it — batch this frame's writes, regenerate once
    const defT = DEF.rt[DEF.cur].texture; let defDirty = false; defT.generateMipmaps = false;
    // far objects (outside the fine window) press the coarse map every 3rd frame, and only when near the snow
    if (far.length && U.uDefOn.value > 0.5 && (CM.stats.frames % 3) === 0) {
      const low = far.filter((a) => { const y = a.root.getWorldPosition(_cv).y; return y - c.getH(_cv.x, _cv.z) < 1.2; });
      if (low.length) { camFor(CM.camC, DEF.cx, DEF.cz, DEF.ext, c.player.y); drawRoots(low, CM.matCoarse, DEF.rt[DEF.cur], CM.camC); CM.stats.coarseDraws += low.length; defDirty = true; } }
    if (STAMPQ.length) regions.push(...flushStampShim());
    // drawn surface + coarse copy, only where something pressed this frame (whole window after a move)
    const n = CM.res, e = CM.e, ox = CM.cx - h, oz = CM.cz - h, m = 0.1;
    const rects = CM.fullSurf ? [[0, 0, n, n]] : mergeRects(regions.map((r) => clampRect((r[0] - m - ox) / e, (r[1] - m - oz) / e, (r[2] + m - ox) / e, (r[3] + m - oz) / e, n)).filter(Boolean));
    for (const r of rects) { surfaceRegion(r); CM.stats.regionTexels += r[2] * r[3]; }
    // fine → coarse, same regions (in coarse texels), inside the fine window only
    if (rects.length) {
      CM.downU.uDefW.value.set(DEF.cx, DEF.cz, DEF.ext, DEF.res); CM.downMat.uniforms.tNR = U.tNR; CM.downMat.uniforms.uCM = U.uCM;
      const ec = DEF.ext / DEF.res, dox = DEF.cx - DEF.ext / 2, doz = DEF.cz - DEF.ext / 2;
      for (const r of rects) {
        const wx0 = Math.max(ox + r[0] * e, ox + 2 * ec), wz0 = Math.max(oz + r[1] * e, oz + 2 * ec), wx1 = Math.min(ox + (r[0] + r[2]) * e, ox + CM.ext - 2 * ec), wz1 = Math.min(oz + (r[1] + r[3]) * e, oz + CM.ext - 2 * ec);
        const cr = clampRect(Math.ceil((wx0 - dox) / ec), Math.ceil((wz0 - doz) / ec), Math.floor((wx1 - dox) / ec), Math.floor((wz1 - doz) / ec), DEF.res);
        if (cr) { pass(DEF.rt[DEF.cur], CM.downMat, cr, false); defDirty = true; }
      }
    }
    defT.generateMipmaps = true;
    if (defDirty) withTarget(DEF.rt[DEF.cur], (r) => r.render(CM.emptyScene || (CM.emptyScene = new THREE.Scene()), DEF.cam));   // one mip regeneration
    CM.fullSurf = false;
    placePatch();
    pressCache(dt);
    CM.stats.frames++; CM.stats.cpuMs = CM.stats.cpuMs * 0.95 + (performance.now() - t0) * 0.05;
  }
  let _cv = null;
  function mergeRects(rs) {   // union overlapping texel rects (a few actors → a few passes)
    let out = rs.slice(), merged = true;
    while (merged) { merged = false;
      for (let i = 0; i < out.length && !merged; i++) for (let j = i + 1; j < out.length; j++) { const a = out[i], b = out[j];
        if (a[0] <= b[0] + b[2] && b[0] <= a[0] + a[2] && a[1] <= b[1] + b[3] && b[1] <= a[1] + a[3]) {
          const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0] + a[2], b[0] + b[2]), y1 = Math.max(a[1] + a[3], b[1] + b[3]);
          out[i] = [x0, y0, x1 - x0, y1 - y0]; out.splice(j, 1); merged = true; break; } } }
    return out;
  }

  /* ---- contact patch: real snow geometry around the pilot, built on the fine map's texels */
  function buildPatch(key) {
    CM.patchKey = key;
    if (CM.patch) { S.root.remove(CM.patch); CM.patch.geometry.dispose(); }
    const step = Math.max(1, ctx.Q.contactStep | 0 || 1), N = Math.max(16, Math.round((ctx.Q.contactPatch || 7) / (CM.e * step)));
    const V = N + 3, pos = new Float32Array(V * V * 3), idx = new Uint32Array((V - 1) * (V - 1) * 6);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) { const k = (j * V + i) * 3; pos[k] = i - 1; pos[k + 1] = 0; pos[k + 2] = j - 1; }
    let q = 0; for (let j = 0; j < V - 1; j++) for (let i = 0; i < V - 1; i++) { const a = j * V + i, b = a + V, c2 = b + 1, d = a + 1; idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c2; idx[q++] = d; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    CM.pN = N; CM.pStep = step;
    // uniform objects are created once: the compiled program keeps references to them (a preset change rebuilds only the grid)
    if (!CM.patchU) CM.patchU = { uPt: { value: new THREE.Vector4() }, uRL: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) } };
    CM.patchU.uPt.value.set(0, 0, step, N);
    if (!CM.patchMat) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      mat.defines = { TR_DETAIL: '', TR_PATCH: '' };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U, CM.patchU);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_DETAIL_V + GLSL_PATCH_V)
          .replace('#include <beginnormal_vertex>', GLSL_PATCH_MAIN)
          .replace('#include <begin_vertex>', 'vec3 transformed = vW;');
        patchFrag(sh);
      };
      mat.customProgramCacheKey = () => 'trPatch1';
      CM.patchMat = mat;
    }
    const mesh = new THREE.Mesh(g, CM.patchMat);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'terrain_contact_patch';
    mesh.raycast = () => {}; mesh.userData.noCollide = true; mesh.matrixAutoUpdate = false; mesh.visible = false;
    CM.patch = mesh; S.root.add(mesh);
  }
  // centre: between the pilot and the camera (the trail the player looks at), kept inside the fine window
  function placePatch() {
    const m = CM.patch; if (!m) return;
    const p = CM.focus || ctx.player, cam = ctx.camera.position, e = CM.e, N = CM.pN, st = CM.pStep, span = N * st * e, half = span / 2;
    let dx = cam.x - p.x, dz = cam.z - p.z; const dl = Math.hypot(dx, dz), off = Math.min(Math.max(0, half - 1.2), dl * 0.45, 2.2);   // pilot ≥ 1.2 m inside the patch
    if (dl > 1e-3) { dx /= dl; dz /= dl; } else { dx = dz = 0; }
    const fx = p.x + dx * off, fz = p.z + dz * off, q = 8 * st;
    let tx = Math.round(((fx - (CM.cx - CM.ext / 2)) / e - N * st / 2) / q) * q, tz = Math.round(((fz - (CM.cz - CM.ext / 2)) / e - N * st / 2) / q) * q;
    tx = clamp(tx, 2 * st, CM.res - N * st - 2 * st - 1); tz = clamp(tz, 2 * st, CM.res - N * st - 2 * st - 1);
    CM.patchU.uPt.value.set(tx, tz, st, N);
    const pcx = CM.cx - CM.ext / 2 + (tx + 0.5) * e + half, pcz = CM.cz - CM.ext / 2 + (tz + 0.5) * e + half;
    U.uPc.value.set(pcx, pcz, half, Math.min(0.45, half * 0.2));
    S.levels.forEach((L, i) => { if (i < 4) CM.patchU.uRL.value[i].set(L.u.uLv.value.x, L.u.uLv.value.y, L.s, L.u.uLv.value.w); });
    for (let i = S.levels.length; i < 4; i++) CM.patchU.uRL.value[i].set(0, 0, 0, 0);
    m.visible = S.levels.length > 0;
  }

  /* ---- gameplay press cache (CPU, 0.5 m cells, share of the loose snow pressed): trail speed-up, deep-snow sound, snow
   * depth for other modules. SNOW-CONTACT measured every GPU→CPU readback (even one per 0.25–0.5 s) as a whole-pipeline
   * stall on ANGLE/Metal (≈ 150 ms on a loaded M1 Pro), so nothing is read back at run time: the drawn prints are GPU-only,
   * the feet need no readback (a boot's sink depends only on the snow at that spot, so stepping into a print reproduces
   * its depth; the CPU replay of the undisturbed surface equals the GPU's to ≈ 0.1 mm), and this cache is filled from the
   * same moving objects' positions — approximate, for gameplay only, never drawn. */
  function pressCache(dt) {
    const c = ctx, n = DEF.mirN, m = DEF.mir; if (!m) return;
    const mark = (x, z, f) => { const i = Math.floor((x - DEF.mirCx) / DEF.mirC + n / 2), j = Math.floor((z - DEF.mirCz) / DEF.mirC + n / 2); if (i < 0 || j < 0 || i >= n || j >= n) return; const k = j * n + i; if (m[k] < f) m[k] = f; };
    const low = (x, y, z, tol) => y - c.getH(x, z) < tol + sampleD(x, z);
    const p = c.player, G = c.G;
    if (p && G && !G.riding && p.onGround && low(p.x, p.y, p.z, 0.3)) mark(p.x, p.z, p.rollT > 0 || p.sliding ? 0.8 : footPress(p.x, p.z) * 0.6);
    const sk = c.sk; if (sk && sk.g && low(sk.x, sk.y || 0, sk.z, 1.9)) { const fx = Math.sin(sk.yaw || 0), fz = Math.cos(sk.yaw || 0); mark(sk.x + fz * 0.52, sk.z - fx * 0.52, 0.8); mark(sk.x - fz * 0.52, sk.z + fx * 0.52, 0.8); }
    const f = c.fox; if (f && f.g && low(f.x, f.g.position.y, f.z, 0.3)) mark(f.x, f.z, 0.3);
    for (const s of c.STAGS || []) if (s.g && s.g.visible !== false && low(s.x, s.g.position.y, s.z, 0.4)) mark(s.x, s.z, 0.45);
  }
  // test hook (tools/snow-contact.mjs): the whole fine press map → { res, ext, cx, cz, d, dd } (m)
  CM.readNear = async () => {
    const n = CM.res, buf = new Uint16Array(n * n * 4), cx = CM.cx, cz = CM.cz, ext = CM.ext;
    await renderer.readRenderTargetPixelsAsync(CM.P[CM.cur], 0, 0, n, n, buf);
    const f = THREE.DataUtils.fromHalfFloat, d = new Float32Array(n * n), dd = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) { d[k] = f(buf[k * 4]); dd[k] = f(buf[k * 4 + 1]); }
    return { res: n, ext, cx, cz, d, dd };
  };
  // test hook: an n × n window of the drawn surface around (x, z) → { x0, z0, e, n, H, S0, d, dd } (m; synchronous readback — tests only)
  CM.readSurface = (x, z, n = 64) => {
    if (!CM.dbgRT || CM.dbgRT.width !== n) { if (CM.dbgRT) CM.dbgRT.dispose(); CM.dbgRT = new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
      CM.dbgU = { uO: { value: new THREE.Vector2() } };
      CM.dbgMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, CM.dbgU), depthTest: false, depthWrite: false, toneMapped: false, vertexShader: QUAD_V,
        fragmentShader: `uniform sampler2D tNS, tNP, tNR; uniform vec4 uCM; uniform vec2 uO; varying vec2 vUv;
          void main(){ ivec2 t = clamp(ivec2(uO) + ivec2(gl_FragCoord.xy), ivec2(0), ivec2(int(uCM.w) - 1)); vec2 d = texelFetch(tNP, t, 0).rg;
            gl_FragColor = vec4(texelFetch(tNR, t, 0).r, texelFetch(tNS, t, 0).x, d); }` }); }
    const ox = Math.round((x - (CM.cx - CM.ext / 2)) / CM.e - n / 2), oz = Math.round((z - (CM.cz - CM.ext / 2)) / CM.e - n / 2);
    CM.dbgU.uO.value.set(ox, oz); CM.dbgMat.uniforms.uCM = U.uCM; pass(CM.dbgRT, CM.dbgMat, null, false);
    const buf = new Float32Array(n * n * 4); renderer.readRenderTargetPixels(CM.dbgRT, 0, 0, n, n, buf);
    const H = new Float32Array(n * n), S0 = new Float32Array(n * n), d = new Float32Array(n * n), dd = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) { H[k] = buf[k * 4]; S0[k] = buf[k * 4 + 1]; d[k] = buf[k * 4 + 2]; dd[k] = buf[k * 4 + 3]; }
    return { x0: CM.cx - CM.ext / 2 + (ox + 0.5) * CM.e, z0: CM.cz - CM.ext / 2 + (oz + 0.5) * CM.e, e: CM.e, n, H, S0, d, dd };
  };
  // debug: wall time of one in-place window re-bake (all full-window passes + static props), GPU included (gl.finish)
  CM.timeRecenter = () => { const gl = renderer.getContext(); gl.finish(); const t0 = performance.now(); recenterContact(CM.cx, CM.cz); surfaceRegion([0, 0, CM.res, CM.res]); CM.fullSurf = false; gl.finish(); const t1 = performance.now();
    let s0 = performance.now(); if (ctx.Q.contactStatic !== 0) drawStatic(); gl.finish(); return { totalMs: +(t1 - t0).toFixed(2), staticMs: +(performance.now() - s0).toFixed(2), staticTris: CM.stats.staticTris }; };
  CM.setOn = (on) => { CM.on = !!on; if (!CM.on && CM.patch) CM.patch.visible = false; return CM.on; };

  /* ---- stamp shim: ctx.snowStamp({x, z, dx, dz, len, wid, type, str}) presses an analytic shape (API compatibility) */
  const STAMPQ = [], STAMP_T = { boot: 0, paw: 1, hoof: 2, band: 3, blob: 4 };
  function initStampShim() {
    const MAXS = 256, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXS * 4 * 3), 3));
    g.setAttribute('aL', new THREE.BufferAttribute(new Float32Array(MAXS * 4 * 2), 2));
    g.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(MAXS * 4 * 2), 2));
    const idx = new Uint16Array(MAXS * 6); for (let i = 0; i < MAXS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const mat = new THREE.ShaderMaterial({ uniforms: { tNS: U.tNS }, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: 'attribute vec2 aL; attribute vec2 aP; varying vec2 vL; varying vec2 vP; void main(){ vL = aL; vP = aP; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }',
      fragmentShader: `uniform sampler2D tNS; varying vec2 vL; varying vec2 vP;
        void main(){ float u = vL.x, v = vL.y, t = vP.x, p;
          if (t < .5) p = 1. - smoothstep(.82, 1., length(vec2(u / mix(.74, 1., smoothstep(-1., .5, v)), v)));
          else if (t < 2.5 && t > 1.5) p = 1. - smoothstep(.75, 1., min(length(vec2((u - .42) * 1.7, v)), length(vec2((u + .42) * 1.7, v))));
          else if (t < 3.5 && t > 2.5) p = (1. - smoothstep(.8, 1., abs(u))) * (1. - smoothstep(.85, 1., abs(v)));
          else p = 1. - smoothstep(.65, 1., length(vec2(u, v)));
          vec4 s = texelFetch(tNS, ivec2(gl_FragCoord.xy), 0); float pen = p * vP.y * .8 * max(s.x - s.z, 0.) * 1.25;
          gl_FragColor = vec4(pen, pen, 0., 0.); }` });
    CM.stampMesh = new THREE.Mesh(g, mat); CM.stampMesh.frustumCulled = false; CM.stampMesh.layers.set(CM.layer); CM.stampMax = MAXS;
  }
  function stamp(o) {
    if (!CM.ok || STAMPQ.length >= CM.stampMax) return false;
    const x = o.x, z = o.z; if (Math.abs(x - CM.cx) > CM.ext / 2 - 1 || Math.abs(z - CM.cz) > CM.ext / 2 - 1) return false;
    const t = typeof o.type === 'number' ? o.type : STAMP_T[o.type || 'boot'] || 0;
    let dx = o.dx || 0, dz = o.dz || 1; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    STAMPQ.push([x, z, dx, dz, o.len || 0.3, o.wid || 0.13, t, o.str == null ? 0.9 : o.str]); return true;
  }
  function flushStampShim() {
    const g = CM.stampMesh.geometry, pos = g.attributes.position.array, al = g.attributes.aL.array, ap = g.attributes.aP.array, n = STAMPQ.length, regs = [];
    for (let k = 0; k < n; k++) {
      const [x, z, fx, fz, len, wid, t, s] = STAMPQ[k], rx = fz, rz = -fx, hw = wid * 0.5, hl = len * 0.5;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], c) => { const vi = k * 4 + c; pos[vi * 3] = x + rx * a * hw + fx * b * hl; pos[vi * 3 + 1] = 0; pos[vi * 3 + 2] = z + rz * a * hw + fz * b * hl; al[vi * 2] = a; al[vi * 2 + 1] = b; ap[vi * 2] = t; ap[vi * 2 + 1] = s; });
      const r = Math.max(hw, hl); regs.push([x - r, z - r, x + r, z + r]);
    }
    g.attributes.position.needsUpdate = g.attributes.aL.needsUpdate = g.attributes.aP.needsUpdate = true; g.setDrawRange(0, n * 6); STAMPQ.length = 0;
    camFor(CM.cam, CM.cx, CM.cz, CM.ext, ctx.groundH(CM.cx, CM.cz)); withTarget(CM.P[CM.cur], (r) => r.render(CM.stampMesh, CM.cam));
    return regs;
  }

  /* ---------------------------------------------------------- actors: contact puffs the objects themselves don't make */
  const PUFF = 0xe4ecf8;
  function puff(x, z, amt, dirx = 0, dirz = 0) {
    if (amt < 0.04 || !ctx.emit) return;
    const y = ctx.getH(x, z) + sampleD(x, z) * 0.8, n = Math.min(6, 1 + Math.round(amt * 10));
    for (let i = 0; i < n; i++) ctx.emit(x + (Math.random() - 0.5) * 0.2, y + 0.05, z + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 1.2 + dirx, 0.5 + Math.random() * 1.2 * amt * 3, (Math.random() - 0.5) * 1.2 + dirz, 0.5 + Math.random() * 0.5, PUFF, 0.18 + amt * 0.6, 3.5, 1.2);
  }
  // SNOW-CONTACT: no stamps here any more (pilot, fox, stags, landings, rolls and skis press the map with their own
  // geometry). What stays is the skimmer's spray while it moves (the one moving thing with no foot-plant event).
  const TRK = { sk: null };
  function trackActors(dt) {
    const sk = ctx.sk;
    if (sk && sk.g) {
      const x = sk.x, z = sk.z, t = TRK.sk || (TRK.sk = { x, z });
      const d = Math.hypot(x - t.x, z - t.z), low = (sk.y || 0) - ctx.getH(x, z) < 1.9;
      if (d > 8) { t.x = x; t.z = z; }
      else if (d > 0.08 && low && ctx.getH(x, z) > 0.1) {
        const fx = (x - t.x) / d, fz = (z - t.z) / d, spd = d / Math.max(dt, 1e-3);
        if (spd > 4 && Math.random() < 0.6) puff(x - fx * 1.6, z - fz * 1.6, sampleD(x, z) * Math.min(2, spd / 12), -fx * 2, -fz * 2);
        t.x = x; t.z = z;
      }
    }
  }
  function onTerrain(x, y, z, tol = 0.45) { return y - ctx.getH(x, z) < tol + sampleD(x, z); }

  /* ------------------------------------------------------ visible snow surface on the CPU (feet, paws, hooves) */
  // snowContact(x, z) → { surf, s0, dep, press }: s0 = the undisturbed snow surface there — the CPU replay of exactly what
  // the GPU bakes (integer-hash micro relief: equal to ≈ 0.1 mm), dep = loose snow depth, surf = s0 minus the gameplay press
  // cache (approximate, 0.5 m). Feet use s0 and dep: a planted foot sinks to s0 − footPress·dep and draws that print itself.
  const fract = (v) => v - Math.floor(v);
  function trHash(x, y) { let a = fract(x * 0.1031), b = fract(y * 0.1031), c = a; const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fract((a + b) * c); }
  function trVN(x, y) { const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = trHash(i, j), b = trHash(i + 1, j), c = trHash(i, j + 1), d = trHash(i + 1, j + 1); return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy; }
  const lodW = (l, s) => clamp(l / s * 0.33 - 1, 0, 1);
  // keep in sync with GLSL trHashI / trVNI (uint arithmetic → identical values)
  function trHashI(ix, iy) { let h = (Math.imul((ix + 1048576) >>> 0, 1597334677) ^ Math.imul((iy + 1048576) >>> 0, 3812015801 | 0)) >>> 0; h = (Math.imul(h, 747796405) + 2891336453) >>> 0;
    h = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277803737) >>> 0; h = ((h >>> 22) ^ h) >>> 0; return (h >>> 8) / 16777216; }
  function trVNI(x, y) { const fx0 = Math.floor(x), fy0 = Math.floor(y), i = fx0 | 0, j = fy0 | 0; let fx = x - fx0, fy = y - fy0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = trHashI(i, j), b = trHashI(i + 1, j), c = trHashI(i, j + 1), d = trHashI(i + 1, j + 1); return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy; }
  // keep in sync with GLSL_SNOWFN's trMicro (rare/patchy, fanned direction, varied spacing)
  function trMicro(x, z, s, expo) {
    const wx0 = S.wind[0], wz0 = S.wind[1];
    const rot = (trVNI(x * 0.012 + 151, z * 0.012 + 151) - 0.5) * 2.6;
    const cr = Math.cos(rot), sr = Math.sin(rot), wx = wx0 * cr - wz0 * sr, wz = wx0 * sr + wz0 * cr;
    const qx = x * wx + z * wz, qz = -x * wz + z * wx;
    let h = (trVNI(x * 0.14, z * 0.14) - 0.5) * 0.15 * lodW(7, s) + (trVNI(x * 0.37 + 17, z * 0.37 + 17) - 0.5) * 0.07 * lodW(2.7, s);
    const freqJ = 0.55 + 0.85 * trVNI(x * 0.021 + 71, z * 0.021 + 71);
    const patchM = smooth(0.6, 0.88, trVNI(x * 0.017 + 91, z * 0.017 + 91));
    let sa = trVNI(qx * 0.21 * freqJ + 5, qz * 1.25 * freqJ + 5); sa = 1 - Math.abs(sa * 2 - 1); sa *= sa;
    const sb = 1 - Math.abs(trVNI(qx * 0.55 * freqJ + 11, qz * 3.2 * freqJ + 11) * 2 - 1);
    h += ((sa - 0.45) * 0.13 * lodW(0.8, s) + (sb - 0.5) * 0.045 * lodW(0.31, s)) * expo * patchM;
    return clamp(h, -0.16, 0.16);
  }
  function sampleHs(x, z) {
    const HALF = S.W / 2, T = S.W / DN, gx = (x + HALF) / T - 0.5, gz = (z + HALF) / T - 0.5, H = S.Hs;
    const i = clamp(Math.floor(gx), 0, DN - 2), j = clamp(Math.floor(gz), 0, DN - 2), fx = clamp(gx - i, 0, 1), fz = clamp(gz - j, 0, 1), k = j * DN + i;
    return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fz) + (H[k + DN] * (1 - fx) + H[k + DN + 1] * fx) * fz;
  }
  // undisturbed loose snow above the smooth ground at spacing s (CPU replay of trSnowU)
  function looseCPU(x, z, s) { const dep = sampleD(x, z), m = trMicro(x, z, s, smooth(0.03, 0.14, dep) * (1 - smooth(0.2, 0.34, dep))) * smooth(0, 0.08, dep); return Math.max(dep + m, 0); }
  const _sc = { surf: 0, s0: 0, floor: 0, dep: 0, press: 0, exact: false };
  const microS = () => (S.levels && S.levels.length ? S.levels[0].s : ctx.CELL / 16);   // the finest ring's spacing (same on the GPU bake)
  // micro-relief detail level of what is drawn at (x, z): the fine map / patch bake at the finest ring's spacing; outside the
  // fine window the ring level covering the point (same test + morph as the patch's trRingSp / the ring vertex stage)
  function microAt(x, z) {
    if (snowFine(x, z) > 0) return microS();
    for (const L of S.levels) { const v = L.u.uLv.value, ch = Math.max(Math.abs(x - v.x), Math.abs(z - v.y)) / (v.w * 0.5 * L.s);
      if (ch < 1) return L.s * 2 ** clamp((ch - (1 - 28 / v.w)) / (20 / v.w), 0, 1); }
    return microS();
  }
  function snowContact(x, z, noRequest) {
    if (!S.Hs || !S.D) { const g = ctx.groundH(x, z); _sc.surf = _sc.s0 = _sc.floor = g; _sc.dep = 0; _sc.press = 0; _sc.exact = false; return _sc; }
    const s = microAt(x, z), dep = sampleD(x, z), loose = looseCPU(x, z, s), hs = sampleHs(x, z), pr = S.noDef ? 0 : pressAt(x, z);
    _sc.s0 = hs + loose; _sc.floor = hs + 0.2 * loose; _sc.dep = dep; _sc.press = Math.min(pr * dep, loose * 0.8); _sc.surf = _sc.s0 - _sc.press; _sc.exact = false; return _sc;
  }
  // 1 where the fine contact map (real print geometry) covers (x, z), fading to 0 over its last metre: outside it the snow
  // is only drawn from the coarse 12.5 cm map, so feet there should barely sink (they would look buried in flat snow)
  function snowFine(x, z) { if (!CM.ok || !CM.on || S.noDef || !CM.res) return 0; const h = CM.ext / 2 - 0.5, e = Math.min(h - Math.abs(x - CM.cx), h - Math.abs(z - CM.cz)); return clamp(e, 0, 1); }
  // the snow height (undisturbed minus the gameplay press cache)
  function snowSurfaceAt(x, z) { return snowContact(x, z, true).surf; }
  // how hard a planted foot presses the loose snow (fraction of it): 8–20 cm sink in fresh snow, less on a thin crust
  function footPress(x, z) { const d = sampleD(x, z); return d < 0.02 ? 0 : clamp(0.2 / d, 0.25, 0.65); }

  /* ------------------------------------------------------ snow gameplay */
  function snowDepthAt(x, z) { if (!S.D) return 0; return sampleD(x, z) * (1 - pressAt(x, z)); }
  function slopeAt(x, z, r = 1) {
    const g = ctx.getH, e = Math.max(0.2, r), hx = (g(x + e, z) - g(x - e, z)) / (2 * e), hz = (g(x, z + e) - g(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI;
  }
  const RX_METAL = /kestrel|ship|wreck|station|hab|module|dome|tank|drum|pole|antenna|mast|container|metal|vehicle|snowcat|snowmobile|skimmer|tower|pipe|mech|plane|hull|generator|beacon|console|radar|dish|lamp/i;
  const RX_WOOD = /crate|pier|wood|plank|sledge|sled|boat|cabin|hut|pallet|bench|deck|box|log|fence|shelf|ladder|table/i;
  function classifyName(n) { if (!n) return null; if (RX_METAL.test(n)) return 'metal'; if (RX_WOOD.test(n)) return 'wood'; return 'rock'; }
  function surfaceAt(x, z, y) {
    const h = ctx.getH(x, z);
    if (y !== undefined && y !== null) {
      const PH = ctx.PH;
      if (PH && PH.ok && PH.P && PH.P.raycast) {
        try {
          const hit = PH.P.raycast({ x, y: y + 0.6, z }, { x: 0, y: -1, z: 0 }, 1.5, { groups: PH.P.groups.STATIC });
          if (hit && hit.tag) {
            if (hit.tag.kind === 'ice') return 'ice';
            if (hit.tag.kind !== 'terrain') return classifyName(hit.tag.name || (hit.tag.userData && hit.tag.userData.name)) || 'rock';
          }
        } catch (e) { /* physics busy */ }
      } else if (y > h + 0.35 + sampleD(x, z)) {
        let best = null, ba = 1e9;
        for (const e of ctx.Passport.byRole.solid || []) {
          const b = e.box; if (!e.alive || !b || x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2] || y < b.min[1] - 0.2 || y > b.max[1] + 0.4) continue;
          const a = (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]); if (a < ba) { ba = a; best = e; }
        }
        if (best) return classifyName(best.name) || 'rock';
      }
    }
    if (h < 0.05) return 'ice';
    const P = ctx.POI; if (P.lake && Math.hypot(x - P.lake.x, z - P.lake.z) < 48.5) return 'ice';
    if (slopeAt(x, z, 1) > 40) return 'rock';
    const d = sampleD(x, z), g = sampleG(x, z), pr = pressAt(x, z);
    if (ctx.riftD && ctx.riftD(x, z) < 52) return 'rock';
    if (d < 0.035 && g > 0.35) return 'rock';
    if (d * (1 - pr * 0.6) > 0.26) return 'deep_snow';
    return 'snow';
  }
  function slowFactor() {
    const p = ctx.player; if (!p || !S.D) return 1;
    if (!onTerrain(p.x, p.y, p.z, 0.3)) return 1;
    const vx = p.vx || 0, vz = p.vz || 0, v = Math.hypot(vx, vz), ax = v > 0.3 ? vx / v : 0, az = v > 0.3 ? vz / v : 0;
    const x = p.x + ax * 0.6, z = p.z + az * 0.6, d = sampleD(x, z) * (1 - pressAt(x, z));
    return 1 - 0.4 * smooth(0.18, 0.7, d);
  }
  function hookCharacter() {
    const PH = ctx.PH; if (!PH || !PH.ok || !PH.ch || PH.ch.__trSnow) return;
    const ch = PH.ch, mv = ch.move.bind(ch);
    ch.move = (dt, want, jump, ...rest) => {
      const k = TR.slowK == null ? 1 : TR.slowK;
      return mv(dt, k < 0.999 && want ? Object.assign({}, want, { x: want.x * k, z: want.z * k }) : want, jump, ...rest);
    };
    ch.__trSnow = true;
  }

  /* ------------------------------------------------------ snow cover chunk */
  // snowCover(materialOrObject, { amount = 1, minUp = 0.55, soft = 0.25, skirt = 0.45, scale = 0.35, sparkle = 1 })
  // Adds snow on up-facing surfaces (normal-map aware, noisy edge) + a soft skirt where the object meets the snow.
  // Idempotent (re-calling updates the uniforms). Works with MeshStandard/Physical/Lambert/Phong, instanced and skinned.
  function snowCover(target, opts = {}) {
    if (!target) return target;
    if (target.isObject3D) { target.traverse((o) => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => snowCover(m, opts)); }); return target; }
    const mat = target; if (!mat.isMaterial || mat.isShaderMaterial || mat.isMeshBasicMaterial) return mat;
    if (typeof opts === 'number') opts = { amount: opts };
    const o = Object.assign({ amount: 1, minUp: 0.55, soft: 0.25, skirt: 0.45, scale: 0.35, sparkle: 1 }, opts || {});
    if (mat.userData.trSnow) { const u = mat.userData.trSnow; u.uScAmt.value = o.amount; u.uScP.value.set(o.minUp, o.soft, o.skirt, o.scale); return mat; }
    const u = { uScAmt: { value: o.amount }, uScP: { value: new THREE.Vector4(o.minUp, o.soft, o.skirt, o.scale) } };
    mat.userData.trSnow = u;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      Object.assign(sh.uniforms, u, { tScD: U.tSFd, tScN: U.tSFn, tScDD: U.tDD, uScW: U.uW, uScHsN: U.uHsN, uScSun: U.uSunV });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vScW; varying vec3 vScN;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          { vec4 scp = vec4(transformed, 1.); vec3 scn = objectNormal;
            #ifdef USE_INSTANCING
              scp = instanceMatrix * scp; scn = mat3(instanceMatrix) * scn;
            #endif
            vScW = (modelMatrix * scp).xyz; vScN = normalize(mat3(modelMatrix) * scn); }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          uniform sampler2D tScD, tScN, tScDD; uniform float uScAmt, uScW, uScHsN; uniform vec4 uScP; uniform vec3 uScSun;
          varying vec3 vScW; varying vec3 vScN;
          float scHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float scVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(scHash(i), scHash(i + vec2(1., 0.)), f.x), mix(scHash(i + vec2(0., 1.)), scHash(i + vec2(1., 1.)), f.x), f.y); }
          float scGround(vec2 p){ vec2 g = (p + uScW * .5) / (uScW / uScHsN) - .5; ivec2 a = ivec2(clamp(floor(g + .5), vec2(0.), vec2(uScHsN - 1.)));
            vec4 q = texelFetch(tScDD, a, 0); return q.x + q.y + q.z; }`)
        .replace('#include <emissivemap_fragment>', `{
          vec3 scWN = normalize((vec4(normal, 0.) * viewMatrix).xyz);
          vec2 suv = vScW.xz * uScP.w + vScW.y * .13, sdx = dFdx(suv), sdy = dFdy(suv);
          float scNz = scVN(vScW.xz * 1.7 + vScW.y * .9) * .6 + scVN(vScW.xz * .31 - vScW.y * .2) * .4;
          float scTop = smoothstep(uScP.x, uScP.x + uScP.y, scWN.y * .7 + normalize(vScN).y * .3 + (scNz - .5) * .35) * uScAmt;
          float scSk = 0.;
          if (uScP.z > 0.) { float gy = scGround(vScW.xz); scSk = 1. - smoothstep(0., uScP.z, vScW.y - gy + (scNz - .5) * uScP.z * .9); }
          float sc = clamp(max(scTop, scSk), 0., 1.);
          if (sc > .002) {
            vec3 sAlb = textureGrad(tScD, suv, sdx, sdy).rgb * vec3(.97, .985, 1.);
            vec3 sN = textureGrad(tScN, suv, sdx, sdy).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, sAlb, sc);
            #ifdef STANDARD
              roughnessFactor = mix(roughnessFactor, sN.z, sc); metalnessFactor = mix(metalnessFactor, 0., sc);
            #endif
            vec3 upV = normalize((viewMatrix * vec4(vec3(sN.x * 2. - 1., 1.6, sN.y * 2. - 1.), 0.)).xyz);
            normal = normalize(mix(normal, upV, sc * .75));
          }
        }
        #include <emissivemap_fragment>`);
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|trSnow1'; };
    mat.needsUpdate = true;
    return mat;
  }

  /* ------------------------------------------------------------ sea / lake */
  const GLSL_ICE_HEAD = /* glsl */`
    uniform sampler2D tIceD, tIceN, tSnD, tSnN, tNz; uniform vec2 uWind; uniform vec4 uIce; uniform vec3 uIceC;
    varying vec3 vIW;
    ${GLSL_NOISE}
    ${GLSL_MS}
    void trNT(sampler2D td, sampler2D tn, vec2 uv, vec2 dx, vec2 dy, float k, out vec3 c, out vec3 n){
      float l = k * 8.; float ia = floor(l), f = fract(l);
      vec2 oa = sin(vec2(3., 7.) * ia), ob = sin(vec2(3., 7.) * (ia + 1.));
      vec3 ca = textureGrad(td, uv + oa, dx, dy).rgb, cb = textureGrad(td, uv + ob, dx, dy).rgb;
      float b = smoothstep(.2, .8, f - .1 * dot(ca - cb, vec3(1.)));
      c = mix(ca, cb, b); n = mix(textureGrad(tn, uv + oa, dx, dy).rgb, textureGrad(tn, uv + ob, dx, dy).rgb, b);
    }
    vec3 iceVor(vec2 p){   // x: F1, y: F2 - F1 (edge distance), z: cell id
      vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9., id = 0.;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y)); vec2 o = vec2(trHash(i + g), trHash(i + g + 19.7)) * .8 + .1;
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; id = trHash(i + g + 5.3); } else if (d < d2) d2 = d;
      }
      return vec3(d1, d2 - d1, id);
    }
  `;
  // uIce: x tile (m), y snow amount, z pressure-ridge scale (m, 0 = off), w inner-layer depth (m); uIceC: deep colour; lake centre/radius in uIceL
  const GLSL_ICE_MAT = /* glsl */`
    vec3 P = vIW; float iDist = length(vViewPosition); vec3 V = normalize(cameraPosition - P); vec2 dPx = dFdx(P.xz), dPy = dFdy(P.xz);
    vec4 nz = texture(tNz, P.xz * (1. / 180.)), nz2 = texture(tNz, P.xz * (1. / 31.) + .5);
    vec3 cI, tI; trMS(tIceD, tIceN, P.xz / uIce.x, nz2.a, .9, cI, tI);
    vec2 inUV = (P.xz - V.xz / max(V.y, .2) * uIce.w) / uIce.x * 1.37 + .31;
    vec3 inner = texture(tIceD, inUV).rgb;                       // a deeper layer seen through the clear ice
    float lumI = trLum(cI);
    cI = mix(vec3(lumI) * vec3(.85, .93, 1.), cI, .7) * .55 + .45 * vec3(.42, .5, .56);   // calmer veins
    vec3 ice = mix(cI, uIceC + inner * uIceC * 4., (1. - smoothstep(.1, .5, lumI)) * .55);  // dark = clear ice: look into the depth
    float ridge = 0., fid = .5;
    if (uIce.z > 0.) {
      vec3 vo = iceVor(P.xz / uIce.z + (nz.rg - .5) * 1.2); fid = vo.z;
      ridge = (1. - smoothstep(.0, .07 + nz.b * .05, vo.y)) * smoothstep(.25, .6, nz2.r + .2);
      ice *= .86 + .28 * fid;
    }
    float snowCov = clamp(smoothstep(.3, .62, nz.g + (fid - .5) * .35 + (nz2.g - .5) * .3) * uIce.y + ridge, 0., 1.);
    vec3 cS = vec3(.7), tS = vec3(.5, .5, .8);
    vec2 wq = vec2(-uWind.y, uWind.x);
    trMS(tSnD, tSnN, vec2(dot(P.xz, wq), dot(P.xz, uWind)) / 4.2, nz.a, 0., cS, tS);
    cS *= vec3(.97, .985, 1.) * (1. + ridge * .08);
    vec3 iAlb = mix(ice, cS, snowCov);
    float iRough = mix(.06 + tI.z * .35, tS.z, snowCov);
    vec2 nI = tI.xy * 2. - 1., nS = tS.xy * 2. - 1.;
    vec2 rb = vec2(trVN(P.xz * 1.9) - .5, trVN(P.xz * 1.9 + 7.) - .5) * ridge * 1.4;
    vec3 iWN = normalize(vec3(0., 1., 0.) + vec3(mix(nI * .45, nS * .5, snowCov) + rb, 0.).xzy);
    float iFade = smoothstep(250., 1400., iDist);
    iAlb = mix(iAlb, vec3(dot(iAlb, vec3(.33))) * vec3(.9, .96, 1.05), iFade * .4);
  `;
  function iceMaterial(o) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: o.po, polygonOffsetUnits: o.po, envMapIntensity: o.env || 1 });
    const iu = { tIceD: { value: o.d }, tIceN: { value: o.n }, uIce: { value: new THREE.Vector4(o.tile, o.snow, o.ridge, o.inner) }, uIceC: { value: new THREE.Color().setRGB(...o.deep) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, iu, { tSnD: U.tSWd, tSnN: U.tSWn, tNz: U.tNz, uWind: U.uWind });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n vIW = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_ICE_HEAD)
        .replace('#include <map_fragment>', GLSL_ICE_MAT + (o.lake ? `
          float lr = length(P.xz - vec2(${o.lake.x.toFixed(2)}, ${o.lake.z.toFixed(2)}));
          float shore = smoothstep(${(o.lake.r - 9).toFixed(1)}, ${(o.lake.r + 0.5).toFixed(1)}, lr + (nz2.b - .5) * 8.);
          iAlb = mix(iAlb, cS, shore); iRough = mix(iRough, .8, shore);` : '') + '\n diffuseColor.rgb *= iAlb;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * iRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(iWN, 0.)).xyz);');
    };
    mat.customProgramCacheKey = () => 'trIce1' + (o.lake ? 'L' : 'S');
    return mat;
  }
  function initIce() {
    let sea = ctx.sea, lake = ctx.lakeIce;
    if (!sea || !lake) ctx.scene.traverse((m) => {
      if (!m.isMesh || !m.geometry) return; const p = m.geometry.parameters || {};
      if (!sea && m.geometry.type === 'PlaneGeometry' && p.width >= 4000) sea = m;
      if (!lake && m.geometry.type === 'CircleGeometry' && Math.abs((p.radius || 0) - 49) < 0.5) lake = m;
    });
    const tx = (n, srgb) => ctx.tex(n, srgb);
    if (sea) {
      const old = sea.material;
      S.seaOrig = old; sea.material = S.seaMat = iceMaterial({ d: tx('tr_iceS_d.jpg', true), n: tx('tr_iceS_n.jpg'), tile: 9, snow: 0.95, ridge: 42, inner: 0.35, deep: [0.02, 0.05, 0.08], po: 2, env: 0.8 });
      S.sea = sea;
    }
    if (lake) {
      const old = lake.material, P = ctx.POI.lake;
      S.lakeOrig = old; lake.material = S.lakeMat = iceMaterial({ d: tx('tr_iceC_d.jpg', true), n: tx('tr_iceC_n.jpg'), tile: 5.5, snow: 0.3, ridge: 16, inner: 0.7, deep: [0.004, 0.018, 0.035], po: -2, env: 1.1, lake: { x: P.x, z: P.z, r: 49 } });
      S.lake = lake;
    }
  }

  /* ================================================================ init */
  function addKnobs() {
    const Q = ctx.QUALITY;
    for (const k of Object.keys(KNOBS)) if (Q[k]) for (const [f, v] of Object.entries(KNOBS[k])) if (Q[k][f] === undefined) Q[k][f] = v;
    const cur = KNOBS[ctx.Q.name] || KNOBS.high; for (const [f, v] of Object.entries(cur)) if (ctx.Q[f] === undefined) ctx.Q[f] = v;
  }
  function hideOldFootprints() {
    if (ctx.fpMesh) { ctx.fpMesh.visible = false; S.oldFp = ctx.fpMesh; return; }
    ctx.scene.traverse((o) => { if (o.isInstancedMesh && o.material && o.material.isShaderMaterial && o.geometry && o.geometry.attributes.aBorn) { o.visible = false; S.oldFp = o; } });
  }
  // TEXUNITS: same-size jpgs → one DataArrayTexture (flipY like a normal image texture, mipmapped, anisotropic, repeat);
  // a 1×1 placeholder until every layer has loaded, then the uniform's value is swapped (no recompile)
  function texArray(names, srgb) {
    const L = names.length, mk = (data, w, h) => { const t = new THREE.DataArrayTexture(data, w, h, L); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.magFilter = THREE.LinearFilter;
      t.minFilter = w > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.generateMipmaps = w > 1; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; return t; };
    const u = { value: mk(new Uint8Array(L * 4).fill(srgb ? 150 : 128).map((v, i) => (!srgb && i % 4 === 2 ? 200 : v)), 1, 1) };
    const imgs = new Array(L); let left = L;
    const done = () => {
      const w = imgs[0].width, h = imgs[0].height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true }), data = new Uint8Array(w * h * 4 * L);
      for (let l = 0; l < L; l++) { g.setTransform(1, 0, 0, -1, 0, h); g.clearRect(0, 0, w, h); g.drawImage(imgs[l], 0, 0, w, h); data.set(g.getImageData(0, 0, w, h).data, l * w * h * 4); }
      const old = u.value; u.value = mk(data, w, h); old.dispose(); S.texArrays = (S.texArrays || 0) + 1;
    };
    const ld = new THREE.ImageLoader(ctx.MANAGER);
    names.forEach((n, l) => ld.load(ctx.ASSET + n, (im) => { imgs[l] = im; if (--left === 0) done(); }, undefined, (e) => console.warn('[terrain] texture array layer failed', n, e)));
    return u;
  }
  function init(c) {
    ctx = c; THREE = c.THREE; renderer = c.renderer; scene = c.scene; S.W = c.W;
    const t0 = performance.now();
    const wf = window.WorldFill && (WorldFill.K || WorldFill.knobs || WorldFill.cfg);
    if (wf && Array.isArray(wf.wind)) S.wind = wf.wind.slice(0, 2);
    { const l = Math.hypot(S.wind[0], S.wind[1]) || 1; S.wind = [S.wind[0] / l, S.wind[1] / l]; }
    addKnobs();
    const tx = (n, srgb) => c.tex(n, srgb);
    Object.assign(U, {
      tSFd: { value: tx('tr_snowF_d.jpg', true) }, tSFn: { value: tx('tr_snowF_n.jpg') }, tSWd: { value: tx('tr_snowW_d.jpg', true) }, tSWn: { value: tx('tr_snowW_n.jpg') },
      tTrD: texArray(['tr_snowF_d.jpg', 'tr_snowW_d.jpg', 'tr_rockS_d.jpg', 'tr_cliff_d.jpg', 'tr_gravel_d.jpg'], true),
      tTrN: texArray(['tr_snowF_n.jpg', 'tr_snowW_n.jpg', 'tr_rockS_n.jpg', 'tr_cliff_n.jpg'], false), tNz: { value: makeNoiseTex() },
      uWind: { value: new THREE.Vector2(S.wind[0], S.wind[1]) }, uSunV: { value: (c.MOON_DIR ? c.MOON_DIR.clone() : new THREE.Vector3(0.3, 0.8, 0.2)).normalize() },
      uScanC: c.TU.uScanC, uScanR: c.TU.uScanR, uScanA: c.TU.uScanA, uTime: c.TU.uTime,
      uW: { value: c.W }, uHsN: { value: DN }, uDT: { value: c.W / DN },
    });
    S.Hs = buildSmoothH();
    S.hole = { value: new THREE.Vector4(0, 0, -1, 0) };
    buildBaseDepth();
    initBaseMesh();
    initDeform();
    stampObstacles(collectObstacles()); uploadDepth();
    S.root = new THREE.Group(); S.root.name = 'terrain_detail'; S.root.matrixAutoUpdate = false; scene.add(S.root);
    buildLevels(); updateLevels();
    initContact();
    initIce();
    hideOldFootprints();
    // public API
    Object.assign(TR, { snowDepthAt, surfaceAt, slopeAt, snowCover, stamp, windDir: { x: S.wind[0], z: S.wind[1] }, S, DEF, U, CM,
      addFootprint(x, z, face, o = {}) { const fx = -Math.sin(face || 0), fz = -Math.cos(face || 0); stamp(Object.assign({ x, z, dx: fx, dz: fz, type: 'boot', len: 0.31, wid: 0.135, str: 0.92 }, o)); puff(x, z, sampleD(x, z)); } });
    Object.assign(c, { snowDepthAt, surfaceAt, slopeAt, snowCover, addFootprint: TR.addFootprint, snowStamp: stamp, windDir: TR.windDir, snowSurfaceAt, snowContact, footPress, snowFine });
    Object.assign(TR, { snowSurfaceAt, snowContact, footPress, snowFine, s0CPU: (x, z) => sampleHs(x, z) + looseCPU(x, z, microS()) });
    // groundblend hook: the drawn snow surface (object-pressed map where read back, else the CPU replay minus the coarse
    // press) and the loose snow left there
    c.snowField = TR.snowField = { sample(x, z) { const q = snowContact(x, z, true); return [q.surf, Math.max(q.dep - q.press, 0)]; } };
    if (c.WORLD_TERRAIN) c.WORLD_TERRAIN.detail = S.root;
    S.initMs = performance.now() - t0;
  }

  let obstCheckT = 0, boulderDone = false;
  function update(dt, c) {
    ctx = c;
    updateLevels();
    // deformation: realloc on quality change, follow the pilot; objects press the fine map, the coarse map follows
    allocDeform();
    const p = c.player, fx = p.x, fz = p.z;
    if (Math.abs(fx - DEF.cx) > DEF.ext * 0.18 || Math.abs(fz - DEF.cz) > DEF.ext * 0.18) {
      const far = Math.abs(fx - DEF.cx) > DEF.ext * 0.7 || Math.abs(fz - DEF.cz) > DEF.ext * 0.7;
      if (far) { DEF.cx = snapDef(fx); DEF.cz = snapDef(fz); DEF.fresh = true; DEF.mir.fill(0); DEF.mirCx = DEF.cx; DEF.mirCz = DEF.cz; U.uDef.value.set(DEF.cx, DEF.cz, DEF.ext, DEF.ext / DEF.res); }
      else recenterDeform(snapDef(fx), snapDef(fz), 1);
    }
    if (DEF.fresh) { DEF.fresh = false; withTarget(DEF.rt[DEF.cur], (r) => { r.setClearColor(0, 0); r.clear(true, false, false); }); }
    // blizzard slowly refills trails (both maps)
    const storm = c.WX ? c.WX.storm : 0; DEF.fillT = (DEF.fillT || 0) + dt;
    if (storm > 0.4 && DEF.fillT > 2) { DEF.fillT = 0; const k = 1 - 0.03 * storm; recenterDeform(DEF.cx, DEF.cz, k); if (CM.ok && !CM.fresh) refillContact(k); }
    U.uDefOn.value = S.noDef ? 0 : 1; U.uDbgFlat.value = S.dbgFlat ? 1 : 0;
    if (c.mode === 'play' || c.mode === 'ending') trackActors(dt);
    if (CM.ok) { try { contactFrame(dt); } catch (e) { CM.ok = false; CM.err = String(e && e.stack || e); U.uCMOn.value = 0; U.uPc.value.w = 0; if (CM.patch) CM.patch.visible = false; console.warn('[terrain] SNOW-CONTACT disabled:', e); } }
    // snow gameplay
    hookCharacter();
    TR.slowK = c.G && !c.G.riding ? slowFactor() : 1;
    // obstacles arrive over time (glb packs, WorldFill, footprints computed in idle): rebuild drifts when the set settles
    obstCheckT += dt;
    if (obstCheckT > 2) {
      obstCheckT = 0;
      const P = c.Passport; let n = 0; for (const e of P.byRole.solid || []) n += 1 + (e.circles ? e.circles.length : 0);
      const key = n + ':' + (P.byRole.trunk || []).length;
      if (key !== S.obstKey) { if (S.obstPending === key) { S.obstKey = key; S.obstPending = null; stampObstacles(collectObstacles()); uploadDepth(); CM.rebake = true; } else S.obstPending = key; }
    }
    if (!boulderDone && c.DECOR && c.DECOR.boulderMeshes && c.DECOR.boulderMeshes.length) { boulderDone = true; for (const m of c.DECOR.boulderMeshes) snowCover(m, { amount: 0.6, minUp: 0.68, soft: 0.2, skirt: 0.35 }); }
    if (!S.rockDone && c.DECOR && c.DECOR.rockMesh) { S.rockDone = true; snowCover(c.DECOR.rockMesh, { amount: 0, skirt: 0.3 }); }
    if (S.oldFp && S.oldFp.visible) S.oldFp.visible = false;
  }

  (window.GameModules = window.GameModules || []).push({ name: 'terrain', order: -10, init, update });
})();
