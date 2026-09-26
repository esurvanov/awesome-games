const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto((process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html')));
  await pg.waitForTimeout(800);
  await pg.click('#start');
  await pg.waitForTimeout(3600);
  const shot = async (name, fn, wait = 700) => { const r = await pg.evaluate(fn); if (r) console.log(name, r); await pg.waitForTimeout(wait); await pg.screenshot({ path: OUT + name + '.png' }); };
  // ночь у костра со стаей
  await shot('4-night', () => {
    G.s.hp = 1e6; G.time = tAt(1, 22.5); G.aurora = 1; G.p.x = 1200; G.p.y = 1500; G.fires.push({ x: 1230, y: 1510, fuel: 100 });
    cam.x = G.p.x - 640; cam.y = G.p.y - 420; Wolves.spawnPack(4, false); for (let i = 0; i < 60; i++) update(0.05);
    return 'wolves ' + G.wolves.map(w => w.st).join(',');
  });
  // изба внутри вечером
  await shot('5-hut', () => {
    G.time = tAt(1, 18.4); G.hut.fuel = 200; Object.assign(G.hut, { walls: 1, door: 1, bench: 1 }); G.flags.radioBuilt = 1;
    G.vera.state = 'hut'; G.vera.x = SPOT.veraBed.x; G.vera.y = SPOT.veraBed.y; G.wolves = []; G.pack = null;
    G.p.x = HUT.x + 10; G.p.y = HUT.y - 20; cam.x = G.p.x - 640; cam.y = G.p.y - 400; for (let i = 0; i < 10; i++) update(0.05);
  });
  // пурга днём
  await shot('6-storm', () => {
    G.time = tAt(2, 12); G.day = 2; G.storm = { a: G.time - 1, b: G.time + 60, omen: 1, said: 1 }; G.p.x = 2000; G.p.y = 2400; cam.x = G.p.x - 640; cam.y = G.p.y - 400; update(0.05);
  });
  // медведь на мари ночью
  await shot('7-bear', () => {
    G.storm = null; G.chapter = 3; G.time = tAt(3, 21.5); G.day = 3; G.bearNight = -1; G.flags.bearDead = 0;
    G.p.x = POI.mar.x + 150; G.p.y = POI.mar.y + 150; cam.x = G.p.x - 640; cam.y = G.p.y - 400;
    G.stacks.forEach(s => s.wood = 4); G.stacks[0].lit = 50;
    update(0.05); const b = G.bear; if (b) { b.x = G.p.x - 120; b.y = G.p.y - 40; }
    for (let i = 0; i < 20; i++) update(0.05);
    return 'bear ' + (G.bear ? G.bear.st + ' hp' + G.bear.hp : 'none') + ' fired ' + JSON.stringify(G.fired) + ' ch ' + G.chapter;
  });
  // диалог и крафт
  await shot('8-dialog', () => { G.time = tAt(2, 10); G.urk.state = 'hut'; G.urk.x = G.p.x + 40; G.urk.y = G.p.y; G.bear = null; UI.dialog(DIALOG.urk_meet); }, 2500);
  await shot('9-craft', () => { document.querySelector('.opt') && document.querySelector('.opt').click(); document.getElementById('dialog').hidden = true; G.inv = { wood: 8, scrap: 3, hare: 2, cable: 1 }; G.p.x = HUT.x + 40; G.p.y = HUT.y - 50; update(0.05); UI.openCraft('craft'); });
  // мобильная ширина
  await pg.evaluate(() => { document.getElementById('panel-close').click(); });
  await pg.setViewportSize({ width: 390, height: 780 });
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: OUT + '10-phone.png' });
  console.log(errs.slice(0, 10).join('\n') || 'no page errors');
  await b.close();
})();
