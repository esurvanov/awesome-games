// 🧠 Мозг, волна 2: грязь/поломки, огонь, службы и НПС, смерть, романтика и дети, вакансии, этажи.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../js/sim/index.js';
import { BREAK, FIRE, SERVICES, FAMILY, EASEL } from '../js/core/tuning.js';
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';
import { stubWorld, stubHouse, findObj, record } from './sim-stub-world.mjs';
import { runDays, balanceTable } from './sim-harness.mjs';

const full = { hunger: 90, comfort: 90, hygiene: 90, bladder: 90, energy: 90, fun: 90, social: 90, room: 20 };
const EXTRA = ['dining_table', 'counter', 'trash_can', 'kitchen_sink', 'easel', 'bed_double'];
function house(motives = {}, spec = {}, extra = EXTRA) {
  const h = stubHouse({ extra });
  sim.seed(h.state, 11);
  const id = sim.addSim(h.state, h.bus, { name: 'Тест', x: 10.5, y: 8.5, motives: { ...full, ...motives }, ...spec });
  const s = h.state.sims.find(x => x.id === id);
  return { ...h, id, s, W: stubWorld };
}
const run = (h, min) => sim.advance(h.state, h.bus, h.W, min);
const obj = (h, def) => ({ kind: 'object', id: findObj(h.state, def).id });
const withTuning = (o, patch, fn) => { const old = structuredClone(o); Object.assign(o, patch); try { return fn(); } finally { Object.assign(o, old); } };
const quiet = s => { s.brain.nextThink = Infinity; };

test('посуда после еды → уборка → мусорное ведро; переполнение → мусор на полу', () => {
  const h = house({ hunger: -40 });
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'fridge'), 'cook_meal');
  withTuning(FIRE, { base: 0 }, () => run(h, 60));
  const host = h.state.objects.find(o => o.st.dishes > 0) ?? null;
  const onFloor = (h.state.lot.trash ?? []).length;
  assert.ok(host || onFloor, 'грязная тарелка появилась');
  if (host) {
    assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'object', id: host.id }).some(m => m.key === 'clear_dishes'));
    sim.enqueue(h.state, h.bus, h.id, { kind: 'object', id: host.id }, 'clear_dishes');
    run(h, 20);
    assert.equal(host.st.dishes, 0);
    assert.equal(findObj(h.state, 'trash_can').st.fill, 1);
  }
  const can = findObj(h.state, 'trash_can');
  can.st.fill = 6;
  quiet(h.s);
  const b = h.state.objects.find(o => o.def === 'dining_table');
  b.st.dishes = 1;
  sim.enqueue(h.state, h.bus, h.id, { kind: 'object', id: b.id }, 'clear_dishes');
  h.s.brain.nextThink = 0; run(h, 20);
  assert.ok((h.state.lot.trash ?? []).length >= 1, 'переполненное ведро → мусор на полу');
  assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'object', id: can.id }).some(m => m.key === 'empty_trash'));
});

test('поломка → меню «Починить»; ремонт с током → смерть → Смерть → надгробие', () => {
  const h = house({ fun: -40 });
  const ev = record(h.bus, ['sim:died', 'npc:arrive', 'npc:leave', 'sim:removed']);
  const tv = findObj(h.state, 'tv');
  withTuning(BREAK, { perUse: { electronics: 1, appliances: 0, plumbing: 0 } }, () => {
    sim.enqueue(h.state, h.bus, h.id, obj(h, 'tv'), 'watch');
    run(h, 100);
  });
  assert.equal(tv.st.broken, true);
  assert.deepEqual(sim.interactionsFor(h.state, h.id, { kind: 'object', id: tv.id }).map(m => m.key), ['repair']);
  withTuning(BREAK, { shock: { base: 1, safeSkill: 4, deathChance: 1, puddleDeath: true } }, () => {
    sim.enqueue(h.state, h.bus, h.id, obj(h, 'tv'), 'repair');
    run(h, 10);
  });
  assert.equal(h.s.dead, true);
  assert.equal(ev.find(e => e.t === 'sim:died').cause, 'shock');
  run(h, SERVICES.reaperDelay + 30);
  assert.ok(ev.some(e => e.t === 'npc:arrive' && e.npc === 'reaper'));
  const stone = findObj(h.state, 'tombstone');
  assert.ok(stone, 'надгробие'); assert.equal(stone.st.of, 'Тест');
  assert.ok(!h.state.sims.some(s => s.id === h.id), 'тело убрано');
});

