// Баланс сил и темпа: «человек» играет вечер в своём темпе — думает над картой, ходит по залу, смотрит телефон,
// стоит без дела. Знает только то, что видно игроку: раскрытые поля карточки, реакции на свои реплики.
// Профили: активный, средний, осторожный + неудачный (жмёт что попало). Много сидов без браузера (World в Node).
//   node balance.js [seeds=24] [--browser]      --browser — ещё пара прогонов в Playwright (тот же бот через SKHODKA.w)
// Цели (проверяются, код выхода 1 при провале):
//   средний: заказов 3–6, знакомств 8–15, контактов 4–8, пар 1–4, договорились 1–4 (можно 2–4 у активного)
//   активный: силы не на нуле раньше 22:00; неудачный — явно хуже среднего по очкам
import { load } from './load.js';

// ─────────── профили ───────────
export const PROFILES = {
  active:   { title: 'активный',   think: [1.5, 3.5], idle: [2, 8],  phone: 0.15, wander: 0.25, stand: 0.2, turns: [9, 14], orderAt: 0.18, barWalk: 0.5, outside: 0.05, skill: 0.75, intro: 0.8, bold: 0.8, pickNear: 0.6, photo: 0.95 },
  average:  { title: 'средний',    think: [2, 5],     idle: [4, 14], phone: 0.3,  wander: 0.35, stand: 0.35, turns: [7, 12], orderAt: 0.22, barWalk: 0.4, outside: 0.1, skill: 0.55, intro: 0.55, bold: 0.6, pickNear: 0.7, photo: 0.8 },
  cautious: { title: 'осторожный', think: [3, 6],     idle: [8, 22], phone: 0.45, wander: 0.3,  stand: 0.5,  turns: [5, 9],  orderAt: 0.3,  barWalk: 0.3, outside: 0.2, skill: 0.45, intro: 0.3, bold: 0.35, pickNear: 0.85, photo: 0.6 },
  // неудачный: темп среднего, но реплики наугад, не смотрит на реакции и карточку
  clumsy:   { title: 'неудачный',  think: [2, 5],     idle: [4, 14], phone: 0.3,  wander: 0.35, stand: 0.35, turns: [7, 12], orderAt: 0.22, barWalk: 0.4, outside: 0.1, skill: 0,    intro: 0.55, bold: 0.6, pickNear: 0.7, photo: 0.8 },
  // активный без заказов: на сколько хватает стартовых сил
  dry:      { title: 'активный без заказов', think: [1.5, 3.5], idle: [2, 8], phone: 0.15, wander: 0.25, stand: 0.2, turns: [9, 14], orderAt: -1, barWalk: 0, outside: 0, skill: 0.75, intro: 0.8, bold: 0.8, pickNear: 0.6, photo: 0.95 },
};

