/* Module "structures" — one realistic style for everything man-made or crystalline (wave 2, see STRUCTURES.md).
 *
 * Replaces the primitive-built objects with the incoming2 models (assets/pack/*.js):
 *   station      struct_station_dome + struct_station_module (+ crate stack, drums) inside WORLD.station
 *   WorldFill    slots (camp, poles, pier, ruins, cairns) → tents, sledge, snowcat, crates/drums, scanned poles,
 *                pier + rowboat, stone arch/column/wall, cairn/inuksuk — each fitted to the ground (≤ 20°)
 *   echo ruins   ruin model + rune decal, moved to the nearest ground ≤ 20° (WORLD.echoes[i].g / pos)
 *   spires       crystal_spire on its plinth + broken-column altar (keeps ring/beam/light/part logic)
 *   rift         crystal_cluster_ground instances (rift crystals, crystal trees) + large rim clusters, rift_heart
 *   pickups      crystal_shard_pickup (amber)
 *   shardlings   enemy_shardling (Idle/Move/Attack/Hit/Death) via STRUCT.shardling() / STRUCT.dying()
 *   boss         boss_crystal_golem (14 clips) → boss.anim / boss.onDeath hooks in updateBoss/bossHit
 *   skimmer      vehicle_snowmobile: skis follow the ground + steer, track scrolls, rider seat → sk.seat
 * Colliders only through Passport (solid / trunk / pushable). Snow on up-facing surfaces: ctx.snowCover(material)
 * when the terrain module provides it, otherwise the light top-snow patch below.
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  let C = null, THREE = null, V3 = null;
  const ST = window.STRUCT = { stats: { placed: {}, moved: [], warn: [], ms: 0 }, ready: {} };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  let seed = 90127; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rr = (a, b) => a + rnd() * (b - a);
  const count = (k, n = 1) => { ST.stats.placed[k] = (ST.stats.placed[k] || 0) + n; };
  const warn = (...a) => { ST.stats.warn.push(a.join(' ')); console.warn('[struct]', ...a); };

  /* ============================ loading ============================ */
  const cache = {}, waiting = {};
  function need(name, cb) {
    if (cache[name]) { cb(cache[name]); return; }
    if (waiting[name]) { waiting[name].push(cb); return; }
    waiting[name] = [cb];
    C.loadPacked(name, C.ASSET, (g) => {
      ST.albedoFloor(g.scene);
      cache[name] = g; const list = waiting[name]; delete waiting[name];
      for (const f of list) { try { f(g); } catch (e) { console.error('[struct] ' + name, e); ST.stats.warn.push(name + ': ' + e.message); } }
    });
  }

  /* ============================ albedo floor (REALISM-QA rule 2) ============================
   * Nothing real is darker than ~0.04 linear albedo (black rubber / plastic / charcoal ≈ 0.04–0.05 → 56–62 sRGB); the packs
   * shipped seats, tyres, foam, grips and cables at 16–46 sRGB, which render as holes in the night frame. The base colour
   * is scaled up (hue and texture detail untouched) until map average × colour × vertex colour reaches ALB.min. */
  const ALB = { min: 0.042, done: new WeakSet(), log: [] };
  const alCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  function mapAvgLin(t) {
    if (!t) return [1, 1, 1];
    if (t.userData && t.userData.avgLin) return t.userData.avgLin;
    const img = t.image; if (!img || !(img.width || img.videoWidth) || !alCanvas) return null;
    try {
      alCanvas.width = alCanvas.height = 32; const g = alCanvas.getContext('2d', { willReadFrequently: true });
      g.clearRect(0, 0, 32, 32); g.drawImage(img, 0, 0, 32, 32); const d = g.getImageData(0, 0, 32, 32).data;
      const srgb = t.colorSpace === 'srgb', lin = (x) => { x /= 255; return !srgb ? x : x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      let r = 0, gg = 0, b = 0, w = 0; for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; r += lin(d[i]) * a; gg += lin(d[i + 1]) * a; b += lin(d[i + 2]) * a; w += a; }
      const out = w ? [r / w, gg / w, b / w] : null; if (out) t.userData.avgLin = out; return out;
    } catch (e) { return null; }
  }
  ST.albedoFloor = function (root, min = ALB.min) {
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of [].concat(o.material)) {
        if (!m || ALB.done.has(m) || !m.color || m.transparent || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
        if (m.emissive && m.emissiveIntensity > 0.5 && Math.max(m.emissive.r, m.emissive.g, m.emissive.b) > 0.2) continue;   // self-lit
        const t = mapAvgLin(m.map); if (!t) continue;
        let vc = [1, 1, 1]; const Cc = m.vertexColors && o.geometry && o.geometry.attributes.color;
        if (Cc) { vc = [0, 0, 0]; const st = Math.max(1, Math.floor(Cc.count / 2000)); let n = 0; for (let i = 0; i < Cc.count; i += st) { vc[0] += Cc.getX(i); vc[1] += Cc.getY(i); vc[2] += Cc.getZ(i); n++; } vc = vc.map((v) => v / n); }
        const L = 0.2126 * m.color.r * t[0] * vc[0] + 0.7152 * m.color.g * t[1] * vc[1] + 0.0722 * m.color.b * t[2] * vc[2];
        ALB.done.add(m);
        if (L >= min) continue;
        if (!(L > 1e-5)) { if (!m.map && !Cc) { m.color.setRGB(min, min, min); ALB.log.push({ mat: m.name, from: 0, k: 'grey' }); } continue; }
        const k = Math.min(12, min / L); m.color.multiplyScalar(k);
        ALB.log.push({ mat: m.name, from: +L.toFixed(4), k: +k.toFixed(2) });
      }
    });
    ST.stats.albedoFloor = ALB.log;
  };

  /* ============================ snow on top faces ============================ */
  const snowed = new WeakSet();
  const SNOW_VERT = `
{ vec4 stp = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  stp = instanceMatrix * stp;
#endif
  vStSnowP = (modelMatrix * stp).xyz; }`;
  const SNOW_FRAG = `
{ vec3 stN = inverseTransformDirection(normal, viewMatrix);
  vec2 q = vStSnowP.xz;
  float nz = stHash(floor(q * 3.1)) * .35 + stNoise(q * .9) * .65;
  float k = smoothstep(.5 + nz * .25, .78 + nz * .12, stN.y) * uStSnow;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.60, .66, .78), k);
  roughnessFactor = mix(roughnessFactor, .88, k); metalnessFactor = mix(metalnessFactor, 0., k); }`;
  const SNOW_FUN = `
varying vec3 vStSnowP; uniform float uStSnow;
float stHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float stNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(stHash(i), stHash(i + vec2(1., 0.)), u.x), mix(stHash(i + vec2(0., 1.)), stHash(i + vec2(1., 1.)), u.x), u.y); }`;
  function snowify(mat, amt = 1) {
    if (!mat || snowed.has(mat) || !mat.isMeshStandardMaterial || mat.transparent) return;
    snowed.add(mat);
    if (typeof C.snowCover === 'function') { try { C.snowCover(mat, amt); return; } catch (e) { warn('ctx.snowCover failed, using own snow', e.message); } }
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uStSnow = { value: amt };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStSnowP;').replace('#include <project_vertex>', '#include <project_vertex>' + SNOW_VERT);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + SNOW_FUN).replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + SNOW_FRAG);
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|stsnow' + amt; };
    mat.needsUpdate = true;
  }

  /* ============================ model → parts (one mesh per material) ============================ */
  const flatCache = {};
  // merge every static mesh of a glTF scene into one geometry per material (model space). Keeps draw calls to the
  // material count; the parts are then placed as Mesh (one) or InstancedMesh (many).
  function flatten(root, filter) {
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert(), by = new Map(), tmpM = new THREE.Matrix4();
    root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.visible) return;
      if (filter && !filter(o)) return;
      const g = o.geometry.clone(); g.applyMatrix4(tmpM.multiplyMatrices(inv, o.matrixWorld));
      if (tmpM.determinant() < 0 && g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } }
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!by.has(m)) by.set(m, []); by.get(m).push(g);
    });
    const parts = [], box = new THREE.Box3();
    for (const [mat, geos] of by) {
      const keep = ['position', 'normal', 'uv']; if (mat.vertexColors) keep.push('color');
      const nonIdx = geos.some((g) => !g.index);
      const list = geos.map((g0) => {
        const g = nonIdx && g0.index ? g0.toNonIndexed() : g0;
        for (const k of Object.keys(g.attributes)) {
          if (!keep.includes(k)) { g.deleteAttribute(k); continue; }
          const at = g.attributes[k];   // quantized / normalized glTF attributes → plain floats so every part merges
          if (!(at.array instanceof Float32Array) || at.normalized || at.isInterleavedBufferAttribute) {
            const f = new Float32Array(at.count * at.itemSize);
            for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) f[i * at.itemSize + c] = c === 0 ? at.getX(i) : c === 1 ? at.getY(i) : c === 2 ? at.getZ(i) : at.getW(i);
            g.setAttribute(k, new THREE.BufferAttribute(f, at.itemSize));
          }
        }
        g.morphAttributes = {};
        if (!g.attributes.normal) g.computeVertexNormals();
        const n = g.attributes.position.count;
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        if (mat.vertexColors && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        return g;
      });
      const geo = list.length === 1 ? list[0] : THREE.BufferGeometryUtils.mergeGeometries(list, false);
      if (!geo) { warn('merge failed', mat.name); continue; }
      geo.computeBoundingBox(); geo.computeBoundingSphere(); box.union(geo.boundingBox);
      parts.push({ geo, mat, name: mat.name || '' });
    }
    return { parts, box };
  }
  // real-world size fixes (CAMP.md, sizes against tools/qa/sizes.json): the blue HDPE drum pack is 0.49 m across — a 55-gal
  // drum is 0.58 m across at the same 0.88–0.93 m height
  const REAL = { prop_drum_plastic_blue: [1.18, 1, 1.18] };
  // REALISM-QA rule 5 (texel density): tiled Poly Haven wood/hessian textures (UV baked well past [0,1] — genuine
  // repeat, not one unwrap) at a repeat frequency meant for a much bigger surface than this 4 m sledge → 5271 px/m,
  // ×9–11 its neighbours. Same fix direction as any tiled material: fewer repeats over the same UV span = a coarser,
  // correctly-scaled weave/grain. Applied once, in `flat()`, to every map on the cached parts (shared by both the
  // camp and the station sledge — same pack, same fix).
  const TEX_REPEAT = { prop_sledge_loaded: 0.23, prop_rowboat: 0.1, struct_pier_wood: 3.5 };
  function flat(name, g, filter) {
    if (flatCache[name]) return flatCache[name];
    const F = flatCache[name] = flatten(g.scene, filter), k = REAL[name];
    if (k) { for (const p of F.parts) { p.geo.scale(k[0], k[1], k[2]); p.geo.computeBoundingBox(); p.geo.computeBoundingSphere(); } F.box.min.multiply(new V3(...k)); F.box.max.multiply(new V3(...k)); }
    const tr = TEX_REPEAT[name];
    if (tr) for (const p of F.parts) for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
      const t = p.mat && p.mat[slot]; if (t) { t.repeat.multiplyScalar(tr); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
    }
    return F;
  }
  const partsGroup = (parts, filter) => { const r = new THREE.Group(); for (const p of parts) if (!filter || filter(p)) r.add(new THREE.Mesh(p.geo, p.mat)); r.updateMatrixWorld(true); return r; };

  // put parts into the scene at one or many matrices; returns the meshes
  function spawn(F, mats, o = {}) {
    const out = [];
    for (const p of F.parts) {
      let m;
      if (mats.length === 1 && !o.instanced) { m = new THREE.Mesh(p.geo, p.mat); m.matrixAutoUpdate = false; m.matrix.copy(mats[0]); m.matrixWorldNeedsUpdate = true; }
      else { m = new THREE.InstancedMesh(p.geo, p.mat, mats.length); mats.forEach((M, i) => m.setMatrixAt(i, M)); m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.computeBoundingBox && m.computeBoundingBox(); }
      m.name = 'st_' + (o.name || 'model'); m.userData.struct = true; m.castShadow = o.cast !== false && !(p.mat.transparent && !p.mat.depthWrite); m.receiveShadow = true;
      (o.parent || C.scene).add(m); out.push(m);
    }
    return out;
  }
  // colliders: one Passport entry per placement, from the drawn parts (optionally without cords/ropes)
  function register(F, mats, role, o = {}) {
    const root = partsGroup(F.parts, o.colFilter);
    if (!root.children.length) return [];
    const opts = { name: o.name }; if (o.shape) opts.shape = o.shape; if (o.topFrac) opts.topFrac = o.topFrac;
    try { return [].concat(C.Passport.registerInstances(root, mats, role, opts)); } catch (e) { warn('register', o.name, e.message); return []; }
  }
  const noCords = (p) => !/cord|rope|guy/i.test(p.name);

  /* ============================ ground fitting ============================ */
  const H = (x, z) => C.groundH(x, z);
  // 3×3 samples over the rotated footprint: min/max/mean height, rise, steepest terrain slope under it
  function groundUnder(x, z, yaw, box, s = 1, shrink = 0.85) {
    const c = Math.cos(yaw), sn = Math.sin(yaw); let mn = 1e9, mx = -1e9, sum = 0, ny = 1, n = 0;
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
      const lx = (box.min.x + (box.max.x - box.min.x) * i / 2) * s * shrink, lz = (box.min.z + (box.max.z - box.min.z) * j / 2) * s * shrink;
      const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c, h = H(wx, wz);
      mn = Math.min(mn, h); mx = Math.max(mx, h); sum += h; n++; ny = Math.min(ny, C.normalY(wx, wz));
    }
    return { min: mn, max: mx, mean: sum / n, rise: mx - mn, slope: Math.acos(clamp(ny, -1, 1)) / D2R };
  }
  const taken = [];   // placed footprints (x, z, r) — keeps fitted objects apart
  const clear = (x, z, r) => taken.every((t) => Math.hypot(t[0] - x, t[1] - z) > t[2] + r);
  // nearest spot (spiral) whose footprint is on ground ≤ maxDeg with ≤ maxRise height spread; best effort otherwise
  function findSpot(x, z, yaw, box, s, o = {}) {
    const maxDeg = o.maxDeg ?? 20, maxRise = o.maxRise ?? 0.6, R = o.R ?? 16, step = o.step ?? 1.25, rad = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 * s;
    let best = null;
    for (let r = 0; r <= R + 1e-6; r += step) {
      const n = r ? Math.max(6, Math.round(TAU * r / step)) : 1, a0 = rnd() * TAU;
      for (let k = 0; k < n; k++) {
        const a = a0 + k / n * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if ((o.avoid && o.avoid(px, pz)) || (o.clear !== false && !clear(px, pz, rad * 0.8))) continue;
        const g = groundUnder(px, pz, yaw, box, s);
        if (g.min < (o.minH ?? 0.4)) continue;   // sea / lake ice
        const score = Math.max(0, g.slope - maxDeg) * 2 + Math.max(0, g.rise - maxRise) * 20 + r * 0.05;
        if (g.slope <= maxDeg && g.rise <= maxRise) return { x: px, z: pz, g, r, ok: true };
        if (!best || score < best.score) best = { x: px, z: pz, g, r, score, ok: false };
      }
    }
    return best;
  }
  // pitch/roll that lay a vehicle-like footprint onto the terrain
  function groundTilt(x, z, yaw, box, s, maxRad = 0.2) {
    const c = Math.cos(yaw), sn = Math.sin(yaw), L = (box.max.z - box.min.z) * s * 0.4, Wd = (box.max.x - box.min.x) * s * 0.4;
    const at = (lx, lz) => H(x + lx * c + lz * sn, z - lx * sn + lz * c);
    const pitch = Math.atan2(at(0, -L) - at(0, L), 2 * L), roll = Math.atan2(at(Wd, 0) - at(-Wd, 0), 2 * Wd);
    return [clamp(pitch, -maxRad, maxRad), clamp(roll, -maxRad, maxRad)];
  }
  const mat4 = (x, y, z, yaw, s = 1, rx = 0, rz = 0, sy) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), new V3(s, sy ?? s, s));

  const CAMP = window.createStructuresCamp({ ST, need, flat, count, snowify, TAU, H, spawn, mat4, rr, register, noCords, warn, partsGroup, groundUnder, taken, clamp, findSpot, groundTilt });   // structures-camp.js
  const { buildStation, pushable, buildSlots, fitLog } = CAMP;
  const LAND = window.createStructuresLandmarks({ need, flat, count, rr, spawn, snowify, TAU, warn, mat4, register, findSpot, taken, ST, fitLog, H, groundTilt });   // structures-landmarks.js
  const { buildSpires, buildShards, buildRift, buildEchoes } = LAND;
  const CREAT = window.createStructuresCreatures({ rr, ST, clamp, need, warn, damp, count, flatten });   // structures-creatures.js
  const { mergeInto, prepShardlings, isUnder, updateShardlings, buildGolem, updateGolem } = CREAT;
  const SNOWM = window.createStructuresSnowmobile({ damp, TAU, mergeInto, H, clamp, need, isUnder, count });   // structures-snowmobile.js
  const { buildSnowmobile, updateSnowmobile } = SNOWM;

  const WRECK = window.createStructuresWreck({ ST, count, rr, warn, need, clamp, H, flatCache, groundTilt, flatten, taken, spawn, flat, snowify, TAU, findSpot, mat4, partsGroup, register });   // structures-wreck.js
  const { seatY, smooth01, DRAWN, updateDebris, buildCase, VIS, solidShells, cover, shellInside, buildKestrelParts, visUnder, tryRocks, withY, buildRocks, buildKestrel, clipBelow, updateCase, updateHab } = WRECK;
  // the blocks use each other's names (a name a block needs that another block, created later, exports): handed over here; C, THREE, V3 are bound in init
  const BLOCKS = [CAMP, LAND, CREAT, SNOWM, WRECK];
  const SHARED = { cover, DRAWN, smooth01, shellInside, solidShells, visUnder, seatY, clipBelow, withY };
  for (const X of BLOCKS) X.bind(SHARED);

  /* ============================ module ============================ */
  (window.GameModules = window.GameModules || []).push({
    name: 'structures',
    order: 30,
    init(ctx) {
      const t0 = performance.now();
      C = ctx; THREE = ctx.THREE; V3 = THREE.Vector3;
      for (const X of BLOCKS) X.bind({ C, THREE, V3 });
      const steps = { station: buildStation, slots: buildSlots, echoes: buildEchoes, spires: buildSpires, rift: buildRift, shards: buildShards, shardlings: prepShardlings, golem: buildGolem, snowmobile: buildSnowmobile, kestrel: buildKestrel, kestrelParts: buildKestrelParts, cargoCase: buildCase, rocks: buildRocks };
      for (const k in steps) { try { steps[k](); } catch (e) { console.error('[struct] ' + k, e); ST.stats.warn.push(k + ': ' + e.message); } }
      ST.stats.ms = Math.round(performance.now() - t0);
    },
    update(dt, ctx) {
      updateShardlings(dt); updateGolem(dt); updateSnowmobile(dt);
      tryRocks(); updateCase(dt); updateDebris(dt);
      updateHab(dt);
    },
  });
})();
