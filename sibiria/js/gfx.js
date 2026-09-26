'use strict';
// Рендер: кэш спрайтов, снег кусками, река, карта освещения, свечение, погода (js/particles.js).
// Три инварианта картинки (SPEC-art):
//   «один свет»   — всё, что рисуется после карты света, умножено на ambient (кроме огня, окон, глаз, искр);
//   «одно солнце» — направленная тень только в drawShadows, в спрайтах — контактная, строго под опорой;
//   «резко на любом зуме» — масштаб любого кэша = rdpr × ступень зума (zb).
const GFX = (() => {
  const cv = $('game'), cx = cv.getContext('2d');
  const lm = document.createElement('canvas'), lx = lm.getContext('2d');
  const au = document.createElement('canvas'), ax = au.getContext('2d');
  const sv = document.createElement('canvas'), sx_ = sv.getContext('2d'); // силуэт фигуры за препятствием
  // Масштаб камеры: dpr = растровый dpr × зум, vw/vh — видимая часть мира в мировых пикселях.
  // Весь код рендера, который ставит setTransform(dpr…) и считает от vw/vh, так автоматически зумится.
  let vw = 0, vh = 0, dpr = 1, rdpr = 1, rw = 0, rh = 0, zoom = 1, zb = 1, frame = 0, shx = 0, shy = 0, roofA = 1;
  const chunks = new Map(), SPR = {};
  let LIGHTS = [], EYES = [], rdt = 0, ghost = false; // rdt — dt кадра рендера; ghost — проход силуэта (без света и значков)
  const ENV = {
    now: 0, night: 0, wind: 1,
    light: (x, y, r, t = 'w', a = 1, clip = null) => { if (!ghost) LIGHTS.push({ x, y, r, t, a, clip }); },
    spark: (x, y, a = 0.6) => { if (!ghost) EYES.push({ x, y, spark: a }); },
    glow: (x, y, k = 1) => { if (!ghost) EYES.push({ x, y, glow: k }); },
    eye: (x, y, f, kind) => { if (!ghost) EYES.push({ x, y, f, red: kind === 'wolfRed', bear: kind === 'bear' }); },
  };
  const ZMIN = 0.6, ZMAX = 1.6;
  // камера: 'follow' — lerp к герою; 'free' — стоит, где поставил игрок; 'return' — плавный возврат к герою
  let camMode = 'follow', ret = null, crect = { left: 0, top: 0 };

  // ступень зума для кэшей (Z1): выше 1.15 спрайты печём ×1.6 — ель, Ми-8, чум резкие на 1.3–1.6
  function applyZoom() {
    dpr = rdpr * zoom; vw = rw / zoom; vh = rh / zoom;
    zb = zoom > 1.15 ? 1.6 : 1;
    if (window.ArtWorld) ArtWorld.setScale(rdpr, zb);
  }
  function resize() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const nd = window.QUALITY === 'low' ? 1 : Math.min(coarse ? 1.5 : 2, window.devicePixelRatio || 1);
    rw = innerWidth; rh = innerHeight;
    cv.width = Math.round(rw * nd); cv.height = Math.round(rh * nd);
    lm.width = Math.ceil(rw / 2); lm.height = Math.ceil(rh / 2);
    au.width = Math.ceil(rw / 4); au.height = Math.ceil(rh * 0.5 / 4);
    if (nd !== rdpr) { for (const k in SPR) delete SPR[k]; chunks.clear(); bakeQ = []; warm = true; if (window.ArtWorld) ArtWorld.reset(); }
    rdpr = nd; applyZoom();
    const r = cv.getBoundingClientRect(); crect = { left: r.left, top: r.top };
  }
  // экран ↔ мир: ОДНА пара функций на весь код (clientX/Y в CSS px; тряска не входит)
  const screenToWorld = (sx, sy) => ({ x: (sx - crect.left) / zoom + cam.x, y: (sy - crect.top) / zoom + cam.y });
  const worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * zoom + crect.left, y: (wy - cam.y) * zoom + crect.top });
  const followTarget = () => ({ x: G.p.x - vw / 2, y: G.p.y - 20 - vh / 2 });
  function clampCam() { cam.x = clamp(cam.x, -vw / 2, W - vw / 2); cam.y = clamp(cam.y, -vh / 2, H - vh / 2); }
  function setZoom(z, sx = rw / 2, sy = rh / 2) {
    z = clamp(z, ZMIN, ZMAX); if (Math.abs(z - zoom) < 1e-4) return;
    const w = screenToWorld(sx, sy);
    zoom = z; applyZoom();
    cam.x = w.x - (sx - crect.left) / zoom; cam.y = w.y - (sy - crect.top) / zoom;
    // зум не у центра — точка под курсором должна остаться на месте: камера свободна
    if (camMode !== 'free' && (Math.abs(sx - rw / 2) > 2 || Math.abs(sy - rh / 2) > 2)) { camMode = 'free'; ret = null; }
    if (camMode === 'free') clampCam();
  }
  function pan(dx, dy) { camMode = 'free'; ret = null; cam.x += dx; cam.y += dy; clampCam(); }
  function lookAt(x, y) { if (!G || !G.p) return; camMode = 'free'; ret = null; cam.x = x - vw / 2; cam.y = y - vh / 2; clampCam(); }
  function recenter() { camMode = 'follow'; ret = null; }
  function follow(dur = 0.35) { if (camMode === 'free') { camMode = 'return'; ret = { t: 0, d: dur, x: cam.x, y: cam.y }; } }
  function camStep(dt) {
    const tg = followTarget();
    if (camMode === 'free') return;
    if (camMode === 'return') {
      ret.t += dt; const k = smooth(0, 1, Math.min(1, ret.t / ret.d));
      cam.x = ret.x + (tg.x - ret.x) * k; cam.y = ret.y + (tg.y - ret.y) * k;
      if (ret.t >= ret.d) { camMode = 'follow'; ret = null; }
      return;
    }
    const k = Math.min(1, dt * 6); cam.x += (tg.x - cam.x) * k; cam.y += (tg.y - cam.y) * k;
  }

  function sprite(w, h, draw, scale = rdpr * zb) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    const g = c.getContext('2d'); g.scale(scale, scale); draw(g, w, h);
    return c;
  }
  function radial(size, stops) {
    return sprite(size, size, g => {
      const r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
    }, 1);
  }
  // «косметика» рендера (шум, дым чума, дрожь) — свой поток случайности, Math.random игры не тратит
  const CR = ArtWorld.rng(0xC05E), crnd = (a, b) => a + CR() * (b - a);
  // шум льда: мягкие пятна тонов №2–№4, тайлится createPattern в мировых координатах (без швов и растяжения)
  const RNOISE = sprite(128, 128, g => {
    for (let i = 0; i < 26; i++) {
      const x = CR() * 128, y = CR() * 128, r = 10 + CR() * 22, c = CR() < 0.5 ? 'rgba(111,142,168,0.09)' : 'rgba(246,249,252,0.22)';
      for (const ox of [-128, 0, 128]) for (const oy of [-128, 0, 128]) { g.fillStyle = c; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.45, 0.3, 0, Math.PI * 2); g.fill(); }
    }
  }, 1);
  let RPAT = null;
  // Свет в карте освещения кладётся режимом 'screen' (без насыщения каналов), поэтому спад — плавный
  // «гаусс» одного оттенка: смена оттенка к краю + клиппинг каналов при 'lighter' давали радужные кольца.
  const bell = (rgb, a0, n = 9) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, k = Math.exp(-t * t * 4.2) * (1 - t * t); return [t, `rgba(${rgb},${(a0 * k).toFixed(3)})`]; });
  const L_WARM = radial(256, bell('255,178,108', 0.95));
  const L_COOL = radial(256, bell('165,188,240', 0.8));
  const L_RED = radial(128, [[0, 'rgba(255,90,70,1)'], [1, 'rgba(0,0,0,0)']]);
  const GLOW = radial(128, [[0, 'rgba(255,140,50,0.7)'], [0.4, 'rgba(255,110,30,0.25)'], [1, 'rgba(0,0,0,0)']]);
  const PUFF = radial(32, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  const SHADOW = radial(64, [[0, 'rgba(39,57,74,1)'], [0.55, 'rgba(39,57,74,0.8)'], [1, 'rgba(39,57,74,0)']]);
  const strip = (c1, c2) => sprite(1, 64, g => {
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.15, c1); gr.addColorStop(0.55, c2); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1, 64);
  }, 1);
  const BANDS = [[strip('rgba(61,255,156,0.9)', 'rgba(31,209,165,0.35)'), 0, 0.34], [strip('rgba(31,209,165,0.8)', 'rgba(139,92,246,0.35)'), 1.7, 0.26], [strip('rgba(255,79,139,0.5)', 'rgba(139,92,246,0.4)'), 3.1, 0.18]];

  // ---------- деревья: кэш ArtWorld в масштабе rdpr × zb ----------
  const treeSprite = t => ArtWorld.treeSprite(t.kind, t.s, t.wall, t.v, rdpr * zb);

  // ---------- снег кусками (C8): печь полосами, не больше бюджета за кадр; река — отдельным слоем ----------
  const CS = 512, STRIPS = 8, SH = CS / STRIPS, BASE = '#eaeff5';
  let chunkCap = 24, bakeQ = [], warm = true;
  const chunkScale = () => (zoom < 0.9 ? 1 : rdpr);
  function chunkAt(ix, iy, s, want) {
    const k = ix + ',' + iy + '@' + s; let e = chunks.get(k);
    if (e) { chunks.delete(k); chunks.set(k, e); return e; } // LRU: свежие в конце
    if (!want) return null;
    const c = document.createElement('canvas'); c.width = c.height = Math.ceil(CS * s);
    e = { c, g: c.getContext('2d'), ix, iy, s, part: 0, done: false };
    chunks.set(k, e); bakeQ.push(e);
    return e;
  }
  function trimChunks() {
    while (chunks.size > chunkCap) { const k = chunks.keys().next().value, e = chunks.get(k); chunks.delete(k); if (!e.done) bakeQ = bakeQ.filter(q => q !== e); }
  }
  // одна полоса 512×64: фон, крап, штрихи ветра, статика (кедрач, марь, кочки, сугробы) под clip
  function bakePart(e) {
    const g = e.g, i = e.part, X = e.ix * CS, Y = e.iy * CS, y0 = i * SH;
    g.setTransform(e.s, 0, 0, e.s, 0, 0);
    g.fillStyle = BASE; g.fillRect(0, y0, CS, SH);
    g.save(); g.beginPath(); g.rect(0, y0, CS, SH); g.clip();
    const r = mulberry(e.ix * 7919 + e.iy * 104729 + i * 3571 + G.seed);
    for (const [c, k0] of [['rgba(111,142,168,0.1)', 0], ['rgba(246,249,252,0.7)', 1]]) {
      g.fillStyle = c; g.beginPath();
      for (let k = 0; k < 75; k++) { const a = r(); g.rect(r() * CS, y0 + r() * SH, 1 + (a * 0.5 + k0 * 0.5) * 2, 1); }
      g.fill();
    }
    g.strokeStyle = 'rgba(182,201,223,0.3)'; g.lineWidth = 1.2; g.beginPath();
    for (let k = 0; k < 4; k++) { const x = r() * CS, y = y0 + r() * SH, L = 20 + r() * 40; g.moveTo(x, y); g.quadraticCurveTo(x + L / 2, y - 4, x + L, y + 1); }
    g.stroke();
    g.translate(-X, -Y); bakeStatic(g, X, Y + y0, SH);
    g.restore();
    if (++e.part >= STRIPS) { e.done = true; e.g = null; }
  }
  const SNEAR = [];
  function bakeStatic(g, X, Y, h) {
    const inR = (x, y, m) => x > X - m && x < X + CS + m && y > Y - m && y < Y + h + m;
    const cxm = X + CS / 2, cym = Y + h / 2, rr0 = Math.hypot(CS, h) / 2;
    // кедрач — чуть синее (№3), марь — тёплая сухая трава (№9 с №3)
    if (inR(POI.cedar.x, POI.cedar.y, POI.cedar.r)) {
      const gr = g.createRadialGradient(POI.cedar.x, POI.cedar.y, 0, POI.cedar.x, POI.cedar.y, POI.cedar.r);
      gr.addColorStop(0, 'rgba(182,201,223,0.3)'); gr.addColorStop(1, 'rgba(182,201,223,0)');
      g.fillStyle = gr; g.fillRect(X, Y, CS, h);
    }
    if (inR(POI.mar.x, POI.mar.y, POI.mar.r)) {
      const gr = g.createRadialGradient(POI.mar.x, POI.mar.y, 0, POI.mar.x, POI.mar.y, POI.mar.r);
      gr.addColorStop(0, 'rgba(199,154,98,0.16)'); gr.addColorStop(1, 'rgba(199,154,98,0)');
      g.fillStyle = gr; g.fillRect(X, Y, CS, h);
    }
    // земля зон: оттенок с мягкой границей и детали (наледь, гарь, курумник, голец, стланик, колея зимника…)
    ArtZones.bakeGround(g, X, Y, CS, h, G.seed | 0);
    SNEAR.length = 0;
    for (const t of Space.tussocks.near(cxm, cym, rr0 + 20, SNEAR)) if (inR(t.x, t.y, 20)) ArtWorld.tussock(g, t);
    SNEAR.length = 0;
    for (const d of Space.drifts.near(cxm, cym, rr0 + 120, SNEAR)) if (inR(d.x, d.y, d.rx + 10)) ArtWorld.groundDrift(g, d);
  }
  let bakeMax = 0; // самый долгий проход печи с последнего сброса (для замеров)
  function bakeRun(budget) {
    const t0 = performance.now();
    let n = 0;
    while (bakeQ.length && n < 64) {
      const e = bakeQ[0]; bakePart(e); n++;
      if (e.done) bakeQ.shift();
      if (!warm && performance.now() - t0 > budget) break;
    }
    if (n && !warm) bakeMax = Math.max(bakeMax, performance.now() - t0);
  }

  // ---------- река: один слой в мировых координатах поверх кусков (L2, Z2) ----------
  let CRK = null, CRKsrc = null;
  function cracksNear(y0, y1) {
    if (CRKsrc !== G.cracks) { CRKsrc = G.cracks; CRK = new Map(); for (const c of G.cracks) { const k = Math.floor(c.y / 256); if (!CRK.has(k)) CRK.set(k, []); CRK.get(k).push(c); } }
    const out = []; for (let k = Math.floor(y0 / 256); k <= Math.floor(y1 / 256); k++) { const b = CRK.get(k); if (b) for (const c of b) if (c.y > y0 && c.y < y1) out.push(c); }
    return out;
  }
  function drawRiver() {
    const y0 = Math.floor((cam.y - 60) / 16) * 16, y1 = cam.y + vh + 60;
    let lo = Infinity, hi = -Infinity;
    for (let y = y0; y <= y1; y += 64) { const x = riverX(y); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    if (hi + RW + 40 < cam.x || lo - RW - 40 > cam.x + vw) return;
    const P = new Path2D();
    for (let y = y0; y <= y1 + 16; y += 16) P.lineTo(riverX(y) - RW, y);
    for (let y = Math.ceil((y1 + 16) / 16) * 16; y >= y0; y -= 16) P.lineTo(riverX(y) + RW, y);
    P.closePath();
    cx.fillStyle = '#c9d8e6'; cx.fill(P);
    cx.save(); cx.clip(P);
    if (!RPAT) RPAT = cx.createPattern(RNOISE, 'repeat');
    cx.fillStyle = RPAT; cx.fillRect(cam.x - 2, y0, vw + 4, y1 - y0 + 16);
    // льдины — шаг от y = 0 мира: у соседних кусков одинаковые (нет шва)
    cx.fillStyle = 'rgba(246,249,252,0.5)'; cx.beginPath();
    for (let y = Math.ceil((y0 - 20) / 60) * 60; y < y1 + 20; y += 60) { const x = riverX(y) + Math.sin(y) * 30; cx.moveTo(x + 40, y); cx.ellipse(x, y, 40, 10, 0.3, 0, Math.PI * 2); }
    cx.fill();
    cx.strokeStyle = 'rgba(246,249,252,0.8)'; cx.lineWidth = 1.2; cx.beginPath();
    for (const c of cracksNear(y0, y1)) { const x = riverX(c.y) + c.off; cx.moveTo(x, c.y); cx.lineTo(x + Math.cos(c.a) * c.len, c.y + Math.sin(c.a) * c.len * 0.4); }
    cx.stroke();
    // перекат — тонкий лёд темнее (№4), трещины веером
    const Pp = POI.polynya;
    if (Pp.y + 60 > y0 && Pp.y - 60 < y1) {
      cx.fillStyle = 'rgba(111,142,168,0.35)'; cx.beginPath(); cx.ellipse(Pp.x, Pp.y, Pp.r - 20, 50, 0, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = 'rgba(246,249,252,0.7)'; cx.lineWidth = 1; cx.beginPath();
      for (let i = 0; i < 14; i++) { const a = i / 14 * 6.28; cx.moveTo(Pp.x + Math.cos(a) * 30, Pp.y + Math.sin(a) * 14); cx.lineTo(Pp.x + Math.cos(a + 0.2) * 80, Pp.y + Math.sin(a + 0.2) * 40); }
      cx.stroke();
    }
    ArtZones.zimnikRoad(cx, y0, y1);
    cx.restore();
    // берег: снежный вал №1 с тенью формы №3
    cx.strokeStyle = 'rgba(182,201,223,0.8)'; cx.lineWidth = 10; cx.stroke(P);
    cx.strokeStyle = '#f6f9fc'; cx.lineWidth = 6; cx.stroke(P);
  }

  // ---------- примитивы ----------
  function ell(x, y, rx, ry, col, rot = 0) { cx.fillStyle = col; cx.beginPath(); cx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); cx.fill(); }
  function rr(x, y, w, h, r, col, g = cx) { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
  const WT = () => cx.setTransform(dpr, 0, 0, dpr, (-cam.x + shx) * dpr, (-cam.y + shy) * dpr);
  const light = ENV.light;

  // ---------- объекты ----------
  function drawTree(t, wind) {
    if (t.wood <= 0) return ArtWorld.stump(cx, t.x, t.y, t.s);
    const sway = wind * 0.05 * (0.6 + 0.4 * Math.sin(now * 1.7 + t.x * 0.013)) + (t.shake > 0 ? Math.sin(now * 60) * t.shake * 0.25 : 0);
    cx.setTransform(dpr, 0, -sway * dpr, dpr, (t.x - cam.x + shx) * dpr, (t.y - cam.y + shy) * dpr);
    const tw = ArtWorld.treeW(t.kind); cx.drawImage(treeSprite(t), -tw / 2, -160, tw, 170);
    WT();
  }
  const spr = (k, w, h, ox, oy, paint) => SPR[k + zb] || (SPR[k + zb] = sprite(w, h, g => { g.translate(ox, oy); paint(g); }));
  const MI8 = () => spr('mi8', 320, 210, 160, 140, ArtWorld.paintMi8);
  const TAIL = () => spr('tail', 220, 140, 110, 100, ArtWorld.paintTail);
  const CHUM = () => spr('chum', 130, 140, 65, 120, ArtWorld.paintChum);
  const LABAZ = () => spr('labaz', 80, 90, 40, 80, ArtWorld.paintLabaz);

  // Ми-8 длиной 320 px — три сегмента со своей опорной линией (нос южнее, балка севернее: корпус повёрнут)
  const WRECK_SEG = [[0, 110, 6], [110, 210, 0], [210, 320, -8]];
  function drawWreck(seg) {
    const c = POI.cockpit, S = MI8(), sc = S.width / 320, [a, b] = WRECK_SEG[seg];
    const sa = Math.round(a * sc), sb = Math.round(b * sc);
    cx.drawImage(S, sa, 0, sb - sa, S.height, c.x - 160 + sa / sc, c.y - 140, (sb - sa) / sc, 210);
  }
  function drawTailObj() { const t = POI.tail; cx.drawImage(TAIL(), t.x - 110, t.y - 100, 220, 140); }
  function drawChum() {
    const c = POI.chum; cx.drawImage(CHUM(), c.x - 65, c.y - 120, 130, 140);
    light(c.x, c.y - 10, 90, 'w', 0.6);
    // дым — эмиттер FX: частицы рождаются в update по темпу (3/с), в паузе не копятся
    if (state === 'play' && !UI.modal()) FX.emit('chum', 3, (parts, r) => parts.push({ type: 'smoke', x: c.x, y: c.y - 110, vx: (r() - 0.5) * 10 + 10, vy: -20 - r() * 10, life: 3, max: 3 }));
  }
  function drawDeer(d) {
    ArtAnimals.deer(cx, d, ENV);
    if (ArtAnimals.bellHit && ArtAnimals.bellHit(d) && dist2(d, G.p) < 320 * 320 && state === 'play') Sound.tone('sine', 2400 + (d.ph || 0) * 60, 2350, 0.25, 0.03);
  }

  // ---------- изба: модели из art-world.js, здесь — только состояние ----------
  const ROOM = () => ({ x0: HUT_IN.x0, y0: HUT_IN.y0 - 44, x1: HUT_IN.x1, y1: HUT_IN.y1 + WALL });
  const hutH = () => ({ x: HUT.x, y: HUT.y, in: HUT_IN, wall: WALL, doorW: DOOR_W, walls: G.hut.walls, door: G.hut.door, bench: G.hut.bench, damper: G.hut.damper,
    radio: G.flags.radioBuilt, fuel: G.hut.fuel, open: dist2(G.p, { x: HUT.x, y: HUT_IN.y1 + WALL - 6 }) < 40 * 40, cut: 1 - roofA });
  function drawHutFloor() { ArtWorld.hutFloor(cx, hutH()); }
  function drawNorthWall() { ArtWorld.hutNorth(cx, hutH()); }
  function drawStove() {
    const s = SPOT.stove;
    // свет печи обрезан по комнате (L6): сквозь стены на снег не выходит
    ArtWorld.hutStove(cx, s.x, s.y, { fuel: G.hut.fuel, damper: G.hut.damper, pipeTop: HUT.y - 150, lightK: 1 - roofA, room: ROOM() }, ENV);
    if (G.charge > 0 && !G.flags.radioBuilt && (G.chest.battery || (G.p.inside && G.inv.battery))) {
      // заряд аккумулятора: корпус №5, клемма №21, шкала №24
      const bx = s.x + 22, by = s.y - 16;
      rr(bx, by, 16, 10, 2, '#27394a'); rr(bx + 16, by + 3, 2, 4, 1, '#6c7178');
      rr(bx + 2, by + 2, 12 * G.charge / 100, 6, 1, '#9fe36b');
    }
  }
  function drawBench() { const b = SPOT.bench; ArtWorld.hutBench(cx, b.x, b.y, { bench: G.hut.bench, radio: G.flags.radioBuilt }, ENV); }
  function drawChest() { const c = SPOT.chest; ArtWorld.hutChest(cx, c.x, c.y); }
  function drawBed() { const b = SPOT.bed; ArtWorld.hutBed(cx, b.x, b.y); }
  function drawSouthWall() { ArtWorld.hutFront(cx, hutH(), ENV); }
  function drawRoof() {
    roofA += ((G.p.inside ? 0 : 1) - roofA) * 0.15;
    if (roofA < 0.03) return;
    ArtWorld.hutRoof(cx, hutH(), ENV, roofA);
    if (G.flags.radioBuilt && now % 1.4 < 0.7) { const m = ArtWorld.hutTop(hutH()).mast; EYES.push({ x: m.x, y: m.y, lamp: roofA }); }
  }

  // ---------- движение фигур: фаза шага от пройденного пути (C6 A1–A3, A7, A8, A14) ----------
  // Память по объекту: сдвиг за кадр → сглаженная скорость, направление, лицо с мёртвой зоной.
  const MOT = new WeakMap();
  function motion(o, face0) {
    let m = MOT.get(o);
    if (!m) { m = { x: o.x, y: o.y, ph: 0, spd: 0, vx: 0, vy: 0, d: 0, face: face0 < 0 ? -1 : 1, f: -1 }; MOT.set(o, m); }
    if (m.f === frame) return m; // второй проход (силуэт) — те же значения
    m.f = frame;
    let dx = o.x - m.x, dy = o.y - m.y; m.x = o.x; m.y = o.y;
    if (dx * dx + dy * dy > 80 * 80) dx = dy = 0; // телепорт — не шаг
    m.d = Math.hypot(dx, dy);
    if (rdt > 0) { const k = Math.min(1, rdt * 10); m.vx += (dx / rdt - m.vx) * k; m.vy += (dy / rdt - m.vy) * k; m.spd = Math.hypot(m.vx, m.vy); }
    if (Math.abs(m.vx) > 14) m.face = Math.sign(m.vx); else if (m.spd < 6 && face0) m.face = face0 < 0 ? -1 : 1;
    return m;
  }
  const dirY = m => (m.spd > 6 ? clamp(m.vy / m.spd, -1, 1) : 0);
  // стопа в опоре проходит 2·St (в проекции 3/4) за π фазы; каденс ≤ 3.6 Гц — остаток прячется в снегу
  function stepPhase(m, anim, sp, vyv) {
    if (m.pf === frame) return m.ph; m.pf = frame;
    if (anim === 'walk' || anim === 'run' || anim === 'limp' || anim === 'carry') {
      const St = ArtPeople.stride(anim === 'carry' ? 'walk' : anim, anim === 'carry' ? sp * 0.6 : sp), S = Math.abs(vyv);
      const foot = 2 * St * Math.hypot(1 - 0.82 * S, 0.3 * vyv);
      m.ph += Math.min(m.d * Math.PI / Math.max(1, foot), 2 * Math.PI * 3.6 * rdt);
    }
    return m.ph;
  }

  // ---------- люди: суставные модели из art-people.js ----------
  const LK = ArtPeople.LOOKS;
  const HERO_HAT = { anorak: Object.assign({}, LK.anorak, { hat: '#8a6a45', hatType: 'ushanka' }), dokha: Object.assign({}, LK.dokha, { hat: '#8a6a45', hatType: 'ushanka' }) };
  function heroLook() {
    if (G.gear.kukhl) return LK.kukhl;
    const k = G.gear.dokha ? 'dokha' : 'anorak';
    return G.gear.hat ? HERO_HAT[k] : LK[k];
  }
  const HM = { swingT: -9, lastSwing: 0, hurtT: -9, lastHurt: 0, chopA: null, chopT: -9 };
  function drawPlayer(g = cx) {
    const p = G.p, a = p.action, D = ArtPeople.DUR, m = motion(p, p.face);
    // окна разовых анимаций = их длительность (A12): замах 0.45 с, урон 0.6 с, а не короткий игровой таймер
    if (!ghost) {
      if (p.swing > HM.lastSwing + 1e-3) HM.swingT = now; HM.lastSwing = p.swing;
      if ((G.hurt || 0) > HM.lastHurt + 1e-3 && G.hurt > 0.7) HM.hurtT = now; HM.lastHurt = G.hurt || 0;
    }
    let anim = 'idle', animT = 0, tool = G.gear.saw ? 'saw' : 'axe', target = null;
    if (p.sleeping) anim = 'sleep';
    else if (a) {
      if (a.k === 'chop' || a.k === 'wreck') {
        // удар — событие: цикл подогнан так, что удар (a = 0.52) приходится на конец действия (щепа, звук) — A6
        const n = Math.max(1, Math.round(a.dur / D.chop)), cl = a.dur / (n - 0.48);
        anim = 'chop'; animT = (a.t % cl) / cl; if (a.k === 'wreck') tool = 'axe';
        if (!ghost) { HM.chopA = animT; HM.chopT = now; }
      }
      else if (a.k === 'dig') { anim = 'dig'; animT = (a.t % D.dig) / D.dig; }
      else if (a.k === 'fish') { anim = a.ph === 'bite' ? 'fishBite' : 'fish'; animT = clamp(a.t / a.dur, 0, 1); tool = 'rod'; target = { x: a.o.x, y: a.o.y }; }
      else { anim = 'build'; animT = (a.t % D.build) / D.build; }
    } else if (now - HM.swingT < D.swing) { anim = 'swing'; animT = (now - HM.swingT) / D.swing; }
    else if (HM.chopA !== null && HM.chopA > 0.3 && HM.chopA < 0.66 && now - HM.chopT < 0.2) {
      anim = 'chop'; animT = Math.min(0.66, HM.chopA + (now - HM.chopT) / D.chop); // прерванная рубка доигрывает удар (A9)
    }
    else if (now - HM.hurtT < D.hurt) { anim = 'hurt'; animT = (now - HM.hurtT) / D.hurt; }
    else if (m.spd > 12) anim = m.spd > 185 ? 'run' : 'walk';
    if (p.torch > 0 && !a && anim !== 'swing' && anim !== 'sleep') tool = 'torch';
    if (p.ride && !ghost) { const v = G.veh[p.ride]; if (p.ride === 'buran') ArtZones.buran(g, v, ENV, true); else ArtZones.deerSled(g, v, ENV); anim = 'sit'; }
    const x = p.sleeping ? p.x - 4 : p.x, sp = clamp(m.spd / 200, 0, 1), vy = anim === 'walk' || anim === 'run' ? dirY(m) : 0;
    ArtPeople.draw(g, { key: p, x: p.ride ? x - p.face * 8 : x, y: p.ride ? p.y - (p.ride === 'buran' ? 14 : 8) : p.y, face: m.spd > 12 ? m.face : p.face, vy, speed: sp, t: now, phase: stepPhase(m, anim, sp, vy),
      anim, animT, look: heroLook(), tool, target, frost: clamp((30 - G.s.warm) / 30, 0, 1), wet: p.wetT > 0, blink: p.iT > 0, seed: 1 }, ENV);
    if (p.torch > 0 && tool === 'torch') light(p.x + p.face * 14, p.y - 38, 240, 'w', 0.9);
    if (!p.inside) light(p.x, p.y - 16, 150, 'c', 0.55);
  }
  function drawUrk(g = cx) {
    const u = G.urk, m = motion(u, u.face), moving = m.spd > 8;
    const talking = UI.modal() && dist2(u, G.p) < 90 * 90;
    const anim = moving ? 'walk' : talking ? 'talk' : 'idle', vy = moving ? dirY(m) : 0;
    ArtPeople.draw(g, { key: u, x: u.x, y: u.y, face: m.face, vy, t: now, phase: stepPhase(m, anim, 0.35, vy), speed: 0.35, anim, look: LK.urk, tool: 'none', seed: 3 }, ENV);
    if (ghost) return;
    if (dist2(u, G.p) < 160 * 160 && !talking) mark('talk', u.x, u.y - 60 + Math.sin(now * 3) * 2);
    // пар изо рта — эмиттер FX (спавн в update, не из рендера)
    if (!G.p.inside && state === 'play') FX.emit('urk-breath', 1.2, (parts, r) => { const f = G.urk.face || 1; for (let i = 0; i < 2; i++) parts.push({ type: 'breath', x: G.urk.x + f * 6 + i * f * 2, y: G.urk.y - 34, vx: f * (10 + r() * 12), vy: -3 - r() * 5, life: 1.1, max: 1.1 }); });
  }
  function drawVera(g = cx) {
    const v = G.vera; if (v.state === 'dead') return;
    const m = motion(v, v.face), moving = m.spd > 8;
    // хромает, только если идёт сама (A2), а не когда движется герой
    const anim = v.state === 'follow' ? (moving ? 'limp' : 'idle') : 'sit', vy = moving ? dirY(m) : 0;
    ArtPeople.draw(g, { key: v, x: v.x, y: v.y, face: m.face, vy, t: now, phase: stepPhase(m, anim, 0.3, vy), speed: 0.3, anim, look: LK.vera, tool: 'none', seed: 5 }, ENV);
    if (!ghost && (v.state === 'tail' || (v.state === 'hut' && v.food <= 0))) mark(v.food <= 0 && v.state === 'hut' ? 'food' : 'alarm', v.x, v.y - 56 + Math.sin(now * 3) * 2);
  }
  // люди зон (NPCS без своей отрисовки): облик rec.look, шаг/разговор/стоит, метка «поговорить» рядом
  function drawNpc(n, g = cx) {
    const u = n.st, m = motion(u, u.face), moving = m.spd > 8;
    const talking = UI.modal() && dist2(u, G.p) < 100 * 100;
    const anim = moving ? 'walk' : talking ? 'talk' : 'idle', vy = moving ? dirY(m) : 0;
    ArtPeople.draw(g, { key: u, x: u.x, y: u.y, face: m.face, vy, t: now, phase: stepPhase(m, anim, 0.35, vy), speed: 0.35, anim, look: n.rec.look, tool: 'none', seed: 7 }, ENV);
    if (ghost) return;
    if (dist2(u, G.p) < 160 * 160 && !talking) mark('talk', u.x, u.y - 60 + Math.sin(now * 3) * 2);
  }
  function drawHare(h) { ArtAnimals.hare(cx, h, ENV); }
  function drawWolf(w) { ArtAnimals.wolf(cx, w, ENV); }
  function drawBear(b) { ArtAnimals.bear(cx, b, ENV); }
  function drawFire(f) { ArtWorld.fire(cx, f, ENV); if (f.fuel > 0) light(f.x, f.y - 10, (110 + Math.min(f.fuel, 120) * 1.3) * (1 + Math.sin(now * 11 + f.x) * 0.03), 'w', 1); }
  function drawStack(s) { ArtWorld.stack(cx, s, ENV); if (s.lit > 0) light(s.x, s.y - 20, 380, 'w', 1); } // счётчик «x/4» — точками в самой модели
  function drawNote(id) {
    const n = NOTES[id];
    if (id === 'labaz' && G.labaz) return;
    ArtWorld.note(cx, n.x, n.y, !!G.notes[id]);
    if (!G.notes[id]) EYES.push({ x: n.x + 6, y: n.y - 10, spark: 0.5 + Math.sin(now * 4 + n.x) * 0.5 });
  }
  function drawTrap(t) { ArtWorld.trap(cx, t); if (t.catch) mark('paw', t.x, t.y - 20, 13); }
  // значок над объектом в мире: круглая жестяная плашка + иконка из спрайта
  function mark(id, x, y, px = 16, col = '#ffd27a') {
    if (ghost) return;
    cx.fillStyle = 'rgba(17,26,21,.84)'; cx.strokeStyle = '#4d6456'; cx.lineWidth = 1.2;
    cx.beginPath(); cx.arc(x, y, px * 0.72, 0, Math.PI * 2); cx.fill(); cx.stroke();
    Icons.draw(cx, id, x, y, px * 0.86, col);
  }
  // метка-кольцо: одна на всё (выделение, приказ) — №22, α .8, 2 px, как у людей
  function ring(x, y, rx, ry, a = 0.8) { cx.globalAlpha = a; cx.strokeStyle = '#ffd27a'; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); cx.stroke(); cx.globalAlpha = 1; }
  function drawGround() {
    drawHutFloor();
    const P = POI.polynya;
    ArtWorld.polynya(cx, P.x + 10, P.y + 4);
    if (!G.flags.tube) { ArtWorld.tube(cx, TUBE_POS.x, TUBE_POS.y + 2); EYES.push({ x: TUBE_POS.x, y: TUBE_POS.y - 2, spark: 0.5 + Math.sin(now * 5) * 0.5 }); }
    const near = (x, y, mx, my = mx) => x > cam.x - mx && x < cam.x + vw + mx && y > cam.y - my && y < cam.y + vh + my;
    for (const h of G.holes) if (near(h.x, h.y, 30)) ArtWorld.hole(cx, h.x, h.y);
    // пятна и следы
    for (const d of G.decals || []) if (near(d.x, d.y, 60)) ArtWorld.decal(cx, d);
    for (const f of G.prints) if (near(f.x, f.y, 40)) ArtWorld.print(cx, f);
    for (const c of G.corpses || []) if (near(c.x, c.y, 80, 60)) ArtAnimals.corpse(cx, c.kind, c.x, c.y, G.time - c.t0);
    // ловушки и записки — с отсечением по экрану (C8)
    for (const t of G.traps) if (near(t.x, t.y, 40)) drawTrap(t);
    for (const id in NOTES) { const n = NOTES[id]; if (near(n.x, n.y, 30)) drawNote(id); }
    // зоны: промоины наледи, бурелом гари
    for (const o of Zones.OBJS) if (o.type === 'steam' && near(o.x, o.y, 40)) ArtZones.steamGround(cx, o, ENV);
    for (const f of G.fallen || []) if (near(f.x, f.y, 140)) ArtZones.fallenLog(cx, f);
  }

  // ---------- тени по солнцу: единственный источник направленной тени ----------
  function drawShadows(sunA, sunL, alpha) {
    if (alpha < 0.02) return;
    cx.globalAlpha = alpha;
    const cast = (x, y, len, w, k = 1) => {
      if (k !== 1) cx.globalAlpha = Math.min(1, alpha * k);
      cx.save(); cx.translate(x, y); cx.rotate(sunA); cx.drawImage(SHADOW, -w * 0.3, -w / 2, len + w * 0.3, w); cx.restore();
      if (k !== 1) cx.globalAlpha = alpha;
    };
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 200)) if (t.wood > 0) cast(t.x, t.y, 44 * t.s * sunL, 22 * t.s);
    const near = (x, y, m) => x > cam.x - m && x < cam.x + vw + m && y > cam.y - m && y < cam.y + vh + m;
    if (near(HUT.x, HUT.y, 400)) cast(HUT.x, HUT.y - 20, 70 * sunL, 150);
    if (near(POI.cockpit.x, POI.cockpit.y, 400)) cast(POI.cockpit.x, POI.cockpit.y, 30 * sunL, 110);
    if (near(POI.chum.x, POI.chum.y, 300)) cast(POI.chum.x, POI.chum.y, 56 * sunL, 64);
    if (near(POI.labaz.x, POI.labaz.y, 300)) cast(POI.labaz.x, POI.labaz.y, 32 * sunL, 40);
    for (const o of Zones.OBJS) { const S = ZSH[o.type]; if (S && near(o.x, o.y, 400)) cast(o.x, o.y, S[0] * sunL, S[1]); }
    for (const q of G.rocks || []) if (near(q.x, q.y, 120)) cast(q.x, q.y, 10 * q.s * sunL, 34 * q.s);
    cast(G.p.x, G.p.y, 16 * sunL, 14);
    if (G.urk.state !== 'away' && near(G.urk.x, G.urk.y, 200)) cast(G.urk.x, G.urk.y, 16 * sunL, 14);
    if (G.vera.state !== 'dead' && !insideHut(G.vera.x, G.vera.y) && near(G.vera.x, G.vera.y, 200)) cast(G.vera.x, G.vera.y, 16 * sunL, 14);
    // звери и штабели — тоже по солнцу (рядом с людьми освещены одинаково)
    for (const w of G.wolves) if (near(w.x, w.y, 200)) cast(w.x, w.y, 12 * sunL, 16);
    for (const h of G.hares) if (near(h.x, h.y, 150)) cast(h.x, h.y, 6 * sunL, 9);
    for (const d of G.deer || []) if (near(d.x, d.y, 200)) cast(d.x, d.y, 18 * sunL, 20);
    if (G.bear && near(G.bear.x, G.bear.y, 200)) cast(G.bear.x, G.bear.y, 16 * sunL, 26);
    for (const s of G.stacks) if (near(s.x, s.y, 200) && !(s.lit > 0)) cast(s.x, s.y, 10 * sunL, 30);
    if (G.col) {
      // постройки посёлка: длина по высоте (вышка — самая длинная), стройка растёт с прогрессом
      for (const b of G.col.builds) {
        const B = BUILDS[b.type]; if (!near(b.x, b.y, 420)) continue;
        const k = b.done ? 1 : 0.25 + 0.75 * clamp(b.prog || 0, 0, 1), hgt = b.type === 'tower' ? 88 : B.h * 1.15;
        cast(b.x, b.y + B.h * 0.3, hgt * 0.46 * sunL * k, B.w * (b.type === 'tower' ? 0.8 : 1), 1.5);
      }
      for (const u of G.col.units) if (!u.hidden && near(u.x, u.y, 200)) { const dog = u.type === 'laika'; cast(u.x, u.y, (dog ? 8 : 16) * sunL, dog ? 13 : 14); }
    }
    cx.globalAlpha = 1;
  }
  const ZSH = { rig: [90, 70], meteoHouse: [60, 150], factory: [60, 150], balokSkid: [40, 90], ural: [40, 150], burntBalok: [36, 110], mast: [110, 14], gurii: [36, 30], chum: [56, 64], den: [30, 120], booth: [30, 26], rodPole: [60, 10] };
  // солнце на юге: утром тень влево-вверх, вечером вправо-вверх; в полдень ≥ 15° от севера (L5; берём 35°:
  // тень длиной в полкроны под углом 15° ещё прячется под деревом).
  // Переход через полдень — перекрёстным затуханием двух направлений за полчаса, без рывка.
  function sunShadows(h, d, storm) {
    // солнце над горизонтом ~5.5–20 ч: тени есть и в сумерках; ночью без луны — нет совсем (L9)
    const up = smooth(5.3, 6.8, h) * (1 - smooth(18.6, 20, h));
    const alpha = storm ? 0.05 : Math.max(d * 0.3, up * 0.15);
    if (alpha < 0.02 || h < 5 || h > 20) return;
    const off = 0.6 + Math.abs(12 - h) * 0.14, sunL = 1.5 + Math.abs(12 - h) * 0.45;
    const w = clamp((12 - h) / 0.5 + 0.5, 0, 1);      // 1 — утро, 0 — вечер
    if (w > 0.01) drawShadows(-Math.PI / 2 - off, sunL, alpha * w);
    if (w < 0.99) drawShadows(-Math.PI / 2 + off, sunL, alpha * (1 - w));
  }

  // ---------- посёлок ----------
  function drawBuilding(b) {
    b.stockWood = G.chest.wood || 0;
    ArtWorld.building(cx, b, ENV);
  }
  function drawGhostBuilding() {
    const g = G.col.ghost;
    cx.globalAlpha = 0.55; drawBuilding({ type: g.type, x: g.x, y: g.y, done: 1, fuel: 0 }); cx.globalAlpha = 1;
  }
  function drawDog(u) { u.bark = now < (u.barkUntil || 0); ArtAnimals.dog(cx, u, ENV); }
  function drawUnit(u, g = cx) {
    const sel = G.col.sel.includes(u.id), T = UNITS[u.type], mh = T.hp + Colony.mod('hp'), m = motion(u, u.face);
    const moved = m.spd > 8; // «идёт» — по скорости, а не по сдвигу за кадр (не зависит от FPS, A14)
    if (u.type === 'laika') {
      if (ghost) return;
      if (sel) ring(u.x, u.y, 15, 6);
      drawDog(u);
      if (u.hp < mh) { rr(u.x - 12, u.y + 5, 24, 3, 1, 'rgba(39,57,74,0.6)'); rr(u.x - 12, u.y + 5, 24 * u.hp / mh, 3, 1, u.hp / mh > 0.4 ? '#9fe36b' : '#b8392d'); }
      return;
    }
    const D = ArtPeople.DUR, w = u.working;
    let anim = moved ? 'walk' : 'idle', animT = 0, tool = u.type === 'evenk' ? 'bow' : u.type === 'strelok' ? 'rifle' : 'axe', target = null;
    if (w === 'chop' || w === 'wreck') { anim = 'chop'; animT = ((now + u.id * 0.37) % D.chop) / D.chop; }
    else if (w === 'build') { anim = 'build'; animT = ((now + u.id * 0.3) % D.build) / D.build; }
    else if (w === 'fish') { anim = 'fish'; tool = 'rod'; animT = (now * 0.2 + u.id * 0.1) % 1; }
    else if (T.rng && u.cd > 0.2) { anim = 'shoot'; animT = clamp(1 - (u.cd - 0.2) / 1.4, 0, 1); }
    const c = Object.keys(u.carry)[0];
    if (c && moved) anim = 'carry';
    const sp = clamp(T.sp / 160, 0.2, 1), vy = anim === 'walk' || anim === 'carry' ? dirY(m) : 0;
    ArtPeople.draw(g, { key: u, x: u.x, y: u.y, face: moved ? m.face : u.face, vy, t: now, phase: stepPhase(m, anim, sp, vy), speed: sp, anim, animT, look: LK[u.type], tool, target,
      carry: c ? ITEMS[c].i : null, sel: sel && !ghost, hp: !ghost && u.hp < mh ? u.hp / mh : null, seed: u.id }, ENV);
  }
  function drawAmulet(a) { const s = ArtWorld.amulet(cx, a.x, a.y); EYES.push({ x: s.x, y: s.y, spark: 0.4 + Math.sin(now * 3 + a.x) * 0.4 }); }
  function drawInspect(q) { ArtWorld.inspect(cx, q, ENV); }
  function drawRavens() {
    for (const rv of G.ravens) {
      if (rv.x < cam.x - 60 || rv.x > cam.x + vw + 60 || rv.y - rv.z < cam.y - 60 || rv.y > cam.y + vh + 160) continue;
      ArtAnimals.raven(cx, rv, ENV);
    }
  }
  function drawColonyOverlay() {
    const C = G.col;
    cx.strokeStyle = '#3a2618'; cx.lineWidth = 1.5; cx.beginPath();
    for (const q of C.proj) { const x = q.x + (q.tx - q.x) * q.t, y = q.y + (q.ty - q.y) * q.t - Math.sin(q.t * Math.PI) * 18; cx.moveTo(x, y); cx.lineTo(x - (q.tx - q.x) * 0.06, y - (q.ty - q.y) * 0.06); }
    cx.stroke();
    if (C.mark) ring(C.mark.x, C.mark.y, 18 * (1.5 - C.mark.t), 8 * (1.5 - C.mark.t), 0.8 * C.mark.t);
    if (C.ghost) {
      const g = C.ghost, B = BUILDS[g.type], ok = Colony.canPlace(g.type, g.x, g.y);
      cx.strokeStyle = ok ? '#9fe36b' : '#b8392d'; cx.lineWidth = 2; cx.setLineDash([6, 4]);
      cx.strokeRect(g.x - B.w / 2, g.y - B.h / 2, B.w, B.h); cx.setLineDash([]);
    }
  }

  // ---------- силуэт за препятствием (C4): крыша, крона, Ми-8 закрыли героя — дорисовать его полупрозрачно ----------
  const TREE_BOX = [[30, 118], [25, 105], [40, 105]];
  function occRect(k, o) {
    switch (k) {
      case 0: { if (o.wood <= 0) return null; const [hw, ht] = TREE_BOX[o.kind] || TREE_BOX[0], s = o.s; return [o.x - hw * s, o.y - ht * s, o.x + hw * s, o.y - 10 * s]; }
      case 9: case 29: case 30: { const c = POI.cockpit; return [c.x - 150, c.y - 110, c.x + 150, c.y + 40]; }
      case 10: { const t = POI.tail; return [t.x - 100, t.y - 80, t.x + 100, t.y + 20]; }
      case 11: { const c = POI.chum; return [c.x - 40, c.y - 110, c.x + 40, c.y]; }
      case 14: { const l = POI.labaz; return [l.x - 26, l.y - 72, l.x + 26, l.y - 30]; }
      case 20: return roofA > 0.5 ? [HUT_IN.x0 - WALL, HUT_IN.y1 + WALL - 50, HUT_IN.x1 + WALL, HUT_IN.y1 + WALL] : null;
      case 21: return roofA > 0.5 ? [HUT_IN.x0 - WALL - 16, HUT_IN.y0 - 150, HUT_IN.x1 + WALL + 16, HUT_IN.y1 + WALL - 40] : null;
      case 32: { const D = ArtZones.OBJ[o.type]; if (!D) return o.type === 'chum' ? [o.x - 40, o.y - 110, o.x + 40, o.y] : null; const [w, h, ax, ay] = D; return [o.x - ax, o.y - ay, o.x - ax + w, o.y - ay + h * 0.85]; }
      case 22: { const B = BUILDS[o.type]; if (!B || B.flat || o.type === 'pad') return null; const yb = o.y + B.h / 2; return [o.x - B.w / 2, yb - B.h * 1.35, o.x + B.w / 2, yb]; }
    }
    return null;
  }
  const overlap = (a, b) => { const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? w * h / ((b[2] - b[0]) * (b[3] - b[1])) : 0; };
  function drawGhostFigure(o, fn) {
    const W0 = 70, H0 = 80, S = dpr, x0 = o.x - W0 / 2, y0 = o.y - H0 + 12;
    const pw = Math.ceil(W0 * S), ph = Math.ceil(H0 * S);
    if (sv.width < pw || sv.height < ph) { sv.width = Math.max(sv.width, pw); sv.height = Math.max(sv.height, ph); }
    sx_.setTransform(1, 0, 0, 1, 0, 0); sx_.clearRect(0, 0, pw, ph);
    sx_.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
    ghost = true; try { fn(sx_); } finally { ghost = false; }
    cx.globalAlpha = 0.38; cx.drawImage(sv, 0, 0, pw, ph, x0, y0, W0, H0); cx.globalAlpha = 1;
  }

  // ---------- окружающий свет ----------
  const AMB = [[0, [39, 51, 92]], [5.8, [42, 53, 100]], [6.6, [106, 95, 142]], [7.3, [217, 168, 176]], [8.3, [255, 241, 228]], [12, [255, 255, 255]],
    [16.5, [255, 238, 222]], [17.6, [231, 169, 160]], [18.6, [111, 106, 156]], [19.4, [45, 56, 104]], [24, [39, 51, 92]]];
  function ambient(h, storm) {
    let i = 0; while (i < AMB.length - 2 && AMB[i + 1][0] <= h) i++;
    const [h0, a] = AMB[i], [h1, b] = AMB[i + 1], t = (h - h0) / (h1 - h0);
    let c = a.map((v, k) => v + (b[k] - v) * t);
    if (storm) { const m = c[0] > 150 ? [190, 200, 212] : [70, 80, 100]; c = c.map((v, k) => v + (m[k] - v) * 0.55); }
    return c;
  }
  function aurora(k) {
    const w = au.width, h = au.height, t = now;
    ax.clearRect(0, 0, w, h); ax.globalCompositeOperation = 'lighter';
    for (const [s, o, a] of BANDS) for (let x = 0; x < w; x += 2) {
      const u = x / w, y = h * (0.45 + 0.16 * Math.sin(u * 5 + t * 0.21 + o) + 0.08 * Math.sin(u * 13 - t * 0.5 + o * 2));
      const len = h * (0.45 + 0.2 * Math.sin(u * 9 + t * 0.7 + o));
      ax.globalAlpha = k * a * (0.55 + 0.45 * Math.sin(u * 31 + t * 1.3 + o));
      ax.drawImage(s, x, y - len, 2, len);
    }
    ax.globalAlpha = 1; ax.globalCompositeOperation = 'source-over';
  }

  // ---------- вертолёт: одна модель (ArtWorld.mi8Fly), курс по касательной, крен ≤ 15°, ротор-диск (A15) ----------
  const HELI = { on: false, x: 0, y: 0, vx: -60, vy: 0 };
  function drawHeli() {
    let hx, hy, sc = 0.85;
    if (G.heli) { const a = now * 0.6; hx = POI.mar.x + Math.cos(a) * 320; hy = POI.mar.y + Math.sin(a) * 200 - 120; }
    else if (G.rescueT > 0) { const k = 1 - G.rescueT / 5; hx = POI.mar.x + 320 * (1 - k); hy = POI.mar.y - 120 * (1 - k) - 40; sc *= 1 + 0.2 * k; }
    else { HELI.on = false; return; }
    if (!HELI.on) { HELI.on = true; HELI.x = hx; HELI.y = hy; }
    if (rdt > 0) { const k = Math.min(1, rdt * 4); HELI.vx += ((hx - HELI.x) / rdt - HELI.vx) * k; HELI.vy += ((hy - HELI.y) / rdt - HELI.vy) * k; }
    HELI.x = hx; HELI.y = hy;
    const f = HELI.vx > 0 ? -1 : 1, sp = Math.hypot(HELI.vx, HELI.vy);
    // крен/тангаж: нос вниз по скорости, наклон по вертикальной составляющей курса
    const bank = clamp(Math.atan2(HELI.vy, Math.abs(HELI.vx) + 1) * 0.5 + Math.min(0.12, sp / 1500), -0.26, 0.26);
    ell(hx, hy + 140, 90 * sc, 16 * sc, 'rgba(39,57,74,0.22)');
    cx.save(); cx.translate(hx, hy); cx.scale(sc * f, sc); cx.rotate(-bank);
    cx.drawImage(ArtWorld.mi8Fly(), -108, -70, 290, 132);
    ArtWorld.rotor(cx, -2, -66, 150, now);
    cx.restore();
    light(hx, hy + 140, 200, 'c', 0.6);
  }

  // ---------- главный рендер ----------
  let lastCam = { x: 0, y: 0 };
  function render(dt, ctxTarget) {
    frame++; rdt = dt;
    if (state === 'menu') { cam.x = HUT.x - vw / 2 + Math.sin(now * 0.1) * 40; cam.y = HUT.y - vh / 2 + 40; }
    else {
      if (state === 'play' && (G.hurt || 0) > 0.95) recenter(); // укусили — показать героя
      camStep(dt);
    }
    // камера — целыми пикселями устройства на время кадра (Z4): тонкие линии не «ползут»
    const cx0 = cam.x, cy0 = cam.y;
    cam.x = Math.round(cam.x * dpr) / dpr; cam.y = Math.round(cam.y * dpr) / dpr;
    try { scene(dt, ctxTarget); } finally { cam.x = cx0; cam.y = cy0; }
  }
  function scene(dt, ctxTarget) {
    const p = G.p;
    const camDX = cam.x - lastCam.x, camDY = cam.y - lastCam.y; lastCam = { x: cam.x, y: cam.y };
    const h = state === 'menu' ? 20.3 : hourOf(), d = daylight(h), night = 1 - d, storm = state === 'play' && stormOn();
    const wind = storm ? 4 : 1;
    FX.setStorm(storm);
    shx = G.shake ? crnd(-G.shake, G.shake) : 0; shy = G.shake ? crnd(-G.shake, G.shake) : 0;
    LIGHTS = []; EYES = [];
    ENV.now = now; ENV.night = night; ENV.wind = wind;
    const LOW = window.QUALITY === 'low';

    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = '#10271f'; cx.fillRect(0, 0, cv.width, cv.height);
    WT();
    // 1. снег: готовые куски; недостающие — ровным тоном, пекутся по полосам в пределах бюджета
    const ix0 = Math.max(0, Math.floor(cam.x / CS)), ix1 = Math.min(Math.ceil(W / CS) - 1, Math.floor((cam.x + vw) / CS));
    const iy0 = Math.max(0, Math.floor(cam.y / CS)), iy1 = Math.min(Math.ceil(H / CS) - 1, Math.floor((cam.y + vh) / CS));
    const cs = chunkScale();
    chunkCap = (ix1 - ix0 + 2) * (iy1 - iy0 + 2) + 4;
    for (let i = ix0; i <= ix1; i++) for (let j = iy0; j <= iy1; j++) {
      const e = chunkAt(i, j, cs, true);
      if (e.done) cx.drawImage(e.c, i * CS, j * CS, CS + 1, CS + 1);
      else { cx.fillStyle = BASE; cx.fillRect(i * CS, j * CS, CS + 1, CS + 1); }
    }
    // запас по направлению движения камеры — печётся, когда видимое готово
    if (!bakeQ.length && (Math.abs(camDX) > 0.3 || Math.abs(camDY) > 0.3)) {
      const nx = camDX > 0.3 ? ix1 + 1 : camDX < -0.3 ? ix0 - 1 : null, ny = camDY > 0.3 ? iy1 + 1 : camDY < -0.3 ? iy0 - 1 : null;
      const ok = (i, j) => i >= 0 && j >= 0 && i < Math.ceil(W / CS) && j < Math.ceil(H / CS);
      if (nx !== null) for (let j = iy0; j <= iy1; j++) if (ok(nx, j)) chunkAt(nx, j, cs, true);
      if (ny !== null) for (let i = ix0; i <= ix1; i++) if (ok(i, ny)) chunkAt(i, ny, cs, true);
    }
    bakeRun(LOW ? 2 : 3); warm = false;
    trimChunks();
    drawRiver();
    // 2. земля
    drawGround();
    sunShadows(h, d, storm);
    // 3. объекты по опорной линии (южный край площади объекта)
    const x0 = cam.x - 120, x1 = cam.x + vw + 120, y0 = cam.y - 40, y1 = cam.y + vh + 180;
    const L = [];
    const vis = (x, y) => x > x0 && x < x1 && y > y0 && y < y1;
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 220)) if (vis(t.x, t.y)) L.push([t.y, 0, t]);
    for (const hh of G.hares) if (vis(hh.x, hh.y)) L.push([hh.y, 1, hh]);
    for (const w of G.wolves) if (vis(w.x, w.y)) L.push([w.y, 2, w]);
    for (const f of G.fires) if (vis(f.x, f.y)) L.push([f.y, 3, f]);
    for (const s of G.stacks) if (vis(s.x, s.y)) L.push([s.y, 4, s]);
    if (G.bear && vis(G.bear.x, G.bear.y)) L.push([G.bear.y, 5, G.bear]);
    L.push([p.y, 6, p]);
    if (G.gear.sled && !p.inside && !p.sleeping && !p.ride) L.push([p.sy, 27, p]);   // нарты — своим элементом по своей опоре
    if (G.urk.state !== 'away' && vis(G.urk.x, G.urk.y)) L.push([G.urk.y, 7]);
    if (G.vera.state !== 'dead' && vis(G.vera.x, G.vera.y)) L.push([G.vera.y, 8]);
    for (const n of Npc.list()) if (n.id !== 'urk' && n.id !== 'vera' && vis(n.st.x, n.st.y)) L.push([n.st.y, 35, n]);
    if (vis(POI.cockpit.x, POI.cockpit.y)) { L.push([POI.cockpit.y + WRECK_SEG[0][2], 9]); L.push([POI.cockpit.y + WRECK_SEG[1][2], 29]); L.push([POI.cockpit.y + WRECK_SEG[2][2], 30]); }
    if (vis(POI.tail.x, POI.tail.y)) L.push([POI.tail.y, 10]);
    if (vis(POI.chum.x, POI.chum.y)) { L.push([POI.chum.y, 11]); L.push([POI.chum.y + 120, 13]); }
    for (const dd of G.deer || []) if (vis(dd.x, dd.y)) L.push([dd.y, 12, dd]);
    if (G.col) {
      for (const b of G.col.builds) if (vis(b.x, b.y)) L.push([b.y + BUILDS[b.type].h / 2, 22, b]);
      for (const u of G.col.units) if (!u.hidden && vis(u.x, u.y)) L.push([u.y, 23, u]);
      if (G.col.ghost && typeof Input !== 'undefined') Input.sync(); // призрак — под курсором при текущей камере
      if (G.col.ghost) L.push([G.col.ghost.y + BUILDS[G.col.ghost.type].h / 2, 28]);
    }
    for (const a of G.amuletsAt || []) if (!a.got && vis(a.x, a.y)) L.push([a.y, 25, a]);
    // зоны: объекты, глыбы, транспорт на стоянке (верхом — рисуется с героем)
    for (const o of Zones.OBJS) if (o.type !== 'steam' && o.x > x0 - 120 && o.x < x1 + 120 && o.y > y0 && o.y < y1 + 120) L.push([o.y, 32, o]);
    for (const q of Space.rocks.near(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 100)) if (vis(q.x, q.y)) L.push([q.y, 33, q]);
    if (G.veh) for (const k of ['deer', 'buran']) { const v = G.veh[k]; if (v && p.ride !== k && vis(v.x, v.y)) L.push([v.y, 34, k]); }
    for (const q of INSPECT) if (vis(q.x, q.y)) L.push([q.y, 26, q]);
    if (vis(POI.labaz.x, POI.labaz.y)) L.push([POI.labaz.y, 14]);
    if (vis(HUT.x, HUT.y)) {
      L.push([HUT_IN.y0, 15]); L.push([SPOT.stove.y, 16]); L.push([SPOT.bench.y, 17]); L.push([SPOT.chest.y, 18]); L.push([SPOT.bed.y, 19]);
      L.push([HUT_IN.y1 + WALL, 20]); L.push([HUT_IN.y1 + WALL + 1, 21]);
    }
    // частицы слоя ground (щепа, кровь, пуфы, кольца) — в той же сортировке
    const view = [x0, y0 - 60, x1, y1];
    FX.ground(G.parts, view, q => L.push([q.y, 31, q]));
    L.sort((a, b) => a[0] - b[0]);
    // фигуры, которые покажем силуэтом, если их закроет объект, нарисованный позже
    const watch = [];
    const figRect = o => [o.x - 10, o.y - 44, o.x + 10, o.y - 4];
    for (const [, k, o] of L) {
      switch (k) {
        case 0: drawTree(o, wind); break; case 1: drawHare(o); break; case 2: drawWolf(o); break; case 3: drawFire(o); break;
        case 4: drawStack(o); break; case 5: drawBear(o); break;
        case 6: drawPlayer(); if (!p.inside && !p.sleeping) watch.push({ o: p, r: figRect(p), fn: g => drawPlayer(g), hit: 0 }); break;
        case 27: ArtWorld.sled(cx, p.sx, p.sy, G.inv.wood || 0, Math.sign(p.x - p.sx) || 1); break;
        case 7: drawUrk(); break;
        case 8: drawVera(); if (G.vera.state === 'follow') watch.push({ o: G.vera, r: figRect(G.vera), fn: g => drawVera(g), hit: 0 }); break;
        case 9: drawWreck(0); break; case 29: drawWreck(1); break; case 30: drawWreck(2); break; case 10: drawTailObj(); break;
        case 11: drawChum(); break; case 12: drawDeer(o); break; case 13: ArtWorld.sled(cx, POI.chum.x + 80, POI.chum.y + 120, 0, 1); break;
        case 14: cx.drawImage(LABAZ(), POI.labaz.x - 40, POI.labaz.y - 80, 80, 90); break;
        case 15: drawNorthWall(); break; case 16: drawStove(); break; case 17: drawBench(); break; case 18: drawChest(); break; case 19: drawBed(); break;
        case 20: drawSouthWall(); break; case 21: drawRoof(); break;
        case 22: drawBuilding(o); break;
        case 23: drawUnit(o); if (o.type !== 'laika' && G.col.sel.includes(o.id)) watch.push({ o, r: figRect(o), fn: g => drawUnit(o, g), hit: 0 }); break;
        case 25: drawAmulet(o); break; case 26: drawInspect(o); break;
        case 28: drawGhostBuilding(); break;
        case 31: ArtWorld.drawParticle(cx, o, ENV); cx.globalAlpha = 1; break;
        case 32: ArtZones.obj(cx, o, ENV); break;
        case 33: ArtZones.rock(cx, o); break;
        case 35: drawNpc(o); break;
        case 34: if (o === 'buran') ArtZones.buran(cx, G.veh.buran, ENV, false); else ArtZones.deerSled(cx, G.veh.deer, ENV); break;
      }
      if (watch.length) { const r = occRect(k, o); if (r) for (const w of watch) if (w.o !== o && overlap(r, w.r) > 0.25) w.hit = 1; }
    }
    for (const w of watch) if (w.hit) drawGhostFigure(w.o, w.fn);
    // 4. частицы в воздухе (дым, пар, точки) — поверх объектов
    FX.draw(cx, G.parts, 'air', ENV, view);
    if (G.ravens) drawRavens();
    if (G.col) drawColonyOverlay();
    drawHeli();

    // 5. ночь: насыщенность −40 % до карты света (сдвиг к синему даёт сам ambient), вместо заливки soft-light
    if (!LOW && night > 0.3) {
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'saturation'; cx.globalAlpha = 0.4 * smooth(0.3, 0.9, night); cx.fillStyle = '#808080'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    }
    // 6. карта освещения
    const amb = ambient(h, storm), dark = (amb[0] + amb[1] + amb[2]) / 765;
    const auroraK = LOW ? 0 : state === 'menu' ? 0.8 : night > 0.5 && !storm ? (G.aurora || 0) * smooth(0.5, 0.9, night) : 0;
    if (auroraK > 0 && frame % 2 === 0) aurora(auroraK);
    if (dark < 0.985) {
      if (!LOW || frame % 2 === 0 || !lm._ok) buildLight(amb, dark, auroraK);
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'multiply'; cx.drawImage(lm, 0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'source-over';
    } else lm._ok = false;
    // 7. свечение: огонь, окна, глаза, искры — без приглушения, режимом 'lighter'
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.globalCompositeOperation = 'lighter';
    const glowK = 0.25 + night * 0.75;
    for (const e of EYES) {
      const sx = e.x - cam.x + shx, sy = e.y - cam.y + shy;
      if (e.glow) { const r = 50 * e.glow; cx.globalAlpha = 0.3 * glowK; cx.drawImage(GLOW, sx - r, sy - r, r * 2, r * 2); }
      else if (e.lamp) { cx.globalAlpha = e.lamp; cx.fillStyle = '#ff6a1a'; cx.beginPath(); cx.arc(sx, sy, 1.5, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = e.lamp * (0.3 + night * 0.5); cx.drawImage(PUFF, sx - 7, sy - 7, 14, 14); }
      else if (e.spark !== undefined) { cx.globalAlpha = e.spark * 0.8; cx.drawImage(PUFF, sx - 5, sy - 5, 10, 10); }
      else if (night > 0.3) {
        cx.globalAlpha = Math.min(1, night * 1.2);
        cx.fillStyle = e.red || e.bear ? '#ff6a1a' : '#ffd27a';
        cx.beginPath(); cx.arc(sx, sy, e.bear ? 2.6 : 2, 0, Math.PI * 2); cx.arc(sx - e.f * (e.bear ? 7 : 5), sy, e.bear ? 2.6 : 2, 0, Math.PI * 2); cx.fill();
        cx.globalAlpha = night * 0.25; cx.drawImage(PUFF, sx - 10, sy - 8, 20, 16);
      }
    }
    cx.globalAlpha = 1;
    WT(); cx.globalCompositeOperation = 'lighter';
    FX.draw(cx, G.parts, 'glow', ENV, view);
    cx.globalCompositeOperation = 'source-over';
    // (сияние — только отсветом в карте света: экранный слой лежал на деревьях и ехал с камерой, L8)

    // 8. снег, позёмка, пурга — цвет × ambient: ночью не светятся (L1, L7)
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    FX.weather.draw(cx, dt, { vw, vh, camDX, camDY, storm, amb, dark, px: p.x - cam.x, py: p.y - cam.y - 16 });
    // 9. сумерки: тёплый тон
    const dusk = Math.max(smooth(6.2, 7.2, h) * (1 - smooth(7.8, 9, h)), smooth(16.2, 17.4, h) * (1 - smooth(18.4, 19.4, h)));
    if (dusk > 0.02) { cx.globalCompositeOperation = 'soft-light'; cx.globalAlpha = dusk * 0.35; cx.fillStyle = '#ff8e31'; cx.fillRect(0, 0, vw, vh); } // mix(№18, №23)
    cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    if (state === 'menu') return;

    // 10. подписи в мире (слой ui)
    WT();
    FX.draw(cx, G.parts, 'ui', ENV);
    // метка цели взаимодействия
    if (ctxTarget && !UI.modal()) {
      const o = ctxTarget; cx.fillStyle = '#ffd27a'; cx.globalAlpha = 0.9; const bob = Math.sin(now * 5) * 3;
      cx.beginPath(); cx.moveTo(o.x - 6, o.y - o.h - 10 + bob); cx.lineTo(o.x + 6, o.y - o.h - 10 + bob); cx.lineTo(o.x, o.y - o.h - 2 + bob); cx.closePath(); cx.fill(); cx.globalAlpha = 1;
    }
    // кольцо действия
    if (p.action && p.action.k !== 'fish') {
      const k = p.action.t / p.action.dur, sx = p.x, sy = p.y - 58;
      cx.lineWidth = 4; cx.strokeStyle = 'rgba(39,57,74,0.5)'; cx.beginPath(); cx.arc(sx, sy, 11, 0, Math.PI * 2); cx.stroke();
      cx.lineWidth = 2.5; cx.strokeStyle = '#ffd27a';
      cx.beginPath(); cx.arc(sx, sy, 11, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); cx.stroke();
    }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (typeof Input !== 'undefined') Input.draw(cx, { dpr, rdpr, shx, shy }); // ввод: подсветка, рамка, значок у пальца, стрелка к герою
    if (G.sniff) {
      const sn = G.sniff, R = sn.t * 520, px = p.x - cam.x, py = p.y - cam.y - 10;
      if (R < 700) { cx.strokeStyle = `rgba(255,210,122,${Math.max(0, 0.7 - R / 1000)})`; cx.lineWidth = 3; cx.beginPath(); cx.ellipse(px, py, R, R * 0.6, 0, 0, Math.PI * 2); cx.stroke(); }
      // метки — в экранных px × масштаб интерфейса (не растут с зумом камеры)
      const U = scrUI();
      cx.textAlign = 'center';
      for (const hh of sn.hits) {
        const age = sn.t - hh.d / 520; if (age < 0) continue;
        const a = Math.max(0, Math.min(1, age * 4) * (1 - (sn.t - 4) / 1)), sx = (hh.x - cam.x) * zoom / U, sy = (hh.y - cam.y) * zoom / U;
        cx.globalAlpha = Math.min(1, a);
        Icons.plate(cx, sx - 13, sy - 50 - Math.min(age, 0.3) * 20, 26, 26, 13);
        Icons.draw(cx, hh.ic, sx, sy - 37 - Math.min(age, 0.3) * 20, 18, '#ebe6d3');
        cx.font = '11px "PT Mono", monospace'; cx.fillStyle = '#ffd27a'; cx.lineWidth = 3; cx.strokeStyle = 'rgba(11,18,14,.7)';
        cx.strokeText(Math.round(hh.d / 10) * 10 + ' м', sx, sy - 14); cx.fillText(Math.round(hh.d / 10) * 10 + ' м', sx, sy - 14);
      }
      cx.globalAlpha = 1; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (p.action && p.action.k === 'fish') {
      // полоса рыбалки — канвас-плашка из токенов (.plate), экранные px × масштаб интерфейса
      const a = p.action, U = scrUI(), hx = (p.x - cam.x) * zoom / U, hy = (p.y - cam.y) * zoom / U;
      const bx = hx - 70, by = hy - 58 * zoom / U - 40;
      if (a.ph === 'bite') {
        const pos = (Math.sin(a.t * a.sp * Math.PI) + 1) / 2;
        Icons.plate(cx, bx - 8, by - 30, 156, 52);
        rr(bx, by, 140, 14, 2, '#0d140f'); rr(bx + a.z * 140, by, a.w * 140, 14, 2, '#9fe36b');
        cx.fillStyle = '#ffd27a'; cx.fillRect(bx + pos * 140 - 2, by - 3, 4, 20);
        cx.font = '400 13px "Russo One", "PT Sans", sans-serif'; cx.textAlign = 'center'; cx.fillStyle = Math.floor(now * 6) % 2 ? '#ffd27a' : '#ebe6d3';
        Icons.text(cx, UI.isTouch ? 'КЛЮЁТ! ЖМИ :axe:' : 'КЛЮЁТ! ЖМИ E', bx + 70, by - 10, 14);
      } else {
        Icons.plate(cx, hx - 26, by - 6, 52, 26);
        Icons.draw(cx, 'rod', hx - 10, by + 7, 16, '#ebe6d3');
        cx.fillStyle = '#ffd27a'; for (let i = 0; i < 1 + Math.floor(now * 2) % 3; i++) cx.fillRect(hx + 4 + i * 5, by + 10, 3, 3);
      }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    drawCompass(storm);
    // 11. иней и урон
    const fr = clamp((35 - G.s.warm) / 35, 0, 1);
    if (fr > 0) {
      const g = cx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.25, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
      g.addColorStop(0, 'rgba(221,230,238,0)'); g.addColorStop(1, `rgba(221,230,238,${fr * 0.8})`);
      cx.fillStyle = g; cx.fillRect(0, 0, vw, vh);
    }
    if (G.hurt > 0) { cx.fillStyle = `rgba(184,57,45,${G.hurt * 0.3})`; cx.fillRect(0, 0, vw, vh); }
    if (p.sleeping) { cx.fillStyle = 'rgba(16,39,31,0.55)'; cx.fillRect(0, 0, vw, vh); }
  }

  // карта света: ambient + огни режимом 'screen' в ½ разрешения; свет печи — в рамке комнаты (L6);
  // огонь за избой не красит крышу и фасад (L3): для огней севернее фасада крыша вырезана из пятна
  function buildLight(amb, dark, auroraK) {
    lm._ok = true;
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over';
    lx.fillStyle = `rgb(${amb[0] | 0},${amb[1] | 0},${amb[2] | 0})`; lx.fillRect(0, 0, lm.width, lm.height);
    lx.globalCompositeOperation = 'screen';
    const k = clamp((1 - dark) * 1.3, 0, 1);
    // отсвет сияния на снегу — под светом, тем же 'screen': у костров он сам гаснет, колец нет
    if (auroraK > 0) { lx.globalAlpha = 0.4 * auroraK; lx.drawImage(au, 0, 0, lm.width, lm.height); }
    const S = zoom / 2, toX = x => (x - cam.x + shx) * S, toY = y => (y - cam.y + shy) * S;
    const hutOn = roofA > 0.3 && Math.abs(HUT.x - (cam.x + vw / 2)) < vw + 400 && Math.abs(HUT.y - (cam.y + vh / 2)) < vh + 400;
    const occ = hutOn ? [toX(HUT_IN.x0 - WALL - 18), toY(HUT_IN.y0 - 160), toX(HUT_IN.x1 + WALL + 18), toY(HUT_IN.y1 + WALL - 2)] : null;
    for (const Lt of LIGHTS) {
      const img = Lt.t === 'c' ? L_COOL : Lt.t === 'r' ? L_RED : L_WARM, r = Lt.r / 2;
      const sx = toX(Lt.x), sy = toY(Lt.y), R = r * zoom;
      if (sx + R < 0 || sy + R < 0 || sx - R > lm.width || sy - R > lm.height) continue;
      lx.globalAlpha = Math.min(1, Lt.a * k);
      const behind = occ && Lt.y < HUT_IN.y1 + WALL - 12 && !insideHut(Lt.x, Lt.y) && sx + R > occ[0] && sx - R < occ[2] && sy + R > occ[1] && sy - R < occ[3];
      if (Lt.clip || behind) {
        lx.save(); lx.beginPath();
        if (Lt.clip) { const c = Lt.clip; lx.rect(toX(c.x0), toY(c.y0), (c.x1 - c.x0) * S, (c.y1 - c.y0) * S); }
        else { lx.rect(0, 0, lm.width, lm.height); lx.rect(occ[0], occ[1], occ[2] - occ[0], occ[3] - occ[1]); }
        lx.clip('evenodd'); lx.drawImage(img, sx - R, sy - R, R * 2, R * 2); lx.restore();
      } else lx.drawImage(img, sx - R, sy - R, R * 2, R * 2);
    }
    lx.globalAlpha = 1;
  }

  // масштаб интерфейса для канвас-оверлеев: setTransform(rdpr × ui), координаты — CSS px / ui
  function scrUI() { const U = (window.UI && UI.scale) || 1; cx.setTransform(rdpr * U, 0, 0, rdpr * U, 0, 0); return U; }
  // компас к цели: канвас-копия .plate, число золотом; экранные px × масштаб интерфейса (не зависит от зума)
  function drawCompass(storm) {
    const tg = UI.goalTarget();
    if (!tg || storm) return;
    const p = G.p, U = scrUI(), W_ = rw / U, H_ = rh / U, sx = (tg.x - cam.x) * zoom / U, sy = (tg.y - cam.y) * zoom / U;
    if (sx > 40 && sx < W_ - 40 && sy > 150 && sy < H_ - 90) {
      const bob = Math.sin(now * 4) * 3;
      Icons.draw(cx, 'pin', sx, sy - 34 + bob, 26, '#ffd27a', 'rgba(11,18,14,.85)');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0); return;
    }
    const a = Math.atan2(tg.y - p.y, tg.x - p.x), R = Math.min(W_ / 2 - 40, H_ / 2 - 90);
    const ex = W_ / 2 + Math.cos(a) * R, ey = H_ / 2 + Math.sin(a) * R + 20;
    cx.save(); cx.translate(ex, ey);
    cx.fillStyle = 'rgba(11,18,14,.55)'; cx.beginPath(); cx.arc(0, 2, 19, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = '#22302a'; cx.strokeStyle = '#4d6456'; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(0, 0, 18, 0, Math.PI * 2); cx.fill(); cx.stroke();
    cx.rotate(a); cx.fillStyle = '#e8943a'; cx.beginPath(); cx.moveTo(27, 0); cx.lineTo(18, -7); cx.lineTo(18, 7); cx.closePath(); cx.fill();
    cx.restore();
    Icons.draw(cx, tg.ic, ex, ey, 20, '#ebe6d3');
    const t = Math.round(Math.hypot(tg.x - p.x, tg.y - p.y) / 10) * 10 + ' м';
    cx.font = '12px "PT Mono", monospace'; const tw = cx.measureText(t).width + 12;
    Icons.plate(cx, ex - tw / 2, ey + 22, tw, 18, 3);
    cx.fillStyle = '#ffd27a'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(t, ex, ey + 31.5);
    cx.textBaseline = 'alphabetic';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  addEventListener('resize', resize); addEventListener('sibir-quality', resize); resize();
  return {
    render, resize, screenToWorld, worldToScreen, toWorld: screenToWorld, setZoom, pan, lookAt, recenter, follow,
    reset() { chunks.clear(); bakeQ = []; warm = true; roofA = 1; HELI.on = false; if (G && G.seed != null) FX.weather.seed(G.seed); recenter(); },
    get vw() { return vw; }, get vh() { return vh; }, get zoom() { return zoom; }, get free() { return camMode === 'free'; }, get mode() { return camMode; },
    // для замеров (tests): сколько кусков в очереди печи
    get bakeQueue() { return bakeQ.length; }, bakeMax(reset) { const v = bakeMax; if (reset) bakeMax = 0; return v; },
    dropChunks() { chunks.clear(); bakeQ = []; }, // замер подгрузки: забыть куски без синхронной печи
  };
})();
