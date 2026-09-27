// 🧠 Мозг «Житьё» — публичный API (docs/CONTRACT.md §5, §8). Чистая логика: без DOM и three.js, работает в Node.
import { TIME, PRIORITY, REL, FAILURE, MOOD, JOBS, SERVICES, EASEL, GROCERY, WANTS_T } from '../core/tuning.js';
import { kindOf } from '../../data/catalog.js';
import { INTERACTIONS, TILE_ACTIONS } from '../../data/interactions.js';
import { byId } from '../../data/catalog.js';
import { MOTIVES, mood, motiveTick } from './motives.js';
import { HOOKS, EVENTS, startAction, updateAction, activeFx, abortAll, hasRoom } from './actions.js';
import { pushItem, cancelItem } from './queue.js';
import { think, allowed } from './autonomy.js';
import { careerTick, goWork, findJob } from './career.js';
import { gainSkill } from './skills.js';
import { payBills, addMoney } from './money.js';
import { socialsFor, phoneChat, targetBusy, inAHurry } from './social.js';
import { crossHours } from './time.js';
import { makeSim } from './factory.js';
import { TIMER_HANDLERS, runTimers } from './timers.js';
import { answer as answerDialog, ask as askDialog } from './dialogs.js';
import { dropObject } from './place.js';
import { die, reap } from './death.js';
import { placeDishes, toTrashCan, rollBreak, rollShock, rollFire, tickFires, putOut } from './hazards.js';
import { spawnNpc, npcThink, npcLeave, despawn, callService, inviteTownie, hourlyNpcs, burglarAlarm, catchBurglar } from './npc.js';
import { tryBaby, tickBabies, feedBaby, playBaby, takeBaby, schoolTick, goSchool, doneHomework, onRomance, isLover } from './family.js';
import { hourlyEvents, fireEvent } from './events.js';
import { ensureWants, rollWants, wantHit, wantHitAll, morningWants, relEvents, aspirationLevel } from './wants.js';
import { syncTownies, applyHoodRelations, dailyHood, throwParty, partyTick, partySocial, communityLots, canTravel, travel, goHome } from './hood.js';
import { addRel, relStatus } from './social.js';
import { ensureBrain, objById, simById, setAnim, speak, notify, facingTo, clampM, runtime, household, isHousehold, hourOf, dist, K } from './util.js';

export { MOTIVES, mood };
export { seed } from './util.js';
export { relStatus, getRel, familyFriends } from './social.js';
export { CAREERS } from '../core/tuning.js';
export { actionProgress } from './actions.js';
export { gradeLetter, isLover } from './family.js';
export { aspirationLevel } from './wants.js';
export { ASPIRATIONS, WANTS } from '../../data/wants.js';
export { EVENTS } from '../../data/events.js';
export { SOCIALS, SOCIAL_CATEGORIES } from '../../data/socials.js';
export { lockWant } from './wants.js';

