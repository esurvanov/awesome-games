// Стены на рёбрах: протяжка линии (порт идеи line_tiles/place_wall_line, defense.py:39-87 — платим посегментно,
// пока хватает денег), комната-прямоугольник, снос с возвратом. Диагональных стен нет (см. отчёт).
import { WALLS, byId } from '../../data/catalog.js';
import { invalidate, watchBus } from './cache.js';
import { lineEdges, getEdge, setEdge, edgeKey, edgeBetween } from './grid.js';
import { objRect, wallEdgeOf } from './footprint.js';
import { removeObject } from './objects.js';
import { isStairs, stairsInfo } from './stairs.js';
import { recomputeRooms } from './rooms.js';

const wallPrice = id => WALLS.find(w => w.id === id)?.price ?? 0;

// Ребро проходит внутри многоклеточного предмета?
function cutsObject(state, level, e) {
  for (const o of state.objects) {
    if (isStairs(o) && stairsBlocks(o, level, e)) return true;
    if (o.level !== level || byId[o.def]?.place !== 'floor') continue;
    const r = objRect(o);
    if (e.dir === 'h' && e.x >= r.X && e.x < r.X + r.W && e.y > r.Y && e.y < r.Y + r.D) return true;
    if (e.dir === 'v' && e.y >= r.Y && e.y < r.Y + r.D && e.x > r.X && e.x < r.X + r.W) return true;
  }
  return false;
}

// Лестница не даёт замуровать вход снизу и выход сверху
function stairsBlocks(o, level, e) {
  const { bottom: B, top: T, tiles } = stairsInfo(o);
  const k = `${e.dir}${e.x},${e.y}`;
  const between = (a, b) => edgeKey(edgeBetween(a.x, a.y, b.x, b.y)) === k;
  return (level === B.level && between(B, tiles[0])) || (level === T.level && between(T, tiles.at(-1)));
}

// Этаж >0: стена только там, где хотя бы с одной стороны есть пол
function floorNear(lot, level, e) {
  if (level === 0) return true;
  const F = lot.levels[level].floor, { w, h } = lot;
  const has = (x, y) => x >= 0 && y >= 0 && x < w && y < h && F[y * w + x];
  return e.dir === 'h' ? has(e.x, e.y - 1) || has(e.x, e.y) : has(e.x - 1, e.y) || has(e.x, e.y);
}

function applyEdges(state, bus, edges, level, type, free) {
  let cost = 0;
  const hh = state.household;
  for (const e of edges) {
    if (getEdge(state.lot, level, e.dir, e.x, e.y) === type || cutsObject(state, level, e) || !floorNear(state.lot, level, e)) continue;
    const p = wallPrice(type);
    if (!free && hh.money - cost < p) break;
    setEdge(state.lot, level, e.dir, e.x, e.y, type);
    cost += p;
  }
  return cost;
}

function commit(state, bus, level, cost, free, reason) {
  invalidate();
  recomputeRooms(state);
  if (cost && !free) {
    state.household.money -= cost;
    bus?.emit('money:changed', { money: state.household.money, delta: -cost, reason });
  }
  bus?.emit('lot:changed', { level, kind: 'wall' });
}

/** Линия стен между вершинами. typeId — id из WALLS (необязательный 8-й аргумент, по умолчанию 1). */
export function buildWall(state, bus, x0, y0, x1, y1, level = 0, typeId = 1, { free = false } = {}) {
  watchBus(bus);
  if (!state.lot.levels[level] || !WALLS.some(w => w.id === typeId)) return 0;
  const cost = applyEdges(state, bus, lineEdges(state.lot, x0, y0, x1, y1), level, typeId, free);
  commit(state, bus, level, cost, free, 'wall');
  return free ? 0 : cost;
}

// Периметр прямоугольника с вершинами (x0,y0)-(x1,y1)
export function roomEdges(lot, x0, y0, x1, y1) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  return [...lineEdges(lot, ax, ay, bx, ay), ...lineEdges(lot, ax, by, bx, by),
    ...lineEdges(lot, ax, ay, ax, by), ...lineEdges(lot, bx, ay, bx, by)];
}

export function buildRoom(state, bus, x0, y0, x1, y1, level = 0, typeId = 1, { free = false } = {}) {
  watchBus(bus);
  if (!state.lot.levels[level] || x0 === x1 || y0 === y1) return 0;
  const cost = applyEdges(state, bus, roomEdges(state.lot, x0, y0, x1, y1), level, typeId, free);
  commit(state, bus, level, cost, free, 'wall');
  return free ? 0 : cost;
}

/** Снос линии стен. Висящие на них двери/окна/картины продаются. Возврат: полная цена стены + продажа предметов. */
export function removeWall(state, bus, x0, y0, x1, y1, level = 0) {
  watchBus(bus);
  if (!state.lot.levels[level]) return 0;
  let refund = 0, objRefund = 0;
  for (const e of lineEdges(state.lot, x0, y0, x1, y1)) {
    const type = getEdge(state.lot, level, e.dir, e.x, e.y);
    if (!type) continue;
    const k = edgeKey(e);
    for (const o of state.objects.filter(o => o.level === level && byId[o.def]?.place === 'wall' && edgeKey(wallEdgeOf(o.x, o.y, o.rot)) === k))
      objRefund += removeObject(state, bus, o.id, { silentLot: true });
    setEdge(state.lot, level, e.dir, e.x, e.y, 0);
    refund += wallPrice(type);
  }
  if (refund) state.household.money += refund;
  invalidate();
  recomputeRooms(state);
  if (refund) bus?.emit('money:changed', { money: state.household.money, delta: refund, reason: 'wall' });
  bus?.emit('lot:changed', { level, kind: 'wall' });
  return refund + objRefund;
}

export function isEdgeWall(state, level, dir, x, y) {
  return getEdge(state.lot, level, dir, x, y);
}
