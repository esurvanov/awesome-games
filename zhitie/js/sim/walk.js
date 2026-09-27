// Ходьба по пути из тайлов (world.findPath): к центрам тайлов, скорость в тайлах за игровую минуту.
// Этажи: точки пути несут level; точка со stairs — выход с лестницы. Путь разворачивается по клеткам ступеней
// (world.stairsInfo), высота sim.z (м) плавно интерполируется — Рендер ставит сима на y = sim.z.
import { WALK, FLOOR_HEIGHT } from '../core/tuning.js';
import { facingTo, objById } from './util.js';

export function expandStairs(state, world, sim, path) {
  const out = [];
  let prev = sim.level ?? 0;
  for (const p of path) {
    const L = p.level ?? prev;
    const o = p.stairs != null ? objById(state, p.stairs) : null;
    if (o && world?.stairsInfo && L !== prev) {
      const info = world.stairsInfo(o);
      const seq = L > prev ? info.tiles : [...info.tiles].reverse();
      const z0 = prev * FLOOR_HEIGHT, z1 = L * FLOOR_HEIGHT, n = seq.length;
      seq.forEach((t, i) => out.push({ x: t.x, y: t.y, level: Math.min(prev, L), z: z0 + ((z1 - z0) * (i + 1)) / (n + 1), stairs: o.id }));
    }
    out.push({ x: p.x, y: p.y, level: L, z: L * FLOOR_HEIGHT });
    prev = L;
  }
  return out;
}

// → true, когда дошёл до конца пути
export function stepWalk(sim, dm, run = false) {
  let budget = WALK.tilesPerMinute * (run ? WALK.runMult : 1) * dm;
  while (sim.path?.length && budget > 0) {
    const p = sim.path[0];
    const tx = p.x + 0.5, ty = p.y + 0.5;
    const pz = p.z ?? (p.level ?? sim.level ?? 0) * FLOOR_HEIGHT;
    sim.walkSeg ??= { x: sim.x, y: sim.y, z: sim.z ?? (sim.level ?? 0) * FLOOR_HEIGHT };
    const dx = tx - sim.x, dy = ty - sim.y;
    const d = Math.hypot(dx, dy);
    if (d <= WALK.arriveEps || d <= budget) {
      sim.x = tx; sim.y = ty; sim.z = pz; budget -= d; sim.path.shift();
      if (p.level != null) sim.level = p.level;
      sim.stairs = p.stairs ?? null;
      sim.walkSeg = null;
      if (d > 1e-6) sim.facing = facingTo(dx, dy);
      continue;
    }
    sim.x += (dx / d) * budget; sim.y += (dy / d) * budget;
    const seg = sim.walkSeg, len = Math.hypot(tx - seg.x, ty - seg.y) || 1;
    sim.z = seg.z + (pz - seg.z) * Math.min(1, 1 - Math.hypot(tx - sim.x, ty - sim.y) / len);
    sim.stairs = p.stairs ?? null;
    sim.facing = facingTo(dx, dy);
    budget = 0;
  }
  if (!sim.path?.length) { sim.path = null; sim.walkSeg = null; sim.stairs = null; return true; }
  return false;
}

export const tileOf = sim => ({ x: Math.floor(sim.x), y: Math.floor(sim.y) });
