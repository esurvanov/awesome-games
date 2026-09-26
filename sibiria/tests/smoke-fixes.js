#!/usr/bin/env node
// Регрессия четырёх исправлений (рефакторинг «контент → данные», сентябрь 2026), детерминированно (сид):
//   1. печь со щелями держит самую длинную ночь сна (19:00 → 07:00), если загружена «до полна»
//   2. глава IV началась ночью (после осады) — шатун не выходит в эту ночь, выходит в следующую
//   3. дед стреляет в шатуна раз за ночь (уважение ≥ 2), а не раз за игру
//   4. печь берёт дрова сначала из лабаза, потом из рюкзака
//   cd tests && node smoke-fixes.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => out.push((c ? 'ok   ' : 'FAIL ') + w);
  const DT = 0.05;
  const run = (sec, stop) => { for (let i = 0, n = Math.round(sec / DT); i < n; i++) { if (stop && stop()) return true; if (state !== 'play') return false; update(DT); } return stop ? !!stop() : true; };
  const fresh = seed => { Math.random = mulberry(seed); newGame(); state = 'play'; G.s.food = 100; G.chest.can = 20; };
  const inHut = () => { const p = G.p; p.x = HUT.x + 20; p.y = HUT.y - 30; p.lx = p.x; p.ly = p.y; p.vx = p.vy = 0; input.mx = input.my = 0; p.inside = true; };
  const stoke = () => { for (let i = 0; i < 20; i++) { const f = G.hut.fuel; Stove.add(); if (G.hut.fuel <= f) break; } };
  // модалки (диалоги событий, карточки глав) закрыть — мир в тесте шагает сам
  const quiet = () => { UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; };

  // ---------- 1. печь со щелями держит ночь ----------
  for (const [walls, damper, want] of [[1, 0, true], [1, 1, true], [0, 0, false]]) {
    fresh(101); quiet();
    Object.assign(G.hut, { walls, damper, door: 1 }); G.chest.wood = 40; G.flags.stoveLit = 1;
    G.time = tAt(1, 19.0); inHut(); stoke();
    const full = G.hut.fuel;
    G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y; Actions.trySleep();
    const slept0 = G.p.sleeping;
    run(CYCLE * 0.6, () => !G.p.sleeping);
    const h = hourOf(), good = !!G.flags.slept && h >= 7 && h < 12;
    const tag = walls ? damper ? 'щели + заслонка' : 'щели' : 'без щелей';
    ok(slept0 && good === want, `🔥 ${tag}: полная печь ${full | 0} с (${Stove.maxLogs()} полен) с 19:00 → ${want ? 'проспал до утра' : 'погасла ночью (так задумано)'}: ${good ? 'утро' : 'проснулся'} в ${h.toFixed(1)} ч`);
  }

  // ---------- 2. глава IV ночью — шатун не в эту ночь ----------
  fresh(202); quiet();
  Object.assign(G.hut, { walls: 1, door: 1, damper: 1, fuel: 360 }); G.chest.wood = 200; G.flags.stoveLit = 1;
  G.chapter = 2; G.charge = 100; Object.assign(G.flags, { radioBuilt: 1, tube: 1, siegeDone: 1 }); G.fired.E5 = 1;
  G.time = tAt(3, 22.5); G.day = 3; G.lastDawn = 3; inHut();
  let bearAt = null;
  const guard = () => { if (G.hut.fuel < 200) stoke(); G.s.food = 100; G.s.hp = 100; if (G.bear && bearAt == null) bearAt = { d: G.day, h: hourOf() }; };
  run(1, () => G.chapter === 3);
  ok(G.chapter === 3, `📖 глава IV началась ночью (${hourOf().toFixed(1)} ч дня ${G.day})`);
  run(CYCLE * 0.45, () => { guard(); return G.day === 4 && hourOf() >= 12; });
  ok(bearAt == null, `🐻 ночь начала главы IV — шатун не вышел (передышка до следующей ночи)`);
  run(CYCLE * 0.5, () => { guard(); return bearAt != null || (G.day === 5 && hourOf() >= 7); });
  ok(bearAt && bearAt.d === 4 && bearAt.h >= 18, `🐻 следующая ночь — шатун вышел (${bearAt ? bearAt.h.toFixed(1) + ' ч дня ' + bearAt.d : 'нет'})`);

  // ---------- 3. дед стреляет раз за ночь ----------
  fresh(303); quiet();
  G.chapter = 3; G.urk.respect = 2; G.time = tAt(5, 22); G.day = 5;
  const p = G.p; p.x = POI.mar.x; p.y = POI.mar.y + 400;
  const bearNear = n => { G.bearNight = n; G.bear = { x: p.x + 150, y: p.y, hp: 20, hp0: 20, st: 'hunt', t: 3, face: 1, step: 0, cd: 1, stunCd: 0, pr: 0, tgt: 0, raid: 0, vx: 0, vy: 0 }; };
  const shots = [];
  for (const n of [5, 5, 6]) { bearNear(n); const hp = G.bear.hp; Bear.tick(0.05, 22, 1); shots.push(G.bear && G.bear.st === 'flee' && G.bear.hp < hp ? 1 : 0); }
  ok(shots.join() === '1,0,1', `🎯 дед стреляет: ночь 5 — да, снова ночь 5 — нет, ночь 6 — да (${shots.join(',')})`);

  // ---------- 4. печь: сначала из лабаза ----------
  fresh(404); inHut(); G.inv.wood = 3; G.chest.wood = 5; G.hut.fuel = 0;
  Stove.add();
  ok(G.chest.wood === 4 && G.inv.wood === 3 && G.hut.fuel > 0, `🪵 печь взяла полено из лабаза (лабаз 5→${G.chest.wood}, рюкзак 3→${G.inv.wood})`);
  G.chest.wood = 0; Stove.add();
  ok(G.inv.wood === 2, `🪵 лабаз пуст — из рюкзака (рюкзак → ${G.inv.wood})`);
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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Stove !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); }); // модалка держит главный цикл на паузе
    out = await pg.evaluate(`(${page})()`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: smoke-fixes · провалов ${bad}` : '\nOK: smoke-fixes · 4 исправления на месте');
  process.exit(bad ? 1 : 0);
})();
