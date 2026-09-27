// ═══ ЛЮДИ В 3D ═══
// Каждый человек — ОДИН SkinnedMesh (один вызов отрисовки): вся фигура, одежда, волосы, лицо собраны в одну
// геометрию с цветами в вершинах и жёсткой привязкой к ~19 костям. Материал общий на всех. Анимация —
// процедурная: из позы, настроения и «говорит ли» каждый кадр считается цель для углов суставов, текущие
// углы плавно тянутся к ней. Проп в руках — отдельный маленький меш (общие геометрии) на кости руки/груди.
// Тени — одно InstancedMesh-пятно на всех. Для выбора мышью — невидимые цилиндры (pickables).
//
// Координаты: метры, Y вверх, rot 0 = лицом в +Z. Сиденье стула 0.45.
'use strict';
L.def('render/people', () => {
const { clamp, lerp, hash01 } = L.use('core');
const T = THREE;

const SEAT = 0.45, SEAT_SOFA = 0.42;
const POSES = ['stand', 'walk', 'sit', 'sitSofa', 'talk', 'laugh', 'phone', 'drink', 'photo', 'sing', 'wave', 'leave'];

// ---------- цвета: '#rrggbb' → линейный RGB (три с ColorManagement) ----------
const _c = new T.Color();
const lin = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------- общие примитивы (без индексов, чтобы красить по граням) ----------
const PRIM = new Map();
function prim(key, make) { let g = PRIM.get(key); if (!g) { g = make(); if (g.index) g = g.toNonIndexed(); PRIM.set(key, g); } return g; }
const G = {
  box: () => prim('box', () => new T.BoxGeometry(1, 1, 1)),
  sph: (w = 10, h = 8) => prim(`s${w}.${h}`, () => new T.SphereGeometry(1, w, h)),
  // сегмент сферы: phi — вокруг Y (перед +Z при phi=π/2), theta — от макушки
  sphPart: (p0, pl, t0, tl, w = 10, h = 6) => prim(`sp${p0.toFixed(2)}.${pl.toFixed(2)}.${t0.toFixed(2)}.${tl.toFixed(2)}.${w}.${h}`,
    () => new T.SphereGeometry(1, w, h, p0, pl, t0, tl)),
  // цилиндр высотой 1 по Y, центр в 0; top — отношение верхнего радиуса к нижнему
  cyl: (top = 1, seg = 8, hs = 1, open = false) => prim(`c${top.toFixed(2)}.${seg}.${hs}.${open}`,
    () => new T.CylinderGeometry(top, 1, 1, seg, hs, open)),
  torus: (tube = 0.2, seg = 10) => prim(`t${tube}.${seg}`, () => new T.TorusGeometry(1, tube, 3, seg)),
  // прямоугольная оправа: 4 сегмента повернуты на 45° ДО масштаба (иначе растяжение даёт ромб)
  frame: (tube = 0.2) => prim(`fr${tube}`, () => { const g = new T.TorusGeometry(1, tube, 3, 4); g.rotateZ(Math.PI / 4); return g; }),
};

const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _s = new T.Vector3();
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  return new T.Matrix4().compose(_v.set(x, y, z).clone(), _q.clone(), _s.set(sx, sy, sz).clone());
}

// ---------- сборщик одной геометрии с костями ----------
class Geo {
  constructor(bonePos) { this.bp = bonePos; this.p = []; this.n = []; this.c = []; this.b = []; }
  // geo — примитив; bone — индекс кости; m — матрица в системе кости; col — [r,g,b] или fn(cx,cy,cz,face)→[r,g,b]
  add(geo, bone, m, col) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const nm = new T.Matrix3().getNormalMatrix(m), o = this.bp[bone];
    const v = new T.Vector3(), w = new T.Vector3();
    let fc = col;
    for (let i = 0; i < n; i++) {
      if (typeof col === 'function' && i % 3 === 0) {
        const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
          cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        fc = col(cx, cy, cz, i / 3);
      }
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      w.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.p.push(v.x + o[0], v.y + o[1], v.z + o[2]); this.n.push(w.x, w.y, w.z); this.c.push(fc[0], fc[1], fc[2]); this.b.push(bone);
    }
  }
  build() {
    const g = new T.BufferGeometry(), n = this.b.length;
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = this.b[i]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    return g;
  }
}

// ---------- кости ----------
const B = { hips: 0, spine: 1, head: 2, browL: 3, browR: 4, mouth: 5, cornL: 6, cornR: 7, eyes: 8,
  armL: 9, foreL: 10, handL: 11, armR: 12, foreR: 13, handR: 14, thighL: 15, shinL: 16, thighR: 17, shinR: 18 };
const PARENT = [-1, 0, 1, 2, 2, 2, 2, 2, 2, 1, 9, 10, 1, 12, 13, 0, 15, 0, 17];

// ---------- размеры тела из look ----------
function dims(look) {
  const s = look.height / 1.75, f = look.sex === 'f';
  const bw = { thin: 0.86, avg: 1, stocky: 1.1, heavy: 1.2 }[look.build] || 1;
  const R = 0.14 * (0.75 + 0.25 * s);            // голова чуть крупнее реальной — читаемость сверху
  const d = { s, f, bw, R };
  d.foot = 0.07 * s; d.shin = 0.40 * s; d.thigh = 0.385 * s;
  d.hipJ = d.foot + d.shin + d.thigh;              // тазобедренный сустав
  d.hipY = d.hipJ + 0.03 * s;                      // кость таза
  d.hipW = (f ? 0.095 : 0.088) * s * Math.sqrt(bw);
  d.spineY = d.hipY + 0.07 * s;
  d.torso = 0.43 * s;                              // от кости спины до плеч
  d.neckY = d.spineY + d.torso;
  d.shW = (f ? 0.17 : 0.2) * s * bw;
  d.shY = d.neckY - 0.045 * s;
  d.upArm = 0.27 * s; d.foreArm = 0.23 * s;
  d.armR = 0.054 * s * Math.sqrt(bw); d.legR = 0.082 * s * Math.sqrt(bw);
  d.neckLen = 0.06 * s;
  d.headC = d.neckLen + R * 0.95;                  // центр головы от кости головы
  d.Rx = R * 0.93; d.Ry = R * 1.08; d.Rz = R;
  d.top = d.neckY + d.headC + d.Ry;                // макушка
  d.sitHip = SEAT + 0.085 * s;                     // кость таза сидя
  return d;
}

