'use strict';
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

// ---------- настройки игрока (localStorage, всё в try/catch) ----------
const DIFF = {
  easy:   { n: 'Лёгкая',  i: ':day:', cold: 0.75, hunger: 0.75, wolf: 0.6 },
  normal: { n: 'Обычная', i: ':frost:', cold: 1, hunger: 1, wolf: 1 },
  hard:   { n: 'Тяжёлая', i: ':frost:', cold: 1.25, hunger: 1.2, wolf: 1.4 },
};
const Settings = (() => {
  const DEF = { music: 0.7, sfx: 0.8, diff: 'normal', ui: 1, shake: 1, edge: 1, tips: 1 };
  let v = Object.assign({}, DEF);
  try { const s = JSON.parse(localStorage.getItem('sibir-settings') || '{}'); if (s && typeof s === 'object') for (const k in DEF) if (typeof s[k] === typeof DEF[k]) v[k] = s[k]; } catch (e) {}
  if (!DIFF[v.diff]) v.diff = 'normal';
  const subs = [];
  return {
    get: k => v[k],
    set(k, x) { v[k] = x; try { localStorage.setItem('sibir-settings', JSON.stringify(v)); } catch (e) {} for (const f of subs) f(k, x); },
    on(f) { subs.push(f); f(null); },
    diff: () => DIFF[v.diff] || DIFF.normal,
  };
})();

let G = null, state = 'menu', now = 0, checkpoint = null;
const deathLog = {};
const cam = { x: 0, y: 0 };
const input = { mx: 0, my: 0, act: false };

// ---------- общая хеш-сетка: деревья, постройки, люди, звери ----------
// Одна структура вместо TGRID / временной сетки генерации / переборов «ближайшего».
// Статичная сетка (деревья) заполняется раз; подвижная (src — функция, отдающая массив) пересобирается
// лениво при запросе: раз в every шагов update (frameNo) — или сразу, если массив подменили / изменилась длина.
// slack — запас радиуса на то, что объект сдвинулся после пересборки (скорость × every шагов).
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
function nearestIn(src, x, y, r = Infinity, f = null) {
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
// туман войны: клетка FOG.cell px мира, сетка nx × ny (при ×1 — 36 × 36); значение клетки 0..3
const FOG = { cell: WORLD.fogCell, nx: Math.ceil(W / WORLD.fogCell), ny: Math.ceil(H / WORLD.fogCell) };
const Space = {
  trees: new Grid(),
  drifts: new Grid(), tussocks: new Grid(), // статичные, для печи кусков снега в gfx (вместо перебора всех)
  builds: new Grid(() => G && G.col ? G.col.builds : null, 0),
  units: new Grid(() => G && G.col ? G.col.units : null, 40),
  hares: new Grid(() => G ? G.hares : null, 64, WORLD.gridCell, 8), // заяц ≤ 150 px/с → за 8 шагов ≤ 20 px
};
// «Спящие» сущности: дальше RADII.awake от героя тикают раз в 8 шагов update, получая сумму dt
// за эти 8 шагов. Близость проверяется в свой шаг (i — номер в списке, разносит проверки по кадрам).
// Признак сна — под символом: не попадает ни в сейв, ни в перечисление полей.
const LOD_SLEEP = Symbol('sleep'), DT8 = new Array(8).fill(0);
let dtSum8 = 0;
function lodTick(dt) { DT8[frameNo & 7] = dt; dtSum8 = 0; for (const v of DT8) dtSum8 += v; }
function lodDt(o, dt, i) {
  if ((frameNo + i) & 7) return o[LOD_SLEEP] ? 0 : dt;
  const dx = o.x - G.p.x, dy = o.y - G.p.y, far = dx * dx + dy * dy >= RADII.awake * RADII.awake, was = o[LOD_SLEEP];
  o[LOD_SLEEP] = far;
  return far && was ? dtSum8 : dt;
}
const COLL = [
  { x: POI.cockpit.x - 30, y: POI.cockpit.y, r: 40 }, { x: POI.cockpit.x + 40, y: POI.cockpit.y - 10, r: 38 },
  { x: POI.tail.x, y: POI.tail.y, r: 34 }, { x: POI.chum.x, y: POI.chum.y - 10, r: 34 },
  { x: POI.labaz.x, y: POI.labaz.y, r: 22 },
];

// ---------- время и погода ----------
const hourOf = () => ((START_H / 24 + G.time / CYCLE) % 1) * 24;
const dayOf = () => 1 + Math.floor(START_H / 24 + G.time / CYCLE);
const tAt = (day, hour) => ((day - 1) + hour / 24 - START_H / 24) * CYCLE;
function daylight(h = hourOf()) { return smooth(6.4, 8, h) * (1 - smooth(17.6, 19.3, h)); }
const stormOn = () => !!(G.storm && G.time >= G.storm.a && G.time < G.storm.b);
function temperature() {
  const d = daylight(), day = G.day, td = -22 - 2 * (day - 1), tn = day >= 5 ? -55 : -40 - 3 * (day - 1);
  return Math.round(tn + (td - tn) * d - (stormOn() ? 12 : 0));
}
const insideHut = (x, y) => x > HUT_IN.x0 && x < HUT_IN.x1 && y > HUT_IN.y0 && y < HUT_IN.y1;
const nearHut = (r = 230) => Math.hypot(G.p.x - HUT.x, G.p.y - (HUT.y - 30)) < r;
const inCedar = (x, y) => Math.hypot(x - POI.cedar.x, y - POI.cedar.y) < POI.cedar.r;
const onThinIce = o => Math.hypot(o.x - POI.polynya.x, o.y - POI.polynya.y) < POI.polynya.r - 20;

// ---------- инвентарь ----------
const cnt = (id, wc) => id === 'food' ? FOOD_KEYS.reduce((s, k) => s + cnt(k, wc), 0) : (G.inv[id] || 0) + (wc ? (G.chest[id] || 0) : 0);
const has = (id, wc) => cnt(id, wc === undefined ? G.p.inside : wc) > 0;
function add(id, n = 1) { G.inv[id] = (G.inv[id] || 0) + n; }
function take(id, n, wc) {
  if (id === 'food') { if (cnt('food', wc) < n) return false; for (const k of FOOD_KEYS) while (n > 0 && cnt(k, wc) > 0) { take(k, 1, wc); n--; } return true; }
  const a = Math.min(n, G.inv[id] || 0); G.inv[id] = (G.inv[id] || 0) - a; n -= a;
  if (n > 0 && wc) { const b = Math.min(n, G.chest[id] || 0); G.chest[id] -= b; n -= b; }
  return n === 0;
}
function takeStock(id, n, chestOnly) {
  if (id === 'food') {
    if ((chestOnly ? FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0) : cnt('food', true)) < n) return false;
    for (const src of chestOnly ? [G.chest] : [G.chest, G.inv]) for (const k of FOOD_KEYS) while (n > 0 && (src[k] || 0) > 0) { src[k]--; n--; }
    return true;
  }
  const a = Math.min(n, G.chest[id] || 0); G.chest[id] = (G.chest[id] || 0) - a; n -= a;
  if (n > 0 && !chestOnly) { const b = Math.min(n, G.inv[id] || 0); G.inv[id] = (G.inv[id] || 0) - b; n -= b; }
  return n === 0;
}
const payStock = cost => { for (const [k, v] of Object.entries(cost)) takeStock(k, v); };
const canPay = (cost, wc) => Object.entries(cost).every(([k, v]) => cnt(k, wc) >= v);
function pay(cost, wc) { for (const [k, v] of Object.entries(cost)) take(k, v, wc); }
function weight() { let s = 0; for (const k in G.inv) s += (G.inv[k] || 0) * (ITEMS[k] ? ITEMS[k].kg : 0); return Math.round(s * 10) / 10; }
const capKg = () => 20 + (G.gear.sled ? 20 : 0);

// ---------- навыки ----------
function lvl(k) { const x = G.skills[k]; let l = 1; for (let i = 1; i < LV.length; i++) if (x >= LV[i]) l = i + 1; return l; }
function xp(k, n = 1) {
  const b = lvl(k); G.skills[k] += n; const a = lvl(k);
  if (a > b) { toast(`${SKILLS[k].i} ${SKILLS[k].n} · ур. ${a}`); Sound.ok2(); floatText(G.p.x, G.p.y - 60, `${SKILLS[k].i} ${a}`); }
}
const chopTime = () => (G.gear.saw ? 1.0 : 1.6) * (1 - 0.08 * (lvl('chop') - 1));
const fishChance = () => clamp((G.gear.lure ? 0.7 : 0.45) + 0.05 * (lvl('fish') - 1) - 0.06 * (G.day - 1), 0.15, 0.95);
const clothMul = () => G.gear.kukhl ? 0.6 : G.gear.dokha ? 0.7 : G.gear.hat ? 0.85 : 1;
const maxWarm = () => 100 - 10 * G.s.frost;
const secPerLog = () => G.hut.damper ? 45 : G.hut.walls ? 35 : 25;
function speed() {
  let s = 165;
  if (G.gear.skis) s *= 1.2; if (G.gear.sled) s *= 0.9;
  if (weight() > capKg()) s *= 0.6;
  if (stormOn() && !G.p.inside) s *= 0.8;
  if (G.s.warm < 15) s *= 0.75;
  return s;
}

// ---------- новая игра ----------
function newGame() {
  const seed = (Math.random() * 1e9) | 0, r = mulberry(seed);
  G = {
    time: 0, day: 1, chapter: 0, seed, lastDawn: 1,
    p: { x: POI.cockpit.x + 60, y: POI.cockpit.y + 120, face: 1, step: 0, moving: false, action: null, cd: 0, swing: 0,
      torch: 0, teaT: 0, wetT: 0, iceT: 0, lx: 0, ly: 0, inside: false, sleeping: false, sx: 0, sy: 0, br: 0, creaked: 0 },
    s: { warm: 90, food: 70, hp: 100, frost: 0 }, frostAcc: 0, coldAcc: 0,
    inv: { can: 1 }, chest: {}, gear: {}, skills: { chop: 0, fish: 0, hunt: 0, cold: 0 },
    hut: { walls: 0, door: 0, bench: 0, damper: 0, fuel: 0, doorHp: 100 }, charge: 0,
    flags: {}, notes: {}, fired: {}, known: { cockpit: 1 }, stats: { wood: 0, fish: 0, hares: 0, wolves: 0, scrap: 0 },
    trees: [], drifts: [], cracks: [], tussocks: [], hares: [], wolves: [], bear: null, fires: [], holes: [], traps: [],
    stacks: STACKS.map(s => ({ x: s.x, y: s.y, wood: 0, lit: 0 })),
    wreck: { cockpit: [...WRECK_POOL.cockpit], tail: [...WRECK_POOL.tail] },
    urk: { x: SPOT.urkDoor.x, y: SPOT.urkDoor.y, state: 'away', respect: 0, giftDay: 0, wolfQuest: 0, face: -1, step: 0,
      stock: Object.fromEntries(TRADES.map(t => [t.id, t.stock])) },
    vera: { x: POI.tail.x - 40, y: POI.tail.y + 40, state: 'tail', food: 1, face: 1, step: 0, waitT: 0 },
    D: { phase: 'relax', budget: 15, tension: 0, calmT: 20, last: null, queued: null, omenT: 0, dir: 0 },
    pack: null, storm: null, heli: null, heliDay: 0, rescueT: 0, labaz: 0, bearNight: -1,
    fog: new Array(FOG.nx * FOG.ny).fill(0), mercy: 0, aurora: 0.7,
    prints: [], parts: [],
  };
  genWorld(r);
  buildGrid();
  for (let i = 0, n = worldCount('hares'); i < n; i++) spawnHare(true);
  Colony.init();
  genLiving(r);
  G.decals = []; G.corpses = [];
  G.p.lx = G.p.x; G.p.ly = G.p.y; G.p.sx = G.p.x - 30; G.p.sy = G.p.y;
}

// Статичный мир — только из seed (r): деревья, стена, сугробы, трещины, кочки. В сейв не идёт (см. snapshot).
// Любая правка порядка вызовов r() или чисел здесь меняет лес под старыми сейвами → поднять GEN_V.
const GEN_V = 1;
const TREE_I = new WeakMap(); // дерево → индекс в G.trees (ссылки из задач людей и действий героя)
const wood0 = t => t.kind === 1 ? 2 : 3;
function genWorld(r) {
  const clear = [[POI.hut, 240], [POI.cockpit, 250], [POI.tail, 220], [POI.chum, 230], [POI.mar, 310], [POI.labaz, 100]];
  const grid = new Grid(null, 0, 64);
  const near = (x, y, m) => { for (const t of grid.near(x, y, m)) if ((t.x - x) ** 2 + (t.y - y) ** 2 < m * m) return true; return false; };
  let tries = 0;
  const N = worldCount('trees'), TRIES = worldCount('treeTries');
  while (G.trees.length < N && tries++ < TRIES) {
    const x = 90 + r() * (W - 180), y = 90 + r() * (H - 180);
    if (Math.abs(x - riverX(y)) < RW + 40) continue;
    if (clear.some(([p, rr]) => Math.hypot(x - p.x, y - p.y) < rr)) continue;
    const cedar = inCedar(x, y);
    if (near(x, y, cedar ? 40 : 46)) continue;
    const kind = cedar ? (r() < 0.85 ? 2 : 0) : (r() < 0.15 ? 1 : 0);
    const t = { x: Math.round(x), y: Math.round(y), s: +(0.8 + r() * 0.6).toFixed(2), wood: kind === 1 ? 2 : 3, kind, v: (r() * 2) | 0, shake: 0 };
    G.trees.push(t); grid.add(t);
  }
  // стена по краю мира: верх/низ — по ширине, лево/право — по высоте (при W = H — как раньше, тот же порядок r())
  for (let v = 0; v <= Math.max(W, H); v += WORLD.wallStep) {
    const q = [[v + r() * 10, 16 + r() * 20, v <= W], [v + r() * 10, H - 6 - r() * 16, v <= W], [12 + r() * 20, v + r() * 10, v <= H], [W - 12 - r() * 20, v + r() * 10, v <= H]];
    for (const [x, y, on] of q) if (on) G.trees.push({ x: Math.round(x), y: Math.round(y), s: 1.25, wood: 3, kind: 0, wall: 1, v: (r() * 2) | 0, shake: 0 });
  }
  G.trees.forEach((t, i) => TREE_I.set(t, i));
  for (let i = 0, n = worldCount('drifts'); i < n; i++) G.drifts.push({ x: r() * W | 0, y: r() * H | 0, rx: 30 + r() * 90 | 0, ry: 8 + r() * 18 | 0 });
  for (let i = 0, n = worldCount('cracks'); i < n; i++) G.cracks.push({ y: r() * H | 0, off: (r() - 0.5) * 110 | 0, len: 18 + r() * 50 | 0, a: +((r() - 0.5) * 1.2).toFixed(2) });
  // кочки — только на мари: их число от площади мари, а не мира
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * POI.mar.r;
    G.tussocks.push({ x: POI.mar.x + Math.cos(a) * d | 0, y: POI.mar.y + Math.sin(a) * d | 0, s: +(0.6 + r() * 0.8).toFixed(2) });
  }
}

