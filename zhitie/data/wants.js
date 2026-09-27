// Желания и страхи (слой TS2) — механика (владелец: Мозг). Подписи — Писатель: data/text/wants.js по id ({label}),
// устремления — ASPIRATIONS там же ({name, desc}). match — триггер (см. js/sim/wants.js), pts — очки шкалы устремления.
import { TEXT } from '../js/sim/content.js';
import { byId } from './catalog.js';
import { socialByKey } from './socials.js';

export const ASPIRATIONS = {
  family: { name: 'Семья', icon: '👪' }, fortune: { name: 'Богатство', icon: '💰' }, knowledge: { name: 'Знания', icon: '🎓' },
  popularity: { name: 'Популярность', icon: '🌟' }, romance: { name: 'Романтика', icon: '💘' }, pleasure: { name: 'Удовольствия', icon: '🎉' },
  grow_up: { name: 'Вырасти', icon: '🧒', kids: true },
};
for (const [k, a] of Object.entries(ASPIRATIONS)) if (TEXT.aspirations[k]?.name) Object.assign(a, TEXT.aspirations[k]);

const SKILL_RU = { cooking: 'кулинарию', mechanical: 'механику', charisma: 'обаяние', body: 'тело', logic: 'логику', creativity: 'творчество' };
const SKILL_ASP = { cooking: ['family', 'pleasure'], mechanical: ['fortune', 'knowledge'], charisma: ['popularity', 'fortune'], body: ['romance', 'pleasure'], logic: ['knowledge', 'fortune'], creativity: ['knowledge', 'pleasure'] };
const KIND_RU = { piano: 'пианино', guitar: 'гитару', telescope: 'телескоп', aquarium: 'аквариум', pool_table: 'бильярд', video_game: 'приставку', hot_tub: 'джакузи',
  fireplace: 'камин', grill: 'гриль', coffee_maker: 'кофеварку', sculpture: 'скульптуру', dollhouse: 'кукольный домик', treadmill: 'беговую дорожку', pinball: 'пинбол' };
const kindName = k => KIND_RU[k] ?? byId[k]?.name?.toLowerCase() ?? k;

const W = (id, label, asp, match, pts = 10, type = 'want') => ({ id, type, label, asp, match, pts });
const list = [];
// навыки (24)
for (const sk of Object.keys(SKILL_RU)) {
  list.push(W(`skill_up_${sk}`, `Подтянуть ${SKILL_RU[sk]}`, [...SKILL_ASP[sk], 'grow_up'], { kind: 'skill', skill: sk }, 8));
  for (const n of [3, 5, 8]) list.push(W(`skill_${sk}_${n}`, `Довести ${SKILL_RU[sk]} до ${n}`, SKILL_ASP[sk], { kind: 'skill', skill: sk, level: n }, n * 5));
}
// покупки (20)
for (const [k, asp] of [['tv', ['pleasure']], ['stereo', ['pleasure', 'popularity']], ['computer_desk', ['knowledge', 'fortune']], ['piano', ['knowledge', 'pleasure']],
  ['hot_tub', ['romance', 'pleasure']], ['aquarium', ['family', 'pleasure']], ['telescope', ['knowledge']], ['painting', ['fortune']], ['bed_double', ['romance', 'family']],
  ['bathtub', ['pleasure']], ['pool_table', ['popularity', 'pleasure']], ['easel', ['knowledge']], ['exercise_bench', ['romance']], ['video_game', ['pleasure', 'grow_up']],
  ['fireplace', ['romance', 'family']], ['sculpture', ['fortune']], ['guitar', ['popularity', 'pleasure']], ['grill', ['family', 'popularity']],
  ['coffee_maker', ['fortune']], ['dollhouse', ['family', 'grow_up']]])
  list.push(W(`buy_${k}`, `Купить ${kindName(k)}`, asp, { kind: 'buy', objKind: k }, 15));
