// Прогон целого вечера в Node с «ботом-игроком» на нескольких сидах. node tests/sim.js
// Проверки: кривая людей по часам, никто не в стенах/мебели и не застрял, одно место — один человек,
// группы (в т.ч. параллельные за длинным столом), события, разговор до контакта при удачных картах и
// срыв при неудачных, сведение пары → 'pair', итог 'end', время шага, повторяемость по сиду.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
// как tests/load.js, но ещё грузит все js/content/*.js (даже если их пока нет в manifest)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load() {
  const ctx = { console, Math, Date, JSON, Map, Set, Array, Object, Number, String, Boolean, Error, performance, setTimeout, clearTimeout };
  ctx.globalThis = ctx; vm.createContext(ctx);
  const done = new Set();
  const run = f => { if (done.has(f)) return; done.add(f); vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); };
  run('js/l.js'); run('js/manifest.js');
  for (const f of ctx.SKHODKA_FILES) if (/js\/(core|content\/|sim\/)/.test(f)) run(f);
  for (const f of fs.readdirSync(path.join(ROOT, 'js/content'))) if (f.endsWith('.js')) run('js/content/' + f);
  return ctx.L;
}
const L = load();
const tryUse = id => { try { return L.use(id); } catch (e) { return null; } };
// наборы содержания: настоящее (content/index или сборка из content/*) и тестовый fixture
const SETS = [];
{
  const idx = tryUse('content/index');
  if (idx) SETS.push(['content/index', idx.CONTENT]);
  else {
    const part = (id, k) => tryUse('content/' + id)?.[k];
    const C = { ROLES: part('roles', 'ROLES'), MINDS: part('minds', 'MINDS'), MOODS: part('moods', 'MOODS'), ARCHETYPES: part('archetypes', 'ARCHETYPES'),
      ODDBALLS: part('oddballs', 'ODDBALLS'), NEEDS: part('needs', 'NEEDS'), TOPICS: part('topics', 'TOPICS'), CARDS: part('cards', 'CARDS'),
      LINES: part('lines', 'LINES'), EVENTS: part('events', 'EVENTS'), CHAT: part('chat', 'CHAT'), NAMES: part('names', 'NAMES'),
      ORIGINS: part('names', 'ORIGINS'), TUNING: part('tuning', 'TUNING') || {}, LAYOUT: part('layout', 'LAYOUT') };
    const miss = Object.entries(C).filter(([k, v]) => !v && k !== 'ORIGINS').map(([k]) => k);
    if (!miss.length) SETS.push(['content/* (без index)', C]); else console.log('содержание неполное, нет:', miss.join(', '));
  }
  SETS.push(['sim/fixture', L.use('sim/fixture').CONTENT]);
}
let CONTENT;
const { World } = L.use('sim/world');
const SEEDS = (process.argv[2] || '1,2,3,4').split(',').map(Number);
const DT = 1 / 30;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗', msg); } return cond; };

// оракул для бота: знает склад собеседника (удачные карты) — или нарочно выбирает худшие
function cardValue(w, n, c) {
  const mind = w.idx.MINDS[n.mind] || {}, mood = w.idx.MOODS[n.mood] || {};
  let v = 0;
  if (mind.likes?.includes(c.style)) v += 2; if (mind.dislikes?.includes(c.style)) v -= 3;
  if (mood.likes?.includes(c.style)) v += 1; if (mood.dislikes?.includes(c.style)) v -= 1.5;
  if (c.topic) v += n.topics.includes(c.topic) ? 1.5 : -0.3;
  const od = n.oddball && w.idx.ODDBALLS[n.oddball]; if (od?.befriend?.likes?.includes(c.style)) v += 2.5;
  if (w.talk.cur.last?.style === c.style) v -= 1;
  if (w.talk.cur.used.has(c.id)) v -= 1.5;
  return v;
}

