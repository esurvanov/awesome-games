#!/usr/bin/env node
/* tools/scan/splat-bench.mjs — fps / memory / CSP check of splat renderers in headless Chrome with the GPU (Metal).
 *
 *   node tools/scan/splat-bench.mjs [--names a,b] [--renderers spark,three,three-webgl,none] [--csp on|off|both]
 *                                   [--secs 6] [--size 1400x800] [--out DIR] [--unlimited] [--sync]
 * --sync: also time 120 frames with a GPU sync after each render (real frame cost; vsync fps alone saturates at 60)
 *
 * Serves the game directory like tools/stand.mjs (emulated artifact CSP + only artifact file types), opens
 * tools/scan/splat-test.html per (name × renderer × csp), waits for load, samples fps for --secs while the camera orbits
 * (re-sort every frame = worst case). Memory: JS heap (CDP) and the GPU process physical footprint (macOS `footprint`,
 * includes Metal allocations) against a no-splat baseline. Writes <out>/bench.json + one PNG per run.
 * One benchmark browser at a time (tools/.stand.lock via tools/qa/hygiene.mjs).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { acquireLock, quietCheck } from '../qa/hygiene.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const [VW, VH] = String(opt('size', '1400x800')).split('x').map(Number);
const OUT = path.resolve(opt('out', path.join(ROOT, 'assets/incoming4/scan/_bench')));
const names = String(opt('names', 'splat_cactus_464k')).split(',');
const renderers = String(opt('renderers', 'spark,three,three-webgl')).split(',').filter((r) => r !== 'none');
const csps = opt('csp', 'both') === 'both' ? ['on', 'off'] : [opt('csp', 'on')];
const secs = Number(opt('secs', 6));

function serve(csp) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); const p = path.join(ROOT, u);
    const ext = path.extname(p).toLowerCase(); const h = csp ? { 'Content-Security-Policy': CSP } : {};
    if (!p.startsWith(ROOT) || !MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, h).end('not served'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store', ...h }); fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
function gpuFootprintMB(browserPid) {
  try {
    const ps = execSync('ps -A -o pid=,ppid=,command=', { encoding: 'utf8' }).split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
    const kids = new Set([browserPid]); let grew = true; while (grew) { grew = false; for (const [, pid, ppid] of ps) if (kids.has(+ppid) && !kids.has(+pid)) { kids.add(+pid); grew = true; } }
    const gpu = ps.find(([, pid, , cmd]) => kids.has(+pid) && /--type=gpu-process/.test(cmd)); if (!gpu) return null;
    const f = execSync(`footprint -p ${gpu[1]} 2>/dev/null | grep -i -E 'phys_footprint:|Footprint:' | head -1`, { encoding: 'utf8' });
    const m = f.match(/([\d.]+)\s*(KB|MB|GB)/i); if (!m) return null; return +(+m[1] * ({ KB: 1 / 1024, MB: 1, GB: 1024 }[m[2].toUpperCase()])).toFixed(1);
  } catch { return null; }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.95)] : null; };

const release = await acquireLock('splat-bench', { log: (...a) => console.log('[bench]', ...a) });
const load = quietCheck(); if (!load.quiet) console.log('[bench] note: machine busy', JSON.stringify(load).slice(0, 200));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
try {
  for (const csp of csps) {
    const srv = await serve(csp === 'on'); const port = srv.address().port;
    const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-webgpu', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`, '--enable-precise-memory-info'];
    if (opt('unlimited')) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
    try {
      for (const name of names) for (const r of renderers) {
        // fresh browser per run: GPU-process memory = footprint after load − footprint on the same page with no splats
        const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, userDataDir: path.join(HERE, '.work/chrome-bench'), defaultViewport: { width: VW, height: VH, deviceScaleFactor: 1 }, protocolTimeout: 600000 });
        const bpid = browser.process().pid;
        try {
          const page = await browser.newPage(); const logs = [];
          page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 240)); });
          page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 240)));
          const waitReady = async () => { for (let i = 0; i < 240; i++) { if (await page.evaluate(() => window.__bench && window.__bench.ready).catch(() => false)) return true; await sleep(250); } return false; };
          const base = `http://127.0.0.1:${port}/tools/scan/splat-test.html?name=${name}` + (opt('sync') ? '&sync=1' : '');
          await page.goto(base + '&r=none', { waitUntil: 'load', timeout: 120000 }); await waitReady(); await sleep(2000);
          const gpu0 = gpuFootprintMB(bpid); const syncBase = await page.evaluate(() => window.__bench.syncMs).catch(() => null);
          const rr = r === 'three-webgl' ? 'three&webgl=1' : r;
          const t = Date.now(); await page.goto(base + '&r=' + rr, { waitUntil: 'load', timeout: 120000 });
          const ok = await waitReady();
          await sleep(1500); await page.evaluate(() => { window.__bench.fps = []; window.__bench.frameMs = []; }).catch(() => {});
          await sleep(secs * 1000);
          const b = await page.evaluate(() => JSON.parse(JSON.stringify(window.__bench || {}))).catch((e) => ({ errors: ['eval: ' + e.message] }));
          const m = await page.metrics(); const gpu = gpuFootprintMB(bpid);
          const label = `${name}_${r}_csp-${csp}`; await page.screenshot({ path: path.join(OUT, label + '.png') }).catch(() => {});
          const row = { name, renderer: r, csp, ok, count: b.count, loadMs: b.loadMs, decodeMs: b.decodeMs, readyMs: b.readyMs, spzBytes: b.spzBytes, backend: b.gpu,
            fpsMedian: median(b.fps || []), syncMs: b.syncMs, syncMsNoSplats: syncBase, frameMsP95: p95(b.frameMs || []), jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), gpuProcessMB: gpu, gpuBaseMB: gpu0,
            gpuDeltaMB: gpu != null && gpu0 != null ? +(gpu - gpu0).toFixed(1) : null, errors: [...new Set([...(b.errors || []), ...logs])].slice(0, 12), wallMs: Date.now() - t };
          results.push(row); console.log('[bench]', label, JSON.stringify({ ok: row.ok, n: row.count, fps: row.fpsMedian, p95: row.frameMsP95, sync: row.syncMs, sync0: row.syncMsNoSplats, heap: row.jsHeapMB, gpuDelta: row.gpuDeltaMB, load: row.loadMs, decode: row.decodeMs, err: row.errors }));
        } finally { await browser.close(); }
      }
    } finally { srv.close(); }
  }
} finally { release(); }
fs.writeFileSync(path.join(OUT, 'bench.json'), JSON.stringify({ date: new Date().toISOString(), size: [VW, VH], vsync: !opt('unlimited'), machine: load, results }, null, 1));
console.log('[bench] →', path.relative(ROOT, path.join(OUT, 'bench.json')));
