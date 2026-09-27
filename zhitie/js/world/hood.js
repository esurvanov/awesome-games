// Район (CONTRACT §9, state.hood): участки, семьи, карта; переходы между участками со снимками.
// Активный участок живёт в state.lot/objects/sims/household; остальные — в lots[i].snapshot.
import { HOOD, LOTS_HINT, FAMILIES, TOWNIES, toSimSpec } from '../../data/hood.js';
import { TEMPLATES } from '../../data/lots/templates.js';
import { byId, WALLS, FLOORS } from '../../data/catalog.js';
import { generateHouse, buildPlan, furnishPlan, bedroomsFor } from './housegen.js';
import { buildCommunity } from './community.js';
import { loadStartLot } from './lot.js';
import { invalidate, watchBus } from './cache.js';
import { recomputeRooms } from './rooms.js';
import { makeRng } from './rng.js';
import { LAND_PER_TILE } from './config.js';

const SIZES = { s: [24, 24], m: [30, 30], l: [40, 30] };
const COMMUNITY_SIZE = { park: [40, 30], cafe: [30, 24], shop: [30, 24], gym: [30, 26], library: [34, 28] };
// Какой ручной шаблон у какого участка (остальные — процедурные)
const LOT_TEMPLATE = { res1: 'start', res3: 'cottage', res5: 'bungalow', res6: 'townhouse' };
const clone = v => (v == null ? v : structuredClone(v));
const tierOf = funds => Math.max(0, Math.min(1, ((funds ?? 15000) - 3000) / 50000));

// Кто создаёт жителей из simSpec (Мозг): setSimFactory((state, bus, spec) => id)
let simFactory = null;
export const setSimFactory = fn => { simFactory = fn; };

/** Стоимость дома: стены + пол + предметы (без надгробий/недоступных к покупке) */
export function houseValue(lot, objects) {
  const wp = id => WALLS.find(w => w.id === id)?.price ?? 0, fp = id => FLOORS.find(f => f.id === id)?.price ?? 0;
  let v = 0;
  for (const L of lot.levels) {
    for (const t of L.wallH) if (t) v += wp(t);
    for (const t of L.wallV) if (t) v += wp(t);
    for (const f of L.floor) if (f) v += fp(f);
  }
  for (const o of objects) if (byId[o.def]?.buyable !== false) v += byId[o.def]?.price ?? 0;
  return v;
}
export const landPrice = (w, h) => w * h * LAND_PER_TILE;

// Построить участок на временном state (id — общий счётчик state.nextId)
function generateLot(state, entry, family) {
  const tmp = { ...state, lot: null, objects: [], sims: [], nextId: state.nextId };
  let meta;
  if (entry.kind === 'community') meta = buildCommunity(tmp, entry.type, entry.id);
  else {
    const tpl = LOT_TEMPLATE[entry.id], members = (family?.members || []).map(toSimSpec);
    const tier = tierOf(family?.funds);
    if (tpl === 'start') {
      tmp.lot = { w: 30, h: 30, levels: [], roof: undefined };
      meta = loadStartLot(tmp, null);
    } else if (tpl && TEMPLATES[tpl]) {
      // ручной шаблон; кровати — под состав семьи (лишние — в последнюю спальню)
      const plan = clone(TEMPLATES[tpl]), beds = bedroomsFor(members), rooms = plan.rooms.filter(r => r.type === 'bedroom');
      if (members.length) rooms.forEach((r, i) => { r.beds = beds[i]?.beds ?? []; r.kid = beds[i]?.kid; });
      if (members.length) for (const b of beds.slice(rooms.length)) rooms.at(-1).beds.push(...b.beds);
      const rng = makeRng(entry.id);
      buildPlan(tmp, plan, rng);
      furnishPlan(tmp, plan, { rng, tier, members });
      meta = { spawn: { x: plan.front.x, y: Math.min(plan.h - 1, plan.front.y + 2) }, frontDoor: { ...plan.front } };
    } else meta = generateHouse(tmp, { seed: entry.id, w: entry.w, h: entry.h, members, tier });
  }
  state.nextId = tmp.nextId;
  entry.w = tmp.lot.w; entry.h = tmp.lot.h;
  entry.spawn = meta.spawn; entry.frontDoor = meta.frontDoor;
  entry.spawns = meta.spawns ?? [{ x: meta.frontDoor.x, y: tmp.lot.h - 1, level: 0 }];
  return { lot: tmp.lot, objects: tmp.objects, sims: [], household: null };
}

