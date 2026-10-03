/* modules/wildlife.js — Wildlife: the fox (wild → follows → finds shards) and the stags (graze → flee).
 * Classic script, loaded before the page: window.createWildlife(deps) → { fox, STAGS, petFox, updateFox(dt), updateStags(dt) }.
 *   fox     { x, z, y, yaw, st: wild | follow | seek | wait, joined, speed, g, anim, target … }   saved as `fox` = fox.joined
 *   STAGS   [{ g, A, x, z, hx, hz, st: graze | flee, t, … }]   filled when the animal pack loads
 * The page keeps the old names (ctx.fox, ctx.STAGS, DBG.fox, DBG.STAGS) as aliases of these objects, so modules and tools are unchanged.
 * modules/interaction.js still drives the gait and the tracks of both (fox.vMax, s.gaitDriving) — that part is not moved yet.
 * Also registers the "pet the fox" interaction and the compass mark. deps: see the destructuring below (all built by open-world.html). */
(function () {
  'use strict';
  window.createWildlife = function (D) {
    const { player, rand, Sound, G, wrapA, POI, groundH, emit, toast, boss, clamp, scene, loadPacked, ASSET, prepModel, attach, Dialog, save, INTER,
      ICON, cmp, cmpMarks, enemies, WORLD, damp, collide, boundary, camera, getH, inRift, makeAnimator } = D;
  const fox = { x: POI.crash.x + 11, z: POI.crash.z + 15, y: 0, yaw: 2.4, st: 'wild', speed: 0, joined: false, g: new THREE.Group(), anim: null, target: null, seekT: 14, yipT: 0, happy: 0 };
  fox.g.position.set(fox.x, groundH(fox.x, fox.z), fox.z); scene.add(fox.g);
  loadPacked('fox', ASSET, (g) => {
    const root = prepModel(g.scene, 0.353, (m) => { m.map = null; m.color.setHex(0xe8edf5); m.roughness = 0.95; m.metalness = 0; });   // REALISM: 0.45 → 0.353 model height = shoulder 0.408 → ≈ 0.32 m (sizes.json: arctic fox 0.24–0.345 m, Audet/Robbins/Larivière 2002)
    attach(fox.g, root);
    fox.anim = makeAnimator(root, g.animations, { sit: 'Survey', walk: 'Walk', run: 'Run' });
    fox.anim.loop('sit');
  });
  function petFox() {
    for (let i = 0; i < 10; i++) emit(fox.x + rand(-0.3, 0.3), fox.y + 0.7, fox.z + rand(-0.3, 0.3), rand(-0.8, 0.8), rand(1.5, 3), rand(-0.8, 0.8), 1.2, 0xff7aa8, 0.45, 1, -0.4);
    Sound.yip(); fox.happy = 1.4;
    if (!fox.joined) {
      fox.joined = true; fox.st = 'follow'; fox.seekT = 20;
      toast('i-paw', 'Лиса Искра теперь с вами', 'c-amber');
      Dialog.play([['iris', 'Пилот, у вас попутчик. Судя по повадкам, она чует осколки.']]);
      save();
    }
  }
  INTER.push({ pos: () => fox.g.position, r: 2.4, get label() { return fox.joined ? 'Погладить Искру' : 'Погладить лису'; }, icon: 'i-paw', noAnim: true, when: () => !G.riding, act: petFox });
  { const el = document.createElement('div'); el.className = 'cmp-m'; el.innerHTML = ICON('i-paw', 'c-amber'); cmp.appendChild(el); cmpMarks.push({ icon: 'i-paw', p: () => fox.g.position, hide: () => fox.st !== 'wait', el }); }
  function updateFox(dt) {
    const dx = player.x - fox.x, dz = player.z - fox.z, d = Math.hypot(dx, dz);
    let tx = fox.x, tz = fox.z, want = 0;
    if (fox.st === 'wild') {
      if (d < 10) fox.yaw += wrapA(Math.atan2(dx, dz) + Math.PI - fox.yaw) * Math.min(1, dt * 2);
    } else {
      fox.seekT -= dt;
      if (fox.st === 'follow') {
        const bx = player.x + Math.sin(player.face) * 2.6 + Math.cos(player.face) * 1.6, bz = player.z + Math.cos(player.face) * 2.6 - Math.sin(player.face) * 1.6;
        if (d > 90) { fox.x = bx; fox.z = bz; }
        tx = bx; tz = bz; const bd = Math.hypot(bx - fox.x, bz - fox.z);
        want = bd > 1.2 ? (G.riding ? 18 : bd > 9 ? 13 : 6.5) : 0;
        const ai = !G.riding ? Controllers.intent(fox) : null;   // the AI layer's advice (ai.js): lead to a shard / circle / stay put
        if (ai === 'lead_player_to_shard' && fox.seekT > 1) fox.seekT = 0;
        else if (ai === 'circle' && d < 8) { const st = Controllers.steer(fox, 'circle', 'fox'); tx = st.tx; tz = st.tz; want = st.speed; }
        else if ((ai === 'graze' || ai === 'alert') && d < 6) want = 0;
        if (fox.seekT <= 0) {
          fox.seekT = 14;
          const busy = enemies.some((e) => !e.dead && e.st !== 'idle' && e.st !== 'return') || (boss.active && !boss.dead);
          if (!busy && !G.riding) {
            let best = null, bdist = 75;
            { const t = D.Things.nearest('shard', player.x, player.z, bdist, (q) => !q.taken); if (t) best = t.native; }
            if (best) { fox.target = best; fox.st = 'seek'; Sound.yip(); toast('i-paw', 'Искра что-то учуяла', 'c-amber'); }
          }
        }
      } else if (fox.st === 'seek' || fox.st === 'wait') {
        const s = fox.target;
        if (!s || s.taken || d > 120) { fox.st = 'follow'; fox.seekT = 18; fox.target = null; }
        else {
          tx = s.x; tz = s.z; const sd = Math.hypot(s.x - fox.x, s.z - fox.z);
          if (fox.st === 'seek') { want = sd > 1.8 ? 12 : 0; if (sd <= 1.8) fox.st = 'wait'; }
          else {
            fox.yaw += wrapA(Math.atan2(dx, dz) + Math.PI - fox.yaw) * Math.min(1, dt * 3);
            fox.yipT -= dt; if (fox.yipT <= 0) { fox.yipT = 3; if (d < 70) Sound.yip(); }
            if (Math.random() < dt * 4) emit(s.x + rand(-0.6, 0.6), s.y, s.z + rand(-0.6, 0.6), 0, rand(1, 2), 0, 0.9, 0xffb347, 0.4, 1, -0.5);
          }
        }
      }
    }
    const mx = tx - fox.x, mz = tz - fox.z, ml = Math.hypot(mx, mz);
    if (fox.vMax) want = Math.min(want, fox.vMax);   // the gait's top speed (interaction module): faster, the paws would skate
    fox.speed = want > fox.speed ? Math.min(want, fox.speed + 7 * dt) : damp(fox.speed, want, 5, dt);   // run-up ≤ 7 m/s²: the gait gets its steps in
    if (ml > 0.05 && fox.speed > 0.1) {
      const st = Math.min(ml, fox.speed * dt); fox.x += mx / ml * st; fox.z += mz / ml * st;
      fox.yaw += wrapA(Math.atan2(-mx, -mz) - fox.yaw) * Math.min(1, dt * 8);
    }
    collide(fox, 0.35);
    fox.y = groundH(fox.x, fox.z);
    fox.happy = Math.max(0, fox.happy - dt);
    fox.g.position.set(fox.x, fox.y + (fox.happy > 0 ? Math.abs(Math.sin(fox.happy * 10)) * 0.25 : 0), fox.z); fox.g.rotation.y = fox.yaw;
    if (fox.anim) {
      const k = fox.speed > 7 ? 'run' : fox.speed > 0.6 ? 'walk' : 'sit';
      fox.anim.loop(k, 0.25);
      if (k === 'walk') fox.anim.speed('walk', clamp(fox.speed / 2.2, 0.6, 2.2));
      if (k === 'run') fox.anim.speed('run', clamp(fox.speed / 9, 0.8, 1.8));
      fox.anim.update(dt);
    }
  }

  const STAGS = [];
  loadPacked('animal_stag', ASSET, (g) => {
    // i01–i05 reference photos: pale grey-fawn hide, matte. The shipped pack's diffuse texture is a saturated red-brown
    // ("red deer" in the baseline review) — multiplying material.color by a near-uniform grey only scales brightness,
    // it can't desaturate a hue (every channel gets the same factor, so the ratio between them — the hue — is
    // unchanged; confirmed by look-gate's own render still reading brown after that first attempt). Dropping the map
    // and using a flat pale hide colour does change the hue, same fix pattern already proven on the fox below.
    // NATURE: the flat tint lost every marking (a plastic toy). The texture is kept and re-mapped by its LUMINANCE onto a
    // reindeer palette (i01–i05): dark grey-brown back/legs → grey-fawn flanks → cream neck/belly; the fur detail (high
    // frequency luminance) stays, the red-brown hue goes. Antlers: velvet-less bone/brown, darker tips. Eyes untouched.
    const base = prepModel(g.scene, 0, (m) => {
      m.roughness = 0.92; m.metalness = 0;
      if ('envMapIntensity' in m) m.envMapIntensity = 0.4;
      if (m.map && /body|head/i.test(m.name || '')) {
        m.color.setRGB(1, 1, 1);
        m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          { float hl = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)); float hb = diffuseColor.b / max(diffuseColor.r, 1e-3);
            float t = smoothstep(.015, .12, hl);
            vec3 hide = mix(vec3(.16, .14, .115), vec3(.46, .43, .37), t);           // grey-brown → grey-fawn (linear, paler than i01–i05's night read)
            hide = mix(hide, vec3(.66, .64, .58), smoothstep(.12, .28, hl));          // cream neck / rump / belly
            diffuseColor.rgb = hide * mix(1., .7, smoothstep(1.4, 2.4, hb)); }`); };
        m.customProgramCacheKey = () => 'stagHide';
      } else if (m.map && /antler/i.test(m.name || '')) { m.color.setRGB(0.75, 0.68, 0.6); }
      else if (!m.map && m.color && !/eye/i.test(m.name || '')) m.color.setHex(0xc9c2b4);
      m.needsUpdate = true;
    });
    // REALISM-QA rule 2: the eyes (39 sRGB) up to the albedo floor (wet dark eye ≈ 0.04 linear), hue kept
    if (window.STRUCT && STRUCT.albedoFloor) base.traverse((o) => { if (o.isMesh && /eye/i.test(([].concat(o.material)[0] || {}).name || '')) STRUCT.albedoFloor(o); });
    const spots = [[-110, 40], [-95, 55], [-120, 58], [135, -45], [150, -30], [60, 150]];
    for (const [x, z] of spots) {
      if (getH(x, z) < 1 || inRift(x, z)) continue;
      const root = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(base) : (STAGS.length ? null : base);
      if (!root) break;
      const grp = new THREE.Group(); const wrap = new THREE.Group(); wrap.add(root); grp.add(wrap); scene.add(grp);   // the stag model faces +Z = the group's yaw direction (sin yaw, cos yaw): no flip
      const A = makeAnimator(root, g.animations, { idle: 'Idle', eat: 'Eat', look: 'LookAround', run: 'Run' });
      A.loop(['idle', 'eat', 'look'][STAGS.length % 3]);
      STAGS.push({ g: grp, A, x, z, hx: x, hz: z, yaw: Math.random() * 6.28, st: 'graze', t: rand(3, 8), vx: 0, vz: 0 });
    }
    // 20-clip phase-synced gait set (ANIMLIB.md): merge once the pack lands, into every stag already built above (the
    // spots loop just ran synchronously; this pack's <script> tag resolves later). modules/interaction.js drives the
    // per-stag ANIMLIB.GaitBlender from s.A.acts + s.gaitMeta while fleeing (walk/trot/canter/gallop, speed-matched).
    if (window.ANIMLIB) loadPacked('anim_stag_gaits', ASSET, (lib) => {
      const meta = ANIMLIB.meta(lib); if (!meta) return;
      for (const s of STAGS) { for (const c of lib.animations) if (!s.A.acts[c.name]) s.A.acts[c.name] = s.A.mixer.clipAction(c); s.gaitMeta = meta; }
    });
  });
  function updateStags(dt) {
    for (const s of STAGS) {
      const dx = s.x - player.x, dz = s.z - player.z, d = Math.hypot(dx, dz);
      const camD = Math.hypot(s.x - camera.position.x, s.z - camera.position.z);
      s.t -= dt;
      if (s.st === 'graze') {
        const ai = Controllers.intent(s);   // the AI layer's advice (ai.js): alert / approach / flee; none → flee inside 26 m
        if (ai === 'alert' || ai === 'approach') { if (d >= 10) { if (s.lk !== 1) { s.lk = 1; s.A.loop('look', 0.3); } s.yaw += wrapA(Math.atan2(-dx, -dz) - s.yaw) * Math.min(1, dt * 3); } }
        else s.lk = 0;
        if ((ai ? ai === 'flee' || d < 10 : d < 26) && G.mode === 'play') { s.st = 'flee'; s.t = rand(4, 6); s.fx = dx / (d || 1); s.fz = dz / (d || 1); s.A.loop('run', 0.15); }
        else if (s.t <= 0) { s.t = rand(4, 9); s.A.loop(['idle', 'eat', 'look', 'eat'][(Math.random() * 4) | 0], 0.4); }
      } else {
        const hd = Math.hypot(s.x - s.hx, s.z - s.hz);
        if (hd > 110) { s.fx = (s.hx - s.x) / hd; s.fz = (s.hz - s.z) / hd; }
        const x0 = s.x, z0 = s.z, want = Math.hypot(s.fx, s.fz) * 11;
        s.x += s.fx * 11 * dt; s.z += s.fz * 11 * dt; collide(s, 0.8); boundary(s, 420);
        // blocked (tree, rock, the island edge): run along it — the flee direction becomes the direction it actually got
        const mvx = s.x - x0, mvz = s.z - z0, got = Math.hypot(mvx, mvz) / Math.max(dt, 1e-4);
        if (want > 1 && got < want * 0.7 && got > 0.2) { const k = Math.hypot(s.fx, s.fz) / (got * dt); s.fx = mvx * k; s.fz = mvz * k; }
        s.yaw += wrapA((got > 1 ? Math.atan2(mvx, mvz) : Math.atan2(s.fx, s.fz)) - s.yaw) * Math.min(1, dt * 6);   // the body faces where it really goes
        if (s.t <= 0 && d > 40) { s.st = 'graze'; s.t = rand(3, 6); s.A.loop('look', 0.4); }
        if (Math.random() < dt * 8) emit(s.x, groundH(s.x, s.z) + 0.1, s.z, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), 0.6, 0x9fb4d8, 0.5, 2, 1);
      }
      s.g.position.set(s.x, groundH(s.x, s.z), s.z); s.g.rotation.y = s.yaw;
      s.g.visible = camD < 320;
      // interaction.js drives s.A.mixer itself (via ANIMLIB.GaitBlender) while gaitDriving is set — one mixer.update() per
      // frame either way, never both (double-advances idle/eat/look clips otherwise)
      if (camD < 220 && !s.gaitDriving) s.A.update(dt);
    }
  }
    // loading a save: a fox that had joined the pilot is with them again
    if (window.Progress) window.Progress.onRestore((x) => { if (x.fox) { fox.joined = true; fox.st = 'follow'; } });

    return { fox, STAGS, petFox, updateFox, updateStags };
  };
})();
