// Процедурные текстуры зала (canvas 2D → THREE.CanvasTexture). Фото из _ref — только эталон на глаз,
// здесь всё рисуется с нуля: кирпич белый (зал) и красный (фасад), цементная плитка с орнаментом, оникс,
// чёрный мрамор, дерево с салфетками SushiGO, стёганая обивка, шестерёнки, вывески, постеры, экраны ТВ.
// Свет запекается отдельно: lightMap(…) рисует пятна подсветки (снизу вверх, сверху вниз, заливки) для
// стены/пола — так на слабых машинах почти весь свет зала бесплатен (2–4 настоящих источника на всё).
// Размер задаёт качество: S = 256 | 512 (кирпич 1×1 м на S пикселей и т.д.).
'use strict';
L.def('render/textures', () => {
const { RNG, clamp } = L.use('core');

const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return [cv, cv.getContext('2d')]; };
// canvas → текстура; rep — повторять, srgb — цветовая (почти всё), flip=false — для запечённого света (v = высота)
function tex(cv, { rep = false, srgb = true, flip = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = flip; t.anisotropy = aniso;
  return t;
}
const rgba = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
// «#rrggbb» ± сдвиг яркости
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = v => clamp(v + k, 0, 255);
  return rgba(f(n >> 16), f((n >> 8) & 255), f(n & 255));
}
function noise(g, w, h, n, a, rng, dark = true) {
  for (let i = 0; i < n; i++) {
    const v = dark ? 0 : 255;
    g.fillStyle = rgba(v, v, v, rng.next() * a);
    g.fillRect(rng.next() * w, rng.next() * h, 1 + rng.next() * 2, 1 + rng.next() * 1.5);
  }
}

// ─────────── кирпич ───────────
// белый глазурованный кирпич зала: 1×1 м, 16 рядов по 4 кирпича, швы тонкие, у кирпича рельеф (скользящий свет)
function brickWhite(S) {
  const [cv, g] = mk(S, S), rng = new RNG(7), rows = 16, per = 4, rh = S / rows, bw = S / per, m = Math.max(1, S / 256);
  g.fillStyle = '#a79f92'; g.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) for (let i = -1; i < per + 1; i++) {
    const x = i * bw + (r % 2 ? bw / 2 : 0) + rng.range(-1, 1) * m, y = r * rh;
    const L = 226 + rng.range(-16, 12), w = bw - 2.5 * m, h = rh - 2.5 * m;
    g.fillStyle = rgba(L + 6, L + 2, L - 8); g.fillRect(x + m, y + m, w, h);
    // рельеф: верх светлее, низ темнее, неровности
    g.fillStyle = rgba(255, 252, 244, 0.5); g.fillRect(x + m, y + m, w, 1.5 * m);
    g.fillStyle = rgba(90, 80, 70, 0.28); g.fillRect(x + m, y + h - 1 * m, w, 2 * m);
    for (let k = 0; k < 6; k++) { g.fillStyle = rgba(120, 110, 95, rng.range(0.05, 0.18)); g.fillRect(x + m + rng.next() * w, y + m + rng.next() * h, rng.range(2, 8) * m, rng.range(1, 2) * m); }
  }
  noise(g, S, S, S * 6, 0.12, rng);
  return tex(cv, { rep: true });
}
// старый красно-коричневый кирпич фасада
function brickRed(S) {
  const [cv, g] = mk(S, S), rng = new RNG(11), rows = 14, per = 4, rh = S / rows, bw = S / per, m = Math.max(1, S / 256);
  const P = ['#8b4a35', '#7c3f2e', '#9a5840', '#6e3528', '#a0624a', '#83503d', '#74402f', '#915039'];
  g.fillStyle = '#9d8a74'; g.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) for (let i = -1; i < per + 1; i++) {
    const x = i * bw + (r % 2 ? bw / 2 : 0), y = r * rh, w = bw - 4 * m, h = rh - 4 * m;
    g.fillStyle = rng.pick(P); g.fillRect(x + 2 * m, y + 2 * m, w, h);
    g.fillStyle = rgba(0, 0, 0, rng.range(0, 0.25)); g.fillRect(x + 2 * m, y + 2 * m, w, h);
    g.fillStyle = rgba(255, 220, 190, 0.12); g.fillRect(x + 2 * m, y + 2 * m, w, 2 * m);
  }
  noise(g, S, S, S * 8, 0.2, rng); noise(g, S, S, S * 2, 0.1, rng, false);
  return tex(cv, { rep: true });
}

