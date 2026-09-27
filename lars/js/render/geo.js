// Процедурная геометрия (без файлов): построитель сеток с плоскими нормалями + модели —
// машины по типу кузова, человек из частей (скелет в шейдере), деревья, велосипед/самокат, салон своей машины.
// Формат вершины: pos f32×3 · normal i8×4 · color u8×4 (rgb + материал в a) · uv u16×2.
// Материалы (a): 0 свет · 1 окно (светится ночью) · 2 светится всегда · 3 атлас · 4 атлас светящийся · 5 листва (оттенок инстанса)
//                6 стекло · 7 стоп-сигнал · 8 фара · 9 багаж (только если флаг) · 10 тень-пятно · 11 кузов (цвет инстанса) · 12 номер
'use strict';
L.def('render/geo', () => {
const { hex } = L.use('render/gl');

const MAT = { lit: 0, window: 1, glow: 2, atlas: 3, atlasGlow: 4, leaf: 5, glass: 6, tail: 7, head: 8, luggage: 9, shadow: 10, body: 11, plate: 12 };

class MB {
  constructor() { this.P = []; this.N = []; this.C = []; this.U = []; this.n = 0; this.tf = null; }
  // локальная система: начало (x,y,z), «вперёд» (fx,fz), масштаб
  at(x = 0, y = 0, z = 0, fx = 0, fz = 1, k = 1) { this.tf = { x, y, z, fx, fz, k }; return this; }
  reset() { this.tf = null; return this; }
  xf(p) {
    const t = this.tf; if (!t) return p;
    const lx = p[0] * t.k, ly = p[1] * t.k, lz = p[2] * t.k;
    return [t.x - lx * t.fz + lz * t.fx, t.y + ly, t.z + lx * t.fx + lz * t.fz];
  }
  // col: '#hex' | [r,g,b] 0..1 | [r,g,b,partId,slot] для людей (в r,g — индексы)
  tri(a, b, c, col, mat = 0, ua = null, ub = null, uc = null) {
    a = this.xf(a); b = this.xf(b); c = this.xf(c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const cc = typeof col === 'string' ? hex(col) : col;
    const raw = cc.raw;
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) {
      this.P.push(p[0], p[1], p[2]); this.N.push(nx * 127 | 0, ny * 127 | 0, nz * 127 | 0, 0);
      if (raw) this.C.push(cc[0], cc[1], cc[2], mat); else this.C.push(Math.round(cc[0] * 255), Math.round(cc[1] * 255), Math.round(cc[2] * 255), mat);
      this.U.push(u ? Math.round(u[0] * 65535) : 0, u ? Math.round(u[1] * 65535) : 0);
      this.n++;
    }
  }
  quad(a, b, c, d, col, mat = 0, uv = null) { this.tri(a, b, c, col, mat, uv && uv[0], uv && uv[1], uv && uv[2]); this.tri(a, c, d, col, mat, uv && uv[0], uv && uv[2], uv && uv[3]); }
  // коробка с центром основания (cx, y0, cz), размеры w (x), h (y), d (z); top — сужение верха (0..)
  box(cx, y0, cz, w, h, d, col, mat = 0, o = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const ti = o.taper || 0, tx0 = x0 + ti, tx1 = x1 - ti, tz0 = z0 + (o.taperZ || 0), tz1 = z1 - (o.taperZ || 0);
    const topc = o.top || col, sidec = o.side || col;
    const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y0, z1], D = [x0, y0, z1];
    const E = [tx0, y1, tz0], F = [tx1, y1, tz0], G = [tx1, y1, tz1], H = [tx0, y1, tz1];
    if (!o.noTop) this.quad(E, H, G, F, topc, o.topMat ?? mat);
    if (o.bottom) this.quad(A, B, C, D, col, mat);
    this.quad(A, E, F, B, o.back || sidec, o.backMat ?? mat);   // −z
    this.quad(D, C, G, H, o.front || sidec, o.frontMat ?? mat); // +z
    this.quad(A, D, H, E, sidec, mat);                          // −x
    this.quad(B, F, G, C, sidec, mat);                          // +x
  }
  // цилиндр вдоль оси: axis 'y' | 'x' | 'z'
  cyl(cx, cy, cz, r, len, n, col, mat = 0, axis = 'y', caps = true, r2 = null) {
    r2 = r2 ?? r;
    const P = (a, t, rr) => { const c = Math.cos(a) * rr, s = Math.sin(a) * rr; return axis === 'y' ? [cx + c, cy + t, cz + s] : axis === 'x' ? [cx + t, cy + c, cz + s] : [cx + c, cy + s, cz + t]; };
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      this.quad(P(a0, 0, r), P(a1, 0, r), P(a1, len, r2), P(a0, len, r2), col, mat);
      if (caps) { this.tri(P(0, 0, 0), P(a1, 0, r), P(a0, 0, r), col, mat); if (r2 > 0) this.tri(P(0, len, 0), P(a0, len, r2), P(a1, len, r2), col, mat); }
    }
  }
  cone(cx, cy, cz, r, h, n, col, mat = 0) { this.cyl(cx, cy, cz, r, h, n, col, mat, 'y', true, 0.0001); }
  // «ком»: икосаэдр с шумом (листва, камни)
  lump(cx, cy, cz, rx, ry, rz, col, mat = 0, seed = 1, jit = 0.25) {
    const t = (1 + Math.sqrt(5)) / 2;
    const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v, i) => {
      const l = Math.hypot(...v), j = 1 + (h01(i, seed) - 0.5) * 2 * jit;
      return [cx + v[0] / l * rx * j, cy + v[1] / l * ry * j, cz + v[2] / l * rz * j];
    });
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (const f of F) this.tri(V[f[0]], V[f[1]], V[f[2]], typeof col === 'function' ? col(f) : col, mat);
  }
  // двускатный дом: основание w×d, стены h, конёк вдоль z
  house(cx, y0, cz, w, d, h, roofH, wall, roof, o = {}) {
    this.box(cx, y0 - 3, cz, w, h + 3, d, wall, 0, { noTop: true });
    const x0 = cx - w / 2 - 0.4, x1 = cx + w / 2 + 0.4, z0 = cz - d / 2 - 0.4, z1 = cz + d / 2 + 0.4, y = y0 + h, yr = y + roofH;
    this.quad([x0, y, z0], [x0, y, z1], [cx, yr, z1], [cx, yr, z0], roof, 0);
    this.quad([x1, y, z1], [x1, y, z0], [cx, yr, z0], [cx, yr, z1], roof, 0);
    this.tri([cx - w / 2, y, cz - d / 2], [cx + w / 2, y, cz - d / 2], [cx, yr, cz - d / 2], wall, 0);
    this.tri([cx + w / 2, y, cz + d / 2], [cx - w / 2, y, cz + d / 2], [cx, yr, cz + d / 2], wall, 0);
    this.quad([x0, y - 0.15, z0], [x0, y - 0.15, z1], [x0, y, z1], [x0, y, z0], roof, 0);
    this.quad([x1, y - 0.15, z1], [x1, y - 0.15, z0], [x1, y, z0], [x1, y, z1], roof, 0);
  }
  concat(m) { for (const k of ['P', 'N', 'C', 'U']) { const a = this[k], b = m[k]; for (let i = 0; i < b.length; i++) a.push(b[i]); } this.n += m.n; }
  // o — начало координат сетки (мир в км от нуля: вершины от своего начала точнее во float32)
  arrays(o = null) {
    let pos;
    if (o) { pos = new Float32Array(this.P.length); for (let i = 0; i < pos.length; i += 3) { pos[i] = this.P[i] - o[0]; pos[i + 1] = this.P[i + 1] - o[1]; pos[i + 2] = this.P[i + 2] - o[2]; } }
    else pos = new Float32Array(this.P);
    return { n: this.n, pos, nrm: new Int8Array(this.N), col: new Uint8Array(this.C), uv: new Uint16Array(this.U), org: o || [0, 0, 0] };
  }
}
function h01(a, b) { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// ─────────── машины ───────────
// Типы кузова: w, l — номинал (инстанс масштабирует по модели), профиль: низ, пояс, крыша, кабина (z от−до), колёса
const BODY = {
  sedan: { w: 1.75, l: 4.4, bot: 0.3, belt: 0.92, roof: 1.45, hood: 0.88, trunk: 0.95, cab: [-1.25, 1.0], rake: [0.55, 0.75], wr: 0.31, wz: 1.35 },
  hatch: { w: 1.78, l: 4.3, bot: 0.3, belt: 0.93, roof: 1.47, hood: 0.88, trunk: 0.93, cab: [-2.0, 0.95], rake: [0.35, 0.8], wr: 0.31, wz: 1.3 },
  suv: { w: 1.82, l: 4.5, bot: 0.42, belt: 1.05, roof: 1.68, hood: 1.0, trunk: 1.05, cab: [-2.12, 0.9], rake: [0.2, 0.75], wr: 0.36, wz: 1.35 },
  jeep: { w: 1.9, l: 4.8, bot: 0.45, belt: 1.12, roof: 1.86, hood: 1.1, trunk: 1.12, cab: [-2.3, 0.85], rake: [0.08, 0.45], wr: 0.39, wz: 1.45 },
  wagon: { w: 1.78, l: 4.6, bot: 0.34, belt: 1.0, roof: 1.72, hood: 0.95, trunk: 1.0, cab: [-2.22, 1.0], rake: [0.12, 0.75], wr: 0.32, wz: 1.45 },
  van: { w: 2.0, l: 5.6, bot: 0.4, belt: 1.15, roof: 2.3, hood: 1.08, trunk: 1.15, cab: [-2.72, 1.8], rake: [0.05, 0.5], wr: 0.36, wz: 1.75 },
};
function carMesh(type, detail = true) {
  const B = BODY[type] || BODY.sedan, m = new MB(), hw = B.w / 2, hl = B.l / 2;
  const body = [1, 1, 1], glass = '#1d2a33', dark = '#1a1b1d', grey = '#9a9ea2', tire = '#141414';
  // тень — мягкое пятно (blob) в view3d; плоский чёрный квад здесь лежал вровень с асфальтом и мерцал
  // наклейки (пороги, стойки, фары, номера) — не ближе 1,2 см к своей грани: иначе вдали z-fighting
  // нижний кузов: профиль (z, y) по кругу, выдавлен поперёк; верх уже на ti
  const ti = 0.07;
  const prof = [[-hl, B.bot + 0.02], [-hl, B.trunk - 0.18], [-hl + 0.12, B.trunk], [B.cab[0] + (type === 'sedan' ? 0 : 0.05), B.belt], [B.cab[1], B.belt], [hl - 0.35, B.hood], [hl, B.hood - 0.2], [hl, B.bot + 0.05]];
  const L = (p, top) => [-(hw - (top ? ti : 0)), p[1], p[0]], R = (p, top) => [hw - (top ? ti : 0), p[1], p[0]];
  const isTop = i => i >= 2 && i <= 5;
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i], b = prof[(i + 1) % prof.length];
    m.quad(L(a, isTop(i)), R(a, isTop(i)), R(b, isTop((i + 1) % prof.length)), L(b, isTop((i + 1) % prof.length)), body, MAT.body);
  }
  for (const side of [-1, 1]) { // боковины — веер
    const S = (p, i) => side < 0 ? L(p, isTop(i)) : R(p, isTop(i));
    for (let i = 1; i < prof.length - 1; i++) m.tri(S(prof[0], 0), S(prof[i], i), S(prof[i + 1], i + 1), body, MAT.body);
    // тёмная полоса внизу (пороги) и колёсные арки
    m.quad([side * (hw + 0.012), B.bot, -hl + 0.1], [side * (hw + 0.012), B.bot, hl - 0.1], [side * (hw + 0.012), B.bot + 0.12, hl - 0.1], [side * (hw + 0.012), B.bot + 0.12, -hl + 0.1], dark, 0);
  }
  // кабина: трапеция по z, сужается кверху; бока/лобовое/заднее — стекло, крыша — кузов
  const [c0, c1] = B.cab, [rr, rf] = B.rake, bw = hw - 0.1, rw = hw - 0.24, y0 = B.belt, y1 = B.roof;
  const P = { lb: [-bw, y0, c0], rb: [bw, y0, c0], lf: [-bw, y0, c1], rf: [bw, y0, c1], lbt: [-rw, y1, c0 + rr], rbt: [rw, y1, c0 + rr], lft: [-rw, y1, c1 - rf], rft: [rw, y1, c1 - rf] };
  m.quad(P.lbt, P.lft, P.rft, P.rbt, body, MAT.body);                    // крыша
  m.quad(P.lf, P.rf, P.rft, P.lft, glass, MAT.glass);                    // лобовое
  m.quad(P.rb, P.lb, P.lbt, P.rbt, glass, MAT.glass);                    // заднее
  m.quad(P.lb, P.lf, P.lft, P.lbt, glass, MAT.glass);                    // левое
  m.quad(P.rf, P.rb, P.rbt, P.rft, glass, MAT.glass);                    // правое
  if (detail) {
    // стойки: тонкие полосы кузова поверх стекла (B-стойка и края)
    const mid = (c0 + rr + c1 - rf) / 2 + 0.05;
    for (const s of [-1, 1]) {
      const xb = s * (bw + 0.012), xt = s * (rw + 0.012);
      const zb = (c0 + c1) / 2 + 0.05;
      m.quad([xb, y0, zb - 0.06], [xb, y0, zb + 0.06], [xt, y1, mid + 0.06], [xt, y1, mid - 0.06], body, MAT.body);
      m.quad([xb, y0, c1 - 0.02], [xb, y0, c1 - 0.12], [xt, y1, c1 - rf - 0.08], [xt, y1, c1 - rf + 0.02], body, MAT.body);
      m.box(s * (hw + 0.07), y0 - 0.02, c1 - 0.1, 0.12, 0.1, 0.08, body, MAT.body); // зеркало
    }
    // фары, фонари, решётка, номера
    const fz = hl + 0.012, bz = -hl - 0.012, hy = B.hood - 0.3;
    for (const s of [-1, 1]) {
      m.quad([s * (hw - 0.12), hy, fz], [s * (hw - 0.45), hy, fz], [s * (hw - 0.45), hy + 0.13, fz], [s * (hw - 0.12), hy + 0.13, fz], '#e8e4d6', MAT.head);
      m.quad([s * (hw - 0.45), B.trunk - 0.3, bz], [s * (hw - 0.1), B.trunk - 0.3, bz], [s * (hw - 0.1), B.trunk - 0.15, bz], [s * (hw - 0.45), B.trunk - 0.15, bz], '#8a1512', MAT.tail);
    }
    m.quad([-hw + 0.5, hy - 0.02, fz], [hw - 0.5, hy - 0.02, fz], [hw - 0.5, hy + 0.1, fz], [-hw + 0.5, hy + 0.1, fz], dark, 0);
    m.quad([0.26, B.bot + 0.12, fz + 0.01], [-0.26, B.bot + 0.12, fz + 0.01], [-0.26, B.bot + 0.23, fz + 0.01], [0.26, B.bot + 0.23, fz + 0.01], '#ffffff', MAT.plate, [[1, 1], [0, 1], [0, 0], [1, 0]]);
    m.quad([-0.26, B.bot + 0.2, bz - 0.01], [0.26, B.bot + 0.2, bz - 0.01], [0.26, B.bot + 0.31, bz - 0.01], [-0.26, B.bot + 0.31, bz - 0.01], '#ffffff', MAT.plate, [[1, 1], [0, 1], [0, 0], [1, 0]]);
    // бамперы
    m.box(0, B.bot, hl - 0.05, B.w - 0.1, 0.18, 0.16, dark, 0);
    m.box(0, B.bot, -hl + 0.05, B.w - 0.1, 0.18, 0.16, dark, 0);
    // багаж на крыше (виден, если флаг)
    m.box(0, y1, (c0 + rr + c1 - rf) / 2, rw * 1.7, 0.32, (c1 - rf - c0 - rr) * 0.8, '#3a3128', MAT.luggage, { taper: 0.04, top: '#4a3f33' });
    m.box(0.3, y1 + 0.3, (c0 + rr + c1 - rf) / 2 - 0.2, 0.5, 0.2, 0.6, '#2d4f82', MAT.luggage);
  }
  // колёса
  const n = detail ? 8 : 6;
  for (const zs of [-1, 1]) for (const s of [-1, 1]) {
    const cz = zs * B.wz, cx = s * (hw - 0.14);
    m.cyl(cx - 0.11, B.wr, cz, B.wr, 0.22, n, tire, 0, 'x');
    if (detail) m.cyl(cx + s * 0.115 - 0.02, B.wr, cz, B.wr * 0.55, 0.04, 6, grey, 0, 'x');
  }
  return m;
}
// простая коробка-машина (дальний LOD)
function carBox() {
  const m = new MB(); const body = [1, 1, 1];
  m.box(0, 0.3, 0, 1.76, 0.62, 4.4, body, MAT.body);
  m.box(0, 0.92, -0.15, 1.5, 0.5, 2.2, '#1d2a33', MAT.glass, { taper: 0.1, top: body, topMat: MAT.body });
  m.quad([-0.85, 0.72, -2.23], [-0.45, 0.72, -2.23], [-0.45, 0.85, -2.23], [-0.85, 0.85, -2.23], '#8a1512', MAT.tail);
  m.quad([0.45, 0.72, -2.23], [0.85, 0.72, -2.23], [0.85, 0.85, -2.23], [0.45, 0.85, -2.23], '#8a1512', MAT.tail);
  return m;
}

