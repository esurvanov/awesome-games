'use strict';
// ================= ЗОНЫ МИРА =================
// Зона = одна запись (SPEC-world §5, A4). Исполнитель — Zones (js/world.js): карта зон от якорей + шум,
// правила, опасности, объекты; транспорт — Transport (js/transport.js); рисунок — ArtZones (js/art-zones.js).
// Скелет мира (A3): сюжетный участок BASE×BASE в центре, 8 якорей по кольцу вокруг (соседи 2 700–3 400 px),
// наледь и зимник — на реке (якорь по riverX). Границы зон — шум от G.seed.
// Поля:
//   n, ic, sym     — название, иконка, условный знак на карте (A9)
//   at(c)          — якорь {x, y} от центра мира c; r — радиус, px; river — зона вытянута вдоль реки
//   active         — зона поместилась в мир (считает Zones при загрузке; при ?world=3600 — только ядро)
//   ground         — рисунок земли в кусках снега; terrain — поверхность (TERRAIN) по умолчанию
//   rules          — множители: cold — мороз, view — обзор (туман), spawn — зайцы, burn — огонь горит (×расход)
//   trees          — плотность леса (1 — как в тайге) и вид дерева; rocks — глыбы
//   hazards        — опасности (Zones.tick): wet, fall, sprain, wind, collapse
//   objects        — объекты: {id, type, dx, dy, clear?, t? (осмотр), loot? (обыск), survey?, rent?, vehicle?, npc?}
//                    · type 'note' — записка (попадает в NOTES: читается, считается в итоговом акте)
//                    · camp: r — вокруг объекта натоптано (поверхность camp); mark: [ic, имя] — ориентир на большой карте
//                    · need: 'flags.x' — объект есть в мире только после условия (склад Толяна)
//                    · type 'plot' — промысловый участок зоны (см. plot)
//   plot           — промысловый участок (A5, вариант «в»): {n, npc, need(g) → причина|null, cost, yield, crew, t}
//                    открывает персонаж зоны при посёлке эпохи ≥ II; утром участок сдаёт yield в лабаз (Zones.plotDawn)
//   desc           — строка при первом входе
const ZONES = {
  core: { n: 'Зимовье', ic: ':hut:', active: 1, core: 1,
    area: () => ({ x: WORLD.ox, y: WORLD.oy, w: WORLD.BASE, h: WORLD.BASE }),
    rules: { cold: 1, view: 1, spawn: 1, weather: { storm: 1 } }, terrain: 'core',
    objects: [], npcs: ['urk', 'vera'] },
  // ---------- первая волна: 8 зон ----------
  naled: { n: 'Наледь', ic: ':frost:', sym: 'waves', river: 1, at: c => ({ x: riverX(c.y - 3700), y: c.y - 3700 }), r: 1100,
    ground: 'naled', terrain: 'naled', rules: { cold: 1, view: 1, spawn: 0.5 },
    trees: { dens: 0.1, kind: r => r() < 0.6 ? 1 : 0 },
    hazards: ['wet'], desc: 'Наледь · вода под снегом — промокнешь, замёрзнешь · лыжи не идут',
    objects: [
      { id: 'barrel2', type: 'iceBarrel', dx: 150, dy: 90, clear: 90, t: 'Вмёрзшая бочка. Кто-то отметил ею край наледи. Край ушёл дальше.' },
      { id: 'steam1', type: 'steam', dx: -220, dy: -120, clear: 60 }, { id: 'steam2', type: 'steam', dx: 330, dy: -260, clear: 60 },
      { id: 'steam3', type: 'steam', dx: -420, dy: 300, clear: 60 }, { id: 'steam4', type: 'steam', dx: 80, dy: 420, clear: 60 },
      // избушка братьев Кочениных — на сухом берегу, у края наледи
      { id: 'lodge', type: 'lodge', dx: 640, dy: -420, clear: 150, solid: 36, light: 1, camp: 230, mark: [':trap:', 'Избушка Кочениных'],
        t: 'Избушка. На двери: «Кочениным. Не заперто — всё равно украдут».' },
      { id: 'kochenin', type: 'spot', dx: 560, dy: -330, npc: 'kochenin' },
      { id: 'kochNote', type: 'note', dx: 700, dy: -300, t: 'Путик от избушки до кедрача — 40 капканов. Дедов путик с нашим сходится у горелой лиственницы. Кто там первый проверил — того и соболь. Коченин-ст.' },
      { id: 'plotNaled', type: 'plot', dx: 480, dy: -220, clear: 60 },
    ], plot: { n: 'Рыбный промысел', npc: 'kochenin', cost: { wood: 8, food: 3 }, yield: { fish: 3 }, crew: ['bich', 'kochenin'],
      need: g => g.flags.kochWolvesDone ? null : 'сначала помоги Кочениным со стаей' },
    npcs: ['kochenin'] },
  gar: { n: 'Гарь', ic: ':fire:', sym: 'hatch', at: c => ({ x: c.x - 2400, y: c.y - 3400 }), r: 1200,
    ground: 'gar', terrain: 'gar', rules: { cold: 1, view: 1.2, spawn: 0.6, burn: TUNE.zone.garBurn },
    trees: { dens: 0.8, kind: r => r() < 0.85 ? 3 : 0 },
    hazards: ['fall'], desc: 'Гарь · сушняк горит дольше · бурелом падает',
    objects: [
      { id: 'burntBalok', type: 'burntBalok', dx: 60, dy: 40, clear: 160, loot: ['scrap', 'can', 'kero', 'scrap', 'tea', 'cable'],
        t: 'Балок пожарных. Табличка: «Пожарно-химическая станция. Не курить». Сгорел в 1989-м.', camp: 200, mark: [':fire:', 'Балок пожарных'] },
      { id: 'tolyan', type: 'spot', dx: -60, dy: 130, npc: 'tolyan' },
      // склад Толяна: брезент под сугробом — есть в мире, только когда Толян показал
      { id: 'stash', type: 'stash', dx: -380, dy: 260, clear: 70, need: 'flags.stashKnown', loot: ['scrap', 'can', 'kero', 'cable', 'tea', 'can', 'scrap'], mark: [':labaz:', 'Склад Толяна'] },
      { id: 'garNote', type: 'note', dx: 150, dy: 150, t: 'Журнал ПХС, последняя запись: «Пожар локализован. Балок — нет». Ниже карандашом: «Здесь живёт Анатолий. Временно. С 1991 г.»' },
    ], npcs: ['tolyan'] },
  kurum: { n: 'Курумник', ic: ':quartz:', sym: 'rocks', at: c => ({ x: c.x + 3500, y: c.y - 2900 }), r: 1100,
    ground: 'kurum', terrain: 'kurum', rules: { cold: 1.1, view: 1, spawn: 0.4 },
    trees: { dens: 0.2, kind: r => r() < 0.7 ? 0 : 1 }, rocks: 150,
    hazards: ['sprain'], desc: 'Курумник · лыжи снять · нога подвернётся — смотри под ноги',
    objects: [
      { id: 'den', type: 'den', dx: -40, dy: 20, clear: 130, loot: ['quartz', 'scrap', 'quartz', 'wpelt'],
        t: 'Пещерка под глыбами. Пахнет зверем. Шерсть на камнях — шатун здесь зимовал, да не дозимовал.', mark: [':bear:', 'Берлога'] },
      { id: 'kurumNote', type: 'note', dx: 210, dy: 160, t: 'Пикетажка партии №7, стр. 12: «Курумник, обн. 7-К. Кварц жильный, сульфиды — вкрапленность. Вера Н. — молодец. Нога цела». Последняя фраза зачёркнута.' },
    ], npcs: [] },
  golets: { n: 'Голец', ic: ':tree:', sym: 'contour', at: c => ({ x: c.x + 3750, y: c.y - 100 }), r: 1250,
    ground: 'golets', terrain: 'golets', rules: { cold: 1.5, view: 3, spawn: 0.3 },
    trees: { dens: 0.18, kind: r => 0 }, rocks: 40,
    hazards: ['wind'], desc: 'Голец · мороз ×1,5 · ветер · с тура видно на три дня пути',
    objects: [
      { id: 'gurii', type: 'gurii', dx: 0, dy: 0, clear: 150, survey: 1,
        t: 'Тур-гурий. Геодезисты сложили в 1961-м. Отсюда вся тайга — как на ладони.', mark: [':pin:', 'Тур'] },
      { id: 'goletsNote', type: 'note', dx: 60, dy: 110, t: 'Банка из-под монпансье в туре. Внутри: «Пункт триангуляции «Сопка». Хабаров, Лисицын, 1961. Пришедшим — привет. Пурга тут всегда». Ниже, 1978: «Подтверждаем».' },
      // заимка староверов — в поясе стланика, ниже вершины
      { id: 'zaimka', type: 'zaimka', dx: -760, dy: 520, clear: 190, solid: 44, light: 1, camp: 260, mark: [':hut:', 'Заимка Агафона'],
        t: 'Заимка. Ограда из жердей, над воротами — крест. Дым из трубы ровный, как по линейке.' },
      { id: 'agafon', type: 'spot', dx: -660, dy: 610, npc: 'agafon' },
    ], npcs: ['agafon'] },
  drill: { n: 'Буровая', ic: ':scrap:', sym: 'rig', at: c => ({ x: c.x + 3000, y: c.y + 3100 }), r: 1000,
    ground: 'drill', terrain: 'taiga', camp: 420, rules: { cold: 1, view: 1, spawn: 0.8 },
    trees: { dens: 0.7, kind: r => r() < 0.8 ? 0 : 1 },
    hazards: ['collapse'], desc: 'Буровая · солярка, кабель, железо · «Буран» ждёт ремонта',
    objects: [
      { id: 'rig', type: 'rig', dx: 0, dy: -40, clear: 260, solid: 46, mark: [':scrap:', 'Вышка БУ-75'], t: 'Буровая вышка БУ-75. Скважина 7-Р. Законсервирована «до особого распоряжения».' },
      { id: 'drillBalok', type: 'balokSkid', dx: -190, dy: 70, clear: 120, solid: 34, light: 1, loot: ['kero', 'cable', 'scrap', 'kero', 'scrap', 'can', 'cable', 'scrap'],
        t: 'Балок на санях. Вахта ушла в спешке: кружки на столе.' },
      { id: 'fuel', type: 'barrels', dx: 170, dy: 90, clear: 80, t: 'Бочки ГСМ. Пустые — кроме одной. Та вмёрзла.' },
      { id: 'kern', type: 'kern', dx: 90, dy: 170, clear: 60, t: 'Ящики с керном. «7-Р, инт. 1840–1860 м». Вере бы показать.' },
      { id: 'buranSpot', type: 'spot', dx: -60, dy: 190, clear: 70, vehicle: 'buran' },
      { id: 'mikhalych', type: 'spot', dx: -120, dy: 140, npc: 'mikhalych' },
      { id: 'vakhta2', type: 'spot', dx: -250, dy: 110, npc: 'vakhta2', look: 'vakhta' },   // напарники: стоят, курят
      { id: 'vakhta3', type: 'spot', dx: 210, dy: 160, npc: 'vakhta3', look: 'bich' },
      { id: 'drillNote', type: 'note', dx: -150, dy: 20, t: 'Вахтовый журнал, 30.09.92: «Смену не привезли. Связи нет. Солярки на зиму — если не топить». 01.12.92: «Топим». Дальше страницы вырваны — на растопку.' },
      { id: 'plotDrill', type: 'plot', dx: 260, dy: 20, clear: 60 },
    ],
    plot: { n: 'Солярка и кабель', npc: 'mikhalych', cost: { wood: 10, food: 4 }, yield: { kero: 1, cable: 1 }, crew: ['vakhta', 'bich'],
      need: g => g.flags.mikhMeatDone ? null : 'сначала накорми вахту' },
    npcs: ['mikhalych'] },
  meteo: { n: 'Метеостанция', ic: ':radio:', sym: 'meteo', at: c => ({ x: c.x - 3000, y: c.y + 2800 }), r: 1000,
    ground: 'meteo', terrain: 'taiga', camp: 400, rules: { cold: 1, view: 1.5, spawn: 1, weather: { forecast: 1 } },
    trees: { dens: 0.6, kind: r => r() < 0.7 ? 0 : 1 },
    hazards: [], desc: 'Метеостанция · прогноз пурги · мачта — видно далеко',
    objects: [
      // БЛОКЕР баланса (E, глава VII): дошедший до Тамары ждёт сеанс/борт у метеостанции, иногда сутки-двое;
      // лес там (как и везде) не восстанавливается — герой на голых дровах со своего же топора рискует
      // выморозить всё в радиусе стоянки и замёрзнуть, так и не дождавшись рации. У Тамары есть печь — есть
      // и запас дров, добавлен в обыск дома (наравне с керосином на генератор и кабелем на мачту).
      { id: 'meteoHouse', type: 'meteoHouse', dx: 0, dy: 0, clear: 200, solid: 50, light: 1, mark: [':mast:', 'Кербо-2'],
        loot: ['cable', 'scrap', 'tea', 'can', 'kero', 'cable', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood'],
        t: 'Дом метеостанции «Кербо-2». Дверь подпёрта лопатой. Изнутри.' },
      { id: 'mast', type: 'mast', dx: 170, dy: -40, clear: 90, survey: 1, t: 'Мачта с флюгером. Лестница целая — можно залезть и оглядеться.' },
      { id: 'booth', type: 'booth', dx: -170, dy: 60, clear: 70, t: 'Будка Вильда. Термометры на месте: −47°. Показывают честно.' },
      { id: 'journal', type: 'journal', dx: 60, dy: 90, clear: 40, forecast: 1 },
      { id: 'tamara', type: 'spot', dx: -60, dy: 110, npc: 'tamara' },
      { id: 'meteoNote', type: 'note', dx: -110, dy: 170, t: 'Радиограмма, не отправлена: «Туре. Кербо-2. Генератор стал, керосина нет. Передатчик исправен. Наблюдения веду. Смену прошу к весне. Или хоть керосину. Т. И. Громова».' },
      { id: 'plotMeteo', type: 'plot', dx: 240, dy: 150, clear: 60 },
    ],
    plot: { n: 'Метеопост', npc: 'tamara', cost: { wood: 10, food: 3 }, yield: { tea: 1, cable: 1 }, crew: ['bich', 'tamara'], forecast: 1,
      need: g => g.flags.tamaraKero ? null : 'сначала керосин для генератора' },
    npcs: ['tamara'] },
  zimnik: { n: 'Зимник', ic: ':sled:', sym: 'road', river: 1, at: c => ({ x: riverX(c.y + 3900), y: c.y + 3900 }), r: 900,
    ground: 'zimnik', terrain: 'taiga', rules: { cold: 1, view: 1.2, spawn: 0.7 },
    trees: { dens: 0.6, kind: r => r() < 0.6 ? 0 : 1 },
    hazards: ['cracks'], desc: 'Зимник · по льду ×1,3 любому транспорту · фактория',
    objects: [
      { id: 'ural', type: 'ural', dx: 260, dy: -140, clear: 140, solid: 50, mark: [':sled:', '«Урал»'], loot: ['scrap', 'kero', 'scrap', 'cable', 'can'],
        t: '«Урал»-наливник. Замёрз в 1992-м. Водитель ушёл пешком. Говорят, дошёл.' },
      { id: 'factory', type: 'factory', dx: -330, dy: -60, clear: 180, solid: 56, light: 1, mark: [':market:', 'Фактория'],
        t: 'Фактория. Весы, прилавок, счёты. Приёмщик — у печки, ждёт пушнину.' },
      { id: 'debts', type: 'journal', dx: -250, dy: 30, clear: 30, t: 'Книга долгов. «Уркачан — 5 соболей, с 1990 г.». Приписка: «Не торопить».' },
      { id: 'efimych', type: 'spot', dx: -280, dy: 60, npc: 'efimych' },
      // вешка почтальона: сюда Вася приезжает раз в три дня
      { id: 'post', type: 'post', dx: 110, dy: 260, clear: 60, mark: [':sign:', 'Вешка почты'], t: 'Вешка с жестяным ящиком. «Почта. Раз в три дня, к полудню. Если живой — В.»' },
      { id: 'vasya', type: 'spot', dx: 170, dy: 300, npc: 'vasya' },
      { id: 'zimnikNote', type: 'note', dx: -420, dy: 120, t: 'Накладная ОРСа № 114: «Тушёнка — 40 ящ., чай — 12 ящ., соль — 6 меш. Получено: тушёнка — 4, чай — 1». Внизу: «Остальное — зимник съел». Подпись Ефимыча.' },
      { id: 'plotZimnik', type: 'plot', dx: -170, dy: -200, clear: 60 },
    ],
    plot: { n: 'Приёмный пункт', npc: 'efimych', cost: { wood: 8, food: 2 }, yield: { can: 1 }, rub: 25, crew: ['bich', 'dokha'],
      need: g => g.flags.efimDebtDone ? null : 'сначала закрой долг деда' },
    npcs: ['efimych', 'vasya'] },
  stoibishe: { n: 'Стойбище', ic: ':deer:', sym: 'chum', at: c => ({ x: c.x - 3600, y: c.y - 400 }), r: 1100,
    ground: 'stoibishe', terrain: 'taiga', camp: 420, rules: { cold: 1, view: 1, spawn: 1.2 },
    trees: { dens: 0.55, kind: r => r() < 0.55 ? 1 : 0 },
    hazards: [], desc: 'Стойбище · олени, упряжка · лайки',
    objects: [
      { id: 'chumA', type: 'chum', dx: -120, dy: -40, clear: 110, solid: 34, light: 1 },
      { id: 'chumB', type: 'chum', dx: 110, dy: -90, clear: 110, solid: 34 },
      { id: 'chumC', type: 'chum', dx: 40, dy: 110, clear: 110, solid: 34 },
      { id: 'pole', type: 'rodPole', dx: -10, dy: 20, clear: 60, rent: 'deer', mark: [':deer:', 'Родовой шест'], t: 'Родовой шест. Ленты, черепа оленей, колокольчик. Чужому не трогать.' },
      { id: 'sledsA', type: 'sleds', dx: 200, dy: 60, clear: 60 },
      // подальше от родового шеста: рядом стоя, она перехватывала бы «Упряжку» разговором (talkR 70 накрывал шест)
      { id: 'uyalan', type: 'spot', dx: -140, dy: -90, npc: 'uyalan' },
      { id: 'stoibNote', type: 'note', dx: -200, dy: 40, t: 'На бересте, углём: три оленя, над ними солнце-дылача. Рядом, другой рукой: «Нэкун, приходи. Чай есть». Бересту никто не забрал.' },
      { id: 'plotStoib', type: 'plot', dx: 230, dy: 190, clear: 60 },
    ], deer: [260, 60],
    plot: { n: 'Олени и шкуры', npc: 'uyalan', cost: { wood: 8, food: 3 }, yield: { meat: 2, hare: 1 }, crew: ['evenk', 'evenk'],
      need: g => g.flags.metUyalan ? null : 'сначала познакомься с Уялан' },
    npcs: ['uyalan'] },
};

// Поверхность под ногами → множитель скорости по способу передвижения (A7; 0 — не пройти этим способом).
// walk — пешком, ski — на лыжах (×к шагу 165), deer — упряжка (×360), buran — «Буран» (×580).
const TERRAIN = {
  core:    { n: 'участок', walk: 1, ski: TUNE.hero.skis, deer: 1, buran: 1 },   // натоптано: как до «Сибири 2.0»
  taiga:   { n: 'целина', walk: 0.7, ski: 1.05, deer: 0.8, buran: 0.9 },
  camp:    { n: 'натоптано', walk: 0.9, ski: 1.1, deer: 1, buran: 1 },
  trail:   { n: 'зимник', walk: 1, ski: 1.3, deer: 1.3, buran: 1.3 },
  naled:   { n: 'наледь', walk: 0.7, ski: 0, deer: 0.5, buran: 0.8, wet: 1 },
  gar:     { n: 'гарь', walk: 0.5, ski: 0.6, deer: 0, buran: 0.5 },
  stlanik: { n: 'стланик', walk: 0.5, ski: 0.6, deer: 0, buran: 0.5 },
  kurum:   { n: 'курумник', walk: 0.45, ski: 0, deer: 0, buran: 0 },
  golets:  { n: 'голец', walk: 0.6, ski: 1, deer: 0.8, buran: 0.9 },
};

// Строки транспорта и зон (тексты с иконками; числа — из TUNE)
const ZONE_TXT = {
  noSki: ':skis: Лыжи не идут — сняты',
  skiOn: ':skis: Снова на лыжах',
  wet: ':frost: Нога ушла в воду! Промок — к огню',
  sprain: ':hp: Подвернул ногу на камнях — медленно',
  fallWarn: ':tree: Трещит сухостой!',
  fallHit: ':hp: Задело падающим стволом',
  collapse: ':hp: Потолок балка просел — ушибся',
  survey: ':pin: Съёмка: карта открыта на три дня пути',
  vehStop: { deer: ':deer: Олени дальше не пойдут', buran: ':sled: «Буран» здесь не пройдёт' },
  noFuel: ':kero: Бензин кончился',
  deerGone: ':deer: Олени ушли домой — аренда кончилась',
  plotOpen: ':epoch: Участок открыт — люди на месте',
  plotYield: ':epoch: Участки сдали в лабаз:',
};
