// Детектор мгновенных смен мира («везде надо процесс делать»).
//
// Каждый кадр — перепись видимых объектов мира (все списки G.*: деревья, стволы, чурки, лапник, банки, ловушки,
// лунки, полыньи, костры, кучи, тайники, туши, бурелом, зайцы, волки, шатун, олени, постройки и люди посёлка,
// сэвэки, лампа, лопата, лабаз, части избы, транспорт), что держит герой (p.action.item) и рюкзак (G.inv).
// Сравнение с прошлым кадром даёт события: ИСЧЕЗ, ПОЯВИЛСЯ, СМЕНИЛ ВИД (класс: стоит → пень, горит → погас…
// или шаг внутри класса), ПРЫЖОК (сдвиг > 14 px за кадр), РЮКЗАК ± (счётчик вещи).
//
// ПРОЦЕСС (формально). Событие с объектом o в кадре f «по процессу», если выполнено всё:
//   C1 длительность — есть исполнитель: действие героя (p.action, в т. ч. закончившееся в этом кадре), длившееся
//      к кадру f ≥ T_MIN = 0.3 с, или человек посёлка, работавший (u.working, таймер u.t) ≥ 0.3 с;
//   C2 контакт — o — цель действия (a.o), или рука/инструмент (a.tg, у людей посёлка — сам человек) ближе R_CON = 56 px;
//   C3 непрерывность — объект не «телепортируется» между состояниями:
//      исчез  → (а) перешёл в руку: через 0.2 с то же действие ещё идёт и в руке вещь (a.item), или
//               (б) превратился в преемника в той же точке (≤ 80 px, тот же кадр), у которого есть своя анимация перехода, или
//               (в) истлел: мера заметания/угасания объекта дошла до ≥ 0.95 (FADE ниже);
//      появился → (а) из руки (в прошлом кадре в руке была вещь), (б) из предшественника (как выше), (в) у объекта своя
//               анимация появления (SPAWN ниже: чурка откатывается 0.45 с, ствол падает);
//      сменил класс → преемник с анимацией в том же кадре, или постепенно: последний скачок числа ≤ 25 % всего пути;
//      шаг внутри класса (сучья 1/3, −1 чурка, прогресс стройки) → достаточно C1 + C2 (или постепенно без исполнителя);
//      рюкзак ± → C1 (вещь уходит/приходит во время действия, а не в кадр нажатия);
//      прыжок   → всегда нарушение (тело не двигается быстрее 14 px за кадр = 840 px/с).
//   Без исполнителя (природа): только постепенно (FADE/SPAWN) или вне кадра (за пределами ±720×460 px от героя).
//
// Запуск:   cd tests && node no-instant.js            — отчёт (код выхода 0)
//           node no-instant.js --strict              — падает (код 1), если есть нарушения вне EXCEPT
//           node no-instant.js --fast                — без рисования (быстрее; рисование нужно для части событий — банки)
//           node no-instant.js --only=рубка,костёр   — только эти сценарии
// Результат: консоль (по приоритету) + tests/no-instant.json.
// В браузере (страница игры): (0,eval)(await (await fetch('tests/no-instant.js')).text()); NoInstant.run()
// Код игры не меняется: наблюдатели ставятся из теста (обёртки Array.prototype.push/splice/shift/pop/unshift только для
// отслеживаемых списков, свойства-аксессоры на полях объектов, Proxy на G.inv) и снимаются в конце.
var NoInstant = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, T_MIN = 0.3, R_CON = 56, R_SUCC = 80, HAND_MIN = 0.2, LOOK = 13, VW = 720, VH = 460, JUMP = 14, GRAD = 0.25;

  // ---------- исключения строгого режима: ключ «сценарий|категория|событие|место» → причина ----------
  // пример: 'пень → поросль|tree|morph|js/world.js:251': 'поросль растёт сутками — игрок рядом не стоит'
  const EXCEPT = {};

  // ---------- где в коде: первые кадры стека из js/ игры ----------
  function where() {
    const s = new Error().stack.split('\n'), out = [];
    for (const l of s) { const m = l.match(/(js\/[\w\/.-]+\.js)(?:\?[^:)]*)?:(\d+)/); if (m) { out.push(m[1] + ':' + m[2]); if (out.length >= 3) break; } }
    return out.length ? out.join(' ← ') : '?';
  }

  // ---------- наблюдатели (снимаются в finally) ----------
  const TRK = new WeakMap(), MUT = [], FLD = [], INVL = [], JMP = [];
  const AP = Array.prototype, ORIG = {};
  function hookArrays() {
    for (const m of ['push', 'splice', 'shift', 'pop', 'unshift']) {
      const o = ORIG[m] = AP[m];
      AP[m] = function (...a) {
        const n = TRK.get(this); if (!n) return o.apply(this, a);
        const r = o.apply(this, a);
        ORIG.push.call(MUT, { list: n, op: m, add: m === 'push' || m === 'unshift' ? a : m === 'splice' ? a.slice(2) : [], del: m === 'splice' ? r : (m === 'shift' || m === 'pop') && r !== undefined ? [r] : [], at: where() });
        return r;
      };
    }
  }
  function unhookArrays() { for (const m in ORIG) AP[m] = ORIG[m]; }
  const LISTS = ['trees', 'logs', 'chunks', 'lap', 'litter', 'traps', 'holes', 'iceHoles', 'fires', 'stacks', 'stashes', 'corpses', 'fallen', 'hares', 'wolves', 'deer', 'amuletsAt'];
  // поле-аксессор: тот же объект (идентичность сохраняется), запись → журнал с местом в коде
  const WATCHED = new WeakMap();
  function watch(o, f, log, jump) {
    if (!o || typeof o !== 'object') return;
    let ws = WATCHED.get(o); if (!ws) WATCHED.set(o, ws = new Set()); if (ws.has(f)) return; ws.add(f);
    let v = o[f];
    Object.defineProperty(o, f, { enumerable: true, configurable: true, get: () => v,
      set(x) {
        if (jump) { if (typeof x === 'number' && typeof v === 'number' && Math.abs(x - v) > JUMP) JMP.push({ o, f, d: x - v, at: where() }); }
        else if (x !== v) log.push({ o, f, from: v, to: x, at: where() });
        v = x;
        if (log === MUT && Array.isArray(x)) TRK.set(x, f);
      } });
    if (log === MUT && Array.isArray(v)) TRK.set(v, f);
  }
  function hookG() {
    for (const k of LISTS) watch(G, k, MUT);
    if (G.col) { TRK.set(G.col.builds, 'builds'); TRK.set(G.col.units, 'units'); watch(G.col, 'builds', MUT); watch(G.col, 'units', MUT); }
    for (const k of ['walls', 'door', 'bench', 'damper']) watch(G.hut, k, FLD);
    for (const k of ['tube', 'shovel']) watch(G.flags, k, FLD);
    watch(G, 'labaz', FLD); watch(G, 'bear', FLD);
    if (G.veh) for (const k of ['deer', 'buran']) watch(G.veh, k, FLD);
    watch(G.p, 'x', null, 1); watch(G.p, 'y', null, 1);
    // рюкзак: Proxy (Inv.* пишут G.inv[id])
    const px = (raw, pre) => new Proxy(raw, { set(t, k, v) { if (t[k] !== v) INVL.push({ id: pre + k, from: t[k] || 0, to: v, at: where() }); t[k] = v; return true; } });
    G.inv = px(G.inv, ''); G.chest = px(G.chest, 'лабаз:');
    for (const k of ['sled', 'shovel']) watch(G.gear, k, FLD);
    watch(G.hut, 'fuel', FLD);
  }
  // поля, по которым видно состояние (и куда ставить аксессоры)
  const FIELDS = { tree: ['wood', 'stage'], log: ['cut', 'n', 'done', 'f'], fire: ['fuel'], stack: ['wood', 'lit'], trap: ['catch'], hole: ['fish'], build: ['done', 'prog'], amulet: ['got'], bear: ['st', 'hp'], wolf: ['hp'] };
  const MOVERS = { wolf: 1, hare: 1, unit: 1, deer: 1, bear: 1, veh: 1 };

  // ---------- перепись ----------
  const T0 = { rec: 0 };
  function census() {
    const p = G.p, M = new Map();
    const add = (cat, o, x, y, cls, sig, num, list) => {
      const vis = Math.abs(x - p.x) < VW && Math.abs(y - p.y) < VH;
      M.set(o, { cat, x, y, cls, sig: sig == null ? cls : sig, num, vis, list });
      if (FIELDS[cat]) for (const f of FIELDS[cat]) watch(o, f, FLD);
      if (MOVERS[cat] && vis) { watch(o, 'x', null, 1); watch(o, 'y', null, 1); }
    };
    for (const t of G.trees) if (!t.wall && Math.abs(t.x - p.x) < VW + 200 && Math.abs(t.y - p.y) < VH + 200) {
      const cls = t.wood > 0 ? (t.stage === 1 ? 'молодое' : 'стоит') : 'пень';
      add('tree', t, t.x, t.y, cls, cls + ' w' + t.wood, t.wood, 'trees');
    }
    for (const L of G.logs || []) { const cls = L.f && !L.f.hit ? 'падает' : L.done != null ? 'разделан' : 'лежит'; add('log', L, L.x, L.y, cls, cls + ' сучья' + Actions.logCut(L).toFixed(2) + ' n' + L.n, L.n, 'logs'); }
    for (const c of G.chunks || []) add('chunk', c, c.x, c.y, 'чурка', null, 0, 'chunks');
    for (const q of G.lap || []) add('lap', q, q.x, q.y, 'лапник', null, 0, 'lap');
    for (const q of G.litter || []) add('litter', q, q.x, q.y, 'банка', null, 0, 'litter');
    for (const t of G.traps || []) add('trap', t, t.x, t.y, 'ловушка', t.kind + ':' + (t.catch || 'пусто'), 0, 'traps');
    for (const h of G.holes || []) add('hole', h, h.x, h.y, 'лунка', 'лунка', h.fish, 'holes');
    for (const h of G.iceHoles || []) add('icehole', h, h.x, h.y, 'пролом', null, 0, 'iceHoles');
    for (const f of G.fires || []) add('fire', f, f.x, f.y, f.fuel > 0 ? 'горит' : 'погас', null, f.fuel, 'fires');
    for (const s of G.stacks || []) add('stack', s, s.x, s.y, s.lit > 0 ? 'горит' : 'куча', (s.lit > 0 ? 'горит' : 'куча') + ' w' + s.wood, s.lit > 0 ? s.lit : s.wood, 'stacks');
    for (const s of G.stashes || []) add('stash', s, s.x, s.y, 'тайник', null, 0, 'stashes');
    for (const c of G.corpses || []) add('corpse', c, c.x, c.y, 'туша:' + c.kind, null, 0, 'corpses');
    for (const f of G.fallen || []) add('fallen', f, f.x, f.y, 'бурелом', null, 0, 'fallen');
    for (const h of G.hares || []) add('hare', h, h.x, h.y, 'заяц', null, 0, 'hares');
    for (const w of G.wolves || []) add('wolf', w, w.x, w.y, 'волк', null, w.hp, 'wolves');
    if (G.bear) add('bear', G.bear, G.bear.x, G.bear.y, 'шатун', null, G.bear.hp, 'bear');
    for (const d of G.deer || []) add('deer', d, d.x, d.y, 'олень', null, 0, 'deer');
    if (G.col) {
      for (const b of G.col.builds) add('build', b, b.x, b.y, b.done ? 'построено' : 'стройка', (b.done ? 'построено' : 'стройка ') + (b.done ? '' : Math.floor(b.prog * 20)), b.prog, 'builds');
      for (const u of G.col.units) if (!u.hidden) add('unit', u, u.x, u.y, 'человек:' + u.type, null, 0, 'units');
    }
    for (const a of G.amuletsAt || []) if (!a.got || Actions.grabbing(a)) add('amulet', a, a.x, a.y, 'сэвэки', null, 0, 'amuletsAt');
    if (!G.flags.tube || Actions.grabbing(TUBE_POS)) add('tube', TUBE_POS, TUBE_POS.x, TUBE_POS.y, 'лампа', null, 0, 'flags.tube');
    if (typeof Trail !== 'undefined' && !G.flags.shovel) add('shovel', Trail.SHOVEL, Trail.SHOVEL.x, Trail.SHOVEL.y, 'лопата', null, 0, 'flags.shovel');
    if (!G.labaz) add('labaz', POI.labaz, POI.labaz.x, POI.labaz.y, 'мясо на лабазе', null, 0, 'labaz');
    for (const k of ['walls', 'door', 'bench', 'damper']) if (G.hut[k]) add('hut', HUTP[k], HUT.x, HUT.y, 'изба:' + k, null, 0, 'hut.' + k);
    if (G.veh) for (const k of ['deer', 'buran']) { const v = G.veh[k]; if (v) add('veh', v, v.x, v.y, k === 'deer' ? 'упряжка' : 'Буран', null, 0, 'veh.' + k); }
    { const n = Math.ceil(G.hut.fuel / Stove.secPerLog() - 1e-6), cls = G.hut.fuel > 0 ? 'печь горит' : 'печь холодная'; add('stove', SPOT.stove, SPOT.stove.x, SPOT.stove.y, cls, cls + ' ~' + n + ' пол.', G.hut.fuel, 'hut.fuel'); }
    for (const k of ['sled', 'shovel']) if (G.gear[k]) add('gear', GEARP[k], p.x, p.y, 'снаряжение:' + k, null, 0, 'gear.' + k);
    for (const f of NFALL) { const el = now - f.t0; if (el < f.end) add('npcfall', f, f.x, f.y, el < f.fall ? 'падает' : 'лежит', null, 0, 'gfx FALL'); }
    const a = p.action; if (handVis(a)) add('hand', a, p.x, p.y, 'в руке:' + a.item, null, 0, 'p.action.item');
    return M;
  }
  // вещь в руке нарисована только в окне позы (js/art-poses.js:302 takeChunk 0.34–0.84, :692 takeItem 0.22–0.84, :708 place < 0.5)
  const HELD = { takeChunk: [0.34, 0.84], takeItem: [0.22, 0.84], place: [0, 0.5], putDown: [0, 0.5] };
  const handPh = a => a.t / (a.dur || 1);
  function handVis(a) { if (!a || !a.item) return false; const w = HELD[a.pose] || [0, 1], ph = handPh(a); return ph > w[0] && ph < w[1]; }
  const GEARP = { sled: { k: 'sled' }, shovel: { k: 'shovel' } };
  // стволы людей посёлка живут только в рисовании (js/gfx.js:544 FALL): зеркалим их по тому же событию 'fell'
  const NFALL = []; let nfallOn = false;
  function hookFalls() {
    if (nfallOn || typeof Interact === 'undefined') return; nfallOn = true;
    Interact.on('fell', ev => { const t = ev.target; if (!t || t.stage === 1 || ev.log) return; NFALL.push({ x: t.x, y: t.y, t0: now, fall: 0.3 + 1.3, end: 0.3 + 1.1 + 22 }); });
  }
  const HUTP = { walls: { k: 'walls' }, door: { k: 'door' }, bench: { k: 'bench' }, damper: { k: 'damper' } };

  // ---------- реестр анимаций перехода (сверено с рисованием) ----------
  // SPAWN: у объекта есть своя анимация появления; FADE: мера «истлел/заметён» 0..1 (исчезать можно при ≥ 0.95)
  const SPAWN = {
    icehole: o => !!o.slabs,                            // js/ice.js:44 — плиты кренятся и уходят в воду
    npcfall: o => now - o.t0 < o.fall,                  // js/gfx.js:556 — ствол людей посёлка падает (только рисунок)
    chunk: o => o.fx != null,                          // js/gfx.js:881 — откатывается от места реза 0.45 с
    log: o => !!(o.f && !o.f.hit),                      // js/gfx.js:411 — надлом, падение маятником, отскок
  };
  // класс-«переход»: выход из него — конец анимации, не скачок
  const TRANS = { log: 'падает', npcfall: 'падает' };
  // изготовление: вещь «собирается» всё действие (прогресс над героем) — выход в конце действия считается процессом
  const MAKE = { craft: 1, vfix: 1 };
  const FADE = {
    npcfall: o => 1 - (o.end - (now - o.t0)) / 3,                         // js/gfx.js:557 — гаснет за 3 с («ствол унесли» — без носильщика)
    log: o => Actions.logSnow(o),                                          // js/actions.js:162 — заметает за сутки
    lap: o => (G.time - o.t) / (CYCLE * Actions.FELL.bury),               // js/gfx.js:879 — лапник уходит под снег
    corpse: o => (G.time - o.t0) / 90,                                     // js/art-animals.js:612 — бледнеет за 90 с (только alpha до 0.55)
    fire: o => 0,
  };

  // ---------- состояние прогона ----------
  let COV = {}, lastHand = -1e9, TRACE = {}, SC = '', T = 0, FR = 0, prev = null, prevInv = null, prevHand = null, pend = [], hist = new WeakMap(), V = [], RENDER = true, stats = {};
  const pos = r => ({ x: r.x, y: r.y });
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const hand = a => handVis(a) ? a.item : null;
  function effector(a) {
    const p = G.p;
    if (a.tg && a.tg.x != null) return a.tg;
    if (a.o && a.o.x != null) return a.o;
    return { x: p.x + p.face * 18, y: p.y };
  }
  // исполнители в кадре: действия героя (до и после шага) и работающие люди посёлка
  function actors(a0, a1, ut) {
    const out = [];
    for (const a of [a0, a1]) if (a && !out.some(q => q.a === a)) out.push({ who: 'герой', a, k: a.k, age: a.t, eff: effector(a) });
    if (G.col) for (const u of G.col.units) { const t = ut.get(u); if (u.working && t != null) out.push({ who: u.type, a: null, k: 'работа:' + u.working, age: Math.max(t, u.t), eff: u, unit: u }); }
    return out;
  }
  function contact(ac, o, r) {
    if (ac.a && (ac.a.o === o || (Array.isArray(ac.a.o) && ac.a.o.includes(o)))) return true;
    return d2(ac.eff, r) <= (ac.unit ? (R_CON + 30) ** 2 : R_CON * R_CON);
  }
  function locFor(ev) {
    const out = new Set();
    if (ev.type === 'appear' || ev.type === 'vanish') {
      for (const m of ev.mut) if ((m.add && m.add.includes(ev.o)) || (m.del && m.del.includes(ev.o))) out.add(m.at);
      if (!out.size) for (const m of ev.mut) if (m.list === ev.r.list || (ev.r.list || '').endsWith('.' + m.f)) out.add(m.at);
      if (!out.size) for (const m of ev.fld) if (ev.r.list && ev.r.list.endsWith(m.f)) out.add(m.at);
      if (!out.size && ev.r.cat === 'hand') out.add('p.action (' + (ev.ak || '?') + ')');
      if (!out.size && ev.r.cat === 'litter' && ev.type === 'vanish') out.add('js/gfx.js:883 (истечение в рисовании)');
    } else if (ev.type === 'morph') { for (const m of ev.fld) if (m.o === ev.o || (ev.r.list && ev.r.list.endsWith('.' + m.f))) out.add(m.at); }
    else if (ev.type === 'jump') { for (const m of ev.jmp) if (m.o === ev.o) out.add(m.at); }
    else if (ev.type === 'inv') { for (const m of ev.invl) if (m.id === ev.id) out.add(m.at); }
    return [...out].slice(0, 3);
  }

  function observe(a0, ut) {
    const cur = census(), inv = Object.assign({}, G.inv), a1 = G.p.action, ac = actors(a0, a1, ut);
    const mut = MUT.splice(0), fld = FLD.splice(0), invl = INVL.splice(0), jmp = JMP.splice(0);
    const evs = [];
    if (prev) {
      for (const [o, r] of prev) if (!cur.has(o) && r.vis) evs.push({ type: 'vanish', o, r, from: r.sig, to: '—' });
      for (const [o, r] of cur) {
        const q = prev.get(o);
        if (!q) { if (r.vis) evs.push({ type: 'appear', o, r, from: '—', to: r.sig }); continue; }
        if (!(r.vis || q.vis)) continue;
        if (q.sig !== r.sig) evs.push({ type: 'morph', o, r, q, from: q.sig, to: r.sig, cls: q.cls !== r.cls });
        if (MOVERS[r.cat] && r.vis && q.vis) { const d = Math.hypot(r.x - q.x, r.y - q.y); if (d > JUMP) evs.push({ type: 'jump', o, r, from: q.x.toFixed(0) + ',' + q.y.toFixed(0), to: '+' + d.toFixed(0) + ' px' }); }
      }
      // герой
      if (prev.hero) { const d = Math.hypot(G.p.x - prev.hero.x, G.p.y - prev.hero.y); if (d > JUMP) evs.push({ type: 'jump', o: G.p, r: { cat: 'hero', x: G.p.x, y: G.p.y, list: 'p' }, from: prev.hero.x.toFixed(0) + ',' + prev.hero.y.toFixed(0), to: '+' + d.toFixed(0) + ' px' }); }
      // рюкзак
      for (const id of new Set([...Object.keys(prevInv), ...Object.keys(inv)])) { const dv = (inv[id] || 0) - (prevInv[id] || 0); if (dv) evs.push({ type: 'inv', id, o: null, r: { cat: 'inv', x: G.p.x, y: G.p.y, list: 'inv' }, from: String(prevInv[id] || 0), to: (dv > 0 ? '+' : '') + dv + ' ' + id, dv }); }
    }
    // история чисел (для «постепенно»)
    for (const [o, r] of cur) if (r.num != null) { let h = hist.get(o); if (!h) hist.set(o, h = []); h.push(r.num); if (h.length > 90) h.shift(); }
    for (const ev of evs) { ev.mut = mut; ev.fld = fld; ev.invl = invl; ev.jmp = jmp; ev.f = FR; ev.t = T; ev.sc = SC; ev.ac = ac; ev.all = evs; ev.handPrev = prevHand; ev.ak = (a1 || a0 || {}).k; ev.loc = locFor(ev); judge(ev); }
    if (hand(a1)) lastHand = FR;
    prev = cur; prev.hero = { x: G.p.x, y: G.p.y }; prevInv = inv; prevHand = hand(a1);
    // отложенные проверки «перешёл в руку»
    for (let i = pend.length - 1; i >= 0; i--) if (FR >= pend[i].due) { const p = pend.splice(i, 1)[0]; p.fn(); }
  }

  function gradual(o, r) {
    const h = hist.get(o); if (!h || h.length < 3) return false;
    const last = Math.abs(h[h.length - 1] - h[h.length - 2]);
    let lo = Infinity, hi = -Infinity; for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo > 0 && last <= GRAD * (hi - lo) + 1e-9;
  }
  function successor(ev) {
    // преемник/предшественник в том же кадре рядом, у которого своя анимация перехода
    for (const e of ev.all) if (e !== ev && e.o && e.r && (e.type === 'appear' || e.type === 'morph') && d2(e.r, ev.r) <= R_SUCC * R_SUCC) {
      const f = SPAWN[e.r.cat]; if (f && f(e.o)) return e.r.cat + ' (' + e.to + ')';
    }
    return null;
  }
  function predecessor(ev) {
    for (const e of ev.all) if (e !== ev && e.o && e.r && (e.type === 'vanish' || e.type === 'morph') && e.r.cat !== 'hand' && d2(e.r, ev.r) <= R_SUCC * R_SUCC) return e.r.cat + ' (' + e.from + ')';
    return null;
  }
  function judge(ev) {
    const fails = [], r = ev.r;
    stats[ev.type] = (stats[ev.type] || 0) + 1; COV[ev.sc] = (COV[ev.sc] || 0) + 1;
    if (ev.type === 'jump') { fails.push('C3 скачок ' + ev.to + ' за кадр'); return report(ev, fails, null); }
    // C1 + C2
    let best = null;
    for (const ac of ev.ac) {
      const okT = ac.age >= T_MIN - 1e-6, okC = ev.type === 'inv' ? true : contact(ac, ev.o, r);
      if (okT && okC) { best = ac; break; }
      if (!best || (okC && !best.okC)) best = Object.assign({}, ac, { okT, okC });
    }
    const actor = best && best.okT !== false && best.okC !== false ? best : null;
    const natural = !ev.ac.length;
    if (!actor) {
      if (best) { if (best.okT === false) fails.push(`C1 действие «${best.k}» шло ${best.age.toFixed(2)} с < ${T_MIN}`); if (best.okC === false) fails.push(`C2 нет контакта с «${best.k}»: инструмент в ${Math.sqrt(d2(best.eff, r)).toFixed(0)} px`); }
      else fails.push('C1 нет исполнителя (ни действия героя, ни работы людей)');
    }
    // C3
    if (ev.type === 'inv') {
      if (!actor) return report(ev, fails, actor);
      if (ev.dv < 0 || MAKE[actor.k] || ev.id.startsWith('лабаз:')) return report(ev, [], actor);
      const f0 = ev.f; // прибавка в рюкзак — только через руку: вещь видна в руке за ±0.5 с от события
      pend.push({ due: FR + 30, fn: () => { if (lastHand >= f0 - 30) return report(ev, [], actor); report(ev, ['C3 «' + ev.id + '» попал в рюкзак, ни разу не показавшись в руке (±0.5 с)'], actor); } });
      return;
    }
    if (ev.type === 'morph') {
      if (!ev.cls) { if (!actor && gradual(ev.o, r)) return report(ev, [], null); return report(ev, actor ? [] : fails, actor); }
      if (TRANS[r.cat] && TRANS[r.cat] === ev.q.cls) return report(ev, [], actor); // конец своей анимации перехода
      const s = successor(ev); if (s && (actor || natural)) return report(ev, actor ? [] : fails.filter(f => !f.startsWith('C1 нет')), actor);
      if (gradual(ev.o, r)) return report(ev, actor ? [] : (natural ? [] : fails), actor);
      fails.push('C3 сменил вид «' + ev.from + '» → «' + ev.to + '» в один кадр (ни преемника с анимацией, ни постепенно)');
      return report(ev, fails, actor);
    }
    if (ev.type === 'vanish') {
      const fd = FADE[r.cat] && FADE[r.cat](ev.o);
      if (fd >= 0.95) return report(ev, [], actor);
      if (r.cat === 'hand') {
        const a = ev.o, w = HELD[a.pose] || [0, 1]; if (a.done || handPh(a) >= w[1] - 1e-6) return report(ev, [], actor); // рука дошла до сумки (конец окна позы) — убрано движением
        fails.length = 0; fails.push('C3 вещь пропала из руки, не дойдя до сумки: жест «' + a.k + '» прерван на ' + a.t.toFixed(2) + ' / ' + a.dur.toFixed(2) + ' с');
        return report(ev, fails, null);
      }
      const s = successor(ev);
      if (s) { if (actor) return report(ev, [], actor); fails.push('C3 стал «' + s + '», но без исполнителя'); return report(ev, fails, actor); }
      // перешёл ли в руку: смотрим через HAND_MIN
      const a = actor && actor.a, due = FR + LOOK;
      pend.push({ due, fn: () => {
        const p = G.p.action;
        if (a && p === a && hand(p) && !a.done) return report(ev, [], actor);
        if (actor) fails.push('C3 исчез «' + ev.from + '» без передачи в руку/преемника (через ' + HAND_MIN + ' с в руке: ' + (hand(p) || 'пусто') + ')');
        else fails.push('C3 исчез «' + ev.from + '» в один кадр');
        report(ev, fails, actor);
      } });
      return;
    }
    if (ev.type === 'appear') {
      if (r.cat === 'hand') {
        // вещь появилась в руке: из мира в момент касания (исчезла рядом в этом же кадре) или жест длится ≥ T_MIN
        const from = ev.all.find(e => e.type === 'vanish' && e.r.cat !== 'hand');
        if (from) return report(ev, [], actor);
        const bag = ev.all.find(e => e.type === 'inv' && e.dv < 0);
        return report(ev, ['C3 вещь «' + r.cls.replace('в руке:', '') + '» появилась в руке на ' + ev.o.t.toFixed(2) + ' с жеста, ' + (bag ? 'а из рюкзака ушла в кадр нажатия (без движения «достать»)' : 'а в мире её в этот кадр не было (исчезла раньше или не лежала вовсе)')], null);
      }
      const sa = SPAWN[r.cat] && SPAWN[r.cat](ev.o);
      if (sa && actor) return report(ev, [], actor);
      if (actor && MAKE[actor.k]) return report(ev, [], actor);
      const pr = predecessor(ev);
      if (sa && (pr || natural)) return report(ev, [], actor);
      if (ev.handPrev && actor) return report(ev, [], actor);
      if (!sa) fails.push('C3 появился сразу целым (нет анимации появления' + (pr ? ', предшественник: ' + pr : '') + (ev.handPrev ? '' : ', не из руки') + ')');
      return report(ev, fails, actor);
    }
  }
  function report(ev, fails, actor) {
    if (!fails.length) return;
    const loc = ev.loc.length ? ev.loc : ['?'];
    const key = [ev.sc, ev.r.cat, ev.type, loc[0].split(' ← ')[0]].join('|');
    let v = V.find(q => q.key === key);
    if (!v) V.push(v = { key, sc: ev.sc, cat: ev.r.cat, ev: ev.type, from: ev.from, to: ev.to, t: +ev.t.toFixed(2), at: loc, why: fails, act: (ev.ac.map(a => a.k + '@' + a.age.toFixed(2)).join(', ') || '—'), n: 0 });
    v.n++;
  }

  // ---------- сцена: заморозка постороннего, кадр, помощники ----------
  const OFF = []; let hold = { mx: 0, my: 0, act: false };
  function off(obj, name, ...ks) { for (const k of ks) if (obj && typeof obj[k] === 'function') { OFF.push([obj, k, obj[k]]); obj[k] = () => {}; } }
  function restore() { while (OFF.length) { const [o, k, f] = OFF.pop(); o[k] = f; } }
  function fresh(name, seed, o = {}) {
    restore();
    Math.random = mulberry(seed || 11);
    newGame(); state = 'play'; G.time = tAt(1, o.hour || 11); G.lastDawn = G.day; Hero.bodyReset();
    off(Story, 'Story', 'tick'); off(Director, 'Director', 'tick'); off(Weather, 'Weather', 'tick', 'newDay'); off(Survival, 'Survival', 'tick');
    off(Npc, 'Npc', 'tick', 'dawn'); off(UI.tips, 'tips', 'tick');
    if (!o.colony) off(Colony, 'Colony', 'update');
    if (!o.wolves) off(Wolves, 'Wolves', 'tick');
    if (!o.bear) off(Bear, 'Bear', 'tick');
    if (!o.hares) off(Fauna, 'Fauna', 'hares');
    G.storm = null; G.wolves = []; G.bear = null; G.s.hp = 1e6; G.s.warm = 100; G.s.food = 60;
    for (let i = 0; i < 8 && UI.modal(); i++) UI.closePanel();
    hookG(); NFALL.length = 0; lastHand = -1e9; SC = name; hold = { mx: 0, my: 0, act: false };
  }
  function phase(name) { SC = name; trace('·'); }
  function rebase() { prev = null; pend = []; MUT.length = FLD.length = INVL.length = JMP.length = 0; tick(); }
  function tick() {
    if (UI.modal()) UI.closePanel();
    input.mx = input.auto ? input.mx : hold.mx; input.my = input.auto ? input.my : hold.my; input.act = hold.act;
    const a0 = G.p.action, ut = new Map(); if (G.col) for (const u of G.col.units) ut.set(u, u.t);
    if (UI.kind) Game.visual(DT); else update(DT);
    now += DT; T += DT; FR++;
    if (RENDER) { try { GFX.lookAt(G.p.x, G.p.y); GFX.render(DT, null); } catch (e) { stats.renderErr = (stats.renderErr || 0) + 1; } }
    else Hero.pose && Hero.pose();
    observe(a0, ut);
  }
  function run(sec, until) { for (let t = 0; t < sec; t += DT) { tick(); if (until && until()) return true; } return false; }
  const P = () => G.p;
  function at(x, y, face) { const p = P(); p.x = x; p.y = y; if (face) p.face = face; p.inside = insideHut(x, y); Hero.snap(); }
  function E() { P().cd = 0; if (Actions.plate) Actions.plateClose(false); const c = Actions.context(); trace('E:' + (c ? c.k : '—')); Actions.interact(false); }
  function trace(s) { (TRACE[SC] = TRACE[SC] || []).push(s); }
  // переставить объект сценарием (не игрой): обновить прошлую перепись, чтобы не было «прыжка»
  function nudge(fn) { fn(); const c = census(); if (prev) { for (const [o, r] of c) { const q = prev.get(o); if (q) { q.x = r.x; q.y = r.y; } } } JMP.length = 0; }
  function iceSpot() { for (let k = 0; k < 400; k++) { const y = POI.polynya.y + 600 + k * 7, x = riverX(y) + ((k % 5) - 2) * 12; if (Depth.bareIce(x, y)) return { x, y }; } const y = POI.polynya.y + 600; return { x: riverX(y), y }; }
  function nearTree() {
    const p = P(), c = { x: POI.cockpit.x + 60, y: POI.cockpit.y + 120 };
    const t = G.trees.filter(t => t.wood > 0 && !t.wall && t.stage !== 1 && !onIce(t.x + 30, t.y) && Actions.chopSpot(t)).sort((a, b) => dist2(a, c) - dist2(b, c))[0];
    t.wood = Math.min(t.wood, 4); const q = Actions.chopSpot(t); at(q.x, q.y, Math.sign(t.x - q.x) || 1); return t;
  }

  // ---------- сценарии ----------
  const SCEN = {
    лес() {
      fresh('рубка', 3); G.gear.saw = 0;
      const t = nearTree(); rebase();
      hold.act = true; run(40, () => { const L = (G.logs || []).find(q => q.x === t.x && q.y === t.y); return L && !L.f; });
      const L = (G.logs || [])[0];
      phase('обрубка'); run(30, () => !L || Actions.logCut(L) >= 1);
      phase('разделка'); run(80, () => !L || L.n <= 0); hold.act = false; run(1);
      phase('подбор чурок'); hold.act = true; run(40, () => !(G.chunks || []).some(c => dist2(c, P()) < 80 * 80)); hold.act = false; run(2.5);
      phase('отдых на пне'); { const p = P(); at(t.x + 30, t.y + 2, -1); rebase(); E(); run(1.5); hold.mx = 1; run(0.5); hold.mx = 0; run(1); }
    },
    звери() {
      fresh('заяц руками', 5);
      { const p = P(); const h = G.hares[0]; h.x = p.x + 30; h.y = p.y; h.t = 99; rebase(); E(); run(3); }
      phase('заяц палкой');
      { const p = P(); for (let k = 0; k < 6 && G.hares.length; k++) { const h = G.hares[0]; nudge(() => { h.x = p.x + 110; h.y = p.y; }); const r0 = Math.random; Math.random = () => 0.01; P().cd = 0; trace('alt:throw'); Actions.alt(); run(1.6); Math.random = r0; } }
      fresh('волк', 6, { wolves: 1 });
      { const p = P(); const w = Wolves.at(0, 40, { st: 'circle', hp: 3 }); rebase(); for (let k = 0; k < 10 && G.wolves.includes(w); k++) { nudge(() => { w.x = p.x + 40; w.y = p.y; w.st = 'circle'; }); E(); run(0.6); } run(3); }
      fresh('шатун', 7, { bear: 1 });
      { const p = P(); G.chapter = 3; G.bear = { x: p.x + 50, y: p.y, hp: 2, hp0: 2, st: 'wander', t: 3, face: -1, step: 0, cd: 9, stunCd: 0, pr: 0, tgt: 0, raid: 0 }; rebase(); for (let k = 0; k < 6 && G.bear; k++) { nudge(() => { G.bear.x = p.x + 50; G.bear.y = p.y; G.bear.cd = 9; }); E(); run(0.6); } run(3); }
    },
    вещи() {
      fresh('банка', 8);
      { G.inv.can = 2; G.s.food = 20; rebase(); Actions.eat(); run(3); const lt = (G.litter || [])[0]; if (lt) { at(lt.x - 14, lt.y, 1); rebase(); E(); run(3); } }
      phase('банка истлела'); { const lt = (G.litter || [])[0] || (G.litter = [], G.litter.push({ x: P().x + 20, y: P().y, k: 'can', t: G.time, a: 0 }), G.litter[0]); at(lt.x - 40, lt.y); rebase(); lt.t = G.time - CYCLE * 0.5 + 0.2; run(1); }
      fresh('сэвэки', 9); { const a = G.amuletsAt[0]; at(a.x - 20, a.y, 1); rebase(); E(); run(3); }
      phase('лампа'); { at(TUBE_POS.x - 20, TUBE_POS.y, 1); rebase(); E(); run(3); }
      if (typeof Ice !== 'undefined' && Ice.active()) { trace('провалился под лёд'); run(25, () => !Ice.active()); Ice.reset(); } P().wetT = 0; P().action = null; Actions.wake && 0;
      phase('лабаз'); { at(POI.labaz.x - 42, POI.labaz.y + 12, 1); rebase(); E(); run(3); }
      phase('лопата'); { at(Trail.SHOVEL.x + 20, Trail.SHOVEL.y + 6, -1); rebase(); E(); run(2.5); }
      phase('лопата: тропа'); { at(HUT.x + 260, HUT.y + 260, 1); rebase(); hold.act = true; E(); run(3); hold.act = false; run(0.5); }
      phase('обломки'); { at(POI.cockpit.x, POI.cockpit.y + 60, 1); rebase(); E(); run(6); }
      phase('тайник'); { at(HUT.x + 300, HUT.y + 300); G.inv.wood = 3; rebase(); Actions.stashKey(); run(1); }
      phase('пинок сугроба'); { const d = G.drifts.find(d => !onIce(d.x, d.y) && Math.abs(d.x - HUT.x) > 300 && !Space.nearest(Space.trees, d.x, d.y, 70, t => t.wood > 0 && !t.wall)); if (d) { at(d.x, d.y); rebase(); const r0 = Math.random; Math.random = () => 0.01; E(); run(2.5); Math.random = r0; } }
    },
    огонь() {
      fresh('костёр', 10);
      { at(HUT.x + 320, HUT.y + 320, 1); G.inv.wood = 12; rebase(); Actions.fireKey(); run(1.5); Actions.fireKey(); run(1.5);
        const f = G.fires[G.fires.length - 1]; if (f) { at(f.x - 40, f.y, 1); rebase(); P().cd = 0; Actions.alt(); run(4); P().cd = 0; Actions.fireKey(); run(1); } }
      phase('костёр догорел'); { const f = G.fires[G.fires.length - 1]; if (f) { f.fuel = 0.4; rebase(); run(1.5); } }
      phase('сигнальная куча'); { const s = G.stacks[0]; at(s.x - 50, s.y, 1); G.inv.wood = 6; G.inv.kero = 0; rebase(); for (let k = 0; k < 4; k++) { P().cd = 0; Actions.fireKey(); run(0.4); } E(); run(2.5); }
      phase('печь'); { at(SPOT.stove.x + 20, SPOT.stove.y + 10, -1); G.chest.wood = 4; G.hut.fuel = 0; rebase(); E(); run(1); P().cd = 0; E(); run(1.5); }
    },
    вода() {
      fresh('лунка', 12);
      { const q = iceSpot(); at(q.x, q.y, 1); rebase(); E(); run(5); }
      phase('рыбалка');
      for (let k = 0; k < 4 && G.holes.length; k++) { P().cd = 0; E(); run(6, () => P().action && P().action.ph === 'bite'); const a = P().action; if (a && a.ph === 'bite') { a.z = 0; a.w = 1; run(0.3); Actions.fishStrike(); } run(1); }
    },
    ловушки() {
      fresh('ловушка: поставить', 13);
      { at(HUT.x + 340, HUT.y + 300, 1); G.inv.snare = 2; rebase(); Actions.placeKey(); run(3); }
      phase('ловушка: улов на рассвете'); { const r0 = Math.random; Math.random = () => 0.01; for (const t of G.traps) t.t = G.time - 1e5; Fauna.dawnTraps(); Math.random = r0; run(0.5); }
      phase('ловушка: забрать улов'); { const t = G.traps[0]; if (t) { at(t.x - 24, t.y, 1); rebase(); E(); run(3); P().action = null; run(0.3); P().cd = 0; E(); run(3); } }
    },
    крафт() {
      fresh('крафт', 14);
      { G.hut.bench = 1; G.hut.fuel = 900; at(SPOT.bench.x, SPOT.bench.y + 20, 1); G.inv.scrap = 4; rebase(); trace('craft:snare'); Actions.craft(RECIPES.find(r => r.id === 'snare')); run(4); G.inv.wood = 6; G.inv.scrap = 2; trace('craft:sled'); Actions.craft(RECIPES.find(r => r.id === 'sled')); run(9); }
      phase('крафт: отмена'); { G.inv.scrap = 2; rebase(); Actions.craft(RECIPES.find(r => r.id === 'snare')); run(1); hold.mx = 1; run(0.4); hold.mx = 0; run(0.5); }
      phase('изба: стройка'); { at(HUT.x + 40, HUT.y + 80, 1); G.inv.wood = 20; G.inv.scrap = 4; rebase(); Actions.buildHut(HUT_UPG[0]); run(0.5); Actions.buildHut(HUT_UPG[1]); run(0.5); }
    },
    сон() {
      fresh('сон', 15, { hour: 21 });
      { G.hut.fuel = 5000; G.hut.door = 1; at(SPOT.bed.x + 30, SPOT.bed.y + 20, -1); rebase(); Actions.trySleep(); run(4, () => P().sleeping); trace(P().sleeping ? 'уснул' : 'не уснул'); run(0.5); G.time = tAt(2, TUNE.time.wakeAt) - 0.05; run(3); }
      phase('рация'); { G.flags.radioBuilt = 1; G.time = tAt(2, 9); at(SPOT.bench.x, SPOT.bench.y + 20); rebase(); Actions.radioSession(); run(0.5); UI.closePanel(); run(0.5); }
    },
    транспорт() {
      fresh('Буран', 16);
      { const p = P(); at(HUT.x + 300, HUT.y + 300, 1); const v = G.veh.buran || (G.veh.buran = { x: 0, y: 0, face: 1, fixed: 1, fuel: 0 }); v.x = p.x + 30; v.y = p.y + 4; v.fixed = 1; v.fuel = 5000; rebase();
        E(); run(0.5); hold.mx = 1; run(2); hold.mx = 0; run(0.5); E(); run(1); }
      phase('упряжка'); { G.inv.meat = 9; G.inv.hare = 9; G.inv.wood = 9; G.inv.can = 9; G.inv.scrap = 9; G.veh.deer = null; rebase(); Transport.act({ k: 'rent', o: { x: P().x - 60, y: P().y - 50 } }); run(1); }
      phase('упряжка: в нарты'); { const d = G.veh.deer; if (d) { at(d.x - 20, d.y, 1); rebase(); Transport.mount('deer'); run(1); Transport.dismount(); run(1); } }
    },
    посёлок() {
      fresh('посёлок', 17, { colony: 1 });
      { const p = P(); at(HUT.x + 120, HUT.y + 160, 1); G.chest.wood = 60; G.chest.food = 0; G.chest.meat = 30; G.col.eatT = 1e9;
        rebase();
        const u = Colony.spawn('bich'); rebase();
        u.task = { k: 'chop', ph: 'go' }; const t = G.trees.filter(t => t.wood > 0 && !t.wall && t.stage !== 1).sort((a, b) => dist2(a, p) - dist2(b, p))[0]; t.wood = 2; u.task.tree = t; u.x = t.x + 26; u.y = t.y; at(t.x + 80, t.y + 30); rebase();
        run(25, () => t.wood <= 0); run(2);
        phase('посёлок: стройка'); at(HUT.x + 120, HUT.y + 220, 1); rebase(); Colony.startPlace('balok'); if (G.col.ghost) { G.col.ghost.x = P().x + 90; G.col.ghost.y = P().y + 20; Colony.place(); } run(40, () => G.col.builds.some(b => b.done)); run(1);
        phase('посёлок: найм'); at(HUT.x + 40, HUT.y + 90, 1); rebase(); trace('найм:' + Colony.unitState('bich')); Colony.hire('bich'); run(20, () => G.col.queue.length === 0); run(1);
      }
    },
    природа() {
      fresh('пень → поросль', 18);
      { const p = P(); const t = G.trees.filter(t => t.wood > 0 && !t.wall).sort((a, b) => dist2(a, p) - dist2(b, p))[0]; World.felled(t); t.wood = 0; at(t.x + 60, t.y + 20); rebase(); t.cutAt = G.time - TUNE.world.regrowStumpDays * CYCLE - 1; run(0.5); t.cutAt = G.time - TUNE.world.regrowYoungDays * CYCLE - 1; run(0.5); }
      phase('ствол заметает'); { const p = P(); const L = { x: p.x + 40, y: p.y + 30, a: 0, len: 120, s: 1, kind: 0, v: 0, n: 0, n0: 4, t0: G.time, id: 999, done: G.time - CYCLE * Actions.FELL.bury + 0.3 }; G.logs = G.logs || []; G.logs.push(L); rebase(); run(1); }
      phase('лапник заметает'); { const p = P(); G.lap = G.lap || []; G.lap.push({ x: p.x + 30, y: p.y, a: 0, s: 1, t: G.time - CYCLE * Actions.FELL.bury + 0.3 }); rebase(); run(1); }
    },
  };

  function runAll(o = {}) {
    RENDER = o.render !== false; V = []; stats = {}; T = 0; FR = 0;
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast, dlg: UI.dialog, sto: window.setTimeout };
    SaveGame.checkpoint = () => {}; Fx.toast = () => {};
    window.setTimeout = (f, ms) => 0; // отложенные тосты игры не нужны
    const only = o.only ? o.only : null, done = [], errs = [];
    hookArrays(); hookFalls(); TRACE = {}; COV = {}; NFALL.length = 0;
    try {
      for (const k in SCEN) { if (only && !only.includes(k)) continue; try { SCEN[k](); done.push(k); } catch (e) { errs.push(k + ': ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } }
    } finally {
      unhookArrays(); restore(); SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; window.setTimeout = keep.sto;
      hold = { mx: 0, my: 0, act: false }; input.mx = input.my = 0; input.act = false;
    }
    const ex = [], list = [];
    for (const v of V) { const why = EXCEPT[v.key]; if (why) { v.except = why; ex.push(v); } else list.push(v); }
    return { scenarios: done, trace: TRACE, cover: COV, errors: errs, frames: FR, events: stats, violations: list, excepted: ex, T_MIN, R_CON, JUMP };
  }
  return { run: runAll, SCEN, EXCEPT };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
  const arg = k => { const a = process.argv.find(s => s.startsWith('--' + k)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
  const strict = !!arg('strict'), fast = !!arg('fast'), only = arg('only');
  // приоритет: что игрок заметит первым — частые действия у героя под носом
  const PRI = { 'рубка': 1, 'обрубка': 1, 'разделка': 1, 'подбор чурок': 1, 'костёр': 1, 'заяц руками': 1, 'банка': 1, 'печь': 1,
    'волк': 2, 'заяц палкой': 2, 'лунка': 2, 'рыбалка': 2, 'ловушка: поставить': 2, 'ловушка: забрать улов': 2, 'крафт': 2, 'изба: стройка': 2, 'сигнальная куча': 2, 'лопата': 2, 'тайник': 2, 'Буран': 2, 'отдых на пне': 2, 'сон': 2,
    'шатун': 3 };
  (async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(800);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      const r = await pg.evaluate(o => NoInstant.run(o), { render: !fast, only: only ? only.split(',') : null });
      const V = r.violations.map(v => Object.assign(v, { pri: PRI[v.sc] || 3 })).sort((a, b) => a.pri - b.pri || b.n - a.n);
      const C = { red: s => '\x1b[31m' + s + '\x1b[0m', yel: s => '\x1b[33m' + s + '\x1b[0m', dim: s => '\x1b[2m' + s + '\x1b[0m', bold: s => '\x1b[1m' + s + '\x1b[0m' };
      const EV = { vanish: 'ИСЧЕЗ', appear: 'ПОЯВИЛСЯ', morph: 'СМЕНИЛ ВИД', jump: 'ПРЫЖОК', inv: 'РЮКЗАК' };
      console.log(C.bold(`no-instant: ${r.scenarios.length} сценариев, ${r.frames} кадров, событий ${JSON.stringify(r.events)}`));
      // покрытие: какие фазы что делали (контекст E) и сколько событий мира дали — пустая фаза = сценарий не сработал
      const ph = Object.keys(Object.assign({}, r.trace, r.cover));
      console.log(C.dim('покрытие: ' + ph.map(k => `${k} [${[...new Set((r.trace[k] || []).filter(x => x !== '·'))].join(' ') || '—'}] ${r.cover[k] || 0} соб.`).join(' · ')));
      let pri = 0;
      for (const v of V) {
        if (v.pri !== pri) { pri = v.pri; console.log(C.bold(`\n— приоритет ${pri} —`)); }
        console.log(`${(v.pri === 1 ? C.red : C.yel)('✗')} [${v.sc}] ${v.cat} ${EV[v.ev]} ${v.from} → ${v.to}  ×${v.n}  ${C.dim('t=' + v.t + ' с, действия: ' + v.act)}\n    ${v.at.join(' | ')}\n    ${C.dim(v.why.join('; '))}`);
      }
      if (r.excepted.length) console.log(C.dim(`\nисключения (${r.excepted.length}): ` + r.excepted.map(v => v.key + ' — ' + v.except).join('; ')));
      if (r.errors.length) console.log(C.red('\nошибки сценариев:\n' + r.errors.join('\n')));
      if (errs.length) console.log(C.red('ошибки страницы:\n' + errs.join('\n')));
      console.log(C.bold(`\nнарушений: ${V.length} (групп), исключено: ${r.excepted.length}`));
      fs.writeFileSync(path.join(__dirname, 'no-instant.json'), JSON.stringify(Object.assign({}, r, { violations: V }), null, 1));
      process.exitCode = strict && (V.length || r.errors.length) ? 1 : 0;
    } finally { await b.close(); }
  })();
}
