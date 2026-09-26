const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html')));
  await pg.waitForTimeout(800); await pg.click('#start'); await pg.waitForTimeout(3600);
  const r = await pg.evaluate(() => {
    const log = []; const step = n => { for (let i = 0; i < n && state === 'play'; i++) update(0.05); };
    try {
      G.s.hp = 1e6; G.chest = { wood: 200, meat: 60, fish: 20, scrap: 20, hare: 10, sable: 3 };
      G.p.x = HUT.x + 200; G.p.y = HUT.y + 150; update(0.05);
      const put = (t, x, y) => { G.col.ghost = { type: t, x, y }; Colony.place(); return G.col.builds.length; };
      log.push('place balok ' + put('balok', HUT.x + 260, HUT.y + 40) + ' woodshed ' + put('woodshed', HUT.x - 300, HUT.y + 120) + ' smoke ' + put('smoke', HUT.x + 260, HUT.y + 200));
      G.p.x = HUT.x; G.p.y = HUT_IN.y1 + 60; update(0.05);
      for (let i = 0; i < 4; i++) Colony.hire('bich'); log.push('queue ' + G.col.queue.length + ' pop ' + Colony.pop() + '/' + Colony.popCap());
      step(1200); log.push('units ' + G.col.units.map(u => u.type + ':' + u.task.k).join(',') + ' builds ' + G.col.builds.map(b => b.type + (b.done ? '✓' : Math.round(b.prog * 100))).join(','));
      step(2400); log.push('builds ' + G.col.builds.map(b => b.type + (b.done ? '✓' : Math.round(b.prog * 100))).join(',') + ' chest wood ' + G.chest.wood);
      G.col.sel = G.col.units.map(u => u.id); Colony.setTaskAll('chop'); step(1200); log.push('after chop wood ' + G.chest.wood + ' tasks ' + G.col.units.map(u => u.task.k + '/' + u.task.ph).join(','));
      log.push('epoch state ' + Colony.epochState()); Colony.advance(); step(1000); log.push('ep ' + G.col.ep);
      G.col.ghost = { type: 'tower', x: HUT.x + 60, y: HUT.y + 260 }; Colony.place(); G.col.ghost = { type: 'forge', x: HUT.x - 250, y: HUT.y - 150 }; Colony.place(); G.col.ghost = { type: 'market', x: HUT.x + 350, y: HUT.y - 150 }; Colony.place();
      for (const bb of G.col.builds) { bb.prog = 1; bb.done = 1; if (bb.type === 'tower') bb.fuel = 60; }
      Colony.hire('evenk'); Colony.hire('laika'); step(400); log.push('units ' + G.col.units.length + ' research ' + Colony.research('saw2'));
      G.p.x = HUT.x + 350; G.p.y = HUT.y - 90; update(0.05); log.push('market near ' + Colony.nearMarket() + ' sell ' + Colony.sell('wood') + ' rub ' + G.col.rub);
      Colony.alarm(); step(200); log.push('hidden ' + G.col.units.filter(u => u.hidden).length + '/' + G.col.units.length); Colony.alarm(); step(100);
      G.time = tAt(G.day, 12); Wolves.spawnPack(3, false); G.wolves.forEach(w => { w.x = HUT.x + 60; w.y = HUT.y + 320; }); step(300); log.push('wolves left ' + G.wolves.length + ' units ' + G.col.units.length);
      Actions.sniff(); step(20); log.push('sniff hits ' + G.sniff.hits.length);
      G.p.x = riverX(1900); G.p.y = 1900; update(0.05); G.holes.push({ x: G.p.x + 20, y: G.p.y + 4, fish: 3 }); Actions.interact(false); step(100); log.push('fish ph ' + (G.p.action && G.p.action.ph));
      G.p.action && (G.p.action.z = 0, G.p.action.w = 1); log.push('strike ' + Actions.fishStrike() + ' fish ' + G.inv.fish);
      SaveGame.checkpoint(); SaveGame.load(checkpoint); step(200); log.push('reload units ' + G.col.units.length + ' ep ' + G.col.ep);
    } catch (e) { log.push('ERR ' + e.message + ' ' + e.stack); }
    return log;
  });
  console.log(r.join('\n'));
  await pg.evaluate(() => { G.p.x = HUT.x + 150; G.p.y = HUT.y + 150; G.time = tAt(G.day, 13); cam.x = G.p.x - 640; cam.y = G.p.y - 400; G.col.sel = G.col.units.slice(0, 3).map(u => u.id); });
  await pg.waitForTimeout(900); await pg.screenshot({ path: OUT + '11-colony.png' });
  await pg.evaluate(() => { G.time = tAt(G.day, 20.5); G.aurora = 1; });
  await pg.waitForTimeout(900); await pg.screenshot({ path: OUT + '12-colony-night.png' });
  await pg.evaluate(() => { G.time = tAt(G.day, 12); UI.openCraft('epoch'); });
  await pg.waitForTimeout(500); await pg.screenshot({ path: OUT + '13-epoch.png' });
  console.log(errs.slice(0, 10).join('\n') || 'no page errors');
  await b.close();
})();
