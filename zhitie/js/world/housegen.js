// Генератор домов района: план (комнаты-прямоугольники по вершинам, двери, лестница, крыльцо) → постройка → мебель.
// План — тот же формат, что у ручных шаблонов в data/lots/templates.js.
//   plan = { w, h, ext, int, rooms:[{type, level, x0,y0,x1,y1, beds?}], doors:[{x,y,rot,level}],
//            stairs:[{x,y,rot}], floors:[{level, x0,y0,x1,y1 (клетки включительно), id?}], front:{x,y}, yards:[rect] }
// Улица — сторона y = h−1. Фасад дома смотрит на улицу.
import { WALLS, FLOORS, byId, kindOf } from '../../data/catalog.js';
import { createLot } from './lot.js';
import { buildRoom } from './walls.js';
import { paintFloor } from './floors.js';
import { canPlace, addObject } from './objects.js';
import { recomputeRooms, roomAt } from './rooms.js';
import { invalidate } from './cache.js';
import { getEdge, setEdge } from './grid.js';
import { createFurnisher } from './furnish.js';
import { makeRng } from './rng.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ADULT = a => !a || a === 'adult' || a === 'elder' || a === 'young';

/** Спальни под состав семьи: [{beds:[kind…], kid}] */
export function bedroomsFor(members = []) {
  const ages = members.map(m => m.age || 'adult');
  let adults = ages.filter(ADULT).length;
  const kids = ages.filter(a => a === 'child' || a === 'teen').length, babies = ages.filter(a => a === 'baby').length;
  const rooms = [];
  if (adults >= 2) { rooms.push({ beds: ['bed_double'] }); adults -= 2; }
  else { rooms.push({ beds: [adults ? 'bed_single' : 'bed_double'] }); adults = 0; }
  for (let i = 0; i < adults; i++) rooms.push({ beds: ['bed_single'] });
  for (let i = 0; i < kids; i += 2) rooms.push({ beds: Array(Math.min(2, kids - i)).fill('kids_bed'), kid: true });
  for (let i = 0; i < babies; i++) rooms[0].beds.push('crib');
  while (rooms.length > 4) { const r = rooms.pop(); rooms[rooms.length - 1].beds.push(...r.beds); }
  return rooms;
}
export const bedCapacity = kind => (kind === 'bed_double' ? 2 : 1);

