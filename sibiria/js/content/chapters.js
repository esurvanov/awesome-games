'use strict';
// ================= ГЛАВЫ, КОНЦОВКИ, МЕТКИ КОМПАСА =================
// Глава = одна запись. Исполнитель — Story.chapterTick (js/story.js): все цели главы закрыты (alt — не обязательна)
// → следующая глава: UI.chapter, onEnter, чекпоинт.
// Сюжетная схема (SPEC-world §9): I ─▶ II ─▶ III ─▶ IV ─┬─▶ вертолёт: A / B
//                                                   ├─ D-цели, «остаёмся» ─▶ V Промысел ─▶ VI Зимовка ─▶ D
//                                                   └─ вертолёт не прилетел ─▶ VII Экспедиция ─▶ E (не успел — C)
// Поля: n, ic, num — название, иконка, номер; goals — цели HUD {ic, t, ok(g), at — ключ метки (MARKERS | 'npc:id' |
//   'zone:id' | 'obj:id', js/story.js markAt), alt, show(g)}; next — номер следующей главы (по умолчанию — по списку;
//   null — только концовкой); end — концовка, когда цели главы закрыты (ветки V–VII);
//   threat — угрозы главы для директора и погоды {rate — бюджет/с, peak — потолок напряжения, wolves — размер стаи,
//   storm — длительность пурги, игровые с (через HOUR; 0 — без пурги)}; onEnter — операции при входе (Story.run);
//   softDeath — «мягкая» смерть (глава I: дед дотащил); marker(g) — метка компаса поверх целей.

// «сюжетные» числа и правила концовок
const STORY = {
  dEp: 2, dPop: 6,       // концовка D: посёлок эпохи III «Промысел» и 6 человек
  lastDay: 8,            // на рассвете 8-го дня без спасения — конец (C или D)
  heliLastDay: 7,        // вертолёт, упущенный 7-го дня, — последний
  heli: { from: 9, to: 12, t: 60, snd: 2.2, waitH: 20 }, // окно прилёта, сколько кружит, через сколько часов после связи
  rescueT: 5,            // от «заметили» до финала, с
  rescueEnding: g => !g.flags.veraDead && g.vera.state !== 'tail' && g.urk.respect >= 2 ? 'A' : 'B',
  // без вертолёта: посёлок готов — глава V (промысел), иначе — VII (поход к метеостанции); малый мир без зон — старые концовки
  noHeli: g => Story.colonyReady() ? (ZONES.drill.active ? { chapter: 'V' } : 'D') : (ZONES.meteo.active ? { chapter: 'VII' } : 'C'),
  expDays: 4,            // глава VII: столько суток на поход; не успел — концовка C
  bigStorm: { at: 12, len: 0.42 }, // глава VI: большая пурга назавтра к 12:00, длится 0,42 суток (~10 ч)
  winter: { wood: 150, food: 40 }, // глава VI: запас в лабазе к пурге (баланс: 10–15 мин на посёлке эпохи III+)
};

