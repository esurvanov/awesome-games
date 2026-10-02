#!/usr/bin/env node
// Страховка сюжета: вся игра по главам I→IV и все 4 концовки, детерминированно.
//   cd tests && node smoke-story.js            (STORY_SEED=… — другой мир; STORY_VERBOSE=1 — диалоги)
// Приёмы: Math.random подменён сидом в начале каждой фазы; время идёт только через update(dt) (шаг 0,05 с);
// героя переносим телепортом (ускорение), действуем игровыми функциями (interact / fireKey / eat / trySleep /
// кнопки панелей / Colony.*). Бессмертия нет: еда, тепло и сон — по-настоящему (care: ест, греется в избе).
// Ускорение ресурсами (помечено «+»): дрова/провиант в лабаз, для концовки D — склад посёлка.
// Сценарии (каждый — своя вкладка, сейвы передаются через слот «1» и кнопку «Продолжить»):
//   main  — новая игра: мягкая смерть в гл. I, главы I→IV (сейв→загрузка на каждой главе, цели HUD) → A
//   B     — сейв утра 5-го дня (дед 1/3) → вертолёт → B «Один»
//   E     — тот же сейв → вертолёт не встретили до 7-го дня → глава VII «Экспедиция»: сборы, Вера, путь через
//           стойбище к метеостанции, задания Тамары (керосин, мачта), сеанс 20:00, борт у мачты → E «Кербо-2»
//   C     — чекпоинт входа в главу VII → поход не успели за STORY.expDays суток → C «Тайга приняла»
//   D     — тот же сейв → посёлок (эпоха III, 6 человек) → «Остаться» → глава V «Промысел»: участки буровой
//           (задание Михалыча), стойбища (Уялан: сэвэки, весточка брату), метеостанции (Тамара), эпоха IV →
//           глава VI «Зимовка»: запасы, большая пурга → D «Новый посёлок»
//   people — тот же сейв → по одному заданию остальных людей зон: Ефимыч (долг деда), Агафон (ограда),
//           Толян (склад, судьба), Коченины (стая), Вася (письмо, подвоз)
//   death — сейв главы II → замёрз → экран гибели (без финала) → «Ещё раз» с чекпоинта
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const SEED = +(process.env.STORY_SEED || 20260926);
const VERBOSE = !!process.env.STORY_VERBOSE;
const TIPS = '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}';
const STAMP = { A: 'спасены', B: 'спасён', C: 'остался', D: 'остались', E: 'дошли' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ======================= код в странице =======================
function lib() {
  const DT = 0.05;
  const S = window.ST = { log: [], fails: [], dlg: [], prefer: [], fin: [], care: true, out: {} };
  const ok = S.ok = (c, w) => { S.log.push((c ? 'ok   ' : 'FAIL ') + w); if (!c) S.fails.push(w); return !!c; };
  const L = S.L = m => S.log.push(`     · d${G.day} ${hourOf().toFixed(2)}h гл${G.chapter} hp${G.s.hp | 0} т${G.s.warm | 0} е${G.s.food | 0} — ${m}`);
  const $$ = s => document.querySelector(s), vis = id => !document.getElementById(id).hidden;
  // финал: записать вызов, сыграть настоящий (пропуск — клавишей из node)
  S.toasts = [];
  const toast0 = Fx.toast; Fx.toast = t => { S.toasts.push(`d${G.day} ${hourOf().toFixed(2)} ${t}`); return toast0(t); };
  const orig = Finale.play;
  Finale.play = (k, st, cb) => { S.fin.push(k); return orig(k, st, cb); };

  // ---------- модальные окна: записки закрыть, панели закрыть, в диалоге — вариант из prefer, иначе первый ----------
  S.modal = function () {
    for (let k = 0; k < 30 && UI.modal(); k++) {
      if (vis('note')) { $$('#note').click(); continue; }
      if (vis('panel')) { $$('#panel-close').click(); continue; }
      if (vis('dialog')) {
        let os = [...document.querySelectorAll('#dlg-opts .opt')];
        if (!os.length) { $$('#dialog').click(); os = [...document.querySelectorAll('#dlg-opts .opt')]; }
        if (!os.length) break;
        const txt = os.map(o => o.textContent);
        let i = txt.findIndex(t => S.prefer.some(p => t.includes(p))); if (i < 0) i = 0;
        S.dlg.push(`${$$('#dlg-name').textContent}: ${$$('#dlg-text').textContent.slice(0, 48)} → ${txt[i]}`);
        os[i].click(); continue;
      }
      break;
    }
  };
  // ---------- шаг: модалки → update → забота о герое ----------
  S.tick = function () {
    S.modal();
    if (state !== 'play') return;
    update(DT); S.ticks++;
    if (S.ticks % 100 === 0) Inv.audit('smoke-story');   // счётчик вещи < 0 — console.error → провал (js/inventory.js)
    if (S.care) care();
  };
  S.run = function (sec, cond) {
    const n = Math.round(sec / DT);
    for (let i = 0; i < n; i++) { if (cond && cond()) return true; if (state !== 'play') return !!(cond && cond()); S.tick(); }
    return cond ? !!cond() : true;
  };
  S.until = (day, h) => { const t = tAt(day, h); return S.run(Math.max(0, t - G.time) + 1, () => G.time >= t); };
  S.untilH = h => { let t = tAt(dayOf(), h); if (t <= G.time) t += CYCLE; return S.run(t - G.time + 1, () => G.time >= t); }; // ближайшее h:00 впереди
  // перед телепортом — доиграть цепочку ноши (вещь в руке → в рюкзак), иначе она осталась бы в руках
  S.tp = (x, y) => { if (G.p.action && G.p.action.j === 'carry') S.run(10, () => !(G.p.action && G.p.action.j === 'carry')); const p = G.p; p.x = x; p.y = y; p.vx = p.vy = 0; p.action = null; p.lx = x; p.ly = y; p.sx = x - 30; p.sy = y; input.mx = input.my = 0; };
  S.act = () => { Actions.interact(true); S.run(14, () => !G.p.action && G.p.cd <= 0 && !input.auto); };   // цепочка: работа → вещь на снег → в руку → в рюкзак   // E у дерева/ствола — сам подходит (автопуть)
  // заговорить — когда руки свободны (забота подкидывает в печь — это теперь шаги ≈2 с, js/actions.js stoveFeed)
  // еда из лабаза — сперва дойти до него (автопуть): дождаться и вернуться к собеседнику
  S.talk = (prefer) => { if (G.p.action || input.auto) { const c0 = S.care, x = G.p.x, y = G.p.y; S.care = false; S.run(8, () => !G.p.action && !input.auto); S.care = c0; S.tp(x, y); } if (G.p.cd > 0) { const c0 = S.care; S.care = false; S.run(1, () => G.p.cd <= 0); S.care = c0; }   // пауза после прошлого действия: E ещё не сработает
    S.prefer = prefer || []; Actions.interact(false); S.modal(); S.prefer = []; };
  // площадка на мари: пройти дорожками поперёк (шаг 14 px), туда-обратно, пока не утоптано ≥ 80 % (js/content/chapters.js padK)
  S.tramp = function () {
    const b = padSite(); if (!b) return false; const B = BUILDS.pad, n = Math.ceil((B.h - 8) / 14), c0 = S.care; S.care = false;
    for (let pass = 0; pass < 6 && !padDone(); pass++) for (let i = 0; i <= n && !padDone(); i++) {
      const y = b.y - B.h / 2 + 4 + i * (B.h - 8) / n, dir = (i + pass) % 2 ? -1 : 1, x0 = b.x - dir * (B.w / 2 + 16), x1 = b.x + dir * (B.w / 2 + 16);
      S.tp(x0, y); S.tick(); input.mx = dir; S.run(12, () => { G.p.y = y; input.mx = dir; return dir > 0 ? G.p.x >= x1 : G.p.x <= x1; }); input.mx = 0;
    }
    S.care = c0; return padDone();
  };
  const IN = () => S.tp(HUT.x + 20, HUT.y - 30); // середина избы (не у печи/верстака/кровати)
  S.IN = IN;

  function care() {
    const p = G.p;
    if (state !== 'play' || UI.modal() || p.sleeping) return;
    // рефлекс: волк/медведь вплотную — бить (как игрок)
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < 80 * 80) { if (!p.action && p.cd <= 0) Actions.interact(true); return; }
    const w = Actions.nearest(G.wolves, 58); if (w && !(p.inside && G.hut.door) && !p.action && p.cd <= 0) { Actions.interact(true); return; }
    // шатун близко — факел (крафт у горящей печи/костра), им шатуна оглушают; в избе за дверью не нужен (и не мешает лечь)
    if (G.bear && !(p.inside && G.hut.door) && !/flee/i.test(G.bear.st) && dist2(G.bear, p) < 320 * 320 && p.torch <= 0) { const r = RECIPES.find(r => r.id === 'torch'); if (Actions.recipeState(r) === 'ok') { Actions.craft(r); S.torches = (S.torches || 0) + 1; } }
    if (p.action || input.auto) return;   // идёт к месту работы (изба, лабаз) — не перебивать едой
    if (G.s.food < 45 && !S.noEat) { const f0 = G.s.food; Actions.eat(); if (G.s.food > f0) S.ate = (S.ate || 0) + 1; }
    if (p.inside && G.flags.stoveLit && G.hut.fuel < Stove.secPerLog() * 3 && Inv.cnt('wood', true) > 0) Actions.fireKey();
    if (G.s.warm < 35 && !p.inside && G.flags.stoveLit) warmUp();
  }
  function warmUp() {
    const x = G.p.x, y = G.p.y; S.care = false; S.warmups = (S.warmups || 0) + 1;
    IN(); stoke();
    S.run(90, () => { if (G.hut.fuel < Stove.secPerLog() * 2) Actions.fireKey(); if (G.s.food < 45) Actions.eat(); return G.s.warm > 85; });
    S.tp(x, y); S.care = true;
  }
  // печь до «полна» (клавиша F внутри избы)
  // F у печи — процесс (дверца → полено → прикрыть, ≈2 с): ждём конца каждого
  function stoke() { for (let i = 0; i < 12; i++) { const f = G.hut.fuel; Actions.fireKey(); S.run(4, () => !G.p.action); if (G.hut.fuel <= f) break; } }
  S.stoke = stoke;

  // ---------- панели: открыть вкладку и нажать кнопку, как мышью ----------
  S.panel = function (tab, sel, times = 1) {
    let n = 0;
    for (let i = 0; i < times; i++) {
      if (tab === 'chest') UI.openChest(); else UI.openCraft(tab);
      const b = document.querySelector('#panel ' + sel);
      if (!b || b.disabled) break;
      b.click(); n++;
      if (G.p.action && G.p.action.k === 'craft') S.run(15, () => !G.p.action || G.p.action.k !== 'craft'); // крафт идёт в мире (этап 4)
      else if (G.p.action || input.auto) S.run(40, () => !G.p.action && !input.auto); // изба — работа в мире: идёт к месту, шаги (js/actions.js hutStep)
    }
    if (vis('panel')) $$('#panel-close').click();
    return n;
  };
  S.putAll = () => { S.panel('chest', '[data-all="put"]'); };
  S.takeN = (k, n) => S.panel('chest', `[data-take="${k}"]`, n);

  // ---------- действия мира ----------
  // охапку — в поленницу у избы (по одной) и обратно на место
  S.deliver = function () {
    if (!Carry.busy()) return; const x = G.p.x, y = G.p.y, q = Carry.PILE();
    S.tp(q.x - 26, q.y + 16); S.tick(); if (!Carry.put('pile', [])) Carry.stow([]); S.run(20, () => !G.p.action && !input.auto); S.tp(x, y); S.tick();
  };
  // из поленницы в охапку (до n и пока берётся)
  S.fromPile = function (n) {
    const q = Carry.PILE(); S.tp(q.x - 26, q.y + 16); S.tick();
    S.run(6, () => !G.p.action && !Carry.thing());   // забота (поесть) могла оставить банку в руке — доел, убрал, тогда охапка
    for (let i = 0; i < n && (G.chest.wood || 0) > 0 && !Carry.cantTake({ kind: 'chunk', mass: Inv.wkg(G.chest) / G.chest.wood, len: 0.45, vol: 0.006 }); i++) { Carry.pick('pile', null, []); S.run(3, () => !G.p.action); }
  };
  S.wreck = function (w, until) {
    const P = POI[w], at = w === 'cockpit' ? [P.x, P.y + 90] : [P.x + 20, P.y + 100];
    let n = 0;
    while (G.wreck[w].length && n++ < 20) { S.tp(at[0], at[1]); S.tick(); S.act(); if (until && until()) break; }
  };
  S.note = function (id) { const n = NOTES[id]; S.tp(n.x + 4, n.y + 4); S.tick(); S.run(1, () => G.p.cd <= 0 && !G.p.action); Actions.interact(false); const r = !!G.notes[id]; S.modal(); return r; };
  S.chop = function (want) {
    const w0 = G.stats.wood;
    for (let k = 0; k < 60 && G.stats.wood - w0 < want; k++) {
      const t = Space.nearest(Space.trees, HUT.x, HUT.y + 260, 900, t => t.wood > 0 && !t.wall);
      if (!t) break;
      // встать лицом к дереву; под ногами сугроб/банка/палка перехватывают E — зайти с другой стороны, как игрок
      for (const [dx, dy] of [[26, 4], [-26, 4], [24, 16], [-24, 16], [30, -6], [-30, -6]]) {
        S.tp(t.x + dx, t.y + dy); G.p.face = dx > 0 ? -1 : 1; S.tick();
        const c = Actions.context(); if (c && c.k === 'tree') break;
      }
      // рубка по-настоящему (js/actions.js): площадка в сугробе, подруб, обход, задний рез (~12 ударов, герой сам встаёт и обходит)
      const before = G.stats.wood; for (let h = 0; h < 40 && t.wood > 0; h++) { const c = Actions.context(); if (!c || c.k !== 'tree') break; S.act(); }
      S.run(8, () => !(G.logs || []).some(L => L.f));   // валка: треск, падение, ствол ложится; герой отошёл назад-вбок
      // этап 4: ель лежит — обрубить (по мутовке, с двух сторон, перекат), разделать и подобрать чурки; охапка полна — в поленницу и вернуться
      const Lg = (G.logs || []).find(q => q.n > 0 && q.cx === t.x && q.cy === t.y);
      for (let j = 0; j < 200; j++) {
        // длинное (вершина, комель > 0,8 м) — на плечо, в поленницу не идёт (js/carry.js): берём только чурки
        const c = Actions.context(); if (c && c.k === 'log') { S.act(); continue; }
        const qc = c && c.k === 'chunks' && c.o.filter(q => !Carry.long(q) && !Carry.cantTake(q)).sort((a, b) => dist2(a, G.p) - dist2(b, G.p))[0];
        if (qc) { Carry.pick('part', qc, []); S.run(6, () => !G.p.action && !input.auto); continue; }
        if (Carry.busy() && (G.chunks || []).some(q => Tree.isWood(q) && !Carry.long(q) && dist2(q, G.p) < 200 * 200)) { S.deliver(); continue; }
        if (Lg && G.logs.includes(Lg) && Lg.n > 0) { const e = Actions.logEnd(Lg, Actions.logK(Lg) * 0.4); S.tp(e.x - Math.sin(Lg.a) * 26, e.y + Math.cos(Lg.a) * 16); S.tick(); const c2 = Actions.context(); if (!c2 || c2.k !== 'log') break; continue; }   // к стволу (отошёл от падающей ели)
        const q = (G.chunks || []).filter(q => Tree.isWood(q) && !Carry.long(q) && dist2(q, G.p) < 200 * 200).sort((a, b) => dist2(a, G.p) - dist2(b, G.p))[0];
        if (q && !Carry.cantTake(q)) { S.tp(q.x + 16, q.y + 3); S.tick(); const c3 = Actions.context(); if (!c3 || c3.k !== 'chunks') break; continue; }
        break;
      }
      S.deliver();
      if (G.stats.wood === before && t.wood > 0 && Inv.weight() > Inv.capKg() + 6) break;
    }
    return G.stats.wood - w0;
  };
  S.hare = function () {
    const n0 = G.stats.hares;
    for (let k = 0; k < 60 && G.stats.hares === n0; k++) {
      const h = Space.nearest(G.hares, G.p.x, G.p.y); if (!h) { S.run(1); continue; }
      S.tp(h.x + 6, h.y); Actions.interact(true); S.run(0.5);
      S.run(20, () => !G.p.action && !Carry.busy() && !input.auto);   // тушка в руке → на снег → разделка → шкурка и мясо в рюкзак
    }
    // тушка осталась на снегу (заяц сбит на бегу, цепочку прервал зверь) — разделать, как игрок: E у тушки
    for (let k = 0; k < 8; k++) {
      const c = (G.carcs || []).find(c => c.done == null && dist2(c, G.p) < 300 * 300); if (!c) break;
      S.tp(c.x + 24, c.y + 2); S.run(0.7); S.act(); S.run(20, () => !G.p.action && !Carry.busy() && !input.auto);
    }
    return G.stats.hares > n0;
  };
  // лечь у горячей печи; проснулся ночью (печь погасла / волк) — подбросить и снова лечь, как игрок
  const morning = () => { const h = hourOf(); return h >= 7 && h < 12; };
  S.sleepNight = function () {
    let wakes = 0, awake = 0;
    for (let n = 0; n < 80 && !morning() && state === 'play'; n++) {
      if (!insideHut(G.p.x, G.p.y)) IN();
      stoke(); if (n === 0) L(`печь ${G.hut.fuel | 0} с (${(G.hut.fuel / Stove.secPerLog()).toFixed(1)} пол.) · поленница ${G.chest.wood} · руки ${Carry.count()}`); S.tp(SPOT.bed.x, SPOT.bed.y); S.tick();
      Actions.interact(false); S.run(4, () => G.p.sleeping || !Actions.busy());
      if (!G.p.sleeping) {   // не дают уснуть (шатун/волки рядом)
        if (!awake++) L('не уснуть: ' + S.toasts.slice(-2).join(' / '));
        // шатун ворошит избу всю ночь — выйти к нему с факелом, как игрок (дед при уважении ≥ 2 стреляет, когда шатун идёт на героя)
        if (G.bear && G.bear.st !== 'flee' && dist2(G.bear, HUT) < TUNE.act.bearSleepR ** 2 && G.s.hp > 50) { const b = G.bear; S.tp(b.x + (b.x < HUT.x ? 150 : -150), b.y); S.run(30, () => !G.bear || G.bear.st === 'flee' || G.s.hp < 40); IN(); L(`вышел к шатуну: ${G.bear ? G.bear.st : 'нет'} · hp ${G.s.hp | 0} · ` + S.toasts.slice(-2).join(' / ')); continue; }
        S.run(15); continue;   // бодрствуем в избе, ждём
      }
      S.run(CYCLE * 0.8, () => !G.p.sleeping);
      if (!morning() && wakes++ < 3) L('проснулся ночью: ' + S.toasts.slice(-2).join(' / ') + ` · дверь ${G.hut.door}`);
    }
    return morning();
  };
  S.stacks = function (light) {
    for (const s of G.stacks) {
      if (s.lit > 0) continue;
      if (s.wood < 4 && Carry.woodN() + (G.inv.wood || 0) < 4 - s.wood) S.fromPile(4 - s.wood - Carry.woodN());   // дрова на кучу — охапкой из поленницы
      S.tp(s.x, s.y + 34); S.tick();
      for (let i = 0; i < 8 && s.wood < 4; i++) { Actions.interact(true); S.run(1.6, () => !G.p.action); S.run(0.1); }   // полено за поленом из рук (≈1 с каждое)
      // рядом может оказаться заяц/сугроб (первое E — «поймать»/«пнуть») — жмём ещё, как игрок
      if (light) for (let i = 0; i < 4 && !(s.lit > 0); i++) { S.tp(s.x, s.y + 34); S.tick(); S.act(); S.run(0.3); }
      if (s.wood < 4) { S.tp(s.x, s.y + 34); S.tick(); const c = Actions.context(); L(`куча ${s.wood}/4 · руки ${Carry.woodN()} · поленница ${G.chest.wood} · E: ${c && c.k}/${c && c.label} · ${S.toasts.slice(-2).join(' / ')}`); }
    }
  };
  // чекпоинт/сейв → слот → загрузка настоящим путём (UI.loadSlot = кнопка «Загрузить»)
  S.reload = function (json, tag) {
    const pick = g => JSON.stringify({ ch: g.chapter, day: g.day, flags: g.flags, notes: g.notes, hut: g.hut, vera: g.vera.state, urk: [g.urk.state, g.urk.respect], gear: g.gear, stacks: g.stacks.map(s => s.wood) });
    const before = pick(JSON.parse(json));
    Saves.write('1', json); UI.loadSlot('1');
    ok(state === 'play' && pick(G) === before, `💾 ${tag}: сейв → загрузка → то же (глава ${CHAPTERS[G.chapter].num}, день ${G.day}, флагов ${Object.keys(G.flags).length})`);
  };
  S.goalsOk = () => CHAPTERS[G.chapter].goals.filter(g => !g.alt).map(g => (g.ok(G) ? '✓' : '·') + g.t).join(' ');
  S.expectGoals = () => { const ch = CHAPTERS[G.chapter]; return { head: ch.num + ' · ' + ch.n, goals: ch.goals.filter(g => !g.show || g.show(G)).map(g => ({ t: g.t, done: !!g.ok(G), alt: !!g.alt })) }; };
  S.readGoals = () => ({ head: ($$('#goals .plate-h') || {}).textContent, goals: [...document.querySelectorAll('#goals .g')].map(e => ({ t: e.textContent, done: e.classList.contains('done'), alt: e.classList.contains('alt') })) });

  S.phase = function (name, arg, seed) {
    S.log = []; S.fails = []; S.dlg = []; S.out = {}; S.ticks = 0;
    Math.random = mulberry(seed);
    const t0 = performance.now();
    try { S.P[name](arg); } catch (e) { ok(false, `исключение в фазе ${name}: ${e.message} ${(e.stack || '').split('\n')[1] || ''}`); }
    S.freeze();
    return { log: S.log, fails: S.fails, dlg: S.dlg, out: S.out, ms: performance.now() - t0, ticks: S.ticks, st: state, ch: G && G.chapter, day: G && G.day };
  };
  // между фазами мир стоит: открытая панель = модалка, главный цикл не зовёт update (детерминизм)
  S.freeze = () => { if (state === 'play' && !UI.modal()) UI.openChest(); };
  S.P = {};
}

