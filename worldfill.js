/* WorldFill — procedural world dressing for open-world.html ("Эхо Разлома"), three.js r186 (global THREE from the page bootstrap).
 * Colliders: every structure registers its own drawn triangles through ctx.register (the page's Passport) —
 * see FOUNDATION.md. Colors: vertex/instance colors are authored as display values and decoded to linear here.
 * Classic script. Defines window.WorldFill = { build(ctx, knobs?), update(dt, ctx?), knobs, stats }.
 * Everything is procedural (reuses ctx.TX textures only). See WORLDFILL.md for ctx fields & integration.
 *
 * Systems (draw calls in brackets, main pass):
 *   horizon mountains [1] · sea ice: bergs/floes/pressure ridges/drifts [1] · open-water leads [1]
 *   structures: stone (patchSurface) [1] + built wood/metal/fabric [1] + flags [1]
 *   ground clutter pools: grass, shrubs, stones/snow pillows, ice shards, logs/stumps [5]
 *   mist sheets [1] · ground snow gusts [1] · cloud deck [1] · birds (flocks + ravens) [1]
 *   = 16 main-pass calls, + up to 3 shadow-pass calls (stone, built, logs).
 */
(function () {
  'use strict';

  /* ============================ knobs ============================ */
  const K = {
    seed: 20260925,
    mountains: true, seaIce: true, leads: true, sites: true, clutter: true, mist: true, gusts: true, clouds: true, birds: true,
    shadows: true,                 // stone + built structures + logs cast moon shadows (+3 shadow-pass calls)
    clutterR: 120,                 // clutter visible radius around camera (m)
    clutterFade: 26,               // fade band width at the outer edge (m)
    clutterCell: 16,               // clutter cell size (m)
    density: 1,                    // clutter density multiplier (0.5 for low-end)
    pool: { grass: 2600, shrub: 440, stone: 900, shard: 480, wood: 260 },   // max instances per pool
    gustN: 1100, gustR: 46,        // ground snow streaks: count, radius around camera
    wind: [1, 0.18],               // wind direction (xz). The game's snowfall drifts to +x.
    bergs: { large: 14, medium: 30, small: 44, floes: 150, ridges: 12, drifts: 110 },
    leads: 20,
    birds: { flocks: 5, perFlock: 13, ravens: 10, scare: 15 },
    mistPatches: 26,
    mountainSegs: [960, 720, 640],
    log: true,
  };

  /* ============================ state ============================ */
  let C = null, THREE = null, V3 = null;
  const S = { ready: false, stats: { tris: {}, calls: 0, shadowCalls: 0, instances: {} }, perches: [], blocks: new Map(), routes: [], slots: [] };
  const U = {};        // shared uniforms (objects shared by reference across all materials)
  const MG = {};       // shared merge buffers
  let G = {};          // cached unit geometries

  /* ============================ math / rng ============================ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;
  function mulberry(a) {
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function ihash(a, b, c) { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
  let rnd = Math.random;
  const rr = (a, b) => a + rnd() * (b - a);
  const lin = (v) => Math.pow(Math.max(v, 0), 2.2);                 // display value -> linear
  const linArr = (a) => { for (let i = 0; i < a.length; i++) a[i] = lin(a[i]); return a; };
  const jit = (c, a) => { const k = 1 + (rnd() * 2 - 1) * a; return [c[0] * k * (1 + (rnd() - .5) * a * .5), c[1] * k, c[2] * k * (1 + (rnd() - .5) * a * .5)]; };

  /* ============================ matrices ============================ */
  let UP, ONE;
  // M(x,y,z, yaw, pitchX, rollZ, sx,sy,sz) — Euler order YXZ: tilt locally, then yaw.
  function M(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(sx, sy, sz));
  }
  function segM(a, b, r) {
    const d = new V3().subVectors(b, a), len = Math.max(d.length(), 1e-4);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len));
    return new THREE.Matrix4().compose(new V3().addVectors(a, b).multiplyScalar(0.5), q, new V3(r, len, r));
  }
  function frame(x, z, yaw, y) {
    const Y = y === undefined ? C.getH(x, z) : y;
    const m = new THREE.Matrix4().compose(new V3(x, Y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), ONE);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return {
      m, x, z, y: Y, yaw,
      L(mat) { return m.clone().multiply(mat); },
      w(lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; },
      gy(lx, lz) { const p = this.w(lx, lz); return C.getH(p[0], p[1]) - Y; },
      p(lx, ly, lz) { const q = this.w(lx, lz); return new V3(q[0], Y + ly, q[1]); },
    };
  }

  /* ============================ merge builder ============================ */
  function Merge(extra, capture) { this.p = []; this.n = []; this.c = []; this.ex = extra || {}; this.x = {}; this.capture = !!capture; for (const k in this.ex) this.x[k] = []; }
  const _v = { }, _tmp = {};
  Merge.prototype.add = function (geo, m, col, ex) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, Cc = g.attributes.color, cnt = P.count;
    const nm = _tmp.nm.getNormalMatrix(m), flip = m.determinant() < 0, isFn = typeof col === 'function';
    const v = _tmp.v, n = _tmp.n, cap = this.capture && S.cap && !S.capOff ? S.cap : null;
    for (let t = 0; t + 2 < cnt; t += 3) for (let k = 0; k < 3; k++) {
      const i = t + (flip ? 2 - k : k);
      v.fromBufferAttribute(P, i).applyMatrix4(m); n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z);
      if (cap) cap.push(v.x, v.y, v.z);
      if (col == null && Cc) this.c.push(Cc.getX(i), Cc.getY(i), Cc.getZ(i));
      else { const cc = isFn ? col(v, n) : (col || [1, 1, 1]); this.c.push(cc[0], cc[1], cc[2]); }
      for (const key in this.ex) {
        const s = this.ex[key], val = ex && ex[key] !== undefined ? ex[key] : 0, arr = this.x[key];
        if (s === 1) arr.push(typeof val === 'number' ? val : val[0]);
        else for (let j = 0; j < s; j++) arr.push(typeof val === 'number' ? val : (val[j] || 0));
      }
    }
    if (g !== geo) g.dispose();
    return this;
  };
  Merge.prototype.tris = function () { return this.p.length / 9; };
  Merge.prototype.geometry = function () {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(linArr(new Float32Array(this.c)), 3));
    for (const k in this.ex) geo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(this.x[k]), this.ex[k]));
    geo.computeBoundingSphere();
    return geo;
  };

  // smooth normals on a non-indexed geometry by welding equal positions
  function smoothNormals(g) {
    const P = g.attributes.position, N = g.attributes.normal, map = new Map(), key = (i) => `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
    for (let i = 0; i < P.count; i++) { const k = key(i); let a = map.get(k); if (!a) map.set(k, a = [0, 0, 0]); a[0] += N.getX(i); a[1] += N.getY(i); a[2] += N.getZ(i); }
    for (let i = 0; i < P.count; i++) { const a = map.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; N.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
    N.needsUpdate = true; return g;
  }
  // jitter vertices of a (non-indexed) geometry consistently per shared position
  function jitterGeo(g, amt, seed, fn) {
    const P = g.attributes.position, off = new Map();
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let o = off.get(k);
      if (!o) { o = fn ? fn(x, y, z) : [(C.vnoise(x * 7.1 + seed, y * 5.3 + z * 3.3) - .5) * amt, (C.vnoise(y * 6.7 - seed, z * 4.9 + x) - .5) * amt, (C.vnoise(z * 6.1 + seed * .7, x * 5.7 - y) - .5) * amt]; off.set(k, o); }
      P.setXYZ(i, x + o[0], y + o[1], z + o[2]);
    }
    g.computeVertexNormals(); return g;
  }
  function chipBlock(amt) { return jitterGeo(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).toNonIndexed(), amt || .09, rr(0, 99)); }
  function grid(nu, nv, fn) {   // indexed grid geometry from fn(u,v)->[x,y,z]
    const pos = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...fn(i / nu, j / nv));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1; idx.push(a, b, c, a, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }

  /* ============================ world queries ============================ */
  const seaAt = (x, z) => C.getH(x, z) < -0.6;
  function seaDisk(x, z, r) { if (!seaAt(x, z)) return false; for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; if (!seaAt(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false; } return true; }
  function flatDisk(x, z, r, ny) { if (C.normalY(x, z) < ny) return false; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; if (C.normalY(x + Math.cos(a) * r, z + Math.sin(a) * r) < ny) return false; } return true; }
  function segD(px, pz, a, b) { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1; const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1); return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t); }
  function routeD(x, z) { let d = 1e9; for (const r of S.routes) for (let i = 0; i + 1 < r.length; i++) d = Math.min(d, segD(x, z, r[i], r[i + 1])); return d; }
  const BG = 24;
  function block(x, z, r) {
    for (let i = Math.floor((x - r) / BG); i <= Math.floor((x + r) / BG); i++) for (let j = Math.floor((z - r) / BG); j <= Math.floor((z + r) / BG); j++) {
      const k = i * 4096 + j; let a = S.blocks.get(k); if (!a) S.blocks.set(k, a = []); a.push([x, z, r]);
    }
  }
  function blocked(x, z, m = 0) { const a = S.blocks.get(Math.floor(x / BG) * 4096 + Math.floor(z / BG)); if (!a) return false; for (const b of a) if (Math.hypot(x - b[0], z - b[1]) < b[2] + m) return true; return false; }
  // placement blocking only (keeps later sites/clutter apart); colliders come from scope() below
  function col(x, z, r) { block(x, z, r + .4); }
  // collider scope: every triangle added to the MG merges while fn runs is registered as ONE passport entry
  // (exact drawn shape). Wires, guy lines and snow drifts are built with S.capOff > 0 and stay passable.
  const REACH = 452;
  function scope(role, name, fn, opts) {
    const prev = S.cap; S.cap = [];
    try { fn(); } finally {
      const pos = S.cap; S.cap = prev;
      if (pos.length >= 9 && C.register) {
        let near = false; for (let k = 0; k < pos.length && !near; k += 3) if (Math.hypot(pos[k], pos[k + 2]) < REACH) near = true;
        if (near) { try { C.register({ positions: new Float32Array(pos) }, role, Object.assign({ name: 'wf_' + name }, opts)); } catch (e) { console.warn('[WorldFill] register', name, e); } }
      }
    }
  }
  const passive = (fn) => { S.capOff = (S.capOff || 0) + 1; try { fn(); } finally { S.capOff--; } };
  const lakeD = (x, z) => Math.hypot(x - C.POI.lake.x, z - C.POI.lake.z);

  /* ============================ GLSL ============================ */
  const GL_NOISE = `
float wfh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wfn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(wfh(i), wfh(i+vec2(1.,0.)), u.x), mix(wfh(i+vec2(0.,1.)), wfh(i+vec2(1.,1.)), u.x), u.y); }
float wff(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * wfn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
vec3 wfLin(vec3 c){ return pow(max(c, vec3(0.)), vec3(2.2)); }
vec3 wfDisp(vec3 c){ return pow(max(c, vec3(0.)), vec3(1. / 2.2)); }`;
  const GL_FOGV = '\n#include <fog_pars_vertex>\n';

  function makeUniforms() {
    const w = new THREE.Vector2(K.wind[0], K.wind[1]).normalize();
    Object.assign(U, {
      uWfT: { value: 0 }, uWfStorm: { value: 0 }, uWfWind: { value: w },
      uWfMoon: { value: (C.MOON_DIR || new V3(.77, .36, .56)).clone().normalize() },
      uWfFog: { value: C.FOG || new THREE.Color(0x1b2b55) },
      uWfAur: { value: new THREE.Color(.2, 1, .66) }, uWfAurI: { value: 1 },
      uWfFA: { value: K.clutterR - K.clutterFade }, uWfFB: { value: K.clutterR },
      tWfSnow: { value: C.TX && C.TX.snow }, tWfSnowN: { value: C.TX && C.TX.snowN }, tWfRock: { value: C.TX && C.TX.rock },
    });
  }
  const pickU = (...names) => { const o = {}; for (const n of names) o[n] = U[n]; return o; };

  /* ---- vertex patch for Mesh*Material: world varyings, instancing, distance fade, wind sway ---- */
  function vtxPatch(sh, o) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWfT, uWfStorm, uWfFA, uWfFB; uniform vec2 uWfWind;
${o.vary ? 'varying vec3 vWfP; varying vec3 vWfN;' : ''}
${o.aux ? 'attribute vec3 aAux; varying vec3 vWfAux;' : ''}
${o.ice ? 'attribute float aIce; varying float vWfIce;' : ''}
${o.flag ? GL_NOISE : ''}`)
      .replace('#include <project_vertex>', `
${o.flag ? `
  float wfU = clamp(transformed.x / .62, 0., 1.);
  vec3 wfOi = vec3(0.);
  #ifdef USE_INSTANCING
    wfOi = (instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
  #endif
  float wfPhF = uWfT * (5.5 + uWfStorm * 5.) - wfU * 5.5 + dot(wfOi.xz, vec2(.37, .23));
  float wfStr = .06 + .05 * wfn(vec2(uWfT * .4, wfOi.x * .1)) + uWfStorm * .12;
  transformed.z += sin(wfPhF) * wfU * wfStr + sin(wfPhF * 2.3 + 1.) * wfU * wfStr * .35;
  transformed.y -= wfU * wfU * .06 * (1. - uWfStorm * .7);` : ''}
vec4 wfW = vec4(transformed, 1.0);
vec3 wfO = vec3(0.);
#ifdef USE_INSTANCING
  wfW = instanceMatrix * wfW; wfO = (instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
#endif
wfW = modelMatrix * wfW; wfO = (modelMatrix * vec4(wfO, 1.)).xyz;
${o.fade ? `float wfFade = 1. - smoothstep(uWfFA, uWfFB, distance(wfO.xz, cameraPosition.xz));
wfW.xyz = wfO + (wfW.xyz - wfO) * wfFade;` : ''}
${o.sway ? `float wfHh = max(wfW.y - wfO.y, 0.);
float wfPh = uWfT * (1.6 + uWfStorm * 2.4) + dot(wfO.xz, vec2(.23, .19));
float wfGust = .5 + .5 * sin(uWfT * .63 - dot(wfO.xz, uWfWind) * .035);
float wfAmp = .05 + .07 * wfGust + uWfStorm * .3;
wfW.xz += uWfWind * wfHh * wfHh * wfAmp * (1. + .6 * sin(wfPh));
wfW.xz += vec2(-uWfWind.y, uWfWind.x) * wfHh * wfHh * .035 * sin(wfPh * 1.7);` : ''}
vec4 mvPosition = viewMatrix * wfW;
gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
${o.vary ? `vWfP = wfW.xyz;
vec3 wfNo = objectNormal;
#ifdef USE_INSTANCING
  { mat3 wfm = mat3(instanceMatrix); wfNo = wfm * (wfNo / vec3(dot(wfm[0], wfm[0]), dot(wfm[1], wfm[1]), dot(wfm[2], wfm[2]))); }
#endif
vWfN = normalize(mat3(modelMatrix) * wfNo);` : ''}
${o.aux ? 'vWfAux = aAux;' : ''}
${o.ice ? 'vWfIce = aIce;' : ''}`);
  }

  /* ---- "built" surface: weathering detail + planks + snow on up-faces + emissive aux ---- */
  function builtFrag(sh, aux, snowK, foliage) {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tWfSnow, tWfRock; varying vec3 vWfP; varying vec3 vWfN; ${aux ? 'varying vec3 vWfAux;' : ''}
${GL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 wfN = normalize(vWfN) * (gl_FrontFacing ? 1. : -1.);
vec3 wfAux = ${aux ? 'vWfAux' : `vec3(${Number(snowK === undefined ? 1 : snowK).toFixed(3)}, 0., 0.)`};
vec3 wfB = pow(abs(wfN), vec3(4.)); wfB /= (wfB.x + wfB.y + wfB.z);
vec3 wfQ = vWfP * .45;
float wfDet = dot(wfDisp(texture2D(tWfRock, wfQ.zy).rgb * wfB.x + texture2D(tWfRock, wfQ.xz).rgb * wfB.y + texture2D(tWfRock, wfQ.xy).rgb * wfB.z), vec3(.333));
diffuseColor.rgb *= wfLin(vec3((.6 + .8 * wfDet) * (.88 + .24 * wfn(vWfP.xz * 1.7 + vWfP.y * 1.3))));
float wfPl = abs(fract(vWfP.y * 3.4 + wfn(vWfP.xz * .6) * .3) - .5);
diffuseColor.rgb *= wfLin(vec3(1. - wfAux.y * .5 * smoothstep(.4, .5, wfPl)));
vec3 wfBase = diffuseColor.rgb;
float wfMac = wfDisp(texture2D(tWfSnow, vWfP.xz * .043).rgb).r;
float wfSnow = smoothstep(.5, .8, wfN.y + (wfMac - .5) * .45) * clamp(wfAux.x, 0., 1.);
vec3 wfST = wfLin(mix(vec3(.8), wfDisp(texture2D(tWfSnow, vWfP.xz * .3).rgb), .5) * (.82 + .36 * wfMac) * vec3(.86, .92, 1.02));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.35, .46, .68), .07 * wfAux.x);
diffuseColor.rgb = mix(diffuseColor.rgb, wfST, wfSnow);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, .92, wfSnow);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += wfBase * wfAux.z;`);
    if (foliage) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(normalize(vWfN + vec3(0., .6, 0.)), 0.)).xyz);`);
  }

  /* ---- glacial ice + snow ---- */
  function iceFrag(sh, attr) {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tWfSnow; uniform vec3 uWfMoon; uniform float uWfStorm; varying vec3 vWfP; varying vec3 vWfN; ${attr ? 'varying float vWfIce;' : ''}
${GL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 wfN = normalize(vWfN) * (gl_FrontFacing ? 1. : -1.);
float wfIceK = ${attr ? 'vWfIce' : '1.'};
float wfMac = wfDisp(texture2D(tWfSnow, vWfP.xz * .021).rgb).r;
float wfSnow = clamp(smoothstep(.62, .86, wfN.y + (wfMac - .5) * .35) + (1. - wfIceK), 0., 1.);
vec3 wfST = wfLin(mix(vec3(.8), wfDisp(texture2D(tWfSnow, vWfP.xz * .2).rgb), .5) * (.82 + .36 * wfMac) * vec3(.86, .92, 1.02));
float wfBand = wfn(vec2(vWfP.y * 1.1 + wfn(vWfP.xz * .07) * 4., dot(vWfP.xz, vec2(.03, .02))));
float wfL = clamp(.22 + wfBand * .55 + wfN.y * .25 + smoothstep(1., 9., vWfP.y) * .15, 0., 1.);
vec3 wfIce = mix(vec3(.06, .26, .43), vec3(.42, .72, .86), wfL);
wfIce = wfLin(mix(wfIce, vec3(.03, .11, .19), smoothstep(.7, 0., vWfP.y) * .55));
diffuseColor.rgb *= mix(wfIce, wfST, wfSnow);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(.12, .86, wfSnow);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 wfV = normalize(cameraPosition - vWfP);
float wfFr = pow(1. - abs(dot(wfN, wfV)), 2.);
float wfBk = pow(max(dot(-wfV, uWfMoon), 0.), 3.);
totalEmissiveRadiance += wfIce * (1. - wfSnow) * (.09 + .28 * wfFr + .5 * wfBk);`)
      .replace('#include <fog_fragment>', `#if defined(USE_FOG) && !defined(FOG_EXP2)
  float wfFogF = smoothstep(fogNear, fogFar * mix(1.9, 1.1, uWfStorm), vFogDepth);
  wfFogF = min(wfFogF, mix(.84, 1., uWfStorm));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, wfFogF);
#elif defined(USE_FOG)
  #include <fog_fragment>
#endif`);
  }

  function patched(mat, key, fn) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) { if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, sh, r); fn(sh); };
    mat.customProgramCacheKey = () => 'wf_' + key;
    return mat;
  }
  function builtMat(key, o) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: !!o.vc, roughness: o.rough || .8, metalness: o.metal || 0, side: o.side || THREE.FrontSide });
    return patched(m, key, (sh) => { Object.assign(sh.uniforms, pickU('uWfT', 'uWfStorm', 'uWfFA', 'uWfFB', 'uWfWind', 'tWfSnow', 'tWfRock')); vtxPatch(sh, { vary: true, aux: o.aux, fade: o.fade, sway: o.sway, flag: o.flag }); builtFrag(sh, o.aux, o.snow, o.sway); });
  }
  function iceMat(key, o) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: !!o.vc, roughness: .3, metalness: 0, flatShading: !!o.flat });
    return patched(m, key, (sh) => { Object.assign(sh.uniforms, pickU('uWfT', 'uWfStorm', 'uWfFA', 'uWfFB', 'uWfWind', 'uWfMoon', 'tWfSnow')); vtxPatch(sh, { vary: true, ice: o.attr, fade: o.fade }); iceFrag(sh, o.attr); });
  }
  function stoneMat(key, o) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: !!o.vc, roughness: 1, metalness: 0 });
    if (C.patchSurface) C.patchSurface(m, { snowS: .16, rockS: o.rockS || .28, lo: .58, hi: .8, glitter: .4 });
    return patched(m, key, (sh) => { Object.assign(sh.uniforms, pickU('uWfT', 'uWfStorm', 'uWfFA', 'uWfFB', 'uWfWind')); vtxPatch(sh, { fade: o.fade });
      // patchSurface feeds its snow mask with mat3(instanceMatrix)*normal; correct it for non-uniform instance scale
      sh.vertexShader = sh.vertexShader.replace('wn3 = mat3(instanceMatrix) * wn3;', '{ mat3 wfm = mat3(instanceMatrix); wn3 = wfm * (wn3 / vec3(dot(wfm[0], wfm[0]), dot(wfm[1], wfm[1]), dot(wfm[2], wfm[2]))); }'); });
  }

  function addMesh(name, geo, mat, o = {}) {
    const m = geo.isInstancedMesh ? geo : new THREE.Mesh(geo, mat);
    m.name = 'wf_' + name; m.castShadow = !!o.cast && K.shadows; m.receiveShadow = !!o.recv;
    if (o.noCull) m.frustumCulled = false;
    if (o.order !== undefined) m.renderOrder = o.order;
    m.matrixAutoUpdate = !!o.dynamic; m.updateMatrix();
    C.scene.add(m);
    S.calls++; if (m.castShadow) S.shadowCalls++;
    return m;
  }
  function triCount(geo, inst) { const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; return Math.round(n * (inst || 1)); }

  /* ================================================================ */
  /* 1. HORIZON MOUNTAINS                                              */
  /* ================================================================ */
  function buildMountains() {
    const L3 = [
      { R: 1330, D: 170, seg: K.mountainSegs[0], rows: 12, lo: 26, hi: 175, f: .0046, sd: 11 },
      { R: 1700, D: 220, seg: K.mountainSegs[1], rows: 11, lo: 70, hi: 290, f: .0033, sd: 37 },
      { R: 2080, D: 240, seg: K.mountainSegs[2], rows: 10, lo: 140, hi: 430, f: .0025, sd: 71 },
    ];
    let nv = 0, ni = 0; for (const L of L3) { nv += L.seg * (L.rows + 1); ni += L.seg * L.rows * 6; }
    const pos = new Float32Array(nv * 3), lay = new Float32Array(nv), idx = new Uint32Array(ni);
    let v = 0, t = 0;
    L3.forEach((L, li) => {
      const base = v;
      for (let i = 0; i < L.seg; i++) {
        const a = i / L.seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const m = C.fbm(ca * 2.2 + L.sd, sa * 2.2 - L.sd, 3);
        const amp = L.lo * .3 + (L.hi - L.lo * .3) * smooth(.34, .72, m);
        const wob = (C.fbm(ca * 3.1 + L.sd * 2, sa * 3.1, 3) - .5) * L.D * 1.3;
        for (let j = 0; j <= L.rows; j++) {
          const tt = j / L.rows, r = L.R + wob + (tt - .5) * 2 * L.D, x = ca * r, z = sa * r;
          const env = Math.pow(Math.sin(Math.PI * tt), .7);
          const rg = C.ridge(x * L.f + L.sd, z * L.f - L.sd, 5);
          let y = amp * env * (.22 + 1.05 * rg * rg + .18 * C.fbm(x * L.f * 3.1, z * L.f * 3.1, 2));
          if (j === 0 || j === L.rows) y = -4;
          pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; lay[v] = li; v++;
        }
      }
      for (let i = 0; i < L.seg; i++) for (let j = 0; j < L.rows; j++) {
        const a = base + i * (L.rows + 1) + j, b = a + 1, c = base + ((i + 1) % L.seg) * (L.rows + 1) + j, d = c + 1;
        idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aL', new THREE.BufferAttribute(lay, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals(); geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: pickU('uWfFog', 'uWfMoon', 'uWfStorm', 'uWfAur', 'uWfAurI'), fog: false,
      vertexShader: `attribute float aL; varying vec3 vW; varying vec3 vN; varying float vL;
        void main(){ vW = position; vN = normal; vL = aL; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 uWfFog, uWfMoon, uWfAur; uniform float uWfStorm, uWfAurI; varying vec3 vW; varying vec3 vN; varying float vL;
        ${GL_NOISE}
        void main(){
          vec3 n = normalize(vN); vec3 dv = vW - cameraPosition; float dist = length(dv); vec3 V = -dv / dist;
          float nz = wff(vW.xz * .006 + vL * 7.);
          float fine = wfn(vW.xz * .05);
          float snowLine = 18. + vL * 32. + (nz - .5) * 90.;
          float snow = smoothstep(.42, .72, n.y + (fine - .5) * .25) * smoothstep(snowLine - 10., snowLine + 30., vW.y);
          float ang = atan(vW.z, vW.x);
          float gully = wfn(vec2(ang * (520. + vL * 200.), vW.y * .025 + nz));
          snow = max(snow, smoothstep(.55, .85, gully) * smoothstep(.1, .45, n.y) * smoothstep(snowLine, snowLine + 80., vW.y) * .9);
          snow = clamp(snow, 0., 1.);
          vec3 rock = vec3(.05, .058, .085) * (.65 + .7 * nz);
          vec3 alb = mix(rock, vec3(.66, .73, .9), snow);
          float dif = max(dot(n, uWfMoon), 0.);
          vec3 col = alb * (vec3(.2, .26, .42) * (.6 + .4 * n.y) + vec3(.8, .85, 1.) * dif * .95);
          float rim = pow(1. - clamp(dot(n, V), 0., 1.), 3.) * smoothstep(-.2, .6, dot(-V, uWfMoon));
          col += vec3(.45, .55, .85) * rim * .22 * (.3 + .7 * snow);
          col += uWfAur * uWfAurI * .04 * snow * (.5 + .5 * n.y);
          float ap = 1. - exp(-dist * (.00052 + vL * .00011));
          float haze = exp(-max(vW.y, 0.) / (70. + vL * 40.));
          ap = clamp(ap * .85 + haze * .5, 0., .97);
          ap = mix(ap, .93, uWfStorm);
          gl_FragColor = vec4(mix(wfLin(col), uWfFog * 1.06, ap), 1.);   // shaded in display terms, decoded, then linear fog
        }`,
    });
    const mesh = addMesh('mountains', geo, mat, {}); mesh.renderOrder = -5;
    S.stats.tris.mountains = triCount(geo);
  }

  /* ================================================================ */
  /* 2. SEA ICE                                                         */
  /* ================================================================ */
  // generic slab: irregular star-shaped outline extruded through levels [[yFrac, radiusMul]], cap on top
  function slab(mg, x, y0, z, w, d, h, yaw, o) {
    const n = o.n, sd = rr(0, 100), ph1 = rr(0, TAU), ph2 = rr(0, TAU), R = [];
    for (let k = 0; k < n; k++) { const a = k / n * TAU; R.push(1 + .13 * Math.sin(a * 2 + ph1) + .08 * Math.sin(a * 3 + ph2) + (C.vnoise(k * .9 + sd, 3.3) - .5) * (o.rough || .22)); }
    const cut0 = (rnd() * n) | 0, cutLen = o.cut ? 2 + ((rnd() * 4) | 0) : 0, cutD = rr(.1, .24), cutH = rr(.35, .75);
    const inCut = (k) => cutLen && ((k - cut0 + n) % n) < cutLen;
    const ring = (lv, k) => {
      const a = k / n * TAU; let r = R[k] * lv[1] * (1 + (C.vnoise(k * 1.7 + sd, lv[0] * 4 + sd) - .5) * (o.facet ? .16 : .08));
      if (inCut(k) && lv[0] > cutH) r *= 1 - cutD;
      return [Math.cos(a) * r * w / 2, lv[0] * h, Math.sin(a) * r * d / 2];
    };
    const pos = [], idx = [], L = o.levels;
    for (const lv of L) for (let k = 0; k < n; k++) pos.push(...ring(lv, k));
    for (let j = 0; j + 1 < L.length; j++) for (let k = 0; k < n; k++) {
      const a = j * n + k, b = j * n + (k + 1) % n, c = (j + 1) * n + (k + 1) % n, dd = (j + 1) * n + k;
      idx.push(a, c, b, a, dd, c);
    }
    let side = new THREE.BufferGeometry(); side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); side.setIndex(idx);
    if (o.facet) { const f = side.toNonIndexed(); side.dispose(); side = f; } side.computeVertexNormals();
    // cap: outer ring (top level), inner ring, center dome
    const top = L[L.length - 1], cp = [], ci = [];
    for (let k = 0; k < n; k++) cp.push(...ring(top, k));
    for (let k = 0; k < n; k++) { const p = ring(top, k); cp.push(p[0] * .78, p[1] + h * (o.dome || .03), p[2] * .78); }
    cp.push(0, top[0] * h + h * (o.dome || .03) * 1.6, 0);
    const ctr = 2 * n;
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; ci.push(k, n + k1, k1, k, n + k, n + k1); ci.push(ctr, n + k1, n + k); }
    const cap = new THREE.BufferGeometry(); cap.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cap.setIndex(ci); cap.computeVertexNormals();
    const m = M(x, y0, z, yaw, rr(-.02, .02), rr(-.02, .02)), tint = jit([1, 1, 1], .07);
    mg.add(side, m, tint, { aIce: 1 }); mg.add(cap, m, tint, { aIce: 1 });
    side.dispose(); cap.dispose();
  }
  const TAB_LV = [[-.25, 1.04], [0, 1], [.1, .955], [.22, .99], [.6, 1], [.88, .985], [1, .96]];
  const FLOE_LV = [[-.8, 1.03], [0, 1], [1, .97]];
  function pinnacle(mg, x, z, s, yaw, hm) {
    const g = new THREE.IcosahedronGeometry(1, s > 6 ? 2 : 1), P = g.attributes.position, sd = rr(0, 100), v = new V3(), off = new Map();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      let o = off.get(k);
      if (!o) {
        const u = v.clone(); u.multiplyScalar(1 + (C.fbm(u.x * 1.6 + sd, u.z * 1.6 + u.y * 1.3 + sd, 3) - .5) * .75);
        if (u.y > 0) u.y *= hm * (1 + C.ridge(u.x * 1.2 + sd, u.z * 1.2 - sd, 3) * 1.1); else u.y *= .3;
        o = u; off.set(k, o);
      }
      P.setXYZ(i, o.x, o.y, o.z);
    }
    g.computeVertexNormals();
    mg.add(g, M(x, -.15 * s, z, yaw, rr(-.12, .12), rr(-.12, .12), s, s, s * rr(.7, 1.1)), jit([1, 1, 1], .07), { aIce: 1 });
    g.dispose();
  }
  function drift(mg, x, y, z, len, wid, hgt, yaw) {   // snow: passable (feet sink in), never captured
    S.capOff = (S.capOff || 0) + 1; try { driftIn(mg, x, y, z, len, wid, hgt, yaw); } finally { S.capOff--; }
  }
  function driftIn(mg, x, y, z, len, wid, hgt, yaw) {
    // on land: a terrain-hugging mound (vertices follow the heightfield, edges tucked under the snow)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const g = grid(10, 3, (u, v) => {
      const a = u * TAU, r = v, lx = Math.cos(a) * r * len, lz = Math.sin(a) * r * wid;
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      const q = Math.max(0, 1 - r * r), prof = q * q * (1 + .3 * Math.cos(a)) * (1 + .12 * Math.sin(a * 3 + x)) * hgt;
      return [wx, Math.max(C.getH(wx, wz), 0) + prof - .05 - (v === 1 ? .08 : 0), wz];
    });
    // on land use the terrain's own snow shading (patchSurface) so the mound blends into the ground
    if (C.getH(x, z) > .3 && MG.stone) MG.stone.add(g, new THREE.Matrix4(), [.97, .97, .97], { aRock: 0 });
    else mg.add(g, new THREE.Matrix4(), [1, 1, 1], { aIce: 0 });
    g.dispose();
  }

  function buildSeaIce() {
    const mg = MG.ice, placed = [], B = K.bergs;
    const free = (x, z, r) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r);
    const wYaw = Math.atan2(-K.wind[1], K.wind[0]);
    const put = (n, tries, dMin, dMax, sMin, sMax, fn) => {
      let c = 0;
      for (let k = 0; k < tries && c < n; k++) {
        const a = rr(0, TAU), d = rr(dMin, dMax), x = Math.cos(a) * d, z = Math.sin(a) * d, s = rr(sMin, sMax);
        if (!free(x, z, s * .6 + 6) || !seaDisk(x, z, s * .6 + 4)) continue;
        if (d - s * .6 < REACH) scope('solid', 'ice', () => fn(x, z, s, d)); else fn(x, z, s, d);
        placed.push({ x, z, r: s * .6 }); c++;
      }
    };
    // large tabular bergs (20–60 m), mostly beyond the walkable ring
    put(B.large, 900, 520, 1080, 24, 60, (x, z, s) => { slab(mg, x, 0, z, s, s * rr(.45, .85), Math.min(rr(9, 22), s * rr(.22, .38)), rr(0, TAU), { n: s > 36 ? 30 : 22, levels: TAB_LV, cut: true, dome: .025, rough: .42, facet: true }); });
    // medium: tabular or pinnacle
    put(B.medium, 900, 430, 1000, 9, 24, (x, z, s, d) => {
      if (rnd() < .45) slab(mg, x, 0, z, s, s * rr(.5, .9), Math.min(rr(5, 12), s * .45), rr(0, TAU), { n: 16, levels: TAB_LV, cut: rnd() < .6, dome: .04, rough: .4, facet: true });
      else pinnacle(mg, x, z, s * .5, rr(0, TAU), rr(.8, 1.6));
      if (d - s * .5 < 445) col(x, z, s * .42);
    });
    // small bergy bits (some walkable)
    put(B.small, 900, 335, 820, 2.5, 7, (x, z, s, d) => { pinnacle(mg, x, z, s * .5, rr(0, TAU), rr(.6, 1.3)); if (d < 450) col(x, z, s * .4); });
    // floes: flat rafted slabs. Walkable ring keeps them low (player feet clip at most ~0.3 m)
    put(B.floes, 1400, 320, 860, 3, 14, (x, z, s, d) => { const hh = d < 450 ? rr(.12, .3) : rr(.3, .9); slab(mg, x, 0, z, s, s * rr(.5, .95), hh, rr(0, TAU), { n: 12, levels: FLOE_LV, rough: .35, dome: .6 }); });
    // pressure ridges: lines of tilted ice blocks with snow banked against them
    for (let r = 0, k = 0; r < B.ridges && k < 300; k++) {
      const a0 = rr(0, TAU), d0 = rr(340, 900); let x = Math.cos(a0) * d0, z = Math.sin(a0) * d0;
      if (!seaDisk(x, z, 6)) continue;
      r++;
      let a = a0 + Math.PI / 2 + rr(-.6, .6); const len = rr(40, 200), sd = rr(0, 99);
      const ridge = () => { for (let s = 0, lastC = -9; s < len; s += rr(1, 1.5)) {
        a += rr(-.07, .07); x += Math.cos(a) * 1.25; z += Math.sin(a) * 1.25;
        if (!seaAt(x, z) || !seaAt(x + Math.cos(a) * 5, z + Math.sin(a) * 5)) break;
        const hn = C.fbm(s * .045 + sd, 1.3, 3); if (hn < .36) continue;
        const H = (hn - .33) * 5.5;
        const nb = 1 + ((rnd() * 2.4) | 0);
        for (let b = 0; b < nb; b++) {
          const off = rr(-1.4, 1.4) * (1 + H * .3), bx = x - Math.sin(a) * off, bz = z + Math.cos(a) * off;
          mg.add(G.chipL, M(bx, rr(-.25, H * .55), bz, rr(0, TAU), rr(-.8, .8), rr(-.8, .8), rr(.6, 2.2), rr(.25, 1.1) * (.6 + H * .4), rr(.5, 1.7)), jit([1, 1, 1], .1), { aIce: 1 });
        }
        if (rnd() < .3) drift(mg, x + rr(-1, 1), 0, z + rr(-1, 1), rr(2, 4) + H, rr(1.5, 3) + H * .5, H * rr(.25, .5) + .15, a);
        if (s - lastC > 3 && Math.hypot(x, z) < 452) { col(x, z, 1.3 + H * .25); lastC = s; }
      } };
      if (d0 - len < REACH) scope('solid', 'pressure_ridge', ridge); else ridge();   // one passport entry per ridge
    }
    // wind-carved snow drifts (sastrugi) on the ice
    put(B.drifts, 900, 320, 950, 4, 18, (x, z, s, d) => { drift(mg, x, 0, z, s, s * rr(.2, .4), d < 450 ? rr(.15, .35) : rr(.3, 1.3), wYaw + rr(-.35, .35)); });
    // snow banked along the whole shoreline: long low drifts where sea meets land
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * TAU + rr(-.02, .02); let d = 240;
      while (d < 450 && !seaAt(Math.cos(a) * d, Math.sin(a) * d)) d += 3;
      if (d >= 450) continue;
      d += rr(1, 5); const x = Math.cos(a) * d, z = Math.sin(a) * d;
      drift(mg, x, 0, z, rr(5, 11), rr(2, 4), rr(.18, .4), a + Math.PI / 2 + rr(-.3, .3));
    }
  }

  /* ---- open-water leads ---- */
  function buildLeads() {
    const pos = [], uv = [], idx = [];
    const ribbon = (pts) => {
      const b = pos.length / 3; let dist = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
        let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const nx = -dz, nz = dx, w = p.w / 2, rim = .6 + p.w * .35;
        if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
        for (const [s, u] of [[-(w + rim), -1.5], [-w, -1], [w, 1], [w + rim, 1.5]]) { pos.push(p.x + nx * s, .035, p.z + nz * s); uv.push(u, dist); }
      }
      for (let i = 0; i + 1 < pts.length; i++) for (let j = 0; j < 3; j++) { const a = b + i * 4 + j, c = a + 4; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    };
    const walk = (x, z, a, len, w0, depth) => {
      const pts = [];
      for (let s = 0; s < len; s += rr(5, 9)) {
        const f = s / len, w = w0 * Math.sin(Math.PI * clamp(f * 1.05 + .02, 0, 1)) * (.6 + .8 * C.vnoise(s * .05 + x, z)) + .15;
        pts.push({ x, z, w });
        a += rr(-.3, .3); x += Math.cos(a) * 7; z += Math.sin(a) * 7;
        if (!seaAt(x, z) || Math.hypot(x, z) > 1250) break;
        if (depth < 1 && rnd() < .025) walk(x, z, a + (rnd() < .5 ? 1 : -1) * rr(.6, 1.1), len * rr(.3, .5), w0 * .6, depth + 1);
      }
      if (pts.length > 2) { ribbon(pts); if (w0 > 1.4) S.leadSmoke.push(pts); }
    };
    S.leadSmoke = [];
    for (let i = 0, k = 0; i < K.leads && k < 400; k++) {
      const a = rr(0, TAU); let d = 240;
      while (d < 460 && !seaAt(Math.cos(a) * d, Math.sin(a) * d)) d += 4;
      d += rr(3, 40); const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!seaDisk(x, z, 3)) continue;
      walk(x, z, a + rr(-.9, .9), rr(90, 480), rr(.8, 4), 0); i++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), pickU('uWfT', 'uWfMoon', 'uWfFog', 'uWfAur', 'uWfAurI', 'uWfStorm')),
      fog: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: `varying vec2 vUv; varying vec3 vW; ${GL_FOGV}
        void main(){ vUv = uv; vW = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uWfT, uWfAurI, uWfStorm; uniform vec3 uWfMoon, uWfFog, uWfAur; varying vec2 vUv; varying vec3 vW;
        #include <fog_pars_fragment>
        ${GL_NOISE}
        void main(){
          float a = abs(vUv.x);
          vec3 V = normalize(cameraPosition - vW);
          vec2 q = vW.xz * .7 + vec2(uWfT * .16, uWfT * .07);
          vec3 n = normalize(vec3((wfn(q) - .5) * .22, 1., (wfn(q + 7.3) - .5) * .22));
          vec3 R = reflect(-V, n);
          float fres = .04 + .96 * pow(1. - max(dot(n, V), 0.), 5.);
          vec3 sky = mix(uWfFog * 1.15, uWfFog * .45 + vec3(.01, .02, .05), clamp(R.y * 2.2, 0., 1.));
          sky += uWfAur * uWfAurI * .3 * smoothstep(.05, .35, R.y) * (1. - uWfStorm);
          float glint = pow(max(dot(R, uWfMoon), 0.), 260.) * 2.2 * (1. - uWfStorm);
          vec3 water = wfLin(vec3(.004, .015, .03)) + sky * fres + vec3(.7, .83, 1.) * glint;
          float cr = wfn(vec2(vUv.y * .9, a * 3.));
          vec3 nilas = wfLin(mix(vec3(.2, .3, .4), vec3(.46, .58, .72), cr) * (.7 + .3 * wfn(vW.xz * 2.)));
          float isRim = smoothstep(.9, 1.06, a);
          vec3 col = mix(water, nilas, isRim);
          float alpha = 1. - smoothstep(1.15, 1.5, a + (cr - .5) * .25);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
    addMesh('leads', geo, mat, { order: 1 });
    S.stats.tris.leads = triCount(geo);
  }

  /* ================================================================ */
  /* 5. SITES — expedition camp, shipwreck, ruins, cairns, poles, flags, pier */
  /* ================================================================ */
  const COL = {
    wood: [.33, .25, .18], woodG: [.32, .3, .27], dark: [.06, .06, .07], metal: [.3, .31, .33], glass: [.02, .035, .05],
    paint: [.55, .21, .09], tar: [.11, .085, .07], band: [.42, .36, .27], stone: [1.2, 1.26, 1.42], rope: [.12, .1, .08],
    tentO: [.62, .28, .12], tentG: [.28, .34, .28], tentR: [.5, .15, .13], olive: [.25, .28, .16], glyph: [.36, .96, .75],
  };
  const addB = (geo, m, c, aux) => MG.built.add(geo, m, c, { aAux: aux || [1, 0, 0] });
  const addS = (geo, m, c) => MG.stone.add(geo, m, c, { aRock: 0 });
  function wire(a, b, sag, r, n, c) {  // catenary-ish rope from a to b (passable: no collider)
    S.capOff = (S.capOff || 0) + 1;
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n, p = new V3().lerpVectors(a, b, t); p.y -= sag * 4 * t * (1 - t);
      MG.built.add(G.cyl3, segM(prev, p, r), c || COL.rope, { aAux: [0, 0, 0] }); prev = p;
    }
    S.capOff--;
  }
  function stick(a, b, r, c, aux, geo) { MG.built.add(geo || G.cyl6, segM(a, b, r), c, { aAux: aux || [1, 0, 0] }); }

  /* Sites are dressed with real models by modules/structures.js: this pass only picks the spots and writes
   * placement slots (S.slots → WorldFill.slots). Each slot: { kind, x, z, yaw, s?, m? (exact Matrix4 elements),
   * site, fit? }. Slots with `m` are placed exactly (poles: wires are drawn here to their insulators); the rest
   * are fitted to the ground by structures.js (footprint raycast, slope ≤ 20°). */
  function slot(kind, x, z, yaw, o) { const s = Object.assign({ kind, x, z, yaw: yaw || 0 }, o); S.slots.push(s); return s; }
  // power pole models (prop_power_pole*): 6 m, cross-arms along local X; wire attach points (x, y) on the insulators
  const POLE_ARMS = [[-.52, 5.82], [.52, 5.82], [.3, 4.72]];
  const poleArms = (m) => POLE_ARMS.map(([x, y]) => new V3(x, y, 0).applyMatrix4(m));

  function fireRing(f, lx, lz) { scope('solid', 'fire_ring', () => fireRingIn(f, lx, lz)); }
  function fireRingIn(f, lx, lz) {
    const g = f.gy(lx, lz);
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; addS(G.chip0, f.L(M(lx + Math.cos(a) * .75, g + .05, lz + Math.sin(a) * .75, rr(0, TAU), 0, 0, rr(.16, .24), rr(.12, .18), rr(.16, .24))), jit(COL.stone, .1)); }
    for (let i = 0; i < 3; i++) addB(G.cyl6, f.L(M(lx, g + .09, lz, i * 1.1, Math.PI / 2, 0, .07, 1, .07)), [.05, .045, .04], [1, 0, 0]);
  }

  function buildCamp() {
    const P = C.POI, st = P.station; let best = null;
    for (let k = 0; k < 2500 && !best; k++) {
      const a = rr(0, TAU), d = rr(140, 290), x = st.x + Math.cos(a) * d, z = st.z + Math.sin(a) * d;
      const h = C.getH(x, z); if (h < 3 || h > 45 || Math.hypot(x, z) > 330) continue;
      if (C.nearPOI(x, z, 26) || C.inRift(x, z, 30) || routeD(x, z) < 18 || !flatDisk(x, z, 13, .93)) continue;
      let ok = true;  // pole line must be clear of the rift and other POIs
      for (let t = .15; t < 1 && ok; t += .05) { const px = lerp(st.x, x, t), pz = lerp(st.z, z, t); if (C.inRift(px, pz, 10) || (t > .3 && C.nearPOI(px, pz, 4))) ok = false; }
      if (ok) best = { x, z };
    }
    if (!best) return null;
    const f = frame(best.x, best.z, rr(0, TAU));
    const put = (kind, lx, lz, yaw, o) => { const [x, z] = f.w(lx, lz); return slot(kind, x, z, f.yaw + yaw, Object.assign({ site: 'camp' }, o)); };
    put('tent_dome', 0, 0, .1); put('tent_tunnel', 5.2, 1.5, .4); put('tent_dome', -4.6, 2.6, -.3 + Math.PI, { s: .92 });
    put('crate_wood', 2.2, -4, .3, { push: 18 }); put('crate_wood', 3.4, -3.9, -.1, { push: 18 }); put('crate_wood', 2.7, -4, .5, { push: 18, up: .46 });
    put('crate_wood', 4.4, -2.2, 1.2, { push: 18 });
    put('drum_blue', -2.8, -4.2, 0, { push: 16 }); put('drum_blue', -2.2, -4.8, 1, { push: 16 }); put('barrel_steel', -3.5, -3.4, .6, { push: 22, lying: true });
    put('sledge', 7.5, -3, .9 - Math.PI / 2); put('snowcat', -9.5, -6.5, .35 - Math.PI / 2, { tilt: [.06, -.05], sink: .16 });
    fireRing(f, 1, 5.2);
    // the pole line ends at a transformer pole in the camp
    const [mx, mz] = f.w(7, 6.5), my = C.getH(mx, mz) - .3, myaw = Math.atan2(st.x - mx, st.z - mz);
    const mm = M(mx, my, mz, myaw); slot('pole_tr', mx, mz, myaw, { m: mm.elements.slice(), site: 'camp' });
    best.mast = poleArms(mm); col(mx, mz, .4); S.perches.push(new V3(0, 6.05, 0).applyMatrix4(mm));
    for (let i = 0; i < 4; i++) { const a = rr(0, TAU), d = rr(9, 14), p = f.w(Math.cos(a) * d, Math.sin(a) * d); drift(MG.ice, p[0], C.getH(p[0], p[1]), p[1], rr(3, 6), rr(1.5, 2.5), rr(.3, .6), Math.atan2(-K.wind[1], K.wind[0]) + rr(-.3, .3)); }
    block(best.x, best.z, 16);
    S.perches.push(f.p(2.7, f.gy(2.7, -4) + .95, -4));
    return best;
  }

  /* ---- power poles from the station to the camp (scanned pole models; wires drawn here) ---- */
  function buildPoles(camp) {
    const st = C.POI.station; if (!camp) return;
    const L = Math.hypot(camp.x - st.x, camp.z - st.z), dx = (camp.x - st.x) / L, dz = (camp.z - st.z) / L;
    let prevArm = null, nth = 0;
    for (let d = 40; d < L - 14; d += 34) {
      nth++;
      const bend = Math.sin(d * .02) * 4, x = st.x + dx * d - dz * bend, z = st.z + dz * d + dx * bend;
      if (C.nearPOI(x, z, 3) || C.inRift(x, z, 6)) { prevArm = null; continue; }
      const g = C.getH(x, z), yaw = Math.atan2(dx, dz);
      if (nth === 4) {  // toppled pole lying in the snow, wires draped
        const m = M(x, g + .12, z, yaw + .4, 0, Math.PI / 2 - .04);
        slot('pole', x, z, yaw, { m: m.elements.slice(), site: 'poles', fallen: true });
        if (prevArm) for (const a of prevArm) wire(a, new V3(x + rr(-2, 2), g + .1, z + rr(-2, 2)), .3, .02, 6, COL.dark);
        prevArm = null; col(x, z, .4); continue;
      }
      const m = M(x, g - .3, z, yaw, rr(-.04, .04), rr(-.04, .04));
      slot(nth === 1 ? 'pole_tr' : 'pole', x, z, yaw, { m: m.elements.slice(), site: 'poles' });
      const arms = poleArms(m);
      if (prevArm) for (let k = 0; k < 3; k++) {
        if (nth === 7 && k === 2) { wire(arms[k], new V3(arms[k].x - dx * 6, C.getH(arms[k].x - dx * 6, arms[k].z - dz * 6) + .05, arms[k].z - dz * 6), .5, .02, 6, COL.dark); continue; }
        wire(prevArm[k], arms[k], rr(.8, 1.3), .018, 9, COL.dark);
      }
      prevArm = arms; col(x, z, .35);
      S.perches.push(new V3(0, 6.05, 0).applyMatrix4(m));
    }
    if (prevArm && camp.mast) for (let k = 0; k < 3; k++) wire(prevArm[k], camp.mast[k], 1.1, .018, 8, COL.dark);
  }

  /* ---- ancient ruins: arch + broken columns + wall per site (models placed by structures.js) ---- */
  function buildRuins() {
    const sites = [];
    for (let k = 0; k < 4000 && sites.length < 4; k++) {
      const x = rr(-330, 330), z = rr(-330, 330), h = C.getH(x, z);
      if (h < 5 || h > 70 || C.nearPOI(x, z, 22) || C.inRift(x, z, 22) || routeD(x, z) < 14 || blocked(x, z, 20)) continue;
      if (!flatDisk(x, z, 9, .94) || sites.some((s) => Math.hypot(s.x - x, s.z - z) < 110)) continue;
      sites.push({ x, z });
      const f = frame(x, z, rr(0, TAU)), put = (kind, lx, lz, yaw, o) => { const [wx, wz] = f.w(lx, lz); return slot(kind, wx, wz, f.yaw + yaw, Object.assign({ site: 'ruins', s: rr(1, 1.25) }, o)); };
      put('ruin_arch', 0, 0, 0, { s: rr(1.1, 1.3) });
      const cz = sites.length % 2 ? 7 : -7;
      put('ruin_column', -3.2, cz, rr(0, TAU)); put('ruin_column', 3.4, cz + rr(-1, 1), rr(0, TAU));
      if (rnd() < .8) put('ruin_wall', rr(-9.5, -8), rr(-2, 2), Math.PI / 2 + rr(-.25, .25));
      S.perches.push(new V3(x, h + 5, z));
      block(x, z, 14);
    }
    return sites;
  }

  /* ---- cairns on hilltops, inuksuit along routes ---- */
  function buildCairns() {
    const list = [];
    for (let k = 0; k < 1500 && list.length < 10; k++) {
      const x = rr(-340, 340), z = rr(-340, 340), h = C.getH(x, z);
      if (h < 10 || C.nearPOI(x, z, 14) || C.inRift(x, z, 10) || routeD(x, z) < 5 || blocked(x, z, 4)) continue;
      let top = true; for (let i = 0; i < 8 && top; i++) { const a = i / 8 * TAU; if (C.getH(x + Math.cos(a) * 18, z + Math.sin(a) * 18) > h - 1.5) top = false; }
      if (!top || list.some((p) => Math.hypot(p.x - x, p.z - z) < 70)) continue;
      list.push({ x, z }); slot('cairn', x, z, rr(0, TAU), { s: rr(.75, 1.15), site: 'cairns' }); col(x, z, .9); S.perches.push(new V3(x, h + 1.3, z));
    }
    for (const r of S.routes) for (let i = 0; i + 1 < r.length; i++) {   // an inuksuk at the middle of each leg, arms across the path
      const a = r[i], b = r[i + 1], x = lerp(a.x, b.x, .5) + (b.z - a.z) * .02, z = lerp(a.z, b.z, .5) - (b.x - a.x) * .02;
      if (C.getH(x, z) > 1.5 && !C.nearPOI(x, z, 6) && !C.inRift(x, z, 6) && !blocked(x, z, 2)) { slot('inuksuk', x, z, Math.atan2(b.x - a.x, b.z - a.z) + rr(-.2, .2), { s: rr(.9, 1.1), site: 'cairns' }); col(x, z, .8); }
    }
  }

  /* ---- footpath marker flags ---- */
  function buildFlags() {
    const list = [];
    for (const r of S.routes) for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i], b = r[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
      for (let d = 12, side = 1; d < L - 8; d += rr(18, 26), side = -side) {
        const x = a.x + dx * d - dz * side * 3.2, z = a.z + dz * d + dx * side * 3.2, h = C.getH(x, z);
        if (h < 1 || C.nearPOI(x, z, -6) || C.inRift(x, z, 8) || C.normalY(x, z) < .8 || blocked(x, z, 1) || rnd() < .1) continue;
        const lean = new V3(rr(-.12, .12), 1, rr(-.12, .12)).normalize(), base = new V3(x, h - .15, z), top = base.clone().addScaledVector(lean, 2.3);
        scope('trunk', 'flag_pole', () => stick(base, top, .025, [.45, .38, .22], [1, 0, 0], G.cyl3), { topFrac: 1 });
        list.push(top);
      }
    }
    if (!list.length) return;
    const geo = new THREE.PlaneGeometry(.62, .4, 6, 2); geo.translate(.31, -.2, 0);
    const mat = builtMat('flag', { side: THREE.DoubleSide, flag: true, fade: false, snow: 0 }); mat.roughness = .85;
    const im = new THREE.InstancedMesh(geo, mat, list.length), wy = Math.atan2(-K.wind[1], K.wind[0]);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    const cols = [[.75, .2, .1], [.8, .35, .1], [.7, .55, .12], [.62, .14, .12]], cc = new THREE.Color();
    list.forEach((p, i) => { im.setMatrixAt(i, M(p.x, p.y - .02, p.z, wy + rr(-.25, .25))); const c = jit(cols[i % 4], .15); cc.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); im.setColorAt(i, cc); });
    addMesh('flags', im, null, { recv: true, noCull: true });
    S.stats.tris.flags = triCount(geo, list.length);
  }

  /* ---- hull lofting (shipwreck + rowboat) ---- */
  function hullGeo(L, B, D, o) {
    const NS = o.ns, NM = o.nm, pos = [], colr = [], idx = [];
    const hb = (s) => s < .45 ? B / 2 * lerp(.64, 1, smooth(0, .45, s)) : B / 2 * Math.sqrt(Math.max(0, 1 - Math.pow((s - .45) / .55, 2.2)));
    const yd = (s) => D + D * .22 * Math.pow(2 * s - 1, 2);
    const yk = (s) => smooth(.78, 1, s) * D * .75 + smooth(.12, 0, s) * D * .22;
    for (let i = 0; i <= NS; i++) {
      const s = i / NS, x = (s - .5) * L, b = hb(s);
      for (let j = 0; j <= NM; j++) {
        const th = Math.PI * j / NM, y = yd(s) - (yd(s) - yk(s)) * Math.pow(Math.sin(th), .45);
        pos.push(x, y, b * Math.cos(th));
        const c = y > yd(s) - D * .12 ? o.band : o.body; colr.push(c[0], c[1], c[2]);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NM; j++) {
      if (o.hole && o.hole((i + .5) / NS, Math.PI * (j + .5) / NM)) continue;
      const a = i * (NM + 1) + j, b = a + 1, c = a + NM + 2, d = a + NM + 1; idx.push(a, c, b, a, d, c);
    }
    const ci = pos.length / 3; pos.push(-L / 2, (yd(0) + yk(0)) / 2, 0); colr.push(...o.body);   // transom
    for (let j = 0; j < NM; j++) idx.push(ci, j + 1, j);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return { g, hb, yd, yk };
  }
  function buildShip() { scope('solid', 'shipwreck', buildShipIn); }
  function buildShipIn() {
    let spot = null;
    for (let k = 0; k < 400 && !spot; k++) { const a = rr(0, TAU), d = rr(372, 425), x = Math.cos(a) * d, z = Math.sin(a) * d; if (seaDisk(x, z, 26)) spot = { x, z, a }; }
    for (let k = 0; k < 400 && !spot; k++) { const a = rr(0, TAU), d = rr(430, 560), x = Math.cos(a) * d, z = Math.sin(a) * d; if (seaDisk(x, z, 26)) spot = { x, z, a }; }
    if (!spot) return;
    const L = 30, Bm = 7.6, D = 4.6, yaw = spot.a + Math.PI / 2 + rr(-.5, .5);
    const f = frame(spot.x, spot.z, yaw, 0), W = f.L(M(0, -1.8, 0, 0, .04, .19));
    const H = hullGeo(L, Bm, D, { ns: 22, nm: 12, body: COL.tar, band: COL.band, hole: (s, th) => s > .36 && s < .52 && th > .12 * Math.PI && th < .4 * Math.PI });
    addB(H.g, W, null, [1, 1, 0]); H.g.dispose();
    const X = (s) => (s - .5) * L;
    for (const s of [.37, .41, .45, .49, .53]) {   // exposed ribs in the hole
      let prev = null;
      for (let j = 0; j <= 6; j++) { const th = Math.PI * j / 12, y = H.yd(s) - (H.yd(s) - H.yk(s)) * Math.pow(Math.sin(th), .45), p = new V3(X(s), y, (H.hb(s) - .12) * Math.cos(th)).applyMatrix4(W); if (prev) addB(G.cyl3, segM(prev, p, .1), [.2, .16, .12], [1, 0, 0]); prev = p; }
    }
    for (let z = -Bm / 2 + .4; z < Bm / 2 - .3; z += .46) for (let x0 = -L / 2 + 1.5; x0 < L / 2 - 4; x0 += 2.6) {  // deck planks
      const s0 = (x0 + L / 2) / L, s1 = s0 + 2.5 / L;
      if (Math.abs(z) > Math.min(H.hb(s0), H.hb(s1)) - .25 || (s0 > .3 && s0 < .56 && z > -.8) || rnd() < .07) continue;
      addB(G.box, W.clone().multiply(M(x0 + 1.25, H.yd(s0 + 1.25 / L) - .28, z, rr(-.02, .02), rr(-.03, .03), rr(-.02, .02), 2.5, .08, .42)), jit(COL.woodG, .1), [1, 1, 0]);
    }
    for (const side of [-1, 1]) for (let s = .06; s < .92; s += .05) {   // bulwark posts + rail
      if (side > 0 && s > .34 && s < .54) continue;
      const p = new V3(X(s), H.yd(s) + .35, side * (H.hb(s) - .1)); addB(G.box, W.clone().multiply(M(p.x, p.y, p.z, 0, 0, 0, .12, .7, .12)), COL.tar, [1, 1, 0]);
      const s2 = s + .05, q = new V3(X(s2), H.yd(s2) + .7, side * (H.hb(s2) - .1));
      if (s2 < .92 && rnd() > .15) addB(G.cyl6, W.clone().multiply(segM(new V3(p.x, p.y + .35, p.z), q, .07)), COL.tar, [1, 1, 0]);
    }
    const dh = W.clone().multiply(M(X(.17), H.yd(.17) - .2, 0));   // deckhouse
    addB(G.box, dh.clone().multiply(M(0, 1.05, 0, 0, 0, 0, 4, 2.1, 3.2)), [.3, .26, .2], [1, 1, 0]);
    addB(G.box, dh.clone().multiply(M(0, 2.2, 0, 0, 0, 0, 4.4, .18, 3.6)), COL.tar, [1, 0, 0]);
    addB(G.box, dh.clone().multiply(M(2.01, .9, 0, 0, 0, 0, .04, 1.6, .8)), COL.dark, [0, 0, 0]);
    for (const z of [-1, 1]) addB(G.box, dh.clone().multiply(M(-.6, 1.4, z * 1.61, 0, 0, 0, .6, .45, .03)), COL.glass, [0, 0, 0]);
    const mb = new V3(X(.56), H.yd(.56) - 1, 0).applyMatrix4(W), mtop = new V3(X(.56) - 1.2, H.yd(.56) + 15, .8).applyMatrix4(W);   // mainmast
    addB(G.cylT, segM(mb, mtop, .3), COL.tar, [1, 0, 0]);
    const nest = mb.clone().lerp(mtop, .78); addB(G.box, M(nest.x, nest.y, nest.z, yaw, .1, .05, 1.4, .15, 1.4), COL.tar, [1, 0, 0]);
    const yc = mb.clone().lerp(mtop, .7), yd2 = new V3(Math.sin(yaw), 0, Math.cos(yaw));
    addB(G.cyl6, segM(yc.clone().addScaledVector(yd2, 4.8).add(new V3(0, 1.6, 0)), yc.clone().addScaledVector(yd2, -4.8).add(new V3(0, -1.6, 0)), .12), COL.tar, [1, 0, 0]);
    const fb = new V3(X(.8), H.yd(.8) - 1, 0).applyMatrix4(W), ftop = new V3(X(.8) + .3, H.yd(.8) + 5.5, -.2).applyMatrix4(W);   // broken foremast
    addB(G.cylT, segM(fb, ftop, .26), COL.tar, [1, 0, 0]);
    for (let i = 0; i < 3; i++) addB(G.cone5, M(ftop.x + rr(-.1, .1), ftop.y + .3, ftop.z + rr(-.1, .1), rr(0, TAU), rr(-.2, .2), rr(-.2, .2), .09, .7, .09), COL.band, [1, 0, 0]);
    const bs0 = new V3(L / 2 - .3, H.yd(1) - .2, 0).applyMatrix4(W), bs1 = new V3(L / 2 + 6, H.yd(1) + 2.2, 0).applyMatrix4(W);   // bowsprit
    addB(G.cylT, segM(bs0, bs1, .18), COL.tar, [1, 0, 0]);
    for (const side of [-1, 1]) for (const s of [.5, .55, .6]) {   // shrouds
      if (side > 0 && s === .55) { wire(mtop.clone().lerp(mb, .15), new V3(X(s), H.yd(s) - .5, side * (H.hb(s) + .4)).applyMatrix4(W), 2.5, .025, 6, COL.rope); continue; }
      wire(mtop.clone().lerp(mb, .15), new V3(X(s), H.yd(s) + .6, side * H.hb(s)).applyMatrix4(W), .2, .025, 4, COL.rope);
    }
    wire(mtop, bs1, 1.2, .025, 8, COL.rope);
    for (const [s, side, sc] of [[.3, 1, 1], [.66, 1, .8], [.4, -1, .9], [.75, -1, .7], [.05, 0, .8], [.97, 0, .6]]) {   // drifts + rubble at the waterline
      const p = new V3(X(s), 0, side * (H.hb(s) + 1.2)).applyMatrix4(W);
      drift(MG.ice, p.x, 0, p.z, 7 * sc, 2.6 * sc, 1.9 * sc, yaw + rr(-.2, .2));
    }
    for (let i = 0; i < 26; i++) { const a = rr(0, TAU), rx = Math.cos(a) * (L / 2 + rr(1, 5)), rz = Math.sin(a) * (Bm / 2 + rr(1, 4)), p = new V3(rx, 0, rz).applyMatrix4(f.m); MG.ice.add(G.chipL, M(p.x, rr(-.2, .4), p.z, rr(0, TAU), rr(-.7, .7), rr(-.7, .7), rr(.5, 1.5), rr(.3, .8), rr(.4, 1.2)), jit([1.1, 1.1, 1.1], .1), { aIce: 1 }); }
    for (const s of [.08, .28, .48, .68, .88]) { const p = new V3(X(s), 0, 0).applyMatrix4(W); col(p.x, p.z, H.hb(s) * .95 + .4); }
    col(bs1.x, bs1.z, .4);
    S.perches.push(mtop.clone().add(new V3(0, .15, 0)), yc.clone().addScaledVector(yd2, 4.6).add(new V3(0, 1.65, 0)));
    S.ship = spot;
  }

  /* ---- wooden pier + frozen rowboat on the lake (models placed by structures.js) ---- */
  function buildPier() {
    const lk = C.POI.lake, lh = lk.h !== undefined ? lk.h : C.getH(lk.x, lk.z), cell = { x: lk.x + 6, z: lk.z - 4 };
    let best = null;
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * TAU, ca = Math.cos(a), sa = Math.sin(a);
      let r0 = 50; while (r0 < 70 && C.getH(lk.x + ca * r0, lk.z + sa * r0) < lh + .9) r0 += .5;
      if (r0 >= 70) continue;
      const ex = lk.x + ca * 36, ez = lk.z + sa * 36;
      if (segD(cell.x, cell.z, { x: ex, z: ez }, { x: lk.x + ca * r0, z: lk.z + sa * r0 }) < 16) continue;
      const score = r0 + Math.abs(a - 2.4) * 2 + (routeD(lk.x + ca * 45, lk.z + sa * 45) < 10 ? 30 : 0);
      if (!best || score < best.score) best = { a, r0, score };
    }
    if (!best) return;
    // struct_pier_wood: 12.4 m section along local Z, deck top 3.65 m above the pile feet → sunk 3.45 m below the ice
    const SEC = 12.4, ca = Math.cos(best.a), sa = Math.sin(best.a), yaw = Math.atan2(-ca, -sa), y = lh - 3.45;
    const sx = lk.x + ca * (best.r0 + 1.5), sz = lk.z + sa * (best.r0 + 1.5);
    const P = (d, side) => [sx - ca * d - sa * side, sz - sa * d + ca * side];   // d along pier (toward centre), side across
    const n = Math.max(1, Math.min(3, Math.round((best.r0 + 1.5 - 36) / SEC))), len = n * SEC;
    for (let k = 0; k < n; k++) { const [x, z] = P(SEC * (k + .5), 0); slot('pier', x, z, yaw, { m: M(x, y, z, yaw).elements.slice(), site: 'pier' }); }
    for (let d = 0; d < len; d += 2) { const [x, z] = P(d, 0); col(x, z, 1.4); }
    const [bx, bz] = P(len - 3, 3.2);   // rowboat frozen in beside the pier end
    const bm = M(bx, lh - .15, bz, yaw + Math.PI / 2 + .3, .05, .1);
    slot('rowboat', bx, bz, yaw, { m: bm.elements.slice(), site: 'pier' });
    MG.ice.add(G.hemi, bm.clone().multiply(M(0, .05, 0, 0, 0, 0, 1.0, .18, 2.1)), [1, 1, 1], { aIce: 0 });   // ice rim around the hull
    col(bx, bz, 1.6);
    const pp = P(len - .4, 1.1); S.perches.push(new V3(pp[0], lh + 1.2, pp[1]));
    const pm = P(len * .5, 0); S.pier = { x: pm[0], z: pm[1] };
  }

  /* ================================================================ */
  /* 3. GROUND CLUTTER (camera-centred cell pools)                      */
  /* ================================================================ */
  function grassGeo() {
    const p = [], c = [], n = [], r = mulberry(99), nb = 6;
    const push = (v, col, nn) => { p.push(...v); c.push(...col); n.push(...nn); };
    for (let b = 0; b < nb; b++) {
      const a = b / nb * TAU + r() * .8, lean = .25 + r() * .45, hg = .7 + r() * .35, w = .035 + r() * .02, off = .03 + r() * .05;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz * w, pz = dx * w, bx = dx * off, bz = dz * off;
      const mx = bx + dx * lean * .3 * hg, my = .55 * hg, mz = bz + dz * lean * .3 * hg, tx = bx + dx * lean * hg, ty = .92 * hg, tz = bz + dz * lean * hg;
      const nn = new V3(dx * .35, 1, dz * .35).normalize().toArray();
      const B0 = [.2, .17, .12], M0 = [.52, .47, .35], T0 = [.8, .79, .74];
      const bL = [bx - px, 0, bz - pz], bR = [bx + px, 0, bz + pz], mL = [mx - px * .6, my, mz - pz * .6], mR = [mx + px * .6, my, mz + pz * .6], tp = [tx, ty, tz];
      for (const [v, cc] of [[bL, B0], [bR, B0], [mR, M0], [bL, B0], [mR, M0], [mL, M0], [mL, M0], [mR, M0], [tp, T0]]) push(v, cc, nn);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(linArr(c), 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  }
  function shrubGeo() {
    const mg = new Merge(), r = mulberry(7), bark = [.2, .1, .07], tip = [.36, .15, .09];
    for (let s = 0; s < 4; s++) {
      const a = s / 4 * TAU + r() * .9, lean = .35 + r() * .3, L = .55 + r() * .35, d = new V3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
      const p0 = new V3(0, 0, 0), p1 = d.clone().multiplyScalar(L * .5), p2 = p1.clone().add(new V3(Math.cos(a) * .12, L * .45, Math.sin(a) * .12));
      mg.add(G.cyl3, segM(p0, p1, .022), bark); mg.add(G.cyl3, segM(p1, p2, .014), tip);
      const b = a + (r() < .5 ? .9 : -.9), q = p1.clone().add(new V3(Math.cos(b) * .22, .25, Math.sin(b) * .22));
      mg.add(G.cyl3, segM(p1, q, .01), tip);
    }
    mg.add(G.ico0, M(.02, .34, 0, 0, 0, 0, .17, .07, .15), [.88, .92, 1]);
    const g = mg.geometry(); return g;
  }
  function stoneGeo() {
    const g = new THREE.IcosahedronGeometry(1, 1), P = g.attributes.position, v = new V3(), m = new Map();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      let o = m.get(k); if (!o) { const s = 1 + (C.fbm(v.x * 1.3 + 4, v.z * 1.3 + v.y * .9, 3) - .5) * .6; o = [v.x * s, Math.max(v.y * s * .7, -.35), v.z * s * 1.1]; m.set(k, o); }
      P.setXYZ(i, o[0], o[1], o[2]);
    }
    g.computeVertexNormals(); return smoothNormals(g);
  }
  function shardGeo() {
    const mg = new Merge(), r = mulberry(3);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + r(); mg.add(G.cone4, M(Math.cos(a) * .12, .45, Math.sin(a) * .12, r() * TAU, Math.sin(a) * (.25 + r() * .2), -Math.cos(a) * (.25 + r() * .2), .09 + r() * .06, .8 + r() * .5, .07 + r() * .05), [1, 1, 1]); }
    const g = mg.geometry(); g.deleteAttribute('color'); return g;
  }
  function woodGeo() {
    const mg = new Merge();
    mg.add(new THREE.CylinderGeometry(1, 1.06, 1, 8, 1, false), M(0, .5, 0), (v, n) => Math.abs(n.y) > .9 ? [.5, .42, .32] : [.27, .23, .2]);
    mg.add(G.cone5, M(.95, .3, 0, 0, 0, -1.2, .18, .7, .18), [.27, .23, .2]);
    mg.add(G.cone5, M(-.5, .72, .8, 0, .9, .5, .14, .55, .14), [.27, .23, .2]);
    return mg.geometry();
  }

  function buildClutter() {
    const R = K.clutterR, CS = K.clutterCell, P = K.pool, dens = K.density;
    const west = (x, z) => x < -150 && z < 40 && z > -220;
    const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), m = new THREE.Matrix4(), pv = new V3(), sv = new V3();
    const types = [
      { key: 'grass', geo: grassGeo(), mat: builtMat('grass', { vc: true, side: THREE.DoubleSide, fade: true, sway: true, snow: .12 }), max: P.grass,
        gen(r, x, z, out) {
          for (let t = 0; t < 26 * dens; t++) {
            const px = x + r() * CS, pz = z + r() * CS, h = C.getH(px, pz); if (h < 1.2 || h > 48) continue;
            const pn = C.fbm(px * .045 + 11, pz * .045 - 3, 3); if (r() > clamp((pn - .44) * 4, 0, 1)) continue;
            if (lakeD(px, pz) < 52 || C.riftD(px, pz) < 55 || C.normalY(px, pz) < .8 || C.nearPOI(px, pz, -6) || blocked(px, pz)) continue;
            const s = .35 + r() * .45; out(px, h - .03, pz, r() * TAU, 0, 0, s, s * (.8 + r() * .5), s, [.8 + r() * .35, .8 + r() * .3, .75 + r() * .3]);
          }
        } },
      { key: 'shrub', geo: shrubGeo(), mat: builtMat('shrub', { vc: true, side: THREE.DoubleSide, fade: true, sway: true, snow: .6 }), max: P.shrub,
        gen(r, x, z, out) {
          for (let t = 0; t < 6 * dens; t++) {
            const px = x + r() * CS, pz = z + r() * CS, h = C.getH(px, pz); if (h < 1.5 || h > 40) continue;
            const fo = C.fbm(px * .012 + 40, pz * .012, 3), sp = C.fbm(px * .02 - 7, pz * .02 + 5, 3);
            if (!((fo > .44 && fo < .6) || sp > .56) || r() > .55) continue;
            if (lakeD(px, pz) < 52 || C.riftD(px, pz) < 60 || C.normalY(px, pz) < .85 || C.nearPOI(px, pz, -6) || blocked(px, pz)) continue;
            const s = .7 + r() * .7; out(px, h - .05, pz, r() * TAU, (r() - .5) * .2, (r() - .5) * .2, s, s * (.8 + r() * .4), s, [.8 + r() * .4, .85 + r() * .3, .85 + r() * .3]);
          }
        } },
      { key: 'stone', geo: stoneGeo(), mat: stoneMat('stone', { fade: true, rockS: .5 }), max: P.stone,
        gen(r, x, z, out) {
          for (let t = 0; t < 12 * dens; t++) {
            const px = x + r() * CS, pz = z + r() * CS, h = C.getH(px, pz); if (h < .25) continue;
            const ny = C.normalY(px, pz); if (ny < .45) continue;
            const p = .1 + (1 - ny) * 1.4 + (pz < -120 ? .15 : 0) + (h < 3 ? .25 : 0); if (r() > p) continue;
            if (lakeD(px, pz) < 50 || C.riftD(px, pz) < 50 || C.nearPOI(px, pz, -6) || blocked(px, pz)) continue;
            if (r() < .3 && ny > .85) { const s = .5 + r() * .7; out(px, h - .05, pz, r() * TAU, 0, 0, s * 1.3, s * (.18 + r() * .12), s, [1.05, 1.05, 1.05]); }   // snow pillow
            else { const s = .12 + r() * r() * .55; out(px, h - s * .2, pz, r() * TAU, (r() - .5) * .5, (r() - .5) * .5, s, s * (.6 + r() * .5), s * (.8 + r() * .4), [.8 + r() * .3, .82 + r() * .3, .85 + r() * .3]); }
          }
        } },
      { key: 'shard', geo: shardGeo(), mat: iceMat('shard', { fade: true, attr: false, flat: true }), max: P.shard,
        gen(r, x, z, out) {
          for (let t = 0; t < 5 * dens; t++) {
            const px = x + r() * CS, pz = z + r() * CS, h = C.getH(px, pz), rd = C.riftD(px, pz), ld = lakeD(px, pz);
            const coast = h > -2.5 && h < 1.2 && Math.hypot(px, pz) < 440, rim = rd > 50 && rd < 72, lake = ld > 46 && ld < 57;
            if (!(coast || rim || lake) || r() > .55 || C.nearPOI(px, pz, -12) || blocked(px, pz)) continue;
            const s = .4 + r() * 1.1; out(px, Math.max(h, 0) - .1, pz, r() * TAU, (r() - .5) * .5, (r() - .5) * .5, s, s * (.7 + r() * .6), s, [1, 1, 1]);
          }
        } },
      { key: 'wood', geo: woodGeo(), mat: builtMat('wood', { vc: true, fade: true }), max: P.wood, cast: true,
        gen(r, x, z, out) {
          for (let t = 0; t < 4 * dens; t++) {
            const px = x + r() * CS, pz = z + r() * CS, h = C.getH(px, pz); if (h < 2.5 || h > 58 || west(px, pz)) continue;
            if (C.fbm(px * .012 + 40, pz * .012, 3) < .53 || r() > .4 || C.normalY(px, pz) < .84 || C.nearPOI(px, pz, -4) || C.inRift(px, pz, 5) || blocked(px, pz)) continue;
            if (r() < .6) {   // fallen log following the slope
              const L = 2 + r() * 3.5, yaw = r() * TAU, rad = .14 + r() * .14, ex = px + Math.sin(yaw) * L, ez = pz + Math.cos(yaw) * L, h2 = C.getH(ex, ez);
              const pitch = Math.atan2(h2 - h, L);
              out(px, h + rad * .5, pz, yaw, Math.PI / 2 - pitch, 0, rad, L, rad, [.85 + r() * .3, .85 + r() * .25, .85 + r() * .2]);
            } else { const rad = .2 + r() * .15; out(px, h - .08, pz, r() * TAU, (r() - .5) * .12, (r() - .5) * .12, rad, .25 + r() * .5, rad, [.9 + r() * .2, .9 + r() * .2, .9 + r() * .2]); }
          }
        } },
    ];
    for (const T of types) {
      T.im = new THREE.InstancedMesh(T.geo, T.mat, T.max);
      T.im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(T.max * 3), 3);
      T.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); T.im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      T.im.count = 0;
      addMesh('clutter_' + T.key, T.im, null, { recv: true, cast: !!T.cast, noCull: true });
      S.stats.tris['clutter_' + T.key] = triCount(T.geo, T.max);
    }
    const cells = S.cells = new Map();
    function cell(i, j) {
      const key = i * 65536 + j; let c = cells.get(key); if (c) return c;
      c = []; const r = mulberry(ihash(i, j, 777) ^ K.seed);
      for (const T of types) {
        const mm = [], cc = [];
        T.gen(r, i * CS, j * CS, (x, y, z, ry, rx, rz, sx, sy, sz, col3) => {
          e.set(rx, ry, rz); q.setFromEuler(e); m.compose(pv.set(x, y, z), q, sv.set(sx, sy, sz)); for (let k = 0; k < 16; k++) mm.push(m.elements[k]); cc.push(lin(col3[0]), lin(col3[1]), lin(col3[2]));
        });
        c.push({ m: new Float32Array(mm), c: new Float32Array(cc), n: mm.length / 16 });
      }
      if (cells.size > 2500) cells.clear();
      cells.set(key, c); return c;
    }
    const has = (i, j) => cells.has(i * 65536 + j);
    S.clutter = {
      types, key: null, dirty: true, lastFill: -9, budget: 2,
      ring(cam, rad) {   // cells within rad of the camera, nearest first
        const ci = Math.floor(cam.x / CS), cj = Math.floor(cam.z / CS), rc = Math.ceil(rad / CS) + 1, list = [];
        for (let i = ci - rc; i <= ci + rc; i++) for (let j = cj - rc; j <= cj + rc; j++) {
          const d = Math.hypot((i + .5) * CS - cam.x, (j + .5) * CS - cam.z); if (d < rad + CS * .75) list.push([d, i, j]);
        }
        return list.sort((a, b) => a[0] - b[0]);
      },
      prime(cam) { for (const [, i, j] of this.ring(cam, R)) cell(i, j); this.key = null; },
      update(cam, now) {
        if (!this.last || Math.hypot(cam.x - this.last.x, cam.z - this.last.z) > 60) { this.prime(cam); this.dirty = true; this.lastFill = -9; }   // first frame / teleport: fill synchronously
        this.last = { x: cam.x, z: cam.z };
        const ci = Math.floor(cam.x / CS), cj = Math.floor(cam.z / CS), key = ci * 65536 + cj;
        if (key !== this.key) { this.key = key; this.dirty = true; this.pending = this.ring(cam, R + CS * 2).filter(([, i, j]) => !has(i, j)); }
        // amortised generation: a couple of new cells per frame, prefetched 2 cells beyond the visible radius
        if (this.pending && this.pending.length) {
          for (let k = 0; k < this.budget && this.pending.length; k++) { const [d, i, j] = this.pending.shift(); if (!has(i, j)) { cell(i, j); if (d < R + CS) this.dirty = true; } }
        }
        if (!this.dirty || now - this.lastFill < .2) return;
        this.dirty = false; this.lastFill = now;
        const fill = types.map(() => 0);
        for (const [, i, j] of this.ring(cam, R)) {
          if (!has(i, j)) continue;
          const c = cell(i, j);
          types.forEach((T, t) => {
            const src = c[t], room = T.max - fill[t]; if (!src.n || room <= 0) return;
            const n = Math.min(src.n, room);
            T.im.instanceMatrix.array.set(n === src.n ? src.m : src.m.subarray(0, n * 16), fill[t] * 16);
            T.im.instanceColor.array.set(n === src.n ? src.c : src.c.subarray(0, n * 3), fill[t] * 3);
            fill[t] += n;
          });
        }
        types.forEach((T, t) => {
          T.im.count = fill[t];
          T.im.instanceMatrix.clearUpdateRanges(); T.im.instanceMatrix.addUpdateRange(0, fill[t] * 16); T.im.instanceMatrix.needsUpdate = true;
          T.im.instanceColor.clearUpdateRanges(); T.im.instanceColor.addUpdateRange(0, fill[t] * 3); T.im.instanceColor.needsUpdate = true;
          S.stats.instances[T.key] = fill[t];
        });
      },
    };
    S.clutter.prime(C.camera.position);
  }

  /* ================================================================ */
  /* 4. ATMOSPHERE: mist sheets, snow gusts, cloud deck                 */
  /* ================================================================ */
  function buildMist() {
    const pos = [], dep = [], kk = [], idx = [];
    const sheet = (cx, cz, size, n, y0, k, radial) => {   // horizontal grid; aD = height above ground; aK = strength with soft edges
      const b = pos.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const u = i / n - .5, v = j / n - .5, x = cx + u * size, z = cz + v * size, e = radial ? Math.max(0, 1 - Math.hypot(u, v) * 2) : 1;
        pos.push(x, y0, z); dep.push(y0 - Math.max(C.getH(x, z), 0)); kk.push(k * e * e * (3 - 2 * e));
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = b + j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
    };
    // valley patches: lowest points relative to their surroundings
    const cand = [];
    for (let x = -330; x <= 330; x += 26) for (let z = -330; z <= 330; z += 26) {
      const h = C.getH(x, z); if (h < 1.5 || C.inRift(x, z, -30)) continue;
      let avg = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; avg += C.getH(x + Math.cos(a) * 45, z + Math.sin(a) * 45); }
      cand.push({ x, z, h, rel: h - avg / 8 });
    }
    cand.sort((a, b) => a.rel - b.rel);
    const chosen = [];
    for (const c of cand) { if (chosen.length >= K.mistPatches) break; if (chosen.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 60)) continue; chosen.push(c); }
    for (const c of chosen) { sheet(c.x, c.z, 80, 14, c.h + 2.2, .5, true); sheet(c.x + 6, c.z - 4, 70, 10, c.h + 4.2, .3, true); }
    const lk = C.POI.lake, lh = lk.h !== undefined ? lk.h : C.getH(lk.x, lk.z);
    sheet(lk.x, lk.z, 120, 16, lh + 1.6, .55, true);
    const rf = C.POI.rift; sheet(rf.x, rf.z, 130, 16, (rf.h || 5) + 3, .35, true);
    // sea ring: two annuli fading in from the coast
    const ring = (y0, r0, r1, k) => {
      const b = pos.length / 3, NA = 150, NR = 18;
      for (let j = 0; j <= NR; j++) for (let i = 0; i < NA; i++) {
        const a = i / NA * TAU, t = j / NR, r = lerp(r0, r1, Math.pow(t, 1.4)), x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, y0, z); dep.push(y0 - Math.max(C.getH(x, z), 0)); kk.push(k * smooth(0, .12, t) * (1 - smooth(.8, 1, t)) * (.6 + .4 * t));
      }
      for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const i1 = (i + 1) % NA, a = b + j * NA + i, c = b + j * NA + i1, d = b + (j + 1) * NA + i, e2 = b + (j + 1) * NA + i1; idx.push(a, d, c, c, d, e2); }
    };
    ring(1.6, 300, 1250, .55); ring(4.8, 360, 1250, .3);
    // frost smoke over the widest open leads
    for (const pts of S.leadSmoke || []) for (let i = 0; i < pts.length; i += 3) { const p = pts[i]; if (Math.hypot(p.x, p.z) < 1000) sheet(p.x, p.z, 10 + p.w * 4, 3, 1.3, .7, true); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aD', new THREE.Float32BufferAttribute(dep, 1)); geo.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
    geo.setIndex(idx); geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), pickU('uWfT', 'uWfStorm', 'uWfWind', 'uWfMoon', 'uWfAur', 'uWfAurI')),
      fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float aD; attribute float aK; varying float vA; varying vec3 vW; ${GL_FOGV}
        void main(){ vW = position; vA = aK * smoothstep(0., 1.6, aD) * (1. - smoothstep(9., 16., aD) * .6);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uWfT, uWfStorm, uWfAurI; uniform vec2 uWfWind; uniform vec3 uWfMoon, uWfAur; varying float vA; varying vec3 vW;
        #include <fog_pars_fragment>
        ${GL_NOISE}
        void main(){
          vec2 w = uWfWind * uWfT * (1.2 + uWfStorm * 5.);
          float n = wff(vW.xz * .03 - w * .03), n2 = wff(vW.xz * .085 - w * .07 + 3.1);
          float d = smoothstep(.3, .78, n * .7 + n2 * .45);
          vec3 V = cameraPosition - vW; float cd = length(V); V /= cd;
          float a = vA * d * smoothstep(3., 20., cd) * mix(1.7, .55, abs(V.y));
          vec3 col = wfLin(vec3(.36, .45, .64) * (.8 + .45 * n2)) + uWfAur * uWfAurI * .05;
          gl_FragColor = vec4(col, clamp(a * (1. - uWfStorm * .5), 0., .8));
          #include <fog_fragment>
        }`,
    });
    addMesh('mist', geo, mat, { order: 2 });
    S.stats.tris.mist = triCount(geo);
  }

  function heightTex() {
    const N = 256, W = C.W, data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + .5) / N * W - W / 2, z = (j + .5) / N * W - W / 2, h = Math.max(C.getH(x, z), 0);
      const e = Math.round(clamp((h + 10) / 250, 0, 1) * 65535), o = (j * N + i) * 4;
      data[o] = e >> 8; data[o + 1] = e & 255; data[o + 2] = 0; data[o + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  }
  function buildGusts() {
    const base = new THREE.PlaneGeometry(1, 1), geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
    const n = K.gustN, sd = new Float32Array(n * 4), r = mulberry(K.seed ^ 55);
    for (let i = 0; i < n * 4; i++) sd[i] = r();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 4)); geo.instanceCount = n;
    U.tWfH = { value: heightTex() }; U.uWfHW = { value: C.W }; U.uWfGR = { value: K.gustR };
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), pickU('uWfT', 'uWfStorm', 'uWfWind', 'tWfH', 'uWfHW', 'uWfGR')),
      fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 aSeed; uniform float uWfT, uWfStorm, uWfHW, uWfGR; uniform vec2 uWfWind; uniform sampler2D tWfH;
        varying float vA; varying vec2 vUv; ${GL_FOGV}
        ${GL_NOISE}
        float dh(vec2 c){ vec4 t = texture2D(tWfH, c); return (t.r * 255. * 256. + t.g * 255.) / 65535. * 250. - 10.; }
        float gH(vec2 xz){ vec2 g = (xz + uWfHW * .5) / uWfHW * 256. - .5; vec2 i = floor(g), f = g - i;
          float a = dh((i + .5) / 256.), b = dh((i + vec2(1.5, .5)) / 256.), c = dh((i + vec2(.5, 1.5)) / 256.), d = dh((i + 1.5) / 256.);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        void main(){
          float R = uWfGR, spd = (6. + uWfStorm * 16.) * (.7 + aSeed.z * .6);
          vec2 p = (aSeed.xy * 2. - 1.) * R + uWfWind * uWfT * spd;
          vec2 rel = mod(p - cameraPosition.xz + R, 2. * R) - R; vec2 wp = cameraPosition.xz + rel;
          float life = fract(uWfT * (.3 + aSeed.z * .35) + aSeed.w * 7.);
          float gust = mix(smoothstep(.42, .78, wfn(wp * .02 - uWfWind * uWfT * .12)), 1., uWfStorm);
          float hgt = .12 + aSeed.w * aSeed.w * (1.1 + uWfStorm * 2.) + sin(uWfT * 2. + aSeed.x * 40.) * .08;
          vec3 c = vec3(wp.x, max(gH(wp), 0.) + hgt, wp.y);
          vec3 dir = normalize(vec3(uWfWind.x, (aSeed.y - .5) * .15, uWfWind.y)), toC = normalize(cameraPosition - c);
          vec3 side = normalize(cross(dir, toC));
          float len = (.7 + aSeed.z * 1.6) * (.6 + uWfStorm * 1.6), wid = .025 + .02 * aSeed.w;
          vec3 pos = c + dir * position.x * len + side * position.y * wid;
          vA = sin(life * 3.14159) * (1. - smoothstep(R * .6, R, length(rel))) * gust * (.22 + uWfStorm * .8);
          vUv = uv;
          vec4 mvPosition = viewMatrix * vec4(pos, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vA; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          float a = vA * pow(1. - abs(vUv.x * 2. - 1.), 1.5) * (1. - abs(vUv.y * 2. - 1.));
          gl_FragColor = vec4(vec3(.35, .46, .72) * a, 1.);
          #if defined(USE_FOG) && !defined(FOG_EXP2)
            gl_FragColor.rgb *= 1. - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
        }`,
    });
    const mesh = addMesh('gusts', geo, mat, { noCull: true, order: 3 });
    S.stats.tris.gusts = triCount(base, n);
    return mesh;
  }
  function buildClouds() {
    const geo = new THREE.CircleGeometry(2300, 96); geo.rotateX(-Math.PI / 2); geo.translate(0, 440, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: pickU('uWfT', 'uWfStorm', 'uWfWind', 'uWfFog', 'uWfAur', 'uWfAurI', 'uWfMoon'),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `uniform float uWfT, uWfStorm, uWfAurI; uniform vec2 uWfWind; uniform vec3 uWfFog, uWfAur, uWfMoon; varying vec3 vW;
        ${GL_NOISE}
        void main(){
          vec2 p = vW.xz * .0011 + uWfWind * uWfT * .004;
          float n = wff(p) * .65 + wff(p * 2.7 + 5.) * .35;
          float cov = mix(.53, .36, uWfStorm);
          float d = smoothstep(cov, cov + .2, n);
          float edge = 1. - smoothstep(1500., 2250., length(vW.xz));
          vec3 V = normalize(vW - cameraPosition);
          vec3 col = mix(vec3(.16, .2, .3), vec3(.045, .06, .1), smoothstep(cov + .05, cov + .4, n));
          col += vec3(.2, .24, .34) * pow(max(dot(V, uWfMoon), 0.), 6.) * (1. - d * .5);
          col += uWfAur * uWfAurI * .05 * d;
          col = mix(wfLin(col), uWfFog * 1.1, smoothstep(.35, .06, V.y));
          gl_FragColor = vec4(col, d * edge * .78);
        }`,
    });
    addMesh('clouds', geo, mat, { order: -4 });
    S.stats.tris.clouds = triCount(geo);
  }

  /* ================================================================ */
  /* 6. BIRDS: circling flocks (GPU) + perched ravens (CPU)             */
  /* ================================================================ */
  function buildBirds() {
    const p = [];
    const tri = (a, b, c) => p.push(...a, ...b, ...c);
    const nose = [0, .01, .42], tail = [0, 0, -.32], L = [-.07, .03, .05], Rr = [.07, .03, .05], belly = [0, -.06, .05];
    tri(nose, Rr, tail); tri(nose, tail, L); tri(nose, belly, Rr); tri(nose, L, belly); tri(belly, tail, Rr); tri(belly, L, tail);
    tri([0, 0, -.28], [.13, 0, -.56], [-.13, 0, -.56]);
    for (const s of [-1, 1]) {
      const sF = [s * .06, 0, .14], sB = [s * .06, 0, -.1], eF = [s * .5, 0, .12], eB = [s * .48, 0, -.14], tp = [s * .98, 0, -.1], tB = [s * .85, 0, -.22];
      tri(sF, eF, sB); tri(sB, eF, eB); tri(eF, tp, eB); tri(eB, tp, tB);
    }
    const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const nF = K.birds.flocks * K.birds.perFlock, nR = Math.min(K.birds.ravens, S.perches.length), n = nF + nR;
    const geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('position', base.attributes.position); geo.instanceCount = n;
    const aP = new Float32Array(n * 4), aO = new Float32Array(n * 4), aF = new Float32Array(n * 4);
    const centres = [[0, 0], [C.POI.station.x, C.POI.station.z], [-250, 60], [120, -220], [520, 380], [-600, -300]];
    for (let f = 0; f < K.birds.flocks; f++) {
      const c = centres[f % centres.length], cy = rr(70, 150), R = rr(45, 110), spd = (rnd() < .5 ? 1 : -1) * rr(7, 11) / R, ph = rr(0, TAU);
      for (let b = 0; b < K.birds.perFlock; b++) {
        const i = f * K.birds.perFlock + b;
        aP.set([c[0] + rr(-8, 8), cy + rr(-6, 6), c[1] + rr(-8, 8), 0], i * 4);
        aO.set([R + rr(-10, 10), spd * rr(.9, 1.1), ph + rr(-.35, .35), 1], i * 4);
        aF.set([rr(9, 12), 0, rr(1.6, 2.2), 0], i * 4);
      }
    }
    const ravens = [];
    for (let k = 0; k < nR; k++) {
      const i = nF + k, home = S.perches[Math.floor(k * S.perches.length / nR)].clone();
      aP.set([home.x, home.y, home.z, rr(0, TAU)], i * 4); aO.set([0, 0, rr(0, TAU), 0], i * 4); aF.set([rr(10, 13), 1, rr(.8, 1), 0], i * 4);
      ravens.push({ i, home, pos: home.clone(), vel: new V3(), st: 0, t: 0, yaw: aP[i * 4 + 3], fold: 1, flap: 0, ang: rr(0, TAU), look: rr(0, 5) });
    }
    const AP = new THREE.InstancedBufferAttribute(aP, 4), AF = new THREE.InstancedBufferAttribute(aF, 4);
    AP.setUsage(THREE.DynamicDrawUsage); AF.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', AP); geo.setAttribute('aO', new THREE.InstancedBufferAttribute(aO, 4)); geo.setAttribute('aF', AF);
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), pickU('uWfT', 'uWfMoon')),
      fog: true, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aP, aO, aF; uniform float uWfT; varying float vShade; ${GL_FOGV}
        ${GL_NOISE}
        void main(){
          vec3 c = aP.xyz; float yaw = aP.w, bank = 0., flapAmt = aF.w;
          if (aO.w > .5) {
            float ang = aO.z + uWfT * aO.y;
            c += vec3(cos(ang) * aO.x, sin(ang * 2. + aO.z) * 4. + sin(uWfT * .3 + aO.z * 3.) * 3., sin(ang) * aO.x);
            vec2 tg = vec2(-sin(ang), cos(ang)) * sign(aO.y);
            yaw = atan(tg.x, tg.y); bank = -sign(aO.y) * .35;
            flapAmt = smoothstep(.5, .72, wfn(vec2(uWfT * .25 + aO.z * 5., aO.z * 3.)));
          }
          vec3 p = position; float ax = abs(p.x), sg = sign(p.x);
          p.x = sg * ax * mix(1., .26, aF.y); p.z -= aF.y * ax * .4;
          float ph = uWfT * aF.x + aO.z * 20.;
          float fl = mix(.12, sin(ph) * .85 + .1, flapAmt) * (1. - aF.y);
          float an = fl * (1. + .45 * smoothstep(.4, 1., ax));
          p = vec3(sg * abs(p.x) * cos(an), p.y + abs(p.x) * sin(an), p.z);
          p = vec3(p.x * cos(bank) - p.y * sin(bank), p.x * sin(bank) + p.y * cos(bank), p.z);
          p *= aF.z;
          vec3 w = vec3(p.x * cos(yaw) + p.z * sin(yaw), p.y, -p.x * sin(yaw) + p.z * cos(yaw)) + c;
          vShade = .7 + .3 * abs(sin(an));
          vec4 mvPosition = viewMatrix * vec4(w, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vShade;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(vec3(.0015, .0018, .0027) * vShade, 1.);
          #include <fog_fragment>
        }`,
    });
    addMesh('birds', geo, mat, { noCull: true });
    S.stats.tris.birds = triCount(base, n);
    S.ravens = { list: ravens, AP, AF };
  }
  const _rv = {};
  function updateRavens(dt, cam) {
    const R = S.ravens; if (!R || !R.list.length) return;
    const t = C.T(), scare = K.birds.scare, focus = (C.player && C.player()) || cam;
    for (const b of R.list) {
      const d = Math.hypot(focus.x - b.home.x, focus.z - b.home.z);
      if (b.st === 0) {
        b.flap = 0; b.fold = Math.min(1, b.fold + dt * 3);
        if (t > b.look) { b.yaw += rr(-.9, .9); b.look = t + rr(1.5, 5); }
        if (d < scare) { b.st = 1; b.t = 0; const ax = b.pos.x - focus.x, az = b.pos.z - focus.z, l = Math.hypot(ax, az) || 1; b.vel.set(ax / l * 5, 5.5, az / l * 5); }
      } else if (b.st === 1) {
        b.t += dt; b.fold = Math.max(0, b.fold - dt * 6); b.flap = 1; b.vel.y = lerp(b.vel.y, 3.5, dt); b.pos.addScaledVector(b.vel, dt);
        if (b.t > 2.2) { b.st = 2; b.t = 0; b.ang = Math.atan2(b.pos.z - b.home.z, b.pos.x - b.home.x); }
      } else if (b.st === 2) {
        b.t += dt; b.ang += dt * .42;
        const tx = b.home.x + Math.cos(b.ang) * 24, ty = b.home.y + 20 + Math.sin(b.t * .5) * 3, tz = b.home.z + Math.sin(b.ang) * 24;
        const k = 1 - Math.exp(-dt * 1.5); b.vel.x = lerp(b.vel.x, (tx - b.pos.x) * 1.2, k); b.vel.y = lerp(b.vel.y, (ty - b.pos.y) * 1.2, k); b.vel.z = lerp(b.vel.z, (tz - b.pos.z) * 1.2, k);
        const sp = b.vel.length(); if (sp > 10) b.vel.multiplyScalar(10 / sp);
        b.pos.addScaledVector(b.vel, dt); b.flap = b.vel.y > .6 ? 1 : .25 + .2 * Math.sin(b.t);
        if (b.t > 16 && d > scare * 2.2) b.st = 3;
      } else {
        const tx = b.home.x - b.pos.x, ty = b.home.y - b.pos.y, tz = b.home.z - b.pos.z, l = Math.hypot(tx, ty, tz), sp = Math.min(8, l * 1.4 + .3), k = 1 - Math.exp(-dt * 3);
        b.vel.x = lerp(b.vel.x, tx / (l || 1) * sp, k); b.vel.y = lerp(b.vel.y, ty / (l || 1) * sp, k); b.vel.z = lerp(b.vel.z, tz / (l || 1) * sp, k);
        b.pos.addScaledVector(b.vel, dt); b.flap = l < 3 ? 1 : .5; b.fold = Math.max(0, b.fold - dt * 4);
        if (l < .3) { b.st = 0; b.pos.copy(b.home); b.vel.set(0, 0, 0); }
        else if (d < scare) { b.st = 1; b.t = 0; b.vel.y = 5; }
      }
      if (b.st && Math.hypot(b.vel.x, b.vel.z) > .3) { const want = Math.atan2(b.vel.x, b.vel.z); let dy = want - b.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU; b.yaw += dy * Math.min(1, dt * 6); }
      const o = b.i * 4; R.AP.array[o] = b.pos.x; R.AP.array[o + 1] = b.pos.y + (b.st ? 0 : .06); R.AP.array[o + 2] = b.pos.z; R.AP.array[o + 3] = b.yaw;
      R.AF.array[o + 1] = b.fold; R.AF.array[o + 3] = b.flap;
    }
    R.AP.needsUpdate = true; R.AF.needsUpdate = true;
  }

  /* ================================================================ */
  /* build / update                                                     */
  /* ================================================================ */
  function build(ctx, knobs) {
    if (S.ready) { console.warn('[WorldFill] already built'); return S.stats; }
    if (knobs) for (const k in knobs) { if (K[k] && typeof K[k] === 'object' && !Array.isArray(K[k])) Object.assign(K[k], knobs[k]); else K[k] = knobs[k]; }
    C = ctx; THREE = ctx.THREE || window.THREE; V3 = THREE.Vector3;
    const need = ['scene', 'camera', 'getH', 'normalY', 'W', 'POI', 'riftD', 'nearPOI', 'inRift', 'fbm', 'vnoise', 'ridge', 'register', 'T'];
    const miss = need.filter((k) => ctx[k] === undefined); if (miss.length) throw new Error('[WorldFill] ctx missing: ' + miss.join(', '));
    if (!ctx.storm) ctx.storm = () => 0;
    const t0 = performance.now();
    rnd = mulberry(K.seed); UP = new V3(0, 1, 0); ONE = new V3(1, 1, 1);
    _tmp.v = new V3(); _tmp.n = new V3(); _tmp.nm = new THREE.Matrix3();
    S.calls = 0; S.shadowCalls = 0;
    makeUniforms();
    const NI = (g) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; };
    G = {
      box: NI(new THREE.BoxGeometry(1, 1, 1)), cyl3: NI(new THREE.CylinderGeometry(1, 1, 1, 3, 1, true)), cyl6: NI(new THREE.CylinderGeometry(1, 1, 1, 6, 1, false)),
      cyl8: NI(new THREE.CylinderGeometry(1, 1, 1, 8, 1, false)), cyl10: NI(new THREE.CylinderGeometry(1, 1, 1, 10, 1, false)), cylT: NI(new THREE.CylinderGeometry(.72, 1, 1, 8, 1, false)),
      cone4: NI(new THREE.ConeGeometry(1, 1, 4, 1, true)), cone5: NI(new THREE.ConeGeometry(1, 1, 5, 1, true)), ico0: NI(new THREE.IcosahedronGeometry(1, 0)),
      hemi: NI(new THREE.SphereGeometry(1, 10, 4, 0, TAU, 0, Math.PI / 2)),
    };
    G.chip = chipBlock(.085); G.chipL = jitterGeo(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), .22, 5); G.chip0 = jitterGeo(new THREE.IcosahedronGeometry(1, 0), .25, 3);
    MG.ice = new Merge({ aIce: 1 }, true); MG.built = new Merge({ aAux: 3 }, true); MG.stone = new Merge({ aRock: 1 }, true);
    const P = ctx.POI;
    S.routes = [[P.crash, P.station], [P.crash, P.lake], [P.lake, P.spireW], [P.station, P.spireE], [P.station, P.spireN],
      [P.crash, { x: lerp(P.crash.x, P.rift.x, .62), z: lerp(P.crash.z, P.rift.z, .62) }]].filter((r) => r.every((p) => p && p.x !== undefined));
    const step = (name, fn) => { const a = performance.now(); try { fn(); } catch (e) { console.error('[WorldFill] ' + name + ' failed', e); } S.stats.ms = S.stats.ms || {}; S.stats.ms[name] = Math.round(performance.now() - a); };
    if (K.mountains) step('mountains', buildMountains);
    if (K.sites) {
      let camp = null;
      step('camp', () => { camp = buildCamp(); S.camp = camp; });
      step('poles', () => buildPoles(camp));
      step('ship', buildShip);
      step('pier', buildPier);
      step('ruins', () => { S.ruins = buildRuins(); });
      step('cairns', buildCairns);
      step('flags', buildFlags);
    }
    if (K.seaIce) step('seaIce', buildSeaIce);
    if (K.leads) step('leads', buildLeads);
    // finalize merged meshes
    if (MG.ice.tris()) { const g = MG.ice.geometry(); addMesh('seaIce', g, iceMat('seaice', { vc: true, attr: true }), { recv: true }); S.stats.tris.seaIce = triCount(g); }
    if (MG.stone.tris()) { const g = MG.stone.geometry(); addMesh('stone', g, stoneMat('stonesites', { vc: true, rockS: .3 }), { recv: true, cast: true }); S.stats.tris.stone = triCount(g); }
    if (MG.built.tris()) { const g = MG.built.geometry(); const m = builtMat('built', { vc: true, aux: true, side: THREE.DoubleSide }); m.roughness = .78; addMesh('built', g, m, { recv: true, cast: true }); S.stats.tris.built = triCount(g); }
    MG.ice = MG.built = MG.stone = null;
    if (K.clutter) step('clutter', buildClutter);
    if (K.mist) step('mist', buildMist);
    if (K.gusts) step('gusts', buildGusts);
    if (K.clouds) step('clouds', buildClouds);
    if (K.birds) step('birds', buildBirds);
    for (const k in G) G[k].dispose && G[k].dispose();
    S.ready = true;
    const tris = Object.values(S.stats.tris).reduce((a, b) => a + b, 0);
    Object.assign(S.stats, { trisTotal: tris, calls: S.calls, shadowCalls: S.shadowCalls, buildMs: Math.round(performance.now() - t0), perches: S.perches.length, camp: S.camp, ship: S.ship, ruins: S.ruins, pier: S.pier });
    if (K.log) console.info(`[WorldFill] built in ${S.stats.buildMs} ms — ${tris.toLocaleString()} tris max (all systems, clutter pools full), ${S.calls} draw calls (+${S.shadowCalls} shadow)`, S.stats);
    return S.stats;
  }

  function update(dt, ctx) {
    if (!S.ready) return;
    if (ctx && ctx !== C) Object.assign(C, ctx);
    const t = C.T(), storm = C.storm() || 0;
    U.uWfT.value = t; U.uWfStorm.value = storm;
    if (C.aurora) { const a = C.aurora(); if (a) { if (a.color) U.uWfAur.value.copy(a.color); if (a.i !== undefined) U.uWfAurI.value = a.i; } }
    const cam = C.camera.position;
    if (S.clutter) S.clutter.update(cam, t);
    if (S.ravens) updateRavens(Math.min(dt, .05), cam);
  }

  // passable clutter (grass, shrubs) near x,z from the generated cells — Passport.providers hook for a later bending system
  function passablesNear(x, z, r, out = []) {
    if (!S.cells || !S.clutter) return out;
    const CS = K.clutterCell;
    for (let i = Math.floor((x - r) / CS); i <= Math.floor((x + r) / CS); i++) for (let j = Math.floor((z - r) / CS); j <= Math.floor((z + r) / CS); j++) {
      const c = S.cells.get(i * 65536 + j); if (!c) continue;
      for (const t of [0, 1]) { const src = c[t], kind = S.clutter.types[t].key;
        for (let k = 0; k < src.n; k++) { const e = src.m, o = k * 16, px = e[o + 12], pz = e[o + 14], sc = Math.hypot(e[o], e[o + 1], e[o + 2]);
          if ((px - x) ** 2 + (pz - z) ** 2 < (r + sc) ** 2) out.push({ x: px, z: pz, r: sc * (t ? .45 : .25), h: sc * (t ? .7 : .9), kind }); } }
    }
    return out;
  }
  window.WorldFill = { build, update, passablesNear, knobs: K, get stats() { return S.stats; }, get slots() { return S.slots; } };
})();
