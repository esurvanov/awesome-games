// Волна 2 Мира: этажи, лестница, крыша, placeFree, брони. node --test tests/world*.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';
import * as W from '../js/world/index.js';

const fresh = (w = 20, h = 20) => { const s = createState(w, h); s.lot = W.createLot(w, h); return s; };
const logBus = () => { const bus = createBus(), log = []; for (const t of ['lot:changed', 'money:changed', 'object:added']) bus.on(t, p => log.push([t, p])); return { bus, log }; };
// Коробка 6×6 (вершины 2..8) с полом наверху
function box() {
  const s = fresh(), { bus, log } = logBus();
  W.buildRoom(s, bus, 2, 2, 8, 8, 0);
  return { s, bus, log };
}

test('опора пола этажа 1: комната снизу или ≤2 клетки от стены', () => {
  const { s, bus } = box();
  assert.ok(W.isSupported(s, 5, 5, 1), 'над комнатой');
  assert.ok(W.isSupported(s, 8, 5, 1) && W.isSupported(s, 9, 5, 1), '2 клетки снаружи от стены x=8');
  assert.ok(!W.isSupported(s, 10, 5, 1), '3-я клетка — нет');
  assert.ok(W.isSupported(s, 3, 9, 1) && !W.isSupported(s, 3, 10, 1));
  assert.ok(W.isSupported(s, 1, 0, 1), 'за концом стены вдоль — 1 клетка');
  assert.ok(W.isSupported(s, 0, 5, 1) && !W.isSupported(s, 0, 12, 1));
  const cost = W.paintFloor(s, bus, 0, 0, 15, 15, 1, 1);
  const F = s.lot.levels[1].floor;
  assert.equal(F[5 * 20 + 5], 1);
  assert.equal(F[5 * 20 + 10], 0, 'без опоры не кладётся');
  assert.equal(cost, F.filter(Boolean).length * 10);
});

test('стены этажа 1 — только у пола; предметы — только на полу', () => {
  const { s, bus } = box();
  assert.equal(W.buildWall(s, bus, 3, 3, 6, 3, 1), 0, 'нет пола — нет стены');
  W.paintFloor(s, bus, 3, 3, 6, 6, 1, 1);
  assert.equal(W.buildWall(s, bus, 3, 3, 6, 3, 1), 30);
  assert.equal(W.buildWall(s, bus, 3, 10, 6, 10, 1), 0);
  assert.equal(W.canPlace(s, 'plant', 12, 12, 0, 1).reason, 'Нет пола');
  assert.ok(W.canPlace(s, 'plant', 4, 4, 0, 1).ok);
  W.buildRoom(s, bus, 3, 3, 7, 7, 1);
  assert.equal(s.lot.rooms.filter(r => r.level === 1).length, 1, 'комната наверху');
  const up = W.roomAt(s, 4, 4, 1);
  assert.ok(up > 0 && up !== W.roomAt(s, 4, 4, 0));
  assert.equal(typeof W.roomScore(s, up), 'number');
});

