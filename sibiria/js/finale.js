'use strict';
// Финальная сцена: оверлей-канвас поверх игры (~12 с), потом onDone() → итоговый экран.
// Finale.play(kind, stats, onDone): kind 'A' | 'B' | 'D' | 'C'.
// stats (всё необязательно): { pop, vera, urk, day } — иначе берём из G/Colony.
// Клик / клавиша / тап после 1 с — пропустить.
const Finale = (() => {
  // U — масштаб сцены (доля экрана), UI — единый масштаб интерфейса (титры, бейдж «пропустить»)
  let cv = null, cx = null, raf = 0, T = 0, last = 0, done = null, K = 'A', S = {}, W = 0, H = 0, U = 1, UIk = 1, parts = [], skipOK = false;
  const DUR = { A: 12, B: 11, D: 12, C: 10 };
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = cl(x); return x * x * (3 - 2 * x); };
  const R = (a, b) => a + Math.random() * (b - a);
  // детерминированный шум для леса/сопок, чтобы кадр не дрожал
  const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function stats(st) {
    const o = Object.assign({}, st || {});
    try {
      if (o.pop == null) o.pop = typeof Colony !== 'undefined' ? Colony.pop() : 0;
      if (o.vera == null) o.vera = !G.flags.veraDead && G.vera.state !== 'tail';
      if (o.urk == null) o.urk = G.urk.respect >= 2;
      if (o.day == null) o.day = G.day;
    } catch (e) { o.pop = o.pop || 0; }
    return o;
  }

  function play(kind, st, onDone) {
    stop();
    K = DUR[kind] ? kind : 'A'; S = stats(st); done = onDone || (() => {});
    cv = document.createElement('canvas'); cv.id = 'finale';
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:20;display:block;background:#111a15;cursor:pointer;touch-action:none';
    document.body.appendChild(cv); cx = cv.getContext('2d');
    resize(); addEventListener('resize', resize);
    T = 0; last = performance.now(); parts = []; skipOK = false;
    setTimeout(() => { skipOK = true; }, 1000);
    cv.addEventListener('pointerdown', skip); addEventListener('keydown', skip);
    setup();
    if (typeof Sound !== 'undefined' && Sound.ctx) { if (K === 'C') Sound.sting('quiet'); if (K === 'D') Sound.sting('win'); }
    raf = requestAnimationFrame(loop);
  }
  function skip(e) { if (!skipOK || !cv) return; if (e && e.type === 'keydown' && e.repeat) return; finish(); }
  function stop() {
    cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('keydown', skip);
    if (cv) cv.remove(); cv = null;
  }
  function finish() {
    const cb = done; done = null; stop();
    if (typeof Sound !== 'undefined' && Sound.ctx) { Sound.rotorOff(); Sound.setMood(null); }
    if (cb) cb();
  }
  function resize() {
    const d = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * d; cv.height = H * d; cx.setTransform(d, 0, 0, d, 0, 0); U = Math.min(W / 1000, H / 640);
    UIk = typeof UI !== 'undefined' && UI.scale ? UI.scale : 1;
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
    if (typeof Sound !== 'undefined' && Sound.ctx) sound(dt);
    draw(dt);
    if (T >= DUR[K]) return finish();
    raf = requestAnimationFrame(loop);
  }

  // ---------- сценарий ----------
  // вертолёт: x,y — в долях экрана; садится к t=5.2
  const LAND = 5.2;
  function heliPos(t) {
    const k = ease(t / LAND);
    return { x: 0.95 - 0.29 * k, y: 0.08 + (0.8 - 0.08 - 11 * U / H) * k - Math.sin(k * Math.PI) * 0.06, tilt: (1 - k) * -0.12 + Math.sin(t * 1.3) * 0.01 * (1 - k) };
  }
  let crowd = [];
  function setup() {
    crowd = [];
    const gy = 0.8;
    if (K === 'A' || K === 'B') {
      crowd.push({ who: 'lesha', x: 0.24, y: gy + 0.04, sp: 0.085, delay: 5.6, col: '#c8612d' });
      if (K === 'A' && S.vera) crowd.push({ who: 'vera', x: 0.2, y: gy + 0.06, sp: 0.07, delay: 5.8, col: '#b8433a', limp: 1, wave: 1 });
      const n = K === "B" ? 0 : Math.min(6, Math.max(0, (S.pop | 0) - 1));
      for (let i = 0; i < n; i++) crowd.push({ who: 'folk', x: 0.02 + i * 0.05, y: gy + 0.02 + (i % 3) * 0.025, sp: R(0.06, 0.08), delay: 6 + i * 0.35, col: ['#5d6b52', '#6b5242', '#4f5e6e', '#7a6440'][i % 4], stop: 0.4 + i * 0.03, wave: i % 2 });
      if (K === 'A') crowd.push({ who: 'urk', x: 0.1, y: gy - 0.03, sp: 0, delay: 99, col: '#3d3226', pipe: 1 });
    } else if (K === 'D') {
      for (let i = 0; i < Math.min(8, Math.max(3, S.pop | 0)); i++) crowd.push({ who: 'folk', x: R(0.1, 0.9), y: gy + R(0.0, 0.08), sp: R(0.02, 0.04) * (Math.random() < 0.5 ? -1 : 1), delay: R(0, 2), col: ['#5d6b52', '#6b5242', '#4f5e6e', '#7a6440', '#b8433a'][i % 5], roam: 1 });
      crowd.push({ who: 'urk', x: 0.5, y: gy + 0.02, sp: 0, delay: 99, col: '#3d3226', pipe: 1 });
    } else {
      crowd.push({ who: 'urk', x: 0.5, y: gy + 0.1, sp: 0.018, delay: 1.5, col: '#3d3226', ski: 1, away: 1 });
      crowd.push({ who: 'lesha', x: 0.46, y: gy + 0.12, sp: 0.018, delay: 2.2, col: '#c8612d', ski: 1, away: 1 });
    }
  }
  function sound(dt) {
    if (K === 'A' || K === 'B') {
      const k = T < LAND ? 0.35 + 0.65 * ease(T / LAND) : T < 9 ? 1 : 1 - ease((T - 9) / 3) * 0.7;
      Sound.cinema(dt, { mood: K === 'A' ? 'finale' : 'quiet', rotor: k * (K === 'B' ? 0.8 : 1), pan: (heliPos(T).x - 0.5) * 1.4, wind: 0.08 + (T > 3 && T < 9 ? 0.18 : 0) });
    } else Sound.cinema(dt, { mood: K === 'D' ? 'finale' : 'quiet', wind: K === 'C' ? 0.16 : 0.06, night: 1 });
  }

  // ---------- рисование ----------
  function draw(dt) {
    const shake = !reduced && (K === 'A' || K === 'B') && T > 3.5 && T < 6 ? (1 - Math.abs(T - 5) / 1.5) * 2.5 * U : 0;
    cx.save(); if (shake > 0) cx.translate(R(-shake, shake), R(-shake, shake));
    sky(); if (K === 'D') aurora(); hills(); forest(0.64, 0.5, '#1d2b33', 1); forest(0.7, 0.8, '#15222a', 2);
    ground();
    if (K === 'A' || K === 'B') { stacks(dt); }
    if (K === 'D') village(dt);
    people(dt);
    if (K === 'A' || K === 'B') { const h = heliPos(T); heli(h.x * W, h.y * H, U * 1.1, h.tilt); downwash(dt, h); }
    snow(dt);
    cx.restore();
    titles();
    // затемнения
    const fin = cl(1 - T / 0.8), fout = cl((T - (DUR[K] - 1)) / 1);
    if (fin + fout > 0) { cx.fillStyle = `rgba(17,26,21,${Math.max(fin, fout)})`; cx.fillRect(0, 0, W, H); }
    if (T > 1 && T < 4) {
      // бейдж «клик — пропустить»: канвас-копия .badge на .plate
      cx.globalAlpha = cl(1 - (T - 3)) * cl(T - 1);
      const k = UIk, t = 'клик — пропустить'; cx.font = `${Math.round(12 * k)}px "PT Mono", monospace`;
      const w = cx.measureText(t).width + 16 * k, h = 24 * k, x = W - 16 - w, y = H - 16 - h;
      if (typeof Icons !== 'undefined') Icons.plate(cx, x, y, w, h, 3); else { cx.fillStyle = '#22302a'; cx.fillRect(x, y, w, h); }
      cx.fillStyle = '#a7b5a6'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(t, x + w / 2, y + h / 2 + 1); cx.textBaseline = 'alphabetic'; cx.globalAlpha = 1;
    }
  }
  function sky() {
    const g = cx.createLinearGradient(0, 0, 0, H * 0.75);
    // палитра мира (C2): ночь #27394a, сумерки #6f8ea8, снег #dde6ee, огонь #ffb347
    const P = { A: ['#27394a', '#6f8ea8', '#f3d6b0'], B: ['#27394a', '#6f8ea8', '#b6c9df'], D: ['#111a15', '#1b2a3a', '#27394a'], C: ['#27394a', '#6f8ea8', '#dde6ee'] }[K];
    g.addColorStop(0, P[0]); g.addColorStop(0.6, P[1]); g.addColorStop(1, P[2]);
    cx.fillStyle = g; cx.fillRect(-20, -20, W + 40, H + 40);
    if (K === 'A' || K === 'C') { const sx = W * (K === 'A' ? 0.3 : 0.7), sy = H * 0.58, r = 160 * U; const s = cx.createRadialGradient(sx, sy, 0, sx, sy, r); s.addColorStop(0, K === 'A' ? 'rgba(255,220,160,.9)' : 'rgba(220,235,255,.5)'); s.addColorStop(1, 'rgba(255,220,160,0)'); cx.fillStyle = s; cx.fillRect(sx - r, sy - r, r * 2, r * 2); }
    if (K === 'D' || K === 'C') { cx.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 70; i++) { const x = hash(i) * W, y = hash(i + 99) * H * 0.5, tw = 0.5 + 0.5 * Math.sin(T * 2 + i); cx.globalAlpha = (K === 'D' ? 0.9 : 0.3) * tw; cx.fillRect(x, y, 1.5, 1.5); } cx.globalAlpha = 1; }
  }
  function aurora() {
    for (let b = 0; b < 3; b++) {
      cx.beginPath();
      for (let i = 0; i <= 40; i++) { const x = i / 40 * W, y = H * (0.18 + b * 0.07) + Math.sin(i * 0.4 + T * 0.5 + b) * 30 * U; i ? cx.lineTo(x, y) : cx.moveTo(x, y); }
      cx.strokeStyle = `rgba(${b === 1 ? '140,255,190' : '90,230,160'},${0.16 + 0.06 * Math.sin(T + b)})`; cx.lineWidth = 36 * U; cx.stroke();
    }
  }
  function hills() {
    cx.fillStyle = K === 'D' ? '#1b2a3a' : '#6f8ea8';
    cx.beginPath(); cx.moveTo(0, H);
    for (let i = 0; i <= 50; i++) { const x = i / 50 * W; cx.lineTo(x, H * 0.55 - (Math.sin(i * 0.3) * 0.5 + 0.5) * H * 0.06 - hash(i) * H * 0.01); }
    cx.lineTo(W, H); cx.fill();
  }
  // лес из тех же спрайтов, что в мире (ArtWorld.treeSprite); дальний ряд — в дымке
  function forest(y0, scale, col, seed) {
    const aw = typeof ArtWorld !== 'undefined';
    const n = Math.ceil(W / (26 * U * scale));
    for (let i = 0; i < n; i++) {
      const x = i * 26 * U * scale + hash(i + seed * 50) * 14 * U, k = (0.45 + hash(i * 3 + seed) * 0.35) * U * scale, y = H * y0 + hash(i + seed * 7) * 6 * U;
      if (K !== 'D' && x > W * 0.3 && x < W * 0.78 && seed === 2) continue; // марь — открытое место
      if (aw) {
        const kind = hash(i * 7 + seed) < 0.2 ? 1 : 0, spr = ArtWorld.treeSprite(kind, 0.8 + hash(i + 5) * 0.6, 0, (i + seed) % 3), tw = ArtWorld.treeW(kind);
        cx.drawImage(spr, x - tw / 2 * k, y - 160 * k, tw * k, 170 * k);
      } else { cx.fillStyle = col; cx.beginPath(); cx.moveTo(x, y - 60 * k); cx.lineTo(x - 14 * k, y); cx.lineTo(x + 14 * k, y); cx.fill(); }
    }
    // дымка/ночь поверх ряда — глубина
    const haze = K === 'D' ? `rgba(17,26,21,${seed === 1 ? 0.72 : 0.5})` : `rgba(111,142,168,${seed === 1 ? 0.5 : 0.18})`;
    cx.fillStyle = haze; cx.fillRect(0, H * y0 - 120 * U * scale, W, 130 * U * scale);
  }
  function ground() {
    const g = cx.createLinearGradient(0, H * 0.68, 0, H);
    const c = { A: ['#f6f9fc', '#dde6ee'], B: ['#dde6ee', '#b6c9df'], D: ['#6f8ea8', '#27394a'], C: ['#dde6ee', '#b6c9df'] }[K];
    g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    cx.fillStyle = g; cx.beginPath(); cx.moveTo(0, H * 0.7);
    for (let i = 0; i <= 30; i++) cx.lineTo(i / 30 * W, H * 0.7 + Math.sin(i * 0.7) * 4 * U);
    cx.lineTo(W, H); cx.lineTo(0, H); cx.fill();
    if (K === 'C') { cx.strokeStyle = 'rgba(90,110,130,.4)'; cx.lineWidth = 2 * U; for (const o of [-5, 5]) { cx.beginPath(); cx.moveTo(W * 0.48 + o * U, H); cx.quadraticCurveTo(W * 0.5, H * 0.8, W * 0.52 + o * 0.3 * U, H * 0.66); cx.stroke(); } }
  }
  function smoke(x, y, k, lean) {
    if (Math.random() < 0.5 * k) parts.push({ t: 'smoke', x: x + R(-4, 4) * U, y, vx: lean * R(10, 40) * U, vy: -R(20, 40) * U, life: R(2, 3.5), max: 3.5, r: R(6, 10) * U });
  }
  function stacks(dt) {
    const h = heliPos(T), close = T > 3 ? ease((T - 3) / 2) : 0;
    for (let i = 0; i < 3; i++) {
      const x = W * (0.24 + i * 0.12), y = H * 0.76 + (i % 2) * 8 * U;
      cx.fillStyle = '#4a3625'; cx.fillRect(x - 12 * U, y - 5 * U, 24 * U, 6 * U);
      const f = 0.7 + 0.3 * Math.sin(T * 17 + i * 3);
      cx.fillStyle = `rgba(255,${140 + 40 * f | 0},60,.9)`; cx.beginPath(); cx.moveTo(x - 9 * U, y - 4 * U); cx.quadraticCurveTo(x, y - 30 * U * f, x + 9 * U, y - 4 * U); cx.fill();
      cx.fillStyle = 'rgba(255,240,160,.9)'; cx.beginPath(); cx.moveTo(x - 4 * U, y - 4 * U); cx.quadraticCurveTo(x, y - 16 * U * f, x + 4 * U, y - 4 * U); cx.fill();
      smoke(x, y - 26 * U, 1, (x - h.x * W) / W * 6 * close + 0.3);
    }
  }
  function village(dt) {
    const hs = [[0.14, 0.74, 1], [0.3, 0.76, 1.2], [0.62, 0.745, 1], [0.8, 0.77, 1.3], [0.46, 0.72, 0.8]];
    hs.forEach(([fx, fy, s], i) => {
      const x = W * fx, y = H * fy, w = 70 * U * s, hh = 40 * U * s;
      cx.fillStyle = '#6b4a2e'; cx.fillRect(x - w / 2, y - hh, w, hh);
      cx.fillStyle = 'rgba(40,28,18,.45)'; for (let r = 1; r < 5; r++) cx.fillRect(x - w / 2, y - hh + r * hh / 5, w, 1.5 * U);
      cx.fillStyle = '#f6f9fc'; cx.beginPath(); cx.moveTo(x - w / 2 - 6 * U, y - hh); cx.lineTo(x, y - hh - 26 * U * s); cx.lineTo(x + w / 2 + 6 * U, y - hh); cx.fill();
      const lit = T > 1 + i * 0.7; cx.fillStyle = lit ? `rgba(255,190,90,${0.75 + 0.2 * Math.sin(T * 3 + i)})` : '#1a140f';
      cx.fillRect(x - w * 0.25, y - hh * 0.65, w * 0.18, hh * 0.3); cx.fillRect(x + w * 0.08, y - hh * 0.65, w * 0.18, hh * 0.3);
      if (lit) { const gl = cx.createRadialGradient(x, y - hh * 0.5, 0, x, y - hh * 0.5, w); gl.addColorStop(0, 'rgba(255,170,70,.18)'); gl.addColorStop(1, 'rgba(255,170,70,0)'); cx.fillStyle = gl; cx.fillRect(x - w, y - hh * 1.5, w * 2, hh * 2); }
      cx.fillStyle = '#3a2d22'; cx.fillRect(x + w * 0.2, y - hh - 22 * U * s, 7 * U, 16 * U);
      smoke(x + w * 0.2 + 3 * U, y - hh - 24 * U * s, 0.5, 0.4);
    });
    // костёр посреди посёлка
    const x = W * 0.5, y = H * 0.84, f = 0.7 + 0.3 * Math.sin(T * 15);
    const gl = cx.createRadialGradient(x, y, 0, x, y, 120 * U); gl.addColorStop(0, 'rgba(255,160,60,.35)'); gl.addColorStop(1, 'rgba(255,160,60,0)'); cx.fillStyle = gl; cx.fillRect(x - 120 * U, y - 120 * U, 240 * U, 240 * U);
    cx.fillStyle = `rgba(255,${150 + 40 * f | 0},60,.95)`; cx.beginPath(); cx.moveTo(x - 10 * U, y); cx.quadraticCurveTo(x, y - 34 * U * f, x + 10 * U, y); cx.fill();
  }
  // люди — тот же риг, что в мире (ArtPeople), внешность по роли
  const LOOK = { lesha: 'anorak', vera: 'vera', urk: 'urk' }, FOLK = ['bich', 'evenk', 'strelok', 'bich', 'evenk'];
  function person(p, x, y, s) {
    if (typeof ArtPeople !== 'undefined') {
      const look = LOOK[p.who] || FOLK[(p.fi == null ? (p.fi = crowd.indexOf(p)) : p.fi) % FOLK.length];
      const anim = p.moving ? (p.limp ? 'limp' : 'walk') : p.waving ? 'wave' : 'idle';
      cx.save(); cx.translate(x, y); cx.scale(s * 0.95, s * 0.95);
      ArtPeople.draw(cx, { x: 0, y: 0, face: p.away ? 1 : p.sp < 0 ? -1 : 1, vy: p.away ? -1 : 0, speed: 0.4, t: T, phase: T * 7, anim, look, tool: p.ski ? 'none' : 'none', seed: crowd.indexOf(p) + 1 });
      cx.restore();
      if (p.pipe && Math.random() < 0.05) parts.push({ t: 'smoke', x: x + 7 * s, y: y - 36 * s, vx: 6 * U, vy: -12 * U, life: 2, max: 2, r: 3 * U });
      return;
    }
    const t = T * (p.ski ? 2.2 : 5.5), moving = p.moving, sw = moving ? Math.sin(t) * 5 * s : 0, limp = p.limp ? Math.max(0, Math.sin(t)) * 3 * s : 0;
    cx.save(); cx.translate(x, y - limp);
    cx.fillStyle = 'rgba(40,50,70,.18)'; cx.beginPath(); cx.ellipse(0, limp, 12 * s, 3 * s, 0, 0, 7); cx.fill();
    if (p.ski) { cx.strokeStyle = '#6b4a2a'; cx.lineWidth = 2 * s; cx.beginPath(); cx.moveTo(-3 * s, 0); cx.lineTo(-3 * s, -8 * s); cx.moveTo(3 * s, 0); cx.lineTo(3 * s, -8 * s); cx.stroke(); }
    cx.strokeStyle = '#2a2420'; cx.lineWidth = 4 * s; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(-2 * s, -12 * s); cx.lineTo(-2 * s + sw, 0); cx.moveTo(2 * s, -12 * s); cx.lineTo(2 * s - (p.limp ? 0 : sw), 0); cx.stroke();
    cx.fillStyle = p.col; cx.beginPath(); cx.moveTo(-8 * s, -12 * s); cx.lineTo(-6 * s, -32 * s); cx.lineTo(6 * s, -32 * s); cx.lineTo(8 * s, -12 * s); cx.fill();
    cx.strokeStyle = p.col; cx.lineWidth = 3.5 * s;
    const wave = p.wave && p.waving ? Math.sin(T * 9) * 0.5 : 0;
    cx.beginPath(); cx.moveTo(6 * s, -29 * s);
    if (wave || (p.wave && p.waving)) cx.lineTo(12 * s + wave * 4 * s, -42 * s); else cx.lineTo(7 * s + sw * 0.5, -16 * s);
    cx.moveTo(-6 * s, -29 * s); cx.lineTo(-7 * s - sw * 0.5, -16 * s); cx.stroke();
    cx.fillStyle = '#e2b996'; cx.beginPath(); cx.arc(0, -36 * s, 4.5 * s, 0, 7); cx.fill();
    cx.fillStyle = p.who === 'urk' ? '#5a4632' : p.who === 'vera' ? '#e0d6c8' : '#4a3a2c';
    cx.beginPath(); cx.arc(0, -38 * s, 5.5 * s, Math.PI, 0); cx.fill(); cx.fillRect(-6 * s, -39 * s, 12 * s, 2.5 * s);
    if (p.pipe) { cx.strokeStyle = '#2a1d12'; cx.lineWidth = 1.5 * s; cx.beginPath(); cx.moveTo(3 * s, -34 * s); cx.lineTo(8 * s, -33 * s); cx.stroke(); if (Math.random() < 0.06) parts.push({ t: 'smoke', x: x + 8 * s, y: y - 35 * s, vx: 6 * U, vy: -12 * U, life: 2, max: 2, r: 3 * U }); }
    cx.restore();
  }
  function people(dt) {
    const h = heliPos(T), door = { x: (h.x - 0.02) * W, y: H * 0.8 };
    const list = crowd.slice().sort((a, b) => a.y - b.y);
    for (const p of list) {
      if (p.gone) continue;
      let x = p.x * W, y = p.y * H, s = U * 1.15 * (0.8 + (p.y - 0.75) * 3);
      p.moving = false; p.waving = false;
      if (T > p.delay) {
        if (p.away) { const k = (T - p.delay) * p.sp; p.px = p.x + Math.sin(k * 6) * 0.01; p.py = p.y - k * 1.1; x = p.px * W; y = p.py * H; s *= cl(1 - k * 2.4, 0.2); p.moving = true; cx.globalAlpha = cl(1 - k * 2); }
        else if (p.roam) { p.cx = (p.cx == null ? p.x : p.cx) + p.sp * dt; if (p.cx > 0.95 || p.cx < 0.05) p.sp *= -1; x = p.cx * W; p.moving = true; }
        else if (p.sp) {
          p.cx = (p.cx == null ? p.x : p.cx); const tx = p.stop ? h.x - 0.1 - p.stop * 0.2 : h.x + 0.025;
          if (p.cx < tx) { p.cx = Math.min(tx, p.cx + p.sp * dt); p.moving = true; } else if (!p.stop) { p.gone = T > 8.3; p.waving = p.who === 'vera'; } else p.waving = !!p.wave && T > 8;
          x = p.cx * W; y = (p.y + (door.y / H - p.y) * cl((p.cx - p.x) / 0.4) * 0.5) * H;
        }
      }
      if (p.who === 'urk' && !p.sp && K === 'A') { p.waving = false; }
      person(p, x, y, s); cx.globalAlpha = 1;
    }
  }
  function heli(x, y, s, tilt) {
    // тень на снегу
    const gy = H * 0.8, alt = cl(1 - (gy - y) / (H * 0.7));
    cx.fillStyle = `rgba(40,50,70,${0.25 * alt})`; cx.beginPath(); cx.ellipse(x, gy + 6 * U, 110 * s * (0.6 + alt * 0.4), 10 * s, 0, 0, 7); cx.fill();
    cx.save(); cx.translate(x, y); cx.rotate(tilt); cx.scale(s, s);
    // тот же Ми-8, что лежит в мире (ArtWorld.paintMi8): белая эмаль, красная полоса, синяя линия
    const bodyG = (y0, y1) => { const g = cx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#f4f6f7'); g.addColorStop(0.3, '#dde3e8'); g.addColorStop(0.75, '#aab4bd'); g.addColorStop(1, '#77828d'); return g; };
    const body = bodyG(-66, -10), stripe = '#c8452a';
    // хвостовая балка
    cx.fillStyle = bodyG(-52, -22); cx.beginPath(); cx.moveTo(40, -40); cx.lineTo(170, -52); cx.lineTo(172, -44); cx.lineTo(40, -22); cx.fill();
    cx.fillStyle = '#dde3e8'; cx.fillRect(160, -80, 12, 36); // киль
    cx.fillStyle = stripe; cx.fillRect(60, -41, 90, 5); cx.fillRect(160, -62, 12, 5);
    // хвостовой винт
    const tr = T * 40; cx.strokeStyle = 'rgba(40,40,40,.7)'; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(166 + Math.cos(tr) * 18, -64 + Math.sin(tr) * 18); cx.lineTo(166 - Math.cos(tr) * 18, -64 - Math.sin(tr) * 18); cx.stroke();
    cx.fillStyle = 'rgba(80,80,80,.18)'; cx.beginPath(); cx.arc(166, -64, 18, 0, 7); cx.fill();
    // фюзеляж
    cx.fillStyle = body; cx.beginPath(); cx.moveTo(-95, -20); cx.quadraticCurveTo(-100, -62, -60, -66); cx.lineTo(50, -66); cx.quadraticCurveTo(70, -60, 60, -20); cx.quadraticCurveTo(0, -8, -95, -20); cx.fill();
    cx.fillStyle = stripe; cx.fillRect(-92, -30, 150, 7); cx.fillStyle = '#8e2d1c'; cx.fillRect(-92, -23, 150, 1.6);
    cx.fillStyle = '#2d5a8c'; cx.fillRect(-92, -36, 150, 1.6);
    const glass = cx.createLinearGradient(-96, -60, -66, -34); glass.addColorStop(0, '#5e7f9c'); glass.addColorStop(0.5, '#27394a'); glass.addColorStop(1, '#162230');
    cx.fillStyle = glass; cx.beginPath(); cx.moveTo(-94, -34); cx.quadraticCurveTo(-96, -58, -66, -60); cx.lineTo(-62, -40); cx.fill();
    for (let i = 0; i < 4; i++) { cx.fillStyle = '#8f9aa4'; cx.beginPath(); cx.arc(-38 + i * 20, -48, 5.4, 0, 7); cx.fill(); cx.fillStyle = '#1c2833'; cx.beginPath(); cx.arc(-38 + i * 20, -48, 4.2, 0, 7); cx.fill(); }
    // дверь: после посадки открыта
    const open = T > LAND + 0.6;
    cx.fillStyle = open ? '#10151a' : '#c9d0d6'; cx.fillRect(18, -60, 22, 38);
    if (open) { cx.fillStyle = 'rgba(255,200,120,.35)'; cx.fillRect(20, -58, 18, 34); }
    // двигатели + втулка
    cx.fillStyle = bodyG(-80, -64); cx.beginPath(); cx.roundRect(-50, -80, 92, 16, 6); cx.fill(); cx.fillStyle = '#4c5157'; cx.fillRect(-8, -92, 8, 14);
    // шасси
    cx.strokeStyle = '#2b2b2b'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(-70, -14); cx.lineTo(-72, 0); cx.moveTo(30, -14); cx.lineTo(34, 0); cx.stroke();
    cx.fillStyle = '#1d1d1d'; cx.beginPath(); cx.arc(-72, 2, 5, 0, 7); cx.arc(34, 2, 6, 0, 7); cx.fill();
    // номер на балке
    cx.fillStyle = '#2b2f3a'; cx.font = 'bold 10px "PT Mono", monospace'; cx.fillText('24713', 88, -44);
    // несущий винт: размытый диск + лопасти
    cx.fillStyle = 'rgba(60,60,60,.12)'; cx.beginPath(); cx.ellipse(-4, -92, 150, 9, 0, 0, 7); cx.fill();
    const r = T * 22; cx.strokeStyle = 'rgba(30,30,30,.75)'; cx.lineWidth = 3.5;
    for (let b = 0; b < 5; b++) { const a = r + b * Math.PI * 2 / 5, c = Math.cos(a); cx.beginPath(); cx.moveTo(-4, -92); cx.lineTo(-4 + c * 150, -92 + Math.sin(a) * 6); cx.stroke(); }
    cx.restore();
  }
  function downwash(dt, h) {
    const gy = H * 0.8, alt = cl(1 - (gy - h.y * H) / (H * 0.55)), k = alt * alt * (T < 10 ? 1 : 0.4);
    const n = Math.floor(k * 90 * dt * (reduced ? 0.4 : 1) * 10);
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1, sp = R(120, 380) * U;
      parts.push({ t: 'snow', x: h.x * W + R(-30, 30) * U, y: gy + R(-4, 6) * U, vx: dir * sp, vy: -R(20, 110) * U, life: R(0.8, 1.8), max: 1.8, r: R(1.2, 3.2) * U, swirl: dir * R(1, 3) });
    }
    if (k > 0.2) { const g = cx.createRadialGradient(h.x * W, gy, 0, h.x * W, gy, 260 * U * k); g.addColorStop(0, `rgba(240,246,250,${0.55 * k})`); g.addColorStop(1, 'rgba(240,246,250,0)'); cx.fillStyle = g; cx.fillRect(h.x * W - 260 * U, gy - 200 * U, 520 * U, 260 * U); }
  }
  function snow(dt) {
    const rate = K === 'C' ? 40 : K === 'B' ? 25 : 12;
    for (let i = 0; i < rate * dt; i++) if (Math.random() < 1) parts.push({ t: 'flake', x: R(0, W), y: -5, vx: R(-10, 20) * U, vy: R(25, 60) * U, life: 12, max: 12, r: R(0.8, 2) * U });
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.life -= dt; if (q.life <= 0 || q.y > H + 10) { parts.splice(i, 1); continue; }
      if (q.t === 'snow') { q.vy += 90 * U * dt; q.vx *= 1 - dt * 1.5; q.vy += q.swirl * Math.sin(q.life * 6) * 30 * U * dt; }
      if (q.t === 'smoke') q.r += dt * 6 * U;
      q.x += q.vx * dt; q.y += q.vy * dt;
      const a = cl(q.life / q.max);
      cx.fillStyle = q.t === 'smoke' ? `rgba(${K === 'D' ? '120,130,145' : '200,205,212'},${0.35 * a})` : `rgba(255,255,255,${(q.t === 'snow' ? 0.9 : 0.8) * a})`;
      cx.beginPath(); cx.arc(q.x, q.y, q.r, 0, 7); cx.fill();
    }
    if (parts.length > 1500) parts.splice(0, parts.length - 1500);
  }
  function titles() {
    const TX = {
      A: ['Борт 24713 — домой', S.vera ? 'Лёша, Вера' + (S.pop > 1 ? ' и ещё ' + (S.pop - 1) : '') + '. Дед остался. Курит.' : 'Дед остался. Курит.'],
      B: ['Борт 24713 — домой', 'Один. В вертолёте тепло и тихо.'],
      D: ['Новый посёлок', (S.pop || 0) + ' человек зимуют. Весной придёт почта.'],
      C: ['Весной выйдем', 'Вместе. Уркачан впереди, лыжня за ним.'],
    }[K];
    const t0 = K === 'A' || K === 'B' ? 7.3 : 4, a = cl((T - t0) / 1.2) * cl((DUR[K] - 0.6 - T) / 0.8);
    if (a <= 0) return;
    cx.save(); cx.globalAlpha = a; cx.textAlign = 'center';
    // лента-титр: канвас-копия .plate (эмаль, кромка), заголовок Russo, подпись PT Sans
    const fs = Math.round(Math.min(W / 14, 40 * UIk)), sfs = Math.round(Math.max(13, fs * 0.42));
    cx.font = `${fs}px "Russo One", sans-serif`; let w = cx.measureText(TX[0]).width;
    cx.font = `${sfs}px "PT Sans", sans-serif`; w = Math.min(W - 32, Math.max(w, cx.measureText(TX[1]).width) + 48 * UIk);
    const h = fs * 1.2 + sfs * 1.6 + 20 * UIk, x = (W - w) / 2, y = H * 0.1;
    if (typeof Icons !== 'undefined') Icons.plate(cx, x, y, w, h, 4); else { cx.fillStyle = '#22302a'; cx.fillRect(x, y, w, h); }
    cx.fillStyle = '#ebe6d3'; cx.font = `${fs}px "Russo One", sans-serif`; cx.fillText(TX[0], W / 2, y + 10 * UIk + fs);
    cx.fillStyle = '#a7b5a6'; cx.font = `${sfs}px "PT Sans", sans-serif`; cx.fillText(TX[1], W / 2, y + 10 * UIk + fs * 1.2 + sfs * 1.2);
    cx.restore();
  }

  return { play, skip: () => finish(), get active() { return !!cv; } };
})();