// ─────────── бот: самодостаточная функция (переносится в браузер через toString) ───────────
// S — состояние бота (создаётся здесь при первом вызове), pf — профиль, seed — свой ГСЧ (не трогает w.rng)
export function human(w, S, pf, seed) {
  if (!S.init) {
    S.init = true; S.r = (seed * 2654435761) >>> 0 || 1;
    S.rnd = () => { S.r = (S.r * 1664525 + 1013904223) >>> 0; return S.r / 4294967296; };
    S.range = (a, b) => a + (b - a) * S.rnd();
    S.until = 0; S.mode = 'idle'; S.tried = {}; S.seen = {}; S.lastCard = null; S.turns = 0; S.maxTurns = 0;
    S.orders = 0; S.barWalks = 0; S.noEnergy = 0; S.firstNoEnergy = null; S.firstLow = null; S.minE = 1; S.talks = 0; S.intros = 0; S.introTried = {};
    S.talkSec = 0; S.phoneSec = 0; S.lastT = w.t; S.orderWait = 0; S.photoTried = false; S.energyAt = [];
    w.bus.on('talk:line', d => { if (d.who !== 'me' && S.lastCard && w.talk.cur && d.who === w.talk.cur.id && (d.mood === 'good' || d.mood === 'bad' || d.mood === 'meh')) {
      const k = d.who, st = S.lastCard.style; (S.seen[k] ||= {})[st] = (S.seen[k][st] || 0) + (d.mood === 'good' ? 1.5 : d.mood === 'bad' ? -2.5 : -0.2);
      S.react = d.mood; S.lastCard = null; } });
    w.bus.on('toast', d => { if (d.text === w.T.text.noEnergy) { S.noEnergy++; if (S.firstNoEnergy == null) S.firstNoEnergy = w.hour; } });
    w.bus.on('chat', d => { if (d.msg.options?.length) (S.inbox ||= []).push(d.msg); });
    w.bus.on('talk:end', () => { S.mode = 'idle'; S.until = w.t + S.range(...pf.idle) * 0.5; });
  }
  const rnd = S.rnd, range = S.range, P = w.player, T = w.talk, dt = w.t - S.lastT; S.lastT = w.t;
  if (T.cur) S.talkSec += dt; if (S.mode === 'phone') S.phoneSec += dt;
  S.minE = Math.min(S.minE, P.energy);
  if (P.energy < 0.08 && S.firstLow == null) S.firstLow = w.hour;
  if (w.t < S.until) return;
  const tick = (a, b) => { S.until = w.t + range(a, b); };

  // общее фото — идёт, если хочется
  if (w.events.some(e => e.effect.photo) && !w.score.photo && !S.photoTried) {
    S.photoTried = true; if (rnd() < pf.photo) { w.act({ type: 'photo' }); S.mode = 'photo'; tick(8, 15); return; }
  }
  if (S.mode === 'photo' && P.goal?.kind === 'photo') { tick(1, 2); return; }

  // ── разговор ──
  if (T.cur) {
    const c = T.cur, n = w.people.get(c.id);
    if (c.pending || !c.offer.length) { tick(0.2, 0.4); return; }
    if (S.mode !== 'think') { S.mode = 'think'; tick(...pf.think); return; }   // смотрит на карты
    S.mode = 'talk';
    S.turns++;
    const seen = S.seen[n.id] || {};
    // сил мало — вежливо закончить и пойти за пивом
    if (P.energy < pf.orderAt * 0.6 && rnd() < 0.7) { w.act({ type: 'endTalk' }); return; }
    if (S.turns > S.maxTurns || n.step >= 5) { w.act({ type: 'endTalk' }); return; }
    // свести с кем-то из знакомых, если видно, что подходят (раскрыты темы/нужды обоих)
    if (n.step >= 2 && rnd() < pf.intro * 0.35) {
      for (const m of w.list) {
        if (m === n || !m.present || m.step < 2) continue;
        const key = n.id < m.id ? n.id + '|' + m.id : m.id + '|' + n.id; if (S.introTried[key] || T.pairs.has(key)) continue;
        const need = (n.known.need && m.known.need) && ((n.need && n.need === m.offer) || (m.need && m.need === n.offer));
        const topic = n.known.topics && m.known.topics && n.topics.some(t => m.topics.includes(t));
        if (need || topic || rnd() < 0.04) { S.introTried[key] = 1; S.intros++; w.act({ type: 'introduce', a: n.id, b: m.id }); tick(1, 2); return; }
      }
    }
    // оценка карты глазами игрока
    // склад: раскрыт в карточке — или прочитан по поведению (подсказка tell) — умелый читает чаще
    if (S.tell?.id !== n.id) S.tell = { id: n.id, ok: rnd() < pf.skill * 0.6 };
    const mind = n.known.mind || S.tell.ok ? w.idx.MINDS[n.mind] : null;
    const good = (S.react === 'good') + (seen.__good || 0);
    let best = null, bs = -1e9;
    for (const k of c.offer) {
      let v = (1 - pf.skill) * 3 * rnd() + rnd() * 0.5;
      if (k.act === 'bye') v -= 6;
      else if (k.act === 'contact') v += (n.step >= 2 && (S.react === 'good' || n.step >= 3) && rnd() < pf.bold) ? 4 : -2;
      else if (k.act === 'deal') v += (n.step === 4 && (S.react !== 'bad') && (n.known.need || n.commonTopic) && rnd() < pf.bold) ? 5 : -2;
      else if (k.act === 'photo') v += rnd() < 0.2 ? 1 : -1;
      else if (k.act === 'introduce') v -= 1;
      else {
        v += pf.skill * (seen[k.style] || 0);
        if (mind) { if (mind.likes.includes(k.style)) v += 2 * pf.skill; if (mind.dislikes.includes(k.style)) v -= 3 * pf.skill; }
        if (k.topic && n.known.topics && n.topics.includes(k.topic)) v += 1.5 * pf.skill;
        if (k.topic && P.topics.includes(k.topic)) v += 0.3;
        if (c.last && c.last.style === k.style) v -= 0.8 * pf.skill;
        if (c.used.has(k.id)) v -= 1 * pf.skill;
      }
      if (v > bs) { bs = v; best = k; }
    }
    S.lastCard = best; S.react = null;
    w.act({ type: 'say', card: best.key });
    tick(0.3, 0.6);
    return;
  }
  // идёт к кому-то
  if (P.goal?.kind === 'approach') { tick(0.3, 0.5); return; }
  if (P.nav) { tick(0.5, 1); return; }
  // ждёт заказ
  if (P.orders.length) { tick(1, 2); return; }

  // ── между разговорами ──
  // силы: заказать (иногда сперва дойти до бара)
  if (P.energy < pf.orderAt) {
    const atBar = w.zoneOf(P.x, P.z) === 'bar';
    if (!atBar && !S.goingBar && rnd() < pf.barWalk) {
      const bar = w.spots.filter(s => s.zone === 'bar' && s.kind === 'stand' && !s.occ);
      const s = bar.length ? bar[Math.floor(rnd() * bar.length)] : null;
      if (s) { S.goingBar = true; S.barWalks++; w.act({ type: 'walk', x: s.x, z: s.z }); tick(1, 2); return; }
    }
    S.goingBar = false;
    const menu = w.T.menu || [], r = rnd();
    const it = r < 0.6 ? 'beer' : r < 0.75 ? 'coffee' : r < 0.9 ? 'rolls' : 'lemonade';
    w.act({ type: 'order', item: menu.some(m => m.id === it) ? it : menu[0].id }); S.orders++;
    S.energyAt.push(+w.hour.toFixed(2));
    tick(2, 4); return;
  }
  S.goingBar = false;
  // телефон: ответить на сообщение
  if (S.inbox?.length && rnd() < 0.6) {
    const m = S.inbox.shift(); if (m.answered == null) w.act({ type: 'reply', msg: m.id, option: 0 });
    S.mode = 'phone'; tick(4, 10); return;
  }
  if (S.mode === 'idle') {
    const r = rnd();
    if (r < pf.phone) { S.mode = 'phone'; tick(5, 18); return; }
    if (r < pf.phone + pf.stand) { S.mode = 'stand'; tick(...pf.idle); return; }
    if (r < pf.phone + pf.stand + pf.outside) {
      const out = w.spots.filter(s => (s.zone === 'street' || s.zone === 'veranda') && s.kind === 'stand' && !s.occ);
      if (out.length) { const s = out[Math.floor(rnd() * out.length)]; w.act({ type: 'walk', x: s.x, z: s.z }); S.mode = 'outside'; tick(20, 45); return; }
    }
    if (r < pf.phone + pf.stand + pf.outside + pf.wander) {
      const sp = w.spots.filter(s => s.kind === 'stand' && !s.occ && s.z > 0);
      if (sp.length) { const s = sp[Math.floor(rnd() * sp.length)]; w.act({ type: 'walk', x: s.x, z: s.z }); S.mode = 'wander'; tick(2, 4); return; }
    }
  }
  // подойти к кому-то: из нескольких ближайших, кого ещё не довёл до контакта (или до «договорились», если есть зачем)
  const cand = [];
  for (const n of w.list) {
    if (!n.present || n.plan.kind === 'leave' || n.state === 'gone' || n.cold > w.t) continue;
    const dealable = n.step === 4 && (n.known.need || n.commonTopic);
    if (n.step >= 4 && !dealable) continue;
    if (n.step >= 5) continue;
    if (w.t - (S.tried[n.id] || -1e9) < (n.step >= 2 ? 150 : 90)) continue;
    cand.push({ n, d: Math.hypot(n.x - P.x, n.z - P.z) });
  }
  if (!cand.length) { S.mode = 'stand'; tick(5, 10); return; }
  cand.sort((a, b) => a.d - b.d);
  const pick = rnd() < pf.pickNear ? cand[Math.floor(rnd() * Math.min(3, cand.length))] : cand[Math.floor(rnd() * cand.length)];
  S.tried[pick.n.id] = w.t;
  if (w.act({ type: 'approach', id: pick.n.id })) { S.talks++; S.turns = 0; S.maxTurns = Math.round(range(...pf.turns)); S.mode = 'go'; }
  tick(0.5, 1);
}

