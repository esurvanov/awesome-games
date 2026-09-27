// «Окно роли»: content-graph.md's proposed permanent test — прогоняет единственную роль по её РЕАЛЬНОМУ
// окну времени/км (много сидов × несколько политик выбора) и сверяет с ним `when` каждого события, письма
// в телефоне, фоновой реплики чата и слуха. Плюс — реально пройденные календарные правила.
//   node tests/reachability.js
// Отчёт: консоль (таблицы) + tests/reachability-report.json (для инструментов) и .md (для людей/сценаристов).
//
// Метод: N сидов × 4 политики выбора в развилках (honest / speedrunner (без платных обходов) /
// greedy-shortcuts (платит за скорость) / random) — как в audit/p2 и audit/cg, но без завязки на
// конкретные id событий (это по духу продолжение content-graph.md/2-playthroughs.md, только политики
// выбирают по ФОРМЕ fx: «это конец игры?», «это платный обход очереди (advance/bypass/escort)?» —
// так тест не ломается, когда контент events.js меняется). Дополнительно — «активный» слой (как в
// audit/cg/sim.mjs): бот периодически заходит к продавцам, соседям по ряду и пешим рядом — иначе
// содержимое, завязанное на near/item/trust, никогда не получает шанса сработать.
//
// Каждый прогон пишет: (км, день, час) раз в игровой час — это и есть «реальное окно» роли; плюс
// каждое сработавшее событие+выбор, доставленное сообщение/реплику чата, узнанный/раскрытый слух,
// каждое календарное правило, действовавшее, пока игрок в игре (не на предпрогоне без роли).
// Дальше это сверяется со СТАТИЧЕСКИ объявленным `when` каждой единицы контента: если ни один прогон
// ни разу не попадает в окно — контент недостижим, и тест объясняет, каким именно полем (days/hours/kpp/
// rule/weather) окно разошлось с тем, что вообще может увидеть эта роль.
import { loadGame } from './game.js';
import { writeFileSync } from 'node:fs';
const L = loadGame();
const { CONTENT: C } = L.use('content/index');
const { World } = L.use('sim/world');
const { Clock } = L.use('core');

// ───────────────────── настройки прогона ─────────────────────
const SEED_FROM = 1, SEED_TO = 26; // 26 сидов
const POLICIES = ['honest', 'speedrunner', 'greedy-shortcuts', 'random'];
const T_STEP = 30; // игровых секунд за шаг ТОЛЬКО в этом тесте (< 60 — минутные события не пропускаются;
                    // втрое реже шагов, чем игровой T.time.step=10, — так 26×4 полных прохождений укладываются
                    // в разумное время; на сам движок/баланс не влияет, это только скорость этого прогона)
const CAL_END = '2022-10-01 00:00'; // календарь кончается здесь (world.end('time'))
const LATE_CUTOFF_DAY = 28; // день (число сентября), с которого окно «структурно недостижимо одной ролью»
                             // (роль стартует 25.09 21:00, проходит КПП в среднем ~49,8 ч ± 1,85 ч — см.
                             // tests/invariants.js «Очередь: разброс времени прохода КПП»); используется
                             // только для группировки отчёта, не для того, «упало» или нет
const fails0 = [];
const ok = (cond, msg, extra = '') => { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + msg + (extra !== '' ? '  ' + extra : '')); if (!cond) fails0.push(msg); };

const clockRef = new Clock(C.CALENDAR);
const dayOf = str => clockRef.date(clockRef.parse(str)).d;
const arr = x => Array.isArray(x) ? x : [x];
function inRangeWrap(v, a, b) { return a <= b ? v >= a && v <= b : v >= a || v <= b; }

