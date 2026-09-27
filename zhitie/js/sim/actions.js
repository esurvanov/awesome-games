// Машина состояний действия: маршрут к слоту (world.findPath → world.useSpots) → вход → петля с эффектами → выход.
// sim.act = { uid, key, by, prio, objId, target, steps, si, step, phase:'walk'|'entry'|'loop'|'exit', t, dur, place, anims, cancel }
import { WALK, ANIM_MIN, MOOD, DERIVE, AUTONOMY, GROCERY } from '../core/tuning.js';
import { byId } from '../../data/catalog.js';
import { INTERACTIONS, INTERNAL, TILE_ACTIONS, socialByKey, stepsOf, interactionOf, rateScale } from '../../data/interactions.js';
import { rand, objById, simById, setAnim, speak, notify, dist, objCenter, facingTo, spotFacing, hourOf, isPresent, K } from './util.js';
import { stepWalk, tileOf, expandStairs } from './walk.js';
import { removeItem } from './queue.js';
import { beginSocial, endSocial, scalePerMin, socialCooldown } from './social.js';
import { MOTIVES } from './motives.js';

// Хуки завершения шагов (done:'…') — заполняет index.js, чтобы не было циклических импортов
export const HOOKS = {};
// Подписчики фаз (опасности, посуда, романтика): { loopStart(state,bus,sim,act,obj), stepEnd(state,bus,sim,act,obj,done), socialEnd(state,bus,sim,target,social) }
export const EVENTS = { loopStart: [], stepEnd: [], socialEnd: [] };

// ── Справочники ───────────────────────────────────────────────────────
export const capOf = def => Math.max(1, ...(INTERACTIONS[def] ?? []).map(i => i.cap ?? 1));
const users = o => (o.st.users ??= []);
export const hasRoom = (o, simId) => users(o).includes(simId) || users(o).length < capOf(K(o));
// точку уже занял (или идёт занимать) другой сим
const spotFree = (state, sim, sp) => !state.sims.some(o => o !== sim && o.act?.spot && o.act.spot.x === sp.x && o.act.spot.y === sp.y && o.act.place);
const BROKEN_OK = new Set(['repair', 'clean', 'steal', 'clear_dishes', 'eat_pizza', 'empty_trash', 'take_baby']);
const usable = o => !o.st.broken && !o.st.burnt;
const isSeat = o => (INTERACTIONS[K(o)] ?? []).some(i => i.key === 'sit');

export function resolveSpec(state, item) {
  const t = item.target ?? { kind: 'object', id: item.objId };
  if (t.kind === 'object') {
    const o = objById(state, t.id);
    const it = o && (interactionOf(K(o), item.interaction) ?? INTERNAL[item.interaction]);
    return it && { it, steps: stepsOf(it) };
  }
  if (t.kind === 'sim') {
    const s = socialByKey[item.interaction];
    return s && { it: s, steps: [{ at: 'sim', anim: { loop: s.anim }, duration: s.duration, social: s, done: s.done }] };
  }
  if (t.kind === 'tile') {
    const it = TILE_ACTIONS.find(a => a.key === item.interaction);
    return it && { it, steps: stepsOf(it) };
  }
  const it = INTERNAL[item.interaction];
  return it && { it, steps: stepsOf(it) };
}

// ── Старт ─────────────────────────────────────────────────────────────
export function startAction(state, bus, world, sim, item) {
  const spec = resolveSpec(state, item);
  if (!spec) { removeItem(sim, item.uid); return; }
  const low = MOTIVES.some(m => sim.motives[m] < MOOD.runBelow);
  sim.act = {
    uid: item.uid, key: item.interaction, by: item.by, prio: item.prio, objId: item.objId ?? item.target?.id ?? null,
    target: item.target ?? { kind: 'object', id: item.objId }, steps: spec.steps, si: -1, phase: 'walk', t: 0, cancel: false,
    run: low || !!spec.it.run, ...(item.arg != null && { arg: item.arg }),
  };
  nextStep(state, bus, world, sim);
}