// ======================= фазы сценариев =======================
function phases() {
  const S = ST, ok = S.ok, L = S.L, P = S.P;
  const chapterIs = (i, what) => ok(G.chapter === i && JSON.parse(checkpoint).chapter === i, `📖 глава ${CHAPTERS[i].num} «${CHAPTERS[i].n}» · ${what} · чекпоинт главы записан`);

  P.boot = function (seed) {
    newGame(); GFX.reset(); SaveGame.checkpoint();
    ok(G.chapter === 0 && state === 'play', `🆕 новая игра (seed мира ${G.seed})`);
    ok(CHAPTERS[0].goals.every(g => !g.ok(G)), '🎯 гл. I: все 5 целей открыты');
    G.chest.can = (G.chest.can || 0) + 8; // + провиант (ускорение: без рыбалки на реакцию)
  };
  // ---------- глава I ----------
  P.ch1a = function () {
    S.tp(HUT.x, HUT_IN.y1 + 90); S.run(0.5);
    ok(G.flags.hutFound, '🛖 зимовье найдено (подошёл к избе)');
    S.wreck('cockpit', () => G.stats.scrap >= 3);
    ok(G.stats.scrap >= 3 && G.inv.scrap >= 3, `🔩 железо ×${G.stats.scrap} из кабины (осталось в обломках ${G.wreck.cockpit.length})`);
    ok(S.note('log') && G.notes.log, '📓 бортжурнал прочитан');
    // мягкий проигрыш в главе I: замёрз у обломков → «Уркачан дотащил»
    S.tp(POI.cockpit.x + 200, POI.cockpit.y + 200); G.s.warm = 0; G.s.hp = 6; const t0 = G.time, wood = G.inv.wood || 0;
    S.care = false; S.run(10, () => G.s.hp >= 40); S.run(40, () => !G.p.ko && !G.p.action); S.care = true; // этап 4: упал → затемнение → очнулся в избе → встал
    ok(state === 'play' && G.chapter === 0 && insideHut(G.p.x, G.p.y) && !G.p.ko && G.s.hp >= 48 && G.s.hp < 60 && G.time - t0 >= CYCLE / 8, // 50 + отлежался в темноте (KO_DARK, ×sleepX)
      `💀→🛖 смерть в гл. I мягкая: жив в избе, hp ${G.s.hp | 0}, время +${(G.time - t0).toFixed(0)} с`);
    ok(/Уркачан дотащил/.test($('ch-title').textContent) && !$('chapter').hidden && $('over').hidden, '🪪 карточка «Уркачан дотащил», экрана гибели нет');
    ok(!deathLog[0], '📉 счётчик смертей главы I не тронут');
    S.out.mid = SaveGame.snapshot();
  };
  P.ch1b = function () {
    const got = S.chop(10);
    ok(got >= 8, `🪓 нарублено дров: ${got}`);
    S.IN(); S.tp(SPOT.chest.x - 10, SPOT.chest.y); S.tick(); S.putAll();
    ok(!G.inv.wood && G.chest.wood >= 8, `📦 «Положить всё» в лабаз: дров ${G.chest.wood}`);
    G.chest.wood += 90; // + дрова (ускорение)
    S.tp(SPOT.stove.x + 10, SPOT.stove.y + 20); S.tick(); S.act();
    ok(G.flags.stoveLit && G.hut.fuel > 0, `🔥 печь растоплена (E у печи), топливо ${G.hut.fuel | 0} с`);
    S.tp(SPOT.bench.x, SPOT.bench.y + 10); S.tick();
    const n = S.panel('hut', '[data-u="walls"]') + S.panel('hut', '[data-u="door"]') + S.panel('hut', '[data-u="bench"]');
    ok(n === 3 && G.hut.walls && G.hut.door && G.hut.bench, '🧱 изба: щели, дверь, верстак (кнопки панели)');
    S.IN(); S.until(1, 21.2); // со щелями полная печь держит ночь с 19:00 (Stove.maxLogs); ложимся в 21:12, как раньше
    ok(state === 'play' && G.s.hp > 0, `🌙 вечер 1-го дня (21:12) дожил (hp ${G.s.hp | 0}, еды съедено ${S.ate || 0}, согревов ${S.warmups || 0})`);
    const slept = S.sleepNight();
    ok(slept && G.flags.slept, `😴 ночь пережита во сне → ${hourOf().toFixed(1)} ч дня ${G.day}`);
    S.run(0.2);
    chapterIs(1, 'цели I закрыты');
    S.out.cp = checkpoint;
  };
  // ---------- глава II ----------
  P.ch2 = function (cp) {
    S.reload(cp, 'гл. II');
    ok(G.urk.state === 'hut' || S.run(30, () => G.urk.state === 'hut'), '🧓 утром у зимовья Уркачан');
    S.tp(G.urk.x - 30, G.urk.y); S.tick(); S.talk(['Помоги нам', 'Понял']);
    ok(G.flags.metUrk && G.urk.state === 'walk', '🧓 встретил деда (диалог до «Помоги нам»), дед ушёл к чуму');
    S.wreck('cockpit', () => G.flags.quartz);
    ok(G.flags.quartz && G.inv.quartz, '💎 кварц из кабины');
    S.wreck('cockpit');
    ok(!G.wreck.cockpit.length && G.inv.cable, `🔩 кабина разобрана: железа ${G.stats.scrap}, кабель есть`);
    ok(S.note('pilot') && G.known.tail, '📓 записка пилота → хвост на карте');
    ok(S.hare() && S.hare(), `🐇 поймал зайцев: ${G.stats.hares}, шкурок ${G.inv.hare}`);
    S.tp(G.vera.x + 60, G.vera.y + 40); S.run(1);
    ok(G.vera.state === 'follow' && G.flags.veraFound, '👩 Вера найдена у хвоста, идёт следом');
    S.wreck('tail');
    ok(!G.wreck.tail.length && G.inv.battery && G.gear.saw && G.inv.kero >= 2, '🔋 хвост разобран: аккумулятор, пила, керосин');
    S.run(30, () => G.urk.state === 'chum');
    S.tp(G.urk.x - 30, G.urk.y); S.tick(); S.talk(['Отдать', 'Спасибо']);
    ok(G.flags.urkPelts && G.urk.respect === 1 && G.col.units.some(u => u.pet), '🐇→🧓 2 шкурки деду, уважение 1/3, лайка Пурга');
    S.IN(); S.run(120, () => G.vera.state === 'hut');
    ok(G.vera.state === 'hut', '👩🛖 Вера дошла в избу');
    S.run(0.2);
    chapterIs(2, 'цели II закрыты');
    S.out.cp = checkpoint;
  };
  // ---------- глава III ----------
  P.ch3 = function (cp) {
    S.reload(cp, 'гл. III');
    G.chest.wood += 40; // + дрова на печь до конца игры (ускорение)
    S.tp(SPOT.chest.x - 10, SPOT.chest.y); S.tick(); S.putAll(); S.stoke();
    S.run(90, () => G.charge >= 100);
    ok(G.charge >= 100, '🔋 аккумулятор заряжен у печи (в лабазе)');
    // E у лампы; рядом может оказаться заяц (тогда первое E — «поймать») — жмём ещё, как игрок
    for (let k = 0; k < 6 && !G.flags.tube; k++) { S.tp(TUBE_POS.x, TUBE_POS.y); Actions.interact(true); if (!G.flags.tube) S.run(0.5); }
    S.tp(POI.polynya.x - 160, POI.polynya.y); S.tick();
    ok(G.flags.tube && G.inv.tube, '💡 радиолампа Гоши у переката');
    S.IN(); S.tp(SPOT.bench.x, SPOT.bench.y + 10); S.tick();
    ok(S.panel('craft', '[data-r="antenna"]') === 1 && Inv.has('antenna', true), '📡 антенна на верстаке');
    ok(S.panel('craft', '[data-r="radio"]') === 1 && G.flags.radioBuilt, '📻 рация собрана');
    ok(S.panel('hut', '[data-u="damper"]') === 1 && G.hut.damper, '🔥 заслонка');
    ok(!G.flags.siegeDone && G.chapter === 2, '🐺 осада ещё впереди — глава III не закрыта');
    S.until(2, 20.5); ok(S.sleepNight(), `😴 ночь 2 → ${hourOf().toFixed(1)} ч`);
    // Вера голодна с утра 3-го дня — накормить
    const v = G.vera; S.tp(v.x + 30, v.y + 20); S.tick();
    const f0 = v.food; S.talk(['Накормить']);
    ok(v.food > f0 && v.state === 'hut', `🍲 Веру накормил (еда ${f0}→${v.food})`);
    S.IN(); S.until(3, 20.5);
    ok(S.sleepNight() || G.flags.siegeDone, `😴 ночь осады в избе → ${hourOf().toFixed(1)} ч дня ${G.day}`);
    ok(G.fired.E5 && G.flags.siegeDone, '🐺 стая пришла (21:00 3-го дня) и отступила — осада снята');
    S.run(0.2);
    chapterIs(3, 'цели III закрыты');
    S.out.cp = checkpoint;
  };
  // ---------- глава IV: связь, площадка, кучи; утро 5-го дня — сейв для B/C/D ----------
  P.ch4 = function (cp) {
    S.reload(cp, 'гл. IV');
    if (hourOf() >= 19 || hourOf() < 6) ok(S.sleepNight(), `😴 досыпаем до утра → ${hourOf().toFixed(1)} ч дня ${G.day}`);
    S.untilH(7.6);
    S.tp(SPOT.bench.x, SPOT.bench.y + 10); S.tick();
    ok(S.panel('craft', '[data-radio]') === 1, '📻 кнопка «Рация» на верстаке');
    S.modal();
    ok(G.flags.contact && G.known.mar, `📻 связь в окно сеанса ${hourOf().toFixed(2)} ч: борт ответил`);
    // Веру кормим один раз: к утру 5-го дня она снова голодна (для B — не доживёт до 6-го)
    const v = G.vera, vf = v.food; S.tp(v.x + 30, v.y + 20); S.tick(); S.talk(['Накормить']);
    ok(v.food === vf + 1, `🍲 Веру накормил (${vf}→${v.food})`);
    // дед: вожак → «сам справлюсь», про шатуна, потом подарок едой → уважение 2/3 (ночью дед отгонит шатуна)
    S.IN(); S.tp(SPOT.chest.x - 10, SPOT.chest.y); S.tick(); S.takeN('can', 2);
    const pref = ['Сам справлюсь', 'Откуда', 'Что делать', 'Подарить', 'Ага', 'Понял', '…'];
    for (let k = 0; k < 4 && G.urk.respect < 2; k++) { S.tp(G.urk.x - 30, G.urk.y); S.tick(); S.talk(pref); }
    ok(G.urk.respect === 2 && G.flags.wolfAsked && G.flags.bearWarned, '🧓 дед: вожак (сам), шатун, подарок едой → уважение 2/3');
    S.tp(POI.mar.x, POI.mar.y + 320); S.tick();
    S.panel('build', '[data-place="pad"]'); // кнопка «Построить» закрывает панель и даёт призрак
    ok(G.col.ghost && G.col.ghost.type === 'pad', '🛬 площадка: призрак стройки на мари');
    G.col.ghost.x = POI.mar.x; G.col.ghost.y = POI.mar.y; Colony.place();
    const site = G.col.builds.find(b => b.type === 'pad');
    ok(site && !site.done, '🛬 стройка площадки заложена (дрова из лабаза)');
    S.run(400, () => { if (site.done) return true; if (dist2(G.p, site) > 70 * 70) S.tp(site.x, site.y + 40); if (!G.p.action && G.p.cd <= 0) Actions.interact(true); return false; });
    ok(site.done, `🛬 вешки площадки стоят к ${hourOf().toFixed(1)} ч`);
    ok(S.tramp(), `🥾 площадка утоптана: ${Math.round(padK() * 100)} % к ${hourOf().toFixed(1)} ч`);
    S.stacks(false);   // по охапке из поленницы на каждую кучу
    ok(G.stacks.every(s => s.wood >= 4), '🪵 3 кучи на мари по 4');
    S.IN(); S.until(4, 20.5); ok(S.sleepNight(), `😴 ночь 4 → ${hourOf().toFixed(1)} ч дня ${G.day}`);
    ok(G.day === 5 && G.flags.slept && JSON.parse(checkpoint).day === 5, '💾 утро 5-го дня — автосейв');
    ok(G.chapter === 3 && !G.flags.rescued && G.vera.state === 'hut' && G.vera.food === 0, `🎯 гл. IV: ${S.goalsOk()} · Вера голодна · шатун: ${G.flags.urkShot ? 'дед стрелял' : G.flags.bearDead ? 'повержен' : 'был'} · факелов ${S.torches || 0}`);
    S.out.s5 = checkpoint;
  };
  // вертолёт в 09:00: подбросить в кучи, если шатун разворошил, и зажечь все три
  function heli() {
    // дров на кучи (шатун ночью разворашивает): из лабаза, не хватит — нарубить
    S.IN(); if (hourOf() < 8) S.untilH(8); if (!padDone()) ok(S.tramp(), `🥾 ночью замело — площадку подновили: ${Math.round(padK() * 100)} %`);   // пурга перед окном
    S.IN(); S.run(300, () => G.heli);
    ok(!!G.heli, `🚁 гул винтов в ${hourOf().toFixed(2)} ч дня ${G.day}`);
    const need = G.stacks.reduce((a, s) => a + (s.lit > 0 ? 0 : 4 - s.wood), 0);
    if ((G.chest.wood || 0) + Inv.cnt('wood', false) < need) S.chop(need - Inv.cnt('wood', false) - (G.chest.wood || 0));
    S.stacks(true);
    if (!(G.flags.rescued || G.stacks.every(s => s.lit > 0))) L('кучи: ' + JSON.stringify(G.stacks) + ' inv ' + JSON.stringify(G.inv) + ' modal ' + UI.kind + ' heli ' + JSON.stringify(G.heli) + ' · ' + S.toasts.slice(-4).join(' / '));
    ok(G.flags.rescued || G.stacks.every(s => s.lit > 0), '🔥 три кучи горят при гуле');
    S.run(10, () => state !== 'play');
  }
  P.endA = function () {
    heli();
    ok(G.flags.rescued && !G.flags.veraDead && G.urk.respect >= 2, '🚁 спасены: Вера жива, дед 2/3');
  };
  // B: 5-го вертолёт упустили, Веру больше не кормили — к утру 6-го её нет; 6-го в 09:00 — улетаешь один
  P.endB = function () {
    S.IN(); S.run(300, () => G.heli); S.run(90, () => G.flags.heliMiss);
    ok(G.flags.heliMiss && state === 'play', '🚁 день 5: не зажгли — не заметили');
    G.time = tAt(6, 6.9); // ускорение: сразу к рассвету 6-го
    S.IN(); S.run(20, () => G.flags.veraDead);
    ok(G.flags.veraDead && G.vera.state === 'dead', '🕯 утро 6-го: Вера не проснулась (не кормили)');
    heli();
    ok(G.flags.rescued && G.flags.veraDead, '🚁 спасён один');
  };
  P.endD = function () {
    // + склад посёлка (ускорение); + без пурги 5-го дня: сценарий — «посёлок за день», в пургу люди прячутся
    // (пурга на 5-й день выпадает или нет в зависимости от всей предыдущей партии — стройка не должна от неё зависеть)
    G.storm = null;
    // + сигнальные кучи на мари сложены: иначе свободные бичи уходят их докладывать (сутки ×3 — кучи успевают прогореть за ночь)
    // (горящие тоже: дров с дерева теперь по массе — больше, кучи могли быть сложены и зажжены раньше; прогорят — бичи пойдут докладывать)
    for (const st of G.stacks) { st.lit = 0; st.wood = 4; }
    Object.assign(G.chest, { wood: (G.chest.wood || 0) + 200, meat: (G.chest.meat || 0) + 60, scrap: (G.chest.scrap || 0) + 10, hare: (G.chest.hare || 0) + 6 });
    S.prefer = ['Остаться', 'Остаёмся', 'Бегу'];
    const at = HUT.x + 40, ay = HUT_IN.y1 + 90; S.tp(at, ay); S.tick();
    const hire = (n) => { for (let i = 0; i < n; i++) S.panel('people', '[data-hire="bich"]'); };
    hire(4);
    ok(G.col.queue.length === 4, '👷 найм 4 бичей (кнопки «Нанять»)');
    S.run(60, () => !G.col.queue.length);
    const spot = (type) => { for (let r = 260; r < 900; r += 40) for (let a = 0; a < 6.28; a += 0.3) { const x = HUT.x + Math.cos(a) * r, y = HUT.y + Math.sin(a) * r; if (Colony.canPlace(type, x, y)) return { x, y }; } return null; };
    const build = (type) => {
      S.tp(at, ay); S.tick();
      S.panel('build', `[data-place="${type}"]`);
      const q = spot(type); if (!G.col.ghost || !q) return null;
      G.col.ghost.x = q.x; G.col.ghost.y = q.y; Colony.place();
      return G.col.builds[G.col.builds.length - 1];
    };
    const finish = (bs, sec) => {
      const r = S.run(sec, () => bs.every(b => b && b.done));
      if (!r) L('стройки ' + bs.map(b => b && `${b.type}@${b.x | 0},${b.y | 0}:${(b.prog * 100) | 0}%`).join(' ') + ' · ' + G.col.units.filter(u => !u.pet).map(u => `${u.task.k}${u.task.b || ''}@${u.x | 0},${u.y | 0}${u.hidden ? 'h' : ''}`).join(' '));
      return r;
    };
    const b1 = [build('woodshed'), build('smoke'), build('balok')];
    L('стройки заложены: ' + b1.map(b => b && `${b.type}#${b.id}@${b.x | 0},${b.y | 0}`).join(' ') + ' · ' + G.col.units.filter(u => !u.pet).map(u => `${u.task.k}${u.task.b || ''}@${u.x | 0},${u.y | 0}`).join(' ') + ' · лабаз дров ' + G.chest.wood);
    ok(finish(b1, 240), `🏗 дровяник, коптильня, балок построены бичами (${hourOf().toFixed(1)} ч)`);
    S.tp(at, ay); S.tick(); S.panel('epoch', '[data-epoch]');
    ok(G.col.epT > 0, '⏫ эпоха II «Заимка» — переход начат');
    S.run(80, () => G.col.ep >= 1);
    const b2 = [build('forge'), build('tower')];
    ok(finish(b2, 240), '🏗 кузня и вышка');
    S.tp(at, ay); S.tick(); S.panel('epoch', '[data-epoch]');
    S.run(100, () => G.col.ep >= 2);
    ok(G.col.ep === 2, '⏫ эпоха III «Промысел»');
    ok(CHAPTERS[3].goals.filter(g => g.alt).every(g => g.show(G)), '🎯 цели «Или:» ветки D видны в HUD');
    S.tp(at, ay); S.tick(); hire(2);
    S.run(60, () => G.chapter === 4 || state !== 'play');
    ok(G.flags.dOffered && G.flags.stayD, `🏘 дед предложил остаться (${Colony.pop()} чел.) → «Остаться в посёлке»`);
    ok(state === 'play' && CHAPTERS[G.chapter].num === 'V' && JSON.parse(checkpoint).chapter === G.chapter, '📖 глава V «Промысел» (вместо мгновенной D) · чекпоинт');
    S.out.cp = checkpoint; S.out.build = null;
  };
  // ---------- люди зон: общие приёмы ----------
  // подойти к человеку (где он сейчас — у него распорядок) и поговорить, выбирая варианты prefer
  S.meet = (id, prefer) => { const st = Npc.state(id); S.tp(st.x - 30, st.y + 4); S.tick(); const d0 = S.dlg.length; S.talk(prefer); if (S.dlg.length === d0) { const c = Actions.context(); L(`${id}: диалог не открылся · E: ${c && c.k} · ${S.toasts.slice(-2).join(' / ')}`); } };
  // сдать вещи заказчику: «+» вещи только что выданы — забота не должна их съесть/сжечь по дороге к разговору
  S.handover = (id, prefer) => { const c0 = S.care; S.care = false; S.meet(id, prefer); S.care = c0; };
  S.zoneTp = (id, dx = 0, dy = 200) => { const z = ZONES[id]; S.tp(z.x + dx, z.y + dy); S.run(0.3); };
  const vera2me = () => { if (G.vera.state === 'follow') { G.vera.x = G.p.x - 30; G.vera.y = G.p.y + 10; } };
  // Тамара: керосин ×2 (задание 1) и кабель ×2 на мачту (задание 2)
  S.tamara = function (mast) {
    S.meet('tamara', ['У вас передатчик', 'Принесу', 'Понял']);
    ok(G.flags.tamaraAsked && Quests.active().includes('tamara_kero'), '🌡️ Тамара: «Передатчик исправный… принесёте две канистры» → задание взято, строка в HUD');
    if (Inv.cnt('kero', false) < 2) G.inv.kero = 2; // + керосин
    S.meet('tamara', ['Отдать', 'Спасибо']);
    ok(G.flags.tamaraKero && !Quests.active().includes('tamara_kero'), '🌡️ керосин ×2 Тамаре → генератор, прогноз и торг');
    if (!mast) return;
    S.meet('tamara', ['Найду кабель', 'Договорились']);
    if (Inv.cnt('cable', false) < 2) G.inv.cable = 2; // + кабель
    S.meet('tamara', ['Отдать', 'Понял']);
    ok(G.flags.mastFixed, '📡 кабель ×2 на мачту → передатчик слышит Туру');
  };
  // ---------- ветка E: вертолёт упущен → глава VII ----------
  P.endE1 = function () {
    // Веру накормить досыта: до 7-го дня пропускаем один рассвет — должна дожить до похода
    S.IN(); S.tp(SPOT.chest.x - 10, SPOT.chest.y); S.tick(); S.takeN('can', 3);
    if (Inv.cnt('can', false) < 2) G.inv.can = (G.inv.can || 0) + 2; // + консервы
    S.care = false; for (let i = 0; i < 2; i++) { const v = G.vera; S.tp(v.x + 30, v.y + 20); S.tick(); S.talk(['Накормить']); } S.care = true;   // консервы — Вере: забота героя их не съест
    ok(G.vera.food === 2, `🍲 Веру накормили досыта (${G.vera.food})`);
    S.IN(); S.run(300, () => G.heli); S.run(90, () => G.flags.heliMiss);
    ok(G.flags.heliMiss && state === 'play' && G.chapter === 3, '🚁 день 5: не заметили — игра идёт');
    G.time = tAt(7, 8.8); // ускорение: сразу утро 7-го дня
    S.IN(); S.prefer = ['Дойдём', 'Понял', 'Идём']; S.run(300, () => G.chapter === 6 || state !== 'play'); S.prefer = [];
    ok(state === 'play' && CHAPTERS[G.chapter].num === 'VII' && G.flags.expDay === 7, `🚶 7-й день: вертолёт снова ушёл → глава VII «Экспедиция» (не концовка C)`);
    ok(G.zoneSeen.meteo && Story.goalTarget(), '🧭 метеостанция на карте, компас указывает цель');
    S.out.cp = checkpoint;
  };
  P.endE2 = function () {
    S.IN(); S.tp(SPOT.chest.x - 10, SPOT.chest.y); S.tick(); S.takeN('can', 4);
    if (Inv.cnt('food', false) < 4) G.inv.can = (G.inv.can || 0) + 4; // + припасы
    S.run(0.3);
    ok(G.flags.expPacked, `🎒 припасы в рюкзаке: еды ${Inv.cnt('food', false)}`);
    const v = G.vera; S.tp(v.x + 30, v.y + 20); S.tick(); S.talk(['Идём к метеостанции', 'Пошли']);
    ok(G.vera.state === 'follow', '👩 Вера: «Идём. Если отстану — не жди…» → идёт следом');
    // путь через зоны (ускорение: телепорт по вехам, Вера — рядом): стойбище → метеостанция
    S.zoneTp('stoibishe'); vera2me(); S.run(1);
    ok(G.zoneSeen.stoibishe === 1, '⛺ по пути — стойбище (зона пройдена, открыт быстрый переход)');
    S.zoneTp('meteo', -200, 260); vera2me(); S.run(1);
    ok(G.flags.expArrived, '📡 дошли до Кербо-2 (цель главы)');
    S.tamara(true);
    ok(Story.markAt('npc:tamara') && CHAPTERS[G.chapter].goals.find(g => !g.ok(G)).t.includes('Сеанс'), '🎯 следующая цель — сеанс 08:00 / 20:00');
    if (!(hourOf() >= 19.5 && hourOf() < 21)) S.untilH(19.6);
    S.meet('tamara', ['Живые']);
    ok(G.flags.expCalled && G.flags.expCallDay === G.day, `📻 сеанс в ${hourOf().toFixed(2)} ч: «Тура, Тура, я Кербо-2…» → борт утром`);
    G.time = tAt(G.day + 1, 8.95); // ускорение: ночь в доме у Тамары
    S.zoneTp('meteo', 120, 120); vera2me();
    S.run(60, () => state !== 'play');
    ok(G.flags.expRescued && state === 'over', `🚁 ${hourOf().toFixed(2)} ч: Ми-8 у мачты → концовка E`);
  };
  P.lateC = function () {
    ok(CHAPTERS[G.chapter].num === 'VII', '💾 чекпоинт входа в главу VII');
    G.time = tAt(G.flags.expDay + STORY.expDays, 7.2); // ускорение: сутки похода вышли
    S.IN(); S.run(30, () => state !== 'play');
    ok(state === 'over' && !G.flags.expCalled, `🌲 ${STORY.expDays} суток без сеанса → концовка C`);
  };
  // ---------- ветка D: глава V «Промысел» → VI «Зимовка» ----------
  P.promD = function () {
    ok(CHAPTERS[G.chapter].num === 'V', '💾 глава V загружена');
    G.storm = null;
    // Михалыч: мясо вахте → «Буран» на ходу; потом участок
    S.IN(); S.tp(SPOT.chest.x - 10, SPOT.chest.y); S.tick(); S.takeN('meat', 3);
    S.meet('mikhalych', ['Нужен керосин', 'Принесу', 'Договорились']);
    ok(G.flags.mikhAsked, '🛢️ Михалыч: «Второй месяц на макаронах…» → задание «мясо ×3»');
    const k0 = Inv.cnt('kero', false);
    S.meet('mikhalych', ['Отдать', 'Спасибо']);
    ok(G.flags.mikhMeatDone && G.veh.buran.fixed && Inv.cnt('kero', false) === k0 + 2, '🛷 мясо ×3 вахте → «Буран» на ходу, :kero:×2');
    // шатун уже был (глава IV) — Михалыч может сначала попросить о нём: «не охотник», потом — участок
    for (let k = 0; k < 3 && !(G.plots && G.plots.drill); k++) S.meet('mikhalych', ['Не охотник', '…', 'Участок: буровая', 'Договорились']);
    ok(G.plots && G.plots.drill, '🏗 участок «буровая» открыт (люди на месте)');
    // Уялан: знакомство, сэвэки, весточка брату, участок
    S.meet('uyalan', ['Уркачан — ваш брат', 'Можно оленей', 'Понял']);
    ok(G.flags.metUyalan, '🪶 Уялан: «Сестра его. Старшая…»');
    S.meet('uyalan', ['Соберу', 'Хорошо']);
    ok(G.flags.uyalSevek, '🪶 задание: 6 сэвэков');
    S.meet('uyalan', ['Передам', 'Слово в слово']);
    ok(G.flags.uyalBrotherAsk, '🪶 задание: весточка деду');
    const r0 = G.urk.respect;
    S.meet('urk', ['Передам']);
    ok(G.flags.urkSister, '🧓 дед: «Скажи — приду. Без „весной“»');
    G.amulets = Math.max(G.amulets, 6); // + сэвэки
    S.meet('uyalan', ['Спасибо, Уялан', 'Окажется']);
    S.meet('uyalan', ['Спасибо, Уялан', 'Окажется']);
    ok(G.flags.uyalSevekDone && G.flags.uyalBrotherDone && G.veh.deer && G.veh.deer.until > 999 && G.urk.respect >= Math.min(3, r0 + 1),
      `🦌 сэвэки ×6 → своя упряжка; весточка → дед ${G.urk.respect}/3`);
    S.meet('uyalan', ['Участок: стойбище', 'Договорились']);
    ok(G.plots.stoibishe, '🏗 участок «стойбище» открыт');
    // Тамара: керосин → участок метеопоста (лабаз после двух участков подъеден — пополняем)
    S.tamara(false);
    if (FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0) < 3) G.chest.can = (G.chest.can || 0) + 3; // + еда в лабаз
    for (let k = 0; k < 3 && !G.plots.meteo; k++) S.meet('tamara', ['Потом', '…', 'Участок: метеопост', 'Договорились']);
    ok(G.plots.meteo, '🏗 участок «метеостанция» открыт');
    // утро: участки сдают добычу в лабаз
    const kc = G.chest.kero || 0, mc = G.chest.meat || 0;
    G.time = tAt(G.day + 1, 6.9); S.IN(); S.run(10, () => hourOf() >= 7.2);
    ok((G.chest.kero || 0) > kc && (G.chest.meat || 0) > mc, `🌅 рассвет: участки сдали в лабаз (:kero: ${kc}→${G.chest.kero}, :meat: ${mc}→${G.chest.meat})`);
    S.out.cp = checkpoint;
  };
  P.winterD = function () {
    G.storm = null;
    // + лабаз: фактория и переход в эпоху IV платят едой/скрапом, участки унесли часть в задания
    G.chest.can = (G.chest.can || 0) + 20; if ((G.chest.scrap || 0) < 2) G.chest.scrap = (G.chest.scrap || 0) + 2;
    const at = HUT.x + 40, ay = HUT_IN.y1 + 90;
    const spot = (type) => { for (let r = 260; r < 900; r += 40) for (let a = 0; a < 6.28; a += 0.3) { const x = HUT.x + Math.cos(a) * r, y = HUT.y + Math.sin(a) * r; if (Colony.canPlace(type, x, y)) return { x, y }; } return null; };
    S.tp(at, ay); S.tick(); S.panel('build', '[data-place="market"]');
    const q = spot('market'); G.col.ghost.x = q.x; G.col.ghost.y = q.y; Colony.place();
    const m = G.col.builds[G.col.builds.length - 1];
    ok(S.run(240, () => m.done), '🏪 фактория построена');
    S.tp(at, ay); S.tick(); S.panel('epoch', '[data-epoch]');
    S.prefer = ['Успеем', 'Переживём']; S.run(120, () => G.chapter === 5); S.prefer = [];
    ok(G.col.ep === 3 && CHAPTERS[G.chapter].num === 'VI' && G.storm && G.storm.big, `⏫ эпоха IV «Посёлок» → глава VI «Зимовка»: большая пурга назначена на ${G.storm ? ((G.storm.a / CYCLE * 24 + TUNE.time.startH) % 24).toFixed(1) : '?'} ч`);
    // + запас в лабаз: переход в эпоху IV съел еду, а зимовка требует её отдельно
    if (FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0) < STORY.winter.food) G.chest.can = (G.chest.can || 0) + STORY.winter.food;
    // + дрова: выработка посёлка — в игровом времени (TUNE.time.k), а фазы теста идут реальными секундами — сутки не набегают
    if ((G.chest.wood || 0) < STORY.winter.wood) G.chest.wood = STORY.winter.wood;
    S.run(1);
    ok(G.flags.winterWood && G.flags.winterFood, `🪵 запасы на пургу: дров ${G.chest.wood}, еды ${FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0)}`);
    G.time = G.storm.a + 1; S.IN(); S.run(1);
    ok(stormOn(), '🌨 большая пурга идёт');
    G.time = G.storm.b - 0.5; S.IN(); S.run(20, () => state !== 'play');
    ok(G.flags.bigStormDone && state === 'over', '🏘 пурга стихла, посёлок выстоял → концовка D');
  };
  // ---------- люди зон: по заданию остальных ----------
  P.people = function () {
    G.storm = null;
    // 🏪 Ефимыч: долг деда
    const r0 = G.urk.respect;
    S.meet('efimych', ['Я от Уркачана', 'Закрою долг', 'Понял']);
    ok(G.flags.efimAsked, '🏪 Ефимыч: «Цены у нас твёрдые…» → долг деда: соболь ×5');
    G.inv.sable = (G.inv.sable || 0) + 5; // + соболя
    S.handover('efimych', ['Отдать', 'Спасибо']);
    ok(G.flags.efimDebtDone && G.flags.veraHealed && G.urk.respect === Math.min(3, r0 + 1), `🏪 долг закрыт: дед ${G.urk.respect}/3, Вере — мазь и костыль`);
    ok(NPCS.efimych.trade.price(NPCS.efimych.trade.goods[0], G) <= NPCS.efimych.trade.goods[0].p, '🏪 скидка после долга');
    // ✝️ Агафон: ограда
    S.meet('agafon', ['Помочь чем', 'Принесу дров', 'Понял']);
    G.inv.wood = (G.inv.wood || 0) + 8; // + жерди
    S.handover('agafon', ['Отдать', 'Спасибо']);
    ok(G.flags.agafFence && G.inv.honey >= 2, '✝️ Агафон: жерди ×8 → мёд ×2, торг открыт');
    // 🧥 Толян: склад и выбор
    S.meet('tolyan', ['Какой склад', 'Подумаю']);
    G.inv.can = (G.inv.can || 0) + 2; // + тушёнка
    S.handover('tolyan', ['Отдать', 'Понял']);
    const st = Zones.obj('stash');
    S.tp(st.x, st.y + 30); S.tick();
    const c = Zones.context(G.p);
    ok(G.flags.stashKnown && c && c.k === 'loot', `🧥 Толян: тушёнка ×2 → склад на гари (${c && c.label})`);
    S.meet('tolyan', ['Скажу деду', 'Иди', '…']);
    ok(G.flags.tolyDone && Npc.state('tolyan').state === 'gone', '🧥 «Скажу деду» → Толян ушёл на зимник');
    const r1 = G.urk.respect; S.meet('urk', ['…']);
    ok(G.flags.tolyanTold && G.urk.respect === Math.min(3, r1 + 1), `🧓 дед про Толяна: «Честно сказал» → ${G.urk.respect}/3`);
    // 🎯 Коченины: стая
    S.meet('kochenin', ['Про вас не говорил', 'Отгоню', 'Понял']);
    ok(G.flags.kochWolves, '🎯 Коченин: «Путик дедов? А соболь об этом знает?» → три волка');
    G.stats.wolves += 3; // + стая (бой — в smoke волков)
    const s0 = G.inv.sable || 0;
    S.meet('kochenin', ['Спасибо']);
    ok(G.flags.kochWolvesDone && G.inv.sable === s0 + 2, '🎯 три волка → соболь ×2 и капкан');
    // ✉️ Вася: раз в три дня у вешки, письмо Семёныча, подвоз
    G.time = tAt(Math.ceil((G.day + 1) / 3) * 3, 9.5); S.zoneTp('zimnik', 150, 330); S.run(1);
    ok(Npc.state('vasya').state === 'post', `✉️ день ${G.day}, ${hourOf().toFixed(1)} ч — почта у вешки`);
    S.meet('vasya', ['Живые', 'Понял']);
    ok(G.flags.vasyaMet, '✉️ Вася: «Писем вам нет. Есть газета за ноябрь…»');
    // записка Семёныча «Галя…» — рядом записка пилота: встать ближе к нужной
    for (const [dx, dy] of [[14, -8], [18, 0], [10, -14], [4, 4]]) { S.tp(NOTES.wife.x + dx, NOTES.wife.y + dy); S.tick(); S.run(1, () => G.p.cd <= 0 && !G.p.action); Actions.interact(false); S.modal(); if (G.notes.wife) break; }
    ok(G.notes.wife, '📓 письмо Семёныча Гале прочитано');
    const k0 = Inv.cnt('kero', false);
    S.meet('vasya', ['Спасибо, Вася']);
    ok(G.flags.vasyaLetter && Inv.cnt('kero', false) === k0 + 1, '✉️ письмо Семёныча — Гале → :kero:, чай');
    S.meet('vasya', ['Подвезти до зимовья', 'Спасибо']);
    ok(Zones.idAt(G.p.x, G.p.y) === 'core' && dist(G.p, HUT) < 400, '🛷 Вася подвёз до зимовья');
    ok(!Quests.active().some(id => ['efim_debt', 'agaf_fence', 'toly_stash', 'koch_wolves', 'vasya_letter'].includes(id)), '📋 задания сданы — в HUD не висят');
  };
  P.death = function (cp) {
    ok(G.chapter === 1, '💾 загружен сейв главы II');
    S.tp(POI.cockpit.x + 200, POI.cockpit.y + 200); G.s.warm = 0; G.s.hp = 6; S.care = false;
    S.run(10, () => state !== 'play'); S.care = true;
    ok(state === 'over' && G.cause === 'cold' && S.fin.length === 0, '💀 гл. II: замёрз → конец игры, финал не вызывался');
  };
}