function genLiving(r) {
  // сэвэки — AMULET_N деревянных оберегов по тайге; разнос растёт с линейным размером мира.
  // Лимит попыток: если разнос не влезает — ослабляем его, а не крутимся вечно.
  G.amuletsAt = [];
  let gap = RADII.amuletGap * Math.sqrt(WORLD.area);
  for (let tries = 0; G.amuletsAt.length < AMULET_N; tries++) {
    if (tries > 0 && tries % 4000 === 0) gap *= 0.8;
    const x = 200 + r() * (W - 400), y = 200 + r() * (H - 400);
    if (Math.abs(x - riverX(y)) < RW + 30 || Math.hypot(x - HUT.x, y - HUT.y) < 300) continue;
    if (G.amuletsAt.some(a => Math.hypot(a.x - x, a.y - y) < gap)) continue;
    G.amuletsAt.push({ x: x | 0, y: y | 0, got: 0 });
  }
  // оленье стадо Уркачана
  G.deer = [];
  for (let i = 0; i < 6; i++) G.deer.push({ x: POI.chum.x + 150 + r() * 200, y: POI.chum.y + r() * 200 - 60, vx: 0, vy: 0, t: r() * 3, face: r() < 0.5 ? -1 : 1, ph: r() * 6 });
  // вороны на верхушках
  G.ravens = [];
  for (let i = 0, n = worldCount('ravens'); i < n; i++) G.ravens.push({ x: 0, y: 0, fly: 0, t: r() * 20, vx: 0, vy: 0, z: 0 });
  for (const rv of G.ravens) perchRaven(rv);
}
function perchRaven(rv) {
  let t = null;
  for (let i = 0; i < 12 && !(t && t.wood > 0 && t.kind !== 1); i++) t = G.trees[(Math.random() * G.trees.length) | 0];
  if (!t || t.wood <= 0 || t.kind === 1) { rv.fly = 1; rv.t = 5; return; }
  rv.x = t.x + rnd(-6, 6); rv.y = t.y; rv.z = 100 * t.s * 0.95; rv.fly = 0; rv.vx = rv.vy = 0;
}
function buildGrid() {
  for (const k of ['trees', 'drifts', 'tussocks']) { Space[k].clear(); for (const o of G[k]) Space[k].add(o); }
  SHAKING.clear(); for (const t of G.trees) if (t.shake > 0) SHAKING.add(t);
}
// деревья в квадрате ±r (без проверки расстояния) — gfx, посёлок, бот
function treesNear(x, y, r, out = []) { return Space.trees.near(x, y, r, out); }
// дрожь дерева от удара: обновляем только дрожащие, а не весь лес каждый кадр
const SHAKING = new Set();
function shakeTree(t, v) { t.shake = v; SHAKING.add(t); }

// заяц: на старте — где угодно; потом — у героя (квадрат ±RADII.hareSpawn, не ближе 700), чтобы
// выбитые вокруг героя восполнялись там же, а не размазывались по всему миру
function spawnHare(any) {
  const R = RADII.hareSpawn;
  for (let k = 0; k < 30; k++) {
    const x = any ? rnd(120, W - 120) : rnd(Math.max(120, G.p.x - R), Math.min(W - 120, G.p.x + R));
    const y = any ? rnd(120, H - 120) : rnd(Math.max(120, G.p.y - R), Math.min(H - 120, G.p.y + R));
    if (!any && Math.hypot(x - G.p.x, y - G.p.y) < 700) continue;
    if (Math.hypot(x - HUT.x, y - HUT.y) < 300) continue;
    G.hares.push({ x, y, vx: 0, vy: 0, t: rnd(0.5, 2), face: 1, hop: 0, pr: 0 });
    return;
  }
}

// ---------- столкновения ----------
function pushRect(o, r, R) {
  const qx = clamp(o.x, R.x0, R.x1), qy = clamp(o.y, R.y0, R.y1), dx = o.x - qx, dy = o.y - qy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (d2 > 1e-4) { const d = Math.sqrt(d2); o.x = qx + dx / d * r; o.y = qy + dy / d * r; return; }
  const l = o.x - R.x0, rr = R.x1 - o.x, t = o.y - R.y0, b = R.y1 - o.y, m = Math.min(l, rr, t, b);
  if (m === l) o.x = R.x0 - r; else if (m === rr) o.x = R.x1 + r; else if (m === t) o.y = R.y0 - r; else o.y = R.y1 + r;
}
function pushCircle(o, r, c, cr) {
  const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy, m = r + cr;
  if (d2 < m * m && d2 > 1e-4) { const d = Math.sqrt(d2); o.x = c.x + dx / d * m; o.y = c.y + dy / d * m; }
}
function solid(o, r, who) {
  if (who === 'p') for (const t of treesNear(o.x, o.y, 40)) if (t.wood > 0) pushCircle(o, r, t, 4 + 8 * t.s);
  if (Math.abs(o.x - HUT.x) < 180 && Math.abs(o.y - HUT.y) < 160) {
    for (const R of HUT_WALLS) pushRect(o, r, R);
    if (who !== 'p' && G.hut.door) pushRect(o, r, DOOR_RECT);
  }
  for (const c of COLL) pushCircle(o, r, c, c.r);
  if (G.col) for (const b of Space.builds.near(o.x, o.y, r + 60)) if (b.done && !BUILDS[b.type].flat) { const B = BUILDS[b.type]; if (Math.abs(o.x - b.x) < B.w / 2 + r + 2 && Math.abs(o.y - b.y) < B.h / 2 + r + 2) pushRect(o, r, { x0: b.x - B.w / 2, x1: b.x + B.w / 2, y0: b.y - B.h / 2, y1: b.y + B.h / 2 }); }
  o.x = clamp(o.x, 40, W - 40); o.y = clamp(o.y, 50, H - 40);
}

// ---------- навигация: сетка 16 px + A* с кэшем пути ----------
// Прямая видимость → идём напрямую (почти всегда). Если на пути изба/постройка/обломки —
// A* по сетке, путь спрямляется «натягиванием нити» и кэшируется до смены цели или карты препятствий.
const Nav = (() => {
  const C = 16, NX = Math.ceil(W / C), NY = Math.ceil(H / C), N = NX * NY, MAXEXP = 3500;
  const blk = new Uint8Array(N), gs = new Float32Array(N), from = new Int32Array(N);
  const seen = new Uint32Array(N), shut = new Uint32Array(N);
  let gen = 1, key = '', ver = 0, lastG = null, lastT = -1;
  const heap = [], cache = new WeakMap(); // путь агента — вне G (не попадает в сейв)
  function stampRect(x0, y0, x1, y1, r) {
    const i0 = Math.max(0, ((x0 - r) / C) | 0), i1 = Math.min(NX - 1, ((x1 + r) / C) | 0), j0 = Math.max(0, ((y0 - r) / C) | 0), j1 = Math.min(NY - 1, ((y1 + r) / C) | 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = i * C + C / 2, cy = j * C + C / 2, qx = clamp(cx, x0, x1), qy = clamp(cy, y0, y1);
      if ((cx - qx) ** 2 + (cy - qy) ** 2 < r * r) blk[j * NX + i] = 1;
    }
  }
  const stampCircle = (x, y, r) => stampRect(x, y, x, y, r);
  function ensure() {
    if (lastG === G && lastT === G.time) return;
    lastT = G.time;
    const k = (G.hut.door ? 'd' : '') + '|' + (G.col ? G.col.builds.filter(b => b.done && !BUILDS[b.type].flat).map(b => b.id).join(',') : '');
    if (k === key && lastG === G) return;
    key = k; lastG = G; ver++; blk.fill(0);
    for (const R of HUT_WALLS) stampRect(R.x0, R.y0, R.x1, R.y1, 7);
    if (G.hut.door) stampRect(DOOR_RECT.x0, DOOR_RECT.y0, DOOR_RECT.x1, DOOR_RECT.y1, 7);
    for (const c of COLL) stampCircle(c.x, c.y, c.r + 8);
    if (G.col) for (const b of G.col.builds) if (b.done && !BUILDS[b.type].flat) { const B = BUILDS[b.type]; stampRect(b.x - B.w / 2, b.y - B.h / 2, b.x + B.w / 2, b.y + B.h / 2, 6); }
  }
  const cell = (x, y) => { const i = (x / C) | 0, j = (y / C) | 0; return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };
  const free = (x, y) => { const c = cell(x, y); return c >= 0 && !blk[c]; };
  // прямая свободна? (первые/последние 14 px не проверяем — там сам агент и цель у стены)
  function clear(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0); if (d < 30) return true;
    const n = Math.ceil(d / 8);
    for (let k = 1; k < n; k++) { const t = k / n, dd = t * d; if (dd < 14 || d - dd < 14) continue; if (!free(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
    return true;
  }
  function nearFree(c) {
    if (c >= 0 && !blk[c]) return c;
    if (c < 0) return -1;
    const ci = c % NX, cj = (c / NX) | 0;
    for (let r = 1; r <= 4; r++) for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NY) continue; const q = j * NX + i; if (!blk[q]) return q;
    }
    return -1;
  }
  // двоичная куча (узел, приоритет) — приоритет хранится в куче, дубликаты отсеиваются через shut
  const hf = [];
  function push(c, f) {
    let i = heap.length; heap.push(c); hf.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; heap[i] = heap[p]; hf[i] = hf[p]; i = p; }
    heap[i] = c; hf[i] = f;
  }
  function pop() {
    const top = heap[0], last = heap.pop(), lf = hf.pop(), n = heap.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = -1, fm = lf;
        if (l < n && hf[l] < fm) { m = l; fm = hf[l]; }
        if (r < n && hf[r] < fm) m = r;
        if (m < 0) break;
        heap[i] = heap[m]; hf[i] = hf[m]; i = m;
      }
      heap[i] = last; hf[i] = lf;
    }
    return top;
  }
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  function astar(sx, sy, tx, ty) {
    const s = cell(sx, sy), t = nearFree(cell(tx, ty)); if (s < 0 || t < 0) return null;
    gen++; heap.length = 0; hf.length = 0;
    const ti = t % NX, tj = (t / NX) | 0;
    const hh = c => { const dx = Math.abs(c % NX - ti), dy = Math.abs(((c / NX) | 0) - tj); return dx + dy - 0.586 * Math.min(dx, dy); };
    gs[s] = 0; from[s] = -1; seen[s] = gen; push(s, hh(s));
    let exp = 0;
    while (heap.length) {
      const c = pop(); if (shut[c] === gen) continue; shut[c] = gen;
      if (c === t) break;
      if (++exp > MAXEXP) return null;
      const ci = c % NX, cj = (c / NX) | 0;
      for (const [di, dj, w] of DIRS) {
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
        const q = j * NX + i; if (blk[q] || shut[q] === gen) continue;
        if (di && dj && (blk[cj * NX + i] || blk[j * NX + ci])) continue; // не срезать углы
        const ng = gs[c] + w;
        if (seen[q] !== gen || ng < gs[q]) { seen[q] = gen; gs[q] = ng; from[q] = c; push(q, ng + hh(q)); }
      }
    }
    if (shut[t] !== gen) return null;
    const cells = []; for (let c = t; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map(c => ({ x: (c % NX) * C + C / 2, y: ((c / NX) | 0) * C + C / 2 }));
    pts[pts.length - 1] = { x: tx, y: ty };
    // натягиваем нить
    const out = []; let a = { x: sx, y: sy }, i = 0;
    while (i < pts.length - 1) {
      let k = Math.min(pts.length - 1, i + 40);
      while (k > i + 1 && !clear(a.x, a.y, pts[k].x, pts[k].y)) k--;
      out.push(pts[k]); a = pts[k]; i = k;
    }
    if (!out.length) out.push({ x: tx, y: ty });
    return out;
  }
  // следующая точка на пути o → (tx, ty)
  function way(o, tx, ty) {
    if (!G) return { x: tx, y: ty };
    ensure();
    let n = cache.get(o);
    if (n && n.ver === ver && Math.abs(n.tx - tx) < 24 && Math.abs(n.ty - ty) < 24 && G.time < n.until) {
      if (!n.path) return { x: tx, y: ty };
      while (n.i < n.path.length - 1 && (o.x - n.path[n.i].x) ** 2 + (o.y - n.path[n.i].y) ** 2 < 12 * 12) n.i++;
      const q = n.path[n.i];
      return n.i === n.path.length - 1 ? { x: tx, y: ty } : q;
    }
    if (clear(o.x, o.y, tx, ty)) { cache.set(o, { tx, ty, ver, path: null, until: G.time + 0.4 }); return { x: tx, y: ty }; }
    const path = astar(o.x, o.y, tx, ty);
    cache.set(o, { tx, ty, ver, path, i: 0, until: G.time + (path ? 4 : 1.5) });
    return path ? path[0] : { x: tx, y: ty };
  }
  return { way, clear: (a, b, c, d) => { ensure(); return clear(a, b, c, d); }, free: (x, y) => { ensure(); return free(x, y); }, reset() { key = ''; lastG = null; } };
})();

