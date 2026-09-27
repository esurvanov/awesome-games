// Тесты Мира: node --test tests/world*.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';
import { CATALOG, WALLS, FLOORS } from '../data/catalog.js';
import * as W from '../js/world/index.js';
import { EXTRA } from '../data/catalog-extra.js';
const BASE = new Set(CATALOG.filter(d => !EXTRA.includes(d)).map(d => d.id));

const fresh = (w = 30, h = 30) => { const s = createState(w, h); s.lot = W.createLot(w, h); return s; };
const logBus = () => { const bus = createBus(), log = []; for (const t of ['lot:changed', 'money:changed', 'object:added', 'object:removed', 'object:changed']) bus.on(t, p => log.push([t, p])); return { bus, log }; };

test('индексы рёбер: wallH y*w+x, wallV y*(w+1)+x', () => {
  const s = fresh(10, 8), { bus } = logBus();
  W.buildWall(s, bus, 2, 3, 5, 3, 0);                     // горизонталь: рёбра (2..4, 3)
  const L = s.lot.levels[0];
  assert.deepEqual([2, 3, 4].map(x => L.wallH[3 * 10 + x]), [1, 1, 1]);
  assert.equal(L.wallH[3 * 10 + 5], 0);
  assert.equal(W.isEdgeWall(s, 0, 'h', 4, 3), 1);
  W.buildWall(s, bus, 7, 1, 7, 4, 0, 3);                  // вертикаль: рёбра (7, 1..3), тип кирпич
  assert.deepEqual([1, 2, 3].map(y => L.wallV[y * 11 + 7]), [3, 3, 3]);
  assert.equal(W.isEdgeWall(s, 0, 'v', 7, 0), 0);
  assert.equal(W.isEdgeWall(s, 0, 'v', 99, 0), 0);        // вне участка
  assert.equal(W.wallJoint(s, 0, 7, 2), 2 | 8);           // вершина в середине вертикали: S+N
});

test('стены: цена, деньги, события, снос с возвратом', () => {
  const s = fresh(), { bus, log } = logBus(), m0 = s.household.money;
  const cost = W.buildRoom(s, bus, 2, 2, 6, 5, 0, 2);
  assert.equal(cost, (4 + 4 + 3 + 3) * WALLS[1].price);
  assert.equal(s.household.money, m0 - cost);
  assert.ok(log.some(([t, p]) => t === 'money:changed' && p.delta === -cost));
  assert.ok(log.some(([t, p]) => t === 'lot:changed' && p.kind === 'wall'));
  assert.equal(W.buildRoom(s, bus, 2, 2, 6, 5, 0, 2), 0);  // повтор — бесплатно
  assert.equal(s.lot.rooms.filter(r => r.id).length, 1);
  const back = W.removeWall(s, bus, 2, 2, 6, 2, 0);
  assert.equal(back, 4 * WALLS[1].price);
  assert.equal(s.lot.rooms.filter(r => r.id).length, 0);
  s.household.money = 25;                                  // хватит на 2 сегмента
  assert.equal(W.buildWall(s, bus, 10, 10, 20, 10, 0, 1), 20);
  assert.equal(s.household.money, 5);
});

test('полы: цена за клетку, 0 снимает бесплатно', () => {
  const s = fresh(), { bus } = logBus(), m0 = s.household.money;
  const c = W.paintFloor(s, bus, 3, 3, 5, 4, 2, 0);
  assert.equal(c, 6 * FLOORS[1].price);
  assert.equal(s.household.money, m0 - c);
  assert.equal(W.paintFloor(s, bus, 3, 3, 5, 4, 2, 0), 0);
  assert.equal(W.paintFloor(s, bus, 3, 3, 3, 3, 0, 0), 0);
  assert.equal(s.lot.levels[0].floor[3 * 30 + 3], 0);
  assert.equal(W.paintFloor(s, bus, 3, 3, 4, 4, 1, 1), 0, 'этаж 1 без опоры — нельзя');
});