// вторая ветка (концовка D): посёлок, который переживёт зиму без вертолёта.
// В HUD появляется при провале вертолёта или с 5-го дня (alt — не блокирует главу).
const padDone = () => !!(G && G.col && G.col.builds.some(b => b.type === 'pad' && b.done));
const CHAPTERS = (() => {
  const D_GOALS = [
    { ic: ':epoch:', t: 'Или: эпоха III «Промысел»', ok: g => g.col && g.col.ep >= STORY.dEp, at: 'hut', alt: 1, show: g => g.flags.heliMiss || g.day >= 5 || (g.col && g.col.ep >= 1) },
    { ic: ':people:', t: `Или: ${STORY.dPop} человек к 7-му дню`, ok: g => g.col && Colony.pop() >= STORY.dPop, at: 'hut', alt: 1, show: g => g.flags.heliMiss || g.day >= 5 || (g.col && g.col.ep >= 1) },
  ];
  return [
    { n: 'Обломки', ic: ':heli:', num: 'I',
      threat: { rate: 0.6, peak: 55, wolves: 2, storm: 0 },
      goals: [
        { ic: ':hut:', t: 'Найти зимовье', ok: g => g.flags.hutFound, at: 'hut' },
        { ic: ':scrap:', t: 'Железо ×3', ok: g => g.stats.scrap >= 3, at: 'cockpit' },
        { ic: ':log:', t: 'Бортжурнал', ok: g => g.notes.log, at: 'note:log' },
        { ic: ':fire:', t: 'Растопить печь', ok: g => g.flags.stoveLit, at: 'stove' },
        { ic: ':sleep:', t: 'Пережить ночь', ok: g => g.flags.slept || g.day >= 2 && hourOf() >= 7.5, at: 'bed' },
      ],
      // смерть в главе I — не конец: дед дотащил до избы, отпоил чаем, забрал половину дров
      softDeath: { hp: 50, warm: 70, food: 35, skip: 1 / 8, fuel: 4.5 * HOUR, woodKeep: 0.5,
        card: [':evenk:', 'Уркачан дотащил', 'Чаем отпоил. Ворчал. Дров половину забрал — за доставку.'] } },
    { n: 'Уркачан', ic: ':evenk:', num: 'II',
      threat: { rate: 0.8, peak: 65, wolves: 3, storm: 1.75 * HOUR },
      onEnter: [{ known: 'tail' }],
      goals: [
        { ic: ':evenk:', t: 'Встретить деда', ok: g => g.flags.metUrk, at: 'urk' },
        { ic: ':hare:', t: '2 шкурки деду', ok: g => g.flags.urkPelts, at: 'urk' },
        { ic: ':quartz:', t: 'Кварц из кабины', ok: g => g.flags.quartz, at: 'cockpit' },
        { ic: ':person:', t: 'Вера в зимовье', ok: g => g.vera.state === 'hut' || g.vera.state === 'dead', at: 'vera' },
      ] },
    { n: 'Стая', ic: ':wolf:', num: 'III',
      threat: { rate: 1.0, peak: 78, wolves: 4, storm: 2.5 * HOUR },
      onEnter: [{ known: 'polynya' }],
      goals: [
        { ic: ':battery:', t: 'Зарядить аккумулятор', ok: g => g.charge >= 100 || g.flags.radioBuilt, at: 'battery' },
        { ic: ':tube:', t: 'Радиолампа', ok: g => g.flags.tube, at: 'polynya' },
        { ic: ':antenna:', t: 'Антенна', ok: g => Inv.has('antenna', true) || g.flags.radioBuilt, at: 'bench' },
        { ic: ':radio:', t: 'Собрать рацию', ok: g => g.flags.radioBuilt, at: 'bench' },
        { ic: ':wolf:', t: 'Пережить осаду (ночь 3-го дня)', ok: g => g.flags.siegeDone, at: 'hut' },
        ...D_GOALS,
      ] },
    { n: 'Сигнал', ic: ':antenna:', num: 'IV',
      threat: { rate: 1.1, peak: 88, wolves: 4, storm: 3.25 * HOUR },
      // исправление: глава IV начинается ночью (после осады) — шатун выходит не раньше следующей ночи
      onEnter: [{ known: 'mar' }, { fn: () => Bear.respite() }],
      goals: [
        { ic: ':radio:', t: 'Связь 07:30 / 19:30', ok: g => g.flags.contact, at: 'bench' },
        { ic: ':pad:', t: 'Площадка на мари', ok: g => padDone(), at: 'mar' },
        { ic: ':wood:', t: '3 кучи на мари по 4', ok: g => g.stacks.every(s => s.wood >= 4 || s.lit > 0), at: 'mar' },
        { ic: ':heli:', t: 'Зажечь при гуле', ok: g => g.flags.rescued, at: 'mar' },
        ...D_GOALS,
      ],
      // связь есть, а кучи не готовы — компас на марь
      marker: g => g.flags.contact && !g.stacks.every(s => s.wood >= 4 || s.lit) ? POI.mar : null,
      next: null }, // глава IV закрывается вертолётом (A/B) или развилкой без него (V / VII)
    // ---------- ветка «посёлок» (A5, вариант «в»): промысловые участки → зимовка → D ----------
    { n: 'Промысел', ic: ':epoch:', num: 'V',
      threat: { rate: 0.9, peak: 70, wolves: 3, storm: 2.25 * HOUR },
      onEnter: [{ dialog: 'prom_start' }, { fn: g => { for (const id of Zones.plotIds()) if (!g.zoneSeen[id]) g.zoneSeen[id] = 2; } }],
      goals: [
        { ic: ':scrap:', t: 'Участок: буровая', ok: g => !!(g.plots && g.plots.drill), at: 'obj:plotDrill' },
        { ic: ':deer:', t: 'Участок: стойбище', ok: g => !!(g.plots && g.plots.stoibishe), at: 'obj:plotStoib' },
        { ic: ':radio:', t: 'Участок: метеостанция', ok: g => !!(g.plots && g.plots.meteo), at: 'obj:plotMeteo' },
        { ic: ':epoch:', t: 'Эпоха IV «Посёлок»', ok: g => g.col && g.col.ep >= 3, at: 'hut' },
        { ic: ':coins:', t: 'Или: участок на зимнике', ok: g => !!(g.plots && g.plots.zimnik), at: 'obj:plotZimnik', alt: 1 },
        { ic: ':fish:', t: 'Или: участок на наледи', ok: g => !!(g.plots && g.plots.naled), at: 'obj:plotNaled', alt: 1 },
      ],
      next: 'VI' },
    { n: 'Зимовка', ic: ':storm:', num: 'VI',
      threat: { rate: 1.0, peak: 80, wolves: 4, storm: 0 },
      onEnter: [{ dialog: 'winter_start' }, { fn: g => {
        const B = STORY.bigStorm, a = tAt(g.day + 1, B.at);
        g.storm = { a, b: a + CYCLE * B.len, omen: 0, big: 1 };
        if (g.flags.tamaraKero || (g.plots && g.plots.meteo)) setTimeout(() => Fx.toast(':storm: Прогноз Тамары: большая пурга завтра к 12:00'), 1500);
      } }],
      goals: [
        { ic: ':wood:', t: `Дров в лабазе ×${STORY.winter.wood}`, ok: g => !!g.flags.winterWood, at: 'hut' },
        { ic: ':food:', t: `Еды в лабазе ×${STORY.winter.food}`, ok: g => !!g.flags.winterFood, at: 'hut' },
        { ic: ':storm:', t: 'Пережить большую пургу', ok: g => !!g.flags.bigStormDone, at: 'hut' },
      ],
      end: 'D' },
    // ---------- ветка «без вертолёта» (A5, из варианта «а»): поход к передатчику Тамары → E ----------
    { n: 'Экспедиция', ic: ':radio:', num: 'VII',
      threat: { rate: 1.0, peak: 80, wolves: 3, storm: 2 * HOUR },
      onEnter: [{ dialog: 'exp_start' }, { fn: g => { g.flags.expDay = g.day; if (!g.zoneSeen.meteo) g.zoneSeen.meteo = 2; } }],
      goals: [
        { ic: ':food:', t: 'Припасы: еды ×4 с собой', ok: g => !!g.flags.expPacked, at: 'hut' },
        { ic: ':person:', t: 'Вера — в путь', ok: g => !!(g.flags.veraDead || g.vera.state === 'follow' || g.flags.expArrived), at: 'vera' },
        { ic: ':radio:', t: 'Дойти до метеостанции', ok: g => !!g.flags.expArrived, at: 'zone:meteo' },
        { ic: ':kero:', t: 'Керосин Тамаре ×2', ok: g => !!g.flags.tamaraKero, at: 'npc:tamara' },
        { ic: ':cable:', t: 'Мачта: кабель ×2', ok: g => !!g.flags.mastFixed, at: 'npc:tamara' },
        { ic: ':antenna:', t: 'Сеанс с Турой 08:00 / 20:00', ok: g => !!g.flags.expCalled, at: 'npc:tamara' },
        { ic: ':heli:', t: 'Борт у мачты', ok: g => !!g.flags.expRescued, at: 'obj:mast' },
        { ic: ':deer:', t: 'Или: упряжка у Уялан — быстрее', ok: g => !!(g.veh && g.veh.deer), at: 'npc:uyalan', alt: 1 },
      ],
      end: 'E' },
  ];
})();