// ---------- эффекты ----------
function toast(txt) { UI.toast(txt); }
function floatText(x, y, text) { G.parts.push({ type: 'text', x, y, vx: 0, vy: -28, life: 1.3, max: 1.3, text }); }
function burst(x, y, n, color, spd = 90) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rnd(20, spd);
    G.parts.push({ type: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rnd(0.4, 0.8), max: 0.8, color, g: 160 });
  }
}
function shake(n) { if (!UI.reduced && Settings.get('shake')) G.shake = Math.max(G.shake || 0, n); }
function corpse(kind, x, y) { ArtWorld.fx.blood(G.parts, x, y, G.decals = G.decals || []); (G.corpses = G.corpses || []).push({ kind, x: Math.round(x), y: Math.round(y), t0: G.time }); if (G.corpses.length > 16) G.corpses.shift(); }
function print(x, y, a, k) { G.prints.push({ x, y, a, k, life: 25 }); if (G.prints.length > 600) G.prints.shift(); }

// ---------- огонь ----------
const fearR = f => f.stack ? 260 : f.tower ? 220 : f.fuel > 10 ? 200 : 110;
function burningFires() {
  const out = [];
  for (const f of G.fires) if (f.fuel > 0) out.push(f);
  for (const s of G.stacks) if (s.lit > 0) out.push({ x: s.x, y: s.y, fuel: s.lit, stack: 1 });
  if (G.col) for (const b of G.col.builds) if (b.done && b.type === 'tower' && b.fuel > 0) out.push({ x: b.x, y: b.y, fuel: b.fuel, tower: 1 });
  return out;
}
function nearFire(r) { for (const f of burningFires()) if (dist2(f, G.p) < r * r) return f; return null; }
function protection() {
  const p = G.p;
  if (p.inside && G.hut.fuel > 0) return { x: HUT.x, y: HUT.y - 30, r: 170 };
  if (p.inside && G.hut.door) return null;
  for (const f of burningFires()) { const r = fearR(f); if (dist2(f, p) < r * r) return { x: f.x, y: f.y, r }; }
  if (p.torch > 0) return { x: p.x, y: p.y, r: 120 };
  return null;
}

// ---------- контекст действия ----------
const nearest = (src, r, f) => nearestIn(src, G.p.x, G.p.y, r, f);
const liveHare = h => G.hares.includes(h); // сетка зайцев обновляется раз в 8 шагов — отсекаем уже пойманных
function context() {
  const p = G.p;
  if (p.sleeping) return null;
  if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < 80 * 80) return { k: 'bear', label: p.torch > 0 ? 'Ткнуть факелом' : 'Ударить', o: G.bear };
  const w = nearest(G.wolves, 58); if (w) return { k: 'wolf', label: 'Ударить', o: w };
  const h = nearest(Space.hares, 50, liveHare); if (h) return { k: 'hare', label: 'Поймать', o: h };
  if (G.urk.state !== 'away' && dist2(G.urk, p) < 70 * 70) return { k: 'urk', label: 'Уркачан' };
  if (G.vera.state !== 'dead' && G.vera.state !== 'follow' && !(p.inside && dist2(SPOT.bed, p) < 48 * 48) && dist2(G.vera, p) < 64 * 64) return { k: 'vera', label: 'Вера' };
  if (!G.labaz && dist2(POI.labaz, p) < 70 * 70) return { k: 'labaz', label: 'Лабаз · :meat:2' };
  const am = G.amuletsAt && G.amuletsAt.find(a => !a.got && dist2(a, p) < 44 * 44); if (am) return { k: 'amulet', label: 'Сэвэки :sevek:', o: am };
  if (G.col) {
    const site = G.col.builds.find(b => !b.done && dist2(b, p) < (BUILDS[b.type].w / 2 + 30) ** 2); if (site) return { k: 'site', label: `Строить ${BUILDS[site.type].i} ${Math.floor(site.prog * 100)}%`, o: site };
    const bl = G.col.builds.find(b => b.done && dist2(b, p) < (BUILDS[b.type].w / 2 + 34) ** 2 && ['market', 'forge'].includes(b.type));
    if (bl) return { k: 'bld', label: bl.type === 'market' ? 'Фактория :market:' : 'Кузня :forge:', o: bl };
  }
  for (const q of INSPECT) if (dist2(q, p) < 50 * 50) return { k: 'inspect', label: 'Осмотреть ' + q.i, o: q };
  const dr = G.deer && nearest(G.deer, 50); if (dr) return { k: 'deer', label: 'Олень :deer:', o: dr };
  for (const id in NOTES) { const n = NOTES[id]; if (dist2(n, p) < 46 * 46 && id !== 'labaz') return { k: 'note', label: G.notes[id] ? 'Перечитать' : 'Прочитать', o: id }; }
  if (p.inside) {
    if (dist2(SPOT.stove, p) < 50 * 50) return { k: 'stove', label: G.hut.fuel > 0 ? 'Подбросить :wood:' : 'Растопить :wood:' };
    if (dist2(SPOT.bench, p) < 52 * 52) return { k: 'bench', label: G.hut.bench ? (G.flags.radioBuilt ? 'Рация / верстак' : 'Верстак') : 'Изба' };
    if (dist2(SPOT.chest, p) < 46 * 46) return { k: 'chest', label: 'Лабаз' };
    if (dist2(SPOT.bed, p) < 48 * 48) return { k: 'bed', label: 'Спать' };
  }
  const tr = nearest(G.traps, 44); if (tr) return { k: 'trap', label: tr.catch ? 'Забрать ' + ITEMS[tr.catch].i : 'Снять ' + ITEMS[tr.kind].i, o: tr };
  const st = nearest(G.stacks, 56);
  if (st) {
    if (st.lit > 0) return null;
    if (st.wood < 4) return { k: 'stack', label: `Куча ${st.wood}/4 · +:wood:`, o: st };
    return { k: 'stack', label: has('kero', false) ? 'Поджечь :kero:' : 'Поджечь', o: st };
  }
  for (const w of ['cockpit', 'tail']) if (G.wreck[w].length && dist2(POI[w], p) < 120 * 120) return { k: 'wreck', label: `Разбирать · ${G.wreck[w].length}`, o: w };
  if (!G.flags.tube && dist2(TUBE_POS, p) < 44 * 44) return { k: 'tube', label: 'Взять :tube:' };
  const t = nearest(Space.trees, 56, t => t.wood > 0 && !t.wall); if (t) return { k: 'tree', label: 'Рубить', o: t };
  if (onIce(p.x, p.y)) {
    const hole = nearest(G.holes, 34);
    if (hole) return { k: 'fish', label: 'Рыбачить', o: hole };
    return { k: 'dig', label: 'Пробить лунку' };
  }
  return null;
}

function interact(silent) {
  if (state !== 'play' || UI.modal()) return;
  const p = G.p;
  if (p.cd > 0 || p.action || p.sleeping) return;
  const c = context();
  if (!c) { if (!silent) toast(':close: Здесь нечего делать'); p.cd = 0.3; return; }
  switch (c.k) {
    case 'wolf': hitWolf(c.o); break;
    case 'bear': hitBear(c.o); break;
    case 'hare': {
      const h = c.o; G.hares.splice(G.hares.indexOf(h), 1);
      add('meat'); add('hare'); G.stats.hares++; xp('hunt'); p.swing = 0.25; p.cd = 0.4;
      floatText(h.x, h.y - 20, '+:meat: +:hare:'); burst(h.x, h.y - 6, 10, '#ffffff'); Sound.pick();
      break;
    }
    case 'urk': if (!silent) UI.dialog(talkUrk()); break;
    case 'vera': if (!silent) UI.dialog(talkVera()); break;
    case 'note': if (!silent) readNote(c.o); break;
    case 'labaz': G.labaz = 1; add('meat', 2); readNote('labaz'); Sound.pick(); break;
    case 'amulet': c.o.got = 1; G.amulets++; toast(`:sevek: Сэвэки ${G.amulets}/12`); Sound.ok2(); burst(c.o.x, c.o.y - 10, 14, '#ffd27a');
      if (G.amulets === 12) { if (G.urk.respect < 3) G.urk.respect++; toast(':sevek: Все духи собраны · :evenk: дед +1'); }
      break;
    case 'site': p.buildT = 0.35; p.buildB = c.o.id; p.cd = 0.25; p.swing = 0.25; if (Math.random() < 0.4) Sound.chop(); break;
    case 'bld': if (!silent) UI.openCraft(c.o.type === 'market' ? 'market' : 'epoch'); break;
    case 'inspect': if (!silent) { toast(c.o.i + ' ' + c.o.t); p.cd = 1; } break;
    case 'deer': if (!silent) { toast(':deer: Олень Уркачана. Не трогай — дед обидится.'); p.cd = 1; } break;
    case 'stove': stoveAdd(); p.cd = 0.3; break;
    case 'bench': if (!silent) UI.openCraft(G.hut.bench ? 'craft' : 'hut'); break;
    case 'chest': if (!silent) UI.openChest(); break;
    case 'bed': if (!silent) trySleep(); break;
    case 'trap': {
      const t = c.o; p.cd = 0.4;
      if (t.catch) {
        if (t.catch === 'hare') { add('meat'); add('hare'); floatText(t.x, t.y - 20, '+:meat: +:hare:'); } else { add(t.catch); floatText(t.x, t.y - 20, '+' + ITEMS[t.catch].i); }
        xp('hunt'); t.catch = null; t.t = G.time; Sound.pick();
      } else { G.traps.splice(G.traps.indexOf(t), 1); add(t.kind); }
      break;
    }
    case 'stack': {
      const s = c.o;
      if (s.wood < 4) { if (!take('wood', 1, false)) { toast(':close: Не хватает: :wood:1'); p.cd = 0.3; } else { s.wood++; p.cd = 0.25; Sound.chop(); } }
      else if (has('kero', false)) { take('kero', 1, false); lightStack(s, 120); }
      else p.action = { k: 'light', t: 0, dur: 1.5, o: s };
      break;
    }
    case 'wreck': p.action = { k: 'wreck', t: 0, dur: 4, o: c.o }; break;
    case 'tube': G.flags.tube = 1; add('tube'); toast(':tube: Радиолампа Гоши'); Sound.ok2(); break;
    case 'tree':
      if (weight() > capKg() + 6) { if (!silent) toast(':pack: Рюкзак полон'); p.cd = 0.5; break; }
      p.action = { k: 'chop', t: 0, dur: chopTime(), o: c.o }; p.face = Math.sign(c.o.x - p.x) || p.face; break;
    case 'fish': p.action = { k: 'fish', ph: 'wait', t: 0, dur: rnd(1.5, 4) - 0.2 * (lvl('fish') - 1), o: c.o }; break;
    case 'dig': p.action = { k: 'dig', t: 0, dur: 4 }; break;
  }
}

function finishAction(a) {
  const p = G.p;
  if (a.k === 'chop') {
    const t = a.o; if (t.wood <= 0) return;
    t.wood--; shakeTree(t, 0.35);
    let n = 1; if (lvl('chop') >= 5 && Math.random() < 0.25) n = 2;
    add('wood', n); G.stats.wood += n; xp('chop'); G.s.food = Math.max(0, G.s.food - 1);
    floatText(t.x, t.y - 50 * t.s, `+${n} :wood:`); ArtWorld.fx.chips(G.parts, t.x, t.y); ArtWorld.fx.snowPuff(G.parts, t.x, t.y - 4); Sound.chop();
    if (t.wood <= 0) Sound.treeCrack();
  } else if (a.k === 'fish') {
    if (a.ph === 'wait') {
      // клюёт! полоса с зелёной зоной — жми E вовремя
      const w = clamp(0.14 + 0.03 * (lvl('fish') - 1) + (G.gear.lure ? 0.06 : 0) + (G.col && G.col.techs.nets ? 0.04 : 0), 0.1, 0.4);
      G.p.action = { k: 'fish', ph: 'bite', t: 0, dur: 2.6, o: a.o, z: rnd(0.1, 0.9 - w), w, sp: rnd(1.3, 2.2) }; Sound.tone('sine', 1200, 1500, 0.08, 0.2);
    } else floatText(a.o.x, a.o.y - 30, 'ушла');
  } else if (a.k === 'dig') {
    G.holes.push({ x: p.x + p.face * 24, y: p.y + 4, fish: 3 }); ArtWorld.fx.splash(G.parts, p.x + p.face * 24, p.y + 4); Sound.hit();
  } else if (a.k === 'wreck') {
    const pool = G.wreck[a.o], id = pool.shift(); if (!id) return;
    if (id === 'saw') { G.gear.saw = 1; toast(':saw: Пила! Рубка быстрее'); }
    else {
      add(id); if (id === 'scrap') G.stats.scrap++;
      if (id === 'quartz') { G.flags.quartz = 1; toast(':quartz: Кварц для рации'); }
      if (id === 'battery') toast(':battery: Аккумулятор. Тяжёлый. Зарядить у печки');
      if (id === 'cable') toast(':cable: Кабель — на антенну');
    }
    floatText(p.x, p.y - 50, '+' + (id === 'saw' ? ':saw:' : ITEMS[id].i)); Sound.hit(); Sound.pick();
  } else if (a.k === 'light') lightStack(a.o, 60);
  else if (a.k === 'place') {
    take(a.o, 1, false); G.traps.push({ x: p.x + p.face * 20, y: p.y + 6, kind: a.o, catch: null, t: G.time });
    toast(a.o === 'trap' ? (inCedar(p.x, p.y) ? ':trap: Капкан в кедраче' : ':trap: Капкан (соболь — только в кедраче)') : ':snare: Силок стоит');
  }
}