function nextStep(state, bus, world, sim) {
  const a = sim.act;
  a.si++;
  if (a.cancel || a.si >= a.steps.length) return finishAction(state, bus, sim);
  const step = (a.step = a.steps[a.si]);
  a.t = 0; a.retries = 0; a.accepted = false;
  let place = locate(state, sim, a, step.at);
  if (!place && step.fallback) place = locate(state, sim, a, step.fallback);
  if (!place) return step.optional ? nextStep(state, bus, world, sim) : fail(state, bus, sim, 'Нечем воспользоваться');
  a.place = place;
  if (place.objId != null) { const o = objById(state, place.objId); if (!users(o).includes(sim.id)) users(o).push(sim.id); }
  route(state, bus, world, sim);
}

// Где выполнять шаг → { objId?, seat?, lookAt?, simId?, tile?, here? }
function locate(state, sim, a, at) {
  if (at === 'here') return { here: true };
  if (at === 'tile') return { tile: { x: a.target.x, y: a.target.y, level: a.target.level ?? sim.level ?? 0 }, near: !!a.target.near };
  if (at === 'sim') { const t = simById(state, a.target.id); return t && isPresent(t) ? { simId: t.id } : null; }
  if (at === 'self') { const o = objById(state, a.objId); return o && hasRoom(o, sim.id) ? { objId: o.id } : null; }
  const near = (list, from, max = Infinity) => list
    .filter(o => usable(o) && (o.level ?? 0) === (sim.level ?? 0) && hasRoom(o, sim.id) && dist(objCenter(o), from) <= max && !(sim.brain.blocked?.[o.id] > state.time.minutes))
    .sort((p, q) => dist(objCenter(p), from) - dist(objCenter(q), from))[0];
  if (at === 'seat') {                                  // к столу — стулья в приоритете
    const o = near(state.objects.filter(o => K(o) === 'dining_chair'), sim, 12) ?? near(state.objects.filter(isSeat), sim, 10);
    return o && { objId: o.id, seat: true };
  }
  if (at?.def) { const o = near(state.objects.filter(o => K(o) === at.def), sim); return o && { objId: o.id }; }
  return null;
}

// Построение маршрута до слота
function route(state, bus, world, sim) {
  const a = sim.act, p = a.place;
  const level = sim.level ?? 0;
  let goals;
  if (p.here) return arrive(state, bus, world, sim);
  if (p.tile) {
    goals = [p.tile];
    if (p.near) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) goals.push({ x: p.tile.x + dx, y: p.tile.y + dy, level: p.tile.level });
  }
  else if (p.simId != null) {
    const t = simById(state, p.simId), tt = tileOf(t);
    if (dist(sim, t) <= WALK.socialDist) return arrive(state, bus, world, sim);
    goals = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) goals.push({ x: tt.x + dx, y: tt.y + dy, level: t.level ?? 0 });
  } else {
    let spots = world?.useSpots?.(state, p.objId) ?? [];
    const pref = [].concat(a.step.spot ?? (p.seat ? 'sit' : []));
    if (pref.length) {                                    // порядок в pref = приоритет слота
      for (const slot of pref) { const f = spots.filter(s => s.slot === slot && spotFree(state, sim, s)); if (f.length) { spots = f; break; } }
    } else {
      const stand = spots.filter(s => !s.onObject);
      if (stand.length) spots = stand;
    }
    const free = spots.filter(s => spotFree(state, sim, s));
    if (free.length) spots = free;
    if (!spots.length) { const o = objById(state, p.objId); spots = [{ x: o.x, y: o.y, facing: 0, level: o.level ?? 0 }]; }
    a.spots = spots;
    goals = spots;
  }
  if (!world?.findPath) sim.path = [goals[0]];
  else {
    const from = { ...tileOf(sim), level };
    const path = world.findPath(state, level, from, goals.map(g => ({ x: g.x, y: g.y, level: g.level ?? level })));
    if (!path || path.reached === false) return fail(state, bus, sim, 'Не могу туда пройти');
    sim.path = path.length ? expandStairs(state, world, sim, path) : null;
    sim.walkSeg = null;
  }
  const end = sim.path?.[sim.path.length - 1] ?? { ...tileOf(sim), level };
  const endL = end.level ?? level;
  a.spot = a.spots?.find(s => s.x === end.x && s.y === end.y && (s.level ?? endL) === endL) ?? a.spots?.[0] ?? null;
  a.phase = 'walk';
  setAnim(sim, bus, a.run ? 'run' : 'walk');
}

