#!/usr/bin/env node
// Вещи с массой и объёмом (js/inventory.js, js/carry.js). Детерминированно (сид), главный цикл на паузе, сценарии — тем же update().
//   cd tests && node items-check.js
//   1. масса сохраняется: дерево → части (= целое) → чурки в руки → рюкзак / нарты / поленница → печь (огонь = кг × secPerKg)
//   2. рюкзак не берёт сверх объёма/веса; дрова — внутрь по объёму (короткие), снаружи ещё packWood; остальное остаётся в руках
//   3. охапка занимает руки: не рубит, не бьёт, X — кладёт (не бросает палку), идёт медленнее
//   4. нарты возят: ёмкость по кг/л, груз тормозит, в глубоком снегу — сильнее; груз виден (G.sled)
//   5. сейв: руки/нарты/вещи на снегу/туши — туда-обратно; миграция старого сейва (числа «дрова» по 6 кг → вещи)
//   6. баланс ночи: кг и деревьев на ночь / сутки — до (v1.2.0, интеграция) и после; разумные пределы
//   7. случайные действия (есть, бросить еду, отдать, торговать, сейв/загрузка…): счётчики ≥ 0 (Inv.audit), вещи и масса сходятся
//   7. рюкзак — процесс: снять (на снег перед собой) → развязать → внутрь сверху / приторочить снаружи → затянуть → надеть; в касание рука
//      у горловины снятого рюкзака, вещь ни разу не за спиной; несколько вещей — снят один раз; нарисовано снаружи = приторочено; отказ с причиной
//   8. прерывания (пошёл, отскок, укус, другое дело) в каждой фазе: рюкзак на спине, масса цела, что в руках = что нарисовано; с охапкой не спит
//   9. вес: длительность подъёма/надевания и глубина приседа монотонно растут с массой; усталость замедляет
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => { out.push((c ? 'ok   ' : 'FAIL ') + w); return c; }, info = w => out.push('     ' + w);
  UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {}; Story.tick = () => {}; Weather.tick = () => {};
  UI.closePanel();   // окно лабаза держало главный цикл на паузе до входа; дальше — синхронно (RAF не вклинится), в конце откроем снова
  const DT = 1 / 60, f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2);
  function fresh(h = 11, seed = 5) {
    Math.random = mulberry(seed); newGame(); state = 'play'; G.chapter = 1; G.time = tAt(2, h); G.day = dayOf(); G.lastDawn = G.day;
    G.storm = null; G.wolves = []; G.bear = null; G.s.food = 100; G.s.warm = 100; G.s.hp = 1e6; input.mx = input.my = 0; input.act = false; Hero.bodyReset();
  }
  const at = (x, y, f) => { const p = G.p; p.x = x; p.y = y; if (f) p.face = f; p.inside = insideHut(x, y); p.lx = x; p.ly = y; Hero.snap(); };
  const run = (sec, until) => { for (let t = 0; t < sec; t += DT) { update(DT); now += DT; if (until && until()) return true; } return false; };
  const idle = () => !G.p.action && !Actions.busy();
  const wkgAll = () => Inv.wkg(G.inv) + Inv.wkg(G.sled) + Inv.wkg(G.chest) + Carry.parts().reduce((s, q) => s + q.mass, 0);

  // ---------- 1. масса: дерево → части → руки → места → печь ----------
  try {
    fresh(); G.gear.sled = 1;
    const t = G.trees.filter(t => t.wood > 0 && !t.wall && t.kind === 0 && t.stage !== 1 && !onIce(t.x + 40, t.y) && Math.abs(t.x - HUT.x) > 400).sort((a, b) => dist2(a, POI.cockpit) - dist2(b, POI.cockpit))[0];
    at(t.x + 60, t.y + 40, -1); const L = Actions.fell(t); run(4);
    for (let i = 0; i < 3 && Actions.logCut(L) < 1; i++) Tree.split(L, 'limb');
    while (L.n > 0) Tree.split(L, 'buck');
    const ps = G.chunks.filter(q => q.src === L.id), M = ps.reduce((s, q) => s + q.mass, 0), W = ps.filter(q => Tree.isWood(q) && !Carry.long(q)), Mw = W.reduce((s, q) => s + q.mass, 0);
    ok(Math.abs(M - L.m0) < L.m0 * 1e-3, `🌲 части = целое: ${f2(M)} кг из ${f2(L.m0)} (дров ${f2(Mw)} кг · ${W.length} шт, лапник ${f2(M - Mw)} кг)`);
    // каждую — процессом: подойти, взять в охапку; охапка полна — на нарты (нарты за спиной); 2 мелких — в рюкзак; остаток — в поленницу
    let n = 0, guard = 0;
    for (const q of W.slice().sort((a, b) => a.mass - b.mass)) {
      if (Carry.cantTake(q)) { at(G.p.x, G.p.y); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 4; Carry.put('sled', []); run(8, idle); }
      at(q.x - 22, q.y, 1); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 4; Carry.pick('part', q, []); run(3, idle); n += Carry.parts().includes(q) ? 1 : 0;
      if (n === 2 && guard++ === 0) { Carry.stow([]); run(12, idle); }
    }
    ok(!G.chunks.some(q => W.includes(q)), `🪵 все ${W.length} чурок подняты (руки ${Carry.parts().length}, рюкзак ${G.inv.wood || 0}, нарты ${G.sled.wood || 0})`);
    ok(Math.abs(wkgAll() - Mw) < 1e-3, `⚖️ руки + рюкзак + нарты + поленница = ${f2(wkgAll())} кг из ${f2(Mw)}`);
    ok(Inv.packL() <= TUNE.load.packL && Inv.packOut() <= TUNE.load.packWood, `🎒 дров в рюкзаке ${G.inv.wood || 0} (внутри ${Inv.packL()} л ≤ ${TUNE.load.packL}, снаружи ${Inv.packOut()} ≤ ${TUNE.load.packWood}), ${f2(Inv.wkg(G.inv))} кг`);
    // к избе: руки → поленница, нарты → поленница
    const P0 = Carry.PILE(); at(P0.x - 26, P0.y + 16, 1); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 8;
    if (Carry.busy()) { Carry.put('pile', []); run(10, idle); }
    Carry.unload(); run(60, () => idle() && !(G.sled.wood > 0));
    ok(!(G.sled.wood > 0) && !Carry.busy() && Math.abs(wkgAll() - Mw) < 1e-3, `🧱 поленница ${G.chest.wood} шт · ${f2(Inv.wkg(G.chest))} кг (рюкзак ${f2(Inv.wkg(G.inv))}) = ${f2(wkgAll())} из ${f2(Mw)}`);
    // в печь: огонь = кг × secPerKg; что сгорело + что осталось = дерево
    at(SPOT.stove.x + 20, SPOT.stove.y + 10, -1); G.hut.walls = 1; G.hut.fuel = 0; let burnt = 0, fuel = 0;
    for (let i = 0; i < 60 && (G.chest.wood || 0) + (G.inv.wood || 0) > 0; i++) { const before = wkgAll(), f0 = G.hut.fuel; if (!Stove.room()) { fuel += G.hut.fuel; G.hut.fuel = 0; continue; } Stove.add(); burnt += before - wkgAll(); fuel += G.hut.fuel - f0; G.hut.fuel = 0; }
    ok(Math.abs(burnt - Mw) < 1e-3 && Math.abs(fuel - burnt * Stove.secPerKg()) < 1, `🔥 в печь ${f2(burnt)} кг → ${gameDur(fuel)} огня (${f1(fuel / burnt / HOUR * 60)} мин/кг); дерево = ${f2(Mw)} кг`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 2. рюкзак: объём, вес, дрова ----------
  try {
    fresh(); at(HUT.x + 400, HUT.y + 300, 1); G.inv = { wpelt: 6 };   // 72 л
    ok(Inv.fits('wpelt', 1).ok === false && Inv.fits('can', 1).ok, `🎒 6 шкур = ${Inv.packL()} л: седьмая (12 л) не лезет, банка — лезет`);
    Carry.hand().t = { id: 'wpelt', n: 1 }; Carry.stow([]); run(4, idle);
    ok(Carry.thing() && Carry.thing().id === 'wpelt' && G.inv.wpelt === 6, '✋ не влезло — шкура осталась в руках, рюкзак тот же');
    G.inv = { battery: 4, kero: 2 }; Carry.hand().t = null;   // 32 + 6 = 38 кг
    ok(!Inv.fits('scrap', 3).ok && Inv.fits('scrap', 1).ok, `🎒 вес: ${Inv.packKg()} кг — ещё 3 кг не поднять (предел ${TUNE.load.packMax}), 1 кг — можно`);
    G.inv = {}; for (const m of [3, 3.2, 3.4]) Carry.parts().push(Carry.partOf({ kg: m, l: m / 0.79 }));
    Carry.stow([]); run(12, idle);
    ok(G.inv.wood === 3 && !Carry.parts().length && Inv.packOut() === 0, `🪵 дрова внутрь по объёму — ${G.inv.wood} из 3 (${Inv.packL()} л)`);
    Carry.hand().p = [Carry.partOf({ kg: 12, l: 15 })]; const w0 = G.inv.wood; Carry.stow([]); run(4, idle);
    ok(G.inv.wood === w0 && Carry.parts().length === 1, '🪵 комель 12 кг в рюкзак не кладут — в руках');
    Carry.hand().p = []; G.inv = { meat: 1 }; G.s.food = 40; Actions.eat(); const got = run(1.2, () => Carry.thing() && Carry.thing().id === 'meat');
    ok(got && !G.inv.meat, '🍖 еда: сначала из рюкзака в руку'); run(3, idle);
    ok(!Carry.busy() && G.s.food > 40, `🍖 съел: еда ${f1(G.s.food)}`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 3. охапка занимает руки ----------
  try {
    fresh(); const t = G.trees.filter(t => t.wood > 0 && !t.wall && t.stage !== 1 && Actions.chopSpot(t)).sort((a, b) => dist2(a, POI.cockpit) - dist2(b, POI.cockpit))[0];
    const q = Actions.chopSpot(t); at(q.x, q.y, Math.sign(t.x - q.x));
    const sp0 = Hero.speed(); for (let i = 0; i < 3; i++) Carry.parts().push(Carry.partOf({ kg: 5, l: 6.3 }));
    const sp1 = Hero.speed(); G.p.cd = 0; Actions.interact(false);
    ok(!G.p.action || G.p.action.k !== 'chop', '✋ с охапкой не рубит (E у дерева — убрать ношу, а не рубить)'); G.p.action = null; G.p.cd = 0;
    ok(Math.abs(sp1 / sp0 - TUNE.load.arms) < 0.01, `🚶 с охапкой ×${f2(sp1 / sp0)} (TUNE.load.arms)`);
    const w = Wolves.at(0, 120, { st: 'circle', hp: 3 }); w.x = G.p.x + 120; w.y = G.p.y; G.p.cd = 0; Actions.alt();
    ok(G.p.action && G.p.action.j === 'carry' && G.p.action.s === 'put', '✋ X с охапкой — положить на снег, палку не бросает');
    G.wolves = []; run(6, idle); ok(!Carry.busy() && G.chunks.length >= 3, `🪵 положил по одной: в руках ${Carry.count()}, на снегу ${G.chunks.length}`);
    ok(Carry.cantTake({ kind: 'chunk', mass: 5, len: 0.45, vol: 0.006 }) === null, '✋ руки свободны — можно брать');
    for (let i = 0; i < 4; i++) Carry.parts().push(Carry.partOf({ kg: 5, l: 6.3 }));
    ok(Carry.cantTake({ kind: 'chunk', mass: 5, len: 0.45, vol: 0.006 }) === 'n', `✋ охапка: не больше ${TUNE.load.armsN} шт`);
    Carry.hand().p = [Carry.partOf({ kg: 14, l: 18 }), Carry.partOf({ kg: 9, l: 11 })];
    ok(Carry.cantTake({ kind: 'chunk', mass: 5, len: 0.45, vol: 0.006 }) === 'kg', `✋ охапка: не тяжелее ${TUNE.load.armsKg} кг`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 4. нарты ----------
  try {
    fresh(); G.gear.sled = 1; at(HUT.x + 600, HUT.y + 500, 1);
    const sp0 = Hero.speed(); Inv.put(G.sled, 'wood', 20, 100, 126); const sp1 = Hero.speed();
    ok(sp1 < sp0 * 0.7 && sp1 > sp0 * 0.4, `🛷 100 кг на нартах: скорость ×${f2(sp1 / sp0)}`);
    const d = Object.getOwnPropertyDescriptor(Depth, 'heroSink'); Object.defineProperty(Depth, 'heroSink', { get: () => 60, configurable: true });
    const sp2 = Hero.speed() / Depth.heroMul(); Object.defineProperty(Depth, 'heroSink', d);
    ok(sp2 < sp1, `🛷 в глубоком снегу тяжелее: ×${f2(sp2 / sp0)} (полозья вязнут)`);
    ok(!Carry.sledFits(60, 60) && Carry.sledFits(40, 40), `🛷 ёмкость: ${TUNE.load.sledKg} кг / ${TUNE.load.sledL} л — +60 кг не лезет, +40 — да`);
    const t0 = G.s.tire = 0; input.mx = 1; run(30); input.mx = 0; const tA = G.s.tire; fresh(); G.gear.sled = 1; at(HUT.x + 600, HUT.y + 500, 1); G.s.tire = 0; input.mx = 1; run(30); input.mx = 0; const tB = G.s.tire;
    ok(tA > tB, `🛷 тянуть 100 кг утомляет: +${f2(tA - t0)} против +${f2(tB)} порожняком (за 30 с)`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 5. сейв и миграция ----------
  try {
    fresh(); G.gear.sled = 1; at(HUT.x + 500, HUT.y + 400, 1);
    Carry.parts().push(Carry.partOf({ kg: 4.4, l: 5.6 })); Inv.put(G.sled, 'wood', 3, 13.5); Inv.put(G.sled, 'meat', 2); Carry.drop('fish', 1, G.p.x + 20, G.p.y, { kg: 1.7 }); Carry.carcass('wolf', G.p.x - 40, G.p.y);
    const m0 = wkgAll(), js = SaveGame.snapshot(); SaveGame.load(js);
    ok(Math.abs(wkgAll() - m0) < 1e-6 && G.sled.meat === 2 && G.loose.length === 1 && G.carcs.length === 1 && Carry.parts().length === 1, `💾 руки, нарты, вещи на снегу, туши — туда-обратно (${f2(wkgAll())} кг)`);
    // старый сейв: в рюкзаке 20 «дров» (×6 кг) + остаток 3 кг, в лабазе 10; в поле, нарт нет
    const o = JSON.parse(js); o.inv = { wood: 20, can: 1 }; o.chest = { wood: 10 }; o.woodKg = 3; delete o.itemsV; delete o.hand; delete o.sled; delete o.loose; delete o.carcs; o.gear = {}; o.chunks = [];
    SaveGame.load(JSON.stringify(o));
    const onSnow = G.chunks.reduce((s, q) => s + q.mass, 0), tot = Inv.wkg(G.inv) + Inv.wkg(G.chest) + onSnow;
    ok(G.inv.wood <= TUNE.load.packWood && Math.abs(tot - (30 * 6 + 3)) < 0.05 && G.itemsV === 2, `💾 миграция: рюкзак ${G.inv.wood} шт · ${f1(Inv.wkg(G.inv))} кг, лабаз ${G.chest.wood} шт, на снегу ${G.chunks.length} чурок · ${f1(onSnow)} кг = ${f1(tot)} кг (было 30×6+3)`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 6. баланс ночи: кг и деревья ----------
  try {
    const trees = G.trees.filter(t => t.kind === 0 && !t.wall && t.stage !== 1).slice(0, 300).map(t => Tree.parts(t).filter(q => !q.fixed && Tree.isWood(q)).reduce((s, q) => s + q.mass, 0)).sort((a, b) => a - b);
    const tw = trees[trees.length >> 1], K = Tree.KG;
    const night = (o) => { fresh(19.2); Object.assign(G.hut, { walls: 1, door: 1, damper: 0 }, o); G.flags.stoveLit = 1; G.chest.wood = 0; G.chest.wkg = 0; at(SPOT.bed.x + 30, SPOT.bed.y + 10); G.p.inside = true;
      G.hut.fuel = 1e6; const f0 = G.hut.fuel; G.time = tAt(2, 19.02); for (let t = 0; hourOf() < 7 || hourOf() >= 19; t += 0.05) { update(0.05); if (t > CYCLE) break; } return (f0 - G.hut.fuel) / Stove.secPerKg(); };
    const day = (o) => { fresh(7); Object.assign(G.hut, { walls: 1, door: 1, damper: 0 }, o); G.flags.stoveLit = 1; at(SPOT.bed.x + 30, SPOT.bed.y + 10); G.p.inside = true; G.hut.fuel = 1e6; const f0 = G.hut.fuel; for (let t = 0; t < CYCLE; t += 0.05) update(0.05); return (f0 - G.hut.fuel) / Stove.secPerKg(); };
    const kW = night({}), kD = night({ damper: 1 }), dW = day({});
    // до: v1.2.0 — ель = 3 полена (wood0), полено = 1,75 ч (щели); интеграция (объёмное дерево) — полено = 6 кг дерева (Tree.KG); после — кг × secPerKg (= прежнее/6)
    const logs = kW / K;
    info(`ель (медиана): дров ${f1(tw)} кг · ${trees.length} деревьев в выборке`);
    info(`ночь 19→07, щели: ${f1(kW)} кг · заслонка ${f1(kD)} кг · сутки в избе (щели) ${f1(dW)} кг`);
    info(`деревьев на ночь: v1.2.0 ≈ ${f2(logs / 3)} · интеграция ≈ ${f2(logs * K / tw)} · сейчас ${f2(kW / tw)} (щели), ${f2(kD / tw)} (заслонка) · на сутки ${f2(dW / tw)}`);
    ok(kW / tw > 0.4 && kW / tw < 1.5, `🌲 ночь в утеплённой избе ≈ ${f2(kW / tw)} ели (${f1(kW)} кг; разумно: 0,4–1,5)`);
    ok(Math.abs(kW * Stove.secPerKg() - logs * Stove.secPerLog()) < 1, `🔥 кг и прежние «поленья» сходятся: ${f1(logs)} поленьев по ${K} кг`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }
  // ---------- 7а. «положить всё» в лабаз: рюкзак (своя масса дров) → лабаз с «номинальными» дровами — масса не теряется ----------
  try {
    fresh(); G.inv = {}; G.chest = { wood: 4 }; Inv.put(G.inv, 'wood', 2, 9.3); Inv.add('can', 2);
    const m0 = Inv.wkg(G.inv) + Inv.wkg(G.chest); at(SPOT.chest.x - 10, SPOT.chest.y);
    UI.openChest(); document.querySelector('#panel [data-all="put"]').click(); UI.closePanel();
    ok(Math.abs(Inv.wkg(G.chest) - m0) < 1e-3 && !G.inv.wood && !Inv.wkg(G.inv) && G.chest.wood === 6 && G.chest.can === 2 && !Inv.audit('положить всё').length,
      `📦 «Положить всё»: лабаз ${G.chest.wood} шт · ${f2(Inv.wkg(G.chest))} кг из ${f2(m0)}, банок ${G.chest.can}`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 7. случайные действия: ни один счётчик не < 0, вещи и масса сходятся ----------
  // есть (в т. ч. из лабаза), бросить еду на середине (шаг/отмена), убрать/положить/поднять, отдать Толяну, торговать,
  // «положить всё», сейв → загрузка. После каждого шага: Inv.audit() пуст; вещей = ожидаемо (съеденное — по скачку сытости);
  // дров (кг) по всем местам + руки + снег — неизменно. Три серии (сиды 4242, 77, 9001).
  for (const RS of [4242, 77, 9001]) try {
    fresh(9, 7); G.gear.sled = 1; Npc.ensure(); const R = mulberry(RS), rp = a => a[Math.floor(R() * a.length)];
    G.inv = {}; G.chest = {}; G.sled = {}; G.loose = []; G.chunks = []; G.stashes = [];
    for (const [k, v] of Object.entries({ can: 5, meat: 2, fish: 1, dried: 1, hare: 3, sable: 2, wpelt: 1, kero: 3, tea: 3, scrap: 3, cable: 1 })) Inv.add(k, v);
    for (const [k, v] of Object.entries({ can: 4, meat: 3, fish: 2, honey: 1 })) Inv.put(G.chest, k, v);
    Inv.put(G.inv, 'wood', 2, 9.3); G.chest.wood = 5; Inv.put(G.sled, 'wood', 3, 14.2);   // в лабазе — «номинальные» дрова (как от посёлка/старого сейва)
    const OUT = { x: HUT.x + 320, y: HUT.y + 300 }, INS = { x: SPOT.chest.x - 10, y: SPOT.chest.y };
    at(OUT.x, OUT.y, 1); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 4;
    const tally = () => {
      const o = {}, add = (c) => { for (const k in c) if (ITEMS[k] && k !== 'wood' && typeof c[k] === 'number') o[k] = (o[k] || 0) + c[k]; };
      add(G.inv); add(G.chest); add(G.sled); (G.stashes || []).forEach(s => add(s.inv || {}));
      const t = Carry.thing(); if (t && ITEMS[t.id]) o[t.id] = (o[t.id] || 0) + (t.n || 1);
      for (const q of G.loose || []) if (ITEMS[q.it]) o[q.it] = (o[q.it] || 0) + q.n;
      return o;
    };
    const foodOf = o => FOOD_KEYS.reduce((s, k) => s + (o[k] || 0), 0);
    const woodKg = () => wkgAll() + (G.chunks || []).filter(Tree.isWood).reduce((s, q) => s + q.mass, 0);
    const W0 = woodKg();
    let exp = tally(), eaten = 0, steps = 0, bad = null;
    // шаг мира: сытость скачком вверх — съеден кусок
    const go = (sec, until) => { for (let t = 0; t < sec; t += DT) { const f = G.s.food; update(DT); now += DT; if (G.s.food - f > 2) eaten++; if (until && until()) return; } };
    const verify = (op) => {
      if (bad) return;
      const a = Inv.audit('items-check ' + op), now1 = tally();
      const nonFood = Object.keys(Object.assign({}, exp, now1)).filter(k => !FOOD_KEYS.includes(k)).filter(k => (now1[k] || 0) !== (exp[k] || 0));
      const fd = foodOf(exp) - eaten - foodOf(now1), dw = woodKg() - W0;
      if (a.length || nonFood.length || fd !== 0 || Math.abs(dw) > 1e-3 || !isFinite(Inv.weight()))
        bad = `шаг ${steps} «${op}»: ${a.join(' ')} ${nonFood.map(k => `${k} ${exp[k] || 0}→${now1[k] || 0}`).join(' ')} ${fd ? `еда разошлась на ${fd} (съедено ${eaten})` : ''} ${Math.abs(dw) > 1e-3 ? `дрова ${f2(dw)} кг` : ''}`;
    };
    const rebase = () => { exp = tally(); eaten = 0; };
    const trades = Object.keys(NPCS).filter(id => NPCS[id].trade && Npc.state(id)).flatMap(id => NPCS[id].trade.goods.filter(g => !g.gear && !g.set && !g.ops && g.out).map(g => [id, g]));
    const used = {};
    const OPS = {
      eat() { G.s.food = 30 + R() * 15; Actions.eat(); go(R() * 3.5); },
      eatLabaz() { at(INS.x, INS.y); G.s.food = 30 + R() * 15; Actions.eat(); go(R() * 4); },
      cancel() { if (G.p.action) { G.p.action = null; input.auto = 0; } go(0.1); },
      walk() { input.mx = rp([-1, 1]); go(0.3); input.mx = 0; go(0.05); },
      finish() { go(8, idle); },
      stow() { if (Carry.thing()) Carry.stow([]); go(R() * 4); },
      drop() { if (Carry.thing() && !Carry.parts().length) Carry.put('ground', []); go(R() * 2); },
      pickup() { const q = (G.loose || []).find(q => dist2(q, G.p) < 80 * 80); if (q && !Carry.busy()) { Carry.pick('loose', q, [{ k: 'stow' }]); go(R() * 4); } },
      out() { at(OUT.x + rp([-40, 0, 40]), OUT.y, 1); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 4; go(0.1); },
      // Толян: «две банки есть?» — как в диалоге: отдать можно, если есть (руки + рюкзак)
      give() { G.flags.tolyAsked = 1; G.flags.stashKnown = 0; go(0.05); if (Inv.cnt('can', false) < 2) return; verify('перед отдачей'); const c0 = tally().can || 0; Quests.complete('toly_stash'); const c1 = tally().can || 0; if (c0 - c1 !== 2 && !bad) bad = `шаг ${steps} «отдать Толяну»: банок ${c0}→${c1}`; exp.can -= 2; },
      trade() {
        const [id, g] = rp(trades), st = Npc.state(id); st.stock = st.stock || {}; st.stock[g.id] = 3;
        verify('перед торгом'); const v0 = Npc.furTotal(id), ok1 = Npc.buy(g, id), v1 = Npc.furTotal(id);
        if (ok1 && !(v0 - v1 >= Npc.price(g, id)) && !bad) bad = `шаг ${steps} «торг ${id}/${g.id}»: валюты ${v0}→${v1}, цена ${Npc.price(g, id)}`;
        if (ok1) used[id + '/' + g.id] = 1;
        // покупка меняет вещи по правилам торга — сверка дальше от нового состояния (минус — ловит audit)
        if (!Inv.audit('торг').length) rebase();
      },
      putAll() { at(INS.x, INS.y); UI.openChest(); const b = document.querySelector('#panel [data-all="put"]'); if (b) b.click(); UI.closePanel(); go(0.05); },
      takeChest() { at(INS.x, INS.y); UI.openChest(); const bs = [...document.querySelectorAll('#panel [data-take]')].filter(b => !b.disabled); if (bs.length) rp(bs).click(); UI.closePanel(); go(0.05); },
      save() { const t0 = tally(), w0 = woodKg(), a0 = G.p.action; SaveGame.load(SaveGame.snapshot()); const t1 = tally(); const diff = Object.keys(Object.assign({}, t0, t1)).filter(k => (t0[k] || 0) !== (t1[k] || 0));
        if ((diff.length || Math.abs(woodKg() - w0) > 1e-6) && !bad) bad = `шаг ${steps} «сейв→загрузка»: ${diff.map(k => `${k} ${t0[k]}→${t1[k]}`).join(' ')} дрова ${f2(w0)}→${f2(woodKg())}`; void a0; go(0.05); },
    };
    const W = { eat: 5, eatLabaz: 2, cancel: 4, walk: 2, finish: 2, stow: 2, drop: 2, pickup: 2, out: 2, give: 2, trade: 3, putAll: 1, takeChest: 2, save: 3 };
    const bag = Object.entries(W).flatMap(([k, n]) => Array(n).fill(k)), seen = {};
    for (steps = 0; steps < 220 && !bad; steps++) {
      if (foodOf(tally()) < 3) { Inv.put(G.chest, 'can', 3); Inv.add('meat', 2); rebase(); }   // подкинуть еды
      if (Inv.cnt('hare', false) + Inv.cnt('sable', false) < 2) { Inv.add('hare', 2); Inv.add('kero', 1); Inv.add('tea', 2); rebase(); }
      const op = rp(bag); seen[op] = (seen[op] || 0) + 1; G.s.hp = 1e6; G.s.warm = 100;
      OPS[op](); verify(op);
    }
    go(10, idle); verify('конец');
    const neg = Inv.audit('конец');
    ok(!bad && !neg.length, (bad ? `🎲 сид ${RS}: ` + bad : '') || `🎲 сид ${RS}: ${steps} случайных шагов (${Object.entries(seen).map(([k, v]) => k + '×' + v).join(' ')}; сделок ${Object.keys(used).length}): счётчики ≥ 0, вещи и ${f2(W0)} кг дров сходятся`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 7. рюкзак: процесс «снять → внутрь/снаружи → надеть», видимое = фактическое, отказ с причиной ----------
  // рисунок героя снимаем с настоящего кадра (GFX.render): после ArtPeople.draw героя — что в руках, снят ли рюкзак, сколько чурок снаружи
  let SNAP = null; const D0 = ArtPeople.draw;
  ArtPeople.draw = function (g, o) {
    const r = D0.apply(this, arguments);
    if (o && o.key === G.p) { const Q = ArtPeople.H.P, d = ArtPeople.dbg; SNAP = { anim: o.anim, a: o.animT, pko: Q.pko ? Object.assign({}, Q.pko) : null, held: Q.held ? Q.held.slice() : null, lon: Q.lo ? Q.lon : 0, lsh: Q.lsh, h0: [Q.h0x, Q.h0y], sx: Q.sx, hx: Q.hx, logs: d.logs, off: d.off, fill: d.fill, Hb: ArtPeople.H.pack().Hb }; }
    return r;
  };
  const frame = () => { SNAP = null; update(DT); now += DT; GFX.lookAt(G.p.x, G.p.y); GFX.render(DT, null); return SNAP || {}; };
  const PACK = ['doff', 'open', 'stow', 'lash', 'close', 'don'];
  const toasts = []; const T0 = Fx.toast; Fx.toast = m => { toasts.push(m); };
  const chunk = kg => Carry.partOf({ kg, l: kg / 0.79 });
  const field = () => { fresh(12, 7); at(HUT.x + 420, HUT.y + 260, 1); G.chunks = []; G.logs = []; G.hares = []; if (G.col) for (const u of G.col.units) u.hidden = true; };
  // прогон процесса: шаги, кадры
  function film(sec, each) {
    const seq = []; let i = 0, la = null;
    for (; i < sec * 60; i++) { const a = G.p.action, s = a && a.j === 'carry' ? a.s : null; if (s && a !== la) seq.push(s); la = a; const S = frame(); if (each) each(S, s, a); if (!G.p.action && !Carry.off() && i > 20) break; }
    return seq;
  }
  const inOrder = (seq, want) => { let k = 0; for (const s of seq) if (s === want[k]) k++; return k === want.length; };
  try {
    // 7a. одна чурка: снял на снег перед собой → развязал → внутрь сверху → затянул → надел; в касание рука с чуркой — в горловине снятого рюкзака
    field(); G.inv = {}; Carry.parts().push(chunk(4.5)); const t0 = G.time;
    ok(Carry.stow([]) && G.p.action.s === 'doff', '🎒 E «в рюкзак» — сначала снять рюкзак');
    let midOff = 0, touch = null, behind = 0, w0 = 0;
    const seq = film(8, (S, s) => {
      if (s === 'stow' && S.pko && Carry.off()) midOff++;
      if (S.held && S.held[1] < S.hx - 2) behind++;   // вещь в руке позади таза — «через спину»
      if (!touch && (G.inv.wood || 0) > w0) touch = S;
    });
    const T = (G.time - t0);
    ok(inOrder(seq, ['doff', 'open', 'stow', 'close', 'don']), `🎒 фазы: ${seq.join(' → ')} · ${f1(T)} с`);
    ok(midOff > 5, `🎒 пока кладёт — рюкзак снят и стоит на снегу (кадров ${midOff})`);
    const op = touch && touch.pko ? [touch.pko.x, touch.pko.y - touch.Hb] : null, dh = op ? Math.hypot(touch.h0[0] - op[0], touch.h0[1] - op[1]) : 99;
    ok(touch && touch.pko && dh < 6 && touch.h0[0] > touch.sx + 4, `✋ в касание рука — у горловины снятого рюкзака перед собой (${f1(dh)} ед. от горловины, впереди плеча на ${touch ? f1(touch.h0[0] - touch.sx) : '?'})`);
    ok(behind === 0, `🚫 вещь ни разу не уходит за спину (кадров позади таза: ${behind})`);
    ok(!Carry.off() && !Carry.busy() && G.inv.wood === 1 && Inv.packOut() === 0, `🎒 надет, чурка внутри (внутри ${Inv.packL()} л, снаружи ${Inv.packOut()})`);
    const D = TUNE.load.t, wd = k => Carry.dur(k, k === 'doff' || k === 'don' ? Inv.kgOf(G.inv) : 4.5);
    info(`длительности (рюкзак ${f1(Inv.kgOf(G.inv))} кг, чурка 4,5 кг): снять ${f2(wd('doff'))} · развязать ${f2(Carry.dur('open', 1))} · внутрь ${f2(wd('stow'))} · приторочить ${f2(wd('lash'))} · затянуть ${f2(Carry.dur('close', 1))} · надеть ${f2(wd('don'))} с (база ${D.doff}/${D.don})`);

    // 7b. три подряд: рюкзак снимается один раз, остаётся снятым, надевается в конце
    field(); G.inv = {}; for (const m of [4, 4.5, 5]) Carry.parts().push(chunk(m)); Carry.stow([]);
    let gap = 0, stows = 0; const sq = film(14, (S, s, a) => { if (a && a.s === 'stow' && a.got && !a.cnt) { a.cnt = 1; stows++; } if (stows > 0 && stows < 3 && !Carry.off()) gap++; });
    ok(sq.filter(s => s === 'doff').length === 1 && sq.filter(s => s === 'don').length === 1 && G.inv.wood === 3 && !Carry.busy() && gap === 0, `🎒 три подряд: снял 1 раз, ${stows} внутрь, надел 1 раз (${sq.join(' → ')})`);
    const Sf = frame(); ok(!Carry.off() && Inv.packOut() === 0 && Inv.packL() > 20 && Math.abs(Sf.fill - Inv.fill()) < 0.01, `🎒 набит: внутри ${Inv.packL()}/${TUNE.load.packL} л, нарисован набитым на ${f2(Sf.fill)} (= ${f2(Inv.fill())})`);

    // 7c. внутри полно — снаружи под ремни клапана (видно ровно столько, сколько приторочено), третья — отказ с причиной
    field(); G.inv = { wpelt: 6 }; for (const m of [4, 4.5]) Carry.parts().push(chunk(m)); Carry.stow([]);
    let bad = 0, maxLogs = 0; const sl = film(14, S => { if (S.logs != null) { maxLogs = Math.max(maxLogs, S.logs); if (S.logs !== Inv.packOut()) bad++; } });
    ok(inOrder(sl, ['doff', 'lash', 'lash', 'don']) && G.inv.wood === 2 && Inv.packOut() === 2, `🪵 снаружи: ${sl.join(' → ')} · притороченных ${Inv.packOut()}`);
    const S2 = frame();
    ok(bad === 0 && S2.logs === 2 && maxLogs <= TUNE.load.packWood, `🪵 нарисовано снаружи = приторочено в каждом кадре (сейчас ${S2.logs}, макс. ${maxLogs}, расхождений ${bad})`);
    toasts.length = 0; Carry.parts().push(chunk(4)); const r3 = Carry.stow([]);
    const tx = toasts.join(' | ');
    ok(!r3 && !G.p.action && Carry.parts().length === 1 && /:pack: полон/.test(tx) && /снаружи 2\/2/.test(tx) && /в охапке/.test(tx), `🚫 третья не влезла: «${tx}»`);
    ok(/полон/.test((Actions.context() || {}).label || ''), `💬 подпись E с охапкой: «${(Actions.context() || {}).label}»`);
    // тяжело: рюкзак 38 кг
    toasts.length = 0; G.inv = { battery: 4, kero: 2 }; Carry.stow([]);
    ok(/:weight: тяжело/.test(toasts.join(' ')), `🚫 по весу: «${toasts[0] || ''}»`);
    // лёгкое — в поясной карман, не снимая
    field(); G.inv = {}; Carry.hand().t = { id: 'can', n: 1 }; Carry.stow([]); const sc = film(3);
    ok(sc.join() === 'pocket' && G.inv.can === 1, `🥫 банка — в поясной карман, рюкзак не снимает (${sc.join(' → ')})`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 7d. длинное и состояние рук: на плечо — подъёмом, рисунок = данные; рюкзак поверх ноши не надевают ----------
  try {
    field(); G.inv = {}; let top = null;
    for (const t of G.trees.filter(t => !t.wall).slice(0, 120)) { top = Tree.parts(Tree.ensure({ x: t.x, y: t.y, s: t.s, kind: t.kind, v: t.v })).find(q => q.kind === 'top' && q.len > 0.8); if (top) break; }
    const q = Object.assign({}, top, { id: 7001, x: G.p.x + 40, y: G.p.y + 4, ang: 0, t: G.time - 5 }); G.chunks = [q];
    Carry.pick('part', q, []); const sts = []; let lsh = 0;
    for (let i = 0; i < 60 * 8; i++) { const S = frame(), s = Carry.st(); if (sts[sts.length - 1] !== s) sts.push(s); if (S.lsh) lsh++; if (s === 'shoulder' && !G.p.action && lsh > 10) break; }
    ok(Carry.st() === 'shoulder' && Carry.parts()[0] === q && sts.join() === 'free,lift,shoulder' && lsh > 0, `🌲 вершина ${f1(q.len)} м: ${sts.join(' → ')} (подъём ${f2(Carry.liftDur(q))} с), нарисована на плече ${lsh} кадров`);
    toasts.length = 0; Carry.stow([]); ok(toasts.length === 1 && /на плече/.test(toasts[0]), `🚫 с плеча в рюкзак — один тост: «${toasts[0] || ''}»`);
    // рюкзак снят, в руках охапка: «надеть» — положить → надеть → поднять те же
    field(); G.inv = {}; Carry.hand().p = [chunk(4), chunk(4.5)]; const ids = Carry.parts().map(c => c.id).sort().join();
    G.hand.off = { x: G.p.x + 13, y: G.p.y + 3, f: 1, open: 0, t: G.time }; Carry.closeDon([]); const sq = film(16);
    ok(inOrder(sq, ['put', 'don', 'pick']) && !Carry.off() && Carry.parts().map(c => c.id).sort().join() === ids, `🎒 охапка и снятый рюкзак: ${sq.join(' → ')} — рюкзак не надевают поверх охапки`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 8. прерывания: вещь не «зависает» — после любого прерывания она в мире / в рюкзаке / в руках, и рисунок совпадает ----------
  try {
    const kgAll = () => Inv.wkg(G.inv) + Carry.parts().reduce((s, q) => s + q.mass, 0) + (G.chunks || []).reduce((s, q) => s + q.mass, 0);
    const BREAK = {
      'пошёл': () => { input.mx = 1; for (let i = 0; i < 24; i++) frame(); input.mx = 0; },
      'отскок': () => { Hero.dodge(-1, 0); },
      'укус волка': () => { G.p.x -= 18; G.p.action = null; G.hurt = 1; },
      'другое дело': () => { G.p.action = { k: 'inspect', t: 0, dur: 0.8, pose: 'inspect', fb: 'idle' }; },
    };
    const AT = [['doff', 0.5], ['stow', 0.3], ['stow', 0.75], ['close', 0.4], ['don', 0.5], ['don', 0.9]];
    let n = 0, fails = [];
    for (const [nm, fn] of Object.entries(BREAK)) for (const [st, fr] of AT) {
      field(); G.inv = {}; for (const m of [4, 4.5]) Carry.parts().push(chunk(m)); const m0 = kgAll(); Carry.stow([]);
      let hit = false; for (let i = 0; i < 60 * 10 && !hit; i++) { const a = G.p.action; if (a && a.s === st && a.t / a.dur >= fr) hit = true; else frame(); }
      if (!hit) { fails.push(`${nm}@${st}${fr}: шаг не наступил`); continue; }
      fn(); let S = {}; for (let i = 0; i < 90; i++) S = frame();
      const ps = Carry.parts().length, th = Carry.thing(), stuck = G.p.action && G.p.action.j === 'carry' && PACK.includes(G.p.action.s);
      const drawOk = ps ? S.lon === ps : th ? S.held && S.held[0] : !S.held && !S.lon;
      // с охапкой рюкзак на ходу не надевают — остаётся на снегу (нарисован на снегу); надеть потом: положить → надеть → поднять
      const packOk = !Carry.off() ? !S.pko : !Carry.donOk() && (!!S.pko || !Carry.packNear(26));
      let back = true; if (Carry.off()) { const n0 = Carry.parts().length; Carry.closeDon([]); for (let i = 0; i < 60 * 20 && (G.p.action || Carry.off()); i++) frame(); back = !Carry.off() && Carry.parts().length === n0; }
      const okk = packOk && back && !stuck && Math.abs(kgAll() - m0) < 1e-6 && drawOk;
      n++; if (!okk) fails.push(`${nm}@${st}${fr}: снят ${!!Carry.off()} рисунок ${S.pko ? 'снят' : 'на спине'} шаг ${G.p.action && G.p.action.s} кг ${f2(kgAll())}/${f2(m0)} в руках ${ps} нарисовано ${S.lon || (S.held && S.held[0]) || 0}`);
    }
    ok(!fails.length, `🧷 прерывания (${Object.keys(BREAK).join(', ')}) × ${AT.length} моментов = ${n}: рюкзак на спине (с охапкой — на снегу, потом «положить → надеть → поднять»), масса цела, в руках = нарисовано` + (fails.length ? ' · ' + fails.slice(0, 3).join(' · ') : ''));
    // сон с охапкой — не ложится (в руках не «висит» во сне)
    field(); Carry.parts().push(chunk(4)); at(SPOT.bed.x + 20, SPOT.bed.y + 6); G.time = tAt(2, 21); G.hut.fuel = 600; toasts.length = 0; Actions.trySleep(); for (let i = 0; i < 120; i++) frame();
    ok(!G.p.sleeping && /Руки заняты/.test(toasts.join(' ')), `🛏 с охапкой не спит: «${toasts[0] || ''}»`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- 9. вес: длительность и присед растут с массой (непрерывно), усталость замедляет ----------
  try {
    const KGS = [0.4, 1, 3, 5, 8, 12, 20], d = KGS.map(k => Carry.dur('pick', k)), mono = a => a.every((v, i) => !i || v > a[i - 1]);
    G.s.tire = 80; const dT = Carry.dur('pick', 5); G.s.tire = 0;
    ok(mono(d) && dT > d[3], `⏱ подъём: ${KGS.map((k, i) => `${k} кг ${f2(d[i])}`).join(' · ')} с; усталый (80) чурка ${f2(dT)} с`);
    const dd = [5, 15, 25, 35].map(k => Carry.dur('don', k));
    ok(mono(dd), `⏱ надеть рюкзак 5/15/25/35 кг: ${dd.map(f2).join(' / ')} с`);
    // глубина приседа в касание (a 0.34): таз ниже у тяжёлого
    const cv = document.createElement('canvas'), g = cv.getContext('2d'), hip = kg => { ArtPeople.draw(g, { x: 0, y: 0, face: 1, anim: 'pickKeep', animT: 0.34, load: { mode: null, n: 0, kg }, target: { x: 8, y: -2 }, look: 'anorak', t: 1 }); return ArtPeople.H.P.hy; };
    const hy = KGS.map(hip);
    ok(mono(hy.slice(0, 6)) && hy[6] >= hy[5] - 1e-9, `🏋 присед в касание (таз, ниже = больше; с 12 кг — полный): ${KGS.map((k, i) => `${k} кг ${f1(hy[i])}`).join(' · ')}`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }
  ArtPeople.draw = D0; Fx.toast = T0;
  UI.openChest();
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = []; let out = [];
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && /^Inv:/.test(m.text())) errs.push('CONSOLE ' + m.text()); });   // инвариант мест (js/inventory.js)
    await pg.route(/^https?:/, r => r.abort());
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Carry !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); }); // модалка держит главный цикл на паузе
    out = await pg.evaluate(`(${page})()`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n').slice(0, 3).join(' ')); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: items-check · провалов ${bad}` : '\nOK: items-check · вещи с массой и объёмом');
  process.exit(bad ? 1 : 0);
})();