// ── Хуки завершения шагов ─────────────────────────────────────────────
const changed = (bus, o) => o && bus.emit('object:changed', { id: o.id });
Object.assign(HOOKS, {
  clean: (state, bus, sim, { obj }) => { if (obj) { obj.st.dirty = 0; changed(bus, obj); } },
  lampOn: (state, bus, sim, { obj }) => { obj.st.on = true; changed(bus, obj); },
  lampOff: (state, bus, sim, { obj }) => { obj.st.on = false; changed(bus, obj); },
  water: (state, bus, sim, { obj }) => { obj.st.watered = state.time.minutes; changed(bus, obj); },
  payBills: (state, bus) => payBills(state, bus),
  findJob: (state, bus, sim, { act }) => findJob(state, bus, sim, JOBS[act.step.jobs] ?? JOBS.newspaper),
  goWork: (state, bus, sim) => goWork(state, bus, sim),
  goSchool: (state, bus, sim) => goSchool(state, bus, sim),
  phoneChat: (state, bus, sim, { minutes }) => phoneChat(state, bus, sim, minutes),
  cleanPuddle: (state, bus, sim, { act }) => removeAt(state, bus, 'puddles', act.target, 'puddle'),
  cleanTrash: (state, bus, sim, { act }) => removeAt(state, bus, 'trash', act.target, 'trash'),
  // грязь и поломки
  repair: (state, bus, sim, { obj }) => { if (obj && !obj.st.burnt) { obj.st.broken = false; changed(bus, obj); notify(bus, `Починено: ${byId[obj.def].name}`, '🔧', sim.id); wantHit(state, bus, sim, { kind: 'event', what: 'repair' }); } },
  clearDishes: (state, bus, sim, { obj }) => {
    const n = obj.st.dishes ?? 0;
    obj.st.dishes = 0; obj.st.dirty = 0; changed(bus, obj);
    if (n) toTrashCan(state, bus, sim, 1);
  },
  emptyTrash: (state, bus, sim, { obj }) => { obj.st.fill = 0; obj.st.dirty = 0; changed(bus, obj); },
  eatPizza: (state, bus, sim, { obj }) => {
    obj.st.pizza = Math.max(0, (obj.st.pizza ?? 0) - 2);
    if (!obj.st.pizza) toTrashCan(state, bus, sim, 1);
    changed(bus, obj);
  },
  // мольберт
  paintProgress: (state, bus, sim, { obj, minutes }) => {
    const was = obj.st.canvas ?? 0;
    obj.st.canvas = was + minutes;
    obj.st.painter = sim.id;
    if (was < EASEL.finishMinutes && obj.st.canvas >= EASEL.finishMinutes) notify(bus, `${sim.name} закончил(а) картину`, '🎨', sim.id);
    changed(bus, obj);
  },
  sellPainting: (state, bus, sim, { obj }) => {
    const painter = simById(state, obj.st.painter) ?? sim;
    const price = Math.round(EASEL.saleBase + EASEL.salePerSkill * (painter.skills.creativity ?? 0));
    obj.st.canvas = 0; changed(bus, obj);
    addMoney(state, bus, price, 'painting');
    wantHit(state, bus, sim, { kind: 'event', what: 'painting' });
    notify(bus, `Картина продана за §${price}`, '💰', sim.id);
  },
  // семья
  feedBaby: (state, bus, sim, { obj }) => { feedBaby(obj); changed(bus, obj); },
  playBaby: (state, bus, sim, { obj }) => { playBaby(obj); changed(bus, obj); },
  tryBaby: (state, bus, sim) => tryBaby(state, bus, sim),
  homework: (state, bus, sim) => doneHomework(sim, bus),
  // телефон
  hireMaid: (state, bus, sim) => {
    (state.household.services ??= {}).maid = true;
    notify(bus, `Горничная будет приходить в ${SERVICES.maid.from}:00 (§${SERVICES.maid.perHour}/ч)`, '🧹', sim.id);
    const h = hourOf(state.time.minutes);
    if (h >= SERVICES.maid.from && h < SERVICES.maid.to - 1 && !state.sims.some(s => s.npc === 'maid')) spawnNpc(state, bus, 'maid');
  },
  fireMaid: (state, bus, sim) => { state.household.services.maid = false; notify(bus, 'Горничная больше не придёт', '🧹', sim.id); },
  callRepair: (state, bus, sim) => callService(state, bus, 'repair', sim),
  callPizza: (state, bus, sim) => callService(state, bus, 'pizza', sim),
  invite: (state, bus, sim, { act }) => inviteTownie(state, bus, act.arg, sim),
  // гости
  inviteIn: (state, bus, sim, { target }) => {
    if (target?.npc !== 'townie') return;
    target.npc = 'visitor';
    target.npcTask = { since: state.time.minutes, until: state.time.minutes + SERVICES.invite.stay };
    abortAll(state, bus, target);
    notify(bus, `${target.name} зашёл(ла) в гости`, '🏠', sim.id);
  },
  askLeave: (state, bus, sim, { target }) => { if (target?.npc) npcLeave(state, bus, target); },
  // НПС
  despawn: (state, bus, sim) => despawn(state, bus, sim),
  extinguish: (state, bus, sim, { act }) => {
    const f = (state.lot.fires ?? []).find(f => f.x === act.target.x && f.y === act.target.y);
    if (f) putOut(state, bus, f);
  },
  steal: (state, bus, sim, { obj, world }) => {
    if (!obj) return;
    dropObject(state, bus, world, obj.id);
    notify(bus, `Украдено: ${byId[obj.def].name}`, '🦹');
    sim.npcTask.leaving = false; sim.npcTask.done = true;
  },
  catchBurglar: (state, bus, sim) => catchBurglar(state, bus, sim),
  reap: (state, bus, sim, { world }) => reap(state, bus, world, sim.npcTask.bodyId),
  takeBaby: (state, bus, sim, { obj }) => { takeBaby(state, bus, obj); changed(bus, obj); },
  // волна 3
  pay: (state, bus, sim, { act }) => { if (!sim.npc && act.step.price) addMoney(state, bus, -act.step.price, 'shop'); },
  buyGroceries: (state, bus, sim, { act }) => {
    if (!sim.npc) addMoney(state, bus, -(act.step.price ?? 0), 'groceries');
    state.household.groceries = (state.household.groceries ?? 0) + GROCERY.pack;
    notify(bus, `Продукты куплены: +${GROCERY.pack} обедов`, '🛒', sim.id);
  },
  lightFire: (state, bus, sim, { obj }) => { obj.st.lit = state.time.minutes || 1; changed(bus, obj); },
  putOutFire: (state, bus, sim, { obj }) => { obj.st.lit = 0; changed(bus, obj); },
  feedFish: (state, bus, sim, { obj }) => { obj.st.fed = state.time.minutes; changed(bus, obj); },
  loadDishwasher: (state, bus, sim) => { for (const o of state.objects) if (o.st.dishes) { o.st.dishes = 0; o.st.dirty = 0; changed(bus, o); } },
  changeOutfit: (state, bus, sim) => { sim.look.outfit = ((sim.look.outfit ?? 0) + 1) % 4; bus.emit('sim:look', { simId: sim.id }); },
  checkTime: (state, bus, sim) => { const m = Math.floor(state.time.minutes) % 1440; notify(bus, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, '🕰️', sim.id); },
  throwCoin: (state, bus, sim) => { addMoney(state, bus, -1, 'fountain'); if (Math.random() < 0.05) { addMoney(state, bus, 50, 'luck'); notify(bus, `${sim.name}: монетка принесла удачу! +§50`, '🍀', sim.id); } },
  tubRomance: (state, bus, sim, { obj }) => {
    for (const id of obj?.st.users ?? []) { const o = simById(state, id); if (o && o !== sim && isLover(sim, o)) { addRel(sim, o.id, 5); addRel(o, sim.id, 5); } }
  },
  propose: (state, bus, sim, { target }) => {
    sim.spouse = target.id; target.spouse = sim.id; notify(bus, `${sim.name} и ${target.name} — помолвка!`, '💍', sim.id);
    for (const s of [sim, target]) wantHit(state, bus, s, { kind: 'event', what: 'marry' });
  },
  fight: (state, bus, sim, { target }) => {
    const win = (sim.skills.body ?? 0) + Math.random() * 3 >= (target.skills?.body ?? 0) + Math.random() * 3;
    const loser = win ? target : sim;
    loser.motives.comfort = clampM(loser.motives.comfort - 20); loser.motives.fun = clampM(loser.motives.fun - 15);
    notify(bus, `${(win ? sim : target).name} победил(а) в драке`, '🥊', sim.id);
  },
  throwParty: (state, bus, sim) => throwParty(state, bus, sim),
  travel: (state, bus, sim, { act, world }) => { if (!travel(state, bus, world, act.arg)) notify(bus, 'Поехать не получилось', '🚫', sim.id); },
  goHome: (state, bus, sim, { world }) => goHome(state, bus, world),
  deliverPizza: (state, bus, sim) => {
    const hosts = state.objects.filter(o => ['counter', 'dining_table', 'coffee_table'].includes(K(o)) && !o.st.burnt);
    const fridge = state.objects.find(o => K(o) === 'fridge') ?? sim;
    const host = hosts.sort((a, b) => dist(a, fridge) - dist(b, fridge))[0];
    if (!host) return notify(bus, 'Пиццу некуда поставить — курьер уехал', '🍕');
    addMoney(state, bus, -SERVICES.pizza.price, 'pizza');
    host.st.pizza = (host.st.pizza ?? 0) + SERVICES.pizza.servings;
    changed(bus, host);
    notify(bus, `Пицца привезена (§${SERVICES.pizza.price})`, '🍕');
  },
});

