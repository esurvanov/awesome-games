// Рельеф Дарьяльского ущелья вдоль дороги: продлённая ось (за КПП и за хвост), высоты по профилю ROUTE.elev,
// поперечный разрез (дно, Терек в русле, осыпь, стены до 1 км), сетка кусками по 256 м (ближний и дальний LOD),
// лента дороги (текстура), лента реки, места для деревьев. Всё детерминировано (хеш), без файлов.
// Высота мира Y — метры над КПП. Разрез строится от сглаженной оси долины (нет петель на больших смещениях).
// Вершины куска хранятся от его начала org (целые метры): float32 у вершин точен до долей мм, сдвиг «кусок − камера»
// считает view3d в double. Края куска — «юбки» вниз: ближний и дальний LOD стыкуются без щелей.
'use strict';
L.def('render/terrain', () => {
const { clamp, lerp, smooth, hash01 } = L.use('core');
const { hex } = L.use('render/gl');

const STEP = 4, PRE = 300, POST = 500, CH = 64, ROWN = 2, ROWF = 8;
const ECOL = [0, 5, 12, 22, 35, 52, 75, 105, 145, 195, 260, 340, 440, 570, 740, 960, 1250, 1650, 2200, 3000];
const NFLOOR = 34;

function table(arr, key, sKm) {
  if (sKm <= arr[0].s) return arr[0][key];
  for (let i = 1; i < arr.length; i++) if (sKm <= arr[i].s) { const a = arr[i - 1], b = arr[i], t = (sKm - a.s) / (b.s - a.s); return lerp(a[key], b[key], t * t * (3 - 2 * t)); }
  return arr[arr.length - 1][key];
}
// гладкий шум значений (2D)
function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash01(xi * 7919 + yi, seed), b = hash01((xi + 1) * 7919 + yi, seed), c = hash01(xi * 7919 + yi + 1, seed), d = hash01((xi + 1) * 7919 + yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, seed, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 13); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }

class Terrain {
  constructor(road, ROUTE) {
    this.road = road; this.R = ROUTE;
    const n = road.n, N = this.N = PRE + n + POST;
    const X = this.X = new Float32Array(N), Y = this.Y = new Float32Array(N), NX = this.NX = new Float32Array(N), NY = this.NY = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const j = i - PRE;
      if (j >= 0 && j < n) { X[i] = road.X[j]; Y[i] = road.Y[j]; NX[i] = road.NX[j]; NY[i] = road.NY[j]; continue; }
      const k = j < 0 ? 0 : n - 1, d = (j - k) * STEP, tx = road.NY[k], ty = -road.NX[k];
      X[i] = road.X[k] + tx * d; Y[i] = road.Y[k] + ty * d; NX[i] = road.NX[k]; NY[i] = road.NY[k];
    }
    // сглаженная ось (±240 м)
    const SX = this.SX = new Float32Array(N), SY = this.SY = new Float32Array(N), SNX = this.SNX = new Float32Array(N), SNY = this.SNY = new Float32Array(N);
    { const W = 60; let sx = 0, sy = 0, c = 0;
      for (let i = 0; i < Math.min(N, W); i++) { sx += X[i]; sy += Y[i]; c++; }
      for (let i = 0; i < N; i++) { const a = i + W, r = i - W - 1; if (a < N) { sx += X[a]; sy += Y[a]; c++; } if (r >= 0) { sx -= X[r]; sy -= Y[r]; c--; } SX[i] = sx / c; SY[i] = sy / c; }
      for (let i = 0; i < N; i++) { const a = Math.max(0, i - 10), b = Math.min(N - 1, i + 10); let tx = SX[b] - SX[a], ty = SY[b] - SY[a]; const l = Math.hypot(tx, ty) || 1; SNX[i] = -ty / l; SNY[i] = tx / l; } }
    // профили
    const RIV = this.RIV = new Float32Array(N), GW = this.GW = new Float32Array(N), GE = this.GE = new Float32Array(N), DEV = this.DEV = new Float32Array(N), E = this.E = new Float32Array(N);
    const HW = this.HW = new Float32Array(N), HE = this.HE = new Float32Array(N), LAM = this.LAM = new Float32Array(N);
    const elev = ROUTE.elev, k0 = ROUTE.elevKmAtKpp ?? 31.2;
    const elevAt = sKm => { const km = clamp(k0 - sKm, 0, elev.length - 1.001), i = Math.floor(km); return lerp(elev[i], elev[i + 1], km - i); };
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = (i - PRE) * STEP, sk = s / 1000;
      RIV[i] = table(ROUTE.river, 'off', sk) + 8 * Math.sin(s / 90);
      const g = table(ROUTE.gorge, 'w', sk);
      GW[i] = g * (0.85 + 0.25 * Math.sin(s / 330 + 1) + 0.1 * Math.sin(s / 97));
      GE[i] = g * (0.85 + 0.25 * Math.sin(s / 410 + 4) + 0.1 * Math.sin(s / 71 + 2));
      if (s < 60) { const k = smooth(60, -120, s); GW[i] = lerp(GW[i], 88, k); GE[i] = lerp(GE[i], 150, k); RIV[i] = lerp(RIV[i], 118, k); }
      DEV[i] = (X[i] - SX[i]) * SNX[i] + (Y[i] - SY[i]) * SNY[i];
      raw[i] = elevAt(sk);
      const w3 = ROUTE.walls || [];
      HW[i] = w3.length ? table(w3, 'w', sk) : 700; HE[i] = w3.length ? table(w3, 'e', sk) : 700; LAM[i] = w3.length ? table(w3, 'lam', sk) : 250;
    }
    // высота дороги: сглаженный профиль (3 прохода окна ±600 м), ноль — у КПП
    let a = raw;
    for (let pass = 0; pass < 3; pass++) { const b = new Float32Array(N), W = 150; let sum = 0, c = 0; for (let i = 0; i < Math.min(N, W); i++) { sum += a[i]; c++; }
      for (let i = 0; i < N; i++) { const ad = i + W, r = i - W - 1; if (ad < N) { sum += a[ad]; c++; } if (r >= 0) { sum -= a[r]; c--; } b[i] = sum / c; } a = b; }
    const z0 = a[PRE];
    for (let i = 0; i < N; i++) E[i] = a[i] - z0;
    this.P = ROUTE.palette;
    this.cFloor = hex(this.P.floor); this.cForest = hex(this.P.forest); this.cAutumn = hex(this.P.forestAutumn); this.cRock = hex(this.P.granite); this.cGravel = hex('#716a5b'); this.cBed = hex('#7d7c74');
    this.flat = []; // площадки (КПП, посёлки): { s0, s1, o0, o1 } в кадре дороги → дно ровное
  }
  sOf(i) { return (i - PRE) * STEP; }
  iOf(s) { return s / STEP + PRE; }
  // точка дороги с продлением: s — м от КПП (может быть < 0 и > длины), off — по нормали
  at(s, off = 0, out = {}) {
    const f = clamp(s / STEP + PRE, 0, this.N - 1.001), i = Math.floor(f), t = f - i;
    const nx = lerp(this.NX[i], this.NX[i + 1], t), ny = lerp(this.NY[i], this.NY[i + 1], t);
    out.x = lerp(this.X[i], this.X[i + 1], t) + nx * off; out.y = lerp(this.Y[i], this.Y[i + 1], t) + ny * off;
    out.nx = nx; out.ny = ny; out.h = lerp(this.E[i], this.E[i + 1], t);
    return out;
  }
  roadH(s) { const f = clamp(s / STEP + PRE, 0, this.N - 1.001), i = Math.floor(f); return lerp(this.E[i], this.E[i + 1], f - i); }
  // высота поверхности ленты дороги (асфальт/обочина) на смещении off — как в buildRoad
  surf(s, off) {
    const a = Math.abs(off), B = this.roadH(s) + 0.08;
    if (a <= 4.3) return B;
    if (a <= 6.9) return B - 0.02 - 0.04 * (a - 4.3) / 2.6;
    return B - 0.06 - 0.39 * Math.min(1, (a - 6.9) / 1.7);
  }
  // начало координат куска k (целые метры — для точности float32)
  org(k) {
    if (!this.orgs) this.orgs = [];
    let o = this.orgs[k];
    if (!o) { const i = Math.min(this.N - 1, k * CH + CH / 2); o = this.orgs[k] = [Math.round(this.X[i]), Math.round(this.E[i]), Math.round(this.Y[i])]; }
    return o;
  }
  // края дна в кадре сглаженной оси
  edges(i) { const d = this.DEV[i]; return [Math.min(-this.GW[i], d - this.GW[i]), Math.max(this.GE[i], d + this.GE[i])]; }
  // высота рельефа в строке i (целой) при смещении o от сглаженной оси; kind для цвета
  h(i, o, out) {
    const d = this.DEV[i], B = this.E[i], s = this.sOf(i), [ow, oe] = this.edges(i), u = o - d;
    const rc = this.RIV[i] + d, rd = Math.abs(o - rc);
    let h, kind = 0;
    if (o >= ow && o <= oe) {
      const au = Math.abs(u);
      h = B - 0.25 + (fbm(s / 60, o / 60, 3, 3) - 0.45) * 2.2 * smooth(9, 45, au) + 5 * smooth(70, 0, Math.min(o - ow, oe - o));
      // плоские площадки
      for (const f of this.flat) if (s > f.s0 && s < f.s1 && u > f.o0 && u < f.o1) { h = B - 0.2 + f.dh; break; }
      if (rd < 22) { const k = smooth(22, 9, rd); h = lerp(h, B - 3.4, k); kind = 2; }
      else if (au < 11) kind = 1;
    } else {
      const side = o < ow ? -1 : 1, e = side < 0 ? ow - o : o - oe;
      const H = side < 0 ? this.HW[i] : this.HE[i], lam = this.LAM[i];
      const n1 = fbm(s / 380, e / 260 + side * 17, 11 + (side > 0 ? 5 : 0), 4);
      const talus = 16 * smooth(0, 40, e);
      const cliff = H * (0.75 + 0.5 * n1) * Math.pow(1 - Math.exp(-Math.max(0, e - 18) / lam), 1.15);
      const far = e > 1400 ? (e - 1400) * 0.25 * (0.6 + 0.8 * fbm(s / 900, e / 700, 23, 3)) : 0;
      const gul = (fbm(s / 70, e / 90, 31 + side, 3) - 0.5) * Math.min(60, e * 0.12) + (fbm(s / 150, e / 400, 61 + side, 3) - 0.5) * H * 0.35 * smooth(30, 350, e);
      h = B + talus + cliff + far + gul;
      kind = 3;
      if (rd < 22) { h = Math.min(h, lerp(h, B - 3.4, smooth(22, 9, rd))); kind = 2; }
    }
    if (out) out.kind = kind;
    return h;
  }
  // точка (i, o) в мир
  pos(i, o) { return [this.SX[i] + this.SNX[i] * o, this.SY[i] + this.SNY[i] * o]; }
  // смещения колонн для строки i
  cols(i) {
    const [ow, oe] = this.edges(i), d = this.DEV[i], rc = this.RIV[i] + d, out = [];
    for (let k = ECOL.length - 1; k > 0; k--) out.push(ow - ECOL[k]);
    // дно: плотность выше у дороги и реки
    const dens = o => { let v = 1 / 55; const au = Math.abs(o - d), ar = Math.abs(o - rc); if (au < 30) v = Math.max(v, 1 / 6); else if (au < 70) v = Math.max(v, 1 / 18); if (ar < 30) v = Math.max(v, 1 / 6); return v; };
    const st = 2, M = Math.max(2, Math.ceil((oe - ow) / st)), cdf = new Float32Array(M + 1);
    for (let k = 0; k < M; k++) cdf[k + 1] = cdf[k] + dens(ow + (k + 0.5) * (oe - ow) / M);
    const tot = cdf[M]; let j = 0;
    for (let c = 0; c <= NFLOOR; c++) {
      const tg = c / NFLOOR * tot; while (j < M - 1 && cdf[j + 1] < tg) j++;
      const f = (tg - cdf[j]) / ((cdf[j + 1] - cdf[j]) || 1); out.push(ow + (j + clamp(f, 0, 1)) * (oe - ow) / M);
    }
    for (let k = 1; k < ECOL.length; k++) out.push(oe + ECOL[k]);
    return out;
  }
  colorAt(i, o, h, kind) {
    const s = this.sOf(i), n = fbm(s / 45, o / 45, 7, 3), n2 = vnoise(s / 12, o / 12, 9);
    let c;
    if (kind === 2) c = mix3(this.cBed, this.cRock, n2 * 0.6);
    else if (kind === 1) c = mix3(this.cGravel, this.cFloor, 0.35 + n2 * 0.4);
    else if (kind === 0) c = mix3(this.cFloor, this.cAutumn, smooth(0.45, 0.8, n) * 0.7);
    else {
      const rel = h - this.E[i];
      const aut = smooth(0.35, 0.75, fbm(s / 160, o / 160, 5, 3));
      c = mix3(this.cForest, this.cAutumn, aut);
      c = mix3(c, [c[0] * 0.75, c[1] * 0.8, c[2] * 0.7], n2);
      c = mix3(c, this.cRock, smooth(650, 1100, rel) * 0.85 + smooth(0.62, 0.8, n) * 0.25);
    }
    return c;
  }
  // сетка куска: k — номер куска, lod 0 — ближний, 1 — дальний
  buildChunk(k, lod) {
    const i0 = k * CH, i1 = Math.min(this.N - 1, i0 + CH), rs = lod ? ROWF : ROWN, cs = lod ? 2 : 1;
    const rows = []; for (let i = i0; i <= i1; i += rs) rows.push(i); if (rows[rows.length - 1] !== i1) rows.push(i1);
    const colsAll = rows.map(i => this.cols(i).filter((_, c, a) => c % cs === 0 || c === a.length - 1));
    const nc = colsAll[0].length, nv = rows.length * nc, [ox, oy, oz] = this.org(k), SK = lod ? 12 : 5;
    const pos = new Float32Array((nv + 2 * nc) * 3), col = new Uint8Array((nv + 2 * nc) * 4), tmp = {};
    let v = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
    rows.forEach((i, r) => {
      for (const o of colsAll[r]) {
        const [x, z] = this.pos(i, o), h = this.h(i, o, tmp) - (lod ? 1.5 : 0), c = this.colorAt(i, o, h, tmp.kind);
        pos[v * 3] = x - ox; pos[v * 3 + 1] = h - oy; pos[v * 3 + 2] = z - oz;
        col[v * 4] = c[0] * 255; col[v * 4 + 1] = c[1] * 255; col[v * 4 + 2] = c[2] * 255; col[v * 4 + 3] = tmp.kind * 40;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, h); y1 = Math.max(y1, h); v++;
      }
    });
    // юбки: копия первой и последней строки на SK м ниже — закрывают щели на стыке с соседним LOD
    for (const r of [0, rows.length - 1]) for (let c = 0; c < nc; c++, v++) {
      const u = r * nc + c; pos[v * 3] = pos[u * 3]; pos[v * 3 + 1] = pos[u * 3 + 1] - SK; pos[v * 3 + 2] = pos[u * 3 + 2];
      for (let j = 0; j < 4; j++) col[v * 4 + j] = col[u * 4 + j];
    }
    const idx = new Uint16Array(((rows.length - 1) * (nc - 1) + 2 * (nc - 1)) * 6); let q = 0;
    const qd = (a, b, d, e) => { idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e; };
    for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < nc - 1; c++) { const a = r * nc + c; qd(a, a + 1, a + nc, a + nc + 1); }
    const e0 = nv, e1 = nv + nc, last = (rows.length - 1) * nc;
    for (let c = 0; c < nc - 1; c++) { qd(e0 + c, e0 + c + 1, c, c + 1); qd(last + c, last + c + 1, e1 + c, e1 + c + 1); }
    return { pos, col, idx, n: q, org: [ox, oy, oz], bb: [x0, y0 - SK, z0, x1, y1, z1], cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, s0: this.sOf(i0), s1: this.sOf(i1) };
  }
  get nChunks() { return Math.ceil((this.N - 1) / CH); }
  // высота земли под точкой мира (для ходьбы): проекция на сглаженную ось около подсказки hintI
  ground(x, z, hint = null) {
    let bi = hint ?? this.nearestI(x, z), best = 1e18;
    for (let k = -40; k <= 40; k += 2) { const i = clamp(bi + k, 0, this.N - 1), d = (this.SX[i] - x) ** 2 + (this.SY[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    for (let k = -2; k <= 2; k++) { const i = clamp(bi + k, 0, this.N - 1), d = (this.SX[i] - x) ** 2 + (this.SY[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    const o = (x - this.SX[bi]) * this.SNX[bi] + (z - this.SY[bi]) * this.SNY[bi];
    const r = this.gq || (this.gq = {});
    r.i = bi; r.o = o; r.h = this.h(bi, o, r); r.u = o - this.DEV[bi];
    const [ow, oe] = this.edges(bi); r.ow = ow; r.oe = oe;
    return r;
  }
  nearestI(x, z) {
    const pr = this.road.project(x, z);
    if (pr.d < 3000) return clamp(Math.round(pr.s / STEP) + PRE, 0, this.N - 1);
    let bi = 0, best = 1e18; for (let i = 0; i < this.N; i += 8) { const d = (this.SX[i] - x) ** 2 + (this.SY[i] - z) ** 2; if (d < best) { best = d; bi = i; } } return bi;
  }
  // лента дороги по куску: асфальт (u 0..1 поперёк, v вдоль по 16 м — текстура) и обочины (гравий)
  buildRoad(k) {
    const i0 = Math.max(0, k * CH), i1 = Math.min(this.N - 1, i0 + CH), [ox, oy, oz] = this.org(k);
    const OFF = [-8.6, -6.9, -4.3, -4.3, 4.3, 4.3, 6.9, 8.6], DY = [-0.45, -0.06, -0.02, 0, 0, -0.02, -0.06, -0.45];
    const UO = [0, 0, 0, 0, 1, 1, 1, 1], AS = [0, 0, 0, 1, 1, 0, 0, 0];
    const nc = OFF.length, rows = i1 - i0 + 1, pos = new Float32Array(rows * nc * 3), col = new Uint8Array(rows * nc * 4), uv = new Float32Array(rows * nc * 2);
    const gv = hex('#7a7364'), ga = hex('#5f5a4f');
    let v = 0;
    for (let i = i0; i <= i1; i++) {
      const B = this.E[i], sv = this.sOf(i) / 16;
      for (let c = 0; c < nc; c++) {
        pos[v * 3] = this.X[i] + this.NX[i] * OFF[c] - ox; pos[v * 3 + 1] = B + 0.08 + DY[c] - oy; pos[v * 3 + 2] = this.Y[i] + this.NY[i] * OFF[c] - oz;
        const g = c === 0 || c === nc - 1 ? ga : gv;
        col[v * 4] = g[0] * 255; col[v * 4 + 1] = g[1] * 255; col[v * 4 + 2] = g[2] * 255; col[v * 4 + 3] = AS[c] ? 255 : 0;
        uv[v * 2] = UO[c]; uv[v * 2 + 1] = sv - Math.floor(this.sOf(i0) / 16); v++; // v от начала куска — точнее во float32
      }
    }
    const idx = []; for (let r = 0; r < rows - 1; r++) for (let c = 0; c < nc - 1; c++) { if (c === 2 || c === 4) continue; const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1; idx.push(a, d, b, b, d, e); }
    return { pos, col, uv, idx: new Uint16Array(idx), n: idx.length };
  }
  // лента Терека (в кадре сглаженной оси)
  buildRiver(k) {
    const i0 = k * CH, i1 = Math.min(this.N - 1, i0 + CH), P = [], UV = [], I = [], [ox, oy, oz] = this.org(k);
    const W = [-13, -6, 0, 6, 13];
    let r = 0;
    for (let i = i0; i <= i1; i += 2) {
      const rc = this.RIV[i] + this.DEV[i], y = this.E[i] - 1.35;
      for (let c = 0; c < W.length; c++) { const [x, z] = this.pos(i, rc + W[c]); P.push(x - ox, y - oy, z - oz); UV.push(c / (W.length - 1), -this.sOf(i) / 30); }
      r++;
    }
    const nc = W.length;
    for (let a = 0; a < r - 1; a++) for (let c = 0; c < nc - 1; c++) { const p = a * nc + c, q = p + 1, d = p + nc, e = d + 1; I.push(p, d, q, q, d, e); }
    return { pos: new Float32Array(P), uv: new Float32Array(UV), idx: new Uint16Array(I), n: I.length };
  }
  // деревья куска: { kind: Float32Array[x,y,z,scale,rot,r,g,b] }
  trees(k, avoid) {
    const i0 = k * CH, i1 = Math.min(this.N - 1, i0 + CH), out = { pine: [], leaf: [], birch: [], shrub: [] }, tmp = {};
    const TC = { pine: ['#2f4127', '#34462a', '#283a24', '#3b4b2c'], leaf: ['#4e5e30', '#7f7234', '#9a8a3a', '#b59a3a', '#8a5a2a', '#5f6b36', '#a8742e'], birch: ['#c9a93e', '#b8a24a', '#9aa048', '#d0b050'], shrub: ['#5b5a2e', '#6e6030', '#7d5f2c', '#4f5a30'] };
    const put = (kind, x, y, z, sc, seed) => { const c = hex(TC[kind][Math.floor(hash01(seed, 5) * TC[kind].length)]), j = 0.85 + hash01(seed, 6) * 0.3; out[kind].push(x, y, z, sc, hash01(seed, 7) * 6.28, c[0] * j, c[1] * j, c[2] * j); };
    for (let i = i0; i < i1; i += 2) {
      const s = this.sOf(i); if (s < 260 && s > -700) continue; // КПП — голые скалы и бетон
      const [ow, oe] = this.edges(i), d = this.DEV[i], rc = this.RIV[i] + d;
      for (let t = 0; t < 16; t++) {
        const seed = i * 16 + t, r = hash01(seed, 1);
        let o, side = hash01(seed, 2) < 0.5 ? -1 : 1;
        if (t < 13) { const e = -Math.log(1 - r * 0.98) * (140 + this.LAM[i] * 0.3); if (e > 900) continue; o = side < 0 ? ow - e + 6 : oe + e - 6; }
        else { o = lerp(ow, oe, r); if (Math.abs(o - d) < 14 || Math.abs(o - rc) < 18) continue; if (hash01(seed, 9) < 0.55) continue; }
        if (Math.abs(o - rc) < 17 || Math.abs(o - d) < 12) continue;
        const h = this.h(i, o, tmp), h2 = this.h(i, o + 6, {}), h3 = this.h(i, o - 6, {}), slope = Math.max(Math.abs(h2 - h), Math.abs(h3 - h)) / 6;
        if (slope > 3.2) continue;
        const rel = h - this.E[i]; if (rel > 1100) continue;
        const [x, z] = this.pos(i, o + (hash01(seed, 3) - 0.5) * 4);
        if (avoid && avoid(x, z)) continue;
        const nsel = fbm(s / 300, o / 300, 41, 2), kr = hash01(seed, 4);
        const kind = tmp.kind !== 3 ? (kr < 0.45 ? 'shrub' : kr < 0.8 ? 'leaf' : 'birch') : (nsel > 0.55 ? (kr < 0.7 ? 'pine' : 'leaf') : (kr < 0.6 ? 'leaf' : kr < 0.8 ? 'birch' : 'pine'));
        put(kind, x, h - 0.3, z, 0.75 + hash01(seed, 8) * 0.7 + (rel > 500 ? -0.15 : 0), seed);
      }
    }
    for (const kk in out) out[kk] = new Float32Array(out[kk]);
    return out;
  }
}
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
return { Terrain, TSTEP: STEP, TPRE: PRE, TCH: CH, vnoise, fbm };
});
