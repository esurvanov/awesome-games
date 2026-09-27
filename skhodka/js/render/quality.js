// Качество картинки зала: low / mid / high и авто-подбор по FPS.
// Что меняется: плотность пикселей (dpr — главный рычаг: на программной отрисовке кадр ≈ число пикселей),
// сглаживание (только при создании), число настоящих источников света (остальной свет запечён в текстуры),
// мелкий декор на столах, частицы эффектов, ореолы у ламп, размер текстур.
// auto: стартуем с mid (телефон) / high (мышь), а на программной отрисовке (SwiftShader, llvmpipe — нет
// видеокарты) — сразу с low. Первые секунды меряем короткими окнами (0.5 с) и при просадке спускаемся сразу
// на несколько ступеней лестницы (уровень × доля разрешения), поэтому подходящая ступень находится за 1–3 с.
// Дальше окна по 2 с; вверх — только после долгой стабильной работы, и если подъём не удержался — эта
// ступень больше не пробуется (потолок), чтобы качество не скакало. tests/perf.js проверяет это на SwiftShader.
'use strict';
L.def('render/quality', () => {
const { Settings } = L.use('core');

const LEVELS = {
  // dpr — предел плотности пикселей, aa — сглаживание, lights — точечных огней, fine — посуда/мелочь на столах,
  // fx — доля частиц (дождь, гирлянды, запах), tex — сторона текстуры, halo — ореолы у ламп
  // px — предел пикселей холста (большой экран на low рисуем не гуще px, но не реже floor), cost — во сколько раз
  // пиксель дороже, чем на low (огни, сглаживание, ореолы) — для прикидки авто
  low:  { name: 'low',  dpr: 0.75, px: 4.5e5, floor: 0.6, aa: false, lights: 1, fine: false, fx: 0.4, tex: 256, halo: false, cost: 1 },
  mid:  { name: 'mid',  dpr: 1.5,  aa: true,  lights: 3, fine: true,  fx: 0.7, tex: 512, halo: true, cost: 1.3 },
  high: { name: 'high', dpr: 2,    aa: true,  lights: 4, fine: true,  fx: 1,   tex: 512, halo: true, cost: 1.45 },
};
const screenPx = () => typeof innerWidth !== 'undefined' ? innerWidth * innerHeight : 1366 * 768;
const devDpr = () => typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
// предел плотности пикселей уровня для текущего окна
function dprOf(L) { return L.px ? Math.max(L.floor, Math.min(L.dpr, Math.sqrt(L.px / screenPx()))) : L.dpr; }
const ORDER = ['low', 'mid', 'high'];
// лестница авто: [уровень, доля разрешения] от худшей к лучшей; нижняя ступень — 0.85 × (0.65..0.75) ≈ 0.55–0.64 пикселя
const LADDER = [['low', 0.85], ['low', 1], ['mid', 0.75], ['mid', 1], ['high', 0.8], ['high', 1]];
// относительная цена кадра на ступени: (постоянная часть — люди, геометрия, вызовы ≈ 0.5 Мпикс + пиксели холста)
// × цена пикселя уровня. Постоянная часть не даёт прикидке обещать лишнего от одного уменьшения разрешения
function costOf([lv, rs]) { const L = LEVELS[lv], d = Math.min(devDpr(), dprOf(L)) * rs; return (0.5 + d * d * screenPx() / 1e6) * L.cost; }
const T = {
  fastWin: 0.5, fastFor: 6,   // с: короткие окна замера в начале (и после reset)
  slowWin: 2,                 // с: окно замера потом
  settle: 0.35,               // с: после смены не мерить (перестройка шейдеров, размер холста)
  low: 27,                    // кадров/с: ниже — вниз, сразу на ступень, где по прикидке будет ≥ aim
  aim: 40,
  high: 55, upAfter: 10,      // выше high кадров/с подряд upAfter с — пробуем ступень выше (если прикидка ≥ aim)
};

// программная отрисовка: видеокарты нет — WebGL считает процессор (дорог каждый пиксель)
function software() {
  try {
    if (typeof document === 'undefined') return false;
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return false;
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
  } catch (e) { return false; }
}

class Quality {
  // pref: 'auto' | 'low' | 'mid' | 'high' (по умолчанию — из настроек игрока)
  constructor(pref) {
    const s = pref || Settings.get('quality') || 'auto';
    this.auto = !LEVELS[s];
    this.soft = this.auto && software();
    this.onChange = null;
    this.rs = 1;                    // доля разрешения внутри уровня (авто двигает её вместе с уровнем)
    this.restart();
    if (LEVELS[s]) this.set(s); else this.reset();
  }
  // счётчики замера (и когда игрок переключает авто в настройках — уровень остаётся, замер заново)
  restart() {
    this.acc = 0; this.n = 0; this.t = 0; this.age = 0; this.cool = T.settle; this.good = 0;
    this.ceil = LADDER.length - 1; this.lastDown = -99; this.lastUp = -99; this.changes = 0;
  }
  set(name) { const { dpr, ...rest } = LEVELS[name]; Object.assign(this, rest); this.level = name; }
  get dpr() { return dprOf(LEVELS[this.level]); }
  // авто с начала: стартовая ступень по устройству, короткие окна, потолок снят
  reset() {
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.set(this.soft ? 'low' : coarse ? 'mid' : 'high'); this.rs = 1;
    this.restart();
  }
  // текущая ступень лестницы (ближайшая к уровню и доле разрешения)
  get rung() {
    let best = 0, bd = 1e9;
    LADDER.forEach(([lv, rs], i) => { const d = (lv === this.level ? 0 : 10) + Math.abs(rs - this.rs); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  go(i) {
    const [lv, rs] = LADDER[Math.max(0, Math.min(LADDER.length - 1, i))];
    if (lv === this.level && rs === this.rs) return false;
    this.set(lv); this.rs = rs; this.cool = T.settle; this.acc = 0; this.n = 0; this.t = 0; this.changes++;
    this.onChange && this.onChange();
    return true;
  }
  // dt — реальная длительность кадра (с)
  sample(dt) {
    if (!this.auto || !(dt > 0)) return;
    this.age += dt;
    if (this.cool > 0) { this.cool -= dt; return; }
    this.acc += dt; this.n++; this.t += dt;
    if (this.t < (this.age < T.fastFor ? T.fastWin : T.slowWin) || this.n < 3) return;
    const fps = this.n / this.acc; this.acc = 0; this.n = 0; this.t = 0;
    const r = this.rung;
    if (fps < T.low) {
      this.good = 0;
      // подъём не удержался (упали вскоре после него) — выше этой ступени больше не ходим
      if (this.age - this.lastUp < 15) this.ceil = Math.min(this.ceil, r - 1);
      // сразу на ту ступень, где по прикидке (кадр ∝ цене ступени) будет ≥ aim: одна смена вместо нескольких —
      // каждая смена уровня перестраивает шейдеры, это лишняя пауза
      const c = costOf(LADDER[r]);
      let to = 0;
      for (let i = r - 1; i > 0; i--) if (fps * c / costOf(LADDER[i]) >= T.aim) { to = i; break; }
      if (this.go(to)) this.lastDown = this.age;
    } else if (fps > T.high && r < this.ceil && fps * costOf(LADDER[r]) / costOf(LADDER[r + 1]) >= T.aim) {
      this.good += this.age < T.fastFor ? T.fastWin : T.slowWin;
      if (this.good < T.upAfter || this.age - this.lastDown < 20) return;
      this.good = 0;
      if (this.go(r + 1)) this.lastUp = this.age;
    } else this.good = 0;
  }
}
return { LEVELS, LADDER, Quality, dprOf };
});
