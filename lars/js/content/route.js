// ═══ МАРШРУТ: очередь от Реданта до МАПП Верхний Ларс — Терек, ущелье, посёлки, посты ═══
// Источник: docs/research/geography.md (§1.1 км от Владикавказа, §2.3 геометрия очереди, §4 палитра).
// Пересчёт: s (км от КПП) = 31,2 − км от Владикавказа. Хвост 27–28.09 доходил до Реданта (км 6,9 → s ≈ 24,3).
// TODO-research: поперечные изгибы оси (x) — по форме ROUTE_AXIS, упрощённо; точная линия — позже, с OSM.
//
// Координата s — км вдоль дороги от КПП (0) к хвосту (растёт на север). Мир рисуется сверху, север вверху.
// ROUTE.length        — длина участка, км
// ROUTE.points[]      — опорные точки оси дороги: { s, x } — x поперечное смещение в км (+ восток).
//                       Движок сглаживает их (Catmull-Rom) и добавляет мелкие изгибы ROUTE.wiggle.
// ROUTE.wiggle        — { amp: м, len: м } мелкие изгибы
// ROUTE.river[]       — { s, off } смещение оси Терека от дороги в метрах (− запад, + восток); меняет сторону у мостов
// ROUTE.gorge[]       — { s, w } полуширина дна ущелья в метрах (дальше — склоны и скалы)
// ROUTE.places[]      — { id, name, s, kind, icon, side: −1|1, houses?, off? }
//                       kind: 'checkpoint'|'village'|'bridge'|'police'|'fuel'|'food'|'ruin'|'landmark'
//                       off — насколько место отстоит от дороги, м (ГЭС, руины)
//                       id мест используются в событиях: when.near = 'place:chmi'
// ROUTE.stalls        — безымянные точки торговли: { perVillage, perKmRoad, goods: [id], priceMul: [мин, макс], accepts }
// ROUTE.lanes[]       — { from, to, n } км: сколько рядов стоит очередь (последние 3 км — два ряда)
// ROUTE.signal[]      — { from, to, level } км: связь (0 — нет сети: сообщения ждут, перевод невозможен)
//                       chat/2022-d_27-28.md: «нет интернета у Нижнего Ларса»; за КПП — нет российской сети
// ROUTE.palette       — цвета вида сверху и 3D (hex)
// ROUTE.elev[]        — высота оси дороги, м, шаг 1 км ОТ ВЛАДИКАВКАЗА (geography.md §5 ELEV_PROFILE, DEM ±30–60 м;
//                       в 3D сглаживается). elevKmAtKpp — км от Владикавказа, где s = 0 (КПП)
// ROUTE.walls[]       — { s, w, e, lam } стены ущелья для 3D: высота над дорогой запад/восток, м; lam — «крутизна»
//                       (м по горизонтали до ~63 % высоты; меньше — отвеснее). Оценка по §4 «почти отвесные сотни метров»
//                       у КПП, лес и склоны положе к Реданту; восток на s 9–16 — массив Столовой горы (2993 м)
// ROUTE.kpp           — план МАПП для 3D (geography.md §2.1): v — м вдоль дороги от ворот-север (+ к хвосту), u — м на восток
// ROUTE.peaks[]       — дальние вершины: { name, x, y (км: восток, юг от КПП), h (м над морем), r (км), snow }
'use strict';
L.def('content/route', () => {
const ROUTE = {
  length: 24.6,
  points: [
    { s: 0, x: 0 }, { s: 1, x: 0.05 }, { s: 2.2, x: -0.05 }, { s: 3.2, x: 0.3 }, { s: 5, x: 0.45 }, { s: 6.9, x: 0.95 },
    { s: 8.2, x: 0.75 }, { s: 9.8, x: 0.3 }, { s: 11.5, x: 0.4 }, { s: 13.5, x: 0.1 }, { s: 15.5, x: -0.2 },
    { s: 17.4, x: -0.1 }, { s: 19.5, x: 0.55 }, { s: 22, x: 1.4 }, { s: 24.6, x: 1.9 },
  ],
  wiggle: { amp: 16, len: 240 },
  river: [
    { s: 0, off: 62 }, { s: 0.25, off: 50 }, { s: 1.5, off: 55 }, { s: 3.0, off: 30 }, { s: 3.2, off: -35 }, { s: 5, off: -70 },
    { s: 8.0, off: -40 }, { s: 8.3, off: 40 }, { s: 12, off: 85 }, { s: 15, off: 60 }, { s: 17.6, off: 30 }, { s: 17.8, off: -40 },
    { s: 21, off: -90 }, { s: 24.6, off: -120 },
  ],
  gorge: [
    { s: 0, w: 95 }, { s: 1.5, w: 110 }, { s: 3.2, w: 170 }, { s: 5, w: 230 }, { s: 7, w: 280 }, { s: 9.8, w: 260 },
    { s: 12, w: 380 }, { s: 15, w: 460 }, { s: 17.4, w: 560 }, { s: 20, w: 700 }, { s: 24.6, w: 900 },
  ],
  places: [
    { id: 'kpp', name: 'МАПП Верхний Ларс', s: 0.0, kind: 'checkpoint', icon: 'barrier', side: 1 },
    { id: 'ermolov', name: 'Ермоловский камень', s: 0.2, kind: 'landmark', icon: 'stone', side: 1, off: 22 },
    { id: 'vlars', name: 'Верхний Ларс', s: 0.35, kind: 'village', icon: 'house', side: -1, houses: 6 },
    { id: 'nlars', name: 'Нижний Ларс', s: 3.2, kind: 'village', icon: 'house', side: -1, houses: 12 },
    { id: 'cafe', name: 'Кафе', s: 3.4, kind: 'food', icon: 'food', side: 1 },
    { id: 'tower', name: 'Руины башни', s: 4.5, kind: 'ruin', icon: 'tower', side: 1, off: 60 },
    { id: 'ezmi', name: 'Эзми, ГЭС', s: 6.9, kind: 'landmark', icon: 'bolt', side: 1, off: 220 },
    { id: 'bridge', name: 'Мост', s: 8.2, kind: 'bridge', icon: 'bridge', side: 1 },
    { id: 'block', name: 'Блокпост', s: 8.9, kind: 'police', icon: 'shield', side: -1 },
    { id: 'chmi', name: 'Чми', s: 9.8, kind: 'village', icon: 'house', side: -1, houses: 30 },
    { id: 'fuel', name: 'АЗС', s: 10.2, kind: 'fuel', icon: 'fuel', side: 1 },
    { id: 'balta', name: 'Балта', s: 17.4, kind: 'village', icon: 'house', side: 1, houses: 36 },
    { id: 'baltaBridge', name: 'Мост у Балты', s: 17.7, kind: 'bridge', icon: 'bridge', side: -1 },
    { id: 'redant', name: 'Редант', s: 24.3, kind: 'village', icon: 'house', side: -1, houses: 40 },
  ],
  stalls: {
    perVillage: 3, perKmRoad: 0.35,
    goods: ['water', 'tea', 'snack', 'meal', 'bread', 'choco', 'cigs', 'coffee', 'charge'],
    priceMul: [1.0, 1.4], accepts: ['cash_rub', 'transfer_rub'],
  },
  lanes: [{ from: 0, to: 3, n: 2 }, { from: 3, to: 99, n: 1 }],
  signal: [{ from: 2.4, to: 4.2, level: 0 }], // TODO-research: точные границы
  palette: {
    asphalt: '#5a5750', shoulder: '#8b8474', floor: '#6f7446', forest: '#4f5d34', forestAutumn: '#8a7a3a', granite: '#8e8c86',
    graniteWet: '#6d6b68', river: '#9aa39a', night: '#0b1020', brake: '#d9261c', headlight: '#fff3d6', phone: '#bcd7ff',
    canopy: '#e6e8ea', barrier: '#c8322b', led: '#e8f1ff', roof: '#9c8f7a', roofTin: '#7f8a8c',
    skyDay: '#8fb7de', skyMountain: '#5f9ed8', haze: '#7c8aa0', snow: '#f7f9fb', snowShade: '#b8c6d8', windows: '#f2c46b',
    brick: '#a4553b', plaster: '#d6b98a', tunnel: '#15130f',
  },
  elev: [695, 693, 708, 717, 730, 745, 756, 760, 781, 792, 820, 860, 846, 817, 852, 912, 965, 881, 917, 882, 896, 907, 927, 983, 968, 996, 1005, 1019, 1043, 1059, 1079, 1113, 1188, 1220, 1233, 1263, 1322],
  elevKmAtKpp: 31.2,
  walls: [
    { s: -1, w: 1150, e: 1250, lam: 110 }, { s: 0.5, w: 1100, e: 1150, lam: 120 }, { s: 3, w: 1000, e: 1000, lam: 150 },
    { s: 6, w: 900, e: 950, lam: 190 }, { s: 9, w: 820, e: 1150, lam: 230 }, { s: 13, w: 700, e: 1250, lam: 280 },
    { s: 17, w: 600, e: 900, lam: 330 }, { s: 21, w: 520, e: 650, lam: 380 }, { s: 25, w: 420, e: 480, lam: 430 }, { s: 28, w: 300, e: 320, lam: 460 },
  ],
  kpp: {
    canopies: [ // { v0, v1, u0, u1, h } навесы, м
      { v0: -115, v1: -77, u0: -58, u1: -43, h: 6.5 }, { v0: -110, v1: -75, u0: -32, u1: 36, h: 7 },
      { v0: -245, v1: -197, u0: -62, u1: -18, h: 6.5 }, { v0: -245, v1: -197, u0: 8, u1: 54, h: 6.5 },
      { v0: -350, v1: -275, u0: -30, u1: 45, h: 7 },
    ],
    buildings: [ // { v0, v1, u0, u1, h, c }
      { v0: -187, v1: -125, u0: 47, u1: 86, h: 5, c: '#a4553b' }, { v0: -248, v1: -191, u0: 58, u1: 82, h: 4.5, c: '#d8d3c8' },
      { v0: 160, v1: 185, u0: 30, u1: 52, h: 4, c: '#d6b98a' }, { v0: 150, v1: 162, u0: 30, u1: 40, h: 3, c: '#cfd3d6' },
    ],
    booths: [-92, -221, -312], // v будок контроля (по одной на полосу)
    lanes: 6, gateN: 0, gateS: -420, fence: [-430, 5], plaza: { v0: -440, v1: 30, u0: -62, u1: 90 },
  },
  peaks: [
    { name: 'Столовая', x: 5.5, y: -8.7, h: 2993, r: 3.2, snow: 0.1, flat: true },
    { name: 'Казбек', x: -9.2, y: 7.8, h: 5054, r: 5, snow: 1 },
    { name: 'Джимара', x: -14, y: 3, h: 4780, r: 4.5, snow: 1 },
    { name: 'Гимарайхох', x: -6, y: 1.5, h: 3900, r: 3, snow: 0.8 },
    { name: 'Кибиши', x: 6, y: 4, h: 3600, r: 3, snow: 0.6 },
    { name: 'Шау-хох', x: 13, y: 2, h: 4368, r: 4, snow: 0.9 },
    { name: 'Мат-хох', x: -7, y: -14, h: 3100, r: 3, snow: 0.3 },
    { name: 'Кариухох', x: 8, y: -16, h: 3050, r: 3, snow: 0.2 },
  ],
};
return { ROUTE };
});
