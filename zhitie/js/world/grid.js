// Рёбра и клетки. Контракт §3:
//   wallH: ребро (x,y)→(x+1,y), индекс y*w+x,     x∈[0,w), y∈[0,h]  — северная сторона клетки (x,y)
//   wallV: ребро (x,y)→(x,y+1), индекс y*(w+1)+x, x∈[0,w], y∈[0,h)  — западная сторона клетки (x,y)

export const hIdx = (lot, x, y) => y * lot.w + x;
export const vIdx = (lot, x, y) => y * (lot.w + 1) + x;
export const inLot = (lot, x, y) => x >= 0 && y >= 0 && x < lot.w && y < lot.h;
export const edgeInLot = (lot, dir, x, y) =>
  dir === 'h' ? x >= 0 && x < lot.w && y >= 0 && y <= lot.h : x >= 0 && x <= lot.w && y >= 0 && y < lot.h;

export function getEdge(lot, level, dir, x, y) {
  const L = lot.levels[level];
  if (!L || !edgeInLot(lot, dir, x, y)) return 0;
  return dir === 'h' ? L.wallH[hIdx(lot, x, y)] : L.wallV[vIdx(lot, x, y)];
}

export function setEdge(lot, level, dir, x, y, v) {
  const L = lot.levels[level];
  if (dir === 'h') L.wallH[hIdx(lot, x, y)] = v; else L.wallV[vIdx(lot, x, y)] = v;
}

// Ребро между соседними по стороне клетками a и b (|dx|+|dy| = 1)
export function edgeBetween(ax, ay, bx, by) {
  if (ay === by) return { dir: 'v', x: Math.max(ax, bx), y: ay };
  return { dir: 'h', x: ax, y: Math.max(ay, by) };
}

// Ребро по стороне клетки (x,y): 0=E 1=S 2=W 3=N
export function sideEdge(x, y, side) {
  switch (side) {
    case 0: return { dir: 'v', x: x + 1, y };
    case 1: return { dir: 'h', x, y: y + 1 };
    case 2: return { dir: 'v', x, y };
    default: return { dir: 'h', x, y };
  }
}

export const edgeKey = e => `${e.dir}${e.x},${e.y}`;

// Рёбра прямой линии между вершинами (x0,y0)-(x1,y1); диагональ прижимается к доминирующей оси
export function lineEdges(lot, x0, y0, x1, y1) {
  const out = [];
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) if (edgeInLot(lot, 'h', x, y0)) out.push({ dir: 'h', x, y: y0 });
  } else {
    for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y++) if (edgeInLot(lot, 'v', x0, y)) out.push({ dir: 'v', x: x0, y });
  }
  return out;
}

// Маска стен, сходящихся в вершине (vx,vy): 1=E 2=S 4=W 8=N — для стыков/столбиков у Рендера (порт DIR-маски AoE)
export function wallJoint(state, level, vx, vy) {
  const { lot } = state;
  return (getEdge(lot, level, 'h', vx, vy) ? 1 : 0) | (getEdge(lot, level, 'v', vx, vy) ? 2 : 0)
    | (getEdge(lot, level, 'h', vx - 1, vy) ? 4 : 0) | (getEdge(lot, level, 'v', vx, vy - 1) ? 8 : 0);
}