// пользоваться (14)
for (const [k, key, label, asp] of [['tv', 'watch', 'Посмотреть телевизор', ['pleasure', 'grow_up']], ['chess', 'play_chess', 'Сыграть в шахматы', ['knowledge']],
  ['stove', 'cook_meal', 'Приготовить ужин', ['family']], ['bathtub', 'bath', 'Понежиться в ванне', ['pleasure', 'romance']], ['hot_tub', 'soak', 'Отмокнуть в джакузи', ['romance', 'pleasure']],
  ['piano', 'play_piano', 'Поиграть на пианино', ['knowledge', 'popularity']], ['telescope', 'stargaze', 'Посмотреть на звёзды', ['knowledge']],
  ['pool_table', 'play_pool', 'Сыграть в бильярд', ['popularity']], ['exercise_bench', 'workout', 'Потренироваться', ['romance', 'grow_up']],
  ['easel', 'paint', 'Порисовать', ['knowledge', 'pleasure']], ['bookshelf', 'read', 'Почитать книгу', ['knowledge', 'grow_up']],
  ['stereo', 'dance', 'Потанцевать', ['pleasure', 'popularity']], ['computer_desk', 'play', 'Поиграть на компьютере', ['pleasure', 'grow_up']],
  ['crib', 'play_baby', 'Поиграть с малышом', ['family']]])
  list.push(W(`use_${key}`, label, asp, { kind: 'use', objKind: k, key }, 8));
// общение (16)
for (const [key, asp, pts] of [['talk', ['popularity', 'family', 'grow_up'], 6], ['joke', ['popularity', 'pleasure'], 8], ['hug', ['family', 'romance'], 10],
  ['kiss', ['romance'], 15], ['flirt', ['romance'], 10], ['dance_together', ['romance', 'popularity'], 12], ['tell_story', ['popularity', 'grow_up'], 8],
  ['gossip', ['popularity'], 8], ['back_rub', ['romance', 'family'], 12], ['give_gift', ['popularity', 'family'], 12], ['propose', ['romance', 'family'], 40],
  ['high_five', ['popularity', 'grow_up'], 6], ['deep_talk', ['family', 'knowledge'], 12], ['romantic_kiss', ['romance'], 20], ['entertain', ['popularity'], 10],
  ['group_talk', ['popularity'], 12]])
  list.push(W(`social_${key}`, `${socialByKey[key]?.label ?? key}`, asp, { kind: 'social', key, ok: true }, pts));
// отношения (5)
list.push(W('rel_friend', 'Завести друга', ['popularity', 'family', 'grow_up'], { kind: 'rel', status: 'friend' }, 20),
  W('rel_friends3', 'Иметь трёх друзей', ['popularity'], { kind: 'friends', count: 3 }, 35),
  W('rel_crush', 'Влюбиться', ['romance'], { kind: 'rel', status: 'crush' }, 30),
  W('rel_best', 'Лучший друг (≥ 80)', ['popularity', 'family'], { kind: 'rel', value: 80 }, 30),
  W('rel_lover', 'Найти вторую половинку', ['romance', 'family'], { kind: 'love' }, 40));
// карьера (5)
list.push(W('career_job', 'Найти работу', ['fortune'], { kind: 'career', what: 'job' }, 20),
  W('career_promote', 'Получить повышение', ['fortune', 'popularity'], { kind: 'career', what: 'promote' }, 30),
  W('career_level5', 'Дорасти до 5-го уровня', ['fortune'], { kind: 'career', what: 'promote', level: 5 }, 40),
  W('career_chance', 'Удача на работе', ['fortune'], { kind: 'career', what: 'chance_ok' }, 15),
  W('career_pay', 'Получить зарплату', ['fortune'], { kind: 'career', what: 'pay' }, 5));
