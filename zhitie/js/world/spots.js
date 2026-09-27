// Точки использования предметов: где житель стоит/сидит и куда смотрит.
// Локальные координаты (при rot=0): lx ∈ [0,w) вдоль ширины, ly ∈ [0,d) вглубь; ly = d — ряд перед «лицом»,
// ly = −1 — за спиной, lx = −1 / w — бока. Поворот применяется toWorld().
// slot: front|side|back|sit|lie|in|watch|play|use|portal|on.  onObject:true — клетка занята предметом,
// но в неё можно войти последним прямым шагом (findPath это разрешает для целей).
import { byId } from '../../data/catalog.js';
import { levelGrid } from './cache.js';
import { toWorld, objRect, rectTiles, FACING, rotAngle, dirAngle, behindTile } from './footprint.js';
import { edgeBetween, getEdge } from './grid.js';
import { roomAt } from './rooms.js';
import { isSeat, isWindow, kindOf } from './config.js';
import { stairsInfo } from './stairs.js';

// Настенные без точек использования (работают сами)
const NO_SPOTS = new Set(['smoke_alarm', 'burglar_alarm', 'ceiling_lamp', 'streetlight', 'hedge', 'tree', 'fence', 'desk_lamp']);

// Лестница: bottom — перед нижней ступенью (этаж L), top — за верхней (этаж L+1); смотрят вдоль подъёма/спуска
function stairsSpots(state, o, add) {
  const { bottom: B, top: T, tiles } = stairsInfo(o), { w, h } = state.lot;
  const ok = p => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h && !levelGrid(state, p.level).solid[p.y * w + p.x];
  const [f0, fN] = [tiles[0], tiles.at(-1)];
  if (ok(B)) add(spot(B.x, B.y, dirAngle(f0.x - B.x, f0.y - B.y), 'bottom', { level: B.level }));
  if (state.lot.levels[T.level] && ok(T)) add(spot(T.x, T.y, dirAngle(fN.x - T.x, fN.y - T.y), 'top', { level: T.level }));
}

const front = (w, d, slot = 'front') => Array.from({ length: w }, (_, lx) => ({ lx, ly: d, slot }));
const back = (w, slot = 'back') => Array.from({ length: w }, (_, lx) => ({ lx, ly: -1, slot }));
const sides = (w, d, slot = 'side') => Array.from({ length: d }, (_, ly) => [{ lx: -1, ly, slot }, { lx: w, ly, slot }]).flat();
const on = (cells, slot) => cells.map(([lx, ly]) => ({ lx, ly, slot, on: true }));
const cells = (w, d) => Array.from({ length: w * d }, (_, i) => [i % w, Math.floor(i / w)]);
const ring = (w, d, slot) => [...front(w, d, slot), ...back(w, slot), ...sides(w, d, slot)];

