// 🧠 Мозг: модульные тесты. node --test tests/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../js/sim/index.js';
import { decayRates, motiveTick } from '../js/sim/motives.js';
import { candidates, pick, curve } from '../js/sim/autonomy.js';
import { careerTick, shiftOf } from '../js/sim/career.js';
import { DECAY, TIME, MONEY, PRIORITY } from '../js/core/tuning.js';
import { CATALOG, kindOf } from '../data/catalog.js';
import { INTERACTIONS } from '../data/interactions.js';
import { stubWorld, stubHouse, findObj, record } from './sim-stub-world.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const full = { hunger: 90, comfort: 90, hygiene: 90, bladder: 90, energy: 90, fun: 90, social: 90, room: 20 };
function house(motives = {}, spec = {}) {
  const h = stubHouse();
  h.state.time.minutes = 8 * 60;                 // тесты привязаны к 08:00, не к старту createState
  sim.seed(h.state, 7);
  const id = sim.addSim(h.state, h.bus, { name: 'Тест', x: 10.5, y: 8.5, motives: { ...full, ...motives }, ...spec });
  return { ...h, id, s: h.state.sims.find(x => x.id === id) };
}

// ── §2.1 распад ───────────────────────────────────────────────────────
test('распад потребностей = TS1 §2.1', () => {
  const s = { motives: { ...full, hunger: 100 }, personality: { active: 8, outgoing: 0 } };
  let r = decayRates(s);
  near(r.hunger, 12.6); near(r.comfort, 12); near(r.hygiene, 5.1); near(r.energy, 11.25); near(r.fun, 7.5);
  near(r.bladder, 9 + 0.3 * 12.6); near(r.social, 1.65);
  s.motives.hunger = 0; s.personality = { active: 3, outgoing: 10 };
  r = decayRates(s);
  near(r.hunger, 6.3); near(r.comfort, 18); near(r.social, 5.4);
  s.personality.active = 6.66; near(decayRates(s).comfort, 15);
  r = decayRates(s, { asleep: true });
  near(r.hygiene, 2.4); near(r.bladder, 4.5 + 0.3 * 6.3); near(r.fun, 0); near(r.energy, 0);
  near(decayRates(s, { asleep: true, passedOut: true }).energy, -DECAY.energy.passedOutGain);
});

test('тик раз в 2 минуты: за час веселье −7.5, энергия −11.25', () => {
  const { state, bus, s } = house();
  s.brain.nextThink = Infinity;                  // без автономии
  sim.advance(state, bus, stubWorld, 60);
  near(s.motives.fun, 90 - 7.5, 1e-6);
  near(s.motives.energy, 90 - 11.25, 1e-6);
  assert.equal(TIME.tickMinutes, 2);
});

test('настроение = среднее 8 потребностей', () => {
  near(sim.mood({ motives: { hunger: 80, comfort: 0, hygiene: -40, bladder: 40, energy: 0, fun: 0, social: 0, room: 0 } }), 10);
  assert.deepEqual(sim.MOTIVES, ['hunger', 'comfort', 'hygiene', 'bladder', 'energy', 'fun', 'social', 'room']);
});

// ── Автономия ─────────────────────────────────────────────────────────
test('кривая оценки убывает, крутая внизу', () => {
  assert.ok(curve('hunger', -100) > curve('hunger', -50) && curve('hunger', -50) > curve('hunger', 0));
  assert.ok(curve('hunger', -100) - curve('hunger', -50) > curve('hunger', 50) - curve('hunger', 100));
});

test('голодный выбирает еду (холодильник/плита)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { state, s } = house({ hunger: -60 });
    sim.seed(state, seed);
    const c = pick(state, candidates(state, s));
    assert.equal(c.motive, 'hunger', `seed ${seed}: ${c.item.interaction}`);
    assert.ok(['fridge', 'stove'].includes(state.objects.find(o => o.id === c.item.objId).def));
  }
});

test('уставший ночью идёт в кровать', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { state, s } = house({ energy: -60 });
    state.time.minutes = 23 * 60;
    sim.seed(state, seed);
    const c = pick(state, candidates(state, s));
    assert.equal(c.item.interaction, 'sleep', `seed ${seed}`);
    assert.equal(findObj(state, 'bed_single').def, state.objects.find(o => o.id === c.item.objId).def);
  }
});

