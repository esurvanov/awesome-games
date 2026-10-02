// node tests/ui.smoke.js — прохождение в настоящем Chrome: обучение, уровень, архитектура, логи, нагрузочный тест, язык, телефон.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(__dirname, '..', 'index.html');

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  async function page(vp, scheme, lang) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme || 'light', locale: lang || 'ru-RU' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
    return p;
  }
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png') });
  const center = async (p, sel) => { const r = await p.locator(sel).first().boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  const unlockAll = (p) => p.evaluate(() => { const s = { lv: {}, surv: { best: 0 }, daily: {}, ach: {}, slots: [null, null, null], draft: {} }; U.LEVELS.forEach((l) => (s.lv[l.id] = { stars: 1, score: 50 })); localStorage.setItem('uptime.v2', JSON.stringify(s)); });

  // --- обучение одними кнопками подсказки ---
  const p = await page({ width: 1280, height: 800 });
  await shot(p, '01-home');
  await p.click('.play'); await p.waitForSelector('.modal .go'); await shot(p, '02-intro-brief');
  await p.click('.modal .go'); await p.waitForSelector('.board'); await p.waitForTimeout(400); await shot(p, '03-coach');
  for (let i = 0; i < 40; i++) {
    if (await p.locator('.modal.result').count()) break;
    const bt = p.locator('.coach .cbn');
    if (await bt.count() && await bt.isVisible()) { const [x, y] = await center(p, '.coach .cbn'); await p.mouse.click(x, y); }
    if (i === 6) await shot(p, '04-coach-spike');
    await p.waitForTimeout(500);
    if (i > 7 && await p.locator('.game.running').count()) await p.click('.speeds [data-s="4"]');
  }
  await p.waitForSelector('.modal.result', { timeout: 40000 }); await shot(p, '05-intro-result');
  console.log('обучение:', await p.locator('.rtop h2').textContent(), '★' + await p.locator('.bigstars .on').count());

  // --- уровень 1: прогноз = старт, поставить сервер, соединить, запустить ---
  await p.click('.modal .next'); await p.waitForSelector('.modal .popts'); await shot(p, '06-predict');
  await p.click('.modal .popts button[data-o="0"]'); await p.waitForSelector('.board'); await p.waitForTimeout(300);
  await p.click('.pi[data-t=compute]'); await p.waitForTimeout(200);
  let [x, y] = await center(p, '.node[data-id=users] .handle'); await p.mouse.click(x, y);
  [x, y] = await center(p, '.node:not([data-id=users]) .nb'); await p.mouse.click(x, y); await p.waitForTimeout(200);
  await p.click('.deploy'); await p.click('.speeds [data-s="4"]'); await p.waitForTimeout(1500); await shot(p, '07-hello-run');
  await p.waitForSelector('.modal.result', { timeout: 30000 }); await shot(p, '08-hello-result');
  console.log('уровень 1:', await p.locator('.rtop h2').textContent());

  // --- архитектура: команды и события, тип связи меняется в панели связи ---
  await unlockAll(p); await p.reload(); await p.click('[data-go=levels]'); await p.click('.lv[data-id=cmdevt]');
  await p.click('.modal .popts button[data-o="1"]'); await p.waitForSelector('.board'); await p.waitForTimeout(400);
  await shot(p, '09-cmdevt-edit');
  for (const [to, k] of [['pay', 'cmd'], ['mail', 'evt'], ['stats', 'evt'], ['loyalty', 'evt']]) {
    const pt = await p.evaluate((sel) => { const el = document.querySelector(`[data-e="${sel}"] .ehit`); const L = el.getTotalLength(); const q = el.getPointAtLength(L * 0.6); const m = el.getScreenCTM(); return [q.x * m.a + m.e, q.y * m.d + m.f]; }, 'orders>' + to);
    await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(120);
    await p.click(`.insp .kinds button[data-k=${k}]`); await p.waitForTimeout(80);
  }
  await p.locator('.node[data-id=orders] .nb').click({ force: true }); await p.click('.insp .ginc'); await p.waitForTimeout(100);
  for (const id of ['mail', 'stats', 'loyalty']) { await p.click('.insp .ix'); await p.waitForTimeout(80); await p.locator(`.node[data-id=${id}] .nb`).click({ force: true }); await p.click('.insp .ginc'); await p.waitForTimeout(80); }
  await shot(p, '10-cmdevt-set');
  await p.click('.deploy'); await p.click('.speeds [data-s="4"]'); await p.waitForTimeout(3000); await shot(p, '11-cmdevt-run');
  await p.waitForSelector('.modal.result', { timeout: 40000 }); await p.click('.modal .det'); await p.waitForTimeout(150); await shot(p, '12-cmdevt-result');
  console.log('команды и события:', await p.locator('.rtop h2').textContent(), '★' + await p.locator('.bigstars .on').count());

  // --- логи: найти сломанный сервис и откатить ---
  await p.goto(URL); await p.click('[data-go=levels]'); await p.click('.lv[data-id=logging]'); await p.click('.modal .popts button[data-o="1"]'); await p.waitForSelector('.board');
  await p.click('.pi[data-t=logs]'); await p.waitForTimeout(150);
  await p.click('.deploy'); await p.click('.speeds [data-s="2"]');
  await p.waitForFunction(() => document.querySelector('.tlp') && parseFloat(document.querySelector('.tlp').style.width) > 30, null, { timeout: 30000 });
  await p.click('.pp'); await p.waitForTimeout(200);
  await p.locator('.node[data-id=stock] .nb').click({ force: true }); await p.waitForTimeout(200); await shot(p, '13-logging-pause');
  await p.click('.insp [data-act=rollback]'); await p.click('.pp'); await p.click('.speeds [data-s="4"]');
  await p.waitForSelector('.modal.result', { timeout: 40000 }); await shot(p, '14-logging-result');
  console.log('логи:', await p.locator('.rtop h2').textContent());

  // --- нагрузочный тест ---
  await p.goto(URL); await p.click('[data-go=levels]'); await p.click('.lv[data-id=loadtest]'); await p.click('.modal .popts button[data-o="1"]'); await p.waitForSelector('.board');
  await p.click('.ltest'); await p.waitForTimeout(2500); await shot(p, '15-loadtest');
  console.log('нагрузочный тест: тостов', await p.locator('.toast').count());

  // --- поток во многих блоках: мультиклауд в работе ---
  await p.goto(URL); await p.click('[data-go=levels]'); await p.click('.lv[data-id=multicloud]'); await p.click('.modal .popts button[data-o="1"]'); await p.waitForSelector('.board');
  await p.click('.deploy'); await p.click('.speeds [data-s="4"]'); await p.waitForTimeout(4200); await shot(p, '16-multicloud-run');

  // --- язык ---
  await p.goto(URL); await p.click('.lang'); await p.waitForTimeout(150);
  console.log('язык:', await p.locator('.hero h1').textContent(), '/', await p.locator('.play').textContent());
  await shot(p, '17-home-en');
  await p.click('[data-go=levels]'); await shot(p, '18-levels-en');

  // --- телефон, тёмная тема ---
  const m = await page({ width: 390, height: 844 }, 'dark');
  await shot(m, '20-m-home');
  await m.click('.play'); await m.click('.modal .go'); await m.waitForSelector('.board'); await m.waitForTimeout(300); await shot(m, '21-m-coach');
  console.log('ширина на телефоне:', await m.evaluate(() => document.documentElement.scrollWidth));

  console.log(errors.length ? 'ОШИБКИ:\n' + errors.join('\n') : 'ошибок в консоли нет');
  await b.close();
})();
