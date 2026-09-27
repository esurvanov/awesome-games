// Ходьба по залу: сетка 0.25 м из LAYOUT (стены, препятствия, столы), поиск пути и места.
// Путь ищется «полем расстояний» от цели (Дейкстра по сетке = A* без эвристики, но на все старты сразу):
// поле считается один раз на цель и кэшируется, дальше любой путь к этой цели — спуск по полю
// за O(длины пути). Новых полей — не больше budget за шаг (остальные ждут шаг), кэш LRU.
// Диван — «мягкое» препятствие: по нему можно протиснуться к месту (дорого), столы и стойка — нет.
// Места (spots): сиденья столов, стоячие места у stands, свободные точки в зонах; у каждого — клетка
// подхода и соседи (для групп разговора).
'use strict';
L.def('sim/nav', () => {
const { clamp } = L.use('core');

const CELL = 0.25, SQ2 = Math.SQRT2;
const HARD = 0, FREE = 1, SOFT = 2;           // значения клетки
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = l2 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  const dx = px - ax - vx * t, dz = pz - az - vz * t;
  return Math.sqrt(dx * dx + dz * dz);
}
const inRect = (x, z, r, pad = 0) => x >= r[0] - pad && x <= r[2] + pad && z >= r[1] - pad && z <= r[3] + pad;
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
// точка в многоугольнике или ближе pad к его краю
function nearPoly(x, z, poly, pad) {
  if (inPoly(x, z, poly)) return true;
  if (pad <= 0) return false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segDist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) < pad) return true;
  return false;
}

