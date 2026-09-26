const { chromium } = require('playwright');
const fs = require('fs');
const opts = JSON.parse(process.argv[2] || '{}');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  try {
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
  await pg.addScriptTag({ path: __dirname + "/col.js" });
  const r = await pg.evaluate((opts) => {
    Object.assign(BOT.colOpt, opts.colOpt || {}); const o2 = Object.assign({}, opts); delete o2.colOpt; Object.assign(BOT, o2);
    input.mx = input.my = 0; if (typeof Finale !== 'undefined') Finale.play = (k, st, cb) => cb();
    const res = BOT.run(opts.limit || 3600);
    const B = BOT;
    return { res, chR: B.chR, chT: B.chT, R: B.R, T: B.T, day: G.day, h: hourOf(), ch: G.chapter, dlgN: B.dlgN, ate: B.ate, fires: B.fires, stuck: B.stuck,
      hares: B.hares, minWarm: B.minWarm, minHp: B.minHp, minFood: B.minFood, wolfHits: B.wolfHits, wolfDmg: B.wolfDmg, bearDmg: B.bearDmg, frostEv: B.frostEv, coldDmg: B.coldDmg,
      warmT: B.warmT, chopTime: B.chopTime, stats: G.stats, inv: G.inv, chest: G.chest, hut: G.hut, flags: G.flags, urk: { r: G.urk.respect, st: G.urk.state }, vera: G.vera.state,
      skills: G.skills, gear: G.gear, col: B.col, colState: { ep: G.col.ep, pop: Colony.pop(), builds: G.col.builds.map(b => b.type + (b.done ? "" : "*")), techs: G.col.techs, rub: G.col.rub, prices: G.col.prices, units: G.col.units.map(u => u.type + ":" + (u.hp|0)) }, log: B.log, dlg: B.dlgLog };
  }, opts);
  const tag = opts.tag || 'run';
  fs.writeFileSync(__dirname + '/out-' + tag + '.json', JSON.stringify(r, null, 1));
  console.log(r.log.join('\n'));
  const { log, dlg, col, ...rest } = r; console.log("EV\n" + col.ev.join("\n")); console.log(JSON.stringify({gath: col.gath, workT: col.workT, allT: col.allT, deaths: col.deaths, hires: col.hires, epAt: col.epAt, built: col.built, trades: col.trades, tech: col.tech, eaten: col.eaten, unitMin: col.unitMin, epBlock: col.epBlock, chestWood: col.chestWood, alarmOn: col.alarmOn, bootHunt: col.bootHunt, bootWood: col.bootWood, soldHare: col.soldHare, series: col.series.filter((x,i)=>i%2==0)}));
  console.log(JSON.stringify(rest));
  console.log(errs.slice(0, 5).join('\n') || 'no page errors');
  } finally { await b.close(); }
})();