// ---------- постройка фигуры ----------
function buildFigure(look) {
  const d = dims(look), { s, f, bw, R } = d;
  // мировые позиции костей в позе привязки (все повороты нулевые)
  const hc = d.headC, fz = (x, y) => d.Rz * Math.sqrt(Math.max(0, 1 - (x / d.Rx) ** 2 - (y / d.Ry) ** 2));
  const eyeY = hc + 0.02 * R, eyeX = 0.36 * R, browY = hc + 0.33 * R, mouthY = hc - 0.42 * R;
  const W = [];
  W[B.hips] = [0, d.hipY, 0]; W[B.spine] = [0, d.spineY, 0]; W[B.head] = [0, d.neckY, 0];
  const H = W[B.head];
  W[B.browL] = [eyeX, H[1] + browY, fz(eyeX, browY - hc) + 0.012];
  W[B.browR] = [-eyeX, H[1] + browY, fz(eyeX, browY - hc) + 0.012];
  W[B.mouth] = [0, H[1] + mouthY, fz(0, mouthY - hc) + 0.004];
  W[B.cornL] = [0.17 * R, H[1] + mouthY, fz(0.17 * R, mouthY - hc) + 0.002];
  W[B.cornR] = [-0.17 * R, H[1] + mouthY, fz(0.17 * R, mouthY - hc) + 0.002];
  W[B.eyes] = [0, H[1] + eyeY, 0];
  W[B.armL] = [d.shW, d.shY, 0]; W[B.foreL] = [d.shW, d.shY - d.upArm, 0]; W[B.handL] = [d.shW, d.shY - d.upArm - d.foreArm, 0];
  W[B.armR] = [-d.shW, d.shY, 0]; W[B.foreR] = [-d.shW, d.shY - d.upArm, 0]; W[B.handR] = [-d.shW, d.shY - d.upArm - d.foreArm, 0];
  W[B.thighL] = [d.hipW, d.hipJ, 0]; W[B.shinL] = [d.hipW, d.foot + d.shin, 0];
  W[B.thighR] = [-d.hipW, d.hipJ, 0]; W[B.shinR] = [-d.hipW, d.foot + d.shin, 0];

  const g = new Geo(W);
  const seed = look.seed || 1;
  const skin = lin(look.skin), skinD = mul(skin, 0.86), top = lin(look.top.color), acc = lin(look.top.accent || '#ffffff'),
    acc2 = lin(look.top.accent2 || look.top.accent || '#ffffff');
  const hairC = lin(look.hair.color), greyC = lin('#c9c6c2');
  const bot = lin(look.bottom.color), shoe = lin(look.shoes);
  const kind = look.top.kind;
  const hsh = (i, k = 0) => hash01(seed + k * 7919, i);

  // ---- ткань верха: окраска граней по узору ----
  const ang = (x, z) => Math.atan2(x, z); // 0 = перед
  const cloth = (base, a2 = acc, a3 = acc2, k = 0) => {
    if (kind === 'stripes') return (x, y, z) => (Math.floor((ang(x, z) + Math.PI) / (2 * Math.PI) * 18 + 0.5) % 2 ? mixc(base, a2, 0.85) : base);
    if (kind === 'check') return (x, y, z) => {
      // клетка по сегментам цилиндра (18 по кругу, 5 по высоте) — чтобы не дробилась на треугольники
      const a = Math.floor((ang(x, z) + 2 * Math.PI) / (2 * Math.PI) * 18) % 2, b = Math.floor((y + 0.5) * 5) % 2;
      return a && b ? mul(base, 0.55) : a || b ? mixc(base, a2, 0.45) : base;
    };
    if (kind === 'pattern') return (x, y, z, i) => { const h = hsh(i >> 1, 3 + k); return h < 0.28 ? a2 : h < 0.42 ? a3 : base; };
    return base;
  };
  const longSleeve = ['hoodie', 'sweat', 'stripes', 'check', 'blazer'].includes(kind);
  const sleeveC = kind === 'vest' ? acc : top;
  const sleeveCloth = kind === 'vest' ? acc : cloth(top, acc, acc2, 1);
  const legsC = bot;

  // ---- таз ----
  const pelvisC = kind === 'dress' ? top : look.bottom.kind === 'skirt' ? bot : bot;
  g.add(G.cyl(1.0, 10), B.hips, mat(0, -0.02 * s, 0, 0, Math.PI / 10, 0, d.hipW + d.legR * 0.8, 0.16 * s, (0.12 + (f ? 0.01 : 0)) * s * bw), pelvisC);
  if (look.bottom.kind !== 'legs' && kind !== 'dress') // ремень
    g.add(G.cyl(1.0, 10), B.hips, mat(0, 0.06 * s, 0, 0, Math.PI / 10, 0, d.hipW + d.legR * 0.82, 0.022 * s, 0.122 * s * bw), mul(bot, 0.45));
  if (kind === 'dress' || look.bottom.kind === 'skirt') { // юбка — расширяется вниз
    const sc = kind === 'dress' ? top : bot;
    g.add(G.cyl(0.62, 12, 1, true), B.hips, mat(0, -0.12 * s, 0.01, 0, 0, 0, (d.hipW + d.legR) * 1.35, 0.22 * s, 0.16 * s * bw), kind === 'dress' ? cloth(sc) : sc);
  }

  // ---- торс ----
  const tw = d.shW * 0.92, waist = (f ? 0.72 : 0.84) * tw * (look.build === 'heavy' ? 1.12 : 1);
  const tz = (f ? 0.125 : 0.135) * s * bw;
  const seg = kind === 'stripes' || kind === 'check' ? 18 : kind === 'pattern' ? 14 : 10;
  let torsoCol = cloth(top);
  if (kind === 'blazer') torsoCol = (x, y, z) => (Math.abs(ang(x, z)) < 0.42 && y > -0.35 ? acc : top);
  if (kind === 'vest') torsoCol = (x, y, z) => (Math.abs(ang(x, z)) < 0.28 ? acc : top);
  const tH = d.torso * 0.96;
  g.add(G.cyl(tw / waist, seg, kind === 'check' ? 5 : kind === 'pattern' ? 4 : 1), B.spine, mat(0, tH / 2 - 0.01 * s, 0, 0, 0, 0, waist, tH, tz), torsoCol);
  // плечи — сплющенная сфера сверху торса
  g.add(G.sph(10, 5), B.spine, mat(0, tH - 0.02 * s, 0, 0, 0, 0, tw * 1.02, 0.07 * s, tz * 1.02), kind === 'blazer' || kind === 'vest' ? top : cloth(top));
  if (f) g.add(G.sph(8, 5), B.spine, mat(0, tH * 0.66, tz * 0.55, 0, 0, 0, tw * 0.78, 0.075 * s, tz * 0.6),
    kind === 'blazer' ? acc : kind === 'vest' ? acc : cloth(top, acc, acc2, 2));
  if (look.build === 'heavy' || (look.build === 'stocky' && look.age > 35)) // живот
    g.add(G.sph(8, 6), B.spine, mat(0, tH * 0.22, tz * 0.35, 0, 0, 0, waist * 0.95, tH * 0.28, tz * 0.95), kind === 'blazer' ? acc : cloth(top, acc, acc2, 4));

  // детали одежды
  const front = y => tz * (y < 0.5 ? 1.0 : 1.0) + 0.004;
  if (kind === 'teePrint') { // принт на груди
    const pw = tw * (0.55 + hsh(1, 9) * 0.25);
    g.add(G.box(), B.spine, mat(0, tH * 0.62, tz * 0.98, 0, 0, 0, pw, 0.13 * s, 0.02), acc);
    g.add(G.box(), B.spine, mat((hsh(2, 9) - 0.5) * 0.05, tH * 0.62, tz * 0.98 + 0.01, 0, 0, hsh(3, 9), pw * 0.45, 0.05 * s, 0.02), acc2);
  }
  if (kind === 'hoodie') {
    g.add(G.torus(0.45, 10), B.spine, mat(0, tH + 0.01 * s, -tz * 0.35, Math.PI / 2 - 0.35, 0, 0, tw * 0.62, tz * 0.75, 0.07 * s), mul(top, 0.9)); // капюшон
    g.add(G.box(), B.spine, mat(0, tH * 0.22, tz * 0.93, 0, 0, 0, waist * 1.1, 0.12 * s, 0.03), mul(top, 0.85)); // карман
    for (const sx of [-1, 1]) g.add(G.box(), B.spine, mat(sx * 0.035 * s, tH * 0.78, tz * 0.99, 0, 0, 0, 0.012, 0.12 * s, 0.012), lin('#eeeeee'));
  }
  if (kind === 'sweat') g.add(G.cyl(1, seg), B.spine, mat(0, 0.015 * s, 0, 0, 0, 0, waist * 1.02, 0.04 * s, tz * 1.02), mul(top, 0.8));
  if (['polo', 'stripes', 'check', 'pattern'].includes(kind)) { // воротник
    const cc = kind === 'stripes' ? mixc(top, acc, 0.5) : kind === 'pattern' ? top : mul(top, 0.95);
    for (const sx of [-1, 1]) g.add(G.box(), B.spine, mat(sx * 0.05 * s, tH + 0.015 * s, tz * 0.55, 0.5, sx * 0.5, 0, 0.07 * s, 0.035 * s, 0.05 * s), cc);
    g.add(G.box(), B.spine, mat(0, tH * 0.8, tz * 0.99, 0, 0, 0, 0.022 * s, tH * 0.35, 0.01), mul(top, 0.8)); // планка
  }
  if (kind === 'blazer') for (const sx of [-1, 1]) // лацканы
    g.add(G.box(), B.spine, mat(sx * 0.075 * s, tH * 0.75, tz * 0.97, 0, 0, sx * 0.35, 0.045 * s, tH * 0.4, 0.02), mul(top, 0.8));
  if (kind === 'vest') for (const sx of [-1, 1]) for (const yy of [0.35, 0.6]) // карманы жилета
    g.add(G.box(), B.spine, mat(sx * tw * 0.55, tH * yy, tz * 0.92, 0, sx * 0.3, 0, 0.08 * s, 0.07 * s, 0.03), mul(top, 0.8));
  if (look.lanyard) g.add(G.box(), B.spine, mat(0, tH * 0.45, tz * 1.03, 0, 0, 0, 0.06 * s, 0.08 * s, 0.01), lin('#f4f4f4'));

  // ---- шея и голова ----
  g.add(G.cyl(0.9, 8), B.head, mat(0, d.neckLen * 0.4, 0.005, 0, 0, 0, 0.055 * s, d.neckLen * 1.6, 0.055 * s), skin);
  if (kind === 'sweat' || kind === 'tee' || kind === 'teePrint' || kind === 'dress')
    g.add(G.cyl(1, 10, 1, true), B.spine, mat(0, tH + 0.005, 0.005, 0, 0, 0, 0.066 * s, 0.02 * s, 0.062 * s), mul(top, 0.85));
  g.add(G.sph(12, 9), B.head, mat(0, hc, 0, 0, 0, 0, d.Rx, d.Ry, d.Rz), skin);
  // челюсть чуть уже — «подбородок»
  g.add(G.sph(8, 5), B.head, mat(0, hc - 0.5 * R, 0.25 * R, 0, 0, 0, d.Rx * 0.62, R * 0.45, R * 0.72), skin);
  for (const sx of [-1, 1]) g.add(G.sph(6, 4), B.head, mat(sx * d.Rx * 0.98, hc - 0.02 * R, 0, 0, 0, 0, 0.1 * R, 0.2 * R, 0.13 * R), skinD); // уши
  g.add(G.box(), B.head, mat(0, hc - 0.14 * R, fz(0, -0.14 * R) + 0.03 * R, -0.3, 0, 0, 0.13 * R, 0.24 * R, 0.14 * R), skinD); // нос
  // глаза (кость eyes — моргание), брови, рот
  const dark = lin('#231c1a');
  for (const sx of [-1, 1]) {
    const z = fz(eyeX, eyeY - hc);
    g.add(G.sph(6, 4), B.eyes, mat(sx * eyeX, 0, z - 0.01 * R, 0, 0, 0, 0.1 * R, 0.14 * R, 0.07 * R), dark);
    g.add(G.sph(4, 3), B.eyes, mat(sx * eyeX + 0.03 * R, 0.04 * R, z + 0.04 * R, 0, 0, 0, 0.025 * R, 0.025 * R, 0.02 * R), lin('#ffffff'));
  }
  const browC = look.hair.style === 'bald' || look.hair.style === 'buzz' ? mixc(hairC, skin, 0.3) : mixc(hairC, dark, 0.3);
  g.add(G.box(), B.browL, mat(0, 0, 0, 0, 0.3, 0, 0.3 * R, 0.065 * R, 0.06 * R), browC);
  g.add(G.box(), B.browR, mat(0, 0, 0, 0, -0.3, 0, 0.3 * R, 0.065 * R, 0.06 * R), browC);
  const lip = lin('#6a2e2e');
  g.add(G.box(), B.mouth, mat(0, 0, 0, 0, 0, 0, 0.24 * R, 0.07 * R, 0.05 * R), lip);
  g.add(G.box(), B.cornL, mat(0, 0, 0, 0, 0.5, 0, 0.1 * R, 0.06 * R, 0.05 * R), lip);
  g.add(G.box(), B.cornR, mat(0, 0, 0, 0, -0.5, 0, 0.1 * R, 0.06 * R, 0.05 * R), lip);

  // ---- волосы ----
  hair(g, look, d, hairC, greyC, skin, hsh);
  // ---- борода ----
  beard(g, look, d, lin(look.beardColor || look.hair.color), skin, fz);
  // ---- очки ----
  if (look.glasses) {
    const gc = lin(look.glasses === 'thin' ? '#b89a5a' : look.glasses === 'round' ? '#3a2a20' : '#161616');
    const tube = look.glasses === 'thin' ? 0.12 : 0.2, r = (look.glasses === 'round' ? 0.2 : 0.19) * R;
    const z = fz(eyeX, 0) + 0.06 * R;
    for (const sx of [-1, 1]) {
      if (look.glasses === 'round') g.add(G.torus(tube, 10), B.head, mat(sx * eyeX, eyeY, z, 0, 0, 0, r, r, r), gc);
      else g.add(G.frame(tube), B.head, mat(sx * eyeX, eyeY, z, 0, 0, 0, r * 1.3, r * 0.95, r), gc);   // √2/2 · 1.3 ≈ 0.92 r вширь, 0.67 r ввысь
      g.add(G.box(), B.head, mat(sx * d.Rx * 0.92, eyeY, z * 0.35, 0, 0, 0, 0.018 * R, 0.035 * R, z * 1.0), gc);
    }
    g.add(G.box(), B.head, mat(0, eyeY + 0.04 * R, z, 0, 0, 0, eyeX * 2 - 2 * r, 0.035 * R, 0.03 * R), gc);
  }
  if (look.earrings) for (const sx of [-1, 1]) g.add(G.sph(5, 4), B.head, mat(sx * d.Rx * 0.98, hc - 0.26 * R, 0.02 * R, 0, 0, 0, 0.055 * R, 0.055 * R, 0.055 * R), lin('#e8c060'));
  if (look.hat) hat(g, look, d, lin(look.hat.color));

  // ---- руки ----
  for (const [arm, fore, hand, sx] of [[B.armL, B.foreL, B.handL, 1], [B.armR, B.foreR, B.handR, -1]]) {
    const ar = d.armR * (longSleeve ? 1.1 : 1);
    const sleeveLen = longSleeve ? 1 : kind === 'dress' ? 0.25 : 0.5; // кратно 1/4
    g.add(G.sph(8, 6), arm, mat(0, -0.01 * s, 0, 0, 0, 0, ar * 1.2, ar * 1.15, ar * 1.15), kind === 'blazer' || kind === 'vest' ? (kind === 'vest' ? acc : top) : sleeveCloth); // плечо
    g.add(G.cyl(1.1, 8, 4), arm, mat(0, -d.upArm / 2, 0, 0, 0, 0, ar, d.upArm, ar),
      (x, y) => (y > 0.5 - sleeveLen ? (kind === 'blazer' ? top : typeof sleeveCloth === 'function' ? sleeveCloth(x, y, 0, 0) : sleeveC) : skin));
    if (!longSleeve) g.add(G.cyl(1, 8, 1, true), arm, mat(0, -d.upArm * sleeveLen + 0.01, 0, 0, 0, 0, ar * 1.18, 0.03 * s, ar * 1.18), kind === 'vest' ? acc : top); // обшлаг рукава
    const sl = longSleeve ? (kind === 'check' || kind === 'stripes' ? (hsh(5, 5) < 0.4 ? 0.5 : 1) : 1) : 0;
    g.add(G.sph(6, 5), fore, mat(0, 0, 0, 0, 0, 0, ar * 0.95, ar * 0.95, ar * 0.95), sl ? (kind === 'blazer' ? top : sleeveC) : skin); // локоть
    g.add(G.cyl(1.2, 8, 4), fore, mat(0, -d.foreArm / 2, 0, 0, 0, 0, ar * 0.85, d.foreArm, ar * 0.85),
      (x, y) => (y > 0.5 - sl ? (kind === 'blazer' ? top : sleeveC) : skin));
    if (sx === 1 && look.watch) g.add(G.cyl(1, 8), fore, mat(0, -d.foreArm + 0.02 * s, 0, 0, 0, 0, ar * 0.9, 0.025 * s, ar * 0.9), lin(hsh(6, 6) < 0.5 ? '#1a1a1a' : '#c0c4c8'));
    g.add(G.sph(7, 5), hand, mat(0, -0.045 * s, 0.005, 0, 0, 0, 0.034 * s, 0.055 * s, 0.022 * s), skin);
    g.add(G.sph(5, 4), hand, mat(-sx * 0.02 * s, -0.03 * s, 0.022 * s, 0, 0, 0, 0.012 * s, 0.028 * s, 0.012 * s), skin); // большой палец
  }

  // ---- ноги ----
  const dressLegs = kind === 'dress' || look.bottom.kind === 'skirt';
  for (const [thigh, shin] of [[B.thighL, B.shinL], [B.thighR, B.shinR]]) {
    const lr = d.legR;
    const dressC = cloth(top), legC = lin(look.bottom.kind === 'legs' ? look.bottom.color : look.skin);
    const thighC = (x, y) => kind === 'dress' ? (y > 0 ? dressC : legC)
      : look.bottom.kind === 'skirt' ? (y > 0 ? bot : skin)
      : look.bottom.kind === 'shorts' ? (y > -0.25 ? bot : skin) : legsC;
    const tc = thighC;
    g.add(G.cyl(1.25, 8, 4), thigh, mat(0, -d.thigh / 2, 0, 0, 0, 0, lr * 0.8, d.thigh, lr * 0.85), (x, y, z, i) => { const c = tc(x, y); return typeof c === 'function' ? c(x, y, z, i) : c; });
    const shinC = dressLegs ? lin(look.bottom.kind === 'legs' ? look.bottom.color : look.skin) : look.bottom.kind === 'shorts' ? skin : legsC;
    g.add(G.sph(6, 5), shin, mat(0, 0, 0, 0, 0, 0, lr * 0.84, lr * 0.8, lr * 0.86), shinC);
    g.add(G.cyl(1.25, 8), shin, mat(0, -d.shin / 2, 0, 0, 0, 0, lr * 0.6, d.shin, lr * 0.62), shinC);
    if (look.bottom.kind === 'jeans' || look.bottom.kind === 'chinos')
      g.add(G.cyl(1, 8, 1, true), shin, mat(0, -d.shin + 0.02 * s, 0, 0, 0, 0, lr * 0.64, 0.035 * s, lr * 0.66), mul(legsC, 0.85));
    g.add(G.box(), shin, mat(0, -d.shin - d.foot / 2 + 0.005, 0.04 * s, 0, 0, 0, lr * 1.15, d.foot, 0.24 * s), shoe);
    g.add(G.box(), shin, mat(0, -d.shin - d.foot + 0.008, 0.04 * s, 0, 0, 0, lr * 1.2, 0.016, 0.25 * s), mul(shoe, shoe[0] > 0.5 ? 0.8 : 2.2)); // подошва
  }

  // кости
  const bones = W.map(() => new T.Bone());
  bones.forEach((b, i) => {
    const p = PARENT[i], w = W[i], pw = p < 0 ? [0, 0, 0] : W[p];
    b.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    if (p >= 0) bones[p].add(b);
  });
  for (const i of [B.armL, B.armR, B.thighL, B.thighR]) bones[i].rotation.order = 'ZXY';
  bones[B.head].rotation.order = 'YXZ'; bones[B.hips].rotation.order = 'YXZ'; bones[B.spine].rotation.order = 'YXZ';
  return { geometry: g.build(), bones, W, d };
}

