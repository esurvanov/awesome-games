// Геометрия дороги: ось по данным ROUTE → равномерная полилиния (шаг STEP м), нормали, Терек, ширина ущелья.
// Координата s — метры вдоль дороги от КПП (0) к хвосту. Мир: метры, x — восток, y — вниз (юг). Север — вверху.
// N(s) — нормаль «на восток» (к правой руке смотрящего на север). Очередь едет к КПП (на юг) по правой полосе:
// правая сторона по ходу движения = запад = −N.
'use strict';
L.def('sim/road', () => {
const { clamp, lerp } = L.use('core');

const STEP = 4; // м
// «можно ли тут стоять» — единая проверка для ходьбы (fp.js), авто-подхода к машине (world.js) и клика по
// карте (view.js/main.js): раньше каждый решал сам и не знал про мосты/КПП/хвост (audit 3-spatial.md, причина 1)
const RIVER_HALF = 11;   // м: полуширина «в реке» от оси Терека (как было в fp.js)
const CLIFF_PAD = 45;    // м: сколько ещё разрешено от края дна ущелья (GW/GE) вверх по склону/осыпи
// половина длины мостового коридора вдоль дороги: больше видимого полотна scene.js (±26 м), чтобы у самого
// въезда на мост (особенно на крайних полосах, ±5,4 м) не попасть в узкую необработанную полоску реки —
// на самом мосту (по центру) разница не видна, а на подходе по обочине лишние метры реки — не крюк
const BRIDGE_LEN = 40;
const BRIDGE_HALF = 6;   // м: половина ширины мостового полотна поперёк (обе полосы + отбойники)
const GATE_PAD = 20;     // м: за шлагбаумом КПП (s < −GATE_PAD) — уже Грузия, пешком не пройти (finding 10)
const TAIL_PAD = 50;     // м: за концом дороги — пустое ущелье без земли (finding 16, 18)

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
// кусочно-линейная интерполяция по таблице [{s, key}] (s в км)
function table(arr, key, sKm) {
  if (sKm <= arr[0].s) return arr[0][key];
  for (let i = 1; i < arr.length; i++) if (sKm <= arr[i].s) {
    const a = arr[i - 1], b = arr[i], t = (sKm - a.s) / (b.s - a.s);
    const k = t * t * (3 - 2 * t);
    return lerp(a[key], b[key], k);
  }
  return arr[arr.length - 1][key];
}

class Road {
  constructor(R) {
    this.R = R;
    const Lm = R.length * 1000;
    // 1) сырая ось: y = −s (север вверху), x — сплайн по точкам + изгибы
    const pts = R.points, raw = [];
    const xAt = sKm => {
      let i = 0; while (i < pts.length - 2 && sKm > pts[i + 1].s) i++;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const t = clamp((sKm - p1.s) / (p2.s - p1.s), 0, 1);
      return catmull(p0.x, p1.x, p2.x, p3.x, t) * 1000;
    };
    const w = R.wiggle;
    for (let s = 0; s <= Lm + 400; s += 10) {
      const sk = s / 1000;
      const wig = w.amp * (Math.sin(s / w.len * 6.283 + 1.3) + 0.5 * Math.sin(s / (w.len * 0.37) + 0.4) + 0.3 * Math.sin(s / (w.len * 2.7)));
      raw.push([xAt(Math.min(sk, R.length)) + wig, -s]);
    }
    // 2) равномерная полилиния по длине дуги
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const total = cum[cum.length - 1];
    const n = Math.floor(total / STEP) + 1;
    this.n = n; this.len = Math.min(Lm, total);
    this.X = new Float32Array(n); this.Y = new Float32Array(n); this.NX = new Float32Array(n); this.NY = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = i * STEP;
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      this.X[i] = lerp(raw[j][0], raw[j + 1][0], t); this.Y[i] = lerp(raw[j][1], raw[j + 1][1], t);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      let tx = this.X[b] - this.X[a], ty = this.Y[b] - this.Y[a]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      this.NX[i] = -ty; this.NY[i] = tx; // T указывает на север (к хвосту); N = (−Ty, Tx) → восток
    }
    // 2б) сглаженная ось долины (скользящее среднее ±240 м): от неё строятся дно, склоны и скалы,
    //     чтобы изгибы дороги не давали петель на больших смещениях
    this.SX = new Float32Array(n); this.SY = new Float32Array(n); this.SNX = new Float32Array(n); this.SNY = new Float32Array(n);
    { const Wn = 60; let sx = 0, sy = 0, c = 0;
      for (let i = 0; i < Math.min(n, Wn); i++) { sx += this.X[i]; sy += this.Y[i]; c++; }
      for (let i = 0; i < n; i++) {
        const add = i + Wn, rem = i - Wn - 1;
        if (add < n) { sx += this.X[add]; sy += this.Y[add]; c++; }
        if (rem >= 0) { sx -= this.X[rem]; sy -= this.Y[rem]; c--; }
        this.SX[i] = sx / c; this.SY[i] = sy / c;
      }
      for (let i = 0; i < n; i++) { const a = Math.max(0, i - 10), b = Math.min(n - 1, i + 10); let tx = this.SX[b] - this.SX[a], ty = this.SY[b] - this.SY[a]; const l = Math.hypot(tx, ty) || 1; this.SNX[i] = -ty / l; this.SNY[i] = tx / l; }
    }
    // 3) профили: Терек и ущелье (м), с шумом
    this.RIV = new Float32Array(n); this.GW = new Float32Array(n); this.GE = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const sk = i * STEP / 1000;
      this.RIV[i] = table(R.river, 'off', sk) + 8 * Math.sin(i * STEP / 90);
      const g = table(R.gorge, 'w', sk);
      this.GW[i] = g * (0.85 + 0.25 * Math.sin(i * STEP / 330 + 1) + 0.1 * Math.sin(i * STEP / 97));
      this.GE[i] = g * (0.85 + 0.25 * Math.sin(i * STEP / 410 + 4) + 0.1 * Math.sin(i * STEP / 71 + 2));
    }
    // 4) куски по 200 м — для отсечения при отрисовке и поиска ближайшей точки
    this.CH = 50; // точек в куске
    this.chunks = [];
    for (let i = 0; i < n; i += this.CH) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = i; k < Math.min(n, i + this.CH + 1); k++) {
        const pad = Math.max(this.GW[k], this.GE[k]) + 900;
        x0 = Math.min(x0, this.X[k] - pad); x1 = Math.max(x1, this.X[k] + pad); y0 = Math.min(y0, this.Y[k] - 60); y1 = Math.max(y1, this.Y[k] + 60);
      }
      this.chunks.push({ i0: i, i1: Math.min(n - 1, i + this.CH), x0, y0, x1, y1 });
    }
    // 5) мосты: там, где ось Терека (RIV) пересекает дорогу (меняет знак) — та же логика, что строит
    //    геометрию мостов в render/scene.js (buildBridges), на тех же данных (this.RIV) → одно место истины
    this.bridges = [];
    for (let i = 10; i < n - 10; i++) {
      if (Math.sign(this.RIV[i]) === Math.sign(this.RIV[i + 1])) continue;
      const s = i * STEP;
      this.bridges.push({ s, s0: s - BRIDGE_LEN, s1: s + BRIDGE_LEN, half: BRIDGE_HALF });
      i += 20;
    }
  }
  idx(s) { return clamp(Math.round(s / STEP), 0, this.n - 1); }
  // точка на оси + смещение off по нормали (м)
  at(s, off = 0, out = {}) {
    const f = clamp(s / STEP, 0, this.n - 1.001), i = Math.floor(f), t = f - i;
    const nx = lerp(this.NX[i], this.NX[i + 1], t), ny = lerp(this.NY[i], this.NY[i + 1], t);
    out.x = lerp(this.X[i], this.X[i + 1], t) + nx * off; out.y = lerp(this.Y[i], this.Y[i + 1], t) + ny * off;
    out.nx = nx; out.ny = ny; out.ang = Math.atan2(nx, -ny); // угол «на север» по оси (для машин)
    return out;
  }
  river(s) { return this.RIV[this.idx(s)]; }
  gorge(s) { const i = this.idx(s); return [this.GW[i], this.GE[i]]; }
  // ближайшая точка оси к (x, y): { s, off } (off — по нормали)
  project(x, y) {
    let best = 1e18, bi = 0;
    for (const c of this.chunks) {
      if (x < c.x0 - 200 || x > c.x1 + 200 || y < c.y0 - 1500 || y > c.y1 + 1500) continue;
      for (let i = c.i0; i <= c.i1; i += 2) { const d = (this.X[i] - x) ** 2 + (this.Y[i] - y) ** 2; if (d < best) { best = d; bi = i; } }
    }
    for (let i = Math.max(0, bi - 3); i <= Math.min(this.n - 1, bi + 3); i++) { const d = (this.X[i] - x) ** 2 + (this.Y[i] - y) ** 2; if (d < best) { best = d; bi = i; } }
    const off = (x - this.X[bi]) * this.NX[bi] + (y - this.Y[bi]) * this.NY[bi];
    let s = bi * STEP;
    // за концами дороги (КПП и хвост) — продолжаем s по касательной вместо того, чтобы прилипать к 0/len:
    // иначе walkable() никогда не увидит «уже за шлагбаумом» или «уже за пустым хвостом» (findings 10, 16, 18)
    if (bi === 0) { const tx = this.NY[0], ty = -this.NX[0], along = (x - this.X[0]) * tx + (y - this.Y[0]) * ty; if (along < 0) s = along; }
    else if (bi === this.n - 1) { const tx = this.NY[bi], ty = -this.NX[bi], along = (x - this.X[bi]) * tx + (y - this.Y[bi]) * ty; if (along > 0) s = bi * STEP + along; }
    return { s, off, d: Math.sqrt(best) };
  }
  onBridge(s, off) {
    for (const b of this.bridges) if (s >= b.s0 && s <= b.s1 && Math.abs(off) <= b.half) return true;
    return false;
  }
  // можно ли стоять/идти в точке мира (x, y)? Одна проверка на всех: река (кроме мостов — коридор поперёк),
  // склоны/скалы за пределами дна ущелья, КПП насквозь и пустой хвост за концом дороги.
  // Только «входит ли точка НАЗНАЧЕНИЯ» — вызывающий код сам решает не блокировать выход из уже плохой точки
  // (finding 9: ловушка в реке — см. fp.js moveTo).
  walkable(x, y) {
    const { s, off } = this.project(x, y);
    if (s < -GATE_PAD || s > this.len + TAIL_PAD) return false;
    if (this.onBridge(s, off)) return true;
    const i = this.idx(clamp(s, 0, this.len));
    if (Math.abs(off - this.RIV[i]) < RIVER_HALF) return false;
    if (off < -this.GW[i] - CLIFF_PAD || off > this.GE[i] + CLIFF_PAD) return false;
    return true;
  }
  // ближайшая проходимая точка на отрезке (x0,y0)→(x1,y1) — для клика по карте и любого «иди туда, куда
  // указали»: если конец недоступен, обрезаем путь до последней проходимой точки, а не отменяем ходьбу
  // целиком; если сам игрок уже стоит не там (ловушка — finding 9), не запираем его — пусть идёт, куда велели,
  // а дальше шаг за шагом контролирует уже сам вызывающий (fp.js moveTo).
  walkableTarget(x0, y0, x1, y1) {
    if (!this.walkable(x0, y0)) return { x: x1, y: y1 };
    if (this.walkable(x1, y1)) return { x: x1, y: y1 };
    let lo = 0, hi = 1, ok = false;
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (this.walkable(x, y)) { lo = t; ok = true; } else hi = t;
    }
    return ok ? { x: x0 + (x1 - x0) * lo, y: y0 + (y1 - y0) * lo } : null;
  }
  // интервалы s (м), чьи куски пересекают прямоугольник вида
  visible(x0, y0, x1, y1, pad = 0) {
    const out = [];
    for (const c of this.chunks) {
      if (c.x1 < x0 - pad || c.x0 > x1 + pad || c.y1 < y0 - pad || c.y0 > y1 + pad) continue;
      const a = c.i0 * STEP, b = c.i1 * STEP;
      if (out.length && Math.abs(out[out.length - 1][1] - a) < STEP * 2) out[out.length - 1][1] = b; else out.push([a, b]);
    }
    return out;
  }
}
const ROAD_STEP = STEP;
return { Road, ROAD_STEP };
});