// ─────────── салон своей машины (вид водителя) ───────────
function interiorMesh(type = 'sedan', colHex = '#8e969f') {
  const B = BODY[type] || BODY.sedan, m = new MB(), hw = B.w / 2, hl = B.l / 2, body = colHex;
  const dash = '#26292c', trim = '#3a3d40', seat = '#2b2d30', roofc = '#8d8a82';
  const [c0, c1] = B.cab, [rr, rf] = B.rake, y0 = B.belt, y1 = B.roof;
  // капот (виден в лобовое)
  m.quad([-hw + 0.05, B.hood, c1], [hw - 0.05, B.hood, c1], [hw - 0.2, B.hood - 0.08, hl - 0.25], [-hw + 0.2, B.hood - 0.08, hl - 0.25], body, 0);
  // торпедо
  m.box(0, y0 - 0.25, c1 - 0.25, B.w - 0.14, 0.33, 0.55, dash, 0, { taperZ: 0.05 });
  m.box(-0.37, y0 + 0.02, c1 - 0.45, 0.42, 0.1, 0.12, '#1a1c1e', 0); // козырёк приборов
  m.quad([-0.53, y0 + 0.03, c1 - 0.52], [-0.21, y0 + 0.03, c1 - 0.52], [-0.21, y0 + 0.11, c1 - 0.5], [-0.53, y0 + 0.11, c1 - 0.5], '#4a3820', MAT.window); // приборы
  m.box(0.05, y0 - 0.2, c1 - 0.55, 0.22, 0.22, 0.06, '#101214', 0); // магнитола
  m.quad([-0.04, y0 - 0.1, c1 - 0.585], [0.14, y0 - 0.1, c1 - 0.585], [0.14, y0 - 0.02, c1 - 0.585], [-0.04, y0 - 0.02, c1 - 0.585], '#123248', MAT.window);
  // руль
  const sx = -0.37, sy = y0 - 0.05, sz = c1 - 0.72;
  for (let i = 0; i < 12; i++) {
    const a0 = i / 12 * 6.283, a1 = (i + 1) / 12 * 6.283, r = 0.19;
    const p = a => [sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.93, sz + Math.sin(a) * r * 0.35];
    const q = a => [sx + Math.cos(a) * (r - 0.03), sy + Math.sin(a) * (r - 0.03) * 0.93, sz + Math.sin(a) * (r - 0.03) * 0.35 + 0.01];
    m.quad(p(a0), p(a1), q(a1), q(a0), '#141516', 0);
  }
  m.box(sx, sy - 0.03, sz + 0.02, 0.12, 0.06, 0.08, '#141516', 0);
  m.box(sx, sy - 0.2, sz + 0.1, 0.06, 0.2, 0.06, '#141516', 0);
  // стойки, крыша, двери
  for (const s of [-1, 1]) {
    m.quad([s * (hw - 0.1), y0, c1], [s * (hw - 0.12), y0, c1 - 0.08], [s * (hw - 0.26), y1, c1 - rf - 0.08], [s * (hw - 0.24), y1, c1 - rf + 0.02], trim, 0);
    m.box(s * (hw - 0.08), 0.2, (c0 + c1) / 2, 0.1, y0 - 0.2, c1 - c0 + 0.3, trim, 0);
    m.box(s * (hw - 0.16), y0 - 0.32, (c0 + c1) / 2 + 0.2, 0.08, 0.1, c1 - c0 - 0.6, '#2e3134', 0); // подлокотник
    const mz = (c0 + rr + c1 - rf) / 2 + 0.05;
    m.quad([s * (hw - 0.11), y0, (c0 + c1) / 2 - 0.05], [s * (hw - 0.11), y0, (c0 + c1) / 2 + 0.1], [s * (hw - 0.25), y1, mz + 0.1], [s * (hw - 0.25), y1, mz - 0.05], trim, 0);
  }
  m.quad([-hw + 0.24, y1 - 0.02, c0 + rr], [hw - 0.24, y1 - 0.02, c0 + rr], [hw - 0.24, y1 - 0.02, c1 - rf], [-hw + 0.24, y1 - 0.02, c1 - rf], roofc, 0);
  m.box(0, y1 - 0.08, c1 - rf - 0.12, 0.2, 0.05, 0.06, '#222', 0); // зеркало заднего вида
  // сиденья
  for (const s of [-1, 1]) {
    m.box(s * 0.37, 0.35, -0.1, 0.48, 0.14, 0.5, seat, 0);
    m.box(s * 0.37, 0.45, -0.42, 0.48, 0.62, 0.12, seat, 0, { taper: 0.03 });
    m.box(s * 0.37, 1.07, -0.44, 0.26, 0.18, 0.1, seat, 0);
  }
  m.box(0, 0.35, c0 + 0.35, B.w - 0.3, 0.45, 0.5, seat, 0); // задний диван
  m.quad([-hw, 0.2, c0], [hw, 0.2, c0], [hw, 0.2, c1], [-hw, 0.2, c1], '#1c1d1f', 0); // пол
  m.box(0, 0.2, c1 - 0.2, B.w - 0.2, y0 - 0.45, 0.25, dash, 0); // низ торпедо
  m.box(0, 0.25, 0.2, 0.2, 0.3, 0.9, dash, 0); // тоннель
  // тёмная рамка вокруг стёкол-проёмов: низ дверей
  return m;
}