test('лестница: stairsInfo, правила установки, дыра в полу', () => {
  const { s, bus, log } = box();
  W.paintFloor(s, bus, 2, 2, 7, 7, 1, 1);
  // внутри коробки, rot0 (лицо +y): ступени (3, 2..5), низ (3,6) этаж 0, верх (3,1) этаж 1 — за стеной → нельзя
  assert.equal(W.canPlace(s, 'stairs', 3, 2, 0, 0).reason, 'Наверху нет пола');
  // rot2 (лицо −y): ступени (3, 3..6), низ (3,2), верх (3,7)
  const info = W.stairsInfo({ def: 'stairs', x: 3, y: 3, rot: 2, level: 0 });
  assert.deepEqual(info.bottom, { x: 3, y: 2, level: 0 });
  assert.deepEqual(info.top, { x: 3, y: 7, level: 1 });
  assert.deepEqual(info.tiles.map(t => t.y), [3, 4, 5, 6]);
  assert.equal(W.canPlace(s, 'stairs', 3, 3, 2, 1).reason, 'Лестница — только на нижнем этаже');
  W.placeObject(s, bus, 'plant', 3, 7, 0, 1);
  assert.equal(W.canPlace(s, 'stairs', 3, 3, 2, 0).reason, 'Выход сверху занят');
  W.removeObject(s, bus, s.objects.find(o => o.def === 'plant').id);
  const id = W.placeObject(s, bus, 'stairs', 3, 3, 2, 0);
  assert.ok(id);
  const F = s.lot.levels[1].floor;
  assert.deepEqual([3, 4, 5, 6].map(y => F[y * 20 + 3]), [0, 0, 0, 0], 'дыра над пролётом');
  assert.ok(log.some(([t, p]) => t === 'lot:changed' && p.level === 1 && p.kind === 'floor'));
  assert.equal(W.paintFloor(s, bus, 3, 4, 3, 4, 2, 1), 0, 'в дыру пол не кладётся');
  assert.equal(W.canPlace(s, 'plant', 3, 2, 0, 0).reason, 'Загораживает дверь', 'вход лестницы свободен');
  assert.equal(W.buildWall(s, bus, 3, 3, 4, 3, 0), 0, 'не замуровать вход');
  assert.equal(W.buildWall(s, bus, 3, 5, 4, 5, 0), 0, 'не резать пролёт');
  const spots = W.useSpots(s, id);
  assert.deepEqual(spots.map(p => [p.slot, p.x, p.y, p.level]), [['bottom', 3, 2, 0], ['top', 3, 7, 1]]);
  // продажа возвращает пол
  W.removeObject(s, bus, id);
  assert.deepEqual([3, 4, 5, 6].map(y => F[y * 20 + 3]), [1, 1, 1, 1]);
});

test('путь между этажами через лестницу, точки с level, pathToObject', () => {
  const { s, bus } = box();
  W.paintFloor(s, bus, 2, 2, 7, 7, 1, 1);
  const st = W.placeObject(s, bus, 'stairs', 3, 3, 2, 0);
  W.placeObject(s, bus, 'door', 5, 7, 2, 0);             // дверь на юг: ребро wallH(5,8)
  const p = W.findPath(s, 0, { x: 5, y: 12, level: 0 }, [{ x: 6, y: 6, level: 1 }]);
  assert.equal(p.reached, true);
  const jump = p.findIndex(q => q.stairs === st);
  assert.ok(jump > 0);
  assert.deepEqual(p[jump - 1], { x: 3, y: 2, level: 0 });
  assert.deepEqual({ ...p[jump], stairs: undefined }, { x: 3, y: 7, level: 1, stairs: undefined });
  assert.ok(p.slice(jump).every(q => q.level === 1) && p.slice(0, jump).every(q => q.level === 0));
  assert.deepEqual(p.at(-1), { x: 6, y: 6, level: 1 });
  // вниз
  const down = W.findPath(s, 1, { x: 6, y: 6 }, [{ x: 5, y: 12, level: 0 }]);
  assert.equal(down.reached, true);
  assert.equal(down.at(-1).level, 0);
  // по воздуху этажа 1 не ходят
  assert.equal(W.findPath(s, 1, { x: 6, y: 6 }, [{ x: 15, y: 15 }]).reached, false);
  // pathToObject к предмету наверху
  const plant = W.placeObject(s, bus, 'plant', 6, 3, 0, 1);
  const r = W.pathToObject(s, { x: 5, y: 12, level: 0 }, plant);
  assert.ok(r.reached && r.spot.level === 1);
  // бронь двери и лестницы
  const k = W.portalKey(s, p[jump - 1], p[jump]);
  assert.equal(k, `stairs:${st}`);
  const i = p.findIndex((q, j) => j > 0 && W.portalKey(s, p[j - 1], q)?.startsWith('door:'));
  assert.ok(i > 0, 'на пути есть дверь');
  const dk = W.portalKey(s, p[i - 1], p[i]);
  assert.ok(W.reserve(s, dk, 1));
  assert.ok(W.reserve(s, dk, 1), 'повторно тем же — можно');
  assert.ok(!W.reserve(s, dk, 2));
  assert.equal(W.reservedBy(s, dk), 1);
  W.release(s, dk, 2);
  assert.equal(W.reservedBy(s, dk), 1, 'чужой не снимет');
  W.releaseAll(s, 1);
  assert.ok(W.reserve(s, dk, 2));
});

