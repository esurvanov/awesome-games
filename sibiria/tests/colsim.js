const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  pg.on('pageerror', e => console.log('PAGEERR ' + e.message));
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html'))); await pg.waitForTimeout(800);
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await pg.click('#start'); await pg.waitForTimeout(400);
  for (const f of ['bot.js', 'plan.js', 'col.js']) await pg.addScriptTag({ path: __dirname + '/' + f });
  const sc = JSON.parse(process.argv[2]);
  const r = await pg.evaluate((sc) => {
    Object.assign(BOT.colOpt, sc.opt || {});
    G.p.x = HUT.x; G.p.y = HUT.y; G.p.inside = true; G.flags.stoveLit = 1; G.hut.walls = G.hut.door = G.hut.bench = 1;
    Object.assign(G.chest, sc.chest || {});
    G.chapter = sc.ch || 2; G.urk.respect = sc.respect || 2;
    BOT.goTo = (x, y) => { G.p.x = x; G.p.y = y; G.p.inside = insideHut(x, y); return true; };
    BOT.enterHut = () => { G.p.x = HUT.x; G.p.y = HUT.y; G.p.inside = true; };
    const dt = 0.05; let T = 0, trades = 0;
    const ep = {};
    while (T < sc.sec && state === 'play') {
      G.s.warm = 100; G.s.food = 100; G.s.hp = 100; G.hut.fuel = 200;
      if (!G.p.inside || Math.random() < 0.001) BOT.enterHut();
      update(dt); BOT.T += dt; BOT.R += dt; T += dt;
      if ((T % 60) < dt && hourOf() > 8 && hourOf() < 18 && sc.trade) BOT.tradeRun();
      if (!ep[G.col.ep]) ep[G.col.ep] = { d: G.day, h: +hourOf().toFixed(1), min: +(T / 60).toFixed(1) };
    }
    const M = BOT.col;
    return { ep, state, end: document.getElementById('o-title').textContent, day: G.day, col: { ep: G.col.ep, pop: Colony.pop(), builds: G.col.builds.map(b => b.type + (b.done ? '' : '*')), techs: Object.keys(G.col.techs), rub: G.col.rub },
      series: M.series.filter((x, i) => i % 6 === 0).map(s => `${s.d}/${s.h}h ep${s.ep} pop${s.pop}/${s.cap} food${s.food} wood${s.wood} scr${s.scrap} ₽${s.rub}`),
      gath: M.gath, workT: M.workT, deaths: M.deaths.length, trades: M.trades, ev: M.ev.filter(e => /эпох|💀|торг|лес|изуч/.test(e)).slice(0, 40), epBlock: M.epBlock };
  }, sc);
  console.log(JSON.stringify(r, null, 0));
  await b.close();
})();
