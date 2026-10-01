#!/usr/bin/env node
// Темп времени (CYCLE = 1440, игровой час = минута) и усталость (G.s.tire). Детерминированно (сид), главный цикл на паузе.
//   cd tests && node tire-check.js
//   1. баланс k=3 против k=1: поленья на ночь, еда за ночь сна / сутки стоя / час ходьбы — в пределах ±15 %
//   2. петля усталость ↔ холод не в разнос: стоя ночью на морозе без огня — смерть не раньше 70 % прежнего; при tire=0 — как было
//   3. рост и спад: сон у печи, отдых в тёплой избе, ходьба по снегу, удары топором, дрожь, чай, горячая еда
//   4. эффекты: скорость, рубка, поза «устал»
//   5. засыпание на морозе: только при условиях; предупреждение, сон в снегу, подъём; промотку Z останавливает
//   6. старый сейв (без tire, сутки 480) грузится: силы полные, день и час те же
// Директор угроз выключен: меряем тело, а не случайных волков.
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

// k=1 (CYCLE 480, до замедления) — мерено тем же сценарием на e5d469f/8d1ae8c:
// ночь 19:12→07:00 в избе со щелями — 8.75 полена, с заслонкой — 6.81; еда за ночь сна 35.2; сутки стоя у огня 177.2; час ходьбы 9.15;
// смерть стоя ночью (−43°) без огня из тепла 90 — за 76.3 с
const K1 = { walls: 8.75, damper: 6.81, sleepFood: 35.2, dayStand: 177.2, hourWalk: 9.15, death: 76.3 };