/**
 * Собрать район из data/hood.js. Если на state уже есть дом (стартовый), он становится участком семьи
 * с lotId 'res1' и активным (adopt). opts.adopt=false — не трогать активный участок.
 */
export function createHood(state, opts = {}) {
  const adopt = opts.adopt ?? state.objects.length > 0;
  const hood = state.hood = { name: HOOD.name, bio: HOOD.bio, lots: [], families: [], townies: TOWNIES.map(toSimSpec), activeLotId: null, day: 0, map: null };
  for (const f of FAMILIES) hood.families.push({ id: f.id, name: f.name, bio: f.bio, icon: f.icon, funds: f.funds, lotId: f.lotId ?? null,
    members: f.members.map(toSimSpec), simIds: [] });
  for (const L of LOTS_HINT) {
    const [w, h] = L.kind === 'community' ? COMMUNITY_SIZE[L.type] : SIZES[L.size] || SIZES.m;
    hood.lots.push({ id: L.id, name: L.name, bio: L.bio, kind: L.kind, ...(L.type && { type: L.type }), x: 0, y: 0, w, h,
      price: null, familyId: hood.families.find(f => f.lotId === L.id)?.id ?? null, snapshot: null });
  }
  for (const e of hood.lots) {
    if (adopt && e.id === 'res1') {
      e.w = state.lot.w; e.h = state.lot.h;
      e.spawn = { x: 12, y: 24 }; e.frontDoor = { x: 12, y: 22 }; e.spawns = [{ x: 12, y: e.h - 1, level: 0 }];
      continue;
    }
    const fam = hood.families.find(f => f.id === e.familyId);
    e.snapshot = generateLot(state, e, fam);
  }
  for (const e of hood.lots) {
    if (e.kind !== 'res') continue;
    const snap = e.snapshot ?? { lot: state.lot, objects: state.objects };
    e.price = landPrice(e.w, e.h) + houseValue(snap.lot, snap.objects);
  }
  if (adopt) {
    const e = lotById(state, 'res1'), fam = hood.families.find(f => f.id === e.familyId);
    hood.activeLotId = 'res1';
    if (fam) {
      fam.simIds = state.sims.filter(s => !s.npc && s.household !== false).map(s => s.id);
      state.household.familyId = fam.id;
      fam.funds = state.household.money;
    }
  }
  hood.map = layoutMap(hood.lots);
  return hood;
}

// Карта района: ряды участков фасадом к улице (+y), улицы между рядами, проспект слева
function layoutMap(lots) {
  const rows = [lots.filter(l => l.kind === 'res').slice(0, 5), lots.filter(l => l.kind === 'res').slice(5), lots.filter(l => l.kind === 'community')];
  const AVE = 6, GAP = 4, STREET = 6, streets = [];
  let y = 0, maxX = 0;
  for (const row of rows) {
    if (!row.length) continue;
    const rh = Math.max(...row.map(l => l.h));
    let x = AVE + GAP;
    for (const l of row) { l.x = x; l.y = y + rh - l.h; x += l.w + GAP; }
    maxX = Math.max(maxX, x);
    streets.push({ x: 0, y: y + rh, w: 0, h: STREET });
    y += rh + STREET + GAP;
  }
  for (const s of streets) s.w = maxX;
  streets.push({ x: 0, y: 0, w: AVE, h: y });
  return { w: maxX, h: y, streets };
}

export const lotById = (state, id) => state.hood?.lots.find(l => l.id === id) ?? null;
const familyById = (state, id) => state.hood?.families.find(f => f.id === id) ?? null;

/** Заморозить активный участок в снимок. opts.exclude — id жителей, которые уезжают вместе с игроком */
export function saveActiveLot(state, { exclude = [] } = {}) {
  const e = lotById(state, state.hood?.activeLotId);
  if (!e) return null;
  const hh = state.household;
  const fam = hh?.familyId ? familyById(state, hh.familyId) : null;
  if (fam) fam.funds = hh.money;
  const keep = state.sims.filter(s => !s.npc && s.household !== false && !exclude.includes(s.id));
  e.snapshot = {
    lot: clone(state.lot), objects: clone(state.objects),
    sims: e.kind === 'res' ? clone(keep) : [],
    household: e.kind === 'res' ? clone(hh) : null,
  };
  return e.snapshot;
}

function emitAll(state, bus, what) {
  for (const o of state.objects) bus?.emit(`object:${what}`, { id: o.id });
  for (const s of state.sims) bus?.emit(`sim:${what}`, { id: s.id });
}

