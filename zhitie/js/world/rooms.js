// Комнаты: заливка клеток, ограниченная стенами (двери тоже делят комнаты, как в TS1).
// Область, вытекающая за край участка через ребро без стены (или на этаже 1 — в «воздух» без пола), — улица, id 0.
// id закрытых комнат уникальны на весь участок (сквозная нумерация по этажам).
import { byId } from '../../data/catalog.js';
import { cacheFor } from './cache.js';
import { objRect, rectTiles, wallEdgeOf, behindTile } from './footprint.js';
import { ROOM, BARE_WALL_TYPE, isWindow } from './config.js';
import { edgeKey, sideEdge, getEdge } from './grid.js';
import { holeSet } from './stairs.js';

const SX = [1, 0, -1, 0], SY = [0, 1, 0, -1];

function compute(state) {
  const { lot } = state, { w, h } = lot, n = w * h;
  const maps = [], list = [{ id: 0, level: -1, area: 0, outside: true }];
  let next = 1;
  const queue = new Int32Array(n), holes = holeSet(state);
  lot.levels.forEach((L, level) => {
    const map = new Int32Array(n).fill(-1);
    // воздух: этаж выше 0 без пола; дыра над лестницей воздухом не считается (не «протекает» наружу)
    const air = t => level > 0 && !L.floor[t] && !holes.has(`${t % w},${(t / w) | 0},${level}`);
    for (let t0 = 0; t0 < n; t0++) {
      if (map[t0] !== -1) continue;
      if (air(t0)) { map[t0] = 0; continue; }
      // BFS
      let qh = 0, qt = 0, leak = false;
      queue[qt++] = t0; map[t0] = -2;
      while (qh < qt) {
        const t = queue[qh++], x = t % w, y = (t - x) / w;
        for (let s = 0; s < 4; s++) {
          const e = sideEdge(x, y, s);
          if (getEdge(lot, level, e.dir, e.x, e.y)) continue;
          const nx = x + SX[s], ny = y + SY[s];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { leak = true; continue; }
          const nt = ny * w + nx;
          if (air(nt)) { leak = true; continue; }
          if (map[nt] === -1) { map[nt] = -2; queue[qt++] = nt; }
        }
      }
      const id = leak ? 0 : next++;
      for (let i = 0; i < qt; i++) map[queue[i]] = id;
      if (id) list.push({ id, level, area: qt });
      else list[0].area += qt;
    }
    maps.push(map);
  });
  return { maps, list, holes };
}

export function roomsData(state) {
  const c = cacheFor(state);
  return c.rooms || (c.rooms = compute(state));
}

// Пересчитать и записать сводку в state.lot.rooms (JSON: [{id, level, area, outside?}])
export function recomputeRooms(state) {
  state.lot.rooms = roomsData(state).list.map(r => ({ ...r }));
  return state.lot.rooms;
}

export function roomAt(state, x, y, level = 0) {
  const { w, h } = state.lot;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const m = roomsData(state).maps[level];
  return m ? m[y * w + x] : 0;
}

// Вклад предмета в RoomImpact: декор/окна/свет + грязь/поломка/лужа
function impact(o) {
  const def = byId[o.def], st = o.st || {};
  let v = (def?.ratings?.room || 0) * ROOM.perRating;
  if (st.dirty) v += ROOM.dirtyMax * Math.min(1, st.dirty / 100);
  if (st.broken) v += ROOM.broken;
  if (st.puddle) v += ROOM.puddle;
  return v;
}

/** Оценка комнаты −100..100 (research-sims-mechanics §2.10), см. таблицу вкладов в docs/reports/world.md */
export function roomScore(state, roomId) {
  const { lot } = state, { w } = lot, { maps, list, holes } = roomsData(state);
  const info = list.find(r => r.id === roomId);
  if (!info) return 0;
  const outside = roomId === 0;
  const level = outside ? 0 : info.level;
  const map = maps[level], L = lot.levels[level];
  const inRoom = (x, y) => x >= 0 && y >= 0 && x < w && y < lot.h && map[y * w + x] === roomId;
  let sum = 0;
  const hung = new Set();                         // «стена+сторона», на которых что-то висит
  for (const o of state.objects) {
    if (o.level !== level) continue;
    const def = byId[o.def];
    if (!def) continue;
    if (def.place === 'wall') {
      const [bx, by] = behindTile(o.x, o.y, o.rot);
      const front = inRoom(o.x, o.y), back = def.portal || isWindow(o.def) ? inRoom(bx, by) : false;
      if (front || back) sum += impact(o);        // окно светит в обе комнаты
      hung.add(edgeKey(wallEdgeOf(o.x, o.y, o.rot)) + '|' + o.x + ',' + o.y);
      if (def.portal || isWindow(o.def)) hung.add(edgeKey(wallEdgeOf(o.x, o.y, o.rot)) + '|' + bx + ',' + by);
      continue;
    }
    // предмет считается в комнате, если хоть одна его клетка в ней
    let here = false;
    for (const [x, y] of rectTiles(objRect(o))) if (inRoom(x, y)) { here = true; break; }
    if (here) sum += impact(o);
  }
  for (const p of lot.puddles || []) if ((p.level || 0) === level && inRoom(p.x, p.y)) sum += ROOM.puddle;
  for (const p of lot.trash || []) if ((p.level || 0) === level && inRoom(p.x, p.y)) sum += ROOM.trash;
  if (outside) return clamp(sum / ROOM.outsideScale + ROOM.outsideBase);
  // пол и голые стены
  let bare = 0, bareWalls = 0;
  for (let t = 0; t < map.length; t++) {
    if (map[t] !== roomId) continue;
    const x = t % w, y = (t - x) / w;
    if (!L.floor[t] && !holes.has(`${x},${y},${level}`)) bare++;
    for (let s = 0; s < 4; s++) {
      const e = sideEdge(x, y, s), type = getEdge(lot, level, e.dir, e.x, e.y);
      if (type === BARE_WALL_TYPE && !hung.has(edgeKey(e) + '|' + x + ',' + y)) bareWalls++;
    }
  }
  sum += bare ? bare * ROOM.bareFloorTile : ROOM.floorFull;
  sum += bareWalls * ROOM.bareWallEdge;
  const scale = Math.max(1, info.area / ROOM.areaDiv);
  return clamp(sum / scale + ROOM.base);
}

const clamp = v => Math.round(Math.max(-100, Math.min(100, v)));
