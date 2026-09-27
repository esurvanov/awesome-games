// Размещение/продажа предметов. Порт can_place/place/remove (world.py:1747-1819) + поворот и стены на рёбрах.
import { byId } from '../../data/catalog.js';
import { newId } from '../core/state.js';
import { levelGrid, invalidate, watchBus } from './cache.js';
import { rectOf, rectTiles, wallEdgeOf, behindTile, toWorld } from './footprint.js';
import { getEdge, edgeBetween, edgeKey, inLot } from './grid.js';
import { DEPRECIATION, DAY_MIN, isHost, isWindow } from './config.js';
import { isStairs, stairsInfo } from './stairs.js';
import { recomputeRooms } from './rooms.js';

const fail = reason => ({ ok: false, reason });
const OK = { ok: true, reason: '' };
const today = state => Math.floor((state.time?.minutes || 0) / DAY_MIN);

// Клетки проходов этажа — по обе стороны дверей и вход/выход лестниц; туда нельзя ставить мебель
function doorTiles(state, level) {
  const set = new Set();
  for (const o of state.objects) {
    if (isStairs(o)) {
      const { bottom: B, top: T } = stairsInfo(o);
      for (const p of [B, T]) if (p.level === level) set.add(`${p.x},${p.y}`);
      continue;
    }
    if (o.level !== level || byId[o.def]?.place !== 'wall' || !byId[o.def].portal) continue;
    const [bx, by] = behindTile(o.x, o.y, o.rot);
    set.add(`${o.x},${o.y}`); set.add(`${bx},${by}`);
  }
  return set;
}

// Проверки, специфичные для лестницы (футпринт уже проверен как у обычного предмета)
function stairsCheck(state, defId, x, y, rot, level, ignoreId) {
  const { lot } = state, w = lot.w, up = level + 1;
  if (!lot.levels[up]) return fail('Лестница — только на нижнем этаже');
  const { bottom: B, top: T, tiles } = stairsInfo({ def: defId, x, y, rot, level });
  const wallBetween = (lv, a, b) => { const e = edgeBetween(a.x, a.y, b.x, b.y); return getEdge(lot, lv, e.dir, e.x, e.y); };
  const busy = (G, p) => { const id = G.solid[p.y * w + p.x]; return id && id !== ignoreId; };
  const G0 = levelGrid(state, level), G1 = levelGrid(state, up);
  if (!inLot(lot, B.x, B.y) || busy(G0, B) || wallBetween(level, B, tiles[0])) return fail('Нет места для входа');
  if (!inLot(lot, T.x, T.y) || !lot.levels[up].floor[T.y * w + T.x]) return fail('Наверху нет пола');
  if (busy(G1, T) || wallBetween(up, T, tiles.at(-1))) return fail('Выход сверху занят');
  for (const t of tiles) {
    const k = t.y * w + t.x, id = G1.solid[k] > 0 ? G1.solid[k] : G1.walk[k];
    if (id && id !== ignoreId) return fail('Над лестницей предмет');
  }
  for (let i = 1; i < tiles.length; i++) if (wallBetween(up, tiles[i - 1], tiles[i])) return fail('Мешает стена сверху');
  return OK;
}

// Дыра в полу над пролётом: вырезать (запомнив пол в st.hole) / вернуть
function cutHole(state, o) {
  const F = state.lot.levels[o.level + 1]?.floor;
  if (!F) return;
  const { w } = state.lot;
  o.st.hole = stairsInfo(o).tiles.map(t => { const k = t.y * w + t.x, v = F[k]; F[k] = 0; return v; });
}
function restoreHole(state, o) {
  const F = state.lot.levels[o.level + 1]?.floor;
  if (!F || !o.st?.hole) return;
  const { w } = state.lot;
  stairsInfo(o).tiles.forEach((t, i) => { const k = t.y * w + t.x; if (!F[k]) F[k] = o.st.hole[i] || 0; });
  delete o.st.hole;
}

/**
 * Проверка размещения. opts.free — не проверять деньги (стартовый дом), opts.ignoreId — не мешает сам себе.
 * reason — короткая русская строка для подсказки UI.
 */
