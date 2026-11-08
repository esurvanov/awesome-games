// Руки героя (js/art-people.js arm/armPts, позы idle/walk): замер по нарисованным кадрам (P.ar0/ar1 — экран и риг каждой руки).
//   len   — плечо→кончик варежки в долях роста (Drillis–Contini: плечо 0.186 + предплечье 0.146 + кисть 0.108 ≈ 0.44 H; в пуховике ≥ 0.40)
//   idle  — сгиб локтя в покое (рука почти прямая, 5–20°), кончик варежки у бедра (0.33–0.42 H от снега)
//   Руки по скорости (art-people swingArms/runW): медленно — маятник ходьбы, на скорости героя — руки бега, между — плавное смешивание.
//   slow (40 px/с, NPC-шаг) — в профиль: плечо вперёд 14–30°, назад 10–25° (вперёд больше), локоть 5–22° сзади и 25–50° на махе вперёд
//   fast (165 px/с ≈ 7 м/с, лёгкий бег героя, в игре) — в профиль: плечо вперёд 18–35°, назад 35–50° (назад больше), локоть 75–100° весь цикл,
//                кисть не выше груди (запястье ≥ 3 px ниже плеча в риге)
//   mid (115 px/с, целина) — сгиб локтя и размах между slow и fast (без скачка позы)
//   back/front — рука качается в глубину: на экране без «крючка» вбок (slow: излом плечо / предплечье+варежка ≤ 22°, короткое — по доле длины;
//                fast: локоть ≈90° — предплечье уходит в глубину и на экране складывается вверх/вниз, излом не меряем; кисть бега идёт к середине корпуса,
//                но не за неё: кончик варежки внутрь от плеча ≤ 5 px),
//                кончик варежки не уходит наружу от плеча (≤ 1.6 px), мах читается по вертикали (кисть по экрану ходит вверх-вниз ≥ 0.8 px;
//                кончик варежки ≥ 3 px; со спины на бегу ≥ 2.5 — локоть 90°, предплечье уходит в глубину), запястье на экране ниже плеча ≥ 0.45·(плечо+предплечье), ближняя варежка крупнее в 1.03–1.08
// В браузере: (0,eval)(await (await fetch('tests/arm-check.js')).text()); ArmCheck.run()
// Playwright:  cd tests && node arm-check.js   (playwright из tests/node_modules или NODE_PATH)
var ArmCheck = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, HGT = 42, D = 180 / Math.PI;
  const C = {   // коридоры (градусы / доли роста / px)
    len: [0.40, 0.46], idleFlex: [5, 20], idleTip: [0.33, 0.42],
    fwd: [14, 30], bwd: [10, 25], flexBack: [5, 22], flexFwd: [25, 50], flexGain: 10,   // slow
    runFwd: [18, 35], runBwd: [35, 50], runFlex: [75, 100], runWrist: 3, inward: 5,     // fast
    kink: 22, outward: 1.6, vy: 0.8, vyDeep: 3, vyDeepRun: 2.5, below: 0.45, mitt: [1.03, 1.08],   // спереди/сзади: ход кисти по y, кисть под плечом (доля плечо+предплечье), ближняя варежка крупнее
  };
  // синтетический шаг со скоростью v (px/с): тот же рисунок героя (шаблон d из игры), фаза и походка — от пути, как в gfx.stepPhase
  function synth(d0, v, vy, sec) {
    const P = ArtPeople.H.P, g = document.createElement('canvas').getContext('2d'), gt = ArtPeople.gaitFor('walk', v, vy), key = {}, fr = [];
    let ph = 0, x = 0, y = 0;
    for (let t = 0; t < 1 + sec; t += DT) {
      const s = v * DT; ph += ArtPeople.advance(s, gt); if (vy) y += s * vy; else x += s;
      const d = Object.assign({}, d0, { key, x, y, vy, t: 100 + t, phase: ph, gait: gt, speed: Math.min(1, v / 200), anim: 'walk', sel: false, onStep: null });
      ArtPeople.draw(g, d, { now: d.t, night: 0, light() {}, spark() {} });
      if (t >= 1) fr.push({ y, anim: 'walk', vy, vt: P.vwT, a0: P.ar0.slice(), a1: P.ar1.slice(), sx: P.sx, sy: P.sy, w0: P.h0y - P.sy, w1: P.h1y - P.sy });
    }
    return fr;
  }
  const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  let TPL = null;   // шаблон рисунка героя для synth
  function rec(mx, my, secWarm, sec, force, vy) {
    const p = G.p, P = ArtPeople.H.P, fr = [];
    let on = false;
    const draw0 = ArtPeople.draw;
    ArtPeople.draw = function (g, d) {
      if (d && d.key === p && force) { d = Object.assign({}, d, { anim: force }); if (vy != null) d.vy = vy; arguments[1] = d; }   // поза и ракурс — заданные (в снегу у кабины герой бредёт: trudge)
      const r = draw0.apply(this, arguments);
      if (on && d && d.key === p) { fr.push({ y: d.y, anim: d.anim, vy: d.vy, vt: P.vwT, a0: P.ar0.slice(), a1: P.ar1.slice(), sx: P.sx, sy: P.sy, w0: P.h0y - P.sy, w1: P.h1y - P.sy, v: d.gait ? d.gait.v : 0 }); if (d.gait) TPL = d; }
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
    // спина/анфас: без кадров разворота (плечи сходятся в профиль; ракурс ещё не встал — упёрся в стену/трогается: vy рисунка не ±1).
    // Руки — на корпусе, а корпус догоняет ноги по ракурсу пружиной (art-people VLAG): «встал» — по ракурсу корпуса (P.vwT), не ног (d.vy)
    if (flat) fr = fr.filter(f => { const v = f.vt != null ? f.vt : f.vy; return Math.abs(f.a0[0] - f.a1[0]) > 6 && (v == null || Math.abs(v) > 0.95); });
    const k = i ? 'a1' : 'a0', th = fr.map(f => f[k][8] * D), fl = fr.map(f => wrap(f[k][9]) * D);
    // излом на экране: плечо→локоть против локоть→кончик варежки (крючок предплечья с варежкой вбок; в глубину — короче, не вбок)
    const kink = fr.map(f => { const a = f[k], l = Math.hypot(a[6] - a[2], a[7] - a[3]); return l < 2 ? 0 : Math.abs(wrap(Math.atan2(a[7] - a[3], a[6] - a[2]) - Math.atan2(a[3] - a[1], a[2] - a[0]))) * D * Math.min(1, l / 5); });
    const out = fr.map(f => { const a = f[k], o = f[i ? 'a0' : 'a1']; return (a[6] - a[0]) * Math.sign(a[0] - o[0] || 1); });   // наружу — от другого плеча
    const wy = fr.map(f => f[k][5] - f[k][1]);
    // сгиб на крайних точках маха (по углу плеча)
    let iF = 0, iB = 0; th.forEach((v, j) => { if (v > th[iF]) iF = j; if (v < th[iB]) iB = j; });
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
    return { thMax: Math.max(...th), thMin: Math.min(...th), flMin: Math.min(...fl), flMax: Math.max(...fl), flAvg: avg(fl), flAtF: fl[iF], flAtB: fl[iB],
      kink: Math.max(...kink), kinkAvg: avg(kink), outMax: Math.max(...out), wyRange: Math.max(...wy) - Math.min(...wy), inMax: -Math.min(...out),
      wrist: Math.min(...fr.map(f => f[i ? 'w1' : 'w0'])), below: Math.min(...fr.map(f => f[k][5] - f[k][1])), hy: (() => { const h = fr.map(f => f[k][7] - f[k][1]); return Math.max(...h) - Math.min(...h); })(), mitt: Math.max(...fr.map(f => f[k][12] || 1)),
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
        p.x = POI.cockpit.x + 80; p.y = POI.cockpit.y + (my < 0 ? 700 : 100); p.face = 1; Hero.snap(); Hero.bodyReset();
        G.wolves = []; G.bear = null; G.s.hp = G.s.food = G.s.warm = 100; G.storm = null;
        // fast — в игре (герой 165 px/с, кадры с походкой); slow/mid — тот же рисунок синтетическим шагом 40 и 115 px/с
        const W = rec(mx, my, 1.5, 2, 'walk').filter(f => f.v > 150), I = rec(0, 0, 1.2, 1.5, 'idle', my);
        const S = synth(TPL, 40, my, 2), Md = synth(TPL, 115, my, 2);
        const fl = nm !== 'side', w0 = stats(W, 0, fl), w1 = stats(W, 1, fl), s0 = stats(S, 0, fl), s1 = stats(S, 1, fl), m0 = stats(Md, 0, fl), i0 = stats(I, 0, fl), i1 = stats(I, 1, fl);
        const sum = (a, b) => ({ fwd: r1(a.thMax), bwd: r1(-a.thMin), flex: [r1(a.flMin), r1(a.flMax)], flexAtFwd: r1(a.flAtF), flexAtBwd: r1(a.flAtB), wrist: r1(a.wrist), kink: r1(Math.max(a.kink, b.kink)), inw: r1(Math.max(a.inMax, b.inMax)), out: r1(Math.max(a.outMax, b.outMax)), wy: r1(a.wyRange), below: r1(Math.min(a.below, b.below)), mitt: +Math.max(a.mitt, b.mitt).toFixed(3) });
        const m = res.m[nm] = { frames: W.length + '/' + S.length + '/' + I.length, fast: sum(w0, w1), mid: sum(m0, stats(Md, 1, fl)), slow: sum(s0, s1),
          idle: { flex: [r1(i0.flAvg), r1(i1.flAvg)], reach: r1(i0.reach), tip: +i0.tip.toFixed(3), kink: r1(Math.max(i0.kink, i1.kink)), out: r1(Math.max(i0.outMax, i1.outMax)) } };
        fail(W.length > 60 && S.length > 60 && I.length > 30, nm + ' мало кадров ' + m.frames);
        for (const [s, f] of [['near', i0], ['far', i1]]) fail(f.flAvg >= C.idleFlex[0] && f.flAvg <= C.idleFlex[1], nm + ' idle ' + s + ' сгиб ' + r1(f.flAvg));
        if (nm === 'side') {
          fail(i0.tip >= C.idleTip[0] && i0.tip <= C.idleTip[1], 'side idle кончик варежки ' + i0.tip.toFixed(3) + ' H');
          // медленно — ходьба
          fail(s0.thMax >= C.fwd[0] && s0.thMax <= C.fwd[1], 'side slow плечо вперёд ' + r1(s0.thMax));
          fail(-s0.thMin >= C.bwd[0] && -s0.thMin <= C.bwd[1], 'side slow плечо назад ' + r1(-s0.thMin));
          fail(s0.thMax > -s0.thMin, 'side slow вперёд не больше, чем назад');
          fail(s0.flAtB >= C.flexBack[0] && s0.flAtB <= C.flexBack[1], 'side slow сгиб сзади ' + r1(s0.flAtB));
          fail(s0.flAtF >= C.flexFwd[0] && s0.flAtF <= C.flexFwd[1], 'side slow сгиб на махе вперёд ' + r1(s0.flAtF));
          fail(s0.flAtF - s0.flAtB >= C.flexGain, 'side slow сгиб вперёд − назад ' + r1(s0.flAtF - s0.flAtB));
          // скорость героя — бег
          fail(w0.thMax >= C.runFwd[0] && w0.thMax <= C.runFwd[1], 'side fast плечо вперёд ' + r1(w0.thMax));
          fail(-w0.thMin >= C.runBwd[0] && -w0.thMin <= C.runBwd[1], 'side fast плечо назад ' + r1(-w0.thMin));
          fail(-w0.thMin > w0.thMax, 'side fast назад не больше, чем вперёд');
          fail(w0.flMin >= C.runFlex[0] && w0.flMax <= C.runFlex[1], 'side fast сгиб локтя ' + r1(w0.flMin) + '…' + r1(w0.flMax));
          fail(w0.wrist >= C.runWrist, 'side fast кисть выше груди (запястье ' + r1(w0.wrist) + ' px под плечом)');
          // между — смешивание без скачка
          fail(m0.flAvg > s0.flAvg && m0.flAvg < w0.flAvg, 'side mid сгиб не между slow и fast ' + r1(m0.flAvg));
          fail(-m0.thMin > -s0.thMin && -m0.thMin < -w0.thMin, 'side mid плечо назад не между ' + r1(-m0.thMin));
        } else {
          fail(Math.max(s0.kink, s1.kink) <= C.kink, nm + ' slow излом руки на экране ' + r1(Math.max(s0.kink, s1.kink)) + '°');
          fail(Math.max(w0.inMax, w1.inMax) <= C.inward, nm + ' fast кисть за середину корпуса ' + r1(Math.max(w0.inMax, w1.inMax)) + ' px');
          for (const [s, a, b] of [['slow', s0, s1], ['fast', w0, w1]]) {
            fail(Math.max(a.outMax, b.outMax) <= C.outward, nm + ' ' + s + ' кисть наружу ' + r1(Math.max(a.outMax, b.outMax)) + ' px');
            fail(a.wyRange >= C.vy, nm + ' ' + s + ' мах в глубину не читается (кисть по вертикали ' + r1(a.wyRange) + ' px)');
          }
          // мах в глубину честно: ход кисти по экрану ≥ 3 px (быстро и средне), кисть от камеры не «подогнута» к плечу, ближняя варежка крупнее
          const LA = ArtPeople.H.LEN.UA + ArtPeople.H.LEN.FA;
          for (const [s, a, b] of [['slow', s0, s1], ['mid', m0, stats(Md, 1, fl)], ['fast', w0, w1]]) { const v = Math.max(a.hy, b.hy); m[s].hy = r1(v); const lim = nm === 'back' && s === 'fast' ? C.vyDeepRun : C.vyDeep; fail(v >= lim, nm + ' ' + s + ' ход кисти (кончик варежки) по y ' + r1(v) + ' px < ' + lim); }
          for (const [s, a, b] of [['slow', s0, s1], ['mid', m0, stats(Md, 1, fl)], ['fast', w0, w1]]) fail(Math.min(a.below, b.below) >= C.below * LA, nm + ' ' + s + ' кисть высоко: ' + r1(Math.min(a.below, b.below)) + ' px под плечом < ' + r1(C.below * LA));
          { const mt = Math.max(w0.mitt, w1.mitt, m0.mitt); if (nm === 'front') fail(mt >= C.mitt[0] && mt <= C.mitt[1], nm + ' масштаб ближней варежки ' + mt.toFixed(3)); else fail(mt <= C.mitt[1], nm + ' масштаб варежки ' + mt.toFixed(3)); }   // со спины к камере идёт кисть сзади — ход в глубину мал
          fail(Math.max(i0.kink, i1.kink) <= C.kink, nm + ' idle излом ' + r1(Math.max(i0.kink, i1.kink)) + '°');
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
