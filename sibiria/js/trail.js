'use strict';
// Trail — тропы и расчистка: сетка уплотнения снега поверх глубины (js/depth.js).
//   🗺 сетка 12 px, лениво блоками 32×32 (= 384 px мира); на клетку два слоя: верх (pack 0..1, 1 — расчищено лопатой)
//      и плотная основа (заметается в 5 раз медленнее: после пурги один проход проявляет тропу).
//      Клетка хранит «срок» e: значение = max(0, (e − FILL)·K) — заметание без обхода сетки, промотка ночи бесплатна.
//   🌬 FILL += dt · темп (Snow.printRate; пурга ×3.3): штиль — −0.3 pack за игровые сутки, пурга — тропа за 1–1.5 ч.
//   👣 протаптывание: тело (герой, люди, звери, транспорт) каждые 12 px пути — мягкое пятно позади себя (через шаг: стоя
//      в своей колее не «всплывает»); прибавка a·(1 − p/CAP) за проход, тропа читается с 3-го прохода (p ≥ 0.7).
//   📏 эффект: глубина × (1 − 0.88p) (расчищено — до 0), у края расчистки — отвал; скорость героя на тропе — до зимника.
//   🎨 слой над землёй: кусок = блок, холст 512 px (low — 192), перепечка при смене уровня (p до 1/8), проверка видимых
//      раз в 1.2 с, ≤ 1 печь за кадр; поле клеток → вдвое мельче → RGBA: тень дна, свет дальней стенки, тень ближней,
//      светлый валик (не в low), сглаженное увеличение. Рисуется до лунок и следов.
//   🪏 лопата: Trail.shovel — пятно → 1 за ~1.2 с (≈ 1 м² за 1.5 с), основа — до 0.55; рисунок у двери и в руках.
//   💾 сейв: trailB (тронутые блоки, байты p и основы, нули — RLE, base64) + trailF (FILL). Нет поля — троп нет.
// Свой поток случайности не нужен (без шума); Math.random игры не тратит.
const Trail = (() => {
  const C = 12, BS = 32, BW = C * BS, NC = BS * BS, NX = Math.ceil(W / C), NY = Math.ceil(H / C), BX = Math.ceil(NX / BS), BY = Math.ceil(NY / BS);
  const K = 0.3 / 360, KB = K / 5, CAP = 0.92, STORM = 3.3; // 360 = сутки штиля (1440 с × 0.25)
  const sm = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  // профили тел: a — прибавка за проход, r — радиус пятна (px), f — плоское пятно (снегоступы, нарты — шире и ровнее)
  const PROF = {
    p: { a: 0.38, r: 11 }, ski: { a: 0.18, r: 10, f: 1 }, shoes: { a: 0.36, r: 14, f: 1 }, ride: { a: 0.5, r: 16, f: 1 },
    n: { a: 0.38, r: 11 }, deer: { a: 0.25, r: 11 }, wolf: { a: 0.14, r: 8 }, bear: { a: 0.4, r: 13 }, dog: { a: 0.1, r: 7 },
  };
  // интеграл пятна вдоль пути / шаг ≈ 12.5 px → норма (за проход по оси — ровно a)
  const NORM = { s: 12.5 / (11 * 12 / 7), f: 12.5 / (11 * 16 / 9) };

  let gRef = null, FILL = 0, BL = new Array(BX * BY).fill(null), nB = 0, sweepT = 0;
  function reset() { BL = new Array(BX * BY).fill(null); nB = 0; FILL = 0; sweepT = 0; M = new WeakMap(); CH.clear(); }
  function ensure() { if (typeof G === 'undefined' || !G) return false; if (gRef !== G) { gRef = G; reset(); } return true; }
  const mk = () => ({ e: new Float32Array(NC), b: new Float32Array(NC), exp: 0 });
  function blk(i, j, make) {
    if (i < 0 || j < 0 || i >= NX || j >= NY) return null;
    const k = ((i / BS) | 0) + ((j / BS) | 0) * BX; let b = BL[k];
    if (!b && make) { b = BL[k] = mk(); nB++; }
    return b;
  }
  const idx = (i, j) => (j % BS) * BS + (i % BS);
  function val(i, j) { const b = blk(i, j); if (!b) return 0; const v = (b.e[idx(i, j)] - FILL) * K; return v > 0 ? v : 0; }
  function bval(i, j) { const b = blk(i, j); if (!b) return 0; const v = (b.b[idx(i, j)] - FILL) * KB; return v > 0 ? v : 0; }
  function put(i, j, p, q) {
    const b = blk(i, j, true), k = idx(i, j);
    b.e[k] = p > 0 ? FILL + p / K : 0; b.b[k] = q > 0 ? FILL + q / KB : 0;
    if (b.e[k] > b.exp) b.exp = b.e[k]; if (b.b[k] > b.exp) b.exp = b.b[k];
  }
  // значение в точке (билинейно) и максимум четырёх углов (для отвала)
  const AT = { v: 0, mx: 0 };
  function sample(x, y) {
    AT.v = 0; AT.mx = 0; if (!nB || gRef !== G) return AT;
    const fx = x / C - 0.5, fy = y / C - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    const a = val(i, j), b = val(i + 1, j), c = val(i, j + 1), d = val(i + 1, j + 1);
    AT.mx = Math.max(a, b, c, d); if (AT.mx <= 0) return AT;
    AT.v = (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
    return AT;
  }
  const at = (x, y) => sample(x, y).v;
  // глубина с тропой: d × (1 − 0.88p), расчищенное (p > 0.9) — до нуля; у края расчистки — отвал (до ~20 см)
  function depth(d, x, y) {
    if (!nB || d <= 0) return d;
    const s = sample(x, y); if (s.mx <= 0) return d;
    const v = s.v, f = v <= 0.9 ? 1 - 0.88 * v : 0.208 * (1 - v) / 0.1;
    const berm = s.mx > 0.7 ? 26 * (s.mx - v) * sm(0.7, 1, s.mx) * Math.min(1, d / 30) : 0;
    return d * f + berm;
  }

  // ---------- протаптывание ----------
  function stamp(x, y, P) {
    if (!ensure()) return;
    const r = P.r, n = P.f ? NORM.f * 11 / r : NORM.s * 11 / r, a = P.a * n;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
      const dx = (i + 0.5) * C - x, dy = (j + 0.5) * C - y, q = (dx * dx + dy * dy) / (r * r); if (q >= 1) continue;
      const w = P.f ? 1 - q * q * q * q : 1 - q * q * q; // у снегоступов, нарт — плоское дно и резкий край
      let p = val(i, j), b = bval(i, j);
      if (p < CAP) { p = Math.min(CAP, p + a * w * (1 - p / CAP)); if (b > 0) p = Math.min(CAP, p + b * Math.min(1, w * 1.3) * (1 - p / CAP)); } // основа под свежим снегом — проявилась
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
    if (d2 < C * C) return;
    if (m.px === m.px && !insideHut(m.px, m.py) && !onIce(m.px, m.py)) stamp(m.px, m.py, PROF[prof] || PROF.p);
    m.px = m.x; m.py = m.y; m.x = x; m.y = y;
  }
  // лопата: клетки в пятне r → 1 за ~1.3 с; k = dt/1.3. Вернёт снятый объём (доля пятна) — для разлёта снега
  function shovel(x, y, r, k) {
    if (!ensure()) return 0;
    let got = 0;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
      const dx = (i + 0.5) * C - x, dy = (j + 0.5) * C - y, q = (dx * dx + dy * dy) / (r * r); if (q >= 1) continue;
      const w = 1 - q * q * q * q, p = val(i, j), b = bval(i, j), p1 = Math.min(1, p + k * w); // совок — ровная полоса ~0.9 м
      got += p1 - p; put(i, j, p1, Math.max(b, p1 * 0.55));
    }
    return got;
  }
  // множитель предела скорости героя на тропе: тайга — до зимника (1/walk ≤ 1.43), натоптанное у жилья — ×1.12
  function speedCap(x, y, walk) {
    const v = at(x, y); if (v <= 0.2) return 1;
    const top = Math.max(1.12, Math.min(1.43, 1 / (walk || 1)));
    return 1 + (top - 1) * sm(0.25, 0.8, v);
  }

  // ---------- заметание ----------
  const rate = storm => (typeof Snow !== 'undefined' ? Snow.printRate(storm) : storm ? 4 : 1) * (storm ? STORM : 1);
  function tick(dt, storm) {
    if (!ensure() || dt <= 0) return;
    FILL += dt * rate(storm);
    if ((sweepT += dt) < 3) return; sweepT = 0;
    for (let k = 0; k < BL.length; k++) if (BL[k] && BL[k].exp <= FILL) { BL[k] = null; nB--; } // блок замело весь — выгрузить
  }

  // ---------- сейв ----------
  function pack() {
    if (!ensure() || !nB) return null;
    const out = [];
    for (let k = 0; k < BL.length; k++) {
      const b = BL[k]; if (!b || b.exp <= FILL) continue;
      const bi = k % BX, bj = (k / BX) | 0, bytes = new Uint8Array(NC * 2); let any = 0;
      for (let c = 0; c < NC; c++) {
        const i = bi * BS + (c % BS), j = bj * BS + ((c / BS) | 0);
        const p = Math.round(val(i, j) * 255), q = Math.round(bval(i, j) * 255); bytes[c] = p; bytes[NC + c] = q; any |= p | q;
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
    const s = atob(b64); let c = 0;
    while (c + 2 <= s.length) {
      const k = s.charCodeAt(c) | (s.charCodeAt(c + 1) << 8); c += 2;
      const bytes = new Uint8Array(NC * 2);
      for (let o = 0; o < bytes.length && c < s.length;) { const v = s.charCodeAt(c++); if (v) bytes[o++] = v; else o += s.charCodeAt(c++); }
      if (k >= BL.length) continue;
      const bi = k % BX, bj = (k / BX) | 0;
      for (let q = 0; q < NC; q++) if (bytes[q] || bytes[NC + q]) put(bi * BS + (q % BS), bj * BS + ((q / BS) | 0), bytes[q] / 255, bytes[NC + q] / 255);
    }
  }

  // ---------- рисунок ----------
  // поле куска 34×34 (клетки −1..32, края — из соседей) → мягкое RGBA → увеличение со сглаживанием в холст куска
  const CH = new Map(), BT = [], MG = 4; let lastChk = -9, FC = null, FG = null, FD = null, bakeMs = 0, bakes = 0;
  const QV = v => Math.round(v * 8) / 8;
  function sig(bi, bj) {
    let s = 0; const i0 = bi * BS - 1, j0 = bj * BS - 1;
    for (let j = 0; j < BS + 2; j++) for (let i = 0; i < BS + 2; i++) { const q = Math.round(val(i0 + i, j0 + j) * 8); if (q) s = (s * 31 + q * (i + 1) + j * 977) % 1000000007; }
    return s;
  }
  // наложение цвета (src-over, прямая альфа) в пиксель PX = [r, g, b, a]
  const PX = new Float32Array(4);
  function over(cr, cg, cb, a) { if (a <= 0.004) return; const A = PX[3], k = A * (1 - a), na = a + k; PX[0] = (cr * a + PX[0] * k) / na; PX[1] = (cg * a + PX[1] * k) / na; PX[2] = (cb * a + PX[2] * k) / na; PX[3] = na; }
  function bake(bi, bj, lo) {
    const t0 = performance.now(), N = BS + 2, M = N * 2; // поле клеток 34×34 → вдвое мельче (6 px мира): стенки и валик — полосой в полклетки
    if (!FC) { FC = document.createElement('canvas'); FC.width = FC.height = M; FG = FC.getContext('2d'); FD = FG.createImageData(M, M); }
    const F = new Float32Array(N * N), F2 = new Float32Array(M * M), i0 = bi * BS - 1, j0 = bj * BS - 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) F[j * N + i] = QV(val(i0 + i, j0 + j));
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      let fx = (x + 0.5) / 2 - 0.5, fy = (y + 0.5) / 2 - 0.5; fx = fx < 0 ? 0 : fx > N - 1 ? N - 1 : fx; fy = fy < 0 ? 0 : fy > N - 1 ? N - 1 : fy;
      const a = fx | 0, b = fy | 0, u = fx - a, w = fy - b, a1 = a + 1 < N ? a + 1 : a, b1 = b + 1 < N ? b + 1 : b;
      F2[y * M + x] = (F[b * N + a] * (1 - u) + F[b * N + a1] * u) * (1 - w) + (F[b1 * N + a] * (1 - u) + F[b1 * N + a1] * u) * w;
    }
    const D = FD.data; let any = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const v = F2[j * M + i], vn = j ? F2[(j - 1) * M + i] : v, vs = j < M - 1 ? F2[(j + 1) * M + i] : v, vw = i ? F2[j * M + i - 1] : v, ve = i < M - 1 ? F2[j * M + i + 1] : v;
      PX[0] = PX[1] = PX[2] = PX[3] = 0;
      over(118, 144, 178, (lo ? 0.48 : 0.5) * sm(0, 0.6, v));                 // дно в тени (утоптанный снег синее)
      over(70, 96, 132, 0.75 * Math.min(1, 3.2 * Math.max(0, v - vs)));      // ближняя (южная) стенка — тень
      over(236, 243, 250, 0.6 * Math.min(1, 3.2 * Math.max(0, v - vn)));     // дальняя (северная) стенка — на свету
      if (!lo) { const m = Math.max(vn, vs, vw, ve); if (m > 0.25 && m > v && v < 0.2) over(255, 255, 255, 0.7 * Math.min(1, 3 * (m - v)) * sm(0.25, 0.7, m)); } // валик снаружи края
      const o = (j * M + i) * 4; D[o] = PX[0]; D[o + 1] = PX[1]; D[o + 2] = PX[2]; D[o + 3] = Math.round(PX[3] * 255); any |= D[o + 3];
    }
    const key = bi + bj * BX;
    if (!any) { CH.set(key, { c: null, S: lo, sig: -1 }); return; }
    FG.putImageData(FD, 0, 0);
    let e = CH.get(key); const px = lo ? 192 : 512;
    // поля холста MG px: при рисовании берётся только середина (source rect) — сглаживание на стыке видит соседа, шва нет
    if (!e || !e.c || e.px !== px) { const c = document.createElement('canvas'); c.width = c.height = px + 2 * MG; e = { c, g: c.getContext('2d'), px }; }
    const g = e.g, u = px / BS; g.clearRect(0, 0, px + 2 * MG, px + 2 * MG); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(FC, MG - u, MG - u, N * u, N * u); // пиксель поля = полклетки; клетка −1 → за краем куска
    e.S = lo; CH.set(key, e);
    if (CH.size > (lo ? 40 : 24)) for (const [k2, v2] of CH) { if (k2 !== key && !v2.vis) { CH.delete(k2); break; } }
    const ms = performance.now() - t0; bakes++; bakeMs = Math.max(bakeMs, ms); BT.push(ms); if (BT.length > 64) BT.shift();
  }
  const LIFT = 3; // ближняя стенка видна ниже дна (3/4 сверху): поле чуть выше, дно — под ногами
  const has = (bi, bj) => { for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++) if (i >= 0 && j >= 0 && i < BX && j < BY && BL[i + j * BX]) return true; return false; };
  // слой троп в кадре (до следов): view — [x0, y0, x1, y1] мира; вернёт число кусков
  function draw(g, view) {
    if (!ensure() || !nB) return 0;
    const lo = low(), [x0, y0, x1, y1] = view, T = typeof now === 'number' ? now : performance.now() / 1000;
    const chk = Math.abs(T - lastChk) > 1.2; if (chk) lastChk = T;
    const a0 = Math.max(0, Math.floor(x0 / BW)), a1 = Math.min(BX - 1, Math.floor(x1 / BW)), b0 = Math.max(0, Math.floor(y0 / BW)), b1 = Math.min(BY - 1, Math.floor(y1 / BW));
    for (const e of CH.values()) e.vis = 0;
    let n = 0, todo = -1, tMiss = false;
    for (let bj = b0; bj <= b1; bj++) for (let bi = a0; bi <= a1; bi++) {
      if (!has(bi, bj)) continue;
      const key = bi + bj * BX; let e = CH.get(key), miss = !e || e.S !== lo;
      if (miss) { const s = sig(bi, bj); if (!s) { CH.set(key, e = { c: null, S: lo, sig: 0 }); miss = false; } } // пусто (только край соседа не дотянулся) — без печи
      else if (chk) { const s = sig(bi, bj); if (s !== e.sig) e.want = 1; } // уровень сменился — в очередь
      if ((miss || (e && e.want)) && (todo < 0 || (miss && !tMiss))) { todo = key; tMiss = miss; }
      if (e) { e.vis = 1; if (e.c && e.S === lo) { g.drawImage(e.c, MG, MG, e.px, e.px, bi * BW, bj * BW - LIFT, BW, BW); n++; } }
    }
    if (todo >= 0) { // ≤ 1 печь за кадр
      const bi = todo % BX, bj = (todo / BX) | 0, s = sig(bi, bj); bake(bi, bj, lo);
      const e = CH.get(todo); if (e) { e.sig = s; e.want = 0; if (tMiss && e.c) { e.vis = 1; g.drawImage(e.c, MG, MG, e.px, e.px, bi * BW, bj * BW - LIFT, BW, BW); n++; } }
    }
    return n;
  }
  // лопата у двери избы (пока не взяли): черенок к стене справа от двери, деревянный совок в снегу
  const SHOVEL = { x: HUT.x - 36, y: HUT_IN.y1 + WALL + 3 }; // слева от двери (справа — зарубка Уркачана)
  function drawShovel(g, a = 1) {
    if (!G || (G.gear && G.gear.shovel) || (G.flags && G.flags.shovel)) return;
    const x = SHOVEL.x, y = SHOVEL.y; g.save(); g.globalAlpha = a; g.lineCap = 'round';
    g.strokeStyle = '#5b3d27'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x + 1, y - 6); g.lineTo(x + 7, y - 38); g.stroke();
    g.strokeStyle = '#8a6a45'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x + 0.5, y - 7); g.lineTo(x + 6.3, y - 37); g.stroke();
    g.strokeStyle = '#5b3d27'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 4, y - 38); g.lineTo(x + 10, y - 39); g.stroke(); // ручка
    g.fillStyle = '#76593a'; g.beginPath(); g.moveTo(x - 6, y - 8); g.lineTo(x + 5, y - 9); g.lineTo(x + 6, y + 2); g.lineTo(x - 6, y + 2); g.closePath(); g.fill(); // совок
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x - 6, y - 2, 12, 4);
    g.fillStyle = '#f4f7fa'; g.beginPath(); g.ellipse(x, y + 2, 9, 2.6, 0, 0, Math.PI * 2); g.fill(); // присыпано
    g.restore();
  }
  // лопата в руках: по фазе позы scoop (js/art-poses.js — те же ключи: к земле 0–0.3, врезка до 0.45, выброс до 0.68, назад);
  //   на ходу — толкает перед собой. Черенок от кистей, совок — на конце
  const KEYS = [[0, 12, 3, 3, 16], [0.3, 15, 0, 5, 13], [0.45, 17, 0.5, 7, 12], [0.68, 13, 18, 4, 19], [1, 12, 3, 3, 16]]; // [фаза, совок x, вверх, кисть x, вверх]
  function drawTool(g, a, face, x, y, walking) {
    let bx, by, hx, hy, t = 0;
    if (walking) { bx = 14; by = 1; hx = 3; hy = 19; }
    else {
      t = ((a.t || 0) % (a.per || 1)) / (a.per || 1); let k = 1; while (k < KEYS.length - 1 && KEYS[k][0] < t) k++;
      const A = KEYS[k - 1], B = KEYS[k], e = sm(0, 1, (t - A[0]) / (B[0] - A[0] || 1));
      bx = A[1] + (B[1] - A[1]) * e; by = A[2] + (B[2] - A[2]) * e; hx = A[3] + (B[3] - A[3]) * e; hy = A[4] + (B[4] - A[4]) * e;
    }
    const X = x + face * bx, Y = y - by, HX = x + face * hx, HY = y - hy, dx = X - HX, dy = Y - HY, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    g.save(); g.lineCap = 'round';
    g.strokeStyle = '#5b3d27'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(HX - ux * 9, HY - uy * 9); g.lineTo(X - ux * 5, Y - uy * 5); g.stroke();
    g.strokeStyle = '#8a6a45'; g.lineWidth = 1; g.beginPath(); g.moveTo(HX - ux * 9, HY - uy * 9 - 0.5); g.lineTo(X - ux * 5, Y - uy * 5 - 0.5); g.stroke();
    g.fillStyle = '#76593a'; g.beginPath(); g.moveTo(X - ux * 5 - uy * 2.6, Y - uy * 5 + ux * 2.6); g.lineTo(X + ux * 2 - uy * 3.6, Y + uy * 2 + ux * 3.6); g.lineTo(X + ux * 2 + uy * 3.6, Y + uy * 2 - ux * 3.6); g.lineTo(X - ux * 5 + uy * 2.6, Y - uy * 5 - ux * 2.6); g.closePath(); g.fill();
    if (walking || (t > 0.42 && t < 0.7)) { g.fillStyle = '#f4f7fa'; g.beginPath(); g.ellipse(X - ux * 1.5, Y - uy * 1.5 - 1.2, 3, 1.7, 0, 0, Math.PI * 2); g.fill(); } // ком снега на совке
    g.restore();
  }

  function stats() {
    let n = 0; for (const b of BL) if (b) n++;
    const bt = BT.slice().sort((a, b) => a - b), med = bt.length ? bt[bt.length >> 1] : 0;
    return { blocks: n, kb: +(n * NC * 8 / 1024).toFixed(1), fill: +FILL.toFixed(2), chunks: CH.size, bakes, bakeMs: +bakeMs.toFixed(2), bakeMed: +med.toFixed(2), cell: C };
  }
  return {
    at, depth, stamp, step, shovel, speedCap, tick, rate, pack, load, draw, drawShovel, drawTool, stats, PROF, SHOVEL, K, CAP,
    get fill() { return FILL; }, resetStats() { bakeMs = 0; bakes = 0; BT.length = 0; },
  };
})();
