// Мебель и декор зала из примитивов (стилизованный low-poly). Всё статичное складывается в Kit —
// «ящик» по материалам: каждая деталь = примитив + матрица + цвет вершин, в конце всё одного материала
// сливается в ОДИН меш (сотни стульев и ламп = единицы вызовов отрисовки). Цвет — в вершинах, поэтому
// серые, бежевые, розовые кресла живут в одном материале.
// Локальные оси предмета: сидящий смотрит в +Z, спинка на −Z; place(x,y,z,ry) ставит предмет в зал.
// Ключи материалов (создаёт scene.js): solid — матовое (Lambert), shiny — металл/хром (Phong), glow — светится
// само (Basic), glass — прозрачное, velour/tufted — обивка с текстурой, onyx, marble, wood, rtop, leaf, foliage, gears.
'use strict';
L.def('render/props', () => {
const { RNG } = L.use('core');

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();
const place = (x, y, z, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
// M · (сдвиг, поворот, масштаб)
function local(M, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  return M ? _m.premultiply(M) : _m;
}
// кэш примитивов
const GEO = new Map();
function geo(key, make) { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; }
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYL = (seg, r0 = 1, r1 = 1, open = false, t0 = 0, tl = Math.PI * 2) => geo(`c${seg}|${r0}|${r1}|${open}|${t0}|${tl}`, () => new THREE.CylinderGeometry(r1, r0, 1, seg, 1, open, t0, tl));
const SPH = seg => geo(`s${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg * 0.6 | 0)));
const PLANE = () => geo('plane', () => new THREE.PlaneGeometry(1, 1));
const TOR = (seg, tube) => geo(`t${seg}|${tube}`, () => new THREE.TorusGeometry(1, tube, 5, seg));

class Kit {
  constructor() { this.b = new Map(); }
  put(key, g, m, col) {
    const x = g.index ? g.toNonIndexed() : g.clone();
    x.applyMatrix4(m);
    if (!this.b.has(key)) this.b.set(key, []);
    this.b.get(key).push([x, col]);
  }
  // коробка w×h×d с центром (x,y,z) в системе M
  box(k, M, w, h, d, x, y, z, col, rx = 0, ry = 0, rz = 0) { this.put(k, BOX(), local(M, x, y, z, rx, ry, rz, w, h, d), col); }
  // цилиндр: r0 — низ, r1 — верх (относительно r0 = 1 через rr), h — высота, центр (x,y,z)
  cyl(k, M, r, h, seg, x, y, z, col, rx = 0, ry = 0, rz = 0, taper = 1, open = false) { this.put(k, CYL(seg, 1, taper, open), local(M, x, y, z, rx, ry, rz, r, h, r), col); }
  sph(k, M, r, x, y, z, col, sx = 1, sy = 1, sz = 1, seg = 8) { this.put(k, SPH(seg), local(M, x, y, z, 0, 0, 0, r * sx, r * sy, r * sz), col); }
  plane(k, M, w, h, x, y, z, col, rx = 0, ry = 0, rz = 0) { this.put(k, PLANE(), local(M, x, y, z, rx, ry, rz, w, h, 1), col); }
  torus(k, M, r, tube, x, y, z, col, rx = 0, ry = 0, rz = 0, seg = 12) { this.put(k, TOR(seg, tube / r), local(M, x, y, z, rx, ry, rz, r, r, r), col); }
  raw(k, g, M, col) { this.put(k, g, M, col); }
  // сливает всё в меши (по одному на материал); mats[key] — материал
  build(mats, parent) {
    const out = {};
    for (const [key, list] of this.b) {
      const mat = mats[key]; if (!mat) { console.warn('Kit: нет материала', key); continue; }
      let n = 0; for (const [g] of list) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
      let o = 0;
      for (const [g, c] of list) {
        const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, cnt = P.count;
        pos.set(P.array, o * 3); if (N) nor.set(N.array, o * 3); if (U) uv.set(U.array, o * 2);
        _c.set(c ?? 0xffffff);
        for (let i = 0; i < cnt; i++) { const j = (o + i) * 3; col[j] = _c.r; col[j + 1] = _c.g; col[j + 2] = _c.b; }
        o += cnt; g.dispose();
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      bg.computeBoundingSphere();
      const mesh = new THREE.Mesh(bg, mat); mesh.matrixAutoUpdate = false; mesh.name = key;
      if (mat.transparent) mesh.renderOrder = 2;
      parent.add(mesh); out[key] = mesh;
    }
    this.b.clear();
    return out;
  }
}

// ─────────── палитра ───────────
const COL = {
  black: 0x161414, blackWarm: 0x1d1714, frame: 0x222022, woodDark: 0x3a2417, wood: 0x6b4128, woodLight: 0x8a5a36,
  chrome: 0xc8c8cc, brass: 0xb58a3c, copper: 0x9a5a36, olive: 0x7d7a4a, pink: 0xd98c9e, cushion: 0x5a3a2a,
  velour: [0x7e7a84, 0x6f6c74, 0x9c8e7c, 0xc08a84, 0xd08a62, 0x8e8a92], green: 0x3f6a3a, bulb: 0xffd48a,
};

// ─────────── мебель ───────────
// велюровое кресло-«бочонок»: скруглённая спинка переходит в подлокотники, деревянные ножки
// спинка-«бочонок» — толстое полукольцо (вращение профиля), к подлокотникам ниже; строится один раз
function tubBack() {
  return geo('tub', () => {
    const prof = [[0.19, 0], [0.285, 0], [0.285, 1], [0.24, 1.06], [0.19, 1], [0.19, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const span = Math.PI * 1.36, g = new THREE.LatheGeometry(prof, 14, Math.PI - span / 2, span), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), u = (Math.atan2(x, z) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;   // 0 — середина спинки
      p.setY(i, p.getY(i) * (0.2 + 0.25 * Math.pow(Math.max(0, Math.cos(u * 1.1)), 1.3)));
    }
    g.computeVertexNormals();
    return g;
  });
}
function armchair(k, M, col) {
  k.box('velour', M, 0.46, 0.13, 0.46, 0, 0.415, 0.05, col);            // подушка
  k.cyl('solid', M, 0.29, 0.14, 12, 0, 0.3, 0.02, col);                   // основание
  k.put('velour', tubBack(), local(M, 0, 0.36, 0.02), col);
  for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.21], [0.19, 0.21]]) k.box('solid', M, 0.035, 0.26, 0.035, x, 0.12, z, COL.wood);
}
// стул с овальной спинкой (веранда, диванчики): серый велюр, тонкие ножки
function ovalChair(k, M, col, legs = COL.black) {
  k.box('velour', M, 0.44, 0.08, 0.42, 0, 0.45, 0.02, col);
  k.put('velour', CYL(12), local(M, 0, 0.78, -0.21, Math.PI / 2 - 0.12, 0, 0, 0.23, 0.05, 0.3), col);
  for (const [x, z] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.2], [0.18, 0.2]]) k.box('solid', M, 0.025, 0.44, 0.025, x, 0.21, z, legs);
  k.box('solid', M, 0.02, 0.45, 0.02, 0, 0.62, -0.23, legs, -0.12);
}
// барный стул: деревянный, 4 ножки с перекладинами, мягкое сиденье
function stool(k, M) {
  for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) k.box('solid', M, 0.04, 0.72, 0.04, x, 0.36, z, COL.woodDark, z * 0.12, 0, -x * 0.12);
  for (const s of [-1, 1]) { k.box('solid', M, 0.34, 0.03, 0.03, 0, 0.25, s * 0.15, COL.woodDark); k.box('solid', M, 0.03, 0.03, 0.34, s * 0.15, 0.25, 0, COL.woodDark); }
  k.box('solid', M, 0.4, 0.04, 0.4, 0, 0.72, 0, COL.woodDark);
  k.box('tufted', M, 0.38, 0.06, 0.38, 0, 0.77, 0, COL.cushion);
}
// прямоугольный стол: столешница (текстура top), царга и ножки
function rectTable(k, t, top) {
  const M = place(t.x, 0, t.z), w = t.w, d = t.d;
  k.box(top, M, w, 0.04, d, 0, 0.75, 0, 0xffffff);
  k.box('solid', M, w - 0.08, 0.08, d - 0.08, 0, 0.69, 0, COL.blackWarm);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('solid', M, 0.05, 0.68, 0.05, sx * (w / 2 - 0.07), 0.34, sz * (d / 2 - 0.07), top === 'marble' ? COL.black : COL.woodDark);
}
// круглый столик на чёрной чугунной ножке
function roundTable(k, t, top = 'rtop', h = 0.75) {
  const M = place(t.x, 0, t.z), r = t.w / 2;
  k.cyl(top, M, r, 0.035, 18, 0, h, 0, 0xffffff);
  k.cyl('solid', M, 0.035, h - 0.05, 6, 0, (h - 0.05) / 2, 0, COL.black);
  k.cyl('solid', M, r * 0.6, 0.04, 10, 0, 0.02, 0, COL.black, 0, 0, 0, 0.7);
}
// диван вдоль отрезка: from/to (x,z), n — внутрь (к сидящим), col; tuft — стёганая спинка
function sofa(k, a, b, n, col, { depth = 0.55, seatH = 0.45, backH = 0.95, arms = true } = {}) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), ry = Math.atan2(n[0], n[1]);
  const M = place((a[0] + b[0]) / 2 + n[0] * depth / 2, 0, (a[1] + b[1]) / 2 + n[1] * depth / 2, ry);
  // в локальных осях: +Z — к сидящим, X — вдоль дивана
  k.box('solid', M, len, 0.28, depth, 0, 0.14, 0, COL.blackWarm);
  const nc = Math.max(1, Math.round(len / 0.75)), cw = len / nc;
  for (let i = 0; i < nc; i++) k.box('velour', M, cw - 0.03, 0.16, depth - 0.14, -len / 2 + (i + 0.5) * cw, seatH - 0.07, 0.05, col);
  const nb = Math.max(1, Math.round(len / 1.0)), bw = len / nb;
  for (let i = 0; i < nb; i++) k.box('tufted', M, bw, backH - seatH + 0.1, 0.16, -len / 2 + (i + 0.5) * bw, (backH + seatH) / 2 - 0.05, -depth / 2 + 0.08, col, -0.08);
  k.cyl('velour', M, 0.09, len, 8, 0, backH, -depth / 2 + 0.1, col, 0, 0, Math.PI / 2);
  if (arms) for (const s of [-1, 1]) {
    k.box('tufted', M, 0.14, 0.34, depth, s * (len / 2 - 0.07), seatH + 0.1, 0, col);
    k.cyl('velour', M, 0.08, depth, 8, s * (len / 2 - 0.07), seatH + 0.27, 0, col, Math.PI / 2);
  }
}

// ─────────── мелочь на столах ───────────
function tableware(k, t, rng) {
  const M = place(t.x, 0.77, t.z), n = Math.max(1, Math.round(t.d / 0.7));
  for (let i = 0; i < n; i++) {
    const z = -t.d / 2 + (i + 0.5) * t.d / n;
    if (rng.chance(0.6)) { k.cyl('glass', M, 0.04, 0.14, 8, rng.range(-0.25, 0.25), 0.07, z + rng.range(-0.1, 0.1), 0xf0b040); k.cyl('solid', M, 0.041, 0.025, 8, 0, 0.15, 0, 0xfff8e8); }
    if (rng.chance(0.4)) { const x = rng.range(-0.2, 0.2); k.cyl('glass', M, 0.035, 0.12, 8, x, 0.06, z, 0x2a1408, 0, 0, 0, 0.45); }    // соевый соус
    if (rng.chance(0.3)) { k.sph('glass', M, 0.07, rng.range(-0.15, 0.15), 0.07, z, 0xc07a30, 1, 0.85, 1); }                          // чайник
  }
  // салфетница-арка с белыми салфетками
  k.box('solid', M, 0.1, 0.06, 0.07, 0, 0.04, 0, 0xf4f2ee);
  k.torus('solid', M, 0.06, 0.006, 0, 0.06, 0, COL.black, 0, Math.PI / 2, 0, 10);
}

// ─────────── декор на стенах ───────────
// фонарь-кашпо: чёрная рамка, внутри тёплый огонь
function lantern(k, M, s = 1) {
  k.box('solid', M, 0.2 * s, 0.03, 0.2 * s, 0, 0.17 * s, 0.1 * s, COL.black);
  k.box('solid', M, 0.26 * s, 0.03, 0.24 * s, 0, 0.2 * s, 0.1 * s, COL.black);
  k.box('solid', M, 0.2 * s, 0.03, 0.2 * s, 0, -0.17 * s, 0.1 * s, COL.black);
  for (const x of [-1, 1]) for (const z of [0, 1]) k.box('solid', M, 0.025, 0.34 * s, 0.025, x * 0.09 * s, 0, z * 0.2 * s, COL.black);
  k.box('glow', M, 0.13 * s, 0.24 * s, 0.13 * s, 0, 0, 0.1 * s, 0xffc070);
  k.box('solid', M, 0.05, 0.05, 0.06, 0, 0.22 * s, -0.02, COL.black);
}
// лампы-трубы (стимпанк): медные/чёрные трубы коленами, на концах лампы Эдисона
function pipeLamp(k, M, rng) {
  const P = 0.022, col = COL.copper, bulbs = [];
  const seg = (x0, y0, x1, y1) => { const len = Math.hypot(x1 - x0, y1 - y0); k.cyl('shiny', M, P, len, 6, (x0 + x1) / 2, (y0 + y1) / 2, 0.06, col, 0, 0, Math.atan2(x0 - x1, y1 - y0)); k.sph('shiny', M, P * 1.5, x1, y1, 0.06, col, 1, 1, 1, 6); };
  // «гребёнка»: верхняя горизонталь, с неё вниз отводы разной длины, один вверх; лампы на концах
  seg(-0.6, 0.3, 0.6, 0.3);
  seg(-0.6, 0.3, -0.6, -0.2); seg(-0.15, 0.3, -0.15, -0.45); seg(0.3, 0.3, 0.3, -0.05); seg(0.6, 0.3, 0.6, 0.05); seg(0.05, 0.3, 0.05, 0.55);
  k.box('shiny', M, 0.06, 0.06, 0.08, -0.35, 0.3, 0.03, 0x2a2a2a); k.box('shiny', M, 0.06, 0.06, 0.08, 0.45, 0.3, 0.03, 0x2a2a2a);
  for (const [x, y, up] of [[-0.6, -0.2, -1], [-0.15, -0.45, -1], [0.3, -0.05, -1], [0.6, 0.05, -1], [0.05, 0.55, 1]]) {
    k.cyl('shiny', M, 0.03, 0.05, 6, x, y + up * 0.03, 0.06, COL.brass);
    k.sph('glow', M, 0.04, x, y + up * 0.09, 0.06, COL.bulb, 1, 1.5, 1, 6);
    bulbs.push([x, y + up * 0.09, 0.06]);
  }
  return bulbs;
}
// алоказия в кадке: черешки и крупные листья-сердца; tint — цвет листа (красная подсветка)
function plant(k, M, rng, { h = 1.6, leaves = 9, tint = 0x4a7a3c, pot = COL.black, big = 1 } = {}) {
  k.box('solid', M, 0.45, 0.45, 0.45, 0, 0.225, 0, pot);
  k.box('solid', M, 0.4, 0.02, 0.4, 0, 0.45, 0, 0x2a1a10);
  for (let i = 0; i < leaves; i++) {
    const a = i / leaves * Math.PI * 2 + rng.range(-0.3, 0.3), t = rng.range(0.55, 1), len = (h - 0.4) * t, lean = rng.range(0.25, 0.6);
    const tx = Math.sin(a) * Math.sin(lean) * len, ty = 0.45 + Math.cos(lean) * len, tz = Math.cos(a) * Math.sin(lean) * len;
    k.cyl('solid', M, 0.012, len, 4, tx / 2, 0.45 + (ty - 0.45) / 2, tz / 2, 0x5a6a3a, Math.sin(lean) * Math.cos(a), 0, -Math.sin(lean) * Math.sin(a));
    const s = rng.range(0.35, 0.55) * big;
    k.plane('leaf', M, s * 0.8, s, tx + Math.sin(a) * s * 0.3, ty + s * 0.1, tz + Math.cos(a) * s * 0.3, tint, -0.5 - rng.next() * 0.6, a, 0);
  }
}
// туя/куст: несколько шаров листвы с альфа-краем
function shrub(k, M, rng, { h = 1.6, r = 0.35, pot = 0x8a8680, potH = 0.4 } = {}) {
  if (potH) k.box('solid', M, r * 1.6, potH, r * 1.6, 0, potH / 2, 0, pot);
  const n = Math.round(h / 0.16);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1), rr = r * (1 - t * 0.55) * rng.range(0.85, 1.1) + 0.04, a = rng.next() * 6.3, off = rr * 0.25;
    k.put('foliage', geo('ico', () => jitterIco(0.14)), local(M, Math.sin(a) * off, potH + 0.15 + t * (h - 0.25), Math.cos(a) * off, rng.next(), rng.next() * 6, 0, rr, 0.22, rr), rng.pick([0x3f5e32, 0x4a6a38, 0x365428]));
  }
}
function jitterIco(j) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, rng = new RNG(4);
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 1 + rng.range(-j, j) * 2);
    const f = map.get(key); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}
// колонка на стойке-треноге
function speaker(k, M) {
  k.box('solid', M, 0.34, 0.55, 0.3, 0, 1.55, 0, 0x121212);
  k.cyl('solid', M, 0.1, 0.02, 10, 0, 1.5, 0.155, 0x2a2a2a, Math.PI / 2);
  k.cyl('solid', M, 0.018, 1.3, 5, 0, 0.65, 0, 0x1a1a1a);
  for (let i = 0; i < 3; i++) { const a = i * 2.1; k.box('solid', M, 0.02, 0.55, 0.02, Math.sin(a) * 0.14, 0.24, Math.cos(a) * 0.14, 0x1a1a1a, Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5); }
}
// ряд дозаторов: бутылки горлышком вниз на хромированной планке
function dispensers(k, M, n, rng, width) {
  k.box('shiny', M, width, 0.03, 0.05, 0, 0, 0.05, COL.chrome);
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (i + 0.5) * width / n, c = rng.pick([0xd8c080, 0x6a3a1a, 0xe8e8f0, 0x3a6a3a, 0xb06020, 0x8ab0d0]);
    k.cyl('glass', M, 0.035, 0.22, 6, x, 0.15, 0.08, c);
    k.cyl('glass', M, 0.012, 0.06, 5, x, 0.03, 0.08, c);
    k.cyl('shiny', M, 0.018, 0.07, 6, x, -0.05, 0.08, COL.chrome);
  }
}
// пивные краны
function taps(k, M, n, width) {
  k.box('shiny', M, width, 0.05, 0.06, 0, 0, 0.04, COL.chrome);
  for (let i = 0; i < n; i++) { const x = -width / 2 + (i + 0.5) * width / n; k.cyl('shiny', M, 0.012, 0.12, 5, x, -0.06, 0.08, COL.chrome); k.box('solid', M, 0.025, 0.12, 0.025, x, 0.08, 0.09, 0x1a1a1a); }
}
// бутылки на полке (разноцветное стекло)
function bottles(k, M, n, width, rng) {
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (i + 0.5) * width / n + rng.range(-0.02, 0.02), h = rng.range(0.22, 0.32), c = rng.pick([0x2a5a2a, 0x6a3a1a, 0xd8c080, 0x8ab0d0, 0x7a1a1a, 0xe8e8f0, 0x3a3020]);
    k.cyl('glass', M, 0.035, h, 6, x, h / 2, 0, c); k.cyl('glass', M, 0.013, 0.08, 5, x, h + 0.04, 0, c);
  }
}
// телевизор под наклоном (рамка + экран отдельным материалом screen)
function tv(k, M, w = 1.0, h = 0.6) {
  k.box('solid', M, w + 0.05, h + 0.05, 0.06, 0, 0, -0.03, 0x0c0c0c);
  k.plane('screen', M, w, h, 0, 0, 0.002, 0xffffff);
  k.box('solid', M, 0.08, 0.08, 0.3, 0, 0, -0.2, 0x151515);
}
// маршрутка (голубая, как на фото с улицы)
function minibus(k, M) {
  k.box('solid', M, 5.6, 1.9, 2.1, 0, 1.35, 0, 0x6fb0c8);
  k.box('solid', M, 5.62, 0.55, 2.12, 0, 1.75, 0, 0x2a3238);
  k.box('solid', M, 0.2, 0.9, 2.0, 2.85, 1.2, 0, 0x2a3238);
  k.box('glow', M, 0.05, 0.14, 0.3, 2.9, 0.75, 0.7, 0xfff0c0); k.box('glow', M, 0.05, 0.14, 0.3, 2.9, 0.75, -0.7, 0xfff0c0);
  k.box('glow', M, 0.05, 0.14, 0.25, -2.83, 0.75, 0.75, 0xff3020); k.box('glow', M, 0.05, 0.14, 0.25, -2.83, 0.75, -0.75, 0xff3020);
  for (const x of [-1.9, 1.9]) for (const z of [-1, 1]) k.cyl('solid', M, 0.36, 0.25, 10, x, 0.36, z * 0.95, 0x151515, Math.PI / 2);
}

return { Kit, COL, place, local, armchair, ovalChair, stool, rectTable, roundTable, sofa, tableware, lantern, pipeLamp, plant, shrub, speaker, dispensers, taps, bottles, tv, minibus, CYL, BOX, PLANE };
});
