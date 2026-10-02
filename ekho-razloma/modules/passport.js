/* modules/passport.js — Passport: the registry of every solid thing in the world (the shared "object passport" domain).
 * Classic script, loaded before the page: window.createPassport(deps) → the Passport object (same API as before the move).
 * One entry per collider-bearing object: id, role (solid | trunk | passable | pushable | trigger), name, exact world-space
 * geometry, physics colliders and the 2D fallback circles. Colliders come from the drawn geometry, never hand-typed.
 * deps (open-world.html builds them): THREE, V3, scene, PH (physics handle), COLS + addCircle (2D circle grid), groundH,
 * and `player` (a getter: the pilot object exists only after this registry is created). */
(function () {
  'use strict';
  window.createPassport = function (D) {
  const { THREE, V3, scene, PH, COLS, addCircle, groundH } = D;
  const ROLES = ['solid', 'trunk', 'passable', 'pushable', 'trigger'];
  const list = [], byRole = {}; ROLES.forEach((r) => (byRole[r] = []));
  const HEAD = 2.0;                               // fallback circles only block below this height over the ground
  const passGrid = new Map(), PG = 16, providers = [];
  const stats = { tris: 0, buildMs: 0, physMs: 0 };
  let seq = 0, phys = null;
  const fpQueue = [];
  function doFootprint(e) {
    if (!e.alive || !e.geo) return;
    const t0 = performance.now(), g = e.geo;
    const circles = e.shape === 'hull' ? convexFootprint(g) : footprint(g);
    for (const [x, z, r] of circles) { const c = addCircle(x, z, r, e); if (e.role === 'pushable' && e.debris) c.off = true; e.circles.push(c); }
    stats.footprintMs = (stats.footprintMs || 0) + performance.now() - t0;
  }
  function idle(budgetMs) { stream(); const t0 = performance.now(); while (fpQueue.length && performance.now() - t0 < budgetMs) doFootprint(fpQueue.shift()); return fpQueue.length; }
  // ---- exact shape near the pilot (REALISM-QA.md, PLAN-REALISM §9): a static 'solid' registered as a convex hull
  // ({shape:'hull'}: scanned rocks, crystals) blocks the pilot in the air in front of every hollow. Within EXACT.near m
  // of the pilot it gets the exact trimesh of its drawn triangles (Rapier FIX_INTERNAL_EDGES: no seam bumps); beyond
  // EXACT.far it goes back to the hull. All-trimesh for the ~580 hull entries = 1.5 M triangles, +1.2 s build on M1,
  // ~+290 MB — too much for the Intel Air; near-only is ~20–40 entries. Opt out per entry: opts.exact = false.
  // ?colhull in the URL = old behaviour (A/B in tools/qa/realism.mjs).
  // REALISM-QA 2: one exact build of a 4.5 k-triangle scan cost up to 16.7 ms at CPU ×4 (a dropped frame on the Air). The
  // trimesh is now built in chunks of ≤ EXACT.chunk triangles (split along the entry's long axis), a few per frame within
  // EXACT.budget ms; the hull stays until the last chunk is in, then the chunks replace it in one step (never a frame
  // without a collider). Only entries within EXACT.hard m of the pilot (teleport next to a rock) are built at once.
  const EXACT = { on: !/[?&]colhull\b/.test(location.search), near: 45, far: 70, hard: 3, chunk: 1200, budget: 1.5, n: 0, builds: 0, chunks: 0, ms: 0, maxMs: 0, frameMax: 0, list: [] };
  // quality knob (QUALITY presets' exactBudget/exactNear/exactFar/exactHard, air/low): a weaker profile keeps the same
  // exact-near-the-pilot behaviour but with a smaller radius and a lower per-frame ms budget — undefined fields keep
  // the defaults above (never touched on med/high/ultra).
  function tuneExact(o = {}) {
    if (o.budget != null) EXACT.budget = o.budget;
    if (o.near != null) EXACT.near = o.near;
    if (o.far != null) EXACT.far = o.far;
    if (o.hard != null) EXACT.hard = o.hard;
  }
  const exactable = (e) => e.role === 'solid' && e.shape === 'hull' && e.opts.exact !== false && !!e.geo;
  const exTag = (e, on) => ({ kind: e.role, name: e.name, passport: e.id, exact: on });
  // triangles sorted by centroid along the longest box axis → consecutive runs of ≤ chunk triangles, each its own index
  // space (a chunk is a small patch of the surface: Rapier's internal-edge fix works inside it; the seams are rare)
  function exactChunks(e) {
    if (e._exP) return e._exP;
    const g = e.geo, nt = g.i.length / 3, K = Math.ceil(nt / EXACT.chunk);
    if (K <= 1) return (e._exP = [{ v: g.v, i: g.i }]);
    const b = e.box, ax = [0, 1, 2].sort((p, q) => (b.max[q] - b.min[q]) - (b.max[p] - b.min[p]))[0], key = new Float32Array(nt), ord = new Uint32Array(nt);
    for (let t = 0; t < nt; t++) { ord[t] = t; key[t] = g.v[g.i[t * 3] * 3 + ax] + g.v[g.i[t * 3 + 1] * 3 + ax] + g.v[g.i[t * 3 + 2] * 3 + ax]; }
    ord.sort((p, q) => key[p] - key[q]);
    const out = [], per = Math.ceil(nt / K);
    for (let k = 0; k < K; k++) {
      const map = new Map(), v = [], ix = new Uint32Array(Math.min(per, nt - k * per) * 3); let o = 0;
      for (let q = k * per; q < Math.min(nt, (k + 1) * per); q++) for (let c = 0; c < 3; c++) {
        const s = g.i[ord[q] * 3 + c]; let d = map.get(s); if (d === undefined) { d = v.length / 3; map.set(s, d); v.push(g.v[s * 3], g.v[s * 3 + 1], g.v[s * 3 + 2]); } ix[o++] = d; }
      out.push({ v: new Float32Array(v), i: ix });
    }
    return (e._exP = out);
  }
  // build the next chunk of e's exact shape; true once e is exact (the hull removed, the chunks are its colliders)
  function stepExact(e) {
    const P = exactChunks(e), done = e._exDone || (e._exDone = []), c = P[done.length];
    done.push(phys.addStaticTrimesh(c.v, c.i, exTag(e, true), { friction: e.opts.friction })); EXACT.chunks++;
    if (done.length < P.length) return false;
    for (const q of e.colliders) try { phys.removeCollider(q); } catch (err) { /* gone */ }
    e.colliders.length = 0; e.colliders.push(...done); e._exDone = null; e.exact = true; EXACT.n++; EXACT.builds++;
    return true;
  }
  function dropPartial(e) { if (e._exDone) for (const q of e._exDone) try { phys.removeCollider(q); } catch (err) { /* gone */ } e._exDone = null; }
  function setExact(e, on) {
    const t0 = performance.now();
    if (on) { if (!e.exact) while (!stepExact(e)) { /* all chunks now */ } }
    else {
      dropPartial(e); for (const c of e.colliders) try { phys.removeCollider(c); } catch (err) { /* gone */ }
      e.colliders.length = 0; if (e.exact) EXACT.n--; e.exact = false; e._exP = null;
      const c = phys.addStaticConvex(e.geo.v, exTag(e, false)); if (c) e.colliders.push(c);
    }
    const ms = performance.now() - t0; EXACT.ms += ms; EXACT.maxMs = Math.max(EXACT.maxMs, ms);
  }
  // every frame (from idle): entries within EXACT.hard m at once; else chunks of the nearest pending entries while the
  // frame's EXACT.budget lasts (at least one chunk per frame); beyond EXACT.far back to the hull
  function stream() {
    if (!phys || !EXACT.on || !D.player) return;
    const px = D.player.x, pz = D.player.z, up = [];
    for (const e of EXACT.list) {
      if (!e.alive) continue;
      const b = e.box, dx = Math.max(b.min[0] - px, 0, px - b.max[0]), dz = Math.max(b.min[2] - pz, 0, pz - b.max[2]), d = Math.hypot(dx, dz);
      if (!e.exact && d < EXACT.near) up.push([d, e]);
      else if ((e.exact || e._exDone) && d > EXACT.far) { try { setExact(e, false); } catch (err) { /* keep */ } }
    }
    if (!up.length) return;
    up.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now(), fail = (e, err) => { console.warn('[Passport] exact', e.name, err && err.message); dropPartial(e); e.opts.exact = false; };
    for (let k = 0; k < up.length; k++) {
      const [d, e] = up[k];
      try {
        if (d <= EXACT.hard) { setExact(e, true); continue; }
        while (!e.exact && (performance.now() - t0 < EXACT.budget || k === 0 && !e._exDone)) if (stepExact(e)) break;
      } catch (err) { fail(e, err); }
      if (performance.now() - t0 >= EXACT.budget) break;
    }
    const ms = performance.now() - t0; EXACT.ms += ms; EXACT.frameMax = Math.max(EXACT.frameMax, ms); EXACT.maxMs = Math.max(EXACT.maxMs, ms);
  }
  function flush() { while (fpQueue.length) doFootprint(fpQueue.shift()); }
  const _v = new V3(), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();

  // ---- geometry extraction (world space, indexed) ----
  function pushGeo(out, geo, matrix) {
    const P = geo.attributes.position; if (!P) return;
    const base = out.vn, n = P.count;
    for (let i = 0; i < n; i++) { _v.fromBufferAttribute(P, i).applyMatrix4(matrix); out.v.push(_v.x, _v.y, _v.z); }
    const I = geo.index;
    if (I) for (let i = 0; i < I.count; i++) out.i.push(base + I.getX(i));
    else for (let i = 0; i < n; i++) out.i.push(base + i);
    out.vn += n;
  }
  const drawable = (o, opts) => (o.isMesh && !o.isSprite && o.material && !(o.material.transparent && o.material.depthWrite === false) && !o.userData.noCollide &&
    (!opts.part || opts.part.test((o.material && o.material.name) || '') || opts.part.test(o.name || '')));
  function collect(root, opts, instanceMatrix) {
    const out = { v: [], i: [], vn: 0 };
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!drawable(o, opts) || (o.isInstancedMesh && !instanceMatrix)) return;
      if (opts.visibleOnly !== false) { for (let p = o; p; p = p.parent) if (!p.visible && !opts.includeHidden) return; }
      _m.copy(o.matrixWorld); if (instanceMatrix) _m.multiply(instanceMatrix);
      pushGeo(out, o.geometry, _m);
    });
    return out;
  }
  // vertex clustering: bounded error (cell/2 per axis), used for heavy props when opts.cell is given
  function simplify(g, cell) {
    const map = new Map(), v = [], remap = new Int32Array(g.vn);
    for (let k = 0; k < g.vn; k++) {
      const x = g.v[k * 3], y = g.v[k * 3 + 1], z = g.v[k * 3 + 2], key = Math.round(x / cell) + ',' + Math.round(y / cell) + ',' + Math.round(z / cell);
      let id = map.get(key); if (id === undefined) { id = v.length / 3; map.set(key, id); v.push(x, y, z); } remap[k] = id;
    }
    const idx = [], seen = new Set();
    for (let t = 0; t + 2 < g.i.length; t += 3) {
      const a = remap[g.i[t]], b = remap[g.i[t + 1]], c = remap[g.i[t + 2]];
      if (a === b || b === c || a === c) continue;
      const s = [a, b, c].sort((p, q) => p - q).join(); if (seen.has(s)) continue; seen.add(s); idx.push(a, b, c);
    }
    return { v, i: idx, vn: v.length / 3 };
  }
  // ---- 2D footprint: convex hull of the parts below head height, covered by a few circles along its long axis ----
  function hull2(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  // footprint = parts of the drawn mesh below head height, rasterised on a 0.5 m grid (triangle edges sampled densely,
  // so thin long parts like a wing root stay thin), split into connected pieces; each piece's convex hull is covered by
  // a few circles along its long axis. Wing tips resting in the snow and the fuselage become separate circle chains.
  function coverHull(H, out) {
    let cx = 0, cz = 0; for (const p of H) { cx += p[0]; cz += p[1]; } cx /= H.length; cz /= H.length;
    let sxx = 0, sxz = 0, szz = 0; for (const p of H) { const dx = p[0] - cx, dz = p[1] - cz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = Math.cos(ang), az = Math.sin(ang);
    const bnd = [];
    for (let k = 0; k < H.length; k++) { const a = H[k], b = H[(k + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.25));
      for (let q = 0; q < n; q++) bnd.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]); }
    let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
    for (const p of bnd) { const u = (p[0] - cx) * ax + (p[1] - cz) * az, w = -(p[0] - cx) * az + (p[1] - cz) * ax; u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    const len = u1 - u0, wid = Math.max(0.2, w1 - w0), n = Math.max(1, Math.min(24, Math.round(len / wid)));
    for (let q = 0; q < n; q++) {
      const a = u0 + len * q / n, b = u0 + len * (q + 1) / n, sl = bnd.filter((p) => { const u = (p[0] - cx) * ax + (p[1] - cz) * az; return u >= a - 0.13 && u <= b + 0.13; });
      if (!sl.length) continue;
      let m0 = 1e9, m1 = -1e9; for (const p of sl) { const w = -(p[0] - cx) * az + (p[1] - cz) * ax; m0 = Math.min(m0, w); m1 = Math.max(m1, w); }
      const um = (a + b) / 2, wm = (m0 + m1) / 2, x = cx + ax * um - az * wm, z = cz + az * um + ax * wm;
      let r = 0; for (const p of sl) r = Math.max(r, Math.hypot(p[0] - x, p[1] - z));
      out.push([x, z, Math.max(0.05, r)]);
    }
  }
  // a piece whose hull is mostly empty (a plane's planform: fuselage + wings + tail) is split along its long axis
  // until each part fills its hull, so the circles never bridge the empty space between wing and tail
  function coverPiece(piece, out, depth) {
    if (piece.length < 3) { if (piece.length) out.push([piece[0][0], piece[0][1], 0.15]); return; }
    const H = hull2(piece.slice()); if (H.length < 3) { let cx = 0, cz = 0; for (const p of piece) { cx += p[0]; cz += p[1]; } out.push([cx / piece.length, cz / piece.length, 0.2]); return; }
    let area = 0; for (let k = 0; k < H.length; k++) { const a = H[k], b = H[(k + 1) % H.length]; area += a[0] * b[1] - b[0] * a[1]; } area = Math.abs(area) / 2;
    const occ = new Set(); for (const p of piece) occ.add(Math.floor(p[0] / 0.5) + ',' + Math.floor(p[1] / 0.5));
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of piece) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const ext = Math.max(x1 - x0, z1 - z0), fill = occ.size * 0.25 / Math.max(area, 0.25);
    if (fill >= 0.55 || ext < 1.6 || depth > 10) { coverHull(H, out); return; }
    const alongX = x1 - x0 >= z1 - z0, vals = piece.map((p) => (alongX ? p[0] : p[1])).sort((a, b) => a - b), mid = vals[vals.length >> 1];
    coverPiece(piece.filter((p) => (alongX ? p[0] : p[1]) < mid), out, depth + 1);
    coverPiece(piece.filter((p) => (alongX ? p[0] : p[1]) >= mid), out, depth + 1);
  }
  // convex shapes (hull colliders): the hull of the low vertices is already the exact footprint
  function convexFootprint(g) {
    const V = g.v, pts = [];
    for (let k = 0; k < g.vn; k++) { const h = V[k * 3 + 1] - groundH(V[k * 3], V[k * 3 + 2]); if (h < HEAD && h > -1.5) pts.push([V[k * 3], V[k * 3 + 2]]); }
    if (pts.length < 3) return [];
    const H = hull2(pts), out = []; if (H.length >= 3) coverHull(H, out); return out;
  }
  function footprint(g) {
    const V = g.v, pts = [], GS = 0.5;
    const hOf = (k) => V[k * 3 + 1] - groundH(V[k * 3], V[k * 3 + 2]);
    const hk = new Float32Array(g.vn); for (let k = 0; k < g.vn; k++) hk[k] = hOf(k);
    const low = (h) => h < HEAD && h > -1.5;
    for (let k = 0; k < g.vn; k++) if (low(hk[k])) pts.push([V[k * 3], V[k * 3 + 2]]);
    for (let t = 0; t + 2 < g.i.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = g.i[t + e], b = g.i[t + (e + 1) % 3], la = low(hk[a]), lb = low(hk[b]);
      if (!la && !lb) continue;
      let s0 = 0, s1 = 1;
      if (la !== lb) { const ya = hk[a] - HEAD, yb = hk[b] - HEAD, s = ya / (ya - yb); if (!(s > 0 && s < 1)) continue; if (la) s1 = s; else s0 = s; }
      const L = Math.hypot(V[b * 3] - V[a * 3], V[b * 3 + 2] - V[a * 3 + 2]) * (s1 - s0), n = Math.min(60, Math.ceil(L / (GS * 0.5)));
      for (let q = 0; q <= n; q++) { const s = s0 + (s1 - s0) * q / Math.max(1, n); pts.push([V[a * 3] + (V[b * 3] - V[a * 3]) * s, V[a * 3 + 2] + (V[b * 3 + 2] - V[a * 3 + 2]) * s]); }
    }
    for (let t = 0; t + 2 < g.i.length; t += 3) {   // interiors of triangles lying entirely below head height
      const a = g.i[t], b = g.i[t + 1], c = g.i[t + 2]; if (!low(hk[a]) || !low(hk[b]) || !low(hk[c])) continue;
      const ax = V[a * 3], az = V[a * 3 + 2], ux = V[b * 3] - ax, uz = V[b * 3 + 2] - az, vx = V[c * 3] - ax, vz = V[c * 3 + 2] - az;
      const area = Math.abs(ux * vz - uz * vx) / 2; if (area < 1) continue;   // small triangles: their sampled edges already cover them
      const n = Math.min(20, Math.floor(Math.sqrt(area) / GS));
      for (let p = 1; p < n; p++) for (let q = 1; p + q < n; q++) pts.push([ax + (ux * p + vx * q) / n, az + (uz * p + vz * q) / n]);
    }
    if (pts.length < 3) return [];
    { const u = new Map(); for (const p of pts) u.set(Math.round(p[0] * 8) + ',' + Math.round(p[1] * 8), p); pts.length = 0; for (const p of u.values()) pts.push(p); }   // 12.5 cm dedupe
    // connected pieces on the grid
    const cell = new Map(), key = (i, j) => i + ',' + j;
    for (const p of pts) { const i = Math.floor(p[0] / GS), j = Math.floor(p[1] / GS), k = key(i, j); let c = cell.get(k); if (!c) cell.set(k, c = { i, j, p: [] }); c.p.push(p); }
    const seen = new Set(), out = [];
    for (const [k0] of cell) {
      if (seen.has(k0)) continue;
      const piece = [], stack = [k0]; seen.add(k0);
      while (stack.length) {
        const c = cell.get(stack.pop()); for (const q of c.p) piece.push(q);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const n = key(c.i + di, c.j + dj); if (!seen.has(n) && cell.has(n)) { seen.add(n); stack.push(n); } }
      }
      coverPiece(piece, out, 0);
    }
    return out;
  }
  // ---- trunk fit: the lowest ring of the trunk part (where the trunk meets the ground) gives axis + radius ----
  // Branches/roots can share the trunk's material, so the fit only trusts a ring-shaped vertex set at the very base;
  // if the base is not ring-shaped it falls back to the densest (inner) quarter of the low band.
  function fitTrunk(g, opts) {
    let y0 = 1e9, y1 = -1e9; for (let k = 0; k < g.vn; k++) { y0 = Math.min(y0, g.v[k * 3 + 1]); y1 = Math.max(y1, g.v[k * 3 + 1]); }
    const H = y1 - y0, ring = (lo, hi) => { const o = []; for (let k = 0; k < g.vn; k++) { const y = g.v[k * 3 + 1] - y0; if (y >= lo && y <= hi) o.push([g.v[k * 3], g.v[k * 3 + 2]]); } return o; };
    let cx = 0, cz = 0, r = 0;
    const tryRing = (pts) => {
      if (pts.length < 5) return false;
      let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= pts.length; mz /= pts.length;
      const ds = pts.map((p) => Math.hypot(p[0] - mx, p[1] - mz)), mean = ds.reduce((a, b) => a + b, 0) / ds.length;
      const cv = Math.sqrt(ds.reduce((a, d) => a + (d - mean) ** 2, 0) / ds.length) / (mean || 1);
      if (cv > 0.3) return false;
      cx = mx; cz = mz; r = Math.max(...ds); return true;
    };
    if (!tryRing(ring(0, Math.min(0.06, H * 0.02) + 0.02)) && !tryRing(ring(0, 0.15))) {
      const band = ring(0, Math.max(0.3, Math.min(2, H * 0.3))); const pts = band.length ? band : ring(0, H);
      const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
      cx = med(pts.map((p) => p[0])); cz = med(pts.map((p) => p[1]));
      const ds = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz)).sort((a, b) => a - b); r = ds[Math.floor(ds.length * 0.25)] || 0.1;
    }
    r = opts.radius || Math.max(0.02, r);
    const top = opts.height ? y0 + opts.height : y0 + H * (opts.topFrac || 0.9);
    return { x: cx, z: cz, r, y0: y0 - 0.6, y1: top };
  }
  function bounds(g) { const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; for (let k = 0; k < g.vn; k++) for (let a = 0; a < 3; a++) { const v = g.v[k * 3 + a]; if (v < b.min[a]) b.min[a] = v; if (v > b.max[a]) b.max[a] = v; } return b; }

  // ---- entries ----
  function make(g, role, opts, obj) {
    const e = { id: ++seq, role, name: opts.name || (obj && obj.name) || role, shape: opts.shape || (role === 'trunk' ? 'cylinder' : role === 'solid' ? 'mesh' : 'none'),
      opts, obj: obj || null, colliders: [], circles: [], geo: null, trunk: null, box: null, alive: true };
    if (role === 'solid' || role === 'pushable') {
      if (opts.cell) g = simplify(g, opts.cell);
      e.geo = { v: new Float32Array(g.v), i: new Uint32Array(g.i), vn: g.vn }; e.box = bounds(g); stats.tris += g.i.length / 3;
      fpQueue.push(e);   // 2D footprint circles: computed in idle time (Passport.idle), all done before play if physics is missing
      if (exactable(e)) EXACT.list.push(e);   // hull far away, exact trimesh near the pilot (stream)
    } else if (role === 'trunk') {
      e.trunk = fitTrunk(g, opts); e.box = { min: [e.trunk.x - e.trunk.r, e.trunk.y0, e.trunk.z - e.trunk.r], max: [e.trunk.x + e.trunk.r, e.trunk.y1, e.trunk.z + e.trunk.r] };
      e.circles.push(addCircle(e.trunk.x, e.trunk.z, e.trunk.r, e));
    } else if (role === 'passable') {
      const b = bounds(g); e.box = b; const x = (b.min[0] + b.max[0]) / 2, z = (b.min[2] + b.max[2]) / 2;
      e.pass = { x, z, r: Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2, h: b.max[1] - b.min[1] };
      const k = Math.floor(x / PG) * 65536 + Math.floor(z / PG); if (!passGrid.has(k)) passGrid.set(k, []); passGrid.get(k).push(e.pass);
    } else if (role === 'trigger') {
      const b = bounds(g); e.box = b; e.trigger = { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2, r: opts.radius || Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 };
    }
    list.push(e); byRole[role].push(e);
    if (phys) toPhys(e);
    return e;
  }
  function toPhys(e) {
    if (!phys || !e.alive || e.colliders.length) return;
    const tagv = { kind: e.role, name: e.name, passport: e.id };
    try {
      if (e.role === 'solid') {
        if (e.shape === 'hull') { const c = phys.addStaticConvex(e.geo.v, tagv); if (c) e.colliders.push(c); e.exact = false; }   // stream() swaps in the trimesh near the pilot
        else e.colliders.push(phys.addStaticTrimesh(e.geo.v, e.geo.i, tagv, { friction: e.opts.friction }));
      } else if (e.role === 'trunk') {
        const t = e.trunk; e.colliders.push(phys.addStaticCylinder(t.x, t.z, t.r, t.y0, t.y1 - t.y0, tagv, phys.groups.TRUNK));
      } else if (e.role === 'pushable' && e.obj && e.obj.isMesh) {
        e.debris = phys.spawnDebris(e.obj, { shape: 'convex', mass: e.opts.mass || 15, prop: true, userData: tagv });
        for (const c of e.circles) c.off = true;    // it moves now: the static fallback circles would lie
      }
    } catch (err) { console.warn('[Passport] collider failed', e.name, err && err.message); }
  }

  function register(src, role, opts = {}) {
    if (!byRole[role]) throw new Error('Passport: unknown role ' + role);
    const t0 = performance.now(), out = [];
    if (src && src.isInstancedMesh && role !== 'pushable') {
      const n = opts.count !== undefined ? opts.count : src.count, mats = [];
      src.updateWorldMatrix(true, false);
      for (let k = 0; k < n; k++) { const M = new THREE.Matrix4(); src.getMatrixAt(k, M); mats.push(M.premultiply(src.matrixWorld)); }
      stats.buildMs += performance.now() - t0;
      return registerInstances(src.geometry, mats, role, Object.assign({ name: src.name || 'inst' }, opts));
    } else if (src && (src.isObject3D)) {
      const g = collect(src, opts, null);
      if (g.vn) out.push(make(g, role, opts, src));
    } else if (src && src.geometry) {
      const g = { v: [], i: [], vn: 0 }; pushGeo(g, src.geometry, src.matrix || _mi.identity());
      out.push(make(g, role, opts, null));
    } else if (src && src.point) {            // single anchor (trunk from explicit, model-derived radius/height)
      out.push(make({ v: src.point.slice(0, 3), i: [], vn: 1 }, role, opts, null));
    } else if (src && src.positions) {        // non-indexed triangle soup in world space
      const P = src.positions, g = { v: Array.from(P), i: [], vn: P.length / 3 }; for (let k = 0; k < g.vn; k++) g.i.push(k);
      if (src.indices) g.i = Array.from(src.indices);
      out.push(make(g, role, opts, null));
    }
    stats.buildMs += performance.now() - t0;
    return out.length === 1 ? out[0] : out;
  }
  // many instances of one model: fit the local shape once (trunks), then place per instance matrix
  function registerInstances(geoOrRoot, matrices, role, opts = {}) {
    const t0 = performance.now(), out = [];
    const local = geoOrRoot.isObject3D ? collect(geoOrRoot, opts, null) : (() => { const g = { v: [], i: [], vn: 0 }; pushGeo(g, geoOrRoot, _mi.identity()); return g; })();
    let lt = null; if (role === 'trunk') lt = fitTrunk(local, opts);
    for (let k = 0; k < matrices.length; k++) {
      const M = matrices[k];
      if (lt) {
        const e = M.elements, sx = Math.hypot(e[0], e[1], e[2]), sz = Math.hypot(e[8], e[9], e[10]), sy = Math.hypot(e[4], e[5], e[6]);
        _v.set(lt.x, lt.y0 + 0.6, lt.z).applyMatrix4(M);
        const g = { v: [_v.x, _v.y, _v.z], i: [], vn: 1 };
        out.push(make(g, role, Object.assign({}, opts, { name: (opts.name || 'inst') + '#' + k, radius: lt.r * Math.sqrt(sx * sz), height: (lt.y1 - lt.y0 - 0.6) * sy }), null));
        continue;
      }
      const g = { v: new Array(local.vn * 3), i: local.i, vn: local.vn };
      for (let q = 0; q < local.vn; q++) { _v.set(local.v[q * 3], local.v[q * 3 + 1], local.v[q * 3 + 2]).applyMatrix4(M); g.v[q * 3] = _v.x; g.v[q * 3 + 1] = _v.y; g.v[q * 3 + 2] = _v.z; }
      out.push(make(g, role, Object.assign({}, opts, { name: (opts.name || 'inst') + '#' + k }), null));
    }
    stats.buildMs += performance.now() - t0;
    return out;
  }
  function remove(e) {
    if (!e || !e.alive) return; e.alive = false;
    for (const c of e.colliders) try { phys && phys.removeCollider(c); } catch (err) { /* already gone */ }
    if (e.debris && phys) phys.removeDebris(e.debris);
    e.colliders.length = 0; for (const c of e.circles) c.off = true;
    const i = list.indexOf(e); if (i >= 0) list.splice(i, 1); const j = byRole[e.role].indexOf(e); if (j >= 0) byRole[e.role].splice(j, 1);
    if (e._exDone) dropPartial(e);
    const x = EXACT.list.indexOf(e); if (x >= 0) { EXACT.list.splice(x, 1); if (e.exact) EXACT.n--; }
  }
  function attach(P) { phys = P; const t0 = performance.now(); for (const e of list) toPhys(e); stats.physMs = performance.now() - t0; }
  function passablesNear(x, z, r, out = []) {
    for (let i = Math.floor((x - r) / PG); i <= Math.floor((x + r) / PG); i++) for (let j = Math.floor((z - r) / PG); j <= Math.floor((z + r) / PG); j++) {
      const a = passGrid.get(i * 65536 + j); if (a) for (const p of a) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (r + p.r) ** 2) out.push(p); }
    for (const fn of providers) fn(x, z, r, out);
    return out;
  }
  function triggersAt(x, y, z) { return byRole.trigger.filter((e) => (e.trigger.x - x) ** 2 + (e.trigger.y - y) ** 2 + (e.trigger.z - z) ** 2 < e.trigger.r ** 2); }
  function counts() { const c = {}; for (const r of ROLES) c[r] = byRole[r].length; c.colliders = list.reduce((a, e) => a + e.colliders.length, 0); c.circles = COLS.filter((q) => !q.off).length; c.tris = Math.round(stats.tris); return c; }

  // ---- debug overlay (key K): wire of every collider near the camera, colored by role ----
  const ROLE_COL = { solid: 0xff9a3c, trunk: 0x5cf5c0, pushable: 0x7fe3ff, passable: 0x8a9cc0, trigger: 0xc49bff, circle: 0xffe066 };
  let dbg = null;
  function debug(on, center, R = 160) {
    if (dbg) { scene.remove(dbg.group); dbg.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); dbg = null; }
    if (!on) return null;
    const group = new THREE.Group(), segs = {}; let n = 0;
    const seg = (role) => segs[role] || (segs[role] = []);
    const near = (e) => { const b = e.box; if (!b) return false; const x = Math.max(b.min[0], Math.min(center.x, b.max[0])), z = Math.max(b.min[2], Math.min(center.z, b.max[2])); return Math.hypot(x - center.x, z - center.z) < R; };
    for (const e of list) {
      if (!near(e)) continue; n++;
      const s = seg(e.role);
      if (e.geo && e.role !== 'pushable') { const V = e.geo.v, I = e.geo.i; for (let t = 0; t + 2 < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k] * 3, b = I[t + (k + 1) % 3] * 3; s.push(V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2]); } }
      else if (e.trunk) { const t = e.trunk; for (let k = 0; k < 12; k++) { const a0 = k / 12 * 6.283, a1 = (k + 1) / 12 * 6.283; for (const y of [t.y0 + 0.6, t.y1]) s.push(t.x + Math.cos(a0) * t.r, y, t.z + Math.sin(a0) * t.r, t.x + Math.cos(a1) * t.r, y, t.z + Math.sin(a1) * t.r); if (k % 3 === 0) s.push(t.x + Math.cos(a0) * t.r, t.y0 + 0.6, t.z + Math.sin(a0) * t.r, t.x + Math.cos(a0) * t.r, t.y1, t.z + Math.sin(a0) * t.r); } }
      else if (e.pass) { const p = e.pass, y = groundH(p.x, p.z) + 0.05; s.push(p.x - p.r, y, p.z, p.x + p.r, y, p.z, p.x, y, p.z - p.r, p.x, y, p.z + p.r); }
      else if (e.trigger) { const t = e.trigger; for (let k = 0; k < 24; k++) { const a0 = k / 24 * 6.283, a1 = (k + 1) / 24 * 6.283; s.push(t.x + Math.cos(a0) * t.r, t.y, t.z + Math.sin(a0) * t.r, t.x + Math.cos(a1) * t.r, t.y, t.z + Math.sin(a1) * t.r); } }
      if (e.role === 'pushable' && e.obj) { const bh = new THREE.BoxHelper(e.obj, ROLE_COL.pushable); bh.material.depthTest = false; bh.material.transparent = true; bh.renderOrder = 999; bh.userData.follow = e.obj; group.add(bh); }
    }
    if (!PH.ok) { const s = seg('circle'); for (const c of COLS) { if (c.off || Math.hypot(c.x - center.x, c.z - center.z) > R) continue; const y = groundH(c.x, c.z) + 0.1; for (let k = 0; k < 16; k++) { const a0 = k / 16 * 6.283, a1 = (k + 1) / 16 * 6.283; s.push(c.x + Math.cos(a0) * c.r, y, c.z + Math.sin(a0) * c.r, c.x + Math.cos(a1) * c.r, y, c.z + Math.sin(a1) * c.r); } } }
    for (const role in segs) {
      if (!segs[role].length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs[role], 3));
      const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: ROLE_COL[role], transparent: true, opacity: role === 'solid' ? 0.55 : 0.9, depthTest: false, fog: false }));
      ls.renderOrder = 999; ls.frustumCulled = false; group.add(ls);
    }
    scene.add(group); dbg = { group, n };
    return dbg;
  }
  function debugUpdate() { if (dbg) dbg.group.children.forEach((o) => { if (o.userData.follow) o.update(); }); }
  return { register, registerInstances, remove, attach, passablesNear, triggersAt, counts, debug, debugUpdate, idle, flush, tuneExact, list, byRole, stats, providers, ROLE_COL, EXACT, stream, get physics() { return phys; }, get pendingFootprints() { return fpQueue.length; } };
  };
})();
