// Пустой участок и загрузка стартового дома.
import { START_LOT } from '../../data/lot-start.js';
import { invalidate, watchBus } from './cache.js';
import { buildWall, buildRoom } from './walls.js';
import { paintFloor } from './floors.js';
import { canPlace, addObject } from './objects.js';
import { recomputeRooms } from './rooms.js';
import { ROOF_DEFAULT } from './config.js';

export function createLot(w = 30, h = 30) {
  return {
    w, h, rooms: [], roof: { ...ROOF_DEFAULT },
    levels: [0, 1].map(() => ({
      floor: Array(w * h).fill(0),
      wallH: Array(w * (h + 1)).fill(0),
      wallV: Array((w + 1) * h).fill(0),
    })),
  };
}

/** Стереть участок и построить стартовый дом бесплатно. Бросает Error, если данные дома не проходят canPlace. */
export function loadStartLot(state, bus, data = START_LOT) {
  watchBus(bus);
  for (const o of state.objects) bus?.emit('object:removed', { id: o.id });
  state.lot = createLot(data.w, data.h);
  state.objects = [];
  invalidate();
  const free = { free: true };
  // по этажам: сначала пол (этажу 1 нужна опора снизу), потом стены (этажу 1 нужен пол рядом)
  for (let level = 0; level < state.lot.levels.length; level++) {
    for (const f of data.floors) if ((f.level || 0) === level) paintFloor(state, null, ...f.rect, f.id, level, free);
    for (const wl of data.walls) {
      if ((wl.level || 0) !== level) continue;
      if (wl.rect) buildRoom(state, null, ...wl.rect, level, wl.type, free);
      else buildWall(state, null, ...wl.line, level, wl.type, free);
    }
  }
  for (const o of data.objects) {
    const level = o.level || 0, chk = canPlace(state, o.def, o.x, o.y, o.rot, level, free);
    if (!chk.ok) throw new Error(`lot-start: ${o.def} (${o.x},${o.y}) r${o.rot}: ${chk.reason}`);
    addObject(state, o.def, o.x, o.y, o.rot, level, { boughtDay: -1 });
  }
  recomputeRooms(state);
  for (const o of state.objects) bus?.emit('object:added', { id: o.id });
  for (const level of [0, 1]) for (const kind of ['wall', 'floor', 'object']) bus?.emit('lot:changed', { level, kind });
  bus?.emit('lot:changed', { level: 0, kind: 'roof' });
  return { spawn: { ...data.spawn }, frontDoor: { ...data.frontDoor } };
}