// Таблица правил по id каталога (w,d — fp при rot=0). Дублируется в docs/reports/world.md
export const SPOT_RULES = {
  fridge: (w, d) => front(w, d),
  stove: (w, d) => front(w, d),
  counter: (w, d) => front(w, d),
  kitchen_sink: (w, d) => front(w, d),
  bath_sink: (w, d) => front(w, d),
  trash_can: (w, d) => [...front(w, d), ...sides(w, d)],
  bookshelf: (w, d) => front(w, d),
  dresser: (w, d) => front(w, d),
  stereo: (w, d) => [...front(w, d), ...sides(w, d)],
  floor_lamp: (w, d) => [...front(w, d), ...sides(w, d)],
  plant: (w, d) => [...front(w, d), ...sides(w, d)],
  mailbox: (w, d) => ring(w, d, 'front'),
  toilet: (w, d) => [...front(w, d), ...on([[0, 0]], 'sit')],
  shower: (w, d) => [...front(w, d), ...on([[0, 0]], 'in')],
  bathtub: (w, d) => [...front(w, d, 'side'), ...on([[0, 0]], 'in')],
  bed_single: (w, d) => [...sides(w, d), ...on([[0, 0]], 'lie')],
  bed_double: (w, d) => [...sides(w, d), ...on([[0, 0], [1, 0]], 'lie')],
  sofa: (w, d) => [...on([[0, 0], [1, 0]], 'sit'), ...front(w, d)],
  armchair: (w, d) => [...on([[0, 0]], 'sit'), ...front(w, d)],
  dining_chair: (w, d) => [...on([[0, 0]], 'sit'), ...front(w, d), ...sides(w, d)],
  dining_table: (w, d) => [...ring(w, d, 'side'), { seats: true }],
  coffee_table: (w, d) => ring(w, d, 'side'),
  computer_desk: (w, d) => [...front(w, d, 'use'), { seats: true }],
  chess: (w, d) => [...front(w, d, 'play'), ...back(w, 'play')],
  tv: (w, d) => [...front(w, d), { zone: [2, 4] }],
  exercise_bench: (w, d) => [...on([[0, 0]], 'use'), ...sides(w, d)],
  easel: (w, d) => front(w, d, 'use'),
  crib: (w, d) => [...front(w, d), ...sides(w, d)],
  tombstone: (w, d) => ring(w, d, 'front'),
  stairs: () => [{ stairs: true }],
  // — волна 3: новые виды (CONTRACT §9) —
  fireplace: (w, d) => front(w, d),
  piano: (w, d) => front(w, d, 'use'),
  guitar: (w, d) => [...front(w, d, 'use'), ...sides(w, d, 'use')],
  telescope: (w, d) => [...front(w, d, 'use'), ...sides(w, d, 'use')],
  aquarium: (w, d) => front(w, d),
  pool_table: (w, d) => ring(w, d, 'play'),
  dartboard: (w, d) => [{ zone: [2, 3], slot: 'play', seats: false }],
  video_game: (w, d) => [...front(w, d), { zone: [1, 3], slot: 'play' }],
  pinball: (w, d) => front(w, d, 'play'),
  treadmill: (w, d) => [...on([[0, 0]], 'use'), ...sides(w, d)],
  gym_machine: (w, d) => [...on([[0, 0]], 'use'), ...sides(w, d)],
  hot_tub: (w, d) => [...on(cells(w, d), 'sit'), ...ring(w, d, 'side')],
  grill: (w, d) => front(w, d, 'use'),
  coffee_maker: (w, d) => front(w, d, 'use'),
  microwave: (w, d) => front(w, d, 'use'),
  dishwasher: (w, d) => front(w, d, 'use'),
  washing_machine: (w, d) => front(w, d, 'use'),
  toy_box: (w, d) => [...front(w, d, 'play'), ...sides(w, d, 'play')],
  dollhouse: (w, d) => [...front(w, d, 'play'), ...sides(w, d, 'play')],
  kids_bed: (w, d) => [...sides(w, d), ...on([[0, 0]], 'lie')],
  bunk_bed: (w, d) => [...sides(w, d), ...front(w, d, 'side'), ...on([[0, 0]], 'lie'), ...on([[0, 0]], 'lieTop')],
  wardrobe: (w, d) => front(w, d),
  sculpture: (w, d) => ring(w, d, 'view'),
  clock: (w, d) => front(w, d, 'view'),
  flower_vase: (w, d) => front(w, d, 'view'),
  // бассейн: плавать — клетки чаши (вход только через лестницу-трап: сначала 'ladder', затем 'swim', via:'ladder')
  pool: (w, d) => [{ lx: Math.floor(w / 2), ly: d, slot: 'ladder' }, ...on(cells(w, d), 'swim').map(c => ({ ...c, via: 'ladder' }))],
  park_bench: (w, d) => [...on(cells(w, 1), 'sit'), ...front(w, d)],
  fountain: (w, d) => ring(w, d, 'view'),
  food_stall: (w, d) => [...front(w, d, 'buy'), ...back(w, 'work')],
  cash_register: (w, d) => [...front(w, d, 'buy'), ...back(w, 'work')],
  shelf_shop: (w, d) => front(w, d, 'browse'),
  cafe_table: (w, d) => [...ring(w, d, 'side'), { seats: true }],
  library_shelf: (w, d) => front(w, d, 'browse'),
  museum_exhibit: (w, d) => ring(w, d, 'view'),
  swing_set: (w, d) => [...on(cells(w, 1), 'sit'), ...front(w, d)],
  sandbox: (w, d) => [...on(cells(w, d), 'play'), ...ring(w, d, 'side')],
  trash_bin_street: (w, d) => [...front(w, d), ...sides(w, d)],
  flowerbed: (w, d) => ring(w, d, 'garden'),
  rug: (w, d) => Array.from({ length: w * d }, (_, i) => ({ lx: i % w, ly: Math.floor(i / w), slot: 'on', walkOn: true })),
};