/** Процедурный план дома. opts: {w, h, members, tier} */
export function planHouse(rng, { w = 30, h = 30, members = [], tier = 0.5 } = {}) {
  const bedrooms = bedroomsFor(members);
  const bw = b => clamp(2 + b.beds.length * 2 + (b.beds.includes('bed_double') ? 0 : -1), 4, 6);
  const maxW = w - 9;
  let two = bedrooms.length >= 3 || (w >= 26 && rng.chance(0.35));
  let back = [], up = [];
  const study = rng.chance(0.45 + tier * 0.3);
  if (!two) {
    back = [{ type: 'bath', wd: 3 }, ...bedrooms.map(b => ({ type: 'bedroom', wd: bw(b), ...b }))];
    if (study) back.push({ type: 'study', wd: 3 });
    if (back.reduce((a, r) => a + r.wd, 0) > maxW && study) back.pop();
    if (back.reduce((a, r) => a + r.wd, 0) > maxW) two = true;
  }
  if (two) {
    back = [{ type: 'bath', wd: 3 }, { type: rng.chance(0.5) ? 'study' : 'hobby', wd: 4 }];
    up = [...bedrooms.map(b => ({ type: 'bedroom', wd: bw(b), ...b })), { type: 'bath', wd: 3 }];
    while (up.reduce((a, r) => a + r.wd, 0) > maxW - 1 && up.some(r => r.wd > 4)) up.find(r => r.wd > 4).wd--;
  }
  const sum = a => a.reduce((s, r) => s + r.wd, 0);
  const W = Math.max(9, sum(back), sum(up));
  back.at(-1).wd += W - sum(back);
  if (up.length) up.at(-1).wd += W - sum(up);
  const Db = two ? 4 : (rng.chance(0.5) ? 5 : 4), Df = rng.chance(0.4) ? 6 : 5, D = Db + Df;
  const garage = rng.chance(0.35);
  let X0 = Math.floor((w - W) / 2) - (two ? 2 : 0) + (garage ? 2 : 0);
  X0 = clamp(X0, garage ? 6 : 2, w - W - (two ? 4 : 2));
  const X1 = X0 + W, Y1 = h - 7, Y0 = Y1 - D, Yd = Y0 + Db;
  const mirror = rng.chance(0.5);
  const plan = { w, h, rooms: [], doors: [], stairs: [], floors: [], yards: [], two,
    ext: rng.pick(WALLS).id, int: rng.pick(WALLS).id };
  // задняя полоса (этаж 0)
  const strip = (list, y0, y1, level, doorY) => {
    let x = X0;
    for (const r of (mirror ? [...list].reverse() : list)) {
      plan.rooms.push({ ...r, level, x0: x, y0, x1: x + r.wd, y1 });
      plan.doors.push({ x: x + 1 + (r.wd > 3 && rng.chance(0.5) ? 1 : 0), y: doorY, rot: 0, level });
      x += r.wd;
    }
  };
  strip(back, Y0, Yd, 0, Yd);
  // передняя полоса: гостиная | кухня
  const kw = clamp(Math.round(W * 0.42), 4, W - 5), lw = W - kw;
  const Xk = mirror ? X0 + kw : X0 + lw;
  const living = mirror ? { x0: Xk, x1: X1 } : { x0: X0, x1: Xk }, kitchen = mirror ? { x0: X0, x1: Xk } : { x0: Xk, x1: X1 };
  plan.rooms.push({ type: 'living', level: 0, ...living, y0: Yd, y1: Y1 }, { type: 'kitchen', level: 0, ...kitchen, y0: Yd, y1: Y1 });
  plan.doors.push({ x: Xk, y: Yd + 1 + rng.int(0, Df - 3), rot: 1, level: 0 });
  const xf = living.x0 + 1 + rng.int(0, Math.max(0, living.x1 - living.x0 - 3));
  plan.doors.push({ x: xf, y: Y1 - 1, rot: 2, level: 0 });
  plan.front = { x: xf, y: Y1 };
  // гараж-комната сбоку
  if (garage && X0 - 4 >= 1) {
    plan.rooms.push({ type: 'garage', level: 0, x0: X0 - 4, y0: Yd, x1: X0, y1: Y1 });
    plan.doors.push({ x: X0, y: Yd + 2, rot: 1, level: 0 }, { x: X0 - 3, y: Y1 - 1, rot: 2, level: 0 });
  }
  // второй этаж: коридор вдоль фасада + комнаты сзади; наружная лестница у восточной стены
  if (two) {
    plan.rooms.push({ type: 'hall', level: 1, x0: X0, y0: Y1 - 2, x1: X1, y1: Y1 });
    strip(up, Y0, Y1 - 2, 1, Y1 - 2);
    plan.floors.push({ level: 1, x0: X1, y0: Y1 - 2, x1: X1, y1: Y1 - 1 }, { level: 1, x0: X1 + 1, y0: Y1 - 1, x1: X1 + 1, y1: Y1 - 1 });
    plan.stairs.push({ x: X1 + 1, y: Y1 - 5, rot: 2 });
    plan.doors.push({ x: X1 - 1, y: Y1 - 1, rot: 3, level: 1 });
  }
  // крыльцо и дорожка к улице
  plan.floors.push({ level: 0, x0: xf - 1, y0: Y1, x1: xf + 1, y1: Y1 + 1, id: 'porch' }, { level: 0, x0: xf, y0: Y1 + 2, x1: xf, y1: h - 1, id: 'porch' });
  plan.yards.push({ x0: 1, y0: Y1 + 2, x1: w - 1, y1: h - 2, level: 0, type: 'front' }, { x0: 1, y0: 1, x1: w - 1, y1: Math.max(2, Y0 - 1), level: 0, type: 'back' });
  plan.mailbox = { x: Math.min(w - 2, xf + 2), y: h - 2 };
  return plan;
}