function fishStrike() {
  const a = G.p.action; if (!a || a.k !== 'fish' || a.ph !== 'bite') return false;
  const pos = (Math.sin(a.t * a.sp * Math.PI) + 1) / 2, h = a.o; G.p.action = null; G.p.cd = 0.5; xp('fish'); G.s.food = Math.max(0, G.s.food - 0.5);
  if (pos >= a.z - 0.02 && pos <= a.z + a.w + 0.02) {
    let r = Math.random(), f = FISHES[0]; for (const q of FISHES) { if ((r -= q.p) <= 0) { f = q; break; } }
    const kg = rnd(f.w[0], f.w[1]), n = f.big ? 3 : kg > 2 ? 2 : 1;
    add('fish', n); G.stats.fish++; G.stats.bestKg = Math.max(G.stats.bestKg || 0, kg); ArtWorld.fx.splash(G.parts, h.x, h.y);
    floatText(h.x, h.y - 30, `:fish: ${f.n} · ${kg.toFixed(2).replace('.', ',')} кг`); burst(h.x, h.y, 10, '#b9e2ff'); Sound.splash();
    if (f.big) toast(`:fish: Таймень! ${kg.toFixed(1).replace('.', ',')} кг`);
    if (--h.fish <= 0) { G.holes.splice(G.holes.indexOf(h), 1); toast(':fish: Лунка пуста'); }
  } else { floatText(h.x, h.y - 30, 'Сорвалась'); Sound.tone('triangle', 400, 200, 0.2, 0.15); }
  return true;
}
function sniff() {
  if (state !== 'play' || UI.modal() || (G.sniffCd || 0) > 0) return;
  G.sniffCd = 8; G.sniff = { t: 0, hits: [] };
  const add2 = (o, ic) => { const d = dist(o, G.p); if (d < 650) G.sniff.hits.push({ x: o.x, y: o.y, ic, d }); };
  for (const h of G.hares) add2(h, ':hare:');
  for (const a of G.amuletsAt) if (!a.got) add2(a, ':sevek:');
  for (const id in NOTES) if (!G.notes[id]) add2(NOTES[id], ':log:');
  for (const t of G.traps) if (t.catch) add2(t, ':trap:');
  for (const w of G.wolves) add2(w, ':wolf:'); if (G.bear) add2(G.bear, ':bear:');
  if (!G.flags.tube) add2(TUBE_POS, ':tube:');
  for (const k of ['cockpit', 'tail']) if (G.wreck[k].length) add2(POI[k], ':scrap:');
  Sound.tone('sine', 300, 900, 0.5, 0.12);
}
function lightStack(s, sec) { s.lit = sec; s.wood = 0; toast(':fire: Куча горит'); Sound.ok2(); burst(s.x, s.y - 20, 20, '#ffb347', 140); }

function hitWolf(w) {
  const p = G.p, dmg = (p.torch > 0 ? 2 : 1) + 0.5 * (lvl('hunt') - 1);
  w.hp -= dmg; p.swing = 0.25; p.cd = 0.4; p.face = Math.sign(w.x - p.x) || p.face;
  const a = Math.atan2(w.y - p.y, w.x - p.x); w.x += Math.cos(a) * 40; w.y += Math.sin(a) * 40;
  w.st = 'flee'; w.t = 1.2; ArtWorld.fx.blood(G.parts, w.x, w.y, G.decals = G.decals || []); Sound.hit();
  if (G.pack) { if (!w.hurt) { w.hurt = 1; G.pack.hurt++; } if (w.leader) G.pack.leaderHurt += dmg; }
  if (w.leader && G.pack && G.pack.leaderHurt >= 5 && G.urk.wolfQuest) G.flags.leaderDone = 1;
  if (w.hp <= 0) {
    G.wolves.splice(G.wolves.indexOf(w), 1); G.stats.wolves++; xp('hunt', 2); corpse(w.leader ? 'wolfLeader' : 'wolf', w.x, w.y);
    add('wpelt'); add('meat', 2); floatText(w.x, w.y - 30, '+:wolf: +:meat:2'); burst(w.x, w.y - 10, 16, '#7d858f', 140);
    if (G.pack) G.pack.killed++;
    if (w.leader) { G.flags.leaderDone = 1; toast(':wolf: Вожак убит — стая уходит'); retreatAll(); }
  }
}
function hitBear(b) {
  const p = G.p; p.swing = 0.25; p.cd = 0.45;
  if (p.torch > 0 && b.stunCd <= 0) { b.st = 'stun'; b.t = 1; b.stunCd = 4; toast(':fire: Шатун отпрянул'); }
  b.hp -= (p.torch > 0 ? 1.5 : 1) + 0.15 * (lvl('hunt') - 1); burst(b.x, b.y - 20, 10, '#6b4f3a'); // шкура толстая: подранить можно, добить — трудно Sound.hit();
  if (b.hp <= 0) { corpse('bear', b.x, b.y); G.bear = null; G.flags.bearDead = 1; add('meat', 4); xp('hunt', 5); toast(':bear: Шатун повержен'); Sound.ok2(); }
}

function fireKey() {
  if (state !== 'play' || UI.modal() || G.p.sleeping) return;
  const p = G.p;
  if (p.inside) return stoveAdd();
  const f = nearest(G.fires, 70);
  if (f) {
    if (f.fuel > 0) {
      if (!take('wood', 1, false)) return toast(':close: Не хватает: :wood:1');
      f.fuel = Math.min(f.fuel + 25, 160); floatText(f.x, f.y - 40, ':fire: +25 с'); burst(f.x, f.y - 10, 10, '#ffb347', 120);
    } else {
      if (cnt('wood', false) < 2) return toast(':close: Разжечь: :wood:2');
      take('wood', 2, false); f.fuel = 40; toast(':fire: Огонь горит');
    }
    return;
  }
  const s = nearest(G.stacks, 56);
  if (s && s.wood < 4 && !s.lit) { if (take('wood', 1, false)) { s.wood++; Sound.chop(); } else toast(':close: Не хватает: :wood:1'); return; }
  if (cnt('wood', false) < 3) return toast(':close: Костёр: :wood:3');
  const x = clamp(p.x + p.face * 30, 60, W - 60), y = p.y + 8;
  if (onIce(x, y)) return toast(':close: На льду не разжечь');
  if (Math.abs(x - HUT.x) < 130 && Math.abs(y - HUT.y) < 110) return toast(':close: Слишком близко к избе');
  take('wood', 3, false); G.fires.push({ x, y, fuel: 45 }); toast(':fire: Костёр'); Sound.ok2();
}
function stoveAdd() {
  const max = secPerLog() * 8;
  if (G.hut.fuel > max - secPerLog() * 0.5) return toast(':stove: Печь полна');
  if (!take('wood', 1, true)) return toast(':close: Не хватает: :wood:1 (в руках или в лабазе)');
  G.hut.fuel += secPerLog(); G.flags.stoveLit = 1; floatText(SPOT.stove.x, SPOT.stove.y - 30, `:fire: +${secPerLog()} с`); Sound.chop();
}

function eat() {
  if (state !== 'play' || UI.modal() || G.p.sleeping) return;
  if (G.s.food >= 96) return toast(':food: Не голоден');
  const wc = G.p.inside, k = FOOD_ORDER.find(f => cnt(f, wc) > 0);
  if (!k) return toast(':close: Нет еды · :hare: :fish:');
  take(k, 1, wc);
  const it = ITEMS[k], cooked = !it.raw || !!nearFire(140) || (G.p.inside && G.hut.fuel > 0);
  const v = Math.round(it.food * (cooked ? 1 : 0.45));
  G.s.food = Math.min(100, G.s.food + v);
  if (it.warm) G.s.warm = Math.min(maxWarm(), G.s.warm + it.warm);
  floatText(G.p.x, G.p.y - 44, (cooked ? it.i + ' +' : ':frost: сырое +') + v);
}

function placeKey() {
  if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.action) return;
  const p = G.p;
  if (p.inside || onIce(p.x, p.y)) return toast(':close: Здесь не поставить');
  let k = null;
  if (inCedar(p.x, p.y) && has('trap', false)) k = 'trap';
  else if (has('snare', false)) k = 'snare';
  else if (has('trap', false)) k = 'trap';
  if (!k) return toast(':close: Нет :snare: / :trap: · верстак');
  p.action = { k: 'place', t: 0, dur: 2, o: k };
}

function stationOk(at) {
  const p = G.p;
  if (at === 'fire') return !!nearFire(140) || (p.inside && G.hut.fuel > 0);
  if (at === 'stove') return p.inside && G.hut.fuel > 0;
  if (at === 'bench') return p.inside && !!G.hut.bench;
  return true;
}
function recipeState(r) {
  if (r.gear && G.gear[r.gear]) return 'owned';
  if (r.radio && G.flags.radioBuilt) return 'owned';
  if (!stationOk(r.at)) return 'station';
  if (!canPay(r.in, G.p.inside)) return 'cost';
  if (r.radio && G.charge < 100) return 'charge';
  return 'ok';
}
function craft(r) {
  if (recipeState(r) !== 'ok') return false;
  pay(r.in, G.p.inside);
  if (r.out) for (const [k, v] of Object.entries(r.out)) add(k, v);
  if (r.gear) G.gear[r.gear] = 1;
  if (r.id === 'torch') { G.p.torch = 60; toast(':fire: Факел · 60 с'); }
  if (r.id === 'tea') { G.s.warm = Math.min(maxWarm(), G.s.warm + 30); G.p.teaT = 60; toast(':tea: Тепло разливается'); }
  if (r.radio) { G.flags.radioBuilt = 1; toast(':radio: Рация собрана!'); }
  else if (r.gear) toast(`${r.i} ${r.n}`);
  Sound.ok2();
  return true;
}
function hutUpgState(u) {
  if (G.hut[u.id]) return 'owned';
  if (u.id === 'damper' && !G.hut.walls) return 'need';
  if (!nearHut()) return 'station';
  if (!canPay(u.in, true)) return 'cost';
  return 'ok';
}
function buildHut(u) {
  if (hutUpgState(u) !== 'ok') return false;
  pay(u.in, true); G.hut[u.id] = 1; if (u.id === 'door') G.hut.doorHp = 100;
  toast(`${u.i} ${u.n} :ok:`); Sound.ok2(); return true;
}
const price = t => Math.max(1, Math.round(t.p * (1.2 - 0.1 * G.urk.respect)));
const furTotal = () => FUR_PAY.reduce((s, k) => s + cnt(k, false) * ITEMS[k].fur, 0);
function buy(t) {
  const pr = price(t);
  if (G.urk.stock[t.id] <= 0 || (t.gear && G.gear[t.gear]) || furTotal() < pr) return false;
  let left = pr;
  for (const k of FUR_PAY) while (left > 0 && cnt(k, false) > 0) { take(k, 1, false); left -= ITEMS[k].fur; }
  G.urk.stock[t.id]--;
  if (t.out) for (const [k, v] of Object.entries(t.out)) add(k, v);
  if (t.gear) G.gear[t.gear] = 1;
  if (t.id === 'tube') G.flags.tube = 1;
  toast(`${t.i} ${t.n}`); Sound.ok2(); return true;
}

function readNote(id) { G.notes[id] = 1; UI.note(NOTES[id]); if (id === 'pilot') { G.known.tail = 1; G.known.polynya = 1; } }
function trySleep() {
  const h = hourOf();
  if (!(h >= 19 || h < 6)) return toast(':sleep: Спать — после 19:00');
  if (G.hut.fuel <= 0) return toast(':close: Сначала растопи печь');
  if (G.wolves.some(w => insideHut(w.x, w.y))) return toast(':wolf: Волк в избе — не до сна!');
  if (!G.hut.door && G.wolves.some(w => w.st !== 'retreat' && dist2(w, HUT) < 380 * 380)) return toast(':wolf: Волки у избы — без двери не уснуть');
  if (G.bear && G.bear.st !== 'flee' && dist2(G.bear, HUT) < 450 * 450) return toast(':bear: Шатун рядом — не уснуть');
  G.p.sleeping = true; G.p.action = null; G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y + 4;
}
function wake(good, msg) {
  G.p.sleeping = false;
  if (good) {
    G.flags.slept = 1; if (G.s.frost > 0) G.s.frost--;
    toast(':day: Утро · сохранено'); saveCheckpoint();
  } else toast(msg);
}
function radioSession() {
  if (!G.flags.radioBuilt) return;
  if (G.flags.contact) return UI.dialog({ who: 'radio', t: '…борт 24713, ждите в 09:00, дайте дым на мари… Приём.', opts: [{ t: 'Понял' }] });
  const h = hourOf();
  if (stormOn()) return UI.dialog({ who: 'radio', t: '…ш-ш-ш… тр-р… (пурга глушит эфир — попробуй, когда стихнет)', opts: [{ t: 'Выключить' }] });
  const sess = (h >= 7.5 && h < 9) || (h >= 19.5 && h < 21);
  // до конца осады эфир забит: борт не слышит (глава III закрывается осадой)
  if (sess && G.chapter < 3) { UI.dialog({ who: 'radio', t: RADIO_LINES[(Math.random() * RADIO_LINES.length) | 0], opts: [{ t: 'Выключить' }] }); toast(':radio: Борт не слышит · сначала отбейся от стаи'); return; }
  if (sess) {
    G.flags.contact = 1; G.flags.contactDay = G.day + (h >= 19 ? 0 : -1); G.flags.contactT = G.time; G.known.mar = 1; UI.dialog(DIALOG.radio_ok); Sound.ok2();
    setTimeout(() => toast(padDone() ? ':pad: Площадка готова · борт через сутки в 09:00' : ':pad: Сядут только на расчищенную марь · :build: Площадка'), 1800);
  }
  else UI.dialog({ who: 'radio', t: Math.random() < 0.6 ? RADIO_LINES[(Math.random() * RADIO_LINES.length) | 0] : DIALOG.radio_noise.t, opts: [{ t: 'Выключить' }] });
}

