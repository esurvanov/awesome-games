// Ноги в снегу и силуэт за препятствием (js/gfx.js sunkP / figLayer / occSil, js/depth.js collar, js/art-poses.js trudge).
// Герой идёт по колено (боком и к камере), с буфера фигуры (GFX.figDbg — тот же холст, что ложится в кадр) снимается:
//   edge   — нет прямого горизонтального среза: в полосе ±2 px мира у кромки нет ряда, где альфа рвётся (≥0.85 → ≤0.15 за 1 px
//            устройства) подряд дольше 3 px устройства
//   below  — ниже кромки (+1.2 px мира, за мягким краем) нет тёмных пикселей штанов/валенка (воротник и комья — светлые)
//   rim    — валик ямы шире разноса стоп: 2·rx ≥ |x0 − x1| + 4
//   cups   — кромка опорной ноги ниже переносной (от своей линии снега) ≥ 1 px; переносная стопа выходит из снега (trudge)
// Силуэт (без снега, DEPTH_OFF):
//   front  — герой перед елью → силуэта нет;  behind — за стволом → силуэт есть
//   tone   — в слое силуэта 2 уровня цвета (тело + контур), разброс внутри тела мал
//   shape  — форма силуэта (до контура и маски) = фигура героя в буфере: XOR / объединение < 3 %
// Playwright: cd tests && node snow-legs.js
var SnowLegs = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60;
  function frame(mx, my) { input.mx = mx; input.my = my; update(DT); now += DT; GFX.lookAt(G.p.x, G.p.y - 20); GFX.render(DT, null); }
  function put(x, y, f = 1) { const p = G.p; p.x = x; p.y = y; p.face = f; p.action = null; p.ride = null; p.sleeping = false; p.inside = false; Hero.snap(); Hero.bodyReset(); }
  function find(lo, hi) {
    const R = mulberry(11);
    for (let k = 0; k < 80000; k++) {
      const x = 400 + R() * (W - 800), y = 400 + R() * (H - 800);
      if (onIce(x, y) || World.blocked(x, y, 14) || Math.hypot(x - HUT.x, y - HUT.y) < 400) continue;
      let ok = true; for (let d = -75; d <= 75 && ok; d += 15) for (let e = -75; e <= 75 && ok; e += 15) { const s = Depth.sinkAt(x + d, y + e, 'p'); if (s < lo || s > hi || World.blocked(x + d, y + e, 12)) ok = false; }
      if (ok) return { x, y };
    }
    return null;
  }
  const px = (D, w, i, j) => D[(j * w + i) * 4 + 3] / 255;
  function snap() {   // буфер героя после кадра
    const d = GFX.figDbg(), r = d.rec; if (!r || !r.cv || !d.cut) return null;
    const D = r.cv.getContext('2d').getImageData(0, 0, r.pw, r.ph).data;
    return { d, r, D };
  }
  function legs(q, res) {
    const { d, r, D } = q, s = r.s, w = r.pw, P = ArtPeople.H.P, cut = x => d.cutY(x, d.base, d.cut);
    // 1. прямой срез: по столбцам — где у кромки альфа рвётся за 1 px устройства; длина одинаковых рядов подряд
    let run = 0, prevJ = -9, maxRun = 0;
    for (let i = 0; i < w; i++) {
      const xw = r.x0 + i / s, cy = (cut(xw) - r.y0) * s; let jj = -1;
      for (let j = Math.max(0, Math.floor(cy - 2 * s)); j < Math.min(r.ph - 1, cy + 2 * s); j++) if (px(D, w, i, j) >= 0.85 && px(D, w, i, j + 1) <= 0.15) { jj = j; break; }
      if (jj >= 0 && Math.abs(jj - prevJ) <= 0) run++; else run = jj >= 0 ? 1 : 0;
      prevJ = jj; maxRun = Math.max(maxRun, run);
    }
    res.edge = Math.max(res.edge, maxRun);
    // 2. тёмное ниже кромки
    let dark = 0;
    for (let i = 0; i < w; i += 1) {
      const xw = r.x0 + i / s, j0 = Math.ceil((cut(xw) + 1.2 - r.y0) * s);
      for (let j = Math.max(0, j0); j < r.ph; j++) { const k = (j * w + i) * 4, a = D[k + 3] / 255; if (a > 0.3) { const l = (0.3 * D[k] + 0.59 * D[k + 1] + 0.11 * D[k + 2]) / a / 255; if (l < 0.4) dark++; } }
    }
    res.dark = Math.max(res.dark, dark);
    // 3. валик шире разноса стоп
    if (d.rim) res.rim = Math.min(res.rim, 2 * d.rim[1] - (d.rim[3] + 4));
    // 4. кромка опорной глубже переносной (от своей линии снега)
    const C = d.cut; let st = null, sw = null;
    for (let k = 0; k < C.length; k += 5) { const leg = C[k + 4] ? P.lg1 : P.lg0; if (leg[13]) st = C[k + 3]; else sw = C[k + 3]; }
    if (st != null && sw != null) res.cupD = Math.min(res.cupD, st - sw);
    for (const L of [P.lg0, P.lg1]) if (!L[13] && L[5] + d.px < L[12] - 0.3) { res.out++; break; }   // щиколотка переносной над снегом (вытащили)
    res.n++;
  }
  function silTone(res) {
    const d = GFX.figDbg(), r = d.rec, c = d.silCv, D = c.getContext('2d').getImageData(0, 0, r.pw, r.ph).data;
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = hex('#1d3149'), B = hex('#c9d8ea');
    let n = 0, ok = 0, sa = [0, 0, 0], sq = 0, nb = 0;
    for (let k = 0; k < D.length; k += 4) {
      if (D[k + 3] < 250) continue; n++;
      const da = Math.hypot(D[k] - A[0], D[k + 1] - A[1], D[k + 2] - A[2]), db = Math.hypot(D[k] - B[0], D[k + 1] - B[1], D[k + 2] - B[2]);
      // на отрезке между двумя тонами (сглаживание края контура) — тоже «2 уровня»
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, u = Math.max(0, Math.min(1, ((D[k] - A[0]) * ab[0] + (D[k + 1] - A[1]) * ab[1] + (D[k + 2] - A[2]) * ab[2]) / L2));
      if (Math.min(da, db) < 14 || Math.hypot(D[k] - A[0] - u * ab[0], D[k + 1] - A[1] - u * ab[1], D[k + 2] - A[2] - u * ab[2]) < 8) ok++;
      if (da < 40) { nb++; sq += da * da; }
    }
    res.toneN = n; res.tone = n ? ok / n : 0; res.toneSd = nb ? Math.sqrt(sq / nb) : 99;
    // форма: одноцветный слой (до контура и маски) против буфера фигуры
    const T = d.tintCv.getContext('2d').getImageData(0, 0, r.pw, r.ph).data, F = r.cv.getContext('2d').getImageData(0, 0, r.pw, r.ph).data;
    let x = 0, u = 0; for (let k = 3; k < F.length; k += 4) { const a = F[k] > 127, b = T[k] > 127; if (a || b) u++; if (a !== b) x++; }
    res.xor = u ? x / u : 1;
  }
  function run() {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast }, res = { m: {}, fails: [] };
    SaveGame.checkpoint = () => {}; Math.random = mulberry(9); Fx.toast = () => {};
    const fail = (ok, msg) => { if (!ok) res.fails.push(msg); };
    try {
      newGame(); state = 'play'; G.time = tAt(1, 12); G.storm = null; G.wolves = []; G.bear = null; G.s.hp = 1e9; GFX.setZoom && GFX.setZoom(3);
      const q = find(42, 70); fail(!!q, 'нет места по колено');
      if (q) for (const [nm, mx, my] of [['side', 1, 0], ['front', 0, 1], ['back', 0, -1]]) {
        put(q.x - mx * 60, q.y - my * 60); for (let i = 0; i < 20; i++) frame(0, 0);
        const r = res.m[nm] = { edge: 0, dark: 0, rim: 99, cupD: 99, out: 0, n: 0, sink: 0 };
        for (let i = 0; i < 100; i++) { frame(mx, my); if (i > 30 && i % 3 === 0) { const s = snap(); if (s) legs(s, r); r.sink = Math.max(r.sink, Depth.heroSink); } }
        for (let i = 0; i < 40; i++) { frame(0, 0); if (i % 4 === 0) { const s = snap(); if (s) legs(s, r); } }
        r.sink = Math.round(r.sink); r.rim = +r.rim.toFixed(2); r.cupD = +r.cupD.toFixed(2);
        fail(r.n > 20, nm + ': мало кадров в снегу ' + r.n);
        fail(r.edge <= 3, nm + ': прямой срез ' + r.edge + ' px устройства');
        fail(r.dark === 0, nm + ': тёмных пикселей ниже кромки ' + r.dark);
        fail(r.rim >= 0, nm + ': валик уже разноса стоп + 4 на ' + (-r.rim).toFixed(2));
        if (nm === 'side') { fail(r.cupD >= 1, nm + ': кромка опорной ниже переносной на ' + r.cupD + ' < 1'); fail(r.out > 0, nm + ': переносная стопа не выходит из снега'); }
      }
      // силуэт: без снега, у отдельной ели
      window.DEPTH_OFF = true;
      const t = G.trees.filter(t => t.wood > 0 && !t.wall && t.stage !== 1 && t.s > 0.8 && !onIce(t.x, t.y) && !World.blocked(t.x, t.y - 22, 8) && !World.blocked(t.x, t.y + 24, 8) && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 300
        && !G.trees.some(o => o !== t && o.wood > 0 && Math.hypot(o.x - t.x, o.y - t.y) < 60))[0];
      fail(!!t, 'нет отдельной ели');
      if (t) {
        const sil = res.m.sil = {};
        put(t.x, t.y + 22); for (let i = 0; i < 20; i++) frame(0, 0); sil.front = GFX.figDbg().sil.on;
        put(t.x, t.y - 22); const n0 = GFX.figDbg().sil.n; for (let i = 0; i < 20; i++) frame(0, 0); const S = GFX.figDbg().sil; sil.behind = S.on; sil.cov = +S.cov.toFixed(2); sil.drawn = S.n - n0;
        fail(sil.front === 0, 'перед елью — силуэт рисуется');
        fail(sil.behind === 1 && sil.drawn > 0, 'за стволом — силуэта нет (закрыто ' + sil.cov + ')');
        if (sil.drawn > 0) {
          silTone(sil); sil.tone = +sil.tone.toFixed(3); sil.toneSd = +sil.toneSd.toFixed(1); sil.xor = +sil.xor.toFixed(4);
          fail(sil.toneN > 200 && sil.tone >= 0.97, 'силуэт не в 2 цвета: ' + sil.tone);
          fail(sil.toneSd < 4, 'разброс цвета внутри силуэта ' + sil.toneSd);
          fail(sil.xor < 0.03, 'форма силуэта ≠ фигура: XOR ' + sil.xor);
        }
      }
    } finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; window.DEPTH_OFF = false; input.mx = input.my = 0; }
    if (typeof console !== 'undefined') console.log('SnowLegs', res.fails.length, 'провалов', res.fails);
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
      const r = await pg.evaluate(() => SnowLegs.run());
      console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log(errs.join('\n'));
      process.exitCode = r.fails.length || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
