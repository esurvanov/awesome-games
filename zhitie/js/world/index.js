// Мир «Житьё»: публичный API (docs/CONTRACT.md §5). Чистая логика, без DOM/three.js.
export { createLot, loadStartLot } from './lot.js';
export { canPlace, placeObject, removeObject, moveObject, sellValue } from './objects.js';
export { buildWall, buildRoom, removeWall, isEdgeWall } from './walls.js';
export { paintFloor } from './floors.js';
export { findPath, nearestFree, walkable } from './nav.js';
export { useSpots, SPOT_RULES } from './spots.js';
export { roomAt, roomScore, recomputeRooms } from './rooms.js';
export { wallJoint, lineEdges } from './grid.js';
export { FACING, rectOf, objRect, wallEdgeOf, rotAngle } from './footprint.js';
export { invalidate } from './cache.js';
export { stairsInfo } from './stairs.js';
export { isSupported } from './floors.js';
export { roofFootprints, setRoof } from './roof.js';
export { placeFree } from './placefree.js';
export { reserve, release, reservedBy, releaseAll, portalKey } from './reserve.js';
export { createHood, saveActiveLot, loadLot, moveIn, evict, buyLot, lotById, houseValue, landPrice, setSimFactory, addFamily, familyError } from './hood.js';
export { generateHouse, planHouse, buildPlan, furnishPlan, bedroomsFor } from './housegen.js';
export { buildCommunity, planCommunity } from './community.js';
export { pickDef } from './furnish.js';
export { reachMap } from './nav.js';

import { findPath } from './nav.js';
import { useSpots } from './spots.js';

/** Удобство для Мозга: путь от точки к лучшей точке использования предмета. slots — фильтр по slot. */
export function pathToObject(state, from, objId, slots = null) {
  const o = state.objects.find(p => p.id === objId);
  if (!o) return null;
  const spots = useSpots(state, objId).filter(s => !slots || slots.includes(s.slot));
  if (!spots.length) return null;
  const path = findPath(state, from.level ?? o.level, from, spots);
  if (!path) return null;
  const end = path.length ? path[path.length - 1] : { x: Math.floor(from.x), y: Math.floor(from.y), level: from.level ?? o.level };
  const spot = path.reached ? spots.find(s => s.x === end.x && s.y === end.y && s.level === (end.level ?? s.level)) : null;
  return { path, spot, reached: path.reached };
}
