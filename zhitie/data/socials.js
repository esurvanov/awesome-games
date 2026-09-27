// Общение сим↔сим — механика (владелец: Мозг). Подписи/реплики — Писатель: data/text/socials.js по ключу (label).
// minRel — порог согласия, showRel — видно в меню (showMax — только если отношение ниже), rel — дельта у цели при успехе, fail — при отказе.
// pers — черта ЦЕЛИ, повышающая согласие ('-nice' — понижающая). mean — «злое»: происходит всегда. romantic — только взрослые.
// group — разговор втроём+: ближние свободные тоже втягиваются. kids — только если один из пары ребёнок. cost — стоит денег.
// Анимации — только из списка CONTRACT §5.
import { TEXT } from '../js/sim/content.js';

const ad = (motive, delta, min = 100, atten = 'medium', pers = null) => ({ motive, delta, min, pers, atten });
// короткая запись: [key, label, icon, anim, targetAnim, мин, minRel, showRel, pers, rel, fail, effects, extra]
const row = ([key, label, icon, anim, targetAnim, duration, minRel, showRel, pers, rel, fail, effects, extra = {}]) =>
  ({ key, label, icon, anim, targetAnim, duration, minRel, showRel, pers, rel, fail, effects, speak: icon, ...extra });

const BASE = [
  { key: 'greet', label: 'Поприветствовать', icon: '👋', anim: 'wave', targetAnim: 'wave', duration: 2, minRel: -100, showRel: -100,
    rel: 5, fail: 0, effects: { social: 2 }, speak: '👋', advertisements: [ad('social', 15, 80, 'medium', 'outgoing')], autoOnly: 'townie' },
  { key: 'invite_in', label: 'Пригласить в дом', icon: '🏠', anim: 'wave', targetAnim: 'yes', duration: 2, minRel: -10, showRel: -100, only: 'townie',
    rel: 3, fail: -2, effects: { social: 3 }, speak: '🏠', done: 'inviteIn' },
  { key: 'ask_leave', label: 'Попросить уйти', icon: '🚪', anim: 'talk', targetAnim: 'wave', duration: 2, minRel: -100, showRel: -100, only: 'visitor', mean: true,
    rel: -3, fail: -3, effects: {}, speak: '🚪', done: 'askLeave' },
  // ✅ TS1: разговор — короткий обмен (6 мин), дальше оба решают заново
  { key: 'talk', label: 'Поболтать', icon: '💬', anim: 'talk', targetAnim: 'talk', duration: 6, minRel: -50, showRel: -100, pers: 'outgoing',
    rel: 6, fail: -2, effects: { social: 1.2, fun: 0.2 }, perMinute: true, topics: ['🌦️', '⚽', '💰', '📺', '🐈', '🍕', '🚗', '🎸'],
    advertisements: [ad('social', 40, 70, 'medium', 'outgoing')] },
  { key: 'joke', label: 'Пошутить', icon: '😂', anim: 'talk', targetAnim: 'laugh', duration: 4, minRel: -20, showRel: -30, pers: 'playful',
    rel: 4, fail: -3, effects: { social: 5, fun: 6 }, speak: '😂',
    advertisements: [ad('fun', 20, 70, 'medium', 'playful'), ad('social', 20, 70, 'medium', 'playful')] },
  { key: 'compliment', label: 'Сделать комплимент', icon: '💐', anim: 'talk', targetAnim: 'yes', duration: 3, minRel: 0, showRel: 10, pers: 'nice',
    rel: 5, fail: -3, effects: { social: 5 }, speak: '💐' },
  { key: 'hug', label: 'Обнять', icon: '🤗', anim: 'interact', targetAnim: 'interact', duration: 3, minRel: 35, showRel: 20, pers: 'outgoing',
    rel: 7, fail: -6, effects: { social: 8, comfort: 2 }, speak: '🤗',
    advertisements: [ad('social', 25, 60, 'medium', 'outgoing')], autoMinRel: 50 },
  { key: 'flirt', label: 'Флиртовать', icon: '😏', anim: 'talk', targetAnim: 'laugh', duration: 3, minRel: 40, showRel: 30, pers: 'playful', romantic: true,
    rel: 6, fail: -8, effects: { social: 6, fun: 3 }, speak: '😏' },
  { key: 'kiss', label: 'Поцеловать', icon: '💋', anim: 'interact', targetAnim: 'interact', duration: 3, minRel: 70, showRel: 60, pers: 'outgoing', romantic: true,
    rel: 8, fail: -12, effects: { social: 10, fun: 4 }, speak: '💋' },
  { key: 'insult', label: 'Оскорбить', icon: '🤬', anim: 'angry', targetAnim: 'cry', duration: 3, minRel: -100, showRel: -100, mean: true,
    rel: -10, fail: -10, effects: { social: 2 }, targetEffects: { social: -5, fun: -5 }, speak: '🤬',
    advertisements: [ad('fun', 15, 60, 'medium', '-nice')], autoMaxRel: -30 },
  { key: 'slap', label: 'Дать пощёчину', icon: '✋', anim: 'angry', targetAnim: 'cry', duration: 2, minRel: -100, showRel: -20, mean: true,
    rel: -15, fail: -15, effects: { social: 2 }, targetEffects: { social: -8, comfort: -5 }, speak: '✋' },
  { key: 'goodbye', label: 'Попрощаться', icon: '🙋', anim: 'wave', targetAnim: 'wave', duration: 2, minRel: -100, showRel: -100,
    rel: 0, fail: 0, effects: { social: 1 }, speak: '👋' },];

