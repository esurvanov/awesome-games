// Раскладка HUD без наложений (SPEC-ui §6, из docs/research/D6-overlap.js):
// 4 размера (360×780 тач, 1280×800, 1920×1080, 2560×1440) × масштаб интерфейса S/M/L × сцены HUD / диалог / панель
// (+ режим приказов на телефоне) → 0 пересечений блоков > 2 px и 0 блоков за краем экрана.
//   node ui-overlap.js            SZ=360 node ui-overlap.js — один размер
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const OUT = path.join(__dirname, 'shots') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
const ALL = [[360, 780, true], [1280, 800, false], [1920, 1080, false], [2560, 1440, false]];
const SIZES = ALL.filter(s => !process.env.SZ || String(s[0]) === process.env.SZ);
const TIPS = '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}';
// слоты: TL · цели (TC) · TR · BL · BC (подсказка, приказы, обучение) · BR · тосты · баннер · модальные окна · тач
const IDS = ['.tl', '#goals', '.tr', '.bl', '#prompt', '#cmdbar', '#tip', '.corner', '#toasts', '#zone', '#dialog', '#panel', '#note', '.tbtns'];

async function setup(pg) {
  await pg.evaluate(t => localStorage.setItem('sibir-tips', t), TIPS);
  await pg.evaluate(() => document.getElementById('start').click()); await pg.waitForTimeout(4200);
  await pg.evaluate(() => {
    Object.assign(G.inv, { wood: 12, meat: 3, fish: 2, hare: 2, scrap: 3, can: 1 });
    Object.assign(G.chest, { wood: 20, meat: 4, scrap: 6, wpelt: 1 });
    G.flags.quartz = 1; G.inv.quartz = 1; G.inv.battery = 1; G.charge = 45; G.hut.bench = 1; G.gear.boots = 1; G.s.hp = 1e9;
    G.col.ep = 1; G.col.rub = 120; G.time = tAt(2, 13); G.day = 2;
    G.p.x = HUT.x + 40; G.p.y = HUT.y + 240; GFX.recenter();
    for (const [t, dx, dy] of [['bich', -120, 40], ['bich', -60, 80], ['evenk', 120, 40]]) Colony.spawn(t, { x: G.p.x + dx, y: G.p.y + dy }).task = { k: 'idle' };
    for (let i = 0; i < 20; i++) update(0.05);
  });
  await pg.waitForTimeout(400);
}
async function rects(pg) {
  return pg.evaluate(ids => {
    const r = {};
    for (const s of ids) {
      const e = document.querySelector(s); if (!e) continue;
      let hid = false; for (let x = e; x; x = x.parentElement) if (x.hidden) hid = true; if (hid) continue;
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = e.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
      r[s] = [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
    }
    return { r, W: innerWidth, H: innerHeight };
  }, IDS);
}
function overlaps({ r, W, H }) {
  const k = Object.keys(r), out = [];
  for (let i = 0; i < k.length; i++) {
    const a = r[k[i]];
    if (a[0] < -1 || a[1] < -1 || a[2] > W + 1 || a[3] > H + 1) out.push(`${k[i]} за краем [${a}]`);
    for (let j = i + 1; j < k.length; j++) {
      const b = r[k[j]];
      const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (ix > 2 && iy > 2) out.push(`${k[i]} × ${k[j]} (${ix}×${iy})`);
    }
  }
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const bad = [], log = [], errs = [];
  try {
    for (const [w, h, touch] of SIZES) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
      const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
      await pg.route(/^https?:/, r => r.abort());
      await pg.goto(URL); await pg.waitForTimeout(800);
      const tag = `${w}x${h}`;
      await setup(pg);
      const check = async (name, shot) => {
        await pg.evaluate(() => UI.layout()); await pg.waitForTimeout(80);
        const o = overlaps(await rects(pg));
        log.push(`${o.length ? 'FAIL' : 'ok  '} ${tag} ${name}${o.length ? ': ' + o.join(', ') : ''}`);
        if (o.length) bad.push(`${tag} ${name}`);
        if (shot) await pg.screenshot({ path: `${OUT}overlap-${tag}-${shot}.png` });
      };
      for (const ui of [0.85, 1, 1.2]) {
        await pg.evaluate(u => Settings.set('ui', u), ui); await pg.waitForTimeout(200);
        // HUD + приказы + подсказка + тост + баннер зоны сразу
        await pg.evaluate(() => {
          G.col.sel = G.col.units.filter(u => !u.pet).map(u => u.id); UI.toast(':wood: +3 дрова'); UI.zone(POI.hut);
          const el = document.getElementById('tip'); document.getElementById('tip-i').innerHTML = ic('fire'); document.getElementById('tip-t').innerHTML = icx('F — костёр из :wood:3, греет'); el.hidden = false;
          for (let i = 0; i < 4; i++) update(0.05);
        });
        await pg.waitForTimeout(350);
        await check(`ui${ui} HUD`, ui === 1 ? 'hud' : '');
        await pg.evaluate(() => { G.col.sel = []; document.getElementById('tip').hidden = true; });
        await pg.evaluate(() => UI.dialog(DIALOG.urk_meet)); await pg.waitForTimeout(200);
        await pg.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('dialog').click(); });
        await pg.waitForTimeout(200);
        await check(`ui${ui} диалог`, ui === 1 ? 'dialog' : '');
        await pg.keyboard.press('Escape');
        await pg.evaluate(() => { UI.toast(':scrap: +1 железо'); UI.openCraft('craft'); }); await pg.waitForTimeout(250);
        await check(`ui${ui} панель`, ui === 1 ? 'panel' : '');
        await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
        if (touch) {
          await pg.evaluate(() => { G.col.sel = G.col.units.filter(u => !u.pet).map(u => u.id); UI.setOrder(true); }); await pg.waitForTimeout(300);
          await check(`ui${ui} режим приказов`, ui === 1 ? 'orders' : '');
          await pg.evaluate(() => { G.col.sel = []; UI.setOrder(false); });
        }
      }
      await pg.evaluate(() => Settings.set('ui', 1));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(log.join('\n'));
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
  console.log(bad.length ? `ERR overlap: ${bad.length} сцен с наложениями` : `overlap: 0 наложений (${log.length} сцен)`);
  process.exitCode = bad.length || errs.length ? 1 : 0;
})();
