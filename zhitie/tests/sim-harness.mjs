// Харнесс баланса Мозга: безголовый прогон N игровых дней + «бот-игрок», таблица «на что ушло время».
// Запуск вручную: node tests/sim-harness.mjs [stub|real] [дней] [сид] [baby]
import * as sim from '../js/sim/index.js';
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';
import { stubWorld, stubHouse } from './sim-stub-world.mjs';

export const FAMILY = [
  { name: 'Иван', career: 'business', personality: { neat: 4, outgoing: 7, active: 4, playful: 6, nice: 6 } },
  { name: 'Мария', career: 'business', personality: { neat: 7, outgoing: 4, active: 6, playful: 4, nice: 7 } },
];

// Бот-игрок: то, что делает человек — вызывает мастера, платит счета, отвечает на диалоги, (опц.) заводит ребёнка
export function makeBot(state, bus, { baby = false } = {}) {
  const pending = [];
  bus.on('dialog', d => pending.push(d));
  let babyTried = false, lastRepairCall = -1e9;
  return () => {
    for (const d of pending.splice(0)) {                 // «Да» / первая вакансия безработному; работающий не меняет трек
      const who = state.sims.find(s => s.id === d.simId);
      const no = d.options.find(o => o.key === 'no');
      const jobOffer = d.options.some(o => sim.CAREERS[o.key]);
      sim.answer(state, bus, d.id, jobOffer && no && who?.career ? 'no' : d.options[0].key);
    }
    const H = state.sims.filter(s => !s.npc && !s.dead && !s.atWork && s.age === 'adult');
    const a = H.find(s => !s.queue.some(q => q.by === 'user'));
    if (!a) return;
    const find = def => state.objects.find(o => o.def === def && !o.st.burnt);
    const now = state.time.minutes;
    if (state.objects.some(o => o.st.broken && !o.st.burnt) && !state.sims.some(s => s.npc === 'repair') && now - lastRepairCall > 180 && find('phone')) {
      if (sim.enqueue(state, bus, a.id, { kind: 'object', id: find('phone').id }, 'call_repair')) lastRepairCall = now;
    }
    if (state.household.bills.length && find('mailbox')) sim.enqueue(state, bus, a.id, { kind: 'object', id: find('mailbox').id }, 'pay_bills');
    const h = Math.floor(now / 60) % 24;
    if (baby && !babyTried && h === 20 && now > 1440 && find('bed_double')) {
      const ok = sim.enqueue(state, bus, a.id, { kind: 'object', id: find('bed_double').id }, 'try_baby');
      if (ok) babyTried = true;
    }
  };
}

export async function runDays({ world = 'stub', days = 3, seed = 42, family = FAMILY, bot = true, baby = false } = {}) {
  let state, bus, W, spawn;
  if (world === 'real') {
    W = await import('../js/world/index.js');
    state = createState(); bus = createBus();
    spawn = W.loadStartLot(state, bus).spawn;
  } else { ({ state, bus } = stubHouse()); W = stubWorld; spawn = { x: 10, y: 10 }; }
  sim.seed(state, seed);
  const log = { notify: [], anims: new Set(), fails: 0, deaths: [], fires: 0, npcs: {}, born: 0, money: [] };
  bus.on('notify', n => { log.notify.push(n); if (/туалета|на полу/.test(n.text)) log.fails++; });
  bus.on('sim:anim', a => log.anims.add(a.anim));
  bus.on('sim:died', d => log.deaths.push(d.cause));
  bus.on('notify', n => { if (n.text === 'Пожар!') log.fires++; });
  bus.on('npc:arrive', d => { log.npcs[d.npc] = (log.npcs[d.npc] ?? 0) + 1; });
  bus.on('sim:born', d => { if (d.simId != null) log.born++; });
  const ids = family.map((f, i) => sim.addSim(state, bus, { ...f, x: spawn.x + 0.5 + i, y: spawn.y + 0.5 }));
  if (baby) {                                         // супруги: влюблены с начала
    const [a, b] = ids.map(id => state.sims.find(s => s.id === id));
    a.rel[b.id] = b.rel[a.id] = 85; a.love = { [b.id]: true }; b.love = { [a.id]: true };
  }
  const botStep = bot ? makeBot(state, bus, { baby }) : () => {};
  const samples = [];
  const mins = Object.fromEntries(sim.MOTIVES.map(m => [m, 100]));
  const t0 = performance.now();
  for (let t = 0; t < days * 1440; t += 1) {
    sim.advance(state, bus, W, 1);
    if (t % 10 === 0) {
      botStep();
      for (const s of state.sims) {
        if (s.npc || s.dead) continue;
        samples.push(sim.mood(s));
        for (const m of sim.MOTIVES) if (!s.atWork) mins[m] = Math.min(mins[m], s.motives[m]);
      }
    }
    if (t % 1440 === 1439) log.money.push(state.household.money);
  }
  log.ms = performance.now() - t0;
  const avgMood = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { state, bus, log, avgMood, mins };
}

