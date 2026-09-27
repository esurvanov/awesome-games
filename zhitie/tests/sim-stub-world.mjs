// Крошечная заглушка Мира для тестов Мозга: прямой путь, точка использования = клетка перед предметом.
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';

const FRONT = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const ON = { bed_single: 'lie', bed_double: 'lie', sofa: 'sit', armchair: 'sit', dining_chair: 'sit', toilet: 'sit', shower: 'in', bathtub: 'in' };

export const stubWorld = {
  findPath(state, level, from, goals) {
    const g = goals.reduce((b, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(b.x - from.x, b.y - from.y) ? p : b));
    const path = [];
    let { x, y } = from;
    while (x !== g.x || y !== g.y) { x += Math.sign(g.x - x); y += Math.sign(g.y - y); path.push({ x, y }); }
    path.reached = true;
    return path;
  },
  useSpots(state, objId) {
    const o = state.objects.find(p => p.id === objId);
    const [dx, dy] = FRONT[o.rot ?? 0];
    const out = [{ x: o.x + dx, y: o.y + dy, facing: Math.atan2(-dx, -dy), slot: 'front' }];
    const on = ON[o.def];                              // «на предмете»: сесть/лечь/встать в душ
    if (on) out.push({ x: o.x, y: o.y, facing: Math.atan2(dx, dy), slot: on, onObject: true });
    return out;
  },
  roomAt: () => 1,
  roomScore: () => 20,
};

// Домик-заглушка: всё нужное для жизни в ряд
export function stubHouse({ extra = [] } = {}) {
  const state = createState(30, 30);
  const bus = createBus();
  const defs = ['fridge', 'stove', 'dining_chair', 'bed_single', 'bed_single', 'toilet', 'shower', 'sofa', 'tv', 'phone', 'mailbox', 'bookshelf', ...extra];
  defs.forEach((def, i) => state.objects.push({ id: state.nextId++, def, x: 2 + i * 2, y: 5, rot: 0, level: 0, st: { dirty: 0, broken: false, inUse: null } }));
  return { state, bus };
}

export const findObj = (state, def) => state.objects.find(o => o.def === def);

// Сбор событий шины
export function record(bus, types) {
  const log = [];
  for (const t of types) bus.on(t, p => log.push({ t, ...p }));
  return log;
}
