// Работа: карпул за час до смены → сим идёт к почтовому ящику и «уезжает» (sim.atWork),
// зарплата в конце смены, успеваемость по настроению, повышение по навыкам + друзьям семьи, увольнение за 2 пропуска (✅ TS1).
import { CAREER, CAREERS, MOOD, PRIORITY, TIME, JOBS } from '../core/tuning.js';
import { ask, DIALOG_HANDLERS } from './dialogs.js';
import { CHANCE, chanceText } from '../../data/careers.js';
import { mood } from './motives.js';
import { familyFriends } from './social.js';
import { addMoney } from './money.js';
import { pushItem, hasKey } from './queue.js';
import { abortAll } from './actions.js';
import { clamp, dayOf, notify, rand, setAnim, speak } from './util.js';

export const levelOf = career => CAREERS[career.track]?.levels[career.level - 1];

export function shiftOf(career, day) {
  const L = levelOf(career);
  const start = day * TIME.dayMinutes + L.hours[0] * 60;
  let end = day * TIME.dayMinutes + L.hours[1] * 60;
  if (end <= start) end += TIME.dayMinutes;                 // ночная смена (21–03)
  return { start, end };
}

// Проверка каждый под-шаг
export function careerTick(state, bus, sim) {
  const c = sim.career;
  if (!c || sim.dead || state.brain?.trip) return;          // в поездке карпул не ждёт
  const now = state.time.minutes, day = dayOf(now), b = sim.brain;
  if (sim.atWork) { if (now >= sim.atWork.until) returnHome(state, bus, sim); return; }
  if (b.workedDay === day || b.missedDay === day) return;
  const { start } = shiftOf(c, day);
  if (now >= start - CAREER.carpoolBefore && now < start) {
    if (b.carpoolDay !== day) {
      b.carpoolDay = day;
      notify(bus, `Машина приехала за ${sim.name}`, '🚗', sim.id);
      bus.emit('sfx', { name: 'carpool' });
    }
    // ✅ в плохом настроении сам не пойдёт — только по команде игрока (почтовый ящик → «Поехать на работу»)
    const going = sim.act?.key === 'go_to_work' || hasKey(sim, 'go_to_work');
    if (!going && mood(sim) >= MOOD.bad && sim.act?.by !== 'user') {
      pushItem(state, bus, sim, { interaction: 'go_to_work', target: { kind: 'internal' }, by: 'auto', prio: PRIORITY.carpool, icon: '🚗' });
    }
  } else if (now >= start && !(sim.act?.key === 'go_to_work' && now < start + 30)) {
    missDay(state, bus, sim, day);
  }
}

function missDay(state, bus, sim, day) {
  const c = sim.career;
  sim.brain.missedDay = day;
  c.missed = (c.missed ?? 0) + 1;
  bus.emit('want', { simId: sim.id, e: { kind: 'career', what: 'missed' } });
  sim.queue = sim.queue.filter(q => q.interaction !== 'go_to_work' || q.uid === sim.act?.uid);
  if (c.missed >= CAREER.missedToFire) {
    notify(bus, `${sim.name} уволен(а): пропущено ${c.missed} дня подряд`, '📉', sim.id);
    bus.emit('want', { simId: sim.id, e: { kind: 'career', what: 'fired' } });
    sim.career = null;
  } else notify(bus, `${sim.name} пропустил(а) работу`, '⚠️', sim.id);
}

// Хук 'goWork': сел в машину
export function goWork(state, bus, sim) {
  const c = sim.career;
  if (!c) return;
  const now = state.time.minutes, day = dayOf(now);
  if (sim.brain.workedDay === day || sim.brain.missedDay === day) return;
  const { end } = shiftOf(c, day);
  const m = mood(sim), P = CAREER.perf;
  const dp = m >= 0 ? P.goodBase + m * P.goodPerMood : m * P.badPerMood;
  c.perf = clamp((c.perf ?? 0) + dp, P.range[0], P.range[1]);
  c.missed = 0;
  sim.brain.workedDay = day;
  abortAll(state, bus, sim);
  sim.atWork = { until: end, track: c.track, level: c.level };
  setAnim(sim, bus, 'idle');
  notify(bus, `${sim.name} уехал(а) на работу`, '🚗', sim.id);
  if (rand(state) < CAREER.chanceCard) chanceCard(state, bus, sim);
}

