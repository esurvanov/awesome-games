// Взаимодействия «Житьё»: что предмет умеет и что он «рекламирует» (аналог TTAB в TS1).
// Владелец: Мозг. Ключ — id из data/catalog.js. Эффекты выведены из рейтингов каталога формулами DERIVE (js/core/tuning.js).
//
// Взаимодействие: { key, label, icon, advertisements:[{motive, delta, min, pers, atten}], cap?, goodMood?, show?(ctx), check?(ctx)→причина,
//                   steps:[шаг] | поля шага прямо в нём }
// Шаг: { at:'self'|'here'|'tile'|'sim'|'seat'|{def}, optional?, fallback?, spot?: slot | [slot…] (из world.useSpots; без spot — стоячие точки), anim:{entry?,loop,exit?}, duration (игр. мин), until?,
//        effects:{motive: за минуту}, skill?:{name, mult}, stateFx?:{dirty, uses}, asleep?, posture?, breakOn?, done?:'хук' }
// ctx = { state, sim, obj, target }.  pers: 'nice'|'outgoing'|'active'|'playful'|'neat', '-nice' — инвертированная.
// atten: 'none'|'low'|'medium'|'high'.  min: реклама видна автономии, только если потребность НИЖЕ min.
import { byId } from './catalog.js';
import { DERIVE, AUTONOMY, BREAK, DIRT, SERVICES, FAMILY, EASEL } from '../js/core/tuning.js';

let KB = {};   // базовые рейтинги новых видов (заполняется ниже)
const rt = (def, m) => byId[def]?.ratings?.[m] ?? KB[def]?.[m] ?? 0;
const ad = (motive, delta, min = 100, atten = 'medium', pers = null) => ({ motive, delta, min, pers, atten });
const minutes = (total, perMin) => Math.max(1, Math.round(total / perMin));

// ── Строительные блоки ────────────────────────────────────────────────
function sitI(def, extra = {}) {
  const c = rt(def, 'comfort');
  return {
    key: 'sit', label: 'Сесть', icon: '🪑',
    advertisements: [ad('comfort', DERIVE.adDelta(c), 70, 'high')],
    at: 'self', spot: 'sit', posture: 'sit',
    anim: { entry: 'sit', loop: 'sitIdle', exit: 'standUp' },
    duration: 60, until: { motive: 'comfort', gte: 100 },
    effects: { comfort: DERIVE.comfortPerMin(c) }, breakOn: -60, ...extra,
  };
}

function sleepI(def, key = 'sleep') {
  const e = rt(def, 'energy'), c = rt(def, 'comfort');
  const night = key === 'sleep';
  return {
    key, label: night ? 'Спать' : 'Вздремнуть', icon: night ? '🛏️' : '😴',
    advertisements: night
      ? [ad('energy', DERIVE.adDelta(e) + 20, 0, 'low'), ad('comfort', DERIVE.adDelta(c) / 2, 50, 'low')]
      : [ad('energy', DERIVE.adDelta(e), 30, 'medium'), ad('comfort', DERIVE.adDelta(c), 60, 'medium')],
    at: 'self', spot: def === 'sofa' ? 'sit' : 'lie', posture: 'lie', asleep: true,
    anim: { entry: 'lieDown', loop: 'sleep', exit: 'getUp' },
    duration: night ? 14 * 60 : 90,
    until: night ? { motive: 'energy', gte: 100, wakeHours: [7, 12], wakeAt: 80 } : { motive: 'energy', gte: 100 },
    effects: { energy: DERIVE.energyPerMin(e), comfort: DERIVE.comfortPerMin(c) },
    breakOn: -85, sleepAd: night, dayOnly: !night,
  };
}

const travelI = { key: 'travel', label: 'Поехать…/', icon: '🚕', dynamic: 'lots', advertisements: [], at: 'here', anim: { loop: 'wave' }, duration: 1, done: 'travel' };
const nightCheck = ({ state }) => { const h = Math.floor(state.time.minutes / 60) % 24; return h >= SERVICES.invite.noAfter && h < SERVICES.invite.noBefore ? 'Все спят' : null; };
const dirtyShow = min => ({ obj }) => (obj?.st?.dirty ?? 0) >= min;
function cleanI(label = 'Почистить') {
  return {
    key: 'clean', label, icon: '🧽', show: dirtyShow(20),
    advertisements: [ad('room', 25, 100, 'medium', 'neat')],
    at: 'self', anim: { loop: 'wash' }, duration: 15, done: 'clean', skill: null,
  };
}

// Цепочка «Приготовить ужин»: холодильник → плита → место за столом (или на месте) → поесть
function mealI(startAt) {
  const r = (rt('fridge', 'hunger') + rt('stove', 'hunger')) / 2;
  const total = DERIVE.mealTotal(r);
  return {
    key: 'cook_meal', label: 'Приготовить ужин', icon: '🍲', adult: true,
    advertisements: [ad('hunger', total, 60, 'low')],
    steps: [
      { at: startAt === 'fridge' ? 'self' : { def: 'fridge' }, optional: startAt !== 'fridge', anim: { entry: 'pickup', loop: 'interact' }, duration: 2 },
      { at: startAt === 'fridge' ? { def: 'stove' } : 'self', optional: true, anim: { loop: 'cook' }, duration: 15,
        skill: { name: 'cooking', mult: 0.5 }, stateFx: { dirty: 4, uses: 1 }, fireRisk: true },
      { at: 'seat', fallback: 'here', anim: { loop: 'eat', exit: 'standUp' }, duration: 20,
        effects: { hunger: total / 20 }, meal: true, dishes: true, breakOn: -90 },
    ],
  };
}

