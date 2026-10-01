// Валка, разделка и подбор (js/actions.js, рендер js/gfx.js drawFelled): проверки по шагам мира, без глаз.
//   1. падение 0.8–1.4 с, у разных деревьев разное; надлом ≥ 0.3 с до падения
//   2. ствол — преграда только после удара о землю
//   3. урон — только тому, кто под стволом, в момент удара, не раньше 0.6 с после «Па-адает!»; отскок уводит из-под ствола
//   4. рубка только у ствола: с любой точки рядом герой сам подходит к боковой точке (|dx| = chopDX ± 5, |dy| ≤ 7), из-за дерева — нет
//   5. обрубка по третям (ветви — части-лапник на снегу), вершина — частью; масса и объём: ствол + части + подобранное = целое (±1 %)
//      каждую часть-дрова (и последнюю, и комель) можно взять; дрова по массе (Tree.KG кг = 1); по одной за жест, после касания рукой
//   6. раскряжёвка: весь ствол уходит в чурки 0.35–0.62 м и комель; со временем части не исчезают; старые стволы сверх 8 — заметаются
//   8. дерево на тонком льду переката пробивает лёд (ствол проваливается), на толстом — нет; герой рядом на льду — в воду
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
    G.s.hp = G.s.food = G.s.warm = 100; G.logs = []; G.chunks = []; G.lap = []; G.inv.wood = 0; G.hand = { p: [], t: null }; Hero.bodyReset();
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
      // ---- 5: обрубка, разделка, подбор (объёмная модель js/tree3d.js: части — объекты мира в G.chunks) ----
      base(); { const t = pickTree(3), L = fellIt(t); { let k = 0; while (L.f && k++ < 300) frame(); } frame(10); const p = P();
        const m0 = L.m0, v0 = Tree.whole(L).vol, n0 = L.n0, src = q => q.src === L.id;
        // сумма: что ещё на стволе + что отделено + что подобрано = целое (±1 %)
        // подобранное — тоже в сумме: части в руках (ноша, js/carry.js) — те же объекты с src
        const inHand = () => Carry.parts().filter(src);
        const sum = () => { const on = G.logs.includes(L) ? Tree.parts(L) : []; let m = 0, v = 0; for (const q of on.concat(inHand())) { m += q.mass; v += q.vol; } for (const q of G.chunks) if (src(q)) { m += q.mass; v += q.vol; } return { m, v }; };
        const keep = (what) => { const s2 = sum(); ok(Math.abs(s2.m - m0) / m0 < 0.01 && Math.abs(s2.v - v0) / v0 < 0.01, `5: ${what}: масса ${s2.m.toFixed(2)} из ${m0.toFixed(2)}, объём ${s2.v.toFixed(4)} из ${v0.toFixed(4)}`); };
        keep('целое сразу после валки');
        info.tree = { m0: +m0.toFixed(1), H: +(Tree.of(L).S.H * L.k).toFixed(2), D: +(Tree.of(L).S.R0 * 2 * L.k).toFixed(3), n0, cl: +(L.cl * L.k).toFixed(3) };
        const cuts = []; let g = 0;
        while (Actions.logCut(L) < 1 && g++ < 12) { Actions.interact(); let k = 0; while ((p.action || input.auto) && k++ < 400) frame(); cuts.push(+Actions.logCut(L).toFixed(2)); keep('обрубка ' + cuts.length); }
        info.cuts = cuts; ok(cuts.length === 3 && cuts[0] > 0.3 && cuts[0] < 0.4 && cuts[1] > 0.6 && cuts[1] < 0.7 && cuts[2] === 1, '5: обрубка не по третям: ' + cuts);
        const bo = G.chunks.filter(q => src(q) && (q.kind === 'bough' || q.kind === 'branch')).length; info.boughs = bo; ok(bo >= 8, '5: лапника (ветвей) на снегу мало: ' + bo);
        ok(L.top === 1 && G.chunks.some(q => src(q) && q.kind === 'top') && L.n === n0, '5: обрубка не отрезала вершину частью: top ' + L.top + ' n ' + L.n + '/' + n0);
        // сейв посреди: копия, загрузка, сверка ствола и частей
        const snap = SaveGame.snapshot(); SaveGame.load(snap); const L2 = G.logs.find(q => q.id === L.id);
        ok(L2 && Actions.logCut(L2) === Actions.logCut(L) && L2.n === L.n && L2.zTop === L.zTop, '7: после загрузки ствол другой');
        ok(G.chunks.filter(src).length === bo + 1, '7: после загрузки частей другое число: ' + G.chunks.filter(src).length);
        GFX.render(DT, null);
        // раскряжёвка до конца: ствол весь уходит в части (комель — тоже часть), сумма не меняется
        const Lx = L2; g = 0; const sumX = () => { const on = G.logs.includes(Lx) ? Tree.parts(Lx) : []; let m = 0; for (const q of on.concat(Carry.parts().filter(q => q.src === Lx.id))) m += q.mass; for (const q of G.chunks) if (q.src === Lx.id) m += q.mass; return m; };
        while (G.logs.includes(Lx) && Lx.n > 0 && g++ < 40) { Actions.interact(); let k = 0; while ((G.p.action || input.auto) && k++ < 400) frame(); ok(Math.abs(sumX() - m0) / m0 < 0.01, '6: раскряжёвка ' + g + ': масса ' + sumX().toFixed(2) + ' из ' + m0.toFixed(2)); }
        G.chunks.push(...Carry.parts().splice(0));   // подобранные по ходу — обратно на снег (дальше проверяем подбор каждой)
        const wood = G.chunks.filter(q => q.src === Lx.id && Tree.isWood(q));
        ok(!G.logs.includes(Lx) && Lx.n === 0, '6: после разделки ствол не ушёл в части: n=' + Lx.n);
        ok(wood.length === n0 + 1 && wood.filter(q => q.kind === 'butt').length === 1, `6: частей-дров ${wood.length}, ждали ${n0 + 1} (чурки + комель + вершина)`);
        const lens = wood.filter(q => q.kind !== 'top').map(q => q.len); info.lens = [Math.min(...lens), Math.max(...lens)];
        ok(lens.every(l => l >= 0.35 && l <= 0.62), '6: длина чурок вне 0.35–0.62 м: ' + lens);
        // ни одна часть не исчезает без действия: полсуток и сутки — дрова на месте, масса та же
        const mW = wood.reduce((a, q) => a + q.mass, 0); G.time += CYCLE * 0.5; frame(); G.time += CYCLE * 0.6; frame(); GFX.render(DT, null);
        const wood2 = G.chunks.filter(q => q.src === Lx.id && Tree.isWood(q)); ok(wood2.length === wood.length && Math.abs(wood2.reduce((a, q) => a + q.mass, 0) - mW) < 1e-6, '6: дрова исчезли со временем: ' + wood2.length);
        // последнюю чурку (и каждую) можно взять: подходим к каждой — подсказка «Взять», жест кладёт дрова по массе
        G.inv.wood = 0; let got = 0, miss = [], gotKg = 0;
        for (const q of wood2.slice().sort((a, b) => a.y - b.y)) {
          if (!G.chunks.includes(q)) { got++; continue; }   // взята раньше — жест берёт ближайшую
          const pp = G.p; pp.action = null; input.auto = 0; pp.x = q.x + 16; pp.y = q.y + 3; World.solid(pp, 10, 'p'); Hero.snap(); frame(2);
          const c = Actions.context(); if (!c || c.k !== 'chunks') { miss.push(q.kind + (c ? ':' + c.k : ':нет') + ' d' + Math.round(Math.hypot(pp.x - q.x, pp.y - q.y))); continue; }
          // охапку — на нарты (вне проверки) после каждого жеста: руки свободны для следующей
          let k = 0; while (G.chunks.includes(q) && k++ < 20) { Actions.interact(); let j = 0; while ((pp.action || input.auto) && j++ < 300) frame(); for (const h of Carry.parts().splice(0)) gotKg += h.mass; }
          if (!G.chunks.includes(q)) got++;
        }
        ok(!miss.length, '5: нет подсказки «Взять» у частей: ' + miss.join(','));
        ok(got === wood2.length, `5: взято ${got} из ${wood2.length} (последняя не берётся?)`);
        info.woodPerTree = { kg: +mW.toFixed(1), pieces: wood2.length, got: +gotKg.toFixed(2) };
        ok(Math.abs(gotKg - mW) < 1e-6, `5: в руки пришло ${gotKg.toFixed(2)} кг из ${mW.toFixed(2)} (каждая чурка — своей массой)`);
        // подбор по одной: чурка уходит с земли не раньше касания рукой; удержание E — собирает кучу
        base(); G.time = tAt(G.day + 1, 13); frame(); const p2 = G.p; G.chunks.length = 0; G.inv.wood = 0; Carry.hand().p = []; Carry.hand().t = null;
        for (let i = 0; i < 3; i++) G.chunks.push({ kind: 'chunk', mass: Tree.KG, vol: 0.006, len: 0.45, diam: 0.15, x: p2.x + 14 + i * 5, y: p2.y + 2, a: 0, t: G.time - 10 });
        Actions.interact(); const A0 = p2.action; let gone = null, k = 0;
        while (p2.action === A0 && A0 && k++ < 200) { const was = G.chunks.length; frame(); if (G.chunks.length < was && gone == null) gone = A0.t / A0.dur; }
        ok(G.chunks.length === 2 && Carry.parts().length === 1, '5: за жест взято не по одной: осталось ' + G.chunks.length + ', в руках ' + Carry.parts().length);
        ok(gone != null && gone >= 0.34 - 1e-6, '5: чурка ушла с земли раньше касания: ' + gone);
        info.grab = gone;
        input.act = true; k = 0; while (G.chunks.length && k++ < 600) { frame(); } input.act = false;
        ok(!G.chunks.length && Carry.parts().length === 3, '5: удержание E не собрало охапку: на снегу ' + G.chunks.length + ', в руках ' + Carry.parts().length);
      }
      // ---- 8: дерево × лёд: у переката (тонкий лёд) — пролом, ствол проваливается, герой рядом на льду — в воду; на толстом — цел ----
      { const Pn = POI.polynya;
        const onto = (tx, ty, hx, hy, ang) => { base(); const t = pickTree(5), ox = t.x, oy = t.y; t.x = tx; t.y = ty;
          const L = Actions.fell(t); L.a = ang != null ? ang : Math.atan2(Pn.y + 4 - ty, Pn.x + 10 - tx); L.f.risk = 0; if (hx != null) { G.p.x = hx; G.p.y = hy; Hero.snap(); }
          const h0 = (G.iceHoles || []).length; let k = 0; while (L.f && !L.f.hit && k++ < 400) { L.f.t += DT; if (L.f.t >= L.f.w + L.f.T) { L.f.hit = 1; Actions.iceHit(L); } }
          t.x = ox; t.y = oy; delete L.f; return { L, holes: (G.iceHoles || []).length - h0 }; };
        const bx = riverX(Pn.y) - RW - 30;
        const a = onto(bx, Pn.y + 4, null);   // с берега на перекат
        ok(a.holes > 0 && a.L.sink, '8: ель на тонком льду переката не пробила лёд: ' + JSON.stringify({ r: a.L.iceR, sink: a.L.sink, len: a.L.len }));
        const fy = Pn.y + 900, far = onto(riverX(fy) - RW - 30, fy, null, null, 0);   // далеко от переката — поперёк реки на лёд ~0.4 м
        ok(!far.holes && !far.L.sink && far.L.iceR > 0, '8: на толстом льду пролом (или ствол не лёг на лёд): ' + far.L.iceR);
        info.ice = { farA: far.L.a, farLen: far.L.len, farX: far.L.x - riverX(far.L.y), thin: a.L.iceR, thick: far.L.iceR, hThin: +Ice.thick(Pn.x - 20, Pn.y).toFixed(3), hFar: +Ice.thick(riverX(fy), fy).toFixed(3) };
        const h = (G.iceHoles || [])[G.iceHoles.length - 1]; Ice.reset && Ice.reset(); G.iceHoles = [];
        const c = onto(bx, Pn.y + 4, Pn.x - 4, Pn.y + 2); ok(Ice.active(), '8: герой на льду у пролома не провалился'); Ice.reset(); void h; void c;
        G.iceHoles = []; G.p.wetT = 0; }
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
