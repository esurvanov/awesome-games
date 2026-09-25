// Телефон: iPhone 13 / Pixel 7, портрет и ландшафт (hasTouch, isMobile).
// Проверки: джойстик не отдаёт приказов, режим приказов 👥, щипок (CDP Input.dispatchTouchEvent),
// панели/диалоги в экране, кнопки ≥ 44 px, нажимаемое не перекрывается. Скриншоты — tests/shots/m-*.png
const { chromium, devices } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const OUT = path.join(__dirname, 'shots') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
const TIPS_SEEN = '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}';

// все видимые нажимаемые элементы: размеры и пересечения
const AUDIT = () => {
  const sel = 'button, #minimap, .stick, input[type=range]';
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return null; for (let e = el; e; e = e.parentElement) if (e.hidden) return null; return r; };
  const name = el => el.id ? '#' + el.id : (el.className ? '.' + String(el.className).split(' ')[0] : el.tagName) + (el.dataset.cmd ? '[' + el.dataset.cmd + ']' : el.dataset.tab ? '[' + el.dataset.tab + ']' : '') + ':' + (el.textContent || '').trim().slice(0, 6);
  const reach = x => { const t = document.elementFromPoint((x.r.left + x.r.right) / 2, (x.r.top + x.r.bottom) / 2); return !!t && (t === x.el || x.el.contains(t) || (t.closest && t.closest('.stickzone') && x.el.classList.contains('stick'))); };
  const els = [...document.querySelectorAll(sel)].map(el => ({ el, r: vis(el) })).filter(x => x.r);
  const small = els.filter(x => x.r.width < 43.5 || x.r.height < 43.5).map(x => `${name(x.el)} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`);
  const out = els.filter(x => x.r.left < -1 || x.r.top < -1 || x.r.right > innerWidth + 1 || x.r.bottom > innerHeight + 1).map(x => name(x.el));
  const over = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    // спорно, только если оба доступны пальцу (центр каждого — он сам); спрятанное под окном не в счёт
    if (w > 4 && h > 4 && reach(a) && reach(b)) over.push(`${name(a.el)} ✕ ${name(b.el)}`);
  }
  return { n: els.length, small, out, over };
};
const FITS = id => { const el = document.getElementById(id); if (!el || el.hidden) return 'hidden'; const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 ? 'ok' : `out ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} vs ${innerWidth}×${innerHeight}`; };

