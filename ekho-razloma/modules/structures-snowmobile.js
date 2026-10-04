/* modules/structures-snowmobile.js — the snowmobile's model swap into the page's skimmer object, and its per-frame update (skis, seat anchor, spray point). Moved out of modules/structures.js unchanged. Classic script, loaded BEFORE structures.js: window.createStructuresSnowmobile(deps) → { buildSnowmobile, updateSnowmobile, bind({...}) }. */
(function () {
  'use strict';
  window.createStructuresSnowmobile = function (X) {
    const { damp, TAU, mergeInto, H, clamp, need, isUnder, count } = X;
    let THREE, C, V3;   // assigned later in the source module: set through bind()
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

    return { buildSnowmobile, updateSnowmobile, bind(o) { if ("THREE" in o) THREE = o.THREE; if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; } };
  };
})();
