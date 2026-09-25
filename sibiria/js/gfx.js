'use strict';
// Рендер: кэш спрайтов, снег кусками, карта освещения, сияние, частицы.
const GFX = (() => {
  const cv = $('game'), cx = cv.getContext('2d');
  const lm = document.createElement('canvas'), lx = lm.getContext('2d');
  const au = document.createElement('canvas'), ax = au.getContext('2d');
  // Масштаб камеры: dpr = растровый dpr × зум, vw/vh — видимая часть мира в мировых пикселях.
  // Весь код рендера, который ставит setTransform(dpr…) и считает от vw/vh, так автоматически зумится.
  let vw = 0, vh = 0, dpr = 1, rdpr = 1, rw = 0, rh = 0, zoom = 1, frame = 0, shx = 0, shy = 0, roofA = 1;
  const chunks = new Map(), TREE = {}, SPR = {};
  let LIGHTS = [], EYES = [], rdt = 0; // rdt — dt текущего кадра рендера (темп «косметических» спавнов)
  const ENV = { now: 0, night: 0, wind: 1, light: (x, y, r, t = 'w', a = 1) => LIGHTS.push({ x, y, r, t, a }), spark: (x, y, a = 0.6) => EYES.push({ x, y, spark: a }), glow: (x, y, k = 1) => EYES.push({ x, y, glow: k }), eye: (x, y, f, kind) => EYES.push({ x, y, f, red: kind === 'wolfRed', bear: kind === 'bear' }) };
  const ZMIN = 0.6, ZMAX = 1.6;
  // камера: 'follow' — lerp к герою; 'free' — стоит, где поставил игрок; 'return' — плавный возврат к герою
  let camMode = 'follow', ret = null, crect = { left: 0, top: 0 };

  function applyZoom() { dpr = rdpr * zoom; vw = rw / zoom; vh = rh / zoom; }
  function resize() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const nd = window.QUALITY === 'low' ? 1 : Math.min(coarse ? 1.5 : 2, window.devicePixelRatio || 1);
    rw = innerWidth; rh = innerHeight;
    cv.width = Math.round(rw * nd); cv.height = Math.round(rh * nd);
    lm.width = Math.ceil(rw / 2); lm.height = Math.ceil(rh / 2);
    au.width = Math.ceil(rw / 4); au.height = Math.ceil(rh * 0.5 / 4);
    if (nd !== rdpr) { for (const k in TREE) delete TREE[k]; for (const k in SPR) delete SPR[k]; if (window.ArtWorld) ArtWorld.reset(); }
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

  function sprite(w, h, draw, scale = rdpr) {
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
  // «косметика» рендера (шум, снег на экране, дым чума, дрожь) — свой поток случайности, Math.random игры не тратит
  const CR = ArtWorld.rng(0xC05E), crnd = (a, b) => a + CR() * (b - a);
  const NOISE = sprite(32, 32, g => { for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) { const v = CR() * 255 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i, j, 1, 1); } }, 1);
  // Свет в карте освещения кладётся режимом 'screen' (без насыщения каналов), поэтому спад — плавный
  // «гаусс» одного оттенка: смена оттенка к краю + клиппинг каналов при 'lighter' давали радужные кольца.
  const bell = (rgb, a0, n = 9) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, k = Math.exp(-t * t * 4.2) * (1 - t * t); return [t, `rgba(${rgb},${(a0 * k).toFixed(3)})`]; });
  const L_WARM = radial(256, bell('255,178,108', 0.95));
  const L_COOL = radial(256, bell('165,188,240', 0.8));
  const L_RED = radial(128, [[0, 'rgba(255,90,70,1)'], [1, 'rgba(0,0,0,0)']]);
  const GLOW = radial(128, [[0, 'rgba(255,140,50,0.7)'], [0.4, 'rgba(255,110,30,0.25)'], [1, 'rgba(0,0,0,0)']]);
  const PUFF = radial(32, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  const SHADOW = radial(64, [[0, 'rgba(60,80,130,1)'], [0.55, 'rgba(60,80,130,0.8)'], [1, 'rgba(60,80,130,0)']]);
  const strip = (c1, c2) => sprite(1, 64, g => {
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.15, c1); gr.addColorStop(0.55, c2); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1, 64);
  }, 1);
  const BANDS = [[strip('rgba(61,255,156,0.9)', 'rgba(31,209,165,0.35)'), 0, 0.34], [strip('rgba(31,209,165,0.8)', 'rgba(139,92,246,0.35)'), 1.7, 0.26], [strip('rgba(255,79,139,0.5)', 'rgba(139,92,246,0.4)'), 3.1, 0.18]];

  // ---------- деревья ----------
  const TS = [0.8, 0.95, 1.1, 1.25, 1.4];
  function treeSprite(t) {
    const si = clamp(Math.round((t.s - 0.8) / 0.15), 0, 4), k = `${t.kind}${t.wall | 0}${si}${t.v | 0}`;
    const tw = ArtWorld.treeW(t.kind);
    return TREE[k] || (TREE[k] = sprite(tw, 170, g => {
      g.translate(tw / 2, 160); const s = TS[si];
      if (t.kind === 1) ArtWorld.paintBirch(g, s, t.v); else if (t.kind === 2) ArtWorld.paintCedar(g, s, t.v); else ArtWorld.paintSpruce(g, s, t.wall, t.v);
    }));
  }

  // ---------- снег кусками ----------
  let chunkCap = 36;
  function chunk(ix, iy) {
    const k = ix + ',' + iy; let c = chunks.get(k);
    if (c) { chunks.delete(k); chunks.set(k, c); return c; }
    c = sprite(512, 512, g => {
      g.fillStyle = '#e9f0f5'; g.fillRect(0, 0, 512, 512);
      const r = mulberry(ix * 7919 + iy * 104729 + G.seed);
      for (let i = 0; i < 1200; i++) { const a = r(); g.fillStyle = a < 0.5 ? 'rgba(150,175,205,0.12)' : 'rgba(255,255,255,0.6)'; g.fillRect(r() * 512, r() * 512, 1 + a * 2, 1); }
      g.strokeStyle = 'rgba(160,185,215,0.22)'; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i < 26; i++) { const x = r() * 512, y = r() * 512, L = 20 + r() * 40; g.moveTo(x, y); g.quadraticCurveTo(x + L / 2, y - 4, x + L, y + 1); }
      g.stroke();
      g.translate(-ix * 512, -iy * 512); bakeStatic(g, ix * 512, iy * 512);
    }, 1);
    chunks.set(k, c); if (chunks.size > chunkCap) chunks.delete(chunks.keys().next().value);
    return c;
  }
  function bakeStatic(g, X, Y) {
    const inR = (x, y, m) => x > X - m && x < X + 512 + m && y > Y - m && y < Y + 512 + m;
    // кедрач — чуть синее
    if (inR(POI.cedar.x, POI.cedar.y, POI.cedar.r)) {
      const gr = g.createRadialGradient(POI.cedar.x, POI.cedar.y, 0, POI.cedar.x, POI.cedar.y, POI.cedar.r);
      gr.addColorStop(0, 'rgba(150,175,210,0.18)'); gr.addColorStop(1, 'rgba(150,175,210,0)');
      g.fillStyle = gr; g.fillRect(X, Y, 512, 512);
    }
    // марь
    if (inR(POI.mar.x, POI.mar.y, POI.mar.r)) {
      const gr = g.createRadialGradient(POI.mar.x, POI.mar.y, 0, POI.mar.x, POI.mar.y, POI.mar.r);
      gr.addColorStop(0, 'rgba(170,160,140,0.22)'); gr.addColorStop(1, 'rgba(170,160,140,0)');
      g.fillStyle = gr; g.fillRect(X, Y, 512, 512);
      for (const t of G.tussocks) if (inR(t.x, t.y, 20)) {
        g.fillStyle = 'rgba(120,110,90,0.55)'; g.beginPath(); g.ellipse(t.x, t.y, 7 * t.s, 3 * t.s, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(140,120,80,0.8)'; g.lineWidth = 1; g.beginPath();
        for (let i = -2; i <= 2; i++) { g.moveTo(t.x + i * 2, t.y); g.lineTo(t.x + i * 3.5 * t.s, t.y - 9 * t.s); }
        g.stroke();
        g.fillStyle = '#f7fafc'; g.beginPath(); g.ellipse(t.x - 1, t.y - 2, 6 * t.s, 2.5 * t.s, 0, 0, Math.PI * 2); g.fill();
      }
    }
    for (const d of G.drifts) if (inR(d.x, d.y, d.rx + 10)) {
      g.fillStyle = 'rgba(165,190,218,0.3)'; g.beginPath(); g.ellipse(d.x, d.y, d.rx, d.ry, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(d.x - d.rx * 0.15, d.y - d.ry * 0.35, d.rx * 0.8, d.ry * 0.5, 0, 0, Math.PI * 2); g.fill();
    }
    // река
    const y0 = Y - 40, y1 = Y + 552;
    if (Math.abs(riverX(Y + 256) - (X + 256)) < 560) {
      g.beginPath();
      for (let y = y0; y <= y1; y += 16) g.lineTo(riverX(y) - RW, y);
      for (let y = y1; y >= y0; y -= 16) g.lineTo(riverX(y) + RW, y);
      g.closePath();
      g.fillStyle = '#b6d3e5'; g.fill();
      g.save(); g.clip();
      g.globalAlpha = 0.18; g.drawImage(NOISE, X, Y, 512, 512); g.globalAlpha = 1;
      for (let y = y0; y < y1; y += 60) { g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(riverX(y) + Math.sin(y) * 30, y, 40, 10, 0.3, 0, Math.PI * 2); g.fill(); }
      g.restore();
      g.strokeStyle = '#f6fafc'; g.lineWidth = 8; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.2;
      for (const c of G.cracks) if (c.y > y0 && c.y < y1) {
        const x = riverX(c.y) + c.off; g.beginPath(); g.moveTo(x, c.y); g.lineTo(x + Math.cos(c.a) * c.len, c.y + Math.sin(c.a) * c.len * 0.4); g.stroke();
      }
      // перекат — тонкий лёд темнее
      const P = POI.polynya;
      if (inR(P.x, P.y, P.r)) {
        g.fillStyle = 'rgba(80,130,165,0.35)'; g.beginPath(); g.ellipse(P.x, P.y, P.r - 20, 50, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
        for (let i = 0; i < 14; i++) { const a = i / 14 * 6.28; g.beginPath(); g.moveTo(P.x + Math.cos(a) * 30, P.y + Math.sin(a) * 14); g.lineTo(P.x + Math.cos(a + 0.2) * 80, P.y + Math.sin(a + 0.2) * 40); g.stroke(); }
      }
    }
  }

  // ---------- примитивы ----------
  function ell(x, y, rx, ry, col, rot = 0) { cx.fillStyle = col; cx.beginPath(); cx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); cx.fill(); }
  function rr(x, y, w, h, r, col) { cx.fillStyle = col; cx.beginPath(); cx.roundRect(x, y, w, h, r); cx.fill(); }
  const WT = () => cx.setTransform(dpr, 0, 0, dpr, (-cam.x + shx) * dpr, (-cam.y + shy) * dpr);
  const light = (x, y, r, t = 'w', a = 1) => LIGHTS.push({ x, y, r, t, a });

  // ---------- объекты ----------
  function drawStump(t) {
    const x = t.x, y = t.y, s = t.s;
    ell(x, y - 2, 10 * s, 5 * s, '#5a3e2b'); ell(x, y - 3, 7 * s, 3.5 * s, '#a47b52'); ell(x - 2, y - 5, 6 * s, 2.5 * s, '#f2f6f9');
  }
  function drawTree(t, wind) {
    if (t.wood <= 0) return drawStump(t);
    const sway = wind * 0.05 * (0.6 + 0.4 * Math.sin(now * 1.7 + t.x * 0.013)) + (t.shake > 0 ? Math.sin(now * 60) * t.shake * 0.25 : 0);
    cx.setTransform(dpr, 0, -sway * dpr, dpr, (t.x - cam.x + shx) * dpr, (t.y - cam.y + shy) * dpr);
    const tw = ArtWorld.treeW(t.kind); cx.drawImage(treeSprite(t), -tw / 2, -160, tw, 170);
    WT();
  }
  const MI8 = () => SPR.mi8 || (SPR.mi8 = sprite(320, 210, g => { g.translate(160, 140); ArtWorld.paintMi8(g); }));
  const TAIL = () => SPR.tail || (SPR.tail = sprite(220, 140, g => { g.translate(110, 100); ArtWorld.paintTail(g); }));
  const CHUM = () => SPR.chum || (SPR.chum = sprite(130, 140, g => { g.translate(65, 120); ArtWorld.paintChum(g); }));
  const LABAZ = () => SPR.labaz || (SPR.labaz = sprite(80, 90, g => { g.translate(40, 80); ArtWorld.paintLabaz(g); }));

  function drawWreck() {
    const c = POI.cockpit; cx.drawImage(MI8(), c.x - 160, c.y - 140, 320, 210);
  }
  function drawTailObj() { const t = POI.tail; cx.drawImage(TAIL(), t.x - 110, t.y - 100, 220, 140); }
  function drawChum() {
    const c = POI.chum; cx.drawImage(CHUM(), c.x - 65, c.y - 120, 130, 140);
    light(c.x, c.y - 10, 90, 'w', 0.6);
    // темп от dt (3/с), а не от кадра: при 30 и 120 FPS дыма столько же
    if (state === 'play' && !UI.modal() && CR() < rdt * 3) G.parts.push({ type: 'smoke', x: c.x, y: c.y - 110, vx: crnd(-5, 5) + (stormOn() ? 80 : 12), vy: crnd(-30, -20), life: 3, max: 3 });
  }
  function drawDeer(d) {
    ArtAnimals.deer(cx, d, ENV);
    if (ArtAnimals.bellHit && ArtAnimals.bellHit(d) && dist2(d, G.p) < 320 * 320 && state === 'play') Sound.tone('sine', 2400 + (d.ph || 0) * 60, 2350, 0.25, 0.03);
  }
  function drawSled(x, y, load) {
    cx.strokeStyle = '#6b4a2e'; cx.lineWidth = 2.5; cx.beginPath();
    cx.moveTo(x - 22, y); cx.lineTo(x + 20, y); cx.quadraticCurveTo(x + 27, y, x + 26, y - 5);
    cx.moveTo(x - 22, y - 7); cx.lineTo(x + 18, y - 7); cx.stroke();
    cx.fillStyle = '#8a6a45'; for (let i = -18; i <= 14; i += 8) cx.fillRect(x + i, y - 8, 3, 8);
    for (let i = 0; i < Math.min(load, 6); i++) ell(x - 12 + (i % 3) * 10, y - 11 - ((i / 3) | 0) * 5, 5, 3, '#7a5536');
  }

  // ---------- изба: модели из art-world.js, здесь — только состояние ----------
  const hutH = () => ({ x: HUT.x, y: HUT.y, in: HUT_IN, wall: WALL, doorW: DOOR_W, walls: G.hut.walls, door: G.hut.door, bench: G.hut.bench, damper: G.hut.damper,
    radio: G.flags.radioBuilt, fuel: G.hut.fuel, open: dist2(G.p, { x: HUT.x, y: HUT_IN.y1 + WALL - 6 }) < 40 * 40, cut: 1 - roofA });
  function drawHutFloor() { ArtWorld.hutFloor(cx, hutH()); }
  function drawNorthWall() { ArtWorld.hutNorth(cx, hutH()); }
  function drawStove() {
    const s = SPOT.stove;
    ArtWorld.hutStove(cx, s.x, s.y, { fuel: G.hut.fuel, damper: G.hut.damper, pipeTop: HUT.y - 150, lightK: 1 - roofA }, ENV);
    if (G.charge > 0 && !G.flags.radioBuilt && (G.chest.battery || (G.p.inside && G.inv.battery))) {
      rr(s.x + 22, s.y - 16, 16, 12, 2, '#3d4b3a'); cx.fillStyle = '#9fe36b'; cx.fillRect(s.x + 24, s.y - 8, 12 * G.charge / 100, 2);
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

  // ---------- люди: суставные модели из art-people.js ----------
  const LK = ArtPeople.LOOKS;
  const HERO_HAT = { anorak: Object.assign({}, LK.anorak, { hat: '#6b5440', hatType: 'ushanka' }), dokha: Object.assign({}, LK.dokha, { hat: '#6b5440', hatType: 'ushanka' }) };
  function heroLook() {
    if (G.gear.kukhl) return LK.kukhl;
    const k = G.gear.dokha ? 'dokha' : 'anorak';
    return G.gear.hat ? HERO_HAT[k] : LK[k];
  }
  function drawPlayer() {
    const p = G.p, a = p.action, D = ArtPeople.DUR;
    let anim = 'idle', animT = 0, tool = G.gear.saw ? 'saw' : 'axe', target = null;
    if (p.sleeping) anim = 'sleep';
    else if (a) {
      if (a.k === 'chop' || a.k === 'wreck') { anim = 'chop'; animT = (a.t % D.chop) / D.chop; if (a.k === 'wreck') tool = 'axe'; }
      else if (a.k === 'dig') { anim = 'dig'; animT = (a.t % D.dig) / D.dig; }
      else if (a.k === 'fish') { anim = a.ph === 'bite' ? 'fishBite' : 'fish'; animT = clamp(a.t / a.dur, 0, 1); tool = 'rod'; target = { x: a.o.x, y: a.o.y }; }
      else { anim = 'build'; animT = (a.t % D.build) / D.build; }
    } else if (p.swing > 0) { anim = 'swing'; animT = 1 - p.swing / 0.25; }
    else if (G.hurt > 0.7) { anim = 'hurt'; animT = 1 - (G.hurt - 0.7) / 0.3; }
    else if (p.moving) anim = Math.hypot(p.vx || 0, p.vy || 0) > 185 ? 'run' : 'walk';
    if (p.torch > 0 && !a && p.swing <= 0 && anim !== 'sleep') tool = 'torch';
    const x = p.sleeping ? p.x - 4 : p.x;
    ArtPeople.draw(cx, { x, y: p.y, face: p.face, vy: p.moving ? input.my : 0, speed: clamp(Math.hypot(p.vx || 0, p.vy || 0) / 200, 0, 1), t: now, phase: p.step,
      anim, animT, look: heroLook(), tool, target, frost: clamp((30 - G.s.warm) / 30, 0, 1), wet: p.wetT > 0, blink: p.iT > 0, seed: 1 }, ENV);
    if (p.torch > 0 && tool === 'torch') light(p.x + p.face * 14, p.y - 38, 240, 'w', 0.9);
    if (!p.inside) light(p.x, p.y - 16, 150, 'c', 0.55);
  }
  function drawUrk() {
    const u = G.urk, moving = u.state === 'walk';
    const talking = UI.modal() && dist2(u, G.p) < 90 * 90;
    ArtPeople.draw(cx, { x: u.x, y: u.y, face: u.face, t: now, phase: u.step, speed: 0.35, anim: moving ? 'walk' : talking ? 'talk' : 'idle', look: LK.urk, tool: 'none', seed: 3 }, ENV);
    if (dist2(u, G.p) < 160 * 160 && !talking) mark('talk', u.x, u.y - 60 + Math.sin(now * 3) * 2);
    if (!G.p.inside && CR() < rdt * 1.2) breath(u.x + u.face * 6, u.y - 34, u.face, -40);
  }
  function drawVera() {
    const v = G.vera; if (v.state === 'dead') return;
    const anim = v.state === 'follow' ? (G.p.moving ? 'limp' : 'idle') : 'sit';
    ArtPeople.draw(cx, { x: v.x, y: v.y, face: v.face, t: now, phase: v.step, speed: 0.3, anim, look: LK.vera, tool: 'none', seed: 5 }, ENV);
    if (v.state === 'tail' || (v.state === 'hut' && v.food <= 0)) mark(v.food <= 0 && v.state === 'hut' ? 'food' : 'alarm', v.x, v.y - 56 + Math.sin(now * 3) * 2);
  }
  function drawHare(h) { ArtAnimals.hare(cx, h, ENV); }
  function drawWolf(w) { ArtAnimals.wolf(cx, w, ENV); }
  function drawBear(b) { ArtAnimals.bear(cx, b, ENV); }
  function drawFire(f) { ArtWorld.fire(cx, f, ENV); if (f.fuel > 0) light(f.x, f.y - 10, (110 + Math.min(f.fuel, 120) * 1.3) * (1 + Math.sin(now * 11 + f.x) * 0.03), 'w', 1); }
  function drawStack(s) {
    ArtWorld.stack(cx, s, ENV);
    if (s.lit > 0) light(s.x, s.y - 20, 380, 'w', 1);
    else { cx.font = '11px "PT Mono", monospace'; cx.textAlign = 'center'; cx.fillStyle = '#35475a'; cx.fillText(`${s.wood}/4`, s.x, s.y + 16); }
  }
  function drawNote(id) {
    const n = NOTES[id];
    if (id === 'labaz' && G.labaz) return;
    cx.save(); cx.translate(n.x, n.y); cx.rotate(-0.2);
    rr(-7, -9, 14, 11, 1, G.notes[id] ? '#d9d2bf' : '#f3ecd9'); cx.fillStyle = '#9a8f7a'; cx.fillRect(-4, -6, 8, 1); cx.fillRect(-4, -3, 6, 1);
    cx.restore();
    if (!G.notes[id]) { const a = 0.5 + Math.sin(now * 4 + n.x) * 0.5; cx.globalAlpha = a; ell(n.x + 6, n.y - 10, 2, 2, '#ffffff'); cx.globalAlpha = 1; EYES.push({ x: n.x + 6, y: n.y - 10, spark: a }); }
  }
  function drawTrap(t) {
    const x = t.x, y = t.y;
    if (t.kind === 'trap') {
      cx.strokeStyle = '#5a5e63'; cx.lineWidth = 2;
      cx.beginPath(); if (t.catch) { cx.moveTo(x - 8, y); cx.lineTo(x + 8, y); } else { cx.arc(x, y, 7, Math.PI, 0); cx.moveTo(x + 7, y); cx.arc(x, y, 7, 0, Math.PI); } cx.stroke();
      cx.beginPath(); cx.moveTo(x + 8, y); cx.lineTo(x + 16, y + 4); cx.stroke();
    } else { cx.strokeStyle = '#8a7a5a'; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(x, y - 4, 6, 0, Math.PI * 2); cx.moveTo(x, y + 2); cx.lineTo(x, y - 10); cx.stroke(); }
    if (t.catch === 'hare') ell(x, y - 5, 7, 4, '#fbfdff');
    else if (t.catch === 'sable') ell(x, y - 5, 8, 3.5, '#4b3527');
    else if (t.catch === 'wpelt') ell(x, y - 5, 10, 4, '#737a84');
    if (t.catch) mark('paw', x, y - 20, 13);
  }
  // значок над объектом в мире: круглая жестяная плашка + иконка из спрайта
  function mark(id, x, y, px = 16, col = '#ffd27a') {
    cx.fillStyle = 'rgba(17,26,21,.84)'; cx.strokeStyle = '#4d6456'; cx.lineWidth = 1.2;
    cx.beginPath(); cx.arc(x, y, px * 0.72, 0, Math.PI * 2); cx.fill(); cx.stroke();
    Icons.draw(cx, id, x, y, px * 0.86, col);
  }
  function drawGround() {
    // избяной пол
    drawHutFloor();
    // проруби и полынья
    const P = POI.polynya;
    ell(P.x + 10, P.y + 4, 30, 12, '#0f2a3a'); ell(P.x + 10, P.y + 3, 26, 9, '#1d4d66');
    cx.strokeStyle = '#f2f8fc'; cx.lineWidth = 3; cx.beginPath(); cx.ellipse(P.x + 10, P.y + 4, 31, 13, 0, 0, Math.PI * 2); cx.stroke();
    if (!G.flags.tube) { ell(TUBE_POS.x, TUBE_POS.y, 3, 4.5, '#e8f4ff'); EYES.push({ x: TUBE_POS.x, y: TUBE_POS.y - 2, spark: 0.5 + Math.sin(now * 5) * 0.5 }); }
    for (const h of G.holes) { ell(h.x, h.y, 11, 5, '#1f4b66'); ell(h.x, h.y - 1, 8, 3, '#2d6a8c'); cx.strokeStyle = '#f2f8fc'; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(h.x, h.y, 12, 6, 0, 0, Math.PI * 2); cx.stroke(); }
    // пятна и следы
    for (const d of G.decals || []) if (d.x > cam.x - 60 && d.x < cam.x + vw + 60 && d.y > cam.y - 60 && d.y < cam.y + vh + 60) ArtWorld.decal(cx, d);
    for (const f of G.prints) {
      if (f.x < cam.x - 40 || f.x > cam.x + vw + 40 || f.y < cam.y - 40 || f.y > cam.y + vh + 40) continue;
      ArtWorld.print(cx, f);
    }
    for (const c of G.corpses || []) if (c.x > cam.x - 80 && c.x < cam.x + vw + 80 && c.y > cam.y - 60 && c.y < cam.y + vh + 60) ArtAnimals.corpse(cx, c.kind, c.x, c.y, G.time - c.t0);
    for (const t of G.traps) drawTrap(t);
    for (const id in NOTES) drawNote(id);
  }

  function drawShadows(sunA, sunL, alpha) {
    if (alpha < 0.02) return;
    cx.globalAlpha = alpha;
    const cast = (x, y, len, w, k = 1) => {
      if (k !== 1) cx.globalAlpha = Math.min(1, alpha * k);
      cx.save(); cx.translate(x, y); cx.rotate(sunA); cx.drawImage(SHADOW, -w * 0.3, -w / 2, len + w * 0.3, w); cx.restore();
      if (k !== 1) cx.globalAlpha = alpha;
    };
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 200)) if (t.wood > 0) cast(t.x, t.y, 44 * t.s * sunL, 22 * t.s);
    cast(HUT.x, HUT.y - 20, 70 * sunL, 150);
    cast(POI.cockpit.x, POI.cockpit.y, 30 * sunL, 110);
    cast(POI.chum.x, POI.chum.y, 56 * sunL, 64);
    cast(POI.labaz.x, POI.labaz.y, 32 * sunL, 40);
    cast(G.p.x, G.p.y, 16 * sunL, 14);
    const near = (x, y, m) => x > cam.x - m && x < cam.x + vw + m && y > cam.y - m && y < cam.y + vh + m;
    if (G.urk.state !== 'away' && near(G.urk.x, G.urk.y, 200)) cast(G.urk.x, G.urk.y, 16 * sunL, 14);
    if (G.vera.state !== 'dead' && !insideHut(G.vera.x, G.vera.y) && near(G.vera.x, G.vera.y, 200)) cast(G.vera.x, G.vera.y, 16 * sunL, 14);
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

  // ---------- посёлок ----------
  function drawBuilding(b) {
    b.stockWood = G.chest.wood || 0;
    ArtWorld.building(cx, b, ENV);
  }
  function drawDog(u) { u.bark = now < (u.barkUntil || 0); ArtAnimals.dog(cx, u, ENV); }
  function drawUnit(u) {
    const sel = G.col.sel.includes(u.id), T = UNITS[u.type], mh = T.hp + Colony.mod('hp');
    const moved = u._lx !== undefined && Math.hypot(u.x - u._lx, u.y - u._ly) > 0.3; u._lx = u.x; u._ly = u.y;
    if (u.type === 'laika') {
      if (sel) { cx.strokeStyle = '#ffd27a'; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(u.x, u.y, 15, 6, 0, 0, Math.PI * 2); cx.stroke(); }
      drawDog(u);
      if (u.hp < mh) { rr(u.x - 12, u.y + 5, 24, 3, 1, 'rgba(10,20,30,0.6)'); rr(u.x - 12, u.y + 5, 24 * u.hp / mh, 3, 1, u.hp / mh > 0.4 ? '#9fe36b' : '#e25a4f'); }
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
    ArtPeople.draw(cx, { x: u.x, y: u.y, face: u.face, t: now, phase: u.step, speed: clamp(T.sp / 160, 0.2, 1), anim, animT, look: LK[u.type], tool, target,
      carry: c ? ITEMS[c].i : null, sel, hp: u.hp < mh ? u.hp / mh : null, seed: u.id }, ENV);
  }
  function drawAmulet(a) {
    const x = a.x, y = a.y; ell(x, y + 1, 6, 2.5, 'rgba(60,80,130,0.3)');
    rr(x - 3, y - 18, 6, 18, 2, '#8a6a45'); ell(x, y - 20, 4, 4, '#8a6a45');
    cx.fillStyle = '#3a2a1c'; cx.fillRect(x - 2, y - 21, 1.2, 1.2); cx.fillRect(x + 1, y - 21, 1.2, 1.2); cx.fillRect(x - 2, y - 12, 4, 1);
    cx.fillStyle = '#c0392b'; cx.fillRect(x - 3, y - 8, 6, 1.5);
    EYES.push({ x, y: y - 22, spark: 0.4 + Math.sin(now * 3 + x) * 0.4 });
  }
  function drawInspect(q) {
    const x = q.x, y = q.y;
    ell(x, y + 1, 12, 4, 'rgba(60,80,130,0.25)');
    if (q.id === 'sign') { cx.fillStyle = '#5b3d27'; cx.fillRect(x - 2, y - 28, 4, 28); rr(x - 18, y - 36, 36, 14, 2, '#8a6a45'); cx.fillStyle = '#e9dfc7'; cx.fillRect(x - 14, y - 31, 28, 2); cx.fillRect(x - 14, y - 27, 20, 2); }
    else if (q.id === 'pennant') { cx.fillStyle = '#3a3d40'; cx.fillRect(x - 1, y - 34, 2, 34); cx.fillStyle = '#c0392b'; cx.beginPath(); cx.moveTo(x + 1, y - 34); cx.lineTo(x + 16, y - 28 + Math.sin(now * 3) * 2); cx.lineTo(x + 1, y - 22); cx.fill(); }
    else if (q.id === 'barrel') { rr(x - 8, y - 20, 16, 20, 4, '#2f5a3a'); cx.fillStyle = '#244a2e'; cx.fillRect(x - 8, y - 14, 16, 2); cx.fillRect(x - 8, y - 7, 16, 2); ell(x, y - 20, 8, 3, '#f2f6f9'); }
    else if (q.id === 'buran') { rr(x - 20, y - 14, 34, 12, 4, '#c0392b'); rr(x + 6, y - 22, 10, 9, 2, '#2a3a48'); cx.fillStyle = '#3a3d40'; cx.fillRect(x - 22, y - 2, 44, 3); ell(x - 6, y - 15, 14, 3, '#f2f6f9'); }
    else if (q.id === 'lenin') { rr(x - 9, y - 16, 18, 16, 2, '#8d9095'); ell(x, y - 24, 8, 9, '#a0a4a9'); ell(x, y - 31, 10, 4, '#6b5440'); ell(x - 9, y - 26, 3, 5, '#6b5440'); ell(x + 9, y - 26, 3, 5, '#6b5440'); }
    else if (q.id === 'pole') { cx.fillStyle = '#4a3426'; cx.fillRect(x - 3, y - 110, 6, 110); cx.fillRect(x - 22, y - 100, 44, 4); cx.fillStyle = '#f2f6f9'; cx.fillRect(x - 22, y - 103, 44, 3); }
  }
  function drawRavens() {
    for (const rv of G.ravens) {
      if (rv.x < cam.x - 60 || rv.x > cam.x + vw + 60 || rv.y - rv.z < cam.y - 60 || rv.y > cam.y + vh + 160) continue;
      ArtAnimals.raven(cx, rv, ENV);
    }
  }
  function drawColonyOverlay() {
    const C = G.col;
    for (const q of C.proj) { const x = q.x + (q.tx - q.x) * q.t, y = q.y + (q.ty - q.y) * q.t - Math.sin(q.t * Math.PI) * 18; cx.strokeStyle = '#3a2a1c'; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x - (q.tx - q.x) * 0.06, y - (q.ty - q.y) * 0.06); cx.stroke(); }
    if (C.mark) { cx.strokeStyle = `rgba(255,210,122,${C.mark.t})`; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(C.mark.x, C.mark.y, 18 * (1.5 - C.mark.t), 8 * (1.5 - C.mark.t), 0, 0, Math.PI * 2); cx.stroke(); }
    if (C.ghost && typeof Input !== 'undefined') Input.sync(); // призрак — под курсором при текущей камере
    if (C.ghost) {
      const g = C.ghost, B = BUILDS[g.type], ok = Colony.canPlace(g.type, g.x, g.y);
      cx.globalAlpha = 0.55; drawBuilding({ type: g.type, x: g.x, y: g.y, done: 1, fuel: 0 }); cx.globalAlpha = 1;
      cx.strokeStyle = ok ? '#9fe36b' : '#e25a4f'; cx.lineWidth = 2; cx.setLineDash([6, 4]);
      cx.strokeRect(g.x - B.w / 2, g.y - B.h / 2, B.w, B.h); cx.setLineDash([]);
    }
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

  // ---------- снег на экране ----------
  const flakes = Array.from({ length: 460 }, () => ({ x: CR(), y: CR(), z: CR(), ph: CR() * 6 }));
  const streaks = Array.from({ length: 200 }, () => ({ x: CR(), y: CR(), l: 20 + CR() * 40, z: CR() }));
  let lastCam = { x: 0, y: 0 };

  // ---------- главный рендер ----------
  function render(dt, ctxTarget) {
    frame++; rdt = dt;
    const p = G.p;
    if (state === 'menu') { cam.x = HUT.x - vw / 2 + Math.sin(now * 0.1) * 40; cam.y = HUT.y - vh / 2 + 40; }
    else {
      // герой пошёл — камера плавно возвращается к нему
      if (state === 'play' && (G.hurt || 0) > 0.95) recenter(); // укусили — показать героя
      camStep(dt);
    }
    const camDX = cam.x - lastCam.x, camDY = cam.y - lastCam.y; lastCam = { x: cam.x, y: cam.y };
    const h = state === 'menu' ? 20.3 : hourOf(), d = daylight(h), night = 1 - d, storm = state === 'play' && stormOn();
    const wind = storm ? 4 : 1;
    shx = G.shake ? crnd(-G.shake, G.shake) : 0; shy = G.shake ? crnd(-G.shake, G.shake) : 0;
    LIGHTS = []; EYES = [];
    ENV.now = now; ENV.night = night; ENV.wind = wind;

    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = '#10211b'; cx.fillRect(0, 0, cv.width, cv.height);
    WT();
    // 1. снег
    const ix0 = Math.max(0, Math.floor(cam.x / 512)), ix1 = Math.min(Math.ceil(W / 512) - 1, Math.floor((cam.x + vw) / 512));
    const iy0 = Math.max(0, Math.floor(cam.y / 512)), iy1 = Math.min(Math.ceil(H / 512) - 1, Math.floor((cam.y + vh) / 512));
    chunkCap = Math.max(36, (ix1 - ix0 + 2) * (iy1 - iy0 + 2) + 4);
    for (let i = ix0; i <= ix1; i++) for (let j = iy0; j <= iy1; j++) cx.drawImage(chunk(i, j), i * 512, j * 512, 513, 513);
    // 2. земля
    drawGround();
    const sunA = h > 5 && h < 20 ? -Math.PI / 2 - (12 - h) * 0.2 : -2.1;
    const sunL = h > 5 && h < 20 ? 1.2 + Math.abs(12 - h) * 0.5 : 1.6;
    drawShadows(sunA, sunL, storm ? 0.05 : d * 0.3 + night * 0.08);
    // 3. объекты по y
    const x0 = cam.x - 120, x1 = cam.x + vw + 120, y0 = cam.y - 40, y1 = cam.y + vh + 180;
    const L = [];
    const vis = (x, y) => x > x0 && x < x1 && y > y0 && y < y1;
    for (const t of treesNear(cam.x + vw / 2, cam.y + vh / 2, Math.max(vw, vh) / 2 + 220)) if (vis(t.x, t.y)) L.push([t.y, 0, t]);
    for (const hh of G.hares) if (vis(hh.x, hh.y)) L.push([hh.y, 1, hh]);
    for (const w of G.wolves) if (vis(w.x, w.y)) L.push([w.y, 2, w]);
    for (const f of G.fires) if (vis(f.x, f.y)) L.push([f.y, 3, f]);
    for (const s of G.stacks) if (vis(s.x, s.y)) L.push([s.y, 4, s]);
    if (G.bear && vis(G.bear.x, G.bear.y)) L.push([G.bear.y, 5, G.bear]);
    if (state !== 'menu' || true) L.push([p.y, 6, p]);
    if (G.urk.state !== 'away' && vis(G.urk.x, G.urk.y)) L.push([G.urk.y, 7]);
    if (G.vera.state !== 'dead' && vis(G.vera.x, G.vera.y)) L.push([G.vera.y, 8]);
    if (vis(POI.cockpit.x, POI.cockpit.y)) L.push([POI.cockpit.y, 9]);
    if (vis(POI.tail.x, POI.tail.y)) L.push([POI.tail.y, 10]);
    if (vis(POI.chum.x, POI.chum.y)) { L.push([POI.chum.y, 11]); L.push([POI.chum.y + 60, 13]); }
    for (const d of G.deer || []) if (vis(d.x, d.y)) L.push([d.y, 12, d]);
    if (G.col) {
      for (const b of G.col.builds) if (vis(b.x, b.y)) L.push([b.y + BUILDS[b.type].h / 2, 22, b]);
      for (const u of G.col.units) if (!u.hidden && vis(u.x, u.y)) L.push([u.y, 23, u]);
    }
    for (const a of G.amuletsAt || []) if (!a.got && vis(a.x, a.y)) L.push([a.y, 25, a]);
    for (const q of INSPECT) if (vis(q.x, q.y)) L.push([q.y, 26, q]);
    if (vis(POI.labaz.x, POI.labaz.y)) L.push([POI.labaz.y, 14]);
    if (vis(HUT.x, HUT.y)) {
      L.push([HUT_IN.y0, 15]); L.push([SPOT.stove.y, 16]); L.push([SPOT.bench.y, 17]); L.push([SPOT.chest.y, 18]); L.push([SPOT.bed.y, 19]);
      L.push([HUT_IN.y1 + WALL, 20]); L.push([HUT_IN.y1 + WALL + 1, 21]);
    }
    L.sort((a, b) => a[0] - b[0]);
    for (const [, k, o] of L) {
      switch (k) {
        case 0: drawTree(o, wind); break; case 1: drawHare(o); break; case 2: drawWolf(o); break; case 3: drawFire(o); break;
        case 4: drawStack(o); break; case 5: drawBear(o); break;
        case 6: if (G.gear.sled && !p.inside && !p.sleeping) drawSled(p.sx, p.sy, G.inv.wood || 0); drawPlayer(); break;
        case 7: drawUrk(); break; case 8: drawVera(); break; case 9: drawWreck(); break; case 10: drawTailObj(); break;
        case 11: drawChum(); break; case 12: drawDeer(o); break; case 13: drawSled(POI.chum.x + 80, POI.chum.y + 120, 0); break;
        case 14: cx.drawImage(LABAZ(), POI.labaz.x - 40, POI.labaz.y - 80, 80, 90); break;
        case 15: drawNorthWall(); break; case 16: drawStove(); break; case 17: drawBench(); break; case 18: drawChest(); break; case 19: drawBed(); break;
        case 20: drawSouthWall(); break; case 21: drawRoof(); break;
        case 22: drawBuilding(o); break; case 23: drawUnit(o); break; case 25: drawAmulet(o); break; case 26: drawInspect(o); break;
      }
    }
    // 4. частицы мира
    for (const q of G.parts) if (q.type !== 'spark' && q.type !== 'text') ArtWorld.drawParticle(cx, q, ENV);
    cx.globalAlpha = 1;
    if (G.ravens) drawRavens();
    if (G.col) drawColonyOverlay();
    // вертолёт
    drawHeli();

    // 5. карта освещения
    const amb = ambient(h, storm), dark = (amb[0] + amb[1] + amb[2]) / 765;
    const LOW = window.QUALITY === 'low';
    const auroraK = LOW ? 0 : state === 'menu' ? 0.8 : night > 0.5 && !storm ? (G.aurora || 0) * smooth(0.5, 0.9, night) : 0;
    if (auroraK > 0 && frame % 2 === 0) aurora(auroraK);
    if (dark < 0.985) {
      lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over';
      lx.fillStyle = `rgb(${amb[0] | 0},${amb[1] | 0},${amb[2] | 0})`; lx.fillRect(0, 0, lm.width, lm.height);
      lx.globalCompositeOperation = 'screen';
      const k = clamp((1 - dark) * 1.3, 0, 1);
      // отсвет сияния на снегу — под светом, тем же 'screen': у костров он сам гаснет, колец нет
      if (auroraK > 0) { lx.globalAlpha = 0.3 * auroraK; lx.drawImage(au, 0, 0, lm.width, lm.height); }
      for (const Lt of LIGHTS) {
        const img = Lt.t === 'c' ? L_COOL : Lt.t === 'r' ? L_RED : L_WARM, r = Lt.r / 2;
        const sx = (Lt.x - cam.x + shx) * zoom / 2, sy = (Lt.y - cam.y + shy) * zoom / 2, R = r * zoom;
        if (sx + R < 0 || sy + R < 0 || sx - R > lm.width || sy - R > lm.height) continue;
        lx.globalAlpha = Math.min(1, Lt.a * k); lx.drawImage(img, sx - R, sy - R, R * 2, R * 2);
      }
      lx.globalAlpha = 1;
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'multiply'; cx.drawImage(lm, 0, 0, cv.width, cv.height);
      cx.globalCompositeOperation = 'source-over';
    }
    // 6. свечение
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.globalCompositeOperation = 'lighter';
    const glowK = 0.25 + night * 0.75;
    for (const e of EYES) {
      const sx = e.x - cam.x + shx, sy = e.y - cam.y + shy;
      if (e.glow) { const r = 50 * e.glow; cx.globalAlpha = 0.3 * glowK; cx.drawImage(GLOW, sx - r, sy - r, r * 2, r * 2); }
      else if (e.lamp) { cx.globalAlpha = e.lamp; cx.fillStyle = '#ff4a2a'; cx.fillRect(sx - 1.2, sy - 1.2, 2.4, 2.4); cx.globalAlpha = e.lamp * (0.3 + night * 0.5); cx.drawImage(PUFF, sx - 7, sy - 7, 14, 14); }
      else if (e.spark !== undefined) { cx.globalAlpha = e.spark * 0.8; cx.drawImage(PUFF, sx - 5, sy - 5, 10, 10); }
      else if (night > 0.3) {
        cx.globalAlpha = Math.min(1, night * 1.2);
        cx.fillStyle = e.red || e.bear ? '#ff6a3a' : '#ffdc5a';
        cx.beginPath(); cx.arc(sx, sy, e.bear ? 2.6 : 2, 0, Math.PI * 2); cx.arc(sx - e.f * (e.bear ? 7 : 5), sy, e.bear ? 2.6 : 2, 0, Math.PI * 2); cx.fill();
        cx.globalAlpha = night * 0.25; cx.drawImage(PUFF, sx - 10, sy - 8, 20, 16);
      }
    }
    for (const q of G.parts) if (q.type === 'spark') {
      const a = q.life / q.max, sx = q.x - cam.x + shx, sy = q.y - cam.y + shy;
      cx.globalAlpha = a; cx.fillStyle = a > 0.5 ? '#ffcf6b' : '#ff5a14'; cx.fillRect(sx, sy, 2, 2);
    }
    cx.globalAlpha = 1;
    // 7. сияние у горизонта
    if (auroraK > 0) { cx.globalCompositeOperation = 'screen'; cx.globalAlpha = 0.9; cx.drawImage(au, 0, 0, vw, vh * 0.5); cx.globalAlpha = 1; }
    cx.globalCompositeOperation = 'source-over';

    // 8. снег, позёмка, пурга
    const n = (storm ? 460 : 150) >> (LOW ? 1 : 0), wx = storm ? 340 : 30;
    cx.fillStyle = '#ffffff';
    for (let i = 0; i < n; i++) {
      const fl = flakes[i];
      fl.x += ((wx * (0.5 + fl.z) + Math.sin(now + fl.ph) * 12) * dt - camDX * (0.3 + fl.z * 0.7)) / vw;
      fl.y += ((30 + 60 * fl.z) * (storm ? 1.5 : 1) * dt - camDY * (0.3 + fl.z * 0.7)) / vh;
      fl.x -= Math.floor(fl.x); fl.y -= Math.floor(fl.y);
      cx.globalAlpha = 0.35 + fl.z * 0.6;
      const r = 0.8 + fl.z * 1.8;
      if (storm) cx.fillRect(fl.x * vw, fl.y * vh, r * 4, r * 0.8); else cx.fillRect(fl.x * vw, fl.y * vh, r, r);
    }
    const ns = storm ? 200 : 40;
    cx.strokeStyle = 'rgba(255,255,255,0.25)'; cx.lineWidth = 1; cx.globalAlpha = 1; cx.beginPath();
    for (let i = 0; i < ns; i++) {
      const s = streaks[i];
      s.x += ((storm ? 500 : 90) * (0.6 + s.z) * dt - camDX) / vw; s.y -= camDY / vh; s.x -= Math.floor(s.x); s.y -= Math.floor(s.y);
      const X = s.x * vw, Y = s.y * vh; cx.moveTo(X, Y); cx.lineTo(X + s.l * (storm ? 2 : 1), Y + 1);
    }
    cx.stroke();
    if (storm) {
      const px = p.x - cam.x, py = p.y - cam.y - 16;
      const g = cx.createRadialGradient(px, py, 140, px, py, 420);
      g.addColorStop(0, 'rgba(223,232,240,0.25)'); g.addColorStop(1, 'rgba(223,232,240,0.9)');
      cx.fillStyle = g; cx.fillRect(0, 0, vw, vh);
    }
    // 9. цветокоррекция
    if (state !== 'menu' || true) {
      const dusk = Math.max(smooth(6.2, 7.2, h) * (1 - smooth(7.8, 9, h)), smooth(16.2, 17.4, h) * (1 - smooth(18.4, 19.4, h)));
      if (dusk > 0.02) { cx.globalCompositeOperation = 'soft-light'; cx.globalAlpha = dusk * 0.35; cx.fillStyle = '#ff9a6b'; cx.fillRect(0, 0, vw, vh); }
      if (night > 0.3) { cx.globalCompositeOperation = 'soft-light'; cx.globalAlpha = night * 0.3; cx.fillStyle = '#3050a0'; cx.fillRect(0, 0, vw, vh); }
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    }
    if (state === 'menu') return;

    // 10. подписи в мире
    WT();
    cx.textAlign = 'center'; cx.font = '600 15px "PT Sans", sans-serif';
    for (const q of G.parts) if (q.type === 'text') {
      cx.globalAlpha = Math.min(1, q.life / q.max * 2);
      cx.fillStyle = '#fff'; Icons.text(cx, q.text, q.x, q.y, 16, { stroke: 'rgba(10,20,30,0.75)', lw: 3 });
    }
    cx.globalAlpha = 1;
    // метка цели взаимодействия
    if (ctxTarget && !UI.modal()) {
      const o = ctxTarget; cx.fillStyle = '#ffd27a'; const bob = Math.sin(now * 5) * 3;
      cx.beginPath(); cx.moveTo(o.x - 6, o.y - o.h - 10 + bob); cx.lineTo(o.x + 6, o.y - o.h - 10 + bob); cx.lineTo(o.x, o.y - o.h - 2 + bob); cx.closePath(); cx.fill();
    }
    // кольцо действия
    if (p.action && p.action.k !== 'fish') {
      const k = p.action.t / p.action.dur, sx = p.x, sy = p.y - 58;
      cx.lineWidth = 4; cx.strokeStyle = 'rgba(10,20,30,0.5)'; cx.beginPath(); cx.arc(sx, sy, 11, 0, Math.PI * 2); cx.stroke();
      cx.strokeStyle = p.action.k === 'fish' ? '#8cc3e6' : '#ffb347';
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
      for (const h of sn.hits) {
        const age = sn.t - h.d / 520; if (age < 0) continue;
        const a = Math.max(0, Math.min(1, age * 4) * (1 - (sn.t - 4) / 1)), sx = (h.x - cam.x) * zoom / U, sy = (h.y - cam.y) * zoom / U;
        cx.globalAlpha = Math.min(1, a);
        Icons.plate(cx, sx - 13, sy - 50 - Math.min(age, 0.3) * 20, 26, 26, 13);
        Icons.draw(cx, h.ic, sx, sy - 37 - Math.min(age, 0.3) * 20, 18, '#ebe6d3');
        cx.font = '11px "PT Mono", monospace'; cx.fillStyle = '#ffd27a'; cx.lineWidth = 3; cx.strokeStyle = 'rgba(11,18,14,.7)';
        cx.strokeText(Math.round(h.d / 10) * 10 + ' м', sx, sy - 14); cx.fillText(Math.round(h.d / 10) * 10 + ' м', sx, sy - 14);
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
      g.addColorStop(0, 'rgba(210,235,255,0)'); g.addColorStop(1, `rgba(210,235,255,${fr * 0.8})`);
      cx.fillStyle = g; cx.fillRect(0, 0, vw, vh);
    }
    if (G.hurt > 0) { cx.fillStyle = `rgba(190,30,30,${G.hurt * 0.3})`; cx.fillRect(0, 0, vw, vh); }
    if (p.sleeping) { cx.fillStyle = 'rgba(5,10,25,0.55)'; cx.fillRect(0, 0, vw, vh); }
  }

  function drawHeli() {
    let hx, hy, sc = 1;
    if (G.heli) { const a = now * 0.6; hx = POI.mar.x + Math.cos(a) * 320; hy = POI.mar.y + Math.sin(a) * 200 - 120; }
    else if (G.rescueT > 0) { const k = 1 - G.rescueT / 5; hx = POI.mar.x + 320 * (1 - k); hy = POI.mar.y - 120 * (1 - k) - 40; sc = 1 + 0.2 * k; }
    else return;
    ell(hx, hy + 140, 60, 18, 'rgba(40,60,90,0.25)');
    cx.save(); cx.translate(hx, hy); cx.scale(sc, sc);
    rr(-40, -14, 80, 28, 12, '#d9dee3'); cx.fillStyle = '#c8452a'; cx.fillRect(-40, -3, 80, 6);
    cx.fillStyle = '#d9dee3'; cx.fillRect(38, -4, 60, 8); cx.fillStyle = '#2a3a48'; cx.fillRect(-44, -10, 10, 20);
    cx.globalAlpha = 0.35; ell(0, 0, 70, 70, '#6b7078'); cx.globalAlpha = 1;
    cx.strokeStyle = '#3a3d40'; cx.lineWidth = 3; cx.beginPath(); const r = now * 30;
    for (let i = 0; i < 5; i++) { const a = r + i * 1.256; cx.moveTo(0, 0); cx.lineTo(Math.cos(a) * 70, Math.sin(a) * 70); } cx.stroke();
    cx.restore();
    light(hx, hy + 140, 200, 'c', 0.6);
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
    reset() { chunks.clear(); roofA = 1; recenter(); },
    get vw() { return vw; }, get vh() { return vh; }, get zoom() { return zoom; }, get free() { return camMode === 'free'; }, get mode() { return camMode; },
  };
})();
