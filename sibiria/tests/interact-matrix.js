// Матрица взаимодействий «что × обо что» (что бы ни двигалось/падало/горело — обо что/по чему оно это делает).
// Каждая клетка: ожидаемое реалистичное поведение → маленькая сцена в игре → наблюдаемое число → статус:
//   works  — механика есть и проба прошла;
//   broken — механика есть, но в этой паре не срабатывает / работает нереалистично (обход вместо удара, сквозь вместо упора);
//   none   — механики нет совсем (код не знает о паре; проба не видит реакции);
//   n/a    — пары нет в игре или она бессмысленна.
// Сцены — прямые вызовы систем игры (как tests/body-check.js): newGame с seed, сюжет/директор/погода/ИИ заморожены,
// нужная система крутится своим настоящим шагом (update / World.solid / Wolves.tick / Bear.tick / Actions.finish …).
// В браузере (страница игры; новая партия в памяти — потом перезагрузить):
//   (0,eval)(await (await fetch('tests/interact-matrix.js')).text()); InteractMatrix.run()
// Playwright:  cd tests && NODE_PATH=…/node_modules node interact-matrix.js [--strict] [--json путь]
//   по умолчанию — отчёт (код выхода 0); --strict — 1, если есть broken/none вне EXCEPT.
var InteractMatrix = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, SEED = 20261001;
  const ROWS = ['fallTree', 'log', 'chunk', 'hero', 'npc', 'wolf', 'bear', 'deer', 'hare', 'sled', 'buran', 'stick', 'fire'];
  const ROWN = { fallTree: 'падающее дерево', log: 'лежачий ствол', chunk: 'чурка', hero: 'герой', npc: 'NPC/люди', wolf: 'волк', bear: 'медведь', deer: 'олень', hare: 'заяц', sled: 'нарты (упряжка)', buran: '«Буран»', stick: 'брошенная палка', fire: 'костёр' };
  const COLS = ['snow', 'trail', 'bareIce', 'iceSnow', 'thinIce', 'water', 'tree', 'log', 'hut', 'fire', 'other'];
  const COLN = { snow: 'глуб. снег', trail: 'тропа', bareIce: 'лёд голый', iceSnow: 'лёд+снег', thinIce: 'тонкий лёд', water: 'вода', tree: 'дерево', log: 'ствол', hut: 'изба', fire: 'костёр', other: 'др. субъект' };

  // ---------- заморозка посторонних систем (как tests/_wait.js FREEZE) ----------
  const O = {}; let frozen = false;
  function freeze() {
    if (frozen) return; frozen = true;
    const off = (obj, name, ...ks) => { for (const k of ks) if (obj && typeof obj[k] === 'function') { O[name + '.' + k] = obj[k]; obj[k] = () => {}; } };
    off(Story, 'Story', 'tick'); off(Weather, 'Weather', 'tick', 'newDay'); off(Director, 'Director', 'tick'); off(Wolves, 'Wolves', 'tick'); off(Bear, 'Bear', 'tick');
    off(Npc, 'Npc', 'tick', 'dawn'); off(Fauna, 'Fauna', 'hares', 'living', 'dawnTraps'); off(Survival, 'Survival', 'tick'); off(Colony, 'Colony', 'update', 'newDay');
    if (UI.tips) UI.tips.tick = () => {};
    Fx.toast = () => {}; SaveGame.checkpoint = () => {};
  }
  function fresh() {
    Math.random = mulberry(SEED); newGame(); state = 'play';
    G.time = tAt(1, 12); G.lastDawn = 1; G.storm = null; G.wolves = []; G.bear = null; G.pack = null;
    G.s.hp = 1000; G.s.warm = 100; G.s.food = 100; input.mx = input.my = 0; input.act = false; input.auto = 0;
    for (let i = 0; i < 6 && UI.modal && UI.modal(); i++) UI.closePanel();
    if (typeof Ice !== 'undefined' && Ice.reset) Ice.reset();
    Hero.bodyReset();
  }
  const R = { render: false };
  function frame() { update(DT); now += DT; if (state !== 'play') state = 'play'; if (R.render) { GFX.lookAt(G.p.x, G.p.y); GFX.render(DT, null); } }
  function step(sec, each) { for (let t = 0; t < sec; t += DT) { if (each) each(t); frame(); } }
  const P = () => G.p;
  function put(x, y) { const p = P(); p.x = x; p.y = y; p.action = null; p.ride = p.ride || null; p.iceSafe = 0; Hero.snap(); p.lx = x; p.ly = y; p.sx = x - 30; p.sy = y; }
  // герой идёт по вектору (mx,my) sec с: скорость px/с (без ввода после — скольжение)
  function walk(mx, my, sec) { const p = P(), x0 = p.x, y0 = p.y; step(sec, () => { input.mx = mx; input.my = my; }); input.mx = input.my = 0; return Math.hypot(p.x - x0, p.y - y0) / sec; }
  // тело ИИ шагает тем же путём, что ИИ (сдвиг + World.solid: провал в снег Depth.drag, упор о стволы/стены/вещи)
  function moveBody(o, r, who, vx, vy, sec) {
    const x0 = o.x, y0 = o.y; let minF = 1e9;
    World.solid(o, r, who);
    for (let t = 0; t < sec; t += DT) {
      G.time += DT; o.x += vx * DT; o.y += vy * DT; World.solid(o, r, who);
      for (const f of G.fires) minF = Math.min(minF, Math.hypot(o.x - f.x, o.y - f.y));
    }
    return { d: Math.hypot(o.x - x0, o.y - y0), dx: o.x - x0, dy: o.y - y0, x: o.x, y: o.y, minF };
  }
  const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
  function clearTrees(x, y, r) { for (const t of G.trees) if (t.wood > 0 && (t.x - x) ** 2 + (t.y - y) ** 2 < r * r) { t.wood = 0; t.stage = 0; } }
  function mkTree(x, y, s = 1) { const t = { x: Math.round(x), y: Math.round(y), s, kind: 0, v: 0, wood: 1 }; G.trees.push(t); Space.trees.add(t); return t; }
  function mkLog(x, y, a = 0, len = 150) { G.logs = G.logs || []; const L = { x, y, a, len, s: 1, kind: 0, v: 0, n: 5, n0: 5, t0: G.time, id: (G.logN = (G.logN || 0) + 1), cut: 1 }; G.logs.push(L); return L; }
  function mkFire(x, y, fuel = 600) { const f = { x, y, fuel }; G.fires.push(f); return f; }
  // ---------- места ----------
  const C = {};
  // глубокий снег: отрезок 150 px вдоль +x без стволов, глубже minD см (сугробы G.drifts — в первую очередь)
  function deepSpot(minD = 105) {
    if (C['deep' + minD]) return C['deep' + minD];
    const ok = (x, y) => { if (Math.hypot(x - HUT.x, y - HUT.y) < 600) return false; for (let d = -30; d <= 160; d += 10) { const X = x + d; if (X < 80 || X > W - 80 || onIce(X, y) || Math.abs(X - riverX(y)) < RW + 60 || World.blocked(X, y, 16) || Depth.depthAt(X, y) < minD) return false; } return true; };
    const cand = G.drifts.slice().sort((a, b) => b.rx - a.rx);
    for (const q of cand) for (const dx of [-0.6, -0.4, -0.2]) { const x = Math.round(q.x + q.rx * dx), y = Math.round(q.y); if (ok(x, y)) return (C['deep' + minD] = { x, y, d: Depth.depthAt(x + 60, y) }); }
    for (let y = 300; y < H - 300; y += 67) for (let x = 300; x < W - 300; x += 71) if (ok(x, y)) return (C['deep' + minD] = { x, y, d: Depth.depthAt(x + 60, y) });
    return minD > 70 ? deepSpot(minD - 15) : null;
  }
  // лёд реки: полоса ±50 px от фарватера голая (bare) / под снегом (snowy); дальше от переката
  function iceSpot(bare) {
    const k = bare ? 'iceB' : 'iceS'; if (C[k]) return C[k];
    for (let y = 300; y < H - 300; y += 9) {
      if (Math.abs(y - POI.polynya.y) < 400) continue;
      const cx = riverX(y); let good = true;
      for (let d = -50; d <= 50; d += 8) { const x = cx + d, b = Depth.bareIce(x, y), dp = Depth.depthAt(x, y); if (bare ? !b : (!onIce(x, y) || dp < 4)) { good = false; break; } }
      if (good && !World.blocked(cx, y, 14)) return (C[k] = { x: cx, y });
    }
    return null;
  }
  const PY = () => POI.polynya, thinPt = () => ({ x: PY().x - 55, y: PY().y }), waterPt = () => ({ x: PY().x + 10, y: PY().y + 4 });
  const holes = () => (G.iceHoles || []).length;
  // ---------- валка: настоящий конец рубки (Actions.finish → World.felled + fell), направление — от стороны героя ----------
  function fellTree(t, side, onFrame) {
    const p = P(); Actions.prepCut(t, side > 0 ? Math.PI : 0); if (!p._keep) put(t.x + side * 22, t.y + 3);   // рубка по-настоящему (t.cut): остался последний удар, валится от героя
    const rnd0 = Math.random; Math.random = () => 0.5; // без «риска» и разброса: падает от зарубки ровно
    p.action = { k: 'chop', t: 0, dur: 0.05, o: t, pose: Hero.chopPose(), tg: { x: t.x, y: t.y }, th: -10 };
    const n0 = (G.logs || []).length; for (let i = 0; i < 10 && p.action && p.action.k === 'chop'; i++) frame(); Math.random = rnd0;
    const L = (G.logs || [])[n0] || null; let hitT = -1, k = 0;
    if (L) for (let i = 0; i < 260 && L.f; i++) { frame(); k++; if (onFrame) onFrame(L); if (L.f && L.f.hit && hitT < 0) hitT = k * DT; }
    return L;
  }
  const logEnd = L => Actions.logEnd(L, 1);
  const lenOf = t => { const L = { x: 0 }; return Math.round(150 * t.s / (ArtWorld.treeK ? ArtWorld.treeK(t.s) : 1) * (typeof GFX !== 'undefined' && GFX.tjit ? GFX.tjit(t) : 1)); };

  // ---------- клетки ----------
  // cell(row, col, expected, probe, evidence) — probe → { st, obs }
  const CELLS = {};
  const cell = (r, c, exp, probe, ev) => { CELLS[r + '|' + c] = { exp, probe, ev }; };
  const na = (r, c, why) => { CELLS[r + '|' + c] = { na: why }; };
  const ok = (cond, obs, failSt = 'broken') => ({ st: cond ? 'works' : failSt, obs });

  // === падающее дерево ===
  function fallOn(setup) { // общая сцена: дерево на чистом месте, падает в +x (сторона героя −1)
    const s = setup(); clearTrees(s.x, s.y, s.clear || 230); for (const q of s.keep || []) q.wood = q.wood0 || 9;
    const t = mkTree(s.x, s.y, s.s || 1); s.pre && s.pre(t);
    const L = fellTree(t, -1, s.onFrame); return { L, t, s };
  }
  cell('fallTree', 'snow', 'падает в снег: удар (тряска/звук/облако снега), ствол лежит и становится преградой',
    () => { const d = deepSpot(); let parts = 0; R.render = true;
      const { L } = fallOn(() => ({ x: d.x, y: d.y, onFrame: L => { if (L.f && L.f.hit) parts = Math.max(parts, G.parts.filter(q => Math.abs(q.x - (L.x + 80)) < 120 && Math.abs(q.y - L.y) < 60).length); } }));
      R.render = false; const e = logEnd(L), mid = { x: (L.x + e.x) / 2, y: (L.y + e.y) / 2 + 2 }; // +2: точно на оси pushCircle не толкает (d=0)
      return ok(L && World.blocked(mid.x, mid.y, 6), `ствол лёг, преграда=${World.blocked(mid.x, mid.y, 6)}, частиц у ствола после удара=${parts}`); },
    'js/actions.js:143 impact(), js/world.js:331 pushLog');
  cell('fallTree', 'trail', 'ствол поперёк тропы перекрывает её (надо обойти/разделать)',
    () => { const d = deepSpot(); for (let k = -20; k <= 200; k += 6) Trail.shovel(d.x + k, d.y + 40, 18, 1);
      const { L } = fallOn(() => ({ x: d.x, y: d.y, pre: t => { t.nside = -1; } }));
      // тропа идёт вдоль +x под стволом? кладём ствол поперёк: дерево падает вниз (+y) не выйдет — проверяем точку тропы под стволом
      const e = logEnd(L), m = { x: (L.x + e.x) / 2, y: (L.y + e.y) / 2 + 2 }; Trail.shovel(m.x, m.y, 20, 1);
      return ok(World.blocked(m.x, m.y, 6), `точка тропы под стволом занята=${World.blocked(m.x, m.y, 6)} (Trail.at=${r2(Trail.at(m.x, m.y))})`); },
    'js/world.js:331 (ствол — преграда на любой поверхности)');
  function fallIce(bare) {
    const sp = iceSpot(bare); if (!sp) return { st: 'broken', obs: 'не нашёл места' };
    const h0 = holes(); const { L } = fallOn(() => ({ x: riverX(sp.y) - RW - 25, y: sp.y }));
    let on = 0, nb = 0, n = 0; for (let k = 0; k <= 1; k += 0.05) { const q = Actions.logEnd(L, k); n++; if (onIce(q.x, q.y)) on++; if (Depth.bareIce(q.x, q.y)) nb++; }
    const crack = (G.iceHoles || []).slice(h0).length;
    return { st: crack ? 'works' : 'none', obs: `ствол (угол ${r2(L.a)}, ${L.len} px) лёг поперёк реки: на льду ${Math.round(on / n * 100)}% длины (голый лёд ${Math.round(nb / n * 100)}%), новых пробоин=${crack}, трещин/отскока/скольжения нет` };
  }
  cell('fallTree', 'bareIce', 'ель (~0.3–0.6 т) бьёт по льду: трещины/скол; тонкий лёд — пробит; ствол может отскочить/проскользить по голому льду', () => fallIce(true), 'js/actions.js:82 fallBlocked (лёд не проверяет), :143 impact (только герой)');
  cell('fallTree', 'iceSnow', 'то же, снег гасит удар: трещины реже, лёд у берега держит', () => fallIce(false), 'js/actions.js:143');
  cell('fallTree', 'thinIce', 'ствол на тонком льду у переката → пролом (масса ствола ≫ веса человека, который его ломает)',
    () => { const t0 = thinPt(), h0 = holes(); const { L } = fallOn(() => ({ x: PY().x - 150, y: PY().y })); const e = logEnd(L), onT = World.onThinIce(e) || World.onThinIce({ x: (L.x + e.x) / 2, y: (L.y + e.y) / 2 });
      return { st: holes() > h0 ? 'works' : 'none', obs: `ствол лёг на тонкий лёд=${onT}, пробоин +${holes() - h0}` }; },
    'js/world.js:458 thinIce (только герой), js/ice.js:170 Ice.animal (только шатун)');
  cell('fallTree', 'water', 'вершина в открытой воде переката: всплеск, ствол в воде (намокает/вмерзает)',
    () => { const h0 = holes(), n0 = G.parts.length; const { L } = fallOn(() => ({ x: PY().x - 128, y: PY().y + 4 })); const e = logEnd(L);
      return { st: 'none', obs: `вершина в воде=${Ice.inWater(e.x, e.y)}, пробоин +${holes() - h0}; всплеска нет (impact не знает воды)` }; },
    'js/actions.js:143 impact');
  cell('fallTree', 'tree', 'задевает соседнее дерево: ломает ветви/сбивает снег, может зависнуть на нём',
    () => { const d = deepSpot(); let nb;
      const { L } = fallOn(() => ({ x: d.x, y: d.y, pre: t => { nb = mkTree(t.x + 70, t.y); nb.wood = 9; } }));
      // все стороны закрыты: ствол укорачивают до 0.55 и он проходит сквозь соседей
      fresh(); const d2 = deepSpot(); clearTrees(d2.x, d2.y, 260); const t2 = mkTree(d2.x, d2.y), ring = [];
      for (const a of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI, Math.PI + 0.5, Math.PI - 0.5]) { const q = mkTree(t2.x + Math.cos(a) * 60, t2.y + Math.sin(a) * 36); q.wood = 9; ring.push(q); }
      const len = lenOf(t2), L2 = fellTree(t2, -1);
      return { st: 'broken', obs: `сосед в линии падения: ствол отвернул на ${r2(L.a)} рад, сосед shake=${r2(nb.shake || 0)} дров=${nb.wood}; окружён со всех сторон: длина ${L2 ? L2.len : '?'} из ${len} (×0.55), проходит сквозь, соседи целы` }; },
    'js/actions.js:90 fallBlocked → :100 fallDir (уводит от препятствия), :112 blocked → len×0.55');
  function fallAvoid(what, setup) {
    const r = fallOn(setup); return { st: 'none', obs: `${what}: ствол отвёрнут на ${r2(r.L.a)} рад (вместо 0)${r.s.after ? ', ' + r.s.after(r.L) : ''}` };
  }
  cell('fallTree', 'log', 'ложится поперёк лежачего: перекрещиваются, верхний пружинит/отскакивает',
    () => { const d = deepSpot(); return fallAvoid('лежачий ствол в линии', () => ({ x: d.x, y: d.y, pre: t => mkLog(t.x + 75, t.y - 60, Math.PI / 2 * 1.0, 120) })); },
    'js/actions.js:94 fallBlocked (стволы/бурелом — обход)');
  cell('fallTree', 'hut', 'падает на избу: удар по крыше/стене (урон, снег с крыши)',
    () => fallAvoid('изба в линии', () => ({ x: HUT.x - 190, y: HUT.y, clear: 120, after: () => `стены hut.walls=${G.hut.walls}, doorHp=${G.hut.doorHp}` })), 'js/actions.js:87 fallBlocked (изба — обход)');
  cell('fallTree', 'fire', 'падает на костёр: разбрасывает угли/гасит, ствол тлеет',
    () => { const d = deepSpot(); let f; return fallAvoid('костёр в линии', () => ({ x: d.x, y: d.y, pre: t => { f = mkFire(t.x + 75, t.y + 2); }, after: () => `fuel костра=${Math.round(f.fuel)}` })); }, 'js/actions.js:92 fallBlocked (костёр — обход)');
  cell('fallTree', 'other', 'кто под стволом — получает удар: герой, волк, человек посёлка, олень',
    () => { const d = deepSpot(); fresh(); clearTrees(d.x, d.y, 230); const t = mkTree(d.x, d.y); const p = P(); put(t.x + 80, t.y + 1); p._keep = 1; const hp0 = G.s.hp;
      const L = fellTree(t, -1); p._keep = 0; const heroDmg = hp0 - G.s.hp;
      fresh(); clearTrees(d.x, d.y, 230); const t2 = mkTree(d.x, d.y); const w = Wolves.at(0, 300); w.x = t2.x + 80; w.y = t2.y + 1; w.st = 'lie'; const whp = w.hp;
      const u = Colony.spawn('bich'); u.x = t2.x + 110; u.y = t2.y; const uhp = u.hp; fellTree(t2, -1);
      return { st: heroDmg > 0 && (w.hp < whp || u.hp < uhp) ? 'works' : heroDmg > 0 ? 'broken' : 'none', obs: `герой −${r1(heroDmg)} hp; волк hp ${whp}→${w.hp}; бич hp ${uhp}→${u.hp}` }; },
    'js/actions.js:146 impact: inPath(L, p) — только герой');

  // === лежачий ствол ===
  cell('log', 'snow', 'лежит в снегу, со временем его заметает (и целый, и остаток после разделки)',
    () => { const d = deepSpot(); const A = mkLog(d.x, d.y), B = mkLog(d.x, d.y + 60); B.n = 0; B.done = G.time; G.time += CYCLE * 0.4; frame();
      return { st: Actions.logSnow(B) > 0.3 && Actions.logSnow(A) > 0.05 ? 'works' : Actions.logSnow(B) > 0.3 ? 'broken' : 'none', obs: `через 0.4 сут: остаток заметён на ${r2(Actions.logSnow(B))}, целый ствол на ${r2(Actions.logSnow(A))}` }; },
    'js/actions.js:162 logSnow (только done/лишние)');
  na('log', 'trail', 'как глубокий снег: ствол — преграда на тропе (см. падающее дерево × тропа)');
  na('log', 'bareIce', 'лежачему стволу нечем двигаться по льду — масса учтена в «тонкий лёд»');
  na('log', 'iceSnow', 'то же');
  cell('log', 'thinIce', 'тяжёлый ствол на тонком льду: лёд прогибается/трещит, со временем ломается',
    () => { const h0 = holes(); const t = thinPt(); mkLog(t.x - 40, t.y, 0, 120); put(PY().x - 250, PY().y); step(4); return { st: 'none', obs: `4 с: пробоин +${holes() - h0}` }; }, 'js/world.js:458 thinIce (только герой)');
  cell('log', 'water', 'в открытой воде: всплывает, течение сносит/вмерзает',
    () => { const w = waterPt(), L = mkLog(w.x - 20, w.y, 0, 60), x0 = L.x; put(PY().x - 250, PY().y); step(4); return { st: 'none', obs: `4 с: ствол сдвинут на ${r1(L.x - x0)} px, вода не реагирует` }; }, '—');
  na('log', 'tree', 'лежачий ствол сам не движется');
  na('log', 'log', 'лежачий ствол сам не движется');
  na('log', 'hut', 'лежачий ствол сам не движется');
  cell('log', 'fire', 'ствол через костёр: обугливается/загорается, костёр горит дольше',
    () => { const d = deepSpot(); const f = mkFire(d.x + 60, d.y), L = mkLog(d.x, d.y, 0, 150); put(d.x, d.y + 120); const f0 = f.fuel, n0 = L.n; step(20);
      return { st: 'none', obs: `20 с: топливо костра ${r1(f0)}→${r1(f.fuel)} (обычный расход), ствол n ${n0}→${L.n}, без следов огня` }; }, 'js/fire.js:33 tick (костёр не знает о стволах)');
  cell('log', 'other', 'герой/звери упираются в ствол (перешагнуть — медленно)',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const L = mkLog(d.x - 20, d.y, 0, 160); put(d.x + 60, d.y - 40); walk(0, 1, 1.2); const y = P().y;
      return ok(y < d.y - 4, `герой шёл поперёк: остановился на y−лог=${r1(y - d.y)} px`); }, 'js/world.js:316 pushLog');

  // === чурка ===
  cell('chunk', 'snow', 'чурки на снегу заметает за ~сутки (как лапник и остаток ствола)',
    () => { const d = deepSpot(); G.chunks = [{ x: d.x, y: d.y, a: 0, t: G.time }]; const c = G.chunks[0]; G.time += CYCLE * 1.5; frame();
      return { st: G.chunks.includes(c) && c.bury == null ? 'none' : 'works', obs: `через 1.5 сут: чурка лежит как была (поля заметания нет)` }; }, 'js/gfx.js:881 (рисуется всегда целиком), js/actions.js:441');
  na('chunk', 'trail', 'чурка не движется');
  cell('chunk', 'bareIce', 'чурка, скатившаяся/упавшая на голый лёд, скользит дальше',
    () => { const s = iceSpot(true); G.chunks = [{ x: s.x, y: s.y, a: 0, t: G.time, fx: s.x - 20, fy: s.y }]; const c = G.chunks[0]; frame(); step(1);
      return { st: 'none', obs: `чурка на льду: сдвиг ${r1(c.x - s.x)} px (у чурок нет скорости — только откат 0.45 с в рисунке)` }; }, 'js/gfx.js:881');
  na('chunk', 'iceSnow', 'как голый лёд');
  na('chunk', 'thinIce', 'чурку туда не уронить (разделка у берега); масса мала');
  na('chunk', 'water', 'чурку туда не доставить');
  na('chunk', 'tree', '—'); na('chunk', 'log', '—'); na('chunk', 'hut', '—');
  cell('chunk', 'fire', 'чурка у костра — дрова: подкинуть с земли',
    () => ({ st: 'none', obs: 'костёр кормится только из сумки (F), чурка с земли — сначала в сумку' }), 'js/actions.js:755 fireKey');
  na('chunk', 'other', 'чурка — мелкая вещь под ногами');

  // === герой ===
  cell('hero', 'snow', 'проваливается (по колено–пояс) и идёт медленнее; по тропе — быстрее',
    () => { const d = deepSpot(); put(d.x, d.y); step(0.5); const v1 = walk(1, 0, 1.2), s1 = Depth.heroSink;
      for (let k = -40; k <= 220; k += 6) Trail.shovel(d.x + k, d.y, 18, 1); put(d.x, d.y); step(0.5); const v2 = walk(1, 0, 1.2), s2 = Depth.heroSink;
      C.heroV = { v1, v2 }; return ok(s1 > 30 && v2 > v1 * 1.15, `целина (снег ${Math.round(d.d)} см): провал ${Math.round(s1)} см, ${Math.round(v1)} px/с; расчищено: провал ${Math.round(s2)} см, ${Math.round(v2)} px/с`); },
    'js/depth.js:200 heroMul, js/hero.js:28');
  cell('hero', 'trail', 'по тропе быстрее, чем по целине',
    () => { const v = C.heroV; return v ? ok(v.v2 > v.v1 * 1.15, `×${r2(v.v2 / v.v1)} к целине`) : { st: 'broken', obs: 'нет замера' }; }, 'js/trail.js:107 speedCap');
  function coast(sp, ride) { // разгон вдоль +x по голой полосе ±50 px (Буран быстрый — короткий толчок, чтобы не съехать со льда)
    put(sp.x - 50, sp.y); if (ride) mountV(ride); step(0.2); walk(1, 0, ride === 'buran' ? 0.12 : ride ? 0.25 : 0.6); const x0 = P().x; step(1.5); const c = P().x - x0; if (ride) Transport.dismount(); return c;
  }
  cell('hero', 'bareIce', 'скользко: после шага тело едет дальше, разгон медленный',
    () => { const sp = iceSpot(true); const c = coast(sp); return ok(c > 8, `откат после отпускания: ${r1(c)} px`); }, 'js/hero.js:48 glide, :6 slick');
  cell('hero', 'iceSnow', 'лёд под снегом — сцепление, не скользит',
    () => { const sp = iceSpot(false); const c = coast(sp); return ok(c < 4, `откат после отпускания: ${r1(c)} px`); }, 'js/depth.js:229 bareIce');
  cell('hero', 'thinIce', 'трещит, через ~3 с проваливается (эпизод в полынье)',
    () => { const t = thinPt(); put(t.x - 150, t.y); step(0.2); put(t.x, t.y); let at = -1; step(4, tt => { if (at < 0 && Ice.active()) at = tt; });
      return ok(at > 0, `провал через ${r2(at)} с, пробоин ${holes()}`); }, 'js/world.js:458 thinIce, js/ice.js:28 start');
  cell('hero', 'water', 'шаг в открытую воду — сразу в воду',
    () => { const w = waterPt(); put(w.x - 150, w.y); step(0.2); put(w.x, w.y); let at = -1; step(0.5, tt => { if (at < 0 && Ice.active()) at = tt; }); return ok(at >= 0 && at < 0.1, `провал через ${r2(at)} с`); }, 'js/world.js:465');
  cell('hero', 'tree', 'упирается в ствол; толчок трясёт дерево (снег с веток)',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const t = mkTree(d.x + 60, d.y); t.wood = 9; put(d.x, d.y); let sh = 0; step(1.5, () => { input.mx = 1; sh = Math.max(sh, t.shake || 0); }); input.mx = 0;
      return ok(P().x < t.x - 8 && sh > 0, `остановился в ${r1(t.x - P().x)} px от оси, макс. дрожь ствола=${r2(sh)}`); }, 'js/world.js:309 pushAll, js/interact.js:52');
  na('hero', 'log', 'см. «лежачий ствол × другой субъект»');
  cell('hero', 'hut', 'стены держат, войти — только в дверь',
    () => { put(HUT.x - 260, HUT.y - 20); walk(1, 0, 3); const inW = HUT_WALLS.some(Rr => P().x > Rr.x0 && P().x < Rr.x1 && P().y > Rr.y0 && P().y < Rr.y1);
      return ok(!inW && P().x < HUT.x, `x−изба=${r1(P().x - HUT.x)}, внутри стены=${inW}, в избе=${insideHut(P().x, P().y)}`); }, 'js/world.js:334 HUT_WALLS');
  cell('hero', 'fire', 'в костёр не заходит (упор/обход) или обжигается',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const f = mkFire(d.x + 50, d.y + 1); put(d.x, d.y); G.s.hp = 100; let mind = 1e9;
      step(2, () => { input.mx = 1; mind = Math.min(mind, Math.hypot(P().x - f.x, P().y - f.y)); }); input.mx = 0; const hp = G.s.hp;
      return ok(mind > 12 && hp < 100 && hp > 60, `упёрся в огонь: ближе ${r1(mind)} px к центру; 2 с напора: hp 100→${r1(hp)} (ожог, не смерть)`); },
    'js/world.js pushAll → js/fire.js keepR/burnHero');
  cell('hero', 'other', 'тела расталкиваются: сквозь волка/человека не пройти',
    () => { const d = deepSpot(); put(d.x, d.y); const w = Wolves.at(0, 300); w.x = d.x + 4; w.y = d.y; w.st = 'lie'; step(0.3); return ok(Math.hypot(w.x - P().x, w.y - P().y) > 18, `дистанция герой–волк ${r1(Math.hypot(w.x - P().x, w.y - P().y))} px (сумма радиусов 22)`); },
    'js/world.js:403 crowd');

  // === ИИ-тела: люди и звери (общий путь: сдвиг + World.solid) ===
  const KINDS = { npc: ['n', 9, 'n', 70], wolf: ['w', 12, 'wolf', 110], bear: ['b', 20, 'bear', 90], deer: ['a', 12, 'deer', 60], hare: ['a', 5, 'hare', 60] };
  function bodySnow(row) {
    const [who, r, kind, v] = KINDS[row], d = deepSpot();
    const s = Depth.sinkAt(d.x + 60, d.y, kind), sh = Depth.sinkAt(d.x + 60, d.y, 'p');
    put(d.x, d.y + 140); const a = moveBody({ x: d.x, y: d.y }, r, who, v, 0, 1.5);
    for (let k = -40; k <= 220; k += 6) Trail.shovel(d.x + k, d.y, 18, 1);
    const b = moveBody({ x: d.x, y: d.y }, r, who, v, 0, 1.5);
    C['b' + row] = { a: a.d, b: b.d, s, sh };
    return { a: a.d, b: b.d, s, sh, d: d.d };
  }
  function bodyHit(row, setup) {
    const [who, r, , v] = KINDS[row]; const d = deepSpot(); clearTrees(d.x, d.y, 220); put(d.x, d.y + 160); const tgt = setup(d);
    const o = { x: d.x, y: d.y }; const m = moveBody(o, r, who, v, 0, 2); return { m, o, tgt };
  }
  function bodyThin(row, mk) { // настоящий объект в своём списке, его ИИ заморожен — реагирует ли мир (World.thinIce, Ice)
    const t = thinPt(), h0 = holes(); put(PY().x - 260, PY().y); const o = mk(t.x, t.y); step(4); return { o, n: holes() - h0 };
  }
  const MK = {
    npc: (x, y) => { const u = Colony.spawn('bich'); u.x = x; u.y = y; return u; },
    wolf: (x, y) => { const w = Wolves.at(0, 300); w.x = x; w.y = y; w.st = 'lie'; w.t = 99; return w; },
    deer: (x, y) => { const q = { x, y, vx: 0, vy: 0, t: 9, face: 1, ph: 0 }; G.deer.push(q); return q; },
    hare: (x, y) => { const q = { x, y, vx: 0, vy: 0, t: 9, face: 1, hop: 0, pr: 0, sz: 0.55, coat: 0, pose: 'sit', pt: 3 }; G.hares.push(q); return q; },
  };
  const EXP = {
    npc: { snow: 'человек вязнет как герой (по колено–пояс), по тропе быстрее', thin: 'человек (~80 кг) проваливается, как герой', water: 'в открытую воду не идёт (обходит) или проваливается', fire: 'обходит огонь' },
    wolf: { snow: 'волк легче: наст держит, вязнет меньше человека; по тропе быстрее (волки ходят по тропам)', thin: 'волк (~40 кг) — лёд трещит, может провалиться', water: 'в воду не идёт', fire: 'боится огня, держится за кругом' },
    bear: { snow: 'медведь тяжёлый: проваливается глубоко, по тропе легче', thin: 'медведь (~250 кг) проламывает лёд, уходит в воду', water: 'то же', fire: 'шатун боится огня (не лезет в круг)' },
    deer: { snow: 'олень на тонких ногах вязнет глубоко, держится троп', thin: 'олень (~120 кг) проламывает тонкий лёд', water: 'в воду не идёт', fire: 'обходит огонь' },
    hare: { snow: 'заяц почти не проваливается (лапы-снегоступы)', thin: 'заяц (2–3 кг) тонкий лёд не ломает', water: 'в воду не идёт', fire: 'обходит огонь' },
  };
  for (const row of ['npc', 'wolf', 'bear', 'deer', 'hare']) {
    const E = EXP[row];
    cell(row, 'snow', E.snow, () => { const r = bodySnow(row);
      const okS = row === 'hare' ? r.s < 12 : row === 'wolf' ? r.s < r.sh * 0.8 : r.s > 25;
      return ok(okS && (row === 'hare' || r.b > r.a * 1.1), `снег ${Math.round(r.d)} см: провал ${Math.round(r.s)} см (человек ${Math.round(r.sh)}); путь за 1.5 с: целина ${r1(r.a)} px, расчищено ${r1(r.b)} px`); },
      'js/depth.js:259 drag, :24 KIND');
    if (row === 'hare') na(row, 'trail', 'заяц по насту — тропа не нужна');
    else cell(row, 'trail', 'по тропе — быстрее, чем по целине', () => { const r = C['b' + row]; return r ? ok(r.b > r.a * 1.1, `×${r2(r.b / r.a)} к целине`) : { st: 'broken', obs: 'нет замера' }; }, 'js/depth.js:273 mulKind, js/trail.js:263 depth');
    cell(row, 'bareIce', 'на голом льду: скользит/осторожничает (медленнее, заносит на поворотах)',
      () => { const s = iceSpot(true), [who, r, , v] = KINDS[row]; put(s.x, s.y + 160); const o = { x: s.x - 45, y: s.y }; moveBody(o, r, who, v, 0, 0.5); const x1 = o.x; moveBody(o, r, who, 0, 0, 1); const c = o.x - x1;
        const d = deepSpot(70), q = { x: d.x, y: d.y }; put(d.x, d.y + 160); moveBody(q, r, who, v, 0, 0.5); const y1 = q.x; moveBody(q, r, who, 0, 0, 1); const c2 = q.x - y1;
        return ok(c > 4 && c2 < 1, `накат после остановки: лёд ${r1(c)} px, снег ${r1(c2)} px`); },
      'js/world.js env (голый лёд: инерция по сцеплению вида)');
    na(row, 'iceSnow', 'на льду под снегом — как по снегу (тонкий слой)');
    if (row === 'bear') {
      const thin = () => { const t = thinPt(), h0 = holes(); put(PY().x - 260, PY().y); G.bear = { x: t.x, y: t.y, hp: 9, hp0: 9, st: 'hunt', t: 3, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0 }; for (let i = 0; i < 6; i++) O['Bear.tick'](DT, 23, 1); return { gone: !G.bear, n: holes() - h0 }; };
      cell(row, 'thinIce', E.thin, () => { const r = thin(); return ok(r.gone && r.n > 0, `шатун ушёл под лёд=${r.gone}, пробоин +${r.n}`); }, 'js/bear.js:97, js/ice.js:170 Ice.animal');
      cell(row, 'water', E.water, () => { const w = waterPt(), h0 = holes(); put(PY().x - 260, PY().y); G.bear = { x: w.x, y: w.y, hp: 9, hp0: 9, st: 'hunt', t: 3, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0 }; O['Bear.tick'](DT, 23, 1); return ok(!G.bear && holes() > h0, `в воде: ушёл под лёд=${!G.bear}`); }, 'js/bear.js:97');
    } else {
      cell(row, 'thinIce', E.thin, () => { const [who, r] = KINDS[row], t = thinPt(), h0 = holes(); put(PY().x - 260, PY().y); const o = MK[row](t.x, t.y); let at = -1;
        World.solid(o, r, who); for (let tt = 0; tt < 8 && at < 0; tt += DT) { G.time += DT; o.x += Math.sin(tt * 3) * 20 * DT; World.solid(o, r, who); if (holes() > h0) at = tt; }
        const want = row !== 'hare', out = !World.onThinIce(o);
        return want ? ok(at > 0, `на тонком льду: пролом через ${r2(at)} с, выбрался на крепкий=${out}`) : ok(at < 0, `8 с на тонком льду: пробоин ${holes() - h0} (лёгкий — держит)`); },
        'js/world.js env (масса → время пролома), js/ice.js fallBody');
      cell(row, 'water', E.water, () => { const w = waterPt(), [who, r, , v] = KINDS[row]; put(PY().x - 260, PY().y); const o = { x: w.x - 60, y: w.y }; let inW = 0; World.solid(o, r, who);
        for (let t = 0; t < 1.5; t += DT) { G.time += DT; o.x += v * DT; World.solid(o, r, who); if (Ice.inWater(o.x, o.y)) inW++; }
        return ok(inW === 0 && (Math.abs(o.x - w.x) > 20 || Math.abs(o.y - w.y) > 10), `в воде ${r1(inW * DT)} с; обошёл: x−вода=${r1(o.x - w.x)}, y−вода=${r1(o.y - w.y)}`); }, 'js/world.js pushAll → js/ice.js pushWater');
    }
    cell(row, 'tree', 'упирается в ствол, обходит', () => { const r = bodyHit(row, d => { const t = mkTree(d.x + 60, d.y); t.wood = 9; return t; });
      return ok(r.o.x < r.tgt.x - 4 || Math.abs(r.o.y - r.tgt.y) > 6, `тело обошло/встало: x−ствол=${r1(r.o.x - r.tgt.x)}, y−ствол=${r1(r.o.y - r.tgt.y)}`); }, 'js/world.js:309 pushAll');
    const overExp = row === 'npc' ? 'перелезает через ствол медленно или обходит' : row === 'bear' ? 'медведь перелезает через ствол' : 'перепрыгивает/перешагивает ствол';
    cell(row, 'log', overExp, () => { const [who, r, , v] = KINDS[row]; const d = deepSpot(); clearTrees(d.x, d.y, 220); const L = mkLog(d.x + 60, d.y - 80, Math.PI / 2 * 1.0, 300); put(d.x, d.y + 200);
      const o = { x: d.x, y: d.y }; moveBody(o, r, who, v, 0, 3.5); const crossed = o.x > d.x + 60 + 5, side = Math.abs(o.y - d.y);
      return row === 'npc' ? ok(!crossed || side > 60, `${crossed ? (side > 60 ? 'обошёл с конца' : 'перешёл') : 'упёрся'} (сдвиг вдоль ствола ${r1(side)} px)`) : { st: crossed ? 'works' : 'broken', obs: `${crossed ? 'перешёл' : 'упёрся как в стену, не перепрыгнул'} (вдоль ствола ${r1(side)} px)` }; },
      'js/world.js pushAll (jump: logH) + env (over — медленнее)');
    cell(row, 'hut', row === 'hare' ? 'в избу не заходит' : 'стены держат; в дверь (если нет двери) — по своим правилам',
      () => { const [who, r, , v] = KINDS[row]; put(HUT.x, HUT.y + 300); const o = { x: HUT.x - 260, y: HUT.y - 20 }; moveBody(o, r, who, v, 0, 3);
        const inW = HUT_WALLS.some(Rr => o.x > Rr.x0 && o.x < Rr.x1 && o.y > Rr.y0 && o.y < Rr.y1); return ok(!inW, `внутри стены=${inW}, x−изба=${r1(o.x - HUT.x)}`); }, 'js/world.js:334');
    if (row === 'wolf') cell(row, 'fire', E.fire, () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const f = mkFire(d.x, d.y, 900); put(d.x + 10, d.y); const w = Wolves.at(0, 300); w.x = d.x + 40; w.y = d.y; w.st = 'circle';
      let mn = 1e9; for (let i = 0; i < 180; i++) { O['Wolves.tick'](DT, 1); mn = Math.min(mn, Math.hypot(w.x - f.x, w.y - f.y)); } const R0 = Fire.fearR(f);
      return ok(Math.hypot(w.x - f.x, w.y - f.y) > R0 * 0.8, `радиус страха ${R0}; волк через 3 с в ${r1(Math.hypot(w.x - f.x, w.y - f.y))} px от огня`); }, 'js/wolves.js:104');
    else if (row === 'bear') cell(row, 'fire', E.fire, () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const f = mkFire(d.x, d.y, 900); put(d.x + 6, d.y);
      const run = last => { G.bear = { x: d.x + 260, y: d.y, hp: 9, hp0: 9, st: 'hunt', t: 3, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0, finalStand: last };
        let mn = 1e9; for (let i = 0; i < 300 && G.bear; i++) { O['Bear.tick'](DT, 23, 1); G.time += DT; mn = Math.min(mn, Math.hypot(G.bear.x - f.x, G.bear.y - f.y)); } G.bear = null; return mn; };
      const a = run(0), b = run(1); return ok(a > 70 && b > 35 && b < a, `шатун держится от огня: обычный ${r1(a)} px, голодный (последний выход) ${r1(b)} px (страх волков ${Fire.fearR(f)})`); }, 'js/bear.js fireFear');
    else cell(row, 'fire', E.fire, () => { const [who, r, , v] = KINDS[row]; const d = deepSpot(); clearTrees(d.x, d.y, 200); mkFire(d.x + 70, d.y); put(d.x, d.y + 160); const m = moveBody({ x: d.x, y: d.y }, r, who, v, 0, 2);
      return ok(m.minF >= r + 10, `прошёл в ${r1(m.minF)} px от центра огня`); }, 'js/world.js pushAll → js/fire.js keepR');
    cell(row, 'other', row === 'npc' ? 'тела расталкиваются (сквозь героя не проходит)' : row === 'hare' || row === 'deer' ? 'убегает от героя; телами не пересекаются' : 'нападает на героя/людей; телами не пересекаются',
      () => { const d = deepSpot(); put(d.x, d.y); const o = row === 'bear' ? (G.bear = { x: d.x + 4, y: d.y, hp: 9, hp0: 9, st: 'stun', t: 9, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0 }) : MK[row](d.x + 4, d.y);
        step(0.3); const dd = Math.hypot(o.x - P().x, o.y - P().y); return ok(dd > 12, `дистанция до героя ${r1(dd)} px через 0.3 с`); }, 'js/world.js:403 crowd');
  }

  // === транспорт ===
  function mountV(kind) {
    const p = P(); if (kind === 'buran') { const v = G.veh.buran || (G.veh.buran = { x: 0, y: 0, face: 1, fixed: 1, fuel: 0 }); v.fixed = 1; v.fuel = 1e5; v.x = p.x; v.y = p.y; }
    else G.veh.deer = { x: p.x, y: p.y, face: 1, until: G.day + 9 };
    Transport.mount(kind);
    for (let i = 0; i < 180 && P().ride !== kind; i++) frame(); // посадка — процесс (js/transport.js BOARD_T): ждём, пока сел
  }
  // костёр — процесс (js/actions.js fireStep: место → поленья → растопка → огниво, ~8 с): F и шаги, пока не загорится; null — не разжечь
  // герой стоит на месте всё время работы — на тонком льду не проваливается в пробе (iceSafe), проверяется костёр, а не герой
  function lightFire(sec = 20) {
    const n0 = G.fires.length, p = P(); Actions.fireKey(); if (G.fires.length === n0 && !p.action) return null;
    for (let t = 0; t < sec; t += DT) { p.iceSafe = 1; frame(); const f = G.fires[G.fires.length - 1]; if (G.fires.length > n0 && f.fuel > 0) { p.iceSafe = 0; return f; } if (!p.action) Actions.fireKey(); }
    p.iceSafe = 0; return G.fires.length > n0 ? G.fires[G.fires.length - 1] : null;
  }
  function vehSpeed(kind) {
    const d = deepSpot(); put(d.x, d.y); mountV(kind); step(0.3); const v1 = walk(1, 0, 0.8); Transport.dismount();
    for (let k = -40; k <= 600; k += 6) Trail.shovel(d.x + k, d.y, 18, 1); put(d.x, d.y); mountV(kind); step(0.3); const v2 = walk(1, 0, 0.8); Transport.dismount();
    return { v1, v2, d: d.d };
  }
  for (const row of ['sled', 'buran']) {
    const nm = row === 'sled' ? 'упряжка' : '«Буран»';
    cell(row, 'snow', `${nm} в глубоком снегу вязнет — медленнее, чем по накатанному`, () => { const r = vehSpeed(row === 'sled' ? 'deer' : 'buran'); C['v' + row] = r;
      return { st: r.v2 > r.v1 * 1.1 ? 'works' : 'broken', obs: `снег ${Math.round(r.d)} см: ${Math.round(r.v1)} px/с; там же расчищено: ${Math.round(r.v2)} px/с (×${r2(r.v2 / r.v1)})` }; },
      'js/depth.js rideMul, js/hero.js speed');
    cell(row, 'trail', `по тропе/зимнику ${nm} быстрее`, () => { const r = C['v' + row]; return r ? { st: r.v2 > r.v1 * 1.1 ? 'works' : 'broken', obs: `расчищенная тропа ×${r2(r.v2 / r.v1)} (зимник-зона — свой ×1.3 в TERRAIN)` } : { st: 'broken', obs: 'нет замера' }; }, 'js/depth.js rideMul (Trail.at), js/content/zones.js TERRAIN.trail');
    const kind = row === 'sled' ? 'deer' : 'buran';
    cell(row, 'bareIce', `${nm} на голом льду скользит, заносит, тормозит дольше`, () => { const c = coast(iceSpot(true), kind); return ok(c > 8, `накат после отпускания ${r1(c)} px`); }, 'js/hero.js:48 glide (верхом тоже)');
    cell(row, 'iceSnow', 'лёд под снегом — сцепление', () => { const c = coast(iceSpot(false), kind); return ok(c < 4, `накат ${r1(c)} px`); }, 'js/hero.js:6 slick');
    cell(row, 'thinIce', `${nm} (${row === 'sled' ? '~300' : '~350'} кг с седоком) проламывает тонкий лёд; олени сами на него не идут`, () => { const t = thinPt();
      // подъезд: упряжка встаёт у кромки, «Буран» въезжает
      put(PY().x - POI.polynya.r - 40, t.y); mountV(kind); step(0.2); walk(1, 0, kind === 'buran' ? 0.25 : 1.5); const onT = World.onThinIce(P()) || Ice.active(); if (P().ride) Transport.dismount(); fresh();
      const h0 = holes(); put(t.x - 150, t.y); mountV(kind); step(0.2); P().x = t.x; G.veh[kind].x = t.x; step(4);
      const r = { st: (Ice.active() || holes() > h0) && onT === (kind === 'buran') ? 'works' : 'broken', obs: `подъезд: въехал на тонкий=${onT}; 4 с верхом на тонком льду: провал=${Ice.active()}, пробоин +${holes() - h0}, транспорт у кромки=${!!(G.veh[kind] && !World.onThinIce(G.veh[kind]))}` }; if (P().ride) Transport.dismount(); return r; }, 'js/world.js thinIce (RIDE_K) → rideSink');
    cell(row, 'water', `${nm} в открытую воду — провал`, () => { const w = waterPt(); put(w.x - 120, w.y); mountV(kind); step(0.2); P().x = w.x; P().y = w.y; G.veh[kind].x = w.x; step(1);
      const r = { st: Ice.active() ? 'works' : 'broken', obs: `верхом над водой переката 1 с: провал=${Ice.active()}` }; if (P().ride) Transport.dismount(); return r; }, 'js/world.js thinIce (Ice.inWater верхом)');
    cell(row, 'tree', 'упирается в ствол (удар, остановка)', () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const t = mkTree(d.x + 70, d.y); t.wood = 9; put(d.x, d.y); mountV(kind); walk(1, 0, 1.2); const x = P().x; Transport.dismount(); return ok(x < t.x - 6, `остановка в ${r1(t.x - x)} px от оси ствола`); }, 'js/hero.js:63 World.solid');
    cell(row, 'log', 'перед стволом встаёт (переехать нельзя/медленно)', () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); mkLog(d.x + 70, d.y - 80, Math.PI / 2, 300); put(d.x, d.y); mountV(kind); walk(1, 0, 1.2); const x = P().x; Transport.dismount(); return ok(x < d.x + 70, `x−ствол=${r1(x - d.x - 70)}`); }, 'js/world.js:331');
    cell(row, 'hut', 'стены держат', () => { put(HUT.x - 300, HUT.y - 20); mountV(kind); walk(1, 0, 2); const p = P(), inW = HUT_WALLS.some(Rr => p.x > Rr.x0 && p.x < Rr.x1 && p.y > Rr.y0 && p.y < Rr.y1); Transport.dismount(); return ok(!inW, `внутри стены=${inW}`); }, 'js/world.js:334');
    cell(row, 'fire', 'через костёр не едет (олени шарахаются / гасит и разбрасывает)', () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const f = mkFire(d.x + 60, d.y); put(d.x, d.y); mountV(kind); let mn = 1e9; step(1.2, () => { input.mx = 1; mn = Math.min(mn, Math.hypot(P().x - f.x, P().y - f.y)); }); input.mx = 0; Transport.dismount();
      return ok(mn > 20, `ближе всего к огню ${r1(mn)} px, костёр fuel=${Math.round(f.fuel)}`); }, 'js/world.js pushAll → js/fire.js keepR (упряжка шарахается)');
    cell(row, 'other', 'сбивает/расталкивает зверей и людей (масса больше)', () => { const d = deepSpot(); put(d.x, d.y); mountV(kind); const w = Wolves.at(0, 300); w.x = d.x + 4; w.y = d.y; w.st = 'lie'; step(0.3); const dd = Math.hypot(w.x - P().x, w.y - P().y); Transport.dismount(); return ok(dd > 20, `волк отодвинут на ${r1(dd)} px`); }, 'js/world.js:410 crowd (r16, m3)');
  }

  // === брошенная палка (Actions.alt → throwAt → launch → land) ===
  function throwAt(tgSetup, forceHit, each) {
    const r = tgSetup(); const p = P(); put(r.from.x, r.from.y); p.face = 1; p.cd = 0; const n0 = G.parts.length;
    const keep = Math.random; if (forceHit) Math.random = () => 0.01;
    Actions.alt(); let landed = null, k = 0; const pc0 = G.parts.length;
    step(1.4, each); Math.random = keep;
    const near = G.parts.filter(q => Math.abs(q.x - r.tg.x) < 40 && Math.abs(q.y - r.tg.y) < 40 && q.type !== 'dot').length;
    return { r, near, action: p.action };
  }
  const harePt = (x, y) => MK.hare(x, y);
  cell('stick', 'snow', 'палка падает в снег (облачко), остаётся лежать/торчать — можно подобрать',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 250); const res = throwAt(() => ({ from: { x: d.x, y: d.y }, tg: harePt(d.x + 110, d.y) }));
      const q = (G.litter || []).find(o => o.k === 'stick'); let lbl = null; if (q) { G.hares.length = 0; put(q.x - 14, q.y); const c = Actions.context(); lbl = c && c.label; }
      return ok(res.near > 0 && q && lbl === 'Подобрать палку', `облачко снега у цели: ${res.near} частиц; палка лежит ${q ? `в ${r1(q.x - d.x - 110)} px от цели` : 'нет'}; рядом: «${lbl}»`); }, 'js/actions.js land → dropStick (G.litter k stick)');
  na('stick', 'trail', 'как снег');
  cell('stick', 'bareIce', 'палка о голый лёд: стук, отскок/скольжение, без облака снега',
    () => { const s = iceSpot(true); const puffs = () => G.parts.filter(q => q.type === 'puff' && Math.abs(q.x - s.x - 40) < 40).length; const p0 = puffs();
      const res = throwAt(() => ({ from: { x: s.x - 60, y: s.y }, tg: harePt(s.x + 40, s.y) })); const q = (G.litter || []).find(o => o.k === 'stick');
      return ok(q && q.x > s.x + 50 && puffs() === p0, `облачков снега ${puffs() - p0}; палка проскользила до x−цель=${q ? r1(q.x - s.x - 40) : '—'} px`); }, 'js/actions.js land/slide, js/interact.js throw×ice');
  na('stick', 'iceSnow', 'как снег');
  na('stick', 'thinIce', 'масса палки ничтожна');
  cell('stick', 'water', 'палка в воде: всплеск, плывёт', () => { const w = waterPt(); const n0 = G.parts.length; throwAt(() => ({ from: { x: w.x - 120, y: w.y }, tg: harePt(w.x, w.y) }));
      const st = (G.litter || []).filter(o => o.k === 'stick').length, sp = G.parts.slice(n0).filter(q => q.type === 'steam' || q.type === 'ring' || q.type === 'drop' || q.type === 'bit').length;
      return ok(st === 0 && sp > 0, `палок на льду ${st}; брызг/пара ${sp}`); }, 'js/actions.js land (Ice.water), js/interact.js throw×wet');
  cell('stick', 'tree', 'ствол на пути броска — палка бьётся о дерево',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 250); const t = mkTree(d.x + 75, d.y - 4); t.wood = 9; let sh = 0; const res = throwAt(() => ({ from: { x: d.x, y: d.y }, tg: harePt(d.x + 150, d.y) }), false, () => { sh = Math.max(sh, t.shake || 0); });
      const q = (G.litter || []).find(o => o.k === 'stick');
      return ok(q && q.x < t.x && sh > 0, `палка ударилась о ствол: лежит в ${q ? r1(t.x - q.x) : '—'} px перед ним, дрожь дерева ${r2(sh)}`); }, 'js/actions.js stickPath → land');
  na('stick', 'log', 'бросок навесом — ствол не мешает');
  cell('stick', 'hut', 'из избы не бросить (стены)', () => { put(SPOT.bed.x, SPOT.bed.y + 4); P().inside = true; const w = Wolves.at(0, 300); w.x = P().x + 60; w.y = P().y; const t = Actions.altLabel(Actions.context()); return ok(!t || t[0] !== 'Бросить палку', `подсказка броска в избе: ${t ? t[0] : 'нет'}`); }, 'js/actions.js:531');
  na('stick', 'fire', '—');
  cell('stick', 'other', 'попал в волка — отпугнул; в зайца — может сбить',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 250); let w; const res = throwAt(() => { w = Wolves.at(0, 300); w.x = d.x + 110; w.y = d.y; w.st = 'circle'; return { from: { x: d.x, y: d.y }, tg: w }; }, true);
      return ok(w.st === 'flee', `волк после попадания: ${w.st}`); }, 'js/actions.js:576 land');

  // === костёр ===
  cell('fire', 'snow', 'костёр вытапливает снег вокруг (проталина растёт)',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); put(d.x, d.y); P().face = 1; G.inv.wood = 10; const f = lightFire();
      const x = f.x + 40, y = f.y, d0 = Depth.depthAt(x, y); frame(); G.time += 200; frame(); const d1 = Depth.depthAt(x, y);
      return ok(d1 < d0 * 0.8, `снег в 40 px от огня ${Math.round(d0)} → ${Math.round(d1)} см через 200 с без рисования (melt=${r2(f.melt || 0)} — Fire.tick)`); }, 'js/fire.js tick (melt), js/depth.js:136');
  na('fire', 'trail', 'как снег');
  // костёр на льду: разжечь F, герой отходит; за sec с — лужа (thaw), насквозь — дыра, костёр уходит в воду
  function fireIce(sp, sec) {
    put(sp.x - 30, sp.y); P().face = 1; G.inv.wood = 10; const h0 = holes(), f = lightFire();
    if (!f) return { n: 0 }; put(sp.x - 160, sp.y + 140); f.fuel = 1e4; let half = -1, t = 0;
    for (; t < sec && G.fires.includes(f); t += 0.25) { G.time += 0.25; Fire.tick(0.25, 0, false); if (half < 0 && f.thaw >= 0.4) half = t; }
    return { n: 1, f, half, t, hole: holes() > h0, gone: !G.fires.includes(f) };
  }
  const fiObs = r => r.n ? `разведено 1; лужа (лёд слабеет) через ${r.half >= 0 ? Math.round(r.half) + ' с' : '—'}; ${r.gone ? `провалился под лёд через ${Math.round(r.t)} с, дыра=${r.hole}` : 'держит'}` : 'не разжечь';
  cell('fire', 'bareIce', 'на толстом льду костёр горит, протаивает лужу; лёд может треснуть',
    () => { const r = fireIce(iceSpot(true), 400); return ok(r.n && r.half > 30 && r.gone && r.t > 120, fiObs(r)); }, 'js/actions.js fireKey (Ice.water), js/ice.js fireTick');
  cell('fire', 'iceSnow', 'то же, сначала тает снег', () => { const a = fireIce(iceSpot(true), 400).t; fresh(); const r = fireIce(iceSpot(false), 400); return ok(r.n && r.gone && r.t > a, fiObs(r) + ` (голый лёд — ${Math.round(a)} с)`); }, 'js/ice.js fireTick');
  cell('fire', 'thinIce', 'на тонком льду костёр проплавляет лёд → пробоина', () => { const r = fireIce(thinPt(), 60); return ok(r.n && r.gone && r.hole && r.t < 30, fiObs(r)); }, 'js/ice.js fireTick');
  na('fire', 'water', 'на воде костёр не развести');
  cell('fire', 'tree', 'костёр под елью: тепло сбрасывает снег с лап (может погасить), ствол обугливается',
    () => { const d = deepSpot(); clearTrees(d.x, d.y, 200); const t = mkTree(d.x + 20, d.y - 4); t.wood = 9; const f = mkFire(d.x, d.y, 900); put(d.x - 80, d.y); let sh = 0, n = 0, last = 0;
      step(40, () => { sh = Math.max(sh, t.shake || 0); if (f.hiss && f.hiss !== last) { last = f.hiss; n++; } });
      const burnt = 900 - f.fuel, base = 40 * Fire.burn(f, 0, false);
      return ok(sh > 0 && n > 0 && burnt > base + 10, `40 с: комьев снега с ели ${n}, дрожь ${r2(sh)}, топливо −${Math.round(burnt)} (без снега −${Math.round(base)})`); }, 'js/fire.js treeSnow');
  na('fire', 'log', 'см. «лежачий ствол × костёр»');
  cell('fire', 'hut', 'у стены избы не разжечь (сгорит)', () => { put(HUT.x + 40, HUT.y + 90); P().face = 1; G.inv.wood = 10; const n0 = G.fires.length; Actions.fireKey(); return ok(G.fires.length === n0, `разведено у избы: ${G.fires.length - n0}`); }, 'js/actions.js:767');
  na('fire', 'fire', '—');
  cell('fire', 'other', 'греет героя рядом; волки держатся за кругом огня', () => { const d = deepSpot(); const f = mkFire(d.x, d.y, 900); put(d.x + 30, d.y); const h = Fire.heatAt(P(), 0); return ok(h > 0 && Fire.protection(), `тепло ${r2(h)}, защита от волков r=${Fire.protection() ? Fire.protection().r : 0}`); }, 'js/fire.js:23 heatAt, :14 protection');

  // строгий режим: известные пустые/сломанные клетки, которые сознательно не чинятся (причина обязательна)
  const EXCEPT = {
    // 'chunk|fire': 'дрова — только через сумку: так задумано',
  };

  function run(o = {}) {
    const t0 = performance.now(); freeze();
    const out = { rows: ROWS, cols: COLS, rowN: ROWN, colN: COLN, cells: [], counts: { works: 0, broken: 0, none: 0, 'n/a': 0 }, except: EXCEPT };
    for (const r of ROWS) for (const c of COLS) {
      const k = r + '|' + c, d = CELLS[k];
      let res;
      if (!d) res = { row: r, col: c, st: 'n/a', exp: '', obs: 'клетка не задана', ev: '' };
      else if (d.na) res = { row: r, col: c, st: 'n/a', exp: d.na, obs: '', ev: '' };
      else {
        fresh(); R.render = false;
        try { const q = d.probe(); res = { row: r, col: c, st: q.st, exp: d.exp, obs: q.obs, ev: d.ev || '' }; }
        catch (e) { res = { row: r, col: c, st: 'broken', exp: d.exp, obs: 'ОШИБКА пробы: ' + (e && e.message), ev: d.ev || '', err: 1 }; }
        input.mx = input.my = 0; P()._keep = 0;
      }
      if (EXCEPT[k]) res.except = EXCEPT[k];
      out.counts[res.st] = (out.counts[res.st] || 0) + 1; out.cells.push(res);
    }
    out.ms = Math.round(performance.now() - t0);
    return out;
  }
  return { run, ROWS, COLS, CELLS };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
  const strict = process.argv.includes('--strict'), ji = process.argv.indexOf('--json');
  const jsonOut = ji > 0 ? process.argv[ji + 1] : path.resolve(__dirname, 'interact-matrix.json');
  const COL = { works: '\x1b[42;30m', broken: '\x1b[41;97m', none: '\x1b[43;30m', 'n/a': '\x1b[90m' }, RST = '\x1b[0m';
  const SYM = { works: ' ✓ ', broken: ' ✗ ', none: ' ∅ ', 'n/a': ' · ' };
  const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
  (async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(1000);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      const r = await pg.evaluate(() => InteractMatrix.run());
      const at = (row, col) => r.cells.find(c => c.row === row && c.col === col);
      console.log('\nМатрица взаимодействий «что × обо что»   ' + COL.works + SYM.works + RST + ' работает  ' + COL.broken + SYM.broken + RST + ' не работает  ' + COL.none + SYM.none + RST + ' нет механики  ' + COL['n/a'] + SYM['n/a'] + RST + ' n/a\n');
      console.log(pad('', 17) + r.cols.map(c => pad(r.colN[c], 11)).join(''));
      for (const row of r.rows) console.log(pad(r.rowN[row], 17) + r.cols.map(c => { const x = at(row, c); return COL[x.st] + SYM[x.st] + RST + ' '.repeat(8); }).join(''));
      console.log('\nИтого: работает ' + r.counts.works + ' · не работает ' + r.counts.broken + ' · нет механики ' + r.counts.none + ' · n/a ' + r.counts['n/a'] + '   (' + r.ms + ' мс)\n');
      for (const st of ['broken', 'none', 'works']) {
        console.log(COL[st] + ' ' + st.toUpperCase() + ' ' + RST);
        for (const x of r.cells.filter(c => c.st === st)) console.log('  ' + pad(r.rowN[x.row] + ' × ' + r.colN[x.col], 34) + x.obs + (x.ev ? '  [' + x.ev + ']' : '') + '\n' + ' '.repeat(36) + 'ожидание: ' + x.exp);
      }
      fs.writeFileSync(jsonOut, JSON.stringify(r, null, 1));
      console.log('\nJSON: ' + jsonOut);
      if (errs.length) console.log('Ошибки страницы:\n' + errs.join('\n'));
      const bad = r.cells.filter(c => (c.st === 'broken' || c.st === 'none') && !c.except);
      process.exitCode = strict && (bad.length || errs.length) ? 1 : 0;
      if (strict) console.log(bad.length ? `--strict: ${bad.length} клеток вне EXCEPT → провал` : '--strict: чисто');
    } finally { await b.close(); }
  })();
}