export function canPlace(state, defId, x, y, rot = 0, level = 0, opts = {}) {
  const def = byId[defId], { lot } = state;
  if (!def) return fail('Нет такого предмета');
  if (!lot.levels[level]) return fail('Нет такого этажа');
  if (!Number.isInteger(x) || !Number.isInteger(y)) return fail('Не на сетке');
  rot = ((rot % 4) + 4) % 4;
  if (!opts.free && (state.household?.money ?? 0) < def.price) return fail('Не хватает денег');
  const G = levelGrid(state, level), L = lot.levels[level], w = lot.w;
  if (!inLot(lot, x, y)) return fail('За границей участка');

  if (def.place === 'wall') {
    const e = wallEdgeOf(x, y, rot);
    if (!getEdge(lot, level, e.dir, e.x, e.y)) return fail('Нужна стена');
    const [bx, by] = behindTile(x, y, rot);
    const full = def.portal || isWindow(defId);       // дверь/окно занимают ребро целиком
    if (def.portal && !inLot(lot, bx, by)) return fail('Дверь ведёт за участок');
    for (const o of G.wallObj.get(edgeKey(e)) || []) {
      if (o.id === opts.ignoreId) continue;
      const od = byId[o.def], oFull = od.portal || isWindow(o.def);
      if (full || oFull || (o.x === x && o.y === y)) return fail('Место на стене занято');
    }
    if (def.portal) {
      for (const [tx, ty] of [[x, y], [bx, by]]) {
        const id = G.solid[ty * w + tx];
        if (id && id !== opts.ignoreId) return fail('Дверь загорожена');
      }
    }
    return OK;
  }

  if (def.place === 'surface') {
    const t = y * w + x;
    const host = G.solid[t] && state.objects.find(o => o.id === G.solid[t]);
    if (!host || !isHost(host.def)) return fail('Нужна поверхность');
    if (G.surface[t] && G.surface[t] !== opts.ignoreId) return fail('Поверхность занята');
    return OK;
  }

  // напольный предмет
  const r = rectOf(def, x, y, rot);
  if (r.X + r.W > lot.w || r.Y + r.D > lot.h) return fail('За границей участка');
  const doors = def.walkable ? null : doorTiles(state, level);
  const layer = def.walkable ? G.walk : G.solid;
  for (const [tx, ty] of rectTiles(r)) {
    const t = ty * w + tx;
    if (level > 0 && !L.floor[t]) return fail('Нет пола');
    if (layer[t] && layer[t] !== opts.ignoreId) return fail('Место занято');
    if (doors?.has(`${tx},${ty}`)) return fail('Загораживает дверь');
    // стена внутри футпринта (между его клетками)
    if (tx + 1 < r.X + r.W) { const e = edgeBetween(tx, ty, tx + 1, ty); if (getEdge(lot, level, e.dir, e.x, e.y)) return fail('Мешает стена'); }
    if (ty + 1 < r.Y + r.D) { const e = edgeBetween(tx, ty, tx, ty + 1); if (getEdge(lot, level, e.dir, e.x, e.y)) return fail('Мешает стена'); }
  }
  if (!def.walkable) {
    for (const s of state.sims || []) {
      if ((s.level || 0) !== level) continue;
      const sx = Math.floor(s.x), sy = Math.floor(s.y);
      if (sx >= r.X && sy >= r.Y && sx < r.X + r.W && sy < r.Y + r.D) return fail('Мешает житель');
    }
  }
  if (def.levels) return stairsCheck(state, defId, x, y, rot, level, opts.ignoreId);
  return OK;
}

// Внутреннее добавление без проверок денег (для стартового дома и placeObject)
export function addObject(state, defId, x, y, rot, level, extraSt = {}) {
  const o = { id: newId(state), def: defId, x, y, rot: ((rot % 4) + 4) % 4, level,
    st: { dirty: 0, broken: false, inUse: null, ...extraSt } };
  state.objects.push(o);
  if (isStairs(o)) { cutHole(state, o); recomputeRooms(state); }
  invalidate();
  return o;
}

export function placeObject(state, bus, defId, x, y, rot = 0, level = 0) {
  watchBus(bus);
  if (!canPlace(state, defId, x, y, rot, level).ok) return null;
  const def = byId[defId];
  const o = addObject(state, defId, x, y, rot, level, { boughtDay: today(state) });
  state.household.money -= def.price;
  bus?.emit('money:changed', { money: state.household.money, delta: -def.price, reason: 'buy' });
  bus?.emit('object:added', { id: o.id });
  bus?.emit('lot:changed', { level, kind: 'object' });
  if (isStairs(o)) bus?.emit('lot:changed', { level: level + 1, kind: 'floor' });
  return o.id;
}

