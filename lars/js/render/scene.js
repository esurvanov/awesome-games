// Статичная обстановка 3D: посёлки (дома по той же формуле, что на карте), МАПП по плану ROUTE.kpp,
// блокпост, АЗС, кафе, руины башни, ГЭС, Ермоловский камень, мосты, отбойники, ЛЭП, знаки, лотки продавцов,
// дальние вершины. Текстуры — только нарисованные на canvas (атлас надписей, асфальт).
// Всё раскладывается по кускам рельефа (256 м) для отсечения. Источники света — список для ночи.
'use strict';
L.def('render/scene', () => {
const { clamp, lerp, hash01 } = L.use('core');
const { MB, MAT, h01 } = L.use('render/geo');
const { TCH, TSTEP, TPRE, fbm } = L.use('render/terrain');

// ─── атлас надписей (canvas) ───
function makeAtlas() {
  const W = 1024, H = 1024, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  // поля 8 px между картинками, края дорисованы наружу (ниже): мип-уровни не подмешивают серый фон и соседей
  const GAP = 8, rects = {}, boxes = []; let x = GAP, y = GAP, rowH = 0;
  const alloc = (id, w, h) => { if (x + w + GAP > W) { x = GAP; y += rowH + GAP * 2; rowH = 0; } const r = { x, y, w, h }; x += w + GAP * 2; rowH = Math.max(rowH, h); rects[id] = [r.x / W, r.y / H, (r.x + w) / W, (r.y + h) / H]; boxes.push(r); return r; };
  const text = (id, w, h, lines, o = {}) => {
    const r = alloc(id, w, h);
    g.save(); g.translate(r.x, r.y);
    g.fillStyle = o.bg || '#f4f4f0'; g.fillRect(0, 0, w, h);
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = o.bw || 6; g.strokeRect(o.bw / 2 || 3, o.bw / 2 || 3, w - (o.bw || 6), h - (o.bw || 6)); }
    if (o.stripes) { for (let i = 0; i < w; i += o.stripes * 2) { g.fillStyle = '#c8322b'; g.fillRect(i, 0, o.stripes, h); } }
    g.fillStyle = o.fg || '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((t, i) => { const fs = (o.fs || h * 0.5 / n) * (o.scale ? o.scale[i] || 1 : 1); g.font = `${o.w || 700} ${fs}px ${o.font || 'Arial, Helvetica, sans-serif'}`; g.fillText(t, w / 2, h * (i + 0.5) / n + (o.dy || 0), w - 12); });
    g.restore();
  };
  // номерной знак
  text('plate', 128, 28, ['А 777 ВС 77'], { bg: '#f2f2f2', border: '#222', bw: 3, fs: 18, font: 'Arial Narrow, Arial, sans-serif' });
  text('kpp', 512, 96, ['ПУНКТ ПРОПУСКА', '«ВЕРХНИЙ ЛАРС»'], { bg: '#1f5fa8', fg: '#ffffff', fs: 34 });
  text('border', 256, 160, ['ПОГРАНИЧНАЯ', 'ЗОНА', 'проход запрещён'], { bg: '#f4f4f0', border: '#c8322b', bw: 10, fg: '#c8322b', fs: 34, scale: [1, 1, 0.6] });
  text('dir', 256, 128, ['Верхний Ларс', 'Грузия →'], { bg: '#1f5fa8', fg: '#fff', border: '#fff', bw: 5, fs: 34 });
  text('azs', 256, 64, ['АЗС · СтандАрт'], { bg: '#c8322b', fg: '#fff', fs: 34 });
  text('price', 128, 128, ['АИ-92', '52,40', 'АИ-95', '57,10'], { bg: '#15181b', fg: '#ffcf4a', fs: 22, font: 'Courier New, monospace' });
  text('cafe', 256, 64, ['КАФЕ · ШАШЛЫК'], { bg: '#6b3b2a', fg: '#ffe0a8', fs: 32 });
  text('dps', 128, 48, ['ДПС'], { bg: '#f4f4f0', fg: '#1f5fa8', fs: 34, border: '#1f5fa8', bw: 4 });
  text('sos', 256, 64, ['SOS Lars · бесплатно'], { bg: '#2d6fb3', fg: '#fff', fs: 28 });
  text('toilet', 64, 64, ['WC'], { bg: '#2a79c9', fg: '#fff', fs: 30 });
  for (const [id, t] of [['pie', 'ПИРОГИ'], ['tea', 'ЧАЙ КОФЕ'], ['water', 'ВОДА'], ['charge', 'ЗАРЯДКА'], ['usd', 'ОБМЕН $'], ['food', 'ЕДА'], ['bike', 'ВЕЛИКИ'], ['meds', 'МЕДИК']])
    text('s_' + id, 192, 64, [t], { bg: '#c9b48a', fg: '#1a1410', fs: 36, font: 'Marker Felt, Comic Sans MS, cursive', w: 400 });
  for (const [id, t] of [['vlars', 'Верхний Ларс'], ['nlars', 'Нижний Ларс'], ['chmi', 'Чми'], ['balta', 'Балта'], ['redant', 'Редант'], ['ezmi', 'Эзми']])
    text('v_' + id, 256, 80, [t], { bg: '#f4f4f0', fg: '#111', border: '#111', bw: 5, fs: 40 });
  text('km', 64, 96, ['10'], { bg: '#f4f4f0', fg: '#111', fs: 40 });
  // полосы (шлагбаум, бетонные блоки)
  const st = alloc('stripe', 128, 16); for (let i = 0; i < 128; i += 32) { g.fillStyle = '#c8322b'; g.fillRect(st.x + i, st.y, 16, 16); g.fillStyle = '#f4f4f0'; g.fillRect(st.x + i + 16, st.y, 16, 16); }
  // края наружу: строки/столбцы по краю растянуты на поле
  for (const r of boxes) {
    g.drawImage(cv, r.x, r.y, r.w, 1, r.x, r.y - GAP, r.w, GAP); g.drawImage(cv, r.x, r.y + r.h - 1, r.w, 1, r.x, r.y + r.h, r.w, GAP);
    g.drawImage(cv, r.x, r.y - GAP, 1, r.h + GAP * 2, r.x - GAP, r.y - GAP, GAP, r.h + GAP * 2); g.drawImage(cv, r.x + r.w - 1, r.y - GAP, 1, r.h + GAP * 2, r.x + r.w, r.y - GAP, GAP, r.h + GAP * 2);
  }
  return { cv, rects };
}

// ─── асфальт (canvas, повтор): u — поперёк 8,6 м, v — 16 м вдоль ───
function makeAsphalt() {
  const W = 256, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.fillStyle = '#5c5952'; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < W * H; i++) { const n = (h01(i, 3) - 0.5) * 26 + (h01(i >> 3, 4) - 0.5) * 10; d[i * 4] += n; d[i * 4 + 1] += n; d[i * 4 + 2] += n * 0.9; }
  g.putImageData(img, 0, 0);
  // заплатки и трещины
  for (let k = 0; k < 7; k++) { g.fillStyle = `rgba(${k % 2 ? 40 : 90},${k % 2 ? 40 : 88},${k % 2 ? 38 : 80},0.35)`; g.fillRect(h01(k, 1) * 200, h01(k, 2) * 460, 20 + h01(k, 3) * 60, 20 + h01(k, 4) * 80); }
  g.strokeStyle = 'rgba(25,25,22,0.5)'; g.lineWidth = 1.2;
  for (let k = 0; k < 10; k++) { g.beginPath(); let x = h01(k, 5) * W, y = h01(k, 6) * H; g.moveTo(x, y); for (let j = 0; j < 6; j++) { x += (h01(k * 9 + j, 7) - 0.5) * 30; y += h01(k * 9 + j, 8) * 30; g.lineTo(x, y); } g.stroke(); }
  // колеи — темнее
  g.fillStyle = 'rgba(30,30,28,0.18)'; g.fillRect(W * 0.12, 0, W * 0.1, H); g.fillRect(W * 0.34, 0, W * 0.1, H); g.fillRect(W * 0.56, 0, W * 0.1, H); g.fillRect(W * 0.78, 0, W * 0.1, H);
  // разметка: сплошные по краям, прерывистая по центру (стёртая)
  g.fillStyle = 'rgba(232,230,220,0.85)'; g.fillRect(4, 0, 5, H); g.fillRect(W - 9, 0, 5, H);
  g.fillStyle = 'rgba(232,230,220,0.7)'; g.fillRect(W / 2 - 3, 0, 6, H * 0.2); g.fillRect(W / 2 - 3, H * 0.5, 6, H * 0.2);
  return cv;
}

