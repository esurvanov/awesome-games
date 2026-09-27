// Плейтест интерфейса в НАСТОЯЩЕЙ игре (index.html: Рендер + Мир + Мозг) ~60 с.
// node tests/ui-game.mjs → tests/shots/game-*.png. Сервер — node на :8132 (python рвёт пачки ES-модулей), CDN кэшируется на диск.
import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests/shots');
const PORT = 8132;
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.css': 'text/css' };
const srv = await new Promise(r => {
  const s = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  s.listen(PORT, '127.0.0.1', () => r(s));
});
const CACHE = path.join(os.tmpdir(), 'zhitie-cdn'); mkdirSync(CACHE, { recursive: true });

let browser;
const t0 = Date.now();
try {
  browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    const url = route.request().url(), f = path.join(CACHE, url.replace(/[^a-z0-9.]+/gi, '_'));
    for (let i = 0; i < 3; i++) {
      try {
        if (!existsSync(f)) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(r.status); writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
        return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } });
      } catch { if (i === 2) return route.abort(); }
    }
  });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = name => page.screenshot({ path: path.join(SHOTS, `game-${name}.png`) });
  // экранная точка клетки/вершины через настоящий Рендер
  const scr = (x, y, h = 0) => page.evaluate(([x, y, h]) => zhitie.render.screenPos(x, h, y), [x, y, h]);

  await page.goto(`http://127.0.0.1:${PORT}/index.html?play`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.zhitie, null, { timeout: 120000 });
  await wait(2500);
  await shot('live');
  check('игра загрузилась, панель видна', await page.locator('.zh-main').isVisible());

  // 1. круговое меню на холодильнике → в очередь
  const fr = await page.evaluate(() => { const o = zhitie.state.objects.find(x => x.def === 'fridge'); return zhitie.render.screenPos(o.x + 0.5, 0.8, o.y + 0.5); });
  await page.mouse.click(fr.x, fr.y); await wait(500);
  const n = await page.locator('.zh-pie .item:not(.dis)').count();
  check('меню холодильника', n > 0, `${n} пунктов`);
  await shot('pie');
  const q0 = await page.evaluate(() => { const s = zhitie.state.sims[0]; return s.queue.length + (s.act ? 1 : 0); });
  if (n) await page.click('.zh-pie .item:not(.dis) >> nth=0');
  await wait(400);
  check('действие в очереди', await page.locator('.zh-q').count() > 0 && await page.evaluate(q => { const s = zhitie.state.sims[0]; return s.queue.length + (s.act ? 1 : 0) >= q; }, q0));

  // 2. скорости: кнопки и клавиши
  for (const s of [3, 2, 0, 1]) await page.click(`.zh-btn.spd[data-speed="${s}"]`);
  check('кнопки скорости', await page.evaluate(() => zhitie.state.time.speed === 1));
  await page.keyboard.press('3');
  await wait(8000); // жизнь идёт на быстрой
  await shot('running');
  const running = await page.evaluate(() => zhitie.state.time.minutes);
  await page.keyboard.press('p'); check('P — пауза', await page.evaluate(() => zhitie.state.time.speed === 0));
  await page.keyboard.press('1');
  check('время шло', running > 8 * 60 + 5, `минут ${Math.round(running)}`);

  // 3. покупка: поставить, подсветить, перенести, продать
  await page.keyboard.press('F2'); await wait(400);
  const free = await page.evaluate(() => {
    const out = [];
    for (let y = 24; y <= 28; y++) for (let x = 2; x <= 8; x++) if (zhitie.world.canPlace(zhitie.state, 'plant', x, y, 0, 0).ok) out.push({ x, y });
    return out;
  });
  check('есть свободные клетки', free.length >= 2, `${free.length}`);
  const [A, B] = [free[0], free[free.length - 1]];
  await page.fill('.ct-search', 'Фикус'); await wait(200); // каталог постраничный — ищем
  await page.click('.zh-card[data-def="plant"]');
  const a = await scr(A.x + 0.5, A.y + 0.5);
  await page.mouse.move(a.x, a.y); await wait(300);
  await shot('buy');
  const m0 = await page.evaluate(() => zhitie.state.household.money);
  await page.mouse.click(a.x, a.y); await wait(400);
  const placed = await page.evaluate(([x, y]) => zhitie.state.objects.find(o => o.def === 'plant' && o.x === x && o.y === y)?.id ?? null, [A.x, A.y]);
  check('куплено и поставлено', placed != null && await page.evaluate(m => zhitie.state.household.money === m - 60, m0));
  // взять и перенести
  const ap = await scr(A.x + 0.5, A.y + 0.5, 0.4);
  await page.mouse.move(ap.x, ap.y); await wait(250);
  await page.mouse.click(ap.x, ap.y); await wait(250);
  const b = await scr(B.x + 0.5, B.y + 0.5);
  await page.mouse.move(b.x, b.y); await wait(350);
  await shot('move');
  const m1 = await page.evaluate(() => zhitie.state.household.money);
  await page.mouse.click(b.x, b.y); await wait(400);
  const mv = await page.evaluate(id => { const o = zhitie.state.objects.find(x => x.id === id); return { x: o?.x, y: o?.y, m: zhitie.state.household.money }; }, placed);
  check('перенос: тот же предмет, деньги те же', mv.x === B.x && mv.y === B.y && mv.m === m1, JSON.stringify(mv));
  // продать Delete
  const bp = await scr(B.x + 0.5, B.y + 0.5, 0.4);
  await page.mouse.move(bp.x, bp.y); await wait(300);
  await page.keyboard.press('Delete'); await wait(300);
  check('продано', await page.evaluate(id => !zhitie.state.objects.some(o => o.id === id), placed) && await page.evaluate(m => zhitie.state.household.money > m, m1));

  // 4. стройка: стена и пол
  await page.keyboard.press('F3'); await wait(400);
  const w0 = await scr(3, 25), w1 = await scr(7, 25);
  const mw = await page.evaluate(() => zhitie.state.household.money);
  await page.mouse.move(w0.x, w0.y); await page.mouse.down();
  await page.mouse.move(w1.x, w1.y, { steps: 8 }); await wait(400);
  await shot('wall');
  await page.mouse.up(); await wait(400);
  check('стена построена', await page.evaluate(() => zhitie.world.isEdgeWall(zhitie.state, 0, 'h', 5, 25) > 0) && await page.evaluate(m => zhitie.state.household.money < m, mw));
  await page.click('.zh-btn.tool[data-tool="floor"]');
  await page.click('.zh-sw:not(.wall) >> nth=1');
  const f0 = await scr(3.5, 26.5), f1 = await scr(6.5, 27.5);
  await page.mouse.move(f0.x, f0.y); await page.mouse.down();
  await page.mouse.move(f1.x, f1.y, { steps: 8 }); await wait(400);
  await shot('floor');
  await page.mouse.up(); await wait(400);
  check('пол покрашен', await page.evaluate(() => zhitie.state.lot.levels[0].floor[27 * zhitie.state.lot.w + 5] > 0));

  // 5. волна 2: крыша, этажи
  await page.click('.zh-btn.tool[data-tool="roof"]'); await wait(200);
  await page.click('[data-roof="style:flat"]'); await wait(300);
  await page.click('[data-roof="color:#3f5d3a"]'); await wait(500);
  check('крыша: плоская, зелёная', await page.evaluate(() => zhitie.state.lot.roof?.style === 'flat' && zhitie.state.lot.roof?.color === '#3f5d3a'));
  await page.keyboard.press('Home'); await wait(700);
  await shot('roof');
  await page.keyboard.press('End'); await wait(200);
  await page.keyboard.press('F1'); await wait(300);
  await page.keyboard.press('PageUp'); await wait(600);
  const up = await page.evaluate(() => zhitie.render.level);
  await shot('level2');
  await page.keyboard.press('PageDown'); await wait(400);
  check('этажи: PageUp/PageDown', up === 1 && await page.evaluate(() => zhitie.render.level === 0), `вверх → ${up}`);

  // 6. диалог: время на паузе, ответ, скорость вернулась
  await page.keyboard.press('2'); await wait(200);
  const dlgId = await page.evaluate(() => {
    const s = zhitie.state.sims[0];
    if (zhitie.sim.ask) return zhitie.sim.ask(zhitie.state, zhitie.bus, { kind: 'test', simId: s.id, icon: '📰', text: 'Проверка: принять предложение?', options: [{ key: 'yes', label: 'Да' }, { key: 'no', label: 'Нет' }] });
    zhitie.bus.emit('dialog', { id: 'ui-test', simId: s.id, icon: '📰', text: 'Проверка: принять предложение?', options: [{ key: 'yes', label: 'Да' }, { key: 'no', label: 'Нет' }] });
    return 'ui-test';
  });
  await wait(400);
  check('диалог открыт, время стоит', await page.locator('.zh-dlgwrap').isVisible() && await page.evaluate(() => zhitie.state.time.speed === 0));
  await shot('dialog');
  await page.click('.zh-dlg .dbtn >> nth=1'); await wait(300);
  const hasAnswer = await page.evaluate(() => typeof zhitie.sim.answer === 'function');
  check('ответ отдан, скорость вернулась', !(await page.locator('.zh-dlgwrap').isVisible()) && await page.evaluate(() => zhitie.state.time.speed === 2), hasAnswer ? 'sim.answer' : '⚠️ sim.answer ещё не экспортирован Мозгом');

  // 7. телефон: «Вызвать…» → «Мастер» — звонит тот, кто дома
  await page.keyboard.press('1');
  const caller = await page.evaluate(() => zhitie.state.sims.find(s => !s.npc && !s.atWork && !s.dead)?.id);
  if (caller != null) { await page.click(`.zh-face[data-sim="${caller}"]`); await wait(200); }
  const ph = await page.evaluate(() => {
    const o = zhitie.state.objects.find(x => x.def === 'phone'); if (!o) return null;
    // телефон мелкий и стоит на стойке — ищем точку, где пик попадает именно в него
    const tried = [];
    for (let hgt = 0.6; hgt <= 1.4; hgt += 0.05) for (const [ox, oz] of [[0.5, 0.5], [0.4, 0.5], [0.6, 0.5], [0.5, 0.4], [0.5, 0.6]]) {
      const p = zhitie.render.screenPos(o.x + ox, hgt, o.y + oz); const k = zhitie.render.pick(p.x, p.y);
      if (k?.kind === 'object' && k.id === o.id) return p;
      tried.push(k?.kind + ':' + (k?.id ?? ''));
    }
    return { miss: [...new Set(tried)].join(' '), phone: o.id };
  });
  if (ph && !ph.miss) {
    await page.mouse.click(ph.x, ph.y); await wait(500);
    const grp = page.locator('.zh-pie .item.grp');
    if (await grp.count()) {
      await grp.first().hover(); await wait(400);
      await shot('phone');
      const rep = page.locator('.zh-pie .item.sub[data-key="call_repair"]');
      const can = await rep.count() && !(await rep.first().getAttribute('class')).includes('dis');
      if (can) await rep.first().click();
      await wait(300);
      check('телефон: подменю «Вызвать…»', can && await page.evaluate(id => zhitie.state.sims.find(s => s.id === id).queue.some(q => q.interaction === 'call_repair') || zhitie.state.sims.find(s => s.id === id).act?.key === 'call_repair', caller), can ? '«Мастер» в очереди' : 'мастер недоступен');
      if (!can) await page.keyboard.press('Escape');
    } else check('телефон: подменю «Вызвать…»', false, 'нет группы в меню');
  } else check('телефон найден пиком', false, JSON.stringify(ph));

  // 8. назад в жизнь, пузыри над нимбом
  await page.keyboard.press('F1'); await wait(300);
  await page.evaluate(() => { const [a, b] = zhitie.state.sims; zhitie.bus.emit('sim:speak', { simId: a.id, icon: '💬', withId: b.id }); zhitie.bus.emit('sim:speak', { simId: b.id, icon: '🍔' }); });
  await wait(600);
  await shot('bubbles');
  const home = await page.evaluate(() => zhitie.state.sims.filter(s => !s.atWork).length);
  check('пузыри только у тех, кто дома', await page.locator('.zh-bubble').count() === home, `${home} дома`);
  // НПС через отладку Мозга: тост прихода и подпись роли
  const npcOk = await page.evaluate(() => { try { zhitie.sim.debug?.spawnNpc?.(zhitie.state, zhitie.bus, 'maid'); return !!zhitie.sim.debug?.spawnNpc; } catch (e) { return String(e); } });
  await wait(600);
  const npcs = await page.evaluate(() => ({ inPortraits: [...document.querySelectorAll('.zh-face')].some(f => zhitie.state.sims.find(s => s.id === +f.dataset.sim)?.npc), toast: [...document.querySelectorAll('.zh-toast .tt')].map(t => t.textContent).join(' | ') }));
  check('НПС: не в портретах, тост прихода', npcOk === true && !npcs.inPortraits && /горничная/i.test(npcs.toast), npcs.toast.slice(0, 80));
  await shot('npc');

  // 9. жизнь сама по себе ~30 с на скорости 2: автономия, счета, уведомления — без ошибок
  await page.keyboard.press('2');
  await wait(30000);
  await shot('life');
  check('30 с жизни прошли', await page.evaluate(() => zhitie.state.time.minutes > 10 * 60));
  check('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  check('прогон без исключений', false, e.message);
} finally {
  await browser?.close();
  srv.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} · ${Math.round((Date.now() - t0) / 1000)} с`);
process.exit(results.every(Boolean) ? 0 : 1);