// ---------- волосы ----------
function hair(g, look, d, hairC, greyC, skin, hsh) {
  const st = look.hair.style, gr = look.hair.grey || 0, R = d.R, hc = d.headC;
  const col = () => gr > 0 ? mixc(hairC, greyC, gr * 0.6) : hairC; // проседь — ровным тоном: пятна выглядят камуфляжем
  const H = B.head, rx = d.Rx, ry = d.Ry, rz = d.Rz;
  const cap = (r = 1.07, tl = 0.52, tilt = -0.4, dy = 0.03, up = 1.1) =>
    g.add(G.sphPart(0, Math.PI * 2, 0, Math.PI * tl, 12, 6), H, mat(0, hc + dy * R, -0.02 * R, tilt, 0, 0, rx * r, ry * r * up, rz * r), col());
  if (look.hat && look.hat.kind !== 'capBack') { // под кепкой видно только края
    if (st === 'bald' || st === 'buzz' || st === 'balding') return;
    g.add(G.sphPart(Math.PI / 2 + 1.1, Math.PI * 2 - 2.2, Math.PI * 0.35, Math.PI * 0.25, 10, 3), H, mat(0, hc, 0, 0, 0, 0, rx * 1.06, ry * 1.04, rz * 1.06), col());
    if (st === 'long' || st === 'ponytail' || st === 'bob' || st === 'curly')
      g.add(G.box(), H, mat(0, hc - 0.55 * R, -0.75 * R, 0.15, 0, 0, 1.4 * R, (st === 'long' ? 1.5 : 0.7) * R, 0.3 * R), col(1));
    return;
  }
  switch (st) {
    case 'short': cap(1.08, 0.53, -0.42, 0.03, 1.15); break;
    case 'messy':
      cap(1.08, 0.53, -0.4, 0.03, 1.15);
      for (let i = 0; i < 7; i++) { const a = hsh(i, 30) * 6.28, e = 0.3 + hsh(i, 31) * 0.5;
        g.add(G.box(), H, mat(Math.sin(a) * rx * 0.6 * e, hc + ry * (0.95 - e * 0.25), Math.cos(a) * rz * 0.6 * e - 0.1 * R, hsh(i, 32) - 0.5, a, hsh(i, 33) - 0.5, 0.35 * R, 0.25 * R, 0.35 * R), col(2)); }
      break;
    case 'buzz': g.add(G.sphPart(0, Math.PI * 2, 0, Math.PI * 0.52, 12, 6), H, mat(0, hc + 0.02 * R, -0.03 * R, -0.42, 0, 0, rx * 1.03, ry * 1.03, rz * 1.03), mixc(hairC, skin, 0.15)); break;
    case 'bald': break;
    case 'balding': // венчик по бокам и сзади
      g.add(G.sphPart(Math.PI / 2 + 1.1, Math.PI * 2 - 2.2, Math.PI * 0.32, Math.PI * 0.26, 10, 3), H, mat(0, hc, 0, 0, 0, 0, rx * 1.05, ry * 1.03, rz * 1.05), col()); break;
    case 'curly':
      cap(1.06, 0.53, -0.4);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.28 + hsh(i, 40) * 0.3, e = i % 2 ? 0.55 : 0.85;
        if (Math.cos(a) > 0.55 && e > 0.6) continue; // лоб открыт
        g.add(G.sph(6, 4), H, mat(Math.sin(a) * rx * e, hc + ry * (0.95 - e * 0.55), Math.cos(a) * rz * e - 0.12 * R, 0, 0, 0, 0.36 * R, 0.33 * R, 0.36 * R), col(3)); }
      break;
    case 'ponytail':
      cap(1.07, 0.53, -0.38);
      g.add(G.sph(6, 5), H, mat(0, hc + 0.25 * R, -1.02 * R, 0, 0, 0, 0.18 * R, 0.18 * R, 0.18 * R), col(4));
      g.add(G.cyl(0.4, 6), H, mat(0, hc - 0.35 * R, -1.08 * R, -0.25, 0, 0, 0.2 * R, 1.1 * R, 0.16 * R), col(5));
      break;
    case 'bun':
      cap(1.07, 0.53, -0.38);
      g.add(G.sph(8, 6), H, mat(0, hc + 0.9 * R, -0.45 * R, 0, 0, 0, 0.36 * R, 0.3 * R, 0.36 * R), col(6));
      break;
    case 'bob': case 'long': {
      cap(1.08, 0.54, -0.3);
      // боковые и задние пряди — сфера без переднего сектора
      g.add(G.sphPart(Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, Math.PI * 0.2, Math.PI * 0.55, 12, 5), H, mat(0, hc, -0.02 * R, 0, 0, 0, rx * 1.12, ry * 1.08, rz * 1.1), col(7));
      if (st === 'long') {
        g.add(G.box(), H, mat(0, hc - 0.95 * R, -0.6 * R, 0.08, 0, 0, 1.65 * R, 1.4 * R, 0.4 * R), col(8));
        for (const sx of [-1, 1]) g.add(G.box(), H, mat(sx * 0.9 * R, hc - 0.8 * R, -0.12 * R, 0, 0, sx * -0.08, 0.28 * R, 1.3 * R, 0.55 * R), col(9));
      }
      // чёлка
      if (hsh(1, 50) < 0.5) g.add(G.sphPart(Math.PI / 2 - 0.9, 1.8, Math.PI * 0.15, Math.PI * 0.2, 8, 2), H, mat(0, hc + 0.02 * R, 0, 0, 0, 0, rx * 1.09, ry * 1.06, rz * 1.09), col(10));
      break;
    }
    default: cap();
  }
}

