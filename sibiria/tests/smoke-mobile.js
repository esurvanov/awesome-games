// Телефон: iPhone 13 / Pixel 7, портрет и ландшафт (hasTouch, isMobile).
// Проверки: джойстик не отдаёт приказов, режим приказов 👥, щипок (CDP Input.dispatchTouchEvent),
// панели/диалоги в экране, кнопки ≥ 44 px, нажимаемое не перекрывается. Скриншоты — tests/shots/m-*.png
const { chromium, devices } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const W = require('./_wait'); // ожидание условий/кадров вместо пауз, заморозка мира, пачки CDP-касаний
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

// один браузер на устройство; закрывается в finally; «браузер отключился» без нашего close — убит снаружи
async function run(dev, land) {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  let closing = false; b.on('disconnected', () => { if (!closing) console.log('ERR браузер отключился извне'); });
  try { return await body(b, dev, land); }
  catch (e) { return { tag: dev.replace(/ /g, '') + (land ? '-land' : '-port'), log: ['FAIL исключение: ' + (e && e.stack || e)], fail: ['исключение'] }; }
  finally { closing = true; await b.close().catch(() => {}); }
}

async function body(b, dev, land) {
  const d = devices[dev], vp = land ? { width: d.viewport.height, height: d.viewport.width } : d.viewport;
  const ctx = await b.newContext({ ...d, viewport: vp });
  const pg = await ctx.newPage();
  await W.prepare(pg);
  const errs = [], log = [], fail = [];
  const ok = (cond, what) => { log.push((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) fail.push(what); };
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message)); pg.on('crash', () => errs.push('PAGEERR страница упала (crash)'));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.goto(URL); await pg.waitForFunction(() => state === 'menu');
  await pg.evaluate(t => { localStorage.clear(); localStorage.setItem('sibir-tips', t); }, TIPS_SEEN);
  await pg.reload(); await pg.waitForFunction(() => state === 'menu' && !!window.__T); await W.frames(pg, 2);
  const tag = dev.replace(/ /g, '') + (land ? '-land' : '-port');
  const menuA = await pg.evaluate(AUDIT);
  ok(!menuA.small.length && !menuA.over.length, `меню: мелкие ${menuA.small.join(', ') || '—'} · перекрытия ${menuA.over.join(', ') || '—'}`);
  await pg.tap('#start'); await pg.waitForFunction(() => state === 'play');
  await W.freeze(pg); // карточка главы/реплики закрыты; сюжет, угрозы, погода, NPC, люди, подсказки стоят; seed
  // посёлок днём рядом с героем
  await pg.evaluate(() => {
    G.s.hp = 1e9; G.day = 2; G.time = tAt(2, 11); G.col.ep = 1;
    G.p.x = HUT.x + 40; G.p.y = HUT.y + 240;
    for (const [t, dx, dy] of [['bich', -90, 40], ['bich', -40, 70], ['bich', 30, 90], ['evenk', 100, 30], ['laika', 130, 80]]) Colony.spawn(t, { x: G.p.x + dx, y: G.p.y + dy });
    G.col.builds.push({ id: G.col.nextId++, type: 'balok', x: HUT.x - 250, y: HUT.y + 200, prog: 1, done: 1 });
    for (let i = 0; i < 30; i++) update(0.05);
  });
  await W.snapCam(pg); await W.settleUI(pg);
  const scr = (x, y) => pg.evaluate(([x, y]) => ({ x: (x - cam.x) * GFX.zoom, y: (y - cam.y) * GFX.zoom }), [x, y]);

  // 1. тап в зоне джойстика при выделенных людях — приказа нет
  const r1 = await pg.evaluate(() => { const u = G.col.units.find(u => u.type === 'bich'); G.col.sel = [u.id]; u.task = { k: 'idle' }; return u.id; });
  await W.frames(pg, 2); // кадр с выделением (игра сама включает режим приказов) — затем выключаем
  await pg.evaluate(() => UI.setOrder(false)); await W.settleUI(pg);
  const zb = await pg.locator('#stickzone').boundingBox();
  await W.input(pg, 1, () => pg.touchscreen.tap(zb.x + 40, zb.y + zb.height - 40));
  const t1 = await pg.evaluate(id => G.col.units.find(u => u.id === id).task.k, r1);
  ok(t1 === 'idle', `тап в зоне джойстика не даёт приказ (задача: ${t1})`);

  // 2. режим приказов: тап по человеку → выделен и режим включён; тап по снегу → идти
  await pg.evaluate(() => { G.col.sel = []; UI.setOrder(false); });
  await W.closeModals(pg);
  await W.snapCam(pg); await W.settleUI(pg); // HUD после снятия выделения перестроился — точка под пальцем окончательная
  // бич — туда, где под пальцем именно он: открытый мир (±30 px без HUD/джойстика) и никто другой в зоне касания
  const u2 = await pg.evaluate(() => {
    const u = G.col.units.find(u => u.type === 'bich'); u.task = { k: 'idle' }; u.idleT = -999; u.hidden = false;
    const free = (x, y) => { for (const dx of [-30, 0, 30]) for (const dy of [-30, 0, 30]) { const e = document.elementFromPoint(x + dx, y + dy); if (!e || e.id !== 'game') return false; } return true; };
    for (const [dx, dy] of [[70, 10], [-70, 10], [70, -50], [-70, -50], [140, -20], [-140, -20], [0, -90], [160, 40], [-160, 40]]) {
      u.x = G.p.x + dx; u.y = G.p.y + dy; const s = GFX.worldToScreen(u.x, u.y - 14);
      if (s.x < 20 || s.y < 20 || s.x > innerWidth - 20 || s.y > innerHeight - 20 || !free(s.x, s.y)) continue;
      const t = Input.pick(s.x, s.y, true); if (t.o === u) return { id: u.id, sx: s.x, sy: s.y };
    }
    u.x = G.p.x + 70; u.y = G.p.y + 10; const s = GFX.worldToScreen(u.x, u.y - 14); return { id: u.id, sx: s.x, sy: s.y };
  });
  const s2 = { x: u2.sx, y: u2.sy };
  const at2 = await W.hit(pg, s2.x, s2.y) + ' · pick ' + await pg.evaluate(([x, y]) => { const t = Input.pick(x, y, true); return t.k + (t.o && t.o.id != null ? '#' + t.o.id : ''); }, [s2.x, s2.y]) + ' · cam−цель ' + await pg.evaluate(() => (cam.x - (G.p.x - GFX.vw / 2)).toFixed(2) + ',' + (cam.y - (G.p.y - 20 - GFX.vh / 2)).toFixed(2));
  await W.input(pg, 1, () => pg.touchscreen.tap(s2.x, s2.y));
  await W.until(pg, id => G.col.sel.includes(id) && UI.orderMode, u2.id, { timeout: 3000 });
  const st2 = await pg.evaluate(() => ({ sel: G.col.sel.slice(), om: UI.orderMode }));
  ok(st2.sel.includes(u2.id) && st2.om, `тап по бичу → выделен, режим приказов ${st2.om ? 'вкл' : 'выкл'} (под пальцем ${at2}, бич #${u2.id}, sel ${st2.sel})`);
  // тап по земле в зоне, где раньше был джойстик (теперь режим приказов — вся площадь для тапов)
  await W.settleUI(pg); // режим приказов включён → раскладка (джойстик убран, панель команд) перестроилась
  const gx = zb.x + zb.width * 0.5, gy = zb.y + zb.height * 0.45;
  await W.input(pg, 1, () => pg.touchscreen.tap(gx, gy));
  await W.until(pg, id => G.col.units.find(u => u.id === id).task.k !== 'idle', u2.id, { timeout: 3000 });
  let t2 = await pg.evaluate(id => G.col.units.find(u => u.id === id).task.k + ' sel ' + G.col.sel + ' om ' + UI.orderMode, u2.id);
  if (t2.startsWith('idle')) t2 += ' · ' + await W.diag(pg);
  ok(!t2.startsWith('idle'), `в режиме приказов тап по месту → приказ (${t2}) at ${gx|0},${gy|0}`);
  await pg.screenshot({ path: OUT + `m-${tag}-orders.png` });
  const aOrd = await pg.evaluate(AUDIT);
  ok(!aOrd.small.length, `игра/приказы: кнопки ≥44: ${aOrd.small.join(', ') || 'все'}`);
  ok(!aOrd.over.length, `игра/приказы: перекрытия: ${aOrd.over.join(', ') || 'нет'}`);
  ok(!aOrd.out.length, `игра/приказы: за экраном: ${aOrd.out.join(', ') || 'нет'}`);

  // 3. стрелка к выделенным за экраном + «к выделенным»
  await pg.evaluate(() => { const u = G.col.units.find(u => u.type === 'evenk'); u.x = G.p.x + 1400; u.y = G.p.y - 300; u.task = { k: 'idle' }; G.col.sel = [u.id]; });
  await W.until(pg, () => document.querySelectorAll('#offsel .offa').length === 1, null, { timeout: 5000 }); // стрелки рисует HUD раз в 0.08 с игры
  const arrows = await pg.locator('#offsel .offa').count();
  ok(arrows === 1, `стрелка к выделенному за экраном: ${arrows}`);
  const VIS3 = () => { const u = Colony.selected()[0]; const x = (u.x - cam.x) * GFX.zoom, y = (u.y - 14 - cam.y) * GFX.zoom; return x > 0 && y > 0 && x < innerWidth && y < innerHeight; };
  if (arrows) await W.input(pg, 1, () => pg.locator('#offsel .offa').first().tap());
  const vis3 = await W.until(pg, VIS3, null, { timeout: 8000 }); // камера доезжает за игровое время — ждём, пока доедет
  ok(vis3, 'тап по стрелке — камера к выделенному');
  await pg.evaluate(() => { GFX.setZoom(1); G.col.sel = []; UI.setOrder(false); });
  await W.snapCam(pg); await W.settleUI(pg);

  // 4. щипок двумя пальцами (CDP) в правой верхней части мира
  const cdp = await ctx.newCDPSession(pg);
  const z0 = await pg.evaluate(() => GFX.zoom);
  const cx0 = vp.width * 0.68, cy0 = vp.height * 0.3;
  const pts = k => [{ x: cx0, y: cy0 - 20 - k, id: 1 }, { x: cx0, y: cy0 + 20 + k, id: 2 }];
  const pm = [{ type: 'touchStart', touchPoints: pts(0) }];
  for (let k = 10; k <= 80; k += 10) pm.push({ type: 'touchMove', touchPoints: pts(k) });
  await W.input(pg, 2, () => W.touchBurst(cdp, [...pm, { type: 'touchEnd', touchPoints: [] }]));
  const z1 = (await W.until(pg, z => GFX.zoom > z * 1.3 && GFX.zoom, z0)) || await pg.evaluate(() => GFX.zoom);
  ok(z1 > z0 * 1.3, `щипок: зум ${z0.toFixed(2)} → ${z1.toFixed(2)}`);
  const sel4 = await pg.evaluate(() => G.col.sel.length);
  ok(sel4 === 0, 'щипок не выделяет и не приказывает');
  await pg.evaluate(() => { GFX.setZoom(1); GFX.recenter(); });

  // 5. панели и диалоги помещаются
  for (const tab of ['craft', 'build', 'people', 'epoch']) {
    await pg.evaluate(t => UI.openCraft(t), tab); await W.frames(pg, 2); // раскладка панели — в кадре
    ok((await pg.evaluate(FITS, 'panel')) === 'ok', `панель ${tab} в экране: ${await pg.evaluate(FITS, 'panel')}`);
    if (tab === 'build') {
      await pg.screenshot({ path: OUT + `m-${tag}-panel.png` });
      const a = await pg.evaluate(AUDIT);
      ok(!a.small.length, `панель: кнопки ≥44: ${a.small.join(', ') || 'все'}`);
      ok(!a.over.length, `панель: перекрытия: ${a.over.join(', ') || 'нет'}`);
    }
  }
  await pg.evaluate(() => document.getElementById('panel-close').click());
  await pg.evaluate(() => UI.dialog(DIALOG.urk_meet)); await W.frames(pg, 2);
  // текст печатается по кадрам (45 зн/с игры): клик по окну допечатывает — дальше ждём сами варианты ответа
  await pg.evaluate(() => { const b = document.getElementById('dialog'); b.click(); });
  await W.until(pg, () => !!document.querySelector('#dlg-opts .opt')); await W.frames(pg, 2);
  ok((await pg.evaluate(FITS, 'dialog')) === 'ok', `диалог в экране: ${await pg.evaluate(FITS, 'dialog')}`);
  const aD = await pg.evaluate(AUDIT);
  ok(!aD.small.length, `диалог: кнопки ≥44: ${aD.small.join(', ') || 'все'}`);
  ok(!aD.over.length, `диалог: перекрытия: ${aD.over.join(', ') || 'нет'}`);
  await pg.screenshot({ path: OUT + `m-${tag}-dialog.png` });
  await pg.evaluate(() => { document.getElementById('dialog').hidden = true; });
  await pg.evaluate(() => UI.dialog({ who: 'urk', t: 'x', opts: [{ t: 'Пока' }] })); await W.until(pg, () => !!document.querySelector('#dlg-opts .opt'));
  await pg.evaluate(() => document.querySelector('.opt') && document.querySelector('.opt').click());

  // 6. пауза и ячейки сохранений
  await pg.tap('#pause-btn'); await W.until(pg, () => state === 'pause'); await W.frames(pg, 2);
  const aP = await pg.evaluate(AUDIT);
  ok(!aP.small.length, `пауза: кнопки ≥44: ${aP.small.join(', ') || 'все'}`);
  ok(!aP.over.length, `пауза: перекрытия: ${aP.over.join(', ') || 'нет'}`);
  await pg.tap('#p-save'); await W.until(pg, () => !!document.querySelector('#slots .card') && !document.getElementById('slots').hidden);
  ok((await pg.evaluate(() => { const c = document.querySelector('#slots .card').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight + 1; })), 'ячейки сохранений в экране');
  await pg.screenshot({ path: OUT + `m-${tag}-slots.png` });
  await pg.tap('#sl-back'); await pg.tap('#resume');

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
