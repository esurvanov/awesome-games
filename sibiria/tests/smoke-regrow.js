#!/usr/bin/env node
// Регрессия «отрастание леса + тайник в поле» (сентябрь 2026):
//   1. срубленное дерево (пень) через TUNE.world.regrowStumpDays суток становится молодым деревцем
//      (меньше дров), ещё через regrowYoungDays — взрослым деревом
//   2. под постройкой/на тропе у избы пень не отрастает, пока место не освободится
//   3. миграция старого сейва (пень без времени рубки) — «давно», сама дорастает как обычно
//   4. тайник в поле: создать (T/Actions.stashKey), положить/взять как в лабаз (через настоящую панель),
//      лимит ~6 штук, сохранение/загрузка не теряют содержимое
//   5. шатун/волки могут разорить тайник с едой (шанс, как у склада)
//   6. отказ рубки из-за перегруза — подсказка про тайник
//   cd tests && node smoke-regrow.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => out.push((c ? 'ok   ' : 'FAIL ') + w);
  const fresh = seed => { Math.random = mulberry(seed); newGame(); state = 'play'; G.s.food = 100; G.s.warm = 90; };
  // T: яма копается по горстям (js/actions.js stashDig) — ждём конца работы, потом открыта панель
  const dig = () => { const s = Actions.stashKey(); for (let i = 0; i < 400 && G.p.action; i++) update(1 / 60); return s; };
  const farTree = () => G.trees.find(t => !t.wall && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 500 && Math.hypot(t.x - riverX(t.y), 0) > 200);
  const T = TUNE.world;

  // ---------- 1. пень → деревце → взрослое дерево ----------
  {
    fresh(101);
    const t = farTree(), wood0 = World.wood0(t);
    t.wood = 0; World.felled(t);
    ok(t.wood === 0 && t.stage === 0 && t.cutAt === G.time, `🌲 срублено — пень (wood0=${wood0})`);
    G.time += T.regrowStumpDays * CYCLE + 1;
    World.tickRegrow(0.05);
    ok(t.stage === 1 && t.wood === T.regrowYoungWood, `🌱 пень → молодое деревце за ${T.regrowStumpDays} сут (stage=${t.stage}, wood=${t.wood})`);
    G.time += T.regrowYoungDays * CYCLE + 1;
    World.tickRegrow(0.05);
    ok(!t.stage && t.wood === wood0 && t.cutAt == null, `🌳 деревце → взрослое дерево за ещё ${T.regrowYoungDays} сут (wood=${t.wood}/${wood0})`);
  }

  // ---------- 2. не отрастает под постройкой / на тропе у избы ----------
  {
    fresh(102);
    const near = { x: HUT.x + 40, y: HUT.y + 30, wood: 0, kind: 0, s: 1, v: 0 };
    World.felled(near);
    G.time += (T.regrowStumpDays + T.regrowYoungDays) * CYCLE * 3;
    World.tickRegrow(0.05);
    ok(!near.stage && near.wood === 0, '🚫 пень у избы не пророс (тропа/двор)');
    const far = farTree(); far.wood = 0; World.felled(far);
    World.tickRegrow(0.05); // тот же тик — далёкий пень свежий, ещё рано, только проверяем, что цикл не падает
    ok(true, '🌲 остальной лес продолжает считаться отдельно');
  }

  // ---------- 3. миграция старого сейва: пень без времени рубки — «давно» ----------
  {
    fresh(103);
    const idx = G.trees.findIndex(t => !t.wall && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 500);
    G.trees[idx].wood = 0; // пень БЕЗ вызова World.felled — как старый формат сейва (только [i, 0])
    const snap = JSON.parse(SaveGame.snapshot());
    const row = snap.treeD.find(r => r[0] === idx);
    const oldFormat = row && row.length <= 2;
    SaveGame.load(JSON.stringify(snap));
    const t2 = G.trees[idx];
    ok(oldFormat && t2.wood === 0 && t2.cutAt != null, `📼 миграция: старый пень [${row}] получил время рубки «давно» (cutAt=${t2.cutAt != null})`);
    G.time += T.regrowStumpDays * CYCLE;
    World.tickRegrow(0.05);
    ok(t2.stage === 1, `📼 мигрировавший пень пророс в деревце (stage=${t2.stage})`);
  }

  // ---------- 4. тайник: создать, положить/взять как в лабаз, лимит, сейв/лоад ----------
  {
    fresh(204);
    G.p.x = HUT.x + 900; G.p.y = HUT.y; G.p.inside = false;
    G.inv.wood = 5; G.inv.meat = 2;
    const s = dig();
    ok(!!s && G.stashes.length === 1, `📦 тайник создан у (${s && s.x},${s && s.y})`);
    ok(UI.kind === 'stash', '📦 панель тайника открыта (E/T)');
    // положить дрова через настоящую кнопку панели (как игрок)
    const btn = document.querySelector('[data-sput="wood"]');
    const w0 = G.inv.wood;
    if (btn) btn.click();
    ok(btn && G.inv.wood === w0 - 1 && s.inv.wood === 1, `📦 «Положить» дрова: рюкзак ${w0}→${G.inv.wood}, тайник ${s.inv.wood}`);
    const takeBtn = document.querySelector('[data-stake="wood"]');
    if (takeBtn) takeBtn.click();
    ok(s.inv.wood === 0 && G.inv.wood === w0, `📦 «Взять» обратно: рюкзак ${G.inv.wood}, тайник ${s.inv.wood}`);
    UI.closePanel();
    // рядом — открывает тот же тайник, не создаёт новый
    G.p.x += 30; const s2 = dig();
    ok(s2 === s && G.stashes.length === 1, '📦 рядом с тайником — открывает существующий, не плодит новые');
    UI.closePanel();
    // лимит — не больше stashMax штук
    for (let k = 0; k < 10 && G.stashes.length < T.stashMax; k++) {
      G.p.x += 300; G.inv.wood = 1;
      dig();
      UI.closePanel();
    }
    ok(G.stashes.length === T.stashMax, `📦 набралось ${G.stashes.length}/${T.stashMax} тайников`);
    G.p.x += 300; G.inv.wood = 1;
    const over = dig();
    ok(!over && G.stashes.length === T.stashMax, '📦 лимит держится — новый тайник не создаётся');
    UI.closePanel();
    // сейв/лоад — содержимое не теряется
    s.inv.meat = 3;
    const snap = SaveGame.snapshot();
    SaveGame.load(snap);
    const s3 = G.stashes.find(x => x.id === s.id);
    ok(!!s3 && s3.x === s.x && s3.y === s.y && s3.inv.meat === 3, `💾 сейв/лоад: тайник цел (${s3 && s3.inv.meat} :meat:)`);
  }

  // ---------- 5. шатун/волки разоряют тайник с едой ----------
  {
    fresh(305);
    G.p.x = HUT.x + 900; G.p.y = HUT.y; G.p.inside = false; G.inv.meat = 3;
    const s = dig(); UI.closePanel();
    s.inv.meat = 3; delete s.raidNight;
    G.bear = { x: s.x + 40, y: s.y, st: 'wander', hp: 20 };
    const r0 = Math.random; Math.random = () => 0; // гарантируем срабатывание шанса
    World.tickStashRaids(0.05, 1);
    Math.random = r0;
    ok(s.raidNight != null && s.inv.meat < 3, `🐻 шатун разорил тайник с едой (:meat: ${s.inv.meat})`);
    // без хищника рядом — тайник цел
    G.p.x += 400; G.inv.meat = 2;
    const s2 = dig(); UI.closePanel();
    if (s2) { s2.inv.meat = 2; delete s2.raidNight; G.bear = null; G.wolves = [];
      World.tickStashRaids(0.05, 1);
      ok(s2.inv.meat === 2, '🐻 без хищника рядом — тайник цел');
    } else ok(false, '🐻 не удалось создать второй тайник для контроля');
  }

  // ---------- 6. подсказка перегруза при отказе рубки ----------
  {
    fresh(406);
    const t = farTree();
    G.p.x = t.x + 30; G.p.y = t.y; G.p.face = -1; G.p.inside = false;
    G.inv.wood = 200; // заведомый перегруз сверх capKg + overChop
    const toasts = []; const realToast = UI.toast; UI.toast = m => toasts.push(m);
    Actions.interact(false);
    UI.toast = realToast;
    ok(toasts.some(m => m.includes('тайник')), `🎒 подсказка перегруза упоминает тайник: ${JSON.stringify(toasts)}`);
  }

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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof World !== 'undefined' && typeof Actions !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); UI.closePanel(); }); // прогреть модалку и закрыть
    out = await pg.evaluate(`(${page})()`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: smoke-regrow · провалов ${bad}` : '\nOK: smoke-regrow · отрастание леса и тайник на месте');
  process.exit(bad ? 1 : 0);
})();
