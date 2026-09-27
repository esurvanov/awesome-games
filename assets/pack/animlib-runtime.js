/* ANIMLIB runtime helpers (classic script; needs the global THREE, r186). Not wired into the game yet - see ANIMLIB.md.
 *   ANIMLIB.meta(gltf)                      -> metadata embedded in the pack (gltf.parser.json.extras.animlib)
 *   ANIMLIB.mergeClips(animations, gltf)    -> appends the pack's clips to an existing clip list (by name, no dups)
 *   ANIMLIB.chooseContact(intent, sense)    -> which clip + where to stand, from an intent (TypeSafe Jev) + probe hits
 *   new ANIMLIB.LimbIK(root, 'hand_r')      -> analytic 2-bone IK run AFTER mixer.update(): pin a hand/foot on a surface
 *   new ANIMLIB.ContactLayer(root, meta)    -> drives LimbIK from a clip's contact windows + the real surface hit
 *   new ANIMLIB.GaitBlender(mixer, clips, meta) -> phase-synchronised, speed-matched stag gaits (walk/trot/canter/gallop + turns)
 */
(function () {
  const T = () => window.THREE;
  const A = {};
  A.meta = (gltf) => (gltf && gltf.parser && gltf.parser.json && gltf.parser.json.extras && gltf.parser.json.extras.animlib) || null;
  A.mergeClips = (animations, gltf) => { const have = new Set(animations.map((c) => c.name)); for (const c of gltf.animations) if (!have.has(c.name)) animations.push(c); return animations; };

  // ------------------------------------------------------------------ intent -> clip
  // sense = { front:{dist,height,normal:[x,y,z]}|null, left:{..}|null, right:{..}|null, back:{..}|null, ground:{slope,normal}, speed, onIce, obstacle:{dist,height,depth}|null }
  // (distances along the character's facing / sides from the feet centre; heights = top of the hit surface above the feet)
  A.INTENTS = {
    rest_on_rock:   ['lean_back', 'lean_shoulder_r', 'lean_shoulder_l', 'lean_hands_ledge', 'hand_wall_both'],
    touch_surface:  ['hand_wall_r', 'hand_wall_l', 'hand_wall_both'],
    inspect_ground: ['crouch_inspect', 'kneel'],
    pick_up:        ['pickup_small_r', 'pickup_small_l'],
    push:           ['push_heavy'],
    climb_slope:    ['brace_slope_r', 'brace_slope_l'],
    cross_obstacle: ['step_over', 'vault_1m'],
    clear_branch:   ['reach_branch_r', 'reach_branch_l'],
    idle_tired:     ['tired_hands_knees', 'tired_breath'],
    idle_cold:      ['cold_shiver'],
    idle_look:      ['look_around'],
    greet:          ['wave_r'], point_at: ['point_r', 'point_l'],
  };
  A.chooseContact = function (intent, s, meta) {
    const clips = meta.clips, pick = (name, extra) => Object.assign({ clip: clips[name + '_loop'] ? name + '_loop' : name, enter: clips[name + '_in'] ? name + '_in' : null }, extra || {});
    const within = (c, d) => c && c.approach && c.approach.distance && d >= c.approach.distance[0] - 0.05 && d <= c.approach.distance[2] + 0.15;
    const first = (name) => (clips[name + '_loop'] || clips[name + '_in'] || clips[name] || {}).contacts ? (clips[name + '_loop'] || clips[name + '_in'] || clips[name]).contacts[0] : null;
    switch (intent) {
      case 'rest_on_rock':
        if (s.back && within(first('lean_back'), s.back.dist) && s.back.height > 1.2) return pick('lean_back', { face: 'away', standOff: first('lean_back').approach.distance[1] });
        if (s.right && within(first('lean_shoulder_r'), s.right.dist) && s.right.height > 1.3) return pick('lean_shoulder_r', { face: 'side', standOff: first('lean_shoulder_r').approach.distance[1] });
        if (s.left && within(first('lean_shoulder_l'), s.left.dist) && s.left.height > 1.3) return pick('lean_shoulder_l', { face: 'side', standOff: first('lean_shoulder_l').approach.distance[1] });
        if (s.front && s.front.height > 0.5 && s.front.height < 0.95) return pick('lean_hands_ledge', { face: 'toward', standOff: 0.42 });
        if (s.front && s.front.height > 1.1) return pick('hand_wall_both', { face: 'toward', standOff: 0.45 });
        return null;
      case 'touch_surface':
        if (!s.front || s.front.height < 1.0) return null;
        return pick(s.preferHand === 'l' ? 'hand_wall_l' : s.preferHand === 'both' ? 'hand_wall_both' : 'hand_wall_r', { face: 'toward', standOff: 0.45 });
      case 'cross_obstacle':
        if (!s.obstacle) return null;
        if (s.obstacle.height <= 0.5) return pick('step_over', { face: 'toward' });
        if (s.obstacle.height <= 1.25) return pick('vault_1m', { face: 'toward', standOff: 0.62, heightScale: s.obstacle.height / 1.0 });
        return null;   // taller: existing ClimbUp_1m / no traverse
      case 'climb_slope': return pick(s.slopeSide === 'l' ? 'brace_slope_l' : 'brace_slope_r', { face: 'uphill' });
      case 'inspect_ground': return pick(s.long ? 'kneel' : 'crouch_inspect', { face: 'toward', standOff: 0.55 });
      case 'pick_up': return pick(s.side === 'l' ? 'pickup_small_l' : 'pickup_small_r', { face: 'toward', standOff: 0.3 });
      default: { const l = A.INTENTS[intent]; return l ? pick(l[0]) : null; }
    }
  };

  // ------------------------------------------------------------------ 2-bone IK on a three.js skeleton
  A.LimbIK = class {
    constructor(root, endName) {
      const THREE = T(); const side = endName.slice(-2);
      const chain = endName.startsWith('hand') ? ['upperarm' + side, 'lowerarm' + side, 'hand' + side] : endName.startsWith('foot') ? ['thigh' + side, 'calf' + side, 'foot' + side] : null;
      this.b = chain.map((n) => root.getObjectByName(n)); this.root = root;
      this.v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.qp = new THREE.Quaternion();
      this.isHand = endName.startsWith('hand'); this.side = side;
      this.pole = new THREE.Vector3(side === '_l' ? 0.6 : -0.6, -0.7, -0.3);
    }
    // target: world position of the END joint (wrist/ankle). weight 0..1. palmNormal (world, optional): surface normal to press the palm on
    solve(target, weight = 1, palmNormal = null) {
      if (weight <= 0.001) return;
      const THREE = T(), [a, b, c] = this.b, [pa, pb, pc, t, n] = this.v;
      a.updateWorldMatrix(true, true);
      a.getWorldPosition(pa); b.getWorldPosition(pb); c.getWorldPosition(pc);
      t.copy(pc).lerp(target, weight);
      const la = pa.distanceTo(pb), lb = pb.distanceTo(pc), d = Math.min(pa.distanceTo(t), (la + lb) * 0.999);
      const dir = t.clone().sub(pa).normalize();
      // bend plane: current elbow offset (fallback pole in character space)
      let bend = pb.clone().sub(pa); bend.sub(dir.clone().multiplyScalar(bend.dot(dir)));
      if (bend.lengthSq() < 1e-6) { bend.copy(this.pole).applyQuaternion(this.root.getWorldQuaternion(this.qp)); bend.sub(dir.clone().multiplyScalar(bend.dot(dir))); }
      bend.normalize();
      const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      const nb = pa.clone().add(dir.clone().multiplyScalar(cosA * la).add(bend.clone().multiplyScalar(sinA * la)));
      const endWorldQ = c.getWorldQuaternion(new THREE.Quaternion());
      rotateTo(a, pb.clone().sub(pa), nb.clone().sub(pa));
      b.updateWorldMatrix(true, true); c.getWorldPosition(pc); b.getWorldPosition(pb);
      rotateTo(b, pc.clone().sub(pb), pa.clone().add(dir.multiplyScalar(d)).sub(pb));
      // keep the end rotation (or press the palm onto the surface)
      let want = endWorldQ;
      if (palmNormal && this.isHand) {
        // UAL hand bones: the palm faces local +X (hand_l) / -X (hand_r) (measured from the T-pose bind)
        const pa = (!window.INTERACT_OFF && A.PALM[this.side]) || [this.side === '_l' ? 1 : -1, 0, 0];   // INTERACT_OFF: the pre-INTERACT axis (A/B)
        const cur = new THREE.Vector3(pa[0], pa[1], pa[2]).applyQuaternion(endWorldQ).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(cur, n.copy(palmNormal).negate().normalize());
        want = q.multiply(endWorldQ);
      }
      setWorldQuat(c, want);
    }
  };
  function rotateTo(bone, from, to) {
    const THREE = T(); const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const wq = bone.getWorldQuaternion(new THREE.Quaternion()); setWorldQuat(bone, q.multiply(wq));
  }
  function setWorldQuat(bone, wq) {
    const THREE = T(); const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(wq)); bone.updateWorldMatrix(false, true);
  }

  // ------------------------------------------------------------------ contact layer (per character)
  A.SURF_OFF = { hand: 0.035, shoulder: 0.10, back: 0.16, foot: 0 };
  // hand-bone local axis that points out of the palm (per side); INTERACT.md: measured on the pilot's drawn glove
  A.PALM = { _l: [0, 1, 0], _r: [0, 1, 0] };   // was ±X (the finger axis on this rig: fingers went 8–9 cm into the wall)
  A.ContactLayer = class {
    constructor(root, meta) { this.root = root; this.meta = meta; this.ik = {}; this.active = null; }
    // call each frame after mixer.update(dt). action = the playing THREE.AnimationAction; hit(contact) -> {point: Vector3, normal: Vector3} in world or null
    update(action, hit, fade = 1) {
      const m = action && this.meta.clips[action.getClip().name]; if (!m) return;
      const t = action.time, scale = this.root.getWorldScale(new (T().Vector3)()).x;
      for (const c of m.contacts || []) {
        if (!c.bone.startsWith('hand') && !c.bone.startsWith('foot')) continue;      // shoulders/back: placement only (stand-off)
        const w0 = c.window[0] - c.blendIn, w1 = c.window[1] + c.blendOut;
        let w = t < w0 || t > w1 ? 0 : t < c.window[0] ? (t - w0) / c.blendIn : t > c.window[1] ? (w1 - t) / c.blendOut : 1;
        w *= fade * action.getEffectiveWeight(); if (w <= 0) continue;
        const h = hit(c); if (!h) continue;
        const ik = this.ik[c.bone] || (this.ik[c.bone] = new A.LimbIK(this.root, c.bone));
        // wrist target = surface point pushed out by the palm thickness
        const tgt = h.point.clone().add(h.normal.clone().multiplyScalar(A.SURF_OFF.hand * scale));
        ik.solve(tgt, w, c.bone.startsWith('hand') ? h.normal : null);
      }
    }
  };

  // ------------------------------------------------------------------ stag gait blender (phase sync + speed matching)
  // clips: {name: AnimationClip}. meta = anim_stag_gaits extras. update(dt, speed m/s, yawRate rad/s) each frame.
  A.GaitBlender = class {
    constructor(mixer, clips, meta, opts = {}) {
      this.mixer = mixer; this.meta = meta; this.phase = 0; this.acts = {};
      this.order = ['walk', 'trot', 'canter', 'gallop'];
      for (const g of this.order) for (const v of ['_loop', '_turn_l', '_turn_r']) {
        const n = g + v, c = clips[n]; if (!c) continue;
        const a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); a.timeScale = 0; this.acts[n] = a;   // time is driven by phase
      }
      this.idle = opts.idle ? mixer.clipAction(clips[opts.idle]) : null; if (this.idle) this.idle.play();
      this.w = { idle: 1 };
    }
    // piecewise weights over speed: [gait, speed at full weight]
    weights(v) {
      const G = this.meta.gaitTable, pts = this.order.map((g) => [g, G[g].speed]);
      if (v <= 0.15) return { idle: 1 };
      if (v < pts[0][1] * 0.5) { const k = (v - 0.15) / (pts[0][1] * 0.5 - 0.15); return { idle: 1 - k, walk: k }; }
      for (let i = 0; i < pts.length - 1; i++) { const [a, va] = pts[i], [b, vb] = pts[i + 1];
        if (v <= va) return { [a]: 1 };
        // hold the pure gait until 70% of the way, then crossfade (gait transitions are quick in real animals)
        if (v < vb) { const k = THREE.MathUtils.smoothstep((v - va) / (vb - va), 0.55, 0.85); return { [a]: 1 - k, [b]: k }; } }
      return { gallop: 1 };
    }
    update(dt, v, yawRate = 0) {
      const G = this.meta.gaitTable, W = this.weights(v);
      // phase rate: blend of each gait's (speed-matched) cycle rate  -> hooves move at ground speed = no sliding
      let rate = 0, tw = 0;
      for (const g of this.order) if (W[g]) { rate += W[g] * (v / G[g].speed) / G[g].T; tw += W[g]; }
      if (tw > 0) this.phase = (this.phase + dt * rate / tw) % 1;
      const turn = THREE.MathUtils.clamp(yawRate / 0.9, -1, 1);   // ~50 deg/s = full turn clip
      for (const [n, a] of Object.entries(this.acts)) {
        const g = n.split('_')[0], wg = W[g] || 0;
        const wt = n.endsWith('_loop') ? 1 - Math.abs(turn) : (n.endsWith('_l') ? Math.max(0, turn) : Math.max(0, -turn));
        a.setEffectiveWeight(wg * wt); a.time = this.phase * a.getClip().duration;
      }
      if (this.idle) this.idle.setEffectiveWeight(W.idle || 0);
      this.mixer.update(dt);   // idle etc. advance normally; gait actions have timeScale 0 and a set time
      return W;
    }
  };
  window.ANIMLIB = A;
})();
