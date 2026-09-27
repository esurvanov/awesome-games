// НПС (CONTRACT §8): записи в state.sims с npc и household:false. Приходят и уходят через улицу (y = h−1).
import { SERVICES, PRIORITY } from '../core/tuning.js';
import { makeSim } from './factory.js';
import { pushItem } from './queue.js';
import { later } from './timers.js';
import { addMoney } from './money.js';
import { think } from './autonomy.js';
import { byId } from '../../data/catalog.js';
import { ensureBrain, rand, notify, dist, hourOf, household, simById, objById, speak, K } from './util.js';

const NAMES = { maid: 'Горничная Люда', repair: 'Мастер Семёныч', fire: 'Пожарный', police: 'Участковый', burglar: 'Грабитель',
  reaper: 'Смерть', pizza: 'Курьер пиццы', social: 'Соцработница' };

function streetTile(state, nearX) {
  const mb = state.objects.find(o => K(o) === 'mailbox');
  const x = Math.max(0, Math.min(state.lot.w - 1, Math.round(nearX ?? mb?.x ?? state.lot.w / 2)));
  return { x, y: state.lot.h - 1 };
}

export function spawnNpc(state, bus, npc, extra = {}) {
  ensureBrain(state);
  const at = extra.at ?? streetTile(state);
  const s = makeSim(state, {
    name: extra.name ?? NAMES[npc] ?? 'Прохожий', npc, townieId: extra.townieId, x: at.x + 0.5, y: at.y + 0.5,
    motives: { hunger: 80, comfort: 70, hygiene: 90, bladder: 90, energy: 90, fun: 40, social: 30, room: 0 },
    skills: npc === 'repair' ? { mechanical: 10 } : {},
    npcTask: { since: state.time.minutes, ...extra.task },
  });
  state.sims.push(s);
  bus.emit('sim:added', { id: s.id });
  bus.emit('npc:arrive', { simId: s.id, npc });
  if (npc === 'police') for (const b of state.sims) if (b.npc === 'burglar') {   // грабитель замирает — кража не завершится
    b.npcTask.caught = true; b.queue = []; if (b.act) b.act.cancel = true;
    speak(state, bus, b, '😨');
  }
  return s;
}

export function npcLeave(state, bus, s) {
  if (s.npcTask.leaving) return;
  s.npcTask.leaving = true;
  s.queue = s.queue.filter(q => q.uid === s.act?.uid);
  if (s.act) s.act.cancel = true;
  const t = streetTile(state, s.x);
  pushItem(state, bus, s, { interaction: 'leave', target: { kind: 'internal', x: t.x, y: t.y }, by: 'auto', prio: PRIORITY.carpool, icon: '👋' });
}

export function despawn(state, bus, s) {
  const i = state.sims.indexOf(s);
  if (i < 0) return;
  payFor(state, bus, s);
  state.sims.splice(i, 1);
  bus.emit('npc:leave', { simId: s.id, npc: s.npc });
  bus.emit('sim:removed', { id: s.id });
}

function payFor(state, bus, s) {
  const hours = Math.max(0, (state.time.minutes - s.npcTask.since) / 60);
  if (s.npc === 'maid') { const c = Math.ceil(hours) * SERVICES.maid.perHour; if (c) addMoney(state, bus, -c, 'maid'); }
  if (s.npc === 'repair') { const c = Math.max(SERVICES.repair.minHours, Math.ceil(hours)) * SERVICES.repair.perHour; addMoney(state, bus, -c, 'repair'); }
}

const LOOT_CATS = ['electronics', 'decor', 'lighting'];   // ✅ TS1: техника, искусство, декор — не холодильник/плита
const push = (state, bus, s, item) => pushItem(state, bus, s, { by: 'auto', prio: PRIORITY.auto, ...item });
const nearest = (list, s) => [...list].sort((a, b) => dist(a, s) - dist(b, s))[0];
const objItem = (o, key) => ({ objId: o.id, interaction: key, target: { kind: 'object', id: o.id } });

// Решение НПС, когда он свободен
export function npcThink(state, bus, world, s) {
  const now = state.time.minutes, T = s.npcTask;
  if (T.leaving) return npcLeave(state, bus, s);
  const B = NPC[s.npc];
  if (!B) return npcLeave(state, bus, s);
  if (B(state, bus, world, s, now, T) === false) npcLeave(state, bus, s);
}

