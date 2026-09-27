// Расстановка мебели генератором: выбор варианта по виду и ценовому ярусу, поиск места у стены / в центре /
// на поверхности / рядом с другим предметом. Каждая постановка проверяется: canPlace + участок не распался
// (все ранее достижимые свободные клетки достижимы) + у предмета и соседей остались подходы.
import { CATALOG, byId, kindOf } from '../../data/catalog.js';
import { canPlace, addObject } from './objects.js';
import { useSpots } from './spots.js';
import { reachMap } from './nav.js';
import { invalidate, levelGrid } from './cache.js';
import { rectOf, objRect, FACING, toWorld } from './footprint.js';
import { DX, DY } from './cache.js';

// Запасные виды, если в каталоге ещё нет предметов нужного вида (каталог растёт параллельно)
export const FALLBACK = {
  park_bench: ['sofa'], fountain: ['sculpture', 'plant'], food_stall: ['counter'], cash_register: ['counter'],
  shelf_shop: ['bookshelf'], cafe_table: ['dining_table'], gym_machine: ['exercise_bench'], treadmill: ['exercise_bench'],
  library_shelf: ['bookshelf'], museum_exhibit: ['sculpture', 'plant'], swing_set: ['armchair'], sandbox: ['rug'],
  trash_bin_street: ['trash_can'], streetlight: ['floor_lamp'], tree: ['plant'], flowerbed: ['plant'], hedge: ['plant'],
  kids_bed: ['bed_single'], bunk_bed: ['bed_single'], wardrobe: ['dresser'], sculpture: ['plant'], flower_vase: ['plant'],
  toy_box: ['dresser'], dollhouse: [], fireplace: [], piano: [], aquarium: [], telescope: [], pool_table: ['chess'],
  video_game: [], pinball: [], dartboard: [], hot_tub: [], pool: [], grill: [], coffee_maker: [], microwave: [],
  dishwasher: [], washing_machine: [], guitar: [], clock: ['painting'], desk_lamp: [], ceiling_lamp: [], fence: [],
};
// Виды без точек использования — им подход не нужен
const NO_ACCESS = new Set(['tree', 'hedge', 'fence', 'streetlight', 'smoke_alarm', 'burglar_alarm', 'ceiling_lamp', 'desk_lamp']);

const byKind = new Map();
function defsOf(kind) {
  if (!byKind.has(kind)) {
    // сначала покупаемые; если вид только «служебный» (касса, полка магазина) — любые
    const all = CATALOG.filter(d => kindOf(d.id) === kind && d.kind !== 'tombstone'), buy = all.filter(d => d.buyable !== false);
    byKind.set(kind, (buy.length ? buy : all).sort((a, b) => a.price - b.price));
  }
  return byKind.get(kind);
}

/** Вариант вида под ярус 0..1 (0 — дешёвый, 1 — роскошь), с лёгким разбросом; иначе запасной вид; иначе null */
export function pickDef(kind, tier, rng, seen = new Set()) {
  const list = defsOf(kind);
  if (list.length) {
    const i = Math.round(tier * (list.length - 1)) + (rng ? rng.int(-1, 1) : 0);
    return list[Math.max(0, Math.min(list.length - 1, i))].id;
  }
  seen.add(kind);
  for (const k of FALLBACK[kind] || []) if (!seen.has(k)) { const d = pickDef(k, tier, rng, seen); if (d) return d; }
  return null;
}