test('ремонт умелым: чинит без удара, быстрее с механикой', () => {
  const h = house({}, { skills: { mechanical: 6 } });
  const tv = findObj(h.state, 'tv');
  tv.st.broken = true;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'tv'), 'repair');
  run(h, 12);
  assert.ok(h.s.act.dur < BREAK.repairMinutes / 2);
  run(h, 60);
  assert.equal(tv.st.broken, false);
});

test('пожар при готовке: паника, датчик дыма → пожарный тушит', () => {
  const h = house({ hunger: -40 }, {}, [...EXTRA, 'smoke_alarm']);
  const ev = record(h.bus, ['fire:start', 'fire:out', 'npc:arrive']);
  const anims = record(h.bus, ['sim:anim']);
  withTuning(FIRE, { base: 1 }, () => {
    sim.enqueue(h.state, h.bus, h.id, obj(h, 'fridge'), 'cook_meal');
    run(h, 12);
  });
  assert.ok(ev.some(e => e.t === 'fire:start'));
  assert.ok(h.state.lot.fires.length >= 1);
  run(h, 10);
  assert.ok(anims.some(a => a.simId === h.id && a.anim === 'cry'), 'паника');
  run(h, FIRE.brigadeDelay + 40);
  assert.ok(ev.some(e => e.t === 'npc:arrive' && e.npc === 'fire'));
  assert.equal(h.state.lot.fires.length, 0);
  assert.ok(ev.some(e => e.t === 'fire:out'));
  assert.equal(h.s.dead, false);
});

test('пожар без датчика: никто не приезжает, предметы сгорают, огонь гаснет сам', () => {
  const h = house();
  quiet(h.s); h.s.x = 30.5;                               // подальше
  const ev = record(h.bus, ['npc:arrive']);
  const stove = findObj(h.state, 'stove');
  withTuning(FIRE, { spreadChance: 0 }, () => {
    sim.debug.spawnNpc; // no-op, api present
    run(h, 0.5);
    h.state.lot.fires = [];
    // поджигаем плиту напрямую через тик
    h.state.lot.fires.push({ x: stove.x, y: stove.y, level: 0, power: 0.3, age: 0 });
    run(h, FIRE.burnoutMinutes + 10);
  });
  assert.ok(!ev.some(e => e.npc === 'fire'));
  assert.equal(stove.st.burnt, true);
  assert.equal(h.state.lot.fires.length, 0);
  assert.equal(sim.interactionsFor(h.state, h.id, { kind: 'object', id: stove.id }).length, 0, 'сгоревшее бесполезно');
});

