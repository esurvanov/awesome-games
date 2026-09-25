// Финальные сцены: прогон A/B/C/D, скриншоты, ошибки страницы, пропуск кликом.
const { chromium } = require('playwright');
const OUT = __dirname + '/shots/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await pg.route(/^https?:/, r => r.abort()); // сеть не нужна (шрифты)
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto('file://' + require('path').resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);
  await pg.click('#start');
  await pg.waitForTimeout(1500);
  for (const k of ['A', 'B', 'C', 'D']) {
    await pg.evaluate(k => { window.__fin = 0; state = 'over'; Finale.play(k, { pop: 5, vera: k === 'A' }, () => { window.__fin = 1; UI.end(k); }); }, k);
    for (const [t, w] of [[2.5, 2500], [6.5, 4000], [9, 2500]]) { await pg.waitForTimeout(w); await pg.screenshot({ path: OUT + `fin-${k}-${t}.png` }); }
    await pg.waitForFunction(() => window.__fin === 1, null, { timeout: 8000 });
    const over = await pg.evaluate(() => !document.getElementById('over').hidden && !document.getElementById('finale'));
    console.log(k, 'done, over screen', over);
    await pg.evaluate(() => { document.getElementById('over').hidden = true; });
  }
  await pg.evaluate(() => { window.__fin = 0; Finale.play('A', null, () => { window.__fin = 1; }); });
  await pg.waitForTimeout(1300); await pg.mouse.click(400, 400); await pg.waitForTimeout(200);
  console.log('skip ok', await pg.evaluate(() => window.__fin === 1));
  console.log(errs.slice(0, 10).join('\n') || 'no page errors');
  await b.close();
})();