// mulberry32 — независимый от игрового RNG источник для выбора между разрешёнными вариантами (как в audit/cg/sim.mjs)
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ───────────────────── политики: классификация по ФОРМЕ fx, не по id ─────────────────────
function fxEnds(fx) { return !!(fx && (fx.end || fx.risk?.fx?.end)); }
function fxShortcut(fx) {
  if (!fx) return false;
  const buy = fx.buy || fx.risk?.fx?.buy;
  return !!(fx.advance || fx.risk?.fx?.advance || (buy && ['bypass', 'escort'].includes(buy.good)));
}
function pickChoice(policy, opts, P) { // opts: [{ch,i,why}] — уже отфильтрованы по why===''
  if (!opts.length) return null;
  if (policy === 'honest') {
    const safe = opts.filter(o => !fxEnds(o.ch.fx) && !fxShortcut(o.ch.fx));
    const pool = safe.length ? safe : opts;
    return pool[Math.floor(P() * pool.length)];
  }
  if (policy === 'speedrunner') { // избегает ПЛАТНЫХ обходов, но берёт любой бесплатный/быстрый конец
    const end = opts.filter(o => fxEnds(o.ch.fx) && !fxShortcut(o.ch.fx));
    if (end.length) return end[0];
    const safe = opts.filter(o => !fxShortcut(o.ch.fx));
    const pool = safe.length ? safe : opts;
    return pool[Math.floor(P() * pool.length)];
  }
  if (policy === 'greedy-shortcuts') { // платит за скорость при любой возможности
    const sc = opts.filter(o => fxShortcut(o.ch.fx));
    if (sc.length) return sc[0];
    const end = opts.filter(o => fxEnds(o.ch.fx));
    if (end.length) return end[0];
    return opts[Math.floor(P() * opts.length)];
  }
  return opts[Math.floor(P() * opts.length)]; // random
}

// ───────────────────── агрегация: «реальное окно» роли (по всем сидам×политикам) ─────────────────────
const G = {
  runs: 0,
  daysPresent: new Set(), hoursPresent: new Set(), weatherPresent: new Set(),
  kmMin: Infinity, kmMax: -Infinity, kmByDay: {},
  rulesActive: new Set(),
  ends: {}, endDay: {},
};
const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
const setAdd = (m, k, v) => { (m[k] ||= new Set()).add(v); };

const EVENTS_FIRED = {}, CHOICES_CHOSEN = {}, CHOICE_OFFERED = {}, CHOICE_BLOCKED = {}, CHOICE_BLOCK_WHY = {};
const MSG_DELIVERED = {}, CHATTER_DELIVERED = {}, RUM_LEARNED = {}, RUM_REVEAL_SEEN = {};

// строка ключа прогона — для множеств «в скольких прогонах реально встретилось» (не «сколько раз всего»)
const runKey = (policy, seed) => policy + ':' + seed;

// текст фоновой реплики после подстановки {km} → назад к «{km}» (обратный tpl, как в audit/cg/sim.mjs) —
// так удаётся сопоставить пришедшее сообщение с исходной записью в PHONE.chatter по тексту
const chatterIndexByNormText = new Map();
C.PHONE.chatter.forEach((c, i) => chatterIndexByNormText.set(c.text, i));
function chatterIndexFor(text) { return chatterIndexByNormText.get(text.replace(/\d+,\d/, '{km}')); }