// ─────────── запечённый свет ───────────
// lenM×hM метров, spots: { s, y, kind:'up'|'down'|'wash'|'glow', c:'#rrggbb', a, r, len }
// base — «потолок темноты» (свет, который есть везде). v = высота снизу (flipY=false).
function lightMap(lenM, hM, spots, base = '#2a2420', ppm = 28) {
  const w = clamp(Math.round(lenM * ppm), 16, 1024), h = clamp(Math.round(hM * ppm), 16, 1024), kx = w / lenM, ky = h / hM;
  const [cv, g] = mk(w, h);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const blob = (x, y, r, c, a, sy = 1) => {
    const n = parseInt(c.slice(1), 16), R = n >> 16, G = (n >> 8) & 255, B = n & 255;
    g.save(); g.translate(x, y); g.scale(1, sy);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, rgba(R, G, B, a)); gr.addColorStop(0.45, rgba(R, G, B, a * 0.45)); gr.addColorStop(1, rgba(R, G, B, 0));
    g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore();
  };
  for (const p of spots) {
    const x = p.s * kx, y = (p.y ?? 0) * ky, a = p.a ?? 0.6, r = (p.r ?? 0.5) * kx, c = p.c || '#ffb050';
    if (p.kind === 'up' || p.kind === 'down') {
      // конус: от источника вверх/вниз, расширяется и гаснет — «свечка» на кирпиче, как на фото
      const dir = p.kind === 'up' ? 1 : -1, len = (p.len ?? 2) * ky, N = 14;
      for (let i = 0; i < N; i++) { const t = i / (N - 1); blob(x, y + dir * t * len, r * (0.35 + t * 1.1), c, a * 0.28 * Math.pow(1 - t, 0.9), 1.6); }
      blob(x, y, r * 0.5, c, a * 0.6);
    } else if (p.kind === 'wash') blob(x, y, r, c, a, p.sy ?? 0.7);
    else blob(x, y, r, c, a);
  }
  g.globalCompositeOperation = 'source-over';
  return tex(cv, { flip: false });
}

// ─────────── пол: чёрно-белая цементная плитка с орнаментом ───────────
// одна текстура = 2×2 плитки по 20 см (модуль 40 см); круги на стыках складываются в сплошной узор
function floorTile(S) {
  const [cv, g] = mk(S, S), t = S / 2, INK = '#1d1b1e', PAPER = '#ebe7de', lw = Math.max(1.5, t * 0.045);
  g.fillStyle = PAPER; g.fillRect(0, 0, S, S);
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = lw;
  const flower = (cx, cy, r, rot = Math.PI / 4) => { for (let k = 0; k < 4; k++) { g.save(); g.translate(cx, cy); g.rotate(k * Math.PI / 2 + rot); g.beginPath(); g.ellipse(r * 0.55, 0, r * 0.55, r * 0.28, 0, 0, Math.PI * 2); g.fill(); g.restore(); } };
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const x0 = i * t, y0 = j * t, cx = x0 + t / 2, cy = y0 + t / 2;
    g.save(); g.beginPath(); g.rect(x0, y0, t, t); g.clip();
    // кружево: круг в центре, полукольца от середин сторон, четвертинки у углов
    g.beginPath(); g.arc(cx, cy, t * 0.3, 0, Math.PI * 2); g.stroke();
    for (const [ax, ay] of [[cx, y0], [cx, y0 + t], [x0, cy], [x0 + t, cy]]) { g.beginPath(); g.arc(ax, ay, t * 0.2, 0, Math.PI * 2); g.stroke(); }
    for (const [ax, ay] of [[x0, y0], [x0 + t, y0], [x0, y0 + t], [x0 + t, y0 + t]]) { flower(ax, ay, t * 0.2); g.beginPath(); g.arc(ax, ay, t * 0.34, 0, Math.PI * 2); g.stroke(); }
    flower(cx, cy, t * 0.16, 0);
    g.fillStyle = PAPER; g.beginPath(); g.arc(cx, cy, t * 0.035, 0, Math.PI * 2); g.fill(); g.fillStyle = INK;
    // завитки-«S» между кольцами
    g.lineWidth = lw * 0.7;
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, px = cx + Math.cos(a) * t * 0.36, py = cy + Math.sin(a) * t * 0.36; g.beginPath(); g.arc(px, py, t * 0.06, a, a + Math.PI * 1.4); g.stroke(); }
    g.lineWidth = lw;
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, t - 1, t - 1);
    g.strokeStyle = INK; g.lineWidth = lw;
  }
  noise(g, S, S, S * 4, 0.1, new RNG(3));
  return tex(cv, { rep: true, aniso: 8 });
}
// брусчатка/плитка тротуара и веранды
function paving(S) {
  const [cv, g] = mk(S, S), rng = new RNG(5), n = 4, c = S / n;
  g.fillStyle = '#8d8a86'; g.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const L = 170 + rng.range(-14, 10); g.fillStyle = rgba(L, L - 2, L - 6); g.fillRect(i * c + 1, j * c + 1, c - 2, c - 2); }
  noise(g, S, S, S * 6, 0.18, rng);
  return tex(cv, { rep: true });
}
function asphalt(S) {
  const [cv, g] = mk(S, S), rng = new RNG(9);
  g.fillStyle = '#3a3a3d'; g.fillRect(0, 0, S, S);
  noise(g, S, S, S * 20, 0.35, rng); noise(g, S, S, S * 10, 0.12, rng, false);
  return tex(cv, { rep: true });
}