// ── Прибытие ──────────────────────────────────────────────────────────
function arrive(state, bus, world, sim) {
  const a = sim.act, p = a.place, step = a.step;
  sim.path = null;
  if (p.simId != null) {
    const t = simById(state, p.simId);
    if (!t || !isPresent(t)) return fail(state, bus, sim, 'Собеседник ушёл');
    if (dist(sim, t) > WALK.socialDist + 0.3) {
      if (++a.retries > WALK.socialRetries) return fail(state, bus, sim, 'Не догнать');
      return route(state, bus, world, sim);
    }
    sim.facing = facingTo(t.x - sim.x, t.y - sim.y);
    t.facing = facingTo(sim.x - t.x, sim.y - t.y);
    const r = beginSocial(state, bus, sim, t, step.social.key);
    if (r.busy === 'Занят' && (a.waitUntil ??= state.time.minutes + WALK.socialWait) > state.time.minutes) { a.phase = 'walk'; sim.path = null; return; }   // подождать, пока собеседник освободится
    if (r.busy) { speak(state, bus, sim, '🤷', t.id); return fail(state, bus, sim, r.busy, true); }
    a.accepted = r.ok;
    a.dur = r.dur;
    a.group = r.group ?? [];
    a.anims = { loop: r.ok ? step.social.anim : 'cry' };
    a.nextTopic = 0;
    return enterLoop(state, bus, sim);
  }
  if (p.objId != null) {
    const o = objById(state, p.objId);
    if (!o) return fail(state, bus, sim, 'Предмет пропал');
    if ((o.st.burnt && a.key !== 'steal') || (o.st.broken && !BROKEN_OK.has(a.key))) return fail(state, bus, sim, o.st.burnt ? 'Сгорело' : 'Сломано');
    if (a.spot) { sim.x = a.spot.x + 0.5; sim.y = a.spot.y + 0.5; if (a.spot.level != null) sim.level = a.spot.level; }
    const look = p.lookAt != null ? objById(state, p.lookAt) : null;
    if (look) sim.facing = facingTo(look.x + 0.5 - sim.x, look.y + 0.5 - sim.y);
    else if (a.spot?.facing != null) sim.facing = spotFacing(a.spot.facing);
    else sim.facing = facingTo(o.x + 0.5 - sim.x, o.y + 0.5 - sim.y);
    o.st.inUse = users(o)[0] ?? sim.id;
    bus.emit('object:changed', { id: o.id });
  }
  // анимации: сесть/лечь только если точка «на предмете» (сиденье, кровать, унитаз), иначе стоя
  const anim = { ...step.anim };
  const onObj = !!a.spot?.onObject || (p.seat && !a.spot);
  if (!onObj) {
    if (anim.entry === 'sit' || anim.entry === 'lieDown') anim.entry = null;
    if (anim.exit === 'standUp' || anim.exit === 'getUp') anim.exit = null;
  }
  a.seatId = a.spot?.seatId ?? (p.seat ? p.objId : null);
  a.anims = anim;
  a.dur = typeof step.duration === 'function' ? step.duration({ state, sim, obj: objById(state, p.objId) }) : step.duration;
  sim.posture = onObj ? (a.spot?.slot === 'lie' || step.posture === 'lie' ? 'lie' : 'sit') : 'stand';
  if (anim.entry) { a.phase = 'entry'; a.t = 0; setAnim(sim, bus, anim.entry, { objId: p.objId, once: true }); }
  else enterLoop(state, bus, sim);
}

function enterLoop(state, bus, sim) {
  const a = sim.act;
  a.phase = 'loop'; a.t = 0;
  const u = a.step.until;
  a.m0 = u ? sim.motives[u.motive] : null;               // для оценки прогресса по потребности
  sim.asleep = !!a.step.asleep;
  setAnim(sim, bus, a.anims.loop ?? 'idle', { objId: a.place?.objId });
  const o = a.place?.objId != null ? objById(state, a.place.objId) : null;
  for (const f of EVENTS.loopStart) f(state, bus, sim, a, o);
}

// ── Обновление за под-шаг dm игровых минут ────────────────────────────
export function updateAction(state, bus, world, sim, dm) {
  updateAct(state, bus, world, sim, dm);
  if (sim.act) sim.act.progress = actionProgress(sim);
}