const MORE = [
  // дружеские
  ['deep_talk', 'Задушевная беседа', '🫖', 'sitTalk', 'sitTalk', 10, 30, 20, 'nice', 8, -3, { social: 12, fun: 2 }, { advertisements: [ad('social', 35, 50, 'medium', 'nice')], autoMinRel: 40 }],
  ['gossip', 'Посплетничать', '🤫', 'talk', 'laugh', 5, 10, 0, 'playful', 5, -3, { social: 8, fun: 4 }, { advertisements: [ad('social', 20, 70, 'medium', '-nice')] }],
  ['tell_story', 'Рассказать историю', '📖', 'talk', 'laugh', 6, 0, -10, 'playful', 5, -2, { social: 8, fun: 6 }, { advertisements: [ad('fun', 15, 70, 'medium', 'playful')] }],
  ['brag', 'Похвастаться', '🦚', 'talk', 'no', 3, 20, 0, '-nice', 2, -5, { social: 4, fun: 3 }],
  ['tease', 'Подразнить', '😜', 'laugh', 'laugh', 3, 25, 10, 'playful', 3, -6, { social: 5, fun: 6 }],
  ['tickle', 'Пощекотать', '🪶', 'interact', 'laugh', 3, 40, 30, 'playful', 6, -6, { social: 6, fun: 8 }, { advertisements: [ad('fun', 20, 60, 'medium', 'playful')], autoMinRel: 50 }],
  ['high_five', 'Дать пять', '🙌', 'yes', 'yes', 2, 10, 0, 'outgoing', 4, -2, { social: 4, fun: 3 }],
  ['back_rub', 'Помассировать спину', '💆', 'interact', 'yes', 6, 45, 35, 'nice', 7, -6, { social: 6 }, { targetEffects: { comfort: 15, social: 6 } }],
  ['cheer_up', 'Подбодрить', '🌞', 'talk', 'yes', 4, 10, 0, 'nice', 6, -2, { social: 5 }, { targetEffects: { fun: 10, social: 6 } }],
  ['apologize', 'Извиниться', '🙏', 'talk', 'yes', 3, -100, -100, 'nice', 10, 2, { social: 3 }, { showMax: 0 }],
  ['thank', 'Поблагодарить', '🙇', 'talk', 'yes', 2, -20, 0, 'nice', 4, 0, { social: 3 }],
  ['ask_advice', 'Спросить совета', '🧭', 'talk', 'talk', 5, 15, 10, 'nice', 5, -2, { social: 6, fun: 2 }],
  ['discuss_work', 'Поговорить о работе', '💼', 'talk', 'talk', 6, 0, -10, 'outgoing', 3, -2, { social: 7 }],
  ['discuss_hobby', 'Поговорить о хобби', '🎨', 'talk', 'talk', 6, 0, -10, 'playful', 5, -2, { social: 7, fun: 4 }, { advertisements: [ad('social', 25, 70, 'medium', 'playful')] }],
  ['talk_weather', 'Поговорить о погоде', '🌦️', 'talk', 'talk', 3, -60, -100, null, 2, -1, { social: 4 }, { advertisements: [ad('social', 15, 80, 'high')] }],
  ['talk_politics', 'Поговорить о политике', '🗳️', 'talk', 'angry', 5, 30, 10, 'nice', 4, -8, { social: 6 }],
  ['tell_secret', 'Поделиться секретом', '🔐', 'talk', 'yes', 4, 50, 45, 'nice', 9, -8, { social: 9 }],
  ['play_rps', 'Камень-ножницы-бумага', '✊', 'laugh', 'laugh', 3, -10, -20, 'playful', 4, -2, { social: 4, fun: 8 }, { advertisements: [ad('fun', 15, 70, 'medium', 'playful')] }],
  ['dance_together', 'Потанцевать вместе', '💃', 'dance', 'dance', 8, 20, 10, 'outgoing', 6, -4, { social: 10, fun: 10, energy: -2 }, { advertisements: [ad('fun', 25, 60, 'medium', 'active')], autoMinRel: 30 }],
  ['give_gift', 'Сделать подарок (§50)', '🎁', 'interact', 'yes', 3, -40, 0, 'nice', 12, -2, { social: 6 }, { cost: 50 }],
  ['entertain', 'Развлечь', '🤹', 'dance', 'laugh', 5, 0, -10, 'playful', 6, -4, { social: 6, fun: 8 }, { advertisements: [ad('fun', 20, 60, 'medium', 'outgoing')] }],
  ['impress', 'Произвести впечатление', '💪', 'yes', 'yes', 3, 20, 10, 'active', 5, -5, { social: 5 }],
  ['show_trick', 'Показать фокус', '🎩', 'interact', 'laugh', 4, -10, -10, 'playful', 5, -3, { social: 5, fun: 6 }],
  ['sing', 'Спеть', '🎤', 'dance', 'laugh', 4, 0, -10, 'outgoing', 4, -3, { social: 5, fun: 7 }],
  ['toast', 'Поднять тост', '🥂', 'drink', 'drink', 3, 20, 10, 'outgoing', 5, -2, { social: 6, fun: 4 }],
  ['compliment_look', 'Похвалить внешность', '✨', 'talk', 'yes', 2, 20, 10, 'outgoing', 5, -5, { social: 5 }],
  ['ask_about_day', 'Спросить, как день', '☕', 'talk', 'talk', 4, -30, -50, 'nice', 4, -1, { social: 6 }, { advertisements: [ad('social', 25, 75, 'medium', 'nice')] }],
  ['group_talk', 'Общий разговор', '👥', 'talk', 'talk', 8, 0, -20, 'outgoing', 5, -2, { social: 1.2, fun: 0.3 }, { group: true, perMinute: true, topics: ['🌦️', '⚽', '🎬', '🍕'], advertisements: [ad('social', 40, 60, 'medium', 'outgoing')] }],
  // романтика (взрослые)
  ['wink', 'Подмигнуть', '😉', 'yes', 'laugh', 2, 30, 25, 'playful', 4, -6, { social: 4, fun: 3 }, { romantic: true }],
  ['whisper', 'Шепнуть на ушко', '🗨️', 'talk', 'laugh', 3, 50, 40, 'playful', 6, -8, { social: 6 }, { romantic: true }],
  ['hold_hands', 'Взять за руку', '🤝', 'interact', 'interact', 4, 55, 45, 'nice', 7, -10, { social: 8, comfort: 3 }, { romantic: true }],
  ['cuddle', 'Нежно обнять', '🥰', 'interact', 'interact', 5, 65, 55, 'nice', 8, -10, { social: 10, comfort: 5 }, { romantic: true }],
  ['slow_dance', 'Медленный танец', '🕺', 'dance', 'dance', 8, 60, 50, 'outgoing', 8, -10, { social: 10, fun: 8 }, { romantic: true }],
  ['serenade', 'Спеть серенаду', '🎶', 'dance', 'yes', 5, 60, 50, 'playful', 8, -10, { social: 8, fun: 5 }, { romantic: true }],
  ['romantic_kiss', 'Страстный поцелуй', '💘', 'interact', 'interact', 4, 80, 70, 'outgoing', 10, -15, { social: 12, fun: 6 }, { romantic: true }],
  ['propose', 'Сделать предложение', '💍', 'interact', 'yes', 4, 90, 80, 'nice', 15, -20, { social: 15, fun: 10 }, { romantic: true, done: 'propose' }],
  // злые
  ['argue', 'Поспорить', '🗯️', 'angry', 'angry', 4, -100, -100, null, -6, -6, { social: 2 }, { mean: true, targetEffects: { fun: -4 } }],
  ['poke', 'Ткнуть пальцем', '👉', 'interact', 'angry', 2, -100, -100, null, -4, -4, { fun: 3 }, { mean: true }],
  ['mock', 'Высмеять', '🤡', 'laugh', 'cry', 3, -100, -100, null, -8, -8, { fun: 4 }, { mean: true, targetEffects: { social: -6, fun: -4 } }],
  ['shove', 'Толкнуть', '🫸', 'angry', 'angry', 2, -100, -60, null, -10, -10, { fun: 2 }, { mean: true, targetEffects: { comfort: -8 } }],
  ['yell', 'Накричать', '📢', 'angry', 'cry', 3, -100, -100, null, -8, -8, { social: 1 }, { mean: true, targetEffects: { fun: -6 } }],
  ['blame', 'Обвинить', '☝️', 'angry', 'no', 3, -100, -100, null, -6, -6, { social: 1 }, { mean: true }],
  ['fight', 'Подраться', '🥊', 'angry', 'angry', 5, -100, -40, null, -20, -20, { energy: -10 }, { mean: true, done: 'fight', targetEffects: { energy: -10 } }],
  // дети и с детьми
  ['play_tag', 'Играть в догонялки', '🏃', 'run', 'run', 8, -20, -20, 'playful', 6, -3, { social: 6, fun: 12, energy: -4 }, { kids: true, advertisements: [ad('fun', 30, 70, 'medium', 'active')] }],
  ['read_story', 'Почитать сказку', '📚', 'read', 'sitIdle', 10, 0, -20, 'nice', 8, -2, { social: 8 }, { kids: true, targetEffects: { fun: 12, social: 10 } }],
  ['pillow_fight', 'Бой подушками', '🪶', 'laugh', 'laugh', 5, 10, 0, 'playful', 6, -3, { social: 6, fun: 12 }, { kids: true }],
].map(row);

