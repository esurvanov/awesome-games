// ═══ КАРТЫ-РЕПЛИКИ ИГРОКА ═══
// Разговор = выбор карт (иконка + 2–4 слова). Оценка (sim/talk): стиль ∈ MINDS.likes → плюс, ∈ dislikes → минус,
// поправки MOODS.likes/dislikes, тема карты ∈ темы собеседника, MOODS.likeTopics/hateTopics, событие «в воздухе».
// Реплика ответа: LINES[card.topic] → LINES[card.style] → LINES.any (content/lines).
//
// STYLES[]  — все стили карт (MINDS.likes/dislikes, MOODS.likes/dislikes, ODDBALLS.befriend.likes ⊂ STYLES)
// WHEN      — словарь условий показа (id → пояснение); вычисляет sim/talk.when, content только ссылается
// CARDS[] — {
//   id
//   style     ∈ STYLES
//   icon      ключ иконки
//   label     2–4 слова (что видит игрок); {topic} — название темы (подставляется), {name}
//   topic?    id темы TOPICS — тематическая карта; или 'their' — одна из тем собеседника (если известны),
//             'mine' — одна из тем игрока (profile.topics), 'event' — тема «в воздухе» от события
//   when?     ключ WHEN (без when — всегда)
//   сверх схемы:
//   do?       'contact' | 'deal' — особое действие лестницы (sim: card.do или when contact/deal)
// }
'use strict';
L.def('content/cards', () => {
const STYLES = ['ask', 'share', 'listen', 'joke', 'facts', 'help', 'argue', 'dream', 'praise', 'wait', 'invite', 'treat'];

const WHEN = {
  first:   'первый ход разговора (приветствие)',
  warm:    'симпатия ≥ «поговорили» (TUNING.talk.talked)',
  cold:    'симпатия ещё ниже «поговорили» — разговор только начался',
  contact: 'можно обменяться контактами (ступень 2–3)',
  deal:    'можно договориться (ступень 4 — контакт есть)',
  known:   'темы собеседника уже раскрыты',
  group:   'собеседник в компании',
  alone:   'собеседник один',
  late:    'час ≥ 23',
  tired:   'собеседник устаёт от разговора',
  oddball: 'собеседник — чудик',
  bar:     'собеседник у бара',
  event:   'идёт событие',
};

const CARDS = [
  // ── начало ──
  { id: 'hello_chat',  style: 'ask',    icon: 'wave',      label: 'Ты из чата?',          when: 'first' },
  { id: 'hello_me',    style: 'share',  icon: 'hand',      label: 'Привет, я тоже тут',   when: 'first' },
  { id: 'hello_joke',  style: 'joke',   icon: 'laugh',     label: 'Верное место, да?',    when: 'first' },
  { id: 'hello_beer',  style: 'treat',  icon: 'beer',      label: 'Привет! Пива?',        when: 'first' },
  // ── спросить ──
  { id: 'ask_job',     style: 'ask',    icon: 'briefcase', label: 'Чем занимаешься?',     when: 'cold' },
  { id: 'ask_since',   style: 'ask',    icon: 'calendar',  label: 'Давно в Батуми?',      when: 'cold' },
  { id: 'ask_from',    style: 'ask',    icon: 'map',       label: 'Откуда переехал?',     when: 'cold' },
  { id: 'ask_week',    style: 'ask',    icon: 'smile',     label: 'Как неделя?' },
  { id: 'ask_more',    style: 'ask',    icon: 'question',  label: 'А почему так?',        when: 'warm' },
  // ── рассказать ──
  { id: 'share_self',  style: 'share',  icon: 'user',      label: 'Рассказать о себе' },
  { id: 'share_story', style: 'share',  icon: 'book',      label: 'Есть история' },
  { id: 'share_fail',  style: 'share',  icon: 'bug',       label: 'Как я уронил прод',    when: 'warm' },
  // ── слушать ──
  { id: 'listen_nod',  style: 'listen', icon: 'ear',       label: 'Кивать и слушать' },
  { id: 'listen_more', style: 'listen', icon: 'ear',       label: 'А дальше что?' },
  { id: 'listen_same', style: 'listen', icon: 'heart',     label: 'У меня так же',        when: 'warm' },
  // ── шутить ──
  { id: 'joke_rules',  style: 'joke',   icon: 'umbrella',  label: 'Зонты осуждаются' },
  { id: 'joke_prod',   style: 'joke',   icon: 'fire',      label: 'Мем про прод' },
  { id: 'joke_banana', style: 'joke',   icon: 'banana',    label: 'Шутка про бананы' },
  // ── факты ──
  { id: 'facts_num',   style: 'facts',  icon: 'chart',     label: 'А вот цифры' },
  { id: 'facts_link',  style: 'facts',  icon: 'link',      label: 'Скину статью' },
  // ── помочь ──
  { id: 'help_offer',  style: 'help',   icon: 'hand',      label: 'Чем помочь?',          when: 'warm' },
  { id: 'help_tip',    style: 'help',   icon: 'lamp',      label: 'Дам совет' },
  // ── спорить ──
  { id: 'argue_doubt', style: 'argue',  icon: 'scale',     label: 'Сомневаюсь я' },
  { id: 'argue_prove', style: 'argue',  icon: 'fire',      label: 'А ты докажи!' },
  // ── мечтать ──
  { id: 'dream_what',  style: 'dream',  icon: 'star',      label: 'А мечта какая?',       when: 'warm' },
  { id: 'dream_next',  style: 'dream',  icon: 'plane',     label: 'Где будешь через год?' },
  // ── хвалить ──
  { id: 'praise_cool', style: 'praise', icon: 'thumb',     label: 'Круто звучит' },
  { id: 'praise_look', style: 'praise', icon: 'sparkle',   label: 'Классная футболка' },
  // ── ждать ──
  { id: 'wait_pause',  style: 'wait',   icon: 'pause',     label: 'Помолчать вместе' },
  { id: 'wait_sip',    style: 'wait',   icon: 'beer',      label: 'Отпить пива',          when: 'bar' },
  { id: 'wait_rest',   style: 'wait',   icon: 'pause',     label: 'Дать передохнуть',     when: 'tired' },
  // ── звать ──
  { id: 'invite_table',style: 'invite', icon: 'sofa',      label: 'Садись к нам' },
  { id: 'invite_air',  style: 'invite', icon: 'street',    label: 'Выйдем подышать?' },
  { id: 'invite_pool', style: 'invite', icon: 'cue',       label: 'Партию в бильярд?',    topic: 'games' },
  { id: 'invite_sing', style: 'invite', icon: 'mic',       label: 'Потом в караоке?',     topic: 'music', when: 'late' },
  // ── угостить ──
  { id: 'treat_beer',  style: 'treat',  icon: 'beer',      label: 'Угощаю пивом',         when: 'bar' },
  { id: 'treat_roll',  style: 'treat',  icon: 'sushi',     label: 'Бери ролл' },
  { id: 'treat_khach', style: 'treat',  icon: 'food',      label: 'Закажем хачапури?',    topic: 'food' },

  // ── по теме собеседника / своей / события ──
  { id: 'w_their',     style: 'ask',    icon: 'question',  label: 'Про {topic}?',         topic: 'their', when: 'known' },
  { id: 'w_mine',      style: 'share',  icon: 'user',      label: 'Моё: {topic}',         topic: 'mine' },
  { id: 'w_fact',      style: 'facts',  icon: 'chart',     label: 'Факт: {topic}',        topic: 'their', when: 'warm' },
  { id: 'w_event',     style: 'joke',   icon: 'sparkle',   label: 'Видал? {topic}!',      topic: 'event', when: 'event' },
  { id: 'odd_wow',     style: 'praise', icon: 'star',      label: 'Ты легенда!',          when: 'oddball' },
  { id: 'group_all',   style: 'invite', icon: 'crowd',     label: 'Двигайтесь к нам',     when: 'group' },
  { id: 'alone_join',  style: 'invite', icon: 'sofa',      label: 'Не скучай один',       when: 'alone' },

  // ── тематические ──
  { id: 't_ai_argue',  style: 'argue',  icon: 'robot',     label: 'ИИ заменит всех?',     topic: 'ai' },
  { id: 't_ai_share',  style: 'share',  icon: 'robot',     label: 'Я вайб-кожу',          topic: 'ai' },
  { id: 't_backend',   style: 'facts',  icon: 'server',    label: 'Postgres или Mongo?',  topic: 'backend' },
  { id: 't_frontend',  style: 'joke',   icon: 'browser',   label: 'Опять новый фреймворк',topic: 'frontend' },
  { id: 't_mobile',    style: 'ask',    icon: 'mobile',    label: 'iOS или Android?',     topic: 'mobile' },
  { id: 't_devops',    style: 'share',  icon: 'cloud',     label: 'Кубер снова упал',     topic: 'devops' },
  { id: 't_qa',        style: 'joke',   icon: 'bug',       label: 'Это не баг',           topic: 'qa' },
  { id: 't_design',    style: 'praise', icon: 'pen',       label: 'Покажи портфолио',     topic: 'design' },
  { id: 't_product',   style: 'ask',    icon: 'kanban',    label: 'Как у вас процессы?',  topic: 'product' },
  { id: 't_startup',   style: 'dream',  icon: 'rocket',    label: 'Свой стартап?',        topic: 'startup' },
  { id: 't_marketing', style: 'ask',    icon: 'megaphone', label: 'Где искать клиентов?', topic: 'marketing' },
  { id: 't_crypto',    style: 'facts',  icon: 'coin',      label: 'Что с биткоином?',     topic: 'crypto' },
  { id: 't_jobs',      style: 'ask',    icon: 'briefcase', label: 'Как рынок сейчас?',    topic: 'jobs' },
  { id: 't_remote',    style: 'joke',   icon: 'laptop',    label: 'Сколько работ работаешь?', topic: 'remote' },
  { id: 't_vnzh',      style: 'ask',    icon: 'passport',  label: 'Как с ВНЖ?',           topic: 'vnzh' },
  { id: 't_banks',     style: 'ask',    icon: 'bank',      label: 'Какой банк лучше?',    topic: 'banks' },
  { id: 't_housing',   style: 'ask',    icon: 'house',     label: 'Где снимаешь?',        topic: 'housing' },
  { id: 't_food',      style: 'share',  icon: 'food',      label: 'Где лучшие хинкали',   topic: 'food' },
  { id: 't_georgian',  style: 'share',  icon: 'speech',    label: 'Гамарджоба, генацвале!', topic: 'georgian' },
  { id: 't_city',      style: 'joke',   icon: 'city',      label: 'Опять новая высотка',  topic: 'city' },
  { id: 't_kids',      style: 'ask',    icon: 'child',     label: 'Дети в школе?',        topic: 'kids' },
  { id: 't_weather',   style: 'joke',   icon: 'rain',      label: 'Опять ливень',         topic: 'weather' },
  { id: 't_sea',       style: 'dream',  icon: 'sea',       label: 'Сарпи или Квариати?',  topic: 'sea' },
  { id: 't_travel',    style: 'dream',  icon: 'plane',     label: 'Куда поедешь дальше?', topic: 'travel' },
  { id: 't_games',     style: 'share',  icon: 'dice',      label: 'Во что играешь?',      topic: 'games' },
  { id: 't_sport',     style: 'invite', icon: 'mountain',  label: 'В горы в воскресенье?',topic: 'sport' },
  { id: 't_pets',      style: 'share',  icon: 'cat',       label: 'Покажу кота',          topic: 'pets' },
  { id: 't_music',     style: 'ask',    icon: 'music',     label: 'Что слушаешь?',        topic: 'music' },

  // ── действия лестницы ──
  { id: 'contact',     style: 'invite', icon: 'phone',     label: 'Обменяемся контактами?', when: 'contact', do: 'contact' },
  { id: 'deal',        style: 'invite', icon: 'handshake', label: 'Так договоримся?',         when: 'deal', do: 'deal' },
  { id: 'selfie',      style: 'invite', icon: 'camera',    label: 'Селфи на память',      when: 'late' },
];
return { STYLES, WHEN, CARDS };
});
