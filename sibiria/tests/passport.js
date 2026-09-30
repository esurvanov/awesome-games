// Паспорт взаимодействия, волны 1–3 (docs/design/INTERACTION-PASSPORT.md §5, критерии A1–A9):
// волна 3 — A8 снег-накопитель (шапки, наддувы, срыв), A9 следы по ветру, позёмка, полог леса;
// единый ветер, сплит Ми-8, вымпел, лопасть, провода, дверь, записки. Ветер ставится вручную (Wind.force: часы, м/с, погода),
// шаги частей — те же функции, что зовёт рендер (Live.*Step), по кадрам 1/60 с; дамп — tests/out-passport.json.
//   cd tests && node passport.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

// ---------- в странице ----------
function suite() {
  const out = {}, fails = [], okl = [];
  const ok = (c, what) => { (c ? okl : fails).push(what); };
  document.querySelectorAll('#dialog,#note,#chapter').forEach(e => e.hidden = true);
  G.s.hp = 1e9; G.time = tAt(1, 12); G.storm = null;
  const c = POI.cockpit, DT = 1 / 60;
  let T = 1000;
  const run = (sec, o, fn) => { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) { T += DT; Wind.force(Object.assign({ t: T, dir: 0 }, o)); fn(i); } }; // dir: 0 — порыв бежит по +x (запаздывание меряется по x)
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const pear = (a, b) => { const ma = mean(a), mb = mean(b); let sab = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; sa += x * x; sb += y * y; } return sab / Math.sqrt(sa * sb || 1e-12); };
  const lagOf = (a, b, maxLag) => { let best = 0, bl = 0; for (let L = 0; L <= maxLag; L++) { const x = a.slice(0, a.length - L), y = b.slice(L); const r = pear(x, y); if (r > best) { best = r; bl = L; } } return { lag: bl, r: best }; };
  const smoothA = (a, k) => a.map((_, i) => mean(a.slice(Math.max(0, i - k), i + k + 1)));
  const r3 = v => +(+v).toFixed(3);
  const hero = { x: G.p.x, y: G.p.y };
  const park = () => { G.p.x = c.x - 600; G.p.y = c.y + 400; };   // герой далеко: касаний нет
  park();

  // ===== A1 — единый ветер =====
  {
    // 600 кадров, погода 6 м/с (ms 2…6 — все пороги вымпела): у героя — ms; изгиб ели (формула gfx: ENV.wind · 0.05 · (0.12 + 0.88 · порыв));
    // снос дыма (FX.update на частице дыма, минус собственная скорость); угол вымпела (сглажен 0.25 с); громкость ветра (Sound.windLevel)
    const px = c.x - 120, py = c.y + 10, q = { id: 'pennant', x: px, y: py }, wy = py - 30; // все читают ветер у верха шеста
    const rows = { ms: [], tree: [], smoke: [], flag: [], sound: [] };
    run(10, { base: 6 }, () => {
      const w = Wind.at(px, wy), g = Wind.gust(px, wy);
      const part = [{ type: 'smoke', x: px, y: wy, vx: 0, vy: 0, life: 9, max: 9 }], x0 = part[0].x; FX.update(part, DT);
      Live.flagStep(q, DT);
      rows.ms.push(w.ms); rows.tree.push(Wind.treeK() * 0.05 * (0.12 + 0.88 * g)); rows.smoke.push((part[0].x - x0) / DT);
      rows.flag.push(-Live.flagShape(q).ang); rows.sound.push(Sound.windLevel(w.ms).gain);
    });
    const fl = smoothA(rows.flag, 15);
    out.A1 = { corr: { tree: r3(pear(rows.ms, rows.tree)), smoke: r3(pear(rows.ms, rows.smoke)), flag: r3(pear(rows.ms, fl)), sound: r3(pear(rows.ms, rows.sound)) } };
    for (const k in out.A1.corr) ok(out.A1.corr[k] >= 0.9, `A1 корреляция с Wind.at.ms: ${k} = ${out.A1.corr[k]} ≥ 0.9`);
    // запаздывание порыва на 500 px по x = 500 / 110 с ±10 % (порыв и угол двух вымпелов)
    const a = [], b = [], fa = [], fb = [], q1 = { id: 'pennant', x: c.x, y: c.y }, q2 = { id: 'pennant', x: c.x + 500, y: c.y };
    run(120, { base: 6 }, () => { a.push(Wind.gust(c.x, c.y)); b.push(Wind.gust(c.x + 500, c.y)); Live.flagStep(q1, DT); Live.flagStep(q2, DT); fa.push(-Live.flagShape(q1).ang); fb.push(-Live.flagShape(q2).ang); });
    const want = 500 / 110, lg = lagOf(a, b, 60 * 8).lag / 60, lf = lagOf(smoothA(fa, 15), smoothA(fb, 15), 60 * 8).lag / 60;
    out.A1.lag = { want: r3(want), gust: r3(lg), flags: r3(lf) };
    ok(Math.abs(lg - want) <= want * 0.1, `A1 порыв доходит за ${r3(lg)} с (цель ${r3(want)} ±10 %)`);
    ok(Math.abs(lf - want) <= want * 0.1, `A1 вымпелы в 500 px: запаздывание ${r3(lf)} с (±10 %)`);
    Wind.force(null);
    // погода → база
    const bs = {}; for (const [k, h] of [['night', 2], ['morning', 8], ['day', 13], ['evening', 20]]) { G.time = tAt(1, h); bs[k] = r3(Wind.base()); }
    G.storm = { a: G.time - 100, b: G.time + 100 }; bs.storm = r3(Wind.base()); G.storm = null; G.time = tAt(1, 12);
    out.A1.base = bs; out.A1.beaufort = [0.5, 2, 4, 6, 9, 12, 18].map(v => Wind.beaufort(v));
    ok(bs.night < 1.6 && bs.day >= 4 && bs.day <= 5 && bs.storm >= 15, `A1 погода: ночь ${bs.night}, день ${bs.day}, пурга ${bs.storm} м/с`);
  }

  // ===== A2 — сплит Ми-8: в штиль картинка = прежнему спрайту =====
  {
    Wind.force({ ms: 0, t: T }); Live.reset();
    const S = ArtWorld.sprite('t-mi8s', 320, 210, g => { g.translate(160, 140); ArtWorld.paintMi8(g, 'static'); }), s = S.width / 320, Wd = S.width, Hd = S.height; // масштаб кэша игры
    const mk = () => { const cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd; return cv; };
    const A = mk(), gA = A.getContext('2d'); gA.scale(s, s); gA.translate(160, 140); ArtWorld.paintMi8(gA, 'full');
    const B = mk(), gB = B.getContext('2d'); gB.setTransform(s, 0, 0, s, (160 - c.x) * s, (140 - c.y) * s);
    const env = { now: 5 }, SEG = [[0, 110], [110, 210], [210, 320]];
    for (const k of [2, 1, 0]) Live.drawWreck(gB, SEG[k][0], SEG[k][1], S, env);
    const a = gA.getImageData(0, 0, Wd, Hd).data, b = gB.getImageData(0, 0, Wd, Hd).data;
    let diff = 0, cov = 0;
    for (let i = 0; i < a.length; i += 4) { if (a[i + 3] > 8 || b[i + 3] > 8) cov++; if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3])) > 24) diff++; }
    // цена: 3 сегмента за кадр (шаг частей + отрисовка), 300 кадров
    const t0 = performance.now(); for (let f = 0; f < 300; f++) { env.now = 6 + f / 60; for (const k of [2, 1, 0]) Live.drawWreck(gB, SEG[k][0], SEG[k][1], S, env); }
    const msF = (performance.now() - t0) / 300;
    env.now += 1 / 60; for (const k of [2, 1, 0]) Live.drawWreck(gB, SEG[k][0], SEG[k][1], S, env); env.now += 1 / 60; Live.drawWreck(gB, 0, 110, S, env);
    const img = Live.stats.img;
    out.A2 = { scale: s, diffPct: r3(diff / cov * 100), cover: cov, drawImage: img, msPerFrame: r3(msF) };
    ok(diff / cov <= 0.01, `A2 штиль: отличается ${out.A2.diffPct} % пикселей Ми-8 (≤ 1 %)`);
    ok(img <= 8, `A2 drawImage на обломки за кадр: ${img} (≤ 8)`);
    ok(msF <= 0.15, `A2 обломки: ${out.A2.msPerFrame} мс за кадр (≤ 0.15)`);
  }

  // ===== A3 — вымпел =====
  {
    const q = { id: 'pennant', x: c.x - 120, y: c.y + 10 };
    const probe = (ms, qq = q, sec = 10) => {
      const ang = []; run(sec, { ms }, () => { Live.flagStep(qq, DT); ang.push(Live.flagShape(qq).ang); });
      const m = mean(ang), d = ang.map(v => v - m); let zc = 0; for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) zc++;
      const sd = [...ang].sort((x, y) => x - y), amp = (sd[Math.floor(sd.length * 0.95)] - sd[Math.floor(sd.length * 0.05)]) / 2;
      return { mean: r3(m), hz: r3(zc / sec), amp: r3(amp), ang };
    };
    const p1 = probe(1), p4 = probe(4), p5 = probe(5), p18 = probe(18);
    out.A3 = { ms1: { mean: p1.mean, hz: p1.hz, amp: p1.amp }, ms4: { mean: p4.mean, hz: p4.hz, amp: p4.amp }, ms5: { mean: p5.mean, hz: p5.hz, amp: p5.amp }, ms18: { mean: p18.mean, hz: p18.hz, amp: p18.amp } };
    ok(p1.mean >= 70, `A3 1 м/с: обвис, угол ${p1.mean}° (≥ 70°)`);
    ok(Math.abs(p4.mean) <= 25 && p4.amp > 1, `A3 4 м/с: развёрнут ${p4.mean}° (≤ 25°), полощется ±${p4.amp}°`);
    ok(p4.hz >= 1.8 && p4.hz <= 3.2 && p18.hz >= 5 && p18.hz <= 7, `A3 частота ${p4.hz} Гц (4 м/с) → ${p18.hz} Гц (18 м/с): 2 → 6`);
    ok(Math.abs(p18.mean) <= 12 && p18.amp >= 1.5 * p5.amp, `A3 пурга: кончик у края ${p18.mean}°, размах ${p18.amp}° ≥ 1.5 × ${p5.amp}° (5 м/с)`);
    // фаза от x: два вымпела в 300 px при ровном ветре — сдвиг > 0.5 рад
    const qa = { id: 'pennant', x: c.x, y: c.y }, qb = { id: 'pennant', x: c.x + 300, y: c.y }, A = [], B = [];
    run(6, { ms: 4 }, () => { Live.flagStep(qa, DT); Live.flagStep(qb, DT); A.push(Live.flagShape(qa).ang); B.push(Live.flagShape(qb).ang); });
    const hz = p4.hz || 2.3, per = Math.round(60 / hz), L = lagOf(A, B, per).lag, dph = Math.min(L, per - L) / per * 2 * Math.PI;
    out.A3.phase = r3(dph);
    ok(dph > 0.5, `A3 фаза по x: два вымпела в 300 px, Δфазы ${r3(dph)} рад (> 0.5)`);
  }

  // ===== A4 — лопасть =====
  {
    Live.reset(); G.parts.length = 0;
    let mx = 0; run(5, { ms: 4 }, () => { Live.wreckStep(DT); mx = Math.max(mx, Math.abs(Live.state().blade.off)); });
    out.A4 = { calmMax: r3(mx) };
    ok(mx <= 0.2, `A4 4 м/с: кончик ${r3(mx)} px (≤ 0.2)`);
    // ветер 7…14 м/с: размах за окно 1 с ∝ ветру
    const pk = [], wm = []; let wpk = 0, wms = []; Live.reset();
    run(40, { base: 14 }, i => { Live.wreckStep(DT); wpk = Math.max(wpk, Math.abs(Live.state().blade.off)); wms.push(Wind.ms(c.x + 60, c.y - 60)); if (i % 60 === 59) { pk.push(wpk); wm.push(mean(wms)); wpk = 0; wms = []; } });
    out.A4.windCorr = r3(pear(pk.slice(2), wm.slice(2))); out.A4.windPeak = r3(Math.max(...pk));
    ok(out.A4.windCorr >= 0.8, `A4 размах ∝ ветру: корреляция ${out.A4.windCorr} (≥ 0.8), пик ${out.A4.windPeak} px`);
    // удар → дрожь 0.8–1.2 с (огибающая ≥ 10 % пика) и ≥ 6 комьев снега с кромки
    Live.reset(); G.parts.length = 0; Wind.force({ ms: 0, t: T });
    Interact.emit('bump', { who: 'p', obj: 'blade', x: c.x + 120, y: c.y, power: 0.8 });
    const bits = G.parts.filter(q => q.live === 'blade').length;
    const env = []; run(2, { ms: 0 }, () => { Live.wreckStep(DT); env.push(Math.abs(Live.state().blade.off)); });
    const peak = Math.max(...env); let last = 0; env.forEach((v, i) => { if (v >= peak * 0.1) last = i; });
    out.A4.hit = { bits, peak: r3(peak), dur: r3((last + 1) * DT) };
    ok(bits >= 6, `A4 удар: ${bits} комьев снега с кромки (≥ 6)`);
    ok(out.A4.hit.dur >= 0.8 && out.A4.hit.dur <= 1.2, `A4 удар: дрожь ${out.A4.hit.dur} с (0.8–1.2), пик ${out.A4.hit.peak} px`);
    // порыв ≥ 8 м/с при снеге на кромке → комья
    Live.reset(); G.parts.length = 0; let gb = 0;
    run(30, { base: 16 }, () => { Live.wreckStep(DT); gb = Math.max(gb, G.parts.filter(q => q.live === 'blade').length); });
    out.A4.gustBits = gb;
    ok(gb >= 6, `A4 порыв ≥ 8 м/с: ${gb} комьев (≥ 6)`);
  }

  // ===== A5 — провода =====
  {
    Live.reset(); G.parts.length = 0; park();
    run(0.1, { ms: 0 }, () => Live.wreckStep(DT));
    const st0 = Live.state(), n = st0.wires.length, pts = st0.wires.map(w => w.length), rest = st0.wires.map(w => w.map(p => p.slice()));
    ok(n >= 2 && n <= 4 && pts.every(k => k >= 6 && k <= 8), `A5 цепочки: ${n} × ${pts.join('/')} точек`);
    const sag = st0.wires.every(w => w[w.length - 1][1] > w[0][1]); ok(sag, 'A5 провис от тяжести: конец ниже разлома');
    // пурга 10 мин: растяжение звеньев, NaN
    let str = 0, nan = false, mdx = 0;
    run(600, { base: 18 }, () => { Live.wreckStep(DT); const s = Live.state(); s.wires.forEach((w, j) => w.forEach((p, i) => { if (!isFinite(p[0] + p[1])) nan = true; if (i) { const d = Math.hypot(p[0] - w[i - 1][0], p[1] - w[i - 1][1]); str = Math.max(str, Math.abs(d - s.wireL[j][i - 1]) / s.wireL[j][i - 1]); } mdx = Math.max(mdx, Math.abs(p[0] - rest[j][i][0])); })); });
    out.A5 = { chains: n, points: pts, stretchPct: r3(str * 100), nan, stormSwayPx: r3(mdx) };
    ok(!nan, 'A5 10 мин пурги: без NaN'); ok(str <= 0.05, `A5 растяжение звеньев ${out.A5.stretchPct} % (≤ 5 %)`); ok(mdx >= 2, `A5 пурга раскачивает провода: ${out.A5.stormSwayPx} px`);
    // герой проходит сквозь: качнулись, покой ≤ 2 с после ухода
    Live.reset(); run(0.1, { ms: 0 }, () => Live.wreckStep(DT));
    let touches = 0; const onT = e => { if (e.obj === 'wire') touches++; }; Interact.on('touch', onT);
    const mid = rest[0][4]; let push = 0;
    for (let k = 0; k < 40; k++) { G.p.x = c.x + mid[0] - 20 + k; G.p.y = c.y - 11; run(DT, { ms: 0 }, () => Live.wreckStep(DT)); }
    Live.state().wires.forEach((w, j) => w.forEach((p, i) => { push = Math.max(push, Math.hypot(p[0] - rest[j][i][0], p[1] - rest[j][i][1])); }));
    park(); let settle = -1;
    run(4, { ms: 0 }, i => { Live.wreckStep(DT); let d = 0; Live.state().wires.forEach((w, j) => w.forEach((p, q) => { d = Math.max(d, Math.hypot(p[0] - rest[j][q][0], p[1] - rest[j][q][1])); })); if (d > 0.5) settle = -1; else if (settle < 0) settle = (i + 1) * DT; });
    out.A5.touch = { push: r3(push), touches, settle: r3(settle) };
    ok(push >= 3 && touches >= 1, `A5 герой задел: сдвиг ${r3(push)} px, событий touch ${touches}`);
    ok(settle > 0 && settle <= 2, `A5 покой через ${r3(settle)} с (≤ 2)`);
    // гул только с 8 м/с
    run(1, { ms: 6 }, () => Live.wreckStep(DT)); const h6 = Live.state().hum; run(1, { ms: 9 }, () => Live.wreckStep(DT)); const h9 = Live.state().hum;
    out.A5.hum = { ms6: h6, ms9: h9 }; ok(!h6 && h9, 'A5 гул: 6 м/с — нет, 9 м/с — есть');
    // цена шага всех живых частей Ми-8 (лопасть + дверь + провода)
    const t0 = performance.now(); run(10, { base: 12 }, () => Live.wreckStep(DT)); out.A5.stepMs = r3((performance.now() - t0) / 600);
    ok(out.A5.stepMs <= 0.05, `A5 шаг частей Ми-8: ${out.A5.stepMs} мс (≤ 0.05)`);
    G.parts.length = 0;
  }

  // ===== A6 — дверь =====
  {
    const slamT = []; Interact.on('noise', e => { if (e.obj === 'door') slamT.push(T); });
    const door = (ms, sec, o) => { Live.reset(); let mx = 0, ms0 = 0; run(sec, o || { ms }, () => { Live.wreckStep(DT); const d = Live.state().door; mx = Math.max(mx, Math.abs(d.ang)); ms0 = Math.max(ms0, Math.abs(d.sl)); }); return { ang: mx, sl: ms0, slams: Live.state().door.slams }; };
    const d5 = door(5, 10), d8 = door(8, 20);
    slamT.length = 0; const d12 = door(12, 180); d12.slams /= 3; const gaps = slamT.slice(1).map((t, i) => t - slamT[i]); // 3 мин → в среднем за минуту
    out.A6 = { ms5: { ang: r3(d5.ang), sl: r3(d5.sl) }, ms8: { ang: r3(d8.ang), slams: d8.slams }, ms12: { slams: r3(d12.slams), minGap: gaps.length ? r3(Math.min(...gaps)) : null } };
    ok(d5.ang < 0.002 && d5.sl < 0.05, `A6 5 м/с: неподвижна (${r3(d5.ang)} рад)`);
    ok(d8.ang > 0.01 && d8.slams === 0, `A6 8 м/с: качается ±${r3(d8.ang)} рад, без хлопков`);
    ok(d12.slams >= 2 && d12.slams <= 8 && (!gaps.length || Math.min(...gaps) >= 3), `A6 12 м/с: ${r3(d12.slams)} хлопков в минуту (2–8), между ≥ 3 с (${out.A6.ms12.minGap})`);
    // толчок героя → качнулась 0.5–1 с
    Live.reset(); Wind.force({ ms: 0, t: T }); Interact.emit('push', { who: 'p', obj: 'door', x: c.x + 17, y: c.y + 30, t: 1 });
    const env = []; run(2, { ms: 0 }, () => { Live.wreckStep(DT); env.push(Math.abs(Live.state().door.ang)); });
    const pk = Math.max(...env); let last = 0; env.forEach((v, i) => { if (v >= pk * 0.1) last = i; });
    out.A6.push = { peak: r3(pk), dur: r3((last + 1) * DT) };
    ok(pk > 0.02 && out.A6.push.dur >= 0.5 && out.A6.push.dur <= 1, `A6 толчок: качнулась ${out.A6.push.dur} с (0.5–1), ±${r3(pk)} рад`);
    // пурга → снег в проёме
    Live.reset(); G.parts.length = 0; let puffs = 0; run(5, { base: 18 }, () => { Live.wreckStep(DT); puffs = Math.max(puffs, G.parts.filter(q => q.live === 'door').length); });
    out.A6.stormPuffs = puffs; ok(puffs >= 3, `A6 пурга: снег задувает в проём (${puffs} облачков)`);
    G.parts.length = 0;
  }

  // ===== A7 — записки =====
  {
    const ids = ['log', 'pilot', 'wife'];
    Live.reset();
    const probe = (o, sec) => { const m = { flut: 0, lift: 0, dist: 0, flutSum: 0, n: 0 }; run(sec, o, () => { for (const id of ids) { const s = Live.noteStep(id, DT); m.flut = Math.max(m.flut, s.flut); m.lift = Math.max(m.lift, s.lift); m.dist = Math.max(m.dist, Math.hypot(s.dx, s.dy - s.lift)); m.flutSum += s.flut; m.n++; } }); m.flutMean = m.flutSum / m.n; return m; };
    const m1 = probe({ ms: 1 }, 5), m3 = probe({ ms: 3 }, 5); Live.reset();
    const ms = probe({ base: 18 }, 60);
    out.A7 = { ms1: r3(m1.flutMean), ms3: r3(m3.flutMean), ms3lift: r3(m3.lift), storm: { flut: r3(ms.flut), hop: r3(ms.lift), dist: r3(ms.dist) } };
    ok(m3.flutMean > m1.flutMean && m3.flut <= 3 && m3.lift === 0, `A7 трепет ∝ ветру: ${out.A7.ms1} → ${out.A7.ms3} px, ≤ 3, без прыжков при 3 м/с`);
    ok(ms.flut <= 3 && ms.lift > 1 && ms.lift <= 12, `A7 пурга: трепет ≤ 3 (${out.A7.storm.flut}), прыжки ${out.A7.storm.hop} px (≤ 12)`);
    ok(ms.dist <= 40, `A7 60 с пурги: дальше всех ${out.A7.storm.dist} px от места (≤ 40)`);
    // «Прочитать» доступно у каждой записки, где бы она ни лежала
    const ctx = ids.map(id => { const n = NOTES[id], s = Live.state().notes[id] || { dx: 0, dy: 0 }; G.p.x = n.x + s.dx; G.p.y = n.y + s.dy + 6; const k = Actions.context(); return k && k.k === 'note' && k.o === id; });
    out.A7.readable = ctx; ok(ctx.every(Boolean), 'A7 «Прочитать» у каждой записки: ' + ctx.join(','));
  }

  // ===== A8 — снег-накопитель: шапки и наддувы (js/snow.js) =====
  {
    park(); Live.reset(); G.parts.length = 0;
    const ids = ['mi8', 'barrel', 'crates', 'tail', 'barrelT', 'hut', 'labaz', 'chum'];
    const all = (v, d) => { for (const id of ids) Snow.set(id, v, d); };
    // снегопад в штиль: 0 → 1 за 480 ± 60 с
    all(0, 0); Wind.force({ ms: 0, t: T }); Snow.force({ fall: 1 });
    const reach = {}; let t = 0;
    while (t < 700 && ids.some(id => reach[id] == null)) { Snow.step(0.5); t += 0.5; for (const id of ids) if (reach[id] == null && Snow.cap(id) >= 0.999) reach[id] = t; }
    out.A8 = { grow: reach };
    ok(ids.every(id => reach[id] >= 420 && reach[id] <= 540), `A8 снегопад: шапки 0 → 1 за ${[...new Set(Object.values(reach))].join('/')} с (480 ± 60) — ${ids.length} вещей`);
    // ветер ниже порога (6 м/с) держит шапку, выше (10 м/с) — сдувает; порог 7.7
    Snow.force({ fall: 0 }); all(1, 0);
    Wind.force({ ms: 6, t: T }); for (let i = 0; i < 240; i++) Snow.step(0.5); const c6 = Snow.cap('mi8');
    Wind.force({ ms: 7.5, t: T }); for (let i = 0; i < 240; i++) Snow.step(0.5); const c75 = Snow.cap('mi8');
    Wind.force({ ms: 10, t: T }); let tb = 0; while (Snow.cap('mi8') > 0.01 && tb < 120) { Snow.step(0.5); tb += 0.5; }
    Wind.force({ ms: 18, t: T }); all(1); let ts = 0; while (Snow.cap('mi8') > 0.01 && ts < 120) { Snow.step(0.5); ts += 0.5; }
    out.A8.blow = { cap6: r3(c6), cap7_5: r3(c75), t10: tb, t18: ts };
    ok(c6 === 1 && c75 === 1 && tb > 0 && tb <= 10 && ts < tb, `A8 сдув: 6 и 7.5 м/с — шапка цела (${r3(c6)}, ${r3(c75)}), 10 м/с — сдута за ${tb} с, 18 м/с — за ${ts} с`);
    // удар по бочке Ми-8 → cap 0, событие shed, комья; в low — событие без частиц
    const sheds = []; Interact.on('shed', e => sheds.push(e));
    Wind.force({ ms: 0, t: T }); all(1); G.parts.length = 0;
    Interact.emit('bump', { who: 'p', obj: 'wreck', x: c.x + 65, y: c.y + 30, power: 0.8 });
    const bits = G.parts.filter(q => q.live === 'snow').length, e0 = sheds[0];
    out.A8.hit = { target: e0 && e0.target, amount: e0 && r3(e0.amount), cap: Snow.cap('barrel'), bits, roof: Snow.cap('mi8') };
    ok(e0 && e0.target === 'barrel' && Snow.cap('barrel') === 0 && bits >= 6 && Snow.cap('mi8') === 1, `A8 удар по бочке: shed ${e0 && e0.target}, cap ${Snow.cap('barrel')}, ${bits} комьев, крыша цела`);
    const q0 = G.rocks && G.rocks[0]; let rockOk = true;
    if (q0) { Snow.set('rock', 1); Interact.emit('bump', { who: 'p', obj: 'rock', target: q0, x: q0.x, y: q0.y, power: 0.8 }); rockOk = Snow.capOf('rock', q0) === 0 && sheds.some(e => e.target === 'rock'); }
    const QL = window.QUALITY; window.QUALITY = 'low'; G.parts.length = 0; const n0 = sheds.length;
    Interact.emit('kick', { who: 'p', x: HUT.x + 124, y: HUT.y, power: 1 });
    const lowBits = G.parts.filter(q => q.live === 'snow').length, lowEv = sheds.length - n0; window.QUALITY = QL;
    out.A8.hit.rock = rockOk; out.A8.hit.low = { events: lowEv, bits: lowBits };
    ok(rockOk && lowEv === 1 && lowBits === 0, `A8 глыба: срыв своей шапки ${rockOk} · low: событие ${lowEv}, частиц ${lowBits}`);
    // наддув растёт от переноса (12 м/с), ступени 0 → 3; при 3 м/с не растёт
    all(null, 0); Wind.force({ ms: 3, t: T }); for (let i = 0; i < 240; i++) Snow.step(0.5); const d3 = Snow.state().hold.hut.d;
    Wind.force({ ms: 12, t: T }); const steps = [], tStep = {}; let tt = 0;
    while (tt < 900 && Snow.state().hold.hut.step < 3) { Snow.step(0.5); tt += 0.5; const st = Snow.state().hold.hut.step; if (steps[steps.length - 1] !== st) { steps.push(st); tStep[st] = tt; } }
    out.A8.drift = { d3ms: r3(d3), steps, tStep };
    ok(d3 === 0 && steps.join() === '0,1,2,3', `A8 наддув: 3 м/с — ${d3}, 12 м/с — ступени ${steps.join('→')} за ${tStep[1]}/${tStep[2]}/${tStep[3]} с`);
    // геометрия: главный нанос — подветренный (по Wind.dir), ≤ 6 h, глубина ≤ 1.2 h; наветренный ≤ 0.5 h; ямка у стенки
    const geo = {}; let gok = true;
    for (const id of ['mi8', 'barrelT', 'hut', 'chum']) {
      Snow.set(id, null, 1); const E = Snow.geo(id, 0), Wg = Snow.geo(id, Math.PI), f = E.foot, h = E.h;
      const g1 = { h, lee: [r3(E.lee.x0), r3(E.lee.len / h), r3(E.lee.depth / h)], wind: [r3(E.wind.x0), r3(E.wind.depth / h)], west: r3(Wg.lee.x0) };
      geo[id] = g1;
      gok = gok && E.lee.x0 >= f[2] && E.wind.x0 <= f[0] && Wg.lee.x0 <= f[0] && E.lee.len <= 6 * h + 1e-6 && E.lee.len >= 5.9 * h && E.lee.depth <= 1.2 * h + 1e-6 && E.wind.depth <= 0.5 * h && E.wind.depth < E.lee.depth && E.pit > 0;
    }
    out.A8.geo = geo;
    ok(gok, `A8 наддув с подветренной: восток при ветре на восток, запад при ветре на запад · длина 6 h · глубина 1.2 h · наветренный ${r3(geo.hut.wind[1])} h · ямка у стенки`);
    // картинка: снег наддува восточнее избы / западнее (ветер на восток) и наоборот
    const px = (dir) => {
      const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 500; const g = cv.getContext('2d'); g.fillStyle = '#eaeff5'; g.fillRect(0, 0, 1000, 500);
      const H0 = Snow.holders.find(h => h.id === 'hut'); let Tq = 5000 + dir * 100;
      for (let i = 0; i < 4; i++) { Tq += 1; Snow.drawDrift(g, 'test-hut', H0.foot, H0.h, 1, 500, 280, 1, Tq, dir); }
      const d = g.getImageData(0, 0, 1000, 500).data; let e = 0, w = 0;
      for (let y = 0; y < 500; y++) for (let x = 0; x < 1000; x++) { const i = (y * 1000 + x) * 4, dv = Math.abs(d[i] - 234) + Math.abs(d[i + 1] - 239) + Math.abs(d[i + 2] - 245); if (dv > 12) { if (x > 500 + 124) e++; else if (x < 500 - 124) w++; } }
      return { east: e, west: w };
    };
    const pe = px(0), pw = px(Math.PI); out.A8.pixels = { windE: pe, windW: pw };
    ok(pe.east > 2 * pe.west && pw.west > 2 * pw.east, `A8 кадр: ветер на восток — снега наддува восточнее ${pe.east} px / западнее ${pe.west}; на запад — ${pw.west} / ${pw.east}`);
    // перепечь: новые спрайты наддува не чаще 1 за 0.25 с, каждый — быстро; всё — шагом 2 Гц и дёшево
    const b0 = Snow.stats.builds, H1 = Snow.holders.filter(h => h.h > 0); let Tb = 9000;
    const cvb = document.createElement('canvas'); cvb.width = cvb.height = 64; const gb = cvb.getContext('2d');
    for (let f = 0; f < 600; f++) { Tb += 1 / 60; for (const h of H1) Snow.drawDrift(gb, 'budget-' + h.id + (f >> 6), h.foot, h.h, 0.5 + (f % 50) / 100, 0, 0, 1, Tb, 0); }
    const builds = Snow.stats.builds - b0;
    let t0 = performance.now(); for (let i = 0; i < 2000; i++) Snow.step(0.5); const stepMs = (performance.now() - t0) / 2000;
    all(1, 0.7); Wind.force({ ms: 8, t: T });
    const cvf = document.createElement('canvas'); cvf.width = 1280; cvf.height = 800; const gf = cvf.getContext('2d'), view = [c.x - 640, c.y - 400, c.x + 640, c.y + 400];
    for (let f = 0; f < 30; f++) Snow.ground(gf, view, { now: 20000 + f / 60 }); // прогрев: спрайты построены
    t0 = performance.now(); for (let f = 0; f < 300; f++) { Snow.ground(gf, view, { now: 20001 + f / 60 }); Snow.drawMi8(gf); } const drawMs = (performance.now() - t0) / 300;
    out.A8.budget = { builds10s: builds, buildMs: r3(Snow.stats.buildMs || 0), stepMs: r3(stepMs), drawMs: r3(drawMs) };
    ok(builds <= 41 && (Snow.stats.buildMs || 0) <= 3, `A8 перепечь: ${builds} спрайтов наддува за 10 с (≤ 1 за 0.25 с), самый долгий ${out.A8.budget.buildMs} мс`);
    ok(stepMs <= 0.05 && drawMs <= 0.4, `A8 цена: шаг ${out.A8.budget.stepMs} мс (2 Гц) · кадр у обломков ${out.A8.budget.drawMs} мс (наддувы + шапки + позёмка)`);
    Snow.force(null); G.parts.length = 0;
  }

  // ===== A9 — следы заносит по ветру, позёмка с гребней =====
  {
    park();
    const life = ms => { // 50 следов: время до последнего; доля живых через 60 с
      G.prints.length = 0; for (let i = 0; i < 50; i++) Fx.print(G.p.x + i * 6, G.p.y + 40, 0, 'p', 1);
      let t = 0, at60 = null; Wind.force({ ms: ms === 'storm' ? 18 : ms, t: T });
      while (G.prints.length && t < 300) { Fx.tick(DT, ms === 'storm'); t += DT; if (at60 == null && t >= 60) at60 = G.prints.length / 50; }
      return { t: r3(t), at60: at60 == null ? 0 : at60 };
    };
    const L0 = life(0), L5 = life(5), L10 = life(10), LS = life('storm'), base = TUNE.engine.printLife;
    out.A9 = { prints: { ms0: L0, ms5: L5, ms10: L10, storm: LS, base } };
    ok(L0.at60 === 1 && L0.t >= 3.6 * base, `A9 штиль: через 60 с живы ${L0.at60 * 100} % следов, занесло за ${L0.t} с`);
    ok(Math.abs(L5.t - base) <= base * 0.1, `A9 5 м/с: занесло за ${L5.t} с (как было, ${base} с ±10 %)`);
    ok(Math.abs(L10.t - base / 2) <= base * 0.05 && Math.abs(LS.t - base / 4) <= base * 0.025, `A9 10 м/с: ${L10.t} с (вдвое быстрее) · пурга: ${LS.t} с (×0.25)`);
    // позёмка: с гребней сугробов земли и наддува обломков, только с 5 м/с, ≤ 30 в кадре
    Snow.set('mi8', null, 0.7);
    const view = [c.x - 640, c.y - 400, c.x + 640, c.y + 400];
    const run = (ms, sec) => { Wind.force({ ms, t: T }); let mx = 0; for (let i = 0, n = Math.round(sec / DT); i < n; i++) { Snow.groundStep(view, DT); if (i > n / 2) mx = Math.max(mx, Snow.state().sp); } return mx; };
    const s4 = run(4, 4), s8 = run(8, 5), s4b = run(4.9, 4);
    const QL = window.QUALITY; window.QUALITY = 'low'; const sLow = run(10, 2); window.QUALITY = QL;
    out.A9.drift = { ms4: s4, ms8: s8, ms4_9: s4b, low10: sLow };
    ok(s4 === 0 && s4b === 0 && s8 > 0 && s8 <= 30 && sLow === 0, `A9 позёмка: 4 и 4.9 м/с — ${s4}/${s4b}, 8 м/с — ${s8} частиц (≤ 30), low — ${sLow}`);
    // полог леса: под густыми кронами ветер ×0.5..0.6, на поляне у избы ×1
    Wind.force({ base: 6, gust: 1, t: T });
    let dense = null; for (const tr of G.trees) if (tr.wood > 0 && Wind.canopy(tr.x, tr.y) <= 0.55) { dense = tr; break; }
    const kIn = dense ? Wind.ms(dense.x, dense.y) / 6 : 1, kHut = Wind.ms(HUT.x, HUT.y) / 6;
    const tq = performance.now(); let sink = 0; for (let i = 0; i < 20000; i++) sink += Wind.ms(c.x + (i % 400) * 7, c.y + (i % 97) * 11); const msCall = (performance.now() - tq) / 20000 * 1000;
    out.A9.canopy = { forest: r3(kIn), hut: r3(kHut), usPerCall: r3(msCall) };
    ok(kIn >= 0.45 && kIn <= 0.6 && kHut >= 0.75 && kHut > kIn + 0.2, `A9 полог леса: ветер в чаще ×${r3(kIn)}, у избы ×${r3(kHut)} · Wind.ms ${r3(msCall)} мкс`);
    G.prints.length = 0;
  }
  Wind.force(null); Live.reset(); G.p.x = hero.x; G.p.y = hero.y;
  return { out, fails, okl };
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const log = [], fail = [];
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const errs = [];
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await pg.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
    await pg.goto(URL); await pg.waitForTimeout(500);
    await pg.click('#start'); await pg.waitForTimeout(700);
    await pg.evaluate(() => { Story.tick = () => {}; Director.tick = () => {}; Weather.tick = () => {}; Weather.newDay = () => {}; });
    // A1: деревья, частицы и звук читают только Wind — вызовы за один кадр рендера у обломков
    const reads = await pg.evaluate(() => new Promise(res => {
      G.p.x = POI.cockpit.x + 60; G.p.y = POI.cockpit.y + 120; G.time = tAt(1, 12);
      const W0 = Wind.gust, M0 = Wind.ms; let g = 0, m = 0;
      Wind.gust = (x, y) => { g++; return W0(x, y); }; Wind.ms = (x, y) => { m++; return M0(x, y); };
      requestAnimationFrame(() => requestAnimationFrame(() => { Wind.gust = W0; Wind.ms = M0; res({ gust: g, ms: m }); }));
    }));
    const r = await pg.evaluate(suite);
    r.out.A1.reads = reads;
    if (!(reads.gust > 0)) r.fails.push('A1 деревья не читают Wind.gust');
    // grep: зашитых «ветров» нет
    const JS = path.resolve(__dirname, '../js'), bad = [];
    for (const f of fs.readdirSync(JS).filter(f => f.endsWith('.js'))) {
      const s = fs.readFileSync(path.join(JS, f), 'utf8');
      if (/storm \? (70|80|90)\b/.test(s)) bad.push(f + ': storm ? 70/80/90');
      if (/gustT/.test(s)) bad.push(f + ': свой порыв (gustT)');
      if (/sin\(t \* 3\) \* 2/.test(s) && f === 'art-world.js' && !/Live\.flag/.test(s)) bad.push(f + ': вымпел sin(t·3)');
    }
    r.out.A1.grep = bad;
    (bad.length ? r.fails : r.okl).push('A1 grep: зашитых ветров в спавнах и своего порыва звука нет' + (bad.length ? ' — ' + bad.join('; ') : ''));
    fs.writeFileSync(path.join(__dirname, 'out-passport.json'), JSON.stringify(r.out, null, 1));
    for (const l of r.okl) log.push('ok   ' + l);
    for (const f of r.fails) { log.push('FAIL ' + f); fail.push(f); }
    for (const e of errs) { log.push(e); fail.push(e); }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  console.log(fail.length ? `ERR passport: ${fail.length} проверок не прошло` : 'passport: все проверки волн 1–3 прошли');
  process.exitCode = fail.length ? 1 : 0;
})();
