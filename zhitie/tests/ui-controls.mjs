// Проверка «простого управления» в НАСТОЯЩЕЙ игре (index.html), экран как у игрока: 1512×857, dpr 2.
// node tests/ui-controls.mjs → tests/shots/controls-*.png. Сервер — node на :8133, CDN кэшируется.
import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tests/shots');
const PORT = 8133;
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
  const page = await browser.newPage({ viewport: { width: 1512, height: 857 }, deviceScaleFactor: 2 });
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
  const shot = name => page.screenshot({ path: path.join(SHOTS, `controls-${name}.png`) });
  const cam = () => page.evaluate(() => { const g = zhitie.render.rig.goal; return { x: +g.x.toFixed(2), z: +g.z.toFixed(2), h: zhitie.render.rig.viewHGoal }; });
  const moved = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const cursor = () => page.evaluate(() => document.querySelector('canvas').style.cursor);
  // пустая трава: точка, где пик даёт клетку без предметов
  const grass = () => page.evaluate(() => {
    for (const [x, y] of [[4, 6], [6, 4], [25, 6], [5, 25], [26, 26], [3, 15]]) {
      const p = zhitie.render.screenPos(x + 0.5, 0, y + 0.5);
      if (p.x < 60 || p.y < 80 || p.x > innerWidth - 60 || p.y > innerHeight - 240) continue;
      const k = zhitie.render.pick(p.x, p.y);
      if (k?.kind === 'tile') return p;
    }
    return { x: innerWidth / 2, y: 180 };
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html?play`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.zhitie?.render?.rig, null, { timeout: 120000 });
  await wait(2500);
  check('подсказка управления видна при первом запуске', await page.locator('.zh-hints').isVisible());
  await shot('hints');

  // 1. левое перетаскивание по траве двигает камеру и не открывает меню
  let c0 = await cam(), g = await grass();
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  await page.mouse.move(g.x + 90, g.y + 40, { steps: 6 });
  const curDrag = await cursor();
  await page.mouse.move(g.x + 220, g.y + 90, { steps: 10 });
  await shot('drag');
  await page.mouse.up(); await wait(300);
  let c1 = await cam();
  check('левый drag двигает камеру', moved(c0, c1) > 1, `сдвиг ${moved(c0, c1).toFixed(2)} м`);
  check('курсор «рука» при перетаскивании', curDrag === 'grabbing', curDrag);
  check('после drag меню не открылось', await page.locator('.zh-pie').count() === 0);

  // 2. клик по траве → «Идти сюда»; потом стрелки/WASD двигают камеру (фокус не заперт)
  g = await grass();
  await page.mouse.click(g.x, g.y); await wait(400);
  check('клик по траве → меню', await page.locator('.zh-pie .item').count() > 0);
  await page.keyboard.press('Escape'); await wait(200);
  c0 = await cam();
  await page.keyboard.down('ArrowRight'); await wait(500); await page.keyboard.up('ArrowRight'); await wait(150);
  c1 = await cam();
  check('стрелки двигают после клика по миру', moved(c0, c1) > 1, `${moved(c0, c1).toFixed(2)} м`);
  // после клика по кнопке скорости фокус не держится — WASD и пробел идут в игру
  await page.click('.zh-btn.spd[data-speed="2"]');
  c0 = await cam();
  await page.keyboard.down('KeyW'); await wait(500); await page.keyboard.up('KeyW'); await wait(150);
  c1 = await cam();
  check('WASD двигают после клика по кнопке', moved(c0, c1) > 1, `${moved(c0, c1).toFixed(2)} м`);
  const sel0 = await page.evaluate(() => document.querySelector('.zh-face.on')?.dataset.sim);
  await page.keyboard.press('Space'); await wait(150);
  const after = await page.evaluate(() => ({ sp: zhitie.state.time.speed, sel: document.querySelector('.zh-face.on')?.dataset.sim, focus: document.activeElement?.tagName }));
  check('пробел не «жмёт» кнопку, а переключает жителя', after.sp === 2 && after.sel !== sel0, JSON.stringify(after));
  check('Q/E поворачивают', await (async () => { const r0 = await page.evaluate(() => zhitie.render.rotation); await page.keyboard.press('KeyE'); await wait(100); return (await page.evaluate(() => zhitie.render.rotation)) !== r0; })());
  await page.keyboard.press('KeyQ'); await wait(700);

  // 3. колесо: зум к курсору (точка под мышью почти на месте)
  g = await grass();
  const w0 = await page.evaluate(([x, y]) => { const k = zhitie.render.pick(x, y); return { x: k.wx, z: k.wz, h: zhitie.render.rig.viewHGoal }; }, [g.x, g.y]);
  await page.mouse.move(g.x, g.y); await page.mouse.wheel(0, -120); await wait(1200);
  const w1 = await page.evaluate(([x, y]) => { const k = zhitie.render.pick(x, y); return { x: k.wx, z: k.wz, h: zhitie.render.rig.viewHGoal }; }, [g.x, g.y]);
  check('колесо — зум', w1.h < w0.h, `${w0.h} → ${w1.h}`);
  check('зум к курсору', Math.hypot(w1.x - w0.x, w1.z - w0.z) < 1.5, `смещение точки ${Math.hypot(w1.x - w0.x, w1.z - w0.z).toFixed(2)} м`);
  await page.mouse.wheel(0, 120); await wait(900);

  // 4. наведение на холодильник → «палец» и подсветка; клик → меню
  await page.evaluate(() => { const o = zhitie.state.objects.find(x => x.def === 'fridge'); zhitie.render.focus(o.x + 0.5, o.y + 0.5, true); });
  await wait(600);
  const fr = await page.evaluate(() => {
    const o = zhitie.state.objects.find(x => x.def === 'fridge');
    const seen = [];
    for (const hgt of [0.8, 1.0, 0.6, 1.2, 1.5, 0.4]) { const p = zhitie.render.screenPos(o.x + 0.5, hgt, o.y + 0.5); const k = zhitie.render.pick(p.x, p.y); if (k?.id === o.id && k.kind === 'object') return p; seen.push(`${k?.kind}:${k?.id}@${Math.round(p.x)},${Math.round(p.y)}`); }
    return { miss: seen.join(' '), fridge: o.id };
  });
  check('холодильник виден', fr && !fr.miss, JSON.stringify(fr));
  if (fr && !fr.miss) {
    await page.mouse.move(fr.x - 3, fr.y); await page.mouse.move(fr.x, fr.y); await wait(400);
    check('курсор «палец» над предметом', (await cursor()) === 'pointer', await cursor());
    await page.mouse.click(fr.x, fr.y); await wait(500);
    check('клик по холодильнику → меню', await page.locator('.zh-pie .item').count() > 0);
    await shot('pie');
    await page.keyboard.press('Escape'); await wait(200);
  }
  // подсказка погасла после пана и клика; «?» возвращает
  await wait(1200);
  check('подсказка погасла после пана и клика', !(await page.locator('.zh-hints').isVisible()));
  await page.click('.zh-btn.cam.help'); await wait(300);
  check('«?» показывает подсказку снова', await page.locator('.zh-hints').isVisible());
  await page.click('.zh-hx'); await wait(500);

  // 5. клик по другому жителю — выбрать его
  await page.evaluate(() => { const sel = +document.querySelector('.zh-face.on')?.dataset.sim; const s = zhitie.state.sims.find(x => !x.npc && x.id !== sel && !x.atWork && !x.dead); if (s) zhitie.render.focus(s.x, s.y, true); });
  await wait(600);
  const other = await page.evaluate(() => {
    const sel = +document.querySelector('.zh-face.on')?.dataset.sim;
    const s = zhitie.state.sims.find(x => !x.npc && x.id !== sel && !x.atWork && !x.dead);
    if (!s) return null;
    for (const hgt of [1.0, 1.3, 0.7, 1.5]) { const p = zhitie.render.screenPos(s.x, hgt, s.y); const k = zhitie.render.pick(p.x, p.y); if (k?.kind === 'sim' && k.id === s.id) return { ...p, id: s.id }; }
    return { miss: s.id };
  });
  if (other && !other.miss) {
    await page.mouse.click(other.x, other.y); await wait(300);
    check('клик по жителю выбирает его', await page.evaluate(id => +document.querySelector('.zh-face.on')?.dataset.sim === id, other.id));
  } else check('житель виден для клика', false, JSON.stringify(other));

  // 6. скорость: крупные кнопки и подпись текущей
  const sb = await page.locator('.zh-btn.spd[data-speed="1"]').boundingBox();
  await page.keyboard.press('Digit3'); await wait(200);
  const spx = await page.locator('.zh-clock .spx').textContent();
  check('кнопки скорости крупные, скорость подписана', sb.height >= 32 && /×/.test(spx), `${Math.round(sb.height)} px, «${spx}»`);
  await shot('final');
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
