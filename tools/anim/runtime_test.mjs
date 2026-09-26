// node runtime_test.mjs <base url> <outdir> : runs web/runtime_test.html (served next to the packs + animlib-runtime.js)
import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
const [base, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-webgl'] });
const page = await browser.newPage(); await page.setCacheEnabled(false);
page.on('pageerror', (e) => console.log('pageerror', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto(base + '/runtime_test.html'); await page.waitForFunction('window.ready', { timeout: 60000 });
const p = await page.evaluate(() => runPilot()); console.log(JSON.stringify(p.out, null, 1));
p.imgs.forEach((u, i) => fs.writeFileSync(`${out}/pilot_${i}.jpg`, Buffer.from(u.split(',')[1], 'base64')));
const s = await page.evaluate(() => runStag()); console.log(JSON.stringify(s.res, null, 1));
s.imgs.forEach((u, i) => fs.writeFileSync(`${out}/stag_${i}.jpg`, Buffer.from(u.split(',')[1], 'base64')));
await browser.close();