// ── Таблица по предметам ──────────────────────────────────────────────
export const INTERACTIONS = {
  fridge: [
    mealI('fridge'),
    { key: 'snack', label: 'Перекусить', icon: '🥪', advertisements: [ad('hunger', DERIVE.snackTotal, 80, 'medium')],
      at: 'self', anim: { entry: 'pickup', loop: 'eat' }, duration: 5, effects: { hunger: DERIVE.snackTotal / 5 }, meal: true },
  ],
  stove: [mealI('stove'), cleanI()],
  counter: [],
  kitchen_sink: [
    { key: 'wash_hands', label: 'Помыть руки', icon: '🧼', advertisements: [ad('hygiene', DERIVE.adDelta(rt('kitchen_sink', 'hygiene')), 60, 'medium')],
      at: 'self', anim: { loop: 'wash' }, duration: 5, effects: { hygiene: DERIVE.hygienePerMin(rt('kitchen_sink', 'hygiene')) } },
  ],
  dining_table: [],
  dining_chair: [sitI('dining_chair')],
  trash_can: [],
  sofa: [sitI('sofa', { cap: 2 }), { ...sleepI('sofa', 'nap'), cap: 2 }],
  armchair: [sitI('armchair')],
  coffee_table: [],
  tv: [
    { key: 'watch', label: 'Смотреть ТВ', icon: '📺', advertisements: [ad('fun', DERIVE.adDelta(rt('tv', 'fun')), 90, 'medium', 'playful')],
      at: 'self', spot: ['sit', 'watch'], anim: { entry: 'sit', loop: 'watchTV', exit: 'standUp' }, duration: 90, until: { motive: 'fun', gte: 100 },
      effects: { fun: DERIVE.funPerMin(rt('tv', 'fun')) }, breakOn: -60, cap: 4 },
  ],
  stereo: [
    { key: 'dance', label: 'Танцевать', icon: '💃', advertisements: [ad('fun', DERIVE.adDelta(rt('stereo', 'fun')) + 10, 90, 'medium', 'active')],
      at: 'self', spot: 'any', anim: { loop: 'dance' }, duration: 45, until: { motive: 'fun', gte: 100 },
      effects: { fun: DERIVE.funPerMin(rt('stereo', 'fun')) + 0.1, energy: -0.1 }, skill: { name: 'body', mult: 0.3 }, breakOn: -60, cap: 3 },
  ],
  bookshelf: [
    { key: 'study_cooking', label: 'Учить кулинарию', icon: '📖', goodMood: true, advertisements: [ad('fun', 5, 60, 'medium', 'neat')], skillAd: true,
      at: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 60, skill: { name: 'cooking', mult: 1 }, breakOn: -50 },
    { key: 'study_mechanical', label: 'Учить механику', icon: '🔧', goodMood: true, advertisements: [ad('fun', 5, 60, 'medium', 'neat')], skillAd: true,
      at: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 60, skill: { name: 'mechanical', mult: 1 }, breakOn: -50 },
    { key: 'read', label: 'Почитать', icon: '📚', advertisements: [ad('fun', DERIVE.adDelta(rt('bookshelf', 'fun')) + 10, 80, 'medium')],
      at: 'seat', fallback: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 45, until: { motive: 'fun', gte: 100 },
      effects: { fun: DERIVE.funPerMin(rt('bookshelf', 'fun')) }, breakOn: -60 },
  ],
  computer_desk: [
    { key: 'play', label: 'Играть', icon: '🎮', advertisements: [ad('fun', DERIVE.adDelta(rt('computer_desk', 'fun')), 90, 'medium', 'playful')],
      at: 'self', spot: ['sit', 'use'], posture: 'sit', anim: { entry: 'sit', loop: 'useComputer', exit: 'standUp' }, duration: 60, until: { motive: 'fun', gte: 100 },
      effects: { fun: DERIVE.funPerMin(rt('computer_desk', 'fun')), comfort: DERIVE.comfortPerMin(2) }, breakOn: -60 },
    { key: 'find_job', label: 'Искать работу', icon: '💼', goodMood: true, adult: true, jobs: 'computer', advertisements: [],
      at: 'self', spot: ['sit', 'use'], posture: 'sit', anim: { entry: 'sit', loop: 'useComputer', exit: 'standUp' }, duration: 30, done: 'findJob' },
  ],
  chess: [
    { key: 'play_chess', label: 'Играть в шахматы', icon: '♟️', advertisements: [ad('fun', DERIVE.adDelta(rt('chess', 'fun')) + 10, 80, 'medium', 'playful')], skillAd: true,
      at: 'self', spot: 'play', anim: { loop: 'interact' }, duration: 60,
      effects: { fun: DERIVE.funPerMin(rt('chess', 'fun')) }, skill: { name: 'logic', mult: 1 }, breakOn: -50 },
  ],
  phone: [
    { key: 'call_friend', label: 'Позвонить знакомому', icon: '☎️', advertisements: [ad('social', 30, 50, 'medium', 'outgoing')],
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 20, effects: { social: 1, fun: 0.2 }, done: 'phoneChat', breakOn: -60,
      check: nightCheck },
    { key: 'call_maid', label: 'Вызвать…/Горничная', icon: '🧹', advertisements: [], show: ({ state }) => !state.household.services?.maid,
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 2, done: 'hireMaid' },
    { key: 'fire_maid', label: 'Вызвать…/Отказаться от горничной', icon: '🧹', advertisements: [], show: ({ state }) => !!state.household.services?.maid,
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 2, done: 'fireMaid' },
    { key: 'call_repair', label: 'Вызвать…/Мастер', icon: '🔧', advertisements: [],
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 2, done: 'callRepair' },
    { key: 'call_pizza', label: `Вызвать…/Пицца (§${SERVICES.pizza.price})`, icon: '🍕', advertisements: [],
      check: ({ state }) => state.household.money < SERVICES.pizza.price ? 'Не хватает денег' : null,
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 2, done: 'callPizza' },
    { key: 'invite', label: 'Пригласить…/', icon: '📞', dynamic: 'townies', advertisements: [], check: nightCheck,
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 3, done: 'invite' },
    { key: 'throw_party', label: 'Устроить вечеринку', icon: '🎉', adult: true, advertisements: [], check: nightCheck,
      at: 'self', anim: { entry: 'pickup', loop: 'phone' }, duration: 5, done: 'throwParty' },
    travelI,
  ],
  bed_single: [sleepI('bed_single'), { ...sleepI('bed_single', 'nap') }],
  bed_double: [{ ...sleepI('bed_double'), cap: 2 }, { ...sleepI('bed_double', 'nap'), cap: 2 },
    { key: 'try_baby', label: 'Попробовать завести ребёнка', icon: '👶', adult: true, advertisements: [], cap: 2, romance: true,
      at: 'self', spot: 'lie', posture: 'lie', anim: { entry: 'lieDown', loop: 'laugh', exit: 'getUp' }, duration: 10,
      effects: { fun: 1, social: 1 }, done: 'tryBaby' }],
  dresser: [
    { key: 'change', label: 'Переодеться', icon: '👕', advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 3 },
  ],
  mirror: [
    { key: 'practice_speech', label: 'Репетировать речь', icon: '🗣️', goodMood: true, advertisements: [ad('fun', 5, 60, 'medium', 'outgoing')], skillAd: true,
      at: 'self', anim: { loop: 'talk' }, duration: 45, skill: { name: 'charisma', mult: 1 }, breakOn: -50 },
  ],
  toilet: [
    { key: 'use', label: 'Сходить в туалет', icon: '🚽', advertisements: [ad('bladder', DERIVE.adDelta(rt('toilet', 'bladder')), 60, 'low')],
      at: 'self', spot: 'sit', posture: 'sit', anim: { entry: 'sit', loop: 'toilet', exit: 'standUp' },
      duration: minutes(200, DERIVE.bladderPerMin(rt('toilet', 'bladder'))), until: { motive: 'bladder', gte: 100 },
      effects: { bladder: DERIVE.bladderPerMin(rt('toilet', 'bladder')) }, stateFx: { dirty: 5, uses: 1 } },
    cleanI(),
  ],
  shower: [
    { key: 'shower', label: 'Принять душ', icon: '🚿', advertisements: [ad('hygiene', DERIVE.adDelta(rt('shower', 'hygiene')), 60, 'low', 'neat')],
      at: 'self', spot: 'in', anim: { loop: 'shower' }, duration: 30, until: { motive: 'hygiene', gte: 100 },
      effects: { hygiene: DERIVE.hygienePerMin(rt('shower', 'hygiene')) }, stateFx: { dirty: 6, uses: 1 } },
    cleanI(),
  ],
  bathtub: [
    { key: 'bath', label: 'Принять ванну', icon: '🛁', advertisements: [ad('hygiene', DERIVE.adDelta(rt('bathtub', 'hygiene')), 60, 'low', 'neat'), ad('comfort', DERIVE.adDelta(rt('bathtub', 'comfort')), 60, 'low')],
      at: 'self', spot: 'in', posture: 'lie', anim: { entry: 'sit', loop: 'shower', exit: 'standUp' }, duration: 40, until: { motive: 'hygiene', gte: 100 },
      effects: { hygiene: DERIVE.hygienePerMin(rt('bathtub', 'hygiene')), comfort: DERIVE.comfortPerMin(rt('bathtub', 'comfort')) }, stateFx: { dirty: 6, uses: 1 } },
    { key: 'play_bath', label: 'Поиграть в ванне', icon: '🦆', show: ({ sim }) => sim.personality.playful >= 8,   // ✅ Playful ≥ 8
      advertisements: [ad('fun', 40, 80, 'medium', 'playful')],
      at: 'self', spot: 'in', posture: 'lie', anim: { entry: 'sit', loop: 'laugh', exit: 'standUp' }, duration: 30,
      effects: { fun: 0.8, hygiene: 1 }, stateFx: { dirty: 4, uses: 1 } },
    cleanI(),
  ],
  bath_sink: [
    { key: 'wash_hands', label: 'Помыть руки', icon: '🧼', advertisements: [ad('hygiene', DERIVE.adDelta(rt('bath_sink', 'hygiene')), 60, 'medium')],
      at: 'self', anim: { loop: 'wash' }, duration: 5, effects: { hygiene: DERIVE.hygienePerMin(rt('bath_sink', 'hygiene')) } },
  ],
  floor_lamp: [
    { key: 'turn_on', label: 'Включить', icon: '💡', show: ({ obj }) => obj?.st?.on === false, advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 1, done: 'lampOn' },
    { key: 'turn_off', label: 'Выключить', icon: '🌑', show: ({ obj }) => obj?.st?.on !== false, advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 1, done: 'lampOff' },
  ],
  painting: [
    { key: 'view', label: 'Любоваться', icon: '🖼️', advertisements: [ad('fun', 10, 60, 'high')], at: 'self', anim: { loop: 'idle' }, duration: 10, effects: { fun: 0.3 } },
  ],
  plant: [
    { key: 'water', label: 'Полить', icon: '🌱', advertisements: [ad('room', 10, 100, 'high', 'neat')], at: 'self', anim: { loop: 'interact' }, duration: 3, done: 'water',
      show: ({ obj, state }) => (state.time.minutes - (obj?.st?.watered ?? -1e9)) > 12 * 60 },
  ],
  rug: [],
  mailbox: [
    { key: 'pay_bills', label: 'Оплатить счета', icon: '💸', advertisements: [], show: ({ state }) => state.household.bills.length > 0,
      check: ({ state }) => state.household.money < state.household.bills.reduce((s, b) => s + b.amount, 0) ? 'Не хватает денег' : null,
      at: 'self', anim: { loop: 'interact' }, duration: 3, done: 'payBills' },
    travelI,
    { key: 'newspaper', label: 'Газета: вакансии', icon: '📰', goodMood: true, adult: true, jobs: 'newspaper', advertisements: [], at: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 10, done: 'findJob' },
    { key: 'go_to_work', label: 'Поехать на работу', icon: '🚗', adult: true, advertisements: [], show: ({ sim }) => !!sim.career,
      check: ({ state, sim }) => (sim.brain?.carpoolDay === Math.floor(state.time.minutes / 1440) ? null : 'Машина ещё не приехала'),
      at: 'self', anim: { loop: 'wave' }, duration: 1, done: 'goWork' },
  ],
  door: [],
  window: [],
  exercise_bench: [
    { key: 'workout', label: 'Тренироваться', icon: '🏋️', advertisements: [ad('fun', DERIVE.adDelta(rt('exercise_bench', 'fun')), 70, 'medium', 'active')], skillAd: true,
      at: 'self', anim: { loop: 'exercise' }, duration: 60, effects: { fun: DERIVE.funPerMin(rt('exercise_bench', 'fun')), hygiene: -0.3, energy: -0.1 },
      skill: { name: 'body', mult: 1 }, breakOn: -50 },
  ],
  easel: [
    { key: 'paint', label: 'Рисовать', icon: '🎨', advertisements: [ad('fun', DERIVE.adDelta(rt('easel', 'fun')), 80, 'medium', 'playful')], skillAd: true,
      at: 'self', anim: { loop: 'interact' }, duration: 60, effects: { fun: DERIVE.funPerMin(rt('easel', 'fun')) },
      skill: { name: 'creativity', mult: 1 }, done: 'paintProgress', breakOn: -50 },
    { key: 'sell_painting', label: 'Продать картину', icon: '💰', advertisements: [], show: ({ obj }) => (obj?.st?.canvas ?? 0) >= EASEL.finishMinutes,
      at: 'self', anim: { loop: 'interact' }, duration: 2, done: 'sellPainting' },
  ],
  smoke_alarm: [],
  burglar_alarm: [],
  stairs: [],
  crib: [
    { key: 'feed_baby', label: 'Покормить малыша', icon: '🍼', show: ({ obj }) => !!obj?.st?.baby, adult: true,
      advertisements: [{ motive: 'hunger', src: 'baby', delta: FAMILY.babyFeed, min: 40, pers: 'nice', atten: 'low' }],
      at: 'self', anim: { entry: 'pickup', loop: 'interact' }, duration: 10, effects: { social: 0.3 }, done: 'feedBaby' },
    { key: 'play_baby', label: 'Поиграть с малышом', icon: '🧸', show: ({ obj }) => !!obj?.st?.baby,
      advertisements: [{ motive: 'fun', src: 'baby', delta: FAMILY.babyPlay, min: 40, pers: 'playful', atten: 'low' }],
      at: 'self', anim: { loop: 'laugh' }, duration: 15, effects: { fun: 0.5, social: 0.5 }, done: 'playBaby' },
  ],
  tombstone: [
    { key: 'mourn', label: 'Скорбеть', icon: '🥀', advertisements: [ad('social', 15, 60, 'medium', 'nice')],
      show: ({ state, obj }) => state.time.minutes - (obj?.st?.diedAt ?? 0) < FAMILY.mourn.days * 1440,
      at: 'self', anim: { loop: 'cry' }, duration: 20, effects: { social: 0.4, fun: -0.2 } },
  ],
};

