// 🧠 Мозг, волна 3: виды предметов, 10 карьер, ≥ 50 соц. действий, ≥ 60 событий, желания/страхи, район, вечеринка, поездки.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../js/sim/index.js';
import { CATALOG, kindOf, byId } from '../data/catalog.js';
import { INTERACTIONS } from '../data/interactions.js';
import { CAREERS, CHANCE } from '../data/careers.js';
import { SOCIALS } from '../data/socials.js';
import { EVENTS } from '../data/events.js';
import { WANTS, ASPIRATIONS } from '../data/wants.js';
import { CAREER, FIREPLACE, GROCERY, PARTY } from '../js/core/tuning.js';
import { candidates } from '../js/sim/autonomy.js';
import { dailyHood } from '../js/sim/hood.js';
import { stubWorld, stubHouse, findObj, record } from './sim-stub-world.mjs';
import { runRotation, rotationTable } from './sim-harness.mjs';

const full = { hunger: 90, comfort: 90, hygiene: 90, bladder: 90, energy: 90, fun: 90, social: 90, room: 20 };
function house(extra = [], motives = {}, spec = {}) {
  const h = stubHouse({ extra });
  h.state.time.minutes = 8 * 60;
  sim.seed(h.state, 5);
  const id = sim.addSim(h.state, h.bus, { name: 'Тест', x: 10.5, y: 8.5, motives: { ...full, ...motives }, ...spec });
  return { ...h, id, s: h.state.sims.find(x => x.id === id), W: stubWorld };
}
const run = (h, m) => sim.advance(h.state, h.bus, h.W, m);
const obj = (h, def) => ({ kind: 'object', id: findObj(h.state, def).id });
const quiet = s => { s.brain.nextThink = Infinity; };
const variant = kind => CATALOG.find(d => d.kind === kind && d.id !== kind && Object.keys(d.ratings ?? {}).length);

test('виды: каждый вид каталога покрыт, вариант с лучшим рейтингом рекламирует сильнее', () => {
  const kinds = new Set(CATALOG.map(d => kindOf(d.id)));
  for (const k of kinds) assert.ok(Array.isArray(INTERACTIONS[k]), k);
  const best = CATALOG.filter(d => d.kind === 'tv').sort((a, b) => (b.ratings?.fun ?? 0) - (a.ratings?.fun ?? 0))[0];
  if (!best || (best.ratings?.fun ?? 0) <= byId.tv.ratings.fun) return;       // вариантов ТВ ещё нет — нечего сравнивать
  const h = house(['tv'], { fun: -30 });
  const [a, b] = h.state.objects.filter(o => o.def === 'tv');
  b.def = best.id; b.x = a.x; a.x += 1; b.y = a.y + 0;
  const sc = candidates(h.state, h.s).filter(c => c.item.interaction === 'watch');
  const sA = sc.find(c => c.item.objId === a.id).score, sB = sc.find(c => c.item.objId === b.id).score;
  assert.ok(sB > sA, `${best.id} (${best.ratings.fun}) > tv (4): ${sB} vs ${sA}`);
  assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'object', id: b.id }).some(m => m.key === 'watch'), 'меню по виду');
});

test('новые виды: кофеварка, микроволновка, камин (риск пожара), продукты', () => {
  const id = k => CATALOG.find(d => kindOf(d.id) === k).id;
  const h = house(['coffee_maker', 'microwave', 'fireplace', 'cash_register'].map(id).concat('dining_table'), { energy: 20, hunger: 10 });
  const byKind = k => ({ kind: 'object', id: h.state.objects.find(o => kindOf(o.def) === k).id });
  quiet(h.s);
  const e0 = h.s.motives.energy;
  sim.enqueue(h.state, h.bus, h.id, byKind('coffee_maker'), 'drink_coffee');
  h.s.brain.nextThink = 0; run(h, 25); quiet(h.s);
  assert.ok(h.s.motives.energy > e0, 'кофе бодрит');
  const hu = h.s.motives.hunger;
  sim.enqueue(h.state, h.bus, h.id, byKind('microwave'), 'quick_meal');
  run(h, 40);
  assert.ok(h.s.motives.hunger > hu + 20, 'разогретая еда');
  const m = h.state.household.money;
  sim.enqueue(h.state, h.bus, h.id, byKind('cash_register'), 'buy_groceries');
  run(h, 30);
  assert.equal(h.state.household.groceries, GROCERY.pack);
  assert.equal(h.state.household.money, m - 100);
  const fp = h.state.objects.find(o => kindOf(o.def) === 'fireplace');
  sim.enqueue(h.state, h.bus, h.id, byKind('fireplace'), 'light_fire');
  run(h, 30);
  assert.ok(fp.st.lit, 'камин горит');
  const was = FIREPLACE.firePer2Min; FIREPLACE.firePer2Min = 1;
  try { run(h, 4); } finally { FIREPLACE.firePer2Min = was; }
  assert.ok((h.state.lot.fires ?? []).length > 0, 'искра от камина');
});

