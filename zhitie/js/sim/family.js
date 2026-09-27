// Романтика, младенец в кроватке, ребёнок и школа (CONTRACT §8 «Дети»).
import { REL, FAMILY, PRIORITY, TIME, SERVICES } from '../core/tuning.js';
import { makeSim } from './factory.js';
import { ask, DIALOG_HANDLERS } from './dialogs.js';
import { placeFree } from './place.js';
import { pushItem, hasKey } from './queue.js';
import { abortAll } from './actions.js';
import { spawnNpc } from './npc.js';
import { getRel } from './social.js';
import { rand, notify, clamp, dayOf, household, simById, runtime, isPresent, setAnim, K } from './util.js';

const BABY_NAMES = ['Алёша', 'Даша', 'Митя', 'Настя', 'Ваня', 'Катя', 'Петя', 'Оля'];

// ── Романтика ─────────────────────────────────────────────────────────
export const isLover = (a, b) => !!a.love?.[b.id] && getRel(a, b.id) >= REL.crush;
export function onRomance(state, bus, a, b) {
  if (getRel(a, b.id) >= REL.crush && getRel(b, a.id) >= REL.crush && !a.love?.[b.id]) {
    (a.love ??= {})[b.id] = true; (b.love ??= {})[a.id] = true;
    notify(bus, `${a.name} и ${b.name} влюблены`, '💕', a.id);
  }
}
export const partnerOf = (state, sim) => household(state).find(o => o !== sim && isPresent(o) && o.age === 'adult' && isLover(sim, o) && isLover(o, sim));

const babyCrib = state => state.objects.find(o => K(o) === 'crib' && o.st.baby);

// Хук «Попробовать завести ребёнка»
export function tryBaby(state, bus, sim) {
  const p = partnerOf(state, sim);
  if (!p) return notify(bus, `${sim.name}: нужен любимый человек рядом`, '💔', sim.id);
  if (babyCrib(state)) return notify(bus, 'В доме уже есть малыш', '👶', sim.id);
  if (household(state).filter(s => !s.dead).length >= FAMILY.maxSize) return notify(bus, 'Семья уже большая', '🏠', sim.id);
  ask(state, bus, { kind: 'baby', simId: sim.id, icon: '👶', text: `${sim.name} и ${p.name}: завести ребёнка?`,
    options: [{ key: 'yes', label: 'Да' }, { key: 'no', label: 'Нет' }], data: { a: sim.id, b: p.id } });
}

DIALOG_HANDLERS.baby = (state, bus, d, key) => {
  if (key !== 'yes') return;
  const a = simById(state, d.data.a), b = simById(state, d.data.b);
  if (a && b) babyBorn(state, bus, runtime.world, a, b);
};

export function babyBorn(state, bus, world, a, b) {
  let crib = state.objects.find(o => K(o) === 'crib' && !o.st.baby && !o.st.burnt);
  if (!crib) {
    const bed = state.objects.find(o => K(o) === 'bed_double') ?? a;
    crib = placeFree(state, bus, world, 'crib', Math.floor(bed.x), Math.floor(bed.y), a.level ?? 0);
    if (!crib) return notify(bus, 'Нет места для кроватки', '🚫', a.id);
    notify(bus, 'Кроватка поставлена бесплатно', '🛏️', a.id);
  }
  const name = BABY_NAMES[Math.floor(rand(state) * BABY_NAMES.length)];
  crib.st.baby = { name, born: state.time.minutes, hunger: 80, fun: 80, neglect: 0, parents: [a.id, b.id] };
  bus.emit('object:changed', { id: crib.id });
  bus.emit('sim:born', { simId: null, cribId: crib.id });
  notify(bus, `Родился малыш: ${name}!`, '👶', a.id);
  bus.emit('want', { e: { kind: 'event', what: 'baby' } });
  bus.emit('sfx', { name: 'baby' });
  return crib;
}

// Тик младенцев (раз в 2 мин)
export function tickBabies(state, bus, minutes) {
  for (const crib of state.objects) {
    const b = K(crib) === 'crib' && crib.st.baby;
    if (!b) continue;
    for (const k of ['hunger', 'fun']) b[k] = clamp(b[k] - (FAMILY.babyDecay[k] * minutes) / 60, -100, 100);
    const low = Math.min(b.hunger, b.fun);
    b.neglect = low <= FAMILY.babyNeglectBelow ? b.neglect + minutes : Math.max(0, b.neglect - minutes);
    if (low <= FAMILY.babyCryBelow && Math.floor(state.time.minutes / 60) !== b.lastCry) { b.lastCry = Math.floor(state.time.minutes / 60); bus.emit('sfx', { name: 'babyCry' }); }
    if (b.neglect >= SERVICES.socialWorkerNeglect && !b.worker) {
      b.worker = true;
      notify(bus, 'Малыш заброшен — едет соцработница', '📋');
      spawnNpc(state, bus, 'social', { task: { cribId: crib.id } });
    }
    if (state.time.minutes - b.born >= FAMILY.babyHours * 60) growUp(state, bus, crib);
  }
}

