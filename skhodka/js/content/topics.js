// ═══ ТЕМЫ РАЗГОВОРА ═══
// Собраны из ежедневных «Что обсуждалось вчера» и субботних вечеров чата (обобщённо, без людей).
// Тема — то, о чём можно поговорить: у человека их 3–5 (роль + настроение + случай). Совпала тема
// с игроком → ступень «общая тема». Реплики по теме — LINES[topic.id] (content/lines).
//
// TOPICS[] — {
//   id       ключ (ROLES.topics, MOODS.likeTopics/hateTopics, CARDS.topic, NEEDS.topic, LINES[id])
//   title    2–3 слова для игрока и для {topic} в репликах
//   icon     ключ иконки (см. CONTENT.EMOJI в content/index)
//   weight   как часто тема достаётся человеку «просто так», сверх роли
//   kind     сверх схемы: 'work' — про работу | 'life' — быт релоканта | 'fun' — досуг
//            (симуляция: 'life' понятны всем, 'work' — лучше заходят своим по роли)
// }
'use strict';
L.def('content/topics', () => {
const TOPICS = [
  // ── работа ──
  { id: 'ai',        title: 'ИИ и нейронки',     icon: 'robot',     weight: 3.0, kind: 'work' },
  { id: 'backend',   title: 'бэкенд и базы',     icon: 'server',    weight: 1.2, kind: 'work' },
  { id: 'frontend',  title: 'фронтенд',          icon: 'browser',   weight: 0.6, kind: 'work' },
  { id: 'mobile',    title: 'мобилки',           icon: 'mobile',    weight: 0.5, kind: 'work' },
  { id: 'devops',    title: 'облака и девопс',   icon: 'cloud',     weight: 0.5, kind: 'work' },
  { id: 'qa',        title: 'тестирование',      icon: 'bug',       weight: 0.6, kind: 'work' },
  { id: 'design',    title: 'дизайн',            icon: 'pen',       weight: 0.6, kind: 'work' },
  { id: 'product',   title: 'продукт и команды', icon: 'kanban',    weight: 0.8, kind: 'work' },
  { id: 'startup',   title: 'стартапы',          icon: 'rocket',    weight: 1.2, kind: 'work' },
  { id: 'marketing', title: 'маркетинг',         icon: 'megaphone', weight: 0.6, kind: 'work' },
  { id: 'crypto',    title: 'крипта',            icon: 'coin',      weight: 1.0, kind: 'work' },
  { id: 'jobs',      title: 'рынок и собесы',    icon: 'briefcase', weight: 2.0, kind: 'work' },
  { id: 'remote',    title: 'удалёнка',          icon: 'laptop',    weight: 1.4, kind: 'work' },
  // ── быт релоканта ──
  { id: 'vnzh',      title: 'ВНЖ и документы',   icon: 'passport',  weight: 2.2, kind: 'life' },
  { id: 'banks',     title: 'банки и обмен',     icon: 'bank',      weight: 2.0, kind: 'life' },
  { id: 'housing',   title: 'квартиры',          icon: 'house',     weight: 2.0, kind: 'life' },
  { id: 'food',      title: 'еда в Батуми',      icon: 'food',      weight: 2.4, kind: 'life' },
  { id: 'georgian',  title: 'грузинский язык',   icon: 'speech',    weight: 1.0, kind: 'life' },
  { id: 'city',      title: 'Батуми',            icon: 'city',      weight: 2.2, kind: 'life' },
  { id: 'kids',      title: 'дети и школы',      icon: 'child',     weight: 0.9, kind: 'life' },
  { id: 'weather',   title: 'погода',            icon: 'rain',      weight: 1.2, kind: 'life' },
  // ── досуг ──
  { id: 'sea',       title: 'море и пляжи',      icon: 'sea',       weight: 1.4, kind: 'fun' },
  { id: 'travel',    title: 'путешествия',       icon: 'plane',     weight: 1.6, kind: 'fun' },
  { id: 'games',     title: 'игры',              icon: 'dice',      weight: 1.3, kind: 'fun' },
  { id: 'sport',     title: 'спорт и горы',      icon: 'mountain',  weight: 1.2, kind: 'fun' },
  { id: 'pets',      title: 'кошки и собаки',    icon: 'cat',       weight: 0.9, kind: 'fun' },
  { id: 'music',     title: 'музыка',            icon: 'music',     weight: 0.8, kind: 'fun' },
];
return { TOPICS };
});
