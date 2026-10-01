// Валка, разделка и подбор (js/actions.js, рендер js/gfx.js drawFelled): проверки по шагам мира, без глаз.
//   1. падение 0.8–1.4 с, у разных деревьев разное; надлом ≥ 0.3 с до падения
//   2. ствол — преграда только после удара о землю
//   3. урон — только тому, кто под стволом, в момент удара, не раньше 0.6 с после «Па-адает!»; отскок уводит из-под ствола
//   4. рубка только у ствола: с любой точки рядом герой сам подходит к боковой точке (|dx| = chopDX ± 5, |dy| ≤ 7), из-за дерева — нет
//   5. обрубка постепенная (крона по третям, лапник на снегу), чурки — по одной за жест, чурка уходит с земли не раньше касания рукой
//   6. остаток ствола жив после разделки и заметается за 0.5–1 сутки; старые стволы сверх 8 — заметаются, не исчезают
//   7. сейв/загрузка посреди обрубки — состояние ствола то же
// В браузере: (0,eval)(await (await fetch('tests/tree-check.js')).text()); TreeCheck.run()
// Playwright: cd tests && node tree-check.js
var TreeCheck = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60;
  const P = () => G.p;
  function frame(n = 1, render) {
    for (let i = 0; i < n; i++) { if (!input.auto) { input.mx = 0; input.my = 0; } G.wolves = []; G.bear = null; G.hares = []; G.deer = []; update(DT); now += DT; if (render) { GFX.lookAt(P().x, P().y); GFX.render(DT, null); } }
  }
  // дерево поодаль от всего: свободно вокруг (вдоль x и y — по 170 px)
  function pickTree(i = 0) {
    const ok = t => t.wood > 0 && !t.wall && t.stage !== 1 && t.kind === 0 && !onIce(t.x, t.y) && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 400 && Zones.terrainKey(t.x, t.y) !== 'golets'   // на гольце ветер сносит стоящего
      && !G.trees.some(q => q !== t && q.wood > 0 && Math.abs(q.x - t.x) < 190 && Math.abs(q.y - t.y) < 110);
    const c = G.trees.filter(ok); return c[(i * 7) % c.length];
  }
  function base() {
    const p = P(); UI.closePanel(); p.ride = null; p.sleeping = false; p.action = null; p.cd = 0; p.dash = null; p.dashCd = 0; G.hurt = 0; input.act = false; input.auto = 0;
    if (G.col) for (const u of G.col.units) u.hidden = true; G.hares = []; G.deer = [];   // без толкотни (лайка, зайцы): герой стоит, где поставили
    G.s.hp = G.s.food = G.s.warm = 100; G.logs = []; G.chunks = []; G.lap = []; G.inv.wood = 0; Hero.bodyReset();
  }
  function fellIt(t) {
    const p = P(); t.wood = 1;
    const q = Actions.chopSpot(t); p.x = q.x; p.y = q.y; Hero.snap(); Actions.interact();
    let n = 0; while (t.wood > 0 && n++ < 400) frame();
    return G.logs[G.logs.length - 1];
  }
  function run(o = {}) {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast }, fails = [], info = {};
    SaveGame.checkpoint = () => {}; Math.random = mulberry(o.seed || 11); const toasts = []; Fx.toast = t => toasts.push(t);
    const ok = (c, m) => { if (!c) fails.push(m); };
    try {
      newGame(); state = 'play'; G.time = tAt(1, 13); Hero.bodyReset();
      // ---- 1, 2: длительность, различие, преграда ----
      const Ts = [];
      for (let i = 0; i < 5; i++) {
        base(); const t = pickTree(i), L = fellIt(t);
        if (!L || !L.f) { fails.push('1: дерево ' + i + ' не повалилось'); continue; }
        const w = L.f.w, T = L.f.T; let el = 0, hitAt = null, solidBefore = false, solidAfter = false;
        const m0 = Actions.logEnd(L, 0.5), nl = Math.hypot(Math.sin(L.a) * 0.6, Math.cos(L.a)) || 1, mid = { x: m0.x - Math.sin(L.a) * 0.6 / nl * 3, y: m0.y + Math.cos(L.a) / nl * 3 };   // в 3 px от оси
        ok(t.shake > 0, '1: надлом без качания (World.shakeTree)');
        while (L.f && el < 5) { const was = L.f.hit; frame(); el += DT; if (!was && L.f && L.f.hit) hitAt = el; if (L.f && !L.f.hit && World.blocked(mid.x, mid.y, 2)) solidBefore = true; }
        solidAfter = World.blocked(mid.x, mid.y, 2);
        Ts.push(T); ok(T >= 0.8 && T <= 1.4, `1: падение ${T} с вне 0.8–1.4`); ok(w >= 0.3 && w <= 0.6, `1: надлом ${w} с вне 0.3–0.6`);
        ok(hitAt != null && Math.abs(hitAt - (w + T)) < 2.5 * DT, `1: удар в ${hitAt}, ждали ${(w + T).toFixed(2)}`);
        ok(!solidBefore, '2: ствол — преграда до удара о землю'); ok(solidAfter, '2: лежачий ствол — не преграда');
      }
      info.falls = Ts; ok(new Set(Ts.map(v => v.toFixed(2))).size >= 3, '1: падения одинаковые: ' + Ts.join(','));
      // поза: медленный старт (маятник) — за первую треть падения угол < трети
      const fp = GFX.fallPose({ w: 0.4, T: 1 }, 0.4 + 0.33);
      ok(fp.th < Math.PI / 6, '1: старт падения не медленный (θ на 1/3 = ' + fp.th.toFixed(2) + ')');
      // ---- 3: урон ----
      const dmgCase = (place, dodge) => {
        base(); const t = pickTree(1), L = fellIt(t), p = P();
        L.a = place === 'under' ? Math.atan2(p.y - t.y, p.x - t.x) : L.a;   // ствол — на героя
        const hp0 = G.s.hp; let el = 0, hurtAt = null;
        if (dodge) { frame(Math.round(0.3 / DT)); el += 0.3; const d = Actions.danger(p); ok(!!d, '3: угроза не видна (Actions.danger) ' + JSON.stringify([p.x - t.x, p.y - t.y, t.s, World.trunkR(t)])); Hero.dodge(); }
        while (L.f && el < 4) { frame(); el += DT; if (hurtAt == null && G.s.hp < hp0) hurtAt = el; }
        return { hit: G.s.hp < hp0, at: hurtAt, need: L.f ? 0 : null, dmg: hp0 - G.s.hp, wT: 0 };
      };
      const u = dmgCase('under'), a = dmgCase('away'), d = dmgCase('under', true);
      ok(u.hit, '3: под стволом — без урона'); ok(u.at != null && u.at >= 0.6, '3: урон раньше 0.6 с после «Па-адает!»: ' + u.at);
      ok(Math.abs(u.dmg - Actions.FELL.dmg) < 0.5, '3: урон не ' + Actions.FELL.dmg + ': ' + u.dmg);
      ok(!a.hit, '3: ствол упал от героя, а урон есть'); ok(!d.hit, '3: отскок не увёл из-под ствола');
      info.dmg = { under: u, away: a.hit, dodged: d.hit };
      // ---- 4: рубка только у ствола ----
      const pos = [[55, 5], [40, 5], [30, 3], [12, 3], [0, -40], [0, 30], [-50, -20], [30, 35], [-20, 12]];
      info.reach = [];
      for (const [dx, dy] of pos) {
        base(); const t = pickTree(2), p = P(); t.wood = 9; p.x = t.x + dx; p.y = t.y + dy; p.face = dx > 0 ? -1 : 1; World.solid(p, 10, 'p'); Hero.snap();
        const c = Actions.context(); if (!c || c.k !== 'tree') { info.reach.push([dx, dy, 'нет «Рубить»']); continue; }
        Actions.interact(); let n = 0; while (!(p.action && p.action.k === 'chop') && n++ < 300) frame();
        const ax = Math.abs(p.x - t.x), ay = p.y - t.y, D = World.trunkR(t) + 10.5;
        info.reach.push([dx, dy, +(p.x - t.x).toFixed(1), +ay.toFixed(1)]);
        ok(p.action && p.action.k === 'chop', `4: с (${dx},${dy}) так и не начал рубить`);
        ok(Math.abs(ax - D) <= 5 && Math.abs(ay - 3) <= 7, `4: рубит с (${(p.x - t.x).toFixed(1)},${ay.toFixed(1)}), не у ствола`);
        ok(Math.sign(t.x - p.x) === p.face, `4: рубит спиной к стволу`);
      }
      { base(); const t = pickTree(2), p = P(); p.x = t.x; p.y = t.y - 30; Hero.snap(); ok(!Actions.atTrunk(t), '4: «за деревом» считается «у ствола»'); }
      // ---- 5: обрубка, разделка, подбор ----
      base(); { const t = pickTree(3), L = fellIt(t); { let k = 0; while (L.f && k++ < 300) frame(); } frame(10); const p = P();
        const cuts = [], n0 = L.n0; let g = 0;
        while (Actions.logCut(L) < 1 && g++ < 12) { Actions.interact(); let k = 0; while ((p.action || input.auto) && k++ < 400) frame(); cuts.push(+Actions.logCut(L).toFixed(2)); }
        info.cuts = cuts; ok(cuts.length === 3 && cuts[0] > 0.3 && cuts[0] < 0.4 && cuts[1] > 0.6 && cuts[1] < 0.7 && cuts[2] === 1, '5: обрубка не по третям: ' + cuts);
        ok((G.lap || []).length >= 4, '5: лапника на снегу нет: ' + (G.lap || []).length);
        ok(L.n === n0 - 1 && G.chunks.length >= 1, '5: последний удар обрубки не отрезал верхушку чуркой');
        // сейв посреди: копия, загрузка, сверка ствола
        const snap = SaveGame.snapshot(); SaveGame.load(snap); const L2 = G.logs.find(q => q.id === L.id);
        ok(L2 && Actions.logCut(L2) === Actions.logCut(L) && L2.n === L.n, '7: после загрузки ствол другой');
        GFX.render(DT, null);
        // разделка до конца: остаток ствола жив
        const Lx = L2; g = 0;
        while (Lx.n > 0 && g++ < 30) { Actions.interact(); let k = 0; while ((G.p.action || input.auto) && k++ < 400) frame(); }
        ok(Lx.n === 0 && G.logs.includes(Lx) && Lx.done != null, '6: после разделки остаток ствола исчез: n=' + Lx.n + ' в списке ' + G.logs.includes(Lx) + ' done ' + Lx.done + ' g ' + g);
        const nCh = G.chunks.length + (G.inv.wood || 0); info.chunks = nCh; ok(nCh >= Lx.n0 && nCh <= Lx.n0 * 2, `6: чурок ${nCh}, ждали ${Lx.n0}`);
        const t0 = G.time; G.time = t0 + CYCLE * 0.45; frame(); ok(G.logs.includes(Lx), '6: остаток исчез раньше 0.5 суток');
        G.time = t0 + CYCLE * 1.0; frame(); ok(!G.logs.includes(Lx), '6: остаток не заметён за сутки');
        // подбор по одной
        base(); G.time = tAt(G.day + 1, 13); frame(); const p2 = G.p; G.chunks.length = 0; G.inv.wood = 0;
        for (let i = 0; i < 3; i++) G.chunks.push({ x: p2.x + 14 + i * 5, y: p2.y + 2, a: 0, t: G.time - 10 });
        const c0 = G.chunks.slice(); Actions.interact(); const A0 = p2.action; let gone = null, k = 0;
        while (p2.action === A0 && A0 && k++ < 200) { const was = G.chunks.length; frame(); if (G.chunks.length < was && gone == null) gone = A0.t / A0.dur; }
        ok(G.chunks.length === 2 && G.inv.wood === 1, '5: за жест взято не по одной: осталось ' + G.chunks.length + ', дров ' + G.inv.wood);
        ok(gone != null && gone >= 0.34 - 1e-6, '5: чурка ушла с земли раньше касания: ' + gone);
        info.grab = gone;
        // удержание E — собирает кучу
        input.act = true; k = 0; while (G.chunks.length && k++ < 600) { frame(); } input.act = false;
        ok(!G.chunks.length && G.inv.wood === 3, '5: удержание E не собрало кучу: ' + G.chunks.length);
      }
      // ---- 6б: старые стволы сверх 8 — заметаются, не исчезают ----
      base(); { for (let i = 0; i < 10; i++) { const t = pickTree(4 + i); if (!t) break; const L = fellIt(t); let k = 0; while (L.f && k++ < 400) frame(); }
        const n = G.logs.length, bur = G.logs.filter(L => L.bury != null).length; info.logs = [n, bur];
        ok(n >= 9 && bur >= 1, `6: старые стволы исчезли сразу (стволов ${n}, заметаются ${bur})`); }
    } catch (e) { fails.push('исключение: ' + e.message + ' ' + (e.stack || '').split('\n')[1]); }
    finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; Fx.toast = keep.toast; input.act = false; input.mx = input.my = 0; }
    const res = { fails: fails.length, list: fails, info };
    console.log('TreeCheck', JSON.stringify(res));
    return res;
  }
  return { run, pickTree };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
  (async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(800);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      const r = await pg.evaluate(() => TreeCheck.run());
      console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log(errs.join('\n'));
      process.exitCode = r.fails || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
