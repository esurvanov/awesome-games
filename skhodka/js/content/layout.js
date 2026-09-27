// ═══ ПЛАН ЗАЛА SushiGO ═══
// Единый источник геометрии для отрисовки (render/scene) и для ходьбы/рассадки людей (sim/nav, sim/brain).
// Отрисовка строит мебель ИЗ ЭТИХ ДАННЫХ; симуляция знает только их. Хозяин чисел — сцена (сверка с фото
// в _ref/ и с пометками автора в _ref/notes/), схема и id зон — договор (docs/plan.md), их не переименовывать.
//
// Координаты: метры, Y вверх, Z — вглубь (0 = стеклянный фасад, Z<0 — веранда и улица). X — поперёк зала,
// оси правые, как в three.js: если стоять на улице лицом к витрине (взгляд в +Z), то +X уходит ВЛЕВО —
// x=0 справа (длинная стена с диваном), x=10 слева (бар, сцена, туалет). face — куда смотрит сидящий (0 = +Z, π/2 = +X).
//
// Как план восстановлен (дальше «слева/справа» — стоя на улице лицом к витрине):
// · Зал — простой прямоугольник 10 × 13.5 м (автор: «помещение прямоугольное»). Кухня — за левой стеной,
//   в зал из неё ведёт служебная дверь за стойкой. Единственный выступ контура — коридорчик в туалет.
// · Фасад — стекло во всю ширину, в нём белая кирпичная колонна с электрокамином (x≈4.9–5.7); справа от неё
//   вход. Снаружи — веранда под чёрной маркизой, серые кресла, туи в кадках, фонарь, улица с маршрутками.
// · Бар — у левой стены, стойка ДУГОЙ (автор: «барная стойка круглая»): полуэллипс выпуклостью в зал и к
//   витрине, светящийся жёлтый оникс по всему фасаду дуги, чёрная столешница, барные стулья по дуге лицом к
//   центру. Внутри дуги — кирпичная колонна с дозаторами и кранами, на ней ТВ (на вход, в зал, вглубь).
//   Правый конец дуги смотрит в зал: там кофемашина, изогнутый чёрный SUS||GO, Будда, красный фонарь
//   (фото 01-57-29 / 01-58-13 / 01-57-02 / 01-57-10: оникс, чёрная рама, ТВ над колонной за стойкой).
//   За колонной — низкий бэк-бар поперёк зала (бутылки, холодильник у левой стены).
// · Сцена — низкий деревянный подиум вдоль левой стены между витриной и стойкой, рядом с барными стульями
//   (автор: «где-то тут небольшая сцена»; фото 01-59-08, 01-58-45: колонка на треноге, саксофон у колонны).
// · Туалет — в углу у холодильника за баром (автор): проём в левой стене сразу за бэк-баром, коридорчик,
//   дверь с табличкой WC. К нему ведёт узкий проход между бэк-баром и розовыми диванчиками.
// · Между сценой и стеклом — «карман» с круглыми деревянными столиками и серыми велюровыми креслами.
// · Правая длинная стена (x=0) — кирпич в янтарной подсветке, по всей длине оливковый стёганый диван,
//   у стекла чёрные мраморные столы и велюровые кресла, дальше в глубину — сдвинутые деревянные столы
//   «длинного стола».
// · Левая стена в глубине (x=10) — шестерёнки в красно-синей подсветке, трубы-лампы, розовые стёганые
//   диванчики под красным светом. Между ними и длинным столом — ещё два ряда мраморных столов с креслами.
// · Дальняя стена (z=13.5) — алоказия в красном свете в углу, постер GIN TONIC, фонарь; перед ней — место
//   для общего фото.
// · Тесно (автор: «мест для прохода мало»): проходы между спинками кресел ~0.6–0.8 м, свободного пола почти нет.
//
// LAYOUT = {
//   size     { w, d, h }                         — габарит прямоугольного зала
//   zones[]  { id, title, icon, rect:[x0,z0,x1,z1] }
//            id ∈ street | veranda | entrance | bar | round | long | booth | back
//   walls[]  { a:[x,z], b:[x,z], kind:'brick'|'glass'|'door' }   — замкнутый контур (для ходьбы — непроходимо, кроме door)
//   hall     [[x,z]…]                            — тот же контур многоугольником (пол, потолок, «внутри зала»)
//   blocks[] { id, rect:[x0,z0,x1,z1], kind, poly? }  — непроходимые препятствия (стойка, колонна, диван, кадки, сцена);
//            poly — точный многоугольник (ходьба берёт его, rect — его габарит)
//   tables[] { id, zone, shape:'rect'|'round', x, z, w, d, top:'marble'|'wood'|'round'|'terrace'|'bar', joinable,
//              seats:[{ id, x, z, face, kind:'sofa'|'armchair'|'chair'|'stool' }] }
//            top:'bar' — барная стойка как «стол» (места — барные стулья по дуге; сама дуга — LAYOUT.bar)
//   stands[] { id, zone, x, z, face, kind:'bar'|'smoke'|'door'|'wall'|'stage'|'wc' }   — места, где стоят
//            'wc' — у двери туалета (туда отлучаются ненадолго, своим местом не выбирают)
//   bar      { cx, cz, a, b, depth, back, phiL }  — дуга стойки: фасад x = cx + a·sinφ, z = cz − b·cosφ,
//            φ ∈ [−π/2, phiL] (правый конец → левая стена), depth — глубина стойки, back — z бэк-бара
//   stage    { rect, h, x, z, face }              — подиум (высота h) и точка музыканта на нём
//   wc       { x, z, door:{x,z0,z1} }             — куда подходят (у двери), проём коридора в левой стене
//   door     { x, z }  spawn { x, z }  photo { x, z, face }  — вход, откуда приходят, где снимают общее фото
// }
'use strict';
L.def('content/layout', () => {

const W = 10, D = 13.5, H = 3.4;
const PI = Math.PI;

// стол с местами по периметру: side — какие стороны заняты ('L' — со стороны меньших x, 'R' — больших, 'F' — к фасаду, 'B' — вглубь)
function rectTable(id, zone, x, z, w, d, top, sides, kinds = {}) {
  const seats = []; let n = 0;
  const put = (sx, sz, face, kind) => seats.push({ id: `${id}.${n++}`, x: +sx.toFixed(2), z: +sz.toFixed(2), face, kind });
  const alongZ = Math.max(1, Math.round(d / 0.7)), alongX = Math.max(1, Math.round(w / 0.7));
  for (const s of sides) {
    const k = kinds[s] || 'armchair';
    if (s === 'L') for (let i = 0; i < alongZ; i++) put(x - w / 2 - 0.45, z - d / 2 + (i + 0.5) * d / alongZ, PI / 2, k);
    if (s === 'R') for (let i = 0; i < alongZ; i++) put(x + w / 2 + 0.45, z - d / 2 + (i + 0.5) * d / alongZ, -PI / 2, k);
    if (s === 'F') for (let i = 0; i < alongX; i++) put(x - w / 2 + (i + 0.5) * w / alongX, z - d / 2 - 0.45, 0, k);
    if (s === 'B') for (let i = 0; i < alongX; i++) put(x - w / 2 + (i + 0.5) * w / alongX, z + d / 2 + 0.45, PI, k);
  }
  return { id, zone, shape: 'rect', x, z, w, d, top, joinable: true, seats };
}
// круглый стол: n мест по кругу, a0 — угол первого места (0 = +Z), чтобы кресла не упирались в стену/соседей
function roundTable(id, zone, x, z, r, n, top = 'round', kind = 'armchair', a0 = PI / 4) {
  const seats = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + a0;
    const sx = x + Math.sin(a) * (r + 0.5), sz = z + Math.cos(a) * (r + 0.5);
    seats.push({ id: `${id}.${i}`, x: +sx.toFixed(2), z: +sz.toFixed(2), face: +(a + PI).toFixed(3), kind });
  }
  return { id, zone, shape: 'round', x, z, w: r * 2, d: r * 2, top, joinable: false, seats };
}

// ── барная стойка дугой ──
// фасад — полуэллипс с центром (cx, cz), полуоси a (поперёк) и b (вглубь); правый конец (φ = −π/2) —
// прямой короткий «рукав» до бэк-бара, левый упирается в стену x = W.
const BAR = { cx: 7.5, cz: 6.9, a: 2.7, b: 2.2, depth: 0.6, back: 7.9, backD: 0.45 };
BAR.phiL = Math.asin(Math.min(1, (W - BAR.cx) / BAR.a));
const arcPt = (phi, off = 0) => [BAR.cx + (BAR.a + off) * Math.sin(phi), BAR.cz - (BAR.b + off) * Math.cos(phi)];
BAR.at = arcPt;
function barCounter() {
  // стулья по дуге, лицом к центру дуги; шаг ~0.62 м по фасаду
  const seats = [], off = 0.42, phis = [];
  for (let phi = -1.42; phi <= BAR.phiL - 0.5; phi += 0.235) phis.push(phi);
  phis.forEach((phi, i) => {
    const [x, z] = arcPt(phi, off);
    seats.push({ id: `bar.${i}`, x: +x.toFixed(2), z: +z.toFixed(2), face: +Math.atan2(BAR.cx - x, BAR.cz - z).toFixed(3), kind: 'stool' });
  });
  // «стол» стойки для ходьбы — внутри служебной зоны (сама дуга — блоки bar-arc*, bar-staff)
  return { id: 'bar', zone: 'bar', shape: 'rect', x: 8.4, z: 7.3, w: 0.2, d: 0.2, top: 'bar', joinable: false, seats };
}
// блоки стойки: служебная зона целиком (многоугольник: фасад дуги + стена + бэк-бар) и короткие
// прямоугольники по дуге (для камеры: не смотреть сквозь стойку)
function barBlocks() {
  const out = [], poly = [], back = BAR.back + BAR.backD;
  const [xr] = arcPt(-PI / 2);
  poly.push([xr, back]);
  const N = 28;
  for (let i = 0; i <= N; i++) poly.push(arcPt(-PI / 2 + (BAR.phiL + PI / 2) * i / N));
  poly.push([W, back]);
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  out.push({ id: 'bar-staff', rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], kind: 'staff', poly: poly.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]) });
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const p0 = -PI / 2 + (BAR.phiL + PI / 2) * i / segs, p1 = -PI / 2 + (BAR.phiL + PI / 2) * (i + 1) / segs;
    const pts = [arcPt(p0), arcPt(p1), arcPt(p0, -BAR.depth), arcPt(p1, -BAR.depth)];
    const r = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    out.push({ id: `bar-arc${i}`, rect: r.map(v => +v.toFixed(3)), kind: 'counter' });
  }
  out.push({ id: 'bar-arm', rect: [xr, BAR.cz, xr + BAR.depth, BAR.back], kind: 'counter' });
  out.push({ id: 'bar-back', rect: [xr, BAR.back, W, back], kind: 'backbar' });
  out.push({ id: 'bar-column', rect: [7.05, 6.75, 7.95, 7.55], kind: 'column' });
  return out;
}