test('canPlace: границы, поворот, наложение, стена внутри, дверь, поверхность, этаж', () => {
  const s = fresh(10, 10), { bus } = logBus();
  assert.ok(W.canPlace(s, 'sofa', 8, 0, 0, 0).ok);         // 2×1 у правого края
  assert.ok(!W.canPlace(s, 'sofa', 9, 0, 0, 0).ok);
  assert.ok(W.canPlace(s, 'sofa', 9, 0, 1, 0).ok);         // rot1 → 1×2 помещается
  assert.ok(!W.canPlace(s, 'sofa', 9, 9, 1, 0).ok);
  const id = W.placeObject(s, bus, 'bed_double', 2, 2, 0, 0);
  assert.ok(id);
  assert.equal(W.canPlace(s, 'armchair', 3, 3, 0, 0).reason, 'Место занято');
  assert.ok(W.canPlace(s, 'rug', 2, 2, 0, 0).ok, 'ковёр под кроватью можно');
  W.buildWall(s, bus, 6, 5, 6, 7, 0);                      // вертикальная стена x=6
  assert.equal(W.canPlace(s, 'sofa', 5, 5, 0, 0).reason, 'Мешает стена');
  assert.ok(W.canPlace(s, 'sofa', 5, 5, 1, 0).ok, 'повёрнутый вдоль стены — можно');
  // настенные: нужна стена; rot1 → западное ребро клетки
  assert.equal(W.canPlace(s, 'window', 3, 6, 0, 0).reason, 'Нужна стена');
  assert.ok(W.canPlace(s, 'painting', 6, 5, 1, 0).ok);     // смотрит в клетку (6,5), ребро wallV(6,5)
  assert.ok(W.canPlace(s, 'painting', 5, 5, 3, 0).ok);     // с другой стороны того же ребра
  assert.ok(W.placeObject(s, bus, 'door', 6, 6, 1, 0));
  assert.equal(W.canPlace(s, 'window', 5, 6, 3, 0).reason, 'Место на стене занято');
  assert.equal(W.canPlace(s, 'plant', 5, 6, 0, 0).reason, 'Загораживает дверь');
  // поверхность
  assert.equal(W.canPlace(s, 'phone', 0, 9, 0, 0).reason, 'Нужна поверхность');
  W.placeObject(s, bus, 'counter', 0, 9, 0, 0);
  assert.ok(W.canPlace(s, 'phone', 0, 9, 0, 0).ok);
  // этаж 1 без пола, деньги, житель
  assert.equal(W.canPlace(s, 'plant', 0, 0, 0, 1).reason, 'Нет пола');
  s.sims.push({ id: 99, x: 8.5, y: 8.5, level: 0 });
  assert.equal(W.canPlace(s, 'plant', 8, 8, 0, 0).reason, 'Мешает житель');
  s.household.money = 10;
  assert.equal(W.canPlace(s, 'tv', 0, 0, 0, 0).reason, 'Не хватает денег');
});

test('поворот футпринта и лицевой стороны', () => {
  const def = CATALOG.find(d => d.id === 'bathtub');
  assert.deepEqual(W.rectOf(def, 4, 4, 0), { X: 4, Y: 4, W: 2, D: 1 });
  assert.deepEqual(W.rectOf(def, 4, 4, 3), { X: 4, Y: 4, W: 1, D: 2 });
  const s = fresh(), { bus } = logBus();
  for (const [rot, fx, fy] of [[0, 4, 5], [1, 5, 4], [2, 4, 3], [3, 3, 4]]) {
    const id = W.placeObject(s, bus, 'fridge', 4, 4, rot, 0);
    const sp = W.useSpots(s, id);
    assert.deepEqual([sp[0].x, sp[0].y], [fx, fy], `rot ${rot}`);
    W.removeObject(s, bus, id);
  }
});

test('продажа: в тот же день 100 %, потом амортизация или st.value', () => {
  const s = fresh(), { bus, log } = logBus(), m0 = s.household.money;
  const id = W.placeObject(s, bus, 'tv', 1, 1, 0, 0);
  assert.equal(s.household.money, m0 - 500);
  assert.ok(log.some(([t, p]) => t === 'object:added' && p.id === id));
  assert.equal(W.removeObject(s, bus, id), 500);
  const id2 = W.placeObject(s, bus, 'tv', 1, 1, 0, 0);
  s.time.minutes += 24 * 60;
  assert.equal(W.removeObject(s, bus, id2), 375);
  const id3 = W.placeObject(s, bus, 'sofa', 1, 1, 0, 0);
  s.time.minutes += 24 * 60;
  s.objects.find(o => o.id === id3).st.value = 123;
  assert.equal(W.removeObject(s, bus, id3), 123);
  // стол уносит телефон
  const t = W.placeObject(s, bus, 'counter', 5, 5, 0, 0), ph = W.placeObject(s, bus, 'phone', 5, 5, 0, 0);
  assert.equal(W.removeObject(s, bus, t), 150 + 50);
  assert.ok(!s.objects.some(o => o.id === ph));
});

