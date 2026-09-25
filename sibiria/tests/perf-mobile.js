// Частота кадров на «телефоне»: iPhone 13 / Pixel 7, CPU ×4 (CDP), ночной посёлок.
// node perf-mobile.js [throttle=4] [seconds=6]
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
  await pg.evaluate(SCENE);
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
  return { dev: dev + (landscape ? ' ⟷' : ' ↕'), first, settled, errs: errs.length };
}

(async () => {
  for (const [dev, land] of [['iPhone 13', false], ['iPhone 13', true], ['Pixel 7', false], ['Pixel 7', true]]) {
    if (process.env.DEV && !dev.includes(process.env.DEV)) continue;
    const r = await measure(dev, land);
    console.log(`${r.dev.padEnd(14)} ×${THR}  first ${r.first.fps} fps (${r.first.q}, ${r.first.ms} ms/кадр, p95 ${r.first.p95})  → settled ${r.settled.fps} fps (${r.settled.q}, ${r.settled.ms} ms/кадр, p95 ${r.settled.p95})  errors ${r.errs}`);
  }
})();
