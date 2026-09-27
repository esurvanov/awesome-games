'use strict';
// Barks — «голос мира»: короткие реплики над головой без открытия диалога (как правила реплик Left 4 Dead).
// Раз в 0.5 с — факты о мире (кто рядом, тепло/раны/голод героя, ночь, пурга, волки, свежие события Interact);
// из подходящих правил берётся самое важное (prio); паузы у правила, у говорящего, у строки; на экране ≤ 2 пузырей.
// Контракт: Barks.tick(dt) — game.js; Barks.draw(g) — gfx.js (мировые координаты, слой ui); Barks.say(o, text, {h, life}).
// Всё состояние — в памяти модуля (не в G): сейвы не меняются.
const Barks = (() => {
  const pick = a => a[(Math.random() * a.length) | 0];
  const MAX = 2, NEAR = 140, GAP = 1.5, REPEAT = 90;
  // общие реплики людей зон; своё — в записи персонажа: bark: {hi, cold, hurt} (js/content/npcs.js)
  const GEN = { hi: ['Здравствуй.', 'А, живой. Проходи.', 'Доброго здоровья.'], cold: ['Замёрз? Иди погрейся.'], hurt: ['Кровь у тебя. Перевяжись.'] };
  // люди посёлка за работой (по типу)
  const WORK = {
    bich: ['Сучья — не продохнуть…', 'Эх, топор бы наточить.', 'Ещё кубик — и перекур.'],
    evenk: ['След свежий. Утренний.', 'Соболь тут ходил.'],
    strelok: ['Тихо пока.', 'Смотрю, смотрю.'],
  };
  // короткий разговор двух людей посёлка: [реплика, ответ]
  const CHAT = [['Курево есть?', 'Последняя. Пополам.'], ['Мороз-то давит.', 'Январь. Чего хотел.'], ['Вертолёт будет?', 'Будет. Весной. Может.']];
  const npcLines = (s, k) => { const v = s.rec.bark && s.rec.bark[k]; return (typeof v === 'function' ? v(G) : v) || GEN[k]; };
  // «живые» фразы персонажа (idle из диалогов), которые влезают в пузырь
  const idleLines = s => { const r = s.rec.idle; if (!r) return null; for (const [c, t] of r) if (t.length <= 56 && c(G)) return [t]; return null; };

  // ---------- правила: who(f) → говорящий {o, h} | null; when(f) — доп. условие; lines — строки или (f, s) → строки;
  //            pair — [реплика, ответ]: ответ через 1.2 с от соседа; cd — пауза правила, с; prio — важность ----------
  const RULES = [
    { id: 'dog', who: f => f.dog, prio: 9, cd: 4, lines: ['Гав! Гав!', 'Р-р-р… Гав!', 'Гав-гав!'] },
    { id: 'wolf', who: f => f.guard, prio: 8, cd: 25, lines: ['Волки! Все к избе!', 'Серые у кромки. Вижу.'] },
    { id: 'fell', who: f => f.feller, prio: 7, cd: 6, lines: ['Берегись!', 'Па-адает!'] },
    { id: 'push', who: f => f.hero, when: f => f.push, prio: 6, cd: 12, lines: ['Не пройти…', 'Тут не пролезть. В обход.'] },
    { id: 'storm', who: f => f.hero, when: f => f.ev('storm', 6), prio: 6, cd: 120, lines: ['Пурга. Надо в тепло.'] },
    { id: 'hi', who: f => f.npcNew, prio: 6, cd: 3, lines: (f, s) => npcLines(s, 'hi') },
    { id: 'cold', who: f => f.hero, when: f => f.warm < 25, prio: 5, cd: 45, lines: ['Пальцев не чую…', 'Зуб на зуб… К огню бы.'] },
    { id: 'hurt', who: f => f.hero, when: f => f.hp < 35, prio: 5, cd: 50, lines: ['Ох… Перевязаться бы.'] },
    { id: 'npcSay', who: f => f.npc, when: f => f.warm < 30 || f.hp < 40, prio: 5, cd: 60, lines: (f, s) => npcLines(s, f.warm < 30 ? 'cold' : 'hurt') },
    // жесты героя (js/actions.js): сидит на пне, греет руки, пнул пустой сугроб
    { id: 'rest', who: f => f.hero, when: f => f.act === 'rest' && f.actT > 1.5, prio: 4, cd: 40, lines: ['Посижу. Ноги гудят.', 'Тихо-то как…', 'Минутку. Отдышусь.', 'Эх, Семёныч…'] },
    { id: 'warmUp', who: f => f.hero, when: f => f.act === 'warm' && f.actT > 1, prio: 4, cd: 35, lines: ['Ох, хорошо…', 'Пальцы оживают.', 'Огонь — это жизнь.'] },
    { id: 'hungry', who: f => f.hero, when: f => f.food < 15, prio: 4, cd: 60, lines: ['Живот к спине прилип.'] },
    { id: 'dusk', who: f => f.hero, when: f => f.ev('dusk', 12), prio: 3, cd: 300, lines: ['Темнеет. Пора к огню.'] },
    { id: 'idle', who: f => f.npcStay, prio: 2, cd: 45, lines: (f, s) => idleLines(s) },
    { id: 'work', who: f => f.worker, when: () => Math.random() < 0.2, prio: 1, cd: 35, lines: (f, s) => WORK[s.o.type] || WORK.bich },
    { id: 'chat', who: f => f.pair, when: () => Math.random() < 0.15, prio: 1, cd: 90, pair: CHAT },
  ];

  let T = 0, chk = 0, lastNew = -9, wasNight = null, wasStorm = null, view = null;
  const bub = [], wait = [], E = {}, ruleT = {}, said = new Map(), greet = new Map(), stay = new Map(), spk = new WeakMap();
  const mark = (k, ev = {}) => { E[k] = { ev, t: T }; };
  Interact.on('push', ev => mark('push', ev));
  Interact.on('fell', ev => mark('fell', ev));

  // виден ли говорящий: в кадре (по последнему кадру draw), не спрятан в избе, пока герой снаружи
  function vis(o) {
    if (!o || o.hidden || (insideHut(o.x, o.y) && !G.p.inside)) return false;
    return !view || (o.x > view.x0 + 20 && o.x < view.x1 - 20 && o.y > view.y0 + 70 && o.y < view.y1 + 10);
  }
  const free = o => (spk.get(o) || 0) <= T;
  const unitSp = u => ({ o: u, h: u.type === 'laika' ? 34 : 58 });

  function facts() {
    const p = G.p, s = G.s;
    const f = { warm: s.warm, hp: s.hp, food: s.food, ev: (k, age) => E[k] && T - E[k].t < age ? E[k].ev : null, act: p.action && p.action.k, actT: p.action ? p.action.t : 0 };
    f.hero = !p.sleeping && free(p) ? { o: p, h: 60 } : null;
    const pu = f.ev('push', 0.7); f.push = pu && pu.t > 1.2;
    // ночь и пурга — по фронту (при загрузке не срабатывают)
    const night = daylight() < 0.3, storm = stormOn();
    if (wasNight === false && night) mark('dusk'); if (wasStorm === false && storm) mark('storm');
    wasNight = night; wasStorm = storm;
    // люди зон, Уркачан, Вера: ближайший к герою
    let nb = null, nd = NEAR * NEAR;
    for (const n of Npc.list()) {
      const st = n.st, d = dist2(st, p);
      if (d < NEAR * NEAR) stay.set(n.id, (stay.get(n.id) || 0) + 0.5); else stay.delete(n.id);
      if (d < nd && vis(st) && free(st)) { nd = d; nb = n; }
    }
    if (nb) {
      const sp = { o: nb.st, h: Math.max(nb.rec.h || 60, 60) + 16, rec: nb.rec, id: nb.id }; // выше метки «поговорить»
      if (greet.get(nb.id) !== G.day) f.npcNew = sp; else f.npc = sp;
      if (stay.get(nb.id) > 6 && !p.moving) f.npcStay = sp;
    }
    // посёлок
    const fe = f.ev('fell', 1);
    if (fe && typeof fe.who === 'object' && vis(fe.who) && free(fe.who)) f.feller = unitSp(fe.who);
    else if (fe && fe.who === 'p' && Math.random() < 0.25) f.feller = f.hero; // сам кричит не всякий раз
    const U = G.col ? G.col.units : [];
    const wolfAt = (o, r2) => G.wolves.some(w => w.st !== 'retreat' && dist2(w, o) < r2) || (G.bear && G.bear.st !== 'wander' && dist2(G.bear, o) < r2);
    const work = [];
    for (const u of U) {
      if (!vis(u) || !free(u)) continue;
      if (u.type === 'laika') { if (!f.dog && ((u.barkUntil || 0) > now || wolfAt(u, 260 * 260))) f.dog = unitSp(u); continue; }
      if (!f.guard && wolfAt(u, 320 * 320)) f.guard = unitSp(u);
      if (u.task.k !== 'idle' && u.task.k !== 'shelter') work.push(u);
      if (!f.pair && U.some(o => o !== u && o.type !== 'laika' && !o.hidden && dist2(o, u) < 120 * 120)) f.pair = unitSp(u);
    }
    if (work.length) f.worker = unitSp(pick(work));
    return f;
  }

  function fresh(lines) { const ok = lines.filter(t => T - (said.get(t) ?? -1e9) > REPEAT); return ok.length ? pick(ok) : null; }
  function choose(f) {
    let best = null, bp = -1;
    for (const r of RULES) {
      if ((ruleT[r.id] || 0) > T || r.prio <= bp) continue;
      const s = r.who(f); if (!s || (r.when && !r.when(f))) continue;
      if (r.prio < 7 && (bub.length >= MAX || T - lastNew < GAP)) continue;
      const L = r.pair ? r.pair.map(q => q[0]) : typeof r.lines === 'function' ? r.lines(f, s) : r.lines;
      const line = L && (r.id === 'dog' ? pick(L) : fresh(L)); if (!line) continue;
      best = { r, s, line }; bp = r.prio;
    }
    if (!best) return;
    const { r, s, line } = best;
    ruleT[r.id] = T + r.cd;
    if (r.id === 'hi') greet.set(s.id, G.day);
    if (r.id === 'idle') stay.set(s.id, -30);
    say(s.o, line, { h: s.h });
    if (r.pair) wait.push({ at: T + 1.2, from: s.o, line: r.pair.find(q => q[0] === line)[1] });
  }

  // ---------- пузыри ----------
  function say(o, text, opts = {}) {
    if (!o || !text) return;
    const i = bub.findIndex(b => b.o === o); if (i >= 0) bub.splice(i, 1);
    if (bub.length >= MAX + 1) bub.shift();
    bub.push({ o, text, h: opts.h || 60, t: 0, life: opts.life || Math.min(5, 2 + text.length * 0.06), lines: null, w: 0 });
    said.set(text, T); spk.set(o, T + (o.type === 'laika' ? 3 : 6)); lastNew = T;
  }
  function tick(dt) {
    T += dt;
    for (let i = bub.length - 1; i >= 0; i--) if ((bub[i].t += dt) > bub[i].life) bub.splice(i, 1);
    if (state !== 'play' || !G || !G.p || UI.modal()) return;
    for (let i = wait.length - 1; i >= 0; i--) {
      const q = wait[i]; if (q.at > T) continue; wait.splice(i, 1);
      const o = G.col && G.col.units.find(u => u !== q.from && u.type !== 'laika' && vis(u) && dist2(u, q.from) < 140 * 140);
      if (o) say(o, q.line, { h: 58 });
    }
    if ((chk -= dt) > 0) return; chk = 0.5;
    choose(facts());
  }
  // перенос: до 2 строк по ширине 160
  function wrap(g, b) {
    const words = b.text.split(' '), L = [''];
    for (const w of words) { const s = L[L.length - 1] ? L[L.length - 1] + ' ' + w : w; if (g.measureText(s).width > 148 && L[L.length - 1]) L.push(w); else L[L.length - 1] = s; }
    if (L.length > 2) { L.length = 2; L[1] += '…'; }
    b.lines = L; b.w = Math.max(...L.map(s => g.measureText(s).width)) + 12;
  }
  function draw(g) {
    const m = g.getTransform(); view = { x0: -m.e / m.a, y0: -m.f / m.d, x1: -m.e / m.a + GFX.vw, y1: -m.f / m.d + GFX.vh };
    if (!bub.length || UI.modal()) return;
    g.save(); g.font = '12px "PT Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 1;
    for (const b of bub) {
      if (!vis(b.o)) continue;
      if (!b.lines) wrap(g, b);
      const a = Math.min(1, b.t * 6, (b.life - b.t) * 3), bh = b.lines.length * 14 + 6;
      const x = b.o.x, y1 = b.o.y - b.h - Math.min(6, b.t * 14), y0 = y1 - bh, x0 = x - b.w / 2;
      g.globalAlpha = a; g.fillStyle = '#ebe6d3'; g.strokeStyle = 'rgba(39,57,74,0.75)';
      g.beginPath(); g.roundRect(x0, y0, b.w, bh, 5); g.moveTo(x - 4, y1); g.lineTo(x, y1 + 5); g.lineTo(x + 4, y1); g.fill(); g.stroke();
      g.fillRect(x - 3.5, y1 - 1, 7, 2); // стереть рамку у основания хвостика
      g.fillStyle = '#27394a';
      b.lines.forEach((s, i) => g.fillText(s, x, y0 + 10 + i * 14));
    }
    g.restore();
  }
  return { tick, draw, say };
})();
