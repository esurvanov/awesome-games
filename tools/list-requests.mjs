import http from 'http'; import fs from 'fs'; import path from 'path'; import puppeteer from 'puppeteer-core';
const ROOT = path.resolve('..'); const hits = new Set(); const miss = new Set();
const CT = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0].split('#')[0]); const f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { miss.add(u); r.writeHead(404); return r.end(); } hits.add(u.slice(1)); r.writeHead(200, { 'Content-Type': CT[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(8795);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage(); await p.setViewport({ width: 1200, height: 700 });
await p.goto('http://localhost:8795/open-world.html#dbg');
await p.waitForFunction(() => document.getElementById('loader').hidden, { timeout: 120000 });
await p.evaluate(() => DBG.newGame()); await new Promise((r) => setTimeout(r, 4000));
for (const [x, z] of [[180, 105], [0, -40], [35, -285], [-272, -85], [292, -110], [-185, 55], [-20, 200]]) { await p.evaluate((x, z) => DBG.teleport(x, z, 0), x, z); await new Promise((r) => setTimeout(r, 1500)); }
fs.writeFileSync('requested.json', JSON.stringify([...hits].sort(), null, 1));
console.log('hits', hits.size, 'miss', [...miss]);
await b.close(); srv.close(); process.exit(0);