// ─────────── камень, дерево, обивка ───────────
// оникс фасада стойки: жёлто-янтарный, светится изнутри, разводы
function onyx(S) {
  const [cv, g] = mk(S, S), rng = new RNG(21);
  const gr = g.createLinearGradient(0, 0, S, S); gr.addColorStop(0, '#ffd66a'); gr.addColorStop(0.5, '#ffbe45'); gr.addColorStop(1, '#f4a334');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.filter = `blur(${Math.max(1, S / 128)}px)`;
  for (let i = 0; i < 70; i++) {
    const w = rng.range(0.5, 5) * S / 256, warm = rng.chance(0.55);
    g.strokeStyle = warm ? rgba(190, 95, 20, rng.range(0.15, 0.45)) : rgba(255, 245, 200, rng.range(0.2, 0.6));
    g.lineWidth = w; g.beginPath();
    let x = rng.range(-0.2, 1.2) * S, y = rng.range(-0.2, 1.2) * S; g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { const x2 = x + rng.range(-0.5, 0.5) * S, y2 = y + rng.range(-0.3, 0.3) * S; g.quadraticCurveTo(x + rng.range(-0.3, 0.3) * S, y + rng.range(-0.3, 0.3) * S, x2, y2); x = x2; y = y2; }
    g.stroke();
  }
  g.filter = 'none';
  return tex(cv, { rep: true });
}
// чёрный мрамор с белыми прожилками-молниями
function marble(S) {
  const [cv, g] = mk(S, S), rng = new RNG(33);
  g.fillStyle = '#141315'; g.fillRect(0, 0, S, S);
  noise(g, S, S, S * 3, 0.08, rng, false);
  const vein = (x, y, a, len, w, al) => {
    g.strokeStyle = rgba(235, 232, 225, al); g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      a += rng.range(-0.6, 0.6); x += Math.cos(a) * S / 30; y += Math.sin(a) * S / 30; g.lineTo(x, y);
      if (rng.chance(0.12) && w > 0.6) vein(x, y, a + rng.range(-1.2, 1.2), len * 0.4 | 0, w * 0.6, al * 0.8);
    }
    g.stroke();
  };
  for (let i = 0; i < 9; i++) vein(rng.next() * S, rng.next() * S, rng.next() * 6.3, 28, rng.range(1.2, 2.6) * S / 256, rng.range(0.75, 1));
  return tex(cv, { rep: true });
}
// логотип SUS||GO! (палочки вместо «HI») — рисуется в любом месте
function logo(g, x, y, h, col = '#f2efe8', sub = null) {
  g.save(); g.fillStyle = col; g.strokeStyle = col; g.textBaseline = 'middle'; g.textAlign = 'right';
  g.font = `600 ${h}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
  g.save(); g.translate(x - h * 0.2, y); g.scale(0.8, 1.05); g.fillText('SUS', 0, 0); g.restore();
  g.lineWidth = Math.max(1, h * 0.07); g.beginPath();
  g.moveTo(x - h * 0.12, y + h * 0.5); g.lineTo(x - h * 0.02, y - h * 0.55);
  g.moveTo(x + h * 0.06, y + h * 0.5); g.lineTo(x + h * 0.14, y - h * 0.6); g.stroke();
  g.textAlign = 'left'; g.save(); g.translate(x + h * 0.2, y); g.scale(0.85, 1.05); g.fillText('GO!', 0, 0); g.restore();
  if (sub) { g.textAlign = 'center'; g.font = `${h * 0.26}px Arial, sans-serif`; g.fillText(sub, x, y + h * 0.85); }
  g.restore();
}
// деревянная столешница «длинного стола» с бумажными подложками (логотип, QR) на каждое место
function woodTop(S, seats = 2, mats = true, seed = 1) {
  const w = S / 2, h = Math.round(S * 0.8), [cv, g] = mk(w, h), rng = new RNG(40 + seed);
  g.fillStyle = '#3b2518'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { g.strokeStyle = rgba(rng.chance(0.5) ? 20 : 90, rng.chance(0.5) ? 12 : 55, 8, rng.range(0.1, 0.35)); g.lineWidth = rng.range(0.5, 2); g.beginPath(); const x = rng.next() * w; g.moveTo(x, 0); g.bezierCurveTo(x + rng.range(-8, 8), h * 0.3, x + rng.range(-8, 8), h * 0.7, x + rng.range(-6, 6), h); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  if (mats) for (let side = 0; side < 2; side++) for (let k = 0; k < seats; k++) {
    // подложка: тёмная бумага, логотип поперёк, QR в углу
    const mw = w * 0.42, mh = h / seats * 0.62, x = side ? w - mw - w * 0.03 : w * 0.03, y = (k + 0.5) * h / seats - mh / 2;
    g.fillStyle = '#231a16'; g.fillRect(x, y, mw, mh);
    g.strokeStyle = 'rgba(210,190,160,0.25)'; g.lineWidth = 1; g.strokeRect(x + 2, y + 2, mw - 4, mh - 4);
    g.save(); g.translate(x + mw / 2, y + mh / 2); g.rotate(side ? -Math.PI / 2 : Math.PI / 2); logo(g, 0, 0, mw * 0.28, '#d8d0c2'); g.restore();
    g.fillStyle = '#e8e2d6'; const q = mw * 0.18, qx = side ? x + mw * 0.08 : x + mw - q - mw * 0.08, qy = y + mh - q - 4;
    g.fillRect(qx, qy, q, q); g.fillStyle = '#231a16';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (rng.chance(0.5)) g.fillRect(qx + i * q / 5, qy + j * q / 5, q / 5, q / 5);
    // палочки в бумажной обёртке
    g.fillStyle = '#efe9dd'; g.save(); g.translate(x + mw * (side ? 0.85 : 0.15), y + mh / 2); g.fillRect(-2, -mh * 0.4, 4, mh * 0.8); g.restore();
  }
  return tex(cv);
}
// круглый столик: светлое дерево, кольца, карточка-меню
function roundTop(S) {
  const s = S / 2, [cv, g] = mk(s, s), rng = new RNG(51), c = s / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, '#8a5530'); gr.addColorStop(0.85, '#6e3f22'); gr.addColorStop(0.93, '#4c2a16'); gr.addColorStop(1, '#2e1a0e');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) { g.strokeStyle = rgba(40, 20, 8, rng.range(0.08, 0.2)); g.lineWidth = rng.range(0.5, 2); g.beginPath(); g.ellipse(c + rng.range(-4, 4), c, rng.range(4, c * 0.85), rng.range(4, c * 0.8), 0, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(255,240,210,0.18)'; g.beginPath(); g.ellipse(c * 0.8, c * 0.7, c * 0.5, c * 0.25, -0.5, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(c, c); g.rotate(-0.25); g.fillStyle = '#1d1a1a'; g.fillRect(-c * 0.5, -c * 0.2, c, c * 0.4);
  g.fillStyle = '#f4f0e8'; g.fillRect(-c * 0.2, -c * 0.14, c * 0.25, c * 0.28); logo(g, c * 0.22, 0, c * 0.14, '#ddd'); g.restore();
  return tex(cv);
}
// стёганая обивка (серая — цвет даёт вершина): ромбы с пуговицами
function tufted(S) {
  const s = S / 2, [cv, g] = mk(s, s), n = 6, cw = s / n, ch = s / 3;
  g.fillStyle = '#c4c0ba'; g.fillRect(0, 0, s, s);
  for (let j = -1; j <= 3; j++) for (let i = -1; i <= n; i++) {
    const cx = i * cw + (j % 2 ? cw / 2 : 0), cy = j * ch;
    const gr = g.createRadialGradient(cx + cw / 2, cy + ch / 2, 0, cx + cw / 2, cy + ch / 2, cw * 0.7);
    gr.addColorStop(0, '#f0eee9'); gr.addColorStop(0.75, '#d0ccc5'); gr.addColorStop(1, '#a8a39c');
    g.fillStyle = gr; g.beginPath(); g.moveTo(cx + cw / 2, cy); g.lineTo(cx + cw, cy + ch / 2); g.lineTo(cx + cw / 2, cy + ch); g.lineTo(cx, cy + ch / 2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(80,75,70,0.35)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#5a5650'; g.beginPath(); g.arc(cx + cw / 2, cy, s / 140 + 0.8, 0, 7); g.fill();
  }
  return tex(cv, { rep: true });
}
// велюр: мягкий «ворс» (оттенок даёт вершина)
function velour(S) {
  const s = S / 4, [cv, g] = mk(s, s), rng = new RNG(61);
  g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 3; i++) { const L = rng.range(180, 255); g.fillStyle = rgba(L, L, L, 0.25); g.fillRect(rng.next() * s, rng.next() * s, rng.range(2, 6), 1); }
  return tex(cv, { rep: true });
}

// ─────────── декор с прозрачностью ───────────
// кластер шестерёнок (чёрный металл, края ловят свет)
function gears(S) {
  const w = S, h = Math.round(S * 0.55), [cv, g] = mk(w, h), rng = new RNG(71);
  const gear = (x, y, r, teeth, spokes) => {
    g.save(); g.translate(x, y); g.beginPath();
    for (let i = 0; i < teeth * 2; i++) { const a = i / (teeth * 2) * Math.PI * 2, rr = i % 2 ? r : r * 0.86; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.arc(0, 0, r * 0.72, 0, Math.PI * 2, true);
    g.fillStyle = '#231f20'; g.fill('evenodd');
    g.strokeStyle = 'rgba(255,120,110,0.55)'; g.lineWidth = Math.max(1, r * 0.04); g.stroke();
    g.fillStyle = '#231f20'; g.lineWidth = r * 0.1; g.strokeStyle = '#2a2425';
    for (let i = 0; i < spokes; i++) { const a = i / spokes * Math.PI * 2 + rng.next(); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74); g.stroke(); }
    g.beginPath(); g.arc(0, 0, r * 0.18, 0, 7); g.fill();
    g.restore();
  };
  const list = [[0.2, 0.55, 0.19], [0.36, 0.3, 0.14], [0.48, 0.62, 0.17], [0.62, 0.35, 0.12], [0.74, 0.62, 0.15], [0.86, 0.33, 0.13], [0.1, 0.25, 0.09], [0.94, 0.72, 0.08], [0.56, 0.12, 0.08], [0.3, 0.82, 0.1]];
  for (const [x, y, r] of list) gear(x * w, y * h, r * h * 1.3, 10 + (r * 90 | 0), 5 + (rng.next() * 3 | 0));
  return tex(cv);
}
// лист алоказии (сердце с прожилками), цвет — материал
function leaf(S) {
  const s = S / 2, [cv, g] = mk(s, s), c = s / 2;
  g.fillStyle = '#e8e8e8'; g.beginPath(); g.moveTo(c, s * 0.02);
  g.bezierCurveTo(s * 0.98, s * 0.3, s * 0.9, s * 0.78, c, s * 0.98); g.bezierCurveTo(s * 0.1, s * 0.78, s * 0.02, s * 0.3, c, s * 0.02); g.fill();
  g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = s / 60; g.beginPath(); g.moveTo(c, s * 0.04); g.lineTo(c, s * 0.96); g.stroke();
  g.lineWidth = s / 120;
  for (let i = 1; i < 7; i++) { const y = s * (0.12 + i * 0.12); g.beginPath(); g.moveTo(c, y); g.quadraticCurveTo(c + s * 0.2, y - s * 0.02, c + s * 0.36, y - s * 0.12); g.moveTo(c, y); g.quadraticCurveTo(c - s * 0.2, y - s * 0.02, c - s * 0.36, y - s * 0.12); g.stroke(); }
  return tex(cv);
}
// пушистая хвоя/листва для туй и кустов (альфа-пятна)
function foliage(S) {
  const s = S / 2, [cv, g] = mk(s, s), rng = new RNG(81);
  for (let i = 0; i < 900; i++) { const L = rng.range(0.55, 1); g.fillStyle = rgba(120 * L, 170 * L, 90 * L, 1); const a = rng.next() * 6.3, r = Math.sqrt(rng.next()) * s * 0.48; g.beginPath(); g.ellipse(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, rng.range(2, 6), rng.range(1, 3), rng.next() * 3, 0, 7); g.fill(); }
  return tex(cv);
}
// мягкое пятно (тень под мебелью / ореол лампы)
function blob(S, inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)') {
  const s = S / 4, [cv, g] = mk(s, s), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return tex(cv);
}
function halo(S) { return blob(S, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'); }
// ноты для саксофона
function note(S) {
  const s = S / 4, [cv, g] = mk(s, s);
  g.fillStyle = '#fff'; g.font = `${s * 0.8}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', s / 2, s / 2);
  return tex(cv);
}

