#!/usr/bin/env node
/* probe.mjs — open one build (commit worktree dir or '.') with the compare setup and evaluate an expression after a new game.
 *   node tools/compare/probe.mjs <dir> "<async js expression>"   (takes the benchmark lock) */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { acquireLock } from '../qa/hygiene.mjs';
const root = path.resolve(process.argv[2] || '.'), expr = process.argv[3] || '1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0].split('#')[0])); const m = MIME[path.extname(p)]; if (!m || !fs.existsSync(p)) { r.writeHead(404).end(); return; } r.writeHead(200, { 'Content-Type': m }); fs.createReadStream(p).pipe(r); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const release = await acquireLock('compare-probe');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1512, height: 860 } });
try {
  const pg = await b.newPage();
  await pg.goto(`http://127.0.0.1:${srv.address().port}/open-world.html#dbg`);
  await pg.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 180000 });
  await pg.evaluate(() => DBG.newGame()); await new Promise((r) => setTimeout(r, 1500));
  await pg.evaluate(() => { DBG.Dialog.active = false; document.getElementById('dialog').hidden = true; });
  await pg.evaluate(fs.readFileSync(new URL('./cmp-page.js', import.meta.url), 'utf8'));
  console.log(JSON.stringify(await pg.evaluate(`(async () => (${expr}))()`), null, 1));
} finally { await b.close(); srv.close(); release(); }
