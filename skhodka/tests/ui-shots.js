// Скриншоты интерфейса со стенда dev/ui.html: все экраны на 1280×800 и 390×844 → docs/screenshots/ui-*.png. node ui-shots.js
import { chromium } from 'playwright';
import { serve } from './serve.js';
import fs from 'node:fs';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true });
const errs = [];
const SIZES = [['d', 1280, 800], ['m', 390, 844]];
const only = process.env.ONLY;
for (const [tag, W, H] of SIZES) {
  const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: tag === 'm' ? 2 : 1, hasTouch: tag === 'm' });
  pg.on('pageerror', e => errs.push(`${tag} PAGEERR ${e.message}\n${e.stack}`));
  pg.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/deprecated|build\/three|GPU stall|GroupMarkerNotSet|software WebGL/i.test(m.text())) errs.push(`${tag} ${m.type()} ${m.text()}`); });
  const open = async (s, extra = '') => { await pg.goto(`${url}dev/ui.html?shot=1&s=${s}${extra}`); await pg.waitForTimeout(350); };
  const shot = async n => { if (only && !n.includes(only)) return; await pg.screenshot({ path: `${OUT}ui-${n}-${tag}.png` }); console.log('shot', n, tag); };
  // заставка → анкета (4 шага) → чат
  await open('title'); await shot('01-title');
  await pg.click('[data-go]'); await pg.waitForTimeout(150);
  await pg.fill('#pf-name', 'Егор'); await pg.click('[data-k="glasses"][data-v="true"]'); await shot('02-whois-1');
  await pg.click('[data-next]'); await pg.click('[data-role="devops"]'); await shot('03-whois-2');
  await pg.click('[data-next]'); for (const t of ['sea', 'hike', 'wine']) await pg.click(`[data-topic="${t}"]`); await shot('04-whois-3');
  await pg.click('[data-next]'); await pg.click('[data-need="flat"]'); await pg.click('[data-offer="advice"]'); await shot('05-whois-4');
  await pg.click('[data-next]'); await pg.waitForTimeout(150);
  await pg.click('.poll-o[data-v="yes"]'); await shot('06-prechat');
  await open('hud'); await shot('07-hud');
  await open('talk'); await shot('08-talk');
  if (tag === 'm') { await open('talkcard'); await shot('09-talk-card'); }
  await open('intro'); await shot('10-introduce');
  await open('phone'); await shot('11-phone-chat');
  await open('contacts'); await shot('12-phone-contacts');
  await open('legends'); await shot('13-phone-legends');
  await open('pause'); await shot('14-pause');
  await open('end', '&photo=1'); await shot('15-end');
  // проверка: нет горизонтальной прокрутки и элементы не вылезают за экран
  for (const s of ['title', 'talk', 'phone', 'end', 'hud']) {
    await open(s);
    const bad = await pg.evaluate(() => {
      const out = []; const W = innerWidth;
      for (const el of document.querySelectorAll('#ui *')) {
        if (!el.offsetParent || el.closest('.tags')) continue;
        const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) out.push(el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      }
      return out.slice(0, 5);
    });
    if (bad.length) errs.push(`${tag} overflow ${s}: ${bad.join(' | ')}`);
  }
  await pg.close();
}
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close(); srv.close();