// ───────────────────── один прогон ─────────────────────
function runOne(seed, policy) {
  const P = prng(seed * 104729 + policy.length * 7 + 3);
  const w = new World(C, { seed });
  const pending = []; w.busy = () => pending.length > 0;
  const key = runKey(policy, seed);

  w.bus.on('event', e => pending.push(e));
  w.bus.on('rumour:learn', r => setAdd(RUM_LEARNED, r.id, key));
  w.bus.on('phone', m => {
    if (m.src != null) setAdd(MSG_DELIVERED, m.src, key);
    else if (m.reveal && m.rumour) setAdd(RUM_REVEAL_SEEN, m.rumour, key);
    else if (m.from === 'chat' && !m.rumour) { const i = chatterIndexFor(m.text); if (i != null) setAdd(CHATTER_DELIVERED, i, key); }
    if (m.replies && m.src != null) replyQ.push(m);
  });
  let endId = null, endDay = null;
  w.bus.on('end', () => { endId = w.ended.id; endDay = w.clock.date().d; });
  const replyQ = [];

  w.init('artyom');

  const choose = ev => {
    const e = ev.e; setAdd(EVENTS_FIRED, e.id, key);
    const all = e.choices.map((ch, i) => ({ ch, i, why: w.choiceBlock(ch, ev) }));
    for (const o of all) {
      bump(CHOICE_OFFERED, e.id + '#' + o.i);
      if (o.why) { bump(CHOICE_BLOCKED, e.id + '#' + o.i); bump(CHOICE_BLOCK_WHY, e.id + '#' + o.i + ':' + o.why); }
    }
    const valid = all.filter(o => !o.why);
    const o = pickChoice(policy, valid, P);
    if (!o) return; // все варианты заблокированы — карточка просто закрывается (движок это допускает)
    setAdd(CHOICES_CHOSEN, e.id + '#' + o.i, key);
    w.choose(ev, o.ch);
  };
  const flush = () => {
    let g = 0; while (pending.length && !w.ended && g++ < 50) choose(pending.shift()); pending.length = 0;
    while (replyQ.length) { const m = replyQ.shift(); const k = Math.floor(P() * m.replies.length); w.reply(m, k); }
  };
  const act = (a, tg) => {
    const r = w.doAction(a, tg);
    if (r.ui?.kind === 'shop') {
      const sel = tg.seller, goods = (r.ui.only ? [r.ui.only] : sel.goods).filter(g => (sel.stock[g] ?? 0) >= 1);
      if (goods.length) { const g = goods[Math.floor(P() * goods.length)]; const opt = w.econ.payOptions(w.player, sel, g, w.econ.price(sel, g, w.trustOf(sel.npc))).find(x => x.ok); if (opt) w.buy(sel, g, opt); }
    }
    if (r.ui?.kind === 'exchange') w.exchange(tg.seller, 100);
    if (r.ui?.kind === 'give') { const it = Object.keys(w.player.items).filter(k => w.player.items[k] > 0); if (it.length && P() < 0.6) w.give(tg, it[Math.floor(P() * it.length)]); else w.give(tg, 'money', 500); }
    flush();
  };
  const tryActs = tg => {
    const list = w.actionsFor(tg).filter(x => !x.why && x.a.op !== 'freeTalk' && !['phone', 'bag', 'leave', 'toCar'].includes(x.a.id));
    if (list.length) act(list[Math.floor(P() * list.length)].a, tg);
  };

  // ── реальное окно роли: сэмпл раз в игровой час + правила, которые действовали, пока игрок «в игре» ──
  let lastSampledHour = -1;
  const sample = () => {
    const hr = Math.floor(w.clock.t / 3600); if (hr === lastSampledHour) return; lastSampledHour = hr;
    const d = w.clock.date().d, km = w.playerKpp() / 1000;
    G.daysPresent.add(d); G.hoursPresent.add(Math.floor(w.clock.hour)); G.weatherPresent.add(w.env.weather());
    G.kmMin = Math.min(G.kmMin, km); G.kmMax = Math.max(G.kmMax, km);
    const kd = (G.kmByDay[d] ||= [Infinity, -Infinity]); kd[0] = Math.min(kd[0], km); kd[1] = Math.max(kd[1], km);
    for (const r of C.CALENDAR.rules) if (w.env.rule(r.id)) { G.rulesActive.add(r.id); setAdd(G.rulesActiveBy ||= {}, r.id, key); }
  };

  flush();
  let nextAct = w.clock.t + 1800;
  const endT = w.clock.parse(CAL_END) + 120;
  let guard = 0;
  while (!w.ended && w.clock.t < endT && guard++ < 400000) {
    w.step(T_STEP); flush(); sample();
    if (w.clock.t >= nextAct && !w.ended) {
      nextAct = w.clock.t + (30 + P() * 60) * 60;
      const p = w.player, n = p.needs, car = w.pcar;
      for (const [need, ids] of [['hunger', ['pie', 'meal', 'snack', 'bread', 'choco']], ['thirst', ['water']], ['charge', ['powerbank']], ['warmth', ['blanket']]])
        if (n[need] < 40) { const id = ids.find(i => p.items[i] > 0); if (id) w.useItem(id); }
      if (car && p.items.fuel > 0 && car.fuel < 6) act(C.ACTIONS.find(a => a.id === 'refuel'), { kind: 'own', car });
      if (car && w.env.night() && n.warmth < 45 && car.fuel > 2 && !p.flags.engine) act(C.ACTIONS.find(a => a.id === 'engineOn'), { kind: 'own', car });
      if (car && p.flags.engine && (n.warmth > 80 || car.fuel < 2)) act(C.ACTIONS.find(a => a.id === 'engineOff'), { kind: 'own', car });
      if (n.sleep < 20 && p.inCar && !p.sleeping) act(C.ACTIONS.find(a => a.id === 'sleep'), { kind: 'own', car });
      const r = P();
      if (r < 0.45) {
        const sel = w.econ.nearest(w.playerS(), null, 700);
        if (sel) { p.inCar = false; p.x = sel.x; p.y = sel.y; if (p.sleeping) w.wake('x'); tryActs({ kind: 'seller', seller: sel, npc: sel.npc }); if (!w.ended) w.enterCar(); }
      } else if (r < 0.8 && car) {
        const same = w.queue.cars.filter(c => c.lane === car.lane), i = same.indexOf(car), c = same[i + (P() < 0.5 ? -1 : 1)];
        if (c) tryActs({ kind: 'car', car: c, npc: c.npc || 'c:' + c.id + ':0', who: c.npc ? null : w.person(c.id, 0) });
      } else if (r < 0.92) {
        const named = C.PEOPLE.filter(q => q.kind === 'walker' && w.npcPresent(q.id) && !w.npcs[q.id].passenger);
        if (named.length && P() < 0.6) tryActs({ kind: 'person', npc: named[Math.floor(P() * named.length)].id });
        else { const ped = w.queue.peds.find(q => Math.abs(q.s - w.playerS()) < 60); if (ped) tryActs({ kind: 'person', ped, who: w.pedPerson(ped) }); }
      } else tryActs({ kind: 'self' });
    }
  }
  sample();
  G.runs++; bump(G.ends, endId || 'none'); bump(G.endDay, (endId || 'none') + '@' + (endDay ?? '?'));
  return { seed, policy, endId, endDay, waitedH: (w.clock.t - w.player.startT) / 3600, timedOut: guard >= 400000 };
}