// ── Волна 3: новые виды (CONTRACT §9). Базовые рейтинги вида — KIND_BASE; вариант каталога масштабирует их (rateScale)
export const KIND_BASE = {
  fireplace: { comfort: 3, fun: 2, room: 3 }, piano: { fun: 5 }, guitar: { fun: 4 }, telescope: { fun: 3 }, aquarium: { fun: 2, room: 2 },
  pool_table: { fun: 5 }, dartboard: { fun: 3 }, video_game: { fun: 6 }, pinball: { fun: 4 }, treadmill: { fun: 1 },
  hot_tub: { comfort: 6, hygiene: 2, fun: 3 }, grill: { hunger: 5 }, coffee_maker: { energy: 3 }, microwave: { hunger: 3 },
  toy_box: { fun: 4 }, dollhouse: { fun: 5 }, kids_bed: { comfort: 5, energy: 7 }, bunk_bed: { comfort: 4, energy: 6 },
  sculpture: { room: 4 }, flower_vase: { room: 2 }, pool: { fun: 5 }, park_bench: { comfort: 2 }, fountain: { fun: 2 },
  food_stall: { hunger: 5 }, cafe_table: { hunger: 6, comfort: 2 }, gym_machine: { fun: 2 }, library_shelf: { fun: 2 },
  museum_exhibit: { fun: 3 }, swing_set: { fun: 4 }, sandbox: { fun: 3 }, desk_lamp: { room: 1 }, ceiling_lamp: { room: 1 },
};
KB = KIND_BASE;
const kr = (kind, m) => rt(kind, m);
const kidOnly = { child: true };
const funI = (kind, key, label, icon, anim, o = {}) => ({
  key, label, icon, advertisements: [ad('fun', DERIVE.adDelta(kr(kind, 'fun')), o.min ?? 90, 'medium', o.pers ?? 'playful'), ...(o.ads ?? [])],
  at: 'self', spot: o.spot, anim: { loop: anim, ...o.anim }, duration: o.duration ?? 60, until: { motive: 'fun', gte: 100 },
  effects: { fun: DERIVE.funPerMin(kr(kind, 'fun')), ...o.effects }, breakOn: -60, ...(o.skill && { skill: o.skill, skillAd: true }), ...o.extra,
});
const buyI = (key, label, icon, price, o = {}) => ({
  key, label: `${label} (§${price})`, icon, price, advertisements: o.ads ?? [], check: ({ state }) => (state.household.money < price ? 'Не хватает денег' : null),
  at: 'self', spot: o.spot, anim: o.anim ?? { entry: 'pickup', loop: 'eat' }, duration: o.duration ?? 10, effects: o.effects ?? {}, meal: !!o.meal, done: o.done ?? 'pay', ...o.extra,
});
const lampI = [
  { key: 'turn_on', label: 'Включить', icon: '💡', show: ({ obj }) => obj?.st?.on === false, advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 1, done: 'lampOn' },
  { key: 'turn_off', label: 'Выключить', icon: '🌑', show: ({ obj }) => obj?.st?.on !== false, advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 1, done: 'lampOff' },
];
const viewI = (kind, label = 'Любоваться', icon = '🖼️') => ({ key: 'view', label, icon, advertisements: [ad('fun', 10 + kr(kind, 'room') * 3, 60, 'high')],
  at: 'self', anim: { loop: 'idle' }, duration: 10, effects: { fun: 0.3 + kr(kind, 'room') * 0.05 } });

