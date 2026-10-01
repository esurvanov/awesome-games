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
  // сглаживание, не зависящее от FPS: доля пути за кадр при «жёсткости» k (1/с); при 60 к/с — как прежнее min(1, dt·k)
  const RATE = k => -60 * Math.log(1 - Math.min(k / 60, 0.99)), ease = (k, dt) => 1 - Math.exp(-dt * RATE(k));
  const VIEW_K = 10; // ракурс (спина/бок/лицо) фигур доходит до 90 % за ≈0.23 с, до 95 % — за 0.3 с
  const ENV = {
    now: 0, night: 0, wind: 1, wx: 1, wy: 0, // wx/wy — куда дует (Wind.dir): x со знаком (дым, пламя, ели гнутся по ветру)
    light: (x, y, r, t = 'w', a = 1, clip = null) => { if (!ghost) LIGHTS.push({ x, y, r, t, a, clip }); },
    spark: (x, y, a = 0.6) => { if (!ghost) EYES.push({ x, y, spark: a }); },
    glow: (x, y, k = 1) => { if (!ghost) EYES.push({ x, y, glow: k }); },
    eye: (x, y, f, kind, dy = 0, tq = 1) => { if (!ghost) EYES.push({ x, y, f, red: kind === 'wolfRed', bear: kind === 'bear', dy, tq }); },
  };
  // зум: максимум — герой ≈ ¼ высоты экрана (фигура ~56 px мира × 4); в low максимум ниже (меньше пикселей на спрайт)
  const ZMIN = 0.6, zmax = () => (window.QUALITY === 'low' ? 2.5 : 4);
  const ZOOM_K = 14; // плавный зум: до 90 % пути за ≈0.16 с, экспонента в лог-масштабе (не зависит от FPS)
  // камера: 'follow' — lerp к герою; 'free' — стоит, где поставил игрок; 'return' — плавный возврат к герою
  let camMode = 'follow', ret = null, crect = { left: 0, top: 0 };

  // ступени выпечки кэшей (Z1): спрайт пекут в rdpr × ступень; ступень покрывает зум до ×1.15 от себя.
  // Смена ступени — только когда зум стоит ≥160 мс (после жеста): в движении рисуем старыми кэшами, без печи и рывков.
  const ZSTEPS = () => (window.QUALITY === 'low' ? [1, 1.6, 2.5] : [1, 1.6, 2.5, 4]);
  function stepFor(z) { const S = ZSTEPS(); for (const s of S) if (z <= s * 1.15) return s; return S[S.length - 1]; }
  let zt = 1, zax = 0, zay = 0, zAt = 0, zc = 1, zOld = 0, zT0 = 0; // цель, якорь (экран), время изменения, зум ступени, ждёт чистки старой ступени
  // общий словарь (js/style.js): SC — гибрид (одно солнце для света и всех теней, одна таблица времени суток, мягкая фактура);
  // SF — плоский режим C (2 тона, тушь, ореол; localStorage 'sibir-style' = 'flat'); zi — «зум туши»: спрайты с контуром пекутся под него
  const SC = typeof Style !== 'undefined' && Style.on, SF = SC && Style.flat;
  let zi = 1;
  const ZI_TOL = 0.058; // |ln(zoom/zi)| > tol (≈ ±6 %) — перепечь под новый зум (когда зум постоит, как ступень)
  function applyZoom() { dpr = rdpr * zoom; vw = rw / zoom; vh = rh / zoom; if (SF) Style.V.zoom = zoom; }
  function commitStep() {
    if (SF && Math.abs(Math.log(zoom / zi)) > 1e-4) { zi = zoom; Style.V.zi = zi; }
    const s = stepFor(zoom); zc = zoom;
    if (s !== zb) { zb = s; zOld = performance.now(); if (typeof ArtWorld !== 'undefined') ArtWorld.setScale(rdpr, zb); }
  }
  function resize() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const nd = window.QUALITY === 'low' ? 1 : Math.min(coarse ? 1.5 : 2, window.devicePixelRatio || 1);
    rw = innerWidth; rh = innerHeight;
    cv.width = Math.round(rw * nd); cv.height = Math.round(rh * nd);
    lm.width = Math.ceil(rw / 2); lm.height = Math.ceil(rh / 2);
    au.width = Math.ceil(rw / 4); au.height = Math.ceil(rh * 0.5 / 4);
    if (nd !== rdpr) { for (const k in SPR) delete SPR[k]; chunks.clear(); bakeQ = []; warm = true; if (window.ArtWorld) ArtWorld.reset(); }
    rdpr = nd; if (SF) Style.V.rdpr = rdpr; zoom = Math.min(zoom, zmax()); zt = Math.min(zt, zmax()); applyZoom();
    if (typeof ArtWorld !== 'undefined') ArtWorld.setScale(rdpr, zb);
    commitStep();
    const r = cv.getBoundingClientRect(); crect = { left: r.left, top: r.top };
  }
  // экран ↔ мир: ОДНА пара функций на весь код (clientX/Y в CSS px; тряска не входит)
  const screenToWorld = (sx, sy) => ({ x: (sx - crect.left) / zoom + cam.x, y: (sy - crect.top) / zoom + cam.y });
  const worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * zoom + crect.left, y: (wy - cam.y) * zoom + crect.top });
  // масштаб меток над миром (реплики, подписи, «+1»): растут с зумом до ×1.6, дальше — экранного размера
  const uiK = () => Math.min(1, 1.6 / zoom);
  // focus — точка, за которой камера идёт вместо героя (разговор: середина пары, js/talk.js)
  let focus = null;
  const followTarget = () => (focus ? { x: focus.x - vw / 2, y: focus.y - vh / 2 } : { x: G.p.x - vw / 2, y: G.p.y - 20 - vh / 2 });
  function clampCam() { cam.x = clamp(cam.x, -vw / 2, W - vw / 2); cam.y = clamp(cam.y, -vh / 2, H - vh / 2); }
  // один шаг зума с якорем: точка под (sx, sy) остаётся на месте
  function zoomAt(z, sx, sy) {
    if (Math.abs(z - zoom) < 1e-5) return;
    const w = screenToWorld(sx, sy);
    zoom = z; applyZoom(); zAt = performance.now();
    cam.x = w.x - (sx - crect.left) / zoom; cam.y = w.y - (sy - crect.top) / zoom;
    // зум не у центра — точка под курсором должна остаться на месте: камера свободна
    if (camMode !== 'free' && (Math.abs(sx - rw / 2) > 2 || Math.abs(sy - rh / 2) > 2)) { camMode = 'free'; ret = null; }
    if (camMode === 'free') clampCam();
  }
  // мгновенно (программный зум, щипок). soft — жест ещё идёт: ступень кэшей сменится, когда зум постоит
  function setZoom(z, sx = rw / 2, sy = rh / 2, soft = false) {
    z = clamp(z, ZMIN, zmax()); zt = z;
    zoomAt(z, sx, sy);
    if (!soft) commitStep();
  }
  // плавно (колесо, тачпад, клавиши, кнопка): цель копится, зум догоняет в render
  function zoomTo(z, sx = rw / 2, sy = rh / 2) { zt = clamp(z, ZMIN, zmax()); zax = sx; zay = sy; zAt = performance.now(); }
  const zoomBy = (f, sx, sy) => zoomTo(zt * f, sx, sy);
  let zLast = 0;
  function zoomStep() {
    const t = performance.now(), dt = zLast ? Math.min(0.1, (t - zLast) / 1000) : 0; zLast = t;
    if (zt !== zoom) { const z = zt * Math.pow(zoom / zt, Math.exp(-dt * ZOOM_K)); zoomAt(Math.abs(z / zt - 1) < 0.002 ? zt : z, zax, zay); if (zoom === zt) zAt = t; }
    if (zt === zoom && t - zAt > 160 && (stepFor(zoom) !== zb || (zc < 0.9) !== (zoom < 0.9) || (SF && Math.abs(Math.log(zoom / zi)) > ZI_TOL))) commitStep();
    // старая ступень держится запасным кэшем 3 с после смены (пока новая допекается), потом — вон
    if (zOld && t - zOld > 3000) {
      zOld = 0; if (typeof ArtWorld !== 'undefined') ArtWorld.purge();
      const cs = chunkScale(); for (const [k, e] of chunks) if (e.s !== cs) { chunks.delete(k); if (!e.done) bakeQ = bakeQ.filter(q => q !== e); }
    }
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
    const k = ease(6, dt); cam.x += (tg.x - cam.x) * k; cam.y += (tg.y - cam.y) * k;
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
  let RPAT = null, GRAIN = null;
  // Свет в карте освещения кладётся режимом 'screen' (без насыщения каналов), поэтому спад — плавный
  // «гаусс» одного оттенка: смена оттенка к краю + клиппинг каналов при 'lighter' давали радужные кольца.
  const bell = (rgb, a0, n = 9) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, k = Math.exp(-t * t * 4.2) * (1 - t * t); return [t, `rgba(${rgb},${(a0 * k).toFixed(3)})`]; });
  const L_WARM = radial(256, bell('255,178,108', 0.95));
  const L_COOL = radial(256, bell('165,188,240', 0.8));
  // огонь: мягкий спад без края — (1 − t²)² × гаусс шире: к краю доходит до нуля плавно, «пятна с кромкой» нет
  const L_FIRE = radial(256, Array.from({ length: 17 }, (_, i) => { const t = i / 16, k = Math.exp(-t * t * 2.6) * (1 - t * t) ** 2; return [t, `rgba(255,172,100,${(0.98 * k).toFixed(3)})`]; }));
  const L_RED = radial(128, [[0, 'rgba(255,90,70,1)'], [1, 'rgba(0,0,0,0)']]);
  // C: свет — зона с краем в две ступени (внутри роли дневные, в кольце — наполовину к дневным/охре), а не мягкое пятно
  const stepL = t => { const z = Style.LZ, rgb = z[t].join(','); return radial(256, [[0, `rgba(${rgb},1)`], [z.core, `rgba(${rgb},1)`], [z.core + 0.015, `rgba(${rgb},${z.ring})`], [z.edge, `rgba(${rgb},${z.ring})`], [z.edge + 0.015, `rgba(${rgb},0)`], [1, `rgba(${rgb},0)`]]); };
  const LC = SF ? { f: stepL('f'), w: stepL('w'), c: stepL('c'), r: stepL('r') } : null;
  const GLOW = radial(128, [[0, 'rgba(255,140,50,0.7)'], [0.4, 'rgba(255,110,30,0.25)'], [1, 'rgba(0,0,0,0)']]);
  const PUFF = radial(32, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  // мягкий спад без жёсткого края; середина плотная — тень заметная, но без кромки
  const SHADOW = radial(64, [[0, 'rgba(39,57,74,1)'], [0.35, 'rgba(39,57,74,0.8)'], [0.65, 'rgba(39,57,74,0.4)'], [0.86, 'rgba(39,57,74,0.1)'], [1, 'rgba(39,57,74,0)']]);
  const strip = (c1, c2) => sprite(1, 64, g => {
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.15, c1); gr.addColorStop(0.55, c2); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1, 64);
  }, 1);
  const BANDS = [[strip('rgba(61,255,156,0.9)', 'rgba(31,209,165,0.35)'), 0, 0.34], [strip('rgba(31,209,165,0.8)', 'rgba(139,92,246,0.35)'), 1.7, 0.26], [strip('rgba(255,79,139,0.5)', 'rgba(139,92,246,0.4)'), 3.1, 0.18]];

  // ---------- деревья: кэш ArtWorld в масштабе rdpr × zb ----------
  // C: спрайт дерева — под «зум туши» zi (контур постоянной экранной толщины), а не под ступень
  const treeSprite = (t, v = t.v) => ArtWorld.treeSprite(t.kind, t.s, t.dk != null ? t.dk : t.wall, v, rdpr * (SF ? zi : zb)); // стена: dk — тёмный рисунок (второй ряд) или обычный

  // ---------- снег кусками (C8): печь полосами, не больше бюджета за кадр; река — отдельным слоем ----------
  // Кусок — CS мировых px в масштабе s. На крупных ступенях кусок мельче (256, 128): canvas ≤ 1280 px — меньше памяти на кадр.
  // CS — размер куска, который печётся сейчас (bakePart ставит свой перед полосой; snowPhoto/bakeStatic берут отсюда).
  // Полоса всегда 64 px мира (кусок 512 — 8 полос, 256 — 4, 128 — 2): сетка рельефа ровно на полосу.
  const SH = 64, BASE = SF ? Style.P.paper : '#eaeff5';
  let CS = 512;
  let chunkCap = 24, bakeQ = [], warm = true, chunkBytes = 0;
  // ступени 1 и 1.6 — снег в rdpr (как прежде: рельеф мягкий); с 2.5 — в rdpr × ступень
  const chunkScale = () => (zc < 0.9 ? 1 : rdpr * (zb >= 2.5 ? zb : 1));
  const chunkSize = s => (s <= 2.5 ? 512 : s <= 5 ? 256 : 128);
  const CHUNK_MB = () => (window.QUALITY === 'low' ? 64 : 160) * 1048576; // потолок памяти кусков (все ступени вместе)
  function chunkAt(ix, iy, s, want) {
    const k = ix + ',' + iy + '@' + s; let e = chunks.get(k);
    if (e) { chunks.delete(k); chunks.set(k, e); e.f = frame; return e; } // LRU: свежие в конце
    if (!want) return null;
    const cs = chunkSize(s), c = document.createElement('canvas'); c.width = c.height = Math.ceil(cs * s);
    e = { c, g: c.getContext('2d'), ix, iy, s, cs, part: 0, done: false, f: frame, b: c.width * c.height * 4 };
    chunks.set(k, e); bakeQ.push(e);
    return e;
  }
  function trimChunks() {
    chunkBytes = 0; for (const e of chunks.values()) chunkBytes += e.b;
    for (const [k, e] of chunks) {
      if (chunks.size <= chunkCap && chunkBytes <= CHUNK_MB()) break;
      if (e.f === frame) continue; // видимое в этом кадре не выселяем
      chunks.delete(k); chunkBytes -= e.b; if (!e.done) bakeQ = bakeQ.filter(q => q !== e);
    }
  }
  // кусок нужной ступени ещё печётся — показать то, что есть от других ступеней (без вспышки ровного тона)
  function chunkFallback(X, Y, cw) {
    cx.fillStyle = BASE; cx.fillRect(X, Y, cw + 1, cw + 1);
    for (const e of chunks.values()) {
      if (!e.done) continue;
      const EX = e.ix * e.cs, EY = e.iy * e.cs, x0 = Math.max(X, EX), y0 = Math.max(Y, EY), x1 = Math.min(X + cw, EX + e.cs), y1 = Math.min(Y + cw, EY + e.cs);
      if (x1 <= x0 || y1 <= y0) continue;
      const k = e.c.width / e.cs;
      cx.drawImage(e.c, (x0 - EX) * k, (y0 - EY) * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
    }
  }
  // рельеф снега: поле высот (гребни надувов вдоль ветра + мелкая рябь-заструга) освещается низким солнцем слева-сверху:
  // яркость = наклон поверхности к свету. Мировые координаты — швов между кусками нет. Сетка 16×16 и 8×4 px, растяжение билинейное.
  // Бюджет: ~2,5 тыс. вызовов шума на полосу (было ~28 тыс.) — октав меньше, сетка реже, рябь из одной выборки. В low рельефа нет.
  const SN = Noise.make(mulberry(0x5E0)), LX = -0.62, LY = -0.55, LZ = 0.56, RL = [
    { ax: 16, ay: 16, nx: 32, ny: 4, fx: 260, fy: 105, oct: 2, ridge: 0.6, amp: 14, k: 1.0 },
    { ax: 8, ay: 4, nx: 64, ny: 16, fx: 30, fy: 8, oct: 0, ridge: 0.5, amp: 2.2, k: 0.5 } // oct 0: одна выборка шума на точку (гребень и склон из неё же)
  ].map(L => {
    const W = L.nx + 2, H = L.ny + 2, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    L.W = W; L.H = H; L.cv = cv; L.g = cv.getContext('2d'); L.im = L.g.createImageData(W, H); L.h = new Float32Array((W + 2) * (H + 2)); return L;
  });
  function snowRelief(g, X, Yw, y0) {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    for (const L of RL) {
      const { W, H, h, ax, ay, fx, fy, oct, ridge } = L, d = L.im.data, W2 = W + 2, kx = L.amp / (2 * ax), ky = L.amp / (2 * ay);
      for (let j = -1; j <= H; j++) {
        const v = (Yw + (j - 0.5) * ay) / fy, r0 = (j + 1) * W2 + 1;
        for (let i = -1; i <= W; i++) {
          const u = (X + (i - 0.5) * ax) / fx;
          if (!oct) { const n = SN.n2(u + 31, v + 17); h[r0 + i] = (1 - ridge) * n + ridge * (1 - 2 * Math.abs(n)); continue; }
          h[r0 + i] = (1 - ridge) * SN.fbm(u * 1.7 + 9, v * 1.7 + 4, oct) + ridge * (1 - 2 * Math.abs(SN.fbm(u + 31, v + 17, oct)));
        }
      }
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const c = (j + 1) * W2 + i + 1, gx = (h[c + 1] - h[c - 1]) * kx, gy = (h[c + W2] - h[c - W2]) * ky;
        const il = 1 / Math.sqrt(gx * gx + gy * gy + 1), sh = ((-gx * LX - gy * LY + LZ) * il - LZ) * L.k, o = (j * W + i) * 4;
        if (sh < 0) { d[o] = 96; d[o + 1] = 128; d[o + 2] = 160; d[o + 3] = Math.min(255, -sh * 255 * 1.5); }
        else { d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = Math.min(255, sh * 255 * 1.6); }
      }
      L.g.putImageData(L.im, 0, 0);
      g.drawImage(L.cv, 1, 1, L.nx, L.ny, 0, y0, L.nx * ax, L.ny * ay);
    }
  }
  // фото-микрорельеф снега (CC0, js/photo.js): текстура-«серый нейтраль» поверх освещённого рельефа, в мировых координатах
  // (тайлится без швов), два слоя разного масштаба и поворота — повтор не читается. Тёмное в текстуре уже синеватое, прозрачность
  // слабая — снег не «грязнеет». Только high; нет файла — ничего не делаем.
  const PH = [[0.6, 0, 0.15], [0.27, 0.9, 0.09]];
  function snowPhoto(g, X, Yw, y0) {
    if (typeof Photo === 'undefined') return;
    for (const [sc, rot, a] of PH) {
      const p = Photo.pattern('snow', sc, rot); if (!p) return;
      g.save(); g.translate(-X, y0 - Yw); g.globalCompositeOperation = 'hard-light'; g.globalAlpha = a; g.fillStyle = p;
      g.fillRect(X, Yw, CS, SH); g.restore();
    }
  }
  // одна полоса 512×64: фон, крап, штрихи ветра, статика (кедрач, марь, кочки, сугробы) под clip
  function bakePart(e) {
    CS = e.cs;
    const g = e.g, i = e.part, X = e.ix * CS, Y = e.iy * CS, y0 = i * SH;
    g.setTransform(e.s, 0, 0, e.s, 0, 0);
    if (SF) return bakePartC(e, g, i, X, Y, y0);
    g.fillStyle = BASE; g.fillRect(0, y0, CS, SH);
    g.save(); g.beginPath(); g.rect(0, y0, CS, SH); g.clip();
    if (window.QUALITY !== 'low') { snowRelief(g, X, Y + y0, y0); snowPhoto(g, X, Y + y0, y0); }
    // крап и штрихи ветра — от опорной полосы мира 512×64 (кусок 256 берёт её часть под clip): узор один на любой ступени
    const RX = Math.floor(X / 512) * 512, RY = Math.floor((Y + y0) / 64) * 64, riy = Math.floor(RY / 512);
    const r = mulberry(RX / 512 * 7919 + riy * 104729 + (RY - riy * 512) / 64 * 3571 + G.seed);
    g.save(); g.translate(RX - X, RY - Y);
    for (const [c, k0] of [['rgba(111,142,168,0.1)', 0], ['rgba(246,249,252,0.7)', 1]]) {
      g.fillStyle = c; g.beginPath();
      for (let k = 0; k < 75; k++) { const a = r(); g.rect(r() * 512, r() * 64, 1 + (a * 0.5 + k0 * 0.5) * 2, 1); }
      g.fill();
    }
    g.strokeStyle = 'rgba(182,201,223,0.3)'; g.lineWidth = 1.2; g.beginPath();
    for (let k = 0; k < 4; k++) { const x = r() * 512, y = r() * 64, L = 20 + r() * 40; g.moveTo(x, y); g.quadraticCurveTo(x + L / 2, y - 4, x + L, y + 1); }
    g.stroke(); g.restore();
    g.translate(-X, -Y); bakeStatic(g, X, Y + y0, SH);
    g.restore();
    if (++e.part >= CS / SH) { e.done = true; e.g = null; }
  }
  // C: снег — бумага; рельеф и фото не нужны; ветер — редкие штрихи тона тени, сугробы — штрихом у теневой кромки
  function bakePartC(e, g, i, X, Y, y0) {
    g.fillStyle = Style.P.paper; g.fillRect(0, y0, CS, SH);
    g.save(); g.beginPath(); g.rect(0, y0, CS, SH); g.clip();
    const RX = Math.floor(X / 512) * 512, RY = Math.floor((Y + y0) / 64) * 64, riy = Math.floor(RY / 512);
    const r = mulberry(RX / 512 * 7919 + riy * 104729 + (RY - riy * 512) / 64 * 3571 + G.seed);
    g.save(); g.translate(RX - X, RY - Y);
    g.strokeStyle = Style.P.shade; g.lineWidth = 1.7; g.lineCap = 'round'; g.beginPath();
    const n = window.QUALITY === 'low' ? 1 : 2;
    for (let k = 0; k < n; k++) { const x = r() * 512, y = r() * 64, L = 40 + r() * 90; g.moveTo(x, y); g.quadraticCurveTo(x + L / 2, y - 2.5, x + L, y + 0.5); }
    g.stroke(); g.restore();
    g.translate(-X, -Y);
    const inR = (x, y, m) => x > X - m && x < X + CS + m && y > Y + y0 - m && y < Y + y0 + SH + m, cxm = X + CS / 2, cym = Y + y0 + SH / 2, rr0 = Math.hypot(CS, SH) / 2;
    ArtZones.bakeGround(g, X, Y + y0, CS, SH, G.seed | 0);   // земля зон — следующий этап перевода (пока прежняя)
    SNEAR.length = 0;
    for (const t of Space.tussocks.near(cxm, cym, rr0 + 20, SNEAR)) if (inR(t.x, t.y, 20)) ArtWorld.tussock(g, t);   // кочки мари — следующий этап
    SNEAR.length = 0;
    for (const d of Space.drifts.near(cxm, cym, rr0 + 120, SNEAR)) if (inR(d.x, d.y, d.rx + 10)) Style.drift(g, d);
    g.restore();
    if (++e.part >= CS / SH) { e.done = true; e.g = null; }
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
  let partMs = 1, bakeMax = 0; // partMs — скользящая цена одной полосы; bakeMax — самый долгий проход печи с последнего сброса (для замеров)
  function bakeRun(budget) {
    const t0 = performance.now();
    let n = 0;
    while (bakeQ.length && n < 64) {
      const e = bakeQ[0], a = performance.now(); bakePart(e); n++;
      partMs = partMs * 0.8 + (performance.now() - a) * 0.2; // средняя цена полосы: следующую берём, только если влезет в бюджет
      if (e.done) bakeQ.shift();
      if (!warm && performance.now() - t0 + partMs > budget) break;
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
  const LOWQ = () => window.QUALITY === 'low';
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
    // трещины льда: не белые штрихи («разметка»), а тонкие тёмные волосяные линии с изломом и светлым краем под ними — фактура
    const CR_ = cracksNear(y0, y1), crack = (c, dx, dy) => { const x = riverX(c.y) + c.off + dx, ex = Math.cos(c.a) * c.len, ey = Math.sin(c.a) * c.len * 0.4, k = ((c.off * 7 + c.len) % 5 - 2.5) * 0.9;
      cx.moveTo(x, c.y + dy); cx.quadraticCurveTo(x + ex * 0.5 - ey * 0.25 + k, c.y + dy + ey * 0.5 + ex * 0.08, x + ex, c.y + dy + ey); };
    cx.lineWidth = 1.4; cx.strokeStyle = 'rgba(246,249,252,0.28)'; cx.beginPath(); for (const c of CR_) crack(c, 0.6, 0.9); cx.stroke();
    cx.lineWidth = 0.7; cx.strokeStyle = 'rgba(88,116,142,0.42)'; cx.beginPath(); for (const c of CR_) crack(c, 0, 0); cx.stroke();
    // перекат — тонкий лёд темнее к середине (мягкий спад, без кромки), редкие извилистые трещины от промоины; пар — в мороз
    const Pp = POI.polynya;
    if (Pp.y + 60 > y0 && Pp.y - 60 < y1) {
      cx.save(); cx.translate(Pp.x, Pp.y); cx.scale(1, 50 / (Pp.r - 20));
      const tg = cx.createRadialGradient(0, 0, 0, 0, 0, Pp.r - 20); tg.addColorStop(0, 'rgba(84,112,138,0.42)'); tg.addColorStop(0.55, 'rgba(111,142,168,0.26)'); tg.addColorStop(1, 'rgba(111,142,168,0)');
      cx.fillStyle = tg; cx.beginPath(); cx.arc(0, 0, Pp.r - 20, 0, Math.PI * 2); cx.fill(); cx.restore();
      const soft = (col, w, dx, dy) => {
        cx.strokeStyle = col; cx.lineWidth = w; cx.beginPath();
        for (let i = 0; i < 6; i++) { // 6 трещин разной длины, угол и излом — от номера (без «солнышка»: не от центра и не поровну)
          const a = 0.5 + i * 1.07 + Math.sin(i * 2.3) * 0.35, L = 46 + 26 * ((i * 37) % 5) / 4, r0 = 26 + (i % 3) * 3;
          let x = Pp.x + Math.cos(a) * r0 + dx, y = Pp.y + Math.sin(a) * r0 * 0.46 + dy; cx.moveTo(x, y);
          for (let j = 1; j <= 3; j++) { const b = a + Math.sin(i * 5.1 + j * 1.9) * 0.45, st = L / 3, b2 = b + Math.sin(i * 3.7 + j) * 0.5, mx = x + Math.cos(b2) * st * 0.5, my = y + Math.sin(b2) * st * 0.23; x += Math.cos(b) * st; y += Math.sin(b) * st * 0.46; cx.quadraticCurveTo(mx, my, x, y); } // плавный излом — без «ломаной»
        }
        cx.stroke();
      };
      soft('rgba(246,249,252,0.2)', 1.2, 0.6, 0.8); soft('rgba(70,98,124,0.3)', 0.6, 0, 0);
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
  // ветер-поле: порыв — волна шума, бегущая по миру вдоль ветра (+x); между порывами штиль (g = 0)
  // (единый ветер js/wind.js: тот же шум, та же скорость 110 px/с и длина 560 px — вид и характер качания прежние)
  const gustAt = (x, y) => Wind.gust(x, y);
  // вариант ели по хэшу позиции (3 вместо 2: меньше одинаковых копий); стена-частокол — как есть
  // индивидуальность: размер ±7% по хэшу позиции (и у стены края — её размер/вид/сдвиг уже из генерации). Без зеркала: свет в спрайтах запечён слева
  const tjit = t => {
    const h = Math.imul(Math.imul(t.x | 0, 73856093) ^ Math.imul(t.y | 0, 19349663), 1) >>> 0, m = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return 0.93 + ((m >>> 1) & 15) / 15 * 0.14;
  };
  const treeV = t => t.kind === 0 && !t.wall ? (t.v + ((((t.x * 73856093) ^ (t.y * 19349663)) >>> 0) % 3)) % 3 : t.v;
  // изгиб: смещение на высоте h (0..160) = sway·h²/160 — комель на месте, крона гнётся; срезы спрайта стыкуются по ломаной
  const SLICE = [-10, 28, 70, 112, 160], GUSTY = [];
  // отклики вещей на жесты героя (Interact) — память рендера, не в G: зарубка на стволе растёт с каждым ударом,
  // костёр вспыхивает от рук, тайник приподнимает крышку, пнутый сугроб оставляет ямку
  const CUT = new WeakMap(), FLARE = new WeakMap(), OPEN = new WeakMap(), KICKS = [];
  if (typeof Interact !== 'undefined') {
    Interact.on('hit', e => { const t = e.target; if (!t) return; const c = CUT.get(t) || { n: 0, side: Math.sign((e.who === 'p' ? G.p.x : e.who.x) - t.x) || 1 }; c.n++; CUT.set(t, c); if (typeof Tree !== 'undefined') Tree.shook(t, e.power || 1); });
    Interact.on('warm', e => { if (e.target) FLARE.set(e.target, now); });
    Interact.on('open', e => { if (e.target) OPEN.set(e.target, now); });
    Interact.on('kick', e => { KICKS.push({ x: e.x, y: e.y, t0: now }); if (KICKS.length > 8) KICKS.shift(); });
  }
  function drawCut(t, c) {
    const s = t.s, sd = c.side, n = Math.min(c.n, 6), d = (1.5 + n * 0.6) * s, h = (2 + n * 0.5) * s, x = t.x + sd * 5 * s, y = t.y - 15 * s;
    cx.fillStyle = '#3a2618'; cx.beginPath(); cx.moveTo(x, y - h - 0.8); cx.lineTo(x - sd * (d + 0.8), y); cx.lineTo(x, y + h * 0.6 + 0.8); cx.closePath(); cx.fill(); // тень зарубки
    cx.fillStyle = '#e0b47a'; cx.beginPath(); cx.moveTo(x, y - h); cx.lineTo(x - sd * d, y); cx.lineTo(x, y + h * 0.6); cx.closePath(); cx.fill();
    cx.fillStyle = '#c79a62'; cx.beginPath(); cx.moveTo(x, y - h); cx.lineTo(x - sd * d, y); cx.lineTo(x, y); cx.closePath(); cx.fill(); // верхняя грань темнее
    cx.fillStyle = '#d9bd8a'; for (let i = 0; i < Math.min(n, 5); i++) cx.fillRect(x + sd * (4 + i * 3.3), t.y + 2 + (i % 2) * 2, 2.2, 1.2); // щепа у комля
  }
  // объёмная модель (js/tree3d.js): стоящие в покое — спрайт модели, в движении/рубке — живая модель; пень — тоже модель
  const M3 = t => typeof Tree !== 'undefined' && !t.wall && Tree.MODEL[t.kind];
  // глубина зарубки: доля диаметра — от ударов и срубленной доли
  const notchOf = t => { const c = CUT.get(t); return c ? { q: Math.min(0.72, 0.05 * c.n + 0.5 * (1 - t.wood / World.wood0(t))), sd: c.side } : null; };
  const stumpOf = (t, sn) => (M3(t) ? Tree.drawStump(cx, t, sn) : ArtWorld.stump(cx, t.x, t.y, t.s, sn));
  // отрастание (World.regrowK): росток из пня в последней трети, деревце растёт и к концу «переходит» в ёлочку
  // малого роста, взрослая дорастает (World.adultK) — ни одной смены вида скачком; GROWK — масштаб ёлки при перерисовке
  let GROWK = 0;
  function drawTree(t, wind) {
    if (t.wood <= 0) {
      CUT.delete(t); stumpOf(t, t.cutAt != null && G.time - t.cutAt < CYCLE * 0.6 ? clamp((G.time - t.cutAt) / (CYCLE * 0.6), 0, 1) : 1); // свежий срез без снега, снег нарастает за ~0.6 суток
      const k = t.cutAt != null ? World.regrowK(t) : 0; if (k > 0.65) ArtWorld.sapling(cx, t.x, t.y, t.s * 0.5 * (k - 0.65) / 0.35, t.v);
      return;
    }
    if (t.stage === 1 && !GROWK) {
      const k = World.regrowK(t), sa = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      if (k < 0.3) { cx.globalAlpha = 1 - k / 0.3; stumpOf(t, 1); cx.globalAlpha = 1; }
      if (sa > 0.01) { cx.globalAlpha = sa; ArtWorld.sapling(cx, t.x, t.y, t.s * (0.5 + 0.5 * k), t.v); cx.globalAlpha = 1; }
      if (k > 0.75) { GROWK = World.ADULT_K0 * (0.7 + 0.3 * (k - 0.75) / 0.25); cx.globalAlpha = (k - 0.75) / 0.25; drawTree(t, wind); cx.globalAlpha = 1; GROWK = 0; }
      return;
    }
    // живая модель — только у взрослой (дорастающая рисуется спрайтом модели в масштабе роста ниже)
    if (M3(t) && !GROWK && !(t.gAt != null && World.adultK(t) < 1)) { const nt = notchOf(t); if (Tree.live(t, nt)) { const g = gustAt(t.x, t.y), ph = t.x * 0.013 + t.y * 0.007, Hp = 112 * t.s;
      const sw = wind * 0.05 * (0.12 + 0.88 * g) * (0.75 + 0.25 * Math.sin(now * 1.7 + ph)) * ENV.wx; Tree.drawStanding(cx, t, { bend: sw * Hp * Hp / 160, notch: nt }); return; } }
    const g = gustAt(t.x, t.y), ph = t.x * 0.013 + t.y * 0.007;
    const sway = wind * 0.05 * (0.12 + 0.88 * g) * (0.75 + 0.25 * Math.sin(now * 1.7 + ph)) * ENV.wx + (t.shake > 0 ? Math.sin(now * 60) * t.shake * 0.25 : 0); // гнутся по ветру (ENV.wx — знак и доля x)
    const fl = wind * (0.3 + g) * 0.9 * Math.sin(now * 7.3 + ph * 5); // дрожь верхушки, px
    if (g > 0.75 && GUSTY.length < 8 && dist2(t, G.p) < 340 * 340) GUSTY.push(t);
    const S = treeSprite(t, treeV(t)), tw = ArtWorld.treeW(t.kind), k = t.s / ArtWorld.treeK(t.s), kd = k * dpr * tjit(t) * (GROWK || (t.gAt != null ? World.adultK(t) : 1));
    const X = (t.x - cam.x + shx) * dpr, Y = (t.y - cam.y + shy) * dpr;
    if (window.QUALITY === 'low' || Math.abs(sway * 160) + Math.abs(fl) < 1.5) { // штиль: изгиб < 0.4 px от наклона — один drawImage
      cx.setTransform(kd, 0, -sway * kd, kd, X, Y); cx.drawImage(S, -tw / 2, -160, tw, 170); WT(); const c = CUT.get(t); if (c) drawCut(t, c); return;
    }
    const sc = S.width / tw, off = h => (h > 0 ? sway * h * h / 160 : 0);
    let rLo = S.height, hLo = SLICE[0], oLo = 0;
    for (let i = 1; i < SLICE.length; i++) {
      const top = i === SLICE.length - 1, rHi = top ? 0 : Math.round((160 - SLICE[i]) * sc), hHi = 160 - rHi / sc, oHi = off(hHi) + (top ? fl : 0);
      const kk = (oHi - oLo) / (hHi - hLo), rB = Math.min(S.height, rLo + (i > 1 ? 1 : 0)); // +1 ряд внахлёст на нижний срез — без щели
      cx.setTransform(kd, 0, -kk * kd, kd, X + (oLo - kk * hLo) * kd, Y);
      cx.drawImage(S, 0, rHi, S.width, rB - rHi, -tw / 2, rHi / sc - 160, tw, (rB - rHi) / sc);
      rLo = rHi; hLo = hHi; oLo = oHi;
    }
    WT(); const c = CUT.get(t); if (c) drawCut(t, c);
  }
  // ---------- валка и лежачая ель: ОДИН рендер (падение, лежит, обрубка, разделка, заметание; до и после загрузки сейва) ----------
  // Ствол героя — G.logs (L.f — идёт валка: t, w надлом, T падение, r перекат); деревья людей посёлка — FALL (только рендер, лежат и уходят).
  // Поза: th — угол от вертикали (0 стоит → π/2 лежит), lag — отставание кроны (px на вершине), roll — перекат вокруг ствола.
  // Надлом: качание и наклон до 0.06; падение — маятник θ'' = sin θ (медленный старт, разгон); удар: два отскока, хлёст кроны, перекат.
  const PEND = (() => {
    const pts = [[0, 0.06]]; let t = 0, a = 0.06, w = 0.16;
    while (a < Math.PI / 2) { w += Math.sin(a) * 2e-3; a += w * 2e-3; t += 2e-3; pts.push([t, Math.min(a, Math.PI / 2)]); }
    const T = []; for (let i = 0, j = 0; i <= 64; i++) { const tt = t * i / 64; while (j < pts.length - 2 && pts[j + 1][0] < tt) j++; T.push(pts[j][1]); }
    T[64] = Math.PI / 2; return T;
  })();
  function fallPose(f, el) {
    const w = f.w, T = f.T;
    if (el < w) { const k = el / w; return { th: 0.06 * k * k + Math.sin(el * 41) * 0.011 * (1 - 0.6 * k), lag: 0, roll: 0, ph: 0 }; }
    const u = (el - w) / T;
    if (u < 1) { const x = u * 64, i = Math.min(63, x | 0), th = PEND[i] + (PEND[i + 1] - PEND[i]) * (x - i), om = (PEND[i + 1] - PEND[i]) * 64 / T; return { th, lag: om * 7, roll: 0, ph: 1 }; }
    const e = el - w - T, b = e < 0.2 ? 0.075 * Math.sin(e / 0.2 * Math.PI) : e < 0.36 ? 0.028 * Math.sin((e - 0.2) / 0.16 * Math.PI) : 0;
    return { th: Math.PI / 2 - b, lag: -9 * Math.exp(-e * 6) * Math.cos(e * 21), roll: (f.r || 0.06) * (1 - Math.exp(-e * 8)), ph: 2 };
  }
  const LIE = { th: Math.PI / 2, lag: 0, roll: 0, ph: 3 }, DRAGP = { th: Math.PI / 2, lag: 0, roll: 0, ph: 2.5 };
  // снег с ветвей: спрайт без снега для лежачей кроны (снег сверху рисуется отдельно, по месту) — один раз на спрайт, не больше одного за кадр
  const NOSNOW = new WeakMap(); let nsBudget = 1;
  function desnow(S) {
    let c = NOSNOW.get(S); if (c) return c;
    if (nsBudget <= 0 || LOWQ()) return null; nsBudget--;
    try {
      c = document.createElement('canvas'); c.width = S.width; c.height = S.height; const g = c.getContext('2d'); g.drawImage(S, 0, 0);
      const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue; const r = d[i], gg = d[i + 1], b = d[i + 2];
        if (b > 140 && gg > 135 && b >= r - 4 && b - r < 70) { const k = 0.45 + 0.75 * (r + gg + b) / 765; d[i] = 48 * k; d[i + 1] = 92 * k; d[i + 2] = 66 * k; }
      }
      g.putImageData(im, 0, 0);
    } catch (e) { c = S; }
    NOSNOW.set(S, c); return c;
  }
  // полуширина кроны на высоте h (ед. спрайта): ель — конус, берёза/гарь — узко, кедр — шире
  const crownR = (kind, h) => h < 10 ? 0 : (kind === 2 ? 52 : kind === 1 ? 20 : kind === 3 ? 10 : 44) * clamp(1 - (h - 14) / 150, 0.08, 1);
  const TAU_ = Math.PI * 2;
  // o: {x, y, a — куда лёг, s, kind, v, len, cut 0..1 — снято кроны от вершины, kl — доля ствола после разделки, snow, bury 0..1, al}
  function drawFelled(o, P) {
    const th = P.th, st = Math.sin(th), ct = Math.cos(th), cd = Math.cos(o.a), sd = Math.sin(o.a);
    const tw = ArtWorld.treeW(o.kind), kd = o.len / 150 * dpr, X = (o.x - cam.x + shx) * dpr, Y = (o.y - cam.y + shy) * dpr;
    // ось ствола на экране (на ед. высоты); к камере — ведём через бок, чтобы не схлопнулась в точку
    let ux = cd * st, uy = -ct + 0.6 * sd * st; if (sd > 0.3) ux += (cd >= 0 ? 1 : -1) * 0.42 * sd * Math.sin(2 * th);
    const ul = Math.hypot(ux, uy) || 1, Ux = ux * kd, Uy = uy * kd, vx = -uy / ul, vy = ux / ul, ang = Math.atan2(Uy, Ux);
    const Vx = vx * kd, Vy = vy * kd - P.roll * kd * 0.8 * st;   // поперёк: ширина кроны прежняя; перекат — наклон поперечника
    const s = o.s || 1, cut = o.cut || 0, hc = 160 - cut * 154, hEnd = 150 * (o.kl == null ? 1 : o.kl), lie = st * st;
    // смещение оси на высоте h: подъём над снегом (крона держит ствол), отставание/хлёст кроны поперёк хода
    const mx = cd * ct, my = st + 0.6 * sd * ct, ml = Math.hypot(mx, my) || 1, arch = 6 * s * (1 - cut) * lie;
    const off = h => { const z = (4.2 * s + arch * Math.pow(Math.sin(Math.PI * clamp(h / 155, 0, 1)), 0.7)) * lie * dpr, q = P.lag * (h / 160) * (h / 160) * dpr; return [-mx / ml * q, -z - my / ml * q]; };
    const at = h => { const O = off(h); return [X + Ux * h + O[0], Y + Uy * h + O[1]]; };
    const al = o.al == null ? 1 : o.al; if (al <= 0.01) return;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    // тень на снегу вдоль ствола (лежит/почти лёг)
    if (lie > 0.3) {
      const a0 = [X, Y], a1 = [X + cd * st * kd * hEnd, Y + 0.6 * sd * st * kd * hEnd], w = (cut < 1 ? 26 : 7) * s * dpr;
      cx.globalAlpha = 0.26 * al * lie; cx.save(); cx.translate((a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2 + 3 * dpr); cx.rotate(Math.atan2(a1[1] - a0[1], a1[0] - a0[0]));
      const Lh = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) / 2 + 10 * dpr; cx.drawImage(SHADOW, -Lh, -w * 0.55, Lh * 2, w * 1.1); cx.restore();
    }
    cx.globalAlpha = al;
    // голый ствол там, где кроны нет (обрублена) — от среза кроны до конца (рез или вершина)
    const R = h => (4.2 + (1.6 - 4.2) * clamp(h / 150, 0, 1)) * s * dpr * 0.62 * (1 + 0.6 * lie);
    if (hc < hEnd + 2) {
      const h0 = Math.max(6, hc - 4), a0 = at(h0), a1 = at(hEnd), r0 = R(h0), r1 = R(hEnd);
      cx.fillStyle = '#5b3d27'; cx.beginPath();
      cx.moveTo(a0[0] + vx * r0, a0[1] + vy * r0); cx.lineTo(a1[0] + vx * r1, a1[1] + vy * r1); cx.lineTo(a1[0] - vx * r1, a1[1] - vy * r1); cx.lineTo(a0[0] - vx * r0, a0[1] - vy * r0); cx.closePath(); cx.fill();
      const sg = vy >= 0 ? 1 : -1;   // тёмная кромка — к снегу (вниз по экрану), светлая — сверху
      cx.strokeStyle = '#3a2618'; cx.lineWidth = r0 * 0.55; cx.beginPath(); cx.moveTo(a0[0] + vx * sg * r0 * 0.6, a0[1] + vy * sg * r0 * 0.6); cx.lineTo(a1[0] + vx * sg * r1 * 0.6, a1[1] + vy * sg * r1 * 0.6); cx.stroke();
      cx.strokeStyle = '#8a6a45'; cx.lineWidth = Math.max(1, r0 * 0.32); cx.beginPath(); cx.moveTo(a0[0] - vx * sg * r0 * 0.5, a0[1] - vy * sg * r0 * 0.5); cx.lineTo(a1[0] - vx * sg * r1 * 0.5, a1[1] - vy * sg * r1 * 0.5); cx.stroke();
      if (lie > 0.8) { cx.fillStyle = '#3a2618'; for (let h = Math.max(24, hc); h < hEnd - 6; h += 15) { const q = at(h), r = R(h); cx.fillRect(q[0] - r * 0.22, q[1] - r * 1.15, r * 0.45, r * 0.5); } }   // пеньки сучьев
      if ((o.kl != null && o.kl < 0.999) || cut >= 1) { cx.fillStyle = '#e0b47a'; cx.beginPath(); cx.ellipse(a1[0], a1[1], r1 * 0.6, r1, ang, 0, TAU_); cx.fill(); cx.fillStyle = '#c79a62'; cx.beginPath(); cx.ellipse(a1[0], a1[1], r1 * 0.24, r1 * 0.4, ang, 0, TAU_); cx.fill(); }   // свежий рез
    }
    // крона: срезы спрайта вдоль оси (SLICE), каждый — своим смещением; снятое обрубкой (выше hc) не рисуем
    if (hc > 8) {
      const S0 = treeSprite({ kind: o.kind, s, wall: false }, o.v), sc = S0.width / tw, ns = st > 0.3 ? desnow(S0) : null, kn = ns && ns !== S0 ? smooth(0.25, 1.15, th) : 0;
      for (const [S, aa] of kn >= 1 ? [[ns, 1]] : kn > 0 ? [[S0, 1], [ns, kn]] : [[S0, 1]]) {
        cx.globalAlpha = al * aa;
        let hLo = 8, oLo = off(8);
        for (let i = 1; i < SLICE.length && hLo < hc; i++) {
          const hHi = Math.min(SLICE[i], hc), oHi = off(hHi), dh = hHi - hLo; if (dh < 0.5) { hLo = hHi; oLo = oHi; continue; }
          const gx = (oHi[0] - oLo[0]) / dh, gy = (oHi[1] - oLo[1]) / dh, rHi = Math.max(0, Math.round((160 - hHi) * sc)), rLo = Math.min(S.height, Math.round((160 - hLo) * sc) + (i > 1 ? 1 : 0));
          cx.setTransform(Vx, Vy, -(Ux + gx), -(Uy + gy), X + oLo[0] - hLo * gx, Y + oLo[1] - hLo * gy);
          cx.drawImage(S, 0, rHi, S.width, rLo - rHi, -tw / 2, rHi / sc - 160, tw, (rLo - rHi) / sc);
          hLo = hHi; oLo = oHi;
        }
      }
      cx.globalAlpha = al; cx.setTransform(1, 0, 0, 1, 0, 0);
    }
    // торец комля (свежий спил) — лёжа виден
    if (lie > 0.6) { const q = at(7), r = R(7); cx.globalAlpha = al * lie; cx.fillStyle = '#c79a62'; cx.beginPath(); cx.ellipse(q[0], q[1], r * 0.6, r, ang, 0, TAU_); cx.fill(); cx.fillStyle = '#8a6a45'; cx.beginPath(); cx.ellipse(q[0], q[1], r * 0.22, r * 0.38, ang, 0, TAU_); cx.fill(); cx.globalAlpha = al; }
    // снег сверху (только лёжа): лёгкий, нарастает со временем; потом холмик заметает ствол целиком
    if (P.ph >= 2) {
      const sn = clamp(o.snow || 0, 0, 1), bu = o.bury || 0, top = Math.max(hEnd, Math.min(hc, 158));
      cx.fillStyle = '#f4f8fb';
      for (let h = 14; h < top - 4; h += 9) {
        const cr = h < hc ? crownR(o.kind, h) * kd * 0.62 : 0, q = at(h), r = R(h), up = cr * (0.5 + 0.25 * P.roll) + r * 0.9, w = Math.max(cr * 0.7, r * 1.3) * (0.6 + 0.6 * sn);
        cx.globalAlpha = al * (0.3 + 0.6 * sn) * (h < hc ? 0.8 : 1);
        cx.beginPath(); cx.ellipse(q[0] + Ux * 2, q[1] - up, w * 0.55 + dpr, (1.1 + 2.2 * sn) * dpr * s, ang * 0.85, 0, TAU_); cx.fill();
      }
      if (bu > 0) {   // заметает: холмик растёт поверх, к концу сам сливается со снегом
        const b = smooth(0, 0.7, bu), fade = 1 - smooth(0.82, 1, bu);
        for (let h = 8; h < top; h += 10) {
          const cr = h < hc ? crownR(o.kind, h) * kd * 0.6 : 0, q = at(h), r = R(h), w = Math.max(cr, r * 2.2) * (0.7 + 0.5 * b);
          cx.globalAlpha = b * fade * 0.95; cx.fillStyle = (h / 10 | 0) % 2 ? '#eef3f8' : '#f6f9fc';
          cx.beginPath(); cx.ellipse(q[0], q[1] - r * 0.4, w, w * 0.42 + 2 * dpr, ang * 0.5, 0, TAU_); cx.fill();
        }
      }
    }
    cx.globalAlpha = 1; WT();
    // в падении — снег с кроны (хлопья с высоты); удар — облачка по всей длине (fallImpact)
    if (P.ph === 1 && state === 'play' && th > 0.25 && o.kind !== 3) {
      const kk = o.len / 150;
      FX.emit('fall' + o.x + ',' + o.y, LOWQ() ? 8 : 26, (parts, r) => { const h = 40 + r() * 110, z = h * ct * kk, gx = o.x + cd * st * h * kk, gy = o.y + 0.6 * sd * st * h * kk, w = crownR(o.kind, h) * kk;
        parts.push({ type: 'bit', kind: 'snow', c: r() < 0.6 ? '#f6f9fc' : '#dde6ee', x: gx + (r() - 0.5) * w, y: gy + (r() - 0.5) * 4, vx: 0, vy: 0, ux: (r() - 0.5) * 30, uy: (r() - 0.5) * 8, uz: r() * 10, gz: 200, z0: Math.max(4, z), sz: 1.2 + r() * 1.3, rot: 0, spin: 0, life: 2.2, max: 2.2 }); });
    }
  }
  // удар о землю (один раз на падение): облачка снега по всей длине ствола; тряска — у деревьев посёлка (у героя — Actions)
  const HITF = new WeakSet();
  function fallImpact(o, own) {
    if (HITF.has(o)) return; HITF.add(o);
    const n = LOWQ() ? 3 : 7, cd = Math.cos(o.a), sd = Math.sin(o.a);
    for (let i = 0; i < n; i++) { const k = (0.12 + 0.88 * i / (n - 1)) * o.len; ArtWorld.fx.snowPuff(G.parts, o.x + cd * k, o.y + 0.6 * sd * k, i > n / 2 ? 0.9 : 0.6); }
    if (!own && typeof Fx !== 'undefined' && Fx.shake) Fx.shake(3);
  }
  // ствол героя: всё состояние — в L (сейв), рендер один и тот же
  const LOGV = new WeakMap();
  function drawLog(L) {
    if (typeof Tree !== 'undefined' && Tree.MODEL[L.kind]) return drawLog3(L);
    let o = LOGV.get(L); if (!o) { o = { x: L.x, y: L.y, kind: L.kind, s: L.s, v: treeV({ kind: L.kind, wall: false, v: L.v || 0, x: L.x, y: L.y }) }; LOGV.set(L, o); }
    o.a = L.a; o.len = L.len; o.cut = Actions.logCut(L); o.kl = L.n0 && L.n < L.n0 ? Actions.logK(L) : null;
    o.snow = clamp((G.time - (L.t0 || 0)) / (CYCLE * 1.5), 0, 0.7); o.bury = Actions.logSnow(L); o.al = 1 - smooth(0.55, 0.9, o.bury) * 0.999;
    let P = LIE; if (L.f) { P = fallPose(L.f, L.f.t); if (L.f.hit) fallImpact(o, true); }
    drawFelled(o, P);
  }
  // ствол героя — объёмной моделью: поза валки та же (fallPose), снег на ветвях стряхнут падением и нарастает, заметание — поверх
  function drawLog3(L) {
    Tree.ensure(L); let o = LOGV.get(L); if (!o) { o = {}; LOGV.set(L, o); }
    for (const k of ['x', 'y', 'a', 'sk', 'k', 'hc', 'zt', 'cl', 'zTop', 'top', 'cut', 'sink', 'kind', 'len']) o[k] = L[k];
    const age = G.time - (L.t0 || 0); o.snowN = +clamp(0.12 + age / (CYCLE * 1.2), 0, 0.85).toFixed(1); o.dsnow = +clamp(age / (CYCLE * 0.8), 0, 0.8).toFixed(1);
    const bury = Actions.logSnow(L), al = 1 - smooth(0.55, 0.9, bury) * 0.999; if (al <= 0.01) return;
    let P = L.drag ? DRAGP : LIE; if (L.f) { P = fallPose(L.f, L.f.t); if (L.f.hit) fallImpact(o, true); if (P.ph < 2) o.snowN = 1 - smooth(0.2, 1.2, P.th); }   // волоком — живой рисунок, не запечённый
    cx.globalAlpha = al; Tree.drawLog(cx, o, P); cx.globalAlpha = 1;
    if (SF && L.f && P.ph === 1) fallSpeed(o, P);
    fallFx(o, P);
    if (bury > 0) buryMound(o, bury);
  }
  // C: переход «падает» — линии скорости тушью по дуге вершины позади движения (центр — пень)
  function fallSpeed(o, P) {
    const R = o.len || 120, a = o.a || 0, ca = Math.cos(a), sa = Math.sin(a), th = P.th, q = [o.x, o.y - 8];
    for (let i = 0; i <= 8; i++) { const t = Math.max(0, th - 0.42 + 0.42 * i / 8), st = Math.sin(t), ct = Math.cos(t); q.push(o.x + ca * st * R, o.y + 0.6 * sa * st * R - ct * R - 8); }
    Style.speedPath(cx, q, [0.98, 0.86, 0.74], clamp(th * 2, 0, 1) * 0.9);
  }
  // в падении — снег с кроны хлопьями
  function fallFx(o, P) {
    if (!(P.ph === 1 && state === 'play' && P.th > 0.25 && o.kind !== 3)) return;
    const st = Math.sin(P.th), ct = Math.cos(P.th), cd = Math.cos(o.a), sd = Math.sin(o.a), kk = o.len / 150;
    FX.emit('fall' + o.x + ',' + o.y, LOWQ() ? 8 : 26, (parts, r) => { const h = 40 + r() * 110, z = h * ct * kk, gx = o.x + cd * st * h * kk, gy = o.y + 0.6 * sd * st * h * kk, w = crownR(o.kind, h) * kk;
      parts.push({ type: 'bit', kind: 'snow', c: r() < 0.6 ? '#f6f9fc' : '#dde6ee', x: gx + (r() - 0.5) * w, y: gy + (r() - 0.5) * 4, vx: 0, vy: 0, ux: (r() - 0.5) * 30, uy: (r() - 0.5) * 8, uz: r() * 10, gz: 200, z0: Math.max(4, z), sz: 1.2 + r() * 1.3, rot: 0, spin: 0, life: 2.2, max: 2.2 }); });
  }
  // заметает: холмик растёт поверх ствола, к концу сам сливается со снегом
  function buryMound(o, bu) {
    const b = smooth(0, 0.7, bu), fade = 1 - smooth(0.82, 1, bu), cd = Math.cos(o.a), sd = Math.sin(o.a), n = Math.max(2, Math.round(o.len / 10));
    for (let i = 0; i <= n; i++) { const d = o.len * i / n, w = (14 * (1 - i / n) + 5) * (0.7 + 0.5 * b); cx.globalAlpha = b * fade * 0.95; cx.fillStyle = i % 2 ? '#eef3f8' : '#f6f9fc'; cx.beginPath(); cx.ellipse(o.x + cd * d, o.y + 0.6 * sd * d - 2, w, w * 0.42 + 2, o.a * 0.5, 0, Math.PI * 2); cx.fill(); }
    cx.globalAlpha = 1;
  }
  // деревья людей посёлка: падают от рубщика, лежат FALL_LIE с и уходят (ствол унесли), лапник остаётся на снегу (G.lap)
  const FALL = [], FALL_LIE = 22;
  if (typeof Interact !== 'undefined') Interact.on('fell', ev => {
    const t = ev.target; if (!t || t.stage === 1 || ev.log) return;
    const w = ev.who, d = (ev.dir != null ? ev.dir : w ? Math.atan2(t.y - w.y, t.x - w.x) : 0) + (Math.random() - 0.5) * 0.5;
    if (FALL.length >= 6) FALL.shift();
    const len = 150 * t.s / ArtWorld.treeK(t.s) * tjit(t);
    const f = { x: t.x, y: t.y, kind: t.kind, s: t.s, v: treeV(t), a: d, len, t0: now, w: 0.3, T: 0.9 + Math.random() * 0.4, r: 0.05 };
    if (typeof Tree !== 'undefined' && Tree.MODEL[t.kind]) { const q = Tree.of(t); f.sk = q.S.key; f.k = q.k; f.len = Math.round((q.S.H * q.k - Tree.HC) * Tree.M); }
    FALL.push(f);
    if (!f.sk) { G.lap = G.lap || [];
      for (const k of [0.45, 0.7]) for (const sg of [1, -1]) { const c = Math.cos(d), sn = Math.sin(d) * 0.6; if (G.lap.length < 48) G.lap.push({ x: Math.round(t.x + c * len * k - sn * sg * 9), y: Math.round(t.y + sn * len * k + c * sg * 6), a: +(d + sg * 0.5).toFixed(2), s: t.s, t: G.time }); } }
  });
  function drawFall(f) {
    const el = now - f.t0, P = fallPose(f, el); if (P.ph >= 2) fallImpact(f, false);
    f.al = clamp((f.w + f.T + FALL_LIE - el) / 3, 0, 1); f.snow = 0; f.cut = 0; f.kl = null; f.bury = 0;
    if (f.sk) { if (f.al <= 0.01) return; f.snowN = P.ph < 2 ? 1 - smooth(0.2, 1.2, P.th) : 0.12; cx.globalAlpha = f.al; Tree.drawLog(cx, f, P.ph >= 2 && el > f.w + f.T + 1.5 ? LIE : P); cx.globalAlpha = 1; fallFx(f, P); return; }
    drawFelled(f, P);
  }
  function tickFalls() {
    nsBudget = 1;
    for (let i = FALL.length - 1; i >= 0; i--) { const f = FALL[i]; if (now - f.t0 > f.w + f.T + FALL_LIE) FALL.splice(i, 1); }
    if (FALL.length && now < FALL[FALL.length - 1].t0) FALL.length = 0;
  }
  // точка сортировки лежачего: нижний (ближний к камере) конец
  const fallY = o => Math.max(o.y, o.y + Math.sin(o.a) * o.len * 0.6) - 2;
  // спрайты рендера — в общем кэше ArtWorld: та же ступень зума, бюджет печи за кадр, чистка старых ступеней
  const spr = (k, w, h, ox, oy, paint, sc) => ArtWorld.sprite('gfx:' + k, w, h, g => { g.translate(ox, oy); paint(g); }, sc);
  const MI8 = () => spr('mi8s', 320, 210, 160, 140, g => ArtWorld.paintMi8(g, 'static')); // корпус без живых частей (js/live.js)
  const MI8F = () => spr('mi8', 320, 210, 160, 140, ArtWorld.paintMi8, rdpr * Math.min(zb, 2.5)); // весь, в покое — только для тени: крупнее ×2.5 не нужен
  const TAIL = () => spr('tail', 220, 140, 110, 100, ArtWorld.paintTail);
  const CHUM = () => spr('chum', 130, 140, 65, 120, ArtWorld.paintChum);
  const LABAZ = () => spr('labaz', 80, 90, 40, 80, ArtWorld.paintLabaz);

  // Ми-8 длиной 320 px — три сегмента со своей опорной линией (нос южнее, балка севернее: корпус повёрнут)
  const WRECK_SEG = [[0, 110, 6], [110, 210, 0], [210, 320, -8]];
  // сегмент: неподвижный корпус + живые части поверх (лопасть, дверь, провода — Live, от Wind)
  function drawWreck(seg) { const [a, b] = WRECK_SEG[seg]; Live.drawWreck(cx, a, b, MI8(), ENV); }
  function drawTailObj() { const t = POI.tail; cx.drawImage(TAIL(), t.x - 110, t.y - 100, 220, 140); }
  function drawChum() {
    const c = POI.chum; cx.drawImage(CHUM(), c.x - 65, c.y - 120, 130, 140);
    light(c.x, c.y - 10, 90, 'w', 0.6);
    // дым — эмиттер FX: частицы рождаются в update по темпу (3/с), в паузе не копятся
    if (state === 'play') FX.emit('chum', 3, (parts, r) => parts.push({ type: 'smoke', x: c.x, y: c.y - 110, vx: (r() - 0.5) * 10, vy: -20 - r() * 10, life: 3, max: 3 }));
  }
  function drawDeer(d) {
    sunk(cx, d, 'deer', () => ArtAnimals.deer(cx, d, ENV)); // олень пробивает наст — глубоко
    if (ArtAnimals.bellHit && ArtAnimals.bellHit(d) && dist2(d, G.p) < 320 * 320 && state === 'play') Sound.src(d).tone('sine', 2400 + (d.ph || 0) * 60, 2350, 0.25, 0.03);
  }

  // ---------- изба: модели из art-world.js, здесь — только состояние ----------
  const ROOM = () => ({ x0: HUT_IN.x0, y0: HUT_IN.y0 - 44, x1: HUT_IN.x1, y1: HUT_IN.y1 + WALL });
  // щели: уровень 0..5 (конопатят шов за швом — G.hut.prog.walls), дверь собирают по доскам (doorP)
  const hutP = k => (G.hut.prog && G.hut.prog[k]) || 0;
  const hutH = () => ({ x: HUT.x, y: HUT.y, in: HUT_IN, wall: WALL, doorW: DOOR_W, walls: G.hut.walls, wallsLvl: Math.floor(hutP('walls') * 5 + 1e-6), door: G.hut.door, doorP: hutP('door'), bench: G.hut.bench, damper: G.hut.damper,
    radio: G.flags.radioBuilt, fuel: G.hut.fuel, open: dist2(G.p, { x: HUT.x, y: HUT_IN.y1 + WALL - 6 }) < 40 * 40, cut: 1 - roofA });
  function drawHutFloor() { ArtWorld.hutFloor(cx, hutH()); }
  function drawNorthWall() { ArtWorld.hutNorth(cx, hutH()); }
  function drawStove() {
    const s = SPOT.stove;
    // свет печи обрезан по комнате (L6): сквозь стены на снег не выходит
    ArtWorld.hutStove(cx, s.x, s.y, { fuel: G.hut.fuel, fl: G.hut.fl, door: Actions.stoveDoor, damper: G.hut.damper, damperP: G.hut.prog && G.hut.prog.damper, pipeTop: HUT.y - 150, lightK: 1 - roofA, room: ROOM() }, ENV);
    if (G.charge > 0 && !G.flags.radioBuilt && (G.chest.battery || (G.p.inside && G.inv.battery))) {
      // заряд аккумулятора: корпус №5, клемма №21, шкала №24
      const bx = s.x + 22, by = s.y - 16;
      rr(bx, by, 16, 10, 2, '#27394a'); rr(bx + 16, by + 3, 2, 4, 1, '#6c7178');
      rr(bx + 2, by + 2, 12 * G.charge / 100, 6, 1, '#9fe36b');
    }
  }
  function drawBench() { const b = SPOT.bench; ArtWorld.hutBench(cx, b.x, b.y, { bench: G.hut.bench, prog: hutP('bench'), radio: G.flags.radioBuilt }, ENV); }
  function drawChest() { const c = SPOT.chest; ArtWorld.hutChest(cx, c.x, c.y, UI.kind === 'chest' || now - (OPEN.get(SPOT.chest) || -9) < 1.2); } // крышка открыта, пока роется
  function drawBed() { const b = SPOT.bed; ArtWorld.hutBed(cx, b.x, b.y); }
  function drawSouthWall() { ArtWorld.hutFront(cx, hutH(), ENV); if (typeof Trail !== 'undefined') Trail.drawShovel(cx, roofA * 0.82 + 0.18); } // лопата у двери (пока не взяли)
  function drawRoof() {
    roofA += ((G.p.inside ? 0 : 1) - roofA) * ease(9, rdt); // 0.15 за кадр при 60 к/с
    if (roofA < 0.03) return;
    ArtWorld.hutRoof(cx, hutH(), ENV, roofA);
    if (G.flags.radioBuilt && now % 1.4 < 0.7) { const m = ArtWorld.hutTop(hutH()).mast; EYES.push({ x: m.x, y: m.y, lamp: roofA }); }
  }

  // ---------- движение фигур: фаза шага от пройденного пути (C6 A1–A3, A7, A8, A14) ----------
  // Память по объекту: сдвиг за кадр → сглаженная скорость, направление, лицо с мёртвой зоной.
  const MOT = new WeakMap();
  function motion(o, face0) {
    let m = MOT.get(o);
    if (!m) { m = { x: o.x, y: o.y, ph: 0, spd: 0, vx: 0, vy: 0, d: 0, face: face0 < 0 ? -1 : 1, f: -1, vv: 0, vf: -1 }; MOT.set(o, m); }
    if (m.f === frame) return m; // второй проход (силуэт) — те же значения
    m.f = frame;
    let dx = o.x - m.x, dy = o.y - m.y; m.x = o.x; m.y = o.y;
    if (dx * dx + dy * dy > 80 * 80) dx = dy = 0; // телепорт — не шаг
    m.d = Math.hypot(dx, dy);
    if (rdt > 0) { const k = ease(10, rdt); m.vx += (dx / rdt - m.vx) * k; m.vy += (dy / rdt - m.vy) * k; m.spd = Math.hypot(m.vx, m.vy); }
    if (Math.abs(m.vx) > 14) m.face = Math.sign(m.vx); else if (m.spd < 6 && face0) m.face = face0 < 0 ? -1 : 1;
    return m;
  }
  const dirY = m => (m.spd > 6 ? clamp(m.vy / m.spd, -1, 1) : 0);
  // видимый ракурс фигуры: плавно к цели (разворот к собеседнику, остановка — не за один кадр); раз за кадр
  function view(m, tgt) { if (m.vf !== frame) { m.vf = frame; m.vv += (tgt - m.vv) * ease(VIEW_K, rdt); } return m.vv; }
  // фаза шага от пути по земле: походка (полушаг St, доля опоры duty) — от скорости v (px/с), ArtPeople.gaitFor;
  // стопа в опоре проходит 2·St px по земле за 2π·duty фазы — ровно путь тела (та же ось хода, что у ног в ArtPeople.draw, без сжатия по ракурсу).
  // m.gait — эта же походка уходит в draw (o.gait): там опорная стопа ещё и закреплена в мире
  const WALKS = { walk: 1, run: 1, limp: 1, carry: 1 };
  function stepPhase(m, anim, v, vy) {
    if (m.pf === frame) return m.ph; m.pf = frame;
    m.gait = null;
    if (WALKS[anim] || (ArtPeople.POSE[anim] && ArtPeople.POSE[anim].loco)) {
      const gt = ArtPeople.gaitFor(anim === 'run' || anim === 'limp' || anim === 'trudge' ? anim : anim === 'wade' ? 'trudge' : 'walk', v, vy); // варианты ходьбы — шагом walk (в глубоком снегу — короче)
      m.ph += Math.min(ArtPeople.advance(m.d, gt), 2 * Math.PI * 6 * rdt);            // ≤ 6 Гц — только от рывков
      if (v > 4) m.gait = gt;
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
  // память шага героя: фаза — от пути ногами (Hero.odo), а не от сдвига на экране (рывки/телепорты шагом не считаются)
  const HMOT = { ph: 0, d: 0, odo: 0, f: -1, pf: -1, vv: 0, vf: -1 };
  // позы «в профиль» — ракурс по dy к цели не меняют (лёжа, сидя, у лунки, копая лунку перед собой)
  const SAGITTAL = { sleep: 1, dead: 1, sit: 1, rest: 1, fish: 1, fishBite: 1, dig: 1 };
  // точка объекта o (+h — высота касания) в координатах рига фигуры f, повёрнутой лицом face с ракурсом vy (вид 3/4: экранный x = 0.87·x, сдвиг вниз 0.12·x):
  // x — вперёд по взгляду, y — от ступней вверх отрицательный. Боком — как раньше (dx, dy); к спине/лицу вперёд ведёт глубина: x — полное расстояние,
  // а экранный dy уходит в глубину, в высоту попадает только его «боковая» доля (1 − |vy|)
  function loc(f, o, h = 0, vy = 0, face = f.face) {
    if (!o) return null;
    const dx = (o.x - f.x) / 0.87, dy = o.y - f.y, v = Math.abs(vy), x = v > 0 ? Math.hypot(dx, dy) : dx * (face < 0 ? -1 : 1);
    return { x, y: (dy - 0.12 * x) * (1 - v) - (o.z || 0) + h };
  }
  const PICK = (k, fb) => (ArtPeople.POSE[k] ? k : fb);
  // поза по погоде (Ctx: пурга, снаружи): k = +1 лицом к ветру … −1 ветер в спину (лицо — сторона face и ракурс vy).
  // Стоя без дела — «упирается в ветер» (наклон ∝ k, рука у лица); идёт по ветру — прямо (windBack), против/вбок — прикрываясь (shield).
  // Меняет только «пустые» позы (стоит/идёт); работа, разговор, реакции — как решил автомат тела.
  const WP0 = { anim: '', w: 0, g: 0 };
  function windPose(o, face, vy, anim, moving) {
    WP0.anim = anim; WP0.w = 0; WP0.g = 0;
    if (!CTX || !CTX.storm || insideHut(o.x, o.y)) return WP0;
    const w = Wind.at(o.x, o.y), q = clamp(vy || 0, -1, 1), fx = (face < 0 ? -1 : 1) * Math.sqrt(1 - q * q), k = -(fx * w.dx + q * w.dy);
    WP0.w = k; WP0.g = w.gust;
    const P = ArtPeople.POSE;
    if (moving) { if ((anim === 'shield' || anim === 'walk' || anim === 'cold') && k < -0.3 && P.windBack) WP0.anim = 'windBack'; else if (anim === 'walk' && P.shield) WP0.anim = 'shield'; }
    else if ((anim === 'idle' || anim === 'shiver' || anim === 'lookAround' || anim === 'stretch') && P.braceWind) WP0.anim = 'braceWind';
    return WP0;
  }
  // свет огня «с его стороны»: у фигуры рядом с горящим огнём — тёплый отсвет на боку к огню (лицо, рукав, полы) в карте света
  function rimLight(o) {
    if (ghost || !o) return;
    const f = nearBurn(o, 230); if (!f) return;
    const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy) || 1, k = 1 - d / 230;
    light(o.x + dx / d * 7, o.y - 24 + dy / d * 3, 36 + 10 * k, 'f', 0.5 * k * k);
  }
  // ---------- тело в снегу / воде (js/depth.js, js/ice.js): ниже линии снега фигуры не видно; по линии — бровка-валик ----------
  // Фигура опускается на провал (translate), обрезка — выше передней дуги ямы; 'hole' — ползёт с полыньи: над дырой тела не видно.
  function sunkL(g, L, fn) {
    if (!ghost) Depth.art.back(g, L);
    g.save(); g.beginPath();
    if (L.mode === 'hole') { g.rect(L.cx - 160, L.cy - 180, 320, 300); g.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, Math.PI * 2); g.clip('evenodd'); }
    else { g.rect(L.cx - 140, L.cy - 220, 280, 220 + L.ry * 0.45); g.clip(); g.translate(0, L.px); } // прямоугольник дешевле кривой; дугу ямы закрывает передний валик
    try { fn(); } finally { g.restore(); }
    if (!ghost) Depth.art.front(g, L);
  }
  // снег на одежде героя после провала (Depth.heroSnow 0..1): налёт по ногам и полам — по нарисованному ригу (ArtPeople.H.P.lg*)
  function snowCoat(g) {
    const k = Depth.heroSnow; if (!(k > 0.03) || !window.ArtPeople) return;
    const P = ArtPeople.H.P; g.save(); g.lineCap = 'round'; g.strokeStyle = '#eef3f8';
    for (const [L, a] of [[P.lg1, 0.3], [P.lg0, 0.42]]) { // налёт пятнами (штрих), гуще к голенищу
      g.setLineDash([1.6, 1.1]); g.globalAlpha = a * k; g.lineWidth = 3; g.beginPath(); g.moveTo(L[0], L[1] + 2); g.lineTo(L[2], L[3]); g.lineTo(L[4], L[5]); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 0.6 * a * k; g.lineWidth = 1.3; g.beginPath(); g.moveTo(L[2] - 1.2, L[3] + 0.4); g.lineTo(L[2] + 1, L[3]); g.moveTo(L[4] - 1.4, L[5] - 1); g.lineTo(L[4] + 1, L[5] - 1.2); g.stroke(); // комья у колена и голенища
    }
    const hx = (P.lg0[0] + P.lg1[0] + P.lg0[2] + P.lg1[2]) / 4, hy = (P.lg0[1] + P.lg1[1]) * 0.33 + (P.lg0[3] + P.lg1[3]) * 0.17;
    g.globalAlpha = 0.3 * k; g.fillStyle = '#eef3f8'; g.beginPath(); g.ellipse(hx, hy, 4.6, 1.1, 0, 0, Math.PI * 2); g.fill(); // кромка пол
    g.restore();
  }
  function sunk(g, o, kind, fn) {
    if (typeof Depth === 'undefined' || !o || insideHut(o.x, o.y)) return fn();
    const L = Depth.look(o, kind), f = o === G.p && !ghost ? () => { fn(); snowCoat(g); } : fn;
    if (!L || L.mode === 'none' || (L.mode !== 'hole' && L.px < 2.5)) return f(); // тонкий снег (≲ 11 см) — без воронки
    sunkL(g, L, f);
  }
  // походка людей по провалу: глубже колена — trudge, глубже пояса — «плывёт» (wade)
  function deepWalk(o, anim, moving, kind = 'n') {
    if (!moving || typeof Depth === 'undefined' || (anim !== 'walk' && anim !== 'limp')) return anim;
    const s = Depth.sinkOf(o, kind);
    return s > 85 && ArtPeople.POSE.wade ? 'wade' : s > (anim === 'limp' ? 60 : 25) && ArtPeople.POSE.trudge ? 'trudge' : anim;
  }
  const sinkK = (o, kind) => (typeof Depth === 'undefined' ? 0 : Math.min(0.85, Depth.sinkOf(o, kind) * Depth.PX / (Depth.KIND[kind] || Depth.KIND.p).h)); // доля роста в снегу (тень короче)
  // герой: позу, время позы, орудие и цель решает автомат тела (Hero.pose, js/hero.js); здесь — только ракурс к цели и рисование
  function drawPlayer(g = cx) {
    const p = G.p, b = Hero.pose();
    // без сознания (мягкая смерть): замерзает и заваливается — поза поверх автомата тела (пока не унесли в избу)
    if (p.ko && !p.ko.ph) { b.anim = ArtPeople.POSE.freezeFall ? 'freezeFall' : 'dead'; b.animT = clamp(p.ko.t / 2.4, 0, 1); b.tg = null; b.loco = false; b.tool = G.gear.saw ? 'saw' : 'axe'; }
    let anim = b.anim;
    if (HMOT.f !== frame) { HMOT.f = frame; const o = Hero.odo(); HMOT.d = Math.max(0, Math.min(40, o - HMOT.odo)); HMOT.odo = o; }
    // лицом к цели: сторона — по dx, ракурс (спина/лицо) — по dy; лёжа/сидя/у лунки — только сторона
    // сторона — видимая (Hero.vface: на льду не разворачивается, пока едет назад); ракурс — сглаженный (view)
    let face = Hero.vface(), avy = null, target = b.target;
    if (b.tg && !b.loco) {
      const dx = b.tg.x - p.x, dy = b.tg.y - p.y, d = Math.hypot(dx / 0.87, dy);
      if (Math.abs(dx) > 3) face = Math.sign(dx);
      if (!SAGITTAL[anim] && d > 1) avy = clamp(dy / d, -1, 1);
    }
    const vy = view(HMOT, b.loco ? b.vy : avy || 0);
    const WP = windPose(p, face, vy, anim, !!b.loco); anim = WP.anim; // пурга: стоя — упирается в ветер, по ветру — прямо (Ctx + Wind)
    if (b.tg && !b.loco && b.ik) target = loc(p, b.tg, b.th, avy === null ? 0 : vy, face);
    if (p.ride && !ghost) { const v = G.veh[p.ride]; if (p.ride === 'buran') ArtZones.buran(g, v, ENV, true); else ArtZones.deerSled(g, v, ENV); }
    const x = p.sleeping ? p.x - 4 : p.x, sp = clamp(b.speed / 200, 0, 1), rime = typeof Ice !== 'undefined' ? Ice.rime() : 0;
    const fig = () => ArtPeople.draw(g, { key: p, x: p.ride ? x - p.face * 8 : x, y: p.ride ? p.y - (p.ride === 'buran' ? 14 : 8) : p.y, face, vy, speed: sp, t: now, phase: stepPhase(HMOT, anim, b.loco ? b.speed : 0, vy), gait: b.loco && !p.ride ? HMOT.gait : null, onStep: ghost ? null : Hero.footStep,
      anim, animT: b.animT, item: p.action && p.action.item, load: ghost || (b.st === 'act' && !(ArtPeople.POSE[anim] && ArtPeople.POSE[anim].own)) ? null : Carry.art(), wind: WP.w, gust: WP.g, look: heroLook(), tool: b.tool, target, frost: Math.max(clamp((30 - G.s.warm) / 30, 0, 1), rime), tire: b.tire || 0, wet: p.wetT > 0, blink: p.iT > 0, seed: 1, deep: typeof Depth !== 'undefined' ? Depth.heroSink : 0 }, ENV);
    const fig2 = p.action && p.action.k === 'clear' && !ghost && typeof Trail !== 'undefined' ? () => { fig(); Trail.drawTool(g, p.action, face, p.x, p.y, !!b.loco); } : fig; // лопата в руках
    if (p.ride || p.sleeping) fig(); else sunk(g, p, 'p', fig2); // в снегу по колено/пояс/грудь — ниже снега не видно (js/depth.js)
    if (p.torch > 0 && b.tool === 'torch') light(p.x + face * 14, p.y - 38, 240, 'w', 0.9);
    // (светлый круг вокруг героя без источника убран: ночью свет — только от огня, факела, окна; луна — слабым общим светом в ambient)
    rimLight(p);
  }
  // стоящий персонаж: в разговоре/торге — лицом к герою, говорит или слушает (черёд — UI.talk); иначе изредка возится (свой таймер по seed)
  const FIDGETS = ['lookAround', 'rubHands', 'stamp', 'stretch', 'adjustPack', 'blowHands', 'wipeNose'];
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function fidget(seed, list = FIDGETS) {
    const per = 5 + (seed % 4), s = now + seed * 1.7, n = Math.floor(s / per), r = hash(n * 31 + seed);
    if (r > 0.75) return null;
    const k = list[Math.floor(hash(n * 17 + seed * 3) * list.length)], d = ArtPeople.DUR[k] || 1, t = s - n * per;
    return ArtPeople.POSE[k] && t < d ? { anim: k, animT: t / d } : null;
  }
  function standPose(id, u, seed, list) {
    const d = UI.talk, p = G.p;
    if (d ? d.who === id : UI.kind === 'trade' && UI.panel.trade === id) {
      const dx = p.x - u.x, dy = p.y - u.y, dd = Math.hypot(dx / 0.87, dy) || 1;
      const talk = d ? !d.hero : now % 6 >= 3.5; // торг: пока герой роется в товаре — молчит, потом говорит
      return { anim: talk ? 'talk' : PICK('listen', 'idle'), face: Math.abs(dx) > 3 ? Math.sign(dx) : u.face, vy: clamp(dy / dd, -1, 1), talking: 1 };
    }
    return fidget(seed, list);
  }
  const sd = id => { let h = 0; for (let i = 0; i < id.length; i++) h = h * 31 + id.charCodeAt(i) | 0; return Math.abs(h) % 97 + 11; };
  function drawUrk(g = cx) {
    const u = G.urk, m = motion(u, u.face), moving = m.spd > 8, sp = moving ? null : standPose('urk', u, 3);
    const talking = !!(sp && sp.talking), vy = view(m, moving ? dirY(m) : sp && sp.vy || 0), fc = sp && sp.face || m.face;
    const WP = windPose(u, fc, vy, moving ? 'walk' : sp ? sp.anim : 'idle', moving), anim = deepWalk(u, WP.anim, moving);
    sunk(g, u, 'n', () => ArtPeople.draw(g, { key: u, x: u.x, y: u.y, face: fc, vy, t: now, phase: stepPhase(m, anim, m.spd, vy), gait: m.gait, speed: 0.35, anim, animT: sp && sp.animT || 0, wind: WP.w, gust: WP.g, look: LK.urk, tool: 'none', seed: 3 }, ENV));
    if (!ghost) rimLight(u);
    if (ghost) return;
    if (dist2(u, G.p) < 160 * 160 && !talking && !UI.modal()) mark('talk', u.x, u.y - 60 + Math.sin(now * 3) * 2);
    // пар изо рта — эмиттер FX (спавн в update, не из рендера)
    if (!G.p.inside && state === 'play') FX.emit('urk-breath', 1.2, (parts, r) => { const f = G.urk.face || 1; for (let i = 0; i < 2; i++) parts.push({ type: 'breath', x: G.urk.x + f * 6 + i * f * 2, y: G.urk.y - 34, vx: f * (10 + r() * 12), vy: -3 - r() * 5, life: 1.1, max: 1.1 }); });
  }
  function drawVera(g = cx) {
    const v = G.vera; if (v.state === 'dead') return;
    const m = motion(v, v.face), moving = m.spd > 8, follow = v.state === 'follow';
    // хромает, только если идёт сама (A2), а не когда движется герой; сидит — только поворачивается к собеседнику; стоит — изредка зябнет
    const sp = moving ? null : standPose('vera', v, 5, ['rubHands', 'blowHands', 'lookAround', 'wipeNose']), stand = follow && sp;
    const vy = view(m, moving ? dirY(m) : stand && sp.vy || 0), fc = sp && sp.face || m.face;
    const WP = windPose(v, fc, vy, follow ? (moving ? 'limp' : stand ? sp.anim : 'idle') : 'sit', moving), anim = deepWalk(v, WP.anim, moving);
    sunk(g, v, 'n', () => ArtPeople.draw(g, { key: v, x: v.x, y: v.y, face: fc, vy, t: now, phase: stepPhase(m, anim, m.spd, vy), gait: m.gait, speed: 0.3, anim, animT: stand && sp.animT || 0, wind: WP.w, gust: WP.g, look: LK.vera, tool: 'none', seed: 5 }, ENV));
    if (!ghost) rimLight(v);
    if (!ghost && (v.state === 'tail' || (v.state === 'hut' && v.food <= 0))) mark(v.food <= 0 && v.state === 'hut' ? 'food' : 'alarm', v.x, v.y - 56 + Math.sin(now * 3) * 2);
  }
  // люди зон (NPCS без своей отрисовки): облик rec.look, шаг/разговор/стоит, метка «поговорить» рядом
  function drawNpc(n, g = cx) {
    const u = n.st, m = motion(u, u.face), moving = m.spd > 8, sp = moving ? null : standPose(n.id, u, sd(n.id));
    const talking = !!(sp && sp.talking), vy = view(m, moving ? dirY(m) : sp && sp.vy || 0), fc = sp && sp.face || m.face;
    const WP = windPose(u, fc, vy, moving ? 'walk' : sp ? sp.anim : 'idle', moving), anim = deepWalk(u, WP.anim, moving);
    sunk(g, u, 'n', () => ArtPeople.draw(g, { key: u, x: u.x, y: u.y, face: fc, vy, t: now, phase: stepPhase(m, anim, m.spd, vy), gait: m.gait, speed: 0.35, anim, animT: sp && sp.animT || 0, wind: WP.w, gust: WP.g, look: n.rec.look, tool: 'none', seed: 7 }, ENV));
    if (!ghost) rimLight(u);
    if (ghost) return;
    if (dist2(u, G.p) < 160 * 160 && !talking && !UI.modal()) mark('talk', u.x, u.y - 60 + Math.sin(now * 3) * 2);
  }
  function drawHare(h) { sunk(cx, h, 'hare', () => ArtAnimals.hare(cx, h, ENV)); if (h.hid) { cx.globalAlpha = 0.92; ell(h.x - 1, h.y - 1.5, 10 * (h.sz ? h.sz / 0.57 : 1), 3.6, '#e9eff5'); ell(h.x - 2, h.y - 2.6, 7, 1.6, '#f6f9fc'); cx.globalAlpha = 1; } } // в пургу — зарылся в снег под елью (Fauna)
  function drawWolf(w) { sunk(cx, w, 'wolf', () => ArtAnimals.wolf(cx, w, ENV)); }
  function drawBear(b) { sunk(cx, b, 'bear', () => ArtAnimals.bear(cx, b, ENV)); }
  // зверь уходит под лёд (Ice.animal): провал в воду по дыре, брызги — рисует Ice/Depth
  function drawSinker(s) { sunkL(cx, { px: Ice.sinkPx(s), rx: 20, ry: 6, mode: 'water', cx: s.x, cy: s.y }, () => ArtAnimals.bear(cx, s.o, ENV)); }
  // брошенная палка на снегу/льду (Actions: G.litter, k 'stick'): тень, кора, светлый торец; в снегу — присыпана с концов
  function drawStick(q) {
    if (q.fl) {   // летит: тень на земле, палка в воздухе крутится
      const h = Actions.stickH(q), a = q.a + q.fl.t * 14, c = Math.cos(a) * 11, sn = Math.sin(a) * 5;
      cx.globalAlpha = 0.2; ell(q.x, q.y + 1, 8, 2, '#27394a'); cx.globalAlpha = 1;
      cx.lineCap = 'round'; cx.strokeStyle = '#5a3d22'; cx.lineWidth = 2.2; cx.beginPath(); cx.moveTo(q.x - c, q.y - h - sn); cx.lineTo(q.x + c, q.y - h + sn); cx.stroke(); return;
    }
    const c = Math.cos(q.a) * 11, sn = Math.sin(q.a) * 4, onI = typeof Depth !== 'undefined' && Depth.bareIce(q.x, q.y);
    cx.lineCap = 'round'; cx.globalAlpha = 0.25; cx.strokeStyle = '#5d7a96'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(q.x - c, q.y - sn + 1.5); cx.lineTo(q.x + c, q.y + sn + 1.5); cx.stroke();
    cx.globalAlpha = 1; cx.strokeStyle = '#5a3d22'; cx.lineWidth = 2.2; cx.beginPath(); cx.moveTo(q.x - c, q.y - sn); cx.lineTo(q.x + c, q.y + sn); cx.stroke();
    cx.strokeStyle = '#8a6a48'; cx.lineWidth = 0.8; cx.beginPath(); cx.moveTo(q.x - c * 0.8, q.y - sn * 0.8 - 0.7); cx.lineTo(q.x + c * 0.6, q.y + sn * 0.6 - 0.7); cx.stroke();
    if (!onI) { cx.globalAlpha = 0.9; ell(q.x - c * 0.85, q.y - sn * 0.85, 3, 1.4, '#f4f7fa'); ell(q.x + c * 0.9, q.y + sn * 0.9, 2.6, 1.2, '#f4f7fa'); cx.globalAlpha = 1; }
  }
  function drawFire(f) {
    // подтаявший снег вокруг: f.melt считает Fire.tick (логика мира), здесь — только рисунок
    ArtWorld.fire(cx, f, ENV); if (!(f.fuel > 0)) return;
    const fl = Math.max(0, 1 - (now - (FLARE.get(f) || -9)) / 0.8); // руки у огня — угли ярче (свет самого костра — в ArtWorld.fire, один)
    if (fl > 0) light(f.x, f.y - 10, 120 * (1 + 0.3 * fl), 'f', 0.35 * fl);
    if (fl > 0) ENV.spark(f.x + Math.sin(now * 9) * 4, f.y - 8, 0.5 * fl);
  }
  function drawStack(s) { ArtWorld.stack(cx, s, ENV); const fl = s.fl == null ? (s.lit > 0 ? 1 : 0) : s.fl; if (fl > 0.02) light(s.x, s.y - 20, 380 * (0.3 + 0.7 * fl), 'w', fl); } // счётчик «x/4» — точками в самой модели
  function drawNote(id) {
    const n = NOTES[id];
    if (id === 'labaz' && G.labaz) return;
    if (Actions.noteInHand(id)) return; // лист в руках у героя
    const snow = typeof Snow !== 'undefined' ? Snow.cap('rock') : 0; // присыпана, как глыбы: снегопад копит, ветер сдувает
    ArtWorld.note(cx, n.x, n.y, !!G.notes[id], Live.note(id, ENV), n.hold, snow); // трепет и прыжки от Wind
    // подсказка — не постоянная блёстка: край листа поблёскивает, только когда герой рядом (≤ 110 px) или ищет (нюх: G.sniff)
    if (!G.notes[id]) {
      const d = Math.hypot(G.p.x - n.x, G.p.y - n.y), k = Math.max(1 - d / 110, G.sniff && d < 420 ? 0.6 : 0);
      if (k > 0.02) EYES.push({ x: n.x - 4, y: n.y - 6, spark: k * (0.35 + 0.35 * Math.max(0, Math.sin(now * 2.2 + n.x))) });
    }
  }
  function drawTrap(t) { ArtWorld.trap(cx, t); if (t.catch) mark('paw', t.x, t.y - 20, 13); }
  function drawStash(s) {
    if (s.dg != null && s.dg < 1) return ArtWorld.stashPit(cx, s.x, s.y, s.dg);   // яму ещё копают
    const k = (now - (OPEN.get(s) || -9)) / 0.45, full = Object.values(s.inv || {}).some(n => n > 0);
    if (k < 0 || k >= 1) return ArtWorld.stashPile(cx, s.x, s.y, full);
    const u = Math.sin(k * Math.PI); // открыли: ветки/крышка приподнялись и легли
    cx.save(); cx.translate(s.x, s.y); cx.rotate(-0.08 * u); cx.translate(-s.x, -s.y - 3 * u); ArtWorld.stashPile(cx, s.x, s.y, full); cx.restore();
  }
  // значок над объектом в мире: круглая жестяная плашка + иконка из спрайта
  function mark(id, x, y, px = 16, col = '#ffd27a') {
    if (ghost) return;
    cx.fillStyle = 'rgba(17,26,21,.84)'; cx.strokeStyle = '#4d6456'; cx.lineWidth = 1.2;
    cx.beginPath(); cx.arc(x, y, px * 0.72, 0, Math.PI * 2); cx.fill(); cx.stroke();
    Icons.draw(cx, id, x, y, px * 0.86, col);
  }
  // метка-кольцо: одна на всё (выделение, приказ) — №22, α .8, 2 px, как у людей
  function ring(x, y, rx, ry, a = 0.8) { cx.globalAlpha = a; cx.strokeStyle = '#ffd27a'; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); cx.stroke(); cx.globalAlpha = 1; }
  // C: след — овал тоном тени с тонкой кромкой тушью (как точки тропы в эталоне), гаснет с жизнью следа
  function printsC(list, near) {
    const lw0 = Style.lw(0.9);
    cx.fillStyle = Style.P.shade; cx.strokeStyle = Style.P.ink; cx.lineWidth = lw0;
    for (const f of list) {
      if (!near(f.x, f.y, 40)) continue; const lk = Math.min(1, f.life / 8); if (lk < 0.3) continue;
      const big = f.k === 'p' || f.k === 'b', rx = (big ? 3.4 : 2) * (f.d && f.d !== 1 ? f.d : 1), ry = rx * 0.5;
      cx.globalAlpha = lk < 0.6 ? 0.5 : 1; cx.beginPath(); cx.ellipse(f.x, f.y, rx, ry, f.a || 0, 0, Math.PI * 2); cx.fill(); if (lk >= 0.6) cx.stroke();
    }
    cx.globalAlpha = 1;
  }
  function drawGround() {
    drawHutFloor();
    const P = POI.polynya;
    ArtWorld.polynya(cx, P.x + 10, P.y + 4);
    const gv = [cam.x, cam.y, cam.x + vw, cam.y + vh];
    if (typeof Trail !== 'undefined') Trail.draw(cx, gv); // тропы и расчистка (js/trail.js) — до лунок и следов
    if (typeof Ice !== 'undefined') Ice.drawHoles(cx, gv); // провалы во льду: вода, обломки, рябь; трещины перед провалом; мокрый след
    // пар над открытой водой в мороз: гуще в лютый холод, сносит ветром (частицы breath, эмиттер — спавн в update)
    if (state === 'play' && !UI.modal() && Math.abs(P.x - (cam.x + vw / 2)) < vw && Math.abs(P.y - (cam.y + vh / 2)) < vh) {
      const tC = temperature(), k = clamp((-tC - 8) / 22, 0, 1);
      if (k > 0) FX.emit('polynya-steam', (LOWQ() ? 2.5 : 5) * (0.5 + k), (parts, rr) => parts.push({ type: 'steam', x: P.x + 10 + (rr() - 0.5) * 44, y: P.y + 2 + (rr() - 0.5) * 12, vx: (rr() - 0.5) * 5, vy: -7 - rr() * 9, life: 2.4 + k, max: 2.4 + k }));
    }
    if (!G.flags.tube || Actions.grabbing(TUBE_POS)) { ArtWorld.tube(cx, TUBE_POS.x, TUBE_POS.y + 2); EYES.push({ x: TUBE_POS.x, y: TUBE_POS.y - 2, spark: 0.5 + Math.sin(now * 5) * 0.5 }); }
    const near = (x, y, mx, my = mx) => x > cam.x - mx && x < cam.x + vw + mx && y > cam.y - my && y < cam.y + vh + my;
    for (const h of G.holes) if (near(h.x, h.y, 30)) ArtWorld.hole(cx, h.x, h.y, h.dg == null ? 1 : h.dg, h.ice || 0);
    // пятна и следы
    for (const d of G.decals || []) if (near(d.x, d.y, 60)) ArtWorld.decal(cx, d);
    if (SF) printsC(G.prints, near); else for (const f of G.prints) if (near(f.x, f.y, 40)) ArtWorld.print(cx, f);
    if (typeof Depth !== 'undefined') Depth.art.trenches(cx, gv); // траншеи в глубоком снегу (заметает ветром)
    for (const q of KICKS) { const a = 1 - (now - q.t0) / 20; if (a > 0 && near(q.x, q.y, 30)) { cx.globalAlpha = 0.35 * a; ell(q.x, q.y + 1, 13, 4.5, '#6f8ea8'); ell(q.x + 2, q.y - 1, 11, 3, '#f6f9fc'); cx.globalAlpha = 1; } }
    for (const c of G.corpses || []) if (near(c.x, c.y, 80, 60)) ArtAnimals.corpse(cx, c.kind, c.x, c.y, G.time - c.t0);
    // ловушки, тайники и записки — с отсечением по экрану (C8)
    for (const t of G.traps) if (near(t.x, t.y, 40)) drawTrap(t);
    for (const s of G.stashes || []) if (near(s.x, s.y, 40)) drawStash(s);
    for (const id in NOTES) { const n = NOTES[id]; if (near(n.x, n.y, 30)) drawNote(id); }
    // зоны: промоины наледи, бурелом гари
    for (const o of Zones.OBJS) if (o.type === 'steam' && near(o.x, o.y, 40)) ArtZones.steamGround(cx, o, ENV);
    for (const f of G.fallen || []) if (near(f.x, f.y, 140)) ArtZones.fallenLog(cx, f);
    // от работы: сучья у разделанных стволов, чурки на снегу, пустые банки (исчезают через полсуток)
    for (const q of G.lap || []) if (near(q.x, q.y, 40)) ArtWorld.lapnik(cx, q, (G.time - q.t) / (CYCLE * Actions.FELL.bury));
    // чурка отваливается от ствола и откатывается (fx,fy — где отрезана, 0.45 с)
    if (typeof Tree === 'undefined') for (const c of G.chunks || []) if (near(c.x, c.y, 30)) { const e = c.fx != null ? clamp((G.time - c.t) / 0.45, 0, 1) : 1, k = 1 - (1 - e) * (1 - e);
      if (e >= 1) ArtWorld.chunk(cx, c.x, c.y, c.a); else ArtWorld.chunk(cx, c.fx + (c.x - c.fx) * k, c.fy + (c.y - c.fy) * k - 4 * Math.sin(Math.PI * Math.min(1, e * 1.6)) * (1 - e), c.a + (1 - k) * 3 * Math.sign(c.x - c.fx || 1)); }
    // брошенная палка и пустая банка: со временем присыпает снегом и уходит под него (удаляет логика — Actions.tickWorld, по возрасту)
    if (G.litter) for (const q of G.litter) if (near(q.x, q.y, 20)) { if (q.k === 'stick') drawStick(q); else ArtWorld.emptyCan(cx, q.x, q.y, q.a, clamp((G.time - q.t) / (CYCLE * Actions.CAN_LIFE), 0, 1)); }
  }

  // ---------- тени по солнцу: единственный источник направленной тени ----------
  // силуэт дерева для тени: спрайт → однотонная маска, края смягчены наложением со сдвигами (ctx.filter в Safari нет)
  // tree = true — мягкая тень ели: blur-край, светлеет к кончику, пятнистые просветы; без флага (Ми-8) — прежний способ
  // мягкие тени (tree) — ещё в ½ от этого: край всё равно размыт, а источник вчетверо меньше (дешевле каждый кадр)
  const SIL = new WeakMap(), SILT = new WeakMap(), SILQ = +(window.__SILQ || 0.5);
  function silhouette(S, tree) {
    const MAP = tree ? SILT : SIL;
    let c = MAP.get(S); if (c) return c;
    // тень мягкая — печём не крупнее rdpr × 2.5 (на ступени 4 спрайт ×8: силуэт той же резкости не нужен, а памяти ×2.5²)
    const f = Math.min(1, rdpr * 2.5 / (S._s || rdpr)) * (tree ? SILQ : 1), W = Math.ceil(S.width * f), H = Math.ceil(S.height * f);
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mg = m.getContext('2d'); mg.drawImage(S, 0, 0, W, H); mg.globalCompositeOperation = 'source-in'; mg.fillStyle = '#27394a'; mg.fillRect(0, 0, W, H);
    const g = c.getContext('2d'), r = Math.max(1, W / 110 * 2.2);
    if (!tree) {
      g.globalAlpha = 0.22; g.drawImage(m, 0, 0);
      for (let i = 0; i < 8; i++) g.drawImage(m, Math.cos(i * Math.PI / 4) * r, Math.sin(i * Math.PI / 4) * r);
      MAP.set(S, c); return c;
    }
    // мягкий контур: настоящий blur там, где он есть, иначе два кольца сдвигов. Ядро дублируется — после blur тень не бледнеет
    if (typeof g.filter === 'string') {
      g.filter = 'blur(' + (r * 0.7).toFixed(1) + 'px)'; g.globalAlpha = 1; g.drawImage(m, 0, 0); g.drawImage(m, 0, 0);
      g.filter = 'blur(' + (r * 2).toFixed(1) + 'px)'; g.globalAlpha = 0.5; g.drawImage(m, 0, 0); g.filter = 'none';
    } else {
      g.globalAlpha = 0.24; g.drawImage(m, 0, 0);
      for (let i = 0; i < 8; i++) g.drawImage(m, Math.cos(i * Math.PI / 4) * r, Math.sin(i * Math.PI / 4) * r);
      g.globalAlpha = 0.1; for (let i = 0; i < 8; i++) g.drawImage(m, Math.cos(i * Math.PI / 4 + 0.4) * r * 2, Math.sin(i * Math.PI / 4 + 0.4) * r * 2);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-out';
    // светлеет к дальнему краю (верх спрайта ложится вдоль солнца): у основания плотнее, к кончику мягче
    const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.03)'); gr.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // просветы между лапами: тень пятнистая, не однотонная (у корпуса Ми-8 — сплошная)
    if (tree === 'hull') { g.globalCompositeOperation = 'source-over'; MAP.set(S, c); return c; }
    let sd = (W * 31 + H * 17) | 0; const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 22; i++) {
      const x = rnd() * W, y = rnd() * H, rr = (0.04 + rnd() * 0.07) * W, gg = g.createRadialGradient(x, y, 0, x, y, rr);
      gg.addColorStop(0, 'rgba(0,0,0,0.18)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    g.globalCompositeOperation = 'source-over';
    MAP.set(S, c); return c;
  }
  // тень Ми-8 — только от корпуса, лопастей и мачты: всё ниже линии днища (сугроб у борта, ящики, своя контактная тень) стёрто,
  // иначе сугроб спрайта проецировался бы на снег как часть вертолёта. Линия днища: y = −11 − 0.09·(x + 10) (наклон фюзеляжа)
  const HULL = new WeakMap();
  function mi8Hull(S) {
    let c = HULL.get(S); if (c) return c;
    c = document.createElement('canvas'); c.width = S.width; c.height = S.height; c._s = S._s;
    const g = c.getContext('2d'), sc = S.width / 320; g.drawImage(S, 0, 0);
    g.setTransform(sc, 0, 0, sc, 160 * sc, 140 * sc); g.globalCompositeOperation = 'destination-out'; g.beginPath();
    g.moveTo(-170, -16); g.lineTo(-104, -13); g.lineTo(-100, -3); g.lineTo(86, -20); g.lineTo(170, -20); g.lineTo(170, 80); g.lineTo(-170, 80); g.closePath(); g.fill();
    HULL.set(S, c); return c;
  }
  function drawShadows(sunA, sunL, alpha) {
    if (alpha < 0.02) return;
    cx.globalAlpha = alpha;
    const cast = (x, y, len, w, k = 1) => {
      if (k !== 1) cx.globalAlpha = Math.min(1, alpha * k);
      cx.save(); cx.translate(x, y); cx.rotate(sunA); cx.drawImage(SHADOW, -w * 0.3, -w / 2, len + w * 0.3, w); cx.restore();
      if (k !== 1) cx.globalAlpha = alpha;
    };
    const dx = Math.cos(sunA), dy = Math.sin(sunA), kk = Math.min(1, 0.28 * sunL), LOWQ = window.QUALITY === 'low';
    // отсечение по кадру с запасом на длину тени: тень ложится от комля вверх (к северу) и вбок, поэтому дерево выше кадра
    // тени в кадр не бросает, а ниже кадра — бросает на высоту ≤ 170·kk·1.4 (раньше брался круг вдвое больше экрана)
    const ext = 170 * kk * 1.45, sx0 = cam.x - 80 - ext * Math.abs(dx), sx1 = cam.x + vw + 80 + ext * Math.abs(dx), sy0 = cam.y - 30 - ext * Math.max(0, dy), sy1 = cam.y + vh + 30 + ext * Math.abs(dy);
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 200)) if (t.wood > 0 && t.x > sx0 && t.x < sx1 && t.y > sy0 && t.y < sy1) {
      if (!LOWQ && t.stage !== 1) { // тень повторяет силуэт: ось «вверх» спрайта ложится вдоль солнца, длина ~ высота × kk
        // одна setTransform вместо save/translate/transform/restore на каждое дерево (матрица = WT × сдвиг × сдвиг-наклон)
        const tw = ArtWorld.treeW(t.kind), k = t.s / ArtWorld.treeK(t.s) * tjit(t) * dpr;
        cx.setTransform(k, 0, -dx * kk * k, -dy * kk * k, (t.x - cam.x + shx) * dpr, (t.y - cam.y + shy) * dpr);
        cx.drawImage(silhouette(treeSprite(t, treeV(t)), true), -tw / 2, -160, tw, 170); continue;
      }
      WT(); cast(t.x, t.y, (t.stage === 1 ? 16 : 44) * t.s * sunL, (t.stage === 1 ? 8 : 22) * t.s);
    }
    WT();
    const near = (x, y, m) => x > cam.x - m && x < cam.x + vw + m && y > cam.y - m && y < cam.y + vh + m;
    if (near(HUT.x, HUT.y, 400)) cast(HUT.x, HUT.y - 20, 70 * sunL, 150);
    if (near(POI.cockpit.x, POI.cockpit.y, 400)) {
      if (LOWQ) cast(POI.cockpit.x, POI.cockpit.y, 30 * sunL, 110);
      else {
        // корпус лежит на снегу и сам заслоняет свою тень: при коротком полуденном солнце она пряталась под фюзеляжем.
        // Длина у Ми-8 не меньше высоты и всегда чуть к северу — край тени выходит из-за борта; мягкий край (blur), без просветов
        const c = POI.cockpit, kh = Math.max(kk, 0.8) * 1.2;
        cx.save(); cx.translate(c.x, c.y); cx.globalAlpha = Math.min(1, alpha * 1.8);
        cx.transform(1, 0, -dx * kh, -dy * kh + 0.12, 0, 0); cx.drawImage(silhouette(mi8Hull(MI8F()), 'hull'), -160, -140, 320, 210);
        cx.restore(); cx.globalAlpha = alpha;
      }
    }
    if (near(POI.chum.x, POI.chum.y, 300)) cast(POI.chum.x, POI.chum.y, 56 * sunL, 64);
    if (near(POI.labaz.x, POI.labaz.y, 300)) cast(POI.labaz.x, POI.labaz.y, 32 * sunL, 40);
    for (const o of Zones.OBJS) { const S = ZSH[o.type]; if (S && near(o.x, o.y, 400)) cast(o.x, o.y, S[0] * sunL, S[1]); }
    for (const q of G.rocks || []) if (near(q.x, q.y, 120)) cast(q.x, q.y, 10 * q.s * sunL, 34 * q.s);
    // в снегу по пояс — над снегом меньше тела: тень короче (sinkK — доля роста под снегом)
    { const ik = typeof Ice !== 'undefined' && Ice.active() ? 0.8 : sinkK(G.p, 'p'); cast(G.p.x, G.p.y, 16 * sunL * (1 - ik), 14); }
    if (G.urk.state !== 'away' && near(G.urk.x, G.urk.y, 200)) cast(G.urk.x, G.urk.y, 16 * sunL * (1 - sinkK(G.urk, 'n')), 14);
    if (G.vera.state !== 'dead' && !insideHut(G.vera.x, G.vera.y) && near(G.vera.x, G.vera.y, 200)) cast(G.vera.x, G.vera.y, 16 * sunL * (1 - sinkK(G.vera, 'n')), 14);
    // звери и штабели — тоже по солнцу (рядом с людьми освещены одинаково)
    for (const w of G.wolves) if (near(w.x, w.y, 200)) cast(w.x, w.y, 12 * sunL * (1 - sinkK(w, 'wolf')), 16);
    for (const h of G.hares) if (near(h.x, h.y, 150)) cast(h.x, h.y, 6 * sunL, 9);
    for (const d of G.deer || []) if (near(d.x, d.y, 200)) cast(d.x, d.y, 18 * sunL * (1 - sinkK(d, 'deer')), 20);
    if (G.bear && near(G.bear.x, G.bear.y, 200)) cast(G.bear.x, G.bear.y, 16 * sunL * (1 - sinkK(G.bear, 'bear')), 26);
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
  // ---------- гибрид: мягкие тени прежней фактуры, направление — одно солнце словаря (то же, что светит елям и фигурам) ----------
  // длина — от высоты солнца (утро/вечер длиннее, kL до ×1.6), прозрачность — как прежде (день, сумерки, пурга почти без теней)
  function sunShadowsOne(h, d, storm) {
    const up = smooth(5.3, 6.8, h) * (1 - smooth(18.6, 20, h)), alpha = storm ? 0.05 : Math.max(d * 0.3, up * 0.15);
    if (alpha < 0.02 || h < 5 || h > 20) return;
    const kL = 1 + 0.6 * clamp(Math.abs(12 - h) / 6, 0, 1), V = Style.SHV, m = Math.hypot(V.x, V.y);
    drawShadows(Math.atan2(V.y, V.x), m * kL / 0.28, alpha);   // kk = 0.28·sunL — сдвиг тени на 1 px высоты = |SHV|·kL
  }
  // ---------- C: тени по одному правилу словаря (Style.SHV — то же солнце, что светит фигурам и елям) ----------
  // сплошной тон тени (без размытия и просветов), направление всегда вправо-вниз; длина — от высоты солнца (утро/вечер длиннее);
  // днём — полный тон, в сумерки гаснет, ночью и в пургу теней нет. Рисуется до троп и следов: линии туши на земле — поверх тени.
  const SILC = new WeakMap();
  function silC(S) {
    let c = SILC.get(S); if (c) return c;
    const f = Math.min(1, rdpr * 2.5 / (S._s || rdpr)), W = Math.ceil(S.width * f), H = Math.ceil(S.height * f);
    c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.drawImage(S, 0, 0, W, H); g.globalCompositeOperation = 'source-in'; g.fillStyle = Style.P.shade; g.fillRect(0, 0, W, H);
    SILC.set(S, c); return c;
  }
  function shadowsC(h, d) {
    const al = clamp(d * 1.6, 0, 1) * (1 - Style.weights.storm); if (al < 0.02) return;
    const kL = 1 + 0.6 * clamp(Math.abs(12 - h) / 6, 0, 1), sx = Style.SHV.x * kL, sy = Style.SHV.y * kL, LOWQ = window.QUALITY === 'low';
    cx.globalAlpha = al; cx.fillStyle = Style.P.shade;
    const ext = 170 * kL, x0 = cam.x - 80 - ext * sx, x1 = cam.x + vw + 80, y0 = cam.y - 30 - ext * sy, y1 = cam.y + vh + 30;
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 220)) if (t.wood > 0 && t.x > x0 && t.x < x1 && t.y > y0 && t.y < y1) {
      if (t.stage === 1) { WT(); Style.cast(cx, t.x, t.y, 30 * t.s, 8 * t.s, kL); continue; }
      const tw = ArtWorld.treeW(t.kind), k = t.s / ArtWorld.treeK(t.s) * tjit(t) * dpr;
      cx.setTransform(k, 0, -sx * k, -sy * k, (t.x - cam.x + shx) * dpr, (t.y - cam.y + shy) * dpr);
      cx.drawImage(silC(treeSprite(t, treeV(t))), -tw / 2, -160, tw, 170);
    }
    WT();
    const near = (x, y, m) => x > cam.x - m && x < cam.x + vw + m && y > cam.y - m && y < cam.y + vh + m;
    const C = (x, y, hh, w) => Style.cast(cx, x, y, hh, w, kL);
    if (near(HUT.x, HUT.y, 400)) C(HUT.x, HUT.y - 20, 150, 150);
    if (near(POI.cockpit.x, POI.cockpit.y, 400)) {
      if (LOWQ) C(POI.cockpit.x, POI.cockpit.y, 60, 200);
      else { const c = POI.cockpit; cx.save(); cx.translate(c.x, c.y); cx.transform(1, 0, -sx, -sy, 0, 0); cx.drawImage(silC(mi8Hull(MI8F())), -160, -140, 320, 210); cx.restore(); }
    }
    if (near(POI.chum.x, POI.chum.y, 300)) C(POI.chum.x, POI.chum.y, 120, 64);
    if (near(POI.labaz.x, POI.labaz.y, 300)) C(POI.labaz.x, POI.labaz.y, 70, 40);
    for (const o of Zones.OBJS) { const S = ZSH[o.type]; if (S && near(o.x, o.y, 400)) C(o.x, o.y, S[0] * 2.2, S[1]); }
    for (const q of G.rocks || []) if (near(q.x, q.y, 120)) C(q.x, q.y, 22 * q.s, 30 * q.s);
    const fig = (o, kind, hh, w) => C(o.x, o.y, hh * (1 - (kind ? sinkK(o, kind) : 0)), w);
    { const ik = typeof Ice !== 'undefined' && Ice.active() ? 0.8 : sinkK(G.p, 'p'); if (!G.p.inside) C(G.p.x, G.p.y, 42 * (1 - ik), 14); }
    if (G.urk.state !== 'away' && near(G.urk.x, G.urk.y, 200) && !insideHut(G.urk.x, G.urk.y)) fig(G.urk, 'n', 42, 14);
    if (G.vera.state !== 'dead' && !insideHut(G.vera.x, G.vera.y) && near(G.vera.x, G.vera.y, 200)) fig(G.vera, 'n', 42, 14);
    for (const n of Npc.list()) if (n.id !== 'urk' && n.id !== 'vera' && near(n.st.x, n.st.y, 200)) fig(n.st, 'n', 42, 14);
    for (const w of G.wolves) if (near(w.x, w.y, 200)) fig(w, 'wolf', 26, 18);
    for (const hh of G.hares) if (near(hh.x, hh.y, 150)) C(hh.x, hh.y, 12, 9);
    for (const dd of G.deer || []) if (near(dd.x, dd.y, 200)) fig(dd, 'deer', 46, 22);
    if (G.bear && near(G.bear.x, G.bear.y, 200)) fig(G.bear, 'bear', 40, 28);
    for (const s of G.stacks) if (near(s.x, s.y, 200) && !(s.lit > 0)) C(s.x, s.y, 24, 30);
    if (G.col) {
      for (const b of G.col.builds) { const B = BUILDS[b.type]; if (!near(b.x, b.y, 420)) continue; const k = b.done ? 1 : 0.25 + 0.75 * clamp(b.prog || 0, 0, 1); C(b.x, b.y + B.h * 0.3, (b.type === 'tower' ? 190 : B.h * 2.4) * k, B.w * (b.type === 'tower' ? 0.8 : 1)); }
      for (const u of G.col.units) if (!u.hidden && near(u.x, u.y, 200)) { const dog = u.type === 'laika'; C(u.x, u.y, dog ? 20 : 42, dog ? 13 : 14); }
    }
    cx.globalAlpha = 1;
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
  // горящие огни — раз за кадр (для поз «греет руки» у людей посёлка)
  let BURN = [], burnF = -1;
  function nearBurn(o, r) { if (burnF !== frame) { burnF = frame; BURN = Fire.burning(); } for (const f of BURN) if (dist2(f, o) < r * r) return f; return null; }
  function drawUnit(u, g = cx) {
    const sel = G.col.sel.includes(u.id), T = UNITS[u.type], mh = T.hp + Colony.mod('hp'), m = motion(u, u.face);
    const moved = m.spd > 8; // «идёт» — по скорости, а не по сдвигу за кадр (не зависит от FPS, A14)
    if (u.type === 'laika') {
      if (ghost) return;
      if (sel) ring(u.x, u.y, 15, 6);
      sunk(cx, u, 'dog', () => drawDog(u));
      if (u.hp < mh) { rr(u.x - 12, u.y + 5, 24, 3, 1, 'rgba(39,57,74,0.6)'); rr(u.x - 12, u.y + 5, 24 * u.hp / mh, 3, 1, u.hp / mh > 0.4 ? '#9fe36b' : '#b8392d'); }
      return;
    }
    const D = ArtPeople.DUR, w = u.working;
    let anim = moved ? 'walk' : 'idle', animT = 0, tool = u.type === 'evenk' ? 'bow' : u.type === 'strelok' ? 'rifle' : 'axe', target = null, uf = u.face;
    if (w === 'chop' || w === 'wreck') { anim = 'chop'; animT = ((now + u.id * 0.37) % D.chop) / D.chop; }
    else if (w === 'build') { anim = 'build'; animT = ((now + u.id * 0.3) % D.build) / D.build; }
    else if (w === 'fish') { anim = 'fish'; tool = 'rod'; animT = (now * 0.2 + u.id * 0.1) % 1; }
    else if (T.rng && u.cd > 0.2) { anim = 'shoot'; animT = clamp(1 - (u.cd - 0.2) / 1.4, 0, 1); }
    const c = Object.keys(u.carry)[0];
    if (c && moved) anim = 'carry';
    // стоит без дела: у огня греет руки, иначе изредка возится (таймер по id) — не «статуя»
    if (anim === 'idle') {
      const f = nearBurn(u, 80);
      if (f && ArtPeople.POSE.warmHands) { anim = 'warmHands'; animT = (now % 1.6) / 1.6; uf = Math.sign(f.x - u.x) || uf; }
      else { const q = fidget(u.id * 7 + 13); if (q) { anim = q.anim; animT = q.animT; } }
    }
    const sp = clamp(T.sp / 160, 0.2, 1), vy = view(m, anim === 'walk' || anim === 'carry' ? dirY(m) : 0);
    const WP = windPose(u, moved ? m.face : uf, vy, anim, moved); anim = deepWalk(u, WP.anim, moved); if (!ghost) rimLight(u);
    sunk(g, u, 'n', () => ArtPeople.draw(g, { key: u, x: u.x, y: u.y, face: moved ? m.face : uf, vy, t: now, phase: stepPhase(m, anim, m.spd, vy), gait: m.gait, speed: sp, anim, animT, wind: WP.w, gust: WP.g, look: LK[u.type], tool, target,
      carry: c ? ITEMS[c].i : null, sel: sel && !ghost, hp: !ghost && u.hp < mh ? u.hp / mh : null, seed: u.id, crowd: 1 }, ENV));
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

  // ---------- разговор: дерево/постройка перед участниками плавно становится полупрозрачной (js/talk.js — кого беречь) ----------
  let TALKW = []; const FADEM = new Map(), FADEK = { 0: 1, 11: 1, 14: 1, 22: 1, 32: 1, 33: 1 };
  function occFade(k, o) {
    const r = occRect(k, o); let tg = 1; const oy = o && o.y != null ? o.y : r ? r[3] : 0, key = o && typeof o === 'object' ? o : 'k' + k;
    if (r) for (const q of TALKW) if (q && oy > q.y + 2 && r[0] < q.x + 12 && r[2] > q.x - 12 && r[1] < q.y - 4 && r[3] > q.y - 50) { tg = 0.3; break; }
    let v = FADEM.has(key) ? FADEM.get(key) : 1; v += (tg - v) * Math.min(1, rdt * 6); if (Math.abs(v - tg) < 0.01) v = tg;
    if (v >= 1) FADEM.delete(key); else FADEM.set(key, v);
    return v;
  }
  // ---------- силуэт за препятствием (C4): крыша, крона, Ми-8 закрыли героя — дорисовать его полупрозрачно ----------
  const TREE_BOX = [[30, 118], [25, 105], [40, 105]];
  function occRect(k, o) {
    switch (k) {
      case 0: { if (o.wood <= 0) return null; const [hw, ht] = o.stage === 1 ? [12, 40] : TREE_BOX[o.kind] || TREE_BOX[0], s = o.s; return [o.x - hw * s, o.y - ht * s, o.x + hw * s, o.y - 10 * s]; }
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
  // силуэт — только когда фигура ЗА вещью (выше по экрану её подножия), не внутри (js/content/footprints.js)
  function footOf(k, o) {
    switch (k) {
      case 9: case 29: case 30: return World.FOOT_BY.mi8; case 10: return World.FOOT_BY.tail; case 11: return World.FOOT_BY.chum;
      case 14: return World.FOOT_BY.labaz; case 32: return o.foot || null;
      case 0: { const r = World.trunkR(o); return { sh: [{ t: 1, cx: o.x, cy: o.y, cr: r }], y1: o.y + r }; }
      case 22: { const B = BUILDS[o.type]; return B ? { sh: [{ t: 0, x0: o.x - B.w / 2, y0: o.y - B.h / 2, x1: o.x + B.w / 2, y1: o.y + B.h / 2 }], y1: o.y + B.h / 2 } : null; }
    }
    return null;
  }
  function behind(k, o, f) {
    const F = footOf(k, o); if (!F) return true;
    let top = null;
    for (const q of F.sh) {
      if (q.t ? (f.x - q.cx) ** 2 + (f.y - q.cy) ** 2 < q.cr * q.cr : f.x > q.x0 && f.x < q.x1 && f.y > q.y0 && f.y < q.y1) return false; // внутри
      const a = q.t ? q.cx - q.cr : q.x0, b = q.t ? q.cx + q.cr : q.x1, t = q.t ? q.cy : q.y0;
      if (f.x + 10 > a && f.x - 10 < b) top = top == null ? t : Math.min(top, t);
    }
    return f.y < (top == null ? F.y1 : top);
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
    if (SC) return Style.ambientAt(h, storm);   // одна таблица времени суток и погоды — в словаре (общая для всех объектов)
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
    if (rdt > 0) { const k = ease(4, rdt); HELI.vx += ((hx - HELI.x) / rdt - HELI.vx) * k; HELI.vy += ((hy - HELI.y) / rdt - HELI.vy) * k; }
    HELI.x = hx; HELI.y = hy;
    const f = HELI.vx > 0 ? -1 : 1, sp = Math.hypot(HELI.vx, HELI.vy);
    // крен/тангаж: нос вниз по скорости, наклон по вертикальной составляющей курса
    const bank = clamp(Math.atan2(HELI.vy, Math.abs(HELI.vx) + 1) * 0.5 + Math.min(0.12, sp / 1500), -0.26, 0.26);
    ell(hx, hy + 140, 90 * sc, 16 * sc, 'rgba(39,57,74,0.22)');
    cx.save(); cx.translate(hx, hy); cx.scale(sc * f, sc); cx.rotate(-bank);
    cx.drawImage(ArtWorld.mi8Fly(), -108, -70, 290, 132);
    ArtWorld.rotor(cx, 0, -66, 150, now); if (ArtWorld.tailRotor) ArtWorld.tailRotor(cx, 175, -56, 13, now);
    cx.restore();
    light(hx, hy + 140, 200, 'c', 0.6);
  }

  // ---------- главный рендер ----------
  let lastCam = { x: 0, y: 0 }, CTX = null; // CTX — сводка Ctx.now() на кадр (js/context.js)
  function render(dt, ctxTarget) {
    frame++; rdt = dt; if (SF) Style.tick();
    zoomStep();
    if (state === 'menu') { cam.x = HUT.x - vw / 2 + Math.sin(now * 0.1) * 40; cam.y = HUT.y - vh / 2 + 40; }
    else {
      if (state === 'play' && (G.hurt || 0) > 0.95) recenter(); // укусили — показать героя
      camStep(dt);
    }
    // камера — целыми пикселями устройства на время кадра (Z4): тонкие линии не «ползут»
    const cx0 = cam.x, cy0 = cam.y;
    cam.x = Math.round(cam.x * dpr) / dpr; cam.y = Math.round(cam.y * dpr) / dpr;
    // кадр упал посреди save() — стек состояний не тащим в следующие кадры (reset есть в Chrome 99+/Safari 17+/Firefox 113+)
    try { scene(dt, ctxTarget); } catch (e) { try { if (cx.reset) cx.reset(); } catch (_) { /* нет reset — сброс в начале кадра */ } throw e; } finally { cam.x = cx0; cam.y = cy0; }
  }
  function scene(dt, ctxTarget) {
    const p = G.p;
    const camDX = cam.x - lastCam.x, camDY = cam.y - lastCam.y; lastCam = { x: cam.x, y: cam.y };
    const h = state === 'menu' ? 20.3 : hourOf(), d = daylight(h), night = 1 - d, storm = state === 'play' && stormOn();
    const wind = Wind.treeK(); // единый ветер: день 1, пурга 4 (как прежде), тихий мороз ≈ 0.27
    FX.setStorm(storm);
    shx = G.shake ? crnd(-G.shake, G.shake) : 0; shy = G.shake ? crnd(-G.shake, G.shake) : 0;
    LIGHTS = []; EYES = [];
    ENV.now = now; ENV.night = night; ENV.wind = wind;
    { const wd = Wind.dir(), c = Math.cos(wd); ENV.wx = c >= 0 ? Math.max(0.35, c) : Math.min(-0.35, c); ENV.wy = Math.sin(wd); } // к камере/от камеры — всё равно заметный наклон вбок
    CTX = typeof Ctx !== 'undefined' && state === 'play' ? Ctx.now() : null;
    const LOW = window.QUALITY === 'low';
    GUSTY.length = 0; tickFalls();
    const dusk = Math.max(smooth(6.2, 7.2, h) * (1 - smooth(7.8, 9, h)), smooth(16.2, 17.4, h) * (1 - smooth(18.4, 19.4, h)));
    if (SF) Style.mood(night, dusk, storm, now);   // перекраска ролей: день/сумерки/ночь/пурга (js/style.js)

    // состояние контекста — с чистого листа: если прошлый кадр оборвался посреди полупрозрачного рисунка, куски снега
    // рисовались бы полупрозрачными поверх тёмного фона (светлые швы по нахлёсту +1 и серый снег)
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; if (cx.filter !== 'none') cx.filter = 'none';
    cx.fillStyle = '#10271f'; cx.fillRect(0, 0, cv.width, cv.height);
    WT();
    // 1. снег: готовые куски; недостающие — ровным тоном, пекутся по полосам в пределах бюджета
    // бюджет печи спрайтов на кадр (ArtWorld.sprite): не влезло — рисуем прошлой ступенью, допечётся в следующих кадрах
    ArtWorld.budget(LOW ? 4 : 6, LOW ? 48 : 128); // и потолок памяти спрайтов, МБ (LRU)
    const cs = chunkScale(), cw = chunkSize(cs);
    // края кусков — по пикселям устройства (общий край у соседей один и тот же): ни щели, ни нахлёста.
    // На зуме ≤ 1 — прежний нахлёст +1 (эталоны); на крупном растяжение нахлёстом давало светлый шов
    const snap = v => Math.round((v - cam.x) * dpr) / dpr + cam.x, snapY = v => Math.round((v - cam.y) * dpr) / dpr + cam.y;
    // видимые куски — с запасом на тряску (кадр сдвинут на shx/shy мира): край кадра не остаётся без снега
    const sm = Math.abs(shx) + Math.abs(shy), NX = Math.ceil(W / cw), NY = Math.ceil(H / cw);
    const ix0 = Math.max(0, Math.floor((cam.x - sm) / cw)), ix1 = Math.min(NX - 1, Math.floor((cam.x + vw + sm) / cw));
    const iy0 = Math.max(0, Math.floor((cam.y - sm) / cw)), iy1 = Math.min(NY - 1, Math.floor((cam.y + vh + sm) / cw));
    chunkCap = (ix1 - ix0 + 2) * (iy1 - iy0 + 2) + 4 + (cw < 512 ? ix1 - ix0 + iy1 - iy0 + 2 : 0); // + второй ряд запаса на мелких кусках
    let visWait = 0;
    // подложка тоном снега под кусками: масштабированный drawImage целого куска сглаживает его край с прозрачным «снаружи» —
    // на стыке двух кусков (особенно при зуме < 1) сквозь полупрозрачную кромку просвечивал тёмный фон кадра → тонкая тёмная линия
    // (подложка — только полосы по стыкам, не весь кадр: заливка экрана в программной отрисовке стоит ~0.5 мс)
    { const X0 = Math.max(0, cam.x - sm - 2), Y0 = Math.max(0, cam.y - sm - 2), X1 = Math.min(W, cam.x + vw + sm + 2), Y1 = Math.min(H, cam.y + vh + sm + 2), q = 2 / dpr;
      cx.fillStyle = BASE; for (let i = ix0 + 1; i <= ix1; i++) cx.fillRect(i * cw - q, Y0, 2 * q, Y1 - Y0); for (let j = iy0 + 1; j <= iy1; j++) cx.fillRect(X0, j * cw - q, X1 - X0, 2 * q); }
    for (let i = ix0; i <= ix1; i++) for (let j = iy0; j <= iy1; j++) {
      const e = chunkAt(i, j, cs, true); e.v = frame;
      if (e.done) {
        if (zoom <= 1) cx.drawImage(e.c, i * cw, j * cw, cw + 1, cw + 1);
        else { const x0 = snap(i * cw), y0 = snapY(j * cw); cx.drawImage(e.c, x0, y0, snap((i + 1) * cw) - x0, snapY((j + 1) * cw) - y0); }
      }
      else { visWait++; chunkFallback(i * cw, j * cw, cw); }
    }
    // видимое — первым в печь (запас, заказанный раньше, не задерживает то, что уже в кадре)
    if (visWait && bakeQ.length > 1 && bakeQ[0].v !== frame) { const a = [], b = []; for (const e of bakeQ) (e.v === frame ? a : b).push(e); bakeQ = a.concat(b); }
    // запас по направлению движения камеры (стороны и угол между ними) — заказ, когда печь свободна;
    // на крупных ступенях кусок мелкий (128–256 мира) — по прямой запас в два куска (по диагонали — в один: потолок памяти кусков)
    if (!bakeQ.length && (Math.abs(camDX) > 0.3 || Math.abs(camDY) > 0.3)) {
      const dx = camDX > 0.3 ? 1 : camDX < -0.3 ? -1 : 0, dy = camDY > 0.3 ? 1 : camDY < -0.3 ? -1 : 0, R = cw < 512 && !(dx && dy) ? 2 : 1;
      // прямоугольник кадра, раздвинутый на R кусков в сторону движения; заказ — всё, что вне кадра, ближние кольца первыми
      const X0 = Math.max(0, dx < 0 ? ix0 - R : ix0), X1 = Math.min(NX - 1, dx > 0 ? ix1 + R : ix1), Y0 = Math.max(0, dy < 0 ? iy0 - R : iy0), Y1 = Math.min(NY - 1, dy > 0 ? iy1 + R : iy1);
      for (let r = 1; r <= R; r++) for (let i = X0; i <= X1; i++) for (let j = Y0; j <= Y1; j++)
        if (Math.max(i < ix0 ? ix0 - i : i > ix1 ? i - ix1 : 0, j < iy0 ? iy0 - j : j > iy1 ? j - iy1 : 0) === r) chunkAt(i, j, cs, true);
    }
    bakeRun(LOW ? 2 : 3); warm = false;
    trimChunks();
    drawRiver();
    if (SF) shadowsC(h, d);   // C: тени — до троп и следов (линии туши на земле поверх тени)
    // 2. земля
    drawGround();
    if (typeof Snow !== 'undefined' && !window.SNOW_OFF) Snow.ground(cx, [cam.x, cam.y, cam.x + vw, cam.y + vh], ENV); // наддувы и позёмка (js/snow.js)
    if (!SF) (SC ? sunShadowsOne : sunShadows)(h, d, storm);   // гибрид: мягкие тени, но одно солнце (Style.SHV)
    // 3. объекты по опорной линии (южный край площади объекта)
    const x0 = cam.x - 120, x1 = cam.x + vw + 120, y0 = cam.y - 40, y1 = cam.y + vh + 180;
    const L = [];
    const vis = (x, y) => x > x0 && x < x1 && y > y0 && y < y1;
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 220)) if (vis(t.x, t.y)) L.push([t.y, 0, t]);
    for (const f of FALL) if (vis(f.x, f.y) || vis(f.x + Math.cos(f.a) * f.len, f.y + Math.sin(f.a) * f.len * 0.6)) L.push([fallY(f), 36, f]);
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
    if (typeof Ice !== 'undefined') for (const s of Ice.sinkers()) if (vis(s.x, s.y)) L.push([s.y, 38, s]); // шатун под лёд
    if (G.col) {
      for (const b of G.col.builds) if (vis(b.x, b.y)) L.push([b.y + BUILDS[b.type].h / 2, 22, b]);
      for (const u of G.col.units) if (!u.hidden && vis(u.x, u.y)) L.push([u.y, 23, u]);
      if (G.col.ghost && typeof Input !== 'undefined') Input.sync(); // призрак — под курсором при текущей камере
      if (G.col.ghost) L.push([G.col.ghost.y + BUILDS[G.col.ghost.type].h / 2, 28]);
    }
    for (const a of G.amuletsAt || []) if ((!a.got || Actions.grabbing(a)) && vis(a.x, a.y)) L.push([a.y, 25, a]);
    if (typeof Tree !== 'undefined') { Tree.frame(); for (const q of G.chunks || []) if (vis(q.x, q.y)) L.push([q.y, 39, q]); }   // части дерева на снегу (js/tree3d.js)
    for (const q of G.loose || []) if (vis(q.x, q.y)) L.push([q.y, 40, q]);   // вещи на снегу, туши, поленница у избы (js/carry.js)
    for (const c of G.carcs || []) if (vis(c.x, c.y)) L.push([c.y - 2, 41, c]);
    { const P0 = Carry.PILE(); if (vis(P0.x, P0.y)) L.push([P0.y + 4, 42, P0]); }
    for (const lg of G.logs || []) if (vis(lg.x, lg.y) || vis(lg.x + Math.cos(lg.a) * lg.len, lg.y + Math.sin(lg.a) * lg.len * 0.6)) L.push([lg.f && !lg.f.hit ? lg.y : fallY(lg), 37, lg]);
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
    const watch = [], SNOWK = typeof Snow !== 'undefined' && !window.SNOW_OFF;
    const figRect = o => [o.x - 10, o.y - 44, o.x + 10, o.y - 4];
    TALKW = !ghost && typeof Talk !== 'undefined' && Talk.watchers ? Talk.watchers() : [];
    for (const [, k, o] of L) {
      const fa = (TALKW.length || FADEM.size) && FADEK[k] ? occFade(k, o) : 1; if (fa < 1) cx.globalAlpha = fa;   // разговор: что закрывает участников — полупрозрачно
      switch (k) {
        case 0: drawTree(o, wind); break; case 1: drawHare(o); break; case 2: drawWolf(o); break; case 3: drawFire(o); break;
        case 4: drawStack(o); break; case 5: drawBear(o); break;
        case 6: drawPlayer(); if (!p.inside && !p.sleeping) watch.push({ o: p, r: figRect(p), fn: g => drawPlayer(g), hit: 0 }); break;
        case 27: { const dr = Math.sign(p.x - p.sx) || 1; ArtWorld.sled(cx, p.sx, p.sy, 0, dr); Carry.drawSledLoad(cx, p.sx, p.sy, dr); } break;
        case 40: Carry.drawLoose(cx, o); break;
        case 41: Carry.drawCarc(cx, o); break;
        case 42: Carry.drawPile(cx); break;
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
        case 36: drawFall(o); break;
        case 38: drawSinker(o); break;
        case 37: drawLog(o); break;
        case 39: Tree.drawPart(cx, o, G.time); break;
        case 34: if (o === 'buran') ArtZones.buran(cx, G.veh.buran, ENV, false); else ArtZones.deerSled(cx, G.veh.deer, ENV); break;
      }
      if (SNOWK) Snow.after(cx, k, o); // шапка снега поверх вещи (js/snow.js)
      if (fa < 1) cx.globalAlpha = 1;
      if (watch.length) { const r = occRect(k, o); if (r) for (const w of watch) if (w.o !== o && overlap(r, w.r) > 0.25 && behind(k, o, w.o)) w.hit = 1; }
    }
    for (const w of watch) if (w.hit) drawGhostFigure(w.o, w.fn);
    // порыв рядом с героем стряхивает снег с крон (редко; эмиттер — спавн в update)
    if (GUSTY.length && state === 'play') FX.emit('gust-snow', wind > 1 ? 1.5 : 0.4, parts => { const t = GUSTY[(CR() * GUSTY.length) | 0]; if (t && t.wood > 0) ArtWorld.fx.branchSnow(parts, t, 0.3); });
    // 4. частицы в воздухе (дым, пар, точки) — поверх объектов
    FX.draw(cx, G.parts, 'air', ENV, view);
    if (G.ravens) drawRavens();
    if (G.col) drawColonyOverlay();
    drawHeli();

    // 5. ночь: насыщенность −40 % до карты света (сдвиг к синему даёт сам ambient), вместо заливки soft-light
    if (!SF && !LOW && night > 0.3) {
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'saturation'; cx.globalAlpha = 0.4 * smooth(0.3, 0.9, night); cx.fillStyle = '#808080'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    }
    // 5б. «плёнка»: приглушённые цвета, холодная тень, дымка вдали (верх кадра) — только high; зерно и виньетка после света
    if (!SF && !LOW) {
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'saturation'; cx.globalAlpha = 0.22; cx.fillStyle = '#808080'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'multiply'; cx.globalAlpha = 0.5; cx.fillStyle = '#e4ecf8'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
      const hz = cx.createLinearGradient(0, 0, 0, cv.height * 0.5); hz.addColorStop(0, 'rgba(214,226,240,0.32)'); hz.addColorStop(1, 'rgba(214,226,240,0)');
      cx.fillStyle = hz; cx.fillRect(0, 0, cv.width, cv.height * 0.5);
    }
    // 6. карта освещения
    const amb = SF ? Style.ambient() : ambient(h, storm);   // C: множитель перекраски ролей (луна и пурга — в таблице словаря)
    // луна: слабый общий холодный свет в ясную ночь (вместо светлого круга вокруг героя)
    if (!SF && !storm && night > 0.5) { const mk = smooth(0.5, 0.95, night) * (LOW ? 1 : 0.85); amb[0] += 10 * mk; amb[1] += 13 * mk; amb[2] += 20 * mk; }
    const dark = (amb[0] + amb[1] + amb[2]) / 765;
    const auroraK = LOW ? 0 : state === 'menu' ? 0.8 : night > 0.5 && !storm ? (G.aurora || 0) * smooth(0.5, 0.9, night) : 0;
    if (auroraK > 0 && frame % 2 === 0) aurora(auroraK);
    if (dark < 0.985) {
      if (!LOW || frame % 2 === 0 || !lm._ok) buildLight(amb, dark, auroraK);
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'multiply'; cx.drawImage(lm, 0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'source-over';
    } else lm._ok = false;
    if (SF) { const b = Style.lift(); if (b[0] + b[1] + b[2] > 9) { cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'lighter'; cx.fillStyle = `rgb(${b[0] | 0},${b[1] | 0},${b[2] | 0})`; cx.fillRect(0, 0, cv.width, cv.height); cx.globalCompositeOperation = 'source-over'; } } // добавка перекраски (дымка пурги)
    if (!SF && !LOW) { // зерно (сдвигается каждый кадр) и мягкая виньетка
      cx.setTransform(1, 0, 0, 1, 0, 0);
      if (!GRAIN) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), im = g.createImageData(128, 128); for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (CR() - 0.5) * 120; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); GRAIN = cx.createPattern(c, 'repeat'); }
      cx.save(); cx.translate((CR() * 128) | 0, (CR() * 128) | 0); cx.globalCompositeOperation = 'soft-light'; cx.globalAlpha = 0.28; cx.fillStyle = GRAIN; cx.fillRect(-128, -128, cv.width + 256, cv.height + 256); cx.restore();
      const vg = cx.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.45, cv.width / 2, cv.height / 2, Math.hypot(cv.width, cv.height) * 0.58);
      vg.addColorStop(0, 'rgba(30,44,66,0)'); vg.addColorStop(1, 'rgba(30,44,66,0.3)');
      cx.globalCompositeOperation = 'multiply'; cx.fillStyle = vg; cx.fillRect(0, 0, cv.width, cv.height); cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    }
    // 7. свечение: огонь, окна, глаза, искры — без приглушения, режимом 'lighter'
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.globalCompositeOperation = 'lighter';
    const glowK = 0.25 + night * 0.75;
    for (const e of EYES) {
      const sx = e.x - cam.x + shx, sy = e.y - cam.y + shy;
      if (e.glow) { if (SF) continue; const r = 50 * e.glow; cx.globalAlpha = 0.3 * glowK; cx.drawImage(GLOW, sx - r, sy - r, r * 2, r * 2); }
      else if (e.lamp) { cx.globalAlpha = e.lamp; cx.fillStyle = '#ff6a1a'; cx.beginPath(); cx.arc(sx, sy, 1.5, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = e.lamp * (0.3 + night * 0.5); cx.drawImage(PUFF, sx - 7, sy - 7, 14, 14); }
      else if (e.spark !== undefined) { cx.globalAlpha = e.spark * 0.8; cx.drawImage(PUFF, sx - 5, sy - 5, 10, 10); }
      else if (night > 0.3) {
        cx.globalAlpha = Math.min(1, night * 1.2);
        // глаза по ракурсу: в профиль — один (ближний); морда к камере (3/4 → анфас) — второй проявляется и отходит на ширину морды;
        // от камеры — не видно. fr — «анфасность» 0..1 (движение к камере или середина разворота)
        const fr = Math.max(e.dy > 0 ? e.dy : 0, 1 - (e.tq == null ? 1 : e.tq)), bk = e.dy < 0 ? -e.dy : 0, a1 = Math.min(1, night * 1.2) * (1 - smooth(0.45, 0.9, bk));
        const r0 = e.bear ? 2.6 : 2, a2 = a1 * smooth(0.2, 0.75, fr), sep = (e.bear ? 7 : 5) * (0.35 + 0.65 * fr);
        cx.fillStyle = e.red || e.bear ? '#ff6a1a' : '#ffd27a';
        if (a1 > 0.01) { cx.globalAlpha = a1; cx.beginPath(); cx.arc(sx, sy, r0, 0, Math.PI * 2); cx.fill(); }
        if (a2 > 0.01) { cx.globalAlpha = a2; cx.beginPath(); cx.ellipse(sx - e.f * sep, sy, r0 * (0.55 + 0.45 * fr), r0, 0, 0, Math.PI * 2); cx.fill(); }
        cx.globalAlpha = night * 0.25 * (1 - smooth(0.45, 0.9, bk)); cx.drawImage(PUFF, sx - 10, sy - 8, 20, 16);
      }
    }
    cx.globalAlpha = 1;
    WT(); cx.globalCompositeOperation = 'lighter';
    FX.draw(cx, G.parts, 'glow', ENV, view);
    cx.globalCompositeOperation = 'source-over';
    if (SF) for (const Lt of LIGHTS) if (Lt.t === 'f' && Lt.r > 150 && !Lt.clip) { const k = Math.sqrt(Lt.r / 300); Style.rays(cx, Lt.x, Lt.y + 10, 30 * k, 42 * k, 12, Math.min(1, Lt.a * 1.4), now * 0.15); } // свет огня — лучи охрой (вне перекраски)
    // (сияние — только отсветом в карте света: экранный слой лежал на деревьях и ехал с камерой, L8)

    // 8. снег, позёмка, пурга — цвет × ambient: ночью не светятся (L1, L7)
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // внутри избы (крыша снята — видна комната) снег не идёт: комната вырезана из слоя погоды (Ctx: герой в избе)
    const roomCut = roofA < 0.7;
    if (roomCut) { const R = ROOM(); cx.save(); cx.beginPath(); cx.rect(0, 0, vw, vh); cx.rect(R.x0 - WALL - cam.x + shx, R.y0 - cam.y + shy, R.x1 - R.x0 + WALL * 2, R.y1 - R.y0); cx.clip('evenodd'); }
    FX.weather.draw(cx, dt, { vw, vh, camDX, camDY, storm, amb, dark, px: p.x - cam.x, py: p.y - cam.y - 16, z: zoom, dpr, C: SF ? Style.role('paper') : null });
    if (roomCut) cx.restore();
    // 9. сумерки: тёплый тон (C — в перекраске ролей)
    if (!SF && dusk > 0.02) { cx.globalCompositeOperation = 'soft-light'; cx.globalAlpha = dusk * 0.35; cx.fillStyle = '#ff8e31'; cx.fillRect(0, 0, vw, vh); } // mix(№18, №23)
    cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    if (state === 'menu') return;

    // 10. подписи в мире (слой ui)
    WT();
    FX.draw(cx, G.parts, 'ui', ENV);
    Barks.draw(cx);
    if (typeof Talk !== 'undefined') Talk.draw(cx);   // реплики разговора: пузырь над говорящим
    // метка цели взаимодействия
    // метки над миром растут с зумом только до ×1.6 (uiK), дальше держат экранный размер — якорь на месте
    const uk = uiK(), uiAt = (x, y) => { cx.translate(x, y); cx.scale(uk, uk); cx.translate(-x, -y); };
    if (ctxTarget && !UI.modal() && !Actions.plate) {
      const o = ctxTarget; cx.fillStyle = '#ffd27a'; cx.globalAlpha = 0.9; const bob = Math.sin(now * 5) * 3;
      cx.save(); uiAt(o.x, o.y - o.h - 2);
      cx.beginPath(); cx.moveTo(o.x - 6, o.y - o.h - 10 + bob); cx.lineTo(o.x + 6, o.y - o.h - 10 + bob); cx.lineTo(o.x, o.y - o.h - 2 + bob); cx.closePath(); cx.fill(); cx.globalAlpha = 1;
      cx.restore();
    }
    // кольцо действия
    if (p.action && p.action.k !== 'fish' && p.action.dur < 100 && !p.action.cx && !/^(lie|getUp|notePick|notePut)$/.test(p.action.k)) { // жесты (взять, поесть, лечь) — без кольца
      const k = p.action.t / p.action.dur, sx = p.x, sy = p.y - 58;
      cx.save(); uiAt(sx, sy);
      cx.lineWidth = 4; cx.strokeStyle = 'rgba(39,57,74,0.5)'; cx.beginPath(); cx.arc(sx, sy, 11, 0, Math.PI * 2); cx.stroke();
      cx.lineWidth = 2.5; cx.strokeStyle = '#ffd27a';
      cx.beginPath(); cx.arc(sx, sy, 11, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); cx.stroke();
      if (p.action.ic && typeof Icons !== 'undefined') Icons.draw(cx, p.action.ic, sx, sy, 12, '#ebe6d3');   // что делается (крафт)
      cx.restore();
    }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlate();
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
      } else if (a.ph === 'play') {   // вываживание: прогресс до льда
        Icons.plate(cx, hx - 46, by - 6, 92, 26);
        Icons.draw(cx, 'fish', hx - 30, by + 7, 16, '#ebe6d3');
        rr(hx - 18, by + 3, 56, 8, 2, '#0d140f'); rr(hx - 18, by + 3, 56 * clamp(a.t / a.dur, 0, 1), 8, 2, '#8cc3e6');
      } else {
        Icons.plate(cx, hx - 26, by - 6, 52, 26);
        Icons.draw(cx, 'rod', hx - 10, by + 7, 16, '#ebe6d3');
        cx.fillStyle = '#ffd27a'; for (let i = 0; i < 1 + Math.floor(now * 2) % 3; i++) cx.fillRect(hx + 4 + i * 5, by + 10, 3, 3);
      }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    compR = null; if (!(typeof Talk !== 'undefined' && Talk.inWorld())) drawCompass(storm);   // в разговоре компас не заслоняет реплики
    // 11. иней и урон
    const fr = clamp((35 - G.s.warm) / 35, 0, 1);
    if (fr > 0) {
      const g = cx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.25, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
      g.addColorStop(0, 'rgba(221,230,238,0)'); g.addColorStop(1, `rgba(221,230,238,${fr * 0.8})`);
      cx.fillStyle = g; cx.fillRect(0, 0, vw, vh);
    }
    if (G.hurt > 0) { cx.fillStyle = `rgba(184,57,45,${G.hurt * 0.3})`; cx.fillRect(0, 0, vw, vh); }
    const dk = sleepDark(); if (dk > 0.01) { cx.fillStyle = `rgba(10,22,18,${dk.toFixed(3)})`; cx.fillRect(0, 0, vw, vh); }
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
    const S = zoom / 2, toX = x => (x - cam.x + shx) * S, toY = y => (y - cam.y + shy) * S, EY = SF ? 0.66 : 1; // C: зона света на земле — эллипс ¾
    const hutOn = roofA > 0.3 && Math.abs(HUT.x - (cam.x + vw / 2)) < vw + 400 && Math.abs(HUT.y - (cam.y + vh / 2)) < vh + 400;
    const occ = hutOn ? [toX(HUT_IN.x0 - WALL - 18), toY(HUT_IN.y0 - 160), toX(HUT_IN.x1 + WALL + 18), toY(HUT_IN.y1 + WALL - 2)] : null;
    for (const Lt of LIGHTS) {
      const img = LC ? LC[Lt.t] || LC.w : Lt.t === 'c' ? L_COOL : Lt.t === 'r' ? L_RED : Lt.t === 'f' ? L_FIRE : L_WARM, r = Lt.r / 2;
      const sx = toX(Lt.x), sy = toY(Lt.y), R = r * zoom;
      if (sx + R < 0 || sy + R < 0 || sx - R > lm.width || sy - R > lm.height) continue;
      lx.globalAlpha = Math.min(1, Lt.a * k);
      const behind = occ && Lt.y < HUT_IN.y1 + WALL - 12 && !insideHut(Lt.x, Lt.y) && sx + R > occ[0] && sx - R < occ[2] && sy + R > occ[1] && sy - R < occ[3];
      if (Lt.clip || behind) {
        lx.save(); lx.beginPath();
        if (Lt.clip) { const c = Lt.clip; lx.rect(toX(c.x0), toY(c.y0), (c.x1 - c.x0) * S, (c.y1 - c.y0) * S); }
        else { lx.rect(0, 0, lm.width, lm.height); lx.rect(occ[0], occ[1], occ[2] - occ[0], occ[3] - occ[1]); }
        lx.clip('evenodd'); lx.drawImage(img, sx - R, sy - R * EY, R * 2, R * 2 * EY); lx.restore();
      } else lx.drawImage(img, sx - R, sy - R * EY, R * 2, R * 2 * EY);
    }
    lx.globalAlpha = 1;
  }

  // плашка над героем (записка) или над вещью (осмотр): экранный размер на любом зуме, 1–3 строки с переносом, страницы — E
  const PLATE_W = 250, PLATE_L = 3;
  function wrapText(t, w) {
    const words = String(t).split(/\s+/), out = []; let cur = '';
    for (const wd of words) { const n = cur ? cur + ' ' + wd : wd; if (cx.measureText(n).width > w && cur) { out.push(cur); cur = wd; } else cur = n; }
    if (cur) out.push(cur); return out;
  }
  function drawPlate() {
    const pl = typeof Actions !== 'undefined' && Actions.plate; if (!pl || state !== 'play') return;
    const p = G.p, U = scrUI(), at = pl.at === 'p' ? { x: p.x, y: p.y - 48 } : pl.at;
    cx.font = '13px "PT Sans", sans-serif';
    if (!pl.lines) { pl.lines = wrapText(pl.t, PLATE_W - 34); pl.pages = Math.ceil(pl.lines.length / PLATE_L); }
    const L = pl.lines.slice(pl.page * PLATE_L, pl.page * PLATE_L + PLATE_L), lh = 17, h = 14 + L.length * lh + (pl.pages > 1 || pl.note ? 12 : 0);
    let w = 0; for (const l of L) w = Math.max(w, cx.measureText(l).width); w = Math.min(PLATE_W, w + 40);
    const W_ = rw / U, H_ = rh / U;
    let x = (at.x - cam.x) * zoom / U - w / 2, y = (at.y - cam.y) * zoom / U - h - 6;
    x = clamp(x, 8, W_ - w - 8); y = clamp(y, 60, H_ - h - 8);
    const a = clamp(pl.age / 0.18, 0, 1); cx.globalAlpha = a;
    Icons.plate(cx, x, y, w, h, 6);
    cx.fillStyle = '#2b3c33'; cx.beginPath(); const tx = clamp((at.x - cam.x) * zoom / U, x + 10, x + w - 10); cx.moveTo(tx - 6, y + h); cx.lineTo(tx + 6, y + h); cx.lineTo(tx, y + h + 6); cx.fill();   // хвостик к говорящему/вещи
    Icons.draw(cx, pl.ic || ':log:', x + 14, y + 16, 14, '#ffd27a');
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic'; cx.fillStyle = '#ebe6d3';
    L.forEach((l, i) => cx.fillText(l, x + 27, y + 21 + i * lh));
    if (pl.pages > 1 || pl.note) {
      cx.font = '10px "PT Mono", monospace'; cx.fillStyle = '#8fa39a'; cx.textAlign = 'right';
      cx.fillText((pl.pages > 1 ? `${pl.page + 1}/${pl.pages} · ` : '') + (UI.isTouch ? 'тап — дальше' : 'E — дальше'), x + w - 8, y + h - 5);
    }
    cx.globalAlpha = 1; cx.textAlign = 'left'; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // затемнение сна и «без сознания»: плавно гаснет при засыпании, плавно светлеет при пробуждении
  const DK = { sl: false, t: -9, v: 0 }, lerp = (a, b, k) => a + (b - a) * k;
  function sleepDark() {
    const p = G.p;
    if (p.sleeping !== DK.sl) { DK.sl = p.sleeping; DK.t = now; DK.v0 = DK.v; }
    let v = p.sleeping ? lerp(DK.v0 || 0, p.ko ? 1 : 0.62, clamp((now - DK.t) / 1.2, 0, 1)) : lerp(DK.v0 || 0, 0, clamp((now - DK.t) / 1.4, 0, 1));
    if (p.ko && !p.ko.ph) v = Math.max(v, clamp((p.ko.t - 1.3) / 1.2, 0, 1));
    DK.v = v; return v;
  }
  // масштаб интерфейса для канвас-оверлеев: setTransform(rdpr × ui), координаты — CSS px / ui
  function scrUI() { const U = (window.UI && UI.scale) || 1; cx.setTransform(rdpr * U, 0, 0, rdpr * U, 0, 0); return U; }
  // компас к цели: канвас-копия .plate, число золотом; экранные px × масштаб интерфейса (не зависит от зума)
  let compR = null;
  function drawCompass(storm) {
    const tg = UI.goalTarget();
    if (!tg || storm) return;
    const p = G.p, U = scrUI(), W_ = rw / U, H_ = rh / U, sx = (tg.x - cam.x) * zoom / U, sy = (tg.y - cam.y) * zoom / U;
    if (sx > 40 && sx < W_ - 40 && sy > 150 && sy < H_ - 90) {
      const bob = Math.sin(now * 4) * 3;
      Icons.draw(cx, 'pin', sx, sy - 34 + bob, 26, '#ffd27a', 'rgba(11,18,14,.85)'); compR = { x0: (sx - 16) * U, y0: (sy - 52) * U, x1: (sx + 16) * U, y1: (sy - 16) * U };
      cx.setTransform(dpr, 0, 0, dpr, 0, 0); return;
    }
    const a = Math.atan2(tg.y - p.y, tg.x - p.x), R = Math.min(W_ / 2 - 40, H_ / 2 - 90);
    const ex = W_ / 2 + Math.cos(a) * R, ey = H_ / 2 + Math.sin(a) * R + 20;
    compR = { x0: (ex - 32) * U, y0: (ey - 32) * U, x1: (ex + 32) * U, y1: (ey + 44) * U };   // место компаса — пузыри реплик его обходят (Talk.fit)
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
  // фото-текстура догрузилась после первой печи — перепечь куски и спрайты с ней (в low фото не используется — не трогаем)
  if (typeof Photo !== 'undefined') Photo.onLoad(() => { if (window.QUALITY === 'low') return; for (const k in SPR) delete SPR[k]; chunks.clear(); bakeQ = []; warm = true; if (typeof ArtWorld !== 'undefined') ArtWorld.reset(); });
  return {
    render, resize, screenToWorld, worldToScreen, toWorld: screenToWorld, setZoom, pan, lookAt, recenter, follow,
    zoomTo, zoomBy, uiK, get zoomTarget() { return zt; }, setFocus(f) { focus = f; }, get compassRect() { return compR; }, snapCam() { if (G && G.p) { const t = followTarget(); cam.x = t.x; cam.y = t.y; } }, get zmax() { return zmax(); }, get zstep() { return zb; },
    reset() { chunks.clear(); bakeQ = []; warm = true; roofA = 1; FALL.length = 0; HELI.on = false; Live.reset(); if (G && G.seed != null) FX.weather.seed(G.seed); recenter(); },
    get vw() { return vw; }, get vh() { return vh; }, get zoom() { return zoom; }, get free() { return camMode === 'free'; }, get mode() { return camMode; },
    // для замеров (tests): сколько кусков в очереди печи
    get bakeQueue() { return bakeQ.length; }, bakeMax(reset) { const v = bakeMax; if (reset) bakeMax = 0; return v; },
    dropChunks() { chunks.clear(); bakeQ = []; },
    tjit, fallPose,   // размер ели ±7 % (длина ствола = видимой ели); поза валки — для проверок (tests/tree-check.js)
    // память кэшей (замеры): куски снега по ступеням + спрайты ArtWorld
    stats() {
      const by = {}; for (const e of chunks.values()) { const k = e.s + '/' + e.cs; by[k] = (by[k] || 0) + 1; }
      return { zoom, zb, chunks: chunks.size, chunkMB: +(chunkBytes / 1048576).toFixed(1), chunkBy: by, queue: bakeQ.length, art: ArtWorld.stats() };
    }, // замер подгрузки: забыть куски без синхронной печи
  };
})();
