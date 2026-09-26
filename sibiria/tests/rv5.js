const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html')));
  await pg.waitForTimeout(800);
  await pg.click('#start'); await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    const out = []; G.s.hp=1e9;
    G.hut.door = 1; G.hut.fuel = 0; G.time = tAt(3, 21.2); G.day = 3; G.fired.E5 = 1; G.lastDawn=3;
    G.p.x = HUT.x; G.p.y = HUT.y - 20; input.mx = input.my = 0; update(0.01);
    Wolves.spawnPack(4, true);
    let minD = 1e9, t = 0;
    for (let i = 0; i < 1200 && G.wolves.length; i++) { update(0.05); t += 0.05; for (const w of G.wolves) minD = Math.min(minD, Math.hypot(w.x - HUT.x, w.y - (HUT_IN.y1 + 20))); }
    out.push(`inside+door+cold stove: doorHp=${G.hut.doorHp.toFixed(1)} minWolfDistToDoor=${minD.toFixed(0)} wolvesLeft=${G.wolves.length} t=${t.toFixed(1)} pack=${!!G.pack}`);
    return out;
  });
  console.log(r.join('\n'));
  await b.close();
})();