function removeAt(state, bus, list, t, kind) {
  const P = state.lot[list] ?? [];
  const i = P.findIndex(p => p.x === t.x && p.y === t.y && (p.level ?? 0) === (t.level ?? 0));
  if (i >= 0) { P.splice(i, 1); bus.emit('lot:changed', { level: t.level ?? 0, kind }); }
}

// ── Подписки на фазы действий ─────────────────────────────────────────
EVENTS.loopStart.push((state, bus, sim, a, o) => {
  const s = a.step;
  if (s.fireRisk && o) rollFire(state, bus, sim, o);
  if (s.shockRisk && o) rollShock(state, bus, sim, o);
  if (s.alarmOnStart) burglarAlarm(state, bus);
});
const NO_BREAK = new Set(['repair', 'clean', 'steal', 'clear_dishes', 'empty_trash']);
EVENTS.stepEnd.push((state, bus, sim, a, o, done) => {
  if (!done || sim.npc && sim.npc !== 'visitor') return;
  if (a.step.dishes) placeDishes(state, bus, sim);
  if (o && a.t > 0 && !NO_BREAK.has(a.key)) rollBreak(state, bus, sim, o);
});
EVENTS.socialEnd.push((state, bus, sim, target, s, ok) => {
  wantHit(state, bus, sim, { kind: 'social', key: s.key, ok });
  if (!ok) return;
  if (s.romantic) onRomance(state, bus, sim, target);
  if (target.npc === 'townie' && s.key === 'greet') notify(bus, `${sim.name} познакомился(ась) с ${target.name}`, '👋', sim.id);
  if (s.mean) wantHit(state, bus, target, { kind: 'social_target', mean: true });
  relEvents(state, bus, sim, target);
  if (!target.npc) relEvents(state, bus, target, sim);
  if (target.npc === 'visitor') wantHit(state, bus, sim, { kind: 'event', what: 'visitor' });
  partySocial(state, sim, target);
});
EVENTS.stepEnd.push((state, bus, sim, a, o, done) => {
  if (!done || sim.npc) return;
  if (o) wantHit(state, bus, sim, { kind: 'use', objKind: K(o), key: a.key });
  if (a.step.meal && a.step.effects?.hunger && (state.household.groceries ?? 0) > 0) state.household.groceries--;
});

