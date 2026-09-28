/* harness.mjs — shared browser harness for the QA tools (eye.mjs, inventory.mjs, qa.mjs, autoplay.mjs).
 *
 *   const H = await openGame({ label, size: [1400, 800], quality: 'high', headful, unlimited, page, lock: true, log })
 *     → { browser, page, url, errors, failed, warnings, loadMs, loader, gpu, load (machine load at start), close() }
 *   Same server rules as tools/stand.mjs (artifact CSP, only artifact-served file types). Takes the benchmark lock
 *   (tools/.stand.lock) unless lock:false, and injects tools/qa/qa-page.js (window.QA) after the game loads.
 *   H.newGame() starts a fresh game with the intro dialog closed; H.qa(fn, ...args) runs fn inside the page.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { acquireLock, quietCheck } from './hygiene.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'stand');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    const p = path.join(ROOT, u === '/' ? '/open-world.html' : u);
    if (!p.startsWith(ROOT) || /[\\/](\.env|server)([\\/]|$)/.test(p.slice(ROOT.length))) { res.writeHead(403).end(); return; }
    const ext = path.extname(p).toLowerCase();
    if (!MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, { 'Content-Security-Policy': CSP }).end('not served'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

export async function openGame(o = {}) {
  const log = o.log || ((...a) => console.log('[qa]', ...a));
  const [VW, VH] = o.size || [1400, 800];
  const release = o.lock === false ? () => {} : await acquireLock(o.label || 'qa', { log });
  const load = quietCheck();
  if (!load.quiet) log('machine busy: ' + load.reasons.join('; ') + ' — fps numbers from this run are not conclusive');
  const srv = await serve(), port = srv.address().port;
  const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`, '--autoplay-policy=no-user-gesture-required'];
  if (o.unlimited) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const userDataDir = o.cold ? undefined : path.join(ROOT, 'tools', '.chrome-profile');
  let browser;
  try { browser = await puppeteer.launch({ executablePath: CHROME, headless: !o.headful, args, userDataDir, protocolTimeout: 900000, defaultViewport: { width: VW, height: VH, deviceScaleFactor: o.dpr || 1 } }); }
  catch (e) { srv.close(); release(); throw e; }
  const close = async () => { try { await browser.close(); } catch (e) { /* closed */ } try { srv.close(); } catch (e) { /* */ } release(); };
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => close().then(() => process.exit(130)));
  const page = await browser.newPage();
  const errors = [], failed = [], warnings = [];
  const texSeen = new Set();   // TEXUNITS.md: texture-unit overflow = the material draws wrong without any GL error → an error line (once per text)
  page.on('console', (m) => { const t = m.type(), s = m.text(); if (t === 'error') { if (!/^Failed to load resource/.test(s)) errors.push(s); } else if (t === 'warning' || t === 'warn') warnings.push(s);
    if (/Trying to use \d+ texture units|\[TEXBUDGET\]/.test(s) && !texSeen.has(s)) { texSeen.add(s); errors.push('texture budget: ' + s); } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) failed.push(r.status() + ' ' + r.url()); });
  // STAND_QUERY (env) appends to the query of any tool built on this harness, e.g. STAND_QUERY=?colhull for an A/B run
  const q0 = o.query || '', qe = process.env.STAND_QUERY || '', query = q0 && qe ? q0 + '&' + qe.replace(/^\?/, '') : q0 || qe;
  const url = `http://127.0.0.1:${port}/${o.page || 'open-world.html'}${query}#dbg`;
  if (o.beforeLoad) await o.beforeLoad(page, port);
  log('open', url);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 120000, polling: 250 }); }
  catch (e) { await close(); throw new Error('loader never finished; errors: ' + errors.slice(0, 5).join(' | ')); }
  const loadMs = Date.now() - t0;
  const loader = await page.evaluate(() => [...document.querySelectorAll('.lmod')].map((e) => ({ id: e.id.replace('lm-', ''), ok: e.classList.contains('ok'), bad: e.classList.contains('bad') })));
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  log(`loaded in ${loadMs} ms · gpu: ${gpu} · modules ok ${loader.filter((m) => m.ok).length}/${loader.length}`);
  await page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-page.js'), 'utf8'));
  if (o.quality) await page.evaluate((q) => DBG.setQuality && DBG.setQuality(q), o.quality);
  const H = { browser, page, url, port, errors, failed, warnings, loadMs, loader, gpu, load, close, log, size: [VW, VH] };
  H.qa = (fn, ...a) => page.evaluate(fn, ...a);
  H.newGame = async () => {
    await page.evaluate(() => { if (DBG.newGame) DBG.newGame(); else document.getElementById('bNew').click(); });
    await sleep(1200);
    await page.evaluate(() => { QA.closeDialogs(); DBG.G.pause = false; document.getElementById('pause').hidden = true; });
    await sleep(300); await page.evaluate(() => QA.closeDialogs());
  };
  return H;
}
