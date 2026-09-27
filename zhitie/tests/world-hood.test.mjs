// Волна 3 Мира: виды, район, генератор домов, общественные участки, снимки. node --test tests/world*.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';
import { CATALOG, kindOf, byId } from '../data/catalog.js';
import * as W from '../js/world/index.js';

const KINDS_9 = 'fireplace piano guitar telescope aquarium pool_table dartboard video_game pinball treadmill hot_tub grill coffee_maker microwave dishwasher washing_machine toy_box dollhouse kids_bed bunk_bed wardrobe desk_lamp ceiling_lamp sculpture clock flower_vase pool park_bench fountain food_stall cash_register shelf_shop cafe_table gym_machine library_shelf museum_exhibit swing_set sandbox trash_bin_street streetlight hedge tree flowerbed fence'.split(' ');
const NO_SPOT_KINDS = new Set(['smoke_alarm', 'burglar_alarm', 'ceiling_lamp', 'streetlight', 'hedge', 'tree', 'fence', 'desk_lamp']);

// Полная проверка участка: каждая точка каждого предмета достижима от входа
function unreachable(s, from) {
  const bad = [];
  for (const o of s.objects) for (const p of W.useSpots(s, o.id)) {
    if (p.via) continue;
    if (!W.findPath(s, 0, { ...from, level: 0 }, [p])?.reached) bad.push(`${o.def}(${p.x},${p.y},L${p.level}) ${p.slot}`);
  }
  return bad;
}
const kindsOn = s => new Set(s.objects.map(o => kindOf(o.def)));
function beds(s) {
  let n = 0;
  for (const o of s.objects) { const k = kindOf(o.def); n += k === 'bed_double' ? 2 : k === 'bunk_bed' ? 2 : ['bed_single', 'kids_bed', 'crib'].includes(k) ? 1 : 0; }
  return n;
}
const asState = (snap, base) => ({ ...base, lot: snap.lot, objects: snap.objects, sims: snap.sims || [] });

let HOOD_STATE, HOOD_MS;
const hoodState = () => {
  if (!HOOD_STATE) { HOOD_STATE = createState(); const t = performance.now(); W.createHood(HOOD_STATE, { adopt: false }); HOOD_MS = performance.now() - t; }
  return HOOD_STATE;
};

test('виды: у каждого вида каталога есть правило точек (или он без точек)', () => {
  const kinds = new Set([...CATALOG.map(d => kindOf(d.id)), ...KINDS_9]);
  const missing = [...kinds].filter(k => !W.SPOT_RULES[k] && !NO_SPOT_KINDS.has(k) && !['door', 'window', 'painting', 'mirror', 'phone', 'stairs', 'dartboard', 'clock'].includes(k));
  assert.deepEqual(missing, []);
});

test('виды: вариант ведёт себя как базовый (сиденье, поверхность, окно)', () => {
  const chair = CATALOG.find(d => kindOf(d.id) === 'dining_chair' && d.id !== 'dining_chair');
  const table = CATALOG.find(d => kindOf(d.id) === 'dining_table' && d.id !== 'dining_table');
  if (!chair || !table) return;                           // каталог ещё пуст — нечего проверять
  const s = createState(20, 20); s.lot = W.createLot(20, 20);
  const bus = createBus();
  const t = W.placeObject(s, bus, table.id, 5, 5, 0, 0);
  W.placeObject(s, bus, chair.id, 5, 4, 0, 0);
  assert.ok(W.useSpots(s, t).some(p => p.seatId), 'стул-вариант — сиденье у стола-варианта');
  assert.ok(W.canPlace(s, 'phone', 5, 5, 0, 0).ok, 'стол-вариант — поверхность');
});

test('генератор: 30 домов разных составов и размеров — постройка, достижимость, санузел, кухня, кровати', () => {
  const fams = [[{}, {}], [{}, {}, { age: 'child' }, { age: 'child' }, { age: 'baby' }], [{}], [{}, {}, { age: 'child' }], [{}, {}, {}, { age: 'child' }], [{}, { age: 'child' }]];
  const layouts = new Set();
  for (let i = 0; i < 30; i++) {
    const s = createState(), members = fams[i % fams.length], size = [30, 24, 28, 34, 40][i % 5];
    const r = W.generateHouse(s, { seed: 'g' + i, members, tier: (i % 5) / 4, w: size, h: size === 40 ? 30 : size });
    assert.deepEqual(r.missing, [], `дом ${i}`);
    assert.deepEqual(unreachable(s, r.frontDoor), [], `дом ${i}`);
    const k = kindsOn(s);
    assert.ok(k.has('toilet') && (k.has('shower') || k.has('bathtub')) && k.has('fridge') && k.has('stove'), `дом ${i}: санузел/кухня`);
    assert.ok(beds(s) >= members.length, `дом ${i}: кроватей ${beds(s)} < ${members.length}`);
    layouts.add(s.lot.levels.map(L => L.wallH.join('') + L.wallV.join('')).join('|'));
  }
  assert.ok(layouts.size >= 10, `разных планировок ${layouts.size}`);
});