Object.assign(INTERACTIONS, {
  fireplace: [
    { key: 'light_fire', label: 'Разжечь камин', icon: '🔥', show: ({ obj }) => !obj?.st?.lit, advertisements: [ad('comfort', 20, 50, 'medium')],
      at: 'self', anim: { entry: 'pickup', loop: 'interact' }, duration: 3, done: 'lightFire' },
    { key: 'warm_up', label: 'Погреться у огня', icon: '♨️', show: ({ obj }) => !!obj?.st?.lit,
      advertisements: [ad('comfort', DERIVE.adDelta(kr('fireplace', 'comfort')) + 10, 80, 'medium'), ad('fun', 15, 80, 'medium')],
      at: 'self', anim: { loop: 'idle' }, duration: 30, effects: { comfort: DERIVE.comfortPerMin(kr('fireplace', 'comfort')) + 0.1, fun: 0.2 }, breakOn: -60 },
    { key: 'put_out', label: 'Потушить камин', icon: '💨', show: ({ obj }) => !!obj?.st?.lit, advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 2, done: 'putOutFire' },
  ],
  piano: [funI('piano', 'play_piano', 'Играть на пианино', '🎹', 'interact', { spot: ['sit', 'use', 'front'], anim: { entry: 'sit', exit: 'standUp' }, skill: { name: 'creativity', mult: 1 } })],
  guitar: [funI('guitar', 'play_guitar', 'Играть на гитаре', '🎸', 'interact', { skill: { name: 'creativity', mult: 0.9 } })],
  telescope: [funI('telescope', 'stargaze', 'Смотреть на звёзды', '🔭', 'interact', { skill: { name: 'logic', mult: 1 }, extra: { nightAd: true } })],
  aquarium: [
    { key: 'feed_fish', label: 'Покормить рыбок', icon: '🐟', show: ({ obj, state }) => state.time.minutes - (obj?.st?.fed ?? -1e9) > 12 * 60,
      advertisements: [ad('room', 10, 100, 'high', 'neat')], at: 'self', anim: { loop: 'interact' }, duration: 2, done: 'feedFish' },
    funI('aquarium', 'watch_fish', 'Смотреть на рыбок', '🐠', 'idle', { duration: 20, min: 80, pers: 'nice' }),
  ],
  pool_table: [funI('pool_table', 'play_pool', 'Сыграть в бильярд', '🎱', 'interact', { effects: { social: 0.3 }, extra: { cap: 2 } })],
  dartboard: [funI('dartboard', 'play_darts', 'Метать дротики', '🎯', 'interact', { duration: 30, effects: { social: 0.2 }, extra: { cap: 2 } })],
  video_game: [funI('video_game', 'play_video', 'Играть в приставку', '🕹️', 'useComputer', { spot: ['sit', 'use', 'front'], anim: { entry: 'sit', exit: 'standUp' }, effects: { social: 0.2 }, extra: { cap: 2 } })],
  pinball: [funI('pinball', 'play_pinball', 'Играть в пинбол', '📍', 'interact', { duration: 30 })],
  treadmill: [{ key: 'run_treadmill', label: 'Бегать', icon: '🏃', advertisements: [ad('fun', 10, 70, 'medium', 'active')], skillAd: true,
    at: 'self', anim: { loop: 'run' }, duration: 45, effects: { fun: 0.1, hygiene: -0.4, energy: -0.15 }, skill: { name: 'body', mult: 1.1 }, breakOn: -50 }],
  hot_tub: [{ key: 'soak', label: 'Отмокать', icon: '🛁', cap: 4,
    advertisements: [ad('comfort', DERIVE.adDelta(kr('hot_tub', 'comfort')), 70, 'medium'), ad('fun', 30, 80, 'medium', 'playful'), ad('social', 20, 70, 'medium', 'outgoing')],
    at: 'self', spot: ['in', 'sit'], posture: 'sit', anim: { entry: 'sit', loop: 'sitIdle', exit: 'standUp' }, duration: 45,
    effects: { comfort: DERIVE.comfortPerMin(kr('hot_tub', 'comfort')), hygiene: 0.3, fun: 0.4, social: 0.3 }, done: 'tubRomance', breakOn: -60 }],
  grill: [{ ...mealI('grill'), key: 'grill_meal', label: 'Пожарить на гриле', icon: '🍖' }],
  coffee_maker: [{ key: 'drink_coffee', label: 'Выпить кофе', icon: '☕', advertisements: [ad('energy', 25, 60, 'medium')],
    at: 'self', anim: { entry: 'pickup', loop: 'drink' }, duration: 5, effects: { energy: 5 * kr('coffee_maker', 'energy') / 3, bladder: -2 } }],
  microwave: [{ key: 'quick_meal', label: 'Разогреть еду', icon: '🍱', advertisements: [ad('hunger', 40, 70, 'low')],
    steps: [
      { at: 'self', anim: { entry: 'pickup', loop: 'interact' }, duration: 5 },
      { at: 'seat', fallback: 'here', anim: { loop: 'eat', exit: 'standUp' }, duration: 10, effects: { hunger: 4 * kr('microwave', 'hunger') / 3 }, meal: true, dishes: true },
    ] }],
  dishwasher: [{ key: 'load_dishes', label: 'Загрузить посудомойку', icon: '🍽️', show: ({ state }) => state.objects.some(o => (o.st.dishes ?? 0) > 0),
    advertisements: [ad('room', 30, 100, 'medium', 'neat')], at: 'self', anim: { loop: 'interact' }, duration: 5, done: 'loadDishwasher' }],
  washing_machine: [{ key: 'do_laundry', label: 'Постирать', icon: '🧺', advertisements: [ad('hygiene', 10, 50, 'medium', 'neat')],
    at: 'self', anim: { entry: 'pickup', loop: 'wash' }, duration: 20, effects: { hygiene: 0.5 } }],
  toy_box: [funI('toy_box', 'play_toys', 'Играть с игрушками', '🧸', 'laugh', { extra: kidOnly, duration: 45 })],
  dollhouse: [funI('dollhouse', 'play_dollhouse', 'Играть в кукольный домик', '🏠', 'interact', { extra: kidOnly, duration: 45, skill: { name: 'creativity', mult: 0.5 } })],
  kids_bed: [sleepI('kids_bed'), sleepI('kids_bed', 'nap')],
  bunk_bed: [{ ...sleepI('bunk_bed'), cap: 2 }, { ...sleepI('bunk_bed', 'nap'), cap: 2 }],
  wardrobe: [{ key: 'change_outfit', label: 'Переодеться', icon: '👗', advertisements: [], at: 'self', anim: { loop: 'interact' }, duration: 3, done: 'changeOutfit' }],
  desk_lamp: lampI, ceiling_lamp: lampI,
  sculpture: [viewI('sculpture', 'Рассматривать скульптуру', '🗿')],
  flower_vase: [viewI('flower_vase', 'Любоваться цветами', '💐')],
  clock: [{ key: 'check_time', label: 'Посмотреть время', icon: '🕰️', advertisements: [], at: 'self', anim: { loop: 'idle' }, duration: 1, done: 'checkTime' }],
  pool: [funI('pool', 'swim', 'Плавать', '🏊', 'exercise', { spot: ['in', 'front'], effects: { hygiene: 0.3, energy: -0.1 }, skill: { name: 'body', mult: 0.8 }, extra: { cap: 6 }, pers: 'active' })],
  // общественные участки
  park_bench: [sitI('park_bench', { cap: 2 }), funI('park_bench', 'people_watch', 'Разглядывать прохожих', '👀', 'sitIdle', { spot: 'sit', anim: { entry: 'sit', exit: 'standUp' }, duration: 20, min: 80, pers: 'outgoing' })],
  fountain: [{ key: 'throw_coin', label: 'Бросить монетку (§1)', icon: '🪙', advertisements: [ad('fun', 15, 80, 'high', 'playful')], at: 'self', anim: { loop: 'interact' }, duration: 2, effects: { fun: 3 }, done: 'throwCoin' }],
  food_stall: [buyI('buy_food', 'Купить еду', '🌭', 15, { ads: [ad('hunger', 50, 70, 'low')], effects: { hunger: 5 }, meal: true })],
  cafe_table: [buyI('eat_cafe', 'Поесть в кафе', '🍝', 25, { spot: ['sit', 'front'], ads: [ad('hunger', 70, 70, 'low'), ad('social', 10, 70, 'low')],
      anim: { entry: 'sit', loop: 'eat', exit: 'standUp' }, duration: 20, effects: { hunger: 3.5, social: 0.2 }, meal: true }),
    buyI('order_coffee', 'Выпить кофе', '☕', 5, { spot: ['sit', 'front'], ads: [ad('energy', 20, 60, 'medium')], anim: { entry: 'sit', loop: 'drink', exit: 'standUp' }, duration: 8, effects: { energy: 2.5, social: 0.2 } })],
  cash_register: [buyI('buy_groceries', 'Купить продукты', '🛒', 100, { anim: { loop: 'interact' }, duration: 3, done: 'buyGroceries' })],
  shelf_shop: [buyI('buy_groceries', 'Купить продукты', '🛒', 100, { anim: { loop: 'pickup' }, duration: 5, done: 'buyGroceries' }),
    funI('shelf_shop', 'browse', 'Посмотреть товары', '🛍️', 'idle', { duration: 15, min: 80, pers: 'outgoing' })],
  gym_machine: [{ key: 'workout', label: 'Тренироваться', icon: '💪', advertisements: [ad('fun', 10, 70, 'medium', 'active')], skillAd: true,
    at: 'self', anim: { loop: 'exercise' }, duration: 45, effects: { fun: 0.1, hygiene: -0.4, energy: -0.12 }, skill: { name: 'body', mult: 1.2 }, breakOn: -50, cap: 1 }],
  library_shelf: [
    { key: 'study_cooking', label: 'Учить кулинарию', icon: '📖', goodMood: true, advertisements: [ad('fun', 5, 60, 'medium', 'neat')], skillAd: true,
      at: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 60, skill: { name: 'cooking', mult: 1.1 }, breakOn: -50 },
    { key: 'study_mechanical', label: 'Учить механику', icon: '🔧', goodMood: true, advertisements: [ad('fun', 5, 60, 'medium', 'neat')], skillAd: true,
      at: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 60, skill: { name: 'mechanical', mult: 1.1 }, breakOn: -50 },
    { key: 'study_logic', label: 'Читать научное', icon: '🧮', goodMood: true, advertisements: [ad('fun', 5, 60, 'medium', 'neat')], skillAd: true,
      at: 'self', anim: { entry: 'pickup', loop: 'read' }, duration: 60, skill: { name: 'logic', mult: 0.8 }, breakOn: -50 },
    funI('library_shelf', 'read', 'Почитать', '📚', 'read', { anim: { entry: 'pickup' }, duration: 45, min: 80, pers: 'neat' }),
  ],
  museum_exhibit: [funI('museum_exhibit', 'view_exhibit', 'Рассматривать экспонат', '🏛️', 'idle', { duration: 15, min: 85, pers: 'neat', skill: { name: 'creativity', mult: 0.3 } })],
  swing_set: [funI('swing_set', 'swing', 'Качаться', '🎠', 'sitIdle', { duration: 30, pers: 'active', extra: { cap: 2 } })],
  sandbox: [funI('sandbox', 'play_sand', 'Играть в песочнице', '🏖️', 'interact', { duration: 30, extra: { ...kidOnly, cap: 3 } })],
  trash_bin_street: [], streetlight: [], hedge: [], tree: [], fence: [],
  flowerbed: [{ key: 'water', label: 'Полить', icon: '🌷', advertisements: [ad('room', 10, 100, 'high', 'neat')], at: 'self', anim: { loop: 'interact' }, duration: 3, done: 'water',
    show: ({ obj, state }) => (state.time.minutes - (obj?.st?.watered ?? -1e9)) > 12 * 60 }],
});