// Метки компаса и мини-карты: ключ цели (goal.at, quest.marker) → точка мира или null (ещё не известно).
// Внутри избы — сама точка (печь, верстак…), снаружи — дверь избы.
const MARKERS = (() => {
  const door = () => ({ x: HUT.x, y: HUT_IN.y1 + 40 });
  const hutPt = x => G.p.inside ? x : door();
  return {
    hut: door,
    cockpit: () => POI.cockpit,
    'note:log': () => NOTES.log,
    stove: () => hutPt(SPOT.stove),
    bed: () => hutPt(SPOT.bed),
    bench: () => hutPt(SPOT.bench),
    urk: g => g.urk.state === 'away' ? null : g.urk,
    vera: g => g.vera.state === 'tail' ? (g.known.tail ? POI.tail : null) : hutPt(SPOT.veraBed),
    battery: g => Inv.has('battery', true) || g.chest.battery ? hutPt(SPOT.stove) : g.known.tail ? POI.tail : null,
    polynya: g => g.known.polynya ? POI.polynya : null,
    mar: g => g.known.mar ? POI.mar : null,
  };
})();

const DEATH = {
  cold: [':frost:', 'Замёрз', 'Мороз не злой — он честный. Держись ближе к огню, ушанка и доха режут холод.'],
  food: [':food:', 'Истощение', 'Пустой живот не греет. Зайцы и рыба, а у огня еда сытнее вдвое.'],
  wolf: [':wolf:', 'Волки', 'Стая ждала, когда кончатся дрова. Волки боятся огня и факела. Бей того, кто припал к земле.'],
  bear: [':bear:', 'Шатун', 'Хозяин тайги не любит факел. Тонкий лёд — его враг.'],
};
const ENDINGS = {
  A: [':heli:', 'Все домой', 'Вертолёт сел на марь. Вера машет Уркачану. Дед не машет — просто курит. Потом всё-таки поднимает руку. Один раз.'],
  B: [':heli:', 'Один', 'Спасли. В вертолёте тепло и тихо. Слишком тихо. Бортмеханик молча отдаёт свой термос.'],
  D: [':people:', 'Новый посёлок', 'Вертолёт так и не пришёл. А посёлок стоит: дым из труб, лайки, фактория. Весной сюда приедет почта. Дед говорит — тайга разрешила.'],
  C: [':tree:', 'Тайга приняла', 'Вертолёт не пришёл. Уркачан принёс вторые лыжи: «Весной выйдем. Вместе». Хэглэн — небесный лось — покажет дорогу.'],
  E: [':radio:', 'Кербо-2', 'Дошли. Тамара Ильинична отстучала Туре: «Партия семь, живые». Через сутки у мачты сел Ми-8. Уркачан проводил до стойбища и повернул обратно — путик сам себя не проверит.'],
};
