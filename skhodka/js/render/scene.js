// Зал SushiGO в 3D (three r158, глобальный THREE). Мебель — из LAYOUT (столы, места, блоки), декор и свет —
// из DECOR ниже (мировые x,z; стенной декор сам «прилипает» к ближайшей стене).
// Свет: 2–4 настоящих источника (по качеству) + небо/полусфера; остальное запечено: стены — Basic-материал
// с lightMap (янтарные «свечки» подсветки, красные/синие заливки), пол — Lambert + lightMap (жёлтое пятно
// от оникса, розовое у диванчиков). Самосветящееся (оникс, неон, лампы, экраны) — Basic, ореолы — точки.
// Разрез: потолок и трубы прячутся, когда камера выше потолка; декор стены — когда камера за стеной;
// маркиза и верхние этажи — когда камера над веранде. Эффекты: strobe, rain, football, sax, birthday, garland, smell, karaoke.
// Зал — прямоугольник (LAYOUT.hall) с коридорчиком в туалет; стойка — дуга LAYOUT.bar (корпус выдавлен из контура, оникс —
// лента панелей по фасаду), сцена — подиум LAYOUT.stage (музыканты sax/karaoke стоят на нём, лучи и пятно — на высоте подиума).
'use strict';
L.def('render/scene', () => {
const { clamp, lerp, smooth, RNG } = L.use('core');
const { LAYOUT } = L.use('content/layout');
const TX = L.use('render/textures');
const P = L.use('render/props');
const { CamCtl } = L.use('render/camera');
const { Quality } = L.use('render/quality');
const { Kit, COL, place, local } = P;

const W = LAYOUT.size.w, D = LAYOUT.size.d, H = LAYOUT.size.h;
const SKY = [new THREE.Color(0xf0a070), new THREE.Color(0x6a5a8a), new THREE.Color(0x0c1022)];   // закат → сумерки → ночь
const AMB = '#ffab3d', AMB2 = '#ffc46a', RED = '#ff2a3a', PINK = '#ff4a9a', BLUE = '#3a5aff', MAG = '#e040ff';

// ─────────── декор и свет (мировые координаты) ───────────
const range = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
const BAR = LAYOUT.bar, STG = LAYOUT.stage, WC = LAYOUT.wc;
const DECOR = {
  // пятна света на стенах: x,z — точка у стены, y — высота; kind: up | down | wash | glow
  wall: [
    // длинная стена (x=0): янтарные «свечки» из-за спинки дивана вверх, между ними фонари
    ...range(1.3, D - 0.8, 8).map(z => ({ x: 0, z, y: 0.95, kind: 'up', c: AMB, a: 0.95, r: 0.5, len: 2.5 })),
    ...[2.0, 5.2, 8.4, 11.4].map(z => ({ x: 0, z, y: 2.25, kind: 'glow', c: AMB2, a: 0.55, r: 0.55 })),
    { x: 0, z: 0.4, y: 2.2, kind: 'wash', c: BLUE, a: 0.35, r: 1.1 },
    { x: 0, z: D - 0.6, y: 2.2, kind: 'wash', c: RED, a: 0.3, r: 1.2 },
    // дальняя стена (z=D): розово-красный угол с алоказией, фонарь, свечки
    { x: W - 0.6, z: D, y: 1.4, kind: 'wash', c: RED, a: 0.8, r: 1.4 }, { x: W - 0.9, z: D, y: 2.6, kind: 'wash', c: PINK, a: 0.45, r: 1.3 },
    { x: 2.6, z: D, y: 2.3, kind: 'glow', c: AMB2, a: 0.5, r: 0.6 }, { x: 1.2, z: D, y: 3.3, kind: 'down', c: AMB, a: 0.8, r: 0.5, len: 2.4 },
    { x: 4.4, z: D, y: 3.3, kind: 'down', c: AMB, a: 0.6, r: 0.5, len: 2.2 }, { x: 6.6, z: D, y: 3.3, kind: 'down', c: AMB, a: 0.7, r: 0.5, len: 2.4 },
    // левая стена в глубине (x=W): шестерёнки в красной и синей заливке, трубы-лампы, розовый свет над диванчиками
    { x: W, z: 10.6, y: 2.3, kind: 'wash', c: RED, a: 0.95, r: 1.6 }, { x: W, z: 12.1, y: 2.5, kind: 'wash', c: BLUE, a: 0.5, r: 1.2 },
    { x: W, z: 11.0, y: 1.0, kind: 'wash', c: PINK, a: 0.7, r: 2.0, sy: 0.4 },
    { x: W, z: 12.7, y: 2.3, kind: 'glow', c: AMB2, a: 0.6, r: 0.8 },
    { x: W, z: 9.7, y: 0.3, kind: 'up', c: AMB, a: 0.8, r: 0.5, len: 3 },
    // коридорчик в туалет: тёплый свет над дверью
    { x: WC.door.x, z: WC.z, y: 2.4, kind: 'glow', c: AMB2, a: 0.7, r: 0.5 }, { x: WC.door.x, z: WC.z, y: 3.3, kind: 'down', c: AMB, a: 0.7, r: 0.4, len: 2.6 },
    // левая стена за стойкой: янтарные споты сверху, синий отсвет холодильника, розовый край
    ...[5.3, 6.1].map(z => ({ x: W, z, y: 3.3, kind: 'down', c: AMB, a: 0.9, r: 0.45, len: 2.6 })),
    { x: W, z: 7.6, y: 1.0, kind: 'wash', c: '#3aa0ff', a: 0.5, r: 0.8 }, { x: W, z: 8.3, y: 2.4, kind: 'wash', c: MAG, a: 0.5, r: 0.8 },
    // сцена у левой стены: тёплый луч сверху, пурпурная заливка за музыкантом, розовое у стекла
    { x: W, z: STG.z, y: 3.3, kind: 'down', c: AMB2, a: 0.95, r: 0.7, len: 3 }, { x: W, z: STG.z - 0.6, y: 1.6, kind: 'wash', c: MAG, a: 0.55, r: 1.1 },
    { x: W, z: 1.0, y: 2.6, kind: 'wash', c: PINK, a: 0.6, r: 1.2 },
  ],
  // пятна на полу (x,z): жёлтое от оникса по дуге стойки, янтарь у столов, розовое у диванчиков, синее у витрины
  floor: [
    ...range(-1.35, BAR.phiL - 0.2, 6).map(f => { const [x, z] = BAR.at(f, 0.55); return { x, z, r: 1.0, c: '#ffb830', a: 0.85 }; }),
    ...range(5.0, 11.5, 5).map(z => ({ x: 1.2, z, r: 1.3, c: AMB, a: 0.55 })),
    { x: 8.6, z: 11.0, r: 1.8, c: PINK, a: 0.6, sy: 1.6 }, { x: W - 0.5, z: D - 0.5, r: 1.2, c: RED, a: 0.55 },
    { x: 3.0, z: 0.6, r: 2.2, c: BLUE, a: 0.35, sy: 0.5 }, { x: 8.0, z: 0.8, r: 2.2, c: '#8a60ff', a: 0.3, sy: 0.5 },
    { x: 8.0, z: 1.5, r: 1.3, c: AMB, a: 0.35 }, { x: 3.4, z: 2.5, r: 1.4, c: AMB, a: 0.4 }, { x: 3.3, z: 6.4, r: 1.1, c: AMB, a: 0.35 },
    { x: 8.4, z: STG.z, r: 1.3, c: '#ff9a50', a: 0.5 }, { x: 4.1, z: 10.6, r: 1.3, c: AMB, a: 0.35 }, { x: 6.9, z: 11.0, r: 1.2, c: RED, a: 0.3 },
    { x: 4.2, z: 12.9, r: 1.4, c: AMB, a: 0.35 }, { x: W - 0.4, z: WC.z, r: 0.8, c: AMB2, a: 0.45 },
  ],
  // предметы на стенах
  items: [
    ...[2.0, 5.2, 8.4, 11.4].map(z => ({ kind: 'lantern', x: 0, z, y: 2.25 })),
    ...[3.6, 6.8, 10.0].map((z, i) => ({ kind: 'poster', tex: 'sushi', x: 0, z, y: 1.75, w: 0.42, h: 0.66, seed: i })),
    { kind: 'gears', x: W, z: 10.8, y: 2.35, w: 2.3 },
    { kind: 'pipes', x: W, z: 12.7, y: 2.3 },
    { kind: 'poster', tex: 'gin', x: 7.6, z: D, y: 2.2, w: 0.42, h: 0.6 },
    { kind: 'lantern', x: 2.6, z: D, y: 2.3 },
    { kind: 'poster', tex: 'sushi', x: 1.3, z: D, y: 1.8, w: 0.42, h: 0.66, seed: 7 },
    { kind: 'lantern', x: W, z: STG.z + 0.55, y: 2.2 },
    { kind: 'vip', x: W, z: 5.6, y: 1.7 },
    { kind: 'wc', x: WC.door.x, z: WC.z, y: 1.85 },
  ],
  // споты на потолке (ореолы)
  spots: [...range(1.5, D - 1.2, 6).map(z => [1.4, z]), [6.5, 5.0], [8.2, 5.2], [9.4, STG.z], [3.4, 2.2], [4.1, 10.6], [6.9, 11.0], [8.0, 1.2], [2.0, 1.0], [3.3, 6.4]],
};

// ─────────── вспомогательное ───────────
const segDist = (px, pz, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz, t = clamp(((px - a[0]) * vx + (pz - a[1]) * vz) / l2, 0, 1); return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t); };
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
const inRect = (x, z, r, p = 0) => x >= r[0] - p && x <= r[2] + p && z >= r[1] - p && z <= r[3] + p;

class Scene {
  constructor(canvas, { quality } = {}) {
    this.canvas = canvas;
    this.quality = quality instanceof Quality ? quality : new Quality(typeof quality === 'string' ? quality : undefined);
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.aa, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 160);
    this.ctl = new CamCtl(this.camera, canvas);
    this.t = 0; this.hour = 19; this.fx = {}; this.screenT = 0; this.rng = new RNG(3);
    this.poly = LAYOUT.walls.map(w => w.a);
    const t0 = performance.now();
    this.build();
    this.buildMs = performance.now() - t0;
    q.onChange = () => this.applyQuality();
    this.applyQuality();
    this.setHour(19, true);
    this.resize();
    if (typeof addEventListener !== 'undefined') addEventListener('resize', () => this.resize());
  }
  get dragged() { return this.ctl.dragged; }

  // ═══════════ сборка ═══════════
  build() {
    const S = this.quality.tex, sc = this.scene, rng = new RNG(1);
    const T = this.T = {
      brick: TX.brickWhite(S), red: TX.brickRed(S), tile: TX.floorTile(S), pave: TX.paving(S), asph: TX.asphalt(S),
      onyx: TX.onyx(S), marble: TX.marble(S), wood: TX.woodTop(S, 2), rtop: TX.roundTop(S), tufted: TX.tufted(S), velour: TX.velour(S),
      gears: TX.gears(S), leaf: TX.leaf(S), halo: TX.halo(S), blob: TX.blob(S), note: TX.note(S), planks: TX.planks(S),
    };
    this.screen = new TX.Screen(128, 72); this.fire = new TX.Screen(64, 24);
    this.screen.draw(0); this.fire.draw(0);
    const lam = o => new THREE.MeshLambertMaterial(o), bas = o => new THREE.MeshBasicMaterial(o);
    this.mat = {
      solid: lam({ vertexColors: true }),
      shiny: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x555555 }),
      glow: bas({ vertexColors: true }),
      glass: lam({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false }),
      velour: lam({ vertexColors: true, map: T.velour }),
      tufted: lam({ vertexColors: true, map: T.tufted }),
      foliage: lam({ vertexColors: true, map: T.velour }),
      onyx: bas({ map: T.onyx }),
      marble: new THREE.MeshPhongMaterial({ map: T.marble, shininess: 70, specular: 0x555555 }),
      wood: lam({ map: T.wood }), rtop: lam({ map: T.rtop }), planks: lam({ vertexColors: true, map: T.planks }),
      leaf: lam({ vertexColors: true, map: T.leaf, alphaTest: 0.5, side: THREE.DoubleSide }),
      gears: lam({ map: T.gears, alphaTest: 0.4, emissive: 0x220606 }),
      screen: bas({ map: this.screen.tex }), fire: bas({ map: this.fire.tex }),
    };
    this.glowMats = [this.mat.glow, this.mat.onyx];   // яркость «само светится» от часа/стробоскопа
    this.wallMats = []; this.outMats = []; this.signMats = [];
    this.halos = []; this.blobs = [];
    this.root = new THREE.Group(); sc.add(this.root);
    this.ceilG = new THREE.Group(); this.cutG = new THREE.Group(); this.fineG = new THREE.Group();
    this.root.add(this.ceilG, this.cutG, this.fineG);
    this.wallG = [];          // { g, mid, n } — декор стены прячется, когда камера за ней
    const k = new Kit();
    this.buildFloor(); this.buildWalls(); this.buildCeiling(k); this.buildFacade(k, rng);
    this.buildFurniture(k, rng); this.buildBar(k, rng); this.buildDecor(rng);
    k.build(this.mat, this.root);
    this.buildHalos(); this.buildBlobs(); this.buildLights(); this.buildFx(rng); this.buildPick();
    this.root.traverse(o => { if (o.isMesh || o.isPoints) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  }
  // ближайшая кирпичная стена к точке → { a, b, n, len, mid }
  wallAt(x, z) {
    let best = null, bd = 1e9;
    for (const w of this.walls) { const d = segDist(x, z, w.a, w.b); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  // матрица «на стене»: предмет смотрит в зал (+Z локально = нормаль), off — отступ от стены
  onWall(x, z, y, off = 0.02) {
    const w = this.wallAt(x, z), t = clamp(((x - w.a[0]) * w.dx + (z - w.a[1]) * w.dz) / w.len, 0, 1);
    const px = w.a[0] + w.dx * t * w.len + w.n[0] * off, pz = w.a[1] + w.dz * t * w.len + w.n[1] * off;
    return { M: place(px, y, pz, Math.atan2(w.n[0], w.n[1])), w };
  }
  buildFloor() {
    const T = this.T, pts = this.poly.map(([x, z]) => new THREE.Vector2(x, -z));
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(-Math.PI / 2);
    const lm = TX.lightMap(W, D, DECOR.floor.map(f => ({ s: f.x, y: f.z, kind: 'wash', c: f.c, a: f.a, r: f.r, sy: f.sy ?? 1 })), '#4a3c34', 24);
    lm.repeat.set(1 / W, -1 / D);
    T.tile.repeat.set(1 / 0.4, 1 / 0.4);
    this.floorMat = new THREE.MeshLambertMaterial({ map: T.tile, lightMap: lm, lightMapIntensity: Math.PI * 1.1 });
    const m = new THREE.Mesh(g, this.floorMat); m.name = 'floor'; this.root.add(m); this.floor = m;
  }
  buildWalls() {
    const T = this.T;
    this.walls = [];
    for (const w of LAYOUT.walls) {
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
      let n = [-dz / len, dx / len];
      const mx = (w.a[0] + w.b[0]) / 2, mz = (w.a[1] + w.b[1]) / 2;
      if (!inPoly(mx + n[0] * 0.05, mz + n[1] * 0.05, this.poly)) n = [-n[0], -n[1]];
      const rec = { ...w, dx: dx / len, dz: dz / len, len, n, mid: [mx, mz] };
      // кирпичная «стена» в линии фасада — это колонна с камином (строится отдельно), остальные — стены зала
      if (w.kind === 'brick' && w.a[1] === 0 && w.b[1] === 0) this.pillarWall = rec;
      else if (w.kind === 'brick') this.walls.push(rec);
    }
    // стена: плоскость внутрь зала, кирпич + свой запечённый свет
    for (const w of this.walls) {
      const ry = Math.atan2(w.n[0], w.n[1]), ux = Math.cos(ry), uz = -Math.sin(ry);
      const left = [w.mid[0] - ux * w.len / 2, w.mid[1] - uz * w.len / 2];
      const spots = DECOR.wall.filter(s => this.wallAt(s.x, s.z) === w).map(s => ({ ...s, s: (s.x - left[0]) * ux + (s.z - left[1]) * uz }));
      const lm = TX.lightMap(w.len, H, spots, '#6a4a32');
      const map = T.brick.clone(); map.needsUpdate = true; map.repeat.set(w.len, H);
      const mat = new THREE.MeshBasicMaterial({ map, lightMap: lm, lightMapIntensity: Math.PI * 1.25 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w.len, H), mat);
      m.position.set(w.mid[0], H / 2, w.mid[1]); m.rotation.y = ry; m.name = 'wall';
      this.root.add(m); this.wallMats.push(mat);
      const g = new THREE.Group(); this.root.add(g);
      this.wallG.push({ g, mid: w.mid, n: w.n, w, kit: new Kit() });
      w.group = this.wallG[this.wallG.length - 1];
    }
  }
  // белый кирпичный параллелепипед до потолка (колонна у витрины, колонна за стойкой): грани — Basic + свет
  brickBox(r, spotsByFace = {}) {
    const T = this.T, x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3];
    const faces = { nz: [[x0, z0], [x1, z0], [0, -1]], pz: [[x1, z1], [x0, z1], [0, 1]], nx: [[x0, z1], [x0, z0], [-1, 0]], px: [[x1, z0], [x1, z1], [1, 0]] };
    for (const key in faces) {
      const [a, b, n] = faces[key], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2 + n[0] * 0.001, mz = (a[1] + b[1]) / 2 + n[1] * 0.001;
      if (!inPoly(mx + n[0] * 0.05, mz + n[1] * 0.05, this.poly)) continue;   // грань в стене/за стеклом
      const lm = TX.lightMap(len, H, spotsByFace[key] || [{ s: len / 2, y: 0.2, kind: 'up', c: AMB, a: 0.7, r: len * 0.5, len: 3 }], '#6a5444', 20);
      const map = T.brick.clone(); map.needsUpdate = true; map.repeat.set(len, H);
      const mat = new THREE.MeshBasicMaterial({ map, lightMap: lm, lightMapIntensity: Math.PI * 1.25 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat);
      m.position.set(mx, H / 2, mz); m.rotation.y = Math.atan2(n[0], n[1]);
      this.root.add(m); this.wallMats.push(mat);
    }
  }
  buildCeiling(k) {
    // тёмный потолок (прямоугольник + коридорчик в туалет), трубы-воздуховоды и «срез» стен сверху
    const pts = this.poly.map(([x, z]) => new THREE.Vector2(x, z));
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(Math.PI / 2); g.translate(0, H, 0);
    const cm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x120e10 })); this.ceilG.add(cm);
    const cap = new Kit();
    for (const w of LAYOUT.walls) {
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], len = Math.hypot(dx, dz);
      cap.box('solid', null, len + 0.16, 0.06, 0.16, (w.a[0] + w.b[0]) / 2, H + 0.03, (w.a[1] + w.b[1]) / 2, 0x2a2224, 0, Math.atan2(-dz, dx));
    }
    cap.build(this.mat, this.root);
    // воздуховоды: вдоль длинного стола и поперёк у бара (серебристые, с хомутами)
    const ck = new Kit(), duct = (x0, z0, x1, z1, r) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0), M = place((x0 + x1) / 2, H - r - 0.12, (z0 + z1) / 2, ry);
      ck.cyl('shiny', M, r, len, 12, 0, 0, 0, 0x9ea4ae, Math.PI / 2);
      for (let s = -len / 2 + 0.6; s < len / 2; s += 1.2) { ck.cyl('shiny', M, r * 1.06, 0.05, 12, 0, 0, s, 0xb8bcc2, Math.PI / 2); ck.box('solid', M, 0.02, r + 0.12, 0.02, 0, r / 2 + 0.06, s, 0x222222); }
    };
    duct(2.4, 0.4, 2.4, D - 0.4, 0.17); duct(0.4, 1.9, 9.6, 1.9, 0.13); duct(5.5, 8.9, 5.5, D - 0.4, 0.12); duct(5.5, 8.9, 9.6, 8.9, 0.1);
    for (const [x, z] of DECOR.spots) { ck.cyl('solid', null, 0.06, 0.05, 8, x, H - 0.03, z, 0x1a1a1a); ck.cyl('glow', null, 0.04, 0.01, 8, x, H - 0.06, z, 0xffe0b0); this.halos.push([x, H - 0.1, z, 0xffc070, 0]); }
    ck.build(this.mat, this.ceilG);
  }
  buildFacade(k, rng) {
    const T = this.T, cut = new Kit(), out = new Kit();
    const lamO = o => { const m = new THREE.MeshLambertMaterial(o); this.outMats.push(m); return m; };
    // стекло витрины и двери
    const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    for (const w of LAYOUT.walls) if (w.kind === 'glass') {
      const len = Math.abs(w.b[0] - w.a[0]), mx = (w.a[0] + w.b[0]) / 2;
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.75), glassMat); gm.position.set(mx, 1.375, 0); gm.renderOrder = 3; this.root.add(gm);
      const x0 = Math.min(w.a[0], w.b[0]), n = Math.max(1, Math.round(len / 1.9));
      for (let i = 0; i <= n; i++) k.box('solid', null, 0.06, 2.75, 0.08, x0 + len * i / n, 1.375, 0, 0x151515);
      k.box('solid', null, len, 0.06, 0.1, mx, 0.03, 0, 0x151515); k.box('solid', null, len, 0.08, 0.1, mx, 2.75, 0, 0x151515);
    }
    const door = LAYOUT.walls.find(w => w.kind === 'door');
    if (door) {
      const x0 = Math.min(door.a[0], door.b[0]), x1 = Math.max(door.a[0], door.b[0]);
      for (const x of [x0, x1]) k.box('solid', null, 0.08, 2.75, 0.1, x, 1.375, 0, 0x151515);
      k.box('solid', null, x1 - x0, 0.1, 0.1, (x0 + x1) / 2, 2.72, 0, 0x151515);
      // открытая стеклянная створка вдоль витрины
      const dm = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 0.1, 2.5), glassMat); dm.position.set(x0 - 0.02, 1.3, -0.5); dm.rotation.y = Math.PI / 2 - 0.2; this.root.add(dm);
    }
    // тёмный короб над витриной изнутри (прячется вместе с потолком, когда смотрим сверху)
    const hk = new Kit(); hk.box('solid', null, W, H - 2.75, 0.3, W / 2, (H + 2.75) / 2, 0.15, 0x141012); hk.build(this.mat, this.ceilG);
    // крыши соседних домов вокруг зала (сверху не «висим» в пустоте)
    const rk = new Kit(), R = 0x1c1719;
    rk.box('solid', null, 40, H + 0.6, 40, -20.6, (H + 0.4) / 2 - 0.1, 20, R); rk.box('solid', null, 40, H + 0.6, 40, W + 21.5, (H + 0.4) / 2 - 0.1, 20, R); rk.box('solid', null, W + 1.4, H + 0.6, 30, W / 2, (H + 0.4) / 2 - 0.1, D + 15.2, R);
    // полоса между левой стеной и соседним домом — сплошная, кроме коридорчика в туалет
    if (WC) { const [, z0, x1, z1] = WC.rect, fx0 = W + 0.06, fx1 = W + 1.5, bh = H + 0.6, by = (H + 0.4) / 2 - 0.1;
      rk.box('solid', null, fx1 - fx0, bh, z0 - 0.06, (fx0 + fx1) / 2, by, (z0 - 0.06) / 2, R);
      rk.box('solid', null, fx1 - fx0, bh, 40 - z1 - 0.06, (fx0 + fx1) / 2, by, (z1 + 0.06 + 40) / 2, R);
      rk.box('solid', null, fx1 - x1 - 0.06, bh, z1 - z0, (x1 + 0.06 + fx1) / 2, by, (z0 + z1) / 2, R); }
    for (let i = 0; i < 14; i++) rk.box('solid', null, 1.2, 0.5, 0.8, (i % 2 ? -3 - i : W + 3 + i), H + 0.6, 2 + i * 1.7, 0x2a2426);
    rk.build(this.mat, this.cutG2 = new THREE.Group()); this.root.add(this.cutG2);
    // ── снаружи: красный кирпич, маркиза, вывески ──
    const red = (w, h, x, y, z, d = 0.3) => { const t = T.red.clone(); t.needsUpdate = true; t.repeat.set(w, h); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lamO({ map: t })); m.position.set(x, y, z); return m; };
    const pw = this.pillarWall;
    this.root.add(red(0.7, 3.6, W + 0.35, 1.8, -0.15));                 // пилон слева (с неоном)
    this.root.add(red(0.5, 3.6, -0.25, 1.8, -0.15));                    // пилон справа
    if (pw) this.root.add(red(Math.abs(pw.b[0] - pw.a[0]) + 0.1, 2.75, (pw.a[0] + pw.b[0]) / 2, 1.375, -0.12, 0.24));
    this.cutG.add(red(W + 1.2, 0.85, W / 2, 3.175, -0.2, 0.4));        // карниз над витриной
    // верхние этажи (видно только с улицы)
    const up = new THREE.Mesh(new THREE.PlaneGeometry(W + 1.2, 6), lamO({ map: TX.upperFacade(512, false), emissive: 0xffffff, emissiveMap: TX.upperFacade(512, true), emissiveIntensity: 0 }));
    up.position.set(W / 2, 6.6, -0.4); up.rotation.y = Math.PI; this.cutG.add(up); this.upMat = up.material;
    // соседние дома по обе стороны
    for (const [x0, x1] of [[W + 0.7, W + 22], [-22, -0.5]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 9), lamO({ map: TX.street(512, false), emissive: 0xffffff, emissiveMap: TX.street(512, true), emissiveIntensity: 0 }));
      m.position.set((x0 + x1) / 2, 4.5, -0.1); m.rotation.y = Math.PI; this.cutG.add(m); this.sideMats = (this.sideMats || []).concat(m.material);
    }
    // маркиза: чёрный навес над верандой
    const aw = new Kit();
    const ang = Math.atan2(0.5, 3.3);
    aw.box('solid', null, W + 1.0, 0.04, 3.4, W / 2, 2.72, -1.7, 0x1a1a1c, -ang);
    aw.box('solid', null, W + 1.0, 0.24, 0.03, W / 2, 2.35, -3.4, 0x141416);
    for (const x of [-0.3, W / 2, W + 0.3]) aw.box('solid', null, 0.04, 0.04, 3.4, x, 2.7, -1.7, 0x333333, -ang);
    aw.build(this.mat, this.cutG);
    // неоновая вывеска на левом пилоне и круглая вывеска-логотип на колонне
    const sign = (tex, w, h, x, y, z, ry = Math.PI, g = this.root) => { const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true }); this.signMats.push(m); const me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); me.position.set(x, y, z); me.rotation.y = ry; g.add(me); return me; };
    sign(TX.neon(512), 0.62, 1.24, W + 0.35, 1.75, -0.31);
    this.halos.push([W + 0.35, 2.3, -0.4, 0xff4fb0, 1], [W + 0.35, 1.7, -0.4, 0x39f2d9, 1], [W + 0.35, 1.25, -0.4, 0xc86bff, 1]);
    if (pw) {
      const cx = (pw.a[0] + pw.b[0]) / 2;
      const rs = sign(TX.roundSign(512), 0.8, 0.8, cx, 2.15, -0.26);
      k.cyl('solid', null, 0.41, 0.03, 20, cx, 2.15, -0.245, 0x111111, Math.PI / 2);
      P.lantern(k, place(cx - 0.55, 2.0, -0.26, Math.PI), 0.8); this.halos.push([cx - 0.55, 2.0, -0.4, 0xffc070, 1]);
      sign(this.fire.tex, 0.68, 0.22, cx, 2.05, pw.a[1] + 0.56, 0);                                      // электрокамин внутри
      k.box('solid', null, 0.76, 0.3, 0.06, cx, 2.05, 0.53, 0x0d0d0d);
      this.halos.push([cx, 2.05, 0.7, 0xff7a20, 1]);
      this.brickBox([pw.a[0], 0, pw.b[0], 0.55], {
        pz: [{ s: 0.4, y: 3.3, kind: 'down', c: MAG, a: 0.95, r: 0.4, len: 2.2 }, { s: 0.4, y: 2.05, kind: 'glow', c: '#ff8030', a: 0.6, r: 0.5 }],
        nx: [{ s: 0.27, y: 0.2, kind: 'up', c: AMB, a: 0.9, r: 0.3, len: 3.2 }], px: [{ s: 0.27, y: 0.2, kind: 'up', c: AMB, a: 0.9, r: 0.3, len: 3.2 }],
      });
    }
    // улица: веранда, тротуар, бордюр, дорога, дома напротив, фонари
    const flat = (tex, rep, x0, z0, x1, z1, y = 0) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) * rep, (z1 - z0) * rep); const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), lamO({ map: t })); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); this.root.add(m); return m; };
    flat(T.pave, 1.6, -0.5, -3.6, W + 0.7, 0, 0.005);
    flat(T.pave, 1.2, -30, -5.4, 40, -3.6, 0.0);
    flat(T.asph, 0.5, -30, -12.6, 40, -5.4, -0.12); this.road = this.root.children[this.root.children.length - 1];
    flat(T.pave, 1.2, -30, -15, 40, -12.6, 0.0);
    out.box('solid', null, 70, 0.14, 0.2, 5, -0.05, -5.45, 0x9a9690); out.box('solid', null, 70, 0.14, 0.2, 5, -0.05, -12.55, 0x9a9690);
    for (let x = -28; x < 40; x += 3) out.box('glow', null, 1.5, 0.01, 0.12, x, -0.11, -9.0, 0xb8b4a8);
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), lamO({ map: TX.street(512, false), emissive: 0xffffff, emissiveMap: TX.street(512, true), emissiveIntensity: 0 }));
    bm.position.set(5, 8, -15.2); this.root.add(bm); this.farMat = bm.material;
    for (const [x, z] of [[-0.35, -3.95], [14, -3.95], [-14, -12.9], [8, -12.9]]) {
      out.cyl('solid', null, 0.06, 3.7, 6, x, 1.85, z, 0x1a1a1a); out.cyl('solid', null, 0.12, 0.3, 6, x, 0.15, z, 0x1a1a1a);
      out.box('solid', null, 0.3, 0.05, 0.3, x, 3.75, z, 0x1a1a1a); out.cyl('glow', null, 0.13, 0.35, 6, x, 3.55, z, 0xfff0c8, 0, 0, 0, 0.7);
      this.halos.push([x, 3.55, z, 0xffe0a0, 2]);
    }
    // веранда: низкий забор (проход к двери оставлен), кадки с туями — из LAYOUT.blocks
    const dx0 = LAYOUT.door.x - 0.9, dx1 = LAYOUT.door.x + 0.9;
    for (const [a, b] of [[-0.4, dx0], [dx1, W + 0.6]]) {
      out.box('solid', null, b - a, 0.04, 0.04, (a + b) / 2, 0.75, -3.62, 0x2a2a2a); out.box('solid', null, b - a, 0.03, 0.03, (a + b) / 2, 0.1, -3.62, 0x2a2a2a);
      for (let x = a; x <= b; x += 0.25) out.box('solid', null, 0.02, 0.66, 0.02, x, 0.42, -3.62, 0xd8d8d8, 0, 0, 0.6 * (Math.round(x * 4) % 2 ? 1 : -1));
    }
    out.build(this.mat, this.root);
    cut.build(this.mat, this.cutG);
    this.skyMats = [];
  }
  buildFurniture(k, rng) {
    const VEL = COL.velour, fine = new Kit();
    for (const t of LAYOUT.tables) {
      if (t.top === 'bar') { for (const s of t.seats) P.stool(k, place(s.x, 0, s.z, s.face)); continue; }
      if (t.shape === 'round') P.roundTable(k, t, 'rtop', t.top === 'terrace' ? 0.72 : 0.75);
      else { P.rectTable(k, t, t.top === 'wood' ? 'wood' : 'marble'); if (t.top === 'wood') P.tableware(fine, t, rng); }
      this.blobs.push([t.x, t.z, Math.max(t.w, t.d) + 0.5, Math.min(t.w, t.d) + 0.5, t.w >= t.d ? 0 : Math.PI / 2]);
      for (const s of t.seats) {
        const M = place(s.x, 0, s.z, s.face);
        if (s.kind === 'armchair') {
          const col = t.zone === 'round' || t.zone === 'bar' ? VEL[rng.int(0, 1)] : t.zone === 'long' ? rng.pick([0x8a7a70, 0x7a6e68, 0x9c9aa0]) : rng.pick(VEL);
          P.armchair(k, M, col); this.blobs.push([s.x, s.z, 0.75, 0.75, s.face]);
        } else if (s.kind === 'chair') { P.ovalChair(k, M, t.zone === 'veranda' ? 0xa4a4a8 : 0x8e8a90, t.zone === 'veranda' ? COL.wood : COL.black); this.blobs.push([s.x, s.z, 0.6, 0.6, 0]); }
      }
    }
    // диваны из блоков: спинка — к ближайшей стене
    for (const b of LAYOUT.blocks) {
      const r = b.rect, alongZ = r[3] - r[1] > r[2] - r[0];
      if (b.kind === 'sofa') {
        const col = b.id.includes('pink') ? COL.pink : COL.olive;
        if (alongZ) { const d0 = this.wallAt(r[0], (r[1] + r[3]) / 2), dl = segDist(r[0], (r[1] + r[3]) / 2, d0.a, d0.b), d1 = this.wallAt(r[2], (r[1] + r[3]) / 2), dr = segDist(r[2], (r[1] + r[3]) / 2, d1.a, d1.b);
          const bx = dl < dr ? r[0] : r[2], n = dl < dr ? [1, 0] : [-1, 0];
          P.sofa(k, [bx, r[1]], [bx, r[3]], n, col, { depth: r[2] - r[0] });
        } else { const bz = r[1] < 0.2 ? r[1] : r[3]; P.sofa(k, [r[0], bz], [r[2], bz], bz === r[1] ? [0, 1] : [0, -1], col, { depth: r[3] - r[1] }); }
      } else if (b.kind === 'plant') {
        const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
        if (cz > 0) P.plant(k, place(cx, 0, cz, rng.next() * 6), rng, { h: 2.0, leaves: 11, tint: 0xb84a44, big: 1.25 });
        else if (b.id.startsWith('thuja')) P.shrub(k, place(cx, 0, cz), rng, { h: 1.8, r: 0.24, pot: 0x9a948c });
        else P.shrub(k, place(cx, 0, cz), rng, { h: 0.9, r: 0.35, pot: 0xa0643a, potH: 0.35 });
      } else if (b.kind === 'speaker') {
        const onStage = STG && inRect((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, STG.rect);
        P.speaker(k, place((r[0] + r[2]) / 2, onStage ? STG.h : 0, (r[1] + r[3]) / 2, -Math.PI / 2 - 0.5));
      } else if (b.kind === 'stage') this.buildPodium(k, b.rect);
      else if (b.kind === 'column' && b.id !== 'pillar' && b.id !== 'bar-column' && (r[1] + r[3]) / 2 < -2) { /* столб фонаря строится с улицей */ }
    }
    fine.build(this.mat, this.fineG);
  }
  // сцена: низкий деревянный подиум у стены — доски, чёрный кант со светящейся полосой, монитор, стойка микрофона
  buildPodium(k, r) {
    const [x0, z0, x1, z1] = r, h = STG.h, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    k.box('solid', null, w, h - 0.03, d, cx, (h - 0.03) / 2, cz, 0x151212);
    k.box('planks', null, w, 0.03, d, cx, h - 0.015, cz, 0xffffff);
    // кант: чёрная кромка, под ней тёплая светодиодная полоса по краям, обращённым в зал
    k.box('solid', null, 0.04, 0.05, d, x0, h - 0.02, cz, 0x0c0c0c);
    k.box('glow', null, 0.012, 0.025, d - 0.06, x0 - 0.02, 0.05, cz, 0xffb060);
    for (const z of [z0, z1]) { k.box('solid', null, w, 0.05, 0.04, cx, h - 0.02, z, 0x0c0c0c); k.box('glow', null, w - 0.06, 0.025, 0.012, cx, 0.05, z + (z === z0 ? -0.02 : 0.02), 0xffb060); }
    for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.45) this.halos.push([x0 - 0.05, 0.06, z, 0xff9a40, 0]);
    // монитор-«клин» у края сцены, смотрит на музыканта
    const mM = place(x0 + 0.28, h, cz - 0.45, Math.PI / 2);
    k.box('solid', mM, 0.4, 0.22, 0.26, 0, 0.11, 0, 0x121212, -0.45); k.box('solid', mM, 0.3, 0.12, 0.01, 0, 0.12, -0.13, 0x2a2a2a, -0.45);
    // стойка микрофона сбоку от музыканта
    const mx = STG.x - 0.2, mz = STG.z + 0.55;
    k.cyl('solid', null, 0.14, 0.02, 10, mx, h + 0.01, mz, 0x1a1a1a);
    k.cyl('shiny', null, 0.012, 1.45, 5, mx, h + 0.73, mz, 0x9a9aa0);
    k.cyl('shiny', null, 0.01, 0.35, 5, mx - 0.1, h + 1.48, mz - 0.05, 0x9a9aa0, 0, 0, Math.PI / 2 - 0.3);
    k.cyl('solid', null, 0.025, 0.1, 6, mx - 0.26, h + 1.53, mz - 0.05, 0x202020, 0, 0, Math.PI / 2 - 0.3);
    // прожекторы на стене над сценой
    for (const z of [z0 + 0.35, z1 - 0.35]) {
      const M = place(W - 0.12, 2.95, z, -Math.PI / 2);
      k.box('solid', M, 0.1, 0.04, 0.2, 0, 0.1, 0.05, 0x111111); k.cyl('solid', M, 0.075, 0.2, 8, 0, 0, 0.12, 0x151515, 0.9, 0, 0);
      k.cyl('glow', M, 0.06, 0.01, 8, 0, -0.08, 0.2, 0xffe0b0, 0.9, 0, 0);
      this.halos.push([W - 0.35, 2.85, z, 0xffc070, 1]);
    }
    this.blobs.push([cx, cz, w + 0.4, d + 0.4, 0]);
  }
  // барная стойка дугой (LAYOUT.bar): чёрный корпус по дуге, чёрная столешница, светящийся оникс по фасаду
  // всей дуги в чёрных рамках; короткий «рукав» к бэк-бару; внутри — кирпичная колонна с ТВ; за ней бэк-бар
  buildBar(k, rng) {
    const B = BAR, PI = Math.PI, top = 1.1;
    const at = (f, o = 0) => B.at(f, o);
    const nrm = f => { const nx = Math.sin(f) / B.a, nz = -Math.cos(f) / B.b, l = Math.hypot(nx, nz); return [nx / l, nz / l]; };
    const ryAt = f => { const [nx, nz] = nrm(f); return Math.atan2(nx, nz); };
    const f0 = -PI / 2, f1 = B.phiL, xr = at(f0)[0], back = B.back + B.backD;
    // контур корпуса в плане (фасад дуги → стена → внутренняя дуга → рукав), выдавливание вверх
    const shape = (o, oi, y0, y1) => {
      const pts = [], N = 40;
      pts.push([xr - o, B.back]);
      for (let i = 0; i <= N; i++) pts.push(at(f0 + (f1 - f0) * i / N, o));
      pts.push([W, at(f1, o)[1]], [W, at(f1, -B.depth - oi)[1] + 0.25]);
      for (let i = N; i >= 0; i--) { const f = f0 + (f1 - f0) * i / N; const p = at(f, -B.depth - oi); if (p[0] < W - 0.02) pts.push(p); }
      pts.push([xr + B.depth + oi, B.back]);
      const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-PI / 2); g.translate(0, y0, 0); return g;
    };
    k.raw('solid', shape(0, 0, 0, 1.04), new THREE.Matrix4(), 0x121112);
    k.raw('solid', shape(0.05, -0.03, 1.04, top), new THREE.Matrix4(), 0x0c0b0c);
    // оникс: панели по дуге (лента с UV на панель), между ними чёрные стойки, внизу цоколь
    const L = [], N = 120; let len = 0;
    for (let i = 0; i <= N; i++) { const f = f0 + (f1 - f0) * i / N; if (i) { const a = at(f0 + (f1 - f0) * (i - 1) / N), b = at(f); len += Math.hypot(b[0] - a[0], b[1] - a[1]); } L.push([f, len]); }
    const fAt = s => { for (let i = 1; i < L.length; i++) if (L[i][1] >= s) { const t = (s - L[i - 1][1]) / (L[i][1] - L[i - 1][1]); return L[i - 1][0] + (L[i][0] - L[i - 1][0]) * t; } return f1; };
    const np = Math.max(3, Math.round(len / 0.8)), pw = len / np, I = new THREE.Matrix4();
    for (let i = 0; i < np; i++) {
      const s0 = i * pw + 0.035, s1 = (i + 1) * pw - 0.035, M = 6, pos = [], uv = [], idx = [];
      for (let j = 0; j <= M; j++) {
        const f = fAt(s0 + (s1 - s0) * j / M), [x, z] = at(f, 0.012);
        pos.push(x, 0.14, z, x, 1.0, z); uv.push(j / M, 0, j / M, 1);
        if (j) { const q = (j - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); k.raw('onyx', g, I, 0xffffff);
    }
    for (let i = 0; i <= np; i++) { const f = fAt(Math.min(len, i * pw)), [x, z] = at(f, 0.02); k.box('solid', null, 0.07, 1.04, 0.05, x, 0.52, z, 0x0e0d0e, 0, ryAt(f)); }
    for (let i = 0; i < 24; i++) { const fa = f0 + (f1 - f0) * i / 24, fb = f0 + (f1 - f0) * (i + 1) / 24, a = at(fa, 0.02), b = at(fb, 0.02); k.box('solid', null, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.02, 0.14, 0.05, (a[0] + b[0]) / 2, 0.07, (a[1] + b[1]) / 2, 0x0e0d0e, 0, ryAt((fa + fb) / 2)); }
    for (let i = 0; i < 7; i++) { const [x, z] = at(f0 + (f1 - f0) * (i + 0.5) / 7, 0.3); this.halos.push([x, 0.6, z, 0xffb030, 3]); }
    // рукав (прямой отрезок правого конца до бэк-бара): тоже оникс, смотрит в зал
    { const z0 = B.cz, z1 = B.back, M = place(xr - 0.012, 0, (z0 + z1) / 2, -PI / 2), l = z1 - z0;
      k.plane('onyx', M, l - 0.08, 0.86, 0, 0.57, 0, 0xffffff); k.box('solid', M, 0.07, 1.04, 0.04, l / 2, 0.52, 0.01, 0x0e0d0e); k.box('solid', M, l, 0.14, 0.05, 0, 0.07, 0.02, 0x0e0d0e); }
    // колонна внутри дуги: белый кирпич до потолка, дозаторы, краны, мото-табличка, три ТВ, таблички SUS||GO
    const col = LAYOUT.blocks.find(b => b.id === 'bar-column');
    const [c0, cz0, c1, cz1] = col.rect;
    this.brickBox(col.rect, {
      nz: [{ s: 0.45, y: 1.1, kind: 'up', c: AMB, a: 0.8, r: 0.5, len: 1.6 }, { s: 0.2, y: 3.3, kind: 'down', c: PINK, a: 0.5, r: 0.3, len: 1.4 }],
      nx: [{ s: 0.4, y: 1.1, kind: 'up', c: AMB, a: 0.8, r: 0.5, len: 1.6 }, { s: 0.7, y: 3.3, kind: 'down', c: MAG, a: 0.55, r: 0.35, len: 1.5 }],
      pz: [{ s: 0.45, y: 1.1, kind: 'up', c: AMB, a: 0.7, r: 0.5, len: 1.6 }],
    });
    const Mz = y => place((c0 + c1) / 2, y, cz0, PI), Mx = y => place(c0, y, (cz0 + cz1) / 2, -PI / 2);
    P.dispensers(k, Mz(1.85), 6, rng, c1 - c0 - 0.1); P.dispensers(k, Mx(1.85), 5, rng, cz1 - cz0 - 0.1);
    P.taps(k, Mz(1.38), 4, 0.6); P.taps(k, Mx(1.38), 3, 0.5);
    P.tv(k, local(place((c0 + c1) / 2, 2.72, cz0 - 0.12, PI), 0, 0, 0, 0.2, 0, 0).clone(), 1.0, 0.6);
    P.tv(k, local(place(c0 - 0.12, 2.72, (cz0 + cz1) / 2, -PI / 2), 0, 0, 0, 0.2, 0, 0).clone(), 1.0, 0.6);
    P.tv(k, local(place((c0 + c1) / 2, 2.72, cz1 + 0.12, 0), 0, 0, 0, 0.2, 0, 0).clone(), 0.9, 0.55);
    const signTex = TX.board(512), sm = new THREE.MeshBasicMaterial({ map: signTex }); this.signMats.push(sm);
    const bmesh = (x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.28), sm); m.position.set(x, 3.2, z); m.rotation.y = ry; this.root.add(m); };
    bmesh((c0 + c1) / 2, cz0 - 0.03, PI); bmesh(c0 - 0.03, (cz0 + cz1) / 2, -PI / 2);
    this.halos.push([(c0 + c1) / 2, 2.72, cz0 - 0.4, 0xffa050, 1], [c0 - 0.4, 2.72, (cz0 + cz1) / 2, 0xffa050, 1]);
    const moto = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshLambertMaterial({ map: TX.moto(512) }));
    moto.position.set(c0 - 0.01, 1.0, (cz0 + cz1) / 2); moto.rotation.y = -PI / 2; this.root.add(moto);
    // на правом конце дуги (смотрит в зал): красный фонарь, изогнутый чёрный SUS||GO с кофемашиной, Будда
    {
      const onTop = (f, o = -0.3) => { const [x, z] = at(f, o); return place(x, top, z, ryAt(f)); };   // локально: +Z — наружу, к гостям
      const lm = onTop(-1.38, -0.28); k.box('solid', lm, 0.2, 0.03, 0.2, 0, 0.015, 0, 0xa01818);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box('solid', lm, 0.025, 0.36, 0.025, sx * 0.085, 0.2, sz * 0.085, 0xb81c1c);
      k.box('solid', lm, 0.22, 0.04, 0.22, 0, 0.39, 0, 0xa01818); k.cyl('solid', lm, 0.06, 0.1, 4, 0, 0.46, 0, 0xa01818, 0, PI / 4, 0, 0.3);
      k.box('glow', lm, 0.1, 0.2, 0.1, 0, 0.18, 0, 0xffb060);
      { const p = new THREE.Vector3(0, 0.2, 0).applyMatrix4(lm); this.halos.push([p.x, p.y, p.z, 0xff9040, 0]); }
      // SUS||GO: полуцилиндр выпуклостью к гостям, надпись только снаружи; за ним жёлтый «капот» кофемашины
      const fs = -1.02, [sx, sz] = at(fs, -0.28), ry = ryAt(fs);
      const sM = place(sx, top, sz, ry);
      k.put('solid', P.CYL(16, 1, 1, true, PI * 1.45, PI * 1.1), local(sM, 0, 0.26, 0, 0, 0, 0, 0.27, 0.52, 0.3), 0x0c0c0c);
      const cm = new THREE.MeshBasicMaterial({ map: TX.board(512, '#0c0c0c', '#e8e2d6') }); this.signMats.push(cm);
      const cg = new THREE.CylinderGeometry(0.275, 0.275, 0.3, 16, 1, true, -PI * 0.25, PI * 0.5);
      const cmesh = new THREE.Mesh(cg, cm); cmesh.position.set(sx, top + 0.26, sz); cmesh.rotation.y = ry; this.root.add(cmesh);
      const cback = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x0c0c0c, side: THREE.BackSide })); cback.position.copy(cmesh.position); cback.rotation.y = ry; this.root.add(cback);
      k.put('solid', P.CYL(14, 1, 1, false, 0, PI), local(sM, 0.3, 0.22, -0.08, 0, PI / 2, 0, 0.2, 0.44, 0.2), 0xf0c648);
      k.box('shiny', sM, 0.3, 0.3, 0.26, 0.3, 0.15, -0.12, 0xd0d0d4);
      k.cyl('solid', sM, 0.07, 0.28, 8, 0.62, 0.14, -0.05, 0x202020); k.cyl('glass', sM, 0.08, 0.16, 8, 0.62, 0.36, -0.05, 0x8a6a4a, 0, 0, 0, 1.2);
      // Будда
      const bM = onTop(-0.66, -0.3);
      k.sph('solid', bM, 0.14, 0, 0.1, 0, 0x3a3a3c, 1.2, 0.8, 1); k.sph('solid', bM, 0.1, 0, 0.27, 0, 0x3a3a3c, 1, 1.2, 0.9); k.sph('solid', bM, 0.06, 0, 0.42, 0, 0x3a3a3c);
      // свечи, растение, бутылки по дуге
      for (const f of [-0.3, 0.25]) { const [x, z] = at(f, -0.3); k.cyl('solid', null, 0.035, 0.14, 8, x, top + 0.07, z, 0xf4f0e8); k.box('glow', null, 0.012, 0.03, 0.012, x, top + 0.155, z, 0xffd080); this.halos.push([x, top + 0.17, z, 0xffb050, 0]); }
      P.plant(k, local(onTop(-0.02, -0.32), 0, 0, 0, 0, 0, 0, 0.45, 0.45, 0.45).clone(), rng, { h: 1.1, leaves: 7, tint: 0x5a8a4a, big: 0.9, pot: 0xd8d0c0 });   // горшок ~20 см
      P.bottles(k, onTop(0.72, -0.32), 5, 0.45, rng);
    }
    // бэк-бар поперёк зала за колонной: низкий шкаф (к залу — тёмное дерево), высокая полка с бутылками,
    // холодильник в углу у левой стены (рядом — проход в туалет), служебная дверь на кухню в левой стене
    {
      const bz0 = B.back, bz1 = back, bx0 = xr, bx1 = W - 0.02, bc = (bx0 + bx1) / 2;
      k.box('solid', null, bx1 - bx0, 1.05, bz1 - bz0, bc, 0.525, (bz0 + bz1) / 2, 0x121112);
      k.box('solid', null, bx1 - bx0 + 0.04, 0.04, bz1 - bz0 + 0.04, bc, 1.07, (bz0 + bz1) / 2, 0x2a1a10);
      const n = Math.round((bx1 - bx0) / 0.6);
      for (let i = 0; i < n; i++) k.box('solid', null, (bx1 - bx0) / n - 0.03, 0.85, 0.02, bx0 + (i + 0.5) * (bx1 - bx0) / n, 0.5, bz1 + 0.01, i % 2 ? 0x4a2c1a : 0x523220);
      const rx0 = 7.9, rx1 = 9.2;
      for (const x of [rx0, rx1]) k.box('solid', null, 0.05, 1.3, 0.3, x, 1.7, bz0 + 0.2, 0x2a180e);
      for (const y of [1.45, 1.9, 2.3]) { k.box('solid', null, rx1 - rx0, 0.03, 0.3, (rx0 + rx1) / 2, y, bz0 + 0.2, 0x2a180e); P.bottles(k, place((rx0 + rx1) / 2, y + 0.015, bz0 + 0.2), 8, rx1 - rx0 - 0.1, rng); }
      P.bottles(k, place(6.1, 1.09, bz0 + 0.18), 7, 1.0, rng);
      // холодильник со светом: в углу бэк-бара у левой стены, стекло — к стойке
      const fx = W - 0.33, fz = bz0 - 0.24;
      k.box('solid', null, 0.6, 1.85, 0.48, fx, 0.925, fz, 0x1a1a1c);
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 1.5), new THREE.MeshBasicMaterial({ map: TX.fridge(512) })); fr.position.set(fx, 0.95, fz - 0.245); fr.rotation.y = PI; this.root.add(fr); this.signMats.push(fr.material);
      this.halos.push([fx, 1.1, fz - 0.45, 0x60a8ff, 3]);
      // служебная дверь на кухню (за стойкой, в левой стене)
      const dz = (at(f1, -B.depth)[1] + 0.25 + fz - 0.24) / 2, dM = place(W - 0.02, 0, dz, -PI / 2);
      k.box('solid', dM, 0.82, 2.1, 0.04, 0, 1.05, 0.02, 0x2a1c14); k.box('solid', dM, 0.72, 2.0, 0.02, 0, 1.02, 0.045, 0x3e2a1c);
      k.box('glow', dM, 0.3, 0.4, 0.01, 0, 1.55, 0.058, 0xd8b890); k.box('shiny', dM, 0.1, 0.03, 0.04, -0.28, 1.0, 0.07, COL.chrome);
    }
  }
  buildDecor(rng) {
    // предметы на стенах: каждая стена — свой Kit (прячется целиком, когда камера за стеной)
    const tex = {};
    const posterMat = (key, seed) => { const id = key + (seed ?? ''); if (!tex[id]) { tex[id] = new THREE.MeshLambertMaterial({ map: key === 'gin' ? TX.ginTonic(512) : TX.sushiPoster(512, seed) }); } return tex[id]; };
    for (const it of DECOR.items) {
      const y = it.y, { M, w } = this.onWall(it.x, it.z, y, 0.02), g = w.group, k = g.kit;
      if (it.kind === 'lantern') { P.lantern(k, M); const p = new THREE.Vector3(0, 0, 0.12).applyMatrix4(M); this.halos.push([p.x, p.y, p.z, 0xffc070, 1]); }
      else if (it.kind === 'poster') {
        k.box('solid', M, it.w + 0.06, it.h + 0.06, 0.03, 0, 0, 0.015, 0x0e0e0e);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.h), posterMat(it.tex, it.seed % 3)); m.applyMatrix4(local(M, 0, 0, 0.032)); g.g.add(m);
      } else if (it.kind === 'gears') {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.w * 0.55), this.mat.gears); m.applyMatrix4(local(M, 0, 0, 0.03)); g.g.add(m);
      } else if (it.kind === 'pipes') {
        for (const b of P.pipeLamp(k, M, rng)) { const p = new THREE.Vector3(...b).applyMatrix4(M); this.halos.push([p.x, p.y, p.z, 0xffb050, 0]); }
      } else if (it.kind === 'vip') {
        k.box('solid', M, 0.3, 0.4, 0.03, 0, 0, 0.015, 0x101010); k.box('glow', M, 0.2, 0.05, 0.005, 0, 0.1, 0.035, 0xe8d8a8);      } else if (it.kind === 'wc') {
        // дверь туалета в конце коридорчика: тёмное дерево, ручка, табличка WC
        k.box('solid', M, 0.86, 2.12, 0.04, 0, 1.06 - y, 0.02, 0x241812); k.box('solid', M, 0.76, 2.02, 0.02, 0, 1.03 - y, 0.045, 0x4a2e1c);
        k.box('shiny', M, 0.1, 0.03, 0.05, 0.28, 1.0 - y, 0.07, COL.chrome);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), this.wcMat()); m.applyMatrix4(local(M, 0, 0, 0.06)); g.g.add(m);
      }
    }
    for (const w of this.wallG) w.kit.build(this.mat, w.g);
    // проём коридорчика в туалет: перемычка под потолком, на ней светящаяся табличка WC со стрелкой — видна из зала
    if (WC) {
      const lk = new Kit(), [x0, z0, , z1] = WC.rect, zc = (z0 + z1) / 2;
      lk.box('solid', null, 0.14, H - 2.3, z1 - z0, x0, (H + 2.3) / 2, zc, 0x1a1414);
      lk.build(this.mat, this.root);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), this.wcMat(true)); m.position.set(x0 - 0.075, 2.5, zc); m.rotation.y = -Math.PI / 2; this.root.add(m);
      this.halos.push([x0 - 0.2, 2.5, zc, 0xfff0d0, 1]);
    }
  }
  wcMat(wide = false) {
    const key = wide ? 'wcW' : 'wc';
    if (!this[key]) { this[key] = new THREE.MeshBasicMaterial({ map: TX.wcSign(256, wide) }); this.signMats.push(this[key]); }
    return this[key];
  }
  // ореолы ламп: одна точка = одна «вспышка» с аддитивным смешением (размеры: 0 мелкий, 1 средний, 2 фонарь, 3 широкое свечение)
  buildHalos() {
    const SZ = [0.35, 0.8, 1.6, 1.6], groups = [[], [], [], []];
    for (const h of this.halos) groups[h[4]].push(h);
    this.haloPts = [];
    groups.forEach((list, i) => {
      if (!list.length) return;
      const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3), c = new THREE.Color();
      list.forEach((h, j) => { pos.set([h[0], h[1], h[2]], j * 3); c.set(h[3]); col.set([c.r, c.g, c.b], j * 3); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: SZ[i], map: this.T.halo, vertexColors: true, transparent: true, opacity: i === 3 ? 0.28 : 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const p = new THREE.Points(g, m); p.renderOrder = 5; this.root.add(p); this.haloPts.push(p);
    });
  }
  // мягкие тени под мебелью: один InstancedMesh плоских пятен
  buildBlobs() {
    const n = this.blobs.length, g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ map: this.T.blob, transparent: true, depthWrite: false, opacity: 0.8 }), n);
    const M = new THREE.Matrix4();
    this.blobs.forEach(([x, z, a, b, r], i) => { M.compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r, 0)), new THREE.Vector3(a, 1, b)); m.setMatrixAt(i, M); });
    m.renderOrder = 1; this.root.add(m);
  }
  buildLights() {
    const sc = this.scene;
    this.hemi = new THREE.HemisphereLight(0xffd2a8, 0x3a2028, 2.2); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xff9a50, 0); this.sun.position.set(6, 3.5, -14); this.sun.target.position.set(4, 0, 6); sc.add(this.sun, this.sun.target);
    const pl = (c, i, d, x, y, z) => { const l = new THREE.PointLight(c, i, d, 1.4); l.position.set(x, y, z); l.base = i; sc.add(l); return l; };
    this.pts = [
      pl(0xffa850, 16, 11, 2.2, 2.7, 7.6),      // янтарь над длинным столом
      pl(0xffc040, 9, 5.5, 6.6, 0.9, 3.9),      // отсвет оникса на стулья и лица у бара
      pl(0xff3050, 12, 7, 8.0, 2.3, 11.0),      // красный у шестерёнок и диванчиков
      pl(0x5060ff, 10, 7, 5.3, 2.9, 1.3),       // синий у колонны-камина и витрины
    ];
  }
  buildFx(rng) {
    const q = this.quality, fxN = n => Math.round(n * (q.fx || 1));
    this.fxG = {};
    // гирлянда: тёплые огоньки по верху витрины, по стойкам рам и по колонне; две половины мигают по очереди
    {
      const pts = [[], []];
      const line = (x0, y0, z0, x1, y1, z1, step = 0.12, sag = 0) => { const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / step)); for (let i = 0; i <= n; i++) { const t = i / n; pts[i % 2].push([lerp(x0, x1, t), lerp(y0, y1, t) - Math.sin(t * Math.PI * Math.max(1, n / 12)) ** 2 * sag, lerp(z0, z1, t)]); } };
      for (const w of LAYOUT.walls) if (w.kind === 'glass') { line(w.a[0], 2.7, 0.1, w.b[0], 2.7, 0.1, 0.1, 0.12); const len = Math.abs(w.b[0] - w.a[0]), x0 = Math.min(w.a[0], w.b[0]), n = Math.max(1, Math.round(len / 1.9)); for (let i = 0; i <= n; i++) line(x0 + len * i / n, 0.3, 0.1, x0 + len * i / n, 2.7, 0.1, 0.1); }
      const pw = this.pillarWall; if (pw) line(pw.a[0], 1.5, 0.58, pw.b[0], 1.5, 0.58, 0.07);
      // по кромке стойки вдоль всей дуги
      for (let i = 0; i < 16; i++) { const a = BAR.at(-Math.PI / 2 + (BAR.phiL + Math.PI / 2) * i / 16, 0.06), b = BAR.at(-Math.PI / 2 + (BAR.phiL + Math.PI / 2) * (i + 1) / 16, 0.06); line(a[0], 1.12, a[1], b[0], 1.12, b[1], 0.1); }
      this.garland = pts.map((list, i) => {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.flat()), 3));
        const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: this.T.halo, color: i ? 0xffe0a0 : 0xfff2c8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        p.visible = false; p.renderOrder = 6; this.root.add(p); return p;
      });
    }
    // дождь: капли-чёрточки над улицей и верандой за маркизой
    {
      const n = fxN(1400), pos = new Float32Array(n * 6);
      this.rain = { n, pos, v: new Float32Array(n) };
      for (let i = 0; i < n; i++) { const x = rng.range(-6, 16), y = rng.range(0, 8), z = rng.range(-14, -3.5); pos.set([x, y, z, x + 0.02, y + 0.35, z], i * 6); this.rain.v[i] = rng.range(8, 11); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9ab0c8, transparent: true, opacity: 0.45 }));
      this.rain.mesh.visible = false; this.rain.mesh.frustumCulled = false; this.root.add(this.rain.mesh);
    }
    // шарики на день рождения: красные и белые у конца длинного стола и у диванчиков
    {
      const k = new Kit(), g = new THREE.Group(); this.balloons = [];
      for (const [bx, bz, n] of [[0.6, D - 1.2, 7], [W - 0.5, 12.8, 6], [W - 0.4, 2.2, 4]]) {
        for (let i = 0; i < n; i++) {
          const x = bx + rng.range(-0.3, 0.3), z = bz + rng.range(-0.3, 0.3), y = rng.range(1.9, 2.6), c = i % 3 === 2 ? 0xf4f4f4 : 0xd21f2a;
          const bg = new THREE.Group(); bg.position.set(x, 0, z); g.add(bg); this.balloons.push([bg, rng.next() * 6]);
          const bk = new Kit(); bk.sph('shiny', null, 0.16, 0, y, 0, c, 0.95, 1.15, 0.95, 10); bk.box('solid', null, 0.004, y - 0.9, 0.004, 0, (y + 0.9) / 2 - 0.1, 0, 0xdddddd); bk.build(this.mat, bg);
        }
      }
      g.visible = false; this.root.add(g); this.fxG.birthday = g;
    }
    // саксофон и караоке — на сцене у левой стены (LAYOUT.stage): луч(и) сверху, светлое пятно под ногами, ореол, ноты
    // где стоит музыкант — из EVENTS (effect.stage): одно место на симуляцию, сцену и сборку; y — высота подиума
    const EV = L.use('content/events').EVENTS, at = id => { const st = EV.find(e => e.scene === id)?.effect?.stage || STG; return [st.x, st.z, { y: st.y ?? STG.h, face: st.face ?? STG.face }]; };
    this.stages = {};
    { const [x, z, o] = at('sax'); this.stages.sax = this.buildStage(x, z, [0xff5aa8], { ...o, note: 0xffd0f0 }); }
    this.saxAt = this.stages.sax.at; this.notes = this.stages.sax.notes; this.fxG.sax = this.stages.sax.g;
    // караоке: розово-синие лучи, ноты, неоновая табличка «КАРАОКЕ» над сценой
    { const [x, z, o] = at('karaoke'); this.stages.karaoke = this.buildStage(x, z, [0xff4fa3, 0x4a6aff], { ...o, note: 0xbfd0ff, sign: 'КАРАОКЕ' }); }
    this.karaokeAt = this.stages.karaoke.at; this.fxG.karaoke = this.stages.karaoke.g;
    // запах: зеленовато-жёлтая дымка ползёт от розового уголка (диванчики у левой стены в глубине)
    {
      const n = fxN(60), pos = new Float32Array(n * 3); this.smell = { n, pos, ph: new Float32Array(n) };
      for (let i = 0; i < n; i++) this.smell.ph[i] = rng.next();
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.smell.mesh = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, map: this.T.halo, color: 0xb8c840, transparent: true, opacity: 0.35, depthWrite: false }));
      this.smell.mesh.visible = false; this.smell.mesh.frustumCulled = false; this.root.add(this.smell.mesh);
    }
    // стробоскоп: цветные пятна бегают по полу
    {
      const g = new THREE.Group(); this.strobeSpots = [];
      for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), new THREE.MeshBasicMaterial({ map: this.T.halo, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; g.add(m); this.strobeSpots.push(m); }
      g.visible = false; this.root.add(g); this.fxG.strobe = g;
    }
    // маршрутка по улице
    {
      const g = new THREE.Group(), k = new Kit(); P.minibus(k, null); k.build(this.mat, g);
      g.position.set(-40, -0.12, -7.6); this.root.add(g); this.bus = { g, t: 6 };
    }
  }
  // сцена для музыканта: луч(и) сверху — яркие у потолка и гаснущие к полу (фигура не тонет в цвете),
  // светлое пятно под ногами (тёмный силуэт на светлом), ореол-контровой за спиной (двигается от камеры), ноты
  buildStage(x, z, cols, o = {}) {
    const y = o.y || 0, g = new THREE.Group(), add = THREE.AdditiveBlending, st = { at: [x, z, y, o.face ?? 0], y, g, beams: [], cols };
    if (!this.beamTex) {
      const c = document.createElement('canvas'); c.width = 4; c.height = 64;
      const cx = c.getContext('2d'), gr = cx.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(90,90,90,1)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 4, 64); this.beamTex = new THREE.CanvasTexture(c); this.beamTex.colorSpace = THREE.SRGBColorSpace;
    }
    cols.forEach((col, i) => {
      const dx = cols.length > 1 ? (i ? 0.35 : -0.35) : 0;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.8, H - 0.1 - y, 20, 1, true), new THREE.MeshBasicMaterial({ color: col, map: this.beamTex, transparent: true, opacity: 0.22, blending: add, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(x + dx, y + (H - 0.1 - y) / 2, z); m.rotation.z = -dx * 0.35; m.renderOrder = 5; g.add(m); st.beams.push(m);
    });
    const disk = (r, col, op, yy) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: col, map: this.T.halo, transparent: true, opacity: op, blending: add, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, yy, z); g.add(m); return m; };
    st.pool = disk(1.0, cols[0], 0.7, y + 0.02);
    st.core = disk(0.55, 0xfff0e0, 0.85, y + 0.025);
    // ореол-контровой: светится вокруг фигуры (всегда чуть дальше от камеры, чем человек)
    st.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.halo, color: cols[0], transparent: true, opacity: 0.75, blending: add, depthWrite: false }));
    st.aura.scale.set(1.9, 2.5, 1); st.aura.position.set(x, y + 1.0, z); g.add(st.aura);
    const n = 10, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) pos.set([x, y + 1.5, z], i * 3);
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    st.notes = new THREE.Points(ng, new THREE.PointsMaterial({ size: 0.3, map: this.T.note, color: o.note || 0xffffff, transparent: true, depthWrite: false }));
    st.notes.frustumCulled = false; g.add(st.notes);
    if (o.sign) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 80;
      const cx = c.getContext('2d');
      cx.strokeStyle = '#ff5ab4'; cx.lineWidth = 5; cx.shadowColor = '#ff4fa3'; cx.shadowBlur = 12;
      cx.beginPath(); cx.roundRect ? cx.roundRect(8, 8, 240, 64, 16) : cx.rect(8, 8, 240, 64); cx.stroke();
      cx.font = 'bold 38px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.shadowColor = '#5a7aff'; cx.fillStyle = '#e8f0ff'; cx.fillText('♪ ' + o.sign + ' ♪', 128, 42);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      st.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      st.sign.scale.set(1.7, 0.54, 1); st.sign.position.set(x + 0.2, 2.75, z - 0.1); st.sign.renderOrder = 8; g.add(st.sign);
    }
    g.visible = false; this.root.add(g);
    return st;
  }
  // кадр сцены музыканта: ноты вверх, ореол за фигурой, у двух цветов — лучи и пятно переливаются
  animStage(st, t) {
    const a = st.notes.geometry.attributes.position, [x, z, y] = st.at;
    for (let i = 0; i < a.count; i++) { const f = (t * 0.25 + i / a.count) % 1; a.setXYZ(i, x - 0.3 + Math.sin(f * 9 + i) * 0.45, y + 1.4 + f * 1.5, z + Math.cos(f * 7 + i) * 0.35); }
    a.needsUpdate = true;
    const cp = this.camera.position, dx = x - cp.x, dz = z - cp.z, dy = y + 1.0 - cp.y, d = Math.hypot(dx, dy, dz) || 1;
    st.aura.position.set(x + dx / d * 0.45, y + 1.0 + dy / d * 0.45, z + dz / d * 0.45);
    if (st.cols.length > 1) {
      const k = 0.5 + 0.5 * Math.sin(t * 2.4);
      st.beams[0].material.opacity = 0.16 + 0.26 * k; st.beams[1].material.opacity = 0.16 + 0.26 * (1 - k);
      (this.stageC || (this.stageC = new THREE.Color())).setHex(st.cols[0]).lerp(this.stageC2 || (this.stageC2 = new THREE.Color(st.cols[1])), 1 - k);
      st.pool.material.color.copy(this.stageC); st.aura.material.color.copy(this.stageC);
      if (st.sign) st.sign.material.opacity = 0.85 + 0.15 * Math.sin(t * 7);
    }
  }
  buildPick() {
    // невидимые «кубы» мест (не в сцене: лучу сцена не нужна, только матрицы)
    const g = new THREE.BoxGeometry(0.55, 0.9, 0.55), m = new THREE.MeshBasicMaterial();
    this.seatBoxes = [];
    for (const t of LAYOUT.tables) for (const s of t.seats) {
      const b = new THREE.Mesh(g, m); b.position.set(s.x, 0.45, s.z); b.userData.seatId = s.id; b.updateMatrixWorld(true); this.seatBoxes.push(b);
    }
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.v3 = new THREE.Vector3();
  }

  // ═══════════ качество ═══════════
  applyQuality() {
    const q = this.quality;
    this.pts.forEach((l, i) => { l.visible = i < q.lights; });
    // на низком — один огонь: компенсируем цветом полусферы (янтарь сильнее)
    this.hemiBoost = q.lights < 2 ? 1.25 : 1;
    this.fineG.visible = q.fine;
    this.haloPts.forEach(p => { p.visible = q.halo; });
    if (this.hourSet !== undefined) this.setHour(this.hour, true);
    this.resize();
  }

  // ═══════════ время и эффекты ═══════════
  setHour(h, force = false) {
    h = clamp(h, 18.5, 25.5);
    if (!force && this.hourSet !== undefined && Math.abs(h - this.hourSet) < 0.004) { this.hour = h; return; }   // зовут каждый кадр — пересчёт раз в ~15 игровых секунд
    this.hour = this.hourSet = h;
    const sun = 1 - smooth(19.0, 20.5, h), night = smooth(19.5, 21.5, h), late = smooth(23, 25, h);
    // небо за витриной: закат → синие сумерки → ночь
    const sky = this.sky || (this.sky = new THREE.Color()), C1 = SKY[0], C2 = SKY[1], C3 = SKY[2];
    if (h < 19.8) sky.lerpColors(C1, C2, smooth(19, 19.8, h)); else sky.lerpColors(C2, C3, smooth(19.8, 21.3, h));
    if (this.fx.rain) sky.multiplyScalar(0.6);
    this.scene.background = sky; if (!this.scene.fog) this.scene.fog = new THREE.Fog(sky, 35, 90); this.scene.fog.color.copy(sky);
    this.sun.intensity = sun * 1.4;
    this.hemi.intensity = (1.6 + sun * 0.8) * (this.hemiBoost || 1);
    this.hemi.color.setHex(0xffd2a8).lerp(this.lateC || (this.lateC = new THREE.Color(0xffb0a0)), late * 0.4);
    // улица темнеет, окна домов и фонари загораются
    const outK = lerp(1, 0.22, night) * (this.fx.rain ? 0.7 : 1);
    for (const m of this.outMats) m.color.setScalar(outK);
    const win = smooth(19.6, 21, h);
    for (const m of [this.upMat, this.farMat, ...(this.sideMats || [])]) if (m) m.emissiveIntensity = win * 0.9;
    // неон и вывески ярче к ночи; лампы — ровно; поздно — чуть краснее и темнее
    for (const m of this.signMats) m.color.setScalar(0.75 + 0.35 * night);
    this.pts[0].intensity = this.pts[0].base * (1 - late * 0.25); this.pts[2].intensity = this.pts[2].base * (1 + late * 0.4);
    this.wallK = 1 - late * 0.12;
    this.applyTint();
  }
  applyTint() {
    const s = this.strobeK || 0, c = this.strobeC || new THREE.Color(1, 1, 1);
    for (const m of this.wallMats) { m.color.setScalar(this.wallK ?? 1); if (s) m.color.lerp(c, s * 0.6); }
  }
  setEffect(id, on) {
    on = !!on; this.fx[id] = on;
    if (id === 'garland') this.garland.forEach(p => { p.visible = on; });
    else if (id === 'rain') { this.rain.mesh.visible = on; this.setHour(this.hour, true); }
    else if (id === 'football') { this.screen.mode = on ? 'football' : this.tvMode(); }
    else if (id === 'smell') this.smell.mesh.visible = on;
    else if (this.fxG[id]) this.fxG[id].visible = on;
    if (id === 'strobe' && !on) { this.strobeK = 0; this.setHour(this.hour, true); }
  }
  tvMode() { return this.hour < 20.5 ? 'fish' : 'fire'; }

  // ═══════════ камера ═══════════
  focus(p) { this.ctl.focus(p); }
  follow(p) { this.ctl.follow(p); }
  // отладочные ракурсы: { pos, look, fov } | null
  view(v) { this.ctl.free(v); }

  // ═══════════ выбор мышью ═══════════
  pick(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    // люди: любые объекты с userData.personId (их добавляет render/people)
    const ppl = [];
    this.scene.traverseVisible(o => { if (o.userData && o.userData.personId !== undefined) ppl.push(o); });
    if (ppl.length) {
      const hit = this.ray.intersectObjects(ppl, true)[0];
      if (hit) { let o = hit.object; while (o && o.userData.personId === undefined) o = o.parent; if (o) return { kind: 'person', id: o.userData.personId }; }
    }
    const s = this.ray.intersectObjects(this.seatBoxes, false)[0];
    if (s) return { kind: 'seat', id: s.object.userData.seatId };
    const ray = this.ray.ray;
    if (ray.direction.y < -1e-4) {
      const t = -ray.origin.y / ray.direction.y, x = ray.origin.x + ray.direction.x * t, z = ray.origin.z + ray.direction.z * t;
      const inHall = inPoly(x, z, this.poly);
      if (inHall || (LAYOUT.zoneAt(x, z) && z < 0)) return { kind: 'floor', x, z };
    }
    return null;
  }
  toScreen(x, y, z) {
    const v = this.v3.set(x, y, z).project(this.camera), r = this.canvas.getBoundingClientRect();
    const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
    return { x: sx, y: sy, visible: v.z > -1 && v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1 };
  }

  // ═══════════ кадр ═══════════
  resize() {
    const c = this.canvas, w = c.clientWidth || (typeof innerWidth !== 'undefined' ? innerWidth : 800), h = c.clientHeight || (typeof innerHeight !== 'undefined' ? innerHeight : 600);
    const dpr = Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, this.quality.dpr) * (this.quality.rs || 1);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  cutaway() {
    const p = this.camera.position;
    this.ceilG.visible = p.y < H - 0.05;
    this.cutG.visible = p.y < H + 0.4 || p.z > 0.5;
    for (const w of this.wallG) w.g.visible = (p.x - w.mid[0]) * w.n[0] + (p.z - w.mid[1]) * w.n[1] > -0.05;
  }
  animate(dt) {
    const t = this.t, fx = this.fx;
    // экраны: ~12 кадров/с
    this.screenT += dt;
    if (this.screenT > 0.08) { this.screenT = 0; if (!fx.football) this.screen.mode = this.tvMode(); this.screen.draw(t); this.fire.draw(t * 1.3); }
    if (fx.garland) { const a = 0.5 + 0.5 * Math.sin(t * 2.2); this.garland[0].material.opacity = 0.35 + 0.65 * a; this.garland[1].material.opacity = 1 - 0.65 * a; }
    if (fx.rain) {
      const { n, pos, v } = this.rain;
      for (let i = 0; i < n; i++) { const j = i * 6; let y = pos[j + 1] - v[i] * dt; if (y < 0) y += 8; pos[j + 1] = y; pos[j + 4] = y + 0.35; }
      this.rain.mesh.geometry.attributes.position.needsUpdate = true;
    }
    if (fx.birthday) for (const [g, ph] of this.balloons) { g.rotation.z = Math.sin(t * 0.9 + ph) * 0.05; g.rotation.x = Math.cos(t * 0.7 + ph) * 0.05; }
    if (fx.sax) this.animStage(this.stages.sax, t);
    if (fx.karaoke) this.animStage(this.stages.karaoke, t);
    if (fx.smell) {
      const { n, pos, ph } = this.smell;
      for (let i = 0; i < n; i++) { const f = (t * 0.06 + ph[i]) % 1, a = ph[i] * 40; pos[i * 3] = 8.6 + Math.sin(a) * (0.4 + f * 1.4); pos[i * 3 + 1] = 0.3 + f * 2.2; pos[i * 3 + 2] = 11.1 + Math.cos(a) * (0.6 + f * 1.8); }
      this.smell.mesh.geometry.attributes.position.needsUpdate = true;
    }
    if (fx.strobe) {
      const beat = (t * 2.5) % 1, hue = (t * 0.35) % 1;
      (this.strobeC || (this.strobeC = new THREE.Color())).setHSL(hue, 1, 0.55); this.strobeK = beat < 0.15 ? 0.9 : 0.25;
      this.applyTint(); this.hemi.color.setHSL(hue, 0.8, 0.6 + (beat < 0.15 ? 0.3 : 0));
      this.strobeSpots.forEach((m, i) => { const a = t * (0.8 + i * 0.13) + i * 2; m.position.x = 4.5 + Math.sin(a) * 3.5; m.position.z = D / 2 + Math.cos(a * 0.7) * (D / 2 - 1); m.material.color.setHSL((hue + i / 6) % 1, 1, 0.5); });
    }
    // маршрутка раз в полминуты
    const b = this.bus; b.t -= dt;
    if (b.t <= 0) { b.g.position.x += dt * 9; if (b.g.position.x > 45) { b.g.position.x = -40; b.t = 20 + this.rng.next() * 25; } }
  }
  render(dt = 1 / 60) {
    const t0 = performance.now();
    dt = Math.min(0.1, Math.max(0, dt)); this.t += dt;
    this.ctl.update(dt);
    this.camera.updateMatrixWorld();
    this.cutaway();
    this.animate(dt);
    this.quality.sample(dt);
    this.renderer.render(this.scene, this.camera);
    this.ms = (this.ms || 0) * 0.95 + (performance.now() - t0) * 0.05;   // время кадра на CPU (для замеров)
  }
}

return { Scene, DECOR };
});
