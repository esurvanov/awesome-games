'use strict';
// Финальная сцена: оверлей-канвас поверх игры (~12 с), потом onDone() → итоговый экран.
// Finale.play(kind, stats, onDone): kind 'A' | 'B' | 'D' | 'C' | 'E' (поход: борт садится у мачты метеостанции).
// stats (всё необязательно): { pop, vera, urk, day } — иначе берём из G/Colony.
// Клик / клавиша / тап после 1 с — пропустить.
const Finale = (() => {
  // U — масштаб сцены (доля экрана), UI — единый масштаб интерфейса (титры, бейдж «пропустить»)
  let cv = null, cx = null, raf = 0, T = 0, last = 0, done = null, K = 'A', S = {}, W = 0, H = 0, U = 1, UIk = 1, skipOK = false;
  // частицы финала — экранный пул общего модуля (js/particles.js): те же законы, лимит 900 / low 450
  let fx = FX.pool(900);
  const DUR = { A: 12, B: 11, D: 12, C: 10, E: 12 };
  const HELI = k => k === 'A' || k === 'B' || k === 'E'; // сцены с посадкой борта
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
      if (o.healed == null) o.healed = !!G.flags.veraHealed;
    } catch (e) { o.pop = o.pop || 0; }
    return o;
  }

  function play(kind, st, onDone) {
    stop();
    K = DUR[kind] ? kind : 'A'; S = stats(st); done = onDone || (() => {});
    cv = document.createElement('canvas'); cv.id = 'finale';
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:20;display:block;background:#10271f;cursor:pointer;touch-action:none';
    document.body.appendChild(cv); cx = cv.getContext('2d');
    resize(); addEventListener('resize', resize);
    T = 0; last = performance.now(); fx = FX.pool(900); skipOK = false;
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
    if (K === 'E') {
      // у мачты: Лёша и Вера идут к борту, Тамара машет с крыльца, упряжка Уялан стоит у дома
      crowd.push({ who: 'lesha', x: 0.3, y: gy + 0.05, sp: 0.07, delay: 5.6, col: '#ca5834' });
      if (S.vera) crowd.push({ who: 'vera', x: 0.26, y: gy + 0.07, sp: S.healed ? 0.07 : 0.055, delay: 5.9, col: '#b8392d', limp: S.healed ? 0 : 1, wave: 1 });
      crowd.push({ who: 'tamara', x: 0.16, y: gy - 0.02, sp: 0, delay: 99, col: '#3f6f7a', wave: 1, waveAt: 7.5 });
    } else if (K === 'A' || K === 'B') {
      crowd.push({ who: 'lesha', x: 0.24, y: gy + 0.04, sp: 0.085, delay: 5.6, col: '#ca5834' });
      if (K === 'A' && S.vera) crowd.push({ who: 'vera', x: 0.2, y: gy + 0.06, sp: 0.07, delay: 5.8, col: '#b8392d', limp: 1, wave: 1 });
      const n = K === "B" ? 0 : Math.min(6, Math.max(0, (S.pop | 0) - 1));
      for (let i = 0; i < n; i++) crowd.push({ who: 'folk', x: 0.02 + i * 0.05, y: gy + 0.02 + (i % 3) * 0.025, sp: R(0.06, 0.08), delay: 6 + i * 0.35, col: ['#5d6b52', '#645240', '#4b5d6f', '#8a6a45'][i % 4], stop: 0.4 + i * 0.03, wave: i % 2 });
      if (K === 'A') crowd.push({ who: 'urk', x: 0.1, y: gy - 0.03, sp: 0, delay: 99, col: '#473930', pipe: 1 });
    } else if (K === 'D') {
      for (let i = 0; i < Math.min(8, Math.max(3, S.pop | 0)); i++) crowd.push({ who: 'folk', x: R(0.1, 0.9), y: gy + R(0.0, 0.08), sp: R(0.02, 0.04) * (Math.random() < 0.5 ? -1 : 1), delay: R(0, 2), col: ['#5d6b52', '#645240', '#4b5d6f', '#8a6a45', '#b8392d'][i % 5], roam: 1 });
      crowd.push({ who: 'urk', x: 0.5, y: gy + 0.02, sp: 0, delay: 99, col: '#473930', pipe: 1 });
    } else {
      crowd.push({ who: 'urk', x: 0.5, y: gy + 0.1, sp: 0.018, delay: 1.5, col: '#473930', ski: 1, away: 1 });
      crowd.push({ who: 'lesha', x: 0.46, y: gy + 0.12, sp: 0.018, delay: 2.2, col: '#ca5834', ski: 1, away: 1 });
    }
  }
  function sound(dt) {
    if (HELI(K)) {
      const k = T < LAND ? 0.35 + 0.65 * ease(T / LAND) : T < 9 ? 1 : 1 - ease((T - 9) / 3) * 0.7;
      Sound.cinema(dt, { mood: K === 'B' ? 'quiet' : 'finale', rotor: k * (K === 'B' ? 0.8 : 1), pan: (heliPos(T).x - 0.5) * 1.4, wind: 0.08 + (T > 3 && T < 9 ? 0.18 : 0) });
    } else Sound.cinema(dt, { mood: K === 'D' ? 'finale' : 'quiet', wind: K === 'C' ? 0.16 : 0.06, night: 1 });
  }

  // ---------- рисование ----------
  function draw(dt) {
    const shake = !reduced && HELI(K) && T > 3.5 && T < 6 ? (1 - Math.abs(T - 5) / 1.5) * 2.5 * U : 0;
    cx.save(); if (shake > 0) cx.translate(R(-shake, shake), R(-shake, shake));
    sky(); if (K === 'D') aurora(); hills(); forest(0.64, 0.5, '#1c3035', 1); forest(0.7, 0.8, '#1c3035', 2);
    ground();
    if (K === 'A' || K === 'B') { stacks(dt); }
    if (K === 'D') village(dt);
    if (K === 'E') meteo(dt);
    people(dt);
    if (HELI(K)) { const h = heliPos(T); heli(h.x * W, h.y * H, U * 1.1, h.tilt); downwash(dt, h); }
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
    const P = { A: ['#27394a', '#6f8ea8', '#f1c9a5'], B: ['#27394a', '#6f8ea8', '#b6c9df'], D: ['#10271f', '#2f3542', '#27394a'], C: ['#27394a', '#6f8ea8', '#dde6ee'], E: ['#4b6479', '#a4bad1', '#f8e1c4'] }[K];
    g.addColorStop(0, P[0]); g.addColorStop(0.6, P[1]); g.addColorStop(1, P[2]);
    cx.fillStyle = g; cx.fillRect(-20, -20, W + 40, H + 40);
    if (K === 'A' || K === 'C' || K === 'E') { const sx = W * (K === 'C' ? 0.7 : K === 'E' ? 0.82 : 0.3), sy = H * 0.58, r = 160 * U; const s = cx.createRadialGradient(sx, sy, 0, sx, sy, r); s.addColorStop(0, K === 'C' ? 'rgba(221,230,238,.5)' : 'rgba(253,220,155,.9)'); s.addColorStop(1, 'rgba(253,220,155,0)'); cx.fillStyle = s; cx.fillRect(sx - r, sy - r, r * 2, r * 2); }
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
    cx.fillStyle = K === 'D' ? '#2f3542' : '#6f8ea8';
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
    const c = { A: ['#f6f9fc', '#dde6ee'], B: ['#dde6ee', '#b6c9df'], D: ['#6f8ea8', '#27394a'], C: ['#dde6ee', '#b6c9df'], E: ['#f6f9fc', '#dde6ee'] }[K];
    g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    cx.fillStyle = g; cx.beginPath(); cx.moveTo(0, H * 0.7);
    for (let i = 0; i <= 30; i++) cx.lineTo(i / 30 * W, H * 0.7 + Math.sin(i * 0.7) * 4 * U);
    cx.lineTo(W, H); cx.lineTo(0, H); cx.fill();
    if (K === 'C') { cx.strokeStyle = 'rgba(95,120,143,.4)'; cx.lineWidth = 2 * U; for (const o of [-5, 5]) { cx.beginPath(); cx.moveTo(W * 0.48 + o * U, H); cx.quadraticCurveTo(W * 0.5, H * 0.8, W * 0.52 + o * 0.3 * U, H * 0.66); cx.stroke(); } }
  }
  // дым: wash 0..1 — нисходящий поток винта (борт низко и близко): столб прижимает к земле и сносит от борта (lean — знак стороны)
  function smoke(x, y, k, lean, wash = 0) {
    if (Math.random() < 0.5 * k) fx.spawn({ t: 'smoke', x: x + R(-4, 4) * U, y: y + wash * 40 * U, vx: (lean * R(10, 40) + Math.sign(lean || 1) * wash * R(140, 260)) * U, vy: -R(20, 40) * U * (1 - 0.9 * wash), life: R(2, 3.5) * (1 - 0.5 * wash), max: 3.5, r: R(6, 10) * U, grow: 6 * U * (1 + wash) });
  }
  // сила нисходящего потока в точке x (px экрана): борт ниже ~40 % высоты и ближе ~0.35 ширины экрана
  function washAt(x) { const h = heliPos(T), gy = H * 0.8, alt = cl(1 - (gy - h.y * H) / (H * 0.45)), d = Math.abs(x - h.x * W) / W; return T < 10 ? alt * alt * cl(1 - d / 0.35) : 0; }
  // мировые модели в экранном масштабе: окружение для ArtWorld (свет и искры здесь не нужны — свой грейд)
  const NOENV = () => ({ now: T, night: K === 'D' ? 1 : 0.2, wind: 1, light() {}, glow() {}, spark() {}, eye() {} });
  function world(x, y, s, fn) { cx.save(); cx.translate(x, y); cx.scale(s, s); fn(); cx.restore(); }
  // сигнальные штабели — та же модель, что в мире (ArtWorld.stack), горят
  const STK = [0, 1, 2].map(() => ({ x: 0, y: 0, lit: 30, wood: 4 }));
  function stacks(dt) {
    const h = heliPos(T), close = T > 3 ? ease((T - 3) / 2) : 0, s = U * 0.85;
    for (let i = 0; i < 3; i++) {
      const x = W * (0.24 + i * 0.12), y = H * 0.76 + (i % 2) * 8 * U;
      glowAt(x, y - 20 * s, 110 * s, 0.35);
      const wash = washAt(x), env = NOENV(); env.wind = 1 + wash * 4; env.wx = x < h.x * W ? -1 : 1; // пламя клонит потоком от борта
      world(x, y, s, () => ArtWorld.stack(cx, STK[i], env));
      smoke(x, y - 60 * s * (1 - 0.5 * wash), 1, (x - h.x * W) / W * 6 * close + 0.3, wash);
    }
  }
  // метеостанция (глава VII): дом и мачта из мира (ArtZones.obj), упряжка у крыльца, флюгер крутится
  const MET = { type: 'meteoHouse', id: 'finMeteo', x: 0, y: 0 }, MAST = { type: 'mast', id: 'finMast', x: 0, y: 0 }, SLED = { x: 0, y: 0, face: 1 };
  function meteo(dt) {
    const env = NOENV(); env.wind = 1.4;
    const s = U * 1.25;
    glowAt(W * 0.13, H * 0.7, 90 * s, 0.2);
    world(W * 0.13, H * 0.74, s, () => ArtZones.obj(cx, MET, env));
    world(W * 0.42, H * 0.75, s * 0.95, () => ArtZones.obj(cx, MAST, env));
    if (typeof ArtAnimals !== 'undefined') world(W * 0.9, H * 0.84, U * 1.1, () => ArtZones.deerSled(cx, SLED, env));
    smoke(W * 0.13 + 34 * s, H * 0.74 - 114 * s, 1, 0.5, washAt(W * 0.13) * 0.6);
  }
  function glowAt(x, y, r, a) { const gl = cx.createRadialGradient(x, y, 0, x, y, r); gl.addColorStop(0, `rgba(255,179,71,${a})`); gl.addColorStop(1, 'rgba(255,179,71,0)'); cx.fillStyle = gl; cx.fillRect(x - r, y - r, r * 2, r * 2); }
  // посёлок — постройки мира (ArtWorld.building), ночью окна горят
  const VIL = [['balok', 0.14, 0.74, 1.5], ['market', 0.3, 0.76, 1.5], ['smoke', 0.62, 0.745, 1.4], ['balok', 0.8, 0.77, 1.7], ['woodshed', 0.46, 0.72, 1.2]].map(([type, fx0, fy, s], i) => ({ type, fx: fx0, fy, s, b: { type, x: 0, y: 0, done: 1, fuel: 60, stockWood: 20 }, i }));
  const FIRE = { x: 0, y: 0, fuel: 90 };
  function village(dt) {
    for (const v of VIL) {
      const x = W * v.fx, y = H * v.fy, s = U * v.s;
      if (T > 1 + v.i * 0.7) glowAt(x, y - 20 * s, 60 * s, 0.22);
      world(x, y, s, () => ArtWorld.building(cx, v.b, NOENV()));
    }
    // костёр посреди посёлка — ArtWorld.fire
    const x = W * 0.5, y = H * 0.84;
    glowAt(x, y, 120 * U, 0.35);
    world(x, y, U * 1.3, () => ArtWorld.fire(cx, FIRE, NOENV()));
  }
  // люди — тот же риг, что в мире (ArtPeople), внешность по роли
  const LOOK = { lesha: 'anorak', vera: 'vera', urk: 'urk', tamara: 'tamara' }, FOLK = ['bich', 'evenk', 'strelok', 'bich', 'evenk'];
  function person(p, x, y, s) {
    if (typeof ArtPeople !== 'undefined') {
      const look = LOOK[p.who] || FOLK[(p.fi == null ? (p.fi = crowd.indexOf(p)) : p.fi) % FOLK.length];
      const anim = p.moving ? (p.limp ? 'limp' : 'walk') : p.waving ? 'wave' : 'idle';
      cx.save(); cx.translate(x, y); cx.scale(s * 0.95, s * 0.95);
      ArtPeople.draw(cx, { x: 0, y: 0, face: p.away ? 1 : p.sp < 0 ? -1 : 1, vy: p.away ? -1 : 0, speed: 0.4, t: T, phase: T * 7, anim, look, tool: p.ski ? 'none' : 'none', seed: crowd.indexOf(p) + 1 });
      cx.restore();
      if (p.pipe && Math.random() < 0.05) fx.spawn({ t: 'smoke', x: x + 7 * s, y: y - 36 * s, vx: 6 * U, vy: -12 * U, life: 2, max: 2, r: 3 * U, grow: 6 * U });
      return;
    }
    const t = T * (p.ski ? 2.2 : 5.5), moving = p.moving, sw = moving ? Math.sin(t) * 5 * s : 0, limp = p.limp ? Math.max(0, Math.sin(t)) * 3 * s : 0;
    cx.save(); cx.translate(x, y - limp);
    cx.fillStyle = 'rgba(39,57,74,.18)'; cx.beginPath(); cx.ellipse(0, limp, 12 * s, 3 * s, 0, 0, 7); cx.fill();
    if (p.ski) { cx.strokeStyle = '#67482f'; cx.lineWidth = 2 * s; cx.beginPath(); cx.moveTo(-3 * s, 0); cx.lineTo(-3 * s, -8 * s); cx.moveTo(3 * s, 0); cx.lineTo(3 * s, -8 * s); cx.stroke(); }
    cx.strokeStyle = '#352b25'; cx.lineWidth = 4 * s; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(-2 * s, -12 * s); cx.lineTo(-2 * s + sw, 0); cx.moveTo(2 * s, -12 * s); cx.lineTo(2 * s - (p.limp ? 0 : sw), 0); cx.stroke();
    cx.fillStyle = p.col; cx.beginPath(); cx.moveTo(-8 * s, -12 * s); cx.lineTo(-6 * s, -32 * s); cx.lineTo(6 * s, -32 * s); cx.lineTo(8 * s, -12 * s); cx.fill();
    cx.strokeStyle = p.col; cx.lineWidth = 3.5 * s;
    const wave = p.wave && p.waving ? Math.sin(T * 9) * 0.5 : 0;
    cx.beginPath(); cx.moveTo(6 * s, -29 * s);
    if (wave || (p.wave && p.waving)) cx.lineTo(12 * s + wave * 4 * s, -42 * s); else cx.lineTo(7 * s + sw * 0.5, -16 * s);
    cx.moveTo(-6 * s, -29 * s); cx.lineTo(-7 * s - sw * 0.5, -16 * s); cx.stroke();
    cx.fillStyle = '#e7bc96'; cx.beginPath(); cx.arc(0, -36 * s, 4.5 * s, 0, 7); cx.fill();
    cx.fillStyle = p.who === 'urk' ? '#5b3d27' : p.who === 'vera' ? '#e0ded2' : '#473930';
    cx.beginPath(); cx.arc(0, -38 * s, 5.5 * s, Math.PI, 0); cx.fill(); cx.fillRect(-6 * s, -39 * s, 12 * s, 2.5 * s);
    if (p.pipe) { cx.strokeStyle = '#3a2618'; cx.lineWidth = 1.5 * s; cx.beginPath(); cx.moveTo(3 * s, -34 * s); cx.lineTo(8 * s, -33 * s); cx.stroke(); if (Math.random() < 0.06) fx.spawn({ t: 'smoke', x: x + 8 * s, y: y - 35 * s, vx: 6 * U, vy: -12 * U, life: 2, max: 2, r: 3 * U, grow: 6 * U }); }
    cx.restore();
  }
  function people(dt) {
    const h = heliPos(T), D = ArtWorld.MI8_DOOR, doorX = h.x + (D.x0 + D.x1) / 2 * U * 1.1 / W, door = { x: doorX * W, y: H * 0.8 }; // дверь модели (сдвижная, левый борт)
    const list = crowd.slice().sort((a, b) => a.y - b.y);
    for (const p of list) {
      if (p.gone) continue;
      let x = p.x * W, y = p.y * H, s = U * 1.15 * (0.8 + (p.y - 0.75) * 3);
      p.moving = false; p.waving = false;
      if (T > p.delay) {
        if (p.away) { const k = (T - p.delay) * p.sp; p.px = p.x + Math.sin(k * 6) * 0.01; p.py = p.y - k * 1.1; x = p.px * W; y = p.py * H; s *= cl(1 - k * 2.4, 0.2); p.moving = true; cx.globalAlpha = cl(1 - k * 2); }
        else if (p.roam) { p.cx = (p.cx == null ? p.x : p.cx) + p.sp * dt; if (p.cx > 0.95 || p.cx < 0.05) p.sp *= -1; x = p.cx * W; p.moving = true; }
        else if (p.sp) {
          p.cx = (p.cx == null ? p.x : p.cx); const tx = p.stop ? doorX - 0.1 - p.stop * 0.2 : doorX;
          if (p.cx < tx) { p.cx = Math.min(tx, p.cx + p.sp * dt); p.moving = true; } else if (!p.stop) { p.gone = T > 8.3; p.waving = p.who === 'vera'; } else p.waving = !!p.wave && T > 8;
          x = p.cx * W; y = (p.y + (door.y / H - p.y) * cl((p.cx - p.x) / 0.4) * 0.5) * H;
        }
      }
      if (p.who === 'urk' && !p.sp && K === 'A') { p.waving = false; }
      if (p.waveAt && T > p.waveAt) p.waving = true;
      person(p, x, y, s); cx.globalAlpha = 1;
    }
  }
  // вертолёт — та же модель, что в мире (ArtWorld.mi8Fly: ливрея №1–3 + полоса №15), ротор — размытый диск
  function heli(x, y, s, tilt) {
    const gy = H * 0.8, alt = cl(1 - (gy - y) / (H * 0.7));
    cx.fillStyle = `rgba(39,57,74,${0.25 * alt})`; cx.beginPath(); cx.ellipse(x, gy + 6 * U, 110 * s * (0.6 + alt * 0.4), 10 * s, 0, 0, 7); cx.fill();
    cx.save(); cx.translate(x, y - 22 * s); cx.rotate(tilt); cx.scale(s, s);
    cx.drawImage(ArtWorld.mi8Fly(), -108, -70, 290, 132);
    // сдвижная дверь (та же, что у обломков, MI8_DOOR): после посадки отъезжает назад, изнутри тёплый свет
    const D = ArtWorld.MI8_DOOR, op = cl((T - LAND - 0.4) / 0.6), dw = D.x1 - D.x0;
    if (op > 0) {
      cx.fillStyle = '#10151a'; cx.fillRect(D.x0, D.y0 + 8, dw * op, D.y1 - D.y0 - 8); cx.fillStyle = 'rgba(255,179,71,.35)'; cx.fillRect(D.x0 + 2, D.y0 + 10, Math.max(0, dw * op - 4), D.y1 - D.y0 - 12);
      cx.fillStyle = '#a5acb3'; cx.fillRect(D.x0 + dw * op, D.y0 + 8, dw, D.y1 - D.y0 - 8); cx.fillStyle = '#6c7178'; cx.fillRect(D.x0 + dw * op, D.y0 + 8, 1, D.y1 - D.y0 - 8);
    }
    // винты: лопасти с размытием движения (раскрутка — и после посадки не стоят), рулевой — на пилоне
    const spin = T < LAND + 3 ? 1 : 1 - ease((T - LAND - 3) / 4) * 0.6;
    ArtWorld.rotor(cx, 0, -66, 150, T * spin); ArtWorld.tailRotor(cx, 175, -56, 13, T * spin);
    cx.restore();
  }
  function downwash(dt, h) {
    const gy = H * 0.8, alt = cl(1 - (gy - h.y * H) / (H * 0.55)), k = alt * alt * (T < 10 ? 1 : 0.4);
    const n = Math.floor(k * 90 * dt * (reduced ? 0.4 : 1) * 10);
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? -1 : 1, sp = R(120, 380) * U;
      fx.spawn({ t: 'snow', x: h.x * W + R(-30, 30) * U, y: gy + R(-4, 6) * U, vx: dir * sp, vy: -R(20, 110) * U, life: R(0.8, 1.8), max: 1.8, r: R(1.2, 3.2) * U, swirl: dir * R(1, 3), u: U, g: 90 * U, drag: 1.5 });
    }
    if (k > 0.2) { const g = cx.createRadialGradient(h.x * W, gy, 0, h.x * W, gy, 260 * U * k); g.addColorStop(0, `rgba(246,249,252,${0.55 * k})`); g.addColorStop(1, 'rgba(246,249,252,0)'); cx.fillStyle = g; cx.fillRect(h.x * W - 260 * U, gy - 200 * U, 520 * U, 260 * U); }
  }
  function snow(dt) {
    const rate = K === 'C' ? 40 : K === 'B' ? 25 : 12;
    for (let i = 0; i < rate * dt; i++) fx.spawn({ t: 'flake', x: R(0, W), y: -5, vx: R(-10, 20) * U, vy: R(25, 60) * U, life: 12, max: 12, r: R(0.8, 2) * U, floor: H + 10, a: 0.8 });
    fx.update(dt);
    // дым — тон №21/№3, снег — №1 (ночью — №3): палитра мира
    const smokeC = K === 'D' ? 'rgba(108,113,120,0.35)' : 'rgba(182,201,223,0.35)', snowC = K === 'D' ? '#b6c9df' : '#f6f9fc';
    fx.draw(cx, q => q.t === 'smoke' ? smokeC : snowC);
  }
  function titles() {
    const TX = {
      A: ['Борт 24713 — домой', S.vera ? 'Лёша, Вера' + (S.pop > 1 ? ' и ещё ' + (S.pop - 1) : '') + '. Дед остался. Курит.' : 'Дед остался. Курит.'],
      B: ['Борт 24713 — домой', 'Один. В вертолёте тепло и тихо.'],
      D: ['Новый посёлок', (S.pop || 0) + ' человек зимуют. Весной придёт почта.'],
      C: ['Весной выйдем', 'Вместе. Уркачан впереди, лыжня за ним.'],
      E: ['Кербо-2 — Тура', (S.vera ? 'Лёша и Вера дошли. ' : 'Дошёл. ') + 'Тамара Ильинична машет с крыльца.'],
    }[K];
    const t0 = HELI(K) ? 7.3 : 4, a = cl((T - t0) / 1.2) * cl((DUR[K] - 0.6 - T) / 0.8);
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