test('район: 10 жилых + 5 общественных, карта, цены, все участки проходят проверки', () => {
  const s = hoodState(), H = s.hood;
  console.log(`createHood: ${HOOD_MS.toFixed(0)} мс`);
  assert.equal(H.lots.filter(l => l.kind === 'res').length, 10);
  assert.deepEqual(H.lots.filter(l => l.kind === 'community').map(l => l.type).sort(), ['cafe', 'gym', 'library', 'park', 'shop']);
  assert.ok(H.families.length >= 12 && H.townies.length >= 6);
  // карта: участки не пересекаются
  for (const a of H.lots) for (const b of H.lots) if (a !== b)
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id}×${b.id}`);
  assert.ok(H.map.streets.length >= 3);
  const layouts = new Set();
  for (const e of H.lots) {
    const snap = e.snapshot, st = asState(snap, s);
    assert.deepEqual(unreachable(st, e.frontDoor), [], e.id);
    for (const sp of e.spawns) assert.ok(W.findPath(st, 0, sp, [e.frontDoor]).reached, `${e.id}: от улицы до входа`);
    if (e.kind === 'res') {
      assert.ok(e.price > W.landPrice(e.w, e.h), `${e.id}: цена`);
      const fam = H.families.find(f => f.id === e.familyId), k = kindsOn(st);
      assert.ok(k.has('toilet') && (k.has('shower') || k.has('bathtub')) && k.has('fridge') && k.has('stove'), `${e.id}: санузел/кухня`);
      if (fam) assert.ok(beds(st) >= fam.members.length, `${e.id}: кровати ${beds(st)} < ${fam.members.length}`);
      layouts.add(snap.lot.levels.map(L => L.wallH.join('') + L.wallV.join('')).join('|'));
    }
  }
  assert.equal(layouts.size, 10, 'все дома разные');
  const k = t => kindsOn(asState(H.lots.find(l => l.type === t).snapshot, s));
  assert.ok(k('cafe').has('dining_chair') || k('cafe').has('cafe_table') || k('cafe').has('dining_table'));
  assert.ok(k('gym').has('shower') && k('library').has('chess'));
  // деньги богатых → роскошь: средняя цена предметов у богатых выше
  const avg = id => { const o = H.lots.find(l => l.id === id).snapshot.objects.filter(x => byId[x.def]?.place === 'floor'); return o.reduce((a, x) => a + byId[x.def].price, 0) / o.length; };
  assert.ok(avg('res2') > avg('res3'), `Самоваровы ${avg('res2').toFixed(0)} > Копейкины ${avg('res3').toFixed(0)}`);
});

test('loadLot: восстановление < 30 мс, снимок туда-обратно сохраняет всё', () => {
  const s = hoodState(), bus = createBus();
  const made = [];
  W.setSimFactory((st, b, spec) => { const id = st.nextId++; st.sims.push({ id, name: spec.name, x: spec.x, y: spec.y, level: 0, motives: {}, queue: [] }); made.push(id); return id; });
  const r2 = W.loadLot(s, bus, 'res2');
  assert.equal(s.hood.activeLotId, 'res2');
  assert.equal(s.sims.length, s.hood.families.find(f => f.id === 'samovar').members.length, 'семья создана фабрикой');
  assert.equal(s.household.familyId, 'samovar');
  // изменить активный участок
  W.placeFree(s, bus, 'plant', { ...r2.spawn, level: 0 });
  s.sims[0].x = 7.25; s.sims[0].motives.hunger = -42; s.household.money -= 123;
  const before = structuredClone({ lot: s.lot, objects: s.objects, sims: s.sims, household: s.household });
  let t = performance.now();
  W.loadLot(s, bus, 'res3');
  const ms = performance.now() - t;
  console.log(`loadLot: ${ms.toFixed(1)} мс`);
  assert.ok(ms < 30);
  assert.equal(s.hood.activeLotId, 'res3');
  t = performance.now();
  W.loadLot(s, bus, 'res2');
  assert.ok(performance.now() - t < 30);
  assert.deepEqual({ lot: s.lot, objects: s.objects, sims: s.sims, household: s.household }, before);
  assert.equal(s.hood.families.find(f => f.id === 'samovar').funds, before.household.money, 'деньги семьи синхронизированы');
  // JSON-сериализуемо
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s.hood)));
  W.setSimFactory(null);
});

test('поездка: жители едут в парк и обратно, дом заморожен', () => {
  const s = hoodState(), bus = createBus();
  W.setSimFactory((st, b, spec) => { const id = st.nextId++; st.sims.push({ id, name: spec.name, x: spec.x, y: spec.y, level: 0 }); return id; });
  W.loadLot(s, bus, 'res4');
  const ids = s.sims.map(x => x.id), money = s.household.money;
  const p = W.loadLot(s, bus, 'park', { bring: ids });
  assert.deepEqual(s.sims.map(x => x.id).sort(), [...ids].sort(), 'в парке — наша семья');
  assert.equal(s.household.money, money, 'кошелёк с собой');
  assert.ok(p.spawns.length >= 2);
  assert.equal(s.hood.lots.find(l => l.id === 'res4').snapshot.sims.length, 0, 'дома никого');
  s.household.money += 50;
  W.loadLot(s, bus, 'res4', { bring: ids });
  assert.deepEqual(s.sims.map(x => x.id).sort(), [...ids].sort(), 'вернулись');
  assert.equal(s.household.money, money + 50);
  assert.ok(!s.hood.lots.find(l => l.id === 'park').snapshot.sims.length);
  W.setSimFactory(null);
});

test('выселение, покупка, въезд', () => {
  const s = hoodState(), bus = createBus(), log = [];
  bus.on('hood:movein', p => log.push(p));
  const e8 = s.hood.lots.find(l => l.id === 'res8');
  const sosny = s.hood.families.find(f => f.id === 'sosny'), f0 = sosny.funds;
  assert.ok(W.evict(s, bus, 'sosny'));
  assert.equal(e8.familyId, null);
  assert.equal(sosny.funds, f0 + e8.price);
  const novik = s.hood.families.find(f => f.id === 'novik');
  assert.equal(W.buyLot(s, 'novik', 'park').ok, false);
  assert.equal(W.buyLot(s, 'novik', 'res2').reason, 'Участок занят');
  novik.funds = 10;
  assert.equal(W.moveIn(s, bus, 'novik', 'res8').reason, 'Не хватает денег');
  novik.funds = e8.price + 1000;
  const r = W.moveIn(s, bus, 'novik', 'res8');
  assert.ok(r.ok);
  assert.equal(s.hood.activeLotId, 'res8');
  assert.equal(s.household.familyId, 'novik');
  assert.equal(s.household.money, 1000);
  assert.equal(novik.lotId, 'res8');
  assert.equal(log.at(-1)?.familyId, 'novik', 'без фабрики — событие hood:movein для Мозга');
});

test('adopt: стартовый дом становится участком res1 семьи Ветровых', () => {
  const s = createState(), bus = createBus();
  W.loadStartLot(s, bus);
  s.sims.push({ id: s.nextId++, name: 'Вера', x: 12, y: 24, level: 0 });
  W.createHood(s);
  assert.equal(s.hood.activeLotId, 'res1');
  assert.equal(s.household.familyId, 'vetrov');
  assert.equal(s.hood.families.find(f => f.id === 'vetrov').simIds.length, 1);
  assert.equal(s.hood.lots.find(l => l.id === 'res1').snapshot, null, 'активный — в state');
  const n = s.objects.length;
  W.loadLot(s, bus, 'cafe');
  W.loadLot(s, bus, 'res1');
  assert.equal(s.objects.length, n);
  assert.equal(s.sims.length, 1);
});

test('addFamily: проверка, умолчания, событие, въезд', () => {
  const s = hoodState(), bus = createBus(), log = [];
  bus.on('hood:changed', p => log.push(p));
  const n0 = s.hood.families.length;
  assert.equal(W.addFamily(s, bus, { name: '', members: [{ name: 'А' }] }), null);
  assert.equal(W.familyError({ name: 'Х', members: [] }), 'В семье 1–8 человек');
  assert.equal(W.familyError({ name: 'Х', members: [{ name: 'Малыш', age: 'child' }] }), 'Нужен хотя бы один взрослый');
  assert.equal(W.familyError({ name: 'Х', members: [{ name: '' }] }), 'У каждого нужно имя');
  assert.equal(W.familyError({ name: 'Х', members: [{ name: 'А', age: 'ancient' }] }), 'Неизвестный возраст');
  assert.equal(s.hood.families.length, n0, 'неверные не добавлены');
  const id = W.addFamily(s, bus, { name: ' Петровы ', members: [{ name: 'Пётр', age: 'adult' }, { name: 'Дед', age: 'elder' }, { name: 'Маша', age: 'child' }] });
  assert.ok(id);
  const f = s.hood.families.find(x => x.id === id);
  assert.equal(f.name, 'Петровы');
  assert.equal(f.funds, 20000);
  assert.equal(f.lotId, null);
  assert.deepEqual(f.simIds, []);
  assert.equal(f.members[1].age, 'adult');
  assert.equal(f.members[1].elder, true);
  assert.deepEqual(log.at(-1), { familyId: id });
  const id2 = W.addFamily(s, bus, { name: 'Ивановы', funds: 5000, members: [{ name: 'Иван' }] });
  assert.notEqual(id2, id);
  assert.equal(s.hood.families.find(x => x.id === id2).funds, 5000);
  assert.equal(W.addFamily({}, bus, { name: 'Х', members: [{ name: 'А' }] }), null, 'без района — null');
  assert.doesNotThrow(() => JSON.stringify(s.hood));
});