/** Построить план на state (участок стирается). Бросает Error, если дверь/лестница не встала. */
export function buildPlan(state, plan, rng = makeRng(1)) {
  state.lot = { ...createLot(plan.w, plan.h), roof: state.lot?.roof ?? createLot(1, 1).roof };
  state.objects = [];
  invalidate();
  const free = { free: true }, floorFor = {};
  const fl = type => (floorFor[type] ??= rng.pick(FLOORS).id);
  for (let level = 0; level < 2; level++) {
    for (const r of plan.rooms) if (r.level === level) paintFloor(state, null, r.x0, r.y0, r.x1 - 1, r.y1 - 1, r.floor ?? fl(r.type), level, free);
    for (const f of plan.floors) if (f.level === level) paintFloor(state, null, f.x0, f.y0, f.x1, f.y1, typeof f.id === 'number' ? f.id : fl(f.id ?? 'porch'), level, free);
    for (const r of plan.rooms) if (r.level === level) buildRoom(state, null, r.x0, r.y0, r.x1, r.y1, level, plan.int ?? 1, free);
  }
  recomputeRooms(state);
  // наружные стены — другим материалом
  const { lot } = state, { w, h } = lot;
  for (let level = 0; level < 2; level++) {
    const out = (x, y) => x < 0 || y < 0 || x >= w || y >= h || roomAt(state, x, y, level) === 0;
    for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++)
      if (getEdge(lot, level, 'h', x, y) && (out(x, y - 1) || out(x, y))) setEdge(lot, level, 'h', x, y, plan.ext ?? 3);
    for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++)
      if (getEdge(lot, level, 'v', x, y) && (out(x - 1, y) || out(x, y))) setEdge(lot, level, 'v', x, y, plan.ext ?? 3);
  }
  invalidate();
  const put = (def, o) => {
    const ok = canPlace(state, def, o.x, o.y, o.rot, o.level ?? 0, free);
    if (!ok.ok) throw new Error(`plan: ${def} (${o.x},${o.y},L${o.level ?? 0}) r${o.rot}: ${ok.reason}`);
    return addObject(state, def, o.x, o.y, o.rot, o.level ?? 0, { boughtDay: -1 });
  };
  for (const d of plan.doors) put(d.def ?? 'door', d);
  for (const s of plan.stairs) put('stairs', { ...s, level: 0 });
  recomputeRooms(state);
}

// Что ставить по типу комнаты: [вид, режим, условие по ярусу?]
const ROOM_KIT = {
  kitchen: [['fridge'], ['stove'], ['kitchen_sink'], ['counter'], ['counter'], ['dishwasher', 'wall', 0.5], ['trash_can'],
    ['@table'], ['phone', 'surface'], ['coffee_maker', 'surface', 0.3], ['microwave', 'surface', 0.5], ['smoke_alarm', 'wallItem'], ['clock', 'wallItem', 0.4]],
  bath: [['toilet'], ['@wash'], ['bath_sink'], ['mirror', 'wallItem'], ['plant', 'wall', 0.6]],
  bedroom: [['@beds'], ['wardrobe', 'wall', 0.5], ['dresser'], ['floor_lamp'], ['@kid'], ['painting', 'wallItem'], ['mirror', 'wallItem', 0.5], ['rug', 'center', 0.4], ['ceiling_lamp', 'wallItem', 0.7]],
  living: [['@tv'], ['bookshelf'], ['stereo'], ['plant'], ['floor_lamp'], ['fireplace', 'wall', 0.5], ['aquarium', 'wall', 0.6], ['piano', 'wall', 0.8],
    ['painting', 'wallItem'], ['painting', 'wallItem', 0.5], ['sculpture', 'wall', 0.7], ['rug', 'center', 0.3], ['video_game', 'wall', 0.4]],
  study: [['@desk'], ['bookshelf'], ['chess', 'center'], ['easel'], ['telescope', 'wall', 0.6], ['guitar', 'wall', 0.5], ['desk_lamp', 'surface', 0.3]],
  hobby: [['exercise_bench', 'center'], ['treadmill', 'wall', 0.5], ['easel'], ['pool_table', 'center', 0.7], ['dartboard', 'wallItem', 0.3], ['pinball', 'wall', 0.6], ['guitar', 'wall', 0.4]],
  garage: [['exercise_bench', 'center'], ['washing_machine', 'wall', 0.3], ['trash_can'], ['dartboard', 'wallItem', 0.3], ['treadmill', 'wall', 0.7]],
  hall: [['plant'], ['painting', 'wallItem'], ['flower_vase', 'wall', 0.5]],
};

