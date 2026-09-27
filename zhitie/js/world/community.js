// Общественные участки: план здания (зал + подсобка | санузел) по data/lots/community.js, двор, мебель, точки появления горожан.
import { COMMUNITY } from '../../data/lots/community.js';
import { buildPlan } from './housegen.js';
import { createFurnisher } from './furnish.js';
import { roomAt } from './rooms.js';
import { makeRng } from './rng.js';

export function planCommunity(type, rng) {
  const spec = COMMUNITY[type];
  if (!spec) throw new Error(`нет общественного участка ${type}`);
  const { w, h } = spec, { W, D, hall, back } = spec.building;
  const plan = { w, h, rooms: [], doors: [], stairs: [], floors: [], yards: [], ext: rng.pick([1, 2, 3]), int: 1, type };
  const park = type === 'park';
  const X0 = park ? 2 : Math.floor((w - W) / 2), Y1 = park ? 2 + D : h - 5, Y0 = Y1 - D, X1 = X0 + W;
  if (back) {
    plan.rooms.push({ type: back, level: 0, x0: X0, y0: Y0, x1: X1 - 4, y1: Y0 + 4 }, { type: 'restroom', level: 0, x0: X1 - 4, y0: Y0, x1: X1, y1: Y0 + 4 },
      { type: hall, level: 0, x0: X0, y0: Y0 + 4, x1: X1, y1: Y1 });
    plan.doors.push({ x: X0 + 2, y: Y0 + 4, rot: 0, level: 0 }, { x: X1 - 3, y: Y0 + 4, rot: 0, level: 0 });
  } else plan.rooms.push({ type: hall, level: 0, x0: X0, y0: Y0, x1: X1, y1: Y1 });
  const xf = X0 + Math.floor(W / 2);
  plan.doors.push({ x: xf, y: Y1 - 1, rot: 2, level: 0 });
  if (!park) plan.doors.push({ x: xf - 1, y: Y1 - 1, rot: 2, level: 0 });
  plan.front = { x: xf, y: Y1 };
  if (park) {
    // дорожки крестом и к киоску
    plan.floors.push({ level: 0, x0: Math.floor(w / 2), y0: 1, x1: Math.floor(w / 2), y1: h - 1, id: 'path' },
      { level: 0, x0: 1, y0: Math.floor(h / 2), x1: w - 2, y1: Math.floor(h / 2), id: 'path' },
      { level: 0, x0: xf, y0: Y1, x1: xf, y1: Math.floor(h / 2), id: 'path' });
    plan.yards.push({ x0: 1, y0: 1, x1: w - 1, y1: h - 2, level: 0, type: 'yard' });
  } else {
    plan.floors.push({ level: 0, x0: xf - 2, y0: Y1, x1: xf + 1, y1: h - 1, id: 'path' });
    plan.yards.push({ x0: 1, y0: 1, x1: w - 1, y1: h - 2, level: 0, type: 'yard' });
  }
  plan.spawns = [2, Math.floor(w / 2) - 3, w - 3].map(x => ({ x, y: h - 1, level: 0 }));
  return plan;
}

/** Построить общественный участок на state. → {plan, spawn, spawns, frontDoor} */
export function buildCommunity(state, type, seed = type) {
  const rng = makeRng(seed), plan = planCommunity(type, rng), kit = COMMUNITY[type].kit;
  buildPlan(state, plan, rng);
  const F = createFurnisher(state, { entry: { ...plan.front, level: 0 }, rng, tier: 0.5 });
  const outside = c => roomAt(state, c.x, c.y, 0) === 0;
  const rooms = [...plan.rooms.map(r => ({ r, list: kit[r.type] || [] })), ...plan.yards.map(r => ({ r, list: kit.yard || [], where: outside }))];
  for (const { r, list, where } of rooms) {
    for (const [kind, mode = 'wall', count = 1] of list) {
      for (let i = 0; i < count; i++) {
        if (kind === '@tables') { const t = F.place(mode, r, 'center', { where }); if (t) F.chairsAround(t, 'dining_chair', 2 + (i % 3)); }
        else if (kind === '@desk') { const d = F.place(mode, r, 'wall', { where }); if (d) F.facing(d, 'dining_chair', [1]); }
        else F.place(kind, r, mode, { where });
      }
    }
  }
  return { plan, spawn: { ...plan.spawns[1] }, spawns: plan.spawns.map(p => ({ ...p })), frontDoor: { ...plan.front } };
}