// Прогресс текущего действия 0..1: по шагам цепочки; в петле — max(время/длительность, путь потребности к цели until)
export function actionProgress(sim) {
  const a = sim?.act;
  if (!a || !a.steps?.length) return 0;
  let p = 0;
  if (a.phase === 'exit') p = 1;
  else if (a.phase === 'loop') {
    p = a.dur > 0 ? a.t / a.dur : 1;
    const u = a.step?.until;
    if (u && a.m0 != null && u.gte > a.m0) p = Math.max(p, (sim.motives[u.motive] - a.m0) / (u.gte - a.m0));
  }
  p = Math.min(1, Math.max(0, p));
  return Math.min(1, (Math.max(0, a.si) + p) / a.steps.length);
}

function updateAct(state, bus, world, sim, dm) {
  const a = sim.act;
  if (a.place?.objId != null && !objById(state, a.place.objId)) return fail(state, bus, sim, 'Предмет пропал', true);
  if (a.phase === 'walk') {
    if (a.cancel) return finishAction(state, bus, sim);
    if (a.place?.simId != null) {
      const t = simById(state, a.place.simId);
      if (!t || !isPresent(t)) return fail(state, bus, sim, 'Собеседник ушёл', true);
      if (dist(sim, t) <= WALK.socialDist) return arrive(state, bus, world, sim);
    }
    if (stepWalk(sim, dm, a.run)) arrive(state, bus, world, sim);
    return;
  }
  a.t += dm;
  if (a.phase === 'entry') {
    if (a.cancel) return toExit(state, bus, world, sim);
    if (a.t >= ANIM_MIN.entry) enterLoop(state, bus, sim);
  } else if (a.phase === 'loop') {
    if (a.step.social && a.accepted && a.step.social.topics && a.t >= a.nextTopic) {
      const s = a.step.social, t = simById(state, a.place.simId);
      const who = Math.floor(a.nextTopic / 3) % 2 && t ? t : sim;
      speak(state, bus, who, s.topics[Math.floor(rand(state) * s.topics.length)], who === sim ? t?.id : sim.id, 2);
      a.nextTopic += 3;
    }
    if (loopDone(state, sim)) toExit(state, bus, world, sim);
  } else if (a.phase === 'exit') {
    if (a.t >= ANIM_MIN.exit) endStep(state, bus, world, sim);
  }
}

function loopDone(state, sim) {
  const a = sim.act, s = a.step, m = sim.motives;
  if (a.cancel || a.t >= a.dur) return true;
  if (s.social && a.accepted && simById(state, a.place?.simId)?.reaction?.withId !== sim.id) return true;   // собеседник ушёл
  const u = s.until;
  if (u && m[u.motive] >= u.gte) return true;
  if (u?.wakeHours) { const h = hourOf(state.time.minutes); if (h >= u.wakeHours[0] && h < u.wakeHours[1] && m[u.motive] >= u.wakeAt) return true; }
  if (s.breakOn != null) {
    const own = new Set(Object.keys(s.effects ?? {}));
    if (MOTIVES.some(k => k !== 'room' && !own.has(k) && m[k] < s.breakOn)) return true;
  }
  return false;
}

function toExit(state, bus, world, sim) {
  const a = sim.act;
  if (a.anims?.exit) { a.phase = 'exit'; a.t = 0; sim.asleep = false; setAnim(sim, bus, a.anims.exit, { objId: a.place?.objId, once: true }); }
  else endStep(state, bus, world, sim);
}

function endStep(state, bus, world, sim) {
  const a = sim.act, s = a.step, p = a.place;
  sim.asleep = false;
  const o = p?.objId != null ? objById(state, p.objId) : null;
  if (o && s.stateFx && a.si >= 0) {
    if (s.stateFx.dirty) o.st.dirty = Math.min(100, (o.st.dirty ?? 0) + s.stateFx.dirty);
    if (s.stateFx.uses) o.st.uses = (o.st.uses ?? 0) + s.stateFx.uses;
  }
  const target = s.social ? simById(state, p?.simId) : null;
  if (target) { if (target.reaction?.withId === sim.id) target.reaction = null; socialCooldown(state, sim, target); }
  for (const id of a.group ?? []) { const o = simById(state, id); if (o?.reaction?.withId === sim.id) o.reaction = null; }
  if (s.social && a.accepted && target) endSocial(state, bus, sim, target, s.social, a.t, a.group);
  if (s.social && target && a.phase !== 'walk') for (const f of EVENTS.socialEnd) f(state, bus, sim, target, s.social, !!a.accepted);
  const completed = !a.cancel && a.phase !== 'walk';
  for (const f of EVENTS.stepEnd) f(state, bus, sim, a, o, completed);
  if (completed && s.done && (!s.social || a.accepted)) HOOKS[s.done]?.(state, bus, sim, { obj: o, act: a, minutes: a.t, target, world });
  if (a.spot?.onObject) stepOff(state, world, sim, a);
  release(state, bus, sim);
  sim.posture = 'stand';
  if (sim.act === a) nextStep(state, bus, world, sim);
}