test('службы: пицца через час, мастер чинит и берёт §50/ч, горничная убирает', () => {
  const h = house();
  quiet(h.s);
  const m0 = h.state.household.money;
  h.s.brain.nextThink = 0;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'phone'), 'call_pizza');
  run(h, 10); quiet(h.s);
  run(h, SERVICES.pizza.delay + 60);
  const host = h.state.objects.find(o => o.st.pizza > 0);
  assert.ok(host, 'пицца на стойке/столе');
  assert.equal(h.state.household.money, m0 - SERVICES.pizza.price);
  assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'object', id: host.id }).some(m => m.key === 'eat_pizza'));
  assert.ok(!h.state.sims.some(s => s.npc === 'pizza'), 'курьер ушёл');
  // мастер
  const tv = findObj(h.state, 'tv'); tv.st.broken = true;
  h.s.brain.nextThink = 0;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'phone'), 'call_repair');
  run(h, 10); quiet(h.s);
  const m1 = h.state.household.money;
  run(h, SERVICES.repair.delay + 120);
  assert.equal(tv.st.broken, false);
  assert.ok(h.state.household.money <= m1 - SERVICES.repair.perHour);
  // горничная: нанять, в 10:00 приходит и вытирает лужу
  h.state.lot.puddles = [{ x: 12, y: 9, level: 0 }];
  h.s.brain.nextThink = 0;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'phone'), 'call_maid');
  run(h, 15); quiet(h.s);
  assert.equal(h.state.household.services.maid, true);
  const toTen = ((34 * 60) - h.state.time.minutes % 1440) % 1440;   // до 10:00
  run(h, toTen + 60);
  assert.equal(h.state.lot.puddles.length, 0, 'горничная вытерла');
});

test('прохожий → знакомство → в гости → «Попросить уйти»', () => {
  const h = house({ social: -30 });
  quiet(h.s);
  const t = sim.debug.spawnNpc(h.state, h.bus, 'townie', { townieId: 't2', name: 'Галина Орлова', at: { x: 11, y: 10 } });
  t.brain.nextThink = Infinity;
  const menu = sim.interactionsFor(h.state, h.id, { kind: 'sim', id: t.id }).map(m => m.key);
  assert.ok(menu.includes('greet') && menu.includes('invite_in') && !menu.includes('ask_leave') && !menu.includes('kiss'));
  h.s.brain.nextThink = 0;
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: t.id }, 'greet');
  run(h, 6); quiet(h.s);
  assert.ok(sim.getRel(h.s, 't2') > 0, 'знакомы (по ключу горожанина)');
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: t.id }, 'invite_in');
  run(h, 6);
  assert.equal(t.npc, 'visitor');
  assert.ok(sim.interactionsFor(h.state, h.id, { kind: 'object', id: findObj(h.state, 'phone').id }).some(m => m.key === 'invite:t2'), 'в телефоне «Пригласить…/Галина»');
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: t.id }, 'ask_leave');
  run(h, 40);
  assert.ok(!h.state.sims.includes(t), 'гость ушёл');
});

test('грабитель: с сигнализацией — полиция и §1000; без — кража', () => {
  for (const alarm of [true, false]) {
    const h = house({}, {}, alarm ? [...EXTRA, 'burglar_alarm'] : EXTRA);
    quiet(h.s);
    const n0 = h.state.objects.length, m0 = h.state.household.money;
    sim.debug.spawnNpc(h.state, h.bus, 'burglar');
    run(h, 90);
    assert.ok(!h.state.sims.some(s => s.npc === 'burglar'), 'грабитель ушёл/пойман');
    if (alarm) { assert.equal(h.state.household.money, m0 + SERVICES.burglar.reward); assert.equal(h.state.objects.length, n0); }
    else assert.equal(h.state.objects.length, n0 - 1);
  }
});

test('романтика: пороги флирта/поцелуя, влюблённость ≥ 70', () => {
  const h = house();
  const id2 = sim.addSim(h.state, h.bus, { name: 'Вера', x: 11.5, y: 8.5, motives: { ...full } });
  const v = h.state.sims.find(s => s.id === id2);
  quiet(v);
  h.s.rel[id2] = v.rel[h.id] = 50;
  let keys = sim.interactionsFor(h.state, h.id, { kind: 'sim', id: id2 }).map(m => m.key);
  assert.ok(keys.includes('flirt') && !keys.includes('kiss'));
  h.s.rel[id2] = v.rel[h.id] = 75;
  keys = sim.interactionsFor(h.state, h.id, { kind: 'sim', id: id2 }).map(m => m.key);
  assert.ok(keys.includes('kiss'));
  sim.enqueue(h.state, h.bus, h.id, { kind: 'sim', id: id2 }, 'kiss');
  run(h, 8);
  assert.equal(sim.isLover(h.s, v), true);
  assert.equal(sim.relStatus(v.rel[h.id]), 'crush');
});

