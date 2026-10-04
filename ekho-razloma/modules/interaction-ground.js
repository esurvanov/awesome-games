/* modules/interaction-ground.js — what the pilot's feet do to the world: footsteps from the pose, landing, brushing trees, pushing props, lake cracks and sea-ice grip. Moved out of modules/interaction.js unchanged. Classic script, loaded BEFORE interaction.js: window.createInteractionGround(deps) → { stepsFromPose, footfall, W, worldUpdate, land, ICE, bind({ C, V3, Q, T3 }) }. */
(function () {
  'use strict';
  window.createInteractionGround = function (X) {
    const { rnd, AU, clamp, B, K, sfx, STATS, inLake, damp, surfaceAt, PUSH, SUB, _p, auOK, hitDown, CAM } = X;
    let C, T3;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ footsteps from the pose */
  function stepsFromPose(dt, grounded, hs) {
    if (!SUB.steps) return;
    const P = C.player;
    for (const L of B.legs) {
      const rel = L.c;
      if (rel > 0.07) L.up = 1;
      if (L.up && rel < 0.03 && L.c <= (L.cPrev === undefined ? 1 : L.cPrev) + 1e-4 && grounded && hs > 0.8) {
        L.up = 0; footfall(L, hs);
      }
    }
    if (!grounded) for (const L of B.legs) L.up = 1;
  }
  // SNOW-CONTACT: one contact event per plant — footfall(): the step sound + a puff at the boot. The print is not drawn
  // here (no stamp, no re-stamp while the foot slides): the terrain module's snow map is pressed by the boot mesh itself.
  function footfall(L, hs) {
    const P = C.player, x = L.anim.x, z = L.anim.z, y = L.gy !== undefined ? L.gy : L.g.y, surf = surfaceAt(x, L.g.y, z, L.g);
    B.lastSurf = surf; STATS.steps++;
    const k = clamp(0.45 + hs / 11, 0.4, 1.3) * K.stepVol;
    sfx(surf, k);
    const col = surf === 'snow' ? 0xdce6f6 : surf === 'ice' ? 0xcfeaf6 : surf === 'rock' ? 0x8f96a4 : 0x9aa4b4;
    if (surf === 'snow' || surf === 'ice') for (let i = 0; i < (hs > 8 ? 4 : 2); i++) C.emit(x, y + 0.05, z, rnd(-0.6, 0.6) + P.vx * 0.05, rnd(0.4, 1.1), rnd(-0.6, 0.6) + P.vz * 0.05, 0.45, col, 0.28, 3, 2.5);
    if (surf === 'ice' && inLake(x, z)) ICE.crackAt(x, z, 0.25 + hs / 16);
  }

  /* ------------------------------------------------------------------ world: landing, trees, benders, push, slide */
  const W = { wasGround: true, minVy: 0, air: 0, treeGrid: null, treeList: null, treeCd: new Map(), slide: 0 };
  const treeList = () => (window.VEG && VEG.trees && VEG.trees.length ? VEG.trees : C.FOREST && C.FOREST.list || []);
  function worldSetup() {
    const list = W.treeList = treeList();
    W.treeGrid = new Map();
    list.forEach((t, i) => { const k = Math.floor(t[0] / 8) * 4096 + Math.floor(t[2] / 8); if (!W.treeGrid.has(k)) W.treeGrid.set(k, []); W.treeGrid.get(k).push(i); });
  }
  function worldUpdate(dt) {
    const P = C.player, G = C.G; if (C.mode !== 'play') return;
    if (!W.treeGrid || W.treeList !== treeList() || W.treeN !== W.treeList.length) { worldSetup(); W.treeN = W.treeList.length; }
    const riding = G.riding, hs = riding ? Math.abs(C.sk.speed || 0) : Math.hypot(P.vx, P.vz);
    const px = riding ? C.sk.x : P.x, pz = riding ? C.sk.z : P.z;
    // ---- landing: puff ring + thud + camera dip
    if (!riding && C.CLIMB.t < 0) {
      if (!P.onGround) { W.air += dt; W.minVy = Math.min(W.minVy, P.vy); }
      else if (!W.wasGround && W.air > 0.12) {
        const v = -W.minVy; if (v > 3) land(v);
      }
      if (P.onGround) { W.air = 0; W.minVy = 0; }
      W.wasGround = P.onGround;
    }
    // ---- trees: brushing through the lower branches shakes snow off
    if (K.trees && hs > 1.4 && W.treeList.length) {
      const i0 = Math.floor(px / 8), j0 = Math.floor(pz / 8), now = C.T;
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        const a = W.treeGrid.get(i * 4096 + j); if (!a) continue;
        for (const ti of a) {
          const t = W.treeList[ti], sc = t.s || t[3] || 1, d = Math.hypot(t[0] - px, t[2] - pz), r = Math.min(2.4, 1.0 + 0.5 * sc) + (riding ? 0.8 : 0);
          if (d > r) continue;
          const last = W.treeCd.get(ti) || -9; if (now - last < 1.6) continue; W.treeCd.set(ti, now);
          shake(ti, t, clamp(hs / 9, 0.3, 1.2), (t[0] - px) / (d || 1), (t[2] - pz) / (d || 1));
        }
      }
    }
    // ---- pushing props: extra shove + scrape sound, spray at the base
    let scrape = 0;
    if (PUSH.prop && B.arms.push && C.PH.ok) {
      const e = PUSH.prop, F = B.F || _p[16], mass = e.opts && e.opts.mass || 20;
      try { C.PH.P.applyImpulseAt(B.arms.push.col, B.arms.push, { x: F.x * mass * 1.6 * dt, y: 0, z: F.z * mass * 1.6 * dt }); } catch (err) { /* body asleep / removed */ }
      const lv = e.debris.body && e.debris.body.linvel ? e.debris.body.linvel() : null, sp = lv ? Math.hypot(lv.x, lv.z) : 0;
      scrape = clamp(sp / 2.5, 0, 1);
      if (sp > 0.4 && Math.random() < dt * 20) { const m = e.debris.mesh.position; C.emit(m.x + rnd(-0.4, 0.4), C.groundH(m.x, m.z) + 0.05, m.z + rnd(-0.4, 0.4), rnd(-0.5, 0.5), rnd(0.3, 0.9), rnd(-0.5, 0.5), 0.5, 0xdce6f6, 0.3, 3, 2); }
    }
    // ---- slide: spray + hiss
    if (P.sliding && !riding) { W.slide = damp(W.slide, 1, 6, dt); if (Math.random() < dt * 30) C.emit(P.x + rnd(-0.3, 0.3), P.y + 0.08, P.z + rnd(-0.3, 0.3), rnd(-1.2, 1.2) + P.vx * 0.3, rnd(0.6, 1.8), rnd(-1.2, 1.2) + P.vz * 0.3, 0.7, 0xdce6f6, 0.45, 2, 1.5); }
    else W.slide = damp(W.slide, 0, 8, dt);
    if (auOK() && AU.scrapeG) {
      const g = Math.max(scrape * 0.07, W.slide * 0.09 * clamp(Math.hypot(P.vx, P.vy, P.vz) / 8, 0.3, 1));
      AU.scrapeG.gain.setTargetAtTime(g, AU.ac.currentTime, 0.06); AU.scrapeF.frequency.setTargetAtTime(W.slide > scrape ? 1100 : 450, AU.ac.currentTime, 0.1);
    } else if (AU.scrapeG && AU.ac) AU.scrapeG.gain.setTargetAtTime(0, AU.ac.currentTime, 0.05);
  }
  function land(v) {
    const P = C.player, h = hitDown(P.x, P.y + 0.5, P.z, 1.5), surf = surfaceAt(P.x, P.y, P.z, h); STATS.lands++;
    const k = clamp((v - 3) / 12, 0.1, 1);
    sfx('land', k, surf);
    const col = surf === 'snow' ? 0xdce6f6 : surf === 'ice' ? 0xcfeaf6 : 0x9aa2b0, n = Math.round(8 + k * 22);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + rnd(-0.2, 0.2), s = rnd(1.5, 3.5) * (0.6 + k); C.emit(P.x + Math.sin(a) * 0.3, P.y + 0.06, P.z + Math.cos(a) * 0.3, Math.sin(a) * s, rnd(0.3, 1.2) * (0.5 + k), Math.cos(a) * s, rnd(0.5, 0.9), col, rnd(0.35, 0.6), 3.5, 2); }
    CAM.dipV -= (0.8 + v * 0.12) * K.dip;
    if (surf === 'ice' && inLake(P.x, P.z)) ICE.crackAt(P.x, P.z, 0.6 + k);
    // SNOW-CONTACT: no landing stamp — the two boots press their own prints (the terrain draws them into the snow map)
  }
  function shake(ti, t, s, dx, dz) {
    STATS.shakes++;
    if (typeof C.shakeTree === 'function') {   // vegetation: branch wobble + snow puff; false = that tree is still settling
      let r = false; try { r = C.shakeTree(t[0], t[2], s, dx, dz); } catch (e) { r = false; }
      if (r !== false) sfx('brush', clamp(s, 0.4, 1));
      return;
    }
    const sc = t.s || t[3] || 1, ty = t.y !== undefined ? t.y : t[1];   // fallback: a curtain of snow from the branches
    for (let i = 0; i < 26 * s; i++) { const a = rnd(0, 6.283), r = rnd(0.4, 1.6) * sc; C.emit(t[0] + Math.sin(a) * r, ty + rnd(1.2, 4.5) * sc, t[2] + Math.cos(a) * r, rnd(-0.3, 0.3), rnd(-0.5, 0.2), rnd(-0.3, 0.3), rnd(1.2, 2.2), 0xe8f0ff, rnd(0.25, 0.5), 1.2, 3); }
    sfx('brush', clamp(s, 0.4, 1));
  }

  /* ------------------------------------------------------------------ ice: lake cracks + sea-ice traction */
  const ICE = {
    geo: null, mesh: null, pos: null, col: null, n: 0, MAX: 6000, branches: [], dirty: 0, standT: 0, lastX: 1e9, lastZ: 1e9, base: null, trac: 1, y: 0,
    // cracks are thin quads lying on the ice (sharp at any distance, no texture uploads); a ring buffer of segments
    setup() {
      const L = C.POI.lake; if (L.h === undefined) return false;
      const M = this.MAX, g = this.geo = new T3.BufferGeometry();
      this.pos = new Float32Array(M * 12); this.col = new Float32Array(M * 12);
      const nrm = new Float32Array(M * 12); for (let i = 0; i < M * 4; i++) nrm[i * 3 + 1] = 1;
      const idx = new Uint32Array(M * 6); for (let i = 0; i < M; i++) { const v = i * 4, o = i * 6; idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], o); }
      g.setAttribute('position', new T3.BufferAttribute(this.pos, 3).setUsage(T3.DynamicDrawUsage));
      g.setAttribute('color', new T3.BufferAttribute(this.col, 3).setUsage(T3.DynamicDrawUsage));
      g.setAttribute('normal', new T3.BufferAttribute(nrm, 3)); g.setIndex(new T3.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
      g.boundingSphere = new T3.Sphere(new T3.Vector3(L.x, L.h, L.z), 60);
      const mat = new T3.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x2c6a8c, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0,
        transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const m = this.mesh = new T3.Mesh(g, mat); m.renderOrder = 2; m.userData.noCollide = true; m.name = 'lake_cracks'; m.frustumCulled = false; m.receiveShadow = true;
      this.y = L.h + 0.042; C.scene.add(m); return true;
    },
    seg(x0, z0, x1, z1, w, bright) {
      const i = this.n % this.MAX, dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, px = -dz / l * w * 0.5, pz = dx / l * w * 0.5, y = this.y, P = this.pos, o = i * 12;
      P[o] = x0 + px; P[o + 1] = y; P[o + 2] = z0 + pz; P[o + 3] = x0 - px; P[o + 4] = y; P[o + 5] = z0 - pz;
      P[o + 6] = x1 + px; P[o + 7] = y; P[o + 8] = z1 + pz; P[o + 9] = x1 - px; P[o + 10] = y; P[o + 11] = z1 - pz;
      const c = C.lin(bright), cb = C.lin(Math.min(1, bright * 1.06)); for (let k = 0; k < 4; k++) { this.col[o + k * 3] = c * 0.9; this.col[o + k * 3 + 1] = c * 0.97; this.col[o + k * 3 + 2] = cb; }
      this.n++; this.dirty++;
    },
    crackAt(x, z, k) {
      if (!this.mesh && !this.setup()) return;
      if (Math.hypot(x - this.lastX, z - this.lastZ) < 0.35 && k < 0.5) return;
      this.lastX = x; this.lastZ = z; STATS.cracks++;
      const n = 3 + Math.round(k * 4);
      for (let i = 0; i < n && this.branches.length < 300; i++) {
        const a = i / n * Math.PI * 2 + rnd(-0.4, 0.4);
        this.branches.push({ x, z, a, left: rnd(0.5, 1.5) * (0.6 + k * 1.8), w: rnd(0.016, 0.03) * (0.8 + k * 0.5), gen: 0, v: rnd(3, 7) });
      }
      for (let i = 0; i < 6; i++) { const a = rnd(0, 6.283), r0 = rnd(0.05, 0.15), r1 = r0 + rnd(0.08, 0.25) * (0.5 + k); this.seg(x + Math.cos(a) * r0, z + Math.sin(a) * r0, x + Math.cos(a) * r1, z + Math.sin(a) * r1, 0.012, 0.85); }
      sfx('crack', clamp(k, 0.2, 1));
    },
    grow(dt) {
      if (!this.branches.length) return;
      const keep = [];
      for (const b of this.branches) {
        let t = Math.min(b.left, b.v * dt); if (t <= 0) continue; b.left -= t;
        while (t > 0) {   // jagged: 6–12 cm pieces
          const st = Math.min(t, rnd(0.06, 0.12)); t -= st;
          const a = b.a + rnd(-0.45, 0.45), nx = b.x + Math.cos(a) * st, nz = b.z + Math.sin(a) * st;
          this.seg(b.x, b.z, nx, nz, b.w * (0.6 + 0.4 * Math.min(1, b.left + 0.2)), 0.8 + 0.2 / (1 + b.gen));
          b.x = nx; b.z = nz; b.a = a * 0.6 + b.a * 0.4;
        }
        if (b.gen < 2 && Math.random() < dt * 2.4) keep.push({ x: b.x, z: b.z, a: b.a + (Math.random() < 0.5 ? 1 : -1) * rnd(0.5, 1.1), left: b.left * rnd(0.4, 0.8) + 0.2, w: b.w * 0.65, gen: b.gen + 1, v: b.v * 0.8 });
        if (b.left > 0) keep.push(b);
      }
      this.branches = keep.slice(0, 300);
    },
    update(dt) {
      const P = C.player, G = C.G;
      // traction on sea ice (and a little on the lake)
      if (C.PH.ok && C.PH.ch && C.PH.ch.params) {
        const pr = C.PH.ch.params; if (!this.base) this.base = { a: pr.groundAccel, d: pr.groundDecel };
        const onSea = !G.riding && P.onGround && C.getH(P.x, P.z) <= 0.08 && P.y < 0.6;
        const onLake = !G.riding && P.onGround && inLake(P.x, P.z) && Math.abs(P.y - C.POI.lake.h) < 0.4;
        const t = onSea ? 1 : onLake ? 0.5 : 0; this.trac = damp(this.trac, t, 4, dt);
        pr.groundAccel = this.base.a * (1 - this.trac * (1 - K.iceAccel)); pr.groundDecel = this.base.d * (1 - this.trac * (1 - K.iceDecel));
        // standing still on thin ice: it keeps complaining
        if (onLake) { this.standT += dt; if (this.standT > 1.4 && Math.hypot(P.vx, P.vz) < 0.5) { this.standT = 0; this.lastX = 1e9; this.crackAt(P.x + rnd(-0.3, 0.3), P.z + rnd(-0.3, 0.3), 0.35); } }
        else this.standT = 0;
      }
      if (this.mesh) {
        this.grow(dt);
        if (this.dirty) {
          const g = this.geo, cnt = Math.min(this.n, this.MAX), first = (this.n - Math.min(this.dirty, this.MAX)) % this.MAX, len = Math.min(this.dirty, this.MAX);
          for (const at of [g.attributes.position, g.attributes.color]) {
            at.clearUpdateRanges();
            if (first + len <= this.MAX) at.addUpdateRange(first * 12, len * 12); else { at.addUpdateRange(first * 12, (this.MAX - first) * 12); at.addUpdateRange(0, (first + len - this.MAX) * 12); }
            at.needsUpdate = true;
          }
          g.setDrawRange(0, cnt * 6); this.dirty = 0;
        }
      }
    },
  };

    return { stepsFromPose, footfall, W, worldUpdate, land, ICE, bind(o) { if ("C" in o) C = o.C; if ("T3" in o) T3 = o.T3; } };
  };
})();
