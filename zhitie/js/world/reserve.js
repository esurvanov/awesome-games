// Бронь узких мест: одна дверь / одна лестница — один житель (по желанию Мозга).
// Хранится вне state (не сохраняется): после загрузки брони пусты, это безопасно.
import { byId } from '../../data/catalog.js';
import { levelGrid } from './cache.js';
import { edgeBetween, edgeKey } from './grid.js';
import { wallEdgeOf } from './footprint.js';

const books = new WeakMap();
const book = state => books.get(state) || books.set(state, new Map()).get(state);

/** Занять ключ. true — занято этим симом (или уже было его). Ключи: 'door:<id>', 'stairs:<id>', любые строки. */
export function reserve(state, key, simId) {
  const b = book(state), who = b.get(key);
  if (who != null && who !== simId) return false;
  b.set(key, simId);
  return true;
}
export function release(state, key, simId) {
  const b = book(state);
  if (simId == null || b.get(key) === simId) b.delete(key);
}
export const reservedBy = (state, key) => book(state).get(key) ?? null;
/** Снять все брони сима (умер/ушёл) */
export function releaseAll(state, simId) {
  for (const [k, v] of book(state)) if (v === simId) book(state).delete(k);
}

/** Ключ узкого места на шаге a→b пути (точки {x,y,level,stairs?}) или null */
export function portalKey(state, a, b) {
  if (b.stairs != null) return `stairs:${b.stairs}`;
  const level = b.level ?? a.level ?? 0;
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return null;
  const k = edgeKey(edgeBetween(a.x, a.y, b.x, b.y));
  const objs = levelGrid(state, level).wallObj.get(k);
  const door = objs?.find(o => byId[o.def]?.portal && edgeKey(wallEdgeOf(o.x, o.y, o.rot)) === k);
  return door ? `door:${door.id}` : null;
}
