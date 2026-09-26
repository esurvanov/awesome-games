'use strict';
// Мир: генерация из seed, деревья, места (изба, кедрач, тонкий лёд), столкновения, туман войны, навигация.
// Глобально — только то, что читает рендер: insideHut, treesNear; навигация — модуль Nav.
const insideHut = (x, y) => x > HUT_IN.x0 && x < HUT_IN.x1 && y > HUT_IN.y0 && y < HUT_IN.y1;
// деревья в квадрате ±r (без проверки расстояния) — gfx, посёлок, бот
function treesNear(x, y, r, out = []) { return Space.trees.near(x, y, r, out); }

const World = (() => {
  // туман войны: клетка FOG.cell px мира, сетка nx × ny (при ×1 — 36 × 36); значение клетки 0..3
  const FOG = { cell: WORLD.fogCell, nx: Math.ceil(W / WORLD.fogCell), ny: Math.ceil(H / WORLD.fogCell) };
  const COLL = [
    { x: POI.cockpit.x - 30, y: POI.cockpit.y, r: 40 }, { x: POI.cockpit.x + 40, y: POI.cockpit.y - 10, r: 38 },
    { x: POI.tail.x, y: POI.tail.y, r: 34 }, { x: POI.chum.x, y: POI.chum.y - 10, r: 34 },
    { x: POI.labaz.x, y: POI.labaz.y, r: 22 },
  ];
  const nearHut = (r = TUNE.r.nearHut) => Math.hypot(G.p.x - HUT.x, G.p.y - (HUT.y - 30)) < r;
  const inCedar = (x, y) => Math.hypot(x - POI.cedar.x, y - POI.cedar.y) < POI.cedar.r;
  const onThinIce = o => Math.hypot(o.x - POI.polynya.x, o.y - POI.polynya.y) < POI.polynya.r - 20;

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
    for (let v = 0; v <= Math.max(W, H); v += WORLD.wallStep) {
      const q = [[v + r() * 10, 16 + r() * 20, v <= W], [v + r() * 10, H - 6 - r() * 16, v <= W], [12 + r() * 20, v + r() * 10, v <= H], [W - 12 - r() * 20, v + r() * 10, v <= H]];
      for (const [x, y, on] of q) if (on) G.trees.push({ x: Math.round(x), y: Math.round(y), s: 1.25, wood: 3, kind: 0, wall: 1, v: (r() * 2) | 0, shake: 0 });
    }
    G.trees.forEach((t, i) => TREE_I.set(t, i));
    for (let i = 0, n = WORLD.count('drifts'); i < n; i++) G.drifts.push({ x: r() * W | 0, y: r() * H | 0, rx: 30 + r() * 90 | 0, ry: 8 + r() * 18 | 0 });
    for (let i = 0, n = WORLD.count('cracks'); i < n; i++) G.cracks.push({ y: r() * H | 0, off: (r() - 0.5) * 110 | 0, len: 18 + r() * 50 | 0, a: +((r() - 0.5) * 1.2).toFixed(2) });
    // кочки — только на мари: их число от площади мари, а не мира
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * POI.mar.r;
      G.tussocks.push({ x: POI.mar.x + Math.cos(a) * d | 0, y: POI.mar.y + Math.sin(a) * d | 0, s: +(0.6 + r() * 0.8).toFixed(2) });
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
        if (n) { Fx.toast(':cache: Тайник разорён — унесли еду'); Fx.burst(s.x, s.y - 6, 10, '#c0392b'); Sound.growl(0.2); }
      }
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
    if (who === 'p') {
      for (const t of treesNear(o.x, o.y, 40)) if (t.wood > 0) pushCircle(o, r, t, 4 + 8 * t.s);
      for (const q of Space.rocks.near(o.x, o.y, 50)) pushCircle(o, r, { x: q.x, y: q.y - 4 }, 14 * q.s);
    }
    if (Math.abs(o.x - HUT.x) < 180 && Math.abs(o.y - HUT.y) < 160) {
      for (const R of HUT_WALLS) pushRect(o, r, R);
      if (who !== 'p' && G.hut.door) pushRect(o, r, DOOR_RECT);
    }
    for (const c of COLL) pushCircle(o, r, c, c.r);
    if (G.col) for (const b of Space.builds.near(o.x, o.y, r + 60)) if (b.done && !BUILDS[b.type].flat) { const B = BUILDS[b.type]; if (Math.abs(o.x - b.x) < B.w / 2 + r + 2 && Math.abs(o.y - b.y) < B.h / 2 + r + 2) pushRect(o, r, { x0: b.x - B.w / 2, x1: b.x + B.w / 2, y0: b.y - B.h / 2, y1: b.y + B.h / 2 }); }
    o.x = clamp(o.x, 40, W - 40); o.y = clamp(o.y, 50, H - 40);
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
  function thinIce(dt) {
    const p = G.p, I = TUNE.ice;
    if (onThinIce(p)) {
      p.iceT += dt;
      if (p.iceT > I.creakT && !p.creaked) { p.creaked = 1; Sound.creak(); Fx.shake(3); Fx.toast(':frost: Лёд трещит!'); }
      if (p.iceT > I.breakT) {
        p.iceT = 0; p.creaked = 0; G.s.warm = Math.min(G.s.warm, I.warm); p.wetT = I.wetT; p.action = null;
        p.x = POI.polynya.x - 140; Sound.splash(); Fx.shake(10); Fx.toast(':frost: Провалился! Сушись у огня');
        Fx.burst(POI.polynya.x, POI.polynya.y, 20, '#9fd0ee', 160);
      }
    } else { p.iceT = Math.max(0, p.iceT - dt * 2); if (p.iceT === 0) p.creaked = 0; }
  }

  return { FOG, COLL, GEN_V, TREE_I, wood0, nearHut, inCedar, onThinIce, gen, genLiving, buildGrid, shakeTree, tickTrees,
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
    const k = (G.hut.door ? 'd' : '') + '|' + (G.col ? G.col.builds.filter(b => b.done && !BUILDS[b.type].flat).map(b => b.id).join(',') : '');
    if (k === key && lastG === G) return;
    key = k; lastG = G; ver++; blk.fill(0);
    for (const R of HUT_WALLS) stampRect(R.x0, R.y0, R.x1, R.y1, 7);
    if (G.hut.door) stampRect(DOOR_RECT.x0, DOOR_RECT.y0, DOOR_RECT.x1, DOOR_RECT.y1, 7);
    for (const c of World.COLL) stampCircle(c.x, c.y, c.r + 8);
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
