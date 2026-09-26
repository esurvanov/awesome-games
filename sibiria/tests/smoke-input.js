// Ввод мира (SPEC-input, B1 / B7): настоящие события page.mouse / keyboard / touchscreen (+ CDP для 2 пальцев).
// Проверка — по состоянию игры (G.col.sel, task.k, cam, Input.debug()). Экран↔мир — только GFX.screenToWorld / worldToScreen.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const W = require('./_wait'); // ожидание условий/кадров, заморозка мира, пачки CDP-событий
const TIPS = '{"move":1,"act":1,"fire":1,"cold":1,"eat":1,"stove":1,"night":1,"craft":1,"build":1,"select":1,"zoom":1}';

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  let closing = false; b.on('disconnected', () => { if (!closing) console.log('ERR браузер отключился извне'); });
  const log = [], fail = [], errs = [];
  const ok = (c, w) => { log.push((c ? 'ok   ' : 'FAIL ') + w); if (!c) fail.push(w); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    // ---------- 📐 grep: один модуль ввода, одна формула экран↔мир ----------
    const src = f => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8');
    const others = ['colony.js', 'ui.js', 'gfx.js', 'game.js'];
    const lis = others.filter(f => /\$\('game'\)\.addEventListener|^\s*(window\.)?addEventListener\('(pointer\w+|wheel|dblclick|contextmenu)'/m.test(src(f)));
    ok(!lis.length, `✅4 обработчики мира только в input.js (лишние: ${lis.join(', ') || '—'})`);
    const frm = ['colony.js', 'ui.js', 'input.js', 'game.js'].filter(f => /zoom \+ cam|GFX\.zoom \+ cam/.test(src(f)));
    ok(!frm.length, `✅5 формула экран→мир только в gfx.js (лишние: ${frm.join(', ') || '—'})`);

    // ================= мышь ================= (PART=touch — только тач, для отладки)
    if (process.env.PART !== 'touch') {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
      await W.prepare(pg);
      pg.on('pageerror', e => errs.push('PAGEERR ' + e.message)); pg.on('crash', () => errs.push('PAGEERR страница упала (crash)'));
      pg.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
      await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await pg.goto(URL);
      await pg.evaluate(t => { localStorage.clear(); localStorage.setItem('sibir-tips', t); }, TIPS);
      await pg.click('#start');
      await pg.waitForFunction(() => state === 'play');
      await W.freeze(pg); // сюжет/угрозы/погода/NPC/люди/подсказки стоят; S17 гоняет Colony.update вручную
      await pg.mouse.move(640, 400);
      const mc = await pg.context().newCDPSession(pg);

      // фикстура: день, герой бессмертен, 3 бича + эвенк заморожены, камера у героя
      const fixture = () => pg.evaluate(() => {
        G.s.hp = 1e9; G.s.warm = 100; G.s.food = 100; G.time = tAt(G.day, 11); G.storm = null; G.col.alarm = false; G.wolves = []; G.bear = null; G.shake = 0;
        G.p.x = HUT.x + 40; G.p.y = HUT.y + 260; G.p.action = null; G.col.ghost = null; Input.hero = false;
        GFX.setZoom(1); GFX.recenter(); G.col.units = G.col.units.filter(u => u.pet); G.col.sel = [];
        for (const u of G.col.units) { u.x = G.p.x - 200; u.y = G.p.y - 150; }
        for (const [t, dx, dy] of [['bich', -120, 40], ['bich', -60, 80], ['bich', 0, 110], ['evenk', 120, 40]])
          Object.assign(Colony.spawn(t, { x: G.p.x + dx, y: G.p.y + dy }), { task: { k: 'idle' }, idleT: -1e6 });
        G.urk.state = 'away';
      });
      const settle = async () => (await pg.evaluate(() => GFX.free)) ? W.camStill(pg) : W.snapCam(pg); // следит → ровно на герое (без догоняющего lerp); свободна (lookAt) → стоит 3 кадра
      const apart = () => pg.waitForTimeout(300); // НЕ ожидание состояния: гарантированный зазор ≥ 250 мс, чтобы клики не склеились в двойной (нагрузка только удлиняет)
      const fr = (n = 2) => W.frames(pg, n); // курсор/подсветка/призрак считаются в кадре — ждём кадры, не мс
      const S = (x, y) => pg.evaluate(([x, y]) => GFX.worldToScreen(x, y), [x, y]);
      const units = () => pg.evaluate(() => G.col.units.filter(u => !u.pet).map(u => ({ id: u.id, type: u.type, x: u.x, y: u.y })));
      const sel = () => pg.evaluate(() => G.col.sel.slice().sort());
      const dbg = () => pg.evaluate(() => Input.debug());
      const clickAt = async (p, o = {}) => { await pg.mouse.move(p.x, p.y); await pg.mouse.down(o); await pg.mouse.up(o); };
      const rclick = p => clickAt(p, { button: 'right' });
      const task = id => pg.evaluate(i => { const u = G.col.units.find(u => u.id === i); return u && u.task.k; }, id);
      const zoneTxt = () => pg.evaluate(() => { const z = document.getElementById('zone'); return z.hidden ? '' : z.textContent; });
      let U, B, EV; const reU = async () => { U = await units(); B = U.filter(u => u.type === 'bich'); EV = U.find(u => u.type === 'evenk'); };
      const fresh = async () => { await fixture(); await settle(); await reU(); };

      await fresh();

      // 📐 инвариант
      const inv = await pg.evaluate(() => { let m = 0; for (const z of [0.6, 1, 1.6]) { GFX.setZoom(z); for (const [x, y] of [[10, 10], [640, 400], [1270, 790]]) { const w = GFX.screenToWorld(x, y), s = GFX.worldToScreen(w.x, w.y); m = Math.max(m, Math.hypot(s.x - x, s.y - y)); } } GFX.setZoom(1); return m; });
      ok(inv < 0.01, `📐 worldToScreen(screenToWorld(p)) = p (ошибка ${inv.toExponential(1)})`);
      await settle();

      // ---------- 🎯 выделение ----------
      let p = await S(B[0].x, B[0].y - 14); await clickAt(p);
      ok((await sel()).join() === String(B[0].id), 'S01 ЛКМ по человеку → 1 выделен');
      await pg.evaluate(() => { G.col.sel = []; });
      p = await S(B[1].x, B[1].y - 38); await clickAt(p);
      ok((await sel()).join() === String(B[1].id), 'S02 ЛКМ по голове (y−38) → выделен');
      p = await S(B[1].x + 200, B[1].y + 150); await clickAt(p);
      ok(!(await sel()).length, 'S03 ЛКМ в пустоту → снято');
      await pg.keyboard.down('Shift');
      await clickAt(await S(B[0].x, B[0].y - 20)); await apart(); await clickAt(await S(B[1].x, B[1].y - 20));
      ok((await sel()).length === 2, 'S04 Shift+ЛКМ → добавить (2)');
      await apart(); await clickAt(await S(B[0].x, B[0].y - 20));
      ok((await sel()).join() === String(B[1].id), 'S05 Shift+ЛКМ по выделенному → убрать');
      await pg.keyboard.up('Shift'); await apart();
      // рамка
      const boxAround = async (list, m = 25) => {
        const ss = []; for (const u of list) ss.push(await S(u.x, u.y - 14));
        const x0 = Math.min(...ss.map(s => s.x)) - m, x1 = Math.max(...ss.map(s => s.x)) + m, y0 = Math.min(...ss.map(s => s.y)) - m, y1 = Math.max(...ss.map(s => s.y)) + m;
        return { x0, y0, x1, y1 };
      };
      let bx = await boxAround(B);
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 6 });
      const dBox = await dbg();
      ok(dBox.st === 'BOX' && dBox.cursor === 'box', `K2 рамка видна при протяжке (st ${dBox.st}, курсор ${dBox.cursor})`);
      await pg.mouse.up();
      ok((await sel()).length === 3 && (await pg.evaluate(() => Colony.selected().every(u => u.type === 'bich'))), 'S06 рамка вокруг 3 → 3 бича');
      // лайка в рамке не берётся
      const dog = await pg.evaluate(() => { let d = G.col.units.find(u => u.pet); if (!d) d = Colony.spawn('laika', { pet: 1 }); d.x = G.p.x - 60; d.y = G.p.y + 40; d.task = { k: 'idle' }; d.idleT = -1e6; d.pet = 1; return { id: d.id, x: d.x, y: d.y }; });
      bx = await boxAround([B[0], B[1], dog]);
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 4 }); await pg.mouse.up();
      const s7 = await sel(); ok(s7.length >= 2 && !s7.includes(dog.id), `S07 рамка не берёт лайку (${s7})`);
      await pg.evaluate(() => { G.col.units = G.col.units.filter(u => !u.pet); G.col.sel = []; });
      // дрожание
      for (const j of [4, 7]) {
        await pg.evaluate(() => { G.col.sel = []; }); p = await S(B[2].x, B[2].y - 20);
        await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.mouse.move(p.x + j, p.y + 1); await pg.mouse.up();
        ok((await sel()).join() === String(B[2].id), `S08 клик с дрожанием ${j} px → выделен`);
        await apart();
      }
      // двойной / тройной клик
      await pg.evaluate(() => { G.col.sel = []; }); p = await S(B[0].x, B[0].y - 20);
      const mclick = (x, y, n) => { const e = []; for (let c = 1; c <= n; c++) e.push({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: c }, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: c }); return W.mouseBurst(mc, e); };
      await mclick(p.x, p.y, 2); // пачкой: интервал двойного клика — как у руки, не время CDP туда-обратно
      ok((await sel()).length === 3, 'S09 двойной клик → все бичи в кадре');
      await apart(); await pg.evaluate(() => { G.col.sel = []; });
      await mclick(p.x, p.y, 3);
      ok((await sel()).length === 3, `S10 тройной клик → все бичи (${(await sel()).length})`);
      await apart();
      // 5 быстрых кликов по разным
      for (const u of [B[0], B[1], B[2], EV, B[0]]) { await clickAt(await S(u.x, u.y - 20)); await pg.waitForTimeout(30); }
      ok((await sel()).join() === String(B[0].id), 'S47 5 быстрых кликов → последний');
      await apart();
      // тряска
      await pg.evaluate(() => { G.col.sel = []; G.shake = 8; }); await clickAt(await S(B[1].x, B[1].y - 20));
      ok((await sel()).join() === String(B[1].id), 'S49 клик при тряске → выделен');
      await pg.evaluate(() => { G.shake = 0; }); await apart();
      // рамка при зуме 1.5
      await pg.evaluate(() => { GFX.setZoom(1.5); G.col.sel = []; }); await settle();
      bx = await boxAround(U, 30);
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 5 }); await pg.mouse.up();
      ok((await sel()).length === 4, `S48 рамка при зуме 1.5 → 4 (${(await sel()).length})`);
      await pg.evaluate(() => { GFX.setZoom(1); G.col.sel = []; }); await settle();

      // ---------- ➡️ приказы ----------
      const tree = await pg.evaluate(() => { let best = null, bd = 1e12; for (const t of G.trees) { if (t.wall || !(t.wood > 0)) continue; const s = GFX.worldToScreen(t.x, t.y); if (s.x < 100 || s.y < 180 || s.x > 1180 || s.y > 700) continue; if ([G.p, ...G.col.units].some(u => Math.abs(u.x - t.x) < 70 && u.y > t.y - 110 && u.y < t.y + 60)) continue; const d = (t.x - G.p.x) ** 2 + (t.y - G.p.y) ** 2; if (d < bd) { bd = d; best = t; } } return best && { x: best.x, y: best.y, kind: best.kind }; });
      ok(!!tree, 'дерево в кадре есть');
      const selB = () => pg.evaluate(i => { G.col.sel = [i]; const u = G.col.units.find(u => u.id === i); u.task = { k: 'idle' }; }, B[0].id);
      await selB(); await rclick(await S(tree.x, tree.y - 5));
      ok(await task(B[0].id) === 'chop', 'S11 ПКМ по стволу → рубить');
      for (const dy of [40, 100]) {
        await selB(); await rclick(await S(tree.x, tree.y - dy));
        ok(await task(B[0].id) === 'chop', `S12 ПКМ по кроне (−${dy}) → рубить`);
      }
      // 🖱️ курсоры
      const curs = {};
      await selB(); await pg.mouse.move(...Object.values(await S(tree.x, tree.y - 60))); await fr(); curs.tree = await dbg();
      await pg.mouse.move(...Object.values(await S(B[1].x, B[1].y - 20))); await fr(); curs.unit = await dbg();
      const empty = await pg.evaluate(() => { for (let r = 120; r < 500; r += 20) for (let a = 0; a < 6.28; a += 0.4) { const x = G.p.x + Math.cos(a) * r, y = G.p.y + Math.sin(a) * r * 0.6; const s = GFX.worldToScreen(x, y); if (s.x < 60 || s.y < 150 || s.x > 1220 || s.y > 700) continue; const t = Input.pick(s.x, s.y); if (t.k === 'ground') return s; } return null; });
      await pg.mouse.move(empty.x, empty.y); await fr(); curs.ground = await dbg();
      ok(curs.tree.cursor === 'chop' && curs.tree.intent === 'chop', `S20 курсор над деревом при биче: ${curs.tree.cursor}`);
      ok(curs.unit.hover && curs.unit.hover.k === 'unit' && curs.unit.cursor === 'sel', `S50 наведение на человека → подсветка (${JSON.stringify(curs.unit.hover)})`);
      ok(curs.ground.cursor === 'move', `курсор над пустым при выделении: ${curs.ground.cursor}`);
      await pg.evaluate(() => { G.col.sel = []; }); await fr();
      curs.none = await dbg();
      const css = await pg.evaluate(() => getComputedStyle(document.getElementById('game')).cursor);
      ok(new Set([curs.tree.css, curs.unit.css, curs.ground.css, curs.none.css]).size === 4 && !/^auto$/.test(css), 'S20 курсоры разные, не auto (K12)');
      // пусто / без выделения / по своему
      await selB(); await rclick(empty);
      ok(await task(B[0].id) === 'move', 'S16 ПКМ в пустоту → идти');
      await selB(); await rclick(await S(B[1].x, B[1].y - 20));
      ok(await task(B[0].id) === 'move', 'S19 ПКМ по своему → идти');
      await pg.evaluate(() => { G.col.sel = []; });
      const hp0 = await pg.evaluate(() => ({ x: G.p.x, y: G.p.y }));
      await rclick(empty); await fr(3);
      const z18 = await zoneTxt(), hp1 = await pg.evaluate(() => ({ x: G.p.x, y: G.p.y }));
      ok(/выдели/i.test(z18) && Math.hypot(hp1.x - hp0.x, hp1.y - hp0.y) < 1, `S18 ПКМ без выделения → подсказка «${z18}», герой стоит`);
      // стройка
      const site = await pg.evaluate(() => { const b = { id: G.col.nextId++, type: 'balok', x: Math.round(G.p.x + 260), y: Math.round(G.p.y - 60), prog: 0.2, done: 0 }; G.col.builds.push(b); return b; });
      await selB(); await rclick(await S(site.x, site.y - 10));
      ok(await task(B[0].id) === 'build', 'S15 ПКМ по стройке → строить');
      await pg.mouse.move(...Object.values(await S(site.x, site.y - 10))); await fr();
      ok((await dbg()).cursor === 'build', 'курсор 🔨 над стройкой');
      await pg.evaluate(id => { G.col.builds = G.col.builds.filter(b => b.id !== id); }, site.id);
      // волк: атаковать цель, волк ушёл — цель та же
      const wolf = await pg.evaluate(() => { const w = { x: G.p.x + 250, y: G.p.y + 60, vx: 0, vy: 0, hp: 99, cd: 0, t: 0, face: 1, step: 0, dir: 1, st: 'circle', ang: 0, pr: 0 }; G.wolves.push(w); return { x: w.x, y: w.y }; });
      await pg.evaluate(i => { G.col.sel = [i]; }, EV.id);
      await pg.mouse.move(...Object.values(await S(wolf.x, wolf.y - 17))); await fr();
      ok((await dbg()).cursor === 'attack', 'курсор ⚔️ над волком');
      await rclick(await S(wolf.x, wolf.y - 17));
      const t17 = await pg.evaluate(i => { const u = G.col.units.find(u => u.id === i); const w0 = G.wolves[0]; w0.x += 300; w0.y -= 100; const cu = window.__T.orig['Colony.update']; for (let k = 0; k < 10; k++) cu(0.05, hourOf(), false); return { k: u.task.k, same: u.task.o === G.wolves[0] }; }, EV.id);
      ok(t17.k === 'attack' && t17.same, `S17 ПКМ по волку → атаковать цель, волк ушёл — цель та же (${t17.k})`);
      await pg.evaluate(() => { G.wolves = []; });
      // лёд
      await fresh();
      await pg.evaluate(() => { GFX.lookAt(riverX(G.p.y), G.p.y); }); await settle();
      await selB();
      const ice = await S(await pg.evaluate(() => riverX(G.p.y)), await pg.evaluate(() => G.p.y));
      await pg.mouse.move(ice.x, ice.y); await fr();
      const cIce = await dbg();
      await rclick(ice);
      ok(await task(B[0].id) === 'fish' && cIce.cursor === 'fish', `S13 ПКМ по льду → рыбачить (курсор ${cIce.cursor})`);
      // обломки
      await pg.evaluate(() => { GFX.lookAt(POI.cockpit.x, POI.cockpit.y); }); await settle();
      await selB(); const wr = await pg.evaluate(() => GFX.worldToScreen(POI.cockpit.x, POI.cockpit.y - 40));
      await rclick(wr);
      ok(await task(B[0].id) === 'wreck', 'S14 ПКМ по обломкам → разбирать');

      // ---------- 🔍 зум ----------
      await fresh();
      const P = { x: 300, y: 250 };
      await pg.mouse.move(P.x, P.y);
      const w0 = await pg.evaluate(p => GFX.screenToWorld(p.x, p.y), P);
      await pg.mouse.wheel(0, -100); await W.until(pg, () => GFX.zoom > 1.05);
      const w1 = await pg.evaluate(p => ({ ...GFX.screenToWorld(p.x, p.y), z: GFX.zoom }), P);
      ok(w1.z > 1.05 && Math.hypot(w1.x - w0.x, w1.y - w0.y) < 3, `S21 колесо у курсора: z=${w1.z.toFixed(2)}, сдвиг ${Math.hypot(w1.x - w0.x, w1.y - w0.y).toFixed(1)}`);
      await pg.evaluate(() => GFX.setZoom(1));
      const z22 = await pg.evaluate(() => { const c = document.getElementById('game'); const z0 = GFX.zoom; for (let i = 0; i < 10; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, clientX: 640, clientY: 400, bubbles: true, cancelable: true })); return GFX.zoom / z0; });
      ok(z22 > 1.3, `S22 колесо строками (deltaMode 1) ×10 → зум ×${z22.toFixed(2)}`);
      await pg.evaluate(() => { GFX.setZoom(1); UI.openCraft('build'); }); await fr();
      const pb = await pg.locator('#panel').boundingBox();
      await pg.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
      await pg.evaluate(() => { window.__wh = 0; addEventListener('wheel', () => window.__wh++, { capture: true, once: true }); });
      await pg.mouse.wheel(0, -200); await W.until(pg, () => window.__wh > 0); await fr();
      ok(await pg.evaluate(() => GFX.zoom === 1), 'S23 колесо над панелью → мир стоит');
      await pg.keyboard.press('Escape');

      // ---------- 🧱 UI над миром ----------
      await fresh();
      await pg.evaluate(i => { G.col.sel = [i]; UI.openCraft('build'); }, B[0].id); await fr();
      await clickAt({ x: 1100, y: 150 });
      ok(await pg.evaluate(() => !UI.modal()), 'S38 ЛКМ мимо открытой панели → закрыть');
      ok((await sel()).join() === String(B[0].id), 'S38 выделение не тронуто');
      await pg.evaluate(() => UI.openCraft('build')); await fr();
      await rclick({ x: 1100, y: 150 });
      ok(await pg.evaluate(() => !UI.modal()) && await task(B[0].id) === 'idle', 'S39 ПКМ мимо панели → закрыть, приказа нет');
      await pg.evaluate(() => UI.dialog(DIALOG[Object.keys(DIALOG)[0]])); await fr();
      await clickAt(await S(B[1].x, B[1].y - 20));
      ok(await pg.evaluate(() => UI.modal()) && (await sel()).join() === String(B[0].id), 'S40 ЛКМ по миру при диалоге → мир не тронут');
      for (let i = 0; i < 6 && await pg.evaluate(() => UI.modal()); i++) await pg.keyboard.press('Escape');
      const bb = await pg.locator('#pause-btn').boundingBox().catch(() => null);
      if (bb) { await pg.evaluate(i => { G.col.sel = [i]; }, B[0].id); await pg.locator('#minimap').hover(); await pg.mouse.move(bb.x + 2, bb.y + bb.height / 2); }
      await pg.evaluate(i => { G.col.sel = [i]; }, B[0].id);
      await pg.click('#build-btn').catch(() => {}); await fr();
      ok((await sel()).join() === String(B[0].id), 'S37 кнопка HUD «Стройка» → выделение цело');
      for (let i = 0; i < 4 && await pg.evaluate(() => UI.modal()); i++) await pg.keyboard.press('Escape');

      // ---------- 🎹 аккорды ----------
      await fresh();
      await pg.evaluate(i => { G.col.sel = [i]; }, B[0].id);
      bx = await boxAround(B);
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 4 });
      await pg.mouse.down({ button: 'right' });
      const d45 = await dbg();
      await pg.mouse.up({ button: 'right' }); await pg.mouse.up();
      ok(d45.st === 'IDLE' && (await sel()).join() === String(B[0].id), `S45 рамка + ПКМ → отмена, выделение прежнее (st ${d45.st})`);
      const c45 = await pg.evaluate(() => cam.x);
      await pg.mouse.move(640, 400); await pg.mouse.down({ button: 'middle' }); await pg.mouse.move(600, 400, { steps: 2 });
      // пан дошёл (обработчик отработал), затем палец стоит ≥ 150 мс: окно скорости броска 100 мс пусто — без инерции
      await W.until(pg, c => Math.abs(cam.x - c - 40) < 1, c45); await sleep(150);
      await pg.mouse.down({ button: 'left' }); await pg.mouse.up({ button: 'middle' });
      const d46 = await dbg(); const c46 = await pg.evaluate(() => cam.x);
      await pg.mouse.move(500, 400, { steps: 3 }); await fr();
      const c46b = await pg.evaluate(() => cam.x); await pg.mouse.up({ button: 'left' });
      ok(d46.st !== 'PAN' && Math.abs(c46b - c46) < 1, `S46 СКМ→ЛКМ→отпуск СКМ → пан кончился (st ${d46.st}, сдвиг ${(c46b - c46).toFixed(1)})`);
      await fresh();
      await pg.evaluate(i => { G.col.sel = [i]; }, B[0].id);
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 3 });
      await pg.evaluate(() => dispatchEvent(new Event('blur')));
      const d44 = await dbg(); await pg.mouse.up();
      ok(d44.st === 'IDLE' && (await sel()).join() === String(B[0].id), 'S44 blur посреди рамки → сброс без эффекта');
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 3 });
      await pg.keyboard.press('Escape');
      ok((await dbg()).st === 'IDLE' && await pg.evaluate(() => state === 'play'), 'Esc посреди рамки → отмена рамки, без паузы');
      await pg.mouse.up();
      await pg.mouse.move(bx.x0, bx.y0); await pg.mouse.down(); await pg.mouse.move(bx.x1, bx.y1, { steps: 3 }); await pg.mouse.move(1279, 799, { steps: 2 }); await pg.mouse.move(1400, 900); await pg.mouse.up();
      ok((await dbg()).st === 'IDLE', 'S43 рамка, отпуск за окном → закрыта');
      await pg.mouse.move(640, 400);

      // ---------- ✋ пан, инерция, возврат к герою ----------
      await fresh();
      let c0 = await pg.evaluate(() => ({ x: cam.x, y: cam.y }));
      await pg.mouse.move(700, 400); await pg.mouse.down({ button: 'middle' });
      for (let i = 1; i <= 10; i++) { await pg.mouse.move(700 - i * 20, 400); await sleep(40); }
      await W.until(pg, x => Math.abs(cam.x - x - 200) <= 2, c0.x); // перемещения мыши выравниваются по кадру — ждём, пока дойдут
      const c1 = await pg.evaluate(() => ({ x: cam.x, y: cam.y }));
      const dPan = await dbg();
      await pg.mouse.up({ button: 'middle' });
      ok(Math.abs(c1.x - c0.x - 200) <= 2 && dPan.st === 'PAN' && dPan.cursor === 'pan', `S24 СКМ 200 px → камера ${(c1.x - c0.x).toFixed(1)} px сразу (курсор ${dPan.cursor})`);
      // пан держится, пока герой идёт по ПКМ-пути
      await fresh();
      await clickAt(await S(await pg.evaluate(() => G.p.x), await pg.evaluate(() => G.p.y - 20)));
      ok(await pg.evaluate(() => Input.hero && !G.col.sel.length), 'S41 ЛКМ по герою → герой выделен');
      const heroT = await S(await pg.evaluate(() => G.p.x + 350), await pg.evaluate(() => G.p.y + 60));
      await rclick(heroT);
      ok(!!(await dbg()).heroGo, '👤 ПКМ при выделенном герое → путь');
      await pg.mouse.move(640, 300); await pg.mouse.down({ button: 'middle' }); await pg.mouse.move(340, 300, { steps: 3 });
      await W.until(pg, () => Input.debug().st === 'PAN' && GFX.free); await fr(2); await sleep(150); await pg.mouse.up({ button: 'middle' }); // стоял ≥150 мс — без броска
      await W.camStill(pg);
      c0 = await pg.evaluate(() => ({ x: cam.x, px: G.p.x }));
      await W.until(pg, px => G.p.x - px > 40, c0.px, { timeout: 15000 }); // герой прошёл 40 px — сколько бы кадров это ни заняло
      const c25 = await pg.evaluate(() => ({ x: cam.x, px: G.p.x }));
      ok(Math.abs(c25.x - c0.x) < 1 && c25.px - c0.px > 40, `S25 пан держится, пока герой идёт (камера ${(c25.x - c0.x).toFixed(1)}, герой +${(c25.px - c0.px).toFixed(0)})`);
      await pg.keyboard.press('Escape');
      ok(await pg.evaluate(() => !Input.hero && state === 'play'), 'Esc снимает выделение героя (без паузы)');
      // WASD — возврат камеры к герою с первого нажатия, путь героя отменён
      await pg.evaluate(() => { Input.hero = true; }); await rclick(heroT);
      await pg.keyboard.down('KeyS'); await fr(2);
      const m0 = await pg.evaluate(() => GFX.mode);
      await W.until(pg, () => GFX.mode === 'follow' && Math.hypot(cam.x + GFX.vw / 2 - G.p.x, cam.y + GFX.vh / 2 - G.p.y + 20) < 60, null, { timeout: 10000 }); // возврат 0.35 с игрового времени
      await pg.keyboard.up('KeyS'); await fr();
      const m1 = await pg.evaluate(() => ({ mode: GFX.mode, d: Math.hypot(cam.x + GFX.vw / 2 - G.p.x, cam.y + GFX.vh / 2 - G.p.y + 20), go: Input.debug().heroGo, hero: Input.hero }));
      ok(m0 !== 'free' && m1.mode === 'follow' && m1.d < 60 && !m1.go && m1.hero, `WASD: камера к герою с 1-го нажатия (${m0}→${m1.mode}, ${m1.d.toFixed(0)} px), путь отменён, выделение цело`);
      // инерция: бросок пачкой (без круговых задержек CDP); проверка — камера ушла ДАЛЬШЕ пальца (пан 1:1 = 240 px),
      // считая от позиции ДО жеста: при низком FPS бросок успевает докатиться до края мира раньше, чем тест прочтёт «старт»
      await fresh();
      await pg.mouse.move(800, 400);
      const i0 = await pg.evaluate(() => cam.x), fz = await pg.evaluate(() => GFX.zoom);
      const fl = [{ type: 'mousePressed', x: 800, y: 400, button: 'middle', buttons: 4, clickCount: 1 }];
      for (let i = 1; i <= 6; i++) fl.push({ type: 'mouseMoved', x: 800 - i * 40, y: 400, button: 'middle', buttons: 4 });
      fl.push({ type: 'mouseReleased', x: 560, y: 400, button: 'middle', buttons: 0, clickCount: 1 });
      await W.mouseBurst(mc, fl); await pg.mouse.move(560, 400);
      const i1 = (await W.until(pg, ([x, w]) => cam.x - x > w + 20 && cam.x, [i0, 240 / fz], { timeout: 5000 })) || await pg.evaluate(() => cam.x);
      const inert = await pg.evaluate(() => Input.debug().inertia);
      ok(i1 - i0 - 240 / fz > 20, `инерция после броска: камера сверх пальца ещё ${(i1 - i0 - 240 / fz).toFixed(0)} px`);
      await pg.mouse.move(640, 400); await pg.mouse.down(); await pg.mouse.up();
      const i2 = await pg.evaluate(() => cam.x); await fr(5);
      ok(Math.abs(await pg.evaluate(() => cam.x) - i2) < 1 && !(await pg.evaluate(() => Input.debug().inertia)), `нажатие гасит инерцию${inert ? '' : ' (инерция к нажатию уже кончилась)'}`);
      // край экрана
      await fresh();
      c0 = await pg.evaluate(() => cam.x);
      await pg.mouse.move(2, 400); await W.until(pg, x => x - cam.x > 100, c0, { timeout: 10000 }); await pg.mouse.move(640, 400);
      const e1 = await pg.evaluate(() => cam.x);
      ok(c0 - e1 > 100, `S26 курсор у края → камера едет (${(e1 - c0).toFixed(0)})`);
      await pg.evaluate(() => UI.openCraft('build')); await fr();
      const e2 = await pg.evaluate(() => cam.x); await pg.mouse.move(2, 400); await fr(8); await pg.mouse.move(640, 400);
      ok(Math.abs(await pg.evaluate(() => cam.x) - e2) < 1, 'S28 край при панели → стоит');
      await pg.keyboard.press('Escape');
      // зум у края мира — клампится (K6)
      const k6 = await pg.evaluate(() => { GFX.lookAt(0, 0); GFX.setZoom(0.6, 5, 5); return cam.x >= -GFX.vw / 2 - 0.01 && cam.y >= -GFX.vh / 2 - 0.01; });
      ok(k6, 'K6 зум у края мира — камера в пределах');
      // миникарта
      await fresh();
      const mm = await pg.locator('#minimap').boundingBox();
      await pg.mouse.click(mm.x + mm.width * 0.25, mm.y + mm.height * 0.25);
      ok(await W.until(pg, () => GFX.free), 'S29 клик по миникарте → камера туда (свободно)');

      // ---------- 🏗️ постройка ----------
      await fresh();
      await pg.evaluate(() => { G.chest.wood = 99; G.chest.food = 99; Colony.startPlace('balok'); });
      await pg.mouse.move(380, 250, { steps: 3 });
      const gx0 = await pg.evaluate(() => G.p.x);
      await pg.keyboard.down('KeyD'); await W.until(pg, x => G.p.x - x > 30, gx0, { timeout: 10000 }); await pg.keyboard.up('KeyD'); await fr();
      const drift = await pg.evaluate(() => { const w = GFX.screenToWorld(380, 250); return Math.hypot(G.col.ghost.x - w.x, G.col.ghost.y - w.y); });
      ok(drift < 5, `S32 призрак под курсором при движении камеры (сдвиг ${drift.toFixed(1)})`);
      ok(['placeBad', 'place'].includes((await dbg()).cursor), 'курсор ✚/🚫 над призраком');
      await pg.mouse.down({ button: 'right' }); await pg.mouse.up({ button: 'right' });
      ok(await pg.evaluate(() => !G.col.ghost && state === 'play'), 'S33 ПКМ при призраке → отмена');
      // найти место, где можно ставить
      const spot = await pg.evaluate(() => { for (let r = 150; r < 600; r += 30) for (let a = 0; a < 6.28; a += 0.3) { const x = G.p.x + Math.cos(a) * r, y = G.p.y + Math.sin(a) * r * 0.7; const s = GFX.worldToScreen(x, y); if (s.x < 120 || s.y < 200 || s.x > 1150 || s.y > 650) continue; if (Colony.canPlace('balok', x, y) && Colony.canPlace('balok', x + 25 / GFX.zoom, y)) return s; } return null; });
      ok(!!spot, 'место для балка в кадре');
      await pg.evaluate(() => Colony.startPlace('balok'));
      const nb0 = await pg.evaluate(() => G.col.builds.length);
      await pg.mouse.move(spot.x, spot.y); await fr(); await pg.mouse.down();
      const nbDown = await pg.evaluate(() => G.col.builds.length);
      await pg.mouse.move(spot.x + 20, spot.y, { steps: 3 }); await pg.mouse.up();
      ok(nbDown === nb0 && await pg.evaluate(n => G.col.builds.length === n && !!G.col.ghost, nb0), 'S34 ЛКМ↓ + увёл 20 px → не ставит, призрак остался (K1)');
      await pg.mouse.move(spot.x, spot.y); await fr();
      await pg.mouse.down(); const nbD2 = await pg.evaluate(() => G.col.builds.length); await pg.mouse.up();
      const s34 = await pg.evaluate(n => G.col.builds.length === n + 1 && !G.col.ghost ? '' : ' · ' + JSON.stringify({ n: G.col.builds.length - n, gh: G.col.ghost, toast: [...document.querySelectorAll('#toasts > *')].map(e => e.textContent).slice(-2), in: Input.debug().st }), nb0);
      ok(nbD2 === nb0 && !s34, 'S34 клик → ставит на отпускании' + s34);
      await pg.evaluate(() => Colony.startPlace('balok')); await fr();
      await pg.keyboard.press('Escape');
      ok(await pg.evaluate(() => !G.col.ghost && state === 'play'), 'S35 Esc при призраке → отмена без паузы');
      await pg.evaluate(() => Colony.startPlace('balok')); await fr();
      await pg.keyboard.press('KeyB');
      ok(await pg.evaluate(() => !G.col.ghost && !UI.modal()), 'повторное B → отмена призрака');
      await pg.evaluate(() => { G.col.builds = G.col.builds.filter(b => b.done); Colony.startPlace('balok'); }); await fr();
      const spot2 = await pg.evaluate(() => { for (let r = 150; r < 600; r += 30) for (let a = 0; a < 6.28; a += 0.3) { const x = G.p.x + Math.cos(a) * r, y = G.p.y + Math.sin(a) * r * 0.7; const s = GFX.worldToScreen(x, y); if (s.x < 120 || s.y < 200 || s.x > 1150 || s.y > 650) continue; if (Colony.canPlace('balok', x, y)) return s; } return null; });
      await pg.mouse.move(spot2.x, spot2.y); await fr();
      await pg.keyboard.down('Shift'); await pg.mouse.down(); await pg.mouse.up(); await pg.keyboard.up('Shift');
      ok(await pg.evaluate(() => G.col.builds.some(b => !b.done) && !!G.col.ghost), 'Shift при постановке → призрак остаётся для следующей');
      await pg.keyboard.press('Escape');
      await pg.evaluate(() => { G.col.builds = G.col.builds.filter(b => b.done); });

      // ---------- 👤 NPC ----------
      await fresh();
      const urk = await pg.evaluate(() => { G.urk.state = 'wait'; G.urk.x = G.p.x + 200; G.urk.y = G.p.y - 40; return { x: G.urk.x, y: G.urk.y }; });
      await pg.mouse.move(...Object.values(await S(urk.x, urk.y - 20))); await fr();
      const cu = await dbg();
      await clickAt(await S(urk.x, urk.y - 20)); await fr();
      const z42 = await zoneTxt();
      ok(/E/.test(z42) && cu.cursor === 'talk', `S42 ЛКМ по Уркачану → курсор 💬 и подсказка «${z42}»`);
      await pg.evaluate(() => { G.urk.state = 'away'; });
      await pg.mouse.move(640, 400);
      await pg.close();
    }

    // ================= 📱 тач ================= (PART=mouse — только мышь)
    if (process.env.PART !== 'mouse') {
      // Касания через CDP подтверждаются до обработчика страницы → после жеста ждём отпускания (W.input) или условия
      // (W.until), а не миллисекунды; жесты с порогами времени (двойной тап 300 мс, долгое нажатие 400 мс) — пачкой.
      const d = devices['Pixel 7'] || devices['Pixel 5'];
      const ctx = await b.newContext({ ...d });
      const tg = await ctx.newPage();
      await W.prepare(tg);
      tg.on('pageerror', e => errs.push('PAGEERR(touch) ' + e.message)); tg.on('crash', () => errs.push('PAGEERR(touch) страница упала (crash)'));
      await tg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await tg.goto(URL);
      await tg.evaluate(t => { localStorage.clear(); localStorage.setItem('sibir-tips', t); }, TIPS);
      await tg.reload(); await tg.waitForFunction(() => state === 'menu' && !!window.__T);
      await tg.tap('#start'); await tg.waitForFunction(() => state === 'play');
      await W.freeze(tg); // карточка главы/реплики закрыты, сюжет/угрозы/погода/NPC/люди/подсказки стоят
      const tfix = () => tg.evaluate(() => {
        G.s.hp = 1e9; G.time = tAt(G.day, 11); G.storm = null; G.col.alarm = false; G.wolves = []; G.p.x = HUT.x + 40; G.p.y = HUT.y + 260; G.col.ghost = null; Input.hero = false;
        GFX.setZoom(1); GFX.recenter(); G.col.units = []; G.col.sel = []; G.urk.state = 'away';
        for (const [t, dx, dy] of [['bich', -60, 20], ['bich', -110, 50], ['evenk', -20, 70]]) Object.assign(Colony.spawn(t, { x: G.p.x + dx, y: G.p.y + dy }), { task: { k: 'idle' }, idleT: -1e6 });
        UI.setOrder(true); UI.closePanel();
      });
      const tsettle = async () => { await W.snapCam(tg); await W.settleUI(tg); }; // камера на герое + HUD перестроился под выделение
      await tfix(); await tsettle();
      const TU = await tg.evaluate(() => G.col.units.map(u => ({ id: u.id, type: u.type, ...GFX.worldToScreen(u.x, u.y - 20) })));
      const tb = TU.filter(u => u.type === 'bich');
      await W.input(tg, 1, () => tg.touchscreen.tap(tb[0].x, tb[0].y));
      ok(await tg.evaluate(i => G.col.sel.join() === String(i), tb[0].id), '📱 тап по человеку → выделен');
      const cdp = await ctx.newCDPSession(tg);
      const TS = (...p) => ({ type: 'touchStart', touchPoints: p }), TM = (...p) => ({ type: 'touchMove', touchPoints: p }), TE = { type: 'touchEnd', touchPoints: [] };
      await W.input(tg, 2, () => W.touchBurst(cdp, [TS(W.T1(tb[1].x, tb[1].y)), TE, TS(W.T1(tb[1].x, tb[1].y)), TE]));
      const dt2 = await tg.evaluate(() => G.col.sel.length);
      ok(dt2 === 2, `📱 двойной тап → все такие в кадре (${dt2})`);
      await W.settleUI(tg); // выделение сменилось → кнопки HUD могут встать туда, где было пусто
      // намерение над пальцем: CDP касание, значок до отпускания, приказ на отпускании
      const vp = tg.viewportSize();
      // пустое место с запасом 48 px от любых элементов HUD (раскладка телефона двигает ряды кнопок/баннеры по мере обновления HUD)
      const gp = await tg.evaluate(() => { const free = (x, y) => { for (const dx of [-48, 0, 48]) for (const dy of [-48, 0, 48]) { const e = document.elementFromPoint(x + dx, y + dy); if (!e || e.id !== 'game') return false; } return true; }; for (let r = 120; r < 500; r += 20) for (let a = 0; a < 6.28; a += 0.4) { const x = G.p.x + Math.cos(a) * r, y = G.p.y + Math.sin(a) * r * 0.5; const s = GFX.worldToScreen(x, y); if (s.x < 60 || s.y < 160 || s.x > innerWidth - 60 || s.y > innerHeight * 0.75) continue; if (Input.pick(s.x, s.y, true).k === 'ground' && free(s.x, s.y)) return s; } const m = {}; for (let y = 160; y < innerHeight * 0.75; y += 40) for (let x = 60; x < innerWidth - 60; x += 40) { const e = document.elementFromPoint(x, y), k = e ? e.id || String(e.className) : '-'; m[k] = (m[k] || 0) + 1; } window.__gpMiss = JSON.stringify({ m, cam: [cam.x, cam.y], p: [G.p.x, G.p.y], z: GFX.zoom, modal: UI.kind }); return null; });
      ok(!!gp, '📱 пустое место в кадре' + (gp ? '' : ' · ' + await tg.evaluate(() => window.__gpMiss)));
      await tg.evaluate(() => { for (const u of G.col.units) u.task = { k: 'idle' }; });
      const under = await W.hit(tg, gp.x, gp.y);
      await cdp.send('Input.dispatchTouchEvent', TS(W.T1(gp.x, gp.y)));
      const ti = await W.until(tg, () => { const t = Input.debug().touch; return t && t.ic ? t : false; }) || await tg.evaluate(() => Input.debug().touch);
      const why = ti && ti.ic ? '' : ' · под пальцем ' + under + ' · ' + await W.diag(tg);
      await W.input(tg, 1, () => cdp.send('Input.dispatchTouchEvent', TE));
      ok(ti && ti.ic === 'pin', `📱 значок намерения над пальцем до отпускания (${ti && ti.ic})${why}`);
      ok(await tg.evaluate(() => Colony.selected().every(u => u.task.k === 'move')), '📱 отпускание → приказ «идти»');
      // увод ≥ 12 px в режиме приказов по пустому → пан камеры 1:1, приказа нет
      await tg.evaluate(() => { for (const u of G.col.units) u.task = { k: 'idle' }; });
      await tsettle();
      const tc0 = await tg.evaluate(() => cam.x);
      const mv = []; for (let k = 1; k <= 6; k++) mv.push(TM(W.T1(gp.x - k * 10, gp.y)));
      await W.touchBurst(cdp, [TS(W.T1(gp.x, gp.y)), ...mv]); // пачкой: протяжка не должна пересечь 400 мс долгого нажатия
      const want = 60 / await tg.evaluate(() => GFX.zoom);
      const tc1 = (await W.until(tg, ([c, w]) => Math.abs(cam.x - c - w) < 2 && cam.x, [tc0, want])) || await tg.evaluate(() => cam.x);
      const tst = await tg.evaluate(() => Input.debug().st), why2 = Math.abs(tc1 - tc0 - want) < 2 ? '' : ' · ' + await W.diag(tg);
      await W.input(tg, 1, () => cdp.send('Input.dispatchTouchEvent', TE));
      ok(Math.abs(tc1 - tc0 - want) < 2 && await tg.evaluate(() => Colony.selected().every(u => u.task.k === 'idle')), `📱 палец по пустому в 👥 → пан ${(tc1 - tc0).toFixed(1)} px (${tst}), приказа нет${why2}`);
      // рамка долгим нажатием
      await tfix(); await tsettle();
      const TB = await tg.evaluate(() => G.col.units.map(u => GFX.worldToScreen(u.x, u.y - 14)));
      const x0 = Math.min(...TB.map(s => s.x)) - 30, y0 = Math.min(...TB.map(s => s.y)) - 30, x1 = Math.max(...TB.map(s => s.x)) + 30, y1 = Math.max(...TB.map(s => s.y)) + 30;
      await cdp.send('Input.dispatchTouchEvent', TS(W.T1(x0, y0)));
      const lp = await W.until(tg, () => Input.debug().st === 'BOX'); // таймер 400 мс — ждём сам переход, не 500 мс
      const bm = []; for (let k = 1; k <= 5; k++) bm.push(TM(W.T1(x0 + (x1 - x0) * k / 5, y0 + (y1 - y0) * k / 5)));
      await W.touchBurst(cdp, bm);
      await W.until(tg, ([x, y]) => { const p = Input.debug().press; return !!p && Math.abs(p.x1 - x) < 1 && Math.abs(p.y1 - y) < 1; }, [x1, y1]);
      const tbx = await tg.evaluate(() => Input.debug().st);
      await W.input(tg, 1, () => cdp.send('Input.dispatchTouchEvent', TE));
      const tsel = await tg.evaluate(() => G.col.sel.length);
      ok(lp && tbx === 'BOX' && tsel === 3, `📱 долгое нажатие 400 мс → рамка пальцем (${tbx}, выделено ${tsel})`);
      // тап мимо панели → закрыть
      await tg.evaluate(() => UI.openCraft('build')); await W.frames(tg, 2);
      const outside = await tg.evaluate(() => { const r = document.getElementById('panel').getBoundingClientRect(); for (const [x, y] of [[innerWidth / 2, 40], [innerWidth / 2, r.top - 20], [innerWidth / 2, r.bottom + 20]]) { const e = document.elementFromPoint(x, y); if (e && e.id === 'game') return { x, y }; } return null; });
      if (outside) await W.input(tg, 1, () => tg.touchscreen.tap(outside.x, outside.y));
      ok(!!outside && await tg.evaluate(() => !UI.modal()), `📱 тап мимо панели → закрыть${outside ? '' : ' (нет свободной точки)'}`);
      // щипок
      await tg.evaluate(() => { GFX.setZoom(1); GFX.recenter(); G.col.sel = []; });
      const zz0 = await tg.evaluate(() => GFX.zoom), cx0 = vp.width * 0.68, cy0 = vp.height * 0.3;
      const pts = k => [W.T1(cx0, cy0 - 20 - k, 1), W.T1(cx0, cy0 + 20 + k, 2)];
      const pm = [TS(...pts(0))]; for (let k = 10; k <= 80; k += 10) pm.push(TM(...pts(k)));
      await W.input(tg, 2, () => W.touchBurst(cdp, [...pm, TE]));
      ok(await W.until(tg, z => GFX.zoom > z * 1.3 && !G.col.sel.length, zz0), '📱 щипок → зум, без выделения');
      await ctx.close();
    }
  } catch (e) { fail.push('исключение'); log.push('FAIL исключение: ' + (e && e.stack || e)); }
  finally { closing = true; await b.close().catch(() => {}); }
  for (const e of errs) { log.push(e); fail.push(e); }
  console.log(log.join('\n'));
  console.log(fail.length ? `ERR input: ${fail.length} проверок не прошло` : `input: все ${log.length} проверок прошли`);
  process.exitCode = fail.length ? 1 : 0;
})();
