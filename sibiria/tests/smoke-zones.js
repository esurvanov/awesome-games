#!/usr/bin/env node
// Большой мир «Сибири 2.0» (SPEC-world, A3/A4/A7/A9): 8 зон, их правила и объекты, транспорт, быстрый переход,
// большая карта (M), сейв с состоянием зон, генерация, кадр при CPU ×4 (ночь, посёлок, мир ×9).
//   cd tests && node smoke-zones.js
//   SHOTS=1 node smoke-zones.js   — ещё и снимки каждой зоны, транспорта и карты → docs/research/img/world/
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS ? path.resolve(__dirname, '../docs/research/img/world') : null;
const TIPS = '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}';

// ======================= в странице =======================
function scene() {
  const out = {}, fails = [];
  const ok = (c, w) => { if (!c) fails.push(w); return !!c; };
  const quiet = () => { document.querySelectorAll('#dialog,#note,#chapter').forEach(e => e.hidden = true); UI.closePanel(); };
  quiet();
  const p = G.p, day = () => { G.time = tAt(G.day, 12); }, heal = () => { G.s.hp = 100; G.s.warm = 100; G.s.food = 100; };
  const go = (x, y) => { p.x = x; p.y = y; p.vx = p.vy = 0; p.action = null; p.ride = null; p.lx = x; p.ly = y; };
  const run = (sec, f) => { for (let t = 0; t < sec; t += 0.05) { if (f) f(); update(0.05); if (G.s.hp < 30) heal(); } };
  G.day = 2; G.lastDawn = 2; day(); heal();

  // ---------- 1. скелет: 8 зон по кольцу, соседи 2 500–3 600 px, ядро не задето ----------
  out.W = W;
  const ring = ['naled', 'kurum', 'golets', 'drill', 'zimnik', 'meteo', 'stoibishe', 'gar'];
  ok(Zones.ACT.length === 8, 'активных зон ' + Zones.ACT.length);
  out.ring = ring.map((id, i) => { const a = ZONES[id], b = ZONES[ring[(i + 1) % 8]]; return Math.round(Math.hypot(a.x - b.x, a.y - b.y)); });
  ok(out.ring.every(d => d >= 2500 && d <= 3600), 'соседние зоны 2 500–3 600 px: ' + out.ring);
  for (const id of ring) ok(Zones.idAt(ZONES[id].x, ZONES[id].y) === id, 'якорь в своей зоне: ' + id);
  for (const k in POI) ok(Zones.at(POI[k].x, POI[k].y) === ZONES.core, 'сюжетное место в ядре: ' + k);
  // пешком по целине между соседями — ≤ 1 мин (A7), на лыжах быстрее
  const walk = TUNE.hero.speed * TERRAIN.taiga.walk, ski = TUNE.hero.speed * TERRAIN.taiga.ski;
  out.walkSec = Math.round(Math.max(...out.ring) / walk); out.skiSec = Math.round(Math.max(...out.ring) / ski);
  ok(out.walkSec <= 60 && out.skiSec < out.walkSec, `соседи пешком ${out.walkSec} с, на лыжах ${out.skiSec} с`);

  // ---------- 2. генерация: ≤ 1,5 с, детерминирована по seed ----------
  const hash = () => { let h = 0; for (const a of [G.trees, G.rocks, G.drifts, G.amuletsAt]) for (const o of a) h = (h * 31 + (o.x | 0) * 7 + (o.y | 0) + (o.kind | 0)) | 0; return h; };
  const keep = G, h0 = hash();
  const regen = seed => { G = Object.assign({}, keep, { seed, trees: [], rocks: [], drifts: [], cracks: [], tussocks: [] }); const t0 = performance.now(); const r = mulberry(seed); World.gen(r); World.genLiving(r); return performance.now() - t0; };
  out.genMs = +regen(987654).toFixed(1); const hA = hash(); regen(987654); const hB = hash();
  regen(keep.seed); const h1 = hash(); G = keep; Zones.build(G.seed); World.buildGrid();
  ok(out.genMs < 1500, 'генерация ×9 ' + out.genMs + ' мс');
  ok(hA === hB && h0 === h1, 'генерация детерминирована по seed');
  out.rocks = G.rocks.length; out.trees = G.trees.filter(t => !t.wall).length;
  ok(G.rocks.filter(q => Zones.idAt(q.x, q.y) === 'kurum').length >= 100, 'глыбы курумника');
  out.burnt = G.trees.filter(t => t.kind === 3 && Zones.idAt(t.x, t.y) === 'gar').length;
  ok(out.burnt > 100, 'гарь: горелый сухостой ' + out.burnt);

  // ---------- 3. правила зон ----------
  const Z = id => ZONES[id];
  // наледь: лыжи не идут, промоина мочит
  G.gear.skis = 1; go(Z('naled').x, Z('naled').y); Zones.tick(0.05);
  ok(p.skiOff === 1 && Transport.mode() === 'walk', 'наледь: лыжи сняты');
  const st = Zones.OBJS.find(o => o.type === 'steam'); go(st.x, st.y); p.moving = true; p.wetT = 0; Zones.tick(0.05);
  ok(p.wetT > 0, 'наледь: промоина — мокрый');
  p.wetT = 0; go(HUT.x, HUT.y + 200); Zones.tick(0.05); ok(!p.skiOff, 'из наледи — снова на лыжах');
  // гарь: костёр горит дольше, сухостой рубится быстрее и падает
  const garF = { x: Z('gar').x + 200, y: Z('gar').y + 300, fuel: 100 }, coreF = { x: HUT.x + 300, y: HUT.y + 300, fuel: 100 };
  G.fires.push(garF, coreF); Fire.tick(10, 0, false);
  out.garBurn = +((100 - garF.fuel) / (100 - coreF.fuel)).toFixed(2); G.fires = G.fires.filter(f => f !== garF && f !== coreF);
  ok(Math.abs(out.garBurn - TUNE.zone.garBurn) < 0.01, 'гарь: костёр горит дольше ×' + out.garBurn);
  const bt = G.trees.find(t => t.kind === 3 && t.wood > 0 && Zones.idAt(t.x, t.y) === 'gar');
  go(bt.x + 60, bt.y + 20); G.fall = null; G.fallT = 0; const nf = G.fallen.length;
  run(3, () => { p.moving = false; });
  ok(G.fallen.length > nf, 'гарь: сухостой упал рядом');
  // курумник: вывих
  go(Z('kurum').x, Z('kurum').y); G.gear.skis = 1; Zones.tick(0.05); ok(p.skiOff === 1, 'курумник: лыжи сняты');
  const R = Math.random; Math.random = () => 0; p.moving = true; p.sprainT = 0; Zones.tick(0.05); Math.random = R;
  const spK = Hero.speed(); p.sprainT = 0; const sp0 = Hero.speed();
  ok(spK < sp0 * 0.7, `курумник: вывих — медленнее (${spK.toFixed(0)} < ${sp0.toFixed(0)})`); p.sprainT = 0;
  // голец: мороз ×1,5, обзор ×3, ветер сносит, съёмка с тура
  go(Z('golets').x, Z('golets').y + 100); p.moving = false;
  ok(Zones.rule('cold') === 1.5 && Zones.rule('view') === 3, 'голец: мороз ×1,5, обзор ×3');
  const x0 = p.x; Zones.tick(1); ok(p.x > x0 + 10, 'голец: ветер сносит');
  const gu = Zones.obj('gurii'); go(gu.x, gu.y + 40);
  const fogI = (x, y) => G.fog[Math.floor(y / World.FOG.cell) * World.FOG.nx + Math.floor(x / World.FOG.cell)];
  ok(fogI(gu.x - 2000, gu.y) === 0, 'до съёмки даль не открыта');
  const c1 = Actions.context(); ok(c1 && c1.k === 'survey', 'у тура — «Съёмка»: ' + (c1 && c1.k));
  Actions.interact(false); run(TUNE.zone.surveyT + 0.3, () => { p.moving = false; input.mx = input.my = 0; });
  ok(fogI(gu.x - 2000, gu.y) === 2, 'съёмка: на 2 000 px — «отснято»');
  // буровая: обыск, «Буран»: починка → заправка → езда → бензин; в курумник не въехать
  const bal = Zones.obj('drillBalok'); go(bal.x, bal.y + 60);
  const k0 = Inv.cnt('kero', false); let guard = 0;
  while ((G.loot.drillBalok || []).length && guard++ < 20) { const c = Actions.context(); if (!c || c.k !== 'loot') break; Actions.interact(false); run(TUNE.zone.lootT + 0.1, () => { input.mx = input.my = 0; }); }
  ok(!G.loot.drillBalok.length && Inv.cnt('kero', false) > k0, 'буровая: балок обыскан, есть :kero:');
  const B = G.veh.buran; go(B.x + 30, B.y); G.hares = []; // заяц рядом (замер от героя) перехватил бы E «Поймать»
  const cf = Actions.context(); ok(cf && cf.k === 'vfix', '«Буран»: «Починить» ' + (cf && cf.k));
  Inv.add('scrap', 3); Inv.add('cable', 1); Actions.interact(false); run(TUNE.tr.fixT + 0.2, () => { input.mx = input.my = 0; });
  ok(B.fixed === 1, '«Буран» починен');
  Inv.add('kero', 1); Actions.interact(false); ok(B.fuel >= TUNE.tr.buranPx, '«Буран» заправлен: ' + B.fuel);
  p.cd = 0; const cm = Actions.context(); ok(cm && cm.k === 'veh', 'сесть на «Буран»'); Actions.interact(false);
  ok(p.ride === 'buran', 'верхом на «Буране»');
  out.buranSp = Math.round(Hero.speed()); ok(out.buranSp > 400, '«Буран» быстрый: ' + out.buranSp);
  const f0 = B.fuel, bx = p.x; run(2, () => { input.mx = 1; input.my = 0; }); input.mx = 0;
  out.buranPx = Math.round(p.x - bx); ok(out.buranPx > 600 && B.fuel < f0 - 500, `«Буран» проехал ${out.buranPx} px, бензин ${f0}→${Math.round(B.fuel)}`);
  const kz = Z('kurum'); const ox = p.x, oy = p.y; p.x = kz.x; p.y = kz.y; Transport.moved(ox, oy);
  ok(!p.ride && Math.hypot(B.x - ox, B.y - oy) < 40, '«Буран» в курумник не въехал — остался на краю');
  go(B.x + 20, B.y); p.cd = 0; G.hares = []; const c2 = Actions.context(); Actions.interact(false); ok(p.ride === 'buran', 'снова сел: ' + JSON.stringify(c2 && c2.k) + ' ' + JSON.stringify(B)); B.fuel = 5; run(0.5, () => { input.mx = 1; }); input.mx = 0;
  ok(!p.ride && B.fuel === 0, 'бензин кончился — слез');
  // метеостанция: прогноз
  const jr = Zones.obj('journal'); go(jr.x, jr.y + 40); G.storm = { a: tAt(G.day + 1, 11), b: tAt(G.day + 1, 13), omen: 0 };
  const cj = Actions.context(); ok(cj && cj.k === 'forecast', 'журнал метеостанции'); ok(/пурга завтра к 11:00/.test(Zones.forecast()), 'прогноз: ' + Zones.forecast()); G.storm = null;
  // зимник: по льду ×1,3
  const zy = Z('zimnik').y, zx = riverX(zy); go(zx, zy); G.gear.skis = 0; G.gear.sled = 0; p.skiOff = 0;
  ok(Zones.terrainKey(zx, zy) === 'trail', 'зимник: колея по льду');
  const spTrail = Hero.speed(); go(Z('drill').x + 300, Z('drill').y + 500); const spTaiga = Hero.speed();
  out.trail = +(spTrail / spTaiga).toFixed(2); ok(spTrail > spTaiga * 1.3, 'зимник быстрее целины ×' + out.trail);
  // стойбище: упряжка в аренду, олени быстрые, в гарь не идут, аренда кончается
  const pole = Zones.obj('pole'); go(pole.x, pole.y + 40); Inv.add('meat', 3);
  const cr = Actions.context(); ok(cr && cr.k === 'rent', 'шест стойбища: «Упряжка»'); Actions.interact(false);
  ok(G.veh.deer && Inv.cnt('meat', false) === 0, 'упряжка взята за :meat:3');
  const D = G.veh.deer; go(D.x + 20, D.y); p.cd = 0; Actions.interact(false); ok(p.ride === 'deer', 'в нартах');
  out.deerSp = Math.round(Hero.speed()); ok(out.deerSp >= 280, 'упряжка: ' + out.deerSp + ' px/с');
  // сам якорь зоны — теперь «натоптано» (camp: 200 у сгоревшего балка рядом, A6); берём точку в стороне, где terrainKey точно 'gar'
  const gz = Z('gar'); const dx0 = p.x, dy0 = p.y; p.x = gz.x - 300; p.y = gz.y - 300; Transport.moved(dx0, dy0); ok(!p.ride, 'олени в гарь не идут');
  G.day = D.until; G.time = tAt(G.day, 8); Transport.tick(); ok(!G.veh.deer, 'аренда кончилась — олени ушли');
  G.day = 2; day();

  // ---------- 4. быстрый переход ----------
  go(HUT.x, HUT.y + 200); heal(); G.wolves = []; G.pack = null; G.bear = null;
  G.zoneSeen.golets = 1; const t0 = G.time, fd0 = G.s.food;
  G.time = tAt(G.day, 23); ok(Transport.why('golets') === 'ночью не пройти', 'ночью перехода нет');
  G.time = tAt(G.day, 10); const tt = G.time;
  delete G.zoneSeen.naled; ok(Transport.why('naled') === 'сначала дойди сам', 'в неоткрытую зону — нельзя');
  const cost = Transport.cost('golets'); ok(Transport.travel('golets'), 'переход в голец');
  ok(Zones.idAt(p.x, p.y) === 'golets' && G.time - tt > 20 && G.s.food < fd0, `переход: ${(cost.h).toFixed(1)} ч, еда −${cost.food}`);
  out.travel = { h: +cost.h.toFixed(2), food: cost.food, warm: cost.warm };

  // ---------- 5. сейв: состояние зон и транспорта ----------
  G.marks.push({ x: 5000, y: 5000, k: 'wolf' });
  const s1 = SaveGame.snapshot(); out.saveKB = +(s1.length / 1024).toFixed(1);
  const old = G; SaveGame.load(s1);
  ok(G.veh.buran.fixed === 1 && G.loot.drillBalok.length === 0 && G.zoneSeen.golets === 1 && G.marks.length === old.marks.length && G.rocks.length === old.rocks.length, 'сейв: «Буран», обыск, зоны, пометки, глыбы');
  ok(SaveGame.snapshot() === s1, 'сейв: повторный save байт в байт');
  ok(s1.length < 100 * 1024, `сейв ${out.saveKB} КБ < 100`);
  G.time = tAt(G.day, 12); heal();
  return { out, fails };
}

