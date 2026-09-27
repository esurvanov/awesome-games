// Каталог предметов «Житьё» — единый источник id, цен, размеров и рейтингов.
// Рейтинги 0–10 — как карточки Buy-режима TS1 (research-sims-mechanics.md §2.8).
// Реклама взаимодействий (что и насколько поднимает) — в data/interactions.js (Мозг),
// модели — в js/render/manifest.js (Ассеты). Ключ везде — id.
//
// fp: [ширина по x, глубина по y] в тайлах при rot=0.
// place: 'floor' | 'wall' (двери/окна — в ребро стены) | 'surface' (на стол/стойку)
// cat: seating | surfaces | decor | electronics | appliances | plumbing | lighting | misc
// room: kitchen | bathroom | bedroom | living | study | outside | any
// depr: группа амортизации (electronics 25% / appliances 20% / furniture 15% / art −, растёт)
// bill: учитывается ли в счетах (двери, окна, картины — нет)

export const CATALOG = [
  // — Кухня —
  { id: 'fridge',       name: 'Холодильник «Мороз»',     price: 600,  fp: [1, 1], place: 'floor', cat: 'appliances', room: 'kitchen', depr: 'appliances', bill: true,  ratings: { hunger: 6 } },
  { id: 'stove',        name: 'Плита «Хозяюшка»',        price: 400,  fp: [1, 1], place: 'floor', cat: 'appliances', room: 'kitchen', depr: 'appliances', bill: true,  ratings: { hunger: 6 } },
  { id: 'counter',      name: 'Кухонная стойка',         price: 150,  fp: [1, 1], place: 'floor', cat: 'surfaces',   room: 'kitchen', depr: 'furniture',  bill: true,  ratings: {} },
  { id: 'kitchen_sink', name: 'Мойка кухонная',          price: 250,  fp: [1, 1], place: 'floor', cat: 'plumbing',   room: 'kitchen', depr: 'appliances', bill: true,  ratings: { hygiene: 2 } },
  { id: 'dining_table', name: 'Обеденный стол',          price: 200,  fp: [2, 1], place: 'floor', cat: 'surfaces',   room: 'kitchen', depr: 'furniture',  bill: true,  ratings: {} },
  { id: 'dining_chair', name: 'Стул «Табурет-люкс»',     price: 80,   fp: [1, 1], place: 'floor', cat: 'seating',    room: 'kitchen', depr: 'furniture',  bill: true,  ratings: { comfort: 2 } },
  { id: 'trash_can',    name: 'Мусорное ведро',          price: 30,   fp: [1, 1], place: 'floor', cat: 'misc',       room: 'kitchen', depr: 'furniture',  bill: true,  ratings: {} },
  // — Гостиная —
  { id: 'sofa',         name: 'Диван «Уют»',             price: 450,  fp: [2, 1], place: 'floor', cat: 'seating',    room: 'living',  depr: 'furniture',  bill: true,  ratings: { comfort: 5, energy: 3 } },
  { id: 'armchair',     name: 'Кресло',                  price: 250,  fp: [1, 1], place: 'floor', cat: 'seating',    room: 'living',  depr: 'furniture',  bill: true,  ratings: { comfort: 4 } },
  { id: 'coffee_table', name: 'Журнальный столик',       price: 90,   fp: [2, 1], place: 'floor', cat: 'surfaces',   room: 'living',  depr: 'furniture',  bill: true,  ratings: {} },
  { id: 'tv',           name: 'Телевизор «Горизонт»',    price: 500,  fp: [1, 1], place: 'floor', cat: 'electronics',room: 'living',  depr: 'electronics',bill: true,  ratings: { fun: 4 } },
  { id: 'stereo',       name: 'Музыкальный центр',       price: 300,  fp: [1, 1], place: 'floor', cat: 'electronics',room: 'living',  depr: 'electronics',bill: true,  ratings: { fun: 3 } },
  { id: 'bookshelf',    name: 'Книжный шкаф',            price: 250,  fp: [1, 1], place: 'floor', cat: 'misc',       room: 'study',   depr: 'furniture',  bill: true,  ratings: { fun: 1 }, skills: ['cooking', 'mechanical'] },
  { id: 'computer_desk',name: 'Стол с компьютером',      price: 1200, fp: [2, 1], place: 'floor', cat: 'electronics',room: 'study',   depr: 'electronics',bill: true,  ratings: { fun: 5 } },
  { id: 'chess',        name: 'Шахматный столик',        price: 500,  fp: [1, 1], place: 'floor', cat: 'misc',       room: 'study',   depr: 'furniture',  bill: true,  ratings: { fun: 2 }, skills: ['logic'] },
  { id: 'phone',        name: 'Телефон',                 price: 50,   fp: [1, 1], place: 'surface',cat: 'electronics',room: 'any',     depr: 'electronics',bill: true,  ratings: {} },
  // — Спальня —
  { id: 'bed_single',   name: 'Кровать «Спартанец»',     price: 300,  fp: [1, 2], place: 'floor', cat: 'seating',    room: 'bedroom', depr: 'furniture',  bill: true,  ratings: { comfort: 6, energy: 7 } },
  { id: 'bed_double',   name: 'Кровать двуспальная',     price: 750,  fp: [2, 2], place: 'floor', cat: 'seating',    room: 'bedroom', depr: 'furniture',  bill: true,  ratings: { comfort: 7, energy: 8 } },
  { id: 'dresser',      name: 'Комод',                   price: 200,  fp: [1, 1], place: 'floor', cat: 'misc',       room: 'bedroom', depr: 'furniture',  bill: true,  ratings: {} },
  { id: 'mirror',       name: 'Зеркало',                 price: 150,  fp: [1, 1], place: 'wall',  cat: 'decor',      room: 'any',     depr: 'art',        bill: false, ratings: { room: 1 }, skills: ['charisma'] },
  // — Ванная —
  { id: 'toilet',       name: 'Унитаз «Фаянс»',          price: 300,  fp: [1, 1], place: 'floor', cat: 'plumbing',   room: 'bathroom',depr: 'appliances', bill: true,  ratings: { bladder: 8 } },
  { id: 'shower',       name: 'Душевая кабина',          price: 650,  fp: [1, 1], place: 'floor', cat: 'plumbing',   room: 'bathroom',depr: 'appliances', bill: true,  ratings: { hygiene: 6 } },
  { id: 'bathtub',      name: 'Ванна',                   price: 900,  fp: [2, 1], place: 'floor', cat: 'plumbing',   room: 'bathroom',depr: 'appliances', bill: true,  ratings: { hygiene: 7, comfort: 4 } },
  { id: 'bath_sink',    name: 'Раковина',                price: 200,  fp: [1, 1], place: 'floor', cat: 'plumbing',   room: 'bathroom',depr: 'appliances', bill: true,  ratings: { hygiene: 2 } },
  // — Свет и декор —
  { id: 'floor_lamp',   name: 'Торшер',                  price: 100,  fp: [1, 1], place: 'floor', cat: 'lighting',   room: 'any',     depr: 'furniture',  bill: true,  ratings: { room: 1 } },
  { id: 'painting',     name: 'Картина «Берёзы»',        price: 400,  fp: [1, 1], place: 'wall',  cat: 'decor',      room: 'any',     depr: 'art',        bill: false, ratings: { room: 3 } },
  { id: 'plant',        name: 'Фикус',                   price: 60,   fp: [1, 1], place: 'floor', cat: 'decor',      room: 'any',     depr: 'furniture',  bill: true,  ratings: { room: 2 } },
  { id: 'rug',          name: 'Ковёр',                   price: 120,  fp: [2, 2], place: 'floor', cat: 'decor',      room: 'any',     depr: 'furniture',  bill: true,  ratings: { room: 2 }, walkable: true },
  // — Улица —
  { id: 'mailbox',      name: 'Почтовый ящик',           price: 50,   fp: [1, 1], place: 'floor', cat: 'misc',       room: 'outside', depr: 'furniture',  bill: false, ratings: {} },
  // — Волна 2: навыки, безопасность, дети, смерть —
  { id: 'exercise_bench', name: 'Тренажёр «Богатырь»',     price: 450,  fp: [1, 2], place: 'floor', cat: 'misc',       room: 'any',     depr: 'furniture',  bill: true,  ratings: { fun: 2 }, skills: ['body'] },
  { id: 'easel',        name: 'Мольберт',                price: 350,  fp: [1, 1], place: 'floor', cat: 'misc',       room: 'study',   depr: 'furniture',  bill: true,  ratings: { fun: 3 }, skills: ['creativity'] },
  { id: 'smoke_alarm',  name: 'Датчик дыма',             price: 50,   fp: [1, 1], place: 'wall',   cat: 'electronics',room: 'any',     depr: 'electronics',bill: true,  ratings: {} },
  { id: 'burglar_alarm',name: 'Сигнализация',            price: 250,  fp: [1, 1], place: 'wall',   cat: 'electronics',room: 'any',     depr: 'electronics',bill: true,  ratings: {} },
  { id: 'crib',         name: 'Детская кроватка',        price: 300,  fp: [1, 1], place: 'floor', cat: 'misc',       room: 'bedroom', depr: 'furniture',  bill: true,  ratings: {} },
  { id: 'tombstone',    name: 'Надгробие',               price: 0,    fp: [1, 1], place: 'floor', cat: 'misc',       room: 'outside', depr: 'none',       bill: false, ratings: {}, buyable: false },
  // — Строительство (ставятся в ребро стены) —
  { id: 'door',         name: 'Дверь деревянная',        price: 150,  fp: [1, 1], place: 'wall',  cat: 'build',      room: 'any',     depr: 'none',       bill: false, ratings: {}, portal: true },
  { id: 'stairs',       name: 'Лестница прямая',         price: 900,  fp: [1, 4], place: 'floor', cat: 'build',      room: 'any',     depr: 'none',       bill: false, ratings: {}, portal: true, levels: 2 },
  { id: 'window',       name: 'Окно',                    price: 110,  fp: [1, 1], place: 'wall',  cat: 'build',      room: 'any',     depr: 'none',       bill: false, ratings: { room: 1 } },
];

