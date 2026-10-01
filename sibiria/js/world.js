'use strict';
// Мир: генерация из seed, деревья, места (изба, кедрач, тонкий лёд), столкновения, туман войны, навигация.
// Глобально — только то, что читает рендер: insideHut, treesNear; навигация — модуль Nav.
const insideHut = (x, y) => x > HUT_IN.x0 && x < HUT_IN.x1 && y > HUT_IN.y0 && y < HUT_IN.y1;
// деревья в квадрате ±r (без проверки расстояния) — gfx, посёлок, бот
function treesNear(x, y, r, out = []) { return Space.trees.near(x, y, r, out); }
// сугроб под точкой (внутри эллипса), если есть — герой в глубоком снегу: медленнее, след глубже
function driftAt(x, y) {
  for (const d of Space.drifts.near(x, y, 130)) { const dx = (x - d.x) / d.rx, dy = (y - d.y) / d.ry; if (dx * dx + dy * dy < 1) return d; }
  return null;
}

const World = (() => {
  // туман войны: клетка FOG.cell px мира, сетка nx × ny (при ×1 — 36 × 36); значение клетки 0..3
  const FOG = { cell: WORLD.fogCell, nx: Math.ceil(W / WORLD.fogCell), ny: Math.ceil(H / WORLD.fogCell) };
  // ---------- подножия вещей (js/content/footprints.js) → преграды ----------
  // Запись COLL: { key, k, o, x, y, r (центр и радиус рамки — для посёлка и быстрых отсевов), x0..y1 — рамка, sh — фигуры в мире, need? }
  // Фигура: { t: 0, x0, y0, x1, y1, k } — прямоугольник; { t: 1, cx, cy, cr, k } — круг.
  function footShapes(key, ax, ay, f = 1, s = 1) {
    let F = FOOT[key]; if (F && F.alias) F = FOOT[F.alias];
    if (!F) return null;
    const sh = F.fp.map(q => {
      const g = q.s || q, k = q.k || F.k;
      if (g.length === 3) return { t: 1, cx: ax + g[0] * s * f, cy: ay + g[1] * s, cr: g[2] * s, k };
      const a = ax + g[0] * s * f, b = ax + g[2] * s * f;
      return { t: 0, x0: Math.min(a, b), y0: ay + g[1] * s, x1: Math.max(a, b), y1: ay + g[3] * s, k };
    });
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of sh) {
      const a = q.t ? [q.cx - q.cr, q.cy - q.cr, q.cx + q.cr, q.cy + q.cr] : [q.x0, q.y0, q.x1, q.y1];
      x0 = Math.min(x0, a[0]); y0 = Math.min(y0, a[1]); x1 = Math.max(x1, a[2]); y1 = Math.max(y1, a[3]);
    }
    return { key, k: F.k, sh, x0, y0, x1, y1, x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 };
  }
  const COLL = [], FOOT_BY = {}, NC = [];
  let CG = null, CMAX = 0; // сетка подножий (ленивая: пересборка после addFoot)
  function addFoot(key, x, y, o, extra) {
    const c = footShapes(key, x, y); if (!c) return null;
    c.o = o || null; if (extra) Object.assign(c, extra);
    COLL.push(c); CG = null; if (!FOOT_BY[key]) FOOT_BY[key] = c;
    return c;
  }
  addFoot('mi8', POI.cockpit.x, POI.cockpit.y); addFoot('tail', POI.tail.x, POI.tail.y);
  addFoot('chum', POI.chum.x, POI.chum.y); addFoot('labaz', POI.labaz.x, POI.labaz.y);
  addFoot('urkSled', POI.chum.x + 80, POI.chum.y + 120);
  for (const k of ['stove', 'bench', 'chest', 'bed']) addFoot(k, SPOT[k].x, SPOT[k].y);
  for (const q of INSPECT) if (FOOT[q.id]) addFoot(q.id, q.x, q.y, q);
  // транспорт на стоянке (верхом — не преграда): подножие по месту и face, пересчёт при сдвиге
  const VEH_FOOT = { deer: 'vDeer', buran: 'vBuran' }, VC = {};
  function vehFoot() {
    const out = [];
    if (!G || !G.veh) return out;
    for (const k in VEH_FOOT) {
      const v = G.veh[k]; if (!v || G.p.ride === k) continue;
      const f = (v.face || 1) < 0 ? -1 : 1, c = VC[k];
      if (!c || c.vx !== v.x || c.vy !== v.y || c.f !== f) { VC[k] = Object.assign(footShapes(VEH_FOOT[k], v.x, v.y, f), { vx: v.x, vy: v.y, f, o: v }); }
      out.push(VC[k]);
    }
    return out;
  }
  // глыба и ствол — те же подножия (глыба — FOOT.rock × q.s; ствол — круг)
  const RF = new WeakMap();
  function rockFoot(q) { let c = RF.get(q); if (!c) { c = footShapes('rock', q.x, q.y, 1, q.s); RF.set(q, c); } return c; }
  const trunkR = t => 4 + 8 * t.s;
  const nearHut = (r = TUNE.r.nearHut) => Math.hypot(G.p.x - HUT.x, G.p.y - (HUT.y - 30)) < r;
  const inCedar = (x, y) => Math.hypot(x - POI.cedar.x, y - POI.cedar.y) < POI.cedar.r;
  // тонкий лёд: у переката и в луже под костром на льду (js/ice.js weakAt)
  const onThinIce = o => Math.hypot(o.x - POI.polynya.x, o.y - POI.polynya.y) < POI.polynya.r - 20 || (typeof Ice !== 'undefined' && G && G.fires && G.fires.length > 0 && Ice.weakAt(o.x, o.y));

  // ---------- генерация ----------
  // Статичный мир — только из seed (r): деревья, стена, сугробы, трещины, кочки. В сейв не идёт (см. SaveGame).
  // Любая правка порядка вызовов r() или чисел здесь меняет лес под старыми сейвами → поднять GEN_V.
  // 2 — «Сибирь 2.0»: зоны (плотность и вид леса по зоне, глыбы курумника и гольца, поляны у объектов зон)
  const GEN_V = 2;
  const TREE_I = new WeakMap(); // дерево → индекс в G.trees (ссылки из задач людей и действий героя)
  // дрова в дереве: берёза и горелый сухостой — 2, ель и кедр — 3
  const wood0 = t => t.kind === 1 || t.kind === 3 ? 2 : 3;
  function gen(r) {
    Zones.build(G.seed);
    // поляны: сюжетные места и объекты зон — сеткой (быстрая проверка на большом мире)
    const clear = new Space.Grid(null, 0, 256);
    for (const [p, rr] of [[POI.hut, 240], [POI.cockpit, 250], [POI.tail, 220], [POI.chum, 230], [POI.mar, 310], [POI.labaz, 100]]) clear.add({ x: p.x, y: p.y, r: rr });
    for (const o of Zones.OBJS) if (o.clear) clear.add({ x: o.x, y: o.y, r: o.clear });
    for (const z of Zones.ACT) { const c = Zones.camp(z); clear.add({ x: c.x, y: c.y, r: 130 }); } // стоянка быстрого перехода
    const inClear = (x, y) => { for (const c of clear.near(x, y, 320)) if ((c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return true; return false; };
    const grid = new Space.Grid(null, 0, 64);
    const near = (x, y, m) => { for (const t of grid.near(x, y, m)) if ((t.x - x) ** 2 + (t.y - y) ** 2 < m * m) return true; return false; };
    let tries = 0;
    // деревьев — плотность тайги × площадь × средняя плотность зон (гарь, голец, курумник реже)
    const N = Math.round(WORLD.count('trees') * Zones.meanDens), TRIES = Math.round(WORLD.count('treeTries') * 1.6);
    while (G.trees.length < N && tries++ < TRIES) {
      const x = 90 + r() * (W - 180), y = 90 + r() * (H - 180);
      if (Math.abs(x - riverX(y)) < RW + 40) continue;
      const zt = Zones.treeAt(x, y);
      if (zt && r() > zt.dens) continue;
      if (inClear(x, y)) continue;
      const cedar = inCedar(x, y);
      if (near(x, y, cedar ? 40 : 46)) continue;
      const kind = cedar ? (r() < 0.85 ? 2 : 0) : zt ? zt.kind(r) : (r() < 0.15 ? 1 : 0);
      const t = { x: Math.round(x), y: Math.round(y), s: +(0.8 + r() * 0.6).toFixed(2), wood: 0, kind, v: (r() * 2) | 0, shake: 0 };
      t.wood = wood0(t);
      G.trees.push(t); grid.add(t);
    }
    // глыбы: курумник и голец (преграда для героя, рисуются по опоре)
    G.rocks = [];
    for (const z of Zones.ACT) if (z.rocks) {
      for (let n = 0, k = 0; n < z.rocks && k < z.rocks * 30; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * z.r, x = Math.round(z.x + Math.cos(a) * d), y = Math.round(z.y + Math.sin(a) * d);
        if (Zones.idAt(x, y) !== z.id || inClear(x, y) || near(x, y, 36) || G.rocks.some(q => (q.x - x) ** 2 + (q.y - y) ** 2 < 70 * 70)) continue;
        G.rocks.push({ x, y, s: +(0.7 + r() * 0.8).toFixed(2), v: (r() * 3) | 0 }); n++;
      }
    }
    // стена по краю мира: верх/низ — по ширине, лево/право — по высоте (при W = H — как раньше, тот же порядок r())
    // Разброс стены (размер, порода, вариант, тёмный/светлый рисунок, сдвиг внутрь/наружу, прогалы, подлесок, сухостой, второй ряд) —
    // из своего потока r2: основной r тратится ровно как прежде (сугробы, кочки, обереги под старыми сейвами на месте).
    // Край держит clamp в solid (герой не выйдет за 40 px), стена — только вид: прогал не открывает дыру.
    const r2 = mulberry((G.seed | 0) ^ 0x2F6B1D35), wg = new Space.Grid(null, 0, 64), WX = [];
    const IN = [[0, 1], [0, -1], [1, 0], [-1, 0]]; // нормаль внутрь мира: верх, низ, лево, право
    // соседи стены (ближе 70 px) — хотя бы 2 отличия из (ступень размера, порода+вариант, тёмный/светлый рисунок): tests/variety.js
    const wdiff = (a, b) => (Math.round(a.s / 0.15) !== Math.round(b.s / 0.15)) + (a.kind * 8 + a.v !== b.kind * 8 + b.v) + ((a.dk | 0) !== (b.dk | 0));
    const wallScore = t => { let m = 3; for (const o of wg.near(t.x, t.y, 70)) if ((o.x - t.x) ** 2 + (o.y - t.y) ** 2 < 70 * 70) m = Math.min(m, wdiff(o, t)); return m; };
    function wallTree(x, y, v0, ug, back, list) {
      let best = null, bs = -1;
      for (let k = 0; k < 32 && bs < 2; k++) {
        const zt = Zones.treeAt(x, y), q = r2();
        let kind = 0;
        if (!ug && !back) kind = zt && q < 0.4 ? zt.kind(r2) : q < 0.08 ? 3 : q < 0.13 ? 1 : 0; // сухостой-горельник, берёза, порода зоны
        else if (ug && q < 0.2) kind = 1;                                                      // подлесок: молодая берёзка
        if (kind === 3 && typeof ArtZones === 'undefined') kind = 0;
        const dk = kind === 0 && (back || r2() < 0.4) ? 1 : 0;
        const v = kind === 0 ? (k ? (r2() * (dk ? 4 : 3)) | 0 : v0 % (dk ? 4 : 3)) : (r2() * 2) | 0;
        const s = ug ? +(0.3 + r2() * 0.45).toFixed(2) : +(0.8 + r2() * 0.65).toFixed(2);
        const t = { x: Math.round(x), y: Math.round(y), s, wood: 3, kind, wall: 1, dk, v, shake: 0 }, sc = wallScore(t);
        if (sc > bs) { bs = sc; best = t; }
      }
      if (bs < 2) return; // тесно (углы мира, где сходятся две стороны) — лишнюю копию не ставим
      wg.add(best); list.push(best);
    }
    for (let v = 0; v <= Math.max(W, H); v += WORLD.wallStep) {
      const q = [[v + r() * 10, 16 + r() * 20, v <= W], [v + r() * 10, H - 6 - r() * 16, v <= W], [12 + r() * 20, v + r() * 10, v <= H], [W - 12 - r() * 20, v + r() * 10, v <= H]];
      q.forEach(([x, y, on], side) => {
        if (!on) return;
        const v0 = (r() * 2) | 0, [nx, ny] = IN[side], tx = ny ? 1 : 0, ty = nx ? 1 : 0; // (tx, ty) — вдоль края
        const d = -6 + r2() * 34, a = (r2() - 0.5) * 14, gap = r2() < 0.1;
        // основной ряд: прогал (≈10 %) — вместо ели куст подлеска
        if (!gap) wallTree(x + nx * d + tx * a, y + ny * d + ty * a, v0 + ((r2() * 3) | 0), 0, 0, G.trees);
        else wallTree(x + nx * (d + 6) + tx * a, y + ny * (d + 6) + ty * a, v0, 1, 0, WX);
        // второй ряд ближе к краю (тёмный) — закрывает прогалы от пустоты за миром
        if (r2() < 0.5) wallTree(x - nx * (8 + r2() * 8) + tx * (a + 22), y - ny * (8 + r2() * 8) + ty * (a + 22), v0 + 1, 0, 1, WX);
        // подлесок перед стеной: 0–2 молодых ёлки
        for (let n = r2() < 0.45 ? 1 + (r2() < 0.35) : 0; n > 0; n--) { const dd = d + 14 + r2() * 22, aa = a + (r2() - 0.5) * 40; wallTree(x + nx * dd + tx * aa, y + ny * dd + ty * aa, (r2() * 3) | 0, 1, 0, WX); }
      });
    }
    for (const t of WX) G.trees.push(t); // подлесок и второй ряд — после основного (индексы прежних деревьев в сейве те же)
    G.trees.forEach((t, i) => TREE_I.set(t, i));
    // сугробы; на накатанной колее зимника их нет (иначе зимник местами медленнее целины) — r() тратится как прежде
    const onTrail = d => [-d.rx, 0, d.rx].some(o => Zones.terrainKey(d.x + o, d.y) === 'trail');
    for (let i = 0, n = WORLD.count('drifts'); i < n; i++) {
      const d = { x: r() * W | 0, y: r() * H | 0, rx: 30 + r() * 90 | 0, ry: 8 + r() * 18 | 0 };
      // на колее — сдвигаем на обочину (число сугробов и поток r те же)
      for (let k = 0; k < 8 && onTrail(d); k++) d.x = (d.x + (d.x >= riverX(d.y) ? 1 : -1) * (d.rx + 24)) | 0;
      // на льду реки сугробов нет (выдувает) — на свой берег, гребнем за кромку (наддув у берега)
      const rv = d.x - riverX(d.y); if (Math.abs(rv) < RW + d.rx * 0.6) d.x = (riverX(d.y) + (rv >= 0 ? 1 : -1) * (RW + d.rx * 0.6)) | 0;
      G.drifts.push(d);
    }
    for (let i = 0, n = WORLD.count('cracks'); i < n; i++) G.cracks.push({ y: r() * H | 0, off: (r() - 0.5) * 110 | 0, len: 18 + r() * 50 | 0, a: +((r() - 0.5) * 1.2).toFixed(2) });
    // кочки — только на мари: их число от площади мари, а не мира
    // Кочки растут куртинами с пустотами (мочажины) между ними; у каждой — форма v (4), зеркало m, наклон rot, цвет травы c.
    // Место и вид — из r2 (поток r тратится как прежде); соседи ближе 26 px различаются хотя бы по 2 признакам (tests/variety.js).
    const M = POI.mar, MR = M.r, TAU = Math.PI * 2, CL = [], VOID = [];
    for (let i = 0; i < 16; i++) { const a = r2() * TAU, d = Math.sqrt(r2()) * MR * 0.85; CL.push([M.x + Math.cos(a) * d, M.y + Math.sin(a) * d, 16 + r2() * 38]); }
    for (let i = 0; i < 5; i++) { const a = r2() * TAU, d = Math.sqrt(r2()) * MR * 0.8; VOID.push([M.x + Math.cos(a) * d, M.y + Math.sin(a) * d, 45 + r2() * 50]); }
    const okAt = (x, y) => (x - M.x) ** 2 + (y - M.y) ** 2 < MR * MR && !VOID.some(([vx, vy, vr]) => (x - vx) ** 2 + (y - vy) ** 2 < vr * vr) && !G.tussocks.some(o => (o.x - x) ** 2 + (o.y - y) ** 2 < 100);
    const nb = (x, y) => G.tussocks.filter(o => (o.x - x) ** 2 + (o.y - y) ** 2 <= 27 * 27); // с запасом: соседи для проверки — «≤ 26 px» (координаты целые)
    const tdiff = (a, b) => (Math.round(a.s / 0.2) !== Math.round(b.s / 0.2)) + (a.v !== b.v) + (a.m !== b.m || Math.abs(a.rot - b.rot) > 0.15) + (a.c !== b.c);
    for (let i = 0; i < 260; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * MR, s0 = r();
      let x = M.x + Math.cos(a) * d, y = M.y + Math.sin(a) * d;
      for (let k = 0; k < 8; k++) {
        let px, py;
        if (r2() < 0.8) { const c = CL[(r2() * CL.length) | 0]; px = c[0] + (r2() + r2() + r2() - 1.5) * c[2]; py = c[1] + (r2() + r2() + r2() - 1.5) * c[2] * 0.7; }
        else { const a2 = r2() * TAU, d2 = Math.sqrt(r2()) * MR; px = M.x + Math.cos(a2) * d2; py = M.y + Math.sin(a2) * d2; }
        if (okAt(px, py)) { x = px; y = py; break; }
      }
      x |= 0; y |= 0;
      const near = nb(x, y);
      // до 40 проб вида; не нашлось отличного от всех соседей хотя бы по 2 признакам — лучший из проб (самый непохожий)
      let t = null, best = -1;
      for (let k = 0; k < 40 && best < 2; k++) {
        const c = { x, y, s: +(0.5 + (k ? r2() : s0) * 0.95).toFixed(2), v: (r2() * 4) | 0, m: r2() < 0.5 ? -1 : 1, rot: +((r2() - 0.5) * 0.5).toFixed(2), c: (r2() * 4) | 0 };
        let q = 9; for (const o of near) q = Math.min(q, tdiff(o, c));
        if (q > best) { best = q; t = c; }
      }
      G.tussocks.push(t);
    }
  }
  // живое из seed: обереги, стадо деда, вороны (после gen — тот же поток r)
  function genLiving(r) {
    // сэвэки — TUNE.world.amulets деревянных оберегов по тайге; разнос растёт с линейным размером мира.
    // Лимит попыток: если разнос не влезает — ослабляем его, а не крутимся вечно.
    G.amuletsAt = [];
    let gap = TUNE.r.amuletGap * Math.sqrt(WORLD.area);
    for (let tries = 0; G.amuletsAt.length < TUNE.world.amulets; tries++) {
      if (tries > 0 && tries % 4000 === 0) gap *= 0.8;
      const x = 200 + r() * (W - 400), y = 200 + r() * (H - 400);
      if (Math.abs(x - riverX(y)) < RW + 30 || Math.hypot(x - HUT.x, y - HUT.y) < 300) continue;
      if (G.amuletsAt.some(a => Math.hypot(a.x - x, a.y - y) < gap)) continue;
      G.amuletsAt.push({ x: x | 0, y: y | 0, got: 0 });
    }
    // оленье стадо Уркачана
    G.deer = [];
    for (let i = 0; i < TUNE.world.deer; i++) G.deer.push({ x: POI.chum.x + 150 + r() * 200, y: POI.chum.y + r() * 200 - 60, vx: 0, vy: 0, t: r() * 3, face: r() < 0.5 ? -1 : 1, ph: r() * 6 });
    // стадо стойбища: пасётся у своего якоря (hx, hy)
    const st = ZONES.stoibishe;
    if (st.active) for (let i = 0; i < 7; i++) { const hx = st.x + st.deer[0], hy = st.y + st.deer[1]; G.deer.push({ x: hx + r() * 220 - 110, y: hy + r() * 160 - 80, vx: 0, vy: 0, t: r() * 3, face: r() < 0.5 ? -1 : 1, ph: r() * 6, hx, hy }); }
    // вороны на верхушках
    G.ravens = [];
    for (let i = 0, n = WORLD.count('ravens'); i < n; i++) G.ravens.push({ x: 0, y: 0, fly: 0, t: r() * 20, vx: 0, vy: 0, z: 0 });
    for (const rv of G.ravens) Fauna.perchRaven(rv);
  }
  function buildGrid() {
    for (const k of ['trees', 'drifts', 'tussocks', 'rocks']) { Space[k].clear(); for (const o of G[k] || []) Space[k].add(o); }
    SHAKING.clear(); for (const t of G.trees) if (t.shake > 0) SHAKING.add(t);
    REGROW.clear(); for (const t of G.trees) if (t.cutAt != null) REGROW.add(t);
  }
  // дрожь дерева от удара: обновляем только дрожащие, а не весь лес каждый кадр
  const SHAKING = new Set();
  function shakeTree(t, v) { t.shake = v; SHAKING.add(t); }
  function tickTrees(dt) { for (const t of SHAKING) { t.shake -= dt; if (t.shake <= 0) { t.shake = 0; SHAKING.delete(t); } } }

  // ---------- отрастание леса: пень → молодое деревце (меньше дров) → взрослое дерево ----------
  // Только срубленные деревья (wood ≤ 0) отслеживаются — REGROW маленький и не идёт по всему лесу.
  // Не отрастает под постройками посёлка и на тропе у избы (canRegrow) — попытка просто откладывается.
  const REGROW = new Set();
  function canRegrow(x, y) {
    if (Math.abs(x - HUT.x) < 260 && Math.abs(y - HUT.y) < 220) return false; // изба и тропа перед ней
    if (G.col) for (const b of G.col.builds) { const B = BUILDS[b.type]; if (Math.abs(x - b.x) < B.w / 2 + 20 && Math.abs(y - b.y) < B.h / 2 + 20) return false; }
    return true;
  }
  // дерево срублено «в ноль» — пуск отсчёта до молодого деревца (снова, если рубили повторно)
  function felled(t) {
    t.stage = 0; t.cutAt = G.time; REGROW.add(t);
  }
  function tickRegrow(dt) {
    if (!REGROW.size) return;
    const R = TUNE.world;
    for (const t of REGROW) {
      if (t.cutAt == null) { REGROW.delete(t); continue; }
      if (!canRegrow(t.x, t.y)) continue; // постройка/тропа у избы — ждём, пока освободится
      const age = G.time - t.cutAt;
      if (!t.stage) {
        if (age >= R.regrowStumpDays * CYCLE) { t.stage = 1; t.wood = R.regrowYoungWood; t.cutAt = G.time; }
      } else if (t.stage === 1) {
        if (age >= R.regrowYoungDays * CYCLE) { t.stage = 0; t.wood = wood0(t); delete t.cutAt; REGROW.delete(t); }
      }
    }
  }
  // ---------- тайники в поле: до TUNE.world.stashMax штук, хранятся в G.stashes (сейв — как есть) ----------
  function nearestStash(p, r) {
    let best = null, bd = r * r;
    for (const s of G.stashes || []) { const d = dist2(s, p); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  // шатун/волки разоряют тайник с едой — раз за «ночь» на тайник, шанс как у налёта на склад
  function tickStashRaids(dt, night) {
    if (!G.stashes || !G.stashes.length || night < 0.6) return;
    const h = hourOf(), nk = h < 12 ? G.day - 1 : G.day;
    const predators = [];
    if (G.bear && G.bear.st !== 'gone') predators.push(G.bear);
    for (const w of G.wolves) if (w.st !== 'retreat') predators.push(w);
    if (!predators.length) return;
    const R = TUNE.world.stashRaidR;
    for (const s of G.stashes) {
      if (s.raidNight === nk) continue;
      if (!FOOD_KEYS.some(k => (s.inv[k] || 0) > 0)) continue;
      if (!predators.some(pr => dist2(pr, s) < R * R)) continue;
      s.raidNight = nk;
      if (Math.random() < TUNE.world.stashRaidP) {
        let n = 0; for (const k of FOOD_KEYS) while (n < 2 && (s.inv[k] || 0) > 0) { s.inv[k]--; n++; }
        if (n) { Fx.toast(':cache: Тайник разорён — унесли еду'); Fx.burst(s.x, s.y - 6, 10, '#c0392b'); Sound.src(s).growl(0.2); }
      }
    }
  }

  // ---------- столкновения ----------
  // CONTACT — последний упор (перезаписывает каждый solid): k — что за препятствие, o — объект, nx/ny — нормаль выталкивания.
  // Читает герой сразу после своего вызова; остальным не мешает.
  const CONTACT = { k: null, o: null, nx: 0, ny: 0 }, NB = [];
  function pushRect(o, r, x0, x1, y0, y1) {
    const qx = clamp(o.x, x0, x1), qy = clamp(o.y, y0, y1), dx = o.x - qx, dy = o.y - qy, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 1e-4) { const d = Math.sqrt(d2); o.x = qx + dx / d * r; o.y = qy + dy / d * r; return true; }
    const l = o.x - x0, rr = x1 - o.x, t = o.y - y0, b = y1 - o.y, m = Math.min(l, rr, t, b);
    if (m === l) o.x = x0 - r; else if (m === rr) o.x = x1 + r; else if (m === t) o.y = y0 - r; else o.y = y1 + r;
    return true;
  }
  function pushCircle(o, r, cx, cy, cr) {
    const dx = o.x - cx, dy = o.y - cy, d2 = dx * dx + dy * dy, m = r + cr;
    if (d2 < m * m && d2 > 1e-4) { const d = Math.sqrt(d2); o.x = cx + dx / d * m; o.y = cy + dy / d * m; return true; }
    return false;
  }
  const touch = (k, o) => { CONTACT.k = k; CONTACT.o = o; };
  // сваленный ствол героя (G.logs, пока не разделан): отрезок комель → оставшийся конец (вид 3/4: y ×0.6), толщина — как у картинки
  // (как рисует GFX drawFelled: полуширина 4.2·s у комля → 1.6·s у вершины); разделка укорачивает преграду вместе со стволом
  function pushLog(o, r, L) {
    const s = L.s || 1, k = Actions.logK(L), ex = L.x + Math.cos(L.a) * L.len * k, ey = L.y + Math.sin(L.a) * L.len * 0.6 * k;
    const R = 4.2 * s + r + 2; // рамка — быстрый отсев
    if (o.x < Math.min(L.x, ex) - R || o.x > Math.max(L.x, ex) + R || o.y < Math.min(L.y, ey) - R || o.y > Math.max(L.y, ey) + R) return false;
    const vx = ex - L.x, vy = ey - L.y, u = clamp(((o.x - L.x) * vx + (o.y - L.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    return pushCircle(o, r, L.x + vx * u, L.y + vy * u, (4.2 + (1.6 - 4.2) * u * k) * s);
  }
  // высота ствола над снегом у тела, см: диаметр в ближайшей точке (вид 3/4 — как pushLog), заметённый — ниже
  function logH(L, o) {
    const s = L.s || 1, k = Actions.logK(L), ex = L.x + Math.cos(L.a) * L.len * k, ey = L.y + Math.sin(L.a) * L.len * 0.6 * k, vx = ex - L.x, vy = ey - L.y;
    const u = clamp(((o.x - L.x) * vx + (o.y - L.y) * vy) / (vx * vx + vy * vy || 1), 0, 1), rad = (4.2 + (1.6 - 4.2) * u * k) * s;
    const bury = Actions.logSnow ? Actions.logSnow(L) : 0;
    return 2 * rad / 0.23 * (1 - 0.7 * bury);
  }
  // тело над стволом (перелезает): ближе к оси, чем радиус ствола + своего тела
  function onLog(o, r, L) {
    const s = L.s || 1, k = Actions.logK(L), ex = L.x + Math.cos(L.a) * L.len * k, ey = L.y + Math.sin(L.a) * L.len * 0.6 * k, vx = ex - L.x, vy = ey - L.y;
    if (o.x < Math.min(L.x, ex) - 30 || o.x > Math.max(L.x, ex) + 30 || o.y < Math.min(L.y, ey) - 30 || o.y > Math.max(L.y, ey) + 30) return false;
    const u = clamp(((o.x - L.x) * vx + (o.y - L.y) * vy) / (vx * vx + vy * vy || 1), 0, 1), px = L.x + vx * u - o.x, py = L.y + vy * u - o.y, rad = (4.2 + (1.6 - 4.2) * u * k) * s + r * 0.7;
    return px * px + py * py < rad * rad;
  }
  // ---------- среда под ИИ-телом (World.solid, не герой): ствол поперёк, тонкий лёд, голый лёд ----------
  // m — масса, кг (тонкий лёд ломается раньше под тяжёлым: время ×(80/m)^0.7, легче 20 кг — держит); grip — сцепление на голом льду, 1/с
  // (герой — iceGrip 2.2); ice — осторожность на голом льду (копыта); over — ход через ствол; jump — выше какого ствола перешагивает, см
  const BK = {
    n: { m: 80, grip: 4 }, dog: { m: 25, grip: 3.5, over: 0.7, jump: 55 }, wolf: { m: 40, grip: 3, over: 0.8, jump: 100 },
    deer: { m: 120, grip: 1.6, ice: 0.75, over: 0.65, jump: 110 }, hare: { m: 3, grip: 3.5, over: 0.85, jump: 60 }, bear: { m: 250, grip: 2.5, over: 0.45, jump: 75 },
  };
  const bodyKind = (o, who, r) => who === 'a' ? (r <= 6 ? 'hare' : 'deer') : who === 'w' ? 'wolf' : who === 'b' ? 'bear' : who === 'u' ? (o.type === 'laika' ? 'dog' : 'n') : 'n';
  // память шага — рантайм (WeakMap, в сейв не идёт); dt — по G.time: повторные solid в том же кадре (crowd) не считаются
  const ENV = new WeakMap();
  function env(o, who, r) {
    const kind = bodyKind(o, who, r), K = BK[kind];
    let s = ENV.get(o); if (!s) { ENV.set(o, { x: o.x, y: o.y, t: G.time, vx: 0, vy: 0, thin: 0, cr: 0, safe: 0, ix: o.x, iy: o.y }); return; }
    const dt = G.time - s.t; if (dt <= 0) return; s.t = G.time; s.dt = dt; s.px = s.x; s.py = s.y;
    const dx = o.x - s.x, dy = o.y - s.y;
    if (dx * dx + dy * dy > 90 * 90 || dt > 1 || Math.abs(o.x - G.p.x) + Math.abs(o.y - G.p.y) > 1600) { s.vx = s.vy = 0; s.thin = 0; return; } // телепорт / далеко — не считаем
    let m = 1;
    if (K.over && G.logs && G.logs.length) for (const L of G.logs) if (L.n > 0 && onLog(o, r, L)) { m = K.over; o.hop = G.time; break; } // перелезает через ствол
    // тонкий лёд: идёт осторожно; тяжёлый — трещит и проваливается (шатун — сразу, js/bear.js), выбирается назад мокрым
    s.safe = Math.max(0, s.safe - dt);
    const thin = kind !== 'bear' && onThinIce(o);
    if (thin && !(s.safe > 0)) {
      m *= 0.6; s.thin += dt;
      const I = TUNE.ice, sc = Math.pow(80 / K.m, 0.7);
      if (K.m >= 20 && s.thin > I.creakT * sc && !s.cr) { s.cr = 1; if (Math.abs(o.x - G.p.x) + Math.abs(o.y - G.p.y) < 900 && typeof Sound !== 'undefined' && Sound.src) Sound.src(o).creak(); }
      if (K.m >= 20 && s.thin > I.breakT * sc) {
        const h = Ice.fallBody(o, kind, s.ix, s.iy); s.thin = 0; s.cr = 0; s.safe = 6; s.vx = s.vy = 0; s.x = o.x; s.y = o.y;
        if (kind === 'wolf' && o.st) { o.st = 'retreat'; o.vx = o.vy = 0; }        // мокрый волк уходит
        else if (kind === 'deer') { const a = Math.atan2(o.y - h.y, o.x - h.x); o.vx = Math.cos(a) * 150; o.vy = Math.sin(a) * 150; o.t = 1.2; } // олень — прочь от дыры
        else { if (o.hp != null) o.hp -= 4; if (Math.abs(o.x - G.p.x) + Math.abs(o.y - G.p.y) < 700) Fx.toast(':frost: Провалился под лёд у переката — выбрался мокрым'); }
        return;
      }
    } else { s.thin = Math.max(0, s.thin - dt * 2); if (!s.thin) s.cr = 0; if (!thin) { s.ix = s.x; s.iy = s.y; } }
    // голый лёд: тело несёт по инерции (разгон и торможение — по сцеплению вида), копыта — осторожнее; на снегу — сразу
    let wx = dx * m / dt, wy = dy * m / dt;
    if (Depth.bareIce(o.x, o.y) || Depth.bareIce(s.x, s.y)) {
      if (K.ice) { wx *= K.ice; wy *= K.ice; }
      const e = 1 - Math.exp(-dt * K.grip); s.vx += (wx - s.vx) * e; s.vy += (wy - s.vy) * e;
    } else { s.vx = wx; s.vy = wy; }
    o.x = s.x + s.vx * dt; o.y = s.y + s.vy * dt;
  }
  // конец шага: где тело встало (после упоров); упёрлось — скорость по факту
  function envEnd(o, hit) { const s = ENV.get(o); if (!s) return; if (hit && s.t === G.time && s.dt > 0) { s.vx = (o.x - s.px) / s.dt; s.vy = (o.y - s.py) / s.dt; } s.x = o.x; s.y = o.y; }
  // фигуры подножия c → выталкивание (рамка c — быстрый отсев)
  function pushFoot(o, r, c) {
    if (o.x + r < c.x0 || o.x - r > c.x1 || o.y + r < c.y0 || o.y - r > c.y1) return false;
    let hit = false;
    for (const q of c.sh) if (q.t ? pushCircle(o, r, q.cx, q.cy, q.cr) : pushRect(o, r, q.x0, q.x1, q.y0, q.y1)) { hit = true; touch(q.k, c.o || c); }
    return hit;
  }
  // все преграды одним проходом: стволы, глыбы, изба, подножия вещей, транспорт, постройки посёлка
  // who: 'p' — герой, 'n' — человек (NPC, Вера) — оба проходят в дверь; 'u' — посёлок, 'w' — волк, 'b' — медведь, 'a' — олень/заяц
  function pushAll(o, r, who) {
    NB.length = 0; for (const t of treesNear(o.x, o.y, 40, NB)) if (t.wood > 0 && pushCircle(o, r, t.x, t.y, trunkR(t))) touch('tree', t);
    NB.length = 0; for (const q of Space.rocks.near(o.x, o.y, 50, NB)) if (pushFoot(o, r, rockFoot(q))) touch('rock', q);
    const bk = who === 'p' || who === 'n' ? null : BK[bodyKind(o, who, r)]; // зверь: через лежачий ствол перешагивает/перепрыгивает (ниже своего прыжка)
    if (G.logs) for (const L of G.logs) if (L.n > 0 && !(L.f && !L.f.hit) && !(bk && bk.jump && logH(L, o) < bk.jump) && pushLog(o, r, L)) touch('log', L);   // падающий ствол — преграда только после удара о землю
    // открытая вода (перекат, дыры) — ИИ обходит; герой в неё проваливается (thinIce)
    if (who !== 'p' && typeof Ice !== 'undefined' && Ice.pushWater(o, r)) touch('water', null);
    // горящий костёр: тела держатся от огня (keepR), герой — упор и ожог при шаге в огонь; World.blocked (q — не герой) огонь не видит
    if (G.fires.length && (who !== 'p' || o === G.p)) for (const f of G.fires) if (f.fuel > 0 && Math.abs(o.x - f.x) < 80 && Math.abs(o.y - f.y) < 80 && pushCircle(o, r, f.x, f.y, Fire.keepR(o, who, r))) { touch('fire', f); if (o === G.p) Fire.burnHero(f); }
    if (Math.abs(o.x - HUT.x) < 180 && Math.abs(o.y - HUT.y) < 160) {
      for (const R of HUT_WALLS) if (pushRect(o, r, R.x0, R.x1, R.y0, R.y1)) touch('wall', null);
      if (who !== 'p' && who !== 'n' && G.hut.door) pushRect(o, r, DOOR_RECT.x0, DOOR_RECT.x1, DOOR_RECT.y0, DOOR_RECT.y1);
    }
    if (!CG) { CG = new Space.Grid(null, 0, 256); CMAX = 0; for (const c of COLL) { CG.add(c); CMAX = Math.max(CMAX, (c.x1 - c.x0) / 2, (c.y1 - c.y0) / 2); } }
    NC.length = 0;
    for (const c of CG.near(o.x, o.y, r + CMAX, NC)) {
      if (c.o && c.o.need && !Zones.here(c.o)) continue;
      if (c.key === 'bed' && o === G.p) { bedPush(o, r, c); continue; }
      pushFoot(o, r, c);
    }
    if (G.veh) for (const c of vehFoot()) pushFoot(o, r, c);
    if (G.col) { NB.length = 0; for (const b of Space.builds.near(o.x, o.y, r + 60, NB)) if (b.done && !BUILDS[b.type].flat) { const B = BUILDS[b.type]; if (Math.abs(o.x - b.x) < B.w / 2 + r + 2 && Math.abs(o.y - b.y) < B.h / 2 + r + 2 && pushRect(o, r, b.x - B.w / 2, b.x + B.w / 2, b.y - B.h / 2, b.y + B.h / 2)) touch('build', b); } }
  }
  // лежанка для героя: ложится/спит/встаёт (и идёт к ней автопилотом) — не преграда; сошёл с неё — шагом (≤ 3 px за кадр), не рывком
  const heroOnBed = p => p.sleeping || p.ko || (p.action && (p.action.k === 'lie' || p.action.k === 'getUp')) || (typeof input !== 'undefined' && input.auto);
  function bedPush(o, r, c) {
    if (heroOnBed(o)) return;
    const x0 = o.x, y0 = o.y; if (!pushFoot(o, r, c)) return;
    const dx = o.x - x0, dy = o.y - y0, d = Math.hypot(dx, dy);
    if (d > 12) { o.x = x0 + dx / d * 3; o.y = y0 + dy / d * 3; }
  }
  // обход для ИИ: упёрся — шаг вдоль преграды (в ту сторону, куда шёл; лоб в лоб — своя сторона на ходока), чтобы не встать у ствола
  const LAST = new WeakMap();
  function solid(o, r, who) {
    if (o !== G.p && typeof Depth !== 'undefined') { Depth.drag(o, who, r); if (typeof Ice !== 'undefined') env(o, who, r); } // в снегу по брюхо/пояс — шаг короче (js/depth.js); ствол, тонкий и голый лёд
    const x0 = o.x, y0 = o.y; CONTACT.k = CONTACT.o = null;
    pushAll(o, r, who);
    if (CONTACT.k) { const k = CONTACT.k, ob = CONTACT.o; pushAll(o, r, who); CONTACT.k = k; CONTACT.o = ob; } // вытолкнуло в соседнюю вещь (два ствола рядом) — ещё проход
    if (o !== G.p && CONTACT.k) {
      const nx = o.x - x0, ny = o.y - y0, d = Math.hypot(nx, ny);
      if (d > 1e-3) {
        let L = LAST.get(o); if (!L) { L = { x: x0, y: y0, side: Math.random() < 0.5 ? 1 : -1 }; LAST.set(o, L); }
        const mx = x0 - L.x, my = y0 - L.y, tx = -ny / d, ty = nx / d, dot = tx * mx + ty * my;
        if (Math.abs(dot) > 0.15 * Math.hypot(mx, my) + 1e-3) L.side = dot > 0 ? 1 : -1;
        o.x += tx * d * L.side; o.y += ty * d * L.side;
        const k = CONTACT.k, ob = CONTACT.o; pushAll(o, r, who); if (!CONTACT.k) { CONTACT.k = k; CONTACT.o = ob; }
      }
    }
    if (o !== G.p) { const L = LAST.get(o); if (L) { L.x = o.x; L.y = o.y; } else LAST.set(o, { x: o.x, y: o.y, side: Math.random() < 0.5 ? 1 : -1 }); }
    const cx = o.x, cy = o.y; o.x = clamp(o.x, 40, W - 40); o.y = clamp(o.y, 50, H - 40);
    if ((cx !== o.x || cy !== o.y) && !CONTACT.k) touch('edge', null);
    if (CONTACT.k) { const dx = o.x - x0, dy = o.y - y0, d = Math.hypot(dx, dy); if (d > 1e-4) { CONTACT.nx = dx / d; CONTACT.ny = dy / d; } else CONTACT.k = null; }
    if (o !== G.p) { envEnd(o, !!CONTACT.k); if (typeof Depth !== 'undefined' && Depth.settle) Depth.settle(o); }
    return CONTACT.k ? CONTACT : null;
  }
  // точка внутри подножия/ствола/стены? (цель ходока, проверки)
  function blocked(x, y, r = 0) { const q = { x, y }; pushAll(q, Math.max(0.5, r), 'p'); return q.x !== x || q.y !== y; }
  // ближайшая свободная точка к (x, y) для тела r (цель внутри вещи — идём к её краю)
  function freeNear(x, y, r) { const q = { x, y }; for (let i = 0; i < 3; i++) pushAll(q, r, 'n'); return q; }

  // ---------- ходьба ИИ: к точке с обходом (Nav), упором (solid) и шагом в сторону, если встал ----------
  // Цель внутри вещи — идём к её краю. Возвращает остаток пути (0 — дошёл или стоит вплотную у цели и дальше не пройти).
  const STK = new WeakMap();
  function walk(u, tx, ty, sp, dt, r = 9, who = 'n') {
    const T = freeNear(tx, ty, r), D = Math.hypot(T.x - u.x, T.y - u.y);
    if (D < 1) return D;
    let s = STK.get(u); if (!s) { s = { t: 0, moved: 0, side: 0, sideT: 0 }; STK.set(u, s); }
    const q = D > 40 ? Nav.way(u, T.x, T.y) : T, fin = q === T || (q.x === T.x && q.y === T.y);
    let dx = q.x - u.x, dy = q.y - u.y; const dq = Math.hypot(dx, dy) || 1; dx /= dq; dy /= dq;
    if (D > 70 && fin && !(s.sideT > 0) && typeof Depth !== 'undefined') { const v = Depth.steer(u, dx, dy, who === 'u' && u.type === 'laika' ? 'dog' : 'n'); if (v) { dx = v.x; dy = v.y; } } // по натоптанному, в обход глубокого
    if (s.sideT > 0) { s.sideT -= dt; const sx = -dy * s.side, sy = dx * s.side; dx = dx * 0.3 + sx; dy = dy * 0.3 + sy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
    const st = Math.min(sp * dt, fin ? D : dq), x0 = u.x, y0 = u.y;
    u.x += dx * st; u.y += dy * st; solid(u, r, who);
    if (Math.abs(dx) > 0.1) u.face = Math.sign(dx);
    s.t += dt; s.moved += Math.hypot(u.x - x0, u.y - y0);
    const rest = Math.hypot(T.x - u.x, T.y - u.y);
    if (s.t > 0.8) {
      const stuck = s.moved < sp * 0.12;
      s.t = 0; s.moved = 0;
      if (stuck && rest < 40) { s.near = (s.near || 0) + 1; if (s.near >= 2) { s.near = 0; return 0; } } // встал вплотную (у цели человек/вещь) — считаем, что дошёл
      else s.near = 0;
      if (stuck && !(s.sideT > 0)) { s.sideT = 0.7; s.side = Math.random() < 0.5 ? 1 : -1; }
    }
    return rest;
  }

  // ---------- тела расталкиваются: r1 + r2; герой сквозь людей и зверей не проходит ----------
  // Мягко (доля за кадр) между всеми, жёстко — с героем; доля сдвига — по массе. После сдвига — упор в вещи.
  const BODY = [], PIN = new Set(), MOVED = new Set();
  function crowd(dt) {
    const p = G.p, B = BODY; B.length = 0;
    const near = o => Math.abs(o.x - p.x) < 900 && Math.abs(o.y - p.y) < 700;
    const add = (o, r, m, who) => { if (o && near(o)) B.push(o, r, m, who); };
    if (!p.sleeping) add(p, p.ride ? 16 : 10, p.ride ? 3 : 1, 'p');
    for (const n of Npc.list()) {
      const st = n.st; if (!st || st.x == null) continue;
      if ((n.id === 'urk' && st.state === 'away') || (n.id === 'vera' && st.state === 'dead')) continue;
      if (Math.abs(st.x - SPOT.veraBed.x) < 4 && Math.abs(st.y - SPOT.veraBed.y) < 4) continue; // лежит на своём месте в избе — не толкается
      add(st, 9, 1.2, 'n');
    }
    if (G.col) for (const u of G.col.units) if (!u.hidden) add(u, u.type === 'laika' ? 6 : 7, 1, 'u');
    for (const w of G.wolves) add(w, 12, 1, 'w');
    if (G.bear) add(G.bear, 18, 4, 'b');
    for (const d of G.deer || []) add(d, 12, 2, 'a');
    for (const h of G.hares) add(h, 5, 0.3, 'a');
    const n = B.length, soft = Math.min(1, dt * 8);
    // проходы 2–4: тело, которое упор (ствол, стена, край мира) вернул назад, — неподвижно; сдвигается второе
    // (герой между медведем и стволом; герой у края мира, волк между ним и медведем — цепочка из трёх тел)
    PIN.clear();
    for (let pass = 0; pass < 4; pass++) {
      MOVED.clear();
      for (let i = 0; i < n; i += 4) for (let j = i + 4; j < n; j += 4) {
        const a = B[i], b = B[j], rr = B[i + 1] + B[j + 1];
        let dx = b.x - a.x, dy = b.y - a.y; if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy; if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2); if (d < 1e-3) { const an = (i * 7 + j * 13) % 628 / 100; dx = Math.cos(an); dy = Math.sin(an); d = 1; } else { dx /= d; dy /= d; }
        const pa = PIN.has(i), pb = PIN.has(j); if (pass && pa && pb) continue;
        const k = (a === p || b === p ? 1 : soft) * (rr - d), ma = B[i + 2], mb = B[j + 2];
        const sa = pa ? 0 : pb ? 1 : mb / (ma + mb), sb = 1 - sa;
        a.x -= dx * k * sa; a.y -= dy * k * sa; b.x += dx * k * sb; b.y += dy * k * sb;
        if (sa) MOVED.add(i); if (sb) MOVED.add(j);
      }
      if (typeof Depth !== 'undefined') Depth.hold = 1;
      for (const i of MOVED) if (solid(B[i], B[i + 1], B[i + 3])) PIN.add(i);
      if (typeof Depth !== 'undefined') Depth.hold = 0;
      if (!PIN.size) break;
    }
  }

  // ---------- туман войны и открытие мест ----------
  function reveal() {
    const p = G.p, r = (daylight() > 0.5 ? TUNE.r.viewDay : TUNE.r.viewNight) * Zones.rule('view'), c = FOG.cell;
    const c0 = Math.max(0, ((p.x - r) / c) | 0), c1 = Math.min(FOG.nx - 1, ((p.x + r) / c) | 0);
    const r0 = Math.max(0, ((p.y - r) / c) | 0), r1 = Math.min(FOG.ny - 1, ((p.y + r) / c) | 0);
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++)
      if ((i * c + c / 2 - p.x) ** 2 + (j * c + c / 2 - p.y) ** 2 < r * r && !G.fog[j * FOG.nx + i]) G.fog[j * FOG.nx + i] = 1;
    for (const k in POI) if (!G.known[k] && Math.hypot(POI[k].x - p.x, POI[k].y - p.y) < POI[k].r + 160) {
      G.known[k] = 1; UI.zone(POI[k]);
    }
  }
  function tickFog(dt) { G.fogT = (G.fogT || 0) - dt; if (G.fogT <= 0) { G.fogT = TUNE.engine.fogT; reveal(); } }

  // ---------- опасности места: тонкий лёд у переката ----------
  // провал — эпизод Ice (js/ice.js): на месте, без телепорта; после вылаза — 5 с «форы» (отползает), открытая дыра — не пройти
  // верхом: «Буран» (~350 кг с седоком) ломает быстрее всех, упряжка (~300 кг) — тоже; олени сами на тонкий лёд не идут (Transport.moved)
  const RIDE_K = { buran: 0.35, deer: 0.55 };
  function thinIce(dt) {
    const p = G.p, I = TUNE.ice, ice = typeof Ice !== 'undefined';
    if (ice) { Ice.tick(dt); if (Ice.active()) return; }
    if (!onThinIce(p)) { p.iceInX = p.x; p.iceInY = p.y; } // откуда пришёл на тонкий лёд — туда и выползать
    if ((onThinIce(p) || (p.ride && ice && Ice.inWater(p.x, p.y))) && !(p.iceSafe > 0)) {
      p.iceT += dt / (RIDE_K[p.ride] || 1);
      if (p.iceT > I.creakT && !p.creaked) { p.creaked = 1; Sound.creak(); Fx.shake(3); Fx.toast(p.ride === 'buran' ? ':frost: Лёд трещит под «Бураном»!' : ':frost: Лёд трещит!'); if (typeof Hero !== 'undefined' && !p.ride) Hero.play('flinch', { react: 1 }); }
      if (ice && (p.iceT > I.breakT || Ice.inWater(p.x, p.y))) { const v = p.ride ? rideSink(p) : null; Ice.start(p); if (v) Fx.toast(v); return; } // шагнул в открытую воду — сразу
      if (p.iceT > I.breakT) {
        p.iceT = 0; p.creaked = 0; G.s.warm = Math.min(G.s.warm, I.warm); p.wetT = I.wetT; p.action = null;
        p.x = POI.polynya.x - 140; Hero.snap(); Sound.splash(); Fx.shake(10); Fx.toast(':frost: Провалился! Сушись у огня');
        Fx.burst(POI.polynya.x, POI.polynya.y, 20, '#9fd0ee', 160);
      }
    } else { p.iceT = Math.max(0, p.iceT - dt * 2); if (p.iceT === 0) p.creaked = 0; }
  }
  // провал верхом: герой — в воду (эпизод Ice), транспорт — у кромки, откуда въехал (в 40 px дальше от дыры)
  // «Буран» провалился передком: мотор залит — чинить и заправлять заново; олени рванули назад и вытащили нарты
  function rideSink(p) {
    const k = p.ride, v = G.veh[k]; p.ride = null; if (!v) return null;
    let ex = (p.iceInX != null ? p.iceInX : p.x - 80) - p.x, ey = (p.iceInY != null ? p.iceInY : p.y) - p.y; const l = Math.hypot(ex, ey) || 1;
    v.x = p.x + ex / l * (l + 40); v.y = p.y + ey / l * (l + 40); v.face = ex < 0 ? -1 : 1;
    if (k === 'buran') { v.fixed = 0; v.fuel = 0; return ':sled: «Буран» провалился передком — мотор залит, нужна починка'; }
    return ':deer: Олени рванули назад и вытащили нарты на крепкий лёд';
  }

  return { walk, crowd, FOG, COLL, FOOT_BY, footShapes, addFoot, vehFoot, rockFoot, trunkR, blocked, freeNear, GEN_V, TREE_I, wood0, nearHut, inCedar, onThinIce, gen, genLiving, buildGrid, shakeTree, tickTrees,
    solid, reveal, tickFog, thinIce, felled, tickRegrow, nearestStash, tickStashRaids };
})();

// зоны мира (карта зон, правила, опасности) — js/zones.js

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
    const lg = G.logs ? G.logs.filter(L => L.n > 0) : [];
    const k = (G.hut.door ? 'd' : '') + '|' + lg.map(L => L.id + ':' + L.n).join(',') + '|' + World.COLL.filter(c => c.o && c.o.need && !Zones.here(c.o)).length + '|' + (G.col ? G.col.builds.filter(b => b.done && !BUILDS[b.type].flat).map(b => b.id).join(',') : '');
    if (k === key && lastG === G) return;
    key = k; lastG = G; ver++; blk.fill(0);
    for (const R of HUT_WALLS) stampRect(R.x0, R.y0, R.x1, R.y1, 7);
    if (G.hut.door) stampRect(DOOR_RECT.x0, DOOR_RECT.y0, DOOR_RECT.x1, DOOR_RECT.y1, 7);
    for (const c of World.COLL) if (!(c.o && c.o.need && !Zones.here(c.o))) for (const q of c.sh) { if (q.t) stampCircle(q.cx, q.cy, q.cr + 8); else stampRect(q.x0, q.y0, q.x1, q.y1, 8); }
    if (G.col) for (const b of G.col.builds) if (b.done && !BUILDS[b.type].flat) { const B = BUILDS[b.type]; stampRect(b.x - B.w / 2, b.y - B.h / 2, b.x + B.w / 2, b.y + B.h / 2, 6); }
    // сваленные стволы (World.solid → pushLog): кружки вдоль оставшейся части
    for (const L of lg) { const k = Actions.logK(L), ex = L.x + Math.cos(L.a) * L.len * k, ey = L.y + Math.sin(L.a) * L.len * 0.6 * k, n = Math.max(1, Math.ceil(Math.hypot(ex - L.x, ey - L.y) / 10));
      for (let i = 0; i <= n; i++) stampCircle(L.x + (ex - L.x) * i / n, L.y + (ey - L.y) * i / n, 4.2 * (L.s || 1) + 6); }
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
