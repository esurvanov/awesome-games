// Тесты каталога волны 3 (владелец — 🪑 Каталог). Запуск: node --test tests/catalog*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, WALLS, FLOORS, byId, kindOf } from '../data/catalog.js';
import { EXTRA, WALLS_EXTRA, FLOORS_EXTRA, COLLECTIONS, ROOM_SORT, CAT_SORT, PALETTE, BASE_VARIANT_REF, NEW_IDS } from '../data/catalog-extra.js';

const BASE_IDS = CATALOG.filter(d => !EXTRA.includes(d)).map(d => d.id);
const NEW_KINDS = ('fireplace, piano, guitar, telescope, aquarium, pool_table, dartboard, video_game, pinball, treadmill, hot_tub, grill, ' +
  'coffee_maker, microwave, dishwasher, washing_machine, toy_box, dollhouse, kids_bed, bunk_bed, wardrobe, desk_lamp, ceiling_lamp, ' +
  'sculpture, clock, flower_vase, pool, park_bench, fountain, food_stall, cash_register, shelf_shop, cafe_table, gym_machine, ' +
  'library_shelf, museum_exhibit, swing_set, sandbox, trash_bin_street, streetlight, hedge, tree, flowerbed, fence').split(/,\s*/);
const MOTIVES = ['hunger', 'comfort', 'hygiene', 'bladder', 'energy', 'fun', 'social', 'room'];
const SKILLS = ['cooking', 'mechanical', 'charisma', 'body', 'logic', 'creativity'];
const PLACES = ['floor', 'wall', 'surface'];
const CATS = ['seating', 'surfaces', 'decor', 'electronics', 'appliances', 'plumbing', 'lighting', 'misc', 'build', 'community'];
const ROOMS = ['kitchen', 'bathroom', 'bedroom', 'living', 'study', 'outside', 'any'];
const DEPRS = ['furniture', 'appliances', 'electronics', 'art', 'none'];
const score = d => Object.values(d.ratings).reduce((a, b) => a + b, 0);

test('catalog.js грузится, база 38 + EXTRA вклеен', () => {
  assert.equal(BASE_IDS.length, 38);
  assert.equal(CATALOG.length, 38 + EXTRA.length);
  for (const d of EXTRA) assert.equal(byId[d.id], d);
});

test('цели по количеству: ≥300 предметов, ≥30 стен, ≥30 полов, ~120+ форм', () => {
  assert.ok(EXTRA.length >= 300, `EXTRA ${EXTRA.length}`);
  assert.ok(WALLS_EXTRA.length >= 30, `WALLS_EXTRA ${WALLS_EXTRA.length}`);
  assert.ok(FLOORS_EXTRA.length >= 30, `FLOORS_EXTRA ${FLOORS_EXTRA.length}`);
  assert.ok(EXTRA.filter(d => !d.variantOf).length >= 120);
});

test('id уникальны (включая базу) и в snake_case', () => {
  const seen = new Set();
  for (const d of CATALOG) {
    assert.ok(!seen.has(d.id), `дубль ${d.id}`);
    seen.add(d.id);
  }
  for (const d of EXTRA) assert.match(d.id, /^[a-z][a-z0-9_]*$/, d.id);
});

test('каждое поле на месте и корректно', () => {
  for (const d of EXTRA) {
    const m = `${d.id}`;
    assert.equal(typeof d.name, 'string', m); assert.ok(d.name.length > 3, m);
    assert.ok(Number.isInteger(d.price) && d.price >= 0, m);
    assert.ok(Array.isArray(d.fp) && d.fp.length === 2 && d.fp.every(n => Number.isInteger(n) && n >= 1), m);
    assert.ok(PLACES.includes(d.place), `${m} place ${d.place}`);
    assert.ok(CATS.includes(d.cat), `${m} cat ${d.cat}`);
    assert.ok(ROOMS.includes(d.room), `${m} room ${d.room}`);
    assert.ok(DEPRS.includes(d.depr), `${m} depr ${d.depr}`);
    assert.equal(typeof d.bill, 'boolean', m);
    assert.equal(typeof d.buyable, 'boolean', m);
    assert.equal(typeof d.walkable, 'boolean', m);
    assert.ok(d.ratings && typeof d.ratings === 'object', m);
    for (const [k, v] of Object.entries(d.ratings)) {
      assert.ok(MOTIVES.includes(k), `${m} мотив ${k}`);
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 10, `${m} ${k}=${v}`);
    }
    assert.ok(Array.isArray(d.tags) && d.tags.length > 0, m);
    assert.equal(typeof d.desc, 'string', m);
    assert.ok(d.desc.length >= 20 && d.desc.length <= 260, `${m} desc ${d.desc.length}`);
    if (d.tint !== undefined) assert.match(d.tint, /^#[0-9a-f]{6}$/i, m);
    if (d.skills) for (const s of d.skills) assert.ok(SKILLS.includes(s), `${m} skill ${s}`);
    if (d.place === 'surface') assert.deepEqual(d.fp, [1, 1], `${m} surface fp`);
    if (d.place === 'wall') assert.deepEqual(d.fp, [1, 1], `${m} wall fp`);
  }
});

