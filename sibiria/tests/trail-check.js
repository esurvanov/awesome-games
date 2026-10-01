#!/usr/bin/env node
// Тропы и расчистка (js/trail.js): сетка уплотнения поверх глубины снега.
//   1. 3 прохода по тайге → pack ≥ 0.7, глубина ≤ 0.4 от целины, время прохода −25 % и больше; усталость на тропе меньше
//   2. заметание: штиль сутки — потеря ≤ 0.35; пурга 2 ч — заметено; после пурги один проход проявляет тропу (основа)
//   3. промотка ≈ шаги (тот же FILL при любом dt); «прошёл раз в день» — держится
//   4. сейв → загрузка: те же значения; сейв без поля — троп нет, без ошибок
//   5. лопата: взять у двери избы, расчистка → глубина < 10 см (у избы и в тайге), шаг втрое медленнее, усталость за замахи
//   6. ИИ (люди, волк) выбирают тропу (Depth.steer)
//   7. производительность: протаптывание < 0.05 мс/кадр, перепечка куска < 2 мс (high и low)
//   cd tests && node trail-check.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => out.push((c ? 'ok   ' : 'FAIL ') + w), r2 = v => Math.round(v * 100) / 100;
  const DT = 1 / 60;
  UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {}; SaveGame.checkpoint = () => {}; Fx.toast = () => {};
  const fresh = seed => { Math.random = mulberry(seed); newGame(); state = 'play'; G.s.food = 100; G.s.warm = 90; G.time = tAt(1, 11); G.storm = null; input.mx = input.my = 0; input.act = false; };
  const put = (x, y) => { const p = G.p; p.x = x; p.y = y; p.lx = x; p.ly = y; p.vx = p.vy = 0; p.inside = insideHut(x, y); Hero.snap(); };
  const R = mulberry(31);
  // ровная полоса тайги 300 px: целина ≥ 55 см, без деревьев и льда
  function row(zone = 'taiga', minD = 55, len = 300) {
    for (let k = 0; k < 80000; k++) {
      const x = 400 + R() * (W - 800), y = 400 + R() * (H - 800);
      if (Zones.terrainKey(x, y) !== zone || Space.trees.near(x + len / 2, y, len / 2 + 70).some(t => t.wood > 0 && Math.abs(t.y - y) < 70)) continue;
      let good = true;
      for (let i = -2; i <= len / 30 + 2 && good; i++) { const xx = x + i * 30; if (Zones.terrainKey(xx, y) !== zone || World.blocked(xx, y, 16) || onIce(xx, y) || Depth.depthAt(xx, y) < minD || Depth.depthAt(xx, y) > 95) good = false; }
      if (good) return { x, y };
    }
    throw new Error('нет полосы ' + zone);
  }
  const mid = (q, f) => { let s = 0, n = 0; for (let x = q.x + 60; x <= q.x + 240; x += 12) { s += f(x, q.y); n++; } return s / n; };
  const calm = fn => { const pr = Snow.printRate; Snow.printRate = s => (s ? Math.max(4, 0.25) : 0.25); try { return fn(); } finally { Snow.printRate = pr; } };
  // проход героя по полосе через главный шаг update (как игрок): время, средний провал, усталость
  function pass(q, dir) {
    const p = G.p; put(dir > 0 ? q.x - 20 : q.x + 320, q.y); input.mx = dir; input.my = 0;
    let t = 0, sink = 0, n = 0; const x0 = p.x, t0 = G.s.tire;
    while (Math.abs(p.x - x0) < 340 && t < 30) { update(DT); now += DT; t += DT; p.y = q.y; if (Math.abs(p.x - x0) > 20 && Math.abs(p.x - x0) < 320) { sink += Depth.heroSink; n++; } }
    input.mx = 0;
    return { t, sink: sink / Math.max(1, n), tire: G.s.tire - t0 };
  }

  // ---------- 1. три прохода ----------
  fresh(11); G.chapter = 1;
  const q = row(), d0 = mid(q, (x, y) => Depth.depthAt(x, y));
  // время прохода — отдельно по 300 px с середины (без разгона): x от q.x до q.x+300
  const P = [];
  calm(() => { for (let i = 0; i < 4; i++) { P.push(pass(q, i % 2 ? -1 : 1)); for (let k = 0; k < 3; k++) Depth.tick(0.5, false); } });
  out.push(`info полоса тайги (${Math.round(q.x)}, ${Math.round(q.y)}): целина ${d0.toFixed(0)} см, ходьба тайги ×${Zones.terrainAt(q.x, q.y).walk}`);
  out.push('info проходы: ' + P.map((r, i) => `${i + 1}) ${r.t.toFixed(2)} с · провал ${r.sink.toFixed(0)} см · силы −${r.tire.toFixed(3)}`).join(' | '));
  // pack после 1/2/3 проходов — заново, чистая полоса, считаем по середине
  fresh(11); const PK = [], DK = [];
  calm(() => { for (let i = 0; i < 3; i++) { pass(q, i % 2 ? -1 : 1); PK.push(mid(q, Trail.at)); DK.push(mid(q, (x, y) => Trail.depth(100, x, y) / 100)); } });
  ok(PK[0] < 0.5 && PK[1] < 0.7 && PK[2] >= 0.7, `👣 pack по проходам: ${PK.map(r2).join(' → ')} (3-й ≥ 0.7, тропа читается с 3-го)`);
  ok(DK[2] <= 0.4, `📏 глубина на тропе: ×${DK.map(r2).join(' → ')} от целины (${d0.toFixed(0)} → ${(d0 * DK[2]).toFixed(0)} см)`);
  const sp = 1 - P[3].t / P[0].t;
  ok(sp >= 0.25, `⏱ проход 340 px по тайге: целина ${P[0].t.toFixed(2)} с → по тропе ${P[3].t.toFixed(2)} с (−${Math.round(sp * 100)} %)`);
  ok(P[3].tire < P[0].tire * 0.7, `⚡ усталость за проход: целина ${P[0].tire.toFixed(3)} → тропа ${P[3].tire.toFixed(3)} (порог effort 22 см)`);
  { const p = G.p; put(q.x + 150, q.y); const ter = Zones.terrainAt(p.x, p.y); const hs = TUNE.hero.speed * ter.walk; Depth.tickHero(0.1); for (let i = 0; i < 10; i++) { p.moving = true; Depth.tickHero(0.05); }
    const v = Hero.speed() / hs; p.moving = false;
    ok(v > 1.25 && v <= 1.44, `🛤 скорость на тропе в тайге ×${r2(v)} от обычной (зимник — ×${r2(1 / ter.walk)})`); }

  // ---------- 2. заметание ----------
  const v0 = mid(q, Trail.at);
  calm(() => { for (let i = 0; i < 1440; i++) Depth.tick(1, false); });
  const v1 = mid(q, Trail.at);
  ok(v0 - v1 <= 0.35 && v0 - v1 >= 0.2, `🌙 штиль, игровые сутки (${CYCLE} с): ${r2(v0)} → ${r2(v1)} (−${r2(v0 - v1)})`);
  { fresh(11); calm(() => { for (let i = 0; i < 3; i++) pass(q, i % 2 ? -1 : 1); }); const a = mid(q, Trail.at); let h1 = -1;
    for (let i = 0; i < 2 * HOUR; i++) { Depth.tick(1, true); if (h1 < 0 && mid(q, Trail.at) <= 0.02) h1 = i; }
    const b = mid(q, Trail.at), dd = mid(q, (x, y) => Depth.depthAt(x, y));
    ok(b <= 0.02 && h1 > 0 && h1 <= 2 * HOUR, `🌨 пурга: ${r2(a)} → 0 за ${gameDur(h1)}; глубина снова ${dd.toFixed(0)} см (целина ${d0.toFixed(0)})`);
    calm(() => pass(q, 1)); const c = mid(q, Trail.at);
    ok(c >= 0.45, `🔁 после пурги один проход проявляет тропу: ${r2(c)} (на целине — ${r2(PK[0])})`); }

  // ---------- 3. промотка ≈ шаги; раз в день ----------
  { fresh(11); calm(() => pass(q, 1)); const f0 = Trail.fill, a = mid(q, Trail.at);
    calm(() => { for (let i = 0; i < 600; i++) Depth.tick(0.1, false); }); const s1 = mid(q, Trail.at), f1 = Trail.fill;
    fresh(11); calm(() => pass(q, 1)); const g0 = Trail.fill; calm(() => { for (let i = 0; i < 6; i++) Depth.tick(10, false); }); const s2 = mid(q, Trail.at), f2 = Trail.fill;
    ok(Math.abs(s1 - s2) < 1e-4 && Math.abs((f1 - f0) - (f2 - g0)) < 1e-3, `⏩ промотка: 600 шагов × 0.1 с → ${s1.toFixed(4)}, 6 шагов × 10 с → ${s2.toFixed(4)} (FILL +${(f1 - f0).toFixed(2)} / +${(f2 - g0).toFixed(2)})`);
    // настоящая промотка ночи (Actions.skipStart → update пачками) — тропа заметается так же, как по шагам
    fresh(11); calm(() => pass(q, 1)); G.time = tAt(1, 22); const fA = Trail.fill;
    calm(() => { for (let i = 0; i < 20 * 60; i++) update(0.05); }); const sA = mid(q, Trail.at), dA = Trail.fill - fA;
    ok(sA > 0 && dA > 0, `🌌 час в главном шаге: FILL +${dA.toFixed(1)}, тропа ${r2(sA)}`); }
  { fresh(11); const days = []; calm(() => { for (let d = 0; d < 6; d++) { pass(q, d % 2 ? -1 : 1); days.push(mid(q, Trail.at)); for (let i = 0; i < 1440; i++) Depth.tick(1, false); } });
    ok(days[5] >= 0.5, `📅 штиль, проход раз в сутки: после прохода ${days.map(r2).join(' · ')} — держится`); }

  // ---------- 4. сейв ----------
  { fresh(11); calm(() => { for (let i = 0; i < 3; i++) pass(q, i % 2 ? -1 : 1); }); calm(() => { for (let i = 0; i < 100; i++) Depth.tick(1, false); });
    const pts = []; for (let x = q.x; x < q.x + 300; x += 7) for (let dy = -12; dy <= 12; dy += 6) pts.push([x, q.y + dy]);
    const A = pts.map(([x, y]) => Trail.at(x, y)), json = SaveGame.snapshot(), sz = (JSON.parse(json).trailB || '').length;
    SaveGame.load(json); const B = pts.map(([x, y]) => Trail.at(x, y));
    let mx = 0; A.forEach((v, i) => { mx = Math.max(mx, Math.abs(v - B[i])); });
    ok(mx <= 1 / 255 + 1e-4 && A.some(v => v > 0.5), `💾 сейв → загрузка: ${pts.length} точек, расхождение ≤ ${mx.toFixed(4)}; trailB ${sz} симв. (${Trail.stats().blocks} блоков)`);
    const g = JSON.parse(json); delete g.trailB; delete g.trailF; let err = null; try { SaveGame.load(g); } catch (e) { err = e.message; }
    ok(!err && pts.every(([x, y]) => Trail.at(x, y) === 0), `📂 старый сейв без поля: грузится (${err || 'без ошибок'}), троп нет`); }

  // ---------- 5. лопата ----------
  { fresh(11); const p = G.p, S = Trail.SHOVEL; put(S.x + 4, S.y + 22);
    const c = Actions.context(); ok(c && c.k === 'shovel', `🪏 у двери избы: E «${c && c.label}»`);
    Actions.interact(); ok(!!G.gear.shovel && !Actions.context() || (Actions.context() || {}).k !== 'shovel', `🪏 лопата взята: снаряжение ${!!G.gear.shovel}, у двери больше не предлагается`);
    for (const [nm, x, y] of [['у избы', HUT.x + 150, HUT_IN.y1 + 90], ['в тайге', q.x + 150, q.y]]) {
      put(x, y); p.face = 1; for (let i = 0; i < 10; i++) update(DT);
      const d0 = Depth.depthAt(x + 12, y + 3), c2 = Actions.context();
      input.act = true; Actions.interact(); const t0 = G.s.tire; let t = 0; for (; t < 2.5; t += DT) { update(DT); now += DT; }
      input.act = false; update(DT);
      const d1 = Depth.depthAt(x + 12, y + 3), dt = G.s.tire - t0;
      ok(c2 && c2.k === 'clear' && d1 < 10, `🪏 расчистка ${nm} (E «${c2 && c2.label}», 2.5 с): ${d0.toFixed(0)} → ${d1.toFixed(1)} см · силы −${dt.toFixed(2)}`);
    }
    // на ходу: шаг втрое медленнее, позади — расчищенная полоса
    put(q.x + 20, q.y); p.face = 1; for (let i = 0; i < 30; i++) update(DT); const ter = Zones.terrainAt(p.x, p.y), c3 = Actions.context(); input.act = true; Actions.interact(); input.mx = 1; let t = 0; const x0 = p.x, k0 = p.action && p.action.k;
    for (; t < 6; t += DT) { update(DT); now += DT; p.y = q.y; }
    input.mx = 0; input.act = false; update(DT);
    const v = (p.x - x0) / t, area = (() => { let n = 0; for (let x = x0; x < p.x; x += 4) for (let dy = -32; dy <= 32; dy += 4) if (Trail.at(x, q.y + dy) > 0.9) n++; return n * 16 / 529; })();
    ok(v < TUNE.hero.speed * ter.walk * 0.4 && area > 0.5 && area / t < 1.2, `🚶 с лопатой на ходу: ${v.toFixed(0)} px/с (обычно ${(TUNE.hero.speed * ter.walk).toFixed(0)}), расчищено ${area.toFixed(1)} м² за ${t.toFixed(1)} с (${(t / area).toFixed(1)} с на м²; E «${c3 && c3.label}», действие ${k0}; x ${Math.round(x0 - q.x)}→${Math.round(p.x - q.x)}; ${[0, 20, 40, 60, 80].map(d => Trail.at(x0 + d, q.y).toFixed(2))})`);
    ok(RECIPES.some(r => r.id === 'shovel' && r.in.wood === 2 && r.in.scrap === 1 && r.at === 'bench'), `🛠 рецепт на верстаке: лопата = :wood:2 :scrap:1`); }

  // ---------- 6. ИИ выбирает тропу ----------
  { fresh(11); let u = null; // глубоко, наст слабый (на крепком насте волку тропа не нужна)
    for (let k = 0; k < 40000 && !u; k++) { const x = 400 + R() * (W - 800), y = 400 + R() * (H - 800); if (Zones.terrainKey(x, y) === 'taiga' && Depth.crustAt(x, y) < 0.3 && Depth.sinkAt(x, y - 34, 'wolf') > 25 && !World.blocked(x, y, 40)) u = { x, y }; }
    const a = -0.45, ux = Math.sin(a), uy = -Math.cos(a); // тропа влево-вверх под 0.45 рад, цель — прямо вверх
    for (let k = 0; k < 3; k++) for (let s = -20; s < 200; s += 6) Trail.stamp(u.x + ux * s, u.y + uy * s, Trail.PROF.p);
    const res = []; for (const kind of ['n', 'wolf', 'deer']) { const o = { x: u.x, y: u.y }; const v = Depth.steer(o, 0, -1, kind); res.push([kind, v]); }
    const good = res.every(([k, v]) => v && v.x < -0.2);
    ok(good, `🧭 обход по тропе: ${res.map(([k, v]) => `${k} → ${v ? `(${r2(v.x)}, ${r2(v.y)})` : 'прямо'}`).join(' · ')} (прямо ${Depth.sinkAt(u.x, u.y - 34, 'n').toFixed(0)} см, по тропе ${Depth.sinkAt(u.x + ux * 34, u.y + uy * 34, 'n').toFixed(0)} см)`); }

  // ---------- 7. производительность ----------
  { fresh(11); const st = Trail.step; let ms = 0, nCall = 0; Trail.step = function () { const t = performance.now(); st.apply(this, arguments); ms += performance.now() - t; nCall++; };
    let fr = 0; calm(() => { for (let i = 0; i < 3; i++) { const t = pass(q, i % 2 ? -1 : 1); fr += Math.round(t.t / DT); } }); Trail.step = st;
    const dA = (() => { const t = performance.now(); let s = 0; for (let i = 0; i < 20000; i++) s += Depth.depthAt(q.x + (i % 300), q.y + ((i / 300) | 0) % 20); return (performance.now() - t) / 20000 * 1000; })();
    ok(ms / fr < 0.05, `🏎 протаптывание (герой): ${(ms / fr * 1000).toFixed(1)} мкс/кадр (${nCall} вызовов, ${fr} кадров); depthAt на тропе ${dA.toFixed(2)} мкс`);
    out.push(`info память: ${JSON.stringify(Trail.stats())}`); }
  return out;
}