export function feedBaby(crib) { if (crib?.st.baby) crib.st.baby.hunger = clamp(crib.st.baby.hunger + FAMILY.babyFeed, -100, 100); }
export function playBaby(crib) { if (crib?.st.baby) crib.st.baby.fun = clamp(crib.st.baby.fun + FAMILY.babyPlay, -100, 100); }
export function takeBaby(state, bus, crib) {
  if (!crib?.st.baby) return;
  notify(bus, `Соцработница забрала малыша ${crib.st.baby.name}`, '📋');
  bus.emit('want', { e: { kind: 'event', what: 'baby_taken' } });
  crib.st.baby = null;
  bus.emit('object:changed', { id: crib.id });
}

function growUp(state, bus, crib) {
  const b = crib.st.baby;
  const r = () => Math.round(rand(state) * 10);
  const kid = makeSim(state, {
    name: b.name, age: 'child', x: crib.x + 0.5, y: crib.y + 1.5, level: crib.level ?? 0,
    personality: { neat: r(), outgoing: r(), active: r(), playful: r(), nice: r() },
    motives: { hunger: 70, comfort: 60, hygiene: 70, bladder: 70, energy: 80, fun: 60, social: 50, room: 0 },
  });
  for (const o of household(state)) {
    const fam = b.parents.includes(o.id) ? 60 : REL.householdStart;
    kid.rel[o.id] = fam; o.rel[kid.id] = fam;
  }
  crib.st.baby = null;
  state.sims.push(kid);
  bus.emit('object:changed', { id: crib.id });
  bus.emit('sim:added', { id: kid.id });
  bus.emit('sim:born', { simId: kid.id });
  notify(bus, `${kid.name} подрос(ла) и стал(а) ребёнком`, '🧒', kid.id);
}

// ── Школа ─────────────────────────────────────────────────────────────
export const gradeLetter = g => (g >= 90 ? 'A+' : g >= 80 ? 'A' : g >= 65 ? 'B' : g >= 50 ? 'C' : g >= 35 ? 'D' : 'F');

export function schoolTick(state, bus, sim) {
  const S = FAMILY.school, now = state.time.minutes, day = dayOf(now), b = sim.brain;
  sim.school ??= { grade: FAMILY.grade.start, homework: false };
  if (sim.atWork) { if (now >= sim.atWork.until) backFromSchool(state, bus, sim); return; }
  if (b.workedDay === day || b.missedDay === day) return;
  const start = day * TIME.dayMinutes + S.hours[0] * 60;
  if (now >= start - S.busBefore && now < start) {
    if (b.carpoolDay !== day) { b.carpoolDay = day; notify(bus, `Школьный автобус за ${sim.name}`, '🚌', sim.id); }
    if (sim.act?.key !== 'go_to_school' && !hasKey(sim, 'go_to_school') && sim.act?.by !== 'user')
      pushItem(state, bus, sim, { interaction: 'go_to_school', target: { kind: 'internal' }, by: 'auto', prio: PRIORITY.carpool, icon: '🚌' });
  } else if (now >= start && !(sim.act?.key === 'go_to_school' && now < start + 30)) {
    b.missedDay = day;
    sim.school.grade = clamp(sim.school.grade + FAMILY.grade.missed, 0, 100);
    sim.queue = sim.queue.filter(q => q.interaction !== 'go_to_school' || q.uid === sim.act?.uid);
    notify(bus, `${sim.name} пропустил(а) школу`, '⚠️', sim.id);
  }
}

export function goSchool(state, bus, sim) {
  const day = dayOf(state.time.minutes);
  if (sim.brain.workedDay === day) return;
  sim.brain.workedDay = day;
  if (sim.school.homework) sim.school.grade = clamp(sim.school.grade + FAMILY.grade.missedHomework, 0, 100);
  abortAll(state, bus, sim);
  sim.atWork = { until: day * TIME.dayMinutes + FAMILY.school.hours[1] * 60, school: true };
  setAnim(sim, bus, 'idle');
  notify(bus, `${sim.name} уехал(а) в школу`, '🚌', sim.id);
}

function backFromSchool(state, bus, sim) {
  const m = Object.values(sim.motives).reduce((a, b) => a + b, 0) / 8;
  sim.atWork = null;
  sim.brain.nextThink = state.time.minutes;
  sim.school.grade = clamp(sim.school.grade + (m >= 0 ? FAMILY.grade.goodDay : FAMILY.grade.badDay), 0, 100);
  sim.school.homework = true;
  notify(bus, `${sim.name} вернулся(ась) из школы · оценка ${gradeLetter(sim.school.grade)}`, '🎒', sim.id);
  bus.emit('want', { simId: sim.id, e: { kind: 'event', what: sim.school.grade < 35 ? 'grade_f' : 'grade', grade: sim.school.grade } });
}

export function doneHomework(sim, bus) {
  bus?.emit('want', { simId: sim.id, e: { kind: 'event', what: 'homework' } });
  if (!sim.school?.homework) return;
  sim.school.homework = false;
  sim.school.grade = clamp(sim.school.grade + FAMILY.grade.homework, 0, 100);
}