// Стоящая точка годна: в участке, не занята, и между ней и соседней клеткой предмета нет стены
function standOk(G, lot, level, x, y, ox, oy) {
  if (x < 0 || y < 0 || x >= G.w || y >= G.h || G.solid[y * G.w + x]) return false;
  if (Math.abs(x - ox) + Math.abs(y - oy) === 1) {
    const e = edgeBetween(x, y, ox, oy);
    if (getEdge(lot, level, e.dir, e.x, e.y)) return false;
  } else if (x !== ox && y !== oy) {
    // по диагонали к предмету — считаем годной, если есть прямой проход без стен хотя бы через одну из боковых
    const a = edgeBetween(x, y, ox, y), b = edgeBetween(ox, y, ox, oy), c = edgeBetween(x, y, x, oy), dd = edgeBetween(x, oy, ox, oy);
    const clear = e => !getEdge(lot, level, e.dir, e.x, e.y);
    if (!((clear(a) && clear(b)) || (clear(c) && clear(dd)))) return false;
  }
  return true;
}

const clampI = (v, a, b) => Math.max(a, Math.min(b, v));

function spot(x, y, facing, slot, extra) {
  return { x, y, facing, slot, ...extra };
}

export function useSpots(state, objId) {
  const o = state.objects.find(p => p.id === objId);
  const def = o && byId[o.def];
  if (!def) return [];
  const { lot } = state, level = o.level, G = levelGrid(state, level);
  const out = [], seen = new Set();
  const add = s => { s.level ??= level; const k = `${s.x},${s.y},${s.level},${s.slot}`; if (!seen.has(k)) { seen.add(k); out.push(s); } };

  if (NO_SPOTS.has(kindOf(o.def))) return [];
  if (def.place === 'wall') {
    const [bx, by] = behindTile(o.x, o.y, o.rot), [fx, fy] = FACING[o.rot];
    const toWall = dirAngle(-fx, -fy);
    const free = (x, y) => x >= 0 && y >= 0 && x < G.w && y < G.h && !G.solid[y * G.w + x];
    if (def.portal) {
      if (free(o.x, o.y)) add(spot(o.x, o.y, toWall, 'portal'));
      if (free(bx, by)) add(spot(bx, by, dirAngle(fx, fy), 'portal'));
    } else if (kindOf(o.def) === 'dartboard') {
      // дартс на стене: бросать с 2–3 клеток перед ним, в той же комнате
      const room = roomAt(state, o.x, o.y, o.level);
      for (let k = 1; k <= 2; k++) {
        const x = o.x + fx * k, y = o.y + fy * k;
        if (free(x, y) && roomAt(state, x, y, o.level) === room) add(spot(x, y, toWall, 'play'));
      }
    } else {
      if (free(o.x, o.y)) add(spot(o.x, o.y, toWall, 'front'));
      if (isWindow(o.def) && free(bx, by)) add(spot(bx, by, dirAngle(fx, fy), 'front'));
    }
    return out;
  }

  if (def.place === 'surface') return surfaceSpots(state, o, G, add, out);

  const [w, d] = def.fp, r = objRect(o), cx = r.X + r.W / 2, cy = r.Y + r.D / 2;
  const rules = (SPOT_RULES[kindOf(o.def)] || ((w, d) => front(w, d)))(w, d);
  for (const rule of rules) {
    if (rule.seats) { seatsAround(state, o, r, add); continue; }
    if (rule.stairs) { stairsSpots(state, o, add); continue; }
    if (rule.zone) { tvZone(state, o, rule.zone, G, add, rule.slot || 'watch', rule.seats !== false); continue; }
    const [x, y] = toWorld(o, rule.lx, rule.ly);
    if (rule.on) { add(spot(x, y, rotAngle(o.rot), rule.slot, { onObject: true, ...(rule.via && { via: rule.via }) })); continue; }
    if (rule.walkOn) { if (!G.solid[y * G.w + x]) add(spot(x, y, rotAngle(o.rot), rule.slot)); continue; }
    const [ox, oy] = toWorld(o, clampI(rule.lx, 0, w - 1), clampI(rule.ly, 0, d - 1));
    if (standOk(G, lot, level, x, y, ox, oy)) add(spot(x, y, dirAngle(ox + 0.5 - (x + 0.5), oy + 0.5 - (y + 0.5)), rule.slot));
  }
  // запасной вариант — хоть какой-нибудь бок, если все «лицевые» точки закрыты
  if (!out.some(s => !s.onObject) && !def.walkable && !def.levels) {
    for (const [tx, ty] of rectTiles(r)) for (const [dx, dy] of FACING) {
      const x = tx + dx, y = ty + dy;
      if (x >= r.X && y >= r.Y && x < r.X + r.W && y < r.Y + r.D) continue;
      if (standOk(G, lot, level, x, y, tx, ty)) add(spot(x, y, dirAngle(cx - x - 0.5, cy - y - 0.5), 'side'));
    }
  }
  return out;
}