test('карьеры: 10 треков × 10 уровней, Бизнес точно, якоря L1/L10, ночная смена платит', () => {
  assert.equal(Object.keys(CAREERS).length, 10);
  for (const [k, c] of Object.entries(CAREERS)) {
    assert.equal(c.levels.length, 10, k);
    for (let i = 1; i < 10; i++) assert.ok(c.levels[i].pay >= c.levels[i - 1].pay, `${k} L${i + 1}`);
    assert.ok(c.levels.every(l => l.title && l.hours?.length === 2), k);
    assert.ok(CHANCE[k].length >= 2);
  }
  assert.deepEqual(CAREERS.business.levels.map(l => l.pay), [120, 180, 250, 320, 400, 520, 660, 800, 950, 1200]);
  assert.deepEqual([CAREERS.entertainment.levels[0].pay, CAREERS.entertainment.levels[9].pay], [100, 1400]);
  assert.deepEqual([CAREERS.military.levels[0].pay, CAREERS.military.levels[9].pay], [250, 650]);
  // ночная смена: полиция L1 21–03
  const h = house([], {}, { career: 'law' });
  assert.deepEqual(CAREERS.law.levels[0].hours, [21, 3]);
  run(h, 12 * 60 + 30);                         // 20:30 — машина уже увезла
  assert.ok(h.s.atWork, 'уехал на ночную смену');
  const m = h.state.household.money;
  run(h, 7 * 60);                               // 03:30
  assert.equal(h.s.atWork, null);
  assert.equal(h.state.household.money >= m + CAREERS.law.levels[0].pay - 100, true);
});

test('карточка случая: диалог из двух вариантов, «безопасный» применяет эффект', () => {
  const h = house([], {}, { career: 'business' });
  const dl = record(h.bus, ['dialog']);
  const was = CAREER.chanceCard; CAREER.chanceCard = 1;
  try { run(h, 20); } finally { CAREER.chanceCard = was; }
  const d = dl.find(x => x.options.length === 2 && x.options[0].key === 'a');
  assert.ok(d, 'карточка');
  assert.ok(sim.answer(h.state, h.bus, d.id, 'b'));
});

test('общение: ≥ 50 действий, групповой разговор втягивает третьего, подарок стоит §50, предложение — помолвка', () => {
  assert.ok(SOCIALS.length >= 50, `${SOCIALS.length}`);
  const ANIMS = new Set('idle walk run sit sitIdle sitTalk standUp eat drink sleep lieDown getUp talk phone wave laugh angry cry dance cook wash pickup interact repair read watchTV useComputer toilet shower exercise no yes'.split(' '));
  for (const s of SOCIALS) { assert.ok(ANIMS.has(s.anim) && ANIMS.has(s.targetAnim), s.key); assert.ok(s.label, s.key); }
  const h = house();
  const b = sim.addSim(h.state, h.bus, { name: 'Б', x: 11.5, y: 8.5, motives: { ...full } });
  const c = sim.addSim(h.state, h.bus, { name: 'В', x: 12.5, y: 8.5, motives: { ...full } });
  const [B, C] = [b, c].map(id => h.state.sims.find(s => s.id === id));
  quiet(B); quiet(C);
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: b }, 'group_talk');
  run(h, 3);
  assert.ok(B.reaction && C.reaction?.withId === h.id, 'третий втянут');
  run(h, 15);
  const m = h.state.household.money;
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: b }, 'give_gift');
  run(h, 8);
  assert.equal(h.state.household.money <= m - 50 + 30, true);   // подарок (± желание)
  h.s.rel[b] = B.rel[h.id] = 95;
  const keys = sim.interactionsFor(h.state, h.id, { kind: 'sim', id: b }).map(o => o.key);
  assert.ok(keys.includes('propose') && keys.includes('romantic_kiss') && !keys.includes('play_tag'));
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: b }, 'propose');
  run(h, 10);
  assert.equal(h.s.spouse, b);
});