// Вариант каталога (свой рейтинг) масштабирует обещание и эффект вида: TS1 — рейтинг карточки ⇒ EffectRangeDelta
export function rateScale(o, motive) {
  const def = byId[o?.def], kind = def?.kind ?? o?.def;
  const c = def?.ratings?.[motive], b = KIND_BASE[kind]?.[motive] ?? byId[kind]?.ratings?.[motive];
  if (c == null || !b) return 1;
  return Math.min(3, Math.max(0.3, c / b));
}

// ── Общие для многих предметов (добавляются ниже программно) ─────────
export const repairI = {
  key: 'repair', label: 'Починить', icon: '🔧', whenBroken: true, adult: true, show: ({ obj }) => !!obj?.st?.broken,
  advertisements: [ad('room', 30, 100, 'medium', 'neat')], autoMinMech: BREAK.autoMinMech,
  at: 'self', anim: { loop: 'repair' }, duration: ({ sim }) => Math.round(BREAK.repairMinutes / (1 + BREAK.repairPerMech * (sim.skills?.mechanical ?? 0))),
  skill: { name: 'mechanical', mult: 1 }, shockRisk: true, done: 'repair',
};
const clearDishesI = {
  key: 'clear_dishes', label: 'Убрать посуду', icon: '🍽️', show: ({ obj }) => (obj?.st?.dishes ?? 0) > 0,
  advertisements: [ad('room', 25, 100, 'medium', 'neat')], at: 'self', anim: { entry: 'pickup', loop: 'wash' }, duration: 4, done: 'clearDishes',
};
const pizzaI = {
  key: 'eat_pizza', label: 'Съесть пиццу', icon: '🍕', show: ({ obj }) => (obj?.st?.pizza ?? 0) > 0,
  advertisements: [ad('hunger', SERVICES.pizza.perServing * 2, 70, 'low')],
  at: 'self', anim: { entry: 'pickup', loop: 'eat' }, duration: SERVICES.pizza.eatMinutes,
  effects: { hunger: (SERVICES.pizza.perServing * 2) / SERVICES.pizza.eatMinutes }, meal: true, done: 'eatPizza',
};
const trashI = {
  key: 'empty_trash', label: 'Вынести мусор', icon: '🗑️', show: ({ obj }) => (obj?.st?.fill ?? 0) >= DIRT.trashShow,
  advertisements: [ad('room', 20, 100, 'medium', 'neat')], at: 'self', anim: { entry: 'pickup', loop: 'interact' }, duration: 4, done: 'emptyTrash',
};
const homeworkI = {
  key: 'homework', label: 'Сделать уроки', icon: '📝', child: true, show: ({ sim }) => sim.age === 'child' && !!sim.school?.homework,
  advertisements: [ad('fun', 10, 100, 'medium', 'neat')], at: 'self', spot: ['sit', 'use', 'front'], anim: { entry: 'sit', loop: 'read', exit: 'standUp' },
  duration: 60, skill: { name: 'logic', mult: 0.5 }, done: 'homework',
};
export const BREAKABLE = new Set([...Object.keys(INTERACTIONS).filter(id => ['electronics', 'appliances'].includes(byId[id]?.depr) || byId[id]?.cat === 'plumbing')
  .filter(id => (INTERACTIONS[id] ?? []).length && !['smoke_alarm', 'burglar_alarm', 'phone'].includes(id)),
  'video_game', 'pinball', 'coffee_maker', 'microwave', 'dishwasher', 'washing_machine', 'hot_tub', 'aquarium', 'telescope', 'treadmill', 'grill']);
