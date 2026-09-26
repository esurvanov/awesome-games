'use strict';
// ================= ЛЮДИ ЗОН (A6: 8 персонажей большого мира) =================
// Формат записи — как в js/content/npcs.js (поля описаны там); здесь только люди зон.
// Место — объект-«spot» зоны (js/content/zones.js, {npc: id}); зоны нет в мире (малый мир) — нет и человека.
// Задания — js/content/quests.js; реакции деда на них — правила talk Уркачана (npcs.js).
const PEOPLE = (() => {
  const pickLine = a => a[(Math.random() * a.length) | 0];
  // начальное состояние у своего места: {x, y, state, face, step, stock} (null — зоны нет)
  const at = (id, extra) => () => {
    const s = Zones.obj(id); if (!s) return null;
    const r = PEOPLE[id], stock = r.trade ? Object.fromEntries(r.trade.goods.map(t => [t.id, t.stock])) : undefined;
    return Object.assign({ x: s.x, y: s.y, state: 'home', face: 1, step: 0, stock }, extra || {});
  };
  // распорядок: [[с часа, до часа, объект зоны, dx, dy]] — в эти часы идёт к объекту, в остальное время — домой
  const plan = (home, list) => () => {
    const h = hourOf();
    for (const [a, b, id, dx = 0, dy = 34] of list) if (h >= a && h < b) { const o = Zones.obj(id); if (o) return { x: o.x + dx, y: o.y + dy }; }
    return Zones.obj(home);
  };
  // пункт меню «участок»: открыть (узел ok) или объяснить, чего не хватает (узел no — геттер с причиной)
  const plotRun = (z, ok, no) => () => Zones.plotOpen(z) ? ok : no;
  // геттеры реплик читают G — вне игры (меню, снимок контента) отдают запасной текст
  const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
  const why = z => safe(() => Zones.plotWhy(z), 'нужен посёлок эпохи II «Заимка»') || 'сначала поговорим';
  const inSession = () => { const h = hourOf(); return TUNE.radio.sessions.some(([a, b]) => h >= a && h < b); };
  const ch = num => CHAPTERS[G.chapter] && CHAPTERS[G.chapter].num === num;

  return {
  // ---------- 🌡️ Тамара Ильинична: метеоролог станции «Кербо-2» ----------
  tamara: {
    n: 'Тамара Ильинична', i: ':radio:', look: 'tamara', h: 58, zone: 'meteo', label: 'Тамара',
    init: at('tamara'),
    // срок наблюдений — 08, 14, 20 часов: идёт к будке с термометрами; в 11 — к мачте, смотрит флюгер
    states: { home: { move: 'sched', speed: 55, at: plan('tamara', [[8, 8.7, 'booth', 20], [14, 14.7, 'booth', 20], [20, 20.7, 'booth', 20], [11, 11.6, 'mast', -30]]) } },
    talkR: 70,
    talk: [
      { quest: 'tamara_kero' },
      { if: g => ch('VII') && g.flags.tamaraKero && g.flags.mastFixed && !g.flags.expCalled, node: () => DIALOG[inSession() ? 'tam_call' : 'tam_wait'] },
      { if: g => g.flags.expCalled && !g.flags.expRescued, node: 'tam_after_call' },
      { quest: 'tamara_mast' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':storm: Прогноз', run: 'forecast', if: g => g.flags.tamaraKero },
      { t: ':trade: Меняться', trade: 1, if: g => g.flags.tamaraKero },
      { t: ':epoch: Участок: метеопост', run: 'plot', if: () => Zones.plotShow('meteo') },
      { t: 'Пока' },
    ],
    run: {
      forecast(g) { g.flags.forecast = g.day; return 'tam_forecast'; },
      plot: plotRun('meteo', 'tam_plot', 'tam_plot_no'),
    },
    acts: {
      expCall: [{ set: 'flags.expCalled' }, { fn: g => { g.flags.expCallDay = g.day; } }, { toast: ':antenna: Тура ответила: борт к Кербо-2 — утром' }],
    },
    trade: {
      pay: ['kero', 'can', 'tea'], val: { kero: 3, can: 1, tea: 1 }, cur: 'kero',
      goods: [
        { id: 'cable', i: ':cable:', n: 'Кабель', p: 2, stock: 3, out: { cable: 1 } },
        { id: 'tube', i: ':tube:', n: 'Радиолампа, запасная', p: 6, stock: 1, out: { tube: 1 }, set: 'flags.tube' },
        { id: 'dried', i: ':meat:', n: 'Вяленое мясо', p: 2, stock: 2, out: { dried: 1 } },
        { id: 'hat', i: ':hat:', n: 'Ушанка казённая', p: 4, stock: 1, gear: 'hat' },
      ],
    },
    idle: [
      [g => g.flags.expCalled, 'Тура приняла. Сказали — «ждите». Ждать я умею, я метеоролог.'],
      [g => ch('VII') && !g.flags.tamaraKero, 'Передатчик живой. Генератор мёртвый. Керосин — это как раз между ними.'],
      [g => g.plots && g.plots.meteo, 'Ваши люди снег меряют. Меряют честно. Снега от этого не меньше.'],
      [g => g.flags.mastFixed, 'Антенна стоит. Тура слышит. Иногда даже отвечает.'],
      [g => stormOn(), 'Видите? Я говорила — в среду. Сегодня, правда, пятница.'],
      [g => g.flags.rescued, 'Улетаете? Правильно. Я тут за всех посижу.'],
      [g => g.col && g.col.ep >= 2, 'Слыхала, у вас посёлок. Метеоролога не надо? Шучу. Мне и тут ветрено.'],
      [() => true, 'Пурга будет в среду. Или в четверг. Барометр тоже советский — врёт с уверенностью.'],
      [() => true, 'Смену обещали к октябрю. Октябрь, видимо, тоже задерживается.'],
      [() => true, 'Минус сорок семь. Записала. Легче не стало, но порядок есть.'],
    ],
    dialog: {
      tam_meet: { who: 'tamara', t: 'Люди? Живые? Я уж думала, опять росомаха. Тамара Ильинична, станция Кербо-2. Чаю не дам — керосина нет.',
        opts: [{ t: 'У вас передатчик?', next: 'tam_meet2' }, { t: 'Мы с вертолёта', next: 'tam_meet2' }] },
      tam_meet2: { who: 'tamara', t: 'Передатчик исправный. Генератор — нет: кончился керосин, кончился и генератор. Принесёте две канистры — будет вам и прогноз, и Тура.',
        act: 'tamAsk', opts: [{ t: 'Принесу', next: 'tam_meet3' }] },
      tam_meet3: { who: 'tamara', t: 'На буровой у вахты есть, в «Урале» на зимнике — если не слили. И лопату у двери не трогайте, она дверь держит. Изнутри.', opts: [{ t: 'Понял' }] },
      tam_kero_ok: { who: 'tamara', t: 'Затарахтел. Слышите? Музыка. Теперь я вам каждое утро буду пургу обещать — и иногда угадывать.',
        act: 'tamKero', opts: [{ t: ':storm: А прогноз?', next: 'tam_forecast' }, { t: 'Спасибо' }] },
      tam_mast: { who: 'tamara', t: 'Антенну с мачты сорвало ещё в ноябре. Кабель нужен — два куска. Без антенны передатчик — просто тёплый ящик.',
        opts: [{ t: 'Найду кабель', next: 'tam_mast2' }, { t: 'Потом', next: 'tam_mast_later' }] },
      tam_mast_later: { who: 'tamara', t: 'Потом так потом. Мачта никуда не денется. Она тут с шестьдесят третьего никуда не девается.', act: 'mastLater', opts: [{ t: '…' }] },
      tam_mast2: { who: 'tamara', t: 'На мачту я сама полезу. Мне пятьдесят два, а мачте — тридцать. Кто кого.', act: 'mastAsk', opts: [{ t: 'Договорились' }] },
      tam_mast_ok: { who: 'tamara', t: 'Висит. Ровно. Тура, если захочет, услышит. Сеанс — в восемь утра и в восемь вечера, как у всех приличных людей.',
        act: 'mastOk', opts: [{ t: 'Понял' }] },
      get tam_forecast() {
        const f = safe(() => Zones.forecast(), ':day: Журнал: до завтра пурги не ждать').replace(/^:\w+: Журнал: /, '');
        return { who: 'tamara', t: 'Барометр говорит: ' + f + '. ' + pickLine(['Барометр советский — врёт с уверенностью.', 'Я бы ему верила. Больше некому.', 'Запишите. Потом скажете, что я предупреждала.']), opts: [{ t: 'Спасибо' }] };
      },
      tam_call: { who: 'tamara', t: '«Тура, Тура, я Кербо-2. Партия номер семь у меня. Живые». …Приняли! Говорят — борт утром, к мачте. Ну вот. А вы боялись.',
        act: 'expCall', opts: [{ t: 'Живые! Приём!' }] },
      tam_wait: { who: 'tamara', t: 'Сеанс в восемь. Утра или вечера — как дойдёте. Тура до сеанса не слушает, у них тоже режим.', opts: [{ t: 'Подожду' }] },
      tam_after_call: { who: 'tamara', t: 'Борт будет утром, с девяти до полудня. Стойте у мачты. Махать не надо — снегом забросает.', opts: [{ t: 'Жду' }] },
      tam_plot: { who: 'tamara', t: 'Метеопост на две смены? Я согласна. Научу ваших снег мерить. Главное — не мерить его ногами.', opts: [{ t: 'Договорились' }] },
      get tam_plot_no() { return { who: 'tamara', t: 'Участок — дело хорошее. Но ' + why('meteo') + '. Без этого у меня тут не станция, а музей.', opts: [{ t: 'Понял' }] }; },
    },
  },

  // ---------- 🛢️ Михалыч: старший вахты на буровой ----------
  mikhalych: {
    n: 'Михалыч', i: ':scrap:', look: 'mikhalych', h: 60, zone: 'drill', label: 'Михалыч',
    init: at('mikhalych'),
    // днём — у вышки (смотрит на неё, как на начальство), вечером — у балка
    states: { home: { move: 'sched', speed: 60, at: plan('mikhalych', [[10, 12, 'rig', -40, 60], [15, 16, 'fuel', -30, 30], [19, 30, 'drillBalok', 30, 50]]) } },
    talkR: 70,
    talk: [
      { quest: 'mikh_meat' },
      { quest: 'mikh_bear' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Меняться', trade: 1 },
      { t: ':epoch: Участок: буровая', run: 'plot', if: () => Zones.plotShow('drill') },
      { t: 'Пока' },
    ],
    run: { plot: plotRun('drill', 'mikh_plot', 'mikh_plot_no') },
    trade: {
      pay: ['meat', 'fish', 'dried', 'can'], val: { meat: 1, fish: 1, dried: 1, can: 2 }, cur: 'food',
      goods: [
        { id: 'kero', i: ':kero:', n: 'Керосин', p: 3, stock: 4, out: { kero: 1 } },
        { id: 'cable', i: ':cable:', n: 'Кабель', p: 2, stock: 3, out: { cable: 1 } },
        { id: 'scrap', i: ':scrap:', n: 'Железо', p: 1, stock: 8, out: { scrap: 1 } },
        { id: 'saw', i: ':saw:', n: 'Пила «Дружба» без мотора', p: 5, stock: 1, gear: 'saw' },
      ],
    },
    idle: [
      [g => g.flags.mikhBearDone, 'Шатуна проводили? Ну всё. Теперь можно и в балке спать. А то я на вышке ночевал.'],
      [g => g.plots && g.plots.drill, 'Твои мужики солярку качают. Контора бы нам премию дала. Если бы была контора.'],
      [g => g.p.ride === 'buran', '«Буран» тянет? Ты его не гоняй. Он у нас один, как и совесть.'],
      [g => g.flags.rescued, 'Вертолёт? За вами? А за нами, значит, в следующей пятилетке.'],
      [g => g.col && g.col.ep >= 2, 'Посёлок у вас, говорят. С факторией. Я бы вахту к вам перевёл. Куда — в балок или в историю?'],
      [() => true, 'Вахта у нас с сентября. Контора, видать, тоже на вахте. Бессрочной.'],
      [() => true, 'Скважина законсервирована. Мы тоже. Ждём особого распоряжения.'],
      [() => true, 'Солярка есть. Кабель есть. Связи нет. Как в семье.'],
    ],
    dialog: {
      mikh_meet: { who: 'mikhalych', t: 'О. Живой человек и без бутылки. Не контора, значит. Михалыч. Старший. Старше тут только вышка.',
        opts: [{ t: 'Нужен керосин', next: 'mikh_meet2' }, { t: 'Вас тут много?', next: 'mikh_meet2' }] },
      mikh_meet2: { who: 'mikhalych', t: 'Трое нас. Солярки — на зиму, если не топить. Мяса — ноль. Второй месяц на макаронах, уже сами как макароны. Принеси мяса — три куска. Сочтёмся.',
        act: 'mikhAsk', opts: [{ t: 'Принесу', next: 'mikh_meet3' }] },
      mikh_meet3: { who: 'mikhalych', t: 'А мы тебе «Буран» на ход поставим. Он у нас как новый. В смысле — тоже не ездит.', opts: [{ t: 'Договорились' }] },
      mikh_meat_ok: { who: 'mikhalych', t: 'Мясо! Серёга, ставь кастрюлю. …Вот тебе две канистры и «Буран» на ходу. Заводи с подсосом, он у нас капризный, как невеста.',
        act: 'mikhMeat', opts: [{ t: 'Спасибо' }] },
      mikh_bear: { who: 'mikhalych', t: 'Шатун у балка ходит. Дверь ему не нравится — третью ночь её пробует. Проводишь его — солярки дам, сколько унесёшь. Ну, три.',
        opts: [{ t: 'Провожу', next: 'mikh_bear2' }, { t: 'Не охотник я', next: 'mikh_bear_no' }] },
      mikh_bear2: { who: 'mikhalych', t: 'Он к вашей мари ходит, по следам видно. Факел бери. Шатун огня не любит. Я тоже, но я терплю.', act: 'mikhBear', opts: [{ t: 'Понял' }] },
      mikh_bear_no: { who: 'mikhalych', t: 'И то верно. Я тоже не охотник. Я бурильщик. Бурить только нечего.', act: 'mikhBearNo', opts: [{ t: '…' }] },
      mikh_bear_ok: { who: 'mikhalych', t: 'Слыхал — нет больше шатуна. Держи три канистры и кабель. И не говори никому, что мы тут боялись. Мы не боялись. Мы бдили.',
        act: 'mikhBearOk', opts: [{ t: 'Спасибо' }] },
      mikh_plot: { who: 'mikhalych', t: 'Участок? Бери. Солярку качаем, кабель мотаем, раз в день — в ваш лабаз. План мы выполним. Мы всегда план выполняем, даже без плана.', opts: [{ t: 'Договорились' }] },
      get mikh_plot_no() { return { who: 'mikhalych', t: 'Людей дадим, не жалко. Но ' + why('drill') + '. Порядок такой. Сам придумал.', opts: [{ t: 'Понял' }] }; },
    },
  },

  // ---------- 🏪 Степан Ефимыч: приёмщик фактории на зимнике ----------
  efimych: {
    n: 'Степан Ефимыч', i: ':market:', look: 'efimych', h: 60, zone: 'zimnik', label: 'Ефимыч',
    init: at('efimych'),
    // утром — к «Уралу» (сливает, что осталось), остальное время — у прилавка
    states: { home: { move: 'sched', speed: 45, at: plan('efimych', [[9, 10, 'ural', -60, 40], [16, 16.5, 'debts', 10, 20]]) } },
    talkR: 70,
    talk: [
      { quest: 'efim_debt' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Сдать пушнину', trade: 1 },
      { t: ':epoch: Участок: приёмный пункт', run: 'plot', if: () => Zones.plotShow('zimnik') },
      { t: 'Пока' },
    ],
    run: { plot: plotRun('zimnik', 'efim_plot', 'efim_plot_no') },
    trade: {
      pay: ['hare', 'wpelt', 'sable'], cur: 'pelt',
      price: (t, g) => Math.max(1, Math.round(t.p * (g.flags.efimDebtDone ? 0.8 : 1))),
      goods: [
        { id: 'can', i: ':can:', n: 'Тушёнка', p: 2, stock: 6, out: { can: 1 } },
        { id: 'tea', i: ':tea:', n: 'Чай', p: 1, stock: 6, out: { tea: 1 } },
        { id: 'kero', i: ':kero:', n: 'Керосин', p: 4, stock: 3, out: { kero: 1 } },
        { id: 'trap', i: ':trap:', n: 'Капкан', p: 3, stock: 3, out: { trap: 1 } },
        { id: 'snare', i: ':snare:', n: 'Силки ×2', p: 1, stock: 4, out: { snare: 2 } },
        { id: 'dokha', i: ':coat:', n: 'Доха', p: 9, stock: 1, gear: 'dokha' },
        { id: 'rub', i: ':coins:', n: 'Рубли ×60 — в кассу посёлка', p: 3, stock: 5, rub: 60, d: 'касса посёлка (фактория)' },
      ],
    },
    idle: [
      [g => g.flags.efimDebtDone, 'Долг Уркачана закрыт. Первый раз в жизни закрыл чей-то долг и не расстроился.'],
      [g => g.plots && g.plots.zimnik, 'Приёмный пункт работает. Ваши сдают, я пишу. Бумага кончится — буду на бересте.'],
      [g => g.col && g.col.builds && g.col.builds.some(b => b.type === 'market' && b.done), 'У вас тоже фактория? Конкуренция. Как в Москве. Только без стрельбы. Пока.'],
      [g => g.flags.rescued, 'Улетаете — долги оставьте. Шучу. Долги у нас только у деда, и те закрыты.'],
      [() => true, 'Цены у нас твёрдые. Как рубль. То есть каждый день новые.'],
      [() => true, 'Соболь — это валюта. Рубль — это бумага. Бумагой печку топят.'],
      [() => true, 'Книга долгов у меня толще «Войны и мира». И читается так же — с конца.'],
    ],
    dialog: {
      efim_meet: { who: 'efimych', t: 'Покупатель! Или сдатчик? Лучше сдатчик. Степан Ефимыч, приёмщик. Весы поверены в восемьдесят шестом, с тех пор не врут. Почти.',
        opts: [{ t: 'Я от Уркачана', next: 'efim_meet2' }, { t: 'Что берёте?', next: 'efim_meet2' }] },
      efim_meet2: { who: 'efimych', t: 'От Уркачана? У него тут долг. Пять соболей, с девяностого. Я не тороплю — у меня в книге так и написано: «не торопить». Но три года — это уже не торопить, это забыть.',
        act: 'efimAsk', opts: [{ t: 'Закрою долг', next: 'efim_meet3' }, { t: 'Это его дело', next: 'efim_meet3' }] },
      efim_meet3: { who: 'efimych', t: 'Закроешь — и деду почёт, и тебе цена пониже. А ещё у меня мазь есть. И костыль. Вашей хромой пригодится.', opts: [{ t: 'Понял' }] },
      efim_debt_ok: { who: 'efimych', t: 'Пять соболей. Раз, два… пять. Вычёркиваю. Вот, смотри: «Уркачан — закрыто». Красиво. Держи мазь и костыль — Вере. Пусть бегает. Ну, ходит.',
        act: 'efimDebt', opts: [{ t: ':trade: Торг', trade: 1 }, { t: 'Спасибо' }] },
      efim_plot: { who: 'efimych', t: 'Приёмный пункт на двоих? Бери. Будут сдавать — будут рубли. Рубли — в кассу. Касса — в ящике. Ящик — у меня. Логика.', opts: [{ t: 'Договорились' }] },
      get efim_plot_no() { return { who: 'efimych', t: 'Пункт открыть — не шутка. Сначала ' + why('zimnik').replace(/^сначала /, '') + '. У меня всё по книге.', opts: [{ t: 'Понял' }] }; },
    },
  },

  // ---------- 🪶 Уялан: шаманка, старшая сестра Уркачана, стойбище ----------
  uyalan: {
    n: 'Уялан', i: ':sevek:', look: 'uyalan', h: 60, zone: 'stoibishe', label: 'Уялан',
    init: at('uyalan'),
    // утром — к родовому шесту (кормит огонь), вечером — к оленям
    states: { home: { move: 'sched', speed: 40, at: plan('uyalan', [[7.5, 9, 'pole', 20, 30], [17, 18.5, 'sledsA', -30, 30]]) } },
    talkR: 70,
    talk: [
      { if: g => !g.flags.metUyalan, node: 'uyal_meet', do: [{ set: 'flags.metUyalan' }] },
      { quest: 'uyal_sevek' },
      { quest: 'uyal_brother' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Меняться', trade: 1 },
      { t: ':sevek: Про сэвэки', next: 'uyal_sevek_about' },
      { t: ':epoch: Участок: стойбище', run: 'plot', if: () => Zones.plotShow('stoibishe') },
      { t: 'Пока' },
    ],
    run: { plot: plotRun('stoibishe', 'uyal_plot', 'uyal_plot_no') },
    trade: {
      pay: ['tea', 'can', 'dried'], val: { tea: 2, can: 1, dried: 1 }, cur: 'tea',
      goods: [
        { id: 'kukhl', i: ':deer:', n: 'Кухлянка', p: 6, stock: 1, gear: 'kukhl' },
        { id: 'meat', i: ':meat:', n: 'Оленина ×2', p: 1, stock: 4, out: { meat: 2 } },
        { id: 'hare', i: ':hare:', n: 'Шкурка', p: 1, stock: 4, out: { hare: 1 } },
        { id: 'skis', i: ':skis:', n: 'Лыжи, подбитые камусом', p: 5, stock: 1, gear: 'skis' },
      ],
    },
    idle: [
      [g => g.flags.urkSister && !g.flags.uyalBrotherDone, 'Брат был? Передал? Тогда иди ко мне, расскажи. Я быстро слушаю.'],
      [g => g.flags.ownDeer, 'Олени твои тебя знают. Не гони их. Орон — не «Буран», ему бензин не нужен, ему уважение нужно.'],
      [g => g.plots && g.plots.stoibishe, 'Твои люди с моими оленей пасут. Спорят, кто главный. Главный — олень.'],
      [g => g.amulets >= 6, 'Сэвэки у тебя в мешке шепчутся. Хорошо шепчутся. Значит, ты им нравишься.'],
      [g => g.flags.rescued, 'Улетаешь? Небо большое. Буга всё видит — и сверху тоже.'],
      [() => true, 'Брат говорит, ты свой. Брат всем так говорит, кто чай приносит.'],
      [() => true, 'Огонь кормить надо. Тог голодный — дом холодный.'],
      [() => true, 'Хэглэн ночью бежит — небесный лось. За ним охотник Манги. Сколько лет бегут — не догнал. Вот и ты не торопись.'],
    ],
    dialog: {
      uyal_meet: { who: 'uyalan', t: 'Дорово. Ты тот лучэ, что у моего нэкуна в зимовье живёт? Уялан я. Сестра его. Старшая — он младший, хоть и седой.',
        note: 'нэкун — младший брат (эвенк.); лучэ — русский', opts: [{ t: 'Уркачан — ваш брат?', next: 'uyal_meet2' }] },
      uyal_meet2: { who: 'uyalan', t: 'Мой. Упрямый. В восемьдесят девятом стадо волкам отдал — не отдал, не уберёг. С тех пор один живёт и волков считает. Я оленей считаю. Так и живём — оба считаем.',
        opts: [{ t: 'Можно оленей?', next: 'uyal_meet3' }] },
      uyal_meet3: { who: 'uyalan', t: 'Оленей дам в нарты — за мясо, у шеста. Насовсем — это заслужить. Духи скажут, когда.', opts: [{ t: 'Понял' }] },
      uyal_sevek: { who: 'uyalan', t: 'По тайге сэвэки раскиданы — деревянные, резные. Духи-хранители. Шесть принесёшь — пойму, что тайга тебя пускает. Тогда оленей насовсем.',
        note: 'сэвэки — духи-покровители, резные фигурки', opts: [{ t: 'Соберу', next: 'uyal_sevek2' }, { t: 'Потом', next: 'uyal_sevek_later' }] },
      uyal_sevek_later: { who: 'uyalan', t: 'Потом. Духи не торопятся. Они вообще никуда не ходят — это ты ходишь.', act: 'uyalSevekLater', opts: [{ t: '…' }] },
      uyal_sevek2: { who: 'uyalan', t: 'Не рви их, бери бережно. И себе не оставляй — сэвэки не любят, когда их прячут в рюкзак. Они любят, когда их носят.', act: 'uyalSevek', opts: [{ t: 'Хорошо' }] },
      uyal_sevek_ok: { who: 'uyalan', t: 'Шесть. Слышишь — тихо стало? Это духи сели чай пить. Бери упряжку. Двух важенок. Насовсем. Кормить лишайником, ругать — нельзя.',
        act: 'uyalSevekOk', opts: [{ t: 'Спасибо, Уялан' }] },
      uyal_sevek_about: { who: 'uyalan', t: 'Сэвэки — хозяева места. Каждый свой куст сторожит. Найдёшь — поздоровайся. Невежливого они водят кругами до самой весны.', opts: [{ t: 'Буду вежлив' }] },
      uyal_brother: { who: 'uyalan', t: 'Нэкуну скажи: сестра зовёт. Олень, что он у меня в восемьдесят девятом оставил, — живой. Старый уже. Как он.',
        note: 'нэкун — младший брат', opts: [{ t: 'Передам', next: 'uyal_brother2' }, { t: 'Сами разберётесь', next: 'uyal_brother_no' }] },
      uyal_brother2: { who: 'uyalan', t: 'Передай слово в слово. Он слова считает, как патроны.', act: 'uyalBrother', opts: [{ t: 'Слово в слово' }] },
      uyal_brother_no: { who: 'uyalan', t: 'И то. Мы тридцать лет разбираемся. Ещё тридцать — и разберёмся.', act: 'uyalBrotherNo', opts: [{ t: '…' }] },
      uyal_brother_ok: { who: 'uyalan', t: 'Сказал, что придёт? Весной? Он каждую весну говорит. Ничего. Одна весна правдой окажется.',
        act: 'uyalBrotherOk', opts: [{ t: 'Окажется' }] },
      uyal_plot: { who: 'uyalan', t: 'Участок? Мои пастухи, твои руки. Мясо и шкуры — в твой лабаз. Оленей не обижать. Обидишь — уйдут, и я уйду.', opts: [{ t: 'Договорились' }] },
      get uyal_plot_no() { return { who: 'uyalan', t: 'Рано про участок. ' + why('stoibishe').replace(/^./, c => c.toUpperCase()) + '. Олень торопливых не любит.', opts: [{ t: 'Понял' }] }; },
    },
  },

  // ---------- ✝️ Агафон: старовер, заимка под гольцом ----------
  agafon: {
    n: 'Агафон', i: ':hut:', look: 'agafon', h: 64, zone: 'golets', label: 'Агафон',
    init: at('agafon'),
    // до полудня — дрова у заимки, после — у ограды
    states: { home: { move: 'sched', speed: 45, at: plan('agafon', [[9, 12, 'zaimka', 70, 40], [15, 17, 'zaimka', -80, 70]]) } },
    talkR: 70,
    talk: [
      { if: g => g.p.ride === 'buran', node: 'agaf_buran' },
      { quest: 'agaf_fence' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Меняться', trade: 1, if: g => g.flags.agafFence },
      { t: ':person: Полечить Веру', run: 'heal', if: g => g.flags.agafFence && !g.flags.veraHealed && !g.flags.veraDead && g.vera.state === 'follow' },
      { t: 'Пока' },
    ],
    run: {
      heal(g) { if (dist2(g.vera, g.p) > 260 * 260) return 'agaf_heal_far'; g.flags.veraHealed = 1; Fx.toast(':person: Агафон перевязал Вере ногу — идёт быстрее'); return 'agaf_heal'; },
    },
    trade: {
      pay: ['scrap', 'kero', 'cable'], val: { scrap: 1, kero: 2, cable: 1 }, cur: 'scrap',
      goods: [
        { id: 'honey', i: ':food:', n: 'Мёд', p: 2, stock: 3, out: { honey: 1 }, d: 'еда + тепло' },
        { id: 'dried', i: ':meat:', n: 'Вяленое мясо', p: 1, stock: 4, out: { dried: 1 } },
        { id: 'lure', i: ':rod:', n: 'Блесна кованая', p: 2, stock: 1, gear: 'lure' },
        { id: 'sled', i: ':sled:', n: 'Нарты', p: 4, stock: 1, gear: 'sled' },
      ],
    },
    idle: [
      [g => g.flags.radioBuilt && Math.random() < 0.5, 'Ящик твой говорящий за порогом оставь. У нас и так есть с кем разговаривать.'],
      [g => g.flags.veraHealed, 'Нога у девки срастётся. Молиться за неё буду. За тебя — подумаю.'],
      [g => g.flags.agafFence, 'Ограда стоит. Бес теперь пусть через ворота ходит, как люди.'],
      [g => g.col && g.col.ep >= 2, 'Посёлок, говоришь? С факторией? Мы от такого в тридцатом году ушли. Ну, живите.'],
      [g => g.flags.rescued, 'Летите. Небо — не наше дело. Наше — земля.'],
      [() => true, 'Табаку нет? И не надо. У нас не курят. У нас терпят.'],
      [() => true, 'Сын в лес ушёл, к вечеру будет. Он у меня молчаливый. В меня.'],
      [() => true, 'Советскую власть пересидели. И эту пересидим. Дров только поболе надо.'],
    ],
    dialog: {
      agaf_buran: { who: 'agafon', t: 'Машину бесовскую за оградой глуши. Потом разговаривать будем. Ежели будем.', opts: [{ t: 'Заглушу' }] },
      agaf_meet: { who: 'agafon', t: 'Мир дому. Не мой — твой, какой уж есть. Агафон я. Табак, рация, водка — всё за порог. Сам заходи.',
        opts: [{ t: 'Помочь чем?', next: 'agaf_meet2' }, { t: 'Мы с вертолёта', next: 'agaf_meet2' }] },
      agaf_meet2: { who: 'agafon', t: 'Ограду шатун повалил. Жердей надо — восемь. Сын один не управится, а я стар спину гнуть. Принесёшь — мёдом отдарю. Мёд свой, пчела своя, в избе зимует.',
        act: 'agafAsk', opts: [{ t: 'Принесу дров', next: 'agaf_meet3' }] },
      agaf_meet3: { who: 'agafon', t: 'Руби сухостой, не живое. Живое пусть растёт — ему тоже в зиму тяжко.', opts: [{ t: 'Понял' }] },
      agaf_fence_ok: { who: 'agafon', t: 'Добрые жерди. Ровные. Не наш, а руки правильные. Держи мёд. Ешь понемногу — от него в мороз тепло.',
        act: 'agafFence', opts: [{ t: 'Спасибо, отец' }] },
      agaf_heal: { who: 'agafon', t: 'Кость цела, жила потянута. Травы наложил, дёгтем смазал. Дня три — и побежит. Ну, пойдёт.', opts: [{ t: 'Спасибо' }] },
      agaf_heal_far: { who: 'agafon', t: 'Кого лечить-то? Девку свою сюда веди, я по воздуху не лечу. Это у вас вертолёты.', opts: [{ t: 'Приведу' }] },
    },
  },

  // ---------- 🧥 Толян: бич, живёт в сгоревшем балке на гари ----------
  tolyan: {
    n: 'Толян', i: ':bich:', look: 'tolyan', h: 58, zone: 'gar', label: 'Толян',
    init: at('tolyan'),
    states: {
      // днём ходит по гари за сушняком, к вечеру — к балку
      home: { move: 'sched', speed: 65, at: plan('tolyan', [[10, 13, 'burntBalok', 220, 160], [13, 15, 'burntBalok', -260, 200]]) },
      gone: { hidden: 1 },                                   // ушёл: в посёлок или на зимник
    },
    talkR: 70,
    talk: [
      { quest: 'toly_stash' },
      { quest: 'toly_fate' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Меняться', trade: 1 },
      { t: 'Пока' },
    ],
    trade: {
      pay: ['can', 'dried', 'meat', 'fish'], val: { can: 1, dried: 1, meat: 1, fish: 1 }, cur: 'food',
      goods: [
        { id: 'scrap', i: ':scrap:', n: 'Железо «ничьё»', p: 1, stock: 5, out: { scrap: 1 } },
        { id: 'kero', i: ':kero:', n: 'Керосин «лишний»', p: 2, stock: 2, out: { kero: 1 } },
        { id: 'cable', i: ':cable:', n: 'Кабель «найденный»', p: 1, stock: 2, out: { cable: 1 } },
        { id: 'trap', i: ':trap:', n: 'Капкан «бесхозный»', p: 2, stock: 1, out: { trap: 1 } },
      ],
    },
    idle: [
      [g => g.flags.stashKnown, 'Склад показал — теперь ты соучастник. В хорошем смысле. У нас все в хорошем смысле.'],
      [g => stormOn(), 'Пурга. В пургу я не ворую. У меня принципы. И видимость плохая.'],
      [g => g.col && g.col.ep >= 1, 'Посёлок строишь? Возьми меня. Я работящий. Когда голодный.'],
      [g => g.flags.rescued, 'Вертолёт? Меня не бери. Меня в Туре ждут. С милицией.'],
      [() => true, 'Я не ворую. Я перераспределяю. Страна вон тоже перераспределяет.'],
      [() => true, 'Анатолий. Можно Толян. Можно «эй, ты». Паспорт в восемьдесят восьмом сгорел. Вместе с биографией.'],
      [() => true, 'Живу в балке пожарных. Сгорел, говоришь? Зато второй раз не сгорит. Надёжно.'],
    ],
    dialog: {
      toly_meet: { who: 'tolyan', t: 'Стой, не стреляй, я мирный. Толян. Тут живу, в балке. Балок сгорел, я — нет. Тушёнкой богат? Две банки — и я тебе такое покажу. Склад.',
        opts: [{ t: 'Какой склад?', next: 'toly_meet2' }, { t: 'Обойдусь', next: 'toly_meet2' }] },
      toly_meet2: { who: 'tolyan', t: 'Пожарных. Ну, был пожарных. Теперь мой. Ну, будет твой. Железо, керосин, консервы. Две банки — и адрес твой.', act: 'tolyAsk', opts: [{ t: 'Подумаю' }] },
      toly_stash_ok: { who: 'tolyan', t: 'Вот это разговор. Склад — на запад от балка, под брезентом, где сугроб горбом. Бери сколько надо. И деду своему… ну, ты понял.',
        act: 'tolyStash', opts: [{ t: 'Понял' }] },
      toly_fate: { who: 'tolyan', t: 'Слушай. Там на складе ещё дедово было. Из его лабаза. Я брал. Голодный был. Ты деду не говори, а? Он меня найдёт — я не найдусь.',
        opts: [{ t: 'Прикрою', next: 'toly_cover' }, { t: 'Скажу деду', next: 'toly_tell' }] },
      toly_cover: { who: 'tolyan', t: 'Человек! Вот человек! Слушай, возьми меня к себе. Дрова рубить, воду носить. Воровать не буду. Там у вас всё равно всё общее.',
        act: 'tolyCover', opts: [{ t: 'Иди к зимовью', next: 'toly_cover2' }] },
      toly_cover2: { who: 'tolyan', t: 'Иду. Если дед спросит — я с неба упал. Вместе с вами.', act: 'tolyDone', opts: [{ t: '…' }] },
      toly_tell: { who: 'tolyan', t: 'Ну и правильно. Честно. Я бы тоже сказал. Ну, не сказал бы. Пойду тогда на зимник. К Ефимычу. У него тоже есть что… перераспределить.',
        act: 'tolyTell', opts: [{ t: 'Иди', next: 'toly_tell2' }] },
      toly_tell2: { who: 'tolyan', t: 'Бывай. Балок не занимай — он с характером.', act: 'tolyDone', opts: [{ t: '…' }] },
    },
  },

  // ---------- 🎯 Братья Коченины: промысловики, избушка у наледи ----------
  kochenin: {
    n: 'Коченин', i: ':trap:', look: 'kochenin', h: 60, zone: 'naled', label: 'Коченин',
    init: at('kochenin'),
    // утром проверяет путик (уходит от избушки к лесу), вечером — дома, у печки
    states: { home: { move: 'sched', speed: 70, at: plan('kochenin', [[8, 11, 'lodge', 360, 220], [11, 13, 'lodge', -300, 260]]) } },
    talkR: 70,
    talk: [
      { quest: 'koch_wolves' },
      { quest: 'koch_peace' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Меняться', trade: 1 },
      { t: ':epoch: Участок: наледь', run: 'plot', if: () => Zones.plotShow('naled') },
      { t: 'Пока' },
    ],
    run: { plot: plotRun('naled', 'koch_plot', 'koch_plot_no') },
    trade: {
      pay: ['tea', 'can', 'dried'], val: { tea: 1, can: 2, dried: 1 }, cur: 'tea',
      goods: [
        { id: 'sable', i: ':sable:', n: 'Соболь', p: 4, stock: 3, out: { sable: 1 } },
        { id: 'trap', i: ':trap:', n: 'Капкан', p: 2, stock: 2, out: { trap: 1 } },
        { id: 'wpelt', i: ':wolf:', n: 'Шкура волка', p: 3, stock: 1, out: { wpelt: 1 } },
        { id: 'meat', i: ':meat:', n: 'Мясо', p: 1, stock: 3, out: { meat: 1 } },
      ],
    },
    idle: [
      [g => g.flags.kochPeace, 'С дедом замирились. У горелой лиственницы — граница. Соболь, правда, границ не признаёт.'],
      [g => g.flags.kochWolvesDone, 'Стаю проредил — путик ожил. Брат даже улыбнулся. Второй раз за зиму.'],
      [g => g.plots && g.plots.naled, 'Твои рыбачат на наледи. Мокрые, злые, с рыбой. Всё как положено.'],
      [g => g.pack, 'Слышишь? Стая. Опять на путик. Нам бы ещё ружьё. И брата потрезвее.'],
      [g => g.flags.rescued, 'Улетаешь? Путик деду привет передай. Лично он не примет.'],
      [() => true, 'Путик дедов? А соболь об этом знает?'],
      [() => true, 'Нас двое, Коченины. Я старший, брат — молчаливый. Сейчас на путике. Или спит. У него это одно и то же.'],
      [() => true, 'Сорок капканов. Тридцать девять пустых. Один с зайцем. Заяц доволен — тепло.'],
    ],
    dialog: {
      koch_meet: { who: 'kochenin', t: 'Чужой. С ружьём не ходишь — уже хорошо. Коченин. Нас двое, брат на путике. Ты от Уркачана? Он тебя против нас не настраивал?',
        opts: [{ t: 'Про вас не говорил', next: 'koch_meet2' }, { t: 'Настраивал', next: 'koch_meet2' }] },
      koch_meet2: { who: 'kochenin', t: 'Стая на путике. Трёх волков из капканов с приманкой выели. Ты вроде с огнём дружишь. Отгони трёх — соболями отдам. Двумя. Хорошими.',
        opts: [{ t: 'Отгоню', next: 'koch_meet3' }, { t: 'Сами', next: 'koch_meet_no' }] },
      koch_meet3: { who: 'kochenin', t: 'Бей ночью у огня, днём они умные. Трёх хватит — остальные поймут.', act: 'kochWolves', opts: [{ t: 'Понял' }] },
      koch_meet_no: { who: 'kochenin', t: 'Сами так сами. Нам не привыкать. Мы вообще с восемьдесят пятого сами.', act: 'kochNo', opts: [{ t: '…' }] },
      koch_wolves_ok: { who: 'kochenin', t: 'Три. Считал? Я считал. Путик чистый. Держи двух соболей и капкан. Капкан счастливый — брат в него один раз сам попал.',
        act: 'kochWolvesOk', opts: [{ t: 'Спасибо' }] },
      koch_peace: { who: 'kochenin', t: 'Слушай. Ты с дедом в ладах. Скажи ему: Коченины граница по горелой лиственнице согласны. Нам его путик не нужен, нам нужно, чтоб не стрелял.',
        opts: [{ t: 'Скажу', next: 'koch_peace2' }, { t: 'Сами говорите', next: 'koch_peace_no' }] },
      koch_peace_no: { who: 'kochenin', t: 'Сами. Ага. Мы ему «здравствуй» — он нам дробью. Такой у нас разговор.', act: 'kochPeaceNo', opts: [{ t: '…' }] },
      koch_peace2: { who: 'kochenin', t: 'Он тебя послушает. Нас он не слушает с восемьдесят седьмого. Мы тогда у него… ну, это давно было.', act: 'kochPeaceAsk', opts: [{ t: 'Понял' }] },
      koch_peace_ok: { who: 'kochenin', t: 'Согласен? Сам сказал? Ну дед. Ну старый. Держи соболя — за посольство. И деду передай: пусть в гости. С чаем.',
        act: 'kochPeaceOk', opts: [{ t: 'Передам' }] },
      koch_plot: { who: 'kochenin', t: 'Рыбный промысел на наледи? Бери. Лунки покажу, где вода не выходит. Где выходит — сам найдёшь, ногой.', opts: [{ t: 'Договорились' }] },
      get koch_plot_no() { return { who: 'kochenin', t: 'Участок дам — не жалко. Но ' + why('naled') + '. Сначала дело, потом участок.', opts: [{ t: 'Понял' }] }; },
    },
  },

  // ---------- ✉️ Вася: почтальон на «Буране», зимник, раз в три дня ----------
  vasya: {
    n: 'Вася', i: ':log:', look: 'vasya', h: 60, zone: 'zimnik', label: 'Вася',
    init: at('vasya', { state: 'road' }),
    states: {
      post: { move: 'face' },                               // у вешки: с 09 до 14 каждого третьего дня
      road: { hidden: 1 },                                  // в пути по зимнику
    },
    // расписание: дни 3, 6, 9… с 09:00 до 14:00 стоит у вешки
    tick(g, st) {
      const h = hourOf(), here = g.day % 3 === 0 && h >= 9 && h < 14;
      const want = here ? 'post' : 'road';
      if (st.state !== want && !(UI.modal() && st.state === 'post')) {
        st.state = want;
        if (here && Zones.idAt(g.p.x, g.p.y) === 'zimnik') Fx.toast(':sled: Треск мотора — почта на вешке');
      }
    },
    talkR: 70,
    talk: [
      { quest: 'vasya_letter' },
      { say: { idle: 'any' }, menu: 1 },
    ],
    menu: [
      { t: ':trade: Меняться', trade: 1 },
      { t: ':hut: Подвезти до зимовья', run: 'ride', if: g => g.npcs.vasya.rideDay !== g.day && !g.p.ride },
      { t: 'Пока' },
    ],
    run: {
      // подвоз: полчаса по зимнику, герой и Вера — у двери избы (транспорт героя остаётся на месте)
      ride(g, st) {
        st.rideDay = g.day;
        const c = Zones.camp(ZONES.core), p = g.p;
        g.time += CYCLE / 48;
        p.x = c.x; p.y = c.y; p.lx = p.x; p.ly = p.y; p.sx = p.x - 30; p.sy = p.y; p.vx = p.vy = 0; p.action = null;
        if (g.vera && g.vera.state === 'follow') { g.vera.x = p.x - 30; g.vera.y = p.y + 10; }
        g.wolves = g.wolves.filter(w => dist2(w, p) < 900 * 900); if (!g.wolves.length) g.pack = null;
        World.reveal(); GFX.recenter();
        return 'vasya_rode';
      },
    },
    trade: {
      pay: ['hare', 'wpelt', 'sable'], cur: 'pelt',
      goods: [
        { id: 'kero', i: ':kero:', n: 'Бензин (он же керосин)', p: 3, stock: 2, out: { kero: 1 } },
        { id: 'tea', i: ':tea:', n: 'Чай грузинский', p: 1, stock: 3, out: { tea: 1 } },
        { id: 'can', i: ':can:', n: 'Тушёнка', p: 2, stock: 3, out: { can: 1 } },
      ],
    },
    idle: [
      [g => g.flags.vasyaLetter, 'Письмо Семёныча отвёз. Галя… ладно. Отвёз. Лично в руки.'],
      [g => g.flags.rescued, 'Вертолёт за вами? Везёт. А я на «Буране». Мне тоже везёт — пока заводится.'],
      [g => g.col && g.col.ep >= 2, 'У вас посёлок? Значит, почту к вам тоже носить. Раз в три дня. Если живой.'],
      [() => true, 'Писем вам нет. Есть газета за ноябрь. Там пишут, что всё будет хорошо.'],
      [() => true, 'Маршрут: Тура — фактория — стойбище — обратно. Двести километров. Зарплата — на один бак.'],
      [() => true, 'Раз в три дня, к полудню. Опоздаешь — оставлю в ящике. Ящик не ворует. В отличие от.'],
    ],
    dialog: {
      vasya_meet: { who: 'vasya', t: 'Здорово! Вася, почта. Ты откуда такой? С вертолёта? Который упал? Про вас в Туре говорят. Говорят — живые. Я говорю — посмотрим.',
        act: 'vasyaMet', opts: [{ t: 'Живые', next: 'vasya_meet2' }] },
      vasya_meet2: { who: 'vasya', t: 'Письма возить могу. Туда — бесплатно, обратно — как получится. Если есть что передать — давай, пока я не уехал.', opts: [{ t: 'Понял' }] },
      vasya_letter_ok: { who: 'vasya', t: 'Семёныча письмо? Гале? …Отвезу. Сам. Не в ящик — в руки. На вот, керосину тебе. И газету. Читай, там про нас ничего.',
        act: 'vasyaLetter', opts: [{ t: 'Спасибо, Вася' }] },
      vasya_rode: { who: 'vasya', t: 'Приехали. Распишись. Шучу — расписываться не в чем, квитанции кончились в восемьдесят девятом.', opts: [{ t: 'Спасибо' }] },
    },
  },
  };
})();

// в общий список персонажей и диалогов (узлы-геттеры остаются геттерами)
Object.assign(NPCS, PEOPLE);
for (const n of Object.values(PEOPLE)) if (n.dialog) Object.defineProperties(DIALOG, Object.getOwnPropertyDescriptors(n.dialog));
