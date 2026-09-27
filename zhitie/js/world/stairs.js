// Лестница (fp 1×4, place:'floor', ставится на этаж L, ведёт на L+1).
// Локально (rot=0, «лицо» → +y): ступени ly=3 (нижняя) … ly=0 (верхняя).
//   bottom — клетка ПЕРЕД лицом (ly=4) на этаже L;  top — клетка ЗА спиной (ly=−1) на этаже L+1.
// Над пролётом на этаже L+1 — дыра в полу (пол обнуляется при установке, прежний запоминается в st.hole
// и возвращается при продаже/переносе).
import { byId } from '../../data/catalog.js';
import { toWorld } from './footprint.js';

export const isStairs = o => !!byId[o?.def]?.levels;

/** {bottom:{x,y,level}, top:{x,y,level}, tiles:[{x,y,level}] (снизу вверх), cost} */
export function stairsInfo(o) {
  const d = byId[o.def].fp[1], L = o.level || 0;
  const tiles = [];
  for (let ly = d - 1; ly >= 0; ly--) { const [x, y] = toWorld(o, 0, ly); tiles.push({ x, y, level: L }); }
  const [bx, by] = toWorld(o, 0, d), [tx, ty] = toWorld(o, 0, -1);
  return { bottom: { x: bx, y: by, level: L }, top: { x: tx, y: ty, level: L + 1 }, tiles, cost: d + 1 };
}

// Клетки дыр над всеми лестницами: Set 'x,y,level'
export function holeSet(state) {
  const s = new Set();
  for (const o of state.objects) if (isStairs(o)) for (const t of stairsInfo(o).tiles) s.add(`${t.x},${t.y},${t.level + 1}`);
  return s;
}
