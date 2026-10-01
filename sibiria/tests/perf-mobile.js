// Частота кадров на «телефоне»: iPhone 13 / Pixel 7, CPU ×4 (CDP), ночной посёлок.
// node perf-mobile.js [throttle=4] [seconds=6]
// SCENE=forest — лес (js/tree3d.js): густой ельник в кадре, 3 ели всё время трясут (живая модель), 2 сваленных ствола,
//   один обрублен и раскряжёван (лапник и чурки на снегу); Q=low|high — качество принудительно; DEV=iPhone — одно устройство
const { chromium, devices } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const THR = +(process.argv[2] || 4), SEC = +(process.argv[3] || 6);

// ночная сцена посёлка: 12 людей, 5 построек, костры, стая у края
const SCENE = () => {
  G.s.hp = 1e9; G.time = tAt(2, 22.5); G.day = 2; G.col.ep = 2;
  G.p.x = HUT.x + 60; G.p.y = HUT.y + 260;
  const spots = [[-260, 180], [260, 200], [-200, 380], [240, 400], [0, 480]];
  ['balok', 'woodshed', 'smoke', 'forge', 'tower'].forEach((t, i) => G.col.builds.push({ id: G.col.nextId++, type: t, x: HUT.x + spots[i][0], y: HUT.y + spots[i][1], prog: 1, done: 1, fuel: 60 }));
  const types = ['bich', 'bich', 'bich', 'bich', 'bich', 'evenk', 'evenk', 'strelok', 'strelok', 'laika', 'bich', 'bich'];
  types.forEach((t, i) => Colony.spawn(t, { x: HUT.x - 150 + (i % 6) * 60, y: HUT.y + 300 + ((i / 6) | 0) * 60 }));
  G.fires.push({ x: HUT.x + 120, y: HUT.y + 330, fuel: 9999 }, { x: HUT.x - 120, y: HUT.y + 420, fuel: 9999 });
  G.hut.fuel = 900; Object.assign(G.hut, { walls: 1, door: 1 });
  for (let i = 0; i < 5; i++) update(0.05);
};
const FOREST = () => {
  G.s.hp = 1e9; G.time = tAt(1, 12); G.wolves = []; G.bear = null;
  // самое густое место леса (вне стены): больше всего деревьев в кадре
  const ok = t => t.wood > 0 && !t.wall && t.kind === 0 && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 500;
  let best = null, bn = 0; for (const t of G.trees) { if (!ok(t) || Math.random() > 0.08) continue; const n = G.trees.filter(q => q.wood > 0 && Math.abs(q.x - t.x) < 260 && Math.abs(q.y - t.y) < 180).length; if (n > bn) { bn = n; best = t; } }
  G.p.x = best.x + 30; G.p.y = best.y + 40; if (typeof Hero !== 'undefined') Hero.snap();
  const near = G.trees.filter(q => ok(q) && Math.hypot(q.x - best.x, q.y - best.y) < 260).sort((a, b) => Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y));
  window.__shake = near.slice(0, 3); window.__perfN = G.trees.filter(q => q.wood > 0 && Math.abs(q.x - G.p.x) < 300 && Math.abs(q.y - G.p.y) < 220).length;
  setInterval(() => { for (const t of window.__shake) World.shakeTree(t, 0.35); }, 300);
  for (const t of near.slice(3, 5)) { t.wood = 0; World.felled(t); const L = Actions.fell(t); delete L.f; if (L.sk && t === near[4]) { for (let i = 0; i < 3; i++) Tree.split(L, 'limb'); while (L.n > 0) Tree.split(L, 'buck'); G.logs.splice(G.logs.indexOf(L), 1); } }
  for (let i = 0; i < 5; i++) update(0.05);
};

async function measure(dev, landscape) {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  const d = devices[dev];
  const vp = landscape ? { width: d.viewport.height, height: d.viewport.width } : d.viewport;
  const ctx = await b.newContext({ ...d, viewport: vp });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(600);
  await pg.evaluate(() => { try { localStorage.clear(); localStorage.setItem('sibir-tips', '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}'); } catch (e) {} });
  await pg.tap('#start'); await pg.waitForTimeout(3800);
  if (process.env.Q) await pg.evaluate(q => Quality.set(q), process.env.Q);
  await pg.evaluate(process.env.SCENE === 'forest' ? FOREST : SCENE);
  const nTrees = await pg.evaluate(() => window.__perfN || 0);
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
  // headless-Chrome держит rAF на 30 Гц, поэтому меряем работу кадра: время внутри колбэка rAF
  // (обновление + рендер + HUD). Оценка fps = 1000 / max(средний кадр, 16.7 мс).
  await pg.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window); window.__perf = []; window.__iv = []; let last = 0;
    window.requestAnimationFrame = cb => raf(t => { if (last) window.__iv.push(t - last); last = t; const a = performance.now(); cb(t); window.__perf.push(performance.now() - a); });
  });
  const fps = sec => pg.evaluate(sec => new Promise(res => {
    window.__perf.length = 0; window.__iv.length = 0;
    setTimeout(() => {
      const a = window.__perf.slice().sort((x, y) => x - y), avg = a.reduce((s, x) => s + x, 0) / a.length, p95 = a[Math.floor(a.length * 0.95)];
      const iv = window.__iv.reduce((s, x) => s + x, 0) / window.__iv.length;
      res({ fps: +(1000 / iv).toFixed(1), ms: +avg.toFixed(1), p95: +p95.toFixed(1), q: window.QUALITY || 'high' });
    }, sec * 1000);
  }), sec);
  await pg.waitForTimeout(500);
  const first = await fps(SEC);        // первые секунды (авто-качество ещё решает)
  await pg.waitForTimeout(500);
  const settled = await fps(SEC);      // после решения авто-качества
  if (process.env.SHOT) await pg.screenshot({ path: __dirname + '/shots/perf-' + dev.replace(/ /g, '') + (landscape ? '-l' : '-p') + '.png' });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await b.close();
  return { dev: dev + (landscape ? ' ⟷' : ' ↕'), first, settled, errs: errs.length, nTrees };
}

(async () => {
  for (const [dev, land] of [['iPhone 13', false], ['iPhone 13', true], ['Pixel 7', false], ['Pixel 7', true]]) {
    if (process.env.DEV && !dev.includes(process.env.DEV)) continue;
    const r = await measure(dev, land);
    console.log(`${r.dev.padEnd(14)} ×${THR}  first ${r.first.fps} fps (${r.first.q}, ${r.first.ms} ms/кадр, p95 ${r.first.p95})  → settled ${r.settled.fps} fps (${r.settled.q}, ${r.settled.ms} ms/кадр, p95 ${r.settled.p95})  errors ${r.errs}${r.nTrees ? ' · деревьев у героя ' + r.nTrees : ''}`);
  }
})();
