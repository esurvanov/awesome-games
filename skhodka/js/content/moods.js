// ═══ НАСТРОЕНИЕ НА ВЕЧЕР ═══
// С чем человек пришёл в субботу. Сдвигает батарейку, время ухода, любимые/больные темы и стили.
// Без политики: тревога — про работу, деньги и документы; радость — про работу, ДР, переезд.
//
// MOODS[] — {
//   id, title (1–2 слова), icon
//   weight        доля
//   energy        стартовая социальная батарейка 0..1 (сколько разговора выдержит)
//   leaveShift    сдвиг времени ухода, часы (−1 — уйдёт на час раньше, +1 — досидит)
//   likeTopics[]  темы, которые сейчас в радость (+ к реакции)       ⊂ TOPICS
//   hateTopics[]  темы, которые сейчас больно трогать (→ «bad»)       ⊂ TOPICS
//   likes[]       стили, которые сейчас особенно заходят             ⊂ STYLES
//   dislikes[]    стили, которые сейчас бесят                        ⊂ STYLES
//   сверх схемы:
//   tell          как видно со стороны, 2–4 слова
//   reasons[]     почему такое настроение (2–4 слова; раскрывается при «open»)
//   openLines[]   реплики, когда человек открывается (reaction open, до реплик темы; {name} {job} {topic})
//   drink         множитель «пойду возьму ещё» (1 — обычно)
// }
'use strict';
L.def('content/moods', () => {
const MOODS = [
  { id: 'chill', title: 'Расслаблен', icon: 'sun', weight: 2.2, energy: 0.8, leaveShift: 0.5,
    likeTopics: ['sea', 'food', 'travel', 'games'], hateTopics: [],
    likes: ['joke', 'treat', 'dream'], dislikes: [],
    tell: 'Улыбается, откинулся', reasons: ['просто суббота', 'выспался', 'сдал релиз'],
    openLines: ['Слушай, как же хорошо, что тут можно просто посидеть.', 'Неделя была нормальная, редкость.', 'Утром купался, днём спал. Идеальная суббота.'],
    drink: 1.1 },
  { id: 'tired', title: 'Устал', icon: 'battery-low', weight: 2.0, energy: 0.45, leaveShift: -1,
    likeTopics: ['food', 'sea', 'pets'], hateTopics: ['jobs', 'product'],
    likes: ['listen', 'treat', 'wait'], dislikes: ['argue', 'facts'],
    tell: 'Зевает, трёт глаза', reasons: ['дедлайн в пятницу', 'три созвона подряд', 'не спал из-за соседей'],
    openLines: ['Я еле дошёл, честно. Неделя выжала.', 'Сегодня без умных разговоров, ладно?', 'Посижу чуть-чуть и спать.'],
    drink: 1.2 },
  { id: 'anxious', title: 'Тревожится', icon: 'cloud-rain', weight: 1.4, energy: 0.55, leaveShift: -0.5,
    likeTopics: ['vnzh', 'banks', 'jobs'], hateTopics: ['crypto', 'startup'],
    likes: ['help', 'listen', 'facts'], dislikes: ['joke', 'argue'],
    tell: 'Листает телефон', reasons: ['сокращения в команде', 'продление ВНЖ', 'карта не работает', 'деньги тают'],
    openLines: ['У нас в команде сокращения, я жду, кто следующий.', 'Мне продлевать документы, и я не сплю.', 'Банк заблокировал карту, неделю разбираюсь.', 'Подушка тает, а офферов нет.'],
    drink: 1.0 },
  { id: 'festive', title: 'Празднует', icon: 'party', weight: 1.0, energy: 1.0, leaveShift: 1,
    likeTopics: ['jobs', 'travel', 'food', 'music'], hateTopics: [],
    likes: ['praise', 'treat', 'invite', 'joke'], dislikes: ['wait', 'argue'],
    tell: 'Сияет, угощает', reasons: ['новая работа', 'день рождения', 'получил ВНЖ', 'закрыл сделку'],
    openLines: ['У меня сегодня праздник, я угощаю!', 'Получил оффер! Не верю до сих пор.', 'Мне сегодня тридцать, так что считай, ты на ДР.', 'Наконец получил карточку ВНЖ, отмечаем.'],
    drink: 1.5 },
  { id: 'lonely', title: 'Скучает', icon: 'moon', weight: 1.0, energy: 0.7, leaveShift: 0.5,
    likeTopics: ['kids', 'pets', 'travel', 'city'], hateTopics: [],
    likes: ['listen', 'ask', 'invite'], dislikes: ['facts'],
    tell: 'Один за столом', reasons: ['семья уехала', 'друзья разъехались', 'первый месяц один'],
    openLines: ['Мои на месяц уехали к бабушке, дома тихо до звона.', 'Все знакомые разъехались, вот пришёл к вам.', 'Я тут почти никого не знаю, если честно.'],
    drink: 1.0 },
  { id: 'burnout', title: 'Выгорел', icon: 'ash', weight: 1.0, energy: 0.4, leaveShift: -0.5,
    likeTopics: ['sea', 'sport', 'travel', 'music'], hateTopics: ['ai', 'product', 'jobs'],
    likes: ['dream', 'listen', 'wait'], dislikes: ['facts', 'argue', 'help'],
    tell: 'Смотрит в стену', reasons: ['пятый год без отпуска', 'проект в никуда', 'две работы сразу'],
    openLines: ['Я не хочу больше писать код. Хочу выращивать мандарины.', 'Взял бы отпуск, да непонятно, от чего отдыхать.', 'Работаю на двух работах и ни одну не люблю.'],
    drink: 1.3 },
  { id: 'euphoric', title: 'Эйфория новичка', icon: 'sparkle', weight: 0.8, energy: 0.95, leaveShift: 0.5,
    likeTopics: ['city', 'sea', 'food', 'georgian', 'vnzh'], hateTopics: [],
    likes: ['ask', 'praise', 'invite', 'help'], dislikes: ['argue'],
    tell: 'Всё фотографирует', reasons: ['неделю в Батуми', 'первый раз на сходке', 'увидел море'],
    openLines: ['Я тут неделю, и мне всё нравится! Даже ливень!', 'Первый раз на сходке, я немного волнуюсь.', 'Тут море в пяти минутах, вы понимаете?!'],
    drink: 1.0 },
  { id: 'annoyed', title: 'Раздражён', icon: 'storm', weight: 0.9, energy: 0.6, leaveShift: -0.5,
    likeTopics: ['city', 'games', 'food'], hateTopics: ['marketing', 'crypto'],
    likes: ['joke', 'treat', 'listen'], dislikes: ['praise', 'dream', 'invite'],
    tell: 'Хмурится, морщится', reasons: ['час в пробке', 'стробоскоп в глаза', 'таксист завёз не туда', 'соседи сверлят'],
    openLines: ['Час стоял в пробке на Руставели. Час!', 'Этот стробоскоп мне сейчас мозг выжжет.', 'Таксист отвёз меня в другой SushiGO. Их два, оказывается.'],
    drink: 1.2 },
  { id: 'seeking', title: 'Ищет себя', icon: 'compass', weight: 0.9, energy: 0.7, leaveShift: 0,
    likeTopics: ['travel', 'startup', 'ai', 'design'], hateTopics: [],
    likes: ['dream', 'ask', 'share'], dislikes: ['facts'],
    tell: 'Задаёт странные вопросы', reasons: ['думает уйти из айти', 'не знает, где жить', 'хочет своё'],
    openLines: ['Думаю, может, вообще уйти из айти. В кофейню.', 'Не понимаю, остаться тут или ехать дальше.', 'Хочу делать своё, но не знаю что.'],
    drink: 1.0 },
];
return { MOODS };
});