test('ребёнок: диалог → кроватка (бесплатно) → уход → через 72 ч школьник', () => {
  const h = house();
  const id2 = sim.addSim(h.state, h.bus, { name: 'Вера', x: 11.5, y: 8.5, motives: { ...full } });
  const v = h.state.sims.find(s => s.id === id2);
  h.s.rel[id2] = v.rel[h.id] = 85; h.s.love = { [id2]: true }; v.love = { [h.id]: true };
  quiet(v);
  const dialogs = record(h.bus, ['dialog', 'sim:born']);
  const money = h.state.household.money;
  assert.ok(sim.enqueue(h.state, h.bus, h.id, obj(h, 'bed_double'), 'try_baby'));
  run(h, 30);
  const d = dialogs.find(e => e.t === 'dialog');
  assert.ok(d && d.options.some(o => o.key === 'yes'));
  assert.equal(sim.answer(h.state, h.bus, d.id, 'yes'), true);
  assert.equal(sim.answer(h.state, h.bus, d.id, 'yes'), false, 'повторный ответ игнорируется');
  const crib = findObj(h.state, 'crib');
  assert.ok(crib?.st.baby, 'малыш в кроватке');
  assert.equal(h.state.household.money, money, 'кроватка бесплатно');
  crib.st.baby.hunger = -30;
  sim.enqueue(h.state, h.bus, h.id, { kind: 'object', id: crib.id }, 'feed_baby');
  run(h, 30);
  assert.ok(crib.st.baby.hunger > 0, 'накормлен');
  // подрастает (уход поддерживаем вручную, чтобы не приехала соцработница)
  for (let i = 0; i < FAMILY.babyHours; i++) { if (crib.st.baby) { crib.st.baby.hunger = crib.st.baby.fun = 80; } run(h, 60); }
  const kid = h.state.sims.find(s => s.age === 'child');
  assert.ok(kid, 'ребёнок появился');
  assert.ok(dialogs.some(e => e.t === 'sim:born' && e.simId === kid.id));
  assert.equal(sim.interactionsFor(h.state, kid.id, { kind: 'object', id: findObj(h.state, 'fridge').id }).some(m => m.key === 'cook_meal'), false, 'дети не готовят');
  assert.equal(sim.interactionsFor(h.state, h.id, { kind: 'sim', id: kid.id }).some(m => m.key === 'kiss' || m.key === 'flirt'), false);
  // школа: до 9:00 следующего дня уехал(а)
  const to9 = ((33 * 60) - h.state.time.minutes % 1440) % 1440 || 1440;
  run(h, to9);
  assert.ok(kid.atWork?.school || kid.brain.stats.school > 0, 'в школе');
  run(h, 8 * 60);
  assert.equal(kid.school.homework, true);
  assert.ok(sim.interactionsFor(h.state, kid.id, { kind: 'object', id: findObj(h.state, 'computer_desk')?.id ?? findObj(h.state, 'dining_chair').id }).some(m => m.key === 'homework'));
});

test('заброшенный малыш → соцработница забирает', () => {
  const h = house();
  quiet(h.s); h.s.x = 30.5;
  const crib = findObj(h.state, 'crib') ?? (h.state.objects.push({ id: h.state.nextId++, def: 'crib', x: 40, y: 5, rot: 0, level: 0, st: {} }), findObj(h.state, 'crib'));
  crib.st.baby = { name: 'Митя', born: h.state.time.minutes, hunger: -90, fun: -90, neglect: 0, parents: [h.id] };
  const ev = record(h.bus, ['npc:arrive']);
  run(h, SERVICES.socialWorkerNeglect + 90);
  assert.ok(ev.some(e => e.npc === 'social'));
  assert.equal(crib.st.baby, null);
});

