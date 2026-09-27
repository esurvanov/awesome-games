// Желания и страхи (слой TS2): устремление, 4 желания + 3 страха каждое утро, шкала устремления, награды.
// Триггер = событие {kind, …}; совпадение с match желания (level/value — «не меньше»).
import { WANTS_T, REL } from '../core/tuning.js';
import { WANTS, ASPIRATIONS, wantById } from '../../data/wants.js';
import { CATALOG, kindOf } from '../../data/catalog.js';
import { addMoney } from './money.js';
import { rand, notify, clamp, household, relKey } from './util.js';

const PERS_ASP = { family: p => p.nice, fortune: p => 10 - p.playful, knowledge: p => p.neat, popularity: p => p.outgoing, romance: p => p.playful, pleasure: p => p.active };

export function ensureWants(sim) {
  if (sim.npc) return null;
  if (!sim.wants) {
    const asp = sim.aspiration ?? (sim.age === 'child' ? 'grow_up'
      : Object.keys(PERS_ASP).sort((a, b) => PERS_ASP[b](sim.personality) - PERS_ASP[a](sim.personality))[0]);
    sim.wants = { asp, meter: 0, list: [], day: -1, done: 0 };
  }
  return sim.wants;
}

// Желание должно быть достижимо сегодня (иначе шкала не двигается): есть предмет, деньги, собеседник, работа…
const CHEAP = new Map();
const cheapest = kind => { if (!CHEAP.has(kind)) CHEAP.set(kind, Math.min(...CATALOG.filter(d => kindOf(d.id) === kind && d.buyable !== false).map(d => d.price))); return CHEAP.get(kind); };
function feasible(state, sim, w) {
  const m = w.match, money = state.household.money, kinds = new Set(state.objects.map(o => kindOf(o.def)));
  const others = state.sims.filter(s => s !== sim && !s.dead && (!s.npc || ['townie', 'visitor'].includes(s.npc))).length + Object.keys(sim.rel ?? {}).length;
  switch (m.kind) {
    case 'skill': return m.level == null ? (sim.skills[m.skill] ?? 0) < 10 : (sim.skills[m.skill] ?? 0) < m.level && m.level <= Math.floor(sim.skills[m.skill] ?? 0) + 2;
    case 'buy': return m.objKind ? !kinds.has(m.objKind) && cheapest(m.objKind) <= money / 2 : (m.price ?? 0) <= money / 2;
    case 'motive': return true;
    case 'use': return kinds.has(m.objKind);
    case 'social': return others > 0 && (!['kiss', 'propose', 'romantic_kiss', 'flirt'].includes(m.key) || Object.values(sim.rel ?? {}).some(v => v >= 50));
    case 'career': return m.what === 'job' ? !sim.career : !!sim.career && (m.level == null || sim.career.level < m.level);
    case 'money': return money < m.value && m.value <= money * 1.5;
    case 'event': return m.what === 'baby' ? Object.keys(sim.love ?? {}).length > 0 : m.what === 'homework' || m.what === 'grade' ? sim.age === 'child'
      : m.what === 'painting' ? kinds.has('easel') : m.what === 'travel' ? (state.hood?.lots ?? []).some(l => l.type === m.type) : true;
    default: return true;
  }
}

export function rollWants(state, bus, sim) {
  const W = ensureWants(sim);
  if (!W) return;
  const kid = sim.age === 'child';
  const pool = type => WANTS.filter(w => w.type === type && (!kid || w.asp.includes('grow_up') || type === 'fear') && !(kid && w.match.kind === 'career') && (type === 'fear' || feasible(state, sim, w)));
  const pick = (type, n) => {
    const out = [], P = pool(type);
    while (out.length < n && P.length) {
      const wt = P.map(w => (w.asp.includes(W.asp) ? WANTS_T.aspWeight : 1));
      let r = rand(state) * wt.reduce((a, b) => a + b, 0), i = 0;
      while ((r -= wt[i]) > 0 && i < P.length - 1) i++;
      out.push(P.splice(i, 1)[0].id);
    }
    return out;
  };
  // ✅ TS2: одно закреплённое желание переживает утренний бросок (пока не исполнено)
  const keep = W.list.find(i => i.id === W.locked && !i.done);
  if (!keep) W.locked = null;
  const wants = pick('want', WANTS_T.wants - (keep ? 1 : 0)).filter(id => id !== keep?.id);
  W.list = [...(keep ? [keep] : []), ...wants.map(id => ({ id, done: false })), ...pick('fear', WANTS_T.fears).map(id => ({ id, done: false }))];
  W.day = Math.floor(state.time.minutes / 1440);
  bus.emit('wants:changed', { simId: sim.id });
}