class Scene {
  constructor(world, terrain) {
    this.w = world; this.t = terrain; this.C = world.C; this.P = world.C.ROUTE.palette;
    this.chunks = new Map(); this.lights = []; this.sellers = []; this.colliders = []; this.occ = new Set();
    this.wires = []; this.cond = [];
  }
  mb(s) { const k = clamp(Math.floor((s / TSTEP + TPRE) / TCH), 0, this.t.nChunks - 1); let m = this.chunks.get(k); if (!m) { m = new MB(); this.chunks.set(k, m); } return m; }
  gnd(x, z) { return this.t.ground(x, z).h; }
  mark(x, z, r) { for (let a = -r; a <= r; a += 8) for (let b = -r; b <= r; b += 8) this.occ.add(Math.floor((x + a) / 8) + ',' + Math.floor((z + b) / 8)); }
  occupied(x, z) { return this.occ.has(Math.floor(x / 8) + ',' + Math.floor(z / 8)); }
  light(x, y, z, col, rad, kind, extra = {}) { this.lights.push({ x, y, z, c: col, r: rad, kind, ...extra }); }
  // коллайдер-прямоугольник (мир): центр, «вперёд» f, полуразмеры вдоль right (a) и forward (b)
  box(x, z, fx, fz, a, b) { this.colliders.push({ x, z, fx, fz, a, b }); }
  build() {
    const t0 = performance.now();
    this.buildKpp();
    this.buildPlaces();
    this.buildVillages();
    this.buildBridges();
    this.buildRails();
    this.buildPylons();
    this.buildSigns();
    this.buildSellers();
    this.buildPeaks();
    this.ms = performance.now() - t0;
  }
  // кадр дороги: точка (s, u) → мир + нормали
  R(s, u) { return this.t.at(s, u); }

