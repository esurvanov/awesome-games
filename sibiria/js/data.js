'use strict';
// ---------- мир ----------
// Размер мира — одно место. По умолчанию 10 800² (×9, «Сибирь 2.0»: сюжетный участок в центре + 8 зон вокруг).
// Малый мир для проверок: ?world=3600 в адресе или глобал WORLD_SCALE = 1 (линейный множитель) до загрузки скриптов.
// Всё, что зависит от размера (плотности, туман, сетки, мини-карта, «домашний» участок), читает WORLD.
const WORLD = (() => {
  const BASE = 3600; // мир ×1: под него настроены плотности и сюжетный участок
  let k = typeof WORLD_SCALE === 'number' && WORLD_SCALE > 0 ? WORLD_SCALE : 3;
  try { const q = +new URLSearchParams(location.search).get('world'); if (q >= 1800 && q <= 36000) k = q / BASE; } catch (e) {}
  const W = Math.round(BASE * k), H = Math.round(BASE * k);
  return {
    W, H, BASE, k, area: W * H / (BASE * BASE),
    // сюжетный участок (изба, обломки, марь, чум, кедрач) — квадрат BASE×BASE в центре мира
    ox: Math.round((W - BASE) / 2), oy: Math.round((H - BASE) / 2),
    fogCell: 100,   // клетка тумана войны, px мира
    gridCell: 256,  // клетка общей хеш-сетки (Space)
    wallStep: 44,   // шаг деревьев-стены по краю мира
    // плотности — сколько штук на площадь BASE² (≈ 13 км²); число в мире = плотность × площадь (count)
    dens: { trees: 820, treeTries: 20000, drifts: 340, hares: 16, haresMin: 12, ravens: 14 },
    // вдоль реки — от длины реки (H), а не площади
    perRiver: { cracks: 110 },
    // сколько штук в мире: плотность × площадь (вдоль реки — × длина)
    count(kind) { return this.dens[kind] != null ? Math.round(this.dens[kind] * this.area) : Math.round(this.perRiver[kind] * H / BASE); },
  };
})();
// W, H — размер мира; CYCLE — секунд игрового времени в сутках (1440: игровой час = минута); RW — полуширина русла
// HOUR — игровой час, с. «Календарные» числа (голод, печь, костёр, пурги, посёлок) — через HOUR, «телесные» — в секундах.
const W = WORLD.W, H = WORLD.H, CYCLE = 1440, HOUR = CYCLE / 24, RW = 72;
// река течёт с севера на юг через весь мир; форма русла привязана к участку (при ×1 — как было).
// За пределами участка — большие излучины (ручной скелет A3): на севере к востоку, на юге к западу.
const riverBend = y => {
  const o = y < WORLD.oy ? WORLD.oy - y : y > WORLD.oy + WORLD.BASE ? y - WORLD.oy - WORLD.BASE : 0;
  return o ? (y < WORLD.oy ? 1 : -1) * (1 - Math.exp(-o / 900)) * 420 * Math.sin(o / 1400 + 0.6) : 0;
};
const riverX = y => WORLD.ox + 2250 + Math.sin((y - WORLD.oy) / 380) * 150 + Math.sin((y - WORLD.oy) / 97) * 20 + riverBend(y);
const onIce = (x, y) => Math.abs(x - riverX(y)) < RW - 8;
const POI = (() => { const OX = WORLD.ox, OY = WORLD.oy; return {
  cockpit: { x: OX + 1400, y: OY + 2250, r: 230, ic: ':heli:', n: 'Обломки Ми-8' },
  hut:     { x: OX + 1760, y: OY + 1960, r: 210, ic: ':hut:', n: 'Зимовье' },
  tail:    { x: OX + 2800, y: OY + 2560, r: 200, ic: ':heli:', n: 'Хвост Ми-8' },
  polynya: { x: riverX(OY + 1150), y: OY + 1150, r: 110, ic: ':fish:', n: 'Перекат' },
  chum:    { x: OX + 2980, y: OY + 1260, r: 210, ic: ':evenk:', n: 'Чум Уркачана' },
  cedar:   { x: OX + 3080, y: OY + 700, r: 400, ic: ':tree:', n: 'Кедрач' },
  mar:     { x: OX + 950, y: OY + 1050, r: 290, ic: ':fire:', n: 'Марь' },
  labaz:   { x: OX + 620, y: OY + 1900, r: 90, ic: ':labaz:', n: 'Лабаз' },
}; })();

