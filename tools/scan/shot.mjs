#!/usr/bin/env node
/* tools/scan/shot.mjs — open a page of the game dir in headless Chrome (GPU, emulated artifact CSP like tools/stand.mjs),
 * wait for window.__bench.ready, screenshot, print window.__bench.
 *   node tools/scan/shot.mjs "tools/scan/preview.html?lod=0" out.png [--csp on|off] [--wait 2500] [--size 1400x800]
 */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2); const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const [page_, out] = argv; const [VW, VH] = String(opt('size', '1400x800')).split('x').map(Number);
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const csp = opt('csp', 'on') === 'on';
const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const p = path.join(ROOT, u), ext = path.extname(p).toLowerCase(); const h = csp ? { 'Content-Security-Policy': CSP } : {};
  if (!p.startsWith(ROOT) || !MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, h).end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store', ...h }); fs.createReadStream(p).pipe(res); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: path.join(HERE, '.work/chrome-bench'),
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${VW},${VH}`], defaultViewport: { width: VW, height: VH, deviceScaleFactor: 1 } });
try {
  const page = await browser.newPage(); const logs = []; page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => logs.push(String(e.message).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${srv.address().port}/${page_}`, { waitUntil: 'load', timeout: 120000 });
  for (let i = 0; i < 240; i++) { if (await page.evaluate(() => window.__bench && window.__bench.ready).catch(() => false)) break; await new Promise((r) => setTimeout(r, 250)); }
  await new Promise((r) => setTimeout(r, Number(opt('wait', 2500))));
  if (out) await page.screenshot({ path: out });
  const b = await page.evaluate(() => JSON.parse(JSON.stringify(window.__bench || {})));
  console.log(JSON.stringify({ ...b, fps: undefined, frameMs: undefined, consoleErrors: logs }, null, 1));
} finally { await browser.close(); srv.close(); }
