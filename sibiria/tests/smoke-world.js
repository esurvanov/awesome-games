// Мир любого размера: плотности от площади, детерминизм генерации по seed, сейв «seed + изменения»
// (save → load → глубокое сравнение G без расхождений, повторный save байт в байт), размер сейва,
// туман и мини-карта за пределами 3600, замер update. Прогон при ×1 (?world=3600) и при ×9 (по умолчанию).
// Лес: плотность тайги × площадь × средняя плотность зон (Zones.meanDens: гарь, голец, курумник реже).
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

// сцена «поздняя игра» + проверки; выполняется в странице
function scene() {
  const out = { W, H }, fails = [];
  const ok = (c, what) => { if (!c) fails.push(what); };
  document.querySelectorAll('#dialog,#note,#chapter').forEach(e => e.hidden = true);
  // 1. плотности от площади
  const k = W * H / (3600 * 3600), inner = G.trees.filter(t => !t.wall).length;
  out.trees = inner; out.hares = G.hares.length; out.drifts = G.drifts.length; out.ravens = G.ravens.length; out.cracks = G.cracks.length;
  out.meanDens = +Zones.meanDens.toFixed(3);
  ok(Math.abs(inner / (k * Zones.meanDens) - 820) <= 820 * 0.1, `деревья ${inner} ≈ 820×${k}×${out.meanDens}`);
  // тайга (вне зон и ядра) — те же ≈ 72 дерева на экран, что и при ×1
  let tc = 0, tn = 0; for (let q = 0; q < Zones.NX * Zones.NY; q++) if (!Zones.zid(q)) tc++;
  for (const t of G.trees) if (!t.wall && !Zones.at(t.x, t.y)) tn++;
  out.taiga = tc * Zones.C * Zones.C > 4e6 ? Math.round(tn / (tc * Zones.C * Zones.C) * 3600 * 3600) : 820;
  ok(Math.abs(out.taiga - 820) <= 820 * 0.1, 'плотность тайги ' + out.taiga + ' ≈ 820 на 3600²');
  ok(G.drifts.length === Math.round(340 * k) && G.hares.length === Math.round(16 * k) && G.ravens.length === Math.round(14 * k), 'сугробы/зайцы/вороны = плотность × площадь');
  ok(G.fog.length === Math.ceil(W / 100) * Math.ceil(H / 100), 'туман покрывает мир');
  for (const id in POI) ok(POI[id].x > 0 && POI[id].x < W && POI[id].y > 0 && POI[id].y < H, 'POI в мире: ' + id);
  ok(G.amuletsAt.length === TUNE.world.amulets, 'обереги: ' + G.amuletsAt.length);
  // 2. детерминизм генерации: тот же seed → тот же мир
  const hash = () => { let h = 0; for (const a of [G.trees, G.drifts, G.cracks, G.tussocks, G.amuletsAt]) for (const o of a) h = (h * 31 + (o.x | 0) * 7 + (o.y | 0) + (o.kind | 0)) | 0; return h; };
  const h0 = hash(), keep = G;
  G = Object.assign({}, keep, { trees: [], drifts: [], cracks: [], tussocks: [] }); { const r = mulberry(keep.seed); World.gen(r); World.genLiving(r); }
  const h1 = hash(); G = keep; World.buildGrid();
  ok(h0 === h1, 'генерация детерминирована по seed');
  // 3. сцена: посёлок, срубленные деревья, волки, герой рубит
  G.s.hp = 1e9; G.time = tAt(2, 11); G.day = 2; G.lastDawn = 2; G.col.ep = 2;
  const hx = HUT.x, hy = HUT.y;
  for (const [type, dx, dy] of [['balok', -260, 120], ['woodshed', 260, 140], ['smoke', -300, -120], ['tower', 250, -160], ['labaz2', 0, 320]]) G.col.builds.push({ id: G.col.nextId++, type, x: hx + dx, y: hy + dy, prog: 1, done: 1, hp: 60 });
  ['bich', 'bich', 'bich', 'bich', 'bich', 'bich', 'evenk', 'evenk', 'evenk', 'strelok', 'strelok', 'laika'].forEach((t, i) => {
    const u = Colony.spawn(t, { x: hx + Math.cos(i) * 200, y: hy + 200 + Math.sin(i) * 100 });
    u.task = t === 'bich' ? { k: 'chop', ph: 'go', near: { x: u.x, y: u.y } } : t === 'evenk' ? { k: 'hunt', ph: 'go' } : { k: 'guard' };
  });
  for (const t of G.trees) if (!t.wall && Math.hypot(t.x - hx, t.y - hy) < 700 && Math.random() < 0.3) { t.wood = 0; World.felled(t); }
  Object.assign(G.chest, { meat: 50, wood: 30 });
  G.p.x = hx + 300; G.p.y = hy + 400;
  G.traps.push({ x: hx + 500, y: hy, kind: 'snare', catch: null, t: 0 });
  for (let i = 0; i < 1200; i++) update(1 / 20);
  // замер update: ночь со стаей и день
  const bench = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) { update(1 / 60); if (G.s.hp < 1e8) G.s.hp = 1e9; } return (performance.now() - t0) / n; };
  G.time = tAt(2, 22.5); G.D.dir = 1; Wolves.spawnPack(4, false); bench(120);
  out.updNight = +bench(1200).toFixed(4);
  G.time = tAt(3, 12); G.wolves = []; G.pack = null; bench(60);
  out.updDay = +bench(1200).toFixed(4);
  // ночь: у людей задачи, герой рубит (ссылка на дерево в действии)
  G.time = tAt(3, 22.5); Wolves.spawnPack(3, false); for (let i = 0; i < 60; i++) update(1 / 60);
  const tr = G.trees.find(t => !t.wall && t.wood > 0 && Math.hypot(t.x - G.p.x, t.y - G.p.y) < 400);
  if (tr) { G.p.x = tr.x + 30; G.p.y = tr.y; input.mx = input.my = 0; G.p.action = { k: 'chop', t: 0, dur: Hero.chopTime(), o: tr }; update(1 / 60); }
  ok(G.p.action && G.p.action.k === 'chop', 'герой рубит перед сейвом' + (G.p.action && G.p.action.k === 'chop' ? '' : ` (дерево ${tr ? 'есть' : 'нет'}, действие ${G.p.action && G.p.action.k}, iT ${(G.p.iT || 0).toFixed(2)}, лёд ${onIce(G.p.x, G.p.y)}, волки ${G.wolves.map(w => w.st + ':' + Math.round(Math.hypot(w.x - G.p.x, w.y - G.p.y))).join(',')})`));
  // 4. save → load → глубокое сравнение
  const s1 = SaveGame.snapshot(); out.saveKB = +(s1.length / 1024).toFixed(1);
  const old = G; SaveGame.load(s1);
  const diffs = [], seen = new Map(), SKIP = new Set(['prints', 'parts']);
  (function cmp(a, b, p) {
    if (diffs.length > 20 || a === b) return;
    if (typeof a !== typeof b || !a || !b || typeof a !== 'object') { if (!(Number.isNaN(a) && Number.isNaN(b))) diffs.push(p + ': ' + String(JSON.stringify(a)).slice(0, 50) + ' ≠ ' + String(JSON.stringify(b)).slice(0, 50)); return; }
    if (seen.get(a) === b) return; seen.set(a, b);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!SKIP.has(key) && !(a[key] === undefined && b[key] === undefined)) cmp(a[key], b[key], p + '.' + key);
  })(old, G, 'G');
  out.diffs = diffs;
  ok(!diffs.length, 'save→load без расхождений: ' + diffs.slice(0, 3).join(' | '));
  ok(G.p.action && G.trees.includes(G.p.action.o), 'действие героя ссылается на дерево мира');
  ok(G.col.units.every(u => [u.task, u.prev].every(t => !t || !t.tree || G.trees.includes(t.tree))), 'задачи людей ссылаются на деревья мира');
  ok(SaveGame.snapshot() === s1, 'повторный save байт в байт');
  ok(s1.length < 80 * 1024, `сейв ${out.saveKB} КБ < 80`);
  // 5. туман и мини-карта в дальнем углу
  G.p.x = W - 1000; G.p.y = H - 1000; World.reveal();
  ok(G.fog[Math.floor((H - 1000) / 100) * Math.ceil(W / 100) + Math.floor((W - 1000) / 100)] === 1, 'туман открывается в углу мира');
  for (let i = 0; i < 300; i++) update(1 / 20);
  return { out, fails };
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const log = [], fail = [];
  try {
    const res = {};
    for (const [tag, q] of [['×1', '?world=3600'], ['×9', '']]) {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
      const errs = [];
      pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
      await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await pg.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
      await pg.goto(URL + q); await pg.waitForTimeout(500);
      await pg.click('#start'); await pg.waitForTimeout(500);
      const r = await pg.evaluate(scene);
            for (let i = 0; i < 5 && await pg.evaluate(() => UI.modal()); i++) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(120); }
      // мини-карта: окно MAP_SPAN вокруг героя (×1 — весь мир, больше — 2 400 px); клик в точку героя на карте → камера к герою
      const mm = await pg.evaluate(() => {
        const e = document.getElementById('minimap').getBoundingClientRect(), S = W > 3600 ? 2400 : Math.min(W, H);
        const wx = clamp(G.p.x - S / 2, 0, W - S), wy = clamp(G.p.y - S / 2, 0, H - S);
        return { x: e.left + (G.p.x - wx) / S * e.width, y: e.top + (G.p.y - wy) / S * e.height };
      });
      await pg.waitForTimeout(400);
      // за 400 мс игра идёт дальше — сюжет мог открыть окно (диалог/записка): закрыть его перед кликом, иначе клик уходит в окно
      for (let i = 0; i < 5 && await pg.evaluate(() => UI.modal()); i++) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(120); }
      await pg.mouse.click(mm.x, mm.y); await pg.waitForTimeout(100);
      const cm = await pg.evaluate(() => ({ d: Math.hypot(cam.x + GFX.vw / 2 - G.p.x, cam.y + GFX.vh / 2 - G.p.y), st: state, modal: UI.modal() }));
      if (!(cm.d < 150)) r.fails.push('мини-карта: клик по герою → камера у героя ' + JSON.stringify(cm));
      res[tag] = r.out;
      log.push(`${tag} ${r.out.W}×${r.out.H}: деревья ${r.out.trees} (тайга ${r.out.taiga}/3600²), зайцы ${r.out.hares}, сугробы ${r.out.drifts}, вороны ${r.out.ravens}, трещины ${r.out.cracks} · сейв ${r.out.saveKB} КБ · update ночь ${r.out.updNight} мс, день ${r.out.updDay} мс`);
      for (const f of r.fails) { log.push(`FAIL ${tag} ${f}`); fail.push(f); }
      for (const e of errs) { log.push(e); fail.push(e); }
      await pg.close();
    }
    const k = Math.max(res['×9'].updNight / res['×1'].updNight, res['×9'].updDay / res['×1'].updDay);
    log.push(`update ×9 / ×1: ${k.toFixed(2)} (цель ≤ 1.5; порог теста 2.5 — замер шумный)`);
    if (k > 2.5) { log.push('FAIL update при ×9 заметно медленнее'); fail.push('perf'); }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  console.log(fail.length ? `ERR world: ${fail.length} проверок не прошло` : 'world: все проверки прошли');
  process.exitCode = fail.length ? 1 : 0;
})();