// ───────────────────── прогон всех сидов × политик ─────────────────────
const t0 = Date.now();
const summaries = [];
for (const policy of POLICIES) for (let seed = SEED_FROM; seed <= SEED_TO; seed++) {
  try { summaries.push(runOne(seed, policy)); }
  catch (e) { summaries.push({ seed, policy, crash: String(e.stack || e).slice(0, 500) }); console.log('  CRASH', policy, seed, e.message); }
}
const ms = Date.now() - t0;
console.log(`\n${summaries.length} прогонов (${SEED_TO - SEED_FROM + 1} сидов × ${POLICIES.length} политики) за ${(ms / 1000).toFixed(1)} с\n`);

// ───────────────────── сверка: окно «when» vs реальное окно роли (G) ─────────────────────
function windowReasons(when) {
  if (!when) return [];
  const out = [];
  if (when.days) { const [a, b] = arr(when.days).length === 2 ? when.days : [when.days, when.days]; if (![...G.daysPresent].some(d => inRangeWrap(d, a, b))) out.push(`days:[${a},${b}] — роль не застаёт эти числа (была: ${[...G.daysPresent].sort((x, y) => x - y).join(',')})`); }
  if (when.hours) { const [a, b] = when.hours; if (![...G.hoursPresent].some(h => inRangeWrap(h, a, b))) out.push(`hours:[${a},${b}] — этот час никогда не сэмплирован при игроке`); }
  if (when.kpp) { const [a, b] = when.kpp; if (!(G.kmMax >= a && G.kmMin <= b)) out.push(`kpp:[${a},${b}] км — трасса игрока [${G.kmMin.toFixed(1)},${G.kmMax.toFixed(1)}] км не пересекается`); }
  if (when.rule) for (const r of arr(when.rule)) { if (r[0] === '!') continue; if (!G.rulesActive.has(r)) out.push(`rule:'${r}' — ни разу не было активно, пока роль в игре`); }
  if (when.weather) { if (!arr(when.weather).some(x => G.weatherPresent.has(x))) out.push(`weather:${JSON.stringify(when.weather)} — такой погоды не было ни в один из застигнутых дней (были: ${[...G.weatherPresent].join(',')})`); }
  return out;
}
// Одна роль живёт [25.09 21:00 .. ~28.09 утро] (49,8 ч ± 1,85 ч до КПП — invariants.js). Контент за
// пределами этого окна с ОБЕИХ сторон структурно недостижим ЭТОЙ ролью — не баг, а «нужна вторая роль»
// (content-graph.md §6, meaning.md 1.14): calendar-правила/события 22–23.09 закончились ДО того, как роль
// появляется (presim идёт крупным шагом без игрока — событию неоткуда взяться), а 28–30.09 роль обычно уже
// прошла КПП. Обе стороны — «report, not hard-fail» (задача, п.4), поэтому размечаем и раннюю, и позднюю.
const ROLE_START_T = clockRef.parse(C.ROLES[0].start);
const LATE_CUTOFF_T = clockRef.parse(`2022-09-${LATE_CUTOFF_DAY} 00:00`);
const EARLY_RULES = new Set(C.CALENDAR.rules.filter(r => (r.to ? clockRef.parse(r.to) : Infinity) <= ROLE_START_T).map(r => r.id));
const LATE_RULES = new Set(C.CALENDAR.rules.filter(r => clockRef.parse(r.from) >= LATE_CUTOFF_T).map(r => r.id));
const OUT_RULES = new Set([...EARLY_RULES, ...LATE_RULES]);
// погода — тот же «рано/поздно», только по календарным фактам: у каждого дня в CALENDAR.days ровно одна
// погода (research/timeline.md), и она не подбирается — значит «нужной погоды не было в окне роли» так же
// не баг, как и «нужного дня не было в окне роли» (23–24.09 — дождь и шторм, но роль начинается 25.09).
const REACHABLE_WEATHER = new Set(C.CALENDAR.days.filter(d => { const t = clockRef.parse(`${d.date} 12:00`); return t >= ROLE_START_T && t < LATE_CUTOFF_T; }).map(d => d.weather));
function outOfReach(when) { // «не баг, роль физически не может там оказаться» — для events/report-бакета
  if (!when) return false;
  if (when.days) { const [a, b] = arr(when.days).length === 2 ? when.days : [when.days, when.days]; const t0 = clockRef.parse(`2022-09-${String(a).padStart(2, '0')} 00:00`), t1 = clockRef.parse(`2022-09-${String(b).padStart(2, '0')} 23:59`); if (t1 <= ROLE_START_T || t0 >= LATE_CUTOFF_T) return true; }
  if (when.rule) return arr(when.rule).some(r => r[0] !== '!' && OUT_RULES.has(r));
  if (when.weather && !when.days) return !arr(when.weather).some(x => REACHABLE_WEATHER.has(x));
  return false;
}

