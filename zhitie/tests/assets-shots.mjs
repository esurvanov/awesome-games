// Скриншоты превью ассетов: node tests/assets-shots.mjs [view...]
// Поднимает python3 -m http.server 8132 в корне проекта, снимает tests/assets-preview.html, гасит сервер.
// Выход: tests/shots/assets-*.png + tests/shots/assets-stats.json
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8132;
const SHOTS = [
  ['furniture', 'view=furniture&cam=front', [1600, 1000]],
  ['furniture-back', 'view=furniture&cam=back', [1600, 1000]],
  ['furniture-top', 'view=furniture&cam=top', [1600, 1000]],
  ['chars', 'view=chars&set=all', [1600, 800]],
  ['chars-legacy', 'view=chars&set=legacy', [1400, 800]],
  ['props', 'view=props', [1500, 900]],
  ['lib-kind', 'view=lib&group=kind&per=60&cols=10', [1600, 1000]],
  ...[0, 1, 2, 3].map(i => [`lib-furn${i}`, `view=lib&group=furn&per=56&cols=8&page=${i}`, [1600, 1000]]),
  ...[0, 1, 2].map(i => [`lib-hood${i}`, `view=lib&group=hood&per=56&cols=8&page=${i}`, [1600, 1000]]),
  ...[0, 1, 2, 3, 4, 5].map(i => [`cat${i}`, `view=furniture&extra=1&per=48&cols=8&page=${i}`, [1600, 1000]]),
  ['cas-hair-m', 'view=cas&set=hair_m', [1600, 800]],
  ['cas-hair-f', 'view=cas&set=hair_f', [1600, 1000]],
  ['cas-acc-m', 'view=cas&set=acc_m', [1600, 800]],
  ['cas-acc-f', 'view=cas&set=acc_f', [1600, 800]],
  ['cas-outfit-m', 'view=cas&set=outfit_m', [1600, 900]],
  ['cas-outfit-f', 'view=cas&set=outfit_f', [1600, 900]],
  ['cas-body-m', 'view=cas&set=body_m', [1200, 600]],
  ['cas-body-f', 'view=cas&set=body_f', [1200, 600]],
  ['anims-male', 'view=anims&char=male&t=0.5', [1600, 1000]],
  ['anims-female', 'view=anims&char=female_b&t=0.5', [1600, 1000]],
  ['anims-t25', 'view=anims&char=male&t=0.25', [1600, 1000]],
];
const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
const extra = process.argv.find(a => a.startsWith('--extra='));  // --extra=name|querystring  (разовая съёмка)
if (extra) { const [n, qs] = extra.slice(8).split('|'); SHOTS.push([n, qs, [1600, 1000]]); want.push(n); }
// three@0.169 с jsdelivr; если CDN недоступен — можно подсунуть локальную копию: THREE_DIR=/path/to/node_modules/three
const THREE_DIR = process.env.THREE_DIR && existsSync(process.env.THREE_DIR) ? process.env.THREE_DIR : null;
mkdirSync(path.join(ROOT, 'tests/shots'), { recursive: true });

const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const statsFile = path.join(ROOT, 'tests/shots/assets-stats.json');
const stats = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, 'utf8')) : {};
try {
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, qs, [w, h]] of SHOTS) {
    if (want.length && !want.includes(name)) continue;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    if (THREE_DIR) await page.route('https://cdn.jsdelivr.net/npm/three@0.169.0/**', (route) => {
      const rel = route.request().url().split('three@0.169.0/')[1]; const f = path.join(THREE_DIR, rel);
      return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: 'application/javascript' }) : route.continue();
    });
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/tests/assets-preview.html?${qs}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(e => errs.push('timeout: ' + e.message));
    await page.waitForTimeout(300);
    const file = path.join(ROOT, `tests/shots/assets-${name}.png`);
    // снимок прямо с canvas (preserveDrawingBuffer) — быстрее и стабильнее page.screenshot на swiftshader
    const data = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png')).catch(() => null);
    if (data) writeFileSync(file, Buffer.from(data.split(',')[1], 'base64')); else await page.screenshot({ path: file, timeout: 120000 });
    stats[name] = { stats: await page.evaluate(() => window.__stats || null), errors: errs };
    console.log(name, '→', path.relative(ROOT, file), errs.length ? 'ERR ' + errs.join(' | ') : 'ok');
    await page.close();
  }
  await browser.close();
} finally {
  srv.kill();
}
writeFileSync(path.join(ROOT, 'tests/shots/assets-stats.json'), JSON.stringify(stats, null, 1));
