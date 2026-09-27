// Долгий прогон «как игрок»: ×16, случайные выборы в событиях, тапы по карте, окна. Ловит ошибки выполнения.
// node soak.js [секунд=40]
import { chromium } from 'playwright';
import { serve } from './serve.js';
const SEC = +(process.argv[2] || 40);
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message + '\n' + e.stack)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(url); await pg.evaluate(() => localStorage.clear()); await pg.reload();
await pg.click('#st-new');
await pg.waitForFunction(() => window.LARS && window.LARS.loop, null, { timeout: 30000 });
await pg.evaluate(() => LARS.setSpeed(3));
let cards = 0, taps = 0, acts = 0;
const t0 = Date.now();
while (Date.now() - t0 < SEC * 1000) {
  const st = await pg.evaluate(() => ({ key: LARS.Modal.top(), menu: LARS.menu.open, ended: LARS.ended }));
  if (st.ended) break;
  if (st.key === 'event') {
    const n = await pg.$$eval('.card .choice:not(.off)', a => a.length);
    if (n) { await pg.locator('.card .choice:not(.off)').nth(Math.floor(Math.random() * n)).click(); cards++; }
    await pg.waitForTimeout(80);
    if (await pg.$('[data-ok]')) await pg.click('[data-ok]');
  } else if (st.key) {
    await pg.evaluate(() => LARS.Modal.closeAll());
  } else if (st.menu) {
    const n = await pg.$$eval('#menu .acts .btn:not(.off)', a => a.length);
    if (n && Math.random() < 0.7) { await pg.locator('#menu .acts .btn:not(.off)').nth(Math.floor(Math.random() * n)).click(); acts++; await pg.waitForTimeout(100); }
    await pg.evaluate(() => { LARS.menu.hide(); LARS.Modal.closeAll(); });
  } else {
    await pg.evaluate(() => { const G = LARS; G.input.follow = true; G.view.cam.z = 3 + Math.random() * 4; });
    await pg.mouse.click(400 + Math.random() * 480, 200 + Math.random() * 400); taps++;
  }
  await pg.waitForTimeout(150);
}
const r = await pg.evaluate(() => { const w = LARS.w; return { date: w.clock.label(), kpp: Math.round(w.playerKpp()), passed: w.queue.passed.cars, ended: LARS.ended, end: w.ended?.id, helped: w.ledger.helped.length, fps: Math.round(LARS.loop.fps), q: LARS.q.level }; });
console.log(JSON.stringify(r), { cards, taps, acts });
console.log(errs.length ? 'ОШИБКИ:\n' + errs.slice(0, 5).join('\n') : 'без ошибок');
await b.close(); srv.close(); process.exit(errs.length ? 1 : 0);
