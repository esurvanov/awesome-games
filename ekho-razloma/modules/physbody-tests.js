/* modules/physbody-tests.js — the measurement helpers for tools/physbody.mjs (PHYSBODY.testPush, testHit, testBump, testFall, testStop, cost) and the spot finders they use. Moved out of modules/physbody.js unchanged. Classic script, loaded BEFORE physbody.js: window.createPhysbodyTests(deps) → the helpers and bind({...}). */
(function () {
  'use strict';
  window.createPhysbodyTests = function (X) {
    const { RG, STATS, S, K, _p, hit, springs, trigger } = X;
    let C, V3;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ tests (tools/physbody.mjs) */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function flatSpot(k = 0) {
    const D = window.DBG, out = [];
    for (let r = 18; r < 160 && out.length <= k; r += 5) for (let a = 0; a < 6.28 && out.length <= k; a += 0.35) {
      const x = C.POI.crash.x + Math.sin(a) * r, z = C.POI.crash.z + Math.cos(a) * r;
      if (C.getH(x, z) < 1 || C.normalY(x, z) < 0.995 || C.inRift(x, z, 8)) continue;
      if ((C.FOREST && C.FOREST.list || []).some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 36)) continue;
      if (C.PH.ok) { const h = C.PH.P.raycast({ x, y: C.groundH(x, z) + 30, z }, { x: 0, y: -1, z: 0 }, 40, { groups: C.PH.P.groups.STATIC }); if (!h || !h.tag || h.tag.kind !== 'terrain') continue; }
      if (out.every((q) => Math.hypot(q.x - x, q.z - z) > 10)) out.push({ x, z });
    }
    void D; return out[k] || out[out.length - 1];
  }
  function findSlope(deg = 25) {   // planar terrain patch of `deg`, no solids / trees around (same rule as INTERACTION.testIK)
    const want = Math.cos(deg * Math.PI / 180);
    for (let i = 0; i < 30000; i++) {
      const x = (Math.random() - 0.5) * 600, z = (Math.random() - 0.5) * 600;
      if (C.getH(x, z) < 3 || C.inRift(x, z, 10) || C.nearPOI(x, z, 12)) continue;
      if (Math.abs(C.normalY(x, z) - want) > 0.012) continue;
      let ok = true; for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [4, 0], [-4, 0]]) if (Math.abs(C.normalY(x + ox, z + oz) - want) > 0.03) { ok = false; break; }
      if (!ok) continue;
      if (C.PH.ok) { const h = C.PH.P.raycast({ x, y: C.getH(x, z) + 30, z }, { x: 0, y: -1, z: 0 }, 40, { groups: C.PH.P.groups.STATIC }); if (!h || (h.tag && h.tag.kind !== 'terrain')) continue; }
      if ((C.FOREST && C.FOREST.list || []).some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 64)) continue;
      const e = 1, gx = C.getH(x + e, z) - C.getH(x - e, z), gz = C.getH(x, z + e) - C.getH(x, z - e);
      return { x, z, upYaw: Math.atan2(-gx, -gz) };
    }
    return null;
  }
  // a solid (rock / structure) at least `minH` tall with a walkable top: stand on the top, the edge in `dir`
  function findLedge(minH = 5.6) {
    const PH = C.PH; if (!PH.ok) return null; const P = C.player; let best = null;
    for (const e of (C.Passport && C.Passport.list) || []) {
      if (!e.box || !e.name) continue; const sy = e.box.max[1] - e.box.min[1], sx = e.box.max[0] - e.box.min[0], sz = e.box.max[2] - e.box.min[2];
      if (sy < minH || sy > 14 || Math.min(sx, sz) < 2.5) continue;
      const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2;
      const top = PH.P.raycast({ x: cx, y: e.box.max[1] + 2, z: cz }, { x: 0, y: -1, z: 0 }, sy + 3, { groups: PH.P.groups.STATIC });
      if (!top || top.normal.y < 0.8 || top.point.y - C.groundH(cx, cz) < minH) continue;
      // walk-off direction: towards the lowest ground within 8 m
      let dir = null, drop = 0;
      for (let a = 0; a < 6.28; a += 0.4) { const x = cx + Math.sin(a) * (Math.max(sx, sz) / 2 + 2), z = cz + Math.cos(a) * (Math.max(sx, sz) / 2 + 2), g = C.groundH(x, z), d = top.point.y - g;
        if (d > drop) { drop = d; dir = a; } }
      if (drop < minH) continue;
      const dd = Math.hypot(cx - P.x, cz - P.z);
      if (!best || dd < best.dd) best = { x: top.point.x, z: top.point.z, y: top.point.y, dirA: dir, drop, name: e.name, dd };
    }
    return best;
  }
  const place = async (x, z, yaw, ms = 1300) => { const D = window.DBG; D.teleport(x, z, yaw); C.player.face = yaw; C.player.c.g.rotation.y = yaw; D.cam.yaw = yaw; await wait(ms); };
  // records chain angles (deg) and the signed offset along `dir` every frame for `ms`
  function recordChains(ms, dir) {
    return new Promise((resolve) => {
      const rows = [], t0 = performance.now();
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        const r = { t }; for (const c of S.chains) { r[c.d.id] = c.ang * 180 / Math.PI; r[c.d.id + '_s'] = dir ? (c.sAng.x * dir.x + c.sAng.z * dir.z) : 0; }
        r.g = !!C.player.onGround; r.st = RG.st || '';
        const pe = S.bones.pelvis.matrixWorld.elements, he = S.bones.Head.matrixWorld.elements; r.nan = !Number.isFinite(pe[12] + pe[13] + pe[14] + he[12] + he[13] + he[14]);
        rows.push(r); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(rows);
      };
      requestAnimationFrame(tick);
    });
  }
  function settleStats(rows, id, tHit) {   // peak, time back to ≤ 15 % of peak (and staying), overshoot of the signed offset
    const R = rows.filter((r) => r.t >= tHit);
    let pk = 0, tp = 0; for (const r of R) if (r[id] > pk) { pk = r[id]; tp = r.t; }
    let tb = 0; for (let i = R.length - 1; i >= 0; i--) { if (R[i][id] > Math.max(0.15 * pk, 0.8)) { tb = i + 1 < R.length ? R[i + 1].t - tHit : 9; break; } }
    const s = R.map((r) => r[id + '_s']), smax = Math.max(...s.map(Math.abs)), sgn = Math.sign(s[s.findIndex((v) => Math.abs(v) === smax)] || 1);
    const after = R.filter((r) => r.t > tp).map((r) => r[id + '_s'] * sgn), over = Math.max(0, -Math.min(0, ...after));
    return { peakDeg: +pk.toFixed(1), tPeak: +(tp - tHit).toFixed(2), backS: +tb.toFixed(2), overshootPct: smax > 1e-4 ? +(over / smax * 100).toFixed(1) : 0 };
  }
  async function testPush(o = {}) {
    if (!S.ready) return { error: 'not ready' };
    const s = flatSpot(o.k || 0); if (!s) return { error: 'no flat spot' };
    await place(s.x, s.z, 0.6, 1800);
    const dir = { x: Math.sin(1.1), z: Math.cos(1.1) };
    const recP = recordChains(1500, dir); await wait(250);
    hit(dir.x, dir.z, o.k2 || 1);
    const rows = await recP;
    const th = rows.find((r, i) => i && r.spine > 0.3) || rows[0], tH = th.t - 0.02;
    const out = { spot: [+s.x.toFixed(1), +s.z.toFixed(1)], nanFrames: rows.filter((r) => r.nan).length, frames: rows.length };
    for (const id of ['spine', 'head', 'upper_l', 'upper_r', 'fore_l', 'fore_r']) out[id] = settleStats(rows, id, tH);
    out.worstBackS = Math.max(...['spine', 'head', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].map((k) => out[k].backS));
    out.worstOvershootPct = Math.max(...['spine', 'head', 'upper_l', 'upper_r', 'fore_l', 'fore_r'].map((k) => out[k].overshootPct));
    out.pass = out.worstBackS <= 0.6 && out.worstOvershootPct < 15 && !out.nanFrames;
    return out;
  }
  // a real shardling walks up and hits the pilot (the game's own attack → playerHurt → this module)
  async function testHit() {
    const D = window.DBG; if (!S.ready || !D.spawnShardling) return { error: 'not ready' };
    const s = flatSpot(1); await place(s.x, s.z, 0, 1500);
    const P = C.player; P.hp = 99; P.inv = 0; C.G.safeUntil = 0;
    const e = D.spawnShardling(s.x + 3, s.z - 2, null); e.st = 'chase';
    const h0 = STATS.hits, lh = P.lastHurt, t0 = performance.now();
    while (performance.now() - t0 < 8000 && P.lastHurt === lh) await nextFrame();
    if (P.lastHurt === lh) { e.hp = 0; e.dead = true; e.g.visible = false; return { error: 'shardling never hit' }; }
    const rows = await recordChains(1200, { x: P.vx, z: P.vz });
    e.dead = true; e.g.visible = false; e.st = 'idle'; P.hp = P.hpMax;
    const out = { hitsSeen: STATS.hits - h0, nanFrames: rows.filter((r) => r.nan).length };
    for (const id of ['spine', 'head', 'upper_l', 'fore_l']) out[id] = settleStats(rows, id, 0);
    out.worstBackS = Math.max(...['spine', 'head', 'upper_l', 'fore_l'].map((k) => out[k].backS));
    // the game's knock-back is a hop (12 m/s + 5 m/s up): its landing is a second, separate excitation — settle from there
    const iAir = rows.findIndex((r) => !r.g), iLand = iAir >= 0 ? rows.findIndex((r, i) => i > iAir && r.g) : -1;
    if (iLand > 0) { out.hopLandS = +rows[iLand].t.toFixed(2); out.afterLanding = {}; for (const id of ['spine', 'head', 'upper_l', 'fore_l']) out.afterLanding[id] = settleStats(rows, id, rows[iLand].t);
      out.afterLandingWorstBackS = Math.max(...Object.values(out.afterLanding).map((q) => q.backS)); }
    return out;
  }
  // walk into a wall-like solid (tall rock face, ruin wall, hab, wreck) at 30° to its face: the capsule slides along it, the
  // near shoulder / arm meet it, the chest turns away and recovers; nothing penetrates, nothing explodes
  function findWall(o = {}) {
    const PH = C.PH; if (!PH.ok) return null;
    const cands = [];
    for (const e of (C.Passport && C.Passport.list) || []) {
      if (!e.name || !e.box || !/rock|ruin|wall|hab|station|kestrel|boulder/i.test(e.name)) continue;
      const sy = e.box.max[1] - e.box.min[1], sx = e.box.max[0] - e.box.min[0], sz = e.box.max[2] - e.box.min[2]; if (sy < 2.4 || Math.max(sx, sz) < 2.5) continue;
      const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2;
      cands.push({ x: cx, z: cz, r: Math.max(sx, sz) / 2, d: Math.hypot(cx - C.POI.crash.x, cz - C.POI.crash.z), name: e.name });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const t of cands.slice(o.skip || 0, (o.skip || 0) + 12)) {
      // a clear, flat approach 5 m out; the face point and its normal at shoulder height
      for (let a = 0; a < 6.28; a += 0.5) {
        const sx = t.x + Math.sin(a) * (t.r + 4.5), sz = t.z + Math.cos(a) * (t.r + 4.5), gy = C.groundH(sx, sz);
        if (C.normalY(sx, sz) < 0.97) continue;
        const dx = t.x - sx, dz = t.z - sz, dl = Math.hypot(dx, dz);
        const h = PH.P.raycast({ x: sx, y: gy + 1.4, z: sz }, { x: dx / dl, y: 0, z: dz / dl }, t.r + 5, { groups: PH.P.groups.STATIC });
        const h2 = PH.P.raycast({ x: sx, y: gy + 0.5, z: sz }, { x: dx / dl, y: 0, z: dz / dl }, t.r + 5, { groups: PH.P.groups.STATIC });
        if (!h || !h2 || !h.normal || Math.abs(h.normal.y) > 0.35 || h.distance < 2.5 || Math.abs(h.distance - h2.distance) > 0.35) continue;   // a wall-ish face, not an overhang / slope
        const nl = Math.hypot(h.normal.x, h.normal.z), nx = h.normal.x / nl, nz = h.normal.z / nl;
        // walk direction: into the face at 30° (−n rotated 60° toward the tangent)
        const wa = Math.atan2(-nx, -nz) + (o.side || 1) * 1.05, wx = Math.sin(wa), wz = Math.cos(wa);
        const start = { x: h.point.x - wx * 3.2 + nx * 0.2, z: h.point.z - wz * 3.2 + nz * 0.2 };
        return { name: t.name, x: start.x, z: start.z, yaw: Math.atan2(-wx, -wz) };
      }
    }
    return null;
  }
  async function testBump(o = {}) {
    const D = window.DBG, PH = C.PH; if (!S.ready || !PH.ok) return { error: PH.ok ? 'not ready' : 'no physics (fallback: no collision layer)' };
    const w = findWall(o); if (!w) return { error: 'no wall-like face found' };
    await place(w.x, w.z, w.yaw, 1400);
    const c0 = STATS.contacts, s0 = STATS.shoulder || 0; D.keys.KeyW = true;
    const rows = await recordChains(2400, null); D.keys.KeyW = false;
    const mx = (id) => +Math.max(...rows.map((r) => r[id])).toFixed(1);
    return { target: w.name, contacts: STATS.contacts - c0, shoulderFrames: (STATS.shoulder || 0) - s0, maxDeg: { spine: mx('spine'), head: mx('head'), upper_l: mx('upper_l'), upper_r: mx('upper_r'), fore_l: mx('fore_l'), fore_r: mx('fore_r') }, nanFrames: rows.filter((r) => r.nan).length };
  }
  // fall from a height (a rock top if one is tall enough, else a drop from 7 m): ragdoll (or fall clip), get up
  async function testFall(o = {}) {
    const D = window.DBG, P = C.player; if (!S.ready) return { error: 'not ready' };
    const s = flatSpot(2); await place(s.x, s.z, 0.3, 1200);
    const h = o.h || 7.5, gy = C.groundH(s.x, s.z);
    D.teleport(s.x, s.z, 0.3, gy + h); P.vx = P.vz = 0; if (C.PH.ok) C.PH.ch.setVelocity(1.5 * Math.sin(-0.3), 0, 1.5 * -Math.cos(0.3));
    const out = { mode: C.PH.ok ? 'ragdoll' : 'clip', dropM: h }; K.checkPen = true;
    const t0 = performance.now(); let tStart = null, tGetup = null, tEnd = null, nan = 0, pen = 0, frames = 0, minHead = 9;
    while (performance.now() - t0 < 9000) {
      await nextFrame(); frames++;
      if (RG.st && tStart === null) tStart = performance.now();
      if ((RG.st === 'blend' || RG.st === 'getup') && tGetup === null) tGetup = performance.now();
      if (tStart !== null && !RG.st) { tEnd = performance.now(); break; }
      for (const n of ['pelvis', 'Head', 'hand_l', 'foot_r']) { const e = S.bones[n].matrixWorld.elements; if (!Number.isFinite(e[12] + e[13] + e[14])) nan++; }
      if (RG.rd) pen = Math.max(pen, RG.rd.penetrating(0.05));
      if (RG.st) minHead = Math.min(minHead, S.bones.Head.matrixWorld.elements[13] - P.y);
    }
    K.checkPen = false; out.triggered = tStart !== null; out.why = RG.last ? RG.last.why : RG.why;
    out.ragS = tStart && tGetup ? +((tGetup - tStart) / 1000).toFixed(2) : null; out.getupS = tGetup && tEnd ? +((tEnd - tGetup) / 1000).toFixed(2) : null;
    out.penetratingParts5cm = Math.max(pen, RG.last ? RG.last.pen : 0); out.nanFrames = nan; out.frames = frames; out.headLowestM = +minHead.toFixed(2);
    await wait(400); out.standingAfter = { onGround: P.onGround, chEnabled: C.PH.ok ? !!C.PH.ch.collider.isEnabled() : null, pelvisH: +(S.bones.pelvis.matrixWorld.elements[13] - P.y).toFixed(2) };
    out.pass = out.triggered && out.getupS !== null && out.getupS <= 2 && !nan && out.penetratingParts5cm === 0;
    return out;
  }
  // ms per frame of each layer: walking (springs + collision tips), then a ragdoll (bodies + pose + Rapier step delta)
  async function cost(o = {}) {
    const D = window.DBG, P = C.player, PHP = C.PH.ok ? C.PH.P : null;
    let stepMs = 0, stepN = 0; const origStep = PHP && PHP.step;
    if (PHP) PHP.step = function (dt) { const t = performance.now(); const r = origStep.call(this, dt); stepMs += performance.now() - t; stepN++; return r; };
    const s = flatSpot(3); await place(s.x, s.z, 0, 1500);
    const meas = async (ms) => { let a = 0, n = 0, mx = 0; stepMs = 0; stepN = 0; const t0 = performance.now(); let f0 = STATS.frames;
      const hook = () => { const v = RG.st ? STATS.msRag : STATS.msSpring; a += v; n++; mx = Math.max(mx, v); };
      while (performance.now() - t0 < ms) { await nextFrame(); hook(); }
      return { avgMs: +(a / Math.max(1, n)).toFixed(3), frames: STATS.frames - f0, stepMs: stepN ? +(stepMs / stepN).toFixed(3) : null, fps: +((STATS.frames - f0) / (ms / 1000)).toFixed(1) }; };
    const out = {};
    const sp0 = K.springs; K.springs = false; await wait(300); out.idleOff = await meas(1500); K.springs = sp0;
    D.keys.KeyW = true; await wait(600); out.walkSprings = await meas(2000); D.keys.KeyW = false;
    const sa = []; for (let i = 0; i < 40; i++) { const t = performance.now(); springs(1 / 30, _p[40] || (_p[40] = new V3(0, 0, -1))); sa.push(performance.now() - t); }
    sa.sort((a, b) => a - b); out.springsDirectMs = { median: +sa[20].toFixed(3), p90: +sa[36].toFixed(3) };
    await wait(800); out.idleOn = await meas(1200);
    if (C.PH.ok) { trigger('test', { x: 2, y: 2, z: 0 }); out.ragdoll = await meas(1100); out.ragStepDeltaMs = out.ragdoll.stepMs !== null && out.idleOn.stepMs !== null ? +(out.ragdoll.stepMs - out.idleOn.stepMs).toFixed(3) : null; }
    while (RG.st) await wait(100);
    if (PHP) PHP.step = origStep;
    return out;
  }
  // stop after a walk: horizontal travel of each boot while it is pressing the snow (terrain contact), from the key
  // release to 1.8 s later — the print smears exactly by this much. Needs tools/qa/snowcontact-page.js (window.SC).
  async function testStop(o = {}) {
    const SC = window.SC, P = C.player, D = window.DBG; if (!SC) return { error: 'needs SC (snowcontact-page.js)' };
    const s = SC.openSnow(0.06, o.skip || 0); if (!s) return { error: 'no open snow' };
    const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); await place(s.x, s.z, yaw, 1500);
    const sets = SC.soles('player'); D.keys.KeyW = true; await wait(o.walkMs || 2600); D.keys.KeyW = false;
    const segs = sets.map(() => []), cur = sets.map(() => null), t0 = performance.now();
    while (performance.now() - t0 < 1800) {
      await nextFrame();
      sets.forEach((set, k) => {
        const sn = SC.soleNow(set, 0.02); if (!sn) return; const s0 = C.snowContact ? C.snowContact(sn.ax, sn.az).s0 : C.groundH(sn.ax, sn.az);
        const pressing = sn.minY < s0 - 0.005;
        if (pressing) { if (!cur[k]) { cur[k] = { x0: sn.ax, z0: sn.az, mx: 0, n: 0 }; segs[k].push(cur[k]); } const c = cur[k]; c.mx = Math.max(c.mx, Math.hypot(sn.ax - c.x0, sn.az - c.z0)); c.n++; }
        else cur[k] = null;
      });
    }
    const all = segs.flat().filter((c) => c.n >= 3), mx = all.length ? Math.max(...all.map((c) => c.mx)) : null;
    return { contactSlideCm: mx === null ? null : +(mx * 100).toFixed(2), segments: all.length, perSeg: all.map((c) => +(c.mx * 100).toFixed(1)), settleSteps: window.INTERACTION && INTERACTION.STATS.settleSteps };
  }

    return { flatSpot, findSlope, findLedge, testPush, testHit, findWall, testBump, testFall, cost, testStop, bind(o) { if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; } };
  };
})();
