// ═══ СКЛАД ХАРАКТЕРА: как с человеком говорить ═══
// Стиль карты (CARDS.style), который нравится складу, — «good», который бесит, — «bad», остальные — «meh»
// (плюс поправки настроения MOODS.likes/dislikes и тем). Игрок узнаёт склад по реакциям — или по подсказке
// `talk`, когда отношения дошли до ступени «поговорили».
//
// MINDS[] — {
//   id, title (1–2 слова), icon
//   weight      доля
//   likes[]     стили карт, которые заходят    ⊂ STYLES (content/cards)
//   dislikes[]  стили карт, которые раздражают ⊂ STYLES
//   talk        подсказка игроку, 2–4 слова: как с ним говорить
//   сверх схемы:
//   traits      поправки к шкалам архетипа (складываются, потом clamp 0..1):
//               social — общительность (сам подходит), open — открытость (быстро раскрывает нужду),
//               trust — доверие (контакт/договор), pace — темп (как быстро устаёт от паузы),
//               group — 0 = один на один … 1 = большой стол
//   battery     множитель социальной батарейки (1 — обычная; <1 — быстрее устаёт от разговора)
//   gate        порог открытости: доля симпатии (rapport 0..1), после которой раскрывает нужду/предложение
//   tell        как узнать по поведению, 2–4 слова (подсказка над головой / в карточке)
// }
'use strict';
L.def('content/minds', () => {
const MINDS = [
  { id: 'storyteller', title: 'Рассказчик', icon: 'book', weight: 1.4,
    likes: ['listen', 'ask', 'praise'], dislikes: ['wait', 'argue'],
    talk: 'Дай выговориться', tell: 'Жестикулирует, громкий',
    traits: { social: 0.2, open: 0.15, trust: 0.05, pace: 0.1, group: 0.25 }, battery: 1.3, gate: 0.35 },
  { id: 'listener', title: 'Слушатель', icon: 'ear', weight: 1.2,
    likes: ['share', 'dream', 'wait'], dislikes: ['argue', 'facts'],
    talk: 'Рассказывай сам', tell: 'Кивает, молчит',
    traits: { social: -0.05, open: 0, trust: 0.1, pace: -0.1, group: -0.1 }, battery: 1.1, gate: 0.5 },
  { id: 'analyst', title: 'Аналитик', icon: 'chart', weight: 1.2,
    likes: ['facts', 'ask', 'argue'], dislikes: ['dream', 'joke', 'praise'],
    talk: 'Только факты', tell: 'Уточняет цифры',
    traits: { social: -0.1, open: -0.05, trust: 0, pace: 0, group: -0.15 }, battery: 0.9, gate: 0.55 },
  { id: 'joker', title: 'Шутник', icon: 'laugh', weight: 1.2,
    likes: ['joke', 'treat', 'invite'], dislikes: ['facts', 'wait'],
    talk: 'Смейся и шути', tell: 'Хохочет на весь бар',
    traits: { social: 0.25, open: 0.1, trust: 0, pace: 0.2, group: 0.3 }, battery: 1.2, gate: 0.45 },
  { id: 'helper', title: 'Помогатор', icon: 'hand', weight: 1.1,
    likes: ['ask', 'help', 'praise'], dislikes: ['argue', 'joke'],
    talk: 'Попроси совета', tell: 'Сразу предлагает помощь',
    traits: { social: 0.1, open: 0.2, trust: 0.2, pace: 0, group: 0.05 }, battery: 1.1, gate: 0.3 },
  { id: 'skeptic', title: 'Скептик', icon: 'scale', weight: 1.0,
    likes: ['facts', 'argue', 'wait'], dislikes: ['dream', 'praise', 'invite'],
    talk: 'Не льсти, спорь', tell: 'Хмыкает, скрестил руки',
    traits: { social: -0.1, open: -0.15, trust: -0.2, pace: 0, group: -0.05 }, battery: 1.0, gate: 0.65 },
  { id: 'dreamer', title: 'Мечтатель', icon: 'star', weight: 0.9,
    likes: ['dream', 'share', 'listen'], dislikes: ['facts', 'argue'],
    talk: 'Спроси о мечте', tell: 'Смотрит в окно',
    traits: { social: 0, open: 0.1, trust: 0.1, pace: -0.1, group: -0.1 }, battery: 1.0, gate: 0.4 },
  { id: 'rival', title: 'Соревнователь', icon: 'trophy', weight: 0.9,
    likes: ['argue', 'invite', 'praise'], dislikes: ['listen', 'wait', 'help'],
    talk: 'Брось вызов', tell: 'Меряется всем',
    traits: { social: 0.15, open: 0, trust: -0.05, pace: 0.25, group: 0.15 }, battery: 1.0, gate: 0.5 },
  { id: 'observer', title: 'Наблюдатель', icon: 'eye', weight: 1.0,
    likes: ['wait', 'listen', 'treat'], dislikes: ['invite', 'joke', 'argue'],
    talk: 'Не торопи', tell: 'Сидит с краю',
    traits: { social: -0.25, open: -0.1, trust: 0, pace: -0.2, group: -0.25 }, battery: 0.8, gate: 0.6 },
];
return { MINDS };
});
