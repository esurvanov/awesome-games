// Десктоп: сохранения (ячейки, авто, обнуление старых сейвов, отказ новой версии) и управление посёлком
// (к выделенным G, группы Ctrl+1..3 / 1..3, двойной клик, стрелки за экраном).
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const OUT = path.join(__dirname, 'shots') + '/';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [], log = [], fail = [];
  const ok = (c, what) => { log.push((c ? 'ok   ' : 'FAIL ') + what); if (!c) fail.push(what); };
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(400);

  // --- старые сейвы (до v4: sibir2-save и ячейки v3) обнуляются с понятной причиной
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('sibir-tips', '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}'); });
  await pg.click('#start'); await pg.waitForTimeout(600);
  await pg.evaluate(() => {
    const s = JSON.parse(SaveGame.snapshot()); s._v = 3; s.trees = [{ x: 1, y: 1, wood: 3 }];
    localStorage.setItem('sibir3-save-1', JSON.stringify(s)); localStorage.setItem('sibir3-meta-1', JSON.stringify({ v: 3, at: Date.now(), day: 2, ch: 0, ep: 0, h: 10 }));
    delete s._v; localStorage.setItem('sibir2-save', JSON.stringify(s)); localStorage.removeItem('sibir3-save-auto'); localStorage.removeItem('sibir3-meta-auto');
  });
  await pg.reload(); await pg.waitForTimeout(900);
  const drop = await pg.evaluate(() => ({ old: localStorage.getItem('sibir2-save'), d1: localStorage.getItem('sibir3-save-1'), m1: Saves.meta('1'), ma: Saves.meta('auto'), cont: !document.getElementById('continue').hidden,
    toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
  ok(!drop.old && !drop.d1 && drop.m1 && /старое сохранение/.test(drop.m1.err) && drop.ma && /стёрто/.test(drop.ma.err), `старые сейвы стёрты: «${drop.m1 && drop.m1.err}»`);
  ok(!drop.cont && /стёрты/.test(drop.toast), `«Продолжить» скрыта, тост: «${drop.toast}»`);
  // --- автосейв нового формата → «Продолжить»
  await pg.click('#start'); await pg.waitForTimeout(600);
  await pg.evaluate(() => { G.day = 4; G.time = tAt(4, 21); G.chapter = 2; SaveGame.checkpoint(); });
  await pg.reload(); await pg.waitForTimeout(500);
  const mig = await pg.evaluate(() => ({ m: Saves.meta('auto'), cur: Saves.meta('auto').v === SaveGame.V && Saves.meta('auto').W === W, cont: !document.getElementById('continue').hidden }));
  ok(mig.m && mig.m.day === 4 && mig.m.ch === 2 && mig.cur, `«Авто» v${mig.m && mig.m.v}: день ${mig.m && mig.m.day}, глава ${mig.m && mig.m.ch}`);
  ok(mig.cont, 'кнопка «Продолжить» видна');
  await pg.click('#continue'); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => state === 'play' && G.day === 4 && G.chapter === 2), 'продолжить → загружен день 4, глава III');

  // --- ручное сохранение в ячейку 2 из паузы
  await pg.evaluate(() => { G.inv.wood = 17; });
  for (let i = 0; i < 4 && await pg.evaluate(() => UI.modal()); i++) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(120); }
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  await pg.click('#p-save'); await pg.waitForTimeout(150);
  await pg.screenshot({ path: OUT + 'ui-slots-save.png' });
  await pg.click('[data-save="2"]'); await pg.waitForTimeout(150);
  const m2 = await pg.evaluate(() => Saves.meta('2'));
  ok(m2 && m2.day === 4 && m2.ch === 2 && typeof m2.h === 'number' && m2.at > 0 && m2.ep === 0, `ячейка 2: ${JSON.stringify(m2 && { d: m2.day, ch: m2.ch, ep: m2.ep, h: +m2.h.toFixed(1) })}`);
  const rowTxt = await pg.evaluate(() => document.querySelectorAll('#sl-list .slot')[2].textContent);
  ok(/4/.test(rowTxt) && /III/.test(rowTxt) && /\d\d:\d\d/.test(rowTxt), 'в строке ячейки: день, глава, время');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
  // --- портим игру и загружаем ячейку 2 из паузы
  await pg.evaluate(() => { G.inv.wood = 0; });
  await pg.keyboard.press('Escape'); await pg.click('#p-load'); await pg.waitForTimeout(150);
  await pg.screenshot({ path: OUT + 'ui-slots-load.png' });
  await pg.click('[data-load="2"]'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => state === 'play' && G.inv.wood === 17 && document.getElementById('pause').hidden), 'загрузка ячейки 2 из паузы: 🪵17 вернулись');

  // --- сон → автосейв
  const at0 = await pg.evaluate(() => Saves.meta('auto').at);
  await pg.waitForTimeout(20);
  await pg.evaluate(() => { Actions.wake(true); });
  ok(await pg.evaluate(at0 => Saves.meta('auto').at > at0, at0), 'утро после сна → автосейв');

  // --- отказ: сейв из новой версии и битый
  await pg.evaluate(() => {
    const s = JSON.parse(SaveGame.snapshot()); s._v = SaveGame.V + 5;
    localStorage.setItem('sibir3-save-3', JSON.stringify(s)); localStorage.setItem('sibir3-meta-3', JSON.stringify({ v: SaveGame.V + 5, at: Date.now(), day: 9, ch: 3, ep: 2, h: 10 }));
    localStorage.setItem('sibir3-save-1', '{битый'); localStorage.setItem('sibir3-meta-1', JSON.stringify({ v: SaveGame.V, at: Date.now(), day: 2, ch: 0, ep: 0, h: 10 }));
  });
  await pg.keyboard.press('Escape'); await pg.click('#p-load'); await pg.waitForTimeout(150);
  const refuse = await pg.evaluate(() => ({ r3: document.querySelectorAll('#sl-list .slot')[3].textContent, b3: !!document.querySelector('[data-load="3"]') }));
  ok(/новой версии/.test(refuse.r3) && !refuse.b3, 'ячейка из новой версии: ⚠️ и без кнопки');
  await pg.click('[data-load="1"]'); await pg.waitForTimeout(200);
  const t1 = await pg.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  ok(/повреждён/.test(t1) && await pg.evaluate(() => !document.getElementById('slots').hidden), `битая ячейка: сообщение «${t1}»`);
  await pg.screenshot({ path: OUT + 'ui-slots-refuse.png' });
  await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);

  // --- посёлок: группы, к выделенным, двойной клик, стрелки
  await pg.evaluate(() => {
    G.s.hp = 1e9; G.time = tAt(G.day, 11); G.p.x = HUT.x + 40; G.p.y = HUT.y + 260; GFX.recenter(); GFX.setZoom(1);
    G.col.units = G.col.units.filter(u => u.pet);
    for (const [t, dx, dy] of [['bich', -120, 40], ['bich', -60, 80], ['bich', 0, 110], ['evenk', 120, 40], ['bich', 1500, -200]]) Colony.spawn(t, { x: G.p.x + dx, y: G.p.y + dy }).task = { k: 'idle' };
    for (let i = 0; i < 40; i++) update(0.05);
  });
  await pg.waitForTimeout(500);
  const ids = await pg.evaluate(() => G.col.units.filter(u => !u.pet).map(u => u.id));
  await pg.evaluate(i => { G.col.sel = [i[0], i[1]]; }, ids);
  await pg.keyboard.press('Control+Digit1'); await pg.waitForTimeout(50);
  await pg.evaluate(i => { G.col.sel = [i[3]]; }, ids);
  await pg.keyboard.press('Digit1'); await pg.waitForTimeout(50);
  ok(await pg.evaluate(i => G.col.sel.length === 2 && G.col.sel.includes(i[0]) && G.col.sel.includes(i[1]), ids), 'Ctrl+1 запомнить → 1 выбрать');
  // двойной клик по бичу — все бичи на экране (далёкий не в счёт)
  const p0 = await pg.evaluate(i => { const u = G.col.units.find(u => u.id === i[2]); return { x: (u.x - cam.x) * GFX.zoom, y: (u.y - 14 - cam.y) * GFX.zoom }; }, ids);
  await pg.mouse.dblclick(p0.x, p0.y); await pg.waitForTimeout(100);
  const dbl = await pg.evaluate(i => G.col.sel.slice().sort(), ids);
  ok(dbl.length === 3 && !dbl.includes(ids[4]) && !dbl.includes(ids[3]), `двойной клик: выбраны ${dbl.length} бича на экране`);
  // далёкий бич: стрелка на краю и G
  await pg.evaluate(i => { G.col.sel = [i[4]]; }, ids); await pg.waitForTimeout(300);
  ok(await pg.locator('#offsel .offa').count() === 1, 'стрелка к выделенному за экраном');
  await pg.screenshot({ path: OUT + 'ui-offscreen.png' });
  await pg.keyboard.press('KeyG'); await pg.waitForTimeout(900);
  ok(await pg.evaluate(() => { const u = Colony.selected()[0]; const x = (u.x - cam.x) * GFX.zoom, y = (u.y - 14 - cam.y) * GFX.zoom; return x > 0 && y > 0 && x < innerWidth && y < innerHeight; }), 'G — камера к выделенным');
  ok(await pg.locator('#offsel .offa').count() === 0, 'стрелка пропала, когда выделенный на экране');
  // группа сохраняется в сейве
  await pg.evaluate(() => SaveGame.checkpoint());
  ok(await pg.evaluate(() => JSON.parse(Saves.read('auto').json).col.groups[1].length === 2), 'группы пишутся в сейв');
  // финал стирает только «Авто»
  await pg.evaluate(() => UI.end('A'));
  ok(await pg.evaluate(() => !Saves.meta('auto') && !!Saves.meta('2')), 'финал: «Авто» стёрт, ячейка 2 цела');

  ok(!errs.length, 'ошибок страницы нет ' + errs.slice(0, 3).join(' | '));
  console.log(log.join('\n'));
  console.log(fail.length ? `ERR ui: ${fail.length} проверок не прошло` : 'ui: все проверки прошли');
  await b.close();
  process.exitCode = fail.length ? 1 : 0;
})();