/** Обставить дом по плану. → {missing:[…]} — чего не удалось поставить из обязательного */
export function furnishPlan(state, plan, { rng = makeRng(1), tier = 0.5, members = [] } = {}) {
  const F = createFurnisher(state, { entry: { ...plan.front, level: 0 }, rng, tier });
  const missing = [];
  const need = (o, what) => { if (!o) missing.push(what); return o; };
  const rooms = [...plan.rooms].sort((a, b) => order(a.type) - order(b.type));
  // окна на наружных стенах
  for (const r of plan.rooms) {
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    const outside = c => { const [fx, fy] = [[0, 1], [1, 0], [0, -1], [-1, 0]][c.rot]; return roomAt(state, c.x - fx, c.y - fy, r.level) === 0; };
    for (let i = 0; i < Math.max(1, Math.round(area / 12)); i++) F.place('window', r, 'wallItem', { exterior: outside });
  }
  for (const r of rooms) {
    for (const [kind, mode = 'wall', minTier = 0] of ROOM_KIT[r.type] || []) {
      if (tier < minTier) continue;
      if (kind === '@table') {
        const t = need(F.place('dining_table', r, 'center'), 'dining_table');
        if (t) F.chairsAround(t, 'dining_chair', clamp(members.length, 2, 4));
      } else if (kind === '@wash') {
        const lux = tier > 0.7 && rng.chance(0.6);
        need(F.place(lux ? 'bathtub' : 'shower', r) || F.place(lux ? 'shower' : 'bathtub', r), 'shower');
      } else if (kind === '@beds') {
        for (const b of r.beds || ['bed_single']) need(F.place(b, r, 'wall') || F.place(b, r, 'center') || (b === 'kids_bed' ? F.place('bed_single', r) : null), b);
      } else if (kind === '@kid') {
        if (r.kid) { F.place('toy_box', r); F.place('dollhouse', r); }
      } else if (kind === '@tv') {
        const tv = F.place('tv', r);
        if (tv) { need(F.facing(tv, 'sofa') || F.place('sofa', r), 'sofa'); F.facing(tv, 'armchair', [2, 3, 4]); F.place('coffee_table', r, 'center'); }
        else { F.place('sofa', r); F.place('armchair', r); }
      } else if (kind === '@desk') {
        const d = F.place('computer_desk', r);
        if (d) F.facing(d, 'dining_chair', [1]);
      } else F.place(kind, r, mode);
    }
  }
  // двор: почтовый ящик у улицы, сад, гриль, джакузи/бассейн у богатых
  const mb = plan.mailbox;
  if (mb) need(F.near('mailbox', [mb, { x: mb.x + 1, y: mb.y }, { x: mb.x - 3, y: mb.y }], 0, 0), 'mailbox');
  // забор вдоль улицы с калиткой у дорожки
  if (mb && plan.front && rng.chance(0.6)) {
    const fy = plan.h - 2;
    for (let x = 1; x < plan.w - 1; x++) if (Math.abs(x - plan.front.x) > 1 && Math.abs(x - mb.x) > 1) F.near('fence', [{ x, y: fy }], 0, 0);
  }
  for (const y of plan.yards || []) {
    const n = Math.round(((y.x1 - y.x0) * (y.y1 - y.y0)) / 40);
    for (let i = 0; i < n; i++) F.place(rng.pick(['tree', 'flowerbed', 'plant', 'hedge']), y, 'scatter');
    if (y.type === 'back') {
      if (tier >= 0.4) F.place('grill', y, 'scatter');
      if (tier >= 0.8) F.place('hot_tub', y, 'scatter');
      if (tier >= 0.9) F.place('pool', y, 'center');
    }
  }
  return { missing };
}
const order = t => ['bath', 'kitchen', 'bedroom', 'living', 'study', 'hobby', 'garage', 'hall'].indexOf(t);

/** Полный цикл: план → постройка → мебель. opts: {seed, w, h, members, tier, plan?} → {plan, missing} */
export function generateHouse(state, opts = {}) {
  const rng = makeRng(opts.seed ?? 'house');
  const plan = opts.plan ?? planHouse(rng, opts);
  buildPlan(state, plan, rng);
  const { missing } = furnishPlan(state, plan, { rng, tier: opts.tier ?? 0.5, members: opts.members ?? [] });
  return { plan, missing, spawn: { x: plan.front.x, y: Math.min(plan.h - 1, plan.front.y + 2) }, frontDoor: { ...plan.front } };
}
void byId; void kindOf;