// Компактная таблица: часы в сутки по занятиям (только семья)
export function balanceTable({ state, avgMood, mins, log }, days) {
  const H = state.sims.filter(s => !s.npc);
  const keys = new Set();
  for (const s of H) Object.keys(s.brain.stats).forEach(k => keys.add(k));
  const rows = [...keys].map(k => [k, ...H.map(s => (s.brain.stats[k] ?? 0) / 60 / days)])
    .sort((a, b) => b.slice(1).reduce((x, y) => x + y) - a.slice(1).reduce((x, y) => x + y, 0))
    .filter(r => r.slice(1).some(v => v >= 0.1));
  const w = 16;
  const lines = [`${'ч/сутки'.padEnd(w)}${H.map(s => s.name.padStart(8)).join('')}`];
  for (const [k, ...v] of rows) lines.push(`${k.padEnd(w)}${v.map(x => x.toFixed(1).padStart(8)).join('')}`);
  lines.push(`${'заработано §'.padEnd(w)}${H.map(s => String(s.brain.earned).padStart(8)).join('')}`);
  lines.push(`${'карьера'.padEnd(w)}${H.map(s => (s.career ? `${s.career.track[0]}${s.career.level}` : s.age === 'child' ? sim.gradeLetter(s.school?.grade ?? 70) : '—').padStart(8)).join('')}`);
  lines.push(`настроение ср. ${avgMood.toFixed(1)} · провалов ${log.fails} · смертей ${log.deaths.length}${log.deaths.length ? ` (${log.deaths})` : ''} · пожаров ${log.fires} · дети ${log.born}`);
  lines.push(`деньги по дням: ${log.money.map(m => `§${m}`).join(' → ')} · счета ${state.household.bills.map(b => b.amount).join(',') || 'оплачены'}`);
  lines.push(`НПС: ${Object.entries(log.npcs).map(([k, v]) => `${k}×${v}`).join(' ') || '—'} · минимумы: ${Object.entries(mins).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ')}`);
  lines.push(`время прогона: ${log.ms.toFixed(0)} мс`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] !== 'rotation') {
  const [world = 'stub', days = '3', seed = '42', baby] = process.argv.slice(2);
  const r = await runDays({ world, days: +days, seed: +seed, baby: baby === 'baby' });
  console.log(balanceTable(r, +days));
}

// ── Волна 3: три семьи по очереди (правило TS1: время идёт только у активной семьи) ──
export const ROTATION = [
  { name: 'Ивановы', members: [
    { name: 'Иван', career: 'business', personality: { neat: 4, outgoing: 7, active: 4, playful: 6, nice: 6 } },
    { name: 'Мария', career: 'science', personality: { neat: 7, outgoing: 4, active: 6, playful: 4, nice: 7 } }] },
  { name: 'Петровы', members: [
    { name: 'Пётр', career: 'entertainment', personality: { neat: 3, outgoing: 9, active: 5, playful: 8, nice: 5 } },
    { name: 'Ольга', career: 'crime', personality: { neat: 5, outgoing: 5, active: 7, playful: 6, nice: 2 } }] },
  { name: 'Сидоровы', members: [
    { name: 'Семён', career: 'military', personality: { neat: 8, outgoing: 3, active: 9, playful: 2, nice: 4 } },
    { name: 'Анна', career: 'politics', personality: { neat: 6, outgoing: 8, active: 3, playful: 5, nice: 8 } },
    { name: 'Гоша', age: 'child', personality: { neat: 2, outgoing: 6, active: 8, playful: 9, nice: 5 } }] },
];

export async function runRotation({ days = 7, seed = 42, families = ROTATION } = {}) {
  const W = await import('../js/world/index.js');
  const runs = families.map((f, i) => {
    const state = createState(), bus = createBus();
    const { spawn } = W.loadStartLot(state, bus);
    sim.seed(state, seed + i);
    const log = { money: [], deaths: [], wants: 0, fears: 0, events: 0, earned: {} };
    bus.on('sim:died', d => log.deaths.push(d.cause));
    bus.on('event', () => log.events++);
    bus.on('notify', n => { if (n.text.includes('желание сбылось')) log.wants++; if (n.text.includes('страх сбылся')) log.fears++; });
    f.members.forEach((m, k) => sim.addSim(state, bus, { ...m, x: spawn.x + 0.5 + k, y: spawn.y + 0.5 }));
    return { f, state, bus, log, bot: makeBot(state, bus) };
  });
  const t0 = performance.now();
  for (let d = 0; d < days; d++) for (const r of runs) {
    for (let t = 0; t < 1440; t++) { sim.advance(r.state, r.bus, W, 1); if (t % 10 === 0) r.bot(); }
    r.log.money.push(r.state.household.money);
  }
  const ms = performance.now() - t0;
  return { runs, ms, days };
}

export function rotationTable({ runs, ms, days }) {
  const lines = [];
  for (const { f, state, log } of runs) {
    const H = state.sims.filter(s => !s.npc);
    lines.push(`${f.name}: ${H.map(s => `${s.name} ${s.career ? `${s.career.track}${s.career.level} §${s.brain.earned}` : s.age === 'child' ? `школа ${sim.gradeLetter(s.school?.grade ?? 70)}` : 'без работы'} [${sim.aspirationLevel(s)}]`).join(' · ')}`);
    lines.push(`  деньги: ${log.money.map(m => `§${m}`).join(' → ')}`);
    lines.push(`  желаний ${(log.wants / days).toFixed(1)}/день · страхов ${(log.fears / days).toFixed(1)}/день · событий ${log.events} · смертей ${log.deaths.length}`);
  }
  lines.push(`время: ${ms.toFixed(0)} мс на ${runs.length}×${days} дней`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'rotation') {
  console.log(rotationTable(await runRotation({ days: +(process.argv[3] ?? 7) })));
}