test('события: ≥ 60, письмо с деньгами, выбор через диалог, планировщик ≤ 3 в день', () => {
  assert.ok(EVENTS.length >= 60, `${EVENTS.length}`);
  const h = house();
  const m = h.state.household.money;
  sim.fireEvent(h.state, h.bus, 'letter_inheritance');
  assert.ok(h.state.household.money >= m + 500);
  const dl = record(h.bus, ['dialog']);
  sim.fireEvent(h.state, h.bus, 'letter_charity');
  const m2 = h.state.household.money;
  assert.ok(sim.answer(h.state, h.bus, dl.at(-1).id, '0'));
  assert.ok(h.state.household.money <= m2 - 100 + 50);
  const ev = record(h.bus, ['event']);
  quiet(h.s);
  run(h, 3 * 1440);
  const perDay = {};
  for (const _ of ev) perDay[_.t] = 1;
  assert.ok(ev.length >= 1 && ev.length <= 9, `событий за 3 дня: ${ev.length}`);
});

test('желания и страхи: ≥ 120, 6 устремлений, утренний бросок 4+3, исполнение даёт очки и награду', () => {
  assert.ok(WANTS.length >= 120, `${WANTS.length}`);
  assert.ok(Object.keys(ASPIRATIONS).filter(k => !ASPIRATIONS[k].kids).length >= 6);
  const h = house([], {}, { skills: { cooking: 0.95 } });
  const W = h.s.wants;
  const typeOf = id => WANTS.find(w => w.id === id).type;
  assert.equal(W.list.filter(i => typeOf(i.id) === 'fear').length, 3);
  assert.equal(W.list.length, 7);
  W.list = [{ id: 'skill_up_cooking', done: false }, { id: 'fear_fire', done: false }];
  const m = h.state.household.money;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'bookshelf'), 'study_cooking');
  run(h, 30);
  assert.ok(W.list[0].done && W.meter > 0, 'желание исполнено');
  assert.ok(h.state.household.money > m);
  const before = W.meter;
  h.bus.emit('fire:start', { x: 0, y: 0 });
  h.state.lot.fires = [{ x: 0, y: 0, level: 0, power: 0.1, age: 0 }];
  h.bus.emit('fire:start', { x: 0, y: 0 });
  assert.ok(W.meter < before, 'страх сбылся');
  // утро: новый бросок
  run(h, 24 * 60);
  assert.equal(W.list.length, 7);
  assert.ok(['platinum', 'gold', 'green', 'red', 'failure'].includes(sim.aspirationLevel(h.s)));
});

test('район: семьи за кадром зарабатывают, горожане из state.hood, вечеринка со звёздами', () => {
  const h = house(['stereo']);
  h.state.hood = { lots: [], families: [{ id: 'f1', funds: 1000, members: [{ name: 'Икс', career: { track: 'business', level: 3 } }] }],
    townies: Array.from({ length: 6 }, (_, i) => ({ id: `ht${i}`, name: `Гость ${i}` })), activeLotId: null };
  dailyHood(h.state, h.bus);
  assert.equal(h.state.hood.families[0].funds, 1000 + CAREERS.business.levels[2].pay);
  run(h, 1);
  assert.equal(h.state.brain.townies[0].id, 'ht0', 'горожане района');
  const n = record(h.bus, ['notify', 'npc:arrive']);
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'phone'), 'throw_party');
  run(h, 20);
  assert.ok(h.state.brain.party, 'вечеринка началась');
  run(h, PARTY.arrive + 10);
  assert.ok(h.state.sims.filter(s => s.npcTask?.party).length >= PARTY.minGuests);
  run(h, PARTY.hours * 60 + 30);
  assert.equal(h.state.brain.party, null);
  assert.ok(n.some(e => e.t === 'notify' && e.text.startsWith('Вечеринка окончена')));
});