// сцена: низкий подиум у левой стены между карманом и стойкой
const STAGE = { rect: [8.85, 2.4, W, 4.15], h: 0.25, x: 9.4, z: 3.4, face: -PI / 2 };
// туалет: проём в левой стене сразу за бэк-баром, коридорчик до двери WC
const WC = { x0: W, x1: W + 1.3, z0: 8.55, z1: 9.45 };

const LAYOUT = {
  size: { w: W, d: D, h: H },
  zones: [
    { id: 'street',   title: 'Улица',          icon: 'street',   rect: [-1.5, -8.5, W + 1.5, -3.6] },
    { id: 'veranda',  title: 'Веранда',        icon: 'leaf',     rect: [0, -3.6, W, 0] },
    { id: 'entrance', title: 'Стол у входа',   icon: 'door',     rect: [0, 0, 5.0, 4.0] },
    { id: 'round',    title: 'Круглые столики',icon: 'circle',   rect: [5.0, 0, W, 4.0] },
    { id: 'bar',      title: 'Бар',            icon: 'beer',     rect: [2.6, 4.0, W, 8.4] },
    { id: 'long',     title: 'Длинный стол',   icon: 'sofa',     rect: [0, 4.0, 2.6, D] },
    { id: 'booth',    title: 'Розовый уголок', icon: 'heart',    rect: [5.5, 8.4, W, D] },
    { id: 'back',     title: 'Дальняя стена',  icon: 'plant',    rect: [2.6, 8.4, 5.5, D] },
  ],
  walls: [
    { a: [0, 0], b: [3.8, 0], kind: 'glass' },
    { a: [3.8, 0], b: [4.9, 0], kind: 'door' },
    { a: [4.9, 0], b: [5.7, 0], kind: 'brick' },      // колонна с камином
    { a: [5.7, 0], b: [W, 0], kind: 'glass' },
    { a: [W, 0], b: [W, WC.z0], kind: 'brick' },      // левая стена: сцена, бар (за ней кухня)
    { a: [W, WC.z0], b: [WC.x1, WC.z0], kind: 'brick' },   // коридорчик в туалет
    { a: [WC.x1, WC.z0], b: [WC.x1, WC.z1], kind: 'brick' },   // дверь WC (рисуется на стене)
    { a: [WC.x1, WC.z1], b: [W, WC.z1], kind: 'brick' },
    { a: [W, WC.z1], b: [W, D], kind: 'brick' },      // левая стена в глубине: шестерёнки, розовые диванчики
    { a: [W, D], b: [0, D], kind: 'brick' },          // дальняя стена
    { a: [0, D], b: [0, 0], kind: 'brick' },          // длинная стена с диваном
  ],
  blocks: [
    ...barBlocks(),
    { id: 'stage',       rect: STAGE.rect.slice(), kind: 'stage' },
    { id: 'speaker',     rect: [9.45, 2.5, 9.9, 2.95], kind: 'speaker' },   // колонка на сцене (караоке — кучка у неё)
    { id: 'pillar',      rect: [4.9, 0.0, 5.7, 0.55], kind: 'column' },
    { id: 'sofa-long',   rect: [0, 0.3, 0.55, D - 0.3], kind: 'sofa' },
    { id: 'sofa-pink',   rect: [W - 0.55, 9.75, W, 12.35], kind: 'sofa' },
    { id: 'plant-back',  rect: [W - 0.85, D - 0.85, W - 0.1, D - 0.1], kind: 'plant' },
    { id: 'thuja1',      rect: [9.3, -3.6, 9.9, -3.0], kind: 'plant' },
    { id: 'thuja2',      rect: [5.5, -3.6, 6.1, -3.0], kind: 'plant' },
    { id: 'thuja3',      rect: [0.1, -3.6, 0.7, -3.0], kind: 'plant' },
    { id: 'bush-door',   rect: [5.05, -0.6, 5.55, -0.1], kind: 'plant' },
    { id: 'lamp-post',   rect: [-0.5, -4.1, -0.2, -3.8], kind: 'column' },
  ],
  tables: [
    barCounter(),
    // у стекла: чёрный мрамор с белыми прожилками, диван по длинной стене + велюровые кресла
    rectTable('ent1', 'entrance', 1.05, 1.2, 0.65, 1.1, 'marble', ['R', 'L'], { L: 'sofa' }),
    rectTable('ent2', 'entrance', 1.05, 2.6, 0.65, 1.1, 'marble', ['R', 'L'], { L: 'sofa' }),
    rectTable('ent3', 'entrance', 3.3, 1.6, 0.7, 1.1, 'marble', ['R', 'L']),
    rectTable('ent4', 'entrance', 3.3, 3.25, 0.7, 1.1, 'marble', ['R', 'L']),
    // длинный стол вдоль дивана: сдвинутые деревянные столы с салфетками SushiGO
    ...[0, 1, 2, 3, 4, 5].map(i => rectTable(`long${i + 1}`, 'long', 1.15, +(5.0 + i * 1.3).toFixed(2), 0.8, 1.3, 'wood',
      i === 5 ? ['R', 'L', 'B'] : ['R', 'L'], { L: 'sofa' })),
    // круглые деревянные столики на чёрной ножке с серыми велюровыми креслами: карман у витрины и у сцены
    roundTable('rnd1', 'round', 8.95, 1.3, 0.35, 3, 'round', 'armchair', -PI / 2),
    roundTable('rnd2', 'round', 6.65, 1.3, 0.35, 3, 'round', 'armchair', -PI / 2),
    roundTable('rnd4', 'round', 6.3, 3.35, 0.3, 2, 'round', 'armchair', PI / 2),
    // вдоль прохода между длинным столом и стойкой — столики на двоих
    roundTable('rnd3', 'bar', 3.3, 5.35, 0.3, 2, 'round', 'armchair', 0),
    roundTable('rnd5', 'bar', 3.3, 7.55, 0.3, 2, 'round', 'armchair', 0),
    // ряды мраморных столов в глубине (между длинным столом и диванчиками)
    rectTable('mid1', 'back', 4.1, 9.7, 0.7, 1.1, 'marble', ['R', 'L']),
    rectTable('mid2', 'back', 4.1, 11.2, 0.7, 1.1, 'marble', ['R', 'L']),
    rectTable('mid3', 'booth', 6.95, 10.0, 0.7, 1.1, 'marble', ['L', 'R'], { R: 'chair' }),
    rectTable('mid4', 'booth', 6.95, 11.5, 0.7, 1.1, 'marble', ['L', 'R'], { R: 'chair' }),
    // у дальней стены — столик на двоих (место для общего фото — левее, у постера и фонаря)
    roundTable('rnd6', 'booth', 7.0, 13.0, 0.3, 2, 'round', 'armchair', PI / 2),
    // розовые стёганые диванчики под шестерёнками
    rectTable('booth1', 'booth', 8.85, 10.4, 0.6, 0.9, 'marble', ['R'], { R: 'sofa' }),
    rectTable('booth2', 'booth', 8.85, 11.75, 0.6, 0.9, 'marble', ['R'], { R: 'sofa' }),
    // веранда: серые кресла с овальной спинкой, маленькие столики
    roundTable('ver1', 'veranda', 8.4, -1.8, 0.3, 2, 'terrace', 'chair', -PI / 4),
    roundTable('ver2', 'veranda', 6.5, -2.3, 0.3, 2, 'terrace', 'chair', -PI / 2),
    roundTable('ver3', 'veranda', 2.9, -1.5, 0.3, 3, 'terrace', 'chair', -PI / 4),
    roundTable('ver4', 'veranda', 1.0, -2.6, 0.3, 2, 'terrace', 'chair', -PI / 2),
  ],
  stands: [
    { id: 'bar1', zone: 'bar', x: 5.1, z: 4.95, face: 2.4, kind: 'bar' },
    { id: 'bar2', zone: 'bar', x: 7.8, z: 3.9, face: PI, kind: 'bar' },
    { id: 'bar3', zone: 'bar', x: 4.3, z: 6.35, face: PI / 2, kind: 'bar' },
    { id: 'bar4', zone: 'bar', x: 6.2, z: 4.0, face: 0.46, kind: 'bar' },
    { id: 'stage1', zone: 'round', x: 8.2, z: 2.85, face: PI / 2, kind: 'stage' },
    { id: 'stage2', zone: 'round', x: 8.2, z: 3.75, face: PI / 2, kind: 'stage' },
    { id: 'door1', zone: 'entrance', x: 4.4, z: 0.7, face: PI, kind: 'door' },
    { id: 'smoke1', zone: 'street', x: 8.2, z: -4.2, face: 0, kind: 'smoke' },
    { id: 'smoke2', zone: 'street', x: 7.5, z: -4.5, face: PI / 2, kind: 'smoke' },
    { id: 'smoke3', zone: 'street', x: 1.2, z: -4.3, face: -PI / 2, kind: 'smoke' },
    { id: 'wall1', zone: 'booth', x: 8.2, z: 12.95, face: PI, kind: 'wall' },
    { id: 'wall2', zone: 'back', x: 3.6, z: 12.95, face: PI, kind: 'wall' },
    { id: 'wc1', zone: 'booth', x: W + 0.95, z: (WC.z0 + WC.z1) / 2, face: PI / 2, kind: 'wc' },
  ],
  bar: BAR,
  stage: STAGE,
  wc: { x: W + 0.95, z: (WC.z0 + WC.z1) / 2, door: { x: WC.x1, z0: WC.z0, z1: WC.z1 }, rect: [WC.x0, WC.z0, WC.x1, WC.z1] },
  door: { x: 4.4, z: 0 },
  spawn: { x: 4.4, z: -8 },
  photo: { x: 4.2, z: 12.6, face: PI },
};
LAYOUT.hall = LAYOUT.walls.map(w => w.a);

// быстрый доступ
LAYOUT.seatById = {};
for (const t of LAYOUT.tables) for (const s of t.seats) { s.table = t.id; s.zone = t.zone; LAYOUT.seatById[s.id] = s; }
LAYOUT.zoneAt = (x, z) => { for (const zn of LAYOUT.zones) { const r = zn.rect; if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return zn.id; } return null; };

return { LAYOUT };
});
