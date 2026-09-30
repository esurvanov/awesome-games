const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await pg.route(/^https?:/, r => r.abort()); // сеть не нужна (шрифты)
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto(process.env.SIBIR_URL || 'file://' + require('path').resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: OUT + '1-menu.png' });
  await pg.click('#start');
  await pg.waitForTimeout(3800);
  await pg.screenshot({ path: OUT + '2-start.png' });
  // быстрый прогон симуляции
  const r = await pg.evaluate(() => {
    const log = [];
    const step = (n, dt = 0.05) => { for (let i = 0; i < n && state === 'play'; i++) { input.mx = Math.sin(i / 50); input.my = Math.cos(i / 70); update(dt); } };
    try {
      G.s.hp = 1e9; // бессмертие для прогона
      // рубка у дерева
      const t = G.trees.find(t => !t.wall && Math.hypot(t.x - G.p.x, t.y - G.p.y) < 600);
      G.p.x = t.x + 30; G.p.y = t.y; input.mx = input.my = 0; Actions.interact(false); for (let i = 0; i < 40; i++) update(0.05);
      log.push('wood ' + G.inv.wood);
      // обломки
      G.p.x = POI.cockpit.x; G.p.y = POI.cockpit.y + 90; for (let k = 0; k < 6; k++) { Actions.interact(false); for (let i = 0; i < 90; i++) update(0.05); }
      log.push('scrap ' + G.inv.scrap + ' quartz ' + G.inv.quartz);
      G.inv.wood = 30;
      G.p.x = HUT.x; G.p.y = HUT.y; update(0.05); log.push('inside ' + G.p.inside);
      Stove.add(); Stove.add(); log.push('fuel ' + G.hut.fuel);
      for (const u of HUT_UPG) { G.inv.scrap = 10; Actions.buildHut(u); } log.push('hut ' + JSON.stringify(G.hut));
      for (const rcp of RECIPES) { Object.assign(G.inv, { scrap: 10, hare: 5, wpelt: 3, fish: 2, meat: 2, cable: 1, tea: 1 }); if (Actions.craft(rcp)) for (let i = 0; i < 400 && G.p.action; i++) update(0.05); }
      log.push('gear ' + Object.keys(G.gear).join(','));
      UI.openCraft('craft'); UI.openChest(); UI.openTrade(); document.getElementById('panel-close').click();
      UI.dialog(Npc.talk('urk')); document.getElementById('dialog').hidden = true;
      step(2000); log.push('after day1 t=' + hourOf().toFixed(1) + ' day ' + G.day + ' ch ' + G.chapter);
      // ночь со стаей
      G.time = tAt(G.day, 22); G.p.x = 1200; G.p.y = 1600; G.D.phase = 'build'; G.D.budget = 80; G.D.last = 'scout';
      step(1500); log.push('wolves ' + G.wolves.length + ' tension ' + G.D.tension.toFixed(0));
      Wolves.spawnPack(4, true); step(600); log.push('pack wolves ' + G.wolves.length);
      // медведь
      G.chapter = 3; G.time = tAt(G.day, 21); G.bearNight = -1; step(400); log.push('bear ' + (G.bear ? G.bear.st : 'none'));
      // пурга
      G.storm = { a: G.time, b: G.time + 30 }; step(200);
      // сон
      G.time = tAt(G.day, 20); G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y; G.hut.fuel = 400; input.mx = input.my = 0; update(0.05); Actions.trySleep();
      for (let i = 0; i < 80 && !G.p.sleeping && Actions.busy(); i++) update(0.05);
      for (let i = 0; i < 4000 && G.p.sleeping; i++) update(0.05);
      log.push('slept → ' + hourOf().toFixed(1) + ' day ' + G.day + ' sleeping ' + G.p.sleeping);
      // сохранение и загрузка
      SaveGame.checkpoint(); SaveGame.load(checkpoint); step(100); log.push('reload ok, trees ' + G.trees.length);
      // вертолёт
      G.flags.contact = 1; G.flags.contactDay = G.day - 1; G.time = tAt(G.day, 9.05); G.heliDay = 0; update(0.05);
      log.push('heli ' + !!G.heli);
      G.col.builds.push({ id: 999, type: 'pad', x: POI.mar.x, y: POI.mar.y + 170, prog: 1, done: 1 }); G.stacks.forEach(s => Fire.lightStack(s, 60)); for (let i = 0; i < 40 && !G.flags.rescued; i++) update(0.05); log.push('rescued ' + G.flags.rescued);
    } catch (e) { log.push('ERR ' + e.message + ' ' + e.stack); }
    return log;
  });
  console.log(r.join('\n'));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT + '3-after.png' });
  console.log(errs.slice(0, 10).join('\n') || 'no page errors');
  await b.close();
})();
