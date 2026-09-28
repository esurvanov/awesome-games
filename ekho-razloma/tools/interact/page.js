/* tools/interact/page.js — in-page helpers for the interaction passport work (window.IX). Injected by run.mjs. */
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = (n) => String(n || '').replace(/#\d+$/, '');
  const IX = window.IX = { wait };
  // inventory of Passport entries grouped by kind (name without #k, + vertex count)
  IX.inventory = function () {
    const P = DBG.Passport, g = {};
    for (const e of P.list) {
      const k = base(e.name) + '|' + e.role + '|' + (e.geo ? e.geo.vn : 0);
      const b = e.box, sz = b ? [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(2)) : null;
      const r = g[k] || (g[k] = { name: base(e.name), role: e.role, vn: e.geo ? e.geo.vn : 0, n: 0, shape: e.shape, sizeMin: sz, sizeMax: sz, ex: e.name });
      r.n++; if (sz) { r.sizeMin = r.sizeMin.map((v, i) => Math.min(v, sz[i])); r.sizeMax = r.sizeMax.map((v, i) => Math.max(v, sz[i])); }
    }
    return Object.values(g).sort((a, b) => a.name.localeCompare(b.name));
  };
})();
(function () {
  const IX = window.IX, wait = IX.wait, base = (n) => String(n || '').replace(/#\d+$/, '');
  const T = () => DBG.THREE;
  // ---- the pilot's drawn skin: vertices that move with an effector bone (hand + fingers, or the upper arm) ----
  let SKIN = null;
  function skinSets() {
    if (SKIN) return SKIN;
    const B = INTERACTION.B, root = B.root, THREE = T(); SKIN = {};
    const meshes = []; root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const sub = (name) => { const b = root.getObjectByName(name), s = new Set(); if (b) b.traverse((o) => { if (o.isBone) s.add(o); }); return s; };
    for (const eff of ['hand_l', 'hand_r', 'upperarm_l', 'upperarm_r', 'foot_l', 'foot_r', 'spine_03']) {
      const bones = eff.startsWith('hand') ? sub(eff) : new Set([root.getObjectByName(eff)]);
      const list = [];
      for (const m of meshes) {
        const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; if (!si) continue;
        const idx = new Set(); m.skeleton.bones.forEach((b, k) => { if (bones.has(b)) idx.add(k); });
        for (let i = 0; i < si.count; i++) { let w = 0; for (let c = 0; c < 4; c++) if (idx.has(si.getComponent(i, c))) w += sw.getComponent(i, c); if (w >= 0.6) list.push([m, i]); }
      }
      const step = Math.max(1, Math.floor(list.length / 45)); SKIN[eff] = list.filter((_, k) => k % step === 0);
    }
    return SKIN;
  }
  const isAvatar = (o) => { const B = INTERACTION.B; for (let p = o; p; p = p.parent) if (p === B.root || p === B.wrap || p === DBG.player.c.g) return true; return false; };
  // the DRAWN surface near the pilot: every visible-material Mesh / InstancedMesh instance / BatchedMesh within `R` m,
  // wrapped as plain raycastable meshes (perf.js regroups instances into proxies with changing counts, whose cached
  // bounding spheres make THREE's own InstancedMesh.raycast miss; the hidden originals carry the same geometry+matrices)
  const SKIPN = /grass|heather|shrub|clutter|tuft|flake|particle|leaves|needle|crown|foliage|snowfx|lake_cracks|sky|cloud|aurora|beam|glow|water|sea$|^terrain/i;
  let NEAR = null;
  IX.nearDrawn = function (R = 10, cx, cz, noBVH) {
    const THREE = T(), P = cx != null ? { x: cx, z: cz } : DBG.player, out = [], M = new THREE.Matrix4(), S = new THREE.Sphere(), seen = new Set();
    DBG.scene.traverse((o) => {
      if (!(o.isMesh || o.isBatchedMesh) || o.isSkinnedMesh || isAvatar(o) || o.isSprite) return;
      const mats = [].concat(o.material); if (mats.every((m) => !m || m.visible === false || (m.transparent && m.depthWrite === false))) return;
      if (SKIPN.test(o.name || '') || o.userData.perfProxy) return;
      const g = o.geometry; if (!g || !g.attributes.position) return; if (!g.boundingSphere) g.computeBoundingSphere();
      if (!noBVH && !o.isBatchedMesh && !g.boundsTree && g.computeBoundsTree && g.attributes.position.count < 400000) { try { g.computeBoundsTree(); } catch (err) { /* stock raycast */ } }   // accelerates the same THREE.Raycaster query
      if (o.isBatchedMesh) { out.push({ mesh: o, name: o.name }); return; }
      if (o.isInstancedMesh) {
        for (let k = 0; k < o.count; k++) {
          o.getMatrixAt(k, M); const W = o.matrixWorld.clone().multiply(M); S.copy(g.boundingSphere).applyMatrix4(W);
          if (Math.hypot(S.center.x - P.x, S.center.z - P.z) - S.radius > R) continue;
          const key = g.uuid + ':' + W.elements.map((v) => v.toFixed(3)).join(','); if (seen.has(key)) continue; seen.add(key);
          const px = new THREE.Mesh(g, o.material); px.matrixAutoUpdate = false; px.matrix.copy(W); px.matrixWorld.copy(W); out.push({ mesh: px, name: o.name + '#' + k });
        }
        return;
      }
      S.copy(g.boundingSphere).applyMatrix4(o.matrixWorld); if (S.radius > 400 || Math.hypot(S.center.x - P.x, S.center.z - P.z) - S.radius > R) return;
      out.push({ mesh: o, name: o.name });
    });
    NEAR = out; return out.length;
  };
  function drawnUnder(origin, dir, far) {
    const THREE = T(), rc = new THREE.Raycaster(origin, dir, 0, far); rc.camera = DBG.camera;
    if (!NEAR) IX.nearDrawn();
    let best = null;
    for (const d of NEAR) { const h = rc.intersectObject(d.mesh, false)[0]; if (h && (!best || h.distance < best.hit.distance)) best = { hit: h, proxy: d.mesh, name: d.name }; }
    return best;
  }
  IX._drawnUnder = drawnUnder;
  // independent gap: skin vertices of the effector vs the DRAWN surface along -normal (THREE.Raycaster on the drawn mesh)
  IX.gap = function (eff, normal) {
    const THREE = T(), S = skinSets()[eff]; if (!S || !S.length) return null;
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize(), nd = n.clone().negate();
    const B = INTERACTION.B, bone = B.root.getObjectByName(eff), bw = new THREE.Vector3(); bone.getWorldPosition(bw);
    let d = drawnUnder(bw.clone().addScaledVector(n, 0.6), nd, 1.6); if (!d) return { none: true };
    // measure along the DRAWN surface's own normal where the effector is (the pilot's facing is only the search direction)
    if (d.hit.face) { const fn = d.hit.face.normal.clone().transformDirection(d.proxy.matrixWorld); if (fn.dot(nd) > 0) fn.negate(); if (Math.abs(fn.dot(n)) > 0.35) { n.copy(fn); nd.copy(fn).negate(); const d2 = drawnUnder(bw.clone().addScaledVector(n, 0.6), nd, 1.6); if (d2) d = d2; } }
    const rc = new THREE.Raycaster(); rc.far = 1.2; rc.camera = DBG.camera; const v = new THREE.Vector3(); let min = Infinity, n0 = 0;
    for (const [m, i] of S) {
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      rc.set(v.clone().addScaledVector(n, 0.5), nd); const h = rc.intersectObject(d.proxy, false)[0]; if (!h) continue;
      n0++; const g = h.distance - 0.5; if (g < min) min = g;   // closest skin point: >0 air gap to the drawn surface, <0 inside it
    }
    rc.set(bw.clone().addScaledVector(n, 0.5), nd); const wh = rc.intersectObject(d.proxy, false)[0];
    return { obj: d.name, gapCm: n0 ? +(min * 100).toFixed(2) : null, wristCm: wh ? +((wh.distance - 0.5) * 100).toFixed(2) : null, n: n0 };
  };
  // ---- kinds and instances ----
  IX.kindKey = (e) => base(e.name) + '|' + (e.geo ? e.geo.vn : 0);
  IX.kinds = function (filter) {
    const P = DBG.Passport, m = new Map(), re = filter ? new RegExp(filter) : null;
    for (const e of P.list) {
      if (!e.alive || !(e.role === 'solid' || e.role === 'trunk' || e.role === 'pushable')) continue;
      const k = e.role === 'trunk' ? base(e.name) + '|trunk' : IX.kindKey(e); if (re && !re.test(k)) continue;
      if (!m.has(k)) m.set(k, []); m.get(k).push(e);
    }
    return m;
  };
  const center = (e) => { if (e.role === 'pushable' && e.debris) { const p = e.debris.mesh.position; return { x: p.x, z: p.z }; } if (e.trunk) return { x: e.trunk.x, z: e.trunk.z }; const b = e.box; return { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 }; };
  const rad = (e) => { if (e.trunk) return e.trunk.r; const b = e.box; return Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2; };
  // pick a representative instance: a mid-size one, on dry ground, reachable
  IX.pickInstance = function (list) {
    const ok = list.filter((e) => { const c = center(e); return DBG.getH(c.x, c.z) > 0.6; });
    const L = (ok.length ? ok : list).slice().sort((a, b) => rad(a) - rad(b));
    return L[Math.floor(L.length / 2)];
  };
  // walk at the entry from direction `ang` (world, rad) → engaged? + gaps
  IX.approach = async function (e, ang, o = {}) {
    const P = DBG.player, CT = INTERACTION.CT, c = center(e), R = rad(e) + (o.start || 2.4);
    const sx = c.x + Math.sin(ang) * R, sz = c.z + Math.cos(ang) * R, face = Math.atan2(Math.sin(ang), Math.cos(ang));   // forward = (-sin face, -cos face) → toward the centre
    DBG.teleport(sx, sz, face); P.face = face; P.c.g.rotation.y = face; DBG.cam.yaw = face; if (INTERACTION.CT) { CT.state = 'idle'; CT.pick = null; CT.sense = null; CT.wantIntent = 'none'; CT.senseT = 0.3; CT.target = null; }
    await wait(900);
    const t0 = performance.now(); let still = 0, moved = 0; const K = DBG.keys; K.KeyW = true;
    while (performance.now() - t0 < (o.walk || 4000)) {
      await wait(50); const sp = Math.hypot(P.vx, P.vz); if (sp > 0.8) moved = 1; still = sp < 0.25 && moved ? still + 50 : 0;
      if (CT.state !== 'idle' || still > 250) break;
      if (e.role === 'pushable' && INTERACTION.B.arms.mode === 'push' && INTERACTION.B.arms.w > 0.8) break;
    }
    const r = { ang: +ang.toFixed(2), walkMs: Math.round(performance.now() - t0), dist0: +Math.hypot(P.x - c.x, P.z - c.z).toFixed(2) };
    if (e.role === 'pushable') {   // pushing: keep W held, sample while the hands are on it
      // the hands are on the prop while the arms' push weight is high; the prop moves → the drawn set is rebuilt per sample
      const gaps = []; let pushing = 0;
      for (let k = 0; k < 24; k++) { await wait(70); const Aa = INTERACTION.B.arms; if (Aa.mode !== 'push') continue; pushing++; if (Aa.w < 0.5) continue;
        IX.nearDrawn(4); for (const s of ['l', 'r']) { const g = IX.gap('hand_' + s, { x: Math.sin(P.face), y: 0, z: Math.cos(P.face) }); if (g && g.gapCm != null) gaps.push(g.gapCm); } }
      K.KeyW = false; r.engaged = pushing > 3; r.clip = 'push(arms IK)'; r.gaps = gaps;
      if (gaps.length) { const s2 = gaps.slice().sort((a, b) => a - b); r.eff = { hands: { med: s2[s2.length >> 1], min: s2[0], max: s2[s2.length - 1], n: s2.length } }; r.worstCm = Math.abs(s2[s2.length >> 1]); }
      return r;
    }
    K.KeyW = false;
    const t1 = performance.now();
    while (performance.now() - t1 < (o.engage || 3500) && !(CT.state === 'play')) await wait(50);
    r.state = CT.state; r.intent = CT.wantIntent; r.engaged = CT.state === 'play';
    if (!r.engaged) return r;
    IX.nearDrawn(8);
    // settle past the enter clip, then sample every active hand/foot/shoulder contact of the clip
    const A = DBG.AV.player; const t2 = performance.now(); const samples = {};
    while (performance.now() - t2 < (o.hold || 2200) && CT.state === 'play') {
      await new Promise((res) => requestAnimationFrame(res));
      const m = CT.meta.clips[A.cur]; if (!m || !m.contacts) continue; r.clip = A.cur;
      const act = A.acts[A.cur], t = act ? act.time : 0;
      for (const cc of m.contacts) {
        const w0 = cc.window[0] - cc.blendIn, w1 = cc.window[1] + cc.blendOut, w = t < w0 || t > w1 ? 0 : t < cc.window[0] ? (t - w0) / cc.blendIn : t > cc.window[1] ? (w1 - t) / cc.blendOut : 1;
        if (w < 0.7 || (m.loop && t < 0.05 && CT.t < 0.3)) continue;
        const eff = cc.bone; if (!/^(hand|foot|upperarm)/.test(eff) || cc.hold === false) continue;   // pass-through contacts (step-over foot clearance) are not touches
        if (CT.phase === 'enter') continue;
        // measuring direction from the pilot's own pose only (never the module's target): facing for walls, the side for
        // shoulder leans, straight down for tops — the distance itself is found on the drawn mesh
        let nrm = null;
        { const f = P.face; nrm = /upperarm_r/.test(eff) ? { x: -Math.cos(f), y: 0, z: Math.sin(f) } : /upperarm_l/.test(eff) ? { x: Math.cos(f), y: 0, z: -Math.sin(f) } : cc.surface.normal[1] > 0.7 ? { x: 0, y: 1, z: 0 } : { x: Math.sin(f), y: 0, z: Math.cos(f) }; }
        const g = IX.gap(eff, nrm); if (!g) continue;
        if (g.none || g.gapCm == null) { r.air = (r.air || 0) + 1; continue; }   // no drawn surface within 60 cm under the palm: a hand in the air
        (samples[eff] = samples[eff] || []).push(g.gapCm); r.obj = g.obj;
      }
    }
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    r.eff = Object.fromEntries(Object.entries(samples).map(([k, a]) => [k, { med: +med(a).toFixed(1), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1), n: a.length }]));
    const meds = Object.values(r.eff).map((x) => Math.abs(x.med)); r.worstCm = meds.length ? Math.max(...meds) : null;
    const measured = Object.values(r.eff).reduce((a, x) => a + x.n, 0);
    if ((r.air || 0) > measured) r.worstCm = 99;   // mostly palms in the air (reported as ≥ 60 cm)
    return r;
  };
  IX.testKinds = async function (filter, o = {}) {
    const out = [], angs = o.angles || [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (const [k, list] of IX.kinds(filter)) {
      const e = IX.pickInstance(list); if (!e) continue;
      const row = { kind: k, inst: e.name, size: +(rad(e) * 2).toFixed(2), tries: [] };
      for (const a of angs) { let r; try { r = await IX.approach(e, a + (o.rot || 0), o); } catch (err) { r = { error: String(err.message || err).slice(0, 200) }; } row.tries.push(r); }
      const eng = row.tries.filter((t) => t.engaged); row.engaged = eng.length + '/' + row.tries.length;
      const ws = eng.map((t) => t.worstCm).filter((x) => x != null); row.worstCm = ws.length ? +Math.max(...ws).toFixed(1) : null; row.medCm = ws.length ? +ws.sort((a, b) => a - b)[ws.length >> 1].toFixed(1) : null;
      out.push(row); console.log('[IX]', k, row.engaged, row.worstCm);
    }
    return out;
  };
  IX.summary = (rows) => rows.map((r) => `${r.kind.padEnd(34)} ${r.engaged}  worst ${r.worstCm}  med ${r.medCm}  clips ${[...new Set(r.tries.map((t) => t.clip || t.state || t.error))].join(',')}`).join('\n');
})();
(function () {
  const IX = window.IX, wait = IX.wait;
  // ---- animals vs solids: frames in which a stag / the fox body capsule overlaps a Passport solid / trunk / prop ----
  function world() { const P = DBG.PH.P; return { W: P.world, R: P.RAPIER, P }; }
  let EXC = null;
  function excluded() {   // terrain heightfield + sea-ice slab collider handles (the ground is not an obstacle)
    if (EXC) return EXC; const { P } = world(); EXC = new Set();
    for (const [x, z] of [[0, 0], [300, 300], [-300, -300]]) { const h = P.raycast({ x, y: 400, z }, { x: 0, y: -1, z: 0 }, 800, { groups: P.groups.STATIC }); if (h && h.tag && (h.tag.kind === 'terrain' || h.tag.kind === 'ice')) EXC.add(h.collider.handle); }
    const h = P.raycast({ x: 450, y: 50, z: 450 }, { x: 0, y: -1, z: 0 }, 200, { groups: P.groups.STATIC }); if (h) EXC.add(h.collider.handle);
    return EXC;
  }
  function overlaps(x, y, z, yaw, half, r) {
    const { W, R, P } = world(), ex = excluded();
    const shape = new R.Capsule(half, r), s = Math.sin(yaw), c = Math.cos(yaw);
    // capsule axis (local Y) → horizontal forward (sin yaw, 0, cos yaw): rotate Y by 90° about the axis (cos yaw, 0, −sin yaw)
    const ax = c, az = -s, h = Math.SQRT1_2, rot = { x: ax * h, y: 0, z: az * h, w: h };
    const G = P.groups, grp = ((0xffff) << 16) | (G.STATIC | G.TRUNK | G.PROP);
    let hit = null;
    W.intersectionsWithShape({ x, y, z }, rot, shape, (col) => { if (ex.has(col.handle)) return true; hit = col; return false; }, undefined, grp, undefined, undefined, (col) => !ex.has(col.handle));
    return hit;
  }
  IX.overlaps = overlaps;
  const solidsNear = (x, z, lo, hi) => DBG.Passport.list.filter((e) => e.alive && (e.role === 'solid' || e.role === 'trunk') && e.box && Math.max(e.box.max[0] - e.box.min[0], e.box.max[2] - e.box.min[2]) > 1.2 && Math.max(e.box.max[1] - e.box.min[1]) > 0.8)
    .map((e) => ({ e, x: (e.box.min[0] + e.box.max[0]) / 2, z: (e.box.min[2] + e.box.max[2]) / 2, r: Math.hypot(e.box.max[0] - e.box.min[0], e.box.max[2] - e.box.min[2]) / 2 }))
    .map((o) => Object.assign(o, { d: Math.hypot(o.x - x, o.z - z) })).filter((o) => o.d > lo && o.d < hi && DBG.getH(o.x, o.z) > 0.5).sort((a, b) => a.d - b.d);
  // 30 s: every 5 s each stag bolts straight at the nearest sizeable solid 10–45 m away; the fox is sent to a point
  // behind a rock (seek) — the same scripted scenario before / after
  IX.animals = async function (secs = 30) {
    const S = DBG.STAGS, F = DBG.fox, P = DBG.player, G = DBG.G, gh = DBG.groundH;
    const st = { frames: 0, stagFrames: 0, stagOver: 0, foxFrames: 0, foxOver: 0, perStag: S.map(() => 0), foxStuck: 0, hits: {} };
    F.joined = true; F.st = 'follow';
    const used = new Set(); let cyc = -1; const t0 = performance.now();
    // park the pilot next to the herd (the game's flee rules need the player within 26 m)
    const h0 = S[0]; DBG.teleport(h0.x + 20, h0.z + 20, 0); await wait(800);
    let fx0 = F.x, fz0 = F.z, stuckT = 0;
    while (performance.now() - t0 < secs * 1000) {
      const c = Math.floor((performance.now() - t0) / 5000);
      if (c !== cyc) {
        cyc = c;
        for (const s of S) {
          const t = solidsNear(s.x, s.z, 10, 45).find((o) => !used.has(o.e.id)); if (!t) continue; used.add(t.e.id);
          const d = Math.hypot(t.x - s.x, t.z - s.z); s.st = 'flee'; s.t = 6; s.fx = (t.x - s.x) / d; s.fz = (t.z - s.z) / d; s.A.loop('run', 0.15);
        }
        // fox: go to a point on the far side of the nearest rock
        const r = solidsNear(F.x, F.z, 3, 30)[0];
        if (r) { const dx = r.x - F.x, dz = r.z - F.z, d = Math.hypot(dx, dz), tx = r.x + dx / d * (r.r + 3), tz = r.z + dz / d * (r.r + 3); F.target = { x: tx, z: tz, y: gh(tx, tz), taken: false }; F.st = 'seek'; F.seekT = 99; }
        DBG.teleport(F.x + 8, F.z + 8, 0);   // the pilot stays near the fox (seek gives up beyond 120 m), clear of it
      }
      await new Promise((res) => requestAnimationFrame(res));
      if (G.pause || DBG.Dialog.active) continue;
      st.frames++;
      S.forEach((s, i) => {
        // blocked / sliding: a fleeing stag that moved < 40 % of its intended step this frame (pressed against / scraping along a solid)
        const pv = s.__pv; s.__pv = { x: s.x, z: s.z, t: performance.now() };
        if (pv && s.st === 'flee') { const dt = (s.__pv.t - pv.t) / 1000, want = Math.hypot(s.fx, s.fz) * 11 * dt, got = Math.hypot(s.x - pv.x, s.z - pv.z); if (want > 0.05) { st.fleeFrames = (st.fleeFrames || 0) + 1; if (got < want * 0.4) st.stagBlocked = (st.stagBlocked || 0) + 1; } }
        if (!s.g.visible) return; st.stagFrames++;
        const hit = overlaps(s.x, gh(s.x, s.z) + 1.05, s.z, s.yaw, 0.55, 0.36);
        if (hit) { st.stagOver++; st.perStag[i]++; const tg = DBG.PH.P.raycast({ x: s.x, y: 60, z: s.z }, { x: 0, y: -1, z: 0 }, 1, {}); void tg; }
      });
      st.foxFrames++;
      if (overlaps(F.x, gh(F.x, F.z) + 0.3, F.z, F.yaw + Math.PI, 0.22, 0.14)) st.foxOver++;
      if (F.st === 'seek' && Math.hypot(F.x - fx0, F.z - fz0) < 0.02) stuckT++; fx0 = F.x; fz0 = F.z;
    }
    st.foxStuckFrames = stuckT;
    st.stagPct = +(st.stagOver / Math.max(1, st.stagFrames) * 100).toFixed(2); st.foxPct = +(st.foxOver / Math.max(1, st.foxFrames) * 100).toFixed(2);
    return st;
  };
})();
(function () {
  const IX = window.IX, wait = IX.wait, raf = () => new Promise((r) => requestAnimationFrame(r));
  // a slope spot near the station: ~28° over 3 m, open (nothing solid within 4 m)
  IX.slopeSpot = function (deg = 28) {
    const want = Math.cos(deg * Math.PI / 180), c = DBG.POI.station;
    for (let r = 15; r < 140; r += 3) for (let a = 0; a < 6.28; a += 0.2) {
      const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r; if (DBG.getH(x, z) < 1) continue;
      const ny = DBG.MODCTX.normalY(x, z); if (Math.abs(ny - want) > 0.03) continue;
      let ok = true; for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(DBG.MODCTX.normalY(x + ox, z + oz) - want) > 0.06) ok = false;
      if (!ok) continue;
      const P = DBG.PH.P; for (let k = 0; k < 8 && ok; k++) { const aa = k / 8 * 6.28, h = P.raycast({ x, y: DBG.groundH(x, z) + 0.8, z }, { x: Math.sin(aa), y: 0, z: Math.cos(aa) }, 4, { groups: P.groups.STATIC | P.groups.TRUNK | P.groups.PROP }); if (h && h.tag && h.tag.kind !== 'terrain') ok = false; }
      if (!ok) continue;
      const e = 0.8, gx = DBG.getH(x + e, z) - DBG.getH(x - e, z), gz = DBG.getH(x, z + e) - DBG.getH(x, z - e), l = Math.hypot(gx, gz);
      return { x, z, down: [-gx / l, -gz / l], deg: +(Math.acos(ny) * 180 / Math.PI).toFixed(1) };
    }
    return null;
  };
  // spawn a copy of a pushable (same drawn mesh + hull proxy points) as a test body, fitted primitive or raw hull
  IX.spawnTestProp = function (name, fit, at) {
    const T = DBG.THREE, e = DBG.Passport.byRole.pushable.find((q) => q.name === name && q.debris); if (!e) return null;
    const src = e.debris.mesh, px = new T.Mesh(src.geometry, src.material); for (const ch of src.children) px.add(ch.clone());
    px.scale.copy(src.scale); px.quaternion.copy(src.quaternion);
    const b = new T.Box3().setFromObject(src); px.position.set(at.x, DBG.groundH(at.x, at.z) + (src.position.y - b.min.y) + 0.02, at.z);
    DBG.scene.add(px); px.updateMatrixWorld(true);
    const d = DBG.PH.P.spawnDebris(px, { shape: 'convex', prop: true, mass: (e.opts && e.opts.mass) || 18, fit });
    return { d, px, fit: d.fit, name };
  };
  // push a test prop down a slope, record until settled; jitter = motion after it first comes to rest
  IX.pushTest = async function (name = 'crate_wood_02', fit = true, o = {}) {
    const sp = o.spot || IX.slopeSpot(o.deg || 28); if (!sp) return { error: 'no slope' };
    DBG.teleport(sp.x - sp.down[0] * 4, sp.z - sp.down[1] * 4, 0); await wait(600);
    const t = IX.spawnTestProp(name, fit, sp); if (!t) return { error: 'no prop ' + name };
    const B = t.d.body, T = DBG.THREE, up0 = new T.Vector3(0, 1, 0).applyQuaternion(t.px.quaternion);
    await wait(100);
    const m = B.mass(), J = o.impulse || 4.2;   // m/s of shove, applied at 70 % of the height: a hard shove / bump
    const bb = new T.Box3().setFromObject(t.px), hy = bb.min.y + (bb.max.y - bb.min.y) * 0.7, p = B.translation();
    B.applyImpulseAtPoint({ x: sp.down[0] * J * m, y: 0, z: sp.down[1] * J * m }, { x: p.x, y: hy, z: p.z }, true);
    const rows = []; const t0 = performance.now(); let restAt = null, rest = null, maxTilt = 0, wakes = 0, wasSleep = false, jit = 0, jitV = 0, travel = 0; const s0 = { x: p.x, z: p.z };
    while (performance.now() - t0 < (o.ms || 7000)) {
      await raf();
      const q = B.rotation(), tp = B.translation(), lv = B.linvel(), av = B.angvel(), sl = B.isSleeping();
      const up = new T.Vector3(0, 1, 0).applyQuaternion(new T.Quaternion(q.x, q.y, q.z, q.w)), tilt = Math.acos(Math.min(1, Math.abs(up.dot(new T.Vector3(0, 1, 0))))) * 180 / Math.PI;
      maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, up.dot(up0))) * 180 / Math.PI);
      const sp2 = Math.hypot(lv.x, lv.y, lv.z), w = Math.hypot(av.x, av.y, av.z), tt = (performance.now() - t0) / 1000;
      travel = Math.max(travel, Math.hypot(tp.x - s0.x, tp.z - s0.z));
      if (wasSleep && !sl) wakes++; wasSleep = sl;
      if (!restAt && (sl || (sp2 < 0.03 && w < 0.05))) { restAt = tt; rest = { x: tp.x, y: tp.y, z: tp.z }; }
      else if (restAt && sp2 > 0.08) { restAt = null; rest = null; }   // it was only a pause
      if (restAt && tt - restAt > 0.05) { jit = Math.max(jit, Math.hypot(tp.x - rest.x, tp.y - rest.y, tp.z - rest.z)); jitV = Math.max(jitV, sp2); }
      if (rows.length < 400) rows.push([+tt.toFixed(2), +sp2.toFixed(3), +w.toFixed(3), +tilt.toFixed(1), sl ? 1 : 0]);
    }
    const out = { name, fit: t.fit || 'hull', slopeDeg: sp.deg, restAt: restAt && +restAt.toFixed(2), sleeping: B.isSleeping(), maxTiltDeg: +maxTilt.toFixed(1), toppled: maxTilt > 60,
      travelM: +travel.toFixed(2), jitterMm: +(jit * 1000).toFixed(2), jitterSpeed: +jitV.toFixed(3), wakesAfterSleep: wakes, trace: rows.filter((_, i) => i % 15 === 0) };
    DBG.PH.P.removeDebris(t.d);
    return out;
  };
  // per-frame cost: interaction module (EMA) + physics step (wrapped) over `ms`, current scene
  IX.cost = async function (label, ms = 4000) {
    const P = DBG.PH.P, st = P.step; let n = 0, sum = 0, mx = 0;
    P.step = function (dt) { const t = performance.now(); const r = st.call(this, dt); const d = performance.now() - t; n++; sum += d; mx = Math.max(mx, d); return r; };
    const I = window.INTERACTION.STATS, fr0 = I.frames; let isum = 0, imax = 0, k = 0; const t0 = performance.now(); let frames = 0, ft = [];
    let last = performance.now();
    while (performance.now() - t0 < ms) { await raf(); const now = performance.now(); ft.push(now - last); last = now; frames++; isum += I.ms; imax = Math.max(imax, I.ms); k++; }
    P.step = st;
    ft.sort((a, b) => a - b);
    let awake = 0, props = 0; for (const d of P.debris) if (d.prop) { props++; if (!d.body.isSleeping()) awake++; }
    return { label, frames, frameMedMs: +ft[ft.length >> 1].toFixed(2), frameP95Ms: +ft[Math.floor(ft.length * 0.95)].toFixed(2), physStepMs: +(sum / Math.max(1, n)).toFixed(3), physStepMaxMs: +mx.toFixed(2),
      interactionMsEma: +(isum / Math.max(1, k)).toFixed(3), interactionMsMax: +imax.toFixed(3), plans: window.INTERACT ? Object.assign({}, window.INTERACT.STATS) : null, avoidRays: window.INTERACTION.STATS.avoidRays, propsAwake: awake, props };
  };
})();
(function () {
  // passport self-check over every instance of every marked kind
  IX.verifyAll = function () {
    const out = {};
    for (const e of DBG.Passport.list) { if (!e.alive || e.role === 'trunk' || !INTERACT.hasPoints(e)) continue; const k = INTERACT.kindKey(e), v = INTERACT.verify(e); if (!v) continue;
      const r = out[k] || (out[k] = { inst: 0, pts: 0, on: 0, worstCm: 0, noFrame: 0, maxResidCm: 0 }); r.inst++;
      if (v.error) { r.noFrame++; continue; } r.pts += v.n; r.on += v.on; r.worstCm = Math.max(r.worstCm, v.worstCm); r.maxResidCm = Math.max(r.maxResidCm, v.resid || 0); }
    for (const k in out) out[k].onPct = +(out[k].on / Math.max(1, out[k].pts) * 100).toFixed(1);
    return out;
  };
})();
(function () {
  const IX = window.IX, wait = IX.wait;
  // cost scenarios (run under CDP CPU throttling): per frame = interaction module EMA, physics step, frame time
  IX.costSuite = async function () {
    const out = [], P = DBG.player;
    const open = IX.slopeSpot(3) || { x: DBG.POI.crash.x + 30, z: DBG.POI.crash.z };
    DBG.teleport(open.x, open.z, 0); await wait(1500); out.push(await IX.cost('idle, open snow', 3000));
    // holding a contact on a ruin wall
    const w = IX.kinds('^st_ruin_wall\\|'); const we = w.size ? IX.pickInstance([...w.values()][0]) : null;
    if (we) { for (const a of [3.14, 1.57, 4.71, 0]) { const r = await IX.approach(we, a, { hold: 10 }); if (r.engaged) break; } out.push(await IX.cost('holding a contact (' + (DBG.AV.player.cur || '-') + ')', 3000)); DBG.keys.KeyS = true; await wait(300); DBG.keys.KeyS = false; }
    // the herd bolting toward rocks (steering rays active)
    const S = DBG.STAGS; DBG.teleport(S[0].x + 18, S[0].z + 18, 0); await wait(800);
    for (const s of S) { s.st = 'flee'; s.t = 6; const a = Math.random() * 6.28; s.fx = Math.sin(a); s.fz = Math.cos(a); s.A.loop('run', 0.15); }
    await wait(300); out.push(await IX.cost('stags fleeing (6)', 3000));
    // pushing a crate
    const pe = DBG.Passport.byRole.pushable.find((q) => /crate_wood_02|drum_blue/.test(q.name) && q.debris);
    if (pe) { const m = pe.debris.mesh.position, a = 0.4; DBG.teleport(m.x + Math.sin(a) * 1.5, m.z + Math.cos(a) * 1.5, a); P.face = a; DBG.cam.yaw = a; await wait(900); DBG.keys.KeyW = true; await wait(400); out.push(await IX.cost('pushing ' + pe.name, 2500)); DBG.keys.KeyW = false; }
    // props at rest, pilot beside them (awake count, step cost)
    await wait(2500); out.push(await IX.cost('props at rest nearby', 2500));
    return out;
  };
})();