// ======================= node: сценарии =======================
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const fails = [], errs = [], T0 = Date.now();
  const ok = (c, w) => { console.log((c ? 'ok   ' : 'FAIL ') + w); if (!c) fails.push(w); return c; };
  let pg = null, seedN = 0;
  const LIB = `(${lib})();(${phases})();`;
  async function open(save) {
    if (pg) await pg.close().catch(() => {});
    pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
    await pg.route(/^https?:/, r => r.abort());
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.evaluate(([t, save]) => {
      localStorage.clear(); localStorage.setItem('sibir-tips', t);
      if (save) { const g = JSON.parse(save); localStorage.setItem('sibir3-save-1', save); localStorage.setItem('sibir3-meta-1', JSON.stringify({ v: g._v, W: g.W, at: Date.now(), day: g.day, ch: g.chapter, ep: g.col.ep, h: 9 })); }
    }, [TIPS, save || null]);
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await sleep(500);
    // кнопка меню и сразу панель-«пауза» в том же кадре: до первой фазы мир не тикает
    const st = await pg.evaluate(id => { document.getElementById(id).click(); if (state === 'play') UI.openChest(); return state; }, save ? 'continue' : 'start');
    if (st !== 'play') throw new Error('игра не началась: ' + st);
    await pg.addScriptTag({ content: LIB });
  }
  async function phase(name, arg) {
    const r = await pg.evaluate(([n, a, s]) => ST.phase(n, a, s), [name, arg || null, SEED + 7919 * ++seedN]);
    for (const l of r.log) console.log(l);
    if (VERBOSE) for (const d of r.dlg) console.log('     💬 ' + d);
    fails.push(...r.fails);
    console.log(`     ⏱ ${name}: ${r.ticks} шагов update (${(r.ticks * 0.05 / 60).toFixed(1)} игровых мин) за ${(r.ms / 1000).toFixed(1)} с · день ${r.day} · глава ${r.ch} · ${r.st}`);
    if (r.fails.length) throw new Error(`фаза ${name} не прошла — дальше по цепочке не идём`);
    return r.out;
  }
  // цели в HUD = цели данных главы (модалка держит мир на паузе, кадры обновляют HUD)
  async function hud(tag) {
    const exp = await pg.evaluate(() => { ST.freeze(); return ST.expectGoals(); });
    await sleep(400);
    const got = await pg.evaluate(() => ST.readGoals());
    const same = got.head === exp.head && JSON.stringify(got.goals) === JSON.stringify(exp.goals);
    ok(same && exp.goals.length, `🧭 HUD ${tag}: «${exp.head}» ${exp.goals.map(g => (g.done ? '✓' : '·') + g.t).join(' | ')}`);
    if (!same) console.log('     HUD:', JSON.stringify(got));
  }
  async function finale(kind) {
    const fin = await pg.evaluate(() => ({ fin: ST.fin.slice(), st: state, canvas: !!document.getElementById('finale') }));
    ok(fin.st === 'over' && fin.fin.join() === kind && fin.canvas, `🎬 Finale.play('${kind}') вызван, сцена идёт (вызовы: ${fin.fin.join() || '—'})`);
    await sleep(1200); await pg.keyboard.press('x');
    try { await pg.waitForFunction(() => !document.getElementById('over').hidden, null, { timeout: 15000 }); } catch (e) { }
    const r = await pg.evaluate(() => ({ over: !$('over').hidden, stamp: $('o-stamp').textContent, sh: $('o-stamp').hidden, title: $('o-title').textContent, doc: $('o-card').classList.contains('doc'), fin: !!document.getElementById('finale') }));
    const want = await pg.evaluate(k => ENDINGS[k][1], kind);
    ok(r.over && r.doc && !r.sh && r.stamp === STAMP[kind] && r.title.includes(want) && !r.fin,
      `📜 итоговый акт ${kind}: штамп «${r.stamp}», заголовок «${r.title.trim()}»`);
  }

  let cp1 = null, s5 = null;
  const scenario = async (name, f) => { try { await f(); } catch (e) { ok(false, `ERR ${name}: ${e.message.split('\n')[0]}`); } };
  try {
    await scenario('main', async () => {
    // ---------- main: главы I→IV → A ----------
    console.log('=== main: новая игра, главы I→IV, концовка A');
    await open(null);
    await phase('boot');
    await hud('старт гл. I');
    const mid = (await phase('ch1a')).mid;
    await pg.evaluate(m => { ST.reload(m, 'середина гл. I'); ST.freeze(); }, mid); // сейв посреди главы I
    cp1 = (await phase('ch1b')).cp;
    await hud('гл. II');
    const cp2 = (await phase('ch2', cp1)).cp;
    await hud('гл. III');
    const cp3 = (await phase('ch3', cp2)).cp;
    await hud('гл. IV');
    s5 = (await phase('ch4', cp3)).s5;
    await hud('гл. IV, утро 5-го дня');
    await phase('endA');
    await finale('A');
    });

    await scenario('B', async () => {
      console.log('=== B: сейв утра 5-го дня → «Продолжить»');
      if (!s5) throw new Error('нет сейва 5-го дня');
      await open(s5);
      await phase('endB');
      await finale('B');
    });
    // E: без вертолёта → глава VII «Экспедиция» → Кербо-2; C: из чекпоинта VII — не успели
    let cp7 = null;
    await scenario('E', async () => {
      console.log('=== E: сейв утра 5-го дня → вертолёт упущен → глава VII');
      if (!s5) throw new Error('нет сейва 5-го дня');
      await open(s5);
      cp7 = (await phase('endE1')).cp;
      await hud('гл. VII');
      await pg.evaluate(c => { ST.reload(c, 'гл. VII'); ST.freeze(); }, cp7);
      await phase('endE2');
      await finale('E');
    });
    await scenario('C', async () => {
      console.log('=== C: чекпоинт главы VII → сутки похода вышли');
      if (!cp7) throw new Error('нет чекпоинта главы VII');
      await open(cp7);
      await phase('lateC');
      await finale('C');
    });
    // D: посёлок → глава V (участки) → VI (большая пурга) → D
    await scenario('D', async () => {
      console.log('=== D: сейв утра 5-го дня → посёлок → главы V–VI');
      if (!s5) throw new Error('нет сейва 5-го дня');
      await open(s5);
      const cp5 = (await phase('endD')).cp;
      await hud('гл. V');
      await pg.evaluate(c => { ST.reload(c, 'гл. V'); ST.freeze(); }, cp5);
      await phase('promD');
      await phase('winterD');
      await finale('D');
    });
    await scenario('people', async () => {
      console.log('=== people: сейв утра 5-го дня → задания Ефимыча, Агафона, Толяна, Кочениных, Васи');
      if (!s5) throw new Error('нет сейва 5-го дня');
      await open(s5);
      await phase('people');
    });

    await scenario('death', async () => {
    console.log('=== death: сейв главы II → гибель');
    if (!cp1) throw new Error('нет сейва главы II');
    {
      await open(cp1);
      await phase('death');
      const r = await pg.evaluate(() => ({ over: !$('over').hidden, rv: $('o-card').classList.contains('rv'), title: $('o-title').textContent, sh: $('o-stamp').hidden, retry: !$('o-retry').hidden }));
      ok(r.over && r.rv && r.sh && /Замёрз/.test(r.title) && r.retry, `🪦 экран гибели: «${r.title}», без штампа, есть «Ещё раз»`);
      await pg.click('#o-retry');
      const q = await pg.evaluate(() => ({ st: state, ch: G.chapter, hp: G.s.hp }));
      ok(q.st === 'play' && q.ch === 1 && q.hp >= 60, `🔁 «Ещё раз» → чекпоинт главы II (hp ${q.hp | 0})`);
    }
    });
  } catch (e) {
    ok(false, 'ERR ' + e.message);
  } finally {
    await b.close().catch(() => {});
  }
  for (const e of errs.slice(0, 8)) console.log(e);
  console.log(`\n${fails.length ? 'FAIL' : 'OK'}: smoke-story · провалов ${fails.length} · ошибок страницы ${errs.length} · ${((Date.now() - T0) / 1000).toFixed(0)} с`);
  process.exit(fails.length || errs.length ? 1 : 0);
})();
