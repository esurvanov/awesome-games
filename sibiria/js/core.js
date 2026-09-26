'use strict';
// Ядро: утилиты, настройки игрока, общее состояние (G, state, now, cam, input), общая хеш-сетка Space.
// Модули логики (js/*.js) — пространства имён-объекты; общие глобалы — только отсюда, из data.js и
// несколько имён, которые читает рендер (hourOf, daylight, stormOn, insideHut, treesNear, breath).

// ---------- утилиты ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const dist = (a, b) => Math.sqrt(dist2(a, b));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------- настройки игрока (localStorage, всё в try/catch); уровни сложности — TUNE.diff ----------
const Settings = (() => {
  const DEF = { music: 0.7, sfx: 0.8, diff: 'normal', ui: 1, shake: 1, edge: 1, tips: 1 };
  let v = Object.assign({}, DEF);
  try { const s = JSON.parse(localStorage.getItem('sibir-settings') || '{}'); if (s && typeof s === 'object') for (const k in DEF) if (typeof s[k] === typeof DEF[k]) v[k] = s[k]; } catch (e) {}
  if (!TUNE.diff[v.diff]) v.diff = 'normal';
  const subs = [];
  return {
    DIFF: TUNE.diff,
    get: k => v[k],
    set(k, x) { v[k] = x; try { localStorage.setItem('sibir-settings', JSON.stringify(v)); } catch (e) {} for (const f of subs) f(k, x); },
    on(f) { subs.push(f); f(null); },
    diff: () => TUNE.diff[v.diff] || TUNE.diff.normal,
  };
})();

let G = null, state = 'menu', now = 0, checkpoint = null;
const deathLog = {};
const cam = { x: 0, y: 0 };
const input = { mx: 0, my: 0, act: false };

// ---------- общая хеш-сетка: деревья, постройки, люди, звери ----------
// Одна структура вместо TGRID / временной сетки генерации / переборов «ближайшего».
// Статичная сетка (деревья) заполняется раз; подвижная (src — функция, отдающая массив) пересобирается
// лениво при запросе: раз в every шагов update (frame) — или сразу, если массив подменили / изменилась длина.
// slack — запас радиуса на то, что объект сдвинулся после пересборки (скорость × every шагов).
const Space = (() => {
  let frameNo = 0;
  class Grid {
    constructor(src = null, slack = 0, cell = WORLD.gridCell, every = 1) { this.c = cell; this.m = new Map(); this.src = src; this.slack = slack; this.every = every; this.f = -1e9; this.arr = null; this.n = -1; }
    key(i, j) { return (i << 16) | (j & 0xffff); }
    sync() {
      if (!this.src) return;
      const a = this.src();
      if (a === this.arr && frameNo - this.f < this.every && frameNo >= this.f && (!a || a.length === this.n)) return;
      this.arr = a; this.f = frameNo; this.n = a ? a.length : -1; this.m.clear();
      if (a) for (const o of a) this.add(o);
    }
    add(o) { const k = this.key(Math.floor(o.x / this.c), Math.floor(o.y / this.c)); const b = this.m.get(k); if (b) b.push(o); else this.m.set(k, [o]); }
    clear() { this.m.clear(); this.arr = null; this.n = -1; }
    // всё в квадрате ±r (без проверки расстояния) — порядок: по x, внутри по y, внутри по вставке
    near(x, y, r, out = []) {
      this.sync();
      r += this.slack; const c = this.c;
      const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((y - r) / c), j1 = Math.floor((y + r) / c);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const b = this.m.get(this.key(i, j)); if (b) for (const o of b) out.push(o); }
      return out;
    }
  }
  // Ближайший к точке (x, y) не дальше r, с фильтром f. src — массив (перебор) или Grid (кольца ячеек).
  // Единственная функция «ближайшего» на всю игру: герой, посёлок, выбор людей мышью/пальцем.
  function nearest(src, x, y, r = Infinity, f = null) {
    let best = null, bd = r * r;
    const test = o => { const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd && (!f || f(o))) { bd = d; best = o; } };
    if (!src) return null;
    if (!(src instanceof Grid)) { for (const o of src) test(o); return best; }
    src.sync();
    const c = src.c, s = src.slack, ci = Math.floor(x / c), cj = Math.floor(y / c);
    const K = Math.min(Math.ceil((Math.min(r, 1e7) + s) / c), Math.ceil(Math.max(W, H) / c) + 2);
    for (let k = 0; k <= K; k++) {
      const lo = (k - 1) * c - s; // ближе этого в кольце k ничего нет
      if (best && lo > 0 && lo * lo >= bd) break;
      for (let i = ci - k; i <= ci + k; i++) {
        const edge = i === ci - k || i === ci + k;
        for (let j = cj - k; j <= cj + k; j += edge ? 1 : 2 * k || 1) { const b = src.m.get(src.key(i, j)); if (b) for (const o of b) test(o); }
      }
    }
    return best;
  }
  // «Спящие» сущности: дальше TUNE.r.awake от героя тикают раз в 8 шагов update, получая сумму dt
  // за эти 8 шагов. Близость проверяется в свой шаг (i — номер в списке, разносит проверки по кадрам).
  // Признак сна — под символом: не попадает ни в сейв, ни в перечисление полей.
  const LOD_SLEEP = Symbol('sleep'), DT8 = new Array(8).fill(0);
  let dtSum8 = 0;
  // шаг update: номер кадра (для ленивых сеток) и окно dt для «спящих»
  function tick(dt) { frameNo++; DT8[frameNo & 7] = dt; dtSum8 = 0; for (const v of DT8) dtSum8 += v; }
  function lodDt(o, dt, i) {
    if ((frameNo + i) & 7) return o[LOD_SLEEP] ? 0 : dt;
    const dx = o.x - G.p.x, dy = o.y - G.p.y, far = dx * dx + dy * dy >= TUNE.r.awake * TUNE.r.awake, was = o[LOD_SLEEP];
    o[LOD_SLEEP] = far;
    return far && was ? dtSum8 : dt;
  }
  return {
    Grid, nearest, tick, lodDt,
    trees: new Grid(),
    rocks: new Grid(), // глыбы курумника и гольца (статичные, из seed)
    drifts: new Grid(), tussocks: new Grid(), // статичные, для печи кусков снега в gfx (вместо перебора всех)
    builds: new Grid(() => G && G.col ? G.col.builds : null, 0),
    units: new Grid(() => G && G.col ? G.col.units : null, 40),
    hares: new Grid(() => G ? G.hares : null, 64, WORLD.gridCell, 8), // заяц ≤ 150 px/с → за 8 шагов ≤ 20 px
  };
})();
