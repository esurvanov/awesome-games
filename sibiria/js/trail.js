'use strict';
// Trail — тропы, расчистка и отвалы: сетка поверх глубины снега (js/depth.js). 1 м = 23 px.
//   🗺 сетка 8 px (0,35 м), лениво блоками 32×32 (= 256 px мира); на клетку три слоя: верх (pack 0..1, 1 — вычищено до земли),
//      плотная основа (заметается в 8 раз медленнее: после пурги вычищенное лопатой проявляется одним проходом) и отвал h (см снега сверху).
//      pack/основа хранят «срок» e: значение = max(0, (e − FILL)·K) — заметание без обхода сетки, промотка ночи бесплатна.
//   🌬 FILL += dt · темп (Snow.printRate; пурга ×3.3), K = 0.3 / (CYCLE·0.25): штиль — −0.3 pack за игровые сутки, пурга — тропа за 1–1.5 ч.
//      Отвалы пурга не стирает — скругляет (растекание объёма между соседями), у двери избы наметает нанос 80–120 см.
//   👣 «глубина решает»: прибавка за проход a·(1 − sm(45, 90, d)), предел — 0.92 до 40 см, 0.5 от 70 см (траншея, не тропа);
//      основа под свежим снегом проявляется проходом сверх предела. Тело — каждые 12 px пути, пятно позади (через шаг).
//   🪏 лопата: cut — полоса (сегмент × полуширина) до земли, основа 0.9; снятый объём (м³, по клеткам) → dump — в точку падения кома
//      (мягкое пятно r 10 px). Объём сохраняется: снято = легло в отвалы.
//   📏 глубина: d × f(pack) + отвал; скорость героя на тропе — до зимника.
//   🎨 слой над землёй: кусок = блок, холст 512 px (low — 192), перепечка при смене уровня, ≤ 1 печь за кадр; поле → вдвое мельче (4 px) →
//      RGBA: дно в тени, дальняя (северная) стенка — светлой полосой высотой глубина·0.23 px, ближняя — тонкой тенью, отвал — вал с тенью.
//   💾 сейв: trailB = 'T3' + блоки (байты pack, основы, отвала в см; нули — RLE) base64 + trailF (FILL). Старый сейв (сетка 12 px, без
//      отвалов) — пересэмплируется. Нет поля — троп нет.
// Свой поток случайности не нужен; Math.random игры не тратит.
const Trail = (() => {
  const C = 8, BS = 32, BW = C * BS, NC = BS * BS, NX = Math.ceil(W / C), NY = Math.ceil(H / C), BX = Math.ceil(NX / BS), BY = Math.ceil(NY / BS);
  const PXM = 23, A = (C / PXM) ** 2;   // площадь клетки, м²
  const STEP = 12;                       // шаг тела между пятнами, px
  // заметание — календарное (игровые сутки CYCLE × штиль 0.25)
  const K = 0.3 / (CYCLE * 0.25), KB = K / 8, CAP = 0.92, STORM = 3.3;
  const sm = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const raw = (x, y) => (typeof Depth !== 'undefined' && Depth.rawAt ? Depth.rawAt(x, y) : 60);
  // профили тел: a — прибавка за проход, r — радиус пятна (px), f — плоское пятно (снегоступы, нарты — шире и ровнее), sup — опора (снегоступы держат)
  const PROF = {
    p: { a: 0.38, r: 11 }, ski: { a: 0.18, r: 10, f: 1, sup: 1 }, shoes: { a: 0.36, r: 14, f: 1, sup: 1 }, ride: { a: 0.5, r: 16, f: 1, sup: 1 },
    n: { a: 0.38, r: 11 }, deer: { a: 0.25, r: 11 }, wolf: { a: 0.14, r: 8 }, bear: { a: 0.4, r: 13 }, dog: { a: 0.1, r: 7 },
  };
  // интеграл пятна вдоль пути / шаг ≈ 12.5 px → норма (за проход по оси — ровно a)
  const NORM = { s: 12.5 / (11 * 12 / 7), f: 12.5 / (11 * 16 / 9) };
  // «глубина решает»: множитель прибавки и предел уплотнения ногами по глубине целины (см); снегоступы/лыжи — как по мелкому
  const gainD = d => 1 - 0.65 * sm(45, 90, d), capD = d => CAP - 0.42 * sm(40, 70, d);

  let gRef = null, FILL = 0, BL = new Array(BX * BY).fill(null), nB = 0, sweepT = 0;
  const ST = { cut: 0, dump: 0 };   // накопительно, м³ (проверки)
  function reset() { BL = new Array(BX * BY).fill(null); nB = 0; FILL = 0; sweepT = 0; M = new WeakMap(); CH.clear(); ST.cut = ST.dump = 0; DOOR.t = 0; }
  function ensure() { if (typeof G === 'undefined' || !G) return false; if (gRef !== G) { gRef = G; reset(); } return true; }
  const mk = () => ({ e: new Float32Array(NC), b: new Float32Array(NC), h: new Float32Array(NC), exp: 0, hs: 0, rw: null, rwT: -1e9 });
  function blk(i, j, make) {
    if (i < 0 || j < 0 || i >= NX || j >= NY) return null;
    const k = ((i / BS) | 0) + ((j / BS) | 0) * BX; let b = BL[k];
    if (!b && make) { b = BL[k] = mk(); nB++; }
    return b;
  }
  const idx = (i, j) => (j % BS) * BS + (i % BS);
  function val(i, j) { const b = blk(i, j); if (!b) return 0; const v = (b.e[idx(i, j)] - FILL) * K; return v > 0 ? v : 0; }
  function bval(i, j) { const b = blk(i, j); if (!b) return 0; const v = (b.b[idx(i, j)] - FILL) * KB; return v > 0 ? v : 0; }
  function hval(i, j) { const b = blk(i, j); return b ? b.h[idx(i, j)] : 0; }
  function put(i, j, p, q) {
    const b = blk(i, j, true), k = idx(i, j);
    b.e[k] = p > 0 ? FILL + p / K : 0; b.b[k] = q > 0 ? FILL + q / KB : 0;
    if (b.e[k] > b.exp) b.exp = b.e[k]; if (b.b[k] > b.exp) b.exp = b.b[k];
  }
  // сырая глубина в центре клетки (кэш блока на 60 игровых с: печь куска и примерка среза не зовут depthAt на каждую клетку)
  function rawC(i, j) {
    const b = blk(i, j, true); if (!b) return 0;
    if (!b.rw || Math.abs(G.time - b.rwT) > 60) { b.rw = b.rw || new Float32Array(NC); b.rw.fill(NaN); b.rwT = G.time; }
    const k = idx(i, j); let v = b.rw[k];
    if (v !== v) { const cx = (i + 0.5) * C, cy = (j + 0.5) * C; v = b.rw[k] = insideHut(cx, cy) ? 0 : raw(cx, cy); }
    return v;
  }
  function hput(i, j, v) { const b = blk(i, j, v > 0.05); if (!b) return; const k = idx(i, j), nv = v > 0.05 ? v : 0; b.hs += nv - b.h[k]; b.h[k] = nv; }
  // доля глубины, что остаётся при уплотнении p (вычищено — до нуля)
  const fP = v => (v <= 0.9 ? 1 - 0.88 * v : 0.208 * (1 - v) / 0.1);
  // значение в точке (билинейно), максимум углов и отвал
  const AT = { v: 0, mx: 0, h: 0 };
  function sample(x, y) {
    AT.v = 0; AT.mx = 0; AT.h = 0; if (!nB || gRef !== G) return AT;
    const fx = x / C - 0.5, fy = y / C - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    const a = blk(i, j), b = blk(i + 1, j), c = blk(i, j + 1), d = blk(i + 1, j + 1);
    if (!a && !b && !c && !d) return AT;
    const va = val(i, j), vb = val(i + 1, j), vc = val(i, j + 1), vd = val(i + 1, j + 1);
    AT.mx = Math.max(va, vb, vc, vd);
    if (AT.mx > 0) AT.v = (va * (1 - u) + vb * u) * (1 - w) + (vc * (1 - u) + vd * u) * w;
    const ha = hval(i, j), hb = hval(i + 1, j), hc = hval(i, j + 1), hd = hval(i + 1, j + 1);
    if (ha || hb || hc || hd) AT.h = (ha * (1 - u) + hb * u) * (1 - w) + (hc * (1 - u) + hd * u) * w;
    return AT;
  }
  const at = (x, y) => sample(x, y).v;
  const berm = (x, y) => sample(x, y).h;
  // глубина с тропой: d × f(pack) + отвал/нанос сверху
  function depth(d, x, y) {
    if (!nB) return d;
    const s = sample(x, y); let r = d;
    if (s.mx > 0 && d > 0) r = d * fP(s.v);
    return r + s.h;
  }

  // ---------- протаптывание ----------
  function stamp(x, y, P, d0) {
    if (!ensure()) return;
    const r = P.r, n = P.f ? NORM.f * 11 / r : NORM.s * 11 / r, d = P.sup ? 30 : d0 != null ? d0 : raw(x, y) + berm(x, y), a = P.a * n * gainD(d), cp = capD(d);
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
      const dx = (i + 0.5) * C - x, dy = (j + 0.5) * C - y, q = (dx * dx + dy * dy) / (r * r); if (q >= 1) continue;
      const w = P.f ? 1 - q * q * q * q : 1 - q * q * q; // у снегоступов, нарт — плоское дно и резкий край
      let p = val(i, j), b = bval(i, j); const p0 = p;
      const top = Math.max(cp, Math.min(CAP, b));   // плотная основа (лопатой — 0.9) проявляется выше предела рыхлого
      if (p < top) { p = Math.min(top, p + a * w * (1 - p / top)); if (b > 0) p = Math.min(top, p + b * (p0 < 0.5 * b ? sm(0.45, 0.75, b) : 1) * Math.min(1, w * 1.3) * (1 - p / top)); } // основа под свежим снегом: вычищенное лопатой (0.9) проявляется сразу, натоптанное — слабее
      if (p > b) b += (p - b) * 0.5 * w;
      put(i, j, p, b);
    }
  }
  // тело o прошло в (x, y): пятно — на точку два шага назад (≥ 12–24 px позади)
  let M = new WeakMap();
  function step(o, x, y, prof) {
    if (!ensure()) return;
    let m = M.get(o); if (!m) { M.set(o, { x, y, px: NaN, py: NaN }); return; }
    const dx = x - m.x, dy = y - m.y, d2 = dx * dx + dy * dy;
    if (d2 > 80 * 80) { m.x = x; m.y = y; m.px = NaN; return; } // телепорт / рывок
    if (d2 < STEP * STEP) return;
    if (m.px === m.px && !insideHut(m.px, m.py) && !onIce(m.px, m.py)) stamp(m.px, m.py, PROF[prof] || PROF.p);
    m.px = m.x; m.py = m.y; m.x = x; m.y = y;
  }

  // ---------- лопата: срез и отвал ----------
  // полоса от (x0, y0) до (x1, y1) с круглыми концами, полуширина hw px: клетки → вычищено до веса w (по расстоянию до оси, край ±4 px;
  // дно = max(было, w) — повторный проход не «перекапывает»), основа 0.9, отвал в полосе снят. Вернёт снятый объём, м³
  // (по клеткам: сырая глубина × Δf + Δотвал) — ровно то, что ляжет в отвал
  function cut(x0, y0, x1, y1, hw, k = 1, dry = false) {
    if (!ensure()) return 0;
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-6, R = hw + 3;
    const i0 = Math.floor((Math.min(x0, x1) - R) / C), i1 = Math.floor((Math.max(x0, x1) + R) / C), j0 = Math.floor((Math.min(y0, y1) - R) / C), j1 = Math.floor((Math.max(y0, y1) + R) / C);
    let vol = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
      const cx = (i + 0.5) * C, cy = (j + 0.5) * C, t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / L2));
      const ex = cx - x0 - dx * t, ey = cy - y0 - dy * t, ds = Math.sqrt(ex * ex + ey * ey), w = Math.max(0, Math.min(1, (hw + 3 - ds) / 6)) * k;
      if (w <= 0) continue;
      const p0 = val(i, j), b0 = bval(i, j), h0 = hval(i, j), p1 = Math.max(p0, w), h1 = w >= 0.98 ? 0 : h0 * (1 - Math.max(0, w - 0.5) * 2 * 0.5);   // профиль полосы: дно — max(было, вес); отвал в полосе — снят
      if (p1 - p0 < 1e-4 && h0 - h1 < 0.05) continue;
      const d = rawC(i, j);
      vol += (d * (fP(p0) - fP(p1)) + (h0 - h1)) / 100 * A;
      if (dry) continue;   // примерка: сколько снимет (подбор хода фронта под один ком)
      put(i, j, p1, Math.max(b0, 0.9 * Math.min(1, p1)));
      hput(i, j, h1);
    }
    if (dry) return vol;
    // следы внутри вычищенного — сняты вместе со снегом
    if (G.prints) for (const f of G.prints) { if (f.life <= 0.3) continue; const t = Math.max(0, Math.min(1, ((f.x - x0) * dx + (f.y - y0) * dy) / L2)), ex = f.x - x0 - dx * t, ey = f.y - y0 - dy * t; if (ex * ex + ey * ey < hw * hw) f.life = 0.3; }
    ST.cut += vol; return vol;
  }
  // ком лёг: объём vol (м³) → отвал, мягкое пятно r px (сумма по клеткам = vol)
  const DW = [];
  function dump(x, y, vol, r = 10) {
    if (!ensure() || !(vol > 0)) return;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    let s = 0; DW.length = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
      const dx = (i + 0.5) * C - x, dy = (j + 0.5) * C - y, q = (dx * dx + dy * dy) / (r * r); if (q >= 1) continue;
      const w = (1 - q) * (1 - q); DW.push(i, j, w); s += w;
    }
    if (!s) { const i = Math.floor(x / C), j = Math.floor(y / C); DW.push(i, j, 1); s = 1; }
    for (let k = 0; k < DW.length; k += 3) { const i = DW[k], j = DW[k + 1]; hput(i, j, hval(i, j) + vol * DW[k + 2] / s / A * 100); }
    ST.dump += vol;
  }
  // объём отвалов, м³ (проверки)
  function bermVol() { let s = 0; for (const b of BL) if (b && b.hs > 0) for (let k = 0; k < NC; k++) s += b.h[k]; return s / 100 * A; }
  // доля клеток прямоугольника с pack ≥ thr (площадка на мари)
  function frac(x0, y0, x1, y1, thr = 0.7) {
    if (!ensure()) return 0;
    let n = 0, ok = 0;
    for (let j = Math.ceil(y0 / C - 0.5); (j + 0.5) * C <= y1; j++) for (let i = Math.ceil(x0 / C - 0.5); (i + 0.5) * C <= x1; i++) { n++; if (val(i, j) >= thr) ok++; }
    return n ? ok / n : 0;
  }
  // за отвалом/стенкой ≥ 60 см и длиной ≥ 2 м с наветренной стороны — ветер ×0.3 на 3 высоты, к 5 высотам — открыто. dir — куда дует
  function shelter(x, y, dir) {
    if (!nB) return 1;
    const cs = Math.cos(dir), sn = Math.sin(dir); let k = 1;
    for (let s = 6; s <= 150; s += 6) {
      const px = x - cs * s, py = y - sn * s, h = berm(px, py); if (h < 60) continue;
      const H = h / 100 * PXM; if (s > 5 * H) continue;
      // длина стенки поперёк ветра: ±1 м от оси (вместе 2 м) — тоже ≥ 60·0.8 см
      if (berm(px - sn * PXM, py + cs * PXM) < 48 || berm(px + sn * PXM, py - cs * PXM) < 48) continue;
      k = Math.min(k, 0.3 + 0.7 * sm(3 * H, 5 * H, s));
      if (k <= 0.3) break;
    }
    return k;
  }
  // множитель предела скорости героя на тропе: тайга — до зимника (1/walk ≤ 1.43), натоптанное у жилья — ×1.12
  function speedCap(x, y, walk) {
    const v = at(x, y); if (v <= 0.2) return 1;
    const top = Math.max(1.12, Math.min(1.43, 1 / (walk || 1)));
    return 1 + (top - 1) * sm(0.25, 0.8, v);
  }

  // ---------- дверь избы: нанос после пурги ----------
  // участок ~3×2 м перед дверью (вдоль стены 70 px, от стены 46 px); пик 80–120 см у стены — с подветренной стороны выше
  const DOOR = { x0: HUT.x - 35, x1: HUT.x + 35, y0: HUT_IN.y1 + WALL, y1: HUT_IN.y1 + WALL + 46, t: 0 };
  // пик: 80 см — у любой стены (вихрь у угла), до 120 — если дверь в подветренном наносе избы (Snow.geo lee: ветер с севера → дверь на юге в «тени»)
  const doorPeak = () => {
    const dir = typeof Wind !== 'undefined' ? Wind.dir() : 0, g = typeof Snow !== 'undefined' && Snow.geo ? Snow.geo('hut', dir) : null;
    if (!g || !(g.lee.len > 0)) return 80 + 40 * Math.max(0, Math.sin(dir));
    const q = g.lee, cs = Math.cos(dir), sn = Math.sin(dir), dx = 0 - q.x0, dy = HUT_IN.y1 + WALL + 20 - HUT.y - q.y0;
    const u = dx * cs + dy * sn, v = -dx * sn + dy * cs, inn = u > -20 && u < q.len && Math.abs(v) < q.width / 2 + 10;
    return 80 + 40 * (inn ? 1 - 0.5 * Math.max(0, u) / q.len : Math.max(0, sn) * 0.5);
  };
  function doorProfile(x, y) { // 0..1: у стены и по оси двери — 1, к краю участка — 0
    const u = (y - DOOR.y0) / (DOOR.y1 - DOOR.y0), v = Math.abs(x - HUT.x) / 35;
    if (u < -0.05 || u > 1.15 || v > 1.3) return 0;
    return (1 - 0.75 * sm(0.05, 1.1, u)) * (1 - sm(0.85, 1.3, v));   // у стены — пик, к краю участка спадает
  }
  function doorStorm(dt) {
    const pk = doorPeak(), tau = 25;
    for (let j = Math.floor((DOOR.y0 - 6) / C); j <= Math.floor((DOOR.y1 + 12) / C); j++) for (let i = Math.floor((DOOR.x0 - 12) / C); i <= Math.floor((DOOR.x1 + 12) / C); i++) {
      const cx = (i + 0.5) * C, cy = (j + 0.5) * C; if (cy < HUT_IN.y1 + WALL) continue;
      const T = pk * doorProfile(cx, cy); if (T <= 0) continue;
      const h = hval(i, j); if (h < T) hput(i, j, h + (T - h) * (1 - Math.exp(-dt / tau)));
    }
  }
  // глубина у двери (наибольшая по оси выхода, см) — сюжет и проверки
  function doorDepth() { if (typeof Depth === 'undefined') return 0; let m = 0; for (let y = DOOR.y0 + 2; y <= DOOR.y1; y += 4) m = Math.max(m, Depth.depthAt(HUT.x, y)); return m; }

  // ---------- заметание ----------
  const rate = storm => (typeof Snow !== 'undefined' ? Snow.printRate(storm) : storm ? 4 : 1) * (storm ? STORM : 1);
  // пурга скругляет отвалы: поток между соседями ∝ разнице (объём сохраняется)
  function smooth(kap) {
    for (let q = 0; q < BL.length; q++) {
      const b = BL[q]; if (!b || !(b.hs > 0.5)) continue;
      const bi = q % BX, bj = (q / BX) | 0;
      for (let c = 0; c < NC; c++) {
        const i = bi * BS + (c % BS), j = bj * BS + ((c / BS) | 0);
        for (let s = 0; s < 2; s++) { const i2 = i + 1 - s, j2 = j + s, h = hval(i, j), h2 = hval(i2, j2), f = kap * (h - h2); if (Math.abs(f) < 0.02 || i2 >= NX || j2 >= NY) continue; hput(i, j, h - f); hput(i2, j2, h2 + f); }
      }
    }
  }
  function tick(dt, storm) {
    if (!ensure() || dt <= 0) return;
    FILL += dt * rate(storm);
    if (storm) { // у двери — нанос; лопату, оставленную у двери, заносит; поленницу без навеса — тоже
      doorStorm(dt); DOOR.t += dt;
      if (G.flags && !G.gear.shovel && !G.flags.shovel) G.flags.shovelSnow = 1;
      if (G.hut && !G.hut.roof) G.pileSnow = Math.min(1, (G.pileSnow || 0) + dt / (0.6 * HOUR));
    }
    if ((sweepT += dt) < 3) return; const sw = sweepT; sweepT = 0;
    if (storm) smooth(Math.min(0.2, 0.012 * sw));
    for (let k = 0; k < BL.length; k++) if (BL[k] && BL[k].exp <= FILL && !(BL[k].hs > 0.5)) { BL[k] = null; nB--; } // блок замело весь, отвалов нет — выгрузить
  }

  // ---------- сейв ----------
  function pack() {
    if (!ensure() || !nB) return null;
    const out = [84, 51]; // 'T3'
    for (let k = 0; k < BL.length; k++) {
      const b = BL[k]; if (!b || (b.exp <= FILL && !(b.hs > 0.5))) continue;
      const bi = k % BX, bj = (k / BX) | 0, bytes = new Uint8Array(NC * 3); let any = 0;
      for (let c = 0; c < NC; c++) {
        const i = bi * BS + (c % BS), j = bj * BS + ((c / BS) | 0);
        const p = Math.round(val(i, j) * 255), q = Math.round(bval(i, j) * 255), h = Math.min(255, Math.round(b.h[c])); bytes[c] = p; bytes[NC + c] = q; bytes[2 * NC + c] = h; any |= p | q | h;
      }
      if (!any) continue;
      out.push(k & 255, k >> 8);
      for (let c = 0; c < bytes.length;) { // RLE нулей: 0, длина (1..255)
        if (bytes[c]) { out.push(bytes[c++]); continue; }
        let n = 0; while (c < bytes.length && !bytes[c] && n < 255) { c++; n++; } out.push(0, n);
      }
    }
    let s = ''; for (let i = 0; i < out.length; i += 4096) s += String.fromCharCode.apply(null, out.slice(i, i + 4096));
    return btoa(s);
  }
  function load(b64, fill) {
    gRef = G; reset(); FILL = +fill || 0;
    if (!b64) return;
    const s = atob(b64), v3 = s.charCodeAt(0) === 84 && s.charCodeAt(1) === 51;
    // старый формат: сетка 12 px, блок 32×32, два слоя (без отвалов) — пересэмплировать в 8 px
    const oC = 12, oNX = Math.ceil(W / oC), oBX = Math.ceil(oNX / BS), L = v3 ? NC * 3 : NC * 2;
    let c = v3 ? 2 : 0;
    while (c + 2 <= s.length) {
      const k = s.charCodeAt(c) | (s.charCodeAt(c + 1) << 8); c += 2;
      const bytes = new Uint8Array(L);
      for (let o = 0; o < bytes.length && c < s.length;) { const v = s.charCodeAt(c++); if (v) bytes[o++] = v; else o += s.charCodeAt(c++); }
      if (v3) {
        if (k >= BL.length) continue;
        const bi = k % BX, bj = (k / BX) | 0;
        for (let q = 0; q < NC; q++) { const i = bi * BS + (q % BS), j = bj * BS + ((q / BS) | 0); if (bytes[q] || bytes[NC + q]) put(i, j, bytes[q] / 255, bytes[NC + q] / 255); if (bytes[2 * NC + q]) hput(i, j, bytes[2 * NC + q]); }
      } else {
        const bi = k % oBX, bj = (k / oBX) | 0;
        for (let q = 0; q < NC; q++) {
          if (!bytes[q] && !bytes[NC + q]) continue;
          const x0 = (bi * BS + (q % BS)) * oC, y0 = (bj * BS + ((q / BS) | 0)) * oC;
          for (let j = Math.ceil(y0 / C - 0.5); (j + 0.5) * C < y0 + oC; j++) for (let i = Math.ceil(x0 / C - 0.5); (i + 0.5) * C < x0 + oC; i++) if (i >= 0 && j >= 0 && i < NX && j < NY) put(i, j, bytes[q] / 255, bytes[NC + q] / 255);
        }
      }
    }
  }

  // ---------- рисунок ----------
  // поле куска 34×34 клетки (−1..32, края — из соседей) → вдвое мельче (4 px мира) → RGBA → сглаженное увеличение в холст куска
  const CH = new Map(), BT = [], MG = 4; let lastChk = -9, FC = null, FG = null, FD = null, bakeMs = 0, bakes = 0;
  const QV = v => Math.round(v * 8) / 8, QH = h => Math.round(h / 3) * 3;
  function sig(bi, bj) {
    let s = 0; const i0 = bi * BS - 1, j0 = bj * BS - 1;
    for (let j = 0; j < BS + 7; j++) for (let i = 0; i < BS + 2; i++) { const q = Math.round(val(i0 + i, j0 + j) * 8) + QH(hval(i0 + i, j0 + j)) * 16; if (q) s = (s * 31 + q * (i + 1) + j * 977) % 1000000007; }
    return s;
  }
  // наложение цвета (src-over, прямая альфа) в пиксель PX = [r, g, b, a]
  const PX = new Float32Array(4);
  function over(cr, cg, cb, a) { if (a <= 0.004) return; if (a > 1) a = 1; const A0 = PX[3], k = A0 * (1 - a), na = a + k; PX[0] = (cr * a + PX[0] * k) / na; PX[1] = (cg * a + PX[1] * k) / na; PX[2] = (cb * a + PX[2] * k) / na; PX[3] = na; }
  // словарь C (js/style.js): тропа — тон тени с кромкой тушью; контур по полю (marching squares) — Path2D, рисуется живьём
  const SC = typeof Style !== 'undefined' && Style.flat, TT = 0.62;
  function bakeC(bi, bj, lo, t0) {
    const N = BS + 2, F = new Float32Array(N * N), i0 = bi * BS - 1, j0 = bj * BS - 1;
    let any = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = QV(val(i0 + i, j0 + j)); F[j * N + i] = v; if (v >= TT) any = 1; }
    const key = bi + bj * BX;
    if (!any) { CH.set(key, { c: null, f: null, S: lo, sig: -1 }); return; }
    const fill = new Path2D(), line = new Path2D(), X = k => (i0 + k + 0.5) * C, Y = k => (j0 + k + 0.5) * C - LIFT;
    const P = [], cutP = (xa, ya, va, xb, yb, vb) => { const u = (TT - va) / (vb - va); return [xa + (xb - xa) * u, ya + (yb - ya) * u]; };
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const v = [F[j * N + i], F[j * N + i + 1], F[(j + 1) * N + i + 1], F[(j + 1) * N + i]], q = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]];
      const inn = v.map(a => a >= TT), n = inn.filter(Boolean).length; if (!n) continue;
      if (n === 4) { fill.rect(q[0][0], q[0][1], C, C); continue; }
      P.length = 0; const ex = [];
      for (let k = 0; k < 4; k++) { const k1 = (k + 1) & 3; if (inn[k]) P.push(q[k]); if (inn[k] !== inn[k1]) { const c = cutP(q[k][0], q[k][1], v[k], q[k1][0], q[k1][1], v[k1]); P.push(c); ex[k] = c; } }
      fill.moveTo(P[0][0], P[0][1]); for (let k = 1; k < P.length; k++) fill.lineTo(P[k][0], P[k][1]); fill.closePath();
      const seg = (a, b) => { line.moveTo(ex[a][0], ex[a][1]); line.lineTo(ex[b][0], ex[b][1]); };
      if (n === 2 && inn[0] === inn[2]) {
        const cin = (v[0] + v[1] + v[2] + v[3]) / 4 >= TT, iso = k => inn[k] !== cin;
        if (iso(0)) seg(0, 3); if (iso(1)) seg(0, 1); if (iso(2)) seg(1, 2); if (iso(3)) seg(2, 3);
      } else { const e = []; for (let k = 0; k < 4; k++) if (ex[k]) e.push(k); if (e.length === 2) seg(e[0], e[1]); }
    }
    CH.set(key, { c: null, f: fill, l: line, S: lo });
    if (CH.size > 64) for (const [k2, v2] of CH) { if (k2 !== key && !v2.vis) { CH.delete(k2); break; } }
    const ms = performance.now() - t0; bakes++; bakeMs = Math.max(bakeMs, ms); BT.push(ms); if (BT.length > 64) BT.shift();
  }
  // билинейное увеличение поля N×NH → M×MH (в RS раз); Ac — только активные клетки (остальное — 0)
  function up2(F, F2, N, NH, M, MH, Ac) {
    for (let y = 0; y < MH; y++) for (let x = 0; x < M; x++) {
      if (Ac && !Ac[((y / RS) | 0) * N + ((x / RS) | 0)]) { F2[y * M + x] = 0; continue; }
      let fx = (x + 0.5) / RS - 0.5, fy = (y + 0.5) / RS - 0.5; fx = fx < 0 ? 0 : fx > N - 1 ? N - 1 : fx; fy = fy < 0 ? 0 : fy > NH - 1 ? NH - 1 : fy;
      const a = fx | 0, b = fy | 0, u = fx - a, w = fy - b, a1 = a + 1 < N ? a + 1 : a, b1 = b + 1 < NH ? b + 1 : b;
      F2[y * M + x] = (F[b * N + a] * (1 - u) + F[b * N + a1] * u) * (1 - w) + (F[b1 * N + a] * (1 - u) + F[b1 * N + a1] * u) * w;
    }
  }
  let F2v = null, F2r = null, F2h = null, RS = 4;
  function bake(bi, bj, lo) {
    const t0 = performance.now(), N = BS + 2, NH = N + 5;   // 5 клеток к югу — только смотреть: поднятый вал соседа снизу виден в этом куске
    if (SC) return bakeC(bi, bj, lo, t0);
    RS = lo ? 2 : 3; const Mm = N * RS, MH = NH * RS, U = C / RS; // пиксель поля ≈ 2.7 px мира (low — 4)
    if (FC && FC.width !== Mm) FC = null;
    if (!FC) { FC = document.createElement('canvas'); FC.width = FC.height = Mm; FG = FC.getContext('2d'); FD = FG.createImageData(Mm, Mm); F2v = new Float32Array(Mm * MH); F2r = new Float32Array(Mm * MH); F2h = new Float32Array(Mm * MH); }
    const Fv = new Float32Array(N * NH), Fr = new Float32Array(N * NH), Fh = new Float32Array(N * NH), i0 = bi * BS - 1, j0 = bj * BS - 1;
    let anyV = 0;
    for (let j = 0; j < NH; j++) for (let i = 0; i < N; i++) {
      const v = QV(val(i0 + i, j0 + j)), h = QH(hval(i0 + i, j0 + j)); Fv[j * N + i] = v; Fh[j * N + i] = h;
      // снято, см: сырая глубина × (1 − f) — где тронуто
      if (v > 0) { anyV = 1; Fr[j * N + i] = rawC(i0 + i, j0 + j) * (1 - fP(v)); }
    }
    // где рисовать: клетки с тропой/отвалом и соседи (тень вала — до 3 клеток к югу); пустое — прозрачно без обсчёта
    const Ac = new Uint8Array(N * NH); let anyH = 0;
    for (let j = 0; j < NH; j++) for (let i = 0; i < N; i++) { const o = j * N + i; if (!(Fv[o] > 0) && !(Fh[o] > 0)) continue; const sj = Fh[o] > 0 ? 2 : 1, nj = Fh[o] > 0 ? Math.ceil(Fh[o] * 0.23 / C) + 1 : 1; if (Fh[o] > 0) anyH = 1;
      for (let b = Math.max(0, j - nj); b <= Math.min(NH - 1, j + sj); b++) for (let a = Math.max(0, i - 1); a <= Math.min(N - 1, i + 1); a++) Ac[b * N + a] = 1; }
    up2(Fv, F2v, N, NH, Mm, MH, Ac); if (anyH) up2(Fh, F2h, N, NH, Mm, MH, Ac); else F2h.fill(0); if (anyV) up2(Fr, F2r, N, NH, Mm, MH, Ac); else F2r.fill(0);
    const D = FD.data; let any = 0;
    const PH = 0.23 / U, KH = Math.ceil(160 * PH); // см → пикселей поля по экрану; KH — выше 1.6 м вал не смотрим
    for (let j = 0; j < Mm; j++) for (let i = 0; i < Mm; i++) {
      const o = j * Mm + i;
      if (!Ac[((j / RS) | 0) * N + ((i / RS) | 0)]) { D[o * 4 + 3] = 0; continue; }
      const v = F2v[o], r = F2r[o], h = F2h[o];
      PX[0] = PX[1] = PX[2] = PX[3] = 0;
      if (v > 0.02) {
        const dk = sm(8, 70, r);
        over(112, 138, 172, (lo ? 0.5 : 0.4) * sm(0, 0.6, v) + 0.3 * dk);   // дно в тени: утоптанное синее, выемка глубже — темнее
        // дальняя (северная) стенка: к северу в пределах её высоты (глубина·0.23 px) — край выемки; сверху светлее, к дну — в тень
        if (!lo && r > 8) {
          const kh = Math.min(12, Math.ceil(r * PH));
          for (let k = 1; k <= kh; k++) { const jn = j - k; if (jn < 0) break; const rn = F2r[jn * Mm + i]; if (rn < 0.35 * r) { const e = (k - 1) / Math.max(1, r * PH), a = 0.9 * sm(8, 30, r);
            over(222 - 50 * e, 232 - 40 * e, 244 - 30 * e, a); break; } }   // край (целина) нашёлся в пределах высоты стенки
        }
        // ближняя (южная) кромка — тонкая тень
        const rs = F2r[o + Mm]; if (r - rs > 6) over(72, 96, 130, 0.75 * sm(6, 30, r - rs));
      }
      // край дальней стенки на поверхности — белая кромка (отделяет стенку от целины)
      if (!lo && r < 6 && F2r[o + Mm] > 10) over(255, 255, 255, 0.9 * sm(10, 40, F2r[o + Mm]));
      if (anyH && !lo) {
        // отвал поднят над землёй (3/4 сверху): пиксель показывает вал из точки на k к югу, если тот выше k (H·0.23 px);
        // ближний к камере (южный) перекрывает дальний. Верх — светлый, южная стенка — в тени, у подножия — тень на снег
        let cov = -1, hk = 0; const km = Math.min(MH - 1 - j, KH);
        for (let k = km; k >= 0; k--) { const hh = F2h[o + k * Mm]; if (hh > 3 && hh * PH >= k) { cov = k; hk = hh; break; } }
        if (cov >= 0) {
          // освещение по склону в точке-источнике: южный склон (к камере) — в тени, пологий верх — светлый
          const oc0 = o + cov * Mm, sS = Math.max(0, hk - F2h[oc0 + Mm]), e = sm(0, 10, sS);
          over(252 - 50 * e, 253 - 38 * e, 255 - 24 * e, 0.92 * sm(3, 20, hk));
          if (cov === 0 && j && F2h[o - Mm] < hk - 2 && e < 0.3) over(255, 255, 255, 0.5);   // гребень
          const oc = o + cov * Mm, he = i < Mm - 1 ? F2h[oc + 1] : hk, hw = i ? F2h[oc - 1] : hk;   // бока: свет слева, восточный склон — в тени
          if (hk - he > 2) over(120, 146, 180, 0.45 * sm(2, 14, hk - he)); else if (hk - hw > 2) over(255, 255, 255, 0.4 * sm(2, 14, hk - hw));
        } else if (j && F2h[o - Mm] > 8) over(100, 126, 160, 0.35 * sm(8, 40, F2h[o - Mm]));   // тень у подножия
      } else if (h > 3) {
        const hn = j ? F2h[o - Mm] : h, hs = j < Mm - 1 ? F2h[o + Mm] : h;
        over(252, 253, 255, 0.6 * sm(3, 20, h)); if (h - hs > 0.8) over(150, 172, 200, 0.65 * sm(0.8, 8, h - hs)); else if (h - hn > 0.8) over(255, 255, 255, 0.6);
      }
      const q = o * 4; D[q] = PX[0]; D[q + 1] = PX[1]; D[q + 2] = PX[2]; D[q + 3] = Math.round(PX[3] * 255); any |= D[q + 3];
    }
    const key = bi + bj * BX;
    if (!any) { CH.set(key, { c: null, S: lo, sig: -1 }); return; }
    FG.putImageData(FD, 0, 0);
    let e = CH.get(key); const px = lo ? 192 : 512;
    if (!e || !e.c || e.px !== px) { const c = document.createElement('canvas'); c.width = c.height = px + 2 * MG; e = { c, g: c.getContext('2d'), px }; }
    const g = e.g, u = px / BS; g.clearRect(0, 0, px + 2 * MG, px + 2 * MG); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(FC, MG - u, MG - u, N * u, N * u); // клетка −1 → за краем куска
    e.S = lo; CH.set(key, e);
    if (CH.size > (lo ? 48 : 36)) for (const [k2, v2] of CH) { if (k2 !== key && !v2.vis) { CH.delete(k2); break; } }
    const ms = performance.now() - t0; bakes++; bakeMs = Math.max(bakeMs, ms); BT.push(ms); if (BT.length > 64) BT.shift();
  }
  const VIS = [];
  const LIFT = 2; // ближняя стенка видна ниже дна (3/4 сверху): поле чуть выше, дно — под ногами
  const has = (bi, bj) => { for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++) if (i >= 0 && j >= 0 && i < BX && j < BY && BL[i + j * BX]) return true; return false; };
  // слой троп в кадре (до следов): view — [x0, y0, x1, y1] мира; вернёт число кусков
  function draw(g, view) {
    if (!ensure() || !nB) return 0;
    const lo = low(), [x0, y0, x1, y1] = view, T = typeof now === 'number' ? now : performance.now() / 1000;
    const chk = Math.abs(T - lastChk) > 1.2; if (chk) lastChk = T;
    const a0 = Math.max(0, Math.floor(x0 / BW)), a1 = Math.min(BX - 1, Math.floor(x1 / BW)), b0 = Math.max(0, Math.floor(y0 / BW)), b1 = Math.min(BY - 1, Math.floor((y1 + 40) / BW));
    for (const e of CH.values()) e.vis = 0;
    let n = 0, todo = -1, tMiss = false;
    for (let bj = b0; bj <= b1; bj++) for (let bi = a0; bi <= a1; bi++) {
      if (!has(bi, bj)) continue;
      const key = bi + bj * BX; let e = CH.get(key), miss = !e || e.S !== lo;
      if (miss) { const s = sig(bi, bj); if (!s) { CH.set(key, e = { c: null, S: lo, sig: 0 }); miss = false; } }
      else if (chk || e.dirty) { const s = sig(bi, bj); if (s !== e.sig) e.want = 1; e.dirty = 0; }
      if ((miss || (e && e.want)) && (todo < 0 || (miss && !tMiss))) { todo = key; tMiss = miss; }
      if (e) { e.vis = 1; if (e.f && e.S === lo) { VIS.push(e); n++; } else if (e.c && e.S === lo) { g.drawImage(e.c, MG, MG, e.px, e.px, bi * BW, bj * BW - LIFT, BW, BW); n++; } }
    }
    if (todo >= 0) { // ≤ 1 печь за кадр
      const bi = todo % BX, bj = (todo / BX) | 0, s = sig(bi, bj); bake(bi, bj, lo);
      const e = CH.get(todo); if (e) { e.sig = s; e.want = 0; if (tMiss && e.f) { e.vis = 1; VIS.push(e); n++; } else if (tMiss && e.c) { e.vis = 1; g.drawImage(e.c, MG, MG, e.px, e.px, bi * BW, bj * BW - LIFT, BW, BW); n++; } }
    }
    if (VIS.length) {
      g.fillStyle = Style.P.shade; for (const e of VIS) g.fill(e.f);
      g.strokeStyle = Style.P.ink; g.lineWidth = Style.lw(); g.lineCap = 'round'; g.lineJoin = 'round'; for (const e of VIS) g.stroke(e.l);
      VIS.length = 0;
    }
    return n;
  }
  // правка рядом с героем видна сразу (лопата): кусок — в очередь на перепечку
  function touch(x, y) { for (const yy of [y, y - 44]) { const e = CH.get(Math.floor(x / BW) + Math.floor(yy / BW) * BX); if (e) e.dirty = 1; } }   // и кусок выше: поднятый вал виден в нём
  // лопата у двери избы (пока не взяли): черенок к стене, деревянный совок в снегу; занесло пургой — торчит только черенок
  const SHOVEL = { x: HUT.x - 36, y: HUT_IN.y1 + WALL + 3 }; // слева от двери (справа — зарубка Уркачана)
  function drawShovel(g, a = 1) {
    if (!G || (G.gear && G.gear.shovel) || (G.flags && G.flags.shovel)) return;
    const x = SHOVEL.x, y = SHOVEL.y, sn = G.flags && G.flags.shovelSnow; g.save(); g.globalAlpha = a; g.lineCap = 'round';
    if (sn) { // под снегом: конец черенка из сугроба
      g.strokeStyle = '#5b3d27'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 5, y - 20); g.lineTo(x + 7, y - 38); g.stroke();
      g.strokeStyle = '#5b3d27'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 4, y - 38); g.lineTo(x + 10, y - 39); g.stroke();
      g.fillStyle = '#f4f7fa'; g.beginPath(); g.ellipse(x + 3, y - 12, 13, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(120,146,176,0.35)'; g.beginPath(); g.ellipse(x + 3, y - 5, 13, 3, 0, 0, Math.PI * 2); g.fill(); g.restore(); return;
    }
    if (SC) {
      g.strokeStyle = Style.P.ink; g.lineWidth = 2.6 + Style.lw(2); g.beginPath(); g.moveTo(x + 1, y - 6); g.lineTo(x + 7, y - 38); g.stroke();
      g.strokeStyle = Style.P.wood; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 1, y - 6); g.lineTo(x + 7, y - 38); g.stroke();
      g.fillStyle = Style.P.wood; g.strokeStyle = Style.P.ink; g.lineWidth = Style.lw(); g.beginPath(); g.moveTo(x - 6, y - 8); g.lineTo(x + 5, y - 9); g.lineTo(x + 6, y + 2); g.lineTo(x - 6, y + 2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = Style.P.paper; g.beginPath(); g.ellipse(x, y + 2, 9, 2.6, 0, 0, Math.PI * 2); g.fill(); g.restore(); return;
    }
    g.strokeStyle = '#5b3d27'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 1, y - 6); g.lineTo(x + 7, y - 38); g.stroke();
    g.strokeStyle = '#8a6a45'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x + 0.5, y - 7); g.lineTo(x + 6.3, y - 37); g.stroke();
    g.strokeStyle = '#5b3d27'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 4, y - 38); g.lineTo(x + 10, y - 39); g.stroke(); // ручка
    g.fillStyle = '#76593a'; g.beginPath(); g.moveTo(x - 6, y - 8); g.lineTo(x + 5, y - 9); g.lineTo(x + 6, y + 2); g.lineTo(x - 6, y + 2); g.closePath(); g.fill(); // совок
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x - 6, y - 2, 12, 4);
    g.fillStyle = '#f4f7fa'; g.beginPath(); g.ellipse(x, y + 2, 9, 2.6, 0, 0, Math.PI * 2); g.fill(); // присыпано
    g.restore();
  }
  // лопата в руках рисуется ригом позы (js/art-poses.js shovelThrow/shovelPush: черенок от кистей). Здесь — только снег у совка:
  //   толкает — вал перед совком растёт с набранным объёмом (a.load, м³)
  function drawTool(g, a) {
    if (!a || a.mode !== 'push' || !(a.load > 0.004) || typeof ArtPeople === 'undefined') return;
    const S = ArtPeople.dbg && ArtPeople.dbg.sh; if (!S) return;
    const k = Math.min(1, a.load / 0.12), bx = S.b[0] + S.ux * 4, by = S.b[1] + 1, rx = 4 + 6 * k, ry = 1.6 + 3.2 * k;
    g.save();
    g.fillStyle = 'rgba(96,120,154,0.35)'; g.beginPath(); g.ellipse(bx + S.ux * 2, by + 1.2, rx * 1.05, ry * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e9f0f6'; g.beginPath(); g.ellipse(bx, by - ry * 0.4, rx, ry, 0, Math.PI, 0); g.lineTo(bx + rx, by); g.quadraticCurveTo(bx, by + 1, bx - rx, by); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(bx - rx * 0.25, by - ry * 0.9, rx * 0.5, ry * 0.35, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function stats() {
    let n = 0; for (const b of BL) if (b) n++;
    const bt = BT.slice().sort((a, b) => a - b), med = bt.length ? bt[bt.length >> 1] : 0;
    return { blocks: n, kb: +(n * NC * 12 / 1024).toFixed(1), fill: +FILL.toFixed(2), chunks: CH.size, bakes, bakeMs: +bakeMs.toFixed(2), bakeMed: +med.toFixed(2), cell: C, cut: +ST.cut.toFixed(4), dump: +ST.dump.toFixed(4) };
  }
  // основа в точке (клетка) — проверки
  const base = (x, y) => bval(Math.floor(x / C), Math.floor(y / C));
  return {
    at, base, berm, depth, stamp, step, cut, dump, bermVol, frac, shelter, speedCap, tick, rate, pack, load, draw, touch, drawShovel, drawTool, stats,
    doorDepth, doorPeak, DOOR, gainD, capD, PROF, SHOVEL, K, CAP, C, A, PXM,
    get fill() { return FILL; }, resetStats() { bakeMs = 0; bakes = 0; BT.length = 0; },
  };
})();
