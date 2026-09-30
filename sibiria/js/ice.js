'use strict';
// Ice — провал под лёд у переката (было: телепорт на берег). Эпизод 6–12 с на месте провала, без телепорта:
//   ⚠️ warn   — лёд трещит (World.thinIce): трещины расходятся от ног, лёд темнеет, герой вздрагивает и ступает осторожно (×0.5)
//   💥 drop   0.5 с — лёд ломается плитами под ним (плиты кренятся и уходят в воду), руки вверх, брызги, пар, кольцо волны
//   🌊 water  ~1.6 с — по грудь в воде: голова и плечи над водой, судорожный вдох (пар чаще), руки бьют по воде, к кромке
//   ✋ grab   ~2 с — хватается за кромку; кромка обламывается 1–2 раза (дыра шире, снова в воду)
//   🐛 crawl  ~2.4 с — грудью на лёд, руки вперёд, толчки ногами (правило 1-10-1: лёжа, в ту сторону, откуда пришёл)
//   🔄 roll   0.9 с — откатывается от полыньи;  🧎 up 1.2 с — на четвереньки, потом на ноги
//   💧 after  — мокрый (вода течёт, одежда темнее, потом обмерзает), пар от тела, дрожь, мокрый след; дыра остаётся (обломки, рябь стихает),
//              затягивается за ~сутки. Игрок влияет: направление к берегу / E — быстрее; бездействие — дольше и холоднее.
// Зверь (шатун, js/bear.js) — та же схема упрощённо: дыра, брызги, уходит в воду (sinkers).
// Состояние эпизода — память модуля (в сейв не идёт); дыры — G.iceHoles (сейв как есть).
const Ice = (() => {
  const TAU = Math.PI * 2, R = mulberry(0x1CEF), rr = (a, b) => a + R() * (b - a);
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const sm = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
  const PH = ['drop', 'water', 'grab', 'crawl', 'roll', 'up'];
  const DUR = { drop: 0.5, water: 1.6, grab: 2.0, crawl: 2.4, roll: 0.9, up: 1.2 };
  const POSE = { drop: 'iceFall', water: 'iceSlap', grab: 'iceGrab', crawl: 'iceCrawl', roll: 'iceRoll', up: 'iceUp' };
  let F = null, lastEnd = -99, log = [];
  const holes = () => (G.iceHoles || (G.iceHoles = []));
  // открытая вода переката (рисунок ArtWorld.polynya: центр +10,+4, полуоси ≈ 28 × 11): шаг туда — сразу провал
  const inWater = (x, y) => { const P = POI.polynya, dx = (x - P.x - 10) / 27, dy = (y - P.y - 4.5) / 10.5; return dx * dx + dy * dy < 1; };
  const active = () => !!(F && F.g === G);
  const snd = (fn) => { try { if (typeof Sound !== 'undefined' && Sound.ctx && Sound.ok && Sound.ok()) fn(Sound); } catch (e) { /* звук необязателен */ } };
  const plesk = (v = 0.3) => snd(S => S.fx('splash', () => { S.burst(0.18, 'bandpass', S.rnd(700, 1300), 0.2 * v, 1.2, { a: 0.01 }); S.burst(0.12, 'lowpass', 500, 0.3 * v, 1, { at: 0.03 }); }));
  const gasp = () => snd(S => S.fx('step', () => { S.burst(0.32, 'bandpass', S.rnd(900, 1300), 0.07, 0.7, { a: 0.05 }); S.burst(0.5, 'bandpass', 600, 0.05, 0.6, { at: 0.35, a: 0.2 }); }));

  // лёд проломился под героем (World.thinIce)
  function start(p) {
    const I = TUNE.ice;
    let ex = (p.iceInX != null ? p.iceInX : p.x - 80) - p.x, ey = (p.iceInY != null ? p.iceInY : p.y) - p.y; const l = Math.hypot(ex, ey);
    if (l < 12) { const P = POI.polynya, qx = p.x - P.x, qy = p.y - P.y, q = Math.hypot(qx, qy); if (q > 4) { ex = qx / q; ey = qy / q; } else { ex = -(p.face || 1); ey = 0; } } // встал у края — наружу с тонкого льда
    else { ex /= l; ey /= l; }
    // выползать — не через открытую воду переката: доворот по ±30°, пока путь (20–70 px) не над полыньёй
    for (let k = 0; k < 12; k++) {
      const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.52, c = Math.cos(a), s2 = Math.sin(a), vx = ex * c - ey * s2, vy = ex * s2 + ey * c;
      let ok = true; for (let d = 20; d <= 70; d += 10) if (inWater(p.x + vx * d, p.y + vy * d)) { ok = false; break; }
      if (ok) { ex = vx; ey = vy; break; }
    }
    const hole = { x: Math.round(p.x), y: Math.round(p.y + 1), r: 13, t0: G.time, sd: (R() * 1e6) | 0, br: [], nb: 0 };
    holes().push(hole); if (holes().length > 8) holes().shift();
    F = { g: G, ph: 'drop', t: 0, hole, ex, ey, u: 0, breaks: R() < 0.5 ? 1 : 2, nb: 0, prog: 0, idle: 0, warm0: G.s.warm, zoom0: null, zt: null, jolt: 0, sp: 0, br: 0 };
    log = [{ ph: 'drop', t: G.time, x: p.x, y: p.y, ex, ey, inX: p.iceInX, inY: p.iceInY }];
    p.action = null; p.vx = p.vy = 0; p.moving = false; p.iceT = 0; p.creaked = 0; p.torch = 0;
    if (typeof Hero !== 'undefined') Hero.snap();
    // плиты вокруг: кренятся и уходят в воду (рисунок — drawHoles)
    hole.slabs = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + rr(-0.3, 0.3); hole.slabs.push({ a, w: rr(0.5, 0.9), r: rr(8, 12), tilt: rr(0.6, 1), dir: R() < 0.5 ? -1 : 1 }); }
    hole.bits = []; for (let i = 0; i < 5; i++) hole.bits.push({ a: rr(0, TAU), d: rr(0.2, 0.75), s: rr(2, 4.2), ph: rr(0, TAU) });
    if (typeof ArtWorld !== 'undefined' && G.parts) { ArtWorld.fx.splash(G.parts, p.x, p.y); ArtWorld.fx.splash(G.parts, p.x + 4, p.y - 2); steam(p.x, p.y, 6); }
    if (typeof Sound !== 'undefined') { Sound.creak(); Sound.splash(); }
    Fx.shake(10); Fx.toast(':frost: Провалился! К берегу — ползком, откуда пришёл');
    // камера — плавно ближе (если игрок не приблизил сам)
    if (typeof GFX !== 'undefined' && GFX.zoomTo && typeof state !== 'undefined' && state === 'play') {
      const z = GFX.zoomTarget; if (z < 2) { F.zoom0 = z; F.zt = Math.min(GFX.zmax, 2.4); GFX.zoomTo(F.zt); } if (GFX.recenter) GFX.recenter();
    }
    return F;
  }
  function steam(x, y, n) { if (low() || !G.parts) return; for (let i = 0; i < n; i++) G.parts.push({ type: 'steam', x: x + rr(-10, 10), y: y - rr(0, 6), vx: rr(-6, 6), vy: -rr(8, 16), life: rr(1.6, 2.6), max: 2.6 }); }
  function splashAt(x, y, k = 1) {
    if (!G.parts) return;
    if (low()) { G.parts.push({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.6, max: 0.6 }); return; }
    ArtWorld.fx.splash(G.parts, x, y);
    if (k > 1) for (let i = 0; i < 4; i++) G.parts.push({ type: 'bit', kind: 'ice', c: '#dde6ee', x: x + rr(-6, 6), y, vx: 0, vy: 0, ux: rr(-40, 40), uy: rr(-10, 10), uz: rr(40, 80), gz: 400, z0: 2, sz: rr(1.8, 3), rot: 0, spin: rr(-8, 8), life: 0.8, max: 0.8 });
  }
  // шаг эпизода (из World.thinIce): фазы по порядку; скорость — от ввода (к берегу быстрее), бездействие — дольше и холоднее
  function tick(dt) {
    if (!G) return;
    tickAfter(dt);
    if (!active()) return;
    const p = G.p, h = F.hole, mx = input.mx || 0, my = input.my || 0, ml = Math.hypot(mx, my);
    const push = ml > 0.15 ? Math.max(0, (mx * F.ex + my * F.ey) / ml) : 0, busy = push > 0.3 || input.act;
    const rate = F.ph === 'drop' || F.ph === 'up' ? 1 : busy ? 1 + 0.8 * Math.max(push, input.act ? 0.7 : 0) : 0.72;
    if (!busy && F.ph !== 'up') F.idle += dt;
    F.t += dt * rate;
    p.moving = false; p.vx = p.vy = 0; p.action = null;
    if (Math.abs(F.ex) > 0.15) p.face = F.ex > 0 ? 1 : -1;
    const inWater = F.ph === 'drop' || F.ph === 'water' || F.ph === 'grab' || F.ph === 'crawl';
    if (inWater) G.s.warm = Math.max(7, G.s.warm - dt * (F.ph === 'crawl' ? 1.5 : busy ? 2.5 : 3.5));
    F.jolt = Math.max(0, F.jolt - dt * 3);
    const edge = h.r - 5;
    switch (F.ph) {
      case 'drop': F.u = 0; break;
      case 'water': {
        F.u = edge * sm(0.15, 1, F.t / DUR.water);
        if ((F.sp -= dt) <= 0) { F.sp = rr(0.25, 0.5); splashAt(p.x + F.ex * 5 + rr(-4, 4), p.y + rr(-1, 2)); if (R() < 0.6) plesk(0.5); }
        if ((F.br -= dt) <= 0) { F.br = rr(0.45, 0.7); if (typeof breath === 'function') breath(p.x + p.face * 5, p.y - 8, p.face, -30); if (R() < 0.5) gasp(); }
        break;
      }
      case 'grab': {
        F.u = edge;
        const k = F.t / DUR.grab, at = F.breaks === 1 ? [0.45] : [0.3, 0.68];
        if (F.nb < F.breaks && k >= at[F.nb]) { // кромка обломилась: дыра шире к берегу, снова в воду
          F.nb++; h.r += 6; h.x += F.ex * 3; h.y += F.ey * 3; h.nb++; F.jolt = 1;
          h.br.push({ a: Math.atan2(F.ey, F.ex) + rr(-0.3, 0.3), t0: G.time });
          splashAt(p.x, p.y, 2); if (typeof Sound !== 'undefined') Sound.creak(); plesk(1); Fx.shake(4);
          log.push({ ph: 'break', t: G.time, x: p.x, y: p.y });
        }
        if ((F.br -= dt) <= 0) { F.br = rr(0.6, 0.9); if (typeof breath === 'function') breath(p.x + p.face * 5, p.y - 10, p.face, -30); if (R() < 0.35) gasp(); }
        break;
      }
      case 'crawl': F.u = edge + (h.r + 28 - edge) * sm(0, 1, F.t / DUR.crawl); if ((F.sp -= dt) <= 0) { F.sp = rr(0.5, 0.9); if (F.t < DUR.crawl * 0.6) splashAt(h.x + F.ex * (F.u - 12), h.y + F.ey * (F.u - 12)); } break;
      case 'roll': F.u = h.r + 28 + 18 * sm(0, 1, F.t / DUR.roll); break;
      case 'up': break;
    }
    p.x = h.x + F.ex * F.u; p.y = h.y + F.ey * F.u;
    p.lx = p.x; p.ly = p.y;
    if (F.t >= DUR[F.ph]) {
      const i = PH.indexOf(F.ph);
      if (i === PH.length - 1) return finish();
      F.ph = PH[i + 1]; F.t = 0; F.sp = 0; F.br = 0; log.push({ ph: F.ph, t: G.time, x: p.x, y: p.y });
      if (F.ph === 'water') { gasp(); steam(p.x, p.y, 4); }
      if (F.ph === 'crawl') plesk(0.8);
      if (F.ph === 'up' && typeof Sound !== 'undefined') gasp();
    }
  }
  function finish() {
    const p = G.p, I = TUNE.ice;
    G.s.warm = Math.max(6, Math.min(G.s.warm, I.warm - Math.min(3, F.idle * 0.25))); // лежал без дела — промёрз сильнее
    p.wetT = I.wetT; p.iceSafe = 5; p.iceT = 0; p.creaked = 0; lastEnd = G.time;
    AF.t0 = G.time; AF.x = p.x; AF.y = p.y; AF.acc = 0;
    log.push({ ph: 'done', t: G.time, x: p.x, y: p.y });
    if (F.zoom0 != null && typeof GFX !== 'undefined' && Math.abs(GFX.zoomTarget - F.zt) < 0.01) GFX.zoomTo(F.zoom0);
    F = null; if (typeof Hero !== 'undefined') Hero.snap();
    Fx.toast(':fire: Выбрался. Мокрый — скорее к огню');
  }
  // после: пар от тела, мокрый след (≈ 40 с), дрожь — поза по холоду (Hero)
  const AF = { t0: -99, x: 0, y: 0, acc: 0 }, WET = [];
  function tickAfter(dt) {
    const p = G.p;
    for (let i = WET.length - 1; i >= 0; i--) if ((WET[i].life -= dt) <= 0) WET.splice(i, 1);
    if (p.iceSafe > 0) p.iceSafe -= dt;
    if (G.time - AF.t0 > 45 || !(p.wetT > 0) || p.inside) return;
    const d = Math.hypot(p.x - AF.x, p.y - AF.y); AF.x = p.x; AF.y = p.y;
    if (d < 60) { AF.acc += d; if (AF.acc > 11) { AF.acc = 0; WET.push({ x: p.x + rr(-2, 2), y: p.y + rr(-1, 1), a: rr(0, TAU), life: 40, max: 40, k: 1 - (G.time - AF.t0) / 45 }); if (WET.length > 90) WET.shift(); } }
    if (!low() && G.parts && R() < dt * 3.5) G.parts.push({ type: 'steam', x: p.x + rr(-6, 6), y: p.y - rr(14, 30), vx: rr(-4, 4), vy: -rr(6, 12), life: 1.4, max: 1.4 });
  }
  // иней на мокрой одежде: через 8 с после вылаза — растёт
  const rime = () => (G && G.p.wetT > 0 ? sm(8, 30, G.time - AF.t0) * 0.85 : 0);
  // герой не заходит в открытую дыру (обойти): выталкиваем по радиусу
  function keepOut(p) {
    if (active() || !G.iceHoles) return;
    for (const h of G.iceHoles) { const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy), r = h.r + 6, fr = frozen(h); if (fr < 0.7 && d < r && d > 0.01) { p.x = h.x + dx / d * r; p.y = h.y + dy / d * r; } }
  }
  const frozen = h => sm(CYCLE * 0.35, CYCLE * 1.1, G.time - h.t0);
  // поза героя в эпизоде
  const pose = () => {
    if (!F) return { k: 'idle', a: 0 };
    const k = POSE[F.ph], d = DUR[F.ph], nowT = typeof now === 'number' ? now : G.time;
    const loop = F.ph === 'water' || F.ph === 'grab' || F.ph === 'crawl';
    return { k, a: loop ? (nowT % 0.8) / 0.8 : Math.min(1, F.t / d), ph: F.ph };
  };
  // как рисовать героя (gfx: обрезка по воде / дыре)
  const LK = { px: 0, rx: 8, ry: 3.2, mode: 'water', cx: 0, cy: 0, k: 'p', s: 0 };
  function look() {
    const p = G.p, h = F.hole; LK.cx = p.x; LK.cy = p.y; LK.rx = 8; LK.ry = 3.2; LK.mode = 'water';
    const nowT = typeof now === 'number' ? now : 0, bob = Math.sin(nowT * 7) * 0.8;
    if (F.ph === 'drop') { const k = F.t / DUR.drop; LK.px = k < 0.6 ? 36 * sm(0, 0.6, k) : 36 - 5 * sm(0.6, 1, k); }
    else if (F.ph === 'water') LK.px = 30.5 + bob;
    else if (F.ph === 'grab') LK.px = 27 + bob * 0.6 + F.jolt * 7;
    else if (F.ph === 'crawl') { LK.mode = 'hole'; LK.cx = h.x; LK.cy = h.y; LK.rx = h.r; LK.ry = h.r * 0.5; LK.px = 0; }
    else { LK.px = 0; LK.mode = 'none'; }
    if (low() && LK.px) LK.px = Math.round(LK.px / 3) * 3;
    LK.s = LK.px / 0.23;
    return LK;
  }

  // ---------- зверь под лёд (шатун): дыра, брызги, уходит в воду ----------
  const SINK = [];
  function animal(o, kind) {
    const h = { x: Math.round(o.x), y: Math.round(o.y + 2), r: kind === 'bear' ? 22 : 14, t0: G.time, sd: (R() * 1e6) | 0, br: [], nb: 0, slabs: [], bits: [] };
    for (let i = 0; i < 7; i++) h.slabs.push({ a: i / 7 * TAU + rr(-0.3, 0.3), w: rr(0.5, 0.9), r: rr(10, 16), tilt: rr(0.6, 1), dir: R() < 0.5 ? -1 : 1 });
    for (let i = 0; i < 6; i++) h.bits.push({ a: rr(0, TAU), d: rr(0.2, 0.75), s: rr(2.4, 5), ph: rr(0, TAU) });
    holes().push(h); if (holes().length > 8) holes().shift();
    SINK.push({ o: Object.assign({}, o), kind, t0: G.time, x: h.x, y: h.y });
    splashAt(o.x, o.y, 2); splashAt(o.x + 8, o.y - 3, 2); steam(o.x, o.y, 8);
  }
  function tickSink() {
    for (let i = SINK.length - 1; i >= 0; i--) {
      const s = SINK[i], a = G.time - s.t0;
      if (a > 3.2) { SINK.splice(i, 1); continue; }
      if (a < 2.6 && R() < 0.15) splashAt(s.x + rr(-10, 10), s.y + rr(-2, 2));
    }
  }
  // для gfx: тонущие звери (объект, провал px)
  function sinkers() { if (SINK.length) tickSink(); return SINK; }
  const sinkPx = s => { const a = G.time - s.t0; return a < 0.4 ? 24 * sm(0, 0.4, a) : 24 + 30 * sm(0.8, 3, a); };

  // ---------- рисунок: трещины перед провалом, дыры (вода, обломанная кромка, обломки, рябь, затягивается), мокрый след ----------
  function drawCracks(g) {
    const p = G.p; if (active() || !(p.iceT > 0.5) || !World.onThinIce(p)) return;
    const I = TUNE.ice, k = sm(0.5, I.breakT, p.iceT), x = p.x, y = p.y + 1;
    g.globalAlpha = 0.25 + 0.35 * k; g.fillStyle = '#6f8ea8'; g.beginPath(); g.ellipse(x, y, 10 + 14 * k, 4 + 6 * k, 0, 0, TAU); g.fill(); // лёд темнеет, прогиб
    g.globalAlpha = 0.18 * k; g.fillStyle = '#27394a'; g.beginPath(); g.ellipse(x, y + 0.5, 6 + 8 * k, 2.4 + 3 * k, 0, 0, TAU); g.fill();
    let sd = ((x * 7.3 + y * 3.1) | 0) >>> 0; const rn = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
    g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + rn() * 0.6, L = (8 + rn() * 18) * (0.25 + k), segs = 4;
      let cx0 = x, cy0 = y;
      g.globalAlpha = 0.85; g.strokeStyle = '#f6f9fc'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx0, cy0 - 0.6);
      const pts = []; for (let s = 1; s <= segs; s++) { const aa = a + (rn() - 0.5) * 0.7, rr_ = L * s / segs; cx0 = x + Math.cos(aa) * rr_; cy0 = y + Math.sin(aa) * rr_ * 0.45; pts.push([cx0, cy0]); g.lineTo(cx0, cy0 - 0.6); }
      g.stroke(); g.strokeStyle = '#3f5f75'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); for (const q of pts) g.lineTo(q[0], q[1]); g.stroke();
    }
    g.globalAlpha = 1;
  }
  function drawHole(g, h) {
    const age = G.time - h.t0, fz = frozen(h), x = h.x, y = h.y, r = h.r, ry = r * 0.5;
    let sd = h.sd >>> 0; const rn = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
    const NJ = 22, J = []; for (let i = 0; i < NJ; i++) J.push(0.8 + rn() * 0.36 + (i % 3 === 0 ? 0.1 : 0));
    const edge = (k, dy = 0) => { g.beginPath(); for (let i = 0; i < NJ; i++) { const a = i / NJ * TAU, q = J[i] * k; i ? g.lineTo(x + Math.cos(a) * r * q, y + dy + Math.sin(a) * ry * q) : g.moveTo(x + Math.cos(a) * r * q, y + dy + Math.sin(a) * ry * q); } g.closePath(); };
    // кромка (светлый скол льда, снизу — толщина в тени) и вода: у ближнего края темнее (глубина), к дальнему — отсвет неба
    g.fillStyle = '#9fb7cc'; edge(1.12, 1.1); g.fill();
    g.fillStyle = '#eef4f9'; edge(1.07, -0.3); g.fill();
    g.fillStyle = '#35606c'; edge(0.97, 0.5); g.fill();
    g.fillStyle = '#243746'; edge(0.8, 1.3); g.fill();
    g.globalAlpha = 0.35; g.fillStyle = '#8fb4c4'; g.beginPath(); g.ellipse(x - r * 0.25, y - ry * 0.35, r * 0.45, ry * 0.22, -0.1, 0, TAU); g.fill(); g.globalAlpha = 1;
    // рябь стихает
    const calm = Math.max(0, 1 - age / 14), t = typeof now === 'number' ? now : 0;
    if (calm > 0.02) { g.strokeStyle = 'rgba(190,214,230,0.7)'; g.lineWidth = 0.9; for (let i = 0; i < 2; i++) { const u = (t * 0.7 + i * 0.5) % 1; g.globalAlpha = calm * (1 - u) * 0.8; g.beginPath(); g.ellipse(x, y + 0.6, r * (0.3 + u * 0.6), ry * (0.3 + u * 0.6), 0, 0, TAU); g.stroke(); } g.globalAlpha = 1; }
    // плиты: первые 1.2 с кренятся и уходят в воду, потом — обломки плавают
    const tk = sm(0, 1.2, age);
    if (h.slabs && tk < 1) for (const s of h.slabs) {
      const a = s.a, cx0 = x + Math.cos(a) * r * 0.62, cy0 = y + Math.sin(a) * ry * 0.62, w = r * 0.55 * s.w, hh = ry * 0.55 * (1 - 0.7 * tk * s.tilt);
      g.save(); g.translate(cx0, cy0 + tk * 2); g.rotate(a + Math.PI / 2 + s.dir * 0.3 * tk);
      g.globalAlpha = 1 - tk * 0.5; g.fillStyle = tk > 0.5 ? '#9fb7cc' : '#dde6ee'; g.beginPath(); g.moveTo(-w / 2, -hh); g.lineTo(w / 2, -hh * 0.7); g.lineTo(w * 0.4, hh); g.lineTo(-w * 0.45, hh * 0.8); g.closePath(); g.fill();
      g.fillStyle = '#f6f9fc'; g.globalAlpha *= 0.8; g.fillRect(-w / 2, -hh, w, Math.max(0.6, hh * 0.35)); g.restore();
    }
    g.globalAlpha = 1;
    if (h.bits && tk > 0.4) for (const b of h.bits) { // обломки плавают, покачиваются
      const bx = x + Math.cos(b.a) * r * b.d * 0.8, by = y + 0.8 + Math.sin(b.a) * ry * b.d * 0.8 + Math.sin(t * 1.6 + b.ph) * 0.4 * calm;
      g.fillStyle = '#c8d8e6'; g.beginPath(); g.ellipse(bx, by + 0.5, b.s, b.s * 0.45, b.ph, 0, TAU); g.fill();
      g.fillStyle = '#eef4f9'; g.beginPath(); g.ellipse(bx - 0.3, by, b.s * 0.8, b.s * 0.32, b.ph, 0, TAU); g.fill();
    }
    // обломанные куски кромки (свежий скол)
    for (const q of h.br) { const k = sm(0, 1, G.time - q.t0); g.globalAlpha = 1 - 0.6 * k; g.fillStyle = '#dde6ee'; g.beginPath(); g.ellipse(x + Math.cos(q.a) * r * 0.85, y + Math.sin(q.a) * ry * 0.85 + k * 1.5, 4, 1.6, q.a, 0, TAU); g.fill(); }
    // затягивается: плёнка молодого льда
    if (fz > 0) { g.globalAlpha = fz * 0.92; g.fillStyle = '#9fb7cc'; edge(1.02, 0.4); g.fill(); g.globalAlpha = fz * 0.6; g.fillStyle = '#dde6ee'; edge(0.85, 0); g.fill(); }
    g.globalAlpha = 1;
  }
  function drawHoles(g, view) {
    if (!G) return;
    if (G.iceHoles) for (let i = G.iceHoles.length - 1; i >= 0; i--) { const h = G.iceHoles[i]; if (G.time - h.t0 > CYCLE * 1.2) G.iceHoles.splice(i, 1); }
    const [x0, y0, x1, y1] = view;
    for (const w of WET) if (w.x > x0 && w.x < x1 && w.y > y0 && w.y < y1) { g.globalAlpha = 0.4 * Math.min(1, w.life / w.max * 1.5) * (0.4 + 0.6 * w.k); g.fillStyle = '#5f7488'; g.beginPath(); g.ellipse(w.x, w.y, 3.2, 1.5, w.a, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    if (G.iceHoles) for (const h of G.iceHoles) if (h.x > x0 - 40 && h.x < x1 + 40 && h.y > y0 - 30 && h.y < y1 + 30) drawHole(g, h);
    drawCracks(g);
  }
  return { start, tick, inWater, active, pose, look, keepOut, rime, animal, sinkers, sinkPx, drawHoles, get phase() { return F ? F.ph : null; }, get log() { return log; }, get ep() { return F; }, DUR, PH, reset() { F = null; SINK.length = 0; WET.length = 0; } };
})();
