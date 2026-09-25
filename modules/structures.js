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
      cache[name] = g; const list = waiting[name]; delete waiting[name];
      for (const f of list) { try { f(g); } catch (e) { console.error('[struct] ' + name, e); ST.stats.warn.push(name + ': ' + e.message); } }
    });
  }

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
  function flat(name, g, filter) { return flatCache[name] || (flatCache[name] = flatten(g.scene, filter)); }
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

  /* ============================ station ============================ */
  function buildStation() {
    const st = C.WORLD.station; if (!st) return;
    const base = st.position.y, yaw = st.rotation.y;
    const lg = (lx, lz) => { const v = C.WORLD.stationW(lx, lz); return H(v.x, v.z) - base; };
    const lgMin = (lx, lz, box, ry, s = 1) => { const c = Math.cos(ry), sn = Math.sin(ry); let m = 1e9;
      for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) { const bx = (box.min.x + (box.max.x - box.min.x) * i / 2) * s * 0.85, bz = (box.min.z + (box.max.z - box.min.z) * j / 2) * s * 0.85; m = Math.min(m, lg(lx + bx * c + bz * sn, lz - bx * sn + bz * c)); }
      return m; };
    const addLocal = (F, lx, ly, lz, ry, name, o = {}) => {
      const g = new THREE.Group(); g.position.set(lx, ly, lz); g.rotation.y = ry; if (o.s) g.scale.setScalar(o.s); st.add(g);
      spawn(F, [new THREE.Matrix4()], { parent: g, name, cast: true });
      st.updateMatrixWorld(true);
      if (o.role !== 'none') C.Passport.register(o.colFilter ? (() => { const r = partsGroup(F.parts, o.colFilter); r.matrix.copy(g.matrixWorld); r.matrixAutoUpdate = false; r.updateMatrixWorld(true); return r; })() : g, o.role || 'solid', { name });
      count(name); return g;
    };
    // geodesic dome: centred on the station origin, door (+Z) toward the crash site like the old dome
    need('struct_station_dome', (gl) => {
      const F = flat('struct_station_dome', gl), dn = gl.scene.getObjectByName('Dome'), ant = gl.scene.getObjectByName('Antenna');
      const db = new THREE.Box3().setFromObject(dn), cx = (db.min.x + db.max.x) / 2, cz = (db.min.z + db.max.z) / 2;
      for (const p of F.parts) { if (/glass/i.test(p.name)) { p.mat = p.mat.clone(); p.mat.emissive.setHex(0xffb468); p.mat.emissiveIntensity = 0.5; } else snowify(p.mat); }
      const y = Math.min(lg(0, 0), lgMin(0, 0, { min: new V3(-6, 0, -6), max: new V3(6, 0, 9) }, 0)) - 0.12;
      addLocal(F, -cx, y, -cz, 0, 'station_dome');
      if (ant && C.WORLD.blink) { const ab = new THREE.Box3().setFromObject(ant); C.WORLD.blink.position.set((ab.min.x + ab.max.x) / 2 - cx, y + ab.max.y + 0.15, (ab.min.z + ab.max.z) / 2 - cz); }
    });
    // insulated module on stilts: long axis along local X (old cylinder), stairs toward the back
    need('struct_station_module', (gl) => {
      const F = flat('struct_station_module', gl);
      for (const p of F.parts) { if (/glass/i.test(p.name)) { p.mat = p.mat.clone(); p.mat.emissive.setHex(0xffb468); p.mat.emissiveIntensity = 0.45; } else snowify(p.mat); }
      const lx = 12.8, lz = -3.2, ry = Math.PI / 2;
      addLocal(F, lx, lgMin(lx, lz, F.box, ry) - 0.08, lz, ry, 'station_module');
    });
    // crate stack (the 1.2 m ledge-climb crate of the bench) + loose drums/crate by the door
    need('prop_crate_military', (gl) => {
      const F = flat('prop_crate_military', gl), h = F.box.max.y - F.box.min.y, sy = 1.2 / (h * 3);
      const stack = { parts: F.parts, box: F.box }, mats = [];
      for (let k = 0; k < 3; k++) for (const side of [-1, 1]) mats.push(mat4(rr(-0.03, 0.03), -F.box.min.y * sy + k * h * sy, side < 0 ? 0 : 0.52, rr(-0.04, 0.04), 1, 0, 0, sy));   // (5,-8) = middle of a column, not the seam (bench ledge climb)
      const g = new THREE.Group(), lx = 5, lz = -8, ry = 1; g.position.set(lx, lgMin(lx, lz, { min: new V3(-0.62, 0, -0.27), max: new V3(0.62, 0, 0.79) }, ry) + 0.0, lz); g.rotation.y = ry; st.add(g);
      for (const M of mats) spawn(stack, [M], { parent: g, name: 'crate_stack' });
      st.updateMatrixWorld(true); C.Passport.register(g, 'solid', { name: 'crate_stack' }); count('crate_stack');
    });
    need('prop_drum_plastic_blue', (gl) => {
      const F = flat('prop_drum_plastic_blue', gl);
      for (const [lx, lz] of [[-10.6, 8.2], [-10.1, 9.1]]) { const v = C.WORLD.stationW(lx, lz); pushable(F, v.x, v.z, rr(0, TAU), 16, 'drum_blue'); }
    });
    need('prop_crate_wood_02', (gl) => { const F = flat('prop_crate_wood_02', gl), v = C.WORLD.stationW(-11.4, 7.1); pushable(F, v.x, v.z, yaw + 0.5, 18, 'crate_wood_02'); });
  }
  // kickable prop: one Mesh, direct child of the scene (Passport 'pushable' → physics body)
  function pushable(F, x, z, ry, mass, name, o = {}) {
    const p = F.parts[0]; if (!p) return null;
    snowify(p.mat, 0.8);
    const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = m.receiveShadow = true; m.name = name;
    if (o.lying) { const r = (F.box.max.x - F.box.min.x) / 2; m.rotation.set(0, ry, Math.PI / 2); m.position.set(x, H(x, z) + r + 0.02, z); }
    else { const g = groundUnder(x, z, ry, F.box); m.rotation.set(0, ry, 0); m.position.set(x, (o.onTop ?? g.max) - F.box.min.y + 0.01 + (o.up || 0), z); }
    const px = ST.hullProxy(m); px.userData.struct = true; C.scene.add(px); px.updateMatrixWorld(true);
    C.Passport.register(px, 'pushable', { name, mass }); count(name); return px;
  }
  // Rapier's convexHull panics ('unreachable') on the dense scanned prop meshes: the physics body gets an invisible
  // proxy mesh whose vertices are the prop's points clustered to 6 cm; the drawn prop rides on it as a child
  ST.hullProxy = function (mesh) {
    const P = mesh.geometry.attributes.position, seen = new Set(), pts = [], q = 0.06;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = Math.round(x / q) + ',' + Math.round(y / q) + ',' + Math.round(z / q);
      if (!seen.has(k)) { seen.add(k); pts.push(x, y, z); }
    }
    while ((pts.length / 3) % 3) pts.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeBoundingSphere();
    const px = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false })); px.name = mesh.name + '_body';
    px.position.copy(mesh.position); px.quaternion.copy(mesh.quaternion); px.scale.copy(mesh.scale);
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1); mesh.userData.noCollide = true; px.add(mesh);
    return px;
  };

  /* ============================ WorldFill slots: camp, poles, pier, ruins, cairns ============================ */
  const KIND = {
    tent_dome: { pack: 'prop_tent_dome', role: 'solid', fit: 'tilt', snow: 1, colFilter: noCords, shell: true },
    tent_tunnel: { pack: 'prop_tent_tunnel', role: 'solid', fit: 'tilt', snow: 1, colFilter: noCords, shell: true },
    sledge: { pack: 'prop_sledge_loaded', role: 'solid', fit: 'tilt', snow: 1, colFilter: noCords },
    snowcat: { pack: 'vehicle_snowcat', role: 'solid', fit: 'tilt', snow: 1 },
    crate_wood: { pack: 'prop_crate_wood_02', role: 'pushable' },
    drum_blue: { pack: 'prop_drum_plastic_blue', role: 'pushable' },
    barrel_steel: { pack: 'prop_barrel_01', role: 'pushable' },
    pole: { pack: 'prop_power_pole', role: 'trunk', exact: true, snow: 0.6 },
    pole_tr: { pack: 'prop_power_pole_transformer', role: 'trunk', exact: true, snow: 0.6 },
    pier: { pack: 'struct_pier_wood', role: 'solid', exact: true, snow: 1, iceClip: true },
    rowboat: { pack: 'prop_rowboat', role: 'solid', exact: true, snow: 1 },
    ruin_arch: { pack: 'struct_ruin_arch', role: 'solid', fit: 'upright', snow: 1, R: 10, maxRise: 0.85 },
    ruin_column: { pack: 'struct_ruin_column', role: 'solid', fit: 'upright', snow: 1, R: 8, maxRise: 0.8 },
    ruin_wall: { pack: 'struct_ruin_wall', role: 'solid', fit: 'upright', snow: 1, R: 8, maxRise: 0.85 },
    cairn: { pack: 'prop_cairn', role: 'solid', fit: 'upright', snow: 1, R: 10, maxRise: 0.35 },
    inuksuk: { pack: 'prop_inuksuk', role: 'solid', fit: 'upright', snow: 1, R: 8, maxRise: 0.3 },
  };
  function buildSlots() {
    const slots = (window.WorldFill && WorldFill.slots) || [];
    const byKind = {};
    for (const s of slots) (byKind[s.kind] = byKind[s.kind] || []).push(s);
    for (const kind in byKind) {
      const K = KIND[kind]; if (!K) { warn('unknown slot kind', kind); continue; }
      need(K.pack, (gl) => {
        const F = flat(K.pack, gl);
        if (K.shell) solidShells(F);   // open fabric shells: explicit inner side instead of double-sided
        if (K.snow) for (const p of F.parts) snowify(p.mat, K.snow);
        const list = byKind[kind], mats = [], fallen = [];
        if (kind === 'pier' && list.length && list[0].m) respacePier(list, F);
        for (const s of list) {
          if (K.role === 'pushable') { placePushSlot(F, s, kind); continue; }
          if (s.m) { const M = new THREE.Matrix4().fromArray(s.m); (s.fallen ? fallen : mats).push(M); taken.push([s.x, s.z, 1]); continue; }
          const sc = s.s || 1, sp = findSpot(s.x, s.z, s.yaw, F.box, sc, { maxDeg: 20, maxRise: (K.maxRise ?? 0.5) * sc, R: s.site === 'camp' ? 3.5 : K.R || 8 });
          if (!sp) { warn('no ground for', kind, s.x.toFixed(0), s.z.toFixed(0)); continue; }
          if (!sp.ok) warn(kind, 'best-effort ground', sp.g.slope.toFixed(0) + '°', 'rise', sp.g.rise.toFixed(2));
          if (sp.r > 0.5) ST.stats.moved.push({ kind, from: [s.x, s.z], to: [sp.x, sp.z], r: +sp.r.toFixed(1) });
          const rad = Math.hypot(F.box.max.x - F.box.min.x, F.box.max.z - F.box.min.z) * 0.5 * sc; taken.push([sp.x, sp.z, rad * 0.8]);
          let rx = 0, rz = 0, y;
          if (K.fit === 'tilt') { [rx, rz] = groundTilt(sp.x, sp.z, s.yaw, F.box, sc); y = sp.g.mean - (s.sink || 0.04) - F.box.min.y * sc; if (s.tilt) { rx += s.tilt[0]; rz += s.tilt[1]; } }
          else y = seatY(F, mat4(sp.x, 0, sp.z, s.yaw, sc), 0.05, { maxGap: 0.02 }).dy;   // upright masonry: ~5 % under the visible snow (+ the drift piled later), never floats
          mats.push(mat4(sp.x, y, sp.z, s.yaw, sc, rx, rz));
          s.placed = { x: sp.x, y, z: sp.z };
          fitLog(kind, sp, y + F.box.min.y * sc, K.fit);
        }
        if (mats.length) {
          spawn(F, mats, { name: kind, instanced: mats.length > 1 });
          if (K.iceClip) for (const M of mats) register(clipBelow(F, (C.POI.lake.h ?? 0) - 0.05, M), [M], K.role, { name: 'st_' + kind });   // piles below the ice: nothing to collide with
          else register(F, mats, K.role, { name: 'st_' + kind, colFilter: K.colFilter, topFrac: K.role === 'trunk' ? 1 : undefined });
          count(kind, mats.length);
        }
        if (fallen.length) { spawn(F, fallen, { name: kind + '_fallen', instanced: fallen.length > 1 }); register(F, fallen, 'solid', { name: 'st_' + kind + '_fallen' }); count(kind + '_fallen', fallen.length); }
      });
    }
  }
  // pier sections: WorldFill spaces them by the nominal 12.4 m; lay them end to end by the measured section length
  function respacePier(list, F) {
    // lay the sections deck to deck (the model has a frame-only end), starting where the bank meets the ice
    // the walkable deck: longest run of top-level plank hits along the section axis (model space)
    const probe = partsGroup(F.parts), top = F.box.max.y, rc = new THREE.Raycaster(); let run = null, cur = null, deckY = -1e9;
    const hitAt = (z) => { rc.set(new V3(0, top + 2, z), new V3(0, -1, 0)); const h = rc.intersectObject(probe, true)[0]; return h ? h.point.y : null; };
    for (let z = F.box.min.z; z <= F.box.max.z; z += 0.25) { const y = hitAt(z); if (y !== null && y < top - 0.6) deckY = Math.max(deckY, y); }
    for (let z = F.box.min.z; z <= F.box.max.z + 0.25; z += 0.25) {
      const y = z <= F.box.max.z ? hitAt(z) : null, ok = y !== null && Math.abs(y - deckY) < 0.25;
      if (ok) { if (!cur) cur = [z, z]; else cur[1] = z; } else if (cur) { if (!run || cur[1] - cur[0] > run[1] - run[0]) run = cur; cur = null; }
    }
    if (!run) run = [F.box.min.z, F.box.max.z];
    const L = run[1] - run[0] + 0.15, cz = (run[0] + run[1]) / 2; ST.stats.pierDeck = { run, deckY: +deckY.toFixed(2) };
    const m0 = new THREE.Matrix4().fromArray(list[0].m), p0 = new V3().setFromMatrixPosition(m0), lz = new V3(0, 0, 1).transformDirection(m0), dir = lz.clone();
    const p1 = list.length > 1 ? new V3().setFromMatrixPosition(new THREE.Matrix4().fromArray(list[1].m)) : null;
    const nominal = p1 ? p1.clone().sub(p0).length() : 12.4;
    if (p1 && p1.clone().sub(p0).dot(dir) < 0) dir.negate();
    const lh = C.POI.lake.h !== undefined ? C.POI.lake.h : H(p0.x, p0.z);
    const shore = p0.clone().addScaledVector(dir, -nominal / 2);
    for (let k = 0; k < 40 && H(shore.x, shore.z) > lh + 0.05; k++) shore.addScaledVector(dir, 0.25);   // bank → where it meets the ice (deck 0.2 m above)
    shore.addScaledVector(dir, -0.1);
    list.forEach((s, k) => { const c = shore.clone().addScaledVector(dir, L * (k + 0.5)); const m = new THREE.Matrix4().fromArray(s.m); m.setPosition(c.x - lz.x * cz, deckY > -1e8 ? lh + 0.2 - deckY : p0.y, c.z - lz.z * cz); s.m = m.elements.slice(); s.x = c.x; s.z = c.z; });
    ST.stats.pierSection = +L.toFixed(2);
  }
  // placement report: terrain slope under the footprint, base height vs the lowest / highest ground sample
  function fitLog(kind, sp, base, fit) {
    const f = ST.stats.fit = ST.stats.fit || { n: 0, maxSlope: 0, maxFloat: -9, maxSink: 0, list: [] };
    const float = +(base - sp.g.min).toFixed(2), sink = +(sp.g.max - base).toFixed(2);
    f.n++; f.maxSlope = Math.max(f.maxSlope, +sp.g.slope.toFixed(1)); f.maxFloat = Math.max(f.maxFloat, float); f.maxSink = Math.max(f.maxSink, sink);
    f.list.push({ kind, x: +sp.x.toFixed(1), z: +sp.z.toFixed(1), slope: +sp.g.slope.toFixed(1), float, sink, fit });
  }
  function placePushSlot(F, s, kind) {
    const K = { crate_wood: 18, drum_blue: 16, barrel_steel: 22 }[kind] || 15;
    if (s.up) { // stacked on the crate below: rest on its top
      const g = groundUnder(s.x, s.z, s.yaw, F.box); pushable(F, s.x, s.z, s.yaw, s.push || K, kind, { onTop: g.max + (F.box.max.y - F.box.min.y) + 0.01 });
    } else pushable(F, s.x, s.z, s.yaw, s.push || K, kind, { lying: s.lying });
  }

  /* ============================ echo ruins ============================ */
  let runeTex = null;
  function runeTexture() {
    if (runeTex) return runeTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 5; g.shadowColor = '#fff'; g.shadowBlur = 6;
    const r = (a) => (Math.sin(a * 12.9898) * 43758.5453) % 1;
    for (let row = 0; row < 4; row++) {   // four runes: vertical stave + 1–2 branches
      const y0 = 10 + row * 29, y1 = y0 + 22, x = 32; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1);
      const b = Math.abs(r(row + 1)); if (b > 0.3) { g.moveTo(x, y0 + 4); g.lineTo(x + (b > 0.6 ? 12 : -12), y0 + 12); }
      if (Math.abs(r(row + 7)) > 0.45) { g.moveTo(x, y0 + 12); g.lineTo(x - 11, y1 - 2); }
      g.stroke();
    }
    runeTex = new THREE.CanvasTexture(c); runeTex.colorSpace = THREE.SRGBColorSpace; return runeTex;
  }
  function buildEchoes() {
    const kinds = ['struct_ruin_arch', 'struct_ruin_wall', 'struct_ruin_column'];
    const echoes = C.WORLD.echoes || [];
    for (const eo of echoes) {
      const pack = kinds[eo.i % 3];
      need(pack, (gl) => {
        const F = flat(pack, gl); for (const p of F.parts) snowify(p.mat);
        const x0 = eo.g.position.x, z0 = eo.g.position.z, yaw = rr(0, TAU);
        const sp = findSpot(x0, z0, yaw, F.box, 1, { maxDeg: 20, maxRise: 0.8, R: 26, step: 1.5, avoid: (x, z) => C.inRift(x, z, 6) });
        if (!sp) { warn('echo', eo.i, 'no ground'); return; }
        if (!sp.ok) warn('echo', eo.i, 'best-effort ground', sp.g.slope.toFixed(0) + '°');
        taken.push([sp.x, sp.z, 3]);
        const y = seatY(F, mat4(sp.x, 0, sp.z, yaw), 0.08, { maxGap: 0.02 }).dy;   // ~8 % under the visible snow, never floats
        const M = mat4(sp.x, y, sp.z, yaw); fitLog('echo' + eo.i, sp, y + F.box.min.y, 'upright');
        const meshes = spawn(F, [M], { name: 'echo_ruin' });
        register(F, [M], 'solid', { name: 'echo' + eo.i });
        // rune decal on the stone face that looks toward the old echo spot (the player's usual approach)
        const faceDir = new V3(x0 - sp.x, 0, z0 - sp.z); if (faceDir.lengthSq() < 1) faceDir.set(Math.sin(yaw), 0, Math.cos(yaw)); faceDir.normalize();
        const hitY = y + F.box.min.y + 1.5, rc = new THREE.Raycaster(new V3(sp.x + faceDir.x * 9, hitY, sp.z + faceDir.z * 9), faceDir.clone().negate(), 0, 12);
        meshes.forEach((m) => m.updateMatrixWorld(true));
        const hit = rc.intersectObjects(meshes, false)[0];
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.84), new THREE.MeshBasicMaterial({ map: runeTexture(), color: new THREE.Color(0x5cf5c0).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
        dec.userData.noCollide = true;
        let px, py, pz, n;
        if (hit) { n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : faceDir.clone(); n.y = 0; if (n.lengthSq() < 0.1) n.copy(faceDir); n.normalize(); px = hit.point.x; py = hit.point.y; pz = hit.point.z; }
        else { n = faceDir.clone(); px = sp.x + n.x * 0.8; py = hitY; pz = sp.z + n.z * 0.8; }
        dec.position.set(px + n.x * 0.03, py, pz + n.z * 0.03); dec.lookAt(dec.position.x + n.x, py, dec.position.z + n.z); C.scene.add(dec);
        // move the echo there: group (glow sprite) + interaction point
        eo.g.position.set(px + n.x * 0.5, H(px + n.x * 0.5, pz + n.z * 0.5), pz + n.z * 0.5);
        eo.eg.position.set(0, py - eo.g.position.y, 0);
        eo.pos.set(eo.g.position.x, eo.g.position.y + 1.2, eo.g.position.z);
        eo.decal = dec; ST.stats.moved.push({ kind: 'echo' + eo.i, from: [x0, z0], to: [sp.x, sp.z], slope: +sp.g.slope.toFixed(1) });
        count('echo_ruin');
      });
    }
  }

  /* ============================ spires ============================ */
  function buildSpires() {
    need('crystal_spire', (gl) => {
      const F = flat('crystal_spire', gl), S = 0.9;
      const rock = F.parts.find((p) => !/crystal/i.test(p.name)), crys = F.parts.find((p) => /crystal/i.test(p.name));
      if (rock) snowify(rock.mat, 0.8);
      // plinth: its lowest rim sits 0.3 m in the ground
      const rb = rock ? rock.geo.boundingBox : F.box, y0 = -rb.min.y * S - 0.3;
      need('struct_ruin_column', (gc) => {
        const FC = flat('struct_ruin_column', gc); for (const p of FC.parts) snowify(p.mat);
        for (const s of C.WORLD.spires) {
          const g = s.g;
          const cm = crys.mat.clone(); cm.emissive.setHex(0x1b5fb0); cm.emissiveIntensity = s.taken ? 0.15 : 1; s.mat = cm;
          const holder = new THREE.Group(); holder.position.y = y0; holder.scale.setScalar(S); g.add(holder);
          const meshes = spawn({ parts: F.parts.map((p) => (p === crys ? { geo: p.geo, mat: cm } : p)) }, [new THREE.Matrix4()], { parent: holder, name: s.key });
          g.updateMatrixWorld(true);
          // altar = broken column stump on the plinth surface at (ax, az)
          const rc = new THREE.Raycaster(new V3(g.position.x + s.ax, g.position.y + 30, g.position.z + s.az), new V3(0, -1, 0), 0, 60);
          const hit = rc.intersectObjects(meshes, false).filter((h) => h.object.material !== cm)[0];
          const top = hit ? hit.point.y - g.position.y : 0.3;
          const alt = new THREE.Group(), as = 0.5; alt.position.set(s.ax, top - 0.1 - FC.box.min.y * as, s.az); alt.scale.setScalar(as); alt.rotation.y = Math.atan2(-s.ax, -s.az); g.add(alt);
          spawn(FC, [new THREE.Matrix4()], { parent: alt, name: 'altar' });
          const altTop = top - 0.1 + (FC.box.max.y - FC.box.min.y) * as;
          s.partY = altTop + 1.1; s.part.position.y = s.partY; s.pg.position.y = s.partY;
          s.altar.set(g.position.x + s.ax, g.position.y + altTop + 0.2, g.position.z + s.az);
          g.updateMatrixWorld(true);
          s.col = C.Passport.register(g, 'solid', { name: s.key });   // plinth, crystals, altar (ring/part/beam excluded)
          s.plinthTop = top; count('spire');
        }
      });
    });
  }

  /* ============================ rift: crystals, heart ============================ */
  function readInstances(name) {
    let im = null; C.scene.traverse((o) => { if (!im && o.isInstancedMesh && o.name === name) im = o; });
    if (!im) return null;
    const out = []; for (let i = 0; i < im.count; i++) { const m = new THREE.Matrix4(); im.getMatrixAt(i, m); out.push(m); }
    return { im, mats: out };
  }
  function dropEntries(prefix) {
    const P = C.Passport, list = (P.list || []).filter((e) => e && e.name && e.name.indexOf(prefix) === 0);
    for (const e of list) P.remove(e);
    return list.length;
  }
  function buildRift() {
    need('crystal_cluster_ground', (gl) => {
      const F = flat('crystal_cluster_ground', gl), p = F.parts[0];
      const jobs = [['rift_crystal', 0x4a1a9a, 1.25, 0.8, false], ['crystal_tree', 0x1b3a86, 0.85, 2.1, false]];
      for (const [name, em, ei, k, cast] of jobs) {
        const src = readInstances(name); if (!src) { warn('no instances', name); continue; }
        const mat = p.mat.clone(); mat.emissive.setHex(em); mat.emissiveIntensity = ei;
        const mats = src.mats.map((M) => {
          const pos = new V3(), q = new THREE.Quaternion(), sc = new V3(); M.decompose(pos, q, sc);
          const M0 = new THREE.Matrix4().compose(new V3(pos.x, 0, pos.z), q, new V3(sc.x * k, sc.y * k, sc.z * k));
          return withY(M0, seatY({ parts: [p] }, M0, 0.14, { maxGap: 0.02, extra: 0.03 }).dy);   // ~14 % under the visible snow (QA burial measure)
        });
        src.im.visible = false; src.im.parent && src.im.parent.remove(src.im);
        const gone = dropEntries(name);
        spawn({ parts: [{ geo: p.geo, mat }] }, mats, { name, instanced: true, cast });
        register({ parts: [{ geo: p.geo, mat }] }, mats, 'solid', { name: 'st_' + name, shape: 'hull' });
        count(name, mats.length); ST.stats[name + '_replacedEntries'] = gone;
      }
    });
    need('crystal_cluster_large', (gl) => {   // hero clusters on the crater rim
      const F = flat('crystal_cluster_large', gl), rp = C.POI.rift, mats = [];
      const cm = F.parts.find((q) => /crystal/i.test(q.name)); if (cm) { cm.mat = cm.mat.clone(); cm.mat.emissive.setHex(0x4a1a9a); cm.mat.emissiveIntensity = 1.2; }
      for (const q of F.parts) if (q !== cm) snowify(q.mat, 0.7);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + rr(-0.3, 0.3), d = rr(58, 70), x = rp.x + Math.cos(a) * d, z = rp.z + Math.sin(a) * d / 1.25, s = rr(1.1, 1.7), yaw = rr(0, TAU);
        const sp = findSpot(x, z, yaw, F.box, s, { maxDeg: 26, maxRise: 0.9 * s, R: 10, minH: -50 });
        if (!sp) continue;
        const [crx, crz] = groundTilt(sp.x, sp.z, yaw, F.box, s, 0.3), M0 = mat4(sp.x, 0, sp.z, yaw, s, crx, crz);
        mats.push(withY(M0, seatY(F, M0, 0.15, { maxGap: 0.02 }).dy)); taken.push([sp.x, sp.z, 2.5 * s]);
      }
      if (mats.length) { spawn(F, mats, { name: 'rift_cluster', instanced: true }); register(F, mats, 'solid', { name: 'st_rift_cluster', shape: 'hull' }); count('rift_cluster', mats.length); }
    });
    need('rift_heart', (gl) => {
      const h = C.WORLD.heart; if (!h) return;
      const root = gl.scene.clone(true);
      root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive.setHex(0x8a4dff); o.material.emissiveIntensity = 1.3; o.castShadow = true; o.userData.noCollide = true; } });
      const bb = new THREE.Box3().setFromObject(root), c = bb.getCenter(new V3()); root.position.sub(c);   // centred pivot (spins in place)
      root.userData.struct = true; h.m.add(root); count('heart');
    });
  }

  /* ============================ shard pickups ============================ */
  function buildShards() {
    need('crystal_shard_pickup', (gl) => {
      const F = flat('crystal_shard_pickup', gl), p = F.parts[0], mat = p.mat.clone(); mat.emissive.setHex(0xff7a10); mat.emissiveIntensity = 1.1;
      const cy = (F.box.min.y + F.box.max.y) / 2;
      for (const s of C.WORLD.shards || []) {
        const w = new THREE.Group(), m = new THREE.Mesh(p.geo, mat); m.position.y = -cy; m.castShadow = false; m.userData.noCollide = true; w.add(m); w.userData.struct = true;
        w.rotation.copy(s.m.rotation); s.m.visible = false; s.g.add(w); s.m = w;
      }
      count('shard', (C.WORLD.shards || []).length);
    });
  }

  /* ============================ shardlings ============================ */
  let SH = null;   // { scene, clips, shardGeo }
  const dying = [];
  function prepShardlings() {
    need('enemy_shardling', (gl) => {
      const shard = gl.scene.getObjectByName('Shard0');
      SH = { scene: gl.scene, clips: gl.animations, shardGeo: shard && shard.geometry };
      ST.ready.shardling = true;
    });
  }
  // called by spawnShardling (open-world.html): a fresh animated crystal creature
  ST.shardling = function () {
    if (!SH) return null;
    const g = new THREE.Group(), inner = SH.scene.clone(true), mat = (() => { let m0 = null; inner.traverse((o) => { if (o.isMesh && !m0) m0 = o.material; }); return m0.clone(); })();
    mat.emissive.setHex(0x3a1a9a); mat.emissiveIntensity = 1.5;
    let core = null;
    inner.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.frustumCulled = false; if (o.name === 'Core') core = o; } });
    g.add(inner);
    const eyeNode = inner.getObjectByName('Eye'), eye = C.glow(0xff4d9d, 1.4);
    if (eyeNode) eyeNode.add(eye); else { eye.position.set(0, 0.2, -0.6); g.add(eye); }
    const anim = C.makeAnimator(inner, SH.clips, { idle: 'Idle', move: 'Move', attack: 'Attack', hit: 'Hit', death: 'Death' });
    anim.loop('idle', 0);
    return { g, core: core || inner, mat, orbit: new THREE.Group(), eye, anim, shardGeo: SH.shardGeo };
  };
  ST.dying = function (e) { e.anim.lock = 0; e.anim.once('death', 1.25, 0.05); e.eye.visible = false; dying.push({ e, t: 1.25 }); };
  function updateShardlings(dt) {
    for (const e of C.enemies) {
      const A = e.anim; if (!A || e.dead) continue;
      if (e.flash > 0.05 && !(e._fl > 0.05) && A.lock <= 0) A.once('hit', 0.35, 0.05);
      if (e.st === 'windup' && e._st !== 'windup') { A.lock = 0; A.once('attack', 1.0, 0.08); }
      e._fl = e.flash; e._st = e.st;
      A.loop(e.st === 'chase' || e.st === 'return' ? 'move' : 'idle', 0.25);
      if (A.cur === 'move') A.speed('move', e.st === 'chase' ? 1.3 : 1);
      A.update(dt);
    }
    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i]; d.t -= dt; d.e.anim.update(dt);
      if (d.t <= 0) { C.scene.remove(d.e.g); dying.splice(i, 1); }
    }
  }

  /* ============================ boss: crystal golem ============================ */
  const GOLEM = { A: null, root: null, dieT: -1, prevX: 0, prevZ: 0, hurtCd: 0, lastSummon: false, lastSt: '', emBase: null };
  ST.golem = GOLEM;   // debug / QA probes
  function buildGolem() {
    need('boss_crystal_golem', (gl) => {
      const boss = C.boss, root = gl.scene;
      const skin = []; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.isSkinnedMesh) skin.push(o); } });
      const body = skin[0]; if (!body) { warn('golem: no skinned mesh'); return; }
      const mat = body.material.clone(); body.material = mat; GOLEM.emBase = mat.emissive.clone(); GOLEM.eiBase = mat.emissiveIntensity;
      const rock = root.getObjectByName('ThrowRock'); if (rock) rock.visible = false; GOLEM.rock = rock;
      for (const c of boss.g.children.slice()) c.visible = false;   // fallback crystal body
      const wrap = new THREE.Group(); wrap.position.y = -1.2; wrap.add(root); boss.g.add(wrap); GOLEM.wrap = wrap; GOLEM.root = root;
      // glows ride the bones: core on the chest, eyes on the head (compensating the bone scale)
      const bone = (n) => root.getObjectByName(n);
      root.updateMatrixWorld(true);
      const stick = (sprite, b, off) => { if (!b) return; const s = new V3(); b.getWorldScale(s); const h = new THREE.Group(); h.scale.set(1 / s.x, 1 / s.y, 1 / s.z); h.position.copy(off); b.add(h); sprite.position.set(0, 0, 0); sprite.visible = true; h.add(sprite); };
      stick(boss.core, bone('chest'), new V3(0, 0.6, 0.9)); boss.core.scale.setScalar(4.5);
      const eyes = C.glow(0xff4d9d, 1.8); stick(eyes, bone('head'), new V3(0, 0.5, 0.7));
      boss.mat = mat; boss.armL = new THREE.Group(); boss.armR = new THREE.Group(); boss.halo = new THREE.Group();
      GOLEM.A = C.makeAnimator(root, gl.animations, { idle: 'Idle', walk: 'Walk', run: 'Run', slam: 'Attack2', swing: 'Attack1', throw: 'Throw_Rock2', summon: 'Throw_Rock',
        hurt1: 'Hurt1', hurt2: 'Hurt2', hurt3: 'Hurt3', death: 'Death', wake: 'Sleep_End', sleep: 'Sleep_Idle' });
      GOLEM.A.loop('sleep', 0);   // asleep under the rift floor until the intro wakes it (no idle → wake pose snap)
      boss.anim = bossAnim; boss.onDeath = bossDeath;
      // the golem is 8 m tall and walks on the rift floor: tie its shadow/bounds to the group
      count('golem');
    });
  }
  function bossAnim(dt, d) {
    const boss = C.boss, A = GOLEM.A; if (!A) return;
    const sp = dt > 0 ? Math.hypot(boss.x - GOLEM.prevX, boss.z - GOLEM.prevZ) / dt : 0; GOLEM.prevX = boss.x; GOLEM.prevZ = boss.z;
    const st = boss.st, enter = st !== GOLEM.lastSt; GOLEM.lastSt = st;
    GOLEM.hurtCd -= dt;
    if (st === 'intro') {   // rises out of the rift floor instead of growing from a point
      // rises out of the floor; the clip stands it up, slowed (0.55) so the 8 m golem's hips move at a giant's pace
      boss.g.scale.setScalar(1); GOLEM.wrap.position.y = -1.2 - Math.max(0, boss.t) / 2 * 8.5;
      if (enter) { A.lock = 0; const wd = A.acts.wake ? A.acts.wake.getClip().duration : 2; A.once('wake', Math.min(4.5, wd / 0.55), 0.4); A.speed('wake', 0.55); }
    } else {
      GOLEM.wrap.position.y = damp(GOLEM.wrap.position.y, -1.2, 10, dt);
      if (A.cur === 'wake' && Math.abs(GOLEM.vAlong || 0) > 0.3) A.lock = 0;   // it starts walking: the gait takes over from the stand-up clip
    }
    if (boss.summoned && !GOLEM.lastSummon) { A.lock = 0; A.speed('summon', 2.2); A.once('summon', 7.5 / 2.2, 0.35); GOLEM.showRock = 1.2; }
    GOLEM.lastSummon = boss.summoned;
    if (enter && st === 'rise') { A.lock = 0; A.speed('slam', 1.15); A.once('slam', 3.54 / 1.15, 0.35); }
    if (enter && st === 'charge') { A.lock = 0; const k = Math.random() < 0.5 ? 'swing' : 'throw'; const ts = k === 'swing' ? 1.2 : 1.7; /* an 8 m golem: hips at a giant's pace */ A.speed(k, ts); A.once(k, (k === 'swing' ? 3.54 : 5.42) / ts, 0.35); if (k === 'throw') GOLEM.showRock = 1.6; }
    if (boss.flash > 0.05 && GOLEM.hurtCd <= 0 && A.lock <= 0 && st !== 'intro') { GOLEM.hurtCd = 2.2; const k = 'hurt' + (1 + ((Math.random() * 3) | 0)); A.speed(k, 1.6); A.once(k, 1.6 / 1.6, 0.25); }
    // locomotion: walk ↔ run as one phase-synced gait (interaction module), rate = signed speed along the facing ÷
    // measured stride — backing off plays the walk backwards; the golem's top speed is the gait's (boss.vMax)
    const ry = boss.g.rotation.y, vA = dt > 0 && GOLEM.px2 !== undefined ? ((boss.x - GOLEM.px2) * -Math.sin(ry) + (boss.z - GOLEM.pz2) * -Math.cos(ry)) / dt : 0; GOLEM.px2 = boss.x; GOLEM.pz2 = boss.z;
    GOLEM.vAlong = damp(GOLEM.vAlong || 0, clamp(vA, -12, 12), 6, dt);   // smoothed: pushed back at the arena edge it would flicker between 0 and full speed
    if (!GOLEM.gaitTried && window.INTERACTION && INTERACTION.makeGait && A.acts.walk) {
      GOLEM.gaitTried = true;
      try {
        const S = {}; for (const k of ['walk', 'run']) if (A.acts[k]) S[k] = INTERACTION.strideSpeed(GOLEM.root, A.acts[k].getClip(), [['footL'], ['footR']], 'hip');
        if (S.walk > 0.3) {
          GOLEM.gait = INTERACTION.makeGait(A, { root: GOLEM.root, keys: ['walk', 'run'], stride: S, bands: [[S.walk * 1.3, S.walk * 1.65]], idle: 'idle', idleLo: 0.2, idleHi: 0.9, foot: 'footL', ref: 'hip', fwd: -1,
            rateMax: 1.7, enabled: () => !C.boss.dead, speed: () => GOLEM.vAlong || 0, want: () => Math.abs(GOLEM.vAlong || 0) });
          if (GOLEM.gait) { boss.vMax = GOLEM.gait.vMax; GOLEM.stride = S; }
        }
      } catch (e) { warn('golem gait', e.message); }
    }
    const loopK = GOLEM.gait ? (Math.abs(GOLEM.vAlong) > 0.3 ? 'walk' : 'idle') : sp > 5.2 ? 'run' : sp > 0.5 ? 'walk' : 'idle';
    A.loop(loopK, 0.3);
    if (!GOLEM.gait) { if (loopK === 'walk') A.speed('walk', clamp(sp / 3.2, 0.6, 1.7)); if (loopK === 'run') A.speed('run', clamp(sp / 6.5, 0.7, 1.5)); }
    if (GOLEM.rock) { GOLEM.showRock = (GOLEM.showRock || 0) - dt; GOLEM.rock.visible = GOLEM.showRock > 0; }
    A.update(dt);
    // glow: flash on hits, hotter while charging / rising
    const m = boss.mat, hot = st === 'charge' || st === 'rise' || st === 'drop';
    if (boss.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 2.2; }
    else { m.emissive.copy(GOLEM.emBase); if (hot) m.emissive.lerp(new THREE.Color(0xff5cc8), 0.5); m.emissiveIntensity = GOLEM.eiBase * (hot ? 2 : 1); }
  }
  function bossDeath() {
    const A = GOLEM.A; if (!A) return false;
    A.lock = 0; A.once('death', 5.8, 0.15); GOLEM.dieT = 4.2; GOLEM.rock && (GOLEM.rock.visible = false);
    C.boss.core.visible = false;
    return true;   // keep the golem visible while it falls; updateGolem hides it
  }
  function updateGolem(dt) {
    if (GOLEM.dieT < 0 || !GOLEM.A) return;
    const boss = C.boss; GOLEM.dieT -= dt; GOLEM.A.update(dt);
    const m = boss.mat; m.emissiveIntensity = Math.max(0, m.emissiveIntensity - dt * 0.4);
    if (GOLEM.dieT <= 0) {
      GOLEM.dieT = -1; boss.g.visible = false;
      const x = boss.x, y = boss.y, z = boss.z;
      for (let k = 0; k < 3; k++) C.burst(x, y + 1 + k, z, [0xc49bff, 0x9fdfff, 0xffffff][k], 60, 10, 1.2, 0.9);
      if (SH && SH.shardGeo && C.PH.ok) {   // it crumbles into crystal shards
        const cm = new THREE.MeshStandardMaterial({ color: 0x8fc8ff, emissive: 0x3a1a9a, emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.2 });
        for (let i = 0; i < 16; i++) {
          const s = new THREE.Mesh(SH.shardGeo, cm); s.scale.setScalar(rr(2, 4.5)); s.position.set(x + rr(-2, 2), y + rr(0.5, 5), z + rr(-2, 2)); s.rotation.set(rr(0, 6), rr(0, 6), rr(0, 6)); s.castShadow = true; C.scene.add(s);
          C.PH.P.spawnDebris(s, { shape: 'convex', mass: 4, lifetime: rr(8, 12), velocity: { x: rr(-5, 5), y: rr(2, 7), z: rr(-5, 5) }, angularVelocity: { x: rr(-4, 4), y: rr(-4, 4), z: rr(-4, 4) } });
        }
      }
    }
  }

  const isUnder = (o, g) => { for (let p = o; p; p = p.parent) if (p === g) return true; return false; };
  // replace the mesh descendants of `group` (optionally filtered) by one merged mesh per material, in group space
  function mergeInto(group, filter) {
    const F = flatten(group, (o) => !filter || filter(o));
    const drop = []; group.traverse((o) => { if (o.isMesh && (!filter || filter(o))) drop.push(o); });
    for (const o of drop) o.parent.remove(o);
    for (const p of F.parts) group.add(new THREE.Mesh(p.geo, p.mat));
  }
  /* ============================ snowmobile ============================ */
  const SM = { root: null, skis: [], track: null, ride: -1.02, prevYaw: 0, steer: 0, scroll: 0 };
  function buildSnowmobile() {
    const sk = C.sk;
    need('vehicle_snowmobile', (gl) => {
      const root = gl.scene; root.updateMatrixWorld(true);
      // skis (+ keel, loop, spindle) grouped per side on a steering pivot at the spindle (x ±0.5, z +1.25)
      const sideOf = (o) => { const b = new THREE.Box3().setFromObject(o); return (b.min.x + b.max.x) < 0 ? -1 : 1; };
      const skiParts = []; root.traverse((o) => { if (o.isMesh && /^(Ski_[LR]|keel|skiloop|spindle)/.test(o.name)) skiParts.push(o); });
      const pivots = {};
      for (const side of [-1, 1]) { const p = new THREE.Group(); p.position.set(side * 0.5, 0.2, 1.25); root.add(p); p.updateMatrixWorld(true); pivots[side] = p; SM.skis.push({ p, side, y: 0 }); }
      for (const o of skiParts) pivots[sideOf(o)].attach(o);
      // the track (+ lugs) scrolls: own material + texture offset
      const trackMat = (() => { let m = null; root.traverse((o) => { if (o.isMesh && /^Track/.test(o.name) && !m) m = o.material; }); return m; })();
      if (trackMat) { const tm = trackMat.clone(); if (tm.map) { tm.map = tm.map.clone(); tm.map.wrapS = tm.map.wrapT = THREE.RepeatWrapping; tm.map.needsUpdate = true; } root.traverse((o) => { if (o.isMesh && /^Track/.test(o.name)) o.material = tm; }); SM.track = tm; }
      // fewer draw calls: body, each ski assembly and the track become one mesh per material
      const subtrees = [pivots[-1], pivots[1]];
      const tracks = []; root.traverse((o) => { if (o.isMesh && /^Track/.test(o.name)) tracks.push(o); });
      const trackG = new THREE.Group(); root.add(trackG); for (const t of tracks) trackG.attach(t); subtrees.push(trackG);
      mergeInto(root, (o) => !subtrees.some((g) => isUnder(o, g)));
      for (const g of subtrees) mergeInto(g);
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // the model faces +Z, the skimmer drives toward −Z
      const holder = new THREE.Group(); holder.rotation.y = Math.PI; holder.position.y = SM.ride; holder.add(root); holder.userData.struct = true; sk.g.add(holder); SM.root = holder;
      if (sk.fallback) sk.fallback.visible = false;
      for (const hl of [-0.19, 0.19]) { const gw = C.glow(0xfff1d6, 1.1); gw.position.set(hl, 0.45, 1.25); root.add(gw); }
      const tl = C.glow(0xff2a1a, 0.5); tl.position.set(0, 0.5, -1.8); root.add(tl);
      // rider on the seat (seat top 0.78 m, rider hips at z ≈ −0.3 in model space → +0.3 behind the sled centre)
      sk.seat = { x: 0, y: SM.ride + 0.8, z: 0.3, drop: 0.5 };
      sk.spray = { w: 0.35, y: SM.ride + 0.1, z: 1.7 };
      count('snowmobile');
    });
  }
  let _w = null;
  function updateSnowmobile(dt) {
    const sk = C.sk; if (!SM.root || dt <= 0) return; _w = _w || new V3();
    const g = sk.g; g.updateMatrixWorld(true);
    const gy = H(sk.x, sk.z), h = g.position.y - gy;
    // parked: the game bobs the hover sled; the snowmobile sits on the snow. Riding: body at ride height, skis reach down
    const bodyY = sk.mounted ? SM.ride : -h;
    SM.root.position.y = damp(SM.root.position.y, bodyY, sk.mounted ? 12 : 30, dt);
    const yawRate = (((sk.yaw - SM.prevYaw + Math.PI) % TAU + TAU) % TAU - Math.PI) / dt; SM.prevYaw = sk.yaw;
    SM.steer = damp(SM.steer, sk.mounted ? clamp(yawRate * 0.35, -0.45, 0.45) : 0, 8, dt);
    for (const s of SM.skis) {
      s.p.rotation.y = -SM.steer;
      if (sk.mounted) { _w.set(0, 0, 0); s.p.localToWorld(_w); const gap = _w.y - 0.2 - H(_w.x, _w.z); s.y = damp(s.y, clamp(-gap, -0.28, 0.12), 14, dt); }
      else s.y = damp(s.y, 0, 10, dt);
      s.p.position.y = 0.2 + s.y;
    }
    if (SM.track && SM.track.map) { SM.scroll += (sk.mounted ? sk.speed : 0) * dt * 0.35; SM.track.map.offset.y = SM.scroll % 1; }
  }

  /* ============ incoming3: Kestrel wreck, debris trail, cargo case, ship parts, lake cell, rocks (FIX-WORLD) ============ */
  // visible ground = heightfield + loose snow (what the player and the QA height map see)
  const VIS = (x, z) => H(x, z) + (typeof C.snowDepthAt === 'function' ? Math.max(0, C.snowDepthAt(x, z) || 0) : 0);
  const visUnder = (x, z, yaw, box, s = 1) => { const c = Math.cos(yaw), sn = Math.sin(yaw); let sum = 0, n = 0, mn = 1e9;
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) { const lx = (box.min.x + (box.max.x - box.min.x) * i / 2) * s * 0.8, lz = (box.min.z + (box.max.z - box.min.z) * j / 2) * s * 0.8, h = VIS(x + lx * c + lz * sn, z - lx * sn + lz * c); sum += h; n++; mn = Math.min(mn, h); }
    return { mean: sum / n, min: mn }; };
  const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // terrain snow (shader + drift skirt) when the terrain module is there, else the own top-snow patch
  function cover(mat, o) {
    if (!mat || !mat.isMeshStandardMaterial || mat.transparent) return;
    if (typeof C.snowCover === 'function') { try { C.snowCover(mat, o); return; } catch (e) { /* own snow below */ } }
    snowify(mat, o.amount);
  }
  // Height that buries `target` of a placement the way the QA placed-object check measures it (tools/qa/qa-page.js):
  // footprint split 3×3, per cell the lowest vertex vs the visible surface, share of the cell's vertical extent under
  // it, averaged; and never floating (lowest cell gap ≤ maxGap). `extra`: snow the terrain will still pile against it.
  function ptsOf(F) {
    if (F._pts) return F._pts;
    let n = 0; for (const p of F.parts) n += p.geo.attributes.position.count;
    const step = Math.max(1, Math.ceil(n / 4000)), out = [];
    for (const p of F.parts) { const P = p.geo.attributes.position; for (let i = 0; i < P.count; i += step) out.push(P.getX(i), P.getY(i), P.getZ(i)); }
    return (F._pts = new Float32Array(out));
  }
  function seatY(F, M0, target, o = {}) {
    const pts = ptsOf(F), n = pts.length / 3, e = M0.elements, W = new Float32Array(pts.length);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      W[i * 3] = wx; W[i * 3 + 1] = wy; W[i * 3 + 2] = wz; if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz; }
    const lo = new Array(9).fill(null), top = new Array(9).fill(-1e9);
    for (let i = 0; i < n; i++) { const x = W[i * 3], y = W[i * 3 + 1], z = W[i * 3 + 2];
      const ci = Math.min(2, Math.floor((x - x0) / Math.max(1e-3, x1 - x0) * 3)), cj = Math.min(2, Math.floor((z - z0) / Math.max(1e-3, z1 - z0) * 3)), k = ci * 3 + cj;
      if (!lo[k] || y < lo[k][1]) lo[k] = [x, y, z]; if (y > top[k]) top[k] = y; }
    const surf = o.surf || VIS, cells = [];
    for (let k = 0; k < 9; k++) if (lo[k]) cells.push({ y: lo[k][1], h: top[k] - lo[k][1], s: surf(lo[k][0], lo[k][2]) + (o.extra || 0) });
    const bur = (dy) => { let a = 0, c = 0; for (const q of cells) if (q.h > 0.02) { a += clamp((q.s - q.y - dy) / q.h, 0, 1); c++; } return c ? a / c : 0; };
    const gap = (dy) => { let g = 1e9; for (const q of cells) g = Math.min(g, q.y + dy - q.s); return g; };
    let sLo = 1e9, sHi = -1e9, yLo = 1e9, yHi = -1e9; for (const q of cells) { sLo = Math.min(sLo, q.s); sHi = Math.max(sHi, q.s); yLo = Math.min(yLo, q.y); yHi = Math.max(yHi, q.y + q.h); }
    let a = sLo - yHi - 2, b = sHi - yLo + 2; for (let it = 0; it < 48; it++) { const m = (a + b) / 2; if (bur(m) > target) a = m; else b = m; }
    let dy = (a + b) / 2; const maxGap = o.maxGap ?? 0.04;
    if (gap(dy) > maxGap) dy -= gap(dy) - maxGap;
    return { dy, buried: bur(dy), gap: gap(dy) };
  }
  const withY = (M, dy) => { const m = M.clone(); m.elements[13] += dy; return m; };
  // one node of a glTF, flattened in its own space (origin = the node's base centre)
  function nodeF(gl, name) {
    const key = (gl.scene.userData.source || '') + '#' + name; if (flatCache[key]) return flatCache[key];
    const n = gl.scene.getObjectByName(name); if (!n) { warn('no node', name); return null; }
    const c = n.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1);
    const g = new THREE.Group(); g.add(c); return (flatCache[key] = flatten(g));
  }
  // an open shell drawn double-sided shows its inside as flipped front faces (QA: "back faces"); an explicit inner
  // shell (reversed winding, flipped normals) with single-sided materials renders the same thing with correct lighting
  function shellInside(geo) {
    const T3 = THREE || window.THREE, n = geo.attributes.position.count, g = new T3.BufferGeometry();
    for (const k of Object.keys(geo.attributes)) {
      let a = geo.attributes[k];
      if (a.isInterleavedBufferAttribute) {   // de-interleave (glTF skinned meshes interleave skin data): the doubled index reaches past the shared buffer otherwise → the whole draw is dropped
        const d = a.data, raw = new d.array.constructor(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) raw[i * a.itemSize + c] = d.array[i * d.stride + a.offset + c];
        a = new T3.BufferAttribute(raw, a.itemSize, a.normalized);
      }
      const arr = new a.array.constructor(a.array.length * 2); arr.set(a.array); arr.set(a.array, a.array.length);
      if (k === 'normal') for (let i = a.array.length; i < arr.length; i++) arr[i] = -arr[i];
      g.setAttribute(k, new T3.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    const src = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i), idx = new Uint32Array(src.length * 2);
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: src.length, materialIndex: 0 }];
    let o = 0;   // per material: its outer triangles, then the same triangles reversed on the duplicated (inner) vertices
    for (const gr of groups) {
      const s0 = o;
      for (let t = gr.start; t < gr.start + gr.count; t++) idx[o++] = src[t];
      for (let t = gr.start; t < gr.start + gr.count; t += 3) { idx[o++] = src[t] + n; idx[o++] = src[t + 2] + n; idx[o++] = src[t + 1] + n; }
      g.addGroup(s0, o - s0, gr.materialIndex);
    }
    g.setIndex(new T3.BufferAttribute(idx.subarray(0, o), 1));
    if (!geo.groups || !geo.groups.length) g.clearGroups();
    g.userData = Object.assign({}, geo.userData); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function solidShells(F) {   // flattened parts: double-sided opaque → explicit two shells, single-sided
    for (const p of F.parts) {
      if (p.mat.side !== THREE.DoubleSide || p.mat.transparent || p.mat.alphaTest > 0 || p._shell) continue;
      p.geo = shellInside(p.geo); p.mat = p.mat.clone(); delete p.mat.userData.trSnow; p.mat.side = THREE.FrontSide; p._shell = true;
    }
  }
  // collider parts: only triangles entirely above world height y at placement M (pier piles reach down through the ice)
  function clipBelow(F, y, M) {
    const e = M.elements, wy = (P, i) => e[1] * P.getX(i) + e[5] * P.getY(i) + e[9] * P.getZ(i) + e[13];
    const parts = [];
    for (const p of F.parts) {
      const P = p.geo.attributes.position, ix = p.geo.index ? p.geo.index.array : Array.from({ length: P.count }, (_, i) => i), keep = [];
      for (let t = 0; t < ix.length; t += 3) if (Math.min(wy(P, ix[t]), wy(P, ix[t + 1]), wy(P, ix[t + 2])) > y) keep.push(ix[t], ix[t + 1], ix[t + 2]);
      if (!keep.length) continue;
      const remap = new Map(), pos = [], idx = keep.map((v) => { let j = remap.get(v); if (j === undefined) { j = remap.size; remap.set(v, j); pos.push(P.getX(v), P.getY(v), P.getZ(v)); } return j; });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeBoundingBox(); parts.push({ geo: g, mat: p.mat, name: p.name });
    }
    return { parts, box: F.box };
  }
  function solidOpen(F) {   // thin open pieces (skin panels, cowling ring, door): inner shell for every opaque part
    for (const p of F.parts) { if (p.mat.transparent || p._shell) continue; p.geo = shellInside(p.geo); if (p.mat.side !== THREE.FrontSide) { p.mat = p.mat.clone(); delete p.mat.userData.trSnow; p.mat.side = THREE.FrontSide; } p._shell = true; }
  }
  ST.shellInside = shellInside;

  /* ---- Kestrel: DC-3-like wreck, nose dug in, tail break open, right wing stub up (left one torn off) ---- */
  const KES = { yaw: 0.7, buryTail: 0.3, buryNose: 1.0, roll: -0.08, ok: false };
  function buildKestrel() {
    const K = C.WORLD.kestrel; if (!K) return;
    const k = K.g; k.rotation.order = 'YXZ'; k.rotation.set(0, KES.yaw, 0);
    need('ship_kestrel', (gl) => {
      const root = gl.scene, wrap = new THREE.Group(); wrap.name = 'kestrel_wreck'; wrap.rotation.y = Math.PI; wrap.add(root); wrap.userData.struct = true; k.add(wrap);
      // the baked atlases carry the weathered aluminium (metal .45 + real roughness): colours/metal untouched; snow on top
      root.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
        for (const m of [].concat(o.material)) { if (/Glass/i.test(m.name)) continue; cover(m, /Primer/i.test(m.name) ? { amount: 0.4, minUp: 0.72, soft: 0.2, skirt: 0.1 } : { amount: 0.95, minUp: 0.58, soft: 0.24, skirt: 0.4 }); } });
      fitKestrel(k, wrap);
      K.base && K.base.pos && K.base.pos.copy(k.position);
      if (C.WORLD.kestrelBase) { C.WORLD.kestrelBase.pos.copy(k.position); C.WORLD.kestrelBase.rot.copy(k.rotation); }
      // exact trimesh of the drawn wreck: fuselage top, wing stub, cabin floor (through the tail break / cargo door)
      k.updateMatrixWorld(true);
      C.WORLD.kestrelCol = C.Passport.register(wrap, 'solid', { name: 'kestrel' });
      // ending glows: the radial engine's front + the open tail; smoke from the engine
      const eb = new THREE.Box3(); root.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => /Engine/i.test(m.name))) eb.expandByObject(o); });
      const toK = (v) => k.worldToLocal(v);
      const eng = eb.isEmpty() ? wrap.localToWorld(new V3(2.9, 1.0, 2.4)) : new V3((eb.min.x + eb.max.x) / 2, (eb.min.y + eb.max.y) / 2, (eb.min.z + eb.max.z) / 2);
      const tail = wrap.localToWorld(new V3(0, 1.4, -6.2));
      if (K.engines && K.engines[0]) K.engines[0].position.copy(toK(eng.clone()));
      if (K.engines && K.engines[1]) K.engines[1].position.copy(toK(tail.clone()));
      K.exhaust = toK(tail.clone());
      if (C.WORLD.shipSmoke) C.WORLD.shipSmoke.set(eng.x, eng.y + 0.6, eng.z);
      KES.ok = true; count('kestrel');
    });
  }
  function fitKestrel(k, wrap) {
    const yaw = KES.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);   // k +Z (tail side), k +X (model left)
    const at = (lx, lz) => H(k.position.x + rx * lx + fx * lz, k.position.z + rz * lx + fz * lz);
    const sAcross = (at(2.5, 0) - at(-2.5, 0)) / 5;
    k.rotation.set(0, yaw, Math.atan(sAcross) + KES.roll, 'YXZ'); k.updateMatrixWorld(true);
    // belly line in wrap space: lowest hull point under the centre line (ray from below)
    const meshes = []; wrap.traverse((o) => { if (o.isMesh && !/Glass/i.test([].concat(o.material)[0].name)) meshes.push(o); });
    const rc = new THREE.Raycaster(), zs = [], belly = [];
    for (let z = -5.4; z <= 6.6; z += 0.6) {
      const o = wrap.localToWorld(new V3(0, -4, z)), d = wrap.localToWorld(new V3(0, 1, z)).sub(wrap.localToWorld(new V3(0, 0, z))).normalize();
      rc.set(o, d); rc.far = 12; const h = rc.intersectObjects(meshes, false)[0];
      if (h) { const y = wrap.worldToLocal(h.point.clone()).y; if (y < 0.9) { zs.push(z); belly.push(y); } }   // skip the open tail / nose curve
    }
    if (zs.length < 4) { for (let z = -5.4; z <= 6.6; z += 0.6) { zs.push(z); belly.push(0.3); } }
    // nose (model +Z) dug in deeper than the open tail: depth under the terrain runs buryTail → buryNose
    const want = (z) => KES.buryTail + (KES.buryNose - KES.buryTail) * clamp((z + 5.4) / 12, 0, 1);
    const err = () => { k.updateMatrixWorld(true); let sa = 0, sz = 0, szz = 0, sze = 0, n = zs.length;
      zs.forEach((z, i) => { const p = wrap.localToWorld(new V3(0, belly[i], z)), e = (H(p.x, p.z) - p.y) - want(z); sa += e; sz += z; szz += z * z; sze += z * e; });
      const b = (n * sze - sz * sa) / Math.max(1e-6, n * szz - sz * sz); return { mean: sa / n, slope: b }; };
    for (let it = 0; it < 5; it++) {
      const e0 = err(); k.position.y += e0.mean;
      const a = err(), d = 0.01; k.rotation.x += d; const b = err(); k.rotation.x -= d;
      const g = (b.slope - a.slope) / d; if (Math.abs(g) > 1e-6) k.rotation.x = clamp(k.rotation.x - a.slope / g, -0.25, 0.25);
    }
    const e1 = err(); k.position.y += e1.mean;
    // keep the QA burial measure (share of the drawn wreck under the visible snow) well under 30 %: the low wing root otherwise
    // counts as buried even when the hull itself is only 0.3–1 m in
    k.updateMatrixWorld(true); const WF = flatten(wrap), q = seatY(WF, wrap.matrixWorld.clone(), 0.2, { maxGap: 0.05 });   // 0.2 + the drift the terrain piles on later
    if (q.dy > 0) { k.position.y += q.dy; KES.raised = +q.dy.toFixed(2); }
    KES.fit = { pitch: +k.rotation.x.toFixed(3), roll: +k.rotation.z.toFixed(3), y: +k.position.y.toFixed(2), residual: +err().mean.toFixed(3), belly: belly.map((v) => +v.toFixed(2)) };
    ST.stats.kestrel = KES.fit;
  }

  /* ---- debris: the pieces of the Kestrel along its crash trail (tail and wing section, skin, engine, cabin parts) ---- */
  const DEB = { list: [], key: null, keyT: 0, t: 0 };
  function buildKestrelParts() {
    need('ship_kestrel_debris', (gl) => {
      for (const f of [placeDebris, spireParts, lakeCell]) { try { f(gl); } catch (e) { warn('debris', f.name, e.message); } }
    });
  }
  function placeDebris(gl) {
    const k = C.WORLD.kestrel.g, yaw = KES.yaw, bx = Math.sin(yaw), bz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);   // behind (k +Z) · left of the wreck (k +X)
    const cp = C.POI.crash, kx = k.position.x, kz = k.position.z;
    taken.push([kx, kz, 7.5], [C.WORLD.crate.position.x, C.WORLD.crate.position.z, 2.2], [cp.x - 3, cp.z + 10, 2.2]);   // wreck, cargo case, start spot
    // [node, metres behind, metres to the left, big?]
    const plan = [['TailSection', 27, 2.5, 1], ['WingSection', 5, 17, 1],
      ['debris_cargo_door', 1.5, 6.2], ['debris_wheel', -1.5, -8], ['debris_skin_panel_a', 9.5, -2.5], ['debris_prop_blade', 8, 4.8], ['debris_cowling', 12.5, 3.2],
      ['debris_window_frame', 11.5, -5.5], ['debris_skin_strip', 15, -3.5], ['debris_cable_bundle', 17.5, 0.8], ['debris_seat', 20, -2.2], ['debris_skin_panel_b', 21.5, 5]];
    for (const [name, along, lat, big] of plan) {
      const F = nodeF(gl, name); if (!F) continue;
      solidOpen(F);
      for (const p of F.parts) if (!/Glass/i.test(p.mat.name)) cover(p.mat, { amount: 0.8, minUp: 0.6, soft: 0.24, skirt: big ? 0.35 : 0.1 });
      const x0 = kx + bx * along + lx * lat + rr(-1, 1), z0 = kz + bz * along + lz * lat + rr(-1, 1);
      const ry = big ? yaw + rr(-0.5, 0.5) + (name === 'WingSection' ? Math.PI / 2 : 0) : rr(0, TAU);
      const sp = findSpot(x0, z0, ry, F.box, 1, big ? { maxDeg: 16, maxRise: 1.1, R: 9, step: 1 } : { maxDeg: 24, maxRise: 0.35, R: 4, step: 0.6 });
      if (!sp) { warn('debris: no ground for', name); continue; }
      const rad = Math.hypot(F.box.max.x - F.box.min.x, F.box.max.z - F.box.min.z) * 0.5; taken.push([sp.x, sp.z, rad * 0.8]);
      const hgt = F.box.max.y - F.box.min.y, item = { name, F, x: sp.x, z: sp.z, ry, big: !!big, hgt };
      [item.rx, item.rz] = groundTilt(sp.x, sp.z, ry, F.box, 1, big ? 0.22 : 0.3);
      if (!big) { item.rx += rr(-0.06, 0.06); item.rz += rr(-0.06, 0.06); }
      item.meshes = spawn(F, [new THREE.Matrix4()], { name: 'kestrel_' + name });
      seatDebris(item); DEB.list.push(item); count('debris');
    }
  }
  // (re)seat on the visible snow: small pieces rest on it (a few cm in), sections sink through the loose snow
  function seatDebris(it) {
    const F = it.F, M0 = mat4(it.x, 0, it.z, it.ry, 1, it.rx, it.rz), fit = seatY(F, M0, it.big ? 0.12 : 0.1, { maxGap: 0.03 });
    const y = fit.dy, M = withY(M0, y); it.fit = { buried: +fit.buried.toFixed(3), gap: +fit.gap.toFixed(3) };
    for (const m of it.meshes) { m.matrix.copy(M); m.matrixWorldNeedsUpdate = true; }
    if (it.entries) for (const e of it.entries) C.Passport.remove(e);
    const col = partsGroup(F.parts); col.matrixAutoUpdate = false; col.matrix.copy(M); col.updateMatrixWorld(true);   // one entry named like the old boxes ('debris')
    it.entries = [].concat(C.Passport.register(col, 'solid', { name: it.big ? 'kestrel_' + (it.name === 'TailSection' ? 'tail' : 'wing') : 'debris' }));
    it.y = y;
  }
  // the terrain re-stamps drifts when the set of solids changes: re-seat the small pieces once the snow settled
  function updateDebris(dt) {
    if (!DEB.list.length) return;
    const T = window.Terrain, key = T && T.S ? T.S.obstKey : null;
    DEB.t += dt;
    if (key !== DEB.key) { DEB.key = key; DEB.keyT = DEB.t; DEB.pending = true; }
    if (DEB.pending && DEB.t - DEB.keyT > 1.5) { DEB.pending = false; for (const it of DEB.list) if (!it.big) seatDebris(it); ST.stats.debrisSeats = (ST.stats.debrisSeats || 0) + 1; }
  }

  /* ---- ship parts on the spire altars: cowling, propeller blade, cable loom from the wreck ---- */
  function spireParts(gl) {
    const names = ['debris_cowling', 'debris_prop_blade', 'debris_cable_bundle'];
    (C.WORLD.spires || []).forEach((s, i) => {
      const F = nodeF(gl, names[i % 3]); if (!F || !s.part) return;
      const size = F.box.getSize(new V3()), c = F.box.getCenter(new V3()), sc = 1.15 / Math.max(size.x, size.y, size.z);
      const inner = new THREE.Group(); inner.scale.setScalar(sc); inner.rotation.set(0.45, 0, 0.3);
      for (const p of F.parts) { const mat = p.mat.clone(); mat.onBeforeCompile = () => {}; delete mat.userData.trSnow; const m = new THREE.Mesh(p.geo, mat); m.position.copy(c).negate(); m.castShadow = true; m.userData.noCollide = true; inner.add(m); }
      for (const o of s.part.children.slice()) if (o.isMesh) s.part.remove(o);
      s.part.add(inner); s.part.userData.struct = true; count('spire_part');
    });
  }

  /* ---- lake: the power cell (the Kestrel's dented tank with its straps) frozen into a hole in the ice ---- */
  function lakeCell(gl) {
    const cell = C.WORLD.cell, holder = cell && cell.getObjectByName('cell_prop'); if (!holder) return;
    const F = nodeF(gl, 'debris_oil_tank'); if (!F) return;
    const c = F.box.getCenter(new V3()), inner = new THREE.Group(); inner.rotation.set(0.12, 0.6, 0.42); inner.position.y = 0.12;
    for (const p of F.parts) { const mat = p.mat.clone(); delete mat.userData.trSnow; if (mat.emissive) { mat.emissive.setHex(0x2ab8ff); mat.emissiveIntensity = 0.12; } cover(mat, { amount: 0.5, minUp: 0.7, soft: 0.2, skirt: 0 });
      const m = new THREE.Mesh(p.geo, mat); m.position.copy(c).negate(); m.castShadow = true; m.userData.noCollide = true; inner.add(m); }
    inner.scale.setScalar(1.1); holder.add(inner); holder.userData.struct = true; count('cell');
  }

  /* ---- cargo case (tool): lid opens (clip Open), the pulse cutter lifts out and flies into the pilot's hand ---- */
  const CASE = { root: null, mixer: null, open: null, cutter: null, t: -1, from: null };
  function buildCase() {
    const crate = C.WORLD.crate; if (!crate) return;
    need('prop_cargo_case', (gl) => {
      const root = gl.scene;
      root.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        for (const m of [].concat(o.material)) if (!/Cutter|Foam/i.test(m.name)) cover(m, { amount: 0.55, minUp: 0.72, soft: 0.2, skirt: 0.15 }); });
      const box = new THREE.Box3(new V3(-0.76, 0, -0.47), new V3(0.76, 0.9, 0.47)), yaw = 0.4, x = crate.position.x, z = crate.position.z;
      const [rx, rz] = groundTilt(x, z, yaw, box, 1, 0.14), v = visUnder(x, z, yaw, box, 1);
      crate.position.y = v.mean - 0.05; root.rotation.set(rx, yaw, rz, 'YXZ'); crate.add(root); crate.updateMatrixWorld(true);
      for (const o of crate.children) if (o.isMesh && !o.userData.struct) o.visible = false;   // v1 fallback, if any
      if (C.WORLD.crateGlow) { C.WORLD.crateGlow.position.set(0, 0.95, 0); C.WORLD.crateGlowS = 1.6; }
      const body = root.getObjectByName('CaseBody'); body && body.updateMatrixWorld(true);
      C.Passport.register(body || root, 'solid', { name: 'tool_crate' });
      CASE.root = root; CASE.cutter = root.getObjectByName('PulseCutter');
      CASE.mixer = new THREE.AnimationMixer(root);
      const clip = (gl.animations || []).find((a) => a.name === 'Open');
      if (clip) { CASE.open = CASE.mixer.clipAction(clip); CASE.open.setLoop(THREE.LoopOnce, 1); CASE.open.clampWhenFinished = true; CASE.open.play(); CASE.open.paused = true; CASE.mixer.update(0); }   // the glTF rest pose has the lid up: hold frame 0 (closed)
      root.userData.struct = true; count('cargo_case');
      if (C.G.hasTool) ST.caseOpened();
    });
  }
  ST.openCase = function () {
    if (!CASE.root || CASE.t >= 0) return;
    if (CASE.open) { CASE.open.reset(); CASE.open.play(); }
    CASE.t = 0;
  };
  ST.caseOpened = function () {   // saved game with the tool taken: lid open, recess empty
    if (!CASE.root) return;
    if (CASE.open) { CASE.open.reset(); CASE.open.play(); CASE.mixer.update(CASE.open.getClip().duration + 0.01); }
    if (CASE.cutter) CASE.cutter.visible = false;
    CASE.t = 99;
  };
  function updateCase(dt) {
    if (!CASE.mixer) return;
    if (CASE.t < 0 || CASE.t > 3) { if (CASE.t >= 0 && CASE.t < 99) CASE.mixer.update(dt); return; }
    CASE.t += dt; CASE.mixer.update(dt);
    const cu = CASE.cutter; if (!cu || !cu.visible) return;
    const t = CASE.t;
    if (t > 0.45 && t <= 0.9) { if (!CASE.y0) CASE.y0 = cu.position.y; cu.position.y = CASE.y0 + smooth01(0.45, 0.9, t) * 0.38; cu.rotation.x += dt * 0.8; }
    else if (t > 0.9) {
      if (!CASE.from) { C.scene.attach(cu); CASE.from = cu.position.clone(); CASE.s0 = cu.scale.x; }
      const hand = C.AV && C.AV.hand, to = new V3(); if (hand) hand.getWorldPosition(to); else to.set(C.player.x, C.player.y + 1.1, C.player.z);
      const k = smooth01(0.9, 1.35, t); cu.position.lerpVectors(CASE.from, to, k); cu.scale.setScalar(CASE.s0 * (1 - 0.6 * k));
      if (t >= 1.35) cu.visible = false;
    }
  }

  /* ---- rocks: the 300 procedural boulders of the decor → real scans (boulder, two closed-back rock faces) ---- */
  const ROCK = { done: false, f1: null, f2: null, cell: 200 };
  function gradeRock(mat) {   // same cool basalt grading the vegetation module gives its rocks (desaturate + grade)
    if (!mat || mat.userData.fwGrade) return; mat.userData.fwGrade = true;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { float fwL = dot(diffuseColor.rgb, vec3(.3, .55, .15)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(fwL), .5) * vec3(.92, .95, 1.02); }`); };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|fwgrade'; };
    mat.needsUpdate = true;
  }
  function buildRocks() {
    if (!C.DECOR || !C.DECOR.rocks || !C.DECOR.rocks.length) return;
    need('rock_rock_face_02_closed', (g) => { ROCK.f2 = g; });
    need('rock_rock_face_01_closed', (g) => { ROCK.f1 = g; });
  }
  function tryRocks() {
    if (ROCK.done || !ROCK.f1 || !ROCK.f2) return;
    const D = C.DECOR, bm = D && D.boulderMeshes; if (!bm || !bm.length) return;
    ROCK.done = true;
    try { placeRocks(); } catch (e) { warn('rocks', e.message); console.error(e); }
  }
  function placeRocks() {
    const bParts = C.DECOR.boulderMeshes.map((im) => { im.geometry.computeBoundingBox(); return { geo: im.geometry, mat: im.material, name: 'boulder' }; });
    const bBox = new THREE.Box3(); for (const p of bParts) bBox.union(p.geo.boundingBox);
    const FB = { parts: bParts, box: bBox };
    const F2 = flat('rock_rock_face_02_closed', ROCK.f2), F1 = flat('rock_rock_face_01_closed', ROCK.f1);
    for (const F of [F1, F2]) for (const p of F.parts) { gradeRock(p.mat); cover(p.mat, { amount: 0.8, minUp: 0.6, soft: 0.22, skirt: 0.35 }); }
    const models = [{ F: FB, w: bBox.max.x - bBox.min.x, key: 'b' }, { F: F2, w: F2.box.max.x - F2.box.min.x, key: 'f2' }, { F: F1, w: F1.box.max.x - F1.box.min.x, key: 'f1' }];
    const groups = new Map(), st = { n: 0, bury: [] };
    let sd = 7331; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    for (const R of C.DECOR.rocks) {
      const [x, , z, s, yaw, syk] = R, mi = s < 1.3 ? 0 : s < 2.1 ? 1 : 2, Md = models[mi], F = Md.F;
      const k = 2.3 * s / Math.max(0.5, Md.w) * (0.9 + r() * 0.2), ky = k * (syk || 1) * (mi ? 0.85 : 1);
      if (Math.hypot(x - C.POI.crash.x, z - C.POI.crash.z) < 34) continue;   // the crash trail keeps its own debris
      const [rx, rz] = groundTilt(x, z, yaw, F.box, k, 0.45);
      const hgt = (F.box.max.y - F.box.min.y) * ky;
      // 12–20 % of the height under the visible snow, counting the drift the terrain will pile against it
      // 12–20 % of it under the visible snow, counting the drift the terrain will pile against it
      const drift = Math.min(0.26, hgt * 0.16) * smooth01(0.3, 1.2, hgt) * 0.5, want = 0.12 + r() * 0.08;
      const M0 = new THREE.Matrix4().compose(new V3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), new V3(k, ky, k));
      const fit = seatY(F, M0, want, { extra: drift }), M = withY(M0, fit.dy);
      const cx = Math.floor(x / ROCK.cell), cz = Math.floor(z / ROCK.cell), key = Md.key + ':' + cx + ':' + cz;
      if (!groups.has(key)) groups.set(key, { Md, mats: [] }); groups.get(key).mats.push(M); st.n++; st.bury.push(fit.buried); (ST.stats.rockFits = ST.stats.rockFits || []).push([+x.toFixed(1), +z.toFixed(1), mi, +hgt.toFixed(2), +want.toFixed(2), +fit.buried.toFixed(2), +fit.gap.toFixed(2), +drift.toFixed(2)]);
    }
    // one instanced mesh per model and 200 m cell (frustum-culled per cell); colliders: convex hull per rock
    for (const { Md, mats } of groups.values()) {
      spawn(Md.F, mats, { name: 'rock', instanced: true });
      register(Md.F, mats, 'solid', { name: 'rock', shape: 'hull' });
    }
    count('rock', st.n); ST.stats.rocks = { placed: st.n, meshes: groups.size, buryMean: +(st.bury.reduce((a, b) => a + b, 0) / Math.max(1, st.bury.length)).toFixed(3) };
    // small clutter stones of WorldFill: same scan, decimated
    if (window.WorldFill && WorldFill.setStoneGeometry) { try { WorldFill.setStoneGeometry(bParts[0].geo); } catch (e) { warn('stones', e.message); } }
  }

  /* ============================ module ============================ */
  (window.GameModules = window.GameModules || []).push({
    name: 'structures',
    order: 30,
    init(ctx) {
      const t0 = performance.now();
      C = ctx; THREE = ctx.THREE; V3 = THREE.Vector3;
      const steps = { station: buildStation, slots: buildSlots, echoes: buildEchoes, spires: buildSpires, rift: buildRift, shards: buildShards, shardlings: prepShardlings, golem: buildGolem, snowmobile: buildSnowmobile, kestrel: buildKestrel, kestrelParts: buildKestrelParts, cargoCase: buildCase, rocks: buildRocks };
      for (const k in steps) { try { steps[k](); } catch (e) { console.error('[struct] ' + k, e); ST.stats.warn.push(k + ': ' + e.message); } }
      ST.stats.ms = Math.round(performance.now() - t0);
    },
    update(dt, ctx) {
      updateShardlings(dt); updateGolem(dt); updateSnowmobile(dt);
      tryRocks(); updateCase(dt); updateDebris(dt);
    },
  });
})();