test('top-4 взвешенный случай детерминирован сидом', () => {
  const run = seed => {
    const { state, s } = house({ fun: -20, social: -10, comfort: 10, hygiene: 20 });
    sim.seed(state, seed);
    const list = candidates(state, s);
    return Array.from({ length: 40 }, () => pick(state, list).item.interaction).join();
  };
  assert.equal(run(123), run(123));
  assert.notEqual(run(123), run(999));
  const { state, s } = house({ fun: -20, social: -10, comfort: 10, hygiene: 20 });
  const top = [...candidates(state, s)].sort((a, b) => b.score - a.score).slice(0, 4).map(c => c.item.interaction);
  for (let i = 0; i < 50; i++) assert.ok(top.includes(pick(state, candidates(state, s)).item.interaction));
});

test('в плохом настроении — без навыков', () => {
  const { state, s } = house({ fun: -100, hunger: -30, energy: -40, hygiene: -60, social: -50, comfort: -40 });
  assert.ok(sim.mood(s) < -10);
  assert.ok(!candidates(state, s).some(c => c.item.interaction.startsWith('study')));
  const menu = sim.interactionsFor(state, s.id, { kind: 'object', id: findObj(state, 'bookshelf').id });
  assert.equal(menu.find(m => m.key === 'study_cooking').reason, 'Плохое настроение');
});

// ── Очередь ───────────────────────────────────────────────────────────
test('команда игрока вытесняет автономию, отмена → выходная анимация', () => {
  const { state, bus, s } = house({ fun: -50 });
  const anims = record(bus, ['sim:anim']);
  const tv = findObj(state, 'tv');
  s.queue.push({ uid: 999, objId: tv.id, interaction: 'watch', by: 'auto', prio: PRIORITY.auto, target: { kind: 'object', id: tv.id } });
  sim.advance(state, bus, stubWorld, 15);
  assert.equal(s.act.key, 'watch'); assert.equal(s.act.phase, 'loop');
  const uid = sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'shower').id }, 'shower');
  assert.ok(uid);
  assert.equal(s.queue[1].uid, uid);
  assert.equal(s.act.cancel, true);
  sim.advance(state, bus, stubWorld, 3);
  assert.equal(s.act.key, 'shower');
  // сон → отмена игроком → getUp
  const bed = findObj(state, 'bed_single');
  s.motives.energy = 0;                                    // иначе утром сразу «выспался»
  const u2 = sim.enqueue(state, bus, s.id, { kind: 'object', id: bed.id }, 'sleep');
  sim.cancel(state, bus, s.id, s.act.uid);
  sim.advance(state, bus, stubWorld, 40);
  assert.equal(s.act?.key, 'sleep');
  assert.equal(s.posture, 'lie');
  sim.cancel(state, bus, s.id, u2);
  sim.advance(state, bus, stubWorld, 0.5);
  assert.equal(s.anim, 'getUp');
  sim.advance(state, bus, stubWorld, 2);
  assert.ok(!s.queue.some(q => q.uid === u2));
  assert.ok(anims.some(a => a.anim === 'lieDown') && anims.some(a => a.anim === 'getUp'));
});

test('отмена ещё не начатого — просто убирает из очереди', () => {
  const { state, bus, s } = house();
  const a = sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'tv').id }, 'watch');
  const b = sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'sofa').id }, 'sit');
  assert.ok(sim.cancel(state, bus, s.id, b));
  assert.deepEqual(s.queue.map(q => q.uid), [a]);
});

// ── Деньги ────────────────────────────────────────────────────────────
test('амортизация в полночь и счета через 3 дня (3 %)', () => {
  const { state, bus, s } = house();
  s.brain.nextThink = Infinity;
  const fridge = findObj(state, 'fridge');
  sim.advance(state, bus, stubWorld, 16 * 60 + 1);         // первая полночь
  near(fridge.st.value, 600 * (1 - MONEY.depr.first.appliances));
  assert.equal(state.household.bills.length, 0);
  sim.advance(state, bus, stubWorld, 2 * 1440);            // день 3
  assert.equal(state.household.bills.length, 1);
  const expected = Math.round(state.objects.reduce((t, o) => t + (CATALOG.find(d => d.id === o.def).bill ? o.st.value : 0), 0) * 0.03);
  assert.equal(state.household.bills[0].amount, expected);
  // оплата у почтового ящика
  const money = state.household.money;
  s.brain.nextThink = 0;
  sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'mailbox').id }, 'pay_bills');
  sim.advance(state, bus, stubWorld, 20);
  assert.equal(state.household.bills.length, 0);
  assert.equal(state.household.money, money - expected);
});

