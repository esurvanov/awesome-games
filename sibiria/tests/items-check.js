#!/usr/bin/env node
// Вещи с массой и объёмом (js/inventory.js, js/carry.js). Детерминированно (сид), главный цикл на паузе, сценарии — тем же update().
//   cd tests && node items-check.js
//   1. масса сохраняется: дерево → части (= целое) → чурки в руки → рюкзак / нарты / поленница → печь (огонь = кг × secPerKg)
//   2. рюкзак не берёт сверх объёма/веса; дров — не больше packWood мелких; остальное остаётся в руках
//   3. охапка занимает руки: не рубит, не бьёт, X — кладёт (не бросает палку), идёт медленнее
//   4. нарты возят: ёмкость по кг/л, груз тормозит, в глубоком снегу — сильнее; груз виден (G.sled)
//   5. сейв: руки/нарты/вещи на снегу/туши — туда-обратно; миграция старого сейва (числа «дрова» по 6 кг → вещи)
//   6. баланс ночи: кг и деревьев на ночь / сутки — до (v1.2.0, интеграция) и после; разумные пределы
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
    const ps = G.chunks.filter(q => q.src === L.id), M = ps.reduce((s, q) => s + q.mass, 0), W = ps.filter(Tree.isWood), Mw = W.reduce((s, q) => s + q.mass, 0);
    ok(Math.abs(M - L.m0) < L.m0 * 1e-3, `🌲 части = целое: ${f2(M)} кг из ${f2(L.m0)} (дров ${f2(Mw)} кг · ${W.length} шт, лапник ${f2(M - Mw)} кг)`);
    // каждую — процессом: подойти, взять в охапку; охапка полна — на нарты (нарты за спиной); 2 мелких — в рюкзак; остаток — в поленницу
    let n = 0, guard = 0;
    for (const q of W.slice().sort((a, b) => a.mass - b.mass)) {
      if (Carry.cantTake(q)) { at(G.p.x, G.p.y); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 4; Carry.put('sled', []); run(8, idle); }
      at(q.x - 22, q.y, 1); G.p.sx = G.p.x - 30; G.p.sy = G.p.y + 4; Carry.pick('part', q, []); run(3, idle); n += Carry.parts().includes(q) ? 1 : 0;
      if (n === 2 && guard++ === 0) { Carry.stow([]); run(6, idle); }
    }
    ok(!G.chunks.some(q => W.includes(q)), `🪵 все ${W.length} чурок подняты (руки ${Carry.parts().length}, рюкзак ${G.inv.wood || 0}, нарты ${G.sled.wood || 0})`);
    ok(Math.abs(wkgAll() - Mw) < 1e-3, `⚖️ руки + рюкзак + нарты + поленница = ${f2(wkgAll())} кг из ${f2(Mw)}`);
    ok((G.inv.wood || 0) <= TUNE.load.packWood, `🎒 дров в рюкзаке ${G.inv.wood || 0} ≤ ${TUNE.load.packWood}, ${f2(Inv.wkg(G.inv))} кг`);
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
    Carry.stow([]); run(6, idle);
    ok(G.inv.wood === 2 && Carry.parts().length === 1, `🪵 дров в рюкзак — ${G.inv.wood} из 3 (третье в руках)`);
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
  UI.openChest();
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = []; let out = [];
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
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