const total = summaries.filter(s => !s.crash).length;
const pct = set => total ? Math.round(100 * (set ? set.size : 0) / total) : 0;

// ── события + выборы ──
const eventRows = C.EVENTS.map(e => {
  const fired = EVENTS_FIRED[e.id], p = pct(fired), late = outOfReach(e.when);
  const reasons = p === 0 ? (windowReasons(e.when).length ? windowReasons(e.when) : ['окно (days/hours/kpp/rule/weather) в принципе достижимо — блокирует, видимо, состояние (item/money/trust/near/flag/signal/chance/passengers/fuel/npc-присутствие); нужен разбор вручную']) : [];
  const choices = e.choices.map((ch, i) => {
    const key = e.id + '#' + i, offered = CHOICE_OFFERED[key] || 0, chosen = CHOICES_CHOSEN[key], blocked = CHOICE_BLOCKED[key] || 0;
    return { i, label: ch.label, offered, chosenRuns: chosen ? chosen.size : 0, blocked, alwaysBlocked: offered > 0 && blocked === offered, whys: Object.keys(CHOICE_BLOCK_WHY).filter(k => k.startsWith(key + ':')).map(k => k.slice(key.length + 1) + ' ×' + CHOICE_BLOCK_WHY[k]) };
  });
  return { id: e.id, npc: e.npc || null, when: e.when || null, firedRuns: fired ? fired.size : 0, pct: p, late, reasons, choices };
});

// ── телефон: сообщения из дома (расписанные) ──
const msgRows = C.PHONE.messages.map((m, i) => {
  const d = MSG_DELIVERED[i], p = pct(d);
  const at = m.at, day = dayOf(at);
  const reasons = p === 0 ? [`at:'${at}' — день ${day} ${G.daysPresent.has(day) ? '(застигнут, но час/состояние не совпало)' : 'роль не застаёт'}`] : [];
  return { i, chat: m.chat, at, text: m.text.slice(0, 60), deliveredRuns: d ? d.size : 0, pct: p, late: day >= LATE_CUTOFF_DAY, reasons };
});
// ── телефон: фоновые реплики чата ──
const chatterRows = C.PHONE.chatter.map((c, i) => {
  const d = CHATTER_DELIVERED[i], p = pct(d);
  const reasons = p === 0 ? (windowReasons(c.when).length ? windowReasons(c.when) : ['окно достижимо, но реплика ни разу не выпала (фон случаен, 18% доля/сутки) — редкость, не обязательно баг']) : [];
  return { i, chat: c.chat, text: c.text.slice(0, 50), when: c.when || null, deliveredRuns: d ? d.size : 0, pct: p, late: outOfReach(c.when), reasons };
});

