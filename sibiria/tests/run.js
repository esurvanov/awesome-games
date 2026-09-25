const { chromium } = require('playwright');
const fs = require('fs');
const opts = JSON.parse(process.argv[2] || '{}');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
  await pg.route(u => !u.href.startsWith('file:'), r => r.abort());
  await pg.goto('file://' + (process.env.GAME || require('path').resolve(__dirname, '..')) + '/index.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await pg.click('#start');
  await pg.waitForTimeout(500);
  await pg.addScriptTag({ path: __dirname + '/bot.js' });
  await pg.addScriptTag({ path: __dirname + '/plan.js' });
  const r = await pg.evaluate((opts) => {
    Object.assign(BOT, opts);
    input.mx = input.my = 0; if (typeof Finale !== 'undefined') Finale.play = (k, st, cb) => cb();
    const res = BOT.run(opts.limit || 3600);
    const B = BOT;
    return { res, chR: B.chR, chT: B.chT, R: B.R, T: B.T, day: G.day, h: hourOf(), ch: G.chapter, dlgN: B.dlgN, ate: B.ate, fires: B.fires, stuck: B.stuck,
      hares: B.hares, minWarm: B.minWarm, minHp: B.minHp, minFood: B.minFood, wolfHits: B.wolfHits, wolfDmg: B.wolfDmg, bearDmg: B.bearDmg, frostEv: B.frostEv, coldDmg: B.coldDmg,
      warmT: B.warmT, chopTime: B.chopTime, stats: G.stats, inv: G.inv, chest: G.chest, hut: G.hut, flags: G.flags, urk: { r: G.urk.respect, st: G.urk.state }, vera: G.vera.state,
      skills: G.skills, gear: G.gear, log: B.log, dlg: B.dlgLog };
  }, opts);
  const tag = opts.tag || 'run';
  fs.writeFileSync(__dirname + '/out-' + tag + '.json', JSON.stringify(r, null, 1));
  console.log(r.log.join('\n'));
  const { log, dlg, ...rest } = r;
  console.log(JSON.stringify(rest));
  console.log(errs.slice(0, 5).join('\n') || 'no page errors');
  await b.close();
})();