test('путь: обход стены через дверь', () => {
  const s = fresh(12, 12), { bus } = logBus();
  W.buildWall(s, bus, 6, 0, 6, 12, 0);                     // сплошная стена x=6
  const blocked = W.findPath(s, 0, { x: 2, y: 5 }, [{ x: 9, y: 5 }]);
  assert.equal(blocked.reached, false, 'без двери не дойти');
  assert.ok(blocked.length > 0, 'частичный путь к стене');
  assert.equal(blocked.at(-1).x, 5, 'упёрся в стену с нашей стороны');
  W.placeObject(s, bus, 'door', 6, 9, 1, 0);               // дверь в wallV(6,9)
  const p = W.findPath(s, 0, { x: 2.4, y: 5.7 }, [{ x: 9, y: 5 }]);
  assert.equal(p.reached, true);
  assert.ok(p.some(c => c.x === 5 && c.y === 9) && p.some(c => c.x === 6 && c.y === 9), 'идёт через дверь');
  for (let i = 1; i < p.length; i++) assert.ok(!(p[i - 1].x === 5 && p[i].x === 6 && p[i].y !== 9), 'стену не проходит');
});

test('путь: не срезает углы у стен и мебели', () => {
  const s = fresh(10, 10), { bus } = logBus();
  W.buildWall(s, bus, 5, 5, 5, 6, 0);                      // один сегмент wallV(5,5)
  const p = W.findPath(s, 0, { x: 4, y: 5 }, [{ x: 5, y: 4 }]);
  assert.equal(p.reached, true);
  assert.equal(p.length, 2, 'диагональ (4,5)→(5,4) запрещена: вершина (5,5) со стеной');
  const q = W.findPath(s, 0, { x: 1, y: 1 }, [{ x: 2, y: 2 }]);
  assert.equal(q.length, 1, 'на открытом месте диагональ');
  W.placeObject(s, bus, 'plant', 2, 1, 0, 0);
  const r = W.findPath(s, 0, { x: 1, y: 1 }, [{ x: 2, y: 2 }]);
  assert.equal(r.length, 2, 'мимо растения не по диагонали');
  // ковёр проходим
  W.placeObject(s, bus, 'rug', 7, 7, 0, 0);
  assert.equal(W.findPath(s, 0, { x: 6, y: 7 }, [{ x: 9, y: 7 }]).length, 3);
});

test('путь: частичный путь, ближайшая из целей, цель на занятой клетке', () => {
  const s = fresh(10, 10), { bus } = logBus();
  W.buildRoom(s, bus, 6, 6, 9, 9, 0);                       // закрытая коробка
  const p = W.findPath(s, 0, { x: 0, y: 0 }, [{ x: 7, y: 7 }]);
  assert.equal(p.reached, false);
  const last = p.at(-1);
  assert.ok(Math.max(Math.abs(last.x - 7), Math.abs(last.y - 7)) <= 2, 'подошёл вплотную к коробке');
  const two = W.findPath(s, 0, { x: 0, y: 0 }, [{ x: 5, y: 0 }, { x: 0, y: 2 }]);
  assert.deepEqual(two.at(-1), { x: 0, y: 2, level: 0 });
  assert.equal(W.findPath(s, 0, { x: 3, y: 3 }, [{ x: 3, y: 3 }]).length, 0);
  assert.equal(W.findPath(s, 0, { x: 3, y: 3 }, []), null);
  const sofa = W.placeObject(s, bus, 'sofa', 1, 4, 0, 0);
  const seat = W.useSpots(s, sofa).find(x => x.slot === 'sit');
  const q = W.findPath(s, 0, { x: 4, y: 4 }, [seat]);
  assert.equal(q.reached, true);
  assert.equal(q.filter(c => c.y === 4 && c.x <= 2).length, 1, 'на диван — только последним шагом');
});

test('стартовый дом: все id каталога, комнаты, оценки', () => {
  const s = createState(), { bus, log } = logBus();
  const { frontDoor } = W.loadStartLot(s, bus);
  const used = new Set(s.objects.map(o => o.def));
  const skip = new Set(['crib', 'tombstone', 'burglar_alarm']);   // ставятся по сюжету / покупкой
  // базовые виды (38 исходных id); варианты из catalog-extra ставит генератор по виду и ярусу цены
  for (const d of CATALOG) if (d.kind === d.id && BASE.has(d.id) && !skip.has(d.id)) assert.ok(used.has(d.id), `нет ${d.id}`);
  const rooms = s.lot.rooms.filter(r => r.id);
  assert.equal(rooms.filter(r => r.level === 0).length, 5, 'спальня, ванная, кабинет, гостиная, кухня');
  assert.equal(rooms.filter(r => r.level === 1).length, 1, 'мастерская наверху');
  assert.equal(W.roomAt(s, frontDoor.x, frontDoor.y, 0), 0);
  assert.notEqual(W.roomAt(s, 12, 21, 0), W.roomAt(s, 12, 16, 0));
  for (const r of rooms) assert.ok(W.roomScore(s, r.id) > 0, `комната ${r.id} уютная`);
  assert.equal(log.filter(([t]) => t === 'object:added').length, s.objects.length);
  // грязь снижает оценку
  const bath = W.roomAt(s, 16, 13, 0), before = W.roomScore(s, bath);
  s.objects.find(o => o.def === 'toilet').st.dirty = 100;
  assert.ok(W.roomScore(s, bath) < before);
});

