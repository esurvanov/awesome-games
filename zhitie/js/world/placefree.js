// Поставить предмет бесплатно в ближайшее годное место (надгробие, кроватка-подарок, коробка пиццы…).
import { byId } from '../../data/catalog.js';
import { canPlace, addObject } from './objects.js';
import { useSpots } from './spots.js';
import { invalidate, watchBus } from './cache.js';
import { DAY_MIN } from './config.js';

/** Кольцами от near (порт nearest_free_tile), rot 0..3; нужен хоть один стоячий подход. → id | null */
export function placeFree(state, bus, defId, near, maxR = 15) {
  watchBus(bus);
  const def = byId[defId];
  if (!def) return null;
  const level = near.level ?? 0, cx = Math.floor(near.x), cy = Math.floor(near.y);
  for (let r = 0; r <= maxR; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push([cx + dx, cy + dy, dx * dx + dy * dy]);
    ring.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of ring) for (let rot = 0; rot < 4; rot++) {
      if (!canPlace(state, defId, x, y, rot, level, { free: true }).ok) continue;
      const o = addObject(state, defId, x, y, rot, level, { boughtDay: Math.floor((state.time?.minutes || 0) / DAY_MIN) });
      if (def.place === 'floor' && !useSpots(state, o.id).some(s => !s.onObject)) {
        state.objects.splice(state.objects.indexOf(o), 1); invalidate(); continue;
      }
      bus?.emit('object:added', { id: o.id });
      bus?.emit('lot:changed', { level, kind: 'object' });
      return o.id;
    }
  }
  return null;
}

