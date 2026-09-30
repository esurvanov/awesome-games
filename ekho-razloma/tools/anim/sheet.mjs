// node sheet.mjs <http base> <model pack url rel> <anim glb url rel> <outdir> [clip names csv|all] [frames] [yaw]
// renders one JPEG strip per clip (N evenly spaced frames) with three r186 headless; prints binding problems
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [base, modelUrl, animUrl, out, which = 'all', frames = '8', yaw = '35', height = '1.8', metaPath = ''] = process.argv.slice(2);
const META = metaPath ? JSON.parse(fs.readFileSync(metaPath, 'utf8')).clips : {};
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'], userDataDir: out + '/.chrome' });
const page = await browser.newPage(); await page.setCacheEnabled(false);
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(base + '/sheet.html'); await page.waitForFunction('window.ready', { timeout: 60000 });
await page.evaluate((u, h) => loadModel(u, +h), modelUrl, height);
const list = await page.evaluate((u) => loadAnims(u), animUrl);
if (process.env.BOX) await page.evaluate((b) => { window.BOX = JSON.parse(b); }, process.env.BOX);
if (process.env.CLOSE) await page.evaluate((b) => { window.CLOSE = JSON.parse(b); }, process.env.CLOSE);   // {"bone":"hand_l","dist":0.8}
if (process.env.SIZE) await page.evaluate((b) => { window.SIZE = JSON.parse(b); }, process.env.SIZE);
if (process.env.NOFOLLOW) await page.evaluate(() => { window.FOLLOW = false; });
const want = which === 'all' ? list.map((l) => l[0]) : which.split(',');
for (let [name, dur, ntr, ex] of list) {
  const mm = META[name]; if (mm) { ex = { contacts: mm.contacts }; if (mm.rootMotion) { const r = mm.rootMotion; ex.rootMotionPreview = []; for (let k = 0; k <= Math.round(dur * 30); k++) ex.rootMotionPreview.push(r.samples[Math.min(r.samples.length - 1, Math.round(k / 30 * r.fps))]);
    if (process.env.NORM) ex.rootMotionPreview = null; } }
  if (!want.includes(name)) continue;
  const miss = await page.evaluate((n) => missingTracks(n), name);
  const nf = frames === 'auto' ? Math.min(48, Math.ceil(dur) + 1) : +frames;
  const url = await page.evaluate((n, f, y, ex, d) => strip(n, f, y, ex, ex && ex.rootMotionPreview ? ex.rootMotionPreview : null, d), name, nf, +yaw, ex, +(process.env.DIST || 3.6));
  fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(name, dur.toFixed(2), 'tracks', ntr, miss.length ? 'MISSING ' + [...new Set(miss)].join(',') : 'ok');
}
await browser.close();