function beard(g, look, d, bc, skin, fz) {
  const t = look.beard; if (!t || t === 'none') return;
  const R = d.R, hc = d.headC, H = B.head;
  const front = (r, t0, tl, c, sy = 1) => g.add(G.sphPart(Math.PI / 2 - 1.45, 2.9, Math.PI * t0, Math.PI * tl, 10, 4), H, mat(0, hc, 0.01 * R, 0, 0, 0, d.Rx * r, d.Ry * r * sy, d.Rz * r), c);
  if (t === 'stubble') front(1.035, 0.58, 0.36, mixc(skin, bc, 0.45));
  if (t === 'short' || t === 'full') {
    front(t === 'full' ? 1.1 : 1.06, 0.56, 0.38, bc, 1.0);
    g.add(G.sph(8, 5), H, mat(0, hc - (t === 'full' ? 0.78 : 0.68) * R, 0.42 * R, 0, 0, 0, 0.55 * R, (t === 'full' ? 0.42 : 0.3) * R, 0.5 * R), bc);
  }
  if (t === 'mustache' || t === 'short' || t === 'full' || t === 'goatee')
    g.add(G.box(), H, mat(0, hc - 0.3 * R, fz(0, -0.3 * R) + 0.03 * R, 0, 0, 0, 0.42 * R, 0.1 * R, 0.08 * R), bc);
  if (t === 'goatee') g.add(G.box(), H, mat(0, hc - 0.72 * R, fz(0, -0.72 * R) + 0.02 * R, 0.2, 0, 0, 0.25 * R, 0.28 * R, 0.14 * R), bc);
}

function hat(g, look, d, c) {
  const R = d.R, hc = d.headC, H = B.head, k = look.hat.kind;
  if (k === 'cap' || k === 'capBack') {
    g.add(G.sphPart(0, Math.PI * 2, 0, Math.PI * 0.5, 12, 4), H, mat(0, hc + 0.12 * R, -0.03 * R, -0.12, 0, 0, d.Rx * 1.1, d.Ry * 0.95, d.Rz * 1.1), c);
    const zz = k === 'cap' ? 1 : -1;
    g.add(G.box(), H, mat(0, hc + 0.2 * R, zz * 1.2 * R, zz * -0.12, 0, 0, 1.3 * R, 0.07 * R, 0.8 * R), mul(c, 0.8));
  } else if (k === 'beanie') {
    g.add(G.sphPart(0, Math.PI * 2, 0, Math.PI * 0.55, 12, 5), H, mat(0, hc + 0.15 * R, -0.02 * R, -0.15, 0, 0, d.Rx * 1.12, d.Ry * 1.12, d.Rz * 1.12), c);
    g.add(G.cyl(1, 12), H, mat(0, hc + 0.18 * R, -0.03 * R, -0.15, 0, 0, d.Rx * 1.15, 0.2 * R, d.Rz * 1.15), mul(c, 0.8));
    g.add(G.sph(6, 4), H, mat(0, hc + 1.25 * R, -0.2 * R, 0, 0, 0, 0.22 * R, 0.22 * R, 0.22 * R), lin('#ffffff'));
  } else if (k === 'fedora') {
    g.add(G.cyl(0.85, 10), H, mat(0, hc + 0.75 * R, -0.03 * R, -0.1, 0, 0, d.Rx * 1.02, 0.55 * R, d.Rz * 1.02), c);
    g.add(G.cyl(1, 12), H, mat(0, hc + 0.5 * R, -0.03 * R, -0.1, 0, 0, d.Rx * 1.75, 0.04 * R, d.Rz * 1.75), c);
    g.add(G.cyl(1, 10), H, mat(0, hc + 0.58 * R, -0.03 * R, -0.1, 0, 0, d.Rx * 1.04, 0.12 * R, d.Rz * 1.04), lin('#7a2e36'));
  }
}

