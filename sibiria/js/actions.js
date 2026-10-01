'use strict';
// Действия героя: что рядом (context), E / F / еда / ловушки, завершение долгих действий, крафт, сон, рация.
const Actions = (() => {
  const A = TUNE.act;
  const nearest = (src, r, f) => Space.nearest(src, G.p.x, G.p.y, r, f);
  const liveHare = h => G.hares.includes(h); // сетка зайцев обновляется раз в 8 шагов — отсекаем уже пойманных
  const D = () => ArtPeople.DUR;
  const petDog = () => G.col && G.col.units.find(u => u.pet && !u.hidden);
  const faceTo = o => { if (o && Math.abs(o.x - G.p.x) > 3) G.p.face = Math.sign(o.x - G.p.x); };
  // точка в r px от героя в сторону o (куда кладёт/откуда берёт)
  const toward = (o, r) => { const p = G.p, dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 1; return { x: p.x + dx / d * Math.min(r, d), y: p.y + dy / d * Math.min(r, d) }; };
  // обломки длинные (Ми-8 — 320 px): работают у ближайшего к герою места корпуса, а не у центра
  const WRECK_W = { cockpit: 130, tail: 90 };
  const wreckPt = w => ({ x: clamp(G.p.x, POI[w].x - WRECK_W[w], POI[w].x + WRECK_W[w]), y: POI[w].y });
  // подбросить в огонь/печь/кучу: жест «кинуть полено» к ней, если полено ушло
  const feed = (o, f0, f1) => { if (f1 > f0) { faceTo(o); Hero.play('feedStove', { react: 1, tg: o }); } };
  // память жестов (не в G): пнутые сугробы, прочитанные следы, пауза «погладить» у собаки
  const KICKED = new WeakSet(), READ = new WeakSet(), PETCD = new WeakMap();
  let readXpT = -1e9;
  const KICK_FIND = [['wood', 0.6], ['scrap', 0.25], ['can', 0.15]];

  // ---------- действия в мире (docs/design/INTERACTION-PASSPORT.md, «действия в мире») ----------
  // Всё рантайм, не в G (кроме того, что остаётся лежать: G.logs — сваленные стволы, G.chunks — чурки, G.litter — пустые банки).
  // PLATE — плашка над героем/вещью: текст записки или подпись осмотра; страницы считает рисование (GFX), E — дальше/закрыть, шаг — закрыть.
  let PLATE = null, AUTO = null, LAST = null, LASTG = null;
  // cx — жест, который E/движение прерывают без потерь (эффект уже применён): взять в руки, поесть, осмотр, чтение
  const CRAFT_T = { torch: 1.2, tea: 2.5, stew: 4, snare: 3, lure: 3, trap: 4.5, hat: 5, dokha: 7, sled: 8, antenna: 5, radio: 8 };
  const EAT_ITEM = { stew: 'bowl', can: 'can', dried: 'dried', meat: 'meat', fish: 'fish', honey: 'jar' };
  // взять вещь: наклон → в руке ≈1 с → в сумку (поза takeItem); tg — где лежит, th — высота
  function take(item, tg, th) {
    const p = G.p; if (p.ride || p.sleeping) return;
    if (p.action && p.action.cx) p.action = null;
    if (p.action) return;
    faceTo(tg); p.action = { k: 'take', t: 0, dur: D().takeItem || 2.2, pose: 'takeItem', item, tg: { x: tg.x, y: tg.y }, th: th || 0, o: tg, cx: 1, fb: 'pickUp' };
  }
  // вещь ещё лежит, пока рука до неё не дотянулась (для рисования: лампа, сэвэки, записка на земле)
  function grabbing(o) {
    const a = G.p.action; if (!a || a.o !== o) return false;
    if (a.k === 'take') return a.t / a.dur < 0.21;
    return false;
  }
  const notePos = (id, out) => typeof Live !== 'undefined' && Live.notePos ? Live.notePos(id, out) : NOTES[id];
  function noteInHand(id) {
    const a = G.p.action; if (!a || a.o !== id) return false;
    if (a.k === 'notePick') return a.t / a.dur > 0.42;
    if (a.k === 'noteRead') return true;
    if (a.k === 'notePut') return a.t / a.dur < 0.58;
    return false;
  }
  function plate(t, ic, at, o = {}) { syncG(); PLATE = Object.assign({ t, ic, at, page: 0, pages: 1, age: 0 }, o); }
  // E при открытой плашке: следующая страница или закрыть (записка — положить лист обратно)
  function plateNext() {
    if (!PLATE) return false;
    if (PLATE.page + 1 < PLATE.pages) { PLATE.page++; PLATE.age = 0; Sound.tone && Sound.tone('triangle', 900, 700, 0.05, 0.03); return true; }
    plateClose(true); return true;
  }
  function plateClose(put) {
    const pl = PLATE, p = G.p; PLATE = null; if (!pl) return;
    if (pl.note && p.action && p.action.k === 'noteRead') {
      const n = notePos(pl.note, {}); p.action = put ? { k: 'notePut', t: 0, dur: D().putDown || 1, pose: 'putDown', o: pl.note, tg: { x: n.x, y: n.y }, th: -2, fb: 'pickUp' } : null;
    } else if (pl.a && p.action === pl.a && pl.a.cx) p.action = null;
  }
  // прочитать записку в мире: наклон → лист в руке → у груди, плашка с текстом; E — дальше/положить, шаг — бросить читать
  function startNote(id) {
    const p = G.p, n = notePos(id, {}); faceTo(n); readNote(id);
    p.action = { k: 'notePick', t: 0, dur: D().pickPaper || 1.2, pose: 'pickPaper', o: id, tg: { x: n.x, y: n.y }, th: -2, fb: 'pickUp' };
  }
  // пустая банка остаётся лежать (исчезает через полсуток или подобрать)
  function litter(k) {
    const p = G.p; G.litter = G.litter || [];
    if (G.litter.length >= 12) G.litter.shift();
    G.litter.push({ x: Math.round(p.x + p.face * 13), y: Math.round(p.y + 5), k, t: G.time, a: +(Math.random() * 3).toFixed(2) });
  }
  // ---------- срубленная ель: лежит, пока не разделают (чурки на снегу — это и есть дрова) ----------
  // Падает от героя; если по пути ствола другой ствол, изба, обломки, куча, бревно — пробуем другой угол (±0.4…1.2), затем обратную сторону.
  function logLen(t) { return Math.round(150 * t.s / (ArtWorld.treeK ? ArtWorld.treeK(t.s) : 1)); }
  function fallBlocked(t, a, len) {
    const cs = Math.cos(a), sn = Math.sin(a) * 0.6;
    for (let d = 24; d <= len; d += 12) {
      const x = t.x + cs * d, y = t.y + sn * d;
      if (x < 40 || y < 40 || x > W - 40 || y > H - 40) return true;
      if (insideHut(x, y) || (Math.abs(x - HUT.x) < 140 && y > HUT.y - 150 && y < HUT.y + 80)) return true;
      for (const k of ['cockpit', 'tail']) { const P = POI[k]; if (Math.abs(x - P.x) < (k === 'cockpit' ? 170 : 110) && Math.abs(y - P.y) < 70) return true; }
      if (Math.abs(x - POI.labaz.x) < 45 && Math.abs(y - POI.labaz.y + 10) < 40) return true;
      if (Space.nearest(Space.trees, x, y, 14, q => q !== t && q.wood > 0 && !q.wall)) return true;
      for (const s of G.stacks) if (dist2(s, { x, y }) < 30 * 30) return true;
      for (const f of G.fires) if (dist2(f, { x, y }) < 26 * 26) return true;
      if (G.col) for (const b of G.col.builds) { const B = BUILDS[b.type]; if (Math.abs(x - b.x) < B.w / 2 + 8 && Math.abs(y - b.y) < B.h / 2 + 8) return true; }
      for (const L of (G.logs || []).concat(G.fallen || [])) { const ex = L.x + Math.cos(L.a) * L.len, ey = L.y + Math.sin(L.a) * L.len * 0.6, vx = ex - L.x, vy = ey - L.y, k = clamp(((x - L.x) * vx + (y - L.y) * vy) / (vx * vx + vy * vy || 1), 0, 1); if (Math.hypot(x - L.x - vx * k, y - L.y - vy * k) < 12) return true; }
    }
    return false;
  }
  function fallDir(t, a0) {
    const len = logLen(t);
    for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI, Math.PI + 0.5, Math.PI - 0.5]) if (!fallBlocked(t, a0 + da, len)) return a0 + da;
    return null;
  }
  function fell(t) {
    const p = G.p, len = logLen(t), a0 = Math.atan2(t.y - p.y, t.x - p.x);
    let a = fallDir(t, a0); const blocked = a == null; if (blocked) a = a0;
    G.logs = G.logs || [];
    if (G.logs.length >= 8) G.logs.shift();
    const n = World.wood0(t);
    const L = { x: t.x, y: t.y, a: +a.toFixed(3), len: blocked ? Math.round(len * 0.55) : len, s: t.s, kind: t.kind, n, n0: n, t0: G.time, id: (G.logN = (G.logN || 0) + 1) };
    G.logs.push(L);
    return L;
  }
  const logEnd = (L, k) => ({ x: L.x + Math.cos(L.a) * L.len * k, y: L.y + Math.sin(L.a) * L.len * 0.6 * k });
  // ближайшее место ствола к герою (разделка идёт с того конца, что ближе к вершине: сначала сучья, потом чурки)
  // сколько ствола осталось (доля длины от комля): разделка идёт от вершины — первый рез снимает крону (сучья), дальше чурки
  const logK = L => (L.n0 ? 0.12 + 0.88 * L.n / L.n0 : 1);
  // точка ствола, ближайшая к q (на оставшейся части)
  function logPt(L, q) {
    const e = logEnd(L, logK(L)), vx = e.x - L.x, vy = e.y - L.y, k = clamp(((q.x - L.x) * vx + (q.y - L.y) * vy) / (vx * vx + vy * vy || 1), 0.08, 1);
    return { x: L.x + vx * k, y: L.y + vy * k, k };
  }
  function nearLog(r) {
    const p = G.p; let best = null, bd = r * r;
    for (const L of G.logs || []) { if (L.n <= 0) continue; const q = logPt(L, p), d = dist2(q, p); if (d < bd) { bd = d; best = L; } }
    return best;
  }
  function nearChunks(r) { const p = G.p; return (G.chunks || []).filter(c => dist2(c, p) < r * r); }

  // Тексты с числами (':fire: +25 с', 'Костёр: :wood:3', 'Спать — после 19:00') — литералы контента
  // (сверяются tests/content-snapshot.js); меняя TUNE, поправь и их.
  // ---------- что под рукой ----------
  function context() {
    const p = G.p;
    if (p.sleeping) return null;
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < A.bearR * A.bearR) return { k: 'bear', label: p.torch > 0 ? 'Ткнуть факелом' : 'Ударить', o: G.bear };
    const w = nearest(G.wolves, A.wolfR); if (w) return { k: 'wolf', label: 'Ударить', o: w };
    // заяц (замер рядом) не перехватывает разговор: человек ближе зайца — сначала человек
    const h = nearest(Space.hares, A.hareR, liveHare);
    if (h) { const nc = !p.ride && Npc.context(p); if (!(nc && nc.o && nc.o.x != null && dist2(nc.o, p) < dist2(h, p))) return { k: 'hare', label: 'Поймать', o: h }; }
    const tc = Transport.context(p); if (tc) return tc;
    if (p.ride) return null; // верхом — только «слезть»
    // из избы палку не бросить (стены) — и «Бросить палку» не перехватывает у лежанки «Спать», пока волки кружат у избы
    const wf = !p.inside && nearest(G.wolves, A.throwR, w => w.st !== 'retreat'); if (wf) return { k: 'throw', label: 'Бросить палку', o: wf };
    const npc = Npc.context(p); if (npc) return npc;
    const zc = Zones.context(p) || Transport.urkContext(p); if (zc) return zc;
    if (!G.labaz && dist2(POI.labaz, p) < 70 * 70) return { k: 'labaz', label: 'Лабаз · :meat:2' };
    const stash = World.nearestStash(p, 50); if (stash) return { k: 'stash', label: 'Тайник', o: stash };
    const am = G.amuletsAt && G.amuletsAt.find(a => !a.got && dist2(a, p) < 44 * 44); if (am) return { k: 'amulet', label: 'Сэвэки :sevek:', o: am };
    if (G.col) {
      const site = G.col.builds.find(b => !b.done && dist2(b, p) < (BUILDS[b.type].w / 2 + 30) ** 2); if (site) return { k: 'site', label: `Строить ${BUILDS[site.type].i} ${Math.floor(site.prog * 100)}%`, o: site };
      const bl = G.col.builds.find(b => b.done && dist2(b, p) < (BUILDS[b.type].w / 2 + 34) ** 2 && ['market', 'forge'].includes(b.type));
      if (bl) return { k: 'bld', label: bl.type === 'market' ? 'Фактория :market:' : 'Кузня :forge:', o: bl };
    }
    for (const q of INSPECT) if (dist2(q, p) < 50 * 50) return { k: 'inspect', label: 'Осмотреть ' + q.i, o: q };
    const dr = G.deer && nearest(G.deer, 50); if (dr) return { k: 'deer', label: 'Олень :deer:', o: dr };
    { let nb = null, nd = 46 * 46; for (const id in NOTES) { if (id === 'labaz') continue; const d = dist2(notePos(id), p); if (d < nd) { nd = d; nb = id; } } // ближайшая записка там, где лист лежит сейчас (ветер сносит до 34 px; у обломков две в 42 px друг от друга)
      if (nb) return { k: 'note', label: G.notes[nb] ? 'Перечитать' : 'Прочитать', o: nb }; }
    if (p.inside) {
      if (dist2(SPOT.stove, p) < 50 * 50) return { k: 'stove', label: G.hut.fuel > 0 ? 'Подбросить :wood:' : 'Растопить :wood:' };
      if (dist2(SPOT.bench, p) < 52 * 52) return { k: 'bench', label: G.hut.bench ? (G.flags.radioBuilt ? 'Рация / верстак' : 'Верстак') : 'Изба' };
      if (dist2(SPOT.chest, p) < 46 * 46) return { k: 'chest', label: 'Лабаз' };
      if (dist2(SPOT.bed, p) < 48 * 48) return { k: 'bed', label: 'Спать' };
    }
    // лайка — только лицом к ней (своя ходит по пятам сзади и не должна перехватывать E)
    const dog = G.col && nearest(G.col.units, 44, u => u.type === 'laika' && !u.hidden && Math.sign(u.x - p.x) === p.face);
    if (dog) return { k: 'dog', label: 'Погладить :dog:', alt: dog.pet ? (dog.task.k === 'stay' ? 'Ко мне' : 'Сидеть') : null, o: dog, soft: 1 };
    const fr = !p.inside && nearest(G.fires, 64, f => f.fuel > 0); if (fr) return { k: 'fire', label: 'Греть руки', alt: 'Засыпать снегом', o: fr, soft: 1 };
    const tr = nearest(G.traps, 44); if (tr) return { k: 'trap', label: tr.catch ? 'Забрать ' + ITEMS[tr.catch].i : 'Снять ' + ITEMS[tr.kind].i, o: tr };
    const st = nearest(G.stacks, 56);
    if (st) {
      if (st.lit > 0) return null;
      if (st.wood < 4) return { k: 'stack', label: `Куча ${st.wood}/4 · +:wood:`, o: st };
      return { k: 'stack', label: Inv.has('kero', false) ? 'Поджечь :kero:' : 'Поджечь', o: st };
    }
    for (const w of ['cockpit', 'tail']) if (G.wreck[w].length && dist2(POI[w], p) < 120 * 120) return { k: 'wreck', label: `Разбирать · ${G.wreck[w].length}`, o: w };
    if (!G.flags.tube && dist2(TUBE_POS, p) < 44 * 44) return { k: 'tube', label: 'Взять :tube:' };
    if (!p.inside && !onIce(p.x, p.y)) {
      // сугроб под ногами не перехватывает «Рубить»: дерево рядом, герой к нему лицом или оно ближе середины сугроба — дерево (ниже)
      // увяз глубже пояса (js/depth.js) — разгрести снег вокруг себя (утоптать и выбраться)
      if (typeof Depth !== 'undefined' && Depth.heroSink > 95 && !p.ride && !nearest(Space.trees, 34, t => t.wood > 0 && !t.wall)) return { k: 'digout', label: 'Разгрести снег', soft: 1 };
      const d = driftAt(p.x, p.y);
      if (d && !KICKED.has(d)) {
        const t = nearest(Space.trees, 56, t => t.wood > 0 && !t.wall);
        const toTree = t && (Math.abs(t.x - p.x) < 6 || Math.sign(t.x - p.x) === p.face || dist2(t, p) < dist2(d, p));
        if (!toTree) return { k: 'drift', label: 'Пнуть сугроб', o: d, soft: 1 };
      }
      let pr = null, pd = A.readR * A.readR;
      for (let i = G.prints.length - 1, n = 0; i >= 0 && n < 160; i--, n++) { const f = G.prints[i]; if (f.k !== 'p' && f.life > 3 && !READ.has(f)) { const q = dist2(f, p); if (q < pd) { pd = q; pr = f; } } }
      if (pr) return { k: 'tracks', label: 'Читать след', o: pr, soft: 1 };
    }
    if (!p.inside) {
      const ch = nearChunks(46); if (ch.length) return { k: 'chunks', label: `Взять чурки · +${ch.length} :wood:`, o: ch };
      const lg = nearLog(44); if (lg) return { k: 'log', label: lg.n === lg.n0 ? 'Обрубить сучья' : `Разделать · ${lg.n}`, rep: 1, o: lg };
      const lt = (G.litter || []).find(q => dist2(q, p) < 34 * 34); if (lt) return { k: 'litter', label: 'Подобрать банку', o: lt, soft: 1 };
    }
    const t = nearest(Space.trees, 56, t => t.wood > 0 && !t.wall); if (t) return { k: 'tree', label: 'Рубить', alt: 'Трясти', rep: 1, o: t };
    const sp = !p.inside && nearest(Space.trees, 40, t => t.wood <= 0 && !t.wall && t.stage !== 1); if (sp) return { k: 'rest', label: 'Присесть', o: sp, soft: 1 };
    if (onIce(p.x, p.y)) {
      const hole = nearest(G.holes, 34);
      if (hole) return { k: 'fish', label: 'Рыбачить', o: hole };
      return { k: 'dig', label: 'Пробить лунку' };
    }
    return null;
  }

  // ---------- E: действие по контексту ----------
  function interact(silent) {
    if (state !== 'play' || UI.modal()) return;
    const p = G.p;
    if (p.ko || AUTO) return;
    if (typeof Ice !== 'undefined' && Ice.active()) return; // в полынье: E — «быстрее выбираться» (js/ice.js)
    if (!silent && PLATE && (PLATE.age > 0.25 || PLATE.note)) { if (p.action && (p.action.k === 'notePick')) return; plateNext(); p.cd = Math.max(p.cd, 0.2); return; }
    if (p.action && p.action.k === 'notePick') return;
    if (p.action && p.action.cx && !silent) { p.action = null; watch(); }
    if (p.cd > 0 || p.action || p.sleeping) return;
    const c = context();
    if (!c) { if (!silent) Fx.toast(':close: Здесь нечего делать'); p.cd = 0.3; return; }
    if (c.npc) { if (!silent) { faceTo(c.o); UI.dialog(Npc.talk(c.k)); } return; }
    if (silent && c.soft) return; // удержание E повторяет только работу, не жесты
    primary(c, silent);
    if (!silent) { HOLD.c = c; HOLD.a = p.action; HOLD.t = 0; HOLD.done = false; }
  }
  function primary(c, silent) {
    const p = G.p;
    switch (c.k) {
      case 'throw': throwAt(c.o, 'wolf'); break;
      case 'dog': faceTo(c.o); p.action = { k: 'pet', t: 0, dur: A.petT, pose: 'pet', loop: 1, tg: c.o, th: -8, o: c.o }; break;
      case 'fire': faceTo(c.o); p.action = { k: 'warm', t: 0, dur: A.warmT, pose: G.s.warm < 30 ? 'warmHandsCold' : 'warmHands', loop: 1, tg: c.o, th: -8, o: c.o, fl: 0 }; break;
      case 'digout': { const per = D().scoop || 1; p.action = { k: 'digout', t: 0, dur: 2.4, pose: 'scoop', per, loop: 1, fb: 'dig' }; } break;
      case 'drift': p.action = { k: 'kick', t: 0, dur: D().kick || A.kickT, pose: 'kick', tg: { x: p.x + p.face * 16, y: p.y + 2 }, o: c.o, marks: [0.45], fb: 'swing' }; break;
      case 'tracks': faceTo(c.o); p.action = { k: 'read', t: 0, dur: A.readT, pose: 'crouch', loop: 1, tg: c.o, o: c.o }; break;
      case 'rest': p.x = c.o.x + p.face * 2; p.y = c.o.y + 3; Hero.snap(); p.action = { k: 'rest', t: 0, dur: 1e6, pose: 'rest', loop: 1, o: c.o, fb: 'sit' }; break;
      case 'wolf': Wolves.hit(c.o); break;
      case 'bear': Bear.hit(c.o); break;
      case 'hare': {
        const h = c.o; G.hares.splice(G.hares.indexOf(h), 1);
        Inv.add('meat'); Inv.add('hare'); G.stats.hares++; Hero.xp('hunt'); p.cd = 0.4; take('hare', h, -2); // поднял за уши, рассмотрел — в сумку
        Fx.floatText(h.x, h.y - 20, '+:meat: +:hare:'); Fx.burst(h.x, h.y - 6, 10, '#ffffff'); Sound.pick();
        break;
      }
      case 'note': if (!silent) startNote(c.o); break;
      case 'labaz': { faceTo(POI.labaz); G.labaz = 1; Inv.add('meat', 2); G.notes.labaz = 1; Sound.pick(); take('meat', { x: POI.labaz.x - 8, y: POI.labaz.y }, -30);
        const n = NOTES.labaz; plate(n.t, n.i, { x: POI.labaz.x, y: POI.labaz.y - 78 }, { life: 7, obj: 1 }); } break;
      case 'stash': if (!silent) { faceTo(c.o); Hero.play('open', { react: 1, tg: c.o }); Interact.emit('open', { who: 'p', obj: 'stash', target: c.o, x: c.o.x, y: c.o.y }); UI.openStash(c.o); } break;
      case 'amulet': take('amulet', c.o, -2); c.o.got = 1; G.amulets++; Fx.toast(`:sevek: Сэвэки ${G.amulets}/12`); Sound.ok2(); Fx.burst(c.o.x, c.o.y - 10, 14, '#ffd27a');
        Quests.check('amulets');
        break;
      case 'site': faceTo(c.o); p.buildT = 0.35; p.buildB = c.o.id; p.cd = 0.25; Hero.play('swing', { react: 1, tg: c.o, ik: 0 }); Interact.emit('work', { who: 'p', what: 'build', x: c.o.x, y: c.o.y }); break;
      case 'bld': if (!silent) { faceTo(c.o); UI.openCraft(c.o.type === 'market' ? 'market' : 'epoch'); } break;
      case 'inspect': if (!silent) { faceTo(c.o); p.action = { k: 'inspect', t: 0, dur: clamp(2 + c.o.t.length * 0.045, 3, 7), pose: 'inspect', loop: 1, tg: { x: c.o.x, y: c.o.y }, th: -12, o: c.o, cx: 1, fb: 'crouch' };
        plate(c.o.t, c.o.i, { x: c.o.x, y: c.o.y - 46 }, { a: p.action, obj: 1 }); p.cd = 0.3; } break;
      case 'veh': case 'vfix': case 'vfuel': case 'rent': if (!silent || c.k !== 'veh') Transport.act(c); p.cd = 0.4; break;
      case 'survey': p.action = { k: 'survey', t: 0, dur: TUNE.zone.surveyT, o: c.o.id, pose: 'lookAround', loop: 1, fb: 'build' }; break;
      case 'forecast': if (!silent) { Fx.toast(Zones.forecast()); G.flags.forecast = G.day; p.cd = 1; } break;
      case 'loot': faceTo(c.o); p.action = { k: 'loot', t: 0, dur: TUNE.zone.lootT, o: c.o.id, pose: 'pry', loop: 1, fb: 'build', tg: { x: c.o.x, y: c.o.y }, th: -24 }; break;
      case 'deer': if (!silent) { Fx.toast(':deer: Олень Уркачана. Не трогай — дед обидится.'); p.cd = 1; } break;
      case 'stove': { const f0 = G.hut.fuel; Stove.add(); feed(SPOT.stove, f0, G.hut.fuel); p.cd = 0.3; } break;
      case 'bench': if (!silent) { faceTo(SPOT.bench); UI.openCraft(G.hut.bench ? 'craft' : 'hut'); } break;
      case 'chest': if (!silent) { faceTo(SPOT.chest); Hero.play('open', { react: 1, tg: SPOT.chest }); UI.openChest(); } break;
      case 'bed': if (!silent) trySleep(); break;
      case 'chunks': { const n = c.o.length; for (const q of c.o) G.chunks.splice(G.chunks.indexOf(q), 1); Inv.add('wood', n); G.stats.wood += n; Fx.floatText(p.x, p.y - 50, `+${n} :wood:`); Sound.pick(); take('log', c.o[0], -2); p.cd = 0.3; } break;
      case 'litter': G.litter.splice(G.litter.indexOf(c.o), 1); take('canE', c.o, -1); Sound.tone && Sound.tone('triangle', 1300, 900, 0.08, 0.03); break;
      case 'log': {
        if (Inv.weight() > Inv.capKg() + TUNE.hero.overChop) { if (!silent) Fx.toast(':pack: Перегруз — оставь часть в тайнике'); p.cd = 0.5; break; }
        const L = c.o, pose = Hero.chopPose(), tg = logPt(L, p); faceTo(tg);
        const a = { k: 'buck', t: 0, dur: Hero.chopTime() * 0.5 * (A.chopK[pose] || 1), o: L, pose, fb: 'chop', tg: { x: tg.x, y: tg.y }, th: -3 };
        a.per = Hero.chopCycle(a).cl; p.action = a;
      } break;
      case 'trap': {
        const t = c.o; p.cd = 0.4; faceTo(t); if (t.catch === 'hare') take('hare', t, -2); else Hero.play('pickUp', { react: 1, tg: t });
        if (t.catch) {
          if (t.catch === 'hare') { Inv.add('meat'); Inv.add('hare'); Fx.floatText(t.x, t.y - 20, '+:meat: +:hare:'); } else { Inv.add(t.catch); Fx.floatText(t.x, t.y - 20, '+' + ITEMS[t.catch].i); }
          Hero.xp('hunt'); t.catch = null; t.t = G.time; Sound.pick();
        } else { G.traps.splice(G.traps.indexOf(t), 1); Inv.add(t.kind); }
        break;
      }
      case 'stack': {
        const s = c.o;
        if (s.wood < 4) { if (!Inv.take('wood', 1, false)) { Fx.toast(':close: Не хватает: :wood:1'); p.cd = 0.3; } else { s.wood++; p.cd = 0.25; Sound.chop(); feed(s, 0, 1); } }
        else if (Inv.has('kero', false)) { Inv.take('kero', 1, false); Fire.lightStack(s, A.stackKeroT); }
        else { faceTo(s); p.action = { k: 'light', t: 0, dur: 1.5, o: s, tg: s }; }
        break;
      }
      // обломки: отжимает листы руками (поза pry, без топора) лицом к корпусу; нет позы — запасная рубка
      case 'wreck': { const pose = Hero.chopPose(), tg = wreckPt(c.o); faceTo(tg); p.action = { k: 'wreck', t: 0, dur: A.wreckT * (A.chopK[pose] || 1), o: c.o, pose: 'pry', fb: pose, loop: 1, tg, th: -30 }; } break;
      case 'tube': take('tube', TUBE_POS, -2); G.flags.tube = 1; Inv.add('tube'); Fx.toast(':tube: Радиолампа Гоши'); Sound.ok2(); break;
      case 'tree':
        if (Inv.weight() > Inv.capKg() + TUNE.hero.overChop) { if (!silent) Fx.toast(':pack: Перегруз — оставь часть в тайнике'); p.cd = 0.5; break; }
        // валка: удары без дров (полдлины прежней рубки на каждый); дрова — от разделки лежачего ствола
        { const pose = Hero.chopPose(); p.action = { k: 'chop', t: 0, dur: Hero.chopTime() * 0.5 * (c.o.kind === 3 ? TUNE.zone.garChop : 1) * (A.chopK[pose] || 1), o: c.o, pose, tg: c.o, th: -10 }; faceTo(c.o); }
        break;
      case 'fish': p.action = { k: 'fish', ph: 'wait', t: 0, dur: rnd(1.5, 4) - 0.2 * (Hero.lvl('fish') - 1), o: c.o }; break;
      case 'dig': p.action = { k: 'dig', t: 0, dur: A.digT }; break;
    }
  }

  // ---------- конец долгого действия ----------
  function finish(a) {
    const p = G.p;
    if (a.k === 'chop') {
      const t = a.o; if (t.wood <= 0) return;
      t.wood--; Hero.xp('chop'); G.s.food = Math.max(0, G.s.food - A.chopFood);
      // отклик (дрожь, щепа, снег с веток, треск, вороны) — правила Interact
      Interact.emit('hit', { who: 'p', target: t, x: t.x, y: t.y, power: 1 });
      if (t.wood <= 0) {
        World.felled(t); const L = fell(t);
        Interact.emit('fell', { who: 'p', target: t, x: t.x, y: t.y, dir: L.a, log: L });
      }
    } else if (a.k === 'buck') {
      // рез по лежачему стволу: первый снимает крону (сучья остаются на снегу), каждый — чурка у места реза
      const L = a.o; if (!G.logs || !G.logs.includes(L) || L.n <= 0) return;
      const at = logPt(L, a.tg || p), first = L.n === L.n0;
      L.n--; if (first) L.lim = 1;
      let n = 1; if (Hero.lvl('chop') >= 5 && Math.random() < 0.25) n = 2;
      G.chunks = G.chunks || [];
      const nx = -Math.sin(L.a) * 0.6, ny = Math.cos(L.a), nl = Math.hypot(nx, ny) || 1;
      for (let i = 0; i < n; i++) { const sd = (G.chunks.length % 2 ? 1 : -1) * (9 + 4 * i); G.chunks.push({ x: Math.round(at.x + nx / nl * sd + rnd(-3, 3)), y: Math.round(at.y + ny / nl * sd * 0.6 + rnd(-2, 2) + 3), a: +rnd(-0.6, 0.6).toFixed(2), t: G.time }); }
      if (G.chunks.length > 40) G.chunks.splice(0, G.chunks.length - 40);
      Hero.xp('chop'); G.s.food = Math.max(0, G.s.food - A.chopFood * 0.5);
      Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: at.x, y: at.y }); Sound.chop(); ArtWorld.fx.snowPuff(G.parts, at.x, at.y, 0.35);
      if (first) for (let i = 0; i < 3; i++) { const q = logEnd(L, 0.55 + i * 0.15); ArtWorld.fx.snowPuff(G.parts, q.x, q.y - 4, 0.4); }
      Fx.floatText(at.x, at.y - 20, first ? ':tree: сучья' : `чурка ×${n}`);
      if (L.n <= 0) G.logs.splice(G.logs.indexOf(L), 1);
    } else if (a.k === 'fish') {
      if (a.ph === 'wait') {
        // клюёт! полоса с зелёной зоной — жми E вовремя
        const w = clamp(0.14 + 0.03 * (Hero.lvl('fish') - 1) + (G.gear.lure ? 0.06 : 0) + (G.col && G.col.techs.nets ? 0.04 : 0), 0.1, 0.4);
        G.p.action = { k: 'fish', ph: 'bite', t: 0, dur: 2.6, o: a.o, z: rnd(0.1, 0.9 - w), w, sp: rnd(1.3, 2.2) }; Sound.tone('sine', 1200, 1500, 0.08, 0.2);
      } else Fx.floatText(a.o.x, a.o.y - 30, 'ушла');
    } else if (a.k === 'dig') {
      G.holes.push({ x: p.x + p.face * 24, y: p.y + 4, fish: A.holeFish }); ArtWorld.fx.splash(G.parts, p.x + p.face * 24, p.y + 4); Sound.hit();
      Interact.emit('work', { who: 'p', what: 'dig', x: p.x + p.face * 24, y: p.y + 4 });
    } else if (a.k === 'wreck') {
      const pool = G.wreck[a.o], id = pool.shift(); if (!id) return;
      if (id === 'saw') { G.gear.saw = 1; Fx.toast(':saw: Пила! Рубка быстрее'); }
      else {
        Inv.add(id); if (id === 'scrap') G.stats.scrap++;
        if (id === 'quartz') { G.flags.quartz = 1; Fx.toast(':quartz: Кварц для рации'); }
        if (id === 'battery') Fx.toast(':battery: Аккумулятор. Тяжёлый. Зарядить у печки');
        if (id === 'cable') Fx.toast(':cable: Кабель — на антенну');
      }
      const at = toward(a.tg || POI[a.o], 20);
      Fx.floatText(p.x, p.y - 50, '+' + (id === 'saw' ? ':saw:' : ITEMS[id].i)); Sound.pick(); Hero.play(Hero.pickPose(id), { react: 1, tg: at });
      Interact.emit('work', { who: 'p', what: 'wreck', x: at.x, y: at.y });
    } else if (a.k === 'loot') {
      // обыск построек зон: как обломки, пул предметов; буровая — может обвалиться
      const o = Zones.obj(a.o), pool = G.loot[a.o], id = pool && pool.shift(); if (!id) return;
      if (pool.length === o.loot.length - 1 && o.t) Fx.toast(ZONES[o.zone].ic + ' ' + o.t);
      Inv.add(id); if (id === 'scrap') G.stats.scrap++;
      Fx.floatText(p.x, p.y - 50, '+' + ITEMS[id].i); Sound.hit(); Sound.pick(); Hero.play(Hero.pickPose(id), { react: 1, tg: toward(o, 20) });
      if (o.zone === 'drill' && Math.random() < TUNE.zone.collapseP) { G.s.hp -= TUNE.zone.collapseDmg; G.hurt = 0.8; Fx.shake(5); Fx.toast(ZONE_TXT.collapse); }
    } else if (a.k === 'survey') {
      const o = Zones.surveyPoint(a.o); if (!o) return;
      Zones.survey(o.x, o.y); Fx.toast(ZONE_TXT.survey); Sound.ok2();
      if (o.t && !G.flags['sv_' + o.id]) { G.flags['sv_' + o.id] = 1; setTimeout(() => Fx.toast(ZONES[o.zone].ic + ' ' + o.t), 1600); }
    } else if (END[a.k]) END[a.k](a);
    else if (GEST[a.k]) GEST[a.k](a);
    else if (a.k === 'vfix') Transport.fixDone();
    else if (a.k === 'light') Fire.lightStack(a.o, A.stackLightT);
    else if (a.k === 'place') {
      Inv.take(a.o, 1, false); G.traps.push({ x: p.x + p.face * 20, y: p.y + 6, kind: a.o, catch: null, t: G.time });
      Fx.toast(a.o === 'trap' ? (World.inCedar(p.x, p.y) ? ':trap: Капкан в кедраче' : ':trap: Капкан (соболь — только в кедраче)') : ':snare: Силок стоит');
    }
  }
  // шаг таймеров героя и долгого действия
  // действие пропало не своим концом (шаг, удар волка, другое действие) — откат: крафт возвращает материалы, еда оставляет банку
  // новая игра / загрузка: старое действие не откатываем, плашку и автопуть — сбросить
  function syncG() { if (LASTG !== G) { LAST = null; LASTG = G; PLATE = null; AUTO = null; } }
  function watch() {
    const p = G.p;
    syncG();
    if (LAST && p.action !== LAST && !LAST.done && CANCEL[LAST.k]) CANCEL[LAST.k](LAST);
    LAST = p.action;
  }
  function tick(dt) {
    const p = G.p;
    watch();
    if (PLATE) {
      PLATE.age += dt;
      if (PLATE.life && PLATE.age > PLATE.life) PLATE = null;
      else if (PLATE.a && p.action !== PLATE.a) PLATE = null;
      else if (PLATE.note && !(p.action && (p.action.k === 'noteRead' || p.action.k === 'notePick') && p.action.o === PLATE.note)) PLATE = null;
      else if (p.moving && PLATE.age > 0.2) PLATE = null;
    }
    p.cd = Math.max(0, p.cd - dt); p.swing = Math.max(0, p.swing - dt); p.iT = Math.max(0, (p.iT || 0) - dt);
    G.sniffCd = Math.max(0, (G.sniffCd || 0) - dt); if (G.sniff) { G.sniff.t += dt; if (G.sniff.t > 5) G.sniff = null; }
    p.torch = Math.max(0, p.torch - dt); p.teaT = Math.max(0, p.teaT - dt); p.wetT = Math.max(0, p.wetT - dt);
    if (p.action) {
      const a = p.action, t0 = a.t; a.t += dt;
      contacts(a, t0);
      if (p.action === a && a.t >= a.dur) { a.done = true; p.action = null; finish(a); }
    }
    if (p.action) during(p.action, dt);
    if (p.action && p.action.k === 'fish' && p.action.ph === 'bite' && p.action.t >= p.action.dur) { Fx.floatText(p.action.o.x, p.action.o.y - 30, 'ушла'); p.action = null; }
    tickFly(dt);
    // долгое E: второе действие цели (жест, начатый нажатием, отменяется); рубку удержание по-прежнему повторяет
    if (input.act) {
      HOLD.t += dt;
      if (!HOLD.done && HOLD.c && HOLD.c.alt && !HOLD.c.rep && HOLD.t >= A.holdT) { HOLD.done = true; if (p.action && p.action === HOLD.a) p.action = null; p.cd = 0; alt(HOLD.c); }
    } else { HOLD.c = null; HOLD.done = false; }
    if (input.act && !p.action && p.cd <= 0 && !HOLD.done) interact(true);
    Hero.tickLife(dt);
  }

  // ---------- жесты: второе действие (X / долгое E), броски, отклики в момент касания ----------
  const HOLD = { t: 0, c: null, a: null, done: false };
  function throwTarget() {
    const R = A.throwR, p = G.p; if (p.inside) return null; // из избы не бросить
    const w = nearest(G.wolves, R, w => w.st !== 'retreat'); if (w) return { o: w, kind: 'wolf' };
    const h = nearest(Space.hares, R, liveHare); if (h) return { o: h, kind: 'hare' };
    let rv = null, d = R * R; for (const r of G.ravens || []) if (!r.fly) { const q = dist2(r, p); if (q < d) { d = q; rv = r; } }
    return rv ? { o: rv, kind: 'raven' } : null;
  }
  // подпись второго действия для подсказки: [текст, значок] | null
  const ALT_I = { tree: 'tree', fire: 'frost', dog: 'dog' };
  function altLabel(c) {
    if (c && c.alt) return [c.alt, ALT_I[c.k] || 'idle'];
    if (c && c.k === 'throw') return null;
    const t = throwTarget(); if (t) return ['Бросить палку', t.kind];
    const d = petDog(); if (d && d.task.k === 'stay') return ['Позвать', 'dog'];
    return null;
  }
  function alt(c) {
    if (state !== 'play' || UI.modal()) return;
    const p = G.p; if (p.sleeping || p.ride || p.cd > 0 || p.ko || AUTO || (typeof Ice !== 'undefined' && Ice.active())) return;
    if (p.action && p.action.cx) { p.action = null; watch(); }
    if (p.action) return;
    c = c || context();
    if (c && c.alt) switch (c.k) {
      case 'tree': faceTo(c.o); p.action = { k: 'shake', t: 0, dur: D().shakeTree || A.shakeT, pose: 'shakeTree', tg: c.o, th: -10, o: c.o, marks: [0.22, 0.5, 0.78] }; return;
      case 'fire': faceTo(c.o); { const per = D().scoop || 1; p.action = { k: 'bury', t: 0, dur: A.buryT, pose: 'scoop', per, tg: c.o, th: -4, o: c.o, marks: [0.6 * per / A.buryT, (per + 0.6 * per) / A.buryT], fb: 'dig' }; } return;
      case 'dog': callDog(c.o); return;
    }
    const t = throwTarget(); if (t) return throwAt(t.o, t.kind);
    const d = petDog(); if (d && d.task.k === 'stay') return callDog(d);
  }
  function throwAt(o, kind) {
    const p = G.p; faceTo(o);
    p.action = { k: 'throw', t: 0, dur: D().throw || 0.7, pose: 'throw', tg: o, o, kind, marks: [0.55], fb: 'swing' };
  }
  function callDog(u) { faceTo(u); G.p.action = { k: 'call', t: 0, dur: D().call || 1, pose: 'call', o: u, marks: [0.3], fb: 'wave' }; }
  // полёт палки: точка на земле у цели; частица-«палка» летит по дуге, отклик — по прилёту
  const FLY = [], GR = 320;
  function launch(a) {
    const p = G.p, o = a.o, x0 = p.x + p.face * 10, y0 = p.y - 44, x1 = o.x, y1 = o.y - (o.z || 0) - 8;
    const T = clamp(Math.hypot(x1 - x0, y1 - y0) / A.throwV, 0.25, 0.9);
    G.parts.push({ type: 'dot', x: x0, y: y0, vx: (x1 - x0) / T, vy: (y1 - y0) / T - 0.5 * GR * T, g: GR, life: T, max: T, color: '#5a3d22' });
    FLY.push({ t: T, o, kind: a.kind, x: x1, y: o.y }); p.cd = A.throwCd; Sound.whoosh && Sound.whoosh();
  }
  function tickFly(dt) {
    for (let i = FLY.length - 1; i >= 0; i--) { const f = FLY[i]; if ((f.t -= dt) > 0) continue; FLY.splice(i, 1); land(f); }
  }
  function land(f) {
    const o = f.o, near = dist2(o, f) < 44 * 44, p = G.p;
    if (f.kind === 'wolf' && near && G.wolves.includes(o) && Math.random() < A.throwHit) {
      o.st = 'flee'; o.t = 0.8; Sound.hit(); Fx.floatText(o.x, o.y - 40, 'Пошёл!'); Fx.burst(o.x, o.y - 14, 5, '#dde6ee');
    } else if (f.kind === 'hare' && near && liveHare(o)) {
      if (Math.random() < A.throwHare + 0.05 * (Hero.lvl('hunt') - 1)) {
        G.hares.splice(G.hares.indexOf(o), 1); Inv.add('meat'); Inv.add('hare'); G.stats.hares++; Hero.xp('hunt');
        Fx.floatText(o.x, o.y - 20, '+:meat: +:hare:'); Fx.burst(o.x, o.y - 6, 10, '#ffffff'); Sound.pick();
      } else { const a = Math.atan2(o.y - p.y, o.x - p.x); o.vx = Math.cos(a) * 170; o.vy = Math.sin(a) * 170; o.t = 0.7; }
    }
    Interact.emit('throw', { who: 'p', obj: 'snow', target: o, x: f.x, y: f.y });
    // лайка бежит за палкой (кроме «сидеть») и сама возвращается к герою
    const d = petDog();
    if (d && d.task.k !== 'stay' && dist2(d, p) < A.dogR * A.dogR) { d.task = { k: 'move', x: f.x, y: f.y }; d.wag = now + 3; }
  }
  // касание в нужный момент позы: удары рубки, толчки дерева, пинок, горсти снега, бросок, свист
  function contacts(a, t0) {
    const p = G.p;
    if ((a.k === 'chop' && !G.gear.saw) || a.k === 'wreck' || a.k === 'buck') {
      const c = Hero.chopCycle(a), i0 = Math.floor(t0 / c.cl - c.ia), i1 = Math.floor(a.t / c.cl - c.ia);
      if (i1 > i0 && i1 >= 0 && a.t < a.dur - 1e-3) {
        if (a.k === 'chop') Interact.emit('hit', { who: 'p', target: a.o, x: a.o.x, y: a.o.y, power: 0.4, mid: 1 });
        else if (a.k === 'buck') Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: a.tg.x, y: a.tg.y });
        else { const at = toward(a.tg || POI[a.o], 20); Interact.emit('work', { who: 'p', what: 'wreck', obj: 'wreck', x: at.x, y: at.y }); }
      }
    }
    if (!a.marks) return;
    for (let i = 0; i < a.marks.length; i++) {
      const m = a.marks[i] * a.dur; if (!(t0 < m && a.t >= m)) continue;
      const o = a.o;
      if (a.k === 'shake') {
        Interact.emit('shake', { who: 'p', obj: 'tree', target: o, x: o.x, y: o.y, n: i });
        if (i === 2 && dist2(o, p) < 34 * 34) { ArtWorld.fx.snowPuff(G.parts, p.x, p.y - 44, 0.4); G.s.warm = Math.max(0, G.s.warm - A.shakeWarm); Fx.floatText(p.x, p.y - 60, ':frost: за шиворот'); }
      } else if (a.k === 'kick') Interact.emit('kick', { who: 'p', obj: 'snow', target: o, x: p.x + p.face * 16, y: p.y + 2, drift: 1 });
      else if (a.k === 'bury') Interact.emit('bury', { who: 'p', obj: 'fire', target: o, x: o.x, y: o.y });
      else if (a.k === 'throw') launch(a);
      else if (a.k === 'call') Sound.whistle && Sound.whistle();
    }
  }
  // пока длится: тепло у огня, отдых на пне; огонь погас — греться нечем
  function during(a, dt) {
    const p = G.p;
    if (a.k === 'digout') { Depth.dig(p.x, p.y, dt); return; }
    if (a.k === 'warm') {
      if (!(a.o.fuel > 0)) { p.action = null; return; }
      if (Fire.heatAt(p, 0) > 0) G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + A.warmHeat * dt);
      if ((a.fl -= dt) <= 0) { a.fl = 0.5; Interact.emit('warm', { who: 'p', obj: 'fire', target: a.o, x: a.o.x, y: a.o.y }); }
    } else if (a.k === 'eat') {
      // горячее — пар от банки/миски/куска у груди
      if (a.hot && (a.st = (a.st || 0) - dt) <= 0) { a.st = 0.12; G.parts.push({ type: 'breath', x: p.x + p.face * rnd(5, 9), y: p.y - rnd(26, 30), vx: rnd(-4, 4) + p.face * 2, vy: rnd(-18, -10), life: 1.2, max: 1.2 }); }
    } else if (a.k === 'rest') {
      G.s.food = Math.min(100, G.s.food + TUNE.body.hunger * A.restFood * Settings.diff().hunger * dt);
      if (G.s.warm > TUNE.body.regenWarm * 0.5) G.s.hp = Math.min(100, G.s.hp + A.restRegen * dt);
    }
  }
  // конец действий в мире (цепочки: взял лист → читает; лёг → спит)
  const END = {
    notePick(a) { const n = NOTES[a.o]; G.p.action = { k: 'noteRead', t: 0, dur: 1e6, pose: 'readNote', loop: 1, o: a.o, fb: 'idle' }; plate(n.t, n.i, 'p', { note: a.o }); },
    notePut() {},
    take() {},
    inspect(a) { if (PLATE && PLATE.a === a) PLATE = null; },
    eat(a) { if (a.o === 'can') litter('can'); },
    craft(a) { craftDone(a.r); },
    lie() { const p = G.p; p.sleeping = true; p.x = SPOT.bed.x; p.y = SPOT.bed.y + 4; Hero.snap(); },
    getUp() {},
  };
  const CANCEL = {
    eat(a) { if (a.o === 'can') litter('can'); },
    craft(a) { for (const [k, v] of Object.entries(a.r.in)) Inv.add(k, v); Fx.toast(':close: ' + a.r.n + ' — брошено, материалы целы'); },
    noteRead() { if (PLATE && PLATE.note) PLATE = null; },
    inspect(a) { if (PLATE && PLATE.a === a) PLATE = null; },
  };
  const HOURS = ['Свежий — только прошёл.', 'Недавний.', 'Старый, заметает.'];
  const WHO = { w: 'Волк', h: 'Заяц', b: 'Шатун' }, SIDE = ['на восток', 'на юг', 'на запад', 'на север'];
  // завершение жестов
  const GEST = {
    shake(a) {
      const t = a.o, p = G.p;
      if (World.inCedar(t.x, t.y) && t.nutsDay !== G.day) {
        t.nutsDay = G.day;
        if (Math.random() < A.nutsP) { G.s.food = Math.min(100, G.s.food + A.nutsFood); Fx.floatText(t.x, t.y - 60 * t.s, `:food: орешки +${A.nutsFood}`); Sound.pick(); return; }
      }
      if (Math.random() < 0.3) Barks.say(p, 'Пусто. Только снег.', { h: 60 });
    },
    kick(a) {
      const d = a.o, p = G.p; KICKED.add(d);
      if (Math.random() >= A.kickP) return;
      let r = Math.random(), id = KICK_FIND[0][0]; for (const [k, w] of KICK_FIND) if ((r -= w) <= 0) { id = k; break; }
      Inv.add(id); if (id === 'scrap') G.stats.scrap++;
      const x = p.x + p.face * 18; Fx.floatText(x, p.y - 30, '+' + ITEMS[id].i); Fx.burst(x, p.y - 4, 8, '#dde6ee', 110); Sound.pick();
      Hero.play(Hero.pickPose(id), { react: 1, tg: { x, y: p.y } });
      Barks.say(p, id === 'can' ? 'Тушёнка! Кто-то оставил.' : id === 'scrap' ? 'Железка. Пригодится.' : 'Сушняк под снегом.', { h: 60 });
    },
    bury(a) {
      const f = a.o, n = Math.min(A.buryMax, Math.floor(f.fuel / TUNE.fire.fuelAdd));
      f.fuel = 0; if (n) Inv.add('wood', n);
      Fx.floatText(f.x, f.y - 40, n ? `:fire: погашен · +${n} :wood:` : ':fire: погашен'); Sound.tone('sine', 700, 200, 0.4, 0.04);
    },
    read(a) {
      const f = a.o, p = G.p, age = f.life / TUNE.engine.printLife;
      for (const q of G.prints) if (dist2(q, f) < 60 * 60 && q.k === f.k) READ.add(q);
      const s = Math.round(((f.a % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 2)) % 4;
      Barks.say(p, `${WHO[f.k] || 'Зверь'}. ${HOURS[age > 0.75 ? 0 : age > 0.4 ? 1 : 2]} Ушёл ${SIDE[s]}.`, { h: 60, life: 4 });
      if (now - readXpT > A.readXp) { readXpT = now; Hero.xp('hunt'); }
      // свежий след ведёт к зверю: чутьё показывает его, если он недалеко
      const src = f.k === 'h' ? G.hares : f.k === 'w' ? G.wolves : f.k === 'b' && G.bear ? [G.bear] : [];
      let best = null, bd = A.throwR * A.throwR * 9; for (const o of src) { const q = dist2(o, p); if (q < bd) { bd = q; best = o; } }
      if (best && age > 0.4) G.sniff = { t: 0, hits: [{ x: best.x, y: best.y, ic: f.k === 'h' ? ':hare:' : f.k === 'w' ? ':wolf:' : ':bear:', d: Math.sqrt(bd) }] };
    },
    pet(a) {
      const u = a.o; u.wag = now + 2.5;
      if ((PETCD.get(u) || -1e9) < now) { PETCD.set(u, now + A.petCd); u.hp = Math.min(UNITS[u.type].hp + Colony.mod('hp'), u.hp + A.petHp); }
      if (u.pet && G.col) G.col.barkT = 0; // сразу принюхается к волкам
      Barks.say(G.p, u.pet ? 'Хорошая, Пурга. Хорошая.' : 'Хороший пёс.', { h: 60 });
    },
    call(a) {
      const u = a.o, p = G.p, stay = u.task.k !== 'stay' && dist2(u, p) < 200 * 200;
      if (stay) { u.task = { k: 'stay' }; Barks.say(p, 'Сидеть. Сторожи.', { h: 60 }); }
      else { u.task = { k: 'guard' }; u.wag = now + 2; Barks.say(p, 'Пурга! Ко мне!', { h: 60 }); }
    },
  };

  function fishStrike() {
    const a = G.p.action; if (!a || a.k !== 'fish' || a.ph !== 'bite') return false;
    const pos = (Math.sin(a.t * a.sp * Math.PI) + 1) / 2, h = a.o; G.p.action = null; G.p.cd = 0.5; Hero.xp('fish'); G.s.food = Math.max(0, G.s.food - A.fishFood);
    if (pos >= a.z - 0.02 && pos <= a.z + a.w + 0.02) {
      let r = Math.random(), f = FISHES[0]; for (const q of FISHES) { if ((r -= q.p) <= 0) { f = q; break; } }
      const kg = rnd(f.w[0], f.w[1]), n = f.big ? 3 : kg > 2 ? 2 : 1;
      Inv.add('fish', n); G.stats.fish++; G.stats.bestKg = Math.max(G.stats.bestKg || 0, kg); ArtWorld.fx.splash(G.parts, h.x, h.y);
      Fx.floatText(h.x, h.y - 30, `:fish: ${f.n} · ${kg.toFixed(2).replace('.', ',')} кг`); Fx.burst(h.x, h.y, 10, '#b9e2ff'); Sound.splash(); Interact.emit('work', { who: 'p', what: 'fish', x: h.x, y: h.y });
      if (f.big) Fx.toast(`:fish: Таймень! ${kg.toFixed(1).replace('.', ',')} кг`);
      if (--h.fish <= 0) { G.holes.splice(G.holes.indexOf(h), 1); Fx.toast(':fish: Лунка пуста'); }
    } else { Fx.floatText(h.x, h.y - 30, 'Сорвалась'); Sound.tone('triangle', 400, 200, 0.2, 0.15); }
    return true;
  }
  function sniff() {
    if (state !== 'play' || UI.modal() || (G.sniffCd || 0) > 0) return;
    G.sniffCd = A.sniffCd; G.sniff = { t: 0, hits: [] };
    const add2 = (o, ic) => { const d = dist(o, G.p); if (d < A.sniffR) G.sniff.hits.push({ x: o.x, y: o.y, ic, d }); };
    for (const h of G.hares) add2(h, ':hare:');
    for (const a of G.amuletsAt) if (!a.got) add2(a, ':sevek:');
    for (const id in NOTES) if (!G.notes[id]) add2(NOTES[id], ':log:');
    for (const t of G.traps) if (t.catch) add2(t, ':trap:');
    for (const w of G.wolves) add2(w, ':wolf:'); if (G.bear) add2(G.bear, ':bear:');
    if (!G.flags.tube) add2(TUBE_POS, ':tube:');
    for (const k of ['cockpit', 'tail']) if (G.wreck[k].length) add2(POI[k], ':scrap:');
    Sound.tone('sine', 300, 900, 0.5, 0.12);
  }

  // ---------- F: огонь ----------
  function fireKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.ko) return;
    const p = G.p, F = TUNE.fire;
    if (p.inside) { const f0 = G.hut.fuel; Stove.add(); return feed(SPOT.stove, f0, G.hut.fuel); }
    const f = nearest(G.fires, 70);
    if (f) {
      if (f.fuel > 0) {
        if (!Inv.take('wood', 1, false)) return Fx.toast(':close: Не хватает: :wood:1');
        f.fuel = Math.min(f.fuel + F.fuelAdd, F.fuelMax); feed(f, 0, 1); Fx.floatText(f.x, f.y - 40, ':fire: +' + gameDur(F.fuelAdd)); Fx.burst(f.x, f.y - 10, 10, '#ffb347', 120);
      } else {
        if (Inv.cnt('wood', false) < F.relightCost) return Fx.toast(':close: Разжечь: :wood:2');
        Inv.take('wood', F.relightCost, false); f.fuel = F.relightFuel; Fx.toast(':fire: Огонь горит');
      }
      return;
    }
    const s = nearest(G.stacks, 56);
    if (s && s.wood < 4 && !s.lit) { if (Inv.take('wood', 1, false)) { s.wood++; Sound.chop(); feed(s, 0, 1); } else Fx.toast(':close: Не хватает: :wood:1'); return; }
    if (Inv.cnt('wood', false) < F.buildCost) return Fx.toast(':close: Костёр: :wood:3');
    const x = clamp(p.x + p.face * 30, 60, W - 60), y = p.y + 8;
    if (onIce(x, y)) return Fx.toast(':close: На льду не разжечь');
    if (Math.abs(x - HUT.x) < 130 && Math.abs(y - HUT.y) < 110) return Fx.toast(':close: Слишком близко к избе');
    Inv.take('wood', F.buildCost, false); G.fires.push({ x, y, fuel: F.buildFuel }); Fx.toast(':fire: Костёр'); Sound.ok2();
  }

  // еда: сытость — сразу (как раньше), тело — поза еды 1–2 с (банка с ложкой, миска, кусок), пар от горячего; банка остаётся на снегу
  function eat() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.ko) return;
    const p = G.p;
    if (G.s.food >= A.fullAt) return Fx.toast(':food: Не голоден');
    const wc = p.inside, k = FOOD_ORDER.find(f => Inv.cnt(f, wc) > 0);
    if (!k) return Fx.toast(':close: Нет еды · :hare: :fish:');
    Inv.take(k, 1, wc);
    const it = ITEMS[k], fire = !!Fire.near(TUNE.fire.heatR) || (p.inside && G.hut.fuel > 0), cooked = !it.raw || fire;
    const v = Math.round(it.food * (cooked ? 1 : A.rawFood));
    G.s.food = Math.min(100, G.s.food + v);
    if (it.warm) G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + it.warm);
    if ((it.raw && fire) || it.warm) G.s.tire = Math.max(0, (G.s.tire || 0) - TUNE.tire.food); // горячее — силы
    Fx.floatText(p.x, p.y - 44, (cooked ? it.i + ' +' : ':frost: сырое +') + v);
    if (p.action && p.action.cx) p.action = null;
    if (p.action || p.ride) { if (k === 'can') litter('can'); return; } // занят работой — съел на ходу, без позы
    p.action = { k: 'eat', t: 0, dur: (D().eat || 1.8) * (k === 'stew' ? 1.15 : 1), pose: 'eat', item: EAT_ITEM[k] || 'meat', o: k, hot: (it.raw && fire) || !!it.warm, cx: 1, fb: 'idle' };
  }

  function placeKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.action || G.p.ko) return;
    const p = G.p;
    if (p.inside || onIce(p.x, p.y)) return Fx.toast(':close: Здесь не поставить');
    let k = null;
    if (World.inCedar(p.x, p.y) && Inv.has('trap', false)) k = 'trap';
    else if (Inv.has('snare', false)) k = 'snare';
    else if (Inv.has('trap', false)) k = 'trap';
    if (!k) return Fx.toast(':close: Нет :snare: / :trap: · верстак');
    p.action = { k: 'place', t: 0, dur: 2, o: k };
  }

  // ---------- T: тайник в поле («Оставить здесь») — рядом открывает свой, иначе создаёт новый ----------
  function stashKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.action) return null;
    const p = G.p;
    if (p.inside || onIce(p.x, p.y)) { Fx.toast(':close: Здесь не оставить'); return null; }
    const near = World.nearestStash(p, 70);
    if (near) { UI.openStash(near); return near; }
    if (!Inv.weight()) { Fx.toast(':close: Нечего оставить'); return null; }
    G.stashes = G.stashes || [];
    if (G.stashes.length >= TUNE.world.stashMax) { Fx.toast(':close: Тайников уже ' + TUNE.world.stashMax + ' — забери что-нибудь'); return null; }
    const s = { id: (G.stashN = (G.stashN || 0) + 1), x: Math.round(p.x + p.face * 22), y: Math.round(p.y + 10), inv: {} };
    G.stashes.push(s);
    Fx.toast(':cache: Тайник — клади добро'); Sound.hit();
    UI.openStash(s);
    return s;
  }

  // ---------- мастерская и изба ----------
  function stationOk(at) {
    const p = G.p;
    if (at === 'fire') return !!Fire.near(TUNE.fire.heatR) || (p.inside && G.hut.fuel > 0);
    if (at === 'stove') return p.inside && G.hut.fuel > 0;
    if (at === 'bench') return p.inside && !!G.hut.bench;
    return true;
  }
  function recipeState(r) {
    if (r.gear && G.gear[r.gear]) return 'owned';
    if (r.radio && G.flags.radioBuilt) return 'owned';
    if (!stationOk(r.at)) return 'station';
    if (!Inv.canPay(r.in, G.p.inside)) return 'cost';
    if (r.radio && G.charge < 100) return 'charge';
    return 'ok';
  }
  // где работать: верстак / печь / костёр (в избе у горящей печи — печь)
  function stationPt(r) {
    const p = G.p;
    if (r.at === 'bench') return SPOT.bench;
    if (r.at === 'stove' || (r.at === 'fire' && p.inside)) return SPOT.stove;
    if (r.at === 'fire') return Fire.near(TUNE.fire.heatR) || { x: p.x + p.face * 18, y: p.y + 4 };
    return { x: p.x + p.face * 18, y: p.y + 4 };
  }
  // крафт: окно — меню выбора; сама работа — в мире: материалы уходят сразу, вещь — по прогрессу над героем (шаг — отмена, материалы назад)
  function craft(r) {
    if (recipeState(r) !== 'ok') return false;
    const p = G.p; if (p.ko || p.sleeping || (p.action && p.action.k === 'craft')) return false;
    Inv.pay(r.in, p.inside);
    const at = stationPt(r); faceTo(at); if (p.action) p.action = null; watch();
    p.action = { k: 'craft', t: 0, dur: CRAFT_T[r.id] || 3, r, pose: 'craft', loop: 1, fb: 'build', tg: { x: at.x, y: at.y }, th: r.at === 'bench' ? -24 : -8, ic: r.i };
    return true;
  }
  function craftDone(r) {
    if (r.out) for (const [k, v] of Object.entries(r.out)) Inv.add(k, v);
    if (r.gear) G.gear[r.gear] = 1;
    if (r.id === 'torch') { G.p.torch = TUNE.fire.torchT; Fx.toast(':fire: Факел · ' + gameDur(TUNE.fire.torchT)); }
    if (r.id === 'tea') { G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + A.teaWarm); G.p.teaT = A.teaT; G.s.tire = Math.max(0, (G.s.tire || 0) - TUNE.tire.tea); Fx.toast(':tea: Тепло разливается'); }
    if (r.radio) { G.flags.radioBuilt = 1; Fx.toast(':radio: Рация собрана!'); }
    else if (r.gear) Fx.toast(`${r.i} ${r.n}`);
    Sound.ok2();
    return true;
  }
  function hutUpgState(u) {
    if (G.hut[u.id]) return 'owned';
    if (u.id === 'damper' && !G.hut.walls) return 'need';
    if (!World.nearHut()) return 'station';
    if (!Inv.canPay(u.in, true)) return 'cost';
    return 'ok';
  }
  function buildHut(u) {
    if (hutUpgState(u) !== 'ok') return false;
    Inv.pay(u.in, true); G.hut[u.id] = 1; if (u.id === 'door') G.hut.doorHp = 100;
    Fx.toast(`${u.i} ${u.n} :ok:`); Sound.ok2(); return true;
  }

  // записка прочитана: в журнал (G.notes → пауза «Записки»), сюжетные последствия. Показ — плашкой в мире (startNote)
  function readNote(id) { G.notes[id] = 1; if (id === 'pilot') { G.known.tail = 1; G.known.polynya = 1; } }

  // ---------- сон ----------
  const nightNow = (h = hourOf()) => h >= TUNE.time.sleepFrom || h < TUNE.time.sleepTo;
  // почему не уснуть на лежанке (null — можно)
  function sleepWhy() {
    if (!nightNow()) return ':sleep: Спать — после 19:00';
    if (G.hut.fuel <= 0) return ':close: Сначала растопи печь';
    if (G.wolves.some(w => insideHut(w.x, w.y))) return ':wolf: Волк в избе — не до сна!';
    if (!G.hut.door && G.wolves.some(w => w.st !== 'retreat' && dist2(w, HUT) < TUNE.r.hutWolves * TUNE.r.hutWolves)) return ':wolf: Волки у избы — без двери не уснуть';
    if (G.bear && G.bear.st !== 'flee' && dist2(G.bear, HUT) < A.bearSleepR * A.bearSleepR) return ':bear: Шатун рядом — не уснуть';
    return null;
  }
  function trySleep() {
    const why = sleepWhy(); if (why) return Fx.toast(why);
    // к лежанке своими ногами (путь), лечь (поза), затемнение и ускорение времени — пока спит
    const p = G.p; if (p.action) p.action = null;
    autoTo(SPOT.bed.x, SPOT.bed.y + 4, 3, () => { p.face = p.x > SPOT.bed.x ? -1 : 1; p.x = SPOT.bed.x; p.y = SPOT.bed.y + 4; Hero.snap(); p.action = { k: 'lie', t: 0, dur: D().lieDown || 1.4, pose: 'lieDown', fb: 'idle' }; });
  }
  function wake(good, msg) {
    const p = G.p; p.sleeping = false; SKIP = null;
    if (!p.ko) p.action = { k: 'getUp', t: 0, dur: D().getUp || 1.4, pose: 'getUp', fb: 'idle', cx: 1 };
    if (good) {
      G.flags.slept = 1; if (G.s.frost > 0) G.s.frost--;
      Fx.toast(':day: Утро · сохранено'); SaveGame.checkpoint();
    } else if (msg) Fx.toast(msg);
  }
  // сон: утро будит, погасшая печь и волк в избе — тоже
  function tickSleep(h, dt) {
    autoStep(dt || 0);
    if (G.p.ko) return koStep(dt || 0);
    if (skipping()) skipTick(h);
    if (!G.p.sleeping) return;
    if (h >= TUNE.time.wakeAt && h < 12) wake(true);
    else if (G.hut.fuel <= 0) wake(false, ':frost: Печь погасла');
    else if (G.wolves.some(w => insideHut(w.x, w.y))) wake(false, ':wolf: Волк в избе!');
  }

  // ---------- «До утра» (Z): промотка ночи ----------
  // Исход — не формулой: UI крутит тот же update() пачками (TUNE.time.skipDt), пока не утро или не разбудит.
  // В избе при горящей печи — сон на лежанке (trySleep: сонный голод, будят утро/печь/волк/шатун — как обычный сон),
  // иначе — «переждать» стоя, бодрствуя: мороз, костёр, голод честные; будят утро, зверь ближе skipThreatR, удар.
  let SKIP = null;
  const skipping = () => !!(SKIP && SKIP.g === G);
  const skipMode = () => G.p.sleeping || (G.p.inside && !sleepWhy()) ? 'sleep' : 'wait';
  // угроза рядом: волк (не уходящий) или шатун ближе skipThreatR — не мотать / разбудить
  function threatNear() {
    const p = G.p, R2 = TUNE.time.skipThreatR ** 2;
    if (G.wolves.some(w => w.st !== 'retreat' && dist2(w, p) < R2)) return ':wolf: Волки рядом';
    if (G.bear && G.bear.st !== 'flee' && dist2(G.bear, p) < R2) return ':bear: Шатун рядом';
    return null;
  }
  // почему нельзя мотать (null — можно)
  function skipWhy() {
    const p = G.p;
    if (!nightNow()) return ':sleep: До утра — после 19:00';
    if (p.ko || p.ride || p.doze || (typeof Ice !== 'undefined' && Ice.active())) return ':close: Не сейчас';
    if (p.sleeping) return null;
    return skipMode() === 'sleep' ? sleepWhy() : threatNear();
  }
  // окно прогноза (UI) — или отказ тостом; во время промотки Z — стоп
  function skipKey() {
    if (skipping()) return skipStop();
    const why = skipWhy(); if (why) return Fx.toast(why);
    const mode = skipMode(); UI.openSkip(mode, Survival.forecast(mode === 'sleep'));
  }
  function skipStart() {
    const why = skipWhy(); if (why) return Fx.toast(why);
    const p = G.p, mode = skipMode();
    SKIP = { g: G, mode };
    if (mode === 'sleep') { if (!p.sleeping) trySleep(); }   // к лежанке и лечь; мотать начнёт, когда уснёт
    else { p.action = null; AUTO = null; input.auto = 0; }
  }
  // стоп по Z: сон продолжается как обычно (×sleepX), «переждать» — просто встал
  function skipStop() { SKIP = null; Fx.toast(':timer: Стоп'); }
  // каждый шаг промотки (из tickSleep): утро, угрозы, ввод
  function skipTick(h) {
    const p = G.p, S = SKIP;
    if (p.ko) { SKIP = null; return; }
    if (S.mode === 'sleep') { if (!p.sleeping && !AUTO && !(p.action && p.action.k === 'lie')) SKIP = null; return; } // не дошёл / передумал
    if (Math.hypot(input.mx, input.my) > 0.15) { SKIP = null; return; }   // свой шаг игрока — стоп
    if (h >= TUNE.time.wakeAt && h < 12) { SKIP = null; Fx.toast(':day: Утро · сохранено'); SaveGame.checkpoint(); return; }
    const th = threatNear(); if (th) { SKIP = null; Fx.toast(th + '!'); return; }
    if (G.hurt > 0.5) { SKIP = null; Fx.toast(':hp: Удар!'); }
  }
  // идёт быстрая прокрутка (UI: пачка шагов за кадр): «переждать» — сразу, сон — когда уже лёг
  const skipFast = () => skipping() && (SKIP.mode === 'wait' || G.p.sleeping) && !G.p.ko;

  // ---------- автопуть: герой сам идёт к точке (лежанка) — тем же движением, что от ввода; ввод игрока — отмена ----------
  function autoTo(x, y, stop, then) { syncG(); AUTO = { x, y, stop, then, t: 0 }; input.auto = 1; }
  function autoStep(dt) {
    const p = G.p;
    if (p.ko) { input.mx = input.my = 0; input.auto = 1; return; }   // без сознания: ввод не двигает
    if (!AUTO) return;
    if (!input.auto || p.sleeping) { AUTO = null; return; }
    const A0 = AUTO, d = Math.hypot(A0.x - p.x, A0.y - p.y); A0.t += dt;
    if (d <= A0.stop || A0.t > 6) { AUTO = null; input.auto = 0; input.mx = input.my = 0; if (d <= A0.stop + 14) A0.then(); return; }
    const wp = d > 40 && typeof Nav !== 'undefined' ? Nav.way(p, A0.x, A0.y) : A0, dx = wp.x - p.x, dy = wp.y - p.y, l = Math.hypot(dx, dy) || 1, k = clamp((d - A0.stop) / 30 + 0.3, 0.3, 1);
    input.mx = dx / l * k; input.my = dy / l * k;
  }
  // ---------- «мягкая» смерть (глава I): упал / замерзает → затемнение → очнулся в избе (кто и как донёс — карточка) → встаёт ----------
  const KO_FALL = 2.6, KO_DARK = 24; // с; тёмная часть — во сне (время ×sleepX: ≈2 с реальных, 0,4 игр. ч)
  function knockout(cause, m) {
    const p = G.p; if (p.ko) return;
    AUTO = null; PLATE = null; p.action = null; p.ride = null; p.doze = 0; p.dozeWarn = 0; p.ko = { t: 0, ph: 0, cause: cause || 'cold' };
    G.pack = null; for (const w of G.wolves) { w.st = 'retreat'; w.t = 3; }
    Hero.snap();
  }
  function koStep(dt) {
    const p = G.p, k = p.ko; k.t += dt;
    if (!k.ph && k.t >= KO_FALL) {
      const m = CHAPTERS[G.chapter].softDeath || { hp: 50, warm: 70, food: 35, skip: 0, fuel: 60, woodKeep: 1, card: [':evenk:', '', ''] };
      p.x = SPOT.bed.x; p.y = SPOT.bed.y + 4; p.action = null; Hero.snap(); p.inside = true; p.sleeping = true; p.face = 1;
      G.s.hp = m.hp; G.s.warm = m.warm; G.s.food = Math.max(G.s.food, m.food); G.time += CYCLE * m.skip; G.hut.fuel = Math.max(G.hut.fuel, m.fuel);
      G.inv.wood = Math.floor((G.inv.wood || 0) * m.woodKeep); G.wolves = []; G.pack = null;
      UI.card(...m.card);
      k.ph = 1; k.t = 0;
    } else if (k.ph === 1 && k.t >= KO_DARK) { p.ko = null; input.auto = 0; wake(false, null); }
  }

  // ---------- рация: сеансы связи ----------
  function radioSession() {
    if (!G.flags.radioBuilt) return;
    const R = TUNE.radio;
    if (G.flags.contact) return UI.dialog({ who: 'radio', t: '…борт 24713, ждите в 09:00, дайте дым на мари… Приём.', opts: [{ t: 'Понял' }] });
    const h = hourOf(), lines = NPCS.radio.lines;
    if (stormOn()) return UI.dialog({ who: 'radio', t: '…ш-ш-ш… тр-р… (пурга глушит эфир — попробуй, когда стихнет)', opts: [{ t: 'Выключить' }] });
    const sess = R.sessions.some(([a, b]) => h >= a && h < b);
    // до конца осады эфир забит: борт не слышит (глава III закрывается осадой)
    if (sess && G.chapter < R.fromChapter) { UI.dialog({ who: 'radio', t: lines[(Math.random() * lines.length) | 0], opts: [{ t: 'Выключить' }] }); Fx.toast(':radio: Борт не слышит · сначала отбейся от стаи'); return; }
    if (sess) {
      G.flags.contact = 1; G.flags.contactDay = G.day + (h >= 19 ? 0 : -1); G.flags.contactT = G.time; G.known.mar = 1; UI.dialog(DIALOG.radio_ok); Sound.ok2();
      setTimeout(() => Fx.toast(padDone() ? ':pad: Площадка готова · борт через сутки в 09:00' : ':pad: Сядут только на расчищенную марь · :build: Площадка'), 1800);
    }
    else UI.dialog({ who: 'radio', t: Math.random() < 0.6 ? lines[(Math.random() * lines.length) | 0] : DIALOG.radio_noise.t, opts: [{ t: 'Выключить' }] });
  }

  return { nearest, liveHare, context, interact, alt, altLabel, finish, tick, fishStrike, sniff, fireKey, eat, placeKey, stashKey,
    stationOk, recipeState, craft, hutUpgState, buildHut, readNote, trySleep, wake, tickSleep, radioSession,
    nightNow, skipWhy, skipMode, skipKey, skipStart, skipStop, skipping, skipFast, get skipKind() { return skipping() ? SKIP.mode : null; },
    knockout, grabbing, noteInHand, plateNext, plateClose, logEnd, logK, get plate() { return PLATE; },
    busy: () => !!(AUTO || G.p.ko || (G.p.action && (G.p.action.k === 'lie' || G.p.action.k === 'craft' || G.p.action.k === 'notePick'))),
    reading: () => !!PLATE };
})();
