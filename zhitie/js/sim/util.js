// Общие помощники Мозга: RNG в state, поиск по id, анимация/речь/уведомления.
import { TIME, SOCIAL } from '../core/tuning.js';
import { kindOf } from '../../data/catalog.js';

// Вид предмета (CONTRACT §9): поведение ищем по виду, цену/рейтинги — по конкретному id
export const K = o => kindOf(o.def);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clampM = v => clamp(v, -100, 100);
export const dayOf = min => Math.floor(min / TIME.dayMinutes);
export const hourOf = min => Math.floor(min / 60) % 24;

// Служебное состояние Мозга внутри state (сериализуемо). Создаётся лениво.
export function ensureBrain(state) {
  if (!state.brain) {
    state.brain = {
      rng: 0x9e3779b9, uid: 1,
      townies: SOCIAL.townies.map((name, i) => ({ id: `t${i + 1}`, name })),
    };
  }
  return state.brain;
}

// mulberry32 — детерминированный RNG, состояние в state.brain.rng
export function rand(state) {
  const b = ensureBrain(state);
  let t = (b.rng = (b.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const seed = (state, s) => { ensureBrain(state).rng = s >>> 0; };
export const nextUid = state => ensureBrain(state).uid++;

export const objById = (state, id) => state.objects.find(o => o.id === id) ?? null;
export const simById = (state, id) => state.sims.find(s => s.id === id) ?? null;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// центр предмета в тайловых координатах
export const objCenter = o => ({ x: o.x + 0.5, y: o.y + 0.5 });

export function setAnim(sim, bus, anim, { objId, once } = {}) {
  if (sim.anim === anim && !once) return;
  sim.anim = anim;
  sim.animTarget = objId ?? null;
  bus.emit('sim:anim', { simId: sim.id, anim, ...(objId != null && { objId }), ...(once && { once: true }) });
}

export function speak(state, bus, sim, icon, withId, minutes = 3) {
  sim.bubble = { icon, until: state.time.minutes + minutes };
  bus.emit('sim:speak', { simId: sim.id, icon, ...(withId != null && { withId }) });
}

export const notify = (bus, text, icon, simId) => bus.emit('notify', { text, icon, ...(simId != null && { simId }) });

// угол взгляда: 0 → +y (как rot=0), π/2 → +x
export const facingTo = (dx, dy) => Math.atan2(dx, dy);
// useSpots может отдать facing как rot 0..3 или радианы
export const spotFacing = f => (Number.isInteger(f) && f >= 0 && f <= 3 ? (f * Math.PI) / 2 : f ?? 0);

export const isPresent = s => !s.dead && !s.atWork;

// Ссылка на Мир на время тика (не в state — несериализуема). Нужна хукам диалогов/таймеров.
export const runtime = { world: null };

// Кто в семье: не НПС
export const isHousehold = s => !s.npc;
export const household = state => state.sims.filter(isHousehold);
// Ключ отношений: у горожан — постоянный id из state.brain.townies
export const relKey = s => s.townieId ?? s.id;

// Прямоугольник предмета (как в Мире: x,y — мин. угол, при нечётном rot fp меняется местами)
export function objRectOf(o, def) {
  const [w, d] = def?.fp ?? [1, 1];
  return (o.rot ?? 0) % 2 ? { X: o.x, Y: o.y, W: d, D: w } : { X: o.x, Y: o.y, W: w, D: d };
}
