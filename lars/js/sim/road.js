// Геометрия дороги: ось по данным ROUTE → равномерная полилиния (шаг STEP м), нормали, Терек, ширина ущелья.
// Координата s — метры вдоль дороги от КПП (0) к хвосту. Мир: метры, x — восток, y — вниз (юг). Север — вверху.
// N(s) — нормаль «на восток» (к правой руке смотрящего на север). Очередь едет к КПП (на юг) по правой полосе:
// правая сторона по ходу движения = запад = −N.
'use strict';
L.def('sim/road', () => {
const { clamp, lerp } = L.use('core');

const STEP = 4; // м

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
    return { s: bi * STEP, off, d: Math.sqrt(best) };
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
