'use strict';
// Wind — единый ветер «Сибири» (паспорт R1, docs/design/INTERACTION-PASSPORT.md). Всё, что знает о ветре, читает только его:
// частицы и снегопад (particles.js), изгиб деревьев (gfx.js), снос героя на гольце (zones.js), звук (audio.js),
// дым (через снос частиц), вымпел, лопасть, дверь, провода и записки у Ми-8 (live.js).
//
//   Wind.at(x, y)      → { ms (м/с), gust 0..1, dir (рад, 0 = на восток, +x), dx, dy, gdir/gx/gy — направление порыва (рыщет ±0.1 рад), base (м/с без порыва) }
//   Wind.dir()         → куда дует, рад (0 = на восток): гуляет за часы игры (±0.9 рад, периоды ~10 и ~5 ч), во фронте пурги
//                        доворачивает к направлению фронта; от него — подветренная сторона наддувов (js/snow.js), снос героя, дым, ели
//   Wind.dirAt(t)      → направление в момент t игры (тесты)
//   Wind.canopy(x, y)  → множитель полога леса 0.5..1 (паспорт R1 «лес × 0.5»: плотность крон вокруг, сетка 128 px, лениво)
//   Wind.ms(x, y)      → только м/с (горячий путь: снос частиц)
//   Wind.gust(x, y)    → порыв 0..1: волна шума, бегущая вдоль ветра со скоростью 110 px/с (бывший gfx.js gustAt, тот же шум)
//   Wind.base()        → погода: тихий мороз 1.2 · день 4.5 · пурга 18 м/с (плавные переходы по часу и краям пурги)
//   Wind.treeK()       → base / 4.5 — прежний ENV.wind (день = 1, пурга = 4): вид качания елей сохранён
//   Wind.px(ms)        → снос частиц, px/с (ms × 16)
//   Wind.beaufort(ms)  → балл 0..12
//   Wind.tick(dt)      → шаг логики (Interact.tick): событие 'gust' у героя при подъёме через 8 м/с
//   Wind.force(o)      → тесты: { t } — часы ветра, { ms } — ровный ветер везде, { base } — погода, { gust }, { dir }; force() — снять
//   Wind.seed(v)       → другой шум порывов (по умолчанию 0x57D — как у прежних елей)
// Детерминизм: без Math.random; часы — общий `now` рендера (или force.t), шум — от seed.
const Wind = (() => {
  const GUST_V = 110, GUST_L = 560;          // порыв бежит по миру вдоль ветра (+x)
  const CALM = 1.2, DAY = 4.5, STORM = 18;   // м/с: тихий мороз (вечер → 2–3 ч после восхода), день, пурга
  const RAMP = 30;                            // с игры: ветер крепнет до начала пурги и стихает после
  const BF = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let WN = null, seedV = 0x57D;
  const noise = () => WN || (WN = Noise.make(mulberry(seedV)));
  const F = { t: null, ms: null, base: null, gust: null, dir: null };
  const clock = () => (F.t != null ? F.t : typeof now === 'number' ? now : 0);

  // порыв бежит вдоль ветра: координаты вдоль (u) и поперёк (v) направления; при dir = 0 — прежняя формула (x, y)
  function gust(x, y) {
    if (F.gust != null) return F.gust;
    const t = clock(), d = dir(), c = Math.cos(d), s = Math.sin(d), u = x * c + y * s, v = y * c - x * s;
    return sm(-0.05, 0.55, noise().n2((u + v * 0.35 - t * GUST_V) / GUST_L, v / 900 + t * 0.04));
  }
  // ---------- направление: медленно гуляет (часы игры), во фронте пурги поворачивает к ветру фронта ----------
  // D0 — преобладающий (0 = на восток); блуждание — два слоя шума с периодами ~10 ч и ~5 ч игры (±0.9 и ±0.25 рад).
  // Фронт: у каждой пурги своё направление (хэш её начала); ветер доворачивает к нему за RAMP до начала и отпускает после.
  const HOUR = () => (typeof CYCLE === 'number' ? CYCLE : 480) / 24;
  const D0 = 0, WANDER = 0.9, WANDER2 = 0.25;
  const frontDir = S => { const h = Math.sin((S.a || 0) * 12.9898 + (S.b || 0) * 0.37) * 43758.5453; return D0 + ((h - Math.floor(h)) * 2 - 1) * 1.4; };
  const angLerp = (a, b, k) => { let d = b - a; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; return a + d * k; };
  let dT = NaN, dG = null, dS = null, dV = 0;
  function dirAt(gt) {
    if (F.dir != null) return F.dir;
    const Hh = HOUR(), n = noise();
    let d = D0 + WANDER * n.n2(gt / (10 * Hh), 3.7) + WANDER2 * n.n2(gt / (5 * Hh), 9.1);
    const S = typeof G !== 'undefined' && G ? G.storm : null;
    if (S && S.a != null) { const k = sm(S.a - RAMP * 2, S.a + 5, gt) * (1 - sm(S.b - 5, S.b + RAMP * 2, gt)); if (k > 0) d = angLerp(d, frontDir(S), k); }
    return d;
  }
  function dir() {
    if (F.dir != null) return F.dir;
    if (typeof G === 'undefined' || !G || typeof G.time !== 'number') return D0;
    if (G.time === dT && G === dG && G.storm === dS) return dV;
    dT = G.time; dG = G; dS = G.storm;
    return (dV = dirAt(G.time));
  }
  // погода → базовый ветер (кэш на кадр: время игры не меняется между вызовами)
  let cT = NaN, cB = DAY, cG = null, cS = null;
  function base() {
    if (F.base != null) return F.base;
    if (typeof G === 'undefined' || !G) return DAY;
    if (G.time === cT && G === cG && G.storm === cS) return cB;
    cT = G.time; cG = G; cS = G.storm;
    return (cB = baseAt(G.time, typeof state !== 'undefined' && state === 'play'));
  }
  // погода в момент t (прогноз ночи — свой час); storm — учитывать пургу
  function baseAt(t, storm = true) {
    if (F.base != null) return F.base;
    const h = hourOf(t), day = sm(9.5, 11.5, h) * (1 - sm(17, 19, h));
    let b = CALM + (DAY - CALM) * day;
    const S = typeof G !== 'undefined' && G ? G.storm : null;
    if (S && storm) { const k = sm(S.a - RAMP, S.a + 5, t) * (1 - sm(S.b - 5, S.b + RAMP, t)); b += (STORM - b) * k; }
    return b;
  }
  // ветер «на коже», м/с, без порыва: погода в момент t × местность × укрытие за отвалом/стенкой (js/trail.js shelter) — тепло тела (js/survival.js)
  function feel(x, y, t) {
    const B = F.ms != null ? F.ms : terrain(x, y, baseAt(t == null ? G.time : t));
    return B * shelter(x, y, t);
  }
  // укрытие 0.3..1: стенка/отвал ≥ 60 см и ≥ 2 м с наветренной стороны (Trail.shelter)
  function shelter(x, y, t) { return typeof Trail !== 'undefined' && Trail.shelter ? Trail.shelter(x, y, t == null || F.dir != null || (G && t === G.time) ? dir() : dirAt(t)) : 1; }
  // полог леса: под кронами ветер слабее, до × 0.5 (паспорт R1). Сетка 128 px, клетка считается один раз (сумма крон в ±112 px:
  // ель и кедр 1, голая берёза 0.4, гарь и деревца 0 — × размер), билинейно между клетками. Сброс — новый мир или раз в 60 с игры (рубка, рост)
  const CC = 128, TMP = []; let CG = null, CGx = 0, CGy = 0, CGsrc = null, CGt = 0;
  function canopyCell(i, j) {
    const x = (i + 0.5) * CC, y = (j + 0.5) * CC; let n = 0; TMP.length = 0;
    for (const t of Space.trees.near(x, y, 112, TMP)) if (t.wood > 0 && t.stage !== 1 && t.kind !== 3) n += (t.kind === 1 ? 0.4 : 1) * (t.s || 1);
    return 1 - 0.5 * sm(3, 11, n);
  }
  const cell = (i, j) => { if (i < 0 || j < 0 || i >= CGx || j >= CGy) return 1; const k = j * CGx + i; let v = CG[k]; if (v !== v) v = CG[k] = canopyCell(i, j); return v; };
  function canopy(x, y) {
    if (typeof G === 'undefined' || !G || !G.trees || !G.trees.length || typeof Space === 'undefined' || typeof WORLD === 'undefined') return 1;
    if (CGsrc !== G.trees || G.time - CGt > 60 || G.time < CGt) {
      CGx = Math.ceil(WORLD.W / CC) + 1; CGy = Math.ceil(WORLD.H / CC) + 1;
      if (!CG || CG.length !== CGx * CGy) CG = new Float32Array(CGx * CGy);
      CG.fill(NaN); CGsrc = G.trees; CGt = G.time;
    }
    const fx = x / CC - 0.5, fy = y / CC - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    return (cell(i, j) * (1 - u) + cell(i + 1, j) * u) * (1 - v) + (cell(i, j + 1) * (1 - u) + cell(i + 1, j + 1) * u) * v;
  }
  // местность: голец — всегда дует (≥ 5 м/с) и ×1.6; марь и лёд реки ×1.2; лес — × полог (0.5..1)
  function terrain(x, y, b) {
    if (typeof Zones !== 'undefined' && Zones.terrainKey && Zones.terrainKey(x, y) === 'golets') return Math.max(b, 5) * 1.6;
    if (typeof POI !== 'undefined' && POI.mar) { const m = POI.mar, dx = x - m.x, dy = y - m.y; if (dx * dx + dy * dy < m.r * m.r) return b * 1.2; }
    if (typeof riverX === 'function' && typeof RW !== 'undefined' && Math.abs(x - riverX(y)) < RW) return b * 1.2;
    return b * canopy(x, y);
  }
  // ms = база × (пол + (1 − пол) · порыв); в пургу пол выше — ветер ровнее, без провалов до штиля
  function msAt(x, y, g, B) {
    if (F.ms != null) return F.ms;
    const fl = 0.35 + 0.3 * sm(8, 16, B);
    return B * (fl + (1 - fl) * g);
  }
  function ms(x, y) { const B = F.ms != null ? F.ms : terrain(x, y, base()); return msAt(x, y, gust(x, y), B); }
  function at(x, y) {
    const g = gust(x, y), B = F.ms != null ? F.ms : terrain(x, y, base());
    const d = dir(), gd = d + 0.22 * (g - 0.4) * Math.sin(x * 0.004 + y * 0.003 + clock() * 0.5); // порыв чуть рыщет по направлению
    return { ms: msAt(x, y, g, B), gust: g, dir: d, dx: Math.cos(d), dy: Math.sin(d), gdir: gd, gx: Math.cos(gd), gy: Math.sin(gd), base: B };
  }
  const beaufort = v => { let b = 0; while (b < BF.length && v >= BF[b]) b++; return b; };
  const px = v => v * 16;
  const treeK = () => (F.ms != null ? F.ms : base()) / DAY;

  // шаг логики: порыв у героя прошёл 8 м/с вверх → Interact 'gust' (гистерезис до 6.5)
  let gustOn = false;
  function tick() {
    if (typeof G === 'undefined' || !G || !G.p || typeof Interact === 'undefined') return;
    const v = ms(G.p.x, G.p.y);
    if (!gustOn && v >= 8) { gustOn = true; Interact.emit('gust', { who: 'wind', x: G.p.x, y: G.p.y, ms: v }); }
    else if (gustOn && v < 6.5) gustOn = false;
  }
  function force(o) { F.t = F.ms = F.base = F.gust = F.dir = null; if (o) Object.assign(F, o); cT = NaN; dT = NaN; }
  function seed(v) { seedV = v >>> 0; WN = null; }
  return { at, ms, gust, base, baseAt, feel, shelter, treeK, px, beaufort, tick, force, seed, clock, dir, dirAt, canopy, CALM, DAY, STORM, get forced() { return Object.assign({}, F); } };
})();