function page(K1) {
  const out = [], ok = (c, w) => { out.push((c ? 'ok   ' : 'FAIL ') + w); return c; };
  const TS = [], toast0 = Fx.toast; Fx.toast = t => { TS.push(t); return toast0(t); };
  UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {};
  const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;
  const f1 = v => (+v).toFixed(1);
  function fresh(h, seed = 5) {
    Math.random = mulberry(seed); newGame(); state = 'play'; G.chapter = 1;
    G.time = tAt(2, h); G.day = dayOf(); G.lastDawn = G.day; G.storm = null; G.s.food = 100; G.s.warm = 90; G.s.hp = 100; TS.length = 0; input.mx = input.my = 0;
  }
  const hut = (o) => { Object.assign(G.hut, { walls: 1, door: 1, damper: 0 }, o); G.flags.stoveLit = 1; G.chest.wood = 60; const p = G.p; p.x = SPOT.bed.x + 30; p.y = SPOT.bed.y + 10; p.lx = p.x; p.ly = p.y; p.inside = true; };
  const field = () => { const p = G.p; p.x = HUT.x + 1400; p.y = HUT.y + 600; p.lx = p.x; p.ly = p.y; p.sx = p.x - 30; p.sy = p.y; Hero.snap(); };
  const run = (sec, dt = 0.05) => { for (let t = 0; t < sec && state === 'play'; t += dt) update(dt); };

  // ---------- 1. баланс ----------
  for (const [nm, o] of [['walls', {}], ['damper', { damper: 1 }]]) {
    fresh(19.2); hut(o); G.hut.fuel = 0; for (let i = 0; i < 40; i++) { const f = G.hut.fuel; Stove.add(); if (G.hut.fuel <= f) break; }
    const fuel0 = G.hut.fuel; Actions.trySleep(); let n = 0; while (!G.p.sleeping && n++ < 2000) update(1 / 60);
    const f0 = G.s.food; while (G.p.sleeping && n++ < 400000) update(0.05);
    const logs = (fuel0 - G.hut.fuel) / Stove.secPerLog(), food = f0 - G.s.food;
    ok(near(logs, K1[nm], 0.15) && hourOf() >= 7 && hourOf() < 7.2, `🪵 ночь в избе (${nm === 'walls' ? 'щели' : 'заслонка'}): ${logs.toFixed(2)} полена (было ${K1[nm]}) · ${gameDur(Stove.secPerLog())} на полено`);
    if (nm === 'walls') {
      ok(near(food, K1.sleepFood, 0.15), `🍖 еда за ночь сна ${f1(food)} (было ${K1.sleepFood})`);
      ok(G.s.tire < 0.5 && G.s.awake < 1, `🛏 после ночи у печи силы полные (tire ${f1(G.s.tire)}, без сна ${f1(G.s.awake / HOUR)} ч)`);
    }
  }
  fresh(9); field(); G.fires.push({ x: G.p.x + 40, y: G.p.y, fuel: 1e7 });
  let used = 0; for (let i = 0; i < CYCLE / 0.05; i++) { const f = G.s.food; update(0.05); used += Math.max(0, f - G.s.food); G.s.food = 100; }
  ok(near(used, K1.dayStand, 0.15), `🍖 сутки стоя у огня: еда ${f1(used)} (было ${K1.dayStand}) · силы ${f1(100 - G.s.tire)} (у огня стоя — бодрствование ×0.5, без отдыха)`);
  fresh(10); field(); G.fires.push({ x: G.p.x, y: G.p.y, fuel: 1e7 });
  used = 0; for (let i = 0; i < HOUR / 0.05; i++) { input.mx = (i % 400 < 200) ? 1 : -1; const f = G.s.food; update(0.05); used += Math.max(0, f - G.s.food); } input.mx = 0;
  ok(near(used, K1.hourWalk, 0.15), `🚶 час ходьбы: еда ${used.toFixed(2)} (было ${K1.hourWalk}) · час = ${HOUR} с`);

  // ---------- 2. петля холод ↔ усталость ----------
  const death = tire => { fresh(20); field(); G.s.warm = 90; G.s.tire = tire; let t = 0; while (state === 'play' && t < 3000) { update(0.05); t += 0.05; } return { t, T: temperature(), tire: G.s.tire }; };
  const d0 = death(0), d100 = death(100);
  ok(Math.abs(d0.t - K1.death) < 1.5, `🥶 стоя ночью ${d0.T}° без огня, силы полные: смерть за ${f1(d0.t)} с (было ${K1.death}) · к концу усталость ${f1(d0.tire)}`);
  ok(d100.t >= K1.death * 0.7 && d100.t < d0.t, `🥶 то же без сил (tire 100): смерть за ${f1(d100.t)} с — ${Math.round(d100.t / K1.death * 100)} % прежнего (≥ 70 %)`);

  // ---------- 3. рост и спад ----------
  fresh(10); hut(); G.hut.fuel = 1e5; G.s.tire = 60; G.s.warm = 90; G.p.x = SPOT.stove.x + 20; G.p.y = SPOT.stove.y + 30; G.p.lx = G.p.x; G.p.ly = G.p.y; run(HOUR);
  ok(near(60 - G.s.tire, 2, 0.2), `🔥 час стоя у печи: −${f1(60 - G.s.tire)} (−4 отдых +2 бодрствование)`);
  fresh(20.5); hut(); for (let i = 0; i < 40; i++) { const f = G.hut.fuel; Stove.add(); if (G.hut.fuel <= f) break; } G.s.tire = 80;
  Actions.trySleep(); let n = 0; while (!G.p.sleeping && n++ < 2000) update(1 / 60); const t0 = G.time; run(HOUR);
  ok(near(80 - G.s.tire, 10, 0.1), `🛏 час сна у горящей печи: −${f1(80 - G.s.tire)}`);
  fresh(11); field(); G.s.tire = 0; G.s.warm = 100; G.fires.push({ x: G.p.x, y: G.p.y, fuel: 1e7 });
  const W0 = G.s.tire; for (let i = 0; i < HOUR / 0.05; i++) { input.mx = (i % 400 < 200) ? 1 : -1; update(0.05); } input.mx = 0;
  const walkT = G.s.tire - W0;
  ok(walkT >= 3 && walkT < 30, `🚶 час ходьбы (снег по месту): +${f1(walkT)} (≥ 2 бодрствование + 1.5 ходьба)`);
  fresh(11); field(); G.s.tire = 10; const tr = G.trees[0]; Interact.emit('hit', { who: 'p', target: tr, x: tr.x, y: tr.y, power: 1 }); Interact.emit('work', { who: 'p', what: 'buck', x: tr.x, y: tr.y }); Interact.emit('hit', { who: { x: tr.x, y: tr.y }, target: tr, x: tr.x, y: tr.y, power: 0.5 });
  ok(Math.abs(G.s.tire - 10.8) < 1e-6, `🪓 удар топором и рез: +${f1(G.s.tire - 10)} (чужой удар не в счёт)`);
  fresh(22); field(); G.s.tire = 0; G.s.warm = 10; G.s.frost = 0;
  const r0 = Survival.tireRate(G.s, { moving: false }), r1 = Survival.tireRate({ warm: 100, food: 100, frost: 0, awake: 0 }, { moving: false });
  ok(r0 > 0.4 && r1 < 0.05, `🥶 дрожь: тепло 10 → +${r0.toFixed(2)}/с, тепло 100 → +${r1.toFixed(3)}/с`);
  const rh = Survival.tireRate({ warm: 10, food: 0, frost: 0, awake: 0 }, {});
  ok(near(rh / r0, 1.5, 0.02), `🍖 голодный устаёт ×${(rh / r0).toFixed(2)}`);
  const rl = Survival.tireRate({ warm: 100, food: 100, frost: 0, awake: 30 * HOUR }, {}), rs = Survival.tireRate({ warm: 100, food: 100, frost: 0, awake: 0 }, {});
  ok(near(rl / rs, 2, 0.02), `⏰ 30 ч без сна — бодрствование утомляет ×${(rl / rs).toFixed(2)}`);
  fresh(12); hut(); G.hut.fuel = 1e5; G.p.x = SPOT.stove.x + 20; G.p.y = SPOT.stove.y + 30; G.inv.tea = 1; G.s.tire = 50;
  const crafted = Actions.craft(RECIPES.find(r => r.id === 'tea')); for (let i = 0; i < 200 && G.p.action; i++) update(0.05);
  ok(crafted && Math.abs(G.s.tire - 42) < 0.3 && G.p.teaT > 0, `🍵 чай: −8 сразу (${f1(G.s.tire)}; пока варил — чуть устал)`);
  G.s.warm = 90; const tea0 = G.s.tire; G.p.teaT = 30; G.p.inside = false; const rt = Survival.tireRate(G.s, { tea: G.p.teaT, moving: true, eff: 1 });
  ok(rt <= 0, `🍵 пока греет чай — не устаёт (${rt.toFixed(3)}/с)`);
  fresh(12); hut(); G.hut.fuel = 1e5; G.p.x = SPOT.stove.x + 20; G.p.y = SPOT.stove.y + 30; G.p.inside = true; G.inv = { stew: 1 }; G.s.food = 40; G.s.tire = 50; Actions.eat();
  ok(G.s.tire === 45, `🍲 горячая уха: −5 (${G.s.tire})`);

  // ---------- 4. эффекты ----------
  fresh(12); field(); G.s.warm = 90; G.s.tire = 0; const sp0 = Hero.speed(), ch0 = Hero.chopTime(); G.s.tire = 100; const sp1 = Hero.speed(), ch1 = Hero.chopTime();
  ok(near(sp1 / sp0, 0.75, 0.01) && near(ch1 / ch0, 1.4, 0.01), `🐢 без сил: скорость ×${(sp1 / sp0).toFixed(2)}, рубка ×${(ch1 / ch0).toFixed(2)}`);
  G.s.tire = 50; ok(Hero.speed() === sp0, '🐢 до 60 усталости скорость прежняя');
  G.s.tire = 75; ok(Hero.walkPose(false) === 'tired' || !Hero.has('tired'), `🥱 tire 75 → походка «${Hero.walkPose(false)}»`);
  G.s.tire = 0; G.s.warm = 90; const lossA = Survival.rates(G.p, -40, 1, false, 0).loss, lossB = Survival.rates(G.p, -40, 1, false, 100).loss;
  ok(near(lossB / lossA, 1.5, 0.01), `❄️ вымотанный мёрзнет ×${(lossB / lossA).toFixed(2)}`);
  // старый баг: лёд, мокрая одежда, чай — множители теперь работают
  G.p.wetT = 10; const lw = Survival.rates(G.p, -40, 1, false, 0).loss; G.p.wetT = 0; G.p.teaT = 10; const lt = Survival.rates(G.p, -40, 1, false, 0).loss; G.p.teaT = 0;
  ok(near(lw / lossA, TUNE.body.wet, 0.01) && near(lt / lossA, TUNE.body.tea, 0.01), `💧 мокрый ×${(lw / lossA).toFixed(2)}, 🍵 чай ×${(lt / lossA).toFixed(2)}`);
  G.p.x = riverX(G.p.y); const li = Survival.rates(G.p, -40, 1, false, 0).loss; field();
  ok(near(li / lossA, TUNE.body.ice, 0.01), `🧊 на льду ×${(li / lossA).toFixed(2)}`);

  // ---------- 5. засыпание на морозе ----------
  const doze = (setup, sec = 11) => { fresh(22); field(); G.s.warm = 20; G.s.tire = 95; G.s.hp = 100; setup && setup(); for (let t = 0; t < sec && state === 'play'; t += 0.05) { G.s.warm = Math.min(G.s.warm, 20); G.s.tire = Math.max(G.s.tire, 95); update(0.05); } return { warn: !!G.p.dozeWarn, doze: !!G.p.doze, ts: TS.slice() }; };
  let d = doze(null, 3.5);
  ok(!d.warn && !d.doze, '😴 3.5 с без дела — ещё не клонит');
  d = doze(null, 6);
  ok(d.warn && !d.doze && d.ts.some(t => /Не спи/.test(t)) && Survival.dozeFx() > 0, `😴 > 4 с: края темнеют (${Survival.dozeFx().toFixed(2)}), «Не спи — замёрзнешь!»`);
  d = doze(null, 11);
  ok(d.doze && d.ts.some(t => /Уснул в снегу/.test(t)) && Hero.pose().anim === 'sleep', '💤 ещё 6 с — уснул в снегу (поза сна)');
  const lz = Survival.rates(G.p, -40, 1, true, 95).loss; G.p.doze = 0; const lnz = Survival.rates(G.p, -40, 1, false, 95).loss; G.p.doze = 1;
  ok(near(lz / lnz, 1.5, 0.01), `💤 во сне в снегу тепло уходит ×${(lz / lnz).toFixed(2)}`);
  const x0 = G.p.x; input.mx = 1; for (let t = 0; t < 0.6; t += 0.05) update(0.05);
  ok(G.p.doze && Math.abs(G.p.x - x0) < 1, '💤 короткий ход не будит');
  for (let t = 0; t < 1; t += 0.05) update(0.05); input.mx = 0;
  ok(!G.p.doze && TS.some(t => /Очнулся/.test(t)), '🆙 ход, удержанный 1.2 с, — поднялся');
  d = doze(null, 11); G.hurt = 1; update(0.05);
  ok(!G.p.doze, '🐺 удар будит сразу');
  ok(!doze(() => G.fires.push({ x: G.p.x + 30, y: G.p.y, fuel: 1e5 })).warn, '🔥 у огня не засыпает');
  ok(!doze(() => { hut(); G.hut.fuel = 0; }).warn, '🏚 в избе не засыпает');
  { fresh(22); field(); G.s.warm = 20; G.s.tire = 85; for (let t = 0; t < 11; t += 0.05) { G.s.warm = 20; G.s.tire = 85; update(0.05); } ok(!G.p.dozeWarn && !G.p.doze, '💪 tire 85 — не засыпает'); }
  { fresh(22); field(); G.s.warm = 40; G.s.tire = 95; for (let t = 0; t < 11; t += 0.05) { G.s.warm = 40; G.s.tire = 95; update(0.05); } ok(!G.p.dozeWarn, '🌡 тепло 40 — не засыпает'); }
  { fresh(22); field(); G.s.warm = 20; G.s.tire = 95; for (let t = 0; t < 11; t += 0.05) { G.s.warm = 20; G.s.tire = 95; input.mx = (t % 2 < 1) ? 1 : -1; update(0.05); } input.mx = 0; ok(!G.p.dozeWarn, '🚶 на ходу не засыпает'); }
  // Z: «переждать» на морозе — предупреждение останавливает промотку
  { fresh(21); field(); G.s.warm = 20; G.s.tire = 95; G.s.food = 100; Actions.skipStart(); let i = 0;
    for (; i < 4000 && Actions.skipping() && state === 'play'; i++) { G.s.warm = Math.min(G.s.warm, 20); update(TUNE.time.skipDt); }
    ok(!Actions.skipping() && G.p.dozeWarn && !G.p.doze, `⏩ промотка Z встала на «Не спи» (через ${(i * TUNE.time.skipDt).toFixed(1)} с)`); }
  // глава I: сон в снегу → мягкая смерть (дед донёс)
  { fresh(22); G.chapter = 0; field(); G.s.warm = 5; G.s.tire = 100; G.s.hp = 30; let t = 0, slept = false; for (; t < 200 && !G.p.ko && state === 'play'; t += 0.05) { update(0.05); slept = slept || !!G.p.doze; }
    ok(state === 'play' && slept && G.p.ko && !G.p.doze, `🧑‍🦯 глава I: уснул в снегу → мягкая смерть через ${f1(t)} с`); }

  // ---------- 6. старый сейв ----------
  { fresh(15.5); G.s.tire = 33; const js = JSON.parse(SaveGame.snapshot()); const h0 = hourOf(), d0 = G.day;
    delete js.cyc; delete js.s.tire; delete js.s.awake; js.time = js.time / (CYCLE / 480); js.hut.fuel = 30;
    let err = null; try { SaveGame.load(JSON.stringify(js)); } catch (e) { err = e.message; }
    ok(!err && G.s.tire === 0 && G.s.awake === 0 && Math.abs(hourOf() - h0) < 0.01 && G.day === d0 && Math.abs(G.hut.fuel - 30 * CYCLE / 480) < 1e-6,
      `💾 старый сейв: ${err || `силы ${100 - G.s.tire}, день ${G.day} ${hourOf().toFixed(2)} ч (было ${d0} ${h0.toFixed(2)}), печь ×${CYCLE / 480}`}`);
    G.s.tire = 41; const back = JSON.parse(SaveGame.snapshot()); SaveGame.load(JSON.stringify(back));
    ok(G.s.tire === 41 && back.cyc === CYCLE, '💾 новый сейв: усталость и темп сохраняются'); }
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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Survival !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); }); // модалка держит главный цикл на паузе
    out = await pg.evaluate(`(${page})(${JSON.stringify(K1)})`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: tire-check · провалов ${bad}` : '\nOK: tire-check · темп ×3, усталость');
  process.exit(bad ? 1 : 0);
})();