// ─────────── человек ───────────
// части: 0 таз/корпус 1 голова 2 бедро Л 3 бедро П 4 плечо Л 5 плечо П 6 предплечье Л 7 предплечье П 8 голень Л 9 голень П 10 рюкзак 11 телефон
// слоты цвета: 0 кожа 1 куртка 2 штаны 3 волосы/шапка 4 обувь 5 рюкзак 6 экран
function personMesh() {
  const m = new MB();
  const C = (part, slot) => { const c = [part, slot, 0]; c.raw = true; return c; };
  for (const s of [-1, 1]) {
    const pl = s < 0 ? 0 : 1;
    m.box(s * 0.1, 0.0, 0.03, 0.13, 0.09, 0.26, C(8 + pl, 4));          // ботинок
    m.box(s * 0.1, 0.08, 0, 0.12, 0.44, 0.14, C(8 + pl, 2), 0, { taper: -0.005 }); // голень
    m.box(s * 0.1, 0.5, 0, 0.15, 0.45, 0.17, C(2 + pl, 2));            // бедро
    m.box(s * 0.255, 1.13, 0, 0.11, 0.31, 0.13, C(4 + pl, 1));         // плечо
    m.box(s * 0.255, 0.9, 0, 0.1, 0.25, 0.12, C(6 + pl, 1));           // предплечье
    m.box(s * 0.255, 0.8, 0.005, 0.08, 0.11, 0.09, C(6 + pl, 0));      // кисть
  }
  m.box(0, 0.86, 0, 0.36, 0.16, 0.2, C(0, 2));                          // таз
  m.box(0, 0.98, 0, 0.4, 0.47, 0.24, C(0, 1), 0, { taper: -0.02 });     // куртка
  m.box(0, 1.4, 0.0, 0.22, 0.07, 0.2, C(0, 1));                         // воротник
  m.box(0, 1.45, 0, 0.09, 0.07, 0.09, C(1, 0));                         // шея
  m.box(0, 1.5, 0.005, 0.19, 0.23, 0.21, C(1, 0), 0, { taper: 0.012 }); // голова
  m.box(0, 1.66, -0.01, 0.21, 0.1, 0.23, C(1, 3), 0, { taper: 0.03 });  // волосы/шапка
  m.box(0, 1.56, -0.1, 0.2, 0.12, 0.04, C(1, 3));                       // затылок
  m.box(0, 1.6, 0.116, 0.1, 0.02, 0.012, C(1, 4));                      // глаза-тень
  m.box(0, 0.98, -0.2, 0.3, 0.4, 0.16, C(10, 5), 0, { taper: 0.02 });   // рюкзак
  m.box(0.255, 0.79, 0.07, 0.07, 0.12, 0.012, C(11, 6));                // телефон
  return m;
}

