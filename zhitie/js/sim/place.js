// Бесплатная расстановка Мозгом (надгробие, кроватка): ищем место кольцами через world.canPlace(…, {free:true}).
// Если у Мира есть placeFree — используется он; иначе свой поиск (заглушка в тестах).
import { newId } from '../core/state.js';

export function placeFree(state, bus, world, defId, x, y, level = 0, st = {}, maxR = 8) {
  if (world?.placeFree) {                                   // официальный путь Мира
    const id = world.placeFree(state, bus, defId, { x, y, level });
    const o = id != null ? state.objects.find(p => p.id === id) : null;
    if (o) { Object.assign(o.st, st); bus.emit('object:changed', { id }); }
    return o;
  }
  const ok = (px, py, rot) => (world?.canPlace ? world.canPlace(state, defId, px, py, rot, level, { free: true }).ok
    : !state.objects.some(o => o.x === px && o.y === py && (o.level ?? 0) === level));
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const px = x + dx, py = y + dy;
    if (px < 0 || py < 0 || px >= state.lot.w || py >= state.lot.h) continue;
    for (const rot of [0, 1, 2, 3]) if (ok(px, py, rot)) {
      const o = { id: newId(state), def: defId, x: px, y: py, rot, level, st: { dirty: 0, broken: false, inUse: null, boughtDay: -1, ...st } };
      state.objects.push(o);
      world?.invalidate?.();
      bus.emit('object:added', { id: o.id });
      bus.emit('lot:changed', { level, kind: 'object' });
      return o;
    }
  }
  return null;
}

// Убрать предмет без денег (кража, сгорело) — ради события и кэша Мира
export function dropObject(state, bus, world, id) {
  const i = state.objects.findIndex(o => o.id === id);
  if (i < 0) return null;
  const [o] = state.objects.splice(i, 1);
  world?.invalidate?.();
  bus.emit('object:removed', { id });
  bus.emit('lot:changed', { level: o.level ?? 0, kind: 'object' });
  return o;
}
