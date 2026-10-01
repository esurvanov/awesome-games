// node tools/trees/shots.mjs <outdir> "<glb>?d=6&h=3&look=4&name=near" ...   screenshots of tools/trees/preview.html (own static server: .glb allowed)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent(q.url.split('?')[0]); const p = path.join(ROOT, u); if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
const [out, ...jobs] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1000, height: 760 } });
for (const j of jobs) {
  const [f, qs] = j.split('?'); const sp = new URLSearchParams(qs || ''); const name = sp.get('name') || path.basename(f, '.glb'); sp.set('glb', '/' + f); sp.delete('name');
  const pg = await b.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message)); pg.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
  await pg.goto(`http://127.0.0.1:${port}/tools/trees/preview.html?${sp}`); await pg.waitForFunction('window.__done', { timeout: 90000 }).catch(() => console.log('timeout', name));
  await pg.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 85 }); await pg.close(); console.log('shot', name);
}
await b.close(); srv.close();
