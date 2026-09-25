const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html')));
  await pg.waitForTimeout(800);
  await pg.click('#start'); await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    const out = []; G.s.hp=1e9;
    const t = G.trees.find(t => !t.wall && t.wood > 0 && Math.hypot(t.x - POI.tail.x, t.y - POI.tail.y) < 700);
    G.vera.state = 'follow'; G.vera.x = t.x + 200; G.vera.y = t.y;
    G.p.x = t.x + 30; G.p.y = t.y; input.mx = input.my = 0;
    for (let i = 0; i < 100; i++) update(0.05);
    out.push('near tree, vera follow: ctx=' + (context()||{}).k + ' veraDist=' + dist(G.vera, G.p).toFixed(0) + ' treeDist=' + dist(t, G.p).toFixed(0));
    // day 7 cutoff with evening contact on day 6
    G.flags.radioBuilt = 1; G.p.x = SPOT.bench.x; G.p.y = SPOT.bench.y; G.time = tAt(6, 19.6); G.day = 6; G.lastDawn = 6; update(0.01);
    radioSession(); document.getElementById('dialog').hidden = true;
    out.push('contact ' + G.flags.contact + ' contactDay ' + G.flags.contactDay);
    for (let i = 0; i < 2000 && state === 'play'; i++) update(0.05);
    out.push('state=' + state + ' day=' + G.day + ' h=' + hourOf().toFixed(2) + ' heli=' + !!G.heli + ' ending title=' + document.getElementById('o-title').textContent);
    return out;
  });
  console.log(r.join('\n'));
  await b.close();
})();