// ── Работа ────────────────────────────────────────────────────────────
test('карпул → работа → зарплата; 2 пропуска подряд → увольнение', () => {
  const { state, bus, s } = house({}, { career: 'business' });
  const money0 = state.household.money;
  sim.advance(state, bus, stubWorld, 20);
  assert.ok(s.atWork, 'уехал на работу');
  sim.advance(state, bus, stubWorld, 7 * 60);
  assert.equal(s.atWork, null);
  assert.equal(state.household.money, money0 + 120);
  // пропуски: время прыжком за начало смены без посадки
  for (const day of [1, 2]) {
    state.time.minutes = shiftOf(s.career ?? { track: 'business', level: 1 }, day).start + 1;
    careerTick(state, bus, s);
  }
  assert.equal(s.career, null);
});

test('ускорения ×1/×3/×10 и авто-ультра', () => {
  const { state, bus, s } = house();
  s.brain.nextThink = Infinity;
  const t0 = state.time.minutes;
  sim.tick(state, bus, stubWorld, 0.2); near(state.time.minutes - t0, 0.2);
  state.time.speed = 3; sim.tick(state, bus, stubWorld, 0.2); near(state.time.minutes - t0, 2.2);
  state.time.speed = 0; sim.tick(state, bus, stubWorld, 0.2); near(state.time.minutes - t0, 2.2);
  state.mode = 'buy'; state.time.speed = 1; sim.tick(state, bus, stubWorld, 0.2); near(state.time.minutes - t0, 2.2);
  state.mode = 'live'; s.asleep = true; sim.tick(state, bus, stubWorld, 0.1);
  near(state.time.minutes - t0, 2.2 + 0.1 * TIME.autoUltra); assert.equal(state.brain.ultra, true);
});

// ── Общение ───────────────────────────────────────────────────────────
test('меню общения фильтруется отношениями; разговор поднимает отношения', () => {
  const { state, bus, s } = house({ social: -20 });
  const id2 = sim.addSim(state, bus, { name: 'Друг', x: 14.5, y: 9.5, motives: { ...full } });
  const t = state.sims.find(x => x.id === id2);
  t.brain.nextThink = Infinity;
  const keys = sim.interactionsFor(state, s.id, { kind: 'sim', id: id2 }).map(o => o.key);
  assert.ok(keys.includes('talk') && keys.includes('hug') && !keys.includes('kiss'));
  assert.equal(sim.interactionsFor(state, s.id, { kind: 'sim', id: s.id }).length, 0);
  const r0 = sim.getRel(t, s.id);
  sim.enqueue(state, bus, s.id, { kind: 'sim', id: id2 }, 'talk');
  sim.advance(state, bus, stubWorld, 5);
  assert.equal(t.reaction?.anim, 'talk');
  sim.advance(state, bus, stubWorld, 25);
  assert.ok(sim.getRel(t, s.id) > r0, 'отношение выросло');
  assert.ok(s.motives.social > -20);
});

// ── Провалы ───────────────────────────────────────────────────────────
test('провалы: лужа, обморок, голодная смерть', () => {
  const { state, bus, s } = house({ bladder: -99.9, energy: -99.9 });
  s.brain.nextThink = Infinity;
  sim.advance(state, bus, stubWorld, 2);
  assert.equal(state.lot.puddles.length, 1);
  assert.equal(s.motives.bladder, 100);
  assert.equal(s.act?.key, 'pass_out');
  assert.equal(s.asleep, true);
  const menu = sim.interactionsFor(state, s.id, { kind: 'tile', ...state.lot.puddles[0] }).map(m => m.key);
  assert.ok(menu.includes('clean_puddle'));
  s.motives.hunger = -99.99;
  sim.advance(state, bus, stubWorld, 2);
  assert.equal(s.dead, true);
});

