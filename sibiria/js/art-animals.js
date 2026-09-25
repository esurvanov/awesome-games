'use strict';
// ArtAnimals — процедурные звери «Сибири»: суставная 2D-модель (корпус по двум опорам таза/плеч,
// шея, голова, 4 ноги × 2 сегмента с IK, хвост), походки шаг/рысь/галоп с правильной
// последовательностью лап, позы. Мировые координаты, опора — лапы на снегу (y = земля).
// env = { now, night, eye(x, y, f, kind), light(x, y, r, t, a) }.
const ArtAnimals = (() => {
  const TAU = Math.PI * 2, M = new WeakMap();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, frac = v => v - Math.floor(v);
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const sin = Math.sin, cos = Math.cos;
  // свой поток случайности для «косметики» зверей (фаза, взгляд ворона): не тратит Math.random игры
  let rs = 0xA41A;
  const R = () => { rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // ---------- память зверя: фаза походки, сглаженная скорость, таймеры ----------
  function mem(o, env) {
    const now = env.now || 0;
    let m = M.get(o);
    if (!m) { m = { t: now, ph: R(), x: o.x, y: o.y, spd: 0, dy: 0, st: null, stT: now, gait: 'stand', pg: 'stand', gb: 1, idle: 0, hw: 0, look: 1, lookT: 0, flyT: 0, fly: 0, face: 1, bell: 0, hit: 0, seed: R() * 10, S: 10 }; M.set(o, m); }
    const dt = clamp(now - m.t, 0, 0.1); m.t = now; m.dt = dt;
    let vx = o.vx, vy = o.vy;
    if (vx === undefined) { vx = dt > 0 ? (o.x - m.x) / dt : 0; vy = dt > 0 ? (o.y - m.y) / dt : 0; if (Math.hypot(vx, vy) > 600) vx = vy = 0; }
    m.x = o.x; m.y = o.y;
    const raw = Math.hypot(vx, vy) || 0, kk = Math.min(1, dt * 8);
    m.spd += (raw - m.spd) * kk;
    if (raw > 5) m.dy += (vy / raw - m.dy) * kk; else m.dy *= 1 - kk;
    m.idle = m.spd < 4 ? m.idle + dt : 0;
    const st = o.st || '';
    if (st !== m.st) { m.st = st; m.stT = now; }
    m.el = now - m.stT;
    return m;
  }

  // ---------- походки ----------
  // лапы: 0 дальняя задняя (L), 1 ближняя задняя (R), 2 дальняя передняя (L), 3 ближняя передняя (R)
  const GAITS = {
    walk:   { o: [0, 0.5, 0.25, 0.75], d: 0.62, l: 0.2,  s: 11, r: 0.06 },  // латеральная последовательность
    amble:  { o: [0, 0.5, 0.12, 0.62], d: 0.66, l: 0.16, s: 12, r: 0.07 },  // медвежья иноходь
    trot:   { o: [0, 0.5, 0.5, 0],     d: 0.45, l: 0.3,  s: 17, r: 0.05 },  // диагонали
    gallop: { o: [0, 0.1, 0.6, 0.5],   d: 0.3,  l: 0.34, s: 24, r: 0.07 },  // ротационный галоп
  };
  function setGait(m, g) {
    if (g !== m.gait) { m.pg = m.gait; m.gait = g; m.gb = 0; }
    m.gb = Math.min(1, m.gb + m.dt * 5);
  }
  function advance(m, k) {
    const G = GAITS[m.gait]; if (!G) return;
    m.S = G.s + m.spd * G.r;
    m.ph = frac(m.ph + m.dt * m.spd * G.d / (m.S * k));
  }
  function footOf(gn, ph, i, bx, L, S) {
    const G = GAITS[gn]; if (!G) return [bx, 0];
    const p = frac(ph + G.o[i]);
    if (p < G.d) return [bx + S / 2 - S * p / G.d, 0];
    const q = (p - G.d) / (1 - G.d), reach = gn === 'gallop' && i > 1 ? L * 0.22 * sin(q * Math.PI) : 0;
    return [bx - S / 2 + S * q * q * (3 - 2 * q) + reach, -G.l * L * sin(q * Math.PI)];
  }
  function feet(m, rest, L) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      let p = footOf(m.gait, m.ph, i, rest[i], L[i], m.S);
      if (m.gb < 1) { const q = footOf(m.pg, m.ph, i, rest[i], L[i], m.S); p = [q[0] + (p[0] - q[0]) * m.gb, q[1] + (p[1] - q[1]) * m.gb]; }
      out.push(p);
    }
    return out;
  }
  function mix(a, b, t) {
    if (t <= 0) return a; if (t >= 1) return b;
    if (typeof a === 'number') return a + (b - a) * t;
    if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], t));
    const o = {}; for (const k in a) o[k] = k in b ? mix(a[k], b[k], t) : a[k]; return o;
  }

  // ---------- примитивы ----------
  function blob(g, pts) {
    const n = pts.length; let p = pts[n - 1], q = pts[0];
    g.moveTo((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    for (let i = 0; i < n; i++) { p = pts[i]; q = pts[(i + 1) % n]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
  }
  function fillBlob(g, pts, col) { g.fillStyle = col; g.beginPath(); blob(g, pts); g.fill(); }
  function poly(g, pts, col) { g.fillStyle = col; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill(); }
  function ell(g, x, y, rx, ry, col, r = 0) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, r, 0, TAU); g.fill(); }
  function frame(H, S) {
    const dx = S[0] - H[0], dy = S[1] - H[1], D = Math.hypot(dx, dy) || 1, nx = dy / D, ny = -dx / D;
    const F = (a, b) => [H[0] + dx * a + nx * b, H[1] + dy * a + ny * b];
    F.ang = Math.atan2(dy, dx); return F;
  }
  function knee(hx, hy, fx, fy, L1, L2, bend) {
    let dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy) || 0.01;
    const mx = L1 + L2 - 0.05;
    if (d > mx) { fx = hx + dx / d * mx; fy = hy + dy / d * mx; dx = fx - hx; dy = fy - hy; d = mx; }
    const c = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), a = Math.atan2(dy, dx) + bend * Math.acos(c);
    return [hx + cos(a) * L1, hy + sin(a) * L1, fx, fy];
  }
  function leg(g, h, f, L, bend, w1, w2, col, toe, paw) {
    const j = knee(h[0], h[1], f[0], f[1], L[0], L[1], bend), kx = j[0], ky = j[1];
    // бедро/плечо — мускулистая «капля» от сустава к колену
    const dx = kx - h[0], dy = ky - h[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux, a = w1 / 2, b = w2 * 0.6;
    fillBlob(g, [[h[0] + nx * a, h[1] + ny * a], [h[0] - ux * a * 0.7, h[1] - uy * a * 0.7], [h[0] - nx * a, h[1] - ny * a],
      [kx - nx * b, ky - ny * b], [kx + ux * b, ky + uy * b], [kx + nx * b, ky + ny * b]], col);
    g.strokeStyle = col; g.lineWidth = w2; g.beginPath(); g.moveTo(kx, ky); g.lineTo(j[2], j[3] - w2 * 0.3); g.lineTo(j[2] + toe, j[3] - w2 * 0.3); g.stroke();
    if (paw) { g.fillStyle = paw; g.fillRect(j[2] - w2 * 0.45, j[3] - 1.3, w2 * 0.9 + toe, 1.3); }
  }
  function shadow(g, x, y, rx, ry, a = 0.22) { g.fillStyle = `rgba(40,60,95,${a})`; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); }
  // хвост: изогнутая «морковка» от корня, θ — провис (0 горизонтально назад, π/2 вниз, <0 вверх)
  function tailPts(b, th, L, w, t0 = 0) {
    const ex = b[0] - cos(th) * L, ey = b[1] + sin(th) * L, c = [b[0] - cos(th * 0.35) * L * 0.6, b[1] + sin(th * 0.35) * L * 0.6];
    const at = t => { const u = 1 - t; return [u * u * b[0] + 2 * u * t * c[0] + t * t * ex, u * u * b[1] + 2 * u * t * c[1] + t * t * ey]; };
    const T = [t0, t0 + (1 - t0) * 0.4, t0 + (1 - t0) * 0.75, 1], W = t0 ? [0.75, 0.85, 0.6, 0.1] : [0.45, 1, 0.8, 0.12], L1 = [], R = [];
    for (let i = 0; i < 4; i++) {
      const p = at(T[i]), q = at(Math.min(1, T[i] + 0.05)), r = at(Math.max(0, T[i] - 0.05)), dx = q[0] - r[0], dy = q[1] - r[1], d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d * w * W[i], ny = dx / d * w * W[i];
      L1.push([p[0] + nx, p[1] + ny]); R.unshift([p[0] - nx, p[1] - ny]);
    }
    return L1.concat(R);
  }
  function frost(g, F, pts, a = 0.75) {
    g.fillStyle = `rgba(244,249,255,${a})`;
    for (const [u, v] of pts) { const p = F(u, v); g.fillRect(p[0] - 0.9, p[1] - 0.5, 1.8, 1); }
  }

  // ---------- общий рендер четвероногого ----------
  // SP: строение; P: поза; C: палитра
  function quad(g, o, env, m, SP, P, C, k, eyeKind) {
    const f = o.face < 0 ? -1 : 1, ad = Math.abs(m.dy), sx = 1 - 0.24 * ad, fy = -(1.4 + 3 * ad) + (P.farY || 0);
    const x = o.x, y = o.y, H = P.H, S = P.S;
    shadow(g, x + f * k * sx * (H[0] + S[0]) * 0.5, y + 1, (Math.abs(S[0] - H[0]) * 0.5 + SP.shw) * k * sx + 1.5 * ad * k, (3.5 + 1.8 * ad) * k * SP.shh);
    g.save(); g.translate(x, y); g.scale(f * k * sx, k);
    if (P.roll) g.rotate(P.roll);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const F = frame(H, S), Fb = P.bend, lw = SP.lw, lf = SP.lwF, toe = SP.toe;
    // дальние ноги (темнее, выше по экрану)
    leg(g, [H[0] + 1.5, H[1] + fy], [P.F[0][0] + 1.5, P.F[0][1] + fy], SP.hl, Fb[0], lw[0] * 0.85, lw[1] * 0.9, C.far, toe, SP.paw && C.pawF);
    leg(g, [S[0] + 1.5, S[1] + fy], [P.F[2][0] + 1.5, P.F[2][1] + fy], SP.fl, Fb[2], lf[0] * 0.85, lf[1] * 0.9, C.far, toe, SP.paw && C.pawF);
    SP.tail(g, F, P, C, m, env, o);
    fillBlob(g, SP.torso.map(p => F(p[0], p[1])), C.body);
    fillBlob(g, SP.saddle.map(p => F(p[0], p[1])), C.dark);
    fillBlob(g, SP.belly.map(p => F(p[0], p[1])), C.belly);
    if (SP.detail) SP.detail(g, F, P, C, m, env, o);
    // ближние ноги
    leg(g, H, P.F[1], SP.hl, Fb[1], lw[0], lw[1], C.leg, toe, SP.paw && C.paw);
    leg(g, S, P.F[3], SP.fl, Fb[3], lf[0], lf[1], C.leg, toe, SP.paw && C.paw);
    // шея
    const nb = F(SP.nb[0], SP.nb[1]), hd = P.hd, ca = cos(hd[2]), sa = sin(hd[2]);
    const nh = [hd[0] + SP.nh[0] * ca - SP.nh[1] * sa, hd[1] + SP.nh[0] * sa + SP.nh[1] * ca];
    g.strokeStyle = C.body; g.lineWidth = SP.nw; g.beginPath(); g.moveTo(nb[0], nb[1]);
    g.quadraticCurveTo((nb[0] + nh[0]) / 2 + 1, Math.min(nb[1], nh[1]) - 1, nh[0], nh[1]); g.stroke();
    if (SP.neck) SP.neck(g, F, P, C, nb, nh, m, env, o);
    // голова
    g.save(); g.translate(hd[0], hd[1]); g.rotate(hd[2]); SP.head(g, P, C, o, m, env); g.restore();
    g.restore();
    if (eyeKind && env.eye) {
      const ex = SP.eye[0], ey = SP.eye[1], lx = hd[0] + ex * ca - ey * sa, ly = hd[1] + ex * sa + ey * ca;
      env.eye(x + f * k * sx * lx, y + k * ly, f, eyeKind);
    }
  }

  // ======================= ВОЛК =======================
  const WOLF_C = { body: '#80868e', dark: '#565c64', mid: '#959ba2', belly: '#d3d8dd', far: '#5a6068', leg: '#8a9098', tip: '#2f3338', ear: '#a88f7a', inner: '#e6d7c8', paw: '#6a7078', pawF: '#4a4f56' };
  const LEAD_C = { body: '#5d6269', dark: '#363a40', mid: '#6d737a', belly: '#b7bcc2', far: '#3e4248', leg: '#5f646b', tip: '#1d2024', ear: '#6e5c4c', inner: '#b8a898', paw: '#474b51', pawF: '#303338' };
  function wolfHead(g, P, C, o, m, env, dog) {
    const ea = P.ear, jaw = P.jaw, mz = dog ? 0.8 : 1, lead = o.leader;
    // дальнее ухо
    poly(g, [[-3.6, -2.4], [-2.4 - 5.5 * ea, -10.5 + 5 * ea], [0.2, -3.4]], C.dark);
    ell(g, 0, 0, 5.2, 4.5, C.body);
    // нижняя челюсть
    if (jaw > 0.03) {
      poly(g, [[2.2, 1.1], [9.6 * mz, 0.6], [2 + 7.4 * mz * cos(jaw), 1.4 + 7.4 * mz * sin(jaw)]], '#5a1e1e');
      g.fillStyle = '#f4f1ea'; g.fillRect(7.4 * mz, 0.7, 0.9, 1.7); g.fillRect(3 + 5 * mz * cos(jaw), 1.2 + 5 * mz * sin(jaw) - 1.4, 0.8, 1.4);
    }
    g.save(); g.translate(2.2, 1.6); g.rotate(jaw);
    poly(g, [[0, -0.6], [7.2 * mz, -0.4], [6.8 * mz, 1], [0, 2]], C.mid); g.restore();
    fillBlob(g, [[1, -3.6], [6 * mz, -2.6], [10.6 * mz, -0.9], [10.8 * mz, 1.1], [7 * mz, 1.5], [1.5, 2.6]], C.body);
    fillBlob(g, [[4 * mz, 0.2], [10 * mz, 0.4], [9.6 * mz, 1.6], [4 * mz, 1.9]], C.belly); // светлая губа
    if (P.snarl) { g.fillStyle = '#f4f1ea'; g.fillRect(4.2 * mz, 1, 5 * mz, 0.9); g.fillStyle = '#6b2a2a'; g.fillRect(4 * mz, 0.1, 5.5 * mz, 0.8); }
    ell(g, -2.3, 2.6, 3.8, 3.4, C.belly); // щёки-«баки»
    ell(g, 10.5 * mz, -0.5, 1.5, 1.15, '#18191c');
    ell(g, 3.8, -1.6, 1.3, 0.75, P.snarl ? '#e0b030' : '#c9a040', -0.15);
    g.fillStyle = '#111'; g.fillRect(3.8, -2, 0.7, 0.9);
    // ближнее ухо
    const tip = [-1.2 - 6 * ea, -11 + 5.4 * ea];
    if (lead) poly(g, [[-3, -2.8], [tip[0], tip[1] + 1.5], [tip[0] + 1.3, tip[1] + 3], [tip[0] + 1.6, tip[1] + 1.2], [2, -3.4]], C.body);
    else poly(g, [[-3, -2.8], tip, [2, -3.4]], C.body);
    poly(g, [[-1.6, -3.3], [tip[0] + 1.1, tip[1] + 2.8], [0.8, -3.5]], dog ? C.inner : C.ear);
    if (lead) { g.strokeStyle = '#c98b86'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(1.8, -4.4); g.lineTo(4.8, -0.4); g.lineTo(6.4, 0.6); g.stroke(); }
  }
  function wolfTail(g, F, P, C, m, env, o) {
    const b = F(-0.2, 2.8), L = 15 * P.tail[1], th = P.tail[0] + sin(env.now * 3.1 + m.seed) * 0.06;
    fillBlob(g, tailPts(b, th, L, 3), C.body);
    fillBlob(g, tailPts(b, th, L, 3, 0.62), C.tip);
  }
  function wolfDetail(g, F, P, C, m, env, o) {
    // загривок: рваный край шерсти; при угрозе — шерсть дыбом
    const hk = P.hack;
    g.fillStyle = hk > 0.3 ? C.tip : C.dark; g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = 0.42 + i * 0.1, b0 = 6.2 + (i > 2 ? 0.8 : 0), h = 1.2 + hk * (2.6 + (i % 2) * 1.6);
      const p = F(a + 0.05, b0 - 0.5), q = F(a - 0.06 - hk * 0.02, b0 + h), r = F(a - 0.05, b0 - 0.5);
      g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.lineTo(r[0], r[1]);
    }
    g.fill();
    frost(g, F, [[-0.05, 5.2], [0.2, 5.6], [0.45, 5.4], [0.7, 6.6], [0.88, 7.4]], 0.8);
    if (o.hurt) { const p = F(0.72, -2); ell(g, p[0], p[1], 2.6, 1.8, '#7a1f1f', 0.3); g.fillStyle = '#9b2a22'; g.fillRect(p[0] - 0.4, p[1] + 1, 0.9, 2.4); }
  }
  function wolfNeck(g, F, P, C, nb, nh) {
    const p = F(1.12, -3.5); ell(g, p[0], p[1], 2.6, 4.4, C.belly, F.ang + 0.35); // светлая грудь
  }
  const WOLF = {
    hl: [9, 10.4], fl: [8.6, 10.6], lw: [10, 2.6], lwF: [7, 2.6], toe: 1.3, paw: 1, shw: 9, shh: 1,
    torso: [[-0.3, 1], [-0.12, 5.5], [0.35, 5.2], [0.8, 7], [1.12, 4.5], [1.25, -2], [1.08, -8], [0.62, -6.2], [0.15, -6], [-0.2, -4]],
    saddle: [[-0.24, 3.8], [0.2, 6], [0.6, 6.2], [0.95, 7.6], [1.02, 3.5], [0.6, 2.4], [0.1, 1.6]],
    belly: [[1.06, -8.2], [0.62, -6.6], [0.15, -6.4], [0.2, -4.6], [0.62, -4.8], [1.0, -5.6]],
    hip: [0.02, -0.6, 6.4, 7.6], sho: [0.9, -0.5, 6.5, 4.2], nb: [0.98, 1.6], nh: [-2.8, 1], nw: 8.5,
    eye: [3.8, -1.6], tail: wolfTail, detail: wolfDetail, neck: wolfNeck, head: (g, P, C, o, m, env) => wolfHead(g, P, C, o, m, env, 0),
  };
  const SIT = { H: [-7.5, -7.5], S: [8, -21], F: [[3, 0], [2, 0], [10.5, 0], [9, 0]], bend: [-1, -1, -1, -1], sitK: 1 };
  function wolfPose(m, w, now) {
    const st = w.st || 'scout', ph = m.ph, g = m.gait, lead = w.leader;
    const P = { H: [-12, -18], S: [10, -19], F: null, bend: [1, 1, -1, -1], hd: [22, -25, 0.12], jaw: 0, ear: 0.05, tail: [lead ? 0.55 : 1.05, 1], hack: 0, snarl: 0, roll: 0, sitK: 0 };
    P.F = feet(m, [-11, -11, 10.5, 10.5], [19, 19, 19, 19]);
    if (g === 'walk' || g === 'trot') {
      const a = g === 'walk' ? 0.6 : 1;
      P.H[1] += a * cos(ph * TAU * 2); P.S[1] += a * cos(ph * TAU * 2 + 1.6); P.hd[1] += a * 0.7 * cos(ph * TAU * 2 + 2.2);
      if (g === 'trot') { P.hd = [23.5, -21.5 + a * 0.6 * cos(ph * TAU * 2 + 2.2), 0.3]; P.tail[0] = lead ? 0.4 : 0.75; }
    } else if (g === 'gallop') {
      const e = cos(ph * TAU), b = sin(ph * TAU);
      P.H[0] += 2.4 * e; P.S[0] -= 2.2 * e; P.H[1] += -1.4 * b - 1; P.S[1] += 1.6 * b - 1.2;
      P.hd = [24 - 2 * e, -21.5 + 1.8 * b, 0.12 + 0.1 * b]; P.tail = [0.3 + 0.15 * b, 1]; P.ear = 0.55;
    } else {
      const br = sin(now * 2.2 + m.seed) * 0.35; P.S[1] += br; P.H[1] += br * 0.5;
      if (st === 'scout' && sin(now * 0.6 + m.seed) > 0.55) { P.hd = [20.5, -10, 1.05]; P.ear = 0; } // принюхивается
      else P.hd[2] += sin(now * 0.9 + m.seed) * 0.08;
    }
    if (st === 'circle') { P.hd[1] += 2; P.hd[2] += 0.12; P.ear = 0.25; P.tail[0] = lead ? 0.3 : 0.6; }
    if (st === 'lunge') { P.ear = 0.8; P.jaw = 0.38; P.hd[2] -= 0.1; }
    if (st === 'flee') { P.ear = 0.9; P.tail = [2.05, 0.9]; }
    if (st === 'retreat') { P.ear = 0.6; P.tail = [1.45, 1]; }
    if (w.hurt) { // хромота: ближняя передняя почти не опирается, плечо проваливается
      const G = GAITS[g];
      if (G) { const p = frac(ph + G.o[3]); if (p < G.d) { P.F[3][1] = Math.min(P.F[3][1], -2.2); P.S[1] += 1.8 * sin(p / G.d * Math.PI); P.hd[1] += 1.4 * sin(p / G.d * Math.PI); } }
      else P.F[3] = [12.5, -2.5];
    }
    // припадание перед броском
    if (st === 'crouch') {
      const tr = sin(now * 45) * 0.3;
      const C = { H: [-11.5 + tr, -12.5], S: [9 + tr, -11.5], F: [[-10, 0], [-9, 0], [12, 0], [11.5, 0]], bend: [1, 1, -1, -1], hd: [19.5, -12.5, 0.02], jaw: 0.2, ear: 1, tail: [0.35, 1], hack: 1, snarl: 1, roll: 0, sitK: 0 };
      return mix(P, C, sstep(0, 0.22, m.el));
    }
    // вой (сидя)
    m.hw = clamp(m.hw + (w.howl ? m.dt : -m.dt) * 2.5, 0, 1);
    if (m.hw > 0) {
      const puls = 0.28 + 0.12 * sin(now * 3);
      const Hw = Object.assign({}, P, SIT, { hd: [14, -33, -1.15], jaw: puls, ear: 0.35, tail: [0.12, 1], hack: 0, snarl: 0 });
      return mix(P, Hw, sstep(0, 1, m.hw));
    }
    return P;
  }
  function wolf(g, w, env) {
    const m = mem(w, env), st = w.st || 'scout', k = w.leader ? 1.16 : 1, spd = m.spd / k;
    const fast = st === 'lunge' || st === 'flee' || st === 'retreat';
    let gait = spd < 4 ? 'stand' : (fast && spd > 60) || spd > 135 ? 'gallop' : spd > 50 || st === 'circle' ? 'trot' : 'walk';
    if (st === 'crouch' || w.howl) gait = 'stand';
    setGait(m, gait); advance(m, k);
    const P = wolfPose(m, w, env.now);
    quad(g, w, env, m, WOLF, P, w.leader ? LEAD_C : WOLF_C, k, st === 'crouch' || st === 'lunge' ? 'wolfRed' : 'wolf');
  }

  // ======================= МЕДВЕДЬ =======================
  const BEAR_C = { body: '#4b3628', dark: '#35261c', mid: '#553e2e', belly: '#5e4634', far: '#2e2118', leg: '#3f2d21', muz: '#8a6a4c', paw: '#241a13', pawF: '#1c140f', tuft: '#6b513c' };
  function bearHead(g, P, C) {
    const jaw = P.jaw;
    ell(g, -2.8, -5.8, 2.6, 2.4, C.dark); // дальнее ухо
    ell(g, 0, 0, 8, 7, C.body);
    if (jaw > 0.03) {
      poly(g, [[3, 1.4], [12, 0.8], [3 + 9 * cos(jaw), 2 + 9 * sin(jaw)]], '#5c1a18');
      g.fillStyle = '#f1ece0'; g.fillRect(9.6, 0.9, 1, 2.2); g.fillRect(3 + 7.5 * cos(jaw), 2 + 7.5 * sin(jaw) - 2, 1, 2);
    }
    g.save(); g.translate(3, 2.4); g.rotate(jaw); poly(g, [[0, -1], [8.4, -0.6], [8, 1.4], [0, 2.6]], C.muz); g.restore();
    fillBlob(g, [[2, -4], [8, -2.4], [12.2, -0.8], [12.2, 1.6], [8, 2], [3, 3.6]], C.muz);
    ell(g, 12, -0.3, 1.9, 1.5, '#161110');
    ell(g, 3.6, -2.6, 1, 1, '#120c09');
    ell(g, 0.2, -6.4, 2.6, 2.4, C.body); ell(g, 0.4, -6.2, 1.3, 1.2, C.tuft);
    g.fillStyle = 'rgba(244,249,255,0.7)'; g.fillRect(-3, -5.2, 2, 0.9); g.fillRect(-1, -6, 1.5, 0.8);
  }
  function bearTail(g, F, P, C) { const b = F(-0.24, 3); ell(g, b[0], b[1], 3.2, 2.6, C.dark); }
  function bearDetail(g, F, P, C, m, env) {
    // клочья шерсти по горбу и спине
    g.fillStyle = C.dark; g.beginPath();
    const BH = [7.4, 8.8, 10, 11.6, 13, 13.2, 11.8], BL = [1.4, 2.2, 1.2, 2.6, 1.6, 2.4, 1.3];
    for (let i = 0; i < 7; i++) { const a = -0.14 + i * 0.16, bb = BH[i]; const p = F(a + 0.02, bb - 1.6), q = F(a - 0.07, bb + BL[i]), r = F(a - 0.08, bb - 1.4); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.lineTo(r[0], r[1]); }
    g.fill();
    g.strokeStyle = C.tuft; g.lineWidth = 1.1; g.beginPath();
    for (const [a, b] of [[0.12, -3], [0.42, -6], [0.72, -7.5], [0.3, 1.5]]) { const p = F(a, b), q = F(a - 0.06, b - 2.5); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }
    g.stroke();
    frost(g, F, [[0.05, 7.8], [0.25, 9.4], [0.45, 11.4], [0.62, 12.8], [0.78, 13], [0.9, 12]], 0.8);
  }
  const BEAR = {
    hl: [14, 14], fl: [13.5, 16.5], lw: [17, 7.5], lwF: [14, 7], toe: 2.2, paw: 1, shw: 16, shh: 1.5,
    torso: [[-0.32, 2], [-0.18, 8], [0.25, 10], [0.7, 13.5], [0.98, 11], [1.18, 3], [1.15, -9], [0.7, -10.5], [0.2, -10], [-0.22, -6]],
    saddle: [[-0.2, 6.5], [0.3, 9.6], [0.7, 13], [0.95, 10.5], [0.72, 7.5], [0.25, 5], [-0.1, 3]],
    belly: [[1.05, -9.5], [0.7, -10.2], [0.2, -9.6], [0.25, -7.5], [0.7, -8], [1.0, -7.5]],
    hip: [0.02, -1, 9.5, 11], sho: [0.88, 0, 9, 6], nb: [1.0, 3], nh: [-4, 1], nw: 15,
    eye: [3.6, -2.6], tail: bearTail, detail: bearDetail, head: bearHead,
  };
  function bearPose(m, b, now) {
    const st = b.st || 'wander', ph = m.ph, g = m.gait;
    const P = { H: [-17, -27], S: [15, -29], F: null, bend: [1, 1, -1, -1], hd: [34, -24.5, 0.22], jaw: 0, roll: 0, farY: 0, rear: 0 };
    P.F = feet(m, [-16, -16, 16, 16], [28, 28, 30, 30]);
    if (g === 'amble' || g === 'trot') {
      const a = g === 'amble' ? 1.1 : 1.6;
      P.H[1] += a * cos(ph * TAU * 2); P.S[1] += a * cos(ph * TAU * 2 + 1.3);
      P.hd[1] += 2 * sin(ph * TAU * 2 + 0.5); P.hd[2] += 0.08 * sin(ph * TAU); P.roll = 0.025 * sin(ph * TAU);
    } else if (g === 'gallop') {
      const e = cos(ph * TAU), bb = sin(ph * TAU);
      P.H[0] += 3 * e; P.S[0] -= 2.5 * e; P.H[1] += -2 * bb - 1; P.S[1] += 2.2 * bb - 1;
      P.hd = [35 - 2 * e, -23 + 2.5 * bb, 0.12 + 0.1 * bb];
    } else {
      const br = sin(now * 1.6 + m.seed) * 0.5; P.S[1] += br; P.hd[1] += br; P.hd[2] += sin(now * 0.7 + m.seed) * 0.1;
    }
    if (st === 'charge') P.jaw = 0.25;
    if (st === 'stun') {
      P.hd = [33 + sin(now * 11) * 1.2, -22 + sin(now * 22) * 1.5, 0.35 + sin(now * 24) * 0.4]; P.roll = sin(now * 6) * 0.04;
    }
    if (st === 'windup') {
      const wv = sin(now * 9), R = { H: [-6, -25], S: [2, -55], F: [[-12, 0], [0, 0], [19 + wv * 2, -66 - wv], [23 - wv * 2, -58 + wv]], bend: [-1, -1, 1, 1], hd: [7, -67, -0.6], jaw: 0.75, roll: 0, farY: 0, rear: 1 };
      return mix(P, R, sstep(0, 0.28, m.el));
    }
    return P;
  }
  function bear(g, b, env) {
    const m = mem(b, env), st = b.st || 'wander', k = 1, spd = m.spd;
    let gait = spd < 4 ? 'stand' : (st === 'charge' || st === 'flee') && spd > 60 ? 'gallop' : spd > 160 ? 'gallop' : spd > 100 ? 'trot' : 'amble';
    if (st === 'windup' || st === 'stun') gait = 'stand';
    setGait(m, gait); advance(m, 1.45);
    const P = bearPose(m, b, env.now);
    quad(g, b, env, m, BEAR, P, BEAR_C, k, 'bear');
    if (P.rear > 0.6) { // когти на поднятых лапах
      const f = b.face < 0 ? -1 : 1; g.fillStyle = '#e8e2d4';
      for (const q of [P.F[2], P.F[3]]) for (let i = 0; i < 3; i++) g.fillRect(b.x + f * (q[0] + 1 + i * 1.6), b.y + q[1] - 2.5 + i * 0.3, 0.9, 2.2);
    }
    if (st === 'stun') { // звёздочки
      const f = b.face < 0 ? -1 : 1;
      g.fillStyle = '#ffe58a';
      for (let i = 0; i < 3; i++) { const a = env.now * 5 + i * TAU / 3; g.fillRect(b.x + f * 33 + cos(a) * 10 - 1, b.y - 36 + sin(a) * 3.5 - 1, 2.2, 2.2); }
    }
  }

  // ======================= ЛАЙКА =======================
  const DOG_C = { body: '#a7aeb6', dark: '#737a84', mid: '#b4bac1', belly: '#e9ecef', far: '#7c838c', leg: '#b6bcc3', tip: '#e9ecef', inner: '#e8c9c0', paw: '#e3e6ea', pawF: '#aab1b9' };
  const PET_C = { body: '#f1f3f5', dark: '#9aa2ac', mid: '#f7f8f9', belly: '#ffffff', far: '#c3c9d0', leg: '#eef0f2', tip: '#ffffff', inner: '#efc9c2', paw: '#ffffff', pawF: '#cfd4da' };
  function dogTail(g, F, P, C, m, env) {
    const c = F(0.0, 8.2 - (P.sitK || 0) * 2.5), r = 3.4, wag = sin(env.now * (P.wag || 2) + m.seed) * 0.1;
    const a0 = F.ang + Math.PI * 0.5 + 1.2 + wag;
    g.strokeStyle = C.dark; g.lineWidth = 6.4; g.beginPath(); g.arc(c[0], c[1], r, a0, a0 + 4.6); g.stroke();
    g.strokeStyle = C.tip; g.lineWidth = 3.4; g.beginPath(); g.arc(c[0] - 0.4, c[1] - 0.3, r, a0 + 0.5, a0 + 4.8); g.stroke();
  }
  function dogDetail(g, F, P, C, m, env, o) {
    frost(g, F, [[0.2, 5.4], [0.5, 5.6], [0.8, 7]], 0.55);
  }
  const DOG = Object.assign({}, WOLF, {
    lw: [10.5, 2.9], lwF: [7.5, 2.9], shw: 8, tail: dogTail, detail: dogDetail,
    torso: [[-0.3, 1], [-0.12, 5.8], [0.35, 5.6], [0.8, 7.2], [1.12, 4.8], [1.28, -2], [1.08, -8], [0.62, -6.8], [0.15, -6.4], [-0.22, -4]],
    head: (g, P, C, o, m, env) => wolfHead(g, P, C, o, m, env, 1),
  });
  function dog(g, u, env) {
    const m = mem(u, env), now = env.now, k = 0.68, spd = m.spd / k;
    let gait = spd < 4 ? 'stand' : spd > 150 ? 'gallop' : spd > 55 ? 'trot' : 'walk';
    setGait(m, gait); advance(m, k);
    const ph = m.ph;
    let P = { H: [-12, -18.5], S: [10, -19.5], F: feet(m, [-11, -11, 10.5, 10.5], [19, 19, 19, 19]), bend: [1, 1, -1, -1], hd: [21.5, -26.5, 0.05], jaw: 0, ear: 0, tail: [0, 1], hack: 0, snarl: 0, roll: 0, sitK: 0, wag: 3 };
    if (gait === 'walk' || gait === 'trot') { const a = gait === 'walk' ? 0.6 : 1.1; P.H[1] += a * cos(ph * TAU * 2); P.S[1] += a * cos(ph * TAU * 2 + 1.6); P.hd[1] += a * 0.8 * cos(ph * TAU * 2 + 2.2); P.wag = 6; }
    else if (gait === 'gallop') { const e = cos(ph * TAU), b = sin(ph * TAU); P.H[0] += 2.4 * e; P.S[0] -= 2.2 * e; P.H[1] += -1.4 * b - 1; P.S[1] += 1.6 * b - 1.2; P.hd = [23.5 - 2 * e, -23 + 1.8 * b, 0.1]; P.ear = 0.3; }
    else P.hd[2] += sin(now * 0.8 + m.seed) * 0.12;
    if (u.bark) { const j = Math.max(0, sin(now * 15)); P.jaw = j * 0.5; P.hd[2] -= 0.15 + j * 0.1; P.S[0] += j * 0.8; P.H[1] += j * 0.4; P.wag = 10; }
    const sk = sstep(0.8, 1.5, m.idle);
    if (sk > 0 && !u.bark) P = mix(P, Object.assign({}, P, SIT, { hd: [16, -33, 0.05 + sin(now * 0.8 + m.seed) * 0.12] }), sk);
    else if (sk > 0) P = mix(P, Object.assign({}, P, SIT, { hd: [16, -34, -0.3 + P.jaw * -0.2] }), sk);
    quad(g, u, env, m, DOG, P, u.pet ? PET_C : DOG_C, k, null);
  }

  // ======================= СЕВЕРНЫЙ ОЛЕНЬ =======================
  const DEER_C = { body: '#76634f', dark: '#54463a', mid: '#8a7660', belly: '#d8ccb8', far: '#4c3f33', leg: '#6a5846', mane: '#ece4d4', ant: '#dccdb2', antF: '#b4a58c', paw: '#2c241d', pawF: '#241d17' };
  function deerHead(g, P, C) {
    const ch = P.jaw;
    // рога: дальний и ближний
    g.save(); g.scale(0.82, 0.82);
    for (const [dx, dy, col] of [[2, -1.2, C.antF], [0, 0, C.ant]]) {
      g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath();
      g.moveTo(-1 + dx, -3 + dy); g.quadraticCurveTo(-8 + dx, -12 + dy, -5 + dx, -22 + dy); g.quadraticCurveTo(-3 + dx, -27 + dy, 2 + dx, -28 + dy);
      g.moveTo(-5.5 + dx, -11 + dy); g.lineTo(1 + dx, -14 + dy);
      g.moveTo(-5.4 + dx, -18 + dy); g.lineTo(-0.5 + dx, -21 + dy);
      g.moveTo(-3.6 + dx, -25 + dy); g.lineTo(-5.5 + dx, -29.5 + dy);
      g.moveTo(-2.8 + dx, -6.5 + dy); g.lineTo(3 + dx, -8.5 + dy); g.lineTo(5 + dx, -6.4 + dy); // надглазничный отросток-«лопата»
      g.stroke();
    }
    g.restore();
    ell(g, -1, -2.6, 3.6, 1.3, C.dark, -0.5); // ухо
    g.save(); g.translate(3, 2); g.rotate(ch); poly(g, [[0, -0.8], [7, -0.4], [6.6, 1.2], [0, 1.6]], C.mid); g.restore();
    fillBlob(g, [[-3.5, -3], [3, -3.2], [10.5, -1.4], [11.4, 1.2], [6, 2.2], [-2.5, 3]], C.body);
    ell(g, 10.3, 0, 1.9, 1.7, '#b9ac98'); // мохнатый нос
    ell(g, 2.2, -1.4, 1.1, 0.9, '#140f0b');
    g.fillStyle = '#fff'; g.fillRect(2.3, -1.9, 0.5, 0.5);
  }
  function deerTail(g, F) { const b = F(-0.27, 2.5); ell(g, b[0], b[1], 2, 2.8, '#efe8dc', F.ang + 0.5); }
  function deerDetail(g, F, P, C) {
    const r = F(-0.14, -0.5); ell(g, r[0], r[1], 3, 4.4, '#e8e0d2', F.ang + 0.2); // светлое «зеркало»
    frost(g, F, [[0.1, 6], [0.35, 6.3], [0.6, 6.4], [0.85, 7.4]], 0.7);
  }
  function deerNeck(g, F, P, C, nb, nh, m, env, o) {
    // белая грива под шеей
    const mx = nb[0] * 0.45 + nh[0] * 0.55, my = nb[1] * 0.45 + nh[1] * 0.55 + 3;
    fillBlob(g, [[nb[0] + 2, nb[1] + 1], [mx - 0.5, my + 3.8], [nh[0] + 1, nh[1] + 3.2], [nh[0] + 2, nh[1] + 1.4], [mx + 1.5, my], [nb[0] + 3.5, nb[1] - 1.5]], C.mane);
    // колокольчик на ремешке
    const ba = m.bell, bx = mx - 0.5, by = my + 1.8, ex = bx + sin(ba) * 4.2, ey = by + cos(ba) * 4.2;
    g.strokeStyle = '#7a3b24'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(bx - 2.5, by - 1.5); g.lineTo(bx, by); g.lineTo(ex, ey); g.stroke();
    ell(g, ex, ey + 1, 1.9, 2.2, '#d6a743', ba); g.fillStyle = '#6b4a14'; g.fillRect(ex - 0.6, ey + 2.6, 1.2, 0.8);
  }
  const DEER = {
    hl: [12.5, 14], fl: [12, 14.5], lw: [10, 2.3], lwF: [7.5, 2.3], toe: 1, paw: 1, shw: 11, shh: 1.2,
    torso: [[-0.3, 0.5], [-0.12, 5.6], [0.35, 5.8], [0.8, 7.2], [1.1, 5.5], [1.22, -2], [1.05, -8.4], [0.6, -7.4], [0.15, -7], [-0.2, -4.5]],
    saddle: [[-0.24, 3.5], [0.2, 5.5], [0.6, 5.6], [0.95, 6.8], [1.0, 3], [0.6, 2], [0.1, 1.5]],
    belly: [[1.0, -7], [0.6, -6.3], [0.2, -5.8], [0.25, -4.4], [0.6, -4.5], [0.98, -4.8]],
    nb: [1.0, 2.5], nh: [-3, 1.5], nw: 9,
    eye: [2.2, -1.4], tail: deerTail, detail: deerDetail, neck: deerNeck, head: deerHead,
  };
  function deer(g, d, env) {
    const m = mem(d, env), now = env.now, k = 1, spd = m.spd;
    const gait = spd < 4 ? 'stand' : spd > 115 ? 'gallop' : spd > 55 ? 'trot' : 'walk';
    setGait(m, gait); advance(m, 1.4);
    const ph = m.ph, sd = (d.ph || 0) + m.seed;
    let P = { H: [-15, -25], S: [13, -26], F: feet(m, [-14, -14, 13.5, 13.5], [26, 26, 26, 26]), bend: [1, 1, -1, -1], hd: [28, -37, 0.18], jaw: 0 };
    if (gait === 'walk' || gait === 'trot') { const a = gait === 'walk' ? 0.7 : 1.1; P.H[1] += a * cos(ph * TAU * 2); P.S[1] += a * cos(ph * TAU * 2 + 1.6); P.hd[1] += 1.2 * cos(ph * TAU * 2 + 2); if (gait === 'trot') P.hd = [29.5, -35, 0.1]; }
    else if (gait === 'gallop') { const e = cos(ph * TAU), b = sin(ph * TAU); P.H[0] += 2.6 * e; P.S[0] -= 2.4 * e; P.H[1] += -1.6 * b - 1; P.S[1] += 1.8 * b - 1; P.hd = [30.5 - 2 * e, -33 + 2 * b, 0]; }
    else {
      // пасётся: голова в снег, жуёт, изредка поднимает голову и копытит
      const cyc = frac(now * 0.09 + sd * 0.1), down = sstep(0.05, 0.14, cyc) * (1 - sstep(0.72, 0.8, cyc));
      const G = { H: [-15, -25], S: [13, -24.5], F: P.F.map(v => v.slice()), bend: P.bend, hd: [25, -6, 1.25], jaw: 0.12 * Math.abs(sin(now * 8)) };
      if (sin(now * 1.1 + sd) > 0.75) { const s = sin(now * 13); G.F[3] = [15 + 3 * s, -2 - 2 * Math.abs(s)]; }
      P.hd[2] += sin(now * 0.8 + sd) * 0.1;
      P = mix(P, G, down);
    }
    // колокольчик: маятник, подгоняемый шагом
    const drive = Math.min(0.8, spd / 70) * sin(ph * TAU * 2), ob = m.bell;
    m.bell += ((drive + sin(now * 1.7 + sd) * 0.08) - m.bell) * Math.min(1, m.dt * 10);
    if (spd > 10 && Math.sign(ob) !== Math.sign(m.bell)) m.hit = 1;
    quad(g, d, env, m, DEER, P, DEER_C, k, null);
  }

  // ======================= ЗАЯЦ-БЕЛЯК =======================
  function hare(g, h, env) {
    const m = mem(h, env), now = env.now, f = h.face < 0 ? -1 : 1, moving = m.spd > 5 || (h.vx || h.vy);
    const p = moving ? frac((h.hop || 0) / Math.PI) : 0, air = moving ? sin(p * Math.PI) : 0;
    const st = moving ? clamp(air * 1.4, 0, 1) : 0, lift = air * 7, sx = 1 - 0.22 * Math.abs(m.dy);
    const pitch = moving ? (p < 0.5 ? -0.25 : 0.22) * st : 0;
    shadow(g, h.x, h.y + 1, 9 * (1 - air * 0.25) * sx, 3.2 * (1 - air * 0.25), 0.2);
    g.save(); g.translate(h.x, h.y - lift); g.scale(f * sx, 1);
    const cx = -2 + 2 * st, cy = -7 - st, rx = 7.5 + 3 * st, ry = 6 - 1.8 * st, rot = -0.35 * (1 - st) + pitch;
    const hx = 5 + 5.5 * st, hy = -12.5 + 3 * st + (moving ? 0 : sin(now * 1.3 + m.seed) * 0.3);
    // задние лапы
    g.lineCap = 'round'; g.strokeStyle = '#c9d3de'; g.lineWidth = 3;
    g.beginPath();
    if (st > 0.2) { g.moveTo(cx - rx * 0.6, cy + 2); g.lineTo(cx - rx - 4 * st, cy + 5 + 2 * st); }
    else { g.moveTo(-8, -1.2); g.lineTo(1, -1.2); }
    g.stroke();
    // уши (дальнее)
    const tw = sin(now * 2.3 + m.seed) * 0.1 + Math.max(0, sin(now * 0.9 + m.seed * 2) - 0.85) * 3;
    const ea = moving ? -2.55 + 0.5 * (1 - st) : -1.62 + tw, eb = moving ? -2.45 : -1.4 - tw * 0.6;
    const ear = (a, dx, col, tip) => {
      const bx = hx - 1.5 + dx, by = hy - 2.5;
      ell(g, bx + cos(a) * 5, by + sin(a) * 5, 6.1, 2.2, 'rgba(120,140,170,0.6)', a);
      ell(g, bx + cos(a) * 5, by + sin(a) * 5, 5.6, 1.7, col, a);
      ell(g, bx + cos(a) * 9.6, by + sin(a) * 9.6, 1.7, 1.25, tip, a);
    };
    ear(eb, 1.2, '#d6dee8', '#2a2a2e');
    // тело: контур, тень, свет
    ell(g, cx, cy, rx + 0.8, ry + 0.8, 'rgba(120,140,170,0.55)', rot);
    ell(g, cx, cy + 0.6, rx, ry, '#dbe3ec', rot);
    ell(g, cx + 0.5, cy - 0.8, rx - 1.2, ry - 1.4, '#fbfdff', rot);
    ell(g, cx - rx + 0.5, cy - 1.5, 2.4, 2.3, '#ffffff'); // хвостик
    // передние лапы
    g.strokeStyle = '#e4eaf1'; g.lineWidth = 2.2; g.beginPath();
    if (st > 0.2) { const fx = cx + rx * 0.7; g.moveTo(fx, cy + 2); g.lineTo(fx + 4 + 2 * (p > 0.5 ? 1 : -0.5), cy + 7 + lift * 0.4 * (p > 0.5 ? 1 : 0.3)); }
    else { g.moveTo(4, -5); g.lineTo(5.2, -0.8); }
    g.stroke();
    // голова
    ell(g, hx, hy, 4.6, 3.9, 'rgba(120,140,170,0.55)', 0.25 + pitch);
    ell(g, hx, hy, 4.2, 3.6, '#fbfdff', 0.25 + pitch);
    ear(ea, 0, '#f4f7fb', '#1c1c20');
    ell(g, hx + 1.3, hy - 0.8, 1.15, 1.25, '#1a1a1e');
    g.fillStyle = '#fff'; g.fillRect(hx + 1.3, hy - 1.4, 0.5, 0.5);
    const nw = moving ? 0 : sin(now * 18) * 0.35 * (sin(now * 0.7 + m.seed) > 0 ? 1 : 0);
    ell(g, hx + 4, hy + 0.6 + nw, 0.9, 0.7, '#c98f96');
    g.restore();
  }

  // ======================= ВОРОН =======================
  function raven(g, rv, env) {
    const m = mem(rv, env), now = env.now, x = rv.x, y = rv.y - (rv.z || 0);
    if (rv.fly && !m.fly) m.flyT = now; m.fly = rv.fly ? 1 : 0;
    const B = '#15171b', B2 = '#262a31', SH = '#3a4250';
    if (!rv.fly) {
      if (now > m.lookT) { m.lookT = now + 0.6 + R() * 2.2; m.look = [1, -1, 0.25, 1][(R() * 4) | 0]; if (R() < 0.5) m.face = -m.face; }
      const f = m.face, caw = sin(now * 0.8 + m.seed) > 0.93 ? Math.abs(sin(now * 20)) : 0;
      g.save(); g.translate(x, y); g.scale(f, 1);
      poly(g, [[-2.5, -3.2], [-10.5, -0.2], [-10, 1.6], [-2.5, -1.2]], B);
      ell(g, 0, -4.6 - caw * 0.4, 5.2, 3.5, B, -0.35);
      ell(g, -0.6, -4.2, 3.4, 2, B2, -0.3); // сложенное крыло
      g.strokeStyle = '#2b2f36'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(-0.8, -1.2); g.lineTo(-1.2, 0.6); g.moveTo(1.2, -1.2); g.lineTo(1.4, 0.6); g.stroke();
      const lk = m.look, hx = 3.6, hy = -8.3 - caw * 0.8, tl = sin(now * 1.7 + m.seed) * 0.15;
      ell(g, hx, hy, 2.8, 2.6, B);
      poly(g, [[hx + 1.2 * lk, hy - 1.1], [hx + 1.2 * lk + 4.4 * lk, hy + 0.1 + tl * 4], [hx + 1.2 * lk, hy + 0.9 + caw * 1.6]], '#0b0c0e');
      if (lk !== 0.25) { g.fillStyle = '#9aa6b8'; g.fillRect(hx + 0.6 * lk - 0.3, hy - 0.9, 0.7, 0.7); }
      g.restore();
      return;
    }
    // полёт: вид сверху-сбоку, курс по скорости
    const vx = rv.vx || 0, vy = rv.vy || 0, a = Math.atan2(vy * 0.55, vx || 0.001), el = now - m.flyT;
    const flapping = el < 1.6 || sin(now * 0.9 + m.seed) > 0.35;
    m.ph = flapping ? m.ph + m.dt * (el < 1.6 ? 2.6 : 1.7) : m.ph;
    const fl = flapping ? sin(m.ph * TAU) : 0.15 + sin(now * 1.3) * 0.05;
    const sz = 1 + Math.min(0.35, (rv.z || 0) / 400);
    if (rv.z) { const sa = clamp(0.28 - rv.z / 600, 0.06, 0.28); shadow(g, rv.x, rv.y, 7, 2.2, sa); }
    g.save(); g.translate(x, y); g.rotate(a); g.scale(sz, sz);
    const span = 0.45 + 0.55 * Math.abs(cos(fl * 1.2)), sweep = fl * 2.5, lift = -fl * 3;
    for (const s of [-1, 1]) {
      const sp = s * span, W = [[2, s * 0.8], [2.6 + sweep * 0.4, 5 * sp + lift], [-0.5 + sweep, 12.5 * sp + lift * 1.6], [-3.4 + sweep, 12.2 * sp + lift * 1.6], [-2.8 + sweep, 10.4 * sp + lift * 1.3],
        [-5 + sweep, 10 * sp + lift * 1.3], [-4.4 + sweep * 0.8, 8 * sp + lift], [-6 + sweep * 0.5, 5.5 * sp + lift * 0.6], [-5.5, 2 * sp], [-3, s * 0.8]];
      poly(g, W, s < 0 ? B2 : B);
    }
    poly(g, [[-4.5, -0.8], [-10.5, -3], [-11.2, 0], [-10.5, 3], [-4.5, 0.8]], B);
    ell(g, 0, 0, 6, 2.3, B);
    ell(g, 5.8, 0, 2.2, 1.9, B);
    poly(g, [[7.6, -0.8], [10.6, 0], [7.6, 0.8]], '#0b0c0e');
    g.restore();
  }

  // ======================= ТУША =======================
  const CORPSE = {
    wolf: { k: 1, body: '#80868e', dark: '#565c64', belly: '#e2e6ea', leg: '#6f757d', L: 20, R: 7, head: 6, blood: 16 },
    wolfLeader: { k: 1.16, body: '#5d6269', dark: '#363a40', belly: '#b7bcc2', leg: '#4c5157', L: 20, R: 7, head: 6, blood: 17 },
    bear: { k: 1, body: '#4b3628', dark: '#35261c', belly: '#5e4634', leg: '#3a2a1f', L: 30, R: 13, head: 8.5, blood: 26 },
    hare: { k: 1, body: '#f6f9fc', dark: '#d7dfe8', belly: '#ffffff', leg: '#dbe3ec', L: 9, R: 4.5, head: 3.8, blood: 8 },
    deer: { k: 1, body: '#76634f', dark: '#54463a', belly: '#d8ccb8', leg: '#4c3f33', L: 24, R: 8, head: 5.5, blood: 18 },
    dog: { k: 0.7, body: '#a7aeb6', dark: '#737a84', belly: '#e9ecef', leg: '#8a9098', L: 20, R: 7, head: 6, blood: 12 },
    raven: { k: 1, body: '#15171b', dark: '#262a31', belly: '#15171b', leg: '#15171b', L: 6, R: 3, head: 2.4, blood: 5 },
  };
  function corpse(g, kind, x, y, t = 99) {
    const C = CORPSE[kind] || CORPSE.wolf, k = C.k, grow = sstep(0, 2.5, t), age = clamp(t / 90, 0, 1);
    // кровь: пятно растёт, темнеет, частично заметается снегом
    const bl = C.blood * k * (0.4 + 0.6 * grow);
    g.globalAlpha = 1 - age * 0.45;
    ell(g, x + 2 * k, y + 1, bl, bl * 0.42, age > 0.3 ? '#6e1a1a' : '#8a1c1c');
    ell(g, x - bl * 0.55, y + 2.5, bl * 0.4, bl * 0.2, '#7a1818');
    g.fillStyle = '#9b2220';
    for (let i = 0; i < 5; i++) { const a = i * 1.9 + x * 0.01, r = bl * (1.1 + (i % 3) * 0.25); g.fillRect(x + cos(a) * r, y + 1 + sin(a) * r * 0.4, 1.8, 1.2); }
    g.globalAlpha = 1;
    g.save(); g.translate(x, y); g.scale(k, k); g.lineCap = 'round';
    if (kind === 'raven') {
      poly(g, [[-2, -1], [-9, 2], [-7, 3.5], [-1, 1]], C.body);
      poly(g, [[0, -1], [6, -6], [8, -3], [2, 1]], C.dark); poly(g, [[0, 0], [-4, -6], [-1, -6], [2, -1]], C.dark);
      ell(g, 0, -1, 4, 2.4, C.body); ell(g, 4, -0.5, 2.2, 2, C.body); poly(g, [[5.8, -0.8], [8.8, 0.6], [5.6, 0.6]], '#0b0c0e');
    } else {
      const L = C.L, R = C.R;
      // лапы окоченело торчат
      g.strokeStyle = C.leg; g.lineWidth = kind === 'bear' ? 6 : kind === 'hare' ? 2 : 3;
      g.beginPath();
      for (const [bx, dx, dy] of [[-0.6, -9, 4], [-0.45, -4, 6.5], [0.45, 6, 6], [0.62, 11, 3.5]]) { g.moveTo(bx * L, -R * 0.3); g.lineTo(bx * L + dx * R / 7, -R * 0.3 + dy * R / 7); }
      g.stroke();
      fillBlob(g, [[-L * 0.95, -R * 0.4], [-L * 0.6, -R * 1.35], [L * 0.2, -R * 1.25], [L * 0.8, -R * 1.1], [L * 0.95, -R * 0.1], [L * 0.2, R * 0.25], [-L * 0.6, R * 0.2]], C.body);
      fillBlob(g, [[-L * 0.7, R * 0.05], [-L * 0.2, -R * 0.3], [L * 0.6, -R * 0.35], [L * 0.75, -R * 0.1], [L * 0.2, R * 0.28]], C.belly);
      fillBlob(g, [[-L * 0.8, -R * 0.9], [-L * 0.2, -R * 1.3], [L * 0.6, -R * 1.2], [L * 0.2, -R * 0.9]], C.dark);
      // голова лежит, глаз закрыт
      const hx = L * 1.05, hy = -R * 0.2, hr = C.head;
      ell(g, hx, hy, hr * 1.1, hr * 0.8, C.body, 0.25);
      ell(g, hx + hr * 1.1, hy + hr * 0.45, hr * 0.8, hr * 0.45, kind === 'bear' ? '#8a6a4c' : C.body, 0.35);
      if (kind === 'wolf' || kind === 'wolfLeader' || kind === 'dog') { g.fillStyle = '#c05a6a'; g.fillRect(hx + hr * 1.3, hy + hr * 0.8, hr * 0.5, hr * 0.3); }
      if (kind === 'deer') { g.strokeStyle = '#d8c9b0'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(hx - 1, hy - 3); g.lineTo(hx - 10, hy - 12); g.lineTo(hx - 16, hy - 11); g.moveTo(hx - 5, hy - 7); g.lineTo(hx - 3, hy - 13); g.stroke(); }
      if (kind === 'hare') { ell(g, hx - 5, hy - 1, 5, 1.4, C.body, -0.2); ell(g, hx - 9.5, hy - 0.2, 1.4, 1.1, '#1c1c20'); }
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(hx + hr * 0.2, hy - hr * 0.3); g.lineTo(hx + hr * 0.7, hy - hr * 0.2); g.stroke();
      if (t > 20) { g.fillStyle = `rgba(245,249,255,${Math.min(0.85, (t - 20) / 60)})`; for (let i = 0; i < 6; i++) g.fillRect(-L * 0.7 + i * L * 0.3, -R * 1.25 + (i % 2) * 1.2, 3, 1.3); }
    }
    g.restore();
  }

  // колокольчик оленя: true один раз на каждый «удар» маятника (для звука в игре)
  function bellHit(d) { const m = M.get(d); if (m && m.hit) { m.hit = 0; return true; } return false; }

  return { wolf, bear, hare, deer, dog, raven, corpse, bellHit, deerBell: true, GAITS };
})();
if (typeof module !== 'undefined') module.exports = ArtAnimals;
