// ═══ ТЕЛЕФОН: чат «Batumi IT Offline Hangouts» ═══
// Интонации — как в настоящем чате (пересказ своими словами, без ников и реальных историй).
// Анонс — по образцу реальных анонсов «Суббота в Батуми 🌊». Опрос «Придёшь?» — Да / Возможно / Нет.
//
// CHAT = {
//   title, members        шапка чата; members — «участников» (для вида)
//   announce  { text }    закреп: анонс встречи ({date} — дата, {n} — номер встречи)
//   poll      { question, options:[{ id, label, icon }], votes:{ id:[min,max] } } — опрос; votes — голосов к старту
//   feed[]    лента до встречи (телефон на титуле/в начале): { id, stamp, who, text }
//             stamp — подпись времени ('пт 21:40'); who — 'org' | 'npc' | 'bot'; {name} — случайное имя,
//             text '{announce}' / '{poll}' — вставить закреп / опрос
//   --- по ходу вечера (sim/director: автор — реальный гость, который вот-вот придёт) ---
//   before[]  19:00–20:00, ранние: «а кто-то уже тут?»
//   where[]   20:00–21:00: «я у входа, как вас найти?», «мы с женой у столика на двоих»
//   late[]    после 21:30: «где вы? опаздываю» ({time} — когда придёт)
//             элемент: { id, text, icon?, arch?, options?:[{ id, label (2–4 слова), icon, ok, fx? }] }
//             arch — архетип автора (ARCHETYPES), подсказка director'у, кому поручить сообщение;
//             ok: true — ответ «иду встречать / объясню»: автор идёт к игроку, у входа — быстрое знакомство
//             (TUNING.chat.doorRadius); fx — сверх: { rapport: ±n } симпатия автора (шкала 0..1)
//   background[] фон без автора (кто-то не дошёл, «вы ещё сидите?»): { id, at:[h0,h1], text }
//   events    { key: [ { who, text } ] } — что пишут при событиях (EVENTS.chat)
//   after[]   личные сообщения от тех, с кем обменялись контактами (итог): { id, text, need? }
//             {name} — автор, {me} — игрок; need — 'deal' | 'pair' — только если с автором договорились / его свели
//   afterFeed[] общий чат наутро: { id, who, text, need? } — need: 'photo' (игрок на фото) | 'photoEv' (фото было) |
//             'met' | 'lonely' (ни одного знакомства) | 'oddball' | 'pair' | 'friend' | id события (было); '!x' — «не x»
//             {n} — сколько было людей, {odd} — чудик вечера, {a} {b} — сведённая пара, {friend} — новый знакомый
// }
'use strict';
L.def('content/chat', () => {
const MEET = [
  { id: 'meet',  label: 'Иду встречать',   icon: 'walk',  ok: true, fx: { rapport: 0.08 } },
  { id: 'guide', label: 'Объясню, где мы', icon: 'map',   ok: true, fx: { rapport: 0.04 } },
  { id: 'skip',  label: 'Не видел',        icon: 'shrug' },
];
const CHAT = {
  title: 'Batumi IT Offline Hangouts',
  members: 1400,
  announce: { text:
    'Суббота в Батуми 🌊\n' +
    'Собираемся хорошо провести вечер, увидеть знакомых и познакомиться с новыми людьми — если пока никого не знаешь, это как раз повод заглянуть.\n\n' +
    'О чём встреча? Обо всём.\n' +
    'Нас объединяет IT, но говорить только о работе не обязательно: проекты, переезды, путешествия, игры, город, хобби — темы выбираете сами.\n\n' +
    '#Встреча {n}\n' +
    '🕖 Суббота 19:00, {date}\n' +
    '📍 SushiGO\n\n' +
    '💪 Ставь лайк, если идёшь' },
  poll: {
    question: 'Придёшь на встречу?',
    options: [
      { id: 'yes',   label: 'Да 💪',        icon: 'check' },
      { id: 'maybe', label: 'Возможно 🤔',  icon: 'question' },
      { id: 'no',    label: 'В другой раз', icon: 'sad' },
    ],
    votes: { yes: [14, 26], maybe: [8, 15], no: [3, 9] },
  },

  feed: [
    { id: 'f_whois1', stamp: 'чт 12:10', who: 'npc', text: 'Всем привет! Я {name}, бэкенд на Go, в Батуми вторую неделю. Рад знакомству! #whois' },
    { id: 'f_whois2', stamp: 'чт 13:02', who: 'npc', text: '#whois Привет! {name}, QA, из Минска, третий год тут. Люблю горы и настолки.' },
    { id: 'f_bank',   stamp: 'чт 15:40', who: 'npc', text: 'Подскажите, какой банк сейчас открывает счёт без танцев?' },
    { id: 'f_bank2',  stamp: 'чт 15:44', who: 'npc', text: 'ТБС открыл за полчаса, но нужна выписка.' },
    { id: 'f_flat',   stamp: 'чт 18:20', who: 'npc', text: 'Ищу однушку у моря с первого числа, бюджет разумный. Кто знает — в личку 🙏' },
    { id: 'f_ai',     stamp: 'чт 22:15', who: 'npc', text: 'Кто уже потестил новую модель? Мне весь рефакторинг за вечер сделала.' },
    { id: 'f_ai2',    stamp: 'чт 22:17', who: 'npc', text: 'А мне сломала всё, что работало. Так что пятьдесят на пятьдесят.' },
    { id: 'f_summary',stamp: 'пт 09:00', who: 'bot', text: '📆 Что обсуждалось вчера: 🏦 банки и выписки · 🤖 новые модели · 🏠 аренда у моря · 🐱 кто потерял кота' },
    { id: 'f_announce', stamp: 'пт 11:00', who: 'org', text: '{announce}' },
    { id: 'f_poll',   stamp: 'пт 11:01', who: 'org', text: '{poll}' },
    { id: 'f_q1',     stamp: 'пт 11:30', who: 'npc', text: 'А во сколько, в семь? Я только после работы смогу.' },
    { id: 'f_a1',     stamp: 'пт 11:32', who: 'org', text: 'С семи и до упора. Приходите когда удобно.' },
    { id: 'f_q2',     stamp: 'пт 12:05', who: 'npc', text: 'Первый раз хочу прийти, как вас там узнать?' },
    { id: 'f_a2',     stamp: 'пт 12:08', who: 'npc', text: 'Ищи самый шумный стол с ноутбучными наклейками 😄' },
    { id: 'f_disc',   stamp: 'пт 14:20', who: 'npc', text: 'А скидка для чата ещё действует?' },
    { id: 'f_disc2',  stamp: 'пт 14:31', who: 'npc', text: 'В прошлый раз вроде отменили, но спросим на месте.' },
    { id: 'f_poker',  stamp: 'пт 19:40', who: 'npc', text: 'После сходки кто в покер? Ставки — ананас.' },
    { id: 'f_banana', stamp: 'пт 20:02', who: 'npc', text: 'Я принесу бананы. Не спрашивайте.' },
    { id: 'f_rain',   stamp: 'сб 10:15', who: 'npc', text: 'Обещают ливень вечером 🌧 Идём всё равно?' },
    { id: 'f_rules',  stamp: 'сб 10:20', who: 'npc', text: 'Правила встреч: идти пешком, зонты осуждаются, сидим на веранде без навеса 😂' },
    { id: 'f_kids',   stamp: 'сб 13:45', who: 'npc', text: 'Я на полчаса заскочу, если няня придёт.' },
    { id: 'f_late',   stamp: 'сб 16:10', who: 'npc', text: 'Буду ближе к десяти, работаю сегодня 😐' },
    { id: 'f_maybe',  stamp: 'сб 17:30', who: 'npc', text: 'Нажал «возможно», но это значит «да», просто стесняюсь.' },
    { id: 'f_go',     stamp: 'сб 18:40', who: 'org', text: 'Выхожу. Стол на чат — длинный у дивана.' },
  ],

  before: [
    { id: 'b_anyone',  arch: 'newbie',   icon: 'door', text: 'А кто-то уже тут? Я у входа, не пойму, туда ли пришёл 🙈', options: MEET },
    { id: 'b_core',    arch: 'oldtimer', icon: 'owl',  text: 'Такс, ядро уже здесь. Кто подтягивается?', options: [
      { id: 'me',   label: 'Я уже тут!',  icon: 'wave', ok: true, fx: { rapport: 0.06 } },
      { id: 'soon', label: 'Скоро буду',  icon: 'clock' } ] },
    { id: 'b_bar',     arch: 'quiet',    icon: 'beer', text: 'Я у бара с пивом, в серой худи. Никого не узнаю 😅', options: MEET },
    { id: 'b_parent',  arch: 'parent',   icon: 'clock', text: 'Забегу на полчасика, дети с няней до девяти! Кто уже на месте?', options: MEET },
    { id: 'b_four',    text: 'Нас пока четверо, все подтягиваются. Заходите!' },
    { id: 'b_where',   arch: 'newbie',   text: 'Какой стол ваш? Тут два зала, я запутался.', options: MEET },
    { id: 'b_junior',  arch: 'junior',   icon: 'sprout', text: 'Впервые на сходке, я джун-тестировщица, не страшно? 😅', options: [
      { id: 'meet', label: 'Приходи, встречу', icon: 'walk',  ok: true, fx: { rapport: 0.1 } },
      { id: 'fine', label: 'Совсем не страшно', icon: 'heart', ok: true, fx: { rapport: 0.06 } } ] },
  ],
  where: [
    { id: 'w_door',    arch: 'newbie',   icon: 'door', text: 'Стою у входа в SushiGO. Как вас узнать?', options: MEET },
    { id: 'w_couple',  arch: 'couple',   icon: 'rings', text: 'Мы с женой у столика на двоих в розовом уголке. Подходите знакомиться 😊', options: [
      { id: 'go',    label: 'Подойду к вам',  icon: 'walk', ok: true, fx: { rapport: 0.08 } },
      { id: 'join',  label: 'Садитесь к нам', icon: 'sofa', ok: true, fx: { rapport: 0.05 } },
      { id: 'later', label: 'Позже',          icon: 'clock' } ] },
    { id: 'w_veranda', text: 'Мы на веранде, тут воздух. Кто подышать — к нам.', options: MEET },
    { id: 'w_taxi',    text: '10–15 минут, ветер попутный 🌬 Где сидите?', options: MEET },
    { id: 'w_book',    text: 'А надо бронировать? Мы уже едем вчетвером.', options: [
      { id: 'no',   label: 'Стол сдвинем',  icon: 'sofa', ok: true, fx: { rapport: 0.04 } },
      { id: 'skip', label: 'Не знаю',       icon: 'shrug' } ] },
    { id: 'w_gamer',   arch: 'gamer',    icon: 'cue', text: 'Кто на бильярд после? Нужен четвёртый.', options: [
      { id: 'in',   label: 'Я в деле',   icon: 'cue', ok: true, fx: { rapport: 0.08 } },
      { id: 'no',   label: 'Не играю',   icon: 'shrug' } ] },
    { id: 'w_nomad',   arch: 'nomad',    icon: 'backpack', text: 'Я в городе на пару дней, можно к вам? Кого спросить?', options: MEET },
    { id: 'w_cat',     arch: 'catperson', icon: 'cat', text: 'Иду с фото котёнка, готовьтесь 🐱 Вы где?', options: MEET },
    { id: 'w_jacket',  text: 'Я в жёлтой куртке у двери, помашите кто-нибудь 👋', options: MEET },
    { id: 'w_many',    text: 'Сколько вас там? Есть куда упасть?', options: [
      { id: 'yes',  label: 'Место есть',    icon: 'sofa', ok: true, fx: { rapport: 0.04 } },
      { id: 'full', label: 'Битком, но ок', icon: 'crowd', ok: true } ] },
    { id: 'w_sus',     arch: 'suspicious', icon: 'mask', text: 'Кто хочет выгодно поменять USDT — пишите, я в баре.', options: [
      { id: 'no',   label: 'Не надо',     icon: 'shield' },
      { id: 'hm',   label: 'Интересно…',  icon: 'coin', ok: true } ] },
  ],
  late: [
    { id: 'l_where',   arch: 'latecomer', icon: 'snail', text: 'Где вы? Я только освободился, до скольки сидите?', options: [
      { id: 'till', label: 'До часу, приходи', icon: 'clock', ok: true, fx: { rapport: 0.05 } },
      { id: 'door', label: 'Встречу у входа',  icon: 'walk',  ok: true, fx: { rapport: 0.08 } },
      { id: 'mute', label: 'Промолчать',       icon: 'pause' } ] },
    { id: 'l_jam',     arch: 'latecomer', icon: 'car', text: 'Опаздываю, пробка на Руставели. Буду в {time}, не расходитесь!', options: MEET },
    { id: 'l_work',    arch: 'latecomer', text: 'Заработался 😐 Буду в {time}, кто ещё сидит?', options: MEET },
    { id: 'l_still',   arch: 'latecomer', text: 'Вы ещё сидите? Думаю подтянуться к {time}.', options: [
      { id: 'yes',  label: 'Сидим, давай!',    icon: 'beer', ok: true, fx: { rapport: 0.05 } },
      { id: 'soon', label: 'Скоро расходимся', icon: 'door' } ] },
    { id: 'l_kob',     arch: 'latecomer', text: 'Еду из Кобулети, буду в {time}. Займите мне место у бара!', options: MEET },
  ],
  background: [
    { id: 'g_sorry',   at: [20.5, 22.0], text: 'Сегодня не получится, сорри, появились дела. В следующую субботу точно!' },
    { id: 'g_photos',  at: [20.5, 22.0], text: 'Кидайте фотки, кто уже дошёл, а то я сомневаюсь идти 😄' },
    { id: 'g_lost',    at: [21.0, 22.5], text: 'Ребят, а это не тут вечеринка из Белграда? 😅' },
    { id: 'g_charger', at: [21.0, 23.0], text: 'У кого есть зарядка на тайп-си? Телефон умирает.' },
    { id: 'g_bananas', at: [21.5, 23.0], text: 'Бананы на столе, берите, не стесняйтесь 🍌' },
    { id: 'g_next',    at: [23.0, 24.0], text: 'Мы выдвигаемся в соседний бар, кто с нами?' },
    { id: 'g_home',    at: [23.5, 24.5], text: 'Я домой, было классно! Всем спасибо 🙌' },
    { id: 'g_taxi',    at: [23.8, 24.8], text: 'Кто в сторону Старого города? Возьмём такси на троих.' },
  ],

  events: {
    rain:       [{ who: 'npc', text: 'Ливень! Все с веранды внутрь, правила про зонты отменяются 🌧' }, { who: 'npc', text: 'В Батуми в дождь из дома не выходят. А мы вышли. Герои.' }],
    strobe:     [{ who: 'npc', text: 'Кто-нибудь, выключите стробоскоп, я сейчас ослепну 😵' }],
    smell:      [{ who: 'npc', text: 'Внутри пахнет обработкой от насекомых, сидим на веранде.' }],
    traffic:    [{ who: 'npc', text: 'Город стоит, я в такси уже двадцать минут на одном месте.' }],
    birthday:   [{ who: 'npc', text: 'У нас тут день рождения, шарики и торт! 🎈' }],
    discount:   [{ who: 'org', text: 'Для чата сегодня скидка 20% — скажите официанту, что вы с IT-сходки.' }],
    nodiscount: [{ who: 'npc', text: 'Скидку отменили, но суши всё равно вкусные 😔' }],
    karaoke:    [{ who: 'npc', text: 'У колонки поют! Потом всей толпой в караоке, кто с нами? 🎤' }],
    barhop:     [{ who: 'npc', text: 'Часть уходит в соседний бар, пишите, кто остаётся.' }],
    lastcall:   [{ who: 'npc', text: 'SushiGO до часу работает, так что не спешим.' }],
    photo:      [{ who: 'npc', text: 'Все в конец длинного стола, общее фото! 📸' }],
  },

  after: [
    { id: 'a_nice',    text: 'Привет, {me}! Было приятно познакомиться 🙂' },
    { id: 'a_link',    text: 'Скинь ту ссылку, про которую говорили.' },
    { id: 'a_next',    text: 'В следующую субботу придёшь?' },
    { id: 'a_thanks',  text: 'Спасибо за вечер! Это {name} из SushiGO, добавил тебя.' },
    { id: 'a_coffee',  text: 'Если что — давай на неделе кофе у моря.' },
    { id: 'a_deal',    text: 'Всё в силе, как договаривались?', need: 'deal' },
    { id: 'a_deal2',   text: 'Напомни, во сколько мы там собирались?', need: 'deal' },
    { id: 'a_pair',    text: 'Спасибо, что познакомил! Уже списались 🔥', need: 'pair' },
    { id: 'a_head',    text: 'Голова болит, но оно того стоило 🥲' },
  ],
  afterFeed: [
    { id: 'z_thanks',  who: 'org', text: 'Хорошо посидели! Спасибо всем, было нас {n} 🙌' },
    { id: 'z_photos',  who: 'npc', text: 'Фоточки подъехали 📸', need: 'photoEv' },
    { id: 'z_photos2', who: 'npc', text: 'А где я на фото? А, вот, моргнул. Как всегда.', need: 'photoEv' },
    { id: 'z_nophoto', who: 'npc', text: 'А общее фото опять забыли сделать 😅 В следующий раз — первым делом!', need: '!photoEv' },
    { id: 'z_lonely',  who: 'org', text: 'Кто вчера стеснялся подойти — в следующий раз смело к столу, мы не кусаемся 🙂', need: 'lonely' },
    { id: 'z_karaoke', who: 'npc', text: 'Кто пел у колонки — вы звёзды. Голос сорвал, не жалею 🎤', need: 'karaoke' },
    { id: 'z_pair',    who: 'npc', text: '{a} и {b} уже договорились о чём-то, сходка работает 🔥', need: 'pair' },
    { id: 'z_odd',     who: 'npc', text: 'Вчерашний «{odd}» — легенда 😄', need: 'oddball' },
    { id: 'z_friend',  who: 'npc', text: '{friend} передаёт привет всем, кто был 👋', need: 'friend' },
    { id: 'z_hang',    who: 'npc', text: 'Как же прекрасно быть здесь 😁' },
    { id: 'z_miss',    who: 'npc', text: 'Эх, я пропустил. Что обсуждали?' },
    { id: 'z_sum',     who: 'bot', text: '📆 Что обсуждалось вчера: 👋 знакомства · 🤖 ИИ и джуны · 🍣 суши · 📸 общее фото', need: 'photoEv' },
    { id: 'z_sum2',    who: 'bot', text: '📆 Что обсуждалось вчера: 👋 знакомства · 🤖 ИИ и джуны · 🍣 суши · 🏠 аренда у моря', need: '!photoEv' },
    { id: 'z_when',    who: 'npc', text: 'Когда следующая? Я теперь не пропускаю.' },
    { id: 'z_newbie',  who: 'npc', text: 'Первый раз был, всем спасибо, очень тепло приняли!', need: 'met' },
    { id: 'z_charger', who: 'npc', text: 'Кто-то забыл зарядку в SushiGO, бармен сохранил.' },
    { id: 'z_bananas', who: 'npc', text: 'Бананы все съели? Отлично, план выполнен 🍌' },
    { id: 'z_rain',    who: 'npc', text: 'Кто вчера шёл домой под ливнем без зонта — вы соблюли правила, уважаю.', need: 'rain' },
    { id: 'z_org',     who: 'org', text: 'Анонс следующей — в пятницу. Приводите друзей 💪' },
  ],
};
return { CHAT };
});