for (const id of BREAKABLE) INTERACTIONS[id].push(repairI);
for (const id of ['dining_table', 'coffee_table', 'counter']) INTERACTIONS[id].push(clearDishesI, pizzaI);
INTERACTIONS.trash_can.push(trashI);
INTERACTIONS.computer_desk.push(homeworkI);
INTERACTIONS.dining_chair.push({ ...homeworkI, spot: 'sit' });

// ── Служебные действия (без меню) ─────────────────────────────────────
export const INTERNAL = {
  go_to_work: { key: 'go_to_work', label: 'На работу', icon: '🚗', advertisements: [],
    at: { def: 'mailbox' }, fallback: 'here', anim: { loop: 'wave' }, duration: 1, done: 'goWork' },
  pass_out: { key: 'pass_out', label: 'Отключился', icon: '💤', at: 'here', posture: 'lie', asleep: true,
    anim: { entry: 'lieDown', loop: 'sleep', exit: 'getUp' }, duration: 12 * 60, until: { motive: 'energy', gte: 40 }, effects: {}, passedOut: true },
  wander: { key: 'wander', label: 'Бродить', icon: '🚶', at: 'tile', anim: { loop: 'idle' }, duration: 1 },
  go_to_school: { key: 'go_to_school', label: 'В школу', icon: '🚌', at: { def: 'mailbox' }, fallback: 'here', anim: { loop: 'wave' }, duration: 1, done: 'goSchool' },
  panic: { key: 'panic', label: 'Паника', icon: '😱', at: 'tile', run: true, anim: { loop: 'cry' }, duration: 10 },
  // НПС
  leave: { key: 'leave', label: 'Уйти', icon: '👋', at: 'tile', anim: { loop: 'wave' }, duration: 1, done: 'despawn' },
  walk_by: { key: 'walk_by', label: 'Идёт мимо', icon: '🚶', at: 'tile', anim: { loop: 'idle' }, duration: 0, done: 'despawn' },
  extinguish: { key: 'extinguish', label: 'Тушить', icon: '🧯', at: 'tile', anim: { loop: 'interact' }, duration: 3, done: 'extinguish' },
  steal: { key: 'steal', label: 'Красть', icon: '🦹', at: 'self', anim: { loop: 'interact' }, duration: 20, done: 'steal', alarmOnStart: true },
  catch: { key: 'catch', label: 'Задержать', icon: '🚓', at: 'tile', run: true, anim: { loop: 'angry' }, duration: 3, done: 'catchBurglar' },
  reap: { key: 'reap', label: 'Забрать', icon: '💀', at: 'tile', anim: { loop: 'interact' }, duration: 5, done: 'reap' },
  take_baby: { key: 'take_baby', label: 'Забрать малыша', icon: '📋', at: 'self', anim: { loop: 'pickup' }, duration: 3, done: 'takeBaby' },
  deliver: { key: 'deliver', label: 'Доставка', icon: '🍕', at: { def: 'mailbox' }, fallback: 'here', anim: { loop: 'wave' }, duration: 2, done: 'deliverPizza' },
};