// изба: внутренняя часть x0..x1, y0..y1; дверь — проём в южной стене
const HUT = { x: POI.hut.x, y: POI.hut.y };
const HUT_IN = { x0: HUT.x - 100, x1: HUT.x + 100, y0: HUT.y - 100, y1: HUT.y + 40 };
const WALL = 12, DOOR_W = 40;
const HUT_WALLS = [
  { x0: HUT_IN.x0 - WALL, x1: HUT_IN.x1 + WALL, y0: HUT_IN.y0 - WALL, y1: HUT_IN.y0 },
  { x0: HUT_IN.x0 - WALL, x1: HUT_IN.x0, y0: HUT_IN.y0, y1: HUT_IN.y1 + WALL },
  { x0: HUT_IN.x1, x1: HUT_IN.x1 + WALL, y0: HUT_IN.y0, y1: HUT_IN.y1 + WALL },
  { x0: HUT_IN.x0 - WALL, x1: HUT.x - DOOR_W / 2, y0: HUT_IN.y1, y1: HUT_IN.y1 + WALL },
  { x0: HUT.x + DOOR_W / 2, x1: HUT_IN.x1 + WALL, y0: HUT_IN.y1, y1: HUT_IN.y1 + WALL },
];
const DOOR_RECT = { x0: HUT.x - DOOR_W / 2, x1: HUT.x + DOOR_W / 2, y0: HUT_IN.y1, y1: HUT_IN.y1 + WALL };
const SPOT = {
  stove: { x: HUT.x - 70, y: HUT.y - 72 },
  bench: { x: HUT.x + 58, y: HUT.y - 76 },
  chest: { x: HUT.x + 82, y: HUT.y - 6 },
  bed:   { x: HUT.x - 72, y: HUT.y - 2 },
  veraBed: { x: HUT.x - 58, y: HUT.y + 20 },
  urkDoor: { x: HUT.x + 70, y: HUT.y + 90 },
};
const STACKS = [
  { x: POI.mar.x - 120, y: POI.mar.y + 40 },
  { x: POI.mar.x + 110, y: POI.mar.y + 60 },
  { x: POI.mar.x - 10, y: POI.mar.y - 110 },
];
const TUBE_POS = { x: POI.polynya.x + 28, y: POI.polynya.y - 18 };

// ---------- предметы ----------
const ITEMS = {
  wood:    { n: 'Дрова', i: ':wood:', kg: 2 },
  meat:    { n: 'Мясо', i: ':meat:', kg: 1, food: 40, raw: 1 },
  fish:    { n: 'Рыба', i: ':fish:', kg: 1, food: 32, raw: 1 },
  stew:    { n: 'Уха', i: ':stew:', kg: 1, food: 100, warm: 15 },
  can:     { n: 'Тушёнка', i: ':can:', kg: 0.5, food: 50 },
  dried:   { n: 'Вяленое мясо', i: ':meat:', kg: 0.5, food: 35 },
  tea:     { n: 'Чай', i: ':tea:', kg: 0 },
  honey:   { n: 'Мёд', i: ':food:', kg: 0.5, food: 30, warm: 12 },   // с заимки староверов
  hare:    { n: 'Шкурка зайца', i: ':hare:', kg: 0.5, fur: 1 },
  wpelt:   { n: 'Шкура волка', i: ':wolf:', kg: 2, fur: 3 },
  sable:   { n: 'Соболь', i: ':sable:', kg: 0.5, fur: 4 },
  scrap:   { n: 'Железо', i: ':scrap:', kg: 1 },
  kero:    { n: 'Керосин', i: ':kero:', kg: 3 },
  cable:   { n: 'Кабель', i: ':cable:', kg: 0.5 },
  snare:   { n: 'Силок', i: ':snare:', kg: 0.2 },
  trap:    { n: 'Капкан', i: ':trap:', kg: 1 },
  quartz:  { n: 'Кварц', i: ':quartz:', kg: 0, part: 1 },
  battery: { n: 'Аккумулятор', i: ':battery:', kg: 8, part: 1 },
  tube:    { n: 'Радиолампа', i: ':tube:', kg: 0, part: 1 },
  antenna: { n: 'Антенна', i: ':antenna:', kg: 2, part: 1 },
};
const ITEM_ORDER = Object.keys(ITEMS);
const FOOD_ORDER = ['stew', 'can', 'dried', 'meat', 'fish', 'honey'];
const PARTS = ['quartz', 'battery', 'antenna', 'tube'];

const GEAR = {
  saw:   { i: ':saw:', n: 'Пила', d: 'рубка быстрее' },
  lure:  { i: ':rod:', n: 'Блесна', d: 'клёв +25%' },
  hat:   { i: ':hat:', n: 'Ушанка', d: 'холод −15%' },
  dokha: { i: ':coat:', n: 'Доха', d: 'холод −30%' },
  kukhl: { i: ':deer:', n: 'Кухлянка', d: 'холод −40%' },
  skis:  { i: ':skis:', n: 'Лыжи', d: 'скорость +20%' },
  sled:  { i: ':sled:', n: 'Нарты', d: '+20 кг' },
  shoes: { i: ':skis:', n: 'Снегоступы', d: 'в снегу вязнешь втрое меньше' },
  shovel: { i: ':shovel:', n: 'Лопата', d: 'удержание E в поле — расчищать снег' },
};

