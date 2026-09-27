// ═══ АРХЕТИПЫ ПОВЕДЕНИЯ: как человек ведёт себя в зале ═══
// Когда приходит, сколько сидит, где стоит, с кем. Независим от роли (кем работает) и склада (как говорить).
// Узнаётся издалека — по `tell` (поза/место/первая реплика). Часть архетипов пишет в чат (CHAT.during,
// поле arch) — встретить их у входа = быстрое знакомство (TUNING.ladder.meetBonus).
//
// ARCHETYPES[] — {
//   id, title (1–3 слова), icon
//   weight    доля среди обычных гостей
//   arrive    [h0, h1] — окно прихода, часы вечера (19..25)
//   stay      [min, max] — сколько часов сидит (потом уходит; MOODS.leaveShift сдвигает)
//   zones[]   где предпочитает быть — id зон LAYOUT (первая — вероятнее)
//   group     [min, max] — сколько людей вокруг ему комфортно
//   traits    { social, open, trust, pace, group } — базовые шкалы 0..1 (MINDS.traits — поправки)
//   tell      как узнать: поза/место/первая реплика, 2–5 слов
//   сверх схемы:
//   pose      поза по умолчанию (render/people): 'stand'|'sit'|'sitSofa'|'phone'|'drink'
//   first     первая реплика при знакомстве (reaction hello, до общих) — {name} {job}
//   since     сколько в Батуми (id из ORIGINS.since, content/names), null — как у всех
//   pair      true — приходит вдвоём (второй — тот же архетип, общий стол; «мы с женой»)
//   bias      { roles:{id:×}, moods:{id:×}, needs:{id:×}, offers:{id:×}, topics:[id] } — сдвиги выбора
//   rare      true — не больше одного за вечер
// }
'use strict';
L.def('content/archetypes', () => {
const ARCHETYPES = [
  { id: 'newbie', title: 'Новичок у входа', icon: 'door', weight: 1.4,
    arrive: [19.3, 21.5], stay: [1.5, 3], zones: ['entrance', 'street', 'bar'], group: [1, 3],
    traits: { social: 0.3, open: 0.7, trust: 0.6, pace: 0.4, group: 0.3 },
    tell: 'Мнётся у двери', pose: 'phone', since: 'week',
    first: 'Привет! А это верное место? Сходка айтишников тут?',
    bias: { moods: { euphoric: 4, anxious: 1.5 }, needs: { advice: 4, flat: 2 }, topics: ['city', 'vnzh', 'banks'] } },
  { id: 'oldtimer', title: 'Старожил', icon: 'owl', weight: 1.3,
    arrive: [19.0, 20.5], stay: [3, 5], zones: ['long', 'entrance', 'bar'], group: [3, 8],
    traits: { social: 0.6, open: 0.6, trust: 0.5, pace: 0.4, group: 0.7 },
    tell: 'Здоровается с барменом', pose: 'sitSofa', since: '2022',
    first: 'О, новое лицо. Я тут с двадцать второго, спрашивай.',
    bias: { offers: { advice: 5, flat: 1.5, exchange: 1.5 }, moods: { chill: 2 }, topics: ['vnzh', 'banks', 'food', 'city'] } },
  { id: 'soul', title: 'Душа стола', icon: 'sun', weight: 1.0,
    arrive: [19.5, 21], stay: [3.5, 5.5], zones: ['long', 'round'], group: [5, 12],
    traits: { social: 0.9, open: 0.7, trust: 0.6, pace: 0.7, group: 0.95 },
    tell: 'Громко смеётся в центре', pose: 'sitSofa',
    first: 'Садись к нам, чего стоишь! Как зовут?',
    bias: { moods: { festive: 2, chill: 2 }, topics: ['food', 'travel', 'games'] } },
  { id: 'debater', title: 'Спорщик', icon: 'fire', weight: 1.0,
    arrive: [20, 22], stay: [2, 4], zones: ['long', 'round', 'bar'], group: [3, 6],
    traits: { social: 0.6, open: 0.4, trust: 0.3, pace: 0.8, group: 0.6 },
    tell: 'Машет руками, «докажи»',
    first: 'Вот ты скажи: ИИ нас всех заменит или нет?',
    bias: { roles: { ai: 2, backend: 1.5 }, topics: ['ai', 'crypto', 'jobs'] } },
  { id: 'quiet', title: 'Тихий у стены', icon: 'shell', weight: 1.2,
    arrive: [19.5, 22], stay: [1.5, 3.5], zones: ['back', 'booth', 'bar'], group: [1, 2],
    traits: { social: 0.1, open: 0.3, trust: 0.4, pace: 0.2, group: 0.1 },
    tell: 'Стоит с краю с пивом', pose: 'drink',
    first: 'А… привет. Я просто послушать пришёл.',
    bias: { moods: { lonely: 2, tired: 1.5 }, roles: { qa: 1.5, backend: 1.3 } } },
  { id: 'parent', title: '«Я на полчаса»', icon: 'clock', weight: 1.0,
    arrive: [19.5, 21], stay: [0.5, 1.2], zones: ['entrance', 'bar', 'long'], group: [2, 5],
    traits: { social: 0.6, open: 0.6, trust: 0.5, pace: 0.9, group: 0.5 },
    tell: 'Часто смотрит на часы', pose: 'stand', since: 'year',
    first: 'Привет! Я буквально на полчаса, дома дети.',
    bias: { topics: ['kids', 'housing', 'food'], moods: { tired: 2 } } },
  { id: 'latecomer', title: 'Опоздавший', icon: 'snail', weight: 1.0,
    arrive: [21.3, 23], stay: [1.5, 3], zones: ['bar', 'round', 'long'], group: [2, 6],
    traits: { social: 0.7, open: 0.5, trust: 0.5, pace: 0.7, group: 0.6 },
    tell: 'Врывается, «где вы?»', pose: 'walk',
    first: 'Фух, успел! Я писал в чат, никто не ответил.',
    bias: { moods: { annoyed: 2, festive: 1.5 }, roles: { lead: 1.5 } } },
  { id: 'couple', title: 'Пара', icon: 'rings', weight: 0.8, pair: true,
    arrive: [19.5, 21], stay: [2, 3.5], zones: ['booth', 'round', 'veranda'], group: [2, 4],
    traits: { social: 0.4, open: 0.5, trust: 0.5, pace: 0.4, group: 0.2 },
    tell: 'Вдвоём за столиком', pose: 'sit',
    first: 'Привет! Мы с женой сели за маленький столик, не знали, куда можно.',
    bias: { topics: ['housing', 'kids', 'travel', 'food'], needs: { flat: 1.5, hike: 1.5 } } },
  { id: 'gamer', title: 'Игрок', icon: 'dice', weight: 1.0,
    arrive: [20, 22], stay: [2, 4.5], zones: ['round', 'bar', 'long'], group: [2, 6],
    traits: { social: 0.5, open: 0.5, trust: 0.4, pace: 0.7, group: 0.5 },
    tell: 'Зовёт в бильярд', pose: 'stand',
    first: 'Ты в бильярд или покер? Нам четвёртого не хватает.',
    bias: { offers: { game: 5 }, needs: { game: 2 }, topics: ['games', 'sport'] } },
  { id: 'catperson', title: 'Кошатник', icon: 'cat', weight: 0.7,
    arrive: [19.5, 21.5], stay: [2, 3.5], zones: ['round', 'veranda', 'long'], group: [2, 4],
    traits: { social: 0.5, open: 0.7, trust: 0.6, pace: 0.4, group: 0.4 },
    tell: 'Показывает фото кота', pose: 'phone',
    first: 'Привет! Хочешь посмотреть на моего кота? Это обязательно.',
    bias: { offers: { kitten: 3 }, needs: { kitten: 2 }, topics: ['pets', 'housing'] } },
  { id: 'nomad', title: 'Кочевник', icon: 'backpack', weight: 0.9,
    arrive: [20, 22], stay: [1.5, 3.5], zones: ['bar', 'veranda', 'round'], group: [2, 5],
    traits: { social: 0.6, open: 0.6, trust: 0.5, pace: 0.6, group: 0.5 },
    tell: 'Рюкзак, загар', pose: 'drink',
    first: 'Привет! Я тут проездом, ищу, куда дальше. Что посоветуешь?',
    bias: { topics: ['travel', 'remote', 'sea'], moods: { seeking: 2, chill: 1.5 } } },
  { id: 'junior', title: 'Вкатывается в IT', icon: 'sprout', weight: 0.9,
    arrive: [19.5, 21.5], stay: [2, 3.5], zones: ['long', 'round', 'entrance'], group: [2, 5],
    traits: { social: 0.5, open: 0.8, trust: 0.7, pace: 0.5, group: 0.5 },
    tell: 'Спрашивает про резюме', pose: 'stand',
    first: 'Привет! Я только учусь на тестировщика. Можно спросить?',
    bias: { roles: { qa: 3, frontend: 2, ai: 1.5 }, needs: { mentor: 6, job: 2, english: 1.5 }, moods: { euphoric: 1.5, anxious: 1.5 }, topics: ['jobs', 'ai'] } },
  { id: 'seller', title: 'Продавец', icon: 'tag', weight: 0.6,
    arrive: [20, 21.5], stay: [1.5, 3], zones: ['long', 'bar', 'round'], group: [2, 6],
    traits: { social: 0.8, open: 0.9, trust: 0.4, pace: 0.8, group: 0.7 },
    tell: 'Раздаёт визитки', pose: 'stand',
    first: 'Привет! А ты квартиру не ищешь? Или английский?',
    bias: { roles: { realtor: 5, teacher: 4 }, offers: { flat: 3, english: 3 }, topics: ['housing', 'banks'] } },
  { id: 'suspicious', title: 'Подозрительный', icon: 'mask', weight: 0.25, rare: true,
    arrive: [21, 23], stay: [0.7, 1.5], zones: ['bar', 'street', 'veranda'], group: [1, 2],
    traits: { social: 0.7, open: 0.9, trust: 0.2, pace: 0.9, group: 0.2 },
    tell: 'Спрашивает про крипту шёпотом', pose: 'stand',
    first: 'Слушай, а ты USDT не меняешь? Курс лучше, чем в обменнике.',
    bias: { roles: { crypto: 6 }, offers: { exchange: 20 }, topics: ['crypto', 'banks'] } },
];
return { ARCHETYPES };
});
