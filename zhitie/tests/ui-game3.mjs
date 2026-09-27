// Волна 3 в НАСТОЯЩЕЙ игре: загрузка → район → семья → играть → парк → домой; CAS → выселить → заселить;
// покупка варианта через поиск. node tests/ui-game3.mjs → tests/shots/game3-*.png. Сервер — node на :8137.
import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests/shots');
const PORT = 8137;
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
try {
  browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
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
  const shot = name => page.screenshot({ path: path.join(SHOTS, `game3-${name}.png`) });
  const t0 = Date.now();
  // клик по участку в 3D-районе: точка, где пик Рендера даёт {kind:'lot', lotId}
  const clickLot = async id => {
    const p = await page.evaluate(id => {
      const l = zhitie.state.hood.lots.find(x => x.id === id);
      for (const [fx, fz] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.5, 0.8], [0.5, 0.2], [0.2, 0.6]]) {
        const q = zhitie.render.screenPos(l.x + l.w * fx, 0.1, l.y + l.h * fz), k = zhitie.render.pick(q.x, q.y);
        if (k?.kind === 'lot' && k.lotId === id && q.x > 20 && q.y > 80 && q.x < innerWidth - 330 && q.y < innerHeight - 20) return q;
      }
      return null;
    }, id);
    if (!p) return false;
    await page.mouse.move(p.x - 4, p.y); await page.mouse.move(p.x, p.y); await wait(250);
    await page.mouse.click(p.x, p.y); await wait(300);
    return true;
  };

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'commit' });
  // загрузка видна, пока Рендер грузит модели
  await page.waitForSelector('.zh-loading', { timeout: 30000 });
  const joke = await page.evaluate(() => document.querySelector('.ld-line')?.textContent || '');
  await shot('loading');
  check('экран загрузки с шуткой', joke.length > 3, joke);
  await page.waitForFunction(() => window.zhitie?.render, null, { timeout: 120000 });
  await wait(1500);
  check('после загрузки — район', await page.locator('.zh-hood').isVisible() && !(await page.locator('.zh-loading').count()));
  check('время стоит на карте', await page.evaluate(() => zhitie.state.time.speed === 0));
  check('район — 3D Рендера, 2D-сетка скрыта', await page.evaluate(() => zhitie.render.view === 'hood') && !(await page.locator('.hd-map').isVisible()));
  await shot('hood');

  // семья Самоваровых: наведение → всплывашка с портретами, клик → карточка и рамка
  check('клик по участку в 3D', await clickLot('res2'));
  const tipTxt = await page.locator('.zh-tip').textContent().catch(() => '');
  check('всплывашка над участком', /Самовар/.test(tipTxt || ''), tipTxt);
  check('карточка семьи', /Самовар/.test(await page.locator('.hd-card .hc-head b').textContent()));
  check('рамка выбранного участка', await page.evaluate(() => (document.querySelector('.hd-outl .sel')?.getAttribute('points') || '').split(' ').length === 4));
  await shot('hood-card');
  // «Список» — 2D для доступности
  await page.click('[data-act="list"]'); await wait(200);
  check('«Список» показывает 2D-сетку', await page.locator('.hd-map').isVisible());
  await shot('hood-list');
  await page.click('[data-act="list"]'); await wait(150);
  await page.click('.hd-card [data-act="play"]'); await wait(2500);
  const play = await page.evaluate(() => ({ lot: zhitie.state.hood.activeLotId, hh: zhitie.state.sims.filter(s => !s.npc && s.household !== false).map(s => s.name), sel: document.querySelector('.zh-face.on')?.title }));
  check('играем за семью res2', play.lot === 'res2' && play.hh.length > 0 && !!play.sel, JSON.stringify(play));
  check('время пошло', await page.evaluate(() => zhitie.state.time.speed >= 1));
  await shot('play');

  // поездка в парк и домой
  await page.click('[data-act="travel"]'); await wait(300);
  await shot('travel');
  await page.click('.zh-travel [data-lot="park"]'); await wait(2500);
  const park = await page.evaluate(() => ({ lot: zhitie.state.hood.activeLotId, hh: zhitie.state.sims.filter(s => !s.npc && s.household !== false).length }));
  check('в парке вместе с семьёй', park.lot === 'park' && park.hh > 0, JSON.stringify(park));
  await shot('park');
  await page.click('[data-act="travel"]'); await wait(300);
  await page.click('.zh-travel [data-lot="home"]'); await wait(2500);
  check('домой', await page.evaluate(() => zhitie.state.hood.activeLotId === 'res2'));

  // общение: Shift+клик по члену семьи → категории-подменю
  const mate = await page.evaluate(() => {
    const sel = +document.querySelector('.zh-face.on')?.dataset.sim;
    const s = zhitie.state.sims.find(x => !x.npc && x.id !== sel && !x.atWork && !x.dead && x.age !== 'child');
    if (!s) return null;
    zhitie.render.focus(s.x, s.y, true);
    return s.id;
  });
  await wait(700);
  const mp = mate && await page.evaluate(id => { const s = zhitie.state.sims.find(x => x.id === id); for (const hgt of [1.0, 1.3, 0.7, 1.5]) { const p = zhitie.render.screenPos(s.x, hgt, s.y); const k = zhitie.render.pick(p.x, p.y); if (k?.kind === 'sim' && k.id === id) return p; } return null; }, mate);
  if (mp) {
    await page.keyboard.down('Shift'); await page.mouse.click(mp.x, mp.y); await page.keyboard.up('Shift'); await wait(500);
    const groups = await page.locator('.zh-pie .item.grp').count();
    const heads = await page.$$eval('.zh-pie .item.grp .il', e => e.map(x => x.textContent));
    check('общение: категории Мозга', groups >= 3 && heads[0] === 'Разговор…', heads.join(' '));
    if (groups) { await page.hover('.zh-pie .item.grp >> nth=0'); await wait(400); }
    await shot('social');
    await page.keyboard.press('Escape'); await wait(200);
  } else check('житель для общения виден', false);
  // желания и устремление настоящего Мозга
  await page.click('.zh-btn.tab[data-tab="wants"]'); await wait(400);
  const ws = await page.evaluate(() => ({ want: document.querySelectorAll('.ws-slots.want .ws-slot:not(.empty)').length, fear: document.querySelectorAll('.ws-slots.fear .ws-slot:not(.empty)').length, asp: document.querySelector('.ws-an')?.textContent }));
  check('желания/страхи Мозга', ws.want + ws.fear > 0 && !!ws.asp, JSON.stringify(ws));
  // замок: клик по первому невыполненному желанию → sim.wants.locked
  const wantEl = page.locator('.ws-slots.want .ws-slot:not(.empty):not(.done)').first();
  if (await wantEl.count()) {
    await wantEl.click(); await wait(300);
    const lk = await page.evaluate(() => { const s = zhitie.state.sims.find(x => x.id === +document.querySelector('.zh-face.on').dataset.sim); return { locked: s.wants?.locked, ui: document.querySelectorAll('.ws-slot.locked').length }; });
    check('замок желания', !!lk.locked && lk.ui === 1, JSON.stringify(lk));
  }
  await page.screenshot({ path: path.join(SHOTS, 'game3-wants.png'), clip: { x: 0, y: 600, width: 640, height: 260 } });
  await page.click('.zh-btn.tab[data-tab="needs"]');

  // покупка варианта через поиск
  await page.keyboard.press('F2'); await wait(400);
  // новинки и коллекции от Каталога
  await page.click('.zh-cats .tab[data-cat="new"]'); await wait(200);
  const nw = await page.evaluate(() => [...document.querySelectorAll('.zh-card')].every(c => zhitie.world && true) && document.querySelectorAll('.zh-card .nw').length);
  check('✨ новинки (isNew Каталога)', nw > 0, `${nw} на странице`);
  await page.click('.zh-cats .tab[data-cat="all"]'); await wait(100);
  await page.click('.ct-sm >> nth=0'); await wait(200);
  const colls = await page.$$eval('.ct-chip', e => e.map(x => x.textContent));
  check('коллекции Каталога', colls.length >= 5 && colls.some(t => /Скандинав/.test(t)), colls.slice(0, 4).join(' | '));
  await shot('collections');
  await page.click('.ct-sm >> nth=0'); await wait(100);
  await page.fill('.ct-search', 'кресло'); await wait(300);
  const dots = page.locator('.zh-card >> nth=0 >> .vdots i');
  const nd = await dots.count();
  if (nd > 1) await dots.nth(nd - 1).click(); else await page.click('.zh-card >> nth=0');
  await wait(200);
  const def = await page.evaluate(() => zhitie.state.mode === 'buy' && document.querySelector('.zh-card.on')?.dataset.def);
  const spot = await page.evaluate(d => {
    const W = zhitie.world, st = zhitie.state, sel = document.querySelector('.zh-card.on');
    const id = [...(sel?.querySelectorAll('.vdots i.on') || [])][0]?.dataset.var || sel?.dataset.def;
    for (let y = 2; y < st.lot.h - 2; y++) for (let x = 2; x < st.lot.w - 2; x++) if (W.canPlace(st, id, x, y, 0, 0).ok) { const p = zhitie.render.screenPos(x + 0.5, 0, y + 0.5); if (p.x > 80 && p.y > 80 && p.x < innerWidth - 80 && p.y < innerHeight - 260) { const k = zhitie.render.pick(p.x, p.y); if (k && Math.floor(k.x) === x && Math.floor(k.y) === y) return { x, y, p, id }; } }
    return null;
  }, def);
  check('есть место для кресла', !!spot);
  if (spot) {
    const m0 = await page.evaluate(() => zhitie.state.household.money);
    await page.mouse.move(spot.p.x, spot.p.y); await wait(300);
    await shot('buy-variant');
    await page.mouse.click(spot.p.x, spot.p.y); await wait(400);
    const got = await page.evaluate(([x, y]) => zhitie.state.objects.find(o => o.x === x && o.y === y)?.def, [spot.x, spot.y]);
    check('вариант куплен через поиск', got === spot.id && await page.evaluate(m => zhitie.state.household.money < m, m0), `${got}`);
  }
  await page.keyboard.press('F1'); await wait(300);

  // CAS → выселить Копейкиных → заселить новую семью
  await page.click('[data-act="hood"]'); await wait(1500);
  await page.click('[data-act="cas"]'); await wait(300);
  check('CAS: причина от Мира видна', /фамили/i.test(await page.locator('.cs-why').textContent()), await page.locator('.cs-why').textContent());
  await page.fill('.cs-fam', 'Юдины');
  await page.fill('.cs-name', 'Лиза');
  await page.click('.cs-row[data-row="sex"] .cs-opt[data-v="f"]');
  await page.click('[data-act="add"]'); await wait(100);
  await page.fill('.cs-name', 'Паша');
  await page.click('.cs-row[data-row="sex"] .cs-opt[data-v="child"]');
  await wait(200);
  await shot('cas');
  await page.click('.cs-done'); await wait(500);
  await clickLot('res3');
  await page.click('.hd-card [data-act="evict"]'); await wait(500);
  await clickLot('res3');
  await page.click('.hd-card [data-act="movein"]'); await wait(200);
  const yud = await page.evaluate(() => zhitie.state.hood.families.find(f => f.name === 'Юдины')?.id);
  await page.click(`.zh-modal[data-ui="movein"] [data-fam="${yud}"]`); await wait(3000);
  const mv = await page.evaluate(() => ({ lot: zhitie.state.hood.activeLotId, hh: zhitie.state.sims.filter(s => !s.npc && s.household !== false).map(s => s.name).sort().join(','), hood: !document.querySelector('.zh-hood').hidden }));
  check('Юдины заселились и играют', mv.lot === 'res3' && mv.hh === 'Лиза,Паша' && !mv.hood, JSON.stringify(mv));
  await shot('movein');
  console.log(`⏱ ${Math.round((Date.now() - t0) / 1000)} с`);
  check('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  check('прогон без исключений', false, e.message);
} finally {
  await browser?.close();
  srv.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