function matches(m, e) {
  if (m.kind !== e.kind) return false;
  for (const [k, v] of Object.entries(m)) {
    if (k === 'kind' || k === 'max') continue;
    if (k === 'lte') { if (!((e.value ?? Infinity) <= v)) return false; continue; }
    if (k === 'price') { if (!((e.price ?? -Infinity) >= v)) return false; continue; }
    if (k === 'level' || k === 'value' || k === 'count' || k === 'grade') { if (!((e[k] ?? -Infinity) >= v)) return false; }
    else if (k === 'stars') { if (m.max ? !((e.stars ?? 99) <= v) : !((e.stars ?? -1) >= v)) return false; }
    else if (e[k] !== v) return false;
  }
  return true;
}

// Событие для сима → выполненные желания/сработавшие страхи
export function wantHit(state, bus, sim, e) {
  const W = ensureWants(sim);
  if (!W || sim.dead) return 0;
  let n = 0;
  for (const it of W.list) {
    if (it.done) continue;
    const w = wantById[it.id];
    if (!w || !matches(w.match, e)) continue;
    it.done = true; n++;
    if (w.type === 'want') {
      W.meter = clamp(W.meter + w.pts, ...WANTS_T.meterRange); W.done++;
      sim.motives.fun = clamp(sim.motives.fun + WANTS_T.reward.fun, -100, 100);
      sim.motives.social = clamp(sim.motives.social + WANTS_T.reward.social, -100, 100);
      addMoney(state, bus, w.pts * WANTS_T.reward.moneyPerPt, 'want');
      notify(bus, `${sim.name}: желание сбылось — ${w.label}`, '⭐', sim.id);
      bus.emit('sfx', { name: 'want' });
    } else {
      W.meter = clamp(W.meter - w.pts, ...WANTS_T.meterRange);
      sim.motives.fun = clamp(sim.motives.fun + WANTS_T.fearHit.fun, -100, 100);
      notify(bus, `${sim.name}: страх сбылся — ${w.label}`, '😨', sim.id);
    }
  }
  if (n) bus.emit('wants:changed', { simId: sim.id });
  return n;
}
export const wantHitAll = (state, bus, e, filter = () => true) => household(state).filter(s => !s.dead && filter(s)).forEach(s => wantHit(state, bus, s, e));

// Закрепить желание (одно; null — снять). → true, если закреплено/снято
export function lockWant(state, bus, simId, wantId) {
  const sim = state.sims.find(s => s.id === simId), W = sim && ensureWants(sim);
  if (!W) return false;
  if (wantId == null) { W.locked = null; bus.emit('wants:changed', { simId }); return true; }
  const it = W.list.find(i => i.id === wantId);
  if (!it || it.done || wantById[wantId]?.type !== 'want') return false;
  W.locked = wantId;
  bus.emit('wants:changed', { simId });
  return true;
}

export function aspirationLevel(sim) {
  const m = sim.wants?.meter ?? 0, L = WANTS_T.levels;
  return m >= L.platinum ? 'platinum' : m >= L.gold ? 'gold' : m >= L.green ? 'green' : m >= L.red ? 'red' : 'failure';
}

// Утро: награда платины / штраф провала, затухание шкалы, новый бросок
export function morningWants(state, bus) {
  for (const s of household(state)) {
    if (s.dead) continue;
    const W = ensureWants(s);
    const lvl = aspirationLevel(s);
    if (lvl === 'platinum') { for (const k of ['fun', 'social', 'comfort']) s.motives[k] = clamp(s.motives[k] + WANTS_T.platinumBoost, -100, 100); notify(bus, `${s.name}: платиновое настроение!`, '💎', s.id); }
    if (lvl === 'failure') s.motives.fun = clamp(s.motives.fun - WANTS_T.platinumBoost, -100, 100);
    W.meter *= 1 - WANTS_T.dailyDecay;
    rollWants(state, bus, s);
  }
}

// Статус отношений после общения → события rel/friends/love/enemy
export function relEvents(state, bus, sim, other) {
  const v = sim.rel?.[relKey(other)] ?? 0;
  const status = v >= REL.crush ? 'crush' : v >= REL.friend ? 'friend' : v <= REL.enemy ? 'enemy' : null;
  if (status) wantHit(state, bus, sim, { kind: 'rel', status, value: v });
  if (status === 'crush') wantHit(state, bus, sim, { kind: 'rel', status: 'friend', value: v });
  wantHit(state, bus, sim, { kind: 'rel', value: v });
  const friends = Object.values(sim.rel ?? {}).filter(x => x >= REL.friend).length;
  wantHit(state, bus, sim, { kind: 'friends', count: friends });
  if (sim.love?.[other.id]) wantHit(state, bus, sim, { kind: 'love' });
}

export { ASPIRATIONS };