function run(seed, mode) {
  const w = new World(CONTENT, { seed, profile: { name: 'Бот' } });
  const R = { seed, mode, curve: [], stuck: [], solid: [], dup: [], near: [], maxGroups: 0, parallel: 0, events: new Set(), pairs: 0,
    results: {}, end: null, ms: [], lines: 0, reveals: 0, chat: 0 };
  w.bus.on('event', e => { if (e.on) R.events.add(e.id); });
  w.bus.on('pair', () => R.pairs++);
  w.bus.on('talk:end', e => R.results[e.result] = (R.results[e.result] || 0) + 1);
  w.bus.on('talk:line', () => R.lines++);
  w.bus.on('reveal', () => R.reveals++);
  w.bus.on('end', e => R.end = e.summary);
  w.bus.on('chat', e => { if (e.msg.kind !== 'feed') R.chat++; if (mode !== 'idle' && e.msg.options.length) w.act({ type: 'reply', msg: e.msg.id, option: 0 }); });
  const tried = new Map(), last = new Map();
  let orderT = -99, nextSample = 19.0;
  for (let k = 0; !w.over && k < 200000; k++) {
    const a = performance.now(); w.step(DT); R.ms.push(performance.now() - a);
    if (w.hour >= nextSample) { R.curve.push([+w.hour.toFixed(2), w.present()]); nextSample += 0.1; }
    if (k % 10 === 0) check(w, R, last);
    if (mode !== 'idle' && k % 6 === 0) bot(w, mode, tried, () => { if (w.t - orderT > 40) { orderT = w.t; w.act({ type: 'order', item: 'beer' }); } });
  }
  R.w = w;
  return R;
}

function check(w, R, last) {
  const seat = new Map(), pos = [];
  let groups = 0; const byZone = {};
  for (const g of w.groups) {
    groups++;
    const zs = new Set(g.members.map(id => { const n = w.people.get(id); return n.seat && w.spotById[n.seat].kind === 'seat' ? w.spotById[n.seat].zone : null; }));
    if (zs.size === 1 && !zs.has(null)) { const z = [...zs][0]; byZone[z] = (byZone[z] || 0) + 1; }
  }
  R.maxGroups = Math.max(R.maxGroups, groups);
  R.parallelAny = Math.max(R.parallelAny || 0, ...Object.values(byZone), 0);
  for (const n of w.list) {
    if (!n.present) continue;
    if (n.state === 'sit') {
      const s = w.spotById[n.seat];
      if (!s || Math.hypot(s.x - n.x, s.z - n.z) > 0.01) R.dup.push(`${n.id} сидит не на месте`);
      if (seat.has(n.seat)) R.dup.push(`${n.seat}: ${seat.get(n.seat)} и ${n.id}`); seat.set(n.seat, n.id);
    } else if (!n.finalLeg && w.nav.solidAt(n.x, n.z)) R.solid.push(`${n.id} ${n.state} ${n.x.toFixed(2)},${n.z.toFixed(2)} @${w.hour.toFixed(2)}`);
    if (!n.nav && (n.state === 'sit' || n.state === 'stand')) pos.push(n);
    // застрял: есть путь, но не двигается
    const l = last.get(n.id);
    if (n.nav) {
      if (!l || Math.hypot(l.x - n.x, l.z - n.z) > 0.05) last.set(n.id, { x: n.x, z: n.z, t: w.t });
      else if (w.t - l.t > 8) { R.stuck.push(`${n.id} ${n.x.toFixed(2)},${n.z.toFixed(2)} @${w.hour.toFixed(2)}`); last.set(n.id, { x: n.x, z: n.z, t: w.t }); }
    } else last.delete(n.id);
  }
  const P = w.player;
  if (P.state === 'sit') { if (seat.has(P.seat)) R.dup.push(`игрок на месте ${P.seat}`); }
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++)
    if (Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z) < 0.3) R.near.push(`${pos[i].id}~${pos[j].id}`);
}

