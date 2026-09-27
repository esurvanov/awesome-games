// A* по клеткам, 8-связность, октильная эвристика, лимит узлов, частичный путь.
// Порт game/world.py:1622-1728 (age-of-empires): лучший частичный путь по минимальной h, флаг «дошёл».
// Отличия: стены на рёбрах (маска open из cache.js), цели на занятой клетке (сесть на диван)
// допускаются последним прямым шагом, типизированные массивы вместо dict.
import { levelGrid, cacheFor, DX, DY } from './cache.js';
import { isStairs, stairsInfo } from './stairs.js';
import { PATH_NODE_LIMIT, DIAG } from './config.js';

// Рабочие массивы переиспользуются (штампы поколений вместо очистки). Узел = level·n + клетка.
let cap = 0, gCost, came, seen, closed, goalMark, heapF, heapN, stamp = 0;
function ensure(n) {
  if (n <= cap) return;
  cap = n;
  gCost = new Float64Array(n); came = new Int32Array(n);
  seen = new Uint32Array(n); closed = new Uint32Array(n); goalMark = new Uint32Array(n);
  heapF = new Float64Array(n * 8 + 16); heapN = new Int32Array(n * 8 + 16);
  stamp = 0;
}

const octile = (dx, dy) => (dx > dy ? dx + (DIAG - 1) * dy : dy + (DIAG - 1) * dx);

// Переходы между этажами по лестницам: Map узел → [{to, cost, id}] (кэш до lot:changed)
function stairLinks(state) {
  const c = cacheFor(state);
  if (c.links) return c.links;
  const { w, h } = state.lot, n = w * h, links = new Map();
  const add = (a, b, cost, id) => (links.get(a) || links.set(a, []).get(a)).push({ to: b, cost, id });
  for (const o of state.objects) {
    if (!isStairs(o)) continue;
    const { bottom: B, top: T, cost } = stairsInfo(o);
    if (!state.lot.levels[T.level]) continue;
    if ([B, T].some(p => p.x < 0 || p.y < 0 || p.x >= w || p.y >= h)) continue;
    const gb = levelGrid(state, B.level), gt = levelGrid(state, T.level);
    if (gb.solid[B.y * w + B.x] || gt.solid[T.y * w + T.x]) continue;
    const a = B.level * n + B.y * w + B.x, b = T.level * n + T.y * w + T.x;
    add(a, b, cost, o.id); add(b, a, cost, o.id);
  }
  return (c.links = links);
}

/**
 * A* по этажам. from/goals могут нести level (по умолчанию — аргумент level).
 * @returns {Array<{x,y,level,stairs?}>|null} клетки без стартовой; поле reached — дошёл ли до цели;
 *   stairs — id лестницы у точки, в которую попали, пройдя по ней. null — нет целей или старт вне участка.
 */