// ---------- диалоги ----------
function talkUrk() {
  const u = G.urk, f = G.flags;
  if (!f.metUrk) return DIALOG.urk_meet;
  if (!f.urkPelts) return { who: 'urk', t: 'Две заячьи шкурки принёс?', opts: [cnt('hare', false) >= 2 ? { t: 'Отдать :hare:×2', next: 'urk_pelts' } : { t: 'Пока нет' }] };
  if (G.flags.rescueReady) return DIALOG.urk_bye;
  if (f.leaderDone && u.wolfQuest && !f.wolfThanked) return DIALOG.urk_wolf_done;
  if (G.chapter >= 2 && !u.wolfQuest && !f.wolfAsked) return DIALOG.urk_wolf;
  if (G.chapter >= 3 && !f.bearWarned) { f.bearWarned = 1; return DIALOG.urk_bear; }
  const opts = [{ t: ':trade: Меняться', trade: 1 }];
  if (colonyReady() && !f.rescued) opts.push({ t: ':epoch: Остаёмся зимовать', next: 'col_choice' });
  if (u.giftDay !== G.day && FOOD_ORDER.some(k => cnt(k, false) > 0)) opts.push({ t: ':trade: Подарить еду', gift: 1 });
  opts.push({ t: 'Пока' });
  const lines = IDLE.urk.filter(([c]) => c(G)).map(([, t]) => t).concat(URK_TIPS);
  return { who: 'urk', t: lines[(Math.random() * lines.length) | 0], opts };
}
function giftUrk() {
  const k = FOOD_ORDER.find(f => cnt(f, false) > 0); if (!k) return;
  take(k, 1, false); G.urk.giftDay = G.day; if (G.urk.respect < 3) G.urk.respect++;
  toast(':evenk: Уважение деда ' + G.urk.respect + '/3');
}
function talkVera() {
  const v = G.vera, f = G.flags;
  if (v.state === 'tail') return DIALOG.vera_found;
  if (v.state === 'follow') return DIALOG.vera_wait;
  let node = { t: (IDLE.vera.find(([c]) => c(G)) || [0, DIALOG.vera_urk.t])[1] };
  if (Math.random() < 0.3) node = DIALOG.vera_urk;
  if (v.food <= 0) node = DIALOG.vera_hungry;
  else if (!f.quartz) node = DIALOG.vera_quartz;
  else if (G.chapter >= 2 && G.charge < 100 && !f.radioBuilt) node = DIALOG.vera_batt;
  else if (G.chapter >= 2 && !f.tube) { node = DIALOG.vera_tube; G.known.polynya = 1; }
  else if (f.radioBuilt && !f.contact) node = DIALOG.vera_radio;
  else if (f.contact) { node = DIALOG.vera_mar; G.known.mar = 1; }
  const opts = [];
  if (v.food < 2 && FOOD_ORDER.some(k => cnt(k, G.p.inside) > 0)) opts.push({ t: ':food: Накормить', feed: 1 });
  opts.push({ t: 'Пока' });
  return { who: 'vera', t: node.t, opts };
}
function feedVera() {
  const k = FOOD_ORDER.find(f => cnt(f, G.p.inside) > 0); if (!k) return;
  take(k, 1, G.p.inside); G.vera.food = Math.min(2, G.vera.food + 1); UI.dialog(DIALOG.vera_fed);
}
function dialogAct(act) {
  const f = G.flags;
  if (act === 'metUrk') { f.metUrk = 1; G.urk.state = 'walk'; G.known.chum = 1; G.known.cedar = 1; }
  if (act === 'urkPelts') { take('hare', 2, false); f.urkPelts = 1; G.urk.respect++; if (!G.col.units.some(u => u.pet)) { const d = Colony.spawn('laika', { pet: 1, x: G.urk.x, y: G.urk.y + 20 }); d.task = { k: 'guard' }; setTimeout(() => toast(':dog: Дед отдал лайку Пургу — чует волков'), 1500); } }
  if (act === 'wolfQuest') { G.urk.wolfQuest = 1; f.wolfAsked = 1; }
  if (act === 'wolfNo') f.wolfAsked = 1;
  if (act === 'wolfDone') { f.wolfThanked = 1; if (G.urk.respect < 3) G.urk.respect++; }
  if (act === 'veraFollow') { f.veraFound = 1; G.vera.state = 'follow'; }
  if (act === 'stayD') f.stayD = 1;
}

// ---------- сохранение ----------
// Формат v4 («Сибирь 2.0»): seed + версия генератора + изменения. Статичный мир (лес, стена, сугробы,
// трещины, кочки, места оберегов) пересчитывается из seed и не хранится. Хранятся:
//  treeD — изменённые деревья [индекс, дрова(, дрожь)]; fogB — туман 2 бита на клетку (base64);
//  live — зайцы/вороны/олени компактно (числа до 0,01); amGot — индексы собранных оберегов;
//  всё остальное состояние G как есть. Ссылки на общие объекты (дерево в задаче человека, лунка
//  в действии героя) пишутся как {$ref:[список, индекс]} и восстанавливаются при загрузке.
// Версии: 2 — ключ sibir2-save; 3 — ячейки, весь G; 4 — дельта. Сейвы < 4 не читаются (мир другой).
const SAVE_V = 4;
const SAVE_SKIP = new Set(['trees', 'drifts', 'cracks', 'tussocks', 'prints', 'parts', 'fog', 'hares', 'ravens', 'deer', 'amuletsAt']);
const LIVE = ['hares', 'ravens', 'deer'];
const REF_LISTS = ['holes', 'stacks', 'traps', 'fires'];
const q2 = v => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
// список однотипных объектов → {k: ключи, v: [[значения]]}; числа округляются прямо в G (сохранение = состояние)
function packList(arr) {
  const keys = []; for (const o of arr) for (const k in o) if (!keys.includes(k)) keys.push(k);
  return { k: keys, v: arr.map(o => keys.map(k => { if (!(k in o)) return null; const v = q2(o[k]); o[k] = v; return v; })) };
}
function unpackList(p) { return p ? p.v.map(row => { const o = {}; p.k.forEach((k, i) => { if (row[i] !== null) o[k] = row[i]; }); return o; }) : []; }
function packFog(f) {
  let bin = ''; for (let i = 0; i < f.length; i += 4) bin += String.fromCharCode((f[i] & 3) | ((f[i + 1] & 3) << 2) | ((f[i + 2] & 3) << 4) | ((f[i + 3] & 3) << 6));
  return btoa(bin);
}
function unpackFog(b64) {
  const f = new Array(FOG.nx * FOG.ny).fill(0); if (!b64) return f;
  const bin = atob(b64);
  for (let i = 0; i < f.length; i++) f[i] = (bin.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3;
  return f;
}
function snapshot() {
  const refs = new Map();
  for (const k of REF_LISTS) (G[k] || []).forEach((o, i) => refs.set(o, [k, i, G[k]]));
  const o = { _v: SAVE_V, gen: GEN_V, W, H };
  for (const k of Object.keys(G).sort()) if (!SAVE_SKIP.has(k)) o[k] = G[k];
  o.treeD = [];
  G.trees.forEach((t, i) => { if (t.wood !== wood0(t) || t.shake > 0) o.treeD.push(t.shake > 0 ? [i, t.wood, t.shake] : [i, t.wood]); });
  o.fogB = packFog(G.fog);
  o.live = {}; for (const k of LIVE) o.live[k] = packList(G[k] || []);
  o.amGot = []; (G.amuletsAt || []).forEach((a, i) => { if (a.got) o.amGot.push(i); });
  return JSON.stringify(o, function (key, v) {
    if (v && typeof v === 'object') {
      if (TREE_I.has(v)) return { $ref: ['trees', TREE_I.get(v)] };
      const r = refs.get(v); if (r && this !== r[2]) return { $ref: [r[0], r[1]] };
    }
    return v;
  });
}
// чекпоинт (сон, новая глава) = автосохранение в ячейку «Авто»
function saveCheckpoint() {
  checkpoint = snapshot();
  if (typeof Saves !== 'undefined') Saves.write('auto', checkpoint);
}
// почему сейв не подходит к этой игре (null — подходит)
function saveProblem(g) {
  const v = g._v || 2;
  if (v > SAVE_V) return `из новой версии игры (v${v})`;
  if (v < SAVE_V) return `старое сохранение (v${v}) — мир «Сибири 2.0» другой, начните заново`;
  if (g.W !== W || g.H !== H) return `мир другого размера (${g.W}×${g.H})`;
  if (g.gen !== GEN_V) return `другая версия генератора мира (${g.gen})`;
  return null;
}
function loadSave(json) {
  const g = typeof json === 'string' ? JSON.parse(json) : json;
  const bad = saveProblem(g); if (bad) throw new Error(bad);
  const { _v, gen, W: _w, H: _h, treeD, fogB, live, amGot, ...rest } = g;
  G = Object.assign(rest, { trees: [], drifts: [], cracks: [], tussocks: [], prints: [], parts: [] });
  const r = mulberry(G.seed);
  genWorld(r); genLiving(r);
  for (const [i, w, sh] of treeD || []) { const t = G.trees[i]; if (t) { t.wood = w; if (sh) t.shake = sh; } }
  G.fog = unpackFog(fogB);
  for (const k of LIVE) G[k] = unpackList(live && live[k]);
  for (const i of amGot || []) if (G.amuletsAt[i]) G.amuletsAt[i].got = 1;
  // ссылки → объекты
  (function fix(o) {
    for (const k in o) {
      const v = o[k];
      if (!v || typeof v !== 'object') continue;
      if (v.$ref) { const [list, i] = v.$ref; o[k] = G[list] ? G[list][i] || null : null; continue; }
      if (o === G && (k === 'trees' || SAVE_SKIP.has(k))) continue;
      fix(v);
    }
  })(G);
  buildGrid(); GFX.reset(); Nav.reset();
  if (!G.col) { const a = G.amulets; Colony.init(); G.amulets = a || 0; }
  G.col.ghost = null;
}

// ---------- главный апдейт ----------
function update(dt) {
  const p = G.p, s = G.s;
  frameNo++; lodTick(dt);
  G.time += dt;
  const h = hourOf(), d = daylight(h), night = 1 - d, storm = stormOn();
  const day = dayOf();
  if (day !== G.day) { G.day = day; onNewDay(); if (state !== 'play') return; }
  if (h >= 7 && h < 12 && G.lastDawn !== G.day) { G.lastDawn = G.day; onDawn(); }
  p.inside = insideHut(p.x, p.y);

  // сон
  if (p.sleeping) {
    if (h >= 7 && h < 12) wake(true);
    else if (G.hut.fuel <= 0) wake(false, ':frost: Печь погасла');
    else if (G.wolves.some(w => insideHut(w.x, w.y))) wake(false, ':wolf: Волк в избе!');
  }

  // движение
  if (!p.sleeping) {
    let mx = input.mx, my = input.my;
    const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    p.moving = len > 0.15;
    if (!p.moving && onIce(p.x, p.y) && Math.hypot(p.vx || 0, p.vy || 0) > 8) { p.vx *= 1 - Math.min(1, dt * 2.2); p.vy *= 1 - Math.min(1, dt * 2.2); p.x += p.vx * dt; p.y += p.vy * dt; }
    else if (!p.moving) { p.vx = p.vy = 0; }
    if (p.moving) {
      if (p.action) p.action = null;
      let sp = speed();
      const k = onIce(p.x, p.y) ? 2.2 : 14;
      p.vx = (p.vx || 0) + (mx * sp - (p.vx || 0)) * Math.min(1, dt * k); p.vy = (p.vy || 0) + (my * sp - (p.vy || 0)) * Math.min(1, dt * k);
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (storm && !p.inside) { p.x += 25 * dt; }
      if (Math.abs(mx) > 0.1) p.face = Math.sign(mx);
      p.step += dt * 12;
    }
    solid(p, 10, 'p');
    if (Math.hypot(p.x - p.lx, p.y - p.ly) > 20) {
      const a = Math.atan2(p.y - p.ly, p.x - p.lx);
      if (!p.inside && Math.random() < 0.25) ArtWorld.fx.snowPuff(G.parts, p.x, p.y, 0.3);
      if (!p.inside) print(p.x + Math.cos(a + 1.57) * (G.prints.length % 2 ? 4 : -4), p.y + Math.sin(a + 1.57) * (G.prints.length % 2 ? 4 : -4), a, 'p');
      p.lx = p.x; p.ly = p.y;
    }
    // нарты тянутся следом
    const sdx = p.x - p.sx, sdy = p.y - p.sy, sd = Math.hypot(sdx, sdy);
    if (sd > 34) { p.sx = p.x - sdx / sd * 34; p.sy = p.y - sdy / sd * 34; }
  } else p.moving = false;
  p.inside = insideHut(p.x, p.y);
  for (const f of G.prints) f.life -= dt * (storm ? 4 : 1);
  while (G.prints.length && G.prints[0].life <= 0) G.prints.shift();

  // перегруз: один раз при переходе через предел
  const over = weight() > capKg();
  if (over && !p.overW) toast(`:weight: Перегруз ${weight()}/${capKg()} кг — медленно · сложи в лабаз`);
  p.overW = over;

  // действия
  p.cd = Math.max(0, p.cd - dt); p.swing = Math.max(0, p.swing - dt); p.iT = Math.max(0, (p.iT || 0) - dt);
  G.sniffCd = Math.max(0, (G.sniffCd || 0) - dt); if (G.sniff) { G.sniff.t += dt; if (G.sniff.t > 5) G.sniff = null; }
  p.torch = Math.max(0, p.torch - dt); p.teaT = Math.max(0, p.teaT - dt); p.wetT = Math.max(0, p.wetT - dt);
  if (p.action) {
    p.action.t += dt;
    if (p.action.t >= p.action.dur) { const a = p.action; p.action = null; finishAction(a); }
  }
  if (p.action && p.action.k === 'fish' && p.action.ph === 'bite' && p.action.t >= p.action.dur) { floatText(p.action.o.x, p.action.o.y - 30, 'ушла'); p.action = null; }
  if (input.act && !p.action && p.cd <= 0) interact(true);

  // огонь и печь
  for (const f of G.fires) if (f.fuel > 0) {
    f.fuel = Math.max(0, f.fuel - dt * (storm ? 1.6 : 1) * (1 + 0.5 * night));
    if (Math.random() < dt * 7) G.parts.push({ type: 'spark', x: f.x + rnd(-6, 6), y: f.y - 14, vx: rnd(-15, 15) + (storm ? 70 : 0), vy: rnd(-80, -40), life: rnd(0.5, 1), max: 1, g: -10 });
    if (Math.random() < dt * 3) G.parts.push({ type: 'smoke', x: f.x, y: f.y - 24, vx: rnd(-6, 6) + (storm ? 80 : 12), vy: rnd(-30, -18), life: 2.5, max: 2.5 });
  }
  for (const st of G.stacks) if (st.lit > 0) {
    st.lit = Math.max(0, st.lit - dt);
    if (Math.random() < dt * 14) G.parts.push({ type: 'spark', x: st.x + rnd(-12, 12), y: st.y - 24, vx: rnd(-20, 20), vy: rnd(-120, -60), life: rnd(0.6, 1.2), max: 1.2, g: -10 });
    if (Math.random() < dt * 8) G.parts.push({ type: 'smoke', x: st.x, y: st.y - 40, vx: rnd(-8, 8) + (storm ? 80 : 15), vy: rnd(-45, -25), life: 3.5, max: 3.5, big: 1 });
  }
  if (G.hut.fuel > 0) {
    G.hut.fuel = Math.max(0, G.hut.fuel - dt * (storm && !G.hut.walls ? 1.3 : 1) * (1 + 0.3 * night));
    if (Math.random() < dt * 3) G.parts.push({ type: 'smoke', x: HUT.x - 70 + rnd(-2, 2), y: HUT.y - 150, vx: rnd(-5, 5) + (storm ? 90 : 14), vy: rnd(-30, -20), life: 3, max: 3 });
    const battHere = p.inside ? cnt('battery', true) > 0 : (G.chest.battery || 0) > 0;
    if (battHere && G.charge < 100 && !G.flags.radioBuilt) {
      G.charge = Math.min(100, G.charge + dt * 100 / 60);
      if (G.charge >= 100) toast(':battery: Аккумулятор заряжен');
    }
  }

  // тело
  let T = temperature(), heat = 0;
  // изба держит тепло, пока горит печь; холодная изба — почти улица
  if (p.inside) { if (G.hut.fuel > 0) { T += G.hut.walls ? 25 : 15; heat = G.hut.damper ? 14 : G.hut.walls ? 12 : 8; } else T += G.hut.walls ? 10 : 5; }
  for (const f of burningFires()) {
    const r = f.stack ? 200 : 140, dd = dist(f, p);
    if (dd < r) heat = Math.max(heat, 3 + 10 * (1 - dd / r));
  }
  let loss = (0.3 + Math.max(0, -T - 10) * 0.035) * clothMul() * (1 - 0.05 * (lvl('cold') - 1)) * Settings.diff().cold;
  if (!p.inside) loss *= 1 + 0.7 * night; // ночной мороз
  if (p.moving) loss *= 0.85; if (onIce(p.x, p.y)) loss *= 1.3; if (p.wetT > 0) loss *= 2; if (p.teaT > 0) loss *= 0.7;
  s.warm = clamp(s.warm + (heat - loss) * dt, 0, maxWarm());
  if (s.warm < 10) { G.frostAcc += dt; if (G.frostAcc > 20 && s.frost < 3) { G.frostAcc = 0; s.frost++; toast(':frost: Обморожение · макс. тепло −10'); } } else G.frostAcc = 0;
  if (s.warm < 50 && heat === 0 && !p.inside) { G.coldAcc += dt; if (G.coldAcc > 10) { G.coldAcc = 0; xp('cold'); } }
  const hunger = (p.sleeping ? 0.15 : (0.35 + (p.moving ? 0.1 : 0)) * (T < -45 ? 1.2 : 1)) * Settings.diff().hunger;
  s.food = clamp(s.food - hunger * dt, 0, 100);
  if (s.warm <= 0) { s.hp -= 2.5 * dt; G.cause = 'cold'; }
  if (s.food <= 0) { s.hp -= 1.2 * dt; if (s.warm > 0) G.cause = 'food'; }
  if (s.warm > 40 && s.food > 30) s.hp = Math.min(100, s.hp + 0.25 * dt);
  G.hurt = Math.max(0, (G.hurt || 0) - dt * 2); G.shake = Math.max(0, (G.shake || 0) - dt * 30);

  // дыхание на морозе
  if (!p.inside && T < -10) { p.br += dt; if (p.br > (p.moving ? 0.9 : 1.6)) { p.br = 0; breath(p.x + p.face * 6, p.y - 34, p.face, T); } }

  updateHares(dt);
  story(dt, h, night);
  director(dt, night, storm);
  updateWolves(dt, night);
  updateBear(dt, h, night);
  updateNPC(dt);
  Colony.update(dt, h, storm);
  updateLiving(dt);

  // частицы
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i]; q.life -= dt;
    if (q.life <= 0) { G.parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; if (q.g) q.vy += q.g * dt;
  }
  for (const t of SHAKING) { t.shake -= dt; if (t.shake <= 0) { t.shake = 0; SHAKING.delete(t); } }
  if (G.parts.length > 700) G.parts.splice(0, G.parts.length - 700);
  if (G.decals) { for (const d of G.decals) d.life -= dt; G.decals = G.decals.filter(d => d.life > 0).slice(-40); }

  // туман войны
  G.fogT = (G.fogT || 0) - dt;
  if (G.fogT <= 0) { G.fogT = 0.25; reveal(); }

  if (s.hp <= 0) die(G.cause || 'cold');
}