// Кандидаты позиций
function wallCands(def, room, rng) {
  const out = [], sides = rng ? rng.shuffle([0, 1, 2, 3]) : [0, 1, 2, 3];
  for (const side of sides) {
    const rot = [0, 3, 2, 1][side];                         // N-стена → лицом +y; E → −x; S → −y; W → +x
    const r = rectOf(def, 0, 0, rot);
    const xs = [], ys = [];
    if (side === 0 || side === 2) {
      for (let x = room.x0; x <= room.x1 - r.W; x++) xs.push(x);
      ys.push(side === 0 ? room.y0 : room.y1 - r.D);
    } else {
      for (let y = room.y0; y <= room.y1 - r.D; y++) ys.push(y);
      xs.push(side === 1 ? room.x1 - r.W : room.x0);
    }
    const pos = [];
    for (const y of ys) for (const x of xs) pos.push({ x, y, rot, level: room.level });
    out.push(...(rng ? rng.shuffle(pos) : pos));
  }
  return out;
}
function centerCands(def, room, rots = [0, 1, 2, 3]) {
  const cx = (room.x0 + room.x1) / 2, cy = (room.y0 + room.y1) / 2, out = [];
  for (const rot of rots) {
    const r = rectOf(def, 0, 0, rot);
    for (let y = room.y0; y <= room.y1 - r.D; y++) for (let x = room.x0; x <= room.x1 - r.W; x++)
      out.push({ x, y, rot, level: room.level, d: Math.hypot(x + r.W / 2 - cx, y + r.D / 2 - cy) });
  }
  return out.sort((a, b) => a.d - b.d);
}
function wallItemCands(room, rng) {
  const out = [];
  for (let x = room.x0; x < room.x1; x++) { out.push({ x, y: room.y0, rot: 0 }, { x, y: room.y1 - 1, rot: 2 }); }
  for (let y = room.y0; y < room.y1; y++) { out.push({ x: room.x0, y, rot: 1 }, { x: room.x1 - 1, y, rot: 3 }); }
  out.forEach(c => { c.level = room.level; });
  return rng ? rng.shuffle(out) : out;
}
// Прямоугольник предмета с поворотом rot накрывает клетку (tx,ty)
function coverCands(def, tx, ty, rot, level) {
  const r = rectOf(def, 0, 0, rot), out = [];
  for (let y = ty - r.D + 1; y <= ty; y++) for (let x = tx - r.W + 1; x <= tx; x++) out.push({ x, y, rot, level });
  return out;
}

