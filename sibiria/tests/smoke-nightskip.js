#!/usr/bin/env node
// «До утра» (Z): промотка ночи — тот же update(), исход по обычным правилам выживания. Детерминированно (сид).
//   cd tests && node smoke-nightskip.js
//   1. сыт, печь полна → утро, жив, «Утро · сохранено», рассвет (улов, цель «Пережить ночь»)
//   2. без еды → смерть от голода (глава II) / мягкая смерть (глава I)
//   3. холод: на улице без огня, в холодной избе, у догоревшего костра → смерть; полупустая печь → будит
//   4. промотка ≈ обычная ночь (×sleepX при 60 к/с; стоя на улице): тепло, еда, силы, здоровье, печь, час — расхождение малое;
//      прогноз окна ≈ факт (и по силам, ≤ 1.5); волк рядом прерывает
//   5. по-настоящему: Z → окно прогноза → Z → утро (главный цикл, реальное время)
// Директор угроз выключен в 1–4: сравниваем тело, а не случайных волков (в избе с дверью во сне он и так молчит).
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => { out.push((c ? 'ok   ' : 'FAIL ') + w); return c; };
  const TS = [], toast0 = Fx.toast; Fx.toast = t => { TS.push(t); return toast0(t); };
  const quiet = () => { UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {}; };
  quiet();
  const hh = (t = G.time) => hourOf(t).toFixed(2);
  // мир: сид, глава, вечер 20:00 второго дня
  function fresh(seed, ch, h = 20) {
    Math.random = mulberry(seed); newGame(); state = 'play'; G.chapter = ch;
    G.time = tAt(2, h); G.day = dayOf(); G.lastDawn = G.day; G.storm = null; G.s.food = 100; G.s.warm = 90; G.s.hp = 100; TS.length = 0;
  }
  const hut = (fill = true) => {
    Object.assign(G.hut, { walls: 1, door: 1, damper: 0 }); G.flags.stoveLit = 1; G.chest.wood = 60;
    const p = G.p; p.x = SPOT.bed.x + 30; p.y = SPOT.bed.y + 10; p.lx = p.x; p.ly = p.y; input.mx = input.my = 0; p.inside = true;
    if (fill) for (let i = 0; i < 40; i++) { const f = G.hut.fuel; Stove.add(); if (G.hut.fuel <= f) break; }
  };
  const field = () => { const p = G.p; p.x = HUT.x + 1400; p.y = HUT.y + 600; p.lx = p.x; p.ly = p.y; input.mx = input.my = 0; update(0.05); };
  const snap = () => ({ warm: G.s.warm, food: G.s.food, hp: G.s.hp, tire: G.s.tire, fuel: G.hut.fuel, h: hourOf(), state, ko: !!G.p.ko, cause: G.cause });
  // промотка как в главном цикле: пачки update(skipDt), пока «до утра»; до лежанки — обычным шагом
  // (без сознания — мягкая смерть — главный цикл идёт обычным шагом: карточка «кто донёс», потом встаёт)
  function skip(max = 20000) {
    Actions.skipStart(); let n = 0; skip.ko = false;
    for (; n < max && state === 'play' && Actions.skipping(); n++) { if (G.p.ko) skip.ko = true; update(Actions.skipFast() ? TUNE.time.skipDt : 0.05); }
    return n;
  }
  // обычная ночь: шаг 1/60 с (во сне главный цикл крутит ×sleepX таких шагов за кадр); stop — когда кончилась
  function manual(stop, max = 200000) { for (let n = 0; n < max && state === 'play' && !stop(); n++) update(1 / 60); }
  const near = (a, b, d) => Math.abs(a - b) <= d;
  const fmt = o => `т${o.warm.toFixed(1)} е${o.food.toFixed(1)} hp${o.hp.toFixed(1)} печь${o.fuel | 0} ${o.h.toFixed(2)}ч`;

  // ---------- 1. сыт, печь полна → утро ----------
  fresh(11, 1); hut(); G.s.tire = 70; G.s.awake = 14 * HOUR;
  let fc = Survival.forecast(true), t0 = performance.now(), n = skip(), r = snap(), ms = performance.now() - t0;
  ok(Actions.skipMode && r.state === 'play' && r.h >= 7 && r.h < 7.2 && r.hp > 0 && G.flags.slept, `☀️ сыт + печь: утро ${r.h.toFixed(2)} ч, жив (${fmt(r)}) · ${n} шагов за ${ms | 0} мс`);
  ok(TS.some(t => /Утро · сохранено/.test(t)) && G.lastDawn === G.day, `💾 «Утро · сохранено», рассвет отработал (день ${G.day})`);
  ok(CHAPTERS[1].goals.length >= 0 && CHAPTERS[0].goals.find(g => g.ic === ':sleep:').ok(G), '🌙 цель «Пережить ночь» закрыта');
  ok(fc.deadAt == null && fc.wakeAt == null && near(fc.food, r.food, 1.5) && near(fc.warm, r.warm, 1.5), `🔮 прогноз: доживёшь, е${fc.food.toFixed(1)} т${fc.warm.toFixed(1)} ≈ факт`);
  ok(near(fc.tire, G.s.tire, 1.5) && G.s.tire < 70 - 50, `⚡ сон у печи: силы ${30} → ${(100 - G.s.tire).toFixed(1)} (прогноз ${(100 - fc.tire).toFixed(1)})`);
  ok(r.food < 100 - 12 * HOUR * TUNE.body.hungerSleep * 0.9 && r.food > 100 - 12 * HOUR * TUNE.body.hunger, `🍖 во сне голод слабее: −${(100 - r.food).toFixed(1)} за ночь (бодрствуя было бы ≈ −${(12 * HOUR * TUNE.body.hunger).toFixed(0)})`);

  // ---------- 2. без еды ----------
  fresh(12, 1); hut(); G.s.food = 5; fc = Survival.forecast(true); skip(); r = snap();
  ok(r.state === 'over' && r.cause === 'food', `💀 без еды (гл. II): смерть от голода в ${r.h.toFixed(2)} ч (прогноз ${fc.deadAt != null ? hh(fc.deadAt) : '—'}, ${fc.cause})`);
  ok(fc.deadAt != null && fc.cause === 'food' && near(hourOf(fc.deadAt), r.h, 0.15), '🔮 прогноз голодной смерти ≈ факт');
  fresh(13, 0); hut(); G.s.food = 0; skip(); r = snap();
  ok(r.state === 'play' && skip.ko && !Actions.skipping(), `🧑‍🦯 без еды (гл. I): мягкая смерть — дед донёс, промотка остановлена (${r.h.toFixed(2)} ч)`);

  // ---------- 3. холод ----------
  fresh(14, 1); field(); fc = Survival.forecast(false); skip(); r = snap();
  ok(r.state === 'over' && r.cause === 'cold', `🥶 на улице без огня: смерть от холода в ${r.h.toFixed(2)} ч (прогноз ${fc.deadAt != null ? hh(fc.deadAt) : '—'})`);
  ok(fc.deadAt != null && fc.cause === 'cold' && near(hourOf(fc.deadAt), r.h, 0.15), '🔮 прогноз смерти от холода ≈ факт');
  fresh(15, 1); hut(false); G.hut.fuel = 0;
  ok(Actions.skipMode() === 'wait', '🏚 печь холодная — не сон, «переждать»');
  skip(); r = snap();
  ok(r.state === 'over' && r.cause === 'cold', `🥶 холодная изба: смерть от холода в ${r.h.toFixed(2)} ч`);
  fresh(16, 1); hut(false); G.hut.fuel = 80; fc = Survival.forecast(true); skip(); r = snap();
  ok(r.state === 'play' && !G.p.sleeping && (r.h >= 19 || r.h < 7) && TS.some(t => /Печь погасла/.test(t)), `🔥 полупустая печь: разбудила в ${r.h.toFixed(2)} ч (прогноз ${fc.wakeAt != null ? hh(fc.wakeAt) : '—'})`);
  ok(fc.wakeAt != null && near(hourOf(fc.wakeAt), r.h, 0.1), '🔮 прогноз «печь погаснет» ≈ факт');
  fresh(17, 1); field(); G.inv.wood = 3; Actions.fireKey(); const f = G.fires[G.fires.length - 1];
  fc = Survival.forecast(false); skip(); r = snap();
  ok(f && r.state === 'over' && r.cause === 'cold' && fc.fuelAt != null, `🔥 костёр догорел (${fc.fuelAt != null ? hh(fc.fuelAt) : '—'}) → смерть от холода в ${r.h.toFixed(2)} ч (прогноз ${fc.deadAt != null ? hh(fc.deadAt) : '—'})`);

  // ---------- 4. промотка ≈ обычная ночь ----------
  // (а) сон в избе: ×sleepX при 60 к/с против промотки
  fresh(21, 1); hut(); Actions.trySleep(); manual(() => G.p.sleeping); manual(() => !G.p.sleeping); const A = snap();
  fresh(21, 1); hut(); const Bs = (skip(), snap());
  ok(near(A.warm, Bs.warm, 1) && near(A.food, Bs.food, 1) && near(A.hp, Bs.hp, 1) && near(A.fuel, Bs.fuel, 3) && near(A.h, Bs.h, 0.05),
    `⚖️ сон: обычная ночь ${fmt(A)} · промотка ${fmt(Bs)}`);
  // (б) стоя на улице у вечного огня
  const camp = () => { field(); G.fires.push({ x: G.p.x + 40, y: G.p.y, fuel: 1e5 }); };
  fresh(22, 1); camp(); G.s.tire = 40; manual(() => { const h = hourOf(); return h >= 7 && h < 12; }); const C = snap();
  fresh(22, 1); camp(); G.s.tire = 40; fc = Survival.forecast(false); skip(); const D = snap();
  ok(C.state === 'play' && D.state === 'play' && near(C.warm, D.warm, 1) && near(C.food, D.food, 1) && near(C.hp, D.hp, 1) && near(C.h, D.h, 0.05),
    `⚖️ у костра: обычная ночь ${fmt(C)} · промотка ${fmt(D)}`);
  ok(TS.some(t => /Утро · сохранено/.test(t)) && near(fc.food, D.food, 1) && near(fc.warm, D.warm, 1), `🔮 прогноз у костра е${fc.food.toFixed(1)} т${fc.warm.toFixed(1)} ≈ факт; утро сохранено`);
  ok(near(C.tire, D.tire, 1.5) && near(fc.tire, D.tire, 1.5), `⚡ у костра без сна: силы обычная ночь ${(100 - C.tire).toFixed(1)} · промотка ${(100 - D.tire).toFixed(1)} · прогноз ${(100 - fc.tire).toFixed(1)}`);
  // (б2) стоя на морозе без огня: дрожь выматывает — прогноз ≈ факт и по силам
  fresh(26, 1); field(); G.s.tire = 20; fc = Survival.forecast(false); skip(); const D2 = snap();
  ok(fc.deadAt != null && near(fc.tire, D2.tire, 1.5), `⚡ на морозе: силы к смерти факт ${(100 - D2.tire).toFixed(1)} · прогноз ${(100 - fc.tire).toFixed(1)}`);
  // (в) смерть на морозе — в тот же час
  fresh(23, 1); field(); manual(() => false); const E = snap();
  fresh(23, 1); field(); skip(); const F = snap();
  ok(E.state === 'over' && F.state === 'over' && E.cause === F.cause && near(E.h, F.h, 0.05), `⚖️ мороз: обычная смерть ${E.h.toFixed(2)} ч (${E.cause}) · промотка ${F.h.toFixed(2)} ч (${F.cause})`);
  // (г) волк рядом — будит
  fresh(24, 1); camp(); Actions.skipStart(); for (let i = 0; i < 400 && Actions.skipping(); i++) update(TUNE.time.skipDt);
  Wolves.spawnScout(); const w = G.wolves[G.wolves.length - 1]; w.x = G.p.x + 300; w.y = G.p.y; w.st = 'scout';
  const h0 = hourOf(); update(TUNE.time.skipDt);
  ok(!Actions.skipping() && TS.some(t => /Волки рядом/.test(t)) && hourOf() - h0 < 0.01, `🐺 волк ближе ${TUNE.time.skipThreatR} px — промотка встала в ${hourOf().toFixed(2)} ч`);
  // (д) днём нельзя
  fresh(25, 1, 13); hut(); ok(!!Actions.skipWhy(), '🕐 днём «до утра» нельзя');
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
    await pg.evaluate(() => localStorage.clear());
    // ---------- 5. по-настоящему: главный цикл ----------
    await pg.click('#start'); await pg.waitForTimeout(500);
    for (let i = 0; i < 6 && await pg.evaluate(() => UI.modal()); i++) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(120); }
    await pg.evaluate(() => {
      window.TS = []; const t0 = Fx.toast; Fx.toast = t => { TS.push(t); return t0(t); };
      UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {};
      G.time = tAt(2, 20); G.day = dayOf(); G.lastDawn = G.day; G.storm = null; G.s.food = 100; G.s.warm = 90;
      Object.assign(G.hut, { walls: 1, door: 1 }); G.flags.stoveLit = 1; G.chest.wood = 60;
      const p = G.p; p.x = SPOT.bed.x + 30; p.y = SPOT.bed.y + 10; p.lx = p.x; p.ly = p.y;
      for (let i = 0; i < 40; i++) { const f = G.hut.fuel; Stove.add(); if (G.hut.fuel <= f) break; }
    });
    await pg.waitForTimeout(300);
    const hint = await pg.evaluate(() => document.getElementById('prompt').textContent);
    out.push((/До утра/.test(hint) ? 'ok   ' : 'FAIL ') + `⌨️ подсказка ночью: «${hint.replace(/\s+/g, ' ').trim().slice(0, 80)}»`);
    await pg.keyboard.press('z'); await pg.waitForTimeout(200);
    const pan = await pg.evaluate(() => ({ kind: UI.kind, txt: document.getElementById('panel').innerText.replace(/\s+/g, ' ') }));
    out.push((pan.kind === 'skip' && /Доживёшь/.test(pan.txt) ? 'ok   ' : 'FAIL ') + `🪟 окно прогноза: ${pan.txt.slice(0, 160)}`);
    await pg.screenshot({ path: path.join(__dirname, 'shots', 'nightskip-panel.png') });
    const t0 = Date.now();
    await pg.keyboard.press('z');
    await pg.waitForFunction(() => G.p.sleeping && Actions.skipFast(), null, { timeout: 15000 });
    await pg.waitForTimeout(150); await pg.screenshot({ path: path.join(__dirname, 'shots', 'nightskip-run.png') });
    await pg.waitForFunction(() => !Actions.skipping(), null, { timeout: 60000 });
    const res = await pg.evaluate(() => ({ h: hourOf(), st: state, hp: G.s.hp, food: G.s.food, saved: TS.some(t => /Утро · сохранено/.test(t)), slot: !!Saves.latest() }));
    out.push((res.st === 'play' && res.h >= 7 && res.h < 7.3 && res.saved && res.slot ? 'ok   ' : 'FAIL ') + `🎮 Z→Z: утро ${res.h.toFixed(2)} ч за ${((Date.now() - t0) / 1000).toFixed(1)} с реального времени, hp${res.hp | 0} е${res.food | 0}, сейв ${res.slot ? 'есть' : 'нет'}`);
    // логика: чистая вкладка
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Survival !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); }); // модалка держит главный цикл на паузе
    out = (await pg.evaluate(`(${page})()`)).concat(out);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: smoke-nightskip · провалов ${bad}` : '\nOK: smoke-nightskip · промотка = обычная ночь');
  process.exit(bad ? 1 : 0);
})();