// Материалы стройки. Цены — research §2.7 (≈).
export const WALLS  = [ { id: 1, name: 'Штукатурка белая', price: 10, color: '#efe9dc' }, { id: 2, name: 'Обои в полоску', price: 14, color: '#c9d8c0' }, { id: 3, name: 'Кирпич', price: 18, color: '#b5654a' } ];
export const FLOORS = [ { id: 1, name: 'Паркет', price: 10, color: '#a87a4e' }, { id: 2, name: 'Плитка', price: 8, color: '#d7dde2' }, { id: 3, name: 'Ковролин', price: 6, color: '#7c8fa8' }, { id: 4, name: 'Линолеум', price: 4, color: '#c8b27a' } ];

// Волна 3: расширение каталога живёт в data/catalog-extra.js (владелец — агент Каталог).
// Каждый новый предмет имеет kind = id одного из базовых предметов выше (или новый kind из KINDS_EXTRA),
// поведение, места использования и запасная модель берутся по kind.
import { EXTRA, WALLS_EXTRA, FLOORS_EXTRA } from './catalog-extra.js';
for (const d of CATALOG) d.kind ??= d.id;
CATALOG.push(...EXTRA);
WALLS.push(...(WALLS_EXTRA ?? []));
FLOORS.push(...(FLOORS_EXTRA ?? []));

export const byId = Object.fromEntries(CATALOG.map(d => [d.id, d]));
export const kindOf = defId => byId[defId]?.kind ?? defId;
