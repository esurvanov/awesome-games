// node tools/trees/bake_imp.mjs <name> <glb path under repo>   → assets/veg/imp/<name>_{albedo,normal,depth}.png + prints the IMP_META row
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent(q.url.split('?')[0]); const p = path.join(ROOT, u); if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
const [name, glb] = process.argv.slice(2); const outDir = path.join(ROOT, 'assets/veg/imp'); fs.mkdirSync(outDir, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1100, height: 1100 }, protocolTimeout: 600000 });
const pg = await b.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message)); pg.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await pg.goto(`http://127.0.0.1:${port}/tools/trees/bake.html`); await pg.waitForFunction('window.__ready', { timeout: 60000 });
const res = await pg.evaluate((u) => window.bake(u), '/' + glb);
for (const k of ['albedo', 'normal', 'depth']) fs.writeFileSync(path.join(outDir, `${name}_${k}.png`), Buffer.from(res.out[k].split(',')[1], 'base64'));
const M = res.meta; const row = `${name}: [[${M.center.map((x) => +x.toFixed(4)).join(', ')}], ${+M.radius.toFixed(4)}, ${+M.frameHalf.toFixed(4)}, ${+M.height.toFixed(4)}],`;
console.log(row); fs.appendFileSync(path.join(ROOT, 'tools/trees/out/imp_meta.txt'), row + '\n');
await b.close(); srv.close();