function updateLiving(dt0) {
  const p = G.p;
  for (let i = 0; i < G.ravens.length; i++) {
    const rv = G.ravens[i], dt = lodDt(rv, dt0, i); if (!dt) continue;
    if (!rv.fly) {
      if (dist2(rv, p) < 130 * 130 || G.wolves.some(w => dist2(w, rv) < 100 * 100)) {
        rv.fly = 1; const a = Math.atan2(rv.y - p.y, rv.x - p.x) + rnd(-0.6, 0.6); rv.vx = Math.cos(a) * 180; rv.vy = Math.sin(a) * 120; rv.t = rnd(20, 40);
        if (Math.random() < 0.5) Sound.tone('sawtooth', 700, 500, 0.15, 0.06);
      }
    } else { rv.x += rv.vx * dt; rv.y += rv.vy * dt; rv.z += 60 * dt; rv.t -= dt; if (rv.t <= 0) perchRaven(rv); }
  }
  for (let i = 0; i < G.deer.length; i++) {
    const d = G.deer[i], dt = lodDt(d, dt0, i); if (!dt) continue;
    d.t -= dt; const dp = dist(d, p);
    if (dp < 140) { const a = Math.atan2(d.y - p.y, d.x - p.x); d.vx = Math.cos(a) * 150; d.vy = Math.sin(a) * 150; d.t = 1; }
    else if (d.t <= 0) { d.t = rnd(2, 5); if (Math.random() < 0.6 || Math.hypot(d.x - POI.chum.x - 200, d.y - POI.chum.y) > 280) { const a = Math.atan2(POI.chum.y + 40 - d.y, POI.chum.x + 200 - d.x) + rnd(-1.2, 1.2); d.vx = Math.cos(a) * 30; d.vy = Math.sin(a) * 30; } else d.vx = d.vy = 0; }
    d.x = clamp(d.x + d.vx * dt, 60, W - 60); d.y = clamp(d.y + d.vy * dt, 60, H - 60);
    if (Math.abs(d.vx) > 2) d.face = Math.sign(d.vx);
  }
}
function breath(x, y, face, T) {
  for (let i = 0, n = T < -35 ? 4 : 3; i < n; i++)
    G.parts.push({ type: 'breath', x: x + i * face * 2, y, vx: face * rnd(10, 22) + (stormOn() ? 60 : 4), vy: rnd(-8, -3), life: 1.1, max: 1.1 });
}

function reveal() {
  const p = G.p, r = daylight() > 0.5 ? 380 : 220, c = FOG.cell;
  const c0 = Math.max(0, ((p.x - r) / c) | 0), c1 = Math.min(FOG.nx - 1, ((p.x + r) / c) | 0);
  const r0 = Math.max(0, ((p.y - r) / c) | 0), r1 = Math.min(FOG.ny - 1, ((p.y + r) / c) | 0);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++)
    if ((i * c + c / 2 - p.x) ** 2 + (j * c + c / 2 - p.y) ** 2 < r * r && !G.fog[j * FOG.nx + i]) G.fog[j * FOG.nx + i] = 1;
  for (const k in POI) if (!G.known[k] && Math.hypot(POI[k].x - p.x, POI[k].y - p.y) < POI[k].r + 160) {
    G.known[k] = 1; UI.zone(POI[k]);
  }
}

function onNewDay() {
  Colony.newDay();
  if (G.day >= 8 && !G.flags.rescued) return endGame(noHeliEnd());
  const ch = CH_T[G.chapter];
  if (ch.storm && Math.random() < 0.75) {
    const a = tAt(G.day, rnd(10, 15)); G.storm = { a, b: a + ch.storm * rnd(0.9, 1.3), omen: 0 };
  }
  G.aurora = Math.random() < 0.65 ? rnd(0.5, 1) : 0;
}
// без вертолёта: посёлок (эпоха III, 6 человек) — концовка D, иначе C
const colonyReady = () => !!(G.col && G.col.ep >= D_EP && Colony.pop() >= D_POP);
const noHeliEnd = () => colonyReady() ? 'D' : 'C';
// вторая ветка: посёлок готов зимовать — можно остаться, не дожидаясь вертолёта
DIALOG.col_choice = { who: 'urk', t: 'Посёлок стоит: дым, люди, лайки. Зиму переживёт. Останешься — вертолёт не жди. Или жди, твоё дело.',
  opts: [{ t: ':epoch: Остаться в посёлке', next: 'col_stay' }, { t: ':heli: Ждать вертолёт', next: 'col_wait' }] };
DIALOG.col_stay = { who: 'urk', t: 'Правильно. Тайга своих не бросает.', act: 'stayD', opts: [{ t: 'Остаёмся' }] };
DIALOG.col_wait = { who: 'urk', t: 'Жди. Надумаешь — скажи, я у чума.', opts: [{ t: 'Жду' }] };
function onDawn() {
  for (const t of G.traps) if (!t.catch && G.time - t.t > 30) {
    const r = Math.random();
    if (t.kind === 'trap' && inCedar(t.x, t.y)) t.catch = r < 0.35 ? 'sable' : r < 0.45 ? 'wpelt' : null;
    else t.catch = r < (t.kind === 'trap' ? 0.3 : 0.4) ? 'hare' : null;
  }
  if (G.traps.some(t => t.catch)) toast(':trap: В ловушках добыча');
  const v = G.vera;
  if (v.state === 'follow' || v.state === 'hut') {
    v.food--;
    if (v.food < 0) { v.state = 'dead'; G.flags.veraDead = 1; toast(':hp: Вера не проснулась'); }
    else if (v.food === 0) toast(':person: Вера голодна');
  }
  G.fires = G.fires.filter(f => f.fuel > 0 || dist2(f, G.p) < RADII.fireKeep * RADII.fireKeep);
}

// ---------- сюжет ----------
function story(dt, h, night) {
  const f = G.flags, p = G.p, fired = G.fired;
  if (!f.hutFound && (p.inside || dist2(p, HUT) < 170 * 170)) { f.hutFound = 1; G.known.hut = 1; }
  if (!fired.E1 && G.day === 1 && night > 0.6) { fired.E1 = 1; toast(':wolf: Далеко воют. Много.'); Sound.howl(-0.6, 0.12); }
  if (!fired.E2 && G.day >= 2 && h >= 7 && G.urk.state === 'away') {
    fired.E2 = 1; G.urk.state = 'hut'; G.urk.x = SPOT.urkDoor.x; G.urk.y = SPOT.urkDoor.y;
    toast(':storm: У зимовья кто-то есть');
  }
  // Вера
  const v = G.vera;
  if (v.state === 'tail' && dist2(v, p) < 130 * 130 && !fired.E3 && !UI.modal()) { fired.E3 = 1; UI.dialog(DIALOG.vera_found); }
  // тонкий лёд
  if (onThinIce(p)) {
    p.iceT += dt;
    if (p.iceT > 1.5 && !p.creaked) { p.creaked = 1; Sound.creak(); shake(3); toast(':frost: Лёд трещит!'); }
    if (p.iceT > 3) {
      p.iceT = 0; p.creaked = 0; G.s.warm = Math.min(G.s.warm, 10); p.wetT = 30; p.action = null;
      p.x = POI.polynya.x - 140; Sound.splash(); shake(10); toast(':frost: Провалился! Сушись у огня');
      burst(POI.polynya.x, POI.polynya.y, 20, '#9fd0ee', 160);
    }
  } else { p.iceT = Math.max(0, p.iceT - dt * 2); if (p.iceT === 0) p.creaked = 0; }
  // осада
  if (!fired.E5 && (G.day === 3 || (G.day > 3 && G.chapter === 2)) && h >= 21) {
    fired.E5 = 1; toast(':wolf: Стая идёт к зимовью!'); if (DIALOG.siege_urk) UI.dialog(DIALOG.siege_urk); Sound.howl(0, 0.25);
    spawnPack(4, true); G.pack.siege = 1;
  }
  if (fired.E5 && !f.siegeDone && (!G.pack || !G.pack.siege || (G.day >= 4 && h >= 7))) {
    f.siegeDone = 1; toast(':wolf: Стая отступила · осада снята');
  }
  // медведь: предвестник
  if (G.chapter >= 3 && !fired.E6) {
    fired.E6 = 1; toast(':paw: Следы. Большие.');
    for (let i = 0; i < 16; i++) print(POI.mar.x - 250 + i * 30, POI.mar.y + 180 + Math.sin(i) * 20, 0, 'b');
  }
  // вертолёт
  if (f.contact && !f.rescued) {
    // борт вылетает в 09:00, но не раньше чем через 20 ч после связи (утро → завтра, вечер → послезавтра)
    const waitT = f.contactT != null ? G.time - f.contactT >= CYCLE * 20 / 24 : G.day > f.contactDay;
    if (!G.heli && waitT && h >= 9 && h < 12 && G.heliDay !== G.day) {
      G.heli = { t: 60, snd: 0 }; G.heliDay = G.day; G.known.mar = 1;
      toast(padDone() ? ':heli: Гул винтов! Зажги три кучи на мари!' : ':heli: Гул винтов! Площадки нет — сесть не на что…'); if (DIALOG.heli_hum) UI.dialog(DIALOG.heli_hum);
    }
    if (G.heli) {
      G.heli.t -= dt; G.heli.snd -= dt;
      if (G.heli.snd <= 0) { G.heli.snd = 2.2; Sound.heli(); }
      if (G.stacks.every(s => s.lit > 0) && padDone()) {
        f.rescued = 1; G.heli = null; G.rescueT = 5; f.rescueReady = 1; toast(':heli: Заметили! Садится!'); Sound.ok2(); UI.card(':heli:', 'Борт 24713 — домой', 'Заметили! Садится на марь.'); G.aurora = 1;
      } else if (G.heli.t <= 0) {
        G.heli = null; f.heliMiss = 1;
        if (G.day >= 7) return endGame(noHeliEnd());
        toast(padDone() ? ':heli: Не заметили… Завтра в 09:00' : ':heli: Покружил и ушёл — сесть негде. Завтра в 09:00 · :pad:');
      }
    }
  }
  // концовка D по выбору: посёлок готов — предложить остаться (один раз сам, дальше — через деда)
  if (colonyReady() && !f.rescued && !f.dOffered && !UI.modal() && !p.sleeping) { f.dOffered = 1; UI.dialog(DIALOG.col_choice); }
  if (f.stayD && !UI.modal()) return endGame('D');
  if (G.rescueT > 0) {
    G.rescueT -= dt;
    if (G.rescueT <= 0) return endGame(!f.veraDead && G.vera.state !== 'tail' && G.urk.respect >= 2 ? 'A' : 'B');
  }
  // главы
  const ch = CHAPTERS[G.chapter];
  if (ch && G.chapter < 3 && ch.goals.every(g => g.alt || g.ok(G))) {
    G.chapter++; UI.chapter(G.chapter);
    if (G.chapter === 1) G.known.tail = 1;
    if (G.chapter === 2) { G.known.polynya = 1; }
    if (G.chapter === 3) { G.known.mar = 1; }
    saveCheckpoint();
  }
  // пурга: предвестник
  if (G.storm && !G.storm.omen && G.time > G.storm.a - 40 && G.time < G.storm.a) { G.storm.omen = 1; toast(':storm: Небо сереет — идёт пурга'); }
  if (stormOn() && !G.storm.said) { G.storm.said = 1; toast(':storm: Пурга!'); if (G.pack) retreatAll(); }
}

