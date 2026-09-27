// Волна 3 на стенде (мок района + 300+ предметов): район, книга семей, заселение, CAS, поездки,
// каталог (поиск, варианты, страницы), желания/страхи, карточки газеты и шанса.
// node tests/ui-wave3.mjs → tests/shots/w3-*.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests/shots');
const PORT = 8135;
mkdirSync(SHOTS, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const T_ok = v => !!v;
const wait = ms => new Promise(r => setTimeout(r, ms));

let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/tests/ui-harness.html`)).ok) break; } catch { /* поднимается */ } await wait(100); }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = name => page.screenshot({ path: path.join(SHOTS, `w3-${name}.png`) });

  // 0. экран загрузки (показываем вручную — в стенде он гаснет мгновенно)
  await page.goto(`http://localhost:${PORT}/tests/ui-harness.html?paused&hood`);
  await page.waitForFunction(() => window.ready && window.T);
  await page.evaluate(async () => { const m = await import('../js/ui/loading.js'); m.showLoading(); });
  await wait(600);
  await shot('loading');
  check('экран загрузки: шутка', (await page.locator('.ld-line').textContent()).length > 3);
  await page.evaluate(async () => (await import('../js/ui/loading.js')).hideLoading());
  await wait(600);

  // 1. старт → район
  check('на старте — карта района', await page.locator('.zh-hood').isVisible());
  check('участки на карте', await page.locator('.hd-lot').count() === 11);
  check('время на паузе в районе', await page.evaluate(() => T.state.time.speed === 0));
  await page.click('.hd-lot[data-lot="3"]'); await wait(250);
  await shot('hood');
  check('карточка семьи: портреты и бюджет', await page.locator('.hd-card .hc-m').count() === 5 && /§/.test(await page.locator('.hd-card .hc-money').textContent()));
  // 2. книга семей
  await page.click('[data-act="book"]'); await wait(250);
  check('книга: все семьи', await page.locator('.zh-modal[data-ui="book"] .bk-card').count() === 4);
  await shot('book');
  await page.click('.zh-modal[data-ui="book"] .md-tab >> nth=1'); await wait(150);
  check('книга: горожане', await page.locator('.zh-modal[data-ui="book"] .bk-card').count() === 6);
  await page.click('.zh-modal[data-ui="book"] .md-x');
  // 3. заселение на свободный участок
  await page.click('.hd-lot[data-lot="4"]'); await wait(200);
  await page.click('.hd-card [data-act="movein"]'); await wait(200);
  await page.click('.zh-modal[data-ui="movein"] [data-fam="4"]'); await wait(200);
  check('заселение: Смирновы на Садовой, 2', await page.evaluate(() => T.state.hood.families.find(f => f.id === 4).lotId === 4 && T.state.hood.lots.find(l => l.id === 4).familyId === 4));
  // 4. CAS: новая семья из двух жителей
  await page.click('[data-act="cas"]'); await wait(300);
  check('CAS: «Готово» закрыто, пока нет фамилии', await page.locator('.cs-done').isDisabled());
  await page.fill('.cs-fam', 'Орловы');
  await page.fill('.cs-name', 'Марина');
  await page.click('.cs-row[data-row="sex"] .cs-opt[data-v="f"]');
  await page.click('.cs-row[data-row="hair"] .cs-dot >> nth=4');
  const hairPicked = await page.getAttribute('.cs-row[data-row="hair"] .cs-dot >> nth=4', 'data-v');
  await page.click('.cs-row[data-row="top"] .cs-dot >> nth=6');
  await page.click('.cs-trait[data-trait="neat"] .cs-tdot[data-i="9"]');
  await page.click('.cs-row[data-row="asp"] .cs-opt[data-v="knowledge"]');
  const left = await page.locator('.cs-pts').textContent(); // 5·5 = 25, аккуратность 5→9 упирается в остаток 0
  await page.click('[data-act="add"]'); await wait(150);
  await page.fill('.cs-name', 'Тёма');
  await page.click('.cs-row[data-row="sex"] .cs-opt[data-v="child"]');
  await wait(200);
  await shot('cas');
  check('CAS: очки характера — не больше 25', /осталось 0/.test(left) && await page.evaluate(() => [...document.querySelectorAll('.cs-trait[data-trait="neat"] .cs-tdot.on')].length) === 5, left);
  check('CAS: два жителя, ребёнок', await page.locator('.cs-mem:not(.add)').count() === 2);
  await page.click('.cs-done'); await wait(400);
  const orl = await page.evaluate(() => T.state.hood.families.find(f => f.name === 'Орловы'));
  check('CAS: семья в районе', !!orl && orl.members.length === 2 && orl.members[1].age === 'child' && orl.members[0].look.hair === hairPicked, JSON.stringify(orl?.members?.map(m => m.name)));
  check('после CAS — снова район', await page.locator('.zh-hood').isVisible());
  // 5. играть за Кузнецовых
  await page.click('.hd-lot[data-lot="2"]'); await wait(150);
  await page.click('.hd-card [data-act="play"]'); await wait(300);
  const hh = await page.evaluate(() => T.ui.ctx.household().map(s => s.name).join(','));
  check('«Играть» → семья на участке', !(await page.locator('.zh-hood').isVisible()) && hh === 'Аня,Дима', hh);
  check('время пошло', await page.evaluate(() => T.state.time.speed >= 1));
  // 6. поездка в парк и домой
  await page.click('[data-act="travel"]'); await wait(200);
  check('меню поездок: 5 мест', await page.locator('.zh-travel .tr-item').count() === 5);
  await shot('travel');
  await page.click('.zh-travel [data-lot="10"]'); await wait(200);
  check('поехали в парк', await page.evaluate(() => T.state.hood.activeLotId === 10));
  await page.click('[data-act="travel"]'); await wait(200);
  await page.click('.zh-travel [data-lot="home"]'); await wait(200);
  check('«Домой» → свой участок', await page.evaluate(() => T.state.hood.activeLotId === 2));

  // 7. каталог 300+: страницы, поиск, варианты
  await page.keyboard.press('F2'); await wait(300);
  const total = await page.evaluate(() => T.ui.buy.view.count);
  const pg = await page.locator('.ct-pn').textContent();
  check('каталог 300+ — страницы', total >= 300 && /\/\d+/.test(pg), `${total} предметов, стр. ${pg}`);
  check('в DOM только страница', await page.locator('.zh-card').count() <= 8);
  await page.fill('.ct-search', 'синий'); await wait(200);
  const found = await page.locator('.zh-card').count();
  check('поиск «синий»', found > 0, `${found} на странице`);
  await page.fill('.ct-search', 'Кресло'); await wait(200);
  await page.click('.zh-card >> nth=0 >> .vdots i >> nth=1'); await wait(150);
  const vsel = await page.evaluate(() => T.ui.buy.selected?.defId);
  check('точка варианта выбирает цвет', await page.evaluate(v => !!T.ui.buy.view && v !== 'armchair' && (window.__byId?.[v]?.variantOf ?? v.startsWith('armchair')), vsel), vsel);
  const t1 = await page.evaluate(() => { for (let y = 24; y < 29; y++) for (let x = 2; x < 9; x++) if (T.world.canPlace(T.state, 'armchair', x, y, 0, 0).ok) return T.render.S(x + 0.5, y + 0.5); });
  await page.mouse.move(t1.x, t1.y); await wait(150);
  await shot('catalog');
  await page.mouse.click(t1.x, t1.y); await wait(150);
  check('вариант куплен и поставлен', await page.evaluate(v => T.state.objects.some(o => o.def === v), vsel));
  await page.fill('.ct-search', ''); await wait(100);
  await page.click('.ct-by'); await wait(150);
  check('по комнатам: вкладки комнат', await page.locator('.zh-cats .tab').count() >= 5);
  await page.click('.zh-cats .tab[data-cat="new"]'); await wait(150);
  check('новинки', await page.locator('.zh-card .nw').count() > 0);
  await page.click('.ct-sm >> nth=1'); await wait(150);
  const prices = await page.$$eval('.zh-card .pr', e => e.map(x => +x.textContent.replace(/\D/g, '')));
  check('сортировка по цене', prices.every((p, i) => !i || p >= prices[i - 1]), prices.join(','));
  await page.click('.ct-by'); await wait(100);
  await page.click('.ct-sm >> nth=0'); await wait(150);
  check('коллекции', await page.locator('.ct-chip').count() >= 2);
  await shot('catalog-coll');
  await page.keyboard.press('Escape');

  // 8. стройка: палитры 30+ листаются, видна только нужная
  await page.keyboard.press('F3'); await wait(200);
  await page.click('.zh-btn.tool[data-tool="floor"]'); await wait(100);
  check('стройка: видна только палитра пола', await page.locator('.zh-swatches:not([hidden]) .zh-sw.wall').count() === 0);
  await page.keyboard.press('F1'); await wait(200);

  // 9. желания и страхи
  await page.evaluate(() => { const s = T.state.sims.find(x => x.name === 'Аня'); Object.assign(s, { aspiration: 'romance', aspMeter: -30, wants: [{ id: 'a1', icon: '💋', text: 'Первый поцелуй', points: 500 }, { id: 'a2', icon: '🌹', text: 'Свидание', points: 750 }], fears: [{ id: 'b1', icon: '💔', text: 'Отказ', points: -500 }] }); });
  await page.click('.zh-btn.tab[data-tab="wants"]'); await wait(300);
  check('желания: 4 + страхи: 3 слота', await page.locator('.ws-slots.want .ws-slot').count() === 4 && await page.locator('.ws-slots.fear .ws-slot').count() === 3);
  await page.click('.ws-slots.want .ws-slot >> nth=0'); await wait(200);
  check('замок на желании', await page.locator('.ws-slot.locked').count() === 1);
  await page.screenshot({ path: path.join(SHOTS, 'w3-wants.png'), clip: { x: 0, y: 600, width: 620, height: 260 } });
  // 10. газета и карта шанса
  await page.evaluate(() => {
    T.bus.emit('dialog', { id: 'n1', kind: 'newspaper', icon: '📰', title: 'Вести Берёзовки', text: 'В парке открылся ларёк с пирожками. Очередь — до почты.', options: [{ key: 'ok', label: 'Ясно' }] });
    T.bus.emit('dialog', { id: 'c1', kind: 'chance', simId: T.state.sims.find(s => s.name === 'Аня').id, icon: '🎲', title: 'Шанс!', text: 'Начальник предлагает рискнуть проектом. Рискнёшь?', options: [{ key: 'risk', label: 'Рискнуть' }, { key: 'safe', label: 'Не надо' }] });
  });
  await wait(350);
  await shot('newspaper');
  await page.click('.zh-dlg .dbtn'); await wait(300);
  check('карта шанса после газеты', await page.locator('.zh-dlg.chance').isVisible());
  await shot('chance');
  await page.click('.zh-dlg .dbtn >> nth=1'); await wait(200);
  // 11. настоящий район Мира: играть за другую семью → парк → домой; CAS → выселить → заселить
  await page.goto(`http://localhost:${PORT}/tests/ui-harness.html?paused&hood=real&noload`);
  await page.waitForFunction(() => window.ready && window.T);
  await wait(400);
  check('район Мира: 15 участков', await page.locator('.hd-lot').count() === 15);
  await page.click('.hd-lot[data-lot="res2"]'); await wait(200);
  const famName = await page.locator('.hd-card .hc-head b').textContent();
  await page.click('.hd-card [data-act="play"]'); await wait(500);
  const members = await page.evaluate(() => T.state.hood.families.find(f => f.lotId === 'res2').members.map(m => m.name).sort().join(','));
  const hh2 = await page.evaluate(() => T.ui.ctx.household().map(s => s.name).sort().join(','));
  check(`«Играть» за ${famName}: жители появились`, hh2 === members && T_ok(hh2), hh2);
  await page.screenshot({ path: path.join(SHOTS, 'w3-real-play.png') });
  await page.click('[data-act="travel"]'); await wait(200);
  await page.click('.zh-travel [data-lot="park"]'); await wait(500);
  const inPark = await page.evaluate(() => ({ lot: T.state.hood.activeLotId, hh: T.ui.ctx.household().length }));
  check('в парк — с семьёй', inPark.lot === 'park' && inPark.hh > 0, JSON.stringify(inPark));
  await page.screenshot({ path: path.join(SHOTS, 'w3-real-park.png') });
  await page.click('[data-act="travel"]'); await wait(200);
  await page.click('.zh-travel [data-lot="home"]'); await wait(500);
  check('домой из парка', await page.evaluate(() => T.state.hood.activeLotId === 'res2' && T.ui.ctx.household().length > 0));
  // CAS → выселить Ветровых → заселить новую семью
  await page.click('[data-act="hood"]'); await wait(300);
  await page.click('[data-act="cas"]'); await wait(300);
  await page.fill('.cs-fam', 'Юдины'); await page.fill('.cs-name', 'Лёша'); await wait(100);
  await page.click('.cs-done'); await wait(400);
  // самый дешёвый дом (новой семье хватает §20 000)
  await page.click('.hd-lot[data-lot="res3"]'); await wait(200);
  await page.click('.hd-card [data-act="evict"]'); await wait(300);
  await page.click('.hd-lot[data-lot="res3"]'); await wait(200);
  await page.click('.hd-card [data-act="movein"]'); await wait(200);
  const nov = await page.evaluate(() => T.state.hood.families.find(f => f.name === 'Юдины')?.id);
  await page.click(`.zh-modal[data-ui="movein"] [data-fam="${nov}"]`); await wait(600);
  const after = await page.evaluate(() => ({ lot: T.state.hood.activeLotId, hh: T.ui.ctx.household().map(s => s.name).join(','), hood: !document.querySelector('.zh-hood').hidden }));
  check('новая семья заселилась и играет', after.lot === 'res3' && after.hh === 'Лёша' && !after.hood, JSON.stringify(after));
  await page.screenshot({ path: path.join(SHOTS, 'w3-real-movein.png') });

  check('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  check('прогон без исключений', false, e.message);
} finally {
  await browser?.close();
  server.kill();
}
console.log(`\n${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