// ── слухи: узнаны / раскрытие увидено ──
// (слух ≠ правило: слух не гасится, если роль не была ровно в момент from — он расходится и держится в
// очереди, узнать можно позже; поэтому «рано» тут не считаем, только «поздно» — from/revealAt/confirm
// на 28.09+, когда роль обычно уже прошла КПП)
const rumRows = C.RUMOURS.map(r => {
  const learned = RUM_LEARNED[r.id], seen = RUM_REVEAL_SEEN[r.id];
  const pL = pct(learned), pS = pct(seen);
  const deadReveal = !!(r.reveal && !r.revealAt && !r.confirm); // reveal-текст есть, но rum.step() никогда не поставит revealed=true
  const hasReveal = !!(r.revealAt || r.confirm) && !deadReveal;
  const revealAtT = r.revealAt ? clockRef.parse(r.revealAt) : (r.confirm ? clockRef.parse(C.CALENDAR.rules.find(x => x.id === r.confirm)?.from || C.CALENDAR.start) : null);
  const learnLate = clockRef.parse(r.from) >= LATE_CUTOFF_T;
  const revealLate = hasReveal && revealAtT != null && revealAtT >= LATE_CUTOFF_T;
  const late = learnLate || revealLate;
  const learnDay = dayOf(r.from);
  const reasonsLearn = pL === 0 ? [`from:'${r.from}', at:'${r.at}' — ${G.daysPresent.has(learnDay) ? 'день застигнут, но участок (' + r.at + ') или доля знающих не пересеклись' : 'день ещё не наступил для роли'}`] : [];
  const reasonsSeen = deadReveal ? ['есть reveal-текст, но нет revealAt/confirm — sim/rumours.js.step() никогда не поставит revealed:true (структурный баг данных, не окна роли)']
    : (hasReveal && pS === 0 ? [learned ? 'слух узнан, но раскрытие ни разу не пришло по чату (проверить revealAt/confirm относительно окна роли)' : 'слух и не узнан ни разу — раскрытие тем более недостижимо'] : []);
  return { id: r.id, truth: r.truth, from: r.from, at: r.at, revealAt: r.revealAt || null, confirm: r.confirm || null, learnedPct: pL, hasReveal, deadReveal, seenPct: hasReveal ? pS : null, late, reasonsLearn, reasonsSeen };
});

// ── календарные правила ──
const ruleRows = C.CALENDAR.rules.map(r => {
  const seen = G.rulesActive.has(r.id), by = (G.rulesActiveBy || {})[r.id];
  const side = EARLY_RULES.has(r.id) ? 'рано (кончилось до роли)' : LATE_RULES.has(r.id) ? 'поздно (28-30.09)' : '';
  return { id: r.id, from: r.from, to: r.to, seenRuns: by ? by.size : 0, pct: pct(by), outOfReach: !!side, side, seen };
});

// ───────────────────── консольный отчёт ─────────────────────
function table(title, rows, cols) {
  console.log('\n### ' + title);
  console.table(rows.map(r => Object.fromEntries(cols.map(c => [c[0], c[1](r)]))));
}
console.log('═══ РЕАЛЬНОЕ ОКНО РОЛИ (по ' + total + ' прогонам) ═══');
console.log('дни:', [...G.daysPresent].sort((a, b) => a - b).join(', '));
console.log('км до КПП:', G.kmMin.toFixed(1), '..', G.kmMax.toFixed(1));
console.log('правила, действовавшие при игроке:', [...G.rulesActive].join(', ') || '(нет)');
console.log('погода дней в окне:', [...G.weatherPresent].join(', '));
console.log('концовки:', JSON.stringify(G.ends));

table('События — недостижимые (0%)', eventRows.filter(r => r.pct === 0), [
  ['id', r => r.id], ['npc', r => r.npc || ''], ['late?', r => r.late ? '28-30.09' : ''], ['причина', r => r.reasons.join(' | ').slice(0, 90)],
]);
table('События — редкие (0% < x < 10%)', eventRows.filter(r => r.pct > 0 && r.pct < 10), [['id', r => r.id], ['%', r => r.pct]]);
const deadChoices = eventRows.flatMap(r => r.choices.filter(c => c.alwaysBlocked).map(c => ({ event: r.id, i: c.i, label: c.label, offered: c.offered, whys: c.whys.join('; ') })));
table('Выборы, заблокированные ВСЕГДА (offered>0, chosen=0)', deadChoices, [['event', r => r.event], ['#', r => r.i], ['label', r => r.label], ['показан раз', r => r.offered], ['почему', r => r.whys.slice(0, 70)]]);

