/* tools/interact/author-page.js — in-page authoring of interaction points (window.AUTH), injected by author.mjs.
 * For one reference instance per kind it scans the DRAWN triangles (Passport's pre-hull geometry, through the same
 * three-mesh-bvh caster the game uses) and proposes:
 *   wall patches (type 1): horizontal rays from outside at 0.5–2.2 m, outward-facing, near-vertical, continuous
 *                          vertically → one patch per azimuth with its vertical extent y0..y1 and flat width w
 *   tops (type 2):         downward rays walked inward from the rim; flat (n.y > 0.85), level over a hand's depth
 *   trunks:                visible radius vs the fitted cylinder at 0.9 / 1.3 / 1.6 m (ring points are generated at run time)
 * Points are stored in the kind's frame (obj-local for single objects / pushables; reference-instance world minus an
 * origin for instanced kinds, with anchor vertices that let the game solve every other instance's transform).
 */
(function () {
  const A = window.AUTH = {};
  const T = () => DBG.THREE, I = () => window.INTERACT;
  const base = (n) => String(n || '').replace(/#\d+$/, '');
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const kindKey = (e) => (e.role === 'trunk' ? base(e.name) + '|trunk' : base(e.name) + '|' + (e.geo ? e.geo.vn : 0));
  A.kinds = function (re) {
    const m = new Map(), rx = re ? new RegExp(re) : null;
    for (const e of DBG.Passport.list) {
      if (!e.alive || !(e.role === 'solid' || e.role === 'pushable' || e.role === 'trunk')) continue;
      const k = kindKey(e); if (rx && !rx.test(k)) continue;
      if (!m.has(k)) m.set(k, []); m.get(k).push(e);
    }
    return m;
  };
  function center(e) { const b = e.box; return { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2 }; }
  function pickRef(list) {   // a mid-size instance on dry ground (median footprint)
    const rad = (e) => e.box ? Math.hypot(e.box.max[0] - e.box.min[0], e.box.max[2] - e.box.min[2]) : 0;
    const ok = list.filter((e) => { const c = e.trunk ? { x: e.trunk.x, z: e.trunk.z } : center(e); return DBG.getH(c.x, c.z) > 0.5; });
    const L = (ok.length ? ok : list).slice().sort((a, b) => rad(a) - rad(b));
    return L[Math.floor(L.length / 2)];
  }
  function anchors(e) {   // 6 well-spread vertices (tetrahedron of max volume + 2 checks)
    const V = e.geo.v, n = e.geo.vn, p = (i) => [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]];
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    let i0 = 0; for (let i = 1; i < n; i++) if (V[i * 3] < V[i0 * 3]) i0 = i;
    let i1 = 0, m = -1; for (let i = 0; i < n; i++) { const d = d2(p(i), p(i0)); if (d > m) { m = d; i1 = i; } }
    const a = p(i0), b = p(i1), ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let i2 = 0; m = -1; for (let i = 0; i < n; i++) { const q = p(i), c = cross(ab, [q[0] - a[0], q[1] - a[1], q[2] - a[2]]), d = c[0] ** 2 + c[1] ** 2 + c[2] ** 2; if (d > m) { m = d; i2 = i; } }
    const c2 = p(i2), nrm = cross(ab, [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]]);
    let i3 = 0; m = -1; for (let i = 0; i < n; i++) { const q = p(i), d = Math.abs(nrm[0] * (q[0] - a[0]) + nrm[1] * (q[1] - a[1]) + nrm[2] * (q[2] - a[2])); if (d > m) { m = d; i3 = i; } }
    const ids = [i0, i1, i2, i3, Math.floor(n * 0.37), Math.floor(n * 0.71)];
    return ids;
  }
  // world → kind-frame converters
  function frameFor(e) {
    const THREE = T();
    if (e.role === 'pushable' || e.obj) {
      const o = e.role === 'pushable' && e.debris ? e.debris.mesh : e.obj; o.updateWorldMatrix(true, false);
      const Mi = o.matrixWorld.clone().invert(), Nt = new THREE.Matrix3().setFromMatrix4(o.matrixWorld).transpose();
      return { frame: 'obj', P: (v) => v.clone().applyMatrix4(Mi), N: (n) => n.clone().applyMatrix3(Nt).normalize() };
    }
    const c = center(e), O = new THREE.Vector3(Math.round(c.x), Math.round(e.box.min[1]), Math.round(c.z));
    return { frame: 'anchors', O, P: (v) => v.clone().sub(O), N: (n) => n.clone() };
  }
  const cast = (e, o, d, far) => I().castOn(e, o.x, o.y, o.z, d.x, d.y, d.z, far);
  A.scan = function (e) {
    const THREE = T(), V = THREE.Vector3, c = center(e), b = e.box;
    // stations around the oriented footprint (PCA of the drawn vertices in xz): every 0.45 m along each side, looking
    // straight in, plus the 4 corners looking at the centre — long walls / fuselages get points along their whole length
    const GV = e.geo.v, nv = e.geo.vn; let mx = 0, mz = 0; for (let i = 0; i < nv; i++) { mx += GV[i * 3]; mz += GV[i * 3 + 2]; } mx /= nv; mz /= nv;
    let sxx = 0, sxz = 0, szz = 0; for (let i = 0; i < nv; i++) { const dx = GV[i * 3] - mx, dz = GV[i * 3 + 2] - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (let i = 0; i < nv; i++) { const dx = GV[i * 3] - mx, dz = GV[i * 3 + 2] - mz, u = dx * ux + dz * uz, v = dx * vx + dz * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const M = 0.7, st = [];
    const side = (a0, a1, fixed, axisU, sgn) => { const L = a1 - a0, n = Math.max(1, Math.round(L / 0.45)); for (let k = 0; k <= n; k++) { const t = a0 + L * k / n; const u = axisU ? t : fixed, v = axisU ? fixed : t; const ox = mx + ux * u + vx * v, oz = mz + uz * u + vz * v; const dx = axisU ? vx * sgn : ux * sgn, dz = axisU ? vz * sgn : uz * sgn; st.push({ ox, oz, dx: -dx, dz: -dz }); } };
    side(u0 + 0.1, u1 - 0.1, v1 + M, true, 1); side(u0 + 0.1, u1 - 0.1, v0 - M, true, -1); side(v0 + 0.1, v1 - 0.1, u1 + M, false, 1); side(v0 + 0.1, v1 - 0.1, u0 - M, false, -1);
    for (const [cu, cv] of [[u0, v0], [u0, v1], [u1, v0], [u1, v1]]) { const ox = mx + ux * cu * 1.15 + vx * cv * 1.15, oz = mz + uz * cu * 1.15 + vz * cv * 1.15, l = Math.hypot(mx - ox, mz - oz) || 1; st.push({ ox, oz, dx: (mx - ox) / l, dz: (mz - oz) / l }); }
    const R = Math.hypot(u1 - u0, v1 - v0) / 2 + M, nAz = st.length;
    const walls = [], tops = [];
    for (const S0 of st) {
      const dir = new V(-S0.dx, 0, -S0.dz), ox = S0.ox, oz = S0.oz;   // dir = outward
      // ---- wall column
      const col = [];
      for (let hh = 0.5; hh <= 2.21; hh += 0.1) {
        const gy = DBG.groundH(ox, oz), o = new V(ox, gy + hh, oz), h = cast(e, o, dir.clone().negate(), 2 * R + 1);
        if (!h) { col.push(null); continue; }
        const n = h.normal, nh = Math.hypot(n.x, n.z);
        const ok = Math.abs(n.y) < 0.5 && (n.x * dir.x + n.z * dir.z) / Math.max(nh, 1e-6) > 0.5;
        col.push(ok ? { p: h.point, n: n.clone(), hh } : null);
      }
      // longest run of valid, continuous samples
      let best = null, cur = null;
      for (let i = 0; i < col.length; i++) {
        const s = col[i], prev = i ? col[i - 1] : null;
        const cont = s && prev && Math.hypot(s.p.x - prev.p.x, s.p.z - prev.p.z) < 0.15 && s.n.dot(prev.n) > 0.8;
        if (s && (cur && cont)) cur.push(s); else { if (cur && (!best || cur.length > best.length)) best = cur; cur = s ? [s] : null; }
      }
      if (cur && (!best || cur.length > best.length)) best = cur;
      if (best && best.length >= 3) {
        const mid = best.reduce((q, s) => (Math.abs(s.hh - 1.37) < Math.abs(q.hh - 1.37) ? s : q), best[0]);
        const n = new V(); for (const s of best) n.add(s.n); n.normalize();
        // flat width at that height: parallel rays ±0.2 m sideways must land on the same plane
        const side = new V(-n.z, 0, n.x).normalize(); let w = 0;
        const on = (off) => { const o = mid.p.clone().addScaledVector(side, off).addScaledVector(n, 0.35), h = cast(e, o, n.clone().negate(), 0.8); return h && Math.abs(h.point.clone().sub(mid.p).dot(n)) < 0.05 && h.normal.dot(n) > 0.85; };
        const L = on(0.2), Rr = on(-0.2); w = L && Rr ? 0.4 : (L || Rr) ? 0.2 : 0;
        walls.push({ p: mid.p, n, y0: best[0].p.y, y1: best[best.length - 1].p.y, w, e: new V(n.x, 0, n.z).normalize() });
      }
      // ---- top: walk inward from outside with downward rays; the rim of the flat part is the first sample (within
      // 0.45 m of the first touch — rounded edges) whose normal is up; it must stay level for a hand's depth inward
      const topY = b.max[1] + 0.5, down = new V(0, -1, 0), far = topY - b.min[1] + 1;
      let first = null;
      for (let d = 0; d < 2 * R; d += 0.04) {
        const x = ox - dir.x * d, z = oz - dir.z * d, h = cast(e, new V(x, topY, z), down, far);
        if (!h) continue;
        if (first === null) first = d;
        if (d - first > 0.45) break;
        if (h.normal.y < 0.75) continue;
        const h2 = cast(e, new V(x - dir.x * 0.04, topY, z - dir.z * 0.04), down, far), h3 = cast(e, new V(x - dir.x * 0.4, topY, z - dir.z * 0.4), down, far);
        // flat enough for two palms: level across ±0.22 m a hand's depth (0.14 m) in from the rim, and 0.4 m in
        const lat = [0.22, -0.22].map((o) => cast(e, new V(x - dir.x * 0.14 + dir.z * o, topY, z - dir.z * 0.14 - dir.x * o), down, far));
        const wide = lat.every((q) => q && q.normal.y > 0.55 && h2 && Math.abs(q.point.y - h2.point.y) < 0.25);
        if (h2 && h3 && wide && h2.normal.y > 0.7 && Math.abs(h2.point.y - h.point.y) < 0.12 && Math.abs(h3.point.y - h2.point.y) < 0.35) {
          const gy = DBG.groundH(x + dir.x * 0.6, z + dir.z * 0.6);
          if (h2.point.y - gy > 0.1 && h2.point.y - gy < 2.6) tops.push({ p: h2.point, n: h2.normal.clone(), e: dir.clone(), y0: h2.point.y, y1: h2.point.y, w: 0.4 });
        }
        break;
      }
    }
    return { walls, tops, nAz };
  };
  // one kind → data record (+ markers for the contact sheet)
  A.author = async function (key) {
    const list = A.kinds('^' + key.replace(/[|]/g, '\\|') + '$').get(key); if (!list) return { key, error: 'no entries' };
    const e = pickRef(list);
    if (e.role === 'trunk') return await A.trunk(key, list);
    // a pushable has moved since it registered: scan its live drawn mesh (world vertices now), not the stale Passport copy
    let se = e;
    if (e.role === 'pushable' && e.debris) {
      const m = e.debris.mesh, v = [], tmp = new (T().Vector3)(); m.updateWorldMatrix(true, true);
      m.traverse((o) => { if (!o.isMesh || !o.material || o.material.visible === false) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { tmp.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); v.push(tmp.x, tmp.y, tmp.z); } });
      const box = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) { box.min[a] = Math.min(box.min[a], v[i + a]); box.max[a] = Math.max(box.max[a], v[i + a]); }
      se = { role: 'pushable', debris: e.debris, obj: e.obj, name: e.name, geo: { v: new Float32Array(v), vn: v.length / 3 }, box };
    }
    const F = frameFor(e), s = A.scan(se), pts = [];
    const add = (q, type) => {
      const p = F.P(q.p), n = F.N(q.n), ed = F.N(q.e), y0 = F.P(new (T().Vector3)(q.p.x, q.y0, q.p.z)).y, y1 = F.P(new (T().Vector3)(q.p.x, q.y1, q.p.z)).y;
      pts.push([r3(p.x), r3(p.y), r3(p.z), r3(n.x), r3(n.y), r3(n.z), r3(ed.x), r3(ed.z), type, r3(Math.min(y0, y1)), r3(Math.max(y0, y1)), q.w]);
    };
    for (const q of s.walls) add(q, 1);
    for (const q of s.tops) add(q, 2);
    const rec = { frame: F.frame, ref: e.name, n: list.length, pts };
    if (F.frame === 'anchors') { rec.origin = [F.O.x, F.O.y, F.O.z]; rec.anchors = anchors(e).map((i) => [i, r3(e.geo.v[i * 3] - F.O.x), r3(e.geo.v[i * 3 + 1] - F.O.y), r3(e.geo.v[i * 3 + 2] - F.O.z)]); }
    A.last = { e: se, s };
    return { key, rec, walls: s.walls.length, tops: s.tops.length, nAz: s.nAz };
  };
  // trunk kinds: the drawn bark radius at hand/shoulder height relative to the Passport cylinder (base ring)
  A.trunk = async function (key, list) {
    const THREE = T(), rats = { 0.9: [], 1.3: [], 1.6: [] };
    const sample = list.slice(0, 6);
    for (const e of sample) {
      const t = e.trunk, g = DBG.groundH(t.x, t.z);
      DBG.teleport(t.x + 4, t.z + 4, 0); await new Promise((r) => setTimeout(r, 450));   // real tree models only near the player
      IX.nearDrawn(3, t.x, t.z, true);
      for (const h of [0.9, 1.3, 1.6]) {
        const ds = [];
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2, o = new THREE.Vector3(t.x + Math.sin(a) * 2, g + h, t.z + Math.cos(a) * 2), d = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
          const hit = IX._drawnUnder ? IX._drawnUnder(o, d, 2.2) : null; if (hit) ds.push(2 - hit.hit.distance);
        }
        ds.sort((x, y) => x - y); if (ds.length >= 5) rats[h].push(ds[ds.length >> 1] / t.r);
      }
    }
    const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const rAt = [[0, 1]]; for (const h of [0.9, 1.3, 1.6]) { const m = med(rats[h]); if (m) rAt.push([h, r3(Math.min(1.2, Math.max(0.3, m)))]); }
    const r = list[0].trunk.r * (rAt.find((x) => x[0] === 1.3) || [0, 1])[1];
    return { key, rec: { frame: 'trunk', n: list.length, heights: [1.34, 1.37], rAt, rMin: r3(r) }, trunk: true, samples: rats };
  };
  // contact-sheet markers for the last authored solid
  A.markers = function (on) {
    const THREE = T(), S = DBG.scene;
    if (A._mk) { S.remove(A._mk); A._mk = null; }
    if (!on || !A.last) return 0;
    const g = new THREE.Group(); g.renderOrder = 999;
    const mk = (p, n, col, len) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); m.position.copy(p); m.renderOrder = 999; g.add(m);
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, p.clone().addScaledVector(n, len)]), new THREE.LineBasicMaterial({ color: col, depthTest: false })); l.renderOrder = 999; g.add(l);
    };
    for (const q of A.last.s.walls) { mk(q.p, q.n, q.w >= 0.3 ? 0x33e0ff : 0x3377ff, 0.35); const lo = q.p.clone(); lo.y = q.y0; const hi = q.p.clone(); hi.y = q.y1; const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([lo, hi]), new THREE.LineBasicMaterial({ color: 0x33e0ff, depthTest: false })); l.renderOrder = 999; g.add(l); }
    for (const q of A.last.s.tops) mk(q.p, q.e, 0xffa030, 0.3);
    S.add(g); A._mk = g; return g.children.length;
  };
  // frame a 3/4 view of the last authored object
  A.view = function (k) {
    const e = A.last.e, c = center(e), b = e.box, R = Math.max(2.5, Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2);
    const a = 0.8 + k * Math.PI * 0.9, d = R * 1.6 + 3, gy = DBG.groundH(c.x + Math.sin(a) * d, c.z + Math.cos(a) * d);
    DBG.camOv = { pos: [c.x + Math.sin(a) * d, Math.max(gy + 1.6, c.y + R * 0.6), c.z + Math.cos(a) * d], look: [c.x, c.y, c.z] };
    return DBG.camOv;
  };
})();
