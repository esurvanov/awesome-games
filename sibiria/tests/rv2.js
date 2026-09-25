const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html')));
  await pg.waitForTimeout(800);
  await pg.click('#start');
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    const out = [];
    G.vera.state = 'hut'; G.vera.x = SPOT.veraBed.x; G.vera.y = SPOT.veraBed.y;
    G.urk.state='chum'; G.urk.x=POI.chum.x; G.urk.y=POI.chum.y;
    let bed = 0, total = 0; const kinds = {};
    for (let x = HUT_IN.x0 + 10; x <= HUT_IN.x1 - 10; x += 2) for (let y = HUT_IN.y0 + 10; y <= HUT_IN.y1 - 1; y += 2) {
      G.p.x = x; G.p.y = y; G.p.inside = insideHut(x, y);
      const c = context(); const k = c ? c.k : 'none'; kinds[k] = (kinds[k] || 0) + 1; total++;
    }
    out.push('with Vera in hut: ' + JSON.stringify(kinds));
    // bed spot itself
    G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y; out.push('at bed spot ctx=' + (context()||{}).k);
    // trySleep puts at bed; after wake(false) can player sleep again by E?
    return out;
  });
  console.log(r.join('\n')); console.log(errs.join('\n'));
  await b.close();
})();