// ---------- пропы: общие геометрии с цветами в вершинах ----------
function propGeo(kind) {
  return prim('prop:' + kind, () => {
    const g = new Geo([[0, 0, 0]]), A = (geo, m, c) => g.add(geo, 0, m, lin(c));
    switch (kind) {
      case 'beer':
        A(G.cyl(1.1, 8), mat(0, 0, 0, 0, 0, 0, 0.034, 0.13, 0.034), '#e2a232');
        A(G.cyl(1, 8), mat(0, 0.075, 0, 0, 0, 0, 0.037, 0.03, 0.037), '#fff6e4');
        break;
      case 'phone':
        A(G.box(), mat(0, 0, 0, 0, 0, 0, 0.07, 0.14, 0.01), '#1b1b20');
        A(G.box(), mat(0, 0, 0.006, 0, 0, 0, 0.06, 0.12, 0.002), '#7cc4ff');
        break;
      case 'camera': case 'cameraNeck':
        A(G.box(), mat(0, 0, 0, 0, 0, 0, 0.13, 0.085, 0.07), '#1a1a1a');
        A(G.cyl(1, 10), mat(0.01, -0.005, 0.07, Math.PI / 2, 0, 0, 0.035, 0.08, 0.035), '#2c2c2c');
        A(G.cyl(1, 10), mat(0.01, -0.005, 0.111, Math.PI / 2, 0, 0, 0.03, 0.004, 0.03), '#5aa0d8');
        A(G.box(), mat(-0.035, 0.05, 0, 0, 0, 0, 0.04, 0.02, 0.04), '#c8c8c8');
        if (kind === 'cameraNeck') for (const sx of [-1, 1]) A(G.box(), mat(sx * 0.07, 0.13, -0.04, -0.25, 0, sx * 0.3, 0.012, 0.26, 0.006), '#b0263a');
        break;
      case 'mic':
        A(G.cyl(0.7, 8), mat(0, 0, 0, 0, 0, 0, 0.018, 0.17, 0.018), '#1a1a1a');
        A(G.sph(8, 6), mat(0, 0.1, 0, 0, 0, 0, 0.035, 0.035, 0.035), '#b8bcc4');
        A(G.cyl(1, 8), mat(0, 0.045, 0, 0, 0, 0, 0.02, 0.02, 0.02), '#e03a8a');
        break;
      case 'cup':
        A(G.cyl(0.85, 8), mat(0, 0, 0, 0, 0, 0, 0.04, 0.09, 0.04), '#f1efe8');
        A(G.cyl(1, 8), mat(0, 0.044, 0, 0, 0, 0, 0.036, 0.004, 0.036), '#5a3620');
        break;
      case 'glass':
        A(G.cyl(0.9, 8), mat(0, 0, 0, 0, 0, 0, 0.032, 0.15, 0.032), '#f2d86a');
        A(G.cyl(1, 6), mat(0.012, 0.09, 0, 0, 0, 0.2, 0.004, 0.08, 0.004), '#e03a3a');
        break;
      case 'wine':
        A(G.cyl(0.6, 8), mat(0, 0.06, 0, 0, 0, 0, 0.04, 0.06, 0.04), '#8a1f33');
        A(G.cyl(1, 6), mat(0, -0.02, 0, 0, 0, 0, 0.005, 0.1, 0.005), '#e8eef2');
        A(G.cyl(1, 8), mat(0, -0.07, 0, 0, 0, 0, 0.03, 0.004, 0.03), '#e8eef2');
        break;
      case 'cards':
        A(G.box(), mat(0, 0, 0, 0, 0, 0.2, 0.06, 0.09, 0.006), '#f4f0e8');
        A(G.box(), mat(0.02, 0, 0.004, 0, 0, -0.15, 0.06, 0.09, 0.006), '#c0263a');
        break;
      case 'banana':
        A(G.cyl(0.6, 6), mat(0, 0, 0, 0, 0, 0.35, 0.02, 0.17, 0.02), '#f2d23a');
        break;
      case 'tray':
        A(G.box(), mat(0, 0, 0, 0, 0, 0, 0.44, 0.02, 0.3), '#1c1c1c');
        A(G.box(), mat(0, 0.012, 0, 0, 0, 0, 0.42, 0.004, 0.28), '#b0263a');
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
          const x = -0.15 + i * 0.1, z = -0.08 + j * 0.08, sal = (i + j) % 2;
          A(G.cyl(1, 8), mat(x, 0.035, z, 0, 0, 0, 0.03, 0.04, 0.03), sal ? '#f7f3ea' : '#1f2a1f');
          A(G.cyl(1, 8), mat(x, 0.056, z, 0, 0, 0, 0.022, 0.004, 0.022), sal ? '#ff8a5c' : '#f7f3ea');
        }
        break;
      case 'laptop':
        A(G.box(), mat(0, 0, 0, 0, 0, 0, 0.022, 0.24, 0.33), '#b8bcc4');
        A(G.box(), mat(0.012, 0.02, 0.05, 0, 0, 0, 0.004, 0.06, 0.06), '#f2b134');
        A(G.box(), mat(0.012, -0.05, -0.06, 0, 0, 0, 0.004, 0.05, 0.05), '#2ea3a8');
        break;
      case 'teapot':
        A(G.sph(10, 7), mat(0, 0, 0, 0, 0, 0, 0.08, 0.065, 0.08), '#f1efe8');
        A(G.cyl(0.5, 6), mat(0, 0, 0.1, 0.9, 0, 0, 0.018, 0.09, 0.018), '#f1efe8');
        A(G.torus(0.25, 8), mat(0, 0.01, -0.085, 0, Math.PI / 2, 0, 0.04, 0.04, 0.04), '#f1efe8');
        A(G.sph(6, 4), mat(0, 0.07, 0, 0, 0, 0, 0.02, 0.015, 0.02), '#2e7d6a');
        A(G.cyl(1, 10), mat(0, 0.0, 0, 0, 0, 0, 0.081, 0.015, 0.081), '#2e7d6a');
        break;
      case 'sax': {
        const gold = '#d9a53a';
        A(G.cyl(1.4, 8), mat(0, 0.05, 0, 0, 0, 0, 0.03, 0.42, 0.03), gold);
        A(G.sph(8, 6), mat(0, -0.17, 0.03, 0, 0, 0, 0.05, 0.05, 0.05), gold);
        A(G.cyl(1.8, 10, 1, true), mat(0, -0.1, 0.1, -0.4, 0, 0, 0.055, 0.16, 0.055), gold);
        A(G.cyl(0.6, 6), mat(0, 0.3, -0.04, -0.9, 0, 0, 0.014, 0.12, 0.014), gold);
        A(G.cyl(0.6, 6), mat(0, 0.36, -0.1, -0.9, 0, 0, 0.012, 0.05, 0.012), '#1a1a1a');
        for (let i = 0; i < 5; i++) A(G.cyl(1, 6), mat(0, 0.12 - i * 0.06, 0.032, Math.PI / 2, 0, 0, 0.012, 0.01, 0.012), '#f4e2b0');
        break;
      }
      case 'cat-photo':
        A(G.box(), mat(0, 0, 0, 0, 0, 0, 0.24, 0.3, 0.02), '#7a4a26');
        A(G.box(), mat(0, 0, 0.011, 0, 0, 0, 0.2, 0.26, 0.002), '#9fd0e6');
        A(G.sph(8, 6), mat(0, -0.02, 0.012, 0, 0, 0, 0.07, 0.06, 0.01), '#f08a2a');       // морда
        for (const sx of [-1, 1]) {
          A(G.box(), mat(sx * 0.045, 0.04, 0.012, 0, 0, sx * -0.6, 0.03, 0.04, 0.008), '#f08a2a'); // уши
          A(G.box(), mat(sx * 0.025, -0.01, 0.024, 0, 0, 0, 0.012, 0.018, 0.004), '#1a1a1a');   // глаза
        }
        A(G.box(), mat(0, -0.075, 0.012, 0, 0, 0, 0.13, 0.05, 0.004), '#f08a2a');
        break;
    }
    const geo = g.build(); geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); return geo;
  });
}
// где держать проп: кость, позиция, поворот, «держать вертикально»
function propMount(kind, pose, d) {
  const s = d.s;
  switch (kind) {
    case 'beer': return { bone: B.handR, p: [0, -0.06 * s, 0.035 * s], up: true };
    case 'teapot': return { bone: B.handR, p: [0, -0.1 * s, 0], up: true };
    case 'phone': return pose === 'phone' || pose === 'photo'
      ? { bone: B.handR, p: [0.01, -0.07 * s, 0.03 * s], r: [-1.2, 0, 0] }
      : { bone: B.handR, p: [0.01, -0.07 * s, 0.025 * s], r: [0, 0, 0] };
    case 'mic': return { bone: B.handR, p: [0, -0.06 * s, 0.03 * s], r: [-1.3, 0, 0] };
    case 'cup': case 'glass': case 'wine': return { bone: B.handR, p: [0, -0.06 * s, 0.035 * s], up: true };
    case 'cards': case 'banana': return { bone: B.handR, p: [0.01, -0.07 * s, 0.03 * s], r: [-0.6, 0, 0] };
    case 'tray': return { bone: B.handL, p: [-0.06 * s, -0.04 * s, 0.1 * s], up: true };
    case 'laptop': return { bone: B.spine, p: [d.shW + 0.07, d.torso * 0.55, 0.03], r: [0, -0.55, 0.12] };
    case 'camera': return pose === 'photo'
      ? { bone: B.head, p: [0, d.headC + 0.02 * s, d.R + 0.07], r: [0, 0, 0], geo: 'camera' }
      : { bone: B.spine, p: [0, d.torso * 0.55, d.shW * 0.72 + 0.04], r: [0, 0, 0], geo: 'cameraNeck' };
    case 'sax': return { bone: B.spine, p: [0.02, d.torso * 0.25, d.shW * 0.7 + 0.08], r: [0.1, 0, -0.25] };
    case 'cat-photo': return { bone: B.spine, p: [0, d.torso * 0.62, d.shW * 0.7 + 0.2], r: [-0.25, 0, 0] };
  }
  return null;
}
// проп, который подразумевает поза
const POSE_PROP = { phone: 'phone', drink: 'beer', photo: 'camera', sing: 'mic' };
// что держат с позой «пьёт»; синонимы пропов симуляции (меню бара, чудики) → свои модели (null — без пропа)
const DRINKS = ['teapot', 'beer', 'cup', 'glass', 'wine'];
const PROP_ALIAS = { 'sushi-tray': 'tray', 'cat-carrier': 'cat-photo', coffee: 'cup', tea: 'cup', lemonade: 'glass',
  backpack: null, hoodie: null, glasses: null, napkin: null, cigarette: null };

// ---------- поза: набор чисел ----------
const KEYS = ['hipY', 'hipZ', 'hipRx', 'hipRy', 'hipRz', 'spRx', 'spRy', 'spRz', 'hdRx', 'hdRy', 'hdRz',
  'aLx', 'aLy', 'aLz', 'eL', 'aRx', 'aRy', 'aRz', 'eR', 'hLx', 'hRx',
  'tLx', 'tLz', 'kL', 'tRx', 'tRz', 'kR', 'brow', 'sad', 'smile', 'mouth', 'squint', 'breath'];
const zeroPose = () => { const o = {}; for (const k of KEYS) o[k] = 0; return o; };

// шум для жестов: сумма синусов
const wob = (t, a) => Math.sin(t * 1.7 + a) * 0.6 + Math.sin(t * 2.9 + a * 2.1) * 0.4;

