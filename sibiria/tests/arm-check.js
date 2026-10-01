// Руки героя (js/art-people.js arm/armPts, позы idle/walk): замер по нарисованным кадрам (P.ar0/ar1 — экран и риг каждой руки).
//   len   — плечо→кончик варежки в долях роста (Drillis–Contini: плечо 0.186 + предплечье 0.146 + кисть 0.108 ≈ 0.44 H; в пуховике ≥ 0.40)
//   idle  — сгиб локтя в покое (рука почти прямая, 5–20°), кончик варежки у бедра (0.33–0.42 H от снега)
//   walk  — в профиль: плечо вперёд 14–30°, назад 10–25° (вперёд больше), локоть 5–22° сзади и 25–50° на махе вперёд
//   back/front — рука качается в глубину: на экране без «крючка» вбок (излом плечо / предплечье+варежка ≤ 22°, короткое — по доле длины), кончик варежки не уходит наружу от плеча (≤ 1.6 px),
//                мах читается по вертикали (кисть по экрану ходит вверх-вниз ≥ 0.8 px)
// В браузере: (0,eval)(await (await fetch('tests/arm-check.js')).text()); ArmCheck.run()
// Playwright:  cd tests && node arm-check.js   (playwright из tests/node_modules или NODE_PATH)
var ArmCheck = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, HGT = 42, D = 180 / Math.PI;
  const C = {   // коридоры (градусы / доли роста / px)
    len: [0.40, 0.46], idleFlex: [5, 20], idleTip: [0.33, 0.42],
    fwd: [14, 30], bwd: [10, 25], flexBack: [5, 22], flexFwd: [25, 50], flexGain: 10,
    kink: 22, outward: 1.6, vy: 0.8,
  };
  const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  function rec(mx, my, secWarm, sec, force, vy) {
    const p = G.p, P = ArtPeople.H.P, fr = [];
    let on = false;
    const draw0 = ArtPeople.draw;
    ArtPeople.draw = function (g, d) {
      if (d && d.key === p && force) { d = Object.assign({}, d, { anim: force }); if (vy != null) d.vy = vy; arguments[1] = d; }   // поза и ракурс — заданные (в снегу у кабины герой бредёт: trudge)
      const r = draw0.apply(this, arguments);
      if (on && d && d.key === p) fr.push({ y: d.y, anim: d.anim, a0: P.ar0.slice(), a1: P.ar1.slice(), sx: P.sx, sy: P.sy });
      return r;
    };
    try {
      for (let t = 0; t < secWarm + sec; t += DT) {
        on = t >= secWarm; input.mx = mx; input.my = my; update(DT); now += DT; GFX.lookAt(p.x, p.y - 20); GFX.render(DT, null);
      }
    } finally { ArtPeople.draw = draw0; input.mx = input.my = 0; }
    return fr;
  }
  function stats(fr, i, flat) {
    if (flat) fr = fr.filter(f => Math.abs(f.a0[0] - f.a1[0]) > 6);   // спина/анфас: без кадров разворота (плечи сходятся в профиль)
    const k = i ? 'a1' : 'a0', th = fr.map(f => f[k][8] * D), fl = fr.map(f => wrap(f[k][9]) * D);
    // излом на экране: плечо→локоть против локоть→кончик варежки (крючок предплечья с варежкой вбок; в глубину — короче, не вбок)
    const kink = fr.map(f => { const a = f[k], l = Math.hypot(a[6] - a[2], a[7] - a[3]); return l < 2 ? 0 : Math.abs(wrap(Math.atan2(a[7] - a[3], a[6] - a[2]) - Math.atan2(a[3] - a[1], a[2] - a[0]))) * D * Math.min(1, l / 5); });
    const out = fr.map(f => { const a = f[k], o = f[i ? 'a0' : 'a1']; return (a[6] - a[0]) * Math.sign(a[0] - o[0] || 1); });   // наружу — от другого плеча
    const wy = fr.map(f => f[k][5] - f[k][1]);
    // сгиб на крайних точках маха (по углу плеча)
    let iF = 0, iB = 0; th.forEach((v, j) => { if (v > th[iF]) iF = j; if (v < th[iB]) iB = j; });
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
    return { thMax: Math.max(...th), thMin: Math.min(...th), flMin: Math.min(...fl), flMax: Math.max(...fl), flAvg: avg(fl), flAtF: fl[iF], flAtB: fl[iB],
      kink: Math.max(...kink), kinkAvg: avg(kink), outMax: Math.max(...out), wyRange: Math.max(...wy) - Math.min(...wy),
      reach: avg(fr.map(f => f[k][10])), tip: avg(fr.map(f => (f[k][11] != null ? f[k][11] : f.y - f[k][7]) / HGT)) };
  }
  const r1 = v => Math.round(v * 10) / 10;
  function run() {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast };
    SaveGame.checkpoint = () => {}; Math.random = mulberry(7); Fx.toast = () => {};
    const res = { m: {}, fails: [] };
    try {
      newGame(); state = 'play'; G.time = tAt(1, 13); Hero.bodyReset(); GFX.setZoom && GFX.setZoom(3);
      const L = ArtPeople.H.LEN, len = (L.UA + L.FA + (L.MT || 3)) / HGT;
      res.m.len = +len.toFixed(3);
      const fail = (ok, msg) => { if (!ok) res.fails.push(msg); };
      fail(len >= C.len[0] && len <= C.len[1], 'len ' + len.toFixed(3));
      for (const [nm, mx, my] of [['side', 1, 0], ['back', 0, -1], ['front', 0, 1]]) {
        const p = G.p; UI.closePanel && UI.closePanel(); p.action = null; p.ride = null; p.sleeping = false; p.torch = 0;
        p.x = POI.cockpit.x + 80; p.y = POI.cockpit.y + (my < 0 ? 400 : 100); p.face = 1; Hero.snap(); Hero.bodyReset();
        G.wolves = []; G.bear = null; G.s.hp = G.s.food = G.s.warm = 100; G.storm = null;
        const W = rec(mx, my, 1.5, 2, 'walk'), I = rec(0, 0, 1.2, 1.5, 'idle', my);
        const fl = nm !== 'side', w0 = stats(W, 0, fl), w1 = stats(W, 1, fl), i0 = stats(I, 0, fl), i1 = stats(I, 1, fl);
        const m = res.m[nm] = { frames: W.length + '/' + I.length,
          walk: { fwd: r1(w0.thMax), bwd: r1(-w0.thMin), flex: [r1(w0.flMin), r1(w0.flMax)], flexAtFwd: r1(w0.flAtF), flexAtBwd: r1(w0.flAtB), kink: r1(Math.max(w0.kink, w1.kink)), out: r1(Math.max(w0.outMax, w1.outMax)), wy: r1(w0.wyRange) },
          idle: { flex: [r1(i0.flAvg), r1(i1.flAvg)], reach: r1(i0.reach), tip: +i0.tip.toFixed(3), kink: r1(Math.max(i0.kink, i1.kink)), out: r1(Math.max(i0.outMax, i1.outMax)) } };
        fail(W.length > 60 && I.length > 30, nm + ' мало кадров ' + m.frames);
        for (const [s, f] of [['near', i0], ['far', i1]]) fail(f.flAvg >= C.idleFlex[0] && f.flAvg <= C.idleFlex[1], nm + ' idle ' + s + ' сгиб ' + r1(f.flAvg));
        if (nm === 'side') {
          fail(i0.tip >= C.idleTip[0] && i0.tip <= C.idleTip[1], 'side idle кончик варежки ' + i0.tip.toFixed(3) + ' H');
          fail(w0.thMax >= C.fwd[0] && w0.thMax <= C.fwd[1], 'side walk плечо вперёд ' + r1(w0.thMax));
          fail(-w0.thMin >= C.bwd[0] && -w0.thMin <= C.bwd[1], 'side walk плечо назад ' + r1(-w0.thMin));
          fail(w0.thMax > -w0.thMin, 'side walk вперёд не больше, чем назад');
          fail(w0.flAtB >= C.flexBack[0] && w0.flAtB <= C.flexBack[1], 'side walk сгиб сзади ' + r1(w0.flAtB));
          fail(w0.flAtF >= C.flexFwd[0] && w0.flAtF <= C.flexFwd[1], 'side walk сгиб на махе вперёд ' + r1(w0.flAtF));
          fail(w0.flAtF - w0.flAtB >= C.flexGain, 'side walk сгиб вперёд − назад ' + r1(w0.flAtF - w0.flAtB));
        } else {
          fail(Math.max(w0.kink, w1.kink) <= C.kink, nm + ' walk излом руки на экране ' + r1(Math.max(w0.kink, w1.kink)) + '°');
          fail(Math.max(w0.outMax, w1.outMax) <= C.outward, nm + ' walk кисть наружу ' + r1(Math.max(w0.outMax, w1.outMax)) + ' px');
          fail(Math.max(i0.kink, i1.kink) <= C.kink, nm + ' idle излом ' + r1(Math.max(i0.kink, i1.kink)) + '°');
          fail(w0.wyRange >= C.vy, nm + ' walk мах в глубину не читается (кисть по вертикали ' + r1(w0.wyRange) + ' px)');
        }
      }
    } finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; }
    if (typeof console !== 'undefined') console.log('ArmCheck', res.fails.length, 'провалов', res.fails);
    return res;
  }
  return { run, C };
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
      const r = await pg.evaluate(() => ArmCheck.run());
      console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log(errs.join('\n'));
      process.exitCode = r.fails.length || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
