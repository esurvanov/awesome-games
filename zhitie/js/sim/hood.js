// Район: горожане из state.hood / data/hood.js, жизнь семей «за кадром», вечеринки, поездки на общественные участки.
import { PARTY, HOOD_T, CAREERS, SERVICES } from '../core/tuning.js';
import { HOOD } from './content.js';
import { spawnNpc, npcLeave, despawn } from './npc.js';
import { abortAll } from './actions.js';
import { addRel } from './social.js';
import { wantHit, wantHitAll } from './wants.js';
import { ensureBrain, rand, notify, household, isPresent, hourOf, relKey } from './util.js';

// ── Горожане ──────────────────────────────────────────────────────────
const idOf = (t, i) => t.id ?? t.hoodId ?? t.key ?? `h${i}`;
export function syncTownies(state) {
  const b = ensureBrain(state);
  const src = state.hood?.townies?.length ? 'hood' : HOOD.townies.length ? 'writer' : 'tuning';
  if (b.townieSrc === src) return;
  const list = src === 'hood' ? state.hood.townies : src === 'writer' ? HOOD.townies : null;
  if (list) b.townies = list.map((t, i) => ({ id: String(idOf(t, i)), name: t.name ?? `Горожанин ${i + 1}`, spec: t }));
  b.townieSrc = src;
}

// Отношения из данных Писателя для сима семьи района (spec.hoodId)
export function applyHoodRelations(state, sim) {
  if (!sim.hoodId) return;
  const R = [...(state.hood?.relations ?? []), ...HOOD.relations];
  const byHood = new Map(household(state).filter(s => s.hoodId).map(s => [s.hoodId, s]));
  for (const r of R) {
    const [a, b, v] = Array.isArray(r) ? r : [r.a, r.b, r.value];
    for (const [x, y] of [[a, b], [b, a]]) {
      if (x !== sim.hoodId) continue;
      const other = byHood.get(y);
      sim.rel[other ? other.id : y] = v;
      if (other) other.rel[sim.id] = v;
      const flags = (Array.isArray(r) ? r[3] : r.flags) ?? [];
      if (other && (flags.includes('love') || flags.includes('married'))) { (sim.love ??= {})[other.id] = true; (other.love ??= {})[sim.id] = true; }
      if (other && flags.includes('married')) { sim.spouse = other.id; other.spouse = sim.id; }
    }
  }
}

// ── Жизнь за кадром (полночь) ─────────────────────────────────────────
export function dailyHood(state, bus) {
  const H = state.hood;
  if (!H) return;
  const active = H.lots?.find(l => l.id === H.activeLotId)?.familyId;
  for (const f of H.families ?? []) {
    if (f.id === active) continue;
    for (const m of f.members ?? []) {
      const c = m.career, L = c && CAREERS[c.track ?? c]?.levels;
      if (!L) continue;
      const lv = c.level ?? 1;
      f.funds = (f.funds ?? 0) + (L[lv - 1]?.pay ?? 0);
      if (typeof c === 'object' && lv < 10 && rand(state) < HOOD_T.promoteChance) c.level = lv + 1;
    }
  }
  const people = [...(H.families ?? []).flatMap(f => (f.members ?? []).map((m, i) => m.id ?? m.hoodId ?? `${f.id}:${i}`)), ...ensureBrain(state).townies.map(t => t.id)];
  H.rel ??= {};
  for (let i = 0; i < HOOD_T.befriendPairs && people.length > 1; i++) {
    const a = people[Math.floor(rand(state) * people.length)], b = people[Math.floor(rand(state) * people.length)];
    if (a === b) continue;
    const k = [a, b].sort().join('|'), [lo, hi] = HOOD_T.befriendDelta;
    H.rel[k] = Math.min(100, (H.rel[k] ?? 0) + lo + Math.floor(rand(state) * (hi - lo + 1)));
  }
  H.day = (H.day ?? 0) + 1;
}

// ── Вечеринка ─────────────────────────────────────────────────────────
export function throwParty(state, bus, host) {
  const b = ensureBrain(state);
  if (b.party) return notify(bus, 'Вечеринка уже идёт', '🎉', host.id);
  const now = state.time.minutes;
  const T = b.townies.filter(t => !state.sims.some(s => s.townieId === t.id))
    .sort((x, y) => (host.rel?.[y.id] ?? -1) - (host.rel?.[x.id] ?? -1));
  const n = Math.min(T.length, PARTY.minGuests + Math.floor(rand(state) * (PARTY.maxGuests - PARTY.minGuests + 1)));
  if (n < PARTY.minGuests) return notify(bus, 'Некого позвать', '📞', host.id);
  const guests = T.slice(0, n);
  b.party = { start: now + PARTY.arrive, until: now + PARTY.arrive + PARTY.hours * 60, meter: 0, guests: guests.map(g => g.id), host: host.id };
  for (const g of guests) spawnNpc(state, bus, 'visitor', { townieId: g.id, name: g.name, task: { until: b.party.until, party: true } });
  notify(bus, `Вечеринка! Приглашено гостей: ${n}`, '🎉', host.id);
  bus.emit('sfx', { name: 'party' });
}

