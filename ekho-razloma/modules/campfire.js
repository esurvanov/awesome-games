/* modules/campfire.js — Campfire: the camp's fire (flame, embers, smoke, heat, light) and resting by it.
 * Classic script, loaded before the page: window.createCampfire(deps) → { FIRE, updateFire(dt), rest(), finishRest() }.
 * Resting: "Отдохнуть у огня" (story stage ≥ 2, not riding) fades out, restores health, clears the blizzard timer, sets the checkpoint to
 * the station and saves; a fox that has joined the pilot is placed beside the fire.
 * deps (open-world.html builds them): the helpers and scene objects named below; D.T (the game clock) and D.WX (the weather) are read at run
 * time through the deps object because the page defines them after this module is created. */
(function () {
  'use strict';
  window.createCampfire = function (D) {
    const { rand, scene, $, G, player, Passport, camera, fox, groundH, candela, ASSET, damp, Sound, WORLD, MANAGER, V3, loadPacked, prepModel, clamp, emit,
      renderHearts, toast, save, INTER } = D;
  /* ---------- campfire (CAMP.md) ----------
   * Flame: 2 crossed quads in ONE mesh sampling a noise-driven flipbook baked offline (assets/camp/flame_atlas.png: 16 frames
   * 4×4, heat only; heat → colour ramp here, neighbouring frames cross-faded, each quad fades out when seen edge-on).
   * Embers: the shared particle pool (emit). Smoke: one instanced draw of soft camera-facing puffs drifting with the wind
   * (terrain wind direction, stronger in a blizzard), also from the camp stove pipe (STRUCT.stove). Heat glow: one ground decal
   * per fire (coal bed + warm pool on the snow; the camp's cold ring only smoulders) + an ember term on the fire-pit stones.
   * One flicker value drives the flame height/brightness, the decal, the stones and the point light. ≈ 4 draw calls. */
  const FIRE = { pos: WORLD.stationW(3, 11), flick: 1, fl: [0, 0, 0], smoke: [], smokeT: 0 }; FIRE.pos.y = groundH(FIRE.pos.x, FIRE.pos.z); FIRE.baseY = FIRE.pos.y + 0.08;
  const fireLight = new THREE.PointLight(0xff8a3a, candela(24), 22, 2); fireLight.position.set(FIRE.pos.x, FIRE.pos.y + 1.3, FIRE.pos.z); scene.add(fireLight);
  const FIRE_U = { tFlame: { value: new THREE.TextureLoader(MANAGER).load(ASSET + 'camp/flame_atlas.png') }, uT: { value: 0 }, uFlick: { value: 1 } };
  FIRE.flame = (() => {
    const g = new THREE.BufferGeometry(), P = [], N = [], UV = [], O = [], ix = [], W = 1.3, Hh = 1.55;
    for (let q = 0; q < 2; q++) { const a = q * Math.PI / 2 + 0.4, cx = Math.cos(a), cz = Math.sin(a), b = P.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { P.push((u - 0.5) * W * cx, v * Hh, (u - 0.5) * W * cz); N.push(-cz, 0, cx); UV.push(q ? 1 - u : u, v); O.push(q * 7); }
      ix.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('aOff', new THREE.Float32BufferAttribute(O, 1)); g.setIndex(ix);
    const m = new THREE.ShaderMaterial({ uniforms: FIRE_U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `attribute vec3 aN; attribute float aOff; varying vec2 vUv; varying float vFade, vOff;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vec3 v = normalize(cameraPosition - w.xyz); vec3 n = normalize(mat3(modelMatrix) * aN);
          vFade = smoothstep(.12, .55, abs(dot(v, n))); vUv = uv; vOff = aOff; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D tFlame; uniform float uT, uFlick; varying vec2 vUv; varying float vFade, vOff;
        float cell(float i, vec2 uv){ float c = mod(i, 4.), r = floor(i / 4.); return texture2D(tFlame, vec2((c + clamp(uv.x, .01, .99)) / 4., 1. - (r + 1.) / 4. + clamp(uv.y, 0., .995) / 4.)).r; }
        void main(){ float f = uT * 13. + vOff, i0 = mod(floor(f), 16.), k = fract(f);
          vec2 uv = vec2(vUv.x, vUv.y / (.72 + .34 * uFlick));
          float h = mix(cell(i0, uv), cell(mod(i0 + 1., 16.), uv), k) * (.8 + .25 * uFlick);
          vec3 c = vec3(clamp(h * 1.9, 0., 1.), clamp(h * 1.5 - .32, 0., 1.) * .85, clamp(h * 1.4 - .95, 0., 1.) * .4) * 1.02;   // core toned down (was ×1.5 → blown out/bloomed solid within ~4 m)
          gl_FragColor = vec4(c * h * vFade, 1.); }` });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'fire_flame'; mesh.userData.noCollide = true; mesh.userData.qaIntentional = 'fire';
    mesh.position.set(FIRE.pos.x, FIRE.baseY, FIRE.pos.z); scene.add(mesh); return mesh;
  })();
  // heat decal: coal bed (r < coal) + warm pool on the snow; strength 1 = the station fire, < 1 = a smouldering ring
  function fireDecal(pos, coal, pool, strength) {
    const m = new THREE.ShaderMaterial({ uniforms: { uT: FIRE_U.uT, uFlick: FIRE_U.uFlick, uS: { value: strength }, uCoal: { value: coal }, uPool: { value: pool } },
      // premultiplied: the coal bed covers the snow in the pit with charcoal (alpha), the pool around it only adds light
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -4, fog: false,
      vertexShader: `varying vec2 vP; uniform float uPool; void main(){ vP = position.xy * uPool; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float uT, uFlick, uS, uCoal, uPool; varying vec2 vP;
        float hs(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
        void main(){ float r = length(vP);
          float n = vn(vP * 9. + vec2(0., uT * .35)) * .6 + vn(vP * 23. - uT * .5) * .4;
          float bed = 1. - smoothstep(uCoal * .7, uCoal, r + (n - .5) * .12);
          float coal = bed * smoothstep(.45, .8, n) * (.55 + .45 * sin(uT * 2.3 + n * 9.));
          float pool = exp(-r * r / (uPool * uPool * .18)) * (.55 + .45 * uFlick);
          vec3 c = vec3(1., .3, .05) * coal * 1.6 * (uS > .9 ? uFlick : .5) + vec3(.02, .017, .015) * bed + vec3(1., .5, .22) * pool * .1 * uS;
          gl_FragColor = vec4(c, bed * .92); }` });
    const d = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); d.rotation.x = -Math.PI / 2; d.position.copy(pos); d.renderOrder = 2; d.name = 'fire_heat'; d.userData.noCollide = true; d.userData.qaIntentional = 'fire';
    scene.add(d); return d;
  }
  FIRE.decal = fireDecal(new V3(FIRE.pos.x, FIRE.pos.y + 0.05, FIRE.pos.z), 0.5, 2.6, 1);
  // smoke: soft camera-facing puffs, one instanced draw (station fire + camp stove pipe + camp ring; hidden when no puff is alive)
  FIRE.smokeMesh = (() => {
    const n = 48, g = new THREE.InstancedBufferGeometry(); g.instanceCount = n;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const iP = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), iA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    iP.setUsage(THREE.DynamicDrawUsage); iA.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iP', iP); g.setAttribute('iA', iA);
    const m = new THREE.ShaderMaterial({ uniforms: { uMoon: { value: new THREE.Color(0.24, 0.26, 0.3) } }, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec3 iP; attribute vec4 iA; varying vec2 vQ; varying vec4 vA;   // iA: size, alpha, spin, warm
        void main(){ vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(iA.z), s = sin(iA.z); vec2 q = mat2(c, s, -s, c) * position.xy; vQ = position.xy; vA = iA;
          gl_Position = projectionMatrix * viewMatrix * vec4(iP + (r * q.x + u * q.y) * iA.x, 1.); }`,
      fragmentShader: `uniform vec3 uMoon; varying vec2 vQ; varying vec4 vA;
        void main(){ vec2 p = vQ * 2.; float d = dot(p, p); if (d > 1.) discard;
          float lobes = .75 + .25 * sin(atan(p.y, p.x) * 3. + vA.z * 5.) * sqrt(d);
          float a = pow(1. - d, 1.6) * lobes * vA.y;
          vec3 c = mix(uMoon, vec3(.55, .24, .08), vA.w);
          gl_FragColor = vec4(c, a); }` });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 7; mesh.name = 'fire_smoke'; mesh.userData.noCollide = true; mesh.userData.qaIntentional = 'fire';
    scene.add(mesh); for (let i = 0; i < n; i++) FIRE.smoke.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vy: 0, s0: 0, s1: 0, a: 0, spin: 0, warm: 0 });
    return { mesh, iP, iA, n };
  })();
  FIRE.puff = (x, y, z, o) => {
    let p = FIRE.smoke.find((q) => q.life <= 0); if (!p) return;
    Object.assign(p, { x: x + rand(-0.12, 0.12), y, z: z + rand(-0.12, 0.12), vy: o.vy * rand(0.8, 1.2), max: o.life * rand(0.8, 1.2), s0: o.s0, s1: o.s1 * rand(0.8, 1.25), a: o.a, spin: rand(0, 6.28), sp: rand(-0.3, 0.3), warm: o.warm });
    p.life = p.max;
  };
  loadPacked('firepit', ASSET + 'firepit/', (g) => {
    const r = prepModel(g.scene, 0); r.position.copy(FIRE.pos); scene.add(r); let ent = Passport.register(r, 'solid', { name: 'firepit' });
    // heat glow on the stones: an ember term on the inner faces near the coal bed, flickering with the flame
    r.traverse((o) => { if (!o.isMesh) return; const mt = o.material; if (!mt || mt.userData.fireGlow) return; mt.userData.fireGlow = true;
      const prev = mt.onBeforeCompile, prevKey = mt.customProgramCacheKey;
      mt.onBeforeCompile = function (sh, rr) { if (prev) prev.call(this, sh, rr); sh.uniforms.uFlick = FIRE_U.uFlick; sh.uniforms.uFireC = { value: FIRE.pos };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vFw = (modelMatrix * vec4(transformed, 1.)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFw; uniform float uFlick; uniform vec3 uFireC;')
          .replace('#include <lights_fragment_begin>', `{ float fr = length(vFw.xz - uFireC.xz), fh = vFw.y - uFireC.y;
            totalEmissiveRadiance += vec3(1., .3, .06) * (1. - smoothstep(.25, .72, fr)) * (1. - smoothstep(.12, .42, fh)) * (.25 + .35 * uFlick); }
          #include <lights_fragment_begin>`); };
      mt.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|fireglow'; }; mt.needsUpdate = true; });
    // the ring rests on the loose snow: re-seat once the terrain's snow depth (drifts included) has settled
    setTimeout(() => { const b = new THREE.Box3().setFromObject(r), x = (b.min.x + b.max.x) / 2, z = (b.min.z + b.max.z) / 2;
      const d = window.Terrain && Terrain.snowDepthAt ? Terrain.snowDepthAt(x, z) : 0, want = groundH(x, z) + d * 0.85 - 0.03;
      Passport.remove(ent); r.position.y += want - b.min.y; r.updateMatrixWorld(true); ent = Passport.register(r, 'solid', { name: 'firepit' });
      FIRE.baseY = want + 0.06; FIRE.flame.position.y = FIRE.baseY; FIRE.decal.position.y = want + 0.04; }, 6000);
  });
  window.FIREFX = FIRE;   // QA: FIREFX.off = true hides the whole fire system (A/B cost)
  function updateFire(dt) {
    if (FIRE.off) { FIRE.flame.visible = FIRE.decal.visible = FIRE.smokeMesh.mesh.visible = false; if (FIRE.campDecal) FIRE.campDecal.visible = false; return; }
    if (FIRE.campDecal) FIRE.campDecal.visible = true;
    // flicker: layered sines + a smoothed random walk; the flame, the coal bed, the stones and the light all follow it
    FIRE.fl[0] = damp(FIRE.fl[0], rand(-1, 1), 6, dt); FIRE.fl[1] = damp(FIRE.fl[1], rand(-1, 1), 1.5, dt);
    FIRE.flick = clamp(0.92 + Math.sin(D.T * 7.3) * 0.06 + Math.sin(D.T * 13.1 + 1) * 0.05 + FIRE.fl[0] * 0.12 + FIRE.fl[1] * 0.1, 0.55, 1.25);
    FIRE_U.uT.value = D.T; FIRE_U.uFlick.value = FIRE.flick;
    fireLight.intensity = candela(24) * (0.55 + 0.45 * FIRE.flick); fireLight.position.y = FIRE.baseY + 0.9 + FIRE.flick * 0.25;
    const d = camera.position.distanceTo(FIRE.pos), near = d < 170;
    FIRE.flame.visible = FIRE.decal.visible = near;
    if (dt === 0) return;
    const wd = window.Terrain && Terrain.windDir ? Terrain.windDir : { x: 1, z: 0.18 }, wl = Math.hypot(wd.x, wd.z) || 1, ws = 0.5 + 4.5 * (D.WX.storm || 0), wx = wd.x / wl * ws, wz = wd.z / wl * ws;
    if (!FIRE.campDecal && window.WorldFill && WorldFill.campFire) FIRE.campDecal = fireDecal(WorldFill.campFire.clone().setY(WorldFill.campFire.y + 0.04), 0.45, 1.4, 0.45);
    // emitters: station fire (embers + smoke), camp stove pipe, smouldering camp ring
    FIRE.smokeT += dt;
    if (near) {
      if (Math.random() < dt * 10) emit(FIRE.pos.x + rand(-0.3, 0.3), FIRE.baseY + rand(0.2, 0.5), FIRE.pos.z + rand(-0.3, 0.3), rand(-0.4, 0.4) + wx * 0.25, rand(1.4, 3.2), rand(-0.4, 0.4) + wz * 0.25, rand(0.9, 2), [0xff7a20, 0xffa040, 0xff5010][(Math.random() * 3) | 0], rand(0.05, 0.1), 0.7, -0.5);
      if (Math.random() < dt * 6) FIRE.puff(FIRE.pos.x, FIRE.baseY + 1.0 * FIRE.flick, FIRE.pos.z, { vy: 0.9, life: 6, s0: 0.35, s1: 2.4, a: 0.45, warm: 1 });
      if (d < 14 && Math.random() < dt * 5) Sound.crack();
    }
    const sv = window.STRUCT && STRUCT.stove;
    if (sv && camera.position.distanceTo(sv) < 170 && Math.random() < dt * 3) FIRE.puff(sv.x, sv.y, sv.z, { vy: 0.6, life: 5, s0: 0.18, s1: 1.4, a: 0.22, warm: 0 });
    const cf = window.WorldFill && WorldFill.campFire;
    if (cf && camera.position.distanceTo(cf) < 120 && Math.random() < dt * 1.2) FIRE.puff(cf.x, cf.y + 0.2, cf.z, { vy: 0.35, life: 5, s0: 0.2, s1: 1.1, a: 0.12, warm: 0.3 });
    const S = FIRE.smokeMesh, P = S.iP.array, A = S.iA.array; let live = 0;
    for (let i = 0; i < S.n; i++) {
      const p = FIRE.smoke[i];
      if (p.life <= 0) { A[i * 4 + 1] = 0; A[i * 4] = 0; continue; }
      live++;
      p.life -= dt; const age = 1 - p.life / p.max, drift = Math.min(1, age * 3);
      p.x += wx * drift * dt; p.z += wz * drift * dt; p.y += p.vy * (1 - age * 0.6) * dt; p.spin += p.sp * dt;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      A[i * 4] = p.s0 + (p.s1 - p.s0) * Math.sqrt(age); A[i * 4 + 1] = p.a * Math.min(1, age * 6) * (1 - age) * (1 - age * 0.3); A[i * 4 + 2] = p.spin; A[i * 4 + 3] = p.warm * Math.max(0, 1 - age * 2.5) * FIRE.flick;
    }
    S.mesh.visible = live > 0; if (live) { S.iP.needsUpdate = true; S.iA.needsUpdate = true; }
  }
  function rest() {
    G.restT = 2.4; $('fadeText').textContent = 'ОТДЫХ'; $('fadeText').style.color = 'var(--amber)'; $('fade').classList.add('on'); Sound.heal();
  }
  function finishRest() {
    player.hp = player.hpMax; renderHearts(); D.WX.target = 0; D.WX.t = rand(160, 240); G.checkpoint = 'station';
    $('fade').classList.remove('on'); setTimeout(() => { $('fadeText').style.color = ''; }, 900);
    toast('i-fire', 'Силы восстановлены', 'c-amber');
    if (fox.joined) { fox.x = FIRE.pos.x + 1.6; fox.z = FIRE.pos.z + 1.2; }
    save();
  }
  INTER.push({ pos: () => FIRE.pos, r: 3.2, get pri() { return player.hp < player.hpMax ? 2 : 0; }, label: 'Отдохнуть у огня', icon: 'i-fire', noAnim: true, when: () => G.stage >= 2 && !G.riding, act: rest });
    return { FIRE, updateFire, rest, finishRest };
  };
})();