// at: fire — у огня или горящей печи; stove — у печи; bench — верстак в избе
const RECIPES = [
  { id: 'torch', i: ':fire:', n: 'Факел', in: { wood: 1 }, at: 'fire', d: 'свет, волки держатся дальше' },
  { id: 'tea', i: ':tea:', n: 'Чай', in: { tea: 1 }, at: 'fire', d: '+30 тепла' },
  { id: 'stew', i: ':stew:', n: 'Уха', in: { fish: 1, meat: 1 }, out: { stew: 1 }, at: 'stove', d: '+100 еды' },
  { id: 'snare', i: ':snare:', n: 'Силки ×2', in: { scrap: 1 }, out: { snare: 2 }, at: 'bench', d: 'зайцы к утру' },
  { id: 'lure', i: ':rod:', n: 'Блесна', in: { scrap: 1 }, gear: 'lure', at: 'bench', d: 'клёв +25%' },
  { id: 'trap', i: ':trap:', n: 'Капкан', in: { scrap: 3 }, out: { trap: 1 }, at: 'bench', d: 'соболь в кедраче' },
  { id: 'hat', i: ':hat:', n: 'Ушанка', in: { hare: 3 }, gear: 'hat', at: 'bench', d: 'холод −15%' },
  { id: 'dokha', i: ':coat:', n: 'Доха', in: { wpelt: 2, hare: 2 }, gear: 'dokha', at: 'bench', d: 'холод −30%' },
  { id: 'sled', i: ':sled:', n: 'Нарты', in: { wood: 6, scrap: 2 }, gear: 'sled', at: 'bench', d: '+20 кг' },
  { id: 'shoes', i: ':skis:', n: 'Снегоступы', in: { wood: 2, hare: 2 }, gear: 'shoes', at: 'bench', d: 'в снегу вязнешь втрое меньше' },
  { id: 'shovel', i: ':shovel:', n: 'Лопата', in: { wood: 2, scrap: 1 }, gear: 'shovel', at: 'bench', d: 'расчищать снег, прокладывать тропы' },
  { id: 'antenna', i: ':antenna:', n: 'Антенна', in: { scrap: 3, cable: 1 }, out: { antenna: 1 }, at: 'bench', d: 'деталь рации' },
  { id: 'radio', i: ':radio:', n: 'Рация', in: { quartz: 1, battery: 1, tube: 1, antenna: 1 }, at: 'bench', d: 'аккумулятор заряжен', radio: 1 },
];
const HUT_UPG = [
  { id: 'walls', i: ':wall:', n: 'Щели', in: { wood: 6 }, d: 'печь: :wood:1 = 1 ч 45 мин' },
  { id: 'door', i: ':door:', n: 'Дверь', in: { wood: 4, scrap: 1 }, d: 'волки не войдут' },
  { id: 'bench', i: ':craft:', n: 'Верстак', in: { wood: 5, scrap: 2 }, d: 'мастерская и рация' },
  { id: 'damper', i: ':stove:', n: 'Заслонка', in: { scrap: 3 }, d: 'печь: :wood:1 = 2 ч 15 мин' },
];
const SKILLS = {
  chop: { i: ':axe:', n: 'Рубка' },
  fish: { i: ':rod:', n: 'Рыбалка' },
  hunt: { i: ':trap:', n: 'Охота' },
  cold: { i: ':frost:', n: 'Закалка' },
};
const LV = [0, 8, 20, 40, 70];

const WRECK_POOL = {
  cockpit: ['scrap', 'scrap', 'can', 'scrap', 'quartz', 'scrap', 'cable', 'scrap', 'can', 'tea', 'scrap', 'scrap', 'can'],
  tail: ['scrap', 'kero', 'scrap', 'battery', 'scrap', 'saw', 'scrap', 'kero', 'scrap'],
};