TIMER_HANDLERS.spawnNpc = (state, bus, world, d) => {
  if (d.npc === 'fire' && !(state.lot.fires ?? []).length) return;
  if (d.npc === 'police' && !state.sims.some(s => s.npc === 'burglar')) return;
  spawnNpc(state, bus, d.npc, d);
};
TIMER_HANDLERS.reaper = (state, bus, world, d) => spawnNpc(state, bus, 'reaper', { task: { bodyId: d.bodyId } });

// ── Симы ──────────────────────────────────────────────────────────────
export function addSim(state, bus, spec = {}) {
  ensureBrain(state);
  const sim = makeSim(state, spec);
  sim.brain.nextThink = state.time.minutes + household(state).length * TIME.staggerMinutes;   // не хором
  // домочадцы знакомы между собой (≈ стартовое отношение)
  for (const o of household(state)) {
    if (sim.rel[o.id] == null) sim.rel[o.id] = REL.householdStart;
    if (o.rel[sim.id] == null) o.rel[sim.id] = REL.householdStart;
  }
  state.sims.push(sim);
  applyHoodRelations(state, sim);
  ensureWants(sim);
  rollWants(state, bus, sim);
  bus.emit('sim:added', { id: sim.id });
  return sim.id;
}

// Слушатели шины для желаний/страхов (один раз на шину; state берётся текущий)
const LISTENED = new WeakSet();
function listen(bus) {
  if (LISTENED.has(bus)) return;
  LISTENED.add(bus);
  const S = () => runtime.state;
  bus.on('want', ({ simId, e }) => { const st = S(); if (!st) return; if (simId != null) { const s = simById(st, simId); if (s) wantHit(st, bus, s, e); } else wantHitAll(st, bus, e); });
  bus.on('skill:up', ({ simId, skill, level }) => { const st = S(), s = st && simById(st, simId); if (s) wantHit(st, bus, s, { kind: 'skill', skill, level }); });
  bus.on('money:changed', ({ money }) => { const st = S(); if (!st) return; wantHitAll(st, bus, { kind: 'money', value: money }); if (money < 1000) wantHitAll(st, bus, { kind: 'money_low' }); });
  bus.on('object:added', ({ id }) => {
    const st = S(), o = st && objById(st, id);
    if (!o || o.st?.boughtDay == null || o.st.boughtDay < 0) return;          // стартовые и бесплатные не считаются покупкой
    wantHitAll(st, bus, { kind: 'buy', objKind: kindOf(o.def), price: byId[o.def]?.price ?? 0 }, s => s.age !== 'child');
  });
  bus.on('sim:died', ({ simId }) => { const st = S(); if (st) wantHitAll(st, bus, { kind: 'event', what: 'death' }, s => s.id !== simId); });
  bus.on('fire:start', () => { const st = S(); if (st && (st.lot.fires ?? []).length === 1) wantHitAll(st, bus, { kind: 'event', what: 'fire' }); });
  bus.on('npc:arrive', ({ npc }) => { const st = S(); if (st && npc === 'burglar') wantHitAll(st, bus, { kind: 'event', what: 'burglar' }); });
}