function poseTarget(p, t, P) {
  const d = p.d, s = d.s, m = clamp(p.mood, -1, 1), ph = p.phase, sp = p.speaking;
  for (const k of KEYS) P[k] = 0;
  const pose = p.pose;
  const sitting = !!p.seat; // сидит: поза sit/sitSofa или верхняя поза (phone, drink…) поверх сидения
  const walking = !sitting && (pose === 'walk' || pose === 'leave' || p.speed > 0.35);
  const prop = p.shownProp;
  // стойка
  P.hipY = d.hipY; P.aLz = 0.07; P.aRz = -0.07; P.eL = -0.12; P.eR = -0.12;
  P.tLz = 0.02; P.tRz = -0.02; P.breath = Math.sin(t * 1.7 + ph) * 0.5 + 0.5;
  // настроение: сутулость ↔ открытость
  const low = Math.max(0, -m), up = Math.max(0, m);
  P.spRx = 0.1 * low - 0.04 * up; P.hdRx = 0.18 * low - 0.06 * up;
  P.aLz += 0.05 * up; P.aRz -= 0.05 * up;
  P.smile = m * 0.9; P.sad = low; P.brow = up * 0.3;
  // лёгкое покачивание, перенос веса
  const sway = Math.sin(t * 0.55 + ph * 3);
  P.hipRz = 0.025 * sway; P.hipZ = 0; P.spRz = -0.02 * sway; P.hdRz = 0.03 * Math.sin(t * 0.37 + ph);
  P.tLx = -0.02 * sway; P.tRx = 0.02 * sway;

  if (walking) {
    const w = p.walkT, a = Math.min(1, 0.45 + p.speed * 0.45);
    const sL = Math.sin(w), sR = Math.sin(w + Math.PI);
    P.tLx = -0.5 * a * sL; P.tRx = -0.5 * a * sR;
    P.kL = Math.max(0, Math.sin(w - 1.3)) * 0.95 * a + 0.08; P.kR = Math.max(0, Math.sin(w + Math.PI - 1.3)) * 0.95 * a + 0.08;
    P.aLx = 0.4 * a * sL; P.aRx = 0.4 * a * sR; P.eL = -0.3 - 0.2 * Math.max(0, -sL); P.eR = -0.3 - 0.2 * Math.max(0, -sR);
    P.hipY = d.hipY - 0.025 * s + Math.abs(Math.cos(w)) * 0.03 * s;
    P.hipRy = 0.12 * a * sL; P.spRy = -0.16 * a * sL; P.hipRz = 0; P.spRz = 0;
    P.spRx += 0.05;
  }

  if (sitting) {
    const sofa = p.seat === 'sitSofa', seat = sofa ? SEAT_SOFA : SEAT;
    P.hipY = seat + 0.085 * s; P.hipZ = sofa ? -0.08 : -0.05;
    const tx = sofa ? -1.45 : -1.52;
    const kneeY = P.hipY - 0.03 * s - d.thigh * Math.cos(tx);
    const th = Math.acos(clamp(kneeY / (d.shin + d.foot), -1, 1));
    const spread = sofa ? 0.2 : 0.1;
    P.tLx = tx; P.tRx = tx; P.tLz = spread; P.tRz = -spread; P.kL = -th - tx; P.kR = -th - tx;
    // одна нога вперёд — живее
    if (hash01(p.seedI, 3) < 0.4 && !sofa) { P.kL -= 0.35; }
    P.hipRz = 0; P.spRz = 0;
    if (sofa) { P.spRx = -0.28 + 0.1 * low; P.hdRx = 0.18 + 0.1 * low; P.aLz = 0.5; P.aRz = -0.5; P.aLx = 0.35; P.aRx = 0.35; P.eL = -0.4; P.eR = -0.4; }
    else { P.spRx = 0.08 + 0.12 * low; P.aLx = -0.35; P.aRx = -0.35; P.eL = -0.95; P.eR = -0.95; P.aLz = 0.12; P.aRz = -0.12; P.aLy = -0.25; P.aRy = 0.25; }
  }

  // руки заняты пропом (в обычной стойке/ходьбе/сидя)
  const handsFree = !['wave', 'photo', 'sing', 'laugh', 'phone', 'drink'].includes(pose);
  if (handsFree && prop) carry(prop, P, walking, t, ph, sp);

  // скрещённые руки: плохое настроение, стоит и молчит, руки свободны
  if (m < -0.35 && !sp && !walking && !sitting && (pose === 'stand' || pose === 'talk') && (!prop || prop === 'camera' || prop === 'sax')) {
    P.aLx = -0.4; P.aRx = -0.4; P.aLy = -1.25; P.aRy = 1.25; P.eL = -1.85; P.eR = -1.85; P.aLz = 0.18; P.aRz = -0.18;
  }

  // говорит: жесты, кивки, рот
  if (sp) {
    const g1 = wob(t * 1.6, ph), g2 = wob(t * 1.3, ph + 2), g3 = wob(t * 1.1, ph + 4);
    if (!(prop && ['tray', 'laptop'].includes(prop))) { // левая рука жестикулирует, если свободна
      const on = Math.max(0, Math.sin(t * 0.45 + ph)) ; // левая — не всегда
      P.aLx = lerp(P.aLx, -0.2 - 0.12 * g2, on); P.eL = lerp(P.eL, -1.5 - 0.3 * g3, on); P.aLy = lerp(P.aLy, -0.35, on); P.aLz = lerp(P.aLz, 0.3 + 0.12 * g1, on);
    }
    if (!prop || prop === 'camera' || prop === 'sax' || prop === 'cat-photo' || prop === 'laptop' || prop === 'tray') {
      P.aRx = -0.22 - 0.15 * g1; P.eR = -1.55 - 0.35 * g2; P.aRy = 0.35 + 0.2 * g3; P.aRz = -0.3 - 0.12 * g2;
    }
    P.hdRx += 0.06 * Math.sin(t * 3.3 + ph); P.hdRz += 0.05 * g1;
    P.mouth = 0.35 + 0.35 * Math.abs(Math.sin(t * 11 + ph)) * (0.6 + 0.4 * Math.sin(t * 2.3));
    P.brow += 0.35 * Math.max(0, g2);
  } else if (pose === 'talk' || sitting) { // слушает — кивает
    const nod = Math.max(0, Math.sin(t * 0.9 + ph * 5)) ** 8;
    P.hdRx += 0.12 * nod; P.hdRz += 0.08 * Math.sin(t * 0.3 + ph);
  }

  switch (pose) {
    case 'laugh': {
      const k = Math.sin(t * 16) * 0.5 + 0.5;
      P.spRx = -0.12 + 0.04 * k; P.hdRx = -0.3 + 0.05 * k; P.hipY -= 0.005 * k;
      P.mouth = 0.8 + 0.2 * k; P.smile = 1; P.squint = 1; P.brow = 0.5;
      P.aRx = -0.55; P.eR = -1.4; P.aRy = 0.7; P.aRz = -0.05; // рука на животе
      P.aLx = -0.25 + 0.15 * k; P.eL = -0.6; P.aLz = 0.25;
      if (sitting) { P.spRx = -0.05 - (p.seat === 'sitSofa' ? 0.25 : 0); P.hipY += 0.005 * k; }
      break;
    }
    case 'phone':
      P.hdRx = 0.5; P.spRx += 0.08;
      P.aRx = -0.3; P.eR = -1.75; P.aRy = 0.3; P.aRz = -0.05;
      P.aLx = -0.25; P.eL = -1.35; P.aLy = -0.55; P.aLz = 0.05;
      P.mouth = 0; P.smile = m * 0.5;
      break;
    case 'drink': {
      const cyc = (t * 0.22 + ph) % 1, sip = cyc < 0.2 ? Math.sin(cyc / 0.2 * Math.PI) : 0;
      P.aRx = lerp(-0.15, -0.8, sip); P.eR = lerp(-1.25, -2.05, sip); P.aRy = lerp(0.15, 0.6, sip); P.aRz = -0.05;
      P.hdRx -= 0.3 * sip; if (sip > 0.3) P.mouth = 0.3;
      break;
    }
    case 'photo':
      P.aRx = -1.05; P.eR = -1.6; P.aRy = 0.55; P.aRz = -0.35;
      P.aLx = -1.05; P.eL = -1.6; P.aLy = -0.55; P.aLz = 0.35;
      P.hdRx = 0.05; P.spRx = 0.05; P.squint = 0.6;
      break;
    case 'sing': {
      const b = Math.sin(t * 5);
      if (prop === 'sax') { // играет на саксофоне
        P.aRx = -0.4; P.eR = -1.1; P.aRy = 0.5; P.aLx = -0.7; P.eL = -1.4; P.aLy = -0.6;
        P.spRx = -0.12 + 0.06 * b; P.hdRx = 0.15;
      } else {
        P.aRx = -0.65; P.eR = -2.05; P.aRy = 0.55; P.aRz = -0.1;
        P.aLx = -0.2; P.aLz = 1.1 + 0.3 * b; P.eL = -0.4;
        P.hdRx = -0.2; P.mouth = 0.6 + 0.4 * Math.abs(Math.sin(t * 7)); P.brow = 0.6; P.smile = Math.max(0.3, P.smile);
      }
      P.spRz = -0.1 * b; if (!sitting) { P.hipRz = 0.08 * b; P.kL = 0.1 + 0.1 * Math.max(0, b); P.kR = 0.1 + 0.1 * Math.max(0, -b); }
      break;
    }
    case 'wave':
      P.aRz = -2.55 + 0.28 * Math.sin(t * 8); P.aRx = -0.2; P.eR = -0.35; P.aRy = 0;
      P.smile = Math.max(0.6, P.smile); P.brow = 0.6; P.hdRz = 0.1;
      break;
    case 'leave':
      P.hdRy = 0.9; P.spRy = 0.3; P.aLz = 2.3 + 0.25 * Math.sin(t * 8); P.aLx = -0.2; P.eL = -0.3; P.smile = Math.max(0.5, P.smile);
      break;
  }
  if (sitting && ['phone', 'drink', 'photo'].includes(pose)) P.hdRx = Math.min(P.hdRx, pose === 'phone' ? 0.5 : 0.1);
  // голова к собеседнику
  if (pose !== 'leave' && p.lookYaw !== null) {
    const y = clamp(p.lookYaw, -1.2, 1.2);
    P.hdRy += y * 0.7; P.spRy += y * 0.25;
  }
}

function carry(prop, P, walking, t, ph, sp) {
  switch (prop) {
    case 'beer': case 'mic': P.aRx = walking ? -0.3 : -0.15; P.eR = -1.25; P.aRy = 0.15; P.aRz = -0.05; break;
    case 'phone': P.aRx = -0.1; P.eR = -0.9; P.aRy = 0.3; break;
    case 'teapot': P.aRx = -0.05; P.eR = -0.3; P.aRz = -0.12; break;
    case 'tray': P.aLx = -0.2; P.eL = -1.45; P.aLy = -0.1; P.aLz = 0.3; break;
    case 'laptop': P.aLx = 0.05; P.aLz = 0.2; P.eL = -0.5; P.aLy = -0.4; break;
    case 'cat-photo': P.aRx = -0.4; P.eR = -1.2; P.aRy = 0.75; P.aRz = -0.2; P.aLx = -0.4; P.eL = -1.2; P.aLy = -0.75; P.aLz = 0.2; break;
    case 'sax': P.aRx = -0.2; P.eR = -0.9; P.aRy = 0.3; break;
  }
}