async function run(dev, land) {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const d = devices[dev], vp = land ? { width: d.viewport.height, height: d.viewport.width } : d.viewport;
  const ctx = await b.newContext({ ...d, viewport: vp });
  const pg = await ctx.newPage();
  const errs = [], log = [], fail = [];
  const ok = (cond, what) => { log.push((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) fail.push(what); };
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(500);
  await pg.evaluate(t => { localStorage.clear(); localStorage.setItem('sibir-tips', t); }, TIPS_SEEN);
  await pg.reload(); await pg.waitForTimeout(500);
  const tag = dev.replace(/ /g, '') + (land ? '-land' : '-port');
  const menuA = await pg.evaluate(AUDIT);
  ok(!menuA.small.length && !menuA.over.length, `меню: мелкие ${menuA.small.join(', ') || '—'} · перекрытия ${menuA.over.join(', ') || '—'}`);
  await pg.tap('#start'); await pg.waitForTimeout(3700);
  // посёлок днём рядом с героем
  await pg.evaluate(() => {
    G.s.hp = 1e9; G.time = tAt(2, 11); G.day = 2; G.col.ep = 1;
    G.p.x = HUT.x + 40; G.p.y = HUT.y + 240;
    for (const [t, dx, dy] of [['bich', -90, 40], ['bich', -40, 70], ['bich', 30, 90], ['evenk', 100, 30], ['laika', 130, 80]]) Colony.spawn(t, { x: G.p.x + dx, y: G.p.y + dy });
    G.col.builds.push({ id: G.col.nextId++, type: 'balok', x: HUT.x - 250, y: HUT.y + 200, prog: 1, done: 1 });
    for (let i = 0; i < 30; i++) update(0.05);
  });
  await pg.waitForTimeout(600);
  const scr = (x, y) => pg.evaluate(([x, y]) => ({ x: (x - cam.x) * GFX.zoom, y: (y - cam.y) * GFX.zoom }), [x, y]);

  // 1. тап в зоне джойстика при выделенных людях — приказа нет
  const r1 = await pg.evaluate(() => { const u = G.col.units.find(u => u.type === 'bich'); G.col.sel = [u.id]; u.task = { k: 'idle' }; return u.id; });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => UI.setOrder(false));
  const zb = await pg.locator('#stickzone').boundingBox();
  await pg.touchscreen.tap(zb.x + 40, zb.y + zb.height - 40);
  await pg.waitForTimeout(150);
  const t1 = await pg.evaluate(id => G.col.units.find(u => u.id === id).task.k, r1);
  ok(t1 === 'idle', `тап в зоне джойстика не даёт приказ (задача: ${t1})`);

  // 2. режим приказов: тап по человеку → выделен и режим включён; тап по снегу → идти
  await pg.evaluate(() => { for (let i = 0; i < 4 && (UI.modal() || document.querySelector('.tip:not([hidden])')); i++) { UI.closePanel(); } G.col.sel = []; UI.setOrder(false); G.time = tAt(G.day, 11); });
  await pg.waitForTimeout(150);
  const u2 = await pg.evaluate(() => { const u = G.col.units.find(u => u.type === 'bich'); u.task = { k: 'idle' }; u.idleT = -999; u.hidden = false; u.x = G.p.x + 70; u.y = G.p.y + 10; return { id: u.id, x: u.x, y: u.y - 14 }; });
  const s2 = await scr(u2.x, u2.y);
  const at2 = await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.id || e.className; }, [s2.x, s2.y]);
  await pg.touchscreen.tap(s2.x, s2.y);
  await pg.waitForTimeout(250);
  const st2 = await pg.evaluate(() => ({ sel: G.col.sel.slice(), om: UI.orderMode }));
  ok(st2.sel.includes(u2.id) && st2.om, `тап по бичу → выделен, режим приказов ${st2.om ? 'вкл' : 'выкл'} (под пальцем ${at2}, sel ${st2.sel})`);
  // тап по земле в зоне, где раньше был джойстик (теперь режим приказов — вся площадь для тапов)
  const gx = zb.x + zb.width * 0.5, gy = zb.y + zb.height * 0.45;
  await pg.evaluate(() => { window.__ev = []; for (const t of ['pointerdown', 'pointerup']) addEventListener(t, e => __ev.push(t + ':' + (e.target.id || e.target.className)), true); });
  await pg.touchscreen.tap(gx, gy);
  await pg.waitForTimeout(200);
  const t2 = await pg.evaluate(id => G.col.units.find(u => u.id === id).task.k + ' ' + __ev.join(',') + ' sel ' + G.col.sel + ' om ' + UI.orderMode + ' cmdbar ' + JSON.stringify(document.getElementById('cmdbar').getBoundingClientRect()), u2.id);
  ok(!t2.startsWith('idle'), `в режиме приказов тап по месту → приказ (${t2}) at ${gx|0},${gy|0}`);
  await pg.screenshot({ path: OUT + `m-${tag}-orders.png` });
  const aOrd = await pg.evaluate(AUDIT);
  ok(!aOrd.small.length, `игра/приказы: кнопки ≥44: ${aOrd.small.join(', ') || 'все'}`);
  ok(!aOrd.over.length, `игра/приказы: перекрытия: ${aOrd.over.join(', ') || 'нет'}`);
  ok(!aOrd.out.length, `игра/приказы: за экраном: ${aOrd.out.join(', ') || 'нет'}`);

  // 3. стрелка к выделенным за экраном + «к выделенным»
  await pg.evaluate(() => { const u = G.col.units.find(u => u.type === 'evenk'); u.x = G.p.x + 1400; u.y = G.p.y - 300; u.task = { k: 'idle' }; G.col.sel = [u.id]; });
  await pg.waitForTimeout(400);
  const arrows = await pg.locator('#offsel .offa').count();
  ok(arrows === 1, `стрелка к выделенному за экраном: ${arrows}`);
  if (arrows) { await pg.locator('#offsel .offa').first().tap(); await pg.waitForTimeout(900); }
  const vis3 = await pg.evaluate(() => { const u = Colony.selected()[0]; const x = (u.x - cam.x) * GFX.zoom, y = (u.y - 14 - cam.y) * GFX.zoom; return x > 0 && y > 0 && x < innerWidth && y < innerHeight; });
  ok(vis3, 'тап по стрелке — камера к выделенному');
  await pg.evaluate(() => { GFX.recenter(); GFX.setZoom(1); G.col.sel = []; UI.setOrder(false); });
  await pg.waitForTimeout(700);

  // 4. щипок двумя пальцами (CDP) в правой верхней части мира
  const cdp = await ctx.newCDPSession(pg);
  const z0 = await pg.evaluate(() => GFX.zoom);
  const cx0 = vp.width * 0.68, cy0 = vp.height * 0.3;
  const pts = k => [{ x: cx0, y: cy0 - 20 - k, id: 1 }, { x: cx0, y: cy0 + 20 + k, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
  for (let k = 10; k <= 80; k += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(k) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pg.waitForTimeout(200);
  const z1 = await pg.evaluate(() => GFX.zoom);
  ok(z1 > z0 * 1.3, `щипок: зум ${z0.toFixed(2)} → ${z1.toFixed(2)}`);
  const sel4 = await pg.evaluate(() => G.col.sel.length);
  ok(sel4 === 0, 'щипок не выделяет и не приказывает');
  await pg.evaluate(() => { GFX.setZoom(1); GFX.recenter(); });

  // 5. панели и диалоги помещаются
  for (const tab of ['craft', 'build', 'people', 'epoch']) {
    await pg.evaluate(t => UI.openCraft(t), tab); await pg.waitForTimeout(150);
    ok((await pg.evaluate(FITS, 'panel')) === 'ok', `панель ${tab} в экране: ${await pg.evaluate(FITS, 'panel')}`);
    if (tab === 'build') {
      await pg.screenshot({ path: OUT + `m-${tag}-panel.png` });
      const a = await pg.evaluate(AUDIT);
      ok(!a.small.length, `панель: кнопки ≥44: ${a.small.join(', ') || 'все'}`);
      ok(!a.over.length, `панель: перекрытия: ${a.over.join(', ') || 'нет'}`);
    }
  }
  await pg.evaluate(() => document.getElementById('panel-close').click());
  await pg.evaluate(() => UI.dialog(DIALOG.urk_meet)); await pg.waitForTimeout(2500);
  await pg.evaluate(() => { const b = document.getElementById('dialog'); b.click(); });
  await pg.waitForTimeout(200);
  ok((await pg.evaluate(FITS, 'dialog')) === 'ok', `диалог в экране: ${await pg.evaluate(FITS, 'dialog')}`);
  const aD = await pg.evaluate(AUDIT);
  ok(!aD.small.length, `диалог: кнопки ≥44: ${aD.small.join(', ') || 'все'}`);
  ok(!aD.over.length, `диалог: перекрытия: ${aD.over.join(', ') || 'нет'}`);
  await pg.screenshot({ path: OUT + `m-${tag}-dialog.png` });
  await pg.evaluate(() => { document.getElementById('dialog').hidden = true; });
  await pg.evaluate(() => UI.dialog({ who: 'urk', t: 'x', opts: [{ t: 'Пока' }] })); await pg.waitForTimeout(100);
  await pg.evaluate(() => document.querySelector('.opt') && document.querySelector('.opt').click());

  // 6. пауза и ячейки сохранений
  await pg.tap('#pause-btn'); await pg.waitForTimeout(200);
  const aP = await pg.evaluate(AUDIT);
  ok(!aP.small.length, `пауза: кнопки ≥44: ${aP.small.join(', ') || 'все'}`);
  ok(!aP.over.length, `пауза: перекрытия: ${aP.over.join(', ') || 'нет'}`);
  await pg.tap('#p-save'); await pg.waitForTimeout(200);
  ok((await pg.evaluate(() => { const c = document.querySelector('#slots .card').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight + 1; })), 'ячейки сохранений в экране');
  await pg.screenshot({ path: OUT + `m-${tag}-slots.png` });
  await pg.tap('#sl-back'); await pg.tap('#resume');

  await b.close();
  ok(!errs.length, 'ошибок страницы нет ' + errs.slice(0, 3).join(' | '));
  return { tag, log, fail };
}

(async () => {
  let bad = 0;
  const only = process.env.DEV; // например DEV=Pixel
  for (const [dev, land] of [['iPhone 13', false], ['iPhone 13', true], ['Pixel 7', false], ['Pixel 7', true]]) {
    if (only && !dev.includes(only)) continue;
    const r = await run(dev, land);
    console.log(`— ${r.tag}\n  ` + r.log.join('\n  '));
    bad += r.fail.length;
  }
  console.log(bad ? `ERR mobile: ${bad} проверок не прошло` : 'mobile: все проверки прошли');
  process.exitCode = bad ? 1 : 0;
})();