export { fireEvent, rollWants };

export const answer = (state, bus, id, key) => answerDialog(state, bus, id, key);
// Вопрос-карточка тем же путём, что и собственные диалоги Мозга: bus 'dialog' → Интерфейс → answer() → onAnswer(key, {id, simId, data})
export const ask = (state, bus, spec, onAnswer) => askDialog(state, bus, spec, onAnswer);

// ── Главный тик ───────────────────────────────────────────────────────
export function tick(state, bus, world, dtRealSec) {
  const b = ensureBrain(state);
  if (state.mode && state.mode !== 'live') return;
  let mult = TIME.speeds[state.time.speed] ?? 0;
  if (!mult) return;
  const alive = household(state).filter(s => !s.dead);
  b.ultra = alive.length > 0 && alive.every(s => s.asleep || s.atWork);   // ✅ авто-ускорение
  if (b.ultra) mult = Math.max(mult, TIME.autoUltra);
  advance(state, bus, world, Math.min(dtRealSec, TIME.maxRealDt) * mult * TIME.minutesPerRealSec);
}

// Скорость 0..3 (пауза/×1/×3/×10). Авто-ультра пересчитывается каждый тик, на паузе снимается сразу.
export function setSpeed(state, bus, speed) {
  const b = ensureBrain(state);
  const v = Math.max(0, Math.min(TIME.speeds.length - 1, Math.round(Number(speed) || 0)));
  const was = state.time.speed;
  state.time.speed = v;
  if (v === 0) b.ultra = false;
  if (was !== v) bus.emit('time:speed', { speed: v });
  return v;
}

// Прокрутка на gm игровых минут (для тестов и харнесса — без ограничения dt)
export function advance(state, bus, world, gm) {
  ensureBrain(state);
  runtime.world = world; runtime.state = state;
  listen(bus);
  syncTownies(state);
  while (gm > 1e-9) {
    const dm = Math.min(gm, TIME.subStep);
    stepOnce(state, bus, world, dm);
    gm -= dm;
  }
}

function stepOnce(state, bus, world, dm) {
  const t0 = state.time.minutes, t1 = t0 + dm;
  state.time.minutes = t1;
  crossHours(state, bus, t0, t1, hour => {
    if (hour === 0) dailyHood(state, bus);
    if (hour === WANTS_T.rollHour) morningWants(state, bus);
    for (const s of household(state)) if (!s.dead && !s.atWork) for (const k of MOTIVES) wantHit(state, bus, s, { kind: 'motive', motive: k, value: s.motives[k] });
    hourlyNpcs(state, bus, hour);
    hourlyEvents(state, bus, hour);
  });
  runTimers(state, bus, world);
  for (const sim of [...state.sims]) if (state.sims.includes(sim)) updateSim(state, bus, world, sim, dm);
  const ticks = Math.floor(t1 / TIME.tickMinutes) - Math.floor(t0 / TIME.tickMinutes);
  for (let k = 0; k < ticks; k++) {
    for (const sim of [...state.sims]) motivesOf(state, bus, world, sim);
    tickFires(state, bus, TIME.tickMinutes);
    tickBabies(state, bus, TIME.tickMinutes);
    partyTick(state, bus, TIME.tickMinutes);
  }
}