table('Телефон: письма из дома — недостижимые', msgRows.filter(r => r.pct === 0), [['#', r => r.i], ['chat', r => r.chat], ['at', r => r.at], ['текст', r => r.text], ['причина', r => r.reasons.join(' | ')]]);
table('Телефон: письма — редкие', msgRows.filter(r => r.pct > 0 && r.pct < 15), [['#', r => r.i], ['chat', r => r.chat], ['at', r => r.at], ['%', r => r.pct]]);
table('Телефон: фоновые реплики — недостижимые', chatterRows.filter(r => r.pct === 0), [['#', r => r.i], ['chat', r => r.chat], ['текст', r => r.text], ['причина', r => r.reasons.join(' | ').slice(0, 90)]]);

table('Слухи: не узнаны ни разу', rumRows.filter(r => r.learnedPct === 0), [['id', r => r.id], ['from', r => r.from], ['at', r => r.at], ['причина', r => r.reasonsLearn.join(' | ')]]);
table('Слухи: раскрытие ни разу не увидено (после того, как узнан) / мёртвый reveal', rumRows.filter(r => r.deadReveal || (r.hasReveal && r.seenPct === 0)), [['id', r => r.id], ['truth', r => r.truth], ['узнан, %', r => r.learnedPct], ['revealAt/confirm', r => r.revealAt || r.confirm || '—'], ['мёртвый reveal?', r => r.deadReveal ? 'да (нет revealAt/confirm)' : ''], ['late?', r => r.late ? '28-30.09' : ''], ['причина', r => r.reasonsSeen.join(' | ')]]);

table('Календарные правила — активность при игроке', ruleRows, [['id', r => r.id], ['from', r => r.from], ['seen?', r => r.seen ? 'да' : 'НЕТ'], ['%', r => r.pct], ['вне окна роли?', r => r.side]]);

// ───────────────────── JSON + Markdown отчёт в файлы ─────────────────────
const report = { generatedAt: new Date().toISOString(), seeds: [SEED_FROM, SEED_TO], policies: POLICIES, runs: total, ms, window: { days: [...G.daysPresent].sort((a, b) => a - b), km: [G.kmMin, G.kmMax], kmByDay: G.kmByDay, rulesActive: [...G.rulesActive], weather: [...G.weatherPresent], ends: G.ends }, events: eventRows, phoneMessages: msgRows, chatter: chatterRows, rumours: rumRows, rules: ruleRows };
writeFileSync(new URL('./reachability-report.json', import.meta.url), JSON.stringify(report, null, 1));

function mdTable(rows, cols) {
  const head = '| ' + cols.map(c => c[0]).join(' | ') + ' |\n' + '|' + cols.map(() => '---').join('|') + '|\n';
  return head + rows.map(r => '| ' + cols.map(c => String(c[1](r)).replace(/\|/g, '\\|').slice(0, 120)).join(' | ') + ' |').join('\n');
}
const md = [];
md.push('# Достижимость контента «Ларса» — окно роли Артёма\n');
md.push(`Сгенерировано автоматически: \`node tests/reachability.js\`. ${total} прогонов (${SEED_TO - SEED_FROM + 1} сидов × ${POLICIES.join(', ')}) за ${(ms / 1000).toFixed(1)} с.\n`);
md.push(`## Реальное окно роли\n\n- дни: ${[...G.daysPresent].sort((a, b) => a - b).join(', ')}\n- км до КПП: ${G.kmMin.toFixed(1)}–${G.kmMax.toFixed(1)}\n- правила, действовавшие при игроке: ${[...G.rulesActive].join(', ') || '—'}\n- погода: ${[...G.weatherPresent].join(', ')}\n- концовки: ${JSON.stringify(G.ends)}\n`);
md.push('## События\n\n' + mdTable(eventRows, [['id', r => r.id], ['npc', r => r.npc || ''], ['%', r => r.pct], ['late (28–30.09)?', r => r.late ? 'да' : ''], ['причина (если 0%)', r => r.reasons.join(' | ')]]));
md.push('\n\n## Выборы, заблокированные всегда\n\n' + (deadChoices.length ? mdTable(deadChoices, [['event', r => r.event], ['#', r => r.i], ['label', r => r.label], ['показан раз', r => r.offered], ['почему', r => r.whys]]) : '(нет)'));
md.push('\n\n## Письма из дома\n\n' + mdTable(msgRows, [['#', r => r.i], ['chat', r => r.chat], ['at', r => r.at], ['%', r => r.pct], ['причина (если 0%)', r => r.reasons.join(' | ')]]));
md.push('\n\n## Фоновые реплики чата\n\n' + mdTable(chatterRows, [['#', r => r.i], ['chat', r => r.chat], ['текст', r => r.text], ['%', r => r.pct], ['причина (если 0%)', r => r.reasons.join(' | ')]]));
md.push('\n\n## Слухи\n\n' + mdTable(rumRows, [['id', r => r.id], ['truth', r => r.truth], ['узнан %', r => r.learnedPct], ['раскрытие увидено %', r => r.seenPct ?? '—'], ['мёртвый reveal?', r => r.deadReveal ? 'да' : ''], ['late (28–30.09)?', r => r.late ? 'да' : ''], ['причина', r => [...r.reasonsLearn, ...r.reasonsSeen].join(' | ')]]));
md.push('\n\n## Календарные правила\n\n' + mdTable(ruleRows, [['id', r => r.id], ['from', r => r.from], ['видел игрок?', r => r.seen ? 'да' : 'НЕТ'], ['%', r => r.pct], ['вне окна роли?', r => r.side]]));
writeFileSync(new URL('./reachability-report.md', import.meta.url), md.join('\n') + '\n');
console.log('\nотчёт: tests/reachability-report.json, tests/reachability-report.md');