// ---------- общие ресурсы ----------
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const body = new T.MeshLambertMaterial({ vertexColors: true });
  const hover = new T.MeshLambertMaterial({ vertexColors: true, emissive: new T.Color('#4a3418') });
  const pick = new T.MeshBasicMaterial({ visible: false });
  const pickGeo = new T.CylinderGeometry(0.26, 0.26, 1, 6); pickGeo.translate(0, 0.5, 0);
  const ringGeo = new T.RingGeometry(0.33, 0.42, 28); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = k => new T.MeshBasicMaterial({ color: k, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const rings = { hover: ringMat('#ffe6a8'), talk: ringMat('#ff9f3a'), known: ringMat('#6fd6c6') };
  // пятно-тень: радиальный градиент
  let tex = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); tex = new T.CanvasTexture(c);
  }
  const shadowMat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -1 });
  const shadowGeo = new T.PlaneGeometry(1, 1); shadowGeo.rotateX(-Math.PI / 2);
  const propMat = new T.MeshLambertMaterial({ vertexColors: true });
  // полупрозрачные ступени для тех, кто закрывает собеседника (без записи глубины — собеседник виден сквозь)
  const ghost = [0.75, 0.5, 0.3].map(o => new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: o, depthWrite: false }));
  return (SHARED = { body, hover, pick, pickGeo, ringGeo, rings, shadowMat, shadowGeo, propMat, ghost });
}

const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// ═══ People ═══
class People {
  constructor(scene) {
    this.scene = scene; this.map = new Map(); this.pickables = []; this.t = 0;
    this.hl = { hover: null, talk: null, known: new Set() };
    const S = shared();
    this.root = new T.Group(); this.root.name = 'people'; scene.add(this.root);
    this.cap = 64;
    this.shadows = new T.InstancedMesh(S.shadowGeo, S.shadowMat, this.cap);
    this.shadows.count = 0; this.shadows.frustumCulled = false; this.shadows.renderOrder = 1;
    this.root.add(this.shadows);
    this._P = zeroPose(); this._lookTimer = 0;
    this._grabCam(); this._fadeT = 0;
  }