function updateSim(state, bus, world, sim, dm) {
  if (sim.dead) return;
  const now = state.time.minutes;
  const st = sim.brain.stats;
  const label = sim.atWork ? (sim.atWork.school ? 'school' : 'work') : sim.reaction ? `social:${sim.reaction.key}` : sim.act ? (sim.act.phase === 'walk' ? 'walk' : sim.act.key) : 'idle';
  st[label] = (st[label] ?? 0) + dm;
  if (sim.bubble && now >= sim.bubble.until) sim.bubble = null;
  if (!sim.npc) (sim.age === 'child' ? schoolTick : careerTick)(state, bus, sim);
  if (sim.atWork || sim.dead) return;
  if (sim.reaction) {                                   // цель общения «заморожена» на время реакции
    const r = sim.reaction, w = simById(state, r.withId);
    // реакция не держит сима, которому надо куда-то (карпул, школа, команда игрока); разговор обрывается
    if (now >= r.until || !w || w.dead || w.atWork || inAHurry(sim)) {
      sim.reaction = null;
      setAnim(sim, bus, sim.act?.phase === 'walk' ? 'walk' : sim.act?.anims?.loop && sim.act.phase === 'loop' ? sim.act.anims.loop : 'idle');
    } else {
      if (w) sim.facing = facingTo(w.x - sim.x, w.y - sim.y);
      setAnim(sim, bus, r.anim);
      return;
    }
  }
  if (!sim.act && sim.queue.length) startAction(state, bus, world, sim, sim.queue[0]);
  if (sim.act) updateAction(state, bus, world, sim, dm);
  else if (now >= sim.brain.nextThink) {
    if (sim.npc) npcThink(state, bus, world, sim); else think(state, bus, world, sim);
    if (!sim.queue.length && sim.anim !== 'idle' && state.sims.includes(sim)) setAnim(sim, bus, 'idle');
  }
}

// Оценка комнаты: одна на комнату за тик (у всех симов в комнате одинаковая)
const roomCache = { t: -1, state: null, map: new Map() };
function roomMotive(state, world, sim) {
  if (!world?.roomAt || !world?.roomScore) return null;
  try {
    if (roomCache.t !== state.time.minutes || roomCache.state !== state) { roomCache.t = state.time.minutes; roomCache.state = state; roomCache.map.clear(); }
    const id = world.roomAt(state, Math.floor(sim.x), Math.floor(sim.y), sim.level ?? 0);
    if (!roomCache.map.has(id)) roomCache.map.set(id, world.roomScore(state, id));
    return roomCache.map.get(id);
  } catch { return null; }
}

function motivesOf(state, bus, world, sim) {
  if (sim.dead) return;
  if (sim.npc && !['townie', 'visitor'].includes(sim.npc)) return;      // работники — без потребностей
  const fx = sim.atWork ? {} : sim.reaction ? { effects: sim.reaction.effects } : activeFx(state, sim);
  const fails = motiveTick(sim, fx, TIME.tickMinutes, sim.atWork ? 0 : roomMotive(state, world, sim));
  if (sim.npc) { for (const k of MOTIVES) sim.motives[k] = Math.max(sim.motives[k], -50); return; }   // гости не «проваливаются»
  if (fx.skill && !sim.atWork) gainSkill(state, bus, sim, fx.skill.name, TIME.tickMinutes, fx.skill.mult);
  for (const f of fails) FAIL[f](state, bus, sim);
}

// ── Провалы потребностей (✅ TS1: лужа, обморок, голодная смерть) ──────
const FAIL = {
  puddle(state, bus, sim) {
    const m = sim.motives;
    m.bladder = 100;
    m.hygiene = clampM(m.hygiene + FAILURE.puddle.hygiene);
    m.comfort = clampM(m.comfort + FAILURE.puddle.comfort);
    if (sim.atWork) return;
    const P = (state.lot.puddles ??= []);
    const x = Math.floor(sim.x), y = Math.floor(sim.y), level = sim.level ?? 0;
    if (!P.some(p => p.x === x && p.y === y && p.level === level)) P.push({ x, y, level });
    bus.emit('lot:changed', { level, kind: 'puddle' });
    speak(state, bus, sim, '😳');
    notify(bus, `${sim.name} не успел(а) до туалета`, '💦', sim.id);
    if (sim.act) sim.act.cancel = true;
  },
  passOut(state, bus, sim) {
    if (sim.atWork || sim.act?.key === 'pass_out') return;
    abortAll(state, bus, sim);
    notify(bus, `${sim.name} уснул(а) прямо на полу`, '💤', sim.id);
    const uid = pushItem(state, bus, sim, { interaction: 'pass_out', target: { kind: 'internal' }, by: 'auto', prio: PRIORITY.max, icon: '💤' });
    startAction(state, bus, null, sim, sim.queue.find(q => q.uid === uid));
  },
  starve(state, bus, sim) { die(state, bus, sim, 'starve'); },
};

