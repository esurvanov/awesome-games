// Планировщик случайных событий (data/events.js): звонки, письма, газета, гости, случаи.
import { EVENTS_T, SERVICES } from '../core/tuning.js';
import { EVENTS, eventById, EVENT_ICON } from '../../data/events.js';
import { ask, DIALOG_HANDLERS } from './dialogs.js';
import { later, TIMER_HANDLERS } from './timers.js';
import { applyEffects, findJob } from './career.js';
import { addMoney } from './money.js';
import { addRel } from './social.js';
import { spawnNpc } from './npc.js';
import { ensureBrain, rand, notify, dayOf, household, isPresent, K, runtime } from './util.js';
import { placeFree } from './place.js';
import { CATALOG, kindOf } from '../../data/catalog.js';

const adults = state => household(state).filter(s => isPresent(s) && s.age !== 'child');

function eligible(state, e, hour) {
  const w = e.when ?? {}, H = household(state);
  if (w.career && !H.some(s => s.career)) return false;
  if (w.kids && !H.some(s => s.age === 'child')) return false;
  if (w.moneyGte != null && state.household.money < w.moneyGte) return false;
  if (w.moneyLt != null && state.household.money >= w.moneyLt) return false;
  if (w.noCareer && !H.some(s => !s.npc && s.age !== 'child' && !s.career)) return false;
  if (w.single && !H.some(s => s.age !== 'child' && !Object.keys(s.love ?? {}).length)) return false;
  if (w.hours && (hour < w.hours[0] || hour >= w.hours[1])) return false;
  return true;
}

export function hourlyEvents(state, bus, hour) {
  const b = ensureBrain(state), day = dayOf(state.time.minutes);
  if (hour < EVENTS_T.hours[0] || hour >= EVENTS_T.hours[1] || !adults(state).length) return;
  if (b.evDay !== day) { b.evDay = day; b.evCount = 0; }
  if (b.evCount >= EVENTS_T.maxPerDay || rand(state) >= EVENTS_T.perHour) return;
  const list = EVENTS.filter(e => eligible(state, e, hour));
  let r = rand(state) * list.reduce((t, e) => t + e.w, 0);
  const e = list.find(x => (r -= x.w) <= 0) ?? list[list.length - 1];
  if (e) { b.evCount++; fireEvent(state, bus, e); }
}

// Запустить событие (для тестов — по id)
export function fireEvent(state, bus, e, sim) {
  if (typeof e === 'string') e = eventById[e];
  const A = adults(state);
  sim ??= A[Math.floor(rand(state) * A.length)];
  if (!e || !sim) return null;
  const icon = e.icon ?? EVENT_ICON[e.kind] ?? '📰';
  bus.emit('sfx', { name: e.kind === 'phone' ? 'phone' : e.kind === 'letter' ? 'mail' : 'notify' });
  bus.emit('event', { id: e.id, kind: e.kind, simId: sim.id });
  if (e.choices) return ask(state, bus, { kind: 'event', simId: sim.id, icon, text: e.text,
    options: e.choices.map((c, i) => ({ key: String(i), label: c.label })), data: { id: e.id, simId: sim.id } });
  notify(bus, e.text, icon, sim.id);
  applyEventFx(state, bus, sim, e.fx);
  return e.id;
}

DIALOG_HANDLERS.event = (state, bus, d, key) => {
  const e = eventById[d.data.id], sim = state.sims.find(s => s.id === d.data.simId);
  const c = e?.choices?.[+key];
  if (!c || !sim) return;
  let ok = true;
  if (c.chance != null) ok = rand(state) < c.chance;
  if (c.skill) ok = rand(state) < Math.max(0.2, (sim.skills[c.skill] ?? 0) / 10);
  if (c.invest) { addMoney(state, bus, -c.invest, 'invest'); later(state, EVENTS_T.invest.days * 1440, 'invest', { amount: c.invest }); }
  applyEventFx(state, bus, sim, ok ? c.fx : c.fail ?? {});
  const said = ok ? c.text : c.failText;
  if (said) notify(bus, said, ok ? '🍀' : '💢', sim.id);
  else if (c.chance != null || c.skill) notify(bus, ok ? 'Получилось!' : 'Не повезло…', ok ? '🍀' : '💢', sim.id);
};
TIMER_HANDLERS.invest = (state, bus, world, d) => {
  const back = Math.round(d.amount * (1 + EVENTS_T.invest.rate));
  addMoney(state, bus, back, 'invest');
  notify(bus, `Вклад вернулся с процентами: §${back}`, '🏦');
};

export function applyEventFx(state, bus, sim, fx = {}) {
  const { special, rel, money, ...rest } = fx;
  if (special === 'stocks') addMoney(state, bus, Math.round(state.household.money * EVENTS_T.stocksRate * Math.sign(money ?? 1)), 'stocks');
  else if (money) addMoney(state, bus, money, 'event');
  applyEffects(state, bus, sim, rest);
  if (rel) { const T = ensureBrain(state).townies; const t = T[Math.floor(rand(state) * T.length)]; if (t) addRel(sim, t.id, rel); }
  if (fx.gift) {                                           // подарок-предмет: ставится бесплатно рядом с почтовым ящиком
    const def = CATALOG.find(d => kindOf(d.id) === fx.gift && d.buyable !== false);
    const mb = state.objects.find(o => K(o) === 'mailbox') ?? sim;
    if (def) placeFree(state, bus, runtime.world, def.id, Math.floor(mb.x), Math.floor(mb.y), mb.level ?? 0);
  }
  if (special === 'billDiscount') { const b = state.household.bills.at(-1); if (b) b.amount = Math.round(b.amount * EVENTS_T.billDiscount); }
  if (special === 'gradeUp') for (const k of household(state)) if (k.school) k.school.grade = Math.min(100, k.school.grade + 5);
  if (special === 'jobOffer') findJob(state, bus, sim, 1);
  if (special === 'freePizza') {
    const host = state.objects.find(o => ['counter', 'dining_table', 'coffee_table'].includes(K(o)) && !o.st.burnt);
    if (host) { host.st.pizza = (host.st.pizza ?? 0) + SERVICES.pizza.servings; bus.emit('object:changed', { id: host.id }); }
  }
  if (special === 'visitor') {
    const T = ensureBrain(state).townies.filter(t => !state.sims.some(s => s.townieId === t.id));
    const t = T[Math.floor(rand(state) * T.length)];
    if (t) { spawnNpc(state, bus, 'visitor', { townieId: t.id, name: t.name, task: { until: state.time.minutes + SERVICES.invite.stay } }); addRel(sim, t.id, 2); }
  }
  if (special === 'puddle') {
    const P = (state.lot.puddles ??= []);
    const w = state.objects.find(o => ['toilet', 'shower', 'bathtub', 'kitchen_sink', 'bath_sink'].includes(K(o)));
    if (w) { P.push({ x: w.x, y: w.y + 1, level: w.level ?? 0 }); bus.emit('lot:changed', { level: w.level ?? 0, kind: 'puddle' }); }
  }
}
