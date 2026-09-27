// Тестовое содержание для симуляции: маленький CONTENT по схемам docs/plan.md и расширениям content/*
// (act у карт, CHAT.during/after/events, EVENTS.by/close/lure, шкалы 0..1). Нужно tests/sim.js как
// независимый от настоящего содержания набор. В игре не используется. Истории нарочно условные.
'use strict';
L.def('sim/fixture', () => {
const { LAYOUT } = L.use('content/layout');

const TOPICS = [
  { id: 'ai',     title: 'нейросети',  icon: 'brain',   weight: 3, kind: 'work' },
  { id: 'front',  title: 'фронтенд',   icon: 'code',    weight: 2, kind: 'work' },
  { id: 'back',   title: 'бэкенд',     icon: 'server',  weight: 2, kind: 'work' },
  { id: 'games',  title: 'игры',       icon: 'gamepad', weight: 2, kind: 'fun' },
  { id: 'relo',   title: 'релокация',  icon: 'plane',   weight: 3, kind: 'life' },
  { id: 'sea',    title: 'море',       icon: 'wave',    weight: 2, kind: 'life' },
  { id: 'money',  title: 'деньги',     icon: 'coin',    weight: 1, kind: 'life' },
  { id: 'music',  title: 'музыка',     icon: 'music',   weight: 1, kind: 'fun' },
  { id: 'food',   title: 'еда',        icon: 'sushi',   weight: 2, kind: 'life' },
];

const NEEDS = [
  { id: 'job',    topic: 'money', weight: 3, value: 1.5, seek: { title: 'ищет работу', icon: 'search' }, offer: { title: 'нанимает', icon: 'briefcase' },
    seekLines: ['Я в поиске, если что'], offerLines: ['Мы нанимаем!'], deal: 'собес' },
  { id: 'flat',   topic: 'relo',  weight: 2, value: 1.5, seek: { title: 'ищет жильё', icon: 'home' }, offer: { title: 'сдаёт комнату', icon: 'key' },
    seekLines: ['Ищу квартиру у моря'], offerLines: ['Сдаю комнату'], deal: 'смотрины' },
  { id: 'mentor', topic: 'ai',    weight: 2, value: 1, seek: { title: 'ищет ментора', icon: 'book' }, offer: { title: 'менторит', icon: 'star' },
    seekLines: ['Мне бы ментора'], offerLines: ['Могу помочь советом'], deal: 'созвон' },
  { id: 'game',   topic: 'games', weight: 1, value: 1, seek: { title: 'ищет игроков', icon: 'dice' }, offer: { title: 'зовёт играть', icon: 'dice' },
    seekLines: ['Кто в настолки?'], offerLines: ['Приходи играть'], deal: 'игра' },
];

const ROLES = [
  { id: 'dev',     title: 'разработчик', icon: 'code',   weight: 4, topics: ['back', 'front', 'ai', 'games'], needs: ['job', 'mentor', 'flat'], offers: ['mentor', 'game'], look: { style: 'it' }, jobs: ['Go-разработчик', 'фронтендер'], fem: 0.2, age: [23, 42] },
  { id: 'pm',      title: 'продакт',     icon: 'chart',  weight: 2, topics: ['ai', 'money', 'relo'],          needs: ['job'],                   offers: ['job', 'mentor'], look: { style: 'smart' }, fem: 0.5 },
  { id: 'design',  title: 'дизайнер',    icon: 'pen',    weight: 2, topics: ['front', 'sea', 'music'],        needs: ['job', 'flat'],           offers: ['game'],          look: { style: 'party' }, fem: 0.6 },
  { id: 'founder', title: 'фаундер',     icon: 'rocket', weight: 1, topics: ['money', 'ai', 'relo'],          needs: ['mentor'],                offers: ['job', 'flat'],   look: { style: 'smart' } },
  { id: 'teacher', title: 'учитель',     icon: 'book',   weight: 1, topics: ['relo', 'sea', 'food'],          needs: ['flat'],                  offers: ['flat'],          look: { style: 'sport' }, it: false },
];

const MINDS = [
  { id: 'nerd',    title: 'технарь',   icon: 'gear',  weight: 3, likes: ['facts', 'ask', 'help'],     dislikes: ['praise', 'dream'], talk: 'Только факты', traits: { open: -0.05 }, battery: 0.9, gate: 0.55 },
  { id: 'joker',   title: 'весельчак', icon: 'smile', weight: 2, likes: ['joke', 'treat', 'invite'],  dislikes: ['facts', 'wait'],   talk: 'Шути', traits: { social: 0.2 }, battery: 1.2, gate: 0.45 },
  { id: 'dreamer', title: 'мечтатель', icon: 'cloud', weight: 2, likes: ['dream', 'share', 'listen'], dislikes: ['argue', 'facts'], talk: 'Спроси о мечте', battery: 1, gate: 0.4 },
  { id: 'shy',     title: 'тихоня',    icon: 'leaf',  weight: 2, likes: ['listen', 'wait', 'ask'],    dislikes: ['joke', 'argue'],   talk: 'Не торопи', traits: { social: -0.2, open: -0.1 }, battery: 0.8, gate: 0.6 },
];

const MOODS = [
  { id: 'fresh', title: 'бодрый',   icon: 'sun',  weight: 3, energy: 0.9, leaveShift: 0.5,  likeTopics: ['games'], hateTopics: [],        likes: ['joke'],   dislikes: [], openLines: ['Отличный вечер!'], drink: 1.2 },
  { id: 'tired', title: 'уставший', icon: 'moon', weight: 2, energy: 0.45, leaveShift: -0.5, likeTopics: ['sea'],  hateTopics: ['money'], likes: ['listen'], dislikes: ['argue'], openLines: ['Неделя была тяжёлая'] },
  { id: 'calm',  title: 'спокойный',icon: 'tea',  weight: 3, energy: 0.65, leaveShift: 0,    likeTopics: [],       hateTopics: [],        likes: [],         dislikes: [] },
];

const ARCHETYPES = [
  { id: 'early',  title: 'ранняя птица', icon: 'clock', weight: 1, arrive: [18.8, 19.1], stay: [2.5, 3.5], zones: ['entrance', 'long'], group: [2, 6], traits: { social: 0.7, open: 0.7 }, tell: 'сидит у входа', first: 'О, первый гость!' },
  { id: 'core',   title: 'костяк',       icon: 'users', weight: 5, arrive: [19.6, 20.8], stay: [2.5, 4.0], zones: ['long', 'round', 'entrance'], group: [3, 6], traits: { social: 0.6, group: 0.8 }, tell: 'за длинным столом', pose: 'sitSofa' },
  { id: 'bar',    title: 'у стойки',     icon: 'beer',  weight: 2, arrive: [20.0, 21.2], stay: [1.5, 3.0], zones: ['bar', 'round'], group: [1, 3], traits: { social: 0.5, pace: 0.7 }, tell: 'стоит у бара', pose: 'drink' },
  { id: 'smoker', title: 'курильщик',    icon: 'smoke', weight: 2, arrive: [20.0, 21.0], stay: [2.0, 3.5], zones: ['veranda', 'street', 'entrance'], group: [2, 4], traits: { social: 0.6 }, tell: 'на веранде' },
  { id: 'quiet',  title: 'наблюдатель',  icon: 'eye',   weight: 2, arrive: [20.3, 21.5], stay: [1.0, 2.5], zones: ['booth', 'back', 'round'], group: [1, 2], traits: { social: 0.2, open: 0.25, trust: 0.3 }, tell: 'в углу с телефоном', pose: 'phone' },
  { id: 'couple', title: 'пара',         icon: 'rings', weight: 1, arrive: [19.6, 20.6], stay: [2.0, 3.0], zones: ['booth', 'round'], group: [2, 4], traits: { social: 0.4 }, tell: 'вдвоём', pair: true },
  { id: 'late',   title: 'опоздавший',   icon: 'run',   weight: 1, arrive: [21.8, 23.0], stay: [1.5, 3.0], zones: ['bar', 'long', 'veranda'], group: [2, 5], traits: { social: 0.8, open: 0.7 }, tell: 'влетает в дверь', first: 'Фух, успел!' },
];

const ODDBALLS = [
  { id: 'singer', title: 'певица', icon: 'mic', weight: 1, catch: 'Кто со мной в караоке?', sign: 'С микрофоном', prop: 'mic',
    look: { sex: 'f', style: 'party', prop: 'mic', oddball: 'singer' }, arrive: [21.0, 22.0], stay: [1.5, 2.5], event: 'karaoke',
    befriend: { likes: ['invite', 'joke'], topic: 'music' }, album: { title: 'Спел дуэтом', icon: 'mic' }, offer: null, need: null,
    lines: ['Какая твоя песня?', 'Я уже спела три раза'] },
  { id: 'photog', title: 'фотограф', icon: 'camera', weight: 1, catch: 'Все на общее фото! Позже.', sign: 'Камера на шее', prop: 'camera',
    look: { sex: 'm', style: 'it', prop: 'camera', oddball: 'photog' }, arrive: [20.0, 21.0], stay: [3.5, 4.5], event: 'photo',
    befriend: { likes: ['praise', 'help'], topic: 'music' }, album: { title: 'На общем фото', icon: 'camera' }, offer: 'game', need: null,
    lines: ['Не моргай', 'Свет тут сложный'] },
];

// act (или do): hello | contact | deal | introduce | bye | photo
// when: first|greeted|talked|warm|cold|common|contact(ступень 2–3)|deal(ступень 4)|known|need|pairable|late|bar|tired|group|alone|oddball|event
const CARDS = [
  { id: 'hi',      style: 'ask',    icon: 'hand',  label: 'Ты из чата?', when: 'first', act: 'hello' },
  { id: 'hi2',     style: 'joke',   icon: 'smile', label: 'Верное место?', when: 'first', act: 'hello' },
  { id: 'hi3',     style: 'treat',  icon: 'beer',  label: 'Привет! Пива?', when: 'first', act: 'hello', cost: 0.03 },
  { id: 'where',   style: 'ask',    icon: 'q',     label: 'Чем занимаешься?', when: 'greeted' },
  { id: 'askT',    style: 'ask',    icon: 'q',     label: 'Как тебе {topic}?', topic: 'their' },
  { id: 'shareT',  style: 'share',  icon: 'chat',  label: 'Я про {topic}', topic: 'mine' },
  { id: 't_ai',    style: 'argue',  icon: 'brain', label: 'ИИ заменит всех?', topic: 'ai' },
  { id: 't_sea',   style: 'dream',  icon: 'wave',  label: 'Сарпи или Квариати?', topic: 'sea' },
  { id: 't_games', style: 'share',  icon: 'dice',  label: 'Во что играешь?', topic: 'games' },
  { id: 't_food',  style: 'treat',  icon: 'sushi', label: 'Закажем хачапури?', topic: 'food' },
  { id: 'listen',  style: 'listen', icon: 'ear',   label: 'Кивать, слушать' },
  { id: 'joke',    style: 'joke',   icon: 'smile', label: 'Пошутить' },
  { id: 'facts',   style: 'facts',  icon: 'chart', label: 'А вот цифры' },
  { id: 'help',    style: 'help',   icon: 'hand',  label: 'Чем помочь?', when: 'talked' },
  { id: 'argue',   style: 'argue',  icon: 'fire',  label: 'Сомневаюсь я' },
  { id: 'dream',   style: 'dream',  icon: 'cloud', label: 'А мечта какая?' },
  { id: 'praise',  style: 'praise', icon: 'star',  label: 'Круто звучит' },
  { id: 'wait',    style: 'wait',   icon: 'pause', label: 'Помолчать', cost: 0 },
  { id: 'sip',     style: 'wait',   icon: 'beer',  label: 'Отпить пива', when: 'bar', cost: -0.02 },
  { id: 'invite',  style: 'invite', icon: 'sofa',  label: 'Садись к нам' },
  { id: 'treat',   style: 'treat',  icon: 'beer',  label: 'Бери ролл' },
  { id: 'intro',   style: 'help',   icon: 'link',  label: 'Познакомлю кое с кем', when: 'pairable', act: 'introduce' },
  { id: 'contact', style: 'invite', icon: 'phone', label: 'Обменяемся?', when: 'contact', act: 'contact' },
  { id: 'deal',    style: 'invite', icon: 'handshake', label: 'Договоримся?', when: 'deal', act: 'deal' },
  { id: 'selfie',  style: 'invite', icon: 'camera', label: 'Селфи на память', when: 'late', act: 'photo' },
  { id: 'bye',     style: 'wait',   icon: 'door',  label: 'Ну, я пойду', act: 'bye', cost: 0 },
];

const LINES = {
  any: {
    hello:   ['Привет! Я {name}', 'О, привет. {name}'],
    good:    ['Да, точно!', 'Ха, согласен'],
    meh:     ['Ну… может', 'Угу'],
    bad:     ['Эм. Нет', 'Не моё'],
    open:    ['Слушай, а ты интересный'],
    reveal:  ['О, {topic} — это моё'],
    leave:   ['Пойду, увидимся', 'Мне пора'],
    contact: ['Пиши в телегу!'],
    deal:    ['Договорились!'],
  },
  ai:    { good: ['{topic} — это всё!'], bad: ['Опять {topic}…'], reveal: ['Про {topic} могу до утра'] },
  joke:  { good: ['Ахаха'], bad: ['Не смешно'] },
  facts: { good: ['О, не знал'], bad: ['Зануда'] },
};

const EVENTS = [
  { id: 'jam',      title: 'Пробка',      icon: 'car',     at: [19.6, 20.2], chance: 0.6, effect: { dur: 0.3, delay: 0.25, arrive: 0.5, chat: 'jam' }, scene: null, toast: 'Город встал' },
  { id: 'rain',     title: 'Дождь',       icon: 'rain',    at: [20.5, 22.0], chance: 0.7, effect: { dur: 0.6, close: ['veranda'], topic: 'sea' }, scene: 'rain' },
  { id: 'strobe',   title: 'Стробоскоп',  icon: 'bolt',    at: [21.0, 22.5], chance: 0.6, effect: { dur: 0.2, drain: 1.4, leave: 0.05, likes: ['joke'] }, scene: 'strobe' },
  { id: 'smell',    title: 'Запах',       icon: 'nose',    at: [20.5, 23.0], chance: 0.5, effect: { dur: 0.25, close: ['booth'], gather: 'veranda', energy: -0.03 }, scene: 'smell' },
  { id: 'bday',     title: 'День рождения', icon: 'cake',  at: [21.3, 22.3], chance: 0.8, effect: { dur: 0.3, zone: 'long', pose: 'sing', mood: 0.2, rapport: 0.03, gather: 'long' }, scene: 'birthday' },
  { id: 'argue',    title: 'Спор',        icon: 'fire',    at: [21.0, 23.5], chance: 0.7, effect: { dur: 0.25, argue: true, likes: ['argue'] } },
  { id: 'dota',     title: 'Дота',        icon: 'gamepad', at: [21.5, 23.5], chance: 0.6, effect: { dur: 0.3, topic: 'games', gather: { zone: 'round', share: 0.15 } } },
  { id: 'feast',    title: 'Кормят стол', icon: 'sushi',   at: [20.5, 21.5], chance: 0.5, effect: { dur: 0.5, food: true, gather: 'long', topic: 'food' } },
  { id: 'football', title: 'Футбол',      icon: 'ball',    at: [21.5, 22.5], chance: 0.7, effect: { dur: 0.5, gather: { zone: 'bar', share: 0.2 } }, scene: 'football' },
  { id: 'karaoke',  title: 'Караоке',     icon: 'mic',     at: [23.0, 23.1], chance: 1, effect: { dur: 0, lure: 0.25, gather: 'street', chat: 'karaoke' } },
  { id: 'photo',    title: 'Общее фото',  icon: 'camera',  at: [24.4, 24.5], chance: 0, by: 'photog', effect: { dur: 0.2, photo: true, gather: 'long' }, scene: 'garland' },
];

const MEET = [{ id: 'meet', label: 'Иду встречать', icon: 'walk', ok: true, fx: { rapport: 8 } }, { id: 'skip', label: 'Не видел', icon: 'shrug' }];
const CHAT = {
  feed: [{ id: 'f1', stamp: 'пт 11:00', who: 'org', text: 'Суббота, 19:00, SushiGO' }, { id: 'f2', stamp: 'сб 18:40', who: 'npc', text: 'Иду, {name}' }],
  before: [{ id: 'b1', text: 'А кто-то уже тут?', options: MEET }, { id: 'b2', text: 'Нас пока трое' }],
  where: [{ id: 'w1', arch: 'core', text: 'Где вы сидите?', options: MEET }, { id: 'w2', arch: 'couple', text: 'Мы вдвоём в уголке', options: MEET }],
  late: [{ id: 'l1', arch: 'late', text: 'Опаздываю, буду в {time}', options: MEET }],
  background: [{ id: 'g1', at: [21, 22], text: 'Кто ещё сидит?' }],
  events: { jam: [{ who: 'npc', text: 'Стою в пробке' }], karaoke: [{ who: 'npc', text: 'Мы в караоке!' }] },
  after: [{ id: 'a1', text: 'Рад знакомству, {me}!' }, { id: 'a2', text: 'Всё в силе?', need: 'deal' }, { id: 'a3', text: 'Спасибо, что познакомил!', need: 'pair' }],
  afterFeed: [{ id: 'z1', who: 'org', text: 'Спасибо всем, было нас {n}' }, { id: 'z2', who: 'npc', text: 'Фото подъехали', need: 'photo' }, { id: 'z3', who: 'npc', text: '{a} и {b} уже списались', need: 'pair' }],
};

const NAMES = {
  m: ['Артём', 'Илья', 'Глеб', 'Лёва', 'Марк', 'Тимур', 'Саша', 'Дима', 'Костя', 'Рома', 'Женя', 'Паша', 'Олег', 'Стас', 'Ваня', 'Денис', 'Игорь'],
  f: ['Аня', 'Лиза', 'Катя', 'Маша', 'Соня', 'Вера', 'Даша', 'Ника', 'Оля', 'Юля', 'Таня', 'Настя', 'Полина', 'Ира', 'Лена', 'Ася'],
  last: { m: ['Орлов', 'Белов'], f: ['Орлова', 'Белова'] },
};

const TUNING = {
  seed: 7,
  time: { realSecPerHour: 180 },
  titles: [
    { id: 'guest',  title: 'Гость',     icon: 'user',  need: {} },
    { id: 'social', title: 'Свой',      icon: 'users', need: { met: 4 } },
    { id: 'hub',    title: 'Нетворкер', icon: 'link',  need: { met: 7, contacts: 3 } },
    { id: 'cupid',  title: 'Сводник',   icon: 'heart', need: { pairs: 2 } },
  ],
};

const CONTENT = { ROLES, MINDS, MOODS, ARCHETYPES, ODDBALLS, NEEDS, TOPICS, CARDS, LINES, EVENTS, CHAT, NAMES, TUNING, LAYOUT };
return { CONTENT };
});