// ── Меню и очередь ────────────────────────────────────────────────────
function simBlock(sim) { return sim.dead ? 'Не может' : sim.atWork ? (sim.atWork.school ? 'В школе' : 'На работе') : null; }

export function interactionsFor(state, simId, target) {
  const sim = simById(state, simId);
  if (!sim || !target || sim.npc) return [];
  const block = simBlock(sim);
  const bad = mood(sim) < MOOD.bad;
  const pack = (it, reason, extra) => ({ key: it.key, label: it.label, icon: it.icon, ...extra, ...(reason && { disabled: true, reason }) });
  if (target.kind === 'object') {
    const obj = objById(state, target.id);
    if (!obj) return [];
    const ctx = { state, sim, obj };
    const out = [];
    for (const it of INTERACTIONS[K(obj)] ?? []) {
      if (!allowed(sim, it, obj) || (it.show && !it.show(ctx))) continue;
      const reason = block ?? (it.goodMood && bad ? 'Плохое настроение' : null) ?? (!hasRoom(obj, sim.id) ? 'Занято' : null) ?? it.check?.(ctx) ?? null;
      if (it.dynamic === 'lots') {                          // «Поехать…/Парк» — общественные участки района
        const trip = state.brain?.trip;
        for (const l of communityLots(state)) if (!trip || String(trip.lot) !== String(l.id))
          out.push(pack({ ...it, key: `${it.key}:${l.id}`, label: `${it.label}${l.name}` }, reason ?? (canTravel(runtime.world) ? null : 'Район ещё не готов')));
      } else if (it.dynamic === 'townies') {                // «Пригласить…/Имя» — по знакомым горожанам
        for (const t of state.brain?.townies ?? []) if (sim.rel?.[t.id] != null)
          out.push(pack({ ...it, key: `${it.key}:${t.id}`, label: `${it.label}${t.name}` }, reason));
      } else out.push(pack(it, reason));
    }
    return out;
  }
  if (target.kind === 'sim') {
    const other = simById(state, target.id);
    if (!other || other === sim || other.dead) return [];
    const busy = block ?? (other.atWork || other.asleep ? targetBusy(other) : null);
    return socialsFor(sim, other).map(s => pack(s, busy, { category: s.category }));
  }
  if (target.kind === 'tile') {
    const at = list => (state.lot[list] ?? []).some(p => p.x === Math.floor(target.x) && p.y === Math.floor(target.y) && (p.level ?? 0) === (target.level ?? 0));
    const puddle = at('puddles'), trash = at('trash');
    return TILE_ACTIONS.filter(a => (!a.needsPuddle || puddle) && (!a.needsTrash || trash) && (!a.needsTrip || state.brain?.trip)).map(a => pack(a, block));
  }
  return [];
}

export function enqueue(state, bus, simId, target, key) {
  const sim = simById(state, simId);
  if (!sim || !target) return null;
  const opt = interactionsFor(state, simId, target).find(o => o.key === key);
  if (!opt) return null;
  if (opt.disabled) { notify(bus, `${sim.name}: ${opt.reason}`, '🚫', sim.id); return null; }
  const [base, arg] = key.split(':');
  const item = { interaction: base, by: 'user', icon: opt.icon, label: opt.label, ...(arg != null && { arg }) };
  if (target.kind === 'object') Object.assign(item, { objId: target.id, target: { kind: 'object', id: target.id } });
  else if (target.kind === 'sim') item.target = { kind: 'sim', id: target.id };
  else item.target = { kind: 'tile', x: Math.floor(target.x), y: Math.floor(target.y), level: target.level ?? 0 };
  return pushItem(state, bus, sim, item);
}

export function cancel(state, bus, simId, uid) {
  const sim = simById(state, simId);
  return sim ? cancelItem(state, bus, sim, uid) : false;
}

// Для тестов/отладки: вызвать НПС вручную
export const debug = { spawnNpc, isHousehold };