// ─────────── прогон в Node ───────────
function runOne(World, C, seed, pf) {
  const w = new World(C, { seed, profile: { name: 'Игрок', role: 'backend', topics: ['ai', 'sea', 'georgian'], need: 'flat', offer: 'job' } });
  const S = {}; let end = null;
  w.bus.on('end', e => end = e.summary);
  const DT = 1 / 30;
  for (let k = 0; !w.over && k < 200000; k++) { w.step(DT); if (k % 3 === 0) human(w, S, pf, seed * 7 + 1); }
  const talkLog = w.talk.log, res = {};
  for (const l of talkLog) res[l.result] = (res[l.result] || 0) + 1;
  const avgTurns = talkLog.length ? talkLog.reduce((s, l) => s + l.turns, 0) / talkLog.length : 0;
  return { met: end.met, contacts: end.contacts, deals: end.deals, pairs: end.pairs, points: end.points, photo: end.photo, title: end.title?.id,
    orders: S.orders, barWalks: S.barWalks, noEnergy: S.noEnergy, firstNoEnergy: S.firstNoEnergy, firstLow: S.firstLow, minE: S.minE,
    talks: talkLog.length, avgTurns, tired: res.tired || 0, fail: res.fail || 0, talkShare: S.talkSec / w.t, intros: S.intros, energyEnd: w.player.energy };
}
const avg = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
export function sweep(World, C, seeds, profiles = Object.keys(PROFILES)) {
  const out = {};
  for (const id of profiles) {
    const rs = seeds.map(s => runOne(World, C, s, PROFILES[id]));
    const col = k => rs.map(r => r[k]);
    const noE = rs.filter(r => r.firstNoEnergy != null).map(r => r.firstNoEnergy);
    const low = rs.map(r => r.firstLow ?? 25);
    out[id] = { n: rs.length, rs,
      orders: avg(col('orders')), ordersRange: [Math.min(...col('orders')), Math.max(...col('orders'))], barWalks: avg(col('barWalks')),
      met: avg(col('met')), contacts: avg(col('contacts')), deals: avg(col('deals')), pairs: avg(col('pairs')), points: avg(col('points')),
      talks: avg(col('talks')), turns: avg(col('avgTurns')), tired: avg(col('tired')), fail: avg(col('fail')), talkShare: avg(col('talkShare')),
      noEnergy: avg(col('noEnergy')), noEnergyRuns: noE.length, firstNoEnergy: noE.length ? Math.min(...noE) : null, noEnergyP10: noE.length ? q(rs.map(r => r.firstNoEnergy ?? 25), 0.1) : null, lowP10: q(low, 0.1), minE: avg(col('minE')),
      photo: avg(col('photo')), dealsMin: Math.min(...col('deals')), dealsMax: Math.max(...col('deals')) };
  }
  return out;
}
const hh = h => h == null ? '—' : h >= 25 ? 'нет' : `${Math.floor(h) % 24}:${String(Math.round(h % 1 * 60)).padStart(2, '0')}`;
export function table(out) {
  const rows = [['профиль', 'заказ', 'к бару', 'разгов', 'ходов', 'устал', 'сорв', 'в разг', 'знаком', 'контакт', 'дог', 'пар', 'очки', '«нет сил»', 'сил<0.08 (10%)', 'мин сил']];
  for (const [id, o] of Object.entries(out)) rows.push([PROFILES[id].title, `${o.orders.toFixed(1)} (${o.ordersRange.join('–')})`, o.barWalks.toFixed(1), o.talks.toFixed(0), o.turns.toFixed(1),
    o.tired.toFixed(1), o.fail.toFixed(1), (o.talkShare * 100).toFixed(0) + '%', o.met.toFixed(1), o.contacts.toFixed(1), `${o.deals.toFixed(1)} (${o.dealsMin}–${o.dealsMax})`, o.pairs.toFixed(1),
    o.points.toFixed(0), `${o.noEnergy.toFixed(1)} · с ${hh(o.firstNoEnergy)} (10%: ${hh(o.noEnergyP10)})`, hh(o.lowP10), o.minE.toFixed(2)]);
  const W = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  return rows.map(r => r.map((x, i) => String(x).padEnd(W[i])).join(' │ ')).join('\n');
}
export function checks(out) {
  const bad = [], A = out.active, M = out.average, X = out.clumsy;
  const want = (c, msg) => { if (!c) bad.push(msg); };
  if (M) {
    want(M.orders >= 3 && M.orders <= 6, `средний: заказов ${M.orders.toFixed(1)} (цель 3–6)`);
    want(M.met >= 8 && M.met <= 15, `средний: знакомств ${M.met.toFixed(1)} (цель 8–15)`);
    want(M.contacts >= 4 && M.contacts <= 8, `средний: контактов ${M.contacts.toFixed(1)} (цель 4–8)`);
    want(M.pairs >= 1 && M.pairs <= 4, `средний: пар ${M.pairs.toFixed(1)} (цель 1–4)`);
    want(M.deals >= 1 && M.deals <= 4, `средний: договорились ${M.deals.toFixed(1)} (цель 1–4)`);
  }
  if (A) {
    want(A.deals >= 2 && A.deals <= 4.5, `активный: договорились ${A.deals.toFixed(1)} (цель 2–4)`);
    want(A.firstNoEnergy == null || A.firstNoEnergy >= 22, `активный: «нет сил» уже в ${hh(A.firstNoEnergy)}`);
    const D = out.dry;   // даже не заказывая ничего, активный держится до 22:00 (9 вечеров из 10)
    if (D) want(D.noEnergyP10 == null || D.noEnergyP10 >= 22, `активный без заказов: «нет сил» в ${hh(D.noEnergyP10)} (10% вечеров)`);
    want(A.orders <= 8, `активный: заказов ${A.orders.toFixed(1)} — к бару слишком часто`);
  }
  if (X && M) want(X.points < M.points * 0.65 && X.contacts < M.contacts * 0.5, `неудачный не хуже: очки ${X.points.toFixed(0)} vs ${M.points.toFixed(0)}`);
  return bad;
}