// деньги (3)
for (const v of [25000, 50000, 100000]) list.push(W(`money_${v / 1000}k`, `Накопить §${v.toLocaleString('ru')}`, ['fortune'], { kind: 'money', value: v }, v / 2500));
// события (12)
list.push(W('ev_baby', 'Завести ребёнка', ['family', 'romance'], { kind: 'event', what: 'baby' }, 50),
  W('ev_party', 'Устроить вечеринку', ['popularity', 'pleasure'], { kind: 'event', what: 'party' }, 25),
  W('ev_party_great', 'Вечеринка на ★★★', ['popularity'], { kind: 'event', what: 'party', stars: 3 }, 40),
  W('ev_visitor', 'Принять гостей', ['popularity', 'family'], { kind: 'event', what: 'visitor' }, 10),
  W('ev_paint_sell', 'Продать картину', ['fortune', 'knowledge'], { kind: 'event', what: 'painting' }, 20),
  W('ev_repair', 'Починить что-нибудь', ['knowledge', 'fortune'], { kind: 'event', what: 'repair' }, 12),
  W('ev_grade_a', 'Получить пятёрку', ['grow_up', 'knowledge'], { kind: 'event', what: 'grade', grade: 80 }, 20),
  W('ev_homework', 'Сделать уроки', ['grow_up'], { kind: 'event', what: 'homework' }, 8));
for (const [t, label] of [['park', 'Съездить в парк'], ['cafe', 'Сходить в кафе'], ['shop', 'Съездить в магазин'], ['gym', 'Сходить в спортзал'], ['library', 'Сходить в библиотеку']])
  list.push(W(`trip_${t}`, label, t === 'library' ? ['knowledge'] : t === 'gym' ? ['romance', 'pleasure'] : ['pleasure', 'family', 'popularity'], { kind: 'event', what: 'travel', type: t }, 12));
// страхи (28)
const F = (id, label, asp, match, pts = 15) => W(id, label, asp, match, pts, 'fear');
list.push(F('fear_death', 'Смерть близкого', ['family', 'romance', 'popularity', 'fortune', 'knowledge', 'pleasure'], { kind: 'event', what: 'death' }, 40),
  F('fear_fire', 'Пожар', ['fortune', 'family', 'pleasure'], { kind: 'event', what: 'fire' }, 20),
  F('fear_fired', 'Увольнение', ['fortune'], { kind: 'career', what: 'fired' }, 35),
  F('fear_demoted', 'Понижение', ['fortune', 'popularity'], { kind: 'career', what: 'demote' }, 25),
  F('fear_missed', 'Опоздать на работу', ['fortune'], { kind: 'career', what: 'missed' }, 15),
  F('fear_chance_fail', 'Провал на работе', ['fortune', 'knowledge'], { kind: 'career', what: 'chance_fail' }, 15),
  F('fear_burglar', 'Грабитель', ['fortune', 'family'], { kind: 'event', what: 'burglar' }, 25),
  F('fear_broken', 'Поломка', ['fortune', 'pleasure'], { kind: 'event', what: 'broken' }, 8),
  F('fear_repo', 'Коллектор', ['fortune', 'family'], { kind: 'event', what: 'repo' }, 25),
  F('fear_puddle', 'Опозориться', ['popularity', 'romance'], { kind: 'event', what: 'puddle' }, 15),
  F('fear_passout', 'Уснуть на полу', ['pleasure', 'popularity'], { kind: 'event', what: 'passout' }, 12),
  F('fear_insulted', 'Нагрубят', ['popularity', 'family', 'grow_up'], { kind: 'social_target', mean: true }, 10),
  F('fear_baby_taken', 'Малыша заберут', ['family'], { kind: 'event', what: 'baby_taken' }, 50),
  F('fear_grade_f', 'Двойка', ['grow_up', 'family'], { kind: 'event', what: 'grade_f' }, 20),
  F('fear_shock', 'Удар током', ['knowledge', 'pleasure'], { kind: 'event', what: 'shock' }, 20),
  F('fear_party_flop', 'Провальная вечеринка', ['popularity'], { kind: 'event', what: 'party', stars: 0, max: true }, 25),
  F('fear_money_low', 'Остаться без денег', ['fortune', 'family'], { kind: 'money_low', value: 1000 }, 25),
  F('fear_enemy', 'Нажить врага', ['popularity', 'family'], { kind: 'rel', status: 'enemy' }, 20));
