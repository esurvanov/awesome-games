'use strict';
// Snow — единый снег-накопитель (паспорт R3, волна 3: №8 шапки + наддувы, №9 следы + позёмка; docs/design/INTERACTION-PASSPORT.md).
//   🎩 шапка на вещи cap 0..1: растёт в снегопад (0 → 1 за сутки снегопада = 480 с), сдувается ветром выше порога переноса
//      (сухой снег 4–11 м/с, в среднем 7.7): −(ms − 7.7) / 10 в с; удар / толчок / пинок героя → cap = 0, Interact 'shed' + комья и пыль.
//   🏔 наддув d 0..1 (ступени 0–3 — спрайты, между ними — растяжение вдоль ветра): растёт от переноса по земле (ветер ≥ 4 м/с, поток ∝ (ms − 4)³);
//      главный нанос — с подветренной стороны (по Wind.dir): длина до 6 высот вещи, глубина до 1.2 высоты; наветренный меньше
//      (глубина ~0.5 высоты), у наветренной стенки — выдутая ямка.
//   👣 следы заносит по ветру: Snow.printRate(storm) → fx.js (жизнь следа ×4 в штиль, ×1 при 5 м/с, ×0.5 при 10, пурга ×0.25).
//   〰️ позёмка «дымится» с гребней сугробов земли, наддувов и сдуваемых шапок при ветре ≥ 5 м/с (свой пул ≤ 30 частиц).
// Вещи: обломки Ми-8 — крыша, бочка, ящики, лопасть (её комья рисует js/live.js, шапка — здесь); хвост; бочка у хвоста; изба; лабаз; чум;
//   классы (одна шапка и наддув на класс + память срыва на экземпляр): пни, глыбы, сигнальные кучи.
// Логика — Snow.tick (из Interact.tick) шагом 2 Гц; рисунок — Snow.ground (земля: наддувы и позёмка), Snow.after (шапка поверх вещи),
//   Snow.drawMi8 (шапки Ми-8, из Live.drawWreck). Свой поток случайности — Math.random игры не тратит (детерминизм смоук-тестов).
// QUALITY=low: наддув ближайшей ступенью без растяжения, наддувов у пней/глыб/куч нет, срыв без частиц, позёмки нет.
// Сейв не пишется: при смене G уровни восстанавливаются от дня (день 1 — чисто, дальше — шапки 0.8, наддув по дням).
const Snow = (() => {
  const TAU = Math.PI * 2;
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  const R = ArtWorld.rng(0x5A0F), rr = (a, b) => a + R() * (b - a);
  const UT = 7.7, UD = 4, UP = 5, DAY = 480, STRIP = 10, STEP = 0.5, SPMAX = 30, BUILD_GAP = 0.25;
  const HI = '#f6f9fc', MID = '#dde6ee';
  const emit = (k, e) => { if (typeof Interact !== 'undefined') Interact.emit(k, e); };
  const F = { fall: null };

  // ---------- рисунок шапки: гребень вдоль кромки (по нормали наружу) и купол на плоском верху ----------
  const qb = (a, b, c, u) => (1 - u) * (1 - u) * a + 2 * u * (1 - u) * b + u * u * c;
  function chain(P, n, tf) { // цепочка квадратичных кривых [x0,y0, cx,cy, x1,y1, cx,cy, x2,y2 …] → точки
    const out = [];
    for (let i = 0; i + 5 < P.length; i += 4) for (let k = i ? 1 : 0; k <= n; k++) {
      const u = k / n, x = qb(P[i], P[i + 2], P[i + 4], u), y = qb(P[i + 1], P[i + 3], P[i + 5], u);
      out.push(tf ? tf(x, y) : [x, y]);
    }
    return out;
  }
  function ridge(g, pts, T, out = 1, sd = 0) {
    const n = pts.length, top = [], mid = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = dy / L * out, ny = -dx / L * out, u = i / (n - 1), t = T * Math.pow(Math.sin(Math.PI * u), 0.55) * (0.8 + 0.2 * Math.sin(i * 2.3 + sd));
      top.push([pts[i][0] + nx * t, pts[i][1] + ny * t]); mid.push([pts[i][0] + nx * t * 0.3, pts[i][1] + ny * t * 0.3]);
    }
    const poly = (A, B, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(A[0][0], A[0][1]); for (const p of A) g.lineTo(p[0], p[1]); for (let i = B.length - 1; i >= 0; i--) g.lineTo(B[i][0], B[i][1]); g.closePath(); g.fill(); };
    poly(top, pts, MID); poly(top, mid, HI);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.8; g.beginPath();
    for (let i = 1; i < n - 1; i++) (i === 1 ? g.moveTo : g.lineTo).call(g, top[i][0], top[i][1] + 0.4);
    g.stroke();
  }
  function dome(g, x, y, rx, t) {
    g.fillStyle = MID; g.beginPath(); g.moveTo(x - rx, y + 0.6); g.quadraticCurveTo(x - rx * 0.9, y - t * 1.1, x, y - t); g.quadraticCurveTo(x + rx * 0.95, y - t * 0.9, x + rx, y + 0.6); g.quadraticCurveTo(x, y + 1.6, x - rx, y + 0.6); g.fill();
    g.fillStyle = HI; g.beginPath(); g.moveTo(x - rx + 0.6, y); g.quadraticCurveTo(x - rx * 0.85, y - t * 1.05, x - rx * 0.1, y - t); g.quadraticCurveTo(x + rx * 0.8, y - t * 0.85, x + rx - 1, y - 0.2); g.quadraticCurveTo(x, y + 0.6, x - rx + 0.6, y); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(x - rx * 0.35, y - t * 0.72, rx * 0.3, Math.max(0.4, t * 0.18), -0.1, 0, TAU); g.fill();
  }

  // ---------- вещи ----------
  // ax, ay — опора (мир); foot — след на земле [x0,y0,x1,y1] от опоры; h — высота (px) для наддува; box — рамка шапки [x,y,w,h] от опоры;
  // paint(g, k) — шапка толщины k (0..1); cap0 — начальная шапка (лопасть: снег на кромке запечён в спрайт)
  const CO = Math.cos(-0.09), SI = Math.sin(-0.09);
  const bf = (x, y) => [-10 + x * CO - y * SI, -36 + x * SI + y * CO];          // корпус Ми-8 → спрайт (как в live.js)
  // балка хвоста — цепочка верха прямо в координатах опоры (обломок js/art-world.js paintTail: излом у −21)
  const ROOF = [-92, -25, -72, -31, -48, -41, 0, -48, 46, -44, 62, -38, 73, -27];
  let HOLD = null, BY = {};
  function holders() {
    if (HOLD) return HOLD;
    const c = POI.cockpit, tl = POI.tail, lb = POI.labaz, ch = POI.chum, bt = (typeof INSPECT !== 'undefined' && INSPECT.find(q => q.id === 'barrel')) || { x: tl.x + 90, y: tl.y + 40 };
    const roof = chain(ROOF, 6, bf), boom = chain([-87, -42, -54, -38.5, -21, -35, 12, -23, 46, -11], 8), lab = chain([-30, -55, -16, -66, 0, -74, 16, -66, 30, -55], 6);
    const chL = chain([-12, -70, -30, -36, -46, 0], 8), chR = chain([12, -70, 30, -36, 46, 0], 8);
    HOLD = [
      { id: 'mi8', g: 'mi8', ax: c.x, ay: c.y, foot: [-110, -22, 88, 22], h: 30, box: [-110, -98, 180, 54], paint: (g, k) => ridge(g, roof, 6 * k, 1, 1) },
      { id: 'barrel', g: 'mi8', ax: c.x, ay: c.y, foot: [58, 6, 73, 26], h: 20, box: [55, -2, 21, 10], paint: (g, k) => dome(g, 65.5, 5.4, 8.6, 5 * k) },
      { id: 'crates', g: 'mi8', ax: c.x, ay: c.y, foot: [104, -4, 141, 26], h: 15, box: [100, -13, 46, 28],
        paint: (g, k) => { dome(g, 106.4, 5.2, 4.6, 3.4 * k); dome(g, 133.5, 11.2, 8.8, 3.6 * k); dome(g, 117, -6.8, 8.4, 4 * k); } },
      { id: 'blade', g: 'mi8', ax: c.x, ay: c.y, foot: [100, -10, 145, 10], h: 0, cap0: 1, noHit: 1 },
      { id: 'tail', ax: tl.x, ay: tl.y, foot: [-90, -12, 70, 22], h: 18, box: [-92, -58, 154, 50], paint: (g, k) => ridge(g, boom, 4.5 * k, 1, 2) },
      { id: 'barrelT', ax: bt.x, ay: bt.y, foot: [-8, -3, 8, 3], h: 20, box: [-11, -29, 22, 12], paint: (g, k) => dome(g, -0.4, -20.4, 9, 5 * k) },
      { id: 'labaz', ax: lb.x, ay: lb.y, foot: [-22, -5, 22, 5], h: 10, box: [-36, -84, 72, 34], paint: (g, k) => ridge(g, lab, 4.5 * k, 1, 3) },
      { id: 'chum', ax: ch.x, ay: ch.y, foot: [-44, -22, 44, 6], h: 40, box: [-54, -80, 108, 86],
        paint: (g, k) => { ridge(g, chL, 4 * k, -1, 4); ridge(g, chR, 2.4 * k, 1, 5); } },
      { id: 'hut', ax: HUT.x, ay: HUT.y, foot: [-124, -112, 124, 52], h: 44, box: [-142, -236, 284, 266], hut: 1, paint: (g, k) => {
        const line = (x0, y0, x1, y1, n = 10) => { const P = []; for (let i = 0; i <= n; i++) P.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); return P; };
        ridge(g, line(-128, -156, -128, 24, 12), 2.6 * k, -1, 6); ridge(g, line(128, -156, 128, 24, 12), 6.5 * k, 1, 7);   // карниз: подветренный (восток) толще
        ridge(g, line(0, -220, 0, -40, 12), 2.4 * k, -1, 8); ridge(g, line(0, -220, 0, -40, 12), 4 * k, 1, 9);             // конёк
        ridge(g, line(-128, 24, 0, -40, 10), 4 * k, 1, 10); ridge(g, line(0, -40, 128, 24, 10), 4 * k, 1, 11);           // фронтон
      } },
    ];
    BY = {}; for (const h of HOLD) { h.cap = h.cap0 || 0; h.d = 0; h.ms = 0; h.strip = 0; BY[h.id] = h; }
    return HOLD;
  }
  // классы: одна шапка и наддув на класс (ветер у героя), срыв помнится на экземпляре
  const ROCKTOP = [[2, -26], [-6, -24], [6, -20]];
  const CLS = {
    stump: { cap: 0, d: 0, foot: [-7, -3, 7, 2], h: 8, box: [-9, -15, 16, 9], paint: (g, k) => dome(g, -1.8, -8.8, 5.6, 3.2 * k) },
    rock: { cap: 0, d: 0, foot: [-22, -6, 22, 3], h: 18, v: 3, box: v => [ROCKTOP[v][0] - 18, ROCKTOP[v][1] - 7, 32, 12],
      paint: (g, k, v) => dome(g, ROCKTOP[v][0] - 2, ROCKTOP[v][1] + 2, 13.5, 5 * k) },
    stack: { cap: 0, d: 0, foot: [-18, -7, 18, 7], h: 12, v: 5, box: v => [-20, stackTop(v) - 8, 40, 11], paint: (g, k, v) => dome(g, 0, stackTop(v) + 0.6, 17.5, 4 * k) },
  };
  function stackTop(n) { if (n >= 4) return -28; const i = n - 1; return -3 - i * 5.5 - (i % 2 ? 9 : 7.8); }
  const SHED = new WeakMap(); let fallAcc = 0;
  const capOf = (cls, o) => { const s = SHED.get(o); return s == null ? CLS[cls].cap : Math.min(CLS[cls].cap, fallAcc - s); };

  // ---------- шаг логики (2 Гц) ----------
  let acc = 0, lastG = null, clock = 0;
  function fallRate() {
    if (F.fall != null) return F.fall;
    if (typeof G === 'undefined' || !G) return 0;
    return typeof stormOn === 'function' && stormOn() ? 2 : 1; // лёгкий снегопад идёт всегда (экранный, particles.js), пурга — вдвое
  }
  const trans = ms => (ms <= UD ? 0 : Math.min(3, ((ms - UD) / 7) ** 3)); // перенос по земле: поток ∝ (u − u*)³, 11 м/с = 1
  function restore() {
    holders(); lastG = G;
    const day = G && G.day ? G.day : 1, fresh = day <= 1;
    for (const h of HOLD) { h.cap = h.cap0 != null ? h.cap0 : fresh ? 0 : 0.8; h.d = fresh ? 0 : Math.min(1, (day - 1) * 0.22); h.strip = 0; }
    for (const k in CLS) { CLS[k].cap = fresh ? 0 : 0.8; CLS[k].d = fresh ? 0 : Math.min(1, (day - 1) * 0.22); }
    SP.length = 0; ACC.clear();
  }
  function step(dt) {
    const fall = fallRate(), gain = fall * dt / DAY;
    for (const h of HOLD) {
      const ms = h.ms = Wind.ms(h.ax + (h.foot[0] + h.foot[2]) / 2, h.ay + h.foot[1]), strip = ms > UT ? (ms - UT) / STRIP : 0, c0 = h.cap;
      h.cap = cl(c0 + gain - strip * dt, 0, 1); h.strip = strip > 0 && c0 > 0.02 ? strip : 0;
      if (h.h > 0) h.d = Math.min(1, h.d + trans(ms) * dt / DAY + 0.02 * Math.max(0, c0 - h.cap - gain)); // + сдутое с шапки ложится в нанос
    }
    const p = G && G.p, ms = p ? Wind.ms(p.x, p.y) : 0, strip = ms > UT ? (ms - UT) / STRIP : 0;
    for (const k in CLS) { const C = CLS[k]; C.cap = cl(C.cap + gain - strip * dt, 0, 1); C.d = Math.min(1, C.d + trans(ms) * dt / DAY); }
    fallAcc += gain;
  }
  function tick(dt) {
    if (typeof G === 'undefined' || !G) return;
    holders();
    if (G !== lastG) restore();
    clock += dt; acc += dt;
    if (acc >= STEP) { const s = Math.min(acc, 2); acc = 0; step(s); }
  }

  // ---------- срыв: удар / толчок / пинок / разбор / палка → cap = 0, событие 'shed', комья с кромки и пыль ----------
  const stats = { shed: 0, bits: 0, builds: 0, sp: 0, spMax: 0, capDraw: 0, driftDraw: 0 };
  function rectD(h, x, y) {
    const x0 = h.ax + h.foot[0], x1 = h.ax + h.foot[2], y0 = h.ay + h.foot[1], y1 = h.ay + h.foot[3];
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return Math.hypot(dx, dy);
  }
  function spill(x, y, z, w, amt, who) { // комья падают с высоты z (px над опорой y), пыль у земли; low — без частиц
    if (low() || !G || !G.parts) return 0;
    const n = Math.round(6 + 10 * cl(amt, 0, 1));
    for (let i = 0; i < n; i++)
      G.parts.push({ type: 'bit', kind: 'snow', c: i % 3 ? '#f6f9fc' : '#dde6ee', x: x + rr(-w, w), y: y + rr(-2, 3), vx: 0, vy: 0, ux: rr(-14, 14), uy: rr(-3, 3), uz: rr(0, 22),
        gz: rr(160, 240), z0: z, sz: rr(1.3, 2.8), rot: 0, spin: 0, life: rr(1.6, 2.4), max: 2.4, live: 'snow' });
    for (let i = 0, m = 1 + Math.round(2 * amt); i < m; i++)
      G.parts.push({ type: 'puff', x: x + rr(-w * 0.7, w * 0.7), y: y + rr(0, 3), h: z * rr(0.4, 0.9), vx: rr(-6, 10), vy: 0, r0: rr(4, 6), r1: rr(10, 16), life: rr(0.7, 1.1), max: 1.1, live: 'snow' });
    stats.bits += n;
    return n;
  }
  function shed(h, pow, e) {
    const amt = h.cap; if (amt <= 0.05) return 0;
    h.cap = pow >= 0.35 ? 0 : amt * (1 - pow * 2);
    const x = h.ax + h.box[0] + h.box[2] / 2, y = h.ay + Math.min(h.foot[3], 8), z = y - (h.ay + h.box[1] + h.box[3] * 0.7);
    const n = spill(x, y, Math.max(4, z), h.box[2] * 0.4, amt - h.cap, e.who);
    stats.shed++;
    emit('shed', { who: e.who || 'p', x, y, target: h.id, amount: amt - h.cap, bits: n });
    return n;
  }
  function shedInst(cls, o, pow, e) {
    const C = CLS[cls], c0 = capOf(cls, o); if (c0 <= 0.05) return 0;
    SHED.set(o, fallAcc);
    const s = o.s || 1, v = cls === 'rock' ? (o.v || 0) % 3 : cls === 'stack' ? Math.min(4, o.wood | 0) : 0, B = typeof C.box === 'function' ? C.box(v) : C.box;
    const n = spill(o.x + (B[0] + B[2] / 2) * s, o.y + 2, -(B[1] + B[3] * 0.6) * s, B[2] * 0.4 * s, c0, e.who);
    stats.shed++;
    emit('shed', { who: e.who || 'p', x: o.x, y: o.y, target: cls, obj: o, amount: c0, bits: n });
    return n;
  }
  function hitAt(e, pow) {
    if (!G || e.inside || e.kind === 'shed') return;
    holders();
    if (e.obj === 'rock' && e.target) return shedInst('rock', e.target, pow, e);
    let best = null, bd = 26;
    for (const h of HOLD) { if (h.noHit || !h.paint) continue; const d = rectD(h, e.x, e.y); if (d < bd) { bd = d; best = h; } }
    if (best) return shed(best, pow, e);
    if (e.kind === 'kick' || e.kind === 'throw' || e.kind === 'hit') { // пень, куча — рядом с точкой
      for (const s of G.stacks || []) if ((s.x - e.x) ** 2 + (s.y - e.y) ** 2 < 30 * 30 && s.wood > 0 && !(s.lit > 0)) return shedInst('stack', s, pow, e);
      if (typeof treesNear === 'function') for (const t of treesNear(e.x, e.y, 24)) if (t.wood <= 0 && (t.x - e.x) ** 2 + (t.y - e.y) ** 2 < 22 * 22) return shedInst('stump', t, pow, e);
    }
  }
  if (typeof Interact !== 'undefined') {
    Interact.on('bump', e => { const p = e.power == null ? 0.6 : e.power; if (p >= 0.25) hitAt(e, p); });
    Interact.on('push', e => { if (e.t > 1) hitAt(e, 0.2); });
    Interact.on('hit', e => hitAt(e, e.power || 1));
    Interact.on('kick', e => hitAt(e, 1));
    Interact.on('throw', e => hitAt(e, 0.5));
    Interact.on('work', e => { if (e.what === 'wreck') hitAt(e, 0.5); });
  }

  // ---------- наддув: геометрия (мир, от опоры), спрайты по ступени 1–3 и направлению ----------
  // lee — главный нанос за вещью по ветру; wind — наветренный; pit — выдутая ямка у наветренной стенки
  function driftGeo(foot, h, k, dir) {
    const cs = Math.cos(dir), sn = Math.sin(dir), fx = (foot[0] + foot[2]) / 2, fy = (foot[1] + foot[3]) / 2, a = (foot[2] - foot[0]) / 2, b = (foot[3] - foot[1]) / 2;
    const ea = Math.abs(a * cs) + Math.abs(b * sn), eb = Math.abs(a * sn) + Math.abs(b * cs);
    const L = 6 * h * k, D = 1.2 * h * k, Lw = 1.6 * h * k, Dw = 0.45 * h * k;
    return { cs, sn, fx, fy, ea, eb, L, D, Lw, Dw, gap: 0.12 * h, pit: 0.22 * h, h,
      lee: { x0: fx + cs * (ea + 0.12 * h), y0: fy + sn * (ea + 0.12 * h), len: L, depth: D, width: 2 * eb * 0.95 },
      wind: { x0: fx - cs * (ea + 0.3 * h), y0: fy - sn * (ea + 0.3 * h), len: Lw, depth: Dw } };
  }
  const zP = s => (s < 0.22 ? 0.55 + 0.45 * s / 0.22 : Math.pow(1 - (s - 0.22) / 0.78, 1.4)); // профиль высоты вдоль наноса
  // мягкие диски-заготовки (радиальный спад до нуля — у наноса нет контура и видимой границы спрайта)
  const DISC = {};
  const disc = (k, rgb) => DISC[k] || (DISC[k] = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.35, `rgba(${rgb},0.75)`); gr.addColorStop(0.7, `rgba(${rgb},0.25)`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; })());
  const SQ = 0.55; // вид 3/4: круг на земле — эллипс
  // нанос = набор перекрывающихся мягких бугров вдоль слезы: волнистая кромка; свет со стороны солнца (слева-сверху), синеватая тень
  // с подветренной и к югу; заструги вдоль ветра. Тело полупрозрачное — фактура земли (крап, фото-снег) видна сквозь него.
  function driftBlobs(Q, k, seed) {
    const { cs, sn, fx, fy, ea, eb, L, D, Lw, Dw, h } = Q, r = ArtWorld.rng(seed), B = [];
    const P = (u, v, z) => [fx + cs * u - sn * v, fy + sn * u + cs * v - z * 0.35];
    const u0 = ea + 0.1 * h, n = Math.round(cl(6 + L / 9, 6, 42));
    for (let i = 0; i < n; i++) { // главный нанос
      const s = (i + r() * 0.8) / n, w = eb * (0.6 + 0.4 * sm(0, 0.18, s)) * Math.pow(Math.max(0, 1 - Math.pow(s, 1.5)), 0.75), z = D * zP(s);
      const v = (r() - 0.5) * 1.1 * w, rad = (w * (0.55 + 0.45 * r()) + z * 0.4) * (0.8 + 0.3 * (1 - s));
      if (rad < 3.5) continue; // хвост наноса гаснет, без точек
      B.push({ p: P(u0 + s * L + (r() - 0.5) * L / n, v, z * (1 - Math.abs(v) / (w + 1e-6) * 0.6)), rad, z, s, lee: s > 0.25 });
    }
    const m = Math.round(cl(3 + Lw / 8, 3, 10));
    for (let i = 0; i < m; i++) { const s = (i + r()) / m, rad = eb * (0.35 + 0.3 * r()) * (1 - Math.abs(s - 0.5)); B.push({ p: P(-(ea + 0.3 * h + s * Lw), (r() - 0.5) * eb * 1.2, Dw * Math.sin(Math.PI * s)), rad: Math.max(3, rad), z: Dw, s: 0.3, wind: 1 }); }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const b of B) { x0 = Math.min(x0, b.p[0] - b.rad * 1.4); x1 = Math.max(x1, b.p[0] + b.rad * 1.6); y0 = Math.min(y0, b.p[1] - b.rad * SQ * 1.4); y1 = Math.max(y1, b.p[1] + b.rad * SQ * 1.6); }
    const pit = P(-(ea + Q.pit * 0.45), 0, 0);
    x0 = Math.min(x0, pit[0] - Q.pit * 2); x1 = Math.max(x1, pit[0] + Q.pit * 2);
    return { B, pit, box: [Math.floor(x0 - 2), Math.floor(y0 - 2), Math.ceil(x1 - x0 + 4), Math.ceil(y1 - y0 + 4)], P, u0 };
  }
  function paintDrift(g, Q, k, D0) {
    const { cs, sn, eb, L } = Q, { B, pit, P, u0 } = D0, a = Math.atan2(sn, cs);
    const blit = (img, x, y, rx, ry, al) => { g.globalAlpha = al; g.drawImage(img, x - rx, y - ry, rx * 2, ry * 2); };
    const W = disc('w', '250,252,255'), S = disc('s', '118,146,178'), Hh = disc('h', '255,255,255');
    // выдутая ямка у наветренной стенки: мягкая синеватая впадина, светлый край с наветренной стороны
    blit(S, pit[0], pit[1], Q.pit * 2.2, eb * 0.95 * SQ * 1.9, 0.09 + 0.09 * k);
    blit(W, pit[0] - cs * Q.pit, pit[1] - sn * Q.pit, Q.pit * 0.8, eb * SQ * 1.4, 0.18 * k);
    // тени бугров: к подветренной (по ветру) и к югу — свет слева-сверху
    for (const b of B) blit(S, b.p[0] + cs * b.rad * 0.45 + b.rad * 0.12, b.p[1] + sn * b.rad * 0.45 + b.rad * SQ * 0.35, b.rad * 1.05, b.rad * SQ * 1.05, (b.wind ? 0.12 : b.lee ? 0.26 : 0.16) * (0.5 + 0.5 * k));
    // тела бугров — чуть светлее земли, полупрозрачные
    for (const b of B) blit(W, b.p[0], b.p[1], b.rad, b.rad * SQ, (b.wind ? 0.24 : 0.32) * (0.6 + 0.4 * k));
    // свет гребня со стороны солнца
    for (const b of B) if (!b.wind && b.s < 0.75) blit(Hh, b.p[0] - b.rad * 0.3, b.p[1] - b.rad * SQ * 0.35, b.rad * 0.55, b.rad * SQ * 0.45, 0.32 * (0.5 + 0.5 * k));
    g.globalAlpha = 1;
    // заструги: тонкие волнистые гряды вдоль ветра (свет + тень), концы гаснут — короткими штрихами с падающей прозрачностью
    const r = ArtWorld.rng(D0.seed ^ 0x9E37), nz = Math.round(cl(L / 14, 2, 14));
    g.lineCap = 'round'; g.lineWidth = 0.9;
    for (let i = 0; i < nz; i++) {
      const s0 = 0.08 + r() * 0.6, len = (0.15 + r() * 0.25) * L, v = (r() - 0.5) * eb * 0.9, seg = 5;
      for (let j = 0; j < seg; j++) {
        const t0 = j / seg, t1 = (j + 1) / seg, al = Math.sin(Math.PI * (t0 + t1) / 2) * 0.22 * k;
        const A = P(u0 + s0 * L + t0 * len, v + Math.sin(t0 * 5 + i) * 1.5, 0), C = P(u0 + s0 * L + t1 * len, v + Math.sin(t1 * 5 + i) * 1.5, 0);
        g.strokeStyle = `rgba(255,255,255,${al.toFixed(3)})`; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke();
        g.strokeStyle = `rgba(111,142,168,${(al * 0.7).toFixed(3)})`; g.beginPath(); g.moveTo(A[0], A[1] + 1); g.lineTo(C[0], C[1] + 1); g.stroke();
      }
    }
  }
  function driftBox(Q) { return driftBlobs(Q, 1, 1).box; }
  const DS = new Map(); let lastBuild = -1e9;
  const dsc = () => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) * 0.75;
  function driftSprite(key, foot, h, st, dir, T) {
    const dq = Math.round(dir / (TAU / 8)) & 7, K = key + '-' + st + '-' + dq, s = dsc(), KK = K + '@' + s;
    let e = DS.get(KK); if (e) return e;
    if (T - lastBuild < BUILD_GAP && T >= lastBuild) return null; // перепечь: не чаще 1 спрайта за 0.25 с (~0.3 мс каждый)
    lastBuild = T; stats.builds++; const t0 = performance.now();
    let seed = 0x3C1; for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619) >>> 0;
    const Q = driftGeo(foot, h, st / 3, dq * TAU / 8), D0 = driftBlobs(Q, st / 3, seed), B = D0.box, c = document.createElement('canvas'); D0.seed = seed;
    c.width = Math.max(1, Math.ceil(B[2] * s)); c.height = Math.max(1, Math.ceil(B[3] * s));
    const g = c.getContext('2d'); g.scale(s, s); g.translate(-B[0], -B[1]); paintDrift(g, Q, st / 3, D0);
    e = { c, B }; DS.set(KK, e); stats.buildMs = Math.max(stats.buildMs || 0, performance.now() - t0);
    return e;
  }
  // одна ступень-спрайт (ceil(3d)), растянутая вдоль ветра на 3d/ступень от середины вещи — рост плавный, один drawImage
  function drawDrift(g, key, foot, h, d, ax, ay, sc, T, dir) {
    if (d <= 0.004) return;
    const L = d * 3, st = low() ? Math.max(1, Math.min(3, Math.round(L))) : Math.min(3, Math.ceil(L - 1e-6));
    const e = driftSprite(key, foot, h, st, dir, T); if (!e) return;
    const B = e.B, k = low() ? 1 : L / st;
    if (k > 0.995) g.drawImage(e.c, ax + B[0] * sc, ay + B[1] * sc, B[2] * sc, B[3] * sc);
    else {
      const th = (Math.round(dir / (TAU / 8)) & 7) * TAU / 8, cs = Math.cos(th), sn = Math.sin(th), fx = ax + (foot[0] + foot[2]) / 2 * sc, fy = ay + (foot[1] + foot[3]) / 2 * sc;
      const a = 1 + (k - 1) * cs * cs, bb = (k - 1) * cs * sn, dd = 1 + (k - 1) * sn * sn; // растяжение k вдоль (cos, sin) вокруг (fx, fy)
      g.save(); g.transform(a, bb, bb, dd, fx - a * fx - bb * fy, fy - bb * fx - dd * fy);
      g.drawImage(e.c, ax + B[0] * sc, ay + B[1] * sc, B[2] * sc, B[3] * sc); g.restore();
    }
    stats.driftDraw++;
  }

  // ---------- позёмка: свой пул, частицы с гребней при ветре ≥ 5 м/с ----------
  const SP = [], ACC = new Map();
  let SPR = null;
  const spr = () => SPR || (SPR = (() => { const c = document.createElement('canvas'); c.width = 48; c.height = 12; const g = c.getContext('2d'), gr = g.createRadialGradient(24, 6, 0, 24, 6, 24);
    gr.addColorStop(0, 'rgba(250,252,255,0.9)'); gr.addColorStop(0.5, 'rgba(246,249,252,0.45)'); gr.addColorStop(1, 'rgba(246,249,252,0)'); g.setTransform(1, 0, 0, 0.25, 0, 4.5); g.fillStyle = gr; g.fillRect(0, -18, 48, 48); return c; })());
  function source(key, x, y, z, w, dt, k = 1) { // гребень в (x, y) на высоте z, ширина w: темп ∝ (ms − 5)
    const ms = Wind.ms(x, y); if (ms < UP) { ACC.delete(key); return; }
    let a = (ACC.get(key) || 0) + Math.min(8, 1.4 * (ms - UP)) * k * dt;
    while (a >= 1) {
      a -= 1; if (SP.length >= SPMAX) { a = 0; break; }
      const v = Wind.px(ms);
      SP.push({ x: x + rr(-w, w) * 0.5, y: y + rr(-2, 2), z: z * rr(0.6, 1), vx: v * rr(0.55, 0.9), vz: rr(-2, 6), life: rr(0.7, 1.3), max: 1.3, len: rr(12, 24) * (0.6 + ms / 20), a: rr(0.22, 0.42) });
    }
    ACC.set(key, a);
  }
  const DNEAR = []; let srcT = 0;
  function groundStep(view, dt) { // шаг позёмки (то же зовёт рендер): источники в кадре → частицы; ≤ 30
    for (let i = 0; i < SP.length; i++) { const q = SP[i]; q.life -= dt; q.x += q.vx * dt; q.z = Math.max(0, q.z + q.vz * dt); }
    for (let i = SP.length - 1; i >= 0; i--) if (SP[i].life <= 0) SP.splice(i, 1);
    if (low() || !G) { SP.length = 0; return; }
    srcT += dt; if (srcT < 0.1) return; dt = srcT; srcT = 0; // источники — 10 Гц (темп тот же, выборок ветра в 6 раз меньше)
    const [x0, y0, x1, y1] = view, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, inV = (x, y) => x > x0 - 40 && x < x1 + 40 && y > y0 - 20 && y < y1 + 60;
    if (Wind.ms(cx, cy) < UP * 0.6 && Wind.base() < UP) { ACC.clear(); return; } // заведомый штиль — без выборок
    let n = 0;
    if (typeof Space !== 'undefined' && Space.drifts) { DNEAR.length = 0; for (const d of Space.drifts.near(cx, cy, Math.max(x1 - x0, y1 - y0) / 2 + 60, DNEAR)) if (inV(d.x, d.y) && n++ < 10) source(d, d.x - d.rx * 0.15, d.y - d.ry * 0.3, 3, d.rx, dt, 0.7); }
    for (const h of HOLD) {
      if (!inV(h.ax, h.ay)) continue;
      if (h.d > 0.05 && h.h > 0) { const Q = driftGeo(h.foot, h.h, h.d, Wind.at(h.ax, h.ay).dir); source(h, h.ax + Q.lee.x0 + Q.cs * Q.L * 0.22, h.ay + Q.lee.y0 + Q.sn * Q.L * 0.22, Q.D * 0.5, Q.lee.width * 0.6, dt, 1); }
      if (h.strip > 0 && h.paint) source(h.box, h.ax + h.box[0] + h.box[2] / 2, h.ay + h.foot[3], -h.box[1] - h.box[3] * 0.5, h.box[2] * 0.8, dt, 1.2); // сдув с шапки
    }
    stats.sp = SP.length; stats.spMax = Math.max(stats.spMax, SP.length);
  }
  function drawSP(g) {
    if (!SP.length) return;
    const S = spr();
    for (const q of SP) {
      const u = q.life / q.max, a = q.a * Math.min(1, u * 3) * Math.min(1, (1 - u) * 5);
      g.globalAlpha = a; g.drawImage(S, q.x - q.len / 2, q.y - q.z - 2.5, q.len, 5);
    }
    g.globalAlpha = 1;
  }

  // ---------- рисунок: земля (наддувы + позёмка) ----------
  let gT = null;
  const QN = [], QR = [], QS = []; let QT = -1e9, QX = 0, QY = 0;
  function ground(g, view, env) {
    if (typeof G === 'undefined' || !G) return;
    holders(); if (G !== lastG) restore();
    const T = env && env.now != null ? env.now : typeof now === 'number' ? now : 0, dt = gT == null ? 0 : cl(T - gT, 0, 0.05); gT = T;
    stats.driftDraw = 0;
    const [x0, y0, x1, y1] = view, inV = (x, y, m) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
    for (const h of HOLD) if (h.h > 0 && h.d > 0.004 && inV(h.ax, h.ay, 6 * h.h + 160)) drawDrift(g, h.id, h.foot, h.h, h.d, h.ax, h.ay, 1, T, Wind.at(h.ax, h.ay).dir);
    if (!low()) { // классы: глыбы, пни, кучи — наддув одной ступенью класса у каждой видимой
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(x1 - x0, y1 - y0) / 2 + 80, dir = Wind.at(cx, cy).dir;
      if (Math.abs(T - QT) > 0.25 || Math.abs(cx - QX) > 64 || Math.abs(cy - QY) > 64) { // списки глыб и пней в кадре — раз в 0.25 с
        QT = T; QX = cx; QY = cy; QR.length = 0; QS.length = 0;
        if (typeof Space !== 'undefined' && Space.rocks) { QN.length = 0; for (const q of Space.rocks.near(cx, cy, r, QN)) if (inV(q.x, q.y, 180)) QR.push(q); }
        if (typeof treesNear === 'function') { QN.length = 0; for (const t of treesNear(cx, cy, r, QN)) if (t.wood <= 0 && inV(t.x, t.y, 120)) QS.push(t); }
      }
      const C = CLS.rock; if (C.d > 0.004) for (const q of QR) drawDrift(g, 'rock', C.foot, C.h, C.d, q.x, q.y, q.s || 1, T, dir);
      const S = CLS.stump; if (S.d > 0.004) for (const t of QS) if (t.wood <= 0) drawDrift(g, 'stump', S.foot, S.h, S.d, t.x, t.y, t.s || 1, T, dir);
      const K = CLS.stack; if (K.d > 0.004) for (const s of G.stacks || []) if (inV(s.x, s.y, 100)) drawDrift(g, 'stack', K.foot, K.h, K.d, s.x, s.y, 1, T, dir);
    }
    groundStep(view, dt); drawSP(g);
  }

  // ---------- рисунок: шапки ----------
  const capSprite = (key, B, paint, k, v) => ArtWorld.sprite('snowcap-' + key + '-' + Math.round(k * 6), B[2], B[3], g => { g.translate(-B[0], -B[1]); paint(g, k, v); });
  function drawCap(g, h) {
    const n = Math.round(h.cap * 6); if (!n || !h.paint) return 0;
    const S = capSprite(h.id, h.box, h.paint, n / 6); g.drawImage(S, h.ax + h.box[0], h.ay + h.box[1], h.box[2], h.box[3]); stats.capDraw++;
    return 1;
  }
  function drawInst(g, cls, o, v) {
    const C = CLS[cls], n = Math.round(capOf(cls, o) * 6); if (!n) return;
    const B = typeof C.box === 'function' ? C.box(v) : C.box, s = cls === 'stack' ? 1 : o.s || 1;
    const S = capSprite(cls + v, B, C.paint, n / 6, v); g.drawImage(S, o.x + B[0] * s, o.y + B[1] * s, B[2] * s, B[3] * s); stats.capDraw++;
  }
  // после вещи в сортировке gfx: k — вид элемента списка (gfx.js scene)
  function after(g, k, o) {
    if (!HOLD) return;
    switch (k) {
      case 0: if (o && o.wood <= 0) drawInst(g, 'stump', o, 0); break;
      case 4: if (o && o.wood > 0 && !(o.lit > 0)) drawInst(g, 'stack', o, Math.min(4, o.wood | 0)); break;
      case 33: if (o) drawInst(g, 'rock', o, (o.v || 0) % 3); break;
      case 10: drawCap(g, BY.tail); break;
      case 11: drawCap(g, BY.chum); break;
      case 14: drawCap(g, BY.labaz); break;
      case 21: if (G && G.p && !G.p.inside) drawCap(g, BY.hut); break;
      case 26: if (o && o.id === 'barrel') drawCap(g, BY.barrelT); break;
    }
  }
  function drawMi8(g) { holders(); return drawCap(g, BY.mi8) + drawCap(g, BY.barrel) + drawCap(g, BY.crates); } // из Live.drawWreck (после переднего сегмента)

  // ---------- следы: жизнь × по ветру у героя ----------
  function printRate(storm) {
    const p = typeof G !== 'undefined' && G && G.p, ms = p ? Wind.ms(p.x, p.y) : Wind.base();
    const r = 0.25 + 0.75 * sm(3, 4.5, ms) + sm(7, 9, ms) + 2 * sm(13, 17, ms); // штиль 0.25 · 5 м/с 1 · 10 м/с 2 · 17+ м/с 4
    return storm ? Math.max(4, r) : r;
  }

  // ---------- API ----------
  function cap(id) { holders(); return BY[id] ? BY[id].cap : CLS[id] ? CLS[id].cap : 0; }
  function set(id, v, d) { holders(); const h = BY[id] || CLS[id]; if (!h) return; if (v != null) h.cap = cl(v, 0, 1); if (d != null) h.d = cl(d, 0, 1); }
  function take(id, a) { holders(); const h = BY[id]; if (!h) return 0; const c0 = h.cap; h.cap = Math.max(0, c0 - a); return c0; }
  function force(o) { F.fall = null; if (o) Object.assign(F, o); }
  function state() {
    holders();
    const o = {}; for (const h of HOLD) o[h.id] = { cap: h.cap, d: h.d, step: Math.min(3, Math.floor(h.d * 3 + 1e-9)), ms: h.ms, strip: h.strip };
    for (const k in CLS) o[k] = { cap: CLS[k].cap, d: CLS[k].d, step: Math.min(3, Math.floor(CLS[k].d * 3 + 1e-9)) };
    return { hold: o, sp: SP.length, stats: Object.assign({}, stats), fallAcc };
  }
  function geo(id, dir = 0) { holders(); const h = BY[id]; if (!h) return null; const Q = driftGeo(h.foot, h.h, h.d, dir); return { ax: h.ax, ay: h.ay, foot: h.foot, h: h.h, lee: Q.lee, wind: Q.wind, pit: Q.pit }; }
  function reset() { holders(); lastG = null; if (typeof G !== 'undefined' && G) restore(); acc = 0; }
  return { tick, step, ground, groundStep, after, drawMi8, drawDrift, printRate, cap, set, take, force, state, geo, reset, capOf, stats, UT, UD, UP, get holders() { return holders(); }, CLS };
})();