// ───────────────────── провальные проверки (блокируют suite) ─────────────────────
console.log('\n═══ ПРОВЕРКИ ═══');
let fails = fails0.length;
const assertOk = (cond, msg, extra = '') => { ok(cond, msg, extra); if (!cond) fails++; };

// 1) каждое календарное правило РЕАЛЬНОГО окна (не рано/не поздно) хоть раз действовало при игроке
for (const r of ruleRows.filter(r => !r.outOfReach)) assertOk(r.seen, `правило '${r.id}' (${r.from}) действовало при игроке хотя бы в одном прогоне`, r.seen ? `${r.pct}%` : '0%');
for (const r of ruleRows.filter(r => r.outOfReach)) ok(true, `правило '${r.id}' (${r.from}) — ${r.side}, структурно вне окна роли (репорт, не провал)`, r.seen ? `но встретилось! ${r.pct}%` : '0%, как ожидалось');

// 1б) reveal-текст без revealAt/confirm — структурно мёртвый код в любом окне (движок никогда не поставит
// revealed:true), это не про окно роли вообще — хард-фейл при любой дате
for (const r of rumRows) assertOk(!r.deadReveal, `слух '${r.id}': reveal-текст имеет revealAt/confirm (иначе rum.step() никогда не пошлёт его)`);

// 2) каждый слух с раскрытием (revealAt/confirm) РЕАЛЬНОГО окна — увиден хотя бы в одном прогоне, ПОСЛЕ узнавания
for (const r of rumRows.filter(r => r.hasReveal && !r.late)) assertOk(r.seenPct > 0, `слух '${r.id}': разоблачение увидено хотя бы раз (после узнавания)`, `узнан ${r.learnedPct}%, раскрытие увидено ${r.seenPct}%`);
for (const r of rumRows.filter(r => r.hasReveal && r.late)) ok(true, `слух '${r.id}': раскрытие после 28.09 — структурно позже окна роли (репорт, не провал)`, `${r.seenPct}%`);

// 3) ни одно событие не «мертво по окну» (days/hours/kpp/rule/weather вообще не пересекаются с ролью) —
// отдельно от «мертво по состоянию»: если окно само по себе недостижимо, это и есть содержательный провал
for (const r of eventRows) {
  const winDead = r.pct === 0 && windowReasons(r.when).length > 0;
  if (r.late) { ok(true, `событие '${r.id}' — окно вне пределов роли (рано и/или 28-30.09), репорт, не провал`, r.pct + '%'); continue; }
  assertOk(!winDead, `событие '${r.id}': окно (days/hours/kpp/rule/weather) пересекается с реальным окном роли хотя бы теоретически`, winDead ? windowReasons(r.when).join(' | ') : `${r.pct}%`);
}

console.log(fails ? `\n${fails} FAIL` : '\nвсё ок');
process.exit(fails ? 1 : 0);