  add(id, look) {
    if (this.map.has(id)) this.remove(id);
    const S = shared();
    const fig = buildFigure(look);
    const mesh = new T.SkinnedMesh(fig.geometry, S.body);
    mesh.add(fig.bones[0]); mesh.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(fig.bones));
    mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0.9, 0), 1.4); // поза меняется — сфера с запасом
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.userData.personId = id;
    const group = new T.Group(); group.add(mesh);
    const pick = new T.Mesh(S.pickGeo, S.pick); pick.userData.personId = id; pick.scale.set(1, fig.d.top, 1); group.add(pick);
    const ring = new T.Mesh(S.ringGeo, S.rings.hover); ring.visible = false; ring.position.y = 0.015; ring.renderOrder = 2;
    const rs = 0.9 + 0.25 * (fig.d.bw - 1); ring.scale.set(rs, 1, rs); group.add(ring);
    this.root.add(group);
    const p = {
      id, look, d: fig.d, mesh, group, pick, ring, bones: fig.bones, ringBase: rs,
      x: 0, z: 0, tx: 0, tz: 0, rot: 0, trot: 0, placed: false, pose: 'stand', mood: 0, speaking: false,
      seat: null, sx: 0, sz: 0, prop: undefined, shownProp: null, propMesh: null, propKey: '',
      speed: 0, walkT: 0, phase: hash01(look.seed || 1, 1) * 6.28, seedI: look.seed || 1,
      lookAt: null, lookPt: null, lookYaw: null, blinkT: 1 + hash01(look.seed || 1, 2) * 4, blink: 0,
      cur: zeroPose(), tgt: zeroPose(),
    };
    p.cur.hipY = fig.d.hipY;
    for (const i of [B.browL, B.browR, B.cornL, B.cornR]) p.bones[i].userData.y0 = p.bones[i].position.y; // исходные высоты — для мимики
    this.map.set(id, p); this.pickables.push(pick);
    this._grow();
    this._applyProp(p);
    this._applyHl(p);
    return p;
  }

  set(id, o) {
    const p = this.map.get(id); if (!p) return;
    if (o.x !== undefined) p.tx = o.x;
    if (o.z !== undefined) p.tz = o.z;
    if (o.y !== undefined) p.y = +o.y || 0;   // высота пола под ногами (подиум сцены); по умолчанию 0
    if (!p.placed && (o.x !== undefined || o.z !== undefined)) { p.x = p.tx; p.z = p.tz; p.placed = true; if (o.rot !== undefined) p.rot = o.rot; }
    if (o.rot !== undefined) p.trot = o.rot;
    if (o.pose !== undefined) p.pose = POSES.includes(o.pose) ? o.pose : 'stand';
    // сидит ли: sit/sitSofa сажают; stand/walk/leave или уход с места (>0.3 м) — поднимают;
    // остальные позы (phone, drink, laugh, talk…) на месте — остаются сидя. Можно задать явно: seat:'sit'|'sitSofa'|null
    if ('seat' in o) p.seat = o.seat === 'sofa' ? 'sitSofa' : o.seat ? (o.seat === 'sitSofa' ? 'sitSofa' : 'sit') : null;
    else if (p.pose === 'sit' || p.pose === 'sitSofa') { p.seat = p.pose; p.sx = p.tx; p.sz = p.tz; }
    else if (p.pose === 'stand' || p.pose === 'walk' || p.pose === 'leave') p.seat = null;
    if (p.seat && Math.hypot(p.tx - p.sx, p.tz - p.sz) > 0.3) p.seat = null;
    if (o.mood !== undefined) p.mood = +o.mood || 0;
    if (o.speaking !== undefined) p.speaking = !!o.speaking;
    if ('prop' in o) p.prop = o.prop;
    if ('lookAt' in o) p.lookAt = o.lookAt;   // необязательно: id или {x,z}; иначе — сам ищет собеседника
    this._applyProp(p);
  }

  remove(id) {
    const p = this.map.get(id); if (!p) return;
    this.root.remove(p.group); p.mesh.geometry.dispose(); p.mesh.skeleton.dispose();
    const i = this.pickables.indexOf(p.pick); if (i >= 0) this.pickables.splice(i, 1);
    this.map.delete(id); this.hl.known.delete(id);
    if (this.hl.hover === id) this.hl.hover = null;
    if (this.hl.talk === id) this.hl.talk = null;
  }

  // точка над головой (для подписей): {x,y,z}
  anchor(id) {
    const p = this.map.get(id); if (!p) return null;
    const sit = !!p.seat;
    return { x: p.x, y: (p.y || 0) + p.d.top + 0.12 - (sit ? p.d.hipY - p.d.sitHip : 0), z: p.z };
  }

  highlight(id, kind = 'hover') {
    if (kind === 'known') {
      if (id === null || id === undefined) this.hl.known.clear();
      else for (const k of Array.isArray(id) ? id : [id]) this.hl.known.add(k);
    } else this.hl[kind] = id ?? null;
    for (const p of this.map.values()) this._applyHl(p);
  }
  _applyHl(p) {
    const S = shared(), id = p.id;
    const k = this.hl.talk === id ? 'talk' : this.hl.hover === id ? 'hover' : this.hl.known.has(id) ? 'known' : null;
    p.ring.visible = !!k; if (k) p.ring.material = S.rings[k];
    p.hlKind = k;
    this._applyMat(p);
  }

  _applyProp(p) {
    const own = PROP_ALIAS[p.prop ?? p.look.prop] ?? (p.prop ?? p.look.prop);
    let want = POSE_PROP[p.pose] && !(p.pose === 'sing' && own === 'sax')
      ? (p.pose === 'drink' && DRINKS.includes(own) ? own : POSE_PROP[p.pose])
      : (p.prop !== undefined ? PROP_ALIAS[p.prop] ?? p.prop : PROP_ALIAS[p.look.prop] ?? p.look.prop);
    const mount = want ? propMount(want, p.pose, p.d) : null;
    if (!mount) want = null;   // незнакомый проп (из меню, у чудика) — просто пустые руки
    const key = want ? want + ':' + (mount.geo || want) + ':' + mount.bone + ':' + (p.pose === 'phone') : '';
    p.shownProp = want || null;
    if (key === p.propKey) return;
    p.propKey = key;
    if (p.propMesh) { p.propMesh.parent.remove(p.propMesh); p.propMesh = null; }
    if (!want) return;
    const m = new T.Mesh(propGeo(mount.geo || want), shared().propMat);
    m.position.fromArray(mount.p); if (mount.r) m.rotation.set(...mount.r);
    m.castShadow = true; m.userData.up = !!mount.up;
    p.bones[mount.bone].add(m); p.propMesh = m;
  }

  _grow() {
    if (this.map.size <= this.cap) return;
    const S = shared(); this.cap *= 2;
    this.root.remove(this.shadows); this.shadows.dispose();
    this.shadows = new T.InstancedMesh(S.shadowGeo, S.shadowMat, this.cap); this.shadows.frustumCulled = false; this.shadows.renderOrder = 1;
    this.root.add(this.shadows); this._grabCam();
  }
  // камера кадра: пятна-тени рисуются всегда — от них и узнаём, откуда смотрят (для прозрачности заслоняющих)
  _grabCam() { this.shadows.onBeforeRender = (r, sc, cam) => { this.cam = cam; }; }

  // для камеры разговора: собеседник a, игрок b и все остальные как столбики { x, z, r, top }
  sight(a, b) {
    const one = p => ({ x: p.tx, z: p.tz, top: this._top(p), rot: p.trot, r: 0.2 + 0.06 * (p.d.bw - 1) });
    const A = this.map.get(a), B_ = this.map.get(b); if (!A || !B_) return null;
    const blockers = [];
    for (const p of this.map.values()) if (p !== A && p !== B_) blockers.push(one(p));
    return { a: one(A), b: one(B_), blockers };
  }
  _top(p) { return p.d.top - (p.seat ? p.d.hipY - p.d.sitHip : 0); }

  // пока идёт разговор (подсветка 'talk'): люди на линии взгляда камеры к собеседнику и игроку — полупрозрачные
  _occlusion(dt) {
    const A = this.hl.talk != null ? this.map.get(this.hl.talk) : null, Me = this.map.get('me'), cam = this.cam;
    const pts = [];
    if (A && cam) for (const q of Me ? [A, Me] : [A]) { const top = this._top(q); pts.push([q.x, top - 0.12, q.z], [q.x, top - 0.5, q.z]); }
    const c = cam && cam.position;
    for (const p of this.map.values()) {
      let hit = false;
      if (pts.length && p !== A && p !== Me) {
        const top = this._top(p) + 0.05, r = 0.24 + 0.06 * (p.d.bw - 1);
        for (const t of pts) {
          // часть луча камера→точка ниже макушки p; ближе всего к оси p в плане — заслоняет
          if (c.y <= top && t[1] > top) continue;
          const t0 = c.y > top ? clamp((c.y - top) / Math.max(1e-3, c.y - t[1]), 0, 1) : 0;
          const x0 = c.x + (t[0] - c.x) * t0, z0 = c.z + (t[2] - c.z) * t0, dx = t[0] - x0, dz = t[2] - z0, l2 = dx * dx + dz * dz;
          const u = l2 > 1e-6 ? clamp(((p.x - x0) * dx + (p.z - z0) * dz) / l2, 0, 1) : 0;
          if (u > 0.97) continue;   // за точкой (или вплотную позади)
          if (Math.hypot(p.x - x0 - dx * u, p.z - z0 - dz * u) < r) { hit = true; break; }
        }
      }
      // гистерезис: прячется сразу, возвращается через 0.4 с свободной линии
      p.hideT = hit ? 0.4 : Math.max(0, (p.hideT || 0) - dt);
      const want = p.hideT > 0 ? 1 : 0, f0 = p.fade || 0;
      p.fade = clamp(f0 + Math.sign(want - f0) * dt * 5, 0, 1);
      if ((p.fade > 0) !== (f0 > 0) || Math.floor(p.fade * 3) !== Math.floor(f0 * 3)) this._applyMat(p);
    }
  }
  _applyMat(p) {
    const S = shared(), f = p.fade || 0;
    p.mesh.material = f > 0 ? S.ghost[Math.min(2, Math.floor(f * 3))] : this.hl.hover === p.id || this.hl.talk === p.id ? S.hover : S.body;
    if (p.propMesh) p.propMesh.visible = f < 0.5;
    p.ring.visible = !!p.hlKind && f < 0.5;
  }

  // кого слушать/на кого смотреть: говорящий рядом, иначе ближайший впереди
  _pickLook(p) {
    if (p.lookAt) {
      const q = typeof p.lookAt === 'object' ? p.lookAt : this.map.get(p.lookAt);
      p.lookPt = q ? { x: q.x, z: q.z } : null; return;
    }
    let best = null, bs = 1e9;
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot);
    for (const q of this.map.values()) {
      if (q === p) continue;
      const dx = q.x - p.x, dz = q.z - p.z, dd = dx * dx + dz * dz;
      if (dd > 6.25) continue;
      const front = (dx * fx + dz * fz) / Math.sqrt(dd + 1e-6);
      if (front < -0.2) continue;
      // говорящих слушаем в первую очередь; у говорящего — меняем слушателя раз в пару секунд
      let score = dd - (q.speaking ? 4 : 0) - front;
      if (p.speaking) score += hash01(p.seedI + Math.floor(this.t / 2.5), q.seedI % 97) * 3;
      if (score < bs) { bs = score; best = q; }
    }
    p.lookPt = best ? { x: best.x, z: best.z } : null;
  }

  update(dt) {
    dt = Math.min(dt, 0.1); this.t += dt;
    const t = this.t, P = this._P, S = shared();
    this._lookTimer -= dt;
    const relook = this._lookTimer <= 0; if (relook) this._lookTimer = 0.3;
    const im = this.shadows, M = new T.Matrix4();
    let n = 0;
    for (const p of this.map.values()) {
      // перемещение: плавно к последней позиции
      const dx = p.tx - p.x, dz = p.tz - p.z, dist = Math.hypot(dx, dz);
      let mv = 0;
      if (dist > 6) { p.x = p.tx; p.z = p.tz; }
      else if (dist > 1e-4) {
        const step = Math.min(dist, Math.max(dist * damp(6, dt), Math.min(dist, 0.6 * dt)));
        p.x += dx / dist * step; p.z += dz / dist * step; mv = step;
      }
      p.speed = lerp(p.speed, mv / Math.max(dt, 1e-4), damp(6, dt));
      const moving = p.speed > 0.35 && dist > 0.05 && !p.seat;
      // поворот: по кратчайшей дуге; на ходу — по направлению движения
      const want = moving ? Math.atan2(dx, dz) : p.trot;
      p.rot += wrapPi(want - p.rot) * damp(moving ? 8 : 5, dt);
      p.rot = wrapPi(p.rot);
      // шаг анимации ходьбы привязан к пройденному пути
      const walkPose = p.pose === 'walk' || p.pose === 'leave';
      p.walkT += dt * (moving ? 2.2 + p.speed * 3.2 : walkPose ? 5 : 0);
      if (relook) this._pickLook(p);
      if (p.lookPt) {
        const a = Math.atan2(p.lookPt.x - p.x, p.lookPt.z - p.z);
        p.lookYaw = wrapPi(a - p.rot); if (Math.abs(p.lookYaw) > 1.8) p.lookYaw = null;
      } else p.lookYaw = Math.sin(t * 0.21 + p.phase * 2) * 0.35 * (Math.sin(t * 0.07 + p.phase) > 0.3 ? 1 : 0);
      // моргание
      p.blinkT -= dt; if (p.blinkT < 0) { p.blink = 0.14; p.blinkT = 2 + hash01(p.seedI, Math.floor(t)) * 4; }
      p.blink = Math.max(0, p.blink - dt);

      poseTarget(p, t + p.phase * 10, P);
      const c = p.cur, k1 = damp(12, dt), kF = damp(18, dt);
      for (const key of KEYS) c[key] += (P[key] - c[key]) * (key === 'mouth' ? kF : k1);
      this._pose(p, c);

      p.group.position.set(p.x, p.y || 0, p.z); p.group.rotation.y = p.rot;
      if (p.hlKind) { const pulse = p.hlKind === 'talk' ? 1 + 0.06 * Math.sin(t * 5) : 1; p.ring.scale.set(p.ringBase * pulse, 1, p.ringBase * pulse); }
      p.pick.scale.y = p.d.top - (c.hipY < p.d.hipY - 0.2 ? p.d.hipY - c.hipY : 0);
      // проп «вертикально»: компенсируем поворот руки
      if (p.propMesh && p.propMesh.userData.up) {
        p.group.updateMatrixWorld(true);
        p.propMesh.parent.getWorldQuaternion(_q).invert();
        p.propMesh.quaternion.copy(_q).multiply(p.group.quaternion);
      }
      // тень
      const r = 0.55 * p.d.bw * (p.seat ? 1.25 : 1);
      M.makeScale(r * 1.1, 1, r * 1.1).setPosition(p.x, 0.012, p.z);
      if (n < this.cap) im.setMatrixAt(n++, M);
    }
    im.count = n; im.instanceMatrix.needsUpdate = true;
    this._occlusion(dt);
  }

  _pose(p, c) {
    const b = p.bones, d = p.d;
    b[B.hips].position.set(0, c.hipY, c.hipZ); b[B.hips].rotation.set(c.hipRx, c.hipRy, c.hipRz);
    b[B.spine].rotation.set(c.spRx, c.spRy, c.spRz);
    const br = 1 + 0.018 * c.breath; b[B.spine].scale.set(br, 1, br);
    b[B.head].rotation.set(c.hdRx, c.hdRy, c.hdRz);
    b[B.armL].rotation.set(c.aLx, c.aLy, c.aLz + 0.012 * c.breath); b[B.foreL].rotation.x = c.eL;
    b[B.armR].rotation.set(c.aRx, c.aRy, c.aRz - 0.012 * c.breath); b[B.foreR].rotation.x = c.eR;
    b[B.thighL].rotation.set(c.tLx, 0, c.tLz); b[B.shinL].rotation.x = c.kL;
    b[B.thighR].rotation.set(c.tRx, 0, c.tRz); b[B.shinR].rotation.x = c.kR;
    // лицо
    const sad = c.sad, R = d.R;
    b[B.browL].rotation.z = -0.35 * sad; b[B.browR].rotation.z = 0.35 * sad;
    b[B.browL].position.y = b[B.browR].position.y = b[B.browL].userData.y0 + c.brow * 0.06 * R;
    const open = clamp(c.mouth, 0, 1);
    b[B.mouth].scale.set(1 - 0.2 * open + 0.15 * Math.max(0, c.smile), 1 + open * 3.2, 1);
    const cy = p.bones[B.cornL].userData.y0 + clamp(c.smile, -1, 1) * 0.1 * R + open * 0.03 * R;
    b[B.cornL].position.y = b[B.cornR].position.y = cy;
    b[B.cornL].rotation.z = 0.5 * c.smile; b[B.cornR].rotation.z = -0.5 * c.smile;
    b[B.eyes].scale.y = p.blink > 0 ? 0.12 : 1 - 0.6 * clamp(c.squint, 0, 1);
  }
}

return { People, POSES, SEAT, dims };
});
