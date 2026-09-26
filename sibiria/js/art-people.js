'use strict';
// ArtPeople — процедурные люди «Сибири»: суставной 2D-риг (таз, корпус, голова/капюшон,
// руки и ноги на двухзвенной IK), вторичная анимация и рабочие действия.
// Классический скрипт: создаёт глобальный объект ArtPeople. Без градиентов в кадре
// (тень — кэшированный спрайт), ~30–60 операций пути на фигуру.
//
// ArtPeople.draw(g, o, env):
//   o = { x, y, face, vy, speed, t, phase, anim, animT, look, tool, carry, frost, wet, blink, sel, hp,
//         target?:{x,y} (куда тянуть леску), seed? }
//   env = { now, night, light(x,y,r,type,a), spark(x,y,a) }
var ArtPeople = (function () {
  const PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = t => (t = clamp(t, 0, 1), t * t * (3 - 2 * t));
  const seg = (a, a0, a1) => clamp((a - a0) / (a1 - a0), 0, 1);

  // ---------- цвета (всё hex, смешивание кэшируется) ----------
  const RGB = new Map(), MIX = new Map();
  function rgb(c) {
    let v = RGB.get(c);
    if (!v) { let h = c.slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16); v = [n >> 16 & 255, n >> 8 & 255, n & 255]; RGB.set(c, v); }
    return v;
  }
  function mix(a, b, t) {
    t = Math.round(t * 20) / 20; if (t <= 0) return a; if (t >= 1) return b;
    const key = a + b + t; let r = MIX.get(key);
    if (!r) {
      const A = rgb(a), B = rgb(b);
      r = '#' + ((1 << 24) | (Math.round(lerp(A[0], B[0], t)) << 16) | (Math.round(lerp(A[1], B[1], t)) << 8) | Math.round(lerp(A[2], B[2], t))).toString(16).slice(1);
      MIX.set(key, r);
    }
    return r;
  }
  let TC = '#000000', TA = 0;           // текущий оттенок (вспышка урона, смерть, мокрый)
  const C = c => (TA > 0 ? mix(c, TC, TA) : c);

  // ---------- внешность ----------
  const LOOKS = {
    anorak: { body: '#b8392d', dark: '#7c241c', hood: '#8b2920', trim: '#e3d5b6', face: '#f1c9a5', pants: '#2f3542', boots: '#4d525c', mitt: '#2f3542', pack: '#76593a', band: '#e3d5b6' },
    dokha: { body: '#645240', dark: '#473930', hood: '#534c48', trim: '#e3d5b6', face: '#f1c9a5', pants: '#352b25', boots: '#5d626b', mitt: '#473930', long: 1, shag: 1 },
    kukhl: { body: '#8a6a45', dark: '#5b3d27', hood: '#76593a', trim: '#e2d9c4', face: '#f1c9a5', pants: '#4e3723', boots: '#67482f', bootTrim: '#e2d9c4', mitt: '#5b3d27', beads: 1, long: 1 },
    urk: { body: '#8a6a45', dark: '#5b3d27', hood: '#76593a', trim: '#e3d5b6', face: '#c89468', pants: '#4e3723', boots: '#67482f', bootTrim: '#e3d5b6', mitt: '#5b3d27', beads: 1, beard: '#e0ded2', staff: 1, old: 1, long: 1 },
    vera: { body: '#3f6f7a', dark: '#335462', hood: '#39626e', hoodDown: 1, trim: '#e3d5b6', face: '#f1c9a5', hat: '#b8392d', hatType: 'knit', hair: '#723c29', pants: '#2f3542', boots: '#5d626b', mitt: '#b8392d', band: '#e3d5b6' },
    bich: { body: '#4e535d', dark: '#2f3542', hood: null, trim: '#8f7e67', face: '#f1c9a5', hat: '#645240', hatType: 'ushanka', pants: '#2f3542', boots: '#313031', mitt: '#645240', quilt: 1, stubble: 1, belt: '#3a2618' },
    evenk: { body: '#8a6a45', dark: '#5b3d27', hood: '#76593a', trim: '#e3d5b6', face: '#c89468', pants: '#4e3723', boots: '#67482f', bootTrim: '#e3d5b6', mitt: '#5b3d27', beads: 1, weapon: 'bow' },
    strelok: { body: '#2f5a3a', dark: '#1c4034', hood: null, trim: '#c0b2a1', face: '#f1c9a5', hat: '#1c4034', hatType: 'ushanka', pants: '#10271f', boots: '#313031', mitt: '#1c4034', belt: '#3a2618', weapon: 'rifle' },
    // ---------- люди зон (A6): те же тона палитры-24, отличие — силуэт головы и одна деталь ----------
    // метеоролог Тамара: пуховый платок, стёганый ватник, валенки, очки
    tamara: { body: '#3f6f7a', dark: '#2f5561', hood: null, trim: '#e3d5b6', face: '#f1c9a5', hat: '#6c7178', hatType: 'shawl', shawlDot: '#dde6ee', pants: '#2f3542', boots: '#645240', mitt: '#e3d5b6', quilt: 1, long: 1, glasses: 1 },
    // вахтовик Михалыч: оранжевая каска на подшлемнике, брезентовая роба, щетина
    mikhalych: { body: '#ca5834', dark: '#8b3a22', hood: null, trim: '#e3d5b6', face: '#e7bc96', hat: '#ffb347', hatType: 'helmet', pants: '#2f3542', boots: '#313031', mitt: '#645240', quilt: 1, stubble: 1, belt: '#3a2618' },
    // вахтовик-напарник: та же роба, синяя каска
    vakhta: { body: '#4b5d6f', dark: '#2f3542', hood: null, trim: '#c0b2a1', face: '#f1c9a5', hat: '#3f6f7a', hatType: 'helmet', pants: '#2f3542', boots: '#313031', mitt: '#645240', quilt: 1, belt: '#3a2618' },
    // приёмщик Ефимыч: доха, шапка-ушанка, очки на носу
    efimych: { body: '#645240', dark: '#473930', hood: null, trim: '#e3d5b6', face: '#e7bc96', hat: '#352b25', hatType: 'ushanka', pants: '#352b25', boots: '#5d626b', mitt: '#473930', long: 1, shag: 1, glasses: 1, beard: '#8f7e67' },
    // шаманка Уялан: кухлянка с бисером, красный платок, посох-бубен, старая
    uyalan: { body: '#76593a', dark: '#4e3723', hood: null, trim: '#e3d5b6', face: '#c89468', hat: '#b8392d', hatType: 'shawl', shawlDot: '#ffd27a', pants: '#4e3723', boots: '#67482f', bootTrim: '#e3d5b6', mitt: '#5b3d27', beads: 1, staff: 1, old: 1, long: 1, shag: 1 },
    // старовер Агафон: тёмный кафтан, борода лопатой, шапка, посох
    agafon: { body: '#352b25', dark: '#191614', hood: null, trim: '#8f7e67', face: '#e7bc96', hat: '#473930', hatType: 'ushanka', pants: '#2f3542', boots: '#473930', mitt: '#473930', beard: '#dbd5ce', long: 1, belt: '#b8392d', staff: 1 },
    // бич Толян: ватник в заплатах, вязаная шапка, щетина
    tolyan: { body: '#534c48', dark: '#352b25', hood: null, trim: '#8f7e67', face: '#e7bc96', hat: '#8b2920', hatType: 'knit', band: '#e3d5b6', pants: '#4b5d6f', boots: '#313031', mitt: '#645240', quilt: 1, stubble: 1, patch: '#8a6a45' },
    // промысловик Коченин: малица без капюшона, ушанка, карабин за спиной
    kochenin: { body: '#5d6b52', dark: '#3a4a36', hood: null, trim: '#e3d5b6', face: '#e7bc96', hat: '#8a6a45', hatType: 'ushanka', pants: '#352b25', boots: '#67482f', bootTrim: '#e3d5b6', mitt: '#5b3d27', belt: '#3a2618', weapon: 'rifle', stubble: 1 },
    // почтальон Вася: серо-синий тулуп, ушанка, почтовая сумка
    vasya: { body: '#4b6479', dark: '#27394a', hood: null, trim: '#e3d5b6', face: '#f1c9a5', hat: '#645240', hatType: 'ushanka', pants: '#2f3542', boots: '#313031', mitt: '#27394a', pack: '#8a6a45', long: 1 },
  };
  const NORM = new WeakMap();
  function look(l) {
    if (typeof l === 'string') l = LOOKS[l];
    if (!l || typeof l !== 'object') l = LOOKS.anorak;
    let n = NORM.get(l); if (n) return n;
    n = Object.assign({ body: '#8a6a45', dark: '#5b3d27', hood: '#76593a', trim: '#e3d5b6', face: '#f1c9a5' }, l);
    if (n.beard === 1 || n.beard === true) n.beard = '#dbd5ce';
    if (n.hat && !n.hatType) { n.hatType = 'ushanka'; if (n.hood) n.hoodDown = 1; }
    n.pants = n.pants || mix(n.dark, '#2f3542', 0.5);
    n.boots = n.boots || '#2f3542';
    n.mitt = n.mitt || n.dark;
    n.far = mix(n.body, '#2f3542', 0.3);
    n.pantsFar = mix(n.pants, '#10141c', 0.3);
    n.bootsFar = mix(n.boots, '#10141c', 0.3);
    n.mittFar = mix(n.mitt, '#10141c', 0.25);
    n.skinD = mix(n.face, '#965043', 0.35);
    n.fur = n.hat ? mix(n.hat, '#e3d5b6', 0.45) : n.trim;
    n.hoodD = mix(n.hood || n.body, '#10141c', 0.25);
    NORM.set(l, n); return n;
  }

  // ---------- риг ----------
  const TH = 8.4, SHN = 8.4, UA = 6.8, FA = 6.4, TORSO = 13, SHO = 11.3;
  const P = {};
  function reset() {
    P.hx = 0; P.hy = -17.2; P.lean = 0.04; P.tilt = 0; P.br = 0;
    P.f0x = 1.3; P.f0y = -2; P.f0a = 0; P.f1x = -1.6; P.f1y = -2; P.f1a = 0;
    P.h0x = 0; P.h0y = 0; P.h1x = 0; P.h1y = 0; P.hl0 = 6.6; P.hl1 = 6.6;
    P.tk = null; P.ta = 1.2; P.two = 0; P.gap = -4; P.tox = null; P.toy = 0; P.plen = 18;
    P.rot = 0; P.pvx = 0; P.pvy = -17; P.ox = 0; P.oy = 0;
    P.eyes = 0; P.mouth = 0; P.prop = null; P.hb = 0; P.flash = 0; P.bend = 0; P.sd = 0; P.arrow = 0;
    P.trail = null; P.staff = 0; P.carry = 0; P.smoke = 0; P.spark = 0; P.zz = 0;
  }
  function shoulder() { P.sx = P.hx + Math.sin(P.lean) * SHO; P.sy = P.hy - Math.cos(P.lean) * SHO; }
  function handA(i, ang, d) { const x = P.sx + Math.cos(ang) * d, y = P.sy + Math.sin(ang) * d; if (i) { P.h1x = x; P.h1y = y; } else { P.h0x = x; P.h0y = y; } }
  function handR(i, dx, dy) { if (i) { P.h1x = P.sx + dx; P.h1y = P.sy + dy; } else { P.h0x = P.sx + dx; P.h0y = P.sy + dy; } }

  let KX = 0, KY = 0, EX = 0, EY = 0;
  function ik(ax, ay, bx, by, l1, l2, dir) {
    let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
    const mx = l1 + l2 - 0.02;
    if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; d = mx; }
    if (d < 0.5) d = 0.5;
    const c = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const an = Math.atan2(dy, dx) + dir * Math.acos(c);
    KX = ax + Math.cos(an) * l1; KY = ay + Math.sin(an) * l1; EX = bx; EY = by;
  }

  // проекция: сагиттальная плоскость (fx вперёд, y вверх-отрицательно, lat вбок) → экран
  let X0 = 0, Y0 = 0, FC = 1, K = 1, S = 0, SY = 0, CR = 1, SR = 0, QX = 0, QY = 0, BACK = false, FRONT = false;
  function pr(fx, y, lat) {
    let X = FC * (fx * K + lat * S), Y = y + fx * SY;
    if (P.rot) { const dx = X - P.pvx, dy = Y - P.pvy; X = P.pvx + dx * CR - dy * SR; Y = P.pvy + dx * SR + dy * CR; }
    QX = X0 + X + P.ox; QY = Y0 + Y + P.oy;
  }
  function M(g, fx, y, lat) { pr(fx, y, lat); g.moveTo(QX, QY); }
  function Ln(g, fx, y, lat) { pr(fx, y, lat); g.lineTo(QX, QY); }
  function ell(g, x, y, rx, ry, col, r) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, r || 0, 0, PI * 2); g.fill(); }

  // ---------- позы ----------
  // стопа: опора — линейно назад (+St → −St за полцикла), перенос — плавно вперёд с подъёмом.
  // u = 0 — стопа впереди (как sin(ph) = 1 в старой синусоиде), так что руки и корпус не меняются.
  function foot(ph, St, lift, off) {
    const u = ((ph - PI / 2) / (2 * PI) + off) % 1, v = u < 0 ? u + 1 : u;
    if (v < 0.5) return [St * (1 - 4 * v), 0, 0.1 * Math.sin(ph + off * 2 * PI)];
    const q = (v - 0.5) * 2, e = q * q * (3 - 2 * q), sw = Math.sin(q * PI);
    return [-St + 2 * St * e, sw * lift, -sw * 0.35];
  }
  function gait(ph, St, lift) {
    const a = foot(ph, St, lift, 0), b = foot(ph, St, lift, 0.5);
    P.f0x = a[0] + 0.4; P.f0y = -2 - a[1]; P.f0a = a[2];
    P.f1x = b[0] - 0.4; P.f1y = -2 - b[1]; P.f1a = b[2];
    P.hy = -16.9 - 0.7 * Math.cos(2 * ph);
    P.hb = 0.8 * Math.cos(2 * ph + 0.9);
  }
  function idle(o, t) {
    const br = Math.sin(t * 1.9 + (o.seed || 0));
    P.br = br; P.hy = -17.2 + br * 0.2; P.lean = 0.03 + br * 0.012; shoulder();
    handR(0, 1.4 + br * 0.2, 12.2); handR(1, -1, 12.3);
    P.tilt = 0.07 * Math.sin(t * 0.6 + (o.seed || 0));
    P.hb = br * 0.25;
  }
  // полушаг (длина опоры) по виду походки — его же берёт рендер, чтобы фаза шла от пройденного пути
  function stride(anim, sp) { return anim === 'run' ? 7 : anim === 'limp' ? 3.3 : 4.5 + clamp(sp, 0, 1) * 3.5; }
  function walk(o, t, ph, sp) {
    const St = stride('walk', sp); gait(ph, St, 2.4 + sp * 1.2);
    P.lean = 0.07 + sp * 0.06; shoulder();
    const A = 3 + sp * 2, sn = Math.sin(ph);
    handR(0, 1 - A * sn, 12 - Math.abs(sn) * 0.8); handR(1, 1 + A * sn, 12 - Math.abs(sn) * 0.8);
    P.tilt = 0.03 * Math.sin(2 * ph);
  }
  function run(o, t, ph) {
    const s0 = Math.sin(ph), a = foot(ph, 7, 6, 0), b = foot(ph, 7, 6, 0.5);
    P.f0x = a[0] + 1.5; P.f0y = -2 - a[1]; P.f0a = a[2] * 1.4;
    P.f1x = b[0] + 1.5; P.f1y = -2 - b[1]; P.f1a = b[2] * 1.4;
    P.hy = -16.2 - 1.3 * Math.cos(2 * ph); P.hx = 1.2; P.lean = 0.3; shoulder();
    handR(0, 3 - 5.5 * s0, 7.5 + 1.5 * s0); handR(1, 3 + 5.5 * s0, 7.5 - 1.5 * s0);
    P.hb = 1.4 * Math.cos(2 * ph + 0.9); P.tilt = -0.12;
  }
  function limp(o, t, ph) {
    const s0 = Math.sin(ph), c0 = Math.cos(ph), load = Math.max(0, -c0);   // вес на больной (ближней) ноге
    const a = foot(ph, 3.2, 0.7, 0), b = foot(ph, 3.4, 3.2, 0.5);
    P.f0x = a[0] + 0.6; P.f0y = -2 - a[1]; P.f0a = 0.12;   // волочит
    P.f1x = b[0] - 0.4; P.f1y = -2 - b[1]; P.f1a = b[2];
    P.hy = -17 + load * 1.9 - Math.max(0, c0) * 0.3; P.lean = 0.12 + load * 0.14; shoulder();
    P.h0x = P.hx + 2.6; P.h0y = P.hy + 4.2 + load; P.hl0 = 4.5;               // ладонь на бедре
    handR(1, 1 + 4.2 * s0, 11.5);
    P.tilt = 0.12 + load * 0.08; P.hb = load * 0.9;
  }
  function chop(o, t, a) {
    const REST = 0.95, UP = -2.45, HIT = 0.72;
    let b;
    if (a < 0.42) b = lerp(REST, UP, sm(a / 0.42));
    else if (a < 0.52) { const e = (a - 0.42) / 0.1; b = lerp(UP, HIT, e * e); }
    else if (a < 0.66) { const e = (a - 0.52) / 0.14; b = HIT - 0.24 * Math.sin(e * PI * 2.5) * (1 - e); }
    else b = lerp(HIT, REST, sm((a - 0.66) / 0.34));
    const w = clamp((REST - b) / (REST - UP), 0, 1);
    P.f0x = 4.5; P.f1x = -3.8; P.f1a = -0.1;
    P.lean = lerp(0.36, -0.14, w); P.hy = -16.8 + (1 - w) * 1.3; shoulder();
    handA(0, b, 11.5); P.hl0 = P.hl1 = 1.5;
    P.tk = 'axe'; P.ta = b + 0.1; P.two = 1; P.gap = -3.6;
    P.tilt = lerp(0.25, -0.2, w);
    if (a >= 0.42 && a < 0.53) P.trail = [lerp(UP, b, 0.35), b, 11.5 + 17];
    if (a >= 0.52 && a < 0.58) P.spark = 1;
  }
  function saw(o, t) {
    const sw = Math.sin(t * 9);
    P.hy = -15.6; P.lean = 0.45; P.f0x = 5; P.f1x = -3.5; shoulder();
    P.h0x = P.sx + 8 + 3.2 * sw; P.h0y = P.sy + 9; P.hl0 = P.hl1 = 1.5;
    P.tk = 'saw'; P.ta = 0.22; P.two = 1; P.gap = 2.5; P.tilt = 0.25;
    P.hx = 0.4 * sw;
  }
  function dig(o, t, a) {
    let yh;
    if (a < 0.45) yh = lerp(10.5, 1.5, sm(a / 0.45));
    else if (a < 0.53) { const e = (a - 0.45) / 0.08; yh = lerp(1.5, 14, e * e); }
    else if (a < 0.7) yh = 14 - 1.8 * Math.sin(seg(a, 0.53, 0.7) * PI);
    else yh = lerp(14, 10.5, sm((a - 0.7) / 0.3));
    P.f0x = 3.5; P.f1x = -3.2;
    P.lean = 0.2 + (yh - 1.5) / 12.5 * 0.2; P.hy = -17.2 + Math.max(0, yh - 10) * 0.4; shoulder();
    P.h0x = P.sx + 7.5; P.h0y = P.sy + yh; P.hl0 = P.hl1 = 1;
    P.tk = 'pole'; P.ta = PI / 2 - 0.1; P.two = 1; P.gap = -5.5; P.tilt = 0.3;
    if (a >= 0.52 && a < 0.6) P.spark = 1;
  }
  function fish(o, t, bite) {
    P.prop = 'box'; P.hx = -1.5; P.hy = -9.8; P.f0x = 6.8; P.f0y = -2; P.f1x = 5.2; P.f1y = -2;
    if (!bite) {
      const br = Math.sin(t * 1.7); P.lean = 0.28 + br * 0.015; shoulder();
      const jig = Math.pow(Math.max(0, Math.sin(t * 3.6)), 6) * 0.35;
      P.h0x = P.sx + 7.2; P.h0y = P.sy + 7.5 - jig * 3; P.ta = 0.18 - jig;
      P.h1x = P.hx + 7; P.h1y = P.hy - 1.5; P.tilt = 0.2;
    } else {
      const j = Math.sin(t * 23); P.lean = 0.02 - 0.06 * j; shoulder();
      P.h0x = P.sx + 5; P.h0y = P.sy + 3.5 + j * 0.8; P.ta = -0.8 + 0.16 * j; P.bend = 1;
      P.h1x = P.sx + 9 + 2 * Math.sin(t * 8); P.h1y = P.sy + 7 + 2 * Math.cos(t * 8); P.tilt = -0.1;
      P.hb = j * 0.5; P.mouth = 0.7;
    }
    P.hl0 = 3; P.hl1 = 3; P.tk = 'rod';
  }
  function build(o, t, a) {
    P.prop = 'plank'; P.hx = -1.5; P.hy = -11.2; P.lean = 0.36;
    P.f0x = -8.5; P.f0y = -1.8; P.f0a = 0.9; P.f1x = 4.2; P.f1y = -2;
    let b;
    if (a < 0.55) b = lerp(0.9, -1.25, sm(a / 0.55));
    else if (a < 0.66) { const e = (a - 0.55) / 0.11; b = lerp(-1.25, 1.02, e * e); }
    else if (a < 0.8) b = 1.02 - 0.28 * Math.sin(seg(a, 0.66, 0.8) * PI);
    else b = lerp(1.02, 0.9, sm((a - 0.8) / 0.2));
    shoulder(); handA(0, b, 9.5); P.tk = 'hammer'; P.ta = b - 0.95;
    P.h1x = P.sx + 10; P.h1y = -4.2; P.hl0 = 3; P.hl1 = 2; P.tilt = 0.35;
    if (a >= 0.65 && a < 0.72) P.spark = 1;
  }
  function swing(o, t, a, tool) {
    let b;
    if (a < 0.25) b = lerp(1, -2.3, sm(a / 0.25));
    else if (a < 0.42) { const e = (a - 0.25) / 0.17; b = lerp(-2.3, 1.15, e * e); }
    else b = lerp(1.15, 1, sm((a - 0.42) / 0.58));
    const st = seg(a, 0.25, 0.42), rec = 1 - seg(a, 0.6, 1);
    P.f0x = lerp(1.3, 6, st * rec + (1 - rec) * 0); P.f1x = -3;
    P.lean = lerp(-0.15, 0.4, st) * (a < 0.25 ? sm(a / 0.25) : 1) * (0.3 + 0.7 * rec) + 0.04; shoulder();
    handA(0, b, 12); handR(1, -4.5 + 2 * st, 9); P.hl0 = 5;
    P.tk = tool === 'torch' ? 'torch' : tool === 'saw' ? 'saw' : 'axe'; P.ta = b + 0.15;
    if (a >= 0.25 && a < 0.45) P.trail = [-2.3, b, 12 + (P.tk === 'axe' ? 17 : 12)];
    P.tilt = -0.1 + 0.3 * st;
  }
  function shoot(o, t, a, w, aimOnly) {
    P.f0x = 3.5; P.f1x = -3.8; P.hy = -17; P.lean = 0.02; shoulder();
    const sway = Math.sin(t * 1.3) * 0.4;
    if (w === 'bow') {
      P.h1x = P.sx + 12.5; P.h1y = P.sy - 0.5 + sway; P.hl1 = 2; P.hl0 = 2;
      P.tk = 'bow'; P.ta = -0.02; P.tox = -1; // лук в дальней руке
      let dx = -0.5, dy = -1, sd = 1, arrow = 1;
      if (!aimOnly) {
        if (a < 0.08) { const e = a / 0.08; dx = lerp(-0.5, -4, e); dy = -1.5; sd = lerp(1, 0, e); arrow = 0; P.flash = 0; }
        else if (a < 0.55) { dx = -4; dy = -1.5; sd = 0.12 * Math.sin(a * 90) * (1 - seg(a, 0.08, 0.4)); arrow = 0; }
        else if (a < 0.75) { const e = sm(seg(a, 0.55, 0.75)); dx = lerp(-4, -3, e); dy = lerp(-1.5, 6, e); sd = 0; arrow = 0; }
        else { const e = sm(seg(a, 0.75, 1)); dx = lerp(-3, -0.5, e); dy = lerp(6, -1, e); sd = e; arrow = 1; }
      }
      P.h0x = P.sx + dx; P.h0y = P.sy + dy; P.sd = sd; P.arrow = arrow; P.tilt = 0.12;
    } else {
      let r = 0;
      if (!aimOnly) r = a < 0.1 ? a / 0.1 : 1 - sm((a - 0.1) / 0.45);
      P.lean -= 0.14 * r; shoulder();
      P.tk = 'rifle'; P.ta = -0.04 + sway * 0.02 - 0.42 * r;
      P.tox = P.sx + 0.5 - 1.8 * r; P.toy = P.sy + 0.6;
      const c = Math.cos(P.ta), s = Math.sin(P.ta);
      P.h0x = P.tox + c * 5.5; P.h0y = P.toy + s * 5.5 + 0.8; P.h1x = P.tox + c * 12; P.h1y = P.toy + s * 12 + 0.8;
      P.hl0 = P.hl1 = 1; P.tilt = 0.22 - 0.2 * r;
      if (!aimOnly) { P.flash = a < 0.09 ? 1 - a / 0.09 : 0; P.smoke = a < 0.9 ? a / 0.9 : 0; }
    }
  }
  function sit(o, t) {
    const br = Math.sin(t * 1.7 + (o.seed || 0));
    P.prop = 'log'; P.hx = -1.5; P.hy = -9.2; P.br = br;
    P.f0x = 7.2; P.f0y = -2; P.f1x = 5.4; P.f1y = -2;
    P.lean = 0.16 + br * 0.015; shoulder();
    P.h0x = P.sx + 9.2 + 0.6 * Math.sin(t * 1.3); P.h0y = P.sy + 3.8; P.h1x = P.sx + 8.2; P.h1y = P.sy + 5.2;
    P.hl0 = 3; P.hl1 = 3; P.tilt = -0.06 + 0.04 * Math.sin(t * 0.5);
  }
  function hurt(o, t, a) {
    const kb = Math.sin(Math.min(1, a / 0.3) * PI / 2) * (1 - sm((a - 0.3) / 0.7));
    P.lean = 0.04 - 0.55 * kb; P.hx = -2.4 * kb; P.hy = -17.2 + 0.9 * kb;
    P.f0x = 1.3 - 3 * kb; P.f1x = -1.6 - 1.5 * kb; P.f0y = -2 - 1.5 * kb; shoulder();
    handR(0, 4 + 2 * kb, 12 - 9 * kb); handR(1, -1 - 4 * kb, 12 - 6 * kb);
    P.tilt = -0.4 * kb; P.eyes = kb > 0.3 ? 1 : 0; P.mouth = kb * 0.8;
    P.ox = Math.sin(t * 90) * 1.3 * (1 - seg(a, 0, 0.4));
    P.hb = -kb * 1.5;
  }
  function dead(o, t, a) {
    const e = sm(a / 0.55), bn = a > 0.55 && a < 0.78 ? Math.sin(seg(a, 0.55, 0.78) * PI) * 0.1 : 0;
    P.lean = -0.06 * e; P.f0x = lerp(2.2, 0.6, e); P.f1x = lerp(-1.4, -0.4, e); P.f0y = P.f1y = -2 + 0.5 * e; P.f0a = P.f1a = -0.5 * e; shoulder();
    handR(0, lerp(1.4, -3, e), lerp(12, -6, e)); handR(1, lerp(-1, 5, e), lerp(12, 3, e));
    P.tilt = -0.3 * e; P.eyes = e > 0.85 ? 2 : 1;
    P.rot = -FC * (PI / 2 * e - bn); P.pvx = 0; P.pvy = -17;
    P.oy = 12.5 * e; P.ox = -FC * 2 * e;
  }
  function talk(o, t, staffy) {
    idle(o, t);
    const gt = t * 2.3, i = staffy ? 1 : 0;
    handR(i, 6 + 2.5 * Math.sin(gt), 6 + 3 * Math.cos(gt * 1.3)); if (i) P.hl1 = 5; else P.hl0 = 5;
    if (!staffy) handR(1, 3 + 1.5 * Math.sin(gt * 0.7 + 1), 9.5 + 2 * Math.sin(gt * 1.1));
    P.tilt = 0.08 * Math.sin(t * 5); P.mouth = Math.sin(t * 14) > 0 ? 0.9 : 0.25;
    P.lean = 0.06 + 0.03 * Math.sin(t * 1.1); shoulder();
  }
  function wave(o, t) {
    idle(o, t);
    P.lean = 0.02 + 0.015 * Math.sin(t * 9); shoulder();
    handR(0, 4.5 + 3.4 * Math.sin(t * 9), -10.5); P.hl0 = 7.5; P.tilt = -0.05; P.mouth = 0.4;
  }

  const LOCO = { idle: 1, walk: 1, run: 1, limp: 1, carry: 1, talk: 1, wave: 1, hurt: 1 };

  // ---------- кэш тени ----------
  let SHIMG = null;
  function shadow(g, x, y, w, h) {
    if (SHIMG === null) {
      SHIMG = false;
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas'); c.width = 64; c.height = 32;
        const x2 = c.getContext('2d'); x2.setTransform(1, 0, 0, 0.5, 0, 0);
        const gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(39,57,74,0.42)'); gr.addColorStop(0.6, 'rgba(39,57,74,0.26)'); gr.addColorStop(1, 'rgba(39,57,74,0)');
        x2.fillStyle = gr; x2.fillRect(0, 0, 64, 64); SHIMG = c;
      }
    }
    if (SHIMG) g.drawImage(SHIMG, x - w / 2, y - h / 2, w, h);
    else ell(g, x, y, w / 2.4, h / 2.4, 'rgba(39,57,74,0.25)');
  }

  // ---------- инструменты ----------
  // точка инструмента: локальные (u вдоль, v поперёк) → экран (QX,QY)
  let TX = 0, TY = 0, TC_ = 1, TS = 0, TL = 0;
  function tp(u, v) { pr(TX + u * TC_ - v * TS, TY + u * TS + v * TC_, TL); }
  function tM(g, u, v) { tp(u, v); g.moveTo(QX, QY); }
  function tL(g, u, v) { tp(u, v); g.lineTo(QX, QY); }
  function drawTool(g, kind, ox, oy, ang, lat, o, env) {
    TX = ox; TY = oy; TC_ = Math.cos(ang); TS = Math.sin(ang); TL = lat;
    const W = '#67482f';
    if (kind === 'axe') {
      g.strokeStyle = C(W); g.lineWidth = 2.2; g.beginPath(); tM(g, -5, 0); tL(g, 16, 0); g.stroke();
      g.fillStyle = C('#919dac'); g.beginPath(); tM(g, 11.5, -2.2); tL(g, 16, -2.2); tL(g, 18.6, 6); tL(g, 10.5, 5.6); tL(g, 12.6, 1.5); g.closePath(); g.fill();
      g.strokeStyle = '#dde6ee'; g.lineWidth = 1; g.beginPath(); tM(g, 18.4, 5.6); tL(g, 10.8, 5.2); g.stroke();
    } else if (kind === 'hammer') {
      g.strokeStyle = C(W); g.lineWidth = 2; g.beginPath(); tM(g, -1, 0); tL(g, 10, 0); g.stroke();
      g.strokeStyle = C('#5d626b'); g.lineWidth = 3.4; g.beginPath(); tM(g, 10, -2.6); tL(g, 10, 3.6); g.stroke();
    } else if (kind === 'pole') {
      const Lp = P.plen;
      g.strokeStyle = C(W); g.lineWidth = 2.1; g.beginPath(); tM(g, -9, 0); tL(g, Lp - 5, 0); g.stroke();
      g.strokeStyle = C('#8f9399'); g.lineWidth = 2.5; g.beginPath(); tM(g, Lp - 5.5, 0); tL(g, Lp, 0); g.stroke();
    } else if (kind === 'saw') {
      g.strokeStyle = C(W); g.lineWidth = 1.7; g.beginPath(); tM(g, 0, 0); tL(g, 0, -6.5); tL(g, 17, -6.5); tL(g, 17, 0); g.stroke();
      g.strokeStyle = C('#c2c9d0'); g.lineWidth = 1.3; g.beginPath(); tM(g, -1.5, 0); tL(g, 18, 0); g.stroke();
    } else if (kind === 'torch') {
      g.strokeStyle = C(W); g.lineWidth = 2.6; g.beginPath(); tM(g, -3, 0); tL(g, 11, 0); g.stroke();
      tp(12, 0); const fx = QX, fy = QY, fl = 1 + Math.sin(o.t * 17 + (o.seed || 0)) * 0.13;
      ell(g, fx, fy, 2.3, 2, '#3a2618');
      ell(g, fx, fy - 4, 3.8 * fl, 6.4 * fl, '#ff7c25');
      ell(g, fx + Math.sin(o.t * 11) * 0.5, fy - 3, 2.1, 3.8 * fl, '#ffd27a');
      env.light(fx, fy - 4, 240, 'w', 0.9);
    } else if (kind === 'rod') {
      g.strokeStyle = C('#c79a62'); g.lineWidth = 3; g.beginPath(); tM(g, -2, 0); tL(g, 3, 0); g.stroke();
      const bend = P.bend ? 3.5 : 0.6;
      g.strokeStyle = C('#3a2618'); g.lineWidth = 1.3; g.beginPath(); tM(g, 3, 0); tp(9, bend * 0.4); g.quadraticCurveTo(QX, QY, (tp(14, bend), QX), QY); g.stroke();
      tp(14, bend); const rx = QX, ry = QY;
      let lx, ly;
      if (o.target) { lx = o.target.x; ly = o.target.y; }
      else { pr(15.5, 0.5, 0); lx = QX; ly = QY; }
      const jit = P.bend ? Math.sin(o.t * 40) * 1.2 : Math.sin(o.t * 6) * 0.8;
      g.strokeStyle = P.bend ? 'rgba(16,39,31,0.85)' : 'rgba(49,48,49,0.55)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(rx, ry);
      if (P.bend) g.lineTo(lx + jit, ly - 1); else g.quadraticCurveTo((rx + lx) / 2 + 1, Math.max(ry, ly) - 1, lx, ly - 1 + jit);
      g.stroke();
      if (P.bend) env.spark(lx + jit, ly - 1, 0.6 + 0.4 * Math.sin(o.t * 30));
    } else if (kind === 'bow') {
      const d = P.sd * 10.5;
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 1.9; g.beginPath(); tM(g, -2, -10); tp(5, 0); const cx1 = QX, cy1 = QY; tp(-2, 10); g.quadraticCurveTo(cx1, cy1, QX, QY); g.stroke();
      g.strokeStyle = 'rgba(237,231,217,0.95)'; g.lineWidth = 0.7; g.beginPath(); tM(g, -2, -10); tL(g, -2 - d, 0); tL(g, -2, 10); g.stroke();
      if (P.arrow) {
        g.strokeStyle = C('#765436'); g.lineWidth = 1.1; g.beginPath(); tM(g, -2 - d, 0); tL(g, 6, 0); g.stroke();
        g.fillStyle = C('#8f9399'); g.beginPath(); tM(g, 8.5, 0); tL(g, 5.8, -1.4); tL(g, 5.8, 1.4); g.closePath(); g.fill();
      }
    } else if (kind === 'rifle') {
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 3.4; g.beginPath(); tM(g, 0, 0.4); tL(g, 8, 0); g.stroke();
      g.strokeStyle = C('#313031'); g.lineWidth = 1.7; g.beginPath(); tM(g, 6, -0.7); tL(g, 23, -0.7); g.stroke();
      if (P.flash > 0) {
        tp(24.5, -0.7); const mx = QX, my = QY, f = P.flash;
        g.fillStyle = 'rgba(255,210,122,' + (0.95 * f).toFixed(2) + ')';
        g.beginPath(); tM(g, 23, -3.2 * f); tL(g, 30 + 4 * f, -0.7); tL(g, 23, 1.8 * f); tL(g, 26, -0.7); g.closePath(); g.fill();
        env.light(mx, my, 200, 'w', f); env.spark(mx, my, f);
      }
      if (P.smoke > 0) {
        tp(25 + P.smoke * 6, -1 - P.smoke * 3);
        g.fillStyle = 'rgba(221,230,238,' + (0.5 * (1 - P.smoke)).toFixed(2) + ')';
        g.beginPath(); g.arc(QX, QY - P.smoke * 5, 2 + P.smoke * 5, 0, PI * 2); g.fill();
      }
    }
  }
  // оружие за спиной
  function drawSlung(g, kind) {
    const nx = P.hx + Math.sin(P.lean) * TORSO, ny = P.hy - Math.cos(P.lean) * TORSO;
    if (kind === 'rifle') {
      g.strokeStyle = C('#313031'); g.lineWidth = 1.7; g.beginPath(); M(g, nx - 4, ny - 6, 0); Ln(g, P.hx - 3, P.hy + 1, 0); g.stroke();
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 3.2; g.beginPath(); M(g, P.hx - 2.6, P.hy - 3, 0); Ln(g, P.hx - 1.6, P.hy + 4, 0); g.stroke();
    } else if (kind === 'bow') {
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 1.8; g.beginPath(); M(g, nx - 3, ny - 7, 0);
      pr(P.hx - 9, (ny + P.hy) / 2, 0); const cx1 = QX, cy1 = QY; pr(P.hx - 1, P.hy + 3, 0); g.quadraticCurveTo(cx1, cy1, QX, QY); g.stroke();
      g.strokeStyle = C('#765436'); g.lineWidth = 3; g.beginPath(); M(g, nx - 5, ny - 3, 0); Ln(g, nx - 1.5, ny + 6, 0); g.stroke();
    }
  }

  // ---------- голова ----------
  function drawHead(g, o, L, vyv, env) {
    const s = S, back = BACK, ang = P.lean + P.tilt, fwx = Math.cos(ang), fwy = Math.sin(ang), upx = Math.sin(ang), upy = -Math.cos(ang);
    const nx = P.hx + Math.sin(P.lean) * TORSO, ny = P.hy - Math.cos(P.lean) * TORSO;
    const hx = nx + upx * 5.6, hy = ny + upy * 5.6;
    const hr = P.rot + FC * K * ang * 0.7;
    const P2 = (a, b) => { pr(hx + fwx * a + upx * b, hy + fwy * a + upy * b, 0); };
    const frost = o.frost || 0;
    // капюшон
    if (L.hood && !L.hoodDown) {
      P2(-0.9, 0.4); ell(g, QX, QY + P.hb * 0.6, 6.6, 6.9, C(L.hood), hr);
      if (!back) {
        P2(2.5, -0.2); const fx = QX, fy = QY, rx = lerp(3.3, 4.8, s);
        g.strokeStyle = C(L.trim); g.lineWidth = 2.7; g.beginPath(); g.ellipse(fx, fy, rx, 5.1, hr, 0, PI * 2); g.stroke();
        ell(g, fx, fy, rx - 1.1, 3.9, C(L.face), hr);
        if (frost > 0.05) {
          g.fillStyle = '#f6f9fc'; const n = Math.round(frost * 10);
          for (let i = 0; i < n; i++) { const a2 = i * 2.4 + 0.5; g.fillRect(fx + Math.cos(a2) * (rx + 0.4) - 0.8, fy + Math.sin(a2) * 5.4 - 0.8, 1.7, 1.7); }
        }
        face(g, L, fx, fy, hr, s, frost, P2, 0);
      } else {
        g.strokeStyle = C(L.hoodD); g.lineWidth = 1; g.beginPath(); P2(-1, 6.2); g.moveTo(QX, QY + P.hb * 0.6); P2(-1, -4); g.lineTo(QX, QY); g.stroke();
        g.strokeStyle = C(L.trim); g.lineWidth = 2; g.beginPath(); P2(-0.5, -5.2); g.moveTo(QX - 4, QY); g.quadraticCurveTo(QX, QY + 1.8, QX + 4, QY); g.stroke();
      }
      return;
    }
    // без капюшона: голова, волосы, шапка
    if (L.hoodDown) { const bx = nx - fwx * 2.6, by = ny - fwy * 2.6; pr(bx, by, 0); ell(g, QX, QY + 0.5, 4.8, 3.6, C(L.hood), hr); }
    if (L.hair) { P2(-2.2, -1.6); ell(g, QX, QY, 3.6, 4.8, C(L.hair), hr); }
    P2(0, 0); const hx0 = QX, hy0 = QY;
    ell(g, hx0, hy0, 4.9, 5.1, C(back ? (L.hair || L.hat || L.skinD) : L.face), hr);
    if (L.hatType === 'ushanka') {
      const fur = C(L.fur);
      if (s > 0.45) { P2(0, 1); ell(g, QX - 4.6, QY + 0.5, 1.9, 3.4, fur, hr); ell(g, QX + 4.6, QY + 0.5, 1.9, 3.4, fur, hr); }
      else { P2(-3, 1.2); ell(g, QX, QY, 2.1, 3.6, fur, hr); }
      P2(-0.3, 2.3); ell(g, QX, QY, 5.6, 3.8, C(L.hat), hr);
      if (!back) { P2(1.3, 1.3); ell(g, QX, QY, lerp(4.2, 5.4, s), 1.9, fur, hr); }
      if (frost > 0.05) { g.fillStyle = '#f6f9fc'; P2(0, 3.2); const n = Math.round(frost * 6); for (let i = 0; i < n; i++) g.fillRect(QX - 4 + i * 1.5, QY - 0.6 + (i % 2), 1.4, 1.4); }
    } else if (L.hatType === 'shawl') {
      // платок: купол на темени, затылок укрыт, узел под подбородком, горошек
      P2(-2.3, -0.6); ell(g, QX, QY, 3.9, 5.6, C(L.hat), hr);
      P2(-0.5, 1.9); ell(g, QX, QY, 5.8, 4.3, C(L.hat), hr);
      if (!back) { P2(0.6, -4.9); ell(g, QX, QY, 1.5, 1.1, C(L.hat), hr); }
      if (L.shawlDot) { g.fillStyle = C(L.shawlDot); for (const [a, b] of [[-2.6, 2.2], [-0.6, 3.6], [1.4, 2.6], [-3, -0.8]]) { P2(a, b); g.fillRect(QX - 0.5, QY - 0.5, 1.1, 1.1); } }
    } else if (L.hatType === 'helmet') {
      // каска: купол и козырёк; сзади — край подшлемника
      if (back) { P2(-1.4, -0.4); ell(g, QX, QY, 3.4, 4.2, C('#2f3542'), hr); }
      P2(-0.2, 2.6); ell(g, QX, QY, 5.6, 4.1, C(L.hat), hr);
      P2(0.2, 3.6); ell(g, QX - 1, QY, 2.4, 1.2, C(mix(L.hat, '#ffffff', 0.35)), hr);
      if (!back) { P2(1.6, 0.9); ell(g, QX, QY, lerp(4.6, 6, s), 1.2, C(mix(L.hat, '#10141c', 0.2)), hr); }
    } else if (L.hatType === 'knit') {
      const pl = P.hb * 0.9;
      P2(-0.4, 6.6); ell(g, QX - FC * pl * 0.4, QY + pl, 1.9, 1.9, C(L.band || '#f6f9fc'), hr);
      P2(-0.2, 2.3); ell(g, QX, QY, 5.3, 4.2, C(L.hat), hr);
      P2(0.2, 0.9); ell(g, QX, QY, 5.5, 1.5, C(mix(L.hat, '#f6f9fc', 0.18)), hr);
    }
    if (!back) face(g, L, hx0 + FC * K * 1.4, hy0 + 0.8, hr, s, frost, P2, 1);
  }
  function face(g, L, fx, fy, hr, s, frost, P2, bare) {
    const ex = FC * K * (bare ? 1.4 : 1.5), ey = -0.6;
    // глаза
    g.fillStyle = '#3a2618';
    const eyeAt = (x, y) => {
      if (P.eyes === 0) g.fillRect(x - 0.55, y - 0.7, 1.15, 1.4);
      else { g.fillRect(x - 0.9, y - 0.2, 1.8, 0.6); if (P.eyes === 2) g.fillRect(x - 0.2, y - 0.9, 0.5, 1.9); }
    };
    if (s > 0.45) { eyeAt(fx - 1.7 + ex * 0.3, fy + ey); eyeAt(fx + 1.7 + ex * 0.3, fy + ey); }
    else eyeAt(fx + ex, fy + ey);
    // румянец/нос
    g.fillStyle = frost > 0.3 ? 'rgba(184,57,45,0.45)' : 'rgba(195,96,79,0.3)';
    g.fillRect(fx + ex * 0.2 - 1, fy + 1.1, 2, 1.2);
    if (s < 0.5 && !L.beard) ell(g, fx + FC * K * 3.1, fy + 0.5, 0.9, 0.8, C(L.skinD));
    if (L.glasses) { g.strokeStyle = '#27394a'; g.lineWidth = 0.6; if (s > 0.45) { g.strokeRect(fx - 2.9 + ex * 0.3, fy + ey - 1, 2.4, 1.9); g.strokeRect(fx + 0.5 + ex * 0.3, fy + ey - 1, 2.4, 1.9); } else g.strokeRect(fx + ex - 1.3, fy + ey - 1, 2.6, 1.9); }
    if (L.beard) { ell(g, fx + ex * 0.3, fy + 3, 3.2, 2.8, C(L.beard), hr); }
    else if (L.stubble) { g.fillStyle = 'rgba(71,57,48,0.28)'; g.fillRect(fx - 2 + ex * 0.4, fy + 2, 4, 1.8); }
    if (P.mouth > 0.1) ell(g, fx + ex * 0.6, fy + 2.2 + (L.beard ? 0.6 : 0), 0.9, 0.35 + P.mouth * 0.7, '#4b2619');
    if (frost > 0.4) { g.fillStyle = '#f6f9fc'; g.fillRect(fx + ex - 1.2, fy - 1.9, 2.4, 0.8); }
  }

  // ---------- корпус ----------
  function drawTorso(g, L, vyv, beads) {
    const s = S;
    pr(P.hx, P.hy, 0); const Hx = QX, Hy = QY;
    const nx = P.hx + Math.sin(P.lean) * TORSO, ny = P.hy - Math.cos(P.lean) * TORSO;
    pr(nx, ny, 0); const Nx = QX, Ny = QY;
    let ux = Nx - Hx, uy = Ny - Hy; const ln = Math.hypot(ux, uy) || 1; ux /= ln; uy /= ln;
    const fnx = -uy * FC, fny = ux * FC; // «вперёд» на экране
    const F = lerp(5.3, 6.9, s) + P.br * 0.2, B = lerp(4.5, 6.9, s);
    const D = L.long ? 6.6 : 3.2, hF = F + (L.long ? 1.9 : 0.8), hB = B + (L.long ? 1.6 : 0.6);
    const pt = (base, ou, of) => [base[0] + ux * ou + fnx * of, base[1] + uy * ou + fny * of];
    const Hb = [Hx, Hy], Nb = [Nx, Ny];
    const A = pt(Hb, -D, hF), Bp = pt(Nb, -2.4, F - 0.6), Ct = pt(Nb, 1.6, 0), Dp = pt(Nb, -2.4, -(B - 0.3)), E = pt(Hb, -D, -hB);
    const midF = pt(Hb, ln * 0.5, F + 0.9), midB = pt(Hb, ln * 0.5, -(B + 0.4));
    const cF = pt(Nb, 1.4, F - 0.8), cB = pt(Nb, 1.4, -(B - 0.6)), hem = pt(Hb, -D - 1.3, (hF - hB) / 2);
    g.fillStyle = C(L.body); g.beginPath(); g.moveTo(A[0], A[1]);
    g.quadraticCurveTo(midF[0], midF[1], Bp[0], Bp[1]); g.quadraticCurveTo(cF[0], cF[1], Ct[0], Ct[1]);
    g.quadraticCurveTo(cB[0], cB[1], Dp[0], Dp[1]); g.quadraticCurveTo(midB[0], midB[1], E[0], E[1]);
    g.quadraticCurveTo(hem[0], hem[1], A[0], A[1]); g.fill();
    // тень на дальней стороне
    const sh1 = pt(Hb, -D + 0.4, -hB + 3.2), sh2 = pt(Nb, -1, -(B - 0.3) + 2.2);
    g.globalAlpha = 0.45; g.fillStyle = C(L.dark); g.beginPath(); g.moveTo(Ct[0], Ct[1]);
    g.quadraticCurveTo(cB[0], cB[1], Dp[0], Dp[1]); g.quadraticCurveTo(midB[0], midB[1], E[0], E[1]);
    g.lineTo(sh1[0], sh1[1]); g.lineTo(sh2[0], sh2[1]); g.closePath(); g.fill(); g.globalAlpha = 1;
    // подол
    const hemIn = pt(Hb, -D - 0.2, (hF - hB) / 2);
    if (L.shag) {
      g.strokeStyle = C(L.trim); g.lineWidth = 1.4; g.beginPath();
      for (let i = 0; i <= 6; i++) { const t = i / 6, bx = lerp(E[0], A[0], t), by = lerp(E[1], A[1], t) + 0.8; g.moveTo(bx, by - 2.2); g.lineTo(bx - ux * 2.4 + (i % 2 ? 0.6 : -0.6), by - uy * 2.4); }
      g.stroke();
    } else if (!L.quilt) {
      g.strokeStyle = C(L.hood ? L.trim : L.dark); g.lineWidth = L.hood ? 2.3 : 1.6; g.beginPath(); g.moveTo(E[0], E[1]); g.quadraticCurveTo(hemIn[0], hemIn[1] + 1, A[0], A[1]); g.stroke();
    }
    if (L.quilt) {
      g.strokeStyle = C(L.dark); g.lineWidth = 0.9; g.beginPath();
      for (const q of [0.25, 0.55, 0.85]) { const l1 = pt(Hb, ln * q - D * (1 - q), -B + 0.6), l2 = pt(Hb, ln * q - D * (1 - q), F - 0.4); g.moveTo(l1[0], l1[1]); g.lineTo(l2[0], l2[1]); }
      g.stroke();
    }
    if (L.patch && !BACK) { const pc = pt(Hb, ln * 0.55, F * 0.1); g.fillStyle = C(L.patch); g.fillRect(pc[0] - 2, pc[1] - 1.6, 4, 3.2); g.strokeStyle = C(L.dark); g.lineWidth = 0.5; g.strokeRect(pc[0] - 2, pc[1] - 1.6, 4, 3.2); }
    if (L.belt) { const b1 = pt(Hb, 1.2, -B - 0.2), b2 = pt(Hb, 1.2, F + 0.5); g.strokeStyle = C(L.belt); g.lineWidth = 1.8; g.beginPath(); g.moveTo(b1[0], b1[1]); g.lineTo(b2[0], b2[1]); g.stroke(); }
    if (beads) {
      const cols = ['#b8392d', '#3f6f7a', '#e3d5b6']; const n = 7;
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, bx = lerp(E[0], A[0], t) + ux * 2.4, by = lerp(E[1], A[1], t) + uy * 2.4 + 0.6; g.fillStyle = cols[i % 3]; g.fillRect(bx - 0.9, by - 0.9, 1.9, 1.9); }
      if (!BACK) { const c1 = pt(Nb, -2.2, F * 0.2); g.fillStyle = '#b8392d'; g.fillRect(c1[0] - 1.8, c1[1], 3.6, 1.2); g.fillStyle = '#3f6f7a'; g.fillRect(c1[0] - 1.2, c1[1] + 1.2, 2.4, 1); }
    }
    if (FRONT && !L.quilt) { const z1 = pt(Nb, -1.5, (F - B) / 2), z2 = pt(Hb, -D + 0.5, (hF - hB) / 2); g.strokeStyle = C(L.dark); g.lineWidth = 0.9; g.beginPath(); g.moveTo(z1[0], z1[1]); g.lineTo(z2[0], z2[1]); g.stroke(); }
    return { Hx, Hy, Nx, Ny, ux, uy, fnx, fny, F, B, E, A };
  }
  function drawPack(g, L, T, back) {
    const { Hx, Hy, Nx, Ny, ux, uy, fnx, fny, B } = T;
    g.fillStyle = C(L.pack); g.beginPath();
    if (back) {
      const px = (a, b) => [lerp(Hx, Nx, a) - fny * 0 + (-uy) * b, lerp(Hy, Ny, a) + ux * b];
      const p1 = px(0.95, -4.6), p2 = px(0.95, 4.6), p3 = px(0.12, 5), p4 = px(0.12, -5);
      g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); g.fill();
      g.fillStyle = C(mix(L.pack, '#000000', 0.25)); g.fillRect(lerp(Hx, Nx, 0.5) - 3.5, lerp(Hy, Ny, 0.5), 7, 3);
      ell(g, lerp(Hx, Nx, 1.05), lerp(Hy, Ny, 1.05), 5.8, 1.9, C('#4b6479'));
    } else {
      const q = (a, of) => [lerp(Hx, Nx, a) + fnx * of, lerp(Hy, Ny, a) + fny * of];
      const p1 = q(0.92, -B + 0.8), p2 = q(0.92, -B - 4.2), p3 = q(0.1, -B - 4.6), p4 = q(0.1, -B + 0.4);
      g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); g.fill();
      const r = q(1.02, -B - 1.8); ell(g, r[0], r[1], 3.4, 1.9, C('#4b6479'));
    }
  }

  // ---------- конечности ----------
  function leg(g, L, i, near) {
    const fx = i ? P.f1x : P.f0x, fy = i ? P.f1y : P.f0y, fa = i ? P.f1a : P.f0a, lat = i ? -2.7 : 2.7;
    ik(P.hx, P.hy, fx, fy, TH, SHN, -1);
    const kx = KX, ky = KY, ax = EX, ay = EY;
    g.strokeStyle = C(near ? L.pants : L.pantsFar); g.lineWidth = 4.8;
    g.beginPath(); M(g, P.hx, P.hy, lat * 0.9); Ln(g, kx, ky, lat); Ln(g, ax, ay, lat); g.stroke();
    // валенок/унт
    g.strokeStyle = C(near ? L.boots : L.bootsFar); g.lineWidth = 4.6;
    g.beginPath(); M(g, lerp(kx, ax, 0.55), lerp(ky, ay, 0.55), lat); Ln(g, ax, ay, lat); Ln(g, ax + Math.cos(fa) * 3.1, ay + 1.1 + Math.sin(fa) * 3.1, lat); g.stroke();
    if (L.bootTrim) { g.strokeStyle = C(L.bootTrim); g.lineWidth = 1.4; g.beginPath(); M(g, lerp(kx, ax, 0.5) - 2.2, lerp(ky, ay, 0.5), lat); Ln(g, lerp(kx, ax, 0.5) + 2.2, lerp(ky, ay, 0.5), lat); g.stroke(); }
  }
  function arm(g, L, i, near) {
    const hx = i ? P.h1x : P.h0x, hy = i ? P.h1y : P.h0y, lat = i ? -1 : 1, hl = i ? P.hl1 : P.hl0;
    ik(P.sx, P.sy, hx, hy, UA, FA, 1);
    const ex = KX, ey = KY; if (i) { P.h1x = EX; P.h1y = EY; } else { P.h0x = EX; P.h0y = EY; }
    g.strokeStyle = C(near ? L.body : L.far); g.lineWidth = 4.3;
    g.beginPath(); M(g, P.sx, P.sy, lat * 5.9); Ln(g, ex, ey, lat * 6.6); Ln(g, EX, EY, lat * hl); g.stroke();
    pr(EX, EY, lat * hl); ell(g, QX, QY, 2.3, 2.3, C(near ? L.mitt : L.mittFar));
    if (L.hood && !L.hoodDown && near) { const cx0 = lerp(ex, EX, 0.78), cy0 = lerp(ey, EY, 0.78); pr(cx0, cy0, lat * hl); ell(g, QX, QY, 2.4, 2.4, C(L.trim)); pr(EX, EY, lat * hl); ell(g, QX, QY, 2.2, 2.2, C(L.mitt)); }
  }

  // ---------- реквизит ----------
  function drawProp(g, kind, o) {
    if (kind === 'box') {
      g.fillStyle = C('#765436'); g.beginPath(); M(g, -6.5, -8.5, 0); Ln(g, 3, -8.5, 0); Ln(g, 3, 0, 0); Ln(g, -6.5, 0, 0); g.closePath(); g.fill();
      g.fillStyle = C('#5b3d27'); g.beginPath(); M(g, -6.5, -4.6, 0); Ln(g, 3, -4.6, 0); Ln(g, 3, -3.6, 0); Ln(g, -6.5, -3.6, 0); g.closePath(); g.fill();
      if (!o.target) { pr(15.5, 0.5, 0); ell(g, QX, QY, 5.4, 2.4, '#dde6ee'); ell(g, QX, QY, 4, 1.6, '#2f3542'); }
    } else if (kind === 'log') {
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); M(g, -8, -3.8, -3); Ln(g, 5, -3.8, 3); g.stroke();
      pr(5, -3.8, 3); ell(g, QX, QY, 2.8, 3.4, C('#c79a62'));
      g.strokeStyle = '#f6f9fc'; g.lineWidth = 1.6; g.beginPath(); M(g, -8, -7.2, -3); Ln(g, 4, -7.2, 3); g.stroke();
    } else if (kind === 'plank') {
      g.fillStyle = C('#a47d50'); g.beginPath(); M(g, 5.5, -3, 0); Ln(g, 20, -3, 0); Ln(g, 20, -0.3, 0); Ln(g, 5.5, -0.3, 0); g.closePath(); g.fill();
      g.fillStyle = C('#765436'); g.fillRect(QX + 0, QY - 0.8, FC * 14.5, 0.8);
    }
  }

  // ---------- сон ----------
  function drawSleep(g, o, L, x, y, t, env) {
    const f = FC, br = Math.sin(t * 1.5) * 0.6;
    shadow(g, x + f * 1, y + 1, 50, 16);
    const x0 = Math.min(x - f * 9, x + f * 16), w = 25;
    g.fillStyle = C('#2f5a3a'); g.beginPath(); g.roundRect ? g.roundRect(x0, y - 10.5 - br, w, 10.5 + br, 5) : g.rect(x0, y - 10.5 - br, w, 10.5 + br); g.fill();
    g.strokeStyle = C('#2f5a3a'); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0 + 3, y - 9.6 - br); g.lineTo(x0 + w - 4, y - 9.6 - br); g.stroke();
    g.strokeStyle = C('#1c4034'); g.lineWidth = 0.9; g.beginPath(); g.moveTo(x0 + w * 0.45, y - 9.8 - br); g.lineTo(x0 + w * 0.5, y - 1); g.moveTo(x0 + w * 0.75, y - 9.6 - br); g.lineTo(x0 + w * 0.8, y - 1.5); g.stroke();
    const hx = x - f * 13, hy = y - 6.5;
    if (L.hood && !L.hoodDown) {
      ell(g, hx, hy, 6.8, 6.2, C(L.hood));
      g.strokeStyle = C(L.trim); g.lineWidth = 2.5; g.beginPath(); g.ellipse(hx + f * 0.6, hy - 1.4, 3.6, 4.4, f * -0.9, 0, PI * 2); g.stroke();
      ell(g, hx + f * 0.6, hy - 1.4, 2.6, 3.4, C(L.face), f * -0.9);
    } else {
      ell(g, hx, hy - 0.5, 5, 5, C(L.face));
      if (L.hat) ell(g, hx - f * 2.4, hy - 1.2, 3.8, 5.4, C(L.hat), f * 0.3);
    }
    g.fillStyle = '#3a2618'; g.fillRect(hx + f * 1.2 - 0.9, hy - 1.6, 1.8, 0.6);
    if (L.beard) ell(g, hx + f * 3.4, hy - 0.2, 2.2, 2.6, C(L.beard));
    ell(g, x0 + (f > 0 ? 5 : w - 5), y - 10.5 - br, 2.3, 2, C(L.mitt));
    const z = (t * 0.6) % 1;
    g.fillStyle = (env.night || 0) > 0.5 ? 'rgba(235,242,255,' : 'rgba(80,105,140,';
    g.fillStyle += (1 - z).toFixed(2) + ')';
    const zs = (7 + z * 5) / 10, zx = hx + f * (2 + z * 6), zy = hy - 9 - z * 12;
    g.strokeStyle = g.fillStyle; g.lineWidth = 1.4 * zs; g.lineJoin = 'miter'; g.beginPath();
    g.moveTo(zx - 3 * zs, zy - 6 * zs); g.lineTo(zx + 3 * zs, zy - 6 * zs); g.lineTo(zx - 3 * zs, zy); g.lineTo(zx + 3 * zs, zy); g.stroke(); g.lineJoin = 'round';
  }

  // ---------- память фигуры (o.key): смешивание поз, поворот, спина с гистерезисом ----------
  // BL — поля позы, которые плавно переходят при смене действия (0.13 с, A5)
  const MEM = new WeakMap(), BL = ['hx', 'hy', 'lean', 'tilt', 'f0x', 'f0y', 'f0a', 'f1x', 'f1y', 'f1a', 'h0x', 'h0y', 'h1x', 'h1y', 'sx', 'sy', 'hl0', 'hl1'];
  const BLEND = 0.13, TURN = 0.1;
  function memOf(o) {
    if (!o.key || typeof o.key !== 'object') return null;
    let m = MEM.get(o.key);
    if (!m) { m = { anim: null, last: {}, from: null, t0: -9, face: o.face < 0 ? -1 : 1, fromFace: 1, turnT: -9, back: false, front: false, t: o.t || 0 }; MEM.set(o.key, m); }
    return m;
  }
  function blendPose(m, anim, t) {
    if (m.anim !== anim) { if (m.anim) { m.from = Object.assign({}, m.last); m.t0 = t; } m.anim = anim; }
    const k = m.from ? (t - m.t0) / BLEND : 1;
    if (k >= 0 && k < 1) { const e = sm(k); for (const f of BL) if (typeof m.from[f] === 'number') P[f] = lerp(m.from[f], P[f], e); }
    else m.from = null;
    for (const f of BL) m.last[f] = P[f];
  }

  // ---------- главный вход ----------
  const NOENV = { now: 0, night: 0, light() {}, spark() {} };
  function draw(g, o, env) {
    env = env || NOENV; if (!env.light) env.light = NOENV.light; if (!env.spark) env.spark = NOENV.spark;
    const t = o.t || 0; if (o.blink && Math.floor(t * 20) % 2) return;
    let anim = o.anim || 'idle'; const a = clamp(o.animT || 0, 0, 1);
    const L = look(o.look), ph = o.phase || 0, sp = clamp(o.speed == null ? 0.5 : o.speed, 0, 1);
    let tool = o.tool || 'none';
    const x = o.x, y = o.y;
    FC = o.face < 0 ? -1 : 1;
    const vyv = LOCO[anim] ? clamp(o.vy || 0, -1, 1) : 0;
    S = Math.abs(vyv); K = 1 - S * 0.82; SY = vyv * 0.3; X0 = x; Y0 = y;
    const mm = memOf(o);
    // спина/лицо: гистерезис −0.40/−0.30, чтобы при ходе почти вертикально не мигало (A11)
    if (mm) { if (vyv < -0.4) mm.back = true; else if (vyv > -0.3) mm.back = false; if (vyv > 0.4) mm.front = true; else if (vyv < 0.3) mm.front = false; BACK = mm.back; FRONT = mm.front; }
    else { BACK = vyv < -0.35; FRONT = vyv > 0.35; }
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    // поворот: сжатие по x 1→0→−1 за 0.1 с вместо мгновенного зеркала (A10)
    if (mm) {
      if (FC !== mm.face) { mm.fromFace = mm.face; mm.face = FC; mm.turnT = t; }
      const k = (t - mm.turnT) / TURN;
      if (k >= 0 && k < 1) { const sx = Math.max(0.06, Math.abs(1 - 2 * k)); if (k < 0.5) FC = mm.fromFace; g.translate(x, 0); g.scale(sx, 1); g.translate(-x, 0); }
    }
    // оттенок
    TA = 0;
    if (o.wet) { TC = '#27394a'; TA = 0.2; }
    reset();
    if (o.sel) { g.strokeStyle = '#ffd27a'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, anim === 'sleep' || anim === 'dead' ? 24 : 15, 6, 0, 0, PI * 2); g.stroke(); }
    if (anim === 'sleep') { drawSleep(g, o, L, x, y, t, env); finish(g, o, L, x, y, env); g.restore(); return; }
    // поза
    switch (anim) {
      case 'walk': walk(o, t, ph, sp); break;
      case 'run': run(o, t, ph); break;
      case 'limp': limp(o, t, ph); break;
      case 'carry': if (sp > 0.05) walk(o, t, ph, sp * 0.6); else idle(o, t); break;
      case 'chop': if (tool === 'saw') saw(o, t); else chop(o, t, a); break;
      case 'dig': dig(o, t, a); break;
      case 'fish': fish(o, t, false); break;
      case 'fishBite': fish(o, t, true); break;
      case 'build': build(o, t, a); break;
      case 'swing': swing(o, t, a, tool); break;
      case 'shoot': case 'aim': shoot(o, t, a, tool === 'bow' || tool === 'rifle' ? tool : (L.weapon || 'rifle'), anim === 'aim'); break;
      case 'sit': sit(o, t); break;
      case 'hurt': hurt(o, t, a); TC = '#b8392d'; TA = Math.max(TA, Math.max(0, 1 - a * 3.2) * 0.75); break;
      case 'dead': dead(o, t, a); TC = '#7f8792'; TA = 0.35 * sm(a / 0.55); break;
      case 'talk': talk(o, t, !!L.staff); break;
      case 'wave': wave(o, t); break;
      default: idle(o, t);
    }
    if (L.old && anim !== 'dead') { P.lean += 0.12; P.hy += 0.5; shoulder(); if (anim === 'idle' || anim === 'talk') { P.h1y = Math.min(P.h1y, P.sy + 12); } }
    if (mm && anim !== 'dead') blendPose(mm, anim, t);
    if (P.rot) { CR = Math.cos(P.rot); SR = Math.sin(P.rot); }
    // что в руках вне работы
    const free = LOCO[anim] && anim !== 'hurt';
    let slung = null;
    if (!P.tk) {
      if (tool === 'bow' || tool === 'rifle') slung = tool;
      else if (anim === 'dead') { /* уронил */ }
      else if (free && tool === 'torch') { handR(0, 5.5, 5 + Math.sin(ph) * 0.4); P.hl0 = 6; P.tk = 'torch'; P.ta = -1.35; }
      else if (free && (tool === 'axe' || tool === 'saw' || tool === 'rod')) { P.tk = tool; P.ta = tool === 'axe' ? 1.3 : 1.15; }
    }
    if (!P.tk && !slung && L.weapon && (anim !== 'shoot' && anim !== 'aim')) slung = L.weapon;
    if (anim === 'carry' || (o.carry && (anim === 'walk' || anim === 'idle'))) {
      if (P.tk === 'torch') P.tk = null;
      handR(0, 6.8, 7.2); handR(1, 5.6, 6.6); P.hl0 = 3.8; P.hl1 = 3.8; P.carry = 1;
      if (P.tk === 'axe' || P.tk === 'saw' || P.tk === 'rod') P.tk = null;
    }
    const staff = L.staff && (anim === 'idle' || anim === 'walk' || anim === 'limp' || anim === 'talk' || anim === 'wave' || anim === 'hurt') && !P.carry;
    if (staff) { handR(0, 4.2 + (anim === 'walk' ? 1.5 * Math.sin(ph) : 0), 9.8); P.hl0 = 6; if (P.tk === 'axe' || P.tk === 'saw' || P.tk === 'rod') P.tk = null; }

    // тень
    const lying = anim === 'dead' ? sm(a / 0.55) : 0;
    shadow(g, x - FC * 12 * lying + P.ox, y + 1, 30 + lying * 26, 11 + lying * 3);
    if (P.prop) drawProp(g, P.prop, o);
    if (anim === 'dead' && tool !== 'none') { const sv = P.rot; P.rot = 0; P.ox = 0; P.oy = 0; drawTool(g, tool === 'bow' || tool === 'rifle' ? tool : 'axe', 7, 2, 0.15, 0, o, NOENV); P.rot = sv; dead(o, t, a); }

    const back = BACK, front = FRONT;
    // ближняя рука рассчитывается первой: к её (зажатой) кисти крепится инструмент
    ik(P.sx, P.sy, P.h0x, P.h0y, UA, FA, 1); P.h0x = EX; P.h0y = EY;
    let tox = P.tox, toy = P.toy, tlat = P.hl0;
    if (P.tk === 'bow') { tox = P.h1x; toy = P.h1y; tlat = -P.hl1; }
    else if (tox === null) { tox = P.h0x; toy = P.h0y; }
    else tlat = 0;
    if (P.two) { P.h1x = tox + Math.cos(P.ta) * P.gap; P.h1y = toy + Math.sin(P.ta) * P.gap; }
    if (P.tk === 'pole') P.plen = Math.min(19, (-toy - 0.3) / Math.max(0.3, Math.sin(P.ta)));

    const beads = !!L.beads;
    // порядок слоёв
    if (back && P.tk) drawTool(g, P.tk, tox, toy, P.ta, tlat, o, env);
    if (!front && !back) arm(g, L, 1, false);
    if (slung && !back) drawSlung(g, slung);
    leg(g, L, 1, false); leg(g, L, 0, true);
    let T;
    if (L.pack && !back && S < 0.55) { T = torsoFrame(); drawPack(g, L, T, false); }
    T = drawTorso(g, L, vyv, beads);
    if (L.pack && back) drawPack(g, L, T, true);
    if (slung && back) drawSlung(g, slung);
    if (o.frost > 0.2) { g.globalAlpha = o.frost * 0.8; pr(P.sx, P.sy - 1, 0); ell(g, QX, QY, 5, 1.6, '#f6f9fc'); g.globalAlpha = 1; }
    drawHead(g, o, L, vyv, env);
    if (front || back) arm(g, L, 1, false);
    if (staff) {
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 2.4; g.beginPath(); M(g, P.h0x + 1.2, 0, P.hl0); Ln(g, P.h0x - 0.6, P.h0y - 15, P.hl0); g.stroke();
      pr(P.h0x - 0.6, P.h0y - 15, P.hl0); ell(g, QX, QY, 1.6, 1.6, C('#b8392d'));
    }
    if (P.tk && !back) drawTool(g, P.tk, tox, toy, P.ta, tlat, o, env);
    if (P.carry && o.carry && !back) { pr(P.sx + 7.5, P.sy + 5.2, 0); carryIc(g, o.carry, QX, QY, 12); }
    arm(g, L, 0, true);
    if (P.trail) {
      const [b0, b1, R] = P.trail;
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2.2; g.beginPath();
      for (let i = 0; i <= 6; i++) { const b = lerp(b0, b1, i / 6); pr(P.sx + Math.cos(b) * R, P.sy + Math.sin(b) * R, 0); i ? g.lineTo(QX, QY) : g.moveTo(QX, QY); }
      g.stroke();
    }
    if (P.spark) {
      let sx, sy;
      if (P.tk === 'pole') { TX = tox; TY = toy; TC_ = Math.cos(P.ta); TS = Math.sin(P.ta); TL = 0; tp(P.plen, 0); sx = QX; sy = QY; }
      else { TX = tox; TY = toy; TC_ = Math.cos(P.ta); TS = Math.sin(P.ta); TL = tlat; tp(P.tk === 'hammer' ? 10 : 16, 4); sx = QX; sy = QY; }
      env.spark(sx, sy, 1);
      g.fillStyle = P.tk === 'axe' ? '#c79a62' : '#dde6ee';
      for (let i = 0; i < 4; i++) { const an = -PI / 2 + (i - 1.5) * 0.6, r = 3 + (t * 37 + i * 3) % 4; g.fillRect(sx + Math.cos(an) * r - 0.8, sy + Math.sin(an) * r - 0.8, 1.6, 1.6); }
    }
    if (anim === 'hurt' && a < 0.12) { pr(P.sx, P.sy + 3, 0); env.spark(QX, QY, 1 - a / 0.12); }
    // пар изо рта
    if (anim !== 'dead' && !back) {
      const bp = (t * 0.33 + (o.seed || (x * 0.013 + y * 0.007))) % 1;
      if (bp < 0.35) {
        const ang = P.lean + P.tilt, nx = P.hx + Math.sin(P.lean) * TORSO, ny = P.hy - Math.cos(P.lean) * TORSO;
        const e = bp / 0.35; pr(nx + Math.sin(ang) * 5.6 + Math.cos(ang) * (6 + e * 8), ny - Math.cos(ang) * 5.6 + 1.5 - e * 3, 0);
        g.fillStyle = 'rgba(246,249,252,' + (0.55 * (1 - e)).toFixed(2) + ')'; g.beginPath(); g.arc(QX, QY, 1.4 + e * 3.4, 0, PI * 2); g.fill();
      }
    }
    finish(g, o, L, x, y, env);
    g.restore();
    TA = 0;
  }
  function torsoFrame() {
    pr(P.hx, P.hy, 0); const Hx = QX, Hy = QY;
    pr(P.hx + Math.sin(P.lean) * TORSO, P.hy - Math.cos(P.lean) * TORSO, 0); const Nx = QX, Ny = QY;
    let ux = Nx - Hx, uy = Ny - Hy; const ln = Math.hypot(ux, uy) || 1; ux /= ln; uy /= ln;
    return { Hx, Hy, Nx, Ny, ux, uy, fnx: -uy * FC, fny: ux * FC, F: lerp(5.3, 6.9, S), B: lerp(4.5, 6.9, S) };
  }
  function finish(g, o, L, x, y, env) {
    TA = 0;
    if (o.wet) { g.fillStyle = '#b6c9df'; const t = o.t || 0; g.fillRect(x - 5, y - 6 + (t * 20 % 6), 1.4, 2.6); g.fillRect(x + 4, y - 8 + (t * 17 % 7), 1.4, 2.6); }
    if (o.hp != null && o.hp < 1) {
      const w = 24, h = Math.max(0, Math.min(1, o.hp));
      g.fillStyle = 'rgba(47,53,66,0.6)'; g.fillRect(x - w / 2, y + 5, w, 3);
      g.fillStyle = h > 0.4 ? '#9fe36b' : '#e25a4f'; g.fillRect(x - w / 2, y + 5, w * h, 3);
    }
    if (o.carry && !P.carry && o.anim !== 'sleep' && o.anim !== 'dead') carryIc(g, o.carry, x, y - 54, 12);
  }
  // ноша: иконка из спрайта (js/icons.js), тёмная обводка для снега
  function carryIc(g, c, x, y, px) {
    if (typeof Icons !== 'undefined' && Icons.draw(g, c, x, y, px, '#ebe6d3', 'rgba(11,18,14,.8)')) return;
    g.font = '11px "PT Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c, x, y); g.textBaseline = 'alphabetic';
  }

  return {
    draw, LOOKS, look, mix, stride,
    ANIMS: ['idle', 'walk', 'run', 'limp', 'carry', 'talk', 'wave', 'chop', 'dig', 'fish', 'fishBite', 'build', 'swing', 'aim', 'shoot', 'sit', 'sleep', 'hurt', 'dead'],
    // длительности разовых циклов (сек) — для animT
    DUR: { chop: 0.9, dig: 1.0, build: 0.7, swing: 0.45, shoot: 1.4, hurt: 0.6, dead: 1.2 },
  };
})();
if (typeof module !== 'undefined') module.exports = ArtPeople;
