/* Module "terrain" — terrain detail rings, snow materials, snow depth + deformation, sea/lake ice.
 * Owned by the TERRAIN & SNOW agent (wave 2). See TERRAIN.md.
 *
 * Public API (also on ctx / MODCTX and window.Terrain):
 *   snowDepthAt(x, z)          loose snow depth in metres (drifts deeper, trails compressed)
 *   surfaceAt(x, z, y?)        'snow' | 'deep_snow' | 'ice' | 'rock' | 'metal' | 'wood'  (y = feet height: objects)
 *   slopeAt(x, z, r = 1)       physics ground slope in degrees
 *   snowCover(target, opts)    snow accumulation shader chunk for any Mesh*Material / Object3D
 *   addFootprint(x, z, face, o) stamp a print into the deformation map
 *   stamp({x, z, dx, dz, len, wid, type, str})   raw deformation stamp (type: 'boot'|'paw'|'hoof'|'band'|'blob')
 *   windDir                    {x, z} prevailing wind (blows towards)
 * The physics heightfield H is never modified: the rendered snow sits on top of it (loose snow the feet sink into).
 */
(function () {
  const TR = (window.Terrain = window.Terrain || {});
  let ctx, THREE, renderer, scene;
  const DMAX = 1.0;                         // depth texture range (m)
  const DN = 1024;                          // world snow-depth / smooth-height texture resolution
  const KNOBS = {                           // added to QUALITY presets (see TERRAIN.md)
    low:   { terrainLevels: 3, terrainGrid: 64,  deformRes: 512,  deformExt: 96 },
    med:   { terrainLevels: 4, terrainGrid: 64,  deformRes: 1024, deformExt: 128 },
    high:  { terrainLevels: 4, terrainGrid: 96,  deformRes: 1024, deformExt: 128 },
    ultra: { terrainLevels: 4, terrainGrid: 160, deformRes: 1024, deformExt: 128 },
  };

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  /* ================================================================ GLSL */
  const GLSL_NOISE = /* glsl */`
    float trHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float trVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(trHash(i), trHash(i + vec2(1., 0.)), f.x), mix(trHash(i + vec2(0., 1.)), trHash(i + vec2(1., 1.)), f.x), f.y); }
    float trLum(vec3 c){ return dot(c, vec3(.3, .55, .15)); }
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
  // detail-ring vertex code: exact snow surface = smooth(H) + loose snow (depth texture) + micro relief − deformation
  const GLSL_DETAIL_V = /* glsl */`
    uniform sampler2D tBase, tDD, tDef;
    uniform vec4 uLv; uniform vec2 uLvL; uniform float uW, uHsN, uDT; uniform vec4 uDef; uniform float uDefOn; uniform vec2 uWind;
    varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vRock; varying float vDepth; varying float vGrav;
    ${GLSL_NOISE}
    ${GLSL_TINT}
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
    float trMicro(vec2 p, float s, float expo){
      vec2 w = uWind; vec2 q = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
      float h = (trVN(p * .14) - .5) * .15 * trLodW(7., s) + (trVN(p * .37 + 17.) - .5) * .07 * trLodW(2.7, s);
      float sa = trVN(vec2(q.x * .21, q.y * 1.25) + 5.); sa = 1. - abs(sa * 2. - 1.); sa *= sa;           // sastrugi: long along the wind
      float sb = trVN(vec2(q.x * .55, q.y * 3.2) + 11.); sb = 1. - abs(sb * 2. - 1.);
      h += ((sa - .45) * .10 * trLodW(.8, s) + (sb - .5) * .035 * trLodW(.31, s)) * expo;
      return clamp(h, -.14, .14);
    }
    vec2 trDefAt(vec2 p, float s){
      vec2 uv = (p - uDef.xy) / uDef.z + .5; vec2 e = min(uv, 1. - uv);
      float edge = clamp(min(e.x, e.y) * uDef.z / 4., 0., 1.);
      if (edge <= 0. || uDefOn < .5) return vec2(0.);
      return textureLod(tDef, uv, max(0., log2(s / uDef.w))).rg * edge;
    }
    float trSnow(vec2 p, float s, out float dep, out float grv){
      vec2 dg = textureLod(tDD, (p + uW * .5) / uW, max(0., log2(s / uDT))).ba;
      dep = dg.r * ${DMAX.toFixed(2)}; grv = dg.g;
      vec2 pr = trDefAt(p, s);
      float m = trMicro(p, s, smoothstep(.03, .14, dep)) * smoothstep(.0, .08, dep);
      float loose = max(dep + m, 0.);
      return loose * (1. - pr.x) + pr.y * min(dep, .3) * .35 * (1. - pr.x);
    }
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
  // far mesh vertex: attributes, lowered under the detail rings
  const GLSL_BASE_V = /* glsl */`
    attribute vec3 aD; uniform vec4 uHole;
    varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vRock; varying float vDepth; varying float vGrav;
    ${GLSL_NOISE}
    ${GLSL_TINT}
  `;
  // shared fragment: layered snow / rock / gravel with anti-tiling and height blending
  const GLSL_FRAG_HEAD = /* glsl */`
    uniform sampler2D tSFd, tSFn, tSWd, tSWn, tRSd, tRSn, tCLd, tCLn, tGRd, tNz;
    uniform vec2 uWind; uniform vec3 uSunV; uniform vec2 uScanC; uniform float uScanR, uScanA, uTime;
    #ifdef TR_DETAIL
      uniform sampler2D tDef; uniform vec4 uDef; uniform float uDefOn; uniform float uDbgFlat;
    #endif
    varying vec3 vW; varying vec3 vN; varying vec3 vTint; varying float vRock; varying float vDepth; varying float vGrav;
    ${GLSL_NOISE}
    // no-tile sampling (index noise picks one of 8 offsets, 2 taps, luminance-aware blend) for albedo + packed normal/rough
    void trNT(sampler2D td, sampler2D tn, vec2 uv, vec2 dx, vec2 dy, float k, out vec3 c, out vec3 n){
      float l = k * 8.; float ia = floor(l), f = fract(l);
      vec2 oa = sin(vec2(3., 7.) * ia), ob = sin(vec2(3., 7.) * (ia + 1.));
      vec3 ca = textureGrad(td, uv + oa, dx, dy).rgb, cb = textureGrad(td, uv + ob, dx, dy).rgb;
      float b = smoothstep(.2, .8, f - .1 * dot(ca - cb, vec3(1.)));
      c = mix(ca, cb, b); n = mix(textureGrad(tn, uv + oa, dx, dy).rgb, textureGrad(tn, uv + ob, dx, dy).rgb, b);
    }
    vec2 trNrmXY(vec3 n){ return n.xy * 2. - 1.; }
    // triplanar (FIX-LOOK): steep faces sample the side planes instead of a stretched top-down projection
    void trTri(sampler2D td, sampler2D tn, vec3 P, vec3 gN, vec3 dPx, vec3 dPy, float sc, out vec3 c, out vec3 hn, out float r){
      vec3 bw = pow(abs(gN), vec3(4.)); bw /= dot(bw, vec3(1.)); vec3 pc = P * sc, gx = dPx * sc, gy = dPy * sc;
      c = vec3(0.); hn = vec3(0.); r = 0.;
      if (bw.x > .02) { vec3 t = textureGrad(tn, pc.zy, gx.zy, gy.zy).rgb; c += textureGrad(td, pc.zy, gx.zy, gy.zy).rgb * bw.x; r += t.z * bw.x; vec2 n = t.xy * 2. - 1.; hn += vec3(0., n.y, n.x) * bw.x; }
      if (bw.y > .02) { vec3 t = textureGrad(tn, pc.xz, gx.xz, gy.xz).rgb; c += textureGrad(td, pc.xz, gx.xz, gy.xz).rgb * bw.y; r += t.z * bw.y; vec2 n = t.xy * 2. - 1.; hn += vec3(n.x, 0., n.y) * bw.y; }
      if (bw.z > .02) { vec3 t = textureGrad(tn, pc.xy, gx.xy, gy.xy).rgb; c += textureGrad(td, pc.xy, gx.xy, gy.xy).rgb * bw.z; r += t.z * bw.z; vec2 n = t.xy * 2. - 1.; hn += vec3(n.x, n.y, 0.) * bw.z; }
    }
    ${GLSL_MS}
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
    { vec2 duv = (P.xz - uDef.xy) / uDef.z + .5;
      if (uDefOn > .5 && trDist < 70. && all(greaterThan(duv, vec2(.003))) && all(lessThan(duv, vec2(.997)))) {
        float dpt = min(depth, .45) + .02; vec3 V = normalize(cameraPosition - P);
        vec2 d0 = textureLod(tDef, duv, 0.).rg; float h0 = (-d0.r + d0.g * .35 * (1. - d0.r)) * dpt;
        duv += V.xz / max(V.y, .3) * h0 / uDef.z * .7;           // one-step parallax into the print
        float e = uDef.w / uDef.z;
        vec2 dA = textureLod(tDef, duv, 0.).rg, dX = textureLod(tDef, duv + vec2(e, 0.), 0.).rg, dZ = textureLod(tDef, duv + vec2(0., e), 0.).rg;
        float hA = -dA.r + dA.g * .35 * (1. - dA.r), hX = -dX.r + dX.g * .35 * (1. - dX.r), hZ = -dZ.r + dZ.g * .35 * (1. - dZ.r);
        float fd = 1. - smoothstep(40., 68., trDist);
        vec2 gr = vec2(hX - hA, hZ - hA) / uDef.w * dpt * fd;
        dN = vec3(-gr.x, 0., -gr.y) * 1.1;
        float soft = smoothstep(.015, .07, depth);
        press = dA.r * fd * soft; rim = dA.g * (1. - dA.r) * fd * soft;
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
      float mF = smoothstep(.04, .16, depth + (nzA.b - .5) * .22);   // deep = fresh powder, thin/exposed = wind-packed crust
      vec3 cF = vec3(.6), cW = vec3(.6), tF = vec3(.5, .5, .8), tW = vec3(.5, .5, .8);
      // layer branches: implicit derivatives only misbehave where the skipped layer's weight is < 1 %
      if (mF > .01) trMS(tSFd, tSFn, P.xz * (1. / 3.4), nzB.a, 1.1, cF, tF);
      if (mF < .99) trMS(tSWd, tSWn, vec2(dot(P.xz, wp), dot(P.xz, wd)) * (1. / 4.2), nzB.b, 0., cW, tW);
      vec2 nF = trNrmXY(tF), nW = trNrmXY(tW);
      vec2 hW = wp * nW.x + wd * nW.y;
      cS = mix(cW * vec3(.98, .99, 1.01), cF, mF) * vec3(.97, .985, 1.) * (.88 + .24 * nzA.g);   // near-neutral albedo: the blue comes from the sky light (FIX-LOOK)
      nS3 = vec3(mix(hW.x * .4, nF.x * .8, mF), 0., mix(hW.y * .4, nF.y * .8, mF));   // FIX-LOOK: crisper wind-crust relief (lit/shadow contrast)
      rS = mix(tW.z, tF.z, mF);
      snowFlat = cS;
      cS = cS * mix(vec3(1.), vec3(.46, .55, .78), press) * (1. + rim * .12) * (1. - min(length(dN.xz), 1.) * .4);
      rS = mix(rS, .45, press);
    }
    if (wR > .003) {
      if (up > .88) { vec3 t; trNT(tRSd, tRSn, P.xz / 11., dPx.xz / 11., dPy.xz / 11., nzA.a, cR, t); vec2 n = trNrmXY(t); nR3 = vec3(n.x, 0., n.y) * .8; rR = t.z; }
      else { vec3 hn; trTri(tRSd, tRSn, P, gN, dPx, dPy, 1. / 11., cR, hn, rR); nR3 = hn * .8; }
      cR *= vec3(.86, .9, 1.); }
    if (wG > .003) { vec3 t; trNT(tGRd, tRSn, P.xz / 2.6, dPx.xz / 2.6, dPy.xz / 2.6, nzB.r, cG, t); vec2 n = trNrmXY(t); nG3 = vec3(n.x, 0., n.y) * .8; rG = .75 + t.z * .25; cG *= vec3(.88, .92, 1.); }
    if (wC > .003) {
      vec3 bw = pow(abs(gN), vec3(4.)); bw /= dot(bw, vec3(1.)); const float sc = 1. / 7.5; vec3 pc = P * sc, gx = dPx * sc, gy = dPy * sc;
      vec3 c = vec3(0.), hn = vec3(0.); float r = 0.;
      if (bw.x > .02) { vec3 t = textureGrad(tCLn, pc.zy, gx.zy, gy.zy).rgb; c += textureGrad(tCLd, pc.zy, gx.zy, gy.zy).rgb * bw.x; r += t.z * bw.x; vec2 n = trNrmXY(t); hn += vec3(0., n.y, n.x) * bw.x; }
      if (bw.y > .02) { vec3 t = textureGrad(tCLn, pc.xz, gx.xz, gy.xz).rgb; c += textureGrad(tCLd, pc.xz, gx.xz, gy.xz).rgb * bw.y; r += t.z * bw.y; vec2 n = trNrmXY(t); hn += vec3(n.x, 0., n.y) * bw.y; }
      if (bw.z > .02) { vec3 t = textureGrad(tCLn, pc.xy, gx.xy, gy.xy).rgb; c += textureGrad(tCLd, pc.xy, gx.xy, gy.xy).rgb * bw.z; r += t.z * bw.z; vec2 n = trNrmXY(t); hn += vec3(n.x, n.y, 0.) * bw.z; }
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
    { // snow sparkle: sparse random facets that flash when they mirror the moon (or the sky) into the eye
      vec2 gc = floor(P.xz * 26.); float hh = trHash(gc);
      if (hh > .965 && trDist < 38. && trSnowW > .2) {
        vec3 V = normalize(cameraPosition - P);
        vec3 fn = normalize(vec3((trHash(gc + 3.1) - .5) * 1.5, 1., (trHash(gc + 7.7) - .5) * 1.5));
        float g1 = smoothstep(.975, .998, dot(fn, normalize(V + uSunV))), g2 = smoothstep(.985, .999, dot(fn, normalize(V + vec3(0., 1., 0.))));
        totalEmissiveRadiance += vec3(.7, .85, 1.) * (g1 * 3. + g2 * .8) * trSnowW * (1. - smoothstep(18., 38., trDist));
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
      .replace('#include <map_fragment>', '#ifdef TR_DETAIL\n if (uDbgFlat > .5) { gl_FragColor = vec4(.3, .3, .35, 1.); return; }\n#endif\n' + GLSL_FRAG_MAT + '\n diffuseColor.rgb *= trAlb;')
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

  /* ------------------------------------------------------ deformation map */
  const DEF = { res: 0, ext: 128, cx: 0, cz: 0, rt: [], cur: 0, stamps: [], mirN: 0, mir: null, mirC: 0.5 };
  const STAMP_T = { boot: 0, paw: 1, hoof: 2, band: 3, blob: 4 };
  function initDeform() {
    const MAXS = 768;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXS * 4 * 3), 3));
    g.setAttribute('aL', new THREE.BufferAttribute(new Float32Array(MAXS * 4 * 2), 2));
    g.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(MAXS * 4 * 4), 4));
    const idx = new Uint16Array(MAXS * 6); for (let i = 0; i < MAXS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    DEF.uC = { value: new THREE.Vector2() }; DEF.uE = { value: 128 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uC: DEF.uC, uE: DEF.uE }, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      vertexShader: `uniform vec2 uC; uniform float uE; attribute vec2 aL; attribute vec4 aP; varying vec2 vL; varying vec4 vP;
        void main(){ vL = aL; vP = aP; gl_Position = vec4((position.xz - uC) / (uE * .5), 0., 1.); }`,
      fragmentShader: `varying vec2 vL; varying vec4 vP;
        void main(){
          float u = vL.x, v = vL.y, t = vP.x, s = vP.y, p = 0., r = 0.;
          if (t < .5) {            // boot: narrower heel, tread bars, rim of pushed snow
            float d = length(vec2(u / mix(.74, 1., smoothstep(-1., .5, v)), v));
            p = (1. - smoothstep(.82, 1., d)) * (.86 + .14 * step(.45, fract(v * 4.5 + .2)));
            r = smoothstep(.95, 1.12, d) * (1. - smoothstep(1.12, 1.45, d));
          } else if (t < 1.5) {    // paw
            float d = length(vec2(u, v)); p = 1. - smoothstep(.7, 1., d); r = smoothstep(.95, 1.1, d) * (1. - smoothstep(1.1, 1.4, d));
          } else if (t < 2.5) {    // cloven hoof
            float d = min(length(vec2((u - .42) * 1.7, v)), length(vec2((u + .42) * 1.7, v))); p = 1. - smoothstep(.75, 1., d); r = smoothstep(.95, 1.1, d) * (1. - smoothstep(1.1, 1.5, d));
          } else if (t < 3.5) {    // band (skis, tracks, slides): rim along both edges
            float d = abs(u); p = (1. - smoothstep(.8, 1., d)) * (1. - smoothstep(.85, 1., abs(v))) * (.9 + .1 * step(.5, fract(v * vP.z * 2.)));
            r = smoothstep(.95, 1.1, d) * (1. - smoothstep(1.1, 1.5, d)) * (1. - smoothstep(.85, 1., abs(v)));
          } else {                 // blob (landing, body)
            float d = length(vec2(u, v)); p = 1. - smoothstep(.6, 1., d); r = smoothstep(.95, 1.1, d) * (1. - smoothstep(1.1, 1.5, d));
          }
          gl_FragColor = vec4(p * s, r * s, 0., 1.);
        }`,
    });
    DEF.geo = g; DEF.max = MAXS; DEF.mesh = new THREE.Mesh(g, mat); DEF.mesh.frustumCulled = false;
    DEF.scene = new THREE.Scene(); DEF.scene.add(DEF.mesh); DEF.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    DEF.copyU = { tPrev: { value: null }, uOff: { value: new THREE.Vector2() }, uKeep: { value: 1 } };
    DEF.copy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: DEF.copyU, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D tPrev; uniform vec2 uOff; uniform float uKeep; varying vec2 vUv;
        void main(){ vec2 uv = vUv + uOff; vec4 c = textureLod(tPrev, uv, 0.); if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) c = vec4(0.); gl_FragColor = c * uKeep; }`,
    }));
    DEF.copy.frustumCulled = false; DEF.copyScene = new THREE.Scene(); DEF.copyScene.add(DEF.copy);
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
    const p = ctx.player; DEF.cx = snapDef(p.x); DEF.cz = snapDef(p.z);
    U.tDef.value = DEF.rt[0].texture; U.uDef.value.set(DEF.cx, DEF.cz, ext, ext / res); DEF.uE.value = ext;
  }
  const snapDef = (v) => { const q = (DEF.ext / DEF.res) * 8; return Math.round(v / q) * q; };
  function withTarget(rt, fn) {
    const r = renderer, prev = r.getRenderTarget(), auto = r.autoClear, cc = S._cc || (S._cc = new THREE.Color()); r.getClearColor(cc); const ca = r.getClearAlpha();
    r.autoClear = false; r.setRenderTarget(rt); try { fn(r); } finally { r.setRenderTarget(prev); r.autoClear = auto; r.setClearColor(cc, ca); }
  }
  function recenterDeform(nx, nz, keep) {
    const src = DEF.rt[DEF.cur], dst = DEF.rt[1 - DEF.cur];
    DEF.copyU.tPrev.value = src.texture; DEF.copyU.uOff.value.set((nx - DEF.cx) / DEF.ext, (nz - DEF.cz) / DEF.ext); DEF.copyU.uKeep.value = keep;
    withTarget(dst, (r) => { r.setClearColor(0, 0); r.clear(true, false, false); r.render(DEF.copyScene, DEF.cam); });
    // CPU mirror
    const n = DEF.mirN, m = DEF.mir, o = new Float32Array(n * n), di = Math.round((nx - DEF.cx) / DEF.mirC), dj = Math.round((nz - DEF.cz) / DEF.mirC);
    for (let j = 0; j < n; j++) { const sj = j + dj; if (sj < 0 || sj >= n) continue; for (let i = 0; i < n; i++) { const si = i + di; if (si >= 0 && si < n) o[j * n + i] = m[sj * n + si] * keep; } }
    DEF.mir = o; DEF.cur = 1 - DEF.cur; DEF.cx = nx; DEF.cz = nz;
    U.tDef.value = DEF.rt[DEF.cur].texture; U.uDef.value.set(nx, nz, DEF.ext, DEF.ext / DEF.res);
  }
  // queue a stamp; dx,dz = forward direction; len/wid in metres
  function stamp(o) {
    const x = o.x, z = o.z; if (Math.abs(x - DEF.cx) > DEF.ext / 2 - 2 || Math.abs(z - DEF.cz) > DEF.ext / 2 - 2) return;
    if (DEF.stamps.length >= DEF.max) return;
    const t = typeof o.type === 'number' ? o.type : STAMP_T[o.type || 'boot'] || 0;
    let dx = o.dx || 0, dz = o.dz || 1; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    DEF.stamps.push([x, z, dx, dz, o.len || 0.3, o.wid || 0.13, t, o.str == null ? 0.9 : o.str]);
    // CPU mirror (0.5 m cells): enough for depth/speed queries
    const n = DEF.mirN, c = DEF.mirC, rad = Math.max(o.wid || 0.13, (o.len || 0.3) * 0.5) * 0.9 + 0.1;
    const i0 = Math.floor((x - rad - DEF.cx) / c + n / 2), i1 = Math.floor((x + rad - DEF.cx) / c + n / 2), j0 = Math.floor((z - rad - DEF.cz) / c + n / 2), j1 = Math.floor((z + rad - DEF.cz) / c + n / 2);
    const v = (o.str == null ? 0.9 : o.str) * (t === 3 ? 1 : 0.75);
    for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) { const k = j * n + i; if (DEF.mir[k] < v) DEF.mir[k] = v; }
  }
  function pressAt(x, z) {
    const n = DEF.mirN, i = Math.floor((x - DEF.cx) / DEF.mirC + n / 2), j = Math.floor((z - DEF.cz) / DEF.mirC + n / 2);
    return i < 0 || j < 0 || i >= n || j >= n ? 0 : DEF.mir[j * n + i];
  }
  function flushStamps() {
    const n = DEF.stamps.length; if (!n && !DEF.fresh) return;
    const pos = DEF.geo.attributes.position.array, al = DEF.geo.attributes.aL.array, ap = DEF.geo.attributes.aP.array;
    for (let k = 0; k < n; k++) {
      const [x, z, fx, fz, len, wid, t, s] = DEF.stamps[k], rx = fz, rz = -fx, mw = 1.6, ml = t === 3 ? 1.02 : 1.35;
      const hw = wid * 0.5 * mw, hl = len * 0.5 * ml;
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let c = 0; c < 4; c++) {
        const [a, b] = cs[c], vi = k * 4 + c;
        pos[vi * 3] = x + rx * a * hw + fx * b * hl; pos[vi * 3 + 1] = 0; pos[vi * 3 + 2] = z + rz * a * hw + fz * b * hl;
        al[vi * 2] = a * mw; al[vi * 2 + 1] = b * ml;
        ap[vi * 4] = t; ap[vi * 4 + 1] = s; ap[vi * 4 + 2] = len; ap[vi * 4 + 3] = 0;
      }
    }
    DEF.geo.attributes.position.needsUpdate = true; DEF.geo.attributes.aL.needsUpdate = true; DEF.geo.attributes.aP.needsUpdate = true;
    DEF.geo.setDrawRange(0, n * 6); DEF.uC.value.set(DEF.cx, DEF.cz);
    const fresh = DEF.fresh; DEF.fresh = false;
    withTarget(DEF.rt[DEF.cur], (r) => { if (fresh) { r.setClearColor(0, 0); r.clear(true, false, false); } if (n) r.render(DEF.scene, DEF.cam); });
    DEF.stamps.length = 0;
  }

  /* ---------------------------------------------------------- actors */
  const TRK = { p: null, fox: null, stags: new WeakMap(), sk: null, puffs: 0 };
  const PUFF = 0xe4ecf8;
  function puff(x, z, amt, dirx = 0, dirz = 0) {
    if (amt < 0.04 || !ctx.emit) return;
    const y = ctx.getH(x, z) + sampleD(x, z) * 0.8, n = Math.min(6, 1 + Math.round(amt * 10));
    for (let i = 0; i < n; i++) ctx.emit(x + (Math.random() - 0.5) * 0.2, y + 0.05, z + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 1.2 + dirx, 0.5 + Math.random() * 1.2 * amt * 3, (Math.random() - 0.5) * 1.2 + dirz, 0.5 + Math.random() * 0.5, PUFF, 0.18 + amt * 0.6, 3.5, 1.2);
  }
  function footTrack(key, o, x, z, onGround, stride, type, wid, len, str, lateral, doPuff) {
    let t = o[key]; if (!t) t = o[key] = { x, z, acc: 0, side: 1, g: onGround };
    const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz);
    if (d > 3) { t.x = x; t.z = z; t.acc = 0; t.g = onGround; return t; }
    if (onGround && d > 1e-4) {
      t.acc += d; t.fx = dx / d; t.fz = dz / d;
      while (t.acc >= stride) {
        t.acc -= stride; t.side = -t.side;
        const back = t.acc, px = x - t.fx * back + t.fz * lateral * t.side, pz = z - t.fz * back - t.fx * lateral * t.side;
        stamp({ x: px, z: pz, dx: t.fx, dz: t.fz, len, wid, type, str });
        if (doPuff) puff(px, pz, sampleD(px, pz) * (doPuff === 2 ? 1.4 : 1), t.fx * 0.8, t.fz * 0.8);
      }
    }
    t.x = x; t.z = z; t.g = onGround; return t;
  }
  function onTerrain(x, y, z, tol = 0.45) { return y - ctx.getH(x, z) < tol + sampleD(x, z); }
  function trackActors(dt) {
    const p = ctx.player, G = ctx.G, sk = ctx.sk;
    // pilot
    if (G && !G.riding) {
      const ground = p.onGround && (!ctx.CLIMB || ctx.CLIMB.t < 0) && onTerrain(p.x, p.y, p.z);
      const prev = TRK.pl && TRK.pl.g;
      const run = Math.hypot(p.vx || 0, p.vz || 0) > 8.5;
      const tt = footTrack('pl', TRK, p.x, p.z, ground, run ? 0.85 : 0.62, 'boot', 0.135, 0.31, 0.92, 0.13, run ? 2 : 1);
      if (ground && prev === false && TRK.plAir > 0.25) {   // landing: both feet + a burst of powder
        const fx = -Math.sin(p.face), fz = -Math.cos(p.face);
        stamp({ x: p.x + fz * 0.14, z: p.z - fx * 0.14, dx: fx, dz: fz, type: 'boot', len: 0.33, wid: 0.15, str: 1 });
        stamp({ x: p.x - fz * 0.14, z: p.z + fx * 0.14, dx: fx, dz: fz, type: 'boot', len: 0.33, wid: 0.15, str: 1 });
        const d = sampleD(p.x, p.z); for (let k = 0; k < 3; k++) puff(p.x, p.z, d * 1.5);
      }
      TRK.plAir = ground ? 0 : (TRK.plAir || 0) + dt;
      if (ground && (p.rollT > 0 || p.sliding) && tt.fx !== undefined) stamp({ x: p.x, z: p.z, dx: tt.fx, dz: tt.fz, type: 'band', len: 0.6, wid: 0.5, str: 0.8 });
    }
    // skimmer / snowmobile: two skis + a track
    if (sk && sk.g) {
      const x = sk.x, z = sk.z, t = TRK.sk || (TRK.sk = { x, z });
      const d = Math.hypot(x - t.x, z - t.z), low = (sk.y || 0) - ctx.getH(x, z) < 1.9;
      if (d > 8) { t.x = x; t.z = z; }
      else if (d > 0.08 && low && ctx.getH(x, z) > 0.1) {
        const fx = (x - t.x) / d, fz = (z - t.z) / d, mx = (x + t.x) / 2, mz = (z + t.z) / 2, rx = fz, rz = -fx;
        for (const [o, w, s] of [[0.52, 0.22, 0.95], [-0.52, 0.22, 0.95], [0, 0.5, 0.8]]) stamp({ x: mx + rx * o, z: mz + rz * o, dx: fx, dz: fz, type: 'band', len: d + w * 0.6, wid: w, str: s });
        const spd = d / Math.max(dt, 1e-3); if (spd > 4 && Math.random() < 0.6) puff(x - fx * 1.6, z - fz * 1.6, sampleD(x, z) * Math.min(2, spd / 12), -fx * 2, -fz * 2);
        t.x = x; t.z = z;
      }
    }
    // fox
    const f = ctx.fox;
    if (f && f.g && f.g.visible !== false) { const fp = f.g.position; footTrack('fox', TRK, fp.x, fp.z, onTerrain(fp.x, fp.y, fp.z, 0.3), 0.3, 'paw', 0.085, 0.095, 0.85, 0.06, 0); }
    // stags
    for (const s of ctx.STAGS || []) { if (!s.g || s.g.visible === false) continue; const g = s.g.position; let h = TRK.stags.get(s); if (!h) TRK.stags.set(s, (h = {})); footTrack('t', h, g.x, g.z, onTerrain(g.x, g.y, g.z, 0.4), 0.72, 'hoof', 0.12, 0.13, 0.9, 0.2, 0); }
  }

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
      tRSd: { value: tx('tr_rockS_d.jpg', true) }, tRSn: { value: tx('tr_rockS_n.jpg') }, tCLd: { value: tx('tr_cliff_d.jpg', true) }, tCLn: { value: tx('tr_cliff_n.jpg') },
      tGRd: { value: tx('tr_gravel_d.jpg', true) }, tNz: { value: makeNoiseTex() },
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
    initIce();
    hideOldFootprints();
    // public API
    Object.assign(TR, { snowDepthAt, surfaceAt, slopeAt, snowCover, stamp, windDir: { x: S.wind[0], z: S.wind[1] }, S, DEF, U,
      addFootprint(x, z, face, o = {}) { const fx = -Math.sin(face || 0), fz = -Math.cos(face || 0); stamp(Object.assign({ x, z, dx: fx, dz: fz, type: 'boot', len: 0.31, wid: 0.135, str: 0.92 }, o)); puff(x, z, sampleD(x, z)); } });
    Object.assign(c, { snowDepthAt, surfaceAt, slopeAt, snowCover, addFootprint: TR.addFootprint, snowStamp: stamp, windDir: TR.windDir });
    if (c.WORLD_TERRAIN) c.WORLD_TERRAIN.detail = S.root;
    S.initMs = performance.now() - t0;
  }

  let obstCheckT = 0, boulderDone = false;
  function update(dt, c) {
    ctx = c;
    updateLevels();
    // deformation: realloc on quality change, follow the pilot, stamp, render
    allocDeform();
    const p = c.player, fx = p.x, fz = p.z;
    if (Math.abs(fx - DEF.cx) > DEF.ext * 0.18 || Math.abs(fz - DEF.cz) > DEF.ext * 0.18) {
      const far = Math.abs(fx - DEF.cx) > DEF.ext * 0.7 || Math.abs(fz - DEF.cz) > DEF.ext * 0.7;
      if (far) { DEF.cx = snapDef(fx); DEF.cz = snapDef(fz); DEF.fresh = true; DEF.mir.fill(0); U.uDef.value.set(DEF.cx, DEF.cz, DEF.ext, DEF.ext / DEF.res); }
      else recenterDeform(snapDef(fx), snapDef(fz), 1);
    }
    // blizzard slowly refills trails
    const storm = c.WX ? c.WX.storm : 0; DEF.fillT = (DEF.fillT || 0) + dt;
    if (storm > 0.4 && DEF.fillT > 2) { DEF.fillT = 0; recenterDeform(DEF.cx, DEF.cz, 1 - 0.03 * storm); }
    if (c.mode === 'play' || c.mode === 'ending') trackActors(dt);
    U.uDefOn.value = S.noDef ? 0 : 1; U.uDbgFlat.value = S.dbgFlat ? 1 : 0;
    flushStamps();
    // snow gameplay
    hookCharacter();
    TR.slowK = c.G && !c.G.riding ? slowFactor() : 1;
    // obstacles arrive over time (glb packs, WorldFill, footprints computed in idle): rebuild drifts when the set settles
    obstCheckT += dt;
    if (obstCheckT > 2) {
      obstCheckT = 0;
      const P = c.Passport; let n = 0; for (const e of P.byRole.solid || []) n += 1 + (e.circles ? e.circles.length : 0);
      const key = n + ':' + (P.byRole.trunk || []).length;
      if (key !== S.obstKey) { if (S.obstPending === key) { S.obstKey = key; S.obstPending = null; stampObstacles(collectObstacles()); uploadDepth(); } else S.obstPending = key; }
    }
    if (!boulderDone && c.DECOR && c.DECOR.boulderMeshes && c.DECOR.boulderMeshes.length) { boulderDone = true; for (const m of c.DECOR.boulderMeshes) snowCover(m, { amount: 0.6, minUp: 0.68, soft: 0.2, skirt: 0.35 }); }
    if (!S.rockDone && c.DECOR && c.DECOR.rockMesh) { S.rockDone = true; snowCover(c.DECOR.rockMesh, { amount: 0, skirt: 0.3 }); }
    if (S.oldFp && S.oldFp.visible) S.oldFp.visible = false;
  }

  (window.GameModules = window.GameModules || []).push({ name: 'terrain', order: -10, init, update });
})();
