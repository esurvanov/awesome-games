/* lib.mjs — shared harness for the bake tools (tools/bake/*.mjs).
 *
 *   const H = await openWorld({ root, label, size, headful, log, warm })
 *     Serves `root` (default: the game dir; the A/B experiment passes a scratch copy) with the artifact CSP and only the
 *     artifact-served file types (same rules as tools/stand.mjs), takes the benchmark lock of the REAL repo
 *     (tools/.stand.lock via tools/qa/hygiene.mjs — also when serving a scratch copy), opens open-world.html#dbg,
 *     waits for the loader, starts a new game and closes the intro dialog.
 *     → { browser, page, errors, failed, close() }
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { acquireLock } from '../qa/hygiene.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
export const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function serve(root = GAME, extraMime = {}) {
  const mime = Object.assign({}, MIME, extraMime);
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    const p = path.join(root, u === '/' ? '/open-world.html' : u);
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    const ext = path.extname(p).toLowerCase();
    if (!mime[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, { 'Content-Security-Policy': CSP }).end('not served'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

export async function openWorld(o = {}) {
  const log = o.log || ((...a) => console.log('[bake]', ...a));
  const root = o.root || GAME, [VW, VH] = o.size || [1400, 800];
  const release = await acquireLock(o.label || 'bake', { log });
  const srv = await serve(root, o.mime);
  const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`, '--autoplay-policy=no-user-gesture-required'];
  if (o.unlimited) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: !o.headful, args, userDataDir: path.join(GAME, 'tools', '.chrome-profile'),
      protocolTimeout: 1800000, defaultViewport: { width: VW, height: VH, deviceScaleFactor: 1 } });
  } catch (e) { srv.close(); release(); throw e; }
  const close = async () => { try { await browser.close(); } catch (e) { /* closed */ } try { srv.close(); } catch (e) { /* */ } release(); };
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => close().then(() => process.exit(130)));
  const page = await browser.newPage();
  const errors = [], failed = [];
  page.on('console', (m) => { const s = m.text(); if (m.type() === 'error' && !/^Failed to load resource/.test(s)) errors.push(s); if (o.echo) log('console', m.type(), s.slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) failed.push(r.status() + ' ' + r.url()); });
  const url = `http://127.0.0.1:${srv.address().port}/${o.page || 'open-world.html'}#dbg`;
  log('open', url, root === GAME ? '' : '(root ' + root + ')');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 150000, polling: 250 }); }
  catch (e) { await close(); throw new Error('loader never finished; errors: ' + errors.slice(0, 5).join(' | ')); }
  if (o.quality) await page.evaluate((q) => DBG.setQuality && DBG.setQuality(q), o.quality);
  await page.evaluate(() => { if (DBG.newGame) DBG.newGame(); else document.getElementById('bNew').click(); });
  await sleep(1200);
  const closeDialogs = () => page.evaluate(() => { let n = 0; while (DBG.Dialog && DBG.Dialog.active && n++ < 20) DBG.Dialog.close(); DBG.G.pause = false; const p = document.getElementById('pause'); if (p) p.hidden = true; });
  await closeDialogs(); await sleep(300); await closeDialogs();
  if (o.warm) { log(`warm-up ${o.warm} ms`); await sleep(o.warm); await closeDialogs(); }
  return { browser, page, errors, failed, close, log, closeDialogs, url };
}