// ================= ПОСЁЛОК (по мотивам Age of Empires) =================
// 'food' — любая еда со склада (мясо, рыба, вяленое, тушёнка, уха)
const FOOD_KEYS = ['dried', 'meat', 'fish', 'can', 'stew'];
const EPOCHS = [
  { n: 'Зимовье', ic: ':epoch:' },
  { n: 'Заимка', ic: ':epoch:', cost: { food: 6, wood: 25 }, t: 45, any: ['woodshed', 'smoke', 'labaz2'], need: 2, d: 'эвенки, лайки, кузня, вышка, фактория' },
  { n: 'Промысел', ic: ':epoch:', cost: { food: 12, scrap: 2 }, t: 60, all: ['forge', 'tower'], d: 'стрелки, улучшения' },
  { n: 'Посёлок', ic: ':epoch:', cost: { food: 16, scrap: 2, hare: 3 }, t: 75, all: ['market'], d: '+1 урон всем, посёлок переживёт зиму' },
];
const BUILDS = {
  balok:    { n: 'Балок', i: ':balok:', cost: { wood: 8 }, t: 18, ep: 0, w: 58, h: 38, pop: 4, shelter: 1, d: '+4 места, укрытие' },
  woodshed: { n: 'Дровяник', i: ':woodshed:', cost: { wood: 10 }, t: 18, ep: 0, w: 62, h: 36, drop: ['wood'], d: 'склад дров у леса' },
  smoke:    { n: 'Коптильня', i: ':smoke:', cost: { wood: 12 }, t: 22, ep: 0, w: 48, h: 40, drop: ['meat', 'fish'], d: 'склад еды, коптит сырое' },
  labaz2:   { n: 'Лабаз', i: ':labaz:', cost: { wood: 10, scrap: 1 }, t: 22, ep: 0, w: 42, h: 36, drop: ['hare', 'sable', 'wpelt', 'meat'], d: 'пушнина сама: :hare:1 · 4,5 ч' },
  forge:    { n: 'Кузня', i: ':forge:', cost: { wood: 16, scrap: 2 }, t: 30, ep: 1, w: 54, h: 44, d: 'улучшения' },
  tower:    { n: 'Вышка', i: ':tower:', cost: { wood: 12, scrap: 1 }, t: 30, ep: 1, w: 34, h: 34, d: 'огонь и стрелы по волкам' },
  // площадка для вертолёта: только на мари, только после связи; плоская — не преграда
  pad:      { n: 'Площадка', i: ':pad:', cost: { wood: 20 }, t: 130, ep: 0, w: 96, h: 70, flat: 1, onMar: 1, needContact: 1, d: 'вертолёт сядет только сюда · марь' },
  market:   { n: 'Фактория', i: ':market:', cost: { wood: 20 }, t: 35, ep: 1, w: 76, h: 50, drop: ['wood', 'meat', 'fish', 'hare', 'sable', 'wpelt', 'scrap'], d: 'торг за ₽ по курсу' },
};
const UNITS = {
  bich:    { n: 'Бич', i: ':bich:', cost: { food: 3 }, t: 12, ep: 0, hp: 25, sp: 72, d: 'рубит, рыбачит, строит, разбирает' },
  evenk:   { n: 'Эвенк', i: ':evenk:', cost: { food: 4, hare: 1 }, t: 15, ep: 1, hp: 30, sp: 88, rng: 130, dmg: 1, d: 'охотится, стреляет по волкам' },
  laika:   { n: 'Лайка', i: ':dog:', cost: { food: 2 }, t: 8, ep: 1, hp: 30, sp: 150, dmg: 1, melee: 1, d: 'чует и держит волков' },
  strelok: { n: 'Стрелок', i: ':gunner:', cost: { food: 5, scrap: 1 }, t: 18, ep: 2, hp: 45, sp: 82, rng: 175, dmg: 2, d: 'охрана посёлка' },
};
const TECHS = {
  saw2:   { n: 'Лучковая пила', i: ':saw:', cost: { scrap: 2 }, ep: 1, t: 15, mod: { chop: 1.3 }, d: 'рубка +30%' },
  vatnik: { n: 'Ватники', i: ':coat:', cost: { hare: 3 }, ep: 1, t: 15, mod: { hp: 15 }, d: 'люди +15 здоровья' },
  sled2:  { n: 'Салазки', i: ':pack:', cost: { wood: 8, scrap: 1 }, ep: 2, t: 20, mod: { carry: 1.5, speed: 1.1 }, d: 'груз +50%, скорость +10%' },
  nets:   { n: 'Сети', i: ':net:', cost: { scrap: 2 }, ep: 2, t: 20, mod: { fish: 1.4 }, d: 'рыба +40%' },
  bows:   { n: 'Тугие луки', i: ':rifle:', cost: { wood: 6, scrap: 1 }, ep: 2, t: 20, mod: { dmg: 1 }, d: 'урон +1' },
};
// курс в рублях; 1993 — инфляция +5% за сутки
const MARKET = { wood: 3, meat: 5, fish: 4, hare: 8, wpelt: 25, sable: 40, scrap: 10, kero: 20, can: 12, tea: 6 };
const MARKET_SELL = ['wood', 'meat', 'fish', 'hare', 'wpelt', 'sable'];
const MARKET_BUY = ['scrap', 'kero', 'can', 'tea', 'meat', 'wood'];

// ================= РЫБАЛКА НА РЕАКЦИЮ (по мотивам «Берёзовки») =================
const FISHES = [
  { n: 'Окунь', w: [0.1, 0.8], p: 0.3 },
  { n: 'Хариус', w: [0.2, 1.3], p: 0.3 },
  { n: 'Ленок', w: [0.6, 3.2], p: 0.2 },
  { n: 'Налим', w: [0.5, 4.5], p: 0.15 },
  { n: 'Таймень', w: [3, 14], p: 0.05, big: 1 },
];

// записки в мире: где лежат и что написано
const NOTES = {
  log:    { i: ':log:', x: POI.cockpit.x - 60, y: POI.cockpit.y + 44, t: '14.01. Борт 24713, Тура · партия №7. Обледенение, отказ левого. Садимся на реку. — Семёнов' },
  pilot:  { i: ':log:', x: POI.cockpit.x + 80, y: POI.cockpit.y + 70, t: 'Кто живой — Гоша ушёл вверх по реке за помощью. Вера у хвоста, за рекой. Я не дойду. С.' },
  wife:   { i: ':log:', x: POI.cockpit.x + 110, y: POI.cockpit.y + 40, t: 'Галя, к Старому Новому году не успею. Рыбу не покупай, привезу.' },
  door:   { i: ':log:', x: HUT.x + 36, y: HUT_IN.y1 + 30, t: 'Вырезано ножом: «Уркачан. 1987. Взял дрова — оставь дрова».' },
  manual: { i: ':log:', x: POI.tail.x - 70, y: POI.tail.y + 50, t: 'Р/ст «Ангара-1». Сеансы 08:00 и 20:00. Антенна — не менее 30 м провода.' },
  vera:   { i: ':log:', x: POI.tail.x + 60, y: POI.tail.y - 50, t: 'Проба 7-Б: кварцевая жила, сульфиды. Если найдут — ящик не бросайте, там год работы.' },
  gosha:  { i: ':log:', x: POI.polynya.x - 110, y: POI.polynya.y + 20, t: 'Лёд тонкий у переката. Лампу взял — чтоб без меня не чинили. Шутка. Г.' },
  labaz:  { i: ':log:', x: POI.labaz.x + 30, y: POI.labaz.y + 40, t: 'Лабаз Уркачана. Голодный — ешь. Сытый — не трогай.' },
  chum:   { i: ':log:', x: POI.chum.x + 95, y: POI.chum.y + 75, t: 'На бересте углём: три оленя. Двое зачёркнуты. Рядом волчья лапа. Больше ничего.' },
  plan:   { i: ':log:', x: POI.mar.x - 190, y: POI.mar.y + 140, t: 'Планшет партии №7: «Марь у ключа — площадка под Ми-8, 60×60 м. Проверено. Шмелёв, 1989». Ниже приписка: «Комары — звери».' },
  trap:   { i: ':log:', x: POI.cedar.x - 160, y: POI.cedar.y + 130, t: 'Бирка на капкане: «Путик Уркачана. Соболь — мой. Заяц — чей поймал. Волк — ничей».' },
  gosha2: { i: ':log:', x: riverX(WORLD.oy + 700) - 150, y: WORLD.oy + 700, t: 'Дальше не пошёл — лёд гудит. Вернусь к хвосту другой дорогой. Если меня нет, значит, дорога длинная. Г.' },
};