function updateNPC(dt) {
  const u = G.urk, p = G.p;
  if (u.state === 'walk') {
    const tx = POI.chum.x - 40, ty = POI.chum.y + 70, dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d < 8) u.state = 'chum'; else { u.x += dx / d * 80 * dt; u.y += dy / d * 80 * dt; u.face = Math.sign(dx) || u.face; u.step += dt * 8; }
  } else if (u.state === 'hut' || u.state === 'chum') { u.face = Math.sign(p.x - u.x) || u.face; }
  const v = G.vera;
  if (v.state === 'follow') {
    const d = dist(v, p);
    const tgt = p.inside && !insideHut(v.x, v.y) ? (Math.abs(v.x - HUT.x) < 12 && v.y > HUT_IN.y0 ? { x: HUT.x, y: HUT.y } : { x: HUT.x, y: HUT_IN.y1 + 30 }) : p;
    const dt2 = dist(v, tgt);
    // отстала — всё равно ковыляет следом (или сама к двери избы, если герой внутри)
    if (d > 450) { v.waitT -= dt; if (v.waitT <= 0) { v.waitT = 20; toast(':person: Вера отстала'); } }
    if (dt2 > (tgt === p ? 56 : 2)) {
      // обход избы/построек по сетке Nav; у деревьев — шаг в сторону, если застряла
      const q = dt2 > 40 && !insideHut(tgt.x, tgt.y) ? Nav.way(v, tgt.x, tgt.y) : tgt;
      let dx = q.x - v.x, dy = q.y - v.y; const dq = Math.hypot(dx, dy) || 1;
      dx /= dq; dy /= dq;
      if (v.sideT > 0) { v.sideT -= dt; const sx = -dy * v.side, sy = dx * v.side; dx = dx * 0.3 + sx; dy = dy * 0.3 + sy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
      const sp = d > 450 ? 70 : 99, st = Math.min(sp * dt, q === tgt ? dt2 : dq);
      const x0 = v.x, y0 = v.y;
      v.x += dx * st; v.y += dy * st; v.face = Math.sign(dx) || v.face; v.step += dt * 6;
      solid(v, 9, 'p');
      v.chk = (v.chk || 0) + dt; v.moved = (v.moved || 0) + Math.hypot(v.x - x0, v.y - y0);
      if (v.chk > 0.8) { if (v.moved < 12 && !(v.sideT > 0)) { v.sideT = 0.7; v.side = Math.random() < 0.5 ? 1 : -1; } v.chk = 0; v.moved = 0; }
    }
    if (insideHut(v.x, v.y)) { v.state = 'hut'; v.x = SPOT.veraBed.x; v.y = SPOT.veraBed.y; toast(':person: Вера в тепле'); }
  }
}

function updateHares(dt0) {
  const p = G.p, dt = dt0;
  for (let i = 0; i < G.hares.length; i++) {
    const h = G.hares[i], dt = lodDt(h, dt0, i); if (!dt) continue;
    const dd = dist(h, p);
    h.t -= dt;
    if (dd < 170) {
      if (h.t <= 0) {
        const a = Math.atan2(h.y - p.y, h.x - p.x) + rnd(-1, 1), sp = 150 - 4 * (lvl('hunt') - 1);
        h.vx = Math.cos(a) * sp; h.vy = Math.sin(a) * sp; h.t = rnd(0.3, 0.6);
      }
    } else if (h.t <= 0) {
      if (Math.random() < 0.5) { h.vx = h.vy = 0; } else { const a = Math.random() * 6.28; h.vx = Math.cos(a) * 40; h.vy = Math.sin(a) * 40; }
      h.t = rnd(1, 3);
    }
    h.x = clamp(h.x + h.vx * dt, 60, W - 60); h.y = clamp(h.y + h.vy * dt, 60, H - 60);
    if (Math.abs(h.x - HUT.x) < 140 && Math.abs(h.y - HUT.y) < 120) { h.vx *= -1; h.vy *= -1; }
    if (Math.abs(h.vx) > 1) h.face = Math.sign(h.vx);
    const moving = Math.hypot(h.vx, h.vy) > 1;
    h.hop += dt * (moving ? 14 : 0);
    if (moving) { h.pr += dt; if (h.pr > 0.35) { h.pr = 0; if (dd < RADII.awake) print(h.x, h.y, Math.atan2(h.vy, h.vx), 'h'); } }
  }
  if (G.hares.length < worldCount('haresMin') && Math.random() < dt * 0.3 * WORLD.area) spawnHare(false);
}

// ---------- директор угроз ----------
const COST = { scout: 10, pack: 35 };
// «далеко от укрытия»: изба или готовое укрытие посёлка дальше RADII.farHome (на большой карте — не «от избы»)
function farFromShelter() {
  const p = G.p, R2 = RADII.farHome * RADII.farHome;
  if ((p.x - HUT.x) ** 2 + (p.y - HUT.y) ** 2 <= R2) return false;
  return !G.col || !G.col.builds.some(b => b.done && BUILDS[b.type].shelter && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= R2);
}
function director(dt, night, storm) {
  const D = G.D, ch = CH_T[G.chapter], s = G.s, p = G.p;
  const near = G.wolves.filter(w => dist2(w, p) < 400 * 400).length;
  const bearNear = G.bear && dist2(G.bear, p) < 500 * 500 ? 30 : 0;
  D.tension = clamp(0.35 * (100 - s.warm) + 0.25 * (100 - s.hp) + 0.15 * (100 - s.food) + (night > 0.6 ? 20 : 0) + (storm ? 15 : 0)
    + (farFromShelter() ? 10 : 0) + 8 * near + bearNear, 0, 100);
  D.budget = Math.min(80, D.budget + ch.rate * (1 - D.tension / 100) * dt);
  if (s.hp < 30 && D.phase !== 'relax') { D.phase = 'relax'; D.calmT = 20; }
  const isNight = night > 0.55;
  if (!isNight) { D.queued = null; D.omenT = 0; }
  switch (D.phase) {
    case 'build':
      if (!isNight || (p.sleeping && G.hut.door)) break;
      if (G.urk.wolfQuest && !G.flags.leaderDone && !G.pack && !storm && G.fired.E5 && D.budget >= 35 && !D.queued) {
        D.dir = Math.random() * Math.PI * 2; Sound.howl(0, 0.22); toast(':wolf: Вожак с рваным ухом близко'); spawnPack(3, true); D.budget -= 35; D.phase = 'peak'; break;
      }
      if (!D.queued) D.queued = pickThreat(ch, storm);
      if (D.queued && D.omenT === 0) { D.dir = Math.random() * Math.PI * 2; omen(D.queued); D.omenT = D.queued === 'pack' ? 25 : 8; }
      else if (D.queued && D.omenT > 0) {
        D.omenT -= dt;
        if (D.omenT <= 0) {
          D.omenT = 0;
          if (D.tension < ch.peak + 10) {
            if (D.queued === 'pack') spawnPack(clamp(ch.wolves - G.mercy, 2, 5), false); else spawnScout();
            D.budget -= COST[D.queued]; D.last = D.queued; D.phase = 'peak';
          }
          D.queued = null;
        }
      }
      break;
    case 'peak': if (G.wolves.length === 0 || D.tension > 85) { D.phase = 'relax'; D.calmT = rnd(25, 45); } break;
    case 'relax': D.calmT -= dt; if (D.calmT <= 0) D.phase = 'build'; break;
  }
}
function pickThreat(ch, storm) {
  const D = G.D, max = ch.wolves - G.mercy;
  if (storm) return D.budget >= 10 ? 'scout' : null;
  if (D.budget >= 35 && max >= 2 && D.last !== 'pack') return 'pack';
  if (D.budget >= 10 && D.last !== 'scout') return 'scout';
  if (D.budget >= 35 && max >= 2) return 'pack';
  return null;
}
function omen(type) {
  const p = G.p, a = G.D.dir;
  if (type === 'pack') {
    Sound.howl(Math.cos(a), 0.2); toast(':wolf: Вой. Близко.');
    for (let i = -6; i < 6; i++) print(p.x + Math.cos(a) * 180 + Math.cos(a + 1.57) * i * 26, p.y + Math.sin(a) * 180 + Math.sin(a + 1.57) * i * 26, a + 1.57, 'w');
  }
}
function wolfAt(a, d, extra) {
  const p = G.p;
  const w = { x: clamp(p.x + Math.cos(a) * d, 60, W - 60), y: clamp(p.y + Math.sin(a) * d, 60, H - 60), vx: 0, vy: 0, hp: 3, cd: 0, t: 0,
    face: 1, step: 0, dir: Math.random() < 0.5 ? -1 : 1, st: 'circle', ang: 0, pr: 0 };
  Object.assign(w, extra); w.ang = Math.atan2(w.y - p.y, w.x - p.x);
  G.wolves.push(w); return w;
}
function spawnScout() { wolfAt(G.D.dir, rnd(600, 700), { st: 'scout', t: rnd(15, 25) }); }
function spawnPack(n, siege) {
  const a0 = G.D.dir || Math.random() * 6.28;
  G.pack = { R: 300, lungeT: 4, protT: 0, hurt: 0, killed: 0, leader: siege, leaderHurt: 0 };
  for (let i = 0; i < n; i++) wolfAt(a0 + (i - n / 2) * 0.35, rnd(600, 720), {});
  if (siege) wolfAt(a0, 740, { hp: 6, leader: 1 });
}
function retreatAll() { for (const w of G.wolves) { w.st = 'retreat'; } if (G.pack) G.pack.retreat = 1; G.pack = null; }

