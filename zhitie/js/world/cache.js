// Кэш производных сеток (занятость, проходимость, комнаты) на state.lot.
// Сбрасывается: нашими мутациями (invalidate), событием lot:changed на шине, и по сигнатуре
// (кол-во предметов + nextId + ссылка на массив) — на случай, если state подменили загрузкой.
import { byId } from '../../data/catalog.js';
import { objRect, rectTiles, wallEdgeOf } from './footprint.js';
import { hIdx, vIdx } from './grid.js';

const caches = new WeakMap();
let epoch = 0;
const watched = new WeakSet();

export function invalidate() { epoch++; }

export function watchBus(bus) {
  if (!bus || watched.has(bus)) return;
  watched.add(bus);
  bus.on('lot:changed', invalidate);
}

const sigOf = state => `${state.objects.length}|${state.nextId}`;

export function cacheFor(state) {
  let c = caches.get(state.lot);
  const sig = sigOf(state);
  if (!c || c.epoch !== epoch || c.sig !== sig || c.objects !== state.objects) {
    c = { epoch, sig, objects: state.objects, levels: [], rooms: null, links: null, support: [] };
    caches.set(state.lot, c);
  }
  return c;
}

// Сетки этажа: solid/walk/surface — id предмета на клетке (0 = пусто),
// doorH/doorV — двери на рёбрах, open — битовая маска разрешённых ходов (0..7: E S W N SE SW NW NE)
export const DX = [1, 0, -1, 0, 1, -1, -1, 1];
export const DY = [0, 1, 0, -1, 1, 1, -1, -1];

export function levelGrid(state, level) {
  const c = cacheFor(state);
  return c.levels[level] || (c.levels[level] = buildGrid(state, level));
}

function buildGrid(state, level) {
  const { lot } = state, { w, h } = lot, L = lot.levels[level], n = w * h;
  const solid = new Int32Array(n), walk = new Int32Array(n), surface = new Int32Array(n);
  const doorH = new Uint8Array(w * (h + 1)), doorV = new Uint8Array((w + 1) * h);
  const wallObj = new Map();                       // ключ ребра → [предметы]
  for (const o of state.objects) {
    if (o.level !== level) continue;
    const def = byId[o.def];
    if (!def) continue;
    if (def.place === 'wall') {
      const e = wallEdgeOf(o.x, o.y, o.rot);
      const k = `${e.dir}${e.x},${e.y}`;
      (wallObj.get(k) || wallObj.set(k, []).get(k)).push(o);
      if (def.portal) {
        if (e.dir === 'h') doorH[hIdx(lot, e.x, e.y)] = 1; else doorV[vIdx(lot, e.x, e.y)] = 1;
      }
      continue;
    }
    const layer = def.place === 'surface' ? surface : def.walkable ? walk : solid;
    for (const [x, y] of rectTiles(objRect(o))) if (x >= 0 && y >= 0 && x < w && y < h) layer[y * w + x] = o.id;
  }
  // этаж выше 0: клетка без пола — «воздух», непроходима (−1)
  if (level > 0) for (let t = 0; t < n; t++) if (!L.floor[t] && !solid[t]) solid[t] = -1;
  // проходимость рёбер: стена без двери — закрыто
  const wH = (x, y) => L.wallH[y * w + x], wV = (x, y) => L.wallV[y * (w + 1) + x];
  const passE = (x, y) => x + 1 < w && (!wV(x + 1, y) || doorV[y * (w + 1) + x + 1]);
  const passW = (x, y) => x > 0 && (!wV(x, y) || doorV[y * (w + 1) + x]);
  const passS = (x, y) => y + 1 < h && (!wH(x, y + 1) || doorH[(y + 1) * w + x]);
  const passN = (x, y) => y > 0 && (!wH(x, y) || doorH[y * w + x]);
  // любая стена (включая дверной проём) в вершине блокирует срезание угла
  const cornerFree = (vx, vy) => !(L.wallH[vy * w + vx] || (vx > 0 && L.wallH[vy * w + vx - 1])
    || (vy < h && L.wallV[vy * (w + 1) + vx]) || (vy > 0 && L.wallV[(vy - 1) * (w + 1) + vx]));
  const open = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const e = passE(x, y), s = passS(x, y), wv = passW(x, y), nn = passN(x, y);
    let m = (e ? 1 : 0) | (s ? 2 : 0) | (wv ? 4 : 0) | (nn ? 8 : 0);
    // диагональ: обе боковые клетки свободны и в общей вершине нет ни одной стены
    const diag = (bit, dx, dy) => {
      const nx = x + dx, ny = y + dy;
      if (solid[y * w + nx] || solid[ny * w + x]) return;
      if (!cornerFree(dx > 0 ? x + 1 : x, dy > 0 ? y + 1 : y)) return;
      m |= bit;
    };
    if (e && s) diag(16, 1, 1);
    if (wv && s) diag(32, -1, 1);
    if (wv && nn) diag(64, -1, -1);
    if (e && nn) diag(128, 1, -1);
    open[y * w + x] = m;
  }
  return { w, h, solid, walk, surface, doorH, doorV, wallObj, open };
}
