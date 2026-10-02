// node tests/hostile.test.js — обучение в «враждебной» обёртке, где отпускание кнопки до игры не доходит
// (так ведёт себя просмотрщик опубликованной страницы). Проверяем, что хватает простых кликов.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  let bad = 0;
  for (const mode of ['обычно', 'отпускание съедено']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    if (mode !== 'обычно') await ctx.addInitScript(() => { window.addEventListener('pointerup', (e) => e.stopImmediatePropagation(), true); });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click('.play'); await p.click('.modal .go'); await p.waitForTimeout(400);
    await p.click('.coach .cbn'); await p.waitForTimeout(200);
    const box = async (sel) => { const r = await p.locator(sel).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    let [x, y] = await box('.pi[data-t=compute]'); await p.mouse.click(x, y); await p.waitForTimeout(300);
    const nodes = await p.locator('.node').count();
    [x, y] = await box('.node[data-id=users] .handle'); await p.mouse.click(x, y); await p.waitForTimeout(150);
    [x, y] = await box('.node:not([data-id=users]) .nb'); await p.mouse.click(x, y); await p.waitForTimeout(300);
    const edges = await p.locator('.eg').count();
    const step = await p.locator('.coach small').textContent();
    // блок не должен «прилипнуть» к мыши после нажатия
    const n0 = await p.evaluate(() => { const n = U && document.querySelector('.node:not([data-id=users])'); return n.getAttribute('transform'); });
    [x, y] = await box('.node:not([data-id=users]) .nb'); await p.mouse.click(x, y); await p.mouse.move(x + 200, y + 150, { steps: 6 }); await p.waitForTimeout(150);
    const n1 = await p.evaluate(() => document.querySelector('.node:not([data-id=users])').getAttribute('transform'));
    const ok = nodes === 2 && edges === 1 && step.startsWith('4') && n0 === n1;
    if (n0 !== n1) console.log('блок уехал за мышью:', n0, '→', n1);
    if (!ok) bad++;
    // второй проход: обучение целиком одними кнопками подсказки
    await p.evaluate(() => localStorage.clear()); await p.reload();
    await p.click('.play'); await p.click('.modal .go'); await p.waitForTimeout(300);
    for (let i = 0; i < 40; i++) {
      if (await p.locator('.modal.result').count()) break;
      const b = p.locator('.coach .cbn');
      if (await b.count() && await b.isVisible()) { const [bx, by] = await box('.coach .cbn'); await p.mouse.click(bx, by); }
      await p.waitForTimeout(500);
      if (await p.locator('.game.running').count() && i > 6) await p.click('.speeds [data-s="4"]');
    }
    await p.waitForSelector('.modal.result', { timeout: 40000 });
    const v = await p.locator('.rtop h2').textContent();
    if (!/Выдержала!/.test(v)) bad++;
    console.log(`    только кнопками подсказки: ${v}`);
    console.log(`${ok ? 'OK ' : 'BAD'} ${mode}: блоков ${nodes}, связей ${edges}, шаг обучения ${step}`, errs.join('; '));
    await ctx.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