test('поездка: «Поехать…/Парк» → семья на общественном участке, горожане рядом, еда за деньги, домой', () => {
  const h = house(['cash_register']);
  const snaps = {};
  const W = {
    ...stubWorld,
    loadLot(state, bus, id, { bring = [] } = {}) {             // как у Мира: снимок + перевозка bring (клонами)
      const go = structuredClone(state.sims.filter(x => bring.includes(x.id)));
      snaps[state.hood.activeLotId] = { objects: state.objects, sims: state.sims.filter(x => !bring.includes(x.id) && !x.npc) };
      const s = snaps[id];
      if (s) { state.objects = s.objects; state.sims = s.sims; }
      else {
        state.objects = ['food_stall_pies', 'park_bench_city', 'fountain_city'].map((def, i) => ({ id: state.nextId++, def, x: 4 + i * 3, y: 6, rot: 0, level: 0, st: { dirty: 0, broken: false, inUse: null } }));
        state.sims = [];
      }
      go.forEach((x, i) => { x.x = 6.5 + i; x.y = 12.5; state.sims.push(x); });
      state.hood.activeLotId = id;
      return { spawn: { x: 6, y: 12 }, spawns: [{ x: 0, y: 29 }, { x: 29, y: 29 }] };
    },
  };
  h.W = W;
  h.state.hood = { lots: [{ id: 'home', kind: 'res' }, { id: 'park', name: 'Парк', kind: 'community', type: 'park' }], families: [], townies: [], activeLotId: 'home' };
  run(h, 1);
  const menu = sim.interactionsFor(h.state, h.id, obj(h, 'phone'));
  assert.ok(menu.some(m => m.key === 'travel:park' && m.label === 'Поехать…/Парк' && !m.disabled));
  const homeObjs = h.state.objects.length;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'phone'), 'travel:park');
  run(h, 20);
  assert.equal(h.state.hood.activeLotId, 'park');
  h.s = h.state.sims.find(x => x.id === h.id);               // Мир перевёз клон
  assert.ok(h.s && !h.s.npc);
  assert.ok(h.state.sims.filter(s => s.npc === 'visitor').length >= 3, 'горожане в парке');
  h.s.motives.hunger = -30; quiet(h.s);
  const m = h.state.household.money;
  sim.enqueue(h.state, h.bus, h.id, { kind: 'object', id: h.state.objects.find(o => kindOf(o.def) === 'food_stall').id }, 'buy_food');
  run(h, 25);
  assert.ok(h.state.household.money <= m - 15 + 30 && h.s.motives.hunger > -30);
  assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'tile', x: 5, y: 12 }).some(a => a.key === 'go_home'));
  sim.enqueue(h.state, h.bus, h.id, { kind: 'tile', x: 5, y: 12 }, 'go_home');
  run(h, 5);
  assert.equal(h.state.hood.activeLotId, 'home');
  assert.equal(h.state.objects.length, homeObjs);
  assert.ok(h.state.sims.some(s => s.id === h.id) && !h.state.sims.some(s => s.npc === 'visitor'));
});

test('ротация: 3 семьи × 7 дней — без смертей, желания сбываются, деньги по карьерам', async () => {
  const r = await runRotation({ days: 7 });
  console.log(`\n── 3 семьи по очереди × 7 дней ──\n${rotationTable(r)}`);
  for (const { f, log, state } of r.runs) {
    assert.equal(log.deaths.length, 0, f.name);
    assert.ok(log.wants >= 3, `${f.name}: желаний ${log.wants}`);
    assert.ok(state.sims.filter(s => !s.npc && s.career).every(s => s.brain.earned > 0), `${f.name}: все работающие получили зарплату`);
  }
  assert.ok(r.ms < 5000, `перф ${r.ms.toFixed(0)} мс`);
});

