'use strict';
// Live — живые вещи от единого ветра (паспорт волны 1, docs/design/INTERACTION-PASSPORT.md №2–№7):
//   Ми-8 разрезан: неподвижный корпус (спрайт 'static') + живые части поверх в тех же координатах —
//     🌀 согнутая лопасть: качается с 5 м/с ∝ ветру, дрожит ~1 с после удара, с кромки падают комья снега (шапка — общая, js/snow.js);
//     🚪 сдвижная дверь: качается на ролике с 6 м/с, хлопает на фронте порыва ≥ 10 м/с (не чаще 6 с) — звук + 'noise', снег в проём;
//     〰️ провода из разлома: цепочки 8 точек на пружинах к своей форме, раскачка ∝ м/с², герой задевает — 'touch';
//   🚩 вымпел на шесте: обвис (< 1.6 м/с) → развёрнут и полощется → хлопает → в пургу рвётся к краю; фаза по x;
//   📄 записки: уголок трепещет (≤ 3 px ∝ м/с), с 5.5 м/с подпрыгивают (≤ 12 px), не дальше 34 px от камня — всегда читаемы.
// Шаг — в рендере, только для того, что рисуется (в кадре +запас), своим потоком случайности (Math.random игры не тратит).
// QUALITY=low: провода — одна дуга с точкой качания, вымпел — 2 сегмента, записки — только трепет, без комьев снега.
// Счётчики для тестов: Live.stats (drawImage и мс на обломки за кадр), Live.state().
const Live = (() => {
  const TAU = Math.PI * 2;
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const R = ArtWorld.rng(0x11FE), rr = (a, b) => a + R() * (b - a);
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
  const snd = () => typeof Sound !== 'undefined' && Sound.ok && Sound.ok();
  const W = (x, y) => Wind.at(x, y);
  const emit = (k, e) => { if (typeof Interact !== 'undefined') Interact.emit(k, e); };
  // корпус Ми-8 повёрнут: координаты корпуса → координаты спрайта (опора — POI.cockpit)
  const CO = Math.cos(-0.09), SI = Math.sin(-0.09);
  const bf = (x, y) => [-10 + x * CO - y * SI, -36 + x * SI + y * CO];

  // ---------- спрайты частей: вырезка спрайта (u, v — от левого верхнего угла 320×210), кратно 10 px — без субпиксельного сдвига ----------
  const PART = { door: { u0: 160, v0: 70, w: 40, h: 60 }, lip: { u0: 150, v0: 50, w: 50, h: 50 }, blade: { u0: 150, v0: 30, w: 160, h: 120 } };
  const ORDER = ['door', 'lip', 'blade']; // как в прежней покраске: дверь → снег крыши над ней → лопасть поверх всего
  const partSprite = k => { const P = PART[k]; return ArtWorld.sprite('mi8' + k, P.w, P.h, g => { g.translate(160 - P.u0, 140 - P.v0); ArtWorld.paintMi8(g, k); }); };

  // ---------- 🌀 лопасть ----------
  const BROOT = [-8, -95], BLEN = Math.hypot(146, 100);
  const BL = { ampS: 0, ph: 0, vibT: 9, vibA: 0, off: 0, ang: 0, cap: 1, shedT: -99, gPrev: 0, shed: 0 };
  // снег на кромке — общая шапка js/snow.js ('blade': растёт в снегопад, сдувается ветром > 7.7 м/с); без Snow (стенды) — своя
  const HAS_SNOW = () => typeof Snow !== 'undefined';
  const bladeCap = () => (HAS_SNOW() ? Snow.cap('blade') : BL.cap);
  function bladeStep(dt, t, c) {
    const w = W(c.x + 60, c.y - 60), drive = w.ms < 5 ? 0 : 0.34 * (w.ms - 5) * (0.35 + 0.65 * w.gust); // px размаха кончика
    BL.ampS += (drive - BL.ampS) * (1 - Math.exp(-dt / 0.35));
    BL.ph += TAU * 1.1 * dt;
    const sway = BL.ampS * (0.75 * Math.sin(BL.ph) + 0.25 * Math.sin(BL.ph * 2.13 + 1));
    BL.vibT += dt;
    const vib = BL.vibT < 3 ? BL.vibA * Math.exp(-BL.vibT / 0.4) * Math.sin(TAU * 8 * BL.vibT) : 0;
    BL.off = sway + vib; BL.ang = BL.off / BLEN;
    if (!HAS_SNOW()) BL.cap = Math.min(1, BL.cap + dt / 40);
    if (w.ms >= 8 && w.gust > 0.7 && BL.gPrev <= 0.7 && t - BL.shedT > 4) { BL.shedT = t; bladeShed(0.4, c); }
    BL.gPrev = w.gust;
  }
  function bladeHit(p, c) {
    BL.vibT = 0; BL.vibA = 1.5 + 3 * cl(p, 0, 1);
    bladeShed(p, c);
    if (snd()) Sound.src(c).tone('sine', 110, 80, 0.6, 0.05, 0, { lp: 600 }); // низкий гул «бам»
  }
  // комья снега с кромки лопасти: точки верхней кромки (кривая −6,−99 → 60,−104 → 100,−86), падают на снег перед бортом
  function bladeShed(p, c) {
    if (bladeCap() <= 0.3 || !G || !G.parts) return 0;
    const n = low() ? 0 : Math.round(8 + 4 * cl(p, 0, 1)), gy = 8;
    for (let i = 0; i < n; i++) {
      const u = rr(0.05, 1), x = (1 - u) * (1 - u) * -6 + 2 * u * (1 - u) * 60 + u * u * 100, y = (1 - u) * (1 - u) * -99 + 2 * u * (1 - u) * -104 + u * u * -86;
      G.parts.push({ type: 'bit', kind: 'snow', c: i % 3 ? '#f6f9fc' : '#dde6ee', x: c.x + x, y: c.y + gy + rr(-2, 2), vx: 0, vy: 0, ux: rr(-8, 14), uy: rr(-3, 3), uz: rr(0, 14),
        gz: rr(150, 220), z0: gy - y, sz: rr(1.2, 2.6), rot: 0, spin: 0, life: rr(1.8, 2.5), max: 2.5, live: 'blade' });
    }
    const a = 0.35 + 0.4 * cl(p, 0, 1);
    if (HAS_SNOW()) Snow.take('blade', a); else BL.cap = Math.max(0, BL.cap - a);
    BL.shed += n;
    return n;
  }

  // ---------- 🚪 дверь: маятник на верхнем ролике + сдвиг по направляющей (хлопок) ----------
  const DHINGE = bf(27, -23), DOPEN = [bf(-6, -22), bf(16, 18)];
  const DR = { ang: 0, av: 0, sl: 0, sv: 0, lastSlam: -99, gPrev: 0, slams: 0, clank: 0, snowAcc: 0, pushT: -99 };
  function doorStep(dt, t, c) {
    const w = W(c.x + 17, c.y - 40), ms = w.ms;
    const drive = ms < 6 ? 0 : 3 * (Math.min(ms, 14) - 6) * (w.gust - 0.45 + 0.35 * Math.sin(TAU * 0.6 * t + 0.7));
    if (ms >= 10 && w.gust > 0.8 && DR.gPrev <= 0.8 && t - DR.lastSlam >= 6) { DR.lastSlam = t; DR.sv = -230; DR.clank = 1; }
    DR.gPrev = w.gust;
    for (let s = dt; s > 1e-6; s -= 1 / 60) {
      const h = Math.min(s, 1 / 60), om = TAU * 1.4;
      DR.av += (-om * om * DR.ang - 5.5 * DR.av + drive) * h; DR.ang += DR.av * h;
      DR.sv += (-36 * DR.sl - 3 * DR.sv) * h; DR.sl += DR.sv * h;
      if (DR.sl < -16) { DR.sl = -16; DR.sv = -DR.sv * 0.3; if (DR.clank) doorSlam(c); }
    }
    if (!isFinite(DR.ang + DR.sl)) DR.ang = DR.av = DR.sl = DR.sv = 0;
    // снег задувает в проём: с 8 м/с, темп ∝ ветру; облачко — над опорой борта (сортировка по y — перед корпусом)
    if (ms >= 8 && G && G.parts) {
      DR.snowAcc += (ms - 8) * (low() ? 0.4 : 0.8) * dt;
      while (DR.snowAcc >= 1) {
        DR.snowAcc -= 1;
        const k = R(), px = DOPEN[0][0] + (DOPEN[1][0] - DOPEN[0][0]) * k, py = DOPEN[0][1] + (DOPEN[1][1] - DOPEN[0][1]) * R(), yb = c.y + 2;
        G.parts.push({ type: 'puff', x: c.x + px, y: yb, h: yb - (c.y + py), vx: rr(4, 16), vy: 0, r0: 2, r1: rr(5, 8), life: rr(0.6, 0.9), max: 0.9, live: 'door' });
      }
    }
  }
  function doorSlam(c) {
    DR.clank = 0; DR.slams++; DR.av += rr(-1.2, 1.2);
    const x = c.x + DHINGE[0], y = c.y;
    if (snd()) { const S = Sound.src(POI.cockpit); S.burst(0.09, 'lowpass', 420, 0.66, 1, { r: R() }); S.tone('sine', 110, 42, 0.14, 0.4, 0, { lp: 400 }); S.tone('square', 190, 120, 0.18, 0.05, 0, { lp: 900 }); } // лязг без Math.random игры
    emit('noise', { who: 'door', obj: 'door', x, y, power: 0.7 });
    if (G && G.parts && !low()) ArtWorld.fx.snowPuff(G.parts, c.x + DHINGE[0] - 8, c.y + 2, 0.3);
  }
  function doorPush(p) { DR.av += (0.4 + 0.9 * cl(p, 0, 1)) * (R() < 0.5 ? -1 : 1); if (snd() && now - DR.pushT > 0.6) { DR.pushT = now; const S = Sound.src(POI.cockpit); S.tone('triangle', 900 + 80 * R(), 200, 0.45, 0.28, 0, { lp: 2000, a: 0.03 }); S.tone('sawtooth', 120, 90, 0.4, 0.08, 0, { lp: 500, a: 0.05 }); } } // скрип (как Sound.creak, без Math.random)

  // ---------- 〰️ провода: цепочки 8 точек (координаты спрайта), конец свободный, пружина к своей форме ----------
  const WN = 8, WIRES = [];
  function wiresInit() {
    if (WIRES.length) return;
    const DK = { '#313031': '#2b2c31', '#ca4528': '#a83d29' }; // свет корпуса (правый бок темнее) — как в прежнем спрайте
    ArtWorld.mi8Wires().forEach((w, j) => {
      const P = [];
      for (let i = 0; i < WN; i++) {
        const u = i / (WN - 1), a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, d = 3 * u * u * (1 - u), e = u ** 3;
        const q = bf(a * w[1] + b * w[3] + d * w[5] + e * w[7], a * w[2] + b * w[4] + d * w[6] + e * w[8]);
        P.push({ rx: q[0], ry: q[1], x: q[0], y: q[1], px: q[0], py: q[1] });
      }
      const L = []; for (let i = 0; i < WN - 1; i++) L.push(Math.hypot(P[i + 1].rx - P[i].rx, P[i + 1].ry - P[i].ry));
      WIRES.push({ col: DK[w[0]] || w[0], P, L, j, raw: w, touchT: -99, hum: 0 });
    });
  }
  function wiresStep(dt, t, c) {
    wiresInit();
    const w = W(c.x + 85, c.y - 30), ms = w.ms, hero = G && G.p ? G.p : null;
    const hx = hero ? hero.x - c.x : 1e9, hy = hero ? hero.y - c.y : 1e9, depth = hero && !hero.inside && Math.abs(hy + 11) < 18;
    for (const C of WIRES) {
      C.hum = ms >= 8 ? 1 : 0;
      if (low()) { C.sway = Math.min(6, 0.9 * ms * ms / 40) * (0.65 + 0.35 * Math.sin(TAU * 0.9 * t + C.j * 1.7)); continue; }
      let touched = false;
      for (let s = Math.min(dt, 0.1); s > 1e-6; s -= 1 / 60) {
        const h = Math.min(s, 1 / 60), damp = Math.exp(-5 * h);
        for (let i = 1; i < WN; i++) {
          const p = C.P[i], k = i / (WN - 1);
          const ax = 0.9 * ms * ms * (0.65 + 0.35 * Math.sin(TAU * 0.9 * t + C.j * 1.7 + i * 0.45)) * k + 50 * (p.rx - p.x), ay = 50 * (p.ry - p.y);
          const nx = p.x + (p.x - p.px) * damp + ax * h * h, ny = p.y + (p.y - p.py) * damp + ay * h * h;
          p.px = p.x; p.py = p.y; p.x = nx; p.y = ny;
        }
        for (let it = 0; it < 3; it++) for (let i = 0; i < WN - 1; i++) { // длина звеньев (растяжение ≤ 5 %); первая точка — в разломе
          const a = C.P[i], b = C.P[i + 1], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6, e = (d - C.L[i]) / d;
          if (i === 0) { b.x -= dx * e; b.y -= dy * e; } else { a.x += dx * e * 0.5; a.y += dy * e * 0.5; b.x -= dx * e * 0.5; b.y -= dy * e * 0.5; }
        }
        if (depth) for (let i = 1; i < WN; i++) { // тело героя (±12 px, рост 44) раздвигает провод; провод жёсткий — не дальше 14 px от своей формы
          const p = C.P[i];
          if (p.y > hy - 44 && p.y < hy + 2 && Math.abs(p.x - hx) < 12) { p.x = p.px = cl(hx + (p.x < hx ? -12 : 12), p.rx - 14, p.rx + 14); touched = true; }
        }
        if (touched) for (const p of C.P) { p.x = cl(p.x, p.rx - 14, p.rx + 14); p.y = cl(p.y, p.ry - 14, p.ry + 14); p.px += (p.x - p.px) * 0.7; p.py += (p.y - p.py) * 0.7; } // толчок без разгона
      }
      for (const p of C.P) if (!isFinite(p.x + p.y)) { for (const q of C.P) { q.x = q.px = q.rx; q.y = q.py = q.ry; } break; }
      if (touched && now - C.touchT > 0.8) { C.touchT = now; emit('touch', { who: 'p', obj: 'wire', x: c.x + hx, y: c.y + hy }); }
    }
    if (ms >= 8 && snd() && hero && (hero.x - c.x) ** 2 + (hero.y - c.y) ** 2 < 260 * 260 && now - (WIRES.humT || -99) > 3.2) { WIRES.humT = now; Sound.src(c).tone('sine', 104, 98, 1.4, 0.018, 0, { a: 0.3 }); } // гул с 8 м/с
  }
  function wiresDraw(g, c) {
    wiresInit(); g.lineWidth = 1; g.lineCap = 'butt';
    for (const C of WIRES) {
      g.strokeStyle = C.col; g.beginPath();
      if (low()) { // запечённая дуга + одна точка качания (конец)
        const w = C.raw, s = C.sway || 0, A = bf(w[1], w[2]), B = bf(w[3], w[4]), D = bf(w[5], w[6]), E = bf(w[7], w[8]);
        g.moveTo(c.x + A[0], c.y + A[1]); g.bezierCurveTo(c.x + B[0], c.y + B[1], c.x + D[0] + s * 0.5, c.y + D[1], c.x + E[0] + s, c.y + E[1]);
      } else {
        const P = C.P; g.moveTo(c.x + P[0].x, c.y + P[0].y);
        for (let i = 1; i < WN - 1; i++) g.quadraticCurveTo(c.x + P[i].x, c.y + P[i].y, c.x + (P[i].x + P[i + 1].x) / 2, c.y + (P[i].y + P[i + 1].y) / 2);
        g.lineTo(c.x + P[WN - 1].x, c.y + P[WN - 1].y);
      }
      g.stroke();
    }
  }

  // ---------- обломки: шаг раз за кадр + отрисовка по сегментам (порядок по y сохранён; часть, что шире сегмента, — под clip) ----------
  const stats = { img: 0, ms: 0 }, cur = { img: 0, ms: 0 };
  let wT = null;
  function wreckStep(dt) {
    const c = POI.cockpit, t = Wind.clock();
    bladeStep(dt, t, c); doorStep(dt, t, c); wiresStep(dt, t, c);
  }
  function drawWreck(g, a, b, S, env) {
    const t0 = performance.now(), c = POI.cockpit, sc = S.width / 320, T = env ? env.now : now;
    if (T !== wT) { // первый сегмент кадра: итог прошлого кадра → stats, шаг частей
      stats.img = cur.img; stats.ms = cur.ms; cur.img = 0; cur.ms = 0;
      wreckStep(wT == null ? 0 : cl(T - wT, 0, 0.05)); wT = T;
    }
    const sa = Math.round(a * sc), sb = Math.round(b * sc), X0 = c.x - 160 + sa / sc, X1 = c.x - 160 + sb / sc;
    g.drawImage(S, sa, 0, sb - sa, S.height, X0, c.y - 140, (sb - sa) / sc, 210); cur.img++;
    for (const k of ORDER) {
      const P = PART[k]; if (P.u0 + P.w <= a || P.u0 >= b) continue;
      const clip = P.u0 < a || P.u0 + P.w > b;
      if (clip) { g.save(); g.beginPath(); g.rect(X0, c.y - 140, X1 - X0, 210); g.clip(); }
      drawPart(g, k, c); cur.img++;
      if (clip) g.restore();
    }
    if (a <= 240 && b > 240) wiresDraw(g, c);
    if (a === 0 && HAS_SNOW() && !(typeof window !== 'undefined' && window.SNOW_OFF)) cur.img += Snow.drawMi8(g); // шапки: крыша, бочка, ящики — после переднего сегмента
    cur.ms += performance.now() - t0;
  }
  function drawPart(g, k, c) {
    const P = PART[k], S = partSprite(k), x = c.x - 160 + P.u0, y = c.y - 140 + P.v0;
    if (k === 'blade' && Math.abs(BL.ang) > 1e-5) {
      const rx = c.x + BROOT[0], ry = c.y + BROOT[1];
      g.save(); g.translate(rx, ry); g.rotate(BL.ang); g.translate(-rx, -ry); g.drawImage(S, x, y, P.w, P.h); g.restore();
    } else if (k === 'door' && (Math.abs(DR.ang) > 1e-4 || Math.abs(DR.sl) > 0.02)) {
      const hx = c.x + DHINGE[0], hy = c.y + DHINGE[1];
      g.save(); g.translate(hx + CO * DR.sl, hy + SI * DR.sl); g.rotate(DR.ang); g.translate(-hx, -hy); g.drawImage(S, x, y, P.w, P.h); g.restore();
    } else g.drawImage(S, x, y, P.w, P.h);
  }
  // касание героем через шину: упор/толчок/разбор у обломков → лопасть (восточнее +55) или дверь (−10…+45); obj 'blade'/'door' — прямо
  function wreckTouch(e, p) {
    const c = POI.cockpit;
    if (e.obj === 'blade') return bladeHit(p, c);
    if (e.obj === 'door') return doorPush(p);
    if (e.obj !== 'wreck' && e.what !== 'wreck') return;
    const dx = e.x - c.x, dy = e.y - c.y; if (dx * dx + dy * dy > 200 * 200) return;
    if (dx > 55) bladeHit(p, c); else if (dx > -10 && dx < 45) doorPush(p);
  }
  if (typeof Interact !== 'undefined') {
    Interact.on('bump', e => wreckTouch(e, e.power == null ? 0.6 : e.power));
    Interact.on('push', e => wreckTouch(e, 0.25));
    Interact.on('hit', e => { if (e.obj === 'blade' || e.obj === 'door') wreckTouch(e, e.power || 1); });
    Interact.on('shake', e => { if (e.obj === 'blade' || e.obj === 'door') wreckTouch(e, 0.8); });
    Interact.on('work', e => { if (e.what === 'wreck') wreckTouch(e, 0.5); });
  }

  // ---------- 🚩 вымпел: состояние на объект (фаза копится — частота меняется без скачков), форма — от Wind в точке ----------
  const FL = new WeakMap();
  const flagS = q => { let s = FL.get(q); if (!s) { s = { ph: 0, jerk: 0, jt: 9, t: null, touchT: -99 }; FL.set(q, s); } return s; };
  const flagF = ms => (ms < 1.6 ? 0.7 : 2 + 4 * cl((ms - 3) / 12, 0, 1)); // Гц: 2 → 6 с ростом ветра
  function flagStep(q, dt) {
    const s = flagS(q), w = W(q.x, q.y - 30);
    s.ph += TAU * flagF(w.ms) * dt; s.jt += dt;
    const p = G && G.p;
    if (p && !p.inside && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 14 * 14 && now - s.touchT > 0.8) { s.touchT = now; s.jerk = 0.5; s.jt = 0; emit('touch', { who: 'p', obj: 'pennant', target: q, x: q.x, y: q.y }); }
    return s;
  }
  function flagShape(q) {
    const s = flagS(q), w = W(q.x, q.y - 30), ms = w.ms, N = low() ? 2 : 6;
    const th = (85 * (1 - sm(1.4, 3.6, ms)) + 8 * (1 - sm(3.6, 9, ms))) * Math.PI / 180;       // средний угол к горизонту
    const A = (ms < 1.6 ? 0.05 : Math.min(0.6, 0.12 + 0.02 * ms)) + 0.14 * sm(14, 18, ms) * Math.abs(Math.sin(s.ph * 0.37 + q.x * 0.01)); // размах; пурга рвёт
    const L = 16 * (1 + 0.06 * sm(10, 18, ms)), ph = s.ph + q.x * 0.013, jk = s.jerk * Math.exp(-s.jt / 0.25);
    const x0 = q.x + 1, y0 = q.y - 34, up = [], dn = [];
    const c0 = Math.cos(w.dir || 0), fx = c0 >= 0 ? Math.max(0.35, c0) : Math.min(-0.35, c0); // вымпел — по ветру (Wind.dir): к камере/от камеры короче
    let cx = x0, cy = y0 + 6;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, al = th + A * u * Math.sin(ph - 2.4 * u) + jk * u * Math.sin(TAU * 9 * s.jt);
      cx += L / N * Math.cos(al) * fx; cy += L / N * Math.sin(al);
      const hw = 6 * (1 - (i + 1) / N), ox = 0.3 * hw * Math.sin(al) * Math.sign(fx), oy = -hw * Math.cos(al);
      up.push([cx + ox, cy + oy]); dn.push([cx - ox, cy - oy]);
    }
    return { top: [x0, y0], bot: [x0, y0 + 12], up, dn, shade: (0.3 + 0.6 * Math.abs(Math.sin(ph - 1.2))) * sm(1.6, 4, ms),
      ang: Math.atan2(cy - (y0 + 6), cx - x0) * 180 / Math.PI, tip: [cx, cy], ms };
  }
  function flag(q, env) {
    const s = flagS(q), T = env && env.now != null ? env.now : now;
    flagStep(q, s.t == null ? 0 : cl(T - s.t, 0, 0.05)); s.t = T;
    return flagShape(q);
  }

  // ---------- 📄 записки: трепет уголка, прыжки в сильный ветер, предел 34 px от камня ----------
  const NS = {}, NOTE_MAX = 34;
  const noteS = id => NS[id] || (NS[id] = { dx: 0, dy: 0, lift: 0, flut: 0, rot: 0, fph: R() * TAU, hopT: -1, hopH: 0, hopDx: 0, hopDy: 0, bx: 0, by: 0, gPrev: 0, kick: 0, t: null, touchT: -99 });
  function noteStep(id, dt) {
    const n = NOTES[id], s = noteS(id), w = W(n.x, n.y), ms = w.ms, L = low();
    s.fph += TAU * (3 + 0.25 * ms) * dt; s.kick = Math.max(0, s.kick - dt * 3);
    s.flut = Math.min(3, 0.4 * ms * (0.5 + 0.5 * w.gust) * (0.55 + 0.45 * Math.sin(s.fph)) + s.kick);
    if (!L && id !== 'door' && (!n.hold || n.hold === 'stone') && s.hopT < 0 && ms >= 5.5 && w.gust > 0.6 && s.gPrev <= 0.6 && Math.hypot(s.dx, s.dy) < NOTE_MAX - 1) {
      s.hopT = 0; s.hopH = Math.min(12, 1.5 * (ms - 4)); s.bx = s.dx; s.by = s.dy;
      const d = Math.min(8, 0.7 * (ms - 4)), dy = rr(-2, 2), nx = s.dx + d, ny = cl(s.dy + dy, -8, 8), k = Math.min(1, NOTE_MAX / Math.hypot(nx, ny)); // зацепилась: не дальше предела
      s.hopDx = nx * k - s.dx; s.hopDy = ny * k - s.dy;
    }
    s.gPrev = w.gust;
    if (s.hopT >= 0) {
      s.hopT += dt; const u = Math.min(1, s.hopT / 0.45);
      s.lift = s.hopH * Math.sin(Math.PI * u); s.dx = s.bx + s.hopDx * u; s.dy = s.by + s.hopDy * u; s.rot = 0.3 * Math.sin(Math.PI * u);
      if (u >= 1) { s.hopT = -1; s.lift = 0; s.rot = 0; }
    }
    const p = G && G.p;
    if (p && !p.inside && (p.x - n.x - s.dx) ** 2 + (p.y - n.y - s.dy) ** 2 < 12 * 12 && now - s.touchT > 1) { s.touchT = now; s.kick = 2; emit('touch', { who: 'p', obj: 'note', target: id, x: n.x, y: n.y }); }
    return s;
  }
  function note(id, env) {
    const s = noteS(id), T = env && env.now != null ? env.now : now;
    noteStep(id, s.t == null ? 0 : cl(T - s.t, 0, 0.05)); s.t = T;
    return s;
  }

  // где лист лежит сейчас (место из NOTES + снос ветром): «Прочитать», наклон и «положить» — сюда
  const PT = { x: 0, y: 0 };
  function notePos(id, out = PT) { const n = NOTES[id], s = NS[id]; out.x = n.x + (s ? s.dx : 0); out.y = n.y + (s ? s.dy : 0); return out; }

  function state() {
    return {
      blade: { off: BL.off, amp: BL.ampS, cap: bladeCap(), shed: BL.shed, vibT: BL.vibT, vibA: BL.vibA },
      door: { ang: DR.ang, sl: DR.sl, slams: DR.slams },
      wires: WIRES.map(C => C.P.map(p => [p.x, p.y])), wireL: WIRES.map(C => C.L), hum: WIRES.some(C => C.hum),
      notes: Object.fromEntries(Object.entries(NS).map(([k, s]) => [k, { dx: s.dx, dy: s.dy, lift: s.lift, flut: s.flut }])),
      stats: Object.assign({}, stats),
    };
  }
  function reset() { // новая игра / тесты: всё в покое
    Object.assign(BL, { ampS: 0, ph: 0, vibT: 9, vibA: 0, off: 0, ang: 0, cap: 1, shedT: -99, gPrev: 0, shed: 0 });
    if (HAS_SNOW()) Snow.set('blade', 1);
    Object.assign(DR, { ang: 0, av: 0, sl: 0, sv: 0, lastSlam: -99, gPrev: 0, slams: 0, clank: 0, snowAcc: 0 });
    for (const C of WIRES) for (const p of C.P) { p.x = p.px = p.rx; p.y = p.py = p.ry; }
    for (const k in NS) delete NS[k];
    wT = null;
  }
  return { drawWreck, flag, flagStep, flagShape, note, noteStep, notePos, wreckStep, state, reset, stats, PART, BROOT, DHINGE };
})();