// Новые ключи Писателя (hint{rel, fail, minRel, pers, needs, romantic, mean, group, kids, adultOnly}) — механика из подсказки, анимация по смыслу
const ANIM_FOR = { complain: ['talk', 'talk'], poem: ['talk', 'yes'], raspberry: ['laugh', 'angry'], impersonate: ['laugh', 'laugh'], console: ['talk', 'yes'],
  party: ['dance', 'dance'], tuck_in: ['interact', 'yes'], praise_kid: ['talk', 'yes'], scold: ['angry', 'cry'], hide_seek: ['run', 'run'] };
const mine = new Set([...BASE, ...MORE].map(s => s.key));
const WRITER = Object.values(TEXT.socials).filter(t => t?.key && !mine.has(t.key) && t.hint).map(t => {
  const h = t.hint, [anim, targetAnim] = ANIM_FOR[t.key] ?? (h.mean ? ['angry', 'cry'] : ['talk', 'yes']);
  return { key: t.key, label: t.label, icon: t.icon ?? '💬', anim, targetAnim, duration: h.group ? 8 : 4, minRel: h.minRel ?? 0, showRel: Math.min(h.minRel ?? 0, 0) - 20,
    pers: h.pers ?? null, rel: h.rel ?? 3, fail: h.fail ?? -3, effects: h.needs ?? { social: 4 }, speak: t.icon ?? '💬',
    ...(h.romantic && { romantic: true }), ...(h.mean && { mean: true }), ...(h.group && { group: true }), ...(h.kids && { kids: true }), ...(h.adultOnly && { adultOnly: true }),
    ...(t.topics && { topics: t.topics }) };
});

// Подписи Писателя поверх механики
// Категория меню (Писатель: Разговор/Шутка/Нежность/Ссора/Игра/Романтика/Семья/Дети); без текста — по механике
const catOf = s => TEXT.socials[s.key]?.cat ?? (s.romantic ? 'Романтика' : s.mean ? 'Ссора' : s.kids ? 'Дети' : 'Разговор');
export const SOCIALS = [...BASE, ...MORE, ...WRITER].map(s => ({ ...s, label: TEXT.socials[s.key]?.label ?? s.label, category: catOf(s) }));
export const SOCIAL_CATEGORIES = ['Разговор', 'Шутка', 'Нежность', 'Ссора', 'Игра', 'Романтика', 'Семья', 'Дети'];
export const socialByKey = Object.fromEntries(SOCIALS.map(s => [s.key, s]));