// ── Клик по полу ──────────────────────────────────────────────────────
export const TILE_ACTIONS = [
  { key: 'go_here', label: 'Идти сюда', icon: '🚶', at: 'tile', anim: { loop: 'idle' }, duration: 0 },
  { key: 'clean_puddle', label: 'Вытереть лужу', icon: '🧽', at: 'tile', anim: { loop: 'wash' }, duration: 8, done: 'cleanPuddle', needsPuddle: true },
  { key: 'go_home', label: 'Поехать домой', icon: '🏠', at: 'here', anim: { loop: 'wave' }, duration: 1, done: 'goHome', needsTrip: true },
  { key: 'clean_trash', label: 'Убрать мусор', icon: '🗑️', at: 'tile', anim: { entry: 'pickup', loop: 'wash' }, duration: 4, done: 'cleanTrash', needsTrash: true },
];

// ── Общение сим↔сим — data/socials.js (≥ 50 действий, механика; подписи — Писатель)
export { SOCIALS, socialByKey } from './socials.js';

// Нормализация: у каждого взаимодействия — массив шагов
export function stepsOf(it) {
  if (it.steps) return it.steps;
  const { key, label, icon, advertisements, show, check, goodMood, cap, steps, ...step } = it;
  return [step];
}
export function interactionOf(defId, key) {
  return INTERACTIONS[defId]?.find(i => i.key === key) ?? null;
}
export const ATTEN = AUTONOMY.atten;
