/* modules/structures-creatures.js — the models and animation of the shardlings and the crystal guardian (golem): clip sets, gait and foot locks, the die-and-shatter sequence, hooks the combat module reads (boss.anim, boss.onDeath, STRUCT.shardling). Moved out of modules/structures.js unchanged. Classic script, loaded BEFORE structures.js: window.createStructuresCreatures(deps) → { mergeInto, prepShardlings, isUnder, updateShardlings, buildGolem, updateGolem, bind({...}) }. */
(function () {
  'use strict';
  window.createStructuresCreatures = function (X) {
    const { rr, ST, clamp, need, warn, damp, count, flatten } = X;
    let C, THREE, V3;   // assigned later in the source module: set through bind()
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
  const GOLEM = ST.golem = { A: null, root: null, dieT: -1, prevX: 0, prevZ: 0, hurtCd: 0, lastSummon: false, lastSt: '', emBase: null };
  ST.golem = GOLEM;   // debug / QA probes
  function buildGolem() {
    need('boss_crystal_golem', (gl) => {
      const boss = C.boss, root = gl.scene;
      const skin = []; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.isSkinnedMesh) skin.push(o); } });
      const body = skin[0]; if (!body) { warn('golem: no skinned mesh'); return; }
      const mat = body.material.clone(); body.material = mat; GOLEM.emBase = mat.emissive.clone(); GOLEM.eiBase = mat.emissiveIntensity;
      const rock = root.getObjectByName('ThrowRock'); if (rock) rock.visible = false; GOLEM.rock = rock;
      for (const c of boss.g.children.slice()) c.visible = false;   // fallback crystal body
      const wrap = new THREE.Group(); wrap.position.y = -1.2; boss.g.add(wrap); GOLEM.wrap = wrap; GOLEM.root = root;
      const fix = new THREE.Group(); fix.add(root); wrap.add(fix); GOLEM.fix = fix;   // FIX-PERF: hip-speed limiter offset (see hipLimit)
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
      if (A.cur === 'wake' && Math.abs(GOLEM.vAlong || 0) > 0.3 && A.lock > 0) { A.lock = 0; GOLEM.wakeOut = 0.6; }   // it starts walking: the gait takes over from the stand-up clip
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
    A.loop(loopK, GOLEM.wakeOut > 0 ? 0.6 : 0.3); GOLEM.wakeOut = (GOLEM.wakeOut || 0) - dt;   // out of the stand-up clip: a longer blend
    if (!GOLEM.gait) { if (loopK === 'walk') A.speed('walk', clamp(sp / 3.2, 0.6, 1.7)); if (loopK === 'run') A.speed('run', clamp(sp / 6.5, 0.7, 1.5)); }
    if (GOLEM.rock) { GOLEM.showRock = (GOLEM.showRock || 0) - dt; GOLEM.rock.visible = GOLEM.showRock > 0; }
    A.update(dt); hipLimit(dt);
    // glow: flash on hits, hotter while charging / rising
    const m = boss.mat, hot = st === 'charge' || st === 'rise' || st === 'drop';
    if (boss.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 2.2; }
    else { m.emissive.copy(GOLEM.emBase); if (hot) m.emissive.lerp(new THREE.Color(0xff5cc8), 0.5); m.emissiveIntensity = GOLEM.eiBase * (hot ? 2 : 1); }
  }
  // FIX-PERF: clamped root motion. The 8 m golem's attack / hurt clips (and their cross-fades) swing the hip faster than
  // a giant moves (QA pose continuity ≤ 10 m/s). After the clips are sampled, any hip motion (in the boss group's space)
  // above HIP_VMAX is taken out by shifting the whole model the other way; that offset then drains back to zero within
  // the speed budget that is left, so the pose ends where the clip wants it, only never faster than a giant can move.
  const HIP_VMAX = 8;
  // ATTACK-STATES foot lock: updateBoss() only moves boss.x/z in the 'idle' state — rise/drop/charge/recover never
  // translate the group at all, yet those clips swing the pose hard (windup, lunge, twist), and a straight leg turns
  // even a modest hip *rotation* into a much bigger sweep at the ankle than at the hip — a hip-only speed clamp never
  // sees that (QA measured a "planted" foot sliding up to 2 m in one step mid-attack, median 0.67 m/step, while the
  // body itself never moved). During these frozen states hipLimit tracks whichever foot is currently lower (the
  // stance one) instead of the hip, and holds it near-still instead of merely capping it to a giant's walking speed.
  const FOOT_LOCK_STATES = { rise: 1, drop: 1, charge: 1, recover: 1 };
  const FOOT_VMAX = 1.1, FOOT_OFF_MAX = 1.6;
  let _hw = null, _q = null, _pl = null, _pr = null;
  function hipLimit(dt) {
    const fix = GOLEM.fix, g = C.boss.g; if (!fix || !(dt > 0)) return; _hw = _hw || new V3(); _q = _q || new THREE.Quaternion(); _pl = _pl || new V3(); _pr = _pr || new V3();
    if (!GOLEM.hip) GOLEM.root.traverse((o) => { if (o.isSkinnedMesh) { if (!GOLEM.hip) GOLEM.hip = o.skeleton.bones.find((b) => b.name === 'hip'); if (!GOLEM.footL) GOLEM.footL = o.skeleton.bones.find((b) => b.name === 'footL'); if (!GOLEM.footR) GOLEM.footR = o.skeleton.bones.find((b) => b.name === 'footR'); } });   // the skeleton's bones (QA samples the hip one)
    if (!GOLEM.hip) return;
    const off = fix.position, now = performance.now();
    if (!g.visible) { GOLEM.hipPrev = null; GOLEM.hipBone = null; off.set(0, 0, 0); return; }   // hidden: start clean (a pause / dialog keeps the reference: the first frame after it is limited too)
    GOLEM.hipT = now;
    g.updateMatrixWorld(true);
    const locking = FOOT_LOCK_STATES[C.boss.st] && GOLEM.footL && GOLEM.footR;
    let bone = GOLEM.hip, vmax = HIP_VMAX, offMax = 6;
    if (locking) { const pl = _pl.setFromMatrixPosition(GOLEM.footL.matrixWorld), pr = _pr.setFromMatrixPosition(GOLEM.footR.matrixWorld); bone = pl.y <= pr.y ? GOLEM.footL : GOLEM.footR; vmax = FOOT_VMAX; offMax = FOOT_OFF_MAX; }
    // tracked bone relative to the group's position, in world axes (turning counts: that is what the eye sees move)
    const cur = _hw.setFromMatrixPosition(bone.matrixWorld).sub(g.position).clone(), toLocal = (v) => v.applyQuaternion(_q.copy(g.quaternion).invert()).divideScalar(g.scale.x || 1);
    if (GOLEM.hipPrev && GOLEM.hipBone === bone) {
      const d = cur.clone().sub(GOLEM.hipPrev), L = d.length(), max = vmax * dt;
      if (L > max) { const ex = d.multiplyScalar(1 - max / L); cur.sub(ex); off.sub(toLocal(ex)); }
      else {   // drain the offset with the budget that is left
        const left = (max - L) * 0.9, ol = off.length();
        if (ol > 1e-4) { const k = Math.min(ol, left / (g.scale.x || 1)) / ol, step = off.clone().multiplyScalar(k); off.sub(step); cur.sub(step.applyQuaternion(g.quaternion).multiplyScalar(g.scale.x || 1)); }
      }
      if (off.length() > offMax) off.setLength(offMax);
      fix.updateMatrixWorld(true);
    }
    if (GOLEM.hipPrev && GOLEM.hipBone === bone) { const v = cur.distanceTo(GOLEM.hipPrev) / dt; GOLEM.hipMax = Math.max(GOLEM.hipMax || 0, v); }
    GOLEM.hipBone = bone; GOLEM.hipPrev = cur;
  }
  function bossDeath() {
    const A = GOLEM.A; if (!A) return false;
    A.lock = 0; A.once('death', 5.8, 0.15); GOLEM.dieT = 4.2; GOLEM.rock && (GOLEM.rock.visible = false);
    C.boss.core.visible = false;
    return true;   // keep the golem visible while it falls; updateGolem hides it
  }
  function updateGolem(dt) {
    if (GOLEM.dieT < 0 || !GOLEM.A) return;
    const boss = C.boss; GOLEM.dieT -= dt; GOLEM.A.update(dt); hipLimit(dt);
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

    return { mergeInto, prepShardlings, isUnder, updateShardlings, buildGolem, updateGolem, bind(o) { if ("C" in o) C = o.C; if ("THREE" in o) THREE = o.THREE; if ("V3" in o) V3 = o.V3; } };
  };
})();