// ─────────── вывески и постеры ───────────
// неоновая вывеска на кирпичном пилоне: sushi (роллы, палочки) / cocktails (бокал) / lounge bar
function neon(S) {
  const w = Math.round(S * 0.5), h = S, [cv, g] = mk(w, h);
  g.fillStyle = '#0d0d12'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2a2a33'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  const glow = (c, blur, f) => { g.save(); g.shadowColor = c; g.shadowBlur = blur; g.fillStyle = c; g.strokeStyle = c; f(); g.restore(); g.save(); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.globalAlpha = 0.55; f(); g.restore(); };
  const PINK = '#ff4fb0', TEAL = '#39f2d9', VIO = '#c86bff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  glow(PINK, 14, () => { g.font = `italic 600 ${h * 0.1}px "Arial Narrow", Arial, sans-serif`; g.fillText('sushi', w * 0.42, h * 0.11); });
  glow(TEAL, 10, () => { g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.62, h * 0.2); g.lineTo(w * 0.8, h * 0.05); g.moveTo(w * 0.68, h * 0.21); g.lineTo(w * 0.86, h * 0.07); g.stroke(); });
  glow(PINK, 12, () => { g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(w * (0.3 + i * 0.2), h * 0.23, w * 0.085, h * 0.03, 0, 0, 7); g.stroke(); } });
  glow(TEAL, 14, () => { g.font = `600 ${h * 0.085}px "Arial Narrow", Arial, sans-serif`; g.save(); g.translate(w / 2, h * 0.4); g.scale(0.75, 1.2); g.fillText('cocktails', 0, 0); g.restore(); });
  glow(TEAL, 12, () => { g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.32, h * 0.52); g.lineTo(w * 0.68, h * 0.52); g.lineTo(w * 0.5, h * 0.62); g.closePath(); g.moveTo(w * 0.5, h * 0.62); g.lineTo(w * 0.5, h * 0.72); g.moveTo(w * 0.4, h * 0.73); g.lineTo(w * 0.6, h * 0.73); g.stroke(); });
  glow(PINK, 8, () => { g.beginPath(); g.arc(w * 0.44, h * 0.545, w * 0.03, 0, 7); g.fill(); });
  glow(VIO, 16, () => { g.font = `600 ${h * 0.1}px "Arial Narrow", Arial, sans-serif`; g.save(); g.translate(w / 2, h * 0.86); g.scale(0.62, 1.3); g.fillText('lounge bar', 0, 0); g.restore(); });
  return tex(cv);
}
// круглая чёрная вывеска-логотип: грузинская надпись сверху, SUS||GO! в центре, LOUNGE BAR снизу
function roundSign(S) {
  const s = S / 2, [cv, g] = mk(s, s), c = s / 2;
  g.fillStyle = '#111'; g.beginPath(); g.arc(c, c, c - 1, 0, 7); g.fill();
  g.strokeStyle = '#ddd'; g.lineWidth = s / 90; g.beginPath(); g.arc(c, c, c * 0.93, 0, 7); g.stroke();
  logo(g, c, c, s * 0.2);
  const arcText = (txt, r, a0, span, flip, size) => {
    g.save(); g.translate(c, c); g.font = `600 ${size}px Arial, sans-serif`; g.fillStyle = '#e8e8e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < txt.length; i++) { const a = a0 + (i / Math.max(1, txt.length - 1) - 0.5) * span * (flip ? -1 : 1); g.save(); g.rotate(a); g.translate(0, flip ? r : -r); g.fillText(txt[i], 0, 0); g.restore(); }
    g.restore();
  };
  arcText('სუში ბარი', c * 0.72, 0, 1.6, false, s * 0.075);
  arcText('LOUNGE BAR', c * 0.72, 0, 1.5, true, s * 0.07);
  return tex(cv);
}
// табличка SUS||GO! над телевизором / на изогнутом элементе стойки
function board(S, bg = '#101010', fg = '#efe7d6', sub = null) {
  const w = S / 2, h = S / 4, [cv, g] = mk(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h); logo(g, w / 2, h * (sub ? 0.42 : 0.5), h * 0.5, fg, sub);
  return tex(cv);
}
// постер GIN TONIC (светлый, с силуэтом)
function ginTonic(S) {
  const w = S / 4, h = Math.round(S * 0.35), [cv, g] = mk(w, h);
  g.fillStyle = '#e6e1d6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.font = `800 ${w * 0.22}px Arial, sans-serif`;
  g.fillText('GIN', w * 0.5, h * 0.2); g.font = `800 ${w * 0.17}px Arial, sans-serif`; g.fillText('TONIC', w * 0.5, h * 0.33);
  g.beginPath(); g.arc(w * 0.5, h * 0.5, w * 0.1, 0, 7); g.fill(); g.fillRect(w * 0.33, h * 0.58, w * 0.34, h * 0.3);
  g.fillStyle = '#b8342c'; g.fillRect(w * 0.42, h * 0.62, w * 0.16, h * 0.1);
  return tex(cv);
}
// тёмный постер с суши в чёрной рамке
function sushiPoster(S, seed = 1) {
  const w = S / 4, h = Math.round(S * 0.4), [cv, g] = mk(w, h), rng = new RNG(90 + seed);
  g.fillStyle = '#18161a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const x = w * rng.range(0.3, 0.7), y = h * (0.15 + i * 0.22), r = w * 0.14;
    g.fillStyle = '#f2ece2'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = rng.pick(['#e8663d', '#f08a5d', '#d9482b', '#9fc46a']); g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  }
  return tex(cv);
}
// жестяная табличка с мотоциклом (ретро)
function moto(S) {
  const w = S / 4, h = Math.round(S * 0.18), [cv, g] = mk(w, h);
  g.fillStyle = '#d9c49a'; g.fillRect(0, 0, w, h); g.fillStyle = '#b8402c'; g.fillRect(0, 0, w, h * 0.22);
  g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(w * 0.3, h * 0.72, h * 0.16, 0, 7); g.arc(w * 0.72, h * 0.72, h * 0.16, 0, 7); g.fill();
  g.fillStyle = '#c9c9c9'; g.beginPath(); g.arc(w * 0.3, h * 0.72, h * 0.08, 0, 7); g.arc(w * 0.72, h * 0.72, h * 0.08, 0, 7); g.fill();
  g.fillStyle = '#3a4a6a'; g.fillRect(w * 0.35, h * 0.45, w * 0.32, h * 0.14); g.fillStyle = '#2b2b2b'; g.fillRect(w * 0.48, h * 0.3, w * 0.1, h * 0.18);
  g.strokeStyle = '#6a4a2a'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
  return tex(cv);
}
// дверца холодильника с подсветкой
function fridge(S) {
  const w = S / 4, h = S / 2, [cv, g] = mk(w, h), rng = new RNG(12);
  g.fillStyle = '#9fd4ff'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 5; r++) for (let i = 0; i < 5; i++) { g.fillStyle = rng.pick(['#2a5fb0', '#e24a3a', '#f0c030', '#2a8a4a', '#eee']); g.fillRect(i * w / 5 + 2, r * h / 5 + h * 0.06, w / 5 - 4, h / 5 * 0.7); }
  g.fillStyle = '#1b4db4'; g.fillRect(0, 0, w, h * 0.05);
  return tex(cv);
}
// доски сцены: тёплое дерево, узкие доски вразбежку, тёмные швы
function planks(S) {
  const [cv, g] = mk(S, S), rng = new RNG(21), n = 8, bw = S / n;
  for (let i = 0; i < n; i++) {
    let y = -rng.range(0, S * 0.5);
    while (y < S) {
      const L = rng.range(0.25, 0.6) * S, c = 120 + rng.range(-18, 18);
      g.fillStyle = rgba(c + 40, c * 0.72, c * 0.45); g.fillRect(i * bw, y, bw, L);
      for (let k = 0; k < 5; k++) { g.fillStyle = rgba(60, 35, 20, rng.range(0.08, 0.2)); g.fillRect(i * bw + rng.range(0, bw), y, 1.2, L); }
      g.fillStyle = 'rgba(25,15,10,0.8)'; g.fillRect(i * bw, y, bw, 1.5); y += L;
    }
    g.fillStyle = 'rgba(25,15,10,0.85)'; g.fillRect(i * bw, 0, 1.5, S);
  }
  noise(g, S, S, S * 3, 0.08, rng);
  return tex(cv, { rep: true });
}
// табличка туалета: белые буквы WC на чёрном; wide — с человечками и стрелкой (над проёмом коридорчика)
function wcSign(S, wide = false) {
  const w = wide ? S : S / 2, h = S / 2, [cv, g] = mk(w, h);
  g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e8e0cc'; g.lineWidth = Math.max(2, h * 0.03); g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
  g.fillStyle = '#f4efe2'; g.font = `bold ${h * 0.46}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!wide) { g.fillText('WC', w / 2, h / 2); return tex(cv); }
  g.fillText('WC', w * 0.3, h / 2);
  // человечки
  const man = (x, dress) => { g.beginPath(); g.arc(x, h * 0.3, h * 0.06, 0, 7); g.fill(); if (dress) { g.beginPath(); g.moveTo(x, h * 0.38); g.lineTo(x - h * 0.1, h * 0.66); g.lineTo(x + h * 0.1, h * 0.66); g.fill(); } else g.fillRect(x - h * 0.06, h * 0.38, h * 0.12, h * 0.28); g.fillRect(x - h * 0.05, h * 0.64, h * 0.035, h * 0.14); g.fillRect(x + h * 0.015, h * 0.64, h * 0.035, h * 0.14); };
  man(w * 0.6, false); man(w * 0.72, true);
  // стрелка «сюда»
  g.beginPath(); g.moveTo(w * 0.82, h * 0.42); g.lineTo(w * 0.9, h * 0.42); g.lineTo(w * 0.9, h * 0.34); g.lineTo(w * 0.96, h * 0.5); g.lineTo(w * 0.9, h * 0.66); g.lineTo(w * 0.9, h * 0.58); g.lineTo(w * 0.82, h * 0.58); g.fill();
  return tex(cv);
}
// верхние этажи дома над баром: кирпич + окна (lit — горящие окна)
function upperFacade(S, lit) {
  const w = S, h = S / 2, [cv, g] = mk(w, h), rng = new RNG(13);
  if (!lit) { g.fillStyle = '#7d4431'; g.fillRect(0, 0, w, h); noise(g, w, h, w * 30, 0.25, rng); }
  else { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
    const x = w * (0.05 + i * 0.16), y = h * (0.12 + r * 0.48), ww = w * 0.08, hh = h * 0.3;
    if (!lit) { g.fillStyle = '#e9e1d2'; g.fillRect(x - 3, y - 3, ww + 6, hh + 6); g.fillStyle = '#28303a'; g.fillRect(x, y, ww, hh); g.fillStyle = '#e9e1d2'; g.fillRect(x + ww / 2 - 1, y, 2, hh); }
    else if (rng.chance(0.45)) { g.fillStyle = rng.pick(['#ffd79a', '#ffe8c0', '#b8d0ff']); g.fillRect(x, y, ww, hh); }
  }
  return tex(cv);
}
// дома через улицу (Батуми: пастельные фасады, балконы), lit — окна ночью
function street(S, lit) {
  const w = S * 2, h = S / 2, [cv, g] = mk(w, h), rng = new RNG(17);
  if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
  let x = 0;
  while (x < w) {
    const bw = rng.range(0.1, 0.2) * w, bh = rng.range(0.6, 1) * h, col = rng.pick(['#d8c6a0', '#c9d2c4', '#e0b8a0', '#b9c4d4', '#e8dcc2', '#a8b0a0', '#d9a88a']);
    if (!lit) { g.fillStyle = col; g.fillRect(x, h - bh, bw, bh); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, h - bh, bw, h * 0.03); }
    const cols = Math.max(2, bw / (w * 0.03) | 0), rows = Math.max(2, bh / (h * 0.18) | 0);
    for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) {
      const wx = x + (i + 0.25) * bw / cols, wy = h - bh + (r + 0.25) * bh / rows, ww = bw / cols * 0.5, wh = bh / rows * 0.5;
      if (!lit) { g.fillStyle = '#2e3440'; g.fillRect(wx, wy, ww, wh); }
      else if (rng.chance(0.4)) { g.fillStyle = rng.pick(['#ffd79a', '#ffe8c0', '#ffc070', '#c0d8ff']); g.fillRect(wx, wy, ww, wh); }
    }
    if (!lit && rng.chance(0.4)) { g.fillStyle = rng.pick(['#c0392b', '#2e86c1', '#1e8449', '#7d3c98']); g.fillRect(x + bw * 0.3, h - h * 0.11, bw * 0.4, h * 0.03); }
    if (lit && rng.chance(0.4)) { g.fillStyle = rng.pick(['#ff5a8a', '#5ad0ff', '#ffe060']); g.fillRect(x + bw * 0.3, h - h * 0.11, bw * 0.4, h * 0.025); }
    x += bw + 2;
  }
  return tex(cv);
}

// ─────────── экраны ТВ (анимация) ───────────
// один холст на все экраны; mode: 'fire' | 'football' | 'fish'. draw(t) перерисовывает кадр.
class Screen {
  constructor(w = 128, h = 72) {
    [this.cv, this.g] = mk(w, h); this.w = w; this.h = h; this.mode = 'fire'; this.rng = new RNG(5);
    this.tex = tex(this.cv); this.tex.anisotropy = 1;
  }
  draw(t) {
    const { g, w, h } = this, r = this.rng;
    if (this.mode === 'fire') {
      // видео-камин: поленья, языки пламени
      g.fillStyle = '#120804'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        const x = w * (0.15 + 0.7 * ((i * 0.37) % 1)), ph = t * (3 + (i % 5)) + i, fh = h * (0.35 + 0.35 * Math.abs(Math.sin(ph))), fw = w * 0.06;
        const gr = g.createLinearGradient(0, h * 0.85, 0, h * 0.85 - fh); gr.addColorStop(0, 'rgba(255,230,120,0.9)'); gr.addColorStop(0.4, 'rgba(255,140,30,0.7)'); gr.addColorStop(1, 'rgba(200,40,0,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(x - fw, h * 0.85); g.quadraticCurveTo(x + Math.sin(ph * 1.3) * fw, h * 0.85 - fh * 0.6, x + Math.sin(ph) * fw * 0.6, h * 0.85 - fh); g.quadraticCurveTo(x + fw * 0.8, h * 0.85 - fh * 0.4, x + fw, h * 0.85); g.fill();
      }
      g.fillStyle = '#3a2214'; g.fillRect(w * 0.12, h * 0.82, w * 0.76, h * 0.08); g.fillStyle = '#2a170c'; g.fillRect(w * 0.2, h * 0.76, w * 0.6, h * 0.07);
    } else if (this.mode === 'football') {
      // поле, разметка, игроки двух цветов, счёт
      g.fillStyle = '#2f8a3a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#2a7d34' : '#33923f'; g.fillRect(i * w / 8, 0, w / 8, h); }
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; g.strokeRect(4, 6, w - 8, h - 12); g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke(); g.beginPath(); g.arc(w / 2, h / 2, h * 0.16, 0, 7); g.stroke();
      const bx = w / 2 + Math.sin(t * 0.7) * w * 0.3, bz = h / 2 + Math.sin(t * 1.3) * h * 0.25;
      for (let i = 0; i < 12; i++) { const px = bx + Math.sin(i * 2.1 + t * 0.9) * w * 0.25, pz = bz + Math.cos(i * 1.7 + t) * h * 0.3; g.fillStyle = i % 2 ? '#e33' : '#fff'; g.fillRect(px, pz, 2, 3); }
      g.fillStyle = '#fff'; g.fillRect(bx, bz, 2, 2);
      g.fillStyle = 'rgba(10,20,60,0.85)'; g.fillRect(4, 2, 34, 8); g.fillStyle = '#fff'; g.font = '7px Arial'; g.fillText('GEO 1:0', 6, 9);
    } else {
      // рыбки: синяя вода, жёлтый кузовок в пятнышках
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a6fd0'); gr.addColorStop(1, '#0a2a70'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 3; i++) {
        const fx = ((t * (8 + i * 5) + i * 50) % (w + 40)) - 20, fy = h * (0.3 + i * 0.22) + Math.sin(t + i) * 4;
        g.fillStyle = '#f2d23a'; g.fillRect(fx, fy, 20 - i * 4, 11 - i * 2); g.beginPath(); g.moveTo(fx, fy + 5); g.lineTo(fx - 6, fy); g.lineTo(fx - 6, fy + 11); g.fill();
        g.fillStyle = '#2a4aa0'; for (let k = 0; k < 5; k++) g.fillRect(fx + 2 + k * 3, fy + 2 + (k % 2) * 4, 2, 2);
      }
      g.fillStyle = 'rgba(255,255,255,0.3)'; for (let i = 0; i < 6; i++) g.fillRect((i * 23 + t * 6) % w, h - ((t * 10 + i * 13) % h), 1, 1);
    }
    this.tex.needsUpdate = true;
  }
}

return { tex, lightMap, brickWhite, brickRed, floorTile, paving, asphalt, onyx, marble, logo, woodTop, roundTop, tufted, velour,
  gears, leaf, foliage, blob, halo, note, neon, roundSign, board, ginTonic, sushiPoster, moto, fridge, wcSign, planks, upperFacade, street, Screen };
});