test('каждый kind валиден (база 38 или новый вид CONTRACT §9), kindOf работает', () => {
  const valid = new Set([...BASE_IDS, ...NEW_KINDS]);
  for (const d of EXTRA) {
    assert.ok(valid.has(d.kind), `${d.id}: kind ${d.kind}`);
    assert.equal(kindOf(d.id), d.kind);
  }
  for (const id of BASE_IDS) assert.equal(kindOf(id), id);
});

test('все новые виды §9 покрыты хотя бы одним предметом', () => {
  const used = new Set(EXTRA.map(d => d.kind));
  const missing = NEW_KINDS.filter(k => !used.has(k));
  assert.deepEqual(missing, []);
});

test('лестницы: внутри kind дороже → сумма рейтингов не меньше (включая базовый предмет)', () => {
  const byKind = {};
  for (const d of CATALOG) if (d.buyable !== false || d.cat === 'community') (byKind[d.kind] ??= []).push(d);
  const bad = [];
  for (const [kind, list] of Object.entries(byKind)) {
    const s = [...list].sort((a, b) => a.price - b.price);
    let best = -1, bestId = null;
    for (let i = 0; i < s.length; i++) {
      // сравниваем с максимумом среди строго более дешёвых
      const cheaper = s.filter(x => x.price < s[i].price);
      const mx = cheaper.reduce((m, x) => Math.max(m, score(x)), -1);
      if (score(s[i]) < mx) bad.push(`${kind}: ${s[i].id} §${s[i].price} (${score(s[i])}) < ${mx}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('цветовые варианты повторяют форму: kind, цену, след, рейтинги, place; у всех есть tint', () => {
  for (const d of EXTRA.filter(x => x.variantOf)) {
    const p = byId[d.variantOf];
    assert.ok(p, `${d.id}: нет формы ${d.variantOf}`);
    assert.ok(!p.variantOf, `${d.id}: вариант варианта`);
    assert.equal(d.kind, kindOf(p.id), d.id);
    assert.equal(d.price, p.price, d.id);
    assert.deepEqual(d.fp, p.fp, d.id);
    assert.deepEqual(d.ratings, p.ratings, d.id);
    assert.equal(d.place, p.place, d.id);
    assert.equal(!!d.portal, !!p.portal, d.id);
    assert.match(d.tint, /^#[0-9a-f]{6}$/i, d.id);
  }
});

test('BASE_REF совпадает с настоящими базовыми предметами', () => {
  for (const [id, ref] of Object.entries(BASE_VARIANT_REF)) {
    const b = byId[id];
    assert.ok(b, id);
    for (const k of ['name', 'price', 'place', 'cat', 'room', 'depr', 'bill']) assert.equal(ref[k], b[k], `${id}.${k}`);
    assert.deepEqual(ref.fp, b.fp, `${id}.fp`);
    assert.deepEqual(ref.ratings, b.ratings, `${id}.ratings`);
    assert.equal(!!ref.portal, !!b.portal, `${id}.portal`);
    assert.equal(!!ref.walkable, !!b.walkable, `${id}.walkable`);
  }
});

test('общественные предметы: cat community ⇔ buyable:false', () => {
  for (const d of EXTRA) assert.equal(d.cat === 'community', d.buyable === false, d.id);
  assert.ok(EXTRA.filter(d => d.cat === 'community').length >= 15);
});

test('покрытие групп из ТЗ', () => {
  const kinds = new Set(EXTRA.map(d => d.kind));
  for (const k of ['dining_chair', 'armchair', 'sofa', 'bed_single', 'bed_double', 'kids_bed', 'bunk_bed', 'dining_table', 'counter',
    'fridge', 'stove', 'microwave', 'coffee_maker', 'dishwasher', 'toilet', 'shower', 'bathtub', 'hot_tub', 'bath_sink', 'kitchen_sink',
    'tv', 'stereo', 'computer_desk', 'video_game', 'pinball', 'phone', 'floor_lamp', 'desk_lamp', 'ceiling_lamp', 'painting',
    'sculpture', 'plant', 'flower_vase', 'rug', 'clock', 'aquarium', 'piano', 'guitar', 'easel', 'telescope', 'chess', 'bookshelf',
    'exercise_bench', 'treadmill', 'pool_table', 'dartboard', 'toy_box', 'dollhouse', 'wardrobe', 'dresser', 'trash_can',
    'washing_machine', 'grill', 'flowerbed', 'hedge', 'tree', 'fence', 'pool', 'swing_set', 'sandbox']) assert.ok(kinds.has(k), k);
  assert.ok(EXTRA.some(d => d.cat === 'lighting' && d.place === 'wall'), 'настенный свет');
  assert.ok(EXTRA.some(d => d.room === 'outside' && d.kind === 'dining_chair'), 'уличный стул');
  assert.ok(EXTRA.some(d => d.room === 'study' && d.kind === 'dining_chair'), 'офисный стул');
});

test('стены и полы: id уникальны и продолжают базовые, есть цена, цвет, узор', () => {
  for (const [all, extra] of [[WALLS, WALLS_EXTRA], [FLOORS, FLOORS_EXTRA]]) {
    const ids = all.map(w => w.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const w of extra) {
      assert.ok(Number.isInteger(w.id) && w.id > 0, `${w.id}`);
      assert.ok(Number.isInteger(w.price) && w.price > 0, w.name);
      assert.match(w.color, /^#[0-9a-f]{6}$/i, w.name);
      assert.equal(typeof w.pattern, 'string');
      assert.ok(w.name.length > 3);
    }
  }
});

test('коллекции, сортировки, палитра', () => {
  assert.ok(Object.keys(COLLECTIONS).length >= 8);
  for (const [k, c] of Object.entries(COLLECTIONS)) {
    assert.ok(c.name && c.icon, k);
    assert.ok(c.ids.length >= 8, `${k}: ${c.ids.length}`);
    for (const id of c.ids) assert.ok(byId[id], `${k}: ${id}`);
  }
  for (const r of ROOM_SORT) assert.ok(r.room && r.name && r.icon);
  for (const c of CAT_SORT) assert.ok(CATS.includes(c.cat));
  for (const [k, [label, hex, quip]] of Object.entries(PALETTE)) {
    assert.ok(label && quip, k); assert.match(hex, /^#[0-9a-f]{6}$/i, k);
  }
});

test('isNew: 35–50 новинок, только формы, список NEW_IDS совпадает', () => {
  const news = EXTRA.filter(d => d.isNew === true);
  for (const d of EXTRA) assert.equal(typeof d.isNew, 'boolean', d.id);
  assert.ok(news.length >= 35 && news.length <= 50, `${news.length}`);
  assert.deepEqual(news.map(d => d.id).sort(), [...NEW_IDS].sort());
  for (const d of news) assert.ok(!d.variantOf && d.buyable, d.id);
});

test('collection: у каждого предмета один валидный ключ, COLLECTIONS.ids = формы с этим ключом', () => {
  for (const d of EXTRA) assert.ok(d.collection in COLLECTIONS, `${d.id}: ${d.collection}`);
  for (const d of EXTRA.filter(x => x.variantOf && byId[x.variantOf].collection)) assert.equal(d.collection, byId[d.variantOf].collection, d.id);
  for (const d of EXTRA) if (d.cat === 'community') assert.equal(d.collection, 'community', d.id);
  const all = Object.values(COLLECTIONS).flatMap(c => c.ids);
  assert.equal(new Set(all).size, all.length, 'форма в двух коллекциях');
  assert.equal(all.length, EXTRA.filter(d => !d.variantOf).length);
  for (const [k, c] of Object.entries(COLLECTIONS)) for (const id of c.ids) assert.equal(byId[id].collection, k, id);
});
