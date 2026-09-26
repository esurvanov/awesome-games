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

  // ---------- ветер: один на всех, из пурги ----------
  // WIND — порывистая составляющая сверх «зашитого» в спавн сноса (px/с по x); gust — медленная волна
  let storm = false, clock = 0;
  function setStorm(s) { storm = !!s; }
  function WIND() { return (storm ? 46 : 5) * (0.75 + 0.25 * Math.sin(clock * 0.7) * Math.sin(clock * 0.23 + 1)); }

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
    const w = WIND(), L = low();
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
      const k = T(q.type).wind;
      q.x += (q.vx + w * k) * dt; q.y += q.vy * dt;
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
    let t = 0;
    function seed(v) { s = v | 0; for (const f of flakes) { f.x = R(); f.y = R(); f.z = R(); f.ph = R() * 6; } for (const q of streaks) { q.x = R(); q.y = R(); q.l = 20 + R() * 40; q.z = R(); } }
    // o = { vw, vh, camDX, camDY, storm, amb:[r,g,b], dark 0..1, px, py (герой на экране) }
    function draw(g, dt, o) {
      t += dt;
      const L = low(), n = (o.storm ? 460 : 150) >> (L ? 1 : 0), gust = WIND();
      const wx = o.storm ? 294 + gust : 25 + gust, vw = o.vw, vh = o.vh;
      // снег светлее земли вокруг, но умножен на ambient: ночью — тёмно-синий, не «светящийся»
      const gain = 1.1 + 0.8 * (1 - (o.dark == null ? 1 : o.dark)); // ночью чуть светлее земли, но не «светится»
      g.fillStyle = PAL.lit('snow', o.amb, gain);
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        f.x += ((wx * (0.5 + f.z) + Math.sin(t + f.ph) * 12) * dt - o.camDX * (0.3 + f.z * 0.7)) / vw;
        f.y += ((30 + 60 * f.z) * (o.storm ? 1.5 : 1) * dt - o.camDY * (0.3 + f.z * 0.7)) / vh;
        f.x -= Math.floor(f.x); f.y -= Math.floor(f.y);
        g.globalAlpha = 0.35 + f.z * 0.6;
        const r = 0.8 + f.z * 1.8;
        if (o.storm) g.fillRect(f.x * vw, f.y * vh, r * 4, r * 0.8); else g.fillRect(f.x * vw, f.y * vh, r, r);
      }
      g.globalAlpha = 1;
      const ns = (o.storm ? 200 : 40) >> (L ? 1 : 0);
      g.strokeStyle = PAL.lit('snow', o.amb, gain, 0.25); g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < ns; i++) {
        const q = streaks[i];
        q.x += ((o.storm ? 454 + gust : 85 + gust) * (0.6 + q.z) * dt - o.camDX) / vw; q.y -= o.camDY / vh; q.x -= Math.floor(q.x); q.y -= Math.floor(q.y);
        const X = q.x * vw, Y = q.y * vh; g.moveTo(X, Y); g.lineTo(X + q.l * (o.storm ? 2 : 1), Y + 1);
      }
      g.stroke();
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
          g.beginPath(); g.arc(q.x, q.y, q.r, 0, TAU); g.fill();
        }
        g.globalAlpha = 1;
      },
    };
  }

  return { TYPES, update, draw, ground, emit, setStorm, WIND, weather, pool, layerOf: t => T(t).layer };
})();
