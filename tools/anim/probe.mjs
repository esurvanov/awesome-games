// node probe.mjs <base> <model> <anims> <clip> <bones csv> -> JSON world positions per 1/30 s
import puppeteer from 'puppeteer-core';
const [base, modelUrl, animUrl, clip, bones, height = '1.8'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-webgl'] });
const page = await browser.newPage(); await page.setCacheEnabled(false);
await page.goto(base + '/sheet.html'); await page.waitForFunction('window.ready');
await page.evaluate((u, h) => loadModel(u, +h), modelUrl, height); await page.evaluate((u) => loadAnims(u), animUrl);
console.log(JSON.stringify(await page.evaluate((c, b) => probe(c, b.split(',')), clip, bones)));
await browser.close();
