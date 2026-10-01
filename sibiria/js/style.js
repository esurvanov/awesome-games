'use strict';
// Style — словарь C «Графичный силуэт»: мир рисуется одним языком (проверка — tests/style-check.js).
//   🎨 7 ролей цвета на всю сцену; у материала 2 тона (свет/тень) из этих ролей; полутона — только сглаживание края.
//   ☀ одно солнце (мир: X вправо, Y к камере, Z вверх) — и для тона формы, и для отбрасываемых теней (вправо-вниз).
//   ✒ контур тушью — только внешний силуэт, постоянная экранная толщина (INK css px) на любом зуме;
//      запечённое (спрайты) печётся под «зум туши» zi и перепекается при его смене (бюджет печи — ArtWorld).
//   ◌ ореол: фигура отделяется от фона бумажным кольцом снаружи туши (мелкие детали внутри — без контура).
//   🌗 время суток и погода — перекраска тех же 7 ролей одним аффинным преобразованием на канал (умножение + добавка),
//      таблица опорных пар (бумага, тушь) для день/сумерки/ночь/пурга; свет огня — зона, где роли возвращаются к дневным.
//   ⚡ QUALITY=low: контур 4 сдвигами вместо 12, ореол только у героя, лучей 8, штрихов наносов вдвое меньше.
// Включено по умолчанию; window.STYLE = 'old' или localStorage 'sibir-style' = 'old' — прежний рисунок (для сравнения).
const Style = (() => {
  let on = true;
  try { const v = (typeof window !== 'undefined' && window.STYLE) || localStorage.getItem('sibir-style'); if (v === 'old') on = false; } catch (e) { /* без хранилища — C */ }
  // ---------- роли ----------
  const P = { ink: '#1d2633', paper: '#f1efe8', shade: '#a9b9c9', red: '#c2412d', ochre: '#e3a33b', pine: '#2f4f45', wood: '#7a5236' };
  const ROLES = Object.keys(P);
  const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const RGB = {}; for (const k of ROLES) RGB[k] = hex(P[k]);
  // материалы: [свет, тень]
  const MAT = { snow: ['paper', 'shade'], ice: ['shade', 'ink'], needle: ['pine', 'ink'], bark: ['wood', 'ink'], birch: ['paper', 'shade'], burnt: ['ink', 'ink'],
    cut: ['ochre', 'wood'], cloth: ['red', 'wood'], skin: ['ochre', 'wood'], dark: ['pine', 'ink'], fire: ['ochre', 'red'] };
  const TH = 0.5; // порог света: lit ≥ TH — светлый тон
  const tone = (mat, lit) => P[MAT[mat][lit >= TH ? 0 : 1]];

  // ---------- свет ----------
  const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const SUN = nrm([-0.42, -0.34, 0.84]);                      // к солнцу: слева, с севера (верх экрана), сверху
  const lit3 = n => 0.5 + 0.5 * (n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
  // экранное направление к свету (для 2D-тона): проекция ¾ — экран = (X, 0.6·Y − Z)
  const LIT2 = (() => { const x = SUN[0], y = 0.6 * SUN[1] - SUN[2], l = Math.hypot(x, y); return { x: x / l, y: y / l }; })();
  // тень точки на высоте 1 px (экран): на земле сдвиг (−Sx/Sz, −Sy/Sz) мира → экран (x, 0.6·y). Вправо-вниз.
  const SHV = { x: -SUN[0] / SUN[2], y: -0.6 * SUN[1] / SUN[2] };
  const lit2 = (nx, ny) => 0.5 + 0.5 * (nx * LIT2.x + ny * LIT2.y);

  // ---------- вид: масштаб экрана (ставит GFX) ----------
  // rdpr — px устройства на css px; zoom — живой зум; zi — «зум туши» (зум, под который запечены спрайты с контуром)
  const V = { rdpr: 1, zoom: 1, zi: 1 };
  const INK = 2.0, HALO = 1.6, INK_G = 1.4;                   // css px: контур фигур, ореол, линии земли (тропа)
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  // толщина контура в px холста масштаба s (px холста на px мира): live — под живой зум, иначе — под zi
  const inkFor = (s, live, w = INK) => w * V.rdpr * s / (V.rdpr * (live ? V.zoom : V.zi));
  const lw = (w = INK_G) => w / V.zoom;                       // ширина линии в px мира для живого рисунка (WT: мир × dpr)

  // ---------- перекраска по времени суток и погоде ----------
  // опорные пары [бумага, тушь] → аффинно на канал: out = r·a + b (a — умножение картой света, b — добавка 'lighter')
  const MOOD = {
    day: [[241, 239, 232], [29, 38, 51]],
    dusk: [[236, 204, 178], [34, 32, 52]],
    night: [[70, 86, 124], [11, 15, 29]],
    storm: [[208, 216, 226], [104, 116, 132]],
    stormNight: [[62, 74, 98], [32, 38, 54]],
  };
  const MOOD_ROLES = {}; // для отчётов/тестов: роли в каждом состоянии
  const mix3 = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  function affOf(pp, ii) {
    const a = [], b = [];
    for (let c = 0; c < 3; c++) { const k = (pp[c] - ii[c]) / (RGB.paper[c] - RGB.ink[c]); a.push(Math.min(1, k)); b.push(Math.max(0, ii[c] - RGB.ink[c] * a[c])); }
    return { a, b };
  }
  const roleOf = (aff, k) => RGB[k].map((v, c) => Math.round(Math.min(255, v * aff.a[c] + aff.b[c])));
  for (const m in MOOD) { const aff = affOf(MOOD[m][0], MOOD[m][1]); MOOD_ROLES[m] = {}; for (const k of ROLES) MOOD_ROLES[m][k] = roleOf(aff, k); }
  // зона света (огонь, окно, факел): внутри ядра множитель → 1 (роли дневные, чуть теплее), в кольце — наполовину
  const LZ = { core: 0.44, edge: 0.74, ring: 0.5, f: [255, 238, 210], w: [255, 236, 206], c: [228, 234, 255], r: [255, 150, 130] };
  const zoneAff = (aff, t, k) => ({ a: aff.a.map((v, c) => 1 - (1 - v) * (1 - k * LZ[t][c] / 255)), b: aff.b });
  for (const m of ['night', 'dusk']) { const aff = affOf(MOOD[m][0], MOOD[m][1]); for (const [z, k] of [['Fire', 1], ['Ring', LZ.ring]]) { const za = zoneAff(aff, 'f', k); MOOD_ROLES[m + z] = {}; for (const r of ROLES) MOOD_ROLES[m + z][r] = roleOf(za, r); } }
  let AFF = affOf(MOOD.day[0], MOOD.day[1]), stK = 0, stT = -1, W = { day: 1, dusk: 0, night: 0, storm: 0 };
  // n — ночь 0..1, du — сумерки 0..1, storm — идёт ли пурга (сглаживается здесь, ~2 с), t — время рендера (с)
  function mood(n, du, storm, t) {
    const dt = stT < 0 ? 1 : Math.max(0, Math.min(0.2, t - stT)); stT = t;
    stK += ((storm ? 1 : 0) - stK) * (1 - Math.exp(-dt * 1.5)); if (Math.abs(stK - (storm ? 1 : 0)) < 0.004) stK = storm ? 1 : 0;
    let p = mix3(MOOD.day[0], MOOD.dusk[0], du), i = mix3(MOOD.day[1], MOOD.dusk[1], du);
    p = mix3(p, MOOD.night[0], n); i = mix3(i, MOOD.night[1], n);
    if (stK > 0) { const sp = mix3(MOOD.storm[0], MOOD.stormNight[0], n), si = mix3(MOOD.storm[1], MOOD.stormNight[1], n); p = mix3(p, sp, stK); i = mix3(i, si, stK); }
    AFF = affOf(p, i); W = { day: (1 - du) * (1 - n) * (1 - stK), dusk: du * (1 - n) * (1 - stK), night: n * (1 - stK), storm: stK };
    return AFF;
  }
  const css = v => `rgb(${v[0] | 0},${v[1] | 0},${v[2] | 0})`;
  const role = (k, a = 1) => { const v = roleOf(AFF, k); return a >= 1 ? css(v) : `rgba(${v[0]},${v[1]},${v[2]},${a})`; }; // роль после перекраски (для слоёв поверх света)
  const ambient = () => AFF.a.map(v => v * 255);   // множитель карты света
  const lift = () => AFF.b;                         // добавка (дымка пурги, сумерки)

  // ---------- привязка цвета к ролям (контекст «рисует только словарём») ----------
  const SNAP = new Map(), CLEAR = 'rgba(0,0,0,0)';
  function parse(c) {
    if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h.slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1]; }
    const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  // ближайшая роль (взвешенное «красное среднее»); alpha < 0.45 — полутон тени/блика: в C не рисуется
  function nearest(r, g, b) {
    let best = 'ink', bd = 1e9;
    for (const k of ROLES) { const q = RGB[k], rm = (r + q[0]) / 2, dr = r - q[0], dg = g - q[1], db = b - q[2], d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db; if (d < bd) { bd = d; best = k; } }
    return best;
  }
  function snap(c) {
    if (typeof c !== 'string') return c;
    let s = SNAP.get(c); if (s) return s;
    const v = parse(c); s = !v ? c : v[3] < 0.45 ? CLEAR : P[nearest(v[0], v[1], v[2])];
    SNAP.set(c, s); return s;
  }
  const roleName = c => { const v = parse(c); return v ? nearest(v[0], v[1], v[2]) : null; };
  // градиент в C — плоский тон: стоп ближе всего к середине
  class FlatGrad { constructor() { this.s = []; } addColorStop(o, c) { this.s.push([o, c]); } pick() { let b = null, bd = 9; for (const [o, c] of this.s) { const d = Math.abs(o - 0.5); if (d < bd) { bd = d; b = c; } } return b || CLEAR; } }
  const PROTO = typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null;
  const DF = PROTO && Object.getOwnPropertyDescriptor(PROTO, 'fillStyle'), DS = PROTO && Object.getOwnPropertyDescriptor(PROTO, 'strokeStyle'), DA = PROTO && Object.getOwnPropertyDescriptor(PROTO, 'globalAlpha');
  const sv = v => (v instanceof FlatGrad ? snap(v.pick()) : snap(v));
  // контекст g: каждый цвет → роль, градиент → плоский тон, слабая прозрачность → нет (на экземпляре, прототип не трогаем)
  function snapCtx(g) {
    if (!g || g.__snap || !DF) return g; g.__snap = 1;
    Object.defineProperty(g, 'fillStyle', { configurable: true, get() { return DF.get.call(this); }, set(v) { DF.set.call(this, sv(v)); } });
    Object.defineProperty(g, 'strokeStyle', { configurable: true, get() { return DS.get.call(this); }, set(v) { DS.set.call(this, sv(v)); } });
    Object.defineProperty(g, 'globalAlpha', { configurable: true, get() { return DA.get.call(this); }, set(v) { DA.set.call(this, v < 0.4 ? 0 : 1); } });
    g.createLinearGradient = () => new FlatGrad(); g.createRadialGradient = () => new FlatGrad();
    return g;
  }

  // ---------- контур и ореол ----------
  const TMP = [];
  function tmp(i, w, h) {
    let c = TMP[i]; if (!c) { c = TMP[i] = document.createElement('canvas'); c.width = c.height = 1; c._g = c.getContext('2d'); }
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    const g = c._g; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
    return c;
  }
  // штамп маски по кольцу радиуса r (px): 12 сдвигов + внутреннее кольцо — без щелей; low — крест
  function stamp(g, m, w, h, r) {
    if (r <= 0.05) return;
    const n = low() ? 4 : r < 1.6 ? 8 : 12;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + (low() ? Math.PI / 4 : 0); g.drawImage(m, 0, 0, w, h, Math.cos(a) * r, Math.sin(a) * r, w, h); }
    if (r > 2.2 && !low()) for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; g.drawImage(m, 0, 0, w, h, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, w, h); }
  }
  // область (w×h px) холста cv: тушь r px снаружи силуэта, ореол halo px снаружи туши; результат — в cv
  function outlineCanvas(cv, r, halo = 0, w = cv.width, h = cv.height) {
    if (!on || w < 1 || h < 1) return;
    const A = tmp(0, w, h), M = tmp(1, w, h), a = A._g, m = M._g;
    a.drawImage(cv, 0, 0, w, h, 0, 0, w, h);
    m.drawImage(cv, 0, 0, w, h, 0, 0, w, h); m.globalCompositeOperation = 'source-in'; m.fillStyle = P.ink; m.fillRect(0, 0, w, h); m.globalCompositeOperation = 'source-over';
    const g = cv.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
    if (halo > 0) { stamp(g, M, w, h, r + halo); g.globalCompositeOperation = 'source-in'; g.fillStyle = P.paper; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
    stamp(g, M, w, h, r); g.drawImage(A, 0, 0, w, h, 0, 0, w, h); g.restore();
  }
  // рисунок paint(gg) на g в рамке мира (x0, y0, w, h) — через временный холст в px устройства: роли, контур, ореол.
  // g — любой контекст без поворота (масштаб + сдвиг); клип и прозрачность g действуют на итог. o: {halo, snap, ink}
  let DEPTH = 0;
  function figure(g, x0, y0, w, h, paint, o = {}) {
    if (!on || DEPTH) return paint(g);
    const T = g.getTransform(), s = T.a, pad = Math.ceil((INK + HALO) * V.rdpr) + 2;
    const X = Math.floor(T.a * x0 + T.e) - pad, Y = Math.floor(T.d * y0 + T.f) - pad, Wd = Math.ceil(w * s) + pad * 2, Hd = Math.ceil(h * s) + pad * 2;
    if (Wd < 2 || Hd < 2 || Wd > 2600 || Hd > 2600) return paint(g);
    const C = tmp(o.snap === false ? 4 : 2, Wd, Hd), c = o.snap === false ? C._g : snapCtx(C._g);
    c.setTransform(s, 0, 0, T.d, T.e - X, T.f - Y);
    DEPTH++; try { paint(c); } finally { DEPTH--; }
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    outlineCanvas(C, (o.ink != null ? o.ink : INK) * V.rdpr, o.halo ? HALO * V.rdpr : 0, Wd, Hd);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(C, 0, 0, Wd, Hd, X, Y, Wd, Hd); g.restore();
  }
  // paint на холсте g целиком (спрайт): рисунок → временный холст того же размера → контур → поверх g
  function inked(g, paint, r) {
    if (!on) return paint(g);
    const cv = g.canvas, w = cv.width, h = cv.height, C = tmp(3, w, h), c = C._g;
    c.setTransform(g.getTransform()); DEPTH++; try { paint(c); } finally { DEPTH--; }
    outlineCanvas(C, r, 0, w, h);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(C, 0, 0, w, h, 0, 0, w, h); g.restore();
  }

  // ---------- штрих, линии скорости, лучи, тень ----------
  // штрих наносов: n коротких параллельных линий тона тени по дуге у подветренной (теневой) кромки сугроба
  function drift(g, d, k = 1) {
    const n = Math.max(2, Math.round(d.rx / (low() ? 22 : 13) * k)), r = d.rx, q = d.ry;
    g.strokeStyle = P.shade; g.lineCap = 'round'; g.lineWidth = 1.7; g.beginPath();
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, a = Math.PI * (0.08 + 0.84 * u), x = d.x + Math.cos(a) * r * 0.85 + SHV.x * 3, y = d.y + Math.sin(a) * q * 0.75 + 1;
      const L = (4 + 7 * Math.sin(Math.PI * u)) * Math.min(1.4, r / 60); g.moveTo(x - L * 0.6, y); g.lineTo(x + L * 0.4, y + 0.3);
    }
    g.stroke();
    g.beginPath(); g.moveTo(d.x - r * 0.7, d.y - q * 0.15); g.quadraticCurveTo(d.x, d.y - q * 0.75, d.x + r * 0.8, d.y - q * 0.05); g.lineWidth = 1.5; g.stroke(); // гребень
  }
  // линии скорости: дуги тушью позади движения (центр cx,cy; радиусы rs; от угла a0 до a1; ry — сжатие ¾)
  function speed(g, cx, cy, rs, a0, a1, ry = 1, al = 1) {
    if (al <= 0.02) return;
    g.save(); g.globalAlpha *= Math.min(1, al); g.strokeStyle = P.ink; g.lineCap = 'round'; g.lineWidth = lw(1.5);
    for (const r of rs) { g.beginPath(); g.ellipse(cx, cy, r, r * ry, 0, Math.min(a0, a1), Math.max(a0, a1)); g.stroke(); }
    g.restore();
  }
  // линии скорости по пути: q = [cx, cy, x0, y0, x1, y1 …] — дуга маха вокруг (cx, cy), копии в масштабах ks от центра
  function speedPath(g, q, ks, al = 0.9) {
    g.save(); g.globalAlpha *= al; g.strokeStyle = P.ink; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = lw(1.4); g.beginPath();
    for (const k of ks) for (let i = 2; i < q.length; i += 2) { const x = q[0] + (q[i] - q[0]) * k, y = q[1] + (q[i + 1] - q[1]) * k; i === 2 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke(); g.restore();
  }
  // лучи света охрой вокруг источника (эллипс ¾): r0..r1 — px мира
  function rays(g, x, y, r0, r1, n, al = 1, ph = 0) {
    if (al <= 0.02) return; n = low() ? Math.min(n, 8) : n;
    g.save(); g.globalAlpha *= Math.min(1, al); g.strokeStyle = P.ochre; g.lineCap = 'round'; g.lineWidth = lw(2.4); g.beginPath();
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + ph, c = Math.cos(a), s = Math.sin(a) * 0.55; g.moveTo(x + c * r0, y + s * r0); g.lineTo(x + c * r1, y + s * r1); }
    g.stroke(); g.restore();
  }
  // отбрасываемая тень (одно правило): тело высотой h px в точке опоры (x, y), ширина w — капсула вдоль SHV, тон тени
  function cast(g, x, y, h, w, k = 1) {
    const ex = x + SHV.x * h * k, ey = y + SHV.y * h * k, hw = w / 2, dx = ex - x, dy = ey - y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, tw = hw * 0.7;
    g.beginPath(); g.ellipse(x, y, hw, hw * 0.42, 0, 0, Math.PI * 2);
    g.moveTo(x + nx * hw, y + ny * hw * 0.42); g.lineTo(ex + nx * tw, ey + ny * tw * 0.6); g.ellipse(ex, ey, tw, tw * 0.6, Math.atan2(dy, dx), -Math.PI / 2, Math.PI / 2); g.lineTo(x - nx * hw, y - ny * hw * 0.42); g.closePath();
    g.fill();
  }

  // для отчёта и тестов
  function table() { return { roles: P, mood: MOOD_ROLES, sun: SUN, shadow: SHV, light2: LIT2, ink: INK, halo: HALO }; }
  return {
    get on() { return on; }, set on(v) { on = !!v; }, P, ROLES, LZ, MAT, tone, TH, SUN, SHV, LIT2, lit3, lit2, V, INK, HALO, INK_G, inkFor, lw,
    MOOD, MOOD_ROLES, mood, role, ambient, lift, get weights() { return W; },
    snap, snapCtx, roleName, outlineCanvas, figure, inked, drift, speed, speedPath, rays, cast, table, get depth() { return DEPTH; },
  };
})();
