// Скриншоты и проверки интерфейса на стенде tests/ui-harness.html (Playwright).
// Запуск: node tests/ui-shot.mjs → tests/shots/ui-*.png. Сервер на 8131 поднимается и гасится сам.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests/shots');
const PORT = 8131;
mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/tests/ui-harness.html`); if (r.ok) return; } catch { /* ещё поднимается */ }
    await wait(100);
  }
  throw new Error('сервер не поднялся');
}

let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/tuning\.js|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(`http://localhost:${PORT}/tests/ui-harness.html?paused`);
  await page.waitForFunction(() => window.ready && window.T);
  await wait(400);
  const shot = (name, clip) => page.screenshot({ path: path.join(SHOTS, `ui-${name}.png`), ...(clip ? { clip } : {}) });
  const panelClip = async () => { const b = await page.locator('.zh-panel').boundingBox(); return { x: 0, y: b.y - 8, width: Math.min(1400, b.x + b.width + 12), height: 860 - b.y + 8 }; };

  // 1. живой режим целиком
  await shot('live');
  check('панель на месте', await page.locator('.zh-main').isVisible());

  // 2. вкладки
  for (const t of ['needs', 'job', 'traits', 'skills', 'rel']) {
    await page.click(`.zh-btn.tab[data-tab="${t}"]`);
    await wait(450);
    await shot(`tab-${t}`, await panelClip());
  }
  await page.click('.zh-btn.tab[data-tab="needs"]');

  // 3. круговое меню на холодильнике
  const at = await page.evaluate(() => {
    const o = T.state.objects.find(x => x.def === 'fridge');
    const p = T.render.S(o.x + 0.5, o.y + 0.5, 0.3);
    return { x: p.x, y: p.y, id: o.id };
  });
  await page.mouse.click(at.x, at.y);
  await wait(400);
  check('меню открылось на предмете', await page.locator('.zh-pie .item').count() === 3);
  await shot('pie');
  await page.click('.zh-pie .item >> nth=1');
  await wait(200);
  check('клик по пункту → очередь', await page.evaluate(() => T.state.sims[0].queue.length === 1));

  // 4. меню на другом симе (есть недоступные пункты)
  const sp = await page.evaluate(() => { const s = T.state.sims[1]; const p = T.render.S(s.x, s.y); return { x: p.x, y: p.y - 20 }; });
  // клик по члену семьи — выбрать; Shift+клик — меню общения
  await page.mouse.click(sp.x, sp.y); await wait(200);
  check('клик по члену семьи выбирает его', await page.evaluate(() => T.ui.ctx.selId === T.state.sims[1].id));
  await page.click('.zh-face >> nth=0'); await wait(150);
  await page.keyboard.down('Shift'); await page.mouse.click(sp.x, sp.y); await page.keyboard.up('Shift');
  await wait(400);
  const dis = page.locator('.zh-pie .item.dis').first();
  await dis.hover();
  await wait(200);
  await shot('pie-sim');
  check('недоступный пункт серый с причиной', await dis.locator('.why').isVisible());
  await page.keyboard.press('Escape');
  await wait(250);
  check('Escape закрывает меню', await page.locator('.zh-pie.open').count() === 0);
  // клик по полу → «Идти сюда»
  const fl = await page.evaluate(() => T.render.S(5.5, 26.5));
  await page.mouse.click(fl.x, fl.y);
  await wait(300);
  check('клик по полу → «Идти сюда»', (await page.locator('.zh-pie .item .il').allTextContents()).includes('Идти сюда'));
  await page.click('.zh-pie .item');
  await page.evaluate(() => { const s = T.state.sims[0]; T.sim.enqueue(T.state, T.bus, s.id, { kind: 'sim', id: 2 }, 'talk'); T.sim.tick(T.state, T.bus, T.world, 0.0001); s.act.t = 9; });

  // 5. пузыри и уведомления
  await page.evaluate(() => {
    T.bus.emit('sim:speak', { simId: T.state.sims[0].id, icon: '💬', withId: T.state.sims[1].id });
    T.bus.emit('sim:speak', { simId: T.state.sims[1].id, icon: '🍔' });
    T.bus.emit('notify', { text: 'Пришёл счёт: §312', icon: '🧾' });
    T.bus.emit('notify', { text: 'Вера получила повышение!', icon: '💼', simId: T.state.sims[0].id });
    T.state.household.money += 250; T.bus.emit('money:changed', { money: T.state.household.money, delta: 250, reason: 'salary' });
  });
  await wait(700);
  await shot('queue-bubbles');
  check('очередь: текущее + ожидание', await page.locator('.zh-q').count() >= 2);
  // отмена кликом по иконке
  const qn = await page.locator('.zh-q').count();
  await page.click('.zh-q >> nth=1');
  await wait(150);
  check('клик по иконке очереди отменяет', await page.locator('.zh-q').count() === qn - 1, `${qn} → ${await page.locator('.zh-q').count()}`);

  // 6. покупка
  await page.keyboard.press('F2');
  await wait(300);
  check('F2 → режим покупки', await page.evaluate(() => T.state.mode === 'buy'));
  await page.fill('.ct-search', 'Диван «Уют»'); await wait(150);
  await page.click('.zh-card[data-def="sofa"]');
  const t1 = await page.evaluate(() => T.render.S(6.5, 25.5));
  await page.mouse.move(t1.x, t1.y);
  await wait(200);
  await page.keyboard.press('.');
  await wait(200);
  await shot('buy');
  const m0 = await page.evaluate(() => T.state.household.money);
  await page.mouse.click(t1.x, t1.y);
  await wait(200);
  const m1 = await page.evaluate(() => T.state.household.money);
  check('покупка списала деньги', m1 === m0 - 450, `${m0} → ${m1}`);
  // взять и перенести бесплатно
  await page.mouse.click(t1.x, t1.y);
  await wait(100);
  const t2 = await page.evaluate(() => T.render.S(4.5, 26.5));
  await page.mouse.move(t2.x, t2.y); await wait(100);
  await page.mouse.click(t2.x, t2.y); await wait(150);
  const m2 = await page.evaluate(() => T.state.household.money);
  const moved = await page.evaluate(() => T.state.objects.some(o => o.def === 'sofa' && o.x === 4 && o.y === 26));
  check('перенос предмета бесплатный', moved && m2 === m1, `деньги ${m1} → ${m2}`);
  // Delete продаёт
  await page.mouse.move(t2.x, t2.y); await wait(100);
  await page.keyboard.press('Delete'); await wait(100);
  check('Delete продаёт', await page.evaluate(() => !T.state.objects.some(o => o.def === 'sofa' && o.x === 4 && o.y === 26)));
  await page.click('.zh-cats .zh-btn >> nth=3');
  await wait(150);
  await shot('buy-cat', await panelClip());

  // 7. стройка: стена тянется
  await page.keyboard.press('F3');
  await wait(300);
  const w0 = await page.evaluate(() => T.render.S(3, 24)), w1 = await page.evaluate(() => T.render.S(7, 24));
  await page.mouse.move(w0.x, w0.y); await page.mouse.down();
  await page.mouse.move(w1.x, w1.y, { steps: 5 }); await wait(150);
  await shot('build-wall');
  const mw = await page.evaluate(() => T.state.household.money);
  await page.mouse.up(); await wait(150);
  check('стена построена', await page.evaluate(() => T.world.isEdgeWall(T.state, 0, 'h', 4, 24) > 0));
  check('стена списала деньги', await page.evaluate(m => T.state.household.money < m, mw));
  // пол прямоугольником
  await page.click('.zh-btn.tool[data-tool="floor"]');
  await page.click('.zh-sw:not(.wall) >> nth=1');
  const f0 = await page.evaluate(() => T.render.S(3.5, 25.5)), f1 = await page.evaluate(() => T.render.S(6.5, 27.5));
  await page.mouse.move(f0.x, f0.y); await page.mouse.down();
  await page.mouse.move(f1.x, f1.y, { steps: 5 }); await wait(150);
  await shot('build-floor');
  await page.mouse.up(); await wait(100);
  check('пол покрашен', await page.evaluate(() => T.state.lot.levels[0].floor[26 * 30 + 5] > 0));
  // дверь в стену
  await page.click('.zh-btn.tool[data-tool="door"]');
  const d0 = await page.evaluate(() => T.render.S(5.5, 24.2));
  await page.mouse.move(d0.x, d0.y); await wait(150);
  await shot('build-door');
  await page.mouse.click(d0.x, d0.y); await wait(100);
  check('дверь поставлена', await page.evaluate(() => T.state.objects.some(o => o.def === 'door' && o.y >= 23 && o.y <= 24 && o.x === 5)));

  // ═══ волна 2 ═══
  await page.keyboard.press('F1'); await wait(200);
  // семья: дети и младенец в портретах, НПС — нет
  const fam = await page.evaluate(() => ({ n: document.querySelectorAll('.zh-face').length, kid: !!document.querySelector('.zh-face.kid'), baby: !!document.querySelector('.zh-face.baby') }));
  check('портреты: семья + ребёнок + младенец, без НПС', fam.n === 4 && fam.kid && fam.baby, JSON.stringify(fam));
  check('оценка школьника на портрете', (await page.locator('.zh-face.kid .age').textContent()) === 'A');
  // подпись НПС под курсором
  const mp = await page.evaluate(() => { const s = T.state.sims.find(x => x.npc === 'maid'); const p = T.render.S(s.x, s.y); return { x: p.x, y: p.y - 20 }; });
  await page.mouse.move(mp.x, mp.y); await page.mouse.move(mp.x + 1, mp.y); await wait(350);
  check('НПС: роль у курсора', /Горничная/.test(await page.locator('.zh-tip').textContent()));
  await page.mouse.move(700, 150); await wait(200);
  // приход НПС, рождение, смерть — тосты
  await page.evaluate(() => {
    T.bus.emit('npc:arrive', { simId: 98, npc: 'maid' });
    T.bus.emit('sim:born', { simId: null, cribId: T.state.objects.find(o => o.def === 'crib').id });
  });
  await wait(300);
  check('тост «Горничная пришла»', (await page.locator('.zh-toast .tt').allTextContents()).some(t => /горничная/i.test(t)));
  check('тост рождения', await page.locator('.zh-toast.joy').count() === 1);
  // уровни
  await page.keyboard.press('PageUp'); await wait(150);
  const lv = await page.evaluate(() => ({ l: T.ui.ctx.level, b: document.querySelector('.zh-lvlbadge').textContent }));
  await page.keyboard.press('PageDown'); await wait(150);
  check('PageUp/PageDown — этаж', lv.l === 1 && /2/.test(lv.b) && await page.evaluate(() => T.ui.ctx.level === 0), JSON.stringify(lv));
  // диалоги: очередь, пауза, ответ кнопкой и клавишей, возврат скорости
  await page.click('.zh-btn.spd[data-speed="2"]');
  await page.evaluate(() => {
    T.bus.emit('dialog', { id: 'd1', simId: T.state.sims[0].id, icon: '👶', text: 'Вера и Олег хотят завести ребёнка?', options: [{ key: 'yes', label: 'Да' }, { key: 'no', label: 'Нет' }] });
    T.bus.emit('dialog', { id: 'd2', icon: '📰', text: 'Вакансия: лаборант, §155/день', options: [{ key: 'take', label: 'Согласиться' }, { key: 'skip', label: 'Отказаться' }] });
  });
  await wait(350);
  check('диалог открыт, время на паузе', await page.locator('.zh-dlgwrap').isVisible() && await page.evaluate(() => T.state.time.speed === 0));
  await shot('dialog');
  await page.click('.zh-dlg .dbtn >> nth=0'); await wait(200);
  check('второй диалог в очереди', /лаборант/.test(await page.locator('.zh-dlg .dt').textContent()));
  await page.keyboard.press('2'); await wait(200);
  const ans = await page.evaluate(() => ({ a: T.sim.answers.map(x => x.id + ':' + x.key).join(','), sp: T.state.time.speed, open: !document.querySelector('.zh-dlgwrap').hidden }));
  check('ответы ушли, скорость вернулась', ans.a === 'd1:yes,d2:skip' && ans.sp === 2 && !ans.open, JSON.stringify(ans));
  // подменю телефона: «Вызвать…» → дуга
  await page.evaluate(() => {
    const ph = T.state.objects.find(o => o.def === 'phone'), s = T.state.sims[0];
    const p = T.render.S(ph.x + 0.5, ph.y + 0.5, 0.5);
    T.ui.pie.open(p.x, p.y, s, { kind: 'object', id: ph.id }, T.sim.interactionsFor(T.state, s.id, { kind: 'object', id: ph.id }), 'Телефон');
  });
  await wait(350);
  await page.hover('.zh-pie .item.grp'); await wait(350);
  check('подменю раскрылось', await page.locator('.zh-pie .item.sub.in').count() === 3);
  await shot('pie-sub');
  await page.click('.zh-pie .item.sub[data-key="call_repair"]'); await wait(200);
  check('«Вызвать…/Мастера» → в очередь', await page.evaluate(() => T.state.sims[0].queue.some(q => q.interaction === 'call_repair')));
  // уход курсора сворачивает подменю
  await page.evaluate(() => {
    const ph = T.state.objects.find(o => o.def === 'phone'), s = T.state.sims[0];
    T.ui.pie.open(500, 400, s, { kind: 'object', id: ph.id }, T.sim.interactionsFor(T.state, s.id, { kind: 'object', id: ph.id }));
  });
  await wait(300);
  await page.hover('.zh-pie .item.grp'); await wait(300);
  await page.hover('.zh-pie .hub'); await wait(500);
  check('подменю свернулось при уходе', await page.locator('.zh-pie .item.sub').count() === 0);
  await page.keyboard.press('Escape'); await wait(200);
  // пожар: рамка + петли звука
  await page.evaluate(() => { T.state.lot.fires = [{ x: 14, y: 20, level: 0, power: 0.6 }]; T.bus.emit('fire:start', { x: 14, y: 20 }); });
  await wait(300);
  check('пожар: красная рамка', await page.locator('.zh-fire').isVisible());
  await shot('fire');
  await page.evaluate(() => { T.state.lot.fires = []; T.bus.emit('fire:out', { x: 14, y: 20 }); });
  await wait(200);
  check('пожар потушен — рамки нет', !(await page.locator('.zh-fire').isVisible()));
  // вкладки «Дом» и «Настройки»
  await page.click('.zh-btn.tab[data-tab="house"]'); await wait(700);
  const hs = await page.evaluate(() => ({ v: document.querySelector('.hv .big').textContent, rooms: document.querySelectorAll('.hroom').length }));
  check('Дом: стоимость и комнаты', /§/.test(hs.v) && hs.rooms >= 3, JSON.stringify(hs));
  await shot('tab-house', await panelClip());
  await page.click('.zh-btn.tab[data-tab="opts"]'); await wait(300);
  await page.click('.zh-sw2[data-opt="edgeScroll"]');
  check('Настройки: прокрутка краем выкл.', await page.evaluate(() => T.ui.ctx.settings.edgeScroll === false));
  await page.click('.zh-sw2[data-opt="edgeScroll"]');
  await shot('tab-opts', await panelClip());
  await page.click('.zh-btn.tab[data-tab="needs"]');
  // смерть: драматичный тост, портрет уходит
  await page.evaluate(() => { const o = T.state.sims[1]; o.dead = true; T.bus.emit('sim:died', { simId: o.id, cause: 'hunger' }); });
  await wait(300);
  check('смерть: тост и портрет убран', await page.locator('.zh-toast.death').count() === 1 && await page.locator('.zh-face').count() === 3);
  await shot('death');
  // стройка: крыша и лестница
  await page.keyboard.press('F3'); await wait(250);
  await page.click('.zh-btn.tool[data-tool="roof"]');
  await page.click('[data-roof="style:hip"]');
  await page.click('[data-roof="color:#5b6470"]');
  check('крыша: стиль и цвет', await page.evaluate(() => T.state.lot.roof.style === 'hip' && T.state.lot.roof.color === '#5b6470'));
  await shot('build-roof', await panelClip());
  await page.click('.zh-btn.tool[data-tool="stairs"]');
  // без пола наверху — причина у курсора
  const nf = await page.evaluate(() => T.render.S(4.5, 4.5));
  await page.mouse.move(nf.x, nf.y); await page.mouse.move(nf.x + 1, nf.y); await wait(200);
  check('лестница: причина отказа у курсора', /пол/i.test(await page.locator('.zh-tip').textContent()));
  // второй этаж над домом → место для лестницы внутри
  const st = await page.evaluate(() => {
    T.world.paintFloor(T.state, T.bus, 9, 12, 21, 21, 1, 1);
    for (let y = 12; y < 22; y++) for (let x = 9; x < 22; x++) for (const r of [0, 1, 2, 3]) if (T.world.canPlace(T.state, 'stairs', x, y, r, 0).ok) return { x, y, r, p: T.render.S(x + 0.5, y + 0.5) };
    return null;
  });
  check('есть место для лестницы', !!st);
  if (st) await page.evaluate(r => { for (let i = 0; i < r; i++) T.ui.build.rotate(1); }, st.r);
  if (st) { await page.mouse.move(st.p.x, st.p.y); await wait(200); await shot('build-stairs'); await page.mouse.click(st.p.x, st.p.y); await wait(200); }
  check('лестница поставлена', await page.evaluate(() => T.state.objects.some(o => o.def === 'stairs')));
  await page.keyboard.press('F1'); await wait(200);

  // 8. надёжность кликов: 50 быстрых кликов по скорости при идущем времени
  await page.goto(`http://localhost:${PORT}/tests/ui-harness.html`);
  await page.waitForFunction(() => window.ready && window.T);
  await wait(300);
  const btn = s => page.locator(`.zh-btn.spd[data-speed="${s}"]`).boundingBox();
  const b1 = await btn(1), b3 = await btn(3);
  const c0 = await page.evaluate(() => T.ui.debug.speedClicks);
  for (let i = 0; i < 50; i++) {
    const b = i % 2 ? b3 : b1;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { delay: 0 });
  }
  await wait(100);
  const c1 = await page.evaluate(() => T.ui.debug.speedClicks);
  check('50 быстрых кликов по скорости', c1 - c0 === 50, `${c1 - c0}/50`);
  check('последний клик применён (скорость 3)', await page.evaluate(() => T.state.time.speed === 3));
  // клавиши
  await page.keyboard.press('p'); check('P — пауза', await page.evaluate(() => T.state.time.speed === 0));
  await page.keyboard.press('2'); check('2 — скорость 2', await page.evaluate(() => T.state.time.speed === 2));
  await page.keyboard.press(' '); check('пробел — следующий сим', await page.evaluate(() => T.ui.ctx.selId === T.state.sims[1].id));
  // 50 быстрых кликов по портретам при бегущем времени
  const faces = await page.locator('.zh-face').all();
  const fb = [await faces[0].boundingBox(), await faces[1].boundingBox()];
  let okSel = 0;
  for (let i = 0; i < 50; i++) {
    const want = i % 2;
    await page.mouse.click(fb[want].x + 20, fb[want].y + 20, { delay: 0 });
    if (await page.evaluate(w => T.ui.ctx.selId === T.state.sims[w].id, want)) okSel++;
    fb[0] = await faces[0].boundingBox(); fb[1] = await faces[1].boundingBox();
  }
  check('50 кликов по портретам', okSel === 50, `${okSel}/50`);

  // 9. дымовой прогон с настоящим Мозгом: меню холодильника → очередь → тик
  await page.goto(`http://localhost:${PORT}/tests/ui-harness.html?brain=real`);
  await page.waitForFunction(() => window.ready && window.T);
  await wait(300);
  const fr = await page.evaluate(() => { const o = T.state.objects.find(x => x.def === 'fridge'); return T.render.S(o.x + 0.5, o.y + 0.5, 0.3); });
  await page.mouse.click(fr.x, fr.y); await wait(350);
  const nItems = await page.locator('.zh-pie .item:not(.dis)').count();
  check('настоящий Мозг: меню холодильника', nItems > 0, `${nItems} пунктов`);
  if (nItems) { await page.click('.zh-pie .item:not(.dis) >> nth=0'); await wait(400); }
  check('настоящий Мозг: действие в очереди', await page.locator('.zh-q').count() > 0);
  // кольцо прогресса у текущего действия идёт от actionProgress
  await page.evaluate(() => { const s = T.state.sims[0]; for (let i = 0; i < 3000 && !(T.sim.actionProgress(s) > 0.05); i++) T.sim.tick(T.state, T.bus, T.world, 0.25); });
  await wait(150);
  const ring = await page.evaluate(() => { const s = T.state.sims[0]; return { p: T.sim.actionProgress(s), css: document.querySelector('.zh-q.cur')?.style.getPropertyValue('--p') }; });
  check('кольцо прогресса = actionProgress', ring.p > 0 && ring.css != null && Math.abs(+ring.css - ring.p) < 0.05, JSON.stringify(ring));
  // скорость — через Мозг (событие time:speed)
  const evs = await page.evaluate(() => { let n = 0; T.bus.on('time:speed', () => n++); document.querySelector('.zh-btn.spd[data-speed="2"]').click(); document.querySelector('.zh-btn.spd[data-speed="0"]').click(); return { n, v: T.state.time.speed }; });
  check('скорость через setSpeed Мозга', evs.n === 2 && evs.v === 0, JSON.stringify(evs));
  // перенос через moveObject: деньги не трогаются
  await page.keyboard.press('F2'); await wait(200);
  const mv = await page.evaluate(() => { const o = T.state.objects.find(x => x.def === 'plant'); return { id: o.id, x: o.x, y: o.y, a: T.render.S(o.x + 0.5, o.y + 0.5, 0.3), m: T.state.household.money }; });
  await page.mouse.click(mv.a.x, mv.a.y); await wait(100);
  const dt = await page.evaluate(() => { for (let y = 26; y < 29; y++) for (let x = 2; x < 9; x++) if (T.world.canPlace(T.state, 'plant', x, y, 0, 0).ok) return { x, y }; });
  const dst = await page.evaluate(([x, y]) => T.render.S(x + 0.5, y + 0.5), [dt.x, dt.y]);
  await page.mouse.move(dst.x, dst.y); await wait(100);
  await page.mouse.click(dst.x, dst.y); await wait(150);
  const after = await page.evaluate(id => { const o = T.state.objects.find(x => x.id === id); return { x: o?.x, y: o?.y, m: T.state.household.money }; }, mv.id);
  check('перенос через moveObject (тот же id, деньги те же)', after.x === dt.x && after.y === dt.y && after.m === mv.m, JSON.stringify(after));
  await page.keyboard.press('F1'); await wait(200);
  await page.evaluate(() => { T.state.household.bills = [{ id: 1, amount: 312, day: 0 }]; T.state.brain = { ...(T.state.brain || {}), ultra: true }; T.state.sims[1].atWork = { track: 'business' }; T.state.sims[0].asleep = false; });
  await page.click('.zh-btn.tab[data-tab="job"]'); await wait(300);
  await shot('real-brain');

  // звук: все эффекты и голос отрабатывают без исключений (после жеста звук разблокирован)
  const au = await page.evaluate(async () => {
    const { audio, SFX } = await import('../js/audio/index.js');
    const names = Object.keys(SFX);
    for (const n of names) audio.sfx(n);
    const words = audio.speak(T.state.sims[0], { h01: 0.3, seed: 42 });
    audio.setMode('buy'); audio.frame(); audio.setMode('build'); audio.frame(); audio.setMode('live'); audio.frame();
    return { ready: audio.ready, n: names.length, words: words.join('-') };
  });
  check('звук: эффекты, голос, музыка', au.ready && au.n > 10 && au.words.length > 0, `${au.n} эффектов, «${au.words}»`);

  check('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  check('прогон без исключений', false, e.message);
} finally {
  await browser?.close();
  server.kill();
}
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} проверок прошло`);
process.exit(bad.length ? 1 : 0);