const NPC = {
  maid(state, bus, world, s, now) {
    if (hourOf(now) >= SERVICES.maid.to) return false;
    const P = state.lot.puddles ?? [], TR = state.lot.trash ?? [];
    if (P.length) { const p = nearest(P, s); return push(state, bus, s, { interaction: 'clean_puddle', target: { kind: 'tile', ...p } }); }
    if (TR.length) { const p = nearest(TR, s); return push(state, bus, s, { interaction: 'clean_trash', target: { kind: 'tile', ...p } }); }
    const job = [['clear_dishes', o => o.st.dishes > 0], ['clean', o => (o.st.dirty ?? 0) >= 20 && ['stove', 'toilet', 'shower', 'bathtub'].includes(K(o))],
      ['empty_trash', o => K(o) === 'trash_can' && (o.st.fill ?? 0) >= 1]];
    for (const [key, f] of job) { const o = nearest(state.objects.filter(o => !o.st.burnt && f(o)), s); if (o) return push(state, bus, s, objItem(o, key)); }
    return false;
  },
  repair(state, bus, world, s) {
    const o = nearest(state.objects.filter(o => o.st.broken && !o.st.burnt), s);
    return o ? push(state, bus, s, objItem(o, 'repair')) : false;
  },
  fire(state, bus, world, s) {
    const f = nearest(state.lot.fires ?? [], s);
    return f ? push(state, bus, s, { interaction: 'extinguish', target: { kind: 'internal', x: f.x, y: f.y, near: true } }) : false;
  },
  police(state, bus, world, s, now, T) {
    const b = state.sims.find(x => x.npc === 'burglar');
    if (!b) return false;
    return push(state, bus, s, { interaction: 'catch', target: { kind: 'internal', x: Math.floor(b.x), y: Math.floor(b.y), near: true }, prio: PRIORITY.user });
  },
  burglar(state, bus, world, s, now, T) {
    if (T.caught) { s.brain.nextThink = now + 1; return true; }   // застыл перед полицией
    if (T.done) return false;
    T.done = true;
    const val = o => o.st.value ?? byId[o.def].price;
    const loot = state.objects.filter(o => { const d = byId[o.def]; return d && LOOT_CATS.includes(d.cat) && d.fp[0] * d.fp[1] <= 2 && d.buyable !== false && !o.st.burnt && val(o) > 0; })
      .sort((a, b) => val(b) - val(a) || dist(a, s) - dist(b, s))[0];
    return loot ? push(state, bus, s, objItem(loot, 'steal')) : false;
  },
  reaper(state, bus, world, s, now, T) {
    const body = simById(state, T.bodyId);
    if (!body || T.done) return false;
    T.done = true;
    return push(state, bus, s, { interaction: 'reap', target: { kind: 'internal', x: Math.floor(body.x), y: Math.floor(body.y), near: true } });
  },
  pizza(state, bus, world, s, now, T) {
    if (T.done) return false;
    T.done = true;
    return push(state, bus, s, { interaction: 'deliver', target: { kind: 'internal' } });
  },
  social(state, bus, world, s, now, T) {
    const crib = objById(state, T.cribId);
    if (!crib?.st.baby || T.done) return false;
    T.done = true;
    return push(state, bus, s, objItem(crib, 'take_baby'));
  },
  townie(state, bus, world, s, now, T) {           // прохожий: идёт вдоль улицы
    if (T.walked) return false;
    T.walked = true;
    const x = s.x < state.lot.w / 2 ? state.lot.w - 1 : 0;
    return push(state, bus, s, { interaction: 'walk_by', target: { kind: 'internal', x, y: state.lot.h - 1 } });
  },
  visitor(state, bus, world, s, now, T) {          // гость: живёт автономией с «гостевым» затуханием
    const h = hourOf(now);
    if (now >= T.until || h >= 23 || h < SERVICES.invite.noBefore) return false;
    think(state, bus, world, s, { visitor: true });
    return true;
  },
};

// ── Службы и события (таймеры / часы) ─────────────────────────────────
export function callService(state, bus, kind, sim) {
  if (kind === 'repair') { notify(bus, 'Мастер приедет примерно через час', '🔧', sim?.id); later(state, SERVICES.repair.delay, 'spawnNpc', { npc: 'repair' }); }
  if (kind === 'pizza') { notify(bus, `Пицца будет через час (§${SERVICES.pizza.price})`, '🍕', sim?.id); later(state, SERVICES.pizza.delay, 'spawnNpc', { npc: 'pizza' }); }
}

export function inviteTownie(state, bus, townieId, sim) {
  const t = state.brain.townies.find(t => t.id === townieId);
  if (!t) return;
  if (state.sims.some(s => s.townieId === townieId)) return notify(bus, `${t.name} уже здесь`, '📞', sim?.id);
  notify(bus, `${t.name} придёт в гости`, '📞', sim?.id);
  later(state, SERVICES.invite.delay, 'spawnNpc', { npc: 'visitor', townieId, name: t.name, task: { until: state.time.minutes + SERVICES.invite.delay + SERVICES.invite.stay } });
}

// Каждый час: горничная, прохожие, грабитель
export function hourlyNpcs(state, bus, hour) {
  const H = household(state).filter(s => !s.dead);
  if (!H.length) return;
  if (state.household.services?.maid && hour === SERVICES.maid.from && !state.sims.some(s => s.npc === 'maid')) spawnNpc(state, bus, 'maid');
  const W = SERVICES.walkBy;
  if (hour >= W.from && hour < W.to && rand(state) < W.chancePerHour) {
    const free = state.brain.townies.filter(t => !state.sims.some(s => s.townieId === t.id));
    const t = free[Math.floor(rand(state) * free.length)];
    if (t) spawnNpc(state, bus, 'townie', { townieId: t.id, name: t.name, at: { x: rand(state) < 0.5 ? 0 : state.lot.w - 1, y: state.lot.h - 1 } });
  }
  const Bg = SERVICES.burglar;
  if (hour === Bg.hour && H.every(s => s.asleep || s.atWork) && rand(state) < Bg.chance) {
    spawnNpc(state, bus, 'burglar');
    bus.emit('sfx', { name: 'burglar' });
  }
}

// Сигнализация при начале кражи
export function burglarAlarm(state, bus) {
  if (!state.objects.some(o => K(o) === 'burglar_alarm' && !o.st.burnt)) return;
  notify(bus, 'Сигнализация! Вызвана полиция', '🚨');
  bus.emit('sfx', { name: 'alarm' });
  later(state, SERVICES.burglar.policeDelay, 'spawnNpc', { npc: 'police' });
}

// Хук полиции: поймал грабителя
export function catchBurglar(state, bus, cop) {
  const b = state.sims.find(x => x.npc === 'burglar');
  if (!b) return;
  speak(state, bus, cop, '🚓');
  despawn(state, bus, b);
  addMoney(state, bus, SERVICES.burglar.reward, 'reward');
  notify(bus, `Грабитель пойман! Награда §${SERVICES.burglar.reward}`, '🏅');
}

export const isWorker = s => !!s.npc && !['townie', 'visitor'].includes(s.npc);