for (const key of ['talk', 'joke', 'hug', 'kiss', 'flirt', 'dance_together', 'give_gift', 'propose', 'romantic_kiss', 'deep_talk'])
  list.push(F(`fear_rejected_${key}`, `Отказ: ${socialByKey[key]?.label ?? key}`, ['romance', 'popularity'], { kind: 'social', key, ok: false }, key === 'propose' ? 40 : 12));

// Желания Писателя (data/text/wants.js: {id, asp, type, icon, label, kind, params, pts}) → наши триггеры; неперекладываемые — пропускаем
const EVMAP = { baby: { what: 'baby' }, marry: { what: 'marry' }, grade_a: { what: 'grade', grade: 80 }, grade_f: { what: 'grade_f' }, social_worker: { what: 'baby_taken' },
  party: { what: 'party' }, fire: { what: 'fire' }, burglar: { what: 'burglar' }, death: { what: 'death' }, repo: { what: 'repo' }, shock: { what: 'shock' },
  puddle: { what: 'puddle' }, painting: { what: 'painting' }, repair: { what: 'repair' }, homework: { what: 'homework' }, visitor: { what: 'visitor' }, broken: { what: 'broken' } };
function mapWriter(w) {
  const p = w.params ?? {};
  switch (w.kind) {
    case 'event': return p.event?.startsWith('lot:') ? { kind: 'event', what: 'travel', type: p.event.slice(4) } : EVMAP[p.event] ? { kind: 'event', ...EVMAP[p.event] } : null;
    case 'social': return p.key ? { kind: 'social', key: p.key, ok: w.type !== 'fear' } : null;
    case 'skill': return p.skill ? { kind: 'skill', skill: p.skill, ...(p.level && { level: p.level }) } : null;
    case 'buy': return p.kind || p.minPrice ? { kind: 'buy', ...(p.kind && { objKind: p.kind }), ...(p.minPrice && { price: p.minPrice }) } : null;
    case 'relation': return p.who ? null : p.status === 'friend' ? { kind: 'friends', count: p.count ?? 1 } : p.status === 'best' ? { kind: 'rel', value: 80 }
      : p.status === 'enemy' ? { kind: 'rel', status: 'enemy' } : p.status === 'crush' || p.status === 'love' ? { kind: 'love' } : null;
    case 'money': return p.gte ? { kind: 'money', value: p.gte } : p.lte != null ? { kind: 'money_low' } : null;
    case 'career': return p.level ? { kind: 'career', what: 'promote', level: p.level } : p.promote ? { kind: 'career', what: 'promote' } : p.join ? { kind: 'career', what: 'job' } : null;
    case 'motive': return p.motive ? { kind: 'motive', motive: p.motive, ...(p.lte != null ? { lte: p.lte } : { value: p.gte ?? 90 }) } : null;
    default: return null;
  }
}
const mineIds = new Set(list.map(w => w.id));
const writer = Object.values(TEXT.wants).filter(w => w?.id && !mineIds.has(w.id)).map(w => {
  const match = mapWriter(w);
  return match && { id: w.id, type: w.type === 'fear' || w.pts < 0 ? 'fear' : 'want', label: w.label, icon: w.icon,
    asp: [].concat(w.asp ?? []), match, pts: Math.max(3, Math.round(Math.abs(w.pts ?? 500) / 100)) };
}).filter(Boolean);

export const WANTS = [...list, ...writer].map(w => ({ ...w, label: TEXT.wants[w.id]?.label ?? w.label }));
export const wantById = Object.fromEntries(WANTS.map(w => [w.id, w]));