function updateWolves(dt, night) {
  const p = G.p, pk = G.pack, prot = protection(), dawn = night < 0.4;
  if (pk) {
    pk.R = Math.max(130, pk.R - 10 * dt); pk.lungeT -= dt;
    pk.protT = prot ? pk.protT + dt : 0;
    if (dawn || (!pk.leader && (pk.hurt >= 2 || pk.killed >= 1)) || pk.protT > 22 || (pk.leader && pk.leaderHurt >= 5)) retreatAll();
  }
  let lunging = G.wolves.some(w => w.st === 'lunge' || w.st === 'crouch');
  // осада: волки скребут дверь при холодной печи
  if (p.inside && G.hut.door && G.hut.fuel <= 0 && G.wolves.some(w => Math.hypot(w.x - HUT.x, w.y - (HUT_IN.y1 + 20)) < 70)) {
    G.hut.doorHp -= dt * 5;
    if (G.hut.doorHp <= 0) { G.hut.door = 0; G.hut.doorHp = 100; toast(':door: Дверь выломали!'); shake(10); }
  }
  for (let i = G.wolves.length - 1; i >= 0; i--) {
    const w = G.wolves[i];
    w.cd = Math.max(0, w.cd - dt); w.t -= dt;
    let tx = w.x, ty = w.y, sp = 0, direct = false;
    const dp = dist(w, p), ap = Math.atan2(w.y - p.y, w.x - p.x);
    if (dawn && w.st !== 'retreat') w.st = 'retreat';
    switch (w.st) {
      case 'scout': {
        const a = ap + 0.3 * w.dir * dt * 3; tx = p.x + Math.cos(a) * 420; ty = p.y + Math.sin(a) * 420; sp = 95;
        if (w.t <= 0) { const prt = protection(); if (!prt && Math.random() < 0.4) { w.st = 'crouch'; w.t = 0.6; Sound.growl(0.15); } else w.st = 'retreat'; }
        break;
      }
      case 'circle': {
        let prey = null, pd = 320 * 320;
        for (const u of Space.units.near(w.x, w.y, 320)) { const d = dist2(u, w); if (!u.hidden && d < pd && (prot || d < dist2(p, w))) { pd = d; prey = u; } }
        if (prey) {
          tx = prey.x; ty = prey.y; sp = 150;
          if (dist2(prey, w) < 28 * 28 && w.cd <= 0) { prey.hp -= 8 * Settings.diff().wolf; w.cd = 1.5; w.st = 'flee'; w.t = 0.6; Sound.bite(); burst(prey.x, prey.y - 12, 8, '#c0392b'); }
          break;
        }
        const c = prot || p, R = prot ? prot.r + 50 : (pk ? pk.R : 220);
        w.ang = Math.atan2(w.y - c.y, w.x - c.x) + 0.4 * w.dir * dt * 2;
        tx = c.x + Math.cos(w.ang) * R; ty = c.y + Math.sin(w.ang) * R; sp = 110;
        if (!prot && !lunging && pk && pk.lungeT <= 0 && dp < 320) {
          w.st = 'crouch'; w.t = 0.6; lunging = true; pk.lungeT = rnd(2, 3.5); Sound.growl(0.12);
        }
        if (!pk && !prot) { w.st = 'crouch'; w.t = 0.6; }
        break;
      }
      case 'crouch': w.face = Math.sign(p.x - w.x) || w.face; if (w.t <= 0) { w.st = 'lunge'; w.t = 1; const a = Math.atan2(p.y - w.y, p.x - w.x); w.lx = Math.cos(a) * 190; w.ly = Math.sin(a) * 190; } break;
      case 'lunge':
        direct = true; w.vx = w.lx; w.vy = w.ly;
        if (w.t <= 0 || prot) { w.st = 'circle'; break; }
        if (dp < 30 && w.cd <= 0 && !(p.inside && G.hut.door) && !(p.iT > 0)) {
          p.iT = 1.1;
          G.s.hp -= 12 * Settings.diff().wolf; G.s.warm = Math.max(0, G.s.warm - 8); w.cd = 1.5; G.cause = 'wolf'; G.hurt = 1; shake(9);
          p.x += Math.cos(ap + Math.PI) * 18; p.y += Math.sin(ap + Math.PI) * 18; p.action = null; Sound.bite();
          ArtWorld.fx.blood(G.parts, p.x, p.y, G.decals = G.decals || []); w.st = 'flee'; w.t = 0.8;
          if (p.sleeping) wake(false, ':wolf: Волк!');
        }
        break;
      case 'flee': tx = w.x + Math.cos(ap) * 100; ty = w.y + Math.sin(ap) * 100; sp = 170; if (w.t <= 0) w.st = G.pack ? 'circle' : 'retreat'; break;
      case 'retreat': tx = w.x + Math.cos(ap) * 100; ty = w.y + Math.sin(ap) * 100; sp = 170; if (dp > 950) { G.wolves.splice(i, 1); continue; } break;
    }
    if (!direct) {
      if (sp > 0 && (tx - w.x) ** 2 + (ty - w.y) ** 2 > 40 * 40) { const q = Nav.way(w, tx, ty); if (q.x !== tx || q.y !== ty) { const l0 = Math.hypot(tx - w.x, ty - w.y), l1 = Math.hypot(q.x - w.x, q.y - w.y) || 1; tx = w.x + (q.x - w.x) / l1 * l0; ty = w.y + (q.y - w.y) / l1 * l0; } }
      let vx = tx - w.x, vy = ty - w.y; const l = Math.hypot(vx, vy) || 1;
      vx = vx / l * Math.min(sp, l * 4); vy = vy / l * Math.min(sp, l * 4);
      for (const f of burningFires()) {
        const r = fearR(f), dx = w.x - f.x, dy = w.y - f.y, dd = Math.hypot(dx, dy);
        if (dd < r && dd > 0.1) { const k = (r - dd) * 3; vx += dx / dd * k; vy += dy / dd * k; }
      }
      if (p.torch > 0 && dp < 120 && dp > 0.1) { vx += (w.x - p.x) / dp * (120 - dp) * 3; vy += (w.y - p.y) / dp * (120 - dp) * 3; }
      w.vx += (vx - w.vx) * Math.min(1, dt * 5); w.vy += (vy - w.vy) * Math.min(1, dt * 5);
    }
    w.x += w.vx * dt; w.y += w.vy * dt; solid(w, 12, 'w');
    if (Math.abs(w.vx) > 5) w.face = Math.sign(w.vx);
    const spd = Math.hypot(w.vx, w.vy); w.step += dt * spd * 0.08;
    if (spd > 20) { w.pr += dt; if (w.pr > 0.3) { w.pr = 0; print(w.x, w.y, Math.atan2(w.vy, w.vx), 'w'); } }
  }
}

function updateBear(dt, h, night) {
  const p = G.p;
  const nightKey = h < 12 ? G.day - 1 : G.day;
  if (!G.bear && G.chapter >= 3 && !G.flags.bearDead && night > 0.6 && G.bearNight !== nightKey) {
    G.bearNight = nightKey;
    const a = Math.random() * 6.28;
    const hp = G.flags.bearWounded ? 14 : 20;
    G.bear = { x: POI.mar.x + Math.cos(a) * 420, y: POI.mar.y + Math.sin(a) * 420, hp, hp0: hp, st: 'wander', t: 3, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0 };
    Sound.treeCrack(); setTimeout(() => Sound.growl(0.2), 1500);
    toast(':bear: Треск в тайге. Шатун вышел');
  }
  const b = G.bear; if (!b) return;
  b.t -= dt; b.cd = Math.max(0, b.cd - dt); b.stunCd = Math.max(0, b.stunCd - dt);
  const dp = dist(b, p), ap = Math.atan2(p.y - b.y, p.x - b.x);
  let tx = b.x, ty = b.y, sp = 0, direct = false;
  if (night < 0.3 && b.st !== 'flee') { b.st = 'flee'; b.t = 8; }
  switch (b.st) {
    case 'wander': {
      // ночь шатуна: одна куча на мари, потом — к посёлку и избе (ломает постройки, дверь, ворует еду)
      if (b.raid) { const q = bearRaid(b, dt); tx = q.x; ty = q.y; sp = 75; }
      else {
        const s = G.stacks[b.tgt % 3]; tx = s.x; ty = s.y; sp = 60;
        if (dist(b, s) < 30) {
          if (s.wood > 0 && !s.lit && dist(p, s) > 200 && b.t <= 0 && s.bearN !== G.bearNight) { s.wood--; s.bearN = G.bearNight; toast(':bear: Шатун разворошил кучу'); b.t = 5; }
          if (b.t <= 0) { b.tgt++; b.t = 4; b.raid = 1; }
        }
      }
      if (dp < 380 && !(p.inside && G.hut.door)) { b.st = 'hunt'; Sound.growl(0.35); }
      break;
    }
    case 'hunt':
      tx = p.x; ty = p.y; sp = 120;
      if (p.inside && G.hut.door) { b.st = 'wander'; break; }
      if (dp < 75 && b.cd <= 0) { b.st = 'windup'; b.t = 0.65; Sound.growl(0.3); }
      else if (dp > 150 && dp < 300 && b.cd <= 0 && Math.random() < dt * 0.5) { b.st = 'charge'; b.t = 1.5; b.lx = Math.cos(ap) * 200; b.ly = Math.sin(ap) * 200; }
      else if (dp > 650) b.st = 'wander';
      break;
    case 'fleeHurt': tx = b.x - Math.cos(ap) * 100; ty = b.y - Math.sin(ap) * 100; sp = 130; if (b.t <= 0 || dp > 900) { G.bear = null; return; } break;
    case 'windup':
      b.face = Math.sign(p.x - b.x) || b.face;
      if (b.t <= 0) {
        if (dp < 88 && !(p.iT > 0)) {
          p.iT = 1.1; G.s.hp -= 50 * Settings.diff().wolf; G.cause = 'bear'; G.hurt = 1; shake(18); p.x += Math.cos(ap) * 50; p.y += Math.sin(ap) * 50; p.action = null; Sound.bite();
          burst(p.x, p.y - 16, 16, '#c0392b');
        }
        b.st = 'hunt'; b.cd = 1.1;
      }
      break;
    case 'charge': direct = true; b.vx = b.lx; b.vy = b.ly; if (b.t <= 0) b.st = 'hunt'; if (dp < 40 && b.cd <= 0) { b.st = 'windup'; b.t = 0.3; } break;
    case 'stun': if (b.t <= 0) b.st = 'hunt'; break;
    case 'flee': tx = b.x - Math.cos(ap) * 100; ty = b.y - Math.sin(ap) * 100; sp = 150; if (b.t <= 0 || dp > 1000) { G.bear = null; return; } break;
  }
  // подранок уходит до следующей ночи
  if (b.hp <= b.hp0 * 0.4 && b.st !== 'fleeHurt' && b.st !== 'flee') { b.st = 'fleeHurt'; b.t = 10; G.flags.bearWounded = 1; toast(':bear: Шатун уходит, огрызаясь · вернётся'); Sound.growl(0.4); }
  if (G.urk.respect >= 2 && !G.flags.urkShot && (b.st === 'hunt' || b.st === 'windup' || b.st === 'charge') && dp < 220) {
    G.flags.urkShot = 1; G.flags.bearWounded = 1; b.hp -= 4; b.st = 'flee'; b.t = 6; Sound.shot(); shake(6);
    toast(':rifle: Уркачан выстрелил! Шатун ушёл');
  }
  if (!direct) {
    if (sp > 0 && (tx - b.x) ** 2 + (ty - b.y) ** 2 > 50 * 50) { const q = Nav.way(b, tx, ty); if (q.x !== tx || q.y !== ty) { const l0 = Math.hypot(tx - b.x, ty - b.y), l1 = Math.hypot(q.x - b.x, q.y - b.y) || 1; tx = b.x + (q.x - b.x) / l1 * l0; ty = b.y + (q.y - b.y) / l1 * l0; } }
    let vx = tx - b.x, vy = ty - b.y; const l = Math.hypot(vx, vy) || 1;
    b.vx = vx / l * Math.min(sp, l * 4); b.vy = vy / l * Math.min(sp, l * 4);
  }
  if (b.st === 'windup' || b.st === 'stun') { b.vx = 0; b.vy = 0; }
  b.x += b.vx * dt; b.y += b.vy * dt; solid(b, Math.abs(b.x - HUT.x) < 160 && Math.abs(b.y - HUT.y) < 160 ? 11 : 20, 'b');
  if (Math.abs(b.vx) > 5) b.face = Math.sign(b.vx);
  const spd = Math.hypot(b.vx, b.vy); b.step += dt * spd * 0.05;
  if (spd > 20) { b.pr += dt; if (b.pr > 0.45) { b.pr = 0; print(b.x, b.y, Math.atan2(b.vy, b.vx), 'b'); } }
  if (onThinIce(b)) {
    G.bear = null; G.flags.bearDead = 1; Sound.splash(); Sound.growl(0.4); shake(12);
    burst(b.x, b.y, 30, '#9fd0ee', 180); toast(':frost: Шатун ушёл под лёд!');
  }
}

// набег шатуна: цель — постройка посёлка (коптильня первой) или дверь избы; возвращает точку, куда идти
function bearRaid(b, dt) {
  const p = G.p;
  if (p.sleeping && dist2(b, HUT) < 320 * 320) wake(false, ':bear: Шатун у избы!');
  let bl = b.rid ? G.col.builds.find(q => q.id === b.rid && q.done) : null;
  if (!bl && !b.rHut) {
    const list = G.col.builds.filter(q => q.done && !BUILDS[q.type].flat && q.type !== 'tower');
    list.sort((a, c) => (a.type === 'smoke' ? -1e7 : 0) + dist2(a, b) - (c.type === 'smoke' ? -1e7 : 0) - dist2(c, b));
    bl = list[0] || null; b.rid = bl ? bl.id : 0; b.rHut = !bl;
  }
  if (bl) {
    const B = BUILDS[bl.type], pt = { x: bl.x, y: bl.y + B.h / 2 + 18 };
    if (dist2(b, pt) < 36 * 36 && b.t <= 0) {
      b.t = 1.2; bl.hp = (bl.hp == null ? 60 : bl.hp) - 15; shake(4); Sound.hit();
      if (bl.bearN !== G.bearNight) { bl.bearN = G.bearNight; toast(`:bear: Шатун ломает: ${B.i} ${B.n}!`); Sound.growl(0.35); }
      if (bl.type === 'smoke') { let n = 0; for (const k of FOOD_KEYS) while (n < 2 && (G.chest[k] || 0) > 0) { G.chest[k]--; n++; } }
      for (const u of G.col.units) if (!u.hidden && dist2(u, b) < 60 * 60) { u.hp -= 20; burst(u.x, u.y - 12, 8, '#c0392b'); }
      if (bl.hp <= 0) {
        G.col.builds.splice(G.col.builds.indexOf(bl), 1); b.rid = 0; b.rHut = 1;
        for (const u of G.col.units) if (u.hidden && dist2(u, bl) < 90 * 90) { u.hidden = false; u.x = bl.x; u.y = bl.y + B.h / 2 + 20; }
        toast(`:bear: ${B.i} ${B.n} разломан`); Sound.treeCrack(); for (let i = 0; i < 4; i++) ArtWorld.fx.chips(G.parts, bl.x + rnd(-20, 20), bl.y + rnd(-10, 10));
      }
    }
    return pt;
  }
  // изба: дверь держит ~20 с, потом шатун внутри
  const door = { x: HUT.x, y: HUT_IN.y1 + 34 };
  if (dist2(b, door) < 40 * 40) {
    if (G.hut.door) {
      G.hut.doorHp -= dt * 5;
      if (!b.doorSaid) { b.doorSaid = 1; toast(':bear: Шатун ломится в дверь!'); Sound.growl(0.4); shake(6); }
      if (G.hut.doorHp <= 0) { G.hut.door = 0; G.hut.doorHp = 100; toast(':door: Шатун выломал дверь!'); shake(12); Sound.treeCrack(); }
    } else if (p.inside) { b.st = 'hunt'; }
    else if (b.t <= 0 && cnt('food', true) - cnt('food', false) > 0) {
      let n = 0; for (const k of FOOD_KEYS) while (n < 3 && (G.chest[k] || 0) > 0) { G.chest[k]--; n++; }
      toast(':bear: Шатун ворует еду из избы!'); b.t = 10; Sound.growl(0.3);
    }
  }
  return door;
}

function die(cause) {
  if (G.chapter === 0) {
    G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y + 4; G.p.action = null; G.p.sleeping = false;
    G.s.hp = 50; G.s.warm = 70; G.s.food = Math.max(G.s.food, 35); G.time += CYCLE / 8; G.hut.fuel = Math.max(G.hut.fuel, 90);
    G.inv.wood = Math.floor((G.inv.wood || 0) / 2); G.wolves = []; G.pack = null;
    UI.card(':evenk:', 'Уркачан дотащил', 'Чаем отпоил. Ворчал. Дров половину забрал — за доставку.');
    return;
  }
  deathLog[G.chapter] = (deathLog[G.chapter] || 0) + 1;
  endGame('death', cause);
}
function endGame(kind, cause) { state = 'over'; input.act = false; if (kind !== 'death' && typeof Finale !== 'undefined') Finale.play(kind, G.stats, () => UI.end(kind, cause)); else { if (kind === 'death') Sound.sting && Sound.sting('death'); UI.end(kind, cause); } }