// ✅ TS1: карточка случая — два варианта; A — риск, успех с вероятностью навык/10 (мин. 20 %)
export function chanceCard(state, bus, sim) {
  const cards = CHANCE[sim.career?.track];
  if (!cards?.length) return null;
  const i = Math.floor(rand(state) * cards.length), card = cards[i], t = chanceText(sim.career.track, i, card);
  return ask(state, bus, { kind: 'chance', simId: sim.id, icon: '🃏', text: `${sim.name}: ${t.text}`,
    options: [{ key: 'a', label: t.a }, { key: 'b', label: t.b }], data: { simId: sim.id, track: sim.career.track, i } });
}
DIALOG_HANDLERS.chance = (state, bus, d, key) => {
  const sim = state.sims.find(s => s.id === d.data.simId);
  const card = CHANCE[d.data.track]?.[d.data.i];
  if (!sim || !card) return;
  const opt = card[key];
  const skill = sim.skills[CAREERS[d.data.track].skill] ?? 0;
  const ok = key === 'b' || rand(state) < Math.max(0.2, skill / 10);
  applyEffects(state, bus, sim, ok ? opt.ok : opt.fail ?? {});
  const t = chanceText(d.data.track, d.data.i, card);
  notify(bus, `${sim.name}: ${(key === 'b' ? t.bOk : ok ? t.aOk : t.aFail) ?? (ok ? 'удача!' : 'не вышло')}`, ok ? '🍀' : '💢', sim.id);
  if (key === 'a') bus.emit('want', { simId: sim.id, e: { kind: 'career', what: ok ? 'chance_ok' : 'chance_fail' } });
};

// Общие эффекты (карточки, события, желания): money, perf, motives{}, skill{}, rel{key: d}
export function applyEffects(state, bus, sim, fx = {}) {
  if (fx.money) addMoney(state, bus, fx.money, 'event');
  if (fx.perf && sim?.career) sim.career.perf = clamp((sim.career.perf ?? 0) + fx.perf, CAREER.perf.range[0], CAREER.perf.range[1]);
  for (const [k, v] of Object.entries(fx.motives ?? {})) if (sim) sim.motives[k] = clamp(sim.motives[k] + v, -100, 100);
  for (const [k, v] of Object.entries(fx.skill ?? {})) if (sim) sim.skills[k] = clamp((sim.skills[k] ?? 0) + v, 0, 10);
}

function returnHome(state, bus, sim) {
  const c = sim.career;
  sim.atWork = null;
  sim.brain.nextThink = state.time.minutes;
  if (!c) return;
  const L = levelOf(c);
  addMoney(state, bus, L.pay, 'salary');
  sim.brain.earned = (sim.brain.earned ?? 0) + L.pay;
  notify(bus, `${sim.name} вернулся(ась) с работы: +§${L.pay}`, '💰', sim.id);
  bus.emit('want', { simId: sim.id, e: { kind: 'career', what: 'pay' } });
  const P = CAREER.perf;
  const next = CAREERS[c.track].levels[c.level];
  if (next && c.perf >= P.promoteAt && meetsReq(state, sim, next, c.level + 1)) {
    c.level++; c.perf = 0;
    speak(state, bus, sim, '🎉');
    notify(bus, `${sim.name}: повышение! ${next.title}, §${next.pay}/день`, '🎉', sim.id);
    bus.emit('sfx', { name: 'promotion' });
    bus.emit('want', { simId: sim.id, e: { kind: 'career', what: 'promote', level: c.level } });
  } else if (c.perf <= P.demoteAt && c.level > 1) {
    c.level--; c.perf = 0;
    notify(bus, `${sim.name}: понижение до «${levelOf(c).title}»`, '📉', sim.id);
    bus.emit('want', { simId: sim.id, e: { kind: 'career', what: 'demote' } });
  }
}

export function meetsReq(state, sim, L, levelNo) {
  for (const [k, v] of Object.entries(L.skills)) if ((sim.skills[k] ?? 0) < v) return false;
  return familyFriends(state) >= (L.friends ?? 0);
}

// Хук 'findJob': газета (1 вакансия) / компьютер (3) → диалог «принять/отказаться» (✅ TS1)
export function findJob(state, bus, sim, n = JOBS.newspaper) {
  const pool = Object.keys(CAREERS).filter(t => t !== sim.career?.track);
  const offers = [];
  while (offers.length < n && pool.length) offers.push(pool.splice(Math.floor(rand(state) * pool.length), 1)[0]);
  const options = offers.map(t => { const C = CAREERS[t], L = C.levels[0]; return { key: t, label: `${C.icon} ${C.name}: ${L.title}, §${L.pay}/день, ${L.hours.join('–')} ч` }; });
  options.push({ key: 'no', label: 'Отказаться' });
  return ask(state, bus, { kind: 'job', simId: sim.id, icon: n > 1 ? '💻' : '📰', text: `${sim.name}: вакансии${sim.career ? ' (сменить работу?)' : ''}`, options, data: { simId: sim.id } });
}

DIALOG_HANDLERS.job = (state, bus, d, key) => {
  const sim = state.sims.find(s => s.id === d.data.simId);
  if (!sim || key === 'no' || !CAREERS[key]) return;
  const C = CAREERS[key], L = C.levels[0];
  sim.career = { track: key, level: 1, perf: 0, missed: 0 };
  notify(bus, `${sim.name} устроился(ась): ${C.name} — ${L.title}, §${L.pay}/день, ${L.hours.join('–')} ч`, '💼', sim.id);
  bus.emit('want', { simId: sim.id, e: { kind: 'career', what: 'job' } });
};
