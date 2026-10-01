// Походка героя против клинических кривых (Winter 1991, Perry 1992): углы колена, бедра, голеностопа, стопы к полу по % цикла,
// ход таза, частота шагов, доля опоры, проскальзывание опорной стопы, стабилизация головы, движение корпуса.
// Ходьба в игре (update + render), с рига снимаются P.lg0/P.lg1 = [таз x,y, колено x,y, щиколотка x,y, угол бедра, угол голени, угол стопы]
// (углы — в сагиттальной плоскости рига, y вниз; стопа > 0 — носок вниз) и стойка стоп P.st0/P.st1.
// Цикл: постановка (st 0→1) → отрыв (1→0) → постановка. Опора нормируется на 0–60 %, перенос — на 60–100 % (как у человека):
// при скорости героя (165 px/с ≈ 4 роста/с — человеку это бег) доля опоры меньше человеческой, сравниваем форму кривых по событиям.
// В браузере: (0,eval)(await (await fetch('tests/gait-angles.js')).text()); GaitAngles.run()
// Playwright:  cd tests && node gait-angles.js [--shots DIR] [--json FILE] [--raw FILE] [--modes walk,trudge] [--views] [--low]
var GaitAngles = (() => {
  if (typeof window === 'undefined') return null;
  const D2 = 180 / Math.PI, H = 42;   // рост фигуры, px
  const at = (tab, x) => { for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return tab[tab.length - 1][1]; };
  // эталон: [% цикла, градусы]. Колено — сгиб (0 — прямое); бедро — от вертикали (+ вперёд); стопа — к полу (+ носок вверх); голеностоп — тыльное сгибание +
  const REF = {
    knee: [[0, 4], [5, 10], [10, 16], [15, 19], [20, 17], [30, 10], [40, 6], [50, 12], [60, 36], [65, 50], [70, 60], [75, 60], [80, 52], [85, 38], [90, 20], [95, 7], [100, 4]],
    thigh: [[0, 22], [10, 20], [20, 14], [30, 6], [40, -2], [50, -10], [55, -13], [60, -12], [65, -6], [70, 2], [75, 10], [80, 17], [85, 21], [90, 23], [95, 23], [100, 22]],
    foot: null,   // стопа к полу = наклон голени (бедро − колено) + голеностоп: считается ниже из трёх кривых
    ankle: [[0, 0], [5, -5], [10, -4], [20, 4], [30, 8], [40, 10], [48, 8], [55, -4], [60, -14], [65, -16], [70, -10], [80, -2], [90, 0], [100, 0]],
  };
  REF.foot = REF.ankle.map(([x, an]) => [x, at(REF.thigh, x) - at(REF.knee, x) + an]);
  const TOL = { knee: 12, thigh: 10, foot: 14, ankle: 12 };   // ≈ 2 SD нормы
  // ситуационные ходьбы: колено в переносе (глубокий снег — выше, вымотан/мёрзнет — ниже), пределы своих коридоров
  const MODE = {
    walk: { swing: 1 },
    trudge: { swing: 1.35, mul: 0.7, cad: 5.8, kb: 8 },   // колени в опоре согнуты сильнее (снег держит), шаг короче — чаще   // по колено: скорость ×0.7 (js/depth.js)
    shield: { swing: 0.95, storm: 1 },
    tired: { swing: 0.75, food: 5 },
    cold: { swing: 0.8, warm: 12 },
  };
  const refOf = (k, x, m) => { const v = at(REF[k], x); return k === 'knee' && x > 55 ? v * m.swing : k === 'knee' ? v + (m.kb || 0) * Math.sin(Math.PI * Math.min(1, x / 48)) : k === 'thigh' && x > 60 ? v * (0.5 + 0.5 * m.swing) : v; };

  // съёмка: идёт вправо (side), вверх (back) или вниз (front); rec — кадры рига
  function capture(mode, dir, sec, keepDraws) {
    const P = ArtPeople.H.P, m = MODE[mode] || MODE.walk, p = G.p;
    UI.closePanel && UI.closePanel(); p.action = null; p.ride = null; p.sleeping = false; p.torch = 0; p.inside = false;
    p.x = POI.cockpit.x + 80; p.y = POI.cockpit.y + (dir === 'back' ? 600 : 200); p.face = 1; Hero.snap(); Hero.bodyReset();
    G.wolves = []; G.bear = null; G.s.hp = 100; G.s.food = m.food || 100; G.s.warm = m.warm || 100;
    G.storm = m.storm ? { a: G.time - 1, b: G.time + 99 } : null;
    const mx = dir === 'side' ? 1 : 0, my = dir === 'back' ? -1 : dir === 'front' ? 1 : 0;
    const rec = [], draws = [];
    const pose0 = Hero.pose, draw0 = ArtPeople.draw, sol0 = World.solid;
    World.solid = () => null;   // путь без препятствий (деревья, камни): ходьба ровная
    Hero.pose = function () { const r = pose0.apply(this, arguments); if (r.loco && r.anim !== 'run') r.anim = mode; return r; };
    let on = false;
    ArtPeople.draw = function (g, d) {
      if (d && d.key === p) {
        if (d.anim !== mode && d.gait) d = Object.assign({}, d, { anim: mode });
        const r = draw0.apply(this, [g, d, arguments[2]]);
        if (on && (!rec.length || rec[rec.length - 1].t !== d.t)) {
          rec.push({ t: d.t, x: d.x, y: d.y, ph: d.phase, St: d.gait ? d.gait.St : 0, duty: d.gait ? d.gait.duty : 0, v: d.gait ? d.gait.v : 0,
            st0: P.st0, st1: P.st1, lg0: P.lg0.slice(), lg1: P.lg1.slice(), hy: P.hy, hx: P.hx, lean: P.lean, tilt: P.tilt, hlat: P.hlat, tw: P.tw || 0, roll: P.roll || 0, sy: P.sy, sx: P.sx, f0x: P.f0x, pf0x: P.pk ? P.pf0x : P.f0x, f0y: P.f0y });
          if (keepDraws) draws.push(Object.assign({}, d, { sel: false }));
        }
        return r;
      }
      return draw0.apply(this, arguments);
    };
    try {
      const DT = 1 / 60, hm = typeof Depth !== 'undefined' ? Depth.heroMul : null; if (m.mul && hm) Depth.heroMul = () => m.mul;
      const step = () => { input.mx = mx; input.my = my; state = 'play'; G.wolves = []; update(DT); now += DT; GFX.lookAt(p.x, p.y - 20); GFX.render(DT, null); };
      try { for (let t = 0; t < 1.2; t += DT) step(); on = true; for (let t = 0; t < sec; t += DT) step(); }
      finally { if (hm) Depth.heroMul = hm; }
    } finally { Hero.pose = pose0; ArtPeople.draw = draw0; World.solid = sol0; input.mx = input.my = 0; G.storm = null; }
    return { rec, draws };
  }

  // углы кадра для ноги i
  function angles(f, i) {
    const L = i ? f.lg1 : f.lg0, th = L[6], sh = L[7], fa = L[8] || 0;
    return { knee: (sh - th) * D2, thigh: (Math.PI / 2 - th) * D2, foot: -fa * D2, ankle: (sh - Math.PI / 2 - fa) * D2, ax: L[4], ay: L[5] };
  }
  function analyze(rec, mode) {
    const m = MODE[mode] || MODE.walk, bins = {}, all = { knee: [], foot: [] }, hs = [], to = [], cyc = [], slip = [], duties = [];
    for (const k in REF) bins[k] = Array.from({ length: 20 }, () => [0, 0]);
    for (let i = 0; i < 2; i++) {
      const st = rec.map(f => (i ? f.st1 : f.st0) === 1 ? 1 : 0), ev = [];
      for (let j = 1; j < rec.length; j++) if (st[j] !== st[j - 1]) ev.push({ j, on: st[j] });
      for (let e = 0; e + 2 < ev.length; e++) {
        const a = ev[e], b = ev[e + 1], c = ev[e + 2]; if (!a.on || b.on || !c.on) continue;
        const tA = rec[a.j].t, tB = rec[b.j].t, tC = rec[c.j].t; cyc.push(tC - tA); duties.push((tB - tA) / (tC - tA));
        const A0 = angles(rec[a.j], i), B0 = angles(rec[b.j - 1], i); hs.push(A0.foot); to.push(angles(rec[b.j], i).foot);
        // проскальзывание точки опоры: на пятке (носок вверх) — пятка, иначе носок (перекат через носок — норма, не скольжение)
        const R = [[1e9, -1e9], [1e9, -1e9]];
        for (let j = a.j; j < b.j; j++) { const L = i ? rec[j].lg1 : rec[j].lg0, fa = L[8] || 0, k = fa < -0.02 ? 0 : 1, x = k ? L[4] + 3.1 * Math.cos(fa) : L[4] - 0.8 * Math.cos(fa) - 1.9 * Math.sin(fa); R[k][0] = Math.min(R[k][0], x); R[k][1] = Math.max(R[k][1], x); }
        slip.push(Math.max(0, R[0][1] - R[0][0], R[1][1] - R[1][0]));
        for (let j = a.j; j < c.j; j++) {
          const t = rec[j].t, pc = j < b.j ? 60 * (t - tA) / (tB - tA) : 60 + 40 * (t - tB) / (tC - tB), q = angles(rec[j], i), bi = Math.min(19, Math.floor(pc / 5));
          for (const k in REF) { bins[k][bi][0] += q[k]; bins[k][bi][1]++; }
          all.knee.push(q.knee); all.foot.push(q.foot);
        }
      }
    }
    const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const curves = {}, fails = [];
    let inN = 0, nN = 0;
    for (const k in REF) {
      curves[k] = bins[k].map((b, bi) => { const pc = bi * 5 + 2.5, v = b[1] ? b[0] / b[1] : null, r = refOf(k, pc, m), ok = v == null || Math.abs(v - r) <= TOL[k]; if (v != null) { nN++; if (ok) inN++; } return { pc, v: v == null ? null : +v.toFixed(1), ref: +r.toFixed(1), ok }; });
    }
    // таз: вертикальный ход за цикл (экран, px) и доля роста
    const hyS = rec.map(f => (f.lg0[1] + f.lg1[1]) / 2 - f.y), T = mean(cyc) || 1;
    let hr = [], t0 = rec[0].t;
    for (let s = t0; s + T <= rec[rec.length - 1].t; s += T) { const w = rec.map((f, j) => [f.t, hyS[j]]).filter(q => q[0] >= s && q[0] < s + T).map(q => q[1]); if (w.length > 3) hr.push(Math.max(...w) - Math.min(...w)); }
    // корпус и голова: размах наклона корпуса (lean) и головы в мире (lean + tilt), крен, скрут
    // качание за цикл шага: минус скользящее среднее за цикл (медленный уклон — понурая голова, порыв — не в счёт стабилизации)
    const hp = a => a.map((v, j) => { let s = 0, n = 0; for (let k = 0; k < rec.length; k++) if (Math.abs(rec[k].t - rec[j].t) <= T / 2) { s += a[k]; n++; } return v - s / n; });
    const rng = a => Math.max(...a) - Math.min(...a), lean = hp(rec.map(f => f.lean)), head = hp(rec.map(f => f.lean + f.tilt));
    const res = {
      mode, frames: rec.length, cycles: cyc.length, speed: +mean(rec.map(f => f.v)).toFixed(0),
      cadence: +(2 / T).toFixed(2), duty: +mean(duties).toFixed(2), St: +mean(rec.map(f => f.St)).toFixed(2),
      knee: { min: +Math.min(...all.knee).toFixed(0), mean: +mean(curves.knee.filter(q => q.v != null).map(q => q.v)).toFixed(0), max: +Math.max(...all.knee).toFixed(0) },   // среднее — по нормированному циклу (%), как в клинике
      footHS: +mean(hs).toFixed(0), footTO: +mean(to).toFixed(0), hipPx: +mean(hr).toFixed(2), hipPct: +(100 * mean(hr) / H).toFixed(1), slip: +mean(slip).toFixed(2),
      leanDeg: +(rng(lean) * D2).toFixed(1), headDeg: +(rng(head) * D2).toFixed(1), rollDeg: +(rng(rec.map(f => f.roll)) * D2).toFixed(1), twistDeg: +(rng(rec.map(f => f.tw)) * D2).toFixed(1),
      inCorridor: +(inN / (nN || 1)).toFixed(2), curves,
    };
    // критерии
    const need = (c, msg) => { if (!c) fails.push(msg); };
    need(res.inCorridor >= 0.85, 'кривые в коридоре ' + Math.round(res.inCorridor * 100) + ' % < 85 %');
    need(res.knee.min <= 10 + (m.kb || 0) / 2, 'колено не выпрямляется: мин ' + res.knee.min + '°');
    const kMax = 62 * m.swing; need(Math.abs(res.knee.max - kMax) <= 14, 'пик колена ' + res.knee.max + '° (норма ≈' + kMax.toFixed(0) + '°)');
    need(res.knee.mean >= 15 && res.knee.mean <= 35 + (m.kb || 0) / 2, 'среднее колено ' + res.knee.mean + '°');
    need(res.footHS >= 6, 'нет удара пяткой: стопа при постановке ' + res.footHS + '°');
    need(res.footTO <= (mode === 'walk' || mode === 'shield' ? -18 : -8), 'нет отталкивания носком: стопа при отрыве ' + res.footTO + '°');
    need(res.hipPct >= 1.4 && res.hipPct <= 3.6, 'ход таза ' + res.hipPct + ' % роста');
    need(res.cadence >= 3.2 && res.cadence <= (m.cad || 5.4), 'частота ' + res.cadence + ' шаг/с');
    need(res.slip <= 1.5, 'опорная стопа скользит ' + res.slip + ' px');
    need(res.headDeg <= res.leanDeg * 0.8 + 0.5, 'голова не стабилизирована: ' + res.headDeg + '° при корпусе ' + res.leanDeg + '°');
    res.fails = fails;
    return res;
  }

  // раскадровка: n кадров подряд на чистом фоне, крупно
  function sheet(draws, n, Z) {
    const cw = 44, ch = 64, cols = 10, rows = Math.ceil(n / cols), c = document.createElement('canvas'); c.width = cw * Z * cols; c.height = ch * Z * rows;
    const g = c.getContext('2d'); g.fillStyle = '#e6ecf1'; g.fillRect(0, 0, c.width, c.height);
    const key = {}, draw = ArtPeople.draw;
    for (let i = 0; i < draws.length && i < n + 30; i++) {
      const d = Object.assign({}, draws[i], { key, onStep: null }), j = i - 30, on = j >= 0;   // 30 кадров — прогрев памяти (стопы, пружины)
      g.save(); if (on) { g.translate(((j % cols) + 0.5) * cw * Z, (Math.floor(j / cols) + 0.9) * ch * Z); g.scale(Z, Z); } else g.translate(-9999, -9999);
      g.translate(-d.x, -d.y);   // фигура в своей точке мира (стопы в опоре закреплены в мире), кадр — за ней
      draw.call(ArtPeople, g, d, { now: d.t, night: 0, light() {}, spark() {} }); g.restore();
      if (on) { g.strokeStyle = '#9aa7b3'; g.strokeRect((j % cols) * cw * Z, Math.floor(j / cols) * ch * Z, cw * Z, ch * Z); g.fillStyle = '#333'; g.font = '18px sans-serif'; g.fillText(j, (j % cols) * cw * Z + 5, Math.floor(j / cols) * ch * Z + 20); }
    }
    return c.toDataURL('image/png');
  }

  function run(o = {}) {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast };
    SaveGame.checkpoint = () => {}; Fx.toast = () => {}; Math.random = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(o.seed || 7);
    const out = { modes: {}, shots: {}, raw: {} };
    try {
      newGame(); state = 'play'; G.time = tAt(1, 13); Hero.bodyReset(); GFX.setZoom && GFX.setZoom(3);
      for (const mode of o.modes || Object.keys(MODE)) {
        const c = capture(mode, 'side', o.sec || 4, !!o.shots);
        out.modes[mode] = analyze(c.rec, mode); if (o.raw) out.raw[mode] = c.rec;
        if (o.shots) {
          out.shots[mode + '-side'] = sheet(c.draws, 30, o.zoom || 5);
          if (mode === 'walk' || o.views) for (const v of ['back', 'front']) out.shots[mode + '-' + v] = sheet(capture(mode, v, 1.2, true).draws, 30, o.zoom || 5);
        }
      }
    } finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; }
    if (typeof console !== 'undefined') for (const k in out.modes) { const r = out.modes[k]; console.log('GaitAngles', k, r.fails.length ? r.fails : 'ok'); }
    return out;
  }
  return { run, analyze, REF, TOL, MODE };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const shots = arg('--shots'), json = arg('--json'), modes = arg('--modes'), raw = arg('--raw');
  (async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(800);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      if (process.argv.includes('--low')) await pg.evaluate(() => { window.QUALITY = 'low'; });   // слабый пресет
      const r = await pg.evaluate(o => GaitAngles.run(o), { shots: !!shots, raw: !!raw, modes: modes ? modes.split(',') : null, views: !!arg('--views') });
      if (shots) { fs.mkdirSync(shots, { recursive: true }); for (const k in r.shots) fs.writeFileSync(path.join(shots, k + '.png'), Buffer.from(r.shots[k].split(',')[1], 'base64')); }
      if (json) fs.writeFileSync(json, JSON.stringify(r.modes, null, 1));
      if (raw) fs.writeFileSync(raw, JSON.stringify(r.raw));
      let bad = 0;
      for (const k in r.modes) {
        const m = r.modes[k]; bad += m.fails.length;
        console.log(`${k.padEnd(7)} v=${m.speed} шаг/с=${m.cadence} опора=${m.duty} St=${m.St} | колено мин/ср/макс ${m.knee.min}/${m.knee.mean}/${m.knee.max} | стопа пост/отрыв ${m.footHS}/${m.footTO} | таз ${m.hipPx} px (${m.hipPct} %) | скольж ${m.slip} | корпус ${m.leanDeg}° голова ${m.headDeg}° крен ${m.rollDeg}° скрут ${m.twistDeg}° | коридор ${Math.round(m.inCorridor * 100)} %`);
        for (const c of ['knee', 'thigh', 'foot', 'ankle']) console.log('   ' + c.padEnd(6) + m.curves[c].map(q => q.v == null ? '  · ' : (q.ok ? ' ' : '!') + String(Math.round(q.v)).padStart(3)).join('') + '\n   ' + 'эталон' + m.curves[c].map(q => String(Math.round(q.ref)).padStart(4)).join(''));
        if (m.fails.length) console.log('   ✗ ' + m.fails.join('; '));
      }
      if (errs.length) console.log(errs.join('\n'));
      process.exitCode = bad || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