class Nav {
  constructor(LAYOUT, opt = {}) {
    this.LAY = LAYOUT;
    this.radius = opt.radius ?? 0.2;
    this.budget = opt.budget ?? 1;           // новых полей за шаг
    this.cacheMax = opt.cacheMax ?? 180;
    // границы: зал + все зоны
    let x0 = 0, z0 = 0, x1 = LAYOUT.size.w, z1 = LAYOUT.size.d;
    for (const [x, z] of LAYOUT.hall || []) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    for (const zn of LAYOUT.zones) { x0 = Math.min(x0, zn.rect[0]); z0 = Math.min(z0, zn.rect[1]); x1 = Math.max(x1, zn.rect[2]); z1 = Math.max(z1, zn.rect[3]); }
    this.x0 = x0 - CELL; this.z0 = z0 - CELL;
    this.nx = Math.ceil((x1 - x0) / CELL) + 2; this.nz = Math.ceil((z1 - z0) / CELL) + 2;
    const N = this.nx * this.nz;
    this.grid = new Uint8Array(N);
    // твёрдое (без раздува) — для проверки «стоит в мебели»
    this.solidRects = []; this.solidPolys = [];
    for (const b of LAYOUT.blocks) if (b.kind !== 'sofa') (b.poly ? this.solidPolys.push(b.poly) : this.solidRects.push(b.rect));
    for (const t of LAYOUT.tables) this.solidRects.push([t.x - t.w / 2, t.z - t.d / 2, t.x + t.w / 2, t.z + t.d / 2]);
    this.softRects = LAYOUT.blocks.filter(b => b.kind === 'sofa').map(b => b.rect);
    const r = this.radius;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
      this.grid[j * this.nx + i] = this.classify(x, z, r);
    }
    // поля расстояний: key(goal cell) → { d: Float32Array, used }
    this.fields = new Map(); this.used = 0; this.stamp = 0;
    this.heap = new Int32Array(N * 4); this.heapD = new Float32Array(N * 4);
    this.stats = { fields: 0, hits: 0, waits: 0 };
  }
  // в зале (контур hall — прямоугольник с коридорчиком в туалет) или снаружи на веранде/улице (зоны с z<0)
  inside(x, z) {
    const S = this.LAY.size, hall = this.LAY.hall;
    if (hall ? inPoly(x, z, hall) : (x >= 0 && x <= S.w && z >= 0 && z <= S.d)) return true;
    for (const zn of this.LAY.zones) if (zn.rect[3] <= 0 && inRect(x, z, zn.rect)) return true;
    return false;
  }
  classify(x, z, r) {
    if (!this.inside(x, z)) return HARD;
    for (const w of this.LAY.walls) if (w.kind !== 'door' && segDist(x, z, w.a[0], w.a[1], w.b[0], w.b[1]) < 0.06 + r) return HARD;
    for (const R of this.solidRects) if (inRect(x, z, R, r)) return HARD;
    for (const P of this.solidPolys) if (nearPoly(x, z, P, r)) return HARD;
    for (const R of this.softRects) if (inRect(x, z, R, r * 0.5)) return SOFT;
    return FREE;
  }
  // «человек стоит внутри мебели/стены» — сырая геометрия, без раздува
  solidAt(x, z) {
    if (!this.inside(x, z)) return true;
    for (const R of this.solidRects) if (inRect(x, z, R, -0.02)) return true;
    for (const P of this.solidPolys) if (inPoly(x, z, P)) return true;
    for (const w of this.LAY.walls) if (w.kind !== 'door' && segDist(x, z, w.a[0], w.a[1], w.b[0], w.b[1]) < 0.02) return true;
    return false;
  }
  ci(x) { return clamp(Math.floor((x - this.x0) / CELL), 0, this.nx - 1); }
  cj(z) { return clamp(Math.floor((z - this.z0) / CELL), 0, this.nz - 1); }
  cell(x, z) { return this.cj(z) * this.nx + this.ci(x); }
  cx(c) { return this.x0 + ((c % this.nx) + 0.5) * CELL; }
  cz(c) { return this.z0 + (Math.floor(c / this.nx) + 0.5) * CELL; }
  free(c) { return this.grid[c] !== HARD; }
  walkable(x, z) { return this.grid[this.cell(x, z)] === FREE; }
  // ближайшая проходимая клетка (по спирали), опционально — с прямой видимостью до (x,z) без сырой мебели
  nearestFree(x, z, maxR = 12, needLine = false, soft = false) {
    const i0 = this.ci(x), j0 = this.cj(z);
    let best = -1, bd = 1e9;
    for (let rr = 0; rr <= maxR; rr++) {
      for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const c = j * this.nx + i, g = this.grid[c];
        if (g === HARD || (!soft && g === SOFT)) continue;
        const px = this.cx(c), pz = this.cz(c), d = Math.hypot(px - x, pz - z);
        if (d >= bd) continue;
        if (needLine && !this.rawLine(px, pz, x, z)) continue;
        best = c; bd = d;
      }
      if (best >= 0 && rr * CELL > bd + CELL) break;
    }
    return best;
  }
  // отрезок не пересекает сырую мебель (для последнего шага к сиденью)
  rawLine(ax, az, bx, bz) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.08);
    for (let k = 1; k < n; k++) { const t = k / n; if (this.solidAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }
  // прямая видимость по раздутой сетке (для сглаживания пути)
  los(ax, az, bx, bz) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5));
    for (let k = 1; k < n; k++) { const t = k / n; if (this.grid[this.cell(ax + (bx - ax) * t, az + (bz - az) * t)] !== FREE) return false; }
    return true;
  }
  resetBudget() { this.left = this.budget; }
  // поле расстояний до клетки goal; null, если бюджет шага исчерпан
  field(goal) {
    let f = this.fields.get(goal);
    if (f) { f.used = ++this.stamp; this.stats.hits++; return f.d; }
    if (this.left <= 0) { this.stats.waits++; return null; }
    this.left--;
    const N = this.nx * this.nz, d = new Float32Array(N).fill(Infinity), H = this.heap, HD = this.heapD;
    let n = 0;
    const push = (c, v) => { let k = n++; while (k > 0) { const p = (k - 1) >> 1; if (HD[p] <= v) break; H[k] = H[p]; HD[k] = HD[p]; k = p; } H[k] = c; HD[k] = v; };
    const pop = () => {
      const top = H[0]; n--; const c = H[n], v = HD[n]; let k = 0;
      for (;;) { let m = 2 * k + 1; if (m >= n) break; if (m + 1 < n && HD[m + 1] < HD[m]) m++; if (HD[m] >= v) break; H[k] = H[m]; HD[k] = HD[m]; k = m; }
      H[k] = c; HD[k] = v; return top;
    };
    d[goal] = 0; push(goal, 0);
    const nx = this.nx, nz = this.nz, G = this.grid;
    while (n > 0) {
      const dv = HD[0], c = pop();
      if (dv > d[c]) continue;
      const i = c % nx, j = (c - i) / nx;
      for (let k = 0; k < 8; k++) {
        const ii = i + DX[k], jj = j + DZ[k];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const cc = jj * nx + ii, g = G[cc];
        if (g === HARD) continue;
        if (k >= 4 && (G[j * nx + ii] === HARD || G[jj * nx + i] === HARD)) continue; // без срезания углов
        const nd = dv + DC[k] * (g === SOFT ? 4 : 1);
        if (nd < d[cc]) { d[cc] = nd; if (n < H.length) push(cc, nd); }
      }
    }
    this.fields.set(goal, { d, used: ++this.stamp });
    this.stats.fields++;
    if (this.fields.size > this.cacheMax) {
      let old = null, ou = Infinity;
      for (const [k, v] of this.fields) if (v.used < ou) { ou = v.used; old = k; }
      this.fields.delete(old);
    }
    return d;
  }
  // путь от (x,z) к клетке goal: массив точек [{x,z}], последняя — центр goal.
  // null — ждать (бюджет), false — недостижимо.
  path(x, z, goal) {
    const d = this.field(goal);
    if (!d) return null;
    let c = this.cell(x, z);
    if (!isFinite(d[c])) { c = this.nearestFree(x, z, 6, false, true); if (c < 0 || !isFinite(d[c])) return false; }
    const cells = [c], nx = this.nx;
    for (let guard = 0; c !== goal && guard < 2000; guard++) {
      const i = c % nx, j = (c - i) / nx; let best = c, bv = d[c];
      for (let k = 0; k < 8; k++) {
        const ii = i + DX[k], jj = j + DZ[k];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= this.nz) continue;
        const cc = jj * nx + ii;
        if (d[cc] < bv) { bv = d[cc]; best = cc; }
      }
      if (best === c) break;
      c = best; cells.push(c);
    }
    // сглаживание «натянутой нитью»
    const pts = [];
    let ax = x, az = z, k = 0;
    while (k < cells.length - 1) {
      let far = k + 1;
      for (let m = cells.length - 1; m > k + 1; m--) if (this.los(ax, az, this.cx(cells[m]), this.cz(cells[m]))) { far = m; break; }
      ax = this.cx(cells[far]); az = this.cz(cells[far]); pts.push({ x: ax, z: az }); k = far;
    }
    if (!pts.length) pts.push({ x: this.cx(goal), z: this.cz(goal) });
    return pts;
  }
}