// чем записка прижата (рисунок js/art-world.js note): stone — под камнем (в пургу лист может выскочить, js/live.js),
// crate — под углом ящика, panel — под куском обшивки, crack — в щели бревна/столба (crate/panel/crack держат лист на месте)
for (const [k, h] of Object.entries({ log: 'panel', pilot: 'stone', wife: 'crate', door: 'crack', manual: 'panel', vera: 'stone', gosha: 'stone', labaz: 'crack', chum: 'stone', plan: 'stone', trap: 'crack', gosha2: 'stone' })) if (NOTES[k]) NOTES[k].hold = h;

const INSPECT = [
  { id: 'sign', i: ':sign:', x: HUT.x - 150, y: HUT.y + 90, t: 'Табличка: «Геологическая партия №7. Посторонним — некуда».' },
  { id: 'pennant', i: ':flag:', x: POI.cockpit.x - 120, y: POI.cockpit.y + 10, t: 'Вымпел «Ударнику коммунистического труда». Семёныч возил с собой. На удачу.' },
  { id: 'barrel', i: ':kero:', x: POI.tail.x + 90, y: POI.tail.y + 40, t: 'Бочка из-под керосина. Пустая. Как и обещания начальства.' },
  { id: 'buran', i: ':sled:', x: POI.chum.x - 110, y: POI.chum.y + 30, t: '«Буран». Бензина нет с 1991-го. Олени надёжнее.' },
  { id: 'lenin', i: ':idle:', x: POI.labaz.x - 60, y: POI.labaz.y - 30, t: 'Бюст Ленина. Кто-то надел на него ушанку. Правильно, мороз.' },
  { id: 'pole', i: ':mast:', x: WORLD.ox + 2500, y: WORLD.oy + 1800, t: 'Столб ЛЭП. Проводов нет. Столб есть. Так и живём.' },
];