// Сиденья у стола: стул/кресло рядом, «лицом» к столу
function seatsAround(state, table, r, add) {
  for (const s of state.objects) {
    if (s.level !== table.level || !isSeat(s.def)) continue;
    const [fx, fy] = FACING[s.rot];
    for (const [x, y] of rectTiles(objRect(s))) {
      const tx = x + fx, ty = y + fy;
      if (tx >= r.X && ty >= r.Y && tx < r.X + r.W && ty < r.Y + r.D)
        add(spot(x, y, rotAngle(s.rot), 'sit', { onObject: true, seatId: s.id }));
    }
  }
}

// Телевизор: зона 2..4 клетки перед экраном, шириной экрана ±1, в той же комнате; плюс сиденья в зоне
function tvZone(state, tv, [near, far], G, add, slot = 'watch', withSeats = true) {
  const def = byId[tv.def], [w, d] = def.fp, level = tv.level;
  const room = roomAt(state, ...toWorld(tv, 0, d), level);
  const [tcx, tcy] = [objRect(tv).X + objRect(tv).W / 2, objRect(tv).Y + objRect(tv).D / 2];
  const seatAt = new Map();
  for (const s of state.objects) if (s.level === level && isSeat(s.def))
    for (const [x, y] of rectTiles(objRect(s))) seatAt.set(y * G.w + x, s);
  for (let ly = d - 1 + near; ly <= d - 1 + far; ly++) for (let lx = -1; lx <= w; lx++) {
    const [x, y] = toWorld(tv, lx, ly);
    if (x < 0 || y < 0 || x >= G.w || y >= G.h || roomAt(state, x, y, level) !== room) continue;
    const t = y * G.w + x, seat = seatAt.get(t);
    if (seat && withSeats) add(spot(x, y, rotAngle(seat.rot), 'sit', { onObject: true, seatId: seat.id }));
    else if (!G.solid[t]) add(spot(x, y, dirAngle(tcx - x - 0.5, tcy - y - 0.5), slot));
  }
}

// Телефон на поверхности: встать перед ним (по его rot), иначе у любой свободной стороны опоры
function surfaceSpots(state, o, G, add, out) {
  const { lot } = state, [fx, fy] = FACING[o.rot];
  const tryAt = (x, y) => { if (standOk(G, lot, o.level, x, y, o.x, o.y)) add(spot(x, y, dirAngle(o.x - x, o.y - y), 'front')); };
  tryAt(o.x + fx, o.y + fy);
  if (!out.length) for (const [dx, dy] of FACING) tryAt(o.x + dx, o.y + dy);
  return out;
}
