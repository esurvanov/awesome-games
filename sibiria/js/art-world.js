'use strict';
// ArtWorld — модели окружения и эффекты «Сибири» (Canvas 2D, вид сверху 3/4, всё процедурно).
// paint* — статические покраски для кэша (градиенты разрешены только здесь и в спрайтах-заготовках);
// fire/stack/building/drawParticle/decal/print — покадровые, только плоские цвета и готовые спрайты.
// env = { now, night: 0..1, wind: 0..4, light(x,y,r,t,a), glow(x,y,k) }
const ArtWorld = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const hs = i => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  function rng(a) {
    a = a >>> 0;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // палитра (совпадает с игрой)
  // палитра-24 (js/particles.js → PAL); здесь — её значения литералами, чтобы стенды грузили файл отдельно
  const SNOW = '#eaeff5', SNOW_HI = '#f6f9fc', SNOW_MID = '#dde6ee';
  const SH = a => `rgba(39,57,74,${a})`; // тень — только «чернила» №5
  const LOG = ['#5b3d27', '#8a6a45', '#3a2618', '#c79a62', '#8a6a45'];
  const LOG_GREY = ['#645240', '#8f7e67', '#352b25', '#b7a07e', '#7d634b'];
  const noop = () => {};
  const E = env => env || { now: 0, night: 0, wind: 1, light: noop, glow: noop };

  // ---------- спрайты-заготовки (создаются один раз) ----------
  // масштаб кэша задаёт рендер (GFX: rdpr и ступень зума zb); стенды без GFX — dpr окна
  let BASE = 0, ZB = 1, ZPREV = 1;
  const DPR = () => BASE || Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const SC = () => DPR() * ZB; // спрайты объектов: резкие на любом зуме (ступень ZB задаёт GFX)
  // смена ступени: держим текущую и прошлую (запасной кэш, пока новая допекается), остальные — вон
  function setScale(base, zb = 1) {
    if (base !== BASE) { // другой растровый dpr (качество, монитор): все масштабные кэши — вон
      const had = BASE; BASE = base; ZB = ZPREV = zb;
      if (had) for (const k in cache) if (cache[k]._zb != null) drop(k);
      return;
    }
    if (zb === ZB) return;
    ZPREV = ZB; ZB = zb; purge(ZPREV);
  }
  const cache = {}, last = {}; // last[ключ] — последний испечённый вариант любой ступени (запасной)
  let BUD = Infinity, spent = 0, tick = 0, bytes = 0, CAP = Infinity; // бюджет печи на кадр, мс (GFX.budget); стенды — без ограничений
  function drop(k) { const c = cache[k]; delete cache[k]; bytes -= c.width * c.height * 4; if (last[c._key] === c) delete last[c._key]; }
  // кадр: сброс бюджета печи; сверх потолка памяти — выселить давно не рисованные масштабные спрайты (LRU)
  function budget(ms, capMB) {
    BUD = ms; spent = 0; tick++; if (capMB) CAP = capMB * 1048576;
    if (bytes <= CAP) return;
    const old = Object.keys(cache).filter(k => cache[k]._zb != null && cache[k]._u < tick - 1).sort((a, b) => cache[a]._u - cache[b]._u);
    for (const k of old) { if (bytes <= CAP * 0.85) break; drop(k); }
  }
  function purge(keep = ZB) { for (const k in cache) { const c = cache[k]; if (c._zb != null && c._zb !== ZB && c._zb !== keep) drop(k); } }
  function sprite(key, w, h, draw, sc) {
    const s = sc || SC(), k = key + '@' + s;
    const hit = cache[k]; if (hit) { hit._u = tick; return hit; }
    // бюджет кадра исчерпан: есть прошлая ступень — она; нет (новый объект в кадре) — дешёвая печь ступени 1, крупную допечём потом
    if (spent >= BUD && sc !== 1) { const fb = last[key]; if (fb) return fb; if (ZB > 1) return bake(key, w, h, draw, s / ZB, 1); }
    return bake(key, w, h, draw, s, sc === 1 ? null : ZB);
  }
  function bake(key, w, h, draw, s, zb) {
    const t0 = performance.now(), c = document.createElement('canvas');
    c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
    const g = c.getContext('2d'); g.scale(s, s); draw(g, w, h);
    c._s = s; c._key = key; c._u = tick; bytes += c.width * c.height * 4; if (zb != null) c._zb = zb; // масштаб от зума — чистится при смене ступени
    spent += performance.now() - t0;
    return (cache[key + '@' + s] = last[key] = c);
  }
  function stats() {
    const by = {}; let n = 0, b = 0;
    for (const k in cache) { const c = cache[k], z = c._zb == null ? '-' : c._zb, m = c.width * c.height * 4; n++; b += m; by[z] = by[z] || { n: 0, mb: 0 }; by[z].n++; by[z].mb += m / 1048576; }
    for (const z in by) by[z].mb = +by[z].mb.toFixed(1);
    return { n, mb: +(b / 1048576).toFixed(1), by };
  }
  function radial(key, size, stops) {
    return sprite(key, size, size, g => {
      const r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
    }, 1);
  }
  const PUFF = () => radial('puff', 64, [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  const SPUFF = () => radial('spuff', 64, [[0, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(246,249,252,0.75)'], [0.78, 'rgba(182,201,223,0.35)'], [1, 'rgba(182,201,223,0)']]);
  const SMK = () => radial('smk', 64, [[0, 'rgba(108,113,120,0.85)'], [0.5, 'rgba(134,142,152,0.45)'], [1, 'rgba(145,157,172,0)']]);
  const HALO = () => radial('halo', 64, [[0, 'rgba(255,214,130,1)'], [0.3, 'rgba(255,150,60,0.45)'], [1, 'rgba(255,110,30,0)']]);
  const SHD = () => radial('shd', 64, [[0, 'rgba(39,57,74,1)'], [0.55, 'rgba(39,57,74,0.7)'], [1, 'rgba(39,57,74,0)']]);

  // ---------- примитивы ----------
  function el(g, x, y, rx, ry, c, rot = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); g.fill(); }
  function rr(g, x, y, w, h, r, c) { g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
  function poly(g, c, ...p) { g.fillStyle = c; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }
  function lg(g, x0, y0, x1, y1, st) { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of st) gr.addColorStop(o, c); return gr; }
  function rg(g, x, y, r, st, fx = x, fy = y) { const gr = g.createRadialGradient(fx, fy, 0, x, y, r); for (const [o, c] of st) gr.addColorStop(o, c); return gr; }
  function shadow(g, x, y, rx, ry, a) { g.globalAlpha = a; g.drawImage(SHD(), x - rx, y - ry, rx * 2, ry * 2); g.globalAlpha = 1; }
  function line(g, c, w, ...p) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); }

  // сугроб (для покрасок): бугристый верх, низ растворяется в снег земли
  function drift(g, x0, x1, yb, hgt, seed) {
    const r = rng(seed), n = 5, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t; pts.push([x, yb - hgt * Math.sin(Math.PI * t) * (0.7 + r() * 0.5)]); }
    g.fillStyle = lg(g, 0, yb - hgt, 0, yb + 4, [[0, '#f6f9fc'], [0.55, '#f6f9fc'], [1, SNOW]]);
    g.beginPath(); g.moveTo(x0, yb);
    for (let i = 1; i <= n; i++) { const [px, py] = pts[i - 1], [qx, qy] = pts[i]; g.quadraticCurveTo(px + (qx - px) * 0.5, Math.min(py, qy) - hgt * 0.18, qx, qy); }
    g.quadraticCurveTo((x0 + x1) / 2, yb + hgt * 0.35, x0, yb); g.fill();
    // синяя тень с подветренной (правой) стороны
    g.fillStyle = lg(g, x0, 0, x1, 0, [[0, 'rgba(60,80,130,0)'], [0.6, 'rgba(60,80,130,0.05)'], [1, 'rgba(60,80,130,0.22)']]);
    g.fill();
  }
  // торчащая льдина
  function ice(g, x, y, s, lean) {
    shadow(g, x, y, 8 * s, 2.6 * s, 0.35);
    poly(g, '#dde6ee', x - 5 * s, y, x - 2 * s + lean * s, y - 16 * s, x + 1 * s + lean * s, y - 13 * s, x + 1 * s, y);
    poly(g, '#93acc4', x + 1 * s, y, x + 1 * s + lean * s, y - 13 * s, x + 6 * s + lean * 0.6 * s, y - 6 * s, x + 6 * s, y + 1 * s);
    line(g, 'rgba(255,255,255,0.9)', 1, x - 4 * s, y - 1 * s, x - 2 * s + lean * s, y - 15 * s);
    el(g, x, y + 0.5 * s, 8 * s, 2.2 * s, SNOW_HI);
  }

  // ================= ДЕРЕВЬЯ =================
  // воронка-наддув у ствола (общая для всех деревьев): неровный тёмный провал у комля и рваный наддув, растворяющийся в снег
  // (без плотного края-«наклейки»). k — масштаб по ширине комля (ель 1), seed — своя рябь у каждого вида.
  function trunkWell(g, s, v, k = 1, seed = 4401) {
    v = +v || 0;
    const rs = rng(seed + Math.round(v * 53) + Math.round(s * 100) * 7), q = s * k;
    const soft = (x, y, rx, ry, rot, c0, c1) => {
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, c0); gr.addColorStop(0.6, c0.replace(/[\d.]+\)$/, m => (parseFloat(m) * 0.5).toFixed(2) + ')')); gr.addColorStop(1, c1);
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
    };
    // общий мягкий синий ореол просадки снега
    soft(0.5 * q, -0.5 * s, 22 * q, 6.4 * q, (rs() - 0.5) * 0.2, 'rgba(120,150,190,0.30)', 'rgba(120,150,190,0)');
    // наддув: несколько разных бугров вокруг ствола, левые светлее, правые уходят в синюю тень
    for (let j = 0; j < 7; j++) {
      const an = j / 7 * TAU + rs() * 0.6, rd = 0.55 + rs() * 0.5;
      const px = Math.cos(an) * 12 * q * rd, py = -0.5 * s + Math.sin(an) * 3.2 * q * rd, rx = (4.5 + rs() * 6) * q, ry = (1.6 + rs() * 1.8) * q;
      soft(px, py, rx, ry, (rs() - 0.5) * 0.7, px < 0 ? 'rgba(250,252,255,0.85)' : 'rgba(226,235,246,0.7)', 'rgba(240,246,252,0)');
    }
    // рваная воронка у самого ствола: неровный тёмный контур без правильной формы
    // край провала слегка размыт (где есть ctx.filter): на крупном зуме ломаная читалась вырезанным многоугольником
    const hasF = typeof g.filter === 'string'; if (hasF) g.filter = 'blur(' + (1.1 * s * Math.hypot(g.getTransform().a, g.getTransform().b)).toFixed(2) + 'px)';
    g.fillStyle = 'rgba(70,96,140,0.44)'; g.beginPath();
    const nn = 9; for (let j = 0; j < nn; j++) {
      const an = j / nn * TAU, rr0 = (1 + (rs() - 0.5) * 0.7), px = Math.cos(an) * 7.4 * q * rr0, py = -0.8 * s + Math.sin(an) * 2 * q * rr0;
      j ? g.lineTo(px, py) : g.moveTo(px, py);
    } g.closePath(); g.fill(); if (hasF) g.filter = 'none';
    // светлый край с солнечной стороны воронки — снег выпирает
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.9 * s; g.lineCap = 'round'; g.beginPath();
    g.moveTo(-8 * q, -0.3 * s); g.quadraticCurveTo(-5 * q, 1.9 * s, -1 * q, 2 * s); g.stroke();
    // комочки осыпавшегося снега — мягкие (на крупном зуме чёткие овалы читались наклейками)
    for (let j = 0; j < 6; j++) { const px = (rs() - 0.5) * 30 * q, py = (rs() * 6 - 1) * s, d = (0.7 + rs() * 1.1) * s; soft(px, py, d * 1.3, d * 0.65, 0, 'rgba(250,252,255,0.9)', 'rgba(250,252,255,0)'); }
    el(g, 1.5 * s, -1.6 * s, 4.5 * q, 1.2 * s, SH(0.28)); // ствол уходит в снег
  }

  function paintSpruce(g, s, wall, v) {
    v = +v || 0;
    const r = rng(1013 + Math.round(v * 97) + Math.round(s * 100) * 13 + (wall ? 7 : 0));
    const dk = wall ? '#10271f' : '#10271f', md = wall ? '#10271f' : '#1c4034', lt = wall ? '#1c4034' : '#2f5a3a';
    const lean = (r() - 0.5) * 0.14; // лёгкий наклон кроны: комель на месте, верх смещён
    shadow(g, 0, 0, 19 * s, 5.5 * s, 0.4);
    g.save(); g.transform(1, 0, lean, 1, 0, 0);
    g.fillStyle = lg(g, -4 * s, 0, 4 * s, 0, [[0, '#765436'], [0.45, '#5b3d27'], [1, '#3a2618']]);
    g.beginPath(); g.moveTo(-4 * s, 0); g.lineTo(-2.2 * s, -34 * s); g.lineTo(2.2 * s, -34 * s); g.lineTo(4 * s, 0); g.fill();
    trunkWell(g, s, v); // воронка-наддув у ствола
    const N = 5, T = []; let prev = null;
    { let yy = -11 * s; for (let i = 0; i < N; i++) { const w = (34 - i * 6.4) * s * (0.86 + r() * 0.28); T.push({ w, wl: w * (0.82 + r() * 0.36), wr: w * (0.82 + r() * 0.36), yb: yy, h: (33 - i * 2.4) * s * (0.88 + r() * 0.24), mm: i < 2 ? 6 + (r() * 3 | 0) : i < 4 ? 5 + (r() * 2 | 0) : 4 }); yy -= (14.5 + r() * 8) * s; } }
    for (let i = 0; i < N; i++) {
      const { w, wl, wr, yb, h, mm: m } = T[i], top = yb - h;
      // тень от яруса выше уже нарисованного — нет; рисуем тень этого яруса на нижний
      if (prev) { g.save(); g.clip(prev); g.fillStyle = 'rgba(40,60,110,0.3)'; g.beginPath(); g.ellipse(w * 0.12, yb + 2.5 * s, w * 1.02, 3.6 * s, 0, 0, TAU); g.fill(); g.restore(); }
      const tips = [], P = new Path2D();
      g.fillStyle = lg(g, -w, 0, w, 0, [[0, lt], [0.42, md], [1, dk]]);
      P.moveTo(0, top);
      // рваный силуэт: лапы разной длины, с зубцами и провалами, часть обломана
      P.quadraticCurveTo(-wl * 0.28, yb - h * 0.42, -wl, yb + (1 + r() * 2) * s);
      for (let j = 1; j <= m; j++) {
        const tj = j / m, xj = -wl + (wl + wr) * tj + (j < m ? (r() - 0.5) * w * 0.22 : 0), edge = Math.abs(xj) / Math.max(wl, wr);
        const dr = (0.4 + 3.2 * edge + r() * 3.4) * s * (r() < 0.18 ? 0.25 : 1), nx = xj - (wl + wr) / m * (0.35 + r() * 0.3), ny = yb - (2 + r() * 4.5) * s;
        tips.push([xj, yb + dr]);
        P.quadraticCurveTo(nx, ny, xj, yb + dr);
        if (j < m && r() < 0.55) P.lineTo(xj + (r() * 2.4 + 0.6) * s, yb + dr - (1.2 + r() * 2.4) * s); // зубец-рубец между лапами
      }
      P.quadraticCurveTo(wr * 0.28, yb - h * 0.42, 0, top); g.fill(P); prev = P;
      // мелкие торчащие веточки на кромке (рвут ровный контур)
      g.strokeStyle = 'rgba(16,39,31,0.95)'; g.lineWidth = 0.8 * s; g.lineCap = 'round'; g.beginPath();
      for (let k = 0; k < 5; k++) {
        const side = r() < 0.5 ? -1 : 1, ty = r(), py = yb - ty * h * 0.8, ex = (side < 0 ? wl : wr) * (1 - (yb - py) / h) * 0.95;
        g.moveTo(side * (ex - 1.5 * s), py); g.lineTo(side * (ex + (2 + r() * 3.5) * s), py + (1 + r() * 2.5) * s);
      }
      g.stroke();
      // хвоя: светлые штрихи слева, тёмные справа
      g.lineWidth = 0.9 * s; g.lineCap = 'round';
      for (const [col, side] of [['rgba(92,150,120,0.55)', -1], ['rgba(16,39,31,0.55)', 1]]) {
        g.strokeStyle = col; g.beginPath();
        for (let k = 0; k < (wall ? 16 : 12); k++) {
          const ty = r(), py = yb - ty * h * 0.85, hw = w * (1 - (yb - py) / h) * 0.92, px = side * r() * hw;
          g.moveTo(px, py); g.lineTo(px + side * 3.2 * s, py + 2.6 * s);
        }
        g.stroke();
      }
      // снежная шапка: тень, снег, синяя кромка
      const sl = -w * (0.72 + 0.16 * r()) * (wall ? 0.85 : 1), sr = w * (0.18 + r() * 0.2), ey = yb - h * 0.06;
      const lumps = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6; lumps.push([sl + (sr - sl) * t + (k && k < 6 ? (r() - 0.5) * 4 * s : 0), ey - (ey - (yb - h * 0.52)) * t * t + ((k % 2 ? 1.6 : -0.4) + (r() - 0.5) * 3.4) * s]); }
      const cap = (dx, dy) => {
        g.beginPath(); g.moveTo(dx, top - 1 * s + dy);
        g.quadraticCurveTo(-w * 0.26 + dx, yb - h * 0.44 + dy, lumps[0][0] + dx, lumps[0][1] + dy);
        for (let k = 1; k < lumps.length; k++) { const [px, py] = lumps[k - 1], [qx, qy] = lumps[k]; g.quadraticCurveTo((px + qx) / 2 + dx, Math.max(py, qy) + 2.6 * s + dy, qx + dx, qy + dy); }
        g.quadraticCurveTo(sr * 0.5 + dx, yb - h * 0.8 + dy, dx, top - 1 * s + dy); g.closePath();
      };
      g.fillStyle = 'rgba(16,39,31,0.5)'; cap(1.2 * s, 2.4 * s); g.fill();
      g.fillStyle = lg(g, -w, top, sr, yb, [[0, '#f6f9fc'], [0.55, '#f6f9fc'], [1, '#b6c9df']]); cap(0, 0); g.fill();
      g.strokeStyle = 'rgba(147,172,196,0.8)'; g.lineWidth = 1 * s; g.beginPath();
      g.moveTo(lumps[0][0], lumps[0][1]);
      for (let k = 1; k < lumps.length; k++) { const [px, py] = lumps[k - 1], [qx, qy] = lumps[k]; g.quadraticCurveTo((px + qx) / 2, Math.max(py, qy) + 2.6 * s, qx, qy); }
      g.stroke();
      // комья снега на лапах: неровные, с тенью под комом и синей стороной от солнца
      const clump = (x, y, rx, ry, k) => {
        g.fillStyle = 'rgba(16,39,31,0.5)'; g.beginPath(); g.ellipse(x + 0.6 * s, y + ry * 0.7, rx * 1.05, ry * 0.7, 0, 0, TAU); g.fill();
        g.fillStyle = k ? '#dfe8f1' : '#f6f9fc'; g.beginPath();
        const n = 7, ph = r() * TAU; for (let q = 0; q < n; q++) { const an = ph + q / n * TAU, rr0 = 0.75 + r() * 0.5, px = x + Math.cos(an) * rx * rr0, py = y + Math.sin(an) * ry * rr0; q ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(147,172,196,0.75)'; g.beginPath(); g.ellipse(x + rx * 0.3, y + ry * 0.35, rx * 0.7, ry * 0.55, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.ellipse(x - rx * 0.25, y - ry * 0.3, rx * 0.5, ry * 0.4, 0, 0, TAU); g.fill();
      };
      for (const [tx, ty] of tips) if (r() < (wall ? 0.5 : (tx < w * 0.3 ? 0.75 : 0.5))) clump(tx, ty - (1 + r() * 2) * s, (1.8 + r() * 2.6) * s, (0.9 + r() * 1.1) * s, tx >= w * 0.3);
      for (let k = 0; k < 3; k++) { const ty = r(), py = yb - 3 * s - ty * h * 0.6, hw = w * (1 - (yb - py) / h) * 0.8; clump((r() - 0.7) * hw, py, (1.5 + r() * 2.2) * s, (0.8 + r()) * s, 0); }
      // обломанные ветки: сухие сучья с торчащим краем и снегом сверху
      if (i > 0 && r() < 0.6) {
        const sd = r() < 0.5 ? -1 : 1, x0 = sd * (sd < 0 ? wl : wr) * (0.55 + r() * 0.35), y0 = yb + (1 + r() * 2) * s, l1 = (4 + r() * 5) * s;
        g.lineCap = 'round'; g.strokeStyle = '#4a4038'; g.lineWidth = 1.5 * s; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + sd * l1, y0 + l1 * 0.35); g.stroke();
        g.lineWidth = 0.8 * s; g.beginPath(); g.moveTo(x0 + sd * l1 * 0.55, y0 + l1 * 0.2); g.lineTo(x0 + sd * l1 * 0.9, y0 + l1 * 0.8); g.stroke();
        g.strokeStyle = '#eef4f9'; g.lineWidth = 0.9 * s; g.beginPath(); g.moveTo(x0 + sd * 0.6 * s, y0 - 0.6 * s); g.lineTo(x0 + sd * l1 * 0.8, y0 + l1 * 0.2); g.stroke();
      }
    }
    // верхушка
    const tt = T[N - 1].yb - T[N - 1].h;
    line(g, '#1c4034', 1.6 * s, 0, tt + 2 * s, 0.6 * s, tt - 6 * s);
    el(g, 0, tt - 0.5 * s, 2.4 * s, 3.2 * s, '#f6f9fc');
    // сломанная сухая ветка
    if (r() < (wall ? 0.35 : 0.65)) {
      const side = r() < 0.5 ? -1 : 1, i = 1 + (r() * 2 | 0), { w, yb } = T[i], x0 = side * w * 0.7, y0 = yb - 5 * s;
      g.lineCap = 'round';
      line(g, '#534c48', 1.8 * s, x0, y0, x0 + side * 11 * s, y0 - 5 * s);
      line(g, '#605e60', 1 * s, x0 + side * 6 * s, y0 - 2.6 * s, x0 + side * 9 * s, y0 - 8 * s);
      line(g, '#f6f9fc', 1.1 * s, x0 + side * 2 * s, y0 - 1.6 * s, x0 + side * 10 * s, y0 - 5.4 * s);
      el(g, x0 + side * 11.3 * s, y0 - 5.1 * s, 1.1 * s, 1.1 * s, '#cea977');
    }
    crownLight(g, s, 36, 130);
    volume(g, s, 36, 130, T.map(t => [t.yb, t.h]), 771 + Math.round(v * 31));
    g.restore();
  }
  // объём кроны: свет №1 сверху-слева, теневой бок справа-снизу — поверх уже нарисованного (source-atop), выше сугроба
  function crownLight(g, s, hw, ht) {
    g.save(); g.beginPath(); g.rect(-hw * 1.4 * s, -(ht + 20) * s, hw * 2.8 * s, (ht + 12) * s); g.clip();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = lg(g, -hw * s, -ht * s, hw * s, -ht * 0.25 * s, [[0, 'rgba(255,246,228,0.14)'], [0.42, 'rgba(255,246,228,0)'], [0.6, 'rgba(16,30,52,0)'], [1, 'rgba(16,30,52,0.26)']]);
    g.fillRect(-hw * 1.4 * s, -(ht + 20) * s, hw * 2.8 * s, (ht + 12) * s);
    g.restore();
  }

  // фото-зерно хвои (CC0): серая текстура по силуэту уже нарисованного дерева. Слой маскируется силуэтом, затем накладывается
  // overlay (source-atop с режимом смешивания несовместим): белый снег на лапах не темнеет, зерно только в хвое. Нет файла / QUALITY low — пропуск.
  let grainCv = null;
  function needleGrain(g, alpha = 0.5) {
    if (typeof Photo === 'undefined') return;
    const p = Photo.pattern('needles', 0.34 * Math.round(g.getTransform().a * 100) / 100, 0.4); if (!p) return;
    try {
      const cv = g.canvas, w = cv.width, h = cv.height;
      if (!grainCv) grainCv = document.createElement('canvas');
      if (grainCv.width !== w || grainCv.height !== h) { grainCv.width = w; grainCv.height = h; }
      const L = grainCv.getContext('2d');
      L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1; L.clearRect(0, 0, w, h);
      L.fillStyle = p; L.fillRect(0, 0, w, h);
      L.globalCompositeOperation = 'destination-in'; L.drawImage(cv, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'overlay'; g.globalAlpha = alpha; g.drawImage(grainCv, 0, 0); g.restore();
    } catch (e) { /* фолбэк: дерево остаётся процедурным */ }
  }
  // хвоинки для крупных ступеней: короткие штрихи с круглыми концами вдоль лап (наружу и вниз), размер — доля спрайта,
  // уменьшенная как √(ступень), число — наоборот (плотность зерна та же). Слой по силуэту накладывается overlay:
  // на белом снегу лап почти не виден (нет серых крапин), в тёмной хвое — темнит/светлит. Цена — только при печи спрайта.
  function needleStrokes(g, s, hw, ht, r) {
    const P = g.getTransform().a, f = Math.sqrt(1.6 * DPR() / P), m = 1 / (f * f);
    try {
      const cv = g.canvas, w = cv.width, h = cv.height, T = g.getTransform();
      if (!grainCv) grainCv = document.createElement('canvas');
      if (grainCv.width !== w || grainCv.height !== h) { grainCv.width = w; grainCv.height = h; }
      const L = grainCv.getContext('2d');
      L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1; L.clearRect(0, 0, w, h);
      L.setTransform(T); L.lineCap = 'round';
      for (const [c, n, lw] of [['rgba(10,22,18,0.5)', 240, 0.55], ['rgba(190,225,200,0.34)', 110, 0.45]]) {
        L.strokeStyle = c; L.lineWidth = Math.max(lw * s * f, 1.1 / P); L.beginPath();
        for (let k = 0, N = Math.round(n * m); k < N; k++) {
          const x = (r() * 2 - 1) * hw * s, y = -r() * ht * s, sd = x < 0 ? -1 : 1, a = 0.25 + r() * 0.45, l = s * f * (1.3 + r() * 1.5);
          const dx = Math.cos(a) * l * sd, dy = Math.sin(a) * l;
          L.moveTo(x - dx / 2, y - dy / 2); L.lineTo(x + dx / 2, y + dy / 2);
        }
        L.stroke();
      }
      L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'destination-in'; L.drawImage(cv, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 1; g.drawImage(grainCv, 0, 0); g.restore();
    } catch (e) { /* фолбэк: без зерна */ }
  }
  // объём поверх готовой кроны (source-atop, только по силуэту): тёмная подошва каждого яруса, тёмный низ, светлый левый бок,
  // мелкая хвойная «зернистость» — плоские заливки перестают читаться как вырезанные из бумаги
  function volume(g, s, hw, ht, tiers, seed) {
    const r = rng(seed);
    g.save(); g.globalCompositeOperation = 'source-atop';
    const W = hw * 1.5 * s, top = -(ht + 20) * s, H = (ht + 12) * s;
    g.fillStyle = lg(g, -W, 0, W, 0, [[0, 'rgba(236,250,226,0.1)'], [0.38, 'rgba(255,244,222,0)'], [0.62, 'rgba(6,34,22,0.04)'], [1, 'rgba(6,34,22,0.22)']]);
    g.fillRect(-W, top, W * 2, H);
    g.fillStyle = lg(g, 0, -ht * s, 0, 0, [[0, 'rgba(6,34,22,0)'], [0.55, 'rgba(6,34,22,0.03)'], [1, 'rgba(6,34,22,0.2)']]);
    g.fillRect(-W, top, W * 2, H);
    for (const [yb, h] of tiers) {
      g.fillStyle = lg(g, 0, yb - 7 * s, 0, yb + 4 * s, [[0, 'rgba(6,34,22,0)'], [1, 'rgba(6,34,22,0.24)']]);
      g.fillRect(-W, yb - 7 * s, W * 2, 11 * s);
      g.fillStyle = lg(g, 0, yb - h, 0, yb - h + 9 * s, [[0, 'rgba(255,248,232,0.12)'], [1, 'rgba(255,248,232,0)']]);
      g.fillRect(-W, yb - h, W * 2, 9 * s);
    }
    needleGrain(g);
    // крупные ступени (2.5, 4): прямоугольное зерно растёт вместе со спрайтом и на зуме читается квадратиками — вместо него хвоинки
    if (g.getTransform().a / DPR() > 1.7) { needleStrokes(g, s, hw, ht, r); g.restore(); return; }
    // зерно хвои: тёмное плотнее, светлое — зеленоватое и слабое (серо-голубая общая заливка убрана: кроны выцветали в туман)
    for (const [c, n] of [['rgba(8,26,20,0.24)', 240], ['rgba(120,170,140,0.12)', 110]]) {
      g.fillStyle = c; g.beginPath();
      for (let k = 0; k < n; k++) g.rect((r() * 2 - 1) * hw * s, -r() * ht * s, s * (0.8 + r() * 0.9), s * 0.8);
      g.fill();
    }
    g.restore();
  }

  // объёмный свет для больших тел (source-atop по уже нарисованному): светлый левый бок, тёмный правый, тёмный низ, зерно
  function bodyLight(g, x0, y0, w, h, k = 1, seed = 5) {
    const r = rng(seed);
    g.save(); g.globalCompositeOperation = 'source-atop';
    g.fillStyle = lg(g, x0, 0, x0 + w, 0, [[0, `rgba(255,244,222,${0.16 * k})`], [0.35, 'rgba(255,244,222,0)'], [0.6, `rgba(14,26,48,${0.05 * k})`], [1, `rgba(14,26,48,${0.36 * k})`]]);
    g.fillRect(x0, y0, w, h);
    g.fillStyle = lg(g, 0, y0, 0, y0 + h, [[0, `rgba(255,248,232,${0.08 * k})`], [0.55, 'rgba(14,26,48,0)'], [1, `rgba(14,26,48,${0.3 * k})`]]);
    g.fillRect(x0, y0, w, h);
    for (const [c, n] of [['rgba(14,24,40,0.12)', 500], ['rgba(255,255,255,0.14)', 350]]) {
      g.fillStyle = c; g.beginPath();
      for (let i = 0; i < n; i++) g.rect(x0 + r() * w, y0 + r() * h, 0.8 + r() * 1.2, 0.7);
      g.fill();
    }
    g.restore();
  }

  function paintBirch(g, s, v) {
    v = +v || 0;
    const r = rng(2029 + Math.round(v * 97) + Math.round(s * 100) * 17);
    const H = 100 * s, lean = (r() - 0.5) * 10 * s, bw = 4.3 * s, tw = 1.5 * s;
    shadow(g, 0, 0, 13 * s, 4 * s, 0.35);
    // дымка тонких ветвей (фиолетово-бурая, как у зимней берёзы)
    for (let k = 0; k < 7; k++) el(g, lean * 0.8 + (r() - 0.5) * 30 * s, -H * 0.72 + (r() - 0.5) * 30 * s, (9 + r() * 7) * s, (7 + r() * 5) * s, 'rgba(83,76,72,0.06)');
    // ветви
    const segs = [[], [], [], []];
    function br(x, y, a, len, d) {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      segs[d].push(x, y, x2, y2);
      if (d === 3) return;
      const n = d === 0 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t = 0.4 + r() * 0.55, na = d === 2 ? Math.PI / 2 + (r() - 0.5) * 0.7 : a + (r() < 0.5 ? -1 : 1) * (0.3 + r() * 0.45);
        br(x + (x2 - x) * t, y + (y2 - y) * t, na, d === 2 ? (5 + r() * 7) * s : len * (0.5 + r() * 0.15), d + 1);
      }
    }
    for (let i = 0; i < 9; i++) {
      const t = 0.36 + i * 0.07 + r() * 0.03, side = i % 2 ? 1 : -1;
      br(lean * t, -H * t, -Math.PI / 2 + side * (0.45 + r() * 0.5), (15 + r() * 12) * s * (1.15 - t * 0.5), 0);
    }
    br(lean, -H, -Math.PI / 2 + (r() - 0.5) * 0.4, 12 * s, 1);
    const SW = [['#352e2d', 2.2], ['#473930', 1.3], ['#534c48', 0.8], ['rgba(83,76,72,0.6)', 0.6]];
    g.lineCap = 'round';
    for (let d = 0; d < 4; d++) {
      g.strokeStyle = SW[d][0]; g.lineWidth = SW[d][1] * s; g.beginPath();
      const a = segs[d]; for (let i = 0; i < a.length; i += 4) { g.moveTo(a[i], a[i + 1]); g.lineTo(a[i + 2], a[i + 3]); }
      g.stroke();
    }
    // снег на пологих ветвях
    g.strokeStyle = '#f6f9fc'; g.lineWidth = 1.1 * s; g.beginPath();
    for (let d = 0; d < 2; d++) { const a = segs[d]; for (let i = 0; i < a.length; i += 4) { const dx = a[i + 2] - a[i], dy = a[i + 3] - a[i + 1]; if (Math.abs(dy) < Math.abs(dx) * 1.1) { g.moveTo(a[i] + dx * 0.15, a[i + 1] + dy * 0.15 - 1 * s); g.lineTo(a[i] + dx * 0.8, a[i + 1] + dy * 0.8 - 1 * s); } } }
    g.stroke();
    // ствол
    g.fillStyle = lg(g, -bw, 0, bw, 0, [[0, '#f6f9fc'], [0.45, '#f6f9fc'], [0.8, '#c2c9d0'], [1, '#a5acb3']]);
    g.beginPath(); g.moveTo(-bw, 0); g.lineTo(lean - tw, -H); g.lineTo(lean + tw, -H); g.lineTo(bw, 0); g.fill();
    // тёмный комель
    g.fillStyle = '#473930'; g.beginPath(); g.moveTo(-bw, 0); g.lineTo(-bw * 0.95, -9 * s); g.lineTo(-bw * 0.3, -12 * s); g.lineTo(bw * 0.2, -8 * s); g.lineTo(bw * 0.9, -13 * s); g.lineTo(bw, 0); g.fill();
    g.strokeStyle = 'rgba(216,211,203,0.5)'; g.lineWidth = 0.7; g.beginPath();
    for (let k = 0; k < 4; k++) { const xx = -bw * 0.8 + k * bw * 0.5; g.moveTo(xx, -1 * s); g.lineTo(xx + 0.5 * s, -7 * s); } g.stroke();
    // чечевички
    g.fillStyle = '#352e2d'; g.beginPath();
    for (let k = 0; k < 24; k++) {
      const t = 0.13 + r() * 0.8, yy = -H * t, half = bw + (tw - bw) * t, xc = lean * t, side = r() < 0.55 ? -1 : 1;
      const ww = (1.4 + r() * 3.2) * s * (1 - t * 0.5), xx = side < 0 ? xc - half : xc + half - ww;
      g.rect(xx, yy, ww, (0.7 + r() * 0.9) * s);
    }
    g.fill();
    // воронка-наддув у комля (как у ели) и упавшая ветка
    trunkWell(g, s, v, 0.8, 5203);
    if (r() < 0.7) {
      const side = r() < 0.5 ? -1 : 1, x0 = side * 14 * s, y0 = 3 * s;
      line(g, '#473930', 1.6 * s, x0, y0, x0 + side * 16 * s, y0 - 2 * s);
      line(g, '#534c48', 0.9 * s, x0 + side * 8 * s, y0 - 1 * s, x0 + side * 12 * s, y0 - 6 * s);
      line(g, '#f6f9fc', 1 * s, x0 + side * 3 * s, y0 - 1.1 * s, x0 + side * 14 * s, y0 - 2.6 * s);
    }
  }

  // корни-клинья от комля, уходят под снег (вместо овальных «пятаков»): side −1/1, длина в s, цвет
  function rootsInSnow(g, s, hw, roots) {
    for (const [sd, L, c] of roots) {
      g.fillStyle = c; g.beginPath(); g.moveTo(sd * (hw - 1.5) * s, -4.2 * s);
      g.quadraticCurveTo(sd * (hw + 1) * s, -2.6 * s, sd * L * s, 0.2 * s);
      g.quadraticCurveTo(sd * (hw + 0.5) * s, 0.4 * s, sd * (hw - 2.5) * s, -0.6 * s); g.closePath(); g.fill();
      // снег присыпал конец корня: мягкий бугорок без края
      g.fillStyle = 'rgba(246,249,252,0.8)'; g.beginPath(); g.moveTo(sd * (L - 3.5) * s, 0.6 * s);
      g.quadraticCurveTo(sd * (L - 1.5) * s, -1.6 * s, sd * (L + 1.5) * s, 0.5 * s); g.closePath(); g.fill();
    }
  }
  // кедр: тёмная, раскидистая крона из плоских «лап» на кривых сучьях, несколько вершин, рваный силуэт
  function paintCedar(g, s, v) {
    v = +v || 0;
    const r = rng(3037 + Math.round(v * 97) + Math.round(s * 100) * 19), J = k => (r() - 0.5) * k;
    shadow(g, 0, 0, 22 * s, 6.5 * s, 0.42);
    // ствол: толстый, с изгибом и развилкой
    const bend = J(6);
    g.fillStyle = lg(g, -7 * s, 0, 7 * s, 0, [[0, '#67482f'], [0.4, '#4b3220'], [1, '#1e140d']]);
    g.beginPath(); g.moveTo(-7.5 * s, 0); g.quadraticCurveTo(-5 * s, -8 * s, -4 * s + bend * 0.3 * s, -56 * s); g.lineTo(4 * s + bend * 0.3 * s, -56 * s); g.quadraticCurveTo(5 * s, -8 * s, 7.5 * s, 0); g.fill();
    g.strokeStyle = 'rgba(18,10,6,0.6)'; g.lineWidth = 0.8 * s; g.beginPath();
    for (let k = 0; k < 8; k++) { const xx = (-4.5 + k * 1.2) * s, y0 = -r() * 8 * s; g.moveTo(xx, y0); g.lineTo(xx * 0.7 + J(1) * s, y0 - (10 + r() * 24) * s); }
    g.stroke();
    // сучья: кривые, толстые, к концам лап
    const limbs = [];
    const spec = [[-24, -1, 32], [-29, 1, 34], [-39, -1, 29], [-44, 1, 27], [-54, -1, 23], [-59, 1, 25], [-70, -1, 17], [-74, 1, 16], [-50, 1, 12]];
    for (const [y, sd, L] of spec) {
      const y0 = (y + J(4)) * s, len = (L + J(6)) * s, a = -0.25 - r() * 0.35;
      const ex = sd * Math.cos(a) * len + bend * 0.2 * s, ey = y0 + Math.sin(a) * len;
      limbs.push([bend * 0.25 * s, y0, ex, ey, sd]);
    }
    const tops = [[-5 + J(3), -100 + J(4), 13], [7 + J(3), -93 + J(4), 11], [J(4), -86, 14]];
    g.lineCap = 'round';
    for (const [w, c] of [[3.2, '#3a2618'], [1.4, '#5b3d27']]) {
      g.strokeStyle = c; g.lineWidth = w * s; g.beginPath();
      for (const [x0, y0, ex, ey] of limbs) { g.moveTo(x0, y0); g.quadraticCurveTo(x0 + (ex - x0) * 0.5, y0 - 2 * s, ex, ey); }
      for (const [tx, ty] of tops) { g.moveTo(bend * 0.3 * s, -54 * s); g.quadraticCurveTo(tx * 0.3 * s, (ty + 20) * s, tx * s, (ty + 6) * s); }
      g.stroke();
    }
    // лапы: на концах сучьев и на середине, плюс вершины
    const pads = [];
    for (const [x0, y0, ex, ey, sd] of limbs) {
      pads.push([ex, ey, (12 + r() * 6) * s, (5 + r() * 2.5) * s]);
      pads.push([x0 + (ex - x0) * 0.5, y0 + (ey - y0) * 0.5 - 1.5 * s, (9 + r() * 4) * s, (5 + r() * 2) * s]);
    }
    for (const [tx, ty, R] of tops) pads.push([tx * s, ty * s, R * 0.8 * s, R * 0.55 * s]);
    pads.sort((a, b) => b[1] - a[1]); // снизу вверх: верхние лапы ложатся поверх
    const DK = '#10271f', MD = '#10271f', LT = '#1c4034', HI = 'rgba(88,138,112,0.55)', LO = 'rgba(16,39,31,0.6)';
    for (const [px, py, rx, ry] of pads) {
      const n = 9, blobs = [];
      for (let k = 0; k < n; k++) { const a = k / n * TAU + J(0.7); blobs.push([px + Math.cos(a) * rx * (0.5 + r() * 0.2), py + Math.sin(a) * ry * 0.4 + J(1.5) * s, rx * (0.26 + r() * 0.2), ry * (0.5 + r() * 0.35)]); }
      // тень лапы
      g.fillStyle = 'rgba(16,39,31,0.55)'; g.beginPath(); for (const [bx, by, bx2, by2] of blobs) { g.moveTo(bx + bx2 + 1.5 * s, by + 2 * s); g.ellipse(bx + 1.5 * s, by + 2 * s, bx2, by2, 0, 0, TAU); } g.fill();
      g.fillStyle = DK; g.beginPath(); for (const [bx, by, bx2, by2] of blobs) { g.moveTo(bx + bx2, by); g.ellipse(bx, by, bx2, by2, 0, 0, TAU); } g.fill();
      g.fillStyle = MD; g.beginPath(); for (const [bx, by, bx2, by2] of blobs) if (by <= py + ry * 0.1) { g.moveTo(bx + bx2 * 0.8 - 1.5 * s, by - 1 * s); g.ellipse(bx - 1.5 * s, by - 1 * s, bx2 * 0.8, by2 * 0.7, 0, 0, TAU); } g.fill();
      g.fillStyle = LT; g.beginPath(); for (const [bx, by, bx2, by2] of blobs) if (bx < px && by <= py) { g.moveTo(bx + bx2 * 0.45 - 2.5 * s, by - 1.8 * s); g.ellipse(bx - 2.5 * s, by - 1.8 * s, bx2 * 0.45, by2 * 0.4, 0, 0, TAU); } g.fill();
      // пучки длинной хвои — рваный край
      g.lineWidth = 0.9 * s;
      g.strokeStyle = LO; g.beginPath();
      for (let k = 0; k < 16; k++) { const a = r() * Math.PI, ex = px + Math.cos(a) * rx * 0.95, ey = py + Math.sin(a) * ry * 0.85; g.moveTo(ex - Math.cos(a) * 2 * s, ey - Math.sin(a) * 2 * s); g.lineTo(ex + Math.cos(a) * 3.5 * s + J(2) * s, ey + Math.sin(a) * 3 * s + 1.2 * s); }
      g.stroke();
      g.strokeStyle = HI; g.beginPath();
      for (let k = 0; k < 7; k++) { const a = Math.PI + r() * Math.PI, ex = px + Math.cos(a) * rx * 0.85, ey = py + Math.sin(a) * ry * 0.8; g.moveTo(ex, ey); g.lineTo(ex + Math.cos(a) * 3 * s + J(1.5) * s, ey + Math.sin(a) * 2.6 * s); }
      g.stroke();
      // снег лежит на плоской лапе
      const sx = px - rx * 0.12 + J(2) * s, sy = py - ry * 0.55, srx = rx * (0.7 + 0.12 * v + r() * 0.15), sry = ry * 0.3;
      el(g, sx + 0.8 * s, sy + 1.6 * s, srx, sry, 'rgba(39,57,74,0.5)');
      g.fillStyle = '#f6f9fc'; g.beginPath(); g.moveTo(sx - srx, sy + sry * 0.4);
      for (let k = 1; k <= 4; k++) { const xx = sx - srx + 2 * srx * k / 4; g.quadraticCurveTo(xx - srx / 4, sy - sry * (0.9 + r() * 0.8), xx, sy + J(0.6) * sry); }
      g.quadraticCurveTo(sx, sy + sry * 1.1, sx - srx, sy + sry * 0.4); g.fill();
      el(g, sx + srx * 0.35, sy + sry * 0.35, srx * 0.4, sry * 0.35, 'rgba(182,201,223,0.8)');
    }
    // шишки
    for (let k = 0; k < 3; k++) { const [px, py, rx] = pads[(r() * pads.length) | 0]; if (r() < 0.5) continue; const cx0 = px + J(rx), cy0 = py + 3 * s; el(g, cx0, cy0, 2.2 * s, 2.8 * s, '#5b3d27'); el(g, cx0 - 0.6 * s, cy0 - 0.9 * s, 0.9 * s, 1.1 * s, '#8a6a45'); }
    // воронка-наддув у комля (как у ели), из снега торчат корни
    trunkWell(g, s, v, 1.3, 6311);
    rootsInSnow(g, s, 7.2, [[-1, 12, '#4b3220'], [1, 13, '#3a2618']]);
    crownLight(g, s, 44, 105);
  }

  const TS = [0.8, 0.95, 1.1, 1.25, 1.4];
  // кэш дерева 110×170, опора (55,160) — как в gfx.js
  const treeW = kind => kind === 2 ? 150 : 110; // кедр раскидистый — шире спрайт
  const treeK = s => TS[clamp(Math.round((s - 0.8) / 0.15), 0, 4)]; // ступень размера, в которой испечён спрайт
  // быстрый путь: дерево спрашивается дважды за кадр (тень и само дерево) — без сборки строки-ключа и замыкания;
  // запись верна, пока спрайт того же масштаба лежит в кэше (смена ступени/purge — снова через sprite())
  const TMEMO = new Map();
  function treeSprite(kind, s, wall, v, sc) {
    const si = clamp(Math.round((s - 0.8) / 0.15), 0, 4), nk = ((kind * 2 + (wall ? 1 : 0)) * 5 + si) * 8 + (v | 0), m = TMEMO.get(nk);
    if (m && m.sc === sc && cache[m.k] === m.c) return m.c;
    const c = treeSpriteBake(kind, si, wall, v, sc);
    if (sc && c._s === sc) TMEMO.set(nk, { sc, c, k: c._key + '@' + c._s });
    return c;
  }
  function treeSpriteBake(kind, si, wall, v, sc) {
    const key = `tree${kind}${wall | 0}${si}${v | 0}`, tw = treeW(kind);
    return sprite(key, tw, 170, g => {
      g.translate(tw / 2, 160); const sc = TS[si];
      if (!wall && typeof Tree !== 'undefined' && Tree.MODEL[kind]) Tree.paintSprite(g, kind, si, v);   // объёмная модель (js/tree3d.js)
      else if (kind === 1) paintBirch(g, sc, v); else if (kind === 2) paintCedar(g, sc, v); else if (kind === 3 && typeof ArtZones !== 'undefined') ArtZones.paintBurnt(g, sc, v); else paintSpruce(g, sc, wall, v);
    }, sc);
  }

  // ================= Ми-8, хвост, чум, лабаз =================
  // Ми-8 разрезан (паспорт №2): mode — 'full' (весь, для тени и стендов) · 'static' (корпус без живых частей) ·
  // 'blade' (согнутая лопасть) · 'door' (полотно сдвижной двери) · 'lip' (снег и тень крыши над дверью — поверх полотна).
  // Живые части кладутся поверх статики в тех же координатах (js/live.js); свет bodyLight у всех один (тот же прямоугольник и seed):
  // в покое сумма слоёв = прежний спрайт.
  function paintMi8(g, mode = 'full') {
    const all = mode === 'full';
    if (mode === 'blade') { mi8Blade(g); bodyLight(g, -160, -140, 320, 210, 1, 17); return; }
    if (mode === 'door' || mode === 'lip') {
      g.save(); g.translate(-10, -36); g.rotate(-0.09);
      if (mode === 'door') mi8Door(g); else { g.beginPath(); g.rect(14, -50, 26, 35); g.clip(); mi8Roof(g); }
      g.restore(); bodyLight(g, -160, -140, 320, 210, 1, 17); return;
    }
    shadow(g, 0, 4, 150, 28, 0.4);
    // лопасть за фюзеляжем
    g.save(); g.translate(-4, -84); g.rotate(-0.16);
    g.fillStyle = lg(g, 0, -4, 0, 4, [[0, '#5d626b'], [1, '#323138']]); g.beginPath(); g.moveTo(0, -3); g.lineTo(-148, -8); g.lineTo(-150, -2); g.lineTo(0, 3); g.fill();
    g.fillStyle = '#ca4528'; g.fillRect(-150, -8, 8, 6);
    g.restore();
    g.save(); g.translate(-10, -36); g.rotate(-0.09);
    const body = new Path2D();
    body.moveTo(-70, -27); body.lineTo(70, -27); body.lineTo(78, -22); body.lineTo(73, -14); body.lineTo(84, -8); body.lineTo(77, 0); body.lineTo(88, 6); body.lineTo(80, 14); body.lineTo(86, 24);
    body.lineTo(-62, 25); body.quadraticCurveTo(-100, 25, -108, 6); body.quadraticCurveTo(-111, -14, -92, -23); body.quadraticCurveTo(-83, -27, -70, -27); body.closePath();
    // двигательный отсек сверху
    g.fillStyle = lg(g, 0, -42, 0, -26, [[0, '#f6f9fc'], [1, '#b1b5ba']]);
    g.beginPath(); g.roundRect(-46, -40, 92, 16, 6); g.fill();
    el(g, -46, -32, 4, 6, '#2f3542'); el(g, 46, -33, 5, 5, '#2f3542'); el(g, 50, -33, 4, 4, '#111418');
    g.fillStyle = 'rgba(53,43,37,0.35)'; g.beginPath(); g.ellipse(58, -30, 10, 3, 0.1, 0, TAU); g.fill();
    g.fillStyle = lg(g, 0, -27, 0, 25, [[0, '#f6f9fc'], [0.3, '#dde6ee'], [0.75, '#b2bac3'], [1, '#7f8792']]); g.fill(body);
    g.save(); g.clip(body);
    g.fillStyle = '#ca4528'; g.fillRect(-120, 1, 220, 7); g.fillStyle = '#8b2920'; g.fillRect(-120, 7, 220, 1.6);
    g.fillStyle = '#27394a'; g.fillRect(-120, -4, 220, 1.6);
    g.fillStyle = 'rgba(47,53,66,0.25)'; g.fillRect(-120, 17, 220, 8);
    g.strokeStyle = 'rgba(62,68,80,0.35)'; g.lineWidth = 0.8; g.beginPath();
    for (let x = -60; x < 80; x += 22) { g.moveTo(x, -27); g.lineTo(x, 25); } g.stroke();
    g.fillStyle = 'rgba(78,83,93,0.4)'; for (let x = -58; x < 78; x += 5) g.fillRect(x, -19, 1, 1);
    // кабина
    g.fillStyle = lg(g, -108, -24, -80, 0, [[0, '#6f8ea8'], [0.5, '#27394a'], [1, '#2f3542']]);
    g.beginPath(); g.moveTo(-94, -22); g.quadraticCurveTo(-108, -12, -106, 2); g.lineTo(-86, 2); g.lineTo(-80, -22); g.closePath(); g.fill();
    line(g, '#c2c9d0', 1.5, -93, -10, -84, -10); line(g, '#c2c9d0', 1.5, -95, 2, -88, -22);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-100, -14); g.lineTo(-96, -8); g.lineTo(-99, -2); g.moveTo(-96, -8); g.lineTo(-91, -6); g.moveTo(-89, -18); g.lineTo(-85, -13); g.stroke();
    poly(g, 'rgba(221,230,238,0.6)', -104, -6, -99, -12, -101, -3);
    // иллюминаторы
    for (let i = 0; i < 5; i++) {
      const wx = -58 + i * 17 + (i > 2 ? 26 : 0), wy = -13;
      el(g, wx, wy, 5.4, 5.4, '#8f9aa4'); el(g, wx, wy, 4.2, 4.2, '#2f3542'); el(g, wx - 1.4, wy - 1.6, 1.6, 1.1, 'rgba(221,230,238,0.85)');
    }
    // открытая сдвижная дверь
    g.fillStyle = '#10151a'; g.fillRect(-6, -22, 22, 40);
    g.fillStyle = '#76593a'; g.fillRect(-2, 6, 12, 10); g.fillStyle = '#2f3542'; g.fillRect(-4, -18, 3, 20);
    if (all) mi8Door(g);
    // слом
    g.fillStyle = '#161b21'; g.beginPath(); g.ellipse(83, 0, 7, 24, 0, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = '#6c7178'; g.lineWidth = 1.4; g.beginPath();
    for (let k = 0; k < 3; k++) { g.moveTo(74 + k * 4, -24); g.quadraticCurveTo(86 + k * 3, 0, 76 + k * 4, 24); } g.stroke();
    if (all) for (const w of MI8_WIRES) { g.strokeStyle = w[0]; g.lineWidth = 1; g.beginPath(); g.moveTo(w[1], w[2]); g.bezierCurveTo(w[3], w[4], w[5], w[6], w[7], w[8]); g.stroke(); }
    mi8Roof(g);
    // мачта и втулка
    rr(g, -5, -58, 10, 14, 2, '#4e535d'); el(g, 0, -58, 12, 4, '#2f3542'); el(g, 0, -60, 9, 3, '#f6f9fc');
    g.restore();
    if (all) mi8Blade(g);
    // обломок лопасти
    g.save(); g.translate(-20, -94); g.rotate(2.2); g.fillStyle = '#2f3542'; g.fillRect(0, -3, 46, 6); g.restore();
    mi8Ground(g);
  }
  // провода из разлома (в координатах корпуса): цвет, начало, две опоры, конец — живые цепочки в js/live.js стартуют с этой формы
  const MI8_WIRES = [['#313031', 84, -2, 96, 6, 90, 18, 98, 22], ['#313031', 82, 6, 90, 14, 86, 22, 92, 26], ['#ca4528', 84, 2, 94, 10, 94, 18, 102, 20]];
  function mi8Door(g) { // полотно открытой сдвижной двери (в координатах корпуса), петля-ролик сверху
    g.fillStyle = lg(g, 16, 0, 38, 0, [[0, '#a5acb3'], [1, '#c2c9d0']]); g.fillRect(16, -23, 22, 42);
    line(g, '#6c7178', 1, 16, -23, 16, 19);
  }
  function mi8Blade(g) { // лопасть, согнутая в снег (корень у втулки −8,−95, кончик в снегу 138,5)
    g.fillStyle = lg(g, 0, -80, 0, 20, [[0, '#4e535d'], [1, '#323138']]);
    g.beginPath(); g.moveTo(-8, -98); g.quadraticCurveTo(90, -104, 124, -54); g.quadraticCurveTo(138, -30, 142, 4); g.lineTo(134, 6); g.quadraticCurveTo(130, -26, 118, -50); g.quadraticCurveTo(90, -94, -8, -92); g.fill();
    line(g, 'rgba(255,255,255,0.35)', 1, 0, -97, 80, -98);
    g.fillStyle = '#f6f9fc'; g.beginPath(); g.moveTo(-6, -99); g.quadraticCurveTo(60, -104, 100, -86); g.lineTo(98, -83); g.quadraticCurveTo(60, -99, -6, -96); g.fill();
  }
  function mi8Roof(g) { // снег на крыше и капоте (в координатах корпуса)
    g.fillStyle = SH(0.35); g.beginPath(); g.moveTo(-90, -24); g.quadraticCurveTo(-70, -30, -46, -38); g.lineTo(46, -42); g.quadraticCurveTo(60, -36, 72, -24); g.lineTo(70, -20); g.lineTo(-88, -19); g.fill();
    g.fillStyle = lg(g, 0, -46, 0, -24, [[0, '#f6f9fc'], [1, '#dde6ee']]); g.beginPath();
    g.moveTo(-92, -25); g.quadraticCurveTo(-72, -31, -48, -41); g.quadraticCurveTo(0, -48, 46, -44); g.quadraticCurveTo(62, -38, 73, -27);
    g.quadraticCurveTo(60, -23, 50, -25); g.quadraticCurveTo(40, -21, 30, -25); g.quadraticCurveTo(10, -22, -10, -25); g.quadraticCurveTo(-30, -21, -50, -25); g.quadraticCurveTo(-70, -21, -92, -25); g.fill();
  }
  function mi8Ground(g) { // сугроб у борта, лёд, ящики, бочка, обшивка, наддув — статика; общий свет корпуса
    // сугроб наметён к борту
    g.save();
    g.fillStyle = lg(g, 0, -30, 0, 36, [[0, '#f6f9fc'], [0.5, '#f6f9fc'], [1, SNOW]]);
    g.beginPath(); g.moveTo(-158, 34); g.quadraticCurveTo(-150, 0, -126, -12); g.quadraticCurveTo(-112, -22, -96, -6);
    g.quadraticCurveTo(-70, 6, -40, 2); g.quadraticCurveTo(-10, -2, 20, 6); g.quadraticCurveTo(60, 10, 96, 4); g.quadraticCurveTo(130, 6, 150, 26); g.quadraticCurveTo(80, 44, -40, 42); g.quadraticCurveTo(-120, 44, -158, 34); g.fill();
    g.fillStyle = lg(g, -160, 0, 160, 0, [[0, 'rgba(60,80,130,0)'], [0.7, 'rgba(60,80,130,0.04)'], [1, 'rgba(60,80,130,0.2)']]); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(111,142,168,0.55)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-94, -5); g.quadraticCurveTo(-70, 6, -40, 2); g.quadraticCurveTo(-10, -2, 20, 6); g.quadraticCurveTo(60, 10, 96, 4); g.stroke();
    // лёд, торчащий из сугроба
    ice(g, -132, 20, 1.2, -3); ice(g, -118, 26, 0.8, 2); ice(g, 44, 26, 1, 3); ice(g, 112, 22, 0.9, -2);
    // ящики, бочка, обшивка
    const crate = (x, y, w, h) => {
      el(g, x + w / 2, y + h, w * 0.62, 2.2, SH(0.3)); // AO у снега
      g.fillStyle = lg(g, x, 0, x + w, 0, [[0, '#8a6a45'], [1, '#62482f']]); g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(58,38,24,0.6)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.stroke();
      rr(g, x - 1, y - 3, w + 2, 4, 2, '#f6f9fc');
    };
    crate(104, 8, 20, 15); crate(126, 14, 15, 12); crate(110, -4, 14, 11);
    g.fillStyle = lg(g, 58, 0, 74, 0, [[0, '#2f5a3a'], [0.5, '#2f5a3a'], [1, '#183426']]); g.fillRect(58, 6, 15, 20);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(58, 11, 15, 1.5); g.fillRect(58, 20, 15, 1.5);
    el(g, 65.5, 6, 7.5, 2.6, '#f6f9fc');
    g.save(); g.translate(-146, 44); g.rotate(-0.3); g.fillStyle = '#c2c9d0'; g.fillRect(0, -6, 26, 10); g.fillStyle = '#ca4528'; g.fillRect(0, -2, 26, 3); g.restore();
    drift(g, -156, -110, 50, 8, 11);
    bodyLight(g, -160, -140, 320, 210, 1, 17);
  }

  // Хвост Ми-8 — обломок: хвостовая балка оторвана по шпангоуту (рваный край, стрингеры, провода), лежит по диагонали в снегу,
  // смята и надломлена посередине; на конце — концевая балка-пилон, погнута набок, на ней рулевой винт: одна лопасть обломана,
  // одна согнута и ушла в снег, третья висит. Под пилоном — обрубок стабилизатора. Ливрея — как у корпуса (paintMi8): белый низ-серый,
  // красная полоса #ca4528, тёмная нитка #27394a. Верх балки — цепочка шапки js/snow.js (tail): [-87,-42 … -21,-35 … 46,-11].
  function paintTail(g) {
    shadow(g, -18, 4, 96, 16, 0.36);
    // балка: два конуса с изломом; axis — ось, r — полутолщина (сужается к пилону)
    const seg = (x0, y0, r0, x1, y1, r1) => { const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = dy / L, ny = -dx / L; return [[x0 + nx * r0, y0 + ny * r0], [x1 + nx * r1, y1 + ny * r1], [x1 - nx * r1, y1 - ny * r1], [x0 - nx * r0, y0 - ny * r0]]; };
    const A = seg(-88, -30, 12, -22, -25, 10), B = seg(-22, -25, 10, 44, -4, 7);
    // пилон (за балкой — рисуем раньше): погнут вправо-вверх, со складкой
    g.fillStyle = lg(g, 36, 0, 70, 0, [[0, '#dde6ee'], [1, '#8e99a3']]);
    poly(g, g.fillStyle, 34, -10, 48, -30, 58, -46, 66, -44, 60, -26, 50, -2);
    line(g, 'rgba(62,68,80,0.55)', 1, 47, -29, 57, -27);                                  // складка излома
    poly(g, '#ca4528', 51, -35, 57, -45, 64, -43, 59, -33);
    // стабилизатор (дальний) — обрубок
    poly(g, '#b2bac3', 20, -14, 30, -19, 26, -24, 16, -20);
    // лопасть, ушедшая в снег (за балкой пилона)
    g.lineCap = 'round';
    g.strokeStyle = '#2f3542'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(62, -45); g.quadraticCurveTo(78, -38, 84, -18); g.stroke();
    // балка: белый корпус с тенью к низу
    const body = new Path2D(); body.moveTo(A[0][0], A[0][1]); body.lineTo(A[1][0], A[1][1]); body.lineTo(B[1][0], B[1][1]); body.lineTo(B[2][0], B[2][1]); body.lineTo(A[2][0] + 1.5, A[2][1] + 1); body.lineTo(A[3][0], A[3][1]);
    // рваный край: зубцы обшивки по шпангоуту
    body.lineTo(-92, -22); body.lineTo(-87, -27); body.lineTo(-93, -32); body.lineTo(-88, -36); body.lineTo(-91, -40); body.closePath();
    g.fillStyle = lg(g, 0, -40, 0, 0, [[0, '#f6f9fc'], [0.35, '#dde6ee'], [0.8, '#b2bac3'], [1, '#7f8792']]); g.fill(body);
    g.save(); g.clip(body);
    // нитка и красная полоса — по оси, с изломом
    g.strokeStyle = '#27394a'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-95, -28); g.lineTo(-22, -22.5); g.lineTo(48, -1.5); g.stroke();
    g.strokeStyle = '#ca4528'; g.lineWidth = 16; g.beginPath(); g.moveTo(6, -18); g.lineTo(20, -13.5); g.stroke();
    // стыки панелей поперёк оси и заклёпки
    g.strokeStyle = 'rgba(62,68,80,0.35)'; g.lineWidth = 0.8; g.beginPath();
    for (const x of [-70, -54, -38]) { g.moveTo(x - 1, -44); g.lineTo(x + 1, -12); }
    for (const x of [-4, 14, 30]) { g.moveTo(x + 3, -36); g.lineTo(x - 3, -4); }
    g.stroke();
    g.fillStyle = 'rgba(78,83,93,0.45)'; for (let x = -84; x < 40; x += 5) g.fillRect(x, x < -22 ? -33.5 + (x + 88) * 0.075 : -34.5 + (x + 22) * 0.31, 1, 1);
    // смятие у излома: гармошка складок и надрыв
    g.strokeStyle = 'rgba(47,53,66,0.55)'; g.lineWidth = 1; g.beginPath();
    for (let k = 0; k < 4; k++) { const x = -28 + k * 3.6; g.moveTo(x, -37); g.lineTo(x + 2, -30); g.lineTo(x - 1, -23); g.lineTo(x + 1.5, -15); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.7; g.beginPath(); for (let k = 0; k < 4; k++) { const x = -26.6 + k * 3.6; g.moveTo(x, -36); g.lineTo(x + 2, -29.5); } g.stroke();
    poly(g, '#161b21', -22, -27, -16, -25, -19, -22);
    // объём: блик сверху, тень снизу
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-84, -39); g.lineTo(-22, -32.5); g.lineTo(44, -9.5); g.stroke();
    g.restore();
    // торец: чёрное нутро, шпангоут, стрингеры торчат, провода свисают
    el(g, -89, -30, 3.4, 11, '#161b21');
    g.strokeStyle = '#8f9aa4'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(-88, -30, 2.6, 10.4, 0, -1.4, 1.6); g.stroke();
    g.strokeStyle = '#6c7178'; g.lineWidth = 1; g.beginPath(); g.moveTo(-89, -38); g.lineTo(-97, -42); g.moveTo(-90, -24); g.lineTo(-99, -21); g.moveTo(-89, -31); g.lineTo(-96, -30); g.stroke();
    line(g, '#313031', 1, -90, -27, -97, -18, -99, -8); line(g, '#ca4528', 0.9, -89, -29, -94, -20, -93, -10);
    // рулевой винт на пилоне: втулка, обломанная лопасть, висящая лопасть (виден под углом — укорочены)
    g.strokeStyle = '#2f3542'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(62, -45); g.lineTo(57, -52); g.stroke();              // обломок
    poly(g, '#2f3542', 55.5, -51, 58.5, -54, 57.2, -50);
    g.beginPath(); g.moveTo(62, -45); g.lineTo(70, -30); g.stroke();                                                          // висит
    g.fillStyle = '#f6f9fc'; g.fillRect(68, -33, 3, 1.4);
    el(g, 62, -45, 3.6, 3.2, '#5d626b'); el(g, 61.2, -45.8, 1.4, 1.2, '#a5acb3');
    el(g, 60, -47.5, 5, 1.4, '#f6f9fc');                                                                                        // снег на пилоне
    // хвостовая опора — погнута
    line(g, '#4e535d', 2.2, 36, -4, 40, 4, 47, 6);
    // снег: наметён под балку по всей длине (лежит на снегу, а не висит) и большой сугроб спереди
    g.fillStyle = lg(g, 0, -24, 0, 6, [[0, '#f6f9fc'], [1, '#dde6ee']]);
    g.beginPath(); g.moveTo(-102, -12); g.quadraticCurveTo(-90, -22, -76, -18); g.quadraticCurveTo(-50, -16, -24, -14); g.quadraticCurveTo(10, -6, 40, 3); g.quadraticCurveTo(56, 6, 66, 12); g.lineTo(-100, 12); g.closePath(); g.fill();
    g.fillStyle = lg(g, 0, -20, 0, 36, [[0, '#f6f9fc'], [0.5, '#f6f9fc'], [1, SNOW]]);
    g.beginPath(); g.moveTo(-108, 28); g.quadraticCurveTo(-100, -2, -80, -8); g.quadraticCurveTo(-50, -6, -24, -6); g.quadraticCurveTo(10, 0, 44, 8); g.quadraticCurveTo(76, 6, 90, -10); g.quadraticCurveTo(100, 8, 106, 30); g.quadraticCurveTo(0, 42, -108, 28); g.fill();
    g.fillStyle = lg(g, -108, 0, 108, 0, [[0, 'rgba(60,80,130,0)'], [1, 'rgba(60,80,130,0.18)']]); g.fill();
    g.strokeStyle = 'rgba(111,142,168,0.5)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-80, -8); g.quadraticCurveTo(-50, -6, -24, -6); g.quadraticCurveTo(10, 0, 44, 8); g.stroke();
    // кончик лопасти торчит из сугроба
    el(g, 84, -15, 5, 2, '#f6f9fc');
    // снег на балке
    g.fillStyle = SH(0.3); g.beginPath(); g.moveTo(-86, -40); g.lineTo(-21, -33); g.lineTo(46, -9); g.lineTo(45, -6.5); g.lineTo(-21, -30); g.lineTo(-86, -37); g.fill();
    g.fillStyle = '#f6f9fc'; g.beginPath(); g.moveTo(-88, -41.5); g.quadraticCurveTo(-54, -41, -21, -36.5); g.quadraticCurveTo(12, -25, 47, -11); g.quadraticCurveTo(20, -18, -4, -26); g.quadraticCurveTo(-30, -31, -50, -35); g.quadraticCurveTo(-70, -36, -88, -38); g.fill();
    // обломки обшивки и льдины вокруг
    ice(g, -96, 22, 0.9, -2); ice(g, 70, 24, 0.8, 3);
    g.save(); g.translate(22, 30); g.rotate(0.25); poly(g, '#b2bac3', -10, -3, 8, -5, 11, 2, -7, 4); poly(g, '#ca4528', -4, -3.6, 1, -4.2, 2, 3.2, -3, 3.6); g.restore();
    g.save(); g.translate(-60, 20); g.rotate(-0.4); poly(g, '#c2c9d0', -5, -2, 6, -3, 4, 3); g.restore();
    el(g, 22, 28, 10, 2.5, '#f6f9fc');
  }

  function paintChum(g) {
    shadow(g, 0, 1, 50, 11, 0.42);
    // шесты над дымоходом
    g.lineCap = 'round';
    const tips = [[-14, -116], [-8, -120], [-2, -118], [5, -121], [11, -117], [16, -113]];
    g.strokeStyle = '#4e3723'; g.lineWidth = 2.6; g.beginPath(); for (const [x, y] of tips) { g.moveTo(x * 0.25, -88); g.lineTo(x, y); } g.stroke();
    g.strokeStyle = '#352b25'; g.lineWidth = 2.8; g.beginPath(); for (const [x, y] of tips) { g.moveTo(x * 0.5, -96 - (y + 96) * 0.1); g.lineTo(x * 0.3, -90); } g.stroke();
    // покрышка из шкур
    const cone = new Path2D(); cone.moveTo(-6, -92); cone.lineTo(6, -92); cone.quadraticCurveTo(24, -40, 44, 0); cone.quadraticCurveTo(0, 8, -44, 0); cone.quadraticCurveTo(-24, -40, -6, -92); cone.closePath();
    g.fillStyle = lg(g, -44, 0, 44, 0, [[0, '#a58e73'], [0.4, '#7d634b'], [0.75, '#645240'], [1, '#473930']]); g.fill(cone);
    g.save(); g.clip(cone);
    const r = rng(51);
    const pc = ['rgba(58,38,24,0.28)', 'rgba(205,173,133,0.22)', 'rgba(78,55,35,0.3)'];
    for (let k = 0; k < 9; k++) { g.fillStyle = pc[k % 3]; g.beginPath(); g.roundRect(-40 + r() * 70, -80 + r() * 72, 10 + r() * 14, 8 + r() * 10, 3); g.fill(); }
    g.strokeStyle = 'rgba(58,38,24,0.5)'; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath();
    for (let k = 0; k < 4; k++) { const yy = -70 + k * 18; g.moveTo(-50, yy + 6); g.quadraticCurveTo(0, yy - 4, 50, yy + 6); } g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(58,38,24,0.6)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-50, -18); g.quadraticCurveTo(0, -30, 50, -18); g.stroke();
    // копоть у дымохода
    g.fillStyle = rg(g, 0, -92, 26, [[0, 'rgba(16,39,31,0.85)'], [1, 'rgba(16,39,31,0)']]); g.fillRect(-30, -110, 60, 40);
    // снег на наветренном склоне
    g.fillStyle = lg(g, -44, -60, -10, 0, [[0, '#f6f9fc'], [1, '#dde6ee']]);
    g.beginPath(); g.moveTo(-12, -70); g.quadraticCurveTo(-30, -36, -46, 0); g.lineTo(-30, 0); g.quadraticCurveTo(-26, -20, -18, -30); g.quadraticCurveTo(-20, -44, -12, -70); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(-16, -56, 3, 8, 0.4, 0, TAU); g.ellipse(-6, -80, 2, 5, 0.3, 0, TAU); g.fill();
    g.restore();
    // вход: откинутый полог и тёплая глубина
    g.fillStyle = lg(g, 0, -34, 0, 0, [[0, '#3a2618'], [1, '#723c29']]);
    g.beginPath(); g.moveTo(-9, 1); g.quadraticCurveTo(-4, -20, 2, -32); g.quadraticCurveTo(8, -20, 12, 1); g.fill();
    g.fillStyle = 'rgba(255,179,71,0.35)'; g.beginPath(); g.ellipse(2, -4, 7, 4, 0, 0, TAU); g.fill();
    g.fillStyle = '#a08561'; g.beginPath(); g.moveTo(2, -32); g.quadraticCurveTo(14, -18, 20, 2); g.lineTo(13, 2); g.quadraticCurveTo(10, -16, 2, -32); g.fill();
    line(g, '#3a2618', 1, 2, -32, 16, 1);
    // снег у основания
    g.fillStyle = lg(g, -50, 0, 50, 0, [[0, '#f6f9fc'], [0.6, '#eaf0f5'], [1, '#b6c9df']]);
    g.beginPath(); g.moveTo(-54, 4); g.quadraticCurveTo(-46, -8, -34, -3); g.quadraticCurveTo(-24, -6, -12, 2); g.quadraticCurveTo(0, 10, 16, 3); g.quadraticCurveTo(30, -6, 42, -2); g.quadraticCurveTo(52, 0, 56, 6); g.quadraticCurveTo(0, 16, -54, 4); g.fill();
    // вязанка хвороста у входа
    g.save(); g.translate(-30, 10); g.rotate(-0.08);
    for (let k = 0; k < 4; k++) { rr(g, -12, -3 - k * 2.5, 24, 3.4, 1.7, k % 2 ? '#67482f' : '#5b3d27'); el(g, 12, -1.3 - k * 2.5, 1.6, 1.6, '#c79a62'); }
    rr(g, -12, -13, 24, 2.6, 1.3, '#f6f9fc');
    g.restore();
  }

  function paintLabaz(g) {
    shadow(g, 0, 0, 26, 7, 0.4);
    // сваи-пни
    for (const dx of [-14, 14]) {
      g.fillStyle = lg(g, dx - 3.5, 0, dx + 3.5, 0, [[0, '#765436'], [1, '#3a2618']]);
      g.beginPath(); g.moveTo(dx - 4, 0); g.lineTo(dx - 3, -32); g.lineTo(dx + 3, -32); g.lineTo(dx + 4, 0); g.fill();
      line(g, 'rgba(16,39,31,0.5)', 0.7, dx - 1, -4, dx - 0.5, -26); line(g, 'rgba(16,39,31,0.5)', 0.7, dx + 1.5, -8, dx + 1.5, -24);
      el(g, dx, 0, 6, 2.2, '#f6f9fc');
    }
    // настил
    rr(g, -24, -33, 48, 4, 1, '#4b3220');
    // сруб
    const n = 5, lh = 4.6, y0 = -33;
    for (let i = 0; i < n; i++) {
      const y = y0 - (i + 1) * lh;
      g.fillStyle = lg(g, 0, y, 0, y + lh, [[0, '#8a6a45'], [0.4, '#67482f'], [1, '#3a2618']]);
      g.beginPath(); g.roundRect(-21, y, 42, lh, lh / 2); g.fill();
      for (const ex of [-22, 22]) { el(g, ex, y + lh / 2, 2.6, 2.4, '#c79a62'); el(g, ex, y + lh / 2, 1, 1, '#8a6a45'); }
    }
    // лаз
    rr(g, -6, -52, 12, 12, 1, '#3a2618'); line(g, '#8a6a45', 1.2, -6, -46, 6, -46);
    // крыша со снегом и сосульками
    const top = y0 - n * lh;
    g.fillStyle = '#3a2618'; g.beginPath(); g.moveTo(-28, top + 2); g.lineTo(0, top - 15); g.lineTo(28, top + 2); g.closePath(); g.fill();
    g.fillStyle = SH(0.4); g.fillRect(-21, top, 42, 3);
    g.fillStyle = lg(g, -28, top - 16, 28, top, [[0, '#f6f9fc'], [0.6, '#f6f9fc'], [1, '#b6c9df']]);
    g.beginPath(); g.moveTo(-30, top + 1); g.quadraticCurveTo(-16, top - 10, 0, top - 18); g.quadraticCurveTo(16, top - 10, 30, top + 1);
    g.quadraticCurveTo(22, top + 3, 16, top - 2); g.quadraticCurveTo(6, top - 7, 0, top - 9); g.quadraticCurveTo(-8, top - 4, -16, top); g.quadraticCurveTo(-24, top + 4, -30, top + 1); g.fill();
    g.fillStyle = 'rgba(221,230,238,0.95)'; g.beginPath();
    for (const [x, L] of [[-22, 5], [-17, 3], [-11, 6], [10, 4], [18, 6], [24, 3]]) { g.moveTo(x - 1.2, top + 1); g.lineTo(x, top + 1 + L); g.lineTo(x + 1.2, top + 1); } g.fill();
    // бревно-лестница с зарубками
    g.lineCap = 'round'; line(g, '#67482f', 3.4, 22, 2, 9, -34);
    g.strokeStyle = '#3a2618'; g.lineWidth = 1.2; g.beginPath(); for (let k = 1; k < 5; k++) { const t = k / 5, x = 22 - 13 * t, y = 2 - 36 * t; g.moveTo(x - 2, y); g.lineTo(x + 1.5, y + 0.8); } g.stroke();
    el(g, 22, 2, 5, 1.8, '#f6f9fc');
  }

  // ================= ОГОНЬ =================
  const FL = [['#b8392d', 1, 0], ['#ff6a1a', 0.86, 0.9], ['#ffa13c', 0.66, 1.9], ['#ffd27a', 0.44, 2.8], ['#f8e8cf', 0.22, 3.7]];
  // многослойное пламя с язычками; ~7 путей
  // wx — куда дует (знак и доля x, gfx ENV.wx); soft — мягкие языки: внешние слои полупрозрачны и чуть шире
  const FL_SOFT = [0.55, 0.8, 0.95, 1, 1];
  // мягкий язык пламени: капля с радиальным спадом (без контура), кэш на цвет; рисуется вытянутой по высоте языка
  const TONG = new Map();
  function tongue(c) {
    let e = TONG.get(c); if (e) return e;
    e = document.createElement('canvas'); e.width = 32; e.height = 64; const q = e.getContext('2d');
    const [r0, g0, b0] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    q.save(); q.translate(16, 46); q.scale(1, 2.6);
    const gr = q.createRadialGradient(0, 0, 0, 0, 0, 16); gr.addColorStop(0, `rgba(${r0},${g0},${b0},1)`); gr.addColorStop(0.55, `rgba(${r0},${g0},${b0},0.75)`); gr.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
    q.fillStyle = gr; q.beginPath(); q.arc(0, 0, 16, 0, TAU); q.fill(); q.restore();
    TONG.set(c, e); return e;
  }
  function flame(g, x, y, k, t, wind = 1, wx = 1, soft = 0) {
    const lean = (wind - 1) * 1.6 * wx;
    if (soft) { // мягкие языки: слои цвета — капли без контура, покачиваются и тянутся по ветру
      let li = 0;
      for (const [c, sc, off] of FL) {
        const ww = 11 * k * sc, n = 3, sw = 2 * ww / n, T = tongue(c); g.globalAlpha = FL_SOFT[li++];
        for (let i = 0; i < n; i++) {
          const cx0 = x - ww + (i + 0.5) * sw, main = i === 1 ? 1 : 0.72 + 0.1 * Math.sin(t * 3 + i);
          const hh = 30 * k * sc * main * (1 + 0.16 * Math.sin(t * (11 + i * 3) + off * 2 + i * 1.7) + 0.07 * Math.sin(t * 27 + i + off));
          const tx = Math.sin(t * 8 + off + i * 2) * 2.4 * k * sc + lean * k * (1 + sc), w = sw * 1.55;
          g.save(); g.translate(cx0, y); g.transform(1, 0, -tx / Math.max(1, hh), 1, 0, 0); // верх языка — вбок по ветру и дрожи
          g.drawImage(T, -w / 2, -hh, w, hh * 1.25); g.restore();
        }
      }
      g.globalAlpha = 1;
    } else {
    let li = 0;
    for (const [c, sc0, off] of FL) {
      const sc = soft ? sc0 * (li < 2 ? 1.1 : 1) : sc0; if (soft) g.globalAlpha = FL_SOFT[li]; li++;
      const ww = 11 * k * sc, n = 3, sw = 2 * ww / n;
      g.fillStyle = c; g.beginPath(); g.moveTo(x - ww, y);
      for (let i = 0; i < n; i++) {
        const cx0 = x - ww + (i + 0.5) * sw, main = i === 1 ? 1 : 0.7 + 0.1 * Math.sin(t * 3 + i);
        const hh = 27 * k * sc * main * (1 + 0.16 * Math.sin(t * (11 + i * 3) + off * 2 + i * 1.7) + 0.07 * Math.sin(t * 27 + i + off));
        const tx = cx0 + Math.sin(t * 8 + off + i * 2) * 2.4 * k * sc + lean * k * (1 + sc);
        g.quadraticCurveTo(cx0 - sw * 0.55, y - hh * 0.5, tx, y - hh);
        const vx = cx0 + sw * 0.5, vy = i === n - 1 ? y : y - hh * (0.32 + 0.08 * Math.sin(t * 9 + i));
        g.quadraticCurveTo(cx0 + sw * 0.5, y - hh * 0.45, vx, vy);
      }
      g.quadraticCurveTo(x, y + 4 * k * sc, x - ww, y); g.fill();
    }
    }
    // отрывающиеся язычки
    for (let j = 0; j < 2; j++) {
      const p = (t * 1.7 + j * 0.53 + x * 0.001) % 1, hy = y - 27 * k * (0.8 + p * 0.7), hx = x + Math.sin(t * 5 + j * 3) * 4 * k + lean * k * 2 * p;
      g.globalAlpha = 1 - p; g.fillStyle = p < 0.5 ? '#ffb347' : '#ff6a1a';
      const r = 3 * k * (1 - p * 0.7);
      g.beginPath(); g.moveTo(hx, hy - r * 2.2); g.quadraticCurveTo(hx + r, hy, hx, hy + r); g.quadraticCurveTo(hx - r, hy, hx, hy - r * 2.2); g.fill();
    }
    g.globalAlpha = 1;
  }
  // дым-клубы по фазе (без частиц), 3–4 drawImage
  function wisp(g, x, y, env, k = 1, n = 4, dark = 0) {
    const t = env.now, w = env.wind || 1, wx = env.wx == null ? 1 : env.wx; // дым сносит по ветру (wx — знак и доля x)
    for (let i = 0; i < n; i++) {
      const p = (t * 0.32 + i / n + x * 0.0013) % 1, r = (3 + p * 11) * k;
      g.globalAlpha = (dark ? 0.55 : 0.4) * (1 - p) * Math.min(1, p * 6);
      g.drawImage(SMK(), x + p * (8 + w * 16) * k * wx + Math.sin(t * 1.3 + i * 2) * 2.5 - r, y - p * 40 * k - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
  }
  function stones(g, x, y, R, ry, n, lit) {
    g.fillStyle = '#5b636d'; g.beginPath();
    for (let i = 0; i < n; i++) { const a = i / n * TAU, sx = x + Math.cos(a) * R, sy = y + Math.sin(a) * ry; g.moveTo(sx + 5.5, sy + 0.8); g.ellipse(sx, sy + 0.8, 5.5, 3.8, 0, 0, TAU); } g.fill();
    g.fillStyle = '#8f99a3'; g.beginPath();
    for (let i = 0; i < n; i++) { const a = i / n * TAU, sx = x + Math.cos(a) * R, sy = y + Math.sin(a) * ry; g.moveTo(sx + 4, sy - 0.6); g.ellipse(sx - 0.8, sy - 0.6, 4, 2.6, 0, 0, TAU); } g.fill();
    g.fillStyle = lit ? 'rgba(255,158,74,0.55)' : '#f6f9fc'; g.beginPath();
    for (let i = 0; i < n; i++) { const a = i / n * TAU; if (!lit && Math.sin(a) > 0.1) continue; const sx = x + Math.cos(a) * R, sy = y + Math.sin(a) * ry; g.moveTo(sx + 2.6, sy - 1.8); g.ellipse(sx - 1, sy - 1.8, 2.6, 1.2, 0, 0, TAU); } g.fill();
  }
  function logSide(g, x, y, ang, len, rad, char) {
    g.save(); g.translate(x, y); g.rotate(ang);
    rr(g, -len / 2, -rad, len, rad * 2, rad, '#5b3d27');
    g.fillStyle = '#765436'; g.fillRect(-len / 2 + rad, -rad, len - rad * 2, rad * 0.6);
    if (char) { g.fillStyle = '#1b120d'; g.fillRect(-len / 2, -rad, len * char, rad * 2); }
    el(g, len / 2 - 0.5, 0, rad * 0.6, rad, '#c79a62');
    g.restore();
  }
  function fire(g, f, env) {
    env = E(env);
    const x = f.x, y = f.y, t = env.now, lit = f.fuel > 0, mk = f.melt || 0;
    // подтаявший снег: тёмное влажное кольцо растёт со временем горения (f.melt 0..1 — рендер), без кромки — радиальный спад
    if (mk > 0.01) {
      const R = 26 + 38 * mk, a = 0.3 + 0.28 * mk;
      g.save(); g.translate(x, y + 1); g.scale(1, 0.42);
      g.fillStyle = rg(g, 0, 0, R, [[0, `rgba(58,64,70,${a})`], [0.45, `rgba(84,104,122,${a * 0.8})`], [0.8, `rgba(111,142,168,${a * 0.35})`], [1, 'rgba(111,142,168,0)']]);
      g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
    }
    g.fillStyle = 'rgba(111,142,168,0.35)'; g.beginPath(); g.ellipse(x, y + 1, 26, 11, 0, 0, TAU); g.fill();
    el(g, x, y, 16, 6.5, lit ? '#352b25' : '#6c7178');
    el(g, x, y - 0.5, 10, 4, lit ? '#742a1f' : '#605e60');
    stones(g, x, y, 18, 7.5, 9, lit);
    // поленья «колодцем» к центру
    for (const [a, c] of [[0.35, 0], [2.55, 1], [4.4, 2]]) {
      const ex = Math.cos(a), ey = Math.sin(a) * 0.45;
      logSide(g, x + ex * 9, y - 2 + ey * 9, Math.atan2(ey, ex), 20, 2.8, 0.45 + (lit ? 0 : 0.2));
    }
    if (lit) {
      const fh = f.fuel * 20 / (typeof HOUR === 'number' ? HOUR : 20), k = clamp(fh / 60, 0.45, 1.25); // fh — топливо в «прежних» с (игровой час = 20): 3 ч огня — полный костёр
      // угли
      const pul = 0.5 + 0.5 * Math.sin(t * 5 + x);
      el(g, x, y - 2, 9 * k + 2, 3.6, '#ff6a1a');
      g.fillStyle = pul > 0.5 ? '#ffd27a' : '#ffb347'; g.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * 1.7 + (t * 0.7 | 0) * 0.9; g.rect(x + Math.cos(a) * 6 * k - 1, y - 2 + Math.sin(a) * 2 - 0.6, 2, 1.2); } g.fill();
      // мягкая подсветка под языками (без края), потом пламя с полупрозрачными внешними слоями
      g.save(); g.translate(x, y - 10 * k); g.scale(1, 1.25); g.globalAlpha = 0.5;
      g.fillStyle = rg(g, 0, 0, 20 * k + 6, [[0, 'rgba(255,190,110,0.8)'], [0.5, 'rgba(255,130,50,0.3)'], [1, 'rgba(255,106,26,0)']]);
      g.beginPath(); g.arc(0, 0, 20 * k + 6, 0, TAU); g.fill(); g.restore(); g.globalAlpha = 1;
      flame(g, x, y - 2, k, t + x * 0.01, env.wind, env.wx == null ? 1 : env.wx, 1);
      wisp(g, x, y - 32 * k - 6, env, 0.9 + k * 0.4, 4);
      // свет: один мягкий источник ('f' — спад без края), чуть шире прежнего; дрожь ±3 %
      env.light(x, y - 10, (140 + Math.min(fh, 120) * 1.6) * (1 + Math.sin(t * 11 + x) * 0.03), 'f', 1);
      env.glow(x, y - 12, 1.2);
    } else {
      g.fillStyle = '#93979f'; g.beginPath(); g.ellipse(x - 2, y - 2, 6, 2, 0, 0, TAU); g.ellipse(x + 4, y - 1, 4, 1.5, 0, 0, TAU); g.fill();
      if (f.fuel > -20 && f.fuel !== undefined && f.fuel > -999) { /* тлеющее кострище — тонкая струйка */ wisp(g, x, y - 4, env, 0.5, 2); }
    }
  }
  function stack(g, s, env) {
    env = E(env);
    const x = s.x, y = s.y, t = env.now;
    shadow(g, x, y + 1, 26, 8, 0.35);
    g.fillStyle = 'rgba(147,172,196,0.25)'; g.beginPath(); g.ellipse(x, y, 28, 10, 0, 0, TAU); g.fill();
    if (s.lit > 0) {
      const k = clamp(s.lit / 30, 1, 2.4);
      el(g, x, y - 2, 22, 7, '#3a2618');
      for (let i = 0; i < 5; i++) logSide(g, x + Math.cos(i * 1.3) * 5, y - 3 + Math.sin(i * 1.3) * 2, i * 1.26, 40, 3.2, 0.7);
      el(g, x, y - 4, 16, 5, '#ff6a1a');
      g.fillStyle = '#ffd27a'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * 0.8 + (t * 0.9 | 0); g.rect(x + Math.cos(a) * 12 - 1, y - 4 + Math.sin(a) * 3.5, 2.2, 1.3); } g.fill();
      flame(g, x - 6 * k, y - 4, k * 0.6, t * 1.1 + 1, env.wind);
      flame(g, x + 6 * k, y - 4, k * 0.62, t * 0.95 + 2.3, env.wind);
      flame(g, x, y - 4, k, t, env.wind);
      wisp(g, x, y - 40 * k, env, 1.2 + k * 0.5, 5, 1);
      env.light(x, y - 20, 380, 'w', 1); env.glow(x, y - 24, 2.4);
      return;
    }
    // вешка-метка
    line(g, '#5b3d27', 2, x - 24, y + 2, x - 24, y - 26);
    g.fillStyle = '#b8392d'; const wv = Math.sin(t * 4 + x) * 1.5; g.beginPath(); g.moveTo(x - 23, y - 26); g.quadraticCurveTo(x - 17, y - 26 + wv, x - 13, y - 23 + wv); g.lineTo(x - 23, y - 20); g.fill();
    const w = s.wood | 0;
    if (w === 0) {
      g.setLineDash([3, 3]); g.strokeStyle = 'rgba(91,61,39,0.55)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y - 2, 16, 6, 0, 0, TAU); g.stroke(); g.setLineDash([]);
    }
    // клеть из брёвен: чётные — поперёк, нечётные — вдоль
    for (let i = 0; i < Math.min(w, 4); i++) {
      const yy = y - 3 - i * 5.5;
      if (i % 2 === 0) { for (const dy of [-5, 4]) { rr(g, x - 18, yy + dy - 2.8, 36, 5.6, 2.8, dy < 0 ? '#5b3d27' : '#67482f'); g.fillStyle = '#8a6a45'; g.fillRect(x - 16, yy + dy - 2.8, 32, 1.6); el(g, x + 17.5, yy + dy, 2, 2.8, '#c79a62'); } }
      else { for (const dx of [-12, 12]) { rr(g, x + dx - 2.8, yy - 9, 5.6, 16, 2.8, '#67482f'); el(g, x + dx, yy + 6, 2.8, 2.2, '#c79a62'); el(g, x + dx, yy + 6, 1, 0.8, '#8a6a45'); } }
    }
    if (w >= 4) { // лапник сверху
      g.fillStyle = '#1c4034'; g.beginPath(); for (let i = 0; i < 5; i++) { const a = -0.6 + i * 0.3; g.moveTo(x, y - 26); g.ellipse(x + Math.cos(a) * 9 - 2, y - 26 + Math.sin(a) * 2, 10, 3, a, 0, TAU); } g.fill();
      el(g, x - 4, y - 28, 7, 2, '#f6f9fc');
    }
    // счётчик
    for (let i = 0; i < 4; i++) el(g, x - 9 + i * 6, y + 12, 2.2, 2.2, i < w ? '#ffb347' : 'rgba(56,71,86,0.35)');
  }

  // ================= ПОСЁЛОК =================
  const DIMS = { balok: [58, 38, 'balok'], woodshed: [62, 36, 'woodshed'], smoke: [48, 40, 'smoke'], labaz2: [42, 36, 'labaz'], forge: [54, 44, 'forge'], tower: [34, 34, 'tower'], market: [76, 50, 'market'] };
  function dims(t) { const B = typeof BUILDS !== 'undefined' && BUILDS[t]; return B ? [B.w, B.h, B.i] : DIMS[t] || [50, 40, '']; }

  // сруб: n венцов снизу вверх от yb; ≈5 путей
  function logs(g, x0, yb, w, n, lh, c = LOG, ends = true) {
    if (n <= 0) return;
    g.fillStyle = c[0]; g.fillRect(x0, yb - n * lh, w, n * lh);
    g.fillStyle = c[1]; g.beginPath(); for (let i = 0; i < n; i++) g.rect(x0, yb - (i + 1) * lh + lh * 0.16, w, lh * 0.3); g.fill();
    g.fillStyle = c[2]; g.beginPath(); for (let i = 0; i < n; i++) g.rect(x0, yb - i * lh - lh * 0.2, w, lh * 0.2); g.fill();
    if (!ends) return;
    const er = lh * 0.52;
    g.fillStyle = c[3]; g.beginPath();
    for (let i = 0; i < n; i++) for (const ex of [x0 - er * 0.6, x0 + w + er * 0.6]) { const ey = yb - (i + 0.5) * lh; g.moveTo(ex + er, ey); g.ellipse(ex, ey, er, er * 0.95, 0, 0, TAU); }
    g.fill();
    g.strokeStyle = c[4]; g.lineWidth = 0.7; g.beginPath();
    for (let i = 0; i < n; i++) for (const ex of [x0 - er * 0.6, x0 + w + er * 0.6]) { const ey = yb - (i + 0.5) * lh; g.moveTo(ex + er * 0.45, ey); g.ellipse(ex, ey, er * 0.45, er * 0.42, 0, 0, TAU); }
    g.stroke();
  }
  // двускатная крыша, вид 3/4: видимый южный скат со снегом, сосульки
  function roof(g, x, top, w, rise, c, seed, snow = 1) {
    const ov = 6, x0 = x - w / 2 - ov, W = w + ov * 2, ry = top - rise;
    g.fillStyle = SH(0.4); g.fillRect(x - w / 2, top, w, 5);
    g.fillStyle = c[0]; g.fillRect(x0, ry, W, rise + 2);
    g.fillStyle = c[1]; g.fillRect(x0, top - 1, W, 3.5);
    if (snow <= 0) return;
    const sb = ry + rise * (0.35 + 0.47 * snow), n = Math.max(4, Math.round(W / 11));
    const lump = (dy, fill) => {
      g.fillStyle = fill; g.beginPath(); g.moveTo(x0 - 1, ry - 1 + dy);
      g.quadraticCurveTo(x0 + W / 2, ry - 4 + dy, x0 + W + 1, ry - 1 + dy); g.lineTo(x0 + W + 1, sb + dy);
      for (let i = n - 1; i >= 0; i--) { const xa = x0 + W * (i + 1) / n, xb = x0 + W * i / n; g.quadraticCurveTo((xa + xb) / 2, sb + dy + 2 + hs(seed + i) * 4.5, xb, sb + dy + (i ? hs(seed + i * 3) * 1.5 : 0)); }
      g.closePath(); g.fill();
    };
    lump(2.2, SH(0.35)); lump(0, SNOW_HI);
    g.fillStyle = SNOW_MID; g.fillRect(x0, sb - rise * 0.2, W, rise * 0.14);
    g.fillStyle = '#f6f9fc'; g.fillRect(x0 + 2, ry, W * 0.6, 2);
    // сосульки
    g.fillStyle = 'rgba(221,230,238,0.95)'; g.beginPath();
    for (let xx = x0 + 3; xx < x0 + W - 2; xx += 5.5) { const L = 1.5 + hs(seed + xx) * 5; if (L < 2.4) continue; g.moveTo(xx - 1.1, top + 2); g.lineTo(xx, top + 2 + L); g.lineTo(xx + 1.1, top + 2); } g.fill();
  }
  function windowLit(g, x, y, w, h, lit, env, nal = '#a4bad1') {
    rr(g, x - w / 2 - 2.5, y - h / 2 - 3, w + 5, h + 5.5, 1.5, nal); // резной наличник
    poly(g, nal, x - w / 2 - 3, y - h / 2 - 2.5, x, y - h / 2 - 6.5, x + w / 2 + 3, y - h / 2 - 2.5);
    g.fillStyle = lit ? '#ffc361' : '#27394a'; g.fillRect(x - w / 2, y - h / 2, w, h);
    if (lit) { g.fillStyle = '#fddc9b'; g.fillRect(x - w / 2 + 1, y - h / 2 + 1, w / 2 - 1.5, h / 2 - 1.5); }
    else { poly(g, '#4b6479', x - w / 2, y + h / 2 - 2, x - w / 2 + w * 0.55, y - h / 2, x - w / 2 + w * 0.8, y - h / 2, x - w / 2 + 2, y + h / 2); }
    g.fillStyle = '#3a2618'; g.fillRect(x - 0.6, y - h / 2, 1.2, h); g.fillRect(x - w / 2, y - 0.6, w, 1.2);
    rr(g, x - w / 2 - 3, y + h / 2 + 1.5, w + 6, 2.2, 1, SNOW_HI);
    if (lit) { env.glow(x, y, 0.5); env.light(x, y + h + 22, 90, 'w', 0.7); }
  }
  function door(g, x, yb, w, h, c = '#67482f') {
    rr(g, x - w / 2 - 1.5, yb - h - 1.5, w + 3, h + 1.5, 1.5, '#3a2618');
    g.fillStyle = c; g.fillRect(x - w / 2, yb - h, w, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - w / 2 + w / 3, yb - h, 0.8, h); g.fillRect(x - w / 2 + 2 * w / 3, yb - h, 0.8, h);
    g.fillStyle = '#cea977'; g.fillRect(x + w / 2 - 3, yb - h / 2, 1.6, 1.6);
  }
  function chimney(g, x, top, hgt, c, env, k = 1) {
    rr(g, x - 3.5, top - hgt, 7, hgt, 1, c[0]); g.fillStyle = c[1]; g.fillRect(x + 1, top - hgt, 2.5, hgt);
    rr(g, x - 5, top - hgt - 2, 10, 3, 1, '#323138'); el(g, x, top - hgt - 2.6, 5, 1.6, SNOW_HI);
    wisp(g, x, top - hgt - 6, env, k);
  }
  function snowBank(g, x, y, w, seed) {
    g.fillStyle = SNOW_HI; g.beginPath(); g.moveTo(x - w / 2 - 6, y + 2);
    for (let i = 0; i < 4; i++) { const xa = x - w / 2 - 6 + (w + 12) * (i + 1) / 4; g.quadraticCurveTo(xa - (w + 12) / 8, y - 3 - hs(seed + i) * 4, xa, y + 1); }
    g.quadraticCurveTo(x, y + 6, x - w / 2 - 6, y + 2); g.fill();
    g.fillStyle = SH(0.18); g.beginPath(); g.ellipse(x + w * 0.1, y + 3, w / 2 + 4, 2.4, 0, 0, TAU); g.fill();
  }
  function progressBar(g, x, y, w, p, ic) {
    rr(g, x - w / 2, y, w, 5, 2.5, 'rgba(47,53,66,0.55)'); rr(g, x - w / 2 + 1, y + 1, Math.max(3, (w - 2) * p), 3, 1.5, '#ffd27a');
    if (ic && typeof Icons !== 'undefined') Icons.draw(g, ic, x, y - 9, 13, '#ebe6d3', 'rgba(11,18,14,.8)');
  }
  function logPile(g, x, y, n) {
    for (let i = 0; i < n; i++) {
      const row = i < 3 ? 0 : i < 5 ? 1 : 2, col = row === 0 ? i : row === 1 ? i - 3 : 0, xx = x + col * 6 + row * 3, yy = y - row * 4.5;
      rr(g, xx - 13, yy - 2.4, 18, 4.8, 2.4, '#67482f'); el(g, xx + 5, yy, 2.2, 2.4, '#c79a62');
    }
    if (n) el(g, x + 2, y - Math.min(2, (n - 1) / 3 | 0) * 4.5 - 2.6, 8, 1.3, SNOW_HI);
  }

  function construct(g, b, x, y, w, h, ic, env) {
    const p = clamp(b.prog || 0, 0, 1), wh = h * 0.55, rd = h * 0.5, top = y - wh, x0 = x - w / 2, x1 = x + w / 2, yb = y - rd;
    g.fillStyle = 'rgba(147,172,196,0.3)'; g.beginPath(); g.roundRect(x0 - 9, yb - 7, w + 18, rd + 14, 9); g.fill();
    g.fillStyle = 'rgba(111,142,168,0.25)'; g.beginPath();
    for (let i = 0; i < 7; i++) { const px = x0 - 4 + hs(i + w) * (w + 8), py = yb + hs(i * 7 + h) * rd; g.moveTo(px + 2.5, py); g.ellipse(px, py, 2.5, 1.6, 0.4, 0, TAU); } g.fill();
    logPile(g, x1 + 18, y + 5, Math.round((1 - p) * 6));
    stageMark(g, b.type, p, x, y, w, h, x0, x1, yb, rd, env, 0);
    // колья и шнур разметки
    if (p < 0.45) {
      g.globalAlpha = 1 - clamp((p - 0.3) / 0.15, 0, 1);
      g.strokeStyle = '#cea977'; g.lineWidth = 0.8; g.strokeRect(x0, yb, w, rd); g.globalAlpha = 1;
    }
    g.fillStyle = '#5b3d27'; g.beginPath(); for (const [sx, sy] of [[x0, yb], [x1, yb], [x0, y], [x1, y]]) g.rect(sx - 1.2, sy - 8, 2.4, 8); g.fill();
    const k = clamp((p - 0.1) / 0.5, 0, 1), nc = k > 0 ? Math.max(1, Math.ceil(k * 5)) : 0, lh = wh / 5, hg = nc * lh;
    if (nc) {
      g.fillStyle = 'rgba(100,82,64,0.3)'; g.fillRect(x0, yb, w, rd);
      logs(g, x0, yb, w, nc, lh, ['#3a2618', '#5b3d27', '#3a2618', '#8a6a45', '#5b3d27'], false);
      g.fillStyle = '#67482f'; g.fillRect(x0 - lh * 0.5, yb - hg, lh, rd); g.fillRect(x1 - lh * 0.5, yb - hg, lh, rd);
      g.fillStyle = '#8a6a45'; g.fillRect(x0 - lh * 0.5, yb - hg, lh * 0.4, rd); g.fillRect(x1 - lh * 0.5, yb - hg, lh * 0.4, rd);
      logs(g, x0, y, w, nc, lh);
      if (nc < 5) { el(g, x0 + w * 0.3, y - hg - 1, 1.6, 1, '#eacd9a'); el(g, x0 + w * 0.34, y - hg - 1.4, 1.2, 0.8, '#c79a62'); }
    }
    const rise = h * 0.55 + 7, ry = top - rise;
    if (p > 0.6) {
      const rk = clamp((p - 0.6) / 0.2, 0, 1), n = Math.max(4, Math.round(w / 12));
      g.strokeStyle = '#8a6a45'; g.lineWidth = 2.2; g.beginPath();
      for (let i = 0; i <= n; i++) { if (i / n > rk + 0.01) break; const xi = x0 + w * i / n; g.moveTo(xi, top + 1); g.lineTo(xi, ry); } g.stroke();
      if (rk > 0.4) { rr(g, x0 - 4, ry - 2, w + 8, 3.5, 1.5, '#67482f'); }
      if (p > 0.75) {
        const bk = clamp((p - 0.75) / 0.12, 0, 1);
        g.strokeStyle = '#9a754e'; g.lineWidth = 1.4; g.beginPath();
        for (let j = 1; j < 5; j++) { if (j / 5 > bk + 0.1) break; const yy = top - rise * j / 5; g.moveTo(x0 - 4, yy); g.lineTo(x1 + 4, yy); } g.stroke();
      }
      if (p > 0.87) {
        const ck = clamp((p - 0.87) / 0.13, 0, 1);
        g.fillStyle = '#5b3d27'; g.fillRect(x0 - 6, ry, (w + 12) * ck, rise + 1);
        g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); for (let xx = x0 - 6 + 6; xx < x0 - 6 + (w + 12) * ck; xx += 6) g.rect(xx, ry, 0.8, rise + 1); g.fill();
      }
    }
    stageMark(g, b.type, p, x, y, w, h, x0, x1, yb, rd, env, 1);
    progressBar(g, x, ry - 14, Math.max(34, w * 0.7), p, ic);
  }
  // у каждой стройки своя примета с первых стадий — чтобы по разметке было понятно, что растёт
  function stageMark(g, type, p, x, y, w, h, x0, x1, yb, rd, env, over) {
    const t = E(env).now;
    const under = type === 'smoke' || type === 'labaz2';
    if (!over && !under) return;
    g.lineCap = 'round';
    switch (type) {
      case 'balok': { // полозья-сани под балком
        g.strokeStyle = '#3a2618'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0 - 6, y + 2); g.lineTo(x1 + 4, y + 2); g.quadraticCurveTo(x1 + 11, y + 2, x1 + 10, y - 4); g.stroke();
        g.strokeStyle = '#4b3220'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < 4; i++) { const xx = x0 + 4 + i * (w - 10) / 3; g.moveTo(xx, y + 2); g.lineTo(xx, y - 2); } g.stroke();
        el(g, x0 + w * 0.3, y + 3, w * 0.25, 1.4, SNOW_HI);
        break;
      }
      case 'woodshed': { // высокие угловые столбы навеса
        const hh = h * 0.55 + 4;
        for (const [px, py] of [[x0 + 2, yb], [x1 - 2, yb], [x0 + 2, y], [x1 - 2, y]]) { line(g, '#3a2618', 3.4, px, py, px, py - hh); line(g, '#765436', 1.2, px - 0.8, py, px - 0.8, py - hh); el(g, px, py - hh, 2, 1, SNOW_HI); }
        break;
      }
      case 'smoke': { // каменный очаг в центре
        const cx0 = x, cy = yb + rd * 0.55;
        if (over) { if (p > 0.2) wisp(g, cx0 + 4, y - h * 0.55 * clamp((p - 0.1) / 0.5, 0, 1) - 6, env, 0.8, 3, 1); break; }
        el(g, cx0, cy, 9, 4, '#352b25'); el(g, cx0, cy - 0.5, 6, 2.5, p > 0.2 ? '#742a1f' : '#605e60');
        stones(g, cx0, cy, 10, 4.5, 7, false);
        break;
      }
      case 'labaz2': { // сваи-пни: лабаз стоит на ногах
        if (over) { g.lineCap = 'round'; line(g, '#67482f', 3.2, x1 + 6, y + 2, x1 - 4, y - 30); g.strokeStyle = '#3a2618'; g.lineWidth = 1.1; g.beginPath(); for (let k = 1; k < 5; k++) { const q = k / 5, lx = x1 + 6 - 10 * q, ly = y + 2 - 32 * q; g.moveTo(lx - 2, ly); g.lineTo(lx + 1.5, ly + 0.8); } g.stroke(); el(g, x1 + 6, y + 2, 4, 1.5, SNOW_HI); break; }
        const hh = 14 + 20 * clamp(p * 2, 0, 1);
        for (const dx of [-12, 12]) { g.fillStyle = lg(g, x + dx - 3.5, 0, x + dx + 3.5, 0, [[0, '#765436'], [1, '#3a2618']]); g.beginPath(); g.moveTo(x + dx - 4, y - 2); g.lineTo(x + dx - 3, y - 2 - hh); g.lineTo(x + dx + 3, y - 2 - hh); g.lineTo(x + dx + 4, y - 2); g.fill(); el(g, x + dx, y - 2 - hh, 3, 1.2, '#c79a62'); el(g, x + dx, y - 1, 6, 2, SNOW_HI); }
        break;
      }
      case 'forge': { // каменный фундамент и наковальня в ожидании
        g.fillStyle = '#6d7279'; g.beginPath(); for (let i = 0; i < 9; i++) g.roundRect(x0 - 2 + i * (w + 4) / 9, y - 4 + (i % 2), (w + 4) / 9 - 1, 5, 1.5); g.fill();
        g.fillStyle = '#3e4450'; g.beginPath(); for (let i = 0; i < 9; i++) g.rect(x0 - 2 + i * (w + 4) / 9, y - 0.5 + (i % 2), (w + 4) / 9 - 1, 1.4); g.fill();
        const ax = x0 - 12, ay = y + 4;
        g.fillStyle = '#5b3d27'; g.fillRect(ax - 4, ay - 7, 8, 7); el(g, ax, ay - 7, 4, 1.5, '#9a754e');
        poly(g, '#323138', ax - 7, ay - 12, ax + 8, ay - 12, ax + 5, ay - 9, ax - 3, ay - 9); g.fillStyle = '#6c7178'; g.fillRect(ax - 6, ay - 12.5, 13, 1);
        break;
      }
      case 'tower': { // четыре мачты растут вверх, леса-лестница
        const hh = 20 + 56 * clamp(p * 1.4, 0, 1);
        for (const [px, lw, c] of [[x - 10, 2.6, '#4b3220'], [x + 10, 2.6, '#4b3220'], [x - 14, 3.6, '#67482f'], [x + 14, 3.6, '#67482f']]) line(g, c, lw, px, y - (lw < 3 ? 10 : 0), px + (px < x ? 2 : -2), y - (lw < 3 ? 10 : 0) - hh);
        line(g, '#765436', 1.4, x + 20, y + 2, x + 14, y - hh * 0.8); line(g, '#765436', 1.4, x + 25, y + 2, x + 19, y - hh * 0.8);
        g.strokeStyle = '#8a6a45'; g.lineWidth = 1; g.beginPath(); for (let i = 1; i < 7; i++) { const k = i / 7; g.moveTo(x + 20 - 6 * k, y + 2 - (hh * 0.8 + 2) * k); g.lineTo(x + 25 - 6 * k, y + 2 - (hh * 0.8 + 2) * k); } g.stroke();
        break;
      }
      case 'market': { // вывеска ждёт у кладки, флагшток с флагом
        g.save(); g.translate(x0 - 10, y + 2); g.rotate(-0.35); rr(g, -2, -12, 34, 9, 1.5, '#e8dec8'); g.strokeStyle = '#8a6a45'; g.lineWidth = 0.8; g.strokeRect(-1.5, -11.5, 33, 8);
        g.fillStyle = '#3a2618'; g.font = '700 5.5px "PT Sans", sans-serif'; g.textAlign = 'center'; g.fillText('ФАКТОРИЯ', 15, -5.5); g.restore();
        const fx = x1 + 6, fy = y - 40, wv = Math.sin(t * 4) * 1.5;
        line(g, '#3a2618', 1.6, fx, y + 2, fx, fy);
        g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(fx, fy + 1); g.quadraticCurveTo(fx + 6, fy + wv, fx + 12, fy + 3 + wv); g.lineTo(fx + 12, fy + 9 + wv); g.quadraticCurveTo(fx + 6, fy + 7, fx, fy + 9); g.fill();
        break;
      }
    }
  }

  // вертолётная площадка на мари: утоптанный квадрат, колья с флажками, «Н» из лапника
  function pad(g, b, env) {
    const x = b.x, y = b.y, w = 96, h = 70, k = b.done ? 1 : (b.prog || 0), t = env.now || 0;
    g.globalAlpha = 0.35 + 0.65 * k;
    g.fillStyle = '#dde6ee'; g.beginPath(); g.ellipse(x, y, w / 2 + 10, h / 2 + 8, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(147,172,196,0.35)';
    for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(x - w / 2 + 8 + i * 13, y + ((i * 37) % 11) - 5, 9, 3, 0.3, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    // «Н» из лапника появляется по мере стройки
    if (k > 0.35) {
      g.globalAlpha = Math.min(1, (k - 0.35) / 0.4);
      g.strokeStyle = '#214736'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath();
      g.moveTo(x - 16, y - 20); g.lineTo(x - 16, y + 20); g.moveTo(x + 16, y - 20); g.lineTo(x + 16, y + 20); g.moveTo(x - 16, y); g.lineTo(x + 16, y); g.stroke();
      g.strokeStyle = '#2f5a3a'; g.lineWidth = 3; g.stroke(); g.lineCap = 'butt';
      g.globalAlpha = 1;
    }
    // колья по углам с флажками
    const posts = [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]];
    posts.forEach(([dx, dy], i) => {
      if (k < (i + 1) / 5) return;
      const px = x + dx, py = y + dy;
      g.fillStyle = '#4b3220'; g.fillRect(px - 1.5, py - 22, 3, 22);
      const wv = Math.sin(t * 5 + i) * 2;
      g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(px + 1.5, py - 22); g.lineTo(px + 13, py - 18 + wv); g.lineTo(px + 1.5, py - 14); g.closePath(); g.fill();
    });
    if (!b.done) {
      rr(g, x - w / 2, y - h / 2 - 18, w, 5, 2.5, 'rgba(47,53,66,0.6)'); rr(g, x - w / 2, y - h / 2 - 18, w * k, 5, 2.5, '#ffd27a');
    }
  }
  function building(g, b, env) {
    env = E(env);
    const [w, h, ic] = dims(b.type), x = b.x, y = b.y + h / 2, t = env.now, lit = (env.night || 0) > 0.4;
    if (b.type === 'pad') return pad(g, b, env);
    shadow(g, x, y - 1, w * 0.62, 9, 0.32);
    if (!b.done) return construct(g, b, x, y, w, h, ic, env);
    const wh = h * 0.55, top = y - wh, rise = h * 0.55, ry = top - rise, x0 = x - w / 2, x1 = x + w / 2, sd = (b.x * 7 + b.y * 3) | 0;
    switch (b.type) {
      case 'balok': {
        // полозья
        g.lineCap = 'round'; g.strokeStyle = '#3a2618'; g.lineWidth = 3; g.beginPath();
        g.moveTo(x0 - 6, y - 1); g.lineTo(x1 + 4, y - 1); g.quadraticCurveTo(x1 + 11, y - 1, x1 + 10, y - 6); g.stroke();
        g.fillStyle = '#4b3220'; for (let i = 0; i < 4; i++) g.fillRect(x0 + 4 + i * (w - 10) / 3, y - 5, 3, 4);
        const tb = y - 4, tp = tb - wh;
        g.fillStyle = '#645240'; g.fillRect(x0, tp, w, wh);
        g.fillStyle = '#8f7e67'; g.fillRect(x0, tp, 4, wh);
        g.strokeStyle = 'rgba(58,38,24,0.35)'; g.lineWidth = 0.8; g.beginPath(); for (let xx = x0 + 6; xx < x1; xx += 5) { g.moveTo(xx, tp); g.lineTo(xx, tb); } g.stroke();
        g.fillStyle = '#473930'; g.fillRect(x0, tb - 3, w, 3);
        door(g, x0 + 10, tb, 10, wh - 3, '#76593a');
        rr(g, x0 + 3, tb, 14, 2.5, 1, '#5b3d27'); rr(g, x0 + 5, tb + 2.5, 10, 2.5, 1, '#4b3220');
        windowLit(g, x + w * 0.18, tp + wh * 0.42, 11, 8, lit, env);
        // покатая металлическая крыша
        roof(g, x, tp, w, rise * 0.9, ['#6c7178', '#3e4450'], sd, 0.9);
        chimney(g, x0 + w * 0.3, tp - rise * 0.5, 14, ['#6c7178', '#4e535d'], env, 0.9);
        if (lit) { g.globalCompositeOperation = 'lighter'; el(g, x0 + w * 0.3, tp - rise * 0.5 - 17, 2, 1.2, 'rgba(255,143,49,0.5)'); g.globalCompositeOperation = 'source-over'; }
        snowBank(g, x + 6, y + 1, w, sd);
        break;
      }
      case 'woodshed': {
        g.fillStyle = '#3a2618'; g.fillRect(x0, top - 4, w, wh + 3);
        g.strokeStyle = 'rgba(91,61,39,0.6)'; g.lineWidth = 0.8; g.beginPath(); for (let yy = top; yy < y; yy += 4) { g.moveTo(x0, yy); g.lineTo(x1, yy); } g.stroke();
        const st = b.stockWood !== undefined ? b.stockWood : 0, n = Math.min(24, Math.ceil(st / 2)), per = 8, rad = 2.9, sp = (w - 10) / per;
        g.fillStyle = '#4b3220'; g.beginPath();
        for (let i = 0; i < n; i++) { const cx0 = x0 + 5 + sp * ((i % per) + 0.5) + ((i / per | 0) % 2) * sp * 0.5 - (((i / per | 0) % 2) ? sp * 0.25 : 0), cy = y - 3 - (i / per | 0) * rad * 1.8; g.moveTo(cx0 + rad + 0.6, cy); g.ellipse(cx0, cy, rad + 0.6, rad + 0.4, 0, 0, TAU); } g.fill();
        g.fillStyle = '#c79a62'; g.beginPath();
        for (let i = 0; i < n; i++) { const cx0 = x0 + 5 + sp * ((i % per) + 0.5) + ((i / per | 0) % 2) * sp * 0.25, cy = y - 3 - (i / per | 0) * rad * 1.8; g.moveTo(cx0 + rad - 0.4, cy); g.ellipse(cx0 - 0.3, cy - 0.2, rad - 0.4, rad - 0.6, 0, 0, TAU); } g.fill();
        g.fillStyle = '#99764c'; g.beginPath();
        for (let i = 0; i < n; i++) { const cx0 = x0 + 5 + sp * ((i % per) + 0.5) + ((i / per | 0) % 2) * sp * 0.25, cy = y - 3 - (i / per | 0) * rad * 1.8; g.rect(cx0 - 0.8, cy - 0.8, 1.2, 1.2); } g.fill();
        g.fillStyle = '#4b3220'; g.fillRect(x0 - 1, top - 4, 4, wh + 4); g.fillRect(x1 - 3, top - 4, 4, wh + 4);
        g.fillStyle = '#67482f'; g.fillRect(x0 - 1, top - 4, 1.5, wh + 4); g.fillRect(x1 - 3, top - 4, 1.5, wh + 4);
        roof(g, x, top - 4, w, rise * 0.7, ['#4e3723', '#3a2618'], sd, 1);
        // колода с топором
        const bx = x1 + 12, by = y + 4;
        el(g, bx, by, 7, 2.6, '#4b3220'); g.fillStyle = '#5b3d27'; g.fillRect(bx - 6, by - 7, 12, 7); el(g, bx, by - 7, 6, 2.3, '#c79a62'); el(g, bx, by - 7, 2.5, 1, '#9a754e');
        g.lineCap = 'round'; line(g, '#8a6a45', 1.8, bx - 1, by - 8, bx - 8, by - 18); poly(g, '#6c7178', bx - 3, by - 7, bx + 3, by - 10, bx + 4, by - 6, bx, by - 5);
        g.fillStyle = '#cea977'; g.beginPath(); for (let i = 0; i < 4; i++) g.rect(bx - 12 + i * 5, by + 2 + (i % 2) * 2, 2.2, 1); g.fill();
        snowBank(g, x - w * 0.36, y + 1, w * 0.25, sd);
        break;
      }
      case 'smoke': {
        logs(g, x0, y, w, 4, wh / 4, LOG_GREY);
        g.fillStyle = '#352b25'; g.fillRect(x - 5, y - wh * 0.8, 10, wh * 0.8);
        if (lit) { g.fillStyle = 'rgba(255,106,26,0.8)'; g.fillRect(x - 5, y - 2.5, 10, 1.4); g.fillRect(x - 0.5, y - wh * 0.8, 1, wh * 0.8); env.glow(x, y - 4, 0.35); }
        roof(g, x, top, w, rise, ['#3a2618', '#3a2618'], sd, 0.7);
        wisp(g, x - w * 0.2, ry - 2, env, 0.8, 3, 1); wisp(g, x + w * 0.22, ry, env, 0.7, 3, 1);
        // вешала с рыбой
        const rx = x1 + 8, rw = 26;
        g.lineCap = 'round'; line(g, '#4b3220', 2, rx, y + 2, rx, y - 24); line(g, '#4b3220', 2, rx + rw, y + 2, rx + rw, y - 24); line(g, '#67482f', 1.8, rx - 2, y - 23, rx + rw + 2, y - 23);
        for (let i = 0; i < 4; i++) {
          const fx = rx + 4 + i * 6, a = Math.sin(t * 1.6 + i * 1.3) * 0.12 * (env.wind || 1);
          g.save(); g.translate(fx, y - 23); g.rotate(a);
          line(g, '#3a2618', 0.6, 0, 0, 0, 3);
          el(g, 0, 8, 1.9, 5.2, i % 2 ? '#b88e5b' : '#c2c9d0'); el(g, -0.6, 7, 0.7, 3.6, i % 2 ? '#c79a62' : '#f6f9fc');
          poly(g, i % 2 ? '#8a6a45' : '#a5acb3', 0, 12.5, -2, 15.5, 2, 15.5);
          g.restore();
        }
        el(g, rx + rw / 2, y - 24, rw / 2 + 3, 1.4, SNOW_HI);
        snowBank(g, x - 4, y + 1, w * 0.8, sd);
        break;
      }
      case 'labaz2': {
        g.drawImage(spr('labaz'), x - 40, y - 80, 80, 90);
        // правилка со шкуркой соболя
        const px = x1 + 12, py = y - 2;
        g.lineCap = 'round'; line(g, '#8a6a45', 1.6, px - 5, py, px, py - 22, px + 5, py);
        g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(px, py - 19); g.quadraticCurveTo(px + 4.5, py - 10, px + 3.2, py - 2); g.lineTo(px - 3.2, py - 2); g.quadraticCurveTo(px - 4.5, py - 10, px, py - 19); g.fill();
        el(g, px - 1, py - 11, 1.2, 5, 'rgba(145,108,69,0.6)'); el(g, px, py + 1, 7, 1.8, SNOW_HI);
        break;
      }
      case 'forge': {
        // каменная кладка
        g.fillStyle = '#4e535d'; g.fillRect(x0, top, w, wh);
        const r = rng(sd + 5);
        for (const col of ['#6d7279', '#3e4450']) { g.fillStyle = col; g.beginPath(); for (let i = 0; i < 12; i++) g.roundRect(x0 + r() * (w - 8), top + r() * (wh - 5), 5 + r() * 5, 3 + r() * 2.5, 1.5); g.fill(); }
        g.fillStyle = '#2f3542'; g.fillRect(x0, top, 3, wh); g.fillRect(x1 - 3, top, 3, wh);
        // горн
        const fl = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 5.3 + 1);
        rr(g, x - 10, y - wh * 0.78, 20, wh * 0.66, 3, '#352b25');
        rr(g, x - 7, y - wh * 0.5, 14, wh * 0.36, 2, '#ff6a1a');
        g.globalAlpha = fl; rr(g, x - 5, y - wh * 0.44, 10, wh * 0.2, 2, '#ffd27a'); g.globalAlpha = 1;
        // наковальня на чурбаке
        const ax = x1 + 9, ay = y + 3;
        g.fillStyle = '#5b3d27'; g.fillRect(ax - 4, ay - 7, 8, 7); el(g, ax, ay - 7, 4, 1.5, '#9a754e');
        poly(g, '#323138', ax - 7, ay - 12, ax + 8, ay - 12, ax + 5, ay - 9, ax - 3, ay - 9); poly(g, '#323138', ax - 7, ay - 12, ax - 10, ay - 11, ax - 5, ay - 10.5);
        g.fillStyle = '#6c7178'; g.fillRect(ax - 6, ay - 12.5, 13, 1);
        roof(g, x, top, w, rise * 0.85, ['#323138', '#313031'], sd, 0.6);
        // каменная труба с дымом и искрами
        const cx0 = x1 - 10, ch = 18;
        rr(g, cx0 - 5, ry + rise * 0.3 - ch, 10, ch, 1, '#5d626b'); g.fillStyle = '#3e4450'; g.fillRect(cx0 + 1, ry + rise * 0.3 - ch, 4, ch);
        g.fillStyle = '#6c7178'; g.beginPath(); for (let i = 0; i < 4; i++) g.rect(cx0 - 5, ry + rise * 0.3 - ch + i * 4.5, 10, 0.8); g.fill();
        wisp(g, cx0, ry + rise * 0.3 - ch - 3, env, 1, 4, 1);
        if (env.night > 0.3) g.globalCompositeOperation = 'lighter'; g.fillStyle = '#ffb347'; g.beginPath();
        for (let i = 0; i < 3; i++) { const p = (t * 1.4 + i / 3) % 1; g.rect(cx0 + Math.sin(t * 7 + i * 2) * 3 + p * 6, ry + rise * 0.3 - ch - 4 - p * 22, 1.6, 1.6); } g.fill();
        g.globalCompositeOperation = 'source-over';
        env.light(x, y - 6, 130, 'w', 0.85); env.glow(x, y - wh * 0.35, 0.6);
        snowBank(g, x - w * 0.3, y + 1, w * 0.3, sd); snowBank(g, x + w * 0.32, y + 1, w * 0.26, sd + 9);
        break;
      }
      case 'tower': {
        const pt = y - 72, dp = 12, fx = 13, bx = 10;
        g.lineCap = 'round';
        line(g, '#4b3220', 3, x - bx - 2, y - dp, x - bx + 1, pt - dp); line(g, '#4b3220', 3, x + bx + 2, y - dp, x + bx - 1, pt - dp);
        line(g, '#67482f', 4, x - fx - 3, y, x - fx + 1, pt); line(g, '#67482f', 4, x + fx + 3, y, x + fx - 1, pt);
        line(g, '#8a6a45', 1.3, x - fx - 3.4, y - 1, x - fx + 0.4, pt + 1); line(g, '#8a6a45', 1.3, x + fx + 1.6, y - 1, x + fx - 2.2, pt + 1);
        g.strokeStyle = '#5b3d27'; g.lineWidth = 2.2; g.beginPath();
        for (const [ya, yb2] of [[y - 4, pt + 36], [pt + 36, pt + 4]]) { const ka = (y - ya) / (y - pt), kb = (y - yb2) / (y - pt); g.moveTo(x - fx - 3 + 4 * ka, ya); g.lineTo(x + fx + 3 - 4 * kb, yb2); g.moveTo(x + fx + 3 - 4 * ka, ya); g.lineTo(x - fx - 3 + 4 * kb, yb2); }
        g.moveTo(x - fx - 2, pt + 36); g.lineTo(x + fx + 2, pt + 36); g.stroke();
        el(g, x - fx - 3, y, 4, 1.4, SNOW_HI); el(g, x + fx + 3, y, 4, 1.4, SNOW_HI);
        // настил
        g.fillStyle = '#5b3d27'; g.fillRect(x - 18, pt - dp, 36, dp + 3);
        g.fillStyle = '#765436'; g.beginPath(); for (let i = 0; i < 4; i++) g.rect(x - 18, pt - dp + i * 3.4, 36, 2.2); g.fill();
        g.fillStyle = '#3a2618'; g.fillRect(x - 18, pt + 1, 36, 3);
        line(g, '#67482f', 1.5, x - 17, pt - dp, x - 17, pt - dp - 8, x + 17, pt - dp - 8, x + 17, pt - dp);
        // жаровня
        const lt = (b.fuel || 0) > 0;
        el(g, x, pt - 5, 9, 3.2, '#323138'); g.fillStyle = '#2f3542'; g.fillRect(x - 8, pt - 8, 16, 3); el(g, x, pt - 8, 8, 2.6, lt ? '#ff6a1a' : '#4e535d');
        if (lt) {
          flame(g, x, pt - 8, 0.8, t + x * 0.01, env.wind);
          wisp(g, x, pt - 34, env, 1.1, 4, 1);
          env.light(x, pt + 10, 300, 'w', 1); env.glow(x, pt - 14, 1);
        } else el(g, x - 1, pt - 9, 6, 1.8, SNOW_HI);
        // передние перила и снег
        line(g, '#8a6a45', 1.8, x - 18, pt + 2, x - 18, pt - 8, x + 18, pt - 8, x + 18, pt + 2);
        rr(g, x - 19, pt - 9.6, 38, 2, 1, SNOW_HI);
        g.fillStyle = SNOW_HI; g.fillRect(x - 18, pt - dp - 1, 10, 2.5); g.fillRect(x + 8, pt - dp - 1, 10, 2.5);
        // лестница
        line(g, '#765436', 1.6, x + 20, y + 3, x + 12, pt + 3); line(g, '#765436', 1.6, x + 26, y + 3, x + 18, pt + 3);
        g.strokeStyle = '#8a6a45'; g.lineWidth = 1.2; g.beginPath(); for (let i = 1; i < 10; i++) { const k = i / 10; g.moveTo(x + 20 - 8 * k, y + 3 - (y - pt) * k); g.lineTo(x + 26 - 8 * k, y + 3 - (y - pt) * k); } g.stroke();
        break;
      }
      case 'market': {
        logs(g, x0, y, w, 6, wh / 6);
        // ящики и бочка
        const cr = (cx0, cy, s) => { g.fillStyle = '#8a6a45'; g.fillRect(cx0 - s / 2, cy - s, s, s); g.strokeStyle = '#62482f'; g.lineWidth = 0.8; g.strokeRect(cx0 - s / 2 + 0.5, cy - s + 0.5, s - 1, s - 1); g.beginPath(); g.moveTo(cx0 - s / 2, cy - s); g.lineTo(cx0 + s / 2, cy); g.stroke(); rr(g, cx0 - s / 2 - 0.5, cy - s - 1.5, s + 1, 2.2, 1, SNOW_HI); };
        windowLit(g, x - w * 0.3, top + wh * 0.42, 11, 9, lit, env);
        windowLit(g, x + w * 0.3, top + wh * 0.42, 11, 9, lit, env);
        door(g, x, y, 12, wh * 0.78);
        // навес над крыльцом
        line(g, '#4b3220', 1.8, x - 12, y + 2, x - 12, top + 3); line(g, '#4b3220', 1.8, x + 12, y + 2, x + 12, top + 3);
        roof(g, x, top, w, rise, ['#4e3723', '#3a2618'], sd, 1);
        rr(g, x - 16, top - 5, 32, 7, 1, '#3a2618'); rr(g, x - 15, top - 4.5, 30, 6, 1, '#67482f');
        g.fillStyle = SNOW_HI; g.fillRect(x - 16, top - 6, 32, 1.8);
        // вывеска
        rr(g, x - 25, ry - 1, 50, 10, 1.5, '#e8dec8'); g.strokeStyle = '#8a6a45'; g.lineWidth = 1; g.strokeRect(x - 24.5, ry - 0.5, 49, 9);
        g.fillStyle = '#3a2618'; g.font = '700 7px "PT Sans", sans-serif'; g.textAlign = 'center'; g.fillText('ФАКТОРИЯ', x, ry + 6.6);
        chimney(g, x - w * 0.28, ry + rise * 0.25, 12, ['#6c7178', '#4e535d'], env, 0.9);
        cr(x0 + 6, y + 4, 9); cr(x0 + 14, y + 6, 8); cr(x0 + 9, y - 5, 7);
        g.fillStyle = '#62482f'; g.fillRect(x1 - 12, y - 7, 9, 11); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x1 - 12, y - 4, 9, 1); g.fillRect(x1 - 12, y + 1, 9, 1); el(g, x1 - 7.5, y - 7, 4.5, 1.6, SNOW_HI);
        // флаг
        const fx = x1 + 7, fy = ry - 12, wv = Math.sin(t * 4) * 2, wv2 = Math.sin(t * 4 - 1.2) * 2;
        line(g, '#3a2618', 1.8, fx, y + 2, fx, fy); el(g, fx, fy, 1.5, 1.5, '#cea977');
        g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(fx, fy + 1); g.quadraticCurveTo(fx + 7, fy - 1 + wv, fx + 16, fy + 3 + wv2); g.lineTo(fx + 16, fy + 11 + wv2); g.quadraticCurveTo(fx + 7, fy + 9 + wv, fx, fy + 11); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(fx + 8, fy + wv * 0.8 + 1); g.quadraticCurveTo(fx + 12, fy + 5 + wv2, fx + 16, fy + 3 + wv2); g.lineTo(fx + 16, fy + 11 + wv2); g.quadraticCurveTo(fx + 12, fy + 9 + wv, fx + 8, fy + 9 + wv); g.fill();
        // фонарь у двери
        rr(g, x + 9, y - wh * 0.72, 4, 5, 1, lit ? '#ffd27a' : '#2f3542');
        if (lit) { env.glow(x + 11, y - wh * 0.7, 0.4); env.light(x + 11, y + 6, 80, 'w', 0.7); }
        snowBank(g, x + w * 0.3, y + 1, w * 0.3, sd);
        break;
      }
    }
  }

  // ================= ЧАСТИЦЫ =================
  // свой поток случайности для частиц (FX): не тратит Math.random игры → не сдвигает мир/ИИ
  const FXR = rng(0xF1C5), rnd = (a, b) => a + FXR() * (b - a);
  // «bit» — баллистика в своих координатах (vx=vy=0 для общего апдейтера игры): падает на землю и лежит
  function bit(parts, x, y, kind, c, sp, up, life, sz) {
    const a = FXR() * TAU, v = rnd(0.3, 1) * sp;
    parts.push({ type: 'bit', kind, c, x, y, vx: 0, vy: 0, ux: Math.cos(a) * v, uy: Math.sin(a) * v * 0.5, uz: rnd(0.5, 1) * up, gz: 420, sz, rot: FXR() * TAU, spin: rnd(-14, 14), life, max: life });
  }
  const fx = {
    snowPuff(parts, x, y, n = 1) {
      for (let i = 0; i < 4 + 2 * n; i++) parts.push({ type: 'puff', x: x + rnd(-8, 8), y: y + rnd(-4, 2), vx: rnd(-18, 18), vy: rnd(-16, -4), r0: rnd(4, 6), r1: rnd(13, 20) * (0.8 + 0.2 * n), life: rnd(0.55, 0.9), max: 0.9 });
      for (let i = 0; i < 8; i++) bit(parts, x, y, 'snow', i % 2 ? '#f6f9fc' : '#dde6ee', 70, 110, rnd(0.6, 1), rnd(1.4, 2.6));
    },
    chips(parts, x, y) {
      const C = ['#eacd9a', '#c79a62', '#8a6a45', '#e3d5b6'];
      for (let i = 0; i < 9; i++) bit(parts, x, y - 10, 'chip', C[i % 4], 110, 150, rnd(1.6, 2.6), rnd(1.6, 3.4));
      for (let i = 0; i < 4; i++) bit(parts, x, y - 4, 'snow', '#f6f9fc', 50, 70, rnd(0.5, 0.8), rnd(1.2, 2));
      parts.push({ type: 'puff', x, y, vx: 0, vy: -6, r0: 3, r1: 10, life: 0.5, max: 0.5 });
    },
    blood(parts, x, y, decals) {
      const C = ['#9a2f25', '#b8392d', '#7c241c'];
      for (let i = 0; i < 11; i++) bit(parts, x, y - 8, 'blood', C[i % 3], 80, 110, rnd(2.5, 4), rnd(1, 2.2));
      const d = { x, y, k: 'blood', life: 90, max: 90, seed: (FXR() * 1e6) | 0 };
      if (decals) decals.push(d);
      return d;
    },
    splash(parts, x, y) {
      for (let i = 0; i < 12; i++) bit(parts, x, y, 'water', i % 3 ? '#dde6ee' : '#b6c9df', 55, 170, rnd(0.6, 0.9), rnd(1, 2));
      for (let i = 0; i < 3; i++) bit(parts, x, y, 'ice', '#dde6ee', 45, 110, rnd(1, 1.6), rnd(1.6, 2.6));
      parts.push({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.7, max: 0.7 });
      parts.push({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, r: 0.6 });
    },
    embers(parts, x, y, n = 8) {
      for (let i = 0; i < n; i++) parts.push({ type: 'ember', x: x + rnd(-8, 8), y: y + rnd(-6, 2), vx: 0, vy: 0, ux: rnd(-10, 10), uz: rnd(25, 55), ph: FXR() * TAU, wob: rnd(3, 9), life: rnd(0.8, 1.6), max: 1.6 });
    },
    // снег осыпается с кроны: хлопья с высоты кроны + облачка; power 0..1 (удар, задел, порыв)
    branchSnow(parts, t, power = 1) {
      if (!t) return;
      const s = t.s || 1, sap = t.stage === 1, kf = sap ? 0.4 : t.kind === 1 ? 0.5 : t.kind === 3 ? 0.3 : t.kind === 2 ? 1.1 : 1;
      const H = (sap ? 34 : t.kind === 1 ? 95 : t.kind === 2 ? 92 : 112) * s, L = typeof window !== 'undefined' && window.QUALITY === 'low';
      const n = Math.round((3 + 9 * power) * kf * (L ? 0.5 : 1));
      for (let i = 0; i < n; i++) {
        const u = rnd(0.3, 0.92), hw = ((t.kind === 2 ? 34 : 26) * (1 - u) + 4) * s, a = FXR() * TAU, v = rnd(4, 22);
        parts.push({ type: 'bit', kind: 'snow', c: i % 3 ? '#f6f9fc' : '#dde6ee', x: t.x + rnd(-hw, hw), y: t.y + rnd(1, 5), vx: 0, vy: 0,
          ux: Math.cos(a) * v, uy: Math.sin(a) * v * 0.4, uz: rnd(0, 18), gz: rnd(130, 220), z0: u * H, sz: rnd(1.1, 2.3), rot: 0, spin: 0, life: rnd(1.9, 2.6), max: 2.6 });
      }
      for (let i = 0, m = Math.round((1 + 2 * power) * Math.min(1, kf) * (L ? 0.5 : 1)); i < m; i++) {
        parts.push({ type: 'puff', x: t.x + rnd(-10, 10) * s, y: t.y + rnd(1, 4), h: rnd(0.35, 0.8) * H, vx: rnd(-8, 8), vy: 0, r0: rnd(4, 6), r1: rnd(11, 17) * (0.7 + 0.3 * power), life: rnd(0.7, 1.1), max: 1.1 });
      }
    },
    // ветки с обрубленной кроны: зелёные лапки и щепа летят от ствола; z — с высоты кроны
    twigs(parts, x, y, z, s = 1) {
      const n = typeof window !== 'undefined' && window.QUALITY === 'low' ? 3 : 7;
      for (let i = 0; i < n; i++) { const a = FXR() * TAU, v = rnd(25, 75);
        parts.push({ type: 'bit', kind: 'chip', c: i % 3 ? (i % 2 ? '#2f5a3a' : '#244a31') : '#5b3d27', x, y, vx: 0, vy: 0, ux: Math.cos(a) * v, uy: Math.sin(a) * v * 0.5, uz: rnd(30, 90), gz: 300, z0: z * rnd(0.4, 1), sz: rnd(2.2, 3.6) * s, rot: FXR() * TAU, spin: rnd(-10, 10), life: rnd(2.5, 3.5), max: 3.5 }); }
    },
    smoke(parts, x, y, big) {
      for (let i = 0; i < (big ? 3 : 1); i++) parts.push({ type: 'smoke', x: x + rnd(-4, 4), y: y + rnd(-3, 3), vx: rnd(-6, 6), vy: rnd(-32, -18) * (big ? 1.3 : 1), life: big ? 3.5 : 2.6, max: big ? 3.5 : 2.6, big: big ? 1 : 0, sd: FXR() });
    },
  };

  function drawParticle(g, q, env) {
    env = E(env);
    const a = clamp(q.life / q.max, 0, 1), el0 = q.max - q.life;
    switch (q.type) {
      case 'dot': g.globalAlpha = a; el(g, q.x, q.y, 2, 2, q.color || '#f6f9fc'); break;
      case 'smoke': {
        const big = q.big ? 1.8 : 1, r = (7 + (1 - a) * 15) * big, sd = q.sd || 0;
        // сильный снос (пурга) вытягивает клуб по ветру вместо симметричного пятна
        const wx = (q.vx || 0) + (q.wx || 0), str = 1 + Math.min(1.5, Math.abs(wx) / 45), dx = Math.sign(wx) * r * (str - 1) * 0.6;
        g.globalAlpha = a * (q.big ? 0.55 : 0.42) * Math.min(1, el0 * 4);
        g.drawImage(SMK(), q.x - r * str + dx, q.y - r * 0.85, r * 2 * str, r * 1.7);
        g.globalAlpha *= 0.5; g.drawImage(PUFF(), q.x - r * 0.7 - 2 + sd * 3 + dx, q.y - r * 0.8, r * 1.2, r * 1.1);
        break;
      }
      case 'steam': // пар над открытой водой (полынья): тот же мягкий клуб, крупнее и прозрачнее, растёт, поднимаясь
      case 'breath': {
        const S = q.type === 'steam' ? 2.6 : 1; g.globalAlpha = a * (S > 1 ? 0.42 * Math.min(1, (1 - a) * 5) : 0.5); const r = (2 + (1 - a) * 8) * S;
        const wx = (q.vx || 0) + (S > 1 ? q.wx || 0 : 0), str = 1 + Math.min(1.2, Math.abs(wx) / 40), dx = Math.sign(wx) * r * (str - 1) * 0.5;
        g.drawImage(PUFF(), q.x - r * str + dx, q.y - r, r * 2 * str, r * 2);
        if (S > 1) { g.globalAlpha *= 0.55; g.drawImage(SMK(), q.x - r * str + dx, q.y - r * 0.9, r * 2 * str, r * 1.8); } // пар читается и на светлом льду — лёгкой серой дымкой
        break;
      }
      case 'spark': { // слой glow: рисуется после карты света режимом 'lighter' (его ставит рендер)
        g.globalAlpha = a * 0.5; g.drawImage(HALO(), q.x - 4, q.y - 4, 8, 8);
        g.globalAlpha = a; g.fillStyle = a > 0.5 ? '#ffd27a' : '#ff6a1a'; g.fillRect(q.x - 1, q.y - 1, 2, 2);
        break;
      }
      case 'text': {
        g.globalAlpha = Math.min(1, a * 2); g.textAlign = 'center'; g.font = '600 15px "PT Sans", sans-serif';
        const uk = typeof GFX !== 'undefined' && GFX.uiK ? GFX.uiK() : 1; // на большом зуме — экранного размера
        if (uk !== 1) { g.save(); g.translate(q.x, q.y); g.scale(uk, uk); g.translate(-q.x, -q.y); }
        g.fillStyle = '#fff'; Icons.text(g, q.text, q.x, q.y, 16, { stroke: 'rgba(10,20,30,0.75)', lw: 3 });
        if (uk !== 1) g.restore(); break;
      }
      case 'puff': {
        const r = q.r0 + (q.r1 - q.r0) * (1 - a * a), hz = q.h ? q.h * a : 0; // h — облачко в кроне, оседает к земле
        if (!hz) { g.globalAlpha = a * 0.35; g.drawImage(SHD(), q.x - r * 0.8 + 2, q.y - r * 0.4 + 2, r * 1.6, r * 1.1); }
        g.globalAlpha = a * (q.h ? 0.8 : 1); g.drawImage(SPUFF(), q.x - r, q.y - hz - r * 0.8, r * 2, r * 1.6); break;
      }
      case 'bit': {
        // z0 — старт с высоты (снег с кроны): время до земли из z0 + uz·t − g·t²/2 = 0
        const z0 = q.z0 || 0, T = z0 ? (q.uz + Math.sqrt(q.uz * q.uz + 2 * q.gz * z0)) / q.gz : 2 * q.uz / q.gz, tt = Math.min(el0, T), landed = el0 >= T;
        const drag = 1 - Math.exp(-tt * 3), px = q.x + q.ux * drag / 3, py = q.y + q.uy * drag / 3, z = Math.max(0, z0 + q.uz * tt - 0.5 * q.gz * tt * tt);
        const fade = Math.min(1, a * 3), s = q.sz;
        g.globalAlpha = fade;
        if (q.kind === 'chip') {
          if (!landed) { g.globalAlpha = fade * 0.25; el(g, px, py, s, s * 0.4, '#27394a'); g.globalAlpha = fade; }
          g.save(); g.translate(px, py - z); g.rotate(landed ? q.rot + q.spin * T : q.rot + q.spin * tt);
          g.fillStyle = q.c; g.fillRect(-s, -s * 0.35, s * 2, s * 0.7); g.fillStyle = 'rgba(58,38,24,0.5)'; g.fillRect(-s, s * 0.1, s * 2, s * 0.25);
          g.restore();
        } else if (q.kind === 'blood') {
          if (landed) { el(g, px, py, s * 1.6, s * 0.8, q.c, q.rot); }
          else el(g, px, py - z, s * 0.8, s, q.c);
        } else if (q.kind === 'water') {
          if (!landed) { el(g, px, py - z, s * 0.7, s, q.c); }
          else { g.globalAlpha = fade * 0.5; el(g, px, py, s * 1.4, s * 0.6, '#b6c9df'); }
        } else if (q.kind === 'ice') {
          g.save(); g.translate(px, py - z); g.rotate(q.rot + q.spin * tt * 0.4);
          poly(g, q.c, 0, -s, s * 0.6, 0, 0, s, -s * 0.6, 0); poly(g, '#93acc4', 0, 0, s * 0.6, 0, 0, s); g.strokeStyle = 'rgba(111,142,168,0.8)'; g.lineWidth = 0.6; g.stroke();
          g.restore();
        } else { // snow
          if (landed) { g.globalAlpha = fade * 0.8; }
          el(g, px, py - z, s, s * 0.8, q.c); if (!landed) { g.globalAlpha = fade * 0.5; el(g, px + s * 0.3, py - z + s * 0.4, s * 0.7, s * 0.4, '#b6c9df'); }
        }
        break;
      }
      case 'ring': {
        const k = 1 - a, R = (q.r || 1) * (5 + k * 16);
        g.globalAlpha = a * 0.8; g.strokeStyle = '#dde6ee'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(q.x, q.y, R, R * 0.42, 0, 0, TAU); g.stroke();
        break;
      }
      case 'ember': {
        const px = q.x + q.ux * el0 + Math.sin(el0 * 5 + q.ph) * q.wob, py = q.y - q.uz * el0 + 18 * el0 * el0 * 0.3;
        const fl = 0.6 + 0.4 * Math.sin(env.now * 25 + q.ph * 5);
        g.globalAlpha = a * (env.night > 0.3 ? 0.6 : 0.35) * fl; g.drawImage(HALO(), px - 5, py - 5, 10, 10);
        g.globalAlpha = a; g.fillStyle = a > 0.6 ? '#ffd27a' : a > 0.3 ? '#ffb347' : '#ff6a1a'; g.fillRect(px - 0.9, py - 0.9, 1.8, 1.8);
        break;
      }
    }
    g.globalAlpha = 1;
  }

  // ================= ПЯТНА НА СНЕГУ =================
  function decal(g, d) {
    const a = clamp(d.life / (d.fade || 10), 0, 1), r = rng(d.seed || ((d.x * 7 + d.y * 13) | 0)), x = d.x, y = d.y;
    if (a <= 0) return;
    g.globalAlpha = a;
    if (d.k === 'blood') {
      el(g, x + 1, y + 1, 13, 5.5, 'rgba(200,105,97,0.22)');
      g.fillStyle = '#9a2f25'; g.beginPath();
      g.moveTo(x + 7, y); g.ellipse(x, y, 7, 3.2, 0.2, 0, TAU);
      for (let i = 0; i < 8; i++) { const an = r() * TAU, dd = 6 + r() * 11, rr0 = 0.8 + r() * 2; g.moveTo(x + Math.cos(an) * dd + rr0, y + Math.sin(an) * dd * 0.45); g.ellipse(x + Math.cos(an) * dd, y + Math.sin(an) * dd * 0.45, rr0, rr0 * 0.6, 0, 0, TAU); }
      g.fill();
      el(g, x - 1.5, y - 0.8, 3.5, 1.3, '#b8392d');
    } else if (d.k === 'ash' || d.k === 'fire') {
      el(g, x, y, 24, 10, 'rgba(111,142,168,0.3)');
      el(g, x, y, 16, 6.5, '#605e60'); el(g, x + 1, y + 0.5, 10, 4, '#352e2d');
      g.fillStyle = '#18120e'; g.beginPath();
      for (let i = 0; i < 3; i++) { const an = r() * Math.PI; g.moveTo(x - Math.cos(an) * 9, y - Math.sin(an) * 3.5); g.lineTo(x + Math.cos(an) * 9, y + Math.sin(an) * 3.5); g.lineTo(x + Math.cos(an) * 9, y + Math.sin(an) * 3.5 + 2); g.lineTo(x - Math.cos(an) * 9, y - Math.sin(an) * 3.5 + 2); } g.fill();
      g.fillStyle = '#93979f'; g.beginPath(); g.ellipse(x - 3, y - 1, 4, 1.4, 0, 0, TAU); g.ellipse(x + 5, y + 1, 3, 1, 0, 0, TAU); g.fill();
    } else if (d.k === 'trample') {
      el(g, x, y, 22, 10, 'rgba(164,186,209,0.22)');
      g.fillStyle = 'rgba(111,142,168,0.28)'; g.beginPath();
      for (let i = 0; i < 9; i++) { const px = x + (r() - 0.5) * 34, py = y + (r() - 0.5) * 14, an = r() * TAU; g.moveTo(px + 3, py); g.ellipse(px, py, 3, 1.8, an, 0, TAU); } g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath();
      for (let i = 0; i < 5; i++) { const px = x + (r() - 0.5) * 30, py = y + (r() - 0.5) * 12; g.moveTo(px + 2, py); g.ellipse(px, py - 1, 2, 0.8, 0, 0, TAU); } g.fill();
    }
    g.globalAlpha = 1;
  }

  // ================= СЛЕДЫ =================
  // f = {x,y,a,k,life}; a — направление движения; затухание как в игре (life 25 → 0)
  // неровная вмятина: рваный овал (9 узлов со случайным радиусом), глубина по краю — тёмный верхне-левый скат, светлое дно, светлый рант снизу-справа
  function dent(g, r, x, y, rx, ry, rot, al, jit) {
    const n = 9, ph = r() * TAU, pts = [];
    for (let i = 0; i < n; i++) { const an = ph + i / n * TAU, k = 1 + (r() - 0.5) * (jit || 0.5); pts.push([Math.cos(an) * rx * k, Math.sin(an) * ry * k]); }
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const path = (ox, oy, sc) => {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], mx = (ax + bx) / 2 * sc + ox, my = (ay + by) / 2 * sc + oy;
        const px = x + mx * cr - my * sr, py = y + mx * sr + my * cr;
        if (i === 0) { const [zx, zy] = pts[n - 1], lx = (zx + ax) / 2 * sc + ox, ly = (zy + ay) / 2 * sc + oy; g.moveTo(x + lx * cr - ly * sr, y + lx * sr + ly * cr); }
        const cx0 = ax * sc + ox, cy0 = ay * sc + oy; g.quadraticCurveTo(x + cx0 * cr - cy0 * sr, y + cx0 * sr + cy0 * cr, px, py);
      }
      g.closePath();
    };
    g.fillStyle = `rgba(255,255,255,${al * 0.9})`; path(0.7, 0.8, 1.06); g.fill();       // светлый рант с солнечной стороны
    g.fillStyle = `rgba(96,126,160,${al})`; path(0, 0, 1); g.fill();                        // стенка
    g.fillStyle = `rgba(58,80,128,${al * 0.7})`; path(-0.35, -0.4, 0.8); g.fill();          // тёмный скат у дальнего края
    g.fillStyle = `rgba(218,229,240,${al * 0.9})`; path(0.55, 0.6, 0.55); g.fill();         // утоптанное светлое дно
  }
  // след покадровый и их сотни — рваная форма печётся один раз в спрайт (6 вариантов на вид), в кадре — один drawImage
  // с поворотом, разбросом размера и затуханием через globalAlpha
  const PRW = 28, PRH = 20, PRV = 6;
  function printBody(g, k, r) {
    const al = 0.62;
    const a2 = al * (0.8 + r() * 0.4), sh = `rgba(60,80,130,${al * 0.9})`;
    const crumbs = n => { g.fillStyle = `rgba(246,249,252,${al * 0.9})`; g.beginPath(); for (let i = 0; i < n; i++) { const px = (r() - 0.5) * 12, py = (r() - 0.5) * 8; g.moveTo(px + 0.7, py); g.ellipse(px, py, 0.7, 0.4, r() * 3, 0, TAU); } g.fill(); };
    switch (k) {
      case 'p': // валенок: пятка и носок раздельно, носок шире; края рваные, комочки снега
        dent(g, r, -2.4, 0, 2.5, 2.1, 0, a2, 0.55);
        dent(g, r, 1.6, 0.1, 3.5, 2.6, (r() - 0.5) * 0.2, a2, 0.6);
        g.fillStyle = `rgba(218,229,240,${a2 * 0.8})`; g.fillRect(-0.9, -0.9, 1.3, 1.8); // перемычка подъёма
        crumbs(3 + (r() * 3 | 0));
        break;
      case 'w': { // волк: пятка + 4 пальца + когти, разной глубины
        dent(g, r, -2, 0, 2.2, 2.5, 0, a2, 0.5);
        for (const [px, py] of [[2, -2.2], [2.6, 2.2], [3.8, -0.8], [3.8, 0.9]]) if (r() < 0.93) dent(g, r, px + (r() - 0.5) * 0.5, py, 1.2, 1, 0, a2 * (0.75 + r() * 0.3), 0.5);
        g.fillStyle = sh; g.fillRect(5, -1.1, 1, 0.7); g.fillRect(5, 0.7, 1, 0.7);
        crumbs(2);
        break;
      }
      case 'h': { // заяц: длинные задние впереди, передние гуськом позади
        dent(g, r, 5.5, -2.4, 3.1, 1.4, 0, a2, 0.4); dent(g, r, 5.5, 2.4, 3.1, 1.4, 0, a2, 0.4);
        dent(g, r, 0, 0.3, 1.3, 1.1, 0, a2, 0.5); dent(g, r, -4, -0.3, 1.3, 1.1, 0, a2, 0.5);
        crumbs(3);
        break;
      }
      case 'b': { // медведь: широкая подушка + 5 пальцев + когти
        dent(g, r, -1, 0, 6, 4.8, 0, a2, 0.35);
        for (let i = 0; i < 5; i++) { const py = -4.4 + i * 2.2, px = 6.5 - Math.abs(i - 2) * 0.8; dent(g, r, px, py, 1.4, 1.2, 0, a2, 0.5); }
        g.strokeStyle = sh; g.lineWidth = 0.8; g.beginPath(); for (let i = 0; i < 5; i++) { const py = -4.4 + i * 2.2, px = 8 - Math.abs(i - 2) * 0.8; g.moveTo(px, py); g.lineTo(px + 2.2, py); } g.stroke();
        crumbs(5);
        break;
      }
      case 'd': { // олень: раздвоенное копыто + прибылые пальцы
        dent(g, r, 1.4, -1.7, 3.7, 1.6, 0.12, a2, 0.4); dent(g, r, 1.4, 1.7, 3.7, 1.6, -0.12, a2, 0.4);
        if (r() < 0.8) { dent(g, r, -4.2, -3.2, 1, 0.8, 0, a2, 0.4); dent(g, r, -4.2, 3.2, 1, 0.8, 0, a2, 0.4); }
        crumbs(3);
        break;
      }
      case 's': // полозья нарт: две колеи с неровным краем
        for (const y0 of [-4.9, 4.3]) {
          g.fillStyle = `rgba(255,255,255,${al * 1.1})`; g.fillRect(-9, y0 + 1.1, 18, 0.9);
          g.fillStyle = `rgba(96,126,160,${al})`; g.beginPath(); g.moveTo(-9, y0);
          for (let i = 1; i <= 6; i++) g.lineTo(-9 + i * 3, y0 + (r() - 0.5) * 0.7); g.lineTo(9, y0 + 1.6); g.lineTo(-9, y0 + 1.6); g.fill();
          g.fillStyle = `rgba(58,80,128,${al * 0.6})`; g.fillRect(-9, y0, 18, 0.6);
        }
        break;
    }
  }
  function print(g, f) {
    const lk = Math.min(1, f.life / 8);
    if (0.62 * lk <= 0.01) return;
    const r = rng(((f.x * 73.7 + f.y * 191.3) | 0) ^ 0x5bd1e995);
    const sz = (0.88 + r() * 0.26) * (f.d && f.d !== 1 ? f.d : 1), jr = (r() - 0.5) * 0.22, vi = (r() * PRV) | 0, k = f.k;
    const S = sprite('print' + k + vi, PRW, PRH, gg => { gg.translate(PRW / 2, PRH / 2); printBody(gg, k, rng(0x51ed + vi * 7919 + k.charCodeAt(0) * 131)); });
    const c = Math.cos(f.a), s = Math.sin(f.a), ga = g.globalAlpha;
    g.save(); g.transform(c, s, -s, c, f.x, f.y); g.rotate(jr); g.scale(sz, sz); // сугроб: след глубже и шире
    g.globalAlpha = ga * lk; g.drawImage(S, -PRW / 2, -PRH / 2, PRW, PRH);
    g.restore();
  }

  // ================= ИЗБА-ЗИМОВЬЕ =================
  // H = { x, y — центр избы (HUT); in — внутренний прямоугольник (HUT_IN), wall, doorW;
  //       walls, door, bench, damper, radio, fuel, open, cut (0 снаружи … 1 внутри) }
  // Геометрия 3/4: высота h уходит на экране вверх на h. Стены 44, скат 50 над серединой.
  const HW = 44, HRISE = 56, HOV = 8, HOV_S = 16;
  const HLOG = { hi: '#9a754e', mid: '#765436', dk: '#4b3220', sh: '#3a2618' };
  const HLOG_IN = { hi: '#8a6a45', mid: '#5b3d27', dk: '#3a2618', sh: '#3a2618' };
  const hsc = () => DPR() * (ZB > 1.6 ? ZB : 1.5); // изба крупная и близко: ×1.5 до ступени 1.6, дальше — ступень зума
  function hg(H) {
    const X0 = H.in.x0 - H.x - H.wall, X1 = H.in.x1 - H.x + H.wall, Yn = H.in.y0 - H.y - H.wall, Ys = H.in.y1 - H.y + H.wall;
    const hw = (X1 - X0) / 2, s = HRISE / hw, L = X0 - HOV_S, R = X1 + HOV_S, ze = HW - HOV_S * s;
    // экранная y = мировая y − высота; zAt — экранная y поверхности ската над точкой пола
    return { X0, X1, Yn, Ys, s, L, R, yA: Ys + HOV - HW - HRISE, yEc: Ys + HOV - ze, yB: Yn - HOV - HW - HRISE, yBc: Yn - HOV - ze, yG: Ys - HW - HRISE,
      zAt: (x, y) => y - (HW + HRISE * (1 - Math.abs(x) / hw)), mast: { x: 16, y: Yn - HW - HRISE * 0.86 - 78 },
      ix0: H.in.x0 - H.x, ix1: H.in.x1 - H.x, iy0: H.in.y0 - H.y, iy1: H.in.y1 - H.y };
  }
  // бревно-венец: скруглённый, со светлым верхом, корой и тёмным низом
  function logRow(g, x0, x1, y, lh, P, r) {
    g.fillStyle = lg(g, 0, y, 0, y + lh, [[0, P.hi], [0.3, P.mid], [0.8, P.dk], [1, P.sh]]);
    g.beginPath(); g.roundRect(x0, y, x1 - x0, lh, lh / 2); g.fill();
    g.strokeStyle = 'rgba(58,38,24,0.35)'; g.lineWidth = 0.6; g.beginPath();
    for (let k = 0; k < (x1 - x0) / 9; k++) { const xx = x0 + 4 + r() * (x1 - x0 - 8), yy = y + lh * (0.35 + r() * 0.4); g.moveTo(xx, yy); g.lineTo(xx + 3 + r() * 6, yy + (r() - 0.5) * 0.8); }
    g.stroke();
    g.strokeStyle = 'rgba(251,230,187,0.18)'; g.beginPath(); g.moveTo(x0 + lh / 2, y + 1); g.lineTo(x1 - lh / 2, y + 1); g.stroke();
  }
  // торец бревна с годовыми кольцами и трещиной
  function logEnd(g, x, y, R, r) {
    el(g, x + 0.6, y + 0.7, R, R * 0.95, '#3a2618');
    el(g, x, y, R, R * 0.95, '#c79a62');
    g.strokeStyle = 'rgba(118,84,54,0.55)'; g.lineWidth = 0.5; g.beginPath();
    for (const k of [0.66, 0.36]) { g.moveTo(x + R * k, y); g.ellipse(x, y, R * k, R * k * 0.95, 0, 0, TAU); } g.stroke();
    line(g, 'rgba(58,38,24,0.6)', 0.6, x, y, x + (r() - 0.5) * R * 1.4, y - R * 0.8);
  }
  // мох/пакля в пазах (или щели без утепления)
  function seams(g, x0, x1, y, walls, r) {
    if (walls) {
      g.fillStyle = '#6f6e45'; g.beginPath(); g.moveTo(x0, y - 0.6);
      for (let xx = x0; xx <= x1; xx += 4) g.lineTo(xx, y - 0.6 - r() * 1.1);
      for (let xx = x1; xx >= x0; xx -= 4) g.lineTo(xx, y + 0.6 + r() * 0.9);
      g.fill();
      g.strokeStyle = 'rgba(160,133,97,0.8)'; g.lineWidth = 0.6; g.beginPath();
      for (let k = 0; k < (x1 - x0) / 7; k++) { const xx = x0 + r() * (x1 - x0); g.moveTo(xx, y); g.lineTo(xx + (r() - 0.5) * 3, y + 1.5 + r() * 1.5); } g.stroke();
    } else {
      g.fillStyle = '#120a06'; g.beginPath();
      for (let xx = x0; xx < x1; xx += 3 + r() * 6) { const L = 5 + r() * 14; if (r() < 0.55) g.rect(xx, y - 0.9, L, 1.8); xx += L; } g.fill();
      g.fillStyle = 'rgba(138,106,69,0.7)'; g.beginPath(); for (let k = 0; k < (x1 - x0) / 30; k++) { const xx = x0 + r() * (x1 - x0); g.rect(xx, y - 0.6, 3 + r() * 4, 1.2); } g.fill();
    }
  }
  function hutSprite(key, H, x0, y0, w, h, paint) {
    return sprite('hut' + key + ':' + H.in.x0 + ',' + H.in.y0, w, h, g => { g.translate(-x0, -y0); paint(g, hg(H)); if (key !== 'floor') bodyLight(g, x0, y0, w, h, key === 'roof' ? 0.9 : 0.7, 29); }, hsc());
  }

  // пол, верх боковых стен (рисуется в проходе земли)
  function paintHutFloor(g, H, Q) {
    const { X0, X1, ix0, ix1, iy0, iy1, Ys } = Q, r = rng(71);
    g.fillStyle = '#62482f'; g.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0 + 12);
    // доски
    const bh = 11;
    for (let y = iy0, i = 0; y < iy1 + 12; y += bh, i++) {
      g.fillStyle = i % 3 === 0 ? '#7d634b' : i % 3 === 1 ? '#62482f' : '#62482f'; g.fillRect(ix0, y, ix1 - ix0, bh - 1);
      g.fillStyle = 'rgba(251,230,187,0.08)'; g.fillRect(ix0, y, ix1 - ix0, 1.5);
      g.fillStyle = 'rgba(58,38,24,0.55)'; g.fillRect(ix0, y + bh - 1, ix1 - ix0, 1);
      g.fillStyle = 'rgba(58,38,24,0.4)'; const js = ix0 + 20 + r() * 150; g.fillRect(js, y, 1, bh - 1);
      for (let k = 0; k < 2; k++) el(g, ix0 + r() * (ix1 - ix0), y + bh / 2, 1.8, 1, 'rgba(58,38,24,0.4)');
    }
    // половик
    g.save(); g.translate(12, -22);
    g.fillStyle = '#8a3b2a'; g.beginPath(); g.roundRect(-40, -16, 80, 32, 3); g.fill();
    for (let k = 0; k < 7; k++) { g.fillStyle = ['#c79a62', '#4b5d6f', '#e3d5b6', '#5a2b1d'][k % 4]; g.fillRect(-40, -13 + k * 4, 80, 1.6); }
    g.strokeStyle = 'rgba(227,213,182,0.6)'; g.lineWidth = 0.7; g.beginPath(); for (let k = -40; k <= 40; k += 3) { g.moveTo(k, -16); g.lineTo(k, -18); g.moveTo(k, 16); g.lineTo(k, 18); } g.stroke();
    g.restore();
    // затенение у стен
    g.fillStyle = lg(g, 0, iy0, 0, iy0 + 30, [[0, 'rgba(20,10,5,0.55)'], [1, 'rgba(20,10,5,0)']]); g.fillRect(ix0, iy0, ix1 - ix0, 30);
    g.fillStyle = lg(g, ix0, 0, ix0 + 18, 0, [[0, 'rgba(20,10,5,0.45)'], [1, 'rgba(20,10,5,0)']]); g.fillRect(ix0, iy0, 18, iy1 - iy0 + 12);
    g.fillStyle = lg(g, ix1, 0, ix1 - 18, 0, [[0, 'rgba(20,10,5,0.45)'], [1, 'rgba(20,10,5,0)']]); g.fillRect(ix1 - 18, iy0, 18, iy1 - iy0 + 12);
    // верх боковых стен (поднят на высоту стены)
    for (const [a, b] of [[X0, ix0], [ix1, X1]]) {
      const yt = iy0 - HW, yb = Ys - HW;
      g.fillStyle = lg(g, a, 0, b, 0, [[0, HLOG.dk], [0.35, HLOG.hi], [0.7, HLOG.mid], [1, HLOG.sh]]);
      g.beginPath(); g.roundRect(a, yt, b - a, yb - yt, 3); g.fill();
      g.strokeStyle = 'rgba(58,38,24,0.4)'; g.lineWidth = 0.6; g.beginPath();
      for (let k = 0; k < 16; k++) { const yy = yt + r() * (yb - yt); g.moveTo(a + 2 + r() * 6, yy); g.lineTo(a + 3 + r() * 6, yy + 5 + r() * 6); } g.stroke();
      g.fillStyle = 'rgba(138,106,69,0.8)'; g.fillRect(a < 0 ? b - 1.2 : a, yt + 3, 1.2, yb - yt - 6);
    }
  }
  function hutFloor(g, H) {
    const Q = hg(H);
    g.drawImage(hutSprite('floor', H, Q.X0 - 2, Q.iy0 - HW - 2, Q.X1 - Q.X0 + 4, Q.iy1 - Q.iy0 + HW + 18, (g2, q) => paintHutFloor(g2, H, q)), H.x + Q.X0 - 2, H.y + Q.iy0 - HW - 2, Q.X1 - Q.X0 + 4, Q.iy1 - Q.iy0 + HW + 18);
  }

  // северная стена — внутренняя сторона
  function paintHutNorth(g, H, Q) {
    const { X0, X1, iy0, ix0, ix1 } = Q, n = 6, lh = HW / n, r = rng(73 + (H.walls ? 1 : 0));
    // верх стены (толщина сруба)
    g.fillStyle = lg(g, 0, iy0 - HW - H.wall, 0, iy0 - HW, [[0, HLOG.sh], [0.4, HLOG.hi], [1, HLOG.dk]]);
    g.beginPath(); g.roundRect(X0, iy0 - HW - H.wall, X1 - X0, H.wall + 1, 3); g.fill();
    for (let i = 0; i < n; i++) logRow(g, X0, X1, iy0 - (i + 1) * lh, lh, HLOG_IN, r);
    for (let i = 1; i < n; i++) seams(g, X0 + 3, X1 - 3, iy0 - i * lh, H.walls, r);
    // копоть над печью
    g.fillStyle = rg(g, -70, iy0 - HW + 6, 34, [[0, 'rgba(16,39,31,0.55)'], [1, 'rgba(16,39,31,0)']]); g.fillRect(-110, iy0 - HW, 80, HW);
    // окошко с изморозью
    const wx = -18, wy = iy0 - 27;
    rr(g, wx - 11, wy - 8, 22, 16, 1.5, '#3a2618');
    g.fillStyle = lg(g, 0, wy - 6, 0, wy + 6, [[0, '#5d7991'], [1, '#27394a']]); g.fillRect(wx - 9, wy - 6, 18, 12);
    g.strokeStyle = 'rgba(221,230,238,0.75)'; g.lineWidth = 0.6; g.beginPath();
    for (let k = 0; k < 6; k++) { const a = r() * TAU; g.moveTo(wx - 9 + r() * 4, wy + 6 - r() * 4); g.lineTo(wx - 9 + r() * 4 + Math.cos(a) * 4, wy + 6 - r() * 4 + Math.sin(a) * 3); } g.stroke();
    g.fillStyle = '#3a2618'; g.fillRect(wx - 0.6, wy - 6, 1.2, 12); g.fillRect(wx - 9, wy - 0.6, 18, 1.2);
    rr(g, wx - 12, wy + 7, 24, 2.4, 1, '#67482f');
    // полка: чайник, банки
    rr(g, 8, iy0 - 31, 40, 3, 1, '#8a6a45'); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(8, iy0 - 28, 40, 1.5);
    el(g, 16, iy0 - 35, 5, 4, '#6c7178'); rr(g, 13, iy0 - 41, 6, 3, 1, '#4a5561'); line(g, '#4a5561', 1, 21, iy0 - 36, 24, iy0 - 39);
    rr(g, 26, iy0 - 39, 5, 8, 1, 'rgba(227,213,182,0.8)'); rr(g, 33, iy0 - 38, 5, 7, 1, 'rgba(190,123,75,0.85)'); rr(g, 40, iy0 - 36, 6, 5, 1, '#cea977');
    // пучок трав и связка шкурок
    line(g, '#4b3220', 0.8, -44, iy0 - 40, -44, iy0 - 34);
    g.fillStyle = '#7a7a48'; g.beginPath(); g.moveTo(-47, iy0 - 34); g.lineTo(-41, iy0 - 34); g.lineTo(-39, iy0 - 20); g.lineTo(-49, iy0 - 20); g.fill();
    g.strokeStyle = '#9a9658'; g.lineWidth = 0.6; g.beginPath(); for (let k = 0; k < 5; k++) { g.moveTo(-46 + k * 1.5, iy0 - 33); g.lineTo(-48 + k * 2.2, iy0 - 21); } g.stroke();
    for (let k = 0; k < 2; k++) {
      const px = 72 + k * 12; line(g, '#4b3220', 0.8, px, iy0 - 40, px, iy0 - 37);
      g.fillStyle = k ? '#5b3d27' : '#67482f'; g.beginPath(); g.moveTo(px, iy0 - 37); g.quadraticCurveTo(px + 5, iy0 - 30, px + 3, iy0 - 20); g.lineTo(px - 3, iy0 - 20); g.quadraticCurveTo(px - 5, iy0 - 30, px, iy0 - 37); g.fill();
    }
    // тень по низу стены
    g.fillStyle = lg(g, 0, iy0 - 8, 0, iy0, [[0, 'rgba(10,5,2,0)'], [1, 'rgba(10,5,2,0.45)']]); g.fillRect(X0, iy0 - 8, X1 - X0, 8);
    // угловые столбы-торцы
    for (const ex of [ix0 - H.wall / 2, ix1 + H.wall / 2]) { g.fillStyle = lg(g, ex - 6, 0, ex + 6, 0, [[0, HLOG.sh], [0.4, HLOG.hi], [1, HLOG.dk]]); g.fillRect(ex - 6, iy0 - HW, 12, HW); }
  }
  function hutNorth(g, H) {
    const Q = hg(H), y0 = Q.iy0 - HW - H.wall - 2;
    g.drawImage(hutSprite('north' + (H.walls ? 1 : 0), H, Q.X0 - 2, y0, Q.X1 - Q.X0 + 4, HW + H.wall + 4, (g2, q) => paintHutNorth(g2, H, q)), H.x + Q.X0 - 2, H.y + y0, Q.X1 - Q.X0 + 4, HW + H.wall + 4);
  }

  // южная (фасадная) стена снаружи: сруб, торцы в обло, окно с наличником, проём, лыжи, завалинка
  const HWIN = { x: 62, y: -22, w: 20, h: 14 };
  function paintHutFront(g, H, Q) {
    const { X0, X1, Ys } = Q, n = 6, lh = HW / n, dw = H.doorW / 2, r = rng(77 + (H.walls ? 1 : 0));
    for (let i = 0; i < n; i++) { const y = Ys - (i + 1) * lh, ext = i % 2 ? 8 : 3; logRow(g, X0 - ext, X1 + ext, y, lh, HLOG, r); }
    for (let i = 1; i < n; i++) seams(g, X0, X1, Ys - i * lh, H.walls, r);
    for (let i = 0; i < n; i++) if (i % 2 === 0) for (const ex of [X0 - 1, X1 + 1]) logEnd(g, ex, Ys - (i + 0.5) * lh, lh * 0.62, r);
    // дверной проём: косяки, притолока, порог
    const dt = Ys - 36;
    g.fillStyle = '#1b120c'; g.fillRect(-dw, dt, dw * 2, 36);
    g.fillStyle = lg(g, 0, dt, 0, Ys, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(58,38,24,0.3)']]); g.fillRect(-dw, dt, dw * 2, 36);
    for (const sx of [-dw - 4, dw]) { g.fillStyle = lg(g, sx, 0, sx + 4, 0, [[0, '#8a6a45'], [1, '#4b3220']]); g.fillRect(sx, dt - 1, 4, 37); }
    rr(g, -dw - 7, dt - 6, dw * 2 + 14, 6, 2, '#67482f'); g.fillStyle = '#9a754e'; g.fillRect(-dw - 6, dt - 6, dw * 2 + 12, 1.4);
    poly(g, '#8ba4ba', -dw - 7, dt - 6, 0, dt - 11, dw + 7, dt - 6);
    rr(g, -dw - 3, Ys - 3, dw * 2 + 6, 4, 2, '#4b3220');
    // окно с резным наличником
    const { x: wx, y: wyo, w: ww, h: wh } = HWIN, wy = Ys + wyo;
    rr(g, wx - ww / 2 - 4, wy - wh / 2 - 4, ww + 8, wh + 8, 2, '#8ba4ba');
    poly(g, '#8ba4ba', wx - ww / 2 - 5, wy - wh / 2 - 3, wx, wy - wh / 2 - 10, wx + ww / 2 + 5, wy - wh / 2 - 3);
    g.fillStyle = '#5d7991'; for (let k = -2; k <= 2; k++) el(g, wx + k * 5, wy + wh / 2 + 5.5, 1.6, 1.6, '#6f8ea8');
    el(g, wx, wy - wh / 2 - 6, 1.6, 1.6, '#dde6ee');
    rr(g, wx - ww / 2, wy - wh / 2, ww, wh, 1, '#2f3542');
    poly(g, '#394e62', wx - ww / 2, wy + wh / 2 - 2, wx - ww / 2 + ww * 0.5, wy - wh / 2, wx - ww / 2 + ww * 0.72, wy - wh / 2, wx - ww / 2 + 2, wy + wh / 2);
    g.fillStyle = '#3a2618'; g.fillRect(wx - 0.7, wy - wh / 2, 1.4, wh); g.fillRect(wx - ww / 2, wy - 0.7, ww, 1.4);
    // ставни
    for (const sd of [-1, 1]) { const sx = wx + sd * (ww / 2 + 8); rr(g, sx - 4, wy - wh / 2 - 1, 8, wh + 2, 1, '#67482f'); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(sx - 0.5, wy - wh / 2, 1, wh); }
    rr(g, wx - ww / 2 - 5, wy + wh / 2 + 3, ww + 10, 2.6, 1.2, SNOW_HI);
    // лыжи и палки у стены
    for (const [lx, lean] of [[-66, 6], [-58, 7]]) {
      g.lineCap = 'round'; line(g, '#3a2618', 4, lx, Ys + 2, lx + lean, Ys - 38); line(g, '#916c45', 3, lx, Ys + 2, lx + lean, Ys - 38);
      line(g, '#916c45', 3, lx + lean, Ys - 38, lx + lean + 1, Ys - 43); line(g, '#c79a62', 0.8, lx - 0.6, Ys, lx + lean - 0.6, Ys - 36);
    }
    line(g, '#2f3542', 1.2, -48, Ys + 3, -44, Ys - 30); line(g, '#2f3542', 1.2, -45, Ys + 3, -40, Ys - 29);
    el(g, -47, Ys - 4, 3, 1, '#5b3d27');
    // снег на торцах и выпусках
    g.fillStyle = SNOW_HI; for (let i = 0; i < n; i++) for (const ex of [X0 - (i % 2 ? 8 : 1), X1 + (i % 2 ? 8 : 1)]) { g.beginPath(); g.ellipse(ex, Ys - (i + 1) * lh + 0.6, 2.8, 1.1, 0, 0, TAU); g.fill(); }
    // завалинка — сугроб вдоль стены, у двери протоптано
    for (const [a, b, sd] of [[X0 - 14, -dw - 3, 3], [dw + 3, X1 + 14, 9]]) {
      const n2 = 6, pts = [];
      for (let i = 0; i <= n2; i++) pts.push([a + (b - a) * i / n2, Ys - 3 - (5 + hs(sd + i) * 6) * Math.sin(Math.PI * (0.15 + 0.7 * i / n2))]);
      g.fillStyle = lg(g, 0, Ys - 13, 0, Ys + 6, [[0, '#f6f9fc'], [0.55, '#f6f9fc'], [1, SNOW]]);
      g.beginPath(); g.moveTo(a, Ys + 5);
      for (let i = 0; i <= n2; i++) { const [px, py] = pts[i]; if (i === 0) g.lineTo(px, py); else { const [qx, qy] = pts[i - 1]; g.quadraticCurveTo((px + qx) / 2, Math.min(py, qy) - 2, px, py); } }
      g.lineTo(b, Ys + 5); g.quadraticCurveTo((a + b) / 2, Ys + 9, a, Ys + 5); g.fill();
      g.fillStyle = lg(g, a, 0, b, 0, [[0, 'rgba(60,80,130,0.02)'], [1, 'rgba(60,80,130,0.2)']]); g.fill();
      g.strokeStyle = 'rgba(147,172,196,0.7)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(a + 4, Ys + 5); g.quadraticCurveTo((a + b) / 2, Ys + 9, b, Ys + 5); g.stroke();
    }
    el(g, 0, Ys + 7, dw + 6, 5, 'rgba(129,157,182,0.35)');
    g.fillStyle = 'rgba(111,142,168,0.3)'; for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(-8 + k * 3.4, Ys + 4 + (k % 2) * 4, 2.6, 1.3, 0.3, 0, TAU); g.fill(); }
  }
  function hutFront(g, H, env) {
    env = E(env);
    const Q = hg(H), { Ys } = Q, x0 = Q.X0 - 22, y0 = Ys - HW - 14, w = Q.X1 - Q.X0 + 44, h = HW + 28, lit = H.fuel > 0, dw = H.doorW / 2;
    const S = hutSprite('front' + (H.walls ? 1 : 0), H, x0, y0, w, h, (g2, q) => paintHutFront(g2, H, q));
    const sc = S.width / w, cutY = Ys - 11 - y0, cut = clamp(H.cut || 0, 0, 1);
    if (cut > 0.01) {
      // срез: верх стены прозрачен, низ — как есть
      g.globalAlpha = 1 - cut * 0.82; g.drawImage(S, 0, 0, S.width, cutY * sc, H.x + x0, H.y + y0, w, cutY);
      g.globalAlpha = 1; g.drawImage(S, 0, cutY * sc, S.width, S.height - cutY * sc, H.x + x0, H.y + y0 + cutY, w, h - cutY);
      g.globalAlpha = cut; rr(g, H.x + Q.X0 - 3, H.y + Ys - 13, -dw - Q.X0 + 3, 3, 1.5, '#c79a62'); rr(g, H.x + dw, H.y + Ys - 13, Q.X1 + 3 - dw, 3, 1.5, '#c79a62'); g.globalAlpha = 1;
    } else g.drawImage(S, H.x + x0, H.y + y0, w, h);
    const X = H.x, Y = H.y + Ys, a = 1 - cut * 0.82;
    g.globalAlpha = a;
    // тёплый проём и окно
    if (lit && (H.open || !H.door)) { g.fillStyle = 'rgba(255,143,49,0.35)'; g.fillRect(X - dw, Y - 36, dw * 2, 36); if ((H.cut || 0) < 0.5) env.light(X, Y + 18, 70, 'w', 0.55); }
    if (!H.door) { el(g, X - 4, Y - 1, dw - 2, 3, SNOW_HI); }
    else if (H.open) {
      g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(X - dw, Y - 36); g.lineTo(X - dw + 9, Y - 33); g.lineTo(X - dw + 9, Y + 2); g.lineTo(X - dw, Y); g.fill();
      g.fillStyle = '#8a6a45'; g.fillRect(X - dw + 5, Y - 34, 2, 35);
    } else {
      g.fillStyle = '#76593a'; g.fillRect(X - dw, Y - 36, dw * 2, 36);
      g.fillStyle = 'rgba(0,0,0,0.28)'; for (let k = 1; k < 5; k++) g.fillRect(X - dw + k * dw / 2.5, Y - 36, 0.9, 36);
      g.fillStyle = '#5b3d27'; g.fillRect(X - dw, Y - 30, dw * 2, 4); g.fillRect(X - dw, Y - 10, dw * 2, 4);
      g.save(); g.beginPath(); g.rect(X - dw, Y - 26, dw * 2, 16); g.clip(); line(g, '#5b3d27', 4, X - dw, Y - 10, X + dw, Y - 26); g.restore();
      g.fillStyle = '#323138'; g.fillRect(X - dw, Y - 30, 10, 2); g.fillRect(X - dw, Y - 10, 10, 2);
      el(g, X + dw - 6, Y - 18, 1.8, 1.8, '#323138'); line(g, '#323138', 1.4, X + dw - 6, Y - 18, X + dw - 6, Y - 13);
    }
    // окно: свет изнутри
    const wx = X + HWIN.x, wy = Y + HWIN.y;
    if (lit) {
      const f = 0.85 + 0.15 * Math.sin(env.now * 7) * Math.sin(env.now * 3.1);
      g.fillStyle = '#ed9541'; g.fillRect(wx - HWIN.w / 2, wy - HWIN.h / 2, HWIN.w, HWIN.h);
      g.globalAlpha = a * f; g.fillStyle = '#ffd27a'; g.fillRect(wx - HWIN.w / 2 + 1, wy - HWIN.h / 2 + 1, HWIN.w - 2, HWIN.h - 2);
      g.fillStyle = '#fbe6bb'; g.fillRect(wx - HWIN.w / 2 + 2, wy - HWIN.h / 2 + 1.5, HWIN.w / 2 - 3, HWIN.h / 2 - 2.5); g.globalAlpha = a;
      g.fillStyle = '#3a2618'; g.fillRect(wx - 0.7, wy - HWIN.h / 2, 1.4, HWIN.h); g.fillRect(wx - HWIN.w / 2, wy - 0.7, HWIN.w, 1.4);
      if ((H.cut || 0) < 0.5) { env.glow(wx, wy, 0.8); env.light(wx, wy + 44, 120, 'w', 0.8); }
      // отсвет окна на завалинке
      if (env.night > 0.3) { g.globalAlpha = a * env.night * 0.5; el(g, wx + 2, Y + 12, 20, 7, 'rgba(255,184,98,0.45)'); el(g, wx + 3, Y + 12, 11, 4, 'rgba(241,196,127,0.5)'); }
    }
    g.globalAlpha = 1;
  }

  // крыша: двускатная, щипец к зрителю (конёк с юга на север). Левый скат на свету, правый — в синей тени.
  function paintHutRoof(g, H, Q) {
    const { X0, X1, Ys, L, R, yA, yEc, yB, yBc, yG } = Q, r = rng(79), yW = Ys - HW;
    const chx = -70, cht = -153, chb = Q.zAt(-70, -72);
    // --- фронтон из брёвен, укороченных по скату
    g.save(); g.beginPath(); g.moveTo(X0, yW + 1); g.lineTo(0, yG); g.lineTo(X1, yW + 1); g.closePath(); g.clip();
    const lh = HW / 6;
    for (let i = 0; yW - i * lh > yG - lh; i++) logRow(g, X0, X1, yW - (i + 1) * lh, lh, HLOG, r);
    for (let i = 1; yW - i * lh > yG; i++) seams(g, X0, X1, yW - i * lh, H.walls, r);
    // слуховое окошко
    rr(g, -8, yG + 18, 16, 13, 1.5, '#3a2618'); g.fillStyle = '#2f3542'; g.fillRect(-6, yG + 20, 12, 9); g.fillStyle = '#3a2618'; g.fillRect(-0.6, yG + 20, 1.2, 9);
    rr(g, -9, yG + 31, 18, 2, 1, SNOW_HI);
    // тень под свесом
    g.lineWidth = 9; g.strokeStyle = 'rgba(30,45,85,0.4)'; g.beginPath(); g.moveTo(X0 - 4, yW - 2); g.lineTo(0, yG - 4); g.lineTo(X1 + 4, yW - 2); g.stroke();
    g.restore();
    // --- скаты
    const slope = (sd) => {
      const E = sd < 0 ? L : R, P = new Path2D();
      P.moveTo(E, yEc); P.lineTo(0, yA); P.lineTo(0, yB); P.lineTo(E, yBc); P.closePath();
      g.fillStyle = '#3a2618'; g.fill(P);
      // снежная шапка: бугристый край по карнизу (наружу) и по фронту
      const S = new Path2D(), n = 9;
      S.moveTo(0, yA - 4); S.lineTo(0, yB - 2);
      S.lineTo(E, yBc - 2);
      for (let i = 1; i <= n; i++) { const t = i / n, y = yBc + (yEc - yBc) * t - 3, bx = E + sd * (1.5 + hs(i * 5 + (sd > 0 ? 9 : 0)) * 3.5); S.quadraticCurveTo(bx + sd * 2, y - (yEc - yBc) / n / 2, E + sd * 0.5, y); }
      S.lineTo(E, yEc - 5); S.closePath();
      g.fillStyle = sd < 0 ? lg(g, 0, yB, 0, yEc, [[0, '#dde6ee'], [0.35, '#f7fafd'], [1, '#f6f9fc']]) : lg(g, 0, yB, 0, yEc, [[0, '#a4bad1'], [0.5, '#b6c9df'], [1, '#c6d4e5']]);
      g.fill(S);
      // лёгкая выпуклость снега к коньку
      g.save(); g.clip(S);
      g.fillStyle = sd < 0 ? lg(g, E, 0, 0, 0, [[0, 'rgba(255,255,255,0)'], [0.75, 'rgba(255,255,255,0.0)'], [1, 'rgba(198,213,230,0.45)']]) : lg(g, 0, 0, E, 0, [[0, 'rgba(255,255,255,0.35)'], [0.25, 'rgba(255,255,255,0)'], [1, 'rgba(40,60,110,0.12)']]);
      g.fillRect(Math.min(0, E) - 4, yB - 10, Math.abs(E) + 8, yEc - yB + 20);
      // заструги
      g.strokeStyle = sd < 0 ? 'rgba(147,172,196,0.3)' : 'rgba(93,121,145,0.25)'; g.lineWidth = 1; g.beginPath();
      for (let k = 0; k < 6; k++) { const x = sd * (10 + r() * 90), y = yB + 20 + r() * (yEc - yB - 30), Ly = 18 + r() * 30; g.moveTo(x, y); g.quadraticCurveTo(x + sd * 3, y + Ly / 2, x + sd * 1, y + Ly); }
      g.stroke();
      g.restore();
      return S;
    };
    slope(-1); slope(1);
    // --- труба на левом скате
    el(g, chx + 1, chb + 1, 9, 3.4, 'rgba(58,38,24,0.8)'); el(g, chx + 1, chb, 6, 2, 'rgba(100,82,64,0.6)');
    g.fillStyle = lg(g, chx - 4, 0, chx + 4, 0, [[0, '#7f8792'], [0.45, '#5d626b'], [1, '#323138']]); g.fillRect(chx - 4, cht, 8, chb - cht);
    g.fillStyle = 'rgba(16,39,31,0.5)'; g.fillRect(chx - 4, cht + 4, 8, 1.2);
    g.fillStyle = 'rgba(16,39,31,0.35)'; g.fillRect(chx - 4, cht, 8, 2.5);
    if (H.damper) { poly(g, '#2f3542', chx - 8, cht - 1, chx, cht - 8, chx + 8, cht - 1); line(g, '#313031', 1, chx - 3, cht - 1, chx - 3, cht + 1); line(g, '#313031', 1, chx + 3, cht - 1, chx + 3, cht + 1); }
    else { el(g, chx, cht, 4.5, 1.8, '#1a1a1c'); el(g, chx, cht - 0.5, 3.2, 1.1, '#0c0c0e'); }
    // --- дыра или заплата на правом скате
    const hx = 58, hy = -96;
    if (!H.walls) {
      g.fillStyle = SH(0.5); g.beginPath(); g.ellipse(hx + 1, hy + 2, 15, 13, 0.3, 0, TAU); g.fill();
      g.fillStyle = '#4e3723'; g.beginPath(); g.ellipse(hx, hy, 13, 12, 0.3, 0, TAU); g.fill();
      g.fillStyle = '#120a06'; g.beginPath(); g.moveTo(hx - 8, hy - 7); g.lineTo(hx - 1, hy - 9); g.lineTo(hx + 4, hy - 4); g.lineTo(hx + 9, hy - 5); g.lineTo(hx + 7, hy + 6); g.lineTo(hx - 2, hy + 8); g.lineTo(hx - 8, hy + 3); g.fill();
      line(g, '#67482f', 2, hx - 5, hy - 7, hx - 2, hy + 5); line(g, '#67482f', 2, hx + 5, hy - 5, hx + 3, hy + 6);
    } else {
      for (let k = 0; k < 3; k++) { rr(g, hx - 13, hy - 12 + k * 8, 26, 7, 1, k % 2 ? '#99764c' : '#a98254'); g.fillStyle = '#2f3542'; g.fillRect(hx - 11, hy - 10 + k * 8, 1.4, 1.4); g.fillRect(hx + 9, hy - 10 + k * 8, 1.4, 1.4); }
      g.fillStyle = 'rgba(198,213,230,0.9)'; g.beginPath(); g.ellipse(hx - 2, hy - 13, 14, 2.4, 0, 0, TAU); g.fill();
    }
    // --- конёк: снежный гребень
    g.fillStyle = SH(0.3); g.fillRect(0, yB, 3, yA - yB);
    g.fillStyle = '#f6f9fc'; g.beginPath(); g.moveTo(-2, yA - 4);
    for (let i = 1; i <= 8; i++) { const y = yA - 4 + (yB - yA) * i / 8; g.quadraticCurveTo(-4 - hs(i + 21) * 2, y - (yB - yA) / 16, -1.5, y); }
    g.lineTo(1.5, yB); g.lineTo(1.5, yA - 4); g.fill();
    // --- причелины с «полотенцем», толщина снега по фронту, сосульки
    for (const sd of [-1, 1]) {
      const E = sd < 0 ? L : R;
      g.fillStyle = sd < 0 ? '#dde6ee' : '#b6c9df'; g.beginPath(); g.moveTo(E + sd * 2, yEc - 6); g.lineTo(0, yA - 5); g.lineTo(0, yA + 0.5); g.lineTo(E + sd * 2, yEc + 0.5); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(E + sd * 2, yEc - 6); g.lineTo(0, yA - 5); g.stroke();
      g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(E, yEc); g.lineTo(0, yA); g.lineTo(0, yA + 6); g.lineTo(E, yEc + 6); g.fill();
      g.strokeStyle = '#8a6a45'; g.lineWidth = 1; g.beginPath(); g.moveTo(E, yEc + 0.5); g.lineTo(0, yA + 0.5); g.stroke();
      g.fillStyle = '#5b3d27'; g.beginPath();
      for (let k = 1; k < 9; k++) { const t = k / 9, x = E * (1 - t), y = yEc + (yA - yEc) * t + 6; g.moveTo(x - 2.4, y - 0.5); g.arc(x, y - 0.5, 2.4, 0, Math.PI); }
      g.fill();
      g.fillStyle = 'rgba(221,230,238,0.95)'; g.beginPath();
      for (let k = 0; k < 8; k++) { const t = k / 20, x = E * (1 - t) - sd * 2, y = yEc + (yA - yEc) * t + 7, Lh = 3 + hs(k * 3.7 + sd) * 8; g.moveTo(x - 1.2, y); g.lineTo(x, y + Lh); g.lineTo(x + 1.2, y); }
      g.fill();
    }
    // полотенце под коньком
    g.fillStyle = '#67482f'; g.beginPath(); g.moveTo(-4, yA + 4); g.lineTo(4, yA + 4); g.lineTo(4, yA + 20); g.lineTo(0, yA + 24); g.lineTo(-4, yA + 20); g.fill();
    for (let k = 0; k < 3; k++) el(g, 0, yA + 8 + k * 5, 1.3, 1.3, '#9a754e');
    el(g, 0, yA - 2, 6, 2.4, SNOW_HI);
    // --- антенна-диполь у заднего конца конька
    if (H.radio) {
      const m = Q.mast, ab = m.y + 72;
      line(g, 'rgba(49,48,49,0.5)', 0.7, m.x, m.y + 10, L + 20, yBc + 30); line(g, 'rgba(49,48,49,0.5)', 0.7, m.x, m.y + 10, R - 10, yBc + 40); line(g, 'rgba(49,48,49,0.5)', 0.7, m.x, m.y + 26, m.x + 6, yA + 10);
      g.lineCap = 'round'; line(g, '#313031', 3, m.x, ab, m.x, m.y); line(g, '#6c7178', 1, m.x - 0.8, ab, m.x - 0.8, m.y);
      line(g, '#313031', 1.6, m.x - 22, m.y + 6, m.x + 22, m.y + 6); line(g, '#313031', 1.2, m.x - 14, m.y + 16, m.x + 14, m.y + 16);
      for (const sx of [-22, 22]) el(g, m.x + sx, m.y + 6, 1.8, 1.8, '#dde6ee');
      line(g, SNOW_HI, 1.2, m.x - 20, m.y + 5, m.x - 4, m.y + 5);
      el(g, m.x, ab, 5, 2, 'rgba(60,80,130,0.35)');
    }
  }
  function hutRoof(g, H, env, alpha = 1) {
    if (alpha < 0.03) return;
    const Q = hg(H), x0 = Q.L - 12, y0 = Q.yB - 100, w = Q.R - Q.L + 24, h = Q.yEc - y0 + 26;
    const S = hutSprite('roof' + (H.walls ? 1 : 0) + (H.damper ? 1 : 0) + (H.radio ? 1 : 0), H, x0, y0, w, h, (g2, q) => paintHutRoof(g2, H, q));
    g.globalAlpha = alpha; g.drawImage(S, H.x + x0, H.y + y0, w, h); g.globalAlpha = 1;
  }
  const HUT_TOP = H => { const Q = hg(H); return { chimney: { x: H.x - 70, y: H.y - 153 }, mast: { x: H.x + Q.mast.x, y: H.y + Q.mast.y } }; };

  // ---- интерьер ----
  function paintStove(g) {
    // предтопочный лист
    g.fillStyle = '#7f8792'; g.beginPath(); g.roundRect(-24, -8, 50, 16, 2); g.fill();
    g.strokeStyle = 'rgba(49,48,49,0.4)'; g.lineWidth = 0.7; g.strokeRect(-23.5, -7.5, 49, 15);
    // ножки
    g.fillStyle = '#313031'; for (const lx of [-15, 13]) g.fillRect(lx, -6, 3, 6);
    // корпус-буржуйка
    g.fillStyle = lg(g, -17, 0, 17, 0, [[0, '#4e535d'], [0.35, '#323138'], [1, '#17181b']]);
    g.beginPath(); g.roundRect(-17, -30, 34, 25, 3); g.fill();
    g.fillStyle = lg(g, 0, -37, 0, -29, [[0, '#6c7178'], [1, '#2f3542']]); g.beginPath(); g.roundRect(-18, -37, 36, 8, 3); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-17, -22); g.lineTo(17, -22); g.stroke();
    g.fillStyle = '#888e96'; for (const [rx, ry] of [[-15, -28], [14, -28], [-15, -8], [14, -8]]) g.fillRect(rx, ry, 1.4, 1.4);
    // чайник на плите
    el(g, 11, -37, 6, 2, 'rgba(0,0,0,0.35)');
    g.fillStyle = lg(g, 5, 0, 17, 0, [[0, '#8f99a3'], [1, '#4a5561']]); g.beginPath(); g.ellipse(11, -41, 6, 4.5, 0, 0, TAU); g.fill();
    rr(g, 9, -47, 4, 2.4, 1, '#2f3542'); line(g, '#4a5561', 1.4, 16, -42, 20, -46);
    g.strokeStyle = '#323138'; g.lineWidth = 1; g.beginPath(); g.arc(11, -44, 5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    // поленья рядом
    g.save(); g.translate(30, -2);
    for (let k = 0; k < 4; k++) { rr(g, -8, -3 - k * 2.6 + (k > 2 ? 1 : 0), 16, 3.4, 1.7, k % 2 ? '#67482f' : '#5b3d27'); el(g, 8, -1.3 - k * 2.6 + (k > 2 ? 1 : 0), 1.6, 1.7, '#c79a62'); }
    g.restore();
  }
  function hutStove(g, x, y, o, env) {
    env = E(env);
    const S = sprite('hutStove', 80, 60, g2 => { g2.translate(40, 52); paintStove(g2); }, hsc());
    g.drawImage(S, x - 40, y - 52, 80, 60);
    const lit = o.fuel > 0, t = env.now;
    // труба до потолка/крыши
    const pt = o.pipeTop !== undefined ? o.pipeTop : y - 78;
    g.fillStyle = '#3e4450'; g.fillRect(x - 4, pt, 7, y - 36 - pt);
    g.fillStyle = '#5d626a'; g.fillRect(x - 4, pt, 2, y - 36 - pt);
    g.fillStyle = '#323138'; for (let yy = y - 44; yy > pt + 4; yy -= 14) g.fillRect(x - 5, yy, 9, 1.6);
    if (o.damper) { g.fillStyle = '#93979f'; g.fillRect(x - 10, y - 58, 16, 2.2); el(g, x - 10, y - 57, 1.6, 1.6, '#b8392d'); }
    // дверца топки
    rr(g, x - 9, y - 21, 16, 12, 1.5, '#313031');
    if (lit) {
      const f = 0.75 + Math.sin(t * 13) * 0.15 + Math.sin(t * 7.3) * 0.1;
      rr(g, x - 8, y - 20, 14, 10, 1, '#be471b');
      g.globalAlpha = f; rr(g, x - 7, y - 18, 12, 7, 1, '#ff8f31'); el(g, x - 1, y - 13, 4.5 * f, 2.4, '#ffd27a'); g.globalAlpha = 1;
      g.fillStyle = '#313031'; for (let k = 0; k < 3; k++) g.fillRect(x - 6 + k * 4.5, y - 20, 1.2, 10);
      // раскалённые бока
      g.globalAlpha = 0.35 * f; g.fillStyle = '#ff6a1a'; g.fillRect(x - 17, y - 10, 34, 2); g.globalAlpha = 1;
      // отсвет на полу
      g.globalAlpha = 0.22 * f; el(g, x - 1, y + 8, 22, 6, '#ff9e4a'); g.globalAlpha = 1;
      const lk = o.lightK === undefined ? 1 : o.lightK; if (lk > 0.05) { env.light(x, y - 10, 230, 'w', 0.9 * lk, o.room); env.glow(x - 1, y - 14, 0.7 * lk); }
    } else { g.fillStyle = '#313031'; for (let k = 0; k < 3; k++) g.fillRect(x - 6 + k * 4.5, y - 20, 1.2, 10); }
  }
  function paintBench(g, radio) {
    // верстак у северной стены
    g.fillStyle = 'rgba(15,8,4,0.4)'; g.beginPath(); g.ellipse(0, 1, 32, 5, 0, 0, TAU); g.fill();
    g.fillStyle = '#3a2618'; for (const lx of [-27, 23]) g.fillRect(lx, -12, 4, 13);
    g.fillStyle = lg(g, 0, -24, 0, -14, [[0, '#9a754e'], [1, '#8a6a45']]); g.fillRect(-30, -24, 60, 10);
    g.strokeStyle = 'rgba(58,38,24,0.4)'; g.lineWidth = 0.6; g.beginPath(); for (let k = 1; k < 3; k++) { g.moveTo(-30, -24 + k * 3.4); g.lineTo(30, -24 + k * 3.4); } g.stroke();
    g.fillStyle = '#5b3d27'; g.fillRect(-30, -14, 60, 4);
    g.fillStyle = '#4b3220'; g.fillRect(-26, -5, 52, 2);
    if (radio) {
      // рация: оливковый ящик, шкала, ручки, наушники, провод к антенне
      line(g, '#313031', 1, 12, -36, 14, -70);
      g.fillStyle = lg(g, 0, -40, 0, -22, [[0, '#5e6e4e'], [1, '#1c4034']]); g.beginPath(); g.roundRect(-16, -40, 30, 18, 2); g.fill();
      g.fillStyle = '#6e7f5a'; g.fillRect(-16, -40, 30, 2);
      rr(g, -13, -36, 12, 7, 1, '#10271f'); g.fillStyle = '#e3d5b6'; g.fillRect(-12, -35, 10, 5); line(g, '#b8392d', 0.8, -8, -35, -6, -30.5);
      el(g, 4, -32, 3, 3, '#313031'); el(g, 4, -32, 1.8, 1.8, '#888e96'); el(g, 10, -32, 2, 2, '#313031'); el(g, 10, -32, 1.1, 1.1, '#888e96');
      g.fillStyle = '#313031'; for (let k = 0; k < 4; k++) g.fillRect(-13 + k * 3, -27, 1.6, 2.5);
      g.strokeStyle = '#313031'; g.lineWidth = 1.4; g.beginPath(); g.arc(-22, -26, 4, Math.PI, 0); g.stroke(); el(g, -26, -25, 2, 2.4, '#313031'); el(g, -18, -25, 2, 2.4, '#313031');
      rr(g, 17, -28, 8, 5, 1, '#965043'); g.fillStyle = '#e3d5b6'; g.fillRect(18, -27, 6, 1); // тетрадь-журнал
    } else {
      // детали, инструмент, провода
      line(g, '#5d626b', 2, -22, -20, -8, -22); rr(g, -8, -24, 5, 4, 1, '#2f3542');
      rr(g, 2, -23, 12, 5, 1, '#a5acb3'); g.fillStyle = '#6c7178'; g.fillRect(4, -22, 8, 1);
      g.strokeStyle = '#ca5834'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(16, -18); g.bezierCurveTo(20, -24, 24, -16, 27, -21); g.stroke();
      el(g, -18, -18, 3, 1.5, '#c79a62');
    }
  }
  function hutBench(g, x, y, o, env) {
    env = E(env);
    if (!o.bench) {
      // заготовка: доски у стены
      g.fillStyle = 'rgba(15,8,4,0.35)'; g.beginPath(); g.ellipse(x, y - 2, 22, 5, 0, 0, TAU); g.fill();
      for (let k = 0; k < 3; k++) { g.save(); g.translate(x - 14 + k * 9, y - 2); g.rotate(-0.25); rr(g, -2.5, -26, 5, 26, 1, k % 2 ? '#8a6a45' : '#8a6a45'); g.restore(); }
      return;
    }
    const S = sprite('hutBench' + (o.radio ? 1 : 0), 76, 80, g2 => { g2.translate(38, 72); paintBench(g2, o.radio); }, hsc());
    g.drawImage(S, x - 38, y - 72, 76, 80);
    if (o.radio) {
      const on = (env.now % 1) < 0.5;
      el(g, x + 10, y - 38, 1.5, 1.5, on ? '#dc5224' : '#5a2b1d');
      if (on) env.glow && env.glow(x + 10, y - 38, 0.12);
    }
  }
  function paintChest(g) {
    g.fillStyle = 'rgba(15,8,4,0.4)'; g.beginPath(); g.ellipse(1, 1, 17, 4, 0, 0, TAU); g.fill();
    g.fillStyle = lg(g, 0, -16, 0, 0, [[0, '#8a6a45'], [1, '#5b3d27']]); g.fillRect(-15, -16, 30, 16);
    g.fillStyle = lg(g, 0, -24, 0, -16, [[0, '#a08561'], [1, '#76593a']]); g.beginPath(); g.roundRect(-16, -24, 32, 9, 3); g.fill();
    g.fillStyle = '#2f3542'; for (const bx of [-10, 8]) { g.fillRect(bx, -24, 3, 24); }
    g.fillStyle = '#6c7178'; for (const bx of [-10, 8]) for (const by of [-21, -12, -4]) g.fillRect(bx + 0.8, by, 1.2, 1.2);
    rr(g, -3, -17, 6, 6, 1, '#cea977'); el(g, 0, -13, 1, 1.4, '#3a2618');
  }
  // открытый ящик: тёмное нутро с поклажей, крышка откинута назад (видна изнанкой над задней кромкой)
  function paintChestOpen(g) {
    g.fillStyle = 'rgba(15,8,4,0.4)'; g.beginPath(); g.ellipse(1, 1, 17, 4, 0, 0, TAU); g.fill();
    g.fillStyle = lg(g, 0, -32, 0, -22, [[0, '#76593a'], [1, '#5b3d27']]); g.beginPath(); g.roundRect(-16, -33, 32, 10, 3); g.fill();   // крышка стоит за ящиком
    g.fillStyle = '#3a2618'; g.fillRect(-14, -30, 28, 5);
    g.fillStyle = lg(g, 0, -16, 0, 0, [[0, '#8a6a45'], [1, '#5b3d27']]); g.fillRect(-15, -16, 30, 16);
    g.fillStyle = '#1e140c'; g.beginPath(); g.ellipse(0, -18, 14.5, 3.6, 0, 0, TAU); g.fill();                                          // нутро
    el(g, -6, -18.6, 4, 1.6, '#8a6a45'); el(g, 4, -18.2, 3.6, 1.4, '#6c7178'); el(g, 0, -19.4, 2.6, 1.1, '#b8392d');                       // поклажа
    g.fillStyle = '#a08561'; g.fillRect(-15, -16, 30, 1.6);
    g.fillStyle = '#2f3542'; for (const bx of [-10, 8]) { g.fillRect(bx, -16, 3, 16); g.fillRect(bx, -33, 3, 10); }
  }
  function hutChest(g, x, y, open) {
    if (open) return g.drawImage(sprite('hutChestO', 40, 42, g2 => { g2.translate(20, 36); paintChestOpen(g2); }, hsc()), x - 20, y - 36, 40, 42);
    g.drawImage(sprite('hutChest', 40, 34, g2 => { g2.translate(20, 28); paintChest(g2); }, hsc()), x - 20, y - 28, 40, 34);
  }
  function paintBed(g) {
    // нары: дощатый настил на чурках
    g.fillStyle = 'rgba(15,8,4,0.45)'; g.beginPath(); g.ellipse(2, 13, 30, 5, 0, 0, TAU); g.fill();
    g.fillStyle = '#3a2618'; for (const lx of [-25, 21]) g.fillRect(lx, 2, 5, 11);
    g.fillStyle = '#67482f'; g.fillRect(-28, -16, 56, 20);
    g.fillStyle = '#5b3d27'; g.fillRect(-28, 4, 56, 5);
    g.fillStyle = 'rgba(0,0,0,0.3)'; for (let k = 1; k < 4; k++) g.fillRect(-28, -16 + k * 5, 56, 0.8);
    // медвежья шкура
    const r = rng(83);
    g.fillStyle = '#4b3220'; g.beginPath();
    g.moveTo(-24, -12); g.quadraticCurveTo(-26, -18, -18, -17); g.quadraticCurveTo(-4, -20, 12, -17); g.quadraticCurveTo(24, -19, 25, -12);
    g.quadraticCurveTo(29, -2, 24, 5); g.quadraticCurveTo(26, 11, 18, 9); g.quadraticCurveTo(0, 12, -16, 9); g.quadraticCurveTo(-27, 11, -24, 3); g.quadraticCurveTo(-29, -4, -24, -12); g.fill();
    g.strokeStyle = 'rgba(118,84,54,0.7)'; g.lineWidth = 0.7; g.beginPath();
    for (let k = 0; k < 40; k++) { const px = -22 + r() * 44, py = -15 + r() * 22; g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * 2, py + 2 + r() * 1.5); } g.stroke();
    g.strokeStyle = 'rgba(20,10,5,0.5)'; g.beginPath();
    for (let k = 0; k < 25; k++) { const px = -22 + r() * 44, py = -15 + r() * 22; g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * 2, py + 2); } g.stroke();
    // волчья шкура, сложенная в ногах
    g.fillStyle = '#888e96'; g.beginPath(); g.roundRect(10, -14, 14, 20, 4); g.fill();
    g.fillStyle = '#6c7178'; g.fillRect(10, -6, 14, 2); g.fillStyle = '#b2bac3'; g.fillRect(11, -13, 12, 2);
    // изголовье-скатка
    g.fillStyle = lg(g, 0, -14, 0, -2, [[0, '#e3d5b6'], [1, '#b7a07e']]); g.beginPath(); g.ellipse(-17, -8, 7, 5, -0.2, 0, TAU); g.fill();
    line(g, 'rgba(91,61,39,0.6)', 0.7, -21, -10, -13, -6);
  }
  function hutBed(g, x, y) { g.drawImage(sprite('hutBed', 70, 42, g2 => { g2.translate(35, 24); paintBed(g2); }, hsc()), x - 35, y - 24, 70, 42); }

  // ================= РЕКВИЗИТ И ЗЕМЛЯ (бывшие «островки» gfx.js, C1) =================
  // Правила: палитра-24, объём сверху-слева, контактная тень №5 строго под опорой, снег на верхах.
  // молодое деревце: отросло на месте пня (World.tickRegrow) — один хвойный ярус, тоньше и ниже взрослого
  function sapling(g, x, y, s = 1, v = 0) {
    const r = rng(4051 + Math.round(v * 97) + Math.round(s * 100) * 13);
    shadow(g, x, y + 1, 8 * s, 2.4 * s, 0.3);
    g.fillStyle = lg(g, x - 1.6 * s, 0, x + 1.6 * s, 0, [[0, '#765436'], [0.5, '#5b3d27'], [1, '#3a2618']]);
    g.beginPath(); g.moveTo(x - 1.6 * s, y); g.lineTo(x - 0.8 * s, y - 24 * s); g.lineTo(x + 0.8 * s, y - 24 * s); g.lineTo(x + 1.6 * s, y); g.fill();
    el(g, x, y - 0.5 * s, 6 * s, 2 * s, '#f6f9fc'); // сугроб у комля
    const w = (10 + r() * 2) * s, yb = y - 22 * s, top = yb - 15 * s;
    g.fillStyle = lg(g, x - w, 0, x + w, 0, [[0, '#2f5a3a'], [0.5, '#1c4034'], [1, '#10271f']]);
    g.beginPath();
    g.moveTo(x, top);
    g.quadraticCurveTo(x - w * 0.5, yb - 6 * s, x - w, yb + 2 * s);
    g.quadraticCurveTo(x, yb + 5 * s, x + w, yb + 2 * s);
    g.quadraticCurveTo(x + w * 0.5, yb - 6 * s, x, top);
    g.fill();
    // снежная шапка
    g.fillStyle = lg(g, x - w, top, x + w * 0.4, yb, [[0, '#f6f9fc'], [0.6, '#f6f9fc'], [1, '#b6c9df']]);
    g.beginPath();
    g.moveTo(x, top - 1 * s);
    g.quadraticCurveTo(x - w * 0.4, yb - 8 * s, x - w * 0.6, yb - 2 * s);
    g.quadraticCurveTo(x, yb, x + w * 0.5, yb - 3 * s);
    g.quadraticCurveTo(x + w * 0.2, yb - 9 * s, x, top - 1 * s);
    g.fill();
  }
  // тайник: узел/нарты, припорошенные снегом
  function stashPile(g, x, y, has) {
    sled(g, x, y, has ? 3 : 1, 1);
    el(g, x - 4, y - 10, 15, 7, 'rgba(246,249,252,0.85)');
    el(g, x + 8, y - 6, 9, 5, 'rgba(234,239,245,0.85)');
  }
  // snow 0..1 — снег на срезе: свежий пень (0) — светлый срез с каплями смолы, за ~0.6 суток нарастает шапка
  function stump(g, x, y, s = 1, snow = 1) {
    shadow(g, x, y + 1, 11 * s, 3.6 * s, 0.34);
    g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(x - 7 * s, y); g.lineTo(x - 6.4 * s, y - 8 * s); g.lineTo(x + 6.4 * s, y - 8 * s); g.lineTo(x + 7 * s, y); g.fill();
    el(g, x, y, 7 * s, 2.6 * s, '#5b3d27');
    g.fillStyle = '#3a2618'; g.fillRect(x + 2 * s, y - 7.6 * s, 4 * s, 7.4 * s);                 // теневой бок
    g.fillStyle = '#8a6a45'; g.fillRect(x - 5.6 * s, y - 7.4 * s, 1.4 * s, 6.6 * s);             // блик коры
    el(g, x, y - 8 * s, 6.6 * s, 2.5 * s, '#c79a62');
    g.strokeStyle = '#8a6a45'; g.lineWidth = 0.7 * s; g.beginPath(); g.ellipse(x + 0.4 * s, y - 8 * s, 3.6 * s, 1.3 * s, 0, 0, TAU); g.stroke();
    if (snow < 0.5) { el(g, x, y - 8 * s, 5.4 * s, 1.9 * s, '#e8c894'); el(g, x - 2 * s, y - 8.2 * s, 0.7 * s, 0.5 * s, '#d9a441'); el(g, x + 2.4 * s, y - 7.8 * s, 0.6 * s, 0.4 * s, '#d9a441'); }  // свежий срез, смола
    if (snow > 0.05) el(g, x - 1.8 * s * snow, y - 8.8 * s, 3.8 * s * Math.min(1, snow * 1.2) + 0.1, 1.5 * s * Math.min(1, snow * 1.2) + 0.1, SNOW_HI);   // снег на срезе
    if (snow < 0.3) { g.fillStyle = '#d9bd8a'; for (let i = 0; i < 5; i++) g.fillRect(x + (i - 2) * 3.2 * s, y + 1.5 + (i % 2) * 1.6, 1.8, 1); }   // щепа у комля
    el(g, x - 5 * s, y + 0.4 * s, 5 * s, 1.8 * s, SNOW_HI); el(g, x + 5.5 * s, y + 0.8 * s, 3.4 * s, 1.2 * s, '#dde6ee');
  }
  const smoothK = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // лапник на снегу (G.lap): обрубленные ветки веером вдоль a; k — сколько прошло из срока заметания (0 свежий → 1 скрыт)
  function lapnik(g, q, k) {
    if (k >= 1) return;
    const s = q.s || 1, a = q.a, c = Math.cos(a), sn = Math.sin(a) * 0.6, sv = clamp(k, 0, 1), al = 1 - smoothK(0.7, 1, sv), h = ((q.x * 73 + q.y * 31) >>> 0) % 997;
    g.globalAlpha = al; shadow(g, q.x, q.y + 1, 15 * s, 4.5 * s, 0.22 * al); g.globalAlpha = al;
    for (let i = 0; i < 5; i++) {
      const u = (i - 2) * 0.32 + ((h >> i) & 3) * 0.05, L = (11 + ((h >> (i + 2)) & 3) * 2) * s, ax = Math.cos(a + u), ay = Math.sin(a + u) * 0.6;
      const x0 = q.x - ax * L * 0.45 + (i - 2) * sn * 2.4, y0 = q.y - ay * L * 0.45 + (i - 2) * 1.2, x1 = x0 + ax * L, y1 = y0 + ay * L - 1.5;
      line(g, '#3a2618', 1, x0, y0, x1, y1);
      for (let j = 1; j <= 3; j++) { const t = j / 4, bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t; el(g, bx, by - 1, (4.2 - j * 0.7) * s, 1.7 * s, (i + j) % 2 ? '#2f5a3a' : '#244a31', a + u + (j % 2 ? 0.5 : -0.5)); }
    }
    // снег сверху: чуть-чуть сразу, к концу срока — покрывалом
    g.globalAlpha = al * (0.25 + 0.75 * sv); el(g, q.x + 1, q.y - 2, (6 + 10 * sv) * s, (1.4 + 3 * sv) * s, '#f4f8fb', a * 0.6);
    if (sv > 0.35) { g.globalAlpha = al * (sv - 0.35) * 1.4; el(g, q.x - c * 4, q.y - sn * 4 - 1, 13 * s, 4 * s, '#eef3f8', a * 0.6); }
    g.globalAlpha = 1;
  }
  // чурка на снегу: короткий кругляк торцом к камере, a — поворот
  function chunk(g, x, y, a = 0) {
    shadow(g, x, y + 1, 8, 2.6, 0.3);
    g.save(); g.translate(x, y); g.rotate(a * 0.4);
    rr(g, -6, -7, 12, 7, 2.5, '#765436'); g.fillStyle = '#5b3d27'; g.fillRect(-6, -2.4, 12, 2.4);
    el(g, 6, -3.5, 2.4, 3.5, '#e0b47a'); el(g, 6, -3.5, 1, 1.5, '#c79a62');
    el(g, -1, -7, 4, 0.9, 'rgba(246,249,252,0.8)');
    g.restore();
  }
  // пустая банка на снегу (после еды): лежит на боку, крышка отогнута
  function emptyCan(g, x, y, a = 0) {
    shadow(g, x, y + 1, 5, 1.8, 0.25);
    g.save(); g.translate(x, y); g.rotate(Math.sin(a) * 0.5);
    rr(g, -4, -5, 8, 5, 1.2, '#8f9399'); g.fillStyle = '#b8392d'; g.fillRect(-1.6, -5, 3.2, 5);
    el(g, 4, -2.5, 1.2, 2.5, '#3a2618'); line(g, '#c2c9d0', 0.8, 4.5, -5, 6.5, -7);
    g.restore();
  }
  // нарты: полозья с загнутым носом, копылья, настил, груз брёвен; dir — куда смотрит нос (±1)
  function sled(g, x, y, load, dir = 1) {
    g.save(); g.translate(x, y); g.scale(dir < 0 ? -1 : 1, 1);
    shadow(g, 0, 1, 26, 5, 0.3);
    g.lineCap = 'round';
    for (const [dy, c, w] of [[-3.5, '#5b3d27', 2.6], [0, '#8a6a45', 2.8]]) {                  // дальний и ближний полоз
      g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(-22, dy); g.lineTo(18, dy); g.quadraticCurveTo(26, dy, 25, dy - 7); g.stroke();
    }
    g.strokeStyle = '#3a2618'; g.lineWidth = 1.6; g.beginPath(); for (let i = -17; i <= 13; i += 10) { g.moveTo(i, 0); g.lineTo(i + 1, -7); } g.stroke();
    rr(g, -21, -9, 38, 3.4, 1.4, '#8a6a45'); g.fillStyle = '#c79a62'; g.fillRect(-20, -9, 36, 1);  // настил
    const n = Math.min(load | 0, 6);
    for (let i = 0; i < n; i++) {
      const row = i < 3 ? 0 : 1, cx0 = -12 + (row ? (i - 3) * 9 + 4.5 : i * 9), cy = -12 - row * 4.6;
      rr(g, cx0 - 8, cy - 2.4, 16, 4.8, 2.4, row ? '#5b3d27' : '#8a6a45'); el(g, cx0 + 8, cy, 2.2, 2.4, '#c79a62');
    }
    if (n) el(g, -4, -12 - (n > 3 ? 4.6 : 0) - 2.2, 10, 1.4, SNOW_HI); else { el(g, -8, -9.6, 6, 1.2, SNOW_HI); el(g, 7, -9.6, 4, 1, SNOW_HI); }
    g.restore();
  }
  // записка: лист бересты, чем-то прижат (hold, см. NOTES в data.js) и частью присыпан снегом (snow 0..1 — шапка класса «глыба» js/snow.js:
  // растёт в снегопад, сдувается ветром; базовый слой есть всегда — лист лежит давно). pose (js/live.js, от Wind) = { dx, dy — сдвиг ветром,
  // lift — высота прыжка, flut — подъём свободного уголка px (≤ 3), rot — поворот }: только у записки под камнем лист может выскочить
  // и прыгать рядом (камень на месте); ящик, обшивка и щель держат лист — трепещет лишь уголок. Строки видны всегда.
  function note(g, x, y, read, pose, hold = 'stone', snow = 0) {
    const pin = hold !== 'stone', P = pose || NOPOSE, px = x + (pin ? 0 : P.dx), py = y + (pin ? 0 : P.dy), up = pin ? 0 : P.lift, f = pin ? Math.min(1.2, P.flut) : P.flut;
    const sn = clamp(0.3 + 0.6 * snow, 0, 1), paper = read ? '#dde6ee' : '#e3d5b6', band = read ? '#b6c9df' : '#c79a62';
    if (hold === 'crack') { // обрубок бревна с трещиной, лист сложен и засунут в щель — торчит край со строкой
      g.save(); g.translate(x, y); g.rotate(-0.12);
      shadow(g, 0, 1.5, 15, 3.4, 0.3);
      rr(g, -14, -8, 28, 8.5, 4, '#6b4c31'); g.fillStyle = '#8a6a45'; g.fillRect(-12, -7.4, 24, 2.2);
      el(g, 14, -3.7, 3, 4.2, '#c79a62'); g.strokeStyle = '#8a6a45'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(14, -3.7, 1.6, 2.4, 0, 0, TAU); g.stroke();
      g.strokeStyle = '#2a1a0f'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(-11, -4.6); g.lineTo(-4, -3.8); g.lineTo(3, -4.9); g.lineTo(10, -4.2); g.stroke();
      g.save(); g.translate(-1, -4.6); g.rotate(-0.08 - f * 0.05);
      poly(g, paper, -5, 0, 5, 0, 5.6, -4.6 - f * 0.4, -4.4, -4.2); g.fillStyle = '#6c7178'; g.fillRect(-3.6, -2.6, 6.5, 0.8); g.fillStyle = band; g.fillRect(-4.6, -4.4, 10, 0.9);
      g.restore();
      el(g, -2, -8.4, 11 * (0.5 + 0.5 * sn), 1.6 + sn, SNOW_HI);                                 // снег на бревне
      el(g, -13, 0.4, 5 + 5 * sn, 1.4 + sn, SNOW_HI); el(g, 9, 1, 4 + 3 * sn, 1.2, '#dde6ee');
      g.restore(); return;
    }
    shadow(g, px, py + 1, 9 * (1 - Math.min(0.5, up / 24)), 2.6, 0.28 * (1 - Math.min(0.6, up / 20)));
    const moved = !pin && P.dx * P.dx + P.dy * P.dy + up * up > 1, stone = () => { el(g, 5, -7.5, 3.2, 2.2, '#6c7178'); el(g, 5.6, -6.6, 2.2, 1.2, '#4e535d'); el(g, 4.3, -8.4, 2, 1.1, '#b6c9df'); el(g, 4.6, -9.2, 2.4 * sn + 0.4, 0.9, SNOW_HI); };
    if (moved) { g.save(); g.translate(x, y); g.rotate(-0.2); stone(); g.restore(); }
    g.save(); g.translate(px, py - up); g.rotate(-0.2 + (pin ? 0 : P.rot));
    if (f > 0.05) { // свободный уголок (слева внизу) приподнят ветром: лист — четырёхугольник, под уголком — тень
      el(g, -5, 1.5, 3, 1, 'rgba(39,57,74,0.18)');
      poly(g, paper, -7, -8, 7, -8, 7, 2, -7 + f * 0.4, 2 - f);
    } else rr(g, -7, -8, 14, 10, 1, paper);
    g.fillStyle = band; g.fillRect(-7, -8, 14, 1.2);
    g.fillStyle = '#6c7178'; g.fillRect(-4.5, -5, 8, 0.9); g.fillRect(-4.5, -2.6, 6, 0.9); g.fillRect(-4.5, -0.2, 7, 0.9);
    if (hold === 'crate') { // угол ящика стоит на листе
      el(g, 7, 0.8, 8, 2, SH(0.3));
      g.fillStyle = lg(g, 1, 0, 14, 0, [[0, '#8a6a45'], [1, '#62482f']]); g.fillRect(1, -12, 13, 12);
      g.strokeStyle = 'rgba(58,38,24,0.6)'; g.lineWidth = 0.9; g.strokeRect(1.5, -11.5, 12, 11); g.beginPath(); g.moveTo(1.5, -11.5); g.lineTo(13.5, -0.5); g.stroke();
      rr(g, 0.4, -14 - sn, 14.2, 2.6 + sn, 1.3, SNOW_HI);
    } else if (hold === 'panel') { // гнутый лист обшивки Ми-8 с заклёпками и обрывком полосы
      poly(g, SH(0.25), 0, -9, 13, -7, 12, 2.5, -1, 1.5);
      poly(g, '#c2c9d0', -1, -10, 12, -8.5, 11.5, 0.5, 2, 0.5, 0.5, -4); poly(g, '#ca4528', 0.3, -6.5, 11.9, -5.2, 11.8, -3.4, 0.9, -4.6);
      line(g, '#8f9aa4', 0.7, 0, -9.4, 11.5, -8); g.fillStyle = '#6c7178'; for (let k = 0; k < 4; k++) g.fillRect(1.5 + k * 2.8, -8.6 + k * 0.35, 0.7, 0.7);
      el(g, 6, -9.4, 5.5 * sn + 1, 1 + 0.5 * sn, SNOW_HI);
    } else if (!moved) stone();                                                              // камень-гнёт
    g.restore();
    // снег: наметён на край листа с наветренной (левой) стороны, лист не заметён целиком — строки видны
    if (!moved || up < 1) {
      g.save(); g.translate(px, py); g.rotate(-0.2);
      g.globalAlpha = 0.95; el(g, -7.5, -1.5, 3.2 + 3.4 * sn, 2.6 + 1.6 * sn, SNOW_HI); el(g, -6, 1.6, 4.5 + 4 * sn, 1.4 + 0.8 * sn, '#f1f5f9');
      g.globalAlpha = 0.55; el(g, -3.5, -6.8, 1.6 + 2 * sn, 0.8 + 0.4 * sn, SNOW_HI); el(g, 1, 1.3, 2 + 3 * sn, 0.9, '#f1f5f9');
      g.globalAlpha = 1; g.restore();
    }
  }
  const NOPOSE = { dx: 0, dy: 0, lift: 0, flut: 0, rot: 0 };
  // ловушки: капкан (дуги-челюсти, цепь к колышку) или петля на палке; улов лежит рядом
  function trap(g, t) {
    const x = t.x, y = t.y;
    shadow(g, x, y + 1, 11, 3, 0.3);
    if (t.kind === 'trap') {
      g.lineCap = 'round';
      line(g, '#3a2618', 2, x + 16, y + 4, x + 16, y - 6); el(g, x + 16, y - 6.5, 1.6, 0.8, '#c79a62');   // колышек
      g.strokeStyle = '#6c7178'; g.lineWidth = 1; g.setLineDash([1.6, 1.2]); g.beginPath(); g.moveTo(x + 8, y); g.quadraticCurveTo(x + 12, y + 4, x + 16, y + 3); g.stroke(); g.setLineDash([]);
      el(g, x, y, 7.5, 3, '#27394a');
      g.strokeStyle = '#6c7178'; g.lineWidth = 2; g.beginPath();
      if (t.catch) { g.moveTo(x - 8, y - 1); g.lineTo(x + 8, y - 1); } else { g.ellipse(x, y, 7, 3.2, 0, Math.PI, TAU); g.moveTo(x + 7, y); g.ellipse(x, y, 7, 3.2, 0, 0, Math.PI); }
      g.stroke();
      g.strokeStyle = '#b6c9df'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(x, y - 0.6, 6.4, 2.6, 0, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
    } else {
      g.lineCap = 'round'; line(g, '#5b3d27', 2, x, y + 2, x - 1, y - 12); line(g, '#8a6a45', 0.8, x - 0.6, y + 1, x - 1.4, y - 11);
      g.strokeStyle = '#6c7178'; g.lineWidth = 1; g.beginPath(); g.ellipse(x + 3, y - 4, 5, 3.6, 0.2, 0, TAU); g.stroke();
      el(g, x - 1, y - 12.5, 2, 0.9, SNOW_HI);
    }
    if (t.catch === 'hare') { el(g, x, y - 4, 7, 3.6, '#f6f9fc'); el(g, x + 1.5, y - 2.4, 5, 1.6, '#dde6ee'); el(g, x - 6, y - 6, 2.6, 1.2, '#f6f9fc'); }
    else if (t.catch === 'sable') { el(g, x, y - 4, 8, 3.2, '#5b3d27'); el(g, x - 1, y - 5, 5, 1.2, '#8a6a45'); }
    else if (t.catch === 'wpelt') { el(g, x, y - 4, 10, 3.8, '#6c7178'); el(g, x - 1, y - 5.2, 7, 1.4, '#b6c9df'); }
    el(g, x - 9, y + 1, 4, 1.3, SNOW_HI);
  }
  // амулет-сэвэн: резной столбик с ликом, красная повязка, снег на макушке; возвращает точку блика
  function amulet(g, x, y) {
    shadow(g, x, y + 1, 6, 2.2, 0.32);
    g.fillStyle = '#8a6a45'; g.beginPath(); g.roundRect(x - 3, y - 18, 6, 18, 2); g.fill();
    g.fillStyle = '#5b3d27'; g.fillRect(x + 1, y - 18, 2, 18);
    el(g, x, y - 20, 4, 4, '#8a6a45'); el(g, x + 1.4, y - 19.6, 2.4, 3.4, '#5b3d27'); el(g, x - 0.6, y - 20.4, 2.6, 3, '#c79a62');
    g.fillStyle = '#3a2618'; g.fillRect(x - 2, y - 21, 1.2, 1.2); g.fillRect(x + 1, y - 21, 1.2, 1.2); g.fillRect(x - 1.6, y - 18, 3.2, 0.9);
    g.fillStyle = '#b8392d'; g.fillRect(x - 3.2, y - 9, 6.4, 1.8); g.fillStyle = '#7c241c'; g.fillRect(x + 1.2, y - 9, 2, 1.8);
    el(g, x - 0.6, y - 23.4, 3.2, 1.3, SNOW_HI); el(g, x - 2, y + 0.4, 4, 1.3, SNOW_HI);
    return { x, y: y - 22 };
  }
  // объекты осмотра: статика в кэше, живые детали (флажок) — поверх
  const INSP = {
    sign: [48, 50, 24, 42, g => {
      line(g, '#3a2618', 4, 0, 0, 0, -30); line(g, '#8a6a45', 1.2, -1, -1, -1, -29);
      g.save(); g.rotate(-0.06); rr(g, -19, -38, 38, 14, 2, '#8a6a45'); g.fillStyle = '#5b3d27'; g.fillRect(-19, -27, 38, 3);
      g.fillStyle = '#e3d5b6'; g.fillRect(-14, -34, 26, 1.8); g.fillRect(-14, -30.4, 18, 1.8);
      poly(g, '#8a6a45', 19, -38, 25, -31, 19, -24); rr(g, -20, -40.5, 40, 3, 1.5, SNOW_HI); g.restore();
      el(g, 0, -31, 3, 1, SNOW_HI);
    }],
    pennant: [40, 44, 12, 40, g => { line(g, '#27394a', 2, 0, 0, 0, -34); line(g, '#6c7178', 0.7, -0.5, -1, -0.5, -33); el(g, 0, -34.5, 1.6, 1.1, '#ffd27a'); }],
    barrel: [30, 32, 15, 28, g => {
      g.fillStyle = '#2f5a3a'; g.beginPath(); g.roundRect(-8, -20, 16, 20, 3); g.fill();
      g.fillStyle = '#1c4034'; g.fillRect(2.5, -20, 5.5, 20); g.fillStyle = '#10271f'; g.fillRect(-8, -14, 16, 1.8); g.fillRect(-8, -7, 16, 1.8);
      g.fillStyle = 'rgba(246,249,252,0.28)'; g.fillRect(-6, -19, 2, 17);
      el(g, 0, -20, 8, 2.8, '#b6c9df'); el(g, -0.6, -20.6, 7, 2.2, SNOW_HI); el(g, -6, 0, 5, 1.5, SNOW_HI);
    }],
    buran: [56, 34, 28, 28, g => {
      g.lineCap = 'round'; line(g, '#27394a', 2.4, -24, 0, 16, 0); line(g, '#27394a', 2, 16, 0, 20, -3);        // лыжи
      g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(-20, -4); g.lineTo(-18, -13); g.lineTo(6, -15); g.quadraticCurveTo(16, -14, 18, -6); g.lineTo(14, -2); g.lineTo(-20, -2); g.fill();
      g.fillStyle = '#7c241c'; g.fillRect(-20, -6, 38, 3);
      g.fillStyle = '#2f3542'; g.beginPath(); g.roundRect(-16, -18, 16, 5, 2); g.fill();                           // сиденье
      poly(g, '#3f6f7a', 6, -15, 10, -23, 14, -22, 12, -14); poly(g, 'rgba(246,249,252,0.5)', 8, -16, 10.5, -21.5, 11.5, -21, 10, -15.5);
      el(g, -8, -18.6, 8, 1.6, SNOW_HI); el(g, 8, -15.2, 5, 1.2, SNOW_HI); el(g, -18, 0.6, 7, 1.6, SNOW_HI);
    }],
    lenin: [36, 46, 18, 42, g => {
      g.fillStyle = '#6c7178'; g.fillRect(-9, -16, 18, 16); g.fillStyle = '#4e535d'; g.fillRect(3, -16, 6, 16);  // постамент
      el(g, 0, -17, 10, 3, '#888e96'); el(g, 0, -20, 8, 4.4, '#888e96'); el(g, 2.8, -20, 4.6, 3.6, '#6c7178');   // плечи
      el(g, 0, -27, 5.6, 6.4, '#888e96'); el(g, 1.8, -26.4, 3.4, 5.4, '#6c7178');                                  // голова
      el(g, -1, -32.4, 5, 2, SNOW_HI); el(g, -6.4, -21.8, 3.4, 1.2, SNOW_HI); el(g, 5.6, -21.4, 3, 1, '#dde6ee');
      g.fillStyle = '#27394a'; g.fillRect(-5, -10, 10, 1.2); el(g, -8, 0.5, 6, 1.6, SNOW_HI);
    }],
    pole: [52, 118, 26, 112, g => {
      g.fillStyle = '#5b3d27'; g.fillRect(-3, -110, 6, 110); g.fillStyle = '#3a2618'; g.fillRect(1, -110, 2, 110);
      g.fillStyle = '#8a6a45'; g.fillRect(-22, -100, 44, 4); g.fillStyle = '#5b3d27'; g.fillRect(-22, -97, 44, 1.2);
      for (const ix of [-18, -8, 8, 18]) { el(g, ix, -101.5, 1.6, 2.2, '#b6c9df'); }
      rr(g, -23, -103, 46, 2.6, 1.3, SNOW_HI); el(g, 0, -111, 3.4, 1.4, SNOW_HI);
      line(g, '#27394a', 0.6, -18, -101, -26, -92); line(g, '#27394a', 0.6, 18, -101, 26, -92);                        // оборванный провод
      el(g, -5, 0.5, 7, 1.8, SNOW_HI);
    }],
  };
  function inspect(g, q, env) {
    const I = INSP[q.id]; if (!I) return;
    const [w, h, ax, ay, paint] = I;
    shadow(g, q.x, q.y + 1, Math.min(18, w * 0.34), 3.4, 0.32);
    g.drawImage(sprite('insp' + q.id, w, h, g2 => { g2.translate(ax, ay); paint(g2); }), q.x - ax, q.y - ay, w, h);
    if (q.id === 'pennant') {
      const F = typeof Live !== 'undefined' ? Live.flag(q, env) : null; // форма от Wind: обвис · полощется · хлопает · рвётся
      if (F) pennant(g, F);
      else { // стенды без ветра: прежний вымпел
        const t = E(env).now, x = q.x + 1, y = q.y - 34, wv = Math.sin(t * 3) * 2, wv2 = Math.sin(t * 3 - 1.1) * 2;
        g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y + 2 + wv, x + 16, y + 6 + wv2); g.quadraticCurveTo(x + 8, y + 8 + wv, x, y + 12); g.fill();
        g.fillStyle = '#7c241c'; g.beginPath(); g.moveTo(x + 8, y + 3 + wv * 0.8); g.quadraticCurveTo(x + 12, y + 5 + wv2, x + 16, y + 6 + wv2); g.quadraticCurveTo(x + 12, y + 8 + wv, x + 8, y + 9 + wv); g.fill();
      }
    }
  }
  // вымпел по точкам формы F = { top: [x, y], bot: [x, y], up: [[x, y]…], dn: [[x, y]…], shade: 0..1 } (верхняя и нижняя кромки от древка к кончику)
  function pennant(g, F) {
    const up = F.up, dn = F.dn, n = up.length;
    g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(F.top[0], F.top[1]);
    for (let i = 0; i < n; i++) g.lineTo(up[i][0], up[i][1]);
    for (let i = n - 2; i >= 0; i--) g.lineTo(dn[i][0], dn[i][1]);
    g.lineTo(F.bot[0], F.bot[1]); g.closePath(); g.fill();
    if (n > 2 && F.shade > 0.05) { // складка: тёмная половина к кончику, сила — от волны
      const h = n >> 1; g.globalAlpha = Math.min(1, F.shade); g.fillStyle = '#7c241c'; g.beginPath(); g.moveTo(up[h - 1][0], up[h - 1][1]);
      for (let i = h; i < n; i++) g.lineTo(up[i][0], up[i][1]);
      for (let i = n - 2; i >= h - 1; i--) g.lineTo(dn[i][0], dn[i][1]);
      g.closePath(); g.fill(); g.globalAlpha = 1;
    }
  }
  // вода: полынья и лунки — тон №4→№5 без белых обводок, кромка льда №3
  function polynya(g, x, y) {
    el(g, x, y + 1, 33, 14, '#b6c9df'); el(g, x - 1, y, 30, 12.4, '#dde6ee');
    el(g, x, y + 1.4, 28, 11, '#6f8ea8'); el(g, x + 1, y + 2.2, 25, 9, '#3f6f7a'); el(g, x + 2, y + 3, 20, 6.6, '#27394a');
    g.fillStyle = 'rgba(221,230,238,0.55)'; g.beginPath(); g.ellipse(x - 12, y + 1, 5, 1.4, -0.1, 0, TAU); g.ellipse(x + 9, y + 5.6, 3.4, 1, 0.1, 0, TAU); g.fill();
    el(g, x - 20, y - 8, 9, 2.4, SNOW_HI); el(g, x + 22, y - 6, 6, 1.8, SNOW_HI);
  }
  function hole(g, x, y) {
    el(g, x, y + 0.6, 12.5, 5.6, '#b6c9df'); el(g, x - 0.4, y, 11.4, 4.8, '#dde6ee');
    el(g, x, y + 0.4, 9.4, 3.8, '#6f8ea8'); el(g, x + 0.6, y + 1, 7.6, 2.8, '#27394a');
    g.fillStyle = SNOW_HI; g.beginPath(); for (const [dx, dy, r] of [[-12, -2, 2.4], [11, 3, 2], [-6, 5, 1.6], [9, -4, 1.4]]) { g.moveTo(x + dx + r, y + dy); g.ellipse(x + dx, y + dy, r, r * 0.55, 0, 0, TAU); } g.fill();
  }
  function tube(g, x, y) { el(g, x, y + 1, 4, 1.6, SH(0.3)); rr(g, x - 2.4, y - 5, 4.8, 6, 2, '#b6c9df'); rr(g, x - 2.4, y - 5, 2.2, 6, 1.2, '#dde6ee'); el(g, x, y - 5, 2.4, 1, '#f6f9fc'); }
  // сугроб на земле (печётся в кусок снега): бугор с тенью формы справа-снизу, без плоского «блина»
  function groundDrift(g, d) {
    const x = d.x, y = d.y, rx = d.rx, ry = d.ry;
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    // тень формы — мягкий серп снизу-справа (свет сверху-слева), тон №3
    g.fillStyle = rg(g, rx * 0.12, rx * 0.34, rx * 1.05, [[0, 'rgba(182,201,223,0.55)'], [0.7, 'rgba(182,201,223,0.35)'], [1, 'rgba(182,201,223,0)']]);
    g.beginPath(); g.arc(rx * 0.12, rx * 0.34, rx * 1.05, 0, TAU); g.fill();
    // тело бугра: свет №1 к верху-слева, растворяется в снег земли (без жёсткого края)
    g.fillStyle = rg(g, 0, 0, rx, [[0, '#f6f9fc'], [0.55, '#f1f5f9'], [0.85, 'rgba(234,239,245,0.8)'], [1, 'rgba(234,239,245,0)']], -rx * 0.3, -rx * 0.35);
    g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill();
    g.restore();
  }
  // кочка мари: бугорок, сухая трава пучком, снежная шапка
  // t.v — форма: 0 веер осоки, 1 высокий густой пучок, 2 плоская кочка с пригнутой ветром травой, 3 двойная кочка с редкой травой;
  // t.m — зеркало, t.rot — наклон пучка, t.c — цвет сухой травы (4 тона). Пучок — свой поток по координатам (две кочки не совпадают травинка в травинку).
  const TUSS_C = [['#a8825a', '#c9a877'], ['#96764f', '#b8966a'], ['#b8925f', '#d6b884'], ['#8c7458', '#a99478']];
  function tussock(g, t) {
    const x = t.x, y = t.y, s = t.s || 1, v = t.v | 0, m = t.m || 1, [c0, c1] = TUSS_C[t.c | 0] || TUSS_C[0];
    const r = rng(((t.x * 73856093) ^ (t.y * 19349663)) >>> 0);
    const wide = v === 2 ? 1.35 : v === 1 ? 0.8 : 1, hi = v === 1 ? 1.45 : v === 2 ? 0.7 : v === 3 ? 0.85 : 1;
    g.save(); g.translate(x, y); g.scale(m, 1);
    el(g, 0.8 * s, 1 * s, 8.5 * s * wide, 3.4 * s, 'rgba(182,201,223,0.6)');                   // тень формы №3
    el(g, 0, -0.6 * s, 7.4 * s * wide, 3.4 * s * (v === 2 ? 0.8 : 1), '#dde6ee');              // заснеженный бугорок №2
    if (v === 3) { el(g, 6.5 * s, 0.4 * s, 4.6 * s, 2.4 * s, '#dde6ee'); el(g, 7.2 * s, 1.2 * s, 5.2 * s, 1.6 * s, 'rgba(182,201,223,0.45)'); }
    // сухая осока: травинки разной длины, пучок наклонён (rot) и у плоской кочки пригнут ветром
    const n = v === 1 ? 11 : v === 3 ? 5 : 8, lean = (t.rot || 0) + (v === 2 ? 0.9 : 0), base = -1.5 * s;
    g.lineCap = 'round';
    for (const [col, lw, k0] of [[c0, 1, 0], [c1, 0.7, 1]]) {
      g.strokeStyle = col; g.lineWidth = lw * s; g.beginPath();
      for (let i = k0; i < n; i += 2) {
        const u = n > 1 ? i / (n - 1) * 2 - 1 : 0, bx = u * 5.4 * s * wide * (v === 1 ? 0.7 : 1), h = (6.2 - Math.abs(u) * 3.2) * s * hi * (0.75 + r() * 0.5);
        const a = u * 0.55 + lean + (r() - 0.5) * 0.3, tx = bx + Math.sin(a) * h, ty = base - Math.cos(a) * h;
        g.moveTo(bx, base); g.quadraticCurveTo(bx + Math.sin(a) * h * 0.3, base - h * 0.62, tx, ty);
      }
      g.stroke();
      if (v === 3) { g.beginPath(); for (let i = 0; i < 3; i++) { const bx = (5 + i * 1.6) * s, h = (3 + r() * 2) * s; g.moveTo(bx, 0); g.lineTo(bx + (i - 1 + lean) * 1.2 * s, -h); } g.stroke(); }
    }
    el(g, -1 * s, -2.2 * s, 5.2 * s * (v === 2 ? 1.4 : v === 1 ? 0.7 : 1), 1.9 * s, SNOW_HI);            // шапка снега
    g.restore();
  }

  // ================= Ми-8 в полёте — та же модель, что обломки (paintMi8): контур корпуса, ливрея, иллюминаторы, кабина, капот =================
  // нос влево; координаты корпуса обломков сдвинуты на 8 px вверх (Y), корпус цел — вместо разлома сужение в хвостовую балку,
  // балка и пилон — как у обломка хвоста (paintTail), но целые. Дверь (сдвижная, левый борт) — x −6…16, y −30…10 (MI8_DOOR); втулка — (0, −66).
  const MI8_DOOR = { x0: -6, x1: 16, y0: -30, y1: 10 };
  function paintMi8Fly(g) {
    const Y = -8;
    g.save(); g.translate(0, Y);
    // хвостовая балка (конус) и пилон с рулевым винтом — позади корпуса
    g.fillStyle = lg(g, 0, -22, 0, 12, [[0, '#f6f9fc'], [0.35, '#dde6ee'], [0.8, '#b2bac3'], [1, '#7f8792']]);
    g.beginPath(); g.moveTo(70, -24); g.lineTo(166, -16); g.lineTo(168, -8); g.lineTo(76, 14); g.closePath(); g.fill();
    g.strokeStyle = '#27394a'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(80, -3); g.lineTo(166, -11); g.stroke();
    g.strokeStyle = '#ca4528'; g.lineWidth = 7; g.beginPath(); g.moveTo(128, -14); g.lineTo(140, -15); g.stroke();
    g.strokeStyle = 'rgba(62,68,80,0.35)'; g.lineWidth = 0.8; g.beginPath(); for (const x of [96, 114, 150]) { g.moveTo(x, -21 + (x - 70) * 0.07); g.lineTo(x, 9 - (x - 76) * 0.2); } g.stroke();
    g.fillStyle = lg(g, 156, 0, 178, 0, [[0, '#dde6ee'], [1, '#8e99a3']]);
    g.beginPath(); g.moveTo(156, -16); g.lineTo(170, -52); g.lineTo(178, -52); g.lineTo(170, -8); g.closePath(); g.fill();
    poly(g, '#ca4528', 163, -34, 168, -46, 175, -46, 171, -34);
    poly(g, '#b2bac3', 140, -12, 152, -13, 150, -7, 138, -6);                                   // стабилизатор
    el(g, 175, -48, 3, 3, '#5d626b');
    // корпус — контур обломков без разлома
    const body = new Path2D();
    body.moveTo(-70, -27); body.lineTo(58, -27); body.quadraticCurveTo(76, -26, 84, -20); body.lineTo(84, 12); body.quadraticCurveTo(70, 24, 50, 25);
    body.lineTo(-62, 25); body.quadraticCurveTo(-100, 25, -108, 6); body.quadraticCurveTo(-111, -14, -92, -23); body.quadraticCurveTo(-83, -27, -70, -27); body.closePath();
    g.fillStyle = lg(g, 0, -42, 0, -26, [[0, '#f6f9fc'], [1, '#b1b5ba']]); g.beginPath(); g.roundRect(-46, -40, 92, 16, 6); g.fill();   // капот двигателей
    el(g, -46, -32, 4, 6, '#2f3542'); el(g, 46, -33, 5, 5, '#2f3542'); el(g, 50, -33, 4, 4, '#111418');
    g.fillStyle = lg(g, 0, -27, 0, 25, [[0, '#f6f9fc'], [0.3, '#dde6ee'], [0.75, '#b2bac3'], [1, '#7f8792']]); g.fill(body);
    g.save(); g.clip(body);
    g.fillStyle = '#ca4528'; g.fillRect(-120, 1, 220, 7); g.fillStyle = '#8b2920'; g.fillRect(-120, 7, 220, 1.6);
    g.fillStyle = '#27394a'; g.fillRect(-120, -4, 220, 1.6);
    g.fillStyle = 'rgba(47,53,66,0.25)'; g.fillRect(-120, 17, 220, 8);
    g.strokeStyle = 'rgba(62,68,80,0.35)'; g.lineWidth = 0.8; g.beginPath(); for (let x = -60; x < 80; x += 22) { g.moveTo(x, -27); g.lineTo(x, 25); } g.stroke();
    g.fillStyle = 'rgba(78,83,93,0.4)'; for (let x = -58; x < 78; x += 5) g.fillRect(x, -19, 1, 1);
    // кабина
    g.fillStyle = lg(g, -108, -24, -80, 0, [[0, '#6f8ea8'], [0.5, '#27394a'], [1, '#2f3542']]);
    g.beginPath(); g.moveTo(-94, -22); g.quadraticCurveTo(-108, -12, -106, 2); g.lineTo(-86, 2); g.lineTo(-80, -22); g.closePath(); g.fill();
    line(g, '#c2c9d0', 1.5, -93, -10, -84, -10); line(g, '#c2c9d0', 1.5, -95, 2, -88, -22);
    poly(g, 'rgba(221,230,238,0.6)', -104, -6, -99, -12, -101, -3);
    for (let i = 0; i < 5; i++) { const wx = -58 + i * 17 + (i > 2 ? 26 : 0), wy = -13; el(g, wx, wy, 5.4, 5.4, '#8f9aa4'); el(g, wx, wy, 4.2, 4.2, '#2f3542'); el(g, wx - 1.4, wy - 1.6, 1.6, 1.1, 'rgba(221,230,238,0.85)'); }
    // сдвижная дверь (закрыта; финал открывает её поверх)
    g.fillStyle = lg(g, -6, 0, 16, 0, [[0, '#c2c9d0'], [1, '#a5acb3']]); g.fillRect(-6, -22, 22, 40); line(g, '#6c7178', 1, -6, -22, -6, 18); line(g, '#6c7178', 1, 16, -22, 16, 18);
    g.restore();
    // мачта и втулка несущего винта
    rr(g, -5, -58, 10, 18, 2, '#4e535d'); el(g, 0, -58, 12, 4, '#2f3542');
    // шасси: носовая стойка и основные
    g.lineCap = 'round'; line(g, '#27394a', 2.6, -84, 22, -86, 32); line(g, '#27394a', 2.6, 30, 22, 34, 32); line(g, '#27394a', 1.6, 20, 12, 34, 30);
    el(g, -86, 33, 5, 5, '#2f3542'); el(g, 34, 33, 6, 6, '#2f3542'); el(g, -87, 31.5, 2, 2, '#6c7178'); el(g, 33, 31.5, 2.4, 2.4, '#6c7178');
    g.restore();
  }
  // несущий винт: 5 лопастей в перспективе (плоскость диска сжата ×0.12), у каждой — шлейф размытия по ходу вращения
  // (веер из полупрозрачных копий, затухает назад); частота видимого вращения ≈ 1.1 об/с — без стробоскопа. k — прозрачность (появление)
  function rotor(g, x, y, R, t, k = 1) {
    const w = t * 6.9, fl = 0.12;
    g.save(); g.translate(x, y);
    g.globalAlpha = 0.1 * k; el(g, 0, 0, R, R * fl, '#6c7178');                                   // лёгкий след диска
    for (let b = 0; b < 5; b++) {
      const a0 = w + b * TAU / 5;
      for (let q = 7; q >= 0; q--) {
        const a = a0 - q * 0.075, ca = Math.cos(a), sa = Math.sin(a), front = sa > 0;
        g.globalAlpha = k * (q ? 0.22 * (1 - q / 8) : 0.85);
        g.strokeStyle = front ? '#27394a' : '#4e535d'; g.lineWidth = q ? 2.4 : 2.8;
        g.beginPath(); g.moveTo(ca * 6, sa * 6 * fl); g.lineTo(ca * R, sa * R * fl); g.stroke();
      }
      g.globalAlpha = k * 0.8; g.fillStyle = '#ca4528'; const ca = Math.cos(a0), sa = Math.sin(a0); g.fillRect(ca * R * 0.95 - 1, sa * R * 0.95 * fl - 1, 2, 2);
    }
    g.globalAlpha = 1; el(g, 0, 0, 6, 2.6, '#27394a'); el(g, 0, -1, 3, 1.2, '#6c7178');
    g.restore();
  }
  // рулевой винт (сбоку на пилоне, плоскость — к зрителю): 3 лопасти с размытием, быстрее несущего
  function tailRotor(g, x, y, r, t, k = 1) {
    const w = t * 17;
    for (let b = 0; b < 3; b++) for (let q = 5; q >= 0; q--) {
      const a = w + b * TAU / 3 - q * 0.16; g.globalAlpha = k * (q ? 0.18 * (1 - q / 6) : 0.8);
      g.strokeStyle = '#2f3542'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke();
    }
    g.globalAlpha = 1; el(g, x, y, 2.4, 2.4, '#5d626b');
  }
  function mi8Fly() { return sprite('mi8fly', 290, 132, g => { g.translate(108, 70); paintMi8Fly(g); }); }

  // готовые спрайты для прямой отрисовки (опоры как в gfx.js)
  function spr(name) {
    switch (name) {
      case 'mi8': return sprite('mi8', 320, 210, g => { g.translate(160, 140); paintMi8(g); });
      case 'tail': return sprite('tail', 220, 140, g => { g.translate(110, 100); paintTail(g); });
      case 'chum': return sprite('chum', 130, 140, g => { g.translate(65, 120); paintChum(g); });
      case 'labaz': return sprite('labaz', 80, 90, g => { g.translate(40, 80); paintLabaz(g); });
    }
  }
  function reset() { for (const k in cache) delete cache[k]; for (const k in last) delete last[k]; bytes = 0; }

  return {
    paintSpruce, paintBirch, trunkWell, rootsInSnow, bodyLight, paintCedar, paintMi8, mi8Wires: () => MI8_WIRES, paintTail, paintChum, paintLabaz, paintMi8Fly, mi8Fly, rotor, tailRotor, MI8_DOOR,
    treeSprite, treeW, treeK, spr, reset, rng, setScale, shadow, budget, purge, stats,
    sprite, el, rr, poly, line, lg, rg, // примитивы — для js/art-zones.js (тот же кэш и масштаб)
    stump, lapnik, chunk, emptyCan, sapling, stashPile, sled, note, trap, amulet, inspect, polynya, hole, tube, groundDrift, tussock,
    hutFloor, hutNorth, hutFront, hutRoof, hutStove, hutBench, hutChest, hutBed, hutTop: HUT_TOP,
    fire, stack, building, flame,
    fx, drawParticle, decal, print,
  };
})();