test('поездка в настоящем районе Мира: парк и обратно, горожане у края улицы', async () => {
  const W = await import('../js/world/index.js');
  const { createState } = await import('../js/core/state.js');
  const { createBus } = await import('../js/core/events.js');
  const state = createState(), bus = createBus();
  const { spawn } = W.loadStartLot(state, bus);
  W.setSimFactory?.((st, b, spec) => sim.addSim(st, b, spec));
  W.createHood(state, { adopt: true });
  sim.seed(state, 9);
  const ids = ['Вера', 'Олег'].map((name, i) => sim.addSim(state, bus, { name, x: spawn.x + 0.5 + i, y: spawn.y + 0.5, motives: { ...full } }));
  sim.advance(state, bus, W, 1);
  const park = state.hood.lots.find(l => l.kind === 'community');
  assert.ok(park, 'в районе есть общественный участок');
  const phone = state.objects.find(o => kindOf(o.def) === 'phone') ?? state.objects.find(o => kindOf(o.def) === 'mailbox');
  const key = `travel:${park.id}`;
  assert.ok(sim.interactionsFor(state, ids[0], { kind: 'object', id: phone.id }).some(m => m.key === key && !m.disabled));
  sim.enqueue(state, bus, ids[0], { kind: 'object', id: phone.id }, key);
  for (let i = 0; i < 60 && state.hood.activeLotId !== park.id; i++) sim.advance(state, bus, W, 1);
  assert.equal(state.hood.activeLotId, park.id);
  assert.ok(ids.every(id => state.sims.some(s => s.id === id)), 'вся семья приехала');
  assert.ok(state.sims.filter(s => s.npc === 'visitor').length >= 3, 'горожане');
  sim.advance(state, bus, W, 60);
  assert.ok(ids.some(id => { const s = state.sims.find(x => x.id === id); return s.act || Object.keys(s.brain.stats).some(k => k !== 'idle' && k !== 'walk'); }), 'чем-то заняты в парке');
  sim.enqueue(state, bus, ids[0], { kind: 'tile', x: 5, y: 5 }, 'go_home');
  sim.advance(state, bus, W, 5);
  assert.notEqual(state.hood.activeLotId, park.id);
  assert.ok(ids.every(id => state.sims.some(s => s.id === id)), 'все дома');
  assert.equal(state.brain.trip, null);
});

test('категории общения и закреплённое желание переживает утро', () => {
  const cats = new Set(['Разговор', 'Шутка', 'Нежность', 'Ссора', 'Игра', 'Романтика', 'Семья', 'Дети']);
  for (const x of SOCIALS) assert.ok(cats.has(x.category), `${x.key}: ${x.category}`);
  const h = house();
  const b = sim.addSim(h.state, h.bus, { name: 'Б', x: 11.5, y: 8.5, motives: { ...full } });
  assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'sim', id: b }).every(m => cats.has(m.category)));
  const W = h.s.wants;
  const wantId = W.list.find(i => WANTS.find(w => w.id === i.id).type === 'want').id;
  const fearId = W.list.find(i => WANTS.find(w => w.id === i.id).type === 'fear').id;
  assert.equal(sim.lockWant(h.state, h.bus, h.id, fearId), false, 'страх не закрепить');
  assert.equal(sim.lockWant(h.state, h.bus, h.id, 'нет_такого'), false);
  const ev = record(h.bus, ['wants:changed']);
  assert.equal(sim.lockWant(h.state, h.bus, h.id, wantId), true);
  assert.ok(ev.length >= 1);
  for (let day = 0; day < 3; day++) {
    quiet(h.s); for (const o of h.state.sims) o.brain.nextThink = Infinity;
    run(h, 24 * 60);
    const it = W.list.find(i => i.id === wantId);
    if (!it) { assert.equal(W.locked, null, 'исполнено → закрепление снято'); break; }
    assert.equal(W.list.length, 7);
    assert.equal(W.locked, wantId);
  }
  assert.equal(sim.lockWant(h.state, h.bus, h.id, null), true);
  assert.equal(W.locked, null);
});