// ─────────── деревья ───────────
function treeMesh(kind) {
  const m = new MB(), leaf = [1, 1, 1];
  if (kind === 'pine') {
    m.cyl(0, 0, 0, 0.18, 2.5, 5, '#4a3a2c', 0, 'y', false, 0.1);
    m.cone(0, 1.6, 0, 1.9, 3.4, 7, leaf, MAT.leaf);
    m.cone(0, 3.4, 0, 1.45, 3.0, 7, leaf, MAT.leaf);
    m.cone(0, 5.0, 0, 0.95, 2.8, 7, leaf, MAT.leaf);
  } else if (kind === 'birch') {
    m.cyl(0, 0, 0, 0.13, 5.5, 5, '#d8d4c8', 0, 'y', false, 0.07);
    m.lump(0.1, 4.6, 0, 1.4, 1.9, 1.3, leaf, MAT.leaf, 7);
    m.lump(-0.4, 3.4, 0.3, 1.0, 1.2, 1.0, leaf, MAT.leaf, 9);
  } else if (kind === 'shrub') {
    m.lump(0, 0.5, 0, 1.2, 0.8, 1.1, leaf, MAT.leaf, 3, 0.35);
  } else {
    m.cyl(0, 0, 0, 0.22, 3.2, 5, '#4d3d2e', 0, 'y', false, 0.12);
    m.lump(0, 4.2, 0, 2.3, 2.1, 2.2, leaf, MAT.leaf, 5);
    m.lump(0.9, 3.4, 0.6, 1.4, 1.2, 1.4, leaf, MAT.leaf, 11);
    m.lump(-0.8, 3.6, -0.5, 1.3, 1.2, 1.3, leaf, MAT.leaf, 13);
  }
  return m;
}