// ======================= снаружи =======================
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const log = [], fail = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await pg.addInitScript(t => { try { localStorage.clear(); localStorage.setItem('sibir-tips', t); localStorage.setItem('sibir-quality', 'high'); } catch (e) {} }, TIPS);
    await pg.goto(URL); await pg.waitForTimeout(500);
    await pg.click('#start'); await pg.waitForTimeout(700);
    const r = await pg.evaluate(scene);
    const o = r.out;
    log.push(`мир ${o.W}² · соседи ${o.ring.join('/')} px · пешком ≤ ${o.walkSec} с, лыжи ≤ ${o.skiSec} с · генерация ${o.genMs} мс · деревьев ${o.trees}, глыб ${o.rocks}`);
    log.push(`«Буран» ${o.buranSp} px/с (${o.buranPx} px за 2 с) · упряжка ${o.deerSp} px/с · зимник ×${o.trail} · гарь: костёр ×${o.garBurn} · переход ${o.travel.h} ч, еда −${o.travel.food} · сейв ${o.saveKB} КБ`);
    for (const f of r.fails) { log.push('FAIL ' + f); fail.push(f); }

    // ---------- большая карта: M, пауза, клик по зоне → переход ----------
    await pg.evaluate(() => { document.querySelectorAll('#dialog,#note,#chapter').forEach(e => e.hidden = true); UI.closePanel(); G.p.x = HUT.x; G.p.y = HUT.y + 200; G.p.ride = null; G.zoneSeen.meteo = 1; G.wolves = []; G.time = tAt(G.day, 11); });
    await pg.keyboard.press('KeyM'); await pg.waitForTimeout(300);
    const m1 = await pg.evaluate(() => ({ vis: !document.getElementById('bigmap').hidden, kind: UI.kind, t: G.time }));
    await pg.waitForTimeout(400);
    const m2 = await pg.evaluate(() => G.time);
    if (!(m1.vis && m1.kind === 'map')) fail.push('карта: M открывает');
    if (m2 !== m1.t) fail.push('карта: игра на паузе');
    const pt = await pg.evaluate(() => { const r = document.getElementById('map-cv').getBoundingClientRect(), z = ZONES.meteo; return { x: r.left + z.x / W * r.width, y: r.top + z.y / H * r.height }; });
    await pg.mouse.click(pt.x, pt.y); await pg.waitForTimeout(200);
    const tip = await pg.evaluate(() => ({ vis: !document.getElementById('map-tip').hidden, txt: document.getElementById('map-tip').textContent, go: !!document.getElementById('map-go') }));
    if (!(tip.vis && /Метеостанция/.test(tip.txt) && tip.go)) fail.push('карта: клик по зоне — подсказка с «Идти» ' + JSON.stringify(tip));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.evaluate(() => { const g = Zones.obj('gurii'); Zones.survey(g.x, g.y); const m = Zones.obj('mast'); Zones.survey(m.x, m.y); WorldMap.draw(); }); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(SHOTS, 'map.png') }); }
    if (tip.go) { await pg.click('#map-go'); await pg.waitForTimeout(200); }
    const m3 = await pg.evaluate(() => ({ vis: !document.getElementById('bigmap').hidden, z: Zones.idAt(G.p.x, G.p.y) }));
    if (m3.vis || m3.z !== 'meteo') fail.push('карта: «Идти» → переход и карта закрыта ' + JSON.stringify(m3));
    await pg.keyboard.press('KeyM'); await pg.waitForTimeout(150); await pg.keyboard.press('KeyM'); await pg.waitForTimeout(150);
    if (await pg.evaluate(() => UI.modal())) fail.push('карта: M закрывает');
    log.push(`карта: M ✓ пауза ✓ зона → «Идти» ✓ (${m3.z})`);

    // ---------- снимки зон и транспорта → docs/research/img/world ----------
    if (SHOTS) {
      await pg.evaluate(() => { const st = document.createElement('style'); st.textContent = '#toasts,#zone,#goals,.tcol{display:none!important}'; document.head.appendChild(st); });
      const ids = await pg.evaluate(() => Zones.ACT.map(z => z.id));
      for (const id of ids) {
        await pg.evaluate(id => { const z = ZONES[id]; G.p.ride = null; G.p.x = z.x + (id === 'zimnik' ? 160 : id === 'kurum' ? 120 : 0); G.p.y = z.y + 170; G.time = tAt(G.day, 12.5); G.storm = null; G.s.hp = 100; G.s.warm = 100; GFX.lookAt(z.x, z.y + (id === 'drill' ? -10 : 30)); }, id);
        await pg.waitForTimeout(1600);
        await pg.screenshot({ path: path.join(SHOTS, `zone-${id}.png`) });
      }
      // транспорт: «Буран» и упряжка на ходу, вечер
      await pg.evaluate(() => { const z = ZONES.zimnik, y = z.y - 300; G.veh.buran.fixed = 1; G.veh.buran.fuel = 9000; G.p.ride = null; G.p.x = riverX(y); G.p.y = y; Transport.mount('buran'); G.time = tAt(G.day, 16.8); GFX.recenter(); input.my = 1; });
      await pg.waitForTimeout(1500); await pg.screenshot({ path: path.join(SHOTS, 'ride-buran.png') });
      await pg.evaluate(() => { input.my = 0; Transport.dismount(); const s = ZONES.stoibishe; G.veh.deer = { x: s.x + 200, y: s.y + 260, face: 1, until: G.day + 2 }; G.p.x = s.x + 200; G.p.y = s.y + 260; Transport.mount('deer'); G.time = tAt(G.day, 12); GFX.recenter(); input.mx = 1; });
      await pg.waitForTimeout(900); await pg.screenshot({ path: path.join(SHOTS, 'ride-deer.png') });
      await pg.evaluate(() => { input.mx = 0; Transport.dismount(); const z = ZONES.drill; G.p.x = z.x; G.p.y = z.y + 200; G.time = tAt(G.day, 22.5); GFX.lookAt(z.x, z.y); });
      await pg.waitForTimeout(1200); await pg.screenshot({ path: path.join(SHOTS, 'zone-drill-night.png') });
      log.push('снимки → docs/research/img/world/');
    }

    // ---------- кадр при CPU ×4: ночь, посёлок, мир ×9 ----------
    await pg.evaluate(() => {
      document.querySelectorAll('#dialog,#note,#chapter').forEach(e => e.hidden = true); UI.closePanel();
      G.p.ride = null; input.mx = input.my = 0;
      G.s.hp = 1e9; G.time = tAt(G.day, 22.5); G.col.ep = 2; G.storm = null;
      G.p.x = HUT.x + 60; G.p.y = HUT.y + 260;
      const spots = [[-260, 180], [260, 200], [-200, 380], [240, 400], [0, 480]];
      ['balok', 'woodshed', 'smoke', 'forge', 'tower'].forEach((t, i) => G.col.builds.push({ id: G.col.nextId++, type: t, x: HUT.x + spots[i][0], y: HUT.y + spots[i][1], prog: 1, done: 1, fuel: 60 }));
      ['bich', 'bich', 'bich', 'bich', 'bich', 'evenk', 'evenk', 'strelok', 'strelok', 'laika', 'bich', 'bich'].forEach((t, i) => Colony.spawn(t, { x: HUT.x - 150 + (i % 6) * 60, y: HUT.y + 300 + ((i / 6) | 0) * 60 }));
      G.fires.push({ x: HUT.x + 120, y: HUT.y + 330, fuel: 9999 }, { x: HUT.x - 120, y: HUT.y + 420, fuel: 9999 });
      G.hut.fuel = 900; Object.assign(G.hut, { walls: 1, door: 1 }); GFX.recenter();
      const raf = window.requestAnimationFrame.bind(window); window.__perf = [];
      window.requestAnimationFrame = cb => raf(t => { const a = performance.now(); cb(t); window.__perf.push(performance.now() - a); });
    });
    const cdp = await ctx.newCDPSession(pg);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const frame = async () => { await pg.waitForTimeout(2000); return pg.evaluate(() => new Promise(res => { window.__perf.length = 0; setTimeout(() => { const a = window.__perf.slice().sort((x, y) => x - y); res({ avg: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2), n: a.length }); }, 4000); })); };
    let fr = await frame(); if (fr.avg > 10) fr = await frame(); // замер шумный: один повтор
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    log.push(`кадр CPU ×4, ночь, посёлок, мир ×9: ${fr.avg} мс (p95 ${fr.p95}, ${fr.n} кадров) · цель ≤ 10`);
    if (fr.avg > 10) fail.push('кадр ' + fr.avg + ' мс > 10');
    for (const e of errs) { log.push(e); fail.push(e); }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  console.log(fail.length ? `ERR zones: ${fail.length} проверок не прошло` : 'zones: все проверки прошли');
  process.exitCode = fail.length ? 1 : 0;
})();
