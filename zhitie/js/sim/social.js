// Отношения (−100..100, ✅ пороги 50/70) и общение сим↔сим.
import { REL, SOCIAL, PRIORITY } from '../core/tuning.js';
import { SOCIALS, socialByKey } from '../../data/interactions.js';
import { mood } from './motives.js';
import { clamp, rand, speak, notify, ensureBrain, relKey, isHousehold, isPresent, dist } from './util.js';
import { addMoney } from './money.js';

export const getRel = (a, bId) => a.rel?.[bId] ?? 0;
// Как цель относится к инициатору (у горожан-НПС память — на стороне семьи)
export const relBetween = (target, initiator) => (target.townieId ? getRel(initiator, target.townieId) : getRel(target, relKey(initiator)));
export function addRel(a, bId, d) {
  a.rel ??= {};
  a.rel[bId] = clamp((a.rel[bId] ?? 0) + d, REL.range[0], REL.range[1]);
}

export function relStatus(v) {
  if (v >= REL.crush) return 'crush';
  if (v >= REL.friend) return 'friend';
  if (v >= REL.warm) return 'warm';
  if (v <= REL.enemy) return 'enemy';
  return 'acquaintance';
}

// Друзья семьи: не-члены семьи, с кем хоть кто-то в семье ≥ 50 (✅ для повышений)
export function familyFriends(state) {
  const H = state.sims.filter(isHousehold);
  const home = new Set(H.map(s => String(s.id)));
  const out = new Set();
  for (const s of H) for (const [id, v] of Object.entries(s.rel ?? {})) if (v >= REL.friend && !home.has(id)) out.add(id);
  return out.size;
}

// Пункты меню для клика по другому симу
export function socialsFor(sim, other) {
  const r = relBetween(other, sim);
  if (other.npc && !['townie', 'visitor'].includes(other.npc)) return SOCIALS.filter(s => s.key === 'greet');
  const kids = sim.age === 'child' || other.age === 'child';
  return SOCIALS.filter(s => r >= s.showRel && (s.showMax == null || r < s.showMax) && (!s.only || s.only === other.npc)
    && !(s.romantic && (kids || other.npc)) && (!s.kids || kids) && !(s.adultOnly && sim.age === 'child'));
}

// Вероятность согласия цели
export function acceptChance(target, initiator, s) {
  if (s.mean || s.minRel <= -100) return 1;
  const r = relBetween(target, initiator);
  let p = 0.5 + (r - s.minRel) / SOCIAL.acceptSpan + mood(target) / SOCIAL.moodDiv;
  if (s.pers) {
    const inv = s.pers.startsWith('-');
    const t = target.personality[s.pers.replace('-', '')] ?? 5;
    p += ((inv ? 10 - t : t) - 5) / SOCIAL.persDiv;
  }
  return clamp(p, SOCIAL.pMin, SOCIAL.pMax);
}

// Сим, которому надо куда-то (карпул, школа, команда игрока), в разговор не втягивается
export const inAHurry = t => (t.act?.prio ?? 0) > PRIORITY.auto || t.queue.some(q => q.prio > PRIORITY.auto);
export const targetBusy = t => t.dead ? 'Не может' : t.atWork ? 'На работе' : t.asleep ? 'Спит' : t.reaction ? 'Занят' : inAHurry(t) ? 'Спешит' : null;

// Начало социального действия: бросок согласия, реакция цели. → {ok, s}
export function beginSocial(state, bus, sim, target, key) {
  const s = socialByKey[key];
  const busy = targetBusy(target);
  if (busy) return { ok: false, busy, s };
  const now = state.time.minutes;
  const ok = rand(state) < acceptChance(target, sim, s);
  const dur = ok ? s.duration : 2;
  target.reaction = {
    anim: ok ? s.targetAnim : 'no', until: now + dur, withId: sim.id, key,
    effects: ok ? scalePerMin(s.targetEffects ?? s.effects, s) : {},
  };
  if (!ok) {
    speak(state, bus, target, '🙅', sim.id);
    addRel(target, relKey(sim), s.fail);
    addRel(sim, relKey(target), s.fail * REL.initiatorShare);
  } else {
    if (s.speak) speak(state, bus, sim, s.speak, target.id);
    if (s.cost) addMoney(state, bus, -s.cost, 'gift');
  }
  // разговор втроём+: ближние свободные втягиваются
  const group = [];
  if (ok && s.group) for (const o of state.sims) {
    if (group.length >= SOCIAL.groupMax || o === sim || o === target || !isPresent(o) || targetBusy(o)) continue;
    if (o.npc && !['townie', 'visitor'].includes(o.npc)) continue;
    if (dist(o, target) > SOCIAL.groupRadius || (o.level ?? 0) !== (target.level ?? 0)) continue;
    o.reaction = { anim: 'talk', until: now + dur, withId: sim.id, key, effects: scalePerMin(s.effects, s) };
    group.push(o.id);
  }
  return { ok, s, dur, group };
}

// Эффекты соц. действия заданы суммой за действие (кроме perMinute) → в минуту
export function scalePerMin(effects, s) {
  if (s.perMinute) return { ...effects };
  const out = {};
  for (const [k, v] of Object.entries(effects ?? {})) out[k] = v / s.duration;
  return out;
}

// Итог успешного действия
// Пауза между разговорами одной пары (автономия не заводит их снова сразу)
export function socialCooldown(state, sim, target) {
  const until = state.time.minutes + SOCIAL.pairCooldown;
  (sim.brain.socialCd ??= {})[relKey(target)] = until;
  (target.brain.socialCd ??= {})[relKey(sim)] = until;
}

export function endSocial(state, bus, sim, target, s, minutes, group = []) {
  const d = s.perMinute ? (s.rel * minutes) / s.duration : s.rel;
  addRel(target, relKey(sim), d);
  addRel(sim, relKey(target), d * REL.initiatorShare);
  for (const id of group) {                               // участники общего разговора сближаются
    const o = state.sims.find(x => x.id === id);
    if (!o) continue;
    for (const p of [sim, target]) { addRel(o, relKey(p), d * 0.5); addRel(p, relKey(o), d * 0.5); }
  }
}

// Телефонный разговор: знакомый из города (для «друзей семьи»)
export function phoneChat(state, bus, sim, minutes) {
  const b = ensureBrain(state);
  const pick = b.townies[Math.floor(rand(state) * b.townies.length)];
  addRel(sim, pick.id, SOCIAL.phoneChatRel * minutes);
  notify(bus, `${sim.name} поболтал(а) с ${pick.name} (${Math.round(getRel(sim, pick.id))})`, '☎️', sim.id);
}

// ✅ −2/день в 16:00 для тех, кого нет на участке
export function relDecay(state) {
  const H = state.sims.filter(isHousehold);
  const home = new Set(H.map(s => String(s.id)));
  for (const s of H) for (const id of Object.keys(s.rel ?? {})) {
    if (home.has(id)) continue;
    const v = s.rel[id];
    s.rel[id] = Math.abs(v) <= REL.decayPerDay ? 0 : v - Math.sign(v) * REL.decayPerDay;
  }
}

