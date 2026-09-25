const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage();
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html'))); await pg.waitForTimeout(800);
  await pg.click('#start'); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => {
    G.col.builds.push({ id: 999, type: 'market', x: G.p.x + 50, y: G.p.y, prog: 1, done: 1 });
    const out = {};
    G.chest.wood = 300; let rub0 = G.col.rub, seq = [];
    for (let i = 0; i < 150; i++) { const r0 = G.col.rub; Colony.sell('wood'); seq.push(G.col.rub - r0); }
    out.sell150wood = { rub: G.col.rub - rub0, first: seq.slice(0, 5), at50: seq[50], last: seq.slice(-3), priceAfter: +G.col.prices.wood.toFixed(2) };
    // арбитраж: купить мясо и продать
    G.col.rub = 100; const m0 = G.col.rub; Colony.buy('meat'); Colony.sell('meat'); out.meatRoundTrip = G.col.rub - m0;
    G.urk.respect = 3; G.col.rub = 100; Colony.buy('wood'); Colony.sell('wood'); out.woodRoundTripResp3 = G.col.rub - 100;
    // сколько железа на 100₽
    G.col.rub = 100; let sc = 0; while (Colony.buy('scrap')) sc++; out.scrapPer100 = sc;
    // день инфляции
    const p0 = G.col.prices.wood; Colony.newDay(); out.woodAfterDay = +(G.col.prices.wood / p0).toFixed(3);
    out.pelt = Colony.sellPrice('wpelt'); out.hare = Colony.sellPrice('hare'); out.sable = Colony.sellPrice('sable');
    return out;
  });
  console.log(JSON.stringify(r)); await b.close();
})();