test('вакансии: газета — 1 предложение, компьютер — 3; ответ устраивает на работу', () => {
  const h = house();
  const dl = record(h.bus, ['dialog']);
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'mailbox'), 'newspaper');
  run(h, 40);
  assert.equal(dl[0].options.length, 2);
  sim.answer(h.state, h.bus, dl[0].id, 'no');
  assert.equal(h.s.career, null);
  const h2 = house({}, {}, [...EXTRA, 'computer_desk']);
  const dl2 = record(h2.bus, ['dialog']);
  sim.enqueue(h2.state, h2.bus, h2.id, obj(h2, 'computer_desk'), 'find_job');
  run(h2, 70);
  assert.equal(dl2[0].options.length, 4);
  sim.answer(h2.state, h2.bus, dl2[0].id, dl2[0].options[0].key);
  assert.equal(h2.s.career.track, dl2[0].options[0].key);
});

test('мольберт: картина за 2 ч → продажа по навыку', () => {
  const h = house({}, { skills: { creativity: 3 } });
  for (let i = 0; i < 2; i++) { sim.enqueue(h.state, h.bus, h.id, obj(h, 'easel'), 'paint'); run(h, 75); }
  const e = findObj(h.state, 'easel');
  assert.ok(e.st.canvas >= EASEL.finishMinutes);
  const m = h.state.household.money;
  sim.enqueue(h.state, h.bus, h.id, obj(h, 'easel'), 'sell_painting');
  run(h, 10);
  assert.ok(h.state.household.money >= m + EASEL.saleBase + EASEL.salePerSkill * 3);
});

test('этажи (настоящий Мир): сим поднимается по лестнице к мольберту, sim.z растёт плавно', async () => {
  const W = await import('../js/world/index.js');
  const state = createState(), bus = createBus();
  const { spawn } = W.loadStartLot(state, bus);
  sim.seed(state, 3);
  const id = sim.addSim(state, bus, { name: 'Лазарь', x: spawn.x + 0.5, y: spawn.y + 0.5, motives: { ...full } });
  const s = state.sims.find(x => x.id === id);
  const easel = state.objects.find(o => o.def === 'easel');
  assert.equal(easel.level, 1);
  sim.enqueue(state, bus, id, { kind: 'object', id: easel.id }, 'paint');
  const zs = [];
  for (let i = 0; i < 400 && !(s.act?.key === 'paint' && s.act.phase === 'loop'); i++) { sim.advance(state, bus, W, 0.25); zs.push(s.z); }
  assert.equal(s.level, 1);
  assert.equal(s.act?.phase, 'loop');
  const mid = zs.filter(z => z > 0.1 && z < 2.9);
  assert.ok(mid.length >= 3, `промежуточные высоты на ступенях: ${mid.length}`);
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] >= zs[i - 1] - 1e-9, 'подъём без скачков вниз');
});

test('7 дней, настоящий Мир: семья → малыш → ребёнок, без смертей, быстро', async () => {
  const r = await runDays({ world: 'real', days: 7, baby: true });
  console.log(`\n── 7 дней, семья с ребёнком ──\n${balanceTable(r, 7)}`);
  assert.equal(r.log.deaths.length, 0);
  assert.equal(r.log.born, 1);
  assert.ok(r.state.sims.some(s => s.age === 'child' && !s.npc));
  assert.ok(r.avgMood > 0);
  assert.ok(r.log.ms < 3000, `перф: ${r.log.ms.toFixed(0)} мс на 7 дней`);
});