function bot(w, mode, tried, order) {
  const P = w.player, T = w.talk;
  if (w.events.some(e => e.effect.photo)) { if (P.goal?.kind !== 'photo' && !w.score.photo) w.act({ type: 'photo' }); return; }
  if (!w.score.photo && w.hour >= w.T.photo.from + 0.3 && !w.dir.fired.some(id => w.idx.EVENTS[id]?.effect?.photo)) { w.act({ type: 'photo' }); return; }
  if (P.energy < 0.25) order();
  if (T.cur) {
    const c = T.cur, n = w.people.get(c.id);
    if (c.pending || !c.offer.length) return;
    if (mode === 'good' && n.step >= 2) {
      // свести: кто из знакомых подходит собеседнику
      for (const m of w.list) {
        if (m === n || !m.present || m.step < 2) continue;
        const key = n.id < m.id ? `${n.id}|${m.id}` : `${m.id}|${n.id}`;
        if (T.pairs.has(key) || tried.get(key)) continue;
        const match = (n.need && n.need === m.offer) || (m.need && m.need === n.offer) || n.topics.some(t => m.topics.includes(t));
        if (match) { tried.set(key, 1); if (w.act({ type: 'introduce', a: n.id, b: m.id })) return; }
      }
    }
    const plain = c.offer.filter(k => !k.act || k.act === 'hello');
    let card;
    if (mode === 'good') {
      if (n.step >= 5 || (n.step === 4 && !T.dealWhy(n))) { w.act({ type: 'endTalk' }); return; }
      const sp = c.offer.find(k => (k.act === 'contact' && n.step >= 2 && n.step < 4 && n.rapport >= T.contactThr(n)) || (k.act === 'deal' && n.step === 4 && n.rapport >= w.T.talk.deal && T.dealWhy(n)));
      card = sp || plain.sort((a, b) => cardValue(w, n, b) - cardValue(w, n, a))[0] || c.offer[0];
    } else card = plain.sort((a, b) => cardValue(w, n, a) - cardValue(w, n, b))[0] || c.offer[0];
    w.act({ type: 'say', card: card.key });
    return;
  }
  if (P.goal?.kind === 'approach') return;
  let best = null, bd = 1e9;
  for (const n of w.list) {
    if (!n.present || n.cold > w.t || n.plan.kind === 'leave' || n.nav) continue;
    if (n.step >= (mode === 'good' ? 4 : 5)) continue;
    if (w.t - (tried.get(n.id) || -1e9) < 60) continue;
    const d = Math.hypot(n.x - P.x, n.z - P.z);
    if (d < bd) { bd = d; best = n; }
  }
  if (best) { tried.set(best.id, w.t); w.act({ type: 'approach', id: best.id }); }
}

