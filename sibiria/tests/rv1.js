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
    const spots = { center: {x:HUT.x,y:HUT.y}, bed: SPOT.bed, bench: SPOT.bench, chest: SPOT.chest, stove: SPOT.stove, nearDoor:{x:HUT.x,y:HUT.y+20} };
    const starts = { S:{x:HUT.x,y:HUT.y+200}, SE:{x:HUT.x+200,y:HUT.y+200}, E:{x:HUT.x+250,y:HUT.y}, SW:{x:HUT.x-200,y:HUT.y+200} };
    for (const [sn, sp] of Object.entries(spots)) for (const [stn, st] of Object.entries(starts)) {
      G.s.hp = 1e9; G.s.warm = 90; G.s.food=90; G.time = tAt(1, 12); G.wolves = []; G.bear=null;
      G.vera.state = 'follow'; G.vera.x = st.x; G.vera.y = st.y;
      G.p.x = sp.x; G.p.y = sp.y; input.mx = input.my = 0;
      for (let i = 0; i < 400; i++) update(0.05);
      out.push(`${sn} from ${stn}: ${G.vera.state} at ${G.vera.x.toFixed(0)},${G.vera.y.toFixed(0)} dist ${Math.hypot(G.vera.x-G.p.x,G.vera.y-G.p.y).toFixed(0)}`);
    }
    return out;
  });
  console.log(r.join('\n')); console.log(errs.join('\n'));
  await b.close();
})();
