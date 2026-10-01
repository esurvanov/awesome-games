'use strict';
// Общее для рисунка «Сибири»: палитра-24 (C2, SPEC-art §1.1) и единый слой частиц и погоды (C7, §2.7).
//
// PAL — единственный источник цветов мира. Промежуточные тона — только PAL.mix(a, b, t) двух токенов.
// FX  — один пул частиц: spawn / update (один интегратор, один ветер) / draw(layer).
//   Слои: ground (щепа, кровь, снежные пуфы, кольца — в сортировке по y вместе с объектами),
//         air (дым, пар, точки — поверх объектов), glow (искры, угли — после карты света, 'lighter'),
//         ui (всплывающий текст — последним).
//   Лимиты по типам; при переполнении выпадают самые старые частицы того же типа. QUALITY=low — лимиты ÷2.
// FX.weather — снегопад и позёмка (экранные, свой seed), цвет × окружающий свет (ночью не светятся).
// FX.pool()  — отдельный экранный пул тех же законов (финал, меню-оверлеи).

var PAL = (() => {
  const P = {
    snow: '#f6f9fc', snowMid: '#dde6ee', snowSh: '#b6c9df', dusk: '#6f8ea8', ink: '#27394a',   // 1–5
    needleLt: '#2f5a3a', needle: '#1c4034', needleDk: '#10271f',                              // 6–8
    cut: '#c79a62', wood: '#8a6a45', log: '#5b3d27', woodDk: '#3a2618',                        // 9–12
    skin: '#f1c9a5', skinDk: '#c89468', red: '#b8392d', redDk: '#7c241c', teal: '#3f6f7a',     // 13–17
    flame: '#ffb347', felt: '#e3d5b6', cloth: '#2f3542', stone: '#6c7178', core: '#ffd27a',    // 18–22
    ember: '#ff6a1a', plus: '#9fe36b',                                                         // 23–24
  };
  const LIST = Object.values(P);
  const RGB = {}, MIX = new Map(), RGBA = new Map();
  const rgb = h => RGB[h] || (RGB[h] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  // смешивание двух токенов (t квантуется до 1/20 — кэш)
  function mix(a, b, t) {
    a = P[a] || a; b = P[b] || b; t = Math.round(t * 20) / 20;
    if (t <= 0) return a; if (t >= 1) return b;
    const k = a + b + t; let r = MIX.get(k);
    if (!r) { const A = rgb(a), B = rgb(b); r = hex(A.map((v, i) => v + (B[i] - v) * t)); MIX.set(k, r); }
    return r;
  }
  // токен с прозрачностью: PAL.a('ink', 0.3) → 'rgba(39,57,74,0.3)'
  function a(name, al) {
    const k = name + al; let r = RGBA.get(k);
    if (!r) { const c = rgb(P[name] || name); r = `rgba(${c[0]},${c[1]},${c[2]},${+al.toFixed(3)})`; RGBA.set(k, r); }
    return r;
  }
  // цвет × окружающий свет (0..255 на канал): так рисуется всё, что идёт после карты света
  function lit(name, amb, gain = 1, al = 1) {
    const c = rgb(P[name] || name);
    return `rgba(${c.map((v, i) => Math.min(255, v * amb[i] / 255 * gain) | 0).join(',')},${al})`;
  }
  return Object.assign(P, { LIST, mix, a, lit, rgb });
})();

var FX = (() => {
  const TAU = Math.PI * 2;
  // тип → слой, доля ветра, лимит (high / low)
  const TYPES = {
    smoke: { layer: 'air', wind: 1.0, cap: 120, low: 60 },
    breath: { layer: 'air', wind: 0.8, cap: 40, low: 20 },
    steam: { layer: 'air', wind: 0.6, cap: 36, low: 14 },
    spark: { layer: 'glow', wind: 0.6, cap: 80, low: 40 },
    ember: { layer: 'glow', wind: 0.4, cap: 40, low: 0 },
    puff: { layer: 'ground', wind: 0.3, cap: 60, low: 30 },
    bit: { layer: 'ground', wind: 0.2, cap: 200, low: 100 },
    ring: { layer: 'ground', wind: 0, cap: 10, low: 10 },
    dot: { layer: 'air', wind: 0, cap: 120, low: 60 },
    text: { layer: 'ui', wind: 0, cap: 20, low: 20 },
  };
  const DEF = { layer: 'air', wind: 0.5, cap: 60, low: 30 };
  const T = t => TYPES[t] || DEF;
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';

  // ---------- ветер: единый js/wind.js (паспорт R1) ----------
  // снос частицы = Wind.px(Wind.ms(x, y)) × доля типа вдоль Wind.dir (px/с); в спавнах сноса нет. low — одно значение у героя на кадр.
  // WIND() — снос у героя, px/с (для совместимости)
  let storm = false, clock = 0;
  const HAS_W = () => typeof Wind !== 'undefined';
  function setStorm(s) { storm = !!s; }
  const heroMs = () => !HAS_W() ? (storm ? 18 : 4.5) * 0.6 : typeof G !== 'undefined' && G && G.p ? Wind.ms(G.p.x, G.p.y) : Wind.base() * 0.6;
  function WIND() { return heroMs() * 16; }

  // ---------- эмиттеры: рендер только объявляет источник, частицы рождаются в update по темпу ----------
  const EM = new Map();
  function emit(key, rate, make) { let e = EM.get(key); if (!e) { e = { acc: 0 }; EM.set(key, e); } e.rate = rate; e.make = make; e.seen = 2; }

  // ---------- один интегратор + лимиты по типам (без splice внутри цикла) ----------
  const CNT = {};
  // эмиттеры тратят свой поток случайности (не Math.random игры — не сдвигают мир и ИИ)
  let es = 0xE317;
  const ER = () => { es = es + 0x6D2B79F5 | 0; let t = Math.imul(es ^ es >>> 15, 1 | es); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  function update(parts, dt, rnd = ER) {
    if (!(dt > 0)) return;
    clock += dt;
    const L = low(), W1 = HAS_W() && !L, w = WIND();
    // направление ветра (js/wind.js — гуляет за часы игры): снос по x — cos, по y — sin × 0.6 (земля в ракурсе 3/4)
    const wd = HAS_W() && Wind.dir ? Wind.dir() : 0, wcx = Math.cos(wd), wcy = Math.sin(wd) * 0.6;
    for (const [k, e] of EM) {
      if (--e.seen < 0) { EM.delete(k); continue; }
      e.acc += e.rate * dt;
      while (e.acc >= 1) { e.acc -= 1; e.make(parts, rnd); }
    }
    for (const k in CNT) CNT[k] = 0;
    for (const q of parts) CNT[q.type] = (CNT[q.type] || 0) + 1;
    const drop = {};
    for (const k in CNT) { const t = T(k), cap = L ? t.low : t.cap; if (CNT[k] > cap) drop[k] = CNT[k] - cap; }
    let j = 0;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      if (drop[q.type] > 0) { drop[q.type]--; continue; }       // самые старые — в начале массива
      q.life -= dt; if (q.life <= 0) continue;
      const k = T(q.type).wind, wv = k ? (W1 ? Wind.ms(q.x, q.y) * 16 : w) * k : 0, wx = wv * wcx, wy = wv * wcy;
      q.wx = wx; q.wy = wy; q.x += (q.vx + wx) * dt; q.y += (q.vy + wy) * dt;
      if (q.g) q.vy += q.g * dt;
      parts[j++] = q;
    }
    parts.length = j;
  }

  // ---------- рисование по слоям ----------
  // ground-частицы идут в сортировку объектов (FX.ground отдаёт их), остальные — одним проходом
  function draw(g, parts, layer, env, view) {
    const AW = typeof ArtWorld !== 'undefined' ? ArtWorld : null; if (!AW) return;
    for (const q of parts) {
      if (T(q.type).layer !== layer) continue;
      if (view && (q.x < view[0] || q.x > view[2] || q.y < view[1] || q.y > view[3])) continue;
      AW.drawParticle(g, q, env);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function ground(parts, view, out) {
    for (const q of parts) if (T(q.type).layer === 'ground' && !(view && (q.x < view[0] || q.x > view[2] || q.y < view[1] || q.y > view[3]))) out(q);
  }

  // ---------- погода: снегопад и позёмка, экранные, свой seed (детерминизм эталонов) ----------
  const weather = (() => {
    let s = 0x5EED;
    const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const flakes = Array.from({ length: 460 }, () => ({ x: R(), y: R(), z: R(), ph: R() * 6 }));
    const streaks = Array.from({ length: 200 }, () => ({ x: R(), y: R(), l: 20 + R() * 40, z: R() }));
    let t = 0, wsm = -1, wdx = 1, wdy = 0;
    // мягкая «крупная» снежинка вблизи (размытый диск): квадраты 1–2 px читались как пиксели
    // DOT — маска (белый мягкий диск); TINT — её копия, перекрашенная в текущий цвет снега × ambient (перекраска только при смене цвета)
    const DOT = (() => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'), gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 16); return c; })();
    // пурга: мягкая вытянутая чёрточка (эллипс 32×8 с радиальным спадом) — вместо fillRect, который читался прямоугольниками
    const STREAK = (() => { const c = document.createElement('canvas'); c.width = 32; c.height = 8; const g = c.getContext('2d'); g.translate(16, 4); g.scale(16, 4); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); return c; })();
    // перекрашенные копии масок в текущий цвет снега × ambient (перекраска только при смене цвета)
    const tintOf = mask => { const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height; return { c, mask, col: '' }; };
    const TD = tintOf(DOT), TS = tintOf(STREAK), TL = tintOf(STREAK);
    function tint(T, col) {
      if (col !== T.col) {
        T.col = col; const g = T.c.getContext('2d'), w = T.c.width, h = T.c.height;
        g.globalCompositeOperation = 'copy'; g.drawImage(T.mask, 0, 0);
        g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      }
      return T.c;
    }
    const tinted = col => tint(TD, col);
    function seed(v) { s = v | 0; for (const f of flakes) { f.x = R(); f.y = R(); f.z = R(); f.ph = R() * 6; } for (const q of streaks) { q.x = R(); q.y = R(); q.l = 20 + R() * 40; q.z = R(); } }
    // o = { vw, vh, camDX, camDY, storm, amb:[r,g,b], dark 0..1, px, py (герой на экране), z — зум камеры, dpr — масштаб слоя (для поворота штрихов) }
    // Слой рисуется в мировом масштабе (× зум), а хлопья и штрихи — это снег у самой камеры: их размер держим в экранных px
    // (÷ z), иначе на зуме 4× хлопья раздувались в квадратики. Скорости и позиции — как были.
    function draw(g, dt, o) {
      t += dt;
      const Z = 1 / Math.max(0.25, o.z || 1);
      // снос хлопьев — ветер у героя, сглаженный ~1 с (инерция снежинки): 18 px/с на 1 м/с, позёмка ×1.55 + 40
      const L = low(), n = (o.storm ? 460 : 150) >> (L ? 1 : 0), m = heroMs();
      wsm = wsm < 0 ? m : wsm + (m - wsm) * Math.min(1, dt * 1.2);
      // направление — Wind.dir (гуляет медленно; сглажено, чтобы снег не «поворачивал» рывком): по экрану x — cos, y — sin × 0.6
      const wd = HAS_W() && Wind.dir ? Wind.dir() : 0; wdx = wdx + (Math.cos(wd) - wdx) * Math.min(1, dt * 0.8); wdy = wdy + (Math.sin(wd) * 0.6 - wdy) * Math.min(1, dt * 0.8);
      const W0 = 18 * wsm, wx = W0 * wdx, wy = W0 * wdy, S0 = 1.55 * W0 + 40, sx = S0 * wdx, sy = S0 * wdy, vw = o.vw, vh = o.vh;
      // штрихи и пурговые хлопья — вдоль скорости (ветер + падение): угол один на кадр
      const fall = (30 + 60 * 0.5) * (o.storm ? 1.5 : 1), ang = Math.atan2(wy + (o.storm ? fall * 0.35 : 0), Math.abs(wx) + 1e-3) * Math.sign(wx || 1), rot = Math.abs(ang) > 0.06 && !L;
      const ca = Math.cos(ang), sa = Math.sin(ang), DP = o.dpr || 1;
      // снег светлее земли вокруг, но умножен на ambient: ночью — тёмно-синий, не «светящийся»
      const gain = 1.1 + 0.8 * (1 - (o.dark == null ? 1 : o.dark)); // ночью чуть светлее земли, но не «светится»
      const snowCol = PAL.lit('snow', o.amb, gain);
      g.fillStyle = snowCol;
      const dot = L ? null : tinted(snowCol), streak = L || !o.storm ? null : tint(TS, snowCol);
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        f.x += ((wx * (0.5 + f.z) + Math.sin(t + f.ph) * 12) * dt - o.camDX * (0.3 + f.z * 0.7)) / vw;
        f.y += (((30 + 60 * f.z) * (o.storm ? 1.5 : 1) + wy * (0.5 + f.z)) * dt - o.camDY * (0.3 + f.z * 0.7)) / vh;
        f.x -= Math.floor(f.x); f.y -= Math.floor(f.y);
        g.globalAlpha = 0.35 + f.z * 0.6;
        const r = (0.8 + f.z * 1.8) * Z;
        if (o.storm) { if (L) g.fillRect(f.x * vw, f.y * vh, r * 4, r * 0.8); else if (rot) { g.setTransform(DP * ca, DP * sa, -DP * sa, DP * ca, f.x * vw * DP, f.y * vh * DP); g.drawImage(streak, -r, -r * 0.35, r * 7.5, r * 1.5); } else g.drawImage(streak, f.x * vw - r, f.y * vh - r * 0.35, r * 7.5, r * 1.5); }
        else if (!L && f.z > 0.45) { g.globalAlpha *= 0.55 * (0.35 + 0.65 * (o.dark == null ? 1 : o.dark)); g.drawImage(dot, f.x * vw - r * 1.5, f.y * vh - r * 1.5, r * 3, r * 3); }
        else if (!L) g.drawImage(dot, f.x * vw - r, f.y * vh - r, r * 2, r * 2); // дальние мелкие — тоже мягкий диск (квадрат 1–2 px на зуме читался пикселем)
        else g.fillRect(f.x * vw, f.y * vh, r, r);
      }
      if (rot) g.setTransform(DP, 0, 0, DP, 0, 0);
      g.globalAlpha = 1;
      const ns = (o.storm ? 200 : 40) >> (L ? 1 : 0);
      if (L) { // low: простые линии одним проходом
        g.strokeStyle = PAL.lit('snow', o.amb, gain, 0.25); g.lineWidth = Z; g.beginPath();
        for (let i = 0; i < ns; i++) {
          const q = streaks[i];
          q.x += (sx * (0.6 + q.z) * dt - o.camDX) / vw; q.y += (sy * (0.6 + q.z) * dt - o.camDY) / vh; q.x -= Math.floor(q.x); q.y -= Math.floor(q.y);
          const X = q.x * vw, Y = q.y * vh, l = q.l * (o.storm ? 2 : 1) * Z; g.moveTo(X, Y); g.lineTo(X + l * ca, Y + l * sa + Z);
        }
        g.stroke();
      } else { // high: те же штрихи мягкой чёрточкой — без жёстких концов, толщина 1–2 px с растушёвкой
        const sp = tint(TL, snowCol); g.globalAlpha = 0.42;
        for (let i = 0; i < ns; i++) {
          const q = streaks[i];
          q.x += (sx * (0.6 + q.z) * dt - o.camDX) / vw; q.y += (sy * (0.6 + q.z) * dt - o.camDY) / vh; q.x -= Math.floor(q.x); q.y -= Math.floor(q.y);
          const X = q.x * vw, Y = q.y * vh, len = q.l * (o.storm ? 2 : 1) * Z, th = (2.4 + q.z * 1.6) * Z;
          if (rot) { g.setTransform(DP * ca, DP * sa, -DP * sa, DP * ca, X * DP, Y * DP); g.drawImage(sp, 0, -th / 2, len, th); }
          else g.drawImage(sp, X, Y - th / 2, len, th);
        }
        if (rot) g.setTransform(DP, 0, 0, DP, 0, 0);
        g.globalAlpha = 1;
      }
      // пурга: вуаль к краям — цвет снега × ambient (ночью тёмная, а не молочная)
      if (o.storm) {
        const gr = g.createRadialGradient(o.px, o.py, 140, o.px, o.py, 420);
        gr.addColorStop(0, PAL.lit('snowMid', o.amb, 1, 0.25)); gr.addColorStop(1, PAL.lit('snowMid', o.amb, 1, 0.9));
        g.fillStyle = gr; g.fillRect(0, 0, vw, vh);
      }
    }
    return { draw, seed };
  })();

  // ---------- экранный пул (финал): те же законы, свои частицы ----------
  function pool(cap = 900) {
    const parts = [];
    return {
      parts,
      spawn(q) { if (parts.length < (low() ? cap >> 1 : cap)) parts.push(q); },
      update(dt) {
        let j = 0;
        for (let i = 0; i < parts.length; i++) {
          const q = parts[i]; q.life -= dt; if (q.life <= 0) continue;
          if (q.drag) { const k = Math.exp(-q.drag * dt); q.vx *= k; }
          if (q.swirl) q.vy += q.swirl * Math.sin(q.life * 6) * 30 * (q.u || 1) * dt;
          if (q.grow) q.r += q.grow * dt;
          q.x += q.vx * dt; q.y += q.vy * dt; if (q.g) q.vy += q.g * dt;
          if (q.y > (q.floor || 1e9)) continue;
          parts[j++] = q;
        }
        parts.length = j;
      },
      draw(g, color) {
        for (const q of parts) {
          const a = Math.max(0, Math.min(1, q.life / q.max));
          g.globalAlpha = a * (q.a || 1); g.fillStyle = color(q);
          g.beginPath(); g.arc(q.x, q.y, Math.max(0, q.r), 0, TAU); g.fill(); // grow < 0 (тающий дым) не уводит радиус в минус
        }
        g.globalAlpha = 1;
      },
    };
  }

  return { TYPES, update, draw, ground, emit, setStorm, WIND, weather, pool, layerOf: t => T(t).layer };
})();
