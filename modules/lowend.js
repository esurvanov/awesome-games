/* modules/lowend.js — the "weak laptop" profile (LOWEND.md).
 *
 * Target: MacBook Air 2020 Intel (i3, Iris Plus, 2560x1600), Chrome, steady 30 fps, warm not hot.
 * The cost is pixel fill, so the `air` preset (QUALITY.air in open-world.html) draws the 3D scene at a fraction of the
 * canvas resolution and upscales it with AMD FidelityFX Super Resolution 1 (EASU edge-adaptive upscale + RCAS
 * sharpening), caps the frame rate at 30 and lets a slow controller move the render scale to hold it.
 *
 *   LowEnd.gpu(renderer)            → unmasked GPU renderer string ('' if hidden)
 *   LowEnd.pick({ renderer, coarse })→ { name, why, forced }   boot preset: ?q=… > remembered auto decision > GPU string
 *   LowEnd.makeFSR(THREE)           → { easu, rcas, setOutput(w, h), sharp }   two composer passes (see open-world.html)
 *   LowEnd.attach(host)             → the runtime controller (dynamic resolution + "this machine is too slow" fallback)
 *   LowEnd.frame(now, info)         → called by the game loop once per drawn frame
 *   LowEnd.stats()                  → numbers for the bench page / tools
 *
 * Classic script, loaded before the game module: THREE is only touched inside functions called by the game.
 * FSR 1 math: AMD FidelityFX FSR 1.0 (MIT, GPUOpen), ported to GLSL ES 3.0 with texelFetch (WebGL2 has no
 * textureGather); tap layout and constants follow ffx_fsr1.h (FsrEasuF / FsrRcasF, RCAS denoise on because the
 * grade pass adds film grain).
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const AUTO_KEY = 'eor-quality-auto';
  const PRESETS = ['air', 'low', 'med', 'high', 'ultra'];
  const LE = window.LowEnd = { forced: null, auto: null, gpuName: '', host: null };

  /* ------------------------------------------------------------------ detection */
  LE.gpu = function (renderer) {
    if (LE.gpuName) return LE.gpuName;
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      LE.gpuName = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    } catch (e) { LE.gpuName = ''; }
    return LE.gpuName;
  };
  // an integrated Intel GPU with no discrete GPU in the string (a MacBook Pro with a Radeon reports the Radeon when
  // powerPreference is high-performance). Software rasterisers count as weak too.
  LE.weakGPU = (s) => /SwiftShader|llvmpipe|Software/i.test(s) || (/Intel/i.test(s) && !/AMD|Radeon|NVIDIA|GeForce|Quadro|Arc\(TM\)|Arc /i.test(s));
  LE.pick = function ({ renderer, coarse }) {
    const q = (qs.get('q') || qs.get('quality') || '').toLowerCase();
    LE.gpu(renderer);
    if (PRESETS.includes(q)) { LE.forced = q; return { name: q, why: '?q=' + q, forced: true }; }
    const g = LE.gpu(renderer);
    const remembered = store.get(AUTO_KEY);
    if (remembered && PRESETS.includes(remembered)) { LE.auto = remembered; return { name: remembered, why: 'remembered: this machine was too slow before', forced: false }; }
    if (LE.weakGPU(g)) { LE.auto = 'air'; return { name: 'air', why: 'integrated GPU: ' + g, forced: false }; }
    return { name: coarse ? 'low' : 'high', why: coarse ? 'touch device' : 'default', forced: false };
  };
  LE.forget = () => store.set(AUTO_KEY, null);

  /* ------------------------------------------------------------------ FSR 1 passes */
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
  const EASU_FS = /* glsl */`
    precision highp float; precision highp int;
    uniform sampler2D tIn; uniform vec2 uIn; uniform vec2 uOut;
    ivec2 gMax;
    vec3 tap(vec2 p){ return texelFetch(tIn, clamp(ivec2(p), ivec2(0), gMax), 0).rgb; }
    float lum(vec3 c){ return c.g + .5 * (c.r + c.b); }          // luma x2 in 2 FMA (FSR)
    void setF(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE){
      //    a
      //  b c d
      //    e
      float dc = lD - lC, cb = lC - lB, lenX = max(abs(dc), abs(cb)), dirX = lD - lB;
      dir.x += dirX * w; lenX = clamp(abs(dirX) / max(lenX, 1. / 65536.), 0., 1.); len += lenX * lenX * w;
      float ec = lE - lC, ca = lC - lA, lenY = max(abs(ec), abs(ca)), dirY = lE - lA;
      dir.y += dirY * w; lenY = clamp(abs(dirY) / max(lenY, 1. / 65536.), 0., 1.); len += lenY * lenY * w;
    }
    void tapF(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c){
      vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;   // rotate into the edge frame, anisotropy
      float d2 = min(dot(v, v), clp);
      float wB = .4 * d2 - 1., wA = lob * d2 - 1.;                          // lanczos2 approximation without sin/rcp
      wB *= wB; wA *= wA; wB = 1.5625 * wB - .5625;
      float w = wB * wA; aC += c * w; aW += w;
    }
    void main(){
      gMax = textureSize(tIn, 0) - 1; vec2 inSz = vec2(gMax + 1);        // exact texel size (the composer size may be fractional)
      vec2 pp = floor(gl_FragCoord.xy) + .5;                               // output pixel centre
      pp = pp * (inSz / uOut) - .5;                                          // → input pixel space (texel centres at integers)
      vec2 fp = floor(pp); pp -= fp;
      //    b c
      //  e f g h
      //  i j k l
      //    n o
      vec3 bC = tap(fp + vec2(0., -1.)), cC = tap(fp + vec2(1., -1.));
      vec3 eC = tap(fp + vec2(-1., 0.)), fC = tap(fp), gC = tap(fp + vec2(1., 0.)), hC = tap(fp + vec2(2., 0.));
      vec3 iC = tap(fp + vec2(-1., 1.)), jC = tap(fp + vec2(0., 1.)), kC = tap(fp + vec2(1., 1.)), lC = tap(fp + vec2(2., 1.));
      vec3 nC = tap(fp + vec2(0., 2.)), oC = tap(fp + vec2(1., 2.));
      float bL = lum(bC), cL = lum(cC), eL = lum(eC), fL = lum(fC), gL = lum(gC), hL = lum(hC);
      float iL = lum(iC), jL = lum(jC), kL = lum(kC), lL = lum(lC), nL = lum(nC), oL = lum(oC);
      vec2 dir = vec2(0.); float len = 0.;
      setF(dir, len, (1. - pp.x) * (1. - pp.y), bL, eL, fL, gL, jL);
      setF(dir, len, pp.x * (1. - pp.y), cL, fL, gL, hL, kL);
      setF(dir, len, (1. - pp.x) * pp.y, fL, iL, jL, kL, nL);
      setF(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
      vec2 dir2 = dir * dir; float dirR = dir2.x + dir2.y; bool zro = dirR < 1. / 32768.;
      dirR = zro ? 1. : inversesqrt(dirR); dir.x = zro ? 1. : dir.x; dir *= dirR;
      len = len * .5; len *= len;
      float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
      vec2 len2 = vec2(1. + (stretch - 1.) * len, 1. - .5 * len);
      float lob = .5 - .29 * len, clp = 1. / lob;
      vec3 mn4 = min(min(fC, gC), min(jC, kC)), mx4 = max(max(fC, gC), max(jC, kC));
      vec3 aC = vec3(0.); float aW = 0.;
      tapF(aC, aW, vec2(0., -1.) - pp, dir, len2, lob, clp, bC);
      tapF(aC, aW, vec2(1., -1.) - pp, dir, len2, lob, clp, cC);
      tapF(aC, aW, vec2(-1., 1.) - pp, dir, len2, lob, clp, iC);
      tapF(aC, aW, vec2(0., 1.) - pp, dir, len2, lob, clp, jC);
      tapF(aC, aW, vec2(0., 0.) - pp, dir, len2, lob, clp, fC);
      tapF(aC, aW, vec2(-1., 0.) - pp, dir, len2, lob, clp, eC);
      tapF(aC, aW, vec2(1., 1.) - pp, dir, len2, lob, clp, kC);
      tapF(aC, aW, vec2(2., 1.) - pp, dir, len2, lob, clp, lC);
      tapF(aC, aW, vec2(2., 0.) - pp, dir, len2, lob, clp, hC);
      tapF(aC, aW, vec2(1., 0.) - pp, dir, len2, lob, clp, gC);
      tapF(aC, aW, vec2(1., 2.) - pp, dir, len2, lob, clp, oC);
      tapF(aC, aW, vec2(0., 2.) - pp, dir, len2, lob, clp, nC);
      gl_FragColor = vec4(min(mx4, max(mn4, aC / aW)), 1.);                // normalise + de-ring
    }`;
  const RCAS_FS = /* glsl */`
    precision highp float; precision highp int;
    uniform sampler2D tIn; uniform float uSharp;   // exp2(-stops): 1 = strongest
    uniform float uTime; uniform vec2 uOut;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      ivec2 p = ivec2(gl_FragCoord.xy), mx = textureSize(tIn, 0) - 1;
      //    b
      //  d e f
      //    h
      vec3 b = texelFetch(tIn, clamp(p + ivec2(0, -1), ivec2(0), mx), 0).rgb;
      vec3 d = texelFetch(tIn, clamp(p + ivec2(-1, 0), ivec2(0), mx), 0).rgb;
      vec3 e = texelFetch(tIn, p, 0).rgb;
      vec3 f = texelFetch(tIn, clamp(p + ivec2(1, 0), ivec2(0), mx), 0).rgb;
      vec3 h = texelFetch(tIn, clamp(p + ivec2(0, 1), ivec2(0), mx), 0).rgb;
      float bL = b.b * .5 + (b.r * .5 + b.g), dL = d.b * .5 + (d.r * .5 + d.g), eL = e.b * .5 + (e.r * .5 + e.g);
      float fL = f.b * .5 + (f.r * .5 + f.g), hL = h.b * .5 + (h.r * .5 + h.g);
      // noise detection (FSR_RCAS_DENOISE)
      float nz = .25 * (bL + dL + fL + hL) - eL;
      float rng = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
      nz = clamp(abs(nz) / max(rng, 1. / 65536.), 0., 1.); nz = -.5 * nz + 1.;
      vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
      vec2 peakC = vec2(1., -4.);
      vec3 hitMin = min(mn4, e) / (4. * mx4 + 1. / 65536.);
      vec3 hitMax = (peakC.x - max(mx4, e)) / min(4. * mn4 + peakC.y, vec3(-1. / 65536.));
      vec3 lobeRGB = max(-hitMin, hitMax);
      float lobe = max(-(.25 - 1. / 16.), min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.)) * uSharp;
      lobe *= nz;
      vec3 col = (lobe * (b + d + f + h) + e) / (4. * lobe + 1.);
      // the grade pass's film grain, moved here (full resolution) so it is not upscaled into sharpened blocks
      vec2 uv = gl_FragCoord.xy / uOut;
      col += (rnd(uv * 900. + fract(uTime)) - .5) * .018 * smoothstep(.0, .06, dot(col, vec3(.3, .55, .15)));
      gl_FragColor = vec4(max(col, vec3(1.2 / 255.)), 1.);
    }`;
  LE.makeFSR = function (THREE, uTime) {
    const out = { w: 16, h: 16, sharp: 0.25 };
    const rt = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    const easuM = new THREE.ShaderMaterial({ uniforms: { tIn: { value: null }, uIn: { value: new THREE.Vector2(16, 16) }, uOut: { value: new THREE.Vector2(16, 16) } },
      vertexShader: VS, fragmentShader: EASU_FS, depthTest: false, depthWrite: false });
    const rcasM = new THREE.ShaderMaterial({ uniforms: { tIn: { value: rt.texture }, uSharp: { value: Math.pow(2, -out.sharp) }, uTime: uTime || { value: 0 }, uOut: { value: new THREE.Vector2(16, 16) } },
      vertexShader: VS, fragmentShader: RCAS_FS, depthTest: false, depthWrite: false });
    class EasuPass extends THREE.Pass {
      constructor() { super(); this.needsSwap = false; this.quad = new THREE.FullScreenQuad(easuM); this.name = 'fsrEasu'; }
      setSize() { /* output size comes from setOutput (the composer passes the reduced scene size) */ }
      render(r, w, readBuffer) {
        easuM.uniforms.tIn.value = readBuffer.texture; easuM.uniforms.uIn.value.set(readBuffer.width, readBuffer.height);
        easuM.uniforms.uOut.value.set(out.w, out.h);
        r.setRenderTarget(rt); this.quad.render(r);
      }
    }
    class RcasPass extends THREE.Pass {
      constructor() { super(); this.needsSwap = false; this.quad = new THREE.FullScreenQuad(rcasM); this.name = 'fsrRcas'; }
      setSize() {}
      render(r, w, readBuffer) {
        rcasM.uniforms.uSharp.value = Math.pow(2, -out.sharp); rcasM.uniforms.uOut.value.set(out.w, out.h);
        r.setRenderTarget(this.renderToScreen ? null : w); this.quad.render(r);
      }
    }
    const F = { easu: new EasuPass(), rcas: new RcasPass(), rt, out };
    F.setOutput = (w, h) => { w = Math.max(1, w | 0); h = Math.max(1, h | 0); if (w === out.w && h === out.h) return; out.w = w; out.h = h; rt.setSize(w, h); };
    F.setEnabled = (on) => { F.easu.enabled = F.rcas.enabled = !!on; };
    F.setEnabled(false);
    return F;
  };

  /* ------------------------------------------------------------------ runtime controller */
  // host = { Q, QUALITY, setQuality, getScale, setScale(rs), bounds() → [lo, hi], G (getter), toast(icon, text), gpuQuery }
  const C = {
    win: [], gpu: [], cpu: [], tWin: 0, lastChange: -1e9, lastUp: -1e9, backoff: 8, upStreak: 0, warm: 0, state: 'warm-up',
    history: [], slow: [], slowT: 0, decided: false, drawn: 0, idleFrames: 0,
  };
  LE.attach = function (host) { LE.host = host; return LE; };
  LE.warm = function (s) { C.warm = Math.max(C.warm, s || 3); C.win.length = C.gpu.length = C.cpu.length = 0; C.upStreak = 0; };
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  // info: { dt (s, real interval since the previous drawn frame), cpuMs, gpuMs (or null), playing }
  LE.frame = function (now, info) {
    LE.last = info;
    const H = LE.host; if (!H) return;
    const Q = H.Q, ms = info.dt * 1000;
    C.drawn++;
    if (!info.playing || !(ms > 0) || ms > 250) { if (!info.playing) C.warm = Math.max(C.warm, 1.5); return; }   // hitch / tab switch / menu: not evidence
    if (C.warm > 0) { C.warm -= info.dt; C.state = 'warm-up'; return; }
    // LE.simGpuX (tests only): pretend the GPU is N× slower, to check the controller's decisions on a fast machine
    const g = info.gpuMs != null ? info.gpuMs * (LE.simGpuX || 1) : null;
    C.win.push(ms); C.cpu.push(info.cpuMs || 0); if (g != null && g > 0 && g < 500 * (LE.simGpuX || 1)) C.gpu.push(g);
    C.tWin += info.dt;
    if (C.tWin < 2) return;                                   // decide every ~2 s of play
    const win = C.win.splice(0), gpu = C.gpu.splice(0), cpu = C.cpu.splice(0); C.tWin = 0;
    const cap = Q.fpsCap || 0, budget = 1000 / (cap || 60);
    const miss = win.filter((x) => x > budget * 1.18).length / win.length;   // frames that missed their slot
    const med = pct(win, 0.5), fps = 1000 / med, cp = pct(cpu, 0.75);
    let gp = !LE.timerBad && gpu.length > win.length * 0.5 ? pct(gpu, 0.9) : null;
    // sustained GPU time per frame cannot exceed the frame interval: ANGLE-Metal timer spans include waiting, so a
    // median above the interval while no frame is late = a meaningless timer → probe instead (3 strikes: for good)
    if (gp != null && pct(gpu, 0.5) > med * 0.95 && miss < 0.05) { gp = null; C.timerStrikes = (C.timerStrikes || 0) + 1; if (C.timerStrikes >= 3) LE.timerBad = true; }
    const t = now / 1000;
    const rec = { t: +t.toFixed(1), q: Q.name, fps: +fps.toFixed(1), miss: +(miss * 100).toFixed(1), gpu90: gp != null ? +gp.toFixed(1) : null, cpu75: +cp.toFixed(1), rs: H.getScale() };
    // 1) any preset: this machine is far too slow → the weak-laptop profile, once, remembered for the next visit
    if (Q.name !== 'air' && !LE.forced && !C.decided) {
      const bad = fps < (Q.name === 'low' ? 27 : 22);
      C.slowT = bad ? C.slowT + 2 : 0;
      if (C.slowT >= 6) {
        C.decided = true; store.set(AUTO_KEY, 'air'); LE.auto = 'air';
        rec.act = 'auto → air'; C.history.push(rec);
        try { H.setQuality('air'); H.toast && H.toast('i-chip', 'Графика · слабый ноутбук (30 кадров)', 'c-ice'); } catch (e) { console.warn('[lowend] air', e); }
        LE.warm(4); return;
      }
    }
    // 2) air: dynamic resolution. Down fast when frames miss the 30 fps slot; up slowly, one step at a time, only with
    //    measured headroom (GPU timer) or as a probe with exponential back-off (no timer). A change reallocates the
    //    scene targets, so at most one change per rsEvery seconds; never while CPU-bound (fewer pixels would not help).
    if (!(Q.rsMin > 0)) { C.state = 'fixed'; C.history.push(rec); if (C.history.length > 120) C.history.shift(); return; }
    const [lo, hi] = H.bounds(), rs = H.getScale(), step = Q.rsStep || 0.05, every = Q.rsEvery || 4;
    const cpuBound = cp > budget * 0.85;
    let want = rs;
    if (miss > 0.08 || (gp != null && gp > budget * 0.92 && miss > 0.02)) {   // a timer alone never lowers the picture
      C.upStreak = 0;
      if (!cpuBound || (gp != null && gp > budget * 0.8)) want = rs - (miss > 0.3 ? 2 * step : step);
      C.state = cpuBound ? 'cpu-bound' : 'over budget';
      if (t - C.lastUp < 8) C.backoff = Math.min(64, C.backoff * 2);   // the last step up was too much: wait longer next time
    } else if (miss < 0.02) {
      const head = gp != null ? gp * Math.pow((rs + step) / rs, 2) < budget * 0.7 : true;   // pixels ∝ scale²
      C.upStreak = head ? C.upStreak + 1 : 0;
      C.state = head ? 'headroom' : 'holding';
      if (C.upStreak >= 3 && t - C.lastChange > Math.max(every, gp != null ? every : C.backoff)) { want = rs + step; C.upStreak = 0; }
    } else { C.upStreak = 0; C.state = 'holding'; }
    want = Math.min(hi, Math.max(lo, Math.round(want / 0.01) * 0.01));
    if (Math.abs(want - rs) > 0.004 && t - C.lastChange >= every) {
      if (want > rs) C.lastUp = t; else if (t - C.lastUp > 20) C.backoff = Math.max(8, C.backoff * 0.75);
      C.lastChange = t; H.setScale(want); rec.act = 'rs ' + rs.toFixed(2) + ' → ' + want.toFixed(2); rec.rs = want;
    }
    C.history.push(rec); if (C.history.length > 120) C.history.shift();
  };
  LE.stats = function () {
    const H = LE.host;
    return { gpu: LE.gpuName, preset: H && H.Q.name, forced: LE.forced, auto: LE.auto, rs: H ? H.getScale() : 1, bounds: H ? H.bounds() : null,
      state: C.state, timerBad: !!LE.timerBad, backoff: C.backoff, drawn: C.drawn, history: C.history.slice(-40) };
  };
})();