  // ─────────── МАПП ───────────
  buildKpp() {
    const K = this.C.ROUTE.kpp, gs = this.w.queue.gateS, P = this.P;
    const S = v => gs + v;
    // площадка ровная
    this.t.flat.push({ s0: S(K.plaza.v0) - 30, s1: S(K.plaza.v1) + 20, o0: K.plaza.u0 - 4, o1: K.plaza.u1 + 4, dh: 0 });
    const q = this.R(S(0), 0), fx = -q.ny, fz = q.nx; // «вперёд» — к Грузии (вниз по s)
    const at = (v, u) => { const p = this.R(S(v), u); return [p.x, p.h, p.y]; };
    // асфальт площадки полосами вдоль
    for (let v = K.plaza.v0; v < K.plaza.v1; v += 10) {
      const m = this.mb(S(v));
      const a = at(v, K.plaza.u0), b = at(v, K.plaza.u1), c = at(v + 10, K.plaza.u1), d = at(v + 10, K.plaza.u0);
      for (const p of [a, b, c, d]) p[1] += 0.06;
      m.quad(a, b, c, d, '#55534d', 0);
      // разметка полос под навесами
      for (let l = -K.lanes / 2; l <= K.lanes / 2; l++) {
        const u = l * 5.5 + 2;
        if (v % 20 === 0) m.quad(at(v, u - 0.08).map((x, i) => i === 1 ? x + 0.08 : x), at(v, u + 0.08).map((x, i) => i === 1 ? x + 0.08 : x), at(v + 6, u + 0.08).map((x, i) => i === 1 ? x + 0.08 : x), at(v + 6, u - 0.08).map((x, i) => i === 1 ? x + 0.08 : x), '#d8d6cc', 0);
      }
    }
    // навесы
    for (const c of K.canopies) {
      const m = this.mb(S((c.v0 + c.v1) / 2)), cv = (c.v0 + c.v1) / 2, cu = (c.u0 + c.u1) / 2, p = this.R(S(cv), cu), h = p.h + c.h;
      const L = c.v1 - c.v0, Wd = c.u1 - c.u0;
      m.at(p.x, 0, p.y, fx, fz);
      m.box(0, h, 0, Wd, 1.3, L, P.canopy, 0, { side: '#cfd4d8' });
      // полосы LED снизу
      for (let k = -Wd / 2 + 3; k < Wd / 2 - 1; k += 5.5) m.quad([k - 0.4, h - 0.02, -L / 2 + 2], [k + 0.4, h - 0.02, -L / 2 + 2], [k + 0.4, h - 0.02, L / 2 - 2], [k - 0.4, h - 0.02, L / 2 - 2], P.led, MAT.glow);
      // колонны
      for (let a = -Wd / 2 + 1; a <= Wd / 2 - 1; a += Math.max(8, (Wd - 2) / Math.ceil((Wd - 2) / 14))) for (const b of [-L / 2 + 1.5, L / 2 - 1.5]) m.box(a, p.h - 1, b, 0.5, c.h + 1, 0.5, '#9ea3a8', 0);
      m.reset();
      for (let k = -Wd / 2 + 3; k < Wd / 2; k += 11) { const lp = this.R(S(cv), cu + k); this.light(lp.x, h - 1, lp.y, [0.9, 0.95, 1.0], 26, 'kpp', { pool: 12 }); }
    }
    // будки контроля
    for (const v of K.booths) for (let l = 0; l < K.lanes; l++) {
      const u = -15 + l * 5.5 + (v < -300 ? 5 : 0); const p = this.R(S(v), u), m = this.mb(S(v));
      m.at(p.x, p.h, p.y, fx, fz);
      m.box(0, 0, 0, 1.8, 2.6, 2.8, '#f0f1f2', 0, { top: '#d8dadc' });
      m.box(0, 1.9, 0, 1.82, 0.25, 2.82, '#2c5ca8', 0);
      m.quad([-0.91, 1.1, -0.9], [-0.91, 1.1, 0.9], [-0.91, 1.8, 0.9], [-0.91, 1.8, -0.9], '#e7d7a8', MAT.window);
      m.quad([0.91, 1.1, 0.9], [0.91, 1.1, -0.9], [0.91, 1.8, -0.9], [0.91, 1.8, 0.9], '#1c2429', 0);
      // шлагбаум у будки
      m.box(1.2, 0, -1.6, 0.25, 1.0, 0.25, '#555', 0);
      m.box(1.2 + 1.7, 0.95, -1.6, 3.4, 0.12, 0.12, '#ffffff', MAT.atlas, {}); m.reset();
      this.box(p.x, p.y, fx, fz, 1.1, 1.6);
    }
    // здания
    for (const b of K.buildings) {
      const cv = (b.v0 + b.v1) / 2, cu = (b.u0 + b.u1) / 2, p = this.R(S(cv), cu), m = this.mb(S(cv)), L = b.v1 - b.v0, Wd = b.u1 - b.u0;
      m.at(p.x, p.h, p.y, fx, fz);
      m.box(0, -2, 0, Wd, b.h + 2, L, b.c, 0, { top: '#6e6f70' });
      for (let k = -L / 2 + 3; k < L / 2 - 2; k += 4.5) for (const sd of [-1, 1]) {
        const lit = h01(Math.round(k * 10 + cu), 3) < 0.6, x = sd * (Wd / 2 + 0.02);
        const pts = [[x, 1.2, k - 0.8], [x, 1.2, k + 0.8], [x, 2.6, k + 0.8], [x, 2.6, k - 0.8]];
        if (sd > 0) pts.reverse();
        m.quad(...pts, lit ? '#e8eef6' : '#20282e', lit ? MAT.window : 0);
      }
      m.reset();
      this.box(p.x, p.y, fx, fz, Wd / 2, L / 2);
      this.mark(p.x, p.y, Math.max(Wd, L) / 2 + 4);
    }
    // ворота: шлагбаумы, портал с вывеской
    for (const v of [K.gateN, K.gateS]) {
      const m = this.mb(S(v)), p = this.R(S(v), 0);
      m.at(p.x, p.h, p.y, fx, fz);
      for (const u of [-9, 9]) m.box(u, 0, 0, 0.35, 1.1, 0.35, '#666', 0);
      for (let k = 0; k < 8; k++) m.box(-8.6 + k * 1.1 + 0.55, 0.95, 0, 1.1, 0.14, 0.14, k % 2 ? '#f4f4f0' : P.barrier, 0);
      for (let k = 0; k < 8; k++) m.box(0.2 + k * 1.1 + 0.55, 0.95, 0, 1.1, 0.14, 0.14, k % 2 ? P.barrier : '#f4f4f0', 0);
      m.quad([-7, 1.05, 0.08], [7, 1.05, 0.08], [7, 1.12, 0.08], [-7, 1.12, 0.08], '#ff3b30', MAT.glow);
      if (v === K.gateN) {
        for (const u of [-11, 11]) m.box(u, 0, -2, 0.6, 7.5, 0.6, '#8a8f94', 0);
        m.box(0, 6.2, -2, 23, 1.6, 0.5, '#1f5fa8', 0);
        const r = this.atlasRect('kpp');
        m.quad([7, 6.25, -2.26], [-7, 6.25, -2.26], [-7, 7.75, -2.26], [7, 7.75, -2.26], '#ffffff', MAT.atlasGlow, [[r[2], r[3]], [r[0], r[3]], [r[0], r[1]], [r[2], r[1]]]);
        // флагшток
        m.box(15, 0, -4, 0.15, 11, 0.15, '#bbb', 0);
        m.box(15.9, 9, -4, 1.6, 0.35, 0.03, '#ffffff', 0); m.box(15.9, 8.65, -4, 1.6, 0.35, 0.03, '#1f55a8', 0); m.box(15.9, 8.3, -4, 1.6, 0.35, 0.03, '#d52b1e', 0);
        this.light(p.x, p.h + 7, p.y, [1.0, 0.95, 0.85], 30, 'kpp', { pool: 14 });
      }
      m.reset();
    }
    // забор по краям площадки (колючая проволока — тёмные линии)
    for (const u of [K.plaza.u0 + 1, K.plaza.u1 - 1]) for (let v = K.fence[0]; v < K.fence[1]; v += 4) {
      const m = this.mb(S(v)), a = this.R(S(v), u), b = this.R(S(v + 4), u);
      m.box(0, 0, 0, 0, 0, 0, '#000'); // no-op для совместимости
      m.quad([a.x, a.h, a.y], [b.x, b.h, b.y], [b.x, b.h + 2.4, b.y], [a.x, a.h + 2.4, a.y], '#3a3f42', MAT.shadow);
    }
    // мачты освещения
    for (let v = K.plaza.v0 + 20; v < K.plaza.v1; v += 45) for (const u of [K.plaza.u0 + 6, K.plaza.u1 - 8]) {
      const p = this.R(S(v), u), m = this.mb(S(v));
      m.at(p.x, p.h, p.y, fx, fz); m.box(0, 0, 0, 0.3, 14, 0.3, '#8a8f94', 0); m.box(0, 14, 0, 1.6, 0.4, 0.8, '#6d7176', 0);
      m.quad([-0.7, 13.98, -0.3], [0.7, 13.98, -0.3], [0.7, 13.98, 0.3], [-0.7, 13.98, 0.3], P.led, MAT.glow); m.reset();
      this.light(p.x, p.h + 13.5, p.y, [0.85, 0.92, 1.0], 45, 'kpp', { pool: 22, big: 1 });
    }
    // «последний шлагбаум» для пеших (queue.barrierS)
    { const v = this.w.queue.barrierS - gs, p = this.R(S(v), 0), m = this.mb(S(v));
      m.at(p.x, p.h, p.y, fx, fz);
      for (const sd of [-1, 1]) { m.box(sd * 5, 0, 0, 0.2, 1.1, 0.2, '#555'); for (let k = 0; k < 4; k++) m.box(sd * (5.6 + k * 0.9), 0.9, 0, 0.9, 0.1, 0.1, k % 2 ? '#f4f4f0' : P.barrier); }
      for (let k = 0; k < 6; k++) m.box(-9 - k * 2.1, 0, 0.3, 2, 1.0, 0.1, '#7d8286', 0);
      m.reset(); }
    // Ермоловский камень (ROUTE.places)
    const em = this.C.ROUTE.places.find(p => p.id === 'ermolov');
    if (em) {
      const p = this.R(em.s * 1000, em.side * em.off), g = this.gnd(p.x, p.y), m = this.mb(em.s * 1000);
      m.at(p.x, g, p.y, -p.ny, p.nx);
      const col = f => { const k = h01(f[0] * 13 + f[1], 7); return k < 0.3 ? '#8e8c86' : k < 0.6 ? '#7e7b74' : k < 0.85 ? '#96938b' : '#6d6b68'; };
      m.lump(0, 5.5, 0, 8.5, 8.5, 15, col, 0, 5, 0.3);
      m.lump(-3, 9.5, 3, 6, 5.5, 9, col, 0, 9, 0.35);
      m.lump(4, 2, -8, 5, 3, 5, col, 0, 12, 0.3);
      m.reset();
      this.colliders.push({ x: p.x, z: p.y, r: 9 }); this.mark(p.x, p.y, 16);
    }
  }
  atlasRect(id) { return this.atlas.rects[id] || [0, 0, 0.01, 0.01]; }