for (const [src, C] of SETS) {
CONTENT = C;
const fixture = src === 'sim/fixture';
console.log(`Сходка: симуляция (${src}), сиды ${SEEDS.join(',')}`);
for (const seed of SEEDS) {
  for (const mode of ['good', 'bad']) {
    const R = run(seed, mode);
    const w = R.w, TT = w.T, [pa, pb] = TT.crowd.peak.at, [lo, hi] = TT.crowd.peak.n;
    const at = h => R.curve.reduce((b, c) => Math.abs(c[0] - h) < Math.abs(b[0] - h) ? c : b)[1];
    const peak = R.curve.filter(c => c[0] >= pa && c[0] <= pb).map(c => c[1]);
    const ms = R.ms.slice().sort((a, b) => a - b), avg = R.ms.reduce((a, b) => a + b, 0) / R.ms.length, p99 = ms[Math.floor(ms.length * 0.99)];
    const s = R.end || {};
    console.log(`seed ${seed} ${mode}: 19:10=${at(19.17)} пик ${Math.min(...peak)}–${Math.max(...peak)} 23:30=${at(23.5)} 00:45=${at(24.75)} ` +
      `групп≤${R.maxGroups} парал.${R.parallelAny} событий ${R.events.size} чат ${R.chat} разговоры ${JSON.stringify(R.results)} ` +
      `знаком ${s.met} контакт ${s.contacts} дог ${s.deals} пар ${R.pairs} фото ${s.photo} очки ${s.points} звание ${s.title?.title ?? '—'} ` +
      `шаг ${avg.toFixed(3)}/${p99.toFixed(2)}/${ms[ms.length - 1].toFixed(2)} мс полей ${w.nav.stats.fields}`);
    ok(R.end && typeof R.end.points === 'number', 'итог end не пришёл');
    ok(at(19.17) >= TT.crowd.early[0] && at(19.17) <= TT.crowd.early[1], `в 19:10 ${at(19.17)} человек (ждали ${TT.crowd.early})`);
    ok(Math.max(...peak) >= lo && Math.max(...peak) <= hi, `пик ${Math.max(...peak)} вне ${lo}–${hi}`);
    ok(Math.min(...peak) >= lo - 3, `провал в пике: ${Math.min(...peak)}`);
    ok(at(23.5) < Math.max(...peak), `к 23:30 никто не ушёл (${at(23.5)})`);
    ok(at(24.75) >= 1 && at(24.75) <= 12, `после полуночи ${at(24.75)} человек`);
    ok(!R.solid.length, `в мебели/стенах: ${R.solid.slice(0, 5).join('; ')} (${R.solid.length})`);
    ok(!R.stuck.length, `застряли: ${R.stuck.slice(0, 5).join('; ')} (${R.stuck.length})`);
    ok(!R.dup.length, `двое на месте: ${R.dup.slice(0, 5).join('; ')}`);
    ok(!R.near.length, `стоят друг в друге: ${R.near.slice(0, 5).join('; ')} (${R.near.length})`);
    ok(R.maxGroups >= 3, `мало групп: ${R.maxGroups}`);
    ok(R.parallelAny >= 2, 'нет параллельных разговоров за одним столом');
    if (fixture) ok(R.events.has('karaoke'), 'не было караоке-бомбы');
    ok(R.events.size >= (fixture ? 5 : 3), `мало событий: ${[...R.events]}`);
    ok(R.chat >= 2, `мало сообщений в телефон: ${R.chat}`);
    ok(p99 < 1.0 && avg < 0.2, `шаг медленный: сред ${avg.toFixed(3)} p99 ${p99.toFixed(3)} мс`);
    if (mode === 'good') {
      ok(s.contacts >= 3, `удачные карты не довели до контактов: ${s.contacts}`);
      ok(R.pairs >= 1, 'сведение не дало ни одной пары');
      ok(s.photo === 1, 'бот не попал на общее фото');
      ok(R.reveals >= 10, `мало раскрытий: ${R.reveals}`);
    } else {
      ok(s.contacts === 0, `неудачные карты дали контакты: ${s.contacts}`);
      ok((R.results.fail || 0) >= 3 && (R.results.fail || 0) >= (R.results.tired || 0), `неудачные карты не срывают разговор: ${JSON.stringify(R.results)}`);
    }
  }
}
// повторяемость: тот же сид — тот же вечер
{
  const a = run(SEEDS[0], 'good').end, b = run(SEEDS[0], 'good').end;
  ok(JSON.stringify(a) === JSON.stringify(b), 'один сид — разные итоги (недетерминированность)');
}
// «иду встречать»: игрок ждёт у входа — автор сообщения, войдя, знакомится на бегу (ступень ≥ 2)
{
  const w = new World(CONTENT, { seed: SEEDS[0] });
  let msg = null;
  w.bus.on('chat', e => { const n = e.msg.fromId && w.people.get(e.msg.fromId); if (!msg && n && !n.present && e.msg.options.some(o => o.fx?.meet || o.ok)) msg = e.msg; });
  while (!w.over && !msg) w.step(DT);
  ok(!!msg, 'нет сообщения с «иду встречать»');
  if (msg) {
    w.act({ type: 'reply', msg: msg.id, option: msg.options.findIndex(o => o.fx?.meet || o.ok) });
    const n = w.people.get(msg.fromId), D = w.LAY.door;
    w.player.x = D.x; w.player.z = D.z + 0.8;
    const h0 = w.hour;
    while (!w.over && w.hour < h0 + 1.5 && n.step < 2) { w.step(DT); w.player.x = D.x; w.player.z = D.z + 0.8; }
    ok(n.step >= 2 && n.metAtDoor, `встреча у входа не сработала (ступень ${n.step}, пришёл ${n.present})`);
  }
}
// пустой вечер без игрока — тоже доходит до конца
{ const R = run(SEEDS[0], 'idle'); ok(R.end && R.end.contacts === 0, 'вечер без игрока не закончился'); }
}
console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'всё зелёное');
process.exit(fails ? 1 : 0);