test('стартовый дом: каждая точка использования достижима от входной двери', () => {
  const s = createState(), { bus } = logBus();
  const { frontDoor } = W.loadStartLot(s, bus);
  for (const o of s.objects) {
    const spots = W.useSpots(s, o.id);
    if (o.def === 'smoke_alarm') { assert.equal(spots.length, 0); continue; }
    assert.ok(spots.length, `${o.def}#${o.id}: нет точек`);
    for (const sp of spots) {
      const p = W.findPath(s, 0, frontDoor, [sp]);
      assert.ok(p?.reached, `${o.def}#${o.id} ${sp.slot} (${sp.x},${sp.y}) недостижима`);
    }
  }
  const tv = s.objects.find(o => o.def === 'tv');
  assert.ok(W.useSpots(s, tv.id).some(x => x.slot === 'sit' && s.objects.find(o => o.id === x.seatId)?.def === 'sofa'), 'смотреть ТВ с дивана');
  const table = s.objects.find(o => o.def === 'dining_table');
  assert.equal(W.useSpots(s, table.id).filter(x => x.seatId).length, 2, 'два стула у стола');
  const r = W.pathToObject(s, frontDoor, s.objects.find(o => o.def === 'fridge').id);
  assert.ok(r.reached && r.spot.slot === 'front');
});

test('moveObject: без денег, сохраняет st, телефон едет с опорой, события', () => {
  const s = fresh(12, 12), { bus, log } = logBus();
  const t = W.placeObject(s, bus, 'coffee_table', 2, 2, 0, 0), ph = W.placeObject(s, bus, 'phone', 3, 2, 0, 0);
  const obj = s.objects.find(o => o.id === t), phone = s.objects.find(o => o.id === ph);
  obj.st.value = 77; const bd = obj.st.boughtDay, m0 = s.household.money;
  log.length = 0;
  assert.deepEqual(W.moveObject(s, bus, t, 3, 2, 0, 0), { ok: true, reason: '' }, 'сдвиг на себя самого — можно');
  assert.deepEqual([phone.x, phone.y], [4, 2]);
  assert.ok(W.moveObject(s, bus, t, 6, 6, 1, 0).ok);        // поворот: 1×2
  assert.deepEqual([obj.x, obj.y, obj.rot], [6, 6, 1]);
  assert.ok(W.useSpots(s, ph).length, 'телефон остался на опоре');
  assert.ok(phone.x === 6 && (phone.y === 6 || phone.y === 7) && phone.rot === 1);
  assert.equal(s.household.money, m0);
  assert.equal(obj.st.value, 77); assert.equal(obj.st.boughtDay, bd);
  assert.ok(log.some(([t2, p]) => t2 === 'object:changed' && p.id === t));
  assert.ok(log.some(([t2, p]) => t2 === 'object:changed' && p.id === ph));
  assert.ok(log.some(([t2]) => t2 === 'lot:changed'));
  assert.ok(!log.some(([t2]) => t2 === 'money:changed'));
  // отказ: занято / нет денег не мешает
  W.placeObject(s, bus, 'plant', 0, 0, 0, 0);
  assert.equal(W.moveObject(s, bus, t, 0, 0, 0, 0).reason, 'Место занято');
  assert.deepEqual([obj.x, obj.y], [6, 6], 'при отказе не двигается');
  s.household.money = 0;
  assert.ok(W.moveObject(s, bus, t, 8, 8, 0, 0).ok);
  const around = W.findPath(s, 0, { x: 7, y: 8 }, [{ x: 10, y: 8 }]);
  assert.ok(around.reached && !around.some(c => c.y === 8 && (c.x === 8 || c.x === 9)), 'сетка обновилась: идёт в обход');
  // настенный: переставить окно на другое ребро
  s.household.money = 5000;
  W.buildWall(s, bus, 0, 10, 6, 10, 0);
  const win = W.placeObject(s, bus, 'painting', 1, 10, 0, 0);
  assert.equal(W.moveObject(s, bus, win, 1, 5, 0, 0).reason, 'Нужна стена');
  assert.ok(W.moveObject(s, bus, win, 2, 9, 2, 0).ok, 'на другую сторону той же стены');
});
