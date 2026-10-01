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
  // этап 3: приглушённая палитра (насыщенность ткани ≤ ~35–50 %, как у реальной зимней одежды), валенки серые,
  // мех — кремово-серый, кожа на тон темнее (лицо в тени капюшона/шапки)
  const LOOKS = {
    anorak: { hero: 1, body: '#8a3a2e', dark: '#5e2a22', hood: '#7a3328', trim: '#cfc3a8', face: '#c9a080', pants: '#2e3440', boots: '#6b6862', mitt: '#3a3a36', pack: '#6b5a45', band: '#cfc3a8', belt: '#3a2a22' },
    dokha: { body: '#8c6a48', dark: '#5e4834', hood: '#6e5a48', trim: '#d9ccb0', face: '#c9a080', pants: '#3a322c', boots: '#6b6862', mitt: '#5e4834', long: 1, shag: 1 },
    kukhl: { body: '#8a6e50', dark: '#5e4a36', hood: '#76604a', trim: '#d9ccb0', face: '#c9a080', pants: '#4a3c30', boots: '#6b5a48', bootTrim: '#cfc3a8', mitt: '#5e4a36', beads: 1, long: 1 },
    urk: { body: '#8a6e50', dark: '#5e4a36', hood: '#76604a', trim: '#d9ccb0', face: '#b58d70', pants: '#4a3c30', boots: '#6b5a48', bootTrim: '#cfc3a8', mitt: '#5e4a36', beads: 1, beard: '#d8d4c8', staff: 1, old: 1, long: 1, evk: 1, beardK: 'thin' },
    vera: { body: '#4a6468', dark: '#34484c', hood: '#3e575c', hoodDown: 1, trim: '#cfc3a8', face: '#c9a080', hat: '#8a3a2e', hatType: 'knit', hair: '#5a3a2c', pants: '#2e3440', boots: '#6b6862', mitt: '#8a3a2e', band: '#cfc3a8', fem: 1 },
    bich: { body: '#2e3440', dark: '#1f242d', hood: null, trim: '#7a6e5e', face: '#c49a7a', hat: '#6e6258', hatType: 'ushanka', pants: '#2a2e36', boots: '#6b6862', mitt: '#4a4034', quilt: 1, stubble: 1, belt: '#2a2018' },
    evenk: { body: '#8a6e50', dark: '#5e4a36', hood: '#76604a', trim: '#d9ccb0', face: '#b58d70', pants: '#4a3c30', boots: '#6b5a48', bootTrim: '#cfc3a8', mitt: '#5e4a36', beads: 1, weapon: 'bow', evk: 1 },
    strelok: { body: '#3e4a3a', dark: '#2a3428', hood: null, trim: '#a89e8e', face: '#c49a7a', hat: '#2e3a2c', hatType: 'ushanka', pants: '#232a24', boots: '#6b6862', mitt: '#2a3428', belt: '#2a2018', weapon: 'rifle' },
    // ---------- люди зон (A6): отличие — силуэт головы и одна деталь ----------
    // метеоролог Тамара: пуховый платок, стёганый ватник, валенки, очки
    tamara: { body: '#46585c', dark: '#323f42', hood: null, trim: '#cfc3a8', face: '#c9a080', hat: '#6c6f72', hatType: 'shawl', shawlDot: '#c8ccd0', pants: '#2e3440', boots: '#6b6862', mitt: '#b8ae9c', quilt: 1, long: 1, glasses: 1, fem: 1, aged: 1 },
    // вахтовик Михалыч: каска на подшлемнике, брезентовая роба, щетина
    mikhalych: { body: '#9a5a3a', dark: '#6a3e2a', hood: null, trim: '#cfc3a8', face: '#c49a7a', hat: '#c09040', hatType: 'helmet', pants: '#2e3440', boots: '#4a4846', mitt: '#5e5040', quilt: 1, stubble: 1, belt: '#2a2018', aged: 1 },
    // вахтовик-напарник: та же роба, синяя каска
    vakhta: { body: '#4e5a66', dark: '#343d46', hood: null, trim: '#a89e8e', face: '#c9a080', hat: '#4a6a72', hatType: 'helmet', pants: '#2e3440', boots: '#4a4846', mitt: '#5e5040', quilt: 1, belt: '#2a2018' },
    // приёмщик Ефимыч: тулуп, шапка-ушанка, очки на носу
    efimych: { body: '#9a7148', dark: '#6a4d32', hood: null, trim: '#d9ccb0', face: '#c49a7a', hat: '#6e6258', hatType: 'ushanka', pants: '#3a322c', boots: '#6b6862', mitt: '#6a4d32', long: 1, shag: 1, glasses: 1, beard: '#7a6650', aged: 1 },
    // шаманка Уялан: кухлянка с бисером, красный платок, посох-бубен, старая
    uyalan: { body: '#7a6048', dark: '#4e3c2c', hood: null, trim: '#d9ccb0', face: '#b58d70', hat: '#8a3a2e', hatType: 'shawl', shawlDot: '#c8a860', pants: '#4a3c30', boots: '#6b5a48', bootTrim: '#cfc3a8', mitt: '#5e4a36', beads: 1, staff: 1, old: 1, long: 1, shag: 1, fem: 1, evk: 1 },
    // старовер Агафон: тёмный кафтан, борода лопатой, шапка, посох
    agafon: { body: '#352e2a', dark: '#1e1a18', hood: null, trim: '#7a6e5e', face: '#c49a7a', hat: '#4a3e34', hatType: 'ushanka', pants: '#2e3238', boots: '#4a403a', mitt: '#4a3e34', beard: '#b8b0a4', long: 1, belt: '#7a3a2e', staff: 1, beardK: 'long', aged: 1 },
    // бич Толян: ватник в заплатах, вязаная шапка, щетина
    tolyan: { body: '#4a4a3a', dark: '#323228', hood: null, trim: '#7a6e5e', face: '#c49a7a', hat: '#6a3a30', hatType: 'knit', band: '#b8ae9c', pants: '#3e4a56', boots: '#6b6862', mitt: '#5e5040', quilt: 1, stubble: 1, patch: '#6e5a44' },
    // промысловик Коченин: малица без капюшона, ушанка, карабин за спиной
    kochenin: { body: '#5a6250', dark: '#3c4436', hood: null, trim: '#d9ccb0', face: '#c49a7a', hat: '#6e6258', hatType: 'ushanka', pants: '#3a322c', boots: '#6b5a48', bootTrim: '#cfc3a8', mitt: '#5e4a36', belt: '#2a2018', weapon: 'rifle', stubble: 1 },
    // почтальон Вася: серо-синий тулуп, ушанка, почтовая сумка
    vasya: { body: '#56646e', dark: '#38434c', hood: null, trim: '#d9ccb0', face: '#c9a080', hat: '#6e6258', hatType: 'ushanka', pants: '#2e3440', boots: '#6b6862', mitt: '#38434c', pack: '#6e5a44', long: 1 },
  };
  // ---------- облик героя: по умолчанию B «Полярник»; флаг window.HERO_LOOK / localStorage 'sibir-hero-look' = 'a'|'c' — другие
  // варианты, 'old' — прежний герой (LOOKS.anorak как есть). Подменяют только облик с hero:1 (anorak и его копии с шапкой из gfx.js).
  // Поля силуэта: hem — подол ниже таза (px), flare — ширина подола к груди, shW — плечи шире, bootH — где начинается голенище
  // (доля голени от колена), bootW — толщина голенища, knee — наколенник, cuff — обшлаг, armSep — тень руки на корпусе,
  // faceV — открытое лицо (глазницы, нос, скулы), packType — sack | frame | bag, axeBelt — топор за поясом, bowBack — лук за спиной
  const HV = {
    // A «Промысловик»: короткий ватник, ватные штаны, высокие валенки, ушанка с подвязанными ушами, сидор, топор за поясом
    a: { hero: 1, body: '#44505c', dark: '#2c343e', hood: null, trim: '#8a8272', face: '#c29474', hat: '#5e5044', hatType: 'ushankaUp', fur: '#8a7a66',
      pants: '#5a5650', boots: '#9a9384', mitt: '#6e5840', quilt: 1, qStep: 2.3, belt: '#2a2018', stubble: 1, pack: '#8c7f60', packType: 'sack',
      hem: 2.2, flare: -1.1, shW: 0.9, bootH: 0.12, bootW: 4.3, cuff: '#2c343e', armSep: 1, faceV: 1, axeBelt: 1 },
    // B «Полярник» (герой по умолчанию): сигнальный красно-оранжевый пуховый анорак по бедро со светоотражающими полосами, капюшон
    // с волчьим мехом откинут, тёмно-синяя вязаная шапка с горнолыжными очками, синий каркасный рюкзак, наколенники, унты.
    // pol — свой рендер головы (лицо с поворотом), стёганых секций, полос, рефлекса снега; refl — светоотражающая лента
    b: { hero: 1, pol: 1, body: '#dc4f1c', dark: '#8a2810', hood: '#c4461a', hoodDown: 1, collar: 1, trim: '#d8ccb4', face: '#d29c7a', hat: '#243a5e', hatType: 'knit', noPom: 1, goggles: 1,
      pants: '#2a2e36', boots: '#6e5a48', bootTrim: '#ddd2bc', mitt: '#1e2838', stubble: 2, pack: '#2d4f7e', packType: 'frame', pocket: 1, refl: '#d4dde5',
      ruff: '#a4937a', hairC: '#4e3526', beardC: '#5c3e2c', roll: '#7d8455',
      hem: 3.4, flare: -0.5, shW: 0.6, bootH: 0.34, bootW: 4.1, knee: '#1f232a', cuff: '#1e2838', armSep: 1, faceV: 1, axeBelt: 1 },
    // C «Эвенк»: кухлянка из оленьей шкуры до середины бедра с узором по подолу, меховой капюшон, смуглое лицо, короткие унты, лук за спиной, сумка
    c: { hero: 1, body: '#977150', dark: '#654a33', hood: '#735640', openHood: 1, trim: '#d8cbae', face: '#a97b5a', pants: '#554232', boots: '#6e5842', bootTrim: '#d8cbae',
      mitt: '#6a5038', ornament: 1, pack: '#6a5038', packType: 'bag', bowBack: 1, weapon: 'bow',
      hem: 4.2, flare: 0.1, shW: 0.4, bootH: 0.48, bootW: 4, cuff: '#d8cbae', armSep: 1, faceV: 1, axeBelt: 1 },
  };
  if (typeof window !== 'undefined' && window.HERO_LOOK === undefined) { try { window.HERO_LOOK = localStorage.getItem('sibir-hero-look'); } catch (e) { window.HERO_LOOK = null; } }
  function heroSub(l) {
    const v = typeof window !== 'undefined' ? window.HERO_LOOK : null; if (v === 'old') return l;
    const s = typeof l === 'string' ? LOOKS[l] : l; return s && s.hero ? HV[v] || HV.b : l;
  }
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
    n.fur = l.fur || (n.hat ? mix(n.hat, '#d9ccb0', 0.35) : n.trim);
    if (n.faceV) { n.furL = mix(n.fur, '#efe6d2', 0.35); n.faceL = mix(n.face, '#f6dcc0', 0.35); n.faceS = mix(n.face, '#3a2418', 0.45); n.cheek = mix(n.face, '#b85a48', 0.35); }
    if (n.armSep) { n.sleeve = mix(n.body, '#f3e3c8', 0.07); n.sleeveFar = mix(n.body, '#1c222c', 0.32); }
    if (n.knee) n.kneeFar = mix(n.knee, '#10141c', 0.3);
    n.stitch = mix(n.body, '#000000', 0.12);                     // строчка ватника — на 12 % темнее ткани
    n.faceD = mix(n.face, '#5a4034', 0.3);
    n.ruff = l.ruff || mix(n.hood || n.body, '#b8ab92', 0.5); n.ruffL = mix(n.ruff, '#e0d6c0', 0.55);   // опушка — в тон капюшону
    if (n.pol) {   // полярник: тон света/блика ткани, дальняя лента, рефлекс снега, кожа и шапка по объёму
      n.bodyH = mix(n.body, '#ffd0a0', 0.42); n.reflFar = mix(n.refl, '#3a4452', 0.35); n.reflL = mix(n.refl, '#ffffff', 0.6);
      n.bounce = '#a9c8e6'; n.hatL = mix(n.hat, '#c8d6e6', 0.3); n.hatC = mix(n.hat, '#dde6ee', 0.12); n.hatD = mix(n.hat, '#070b12', 0.45);
      n.lip = mix(n.face, '#7a2a22', 0.45); n.skinN = mix(n.face, '#6a4a3a', 0.35); n.brow = mix(n.hairC, '#1a100a', 0.3); n.packL = mix(n.pack, '#c8d8ea', 0.28); n.packD = mix(n.pack, '#0a1220', 0.45);
    }
    // лицо на сфере для людей мира (крупный план): свет/тень кожи, румянец, губы, брови, волосы — в тон лицу и облику
    n.nL = mix(n.face, '#f6dcc0', 0.35); n.nS = mix(n.face, '#3a2418', 0.45); n.nCh = mix(n.face, '#b85a48', 0.35);
    n.nLip = mix(n.face, n.fem ? '#9a3432' : '#7a2a22', n.fem ? 0.5 : 0.42);
    n.nHair = l.hair || (n.old ? mix(n.beard || '#d8d4c8', '#8a8478', 0.3) : n.evk ? '#1e1a18' : n.beard ? mix(n.beard, '#2a2018', 0.35) : '#3a2a1e');
    n.nBrow = n.old ? mix(n.nHair, '#6a6258', 0.25) : mix(n.nHair, '#1a100a', 0.3);
    n.hoodD = mix(n.hood || n.body, '#10141c', 0.25);
    n.pantsLow = mix(n.pants, '#10141c', 0.18); n.pantsFarLow = mix(n.pantsFar, '#10141c', 0.18);   // голень темнее к снегу
    n.hoodL = mix(n.hood || n.body, '#f3e3c8', 0.3); n.hoodM = mix(n.hood || n.body, '#f3e3c8', 0.12); n.bodyL = mix(n.body, '#f3e3c8', 0.16);
    n.armL = mix(n.body, '#f3e3c8', 0.28); n.pantsL = mix(n.pants, '#dde6ee', 0.22); n.pantsD = mix(n.pants, '#10141c', 0.45);   // блик на ткани — тёплый, низкий контраст
    n.bootsL = mix(n.boots, '#dde6ee', 0.3); n.mittL = mix(n.mitt, '#f3e3c8', 0.3);
    if (SCs()) {   // C: 2 тона на материал — блики = основной тон, дальняя сторона = тень (роли привяжет контекст Style.figure)
      const hd = n.hood || n.body;
      for (const [k, v] of [['bodyH', n.body], ['bodyL', n.body], ['armL', n.body], ['sleeve', n.body], ['hoodL', hd], ['hoodM', hd], ['pantsL', n.pants], ['bootsL', n.boots], ['mittL', n.mitt],
        ['furL', n.fur], ['faceL', n.face], ['nL', n.face], ['reflL', n.refl], ['hatL', n.hat], ['hatC', n.hat], ['packL', n.pack], ['ruffL', n.ruff], ['far', n.dark], ['sleeveFar', n.dark]]) if (n[k] != null && v != null) n[k] = v;
    }
    NORM.set(l, n); return n;
  }

  // ---------- риг ----------
  // этап 3 (пропорции взрослого в зимней одежде, рост ≈42 px): таз −20, плечо −33, колено ≈−10, голова ≈1/5.7 роста.
  // Позы пишут таз в прежней «сырой» шкале (стоя −17.2, стопы −2): hipY() растягивает её по высоте ног (KL),
  // так что присед/сидение/опора остаются теми же позами, а горизонталь (шаг, опора стопы) не меняется.
  const TH = 10, SHN = 9.9, UA = 7.7, FA = 6.3, MT = 3.8, TORSO = 14.6, SHO = 13, KL = 18 / 15.2, HN = 3.5;
  // рука (Drillis–Contini): плечо 0.186 H, предплечье 0.146 H, кисть 0.108 H → плечо→кончик варежки ≈0.42 H (17.8 px);
  // в покое почти прямая (сгиб ≈12°), варежка у бедра; RA0/RA1 — углы покоя [плечо от вертикали (вперёд +), сгиб локтя]
  const RA0 = [0.05, 0.21], RA1 = [-0.06, 0.19];
  const hipY = v => -2 + (v + 2) * KL;
  const hipD = () => (P.hyD ? P.hy : hipY(P.hy));   // таз на экране в координатах рига
  const P = { lg0: new Array(14).fill(0), lg1: new Array(14).fill(0), ar0: new Array(13).fill(0), ar1: new Array(13).fill(0), pts: new Array(20).fill(0) };   // lg — экранные таз/колено/щиколотка нарисованных ног + углы бедра/голени и стопы (>0 — носок вниз) в риге (для проверок, tests/gait-angles.js); ar — экранные плечо/локоть/запястье/кончик варежки нарисованной руки + угол плеча, сгиб локтя, плечо→запястье в риге, масштаб варежки (tests/arm-check.js);
  // lg[9..13] — носок, точка снега под стопой (экран), опора 1/0 — для кромки снега по ногам (gfx sunk); pts — 10 точек тела на экране (голова…кисти) — для «за препятствием»
  function reset() {
    P.hx = 0; P.hy = -17.2; P.hyD = 0; P.lean = 0.04; P.tilt = 0; P.br = 0;
    P.f0x = 1.3; P.f0y = -2; P.f0a = 0; P.f1x = -1.6; P.f1y = -2; P.f1a = 0;
    P.h0x = 0; P.h0y = 0; P.h1x = 0; P.h1y = 0; P.hl0 = 6.6; P.hl1 = 6.6;
    P.tk = null; P.ta = 1.2; P.tsc = 1; P.two = 0; P.gap = -4; P.tox = null; P.toy = 0; P.plen = 18;
    P.rot = 0; P.pvx = 0; P.pvy = -19.8; P.ox = 0; P.oy = 0;
    P.eyes = 0; P.mouth = 0; P.prop = null; P.hb = 0; P.flash = 0; P.bend = 0; P.sd = 0; P.arrow = 0;
    P.lo = null; P.lon = 0; P.lsh = 0;   // ноша: охапка у груди [x, y] и сколько частей, вершина на плече
    P.trail = null; P.held = null; P.held2 = null; P.tlat = null; P.belt = 0; P.taT = null; P.staff = 0; P.carry = 0; P.smoke = 0; P.spark = 0; P.zz = 0;
    P.st0 = P.st1 = -1; P.q0 = P.q1 = 0; P.u0 = P.u1 = 0; P.pk = 0;   // опора стоп из походки (−1 — поза без шага); pk — стопы закреплены (planting); u — доля опоры
    P.rx0 = P.rx1 = 0; P.ob = 0; P.roll = 0; P.prot = 0; P.tw = 0;   // шаг: перекат стопы (x щиколотки), наклон таза, крен корпуса, скрут таза/плеч (рад)
    P.hlat = 0; P.bz = 0; P.dLean = 0; P.dDip = 0; P.hlag = 0; P.pkx = 0; P.pky = 0; P.pka = 0; P.axw = 0; P.clx = 0; P.cly = 0; P.pom = 0; P.cover = 0;   // cover — пурга: доля «рука у лица» (art-poses shield); этап 4: таз вбок к опорной ноге, вдох (плечи вверх), инерция корпуса/головы/рюкзака (для проверок)
  }
  function shoulder() { P.sx = P.hx + Math.sin(P.lean) * SHO; P.sy = hipD() - Math.cos(P.lean) * SHO; }
  function handA(i, ang, d) { const x = P.sx + Math.cos(ang) * d, y = P.sy + Math.sin(ang) * d; if (i) { P.h1x = x; P.h1y = y; } else { P.h0x = x; P.h0y = y; } }
  function handR(i, dx, dy) { if (i) { P.h1x = P.sx + dx; P.h1y = P.sy + dy; } else { P.h0x = P.sx + dx; P.h0y = P.sy + dy; } }
  // плечевой сустав ходит за рукой (лопатка): вперёд/назад за кистью, вверх — когда кисть выше плеча; рука не «приколота» к одной точке
  // на шаге плечи скручены навстречу тазу (P.tw, + — ближнее плечо вперёд): сустав руки i сидит на скрученном плече —
  // смещение то же, что у контура куртки в drawTorso (5.9·tw), иначе рукав отрывается от плеча куртки
  let JX = 0, JY = 0;
  const TWS = 5.9, twX = i => (i ? -TWS : TWS) * P.tw;
  function joint(hx, hy, i) { const bx = P.sx + twX(i), a = Math.atan2(hx - bx, hy - P.sy), c = Math.cos(a); JX = bx + 0.8 * Math.sin(a); JY = P.sy - 0.9 * Math.max(0, -c) + 0.15 * (1 - c); }
  // кисть по углам (прямая кинематика): th — плечо от вертикали (вперёд +), fl — сгиб локтя (предплечье вперёд +); IK потом даёт ровно эти углы
  function armFK(i, th, fl) {
    const dx = UA * Math.sin(th) + FA * Math.sin(th + fl), dy = UA * Math.cos(th) + FA * Math.cos(th + fl), bx = P.sx + twX(i);
    joint(bx + dx, P.sy + dy, i); handR(i, dx + JX - P.sx, dy + JY - P.sy);
  }
  // кисть в покое (смещение от плеча) — для поз, которые ведут руку из покоя (js/art-poses.js)
  const restOf = r => { const dx = UA * Math.sin(r[0]) + FA * Math.sin(r[0] + r[1]), dy = UA * Math.cos(r[0]) + FA * Math.cos(r[0] + r[1]); return [+dx.toFixed(2), +dy.toFixed(2)]; };
  const REST = [restOf(RA0), restOf(RA1)], RR = Math.hypot(REST[0][0], REST[0][1]);

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
  // S — доля фронтальности (0 профиль, 1 анфас/спина), LS — куда уходит ближний бок: −1 в ¾ к камере
  // (ближний бок назад по ходу), +1 в ¾ со спины; LZ — ближний к камере бок ниже на экране
  let X0 = 0, Y0 = 0, FC = 1, K = 1, S = 0, SY = 0, CR = 1, SR = 0, QX = 0, QY = 0, BACK = false, FRONT = false, LS = -1, LZ = 0;
  // ракурс ног (…L) и корпуса (FC, S, K, SY, LS, LZ) раздельно: ноги разворачиваются сразу, корпус — пружиной (полураспад VLAG),
  // сторона при развороте у корпуса — на TLAG позже; между тазом и плечами — смешение по высоте (VSPL — ракурсы различаются)
  let FCL = 1, SL = 0, KL2 = 1, SYL = 0, LSL = -1, LZL = 0, TWL = 0, VSPL = false;
  const B34 = 0.4, LEGW = 3.3;                      // базовый поворот ¾ к камере при ходьбе/работе боком
  const kOf = s => 1 - 0.82 * s * s;    // сжатие оси «вперёд» ~cos поворота
  // SHX/SHY — крен корпуса внутрь поворота (сдвиг на px высоты над тазом); P.hlat — таз и корпус вбок к опорной ноге
  let SHX = 0, SHY = 0;
  function pr(fx, y, lat) {
    lat += P.hlat;
    if (P.roll) { const h = P.hy - y; if (h > 0) lat += P.roll * Math.min(h, SHO); }   // крен корпуса к опорной ноге (голова — с плечами, не валится)
    let k = K, s = S, sy = SY, ls = LS, lz = LZ;
    if (VSPL) { const w = clamp((P.hy - y) / SHO, 0, 1); if (w < 1) { k = KL2 + (K - KL2) * w; s = SL + (S - SL) * w; sy = SYL + (SY - SYL) * w; ls = LSL + (LS - LSL) * w; lz = LZL + (LZ - LZL) * w; } }   // таз — как ноги, плечи — как корпус
    let X = FC * (fx * k + lat * s * ls), Y = y + fx * sy + lat * lz;
    if (SHX || SHY) { const h = P.hy - y; X += SHX * h; Y += SHY * h; }
    if (P.rot) { const dx = X - P.pvx, dy = Y - P.pvy; X = P.pvx + dx * CR - dy * SR; Y = P.pvy + dx * SR + dy * CR; }
    QX = X0 + X + P.ox; QY = Y0 + Y + P.oy;
  }
  // проекция ног: та же, что pr, но ось «вперёд» по земле своя (GFX, GFY; сбоку GLX, GLY). Без шага — как у pr (K, SY);
  // на ходу (вес WL) — единичный вектор хода на экране (|mx|·FC, vy): 1 px шага = 1 px пути тела в любом ракурсе
  // (одна формула с фазой шага: фаза идёт от пути по земле, без сжатия по ракурсу)
  let GFX = 1, GFY = 0, GLX = 0, GLY = 0, WL = 0;
  function lp(fx, y, lat) {
    let X = fx * GFX + lat * GLX, Y = y + fx * GFY + lat * GLY;
    if (P.rot) { const dx = X - P.pvx, dy = Y - P.pvy; X = P.pvx + dx * CR - dy * SR; Y = P.pvy + dx * SR + dy * CR; }
    QX = X0 + X + P.ox; QY = Y0 + Y + P.oy;
  }
  // разворот (TW — 0…1…0 за TURN): ось хода ног поворачивается по земле через камеру (лицом — вниз, спиной — вверх),
  // а не зеркалится мгновенно в момент смены стороны
  let TW = 0;
  function legAxes(vyv) {
    const w = WL, mx = Math.sqrt(Math.max(0, 1 - vyv * vyv));
    let hx = FCL * mx, hy = vyv;
    if (TWL > 0) { hx *= 1 - TWL; hy = hy * (1 - TWL) + TWL * (BACK ? -1 : 1); const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l; }
    GFX = lerp(FCL * KL2, hx, w); GFY = lerp(SYL, hy, w); GLX = FCL * SL * LSL; GLY = LZL;
  }
  function prL(fx, y, lat) { const f = FC; FC = FCL; pr(fx, y, lat); FC = f; }   // точка ноги (тазобедренный сустав) — сторона ног
  function M(g, fx, y, lat) { pr(fx, y, lat); g.moveTo(QX, QY); }
  function Ln(g, fx, y, lat) { pr(fx, y, lat); g.lineTo(QX, QY); }
  function ell(g, x, y, rx, ry, col, r) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, r || 0, 0, PI * 2); g.fill(); }
  // свет — один, сверху-слева в экране (не от facing): теневой серп на правой стороне эллипса,
  // k — доля полуоси до линии терминатора (чёткая граница, без градиента)
  function shadeEll(g, x, y, rx, ry, r, k, col, a) {
    g.globalAlpha = a; g.fillStyle = col; g.beginPath();
    g.ellipse(x, y, rx, ry, r || 0, -PI / 2, PI / 2); g.ellipse(x, y, rx * Math.abs(k), ry, r || 0, PI / 2, -PI / 2, k >= 0); g.fill(); g.globalAlpha = 1;   // k < 0 — терминатор за серединой
  }
  // холодный контровой от неба: дуга по верхне-левому краю эллипса; ночью почти гаснет
  // EMO — мимика текущей фигуры (разговор, js/talk.js): {brow, knit, smile, open, jaw, yaw}; null — нейтрально (рисунок как прежде).
  // DETN — крупный план не-полярника (≥2.2 экранных px на px рига): лицо на сфере, как у героя. DIRECTOR — постановщик разговора (o → правка позы)
  let EMO = null, DETN = false, DETF = false, DIRECTOR = null;
  let RIM = 0, LQ = false, VAR = false, POL = false, DET = false;   // POL — полярник (свой объём и лицо); DET — крупный план (≥2.8 экранных px на px рига): мелкие детали лица и ткани   // VAR — вариант облика героя (одна ступень тени на голове/мешке — бюджет операций как у прежнего)   // LQ — слабый пресет (QUALITY=low): 2 тона, без мягкого света, зерна и складок
  function rimEll(g, x, y, rx, ry, r, a0, a1) {
    if (RIM < 0.03) return;
    g.globalAlpha = RIM; g.strokeStyle = C('#dde6ee'); g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, rx - 0.5, ry - 0.5, r || 0, a0, a1); g.stroke(); g.globalAlpha = 1;
  }

  // ---------- позы ----------
  // стопа бега и хромоты (ходьба — gait() ниже, по клиническим кривым): опора — линейно назад (+St → −St за долю цикла duty), перенос — плавно вперёд с подъёмом.
  // u = 0 — стопа впереди (как sin(ph) = 1 в старой синусоиде), так что руки и корпус не меняются.
  // duty < 0.5 — фаза полёта (быстрый шаг/бег): обе стопы в воздухе. [3] — 1 опора / 0 перенос, [4] — доля переноса 0..1
  // GT — походка текущей фигуры {St, duty} от рендера (o.gait): та же, по которой шла фаза, — стопа в опоре проходит ровно путь тела
  let GT = null;
  function foot(ph, St, lift, off) {
    const D = GT ? GT.duty : 0.5, u = ((ph - PI / 2) / (2 * PI) + off) % 1, v = u < 0 ? u + 1 : u;
    if (v < D) return [St * (1 - 2 * v / D), 0, 0.1 * Math.sin(ph + off * 2 * PI), 1, 0, v / D];
    const q = (v - D) / (1 - D), e = q * q * (3 - 2 * q), sw = Math.sin(e * PI);   // подъём мягко с места (колено не щёлкает на отрыве)
    return [-St + 2 * St * e, sw * lift, -sw * 0.35, 0, q, 0];
  }
  // этап 4: вес — таз ниже всего чуть после постановки (приём веса), выше над опорной ногой; вбок — к опорной ноге (с запаздыванием);
  // TIRE — усталость/холод 0..1 (ниже, короче мах рук, руки ближе); BRV — вдох −1..1 текущей фигуры (из памяти)
  let TIRE = 0, BRV = null;
  // таз при шаге с полётом: в опоре — по дуге вокруг стопы (расстояние таз–стопа постоянно, колено не «щёлкает»
  // за короткую опору), в полёте — плавно между краями дуги с небольшим подскоком
  // считается на экране (длина ноги своя), возвращается в «сырой» шкале таза (hipY — обратно)
  const LC = 0.946 * (TH + SHN), unHip = d => -2 + (d + 2) / KL;
  function hipArc(ph, St, a, b) {
    const s0 = a[3] === 1 ? a : b[3] === 1 ? b : null, edge = -2 - Math.sqrt(LC * LC - St * St);
    if (s0) { const dx = s0[0]; return unHip(-2 - Math.sqrt(Math.max(0, LC * LC - dx * dx))); }
    const D = GT ? GT.duty : 0.5, u = ((ph - PI / 2) / (2 * PI)) % 1, v = (u < 0 ? u + 1 : u) % 0.5, fp = clamp((v - D) / Math.max(0.01, 0.5 - D), 0, 1);
    return unHip(edge - 0.6 * Math.sin(PI * fp));
  }
  // ---------- шаг по клиническим кривым (Winter 1991, Perry 1992) ----------
  // % цикла через 5 % (0 — постановка пятки, 60 — отрыв носка, 100 — постановка): колено — сгиб, бедро — от вертикали (+ вперёд),
  // стопа — к полу (+ носок вверх). Опора колена чуть ровнее нормы (≤ 2 SD): у фигуры одна опора на шаг, таз над ней не проваливается.
  const GKN = [4, 10, 16, 19, 18, 17, 16, 15, 15, 16, 19, 22, 26, 46, 60, 60, 52, 38, 20, 7, 4];
  const GTH = [22, 21, 20, 17, 14, 10, 6, 2, -2, -6, -10, -13, -12, -6, 2, 10, 17, 21, 23, 23, 22];
  const GFT = [18, 6, 0, 0, 0, 0, 0, -1, -4, -8, -15, -28, -44, -34, -15, -6, -2, 3, 8, 14, 18];
  // голеностоп (тыльное сгибание +): в переносе стопа висит от голени — к полу она носком вниз, пока голень отклонена назад
  const GAN = [0, -5, -4, 0, 4, 6, 8, 9, 10, 9, 5, -4, -14, -16, -10, -6, -2, -1, 0, 0, 0];
  const DEG = PI / 180;
  // Катмулл–Ром по циклу (без изломов скорости на узлах)
  function cr(T, pc) {
    const x = ((pc % 100) + 100) % 100 / 5, i = Math.floor(x), f = x - i, p0 = T[(i + 19) % 20], p1 = T[i % 20], p2 = T[(i + 1) % 20], p3 = T[(i + 2) % 20];
    return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
  }
  // перекат стопы (fa > 0 — носок вниз): носок стоит — щиколотка вперёд-вверх (отталкивание); пятка стоит — щиколотка назад (удар пяткой)
  let RX = 0, RY = 0;
  function roll(fa) {
    if (fa >= 0) { RX = 3.1 - 3.1 * Math.cos(fa); RY = -3.1 * Math.sin(fa); }
    else { RX = Math.min(0, -0.8 + 0.8 * Math.cos(fa) + 1.9 * Math.sin(fa)); RY = Math.min(0, 1.9 + 0.8 * Math.sin(fa) - 1.9 * Math.cos(fa)); }   // пятка (−0.8, 1.9) от щиколотки
  }
  // длина ноги таз–щиколотка при сгибе колена k (град)
  const legD = k => Math.sqrt(TH * TH + SHN * SHN + 2 * TH * SHN * Math.cos(k * DEG));
  const GOFF = -1.2, FHOP = 0.25;   // путь стопы чуть сзади таза: вперёд короче (нога почти прямая на ударе), назад длиннее (толчок с носка)
  // таз (экранная шкала рига) над опорной стопой в доле опоры s: колено по кривой, стопа по перекату
  // ox, oy — сдвиг тазобедренного сустава этой ноги от центра таза (скрут, наклон таза): у почти прямой ноги 0.1 px — это 5° колена
  function hipSt(s, St, ox, oy) {
    const fa = -cr(GFT, 60 * s) * DEG; roll(fa);
    const dx = St * (1 - 2 * s) + GOFF + RX - ox, d = legD(cr(GKN, 60 * s) + KB * Math.sin(PI * Math.min(1, s * 1.25)));
    return -2 + RY - oy - Math.sqrt(Math.max(0.5, d * d - dx * dx));
  }
  // KS — размах колена/бедра в переносе (1 — норма; глубокий снег — выше, усталость/холод — ниже);
  // KB — добавка сгиба колена в опоре, град (глубокий снег, усталость, пригнулся от ветра): таз ниже согласованно с коленом, а не сдвигом
  let KS = 1, KB = 0;
  function gait(ph, St, lift, ks, kb) {
    KS = ks != null ? ks : clamp((lift || 2.4) / 3.6, 0.6, 1.4); KB = (kb || 0) + 5 * TIRE;
    const D = GT ? GT.duty : 0.5, base = ((ph - PI / 2) / (2 * PI)) % 1, V = [0, 0];
    // вес над опорной ногой: таз вбок к ней, свободная сторона таза ниже (наклон таза), корпус чуть креном к опоре
    const fl = GT ? clamp((0.5 - GT.duty) / 0.25, 0, 1) : 0, ob = -Math.cos(ph - 0.25);
    P.hlat = 0.7 * (1 - 0.4 * fl) * ob; P.ob = ob; P.roll = 0.035 * ob;
    // скрут: таз вперёд ближним боком с выносом ближней ноги, плечи — навстречу (ведут руки)
    const sn = Math.sin(ph - 0.35); P.prot = 0.09 * sn; P.tw = -0.13 * sn;
    const OX = [P.prot * LEGW, -P.prot * LEGW], OY = [-0.3 * ob, 0.3 * ob];
    let hip = -1e9, any = false;
    for (let i = 0; i < 2; i++) { let v = (base + 0.5 * i) % 1; if (v < 0) v += 1; V[i] = v; if (v < D) { hip = Math.max(hip, hipSt(v / D, St, OX[i], OY[i])); any = true; } }
    if (!any) {   // полёт (быстрый шаг): таз плавно от отрыва к постановке, подлёт — нога в конце переноса не чертит снег
      const i = V[0] % 1 < 0.5 ? 0 : 1, v = V[0] % 0.5, f = clamp((v - D) / Math.max(0.01, 0.5 - D), 0, 1);
      hip = lerp(hipSt(1, St, OX[i], OY[i]), hipSt(0, St, OX[1 - i], OY[1 - i]), sm(f)) - FHOP * Math.sin(PI * f);
    }
    const h0 = hipSt(1, St, 0, 0), h1 = hipSt(0, St, 0, 0);   // таз в момент отрыва и постановки (концы переноса)
    for (let i = 0; i < 2; i++) {
      const v = V[i]; let x, y, fa, st, q, u, rx = 0;
      if (v < D) {
        const s = v / D; fa = -cr(GFT, 60 * s) * DEG; roll(fa);
        x = St * (1 - 2 * s) + GOFF; y = -2 + RY; rx = RX; st = 1; q = 0; u = s;
      } else {
        q = (v - D) / (1 - D); const pc = 60 + 40 * q;
        // перенос — прямая кинематика от кривых бедра и колена (размах KS сверх линии концов), концы стыкуются с опорой
        const ex = (T, a) => { const e0 = cr(T, 60), e1 = cr(T, 100), l = lerp(e0, e1, q); return l + (cr(T, pc) - l) * a; };
        const th = ex(GTH, 0.5 + 0.5 * KS) * DEG, kn = ex(GKN, KS) * DEG;
        const fk = (t, k, hy) => [TH * Math.sin(t) + SHN * Math.sin(t - k), hy + TH * Math.cos(t) + SHN * Math.cos(t - k)];
        const a = fk(cr(GTH, 60) * DEG, cr(GKN, 60) * DEG, h0), b = fk(cr(GTH, 100) * DEG, cr(GKN, 100) * DEG, h1), c = fk(th, kn, hip);
        roll(-cr(GFT, 60) * DEG); const ax = -St + GOFF + RX, ay = -2 + RY; roll(-cr(GFT, 0) * DEG); const bx = St + GOFF + RX, by = -2 + RY;
        const e = sm(q);
        x = c[0] + lerp(ax - a[0], bx - b[0], e); y = c[1] + lerp(ay - a[1], by - b[1], e);
        y = Math.min(y, -2 - 0.7 * Math.sin(PI * Math.min(1, q / 0.8)) * Math.min(1, KS));   // носок не чертит снег (к постановке — пятка вниз, зазор уходит)
        // стопа от голени (голеностоп по кривой), сразу после отрыва — плавно из положения толчка
        const sh = th - kn;
        fa = lerp(-cr(GFT, 60) * DEG, -(sh + cr(GAN, pc) * DEG), sm(q / 0.3)); st = 0; u = 0;
      }
      if (i) { P.f1x = x; P.f1y = y; P.f1a = fa; P.st1 = st; P.q1 = q; P.u1 = u; P.rx1 = rx; }
      else { P.f0x = x; P.f0y = y; P.f0a = fa; P.st0 = st; P.q0 = q; P.u0 = u; P.rx0 = rx; }
    }
    P.hy = unHip(hip);
    P.hb = 0.8 * Math.cos(2 * ph + 0.9);
  }
  function idle(o, t) {
    const br = BRV != null ? BRV : Math.sin(t * 1.9 + (o.seed || 0));
    P.br = br; P.hy = -17.2 + br * 0.08; P.lean = 0.03 + br * 0.008 + 0.05 * TIRE; shoulder();
    armFK(0, RA0[0] + br * 0.012, RA0[1]); armFK(1, RA1[0], RA1[1]);
    P.tilt = 0.07 * Math.sin(t * 0.6 + (o.seed || 0));
    P.hb = br * 0.25;
  }
  // походка по скорости v (px/с, мир = экран): полушаг опоры St (px по земле) и доля опоры duty.
  // Частота шагов = v·duty / St: 30 px/с ≈ 2 шаг/с (как у человека), 165 px/с ≈ 4.8 (с фазой полёта — иначе стопы скользили бы).
  // vy — ракурс хода: к камере/от камеры шаг на 28 % короче (стопа впереди уходит вниз по экрану 1:1 с глубиной — длинная нога-«ходуля»)
  function gaitFor(anim, v, vy) {
    v = Math.max(0, v || 0); const kv = 1 - 0.28 * clamp(vy || 0, -1, 1) ** 2;
    if (anim === 'run') return { St: 8.6 * kv, duty: clamp(0.36 - (v - 120) / 400, 0.22, 0.36), v };
    if (anim === 'limp') return { St: clamp(2.6 + 0.04 * v, 3.3, 5) * kv, duty: 0.5, v };
    // ходьба: полушаг опоры ≈ 0.2 роста (на ударе пяткой нога почти прямая), доля опоры 0.62 (двойная опора, как у человека) на медленном шаге →
    // 0.27 на скорости героя (165 px/с ≈ 4 роста/с — человеку это бег): без проскальзывания стоп иначе ≈ 10 шагов/с; так ≈ 4.8 шаг/с
    const St = Math.min(9.2, 5.5 + 0.12 * v) * kv * (anim === 'trudge' ? 0.88 : 1);   // глубокий снег — шаг короче
    return { St, duty: clamp(0.62 - (v - 30) * 0.35 / 128, 0.27, 0.62), v };
  }
  // приращение фазы за путь d (px по земле): опора — 2·St за 2π·duty фазы
  const advance = (d, gt) => d * PI * gt.duty / Math.max(0.5, gt.St);
  // полушаг (длина опоры) по виду походки — его же берёт рендер, чтобы фаза шла от пройденного пути
  function stride(anim, sp) { if (GT) return GT.St; return anim === 'run' ? 7 : anim === 'limp' ? 3.3 : 4.5 + clamp(sp, 0, 1) * 3.5; }
  // мах рук на шаге: q — фаза (ближняя рука вперёд при sin q < 0), A — ход плеча (рад), f0 — сгиб локтя сзади, fA — прибавка сгиба на махе вперёд
  // r — доля бега 0..1 (runW): руки смешиваются с беговыми — плечо вперёд ≤ RF, назад RB (назад больше), локоть ≈80–95° всё время
  // (на махе вперёд чуть закрыт — кисть у груди, не у подбородка; сзади чуть открыт), кисть впереди — к середине корпуса; k — размах бега
  const RF = 0.5, RBK = 0.78, RFL = 1.5;
  function swingArms(q, A, f0, fA, b, r, k) {
    r = r || 0; k = k == null ? 1 : k;
    for (let i = 0; i < 2; i++) {
      const s = (i ? 1 : -1) * Math.sin(q), se = (i ? 1 : -1) * Math.sin(q - 0.45);
      let th = (b || 0.02) + A * (s > 0 ? s : 0.72 * s), fl = f0 + fA * Math.max(0, se) ** 1.3;
      if (r > 0) {
        th = lerp(th, 0.03 + k * (s > 0 ? RF * s : RBK * s), r); fl = lerp(fl, RFL - 0.12 * se, r);
        const hl = 6.6 - 1.3 * k * Math.max(0, s); if (i) P.hl1 = lerp(P.hl1, hl, r); else P.hl0 = lerp(P.hl0, hl, r);
      }
      armFK(i, th, fl);
    }
  }
  // доля бега по скорости походки: до ≈75 px/с — шаг, от ≈150 px/с — лёгкий бег (герой 165 px/с ≈ 7 м/с); совпадает с появлением полёта в gaitFor
  const runW = () => (GT ? sm(clamp((GT.v - 75) / 75, 0, 1)) : 0);
  function walk(o, t, ph, sp) {
    const St = stride('walk', sp), fl = GT ? clamp((0.5 - GT.duty) / 0.22, 0, 1) : 0;   // fl — доля «широкого шага с полётом»
    const Tr = TIRE;
    gait(ph, St, 0, 1 - 0.25 * Tr);
    // корпус клюёт ±1.7° дважды за цикл (толчок/приём веса); голова держит взгляд — гасит ¾ этого кивка
    const nod = 0.03 * Math.cos(2 * ph - 0.6);
    const r = runW();
    P.lean = 0.07 + sp * 0.06 + fl * 0.05 + 0.03 * r + 0.08 * Tr + nod; shoulder();   // на бегу — ещё чуть вперёд
    // руки — маятник от плеча в противофазе ногам, с запаздыванием: вперёд ≈20° (больше, чем назад ≈15°), локоть на махе вперёд
    // сгибается до ≈35°, сзади почти прямой; сгиб чуть отстаёт от плеча (предплечье догоняет). На скорости — руки бега (r)
    swingArms(ph - 0.35, (0.3 + 0.1 * sp + 0.05 * fl) * (1 - 0.45 * Tr), 0.2 + 0.08 * fl + 0.12 * Tr, (0.27 + 0.1 * sp + 0.1 * fl) * (1 - 0.35 * Tr), 0.02, r, 1 - 0.35 * Tr);
    if (Tr) { P.hl0 = P.hl1 = 6.6 - 1.2 * Tr; }
    P.tilt = 0.01 * Math.sin(2 * ph) - 0.75 * nod + 0.14 * Tr;
  }
  function run(o, t, ph) {
    const St = stride('run'), s0 = Math.sin(ph - 0.25), a = foot(ph, St, 5.2, 0), b = foot(ph, St, 5.2, 0.5);
    P.f0x = a[0] + 1.5; P.f0y = -2 - a[1]; P.f0a = a[2] * 1.4; P.st0 = a[3]; P.q0 = a[4];
    P.f1x = b[0] + 1.5; P.f1y = -2 - b[1]; P.f1a = b[2] * 1.4; P.st1 = b[3]; P.q1 = b[4];
    P.hy = hipArc(ph, St, a, b) + 0.6; P.hx = 1.2; P.hlat = -0.4 * Math.cos(ph - 0.25);   // таз по дуге над опорой, в полёте — подскок
    P.lean = 0.26 + 0.03 * Math.cos(2 * ph - 0.6); shoulder();
    swingArms(ph - 0.25, 0, 0, 0, 0, 1);   // бег: локоть ≈80–95°, плечо вперёд ≤ 30°, назад ≈45°
    P.hb = 1.4 * Math.cos(2 * ph + 0.9); P.tilt = -0.12;
  }
  function limp(o, t, ph) {
    const s0 = Math.sin(ph), c0 = Math.cos(ph), load = Math.max(0, -c0);   // вес на больной (ближней) ноге
    const Sl = GT ? GT.St : 3.3, a = foot(ph, Sl * 0.97, 0.7, 0), b = foot(ph, Sl * 1.03, 3.2, 0.5);
    P.f0x = a[0] + 0.6; P.f0y = -2 - a[1]; P.f0a = 0.12; P.st0 = a[3]; P.q0 = a[4];   // волочит
    P.f1x = b[0] - 0.4; P.f1y = -2 - b[1]; P.f1a = b[2]; P.st1 = b[3]; P.q1 = b[4];
    P.hy = -17 + load * 1.9 - Math.max(0, c0) * 0.3; P.lean = 0.12 + load * 0.14; shoulder();
    P.h0x = P.hx + 2.6; P.h0y = hipD() + 5 + load; P.hl0 = 4.5;               // ладонь на бедре
    armFK(1, 0.02 + 0.3 * s0 * (s0 > 0 ? 1 : 0.72), 0.22 + 0.3 * Math.max(0, s0));
    P.tilt = 0.12 + load * 0.08; P.hb = load * 0.9;
  }
  function chop(o, t, a) {
    // удар в a = 0.52 (Hero IMPACT.chop — урон по дереву): опускание 0.37→0.52 (≈0.135 с), стоп-кадр ≈50 мс, отдача, возврат
    const REST = 0.95, UP = -2.45, HIT = 0.72, R = 11;
    let b;
    if (a < 0.37) b = lerp(REST, UP, sm(a / 0.37));
    else if (a < 0.52) { const e = (a - 0.37) / 0.15; b = lerp(UP, HIT, Math.pow(e, 1.8)); }
    else if (a < 0.575) b = HIT + 0.015 * Math.sin((a - 0.52) * 400);   // топор в стволе
    else if (a < 0.68) { const e = (a - 0.575) / 0.105; b = HIT - 0.2 * Math.sin(e * PI * 2) * (1 - e); }
    else b = lerp(HIT, REST, sm((a - 0.68) / 0.32));
    const w = clamp((REST - b) / (REST - UP), 0, 1), imp = a < 0.5 ? 0 : a < 0.53 ? sm((a - 0.5) / 0.03) : 1 - sm((a - 0.575) / 0.14);
    P.f0x = 4.5; P.f1x = -3.8; P.f1a = -0.1;
    P.lean = lerp(0.36, -0.14, w) + 0.045 * imp; P.hy = -16.8 + (1 - w) * 1.3 + 0.3 * imp; shoulder();   // корпус «проваливается» за ударом
    handA(0, b, R); P.hl0 = P.hl1 = 1.5;
    P.tk = 'axe'; P.ta = b + 0.1; P.two = 1; P.gap = -3.6;
    P.tilt = lerp(0.25, -0.2, w) + 0.05 * imp; P.hb = 0.6 * imp;
    if (a >= 0.37 && a < 0.53) P.trail = [lerp(UP, b, 0.35), b, R + 17];
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
    P.tk = 'pole'; P.ta = PI / 2 - 0.1; P.two = 1; P.gap = FRONT ? -3.4 : -5.5; P.tilt = 0.3;   // в анфас верхняя кисть ниже, не у рта
    if (a >= 0.52 && a < 0.6) P.spark = 1;
  }
  function fish(o, t, bite) {
    P.prop = 'box'; P.hx = -1.5; P.hy = -9.8; P.f0x = 6.8; P.f0y = -2; P.f1x = 5.2; P.f1y = -2;
    if (!bite) {
      const br = Math.sin(t * 1.7); P.lean = 0.28 + br * 0.015; shoulder();
      const jig = Math.pow(Math.max(0, Math.sin(t * 3.6)), 6) * 0.35;
      P.h0x = P.sx + 7.2; P.h0y = P.sy + 7.5 - jig * 3; P.ta = 0.18 - jig;
      P.h1x = P.hx + 7; P.h1y = hipD() - 1.5; P.tilt = 0.2;
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
    // замах 0→0.34, удар 0.34→0.58 (≈0.11 с, разгон без рывка), доводка; локоть согнут (кисть 10.8 от плеча)
    const UP = -1.9, A1 = 0.34, A2 = 0.58, R = lerp(12.2, 10.8, sm(a / A1));   // локоть сгибается по ходу замаха, а не рывком со старта
    let b;
    if (a < A1) b = lerp(1, UP, sm(a / A1));
    else if (a < A2) { const e = (a - A1) / (A2 - A1); b = lerp(UP, 1.15, Math.pow(e, 1.4)); }
    else b = lerp(1.15, 1, sm((a - A2) / (1 - A2)));
    const st = seg(a, A1, A2), rec = 1 - seg(a, 0.6, 1);
    P.f0x = lerp(1.3, 6, st * rec + (1 - rec) * 0); P.f1x = -3;
    P.lean = lerp(-0.15, 0.4, st) * (a < A1 ? sm(a / A1) : 1) * (0.3 + 0.7 * rec) + 0.04; shoulder();
    handA(0, b, R); handR(1, -4.5 + 2 * st, 9); P.hl0 = 5;
    P.tk = tool === 'torch' ? 'torch' : tool === 'saw' ? 'saw' : 'axe'; P.ta = b + 0.15;
    if (a >= A1 && a < A2 + 0.03) P.trail = [UP, b, R + (P.tk === 'axe' ? 17 : 12)];
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
    handR(0, REST[0][0] + 2.6 * kb, REST[0][1] - 10.6 * kb); handR(1, REST[1][0] - 3 * kb, REST[1][1] - 7.8 * kb);
    P.tilt = -0.4 * kb; P.eyes = kb > 0.3 ? 1 : 0; P.mouth = kb * 0.8;
    P.ox = Math.sin(t * 90) * 1.3 * (1 - seg(a, 0, 0.4));
    P.hb = -kb * 1.5;
  }
  function dead(o, t, a) {
    const e = sm(a / 0.55), bn = a > 0.55 && a < 0.78 ? Math.sin(seg(a, 0.55, 0.78) * PI) * 0.1 : 0;
    P.lean = -0.06 * e; P.f0x = lerp(2.2, 0.6, e); P.f1x = lerp(-1.4, -0.4, e); P.f0y = P.f1y = -2 + 0.5 * e; P.f0a = P.f1a = -0.5 * e; shoulder();
    handR(0, lerp(REST[0][0], -3, e), lerp(REST[0][1], -6, e)); handR(1, lerp(REST[1][0], 5, e), lerp(REST[1][1], 3, e));
    P.tilt = -0.3 * e; P.eyes = e > 0.85 ? 2 : 1;
    P.rot = -FC * (PI / 2 * e - bn); P.pvx = 0; P.pvy = -19.8;
    P.oy = 15.3 * e; P.ox = -FC * 2 * e;
  }
  function talk(o, t, staffy) {
    idle(o, t);
    const gt = t * 2.3, i = staffy ? 1 : 0;
    handR(i, 6 + 2.5 * Math.sin(gt), 6 + 3 * Math.cos(gt * 1.3)); if (i) P.hl1 = 5; else P.hl0 = 5;
    if (!staffy) armFK(1, 0.08 + 0.06 * Math.sin(gt * 0.7 + 1), 0.45 + 0.25 * Math.sin(gt * 1.1));
    P.tilt = 0.08 * Math.sin(t * 5); P.mouth = Math.sin(t * 14) > 0 ? 0.9 : 0.25;
    P.lean = 0.06 + 0.03 * Math.sin(t * 1.1); shoulder();
  }
  function wave(o, t) {
    idle(o, t);
    P.lean = 0.02 + 0.015 * Math.sin(t * 9); shoulder();
    handR(0, 4.5 + 3.4 * Math.sin(t * 9), -10.5); P.hl0 = 7.5; P.tilt = -0.05; P.mouth = 0.4;
  }

  const LOCO = { idle: 1, walk: 1, run: 1, limp: 1, carry: 1, talk: 1, wave: 1, hurt: 1 };
  // дополнительные позы (js/art-poses.js): register(name, {fn(o, t, a, ph, sp, H), dur?, loop?, loco?, free?})
  // loco — ходьба (виды спереди/сзади и поворот как у walk); free — руки свободны (инструмент в руке/за спиной как у idle)
  const POSE = {};
  const isLoco = a => LOCO[a] || (POSE[a] && POSE[a].loco);
  // лёжа/сидя на реквизите — всегда боком (o.vy не влияет); остальные позы разворачиваются к цели (спина/анфас)
  const SAG = { sleep: 1, dead: 1, sit: 1, rest: 1, fish: 1, fishBite: 1 };
  const isSag = a => SAG[a] || (POSE[a] && POSE[a].sag);

  // словарь C (js/style.js): фигура рисуется через Style.figure — роли, контур силуэта, ореол; тень — по правилу в GFX (shadowsC)
  const SCs = () => typeof Style !== 'undefined' && Style.flat;   // плоский C — только в режиме 'flat'
  let CFG = false, TRL = null;   // CFG — идёт рисунок фигуры C; TRL — дуга маха (линии скорости кладутся поверх, вне контура)
  // контактная тень стопы: кэшированное радиальное пятно
  let CONT = null;
  // SINK — фигура в снегу на столько px (gfx sunk): тени под ногами не рисуем — они под снегом (иначе серый клин у кромки)
  let SINK = 0;
  function cont(g, x, y, rx, ry, a) {
    if (CFG || SINK > 2.5) return;
    if (CONT === null) {
      CONT = false;
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas'); c.width = c.height = 32; const x2 = c.getContext('2d');
        const gr = x2.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, 'rgba(22,32,46,1)'); gr.addColorStop(0.35, 'rgba(22,32,46,0.6)'); gr.addColorStop(0.7, 'rgba(22,32,46,0.16)'); gr.addColorStop(1, 'rgba(22,32,46,0)');
        x2.fillStyle = gr; x2.fillRect(0, 0, 32, 32); CONT = c;
      }
    }
    if (!CONT) { g.globalAlpha = a * 0.6; ell(g, x, y, rx * 0.6, ry * 0.6, '#16202e'); g.globalAlpha = 1; return; }
    g.globalAlpha = a; g.drawImage(CONT, x - rx, y - ry, rx * 2, ry * 2); g.globalAlpha = 1;
  }
  // ---------- кэш тени ----------
  let SHIMG = null;
  function shadow(g, x, y, w, h) {
    if (CFG || SINK > 2.5) return;
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
  let TX = 0, TY = 0, TC_ = 1, TS = 0, TL = 0, TQ = 1;
  function tp(u, v) { u *= TQ; pr(TX + u * TC_ - v * TS, TY + u * TS + v * TC_, TL); }
  function tM(g, u, v) { tp(u, v); g.moveTo(QX, QY); }
  function tL(g, u, v) { tp(u, v); g.lineTo(QX, QY); }
  function drawTool(g, kind, ox, oy, ang, lat, o, env) {
    TQ = kind === P.tk ? P.tsc : 1;   // укорочение вдоль топорища (поворот вглубь кадра)
    TX = ox; TY = oy; TC_ = Math.cos(ang); TS = Math.sin(ang); TL = lat;
    const W = '#67482f';
    if (kind === 'axe') {
      g.strokeStyle = C(W); g.lineWidth = 2.2; g.beginPath(); tM(g, -5, 0); tL(g, 16, 0); g.stroke();
      g.fillStyle = C('#919dac'); g.beginPath(); tM(g, 11.5, -2.2); tL(g, 16, -2.2); tL(g, 18.6, 6); tL(g, 10.5, 5.6); tL(g, 12.6, 1.5); g.closePath(); g.fill();
      g.strokeStyle = '#dde6ee'; g.lineWidth = 1; g.beginPath(); tM(g, 18.4, 5.6); tL(g, 10.8, 5.2); g.stroke();
    } else if (kind === 'stick') {   // палка
      g.strokeStyle = C('#5a3d22'); g.lineWidth = 1.4; g.beginPath(); tM(g, -6, 0); tL(g, 9, 0); g.stroke();
    } else if (kind === 'knife') {   // нож: рукоять, клинок
      g.strokeStyle = C('#3a2618'); g.lineWidth = 1.6; g.beginPath(); tM(g, -1.5, 0); tL(g, 2, 0); g.stroke();
      g.fillStyle = C('#c2c9d0'); g.beginPath(); tM(g, 2, -0.7); tL(g, 6.8, -0.2); tL(g, 2, 0.8); g.closePath(); g.fill();
    } else if (kind === 'chunkE') {   // чурка поперёк (вбок от взгляда): в ¾ — короткое полено, ближний торец светлый
      tp(0, 0); const c = [[QX, QY]]; logsX(g, c, [[QX - 1, QY + CHR], [QX + 1, QY + CHR]]);
    } else if (kind === 'chunk') {   // чурка с разделки: короткий толстый кругляк, светлый торец
      g.lineCap = 'butt'; g.strokeStyle = C('#5b3d27'); g.lineWidth = 5; g.beginPath(); tM(g, -2.6, 0); tL(g, 2.4, 0); g.stroke();
      g.strokeStyle = C('#765436'); g.lineWidth = 2; g.beginPath(); tM(g, -2.6, -1.2); tL(g, 2.4, -1.2); g.stroke(); g.lineCap = 'round';
      tp(2.4, 0); ell(g, QX, QY, 1.5, 2.5, C('#e0b47a')); ell(g, QX, QY, 0.6, 1, C('#c79a62'));
    } else if (kind === 'shovel') {   // лопата (взял у двери): черенок, деревянный совок на конце
      g.strokeStyle = C(W); g.lineWidth = 2; g.beginPath(); tM(g, -6, 0); tL(g, 14, 0); g.stroke();
      g.fillStyle = C('#76593a'); g.beginPath(); tM(g, 13, -3.2); tL(g, 20, -3.8); tL(g, 20.5, 3.8); tL(g, 13, 3.2); g.closePath(); g.fill();
      // ком снега на совке (P.held[4] — кг, позы лопаты js/art-poses.js): размер от веса, тень снизу
      const kg = P.held && P.held[0] === 'shovel' ? P.held[4] || 0 : 0;
      if (kg > 0.2) { const r = 1.6 + 0.42 * kg; tp(16.8, -2.4 - r * 0.55); ell(g, QX, QY + 0.5, r * 1.25, r * 0.75, '#c9d6e2'); ell(g, QX, QY - 0.2, r * 1.15, r * 0.7, '#f4f7fa'); ell(g, QX - r * 0.35, QY - r * 0.35, r * 0.5, r * 0.28, '#ffffff'); }
      if (HERO) { const S = DBG.sh || (DBG.sh = { b: [0, 0], g0: [0, 0], g1: [0, 0], t: 0, ux: 1 }); tp(17, 0); S.b[0] = QX; S.b[1] = QY; tp(-5, 0); S.g0[0] = QX; S.g0[1] = QY; tp(4.5, 0); S.g1[0] = QX; S.g1[1] = QY; S.ux = Math.sign(S.b[0] - S.g0[0]) || 1; S.t = typeof now === 'number' ? now : 0; }   // совок и хваты на экране (снег у совка, проверки)
    } else if (kind === 'log') {   // полено в руках (печь)
      g.strokeStyle = C('#765436'); g.lineWidth = 3.6; g.beginPath(); tM(g, -3, 0); tL(g, 6, 0); g.stroke();
      tp(6, 0); ell(g, QX, QY, 1.7, 1.7, C('#c79a62'));
    } else if (kind === 'paper') {   // лист (записка): светлый прямоугольник, строки — тёмные штрихи; u — вдоль листа, v — поперёк
      g.fillStyle = C('#e4dcc4'); g.beginPath(); tM(g, -4.4, -3.2); tL(g, 4.6, -3.5); tL(g, 4.8, 3.3); tL(g, -4.2, 3.6); g.closePath(); g.fill();
      g.strokeStyle = C('#b3a88c'); g.lineWidth = 0.4; g.beginPath(); tM(g, 4.6, -3.5); tL(g, 4.8, 3.3); g.stroke();
      g.strokeStyle = C('#6f6553'); g.lineWidth = 0.5; g.beginPath(); for (const v of [-1.6, -0.2, 1.2]) { tM(g, -3.2, v); tL(g, 3.4, v - 0.1); } g.stroke();
    } else if (kind === 'can' || kind === 'canE') {   // банка тушёнки (canE — пустая, без крышки)
      g.fillStyle = C('#8f9399'); g.beginPath(); tM(g, -3.19, -2.75); tL(g, 3.19, -2.75); tL(g, 3.19, 2.75); tL(g, -3.19, 2.75); g.closePath(); g.fill();
      g.fillStyle = C('#b8392d'); g.beginPath(); tM(g, -1.74, -2.83); tL(g, 1.74, -2.83); tL(g, 1.74, 2.83); tL(g, -1.74, 2.83); g.closePath(); g.fill();
      tp(-3.19, 0); ell(g, QX, QY, 1.74, 2.75, C(kind === 'can' ? '#c2c9d0' : '#3a2618'));
    } else if (kind === 'bowl') {   // миска ухи
      g.fillStyle = C('#5b3d27'); g.beginPath(); tM(g, -4.06, -1.74); tL(g, 4.06, -1.74); tL(g, 2.61, 2.32); tL(g, -2.61, 2.32); g.closePath(); g.fill();
      tp(0, -1.74); ell(g, QX, QY, 4.21, 1.3, C('#c79a62'));
    } else if (kind === 'jar') {   // банка мёда
      g.fillStyle = C('#d9a441'); g.beginPath(); tM(g, -2.9, -2.61); tL(g, 3.19, -2.61); tL(g, 3.19, 2.61); tL(g, -2.9, 2.61); g.closePath(); g.fill();
      tp(-3.19, 0); ell(g, QX, QY, 1.3, 2.75, C('#8a6a45'));
    } else if (kind === 'spoon') {
      g.strokeStyle = C('#c2c9d0'); g.lineWidth = 0.9; g.beginPath(); tM(g, -1.45, 0); tL(g, 7.25, 0); g.stroke();
      tp(8.12, 0); ell(g, QX, QY, 1.59, 1.16, C('#dde6ee'));
    } else if (kind === 'meat' || kind === 'dried' || kind === 'fish') {   // кусок / рыбина в руке
      if (kind === 'fish') { g.fillStyle = C('#8fa3ad'); g.beginPath(); tM(g, -5.51, 0); tL(g, 0, -2.32); tL(g, 4.35, -0.58); tL(g, 6.38, -2.03); tL(g, 6.09, 2.03); tL(g, 4.35, 0.58); tL(g, 0, 2.32); g.closePath(); g.fill(); }
      else { g.fillStyle = C(kind === 'dried' ? '#7c241c' : '#a8453a'); g.beginPath(); tM(g, -3.77, -2.03); tL(g, 3.48, -2.61); tL(g, 4.35, 1.45); tL(g, -3.19, 2.61); g.closePath(); g.fill(); tp(2.61, -0.29); ell(g, QX, QY, 1.3, 1.01, C('#e8d6c0')); }
    } else if (kind === 'tube') {   // радиолампа: стеклянная колба на цоколе
      tp(2.03, 0); ell(g, QX, QY, 2.9, 2.32, 'rgba(221,230,238,0.85)');
      g.fillStyle = C('#5d626b'); g.beginPath(); tM(g, -1.45, -1.74); tL(g, 0, -1.74); tL(g, 0, 1.74); tL(g, -1.45, 1.74); g.closePath(); g.fill();
    } else if (kind === 'amulet') {   // сэвэки: деревянная фигурка на шнурке
      g.strokeStyle = C('#3a2618'); g.lineWidth = 0.5; g.beginPath(); tM(g, -3.77, 0); tL(g, 0, 0); g.stroke();
      tp(2.32, 0); ell(g, QX, QY, 2.61, 1.89, C('#c79a62')); tp(4.64, 0); ell(g, QX, QY, 1.45, 1.45, C('#8a6a45'));
    } else if (kind === 'hare') {   // заяц за уши: тушка вниз по u
      g.fillStyle = C('#e6e9ee'); tp(1.74, 0); ell(g, QX, QY, 2.61, 1.01, C('#e6e9ee'));
      tp(7.83, 0); ell(g, QX, QY, 5.22, 3.33, C('#f2f4f7')); tp(12.47, 0.43); ell(g, QX, QY, 2.03, 2.03, C('#dde2e8'));
      tp(4.35, 1.3); ell(g, QX, QY, 0.51, 0.51, '#2a2018');
    } else if (kind === 'cup') {   // кружка чая: эмалированная, ручка, пар над ней
      g.fillStyle = C('#d8dde2'); g.beginPath(); tM(g, -2.2, -2.4); tL(g, 2.2, -2.4); tL(g, 2, 2.4); tL(g, -2, 2.4); g.closePath(); g.fill();
      g.fillStyle = C('#3f6f7a'); g.beginPath(); tM(g, -2.2, -0.2); tL(g, 2.15, -0.2); tL(g, 2.1, 0.7); tL(g, -2.15, 0.7); g.closePath(); g.fill();
      g.strokeStyle = C('#aeb6be'); g.lineWidth = 0.7; g.beginPath(); tp(2.4, -1.2); g.moveTo(QX, QY); tp(3.6, -0.2); const hx = QX, hy = QY; tp(2.3, 1.2); g.quadraticCurveTo(hx, hy, QX, QY); g.stroke();
      tp(-2.2, 0); ell(g, QX, QY, 0.9, 2.2, C('#6a4a2a'));
      const tt = o.t || 0; g.fillStyle = 'rgba(246,249,252,0.45)'; for (let i = 0; i < 2; i++) { const e = (tt * 0.8 + i * 0.5) % 1; tp(-3 - e * 5, Math.sin(tt * 3 + i) * 0.8); g.beginPath(); g.arc(QX, QY - e * 2, 0.7 + e * 1.2, 0, PI * 2); g.fill(); }
    } else if (kind === 'kero') {   // канистра: красная, ручка сверху, горловина
      g.fillStyle = C('#8a3a2e'); g.beginPath(); tM(g, -3.4, -2.6); tL(g, 3.4, -2.6); tL(g, 3.4, 2.8); tL(g, -3.4, 2.8); g.closePath(); g.fill();
      g.strokeStyle = C('#5e2a22'); g.lineWidth = 0.5; g.beginPath(); tM(g, -2.6, -2.2); tL(g, 2.6, 2.4); tM(g, 2.6, -2.2); tL(g, -2.6, 2.4); g.stroke();
      g.strokeStyle = C('#3a3a36'); g.lineWidth = 0.9; g.beginPath(); tM(g, -3.4, -1.2); tL(g, -4.6, -1.2); tL(g, -4.6, 1.4); tL(g, -3.4, 1.4); g.stroke();
      tp(-3.3, 2.1); ell(g, QX, QY, 0.7, 0.7, C('#c2c9d0'));
    } else if (kind === 'fur' || kind === 'furD' || kind === 'furG') {   // шкурка: свёрнутый мех, хвост
      const cf = kind === 'furD' ? '#5a3a24' : kind === 'furG' ? '#8a8a84' : '#e6e3dc', cd = kind === 'furD' ? '#3a2416' : kind === 'furG' ? '#5e5e58' : '#9c968a';
      tp(0.5, 0); ell(g, QX, QY, 4.4, 2.7, C(cd)); ell(g, QX - 0.2, QY - 0.2, 4, 2.3, C(cf)); tp(-0.4, 0.8); g.globalAlpha = 0.5; ell(g, QX, QY, 3, 1, C(cd)); g.globalAlpha = 1;
      g.strokeStyle = C(cd); g.lineWidth = 1.1; g.beginPath(); tM(g, 3.6, 0.4); tL(g, 6.2, 1.8); g.stroke();
    } else if (kind === 'coil') {   // моток кабеля/проволоки
      g.strokeStyle = C('#2e3440'); g.lineWidth = 0.9; for (let i = 0; i < 3; i++) { tp(0.4 + i * 0.45, 0); g.beginPath(); g.ellipse(QX, QY, 2.6, 2.2, 0, 0, PI * 2); g.stroke(); }
      g.strokeStyle = C('#5d626b'); g.lineWidth = 0.5; tp(1, 0); g.beginPath(); g.ellipse(QX, QY, 2.2, 1.8, 0, 0, PI * 2); g.stroke();
    } else if (kind === 'trap') {   // капкан: дуги и пружина
      g.strokeStyle = C('#4a4e56'); g.lineWidth = 0.9; tp(1, 0); g.beginPath(); g.ellipse(QX, QY, 3.2, 1.6, 0, 0, PI * 2); g.stroke();
      g.lineWidth = 0.7; g.beginPath(); tM(g, -2.2, 0); tL(g, -5.4, 0); g.stroke();
    } else if (kind === 'scrap') {   // кусок железа
      g.fillStyle = C('#6d737c'); g.beginPath(); tM(g, -3, -1.8); tL(g, 3.5, -2.4); tL(g, 2.6, 2.2); tL(g, -2.4, 1.6); g.closePath(); g.fill();
      g.fillStyle = C('#8a5a3a'); g.globalAlpha = 0.5; tp(0.6, 0.2); g.beginPath(); g.arc(QX, QY, 1, 0, PI * 2); g.fill(); g.globalAlpha = 1;
    } else if (kind === 'bundle') {   // свёрток: мешковина, бечёвка
      tp(0.4, 0); ell(g, QX, QY, 3.4, 2.6, C('#8c7f60'));
      g.strokeStyle = C('#4a3c2a'); g.lineWidth = 0.5; g.beginPath(); tM(g, 0.4, -2.6); tL(g, 0.4, 2.6); tM(g, -3, 0); tL(g, 3.8, 0); g.stroke();
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
    const nx = P.hx + Math.sin(P.lean) * (TORSO + P.bz), ny = P.hy - Math.cos(P.lean) * (TORSO + P.bz);
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
  // центр головы в координатах рига (после hipY): для поз (рот, глаза) и пара изо рта
  function headC() {
    const ang = P.lean + P.tilt, nx = P.hx + Math.sin(P.lean) * (TORSO + P.bz), ny = hipD() - Math.cos(P.lean) * (TORSO + P.bz);
    return [nx + Math.sin(ang) * HN, ny - Math.cos(ang) * HN, ang];
  }
  // мягкая тень по объёму: три серпа убывающей плотности (переход без чёткой границы, без градиента)
  function softShade(g, x, y, rx, ry, r, col, a) { if (LQ || VAR) { shadeEll(g, x, y, rx, ry, r, 0.2, col, Math.min(1, a * 2)); return; } shadeEll(g, x, y, rx, ry, r, 0.6, col, a); shadeEll(g, x, y, rx, ry, r, 0.1, col, a); shadeEll(g, x, y, rx, ry, r, -0.4, col, a); }
  // опушка капюшона: неровная ломаная вокруг проёма, тёмные ворсинки в тени (справа-снизу), иней сверху
  const RUF = [0.25, -0.3, 0.4, -0.1, 0.3, -0.4, 0.15, -0.25, 0.35, -0.2, 0.1, -0.35];
  // мех опушки — приглушённый, в тон капюшону (контраст к куртке небольшой); светлее только кончики ворса с солнечной стороны
  function ruff(g, L, fx, fy, rx, ry, hr, frost, bare) {
    const n = 12, c = Math.cos(hr), s = Math.sin(hr), at = (a, d) => { const ex = Math.cos(a) * (rx + d), ey = Math.sin(a) * (ry + d); QX = fx + ex * c - ey * s; QY = fy + ex * s + ey * c; };
    g.strokeStyle = C(L.ruff); g.lineWidth = 1.6; g.beginPath();
    for (let i = 0; i <= n; i++) { at(i / n * PI * 2, RUF[i % n] * 0.6); i ? g.lineTo(QX, QY) : g.moveTo(QX, QY); }
    g.stroke();
    if (LQ || bare) return;
    g.strokeStyle = C(L.ruffL); g.lineWidth = 0.7; g.globalAlpha = 0.55; g.beginPath();   // кончики ворса: сверху-слева, короткие штрихи наружу
    for (let i = 0; i < 5; i++) { const a = PI * (0.92 + 0.14 * i); at(a, 0.2); g.moveTo(QX, QY); at(a + 0.08, 0.95 + RUF[i] * 0.5); g.lineTo(QX, QY); }
    g.stroke(); g.globalAlpha = 1;
    if (frost > 0.3) {
      g.fillStyle = 'rgba(242,246,250,0.6)'; g.beginPath(); const k = Math.round(frost * 6);
      for (let i = 0; i < k; i++) { at(PI * (0.95 + 0.6 * i / k), 0.4 * ((i % 2) - 0.3)); g.moveTo(QX + 0.45, QY); g.arc(QX, QY, 0.45, 0, PI * 2); }
      g.fill();
    }
  }
  // меховой ворот полярника (откинутый капюшон): валик меха, ворс наружу — светлые кончики сверху-слева, тёмные снизу-справа
  const CF = [0.3, -0.2, 0.5, 0.1, -0.35, 0.25, -0.1, 0.4, -0.3, 0.15, 0.35, -0.25, 0.05, 0.45, -0.15, 0.2, -0.4, 0.3];
  function polCollar(g, L, x, y, rx, ry, r) {
    const c = Math.cos(r), s = Math.sin(r), at = (a, d) => { const ex = Math.cos(a) * (rx + d), ey = Math.sin(a) * (ry + d * 0.6); QX = x + ex * c - ey * s; QY = y + ex * s + ey * c; };
    g.strokeStyle = C(L.ruff); g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, rx, ry, r, PI * 0.92, PI * 2.08); g.stroke();   // мех — за шеей
    if (LQ) return;
    g.strokeStyle = C(L.dark); g.globalAlpha = 0.45; g.lineWidth = 0.7; g.beginPath(); g.ellipse(x, y + 0.9, rx - 0.6, ry - 0.2, r, PI * 0.1, PI * 0.9); g.stroke(); g.globalAlpha = 1;
    const n = CF.length;
    for (let k = 0; k < (DET ? 2 : 1); k++) {
      g.strokeStyle = C(k ? mix(L.ruff, '#2a2018', 0.5) : L.ruffL); g.lineWidth = k ? 0.7 : 0.6; g.globalAlpha = k ? 0.6 : 0.75; g.beginPath();
      for (let i = 0; i < n; i++) { const a = PI * (0.95 + 1.1 * (i + 0.5) / n), lit = a < PI * 1.55; if (lit === !!k) continue;
        at(a, -0.5); g.moveTo(QX, QY); at(a + CF[i] * 0.25, 0.9 + CF[(i + 5) % n]); g.lineTo(QX, QY); }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  function drawHead(g, o, L, vyv, env) {
    const s = S, back = BACK, [hx, hy, ang] = headC(), fwx = Math.cos(ang), fwy = Math.sin(ang), upx = Math.sin(ang), upy = -Math.cos(ang);
    const nx = P.hx + Math.sin(P.lean) * (TORSO + P.bz), ny = P.hy - Math.cos(P.lean) * (TORSO + P.bz);
    const hr = P.rot + FC * K * ang * 0.7;
    const P2 = (a, b) => { pr(hx + fwx * a + upx * b, hy + fwy * a + upy * b, 0); };
    const frost = o.frost || 0;
    // крупный план (DETN): у людей мира лицо на сфере, как у героя — в капюшоне и под шапкой
    if (DETN && !back && L.hood && !L.hoodDown) { hoodNpc(g, L, P2, hr, s, frost); return; }
    // капюшон: высота ≈7.4, ширина ≈7.8 (≈1/5.7 роста, 0.6 ширины плеч); лицо — тёмный проём с одной полосой кожи
    if (L.hood && !L.hoodDown) {
      // капюшон: купол и сужение к шее (не шар), мягкая тень по объёму
      P2(-0.5, 0.4); const kx = QX, ky = QY + P.hb * 0.4, RX = 3.9, RY = 3.5;
      P2(-0.3, -1.9); const lx = QX, ly = QY + P.hb * 0.4;
      g.fillStyle = C(L.hood); g.beginPath(); g.ellipse(kx, ky, RX, RY, hr, 0, PI * 2); g.moveTo(lx + 2.9, ly); g.ellipse(lx, ly, 2.9, 1.9, hr, 0, PI * 2); g.fill();
      softShade(g, kx, ky, RX, RY, hr, C(L.hoodD), 0.26);
      P2(-0.3, -2.6); g.globalAlpha = 0.3; ell(g, QX, QY + P.hb * 0.4, 3, 1.2, C(L.hoodD), hr); g.globalAlpha = 1;
      rimEll(g, kx, ky, RX, RY, hr, PI * 0.95, PI * 1.4);
      if (!back && L.openHood) {   // лицо в капюшоне видно: кожа, тень капюшона на лбу, черты; мех поверх края лица
        P2(1.9, -0.3); const fx = QX, fy = QY, rx = lerp(1.75, 2.15, s), ry = 2.25;
        ell(g, fx, fy, rx, ry, C(L.face), hr);
        g.globalAlpha = 0.4; ell(g, fx, fy - ry * 0.7, rx * 0.95, ry * 0.4, '#2a2018', hr); g.globalAlpha = 1;
        faceV(g, L, fx - FC * (1 - s) * 0.5, fy + 0.35, hr, s, frost);
        ruff(g, L, fx, fy, rx + 0.45, ry + 0.4, hr, frost);
      } else if (!back) {
        P2(2, -0.2); const fx = QX, fy = QY, rx = lerp(1.3, 1.5, s), ry = 1.75;
        ruff(g, L, fx, fy, rx + 0.6, ry + 0.6, hr, frost);
        // проём — мягкая тень (три слоя), без рамки: внутренний край меха уходит в темноту
        g.globalAlpha = 0.3; ell(g, fx, fy, rx + 0.4, ry + 0.4, '#2a2420', hr);
        g.globalAlpha = 0.45; ell(g, fx, fy, rx, ry, '#2a2420', hr);
        if (!LQ) { g.globalAlpha = 0.35; ell(g, fx + FC * 0.15, fy + 0.15, rx - 0.5, ry - 0.5, '#2a2420', hr); }
        g.globalAlpha = 0.75; g.fillStyle = C(L.face === '#b58d70' ? '#a37d62' : '#b58d70'); g.fillRect(fx - rx * 0.6 + FC * 0.25, fy - 0.4, rx * 1.2, 1); g.globalAlpha = 1;
        if (L.beard) { g.globalAlpha = 0.8; ell(g, fx + FC * 0.2, fy + 1.1, rx * 0.7, 0.75, C(mix(L.beard, L.hood, 0.35)), hr); g.globalAlpha = 1; }
      } else {
        // со спины: складка от макушки к плечу, шов, край опушки виден по бокам, тень у ворота
        g.strokeStyle = C(L.hoodD); g.lineWidth = 0.7; g.globalAlpha = 0.6; g.beginPath();
        P2(-0.3, 3.3); g.moveTo(QX, QY); P2(-1.5, 1); const c1x = QX, c1y = QY; P2(-0.9, -1.8); g.quadraticCurveTo(c1x, c1y, QX, QY);
        P2(0.1, 2.6); g.moveTo(QX + 1.3, QY); P2(0.5, 0); g.quadraticCurveTo(QX + 2.2, QY, QX + 1.6, QY - 1.2);
        g.stroke(); g.globalAlpha = 1;
        g.strokeStyle = C(L.ruff); g.lineWidth = 0.9; g.beginPath();
        g.moveTo(kx - RX + 0.2, ky - 1); g.quadraticCurveTo(kx - RX - 0.4, ky + 0.4, kx - RX + 0.5, ky + 1.8);
        g.moveTo(kx + RX - 0.2, ky - 1); g.quadraticCurveTo(kx + RX + 0.4, ky + 0.4, kx + RX - 0.5, ky + 1.8); g.stroke();
      }
      return;
    }
    // без капюшона: голова 6×6.5, шапка; лицо темнее, тень от козырька, глаза — одна тёмная полоса
    if (L.hoodDown && L.collar) {   // капюшон откинут на плечи: мягкий ком за шеей и меховой валик вокруг ворота
      const bx = nx - fwx * 1.6, by = ny - fwy * 1.6; pr(bx, by, 0); const cx0 = QX + P.clx, cy0 = QY + 0.6 + P.cly;   // ворот отстаёт от шеи (пружина)
      ell(g, cx0 - FC * K * 0.6, cy0 - 0.3, 4.2, 2.8, C(L.hood), hr * 0.5); if (!LQ) shadeEll(g, cx0 - FC * K * 0.6, cy0 - 0.3, 4.2, 2.8, hr * 0.5, 0.2, C(L.hoodD), 0.45);
      if (POL) polCollar(g, L, cx0 - FC * K * 0.4, cy0 + 1.1, 3.6, 1.2, hr * 0.3); else ruff(g, L, cx0 - FC * K * 0.4, cy0 + 1.3, 3.9, 1.25, hr * 0.3, 0, 1);
    } else if (L.hoodDown) { const bx = nx - fwx * 1.8, by = ny - fwy * 1.8; pr(bx, by, 0); ell(g, QX, QY + 0.4, 3.4, 2.4, C(L.hood), hr); softShade(g, QX, QY + 0.4, 3.4, 2.4, hr, C(L.hoodD), 0.3); }
    if (L.pol) {   // голова полярника на 7 % крупнее (лицо читается): масштаб вокруг центра головы
      P2(0, 0); const k = 1.07, x0 = QX, y0 = QY; g.save(); g.transform(k, 0, 0, k, x0 * (1 - k), y0 * (1 - k)); headPol(g, L, x0, y0, hr, back, s, frost); g.restore(); return;
    }
    if (L.hair && !(DETN && !back)) { P2(-1.4, -1); ell(g, QX, QY, 2.3, 3, C(L.hair), hr); }
    if (DETN && !back) { P2(0, 0); headNpc(g, L, QX, QY, hr, s, frost); return; }
    P2(0, 0); const hx0 = QX, hy0 = QY;
    ell(g, hx0, hy0, 3, 3.25, C(back ? (L.hair || L.hat || L.faceD) : L.face), hr);
    softShade(g, hx0, hy0, 3, 3.25, hr, C(back ? '#27394a' : L.faceD), back ? 0.12 : 0.3);
    let hcx = 0, hcy = 0, hrx = 0, hry = 0, vis = 0;   // главный эллипс шапки; vis — высота козырька (тень на лицо)
    if (L.hatType === 'ushanka') {
      const fur = C(L.fur);
      const fp = P.pom * 0.6;   // уши ушанки болтаются с запаздыванием
      if (s > 0.45) { P2(0, 0.6); ell(g, QX - 2.9, QY + 0.3 + fp, 1.2, 2.1, fur, hr); ell(g, QX + 2.9, QY + 0.3 + fp, 1.2, 2.1, fur, hr); }
      else { P2(-1.9, 0.8); ell(g, QX - FC * fp * 0.4, QY + fp, 1.3, 2.3, fur, hr); }
      P2(-0.2, 1.5); ell(g, QX, QY, 3.6, 2.5, C(L.hat), hr); hcx = QX; hcy = QY; hrx = 3.6; hry = 2.5;
      if (!back) { P2(0.8, 0.8); ell(g, QX, QY, lerp(2.7, 3.5, s), 1.2, fur, hr); vis = 0.8; }
      if (frost > 0.3) { g.fillStyle = 'rgba(242,246,250,0.6)'; P2(0, 2.1); const n = Math.round(frost * 5), x0 = QX, y0 = QY; g.beginPath(); for (let i = 0; i < n; i++) { const x = x0 - 2.3 + i * 1.1, y = y0 + (i % 2) * 0.6; g.moveTo(x + 0.45, y); g.arc(x, y, 0.45, 0, PI * 2); } g.fill(); }
    } else if (L.hatType === 'ushankaUp') {   // уши подняты и завязаны на макушке: шире сверху, лицо открыто
      const fur = C(L.fur);
      P2(-0.2, 1.7); ell(g, QX, QY, 3.4, 2.4, C(L.hat), hr); hcx = QX; hcy = QY; hrx = 3.4; hry = 2.4;
      if (s > 0.45) { P2(-0.1, 2.5); ell(g, QX - 2.6, QY, 1.6, 1.15, fur, hr - 0.35); ell(g, QX + 2.6, QY, 1.6, 1.15, fur, hr + 0.35); }
      else { P2(-0.9, 2.3); ell(g, QX, QY, 1.9, 1.3, fur, hr - 0.25); if (!LQ) { g.globalAlpha = 0.4; ell(g, QX + 0.4, QY + 0.5, 1.4, 0.5, C(L.dark), hr - 0.25); g.globalAlpha = 1; } }
      if (!back) { P2(0.9, 0.85); ell(g, QX, QY, lerp(2.8, 3.6, s), 1.35, fur, hr); if (!LQ) { g.globalAlpha = 0.6; ell(g, QX - 0.4, QY - 0.5, lerp(2, 2.8, s), 0.5, C(L.furL), hr); g.globalAlpha = 1; } vis = 0.95; }
      else { P2(-1, 0.8); ell(g, QX, QY, 3.2, 1.3, fur, hr); }
      if (frost > 0.3) { g.fillStyle = 'rgba(242,246,250,0.6)'; P2(0, 2.3); const n = Math.round(frost * 5), x0 = QX, y0 = QY; g.beginPath(); for (let i = 0; i < n; i++) { const x = x0 - 2.3 + i * 1.1, y = y0 + (i % 2) * 0.6; g.moveTo(x + 0.45, y); g.arc(x, y, 0.45, 0, PI * 2); } g.fill(); }
    } else if (L.hatType === 'shawl') {
      P2(-1.4, -0.4); ell(g, QX, QY, 2.5, 3.5, C(L.hat), hr);
      P2(-0.3, 1.2); ell(g, QX, QY, 3.7, 2.8, C(L.hat), hr); hcx = QX; hcy = QY; hrx = 3.7; hry = 2.8; vis = 0.6;
      if (!back) { P2(0.4, -3.1); ell(g, QX, QY, 1, 0.7, C(L.hat), hr); }
      if (L.shawlDot) { g.fillStyle = C(L.shawlDot); for (const [a, b] of [[-1.6, 1.4], [-0.4, 2.3], [0.9, 1.6], [-1.9, -0.5]]) { P2(a, b); g.fillRect(QX - 0.4, QY - 0.4, 0.8, 0.8); } }
    } else if (L.hatType === 'helmet') {
      if (back) { P2(-0.9, -0.25); ell(g, QX, QY, 2.2, 2.7, C('#2f3542'), hr); }
      P2(-0.1, 1.65); ell(g, QX, QY, 3.6, 2.6, C(L.hat), hr); hcx = QX; hcy = QY; hrx = 3.6; hry = 2.6;
      P2(0.1, 2.3); g.globalAlpha = 0.5; ell(g, QX - 0.6, QY, 1.4, 0.7, C(mix(L.hat, '#ffffff', 0.2)), hr); g.globalAlpha = 1;
      if (!back) { P2(1, 0.6); ell(g, QX, QY, lerp(2.9, 3.8, s), 0.8, C(mix(L.hat, '#10141c', 0.2)), hr); vis = 0.6; }
    } else if (L.hatType === 'knit') {
      const pl = LQ ? P.hb * 0.6 : P.pom;   // помпон — пружина от головы
      if (!L.noPom) { P2(-0.25, 4.2); ell(g, QX - FC * pl * 0.4, QY + pl, 1.2, 1.2, C(L.band || '#dde6ee'), hr); }
      P2(-0.1, 1.5); ell(g, QX, QY, 3.4, 2.7, C(L.hat), hr); hcx = QX; hcy = QY; hrx = 3.4; hry = 2.7;
      P2(0.1, 0.6); ell(g, QX, QY, 3.5, 1, C(mix(L.hat, '#dde6ee', 0.12)), hr); vis = 0.6;
      if (L.goggles && !back) {   // очки-маска подняты на шапку: тёмная линза с бликом, ремешок
        P2(0.7, 2.1); ell(g, QX, QY, lerp(1.5, 2.7, s), 0.95, C('#3a4250'), hr);
      } else if (L.goggles) { P2(-0.3, 2.1); ell(g, QX, QY, 3.4, 0.45, C('#2a2e34'), hr); }
    }
    if (hrx) { softShade(g, hcx, hcy, hrx, hry, hr, C('#27394a'), 0.13); rimEll(g, hcx, hcy, hrx, hry, hr, PI * 0.95, PI * 1.5); }
    if (!back) {
      const fx = hx0 + FC * K * 0.9, fy = hy0 + 0.5;
      if (vis) { P2(0.9, vis - 0.75); g.globalAlpha = L.faceV ? 0.26 : 0.45; ell(g, QX, QY, lerp(2, 2.8, s), 0.75, '#2a2420', hr); g.globalAlpha = 1; }   // тень от козырька 1.5 px
      if (L.faceV) faceV(g, L, fx, fy, hr, s, frost); else face(g, L, fx, fy, hr, s, frost);
    }
  }
  // голова полярника: череп и челюсть, лицо на сфере с поворотом (yaw: 0 анфас, ±π/2 профиль, π затылок) — глазницы,
  // веки с бликом, брови, нос с тенью, скулы, румянец, борода; вязаная шапка с отворотом и очками поверх лба.
  // Локальные координаты головы: x вправо, y вниз от уровня глаз; поворот hr. Свет сверху-слева.
  function headPol(g, L, hx0, hy0, hr, back, s, frost) {
    const c = Math.cos(hr), sn = Math.sin(hr), R = 3.05, RY = 3.3;
    const at = (lx, ly) => { QX = hx0 + lx * c - ly * sn; QY = hy0 + lx * sn + ly * c; };
    const E = (lx, ly, rx, ry) => { at(lx, ly); g.moveTo(QX + rx * c, QY + rx * sn); g.ellipse(QX, QY, rx, ry, hr, 0, PI * 2); };
    const th = FC * (back ? PI - (1 - s) * PI / 2 : (1 - s) * PI / 2) + (EMO && !back ? FC * (EMO.yaw || 0) : 0), st = Math.sin(th), ct = Math.cos(th), fr = Math.max(0, ct);
    const lon = (phi, r) => (r || R) * Math.sin(th + phi), vis = phi => Math.cos(th + phi);
    // череп (+ челюсть к лицу); стрижка — полусфера затылка: граница по линии ушей (x = ±R·cos yaw), уши на ней
    const sg = st >= 0 ? 0 : PI;
    g.fillStyle = C(ct < 0 ? L.hairC : L.face); g.beginPath(); E(0, 0.15, R, RY); if (ct > -0.35) E(lon(0, R * 0.42), 1.25, 2.4, 2.05); g.fill();
    if (ct < 0) shadeEll(g, hx0, hy0 + 0.15, R, RY, hr + sg, -ct, C(L.skinN), 1);
    else if (ct < 0.93) shadeEll(g, hx0, hy0 + 0.15, R, RY, hr + PI - sg, ct, C(L.hairC), 1);
    g.fillStyle = C(L.cheek); g.beginPath(); for (const sd of [-1, 1]) { const ps = th + sd * PI / 2; if (Math.cos(ps) > -0.1) E(R * Math.sin(ps) * 0.97, 0.15, 0.45 + 0.2 * Math.abs(Math.cos(ps)), 0.85); } g.fill();
    // объём головы: две ступени тени справа-снизу
    shadeEll(g, hx0, hy0 + 0.15, R, RY, hr, 0.5, C(L.faceD), 0.24); if (DET) shadeEll(g, hx0, hy0 + 0.15, R, RY, hr, -0.05, C(L.faceS), 0.13);
    if (ct > -0.2) {   // лицо видно
      const eye = [-0.44, 0.44].filter(p => vis(p) > 0.12);
      if (!LQ) {   // светлая скула со стороны света и лоб; румянец на скулах и кончике носа (мороз — ярче)
        g.fillStyle = C(L.faceL); g.globalAlpha = 0.45; g.beginPath(); if (vis(-0.95) > 0.1) E(lon(-0.95, R * 0.82), 0.55, 0.95 * vis(-0.95) + 0.2, 0.7); E(lon(-0.2, R * 0.9), -0.55, 1.1 * fr + 0.35, 0.4); g.fill();
        g.fillStyle = C(L.cheek); g.globalAlpha = 0.38 + 0.3 * frost; g.beginPath();
        for (const p of [-0.85, 0.85]) if (vis(p) > 0.1) E(lon(p, R * 0.85), 0.85, 0.8 * vis(p) + 0.2, 0.55);
        E(lon(0, R + 0.45), 0.95, 0.45, 0.35); g.fill();
      }
      // глазницы (мягкие ямки под бровью), тень носа справа и под ним, тень под подбородком — одним тоном
      g.fillStyle = C(L.faceS); g.globalAlpha = 0.5; g.beginPath();
      for (const p of eye) E(lon(p, R * 0.93), -0.12, 0.72 * vis(p) + 0.2, 0.6);
      const nr = lon(0, R * 0.98), nt = lon(0, R + 0.8);   // корень и кончик носа
      at(nr + 0.2, -0.45); g.moveTo(QX, QY); at(nt + 0.35, 1.1); g.lineTo(QX, QY); at(nt - 0.1 + 0.3 * fr, 1.45); g.lineTo(QX, QY); at(nr + 0.45 * fr + 0.05, 1.2); g.lineTo(QX, QY); g.closePath();
      E(nt - 0.1 * st + 0.2, 1.5, 0.55 * fr + 0.3, 0.24);
      g.fill();
      g.globalAlpha = 1;
      // веки/глаза — тёмная щель с верхним веком; блик на крупном плане
      const EO = EMO ? clamp(EMO.open == null ? 1 : EMO.open, 0.35, 1.6) : 1;   // раскрытие глаз по мимике (1 — как прежде)
      g.fillStyle = '#26160f'; g.beginPath();
      for (const p of eye) { const v = vis(p), x = lon(p, R * 0.95); E(x + 0.05 * st, -0.05, 0.5 * v + 0.12, P.eyes ? 0.1 : 0.22 * EO); }
      g.fill();
      if (DET && !P.eyes && EO > 0.6) { g.fillStyle = 'rgba(236,242,247,0.8)'; g.beginPath(); for (const p of eye) { const x = lon(p, R * 0.95); at(x - 0.12 - 0.1 * st, -0.13); g.rect(QX, QY, 0.22, 0.17); } g.fill(); }
      // брови: короткие штрихи с изломом; в мороз — в инее
      g.strokeStyle = C(frost > 0.55 ? mix(L.brow, '#eef3f7', frost * 0.8) : L.brow); g.lineWidth = 0.5; g.beginPath();
      const bB = EMO ? (EMO.brow || 0) * 0.5 : 0, kn = EMO ? EMO.knit || 0 : 0;   // брови: подняты (bB) / сведены (kn > 0 — внутренние концы вниз, < 0 — вверх «домиком»)
      for (const p of eye) { const v = vis(p), x = lon(p, R * 0.97), w = 0.55 * v + 0.18, sd = p < 0 ? -1 : 1; at(x - w * sd * FC, -0.7 - bB + (FC > 0 ? kn * 0.3 : -kn * 0.1)); g.moveTo(QX, QY); at(x + 0.1 * sd * FC, -0.92 - bB + kn * 0.08); g.lineTo(QX, QY); at(x + w * sd * FC, -0.85 - bB + (FC > 0 ? -kn * 0.1 : kn * 0.3)); g.lineTo(QX, QY); }
      g.stroke();
      if (!LQ) { g.strokeStyle = C(L.faceL); g.lineWidth = 0.45; g.globalAlpha = 0.85; g.beginPath(); at(nr - 0.1, -0.35); g.moveTo(QX, QY); at(nt - 0.15, 0.95); g.lineTo(QX, QY); g.stroke(); g.globalAlpha = 1; }   // спинка носа к свету
      // борода — серп по линии челюсти (у подбородка гуще), усы над ртом, рот в бороде
      const jx = lon(0, R * 0.42), mx = lon(0, R * 0.96), bw = 1.5 + 0.95 * Math.abs(ct);
      const arcE = (lx, ly, rx, ry, a0, a1, ccw) => { at(lx, ly); g.ellipse(QX, QY, rx, ry, hr, a0, a1, ccw); };
      g.fillStyle = C(L.beardC); g.globalAlpha = 0.72; g.beginPath(); arcE(jx, 1.3, 2.5, 2.1, 0.02 * PI, 0.98 * PI); arcE(jx + 0.15 * st, 0.8, 1.9, 1.25, 0.98 * PI, 0.02 * PI, true); g.closePath();
      E(mx + 0.05 * st, 1.72, 0.5 + 0.5 * fr, 0.32); g.fill();
      if (DET) { g.globalAlpha = 0.3; g.fillStyle = C(mix(L.beardC, '#e8d2b8', 0.4)); g.beginPath(); arcE(jx, 1.3, 2.3, 1.95, 0.55 * PI, 0.9 * PI); arcE(jx, 1.1, 1.9, 1.4, 0.9 * PI, 0.55 * PI, true); g.closePath(); g.fill(); }   // светлее к свету (слева)
      g.globalAlpha = 1;
      const mw = 0.42 * fr + 0.2, mh = 0.18 + P.mouth * 0.5; at(mx, 2.08);
      if (EMO && (Math.abs(EMO.smile || 0) > 0.08 || (EMO.jaw || 0) > 0.05)) mouthE(g, QX, QY, mw, mh + (EMO.jaw || 0) * 0.45, EMO.smile || 0, L.lip);
      else { g.fillStyle = C(L.lip); g.fillRect(QX - mw, QY + 0.05, mw * 2, 0.28); g.fillStyle = '#2a1410'; g.fillRect(QX - mw, QY - 0.1, mw * 2, mh); }
      if (frost > 0.4) {   // иней: мелкие крупинки в бороде и на усах
        g.fillStyle = '#eef3f7'; g.globalAlpha = 0.3 + 0.45 * frost; g.beginPath(); const n = 4 + Math.round(frost * 6);
        for (let i = 0; i < n; i++) { const a = PI * (0.1 + 0.8 * GRN[i * 3]), r = 0.72 + 0.26 * GRN[i * 3 + 1], rr = 0.1 + 0.08 * GRN[i * 3 + 2]; at(jx + Math.cos(a) * 2.3 * r, 1.3 + Math.sin(a) * 1.95 * r); g.moveTo(QX + rr, QY); g.arc(QX, QY, rr, 0, PI * 2); }
        for (const d of [-1, 1]) { at(mx + d * (0.3 + 0.4 * fr), 1.66); g.moveTo(QX + 0.17, QY); g.arc(QX, QY, 0.17, 0, PI * 2); }
        g.fill(); g.globalAlpha = 1;
      }
    }
    // шапка: купол с отворотом; нижний край — дуга (вид сверху: перёд ниже), рубчик отворота поворачивается с головой
    const hy = -1.7, hrx = R + 0.42;
    g.fillStyle = C(L.hat); g.beginPath(); at(-hrx, hy); g.moveTo(QX, QY); at(0, hy); g.ellipse(QX, QY, hrx, 2.4, hr, PI, 0); g.ellipse(QX, QY, hrx, 0.74, hr, 0, PI); g.fill();
    g.strokeStyle = C(L.hatC); g.lineWidth = 1.15; g.lineCap = 'butt'; g.beginPath(); at(0, hy - 0.52); g.ellipse(QX, QY, hrx - 0.35, 0.72, hr, 0.1, PI - 0.1); g.stroke();
    if (DET) {   // рубчик вязки: короткие вертикали по долготам
      g.strokeStyle = C(L.hatD); g.lineWidth = 0.28; g.globalAlpha = 0.55; g.beginPath();
      for (let k = -7; k <= 7; k++) { const ps = th + k * 0.36, cv = Math.cos(ps); if (back ? cv < -0.05 : cv < 0.05) continue; const x = hrx * Math.sin(ps) * 0.97, yb = hy + 0.72 * Math.sqrt(Math.max(0, 1 - (x / hrx) ** 2)); at(x, yb - 0.1); g.moveTo(QX, QY); at(x, yb - 1.05); g.lineTo(QX, QY); }
      g.stroke(); g.globalAlpha = 1;
    }
    g.lineCap = 'round';
    at(0, hy); const hcx = QX, hcy = QY;
    shadeEll(g, hcx, hcy - 0.2, hrx, 2.6, hr, 0.3, C(L.hatD), 0.4); if (DET) shadeEll(g, hcx, hcy - 0.2, hrx, 2.6, hr, -0.3, C(L.hatD), 0.25);
    if (!LQ) { g.globalAlpha = 0.45; g.fillStyle = C(L.hatL); g.beginPath(); E(-1.3, -3.1, 1.5, 0.75); g.fill(); g.globalAlpha = 1; }   // блик на макушке
    rimEll(g, hcx, hcy - 0.2, hrx, 2.5, hr, PI * 0.95, PI * 1.5);
    // очки на шапке: ремешок по дуге, оправа, линза (янтарь с отражённым небом), блик
    const gy = hy - 1.25;
    g.strokeStyle = '#15191e'; g.lineWidth = 0.75; g.beginPath(); at(0, gy); g.ellipse(QX, QY, hrx * 0.99, 0.7, hr, back ? PI + 0.15 : 0.15, back ? -0.15 : PI - 0.15); g.stroke();
    if (!back && ct > -0.2) {
      const gx = lon(0, hrx * 0.9), gw = 1.35 * fr + 0.45, gyy = gy + 0.62 * Math.sqrt(Math.max(0, 1 - (gx / hrx) ** 2));
      g.fillStyle = '#15191e'; g.beginPath(); E(gx, gyy, gw + 0.35, 0.82); g.fill();
      g.fillStyle = '#d88a2c'; g.beginPath(); E(gx, gyy + 0.05, gw, 0.55); g.fill();
      if (!LQ) {
        g.fillStyle = '#5f7fae'; g.globalAlpha = 0.85; g.beginPath(); at(gx, gyy + 0.05); g.moveTo(QX - gw * c, QY - gw * sn); g.ellipse(QX, QY, gw, 0.55, hr, PI, 0); g.fill();
        g.fillStyle = '#eef4fa'; g.globalAlpha = 0.85; g.beginPath(); at(gx - gw * 0.45, gyy - 0.2); g.ellipse(QX, QY, gw * 0.28, 0.14, hr - 0.25, 0, PI * 2); g.fill(); g.globalAlpha = 1;
      }
    } else if (back) { at(0, gy + 0.7); g.fillStyle = '#3a4048'; g.fillRect(QX - 0.5, QY - 0.4, 1, 0.8); }   // пряжка ремешка на затылке
  }
  // ---------- мимика и лица людей мира на крупном плане (DETN): тот же приём, что у героя (headPol) ----------
  // рот по мимике: sm > 0 — уголки вверх (улыбка), < 0 — вниз (горе, злость); mh — раскрытие (речь, испуг). Координаты экрана фигуры
  function mouthE(g, x, y, mw, mh, sm, lip) {
    const cy = -sm * 0.34, w = mw * (1 + Math.max(0, sm) * 0.25);
    g.fillStyle = C(lip); g.beginPath(); g.moveTo(x - w - 0.08, y + cy); g.quadraticCurveTo(x, y + 0.5 + mh * 1.1 + sm * 0.25, x + w + 0.08, y + cy); g.quadraticCurveTo(x, y + 0.15 + mh * 0.7 + sm * 0.2, x - w - 0.08, y + cy); g.fill();
    g.fillStyle = '#2a1410'; g.beginPath(); g.moveTo(x - w, y + cy - 0.04); g.quadraticCurveTo(x, y - 0.14 + sm * 0.12, x + w, y + cy - 0.04); g.quadraticCurveTo(x, y - 0.1 + mh * 1.7 + sm * 0.3, x - w, y + cy - 0.04); g.fill();
  }
  // сфера головы: локальные x вправо, y вниз от уровня глаз, поворот hr; th — поворот лица (0 анфас, ±π/2 профиль)
  let HCc = 1, HCs = 0, HCx = 0, HCy = 0, HCt = 0, HCr = 0;
  function hSet(x, y, hr, th) { HCx = x; HCy = y; HCr = hr; HCc = Math.cos(hr); HCs = Math.sin(hr); HCt = th; }
  function hAt(lx, ly) { QX = HCx + lx * HCc - ly * HCs; QY = HCy + lx * HCs + ly * HCc; }
  function hE(g, lx, ly, rx, ry) { hAt(lx, ly); g.moveTo(QX + rx * HCc, QY + rx * HCs); g.ellipse(QX, QY, rx, ry, HCr, 0, PI * 2); }
  function hArc(g, lx, ly, rx, ry, a0, a1, ccw) { hAt(lx, ly); g.ellipse(QX, QY, rx, ry, HCr, a0, a1, ccw); }
  const hLon = (phi, r) => r * Math.sin(HCt + phi), hVis = phi => Math.cos(HCt + phi);
  // лицо: череп и челюсть, свет скулы, румянец, глазницы, веки, брови по мимике, нос по типу (эвенк — шире и короче),
  // морщины у стариков, борода/усы/щетина (челюсть опускается, когда говорит), рот по мимике, очки
  function faceNpc(g, L, frost, R, RY, skull, forehead) {
    const fem = !!L.fem, evk = !!L.evk, old = !!L.old, aged = old || !!L.aged, th = HCt, st = Math.sin(th), ct = Math.cos(th), fr = Math.max(0, ct);
    const EO = EMO ? clamp(EMO.open == null ? 1 : EMO.open, 0.35, 1.6) : 1, bB = EMO ? (EMO.brow || 0) * 0.5 : 0, kn = EMO ? EMO.knit || 0 : 0;
    if (skull) {
      g.fillStyle = C(L.face); g.beginPath(); hE(g, 0, 0.15, R, RY); if (ct > -0.35) hE(g, hLon(0, R * 0.42), 1.25, fem ? 2.05 : evk ? 2.6 : 2.4, fem ? 1.8 : 2.05); g.fill();
      const sg = st >= 0 ? 0 : PI;
      if (ct < 0.93) shadeEll(g, HCx, HCy + 0.15, R, RY, HCr + PI - sg, Math.max(0.05, ct), C(L.nHair), 0.9);   // затылок за линией ушей — волосы
      shadeEll(g, HCx, HCy + 0.15, R, RY, HCr, 0.5, C(L.faceD), 0.24); if (DETF) shadeEll(g, HCx, HCy + 0.15, R, RY, HCr, -0.05, C(L.nS), 0.13);
    }
    if (ct <= -0.2) return;
    const eye = [-0.44, 0.44].filter(p => hVis(p) > 0.12);
    if (!LQ) {   // свет скулы и лба; румянец на скулах и кончике носа (мороз — ярче)
      g.fillStyle = C(L.nL); g.globalAlpha = 0.42; g.beginPath(); if (hVis(-0.95) > 0.1) hE(g, hLon(-0.95, R * 0.82), 0.55, 0.95 * hVis(-0.95) + 0.2, evk ? 0.8 : 0.7); if (forehead) hE(g, hLon(-0.2, R * 0.9), -0.55, 1.1 * fr + 0.35, 0.4); g.fill();
      g.fillStyle = C(L.nCh); g.globalAlpha = (fem ? 0.45 : 0.3) + 0.3 * frost; g.beginPath();
      for (const p of [-0.85, 0.85]) if (hVis(p) > 0.1) hE(g, hLon(p, R * 0.85), evk ? 0.62 : 0.85, 0.8 * hVis(p) + 0.2, evk ? 0.6 : 0.55);
      hE(g, hLon(0, R + 0.45), 0.95, 0.42, 0.33); g.fill();
    }
    // глазницы и тень носа — одним тоном
    g.fillStyle = C(L.nS); g.globalAlpha = aged ? 0.55 : 0.48; g.beginPath();
    for (const p of eye) hE(g, hLon(p, R * 0.93), -0.12, 0.72 * hVis(p) + 0.2, evk ? 0.48 : 0.6);
    const nw = evk ? 1.3 : fem ? 0.85 : 1, nr = hLon(0, R * 0.98), nt = hLon(0, R + (evk ? 0.5 : fem ? 0.62 : 0.8));
    hAt(nr + 0.2, -0.45); g.moveTo(QX, QY); hAt(nt + 0.35 * nw, 1.1); g.lineTo(QX, QY); hAt(nt - 0.1 + 0.3 * fr, 1.45); g.lineTo(QX, QY); hAt(nr + 0.45 * fr + 0.05, 1.2); g.lineTo(QX, QY); g.closePath();
    hE(g, nt - 0.1 * st + 0.2, 1.5, (0.55 * fr + 0.3) * nw, 0.24);
    g.fill(); g.globalAlpha = 1;
    // глаза: тёмный миндаль (у эвенков уже), раскрытие — по мимике; блик на крупном плане
    const shut = P.eyes;
    g.fillStyle = '#26160f'; g.beginPath();
    for (const p of eye) { const v = hVis(p), x = hLon(p, R * 0.95); hE(g, x + 0.05 * st, -0.05, (0.5 * v + 0.12) * (evk ? 1.08 : 1), shut ? 0.08 : (evk ? 0.15 : fem ? 0.25 : 0.22) * EO); }
    g.fill();
    if (DETF && !shut && EO > 0.6) { g.fillStyle = 'rgba(236,242,247,0.8)'; g.beginPath(); for (const p of eye) { const x = hLon(p, R * 0.95); hAt(x - 0.12 - 0.1 * st, -0.13); g.rect(QX, QY, 0.2, 0.15); } g.fill(); }
    if (!LQ && (evk || aged || fem || EO < 0.8)) {   // верхнее веко: складка над глазом; у женщин — ресницы у внешнего угла
      g.strokeStyle = C(fem ? '#26160f' : L.nS); g.lineWidth = fem ? 0.22 : 0.26; g.globalAlpha = fem ? 0.8 : 0.6; g.beginPath();
      for (const p of eye) { const v = hVis(p), x = hLon(p, R * 0.95), w = 0.5 * v + 0.16, sd = p < 0 ? -1 : 1, lid = EO < 0.8 ? 0.18 * (0.8 - EO) / 0.45 : 0;
        hAt(x - w * 0.9, -0.12 + lid); g.moveTo(QX, QY); hAt(x, -0.38 + lid * 1.4 + (evk ? 0.1 : 0)); const qx = QX, qy = QY; hAt(x + w * 0.9, -0.12 + lid + (evk ? -0.06 * sd : 0)); g.quadraticCurveTo(qx, qy, QX, QY);
        if (fem) { hAt(x + sd * w * 0.9, -0.12); g.moveTo(QX, QY); hAt(x + sd * (w + 0.28), -0.36); g.lineTo(QX, QY); } }
      g.stroke(); g.globalAlpha = 1;
    }
    // брови: подняты (bB) / сведены (kn > 0 — внутренние концы вниз, злость; < 0 — «домиком», тревога и горе); у женщин — тоньше, с изгибом
    g.strokeStyle = C(frost > 0.55 ? mix(L.nBrow, '#eef3f7', frost * 0.8) : L.nBrow); g.lineWidth = fem ? 0.36 : old ? 0.62 : 0.52; g.beginPath();
    for (const p of eye) { const v = hVis(p), x = hLon(p, R * 0.97), w = 0.55 * v + 0.18, sd = p < 0 ? -1 : 1;
      hAt(x - w * sd, -0.72 - bB + kn * 0.3); g.moveTo(QX, QY); hAt(x + 0.1 * sd, -0.94 - (fem ? 0.1 : 0) - bB + kn * 0.08); g.lineTo(QX, QY); hAt(x + w * sd, -0.84 - bB - kn * 0.1 + (old ? 0.1 : 0)); g.lineTo(QX, QY); }
    g.stroke();
    if (!LQ) { g.strokeStyle = C(L.nL); g.lineWidth = 0.42; g.globalAlpha = 0.8; g.beginPath(); hAt(nr - 0.1, -0.35); g.moveTo(QX, QY); hAt(nt - 0.15, 0.95); g.lineTo(QX, QY); g.stroke(); g.globalAlpha = 1; }   // спинка носа к свету
    if (aged && !LQ) {   // морщины: носогубные складки, «гусиные лапки», лоб (если открыт)
      g.strokeStyle = C(L.nS); g.lineWidth = 0.26; g.globalAlpha = old ? 0.62 : 0.4; g.beginPath();
      for (const d of [-1, 1]) { if (hVis(d * 0.5) < 0.15) continue; hAt(hLon(d * 0.34, R), 1.25); g.moveTo(QX, QY); hAt(hLon(d * 0.52, R * 0.97), 1.85); const qx = QX, qy = QY; hAt(hLon(d * 0.46, R * 0.95), 2.45); g.quadraticCurveTo(qx, qy, QX, QY); }
      for (const p of eye) { const q = p * 1.8; if (hVis(q) < 0.1) continue; const x = hLon(q, R * 0.93), sd = p < 0 ? -1 : 1;
        hAt(x, -0.05); g.moveTo(QX, QY); hAt(x + 0.4 * sd, -0.3); g.lineTo(QX, QY); hAt(x, 0.05); g.moveTo(QX, QY); hAt(x + 0.42 * sd, 0.2); g.lineTo(QX, QY); }
      if (forehead) for (const y of [-1.45, -1.8]) { hAt(hLon(-0.45, R * 0.95), y); g.moveTo(QX, QY); hAt(hLon(0, R), y - 0.12); const qx = QX, qy = QY; hAt(hLon(0.45, R * 0.95), y); g.quadraticCurveTo(qx, qy, QX, QY); }
      g.stroke(); g.globalAlpha = 1;
    }
    // борода / щетина; челюсть опускается, когда говорит (борода — вместе с ней)
    const jx = hLon(0, R * 0.42), mx = hLon(0, R * 0.96), jd = (P.mouth || 0) * 0.22 + (EMO ? (EMO.jaw || 0) * 0.3 : 0);
    if (L.beard) {
      const k = L.beardK, len = k === 'long' ? 1.9 : k === 'thin' ? 0.75 : 1.05, wd = k === 'thin' ? 0.72 : 1;
      g.fillStyle = C(L.beard); g.globalAlpha = k === 'thin' ? 0.85 : 0.95; g.beginPath();
      hArc(g, jx, 1.3 + (len - 1) * 0.9 + jd, 2.5 * wd, 2.1 * len, 0.02 * PI, 0.98 * PI); hArc(g, jx + 0.15 * st, 0.8, 1.9 * wd, 1.25, 0.98 * PI, 0.02 * PI, true); g.closePath();
      hE(g, mx + 0.05 * st, 1.7, 0.55 + 0.5 * fr, 0.34);   // усы
      if (k === 'thin') for (const d of [-1, 1]) hE(g, mx + d * (0.5 + 0.3 * fr), 2.25 + jd, 0.2, 0.55);   // свисающие кончики усов
      g.fill();
      if (DETF) {   // пряди светлее к свету
        g.globalAlpha = 0.35; g.strokeStyle = C(mix(L.beard, '#ffffff', 0.35)); g.lineWidth = 0.22; g.beginPath();
        for (let i = 0; i < 5; i++) { const a = PI * (0.28 + 0.11 * i); hAt(jx + Math.cos(a) * 1.5 * wd, 1.3 + Math.sin(a) * 1.1 * len + jd); g.moveTo(QX, QY); hAt(jx + Math.cos(a) * 2.2 * wd, 1.3 + Math.sin(a) * 1.9 * len + jd); g.lineTo(QX, QY); }
        g.stroke();
      }
      g.globalAlpha = 1;
    } else if (L.stubble) {
      g.fillStyle = '#3a2e28'; g.globalAlpha = 0.26; g.beginPath(); hArc(g, jx, 1.3 + jd, 2.4, 2.0, 0.02 * PI, 0.98 * PI); hArc(g, jx + 0.15 * st, 0.75, 1.9, 1.2, 0.98 * PI, 0.02 * PI, true); g.closePath(); hE(g, mx, 1.7, 0.5 + 0.45 * fr, 0.28); g.fill(); g.globalAlpha = 1;
    }
    const mw = (fem ? 0.36 : 0.42) * fr + 0.2, mh = 0.16 + (P.mouth || 0) * 0.5; hAt(mx, 2.08 + jd * 0.5);
    if (EMO && (Math.abs(EMO.smile || 0) > 0.08 || (EMO.jaw || 0) > 0.05)) mouthE(g, QX, QY, mw, mh + (EMO.jaw || 0) * 0.45, EMO.smile || 0, L.nLip);
    else { g.fillStyle = C(L.nLip); g.fillRect(QX - mw, QY + 0.05, mw * 2, fem ? 0.34 : 0.28); g.fillStyle = '#2a1410'; g.fillRect(QX - mw, QY - 0.1, mw * 2, mh); }
    if (L.glasses) {   // очки: тонкая оправа, перемычка, блик
      g.strokeStyle = '#2a2e34'; g.lineWidth = 0.3; g.beginPath();
      for (const p of eye) { const v = hVis(p), x = hLon(p, R * 1.02), rx = 0.5 * v + 0.36; hAt(x, -0.02); g.moveTo(QX + rx * HCc, QY + rx * HCs); g.ellipse(QX, QY, rx, 0.5, HCr, 0, PI * 2); }
      if (eye.length === 2) { hAt(hLon(-0.2, R * 1.02), -0.1); g.moveTo(QX, QY); hAt(hLon(0.2, R * 1.02), -0.1); g.lineTo(QX, QY); }
      g.stroke();
      if (!LQ) { g.fillStyle = 'rgba(221,230,238,0.75)'; g.beginPath(); for (const p of eye) { hAt(hLon(p, R * 1.02) - 0.25, -0.3); g.rect(QX, QY, 0.3, 0.16); } g.fill(); }
    }
    if (frost > 0.4 && (L.beard || L.stubble)) {   // иней в бороде
      g.fillStyle = '#eef3f7'; g.globalAlpha = 0.3 + 0.45 * frost; g.beginPath(); const n = 4 + Math.round(frost * 6);
      for (let i = 0; i < n; i++) { const a = PI * (0.1 + 0.8 * GRN[i * 3]), r = 0.72 + 0.26 * GRN[i * 3 + 1], rr = 0.1 + 0.08 * GRN[i * 3 + 2]; hAt(jx + Math.cos(a) * 2.3 * r, 1.3 + Math.sin(a) * 1.95 * r); g.moveTo(QX + rr, QY); g.arc(QX, QY, rr, 0, PI * 2); }
      g.fill(); g.globalAlpha = 1;
    }
  }
  // шапка на сфере: back — часть за головой (платок), иначе — поверх лица: ушанка (клапаны, купол, меховой отворот),
  // вязаная (купол, отворот, рубчик, помпон, пряди у висков), платок (купол, края у щёк, узел), каска (подшлемник, купол, поле)
  function hatNpc(g, L, R, frost, back) {
    const t = L.hatType, th = HCt;
    if (!t) { if (back) return; g.fillStyle = C(L.nHair); g.beginPath(); hAt(-(R + 0.1), -1.2); g.moveTo(QX, QY); hArc(g, 0, -1.2, R + 0.1, 2.3, PI, 0); hArc(g, 0, -1.2, R + 0.1, 0.8, 0, PI); g.fill(); return; }
    if (t === 'shawl') {
      if (back) { g.fillStyle = C(L.hat); g.beginPath(); hE(g, 0, 0.6, R + 0.95, 4.2); g.fill(); return; }   // платок за головой — рамка лица до подбородка
      g.fillStyle = C(L.hat); g.beginPath(); hAt(-(R + 0.5), -1.25); g.moveTo(QX, QY); hArc(g, 0, -1.25, R + 0.5, 2.6, PI, 0); hArc(g, 0, -1.25, R + 0.5, 0.55, 0, PI);
      for (const d of [-1, 1]) { const ps = th + d * PI / 2; if (Math.cos(ps) < -0.4) continue; hE(g, (R + 0.2) * Math.sin(ps), 0.9, 0.5 + 0.5 * Math.max(0, Math.cos(ps)), 2.4); }   // края у щёк
      hE(g, hLon(0, R * 0.45), 3.35, 0.95, 0.6); g.fill();   // узел под подбородком
      softShade(g, HCx, HCy - 1.3, R + 0.5, 2.6, HCr, C('#27394a'), 0.13);
      if (L.shawlDot) { g.fillStyle = C(L.shawlDot); for (const [a, b] of [[-1.6, -2.4], [-0.3, -3.2], [1.1, -2.6], [-2.3, -1.2], [2.2, -1.3]]) { hAt(hLon(a * 0.45, R) * 0.95, b); g.fillRect(QX - 0.35, QY - 0.35, 0.7, 0.7); } }
      rimEll(g, HCx, HCy - 1.3, R + 0.5, 2.6, HCr, PI * 0.95, PI * 1.5);
      return;
    }
    if (back) { if (L.hair) { g.fillStyle = C(L.hair); g.beginPath(); hE(g, -3.05 * Math.sin(th) * 0.55, 1.1, 2.3, 2.9); g.fill(); } return; }   // волосы на затылке, до ворота
    if (t === 'helmet') {
      g.fillStyle = C('#3a3f46'); g.beginPath(); for (const d of [-1, 1]) { const ps = th + d * PI / 2; if (Math.cos(ps) < -0.4) continue; hE(g, (R + 0.1) * Math.sin(ps), 0.4, 0.55 + 0.45 * Math.max(0, Math.cos(ps)), 1.9); } g.fill();   // подшлемник у ушей
      g.fillStyle = C(L.hat); g.beginPath(); hAt(-(R + 0.45), -1.35); g.moveTo(QX, QY); hArc(g, 0, -1.35, R + 0.45, 2.7, PI, 0); hArc(g, 0, -1.35, R + 0.45, 0.6, 0, PI); g.fill();
      softShade(g, HCx, HCy - 1.5, R + 0.45, 2.7, HCr, C('#27394a'), 0.16);
      g.fillStyle = C(mix(L.hat, '#10141c', 0.22)); g.beginPath(); hE(g, hLon(0, 0.7), -1.1, R + 0.9, 0.42); g.fill();   // поле каски
      g.strokeStyle = C(mix(L.hat, '#10141c', 0.3)); g.lineWidth = 0.4; g.beginPath(); hAt(hLon(0, R * 0.2), -1.4); g.moveTo(QX, QY); hAt(hLon(0, R * 0.12), -3.9); g.lineTo(QX, QY); g.stroke();   // гребень
      if (!LQ) { g.globalAlpha = 0.5; g.fillStyle = C(mix(L.hat, '#ffffff', 0.3)); g.beginPath(); hE(g, -1.3, -3.1, 1.3, 0.55); g.fill(); g.globalAlpha = 1; }
      return;
    }
    if (t === 'knit') {
      const hy = -1.7, hrx = R + 0.42;
      if (L.hair) {   // пряди у висков и чёлка из-под отворота
        g.fillStyle = C(L.hair); g.beginPath();
        for (const d of [-1, 1]) { const ps = th + d * 1.2; if (Math.cos(ps) < 0.05) continue; hE(g, R * 0.97 * Math.sin(ps), 0.25, 0.5 * Math.cos(ps) + 0.22, 1.45); }
        hE(g, hLon(-0.35, R * 0.92), -1.05, 1.05 * Math.max(0.3, Math.cos(th - 0.35)), 0.38); g.fill();
      }
      if (!L.noPom) { const pl = P.pom; g.fillStyle = C(L.band || '#dde6ee'); g.beginPath(); hE(g, -FC * pl * 0.4, hy - 2.75 + pl, 1.15, 1.1); g.fill(); }
      g.fillStyle = C(L.hat); g.beginPath(); hAt(-hrx, hy); g.moveTo(QX, QY); hAt(0, hy); g.ellipse(QX, QY, hrx, 2.4, HCr, PI, 0); g.ellipse(QX, QY, hrx, 0.74, HCr, 0, PI); g.fill();
      g.strokeStyle = C(mix(L.hat, '#dde6ee', 0.12)); g.lineWidth = 1.15; g.lineCap = 'butt'; g.beginPath(); hAt(0, hy - 0.52); g.ellipse(QX, QY, hrx - 0.35, 0.72, HCr, 0.1, PI - 0.1); g.stroke();
      if (DETF) {   // рубчик вязки
        g.strokeStyle = C(mix(L.hat, '#070b12', 0.45)); g.lineWidth = 0.28; g.globalAlpha = 0.5; g.beginPath();
        for (let k = -7; k <= 7; k++) { const ps = th + k * 0.36; if (Math.cos(ps) < 0.05) continue; const x = hrx * Math.sin(ps) * 0.97, yb = hy + 0.72 * Math.sqrt(Math.max(0, 1 - (x / hrx) ** 2)); hAt(x, yb - 0.1); g.moveTo(QX, QY); hAt(x, yb - 1.05); g.lineTo(QX, QY); }
        g.stroke(); g.globalAlpha = 1;
      }
      g.lineCap = 'round';
      hAt(0, hy); const hcx = QX, hcy = QY;
      shadeEll(g, hcx, hcy - 0.2, hrx, 2.6, HCr, 0.3, C(mix(L.hat, '#070b12', 0.45)), 0.35);
      if (!LQ) { g.globalAlpha = 0.4; g.fillStyle = C(mix(L.hat, '#c8d6e6', 0.3)); g.beginPath(); hE(g, -1.3, -3.1, 1.5, 0.7); g.fill(); g.globalAlpha = 1; }
      rimEll(g, hcx, hcy - 0.2, hrx, 2.5, HCr, PI * 0.95, PI * 1.5);
      return;
    }
    // ушанка: уши-клапаны у висков (болтаются с запаздыванием), купол, меховой отворот над бровями
    const fur = L.fur, fp = P.pom * 0.6;
    g.fillStyle = C(fur); g.beginPath();
    for (const d of [-1, 1]) { const ps = th + d * PI / 2, v = Math.cos(ps); if (v < -0.4) continue; hE(g, (R + 0.15) * Math.sin(ps), 1.05 + fp, 0.45 + 0.75 * Math.max(0, v), 2.1); }
    g.fill();
    g.fillStyle = C(L.hat); g.beginPath(); hAt(-(R + 0.35), -1.9); g.moveTo(QX, QY); hArc(g, 0, -1.9, R + 0.35, 2.3, PI, 0); hArc(g, 0, -1.9, R + 0.35, 0.6, 0, PI); g.fill();
    softShade(g, HCx, HCy - 2.1, R + 0.35, 2.3, HCr, C('#27394a'), 0.15);
    g.fillStyle = C(fur); g.beginPath(); hE(g, hLon(0, 0.35), -1.55, R + 0.55, 0.8); g.fill();
    if (!LQ) {
      g.globalAlpha = 0.55; g.fillStyle = C(L.furL || mix(fur, '#efe6d2', 0.35)); g.beginPath(); hE(g, hLon(-0.3, 0.3) - 0.4, -1.85, R * 0.72, 0.3); g.fill();
      if (DETF) { g.globalAlpha = 0.5; g.strokeStyle = C(mix(fur, '#2a2018', 0.4)); g.lineWidth = 0.25; g.beginPath(); for (let i = -4; i <= 4; i++) { const x = i * 0.75; hAt(x, -0.85); g.moveTo(QX, QY); hAt(x + 0.15, -0.62); g.lineTo(QX, QY); } g.stroke(); }
      g.globalAlpha = 1;
    }
    rimEll(g, HCx, HCy - 2.1, R + 0.35, 2.3, HCr, PI * 0.95, PI * 1.5);
    if (frost > 0.3) { g.fillStyle = 'rgba(242,246,250,0.6)'; g.beginPath(); const n = Math.round(frost * 6); for (let i = 0; i < n; i++) { hAt(-2.4 + i * 0.95, -2.2 + (i % 2) * 0.5); g.moveTo(QX + 0.45, QY); g.arc(QX, QY, 0.45, 0, PI * 2); } g.fill(); }
  }
  // голова человека мира на крупном плане (без капюшона): шапка-задник → череп и лицо → шапка
  function headNpc(g, L, x0, y0, hr, s, frost) {
    const R = L.fem ? 2.9 : L.evk ? 3.15 : 3.05, RY = L.fem ? 3.15 : 3.3;
    hSet(x0, y0, hr, FC * (1 - s) * PI / 2 + (EMO ? FC * (EMO.yaw || 0) : 0));
    hatNpc(g, L, R, frost, true);
    faceNpc(g, L, frost, R, RY, true, !L.hatType || L.hatType === 'helmet');
    hatNpc(g, L, R, frost, false);
  }
  // в капюшоне (Уркачан, эвенки): купол как на общем плане, в проёме — лицо на сфере (чуть меньше головы), тень капюшона на лбу, мех опушки
  function hoodNpc(g, L, P2, hr, s, frost) {
    P2(-0.5, 0.4); const kx = QX, ky = QY + P.hb * 0.4, RX = 3.9, RY = 3.5;
    P2(-0.3, -1.9); const lx = QX, ly = QY + P.hb * 0.4;
    g.fillStyle = C(L.hood); g.beginPath(); g.ellipse(kx, ky, RX, RY, hr, 0, PI * 2); g.moveTo(lx + 2.9, ly); g.ellipse(lx, ly, 2.9, 1.9, hr, 0, PI * 2); g.fill();
    softShade(g, kx, ky, RX, RY, hr, C(L.hoodD), 0.26);
    rimEll(g, kx, ky, RX, RY, hr, PI * 0.95, PI * 1.4);
    P2(1.75, -0.35); const fx = QX, fy = QY, rx = lerp(2.0, 2.35, s), ry = 2.55;
    const th = FC * (1 - s) * PI / 2 + (EMO ? FC * (EMO.yaw || 0) : 0), k = 0.8, d = 3.05 * Math.sin(th) * 0.75;
    g.save(); g.beginPath(); g.ellipse(fx, fy, rx, ry, hr, 0, PI * 2); g.clip();
    ell(g, fx, fy, rx + 0.2, ry + 0.2, C(L.face), hr);
    g.transform(k, 0, 0, k, fx * (1 - k), fy * (1 - k));
    hSet(fx - d * Math.cos(hr), fy - d * Math.sin(hr) + 0.2, hr, th);
    faceNpc(g, L, frost, 3.05, 3.3, false, false);
    g.restore();
    g.globalAlpha = 0.38; ell(g, fx, fy - ry * 0.74, rx * 0.95, ry * 0.4, '#2a2018', hr); g.globalAlpha = 1;   // тень капюшона на лбу
    ruff(g, L, fx, fy, rx + 0.4, ry + 0.35, hr, frost);
  }
  // открытое лицо вариантов героя: тень глазниц под лбом (без точек), светлый лоб, нос с тенью, румянец на скуле, щетина
  function faceV(g, L, fx, fy, hr, s, frost) {
    const q = 1 - s, two = s > 0.15, mx = two ? fx + FC * q * 0.8 : fx + FC * K * 0.9, w = lerp(1.7, 2.7, s);
    const nx = mx + FC * (two ? lerp(1, 0, s) : w * 0.45), sp = lerp(0.55, 1.05, s);   // нос; расстояние глазниц от носа
    if (!LQ) { g.globalAlpha = 0.5; g.fillStyle = C(L.cheek); g.beginPath(); g.ellipse(mx - FC * q * 0.5 - (s > 0.6 ? 1.2 : 0.2), fy + 0.7, lerp(0.8, 0.75, s), 0.58, 0, 0, PI * 2); if (s > 0.6) { g.moveTo(mx + 1.95, fy + 0.7); g.ellipse(mx + 1.2, fy + 0.7, 0.75, 0.58, 0, 0, PI * 2); } g.fill(); }   // румянец на скулах
    g.fillStyle = C(L.faceS); g.globalAlpha = P.eyes ? 0.34 : 0.44;   // глазницы — мягкие тёмные ямки у переносицы, тень под носом
    g.beginPath(); g.ellipse(nx - FC * sp * (two ? 1 : 0.8), fy - 0.55, lerp(0.55, 0.7, s), P.eyes ? 0.3 : 0.5, 0, 0, PI * 2);
    if (s > 0.35) { g.moveTo(nx + sp + 0.6, fy - 0.55); g.ellipse(nx + FC * sp, fy - 0.55, 0.6 * s, P.eyes ? 0.3 : 0.5, 0, 0, PI * 2); }
    g.rect(nx - 0.2 + FC * 0.15, fy + 0.6, 0.8, 0.35); g.fill();
    g.globalAlpha = 0.7; g.fillStyle = C(L.faceL); g.fillRect(nx - 0.35 - FC * 0.1, fy - 0.35, 0.7, 1);   // спинка носа к свету
    if (L.stubble) { g.globalAlpha = L.stubble > 1 ? 0.42 : 0.3; ell(g, mx + FC * q * 0.3, fy + 1.75, w * 0.55, 0.8, '#3a2e28', hr); }
    if (P.mouth > 0.3) { g.globalAlpha = 0.75; g.fillStyle = '#3a2018'; g.fillRect(mx - 0.5 + FC * q * 0.4, fy + 1.45, 1, 0.35 + P.mouth * 0.4); }
    if (frost > 0.4) { g.globalAlpha = 0.9; g.fillStyle = '#f2f6fa'; g.fillRect(mx - 0.9, fy - 1.4, 1.8, 0.45); }
    g.globalAlpha = 1;
  }

  function face(g, L, fx, fy, hr, s, frost) {
    const q = 1 - s, two = s > 0.15, mx = two ? fx + FC * q * 0.8 : fx + FC * K * 0.9, w = lerp(1.3, 2.6, s);
    // глаза — одна тёмная полоса в тени лба (закрыты — тоньше)
    g.globalAlpha = P.eyes ? 0.4 : 0.6; g.fillStyle = '#2a2018'; g.fillRect(mx - w / 2 + (two ? 0 : FC * 0.3), fy - 0.75, w, P.eyes ? 0.5 : 0.8); g.globalAlpha = 1;
    if (L.glasses) { g.fillStyle = '#27394a'; g.fillRect(mx - w / 2 - 0.3, fy - 0.95, w + 0.6, 0.45); g.fillStyle = 'rgba(221,230,238,0.7)'; g.fillRect(mx - w / 2, fy - 0.9, 0.6, 0.4); }
    if (L.beard) ell(g, mx, fy + 2.4, lerp(1.6, 1.9, s), 1.4, C(L.beard), hr);   // ниже полосы глаз остаётся полоска кожи
    else if (L.stubble) { g.fillStyle = 'rgba(58,46,40,0.3)'; g.fillRect(mx - 1.3, fy + 1.1, 2.6, 1.1); }
    if (P.mouth > 0.3 && !L.beard) { g.fillStyle = 'rgba(58,32,24,0.7)'; g.fillRect(mx - 0.5 + FC * q * 0.4, fy + 1.3, 1, 0.4 + P.mouth * 0.4); }
    if (frost > 0.4) { g.fillStyle = '#f2f6fa'; g.fillRect(mx - 0.9, fy - 1.3, 1.8, 0.5); }
  }

  // ---------- корпус ----------
  // зерно ткани — фиксированный узор (не мерцает)
  const GRN = (() => { let q = 12345; const a = []; for (let i = 0; i < 52; i++) { q = (q * 1103515245 + 12345) & 0x7fffffff; a.push(q / 0x7fffffff); } return a; })();
  const HEMJ = [0.55, -0.25, 0.5];   // неровный подол: провисы между точками
  const tW = s => [lerp(6, 6.8, s), lerp(5.3, 6.8, s)];   // перёд/спина от оси корпуса: по плечам 12–13.6
  function drawTorso(g, L, vyv, beads) {
    const s = S;
    pr(P.hx, P.hy, 0); const Hx = QX, Hy = QY;
    const nx = P.hx + Math.sin(P.lean) * (TORSO + P.bz), ny = P.hy - Math.cos(P.lean) * (TORSO + P.bz);
    pr(nx, ny, 0); const Nx = QX, Ny = QY;
    let ux = Nx - Hx, uy = Ny - Hy; const ln = Math.hypot(ux, uy) || 1; ux /= ln; uy /= ln;
    const fnx = -uy * FC, fny = ux * FC; // «вперёд» на экране
    const [F0, B] = tW(s), F = F0 + P.br * 0.2;
    // подол: парка −15, ватник у бедра, тулуп/доха/кухлянка — ниже колена (−9)
    const hv = L.hem != null, sw = L.shW || 0;   // варианты героя: свой подол и плечи (иначе прежние числа)
    const D = hv ? L.hem : L.long ? 11 : L.quilt ? 4 : 5, hF = F + (hv ? L.flare : L.long ? 1.1 : 0.6), hB = B + (hv ? L.flare * 0.8 : L.long ? 0.9 : 0.4);
    const pt = (base, ou, of) => [base[0] + ux * ou + fnx * of, base[1] + uy * ou + fny * of];
    // шаг: плечи скручены навстречу тазу (вперёд/назад по ходу; в анфас/со спины уходит в глубину — не видно);
    // подол: выносимое бедро толкает переднюю полу вперёд-вверх (длиннее пола — сильнее), отставшее — заднюю назад
    const vk = 1 - 0.8 * s, twT = 5.9 * P.tw * vk, twH = 4 * P.prot * vk;
    let hf = 0, hb = 0;
    if (P.st0 >= 0 && (P.lg0[6] || P.lg1[6])) for (const G of [P.lg0, P.lg1]) {
      const th = PI / 2 - G[6], fw = D * Math.tan(clamp(th, -0.9, 0.9));
      hf = Math.max(hf, 0.18 * fw + Math.max(0, fw - hF + 0.6) * 0.8); hb = Math.max(hb, -0.14 * fw);
    }
    hf *= vk; hb *= vk;
    const Hb = [Hx, Hy], Nb = [Nx, Ny];
    const A = pt(Hb, -D + hf * 0.35, hF + hf + twH), Bp = pt(Nb, -2.4, F - 0.6 + sw + twT), Ct = pt(Nb, 1.6, twT), Dp = pt(Nb, -2.4, -(B - 0.3 + sw) + twT), E = pt(Hb, -D + hb * 0.2, -hB - hb + twH);
    const midF = pt(Hb, ln * 0.5 - (L.long ? 2 : 0), F + 0.5 + sw * 0.4 + (twT + twH) / 2), midB = pt(Hb, ln * 0.5 - (L.long ? 2 : 0), -(B + 0.2 + sw * 0.4) + (twT + twH) / 2);
    const cF = pt(Nb, 1.4, F - 0.8 + sw * 0.7 + twT), cB = pt(Nb, 1.4, -(B - 0.6 + sw * 0.7) + twT);
    const jk = L.long || L.shag ? 1.4 : 1, HP = [0.25, 0.5, 0.75].map((t, i) => { const q = pt([lerp(E[0], A[0], t), lerp(E[1], A[1], t)], -(0.65 * Math.sin(PI * t) + HEMJ[i] * jk), 0); return q; });
    const hemPath = () => { g.moveTo(E[0], E[1]); for (const q of HP) g.lineTo(q[0], q[1]); g.lineTo(A[0], A[1]); };
    const trace = () => {
      g.beginPath(); g.moveTo(A[0], A[1]);
      g.quadraticCurveTo(midF[0], midF[1], Bp[0], Bp[1]); g.quadraticCurveTo(cF[0], cF[1], Ct[0], Ct[1]);
      g.quadraticCurveTo(cB[0], cB[1], Dp[0], Dp[1]); g.quadraticCurveTo(midB[0], midB[1], E[0], E[1]);
      for (const q of HP) g.lineTo(q[0], q[1]); g.closePath();
    };
    g.fillStyle = C(L.body); trace(); g.fill();
    const sg = fnx + fny > 0 ? 1 : -1;
    if (LQ) {   // слабый пресет: 2 тона — теневая половина одним пятном, строчка без обрезки по силуэту
      const c = sg > 0 ? [cF, Bp, midF, A] : [cB, Dp, midB, E], m = pt(Nb, -1, (F - B) * 0.2);
      g.globalAlpha = 0.4; g.fillStyle = C(L.dark); g.beginPath(); g.moveTo(Ct[0], Ct[1]); g.quadraticCurveTo(c[0][0], c[0][1], c[1][0], c[1][1]); g.quadraticCurveTo(c[2][0], c[2][1], c[3][0], c[3][1]);
      g.lineTo(HP[1][0], HP[1][1]); g.lineTo(m[0], m[1]); g.closePath(); g.fill(); g.globalAlpha = 1;
      if (POL) { const a = pt(Hb, ln * 0.64, -B + 0.6), b = pt(Hb, ln * 0.64, F - 0.6), m = pt(Hb, ln * 0.64 - 1.1, (F - B) / 2); g.strokeStyle = C(L.refl); g.lineWidth = 1.3; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(m[0], m[1], b[0], b[1]); g.stroke(); }   // светоотражающая лента — и на слабом пресете
      if (L.quilt) { g.strokeStyle = C(L.stitch); g.lineWidth = 0.8; g.beginPath(); for (let ou = -D + 1.2; ou < ln - 2.5; ou += L.qStep || 2.5) { const l1 = pt(Hb, ou, -B + 0.7), l2 = pt(Hb, ou, F - 0.7); g.moveTo(l1[0], l1[1]); g.lineTo(l2[0], l2[1]); } g.stroke(); }
    } else {
    // объём внутри силуэта: свет сверху-слева экрана, мягкий спад вправо (3 ступени по 15 %), тень под капюшоном и у подола
    g.save(); trace(); g.clip();
    const cx = (Hx + Nx) / 2, W = F + B, top = Math.min(Ny, Hy) - 8, hh = ln + D + 16;
    if (POL) polTorso(g, L, pt, Hb, Nb, ln, D, F, B, W, cx, top, hh, hemPath);
    else {
    g.fillStyle = C(L.dark);
    g.globalAlpha = 0.15; for (let i = 0; i < 3; i++) g.fillRect(cx - W * 0.08 + W * 0.2 * i, top, 30, hh);   // 3 ступени по 15 %
    g.fillStyle = C(L.bodyL); g.globalAlpha = 0.16; g.fillRect(cx - 30 - W * 0.26, top, 30, hh);
    g.globalAlpha = 1;
    }
    if (L.quilt) {   // строчка ватника: 1 px, на 12 % темнее, шаг 2.5
      g.strokeStyle = C(L.stitch); g.lineWidth = 0.8; g.beginPath();
      for (let ou = -D + 1.2; ou < ln - 1; ou += L.qStep || 2.5) { const l1 = pt(Hb, ou, -B - 3), l2 = pt(Hb, ou, F + 3); g.moveTo(l1[0], l1[1]); g.lineTo(l2[0], l2[1]); }
      g.stroke();
    }
    if (!hv) for (let k = 0; k < 2; k++) {   // зерно: две заливки (тёмные и светлые крапинки)
      g.fillStyle = k ? 'rgba(236,242,246,0.06)' : 'rgba(12,20,30,0.08)'; g.beginPath();   // мелко и слабо: на 1× почти не видно, на крупном — фактура
      for (let i = k ? 0 : 1; i < 26; i += k ? 3 : 1) { if (!k && i % 3 === 0) continue; const q = pt(Hb, -D + (ln + D) * GRN[i * 2], (GRN[i * 2 + 1] - 0.5) * W * 1.1 + (F - B) / 2); g.rect(q[0], q[1], 0.6, 0.45); }
      g.fill();
    }
    if (!hv) {   // складки от пояса вниз
      g.strokeStyle = C(L.dark); g.lineWidth = 0.6; g.globalAlpha = 0.32; g.beginPath();
      for (let i = 0; i < 3; i++) { const t = -0.5 + i * 0.5 + 0.1, f1 = pt(Hb, -D + 0.6, t * W * 0.8), f2 = pt(Hb, ln * (0.3 + 0.06 * i), t * W * 0.55 + 0.8); g.moveTo(f1[0], f1[1]); g.quadraticCurveTo((f1[0] + f2[0]) / 2 + 0.6, (f1[1] + f2[1]) / 2, f2[0], f2[1]); }
      g.stroke();
    }
    // у подола темнее (земля), под капюшоном/шапкой — тень на плечах
    g.strokeStyle = C(L.dark); g.globalAlpha = POL ? 0.34 : 0.42; g.lineWidth = 4; g.beginPath(); hemPath(); g.stroke();
    if (POL) { g.strokeStyle = C(L.bounce); g.globalAlpha = 0.3; g.lineWidth = 1.5; g.beginPath(); hemPath(); g.stroke(); }   // рефлекс снега по низу подола
    const nk = pt(Nb, 0.4, (F - B) * 0.3); g.globalAlpha = L.hood && !L.hoodDown ? 0.42 : 0.26; ell(g, nk[0], nk[1], W * 0.42, 2.2, C(L.dark));
    if (L.armSep) {   // тень рук на корпусе (свет сверху-слева): тёмный тон со сдвигом вниз-вправо, только в пределах куртки — не обводка
      g.globalAlpha = 0.36; g.fillStyle = C(L.dark); g.beginPath();
      for (let i = 0; i < 2; i++) { if (!ASH[i]) continue; armPts(i); taperP(g, AQ[0] + 1, AQ[1] + 0.8, AQ[2] + 1, AQ[3] + 0.8, 4.3, 3.9); taperP(g, AQ[2] + 1, AQ[3] + 0.8, AQ[4] + 0.9, AQ[5] + 0.8, 3.9, 3.3); }
      g.fill();
    }
    g.globalAlpha = 1; g.restore();
    }
    const ld = sg > 0 ? [cB, Dp, midB, E] : [cF, Bp, midF, A];
    // контровой по освещённому краю: плечо и верхние 60% бока (низ — в тени от земли)
    if (RIM >= 0.03) {
      const q0 = ld[1], q1 = ld[2], q2 = ld[3], k = 0.6, cx1 = lerp(q0[0], q1[0], k), cy1 = lerp(q0[1], q1[1], k);
      const ex = (1 - k) * (1 - k) * q0[0] + 2 * (1 - k) * k * q1[0] + k * k * q2[0], ey = (1 - k) * (1 - k) * q0[1] + 2 * (1 - k) * k * q1[1] + k * k * q2[1];
      g.globalAlpha = RIM * 0.8; g.strokeStyle = C('#dde6ee'); g.lineWidth = 0.9; g.beginPath(); g.moveTo(Ct[0], Ct[1]);
      g.quadraticCurveTo(ld[0][0], ld[0][1], q0[0], q0[1]); g.quadraticCurveTo(cx1, cy1, ex, ey); g.stroke(); g.globalAlpha = 1;
    }
    // подол
    if (L.shag) {
      g.strokeStyle = C(mix(L.trim, L.body, 0.6)); g.lineWidth = 0.8; g.globalAlpha = 0.85; g.beginPath();
      for (let i = 0; i <= 7; i++) { const t = i / 7, bx = lerp(E[0], A[0], t), by = lerp(E[1], A[1], t) + 0.6; g.moveTo(bx, by - 1.2); g.lineTo(bx - ux * (1.2 + (i % 3) * 0.5) + (i % 2 ? 0.4 : -0.4), by - uy * (1.2 + (i % 3) * 0.5)); }
      g.stroke(); g.globalAlpha = 1;
    } else if (!L.quilt) {
      const th = L.hood && !L.pocket; g.strokeStyle = C(th ? mix(L.trim, L.body, 0.55) : L.dark); g.lineWidth = th ? 1.2 : 1; g.beginPath(); hemPath(); g.stroke();
    }
    if (L.patch && !BACK) { const pc = pt(Hb, ln * 0.55, F * 0.1); g.fillStyle = C(L.patch); g.fillRect(pc[0] - 1.6, pc[1] - 1.3, 3.2, 2.6); g.strokeStyle = C(L.dark); g.lineWidth = 0.5; g.strokeRect(pc[0] - 1.6, pc[1] - 1.3, 3.2, 2.6); }
    if (L.belt) {
      const b1 = pt(Hb, 2.4, -B - 0.2), b2 = pt(Hb, 2.4, F + 0.4); g.strokeStyle = C(L.belt); g.lineWidth = 1.3; g.beginPath(); g.moveTo(b1[0], b1[1]); g.lineTo(b2[0], b2[1]); g.stroke();
      if (!BACK) { const bk = pt(Hb, 2.4, F * 0.45); g.fillStyle = C('#6b6862'); g.fillRect(bk[0] - 0.6, bk[1] - 0.7, 1.2, 1.4); }
    }
    // лямка сидора через грудь по диагонали
    if (L.pack && !BACK && !L.packType) { const a1 = pt(Nb, -1.4, -B + 1.4), a2 = pt(Hb, 1.2, F - 0.4); g.strokeStyle = C(mix(L.pack, '#10141c', 0.35)); g.lineWidth = 1.1; g.beginPath(); g.moveTo(a1[0], a1[1]); g.lineTo(a2[0], a2[1]); g.stroke(); }
    if (L.packType) heroFront(g, L, pt, Nb, Hb, ln, F, B, D, E, A, ux, uy);
    if (beads) {
      const cols = ['#7a3a30', '#4a6468', '#9c9078']; const n = 7;
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, bx = lerp(E[0], A[0], t) + ux * 2.4, by = lerp(E[1], A[1], t) + uy * 2.4 + 0.6; g.fillStyle = cols[i % 3]; g.fillRect(bx - 0.6, by - 0.6, 1.2, 1.2); }
      if (!BACK) { const c1 = pt(Nb, -2.2, F * 0.2); g.fillStyle = '#8a3a2e'; g.fillRect(c1[0] - 1.5, c1[1], 3, 1); g.fillStyle = '#4a6468'; g.fillRect(c1[0] - 1, c1[1] + 1, 2, 0.9); }
    }
    if (FRONT && !L.quilt && !L.ornament) { const z1 = pt(Nb, -1.5, (F - B) / 2), z2 = pt(Hb, -D + 0.5, (hF - hB) / 2); g.strokeStyle = C(L.dark); g.lineWidth = 0.8; g.beginPath(); g.moveTo(z1[0], z1[1]); g.lineTo(z2[0], z2[1]); g.stroke(); }
    // снежная пыль на подоле
    if (!LQ) {   // несколько мелких мягких точек, не пунктир
      g.fillStyle = 'rgba(246,249,252,0.35)'; g.beginPath();
      for (let i = 0; i < 4; i++) { const t = 0.15 + GRN[i + 40] * 0.7, bx = lerp(E[0], A[0], t) + ux * (0.6 + GRN[i + 44]), by = lerp(E[1], A[1], t) + uy * (0.6 + GRN[i + 44]) + 0.5, r = 0.35 + 0.2 * GRN[i + 48]; g.moveTo(bx + r, by); g.arc(bx, by, r, 0, PI * 2); }
      g.fill();
    }
    return { Hx, Hy, Nx, Ny, ux, uy, fnx, fny, F, B, E, A };
  }
  // объём анорака полярника (внутри силуэта корпуса): светоотражающая лента на груди/спине, пуховые секции (у каждой
  // освещённый верх и тень над строчкой), свет сверху-слева и тень справа ступенями, тень от рюкзака по спинке
  function polTorso(g, L, pt, Hb, Nb, ln, D, F, B, W, cx, top, hh, hemPath) {
    const mid = (F - B) / 2, bow = (ou, dy) => { const a = pt(Hb, ou, -B - 3), b = pt(Hb, ou, F + 3), m = pt(Hb, ou - dy, mid); g.moveTo(a[0], a[1]); g.quadraticCurveTo(m[0], m[1], b[0], b[1]); };
    const rb = ln * 0.64;   // лента на груди (и на спине — та же высота)
    g.strokeStyle = C(L.refl); g.lineWidth = 1.35; g.lineCap = 'butt'; g.beginPath(); bow(rb, 1.1); g.stroke();
    if (DET) { g.strokeStyle = C(L.reflL); g.lineWidth = 0.35; g.beginPath(); bow(rb + 0.35, 1.1); g.stroke(); }
    // секции: строчка каждые 2.7 px (над лентой — одна у плеч)
    g.strokeStyle = C(L.dark); g.lineWidth = 1; g.globalAlpha = 0.3; g.beginPath();
    for (let ou = -D + 2.4; ou < ln - 1.5; ou += 2.7) if (Math.abs(ou - rb) > 1.2) bow(ou + 0.35, 0.9);
    g.stroke();
    g.strokeStyle = C(L.bodyH); g.lineWidth = 0.9; g.globalAlpha = 0.24; g.beginPath();
    for (let ou = -D + 2.4; ou < ln - 1.5; ou += 2.7) if (Math.abs(ou - rb) > 1.2) bow(ou - 0.55, 0.9);
    g.stroke();
    // свет и тень по цилиндру корпуса: серпы с изогнутым терминатором (тень справа тремя ступенями, свет и блик слева)
    const o = pt(Hb, (ln - D) / 2, mid), ux = (Nb[0] - Hb[0]) / ln, uy = (Nb[1] - Hb[1]) / ln, rot = Math.atan2(uy, ux) + PI / 2, rx = W / 2 + 0.6, ry = (ln + D) / 2 + 2.5;
    const dk = C(L.dark); shadeEll(g, o[0], o[1], rx, ry, rot, 0.55, dk, 0.2); shadeEll(g, o[0], o[1], rx, ry, rot, 0.05, dk, 0.17); shadeEll(g, o[0], o[1], rx, ry, rot, -0.42, dk, 0.13);
    shadeEll(g, o[0], o[1], rx, ry, rot + PI, 0.3, C(L.bodyL), 0.26); if (DET) shadeEll(g, o[0], o[1] - ry * 0.25, rx, ry * 0.6, rot + PI, 0.72, C(L.bodyH), 0.24);
    if (L.pack && !FRONT && !BACK) {   // рюкзак за спиной загораживает небо: тень вдоль спинки
      const a = pt(Nb, -1, -B + 0.4), b = pt(Hb, -D + 1.5, -B + 0.2); g.strokeStyle = C(L.dark); g.globalAlpha = 0.38; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    g.lineCap = 'round'; g.globalAlpha = 1;
  }
  // варианты героя: лямки ноши поверх груди, карман анорака, узор по подолу кухлянки
  const ORN = ['#7a3a30', '#d8cbae', '#3e5a5c'];
  function heroFront(g, L, pt, Nb, Hb, ln, F, B, D, E, A, ux, uy) {
    const s = S, fr = FRONT && !BACK;
    if (L.pocket && !BACK && !LQ) {   // карман-«кенгуру» спереди: темнее ткани, клапан светлее
      const c = fr ? 0 : F * 0.35, w = fr ? 3.4 : 2.2, q1 = pt(Hb, 0.6, c - w), q2 = pt(Hb, 0.6, c + w), q3 = pt(Hb, 5, c + w - 0.5), q4 = pt(Hb, 5, c - w + 0.5);
      g.globalAlpha = 0.45; g.fillStyle = C(L.dark); g.beginPath(); g.moveTo(q1[0], q1[1]); g.lineTo(q2[0], q2[1]); g.lineTo(q3[0], q3[1]); g.lineTo(q4[0], q4[1]); g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
    if (L.ornament) {   // узор по подолу: тёмная полоса, цветные клетки, светлая нитка над ней
      const at = (t, h) => [lerp(E[0], A[0], t) + ux * h, lerp(E[1], A[1], t) + uy * h + 0.5];
      g.strokeStyle = C('#4a2e22'); g.lineWidth = 2.2; g.lineCap = 'butt'; g.beginPath(); let q = at(0.04, 1.5); g.moveTo(q[0], q[1]); q = at(0.96, 1.5); g.lineTo(q[0], q[1]); g.stroke();
      if (!LQ) { g.strokeStyle = C(L.trim); g.lineWidth = 0.6; g.globalAlpha = 0.8; g.beginPath(); q = at(0.04, 3); g.moveTo(q[0], q[1]); q = at(0.96, 3); g.lineTo(q[0], q[1]); g.stroke(); g.globalAlpha = 1; }
      g.lineCap = 'round';
      for (let k = 0; k < 2; k++) { g.fillStyle = C(ORN[k]); g.beginPath(); for (let i = k; i < 9; i += 2) { q = at((i + 0.6) / 9.6, 1.5); g.rect(q[0] - 0.55, q[1] - 0.55, 1.1, 1.1); } g.fill(); }
      if (!BACK) {   // нагрудник: тёмный клин с тремя клетками
        const c = fr ? 0 : F * 0.45, n1 = pt(Nb, -1.2, c - 1.3), n2 = pt(Nb, -1.2, c + 1.3), n3 = pt(Nb, -5.2, c);
        g.fillStyle = C('#4a2e22'); g.beginPath(); g.moveTo(n1[0], n1[1]); g.lineTo(n2[0], n2[1]); g.lineTo(n3[0], n3[1]); g.closePath(); g.fill();
        if (!LQ) { const m = pt(Nb, -2.3, c); g.fillStyle = C(ORN[1]); g.fillRect(m[0] - 0.45, m[1] - 0.45, 0.9, 0.9); }
      }
    }
    if (BACK || P.pko) return;
    const pk = L.packType, sc = C(POL ? mix(L.pack, '#10141c', 0.3) : mix(L.pack, '#10141c', pk === 'frame' ? 0.5 : 0.3));
    const SX = LQ ? 0 : P.pkx * 0.4, SYp = LQ ? 0 : P.pky * 0.4;   // лямки тянет за рюкзаком (низ)
    const straps = (ox, oy) => {
      g.beginPath();
      if (pk === 'bag') {   // ремень сумки через плечо по диагонали
        const a1 = pt(Nb, -0.8, -B * 0.3), a2 = pt(Hb, 0.6, fr ? F - 1 : F - 0.2); g.moveTo(a1[0] + ox, a1[1] + oy); g.lineTo(a2[0] + ox, a2[1] + oy);
      } else if (s > 0.6) {   // к камере: две лямки от плеч к подмышкам
        for (const of of [F * 0.5, -B * 0.5]) { const a1 = pt(Nb, -0.5, of * 0.8), a2 = pt(Nb, -7.2, of * 1.05); g.moveTo(a1[0] + ox, a1[1] + oy); g.lineTo(a2[0] + ox + SX, a2[1] + oy + SYp); }
        if (pk === 'frame') { const c1 = pt(Nb, -4.2, F * 0.5), c2 = pt(Nb, -4.2, -B * 0.5); g.moveTo(c1[0] + ox, c1[1] + oy); g.lineTo(c2[0] + ox, c2[1] + oy); }
      } else {   // боком: ближняя лямка через плечо вперёд, к подмышке
        const a1 = pt(Nb, -0.3, -B * 0.25), a2 = pt(Nb, -1.6, F * 0.45), a3 = pt(Nb, -7, F * 0.5);
        g.moveTo(a1[0] + ox, a1[1] + oy); g.quadraticCurveTo(a2[0] + ox + SX * 0.4, a2[1] + oy + SYp * 0.4, a3[0] + ox + SX, a3[1] + oy + SYp);
      }
      g.stroke();
    };
    if (POL && DET) { g.strokeStyle = C(L.dark); g.globalAlpha = 0.4; g.lineWidth = 1.6; straps(0.7, 0.7); g.globalAlpha = 1; }   // тень лямок на ткани
    g.strokeStyle = sc; g.lineWidth = pk === 'frame' ? (POL ? 1.5 : 1.3) : 1.1; straps(0, 0);
    if (POL && s > 0.6 && !LQ) { const c1 = pt(Nb, -4.2, (F - B) * 0.25); g.fillStyle = '#1a1d22'; g.fillRect(c1[0] - 0.7, c1[1] - 0.55, 1.4, 1.1); }   // пряжка нагрудной стяжки
  }
  let HERO = false, HWOOD = 0, HFILL = 0.5, HPK = 0;   // герой: чурок снаружи (Inv.packOut), набитость внутри 0..1 (Inv.fill), рюкзак, кг
  // рюкзак героя от набитости: пустой — осел (ниже и тоньше), полный — клапан выше, бока круглее; nb — у остальных людей
  const pkTop = nb => (HERO ? lerp(1.28, 1.66, HFILL) : nb), pkW = nb => (HERO ? lerp(3.1, 4.5, HFILL) : nb), pkWb = nb => (HERO ? lerp(4.4, 5.4, HFILL) : nb);
  // чурки снаружи: поперёк рюкзака на клапане, рядом по глубине, два ремня клапана поверх. q(a, of) — точка рюкзака (a — доля корпуса
  // от таза вверх, of — вперёд/назад), top — верх клапана, of/w — середина и полутолщина; ctr — со спины/к камере (видно поперёк)
  const CHR = 1.6, CHL = 10.8;   // чурка на рисунке: радиус (13 см), длина (0,45 м)
  // чурки поперёк (вбок от взгляда) боком: в ¾ видно, что это полено — кора вдоль, ближний торец светлый; c — середины (экран),
  // ремни — тёмные полосы поперёк чурок по их длине (за ±¼), из-под них — к клапану (lo — точки клапана под чурками)
  function logsX(g, c, lo) {
    const sv = Math.max(S, 0.62), lx = FC * sv * (LS || -1) * CHL / 2, ly = Math.max(LZ, 0.2) * CHL / 2 + 0.4, bark = C('#5b3d27'), bark2 = C('#6b4c31'), face = C('#e0b47a'), ring = C('#c79a62'), st = C('#2a2e34');
    g.lineCap = 'butt';
    c.forEach(([x, y], i) => { g.strokeStyle = i % 2 ? bark2 : bark; g.lineWidth = CHR * 2; g.beginPath(); g.moveTo(x - lx, y - ly); g.lineTo(x + lx, y + ly); g.stroke();
      if (!LQ) { g.strokeStyle = C('#3a2618'); g.lineWidth = 0.5; g.beginPath(); g.moveTo(x - lx, y - ly + CHR * 0.75); g.lineTo(x + lx, y + ly + CHR * 0.75); g.stroke(); } });
    g.strokeStyle = st; g.lineWidth = 0.7;
    for (const k of [-0.45, 0.45]) { g.beginPath(); const p0 = lo[0], p1 = lo[1]; g.moveTo(p0[0] + lx * k, p0[1] + ly * k); for (const [x, y] of c) g.lineTo(x + lx * k, y + ly * k - CHR - 0.2); g.lineTo(p1[0] + lx * k, p1[1] + ly * k); g.stroke(); }
    for (const [x, y] of c) { const fx = x + lx, fy = y + ly; ell(g, fx, fy, CHR * 0.8, CHR, face, 0); if (!LQ) { ell(g, fx, fy, 0.5, 0.62, ring, 0); } }
    g.lineCap = 'round';
  }
  const DBG = { logs: 0, off: 0, fill: 0 };   // для проверок (tests/items-check.js): сколько чурок нарисовано снаружи, снят ли рюкзак, набитость
  function lashed(g, q, top, of, w, ctr, n) {
    n = Math.min(n, 2); if (n <= 0) return; if (HERO) DBG.logs = n;
    const bark = C('#5b3d27'), bark2 = C('#6b4c31'), face = C('#e0b47a'), st = C('#2a2e34'), rA = CHR / 14.6;
    if (!ctr) {   // боком: две чурки поперёк рядом по глубине, ремни клапана — через них к клапану спереди и сзади
      const c = []; for (let i = 0; i < n; i++) c.push(q(top + rA + 0.01, of + (n > 1 ? (i ? 0.5 : -0.5) : 0) * w));
      logsX(g, c, [q(top - 0.02, of - w * 0.95), q(top - 0.02, of + w * 0.95)]);
      return;
    }
    // со спины/лицом: брусья поперёк, задний чуть выше (лежит дальше), торцы светлые, два ремня клапана вертикально поверх
    g.lineCap = 'butt';
    for (let i = n - 1; i >= 0; i--) { const a = top + rA + 0.01 + i * rA * 1.1, l = q(a, of - w * 1.12), r = q(a, of + w * 1.12);
      g.strokeStyle = i ? bark : bark2; g.lineWidth = CHR * 2; g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(r[0], r[1]); g.stroke();
      if (!LQ) { g.strokeStyle = C('#3a2618'); g.lineWidth = 0.5; g.beginPath(); g.moveTo(l[0], l[1] + CHR * 0.7); g.lineTo(r[0], r[1] + CHR * 0.7); g.stroke(); }
      ell(g, l[0], l[1], 0.8, CHR * 0.95, face, 0); ell(g, r[0], r[1], 0.8, CHR * 0.95, face, 0); }
    g.strokeStyle = st; g.lineWidth = 0.9; g.beginPath();
    for (const d of [-0.5, 0.5]) { const a1 = q(top - 0.04, of + d * w), a2 = q(top + rA * (n > 1 ? 3.3 : 2.2) + 0.02, of + d * w); g.moveTo(a1[0], a1[1]); g.lineTo(a2[0], a2[1]); }
    g.stroke(); g.lineCap = 'round';
  }
  // снятый рюкзак (js/carry.js G.hand.off; позы снять/надеть/уложить — P.pko): стоит на снегу лямками от героя, клапан открывается к герою;
  // k = { x, y — низ (риг), rot — наклон, open 0..1, st — лямка на плече (0..1), z — 0 за корпусом, 1 перед }. Боком (рисунок в плоскости хода).
  function drawPackOff(g, L, k) {
    const pk = L.packType, d = pkW(4.2) * (pk === 'sack' ? 1.1 : 1), Hb = pkTop(1.5) * 14.6 - 2.2, col = C(L.pack), dk = C(mix(L.pack, '#10141c', 0.35)), lt = C(mix(L.pack, '#c8d8ea', 0.15));
    const cs = Math.cos(k.rot || 0), sn = Math.sin(k.rot || 0), F = k.f || 1;   // риг уже по взгляду: лямки (спинка) — на +u, к +x рига (перед героем — от него, на спине — к нему)
    const at = (u, v) => { u *= F / Math.max(0.5, K);   /* толщина — как у рюкзака на спине (там без сжатия ракурсом) */ pr(k.x + u * cs + v * sn, k.y + u * sn - v * cs, 0); return [QX, QY]; };
    const path = pts => { g.beginPath(); pts.forEach((p, i) => { const q = at(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); };
    if (k.gnd > 0.5) { at(0, 0); g.globalAlpha = 0.28; ell(g, QX, QY + 0.6, d + 2.5, 1.6, '#27394a', 0); g.globalAlpha = 1; }
    // корпус: дно шире, верх скруглён; набитый — бока выпуклые
    const bu = lerp(0.2, 1.1, HFILL);
    g.fillStyle = col; path(pk === 'sack' ? [[-d * 0.8, 0], [d * 0.8, 0], [d + bu, Hb * 0.45], [d * 0.55, Hb], [-d * 0.55, Hb], [-d - bu, Hb * 0.45]] : [[-d, 0.3], [d, 0.3], [d + bu, Hb * 0.5], [d, Hb], [-d, Hb], [-d - bu * 0.4, Hb * 0.5]]); g.fill();
    if (!LQ) { g.globalAlpha = 0.35; g.fillStyle = dk; path([[d * 0.25, 0.3], [d, 0.3], [d + bu, Hb * 0.5], [d, Hb], [d * 0.25, Hb]]); g.fill(); g.globalAlpha = 1; }
    // лямки (сторона от героя: u > 0 при F) — петлями; каркас — стойка
    g.strokeStyle = C(mix(L.pack, '#10141c', 0.5)); g.lineWidth = 1.2; g.beginPath();
    { const a = at(d, Hb - 2.5), b = at(d + 2.6, Hb * 0.55), c = at(d, Hb * 0.22); g.moveTo(a[0], a[1]); g.quadraticCurveTo(b[0], b[1], c[0], c[1]); } g.stroke();
    if (pk === 'frame') { g.strokeStyle = C('#2a2e34'); g.lineWidth = 0.9; g.beginPath(); const a = at(d + 0.3, -0.8), b = at(d + 0.3, Hb + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    if (!LQ) { g.strokeStyle = dk; g.lineWidth = 0.7; g.beginPath(); for (const v of [Hb * 0.34, Hb * 0.72]) { const a = at(-d - 0.2, v), b = at(d + 0.2, v); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); } g.stroke(); }   // стяжки
    // лямка на плече (снимает/надевает): от верха спинки к плечу
    if (k.st > 0) { const a = at(d, Hb - 2.5); pr(P.sx, P.sy + 1, 0); g.strokeStyle = C(mix(L.pack, '#10141c', 0.5)); g.lineWidth = 1.2; g.globalAlpha = Math.min(1, k.st * 2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(QX, QY); g.stroke(); g.globalAlpha = 1; }
    // горловина: открыта — тёмный зев и светлый кант; клапан на петле у спинки (u = d) откинут от героя — зев к нему
    const op = clamp(k.open || 0, 0, 1);
    if (op > 0.05) { const a = at(0, Hb); ell(g, a[0], a[1], d * K * 0.95 + 0.6, 1.1 + 0.5 * S, C(L.packD || mix(L.pack, '#0a1220', 0.45)), 0); g.strokeStyle = lt; g.lineWidth = 0.7; g.beginPath(); g.ellipse(a[0], a[1], d * K * 0.95 + 0.6, 1.1 + 0.5 * S, 0, PI, PI * 2); g.stroke(); }
    // клапан (+ скатка, + чурки снаружи — притянуты к нему): поворот вокруг петли у спинки на угол op·2.9 (откинут назад, за спинку)
    const ang = op * 2.9, hx = d, hv = Hb, lid = (u, v) => { const du = u - hx, dv = v - hv, c = Math.cos(ang), s2 = Math.sin(ang); return [hx + du * c + dv * s2, hv - du * s2 + dv * c]; };
    const lp = pts => path(pts.map(p => lid(p[0], p[1])));
    g.fillStyle = lt; lp([[-d - 0.4, Hb - 0.3], [d + 0.3, Hb - 0.3], [d, Hb + 2.2], [-d + 0.3, Hb + 2.2]]); g.fill();
    let top = Hb + 2.2;
    if (pk === 'frame') { const r = lid(0, top + 1.3), q0 = at(r[0], r[1]); ell(g, q0[0], q0[1], (d + 0.6) * K + 0.4, 1.5, C(L.roll || '#7a4034'), 0); top += 2.6; }
    const n = Math.min(2, HWOOD); if (HERO) { DBG.logs = n; DBG.off = 1; }
    if (n > 0) {
      const P2 = (u, v) => { const r = lid(u, v); return at(r[0], r[1]); }, c = [];
      for (let i = 0; i < n; i++) c.push(P2(n > 1 ? (i ? 1 : -1) * d * 0.5 : 0, top + CHR));
      logsX(g, c, [P2(-d, top - 0.4), P2(d, top - 0.4)]);
    }
  }
  // варианты героя: сидор (мешок), каркасный рюкзак со скаткой, сумка на бедре. back — вид со спины (после корпуса)
  function drawPackV(g, L, T, back) {
    const { Hx, Hy, Nx, Ny, ux, uy, fnx, fny, B } = T, pk = L.packType, col = C(L.pack), dk = C(mix(L.pack, '#10141c', 0.35));
    // рюкзак висит на лямках: низ отстаёт/подскакивает сильнее верха (пружина, P.pkx/pky — смещение низа, px экрана)
    const ra = LQ ? 0 : P.pka;   // угол мешка (пружина): поворот вокруг верха у шеи
    const q = (a, of) => { const w = 1 - 0.65 * clamp(a, 0, 1.3), x = lerp(Hx, Nx, a) + fnx * of + P.pkx * w, y = lerp(Hy, Ny, a) + fny * of + P.pky * w; return ra ? [x - ra * (y - Ny), y + ra * (x - Nx)] : [x, y]; };   // a — доля от таза к шее, of — вперёд (минус — за спину)
    const rot = Math.atan2(uy, ux) + PI / 2, ctr = back || S >= 0.55, ow = ctr ? 0 : 1;
    if (pk === 'sack') {
      const sk = HERO ? lerp(0.82, 1.12, HFILL) : 1, c = ctr ? q(0.5 * sk, 0) : q(0.52 * sk, -B - 2.4 * sk), rx = (ctr ? 5.3 : 3.5) * sk, ry = (ctr ? 5.4 : 5.2) * sk;
      if (!back && ctr) return;   // к камере мешок целиком за спиной
      ell(g, c[0], c[1], rx, ry, col, rot);
      if (!LQ) shadeEll(g, c[0], c[1], rx, ry, rot, 0.2, dk, 0.4);
      const nk = ctr ? q(0.98 * sk, 0) : q(0.98 * sk, -B - 1.4 * sk);   // горловина, стянутая шнуром
      ell(g, nk[0], nk[1], 1.9, 1.2, dk, rot);
      if (HWOOD > 0 && (back || !ctr)) lashed(g, q, 1.02 * sk, ctr ? 0 : -B - 2.4 * sk, rx * 0.8, ctr, HWOOD);
      if (back && !LQ) {   // лямки со спины к низу мешка
        g.strokeStyle = dk; g.lineWidth = 1; g.beginPath();
        for (const sd of [-1, 1]) { const a1 = q(1.02, 0), a2 = q(0.2, 0); g.moveTo(a1[0] + sd * 2.6, a1[1]); g.lineTo(a2[0] + sd * 4.4, a2[1] + 0.8); }
        g.stroke();
      }
      return;
    }
    if (pk === 'frame') {
      // у героя — экспедиционный 80 л: глубже (×1.7) и выше (над головой вместе со скаткой); NPC — прежний
      const w = ctr ? pkWb(4.6) : pkW(2.4), of = ctr ? 0 : -B - 0.1 - w, bot = HERO ? 0 : 0.06;
      const top = pkTop(ctr ? 1.12 : 1.16), p1 = q(top, of - w), p2 = q(top, of + w), p3 = q(bot, of + w + 0.3 * ow), p4 = q(bot, of - w - 0.3 * ow);
      if (POL && back && !LQ) { g.globalAlpha = 0.3; g.fillStyle = C(L.dark); g.beginPath(); g.moveTo(p1[0] + 1, p1[1] + 1.4); g.lineTo(p2[0] + 1, p2[1] + 1.4); g.lineTo(p3[0] + 1, p3[1] + 1.6); g.lineTo(p4[0] + 1, p4[1] + 1.6); g.closePath(); g.fill(); g.globalAlpha = 1; }   // тень рюкзака на анорак
      g.fillStyle = col; g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); g.fill();
      if (POL && !LQ && !(ctr && !back)) polPack(g, L, q, of, w, top);
      else if (!LQ && !(ctr && !back)) {   // объём: тень справа, карман по центру
        g.globalAlpha = 0.35; g.fillStyle = dk; g.beginPath(); const m1 = q(top, of + w * 0.3), m2 = q(0.06, of + w * 0.3); g.moveTo(m1[0], m1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(m2[0], m2[1]); g.closePath();
        const k1 = q(0.62, of - w * 0.6), k2 = q(0.62, of - w * 0.05), k3 = q(0.22, of - w * 0.05), k4 = q(0.22, of - w * 0.6);   // карман — левее тени, та же заливка
        g.moveTo(k1[0], k1[1]); g.lineTo(k2[0], k2[1]); g.lineTo(k3[0], k3[1]); g.lineTo(k4[0], k4[1]); g.closePath(); g.fill(); g.globalAlpha = 1;
      }
      // каркас: тёмные стойки по краям (со спины) или одна у спины (боком), ниже мешка
      if (!back && ctr) { if (HWOOD > 0) lashed(g, q, top + 0.18, of, w, true, HWOOD); return; }   // к камере рюкзак за спиной: виден только верх над плечами (и чурки на нём)
      g.strokeStyle = C('#2a2e34'); g.lineWidth = 0.9; g.beginPath();
      for (const sd of ctr ? [-1, 1] : [1]) { const f1 = q(top + 0.12, of + sd * (w + 0.2)), f2 = q(bot - 0.14, of + sd * (w + 0.4)); g.moveTo(f1[0], f1[1]); g.lineTo(f2[0], f2[1]); }
      g.stroke();
      const r = q(top + 0.06, of), rw = ctr ? w + 1.2 : 2, rh = ctr ? 1.6 : 1.8;   // скатка сверху: со спины — поперёк, боком — торцом
      ell(g, r[0], r[1] - 0.5, rw, rh, C(L.roll || '#7a4034'), 0);
      if (POL && !LQ) {   // скатка: тень снизу-справа, блик сверху, два ремешка
        shadeEll(g, r[0], r[1] - 0.5, rw, rh, 0, 0.1, C('#1a1e14'), 0.35); g.globalAlpha = 0.4; ell(g, r[0] - rw * 0.3, r[1] - 0.5 - rh * 0.45, rw * 0.5, rh * 0.3, C('#e8ecd8'), 0); g.globalAlpha = 1;
        if (ctr && DET) { g.strokeStyle = C(L.packD); g.lineWidth = 0.6; g.beginPath(); for (const d of [-0.5, 0.5]) { g.moveTo(r[0] + d * rw, r[1] - 0.5 - rh); g.lineTo(r[0] + d * rw, r[1] - 0.5 + rh); } g.stroke(); }
      }
      if (HWOOD > 0) lashed(g, q, top + 0.18, of, w, ctr, HWOOD);   // на скатке, под ремнями клапана
      return;
    }
    // bag: кожаная сумка у бедра за спиной
    const c = ctr ? q(0.12, 3.2) : q(0.14, -B - 0.6);
    ell(g, c[0], c[1], 2.6, 2.3, col, rot); if (!LQ) shadeEll(g, c[0], c[1], 2.6, 2.3, rot, 0.2, dk, 0.45);
  }
  // рюкзак полярника: свет слева, тень справа, клапан сверху, стяжки, боковой карман, рефлекс снега по низу
  function polPack(g, L, q, of, w, top) {
    const quad = (a0, a1, o0, o1) => { const p1 = q(a1, o0), p2 = q(a1, o1), p3 = q(a0, o1), p4 = q(a0, o0); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); };
    g.fillStyle = C(L.packD); g.globalAlpha = 0.5; g.beginPath(); quad(0.06, top, of + w * 0.35, of + w); g.fill();
    g.globalAlpha = 0.3; g.beginPath(); quad(0.06, top, of - w * 0.05, of + w * 0.35); quad(0.62, 0.22, of - w * 0.62, of - w * 0.08); g.fill();   // карман
    g.fillStyle = C(L.packL); g.globalAlpha = 0.45; g.beginPath(); quad(0.1, top - 0.02, of - w, of - w * 0.62); g.fill();
    g.globalAlpha = 0.9; g.beginPath(); quad(top - 0.2, top, of - w + 0.2, of + w - 0.2); g.fillStyle = C(mix(L.pack, '#c8d8ea', 0.12)); g.fill();   // клапан
    g.strokeStyle = C(L.packD); g.globalAlpha = 0.85; g.lineWidth = 0.7; g.lineCap = 'butt'; g.beginPath();
    for (const a of [0.34, 0.74]) { const p1 = q(a, of - w - 0.2), p2 = q(a, of + w + 0.2); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); }
    g.stroke();
    g.strokeStyle = C(L.bounce); g.globalAlpha = 0.4; g.lineWidth = 0.8; g.beginPath(); const b1 = q(0.08, of - w + 0.3), b2 = q(0.08, of + w - 0.3); g.moveTo(b1[0], b1[1] - 0.4); g.lineTo(b2[0], b2[1] - 0.4); g.stroke();
    g.globalAlpha = 1; g.lineCap = 'round';
  }
  function drawPack(g, L, T, back) {
    if (L.packType) { drawPackV(g, L, T, back); return; }
    let { Hx, Hy, Nx, Ny, ux, uy, fnx, fny, B } = T;
    Hx += P.pkx; Hy += P.pky; Nx += P.pkx * 0.35; Ny += P.pky * 0.35;   // низ мешка отстаёт сильнее
    g.fillStyle = C(L.pack); g.beginPath();
    if (back) {
      const px = (a, b) => [lerp(Hx, Nx, a) - fny * 0 + (-uy) * b, lerp(Hy, Ny, a) + ux * b];
      const tp = pkTop(0.95) - (HERO ? 0.12 : 0), p1 = px(tp, -4.6), p2 = px(tp, 4.6), p3 = px(0.12, 5), p4 = px(0.12, -5);
      g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); g.fill();
      g.fillStyle = C(mix(L.pack, '#000000', 0.25)); g.fillRect(lerp(Hx, Nx, 0.5) - 3.5, lerp(Hy, Ny, 0.5), 7, 3);
      ell(g, lerp(Hx, Nx, tp + 0.1), lerp(Hy, Ny, tp + 0.1), 5.2, 1.7, C('#56646e'));
      if (HWOOD > 0) lashed(g, (a, of) => px(a, of), tp + 0.2, 0, 4.6, true, HWOOD);
    } else {
      const q = (a, of) => [lerp(Hx, Nx, a) + fnx * of, lerp(Hy, Ny, a) + fny * of], D = HERO ? lerp(6.2, 9, HFILL) : 5, tp = pkTop(0.92) - (HERO ? 0.12 : 0);   // герой — глубже и выше (по набитости)
      const p1 = q(tp, -B + 0.8), p2 = q(tp, -B + 0.8 - D), p3 = q(0.1, -B + 0.4 - D), p4 = q(0.1, -B + 0.4);
      g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath(); g.fill();
      const r = q(tp + 0.1, -B + 0.8 - D / 2); ell(g, r[0], r[1], D * 0.6, 1.7, C('#56646e'));
      if (HWOOD > 0) lashed(g, q, tp + 0.2, -B + 0.6 - D / 2, D / 2, false, HWOOD);
    }
  }

  // ---------- конечности ----------
  // цилиндр: тонкий свет по верхне-левой кромке, тёмная — по нижне-правой (одна нормаль на всю ломаную)
  const EP = [0, 0, 0, 0, 0, 0];
  function edges(g, n, w, lc, dc) {
    if (LQ) return;   // слабый пресет: без кромок света/тени на рукавах и штанинах
    const dx = EP[n * 2 - 2] - EP[0], dy = EP[n * 2 - 1] - EP[1], l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l; if (nx + ny > 0) { nx = -nx; ny = -ny; }
    const o = w * 0.5 - 0.6;
    g.lineCap = 'butt'; g.lineWidth = 1;
    for (let k = 0; k < 2; k++) {
      const q = k ? -o : o; g.strokeStyle = k ? dc : lc; g.globalAlpha = k ? 0.5 : 0.55;
      g.beginPath(); g.moveTo(EP[0] + nx * q, EP[1] + ny * q); for (let i = 1; i < n; i++) g.lineTo(EP[i * 2] + nx * q, EP[i * 2 + 1] + ny * q); g.stroke();
    }
    if (POL && DET) {   // рефлекс снега по нижней кромке (крупный план; на общем — по подолу корпуса) (голубоватый, тоньше тени)
      const q = -(w * 0.5 - 0.3); g.strokeStyle = C('#a9c8e6'); g.globalAlpha = 0.34; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(EP[0] + nx * q, EP[1] + ny * q); for (let i = 1; i < n; i++) g.lineTo(EP[i * 2] + nx * q, EP[i * 2 + 1] + ny * q); g.stroke();
    }
    g.globalAlpha = 1; g.lineCap = 'round';
  }
  // сужающийся сегмент (экран): трапеция w0 → w1 с круглыми концами, одна заливка
  function taper(g, x0, y0, x1, y1, w0, w1, col) { g.fillStyle = col; g.beginPath(); taperP(g, x0, y0, x1, y1, w0, w1); g.fill(); }
  // контур сегмента в текущий путь (несколько сегментов одного цвета — одной заливкой: намотка у всех одна)
  function taperP(g, x0, y0, x1, y1, w0, w1) {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * 0.5, ny = dx / l * 0.5;
    g.moveTo(x0 + nx * w0, y0 + ny * w0); g.lineTo(x1 + nx * w1, y1 + ny * w1); g.lineTo(x1 - nx * w1, y1 - ny * w1); g.lineTo(x0 - nx * w0, y0 - ny * w0); g.closePath();
    // концы — той же намоткой, что трапеция (она всегда против часовой на экране), иначе nonzero вырезает дырку
    g.moveTo(x1 + w1 / 2, y1); g.arc(x1, y1, w1 / 2, 0, -PI * 2, true); g.moveTo(x0 + w0 / 2, y0); g.arc(x0, y0, w0 / 2, 0, -PI * 2, true);
  }
  function leg(g, L, i, near) {
    const fa = i ? P.f1a : P.f0a, lat0 = i ? -LEGW : LEGW, fy = i ? P.f1y : P.f0y;
    // стопа: закреплённая точка (plant) в координатах рига или поза как есть
    const fx = (P.pk ? (i ? P.pf1x : P.pf0x) : i ? P.f1x : P.f0x) + (i ? P.rx1 : P.rx0), lat = P.pk ? (i ? P.pl1 : P.pl0) : lat0;
    // тазобедренный сустав: скрут таза (ближний вперёд при prot > 0) и наклон таза (свободная сторона ниже)
    const hx = P.hx + (i ? -1 : 1) * P.prot * LEGW, hy = P.hy + (i ? 1 : -1) * 0.3 * P.ob;
    // закреплённая стопа чуть дальше вылета — нога тянется (до 12 %), а не отпускает опору
    let l1 = TH, l2 = SHN;
    if (P.pk) { const d = Math.hypot(fx - hx, fy - hy), mx = TH + SHN - 0.02; if (d > mx) { const k = Math.min(1 + 0.12 * WL, d / mx + 0.001); l1 *= k; l2 *= k; } }
    ik(hx, hy, fx, fy, l1, l2, -1);
    const kx = KX, ky = KY, ax = EX, ay = EY, lk = lat;
    const LG = i ? P.lg1 : P.lg0; prL(hx, hy, lat0 * 0.9); LG[0] = QX; LG[1] = QY; lp(kx, ky, lk); LG[2] = QX; LG[3] = QY; lp(ax, ay, lat); LG[4] = QX; LG[5] = QY; LG[6] = Math.atan2(ky - hy, kx - hx); LG[7] = Math.atan2(ay - ky, ax - kx); LG[8] = fa;
    // бедро 4.2 → колено 3.6 → голень 3.3 (к снегу темнее); валенок 3.8 — от середины голени
    taper(g, LG[2], LG[3], LG[4], LG[5], 3.6, 3.3, C(near ? L.pantsLow : L.pantsFarLow));   // голень под бедром: колено — светлым концом бедра
    taper(g, LG[0], LG[1], LG[2], LG[3], 4.2, 3.7, C(near ? L.pants : L.pantsFar));
    if (near) { EP[0] = LG[0]; EP[1] = LG[1]; EP[2] = LG[2]; EP[3] = LG[3]; lp(lerp(kx, ax, 0.5), lerp(ky, ay, 0.5), lerp(lk, lat, 0.5)); EP[4] = QX; EP[5] = QY; edges(g, 3, 3.9, C(L.pantsL), C(L.pantsD)); }
    // валенок/унт
    const bc = C(near ? L.boots : L.bootsFar), bh = L.bootH != null ? L.bootH : 0.4, bw = L.bootW || 3.8;
    if (L.knee && near && !LQ) { g.globalAlpha = 0.85; ell(g, LG[2] + 0.3, LG[3] + 0.4, 2, 1.6, C(L.knee), LG[7] + 0.3); g.globalAlpha = 1; }   // наколенник
    lp(lerp(kx, ax, bh), lerp(ky, ay, bh), lerp(lk, lat, bh)); const bx = QX, by = QY;
    lp(ax + Math.cos(fa) * 3.1, ay + 1.1 + Math.sin(fa) * 3.1, lat); const tx = QX, ty = QY;
    LG[9] = tx; LG[10] = ty; lp(ax, 0, lat); LG[11] = QX; LG[12] = QY; LG[13] = (i ? P.st1 : P.st0) === 1 ? 1 : 0;   // носок, снег под щиколоткой, опора
    if (L.bootH != null) { g.fillStyle = bc; g.beginPath(); taperP(g, bx, by, LG[4], LG[5], bw, 3.8); taperP(g, LG[4], LG[5], tx, ty, 3.8, 3.3); g.fill(); }
    else { taper(g, bx, by, LG[4], LG[5], bw, 3.8, bc); taper(g, LG[4], LG[5], tx, ty, 3.8, 3.3, bc); }
    g.globalAlpha = 0.35; g.fillStyle = C(mix(L.boots, '#10141c', 0.4)); g.fillRect(bx - 1.8, by - 0.2, 3.6, 0.7); g.globalAlpha = 1;   // край голенища
    if (L.bootTrim) { const tb = L.bootH != null ? bh + 0.04 : 0.55; g.strokeStyle = C(L.bootTrim); g.lineWidth = L.bootH != null ? 1.4 : 1.1; g.beginPath(); lp(lerp(kx, ax, tb) - 1.8, lerp(ky, ay, tb), lerp(lk, lat, tb)); g.moveTo(QX, QY); lp(lerp(kx, ax, tb) + 1.8, lerp(ky, ay, tb), lerp(lk, lat, tb)); g.lineTo(QX, QY); g.stroke(); }
    // складка на колене, снег на носке и голенище
    if (near && !LQ) { g.strokeStyle = C(L.pantsD); g.globalAlpha = 0.45; g.lineWidth = 0.6; g.beginPath(); g.moveTo(LG[2] - 1.6, LG[3] + 0.3); g.lineTo(LG[2] + 0.5, LG[3] - 0.3); g.moveTo(LG[2] - 1.3, LG[3] + 1.3); g.lineTo(LG[2] + 1.1, LG[3] + 0.9); g.stroke(); g.globalAlpha = 1; }
    // снег на носке — мягкий налёт, на голенище — пара мелких точек
    g.fillStyle = 'rgba(246,249,252,0.35)'; g.beginPath(); g.ellipse(tx - 0.5, ty + 0.8, 1.3, 0.45, 0, 0, PI * 2);
    if (!LQ) { g.moveTo(LG[4] - 0.6, LG[5] - 1.2); g.arc(LG[4] - 1, LG[5] - 1.2, 0.4, 0, PI * 2); g.moveTo(LG[4] + 1.15, LG[5] - 0.3); g.arc(LG[4] + 0.8, LG[5] - 0.3, 0.35, 0, PI * 2); }
    g.fill();
  }
  // рука: IK от плечевого сустава (joint); рукав пуховика сужается от плеча к обшлагу, верх рукава — плоский овал поперёк корпуса
  // (плечо куртки, не вращается с рукой), а не круглая «шляпка» на конце трубки; рукав начинается чуть ниже сустава (плечо не торчит
  // над воротом); варежка ≈0.09 H.
  // ADEP — рука свободна (ходьба/покой, без предмета): в виде со спины/анфас мах вперёд-назад уходит в глубину. Проекция честная:
  // вынос по глубине на экране x — как у корпуса (сжатие AKA ≥ 0.3, было 0.18 — иначе кисть бега уходит наружу), по y — глубина × sin φ (φ ≈ 0.5: камера сверху ¾, ASY):
  // кисть к камере — ниже и чуть крупнее (AMS = 1 + 0.05·d/FA), от камеры — выше, но варежка не выше ≈0.6 длины руки под плечом
  // (кисть опускается, локоть раскрывается — рука не «подогнута»); локоть к камере — чуть наружу
  const ADEP = [0, 0], AL = [0, 0, 0], APHI = 0.55, ALIM = 0.46;
  let AKA = 1, ARL = 0, ASY = 0, AMS = 1;
  // крен корпуса (P.roll): рука висит с плеча — вся рука сдвигается вбок вместе с плечевым суставом (ARL), а не скашивается по высоте,
  // как корпус в pr (иначе предплечье, ушедшее в глубину, на экране ломается вбок)
  function pq(fx, y, lat) { const r = P.roll; P.roll = 0; pr(fx, y, lat + ARL); P.roll = r; }
  function pa(fx, y, lat) { const d = fx - JX, f = JX + d * AKA; pq(f, y + d * (ASY - AKA * SY), lat); }   // экран: y + JX·SY + d·ASY
  function armSolve(i, far) {   // KX,KY — локоть, EX,EY — кисть (в риге); AL — вбок: плечо, локоть, кисть
    const s = i ? -1 : 1, hl = i ? P.hl1 : P.hl0, d = ADEP[i], wv = d * sm((S - 0.4) / 0.55), sg = SY >= 0 ? 1 : -1;
    let hx = i ? P.h1x : P.h0x, hy = i ? P.h1y : P.h0y;
    joint(hx, hy, i);
    AKA = 1 - 0.7 * wv; ASY = lerp(SY, sg * APHI, wv); ARL = P.roll * clamp(P.hy - JY, 0, SHO);
    ik(JX, JY, hx, hy, UA, FA, 1);
    if (wv > 0 && sg * (EX - JX) < 0) {   // мах от камеры: запястье на экране не выше ALIM·(плечо+предплечье) под точкой плеча (как в arm)
      const dr = 0.7 + 1.2 * S * S, lim = ALIM * (UA + FA), ys = () => { pa(JX - Math.sin(P.lean) * dr, JY + Math.cos(P.lean) * dr, 0); const y0 = QY; pa(EX, EY, 0); return QY - y0; };
      if (ys() < lim) {   // кисть ведём к «рука висит» (под суставом), пока не опустится до предела: половинным делением доли пути
        const ax = EX, ay = EY, bx = JX + 0.4 * (EX - JX), by = JY + UA + FA - 0.3; let lo = 0, hi = 1;
        for (let k = 0; k < 7; k++) { const t = (lo + hi) / 2; ik(JX, JY, lerp(ax, bx, t), lerp(ay, by, t), UA, FA, 1); if (ys() < lim) lo = t; else hi = t; }
        const t = hi * wv; ik(JX, JY, lerp(ax, bx, t), lerp(ay, by, t), UA, FA, 1);
      }
    }
    AMS = 1 + 0.05 * wv * clamp(sg * (EX - JX) / FA, -1.2, 1.2);
    const fw = Math.max(0, EX - JX), ke = wv * 0.3 * Math.max(0, sg * (KX - JX)) / UA;
    AL[0] = s * 6; AL[1] = s * (6.5 + (far ? 2.2 * S : 0) + d * (0.5 - 0.05 * fw) + ke); AL[2] = s * (hl + (hl > 5 ? d * (0.2 - 0.12 * fw) : 0));   // рука за корпусом — локоть наружу, чтобы читался; свободная — локоть чуть в сторону (пуховик)
  }
  // экранные плечо/локоть/запястье руки i без побочных эффектов (для тени руки на корпусе); ASH — чья тень ляжет на куртку
  const AQ = [0, 0, 0, 0, 0, 0], ASH = [0, 0];
  function armPts(i) {
    armSolve(i); const ex = KX, ey = KY, wx = EX, wy = EY;
    pa(JX, JY, AL[0]); AQ[0] = QX; AQ[1] = QY; pa(ex, ey, AL[1]); AQ[2] = QX; AQ[3] = QY; pa(wx, wy, AL[2]); AQ[4] = QX; AQ[5] = QY;
  }
  function arm(g, L, i, near, fl, up) {   // up — только плечо (поверх корпуса; предплечье с варежкой ушли за корпус в глубину)
    const lat = i ? -1 : 1, hl = i ? P.hl1 : P.hl0;
    armSolve(i, fl);
    const ex = KX, ey = KY; if (i) { P.h1x = EX; P.h1y = EY; } else { P.h0x = EX; P.h0y = EY; }
    const sl = Math.sin(P.lean), cl = Math.cos(P.lean), dr = 0.7 + 1.2 * S * S;   // со спины/в анфас плечо ниже ворота — рука висит с угла плеча, не столбом до ушей
    pa(JX - sl * dr, JY + cl * dr, AL[0]); const sx = QX, sy = QY; pa(ex, ey, AL[1]); const e0 = QX, e1 = QY; pa(EX, EY, AL[2]); const wx = QX, wy = QY;
    // плечо куртки: овал поперёк оси корпуса у сустава — рукав выходит из него при любом махе
    pa(JX - sl * (dr - 0.55), JY + cl * (dr - 0.55), AL[0]); const kx = QX, ky = QY; pa(JX - sl * (dr - 1.55), JY + cl * (dr - 1.55), AL[0]); const kr = Math.atan2(QY - ky, QX - kx) + PI / 2;
    const ux = sx - e0, uy = sy - e1, ul = Math.hypot(ux, uy) || 1;
    // варежка ≈2.2×1.75 дальше запястья по предплечью — рукав наполовину закрывает кисть; кончик — проекция точки в риге
    // (предплечье в глубину — варежка короче на экране, а не «крючок» вдоль короткого отрезка)
    const dx = wx - e0, dy = wy - e1, dl = Math.hypot(dx, dy) || 1;
    pa(EX + (EX - ex) / FA * MT, EY + (EY - ey) / FA * MT, AL[2]); const tx = QX - wx, ty = QY - wy, tl = Math.hypot(tx, ty);
    if (!up) ell(g, wx + tx * 0.42, wy + ty * 0.42, Math.max(1.75, 0.58 * tl) * AMS, 1.75 * AMS, C(near ? L.mitt : L.mittFar), Math.atan2(ty, tx));   // AMS — ближе к камере крупнее
    const AR = i ? P.ar1 : P.ar0; AR[0] = sx; AR[1] = sy; AR[2] = e0; AR[3] = e1; AR[4] = wx; AR[5] = wy; AR[6] = wx + tx; AR[7] = wy + ty;
    AR[8] = Math.atan2(ex - JX, ey - JY); AR[9] = Math.atan2(EX - ex, EY - ey) - AR[8]; AR[10] = Math.hypot(EX - JX, EY - JY); AR[11] = -(EY + (EY - ey) / FA * MT); AR[12] = AMS;   // кончик варежки над снегом (риг)
    const col = C(L.armSep ? (near ? L.sleeve : L.sleeveFar) : near ? L.body : L.far);
    g.fillStyle = col; g.beginPath();
    g.moveTo(kx + Math.cos(kr) * 2.55, ky + Math.sin(kr) * 2.55); g.ellipse(kx, ky, 2.55, 1.8, kr, 0, -PI * 2, true);   // та же намотка, что у taperP
    taperP(g, sx, sy, e0, e1, 4.6, 3.8); if (!up) taperP(g, e0, e1, wx, wy, 3.7 * (1 + (AMS - 1) * 0.5), 3.15 * AMS); g.fill();
    if (up) { if (near) { EP[0] = kx; EP[1] = ky; EP[2] = e0; EP[3] = e1; edges(g, 2, 3.9, C(L.armL), C(L.dark)); } pq(EX, EY, lat * hl); return; }
    if (near) { EP[0] = kx; EP[1] = ky; EP[2] = e0; EP[3] = e1; EP[4] = lerp(e0, wx, 0.7); EP[5] = lerp(e1, wy, 0.7); edges(g, 3, 3.9, C(L.armL), C(L.dark)); }
    if (!LQ) {   // складка на сгибе локтя (внутренняя сторона угла) и шов плеча — рукав, а не две трубки на кнопке
      const vx = wx - e0, vy = wy - e1, vl = Math.hypot(vx, vy) || 1, ix = ux / ul + vx / vl, iy = uy / ul + vy / vl, il = Math.hypot(ix, iy);
      g.strokeStyle = C(L.dark); g.lineWidth = 0.6; g.beginPath();
      if (il > 0.25) { const qx = ix / il, qy = iy / il; g.globalAlpha = 0.45 * Math.min(1, (il - 0.25) * 2); g.moveTo(e0 + qx * 0.6 - qy * 0.7, e1 + qy * 0.6 + qx * 0.7); g.lineTo(e0 + qx * 1.7, e1 + qy * 1.7); g.stroke(); g.beginPath(); }
      g.globalAlpha = near ? 0.3 : 0.2; const nx = -uy / ul, ny = ux / ul, cx = lerp(sx, e0, 0.12), cy = lerp(sy, e1, 0.12);
      g.moveTo(cx + nx * 2.1, cy + ny * 2.1); g.quadraticCurveTo(cx - ux / ul * 0.7, cy - uy / ul * 0.7, cx - nx * 2.1, cy - ny * 2.1); g.stroke(); g.globalAlpha = 1;
    }
    if (POL && !LQ) polSleeve(g, L, near, sx, sy, e0, e1, wx, wy);
    if ((L.cuff ? !LQ : L.hood && !L.hoodDown) && near) { g.strokeStyle = C(L.cuff || mix(L.trim, L.body, 0.55)); g.lineWidth = L.cuff ? 1.3 : 0.8; g.lineCap = 'butt'; g.beginPath(); g.moveTo(wx - dy / dl * 1.75 - dx / dl * 0.5, wy + dx / dl * 1.75 - dy / dl * 0.5); g.lineTo(wx + dy / dl * 1.75 - dx / dl * 0.5, wy - dx / dl * 1.75 - dy / dl * 0.5); g.stroke(); g.lineCap = 'round'; }   // обшлаг
    pq(EX, EY, lat * hl);   // QX,QY — кисть (инструмент/ноша): без сжатия в глубину — свободная рука ничего не держит
  }

  // рукав полярника: пуховые секции поперёк, складки на сгибе локтя, светоотражающая лента на предплечье
  function polSleeve(g, L, near, sx, sy, e0, e1, wx, wy) {
    const ax = e0 - sx, ay = e1 - sy, al = Math.hypot(ax, ay) || 1, bx = wx - e0, by = wy - e1, bl = Math.hypot(bx, by) || 1;
    const cross = (x, y, dx, dy, l, h) => { const nx = -dy / l * h, ny = dx / l * h; g.moveTo(x + nx, y + ny); g.lineTo(x - nx, y - ny); };
    g.lineCap = 'butt';
    if (DET) {
    g.strokeStyle = C(L.dark); g.globalAlpha = near ? 0.26 : 0.2; g.lineWidth = 0.55; g.beginPath();
    for (const k of [0.38, 0.72]) cross(sx + ax * k, sy + ay * k, ax, ay, al, 1.75);
    cross(e0 + bx * 0.3, e1 + by * 0.3, bx, by, bl, 1.6);
    // сгиб локтя: две короткие складки от внутренней стороны угла
    const ix = -ax / al + bx / bl, iy = -ay / al + by / bl, il = Math.hypot(ix, iy);
    if (il > 0.35 && il < 1.95) { const ux = -ix / il, uy = -iy / il, px = -uy, py = ux;
      for (const d of [-0.55, 0.55]) { g.moveTo(e0 + ux * 1.5 + px * d, e1 + uy * 1.5 + py * d); g.lineTo(e0 + ux * 0.2 + px * d * 1.9, e1 + uy * 0.2 + py * d * 1.9); } }
    g.stroke(); g.globalAlpha = 1;
    }
    g.strokeStyle = C(near ? L.refl : L.reflFar); g.lineWidth = 1.1; g.beginPath(); cross(e0 + bx * 0.62, e1 + by * 0.62, bx, by, bl, 1.62); g.stroke();
    g.lineCap = 'round';
  }

  // ---------- реквизит ----------
  function drawProp(g, kind, o) {
    if (kind === 'box') {
      g.fillStyle = C('#765436'); g.beginPath(); M(g, -6.5, -10, 0); Ln(g, 3, -10, 0); Ln(g, 3, 0, 0); Ln(g, -6.5, 0, 0); g.closePath(); g.fill();
      g.fillStyle = C('#5b3d27'); g.beginPath(); M(g, -6.5, -5.4, 0); Ln(g, 3, -5.4, 0); Ln(g, 3, -4.3, 0); Ln(g, -6.5, -4.3, 0); g.closePath(); g.fill();
      if (!o.target) { pr(15.5, 0.5, 0); ell(g, QX, QY, 5.4, 2.4, '#dde6ee'); ell(g, QX, QY, 4, 1.6, '#2f3542'); }
    } else if (kind === 'log') {
      g.strokeStyle = C('#5b3d27'); g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); M(g, -8, -4.4, -3); Ln(g, 5, -4.4, 3); g.stroke();
      pr(5, -4.4, 3); ell(g, QX, QY, 3.2, 3.9, C('#c79a62'));
      g.strokeStyle = '#f6f9fc'; g.lineWidth = 1.6; g.beginPath(); M(g, -8, -8.3, -3); Ln(g, 4, -8.3, 3); g.stroke();
    } else if (kind === 'plank') {
      // верх доски с шириной (со спины/в анфас доска уходит в глубину, а не схлопывается в палку)
      g.fillStyle = C('#b38c5c'); g.beginPath(); M(g, 5.5, -3, -3); Ln(g, 20, -3, -3); Ln(g, 20, -3, 3); Ln(g, 5.5, -3, 3); g.closePath(); g.fill();
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
      ell(g, hx, hy, 4.2, 3.9, C(L.hood)); softShade(g, hx, hy, 4.2, 3.9, 0, C(L.hoodD), 0.25);
      g.globalAlpha = 0.8; ell(g, hx + f * 0.6, hy - 1, 1.3, 1.6, '#2a2420', f * -0.9); g.globalAlpha = 1;
      ruff(g, L, hx + f * 0.6, hy - 1, 2.1, 2.4, f * -0.9, 0);
    } else {
      ell(g, hx, hy - 0.5, 3.1, 3.1, C(L.face)); softShade(g, hx, hy - 0.5, 3.1, 3.1, 0, C(L.faceD), 0.3);
      if (L.hat) ell(g, hx - f * 1.5, hy - 0.9, 2.5, 3.4, C(L.hat), f * 0.3);
      g.globalAlpha = 0.5; g.fillStyle = '#2a2018'; g.fillRect(hx + f * 0.8 - 0.8, hy - 1.2, 1.6, 0.5); g.globalAlpha = 1;
    }
    if (L.beard) ell(g, hx + f * 2.2, hy - 0.2, 1.5, 1.7, C(L.beard));
    ell(g, x0 + (f > 0 ? 5 : w - 5), y - 10.5 - br, 2.3, 2, C(L.mitt));
    const z = (t * 0.6) % 1;
    g.fillStyle = (env.night || 0) > 0.5 ? 'rgba(235,242,255,' : 'rgba(80,105,140,';
    g.fillStyle += (1 - z).toFixed(2) + ')';
    const zs = (7 + z * 5) / 10, zx = hx + f * (2 + z * 6), zy = hy - 9 - z * 12;
    g.strokeStyle = g.fillStyle; g.lineWidth = 1.4 * zs; g.lineJoin = 'miter'; g.beginPath();
    g.moveTo(zx - 3 * zs, zy - 6 * zs); g.lineTo(zx + 3 * zs, zy - 6 * zs); g.lineTo(zx - 3 * zs, zy); g.lineTo(zx + 3 * zs, zy); g.stroke(); g.lineJoin = 'round';
  }

  // ---------- память фигуры (o.key): смешивание поз, поворот, спина с гистерезисом ----------
  // BL — поля позы, которые плавно переходят при смене действия (0.13 с, A5; удары/замахи — 0.05 с, чтобы не съесть замах).
  // Смешивается итоговая поза (после факела/ноши/посоха/второй руки на топорище), в память пишется показанная.
  // Кисти — в полярных координатах от плеча (линейно кисть проходила бы сквозь плечо и выворачивала локоть),
  // угол инструмента — по кратчайшему пути.
  const MEM = new WeakMap(), BL = ['hx', 'hy', 'lean', 'tilt', 'f0x', 'f0y', 'f0a', 'f1x', 'f1y', 'f1a', 'sx', 'sy', 'hl0', 'hl1', 'hb', 'gap', 'hlat', 'rx0', 'rx1', 'roll', 'prot', 'tw', 'ob'];
  const BLEND = 0.13, BLEND_HIT = 0.05, TURN = 0.24, VLAG = 0.08, TLAG = 0.07;   // VLAG — полураспад ракурса корпуса за ногами, TLAG — корпус меняет сторону позже ног
  const HIT = { swing: 1, chop: 1, chopHeavy: 1, chopCold: 1, chopLow: 1, throw: 1, kick: 1, build: 1, dig: 1, shoot: 1, hurt: 1, flinch: 1, stagger: 1 };
  const wrapA = d => d - 2 * PI * Math.round(d / (2 * PI));   // (−π, π]
  function memOf(o) {
    if (!o.key || typeof o.key !== 'object') return null;
    let m = MEM.get(o.key);
    if (!m) { m = { anim: null, last: {}, from: null, t0: -9, dur: BLEND, tdur: BLEND, bd: [null, null, null], face: o.face < 0 ? -1 : 1, fromFace: 1, turnT: -9, back: false, front: false, t: o.t || 0,
        wl: 0, pt: o.t || 0, ft: [{ st: false, wx: 0, wy: 0, ox: 0, oy: 0, o0x: 0, o0y: 0 }, { st: false, wx: 0, wy: 0, ox: 0, oy: 0, o0x: 0, o0y: 0 }],
        dt0: -9, ddt: 0, px: o.x || 0, py: o.y || 0, vx: 0, vy: 0, vs: 0, acc: 0, th: 0, om: 0, ex: 0, bph: ((o.seed || 0) * 0.37) % 1, gw: 1, fresh: true, sp: new Float64Array(2 * NSP), dl: 0, dp: 0, rx: 0, ry: 0 }; MEM.set(o.key, m); }
    return m;
  }

  // ---------- этап 4: вес и инерция (вторичное движение) ----------
  // Затухающие пружины 2-го порядка (частота f Гц, затухание z): полунеявный Эйлер с подшагами ≤ 1/120 с — от dt, не от FPS.
  // Состояние — в памяти фигуры (mm.sp: [y, y'] на пружину). До позы (dynPre): скорость/ускорение/поворот фигуры в мире,
  // усталость дыхания, пружины от движения в мире (наклон от ускорения, присед, крен в поворот, топор на ремне).
  // После смешивания (dynPost): прибавки к показанной позе (только ходьба/покой/возня — в работе поза как есть: топор бьёт в ствол),
  // вдох (плечи), запаздывание головы, рюкзак/ворот/помпон от шеи и головы. В low — без ворота, помпона, лямок.
  const NSP = 13;
  const FIDG = { stamp: 1, rubHands: 1, blowHands: 1, adjustPack: 1, lookAround: 1, wipeNose: 1, yawn: 1, stretch: 1, listen: 1, talkHero: 1, shiver: 1, brushSnow: 1 };
  const EXERT = { run: 1, chop: 0.85, chopHeavy: 0.85, chopCold: 0.8, chopLow: 0.85, dig: 0.8, trudge: 0.7, pry: 0.7, build: 0.5, shield: 0.4, pickUpHeavy: 0.6, swing: 0.6 };
  function spr(s, j, x, f, z, dt) {
    if (!(dt > 0)) return s[j];
    const w = 2 * PI * f, k1 = z / (PI * f), k2 = 1 / (w * w), n = Math.ceil(dt * 120 - 1e-6), h = dt / n, k2s = Math.max(k2, h * h / 2 + h * k1 / 2, h * k1);
    for (let q = 0; q < n; q++) { s[j] += h * s[j + 1]; s[j + 1] += h * (x - s[j] - k1 * s[j + 1]) / k2s; }
    return s[j];
  }
  let MMD = null;
  const scl = (v, m) => m * Math.tanh(v / m);   // мягкий предел (без излома на кривой)
  const SPR = (i, x, f, z) => { const m = MMD, s = m.sp, j = i * 2; if (m.fresh) { s[j] = x; s[j + 1] = 0; return x; } return spr(s, j, x, f, z, m.ddt); };
  function dynPre(mm, o, anim, t, ph) {
    MMD = mm;
    const rt = t - mm.dt0, x = o.x || 0, y = o.y || 0; mm.dt0 = t;
    let dt = rt > 0 ? Math.min(rt, 0.05) : 0;
    if (rt >= 0.25 || rt < 0 || (x - mm.px) ** 2 + (y - mm.py) ** 2 > 1600) { mm.fresh = true; mm.vx = mm.vy = mm.vs = mm.acc = mm.om = 0; dt = 0; }
    if (dt > 0) {
      const e = 1 - Math.exp(-dt / 0.05);
      mm.vx += ((x - mm.px) / rt - mm.vx) * e; mm.vy += ((y - mm.py) / rt - mm.vy) * e;
      const v = Math.hypot(mm.vx, mm.vy), a = (v - mm.vs) / dt; mm.vs = v;
      mm.acc += (a - mm.acc) * (1 - Math.exp(-dt / 0.06));
      if (v > 30) { const th = Math.atan2(mm.vy, mm.vx), w = wrapA(th - mm.th) / dt; mm.th = th; mm.om += (clamp(w, -12, 12) - mm.om) * (1 - Math.exp(-dt / 0.08)); }
      else { if (v > 5) mm.th = Math.atan2(mm.vy, mm.vx); mm.om *= Math.exp(-dt / 0.1); }
      const et = EXERT[anim] || 0; mm.ex += (et - mm.ex) * (1 - Math.exp(-dt / (et > mm.ex ? 7 : 16)));   // одышка: набирается за ≈7 с работы/бега, спадает ≈16 с
      mm.bph = (mm.bph + (0.25 + 0.4 * mm.ex + 0.1 * TIRE + (isLoco(anim) ? 0.08 : 0)) * dt) % 1;   // 0.25 Гц в покое → 0.65 после нагрузки
      mm.gw += ((isLoco(anim) || anim === 'idle' || FIDG[anim] ? 1 : 0) - mm.gw) * (1 - Math.exp(-dt / 0.08));
    }
    mm.px = x; mm.py = y; mm.ddt = dt;
    if (mm.fresh) mm.gw = isLoco(anim) || anim === 'idle' || FIDG[anim] ? 1 : 0;
    BRV = Math.sin(2 * PI * mm.bph);
    // наклон от ускорения: разгон — вперёд; резкое торможение — корпус по инерции вперёд, недодемпфированная пружина даёт перелёт и возврат назад
    const A = mm.acc, ap = clamp(A / 1500, 0, 1), an = clamp(-A / 1800, 0, 1);
    mm.dl = SPR(0, 0.17 * ap + 0.21 * an, 1.8, 0.32);
    mm.dp = SPR(1, 1.1 * ap + 1.1 * an, 3, 0.5);   // присед (сырая шкала таза): толчок со старта, гашение на остановке
    const ac = mm.om * mm.vs, cth = Math.cos(mm.th), sth = Math.sin(mm.th);
    mm.rx = SPR(2, 0.1 * clamp(-sth * ac / 900, -1, 1), 2, 0.6); mm.ry = SPR(3, 0.05 * clamp(cth * ac / 900, -1, 1), 2, 0.6);   // крен внутрь поворота
    mm.ax = A * cth - ac * sth; mm.ay = A * sth + ac * cth;   // ускорение фигуры на экране (для рюкзака)
    P.axw = SPR(9, clamp(A * 0.00022, -0.35, 0.35) + 0.1 * Math.sin(ph) * mm.wl, 1.9, 0.22);   // топор на ремне: маятник (разгон — топорище назад, шаг бедром)
  }
  function dynPost(mm, anim) {
    MMD = mm;
    if (anim === 'dead') { mm.fresh = false; return; }
    const w = mm.gw, dl = mm.dl * w, dp = mm.dp * w;
    P.dLean = dl; P.dDip = dp;
    if (dl || dp) {
      const l0 = P.lean, y0 = hipY(P.hy), nearT = P.tox !== null && Math.abs(P.tox - P.h1x) < 1e-6 && Math.abs(P.toy - P.h1y) < 1e-6;
      P.lean += dl; P.hy += dp;
      const dy = hipY(P.hy) - y0, dsx = SHO * (Math.sin(P.lean) - Math.sin(l0)), dsy = dy - SHO * (Math.cos(P.lean) - Math.cos(l0));
      P.sx += dsx; P.sy += dsy; P.h0x += dsx; P.h0y += dsy; P.h1x += dsx; P.h1y += dsy;   // руки свободны (ходьба/покой) — идут с плечом
      if (nearT) { P.tox += dsx; P.toy += dsy; }
      else if (P.tox !== null) { P.toy += dy; if (P.tk && !P.two) P.ta += dl; }   // за поясом/за спиной — с тазом
    }
    SHX = mm.rx * w; SHY = mm.ry * w;
    // вдох: плечи и шея вверх ±0.5 px (после нагрузки — чаще и глубже)
    P.bz = (0.45 + 0.25 * mm.ex) * BRV; const bzx = Math.sin(P.lean) * P.bz, bzy = -Math.cos(P.lean) * P.bz; P.sx += bzx; P.sy += bzy;
    if (w > 0) { P.h0x += bzx * w; P.h0y += bzy * w; P.h1x += bzx * w; P.h1y += bzy * w; }   // свободные руки поднимаются с плечами (иначе на вдохе локоть разгибается/сгибается)
    // голова догоняет корпус с запаздыванием
    const hx0 = P.lean + P.tilt, hl = scl(SPR(4, hx0, 3.6, 0.5) - hx0, 0.15); P.tilt += hl * 0.8; P.hlag = hl;
    // рюкзак: низ отстаёт от шеи (экран), от ускорения фигуры — назад/вперёд, на шаге — подскок с запаздыванием
    const TL = TORSO + P.bz, nX = P.hx + Math.sin(P.lean) * TL, nY = hipY(P.hy) - Math.cos(P.lean) * TL, xs = FC * K * nX, ys = nY + SY * nX;
    // герой (80 л): цель пружины — шея; от разгона — назад, от боковой скорости — чуть отстаёт (на остановке — перелёт),
    // со спины/спереди — вбок за тазом на шаге (P.hlat, усилено: мешок на лямках раскачивается шире корпуса); пределы 3 / 2 px, угол — своя пружина ±4°
    if (HERO) {
      const sw = 3 * FC * S * LS * P.hlat, ia = -scl(mm.ax * 1.1e-3, 2.2) - scl(mm.vx * 6e-3, 1);   // раскачка на шаге (3.2 Гц) и рывок/скорость (4.8 Гц — пик ≈0.1 с)
      P.pkx = scl(SPR(5, xs + sw, 3.2, 0.45) - xs + SPR(12, ia, 4.8, 0.42), 3);
      P.pky = scl(SPR(6, ys - scl(mm.ay * 4e-4, 1), 5.5, 0.4) - ys, 2);
      P.pka = scl(SPR(11, 0.028 * P.pkx, 2.6, 0.35), 0.07);
    } else {
      P.pkx = scl(SPR(5, xs - scl(mm.ax * 6e-4, 1.2), 3.2, 0.45) - xs, 1.4);
      P.pky = scl(SPR(6, ys - scl(mm.ay * 3e-4, 0.8), 5.5, 0.4) - ys, 1); P.pka = 0;
    }
    if (!LQ) {
      P.clx = 0.6 * scl(SPR(7, xs, 5, 0.35) - xs, 1.2); P.cly = 0.6 * scl(SPR(8, ys, 6, 0.35) - ys, 1.2);
      const hc = headC()[1]; P.pom = scl(SPR(10, hc, 3.5, 0.25) - hc, 1.3);
    }
    mm.fresh = false;
  }
  function blendPose(m, anim, t) {
    // вторая кисть на топорище — до смешивания, чтобы и она переходила плавно и попадала в память
    if (P.two) { const ox = P.tox === null ? P.h0x : P.tox, oy = P.tox === null ? P.h0y : P.toy; P.h1x = ox + Math.cos(P.ta) * P.gap; P.h1y = oy + Math.sin(P.ta) * P.gap; }
    // разница углов — непрерывно от прошлого кадра (цель движется: иначе у 180° путь перескакивает на другую сторону)
    // кисть далеко (> ~115°) — через перёд (угол 0), а не за спиной: иначе рука делает полный оборот плеча
    const front = (a0, d) => { const lo = Math.min(a0, a0 + d) / (2 * PI), hi = Math.max(a0, a0 + d) / (2 * PI); return Math.floor(hi) >= Math.ceil(lo); };
    const cont = (i, d, a0) => {
      const p = m.bd[i]; let r;
      if (p == null) { r = wrapA(d); if (a0 != null && Math.abs(r) > 2 && !front(a0, r)) r -= Math.sign(r) * 2 * PI; }
      else r = p + wrapA(d - p);
      m.bd[i] = r; return r;
    };
    if (m.anim !== anim) {
      if (m.anim) {
        m.from = Object.assign({}, m.last); m.t0 = t; m.bd = [null, null, null];
        // путь кисти по дуге вокруг плеча выбирается сейчас; длинная дуга (руки вверху → вниз) — дольше, ≤ ~30°/кадр
        let big = 0; const F = m.from;
        for (let i = 0; i < 2; i++) {
          const hx = i ? 'h1x' : 'h0x', hy = i ? 'h1y' : 'h0y', fa = Math.atan2(F[hy] - F.sy, F[hx] - F.sx);
          big = Math.max(big, Math.abs(cont(i, Math.atan2(P[hy] - P.sy, P[hx] - P.sx) - fa, fa)) || 0);
        }
        m.dur = HIT[anim] ? BLEND_HIT : Math.max(BLEND, big * 0.05);
        // инструмент, который перекладывается далеко (из руки за спину), — не быстрее обычного, иначе оборот за 2–3 кадра
        m.tdur = P.tk && m.from.tk === P.tk && Math.abs(wrapA(P.ta - m.from.ta)) > 1 ? BLEND : m.dur;
      }
      m.anim = anim;
    }
    const k = m.from ? (t - m.t0) / m.dur : 1, kt = m.from ? (t - m.t0) / m.tdur : 1;
    if (k >= 0 && k < 1) {
      const F = m.from, e = sm(k), sx = P.sx, sy = P.sy;
      for (const f of BL) if (typeof F[f] === 'number') P[f] = lerp(F[f], P[f], e);
      for (let i = 0; i < 2; i++) {
        const hx = i ? 'h1x' : 'h0x', hy = i ? 'h1y' : 'h0y';
        const fa = Math.atan2(F[hy] - F.sy, F[hx] - F.sx), fr = Math.hypot(F[hx] - F.sx, F[hy] - F.sy);
        const ca = Math.atan2(P[hy] - sy, P[hx] - sx), cr = Math.hypot(P[hx] - sx, P[hy] - sy);
        const an = fa + cont(i, ca - fa, fa) * e, r = lerp(fr, cr, e);
        P[hx] = P.sx + Math.cos(an) * r; P[hy] = P.sy + Math.sin(an) * r;
      }
    }
    if (kt >= 0 && kt < 1) {
      const F = m.from, e = sm(kt);
      if (P.tk && F.tk === P.tk) {
        // перекладка из-за спины в руку и обратно — через плечо и перёд (угол 0), а не горизонтально назад;
        // в середине разворота топор идёт вглубь кадра (короче), чтобы не торчать палкой вбок
        const d = cont(2, P.ta - F.ta, F.ta);
        if (F.belt || P.belt) P.taT = P.ta;   // топор из-за пояса в руки: вторая кисть не пересчитывается от топорища в пути
        P.ta = F.ta + d * e; if (F.tsc !== P.tsc && F.tsc != null) P.tsc = lerp(F.tsc, P.tsc, e);
        if (Math.abs(d) > 1.6) P.tsc = lerp(1, Math.max(0.35, Math.abs(Math.sin(P.ta))), Math.sin(PI * e));
        const cx = P.tox === null ? P.h0x : P.tox, cy = P.tox === null ? P.h0y : P.toy;
        if (P.tox === null) P.tlat = P.hl0;   // инструмент в кисти: вбок как кисть
        P.tox = lerp(F.tox, cx, e); P.toy = lerp(F.toy, cy, e); P.tlat = lerp(F.tlat, P.tlat != null ? P.tlat : 0, e);
      }
    }
    if (m.from && !(k >= 0 && k < 1) && !(kt >= 0 && kt < 1)) m.from = null;
    const L = m.last;
    for (const f of BL) L[f] = P[f];
    L.h0x = P.h0x; L.h0y = P.h0y; L.h1x = P.h1x; L.h1y = P.h1y; L.tk = P.tk; L.ta = P.ta; L.tsc = P.tsc; L.belt = P.belt;
    L.tox = P.tox === null ? P.h0x : P.tox; L.toy = P.tox === null ? P.h0y : P.toy; L.tlat = P.tox === null ? P.hl0 : P.tlat != null ? P.tlat : 0;
  }

  // ---------- опорная стопа в мире (foot planting) ----------
  // Стопа в опоре стоит в мировой точке (запомнена в момент постановки); нога решается IK от таза к ней (leg).
  // Смещение от позы (off = мир − поза) держится всю опору, в переносе плавно гасится к 0 по доле переноса q —
  // стопа идёт дугой к следующей точке постановки; без шага (стоит/работает) — гаснет за ≈0.1 с (без скачка).
  // o.onStep(x, y, i, a) — стопа встала (для следов): точка на снегу и направление хода.
  function plant(mm, o, t, vyv) {
    const dt = clamp(t - mm.pt, 0, 0.1); mm.pt = t;
    const on = !!(o.gait && P.st0 >= 0);
    mm.wl += ((on ? 1 : 0) - mm.wl) * (1 - Math.exp(-dt / 0.07));
    if (mm.wl < 0.002 && !on) mm.wl = 0;
    WL = mm.wl; legAxes(vyv);
    let act = on || WL > 0;
    for (let i = 0; i < 2; i++) { const F = mm.ft[i]; if (F.ox || F.oy) act = true; }
    if (!act) return;
    const kd = Math.exp(-dt / 0.08), LAM = 0.01;
    // снос тела поперёк хода (пурга): опорная стопа проскальзывает с телом вбок, а не растягивает ногу назад/вперёд по ¾-проекции
    const gl = Math.hypot(GFX, GFY) || 1, gx = GFX / gl, gy = GFY / gl, bdx = mm.bx == null ? 0 : X0 - mm.bx, bdy = mm.bx == null ? 0 : Y0 - mm.by, bp = bdx * gx + bdy * gy;
    let sx = bdx - bp * gx, sy = bdy - bp * gy; if (sx * sx + sy * sy > 64) sx = sy = 0;   // рывок/телепорт — не снос
    mm.bx = X0; mm.by = Y0;
    for (let i = 0; i < 2; i++) {
      const F = mm.ft[i], fx = i ? P.f1x : P.f0x, lat = i ? -LEGW : LEGW, st = i ? P.st1 : P.st0, q = i ? P.q1 : P.q0;
      const nx = X0 + P.ox + fx * GFX + lat * GLX, ny = Y0 + P.oy + fx * GFY + lat * GLY;   // точка стопы по позе на снегу
      if (on && st === 1 && (F.st || WL > 0.5)) {   // в первые кадры шага (WL < 0.5) стопа ещё за позой: иначе закрепилась бы поза прошлого действия
        if (!F.st) {
          F.st = true; F.wx = nx + F.ox; F.wy = ny + F.oy;
          if (o.onStep && WL > 0.5) o.onStep(F.wx + GFX * 1.5, F.wy + GFY * 1.5, i, Math.atan2(GFY, GFX));
        }
        F.wx += sx; F.wy += sy; F.ox = F.wx - nx; F.oy = F.wy - ny;
        if (F.ox * F.ox + F.oy * F.oy > 18 * 18) { F.wx = nx; F.wy = ny; F.ox = F.oy = 0; }   // телепорт/рывок — переставить стопу
      } else {
        if (F.st) { F.st = false; F.o0x = F.ox; F.o0y = F.oy; }
        if (on) { const e = sm(q); F.ox = F.o0x * (1 - e); F.oy = F.o0y * (1 - e); }
        else { F.ox *= kd; F.oy *= kd; F.o0x = F.ox; F.o0y = F.oy; if (F.ox * F.ox + F.oy * F.oy < 1e-4) F.ox = F.oy = 0; }
      }
      // показанная точка → координаты рига (вперёд fx', вбок lat') на снегу
      const dX = nx + F.ox - X0 - P.ox, dY = ny + F.oy - Y0 - P.oy;
      // наименьшие квадраты с лёгкой привязкой вбок к своей колее (λ): при почти параллельных осях (разворот) не разлетается
      const a11 = GFX * GFX + GFY * GFY, a12 = GFX * GLX + GFY * GLY, a22 = GLX * GLX + GLY * GLY + LAM, b1 = GFX * dX + GFY * dY, b2 = GLX * dX + GLY * dY + LAM * lat, dt2 = a11 * a22 - a12 * a12;
      let pf = (b1 * a22 - b2 * a12) / dt2, pl = (a11 * b2 - a12 * b1) / dt2;
      pl = clamp(pl, lat - 16, lat + 16);
      if (i) { P.pf1x = pf; P.pl1 = pl; } else { P.pf0x = pf; P.pl0 = pl; }
    }
    P.pk = 1;
  }

  // топор за поясом (варианты героя): обух на ремне у ближнего бедра, топорище вниз вдоль бедра; считается от итоговой позы
  let CL = null;   // облик текущей фигуры (для поз из art-poses.js: H.belt)
  function beltAxe() {
    const s = Math.sin(P.lean), c = Math.cos(P.lean), hy = hipD(), R = 10.9 * 0.56;
    // топорище вниз-назад по бедру (не вертикальной «ножкой стула»); на шаге его отводит ближнее бедро: нога назад — топорище назад
    const wk = P.st0 >= 0 ? 1 : 0, fx = clamp(P.f0x, -10, 10) * wk;
    P.tk = 'axe'; P.two = 0; P.tsc = 0.56; P.ta = -PI / 2 + P.lean + 0.12 + 0.12 * wk - 0.014 * fx + P.axw;   // axw — качание на ремне (пружина)
    const bx = P.hx + s * 2.2 - c * 4.4, by = hy - c * 2.2 + s * 4.4;       // ремень у поясницы
    P.tox = bx - Math.cos(P.ta) * R; P.toy = by - Math.sin(P.ta) * R; P.tlat = lerp(3, 6, S * S);   // со спины — сбоку у бедра, а не «хвостом» по центру
  }

  // ---------- главный вход ----------
  const NOENV = { now: 0, night: 0, light() {}, spark() {} };
  // C: рамка фигуры (мир, от опоры): обычная — по росту и замаху, лёжа/у лунки/с оружием — шире
  const LQ_ = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const WIDE = { sleep: 1, dead: 1, fish: 1, fishBite: 1, shoot: 1, aim: 1, freezeFall: 1, sit: 1, rest: 1 };
  function draw(g, o, env) {
    if (!SCs() || CFG || Style.depth) return draw0(g, o, env);
    const t = o.t || 0; if (o.blink && Math.floor(t * 20) % 2) return;
    const x = o.x, y = o.y, wide = WIDE[o.anim] || o.ride, hw = wide ? 48 : 32;
    if (o.sel) { g.strokeStyle = Style.P.ochre; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, o.anim === 'sleep' || o.anim === 'dead' ? 24 : 15, 6, 0, 0, PI * 2); g.stroke(); }
    // главные фигуры (герой, Вера, Уркачан, люди зон) — тушь 8 сдвигами и ореол; массовка посёлка — тушь крестом, без ореола (бюджет кадра)
    const hero = !!(o.key && typeof G !== 'undefined' && G && G.p === o.key), crowd = !!o.crowd && !hero;
    const halo = hero || (!crowd && !(typeof window !== 'undefined' && window.QUALITY === 'low'));
    TRL = null; CFG = true;   // массовка — из кэша 30 Гц; слабый пресет: герой 30 Гц, массовка 15 Гц
    try { Style.figure(g, x - hw, y - 86, hw * 2, 98, gg => draw0(gg, o, env), { halo, few: crowd, cache: crowd || LQ_() ? o.key || null : null, every: LQ_() && !hero ? 4 : 2 }); } finally { CFG = false; }
    if (TRL) { Style.speedPath(g, TRL, [0.86, 1.1]); TRL = null; }
    finish(g, o, look(heroSub(o.look)), x, y, env);
  }
  function draw0(g, o, env) {
    env = env || NOENV; if (!env.light) env.light = NOENV.light; if (!env.spark) env.spark = NOENV.spark;
    const t = o.t || 0; if (o.blink && Math.floor(t * 20) % 2) return;
    // постановка разговора (js/talk.js): поза/жест, ракурс, предмет в руке, мимика — только у участников (по o.key)
    const DV = DIRECTOR && o.key ? DIRECTOR(o) : null;
    if (DV && DV.o) o = Object.assign({}, o, DV.o);
    EMO = DV && DV.emo || null;
    let anim = DV && DV.anim || o.anim || 'idle'; const a = clamp(DV && DV.anim ? DV.animT || 0 : o.animT || 0, 0, 1);
    const L = look(heroSub(o.look)), ph = o.phase || 0, sp = clamp(o.speed == null ? 0.5 : o.speed, 0, 1);
    let tool = o.tool || 'none';
    const x = o.x, y = o.y;
    FC = o.face < 0 ? -1 : 1; GT = o.gait || null; WL = 0; TW = 0; LQ = typeof window !== 'undefined' && window.QUALITY === 'low';
    const vyv = isSag(anim) ? 0 : clamp(o.vy || 0, -1, 1);
    // ракурс: боком — ¾ к камере (B34), вниз — к анфасу, вверх — через профиль к спине
    const b34 = anim === 'dead' ? 0 : B34, vOf = v => (v >= 0 ? lerp(b34, 1, v) : b34 + v * (1 + b34));
    const mm = memOf(o);
    // корпус догоняет ноги по ракурсу: пружина первого порядка, полураспад VLAG (ноги — сразу)
    let vt = vyv;
    if (mm) { const dt = mm.vtT == null ? NaN : clamp(t - mm.vtT, 0, 0.1); mm.vtT = t; if (mm.vt == null || !(dt >= 0)) mm.vt = vyv; else mm.vt += (vyv - mm.vt) * (1 - Math.pow(2, -dt / VLAG)); vt = Math.abs(mm.vt - vyv) < 1e-3 ? vyv : mm.vt; }
    const V = vOf(vt), VL = vOf(vyv);
    S = Math.abs(V); K = kOf(S); SY = V * 0.3; LS = V < 0 ? 1 : -1; LZ = 0.36 * (1 - S); X0 = x; Y0 = y;
    SL = Math.abs(VL); KL2 = kOf(SL); SYL = VL * 0.3; LSL = VL < 0 ? 1 : -1; LZL = 0.36 * (1 - SL); FCL = FC; TWL = 0;
    // спина/лицо (корпус): гистерезис −0.40/−0.30, чтобы при ходе почти вертикально не мигало (A11)
    if (mm) { if (vt < -0.4) mm.back = true; else if (vt > -0.3) mm.back = false; if (vt > 0.4) mm.front = true; else if (vt < 0.3) mm.front = false; BACK = mm.back; FRONT = mm.front; }
    else { BACK = vyv < -0.35; FRONT = vyv > 0.35; }
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    // поворот: через лицо к камере (со спины — через спину), а не сжатием в полоску; ноги — сразу, корпус — на TLAG позже
    if (mm) {
      if (FC !== mm.face) { mm.fromFace = mm.face; mm.face = FC; mm.turnT = t; }
      const tw = k => (k >= 0 && k < 1 ? 1 - Math.abs(1 - 2 * k) : 0), kl = (t - mm.turnT) / TURN, kt = (t - mm.turnT - TLAG) / TURN;
      if (kl >= 0 && kl < 1) { const w = tw(kl); TWL = w; if (kl < 0.5) FCL = mm.fromFace; if (SL < w) { SL = w; KL2 = kOf(SL); LSL = BACK ? 1 : -1; LZL = 0.36 * (1 - SL); } }
      if (kt < 1 && kl >= 0) {
        const w = tw(kt); TW = w;
        if (kt < 0.5) FC = mm.fromFace;
        if (S < w) { S = w; K = kOf(S); LS = BACK ? 1 : -1; LZ = 0.36 * (1 - S); }
        if (!BACK && w > 0.45) FRONT = true;
      }
    }
    VSPL = FCL !== FC || Math.abs(SL - S) > 1e-3 || LSL !== LS;
    P.vwL = vyv; P.vwT = vt; P.fcL = FCL; P.fcT = FC;   // для проверок (tests/body-lag.js)
    // оттенок
    TA = 0;
    if (o.wet) { TC = '#27394a'; TA = 0.2; }
    reset(); CL = L; VAR = L.hem != null; POL = !!L.pol;
    TIRE = clamp(o.tire || 0, 0, 1); SHX = SHY = 0; BRV = null; if (mm) dynPre(mm, o, anim, t, ph);
    HERO = !!(o.key && typeof G !== 'undefined' && G && G.p === o.key);   // рюкзак героя крупнее; набит — по объёму внутри, снаружи — притороченные чурки
    const INV = HERO && G.inv && typeof Inv !== 'undefined'; HWOOD = INV ? Inv.packOut() : 0; HFILL = INV ? Inv.fill() : 0.5; HPK = INV ? Inv.kgOf(G.inv) : 0;
    P.pko = null; if (HERO) { DBG.logs = 0; DBG.off = 0; DBG.fill = HFILL; }
    if (POL) { const tf = g.getTransform ? g.getTransform() : null; DET = !LQ && (tf ? Math.hypot(tf.a, tf.b) : 1) >= 2.8; DETN = false; }
    else { DET = false; const tf = !LQ && g.getTransform ? g.getTransform() : null, sc = tf ? Math.hypot(tf.a, tf.b) : 1; DETN = sc >= 2.2; DETF = sc >= 2.8; }
    if (o.sel && !CFG) { g.strokeStyle = '#ffd27a'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, anim === 'sleep' || anim === 'dead' ? 24 : 15, 6, 0, 0, PI * 2); g.stroke(); }
    if (anim === 'sleep') { drawSleep(g, o, L, x, y, t, env); if (!CFG) finish(g, o, L, x, y, env); g.restore(); GT = null; return; }
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
      default: if (POSE[anim]) POSE[anim].fn(o, t, a, ph, sp, H); else idle(o, t);
    }
    // груз за спиной клонит вперёд, охапка у груди — назад (вес в скорости — Carry.speedMul, перегруз — Hero.speed)
    if (HERO && LOCO[anim] && anim !== 'hurt' && !(o.key.sleeping)) {
      const ld = o.load, ak = ld && (ld.mode === 'arms' || ld.n) ? ld.kg * Math.max(1, ld.n || 1) : 0;
      P.lean += Math.min(0.14, 0.0055 * Math.max(0, HPK - 6)) - Math.min(0.07, 0.003 * ak); shoulder();
    }
    if (L.old && anim !== 'dead') {
      const sx0 = P.sx, sy0 = P.sy; P.lean += 0.12; P.hy += 0.5; shoulder(); if (anim === 'idle' || anim === 'talk') { P.h1y = Math.min(P.h1y, P.sy + RR); }
      if (POSE[anim] && POSE[anim].staffHand) { const dx = P.sx - sx0, dy = P.sy - sy0; P.h0x += dx; P.h0y += dy; P.h1x += dx; P.h1y += dy; }   // жест разговора: кисть идёт с плечом (рука не сгибается от сутулости)
    }
    if (DV) { if (DV.mouth != null) P.mouth = DV.mouth; if (DV.nod) { P.tilt += DV.nod; P.hb += DV.nod * 1.2; } if (DV.blink) P.eyes = 1; }   // говорит (рот), кивок поверх любой позы
    if (P.rot) { CR = Math.cos(P.rot); SR = Math.sin(P.rot); }
    // что в руках вне работы
    const free = (LOCO[anim] || (POSE[anim] && POSE[anim].free)) && anim !== 'hurt';
    let slung = null;
    if (!P.tk) {
      if (tool === 'bow' || tool === 'rifle') slung = tool;
      else if (anim === 'dead') { /* уронил */ }
      else if (free && tool === 'torch') { handR(0, 5.5, 5 + Math.sin(ph) * 0.4); P.hl0 = 6; P.tk = 'torch'; P.ta = -1.35; }
      else if (free && tool === 'axe' && L.axeBelt) { P.tk = 'axe'; P.belt = 1; }
      else if (free && (tool === 'axe' || tool === 'saw' || tool === 'rod')) { P.tk = tool; P.ta = tool === 'axe' ? 1.3 : 1.15; }
    }
    if (P.belt && P.tk === 'axe') beltAxe(); else P.belt = 0;
    if (L.bowBack && P.tk !== 'bow' && !slung && anim !== 'shoot' && anim !== 'aim') slung = 'bow';
    if (!P.tk && !slung && L.weapon && (anim !== 'shoot' && anim !== 'aim')) slung = L.weapon;
    // ноша героя вне своих поз (js/carry.js): охапка — обе руки у груди; вершина — на плече; вещь — в ближней руке
    const LDo = o.load;
    if (LDo && !(POSE[anim] && POSE[anim].own) && anim !== 'sleep' && anim !== 'dead' && anim !== 'sit') {
      if ((P.tk === 'axe' && !P.belt) || P.tk === 'saw' || P.tk === 'rod' || P.tk === 'torch') P.tk = null;
      if (LDo.mode === 'arms') { handR(0, 6.9, 6.4); handR(1, 5.5, 7.4); P.hl0 = 3.2; P.hl1 = 2.6; P.carry = 1; if (LDo.n) { P.lo = [P.sx + 7.2, P.sy + 5.4, 0]; P.lon = LDo.n; } else if (LDo.k) P.held = [LDo.k, P.sx + 7.4, P.sy + 4.2, -0.2]; }
      else if (LDo.mode === 'shoulder') { handR(0, 3.6, -1.2); P.hl0 = 2.4; P.carry = 1; P.lsh = 1; }
      else if (LDo.mode === 'drag') { P.lean += 0.16; shoulder(); handR(0, -4.6, 10.4); handR(1, -3.4, 10.8); P.hl0 = 5.2; P.hl1 = 4.6; P.carry = 1; }   // волоком: наклон вперёд, обе руки назад-вниз на комле
      else if (LDo.k) { const hh = LDo.k === 'hare'; P.held = [LDo.k, P.h0x - 0.3, P.h0y + (hh ? 0.4 : -0.4), hh ? PI / 2 - 0.15 : -0.3]; }
    }
    if (anim === 'carry' || (o.carry && (anim === 'walk' || anim === 'idle'))) {
      if (P.tk === 'torch') P.tk = null;
      handR(0, 6.8, 7.2); handR(1, 5.6, 6.6); P.hl0 = 3.8; P.hl1 = 3.8; P.carry = 1;
      if ((P.tk === 'axe' && !P.belt) || P.tk === 'saw' || P.tk === 'rod') P.tk = null;
    }
    const staff = L.staff && (anim === 'idle' || anim === 'walk' || anim === 'limp' || anim === 'talk' || anim === 'wave' || anim === 'hurt' || (POSE[anim] && POSE[anim].staff)) && !P.carry;
    const sh = staff && POSE[anim] && POSE[anim].staffHand ? 1 : 0;   // жест ближней рукой (разговор) — посох в дальней
    if (staff && sh) { handR(1, 3.4, 10.2); P.hl1 = 5.2; }
    else if (staff) { handR(0, 4.2 + (anim === 'walk' ? 1.5 * Math.sin(ph) : 0), 9.8); P.hl0 = 6; if (P.tk === 'axe' || P.tk === 'saw' || P.tk === 'rod') P.tk = null; }
    if (HERO && L.pack) {
      const off = G.hand && G.hand.off;
      if (off && !P.pko) { const v = Math.abs(vyv), dx = (off.x - x) / 0.87, dy = off.y - y, X = v > 0 ? Math.hypot(dx, dy) : dx * FC; P.pko = { x: X, y: (dy - 0.12 * X) * (1 - v) - 3, rot: 0, open: off.open || 0, st: 0, z: 1, gnd: 1, f: Math.sign(X || 1) }; }
    }
    if (mm && anim !== 'dead') blendPose(mm, anim, t);   // последним: смешивается показанная поза
    if (mm) dynPost(mm, anim);   // этап 4: инерция, вдох, голова, рюкзак — поверх показанной позы (в память смешивания не идёт)
    if (HERO && G.hand && !G.hand.off && G.hand.sl && G.time - G.hand.sl.t < 0.6) { const sl = G.hand.sl, e = (G.time - sl.t) / 0.6, k = (1 - e) * (1 - e); P.pkx += clamp(sl.x * FC, -16, 16) * k; P.pky += 7 * k; }   // подхватил на ходу: рюкзак доезжает на спину
    legAxes(vyv); if (mm) plant(mm, o, t, vyv);   // стопы в опоре — в мире (после смешивания: закрепляется показанная поза)
    P.hy = hipY(P.hy); P.hyD = 1;                  // таз — в экранную шкалу рига (ноги длиннее, см. KL); плечо уже в ней

    // тень
    const lying = anim === 'dead' ? sm(a / 0.55) : 0;
    shadow(g, x - FC * 12 * lying + P.ox, y + 1, 30 + lying * 26, 11 + lying * 3);
    // контактная тень: мягкие пятна под опорной стопой (радиальный спад, без края) + тёмное ядро; поднятая стопа — слабее
    if (lying < 0.3) {
      const ka = 1 - lying * 3;
      for (let i = 0; i < 2; i++) {
        const fy0 = (i ? P.st1 : P.st0) === 1 ? -2 : i ? P.f1y : P.f0y; if (fy0 <= -3.2) continue;   // опорная стопа на перекате (пятка/носок) — на снегу
        lp((P.pk ? (i ? P.pf1x : P.pf0x) : i ? P.f1x : P.f0x) + (i ? P.rx1 : P.rx0) + 1.4, -0.1, P.pk ? (i ? P.pl1 : P.pl0) : i ? -LEGW : LEGW);
        const lf = 1 - 0.6 * clamp(-(fy0 + 2) / 1.2, 0, 1);
        if (LQ) cont(g, QX + 0.2, QY, 4.6, 1.8, 0.5 * ka * lf); else { cont(g, QX, QY, 6.4, 2.6, 0.3 * ka * lf); cont(g, QX + 0.4, QY + 0.1, 3.4, 1.3, 0.34 * ka * lf); }
      }
    }
    // контровой: днём заметен, ночью (свет от костра/факела) почти гаснет; у лежащего нет
    RIM = 0.38 * (1 - 0.85 * sm(((env.night || 0) - 0.3) / 0.4)) * (1 - lying);
    if (P.prop) drawProp(g, P.prop, o);
    if (anim === 'dead' && tool !== 'none') { const sv = P.rot; P.rot = 0; P.ox = 0; P.oy = 0; drawTool(g, tool === 'bow' || tool === 'rifle' ? tool : 'axe', 7, 2, 0.15, 0, o, NOENV); P.rot = sv; dead(o, t, a); }

    const back = BACK, front = FRONT;
    // двуручный мах спиной/лицом к камере — сбоку от корпуса, иначе топор целиком за спиной или поперёк лица
    if ((back || front) && P.two && !isLoco(anim)) { P.hl0 += 4.6 * S; P.hl1 -= 4.6 * S; }   // hl1 — вглубь, минус = тоже к ближнему боку
    // ближняя рука рассчитывается первой: к её (зажатой) кисти крепится инструмент
    // свободные руки (ничего не держат, не к цели) — мах в глубину в виде со спины/анфас (armSolve)
    const fr = free && !P.carry && !P.two, hT = Math.abs(P.tox - P.h1x) < 1e-6 && Math.abs(P.toy - P.h1y) < 1e-6;
    ADEP[0] = fr && !(P.tk && P.tox === null) && !P.held && !(staff && !sh) ? 1 : 0;
    ADEP[1] = fr && P.tk !== 'bow' && !P.held2 && !(staff && sh) && !(P.tox !== null && hT) ? 1 : 0;
    joint(P.h0x, P.h0y, 0); ik(JX, JY, P.h0x, P.h0y, UA, FA, 1); P.h0x = EX; P.h0y = EY;
    let tox = P.tox, toy = P.toy, tlat = P.hl0;
    if (P.tk === 'bow') { tox = P.h1x; toy = P.h1y; tlat = -P.hl1; }
    else if (tox === null) { tox = P.h0x; toy = P.h0y; }
    else tlat = P.tlat != null ? P.tlat : 0;   // tlat — инструмент в дальней руке (факел при разговоре)
    if (P.two && P.taT == null) { P.h1x = tox + Math.cos(P.ta) * P.gap; P.h1y = toy + Math.sin(P.ta) * P.gap; }   // топор идёт из-за пояса — вторая кисть уже смешана в blendPose
    if (P.tk === 'pole') P.plen = Math.min(19, (-toy - 0.3) / Math.max(0.3, Math.sin(P.ta)));

    const beads = !!L.beads, deep = (back || front) && !isLoco(anim);
    // порядок слоёв; у работы спиной/лицом к камере — по глубине: со спины дальше то, что впереди по взгляду,
    // в анфас — то, что за спиной (топор в замахе за головой, руки у цели за корпусом)
    let fT = P.belt ? !back : back && !!P.tk, f0 = false, f1 = false;
    if (deep) {
      const dz = back ? 1 : -1, cz = P.hx + Math.sin(P.lean) * (TORSO + P.bz) * 0.55;
      fT = P.belt ? !back : !!P.tk && dz * (tox + Math.cos(P.ta) * 7 - cz) > 1;
      f0 = dz * (P.h0x - P.sx) > 2; f1 = dz * (P.h1x - P.sx) > 2;
    }
    // ходьба/покой спиной или лицом к камере: свободная кисть, ушедшая в глубину (со спины — вперёд, в анфас — назад), — за корпусом;
    // плечо при этом остаётся поверх (рисуется ещё раз только плечом) — рука уходит за спину, а не «проваливается» целиком
    const lb = (back || front) && !deep, bz0 = lb && ADEP[0] && (back ? 1 : -1) * (P.h0x - P.sx) > 1.5, bz1 = lb && ADEP[1] && (back ? 1 : -1) * (P.h1x - P.sx) > 1.5;
    // в анфас руки ниже подбородка — под головой (наклон к камере опускает голову на руки)
    const nY = P.hy - Math.cos(P.lean) * (TORSO + P.bz) + 1, m0 = deep && front && !f0 && P.h0y > nY, m1 = deep && front && !f1 && P.h1y > nY, mT = m0 && P.tk && !fT;
    ASH[0] = deep ? !f0 : !bz0; ASH[1] = deep ? !f1 : front || back ? !bz1 : 0;
    if (fT) drawTool(g, P.tk, tox, toy, P.ta, tlat, o, env);
    if (deep) { if (f1) arm(g, L, 1, false, 1); if (f0) arm(g, L, 0, true, 1); }
    else if (lb) { if (bz1) arm(g, L, 1, S > 0.7); if (bz0) arm(g, L, 0, true); }
    else if (!front && !back) arm(g, L, 1, false);
    if (staff && sh) staffAt(g, P.h1x, P.h1y, -P.hl1);   // посох в дальней руке — за корпусом
    if (slung && !back) drawSlung(g, slung);
    if (P.pko && pkoZ() === 'pre') drawPackOff(g, L, P.pko);
    leg(g, L, 1, false); leg(g, L, 0, true);
    let T;
    if (P.pko && pkoZ() === 'mid') drawPackOff(g, L, P.pko);
    if (L.pack && !P.pko && !back && (S < 0.55 || L.packType === 'frame' || L.packType === 'sack')) { T = torsoFrame(); drawPack(g, L, T, false); }
    T = drawTorso(g, L, vyv, beads);
    if (L.pack && !P.pko && back) drawPack(g, L, T, true);
    if (P.pko && pkoZ() === 'post') drawPackOff(g, L, P.pko);
    if (slung && back) drawSlung(g, slung);
    if (o.frost > 0.2) { g.globalAlpha = o.frost * 0.8; pr(P.sx, P.sy - 1, 0); ell(g, QX, QY, 5, 1.6, '#f6f9fc'); g.globalAlpha = 1; }
    if (m1) arm(g, L, 1, S > 0.7);
    if (mT) drawTool(g, P.tk, tox, toy, P.ta, tlat, o, env);
    if (m0 && P.held) drawTool(g, P.held[0], P.held[1], P.held[2], P.held[3], P.hl0, o, env);
    if (m0 && P.held2) drawTool(g, P.held2[0], P.held2[1], P.held2[2], P.held2[3], -P.hl1, o, env);
    if (m0) arm(g, L, 0, true);
    drawHead(g, o, L, vyv, env);
    if (deep ? !f1 && !m1 : front || back) arm(g, L, 1, S > 0.7, 0, bz1);
    if (staff && !sh) staffAt(g, P.h0x, P.h0y, P.hl0);
    if (P.tk && !fT && !mT) drawTool(g, P.tk, tox, toy, P.ta, tlat, o, env);
    if (P.lo && P.lon > 0 && !f0 && !m0) armful(g, P.lo[0], P.lo[1], P.lon, o.load, P.hl0 - 0.6);   // охапка у груди
    if (P.lsh && !f0 && !m0) shoulderTop(g, P.h0x, P.h0y, P.hl0 - 0.4);                            // вершина на плече
    if (P.held && !f0 && !m0) drawTool(g, P.held[0], P.held[1], P.held[2], P.held[3], P.hl0, o, env);   // предмет в руках поверх инструмента за спиной: [вид, x, y, угол]
    if (P.held2 && !f0 && !m0) drawTool(g, P.held2[0], P.held2[1], P.held2[2], P.held2[3], -P.hl1, o, env);   // второй предмет (дальняя рука: банка, миска) — вглубь по hl1
    if (P.pko && pkoZ() === 'top') drawPackOff(g, L, P.pko);   // рюкзак перед героем — поверх вещи в руке: что ниже кромки горловины — уже внутри
    if (P.carry && o.carry && !back) { pr(P.sx + 7.5, P.sy + 5.2, 0); carryIc(g, o.carry, QX, QY, 12); }
    if (!f0 && !m0) arm(g, L, 0, true, 0, bz0);
    if (P.trail && CFG) { const [b0, b1, R] = P.trail; pr(P.sx, P.sy, 0); TRL = [QX, QY]; for (let i = 0; i <= 6; i++) { const b = lerp(b0, b1, i / 6); pr(P.sx + Math.cos(b) * R, P.sy + Math.sin(b) * R, 0); TRL.push(QX, QY); } }   // C: мах — линиями скорости (поверх)
    else if (P.trail) {
      const [b0, b1, R] = P.trail;
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2.2; g.beginPath();
      for (let i = 0; i <= 6; i++) { const b = lerp(b0, b1, i / 6); pr(P.sx + Math.cos(b) * R, P.sy + Math.sin(b) * R, 0); i ? g.lineTo(QX, QY) : g.moveTo(QX, QY); }
      g.stroke();
    }
    if (P.spark) {
      let sx, sy;
      if (P.tk === 'pole') { TX = tox; TY = toy; TC_ = Math.cos(P.ta); TS = Math.sin(P.ta); TL = 0; TQ = 1; tp(P.plen, 0); sx = QX; sy = QY; }
      else { TX = tox; TY = toy; TC_ = Math.cos(P.ta); TS = Math.sin(P.ta); TL = tlat; TQ = 1; tp(P.tk === 'hammer' ? 10 : 16, 4); sx = QX; sy = QY; }
      env.spark(sx, sy, 1);
      g.fillStyle = P.tk === 'axe' ? '#c79a62' : '#dde6ee';
      for (let i = 0; i < 4; i++) { const an = -PI / 2 + (i - 1.5) * 0.6, r = 3 + (t * 37 + i * 3) % 4; g.fillRect(sx + Math.cos(an) * r - 0.8, sy + Math.sin(an) * r - 0.8, 1.6, 1.6); }
    }
    if (anim === 'hurt' && a < 0.12) { pr(P.sx, P.sy + 3, 0); env.spark(QX, QY, 1 - a / 0.12); }
    // пар изо рта
    if (anim !== 'dead' && !back) {
      // пар — на выдохе того же дыхания, что поднимает плечи (фаза 0.25 — вдох окончен; пар 0.3…0.6 цикла)
      const bp = mm ? (mm.bph - 0.3 + 1) % 1 : (((t * 0.33 + (o.seed || (x * 0.013 + y * 0.007))) % 1) + 1) % 1, bw = mm ? 0.3 : 0.35;
      if (bp < bw) {
        const [cx0, cy0, ang] = headC();
        const e = bp / bw; pr(cx0 + Math.cos(ang) * (3.6 + e * 8), cy0 + Math.sin(ang) * 3.6 + 0.9 - e * 3, 0);
        g.fillStyle = 'rgba(246,249,252,' + ((FRONT ? 0.25 : 0.4) * (1 - e)).toFixed(2) + ')'; g.beginPath(); g.arc(QX, QY, 1 + e * 3.4, 0, PI * 2); g.fill();   // в анфас пар слабее — не закрывает лицо
      }
    }
    { // точки тела на экране (голова, шея, грудь, таз, колени, щиколотки, кисти) — для проверки «за препятствием» (gfx)
      const T = P.pts, hc = headC(); let j = 0; const put = () => { T[j++] = QX; T[j++] = QY; };
      pr(hc[0], hc[1], 0); put(); const nx = P.hx + Math.sin(P.lean) * TORSO, ny = P.hy - Math.cos(P.lean) * TORSO; pr(nx, ny, 0); put(); pr((nx + P.hx) / 2, (ny + P.hy) / 2, 0); put(); pr(P.hx, P.hy, 0); put();
      for (const A of [P.lg0[2], P.lg0[3], P.lg1[2], P.lg1[3], P.lg0[4], P.lg0[5], P.lg1[4], P.lg1[5], P.ar0[4], P.ar0[5], P.ar1[4], P.ar1[5]]) T[j++] = A;
    }
    if (!CFG) finish(g, o, L, x, y, env);
    g.restore();
    TA = 0; GT = null;
  }
  // слой снятого рюкзака: за корпусом (z 0) или перед (z 1) — с учётом ракурса (со спины «перед» — дальше от камеры)
  const pkoZ = () => (P.pko.z ? (BACK ? 'pre' : 'top') : BACK ? 'post' : FRONT ? 'pre' : 'mid');
  // охапка: n чурок поперёк груди стопкой (w — толщины), торцы — к взгляду
  function armful(g, x, y, n, ld, lat) {
    TX = x; TY = y; TC_ = 1; TS = 0; TL = lat; TQ = 1; g.lineCap = 'butt';
    const w = ld && ld.w || [];
    for (let i = 0; i < Math.min(n, 6); i++) {
      const k = clamp(w[i] || 1, 0.6, 1.6), v = -i * 3.4 * Math.min(1.2, k) + 1.2;   // чурка 0,45 м × 13 см ≈ 12 × 3,6 ед. рига
      g.strokeStyle = C(i % 2 ? '#5b3d27' : '#6b4c31'); g.lineWidth = 3.6 * k; g.beginPath(); tM(g, -6.2, v); tL(g, 5.8, v); g.stroke();
      g.strokeStyle = C('#3a2618'); g.lineWidth = 0.5; g.beginPath(); tM(g, -5.6, v + 1.2 * k); tL(g, 5.4, v + 1.2 * k); g.stroke();   // кора снизу темнее
      tp(5.8, v); ell(g, QX, QY, 1.1 * k, 1.8 * k, C('#e0b47a')); if (k > 0.9) ell(g, QX, QY, 0.45 * k, 0.7 * k, C('#c79a62'));
    }
    g.lineCap = 'round';
  }
  // вершина ели на плече: толстый конец в руке впереди, тонкий с веточками — за спиной
  function shoulderTop(g, hx, hy, lat) {
    TX = hx + 2; TY = hy + 1; const a = Math.atan2(-9, -20); TC_ = Math.cos(a); TS = Math.sin(a); TL = lat; TQ = 1;   // 1 м ≈ 27 ед. рига: от руки впереди — через плечо назад
    g.lineCap = 'round'; g.strokeStyle = C('#5b3d27'); g.lineWidth = 2.8; g.beginPath(); tM(g, -3, 0); tL(g, 16, 0); g.stroke();
    g.lineWidth = 1.8; g.beginPath(); tM(g, 16, 0); tL(g, 27, 0); g.stroke();
    g.strokeStyle = C('#2f5a3a'); g.lineWidth = 1.3; g.beginPath();
    for (let i = 0; i < 7; i++) { const u = 12 + i * 2.3, l = 4.6 - i * 0.45; tM(g, u, 0); tL(g, u + l, -l * 0.9); tM(g, u, 0); tL(g, u + l, l * 0.9); }
    g.stroke(); g.strokeStyle = C('#e8eef3'); g.lineWidth = 0.7; g.beginPath(); for (let i = 0; i < 4; i++) { const u = 13 + i * 3.5; tM(g, u, -1.2); tL(g, u + 2.5, -2.4); } g.stroke();   // снег на лапках
    tp(-3, 0); ell(g, QX, QY, 1.3, 1.4, C('#e0b47a'));
  }
  function staffAt(g, hx, hy, hl) {
    g.strokeStyle = C('#5b3d27'); g.lineWidth = 2.4; g.beginPath(); M(g, hx + 1.2, 0, hl); Ln(g, hx - 0.6, hy - 15, hl); g.stroke();
    pr(hx - 0.6, hy - 15, hl); ell(g, QX, QY, 1.6, 1.6, C('#b8392d'));
  }
  function torsoFrame() {
    pr(P.hx, P.hy, 0); const Hx = QX, Hy = QY;
    pr(P.hx + Math.sin(P.lean) * (TORSO + P.bz), P.hy - Math.cos(P.lean) * (TORSO + P.bz), 0); const Nx = QX, Ny = QY;
    let ux = Nx - Hx, uy = Ny - Hy; const ln = Math.hypot(ux, uy) || 1; ux /= ln; uy /= ln;
    const [F, B] = tW(S); return { Hx, Hy, Nx, Ny, ux, uy, fnx: -uy * FC, fny: ux * FC, F, B };
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

  // помощники для поз из других файлов (P — текущая поза, поля см. reset())
  // view() — ракурс текущей фигуры: −1 спиной к камере, 1 лицом, 0 боком (для поз, которые его учитывают)
  const H = { pack: () => ({ Hb: pkTop(1.5) * 14.6 - 2.2, d: pkW(4.2), fill: HFILL, kg: HPK }),
    face: () => FC, belt: k => (k === 'axe' && CL && CL.axeBelt ? (P.tk = 'axe', P.belt = 1, true) : false), P, PI, lerp, sm, clamp, seg, shoulder, handA, handR, foot, gait, idle, walk, run, limp, sit, stride, view: () => (BACK ? -1 : FRONT ? 1 : 0),
    SHO, hipY, hip: hipD, sink: () => SINK, head: headC, look: () => CL, LEN: { TH, SHN, UA, FA, MT, TORSO, KL }, armFK, swingArms, runW, REST, RR, RA: [RA0, RA1] };
  const DUR = { chop: 0.9, dig: 1.0, build: 0.7, swing: 0.45, shoot: 1.4, hurt: 0.6, dead: 1.2 };
  const ANIMS = ['idle', 'walk', 'run', 'limp', 'carry', 'talk', 'wave', 'chop', 'dig', 'fish', 'fishBite', 'build', 'swing', 'aim', 'shoot', 'sit', 'sleep', 'hurt', 'dead'];
  function register(name, spec) { POSE[name] = spec; if (spec.dur) DUR[name] = spec.dur; if (!ANIMS.includes(name)) ANIMS.push(name); }
  return {
    dbg: DBG, draw, LOOKS, HERO_LOOKS: HV, look, mix, stride, gaitFor, advance, register, POSE, H,
    setDirector: f => { DIRECTOR = f; },
    setSink: v => { SINK = v || 0; },   // gfx sunk: фигура в снегу на v px (тени под снегом не рисуются, trudge — подъём стопы)   // постановщик разговора (js/talk.js): o (с key) → {anim, animT, o, emo, mouth, nod, blink} | null
    ANIMS,
    // длительности разовых циклов (сек) — для animT
    DUR,
  };
})();
if (typeof module !== 'undefined') module.exports = ArtPeople;
