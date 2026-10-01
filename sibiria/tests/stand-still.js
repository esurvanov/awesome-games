// Стоящий без ввода герой не сдвигается и фигура не дёргается (жалоба: «стоит — и вдруг отскакивает назад»).
//   1. N с без ввода в разных местах (двор, у ели, после ходьбы — на свежей тропе, у лежачего ствола, в глубоком снегу,
//      в пургу, рядом с волком-разведчиком): смещение тела ≤ TOL, за кадр ≤ STEP
//   2. на гольце ветер сносит стоящего (задумано, zones.js windX) — плавно: за кадр ≤ STEP, без рывков
//   3. нарисованная фигура (риг ArtPeople.H.P: таз, опорные стопы) за кадр сдвигается ≤ FIG
//   4. Shift в составе сочетания (Cmd+Shift+4 — снимок экрана в macOS, Ctrl+Shift, Shift+буква, Shift+клик) не отскок;
//      чистое короткое нажатие Shift — отскок, как прежде; с вводом — сразу по направлению
// В браузере: (0,eval)(await (await fetch('tests/stand-still.js')).text()); StandStill.run()
// Playwright: cd tests && node stand-still.js
var StandStill = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, SEC = 12, TOL = 1, STEP = 2, FIG = 2.5;
  const P = () => G.p;
  let rig = null;
  function frame() {
    input.mx = input.my = 0; update(DT); now += DT;
    rig = null; GFX.lookAt(P().x, P().y); GFX.render(DT, null);
  }
  function base(x, y) {
    const p = P(); UI.closePanel(); p.ride = null; p.sleeping = false; p.action = null; p.dash = null; p.dashCd = 0; p.swing = 0; G.hurt = 0; input.act = false; input.auto = 0;
    G.wolves = []; G.bear = null; G.hares = []; G.deer = []; if (G.col) for (const u of G.col.units) u.hidden = true;
    G.s.hp = G.s.food = G.s.warm = 100; G.storm = null; G.logs = [];
    p.x = x; p.y = y; p.face = 1; Hero.snap(); Hero.bodyReset();
  }
  // кадры без ввода: путь тела и фигуры
  function watch(sec, o = {}) {
    const p = P(), x0 = p.x, y0 = p.y, r = { drift: 0, step: 0, fig: 0, figAt: null, anims: new Set() };
    let px = p.x, py = p.y, pr = null;
    for (let t = 0; t < sec; t += DT) {
      frame(); if (o.each) o.each();
      const d = Math.hypot(p.x - px, p.y - py); r.step = Math.max(r.step, d); px = p.x; py = p.y;
      r.anims.add(Hero.pose().anim);
      if (rig && pr && rig.anim === pr.anim) {   // смена позы — смешивание (ArtPeople blendPose), сравниваем внутри одной
        const m = Math.max(...rig.v.map((v, i) => Math.abs(v - pr.v[i])), ...(rig.l && pr.l ? rig.l.map((v, i) => Math.abs(v - pr.l[i])) : [0]));
        if (m > r.fig) { r.fig = m; r.figAt = { t: +t.toFixed(2), anim: rig.anim }; }
      }
      if (rig) pr = rig;
    }
    r.drift = Math.hypot(p.x - x0, p.y - y0); r.anims = [...r.anims].join(',');
    for (const k of ['drift', 'step', 'fig']) r[k] = +r[k].toFixed(2);
    return r;
  }
  const quiet = t => t.wood > 0 && !t.wall && !onIce(t.x, t.y) && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 400 && Zones.terrainKey(t.x, t.y) !== 'golets';
  function findSpot(ok) { for (let k = 0; k < 6000; k++) { const x = 300 + (k * 7919) % (W - 600), y = 300 + (k * 104729) % (H - 600); if (ok(x, y) && !World.blocked(x, y, 12)) return { x, y }; } return null; }
  const key = (type, code, m = {}) => dispatchEvent(new KeyboardEvent(type, Object.assign({ code, key: code, bubbles: true }, m)));
  function run(o = {}) {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast, draw: ArtPeople.draw };
    SaveGame.checkpoint = () => {}; Math.random = mulberry(o.seed || 3); Fx.toast = () => {};
    ArtPeople.draw = function (g, d) {
      const r = keep.draw.apply(this, arguments);
      if (d && d.key === G.p) { const Q = ArtPeople.H.P, pk = Q.pk; rig = { anim: d.anim, pk, v: [d.x + Q.ox, d.y + Q.oy, Q.hx, Q.hy, pk ? Q.pf0x : Q.f0x, pk ? Q.pf1x : Q.f1x], l: pk ? [Q.pl0, Q.pl1] : null }; /* вбок (pl) — только у закреплённых стоп */ }
      return r;
    };
    const fails = [], info = {};
    const ok = (c, m) => { if (!c) fails.push(m); };
    const still = (name, r, tol = TOL) => {
      info[name] = r;
      ok(r.drift <= tol, name + ': сдвиг без ввода ' + r.drift + ' px');
      ok(r.step <= STEP, name + ': рывок ' + r.step + ' px за кадр');
      ok(r.fig <= FIG, name + ': фигура дёрнулась ' + r.fig + ' ' + JSON.stringify(r.figAt));
    };
    try {
      newGame(); state = 'play'; G.time = tAt(1, 12); Hero.bodyReset();
      // 1. места
      base(HUT.x + 110, HUT.y + 170); still('двор', watch(SEC));
      const t = G.trees.filter(quiet)[3]; base(t.x + 24, t.y + 3); P().face = -1; still('у ели', watch(SEC));
      { // после ходьбы: тропа, следы, опора стоп
        const s = findSpot((x, y) => Zones.terrainKey(x, y) !== 'golets' && !onIce(x, y) && !World.blocked(x + 120, y, 14)); base(s.x, s.y);
        for (let k = 0; k < 120; k++) { input.mx = 1; input.my = 0; update(DT); now += DT; GFX.lookAt(P().x, P().y); GFX.render(DT, null); }
        frame(); frame(); frame(); frame(); frame(); frame(); // остановка (скорость гаснет)
        still('после ходьбы', watch(SEC));
      }
      { // у лежачего ствола (преграда после удара о землю): вплотную
        const s = findSpot((x, y) => Zones.terrainKey(x, y) !== 'golets' && !onIce(x, y) && !World.blocked(x + 60, y - 14, 20)); base(s.x, s.y);
        G.logs = [{ x: s.x - 20, y: s.y - 14, a: 0, len: 160, s: 1, kind: 0, v: 0, n: 4, n0: 4, t0: G.time, id: 901 }];
        frame(); const p = P(); p.lx = p.x; p.ly = p.y; still('у ствола', watch(SEC));
      }
      { const s = findSpot((x, y) => Zones.terrainKey(x, y) !== 'golets' && !onIce(x, y) && Depth.sinkAt(x, y) > 70); if (s) { base(s.x, s.y); for (let k = 0; k < 60; k++) frame(); still('глубокий снег', watch(SEC)); } else fails.push('нет места с глубоким снегом'); }
      base(HUT.x + 300, HUT.y + 320); G.storm = { a: G.time - 1, b: G.time + 999 }; still('пурга', watch(SEC));
      { const s = findSpot((x, y) => Zones.terrainKey(x, y) !== 'golets' && !onIce(x, y)); base(s.x, s.y); Wolves.at(0, 150, { st: 'scout', t: 99 }); still('волк рядом', watch(4, { each: () => { for (const w of G.wolves) { w.st = 'scout'; w.t = 99; } } })); }
      // 2. голец: снос ветром задуман — плавный
      { const s = findSpot((x, y) => Zones.terrainKey(x, y) === 'golets'); if (s) { base(s.x, s.y); const r = watch(4); info['голец (ветер)'] = r; ok(r.step <= STEP, 'голец: рывок ' + r.step + ' px за кадр'); ok(r.fig <= FIG, 'голец: фигура дёрнулась ' + r.fig); } }
      // 4. Shift: сочетания — не отскок; чистое нажатие — отскок
      const chord = (name, fn, want) => {
        base(HUT.x + 110, HUT.y + 170); frame(); const p = P(), x0 = p.x;
        fn(); for (let k = 0; k < 30; k++) frame();
        const d = Math.abs(p.x - x0); info['Shift: ' + name] = +d.toFixed(1);
        ok(want ? d > 30 : d < TOL, 'Shift ' + name + (want ? ': нет отскока ' : ': отскок ') + d.toFixed(1) + ' px');
      };
      chord('Cmd+Shift+4', () => { key('keydown', 'MetaLeft', { metaKey: true }); key('keydown', 'ShiftLeft', { metaKey: true, shiftKey: true }); key('keydown', 'Digit4', { metaKey: true, shiftKey: true }); key('keyup', 'Digit4', { metaKey: true, shiftKey: true }); key('keyup', 'ShiftLeft', { metaKey: true }); key('keyup', 'MetaLeft'); }, false);
      chord('Shift, затем Cmd+4', () => { key('keydown', 'ShiftLeft', { shiftKey: true }); key('keydown', 'MetaLeft', { metaKey: true, shiftKey: true }); key('keydown', 'Digit4', { metaKey: true, shiftKey: true }); key('keyup', 'MetaLeft', { shiftKey: true }); key('keyup', 'ShiftLeft'); }, false);
      chord('Ctrl+Shift', () => { key('keydown', 'ControlLeft', { ctrlKey: true }); key('keydown', 'ShiftLeft', { ctrlKey: true, shiftKey: true }); key('keyup', 'ShiftLeft', { ctrlKey: true }); key('keyup', 'ControlLeft'); }, false);
      chord('Shift+клик', () => { key('keydown', 'ShiftLeft', { shiftKey: true }); dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); key('keyup', 'ShiftLeft'); }, false);
      chord('чистое нажатие', () => { key('keydown', 'ShiftLeft', { shiftKey: true }); key('keyup', 'ShiftLeft'); }, true);
      { // с вводом — сразу на нажатии, по направлению
        base(HUT.x + 110, HUT.y + 170); frame(); const p = P(), x0 = p.x;
        input.mx = 1; key('keydown', 'ShiftLeft', { shiftKey: true }); input.mx = 0; ok(!!p.dash, 'Shift с вводом: отскок не сразу');
        key('keyup', 'ShiftLeft'); for (let k = 0; k < 30; k++) frame(); info['Shift: с вводом'] = +(p.x - x0).toFixed(1); ok(p.x - x0 > 30, 'Shift с вводом: не по направлению ' + (p.x - x0).toFixed(1));
      }
    } finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; ArtPeople.draw = keep.draw; input.mx = input.my = 0; }
    const res = { fails: fails.length, list: fails, info };
    if (typeof console !== 'undefined') console.log('StandStill', res.fails, 'провалов', res.list);
    return res;
  }
  return { run };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
  (async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.route(/^https?:/, r => r.abort());
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(800);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      const r = await pg.evaluate(() => StandStill.run());
      console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log(errs.join('\n'));
      process.exitCode = r.fails || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