// ─────────── велосипед / самокат ───────────
function bikeMesh(kind) {
  const m = new MB(), frame = kind === 'scooter' ? '#2a2c30' : '#a8322a', tire = '#151515';
  const ring = (cz, r, cy) => { for (let i = 0; i < 12; i++) { const a0 = i / 12 * 6.283, a1 = (i + 1) / 12 * 6.283; const p = (a, rr) => [0, cy + Math.sin(a) * rr, cz + Math.cos(a) * rr]; m.quad(p(a0, r), p(a1, r), p(a1, r - 0.05), p(a0, r - 0.05), tire, 0); } };
  if (kind === 'scooter') {
    ring(0.4, 0.1, 0.1); ring(-0.4, 0.1, 0.1);
    m.box(0, 0.08, 0, 0.14, 0.05, 0.75, frame);
    m.box(0, 0.1, 0.44, 0.04, 0.9, 0.04, frame);
    m.box(0, 0.98, 0.44, 0.45, 0.03, 0.03, frame);
  } else {
    ring(0.52, 0.34, 0.34); ring(-0.52, 0.34, 0.34);
    const bar = (a, b) => { const dx = 0.03; m.quad([-dx, a[1], a[0]], [dx, a[1], a[0]], [dx, b[1], b[0]], [-dx, b[1], b[0]], frame); m.quad([0, a[1] - dx, a[0]], [0, a[1] + dx, a[0]], [0, b[1] + dx, b[0]], [0, b[1] - dx, b[0]], frame); };
    bar([-0.52, 0.34], [-0.05, 0.36]); bar([-0.05, 0.36], [0.4, 0.8]); bar([-0.52, 0.34], [-0.12, 0.82]); bar([-0.12, 0.82], [0.4, 0.8]); bar([0.52, 0.34], [0.42, 0.9]); bar([-0.05, 0.36], [-0.14, 0.85]);
    m.box(-0.14, 0.86, 0, 0.12, 0.05, 0.24, '#1b1b1b');
    m.box(0, 0.93, 0.42, 0.5, 0.03, 0.03, '#333');
    m.box(0, 0.58, -0.4, 0.3, 0.26, 0.4, '#3a4a5c'); // сумка на багажнике
  }
  return m;
}
return { MB, MAT, BODY, carMesh, carBox, interiorMesh, personMesh, treeMesh, bikeMesh, h01 };
});