export function createFurnisher(state, { entry, rng, tier = 0.5 }) {
  let reach = reachMap(state, entry);
  const { w } = state.lot;

  const remove = o => { state.objects.splice(state.objects.indexOf(o), 1); invalidate(); };

  // клетка-«на предмете» доступна: прямой сосед достижим и между ними нет стены
  const onAccessible = (sp, R) => {
    const G = levelGrid(state, sp.level), n = R.n;
    for (let d = 0; d < 4; d++) {
      const nx = sp.x - DX[d], ny = sp.y - DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= state.lot.h) continue;
      const nt = ny * w + nx;
      if (R.mark[sp.level * n + nt] && !G.solid[nt] && (G.open[nt] & (1 << d))) return true;
    }
    return false;
  };
  const healthy = (o, R) => {
    if (NO_ACCESS.has(kindOf(o.def))) return true;
    const sp = useSpots(state, o.id);
    if (!sp.some(s => !s.onObject)) return false;
    for (const s of sp) {
      if (s.onObject) { if (!s.via && !onAccessible(s, R)) return false; }
      else if (!R.mark[s.level * R.n + s.y * w + s.x]) return false;
    }
    return true;
  };

  function accept(o) {
    const def = byId[o.def];
    if (def.place !== 'floor' || def.walkable) return true;
    const r = objRect(o), n = reach.n;
    let lost = 0;
    for (let y = r.Y; y < r.Y + r.D; y++) for (let x = r.X; x < r.X + r.W; x++) if (reach.mark[o.level * n + y * w + x]) lost++;
    const R = reachMap(state, entry);
    if (R.count !== reach.count - lost) return false;
    if (!healthy(o, R)) return false;
    for (const p of state.objects) {
      if (p === o || p.level !== o.level || byId[p.def]?.place !== 'floor') continue;
      const q = objRect(p);
      if (q.X > r.X + r.W + 2 || q.X + q.W < r.X - 2 || q.Y > r.Y + r.D + 2 || q.Y + q.D < r.Y - 2) continue;
      if (!healthy(p, R)) return false;
    }
    reach = R;
    return true;
  }

  function tryAt(defId, cands, limit = 400) {
    let n = 0;
    for (const c of cands) {
      if (++n > limit) break;
      if (!canPlace(state, defId, c.x, c.y, c.rot, c.level, { free: true }).ok) continue;
      const o = addObject(state, defId, c.x, c.y, c.rot, c.level, { boughtDay: -1 });
      if (accept(o)) return o;
      remove(o);
    }
    return null;
  }

  const api = {
    /** mode: 'wall' | 'center' | 'wallItem' | 'surface' */
    place(kind, room, mode = 'wall', opts = {}) {
      const defId = opts.defId ?? pickDef(kind, opts.tier ?? tier, rng);
      if (!defId) return null;
      const def = byId[defId];
      if (def.place === 'wall') mode = 'wallItem';
      else if (def.place === 'surface') mode = 'surface';
      else if (mode === 'wallItem' || mode === 'surface') mode = 'wall';
      let cands;
      if (mode === 'wallItem') cands = wallItemCands(room, rng).filter(c => !opts.exterior || opts.exterior(c));
      else if (mode === 'surface') cands = api.hostTiles(room).map(o => ({ ...o }));
      else if (mode === 'center') cands = centerCands(def, room, opts.rots);
      else if (mode === 'scatter') cands = rng.shuffle(centerCands(def, room, opts.rots));
      else cands = wallCands(def, room, rng);
      if (opts.where) cands = cands.filter(opts.where);
      return tryAt(defId, cands);
    },
    // рядом: предмет накрывает одну из клеток targets, поворот rot
    near(kind, targets, rot, level, opts = {}) {
      const defId = opts.defId ?? pickDef(kind, opts.tier ?? tier, rng);
      if (!defId) return null;
      const def = byId[defId];
      return tryAt(defId, targets.flatMap(t => coverCands(def, t.x, t.y, rot, level)));
    },
    // диван/кресло перед телевизором
    facing(obj, kind, dists = [3, 2, 4]) {
      const [w0, d0] = byId[obj.def].fp, [fx, fy] = FACING[obj.rot];
      const [x, y] = toWorld(obj, Math.floor(w0 / 2), d0);            // клетка прямо перед серединой «лица»
      const targets = dists.map(k => ({ x: x + fx * (k - 1), y: y + fy * (k - 1) }));
      return api.near(kind, targets, (obj.rot + 2) % 4, obj.level);
    },
    // стулья вокруг стола лицом к нему
    chairsAround(table, kind, count) {
      const r = objRect(table), placed = [];
      const around = [];
      for (let x = r.X; x < r.X + r.W; x++) around.push({ x, y: r.Y - 1, rot: 0 }, { x, y: r.Y + r.D, rot: 2 });
      for (let y = r.Y; y < r.Y + r.D; y++) around.push({ x: r.X - 1, y, rot: 1 }, { x: r.X + r.W, y, rot: 3 });
      for (const c of around) {
        if (placed.length >= count) break;
        const o = api.near(kind, [c], c.rot, table.level);
        if (o) placed.push(o);
      }
      return placed;
    },
    hostTiles(room) {
      const out = [];
      for (const o of state.objects) {
        if (o.level !== room.level || !['counter', 'dining_table', 'coffee_table', 'dresser', 'computer_desk', 'cafe_table', 'food_stall', 'wardrobe', 'bookshelf'].includes(kindOf(o.def))) continue;
        const r = objRect(o);
        if (r.X < room.x0 || r.Y < room.y0 || r.X >= room.x1 || r.Y >= room.y1) continue;
        for (let y = r.Y; y < r.Y + r.D; y++) for (let x = r.X; x < r.X + r.W; x++) out.push({ x, y, rot: o.rot, level: o.level });
      }
      return out;
    },
    refresh() { reach = reachMap(state, entry); },
  };
  return api;
}