const partyPeople = state => state.sims.filter(s => isPresent(s) && (!s.npc || s.npcTask?.party));
export function partyTick(state, bus, minutes) {
  const P = state.brain?.party;
  if (!P) return;
  const now = state.time.minutes;
  if (now >= P.start) for (const s of partyPeople(state)) {
    const m = Object.values(s.motives).reduce((a, v) => a + v, 0) / 8;
    if (m > 0) P.meter += PARTY.perMoodTick * m * minutes;
    if (s.act?.key === 'dance' || s.act?.key === 'dance_together') P.meter += PARTY.perMoodTick * 20 * minutes;
  }
  if (now >= P.until) endParty(state, bus);
}
export function partySocial(state, sim, target) {
  const P = state.brain?.party;
  if (!P || state.time.minutes < P.start) return;
  if ([sim, target].every(s => !s.npc || s.npcTask?.party)) P.meter += PARTY.perSocial;
}
function endParty(state, bus) {
  const P = state.brain.party;
  state.brain.party = null;
  const stars = PARTY.stars.filter(t => P.meter >= t).length;
  notify(bus, `Вечеринка окончена: ${'★'.repeat(stars)}${'☆'.repeat(PARTY.stars.length - stars)}`, '🎉');
  for (const s of state.sims) if (s.npcTask?.party) {
    if (stars >= 2) for (const h of household(state)) addRel(h, relKey(s), PARTY.relBonus);
    npcLeave(state, bus, s);
  }
  wantHitAll(state, bus, { kind: 'event', what: 'party', stars });
  return stars;
}

// ── Поездки на общественные участки ───────────────────────────────────
export const communityLots = state => (state.hood?.lots ?? []).filter(l => l.kind === 'community');
export const canTravel = world => !!world?.loadLot;

// Переезд семьи на другой участок: Мир сам снимает снимок и перевозит `bring` (клоны) — дальше работаем с тем, что в state
function moveHousehold(state, bus, world, lotId, travellers) {
  for (const s of [...state.sims]) if (s.npc) despawn(state, bus, s);             // службы и гости не едут
  const ids = travellers.map(s => s.id);
  for (const s of travellers) abortAll(state, bus, s);
  const r = world.loadLot(state, bus, lotId, { bring: ids }) ?? {};
  const at = r.spawn ?? { x: Math.floor(state.lot.w / 2), y: state.lot.h - 2 };
  ids.forEach((id, i) => {
    let s = state.sims.find(x => x.id === id);
    if (!s) { s = travellers[i]; state.sims.push(s); s.x = at.x + 0.5 + (i % 3); s.y = at.y + 0.5; bus.emit('sim:added', { id }); }
    abortAll(state, bus, s);
    Object.assign(s, { level: 0, z: 0, reaction: null, path: null, walkSeg: null, stairs: null, anim: 'idle' });
    s.brain.nextThink = state.time.minutes + i;
  });
  return r;
}

export function travel(state, bus, world, lotId) {
  if (!canTravel(world)) return false;
  const lot = communityLots(state).find(l => String(l.id) === String(lotId));
  if (!lot) return false;
  const travellers = household(state).filter(s => isPresent(s));
  if (!travellers.length) return false;
  for (const s of travellers) wantHit(state, bus, s, { kind: 'event', what: 'travel', type: lot.type });
  const home = state.hood.activeLotId;
  const r = moveHousehold(state, bus, world, lot.id, travellers);
  state.brain.trip = { home, lot: lot.id, type: lot.type ?? 'park', since: state.time.minutes };
  const [lo, hi] = HOOD_T.communityTownies, n = lo + Math.floor(rand(state) * (hi - lo + 1));
  const T = ensureBrain(state).townies.slice().sort(() => rand(state) - 0.5).slice(0, n);
  const spawns = r.spawns?.length ? r.spawns : [r.spawn ?? { x: 0, y: state.lot.h - 1 }];
  T.forEach((t, i) => spawnNpc(state, bus, 'visitor', { townieId: t.id, name: t.name, at: spawns[i % spawns.length], task: { until: state.time.minutes + HOOD_T.communityStay } }));
  notify(bus, `Семья приехала: ${lot.name}`, '🚕');
  return true;
}

export function goHome(state, bus, world) {
  const trip = state.brain?.trip;
  if (!trip || !canTravel(world)) return false;
  const travellers = household(state).filter(s => !s.dead);
  moveHousehold(state, bus, world, trip.home, travellers);
  state.brain.trip = null;
  notify(bus, 'Семья вернулась домой', '🏠');
  return true;
}

