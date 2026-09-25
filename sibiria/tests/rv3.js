const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html')));
  await pg.waitForTimeout(800);
  await pg.click('#start'); await pg.waitForTimeout(3800);
  await pg.evaluate(() => { G.inv.wood = 5; G.p.x = SPOT.chest.x; G.p.y = SPOT.chest.y; update(0.05); UI.openChest(); });
  await pg.waitForTimeout(200);
  let lost = 0;
  for (let i = 0; i < 20; i++) {
    const before = await pg.evaluate(() => G.inv.wood);
    const bt = await pg.$('button[data-put="wood"]');
    if (!bt) { await pg.evaluate(() => { G.inv.wood = 5; G.chest.wood=0; UI.openChest(); }); continue; }
    const bb = await bt.boundingBox();
    await pg.mouse.move(bb.x + 5, bb.y + 5); await pg.mouse.down(); await pg.waitForTimeout(120); await pg.mouse.up();
    await pg.waitForTimeout(50);
    const after = await pg.evaluate(() => G.inv.wood);
    if (after === before) lost++;
    if (after <= 0) await pg.evaluate(() => { G.inv.wood = 5; G.chest.wood = 0; });
  }
  console.log('lost clicks (120ms press):', lost, '/ 20');
  await b.close();
})();