// ─────────── запуск ───────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), N = +(args.find(a => /^\d+$/.test(a)) || 24);
  const L = load(), { World } = L.use('sim/world'), C0 = L.use('content/index').CONTENT;
  // TUNE='{"energy":{"say":0.008}}' — примерить числа без правки tuning.js
  const mergeT = (a, b) => { if (!b || typeof b !== 'object' || Array.isArray(b)) return b; const o = { ...a }; for (const k in b) o[k] = mergeT(a?.[k], b[k]); return o; };
  const C = process.env.TUNE ? { ...C0, TUNING: mergeT(C0.TUNING, JSON.parse(process.env.TUNE)) } : C0;
  const seeds = Array.from({ length: N }, (_, i) => 101 + i * 17);
  const t0 = Date.now();
  const out = sweep(World, C, seeds);
  console.log(`Сходка: баланс, «человек» в своём темпе, ${N} сидов (${((Date.now() - t0) / 1000).toFixed(0)} с)\n`);
  console.log(table(out));
  const bad = checks(out);
  if (args.includes('--browser')) {
    const { serve } = await import('./serve.js'), { launch, watch, enterHall } = await import('./game.js');
    const { srv, url } = await serve(), b = await launch();
    for (const [id, seed] of [['average', 5], ['active', 9]]) {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = []; watch(pg, errs);
      await pg.goto(url + '?seed=' + seed); await enterHall(pg);
      await pg.evaluate(([src, pf, seed]) => { window.__human = new Function('return ' + src)(); window.__S = {}; window.__pf = pf; window.__seed = seed; }, [human.toString(), PROFILES[id], seed]);
      for (;;) {
        const r = await pg.evaluate(() => { const w = SKHODKA.w; for (let i = 0; i < 600 && !w.over; i++) { w.step(1 / 30); if (i % 3 === 0) window.__human(w, window.__S, window.__pf, window.__seed); } return w.over; });
        await pg.waitForTimeout(20);
        if (r) break;
      }
      await pg.waitForSelector('.scr.end', { timeout: 30000 });
      const s = await pg.evaluate(() => { const st = SKHODKA.w.score.stats(), S = window.__S; return { ...st, orders: S.orders, noEnergy: S.noEnergy, minE: +S.minE.toFixed(2), title: SKHODKA.w.score.title()?.title }; });
      console.log(`\nбраузер, ${PROFILES[id].title}, seed ${seed}: знаком ${s.met} · контакт ${s.contacts} · дог ${s.deals} · пар ${s.pairs} · заказов ${s.orders} · «нет сил» ${s.noEnergy} · мин сил ${s.minE} · очки ${s.points} · ${s.title}`);
      if (errs.length) { bad.push('ошибки в браузере: ' + errs.slice(0, 3).join(' | ')); }
      await pg.close();
    }
    await b.close(); srv.close();
  }
  console.log(bad.length ? '\n✗ ' + bad.join('\n✗ ') : '\nбаланс в целях');
  process.exit(bad.length ? 1 : 0);
}