/**
 * Сделать участок активным: снимок текущего → восстановить (или построить) новый.
 * opts.bring — id жителей, едущих с игроком (на общественный участок и обратно).
 * → {spawn, spawns, frontDoor, lotId} | null
 */
export function loadLot(state, bus, lotId, { bring = [] } = {}) {
  watchBus(bus);
  const e = lotById(state, lotId);
  if (!e) return null;
  const travellers = clone(state.sims.filter(s => bring.includes(s.id)));
  if (state.hood.activeLotId) saveActiveLot(state, { exclude: bring });
  emitAll(state, bus, 'removed');
  if (!e.snapshot) e.snapshot = generateLot(state, e, familyById(state, e.familyId));
  const snap = e.snapshot;
  state.lot = clone(snap.lot);
  state.objects = clone(snap.objects);
  state.sims = clone(snap.sims || []);
  e.snapshot = null;
  state.hood.activeLotId = lotId;
  const fam = familyById(state, e.familyId);
  const hh = state.household;
  if (e.kind === 'res' && !(hh?.familyId && hh.familyId === e.familyId && travellers.length)) {
    // возвращение семьи домой с поездки — кошелёк живой, остальное — из снимка/семьи
    state.household = snap.household ? clone(snap.household)
      : fam ? { name: fam.name, money: fam.funds, lastBillDay: state.household?.lastBillDay ?? 0, bills: [], familyId: fam.id }
      : { name: '', money: 0, lastBillDay: 0, bills: [], familyId: null };
  }
  // приехавшие — у точки появления
  travellers.forEach((s, i) => {
    if (state.sims.some(x => x.id === s.id)) return;
    Object.assign(s, { x: e.spawn.x + 0.5 + i * 0.7, y: e.spawn.y + 0.5, level: 0, path: null, act: null, queue: [] });
    state.sims.push(s);
  });
  invalidate();
  recomputeRooms(state);
  emitAll(state, bus, 'added');
  for (let level = 0; level < state.lot.levels.length; level++) for (const kind of ['wall', 'floor', 'object']) bus?.emit('lot:changed', { level, kind });
  bus?.emit('lot:changed', { level: 0, kind: 'roof' });
  bus?.emit('hood:lot', { lotId });
  // семья без жителей (первый визит) — создать из simSpec
  if (e.kind === 'res' && fam && !fam.simIds.length) materialize(state, bus, fam, e);
  return { lotId, spawn: { ...e.spawn }, spawns: clone(e.spawns), frontDoor: { ...e.frontDoor } };
}

function materialize(state, bus, fam, e) {
  const at = i => ({ x: e.spawn.x + 0.5 + (i % 3) * 0.8, y: e.spawn.y + 0.5 + Math.floor(i / 3) * 0.8, level: 0 });
  if (simFactory) fam.simIds = fam.members.map((m, i) => simFactory(state, bus, { ...m, ...at(i) }));
  else bus?.emit('hood:movein', { familyId: fam.id, lotId: e.id, members: clone(fam.members), spawn: { ...e.spawn } });
}

/** Купить участок семье (без переезда): цена = земля + дом. Прежний дом продаётся по его цене. */
export function buyLot(state, familyId, lotId) {
  const e = lotById(state, lotId), fam = familyById(state, familyId);
  if (!e || !fam) return { ok: false, reason: 'Нет такого участка или семьи' };
  if (e.kind !== 'res') return { ok: false, reason: 'Этот участок не продаётся' };
  if (e.familyId && e.familyId !== familyId) return { ok: false, reason: 'Участок занят' };
  if (e.familyId === familyId) return { ok: true, reason: '', price: 0 };
  const old = lotById(state, fam.lotId);
  const refund = old ? old.price : 0;
  if (fam.funds + refund < e.price) return { ok: false, reason: 'Не хватает денег', price: e.price };
  if (old) { old.familyId = null; fam.funds += refund; }
  fam.funds -= e.price;
  e.familyId = familyId; fam.lotId = lotId;
  return { ok: true, reason: '', price: e.price };
}