// ── Данные ────────────────────────────────────────────────────────────
const ANIMS = new Set('idle walk run sit sitIdle sitTalk standUp eat drink sleep lieDown getUp talk phone wave laugh angry cry dance cook wash pickup interact repair read watchTV useComputer toilet shower exercise no yes'.split(' '));
test('interactions: у каждого id каталога есть запись, анимации из CONTRACT', () => {
  for (const d of CATALOG) assert.ok(Array.isArray(INTERACTIONS[kindOf(d.id)]), `${d.id} (вид ${kindOf(d.id)})`);
  for (const [id, list] of Object.entries(INTERACTIONS)) for (const it of list) {
    const steps = it.steps ?? [it];
    for (const st of steps) for (const a of Object.values(st.anim ?? {})) if (a) assert.ok(ANIMS.has(a), `${id}.${it.key}: ${a}`);
    assert.ok(it.label && it.icon, `${id}.${it.key}`);
  }
});

// ── Просьбы Интерфейса ────────────────────────────────────────────────
test('setSpeed: 0..3, событие time:speed, пауза снимает авто-ультра', () => {
  const { state, bus, s } = house();
  const ev = record(bus, ['time:speed']);
  assert.equal(sim.setSpeed(state, bus, 3), 3);
  assert.equal(sim.setSpeed(state, bus, 9), 3);            // зажим, без повторного события
  assert.equal(sim.setSpeed(state, bus, -1), 0);
  assert.deepEqual(ev.map(e => e.speed), [3, 0]);
  s.asleep = true; sim.setSpeed(state, bus, 1);
  sim.tick(state, bus, stubWorld, 0.1); assert.equal(state.brain.ultra, true);
  sim.setSpeed(state, bus, 0); assert.equal(state.brain.ultra, false);
  const t = state.time.minutes; sim.tick(state, bus, stubWorld, 0.1); assert.equal(state.time.minutes, t);
  s.asleep = false; sim.setSpeed(state, bus, 2); sim.tick(state, bus, stubWorld, 0.1);
  assert.equal(state.brain.ultra, false); near(state.time.minutes - t, 0.3);
});

test('actionProgress: 0 в пути, растёт в петле, по потребности для until', () => {
  const { state, bus, s } = house({ hygiene: 40, fun: -50 });
  assert.equal(sim.actionProgress(s), 0);
  sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'tv').id }, 'watch');
  sim.advance(state, bus, stubWorld, 0.5);
  assert.equal(s.act.phase, 'walk'); assert.equal(sim.actionProgress(s), 0);
  sim.advance(state, bus, stubWorld, 10);
  const p1 = s.act.progress;
  sim.advance(state, bus, stubWorld, 10);
  assert.ok(s.act.progress > p1 && s.act.progress < 1, `${p1} → ${s.act.progress}`);
  sim.cancel(state, bus, s.id, s.act.uid); sim.advance(state, bus, stubWorld, 3);
  // душ: до hygiene 100 (3/мин с 40 ≈ 20 мин), длительность 30 → прогресс по потребности опережает время
  sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'shower').id }, 'shower');
  while (s.act?.key !== 'shower' || s.act.phase !== 'loop') sim.advance(state, bus, stubWorld, 0.5);
  sim.advance(state, bus, stubWorld, 10);
  assert.ok(s.act.progress > s.act.t / s.act.dur + 0.1, `по потребности: ${s.act.progress}`);
  // цепочка ужина: прогресс по шагам
  s.motives.hunger = -50;
  sim.cancel(state, bus, s.id, s.act.uid); sim.advance(state, bus, stubWorld, 2);
  sim.enqueue(state, bus, s.id, { kind: 'object', id: findObj(state, 'fridge').id }, 'cook_meal');
  let prev = 0, mono = true;
  while (s.act?.key !== 'cook_meal' || s.act.by !== 'user') sim.advance(state, bus, stubWorld, 0.5);
  while (s.act?.key === 'cook_meal') { const p = sim.actionProgress(s); if (p + 1e-9 < prev) mono = false; prev = p; sim.advance(state, bus, stubWorld, 0.5); }
  assert.ok(mono, 'не убывает по ходу цепочки'); assert.ok(prev > 0.9, `prev ${prev} act ${s.act?.key} q ${s.queue.map(q => q.interaction)}`);
});