// ─────────── места ───────────
// spot: { id, kind:'seat'|'stand', x, z, face, zone, table?, sofa?, stand?, approach(cell), nb:[spot], occ, hold }
function buildSpots(LAY, nav) {
  const spots = [], byId = {};
  const add = s => { s.occ = null; s.hold = null; s.nb = []; spots.push(s); byId[s.id] = s; return s; };
  for (const t of LAY.tables) for (const s of t.seats)
    add({ id: s.id, kind: 'seat', x: s.x, z: s.z, face: s.face, zone: t.zone, table: t.id, sofa: s.kind === 'sofa', seatKind: s.kind });
  const clear = (x, z, r) => { for (let a = 0; a < 8; a++) { const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r; if (!nav.walkable(px, pz)) return false; } return nav.walkable(x, z); };
  const far = (x, z, min) => { for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < min) return false; return true; };
  // у каждого stand — сама точка и до 2 мест рядом (стоят кучкой)
  for (const st of LAY.stands) {
    let n = 0;
    const cand = [[0, 0]];
    for (let a = 0; a < 8; a++) cand.push([Math.sin(st.face + Math.PI + a * Math.PI / 4) * 0.6, Math.cos(st.face + Math.PI + a * Math.PI / 4) * 0.6]);
    for (const [ox, oz] of cand) {
      const x = st.x + ox, z = st.z + oz;
      if (!nav.walkable(x, z) || !far(x, z, 0.5)) continue;
      const face = n === 0 ? st.face : Math.atan2(st.x - x, st.z - z) + (st.kind === 'bar' ? 0 : 0);
      add({ id: `${st.id}.${n}`, kind: 'stand', x, z, face: n === 0 ? st.face : face, zone: st.zone, stand: st.id, standKind: st.kind });
      if (++n >= 3) break;
    }
  }
  // свободные стоячие точки по зонам (сетка 1.1 м, с запасом от мебели)
  for (const zn of LAY.zones) {
    const r = zn.rect;
    for (let z = r[1] + 0.55; z < r[3] - 0.3; z += 1.1) for (let x = r[0] + 0.55; x < r[2] - 0.3; x += 1.1) {
      if (!clear(x, z, 0.45) || !far(x, z, 0.8)) continue;
      add({ id: `${zn.id}~${spots.length}`, kind: 'stand', x: +x.toFixed(2), z: +z.toFixed(2), face: 0, zone: zn.id, free: true });
    }
  }
  // клетка подхода
  for (const s of spots) {
    if (s.kind === 'stand') { s.approach = nav.cell(s.x, s.z); s.direct = true; continue; }
    s.approach = nav.nearestFree(s.x, s.z, 12, true);
    if (s.approach < 0) s.approach = nav.nearestFree(s.x, s.z, 12, true, true);
  }
  // соседи для разговора
  const G = spots.length;
  for (let i = 0; i < G; i++) for (let j = i + 1; j < G; j++) {
    const a = spots[i], b = spots[j], d = Math.hypot(a.x - b.x, a.z - b.z);
    let ok = false;
    if (a.kind === 'seat' && b.kind === 'seat') {
      if (a.table === b.table) ok = d < 2.4;
      else ok = d < 1.25 && LAY.tables.find(t => t.id === a.table)?.joinable && LAY.tables.find(t => t.id === b.table)?.joinable;
    } else if (a.kind === 'stand' && b.kind === 'stand') ok = d < 1.35 && a.zone === b.zone;
    else ok = d < 1.3;
    if (ok) { a.nb.push(b); b.nb.push(a); }
  }
  // «свободные» стоячие точки слишком близко к местам у stands — убрать дубли соседства не нужно
  // для поворота к собеседникам: стоячее место без своего face смотрит на центр соседей
  for (const s of spots) if (s.free && s.nb.length) {
    let mx = 0, mz = 0; for (const o of s.nb) { mx += o.x; mz += o.z; }
    s.face = Math.atan2(mx / s.nb.length - s.x, mz / s.nb.length - s.z);
  }
  return { spots, byId };
}

return { Nav, buildSpots, CELL };
});