/** Въезд семьи: купить и сделать активным. Жители переезжают со старого участка (из снимка или активного). */
export function moveIn(state, bus, familyId, lotId) {
  const fam = familyById(state, familyId);
  if (!fam) return { ok: false, reason: 'Нет такой семьи' };
  const oldId = fam.lotId;
  // забрать жителей семьи
  let carried = [];
  if (oldId && state.hood.activeLotId === oldId) { saveActiveLot(state); }
  const old = lotById(state, oldId);
  if (old?.snapshot) { carried = old.snapshot.sims.filter(s => fam.simIds.includes(s.id)); old.snapshot.sims = old.snapshot.sims.filter(s => !fam.simIds.includes(s.id)); old.snapshot.household = null; }
  const r = buyLot(state, familyId, lotId);
  if (!r.ok) { if (old?.snapshot && carried.length) old.snapshot.sims.push(...carried); return r; }
  if (state.hood.activeLotId === oldId) state.hood.activeLotId = null;     // старый уже сохранён
  const target = lotById(state, lotId);
  if (target.snapshot) { target.snapshot.sims = []; target.snapshot.household = null; }
  const res = loadLot(state, bus, lotId);
  state.household = { name: fam.name, money: fam.funds, lastBillDay: state.household?.lastBillDay ?? 0, bills: [], familyId };
  carried.forEach((s, i) => { Object.assign(s, { x: res.spawn.x + 0.5 + i * 0.7, y: res.spawn.y + 0.5, level: 0, path: null, act: null, queue: [] }); state.sims.push(s); bus?.emit('sim:added', { id: s.id }); });
  bus?.emit('money:changed', { money: state.household.money, delta: -r.price, reason: 'lot' });
  return { ok: true, reason: '', price: r.price, ...res };
}

/** Выселить семью: дом продаётся (деньги семье), жители уходят «в книгу семей» (family.sims) */
export function evict(state, bus, familyId) {
  const fam = familyById(state, familyId), e = lotById(state, fam?.lotId);
  if (!fam || !e) return false;
  if (state.hood.activeLotId === e.id) {
    fam.funds = state.household.money;
    fam.sims = clone(state.sims.filter(s => fam.simIds.includes(s.id)));
    for (const s of fam.sims) bus?.emit('sim:removed', { id: s.id });
    state.sims = state.sims.filter(s => !fam.simIds.includes(s.id));
    state.household = { name: '', money: 0, lastBillDay: 0, bills: [], familyId: null };
  } else if (e.snapshot) {
    fam.sims = e.snapshot.sims.filter(s => fam.simIds.includes(s.id));
    e.snapshot.sims = e.snapshot.sims.filter(s => !fam.simIds.includes(s.id));
    e.snapshot.household = null;
  }
  fam.funds += e.price;
  e.familyId = null; fam.lotId = null;
  bus?.emit('hood:evict', { familyId, lotId: e.id });
  return true;
}

const AGES = new Set(['adult', 'child', 'baby', 'elder', 'teen']);
/** Проверка спецификации семьи → '' или причина */
export function familyError(spec) {
  if (!spec || typeof spec.name !== 'string' || !spec.name.trim()) return 'Нужна фамилия';
  const m = spec.members;
  if (!Array.isArray(m) || m.length < 1 || m.length > 8) return 'В семье 1–8 человек';
  if (m.some(x => !x || typeof x.name !== 'string' || !x.name.trim())) return 'У каждого нужно имя';
  if (m.some(x => x.age != null && !AGES.has(x.age))) return 'Неизвестный возраст';
  if (!m.some(x => !x.age || x.age === 'adult' || x.age === 'elder')) return 'Нужен хотя бы один взрослый';
  if (spec.funds != null && !(Number.isFinite(spec.funds) && spec.funds >= 0)) return 'Неверная сумма';
  return '';
}

/** Новая семья без дома (Создать семью). → familyId | null (причина — familyError(spec)) */
export function addFamily(state, bus, spec) {
  if (!state.hood || familyError(spec)) return null;
  const base = 'fam', ids = new Set(state.hood.families.map(f => f.id));
  let n = state.hood.families.length + 1;
  while (ids.has(`${base}${n}`)) n++;
  const fam = {
    id: `${base}${n}`, name: spec.name.trim(), bio: spec.bio ?? '', icon: spec.icon ?? '🏠',
    funds: spec.funds ?? 20000, lotId: null,
    members: spec.members.map(m => ({ ...clone(m), name: m.name.trim(), age: m.age === 'elder' ? 'adult' : (m.age ?? 'adult'), ...(m.age === 'elder' && { elder: true }) })),
    simIds: [],
  };
  state.hood.families.push(fam);
  bus?.emit('hood:changed', { familyId: fam.id });
  return fam.id;
}
