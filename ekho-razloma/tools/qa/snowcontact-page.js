/* snowcontact-page.js — in-page measurements for SNOW-CONTACT.md (window.SC), injected after qa-page.js.
 *
 * Works on both builds:
 *   'stamps'  (before): prints = entries of terrain.js's stamp log (Terrain.SL.list: x, z, dx, dz, len, wid, type, str)
 *   'contact' (after):  prints = connected blobs of the object-pressed depression map (Terrain.CM.readNear())
 * Plants come from the drawn skeleton only: a foot is planted while its interaction-module contact height L.c < 3 cm
 * (after having been > 7 cm: the same hysteresis the footstep sound uses); its "sole centre" is the xz centroid of the
 * lowest skinned sole vertices (QA.actors foot sets) at mid-stance.
 */
(() => {
  const D = window.DBG, C = D.MODCTX, P = D.player, QA = window.QA, T = D.THREE;
  const SC = window.SC = {};
  const r3 = (x) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1000) / 1000);
  const gh = (x, z) => D.groundH(x, z);
  const TR = () => window.Terrain;
  SC.mode = () => (TR() && TR().CM && TR().CM.ok ? 'contact' : 'stamps');
  const nearTree = (x, z, r) => D.FOREST.list.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < r * r);
  const land = (x, z) => D.getH(x, z) > 0.6 && !(C.inRift && C.inRift(x, z));
  const slope = (x, z) => (C.slopeAt ? C.slopeAt(x, z, 1) : 0);
  // flattest treeless spot near the crash with loose snow ≥ minD (same idea as look-gate's openSnow)
  SC.openSnow = (minD = 0.06, skip = 0) => { let found = [];
    for (let r = 20; r < 150; r += 6) for (let a = 0; a < 6.28; a += 0.3) { const x = D.POI.crash.x + Math.sin(a) * r, z = D.POI.crash.z + Math.cos(a) * r;
      if (!land(x, z) || slope(x, z) > 6 || nearTree(x, z, 20)) continue; const d = C.snowDepthAt ? C.snowDepthAt(x, z) : 0; if (d < minD) continue;
      let ok = true; for (let k = 0; k < 8 && ok; k++) { const xx = x + Math.sin(a + 1.2) * k, zz = z + Math.cos(a + 1.2) * k; if (slope(xx, zz) > 8 || !land(xx, zz)) ok = false; }
      if (!ok) continue; found.push({ x, z, s: slope(x, z) + r * 0.01, d, dirA: a + 1.2 }); }
    found.sort((p, q) => p.s - q.s);
    const pick = []; for (const f of found) if (pick.every((q) => Math.hypot(q.x - f.x, q.z - f.z) > 16)) pick.push(f);   // separate spots: no take walks over another's prints
    return pick[Math.min(skip, pick.length - 1)] || null; };

  /* ------------------------------------------------------------------ soles */
  let soleCache = null;
  SC.soles = (id = 'player') => {
    if (soleCache && soleCache.id === id && soleCache.a.g === (QA.actors({ only: [id], feet: false })[0] || {}).g) return soleCache.sets;
    const a = QA.actors({ only: [id] })[0]; if (!a) return [];
    // group foot vertex sets by side: pilot l/r; quadrupeds: one set per leaf bone (hooves / paws)
    let sets;
    if (id === 'player') {
      // the whole boot: every vertex ≥ 50 % weighted to foot / ball bones (QA's foot sets keep only the lowest 35 % → the toe cap)
      const L = [], R = [], skins = []; a.root.traverse((o) => { if (o.isSkinnedMesh && QA.visibleChain(o)) skins.push(o); });
      for (const sm of skins) { const g = sm.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; if (!si || !sw) continue;
        const side = sm.skeleton.bones.map((b) => (/^(foot|ball)(_leaf)?_l$/.test(b.name) ? 'l' : /^(foot|ball)(_leaf)?_r$/.test(b.name) ? 'r' : null));
        for (let i = 0; i < g.attributes.position.count; i++) { let wl = 0, wr = 0; for (let c = 0; c < 4; c++) { const sd = side[si.getComponent(i, c)], w = sw.getComponent(i, c); if (sd === 'l') wl += w; else if (sd === 'r') wr += w; }
          if (wl >= 0.5) L.push({ sm, i }); else if (wr >= 0.5) R.push({ sm, i }); } }
      const thin = (a2) => { const st = Math.max(1, Math.floor(a2.length / 400)); return a2.filter((_, k) => k % st === 0); };
      sets = [{ side: 'l', verts: thin(L) }, { side: 'r', verts: thin(R) }];
    } else sets = a.feet.map((f) => ({ side: f.bone, verts: f.verts }));
    soleCache = { id, a, sets }; return sets;
  };
  const _v = new T.Vector3();
  // lowest sole vertices of one set: min y, centroid of verts within `band` of the min, centroid of all bottom verts
  SC.soleNow = (set, band = 0.015) => {
    const pts = []; for (const { sm, i } of set.verts) { sm.getVertexPosition(i, _v); sm.localToWorld(_v); pts.push([_v.x, _v.y, _v.z]); }
    if (!pts.length) return null;
    let my = Infinity; for (const p of pts) if (p[1] < my) my = p[1];
    let cx = 0, cz = 0, n = 0, ax = 0, az = 0; for (const p of pts) { ax += p[0]; az += p[2]; if (p[1] < my + band) { cx += p[0]; cz += p[2]; n++; } }
    return { minY: my, cx: cx / n, cz: cz / n, n, ax: ax / pts.length, az: az / pts.length, pts };
  };

  /* ------------------------------------------------------------------ recorder: plants of the pilot */
  SC.recordPilot = (ms, o = {}) => new Promise((resolve) => {
    const I = window.INTERACTION, legs = I && I.B && I.B.legs, sets = SC.soles('player');
    const st = sets.map(() => ({ up: 1, cur: null })), plants = [], events = [], t0 = performance.now();
    const logLen = () => (TR() && TR().SL ? TR().SL.list.length : 0);
    let wasG = P.onGround, airT = 0;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (legs) legs.forEach((L, k) => {
        const s = st[k], c = L.c;
        if (c > 0.07) s.up = 1;
        if (s.up && c < 0.03 && P.onGround) { s.up = 0; s.cur = { side: sets[k].side, t0: t, frames: [], log0: logLen() }; }
        if (s.cur) {
          const sn = SC.soleNow(sets[k], 0.02); if (sn) s.cur.frames.push({ t, cx: sn.ax, cz: sn.az, minY: sn.minY, lx: sn.cx, lz: sn.cz, n: sn.n, c, cp: sn.pts.filter((q) => q[1] < sn.minY + 0.02).map((q) => [q[0], q[2]]) });
          if (c > 0.05 || !P.onGround) { s.cur.t1 = t; s.cur.log1 = logLen(); plants.push(s.cur); s.cur = null; }
        }
      });
      if (!P.onGround) airT += 1 / 60; if (P.onGround && !wasG && airT > 0.15) events.push({ type: 'land', t, x: P.x, z: P.z, log: logLen() }); if (P.onGround) airT = 0; wasG = P.onGround;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else { st.forEach((s) => { if (s.cur) { s.cur.t1 = t; s.cur.log1 = logLen(); s.cur.open = true; plants.push(s.cur); } }); resolve({ plants, events }); }
    };
    requestAnimationFrame(tick);
  });
  // mid-stance summary of a plant: sole centre (bottom-vertex centroid), drift of that centre over the stance
  const summarize = (p) => {
    const F = p.frames; if (!F.length) return null; const a = F[0], b = F[F.length - 1]; let m = F[0]; for (const f of F) if (f.n > m.n) m = f;   // flat-foot frame: most sole vertices within 2 cm of the lowest
    let vx = 0, vz = 0; for (const f of F) { vx += f.lx; vz += f.lz; } vx /= F.length; vz /= F.length;
    return { side: p.side, t: r3(p.t0), dur: r3((p.t1 || p.t0) - p.t0), x: m.lx, z: m.lz, vx, vz, ax: m.cx, az: m.cz, minY: m.minY, drift: r3(Math.hypot(b.cx - a.cx, b.cz - a.cz)), log0: p.log0, log1: p.log1, n: F.length, open: !!p.open, cps: F.map((f) => f.cp) };
  };

  /* ------------------------------------------------------------------ prints */
  // stamp build: stamp log entries between two log indices (the log is append-only for these short takes)
  SC.stampsBetween = (i0, i1) => (TR().SL.list.slice(i0, i1)).map((e) => ({ x: e[0], z: e[1], dx: e[2], dz: e[3], len: e[4], wid: e[5], type: ['boot', 'paw', 'hoof', 'band', 'blob'][e[6]] || e[6], str: e[7] }));
  // contact build: blobs of the depression map (d_dyn > thr), 8-connected, inside an optional world box
  SC.blobs = (map, thr = 0.004, box = null, field = 'dd') => {
    const { res, ext, cx, cz } = map, A = map[field], tx = ext / res, seen = new Uint8Array(res * res), out = [];
    const x0 = cx - ext / 2, z0 = cz - ext / 2;
    let i0 = 0, i1 = res - 1, j0 = 0, j1 = res - 1;
    if (box) { i0 = Math.max(0, Math.floor((box[0] - x0) / tx)); i1 = Math.min(res - 1, Math.ceil((box[2] - x0) / tx)); j0 = Math.max(0, Math.floor((box[1] - z0) / tx)); j1 = Math.min(res - 1, Math.ceil((box[3] - z0) / tx)); }
    const st = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * res + i; if (seen[k] || !(A[k] > thr)) continue;
      let w = 0, sx = 0, sz = 0, n = 0, peak = 0, sxx = 0, szz = 0, sxz = 0; st.push(k); seen[k] = 1; const cells = [];
      while (st.length) { const q = st.pop(), qi = q % res, qj = (q / res) | 0, v = A[q], x = x0 + (qi + 0.5) * tx, z = z0 + (qj + 0.5) * tx;
        w += v; sx += v * x; sz += v * z; n++; if (v > peak) peak = v; cells.push([x, z, v]);
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = qi + a, jj = qj + b; if (ii < i0 || jj < j0 || ii > i1 || jj > j1) continue; const kk = jj * res + ii; if (!seen[kk] && A[kk] > thr) { seen[kk] = 1; st.push(kk); } } }
      const mx = sx / w, mz = sz / w; for (const [x, z, v] of cells) { sxx += v * (x - mx) ** 2; szz += v * (z - mz) ** 2; sxz += v * (x - mx) * (z - mz); }
      sxx /= w; szz /= w; sxz /= w; const tr = sxx + szz, det = sxx * szz - sxz * sxz, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
      // extents ≈ 2·√3·σ for a uniform box (a flat-bottomed print): length × width in m
      let hx = 0, hz = 0, hn = 0; for (const [x, z, v] of cells) if (v > peak * 0.5) { hx += x; hz += z; hn++; }
      out.push({ cellsXZ: cells.filter((q) => q[2] > peak * 0.5).map((q) => [q[0], q[1]]), x: hx / hn, z: hz / hn, wx: mx, wz: mz, peak, area: n * tx * tx, len: 2 * Math.sqrt(3 * Math.max(l1, 0)), wid: 2 * Math.sqrt(3 * Math.max(l2, 0)), cells: n });
    }
    return out;
  };
  // overlap of a print (list of xz cells) with the boot's contact footprint over its stance (contact verts per frame,
  // rasterized at texel size tx and dilated by `dil` texels): → { printUnderBoot, bootWithPrint } (0..1)
  SC.overlap = (printXZ, cps, tx, dil = 2) => {
    const key = (x, z) => Math.floor(x / tx) * 100003 + Math.floor(z / tx), foot = new Set();
    for (const fr of cps) for (const [x, z] of fr) for (let a = -dil; a <= dil; a++) for (let b = -dil; b <= dil; b++) foot.add(key(x + a * tx, z + b * tx));
    const pr = new Set(printXZ.map(([x, z]) => key(x, z)));
    let pin = 0; for (const k of pr) if (foot.has(k)) pin++;
    const core = new Set(); for (const fr of cps) for (const [x, z] of fr) core.add(key(x, z));
    let fin = 0; for (const k of core) { let hit = false; for (let a = -dil; a <= dil && !hit; a++) for (let b = -dil; b <= dil && !hit; b++) if (pr.has(k + a * 100003 + b)) hit = true; if (hit) fin++; }
    return { printUnderBoot: pr.size ? r3(pin / pr.size) : null, bootWithPrint: core.size ? r3(fin / core.size) : null };
  };
  // the old painted boot print (terrain.js stamp shape 'boot', len × wid, forward dx dz) as xz cells
  SC.stampCells = (q, tx) => { const out = [], rx = q.dz, rz = -q.dx, R = Math.max(q.len, q.wid);
    for (let i = -R; i <= R; i += tx) for (let j = -R; j <= R; j += tx) { const u = (i * rx + j * rz) / (q.wid * 0.5), v = (i * q.dx + j * q.dz) / (q.len * 0.5);
      const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const d = Math.hypot(u / (0.74 + 0.26 * sm(-1, 0.5, v)), v); if (d < 0.91) out.push([q.x + i, q.z + j]); }
    return out; };
  SC.readNear = async () => { const m = await TR().CM.readNear(); return m; };
  SC.diffMap = (a, b) => { const d = new Float32Array(a.dd.length); for (let k = 0; k < d.length; k++) d[k] = b.dd[k] - a.dd[k]; return Object.assign({}, b, { delta: d }); };

  /* ------------------------------------------------------------------ takes */
  const place = (x, z, yaw) => { QA.place(x, z, { yaw }); P.vx = P.vz = 0; };
  SC.walkTest = async (o = {}) => {
    const s = SC.openSnow(o.minD || 0.06, o.skip || 0); if (!s) return { error: 'no open snow' };
    const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA));   // forward = (sin dirA, cos dirA)
    place(s.x, s.z, yaw); D.cam.yaw = yaw; await QA.wait(1500);
    const mode = SC.mode(); let map0 = null; if (mode === 'contact') map0 = await SC.readNear();
    const log0 = mode === 'stamps' ? TR().SL.list.length : 0;
    QA.keys(['KeyW'], true); const recP = SC.recordPilot(o.ms || 3200); await QA.wait(o.walkMs || 2600); QA.keys(['KeyW'], false);
    const rec = await recP;
    await QA.wait(o.settleMs || 1600);
    // stand still: prints made while standing (must be none new)
    const logStand0 = mode === 'stamps' ? TR().SL.list.length : 0; let mapS = null; if (mode === 'contact') mapS = await SC.readNear();
    await QA.wait(o.standMs || 2500);
    const logStand1 = mode === 'stamps' ? TR().SL.list.length : 0; let mapE = null; if (mode === 'contact') mapE = await SC.readNear();
    const plants = rec.plants.map(summarize).filter((p) => p && p.n >= 2 && !p.open);
    const out = { mode, spot: [r3(s.x), r3(s.z)], looseDepth: r3(s.d), plants: plants.length, per: [] };
    if (mode === 'stamps') {
      const all = SC.stampsBetween(log0, TR().SL.list.length), boots = all.filter((q) => q.type === 'boot');
      out.stampsTotal = all.length; out.stampTypes = all.reduce((m, q) => (m[q.type] = (m[q.type] || 0) + 1, m), {});
      for (const p of plants) {
        const mine = SC.stampsBetween(p.log0, p.log1).filter((q) => q.type === 'boot');
        const near = boots.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.2);
        const first = mine[0] || near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        const ov = first ? SC.overlap(SC.stampCells(first, 0.0156), p.cps, 0.0156) : { printUnderBoot: null, bootWithPrint: null };
        out.per.push({ side: p.side, t: p.t, drift: p.drift, printsDuringStance: mine.length, printsWithin20cm: near.length, centreErrCm: first ? r3(Math.hypot(first.x - p.x, first.z - p.z) * 100) : null, stanceAvgErrCm: first ? r3(Math.hypot(first.x - p.vx, first.z - p.vz) * 100) : null, printUnderBoot: ov.printUnderBoot, bootWithPrint: ov.bootWithPrint });
      }
      out.standStill = { newPrints: logStand1 - logStand0 };
    } else {
      const box = [Math.min(s.x, P.x) - 2, Math.min(s.z, P.z) - 2, Math.max(s.x, P.x) + 2, Math.max(s.z, P.z) + 2];
      const inWin = (p) => Math.abs(p.x - mapS.cx) < mapS.ext / 2 - 0.5 && Math.abs(p.z - mapS.cz) < mapS.ext / 2 - 0.5;
      out.plantsLeftWindow = plants.filter((p) => !inWin(p)).length; plants.splice(0, plants.length, ...plants.filter(inWin));
      const bl = SC.blobs(mapS, o.thr || 0.004, box);
      out.blobs = bl.length; out.blobSizes = bl.map((b) => [r3(b.len), r3(b.wid), r3(b.peak)]);
      for (const p of plants) {
        const near = bl.filter((b) => Math.hypot(b.x - p.x, b.z - p.z) < 0.2), own = near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        const ov = own ? SC.overlap(own.cellsXZ, p.cps, mapS.ext / mapS.res) : { printUnderBoot: null, bootWithPrint: null };
        out.per.push({ side: p.side, t: p.t, drift: p.drift, printsWithin20cm: near.length, centreErrCm: own ? r3(Math.hypot(own.x - p.x, own.z - p.z) * 100) : null, bootCentreErrCm: own ? r3(Math.hypot(own.x - p.ax, own.z - p.az) * 100) : null, stanceAvgErrCm: own ? r3(Math.hypot(own.x - p.vx, own.z - p.vz) * 100) : null, printUnderBoot: ov.printUnderBoot, bootWithPrint: ov.bootWithPrint, printLenWid: own ? [r3(own.len), r3(own.wid)] : null, depthCm: own ? r3(own.peak * 100) : null });
      }
      // standing still: any texel that deepened by > 4 mm while standing, as blobs
      const dm = SC.diffMap(mapS, mapE); const nb = SC.blobs(Object.assign({}, dm, { dd: dm.delta }), 0.004, box);
      let dmax = 0; for (let k = 0; k < dm.delta.length; k++) if (dm.delta[k] > dmax) dmax = dm.delta[k];
      const sets2 = SC.soles('player'), ft = sets2.map((q) => SC.soleNow(q, 0.02)).filter(Boolean), away = nb.filter((b) => ft.every((f) => Math.hypot(b.x - f.cx, b.z - f.cz) > 0.25));
      out.standStill = { deepenedBlobs: nb.length, awayFromFeet: away.length, maxDeepenCm: r3(dmax * 100), sizes: nb.map((b) => [r3(b.len), r3(b.wid), r3(b.peak)]) };
    }
    { const sets = SC.soles('player'), feet = sets.map((q) => SC.soleNow(q, 0.02)).filter(Boolean); out.standing = [];
      for (const f of feet) {
        if (mode === 'stamps') { const L = TR().SL.list.map((e) => ({ x: e[0], z: e[1], t: e[6] })).filter((q) => q.t === 0); const n = L.sort((a, b) => Math.hypot(a.x - f.cx, a.z - f.cz) - Math.hypot(b.x - f.cx, b.z - f.cz))[0];
          out.standing.push({ errCm: n ? r3(Math.hypot(n.x - f.cx, n.z - f.cz) * 100) : null }); }
        else { const bl2 = SC.blobs(mapE, o.thr || 0.004, [f.cx - 0.4, f.cz - 0.4, f.cx + 0.4, f.cz + 0.4]); const n = bl2.sort((a, b) => Math.hypot(a.x - f.cx, a.z - f.cz) - Math.hypot(b.x - f.cx, b.z - f.cz))[0];
          const e = mapE.ext / mapE.res, dAt = (x, z) => mapE.d[Math.floor((z - (mapE.cz - mapE.ext / 2)) / e) * mapE.res + Math.floor((x - (mapE.cx - mapE.ext / 2)) / e)];
          const s0 = C.snowContact(f.cx, f.cz, true).s0;
          out.standing.push({ errCm: n ? r3(Math.hypot(n.x - f.cx, n.z - f.cz) * 100) : null, printDepthCm: r3(dAt(f.cx, f.cz) * 100), soleUnderS0Cm: r3((s0 - f.minY) * 100) }); } } }
    const errs = out.per.map((q) => q.centreErrCm).filter(Number.isFinite).sort((a, b) => a - b);
    const med = (k) => { const a = out.per.map((q) => q[k]).filter(Number.isFinite).sort((x, y) => x - y); return a.length ? { median: a[a.length >> 1], min: a[0] } : null; };
    out.printUnderBoot = med('printUnderBoot'); out.bootWithPrint = med('bootWithPrint');
    const errA = out.per.map((q) => q.stanceAvgErrCm).filter(Number.isFinite).sort((a, b) => a - b); out.stanceAvgErrCm = { median: errA.length ? errA[errA.length >> 1] : null, max: errA.length ? errA[errA.length - 1] : null };
    out.centreErrCm = { median: errs.length ? errs[errs.length >> 1] : null, max: errs.length ? errs[errs.length - 1] : null, n: errs.length };
    // PHYSBODY: the same print centre against the centre of the WHOLE boot bottom (all its vertices, plan view) at that frame.
    // centreErrCm compares with the centroid of the vertices within 2 cm of the lowest one — the heel at heel strike, the toe
    // cap at toe-off, the whole sole only if the sole is dead flat — so it reads the boot's tilt at the chosen frame as "slide"
    const errB = out.per.map((q) => q.bootCentreErrCm).filter(Number.isFinite).sort((a, b) => a - b);
    out.bootCentreErrCm = { median: errB.length ? errB[errB.length >> 1] : null, max: errB.length ? errB[errB.length - 1] : null, n: errB.length };
    const cnt = out.per.map((q) => q.printsWithin20cm); out.printsPerPlant = { min: Math.min(...cnt), max: Math.max(...cnt), exactlyOne: cnt.filter((c) => c === 1).length, of: cnt.length };
    if (mode === 'stamps') { const cs = out.per.map((q) => q.printsDuringStance); out.stampsPerStance = { min: Math.min(...cs), max: Math.max(...cs), mean: r3(cs.reduce((a, b) => a + b, 0) / Math.max(1, cs.length)) }; }
    return out;
  };
  // placed on fresh snow, standing (no walk): each boot's sole vs the print under it
  SC.standTest = async (o = {}) => {
    const s = SC.openSnow(o.minD || 0.08, (o.skip || 0) + 5); if (!s) return { error: 'no open snow' };
    QA.place(s.x, s.z, { yaw: 0.7 }); await QA.wait(o.settle || 2500);
    const mode = SC.mode(), sets = SC.soles('player'), feet = sets.map((q) => SC.soleNow(q, 0.02)).filter(Boolean), out = { mode, feet: [] };
    let map = null; if (mode === 'contact') map = await SC.readNear();
    for (const f of feet) {
      const cp = [f.pts.filter((q) => q[1] < f.minY + 0.02).map((q) => [q[0], q[2]])], s0 = C.snowContact ? C.snowContact(f.cx, f.cz, true).s0 : C.snowSurfaceAt(f.cx, f.cz);
      if (mode === 'stamps') { const L = TR().SL.list.map((e) => ({ x: e[0], z: e[1], dx: e[2], dz: e[3], len: e[4], wid: e[5], type: e[6] })).filter((q) => q.type === 0 && Math.hypot(q.x - f.cx, q.z - f.cz) < 0.5);
        const n = L.sort((a, b) => Math.hypot(a.x - f.cx, a.z - f.cz) - Math.hypot(b.x - f.cx, b.z - f.cz))[0];
        out.feet.push({ prints: L.length, errCm: n ? r3(Math.hypot(n.x - f.cx, n.z - f.cz) * 100) : null, soleUnderS0Cm: r3((s0 - f.minY) * 100), ...(n ? SC.overlap(SC.stampCells(n, 0.0156), cp, 0.0156) : {}) }); }
      else { const bl = SC.blobs(map, 0.004, [f.cx - 0.5, f.cz - 0.5, f.cx + 0.5, f.cz + 0.5]), n = bl.slice().sort((a, b) => Math.hypot(a.x - f.cx, a.z - f.cz) - Math.hypot(b.x - f.cx, b.z - f.cz))[0];
        const e = map.ext / map.res, dAt = (x, z) => map.d[Math.floor((z - (map.cz - map.ext / 2)) / e) * map.res + Math.floor((x - (map.cx - map.ext / 2)) / e)];
        out.feet.push({ prints: bl.filter((b) => Math.hypot(b.x - f.cx, b.z - f.cz) < 0.3).length, errCm: n ? r3(Math.hypot(n.x - f.cx, n.z - f.cz) * 100) : null, printDepthCm: r3(dAt(f.cx, f.cz) * 100), soleUnderS0Cm: r3((s0 - f.minY) * 100), lenWid: n ? [r3(n.len), r3(n.wid)] : null, ...(n ? SC.overlap(n.cellsXZ, cp, e) : {}) }); }
    }
    return out;
  };
  // jump in place (optionally while walking), land, measure what the landing pressed
  SC.landTest = async (o = {}) => {
    const s = SC.openSnow(o.minD || 0.06, (o.skip || 0) + 1); if (!s) return { error: 'no open snow' };
    const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); place(s.x, s.z, yaw); D.cam.yaw = yaw; await QA.wait(1500);
    const mode = SC.mode(); let m0 = null; if (mode === 'contact') m0 = await SC.readNear(); const log0 = mode === 'stamps' ? TR().SL.list.length : 0;
    if (o.walk) { QA.keys(['KeyW'], true); await QA.wait(700); }
    const recP = SC.recordPilot(2400); D.pressed.add('Space'); await QA.wait(o.walk ? 350 : 60); if (o.walk) QA.keys(['KeyW'], false);
    const rec = await recP; await QA.wait(300);
    const land = rec.events.find((e) => e.type === 'land'); if (!land) return { mode, error: 'no landing seen' };
    // soles right after the landing (first plants after it)
    const after = rec.plants.map(summarize).filter((p) => p && p.t >= land.t - 0.1 && p.t < land.t + 0.8);
    const out = { mode, landAt: [r3(land.x), r3(land.z)], feetAfterLanding: after.map((p) => ({ side: p.side, x: r3(p.x), z: r3(p.z) })) };
    if (mode === 'stamps') {
      const st = SC.stampsBetween(Math.max(log0, land.log - 2), TR().SL.list.length).filter((q) => Math.hypot(q.x - land.x, q.z - land.z) < 1.2);
      out.prints = st.map((q) => ({ type: q.type, lenWid: [r3(q.len), r3(q.wid)], offFromBodyCm: r3(Math.hypot(q.x - land.x, q.z - land.z) * 100), toNearestSoleCm: after.length ? r3(Math.min(...after.map((p) => Math.hypot(q.x - p.x, q.z - p.z))) * 100) : null }));
    } else {
      const m1 = await SC.readNear(), dm = SC.diffMap(m0, m1), box = [land.x - 1.5, land.z - 1.5, land.x + 1.5, land.z + 1.5];
      const bl = SC.blobs(Object.assign({}, dm, { dd: dm.delta }), 0.004, box);
      out.prints = bl.map((b) => ({ lenWid: [r3(b.len), r3(b.wid)], depthCm: r3(b.peak * 100), offFromBodyCm: r3(Math.hypot(b.x - land.x, b.z - land.z) * 100), toNearestSoleCm: after.length ? r3(Math.min(...after.map((p) => Math.hypot(b.x - p.x, b.z - p.z))) * 100) : null }));
    }
    out.count = out.prints.length; out.widest = out.prints.length ? Math.max(...out.prints.map((q) => q.lenWid[1])) : null; out.longest = out.prints.length ? Math.max(...out.prints.map((q) => q.lenWid[0])) : null;
    return out;
  };
  SC.rollTest = async (o = {}) => {
    const s = SC.openSnow(o.minD || 0.06, (o.skip || 0) + 2); if (!s) return { error: 'no open snow' };
    const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); place(s.x, s.z, yaw); D.cam.yaw = yaw; await QA.wait(1500);
    const mode = SC.mode(); let m0 = null; if (mode === 'contact') m0 = await SC.readNear(); const log0 = mode === 'stamps' ? TR().SL.list.length : 0;
    const x0 = P.x, z0 = P.z; QA.keys(['KeyW'], true); await QA.wait(500); D.pressed.add('KeyC'); await QA.wait(700); QA.keys(['KeyW'], false); await QA.wait(600);
    const out = { mode, from: [r3(x0), r3(z0)], to: [r3(P.x), r3(P.z)] };
    const box = [Math.min(x0, P.x) - 1.5, Math.min(z0, P.z) - 1.5, Math.max(x0, P.x) + 1.5, Math.max(z0, P.z) + 1.5];
    if (mode === 'stamps') { const st = SC.stampsBetween(log0, TR().SL.list.length); out.types = st.reduce((m, q) => (m[q.type] = (m[q.type] || 0) + 1, m), {}); out.bands = st.filter((q) => q.type === 'band').map((q) => [r3(q.len), r3(q.wid)]).slice(0, 12); }
    else { const m1 = await SC.readNear(), dm = SC.diffMap(m0, m1), bl = SC.blobs(Object.assign({}, dm, { dd: dm.delta }), 0.004, box); bl.sort((a, b) => b.area - a.area);
      out.blobs = bl.slice(0, 8).map((b) => ({ lenWid: [r3(b.len), r3(b.wid)], depthCm: r3(b.peak * 100), area: r3(b.area) })); }
    return out;
  };
  // stags / fox: bring the animal next to the pilot (inside the fine window), let it stand, measure hoof prints
  // gameplay camera (close third person, like the user played): after a walk / landing / roll, frame the trail
  SC.frame = (dist = 4.2, pitch = 0.32, yawOff = 0) => { D.camOv = null; D.cam.dist = dist; D.cam.boom = dist; D.cam.pitch = pitch; D.cam.yaw = P.face + yawOff; };
  SC.lookAt = (pos, look, fov = 50) => { D.camOv = { pos, look }; D.camera.fov = fov; D.camera.updateProjectionMatrix(); };
  SC.animalTest = async (kind = 'stag', o = {}) => {
    const out0 = {};
    const s = SC.openSnow(o.minD || 0.06, (o.skip || 0) + 3); if (!s) return { error: 'no open snow' };
    place(s.x, s.z, 0); await QA.wait(800);
    let g, id, anim = null;
    if (kind === 'stag') { const st = D.STAGS[0]; if (!st) return { error: 'no stag' };
      // stags flee from a pilot within 26 m: park the pilot 34 m away and point the fine contact window at the stag
      let px = s.x + 34, pz = s.z; for (let a = 0; a < 6.28; a += 0.5) { const x = s.x + Math.cos(a) * 34, z = s.z + Math.sin(a) * 34; if (land(x, z) && slope(x, z) < 25) { px = x; pz = z; break; } }
      QA.place(px, pz, { yaw: 0 }); for (const q of D.STAGS) { q.st = 'graze'; q.t = 60; } st.x = st.hx = s.x; st.z = st.hz = s.z; st.g.position.set(st.x, gh(st.x, st.z), st.z);
      TR().CM.focus = { x: s.x, z: s.z }; g = st; id = 'stag0'; }
    else { const f = D.fox; f.st = 'wild'; f.x = s.x + 1.8; f.z = s.z + 1.2; f.yaw = Math.atan2(f.x - P.x, f.z - P.z) + Math.PI; f.g.position.set(f.x, gh(f.x, f.z), f.z); g = f; id = 'fox'; }
    await QA.wait(o.settle || 2500);
    const mode = SC.mode(); soleCache = null; if (kind === 'stag') out0.stagState = g.st; const sets = SC.soles(id), feet = sets.map((q) => SC.soleNow(q, 0.012)).filter(Boolean);
    const out = Object.assign(out0, { mode, kind, at: [r3(g.x), r3(g.z)], feet: feet.length });
    if (mode === 'stamps') {
      const L = TR().SL.list, recent = L.slice(-80).map((e) => ({ x: e[0], z: e[1], type: ['boot', 'paw', 'hoof', 'band', 'blob'][e[6]], len: e[4], wid: e[5] })).filter((q) => Math.hypot(q.x - g.x, q.z - g.z) < 2);
      out.stamps = recent.reduce((m, q) => (m[q.type] = (m[q.type] || 0) + 1, m), {}); out.stampSizes = [...new Set(recent.map((q) => q.type + ' ' + r3(q.len) + '×' + r3(q.wid)))];
      out.per = feet.map((f) => { const h = recent.filter((q) => q.type === 'hoof' || q.type === 'paw'); const n = h.sort((a, b) => Math.hypot(a.x - f.cx, a.z - f.cz) - Math.hypot(b.x - f.cx, b.z - f.cz))[0]; return { errCm: n ? r3(Math.hypot(n.x - f.cx, n.z - f.cz) * 100) : null }; });
    } else {
      const m = await SC.readNear(), bl = SC.blobs(m, 0.003, [g.x - 1.5, g.z - 1.5, g.x + 1.5, g.z + 1.5]), e = m.ext / m.res;
      const dAt = (x, z) => m.d[Math.floor((z - (m.cz - m.ext / 2)) / e) * m.res + Math.floor((x - (m.cx - m.ext / 2)) / e)];
      out.blobs = bl.map((b) => [r3(b.len), r3(b.wid), r3(b.peak * 100)]);
      out.per = feet.map((f) => { const n = bl.slice().sort((a, b) => Math.hypot(a.x - f.cx, a.z - f.cz) - Math.hypot(b.x - f.cx, b.z - f.cz))[0]; const q = C.snowContact(f.cx, f.cz, true);
        return { errCm: n ? r3(Math.hypot(n.x - f.cx, n.z - f.cz) * 100) : null, footUnderS0Cm: r3((q.s0 - f.minY) * 100), printDepthUnderFootCm: r3(dAt(f.cx, f.cz) * 100), looseCm: r3(q.dep * 100) }; });
      TR().CM.focus = null;
    }
    return out;
  };
})();