test('крыша: поле по умолчанию, прямоугольники по верхнему этажу, setRoof', () => {
  const s = createState(), { bus, log } = logBus();
  W.loadStartLot(s, bus);
  assert.deepEqual(s.lot.roof, { style: 'gable', color: '#8a4b3a', pitch: 0.5 });
  const R = W.roofFootprints(s);
  const area = L => (R.levels.find(x => x.level === L)?.rects || []).reduce((a, r) => a + r.w * r.h, 0);
  assert.equal(area(1), 30, 'над мастерской');
  assert.equal(area(0), 30 + 35 + 25, 'спальня+гостиная+кухня (ванная и кабинет под мастерской)');
  for (const L of R.levels) for (const r of L.rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++)
    assert.ok(W.roomAt(s, x, y, L.level) > 0, 'крыша только над закрытыми комнатами');
  assert.equal(W.setRoof(s, bus, { style: 'bogus' }), null);
  W.setRoof(s, bus, { style: 'hip', pitch: 0.7 });
  assert.equal(s.lot.roof.style, 'hip');
  assert.equal(s.lot.roof.color, '#8a4b3a');
  assert.ok(log.some(([t, p]) => t === 'lot:changed' && p.kind === 'roof'));
  assert.deepEqual(W.createLot(4, 4).roof, { style: 'gable', color: '#8a4b3a', pitch: 0.5 });
});

test('placeFree: ближайшее годное место, бесплатно', () => {
  const s = createState(), { bus, log } = logBus();
  W.loadStartLot(s, bus);
  const m0 = s.household.money;
  const id = W.placeFree(s, bus, 'tombstone', { x: 13, y: 21, level: 0 });   // внутри занято → ближайшее
  assert.ok(id);
  const o = s.objects.find(x => x.id === id);
  assert.ok(Math.abs(o.x - 13) + Math.abs(o.y - 21) <= 3);
  assert.equal(s.household.money, m0);
  assert.ok(log.some(([t, p]) => t === 'object:added' && p.id === id));
  assert.ok(W.useSpots(s, id).length);
  const crib = W.placeFree(s, bus, 'crib', { x: 11, y: 14, level: 0 });
  assert.ok(crib && W.useSpots(s, crib).some(p => p.slot === 'front'));
  assert.equal(W.placeFree(s, bus, 'nope', { x: 1, y: 1 }), null);
});

test('точки новых предметов', () => {
  const s = fresh(), { bus } = logBus();
  const b = W.placeObject(s, bus, 'exercise_bench', 5, 5, 0, 0);
  assert.deepEqual(W.useSpots(s, b).filter(p => p.slot === 'use').map(p => [p.x, p.y, p.onObject]), [[5, 5, true]]);
  const e = W.placeObject(s, bus, 'easel', 10, 10, 1, 0);
  assert.deepEqual(W.useSpots(s, e).map(p => [p.slot, p.x, p.y]), [['use', 11, 10]]);
  const t = W.placeObject(s, bus, 'tombstone', 2, 12, 0, 0);
  assert.equal(W.useSpots(s, t).length, 4);
  W.buildWall(s, bus, 0, 15, 5, 15, 0);
  for (const id of ['smoke_alarm', 'burglar_alarm']) {
    const a = W.placeObject(s, bus, id, 1, 15, 0, 0);
    assert.ok(a, id);
    assert.deepEqual(W.useSpots(s, a), []);
    W.removeObject(s, bus, a);
  }
});
