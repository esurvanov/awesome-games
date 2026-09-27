// Полы: заливка прямоугольника клеток (x0..x1, y0..y1 включительно). floorId 0 — снять пол (бесплатно, без возврата).
// Этаж L>0: клетка держится (правило TS1 §2.7), если под ней (этаж L−1)
//   • клетка закрытой комнаты, или
//   • в досягаемости стены этажа L−1: горизонтальное ребро wallH(ex,ey) держит x∈[ex−1, ex+1], y∈[ey−2, ey+1]
//     (2 клетки поперёк с каждой стороны, 1 клетка за концы вдоль); вертикальное — симметрично.
// Над пролётом лестницы пол не кладётся (дыра).
import { FLOORS } from '../../data/catalog.js';
import { cacheFor, invalidate, watchBus } from './cache.js';
import { roomAt, recomputeRooms } from './rooms.js';
import { holeSet } from './stairs.js';
import { SUPPORT_PERP, SUPPORT_PAR } from './config.js';

function supportMask(state, level) {
  const c = cacheFor(state);
  if (c.support[level]) return c.support[level];
  const { lot } = state, { w, h } = lot, below = lot.levels[level - 1], m = new Uint8Array(w * h);
  const mark = (x0, x1, y0, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) m[y * w + x] = 1;
  };
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++)
    if (below.wallH[y * w + x]) mark(x - SUPPORT_PAR, x + SUPPORT_PAR, y - SUPPORT_PERP, y + SUPPORT_PERP - 1);
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++)
    if (below.wallV[y * (w + 1) + x]) mark(x - SUPPORT_PERP, x + SUPPORT_PERP - 1, y - SUPPORT_PAR, y + SUPPORT_PAR);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (roomAt(state, x, y, level - 1)) m[y * w + x] = 1;
  return (c.support[level] = m);
}

/** Держится ли пол этажа level на клетке (этаж 0 — всегда) */
export function isSupported(state, x, y, level) {
  if (level <= 0) return true;
  const { w, h } = state.lot;
  if (!state.lot.levels[level] || x < 0 || y < 0 || x >= w || y >= h) return false;
  return !!supportMask(state, level)[y * w + x];
}

export function paintFloor(state, bus, x0, y0, x1, y1, floorId, level = 0, { free = false } = {}) {
  watchBus(bus);
  const { lot } = state, L = lot.levels[level];
  if (!L || (floorId && !FLOORS.some(f => f.id === floorId))) return 0;
  const price = FLOORS.find(f => f.id === floorId)?.price ?? 0;
  const [ax, bx] = [Math.max(0, Math.min(x0, x1)), Math.min(lot.w - 1, Math.max(x0, x1))];
  const [ay, by] = [Math.max(0, Math.min(y0, y1)), Math.min(lot.h - 1, Math.max(y0, y1))];
  const holes = level > 0 && floorId ? holeSet(state) : null;
  let cost = 0, changed = false;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const t = y * lot.w + x;
    if (L.floor[t] === floorId) continue;
    if (holes && (holes.has(`${x},${y},${level}`) || !isSupported(state, x, y, level))) continue;
    if (!free && floorId && state.household.money - cost < price) continue;
    L.floor[t] = floorId;
    changed = true;
    if (floorId) cost += price;
  }
  if (!changed) return 0;
  invalidate();
  if (level > 0) recomputeRooms(state);
  if (cost && !free) {
    state.household.money -= cost;
    bus?.emit('money:changed', { money: state.household.money, delta: -cost, reason: 'floor' });
  }
  bus?.emit('lot:changed', { level, kind: 'floor' });
  return free ? 0 : cost;
}