test('ask(): карточка через bus → answer() → onAnswer; неверный ключ и повтор игнорируются', () => {
  const h = house();
  const ev = record(h.bus, ['dialog']);
  const got = [];
  const id = sim.ask(h.state, h.bus, { simId: h.id, icon: '❓', text: 'Вызвать мастера?', options: [{ key: 'yes', label: 'Да' }, { key: 'no', label: 'Нет' }] }, (key, info) => got.push([key, info.simId]));
  assert.deepEqual(ev[0], { t: 'dialog', id, simId: h.id, icon: '❓', text: 'Вызвать мастера?', options: [{ key: 'yes', label: 'Да' }, { key: 'no', label: 'Нет' }] });
  assert.equal(sim.answer(h.state, h.bus, id, 'maybe'), false);
  assert.equal(sim.answer(h.state, h.bus, id, 'no'), true);
  assert.equal(sim.answer(h.state, h.bus, id, 'yes'), false);
  assert.deepEqual(got, [['no', h.id]]);
  assert.ok(JSON.stringify(h.state), 'state сериализуем');
  const id2 = sim.ask(h.state, h.bus, { icon: 'ℹ️', text: 'Без колбэка', options: [{ key: 'ok', label: 'Ок' }] });
  assert.equal(sim.answer(h.state, h.bus, id2, 'ok'), true);
});

// Плейтест «не двигается ничего»: новая игра как в js/main.js, первые 60 игровых минут
async function firstHour(startMinutes, seed) {
  const W = await import('../js/world/index.js');
  const state = createState(), bus = createBus();
  state.time.minutes = startMinutes;
  const { spawn: at } = W.loadStartLot(state, bus);
  sim.seed(state, seed);
  sim.addSim(state, bus, { name: 'Вера', x: at.x, y: at.y, personality: { neat: 6, outgoing: 7, active: 4, playful: 5, nice: 3 }, career: { track: 'business', level: 1, perf: 0, missed: 0 } });
  sim.addSim(state, bus, { name: 'Олег', x: at.x + 1, y: at.y, personality: { neat: 3, outgoing: 4, active: 7, playful: 7, nice: 4 }, career: null });
  const stat = state.sims.map(() => ({ moved: 0, still: 0, maxStill: 0, frozenHurry: 0 }));
  let prev = state.sims.map(s => ({ x: s.x, y: s.y }));
  for (let t = 0; t < 60; t += 0.5) {
    sim.advance(state, bus, W, 0.5);
    state.sims.filter(s => !s.npc).forEach((s, i) => {
      const d = Math.hypot(s.x - prev[i].x, s.y - prev[i].y);
      stat[i].moved += d;
      const busy = s.atWork || (s.act && s.act.phase !== 'walk') || s.reaction;
      stat[i].still = d < 1e-3 && !busy ? stat[i].still + 0.5 : 0;
      stat[i].maxStill = Math.max(stat[i].maxStill, stat[i].still);
      if (s.reaction && ((s.act?.prio ?? 0) > 2 || s.queue.some(q => q.prio > 2))) stat[i].frozenHurry++;
    });
    prev = state.sims.map(s => ({ x: s.x, y: s.y }));
  }
  return { state, stat };
}

test('новая игра: первые 60 минут оба двигаются, никто не стоит столбом, разговор не держит спешащего', async () => {
  for (const start of [7 * 60, 8 * 60]) for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { state, stat } = await firstHour(start, seed);
    state.sims.filter(s => !s.npc).forEach((s, i) => {
      const st = stat[i];
      const tag = `${start / 60}:00 сид ${seed} ${s.name}`;
      assert.ok(st.moved >= 5 || s.atWork, `${tag}: прошёл ${st.moved.toFixed(1)} тайлов`);   // уехал на работу — тоже «живой»
      assert.ok(st.maxStill <= 5, `${tag}: стоял без дела ${st.maxStill} мин`);
      assert.equal(st.frozenHurry, 0, `${tag}: заморожен разговором, хотя спешит`);
    });
    if (start === 7 * 60) {                                 // после часа утра Вера успевает на карпул 08:00
      const W = await import('../js/world/index.js');
      sim.advance(state, createBus(), W, 60);
      assert.ok(state.sims.find(s => s.name === 'Вера').atWork, `сид ${seed}: Вера уехала на работу до 09:00`);
    }
  }
});
