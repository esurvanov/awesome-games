// Чистая логика интерфейса (без браузера): node --test tests/ui.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockOf, money, motiveColor, hash01 } from '../js/ui/dom.js';
import { layoutPie } from '../js/ui/pie.js';
import { wallLine, segCount, rectOf, tileCount, vertexOf, tileOf } from '../js/ui/build.js';
import { wallSpot, spotFor } from '../js/ui/buy.js';
import { byId } from '../data/catalog.js';

test('часы: день недели и HH:MM', () => {
  assert.deepEqual(clockOf(8 * 60), { day: 0, dow: 'Пн', hh: '08', mi: '00' });
  assert.equal(clockOf(1440 * 6 + 23 * 60 + 59.9).dow, 'Вс');
  assert.equal(clockOf(1440 * 7 + 5).dow, 'Пн');
});

test('деньги с разделителями', () => {
  assert.equal(money(20000), '§20 000');
  assert.equal(money(950), '§950');
});

test('цвет полосок: красный внизу, зелёный вверху', () => {
  assert.match(motiveColor(-100), /^hsl\(0 /);
  assert.match(motiveColor(100), /^hsl\(125 /);
});

test('хэш голоса стабилен и в 0..1', () => {
  assert.equal(hash01(7), hash01(7));
  for (const v of [1, 2, 'Вера', 999]) { const x = hash01(v); assert.ok(x >= 0 && x < 1); }
});

test('круговое меню: пункты по кругу, в пределах экрана', () => {
  const L = layoutPie(6, 5, 5, 1200, 800);
  assert.equal(L.pts.length, 6);
  assert.ok(L.x - L.r > 0 && L.y - L.r > 0, 'центр сдвинут от края');
  assert.ok(Math.abs(L.pts[0].dx) < 1e-9 && L.pts[0].dy < 0, 'первый пункт сверху');
  assert.equal(L.pts[0].side, 'c');
  assert.equal(L.pts[1].side, 'r');
  assert.equal(L.pts[5].side, 'l');
});

test('стена: только по оси, число секций', () => {
  assert.deepEqual(wallLine({ x: 2, y: 3 }, { x: 7, y: 4 }), { x0: 2, y0: 3, x1: 7, y1: 3 });
  assert.deepEqual(wallLine({ x: 2, y: 3 }, { x: 3, y: 9 }), { x0: 2, y0: 3, x1: 2, y1: 9 });
  assert.equal(segCount({ x0: 2, y0: 3, x1: 7, y1: 3 }), 5);
  assert.equal(segCount({ x0: 0, y0: 0, x1: 3, y1: 2 }, true), 10);
});

test('пол: прямоугольник из двух углов', () => {
  const r = rectOf({ x: 5, y: 1 }, { x: 2, y: 4 });
  assert.deepEqual(r, { x0: 2, y0: 1, x1: 5, y1: 4 });
  assert.equal(tileCount(r), 16);
});

test('вершины и клетки из пика', () => {
  assert.deepEqual(vertexOf({ x: 3, y: 4, wx: 3.7, wy: 4.2 }), { x: 4, y: 4 });
  assert.deepEqual(tileOf({ x: 3, y: 4, wx: 3.7, wy: 4.2 }), { x: 3, y: 4 });
});

test('настенные: сторона ребра по курсору (соглашение Мира)', () => {
  // горизонтальное ребро y=10: курсор южнее → клетка (x,10) rot 0, севернее → (x,9) rot 2
  assert.deepEqual(wallSpot({ edge: { dir: 'h', x: 4, y: 10 }, wx: 4.5, wy: 10.3 }), { x: 4, y: 10, rot: 0 });
  assert.deepEqual(wallSpot({ edge: { dir: 'h', x: 4, y: 10 }, wx: 4.5, wy: 9.8 }), { x: 4, y: 9, rot: 2 });
  assert.deepEqual(wallSpot({ edge: { dir: 'v', x: 6, y: 2 }, wx: 6.2, wy: 2.5 }), { x: 6, y: 2, rot: 1 });
  assert.deepEqual(wallSpot({ edge: { dir: 'v', x: 6, y: 2 }, wx: 5.8, wy: 2.5 }), { x: 5, y: 2, rot: 3 });
  // переворот клавишей
  assert.deepEqual(wallSpot({ edge: { dir: 'h', x: 4, y: 10 }, wx: 4.5, wy: 10.3 }, 1), { x: 4, y: 9, rot: 2 });
  assert.equal(wallSpot({ kind: 'tile', x: 1, y: 1 }), null);
});

test('напольные: клетка под курсором и поворот', () => {
  assert.deepEqual(spotFor(byId.sofa, { kind: 'tile', x: 3, y: 4 }, 1), { x: 3, y: 4, rot: 1 });
  assert.equal(spotFor(byId.painting, { kind: 'tile', x: 3, y: 4 }, 0), null);
});

test('подменю: группировка по «/» и столбик наружу', async () => {
  const { groupItems, layoutSub } = await import('../js/ui/pie.js');
  const top = groupItems([{ key: 'a', label: 'Позвонить' }, { key: 'm', label: 'Вызвать…/Мастера' }, { key: 'h', label: 'Вызвать…/Горничную' }]);
  assert.equal(top.length, 2);
  assert.equal(top[1].label, 'Вызвать…');
  assert.deepEqual(top[1].kids.map(k => k.label), ['Мастера', 'Горничную']);
  const up = layoutSub(3, { dx: 0, dy: -90, side: 'c' }, 120);
  assert.ok(up.every((q, i) => q.dy === -90 - 40 * (i + 1) && q.side === 'c'), 'сверху — стопкой вверх');
  const right = layoutSub(2, { dx: 80, dy: 0, side: 'r' }, 120);
  assert.ok(right.every(q => q.dx > 80 + 100 && q.side === 'r'), 'справа — правее кнопки');
});

test('стоимость дома: предметы + стены + пол', async () => {
  const { houseValue } = await import('../js/ui/house.js');
  const st = { objects: [{ def: 'sofa' }, { def: 'tv' }], lot: { levels: [{ wallH: [1, 0], wallV: [3], floor: [2, 0] }] } };
  assert.equal(houseValue(st), 450 + 500 + 10 + 18 + 8);
});

test('общение: категории Мозга → подменю в порядке SOCIAL_CATEGORIES', async () => {
  const { groupSocials, groupItems } = await import('../js/ui/pie.js');
  const cats = { talk: 'Разговор', gossip: 'Разговор', joke: 'Шутка', tickle: 'Шутка', hug: 'Нежность', kiss: 'Романтика', insult: 'Ссора', fight: 'Ссора', greet: 'Разговор', rps: 'Игра' };
  const items = Object.entries(cats).map(([k, c]) => ({ key: k, label: k, category: c }));
  const g = groupItems(groupSocials(items, ['Разговор', 'Шутка', 'Нежность', 'Ссора', 'Игра', 'Романтика']));
  assert.deepEqual(g.map(x => x.label), ['Разговор…', 'Шутка…', 'Нежность…', 'Ссора…', 'Игра…', 'Романтика…']);
  assert.deepEqual(g[0].kids.map(k => k.key), ['talk', 'gossip', 'greet']);
  assert.equal(groupSocials([{ key: 'talk', label: 'Поболтать', category: 'Разговор' }]).length, 1, 'короткий список — без подменю');
});