export function findPath(state, level, from, goals, opts = {}) {
  const { w, h } = state.lot, n = w * h;
  const sl = from.level ?? level;
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !state.lot.levels[sl]) return null;
  const links = stairLinks(state), multi = links.size > 0;
  const nL = multi ? state.lot.levels.length : 1, base = multi ? 0 : sl;   // одноэтажный поиск — без лестниц
  const grids = [];
  for (let l = 0; l < nL; l++) grids.push(levelGrid(state, base + l));
  ensure(n * nL);
  if (++stamp >= 0xffffffff) { seen.fill(0); closed.fill(0); goalMark.fill(0); stamp = 1; }
  const S = stamp, limit = opts.limit ?? PATH_NODE_LIMIT;
  const gx = [], gy = [];
  for (const g of goals || []) {
    const x = Math.floor(g.x), y = Math.floor(g.y), gl = (g.level ?? level) - base;
    if (x < 0 || y < 0 || x >= w || y >= h || gl < 0 || gl >= nL) continue;
    const node = gl * n + y * w + x;
    if (goalMark[node] === S) continue;
    goalMark[node] = S; gx.push(x); gy.push(y);
  }
  if (!gx.length) return null;
  const ng = gx.length;
  const hOf = (x, y) => {
    let best = Infinity;
    for (let i = 0; i < ng; i++) {
      const v = octile(Math.abs(x - gx[i]), Math.abs(y - gy[i]));
      if (v < best) best = v;
    }
    return best;
  };
  const s = (sl - base) * n + sy * w + sx;
  if (goalMark[s] === S) { const r = []; r.reached = true; r.expanded = 0; return r; }

  let hs = 0;
  const push = (f, v) => {
    let i = hs++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapF[i] = heapF[p]; heapN[i] = heapN[p]; i = p;
    }
    heapF[i] = f; heapN[i] = v;
  };
  const pop = () => {
    const top = heapN[0], f = heapF[--hs], v = heapN[hs];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hs) break;
      if (c + 1 < hs && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= f) break;
      heapF[i] = heapF[c]; heapN[i] = heapN[c]; i = c;
    }
    heapF[i] = f; heapN[i] = v;
    return top;
  };
  const relax = (nc, g2, c, hx, hy) => {
    if (seen[nc] === S && g2 >= gCost[nc]) return;
    seen[nc] = S; gCost[nc] = g2; came[nc] = c;
    push(g2 + hOf(hx, hy), nc);
  };

  seen[s] = S; gCost[s] = 0; came[s] = -1;
  push(hOf(sx, sy), s);
  let best = s, bestH = Infinity, bestG = 0, expanded = 0, found = -1;
  while (hs > 0 && expanded < limit) {
    const c = pop();
    if (closed[c] === S) continue;
    closed[c] = S; expanded++;
    if (goalMark[c] === S) { found = c; break; }
    const lv = (c / n) | 0, t = c - lv * n, cx = t % w, cy = (t - cx) / w, gc = gCost[c];
    const hc = hOf(cx, cy);
    if (hc < bestH || (hc === bestH && gc < bestG)) { bestH = hc; best = c; bestG = gc; }
    const G = grids[lv], solid = G.solid;
    if (solid[t] && c !== s) continue;                  // на занятую клетку-цель только входят
    const m = G.open[t], off = lv * n;
    for (let d = 0; d < 8; d++) {
      if (!(m & (1 << d))) continue;
      const nx = cx + DX[d], ny = cy + DY[d], nt = ny * w + nx, nc = off + nt;
      if (closed[nc] === S) continue;
      if (solid[nt] && !(d < 4 && solid[nt] > 0 && goalMark[nc] === S)) continue;
      relax(nc, gc + (d < 4 ? 1 : DIAG), c, nx, ny);
    }
    if (multi) {
      const ls = links.get(c);
      if (ls) for (const L of ls) if (closed[L.to] !== S) { const tt = L.to % n; relax(L.to, gc + L.cost, c, tt % w, (tt / w) | 0); }
    }
  }
  const end = found >= 0 ? found : best;
  const path = [];
  for (let c = end; c !== s && c !== -1; c = came[c]) {
    const lv = (c / n) | 0, t = c - lv * n, p = { x: t % w, y: (t / w) | 0, level: base + lv };
    const prev = came[c];
    if (prev >= 0 && ((prev / n) | 0) !== lv) p.stairs = links.get(prev).find(L => L.to === c).id;
    path.push(p);
  }
  path.reverse();
  path.reached = found >= 0;
  path.expanded = expanded;
  return path;
}

// Ближайшая свободная клетка кольцами (порт nearest_free_tile, world.py:1604)
export function nearestFree(state, level, x, y, maxR = 12) {
  const { w, h, solid } = levelGrid(state, level);
  const free = (a, b) => a >= 0 && b >= 0 && a < w && b < h && !solid[b * w + a];
  if (free(x, y)) return { x, y };
  for (let r = 1; r < maxR; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !free(x + dx, y + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { x: x + dx, y: y + dy }; }
    }
    if (best) return best;
  }
  return null;
}

// Можно ли стоять на клетке
export function walkable(state, level, x, y) {
  const { w, h, solid } = levelGrid(state, level);
  return x >= 0 && y >= 0 && x < w && y < h && !solid[y * w + x];
}

/**
 * Достижимость от клетки по всем этажам (BFS по той же маске, что и A*, с лестницами).
 * → { mark: Uint8Array(levels·n), count, n }  mark[level·n + y·w + x] = 1
 */
export function reachMap(state, from) {
  const { w, h } = state.lot, n = w * h, nL = state.lot.levels.length;
  const grids = Array.from({ length: nL }, (_, l) => levelGrid(state, l));
  const links = stairLinks(state), mark = new Uint8Array(n * nL), q = new Int32Array(n * nL);
  const sl = from.level ?? 0, s = sl * n + Math.floor(from.y) * w + Math.floor(from.x);
  let qh = 0, qt = 0, count = 0;
  mark[s] = 1; q[qt++] = s;
  while (qh < qt) {
    const c = q[qh++], lv = (c / n) | 0, t = c - lv * n, x = t % w, y = (t - x) / w, G = grids[lv];
    count++;
    if (G.solid[t] && c !== s) continue;
    const m = G.open[t];
    for (let d = 0; d < 8; d++) {
      if (!(m & (1 << d))) continue;
      const nt = (y + DY[d]) * w + x + DX[d], nc = lv * n + nt;
      if (mark[nc] || G.solid[nt]) continue;
      mark[nc] = 1; q[qt++] = nc;
    }
    for (const L of links.get(c) || []) if (!mark[L.to]) { mark[L.to] = 1; q[qt++] = L.to; }
  }
  return { mark, count, n };
}
