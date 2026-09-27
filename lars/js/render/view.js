// Вид сверху: Canvas 2D. Мир в метрах, камера {x, y, z — px на метр}.
// LOD: далеко — очередь точками (цвет — настроение), средне — прямоугольники, близко — машины с деталями,
// люди между машинами, продавцы, свет. Статичный рельеф — Path2D по кускам дороги (строится один раз).
'use strict';
L.def('render/view', () => {
const { clamp, lerp, hash01, smooth } = L.use('core');
const { LANE_OFF } = L.use('sim/world');
const { drawIcon } = L.use('ui/icons');

const TAU = Math.PI * 2;

class View {
  constructor(canvas, world, quality) {
    this.cv = canvas; this.g = canvas.getContext('2d', { alpha: false });
    this.w = world; this.q = quality;
    this.cam = { x: 0, y: 0, z: 2.2 };
    this.W = 0; this.H = 0; this.dpr = 1;
    this.P = world.C.ROUTE.palette;
    this.light = document.createElement('canvas'); this.lg = this.light.getContext('2d');
    this.agents = []; this.sel = null; this.hover = null; this.time = 0;
    this.buildTerrain();
    this.resize();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprMax);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight; this.dpr = dpr;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.light.width = Math.max(1, Math.round(this.W / 2)); this.light.height = Math.max(1, Math.round(this.H / 2));
  }
  get zMin() { return Math.min(this.H / (this.w.road.len + 1500), this.W / 3000); }
  setZoom(z, sx = this.W / 2, sy = this.H / 2) {
    const c = this.cam, wx = (sx - this.W / 2) / c.z + c.x, wy = (sy - this.H / 2) / c.z + c.y;
    c.z = clamp(z, this.zMin, 14);
    c.x = wx - (sx - this.W / 2) / c.z; c.y = wy - (sy - this.H / 2) / c.z;
    this.clampCam();
  }
  clampCam() {
    const r = this.w.road, c = this.cam;
    c.y = clamp(c.y, r.Y[r.n - 1] - 400, 400);
    c.x = clamp(c.x, -3000, 4000);
  }
  toWorld(sx, sy) { const c = this.cam; return { x: (sx - this.W / 2) / c.z + c.x, y: (sy - this.H / 2) / c.z + c.y }; }
  toScreen(x, y) { const c = this.cam; return { x: (x - c.x) * c.z + this.W / 2, y: (y - c.y) * c.z + this.H / 2 }; }

  // ─────────── статичный рельеф ───────────
  buildTerrain() {
    const r = this.w.road, P = this.P, CH = r.CH;
    this.tc = [];
    const at = (i, off) => [r.X[i] + r.NX[i] * off, r.Y[i] + r.NY[i] * off];
    // рельеф — от сглаженной оси долины (дорога петляет внутри неё); смещение дороги от оси учитываем, чтобы дно её накрывало
    const dev = i => (r.X[i] - r.SX[i]) * r.SNX[i] + (r.Y[i] - r.SY[i]) * r.SNY[i];
    const atS = (i, off) => { const d = dev(i); const o = off < 0 ? Math.min(off, d + off) : Math.max(off, d + off); return [r.SX[i] + r.SNX[i] * o, r.SY[i] + r.SNY[i] * o]; };
    // полосы рельефа от края дна наружу: нижний лес, верхний лес, скалы, высокие скалы (м)
    const BANDS = [0, 120, 300, 560, 950];
    for (const c of r.chunks) {
      const i0 = Math.max(0, c.i0 - 3), i1 = Math.min(r.n - 1, c.i1 + 3);
      const floor = new Path2D(), river = new Path2D(), road = new Path2D(), rocks = new Path2D(), flow = new Path2D(), edge = new Path2D();
      const bands = [0, 1, 2, 3].map(() => new Path2D());
      const trees = [new Path2D(), new Path2D(), new Path2D()];
      for (let i = i0; i <= i1; i++) { const [x, y] = atS(i, -r.GW[i]); i === i0 ? floor.moveTo(x, y) : floor.lineTo(x, y); }
      for (let i = i1; i >= i0; i--) { const [x, y] = atS(i, r.GE[i]); floor.lineTo(x, y); }
      floor.closePath();
      const wob = (i, k) => 1 + 0.3 * Math.sin(i * 0.011 + k * 1.7) + 0.15 * Math.sin(i * 0.029 + k * 2.3);
      for (const sgn of [-1, 1]) {
        const arr = sgn < 0 ? r.GW : r.GE;
        for (let k = 0; k < 4; k++) {
          const p = bands[k];
          for (let i = i0; i <= i1; i++) { const [x, y] = atS(i, sgn * (arr[i] + BANDS[k] * (k ? wob(i, k + sgn) : 1))); i === i0 ? p.moveTo(x, y) : p.lineTo(x, y); }
          for (let i = i1; i >= i0; i--) { const [x, y] = atS(i, sgn * (arr[i] + BANDS[k + 1] * wob(i, k + 1 + sgn))); p.lineTo(x, y); }
          p.closePath();
          if (k === 1 || k === 2) for (let i = i0; i <= i1; i++) { const [x, y] = atS(i, sgn * (arr[i] + BANDS[k + 1] * wob(i, k + 1 + sgn))); i === i0 ? edge.moveTo(x, y) : edge.lineTo(x, y); }
        }
        // деревья: кучками на нижних полосах и кое-где на дне у края
        for (let i = i0; i <= i1; i += 2) for (let k = 0; k < 3; k++) {
          const hh = hash01(i * 3 + k, sgn + 11); if (hh < 0.3) continue;
          const off = arr[i] - 25 + hash01(i * 5 + k, sgn + 13) * (BANDS[2] * wob(i, 2 + sgn) + 20), [tx, ty] = atS(i, sgn * off), rad = 3.5 + hh * 6;
          const p = trees[Math.floor(hash01(i, k + 17) * 3)]; p.moveTo(tx + rad, ty); p.arc(tx, ty, rad, 0, TAU);
        }
      }
      for (let i = i0; i <= i1; i += 3) if (hash01(i, 3) < 0.3) { const [bx, by] = at(i, r.RIV[i] + (hash01(i, 4) - 0.5) * 34); const rr = 1.2 + hash01(i, 5) * 2.6; rocks.moveTo(bx + rr, by); rocks.arc(bx, by, rr, 0, TAU); }
      for (let i = i0; i <= i1; i++) { const [x, y] = at(i, r.RIV[i]); i === i0 ? river.moveTo(x, y) : river.lineTo(x, y); }
      for (let i = i0; i <= i1; i += 5) { const o = r.RIV[i] + (hash01(i, 21) - 0.5) * 10; const [x, y] = at(i, o), [x2, y2] = at(Math.min(i1, i + 3), o); flow.moveTo(x, y); flow.lineTo(x2, y2); }
      for (let i = i0; i <= i1; i++) { const [x, y] = at(i, 0); i === i0 ? road.moveTo(x, y) : road.lineTo(x, y); }
      this.tc.push({ c, floor, bands, edge, river, flow, road, trees, rocks });
    }
    // посёлки: дома (повёрнутые прямоугольники) — по данным places
    this.houses = new Path2D(); this.roofs = new Path2D(); this.placeMarks = [];
    for (const pl of this.w.C.ROUTE.places) {
      const s = pl.s * 1000, base = r.at(s, 0);
      this.placeMarks.push({ pl, s, x: base.x, y: base.y });
      for (let k = 0; k < (pl.houses || 0); k++) {
        const hs = s + (hash01(k, pl.s * 100) - 0.5) * 380, side = pl.side * (hash01(k, 9) < 0.8 ? 1 : -1);
        const q = r.at(clamp(hs, 0, r.len), side * (16 + hash01(k, 3) * 70));
        const w = 7 + hash01(k, 4) * 6, l = 8 + hash01(k, 5) * 8, a = Math.atan2(q.ny, q.nx) + (hash01(k, 6) - 0.5) * 0.4;
        const path = hash01(k, 8) < 0.5 ? this.houses : this.roofs;
        const ca = Math.cos(a), sa = Math.sin(a);
        const pts = [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]].map(([u, v]) => [q.x + u * ca - v * sa, q.y + u * sa + v * ca]);
        path.moveTo(...pts[0]); for (let j = 1; j < 4; j++) path.lineTo(...pts[j]); path.closePath();
      }
    }
    // Ермоловский камень
    const em = this.w.C.ROUTE.places.find(p => p.id === 'ermolov');
    this.stone = null;
    if (em) { const q = r.at(em.s * 1000, em.side * em.off); this.stone = new Path2D(); for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, rr = 13 + hash01(k, 77) * 5; k ? this.stone.lineTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr * 0.7) : this.stone.moveTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr * 0.7); } this.stone.closePath(); }
  }

  // ─────────── кадр ───────────
  draw(dtReal, alpha) {
    const g = this.g, w = this.w, c = this.cam, z = c.z, W = this.W, H = this.H, dpr = this.dpr, P = this.P;
    this.time += dtReal;
    const L = w.env.light(), dark = 1 - L;
    // фон — дальние склоны (светлее днём)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = mix('#0c0f12', '#57564f', 0.45 + 0.55 * L); g.fillRect(0, 0, W, H);
    // мировая система координат
    const tx = W / 2 - c.x * z, ty = H / 2 - c.y * z;
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * tx, dpr * ty);
    const vx0 = c.x - W / 2 / z, vx1 = c.x + W / 2 / z, vy0 = c.y - H / 2 / z, vy1 = c.y + H / 2 / z;
    this.view = { x0: vx0, x1: vx1, y0: vy0, y1: vy1 };
    const vis = this.tc.filter(t => !(t.c.x1 < vx0 || t.c.x0 > vx1 || t.c.y1 < vy0 - 900 || t.c.y0 > vy1 + 900));
    const px = 1 / z; // 1 экранный пиксель в метрах
    // рельеф: полосы от дна к скалам (светлее выше), днём/ночью — общий множитель L
    const LB = 0.45 + 0.55 * L;
    const BC = ['#56663a', '#46573a', '#6e6c63', '#63625b'];
    for (let k = 3; k >= 0; k--) { g.fillStyle = mix('#101418', BC[k], LB); for (const t of vis) g.fill(t.bands[k]); }
    g.strokeStyle = mix('#101418', '#8d8a7e', LB * 0.8); g.lineWidth = Math.max(1.5, 1 * px); for (const t of vis) g.stroke(t.edge);
    g.fillStyle = mix('#161a14', '#79804f', LB); for (const t of vis) g.fill(t.floor);
    if (z > 0.18 && this.q.trees) {
      const tc = ['#34462a', '#7f7234', '#4e5e30'];
      for (let k = 0; k < 3; k++) { g.fillStyle = mix('#0f140f', tc[k], LB); for (const t of vis) g.fill(t.trees[k]); }
    }
    // Терек: мутный серо-бирюзовый, с бурунами
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = mix('#0f1614', '#5d6f68', LB); g.lineWidth = Math.max(28, 4 * px); for (const t of vis) g.stroke(t.river);
    g.strokeStyle = mix('#14201f', '#8fa7a2', LB); g.lineWidth = Math.max(19, 3 * px); for (const t of vis) g.stroke(t.river);
    if (z > 0.5) {
      g.strokeStyle = mix('#23302e', '#d7e2dc', LB * 0.9); g.lineWidth = 0.6; g.setLineDash([2, 5]); g.lineDashOffset = -this.time * 6;
      for (const t of vis) g.stroke(t.flow); g.setLineDash([]); g.lineDashOffset = 0;
      g.fillStyle = mix('#1a1c1c', '#8e8c86', LB); for (const t of vis) g.fill(t.rocks);
    }
    // дорога
    g.strokeStyle = mix('#1d1c19', '#9a927f', LB); g.lineWidth = Math.max(11, 3 * px); for (const t of vis) g.stroke(t.road);
    g.strokeStyle = mix('#1b1b1a', '#5a5750', LB); g.lineWidth = Math.max(7.6, 2 * px); for (const t of vis) g.stroke(t.road);
    if (z > 1.2) { g.setLineDash([3, 9]); g.strokeStyle = mix('#3a3934', '#d8d4c4', LB); g.lineWidth = 0.15; for (const t of vis) g.stroke(t.road); g.setLineDash([]); }
    // посёлки, камень, КПП
    if (z > 0.15) { const LB2 = 0.45 + 0.55 * L; g.fillStyle = 'rgba(0,0,0,0.3)'; g.save(); g.translate(1.2, 1.6); g.fill(this.houses); g.fill(this.roofs); g.restore(); g.fillStyle = mix('#15130f', '#a0826a', LB2); g.fill(this.houses); g.fillStyle = mix('#131617', '#8e9a9c', LB2); g.fill(this.roofs); if (z > 1) { g.strokeStyle = mix('#0a0a0a', '#4a4036', LB2); g.lineWidth = 0.3; g.stroke(this.houses); g.stroke(this.roofs); } }
    if (this.stone && z > 0.3) { g.fillStyle = mix('#4d4c49', P.granite, L); g.fill(this.stone); }
    this.drawKpp(g, z, L);
    // очередь
    const sIv = w.road.visible(vx0, vy0, vx1, vy1, 40);
    this.drawSellers(g, z, L, sIv);
    this.drawCars(g, z, L, sIv, dark);
    this.drawPeds(g, z, L, sIv);
    this.drawAgents(g, z, L, sIv);
    this.drawPlayer(g, z);
    // ночь: карта света поверх
    if (dark > 0.05) this.drawNight(g, dark, sIv, z);
    // экранные подписи и погода
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(g, z, L);
    this.drawWeather(g, dtReal);
  }
  carPose(car, out = {}) {
    const q = this.w.road.at(car.s, LANE_OFF[car.lane] ?? 0, out);
    return q;
  }
  drawKpp(g, z, L) {
    const r = this.w.road, P = this.P, gs = this.w.queue.gateS;
    const a = r.at(0, 0), b = r.at(gs + 10, 0);
    if (z < 0.05) return;
    g.save(); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2); g.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    g.fillStyle = mix('#3f423f', '#9c9a90', L); g.fillRect(-len / 2 - 60, -26, len + 60, 52); // площадка
    g.fillStyle = mix('#7d8387', P.canopy, L); g.fillRect(-len / 2 - 40, -22, len * 0.8, 44); // навес
    g.strokeStyle = mix('#555', '#aab', L); g.lineWidth = 0.5; for (let k = -18; k <= 18; k += 7) { g.beginPath(); g.moveTo(-len / 2 - 40, k); g.lineTo(-len / 2 - 40 + len * 0.8, k); g.stroke(); }
    g.restore();
    // шлагбаум
    const q = r.at(gs - 2, 0), n = [q.nx, q.ny];
    g.strokeStyle = P.barrier; g.lineWidth = Math.max(1, 2 / z);
    g.beginPath(); g.moveTo(q.x - n[0] * 8, q.y - n[1] * 8); g.lineTo(q.x + n[0] * 8, q.y + n[1] * 8); g.stroke();
  }
  drawSellers(g, z, L, sIv) {
    if (z < 0.2) return;
    const E = this.w.econ, v = this.view;
    for (const o of E.sellers) {
      if (o.x < v.x0 - 20 || o.x > v.x1 + 20 || o.y < v.y0 - 20 || o.y > v.y1 + 20) continue;
      const act = E.active(o);
      const r = Math.max(4, 7 / z);
      g.fillStyle = act ? (o.priceMul === 0 ? '#3f7fb3' : '#b7662f') : '#555';
      g.beginPath(); g.moveTo(o.x - r, o.y - r * 0.6); g.lineTo(o.x + r, o.y - r * 0.6); g.lineTo(o.x + r * 0.8, o.y + r * 0.6); g.lineTo(o.x - r * 0.8, o.y + r * 0.6); g.closePath(); g.fill();
      if (z > 1.2) { g.fillStyle = act ? '#f0e2c0' : '#777'; g.fillRect(o.x - r * 0.7, o.y - r * 0.55, r * 1.4, r * 0.25); }
      // толпа у прилавка (по спросу)
      if (z > 1.5 && act) {
        const n = Math.min(9, Math.round((o.demand[o.goods[0]] - 1) * 12 + (o.priceMul === 0 ? 5 : 2)));
        for (let k = 0; k < n; k++) { const a = k * 2.4, rr = 5 + (k % 3) * 1.6; this.person(g, o.x + Math.cos(a) * rr - (o.x - this.w.road.at(o.s, 0).x) * 0.25, o.y + Math.sin(a) * rr - (o.y - this.w.road.at(o.s, 0).y) * 0.25, hash01(k, o.s), L); }
      }
    }
  }
  drawCars(g, z, L, sIv, dark) {
    const Q = this.w.queue, a = Q.cars, CARS = this.w.C.CARS, q = {};
    const pc = this.w.pcar;
    if (z < 0.22) { this.drawRibbon(g, z, dark, sIv); return; }
    if (z < 0.6) {
      // далеко: точки, цвет — настроение машины (спокойно → тревожно)
      const s = Math.max(1.6 / z, 3);
      const buckets = [[], [], [], []];
      for (const [s0, s1] of sIv) for (let i = Q.lowerBound(s0); i < a.length && a[i].s <= s1; i++) {
        const c = a[i]; const k = c.ne > 60 ? 0 : c.ne > 40 ? 1 : c.ne > 22 ? 2 : 3; buckets[k].push(c);
      }
      const cols = ['#9fe36b', '#e8d36a', '#f0923e', '#e25a4f'];
      buckets.forEach((b, k) => { g.fillStyle = dark > 0.6 ? '#d9261c' : cols[k]; g.beginPath(); for (const c of b) { this.carPose(c, q); g.rect(q.x - s / 2, q.y - s / 2, s, s); } g.fill(); });
      return;
    }
    const detail = z > 2.2;
    for (const [s0, s1] of sIv) for (let i = Q.lowerBound(s0 - 10); i < a.length && a[i].s <= s1 + 10; i++) {
      const c = a[i], m = CARS.models[c.mi] || CARS.models[0];
      this.carPose(c, q);
      const ang = Math.atan2(q.ny, q.nx); // локальная +y (нос) — к КПП
      g.save(); g.translate(q.x, q.y); g.rotate(ang);
      const hw = m.w / 2, hl = m.l / 2, col = c.color || CARS.colors[c.ci]?.hex || '#999';
      if (!detail) { g.fillStyle = mix(shade(col, 0.35), col, L); g.fillRect(-hw, -hl, m.w, m.l); }
      else {
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-hw + 0.25, -hl + 0.35, m.w, m.l); // тень
        g.fillStyle = mix(shade(col, 0.4), col, L); roundRect(g, -hw, -hl, m.w, m.l, 0.5); g.fill();
        g.fillStyle = mix('#0d1116', '#26323c', L); g.fillRect(-hw + 0.2, hl - m.l * 0.36, m.w - 0.4, m.l * 0.14); // лобовое (нос к КПП = +y)
        g.fillRect(-hw + 0.25, -hl + m.l * 0.12, m.w - 0.5, m.l * 0.1);
        g.fillStyle = mix(shade(col, 0.3), lighten(col, 0.12), L); g.fillRect(-hw + 0.25, -hl + m.l * 0.24, m.w - 0.5, m.l * 0.36); // крыша
        if (m.name === 'Газель' || m.seats >= 7) { g.fillStyle = 'rgba(40,30,20,0.6)'; g.fillRect(-hw + 0.3, -hl + 0.6, m.w - 0.6, m.l * 0.45); } // багаж на крыше
        if (c.npc || c.pl) { g.strokeStyle = c.pl ? '#ffd27a' : '#8cc3e6'; g.lineWidth = 0.35; roundRect(g, -hw - 0.4, -hl - 0.4, m.w + 0.8, m.l + 0.8, 0.8); g.stroke(); }
      }
      g.restore();
    }
  }
  // очень далеко: очередь одной лентой — ширина по плотности, цвет по настроению (ночью — красные огни)
  drawRibbon(g, z, dark, sIv) {
    const Q = this.w.queue, a = Q.cars, r = this.w.road, B = 100, n = Math.ceil(r.len / B) + 1;
    const cnt = this.rbC || (this.rbC = new Float32Array(n)), ne = this.rbN || (this.rbN = new Float32Array(n));
    cnt.fill(0); ne.fill(0);
    for (const c of a) { if (c.s > r.len) break; const b = Math.floor(c.s / B); cnt[b]++; ne[b] += c.ne; }
    const cap = B / Q.spacing * 2, px = 1 / z;
    g.lineCap = 'butt';
    const col = ['#9fe36b', '#e8d36a', '#f0923e', '#e25a4f'];
    for (let b = 0; b < n - 1; b++) {
      if (!cnt[b]) continue;
      const v = Math.min(1, cnt[b] / cap), m = ne[b] / cnt[b], k = m > 60 ? 0 : m > 40 ? 1 : m > 22 ? 2 : 3;
      const i0 = r.idx(b * B), i1 = r.idx(Math.min(r.len, (b + 1) * B));
      g.strokeStyle = dark > 0.6 ? 'rgba(235,50,35,' + (0.5 + v * 0.5) + ')' : col[k]; g.lineWidth = (2 + v * 5) * px;
      g.beginPath(); g.moveTo(r.X[i0], r.Y[i0]); g.lineTo(r.X[i1], r.Y[i1]); g.stroke();
    }
    g.lineCap = 'round';
  }
  drawPeds(g, z, L, sIv) {
    const Q = this.w.queue, r = this.w.road, q = {};
    const vs = (s) => sIv.some(([a, b]) => s >= a - 10 && s <= b + 10);
    const size = Math.max(0.8, 1.6 / z);
    g.fillStyle = mix('#8a8f99', '#2d3a4a', L);
    for (const p of Q.peds) {
      if (!vs(p.s)) continue;
      const wob = p.st === 0 ? Math.sin(this.time * 3 + p.ph) * 0.3 : Math.sin(this.time * 0.7 + p.ph) * 0.8;
      r.at(p.s, p.lat + wob, q);
      if (z > 1.5) this.person(g, q.x, q.y, hash01(p.id, 1), L, p.bike);
      else { g.beginPath(); g.arc(q.x, q.y, size, 0, TAU); g.fill(); }
    }
    // именные пешие (Кирилл, Сослан)
    for (const id in this.w.npcs) {
      const d = this.w.npcDefs.get(id); if (d.kind !== 'walker' || !this.w.npcPresent(id) || this.w.npcs[id].passenger) continue;
      const p = this.w.npcPos(id); if (!p) continue;
      this.person(g, p.x, p.y, 0.3, L, d.id === 'soslan' ? 2 : 0, '#8cc3e6');
    }
  }
  // человек сверху: голова и плечи; bike 1 — велосипед, 2 — мотоцикл
  person(g, x, y, h, L, bike = 0, ring = null) {
    const k = Math.max(1, 3.2 / (0.4 * this.cam.z));
    const coat = ['#3c4a5c', '#6b3b2a', '#2f4d3a', '#555', '#8a6a3a', '#27313f', '#7a2f2f'][Math.floor(h * 7)];
    if (bike) { g.strokeStyle = bike === 2 ? '#222' : '#444'; g.lineWidth = 0.25 * k; g.beginPath(); g.moveTo(x, y - 0.9 * k); g.lineTo(x, y + 0.9 * k); g.stroke(); }
    g.fillStyle = mix(shade(coat, 0.4), coat, L); g.beginPath(); g.ellipse(x, y, 0.36 * k, 0.26 * k, 0, 0, TAU); g.fill();
    g.fillStyle = mix('#3a2e25', '#c9a27e', L * 0.9); g.beginPath(); g.arc(x, y, 0.15 * k, 0, TAU); g.fill();
    if (ring) { g.strokeStyle = ring; g.lineWidth = 0.14 * k; g.beginPath(); g.arc(x, y, 0.6 * k, 0, TAU); g.stroke(); }
  }
  // люди у машин: без состояния — положение из (время, хеш машины), только рядом с камерой
  drawAgents(g, z, L, sIv) {
    this.agents.length = 0;
    if (z < 1.6) return;
    const Q = this.w.queue, a = Q.cars, r = this.w.road, q = {}, h = this.w.clock.hour, night = this.w.env.night();
    const max = this.q.agents; let n = 0;
    const outShare = night ? 0.12 : 0.35;
    const cx = this.cam.x, cy = this.cam.y;
    for (const [s0, s1] of sIv) for (let i = Q.lowerBound(s0); i < a.length && a[i].s <= s1 && n < max; i++) {
      const c = a[i]; if (c.pl) continue;
      for (let k = 0; k < Math.min(2, c.n); k++) {
        const hh = hash01(c.id, k + 21); if (hh > outShare) continue;
        const mode = hash01(c.id, k + 31);
        const side = c.lane ? 1 : -1, base = LANE_OFF[c.lane];
        let s = c.s, off = base + side * (2.2 + k * 0.7), bike = 0;
        if (mode < 0.55) { // стоит у машины, переминается
          off += Math.sin(this.time * 0.8 + hh * 50) * 0.25; s += (k - 0.5) * 1.6;
        } else { // ходит вдоль ряда: к соседям и обратно (треугольная волна)
          const per = 18 + mode * 40, ph = ((this.time / per + hh * 7) % 1), tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
          const reach = (mode - 0.55) * 160 * (hash01(c.id, 41) < 0.5 ? -1 : 1);
          s += reach * tri; off = side * (4.8 + hash01(c.id, k) * 1.5);
        }
        r.at(s, off, q);
        if (Math.abs(q.x - cx) > this.W / z || Math.abs(q.y - cy) > this.H / z) continue;
        this.person(g, q.x, q.y, hash01(c.id, k + 3), L, bike);
        this.agents.push({ x: q.x, y: q.y, car: c, seat: k }); n++;
      }
    }
  }
  drawPlayer(g, z) {
    const w = this.w, p = w.player; if (!p) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    if (!p.inCar) {
      this.person(g, p.x, p.y, 0.9, 1, 0, '#ffd27a');
      if (p.tx != null) { g.strokeStyle = 'rgba(255,210,122,0.7)'; g.setLineDash([1, 1.2]); g.lineWidth = 0.25; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.tx, p.ty); g.stroke(); g.setLineDash([]); }
    }
    // метка игрока видна на любом масштабе
    const rr = Math.max(3.5, (14 + pulse * 4) / z);
    g.strokeStyle = 'rgba(255,210,122,' + (0.5 + pulse * 0.4) + ')'; g.lineWidth = Math.max(0.3, 2.2 / z);
    g.beginPath(); g.arc(p.x, p.y, rr, 0, TAU); g.stroke();
    if (this.sel) {
      const s = this.selPos(); if (s) { g.strokeStyle = '#8cc3e6'; g.lineWidth = Math.max(0.3, 2 / z); g.setLineDash([Math.max(0.6, 4 / z), Math.max(0.6, 3 / z)]); g.beginPath(); g.arc(s.x, s.y, Math.max(3.2, 12 / z), 0, TAU); g.stroke(); g.setLineDash([]); }
    }
  }
  selPos() {
    const t = this.sel, w = this.w; if (!t) return null;
    if (t.car) return this.carPose(t.car);
    if (t.seller) return { x: t.seller.x, y: t.seller.y };
    if (t.npc && w.npcDefs.has(t.npc)) return w.npcPos(t.npc);
    if (t.ped) return w.road.at(t.ped.s, t.ped.lat);
    if (t.pos) return t.pos;
    return null;
  }
  // ночь: тёмная карта с «дырками» света + аддитивные огни
  drawNight(g, dark, sIv, z) {
    const lg = this.lg, LW = this.light.width, LH = this.light.height, W = this.W, H = this.H, c = this.cam, P = this.P;
    const k = LW / W;
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = `rgba(6,10,26,${Math.min(0.55, dark * 0.55)})`; lg.clearRect(0, 0, LW, LH); lg.fillRect(0, 0, LW, LH);
    lg.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const sx = ((x - c.x) * c.z + W / 2) * k, sy = ((y - c.y) * c.z + H / 2) * k, rr = r * c.z * k;
      if (sx < -rr || sy < -rr || sx > LW + rr || sy > LH + rr || rr < 0.5) return;
      const gr = lg.createRadialGradient(sx, sy, 0, sx, sy, rr); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = gr; lg.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    };
    // КПП — самое яркое пятно на 30 км
    const kp = this.w.road.at(20, 0); hole(kp.x, kp.y, 160, 1);
    // лампы у продавцов, в домах
    for (const o of this.w.econ.sellers) if (this.w.econ.active(o)) hole(o.x, o.y, 22, 0.85);
    for (const m of this.placeMarks) if (m.pl.houses) hole(m.x, m.y, 90 + m.pl.houses * 2, 0.35);
    // фары заведённых машин (рядом с камерой)
    const Q = this.w.queue, a = Q.cars, q = {};
    if (z > 0.6 && this.q.glow) for (const [s0, s1] of sIv) for (let i = Q.lowerBound(s0); i < a.length && a[i].s <= s1; i++) {
      const cc = a[i]; if (!cc.eng && !cc.pl) continue; this.carPose(cc, q); hole(q.x - q.ny * 5, q.y + q.nx * 5, 10, 0.6);
    }
    const p = this.w.player; if (p) hole(p.x, p.y, 14, 0.7);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.light, 0, 0, this.cv.width, this.cv.height);
    // аддитивные огни: стоп-сигналы «красной лентой», LED КПП
    const dpr = this.dpr;
    g.setTransform(dpr * c.z, 0, 0, dpr * c.z, dpr * (W / 2 - c.x * c.z), dpr * (H / 2 - c.y * c.z));
    g.globalCompositeOperation = 'lighter';
    const sz = Math.max(0.4, 2.4 / c.z);
    g.fillStyle = `rgba(217,38,28,${0.35 + dark * 0.5})`;
    g.beginPath();
    for (const [s0, s1] of sIv) for (let i = Q.lowerBound(s0); i < a.length && a[i].s <= s1; i++) {
      const cc = a[i]; this.carPose(cc, q);
      const m = this.w.C.CARS.models[cc.mi], hl = (m?.l || 4.4) / 2;
      // задние фонари: сзади машины (к хвосту = −нос)
      const bx = q.x - q.ny * hl * -1, by = q.y + q.nx * hl * -1;
      if (c.z > 3) { g.rect(bx + q.nx * 0.6 - sz / 2, by + q.ny * 0.6 - sz / 2, sz, sz); g.rect(bx - q.nx * 0.6 - sz / 2, by - q.ny * 0.6 - sz / 2, sz, sz); }
      else g.rect(bx - sz / 2, by - sz / 2, sz, sz);
    }
    g.fill();
    if (this.q.glow && c.z < 3) { g.fillStyle = `rgba(217,38,28,${0.12 * dark})`; g.beginPath(); for (const [s0, s1] of sIv) for (let i = Q.lowerBound(s0); i < a.length && a[i].s <= s1; i += 2) { this.carPose(a[i], q); g.rect(q.x - sz * 1.6, q.y - sz * 1.6, sz * 3.2, sz * 3.2); } g.fill(); }
    g.fillStyle = `rgba(232,241,255,${0.25 * dark})`; g.beginPath(); g.arc(kp.x, kp.y, 30, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  drawLabels(g, z, L) {
    const w = this.w, W = this.W, H = this.H;
    g.font = '600 12px system-ui, sans-serif'; g.textBaseline = 'middle';
    // места
    for (const m of this.placeMarks) {
      if (z < 0.05 && m.pl.kind !== 'checkpoint' && m.pl.kind !== 'village') continue;
      if (z < 0.5 && !['checkpoint', 'village', 'police'].includes(m.pl.kind)) continue;
      const q = this.toScreen(m.x, m.y); if (q.x < -100 || q.x > W + 100 || q.y < -20 || q.y > H + 20) continue;
      const side = m.pl.side, lx = q.x + side * Math.max(28, 90 * Math.min(1, z * 2)), ly = q.y;
      g.fillStyle = 'rgba(17,22,20,0.75)'; const tw = g.measureText(m.pl.name).width;
      const bx = side > 0 ? lx : lx - tw - 26; g.fillRect(bx, ly - 10, tw + 26, 20);
      drawIcon(g, m.pl.icon, bx + 11, ly, 14, '#ffd27a', 2);
      g.fillStyle = '#ebe6d3'; g.fillText(m.pl.name, bx + 21, ly);
    }
    // км до КПП вдоль дороги
    const step = z < 0.08 ? 5000 : z < 0.3 ? 2000 : z < 1 ? 1000 : 500;
    g.font = '11px ui-monospace, monospace';
    for (let s = step; s < w.road.len; s += step) {
      const a = w.road.at(s, -24); const q = this.toScreen(a.x, a.y); if (q.x < 0 || q.x > W || q.y < 0 || q.y > H) continue;
      g.fillStyle = 'rgba(17,22,20,0.6)'; g.fillRect(q.x - 22, q.y - 8, 44, 16); g.fillStyle = '#b6c9df'; g.textAlign = 'center'; g.fillText((s / 1000).toFixed(s % 1000 ? 1 : 0).replace('.', ',') + ' км', q.x, q.y); g.textAlign = 'left';
    }
    // именные люди — значок с именем
    if (z > 1) for (const id in w.npcs) {
      if (!w.npcPresent(id) || w.npcs[id].passenger) continue;
      const p = w.npcPos(id); if (!p) continue; const q = this.toScreen(p.x, p.y); if (q.x < -40 || q.x > W + 40 || q.y < -40 || q.y > H + 40) continue;
      const d = w.npcDefs.get(id); g.font = '600 11px system-ui, sans-serif';
      const tw = g.measureText(d.name).width; g.fillStyle = 'rgba(17,22,20,0.8)'; g.fillRect(q.x - tw / 2 - 12, q.y - 30, tw + 24, 18);
      drawIcon(g, d.icon, q.x - tw / 2 - 3, q.y - 21, 12, '#8cc3e6', 2); g.fillStyle = '#ebe6d3'; g.fillText(d.name, q.x - tw / 2 + 6, q.y - 21);
    }
    // игрок за краем экрана — стрелка
    const p = w.player; if (p) { const q = this.toScreen(p.x, p.y); if (q.x < 0 || q.x > W || q.y < 0 || q.y > H) { const cx = clamp(q.x, 24, W - 24), cy = clamp(q.y, 24, H - 24); g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(cx, cy, 9, 0, TAU); g.fill(); drawIcon(g, 'car', cx, cy, 12, '#1a0f06', 2.4); } }
  }
  drawWeather(g, dt) {
    const w = this.w.env.weather(), W = this.W, H = this.H;
    if (w === 'rain' || w === 'storm' || w === 'drizzle') {
      const n = w === 'storm' ? 140 : w === 'rain' ? 90 : 40, t = this.time;
      g.strokeStyle = 'rgba(200,215,230,0.35)'; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < n; i++) { const x = (hash01(i, 1) * W + t * 60) % W, y = (hash01(i, 2) * H + t * 700 * (0.6 + hash01(i, 3) * 0.6)) % H; g.moveTo(x, y); g.lineTo(x - 3, y + 12); }
      g.stroke();
    }
    if (w === 'drizzle' || w === 'cloud') { g.fillStyle = 'rgba(180,190,200,0.06)'; g.fillRect(0, 0, W, H); }
  }

  // ─────────── выбор мышью / пальцем ───────────
  pick(sx, sy) {
    const w = this.w, p = this.toWorld(sx, sy), z = this.cam.z, tol = Math.max(3, 16 / z);
    let best = null, bd = tol;
    const test = (x, y, tg, bonus = 0) => { const d = Math.hypot(x - p.x, y - p.y) - bonus; if (d < bd) { bd = d; best = tg; } };
    // люди
    for (const a of this.agents) test(a.x, a.y, { kind: 'person', who: w.person(a.car.id, a.seat + 1), car: a.car }, 0.5);
    for (const id in w.npcs) { const d = w.npcDefs.get(id); if (!w.npcPresent(id) || w.npcs[id].passenger) continue; const q = w.npcPos(id); if (!q) continue;
      const kind = d.kind === 'seller' ? 'seller' : d.kind === 'driver' ? 'car' : 'person';
      const tg = { kind, npc: id }; if (kind === 'seller') tg.seller = w.econ.sellers.find(o => o.npc === id); if (kind === 'car') tg.car = w.npcCar(id);
      test(q.x, q.y, tg, 1.5); }
    if (z > 0.6) for (const q of w.queue.peds) { const a = w.road.at(q.s, q.lat); test(a.x, a.y, { kind: 'person', ped: q, who: w.pedPerson(q) }); }
    if (w.player && !w.player.inCar) test(w.player.x, w.player.y, { kind: 'self' }, 1);
    for (const o of w.econ.sellers) test(o.x, o.y, { kind: 'seller', seller: o, npc: o.npc }, 1);
    // машины рядом с точкой
    const pr = w.road.project(p.x, p.y);
    if (pr.d < 30) {
      const Q = w.queue, a = Q.cars;
      for (let i = Q.lowerBound(pr.s - 12); i < a.length && a[i].s <= pr.s + 12; i++) {
        const c = a[i], q = this.carPose(c);
        test(q.x, q.y, c.pl ? { kind: 'own', car: c } : { kind: 'car', car: c, npc: c.npc || 'c:' + c.id + ':0', who: c.npc ? null : w.person(c.id, 0) });
      }
    }
    if (!best) return { kind: 'ground', pos: p };
    return best;
  }
}

// ─────────── цвет ───────────
const CC = new Map();
function rgb(h) { let v = CC.get(h); if (!v) { const n = parseInt(h.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; CC.set(h, v); } return v; }
function mix(a, b, t) { const A = rgb(a), B = rgb(b); t = clamp(t, 0, 1); return `rgb(${A[0] + (B[0] - A[0]) * t | 0},${A[1] + (B[1] - A[1]) * t | 0},${A[2] + (B[2] - A[2]) * t | 0})`; }
function shade(h, k) { const A = rgb(h); return '#' + A.map(v => Math.round(v * k).toString(16).padStart(2, '0')).join(''); }
function lighten(h, k) { const A = rgb(h); return '#' + A.map(v => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join(''); }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); }
return { View, mix };
});