// ================= БАЛАНС (реестр чисел логики, E2) =================
// Все настраиваемые числа игровой логики — здесь. Время — в игровых секундах (сутки = CYCLE, час = HOUR),
// расстояния — px мира, скорости — px/с, «/с» — в секунду. Тексты с числами (подсказки, сообщения)
// живут в данных контента — меняя число, проверь и текст.
const TUNE = {
  // уровни сложности: множители потери тепла, голода и урона от волков/шатуна
  diff: {
    easy:   { n: 'Лёгкая',  i: ':day:', cold: 0.75, hunger: 0.75, wolf: 0.6, tire: 0.75 },
    normal: { n: 'Обычная', i: ':frost:', cold: 1, hunger: 1, wolf: 1, tire: 1 },
    hard:   { n: 'Тяжёлая', i: ':frost:', cold: 1.25, hunger: 1.2, wolf: 1.4, tire: 1.2 },
  },
  time: {
    startH: 9,        // старт игры — 09:00 первого дня
    sleepX: 12,       // во сне время идёт ×12 (пачками шагов в бюджет skipMs — как «До утра»)
    sleepFrom: 19,    // лечь можно с 19:00…
    sleepTo: 6,       // …и до 06:00
    wakeAt: 7,        // утро (подъём, рассвет, улов) — с 07:00 до полудня
    // «До утра» (Z): та же симуляция пачками шагов skipDt за кадр (не дольше skipMs мс); вне избы — бодрствуя.
    // Будит: утро, угрозы (как сон) — вне избы волк/шатун ближе skipThreatR
    skipDt: 0.1, skipMs: 12, skipThreatR: 600,
    k: HOUR / 20,     // темп: игровой час длиннее прежнего (20 с) в k раз — директор угроз и выработка посёлка считают в игровом времени
  },
  // температура воздуха: днём day0 + dayStep·(день−1), ночью night0 + nightStep·(день−1), с coldDay-го дня ночью coldMin
  temp: { day0: -22, dayStep: -2, night0: -40, nightStep: -3, coldDay: 5, coldMin: -55, storm: -12 },
  // пурга: шанс в сутки, начало между from и to часами, длительность = CHAPTERS[i].threat.storm × [lenMin..lenMax]
  storm: { chance: 0.75, from: 10, to: 15, lenMin: 0.9, lenMax: 1.3, omenT: 2 * HOUR },
  sky: { auroraChance: 0.65, auroraMin: 0.5 },
  // именованные радиусы, завязанные на расстояния по миру
  r: {
    nearHut: 230,     // «у избы» — стройка, найм, улучшения избы
    hutWolves: 380,   // «волки у избы»: без двери не уснуть; лайка лает
    farHome: 900,     // директор: «далеко от укрытия» → +напряжение
    petLeash: 900,    // лайка догоняет героя прыжком, если отстала дальше
    siteSeek: 800,    // бич сам берёт стройку в этом радиусе
    fireKeep: 1500,   // на рассвете гаснут забытые костры дальше этого от героя
    awake: 1800,      // «спящие» сущности: дальше этого от героя тикают реже
    hareSpawn: 1800,  // новые зайцы — в квадрате ±этого вокруг героя
    amuletGap: 500,   // обереги не ближе друг к другу (× линейный масштаб мира)
    viewDay: 380,     // туман войны: радиус обзора днём
    viewNight: 220,   // …и ночью
  },
  // транспорт (A7): скорости, px/с — база × множитель местности (TERRAIN, js/content/zones.js)
  tr: {
    deer: 360, buran: 580, rideR: 70,             // упряжка, «Буран»; сесть — ближе rideR
    buranPx: 4000,                                // 1 :kero: = 4000 px пути «Бурана»
    deerDays: 2,                                  // аренда упряжки — на двое суток
    deerRent: { meat: 3 }, urkRent: { hare: 2 },  // цена у стойбища / у деда (уважение ≥ 1)
    fix: { scrap: 3, cable: 1 }, fixT: 6,         // починка «Бурана» на буровой
    scare: 3,                                     // «Буран» пугает зайцев в 3 раза дальше
    // быстрый переход (A7): по открытой карте, днём, без пурги, без волков ближе wolfR;
    // игровое время = путь ÷ скорость × wind (петли); тепло не ниже warmMin; не дольше maxH часов
    travel: { wolfR: 600, wind: 1.3, maxH: 5, warmMin: 20, foodK: 0.6 },
  },
  // зоны (SPEC-world §5): опасности и правила
  zone: {
    wetP: 0.05, wetT: 30,                         // наледь: шанс промокнуть за секунду пути, мокрый — 30 с
    sprainP: 0.025, sprainT: 45, sprain: 0.6,     // курумник: вывих за секунду пути, 45 с скорость ×0.6
    fallEvery: [22, 40], fallWarn: 1.4, fallDmg: 14, fallR: 48, // гарь: сухостой падает рядом
    windX: 28,                                    // голец: ветер сносит, px/с при 8 м/с (Wind.at, js/wind.js)
    surveyR: 2600, surveyT: 3,                    // «съёмка»: радиус и время
    lootT: 4, collapseP: 0.2, collapseDmg: 8,     // обыск построек; буровая: обрушение
    garBurn: 0.6, garChop: 0.6,                   // гарь: костёр горит дольше, сушняк рубится быстрее
  },
  world: { amulets: 12, deer: 6, // сюжет: «собери 12 сэвэков»; оленей в стаде деда
    regrowStumpDays: 4, regrowYoungDays: 4, regrowYoungWood: 1, // отрастание леса: пень → деревце → взрослое
    stashMax: 6, stashRaidR: 260, stashRaidP: 0.5,              // тайники в поле: лимит, радиус и шанс разора
  },
  engine: { fogT: 0.25, parts: 700, decals: 40, prints: 600, printLife: 25, corpses: 16 },
  // тонкий лёд у переката: трещит через creakT с, проваливаешься через breakT с
  ice: { creakT: 1.5, breakT: 3, warm: 10, wetT: 30 },
  hero: {
    speed: 165, skis: 1.2, sled: 0.9, over: 0.6, storm: 0.8, cold: 0.75, coldBelow: 15, drift: 0.8,
    capKg: 20, sledKg: 20, overChop: 6,          // грузоподъёмность; рубить можно с перегрузом до +6 кг
    chop: 1.6, chopSaw: 1.0, chopSkill: 0.08,    // с на полено; −8 % за уровень рубки
    grip: 14, iceGrip: 2.2, stormDrift: 25,      // разгон по снегу/льду; снос пургой, px/с
  },
  // «всё со всем» (js/interact.js): упор героя в препятствие, отклики на рубку
  interact: {
    bumpV: 70, bumpCd: 0.6, bumpBack: 2.5, // удар: скорость «в стену» от 70 px/с; не чаще раза в 0.6 с; отскок px
    pushEvery: 0.5, blocked: 0.35,         // упор: событие раз в 0.5 с; «стоит», если прошёл < 35 % от желаемого
    nudgeP: 0.85, nudge: 2,                // лёгкая тряска камеры только от сильного удара
    ravenHit: 70, ravenFell: 260,          // вороны взлетают: с дерева под топором / вокруг поваленного
    farR: 900,                             // работа людей посёлка дальше — без откликов (слабые машины)
  },
  cloth: { kukhl: 0.6, dokha: 0.7, hat: 0.85 },  // множитель потери тепла
  body: {
    warm0: 90, food0: 70,
    frostWarm: 10,                                // −10 к пределу тепла за каждое обморожение
    lossBase: 0.3, lossFrom: -10, lossPerDeg: 0.035, // потеря тепла/с: база + за каждый градус ниже −10
    coldSkill: 0.05, nightLoss: 0.7, moving: 0.85, ice: 1.3, wet: 2, tea: 0.7,
    frostBelow: 10, frostT: 20, frostMax: 3,      // обморожение: тепло < 10 дольше 20 с
    hardenBelow: 50, hardenT: 10,                 // закалка: опыт каждые 10 с на холоде без огня
    // голод — календарный: за игровой час 7 (стоя), +2 на ходу, во сне 3
    hunger: 7 / HOUR, hungerMove: 2 / HOUR, hungerSleep: 3 / HOUR, deepFrost: -45, hungerDeep: 1.2,
    coldDmg: 2.5, foodDmg: 1.2, regen: 0.25, regenWarm: 40, regenFood: 30,
  },
  // усталость G.s.tire 0..100 (HUD «Силы» = 100 − tire). «/ч» — за игровой час (HOUR), «/с» — телесное, в секундах.
  // Формула — Survival.tireRate (ею же считает прогноз ночи); связь с холодом — в Survival.rates.
  tire: {
    awake: 2, awakeFrom: 18, awakeK: 12,         // бодрствование +2/ч; после 18 ч без сна ×(1 + (ч − 18)/12)
    walk: 1.5, snow: 10, over: 1.5,              // ходьба +1.5/ч; по снегу +10/ч × Depth.effort(); перегруз ×1.5
    hit: 0.4,                                    // удар топором / рез / лунка / обломки — за каждый
    shiver: 0.6, shiverFrom: 45, frost: 0.1,     // дрожь +0.6/с × (45 − тепло)/45; +0.1/с за каждое обморожение
    hungry: 0.5, hungryBelow: 25,                // голоден: рост ×(1 + 0.5·(25 − еда)/25)
    sleep: 10, sleepCold: 3, sleepWarm: 30,      // сон: печь горит −10/ч, изба холодная −3/ч; тепло < 30 — не отдых
    awakeSleep: 2,                               // во сне счётчик бодрствования тает ×2
    rest: 4, restWarm: 40, fireAwake: 0.5,       // отдых сидя на пне / в тёплой избе −4/ч при тепле > 40; стоя у огня — бодрствование ×0.5, без отдыха
    tea: 8, food: 5,                             // чай −8 сразу и без роста, пока греет; горячая еда −5
    coldLoss: 0.5, coldFrom: 50,                 // потеря тепла × (1 + 0.5·sm(50, 100, tire))
    speed: 0.25, speedFrom: 60, chop: 0.4, chopFrom: 50, tired: 70, // скорость −25 % и рубка ×1.4 к 100; поза «устал» > 70
    doze: 90, dozeWarm: 30, dozeStill: 4, dozeT: 6, dozeLoss: 1.5, dozeWake: 1.2, // засыпание на морозе: условия, с, тепло ×1.5, подъём — держать ход 1.2 с
    low: 30, edge: 10,                           // HUD: сил < 30 — пульс, < 10 — синие края
  },
  stove: {
    secPerLog: { base: 1.25 * HOUR, walls: 1.75 * HOUR, damper: 2.25 * HOUR }, // огня от полена: без утепления / щели / заслонка
    maxLogs: 8, fullSlack: 0.5,                   // вместимость (см. Stove.maxLogs), «полна» — за пол-полена
    nightBurn: 0.3, stormDraft: 1.3,              // ночью горит быстрее; в пургу без щелей — тяга
    insideLit: { base: 15, walls: 25 }, insideCold: { base: 5, walls: 10 }, // +° в избе
    heat: { base: 8, walls: 12, damper: 14 },     // тепло/с от печи
    chargeT: 60,                                  // аккумулятор заряжается за 60 с (телесное: столько стоишь у печи)
  },
  fire: {
    fear: { stack: 260, tower: 220, big: 200, small: 110, bigFuel: 0.5 * HOUR }, // радиус страха волков; «большой» — топлива > 0,5 ч
    hutProtectR: 170, torchR: 120, torchT: 60,
    heatR: 140, stackHeatR: 200, heatBase: 3, heatK: 10, // тепло у огня: 3..13/с
    stormBurn: 1.6, nightBurn: 0.5,
    // топливо костра — игровые секунды: полено 1,25 ч, максимум 8 ч, разжечь 2 ч, новый костёр 2,25 ч
    fuelAdd: 1.25 * HOUR, fuelMax: 8 * HOUR, relightCost: 2, relightFuel: 2 * HOUR, buildCost: 3, buildFuel: 2.25 * HOUR,
  },
  act: {
    bearR: 80, wolfR: 58, hareR: 50,              // дотянуться до зверя (E)
    stackKeroT: 120, stackLightT: 60,             // сигнальная куча горит: с керосином / без
    wreckT: 4, digT: 4, holeFish: 3, chopFood: 1, fishFood: 0.5,
    sniffCd: 8, sniffR: 650, fullAt: 96, rawFood: 0.45, teaWarm: 30, teaT: 60,
    bearSleepR: 450,                              // шатун ближе к избе — не уснуть
    // жесты героя: удержание E ≥ holdT или X — второе действие цели (рубка по удержанию повторяется, трясти — X)
    holdT: 0.35, chopK: { chopHeavy: 1.15, chopCold: 1.1, chopLow: 1.08 }, // рубка устало/на морозе/в пургу — дольше
    shakeT: 1.2, nutsP: 0.5, nutsFood: 6, shakeWarm: 1.5, // трясти дерево: в кедраче орешки (еда); под кроной — снег за шиворот
    kickT: 0.6, kickP: 0.3,                       // пнуть сугроб (раз на сугроб): находка дрова/железо/тушёнка
    warmT: 20, warmHeat: 3,                       // греть руки: до 20 с, +3 тепла/с сверх огня
    buryT: 2, buryMax: 3,                         // засыпать костёр: остаток топлива → поленья (по fuelAdd за штуку, ≤ 3)
    readT: 1.6, readR: 36, readXp: 45,            // читать след: присесть; опыт охоты не чаще раза в 45 с
    restFood: 0.5, restRegen: 0.15,               // сидеть на пне: голод ×0.5, здоровье +0.15/с
    petT: 1.6, petHp: 10, petCd: 20,              // гладить лайку: +10 здоровья собаке, не чаще раза в 20 с
    throwR: 230, throwHit: 0.65, throwHare: 0.25, throwCd: 1.2, throwV: 420, dogR: 320, // палка/камень: волк отскакивает, заяц — шанс; лайка приносит
  },
  // «живой» герой (js/hero.js): возня стоя через fidget с, повтор через again с; поскользнуться на льду при развороте; stoveR — греет руки у печи
  life: { fidget: [1.5, 3], again: [2.2, 4.5], slipP: 0.35, slipV: 90, slipCd: 4, flinchR: 170, stoveR: 64 },
  // тело героя (Hero.body): commit — сколько с разовую позу не прерывает ввод; бег — от скорости px/с; скольжение по льду без ввода — поза slip на доле glideA;
  // tail — прерванная/законченная рубка доигрывает замах с доли tail[0]..tail[1] (только без ввода)
  pose: { commit: { hurt: 0.25, slip: 0.25, stagger: 0.2, flinch: 0.15 }, runV: 185, staggerP: 0.6, staggerCd: 2.5, glideV: 8, glideA: 0.3, tail: [0.3, 0.66] },
  radio: { sessions: [[7.5, 9], [19.5, 21]], fromChapter: 3 }, // окна сеансов; борт слышит с главы IV
  fauna: { hareMinR: 700, hareScare: 170, hareRun: 150, hareRunSkill: 4, hareRespawn: 0.3 },
  traps: { minT: 1.5 * HOUR, sable: 0.35, wpeltTo: 0.45, trapHare: 0.3, snareHare: 0.4 }, // улов на рассвете
  director: {
    w: { warm: 0.35, hp: 0.25, food: 0.15, night: 20, storm: 15, far: 10, wolf: 8, bear: 30 }, // веса напряжения
    wolfR: 400, bearR: 500, budgetMax: 80, mercyHp: 30, mercyCalm: 20,
    cost: { scout: 10, pack: 35 }, omenPack: 25, omenScout: 8, peakOut: 85, calm: [25, 45],
  },
  wolf: {
    hp: 3, leaderHp: 6, leaderBeat: 5,            // вожак отогнан, если нанесено ≥ 5 урона
    scoutD: [600, 700], scoutT: [15, 25], packD: [600, 720], leaderD: 740,
    packR: 300, packRmin: 130, protGiveUp: 22,    // стая уходит, если герой у огня дольше 22 с
    preyR: 320, biteUnit: 8, bite: 12, biteWarm: 8, biteCd: 1.5, doorDmg: 5, goneR: 950,
  },
  bear: {
    chapter: 3, hp: 20, hpWounded: 14, hurtFlee: 0.4, huntR: 380, swipe: 50,
    respiteDark: 0.3,                             // глава IV началась в темноте — эта ночь без шатуна
    urkRespect: 2, urkR: 220, urkDmg: 4,          // дед стреляет (раз за ночь) при уважении ≥ 2
    wakeR: 320, buildDmg: 15, unitDmg: 20, doorDmg: 5,
    // БЛОКЕР баланса (D): подранок (hurtFlee) уходит и возвращается на hpWounded бесконечно — добить
    // его в бою нельзя по конструкции (порог «подранка» срабатывает раньше, чем урон доводит hp до 0),
    // и без предела шатун гоняет посёлок вечно. appsMax — сколько ночей он вообще выходит всего за игру;
    // в последнюю ночь порог «подранка» снят (bear.js) — драка идёт до конца, у вышек/стрелков/факела
    // есть настоящий шанс добить; не добили — уходит насовсем.
    appsMax: 3,
  },
  colony: {
    popBase: 4, popPerBalok: 4, queueMax: 5, rub0: 40,
    eatT0: 3 * HOUR, eatEvery: 4.5 * HOUR, hungerHp: 6, // посёлок ест раз в 4,5 игр. ч; нет еды — −6 здоровья
    hideFrom: 18.5, hideTo: 7.5, stormSpeed: 0.7, heal: 0.5,
    carry: { hunt: 4, fish: 4, other: 5 },
    chopT: 2.4, woodshedK: 1.2, woodshedR: 260, treeR: 600, hareR: 650,
    fishT: 6, fishP: 0.55, wreckT: 5, huntT: 1.4, huntP: 0.7,
    fearR: 300, fleeR: 150, guardR: 260, petR: 140,
    meleeCd: 1, rangedCd: 1.6, rangedHit: 0.8, bearDmgK: 0.5,
    buildHp: 60, furT: 4.5 * HOUR, furSable: 0.4, smokeT: HOUR, barkT: 20,   // лабаз: шкурка раз в 4,5 ч; коптильня: кусок за час
    towerFuel: 3 * HOUR, towerR: 280, towerCd: 2, towerHit: 0.75,
    marketR: 180, fee: 0.3, feeFriend: 0.15, feeRespect: 3, sellDecay: 0.97, buyRise: 1.03, inflation: 1.05,
  },
};
