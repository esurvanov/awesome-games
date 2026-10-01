'use strict';
// Ноша: что в руках (G.hand), нарты (G.sled), поленница у избы (дрова G.chest), вещи на снегу (G.loose), туши (G.carcs).
// Всё, что берут, уходит из мира в момент касания рукой и дальше видно в руках; убрать в рюкзак — процесс: снять рюкзак (на снег перед
// собой) → развязать клапан → положить внутрь сверху / приторочить снаружи под ремни (по одной, пока в руках есть что) → затянуть →
// надеть (две лямки); мелочь — в поясной карман, не снимая. Длительность и поза — от массы (wt: лёгкое быстро, тяжёлое — с усилием).
// Рюкзак снят: G.hand.off = {x, y, f, open}; прервали (шаг, удар, отскок) — подхватил за лямку и надел на ходу (G.hand.sl — рисунок);
// на нарты и в поленницу — по одной; туша — разделка ножом по шагам (шкура, мясо), куски — на снег.
// Руки: охапка дров (≤ armsN шт, ≤ armsKg кг) — заняты: не рубить, не бить, не бросать, идёт медленнее; вершина — на плече;
// мелочь — в кулаке. Цепочки шагов — очередь задач Q (pick → stow → pick…), переживает сейв (в действии — только данные).
// G.hand = { p: [части дерева как объекты мира], t: { id, n, kg?, kind? } | null } · G.loose: { id, it, n, kg?, x, y, t, fx?, fy?, src? }
// G.carcs: { id, kind, x, y, t0, vx, vy, sk (шкура снята), m (кусков мяса снято), done (G.time — разделана) }
const Carry = (() => {
  const LD = () => TUNE.load;
  const hand = () => G.hand || (G.hand = { p: [], t: null });
  const parts = () => hand().p, thing = () => hand().t;
  const isWoodP = q => (typeof Tree !== 'undefined' ? Tree.isWood(q) : true);
  // как рисовать вещь в руке (ArtPeople.drawTool) и на снегу
  const ART = { meat: 'meat', fish: 'fish', dried: 'dried', hare: 'fur', wpelt: 'furG', sable: 'furD', scrap: 'scrap', can: 'can', canE: 'canE', tube: 'tube', amulet: 'amulet',
    kero: 'kero', cable: 'coil', snare: 'coil', trap: 'trap', battery: 'bundle', quartz: 'bundle', antenna: 'coil', tea: 'bundle', honey: 'jar', stew: 'bowl', stick: 'stick', carc: 'hare' };
  const NOINV = { amulet: 1, canE: 1, stick: 1 };   // в кармане/за поясом, не в ITEMS (сэвэки — счётчик, пустая банка — мусор, палка)
  const tKg = t => !t ? 0 : t.id === 'carc' ? (t.kg || 2.5) : ITEMS[t.id] ? (t.kg != null ? t.kg : ITEMS[t.id].kg * (t.n || 1)) : 0.1;
  const tL = t => !t ? 0 : t.id === 'carc' ? 4 : ITEMS[t.id] ? ITEMS[t.id].l * (t.n || 1) : 0.3;
  // волоком: обрубленный ствол (хлыст) за комель — G.hand.drag = id ствола; руки заняты, вес — в скорость (по снегу волочится)
  const dragL = () => (G && G.hand && G.hand.drag != null && G.logs ? G.logs.find(L => L.id === G.hand.drag) || null : null);
  const logKg = L => (typeof Tree !== 'undefined' && L.sk != null ? Tree.parts(L).filter(q => !q.fixed).reduce((s, q) => s + q.mass, 0) : 60);
  const kg = () => (G && G.hand ? parts().reduce((s, q) => s + (q.mass || 0), 0) + tKg(thing()) : 0);
  const count = () => (G && G.hand ? parts().length + (thing() ? 1 : 0) + (G.hand.drag != null ? 1 : 0) : 0);
  const busy = () => count() > 0;
  const long = q => q.kind === 'top' || (q.len || 0) > 0.8;
  const woodN = () => (G && G.hand ? parts().filter(isWoodP).length : 0);
  // длительность процесса k для вещи массой kg (TUNE.load.wt): непрерывно растёт с массой, усталость замедляет
  const wt = kg => { const W = LD().wt, ti = G && G.s ? G.s.tire || 0 : 0; kg = Math.max(0, kg || 0); return (W[0] + W[1] * kg / (kg + W[2])) * (1 + W[3] * ti / 100); };
  const dur = (k, kg) => +(LD().t[k] * wt(kg)).toFixed(3);
  const off = () => (G && G.hand && G.hand.off) || null;
  const packKg = () => Inv.kgOf(G.inv);
  function mode() {
    if (!G || !G.hand) return null; const ps = parts(), t = thing();
    if (G.hand.drag != null) return 'drag';
    if (ps.some(long)) return 'shoulder'; if (ps.length) return 'arms'; if (t) return tL(t) > 6 ? 'arms' : 'hold'; return null;
  }
  // волоком: 1 / (1 + кг/dragPull·(1 + провал)) — по тропе легче, по целине тяжелее
  function dragMul() { const Lg = dragL(); if (!Lg) return 1; const L = LD(), sink = typeof Depth !== 'undefined' ? clamp(Depth.heroSink / 60, 0, 1.5) : 0; return 1 / (1 + logKg(Lg) / L.dragPull * (1 + L.sledSink * sink)); }
  const speedMul = () => { const m = mode(), L = LD(); return m === 'arms' ? L.arms : m === 'shoulder' ? L.shoulder : m === 'hold' ? L.hold : m === 'drag' ? dragMul() : 1; };
  // почему нельзя взять часть в руки (null — можно)
  function cantTake(q) {
    const ps = parts(), L = LD();
    if (G.hand && G.hand.drag != null) return 'drag';
    if (thing()) return 'thing';
    if (!ps.length) return null;
    if (long(q) || ps.some(long)) return 'long';
    if (ps.length >= L.armsN) return 'n';
    if (kg() + q.mass > L.armsKg) return 'kg';
    if ((ps.reduce((s, p) => s + (p.vol || 0), 0) + (q.vol || 0)) * 1000 * L.bulk > L.armsL) return 'l';
    return null;
  }
  const FULL = { drag: ':hand: Тащишь ствол · X — отпустить', thing: ':hand: Рука занята · убери', long: ':hand: Вершину — отдельно, на плечо', n: ':hand: Охапка полна', kg: ':hand: Тяжело — больше не взять', l: ':hand: Охапка полна' };
  // дрова из рук (первое полено): {kg, l, part} | null
  function takeWood() { const ps = parts(), i = ps.findIndex(isWoodP); if (i < 0) return null; const q = ps.splice(i, 1)[0]; return { kg: q.mass, l: (q.vol || 0) * 1000, part: q }; }
  // часть из места (нарты, поленница): новая чурка с массой/объёмом места (форма — средняя)
  function partOf(r) { return { id: (G.partN = (G.partN || 0) + 1), kind: 'chunk', tk: 0, len: 0.45, diam: +Math.sqrt(r.l / 1000 / 0.45 / Math.PI * 4).toFixed(3), vol: +(r.l / 1000).toFixed(6), mass: +r.kg.toFixed(4), x: 0, y: 0, ang: 0, t: G.time }; }

  // ---------- нарты, поленница ----------
  const sled = () => G.sled || (G.sled = {});
  const hasSled = () => !!G.gear.sled;
  const sledPt = () => ({ x: G.p.sx, y: G.p.sy });
  const sledKg = () => (hasSled() ? Inv.kgOf(sled()) : 0);
  // нарты в упряжке: груз тормозит, в глубоком снегу — сильнее (полозья вязнут)
  function sledMul() {
    if (!hasSled()) return 1; const L = LD(), sink = typeof Depth !== 'undefined' ? clamp(Depth.heroSink / 60, 0, 1.5) : 0;
    return 1 / (1 + sledKg() / L.sledPull * (1 + L.sledSink * sink));
  }
  function sledFits(m, v) { const L = LD(); return Inv.litOf(sled()) + v * L.bulk <= L.sledL + 1e-6 && Inv.kgOf(sled()) + m <= L.sledKg + 1e-6; }
  const PILE = () => ({ x: HUT.x + 150, y: HUT.y + 86 });   // поленница у избы: справа от двери, под открытым небом
  const sheds = () => (G.col ? G.col.builds.filter(b => b.done && b.type === 'woodshed').length : 0);
  const pileCap = () => LD().pileL + LD().shedL * sheds();
  const pileFits = v => Inv.wl(G.chest) * LD().bulk + v * LD().bulk <= pileCap() + 1e-6;

  // ---------- вещи на снегу ----------
  function drop(it, n, x, y, o = {}) {
    G.loose = G.loose || []; if (G.loose.length > 60) G.loose.shift();
    const q = Object.assign({ id: (G.looseN = (G.looseN || 0) + 1), it, n: n || 1, x: Math.round(x), y: Math.round(y), t: G.time, a: +rnd(-0.6, 0.6).toFixed(2) }, o);
    G.loose.push(q); return q;
  }
  // туша: падает с отлётом (vx, vy — тело скользит ~0.5 с), лежит, пока не разделают; разделанная — кости, заметает
  function carcass(kind, x, y, vx = 0, vy = 0) {
    G.carcs = G.carcs || [];
    const c = { id: (G.carcN = (G.carcN || 0) + 1), kind, x: Math.round(x), y: Math.round(y), t0: G.time, vx: Math.round(vx), vy: Math.round(vy), sk: 0, m: 0 };
    G.carcs.push(c); if (kind !== 'hare') ArtWorld.fx.blood(G.parts, x, y, G.decals = G.decals || []); return c;
  }
  const BK = () => TUNE.butcher;
  // насколько туша заметена 0..1 (разделанная — за fade суток, целая — за 2·fade)
  const carcFade = c => c.done != null ? (G.time - c.done) / (CYCLE * BK().fade) : (G.time - c.t0) / (CYCLE * BK().fade * 2);
  // ствол волоком: комель — у руки за спиной, вершина тянется следом (как верёвка: длина та же), в плане вид 3/4 (y × 0.6)
  function dragTick() {
    const Lg = dragL(), p = P(); if (!Lg) { if (G.hand && G.hand.drag != null) G.hand.drag = null; return; }
    const len = (typeof Tree !== 'undefined' && Lg.sk != null ? (Lg.zTop - Lg.hc) * Lg.k * Tree.M : Lg.len * Actions.logK(Lg));
    const tip = { x: Lg.x + Math.cos(Lg.a) * len, y: (Lg.y + Math.sin(Lg.a) * len * 0.6) / 0.6 }, hx = p.x, hy = (p.y + 2) / 0.6;
    let dx = tip.x - hx, dy = tip.y - hy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const bx = hx + dx * 12, by = hy + dy * 12;   // комель — в 12 px за рукой
    Lg.x = Math.round(bx * 10) / 10; Lg.y = Math.round(by * 0.6 * 10) / 10; Lg.a = +Math.atan2(dy, dx).toFixed(4);
  }
  function tick(dt) {
    if (G.hand && G.hand.drag != null) dragTick();
    // рюкзак снят, а процесса нет: пошёл — подхватил на ходу; стоит — затянуть и надеть (удержание E — ждёт следующую вещь)
    if (off()) {
      const p = P(), a = p.action, mine = a && a.k === 'job' && a.j === 'carry';
      if (p.moving || p.dash || p.ko || p.sleeping || p.ride) { if (!mine) grab(); }
      else if (!a) { G.hand.offT = (G.hand.offT || 0) + dt; if (G.hand.offT > (input.act ? 0.6 : 0.12)) { G.hand.offT = 0; closeDon([]); } }
      else G.hand.offT = 0;
    }
    if (G.carcs) for (let i = G.carcs.length - 1; i >= 0; i--) {
      const c = G.carcs[i];
      if (c.vx || c.vy) { const e = Math.exp(-dt * 7); c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= e; c.vy *= e; if (Math.hypot(c.vx, c.vy) < 4) { c.vx = 0; c.vy = 0; c.x = Math.round(c.x); c.y = Math.round(c.y); } }
      if (carcFade(c) >= 1) G.carcs.splice(i, 1);
    }
  }
  const STEPS = c => { const B = BK()[c.kind] || BK().wolf, out = []; if (B.skin && !c.sk) out.push(['skin', B.skin]); for (let i = c.m; i < B.meat.length; i++) out.push(['meat', B.meat[i], i]); return out; };
  const SKIN = { wolf: 'wpelt', wolfLeader: 'wpelt', hare: 'hare' };

  // ---------- процессы ----------
  const K = () => Actions.jobs, D = () => ArtPeople.DUR;
  // касание не раньше 0,32 с от начала (лёгкая вещь — короткий процесс, но рука сперва дотягивается): c0 — задуманная доля позы
  const job = (s, o) => { if (o.at && o.at.length === 1 && o.dur) { o.c0 = o.at[0]; o.at = [Math.min(0.85, Math.max(o.c0, 0.32 / o.dur))]; } return K().job('carry', s, o); };
  const P = () => G.p;
  const reach = (o, r = 60) => dist2(o, P()) < r * r;
  const at0 = o => ({ x: o.x, y: o.y });
  // взять: src — откуда (часть, вещь на снегу, нарты, поленница, лабаз, лампа, сэвэки, банка/палка, улов ловушки, заяц); Q — что дальше
  const GRAB = {
    part(a) { const i = (G.chunks || []).indexOf(a.o); if (i < 0) return false; G.chunks.splice(i, 1); delete a.o.fx; delete a.o.fy; if (isWoodP(a.o) && !a.o.got) { a.o.got = 1; G.stats.wood++; } parts().push(a.o); Sound.pick(); return true; },
    sled(a) { const r = Inv.pull(sled(), 'wood', 1); if (!r.n) return false; parts().push(partOf(r)); Sound.pick(); return true; },
    pile(a) { const r = Inv.pull(G.chest, 'wood', 1); if (!r.n) return false; parts().push(partOf(r)); Sound.pick(); return true; },
    sledIt(a) { if (thing() || !Inv.pull(sled(), a.id, 1).n) return false; hand().t = { id: a.id, n: 1 }; Sound.pick(); return true; },
    loose(a) {
      const i = (G.loose || []).indexOf(a.o); if (i < 0) return false; const q = a.o, t = thing();
      if (t && !(t.id === q.it && ITEMS[q.it])) return false;
      G.loose.splice(i, 1); if (t) { t.n = (t.n || 1) + q.n; if (q.kg != null) t.kg = (t.kg != null ? t.kg : ITEMS[t.id].kg) + q.kg; } else hand().t = { id: q.it, n: q.n, kg: q.kg };
      Sound.pick(); return true;
    },
    labaz() { if (G.labaz) return false; G.labaz = 1; G.notes.labaz = 1; hand().t = { id: 'meat', n: 2 }; Sound.pick(); return true; },
    tube() { if (G.flags.tube) return false; G.flags.tube = 1; hand().t = { id: 'tube', n: 1 }; Fx.toast(':tube: Радиолампа Гоши'); Sound.ok2(); return true; },
    amulet(a) { if (a.o.got) return false; a.o.got = 1; G.amulets++; Fx.toast(`:sevek: Сэвэки ${G.amulets}/12`); Sound.ok2(); Quests.check('amulets'); hand().t = { id: 'amulet', n: 1 }; return true; },
    litter(a) { const i = (G.litter || []).indexOf(a.o); if (i < 0) return false; G.litter.splice(i, 1); hand().t = { id: a.o.k === 'stick' ? 'stick' : 'canE', n: 1 }; Sound.pick(); return true; },
    trapc(a) {
      const t = a.o, c = t.catch; if (!c || !G.traps.includes(t)) return false;
      t.catch = null; t.t = G.time; Hero.xp('hunt'); Sound.pick();
      hand().t = c === 'hare' ? { id: 'carc', kind: 'hare', kg: 2.5, n: 1 } : { id: c, n: 1 }; return true;
    },
    hare(a) {
      const h = a.o; if (!G.hares.includes(h) || !reach(h, TUNE.act.hareR + 16)) return false;
      G.hares.splice(G.hares.indexOf(h), 1); G.stats.hares++; Hero.xp('hunt'); Fx.burst(h.x, h.y - 6, 6, '#ffffff'); Sound.pick();
      hand().t = { id: 'carc', kind: 'hare', kg: 2.5, n: 1 }; return true;
    },
  };
  const PICK_TH = { part: -2, loose: -1, sled: -10, sledIt: -10, pile: -14, labaz: -30, tube: -2, amulet: -2, litter: -1, trapc: -2, hare: -2 };
  function pick(src, o, Q, tg) {
    const p = P(); if (p.ride || p.sleeping) return false;
    const w = tg || (src === 'sled' || src === 'sledIt' ? sledPt() : src === 'pile' ? PILE() : src === 'labaz' ? { x: POI.labaz.x - 8, y: POI.labaz.y } : src === 'tube' ? TUBE_POS : at0(o));
    K().faceTo(w); p.cd = Math.max(p.cd, 0.1);
    const kg = srcKg(src, o);
    job('pick', { dur: dur('pick', kg), kg, pose: 'pickKeep', tg: { x: w.x, y: w.y }, th: PICK_TH[src] || -2, o: o || null, src, at: [0.34], Q: Q || [], fb: 'pickUp' });
    return true;
  }
  // масса того, что берут (для позы и длительности)
  function srcKg(src, o) {
    if (src === 'part' && o) return o.mass || 0;
    if (src === 'loose' && o) return o.kg != null ? o.kg : ITEMS[o.it] ? ITEMS[o.it].kg * (o.n || 1) : 0.3;
    if (src === 'sled' || src === 'pile') { const c = src === 'pile' ? G.chest : sled(); return c.wood > 0 ? Inv.wkg(c) / c.wood : LD().woodKg; }
    if (src === 'labaz') return 2; if (src === 'hare' || src === 'trapc') return 2.5;
    return 0.3;
  }
  // убрать то, что в руках, в рюкзак: мелочь — в поясной карман (не снимая), остальное — снять рюкзак → внутрь/снаружи → надеть
  // что из рук уходит в рюкзак первым: { t | q, at: 'in' | 'out' | 'pocket', kg } | null
  function stowPlan() {
    const t = thing();
    if (t) { if (t.id === 'carc') return null; if (NOINV[t.id]) return { t, at: off() ? 'in' : 'pocket', kg: tKg(t) }; const f = Inv.fits(t.id, t.n || 1); return f.ok ? { t, at: f.at, kg: tKg(t) } : null; }
    for (const q of parts()) if (isWoodP(q)) { const f = Inv.fits('wood', 1, q.mass, (q.vol || 0) * 1000, q.len); if (f.ok) return { q, at: f.at, kg: q.mass }; }
    return null;
  }
  // всё, что по отдельности влезло бы (подписи)
  function stowable() {
    const t = thing(), out = [];
    if (t && (NOINV[t.id] || t.id === 'carc' || Inv.fits(t.id, t.n || 1).ok)) out.push(t);
    for (const q of parts()) if (isWoodP(q) && Inv.fits('wood', 1, q.mass, (q.vol || 0) * 1000, q.len).ok) out.push(q);
    return out;
  }
  const small = t => t && (NOINV[t.id] || tL(t) <= LD().pocketL);
  // почему не кладётся (первое в руках): иконка + причина + куда ещё
  function why() {
    const t = thing(), q = parts().find(isWoodP) || parts()[0];
    const f = t ? Inv.fits(t.id, t.n || 1) : q && isWoodP(q) ? Inv.fits('wood', 1, q.mass, (q.vol || 0) * 1000, q.len) : { why: 'len' };
    const W = { l: ':pack: полон' + (q ? ` · :wood: снаружи ${Inv.packOut()}/${LD().packWood}` : ''), kg: ':weight: тяжело · рюкзак ' + Math.round(packKg()) + '/' + LD().packMax + ' кг', piece: ':wood: тяжёлое полено', len: ':wood: длинное' };
    return { why: f.why || 'l', txt: W[f.why] || W.l, alt: (parts().length ? ' → :hand: в охапке' : ' → X — на снег') + (hasSled() ? ' · :sled: на нарты' : '') };
  }
  function refuse() {
    const w = why(), p = P(); Fx.toast(w.txt + w.alt); Fx.floatText(p.x, p.y - 58, w.txt.split(' · ')[0]);
    if (parts().length && !G.flags.tipArms) { G.flags.tipArms = 1; setTimeout(() => Fx.toast(':hand: Дрова носят охапкой — до ' + LD().armsN + ' шт · E у чурок · больше — нарты'), 1400); }
    return false;
  }
  function stow(Q) {
    const t = thing();
    if (t && t.id === 'carc') return lay(Q);
    if (!busy() || G.hand.drag != null) return false;
    if (t && small(t) && !parts().length && !off()) { job('pocket', { dur: dur('pocket', tKg(t)), kg: tKg(t), pose: 'packPut', at: [0.55], Q: Q || [], fb: 'idle' }); return true; }
    if (!stowPlan()) return refuse();
    if (off()) return stowStep(Q || []);
    const pk = packKg(); job('doff', { dur: dur('doff', pk), kg: pk, pose: 'packDoff', tg: packSpot(), th: -3, at: [0.84], Q: Q || [], fb: 'idle' });
    return true;
  }
  // куда ставит рюкзак: на снег перед собой (снят — где стоит)
  const packSpot = () => { const o = off(), p = P(); return o ? { x: o.x, y: o.y } : { x: Math.round(p.x + p.face * 13), y: Math.round(p.y + 3) }; };
  // одна вещь из рук — внутрь сверху или под ремни снаружи (рюкзак снят и развязан)
  function stowStep(Q) {
    const s = stowPlan(); if (!s) return closeDon(Q);
    const out = s.at === 'out';
    // внутрь — клапан открыт; снаружи — на закрытый клапан под его ремни
    if (!out && !off().open) return job('open', { dur: dur('open', 1), kg: 1, pose: 'packOpen', tg: packSpot(), th: -3, at: [0.6], Q, fb: 'idle' }), true;
    if (out && off().open) return job('close', { dur: dur('close', 1), kg: 1, pose: 'packTie', tg: packSpot(), th: -3, at: [0.7], Q, fb: 'idle' }), true;
    job(out ? 'lash' : 'stow', { dur: dur(out ? 'lash' : 'stow', s.kg), kg: s.kg, pose: out ? 'packLash' : 'packIn', tg: packSpot(), th: -3, at: [out ? 0.5 : 0.55], Q, fb: 'idle' });
    return true;
  }
  // затянуть → надеть (две лямки); потом — дальше по очереди
  function closeDon(Q) {
    if (!off()) return run(Q || []);
    if (off().open) return job('close', { dur: dur('close', 1), kg: 1, pose: 'packTie', tg: packSpot(), th: -3, at: [0.7], Q: Q || [], fb: 'idle' }), true;
    const pk = packKg(); job('don', { dur: dur('don', pk), kg: pk, pose: 'packDon', tg: packSpot(), th: -3, at: [0.84], Q: Q || [], fb: 'idle' });
    return true;
  }
  // прервали со снятым рюкзаком — подхватил за лямку и надел на ходу (рисунок доводит G.hand.sl за ~0,6 с)
  function grab() { const o = off(), p = P(); if (!o) return; G.hand.off = null; G.hand.sl = { t: G.time, x: o.x - p.x, y: o.y - p.y }; Sound.thud && Sound.thud(0.12, 1); }
  // положить из рук: dst — 'sled' | 'pile' | 'ground' | 'carc' (тушку на снег); all — всё по одной
  function put(dst, Q, all = 1) {
    if (!busy()) return false;
    const w = dst === 'sled' ? sledPt() : dst === 'pile' ? PILE() : { x: P().x + P().face * 16, y: P().y + 4 };
    K().faceTo(w);
    const q = parts()[parts().length - 1], kg = q ? q.mass : tKg(thing());
    job('put', { dur: dur('put', kg), kg, pose: 'putKeep', tg: { x: w.x, y: w.y }, th: dst === 'pile' ? -10 : dst === 'sled' ? -8 : -1, dst, all, at: [0.55], Q: Q || [], fb: 'build' });
    return true;
  }
  const lay = Q => put('carc', Q, 0);
  // взяться за комель: наклон к концу ствола → в касание — хват (ствол волоком); отпустить — наклон, ствол лёг
  function dragStart(Lg) {
    if (busy() || !Lg || Lg.n <= 0 || Lg.f) return false;
    const w = { x: Lg.x, y: Lg.y }; K().faceTo(w);
    K().jobAt(Lg.x - Math.cos(Lg.a) * 14, Lg.y - Math.sin(Lg.a) * 8 + 2, () => { K().faceTo(w); job('grip', { dur: LD().t.pick, pose: 'pickKeep', tg: w, th: -2, o: Lg, at: [0.34], Q: [], fb: 'pickUp' }); }, 4);
    return true;
  }
  function dragStop() { const Lg = dragL(); if (!Lg) return false; job('release', { dur: LD().t.put, pose: 'putKeep', tg: { x: Lg.x, y: Lg.y }, th: -1, o: Lg, at: [0.55], Q: [], fb: 'build' }); return true; }
  // бросить ношу разом (перед дракой): охапка падает к ногам
  function dropAll(Q) { if (!busy()) return false; job('drop', { dur: LD().t.drop, pose: 'putKeep', tg: { x: P().x + P().face * 12, y: P().y + 4 }, th: 0, at: [0.55], Q: Q || [], fb: 'idle' }); return true; }
  // разделать тушу: к боку туши своими ногами, затем шаги ножом
  function butcher(c, Q) {
    if (!c || !G.carcs.includes(c) || c.done != null) return false;
    const st = STEPS(c); if (!st.length) return false;
    const p = P(), sd = Math.sign(p.x - c.x) || -p.face, q = { x: c.x + sd * 18, y: c.y + 3 };
    K().jobAt(q.x, q.y, () => { G.p.face = -sd; cutStep(c, Q); }, 3);
    return true;
  }
  function cutStep(c, Q) {
    const st = STEPS(c)[0]; if (!st) return false;
    job('cut', { dur: st[1], pose: 'butcher', loop: 1, tg: at0(c), th: -2, o: c, part: st[0], i: st[2], Q: Q || [], fb: 'crouch', at: [0.3, 0.7] });
    return true;
  }
  // достать из рюкзака/лабаза в руку (еда, дрова из рюкзака): потом — Q
  function get(id, from, Q) {
    if (busy()) return false;
    const tg = from === 'chest' ? SPOT.chest : null; if (tg) K().faceTo(tg);
    job('get', { dur: dur('get', ITEMS[id] ? ITEMS[id].kg : 1), pose: from === 'chest' ? 'open' : 'packGet', tg: tg ? at0(tg) : null, th: -10, id, from, at: [0.55], Q: Q || [], fb: 'idle' });
    return true;
  }
  // нарты → поленница: взять с нарт → положить в поленницу, пока есть дрова и место
  function unload() {
    if (!hasSled() || !(sled().wood > 0) || busy()) return false;
    const r = Inv.wkg(sled()) / sled().wood / LD().rho * 1000;
    if (!pileFits(r)) { Fx.toast(':wood: Поленница полна'); return false; }
    return pick('sled', null, [{ k: 'put', dst: 'pile' }, { k: 'unload' }]);
  }
  // очередь задач (цепочка шагов)
  const TASK = {
    stow: (t, Q) => stow(Q), don: (t, Q) => closeDon(Q), put: (t, Q) => put(t.dst, Q, t.all == null ? 1 : t.all), lay: (t, Q) => lay(Q), unload: () => unload(),
    pick: (t, Q) => { if (t.src === 'loose' && !(G.loose || []).includes(t.o)) return false; if (t.o && t.o.x != null && !reach(t.o, 90)) return false; return pick(t.src, t.o, Q); },
    butcher: (t, Q) => butcher(t.o, Q), eat: () => Actions.eatHand(), strike: t => Actions.strike(t.o, t.kind),
    wait: (t, Q) => { if (t.o) K().faceTo(t.o); job('wait', { dur: t.t || 0.8, pose: 'inspect', loop: 1, tg: t.o ? at0(t.o) : null, th: -2, Q, fb: 'idle' }); return true; },   // посмотреть (рыба бьётся на льду)
    loot: (t, Q) => { const q = (G.loose || []).filter(l => l.src === t.src && reach(l, 90)); return run(q.map(o => ({ k: 'pick', src: 'loose', o, then: 1 })).flatMap(x => [x, { k: 'stow' }]).concat(Q)); },
  };
  function run(Q) { Q = (Q || []).slice(); while (Q.length) { const t = Q.shift(); if (TASK[t.k] && TASK[t.k](t, Q)) return true; } return false; }

  const after = (a, extra) => run((extra || []).concat(a.Q || []));
  // в момент касания (JOB.carry.hit)
  function hit(a, i) {
    const p = P();
    if (a.s === 'pick') {
      if (a.got) return;
      if (!GRAB[a.src] || !GRAB[a.src](a)) { a.miss = 1; if (a.src === 'hare') Fx.floatText(p.x, p.y - 40, 'Ушёл!'); return K().abort(a); }
      a.got = 1; if (a.kg > 8) huff();
    } else if (a.s === 'grip') {
      if (!G.logs.includes(a.o) || a.o.n <= 0 || busy()) return K().abort(a);
      hand().drag = a.o.id; a.o.drag = 1; a.got = 1; Sound.thud && Sound.thud(0.15, 1);
    } else if (a.s === 'release') {
      if (a.o) delete a.o.drag; hand().drag = null; a.got = 1; Sound.thud && Sound.thud(0.3, 1); ArtWorld.fx.snowPuff(G.parts, a.o.x, a.o.y, 0.3);
    } else if (a.s === 'put' || a.s === 'drop') {
      const many = a.s === 'drop' ? parts().length + (thing() ? 1 : 0) : 1;
      for (let k = 0; k < many; k++) if (!putOne(a)) return k ? null : K().abort(a);
      a.got = 1;
    } else if (a.s === 'doff') {
      const w = packSpot(); G.hand.off = { x: w.x, y: w.y, f: p.face, open: 0 }; G.hand.sl = null; Sound.thud && Sound.thud(0.12 + 0.01 * a.kg, 1);
    } else if (a.s === 'open') { if (off()) off().open = 1; Sound.pick();
    } else if (a.s === 'close') { if (off()) off().open = 0; Sound.pick();
    } else if (a.s === 'don') { G.hand.off = null; G.hand.sl = null; a.got = 1; if (a.kg > 15) huff(); Sound.thud && Sound.thud(0.1, 1);
    } else if (a.s === 'stow' || a.s === 'lash' || a.s === 'pocket') {
      // в касание: рука с вещью в горловине (внутрь) / вещь под ремнём (снаружи) / в поясном кармане
      const s = a.s === 'pocket' ? (thing() ? { t: thing(), at: 'pocket' } : null) : off() ? stowPlan() : null;
      if (!s) return K().abort(a);
      if (s.t) { if (!NOINV[s.t.id]) Inv.add(s.t.id, s.t.n || 1); hand().t = null; }
      else { parts().splice(parts().indexOf(s.q), 1); Inv.add('wood', 1, s.q.mass, (s.q.vol || 0) * 1000); if (s.at === 'out') G.inv.wo = Math.min(G.inv.wood, Inv.outN(G.inv) + 1); }
      a.got = 1; a.put = s.at; Sound.pick();
    } else if (a.s === 'get') {
      const src = a.from === 'chest' ? G.chest : G.inv;
      if (a.id === 'wood') { const r = Inv.pull(src, 'wood', 1); if (!r.n) return K().abort(a); parts().push(partOf(r)); }
      else { if (!Inv.pull(src, a.id, 1).n) return K().abort(a); hand().t = { id: a.id, n: 1 }; }
      a.got = 1;
    } else if (a.s === 'cut') {
      // нож: надрез — пара капель на снег, усталость как удар
      for (let k = 0; k < 3; k++) G.parts.push({ type: 'dot', x: a.o.x + rnd(-5, 5), y: a.o.y - 3, vx: rnd(-30, 30), vy: rnd(-50, -20), g: 220, life: 0.35, max: 0.35, color: '#8b2920' });
      K().work(); Sound.tone && Sound.tone('triangle', 260 + i * 60, 180, 0.05, 0.03);
    }
  }
  // одна вещь из рук — туда, куда кладут (в касание)
  function putOne(a) {
    const p = P(), t = thing(), ps = parts();
    const spot = () => ({ x: a.tg.x + rnd(-5, 5), y: a.tg.y + rnd(-2, 3) });
    if (a.dst === 'carc') {
      if (!t || t.id !== 'carc') return false;
      const c = carcass(t.kind || 'hare', a.tg.x, a.tg.y); c.t0 = G.time - 1; hand().t = null; a.made = c; Sound.thud && Sound.thud(0.2, 1); return true;
    }
    if (a.dst === 'sled' || a.dst === 'pile') {
      const q = ps[ps.length - 1];
      if (!q) { if (a.dst === 'sled' && t && ITEMS[t.id] && sledFits(tKg(t), tL(t))) { Inv.put(sled(), t.id, t.n || 1); hand().t = null; Sound.pick(); return true; } return false; }
      const v = (q.vol || 0) * 1000;
      if (a.dst === 'sled' ? !sledFits(q.mass, v) : !pileFits(v) || !isWoodP(q)) { Fx.toast(a.dst === 'sled' ? ':sled: Нарты полны' : ':wood: Поленница полна'); return false; }
      ps.pop(); Inv.put(a.dst === 'sled' ? sled() : G.chest, 'wood', 1, q.mass, v); Sound.chop(); return true;
    }
    // на снег: часть — обратно в мир тем же объектом (масса, форма), вещь — на снег
    if (ps.length) {
      const q = ps.pop(), s = spot(); q.x = Math.round(s.x); q.y = Math.round(s.y); q.ang = +rnd(-0.7, 0.7).toFixed(2); q.t = G.time - 0.6; delete q.fx; delete q.fy;
      if (Ice.water(q.x, q.y)) { Ice.splash(q.x, q.y); } else (G.chunks = G.chunks || []).push(q); Sound.thud && Sound.thud(0.15, 1); return true;
    }
    if (t) {
      const s = spot();
      if (t.id === 'carc') { carcass(t.kind || 'hare', s.x, s.y).t0 = G.time - 1; }
      else if (t.id === 'stick') Actions.dropStick(s.x, s.y);
      else if (t.id === 'canE') { G.litter = G.litter || []; G.litter.push({ x: Math.round(s.x), y: Math.round(s.y), k: 'can', t: G.time, a: +rnd(0, 3).toFixed(2) }); }
      else if (ITEMS[t.id]) drop(t.id, t.n || 1, s.x, s.y, t.kg != null ? { kg: t.kg } : {});   // сэвэки — за пазуху (счётчик)
      hand().t = null; return true;
    }
    return false;
  }
  function tickJob(a) { }
  function end(a) {
    const p = P();
    if (a.s === 'pick') { if (!a.got) return; if (off() && !(a.Q || []).length && stowPlan()) return stow([]); return after(a); }
    if (a.s === 'put') {
      if (a.dst === 'carc') { if (a.made) return butcher(a.made, a.Q) || after(a); return after(a); }
      if (a.all && busy() && a.got && (a.dst !== 'sled' || parts().length || (thing() && ITEMS[thing().id])) && (a.dst !== 'pile' || parts().length)) return put(a.dst, a.Q, 1);
      return after(a);
    }
    if (a.s === 'drop' || a.s === 'grip' || a.s === 'release' || a.s === 'wait') return after(a);
    if (a.s === 'doff' || a.s === 'open') return off() ? stowStep(a.Q) : after(a);
    if (a.s === 'stow' || a.s === 'lash') {
      if (a.got && stowPlan()) return stowStep(a.Q);
      if (busy() && parts().length) { const w = why(); Fx.toast(':hand: Остальное — в охапке · ' + w.txt + (hasSled() ? ' · :sled: нарты' : '')); }
      // дальше по очереди ещё берут (с туши, из сугроба) — рюкзак остаётся снятым; иначе — затянуть и надеть
      if ((a.Q || []).some(t => t.k === 'pick' || t.k === 'loot')) return after(a);
      return closeDon(a.Q);
    }
    if (a.s === 'close') return stowPlan() ? stowStep(a.Q) : closeDon(a.Q);
    if (a.s === 'don') return after(a);
    if (a.s === 'pocket') return after(a);
    if (a.s === 'get') return after(a);
    if (a.s === 'cut') {
      const c = a.o; if (!G.carcs.includes(c)) return;
      const B = BK()[c.kind] || BK().wolf, sd = p.face, out = a.part === 'skin' ? SKIN[c.kind] : 'meat';
      if (a.part === 'skin') c.sk = 1; else c.m++;
      if (out) { const q = drop(out, 1, c.x - sd * rnd(10, 16), c.y + rnd(4, 9), { fx: c.x, fy: c.y - 4, src: c.id }); q.t = G.time; Sound.pick(); }
      if (a.part === 'meat' && c.kind !== 'hare') Hero.xp('hunt');
      if (STEPS(c).length) return cutStep(c, a.Q);
      c.done = G.time; Fx.floatText(c.x, c.y - 30, ':ok: разделано'); void B;
      return after(a, [{ k: 'loot', src: c.id }]);
    }
  }
  // прервали: что не ушло в работу — остаётся (вещь в руках — в руках; взятое из рюкзака — в руке)
  function cancel(a) { if (off()) grab(); }
  // выдох с усилием: пар у лица
  function huff() { const p = P(); for (let k = 0; k < 3; k++) G.parts.push({ type: 'breath', x: p.x + p.face * rnd(6, 10), y: p.y - rnd(30, 36), vx: p.face * rnd(6, 14), vy: rnd(-16, -8), life: 1.1, max: 1.1 }); }

  // ---------- контекст E ----------
  const nearPile = (p, r = 64) => !p.inside && dist2(PILE(), p) < r * r;
  const nearSled = (p, r = 62) => hasSled() && !p.inside && !p.ride && dist2(sledPt(), p) < r * r;
  // с ношей — куда её деть (раньше прочего: рядом нарты, поленница)
  function context(p) {
    if (p.ride) return null;
    if (off()) {
      const s = busy() && stowPlan();
      if (s) return { k: 'carry', what: 'stow', label: 'В рюкзак :pack:' + (s.at === 'out' ? ' · снаружи' : ''), soft: 1 };
      if (!busy() && (G.chunks || []).some(q => isWoodP(q) && dist2(q, p) < 46 * 46 && Inv.fits('wood', 1, q.mass, (q.vol || 0) * 1000, q.len).ok)) return null;   // рядом чурка влезет — взять (дальше — в рюкзак)
      return { k: 'carry', what: 'don', label: 'Надеть рюкзак :pack:' };
    }
    if (p.inside) return null;
    if (busy()) {
      if (woodN() && nearPile(p)) return { k: 'carry', what: 'pilePut', label: 'В поленницу :wood:' + woodN(), o: PILE() };
      return null;
    }
    if (nearPile(p) && hasSled() && sled().wood > 0) return { k: 'carry', what: 'unload', label: 'Нарты → поленница :wood:' + sled().wood, o: PILE() };
    if (nearPile(p, 56) && (G.chest.wood || 0) > 0) return { k: 'carry', what: 'pileTake', label: 'Взять из поленницы · ' + G.chest.wood, rep: 1, o: PILE() };
    return null;
  }
  // вещи на снегу и туши (рядом с чурками)
  function nearCtx(p) {
    if (p.inside || p.ride) return null;
    const q = (G.loose || []).filter(q => dist2(q, p) < 44 * 44 && !(q.fx != null && G.time - q.t < 0.5)).sort((a, b) => dist2(a, p) - dist2(b, p))[0];
    if (q && (!thing() || (thing().id === q.it && ITEMS[q.it])) && !parts().length) return { k: 'carry', what: 'loose', label: 'Взять ' + (ITEMS[q.it] ? ITEMS[q.it].i : '') + (q.n > 1 ? q.n : ''), o: q, rep: 1 };
    const c = (G.carcs || []).find(c => c.done == null && dist2(c, p) < 58 * 58 && !(G.time - c.t0 < 0.6));
    if (c && !busy()) return { k: 'carry', what: 'carc', label: 'Разделать ' + (c.kind === 'hare' ? ':hare:' : c.kind === 'bear' ? ':bear:' : ':wolf:'), o: c };
    return null;
  }
  // с ношей, когда больше нечего: в рюкзак (что влезет) или «руки полны»
  function stowCtx(p) {
    if (!busy() || p.ride) return null;
    if (G.hand.drag != null) return { k: 'carry', what: 'release', label: 'Отпустить ствол', soft: 1 };
    const t = thing();
    if (t && t.id === 'carc') return { k: 'carry', what: 'lay', label: 'Положить и разделать :hare:', soft: 1 };
    // нарты за спиной — когда рядом нет своего места (костёр, куча, печь, поленница — раньше) и больше не взять
    if (nearSled(p) && (parts().length || (t && ITEMS[t.id])) && (!t || sledFits(tKg(t), tL(t)))) return { k: 'carry', what: 'sledPut', label: 'На нарты :sled:', o: sledPt() };
    const s = stowPlan();
    if (s) return { k: 'carry', what: 'stow', label: 'В рюкзак :pack:' + (s.at === 'out' ? ' · снаружи' : s.at === 'pocket' ? ' · карман' : ''), soft: 1 };
    const w = why(); return { k: 'carry', what: 'full', label: (parts().length ? `:hand: Охапка ${parts().length}/${LD().armsN} · ` : '') + w.txt.split(' · ')[0] + ' · X — положить', soft: 1 };
  }
  // с пустыми руками у нарт (лицом к ним): взять с нарт
  function sledCtx(p) {
    if (busy() || !nearSled(p, 46) || p.inside) return null;
    const s = sled(), sp = sledPt(); if (Math.sign(sp.x - p.x) !== p.face && Math.abs(sp.x - p.x) > 6) return null;
    if (s.wood > 0) return { k: 'carry', what: 'sledTake', label: 'С нарт :wood:' + s.wood, rep: 1, o: sp };
    const id = ITEM_ORDER.find(k => k !== 'wood' && (s[k] || 0) > 0); if (id) return { k: 'carry', what: 'sledTakeIt', label: 'С нарт ' + ITEMS[id].i, o: sp, id };
    return null;
  }
  function primary(c, silent) {
    const p = P();
    switch (c.what) {
      case 'pilePut': return K().jobAt(PILE().x - 26, PILE().y + 16, () => put('pile'), 4), true;
      case 'sledPut': return put('sled'), true;
      case 'unload': return K().jobAt(PILE().x - 26, PILE().y + 16, () => unload(), 4), true;
      case 'pileTake': return pick('pile', null, []), true;
      case 'sledTake': return pick('sled', null, []), true;
      case 'sledTakeIt': { const ok = pick('sledIt', null, [{ k: 'stow' }]); if (ok) G.p.action.id = c.id; return true; }
      case 'loose': return pick('loose', c.o, small({ id: c.o.it, n: c.o.n }) ? [{ k: 'stow' }] : [{ k: 'stow' }]), true;
      case 'carc': return butcher(c.o, []), true;
      case 'lay': return lay([]), true;
      case 'stow': return stow([]), true;
      case 'release': return dragStop(), true;
      case 'full': if (!silent) refuse(); p.cd = 0.4; return true;
      case 'don': return closeDon([]), true;
    }
    return false;
  }

  // ---------- отладка/проверки: мгновенно сложить в руки (тесты) ----------
  // для рисунка героя: что в руках + kg — масса того, с чем идёт работа (поза, усилие), pk — рюкзак, кг; null — ничего нет и не делает
  function art() {
    if (!G || !G.hand) return null;
    const a = G.p && G.p.action, kg = a && a.k === 'job' && a.j === 'carry' && a.kg != null ? a.kg : busy() ? kg0() : null;
    if (!busy() && kg == null) return null;
    const ps = parts(), t = thing(), cj = a && a.k === 'job' && a.j === 'carry' && a.at && a.c0, o = { kg: kg || 0, pk: +packKg().toFixed(2), c: cj ? a.at[0] : null, c0: cj ? a.c0 : null };
    if (!busy()) return Object.assign(o, { mode: null, n: 0 });
    if (G.hand.drag != null) return Object.assign(o, { mode: 'drag', n: 0 });
    return Object.assign(o, { mode: mode(), n: ps.length, top: ps.some(long), w: ps.map(q => Math.max(0.6, Math.min(1.6, (q.diam || 0.13) / 0.13))), k: t ? (t.id === 'carc' ? 'hare' : ART[t.id] || 'bundle') : null, kind: t && t.kind });
  }
  const kg0 = () => { const ps = parts(); return ps.length ? ps[ps.length - 1].mass || 0 : tKg(thing()); };

  // ---------- рисование: вещи на снегу, туши, поленница, груз нарт ----------
  function drawLoose(g, q) {
    const e = q.fx != null ? clamp((G.time - q.t) / 0.45, 0, 1) : 1, k = 1 - (1 - e) * (1 - e);
    const x = q.fx != null ? q.fx + (q.x - q.fx) * k : q.x, y = q.fx != null ? q.fy + (q.y - q.fy) * k - 6 * Math.sin(Math.PI * Math.min(1, e * 1.4)) * (1 - e) : q.y;
    g.save(); g.translate(x, y); g.rotate(q.a || 0);
    g.globalAlpha = 0.3; g.fillStyle = '#27394a'; g.beginPath(); g.ellipse(1, 1.5, 7, 2.2, 0, 0, 7); g.fill(); g.globalAlpha = 1;
    const it = q.it, el = (x0, y0, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x0, y0, rx, ry, 0, 0, 7); g.fill(); };
    if (it === 'meat' || it === 'dried') { g.fillStyle = it === 'dried' ? '#7c241c' : '#a8453a'; g.beginPath(); g.moveTo(-5, -3); g.lineTo(5, -4); g.lineTo(6, 1); g.lineTo(-4, 2); g.closePath(); g.fill(); el(3.5, -1.5, 1.6, 1.2, '#e8d6c0'); }
    else if (it === 'fish') { const L = clamp(5 + (q.kg || 1) * 1.6, 5, 16), fl = q.fx != null && G.time - q.t < 3 ? Math.sin(G.time * 22) * 0.25 * (1 - (G.time - q.t) / 3) : 0;
      g.rotate(fl); g.fillStyle = '#8fa3ad'; g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -L * 0.32, L * 0.7, 0); g.quadraticCurveTo(0, L * 0.32, -L, 0); g.fill(); g.beginPath(); g.moveTo(L * 0.6, 0); g.lineTo(L, -L * 0.25); g.lineTo(L, L * 0.25); g.closePath(); g.fill(); el(-L * 0.7, -0.6, 0.7, 0.7, '#1a1e24'); }
    else if (it === 'wpelt' || it === 'hare' || it === 'sable') { const c = it === 'wpelt' ? ['#8a8a84', '#5e5e58', 9, 4] : it === 'sable' ? ['#5a3a24', '#3a2416', 5, 2.4] : ['#e6e3dc', '#9c968a', 6, 2.8]; el(0, 0, c[2], c[3], c[1]); el(-0.4, -0.5, c[2] - 1, c[3] - 0.8, c[0]); g.strokeStyle = c[1]; g.lineWidth = 1.4; g.beginPath(); g.moveTo(c[2] - 1, 0); g.lineTo(c[2] + 4, 1.5); g.stroke(); }
    else if (it === 'scrap') { g.fillStyle = '#6d737c'; g.beginPath(); g.moveTo(-5, -3); g.lineTo(6, -4); g.lineTo(4.5, 3); g.lineTo(-4, 2.5); g.closePath(); g.fill(); }
    else if (it === 'can') { el(0, 0, 3.4, 2.6, '#c2c9d0'); el(0, -1.4, 3.2, 1.2, '#dde6ee'); }
    else { el(0, 0, 4.5, 3, '#8c7f60'); g.strokeStyle = '#4a3c2a'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(0, -3); g.lineTo(0, 3); g.stroke(); }
    const sn = clamp((G.time - q.t) / (CYCLE * 0.6), 0, 0.7); if (sn > 0.05) { g.globalAlpha = sn; el(0, -1.5, 5, 1.6, '#f3f7fb'); g.globalAlpha = 1; }
    g.restore();
  }
  function drawCarc(g, c) {
    const age = G.time - c.t0, fall = clamp(age / 0.5, 0, 1), f = clamp(carcFade(c), 0, 1);
    g.save(); g.globalAlpha = 1 - Math.max(0, f - 0.6) / 0.4;
    if (c.done != null) {   // кости и шкура снята: остов, красное пятно
      g.fillStyle = '#7c241c'; g.beginPath(); g.ellipse(c.x, c.y + 1, c.kind === 'bear' ? 20 : c.kind === 'hare' ? 7 : 13, c.kind === 'bear' ? 6 : 3, 0, 0, 7); g.fill();
      g.strokeStyle = '#e8e2d4'; g.lineWidth = 1.1; g.beginPath(); const L = c.kind === 'bear' ? 16 : c.kind === 'hare' ? 5 : 10; g.moveTo(c.x - L, c.y - 1); g.lineTo(c.x + L, c.y - 2);
      for (let i = -2; i <= 2; i++) { g.moveTo(c.x + i * L * 0.3, c.y - 1.5); g.lineTo(c.x + i * L * 0.3 + 1, c.y - 4.5); } g.stroke();
    } else {
      g.translate(c.x, c.y); g.scale(1, 0.55 + 0.45 * fall); g.translate(-c.x, -c.y);   // заваливается: тело оседает
      ArtAnimals.corpse(g, c.kind, c.x, c.y, Math.max(0, age));
      if (c.sk) { const a0 = g.globalAlpha; g.globalAlpha = a0 * 0.55; g.fillStyle = '#9a3a2c'; g.beginPath(); const K = c.kind === 'bear' ? 24 : c.kind === 'hare' ? 7 : 14; g.ellipse(c.x - 1, c.y - K * 0.32, K, K * 0.3, 0, 0, 7); g.fill(); g.globalAlpha = a0; }   // шкура снята: туша красная
    }
    g.restore();
  }
  // поленница: торцы чурок рядами под навесом-стрехой, снег сверху; сколько видно — от дров в запасе
  function drawPile(g) {
    const P0 = PILE(), n = G.chest.wood || 0, cap = Math.max(1, pileCap() / (LD().woodKg / LD().rho * 1000 * LD().bulk));
    const x0 = P0.x - 20, y0 = P0.y + 4;
    g.fillStyle = 'rgba(39,57,74,0.28)'; g.beginPath(); g.ellipse(P0.x + 2, y0 + 2, 26, 5, 0, 0, 7); g.fill();
    g.fillStyle = '#5b3d27'; g.fillRect(x0 - 2, y0 - 2, 3, 3); g.fillRect(x0 + 41, y0 - 2, 3, 3);   // подкладки
    const vis = Math.min(n, 40), per = 8;
    for (let i = 0; i < vis; i++) { const r = (i / per) | 0, c = i % per, x = x0 + 2 + c * 5.2 + (r % 2) * 2.4, y = y0 - 4 - r * 4.4;
      g.fillStyle = '#5b3d27'; g.beginPath(); g.ellipse(x, y, 2.6, 2.3, 0, 0, 7); g.fill(); g.fillStyle = (i * 7) % 3 ? '#e0b47a' : '#c79a62'; g.beginPath(); g.ellipse(x - 0.3, y, 1.9, 1.7, 0, 0, 7); g.fill(); }
    if (vis) { const top = y0 - 6 - (((vis - 1) / per) | 0) * 4.4; g.fillStyle = '#f3f7fb'; g.beginPath(); g.ellipse(x0 + 20, top - 1.5, 21, 2.2, 0, 0, 7); g.fill(); }
    // колья по краям
    g.strokeStyle = '#3a2618'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0 - 1, y0); g.lineTo(x0 - 1, y0 - 34); g.moveTo(x0 + 43, y0); g.lineTo(x0 + 43, y0 - 34); g.stroke();
    void cap;
  }
  function drawSledLoad(g, x, y, dir) {
    const s = sled(), n = Math.min(s.wood || 0, 18), other = ITEM_ORDER.filter(k => k !== 'wood' && (s[k] || 0) > 0);
    g.save(); g.translate(x, y); g.scale(dir < 0 ? -1 : 1, 1);
    for (let i = 0; i < n; i++) { const row = (i / 6) | 0, c = i % 6, cx = -17 + c * 6 + (row % 2) * 2.5, cy = -12 - row * 4.2;
      g.fillStyle = row % 2 ? '#5b3d27' : '#6b4c31'; g.fillRect(cx - 2.6, cy - 2.2, 5.2, 4.4); g.fillStyle = '#e0b47a'; g.beginPath(); g.ellipse(cx + 2.6, cy, 1.4, 2, 0, 0, 7); g.fill(); }
    let ox = 6; for (const k of other.slice(0, 3)) { g.fillStyle = k === 'meat' ? '#a8453a' : k === 'fish' ? '#8fa3ad' : k === 'wpelt' ? '#8a8a84' : '#8c7f60'; g.beginPath(); g.ellipse(ox, -12 - Math.ceil(n / 6) * 4.2, 4.5, 3, 0, 0, 7); g.fill(); ox -= 9; }
    if (n || other.length) { g.fillStyle = '#f3f7fb'; g.globalAlpha = 0.8; g.beginPath(); g.ellipse(-4, -14 - Math.ceil(n / 6) * 4.2, 12, 1.4, 0, 0, 7); g.fill(); g.globalAlpha = 1; }
    // увязка: верёвка поперёк
    if (n) { g.strokeStyle = '#2a2e34'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-9, -9); g.lineTo(-9, -14 - Math.ceil(n / 6) * 4.2); g.moveTo(6, -9); g.lineTo(6, -14 - Math.ceil(n / 6) * 4.2); g.stroke(); }
    g.restore();
  }

  return { hand, parts, thing, kg, count, busy, mode, speedMul, cantTake, FULL, woodN, takeWood, partOf, sled, hasSled, sledPt, sledKg, sledMul, sledFits, PILE, pileCap, pileFits,
    off, grab, closeDon, stowPlan, why, wt, dur, srcKg, packSpot,
    drop, carcass, carcFade, tick, pick, stow, put, lay, dropAll, butcher, get, unload, run, hit, end, cancel, tickJob, context, nearCtx, stowCtx, sledCtx, primary, art,
    drawLoose, drawCarc, drawPile, drawSledLoad, ART, NOINV, STEPS, isWoodP, dragL, dragStart, dragStop, logKg, dragMul };
})();
