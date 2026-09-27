// Анимации: имена из CONTRACT → клипы Quaternius UAL (+ цепочка фолбэков, если клипа нет).
// Имена клипов UAL сверены с паками game/assets/pack/pilot_aces.js, npc_hermit.js.
// Порядок поиска: ANIMS.clipMap[name] (манифест Ассетов) → CLIPS[name] → FALLBACK[name] → … → idle.

export const ANIM_NAMES = ['idle', 'walk', 'run', 'sit', 'sitIdle', 'sitTalk', 'standUp', 'eat', 'drink', 'sleep', 'lieDown', 'getUp',
  'talk', 'phone', 'wave', 'laugh', 'angry', 'cry', 'dance', 'cook', 'wash', 'pickup', 'interact', 'repair', 'read', 'watchTV',
  'useComputer', 'toilet', 'shower', 'exercise', 'no', 'yes'];

export const CLIPS = {
  idle: ['Idle_Loop', 'Idle'],
  walk: ['Walk_Loop', 'Walk_Formal_Loop', 'Walk'],
  run: ['Jog_Fwd_Loop', 'Sprint_Loop', 'Run'],
  sit: ['Sitting_Enter'],
  sitIdle: ['Sitting_Idle_Loop', 'Sitting'],
  sitTalk: ['Sitting_Talking_Loop'],
  sitEat: ['Sit_Eat_Loop'], sitRead: ['Sit_Read_Loop'], carry: ['Walk_Carry_Loop'],
  standUp: ['Sitting_Exit'],
  eat: ['Consume', 'Eating'],
  drink: ['Drink', 'Consume'],
  sleep: ['Sleeping_Loop', 'Lying_Loop'],
  lieDown: ['LieDown', 'Lying_Enter'],
  getUp: ['LayToIdle'],
  talk: ['Idle_Talking_Loop'],
  phone: ['Idle_TalkingPhone_Loop'],
  wave: ['Wave', 'Idle_Wave', 'Waving'],
  laugh: ['Laugh', 'Idle_Laugh'],
  angry: ['Angry', 'Idle_Angry'],
  cry: ['Cry', 'Sad_Loop'],
  dance: ['Dance_Loop', 'Dance'],
  cook: ['Interact', 'Chest_Open'],
  wash: ['Interact'],
  pickup: ['PickUp_Table', 'PickUp'],
  interact: ['Interact'],
  repair: ['Fixing_Kneeling'],
  read: ['Idle_Reading', 'Reading'],
  watchTV: ['Sitting_Idle_Loop'],
  useComputer: ['Sitting_Idle_Loop'],
  toilet: ['Sitting_Idle_Loop'],
  shower: ['Interact'],
  exercise: ['Jumping_Jacks', 'Jog_Fwd_Loop'],
  no: ['Idle_No_Loop', 'No'],
  yes: ['Yes', 'Idle_Yes'],
};

export const FALLBACK = {
  run: 'walk', sit: 'sitIdle', sitIdle: 'idle', sitEat: 'sitIdle', sitRead: 'sitIdle', carry: 'walk', sitTalk: 'sitIdle', standUp: 'idle', eat: 'interact', drink: 'eat',
  sleep: 'idle', lieDown: 'sleep', getUp: 'idle', talk: 'idle', phone: 'talk', wave: 'talk', laugh: 'talk', angry: 'talk',
  cry: 'idle', dance: 'wave', cook: 'interact', wash: 'interact', pickup: 'interact', interact: 'idle', repair: 'interact',
  read: 'idle', watchTV: 'sitIdle', useComputer: 'sitIdle', toilet: 'sitIdle', shower: 'wash', exercise: 'run', no: 'talk', yes: 'talk',
};

// Одноразовые клипы (держат последний кадр)
export const ONCE = new Set(['sit', 'standUp', 'lieDown', 'getUp', 'pickup']);

// Поза нижней части тела: sit — сидит (ноги согнуты), lie — лежит (всё тело поворачивается), stand — стоит.
// «Верхние» анимации (eat, talk, phone…) сохраняют текущую позу низа — ест сидя за столом, говорит сидя.
export const POSTURE = {
  sit: 'sit', sitIdle: 'sit', sitEat: 'sit', sitRead: 'sit', carry: 'stand', sitTalk: 'sit', watchTV: 'sit', useComputer: 'sit', toilet: 'sit',
  sleep: 'lie', lieDown: 'lie',
  idle: 'stand', walk: 'stand', run: 'stand', standUp: 'stand', getUp: 'stand', dance: 'stand', cook: 'stand', wash: 'stand',
  pickup: 'stand', interact: 'stand', repair: 'stand', shower: 'stand', exercise: 'stand',
};
// остальные (eat, drink, talk, phone, wave, laugh, angry, cry, read, no, yes) — «верхние»
export const isUpper = (name) => !(name in POSTURE);

// Цепочка имён для поиска клипа
export function chain(name, extra = {}) {
  const out = []; let n = name;
  while (n && !out.includes(n)) { out.push(n); n = extra[n] || FALLBACK[n]; }
  if (!out.includes('idle')) out.push('idle');
  return out;
}

// Найти клип: clips — массив THREE.AnimationClip, clipMap — из манифеста. → {clip, name} | null
export function resolveClip(name, clips, clipMap = {}, fallback = {}) {
  const byName = (c) => clips.find(k => k.name === c || k.name.endsWith('|' + c));
  for (const n of chain(name, fallback)) {
    for (const c of [clipMap[n], ...(CLIPS[n] || [])]) {
      if (!c) continue;
      const clip = byName(c); if (clip) return { clip, name: n };
    }
  }
  return null;
}
