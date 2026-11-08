// Корпус и рюкзак позже ног (js/art-people.js: раздельный ракурс ног/корпуса, пружины рюкзака P.pkx/pky/pka в dynPost).
// В игре (update + render, шаг 1/60 с, без снега — DEPTH_OFF):
//   start — старт вбок: пик |pkx| ≥ 1.5 px через 80–150 мс после первого шага (рюкзак отстаёт)
//   stop  — остановка: перелёт рюкзака вперёд по ходу ≥ 1 px, затухание (|pkx| < 0.3 px навсегда) за < 0.6 с
//   back  — со спины на ходу: размах рюкзака вбок (полуразмах) ≥ 1.5 px, с частотой шага; |pkx| ≤ 3, |pky| ≤ 2, угол ≤ 4.1°
//   view  — бок → от камеры: корпус (P.vwT) проходит середину позже ног (P.vwL) на 50–120 мс
//   turn  — разворот вправо → влево: корпус меняет сторону (P.fcT) позже ног (P.fcL) на 60–80 мс
// В браузере: (0,eval)(await (await fetch('tests/body-lag.js')).text()); BodyLag.run()
// Playwright: cd tests && node body-lag.js
var BodyLag = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, P = () => ArtPeople.H.P;
  function frame(mx, my) { input.mx = mx; input.my = my; update(DT); now += DT; GFX.lookAt(G.p.x, G.p.y - 20); GFX.render(DT, null); }
  function base() {
    const p = G.p; UI.closePanel && UI.closePanel(); p.ride = null; p.sleeping = false; p.action = null; p.torch = 0;
    G.wolves = []; G.bear = null; G.s.hp = G.s.food = G.s.warm = 100; G.storm = null;
    p.x = POI.cockpit.x + 160; p.y = POI.cockpit.y + 400; p.face = 1; Hero.snap(); Hero.bodyReset();
    for (let i = 0; i < 60; i++) frame(0, 0);
  }
  const r2 = v => Math.round(v * 100) / 100;
  function run() {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast }, res = { m: {}, fails: [] };
    SaveGame.checkpoint = () => {}; Math.random = mulberry(5); Fx.toast = () => {}; window.DEPTH_OFF = true;
    const fail = (ok, msg) => { if (!ok) res.fails.push(msg); };
    try {
      newGame(); state = 'play'; G.time = tAt(1, 12); Hero.bodyReset(); GFX.setZoom && GFX.setZoom(3);
      // старт и остановка вбок
      base();
      let t0 = null, pk = 0, pkT = 0; const x0 = G.p.x;
      for (let i = 0; i < 60; i++) { frame(1, 0); if (t0 === null && G.p.x - x0 > 0.3) t0 = i * DT; const v = Math.abs(P().pkx); if (t0 !== null && v > pk) { pk = v; pkT = i * DT - t0; } }
      for (let i = 0; i < 60; i++) frame(1, 0);
      const run0 = P().pkx; let over = 0, quiet = 0, last = 0;
      for (let i = 0; i < 90; i++) { frame(0, 0); const v = P().pkx; over = Math.max(over, v * G.p.face); if (Math.abs(v) >= 0.3) last = (i + 1) * DT; }
      quiet = last;
      res.m.start = { peak: r2(pk), at: Math.round(pkT * 1000) }; res.m.stop = { moving: r2(run0), over: r2(over), settle: Math.round(quiet * 1000) };
      fail(pk >= 1.5, 'старт: пик рюкзака ' + r2(pk) + ' px < 1.5');
      fail(pkT >= 0.08 && pkT <= 0.15, 'старт: пик через ' + Math.round(pkT * 1000) + ' мс (нужно 80–150)');
      fail(over >= 1, 'остановка: перелёт ' + r2(over) + ' px < 1');
      fail(quiet < 0.6, 'остановка: затухание ' + Math.round(quiet * 1000) + ' мс ≥ 600');
      // со спины: раскачка вбок
      base(); for (let i = 0; i < 60; i++) frame(0, -1);
      let lo = 1e9, hi = -1e9, mxY = 0, mxA = 0, mxX = 0;
      for (let i = 0; i < 90; i++) { frame(0, -1); const q = P(); lo = Math.min(lo, q.pkx); hi = Math.max(hi, q.pkx); mxX = Math.max(mxX, Math.abs(q.pkx)); mxY = Math.max(mxY, Math.abs(q.pky)); mxA = Math.max(mxA, Math.abs(q.pka || 0)); }
      res.m.back = { amp: r2((hi - lo) / 2), maxX: r2(mxX), maxY: r2(mxY), deg: r2(mxA * 180 / Math.PI) };
      fail((hi - lo) / 2 >= 1.5, 'со спины: раскачка рюкзака ±' + r2((hi - lo) / 2) + ' px < 1.5');
      fail(mxX <= 3.001 && mxY <= 2.001 && mxA * 180 / Math.PI <= 4.1, 'рюкзак за пределами: ' + JSON.stringify(res.m.back));
      // бок → от камеры: корпус позже ног
      base(); for (let i = 0; i < 60; i++) frame(1, 0);
      let tl = null, tt = null;
      for (let i = 0; i < 60; i++) { frame(0, -1); const q = P(); if (tl === null && q.vwL < -0.5) tl = i * DT; if (tt === null && q.vwT < -0.5) tt = i * DT; }
      const lag = tl !== null && tt !== null ? (tt - tl) * 1000 : -1; res.m.view = { legs: tl && Math.round(tl * 1000), torso: tt && Math.round(tt * 1000), lag: Math.round(lag) };
      fail(lag >= 50 && lag <= 120, 'ракурс: корпус позже ног на ' + Math.round(lag) + ' мс (нужно 50–120)');
      // разворот: сторона корпуса позже сторон ног
      base(); for (let i = 0; i < 60; i++) frame(1, 0);
      let fl = null, ft = null;
      for (let i = 0; i < 40; i++) { frame(-1, 0); const q = P(); if (fl === null && q.fcL < 0) fl = i * DT; if (ft === null && q.fcT < 0) ft = i * DT; }
      const tlag = fl !== null && ft !== null ? (ft - fl) * 1000 : -1; res.m.turn = { lag: Math.round(tlag) };
      fail(tlag >= 60 && tlag <= 85, 'разворот: корпус позже ног на ' + Math.round(tlag) + ' мс (нужно 60–80)');
    } finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; window.DEPTH_OFF = false; input.mx = input.my = 0; }
    if (typeof console !== 'undefined') console.log('BodyLag', res.fails.length, 'провалов', res.fails);
    return res;
  }
  return { run };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  let pw; try { pw = require('playwright'); } catch (e) { pw = require(process.env.PW || 'playwright-core'); }
  const path = require('path'), fs = require('fs');
  (async () => {
    const b = await pw.chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(800);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      const r = await pg.evaluate(() => BodyLag.run());
      console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log(errs.join('\n'));
      process.exitCode = r.fails.length || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
