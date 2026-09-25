const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  pg.on('pageerror', e => console.log('PAGEERR ' + e.message));
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html'))); await pg.waitForTimeout(800);
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await pg.click('#start'); await pg.waitForTimeout(400);
  const scen = JSON.parse(process.argv[2]);
  const r = await pg.evaluate((sc) => {
    // игрок сидит в избе с печью, чтобы не мешать
    G.p.x = HUT.x; G.p.y = HUT.y; G.p.inside = true; G.flags.stoveLit = 1; G.hut.walls = G.hut.door = G.hut.bench = 1;
    G.chest.meat = 500; G.D.budget = sc.wolves ? 80 : 0; if (sc.ch) G.chapter = sc.ch;
    const fc = { x: HUT.x - 380, y: HUT.y + 50 };
    for (const bt of sc.builds || []) {
      const pos = bt === 'woodshed' ? fc : bt === 'smoke' ? { x: (HUT.x + riverX(HUT.y)) / 2 + 40, y: HUT.y + 60 } : { x: HUT.x + (Math.random() - 0.5) * 300, y: HUT.y + 220 + Math.random() * 100 };
      let p = null; for (let r = 0; r < 500 && !p; r += 20) for (let a = 0; a < 6.28 && !p; a += 0.3) if (Colony.canPlace(bt, pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r)) p = { x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r };
      G.col.builds.push({ id: G.col.nextId++, type: bt, x: p.x, y: p.y, prog: 1, done: 1 });
    }
    if (sc.ep) G.col.ep = sc.ep;
    for (const t of sc.techs || []) G.col.techs[t] = 1;
    const us = [];
    for (let i = 0; i < sc.n; i++) {
      const u = Colony.spawn(sc.type || 'bich');
      if (sc.task === 'fish') { const y = HUT.y + 40 + (i % 4) * 30; u.task = { k: 'fish', ph: 'go', x: riverX(y) + ((i / 4 | 0) - 0.5) * 40, y }; }
      else if (sc.task === 'chop') u.task = { k: 'chop', ph: 'go', near: sc.builds && sc.builds.includes('woodshed') ? fc : { x: HUT.x, y: HUT.y + 100 } };
      else if (sc.task === 'hunt') u.task = { k: 'hunt', ph: 'go' };
      us.push(u);
    }
    const c0 = Object.assign({}, G.chest);
    let T = 0, work = 0, hid = 0; const dt = 0.05;
    const gathered = {}; const deaths = [], packs = [];
    while (T < sc.sec) {
      G.s.warm = 100; G.s.food = 100; G.s.hp = 100; G.p.x = HUT.x; G.p.y = HUT.y; G.p.inside = true; G.hut.fuel = 200;
      if (sc.alarm) { const d = G.wolves.some(w => dist2(w, HUT) < 700 * 700); if (d !== G.col.alarm) Colony.alarm(); }
      const ids0 = G.col.units.map(u => u.id + ':' + u.task.k + ':' + (u.hidden?1:0));
      update(dt); T += dt;
      if (G.col.units.length < ids0.length) { const now = new Set(G.col.units.map(u => u.id)); for (const x of ids0) if (!now.has(+x.split(':')[0])) deaths.push(x + ' d' + G.day + ' ' + hourOf().toFixed(2) + 'h wolves' + G.wolves.length + (G.bear?' bear':'')); }
      if (G.pack && !packs.includes(G.pack)) packs.push(G.pack);
      for (const u of G.col.units) if (!u.pet) { if (u.hidden || u.task.k === 'shelter') hid += dt; else work += dt; }
      if (state !== 'play') break;
    }
    const d = {}; for (const k in G.chest) { const v = (G.chest[k] || 0) - (c0[k] || 0); if (v) d[k] = v; }
    return { sc, delta: d, alive: G.col.units.length, unitMin: +(sc.n * T / 60).toFixed(1), workMin: +(work / 60).toFixed(1), hidMin: +(hid / 60).toFixed(1), day: G.day, h: +hourOf().toFixed(1), wolves: G.stats.wolves, hp: G.col.units.map(u => u.hp | 0), trees: G.trees.filter(t => t.wood > 0 && Math.hypot(t.x - HUT.x, t.y - HUT.y) < 700).length, state, deaths, packs: packs.length, towerFuelWood: 0 };
  }, scen);
  const food = ['meat','fish','dried'].reduce((s,k)=>s+(r.delta[k]||0),0) + 0; // meat baseline 500 eaten out
  console.log(JSON.stringify(r));
  await b.close();
})();
