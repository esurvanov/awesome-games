/* modules/combat.js — Combat: the shardlings, the guardian (boss), the pilot's bolts and the heals they drop.
 * Classic script, loaded before the page: window.createCombat(deps) → { enemies, ZONES, boss, bolts, heals, waves, spawnShardling, killEnemy, shatter,
 *   spawnHeal, spawnWave, spawnBolt, fireBolt, updateEnemies(dt), updateBoss(dt), volley, bossHit, updateBolts(dt) }
 *   enemies  the live shardlings (kinds: shardling, golem = boss)      ZONES   the places they wake up in; cleared zones are in G.cleared
 *   boss     the crystal guardian: idle → … → dead → the heart drops (story: modules/ending.js after the choice)
 * modules/structures.js swaps in the real models and hooks (boss.anim, boss.onDeath, STRUCT.shardling); the page keeps every old name as an alias.
 * deps (open-world.html builds them): the helpers named below; X.G, X.Dialog, X.AV, X.handTip, X.T are read at run time (the page defines them after this
 * module is created) and X.shake is a setter for the camera shake the page owns. Scratch vectors are its own. */
(function () {
  'use strict';
  window.createCombat = function (X) {
    const { player, rand, scene, Sound, POI, glow, burst, OCT, PH, camera, RIFT_FLOOR, playerHurt, $, groundH, toast, save, wrapA, damp, emit, V3, collide, clamp,
      setStage, getH, toolTip } = X;
    const D = window.STORY_DATA.D, tmp = new V3(), tmp2 = new V3(), fwd = new V3();
    const enemies = [];
    const eMatBase = { color: 0x8fc8ff, emissive: 0x3a1a9a, emissiveIntensity: 1.4, roughness: 0.05, metalness: 0.3, flatShading: true };
    function spawnShardling(x, z, zone) {
      // crystal creature model with Idle/Move/Attack/Hit/Death (modules/structures.js drives the clips from e.st); octahedra only as a fallback
      const v = window.STRUCT && STRUCT.shardling ? STRUCT.shardling() : null;
      let g, core, mat, orbit, eye;
      if (v) ({ g, core, mat, orbit, eye } = v);
      else {
        g = new THREE.Group(); mat = new THREE.MeshStandardMaterial(eMatBase);
        core = new THREE.Mesh(OCT, mat); core.scale.set(0.7, 1.1, 0.7); core.castShadow = true; g.add(core);
        orbit = new THREE.Group(); g.add(orbit);
        for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(OCT, mat); const a = i / 5 * 6.28; s.scale.set(0.18, 0.42, 0.18); s.position.set(Math.cos(a) * 1.1, Math.sin(a * 2) * 0.3, Math.sin(a) * 1.1); orbit.add(s); }
        eye = glow(0xff4d9d, 1.4); eye.position.set(0, 0.2, -0.6); g.add(eye);
      }
      const y = groundH(x, z) + 1.3; g.position.set(x, y, z); scene.add(g);
      burst(x, y, z, 0xc49bff, 25, 6, 0.7, 0.5);
      const e = { g, core, mat, orbit, eye, x, z, y, hx: x, hz: z, hp: 3, st: 'idle', t: rand(0, 2), dx: 0, dz: 0, flash: 0, zone, hitDone: false, bob: rand(0, 6), wx: x, wz: z,
        anim: v ? v.anim : null, shardGeo: v ? v.shardGeo : null };
      enemies.push(e); return e;
    }
    function killEnemy(e, silent) {
      e.dead = true;
      if (e.anim && !silent && window.STRUCT && STRUCT.dying) STRUCT.dying(e);   // Death clip (core shrinks, shards fly), then removed
      else scene.remove(e.g);
      if (!silent) {
        burst(e.x, e.y, e.z, 0x9fdfff, 40, 12, 0.9, 0.6); burst(e.x, e.y, e.z, 0xc49bff, 20, 8, 0.8, 0.5); Sound.kill();
        shatter(e.x, e.y, e.z, e.mat, 10, 0.5, e.shardGeo);
        if (Math.random() < 0.4) spawnHeal(e.x, e.y, e.z);
      }
    }
    function shatter(x, y, z, mat, n, sz, geo) {
      if (!PH.ok) return;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(geo || OCT, mat), s = sz * rand(0.3, 0.7); m.castShadow = true;
        if (geo) m.scale.setScalar(rand(0.7, 1.5)); else m.scale.set(s, s * rand(1, 2.2), s);   // model shards are already quartz-shaped
        m.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
        m.position.set(x + rand(-0.6, 0.6), y + rand(-0.6, 0.6), z + rand(-0.6, 0.6)); scene.add(m);
        PH.P.spawnDebris(m, { shape: 'convex', mass: 0.5, lifetime: rand(5, 8), velocity: { x: rand(-6, 6), y: rand(3, 8), z: rand(-6, 6) }, angularVelocity: { x: rand(-9, 9), y: rand(-9, 9), z: rand(-9, 9) } });
      }
    }
    const heals = [];
    function spawnHeal(x, y, z) { const g = glow(0x5cf5c0, 1.6); g.position.set(x, y, z); scene.add(g); heals.push({ g, x, y, z, t: 12 }); }

    const ZONES = [
      { id: 'lake', x: POI.lake.x, z: POI.lake.z, n: 4, r: 16, trig: 55, need: () => X.G.stage >= 2 },
      { id: 'spireN', x: POI.spireN.x, z: POI.spireN.z, n: 4, r: 13, trig: 50, need: () => X.G.hasTool },
      { id: 'spireW', x: POI.spireW.x, z: POI.spireW.z, n: 5, r: 13, trig: 50, need: () => X.G.hasTool },
      { id: 'spireE', x: POI.spireE.x, z: POI.spireE.z, n: 5, r: 13, trig: 50, need: () => X.G.hasTool },
      { id: 'ruinNW', x: -200, z: -190, n: 3, r: 9, trig: 40, need: () => X.G.hasTool },
      { id: 'ruinN', x: 140, z: -215, n: 3, r: 9, trig: 40, need: () => X.G.hasTool },
      { id: 'rim', x: 75, z: -105, n: 3, r: 10, trig: 40, need: () => X.G.hasTool },
    ];

    const boss = { active: false, dead: false, hp: 50, max: 50, st: 'idle', t: 0, atk: 3, phase: 1, summoned: false, x: 0, y: 0, z: 0, g: null, flash: 0 };
    (function buildBoss() {
      // fallback crystal body; modules/structures.js replaces it with the rigged crystal golem (boss.anim drives its clips)
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x5a4a9a, emissive: 0x3a1a8a, emissiveIntensity: 1, roughness: 0.2, metalness: 0.3, flatShading: true });
      const add = (sx, sy, sz, x, y, z, rz = 0, parent = g) => { const m = new THREE.Mesh(OCT, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; parent.add(m); return m; };
      add(2.2, 3.2, 1.6, 0, 3.2, 0); add(1, 1.3, 1, 0, 7.2, 0);
      add(1.6, 0.8, 1.2, -2.6, 5.2, 0, 0.5); add(1.6, 0.8, 1.2, 2.6, 5.2, 0, -0.5);
      const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-3.6, 4.8, 0); armR.position.set(3.6, 4.8, 0); g.add(armL, armR);
      for (const a of [armL, armR]) { add(0.7, 2, 0.7, 0, -1.6, 0, 0, a); add(1, 1.4, 1, 0, -4, 0, 0, a); }
      const core = glow(0xff5cc8, 4.5); core.position.set(0, 3.6, -1.2); g.add(core);
      const eyes = glow(0xff4d9d, 1.8); eyes.position.set(0, 7.3, -0.8); g.add(eyes);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.12, 6, 40), new THREE.MeshBasicMaterial({ color: 0xc49bff })); halo.position.set(0, 7.4, 1); g.add(halo);
      g.visible = false; scene.add(g);
      Object.assign(boss, { g, mat, core, armL, armR, halo });
    })();
    const waves = [];
    const RING_M = new THREE.MeshBasicMaterial({ color: 0xff5cc8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    function spawnWave(x, z, y) { const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), RING_M); m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.3, z); scene.add(m); waves.push({ m, x, z, r: 1, hit: false }); }

    /* ---------- projectiles ---------- */
    const bolts = [];
    const SPIKE_M = new THREE.MeshBasicMaterial({ color: 0xff7ad0 });
    function spawnBolt(x, y, z, dx, dy, dz, spd, enemy) {
      const g = new THREE.Group();
      if (enemy) { const m = new THREE.Mesh(OCT, SPIKE_M); m.scale.set(0.2, 0.2, 0.7); g.add(m); g.add(glow(0xff4d9d, 1.8)); }
      else { g.add(glow(0x7fe3ff, 1.4)); g.add(glow(0xffffff, 0.5)); }
      g.position.set(x, y, z); if (enemy) g.lookAt(x + dx, y + dy, z + dz); scene.add(g);
      bolts.push({ g, x, y, z, vx: dx * spd, vy: dy * spd, vz: dz * spd, life: enemy ? 3 : 1.1, enemy });
    }

    function fireBolt() {
      camera.getWorldDirection(fwd);
      if (X.AV.hand) tmp.copy(X.handTip.position); else toolTip.getWorldPosition(tmp);
      let aim = null, best = 0.14;
      const consider = (x, y, z) => { tmp2.set(x - camera.position.x, y - camera.position.y, z - camera.position.z); const d = tmp2.length(); if (d > 70) return; const a = fwd.angleTo(tmp2); if (a < best) { best = a; aim = new V3(x, y, z); } };
      for (const e of enemies) if (!e.dead) consider(e.x, e.y, e.z);
      if (boss.active && !boss.dead) consider(boss.x, boss.y + 3.6, boss.z);
      if (!aim) aim = camera.position.clone().addScaledVector(fwd, 80);
      tmp2.subVectors(aim, tmp).normalize();
      spawnBolt(tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z, 75, false);
      Sound.fire(); burst(tmp.x, tmp.y, tmp.z, 0x7fe3ff, 6, 3, 0.2, 0.3, 0);
    }
    function updateEnemies(dt) {
      let combat = 0;
      for (const z of ZONES) {
        if (X.G.cleared.includes(z.id) || z.active || !z.need()) continue;
        if (Math.hypot(player.x - z.x, player.z - z.z) < z.trig) {
          z.active = true; z.list = [];
          for (let i = 0; i < z.n; i++) { const a = i / z.n * 6.283 + rand(-0.3, 0.3), d = z.r * rand(0.6, 1.1); let x = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d;
            const pd = Math.hypot(x - player.x, zz - player.z); if (pd < 7) { x = player.x + (x - player.x) / (pd || 1) * 7; zz = player.z + (zz - player.z) / (pd || 1) * 7; }   // never on top of the pilot (a save inside the arena)
            z.list.push(spawnShardling(x, zz, z)); }
          if (z.id === 'lake') X.Dialog.play(D.lake);
          Sound.whoosh();
        }
      }
      for (const z of ZONES) if (z.active && !X.G.cleared.includes(z.id) && z.list.every((e) => e.dead)) { X.G.cleared.push(z.id); z.active = false; toast('i-shield', 'Зона очищена', 'c-aur'); save(); }
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.dead) { enemies.splice(i, 1); continue; }
        const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz), hd = Math.hypot(e.x - e.hx, e.z - e.hz);
        e.t -= dt; let mv = 0, mx = 0, mz = 0; const px0 = e.x, pz0 = e.z;
        const alive = X.G.deadT <= 0;
        switch (e.st) {
          case 'idle':
            if (e.t <= 0) { e.wx = e.hx + rand(-6, 6); e.wz = e.hz + rand(-6, 6); e.t = rand(2, 4); }
            mx = e.wx - e.x; mz = e.wz - e.z; mv = Math.hypot(mx, mz) > 1 ? 2 : 0;
            if (d < 26 && alive) e.st = 'chase';
            break;
          case 'chase':
            mx = dx; mz = dz; mv = X.G.riding ? 10 : 7; combat = 1;
            if (d > 44 || hd > 65 || !alive) e.st = 'return';
            else if (d < 4.5) { e.st = 'windup'; e.t = 0.55; }
            break;
          case 'windup': combat = 1; e.g.position.x += rand(-0.08, 0.08); if (e.t <= 0) { e.st = 'dash'; e.t = 0.35; e.dx = dx / (d || 1); e.dz = dz / (d || 1); e.hitDone = false; } break;
          case 'dash':
            combat = 1; e.x += e.dx * 24 * dt; e.z += e.dz * 24 * dt;
            if (!e.hitDone && d < 1.5 && Math.abs(player.y + 1 - e.y) < 1.8) { e.hitDone = true; playerHurt(1, e.dx, e.dz); }
            if (e.t <= 0) { e.st = 'recover'; e.t = 0.9; }
            break;
          case 'recover': if (e.t <= 0) e.st = 'chase'; break;
          case 'return': mx = e.hx - e.x; mz = e.hz - e.z; mv = 8; if (hd < 3) e.st = 'idle'; if (d < 18 && alive) e.st = 'chase'; break;
        }
        if (mv) { const l = Math.hypot(mx, mz) || 1; e.x += mx / l * mv * dt; e.z += mz / l * mv * dt; }
        collide(e, 0.8);
        for (const o of enemies) if (o !== e && !o.dead) { const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz); if (od < 1.8 && od > 0.01) { e.x += ox / od * (1.8 - od) * 0.5; e.z += oz / od * (1.8 - od) * 0.5; } }
        e.y = groundH(e.x, e.z) + 1.3 + Math.sin(X.T * 2.5 + e.bob) * 0.25;
        // facing: the body turns into its real motion (dash, return, circling, separation pushes); standing still it watches the pilot
        { const vx = dt > 0 ? (e.x - px0) / dt : 0, vz = dt > 0 ? (e.z - pz0) / dt : 0, sp = Math.hypot(vx, vz);
          const want = e.st === 'dash' ? Math.atan2(-e.dx, -e.dz) : sp > 1.2 ? Math.atan2(-vx, -vz) : Math.atan2(-dx, -dz);
          if (e.yaw === undefined) e.yaw = want;
          e.yaw = wrapA(e.yaw + wrapA(want - e.yaw) * Math.min(1, dt * (e.st === 'dash' ? 40 : sp > 1.2 ? 16 : 8))); }
        e.g.position.set(e.x, e.y, e.z); e.g.rotation.y = e.yaw;
        e.orbit.rotation.y += dt * (e.st === 'windup' ? 9 : 2);
        e.flash -= dt;
        e.mat.emissive.setHex(e.flash > 0 ? 0xffffff : e.st === 'windup' || e.st === 'dash' ? 0xb0206a : 0x3a1a9a);
      }
      if (boss.active && !boss.dead) combat = 1;
      Sound.setCombat(combat);
    }
    function updateBoss(dt) {
      const rp = POI.rift;
      if (!boss.active && !boss.dead && X.G.stage === 6 && Math.hypot(player.x - rp.x, (player.z - rp.z) * 1.25) < 50 && !X.Dialog.active) {
        boss.active = true; boss.hp = boss.max; boss.x = rp.x; boss.z = rp.z - 6; boss.y = RIFT_FLOOR + 1; boss.st = 'intro'; boss.t = 2; boss.atk = 3; boss.summoned = false;
        boss.g.visible = true; boss.g.scale.setScalar(0.01); $('bossbar').hidden = false; $('bossFill').style.width = '100%';
        Sound.boom(); X.shake = 1.2; X.Dialog.play(D.bossIntro);
      }
      if (!boss.active || boss.dead) return;
      const dx = player.x - boss.x, dz = player.z - boss.z, d = Math.hypot(dx, dz);
      boss.t -= dt; boss.flash -= dt;
      const floorY = RIFT_FLOOR + 1.2;
      let targetY = floorY + (boss.anim ? 0 : Math.sin(X.T * 1.5) * 0.4);   // the golem walks; the fallback crystal hovers
      switch (boss.st) {
        case 'intro': boss.g.scale.setScalar(Math.min(1, boss.g.scale.x + dt * 0.7)); if (boss.t <= 0) boss.st = 'idle'; break;
        case 'idle': {
          let want = d > 13 ? 4.5 * boss.phase : d < 7 ? -3 : 0; if (boss.vMax) want = clamp(want, -boss.vMax * 0.6, boss.vMax);   // the golem's gait top speed (feet planted)
          boss.x += dx / (d || 1) * want * dt; boss.z += dz / (d || 1) * want * dt;
          boss.atk -= dt;
          if (boss.hp <= boss.max / 2 && !boss.summoned) { boss.summoned = true; boss.phase = 1.5; toast('i-skull', 'Страж зовёт осколышей', 'c-pink'); for (let i = 0; i < 3; i++) { const a = i * 2.1; spawnShardling(boss.x + Math.cos(a) * 9, boss.z + Math.sin(a) * 9, null).st = 'chase'; } }
          if (boss.atk <= 0) { boss.st = Math.random() < 0.5 ? 'rise' : 'charge'; boss.t = boss.st === 'rise' ? 0.9 : 0.7; }
          break;
        }
        case 'rise': targetY = floorY + 7; if (boss.t <= 0) { boss.st = 'drop'; boss.t = 0.45; } break;
        case 'drop': targetY = floorY - 0.5; if (boss.t <= 0) { spawnWave(boss.x, boss.z, RIFT_FLOOR); if (boss.phase > 1) setTimeout(() => boss.active && !boss.dead && spawnWave(boss.x, boss.z, RIFT_FLOOR), 450); Sound.slam(); X.shake = 1; burst(boss.x, RIFT_FLOOR + 0.5, boss.z, 0xc49bff, 60, 16, 0.8, 0.8); boss.st = 'recover'; boss.t = 0.9; } break;
        case 'charge': boss.core.scale.setScalar(4.5 + Math.sin(X.T * 40) * 1.5); if (boss.t <= 0) { volley(); boss.st = 'recover'; boss.t = 0.7; } break;
        case 'recover': if (boss.t <= 0) { boss.st = 'idle'; boss.atk = rand(1.8, 3) / boss.phase; boss.core.scale.setScalar(4.5); } break;
      }
      if (boss.st === 'rise') boss.y += Math.min(targetY - boss.y, (targetY - boss.y) * (1 - Math.exp(-4 * dt)), 14 * dt);   // leap, ≤ 14 m/s
      else if (boss.st === 'drop') boss.y = Math.max(targetY, boss.y - 18 * dt);   // slam: a hard fall, not a teleport (≤ 18 m/s)
      else boss.y = damp(boss.y, targetY, 3, dt);
      const rd = Math.hypot(boss.x - rp.x, (boss.z - rp.z) * 1.25); if (rd > 38) { boss.x = rp.x + (boss.x - rp.x) * 38 / rd; boss.z = rp.z + (boss.z - rp.z) * 38 / rd; }
      boss.g.position.set(boss.x, boss.y, boss.z); boss.g.rotation.y = damp(boss.g.rotation.y, Math.atan2(-dx, -dz), 3, dt);
      boss.armL.rotation.x = Math.sin(X.T * 1.3) * 0.3 + (boss.st === 'rise' ? -2.2 : 0); boss.armR.rotation.x = Math.cos(X.T * 1.3) * 0.3 + (boss.st === 'rise' ? -2.2 : 0);
      boss.halo.rotation.z += dt * 1.5;
      if (boss.anim) boss.anim(dt, d);   // golem: clips (rise/slam/charge/volley/summon/hit), glow, emerge
      else boss.mat.emissive.setHex(boss.flash > 0 ? 0xffffff : boss.st === 'charge' || boss.st === 'rise' ? 0x9a1a6a : 0x3a1a8a);
      if (d < 3.4 && Math.abs(player.y - boss.y) < 6) playerHurt(1, dx, dz);
    }
    function volley() {
      const n = boss.phase > 1 ? 7 : 5; Sound.spike();
      const sx = boss.x, sy = boss.y + 3.8, sz = boss.z;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.13;
        tmp.set(player.x - sx, player.y + 1 - sy, player.z - sz).normalize();
        const a = Math.atan2(tmp.x, tmp.z) + spread;
        const hl = Math.hypot(tmp.x, tmp.z);
        spawnBolt(sx, sy, sz, Math.sin(a) * hl, tmp.y, Math.cos(a) * hl, 20, true);
      }
    }
    function bossHit() {
      boss.hp--; boss.flash = 0.08; Sound.hitE(); $('bossFill').style.width = (boss.hp / boss.max * 100) + '%';
      if (boss.hp <= 0) {
        boss.dead = true; boss.active = false; if (!(boss.onDeath && boss.onDeath())) boss.g.visible = false; $('bossbar').hidden = true;   // golem plays Death, then crumbles
        for (let k = 0; k < 4; k++) burst(boss.x, boss.y + 3, boss.z, [0xc49bff, 0xff5cc8, 0x7fe3ff, 0xffffff][k], 90, 22, 1.6, 1);
        Sound.boom(); X.shake = 1.6;
        for (const e of enemies) if (!e.dead && !e.zone) killEnemy(e);
        for (const w of waves) scene.remove(w.m); waves.length = 0;
        save();
        setTimeout(() => X.Dialog.play(D.bossDead, () => setStage(7)), 1200);
      }
    }
    function updateBolts(dt) {
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        if (b.dead) { bolts.splice(i, 1); continue; }
        b.life -= dt;
        let ray = null;
        if (PH.ok && dt > 0) { const sp = Math.hypot(b.vx, b.vy, b.vz); ray = PH.P.raycast(b, { x: b.vx / sp, y: b.vy / sp, z: b.vz / sp }, sp * dt, { debris: true }); }
        if (ray) { b.x = ray.point.x; b.y = ray.point.y; b.z = ray.point.z; PH.P.applyImpulseAt(ray.collider, ray.point, { x: b.vx * 0.05, y: b.vy * 0.05, z: b.vz * 0.05 }); }
        else { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
        b.g.position.set(b.x, b.y, b.z);
        let hit = b.life <= 0 || !!ray || b.y < getH(b.x, b.z);
        if (!b.enemy) {
          emit(b.x, b.y, b.z, 0, 0, 0, 0.18, 0x7fe3ff, 0.35, 0, 0);
          for (const e of enemies) {
            if (e.dead) continue;
            if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 + (b.z - e.z) ** 2 < 1.7) { e.hp--; e.flash = 0.1; Sound.hitE(); e.x += b.vx * 0.012; e.z += b.vz * 0.012; if (e.st === 'idle') e.st = 'chase'; if (e.hp <= 0) killEnemy(e); hit = true; break; }
          }
          if (!hit && boss.active && !boss.dead && (b.x - boss.x) ** 2 + (b.y - boss.y - 3.6) ** 2 + (b.z - boss.z) ** 2 < 11) { bossHit(); hit = true; }
        } else {
          emit(b.x, b.y, b.z, 0, 0, 0, 0.2, 0xff4d9d, 0.4, 0, 0);
          if ((b.x - player.x) ** 2 + (b.y - player.y - 1.1) ** 2 + (b.z - player.z) ** 2 < 1.4) { playerHurt(1, b.vx, b.vz); hit = true; }
        }
        if (hit) { burst(b.x, b.y, b.z, b.enemy ? 0xff4d9d : 0x9fefff, 10, 5, 0.35, 0.35); scene.remove(b.g); bolts.splice(i, 1); }
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]; w.r += dt * 17; w.m.scale.set(w.r, w.r, 1); w.m.material.opacity = 0.8;
        const pd = Math.hypot(player.x - w.x, player.z - w.z);
        if (!w.hit && Math.abs(pd - w.r) < 1.3 && player.y - groundH(player.x, player.z) < 0.9) { w.hit = true; playerHurt(1, player.x - w.x, player.z - w.z); }
        if (w.r > 36) { scene.remove(w.m); waves.splice(i, 1); }
      }
    }


    return { enemies, eMatBase, spawnShardling, killEnemy, shatter, heals, spawnHeal, ZONES, boss, waves, RING_M, spawnWave, bolts, SPIKE_M, spawnBolt, fireBolt, updateEnemies, updateBoss, volley, bossHit, updateBolts };
  };
})();
