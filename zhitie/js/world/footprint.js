// Футпринт с учётом поворота. rot=0 — «лицо» в +y, rot=1 → +x, rot=2 → −y, rot=3 → −x
// (поворот вокруг +Y three.js на rot·90°). (x,y) предмета — МИНИМАЛЬНЫЙ угол занятого прямоугольника.
import { byId } from '../../data/catalog.js';
import { sideEdge } from './grid.js';

export const FACING = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const rotAngle = rot => (rot & 3) * Math.PI / 2;          // угол для three rotation.y
export const dirAngle = (dx, dy) => Math.atan2(dx, dy);           // 0 → +y, π/2 → +x

export function rectOf(def, x, y, rot) {
  const [w, d] = def.fp;
  return rot & 1 ? { X: x, Y: y, W: d, D: w } : { X: x, Y: y, W: w, D: d };
}

export const objRect = o => rectOf(byId[o.def], o.x, o.y, o.rot);

export function* rectTiles(r) {
  for (let y = r.Y; y < r.Y + r.D; y++) for (let x = r.X; x < r.X + r.W; x++) yield [x, y];
}

// Локальная клетка (lx вдоль ширины, ly вдоль глубины; ly = d — ряд перед «лицом») → мировая
export function toWorld(o, lx, ly) {
  const def = byId[o.def], [w, d] = def.fp, r = objRect(o);
  let a = lx + 0.5 - w / 2, b = ly + 0.5 - d / 2;
  for (let i = 0; i < (o.rot & 3); i++) [a, b] = [b, -a];        // поворот на 90°: (0,1)→(1,0)
  return [Math.floor(r.X + r.W / 2 + a), Math.floor(r.Y + r.D / 2 + b)];
}

// Настенный предмет (x,y,rot) висит на ребре ЗА спиной клетки (x,y), лицом в клетку (x,y):
// rot0 → северное ребро wallH(x,y); rot1 → западное wallV(x,y); rot2 → южное wallH(x,y+1); rot3 → восточное wallV(x+1,y)
export function wallEdgeOf(x, y, rot) {
  return sideEdge(x, y, [3, 2, 1, 0][rot & 3]);
}
// Клетка по другую сторону ребра настенного предмета
export function behindTile(x, y, rot) {
  const [fx, fy] = FACING[rot & 3];
  return [x - fx, y - fy];
}
