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
  // память жестов (не в G): пнутые сугробы, прочитанные следы, пауза «погладить» у собаки
  const KICKED = new WeakSet(), READ = new WeakSet(), PETCD = new WeakMap();
  let readXpT = -1e9;
  const KICK_FIND = [['wood', 0.6], ['scrap', 0.25], ['can', 0.15]];

  // ---------- действия в мире (docs/design/INTERACTION-PASSPORT.md, «действия в мире») ----------
  // Всё рантайм, не в G (кроме того, что остаётся лежать: G.logs — сваленные стволы, G.chunks — чурки, G.litter — пустые банки).
  // PLATE — плашка над героем/вещью: текст записки или подпись осмотра; страницы считает рисование (GFX), E — дальше/закрыть, шаг — закрыть.
  let PLATE = null, AUTO = null, LAST = null, LASTG = null;
  // cx — жест, который E/движение прерывают без потерь (эффект уже применён): взять в руки, поесть, осмотр, чтение
  const CRAFT_T = { shovel: 4, torch: 1.2, tea: 2.5, stew: 4, snare: 3, lure: 3, trap: 4.5, hat: 5, dokha: 7, sled: 8, antenna: 5, radio: 8 };
  const EAT_ITEM = { stew: 'bowl', can: 'can', dried: 'dried', meat: 'meat', fish: 'fish', honey: 'jar' };
  // вещь ещё лежит, пока рука до неё не дотянулась (для рисования: лампа, сэвэки, записка на земле)
  function grabbing(o) {
    const a = G.p.action; if (!a || a.o !== o) return false;
    if (a.k === 'job' && a.j === 'carry' && a.s === 'pick') return !a.got;
    return false;
  }
  // дрова на сжигание: руки → (wc: поленница) → рюкзак; {kg, l} | null — масса уходит в огонь как есть
  function useWood(wc) {
    const h = Carry.takeWood(); if (h) return h;
    for (const c of wc ? [G.chest, G.inv] : [G.inv]) { const r = Inv.pull(c, 'wood', 1); if (r.n) return r; }
    return null;
  }
  const woodHave = wc => Carry.woodN() + (G.inv.wood || 0) + (wc ? G.chest.wood || 0 : 0);
  // хлыст можно тащить: обрублен, вершина отрезана, не тяжелее ~2,5 «охапок» на волокуше (≤ 160 кг)
  const dragOk = L => L && !L.f && L.n > 0 && logCut(L) >= 1 && (L.top || L.zt == null) && typeof Tree !== 'undefined' && L.sk != null && Carry.logKg(L) <= 160;
  // руки заняты ношей: работа (рубка, лунка, рыбалка) — сначала положить
  function handsBusy(silent) { if (!Carry.busy()) return false; if (!silent) Fx.toast(':hand: Руки заняты · X — положить, E — убрать'); G.p.cd = 0.4; return true; }
  // удар (волк, шатун): замах — касание в 0.7 (≥ 0,3 с) — удар; с ношей — сперва бросить её к ногам
  function strike(o, kind) {
    const p = G.p; if (p.action && p.action.cx) p.action = null; if (p.action) return false;
    if (Carry.busy()) return Carry.dropAll([{ k: 'strike', o, kind }]);
    faceTo(o); p.action = { k: 'strike', t: 0, dur: 0.45, pose: 'swing', o, kind, tg: { x: o.x, y: o.y }, th: -16, marks: [0.7], fb: 'swing' }; p.cd = 0.4;
    return true;
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
  // Валка: надлом (качание и треск, warn с) → падение маятником (медленный старт, fall с) → удар о землю (урон, преграда) → отскок и перекат.
  // Направление — от зарубки (стороны, где стоял герой) ± spread; изредка (risk, в ветер/пургу чаще) — на героя или вбок.
  // Если по пути ствола другой ствол, изба, обломки, куча, бревно — пробуем другой угол (±0.4…1.2), затем обратную сторону.
  // Разделка: обрубка сучьев (крона снимается от вершины по ударам, лапник на снег), затем чурки; остаток ствола и лапник заметает (bury сут).
  const FELL = { warn: [0.35, 0.55], fall: [0.8, 1.4], settle: 0.9, spread: 0.3, risk: 0.1, riskWind: 0.05, riskStorm: 0.08, dmg: 14, hitR: 17, bury: 0.75, buryOld: 0.25, logMax: 8, lapMax: 48 };
  const chopDX = t => World.trunkR(t) + 10.5;   // где стоит герой у ствола: вплотную к преграде ствола, лезвие — в ствол
  // длина лежачего ствола (px): от реза (HC над снегом) до вершины — реальная высота модели (js/tree3d.js), 23 px = 1 м
  function logLen(t) { if (typeof Tree !== 'undefined') { const q = Tree.of(t); return Math.round((q.S.H * q.k - Tree.HC) * Tree.M); } return Math.round(150 * t.s / (ArtWorld.treeK ? ArtWorld.treeK(t.s) : 1) * (typeof GFX !== 'undefined' && GFX.tjit ? GFX.tjit(t) : 1)); }
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
  const rr = (a, b) => a + Math.random() * (b - a);
  function fell(t) {
    const p = G.p, len = logLen(t), side = t.nside || Math.sign(p.x - t.x) || -p.face || 1, toHero = Math.atan2(p.y - t.y, p.x - t.x);
    let a0 = (side > 0 ? Math.PI : 0) + rr(-FELL.spread, FELL.spread), risk = 0;
    const w = typeof Wind !== 'undefined' ? Wind.at(t.x, t.y) : { ms: 0 };
    if (Math.random() < FELL.risk + FELL.riskWind * clamp((w.ms - 4) / 8, 0, 1) + (stormOn() ? FELL.riskStorm : 0)) {
      risk = Math.random() < 0.6 ? 1 : 2;   // 1 — на героя, 2 — вбок
      a0 = risk === 1 ? toHero + rr(-0.2, 0.2) : a0 + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + rr(-0.25, 0.25));
    }
    let a = fallDir(t, a0); const blocked = a == null; if (blocked) a = a0;
    G.logs = G.logs || [];
    // лишние старые стволы не исчезают — их заметает (bury), исчезают, когда скроет целиком (tickLogs)
    const live = G.logs.filter(L => !L.bury && !L.done);
    if (live.length >= FELL.logMax) live[0].bury = G.time;
    const n = World.wood0(t);
    const L = { x: t.x, y: t.y, a: +a.toFixed(3), len: blocked && typeof Tree === 'undefined' ? Math.round(len * 0.55) : len, s: t.s, kind: t.kind, v: t.v, n, n0: n, t0: G.time, id: (G.logN = (G.logN || 0) + 1),
      f: { t: 0, w: +rr(FELL.warn[0], FELL.warn[1]).toFixed(2), T: +rr(FELL.fall[0], FELL.fall[1]).toFixed(2), r: +rr(0.035, 0.1).toFixed(3) * (Math.random() < 0.5 ? 1 : -1), risk } };
    // объёмная модель: форма и масштаб — те же, что у стоящего; план разделки (чурки ~0.45 м), масса целого
    if (typeof Tree !== 'undefined') { const q = Tree.of(t); L.sk = q.S.key; L.k = +q.k.toFixed(4); L.zTop = null; Tree.ensure(L); }
    G.logs.push(L);
    World.shakeTree(t, L.f.w);
    Barks.say(p, 'Па-адает!', { h: 60 });
    if (inPath(L, p)) Fx.toast(document.body.classList.contains('has-touch') ? ':tree: Падает на тебя! Кнопка отскока' : ':tree: Падает на тебя! Shift — отскок');
    return L;
  }
  const logEnd = (L, k) => ({ x: L.x + Math.cos(L.a) * L.len * k, y: L.y + Math.sin(L.a) * L.len * 0.6 * k });
  // герой под стволом: отрезок от 0.1 длины до вершины, ближе hitR (по образцу сухостоя гари)
  function inPath(L, q, k0 = 0.1, m = 0) {
    const e = logEnd(L, 1), vx = e.x - L.x, vy = e.y - L.y, k = ((q.x - L.x) * vx + (q.y - L.y) * vy) / (vx * vx + vy * vy || 1);
    return k >= k0 && k <= 1.05 && Math.hypot(q.x - L.x - vx * k, q.y - L.y - vy * k) < FELL.hitR * (L.s || 1) + m;
  }
  const near = (L, q) => inPath(L, q, -0.15, 12);   // рядом с линией падения (для отскока — поперёк, не вдоль)
  // падает ли ствол (ещё не ударился): не преграда, не разделать; danger — куда отскочить (поперёк ствола, от линии)
  const falling = L => !!(L.f && !L.f.hit);
  function danger(q = G.p) {
    for (const L of G.logs || []) if (falling(L) && near(L, q)) {
      const c = Math.cos(L.a), s = Math.sin(L.a) * 0.6, l = Math.hypot(c, s) || 1, nx = -s / l, ny = c / l, sd = (q.x - L.x) * nx + (q.y - L.y) * ny >= 0 ? 1 : -1;
      return { L, x: nx * sd, y: ny * sd, t: L.f.w + L.f.T - L.f.t };
    }
    return null;
  }
  // удар о землю: урон тому, кто под стволом (герой), тряска, звук
  function impact(L) {
    const p = G.p, e = logEnd(L, 1); iceHit(L);
    Fx.shake(dist2(L, p) < 260 * 260 ? 5 : 2); Sound.src(e.x, e.y).thud ? Sound.src(e.x, e.y).thud(0.9, 1) : Sound.src(e.x, e.y).hit();
    if (!p.inside && !p.ride && inPath(L, p)) {
      G.s.hp -= FELL.dmg; G.hurt = 1; p.action = null; Fx.shake(8); Fx.toast(':hp: Придавило стволом');
      Interact.emit('fellHit', { who: 'p', x: p.x, y: p.y, log: L });
    }
  }
  // дерево × лёд: удар ствола и кроны по льду (Tree.iceImpact: нагрузка по окнам ~1.5 м против прочности A·h²) — пролом там,
  // где лёд тонкий (Ice.thick); ствол частично проваливается (L.sink), шуга; герой на льду рядом — проваливается/лёд трещит
  function iceHit(L) {
    if (typeof Tree === 'undefined' || typeof Ice === 'undefined' || !Ice.thick || !L.sk) return null;
    const r = Tree.iceImpact(L, Ice.thick), br = r.win.filter(w => w.brk); L.iceR = r.win.length ? +Math.max(...r.win.map(w => w.F / w.cap)).toFixed(2) : 0;
    if (!br.length) return null;
    const z0 = Math.min(...br.map(w => w.z0)), z1 = Math.max(...br.map(w => w.z1)), { S, k } = Tree.of(L), zm = (z0 + z1) / 2, d = (zm - L.hc) * k * Tree.M;
    const x = L.x + Math.cos(L.a) * d, y = L.y + Math.sin(L.a) * d * 0.6, rad = clamp((z1 - z0) * k * Tree.M * 0.45 + 10, 14, 40);
    const h = Ice.breakAt(x, y, rad, L.a); L.sink = [+z0.toFixed(3), +z1.toFixed(3), +(Tree.rz(S, zm) * k * 1.6).toFixed(3)];
    const p = G.p;
    if (!p.inside && !p.ride && onIce(p.x, p.y)) { const dd = Math.hypot(p.x - h.x, (p.y - h.y) * 1.6);
      if (dd < h.r + 16 && !Ice.active()) Ice.start(p); else if (dd < h.r + 70) { Fx.toast(':frost: Лёд проломило — отойди от полыньи'); Sound.creak && Sound.creak(); p.iceT = Math.max(p.iceT || 0, 1); } }
    return h;
  }
  // ход валки и заметание: остаток ствола и лапник уходят под снег за bury суток
  function tickLogs(dt) {
    const Ls = G.logs; if (!Ls) return;
    for (let i = Ls.length - 1; i >= 0; i--) {
      const L = Ls[i], f = L.f;
      if (f) { f.t += dt; if (!f.hit && f.t >= f.w + f.T) { f.hit = 1; impact(L); } if (f.t >= f.w + f.T + FELL.settle) delete L.f; }
      if (logSnow(L) >= 1) Ls.splice(i, 1);
    }
    if (G.lap) for (let i = G.lap.length - 1; i >= 0; i--) if (G.time - G.lap[i].t > CYCLE * FELL.bury) G.lap.splice(i, 1);
  }
  // 0..1 — насколько ствол заметён: разделан (done) — за bury суток, лишний старый (bury) — за buryOld
  const logSnow = L => Math.max(L.done != null ? (G.time - L.done) / (CYCLE * FELL.bury) : 0, L.bury != null ? (G.time - L.bury) / (CYCLE * FELL.buryOld) : 0);
  // лапник на снегу (G.lap): {x, y, a, s, t} — куча веток с обрубленной кроны; заметает за bury суток
  function lapnik(x, y, a, s) {
    G.lap = G.lap || []; if (G.lap.length >= FELL.lapMax) G.lap.shift();
    G.lap.push({ x: Math.round(x), y: Math.round(y), a: +a.toFixed(2), s: +(s || 1).toFixed(2), t: G.time });
  }
  // снятый кусок кроны (доли c0→c1 от вершины): ветки отлетают, по обе стороны ствола — лапник
  function limbFx(L, c0, c1) {
    const s = L.s || 1, c = Math.cos(L.a), sn = Math.sin(L.a) * 0.6, l = Math.hypot(c, sn) || 1, nx = -sn / l, ny = c / l;
    const k0 = 1 - c1 * 0.9, k1 = 1 - c0 * 0.9, m = (k0 + k1) / 2, q = logEnd(L, m), w = (1 - m) * 26 * s + 8;
    for (const sd of [1, -1]) lapnik(q.x + nx * sd * w * 0.55 + rnd(-4, 4), q.y + ny * sd * w * 0.4 + rnd(-2, 2), L.a + sd * 0.5 + rnd(-0.3, 0.3), s * (0.7 + (1 - m) * 0.5));
    if (ArtWorld.fx.twigs) for (const k of [k0, m, k1]) { const e = logEnd(L, k); ArtWorld.fx.twigs(G.parts, e.x, e.y, 10 + (1 - k) * 20, s); }
    const e = logEnd(L, m); ArtWorld.fx.snowPuff(G.parts, e.x, e.y - 4, 0.5);
  }
  // ближайшее место ствола к герою (разделка идёт с того конца, что ближе к вершине: сначала сучья, потом чурки)
  // сколько ствола осталось (доля длины от комля): разделка идёт от вершины — обрубка снимает крону (сучья), дальше чурки
  const logK = L => { if (L.zTop != null && L.sk != null && typeof Tree !== 'undefined') { const H = Tree.of(L).S.H; return clamp((L.zTop - L.hc) / (H - L.hc), 0, 1); } return L.n0 ? 0.12 + 0.88 * L.n / L.n0 : 1; };
  // сколько кроны снято (0..1): старые сейвы — lim = 1 (обрублена целиком)
  const logCut = L => (L.cut != null ? L.cut : L.lim ? 1 : 0);
  // точка ствола, ближайшая к q (на оставшейся части)
  function logPt(L, q) {
    const e = logEnd(L, logK(L)), vx = e.x - L.x, vy = e.y - L.y, k = clamp(((q.x - L.x) * vx + (q.y - L.y) * vy) / (vx * vx + vy * vy || 1), 0.08, 1);
    return { x: L.x + vx * k, y: L.y + vy * k, k };
  }
  // где работать топором: обрубка — у края оставшейся кроны, разделка — у конца ствола (чурка за чуркой к комлю)
  function workPt(L) {
    if (L.sk != null && typeof Tree !== 'undefined' && L.zTop != null) { const z = Tree.workZ(L), H = Tree.of(L).S.H; return logEnd(L, clamp((z - L.hc) / (H - L.hc), 0.02, 1)); }
    const c = logCut(L), k = c < 1 ? 1 - (c + 0.5 / LIMB_N) * 0.88 : logK(L) - 0.06;
    return logEnd(L, clamp(k, 0.1, 1));
  }
  // куда встать: сбоку от точки работы (x ± 18), не в стволе; ближняя к герою сторона
  function workSpot(L, w) {
    const p = G.p, c = Math.cos(L.a), s = Math.sin(L.a) * 0.6, l = Math.hypot(c, s) || 1, nx = -s / l, ny = c / l, R = 4.2 * (L.s || 1) + 11;
    let best = null, bd = 1e9; const hs = (p.x - L.x) * nx + (p.y - L.y) * ny >= 0 ? 1 : -1;   // та сторона ствола, где герой
    for (const sd of [1, -1]) {
      const q = { x: w.x + sd * 18, y: w.y + 4 }, o = (q.x - L.x) * nx + (q.y - L.y) * ny;
      if (o * hs < R) { const k = hs * R - o; q.x += nx * k; q.y += ny * k; }
      if (World.blocked(q.x, q.y, 8)) continue;
      const d = dist2(q, p); if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  function nearLog(r) {
    const p = G.p; let best = null, bd = r * r;
    for (const L of G.logs || []) { if (L.n <= 0 || L.f || logSnow(L) > 0.5) continue; const q = logPt(L, p), d = dist2(q, p); if (d < bd) { bd = d; best = L; } }
    return best;
  }
  const LIMB_N = 3;   // ударов на обрубку кроны (за одно действие — время и дрова прежние)
  // дрова на снегу (чурки, комель, вершина); лапник — не дрова (его возьмёт переноска, js/tree3d.js — контракт частей)
  function nearChunks(r) { const p = G.p, w = typeof Tree !== 'undefined' ? Tree.isWood : () => true; return (G.chunks || []).filter(c => w(c) && dist2(c, p) < r * r); }

  // боковая точка у ствола: x ± (преграда ствола + тело), чуть ниже комля; сперва сторона героя, занята — другая
  function chopSpot(t) {
    const p = G.p, s0 = Math.sign(p.x - t.x) || -p.face || 1, dx = chopDX(t);
    for (const sd of [s0, -s0]) { const q = { x: t.x + sd * dx, y: t.y + 3 }; if (!onIce(q.x, q.y) && !World.blocked(q.x, q.y, 9.5)) return q; }
    return null;
  }
  // рубка только у ствола: герой в точке сбоку (|dx| ≈ chopDX, |dy| ≤ 7)
  const atTrunk = t => { const p = G.p, dx = Math.abs(p.x - t.x); return dx > chopDX(t) - 5 && dx < chopDX(t) + 5 && Math.abs(p.y - t.y - 3) <= 7; };
  function startChop(t) {
    const p = G.p; if (!atTrunk(t)) return false;
    const pose = Hero.chopPose(), sd = Math.sign(p.x - t.x) || 1; t.nside = sd; p.face = -sd;
    p.action = { k: 'chop', t: 0, dur: Hero.chopTime() * 0.5 * (t.kind === 3 ? TUNE.zone.garChop : 1) * (A.chopK[pose] || 1), o: t, pose, tg: { x: t.x + sd * 4 * t.s, y: t.y }, th: -10 };
    return true;
  }
  function startBuck(L) {
    const p = G.p, pose = Hero.chopPose(), w = workPt(L); faceTo(w);
    const a = { k: 'buck', t: 0, dur: Hero.chopTime() * 0.5 * (A.chopK[pose] || 1), o: L, pose, fb: 'chop', tg: { x: w.x, y: w.y }, th: -3, limb: logCut(L) < 1 ? 1 : 0 };
    a.per = Hero.chopCycle(a).cl; p.action = a;
  }

  // Тексты с числами (':fire: +25 с', 'Костёр: :wood:3', 'Спать — после 19:00') — литералы контента
  // (сверяются tests/content-snapshot.js); меняя TUNE, поправь и их.
  // ---------- что под рукой ----------
  function context() {
    const p = G.p;
    if (p.sleeping) return null;
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < A.bearR * A.bearR) return { k: 'bear', label: p.torch > 0 ? 'Ткнуть факелом' : 'Ударить', o: G.bear };
    const w = nearest(G.wolves, A.wolfR); if (w) return { k: 'wolf', label: 'Ударить', o: w };
    // заяц (замер рядом) не перехватывает разговор: человек ближе зайца — сначала человек
    const h = !Carry.busy() && nearest(Space.hares, A.hareR, liveHare);   // руки заняты ношей — зайца не схватить
    if (h) { const nc = !p.ride && Npc.context(p); if (!(nc && nc.o && nc.o.x != null && dist2(nc.o, p) < dist2(h, p))) return { k: 'hare', label: 'Поймать', o: h }; }
    const tc = Transport.context(p); if (tc) return tc;
    if (p.ride) return null; // верхом — только «слезть»
    const cc = Carry.context(p); if (cc) return cc;   // с ношей у нарт/поленницы — уложить; с пустыми руками у поленницы — взять
    // из избы палку не бросить (стены) — и «Бросить палку» не перехватывает у лежанки «Спать», пока волки кружат у избы
    const wf = !p.inside && !Carry.busy() && nearest(G.wolves, A.throwR, w => w.st !== 'retreat'); if (wf) return { k: 'throw', label: 'Бросить палку', o: wf };
    const npc = Npc.context(p); if (npc) return npc;
    const zc = Zones.context(p) || Transport.urkContext(p); if (zc) return zc;
    if (!G.labaz && dist2(POI.labaz, p) < 70 * 70) return { k: 'labaz', label: 'Лабаз · :meat:2' };
    const stash = World.nearestStash(p, 50); if (stash) return { k: 'stash', label: stash.dg < 1 ? 'Копать тайник' : 'Тайник', o: stash };
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
    const tr = nearest(G.traps, 44); if (tr) return { k: 'trap', label: tr.catch ? 'Забрать ' + ITEMS[tr.catch].i : (tr.set < 1 ? 'Насторожить ' : 'Снять ') + ITEMS[tr.kind].i, o: tr };
    const st = nearest(G.stacks, 56);
    if (st) {
      if (st.lit > 0) return null;
      if (st.wood < 4) return { k: 'stack', label: `Куча ${st.wood}/4 · +:wood:`, o: st };
      return { k: 'stack', label: Inv.has('kero', false) ? 'Поджечь :kero:' : 'Поджечь', o: st };
    }
    for (const w of ['cockpit', 'tail']) if (G.wreck[w].length && dist2(POI[w], p) < 120 * 120) return { k: 'wreck', label: `Разбирать · ${G.wreck[w].length}`, o: w };
    if (!G.flags.tube && dist2(TUBE_POS, p) < 44 * 44) return { k: 'tube', label: 'Взять :tube:' };
    // работа с деревом (чурки, ствол) — раньше следов и сугробов: удержание E не упирается в «мягкий» жест
    if (!p.inside) {
      // удержание E на разделке — разделка до конца (чурки соберёт следующее нажатие)
      if (input.act && HOLD.last === 'log' && !Carry.busy()) { const lg = nearLog(44); if (lg) return { k: 'log', label: logCut(lg) < 1 ? 'Обрубить сучья' : lg.zt != null && !lg.top ? 'Отрубить вершину' : `Разделать · ${lg.n}`, rep: 1, o: lg }; }
      // пустые руки у ствола — сперва разделка (чурки соберёт, когда ствол разделан или руки уже набирают охапку)
      const lg0 = !Carry.busy() && nearLog(44); if (lg0) return { k: 'log', label: logCut(lg0) < 1 ? 'Обрубить сучья' : lg0.zt != null && !lg0.top ? 'Отрубить вершину' : `Разделать · ${lg0.n}`, alt: dragOk(lg0) ? `Волоком · ${Math.round(Carry.logKg(lg0))} кг` : null, rep: 1, o: lg0 };
      const ch = nearChunks(46).filter(q => !Carry.cantTake(q)); if (ch.length) { const q = ch.slice().sort((a, b) => dist2(a, p) - dist2(b, p))[0], nm = q.kind === 'butt' ? 'комель' : q.kind === 'top' ? 'вершину' : 'чурку';
        return { k: 'chunks', label: `Взять ${nm} · ${(q.mass || Tree.KG).toFixed(1).replace('.', ',')} кг` + (Carry.busy() ? ` · :hand:${Carry.count() + 1}` : ''), o: ch }; }
      const lg = nearLog(44); if (lg) return { k: 'log', label: logCut(lg) < 1 ? 'Обрубить сучья' : lg.zt != null && !lg.top ? 'Отрубить вершину' : `Разделать · ${lg.n}`, rep: 1, o: lg };
      const sk = !Carry.busy() && (G.litter || []).find(q => q.k === 'stick' && !q.vx && !q.fl && dist2(q, p) < 26 * 26); if (sk) return { k: 'litter', label: 'Подобрать палку', o: sk, soft: 1 }; // палка под ногами — раньше сугроба
      const lc = Carry.nearCtx(p); if (lc) return lc;   // вещи на снегу, туши (палка под ногами — раньше)
      const sc = Carry.stowCtx(p); if (sc) return sc;   // с ношей — убрать в рюкзак (что влезет) или «руки полны»
    }
    if (p.inside && Carry.busy() && !(dist2(SPOT.stove, p) < 50 * 50 && Carry.woodN())) { const sc = Carry.stowCtx(p); if (sc) return sc; }
    if (!G.gear.shovel && !G.flags.shovel && !p.inside && typeof Trail !== 'undefined' && dist2(Trail.SHOVEL, p) < 40 * 40) return { k: 'shovel', label: 'Взять лопату :shovel:' };
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
    if (!p.inside && !Carry.busy()) {
      const lt = (G.litter || []).find(q => !q.fl && dist2(q, p) < 34 * 34); if (lt) return { k: 'litter', label: lt.k === 'stick' ? 'Подобрать палку' : 'Подобрать банку', o: lt, soft: 1 };
    }
    { const sc = Carry.sledCtx(p); if (sc) return sc; }   // лицом к своим нартам — взять с них
    const t = nearest(Space.trees, 56, t => t.wood > 0 && !t.wall); if (t) return { k: 'tree', label: 'Рубить', alt: 'Трясти', rep: 1, o: t };
    const sp = !p.inside && nearest(Space.trees, 40, t => t.wood <= 0 && !t.wall && t.stage !== 1); if (sp) return { k: 'rest', label: 'Присесть', o: sp, soft: 1 };
    if (onIce(p.x, p.y)) {
      const hole = nearest(G.holes, 34, h => holeOk(h) && h.fish > 0 && !(h.ice > 0.3));
      if (hole) return { k: 'fish', label: 'Рыбачить', o: hole };
      const part = nearest(G.holes, 34, h => !holeOk(h));
      if (part) return { k: 'dig', label: 'Долбить лунку', o: part };
      return { k: 'dig', label: 'Пробить лунку' };
    }
    // лопата: в поле, где нет другого действия — расчищать (держать E; идти можно, втрое медленнее)
    if (G.gear.shovel && !p.inside && !p.ride && typeof Trail !== 'undefined') return { k: 'clear', label: 'Расчищать :shovel:', soft: 1 };
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
    primary(c, silent); HOLD.last = c.k;
    if (!silent) { HOLD.c = c; HOLD.a = p.action; HOLD.t = 0; HOLD.done = false; }
  }
  function primary(c, silent) {
    const p = G.p;
    switch (c.k) {
      case 'throw': throwAt(c.o, 'wolf'); break;
      case 'dog': faceTo(c.o); p.action = { k: 'pet', t: 0, dur: A.petT, pose: 'pet', loop: 1, tg: c.o, th: -8, o: c.o }; break;
      case 'fire': faceTo(c.o); p.action = { k: 'warm', t: 0, dur: A.warmT, pose: G.s.warm < 30 ? 'warmHandsCold' : 'warmHands', loop: 1, tg: c.o, th: -8, o: c.o, fl: 0 }; break;
      // лопата у двери: дотянулся — в руке (со стены ушла в этот кадр), рассмотрел — за спину (снаряжение)
      case 'shovel': faceTo(Trail.SHOVEL); job('shovel', 'take', { dur: 1.8, pose: 'takeItem', item: 'shovel', tg: at0(Trail.SHOVEL), th: -14, at: [0.2201, 0.84], fb: 'pickUp', o: Trail.SHOVEL }); break;
      case 'clear': p.action = { k: 'clear', t: 0, dur: 1e6, pose: 'scoop', per: D().scoop || 1, loop: 1, walk: 1, fb: 'dig', ph: 0 }; break;
      case 'digout': { const per = D().scoop || 1; p.action = { k: 'digout', t: 0, dur: 2.4, pose: 'scoop', per, loop: 1, fb: 'dig' }; } break;
      case 'drift': p.action = { k: 'kick', t: 0, dur: D().kick || A.kickT, pose: 'kick', tg: { x: p.x + p.face * 16, y: p.y + 2 }, o: c.o, marks: [0.45], fb: 'swing' }; break;
      case 'tracks': faceTo(c.o); p.action = { k: 'read', t: 0, dur: A.readT, pose: 'crouch', loop: 1, tg: c.o, o: c.o }; break;
      // к пню своими ногами, последние шаги — опускается на него (сдвиг ≤ 1 px за кадр)
      case 'rest': { const o = c.o, sd = Math.sign(p.x - o.x) || -p.face, q = { x: o.x + sd * 12, y: o.y + 3 };
        const sit = () => { const P = G.p; P.face = -sd; P.action = { k: 'rest', t: 0, dur: 1e6, pose: 'rest', loop: 1, o, fb: 'sit', x0: P.x, y0: P.y, sx: o.x + P.face * 2, sy: o.y + 3 }; };
        jobAt(q.x, q.y, sit, 2); } break;
      case 'wolf': strike(c.o, 'wolf'); break;
      case 'bear': strike(c.o, 'bear'); break;
      // заяц: схватил (уходит из мира в касание) → тушка в руке → на снег → разделать (шкурка, мясо) → куски в рюкзак
      case 'hare': if (handsBusy(silent)) break; c.o.t = Math.max(c.o.t || 0, 1.2); Carry.pick('hare', c.o, [{ k: 'lay' }]); p.cd = 0.4; break;
      case 'carry': Carry.primary(c, silent); break;
      case 'note': if (!silent) startNote(c.o); break;
      case 'labaz': { if (handsBusy(silent)) break; Carry.pick('labaz', null, [{ k: 'stow' }]);
        const n = NOTES.labaz; plate(n.t, n.i, { x: POI.labaz.x, y: POI.labaz.y - 78 }, { life: 7, obj: 1 }); } break;
      case 'stash': if (c.o.dg < 1) { stashDig(c.o); break; } if (!silent) { faceTo(c.o); Hero.play('open', { react: 1, tg: c.o }); Interact.emit('open', { who: 'p', obj: 'stash', target: c.o, x: c.o.x, y: c.o.y }); UI.openStash(c.o); } break;
      case 'amulet': if (handsBusy(silent)) break; Carry.pick('amulet', c.o, [{ k: 'stow' }]); Fx.burst(c.o.x, c.o.y - 10, 8, '#ffd27a'); break;
      case 'site': faceTo(c.o); p.buildT = 0.35; p.buildB = c.o.id; p.cd = 0.25; Hero.play('swing', { react: 1, tg: c.o, ik: 0 }); Interact.emit('work', { who: 'p', what: 'build', x: c.o.x, y: c.o.y }); break;
      case 'bld': if (!silent) { faceTo(c.o); UI.openCraft(c.o.type === 'market' ? 'market' : 'epoch'); } break;
      case 'inspect': if (!silent) { faceTo(c.o); p.action = { k: 'inspect', t: 0, dur: clamp(2 + c.o.t.length * 0.045, 3, 7), pose: 'inspect', loop: 1, tg: { x: c.o.x, y: c.o.y }, th: -12, o: c.o, cx: 1, fb: 'crouch' };
        plate(c.o.t, c.o.i, { x: c.o.x, y: c.o.y - 46 }, { a: p.action, obj: 1 }); p.cd = 0.3; } break;
      case 'veh': case 'vfix': case 'vfuel': case 'rent': if (!silent || c.k !== 'veh') Transport.act(c); p.cd = 0.4; break;
      case 'survey': p.action = { k: 'survey', t: 0, dur: TUNE.zone.surveyT, o: c.o.id, pose: 'lookAround', loop: 1, fb: 'build' }; break;
      case 'forecast': if (!silent) { Fx.toast(Zones.forecast()); G.flags.forecast = G.day; p.cd = 1; } break;
      case 'loot': faceTo(c.o); p.action = { k: 'loot', t: 0, dur: TUNE.zone.lootT, o: c.o.id, pose: 'pry', loop: 1, fb: 'build', tg: { x: c.o.x, y: c.o.y }, th: -24 }; break;
      case 'deer': if (!silent) { Fx.toast(':deer: Олень Уркачана. Не трогай — дед обидится.'); p.cd = 1; } break;
      case 'stove': stoveFeed(); break;
      case 'bench': if (!silent) { faceTo(SPOT.bench); UI.openCraft(G.hut.bench ? 'craft' : 'hut'); } break;
      case 'chest': if (!silent) { faceTo(SPOT.chest); Hero.play('open', { react: 1, tg: SPOT.chest }); UI.openChest(); } break;
      case 'bed': if (!silent) trySleep(); break;
      // чурки — по одной за жест: с земли в руку в момент касания, к груди — в охапку; удержание E собирает охапку (до armsN/armsKg)
      case 'chunks': { const q = c.o.filter(q => !Carry.cantTake(q)).sort((a, b) => dist2(a, p) - dist2(b, p))[0]; if (!q) { if (!silent) Fx.toast(Carry.FULL[Carry.cantTake(c.o[0])] || ':hand: Руки полны'); break; }
        Carry.pick('part', q, []); p.cd = 0.1; } break;
      case 'litter': if (handsBusy(silent)) break; Carry.pick('litter', c.o, [{ k: 'stow' }]); break;
      case 'log': {
        if (handsBusy(silent)) break;
        if (Inv.weight() > Inv.capKg() + TUNE.hero.overChop) { if (!silent) Fx.toast(':pack: Перегруз — оставь часть в тайнике'); p.cd = 0.5; break; }
        // сам подходит сбоку к месту работы (край кроны / конец ствола) и рубит туда
        const L = c.o, q = workSpot(L, workPt(L));
        if (q && Math.hypot(q.x - p.x, q.y - p.y) > 6) { autoTo(q.x, q.y, 2, () => { if (G.logs && G.logs.includes(L) && L.n > 0 && !G.p.action) startBuck(L); }); p.cd = 0.2; break; }
        startBuck(L);
      } break;
      case 'trap': {
        const t = c.o; p.cd = 0.4; faceTo(t);
        // пустую: сложить (пружину спустить/петлю снять) → в руку → в рюкзак; недонастороженную — настораживать дальше
        if (handsBusy(silent)) break;
        if (!t.catch) { trapStep(t, t.set < 1 ? 'set' : 'unset'); break; }
        // улов: из ловушки в руку в касание → заяц — на снег и разделать, соболь — в карман
        Carry.pick('trapc', t, [{ k: 'stow' }]);
        break;
      }
      case 'stack': {
        const s = c.o;
        faceTo(s); p.cd = 0.25;
        if (s.wood < 4) { if (!Inv.has('wood', false)) Fx.toast(':close: Не хватает: :wood:1'); else stackStep(s, 'lay'); }
        else stackStep(s, Inv.has('kero', false) ? 'kero' : 'light');
        break;
      }
      // обломки: отжимает листы руками (поза pry, без топора) лицом к корпусу; нет позы — запасная рубка
      case 'wreck': { if (handsBusy(silent)) break; const pose = Hero.chopPose(), tg = wreckPt(c.o); faceTo(tg); p.action = { k: 'wreck', t: 0, dur: A.wreckT * (A.chopK[pose] || 1), o: c.o, pose: 'pry', fb: pose, loop: 1, tg, th: -30 }; } break;
      case 'tube': if (handsBusy(silent)) break; Carry.pick('tube', TUBE_POS, [{ k: 'stow' }]); break;
      case 'tree': {
        if (handsBusy(silent)) break;
        if (Inv.weight() > Inv.capKg() + TUNE.hero.overChop) { if (!silent) Fx.toast(':pack: Перегруз — оставь часть в тайнике'); p.cd = 0.5; break; }
        // прицел: герой сам подходит к боковой точке у ствола (ближняя свободная сторона) — лезвие в ствол; издалека и из-за дерева не рубит
        const t = c.o, q = chopSpot(t);
        if (!q) { if (!silent) Fx.toast(':close: Не подойти к стволу'); p.cd = 0.5; break; }
        if (Math.hypot(q.x - p.x, q.y - p.y) > 4) { autoTo(q.x, q.y, 1.5, () => { if (t.wood > 0 && !G.p.action) startChop(t); }); p.cd = 0.2; break; }
        startChop(t);
      } break;
      case 'fish': if (handsBusy(silent)) break; p.action = { k: 'fish', ph: 'wait', t: 0, dur: rnd(1.5, 4) - 0.2 * (Hero.lvl('fish') - 1), o: c.o }; break;
      // лунка растёт по ударам пешни (h.dg 0..1): начатую — додолбить
      case 'dig': if (handsBusy(silent)) break; if (c.o) faceTo(c.o); p.action = { k: 'dig', t: 0, dur: Math.max(1, A.digT * (1 - (c.o ? c.o.dg || 0 : 0))), o: c.o || null, dg0: c.o ? c.o.dg || 0 : 0 }; break;
    }
  }

  // обрубка и раскряжёвка объёмной модели: части — объекты мира (Tree.split → G.chunks), сумма частей = целое дерево
  function finishBuck3(L, a) {
    const w = a.tg || workPt(L);
    if (logCut(L) < 1) {   // треть мутовок от комля: ветви лапником на снег по одной; на последней — отрезана вершина
      const ps = Tree.split(L, 'limb'); Sound.chop(); Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: w.x, y: w.y });
      const e = logEnd(L, logK(L)); ArtWorld.fx.snowPuff(G.parts, w.x, w.y - 4, 0.5);
      Fx.floatText(w.x, w.y - 20, logCut(L) < 1 ? `:tree: сучья ×${ps.length}` : ':tree: вершина'); void e; return;
    }
    let n = 1; if (Hero.lvl('chop') >= 5 && Math.random() < 0.25) n = 2;
    const out = []; for (let i = 0; i < n && L.n > 0; i++) out.push(...Tree.split(L, 'buck'));
    Hero.xp('chop'); G.s.food = Math.max(0, G.s.food - A.chopFood * 0.5);
    const at = out.length ? { x: out[0].fx, y: out[0].fy } : w;
    Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: at.x, y: at.y }); Sound.chop(); ArtWorld.fx.snowPuff(G.parts, at.x, at.y, 0.35);
    Fx.floatText(at.x, at.y - 20, out.map(p => (p.kind === 'butt' ? 'комель ' : 'чурка ') + Math.round(p.mass) + ' кг').join(' · '));
    if (L.n <= 0) { const i = G.logs.indexOf(L); if (i >= 0) G.logs.splice(i, 1); }   // ствол весь в частях — на снегу лежат они
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
      // обрубка: каждый удар снимает треть кроны от вершины (ветки летят, лапник на снег); последний — и верхушку чуркой.
      // разделка: каждый рез — чурка у места реза, откатывается от ствола; остаток ствола лежит и заметается (done)
      const L = a.o; if (!G.logs || !G.logs.includes(L) || L.n <= 0) return;
      if (typeof Tree !== 'undefined' && L.sk) return finishBuck3(L, a);
      const c0 = logCut(L);
      if (c0 < 1) {
        const c1 = c0 + 1 / LIMB_N > 0.99 ? 1 : +(c0 + 1 / LIMB_N).toFixed(3); L.cut = c1; delete L.lim;
        limbFx(L, c0, c1); Sound.chop();
        const w = a.tg || workPt(L); Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: w.x, y: w.y });
        if (c1 < 1) { Fx.floatText(w.x, w.y - 20, ':tree: сучья'); return; }
      }
      const at = logEnd(L, logK(L)), first = L.n === L.n0;
      L.n--;
      let n = 1; if (Hero.lvl('chop') >= 5 && Math.random() < 0.25) n = 2;
      G.chunks = G.chunks || [];
      const nx = -Math.sin(L.a) * 0.6, ny = Math.cos(L.a), nl = Math.hypot(nx, ny) || 1;
      for (let i = 0; i < n; i++) { const sd = (G.chunks.length % 2 ? 1 : -1) * (9 + 4 * i); G.chunks.push({ x: Math.round(at.x + nx / nl * sd + rnd(-3, 3)), y: Math.round(at.y + ny / nl * sd * 0.6 + rnd(-2, 2) + 3), a: +rnd(-0.6, 0.6).toFixed(2), t: G.time, fx: Math.round(at.x), fy: Math.round(at.y) }); }
      if (G.chunks.length > 60) G.chunks.splice(0, G.chunks.length - 60);
      Hero.xp('chop'); G.s.food = Math.max(0, G.s.food - A.chopFood * 0.5);
      Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: at.x, y: at.y }); Sound.chop(); ArtWorld.fx.snowPuff(G.parts, at.x, at.y, 0.35);
      Fx.floatText(at.x, at.y - 20, first ? ':tree: сучья' : `чурка ×${n}`);
      if (L.n <= 0) L.done = G.time;   // остаток ствола (комель) не исчезает — заметает за FELL.bury суток
    } else if (a.k === 'fish') {
      if (a.ph === 'wait') {
        // клюёт! полоса с зелёной зоной — жми E вовремя
        const w = clamp(0.14 + 0.03 * (Hero.lvl('fish') - 1) + (G.gear.lure ? 0.06 : 0) + (G.col && G.col.techs.nets ? 0.04 : 0), 0.1, 0.4);
        G.p.action = { k: 'fish', ph: 'bite', t: 0, dur: 2.6, o: a.o, z: rnd(0.1, 0.9 - w), w, sp: rnd(1.3, 2.2) }; Sound.tone('sine', 1200, 1500, 0.08, 0.2);
      } else if (a.ph === 'play') {
        const h = a.o, p = G.p, sd = Math.sign(p.x - h.x) || -p.face;
        G.stats.fish++; G.stats.bestKg = Math.max(G.stats.bestKg || 0, a.kg); ArtWorld.fx.splash(G.parts, h.x, h.y);
        Fx.floatText(h.x, h.y - 30, `:fish: ${a.fn} · ${a.kg.toFixed(2).replace('.', ',')} кг`); Fx.burst(h.x, h.y, 10, '#b9e2ff'); Sound.splash(); Interact.emit('work', { who: 'p', what: 'fish', x: h.x, y: h.y });
        if (a.big) Fx.toast(`:fish: Таймень! ${a.kg.toFixed(1).replace('.', ',')} кг`);
        const q = Carry.drop('fish', a.n, h.x - sd * 6, h.y + 16, { kg: a.kg, fx: h.x, fy: h.y });   // на лёд перед лункой — видно, как бьётся
        Carry.run([{ k: 'wait', o: q, t: 1.1 }, { k: 'pick', src: 'loose', o: q }, { k: 'stow' }]);
      } else Fx.floatText(a.o.x, a.o.y - 30, 'ушла');
    } else if (a.k === 'dig') {
      // последний удар — вода: лунка готова
      const h = a.o && G.holes.includes(a.o) ? a.o : digHole(a); h.dg = 1; h.fish = A.holeFish;
      ArtWorld.fx.splash(G.parts, h.x, h.y); Sound.hit();
      Interact.emit('work', { who: 'p', what: 'dig', x: h.x, y: h.y });
    } else if (a.k === 'wreck') {
      // отжал лист — находка выпала на снег у корпуса (своим полётом), дальше — поднять и убрать (цепочка)
      const pool = G.wreck[a.o], id = pool.shift(); if (!id) return;
      const at = toward(a.tg || POI[a.o], 20);
      if (id === 'saw') { G.gear.saw = 1; Fx.toast(':saw: Пила! Рубка быстрее'); Sound.pick(); Hero.play('pickUp', { react: 1, tg: at }); }
      else {
        if (id === 'scrap') G.stats.scrap++;
        if (id === 'quartz') { G.flags.quartz = 1; Fx.toast(':quartz: Кварц для рации'); }
        if (id === 'battery') Fx.toast(':battery: Аккумулятор. Тяжёлый. Зарядить у печки');
        if (id === 'cable') Fx.toast(':cable: Кабель — на антенну');
        const q = Carry.drop(id, 1, at.x + p.face * rnd(-4, 4), at.y + rnd(2, 6), { fx: at.x, fy: at.y - 22 });
        Carry.run([{ k: 'pick', src: 'loose', o: q }, { k: 'stow' }]);
      }
      Interact.emit('work', { who: 'p', what: 'wreck', x: at.x, y: at.y });
    } else if (a.k === 'loot') {
      // обыск построек зон: как обломки, пул предметов (выпадает на снег → поднять → убрать); буровая — может обвалиться
      const o = Zones.obj(a.o), pool = G.loot[a.o], id = pool && pool.shift(); if (!id) return;
      if (pool.length === o.loot.length - 1 && o.t) Fx.toast(ZONES[o.zone].ic + ' ' + o.t);
      if (id === 'scrap') G.stats.scrap++;
      const at = toward(o, 20); Sound.hit();
      const q = Carry.drop(id, 1, at.x + rnd(-4, 4), at.y + rnd(2, 6), { fx: at.x, fy: at.y - 18 });
      if (o.zone === 'drill' && Math.random() < TUNE.zone.collapseP) { G.s.hp -= TUNE.zone.collapseDmg; G.hurt = 0.8; Fx.shake(5); Fx.toast(ZONE_TXT.collapse); }
      else Carry.run([{ k: 'pick', src: 'loose', o: q }, { k: 'stow' }]);
    } else if (a.k === 'survey') {
      const o = Zones.surveyPoint(a.o); if (!o) return;
      Zones.survey(o.x, o.y); Fx.toast(ZONE_TXT.survey); Sound.ok2();
      if (o.t && !G.flags['sv_' + o.id]) { G.flags['sv_' + o.id] = 1; setTimeout(() => Fx.toast(ZONES[o.zone].ic + ' ' + o.t), 1600); }
    } else if (a.k === 'job') { const J = JOB[a.j]; if (J && J.end) J.end(a); }
    else if (END[a.k]) END[a.k](a);
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
    tickFly(dt); tickLogs(dt); tickWorld(dt);
    // долгое E: второе действие цели (жест, начатый нажатием, отменяется); рубку удержание по-прежнему повторяет
    if (input.act) {
      HOLD.t += dt;
      if (!HOLD.done && HOLD.c && HOLD.c.alt && !HOLD.c.rep && HOLD.t >= A.holdT) { HOLD.done = true; if (p.action && p.action === HOLD.a) p.action = null; p.cd = 0; alt(HOLD.c); }
    } else { HOLD.c = null; HOLD.done = false; HOLD.last = null; }
    if (input.act && !p.action && p.cd <= 0 && !HOLD.done) interact(true);
    Hero.tickLife(dt);
  }

  // ---------- мир без исполнителя: всё постепенно ----------
  // выловленная лунка затягивается льдом (≈ 0,2 суток), пустая банка уходит под снег (полсуток, рисование — по возрасту),
  // улов в ловушке на глазах у героя не появляется: ждёт, пока ловушка вне кадра (t.pend — js/fauna.js)
  const HOLE_ICE = 0.2, CAN_LIFE = 0.5, VIEW = { x: 760, y: 500 };
  const inView = o => Math.abs(o.x - G.p.x) < VIEW.x && Math.abs(o.y - G.p.y) < VIEW.y;
  function tickWorld(dt) {
    stoveDoor += clamp(stoveDoorTg() - stoveDoor, -dt * 3, dt * 3);
    for (let i = G.holes.length - 1; i >= 0; i--) {
      const h = G.holes[i]; if (!(h.fish <= 0) || !holeOk(h) || (G.p.action && G.p.action.o === h)) continue;
      h.ice = Math.min(1, (h.ice || 0) + dt / (CYCLE * HOLE_ICE)); if (h.ice >= 1) G.holes.splice(i, 1);
    }
    if (G.litter) for (let i = G.litter.length - 1; i >= 0; i--) if (G.time - G.litter[i].t > CYCLE * CAN_LIFE) G.litter.splice(i, 1);
    for (const t of G.traps) if (t.pend && !inView(t)) { t.catch = t.pend; delete t.pend; }
    Carry.tick(dt);
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
  const ALT_I = { tree: 'tree', fire: 'frost', dog: 'dog', log: 'tree' };
  function altLabel(c) {
    if (Carry.dragL() && !G.p.ride) return ['Отпустить ствол', 'hand'];
    if (Carry.busy() && !G.p.ride) return ['Положить ношу', 'hand'];
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
    if (Carry.dragL()) { Carry.dragStop(); return; }          // X волоком — отпустить ствол
    if (Carry.busy()) { Carry.put('ground', []); return; }   // X с ношей — положить на снег по одной (тем же объектом)
    c = c || context();
    if (c && c.alt) switch (c.k) {
      case 'tree': faceTo(c.o); p.action = { k: 'shake', t: 0, dur: D().shakeTree || A.shakeT, pose: 'shakeTree', tg: c.o, th: -10, o: c.o, marks: [0.22, 0.5, 0.78] }; return;
      case 'fire': faceTo(c.o); fireStep(c.o, 'bury'); return;   // три горсти снега — огонь садится по броскам
      case 'dog': callDog(c.o); return;
      case 'log': Carry.dragStart(c.o); return;   // взяться за комель и тащить
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
  // ствол на линии броска (герой → цель, по земле): палка бьётся о ближайший; дерево самой цели (ворон на макушке) — не помеха
  function stickPath(x0, y0, x1, y1) {
    const vx = x1 - x0, vy = y1 - y0, L = Math.hypot(vx, vy); if (L < 30) return null;
    let best = null, bu = 1;
    for (const t of treesNear((x0 + x1) / 2, (y0 + y1) / 2, L / 2 + 30)) {
      if (!(t.wood > 0) || (t.x - x1) ** 2 + (t.y - y1) ** 2 < 14 * 14) continue;
      const u = ((t.x - x0) * vx + (t.y - y0) * vy) / (L * L); if (u <= 14 / L || u >= bu) continue;
      const px = x0 + vx * u - t.x, py = y0 + vy * u - t.y, R = World.trunkR(t) + 2;
      if (px * px + py * py < R * R) { bu = u; best = t; }
    }
    if (!best) return null;
    const k = Math.max(0, bu - (World.trunkR(best) + 5) / L); return { t: best, x: x0 + vx * k, y: y0 + vy * k };
  }
  // бросок: палка — вещь мира с полёта (q.fl: откуда, куда, T; рисуется летящей), бросок длится, пока она в воздухе (a.pd — поза)
  function launch(a) {
    const p = G.p, o = a.o, x0 = p.x + p.face * 10, y0 = p.y - 44, hit = stickPath(p.x, p.y, o.x, o.y);
    const gx = hit ? hit.x : o.x, gy = hit ? hit.y : o.y, x1 = gx, y1 = hit ? gy - 26 : o.y - (o.z || 0) - 8;
    const T = clamp(Math.hypot(x1 - x0, y1 - y0) / A.throwV, 0.25, 0.9);
    const q = dropStick(x0, p.y, 0, 0, 1); if (q) q.fl = { x0: Math.round(x0), y0: Math.round(p.y), h0: 44, x1: Math.round(gx), y1: Math.round(gy), h1: Math.round(gy - y1), T: +T.toFixed(3), t: 0 };
    FLY.push({ t: T, o, kind: a.kind, x: gx, y: gy, tree: hit ? hit.t : null, dx: Math.sign(gx - p.x) || p.face, q }); p.cd = A.throwCd; Sound.whoosh && Sound.whoosh();
    a.pd = a.pd || a.dur; a.dur = Math.max(a.dur, a.t + T + 0.05);
  }
  // палка в полёте: позиция по дуге (рисование и перепись — q.x/q.y на земле под ней, высота — stickH)
  function tickFly(dt) {
    if (G.litter) for (const q of G.litter) if (q.fl) { const f = q.fl; f.t = Math.min(f.T, f.t + dt); const e = f.t / f.T; q.x = Math.round(f.x0 + (f.x1 - f.x0) * e); q.y = Math.round(f.y0 + (f.y1 - f.y0) * e); }
    for (let i = FLY.length - 1; i >= 0; i--) { const f = FLY[i]; if ((f.t -= dt) > 0) continue; FLY.splice(i, 1); land(f); }
    if (G.litter) for (let i = G.litter.length - 1; i >= 0; i--) { const q = G.litter[i]; if (q.vx) slide(q, dt, i); }
  }
  // палка остаётся лежать (G.litter, k 'stick': подобрать — E; заметает за полсуток, как банку); в воде — тонет/уплывает
  function dropStick(x, y, vx = 0, vy = 0, air) {
    if (!air && Ice.water(x, y)) return null;
    G.litter = G.litter || []; if (G.litter.length >= 12) G.litter.shift();
    const q = { x: Math.round(x), y: Math.round(y), k: 'stick', t: G.time, a: +(((x * 7.3 + y * 3.1) % 6.28 + 6.28) % 6.28).toFixed(2) };
    if (vx || vy) { q.vx = vx; q.vy = vy; }
    G.litter.push(q); return q;
  }
  // по голому льду палка скользит, стучит о ствол (отскок), в снегу — встаёт, в воде — пропадает
  function slide(q, dt, i) {
    const e = Math.exp(-dt * 1.4); q.vx *= e; q.vy *= e; q.x += q.vx * dt; q.y += q.vy * dt;
    for (const t of treesNear(q.x, q.y, 20)) if (t.wood > 0 && (t.x - q.x) ** 2 + (t.y - q.y) ** 2 < (World.trunkR(t) + 3) ** 2) { q.vx *= -0.4; q.vy *= -0.4; q.x += q.vx * dt * 2; q.y += q.vy * dt * 2; Sound.thud && Sound.thud(0.12, 1); }
    if (Ice.water(q.x, q.y)) { Ice.splash(q.x, q.y); G.litter.splice(i, 1); return; }
    if (Math.hypot(q.vx, q.vy) < 6 || !Depth.bareIce(q.x, q.y)) { delete q.vx; delete q.vy; q.x = Math.round(q.x); q.y = Math.round(q.y); }
  }
  function land(f) {
    const o = f.o, p = G.p;
    // палка долетела: дальше лежит (или скользит/тонет) — тот же объект
    const q = f.q && G.litter && G.litter.includes(f.q) ? f.q : null, rest = (x, y, vx) => { if (!q) return; delete q.fl; q.x = Math.round(x); q.y = Math.round(y); if (vx) { q.vx = vx; q.vy = 0; } };
    if (f.tree) { // о ствол: глухой удар, ветки вздрогнули — палка падает у комля, к бросавшему
      Interact.emit('throw', { who: 'p', obj: 'tree', target: f.tree, x: f.x, y: f.y });
      rest(f.x - f.dx * 6, f.y + 3); return;
    }
    const near = dist2(o, f) < 44 * 44;
    if (f.kind === 'wolf' && near && G.wolves.includes(o) && Math.random() < A.throwHit) {
      o.st = 'flee'; o.t = 0.8; Sound.hit(); Fx.floatText(o.x, o.y - 40, 'Пошёл!'); Fx.burst(o.x, o.y - 14, 5, '#dde6ee');
    } else if (f.kind === 'hare' && near && liveHare(o)) {
      if (Math.random() < A.throwHare + 0.05 * (Hero.lvl('hunt') - 1)) {
        // заяц убит: тушка падает на снег (своей анимацией) — разделать на месте
        G.hares.splice(G.hares.indexOf(o), 1); G.stats.hares++; Hero.xp('hunt');
        Carry.carcass('hare', o.x, o.y, f.dx * 60, 0); Fx.burst(o.x, o.y - 6, 10, '#ffffff'); Sound.pick();
      } else { const a = Math.atan2(o.y - p.y, o.x - p.x); o.vx = Math.cos(a) * 170; o.vy = Math.sin(a) * 170; o.t = 0.7; }
    }
    // поверхность под палкой: вода — всплеск, голый лёд — стук и скольжение, снег — облачко, палка торчит
    const wet = Ice.water(f.x, f.y), bare = !wet && Depth.bareIce(f.x, f.y);
    Interact.emit('throw', { who: 'p', obj: wet ? 'water' : bare ? 'ice' : 'snow', target: o, x: f.x, y: f.y });
    if (wet) { if (q) { G.litter.splice(G.litter.indexOf(q), 1); Ice.splash(f.x, f.y); } }
    else rest(f.x + f.dx * 4, f.y + 2, bare ? f.dx * 120 : 0);
    // лайка бежит за палкой (кроме «сидеть») и сама возвращается к герою
    const d = petDog();
    if (d && d.task.k !== 'stay' && dist2(d, p) < A.dogR * A.dogR) { d.task = { k: 'move', x: f.x, y: f.y }; d.wag = now + 3; }
  }
  // касание в нужный момент позы: удары рубки, толчки дерева, пинок, горсти снега, бросок, свист
  function contacts(a, t0) {
    const p = G.p;
    if (a.k === 'dig') {
      // удар пешни: выемка растёт, крошка льда; первый удар — начало лунки
      const per = D().dig || 1, i0 = Math.floor(t0 / per - 0.55), i1 = Math.floor(a.t / per - 0.55);
      if (i1 > i0 && i1 >= 0 && a.t < a.dur - 1e-3) {
        const h = a.o && G.holes.includes(a.o) ? a.o : (a.o = digHole(a)), n = Math.max(1, Math.round(a.dur / per));
        h.dg = Math.min(0.95, (h.dg || 0) + (1 - (a.dg0 || 0)) / n); work(); Sound.hit();
        for (let k = 0; k < 7; k++) G.parts.push({ type: 'dot', x: h.x + rnd(-5, 5), y: h.y - 2, vx: rnd(-60, 60), vy: rnd(-90, -40), g: 300, life: 0.45, max: 0.45, color: k % 2 ? '#dbe9f4' : '#9fc3dc' });
      }
    }
    if ((a.k === 'chop' && !G.gear.saw) || a.k === 'wreck' || a.k === 'buck') {
      const c = Hero.chopCycle(a), i0 = Math.floor(t0 / c.cl - c.ia), i1 = Math.floor(a.t / c.cl - c.ia);
      if (i1 > i0 && i1 >= 0 && a.t < a.dur - 1e-3) {
        if (a.k === 'chop') Interact.emit('hit', { who: 'p', target: a.o, x: a.o.x, y: a.o.y, power: 0.4, mid: 1 });
        else if (a.k === 'buck') Interact.emit('work', { who: 'p', what: 'buck', obj: 'dead', x: a.tg.x, y: a.tg.y });
        else { const at = toward(a.tg || POI[a.o], 20); Interact.emit('work', { who: 'p', what: 'wreck', obj: 'wreck', x: at.x, y: at.y }); }
      }
    }
    if (a.k === 'craft' && a.units) while (a.got < a.units.length && a.t >= craftAt(a, a.got)) {
      const id = a.units[a.got];
      if (!Inv.take(id, 1, !!a.wc)) { Fx.toast(':close: Не хватает: ' + ITEMS[id].i + '1'); G.p.action = null; return; }
      a.got++; Sound.tone && Sound.tone('triangle', 700 + 60 * a.got, 500, 0.04, 0.02);
    }
    if (a.k === 'job' && a.at) { const J = JOB[a.j]; for (let i = 0; i < a.at.length; i++) { const m = a.at[i] * a.dur; if (t0 < m && a.t >= m) { J.hit(a, i); if (G.p.action !== a) return; } } }
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
      else if (a.k === 'eat' && !a.ate) { a.ate = 1; ate(a.o); }
      else if (a.k === 'strike') { const r = (a.kind === 'bear' ? A.bearR : A.wolfR) + 40; if (a.kind === 'bear' ? G.bear === o && dist2(o, p) < r * r : G.wolves.includes(o) && dist2(o, p) < r * r) (a.kind === 'bear' ? Bear : Wolves).hit(o); else Fx.floatText(p.x + p.face * 20, p.y - 40, 'мимо'); }
      else if (a.k === 'call') Sound.whistle && Sound.whistle();
    }
  }
  // расчистка лопатой: пока держит E — пятно перед собой (по ходу или лицом) → pack 1 за ~1.2 с (≈ 1 м² за 1.5 с);
  // каждый замах (цикл позы scoop) — усталость как удар топором, хруст и выброс снега в сторону
  function clearStep(a, dt) {
    const p = G.p;
    if (!input.act || p.ride || p.inside || UI.modal()) { p.action = null; return; }
    const v = Math.hypot(p.vx || 0, p.vy || 0), ux = p.moving && v > 5 ? p.vx / v : p.face, uy = p.moving && v > 5 ? p.vy / v * 0.8 : 0.15;
    const x = p.x + ux * 12, y = p.y + 2 + uy * 10;
    Trail.shovel(x, y, 16, dt / 1.2); a.ahead = Trail.at(x + ux * 20, y + uy * 20); // впереди ещё не расчищено — шаг медленнее (Hero.speed)
    const ph = Math.floor(a.t / a.per + 0.45);
    if (ph > a.ph) {
      a.ph = ph; G.s.tire = Math.min(100, (G.s.tire || 0) + TUNE.tire.hit * (Settings.diff().tire || 1)); // замах — как удар
      if (Sound.ok() && Sound.shovel) Sound.shovel();
      if (!(window.QUALITY === 'low')) ArtWorld.fx.snowPuff(G.parts, x - p.face * 4, y - 6, 0.3);
    }
  }
  // пока длится: тепло у огня, отдых на пне; огонь погас — греться нечем
  function during(a, dt) {
    const p = G.p;
    if (a.k === 'job') { const J = JOB[a.j]; if (J && J.tick) J.tick(a, dt); return; }
    if (a.k === 'mount' || a.k === 'unmount') { Transport.boardStep(a); return; }
    if (a.k === 'digout') { Depth.dig(p.x, p.y, dt); return; }
    if (a.k === 'clear') { clearStep(a, dt); return; }
    if (a.k === 'warm') {
      if (!(a.o.fuel > 0)) { p.action = null; return; }
      if (Fire.heatAt(p, 0) > 0) G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + A.warmHeat * dt);
      if ((a.fl -= dt) <= 0) { a.fl = 0.5; Interact.emit('warm', { who: 'p', obj: 'fire', target: a.o, x: a.o.x, y: a.o.y }); }
    } else if (a.k === 'eat') {
      // горячее — пар от банки/миски/куска у груди
      if (a.hot && (a.st = (a.st || 0) - dt) <= 0) { a.st = 0.12; G.parts.push({ type: 'breath', x: p.x + p.face * rnd(5, 9), y: p.y - rnd(26, 30), vx: rnd(-4, 4) + p.face * 2, vy: rnd(-18, -10), life: 1.2, max: 1.2 }); }
    } else if (a.k === 'rest') {
      if (a.sx != null && a.t < 0.6) { const e = a.t / 0.6, k = e * e * (3 - 2 * e); p.x = a.x0 + (a.sx - a.x0) * k; p.y = a.y0 + (a.sy - a.y0) * k; }
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
    eat(a) { if (!a.ate) ate(a.o); if (a.o === 'can') litter('can'); },
    craft(a) { if (a.units) { while (a.got < a.units.length) { if (!Inv.take(a.units[a.got], 1, !!a.wc)) return; a.got++; } } craftDone(a.r); },
    lie() { const p = G.p; p.sleeping = true; p.x = SPOT.bed.x; p.y = SPOT.bed.y + 4; Hero.snap(); },
    getUp() {},
    mount(a) { Transport.boarded(a); },
    unmount() { G.p.board = null; },
    pay(a) { Transport.rentPaid(a.o); },
  };
  const CANCEL = {
    job(a) { const J = JOB[a.j]; if (J && J.cancel) J.cancel(a); },
    mount() { G.p.board = null; }, unmount() { G.p.board = null; },
    craft(a) {
      if (!a.units) { for (const [k, v] of Object.entries(a.r.in)) Inv.add(k, v); Fx.toast(':close: ' + a.r.n + ' — брошено, материалы целы'); return; }   // старый сейв: всё было взято сразу
      for (let i = 0; i < a.got; i++) Inv.add(a.units[i]);
      Fx.toast(':close: ' + a.r.n + ' — брошено, материалы целы');
    },
    noteRead() { if (PLATE && PLATE.note) PLATE = null; },
    eat(a) { if (a.ate && a.o === 'can') litter('can'); },   // бросил есть после первой ложки — банка на снегу
    fish(a) { if (a.ph === 'play') { Fx.floatText(a.o.x, a.o.y - 30, 'Сошла'); Sound.tone('triangle', 400, 200, 0.2, 0.15); } },
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
      if (id === 'scrap') G.stats.scrap++;
      // находка вылетает из сугроба на снег (сушняк — чурка, своя масса); поднять — E
      const x = p.x + p.face * 18; Fx.burst(x, p.y - 4, 8, '#dde6ee', 110); Sound.pick();
      if (id === 'wood') { const m = +rnd(1.5, 3.5).toFixed(2); (G.chunks = G.chunks || []).push({ id: (G.partN = (G.partN || 0) + 1), kind: 'chunk', tk: 3, len: 0.45, diam: 0.1, vol: +(m / 450).toFixed(5), mass: m, x: Math.round(x + p.face * 6), y: Math.round(p.y + 4), ang: +rnd(-0.6, 0.6).toFixed(2), t: G.time, fx: Math.round(p.x + p.face * 14), fy: Math.round(p.y) }); }
      else Carry.drop(id, 1, x + p.face * 6, p.y + 4, { fx: p.x + p.face * 14, fy: p.y });
      Barks.say(p, id === 'can' ? 'Тушёнка! Кто-то оставил.' : id === 'scrap' ? 'Железка. Пригодится.' : 'Сушняк под снегом.', { h: 60 });
    },
    bury() {},
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
      // подсёк: вываживание (чем тяжелее — дольше), рыба выходит на лёд и бьётся; дальше — поднять и убрать
      const kg = rnd(f.w[0], f.w[1]), n = f.big ? 3 : kg > 2 ? 2 : 1;
      G.p.action = { k: 'fish', ph: 'play', t: 0, dur: clamp(1.1 + kg * 0.28, 1.2, 4.5), o: h, kg: +kg.toFixed(2), n, fn: f.n, big: f.big ? 1 : 0 };
      Fx.floatText(h.x, h.y - 30, ':fish: сидит!'); Sound.tone('sine', 900, 1300, 0.08, 0.12);
      if (--h.fish <= 0) Fx.toast(':fish: Лунка пуста');   // лунка остаётся и затягивается льдом (tickHoles)
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

  // ---------- процессы: работа шагами (docs: «везде процесс») ----------
  // Шаг — обычное действие p.action { k: 'job', j: вид работы, s: шаг, t, dur, pose, tg, th, o, at: [доли касаний] }.
  // JOB[j].hit(a, i) — касание (рука/инструмент дошли: доля a.at[i]); tick(a, dt) — пока идёт; end(a) — следующий шаг;
  // cancel(a) — прервали (шаг, удар, другое действие): что ещё не ушло в работу, остаётся/возвращается.
  // Логика меняется ровно в касание; в действии — только данные (сейв переживает), шаги — по имени.
  const work = () => { G.s.tire = Math.min(100, (G.s.tire || 0) + TUNE.tire.hit * (Settings.diff().tire || 1)); };
  const job = (j, s, o) => (G.p.action = Object.assign({ k: 'job', j, s, t: 0 }, o));
  const at0 = o => ({ x: o.x, y: o.y });
  // встать к месту работы своими ногами (автопуть), рядом — сразу
  function jobAt(x, y, fn, stop = 3) {
    const p = G.p;
    if (Math.hypot(x - p.x, y - p.y) > stop + 4) { autoTo(x, y, stop, () => { if (!G.p.action) fn(); }); return; }
    fn();
  }
  const abort = a => { a.done = true; if (G.p.action === a) G.p.action = null; };
  const puff = (x, y, k = 0.35) => ArtWorld.fx.snowPuff(G.parts, x, y, k);
  function sparks(x, y, n = 6) { for (let i = 0; i < n; i++) G.parts.push({ type: 'spark', x: x + rnd(-3, 3), y: y - 3, vx: rnd(-40, 40), vy: rnd(-90, -30), life: rnd(0.3, 0.6), max: 0.6, g: 60 }); }
  function steam(x, y, n = 5) { for (let i = 0; i < n; i++) G.parts.push({ type: 'smoke', x: x + rnd(-8, 8), y: y - 8, vx: rnd(-10, 10), vy: rnd(-40, -22), life: rnd(1.6, 2.6), max: 2.6 }); }
  const JOB = {};
  JOB.carry = { hit: (a, i) => Carry.hit(a, i), end: a => Carry.end(a), cancel: a => Carry.cancel(a) };   // ноша: взять, уложить, разделать (js/carry.js)
  // лунка: dg 0..1 — пробита (нет поля — готова: старые сейвы, лунки посёлка); ice 0..1 — затянулась
  const holeOk = h => !(h.dg < 1);
  function digHole(a) { const p = G.p, h = { x: Math.round(p.x + p.face * 24), y: Math.round(p.y + 4), fish: 0, dg: 0 }; a.dg0 = 0; G.holes.push(h); return h; }

  // ---------- огонь: разложить (расчистить → поленья по одному → растопка → поджиг), подкинуть, засыпать ----------
  // Костёр f: { x, y, fuel, lay (поленьев лежит, не горят), b (кладут новый), site 0..1 (утоптано), kd 0..1 (растопка),
  //   sn 0..1 (засыпан снегом), fl 0..1 (сколько огня видно: растёт/гаснет плавно, js/fire.js) }
  const fireNeed = f => (f.b ? TUNE.fire.buildCost : TUNE.fire.relightCost);
  const fireStep = (f, s, o) => job('fire', s, Object.assign(FIRE_S[s](f), { o: f }, o));
  const FIRE_S = {
    clear: f => ({ dur: 2, pose: 'scoop', per: 1, tg: at0(f), th: -3, at: [0.22, 0.72], fb: 'dig' }),
    lay: f => ({ dur: 1, pose: 'feedStove', tg: at0(f), th: -6, at: [0.5], fb: 'build' }),
    kindle: f => ({ dur: 1.6, pose: 'crouch', loop: 1, tg: at0(f), th: -4, fb: 'build' }),
    ignite: f => ({ dur: 1.4, pose: 'crouch', loop: 1, tg: at0(f), th: -4, at: [0.25, 0.5, 0.78], fb: 'build' }),
    bury: f => ({ dur: 3, pose: 'scoop', per: D().scoop || 1, tg: at0(f), th: -4, at: [0.15, 0.48, 0.82], fb: 'dig' }),
    pull: f => ({ dur: TUNE.load.t.pick, pose: 'pickKeep', tg: at0(f), th: -2, at: [0.3401], fb: 'pickUp' }),
  };
  JOB.fire = {
    hit(a, i) {
      const f = a.o, F = TUNE.fire;
      if (a.s === 'clear') {
        // первая горсть: место под костёр (видно, как утаптывается — f.site растёт до конца шага)
        if (!a.made) { a.made = 1; f.site = 0.05; G.fires.push(f); }
        puff(f.x + rnd(-6, 6), f.y - 2, 0.4); work(); Sound.ok() && Sound.shovel && Sound.shovel();
      } else if (a.s === 'lay') {
        // полено из рук (охапка, потом рюкзак) — в костёр в момент касания; огонь — от массы полена
        const w = useWood(false); if (!w) { Fx.toast(':close: Не хватает: :wood:1'); return abort(a); }
        Sound.chop();
        if (a.feed && f.fuel > 0) { const s0 = f.fuel; f.fuel = Math.min(f.fuel + w.kg * F.secPerKg, F.fuelMax); Fx.floatText(f.x, f.y - 40, ':fire: +' + gameDur(f.fuel - s0)); Fx.burst(f.x, f.y - 10, 10, '#ffb347', 120); FLARE(f); }
        else { f.lay = (f.lay || 0) + 1; f.lkg = +((f.lkg || 0) + w.kg).toFixed(3); }
        G.stats.burnKg = +((G.stats.burnKg || 0) + w.kg).toFixed(3);
      } else if (a.s === 'ignite') {
        // чирк — искры; на третьем занялось: растопка → огонь (дальше разгорается сам, f.fl)
        sparks(f.x, f.y - 2, i < 2 ? 5 : 9); Sound.tone && Sound.tone('square', 1800 + i * 300, 900, 0.05, 0.03);
        if (i === 2) {
          // растопка: часть массы уходит на разгорание (eff), дальше горит от массы
          const kg = f.lkg != null ? f.lkg : (f.lay || 0) * (typeof Tree !== 'undefined' ? Tree.KG : 6);
          f.fuel = Math.min(F.fuelMax, kg * F.secPerKg * (f.b ? F.buildEff : F.relightEff)); f.lay = 0; f.lkg = 0; f.kd = 0; f.sn = 0; f.fl = f.fl || 0; delete f.b;
          Fx.toast(a.fresh ? ':fire: Костёр' : ':fire: Огонь горит'); Sound.ok2(); steam(f.x, f.y, 2);
        }
      } else if (a.s === 'bury') {
        // горсть снега: шипит, пар; огонь садится по броскам (f.sn), на последней — погас
        Interact.emit('bury', { who: 'p', obj: 'fire', target: f, x: f.x, y: f.y }); work();
        f.sn = Math.max(f.sn || 0, (i + 1) / 3); steam(f.x, f.y, 6); puff(f.x, f.y - 4, 0.3); Sound.tone('sine', 700 - i * 150, 200, 0.3, 0.03);
        if (i === 2) {
          // недогоревшее: масса = остаток огня ÷ secPerKg, поленьями по ~прежнему (fuelAdd) — головни лежат в кострище
          const kg = f.fuel > 0 ? f.fuel / F.secPerKg : 0, n = Math.min(A.buryMax, Math.floor(f.fuel / F.fuelAdd + 1e-6));
          f.fuel = 0; if (n) { f.lay = (f.lay || 0) + n; f.lkg = +((f.lkg || 0) + kg).toFixed(3); } f.sn = 1;
          Fx.floatText(f.x, f.y - 40, n ? `:fire: погашен · +${n} :wood:` : ':fire: погашен');
        }
      } else if (a.s === 'pull') {
        // недогоревшее полено — из кострища в руки (охапка), своя масса
        if ((f.lay || 0) > 0 && !Carry.cantTake({ kind: 'chunk', mass: 1, len: 0.4, vol: 0.001 })) { const kg = (f.lkg != null ? f.lkg : f.lay * Tree.KG) / f.lay; f.lay--; f.lkg = +Math.max(0, (f.lkg || 0) - kg).toFixed(3);
          const q = Carry.partOf({ kg, l: kg / TUNE.load.rho * 1000 }); q.burnt = 1; Carry.parts().push(q); Sound.pick(); } else a.miss = 1;
      }
    },
    tick(a) {
      const f = a.o, e = clamp(a.t / a.dur, 0, 1);
      if (a.s === 'clear' && a.made) f.site = Math.max(f.site || 0, clamp(0.05 + e * 1.05, 0, 1));
      else if (a.s === 'kindle') f.kd = Math.max(f.kd || 0, e);
    },
    end(a) {
      const f = a.o; if (!G.fires.includes(f)) return;
      if (a.s === 'clear') { f.site = 1; return fireStep(f, 'lay', { fresh: 1 }); }
      if (a.s === 'lay') { if (a.feed) return; return (f.lay || 0) < fireNeed(f) ? fireStep(f, 'lay', { fresh: a.fresh }) : fireStep(f, 'kindle', { fresh: a.fresh }); }
      if (a.s === 'kindle') { f.kd = 1; return fireStep(f, 'ignite', { fresh: a.fresh }); }
      if ((a.s === 'bury' || a.s === 'pull') && !a.miss && (f.lay || 0) > 0 && !(f.fuel > 0) && !Carry.cantTake({ kind: 'chunk', mass: 1, len: 0.4, vol: 0.001 })) return fireStep(f, 'pull');
    },
  };
  const FLARE = f => { f.flare = G.time; };

  // ---------- печь: открыть дверцу → полено внутрь → прикрыть; огонь в топке разгорается (G.hut.fl, js/fire.js) ----------
  let stoveDoor = 0;
  const STOVE_TG = () => ({ x: SPOT.stove.x, y: SPOT.stove.y });
  function stoveFeed() {
    const p = G.p;
    if (!Stove.room()) return Fx.toast(':stove: Печь полна');
    if (!woodHave(true)) return Fx.toast(':close: Не хватает: :wood:1 (в руках или в поленнице)');
    faceTo(SPOT.stove); p.cd = 0.3;
    job('stove', 'open', { dur: D().open || 0.9, pose: 'open', tg: STOVE_TG(), th: -8, fb: 'build' });
  }
  JOB.stove = {
    hit(a) { if (!Stove.add()) abort(a); },
    end(a) { if (a.s === 'open') job('stove', 'feed', { dur: D().feedStove || 1, pose: 'feedStove', tg: STOVE_TG(), th: -8, at: [0.55], fb: 'build' }); },
  };
  // насколько открыта дверца топки (рисование): по ходу шагов, после — прикрывается плавно
  function stoveDoorTg() {
    const a = G.p.action; if (!a || a.j !== 'stove') return 0;
    const e = clamp(a.t / a.dur, 0, 1);
    return a.s === 'open' ? clamp((e - 0.35) / 0.4, 0, 1) : e < 0.72 ? 1 : 1 - clamp((e - 0.72) / 0.12, 0, 1);
  }

  // ---------- сигнальная куча: полено за поленом из рук, керосин, поджиг ----------
  const stackStep = (s, st, o) => job('stack', st, Object.assign({ o: s, tg: at0(s), fb: 'build' }, STACK_S[st], o));
  const STACK_S = {
    lay: { dur: 1, pose: 'feedStove', th: -10, at: [0.5] },
    kero: { dur: 1.3, pose: 'place', th: -12, at: [0.45] },
    light: { dur: 1.6, pose: 'crouch', loop: 1, th: -4, at: [0.3, 0.58, 0.85] },
  };
  JOB.stack = {
    hit(a, i) {
      const s = a.o;
      if (a.s === 'lay') { if (s.wood >= 4 || s.lit > 0) return abort(a); const w = useWood(false); if (!w) { Fx.toast(':close: Не хватает: :wood:1'); return abort(a); } s.wood++; s.wkg = +((s.wkg || 0) + w.kg).toFixed(3); Sound.chop(); }
      else if (a.s === 'kero') { if (!Inv.take('kero', 1, false)) return abort(a); a.kero = 1; for (let k = 0; k < 6; k++) G.parts.push({ type: 'dot', x: s.x + rnd(-10, 10), y: s.y - 24, vx: rnd(-20, 20), vy: rnd(0, 30), g: 200, life: 0.5, max: 0.5, color: '#c9b06a' }); }
      else if (a.s === 'light') { sparks(s.x, s.y - 4, i < 2 ? 5 : 10); if (i === 2) Fire.lightStack(s, a.kero ? A.stackKeroT : A.stackLightT); }
    },
    end(a) { if (a.s === 'kero') stackStep(a.o, 'light', { kero: a.kero }); },
  };

  // ---------- ловушки: из рюкзака в руку → на снег → настораживает; снять — спустить, в руку, в рюкзак ----------
  // ловушка t: { x, y, kind, catch, t, set 0..1 (насторожена; нет поля — да) }
  const TRAP_ART = k => (k === 'trap' ? 'trap' : 'coil');
  const trapStep = (t, s) => job('trap', s, s === 'set' ? { dur: 1.6 * (1 - (t.set || 0)) + 0.4, pose: 'crouch', loop: 1, tg: at0(t), th: -2, o: t, s0: t.set || 0, at: [0.6], fb: 'build' }
    : s === 'unset' ? { dur: 1.2, pose: 'crouch', loop: 1, tg: at0(t), th: -2, o: t, at: [0.5], fb: 'build' }
    : { dur: 2, pose: 'takeItem', item: TRAP_ART(t.kind), tg: at0(t), th: -2, o: t, at: [0.2201], fb: 'pickUp' });
  JOB.trap = {
    hit(a) {
      const p = G.p;
      if (a.s === 'put') {
        // рука на снегу — ловушка легла (сложенная), дальше её настораживают
        const t = { x: a.spot.x, y: a.spot.y, kind: a.kind, catch: null, t: G.time, set: 0 }; G.traps.push(t); a.o = t; a.got = 1; Sound.hit();
      } else if (a.s === 'set' || a.s === 'unset') Sound.tone && Sound.tone('square', a.s === 'set' ? 1400 : 900, 500, 0.04, 0.03);
      else if (a.s === 'lift') { const i = G.traps.indexOf(a.o); if (i >= 0) { G.traps.splice(i, 1); Inv.add(a.o.kind); Sound.pick(); } else a.item = null; }
    },
    tick(a) {
      const e = clamp(a.t / a.dur, 0, 1);
      if (a.s === 'set') a.o.set = Math.max(a.o.set || 0, a.s0 + (1 - a.s0) * e);
      else if (a.s === 'unset') a.o.set = Math.min(a.o.set == null ? 1 : a.o.set, 1 - e);
    },
    end(a) {
      if (a.s === 'pack') {
        // достал: вещь в руке с этого кадра (и из рюкзака — в этот же кадр)
        if (!Inv.take(a.kind, 1, false)) return;
        faceTo(a.spot); return job('trap', 'put', { t: 1e-3, dur: D().place || 0.9, pose: 'place', item: TRAP_ART(a.kind), tg: a.spot, th: 0, kind: a.kind, spot: a.spot, at: [0.45], fb: 'build' });
      }
      if (a.s === 'put' && a.o) return trapStep(a.o, 'set');
      if (a.s === 'set') { a.o.set = 1; Fx.toast(a.o.kind === 'trap' ? (World.inCedar(a.o.x, a.o.y) ? ':trap: Капкан в кедраче' : ':trap: Капкан (соболь — только в кедраче)') : ':snare: Силок стоит'); return; }
      if (a.s === 'unset') { a.o.set = 0; return trapStep(a.o, 'lift'); }
    },
    // положить не успел — вещь из руки обратно в рюкзак
    cancel(a) { if (a.s === 'put' && !a.got) Inv.add(a.kind); },
  };

  // ---------- тайник T: выкопать яму в снегу (по горстям) → открыть, класть добро ----------
  function stashDig(s) {
    const p = G.p; faceTo(s);
    job('stash', 'dig', { dur: 2.2 * (1 - (s.dg || 0)) + 0.4, pose: 'scoop', per: D().scoop || 1, tg: at0(s), th: -3, o: s, d0: s.dg || 0, at: [0.2, 0.65], fb: 'dig' });
  }
  JOB.stash = {
    hit(a) { const s = a.o; if (!G.stashes.includes(s)) G.stashes.push(s); puff(s.x + rnd(-6, 6), s.y - 3, 0.45); work(); Sound.ok() && Sound.shovel && Sound.shovel(); },
    tick(a) { if (G.stashes.includes(a.o)) a.o.dg = Math.max(a.o.dg || 0, Math.min(0.99, a.d0 + (1 - a.d0) * a.t / a.dur)); },
    end(a) { const s = a.o; if (!G.stashes.includes(s)) G.stashes.push(s); delete s.dg; Fx.toast(':cache: Тайник — клади добро'); Sound.hit(); UI.openStash(s); },
  };

  // ---------- изба: щели, дверь, верстак, заслонка — работа на месте, часть растёт по ходу (G.hut.prog[id] 0..1) ----------
  // материалы уходят по шагам (доля цены в начале шага); прервал — сделанное и потраченное остаются, продолжить можно
  const HUTO = { walls: { k: 'walls' }, door: { k: 'door' }, bench: { k: 'bench' }, damper: { k: 'damper' } };
  const HUT_N = { walls: 3, door: 3, bench: 3, damper: 2 }, HUT_T = { walls: 3, door: 2.5, bench: 2.5, damper: 2 };
  function hutSpots(id) {
    const ins = G.p.inside, yo = HUT_IN.y1 + WALL + 12;
    if (id === 'walls') return ins ? [{ x: HUT.x - 22, y: HUT_IN.y0 + 24, f: -1 }, { x: HUT.x, y: HUT_IN.y0 + 24, f: 1 }, { x: HUT.x + 20, y: HUT_IN.y0 + 24, f: 1 }]   // между печью и верстаком
      : [{ x: HUT.x - 72, y: yo, f: -1 }, { x: HUT.x - 34, y: yo, f: 1 }, { x: HUT.x + 40, y: yo, f: 1 }];
    if (id === 'door') { const q = ins ? { x: HUT.x + 30, y: HUT_IN.y1 - 12, f: -1 } : { x: HUT.x + 30, y: yo, f: -1 }; return [q, q, q]; }   // навешивают с той стороны, где стоит
    if (id === 'bench') { const q = { x: SPOT.bench.x - 4, y: SPOT.bench.y + 20, f: 1 }; return [q, q, q]; }
    const q = { x: SPOT.stove.x + 22, y: SPOT.stove.y + 10, f: -1 }; return [q, q];
  }
  // сколько стоит оставшаяся работа (по шагам): шаг i платит units[i*U/n .. (i+1)*U/n)
  function hutUnits(u) { const out = []; for (const [k, v] of Object.entries(u.in)) for (let i = 0; i < v; i++) out.push(k); return out; }
  function hutLeft(u) {
    const U = hutUnits(u), n = HUT_N[u.id], i0 = G.hut.paid && G.hut.paid[u.id] || 0, left = {};
    for (let i = Math.floor(i0 * U.length / n); i < U.length; i++) left[U[i]] = (left[U[i]] || 0) + 1;
    return left;
  }
  function hutStep(u, i) {
    const sp = hutSpots(u.id)[i], n = HUT_N[u.id];
    jobAt(sp.x, sp.y, () => {
      const p = G.p; p.face = sp.f;
      const tg = u.id === 'walls' ? { x: sp.x + sp.f * 10, y: sp.y - (p.inside ? 6 : 2) } : u.id === 'door' ? { x: HUT.x + 4, y: HUT_IN.y1 + WALL / 2 } : u.id === 'bench' ? { x: SPOT.bench.x, y: SPOT.bench.y } : { x: SPOT.stove.x, y: SPOT.stove.y };
      const last = u.id === 'door' && i === n - 1;   // дверь: последний шаг — навесить на петли (потянуть створку)
      job('hut', 'w', { id: u.id, i, n, dur: HUT_T[u.id], pose: last ? 'open' : 'craft', loop: last ? 0 : 1, fb: 'build', tg, th: u.id === 'walls' ? -26 : u.id === 'door' ? -18 : u.id === 'bench' ? -20 : -40, o: HUTO[u.id], at: [0.12, 0.5, 0.85] });
    });
  }
  JOB.hut = {
    hit(a, k) {
      const u = HUT_UPG.find(q => q.id === a.id);
      if (k === 0 && !(G.hut.paid && G.hut.paid[a.id] > a.i)) {
        // доля материалов этого шага — из рюкзака/лабаза в руки (в начале шага)
        const U = hutUnits(u), n = a.n;
        for (let j = Math.floor(a.i * U.length / n); j < Math.floor((a.i + 1) * U.length / n); j++) if (!Inv.take(U[j], 1, true)) { Fx.toast(':close: Не хватает: ' + ITEMS[U[j]].i + '1'); return abort(a); }
        G.hut.paid = G.hut.paid || {}; G.hut.paid[a.id] = a.i + 1;
      }
      work(); Sound.chop();
    },
    tick(a) { G.hut.prog = G.hut.prog || {}; if (G.hut.paid && G.hut.paid[a.id] > a.i) G.hut.prog[a.id] = Math.max(G.hut.prog[a.id] || 0, Math.min(0.999, (a.i + clamp(a.t / a.dur, 0, 1)) / a.n)); },
    end(a) {
      const u = HUT_UPG.find(q => q.id === a.id);
      if (a.i + 1 < a.n) return hutStep(u, a.i + 1);
      G.hut[a.id] = 1; if (a.id === 'door') G.hut.doorHp = 100;
      if (G.hut.prog) delete G.hut.prog[a.id]; if (G.hut.paid) delete G.hut.paid[a.id];
      Fx.toast(`${u.i} ${u.n} :ok:`); Sound.ok2();
    },
  };

  JOB.shovel = {
    hit(a, i) {
      if (i === 0) { G.flags.shovel = 1; Sound.pick(); }
      else { G.gear.shovel = 1; Fx.toast(':shovel: Лопата · держи E в поле — расчищать снег'); Sound.ok2(); }
    },
    // не донёс до спины — прислонить обратно к стене (рука отпускает) — шагнул, значит поставил
    cancel(a) { if (G.flags.shovel && !G.gear.shovel) G.flags.shovel = 0; },
  };

  // ---------- F: огонь ----------
  function fireKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.ko) return;
    const p = G.p, F = TUNE.fire;
    if (p.action && p.action.cx) { p.action = null; watch(); }
    if (p.action || p.ride || AUTO) return;
    if (p.inside) return stoveFeed();
    const f = nearest(G.fires, 70);
    if (f) {
      faceTo(f);
      if (f.fuel > 0) {
        if (!Inv.has('wood', false)) return Fx.toast(':close: Не хватает: :wood:1');
        return fireStep(f, 'lay', { feed: 1 });
      }
      const need = Math.max(0, fireNeed(f) - (f.lay || 0));
      if (Inv.cnt('wood', false) < need) return Fx.toast(need === 2 ? ':close: Разжечь: :wood:2' : ':close: Разжечь: :wood:' + need);
      return need ? fireStep(f, 'lay', { fresh: !!f.b }) : fireStep(f, 'kindle', { fresh: !!f.b });
    }
    const s = nearest(G.stacks, 56);
    if (s && s.wood < 4 && !s.lit) { if (!Inv.has('wood', false)) return Fx.toast(':close: Не хватает: :wood:1'); faceTo(s); return stackStep(s, 'lay'); }
    if (Inv.cnt('wood', false) < F.buildCost) return Fx.toast(':close: Костёр: :wood:3');
    const x = clamp(p.x + p.face * 26, 60, W - 60), y = p.y + 8;
    if (Ice.water(x, y)) return Fx.toast(':close: Тут вода — не разжечь'); // на льду можно: протаивает лужу (js/ice.js fireTick)
    if (Math.abs(x - HUT.x) < 130 && Math.abs(y - HUT.y) < 110) return Fx.toast(':close: Слишком близко к избе');
    // место: утоптать и расчистить (2 горсти) → три полена по одному → растопка → огниво
    const nf = { x: Math.round(x), y: Math.round(y), fuel: 0, lay: 0, b: 1, site: 0, fl: 0 };
    fireStep(nf, 'clear');
  }

  // еда: достать из рюкзака (в избе — из лабаза) в руку → есть (поза 1–2 с: банка с ложкой, миска, кусок; пар от горячего) → сытость в конце;
  // уже в руке (рыба, мясо) — есть сразу; банка остаётся на снегу; бросил есть — еда в руке
  function eat() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.ko) return;
    const p = G.p;
    if (G.s.food >= A.fullAt) return Fx.toast(':food: Не голоден');
    const t = Carry.thing();
    if (p.action && p.action.cx) p.action = null;
    if (p.action || p.ride) return;
    if (t && ITEMS[t.id] && ITEMS[t.id].food) return eatHand();
    if (Carry.busy()) return Fx.toast(':hand: Руки заняты · X — положить');
    const wc = p.inside, k = FOOD_ORDER.find(f => Inv.cnt(f, wc) > 0);
    if (!k) return Fx.toast(':close: Нет еды · :hare: :fish:');
    if ((G.inv[k] || 0) > 0) return Carry.get(k, 'pack', [{ k: 'eat' }]);
    // из лабаза: подойти к нему (ближе 40 px — дотянется с места)
    if (dist2(SPOT.chest, p) < 40 * 40) return Carry.get(k, 'chest', [{ k: 'eat' }]);
    const q = World.freeNear(SPOT.chest.x - 16, SPOT.chest.y + 6, 10); jobAt(q.x, q.y, () => Carry.get(k, 'chest', [{ k: 'eat' }]), 12);
  }
  function eatHand() {
    const p = G.p, t = Carry.thing(); if (!t || !ITEMS[t.id] || !ITEMS[t.id].food) return false;
    const k = t.id, it = ITEMS[k], fire = !!Fire.near(TUNE.fire.heatR) || (p.inside && G.hut.fuel > 0);
    p.action = { k: 'eat', t: 0, dur: (D().eat || 1.8) * (k === 'stew' ? 1.15 : 1), pose: 'eat', item: EAT_ITEM[k] || 'meat', o: k, hot: (it.raw && fire) || !!it.warm, cx: 1, fb: 'idle', marks: [0.4] };   // 0.4 — первый кусок: сытость (бросил дальше — уже съел)
    return true;
  }
  // съел (конец позы): кусок из руки — в сытость
  function ate(k) {
    const p = G.p, t = Carry.thing(), it = ITEMS[k]; if (!t || t.id !== k) return;
    t.n = (t.n || 1) - 1; if (t.kg != null) t.kg = Math.max(0, t.kg - it.kg); if (t.n <= 0) Carry.hand().t = null;
    const fire = !!Fire.near(TUNE.fire.heatR) || (p.inside && G.hut.fuel > 0), cooked = !it.raw || fire, v = Math.round(it.food * (cooked ? 1 : A.rawFood));
    G.s.food = Math.min(100, G.s.food + v);
    if (it.warm) G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + it.warm);
    if ((it.raw && fire) || it.warm) G.s.tire = Math.max(0, (G.s.tire || 0) - TUNE.tire.food); // горячее — силы
    Fx.floatText(p.x, p.y - 44, (cooked ? it.i + ' +' : ':frost: сырое +') + v);
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
    // достать из рюкзака → положить на снег → насторожить (раскладывается по ходу)
    job('trap', 'pack', { dur: D().adjustPack || 1, pose: 'adjustPack', fb: 'idle', kind: k, spot: { x: Math.round(p.x + p.face * 20), y: Math.round(p.y + 6) } });
  }

  // ---------- T: тайник в поле («Оставить здесь») — рядом открывает свой, иначе создаёт новый ----------
  function stashKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.action) return null;
    const p = G.p;
    if (p.inside || onIce(p.x, p.y)) { Fx.toast(':close: Здесь не оставить'); return null; }
    const near = World.nearestStash(p, 70);
    if (near) { if (near.dg != null && near.dg < 1) stashDig(near); else UI.openStash(near); return near; }
    if (!Inv.packKg()) { Fx.toast(':close: Нечего оставить'); return null; }
    G.stashes = G.stashes || [];
    if (G.stashes.length >= TUNE.world.stashMax) { Fx.toast(':close: Тайников уже ' + TUNE.world.stashMax + ' — забери что-нибудь'); return null; }
    // яма в снегу: появляется с первой горстью и углубляется (s.dg), готова — окно «положить»
    const s = { id: (G.stashN = (G.stashN || 0) + 1), x: Math.round(p.x + p.face * 22), y: Math.round(p.y + 10), inv: {}, dg: 0 };
    stashDig(s);
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
  // крафт: окно — меню выбора; сама работа — в мире: материалы уходят по ходу (по штуке: из рюкзака в руки → в изделие,
  // к 3/4 работы — все), вещь — по прогрессу над героем. Шаг — отмена: взятое возвращается (недоделку разобрал), остальное и не уходило
  function craft(r) {
    if (recipeState(r) !== 'ok') return false;
    const p = G.p; if (p.ko || p.sleeping || (p.action && p.action.k === 'craft')) return false;
    const at = stationPt(r); faceTo(at); if (p.action) p.action = null; watch();
    const units = hutUnits(r), dur = CRAFT_T[r.id] || 3;
    p.action = { k: 'craft', t: 0, dur, r, pose: 'craft', loop: 1, fb: 'build', tg: { x: at.x, y: at.y }, th: r.at === 'bench' ? -24 : -8, ic: r.i, units, got: 0, wc: p.inside ? 1 : 0 };
    return true;
  }
  // доля работы, к которой уходит i-я штука материала (не раньше 0.3 с — рука успевает дотянуться)
  const craftAt = (a, i) => Math.max(0.3, a.dur * 0.75 * (i + 0.5) / a.units.length);
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
    if (!Inv.canPay(hutLeft(u), true)) return 'cost';
    return 'ok';
  }
  // работа над избой — в мире: к месту, шаги с молотком/конопаткой; часть растёт по ходу (окно закрывается)
  function buildHut(u) {
    if (hutUpgState(u) !== 'ok') return false;
    const p = G.p; if (p.ko || p.sleeping || p.ride) return false;
    if (p.action) { p.action = null; watch(); }
    const i = Math.min(HUT_N[u.id] - 1, Math.floor(((G.hut.prog && G.hut.prog[u.id]) || 0) * HUT_N[u.id] + 1e-6));
    hutStep(u, i); return true;
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
    // упал — ноша из рук валится на снег рядом (своим полётом), ствол волоком остаётся лежать
    const Lg = Carry.dragL(); if (Lg) { delete Lg.drag; Carry.hand().drag = null; }
    for (const q of Carry.parts().splice(0)) { const a = Math.random() * 6.28; Object.assign(q, { x: Math.round(p.x + Math.cos(a) * 14), y: Math.round(p.y + 6 + Math.sin(a) * 6), fx: Math.round(p.x), fy: Math.round(p.y - 18), t: G.time, ang: +a.toFixed(2) }); if (!Ice.water(q.x, q.y)) (G.chunks = G.chunks || []).push(q); }
    { const t = Carry.thing(); if (t) { if (t.id === 'carc') Carry.carcass(t.kind || 'hare', p.x + p.face * 12, p.y + 6); else if (ITEMS[t.id]) Carry.drop(t.id, t.n || 1, p.x + p.face * 12, p.y + 6, Object.assign({ fx: p.x, fy: p.y - 18 }, t.kg != null ? { kg: t.kg } : {})); Carry.hand().t = null; } }
    G.pack = null; for (const w of G.wolves) { w.st = 'retreat'; w.t = 3; }
    Hero.snap();
  }
  function koStep(dt) {
    const p = G.p, k = p.ko; k.t += dt;
    if (!k.ph && k.t >= KO_FALL) {
      const m = CHAPTERS[G.chapter].softDeath || { hp: 50, warm: 70, food: 35, skip: 0, fuel: 60, woodKeep: 1, card: [':evenk:', '', ''] };
      p.x = SPOT.bed.x; p.y = SPOT.bed.y + 4; p.action = null; Hero.snap(); p.inside = true; p.sleeping = true; p.face = 1;
      G.s.hp = m.hp; G.s.warm = m.warm; G.s.food = Math.max(G.s.food, m.food); G.time += CYCLE * m.skip; G.hut.fuel = Math.max(G.hut.fuel, m.fuel);
      Inv.pull(G.inv, 'wood', (G.inv.wood || 0) - Math.floor((G.inv.wood || 0) * m.woodKeep)); G.wolves = []; G.pack = null;
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

  const stickH = q => { const f = q.fl; if (!f) return 0; const e = clamp(f.t / f.T, 0, 1); return f.h0 + (f.h1 - f.h0) * e + 0.5 * GR * f.T * f.T * e * (1 - e); };
  return { stickH, nearest, liveHare, context, interact, alt, altLabel, finish, tick, fishStrike, sniff, fireKey, eat, placeKey, stashKey,
    stationOk, recipeState, craft, hutUpgState, buildHut, readNote, trySleep, wake, tickSleep, radioSession,
    nightNow, skipWhy, skipMode, skipKey, skipStart, skipStop, skipping, skipFast, get skipKind() { return skipping() ? SKIP.mode : null; },
    fell, iceHit, knockout, grabbing, noteInHand, plateNext, plateClose, logEnd, logK, logCut, logSnow, falling, danger, inPath, chopSpot, atTrunk, FELL, get plate() { return PLATE; },
    hutLeft, HUTO, CAN_LIFE, inView, walkTo: autoTo, get stoveDoor() { return stoveDoor; }, useWood, woodHave, strike, eatHand, dropStick, handsBusy,
    jobs: { job, JOB, jobAt, abort, faceTo, work },
    busy: () => !!(AUTO || G.p.ko || (G.p.action && (G.p.action.k === 'lie' || G.p.action.k === 'craft' || G.p.action.k === 'notePick'))),
    reading: () => !!PLATE };
})();