// рисунок: перепечка куска в high и low (в кадре — настоящий рендер)
function render() {
  const out = [];
  Math.random = mulberry(11); newGame(); state = 'play'; G.time = tAt(1, 12); G.storm = null;
  const p = G.p, x0 = HUT.x + 160, y0 = HUT_IN.y1 + 140;
  for (let k = 0; k < 3; k++) for (let x = -300; x < 300; x += 6) Trail.stamp(x0 + x, y0 + Math.sin(x / 90) * 40, Trail.PROF.p);
  for (let x = -60; x < 60; x += 6) for (let y = -20; y < 20; y += 6) Trail.shovel(x0 + x, y0 + 80 + y, 13, 1);
  p.x = x0; p.y = y0; p.lx = p.x; p.ly = p.y; Hero.snap();
  const res = {};
  for (const q of ['high', 'low']) {
    window.QUALITY = q; Trail.resetStats(); let fr = 0, mx = 0, sum = 0;
    for (let i = 0; i < 40; i++) { now += 1 / 30; const t = performance.now(); GFX.lookAt(p.x, p.y); GFX.render(1 / 30, null); const d = performance.now() - t; sum += d; fr++; }
    const s = Trail.stats(); res[q] = s;
    out.push((s.bakeMed < 2 && s.bakeMs < 5 ? 'ok   ' : 'FAIL ') + `🎨 ${q}: перепечка куска — медиана ${s.bakeMed} мс, худшая ${s.bakeMs} мс (${s.bakes} печей, ≤ 1 за кадр), кадр в среднем ${(sum / fr).toFixed(1)} мс`);
  }
  window.QUALITY = 'high';
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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Trail !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); document.getElementById('menu').hidden = true; });
    out = await pg.evaluate(`(${page})()`);
    out = out.concat(await pg.evaluate(`(${render})()`));
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: trail-check · провалов ${bad}` : `\nOK: trail-check · ${out.filter(l => !l.startsWith('info')).length} проверок`);
  process.exit(bad ? 1 : 0);
})();