/** Цена продажи: в день покупки 100 %; иначе st.value (если Мозг ведёт), иначе price·(1−амортизация группы) */
export function sellValue(state, o) {
  const def = byId[o.def];
  if (!def) return 0;
  if (o.st?.boughtDay === today(state)) return def.price;
  if (typeof o.st?.value === 'number') return Math.max(0, Math.round(o.st.value));
  return Math.round(def.price * (1 - (DEPRECIATION[def.depr] ?? 0)));
}

// Удалить предмет (и то, что стоит на нём сверху). Возвращает сумму возврата.
export function removeObject(state, bus, id, { silentLot = false } = {}) {
  watchBus(bus);
  const i = state.objects.findIndex(o => o.id === id);
  if (i < 0) return 0;
  const o = state.objects[i];
  let refund = 0;
  // сначала — предметы на поверхности этого предмета
  if (isHost(o.def)) {
    const r = rectOf(byId[o.def], o.x, o.y, o.rot);
    const onTop = state.objects.filter(p => p.level === o.level && byId[p.def]?.place === 'surface'
      && p.x >= r.X && p.y >= r.Y && p.x < r.X + r.W && p.y < r.Y + r.D);
    for (const p of onTop) refund += removeObject(state, bus, p.id, { silentLot: true });
  }
  const value = sellValue(state, o);
  state.objects.splice(state.objects.indexOf(o), 1);
  if (isStairs(o)) { restoreHole(state, o); invalidate(); recomputeRooms(state); bus?.emit('lot:changed', { level: o.level + 1, kind: 'floor' }); }
  invalidate();
  refund += value;
  if (value) {
    state.household.money += value;
    bus?.emit('money:changed', { money: state.household.money, delta: value, reason: 'sell' });
  }
  bus?.emit('object:removed', { id });
  if (!silentLot) bus?.emit('lot:changed', { level: o.level, kind: 'object' });
  return refund;
}


/**
 * Переставить предмет без покупки/продажи: деньги не трогаем, st (boughtDay, value…) сохраняется.
 * Телефон на переставляемой поверхности едет вместе с ней (та же локальная клетка, поворот вместе с опорой).
 */
export function moveObject(state, bus, id, x, y, rot = 0, level = 0) {
  watchBus(bus);
  const o = state.objects.find(p => p.id === id);
  if (!o) return fail('Нет такого предмета');
  rot = ((rot % 4) + 4) % 4;
  const chk = canPlace(state, o.def, x, y, rot, level, { free: true, ignoreId: id });
  if (!chk.ok) return chk;
  const def = byId[o.def], old = { x: o.x, y: o.y, rot: o.rot, level: o.level };
  // что стоит сверху: запомнить локальные клетки до перестановки
  const riders = [];
  if (isHost(o.def)) {
    const [w, d] = def.fp;
    for (const p of state.objects) {
      if (p.level !== o.level || byId[p.def]?.place !== 'surface') continue;
      for (let ly = 0; ly < d; ly++) for (let lx = 0; lx < w; lx++) {
        const [wx, wy] = toWorld(o, lx, ly);
        if (wx === p.x && wy === p.y) riders.push({ p, lx, ly });
      }
    }
  }
  if (isStairs(o)) restoreHole(state, o);
  Object.assign(o, { x, y, rot, level });
  if (isStairs(o)) { cutHole(state, o); invalidate(); recomputeRooms(state); bus?.emit('lot:changed', { level: level + 1, kind: 'floor' }); }
  for (const { p, lx, ly } of riders) {
    const [nx, ny] = toWorld(o, lx, ly);
    Object.assign(p, { x: nx, y: ny, rot: (p.rot + rot - old.rot + 4) % 4, level });
  }
  invalidate();
  bus?.emit('object:changed', { id });
  for (const { p } of riders) bus?.emit('object:changed', { id: p.id });
  bus?.emit('lot:changed', { level: old.level, kind: 'object' });
  if (level !== old.level) bus?.emit('lot:changed', { level, kind: 'object' });
  return OK;
}