  // ─────────── места вдоль дороги ───────────
  buildPlaces() {
    const P = this.P;
    for (const pl of this.C.ROUTE.places) {
      const s = pl.s * 1000, sd = pl.side;
      if (pl.kind === 'police') { // блокпост
        const p = this.R(s, sd * 10), g = p.h, m = this.mb(s), fx = sd * p.nx, fz = sd * p.ny;
        m.at(p.x, g, p.y, -fx, -fz);
        m.box(0, 0, 0, 3, 2.8, 2.6, '#f0f1f2', 0, { top: '#9aa0a6' }); m.box(0, 2.0, 0, 3.02, 0.3, 2.62, '#2c5ca8', 0);
        m.quad([-1.2, 1.1, 1.31], [1.2, 1.1, 1.31], [1.2, 1.9, 1.31], [-1.2, 1.9, 1.31], '#f2dca0', MAT.window);
        const r = this.atlasRect('dps'); m.quad([-0.8, 2.9, 1.31], [0.8, 2.9, 1.31], [0.8, 3.5, 1.31], [-0.8, 3.5, 1.31], '#ffffff', MAT.atlasGlow, [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]]);
        for (let k = 0; k < 6; k++) m.box(-8 + k * 3.2, 0, 4.5, 2.4, 0.8, 0.7, k % 2 ? '#b9b6ae' : '#a8a59c', 0, { taper: 0.15 });
        m.box(2.5, 0, 3.2, 0.25, 1.1, 0.25, '#555'); for (let k = 0; k < 6; k++) m.box(2.5, 1.05 + k * 0.9, 3.2, 0.12, 0.9, 0.12, k % 2 ? '#f4f4f0' : P.barrier); // поднятый шлагбаум
        m.box(0, 0, -5, 0.15, 5.5, 0.15, '#777'); m.box(0, 5.4, -5, 0.8, 0.3, 0.5, '#444');
        m.reset();
        this.light(p.x, g + 5, p.y, [1, 0.85, 0.6], 22, 'lamp', { pool: 9 });
        // полосатый бело-синий «жигуль» ДПС
        const c = this.R(s + 14, sd * 9.5); m.at(c.x, c.h, c.y, c.ny * sd, -c.nx * sd); m.box(0, 0.3, 0, 1.7, 0.7, 4.1, '#eceeef', 0); m.box(0, 0.62, 0, 1.72, 0.14, 4.12, '#2c5ca8', 0); m.box(0, 1.0, -0.2, 1.4, 0.45, 2, '#1d2a33', 0, { top: '#eceeef', taper: 0.1 }); m.box(0, 1.45, -0.2, 0.9, 0.12, 0.25, '#2c5ca8', MAT.glow); m.reset();
        this.box(p.x, p.y, fx, fz, 1.6, 1.4); this.mark(p.x, p.y, 12);
      } else if (pl.kind === 'fuel') {
        const p = this.R(s, sd * 22), g = this.gnd(p.x, p.y), m = this.mb(s), fx = -sd * p.nx, fz = -sd * p.ny;
        this.t.flat.push({ s0: s - 30, s1: s + 30, o0: sd > 0 ? 6 : -40, o1: sd > 0 ? 40 : -6, dh: 0 });
        m.at(p.x, g, p.y, fx, fz);
        m.box(0, 4.8, 0, 14, 0.8, 9, '#f4f4f0', 0, { side: P.barrier }); m.quad([-6.5, 4.78, -4], [6.5, 4.78, -4], [6.5, 4.78, 4], [-6.5, 4.78, 4], '#fff6e6', MAT.glow);
        for (const x of [-5.5, 5.5]) for (const z of [-3.5, 3.5]) m.box(x, 0, z, 0.4, 4.8, 0.4, '#dcdcdc', 0);
        for (const x of [-3, 3]) { m.box(x, 0, 0, 0.8, 0.2, 2.4, '#bcbcbc', 0); m.box(x, 0.2, 0, 0.6, 1.8, 0.9, '#e8e8e8', 0, { side: '#c8322b' }); }
        m.box(0, 0, -11, 12, 3.5, 6, '#d8d3c8', 0, { top: '#7f8a8c' });
        m.quad([-5, 1.2, -7.99], [5, 1.2, -7.99], [5, 2.6, -7.99], [-5, 2.6, -7.99], '#f2e2b8', MAT.window);
        let r = this.atlasRect('azs'); m.quad([-4, 3.6, -7.95], [4, 3.6, -7.95], [4, 4.6, -7.95], [-4, 4.6, -7.95], '#ffffff', MAT.atlasGlow, [[r[2], r[3]], [r[0], r[3]], [r[0], r[1]], [r[2], r[1]]]);
        m.box(9, 0, 5, 0.3, 6, 0.3, '#888'); r = this.atlasRect('price'); m.quad([8, 4, 5.16], [10, 4, 5.16], [10, 6, 5.16], [8, 6, 5.16], '#ffffff', MAT.atlasGlow, [[r[2], r[3]], [r[0], r[3]], [r[0], r[1]], [r[2], r[1]]]);
        m.reset();
        this.light(p.x, g + 4.4, p.y, [1, 0.97, 0.9], 30, 'fuel', { pool: 16, big: 1 });
        const b = this.R(s, sd * 33); this.box(b.x, b.y, fx, fz, 6, 3); this.mark(p.x, p.y, 20);
      } else if (pl.kind === 'food') {
        const p = this.R(s, sd * 19), g = this.gnd(p.x, p.y), m = this.mb(s), fx = -sd * p.nx, fz = -sd * p.ny;
        m.at(p.x, g, p.y, fx, fz);
        m.house(0, 0, 0, 7, 12, 3, 1.6, '#c9b48a', '#7f8a8c');
        for (const x of [-4, 0, 4]) m.quad([x - 1, 1, 3.51], [x + 1, 1, 3.51], [x + 1, 2.2, 3.51], [x - 1, 2.2, 3.51], '#f2c46b', MAT.window);
        const r = this.atlasRect('cafe'); m.quad([-3, 3.1, 3.7], [3, 3.1, 3.7], [3, 4.0, 3.7], [-3, 4.0, 3.7], '#ffffff', MAT.atlasGlow, [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]]);
        for (let k = 0; k < 3; k++) { m.box(-4 + k * 4, 0, 6.5, 1.2, 0.72, 1.2, '#eeeeee', 0); m.box(-4 + k * 4, 0, 6.5, 0.1, 2.2, 0.1, '#ccc'); m.cone(-4 + k * 4, 2.1, 6.5, 1.3, 0.5, 6, k % 2 ? '#c8322b' : '#2d6fb3'); }
        m.reset();
        this.light(p.x, g + 3, p.y, [1, 0.8, 0.5], 18, 'lamp', { pool: 8 });
        this.box(p.x, p.y, fx, fz, 6, 3.5); this.mark(p.x, p.y, 14);
      } else if (pl.kind === 'ruin') { // сторожевая башня
        const p = this.R(s, sd * pl.off), g = this.gnd(p.x, p.y), m = this.mb(s);
        m.at(p.x, g, p.y, -p.ny, p.nx);
        m.box(0, -3, 0, 5.6, 12, 5.6, '#8a8174', 0, { taper: 0.6 });
        m.box(-1, 9, -1, 3.2, 2.4, 3.2, '#7e766a', 0, { taper: 0.4 }); m.box(1.3, 9, 1.4, 2, 1.2, 2, '#857c70', 0);
        for (const y of [3, 6]) m.quad([-0.3, y, 2.66], [0.3, y, 2.66], [0.3, y + 0.9, 2.66], [-0.3, y + 0.9, 2.66], '#1a1714', 0);
        m.lump(4, 0.5, 2, 2, 1, 1.6, '#7e766a', 0, 4); m.lump(-3, 0.3, 4, 1.4, 0.8, 1.2, '#8a8174', 0, 6);
        m.reset(); this.colliders.push({ x: p.x, z: p.y, r: 4 }); this.mark(p.x, p.y, 10);
      } else if (pl.id === 'ezmi') { // ГЭС
        const p = this.R(s, sd * Math.min(pl.off, 120)), g = this.gnd(p.x, p.y), m = this.mb(s);
        m.at(p.x, g, p.y, -sd * p.nx, -sd * p.ny);
        m.box(0, -2, 0, 34, 14, 16, '#b3b0a8', 0, { top: '#7a7c7e' });
        for (let k = -14; k <= 14; k += 4) m.quad([k - 0.8, 6, 8.01], [k + 0.8, 6, 8.01], [k + 0.8, 10, 8.01], [k - 0.8, 10, 8.01], '#e6d9a8', MAT.window);
        for (const x of [-10, -4, 2]) m.cyl(x, 2, -8, 1.1, 60, 8, '#6d6f71', 0, 'z');
        m.box(14, 12, 0, 4, 4, 4, '#8e9092'); m.reset();
        this.light(p.x, g + 12, p.y, [1, 0.72, 0.4], 50, 'lamp', { pool: 20, big: 1 });
        this.mark(p.x, p.y, 30);
      }
    }
    // туалеты и «автосервис» за 3 км до КПП (chat: «туалет за 3 км до границы, там автосервис»)
    { const s = 2900, p = this.R(s, -16), g = this.gnd(p.x, p.y), m = this.mb(s);
      m.at(p.x, g, p.y, p.nx, p.ny);
      for (let k = 0; k < 3; k++) { m.box(-3 + k * 1.5, 0, 0, 1.3, 2.3, 1.3, '#2a79c9', 0, { top: '#e8e8e8' }); const r = this.atlasRect('toilet'); m.quad([-3.3 + k * 1.5, 1.4, 0.66], [-2.7 + k * 1.5, 1.4, 0.66], [-2.7 + k * 1.5, 2.0, 0.66], [-3.3 + k * 1.5, 2.0, 0.66], '#fff', MAT.atlas, [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]]); }
      m.box(6, 0, -3, 9, 4, 7, '#9a958a', 0, { top: '#7f8a8c' }); m.quad([2, 0.1, 0.51], [6, 0.1, 0.51], [6, 3.2, 0.51], [2, 3.2, 0.51], '#3a3f42', 0);
      m.reset(); this.light(p.x, g + 3, p.y, [1, 0.85, 0.6], 14, 'lamp', { pool: 7 }); this.mark(p.x, p.y, 10); this.box(p.x, p.y, p.nx, p.ny, 5, 2); }
    // армейская палатка у въезда — только когда действует правило (календарь: draftPoint)
    { const s = 185, p = this.R(s, -14), g = this.gnd(p.x, p.y), m = new MB();
      m.at(p.x, g, p.y, p.nx, p.ny);
      m.house(0, 0, 0, 5, 8, 1.2, 2, '#4d5a3a', '#556342');
      m.box(6, 0, 0, 2.4, 2.6, 6, '#4a553a', 0); m.box(6, 0.4, 3.6, 2.3, 1.8, 1.4, '#3f4a32', 0);
      m.reset(); this.cond.push({ rule: 'draftPoint', mesh: m, x: p.x, z: p.y, s }); }
  }

  // ─────────── посёлки (та же формула мест, что на карте) ───────────
  buildVillages() {
    const r = this.w.road, t = this.t, WALLS = ['#d8d3c8', '#d6b98a', '#a4553b', '#9a958a', '#e4dfd2', '#b59a78'], ROOFS = ['#7f8a8c', '#3d6e8f', '#9c3b2e', '#9c8f7a', '#6f7a7c', '#5a6b4a'];
    for (const pl of this.C.ROUTE.places) {
      if (!pl.houses) continue;
      let lit = 0;
      for (let k = 0; k < pl.houses; k++) {
        const hs = pl.s * 1000 + (hash01(k, pl.s * 100) - 0.5) * 380, side = pl.side * (hash01(k, 9) < 0.8 ? 1 : -1);
        const off = side * (16 + hash01(k, 3) * 70);
        const q = r.at(clamp(hs, 0, r.len), off);
        const gq = t.ground(q.x, q.y);
        if (gq.kind === 2 || gq.kind === 3 || Math.abs(gq.u) < 10) continue;
        const riv = t.RIV[gq.i] + t.DEV[gq.i]; if (Math.abs(gq.o - riv) < 24) continue;
        const w = 7 + hash01(k, 4) * 6, l = 8 + hash01(k, 5) * 8, a = Math.atan2(q.ny, q.nx) + (hash01(k, 6) - 0.5) * 0.4;
        const fx = -Math.sin(a), fz = Math.cos(a); // конёк вдоль дороги
        const floors = hash01(k, 12) < 0.25 ? 2 : 1, hgt = floors * 2.9, wall = WALLS[Math.floor(hash01(k, 13) * WALLS.length)], roof = ROOFS[Math.floor(hash01(k, 14) * ROOFS.length)];
        const m = this.mb(hs), g = gq.h;
        m.at(q.x, g, q.y, fx, fz);
        m.house(0, 0, 0, w, l, hgt, 1.4 + hash01(k, 15) * 1.2, wall, roof);
        // окна на длинных стенах (к дороге и от неё), часть светится ночью
        for (let f = 0; f < floors; f++) for (let z = -l / 2 + 1.8; z < l / 2 - 1; z += 2.8) for (const sd of [-1, 1]) {
          const on = hash01(k * 31 + Math.round(z * 3) + f * 7, sd + 20) < 0.38; if (on) lit++;
          const x = sd * (w / 2 + 0.03), y0 = 0.9 + f * 2.9, pts = [[x, y0, z - 0.55], [x, y0, z + 0.55], [x, y0 + 1.1, z + 0.55], [x, y0 + 1.1, z - 0.55]];
          if (sd > 0) pts.reverse();
          m.quad(...pts, on ? '#f2c46b' : '#1f2528', on ? MAT.window : 0);
        }
        // забор и сарай
        if (hash01(k, 16) < 0.6) { const fz0 = l / 2 + 3; for (let x = -w / 2 - 2; x < w / 2 + 2; x += 2) m.box(x + 1, 0, fz0, 2, 1.3, 0.08, hash01(k, 17) < 0.5 ? '#6b4a33' : '#7f8a8c', 0); }
        if (hash01(k, 18) < 0.4) m.house(w / 2 + 3, 0, -l / 4, 3, 4, 2, 0.6, '#7d6a52', '#6f7a7c');
        m.reset();
        this.box(q.x, q.y, fx, fz, w / 2 + 0.3, l / 2 + 0.3);
        this.mark(q.x, q.y, Math.max(w, l) / 2 + 6);
        if (hash01(k, 19) < 0.3) { const lp = r.at(clamp(hs, 0, r.len), off - side * (w / 2 + 1)); this.light(lp.x, g + 2.6, lp.y, [1, 0.72, 0.38], 14, 'house', { pool: 6 }); }
      }
    }
  }
  // ─────────── мосты (где Терек переходит под дорогой) ───────────
  buildBridges() {
    const t = this.t;
    for (let i = TPRE + 10; i < t.N - TPRE; i++) {
      if (Math.sign(t.RIV[i]) === Math.sign(t.RIV[i + 1])) continue;
      const s = t.sOf(i), m = this.mb(s);
      for (let ds = -26; ds < 26; ds += 2) {
        for (const sd of [-1, 1]) {
          const a = t.at(s + ds, sd * 5.2), b = t.at(s + ds + 2, sd * 5.2);
          m.quad([a.x, a.h - 0.5, a.y], [b.x, b.h - 0.5, b.y], [b.x, b.h + 0.95, b.y], [a.x, a.h + 0.95, a.y], '#a9a69e', 0);
          const a2 = t.at(s + ds, sd * 5.6), b2 = t.at(s + ds + 2, sd * 5.6);
          m.quad([a2.x, a2.h + 0.95, a2.y], [b2.x, b2.h + 0.95, b2.y], [b.x, b.h + 0.95, b.y], [a.x, a.h + 0.95, a.y], '#b9b6ae', 0);
          m.quad([a2.x, a2.h - 1.2, a2.y], [b2.x, b2.h - 1.2, b2.y], [b2.x, b2.h + 0.95, b2.y], [a2.x, a2.h + 0.95, a2.y], '#8f8c85', 0);
        }
        const a = t.at(s + ds, -5.6), b = t.at(s + ds + 2, -5.6), c = t.at(s + ds + 2, 5.6), d = t.at(s + ds, 5.6);
        m.quad([a.x, a.h - 1.2, a.y], [d.x, d.h - 1.2, d.y], [c.x, c.h - 1.2, c.y], [b.x, b.h - 1.2, b.y], '#6f6c66', 0);
      }
      i += 20;
    }
  }
  // ─────────── отбойники вдоль реки ───────────
  buildRails() {
    const t = this.t;
    for (let i = TPRE + 60; i < t.N - TPRE; i += 2) {
      const riv = t.RIV[i]; if (Math.abs(riv) > 52) continue;
      const sd = Math.sign(riv), s = t.sOf(i), a = t.at(s, sd * 7.4), b = t.at(s + 8, sd * 7.4), m = this.mb(s);
      m.quad([a.x, a.h + 0.45, a.y], [b.x, b.h + 0.45, b.y], [b.x, b.h + 0.78, b.y], [a.x, a.h + 0.78, a.y], '#a3a7aa', 0);
      m.at(a.x, a.h - 0.3, a.y, -a.ny, a.nx); m.box(0, 0, 0, 0.12, 1.05, 0.12, '#6d7074', 0); m.reset();
      i += 0;
    }
  }
  // ─────────── ЛЭП (от ГЭС вдоль ущелья) ───────────
  buildPylons() {
    const t = this.t, pts = [];
    for (let s = 400; s < this.w.road.len + 1500; s += 290) {
      const i = Math.round(t.iOf(s)), sd = -Math.sign(t.RIV[i] || 1), gw = sd < 0 ? t.GW[i] : t.GE[i];
      const u = sd * Math.min(gw - 12, 26 + 10 * h01(Math.round(s), 3)), p = t.at(s, u), g = this.gnd(p.x, p.y), m = this.mb(s);
      m.at(p.x, g, p.y, -p.ny, p.nx);
      for (const a of [-1, 1]) for (const b of [-1, 1]) { m.quad([a * 1.6, 0, b * 1.6], [a * 0.35, 22, b * 0.35], [a * 0.35 + 0.18, 22, b * 0.35], [a * 1.6 + 0.2, 0, b * 1.6], '#5b5f63', 0); }
      m.box(0, 18, 0, 9, 0.35, 0.35, '#5b5f63', 0); m.box(0, 21.5, 0, 6, 0.3, 0.3, '#5b5f63', 0);
      m.reset();
      this.colliders.push({ x: p.x, z: p.y, r: 1.8 });
      const R = [-p.ny, p.nx]; // поперёк дороги? плечи вдоль нормали
      pts.push([[p.x + p.nx * -4.3, g + 17.8, p.y + p.ny * -4.3], [p.x + p.nx * 4.3, g + 17.8, p.y + p.ny * 4.3], [p.x + p.nx * -2.8, g + 21.3, p.y + p.ny * -2.8], [p.x + p.nx * 2.8, g + 21.3, p.y + p.ny * 2.8]]);
    }
    // провода с провисом
    const W = [];
    for (let k = 0; k < pts.length - 1; k++) for (let w = 0; w < 4; w++) {
      const a = pts[k][w], b = pts[k + 1][w];
      for (let j = 0; j < 10; j++) {
        const f0 = j / 10, f1 = (j + 1) / 10, sag = f => 4 * f * (1 - f) * 6;
        W.push(lerp(a[0], b[0], f0), lerp(a[1], b[1], f0) - sag(f0), lerp(a[2], b[2], f0), lerp(a[0], b[0], f1), lerp(a[1], b[1], f1) - sag(f1), lerp(a[2], b[2], f1));
      }
    }
    this.wires = new Float32Array(W);
  }
  // ─────────── знаки ───────────
  sign(s, u, face, id, w, h, y0, post = true, glow = false) {
    const p = this.R(s, u), g = this.gnd(p.x, p.y), m = this.mb(s), r = this.atlasRect(id);
    const fx = face * -p.ny, fz = face * p.nx; // face +1 — к хвосту (навстречу очереди)
    m.at(p.x, g, p.y, -fx, -fz);
    if (post) for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) m.box(x, 0, 0.06, 0.1, y0 + h, 0.1, '#8b9094', 0);
    m.box(0, y0, 0, w + 0.1, h + 0.1, 0.06, '#9aa0a6', 0);
    m.quad([w / 2, y0 + 0.05, -0.04], [-w / 2, y0 + 0.05, -0.04], [-w / 2, y0 + h + 0.05, -0.04], [w / 2, y0 + h + 0.05, -0.04], '#ffffff', glow ? MAT.atlasGlow : MAT.atlas, [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]]);
    m.reset();
  }
  buildSigns() {
    const q = this.w.queue;
    this.sign(700, -8.8, 1, 'border', 1.6, 1.0, 1.3);
    this.sign(q.gateS + 40, 9.5, 1, 'dir', 2.4, 1.2, 2.2);
    this.sign(10000, -9, 1, 'dir', 2.4, 1.2, 2.2);
    for (const pl of this.C.ROUTE.places) if (pl.kind === 'village' && this.atlas.rects['v_' + pl.id]) {
      this.sign(pl.s * 1000 + 380, -9, 1, 'v_' + pl.id, 2.0, 0.65, 1.4);
      this.sign(pl.s * 1000 - 380, 9, -1, 'v_' + pl.id, 2.0, 0.65, 1.4);
    }
    if (this.atlas.rects.v_ezmi) this.sign(7200, 9, 1, 'v_ezmi', 2.0, 0.65, 1.4);
  }
  // ─────────── лотки продавцов (каждый — своя сетка: появляется по времени «from») ───────────
  buildSellers() {
    const E = this.w.econ, P = this.P;
    for (const o of E.sellers) {
      const road = this.w.road.at(o.s, 0), fx = -o.side * road.nx, fz = -o.side * road.ny; // лицом к дороге
      const g = this.gnd(o.x, o.y), m = new MB(), npc = o.npc && this.w.npcDefs.get(o.npc);
      const free = o.priceMul === 0, kind = free ? 'tent' : npc ? 'table' : o.name === 'Ларёк' ? 'kiosk' : o.name === 'Кафе' ? 'tent' : 'table';
      const hh = h01(o.s | 0, 3);
      m.at(o.x, g, o.y, fx, fz);
      m.quad([-2.2, 0.03, -1.8], [2.2, 0.03, -1.8], [2.2, 0.03, 1.4], [-2.2, 0.03, 1.4], '#000', MAT.shadow);
      if (kind === 'kiosk') {
        m.box(0, 0, -0.6, 2.6, 2.5, 2.2, '#e8e8e4', 0, { top: '#2d6fb3' });
        m.quad([-1.1, 0.9, 0.51], [1.1, 0.9, 0.51], [1.1, 2.0, 0.51], [-1.1, 2.0, 0.51], '#f2d9a0', MAT.window);
      } else if (kind === 'tent') {
        const c = free ? '#2d6fb3' : hh < 0.5 ? '#c8322b' : '#3d6e8f';
        for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.2]) m.box(x, 0, z, 0.08, 2.2, 0.08, '#ccc', 0);
        m.quad([-1.8, 2.2, 1.4], [1.8, 2.2, 1.4], [1.8, 2.7, -0.2], [-1.8, 2.7, -0.2], c, 0);
        m.quad([-1.8, 2.7, -0.2], [1.8, 2.7, -0.2], [1.8, 2.2, -1.8], [-1.8, 2.2, -1.8], c, 0);
        m.quad([-1.8, 2.2, -1.8], [1.8, 2.2, -1.8], [1.8, 0.4, -1.8], [-1.8, 0.4, -1.8], c, 0);
      } else {
        m.box(0, 2.3, -0.3, 0.06, 0.06, 0.06, '#ccc');
        m.box(0, 0, -0.6, 0.06, 2.3, 0.06, '#bbb', 0);
        m.cone(0, 2.0, -0.6, 1.9, 0.55, 8, hh < 0.33 ? '#c8322b' : hh < 0.66 ? '#e8e0c8' : '#3d6e8f');
      }
      if (kind !== 'kiosk') {
        m.box(0, 0, 0.4, 1.9, 0.78, 0.8, free ? '#e4e4e4' : '#8a6a4a', 0, { top: free ? '#f0f0f0' : '#c9b48a' });
        // товар на столе
        for (let k = 0; k < 5; k++) m.box(-0.7 + k * 0.35, 0.78, 0.4 + (h01(k, o.s | 0) - 0.5) * 0.3, 0.2, 0.12 + h01(k, 7) * 0.2, 0.2, ['#e8e4d0', '#c89a4a', '#3a6fb0', '#d0d0d0', '#a8322a'][k], 0);
        if (o.goods.includes('tea') || o.goods.includes('coffee')) { m.cyl(0.6, 0.78, 0.3, 0.12, 0.35, 6, '#b8bcc0'); m.cyl(-0.5, 0.78, 0.25, 0.1, 0.3, 6, '#c8322b'); }
        // ящики и табуретка
        m.box(1.5, 0, 0.2, 0.5, 0.45, 0.4, '#6b4a33', 0); m.box(-1.4, 0, -0.8, 0.5, 0.5, 0.5, '#8a8f94', 0);
        if (npc && npc.id === 'zaur') { m.box(1.8, 0, -0.9, 0.7, 0.8, 0.7, '#2a2a2a', 0); m.box(1.8, 0.8, -0.9, 0.45, 0.12, 0.45, '#ff7a2a', MAT.glow); } // печка
      }
      // вывеска
      const sid = free ? 'sos' : o.goods.includes('pie') ? 's_pie' : o.goods.includes('bike') ? 's_bike' : o.goods.includes('meds') && !o.goods.includes('water') ? 's_meds' : o.accepts.includes('cash_usd') && hh < 0.5 ? 's_usd' : o.goods.includes('tea') ? 's_tea' : o.goods.includes('charge') ? 's_charge' : o.goods.includes('water') ? 's_water' : 's_food';
      const r = this.atlasRect(sid), sw = free ? 1.8 : 1.3;
      m.quad([sw / 2, 0.85, 0.81], [-sw / 2, 0.85, 0.81], [-sw / 2, 0.85 + sw * 0.34, 0.83], [sw / 2, 0.85 + sw * 0.34, 0.83], '#ffffff', MAT.atlas, [[r[0], r[3]], [r[2], r[3]], [r[2], r[1]], [r[0], r[1]]]);
      m.quad([-sw / 2, 0.02, 0.81], [sw / 2, 0.02, 0.81], [sw / 2, 0.85, 0.81], [-sw / 2, 0.85, 0.81], free ? '#e4e4e4' : '#8a6a4a', 0);
      // лампа
      m.box(-1.2, 0, 1.0, 0.05, 2.4, 0.05, '#333'); m.box(-1.2, 2.3, 0.9, 0.16, 0.16, 0.16, '#fff1c8', MAT.glow);
      m.reset();
      const lp = { x: o.x + (-fz) * -1.2 * 1 + fx * 0.9, z: o.y + fx * -1.2 + fz * 0.9 };
      this.sellers.push({ o, mesh: m, x: o.x, z: o.y, g, fx, fz, lamp: [o.x - (-fz) * 1.2 + fx * 0.9, g + 2.3, o.y - fx * 1.2 + fz * 0.9] });
      this.colliders.push({ x: o.x + fx * 0.4, z: o.y + fz * 0.4, r: 1.1, seller: o });
      this.mark(o.x, o.y, 6);
    }
  }
  // ─────────── дальние вершины ───────────
  buildPeaks() {
    const m = new MB(), k0 = this.t.at(0, 0), baseY = -1115;
    for (const pk of this.C.ROUTE.peaks || []) {
      const cx = k0.x + pk.x * 1000, cz = k0.y + pk.y * 1000, H = pk.h + baseY, R = pk.r * 1000, n = 14, rings = pk.flat ? [[1, -400], [0.72, H * 0.8], [0.55, H], [0, H]] : [[1, -400], [0.6, H * 0.55], [0.3, H * 0.85], [0, H]];
      const pt = (ri, a) => { const [rf, y] = rings[ri]; const j = 1 + (h01(Math.round(a * 100) + ri * 7, Math.round(cx)) - 0.5) * 0.35 * (ri < 3 ? 1 : 0); return [cx + Math.cos(a) * R * rf * j, y + (ri > 0 && ri < 3 ? (h01(Math.round(a * 77), ri) - 0.5) * H * 0.1 : 0), cz + Math.sin(a) * R * rf * j]; };
      for (let ri = 0; ri < rings.length - 1; ri++) for (let i = 0; i < n; i++) {
        const a0 = i / n * 6.283, a1 = (i + 1) / n * 6.283;
        const snow = rings[ri + 1][1] > H - (H + 1115) * 0.35 * pk.snow * (pk.flat ? 0.3 : 1) - 200 && pk.snow > 0.15;
        const c = snow ? this.P.snow : ri === 0 ? '#5b5d55' : '#6d6b68';
        m.quad(pt(ri, a0), pt(ri, a1), pt(ri + 1, a1), pt(ri + 1, a0), c, 0);
      }
    }
    // кольцо дальних хребтов (горизонт): 48 зубцов в 21–24 км от середины очереди
    for (let i = 0; i < 48; i++) {
      const a0 = i / 48 * 6.283, a1 = (i + 1) / 48 * 6.283, R0 = 21000 + h01(i, 5) * 3000, R1 = 21000 + h01(i + 1, 5) * 3000;
      const hh = 1200 + fbm(i * 0.3, 0, 51, 3) * 1600, hh1 = 1200 + fbm((i + 1) * 0.3, 0, 51, 3) * 1600;
      const cx = k0.x, cz = k0.y - 12000;
      const A = [cx + Math.cos(a0) * R0, -500, cz + Math.sin(a0) * R0], B = [cx + Math.cos(a1) * R1, -500, cz + Math.sin(a1) * R1];
      const C2 = [cx + Math.cos(a1) * R1, hh1, cz + Math.sin(a1) * R1], D = [cx + Math.cos(a0) * R0, hh, cz + Math.sin(a0) * R0];
      m.quad(A, B, C2, D, '#62655f', 0);
      const mid = [(C2[0] + D[0]) / 2, Math.max(hh, hh1) + 500 + h01(i, 8) * 600, (C2[2] + D[2]) / 2];
      m.tri(D, C2, mid, h01(i, 9) < 0.5 ? '#e8edf2' : '#6d6b68', 0);
    }
    this.peaks = m;
  }
}
return { Scene, makeAtlas, makeAsphalt };
});
