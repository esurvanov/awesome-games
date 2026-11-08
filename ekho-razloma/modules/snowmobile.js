/* modules/snowmobile.js — Snowmobile (the skimmer): the vehicle the pilot rides after Orm gives it to them.
 * Classic script, loaded before the page: window.createSnowmobile(deps) → { sk, mount(), dismount(), callSkimmer(), updateSkimmer(dt, ix, iy) }
 *   sk   { x, y, z, yaw, speed, mounted, unlocked, g, seat, fallback, … }   saved as `sk` = sk.unlocked
 * Riding is the fact Player.riding (modules/player-control.js; G.riding is its old name, read by 80 places: camera, fox, enemies, pickups); mount/dismount are its only
 * writers, through Player.board() / Player.leave().
 * Physics (PH.vh) drives the sled when available, a simple arcade model otherwise. modules/structures.js swaps in the real model.
 * deps (open-world.html builds them): helpers and scene objects below; D.cam, D.pressed, D.AV, D.T, D.K are read at run time (the page defines
 * them after this module is created) and D.shake is a setter for the camera shake the page owns. */
(function () {
  'use strict';
  window.createSnowmobile = function (D) {
    const { std, glow, scene, WORLD, groundH, PH, Sound, player, boundary, collide, clamp, damp, rand, emit, burst, phSync, animChar, V3 } = D;
    const tmp = new V3();   // scratch vector of its own (the page's shared one is only ever set before it is read, so this changes nothing)
    const sk = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, mounted: false, unlocked: false, g: new THREE.Group() };
    (function buildSkimmer() {
      // fallback look until modules/structures.js swaps in the snowmobile model (it hides sk.fallback, fills sk.seat)
      const g = new THREE.Group(), white = std(0xd9e1ea, 0.4, 0.4), dark = std(0x222b45, 0.5, 0.5), glowM = new THREE.MeshBasicMaterial({ color: 0x7fe3ff });
      sk.g.add(g); sk.fallback = g; sk.seat = { x: 0, y: 0.55, z: 0.5, drop: 0.42 };   // rider anchor in sk.g space; drop = anchor → avatar root
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 3.4), white); hull.position.y = 0.3; g.add(hull);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.6, 4), white); nose.rotation.set(-Math.PI / 2, Math.PI / 4, 0); nose.scale.set(1, 1, 0.45); nose.position.set(0, 0.3, -2.4); g.add(nose);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 1), dark); seat.position.set(0, 0.65, 0.5); g.add(seat);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.08), new THREE.MeshStandardMaterial({ color: 0x0c2a44, emissive: 0x1d6dbb, emissiveIntensity: 0.4, transparent: true, opacity: 0.7 }));
      wind.position.set(0, 0.8, -0.6); wind.rotation.x = -0.5; g.add(wind);
      for (const sx of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3.2, 8), dark); pod.rotation.x = Math.PI / 2; pod.position.set(sx * 1.05, 0.15, 0.1); g.add(pod);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 2.8), glowM); strip.position.set(sx * 1.05, -0.16, 0.1); g.add(strip);
        const gl = glow(0x7fe3ff, 2.2, 0.7); gl.position.set(sx * 1.05, -0.3, 0.1); g.add(gl);
        const eg = glow(0xff9a3c, 1.4); eg.position.set(sx * 1.05, 0.15, 1.8); g.add(eg);
      }
      g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      scene.add(sk.g);
      const v = WORLD.stationW(-7, 11); sk.x = v.x; sk.z = v.z; sk.yaw = 0.6; sk.y = groundH(v.x, v.z) + 0.7;
    })();

    function mount() {
      D.Player.board(); sk.mounted = true; player.vx = player.vz = player.vy = 0; Sound.whoosh(); D.cam.yaw = sk.yaw;
      if (PH.ok) { PH.ch.setEnabled(false); PH.vh.setEnabled(true); PH.vh.teleport(sk.x, groundH(sk.x, sk.z) + 1.2, sk.z, sk.yaw); }
    }
    function dismount() {
      D.Player.leave(); sk.mounted = false; sk.speed = 0;
      player.face = sk.yaw; player.c.g.rotation.set(0, sk.yaw, 0); player.vx = player.vz = player.vy = 0;   // drop the sled's quaternion (pitch/roll, Euler flip)
      const rx = Math.cos(sk.yaw), rz = -Math.sin(sk.yaw);
      player.x = sk.x + rx * 2.2; player.z = sk.z + rz * 2.2; player.y = groundH(player.x, player.z) + 0.5; player.c.body.position.y = 0;
      if (PH.ok) { PH.vh.setEnabled(false); PH.ch.setEnabled(true); phSync(); }
      Sound.setEngine(false, 0);
    }
    function callSkimmer() {
      if (!sk.unlocked || D.G.riding) return;
      const fx = -Math.sin(D.cam.yaw), fz = -Math.cos(D.cam.yaw);
      sk.x = player.x + fx * 4 + Math.cos(D.cam.yaw) * 2; sk.z = player.z + fz * 4 - Math.sin(D.cam.yaw) * 2; sk.yaw = D.cam.yaw; sk.y = groundH(sk.x, sk.z) + 0.8;
      collide(sk, 1.6);
      burst(sk.x, sk.y, sk.z, 0x7fe3ff, 50, 8, 0.8, 0.6); Sound.whoosh();
    }

    function updateSkimmer(dt, ix, iy) {
      const boost = D.K('ShiftLeft', 'ShiftRight');
      let ahead, behind;
      if (PH.ok && PH.vh) {
        const s = PH.vh.update(dt, iy, ix, boost, D.pressed.has('Space'));
        // skis bite: the sled goes where it points. Extra lateral grip (strong when coasting, where the pads' downhill push
        // would crab it sideways) and no creeping backwards without reverse input. A boosted hard turn keeps its drift.
        if (s.grounded && PH.vh.body && !(boost && Math.abs(ix) > 0.5)) {
          const b = PH.vh.body, lv = b.linvel(), fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = -fz, rz = fx;
          let vf = lv.x * fx + lv.z * fz, vr = lv.x * rx + lv.z * rz;
          vr *= Math.exp(-(iy === 0 ? 10 : 3) * dt); if (vf < 0 && iy >= 0) vf *= Math.exp(-8 * dt);
          b.setLinvel({ x: fx * vf + rx * vr, y: lv.y, z: fz * vf + rz * vr }, true);
        }
        sk.x = s.position.x; sk.y = s.position.y; sk.z = s.position.z; sk.yaw = s.yaw; sk.speed = s.speed;
        if (Math.hypot(sk.x, sk.z) > 440) { boundary(sk, 440); PH.vh.teleport(sk.x, groundH(sk.x, sk.z) + 1.2, sk.z, sk.yaw); }
        sk.g.position.set(sk.x, sk.y, sk.z); sk.g.quaternion.set(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w); sk.g.rotateZ(s.bank);
        if (s.impact > 8) { D.shake = Math.min(1, s.impact / 30); Sound.step(); }
      } else {
      sk.speed += iy * (iy > 0 ? 30 : 40) * dt; sk.speed *= Math.exp(-(iy === 0 ? 0.9 : 0.35) * dt);
      sk.speed = clamp(sk.speed, -12, boost ? 58 : 44);
      const turn = -ix * dt * 1.9 * clamp(Math.abs(sk.speed) / 12, 0.35, 1) * (sk.speed < -0.5 ? -1 : 1);
      sk.yaw += turn;
      sk.x += -Math.sin(sk.yaw) * sk.speed * dt; sk.z += -Math.cos(sk.yaw) * sk.speed * dt;
      if (collide(sk, 1.6)) { sk.speed *= 0.6; if (Math.abs(sk.speed) > 12) { D.shake = 0.3; Sound.step(); } }
      boundary(sk, 440);
      ahead = groundH(sk.x - Math.sin(sk.yaw) * 2, sk.z - Math.cos(sk.yaw) * 2); behind = groundH(sk.x + Math.sin(sk.yaw) * 2, sk.z + Math.cos(sk.yaw) * 2);
      const gh = Math.max(groundH(sk.x, sk.z), (ahead + behind) / 2);
      if (D.pressed.has('Space') && sk.y < gh + 1.6) sk.vy = 9;
      sk.vy = (sk.vy || 0) - 22 * dt; sk.y += sk.vy * dt;
      if (sk.y < gh + 1.1) { sk.y = damp(sk.y, gh + 1.1, 14, dt); if (sk.y < gh + 0.5) sk.y = gh + 0.5; sk.vy = Math.max(sk.vy, 0); }
      sk.g.position.set(sk.x, sk.y, sk.z);
      sk.g.rotation.set(0, 0, 0); sk.g.rotateY(sk.yaw); sk.g.rotateX(clamp(Math.atan2(ahead - behind, 4), -0.5, 0.5)); sk.g.rotateZ(-ix * clamp(sk.speed / 40, 0, 1) * 0.35);
      }
      // rider
      const seat = sk.seat; tmp.set(seat.x, seat.y, seat.z); sk.g.localToWorld(tmp);
      player.x = sk.x; player.z = sk.z; player.y = tmp.y - 0.55;
      tmp.set(seat.x, seat.y - (D.AV.player ? seat.drop : 0.35), seat.z); sk.g.localToWorld(tmp);   // avatar root under the seat, tilted with the sled
      player.c.g.position.copy(tmp); player.c.g.quaternion.copy(sk.g.quaternion); player.face = sk.yaw;
      animChar(player.c, dt, 0, false, false, true); D.driveAvatar(dt, 'ride');
      if (Math.random() < 0.3 + Math.abs(sk.speed) / 60) { const sp = sk.spray || { w: 1, y: -0.2, z: 1.8 }; tmp.set(rand(-sp.w, sp.w), sp.y, sp.z); sk.g.localToWorld(tmp); emit(tmp.x, tmp.y, tmp.z, rand(-1, 1), rand(0.5, 2), rand(-1, 1), 0.5, sk.speed > 30 ? 0x9fefff : 0x8fa4c8, rand(0.3, 0.7), 2, 1); }
      Sound.setEngine(true, clamp(Math.abs(sk.speed) / 50, 0, 1));
      if (D.pressed.has('KeyE')) { dismount(); D.pressed.delete('KeyE'); }
      player.c.g.visible = player.inv > 0 ? Math.floor(D.T * 16) % 2 === 0 : true;
    }

    // the save: whether Orm has given the snowmobile to the pilot
    window.Progress.persist('sk', { order: 10, save: () => sk.unlocked, load: (v) => { sk.unlocked = !!v; } });

    return { sk, mount, dismount, callSkimmer, updateSkimmer };
  };
})();