// Встать с кровати/дивана: на ближайшую стоячую точку того же предмета или ближайшую свободную клетку
function stepOff(state, world, sim, a) {
  const o = a.place?.objId != null ? objById(state, a.place.objId) : null;
  const all = o && world?.useSpots ? world.useSpots(state, o.id).filter(s => !s.onObject) : [];
  let t = all.sort((p, q) => dist(p, sim) - dist(q, sim))[0];
  if (!t && world?.nearestFree) t = world.nearestFree(state, sim.level ?? 0, Math.floor(sim.x), Math.floor(sim.y));
  if (t) { sim.x = t.x + 0.5; sim.y = t.y + 0.5; if (t.level != null) sim.level = t.level; }
}

function release(state, bus, sim) {
  const p = sim.act?.place;
  const o = p?.objId != null ? objById(state, p.objId) : null;
  if (o) {
    o.st.users = users(o).filter(id => id !== sim.id);
    const was = o.st.inUse;
    o.st.inUse = o.st.users.find(id => simById(state, id)?.act?.phase !== 'walk') ?? null;
    if (was !== o.st.inUse) bus.emit('object:changed', { id: o.id });
  }
  if (sim.act) sim.act.place = null;
}

export function finishAction(state, bus, sim) {
  if (!sim.act) return;
  release(state, bus, sim);
  removeItem(sim, sim.act.uid);
  sim.act = null; sim.path = null; sim.asleep = false; sim.posture = 'stand';
  sim.brain.nextThink = state.time.minutes;
  setAnim(sim, bus, 'idle');
}

// Мгновенный обрыв (смерть, отъезд на работу)
export function abortAll(state, bus, sim) {
  if (sim.act) { release(state, bus, sim); sim.act = null; }
  sim.queue = []; sim.path = null; sim.asleep = false; sim.posture = 'stand';
}

function fail(state, bus, sim, reason, quiet = false) {
  const a = sim.act;
  if (!quiet) speak(state, bus, sim, '🚫');
  if (a?.by === 'user' && !quiet) notify(bus, `${sim.name}: ${reason}`, '🚫', sim.id);
  if (a?.by !== 'user' && a?.objId != null) (sim.brain.blocked ??= {})[a.objId] = state.time.minutes + AUTONOMY.blockedMinutes;
  if (a) a.cancel = true;
  finishAction(state, bus, sim);
}

// Эффекты текущей петли для тика потребностей → { effects, asleep, comfortPaused, passedOut, skill }
export function activeFx(state, sim) {
  const a = sim.act;
  if (!a || a.phase !== 'loop') return { asleep: false };
  const s = a.step;
  let effects = { ...(s.effects ?? {}) };
  if (s.social) effects = a.accepted ? scalePerMin(s.social.effects, s.social) : {};
  const own = a.place?.objId != null ? objById(state, a.place.objId) : null;
  if (own) for (const k of Object.keys(effects)) if (effects[k] > 0) effects[k] *= rateScale(own, k);   // вариант каталога
  if (s.meal && effects.hunger) {
    effects.hunger *= 1 + DERIVE.mealPerCookingPoint * (sim.skills.cooking ?? 0);
    if ((state.household.groceries ?? 0) > 0) effects.hunger *= GROCERY.mealBonus;              // свежие продукты
  }
  if (a.seatId != null && effects.comfort == null && sim.posture !== 'stand') {
    const seat = objById(state, a.seatId);
    effects.comfort = DERIVE.comfortPerMin(byId[seat?.def]?.ratings?.comfort ?? 0);
  }
  return {
    effects, asleep: !!s.asleep, passedOut: !!s.passedOut,
    comfortPaused: effects.comfort != null || sim.posture !== 'stand',
    skill: s.skill,
  };
}
