// Рубка, валка, разделка и подбор (js/actions.js, модель js/tree3d.js, поза валки js/gfx.js fallPose): проверки по шагам мира, без глаз.
//   1. падение — по физике стержня на шарнире θ'' = (3g/2L)·sin θ (±10 % от своей аналитики), у разных деревьев разное (выше — дольше);
//      треск недоруба ≥ 0.5 с; недоруб держит до ~70° (комель на пне), потом комель съезжает 0.2–0.5 м и подпрыгивает 0.1–0.3 м;
//      перекат ≤ 0.6 рад — в сейв (L.roll); ось — на передней кромке недоруба; соседи вздрагивают; герой сам отходит под ~45° назад
//   2. ствол — преграда только после удара о землю
//   3. урон — только тому, кто под стволом, в момент удара, не раньше 0.6 с после треска; отскок уводит из-под ствола
//   4. рубка только у ствола: герой сам встаёт к стволу (по кругу, не прямо за/перед ним), лицом к стволу; из-за дерева — нет
//   10. рубка по-настоящему: ударов — по толщине (6…16, средняя ~12); подруб (~60 % ударов) — со стороны падения, задний рез —
//      с обратной, герой его обходит; недоруб ≈ 10 % Ø; направление — как задумано; перерубил недоруб — валится не туда (риск)
//   11. площадка: снег у ствола выше колена — сперва вытоптать (5–10 с, обход, силы), потом рубка на утоптанном
//   5. обрубка — по мутовке от комля; ветви своей стороны и подмятые не рубятся (перейти/перекатить); масса: ствол + части + в руках = целое
//      каждую часть-дрова можно взять; по одной за жест, после касания рукой
//   12. перекат 2–3 с, 60–120°, подмятые после него рубятся; лежащая ветвь: середина 10–25 см, кончик ≤ 0, побеги над снегом ≥ 30 %
//   13. лапник — в кучу: масса кучи = сумма ветвей; кучу — охапкой в руки
//   6. раскряжёвка: весь ствол уходит в чурки 0.35–0.62 м и комель; со временем части не исчезают; старые стволы сверх 8 — заметаются
//   7. сейв/загрузка: посреди рубки (t.cut), посреди обрубки и после переката — состояние то же
//   8. дерево на тонком льду переката пробивает лёд (ствол проваливается), на толстом — нет; герой рядом на льду — в воду
//   9. где ложатся части: ветвь — у места крепления, к вершине (не «звездой»), чурка — у места реза; разлёт у разных деревьев/сторон разный
// В браузере: (0,eval)(await (await fetch('tests/tree-check.js')).text()); TreeCheck.run()
// Playwright: cd tests && node tree-check.js
var TreeCheck = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60;
  const P = () => G.p;
  function frame(n = 1, render) {
    for (let i = 0; i < n; i++) { if (!input.auto) { input.mx = 0; input.my = 0; } G.wolves = []; G.bear = null; G.hares = []; G.deer = []; update(DT); now += DT; if (render) { GFX.lookAt(P().x, P().y); GFX.render(DT, null); } }
  }
  // дерево поодаль от всего: свободно вокруг (вдоль x и y — по 190/110 px)
  function pickTree(i = 0, f) {
    const ok = t => t.wood > 0 && !t.wall && t.stage !== 1 && t.kind === 0 && !onIce(t.x, t.y) && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 400 && Zones.terrainKey(t.x, t.y) !== 'golets'   // на гольце ветер сносит стоящего
      && !G.trees.some(q => q !== t && q.wood > 0 && Math.abs(q.x - t.x) < 190 && Math.abs(q.y - t.y) < 110) && (!f || f(t));
    const c = G.trees.filter(ok); return c[(i * 7) % c.length];
  }
  function base() {
    const p = P(); UI.closePanel(); p.ride = null; p.sleeping = false; p.action = null; p.cd = 0; p.dash = null; p.dashCd = 0; G.hurt = 0; input.act = false; input.auto = 0; delete p.overL;
    if (G.col) for (const u of G.col.units) u.hidden = true; G.hares = []; G.deer = [];   // без толкотни (лайка, зайцы): герой стоит, где поставили
    G.s.hp = G.s.food = G.s.warm = 100; G.s.tire = 0; G.logs = []; G.chunks = []; G.lap = []; G.inv.wood = 0; G.hand = { p: [], t: null }; Hero.bodyReset();
  }
  // почти дорублено: подруб готов, задний рез — до последнего удара (как после N−1 ударов)
  function nearDone(t, d) { return Actions.prepCut(t, d); }
  // последний удар: герой у своей точки (задний рез), E — удар в касание топора, ель повалилась
  // площадка уже утоптана (проверка площадки — отдельно, §11)
  function tramp(t) { for (let k = 0; k < 6; k++) for (let i = 0; i < 12; i++) { const f = i / 12 * Math.PI * 2; Trail.stamp(t.x + Math.cos(f) * 26, t.y + 3 + Math.sin(f) * 18, { a: 0.9, r: 16 }); } }
  function fellIt(t, d) {
    const p = P(); nearDone(t, d); tramp(t);
    const q = Actions.chopSpot(t); p.x = q.x; p.y = q.y; Hero.snap(); Actions.interact();
    let n = 0; while (t.wood > 0 && n++ < 900) frame();
    return G.logs[G.logs.length - 1];
  }
  // падение стержня на шарнире: θ0 = 0.08 рад (недоруб отпустил), ω0 = 0 → π/2; L — высота над резом (м)
  function fallT(L) { let th = 0.08, w = 0, t = 0; const dt = 1e-4, k = 3 * 9.81 / (2 * L); while (th < Math.PI / 2) { w += k * Math.sin(th) * dt; th += w * dt; t += dt; } return t; }
  const sideOf = (L, q) => ((q.x - L.x) * -Math.sin(L.a) + (q.y - L.y) / 0.6 * Math.cos(L.a) >= 0 ? 1 : -1);
  function run(o = {}) {
    const keep = { cp: SaveGame.checkpoint, rnd: Math.random, toast: Fx.toast }, fails = [], info = {};
    SaveGame.checkpoint = () => {}; Math.random = mulberry(o.seed || 11); const toasts = []; Fx.toast = t => toasts.push(t);
    const ok = (c, m) => { if (!c) fails.push(m); };
    const HITS = []; Interact.on('hit', e => { if (e.who === 'p') HITS.push({ x: e.x, y: e.y, t: e.target, back: e.back, dir: e.dir }); });
    try {
      newGame(); state = 'play'; G.time = tAt(1, 13); Hero.bodyReset();
      // ---- 1, 2: падение по физике, преграда ----
      const Ts = [];
      for (let i = 0; i < 5; i++) {
        base(); const t = pickTree(i), H = Tree.of(t).S.H * Tree.of(t).k - Tree.HC, L = fellIt(t);
        if (!L || !L.f) { fails.push('1: дерево ' + i + ' не повалилось'); continue; }
        const f = L.f, w = f.w, T = f.T, Ta = fallT(H); let el = 0, hitAt = null, solidBefore = false, solidAfter = false, slideBefore = 0, maxBz = 0, nb = null;
        const m0 = Actions.logEnd(L, 0.5), nl = Math.hypot(Math.sin(L.a) * 0.6, Math.cos(L.a)) || 1, mid = { x: m0.x - Math.sin(L.a) * 0.6 / nl * 3, y: m0.y + Math.cos(L.a) / nl * 3 };   // в 3 px от оси
        ok(t.shake > 0, '1: треск без качания (World.shakeTree)');
        ok(Math.abs(f.H - H) < 0.05, `1: высота в падении ${f.H} м, у дерева ${H.toFixed(2)} м`);
        const d0 = Math.hypot(P().x - L.cx, (P().y - L.cy) / 0.6) / Tree.M, p0 = { x: P().x, y: P().y };
        // соседняя ель в длину ствола — должна вздрогнуть при ударе
        nb = G.trees.find(q => q !== t && q.wood > 0 && !q.wall && Math.hypot(q.x - (L.x + m0.x) / 2, q.y - (L.y + m0.y) / 2) < L.len * 0.6 + 20) || null; if (nb) nb.shake = 0;
        while (L.f && el < 6) {
          const was = L.f.hit; frame(); el += DT; const P_ = L.f ? GFX.fallPose(L.f, L.f.t) : null;
          if (P_ && P_.th < 1.15) slideBefore = Math.max(slideBefore, P_.sl || 0); if (P_) maxBz = Math.max(maxBz, P_.bz || 0);
          if (!was && L.f && L.f.hit) hitAt = el; if (L.f && !L.f.hit && World.blocked(mid.x, mid.y, 2)) solidBefore = true;
        }
        solidAfter = World.blocked(mid.x, mid.y, 2);
        Ts.push({ H: +H.toFixed(2), T: +T.toFixed(2), Ta: +Ta.toFixed(2) });
        ok(Math.abs(T - Ta) / Ta < 0.1, `1: падение ${T.toFixed(2)} с, по физике ${Ta.toFixed(2)} с (H ${H.toFixed(2)} м)`);
        ok(T >= 1.6 && T <= 2.9, `1: падение ${T.toFixed(2)} с — не как у ели ${H.toFixed(1)} м (1.8–2.8 с)`);
        ok(w >= 0.5 && w <= 0.85, `1: треск недоруба ${w} с вне 0.5–0.85`);
        ok(hitAt != null && Math.abs(hitAt - (w + T)) < 2.5 * DT, `1: удар в ${hitAt}, ждали ${(w + T).toFixed(2)}`);
        ok(slideBefore < 1e-6, '1: комель съехал раньше ~70° (недоруб не держит): ' + slideBefore);
        ok(Math.abs(f.s) >= 0.2 && Math.abs(f.s) <= 0.5 && maxBz >= 0.1 - 1e-6 && maxBz <= 0.3 + 1e-6, `1: комель съехал ${f.s} м / подпрыгнул ${maxBz.toFixed(2)} м (0.2–0.5 / 0.1–0.3)`);
        const shift = ((L.x - L.cx) * Math.cos(L.a) + (L.y - L.cy) / 0.6 * Math.sin(L.a)) / Tree.M;
        ok(Math.abs(shift - (f.c + f.s)) < 0.08, `1: комель лёг в ${shift.toFixed(2)} м от пня, ждали кромка ${f.c} + съезд ${f.s}`);
        ok(f.c > 0.01 && f.c < Tree.of(t).S.R0 * Tree.of(t).k, '1: ось не на кромке недоруба: ' + f.c);
        ok(L.roll != null && Math.abs(L.roll) <= 0.6 + 1e-6 && Math.abs(L.roll - f.r) < 1e-6, '1: перекат не в стволе (L.roll) или > 0.6: ' + L.roll);
        if (nb) ok(nb.shake > 0, '1: соседняя ель не вздрогнула от удара ствола');
        // отошёл сам: 1.2+ м от пня, назад-вбок (между «назад» и «вбок»: 20–70° от линии падения назад)
        const p1 = P(), d1 = Math.hypot(p1.x - L.cx, (p1.y - L.cy) / 0.6) / Tree.M, vx = (p1.x - p0.x) / Tree.M, vy = (p1.y - p0.y) / 0.6 / Tree.M, vl = Math.hypot(vx, vy);
        const ang = vl > 0.2 ? Math.acos(Math.max(-1, Math.min(1, -(vx * Math.cos(L.a) + vy * Math.sin(L.a)) / vl))) * 180 / Math.PI : -1;
        ok(vl > 1.0 && d1 > d0 && ang >= 15 && ang <= 75, `1: не отошёл назад-вбок: путь ${vl.toFixed(2)} м, угол ${ang.toFixed(0)}° от «назад», от пня ${d0.toFixed(2)} → ${d1.toFixed(2)} м`);
        ok(!solidBefore, '2: ствол — преграда до удара о землю'); ok(solidAfter, '2: лежачий ствол — не преграда');
      }
      info.falls = Ts; ok(new Set(Ts.map(v => v.T.toFixed(2))).size >= 3, '1: падения одинаковые: ' + JSON.stringify(Ts));
      { const s = Ts.slice().sort((a, b) => a.H - b.H); ok(s[s.length - 1].T > s[0].T, '1: выше — не дольше: ' + JSON.stringify(s)); }
      // поза: медленный старт (маятник) — за первую треть падения угол < трети
      const fp = GFX.fallPose({ w: 0.6, T: 2.3 }, 0.6 + 0.33 * 2.3);
      ok(fp.th < Math.PI / 6, '1: старт падения не медленный (θ на 1/3 = ' + fp.th.toFixed(2) + ')');
      info.tip = +Tree.FALL.tip(6).toFixed(1); ok(info.tip > 11 && info.tip < 16, '1: скорость вершины 6 м ели ' + info.tip + ' м/с (≈13)');
      // ---- 3: урон ----
      const dmgCase = (place, dodge) => {
        base(); const t = pickTree(1), L = fellIt(t), p = P(); input.auto = 0;   // отход — отдельно (здесь герой стоит, где поставили)
        if (place === 'under') { L.a = Math.atan2((p.y - t.y) / 0.6, p.x - t.x); }   // ствол — на героя
        const hp0 = G.s.hp; let el = 0, hurtAt = null;
        if (dodge) { frame(Math.round(0.3 / DT)); el += 0.3; const d = Actions.danger(p); ok(!!d, '3: угроза не видна (Actions.danger) ' + JSON.stringify([p.x - t.x, p.y - t.y, t.s, World.trunkR(t)])); Hero.dodge(); }
        while (L.f && el < 5) { if (!dodge) input.auto = 0; frame(); el += DT; if (hurtAt == null && G.s.hp < hp0) hurtAt = el; }
        return { hit: G.s.hp < hp0, at: hurtAt, dmg: hp0 - G.s.hp };
      };
      const u = dmgCase('under'), a = dmgCase('away'), d = dmgCase('under', true);
      ok(u.hit, '3: под стволом — без урона'); ok(u.at != null && u.at >= 0.6, '3: урон раньше 0.6 с после треска: ' + u.at);
      ok(Math.abs(u.dmg - Actions.FELL.dmg) < 0.5, '3: урон не ' + Actions.FELL.dmg + ': ' + u.dmg);
      ok(!a.hit, '3: ствол упал от героя, а урон есть'); ok(!d.hit, '3: отскок не увёл из-под ствола');
      info.dmg = { under: u, away: a.hit, dodged: d.hit };
      // ---- 4: рубка только у ствола: сам встаёт к своей точке (по кругу), лицом к стволу ----
      const pos = [[55, 5], [40, 5], [30, 3], [12, 3], [0, -40], [0, 30], [-50, -20], [30, 35], [-20, 12]];
      info.reach = [];
      for (const [dx, dy] of pos) {
        base(); const t = pickTree(2), p = P(); delete t.cut; t.wood = World.wood0(t); p.x = t.x + dx; p.y = t.y + dy; p.face = dx > 0 ? -1 : 1; World.solid(p, 10, 'p'); Hero.snap();
        const c = Actions.context(); if (!c || c.k !== 'tree') { info.reach.push([dx, dy, 'нет «Рубить»']); continue; }
        Actions.interact(); let n = 0; while (!(p.action && (p.action.k === 'chop' || p.action.k === 'trample')) && n++ < 300) frame();
        const q = Actions.chopSpot(t), ax = p.x - t.x, ay = p.y - t.y, f = Math.atan2(ay / 0.6, ax);
        info.reach.push([dx, dy, +ax.toFixed(1), +ay.toFixed(1)]);
        ok(p.action && (p.action.k === 'chop' || p.action.k === 'trample'), `4: с (${dx},${dy}) так и не начал рубить`);
        if (p.action && p.action.k === 'chop') {
          ok(Math.hypot(p.x - q.x, p.y - q.y) <= 6, `4: рубит с (${ax.toFixed(1)},${ay.toFixed(1)}), не у своей точки`);
          ok(Math.abs(Math.hypot(ax, ay) - (World.trunkR(t) + 10.5)) <= 6, `4: рубит не вплотную к стволу (${Math.hypot(ax, ay).toFixed(1)} px)`);
          ok(Math.abs(Math.sin(f)) <= 0.62, `4: стоит прямо за/перед стволом (${(f * 180 / Math.PI).toFixed(0)}°)`);
          ok(Math.sign(t.x - p.x) === p.face, `4: рубит спиной к стволу`);
        }
        p.action = null; delete t.cut;
      }
      { base(); const t = pickTree(2), p = P(); p.x = t.x; p.y = t.y - 30; Hero.snap(); ok(!Actions.atTrunk(t), '4: «за деревом» считается «у ствола»'); }
      // ---- 10: по-настоящему: удары по толщине, подруб со стороны падения, задний рез с обратной, недоруб, направление ----
      { const Ns = [0.8, 0.95, 1.1, 1.25, 1.4].map(s => { const t = pickTree(3, q => Math.abs(q.s - s) < 0.08); return t ? { s: t.s, D: +Tree.size(t).D.toFixed(3), N: Actions.hitsFor(t) } : null; }).filter(Boolean);
        info.hits = Ns; const by = Ns.slice().sort((a, b) => a.D - b.D);
        ok(by.every((q, i) => !i || q.N >= by[i - 1].N), '10: ударов не по толщине: ' + JSON.stringify(by));
        ok(by[0].N >= 6 && by[0].N <= 8 && by[by.length - 1].N <= 16 && by[by.length - 1].N >= 13, '10: тонкая 6–8, толстая до 16: ' + JSON.stringify(by));
        const mid = by.find(q => q.D > 0.19 && q.D < 0.23); if (mid) ok(mid.N >= 10 && mid.N <= 14, '10: средняя ель (Ø ' + mid.D + ') — ' + mid.N + ' ударов, ждали ~12');
      }
      for (const D of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {   // к камере, от камеры, вправо, влево
        base(); const t = pickTree(4 + Math.round(D * 3), q => Depth.depthAt(q.x + 25, q.y + 3) < 40), p = P(); delete t.cut; t.wood = World.wood0(t);
        p.x = t.x + 30; p.y = t.y + 6; Hero.snap(); const c = Actions.cutOf(t, true); c.d = D;
        HITS.length = 0; const pos = []; input.act = true; let n = 0;
        while (t.wood > 0 && n++ < 6000) { frame(); if (p.action && p.action.k === 'chop') pos.push({ ph: p.action.ph, x: p.x - t.x, y: (p.y - t.y) / 0.6 }); }
        input.act = false;
        const tag = (D * 180 / Math.PI).toFixed(0) + '°', u = [Math.cos(D), Math.sin(D)], hs = HITS.filter(h => h.t === t);
        ok(t.wood <= 0, `10: ${tag}: не повалил за ${n} кадров (ударов ${hs.length})`);
        ok(hs.length === c.N, `10: ${tag}: ударов ${hs.length}, по плану ${c.N}`);
        const nh = hs.filter(h => !h.back), bh = hs.filter(h => h.back);
        ok(Math.abs(nh.length / c.N - 0.6) < 0.12, `10: ${tag}: подруб ${nh.length} из ${c.N} ударов (≈60 %)`);
        ok(nh.every(h => (h.x - t.x) * u[0] + (h.y - t.y) / 0.6 * u[1] > 0), `10: ${tag}: подруб не со стороны падения`);
        ok(bh.every(h => (h.x - t.x) * u[0] + (h.y - t.y) / 0.6 * u[1] < 0), `10: ${tag}: задний рез не с обратной стороны`);
        const pn = pos.filter(q => q.ph === 'n'), pb = pos.filter(q => q.ph === 'b'), dot = q => (q.x * u[0] + q.y * u[1]) / (Math.hypot(q.x, q.y) || 1);
        ok(pn.length && pb.length && pb.every(q => dot(q) < -0.2) && pn.every(q => dot(q) > -0.35), `10: ${tag}: задний рез — не обошёл ствол (подруб ${pn.length ? dot(pn[0]).toFixed(2) : '-'} → ${pb.length ? dot(pb[0]).toFixed(2) : '-'})`);
        const hinge = 1 - c.nq - c.bq; ok(c.e || Math.abs(hinge - Actions.CHOP.hinge) < 0.035, `10: ${tag}: недоруб ${hinge.toFixed(3)} Ø, ждали ≈0.10`);
        ok(c.nq <= 0.34, `10: ${tag}: подруб глубже 1/3: ${c.nq}`);
        const L = G.logs[G.logs.length - 1]; if (!c.e) ok(L && Math.abs(Math.atan2(Math.sin(L.a - D), Math.cos(L.a - D))) < 0.45, `10: ${tag}: упала не туда: ${L && L.a}`);
        info['dir' + tag] = { N: c.N, nq: c.nq, bq: c.bq, a: L && L.a };
        let k = 0; while (L && L.f && k++ < 600) frame();
      }
      // перерубил недоруб (рука неточна) — дерево никто не ведёт: не туда, риск; отметка на дереве
      { base(); const t = pickTree(6), p = P(), c = nearDone(t, 0); c.e = 1; c.bq = 1 - c.nq - 0.02; const q = Actions.chopSpot(t); p.x = q.x; p.y = q.y; Hero.snap();
        const L = Actions.fell(t); ok(L.f.risk >= 1 && Math.abs(Math.atan2(Math.sin(L.a - c.d), Math.cos(L.a - c.d))) > 0.4, '10: без недоруба упала куда задумано: ' + L.a + ' risk ' + L.f.risk);
        let k = 0; while (L.f && k++ < 600) frame(); }
      // ---- 11: площадка в сугробе ----
      { base(); const t = pickTree(1, q => [0.6, 2.5, -0.6, -2.5, 0, Math.PI].every(f => { const s = Actions.spotAt(q, f); return Depth.depthAt(s.x, s.y) > Actions.CHOP.deep + 8; })), p = P();
        if (!t) fails.push('11: нет ели в глубоком снегу'); else {
          delete t.cut; t.wood = World.wood0(t); p.x = t.x + 30; p.y = t.y + 6; Hero.snap();
          const c0 = Actions.context(); ok(c0 && c0.label === 'Вытоптать снег', '11: в сугробе не предлагает вытоптать: ' + (c0 && c0.label));
          const tire0 = G.s.tire; Actions.interact(); let n = 0; while (!(p.action && p.action.k === 'trample') && n++ < 400) frame();
          const a = p.action; ok(a && a.k === 'trample', '11: не начал вытаптывать');
          let el = 0, path = 0, lx = p.x, ly = p.y; while (p.action === a && el < 12) { frame(); el += DT; path += Math.hypot(p.x - lx, p.y - ly); lx = p.x; ly = p.y; }
          const q = Actions.chopSpot(t), dep = Depth.depthAt(q.x, q.y);
          info.trample = { T: +el.toFixed(2), path: Math.round(path), depth: Math.round(dep), tire: +(G.s.tire - tire0).toFixed(2) };
          ok(el >= 5 - 0.05 && el <= 10 + 0.05, '11: вытаптывал ' + el.toFixed(1) + ' с (5–10)');
          ok(path > 2 * Math.PI * 25, '11: не обошёл ствол: путь ' + path.toFixed(0) + ' px');
          ok(dep <= Actions.CHOP.deep && !Actions.trampleNeed(t), '11: у ствола всё ещё ' + dep.toFixed(0) + ' см (кольцо ' + Actions.trampleNeed(t) + ')');
          ok(G.s.tire > tire0, '11: вытаптывать — без сил');
          Actions.interact(); n = 0; while (!(p.action && p.action.k === 'chop') && n++ < 400) frame(); ok(p.action && p.action.k === 'chop', '11: после площадки не рубит');
          p.action = null; delete t.cut;
        } }
      // ---- 7а: сейв посреди рубки — t.cut тот же ----
      { base(); const t = pickTree(7), p = P(); delete t.cut; t.wood = World.wood0(t); p.x = t.x + 30; p.y = t.y + 6; Hero.snap(); input.act = true;
        let n = 0; while (!(t.cut && t.cut.h >= 3) && n++ < 3000) frame(); input.act = false; p.action = null;
        const ti = G.trees.indexOf(t), c0 = JSON.stringify(t.cut), w0 = t.wood, snap = SaveGame.snapshot(); SaveGame.load(snap); const t2 = G.trees[ti];
        ok(JSON.stringify(t2.cut) === c0 && t2.wood === w0, '7: после загрузки рубка другая: ' + JSON.stringify(t2.cut) + ' / ' + c0); }
      // ---- 5, 12, 13, 6: обрубка по мутовке, сторона, перекат, лежащие ветви, куча лапника; масса — целое; раскряжёвка, подбор ----
      base(); { const t = pickTree(3), L0 = fellIt(t), id = L0.id, getL = () => G.logs.find(q => q.id === id) || L0; { let k = 0; while (L0.f && k++ < 400) frame(); } frame(10); input.auto = 0;
        const m0 = L0.m0, v0 = Tree.whole(L0).vol, n0 = L0.n0, src = q => q.src === id;
        // сумма: что ещё на стволе + что отделено + что подобрано = целое (±1 %); подобранное — части в руках (js/carry.js) с тем же src
        const inHand = () => Carry.parts().filter(src);
        const sum = () => { const L = getL(), on = G.logs.includes(L) ? Tree.parts(L) : []; let m = 0, v = 0; for (const q of on.concat(inHand())) { m += q.mass; v += q.vol; } for (const q of G.chunks) if (src(q)) { m += q.mass; v += q.vol; } return { m, v }; };
        const keepM = what => { const s2 = sum(); ok(Math.abs(s2.m - m0) / m0 < 0.01 && Math.abs(s2.v - v0) / v0 < 0.01, `5: ${what}: масса ${s2.m.toFixed(2)} из ${m0.toFixed(2)}, объём ${s2.v.toFixed(4)} из ${v0.toFixed(4)}`); };
        keepM('целое сразу после валки');
        info.tree = { m0: +m0.toFixed(1), H: +(Tree.of(L0).S.H * L0.k).toFixed(2), D: +(Tree.of(L0).S.R0 * 2 * L0.k).toFixed(3), n0, cl: +(L0.cl * L0.k).toFixed(3) };
        { const p = P(), e = Actions.logEnd(L0, 0.25); p.x = e.x - Math.sin(L0.a) * 26; p.y = e.y + Math.cos(L0.a) * 16; World.solid(p, 10, 'p'); Hero.snap(); }
        // держим E: обрубка → (переход на ту сторону) → (перекат) → вершина; удар — одна мутовка; своя сторона и подмятые — не рубятся
        const steps = [], bad = []; let g = 0, saved = 0, rollSeen = null, L = getL(), lastLm = Tree.limbState(L) && L.lm.slice(), prev = Tree.limbState(L), rollT = 0;
        input.act = true;
        while (!L.top && g++ < 12000) {
          const p = P(), a0 = p.action; frame(); L = getL();
          if (a0 && a0.k === 'roll') { rollT += DT; if (!rollSeen) rollSeen = { r0: a0.r0, r1: a0.r1, dur: a0.dur, pin0: prev.filter(q => q.c === 'pin' && !q.cut).length }; }
          if (L.lm.join() !== lastLm.join()) {
            const ch = L.lm.map((m, i) => m !== lastLm[i] ? i : -1).filter(i => i >= 0), hs = sideOf(L, P());
            const cut = prev.filter(q => !q.cut && ((L.lm[q.i] >> q.j) & 1));
            for (const q of cut) if ((q.c === 'pin' && (L.rn || 0) < 2) || (q.c === 'side' && q.sd === hs)) bad.push([q.i, q.j, q.c, q.sd, hs]);
            steps.push({ w: ch.join(), n: cut.length, side: hs, roll: +(L.roll || 0).toFixed(2) });
            ok(ch.length === 1, '5: удар обрубки задел не одну мутовку: ' + ch);
            lastLm = L.lm.slice(); prev = Tree.limbState(L); keepM('обрубка ' + steps.length);
            // сейв посреди обрубки (после переката, если он был): ствол и части те же
            if (!saved && (rollSeen ? L.rn >= 1 : steps.length === 6)) {
              saved = 1; input.act = false; P().action = null; input.auto = 0;
              const s0 = JSON.stringify({ lm: L.lm, roll: L.roll, cut: L.cut, n: L.n, zTop: L.zTop, rn: L.rn || 0 }), nc = G.chunks.filter(src).length;
              SaveGame.load(SaveGame.snapshot()); L = getL(); frame(); input.act = true;
              ok(L && JSON.stringify({ lm: L.lm, roll: L.roll, cut: L.cut, n: L.n, zTop: L.zTop, rn: L.rn || 0 }) === s0, '7: после загрузки ствол другой: ' + s0);
              ok(G.chunks.filter(src).length === nc, '7: после загрузки частей другое число');
              GFX.render(DT, null);
            }
          }
          if (a0 && a0.k === 'roll') prev = Tree.limbState(L);
        }
        input.act = false; frame(5);
        info.limb = { steps: steps.length, sides: [...new Set(steps.map(s => s.side))], rolls: L.rn || 0, roll: rollSeen && { dur: rollSeen.dur, da: +((rollSeen.r1 - rollSeen.r0) * 180 / Math.PI).toFixed(0), pin0: rollSeen.pin0 } };
        ok(L.top === 1, '5: обрубка не дошла до вершины за ' + g + ' кадров: ' + JSON.stringify(steps.slice(-3)));
        ok(!bad.length, '5: срублены ветви своей стороны или подмятые до переката: ' + JSON.stringify(bad.slice(0, 4)));
        const wh = steps.map(s => +s.w);
        ok(steps.length >= Tree.limbState(L).reduce((m, q) => Math.max(m, q.i + 1), 0), '5: мутовок меньше, чем ударов обрубки: ' + steps.length);
        { let mono = true; for (let i = 1; i < steps.length; i++) if (steps[i].side === steps[i - 1].side && steps[i].roll === steps[i - 1].roll && wh[i] < wh[i - 1]) mono = false; ok(mono, '5: обрубка не от комля к вершине: ' + wh.join(',')); }
        ok(info.limb.sides.length === 2, '5: обрубал с одной стороны ствола: ' + info.limb.sides);
        if (rollSeen) { const da = Math.abs(rollSeen.r1 - rollSeen.r0); ok(rollSeen.dur >= 2 && rollSeen.dur <= 3 && da >= Math.PI / 3 - 1e-6 && da <= 2 * Math.PI / 3 + 1e-6, '12: перекат ' + rollSeen.dur + ' с, ' + (da * 180 / Math.PI).toFixed(0) + '° (2–3 с, 60–120°)'); }
        ok(!Tree.limbState(L).some(q => !q.cut), '5: после обрубки остались ветви');
        const bo = G.chunks.filter(q => src(q) && (q.kind === 'bough' || q.kind === 'branch')); info.boughs = bo.length; ok(bo.length >= 8, '5: лапника (ветвей) на снегу мало: ' + bo.length);
        ok(L.top === 1 && G.chunks.some(q => src(q) && q.kind === 'top') && L.n === n0, '5: вершина не отделена частью: top ' + L.top + ' n ' + L.n + '/' + n0);
        // 12: ветвь лежит объёмно: середина оси 10–25 см, кончик в снегу, побеги над снегом ≥ 30 % точек; основания — не в одной точке
        const sh = bo.map(q => Tree.boughShape(q)).filter(s => s && !s.bare), badSh = sh.filter(s => s.mid < 10 || s.mid > 25 || s.tip > 0 || s.above < 0.3);
        info.shape = { n: sh.length, mid: sh.length ? [Math.min(...sh.map(s => s.mid)), Math.max(...sh.map(s => s.mid))] : null, above: sh.length ? +Math.min(...sh.map(s => s.above)).toFixed(2) : null };
        ok(sh.length && !badSh.length, '12: ветвь лежит плоско/не так: ' + JSON.stringify(badSh.slice(0, 3)));
        { const byW = {}; for (const q of bo) (byW[q.w] = byW[q.w] || []).push(q); let star = 0, nw = 0;
          for (const k in byW) { const a = byW[k]; if (a.length < 3) continue; nw++; const bx = a.map(q => q.x - Math.cos(q.ang) * q.len * 0.45 * Tree.M), by = a.map(q => q.y - Math.sin(q.ang) * q.len * 0.45 * Tree.M * 0.6); const sp = Math.max(...bx) - Math.min(...bx) + Math.max(...by) - Math.min(...by); if (sp < 4) star++; }
          ok(!nw || star / nw < 0.3, '12: ветви мутовки легли «звездой» из одной точки: ' + star + '/' + nw); }
        // ветви смотрят к вершине (растут под углом к ней): средняя проекция на ось ствола > 0
        { const ea = [Math.cos(L.a), Math.sin(L.a)], m = bo.reduce((s, q) => s + Math.cos(q.ang) * ea[0] + Math.sin(q.ang) * ea[1], 0) / bo.length; info.toTop = +m.toFixed(2); ok(m > 0.2, '12: ветви не смотрят к вершине: ' + m.toFixed(2)); }
        // 6: раскряжёвка до конца: ствол весь уходит в части (комель — тоже часть), сумма не меняется
        { const p = P(), e = Actions.logEnd(L, 0.3); p.x = e.x - Math.sin(L.a) * 26; p.y = e.y + Math.cos(L.a) * 16; World.solid(p, 10, 'p'); Hero.snap(); }
        g = 0; while (G.logs.includes(L) && L.n > 0 && g++ < 40) { Actions.interact(); let k = 0; while ((P().action || input.auto) && k++ < 400) frame(); keepM('раскряжёвка ' + g); }
        G.chunks.push(...Carry.parts().splice(0));   // подобранные по ходу — обратно на снег (дальше проверяем подбор каждой)
        const wood = G.chunks.filter(q => src(q) && Tree.isWood(q));
        ok(!G.logs.includes(L) && L.n === 0, '6: после разделки ствол не ушёл в части: n=' + L.n);
        ok(wood.length === n0 + 1 && wood.filter(q => q.kind === 'butt').length === 1, `6: частей-дров ${wood.length}, ждали ${n0 + 1} (чурки + комель + вершина)`);
        const lens = wood.filter(q => q.kind !== 'top').map(q => q.len); info.lens = [Math.min(...lens), Math.max(...lens)];
        ok(lens.every(l => l >= 0.35 && l <= 0.62), '6: длина чурок вне 0.35–0.62 м: ' + lens);
        // ни одна часть не исчезает без действия: полсуток и сутки — дрова на месте, масса та же
        const mW = wood.reduce((a, q) => a + q.mass, 0); G.time += CYCLE * 0.5; frame(); G.time += CYCLE * 0.6; frame(); GFX.render(DT, null);
        const wood2 = G.chunks.filter(q => src(q) && Tree.isWood(q)); ok(wood2.length === wood.length && Math.abs(wood2.reduce((a, q) => a + q.mass, 0) - mW) < 1e-6, '6: дрова исчезли со временем: ' + wood2.length);
        // каждую чурку можно взять: подходим — подсказка «Взять», жест кладёт дрова по массе
        G.inv.wood = 0; let got = 0, miss = [], gotKg = 0;
        for (const q of wood2.slice().sort((a, b) => a.y - b.y)) {
          if (!G.chunks.includes(q)) { got++; continue; }
          const pp = P(); pp.action = null; input.auto = 0; pp.x = q.x + 16; pp.y = q.y + 3; World.solid(pp, 10, 'p'); Hero.snap(); frame(2);
          const c = Actions.context(); if (!c || c.k !== 'chunks') { miss.push(q.kind + (c ? ':' + c.k : ':нет') + ' d' + Math.round(Math.hypot(pp.x - q.x, pp.y - q.y))); continue; }
          let k = 0; while (G.chunks.includes(q) && k++ < 20) { Actions.interact(); let j = 0; while ((pp.action || input.auto) && j++ < 300) frame(); for (const h of Carry.parts().splice(0)) gotKg += h.mass; }
          if (!G.chunks.includes(q)) got++;
        }
        ok(!miss.length, '5: нет подсказки «Взять» у частей: ' + miss.join(','));
        ok(got === wood2.length, `5: взято ${got} из ${wood2.length} (последняя не берётся?)`);
        info.woodPerTree = { kg: +mW.toFixed(1), pieces: wood2.length, got: +gotKg.toFixed(2) };
        ok(Math.abs(gotKg - mW) < 1e-6, `5: в руки пришло ${gotKg.toFixed(2)} кг из ${mW.toFixed(2)} (каждая чурка — своей массой)`);
        // 13: лапник — в кучу: масса кучи = сумма сгребённых ветвей; кучу — охапкой
        { const lapM = () => G.chunks.concat(Carry.parts()).filter(q => src(q) && (q.kind === 'bough' || q.kind === 'branch' || q.kind === 'pile')).reduce((m, q) => m + q.mass, 0), lap0 = lapM();
          const keepB = what => { const m = lapM(); ok(Math.abs(m - lap0) < 1e-3, `13: ${what}: лапника ${m.toFixed(2)} кг из ${lap0.toFixed(2)}`); };
          const p = P(); G.inv.wood = 0; const q0 = bo.filter(q => G.chunks.includes(q)).sort((a, b) => a.x - b.x)[Math.floor(bo.length / 2)]; p.x = q0.x + 18; p.y = q0.y + 10; World.solid(p, 10, 'p'); Hero.snap(); p.action = null; input.auto = 0; frame(2);
          const c = Actions.context(); ok(c && c.k === 'rake', '13: у лапника нет «Сгрести»: ' + (c && c.k));
          let raked = 0, pile = null, k = 0;
          while (k++ < 6) { const c2 = Actions.context(); if (!c2 || c2.k !== 'rake') break; Actions.interact(); const a = p.action; if (!a || a.k !== 'rake') break;
            const ms = a.ids.map(i => G.chunks.find(q => q.id === i)).filter(Boolean).reduce((s, q) => s + q.mass, 0); let j = 0; while (p.action === a && j++ < 900) frame();
            raked += ms; pile = Actions.pileNear(p.x, p.y, 80); keepB('сгребли ' + k); }
          info.pile = pile && { n: pile.n, kg: +pile.mass.toFixed(2), raked: +raked.toFixed(2) };
          ok(pile && Math.abs(pile.mass - raked) < 1e-3, '13: масса кучи не сумма ветвей: ' + JSON.stringify(info.pile));
          ok(pile && pile.mass <= Actions.PILE_KG + 1e-6, '13: куча больше охапки: ' + (pile && pile.mass));
          if (pile) { p.x = pile.x + 16; p.y = pile.y + 6; World.solid(p, 10, 'p'); Hero.snap(); frame(2); const c3 = Actions.context(); ok(c3 && c3.k === 'pileTake', '13: у кучи нет «Взять лапник»: ' + (c3 && c3.k));
            if (c3 && c3.k === 'pileTake') { Actions.interact(); let j = 0; while ((p.action || input.auto) && j++ < 300) frame(); ok(Carry.parts().includes(pile) && !G.chunks.includes(pile), '13: куча не в руках'); keepB('куча в руках');
              G.chunks.push(...Carry.parts().splice(0)); } } }
        // подбор по одной: чурка уходит с земли не раньше касания рукой; удержание E — собирает кучу
        base(); G.time = tAt(G.day + 1, 13); frame(); const p2 = P(); G.chunks.length = 0; G.inv.wood = 0; Carry.hand().p = []; Carry.hand().t = null;
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
        const onto = (tx, ty, hx, hy, ang) => { base(); const t = pickTree(5), ox = t.x, oy = t.y; t.x = tx; t.y = ty; nearDone(t);
          const L = Actions.fell(t); L.a = ang != null ? ang : Math.atan2(Pn.y + 4 - ty, Pn.x + 10 - tx); L.f.risk = 0; if (hx != null) { G.p.x = hx; G.p.y = hy; Hero.snap(); }
          const h0 = (G.iceHoles || []).length; let k = 0; while (L.f && !L.f.hit && k++ < 600) { L.f.t += DT; if (L.f.t >= L.f.w + L.f.T) { L.f.hit = 1; Actions.iceHit(L); } }
          t.x = ox; t.y = oy; delete t.cut; delete L.f; return { L, holes: (G.iceHoles || []).length - h0 }; };
        const bx = riverX(Pn.y) - RW - 30;
        const a = onto(bx, Pn.y + 4, null);   // с берега на перекат
        ok(a.holes > 0 && a.L.sink, '8: ель на тонком льду переката не пробила лёд: ' + JSON.stringify({ r: a.L.iceR, sink: a.L.sink, len: a.L.len }));
        const fy = Pn.y + 900, far = onto(riverX(fy) - RW - 30, fy, null, null, 0);   // далеко от переката — поперёк реки на лёд ~0.4 м
        ok(!far.holes && !far.L.sink && far.L.iceR > 0, '8: на толстом льду пролом (или ствол не лёг на лёд): ' + far.L.iceR);
        info.ice = { farA: far.L.a, farLen: far.L.len, thin: a.L.iceR, thick: far.L.iceR, hThin: +Ice.thick(Pn.x - 20, Pn.y).toFixed(3), hFar: +Ice.thick(riverX(fy), fy).toFixed(3) };
        Ice.reset && Ice.reset(); G.iceHoles = [];
        onto(bx, Pn.y + 4, Pn.x - 4, Pn.y + 2); ok(Ice.active(), '8: герой на льду у пролома не провалился'); Ice.reset();
        G.iceHoles = []; G.p.wetT = 0; }
      // ---- 9: где ложатся части (js/tree3d.js boughRest/place): ветвь — у места крепления (≤ 0.45·длины + 0.9 м), ничто не дальше вершины + 1 м,
      //      чурка — не дальше 1.5 м от места реза; разлёт у двух деревьев и двух сторон удара — разный, чурки — не рядами
      { const Mx = Tree.M;
        // герой с одной стороны ствола у места работы; обрубка (обе стороны, перекат), вершина и раскряжёвка — напрямую (Tree.split)
        const work = (L, side) => {
          const p = P(), at = z => { const d = (z - L.hc) * L.k * Mx; return { x: L.x + Math.cos(L.a) * d, y: L.y + Math.sin(L.a) * d * 0.6 }; };
          const stand = (sd) => { const q = at(Tree.workZ(L, sd)); p.x = q.x - Math.sin(L.a) * sd * Mx; p.y = q.y + Math.cos(L.a) * sd * Mx * 0.6; };
          let g = 0, sd = side;
          while (Tree.cutFrac(L) < 1 && g++ < 80) { const pl = Tree.limbPlan(L, sd); if (pl.side) { sd = pl.side; continue; } if (pl.roll) { L.roll = (L.roll || 0) + 1.6; L.rn = (L.rn || 0) + 1; continue; } stand(sd); Tree.split(L, 'limb', sd); }
          Tree.split(L, 'top');
          while (L.n > 0 && g++ < 160) { stand(side); Tree.split(L, 'buck'); }
          return G.chunks.filter(q => q.src === L.id);
        };
        const uv = (L, q) => { const dx = (q.x - L.x) / Mx, dy = (q.y - L.y) / (0.6 * Mx), c = Math.cos(L.a), s = Math.sin(L.a); return { u: dx * c + dy * s, v: -dx * s + dy * c }; };
        const check = (L, ps, tag) => {
          const { S, k } = Tree.of(L), top = (S.H - L.hc) * k, r = { bMax: 0, wMax: 0, beyond: -9, n: ps.length };
          for (const q of ps) {
            const c = uv(L, q), boughy = q.kind === 'bough' || q.kind === 'branch', za = boughy ? S.wh[q.w].z : (q.z0 + q.z1) / 2, d = Math.hypot(c.u - (za - L.hc) * k, c.v);
            r.beyond = Math.max(r.beyond, c.u - top);
            if (boughy) { r.bMax = Math.max(r.bMax, d); ok(d <= q.len * 0.45 + 0.9, `9: ${tag}: ветвь легла в ${d.toFixed(2)} м от места крепления (длина ${q.len})`); }
            else { r.wMax = Math.max(r.wMax, d); ok(d <= 1.5, `9: ${tag}: ${q.kind} легла в ${d.toFixed(2)} м от места реза`); }
            ok(c.u <= top + 1, `9: ${tag}: ${q.kind} за вершиной на ${(c.u - top).toFixed(2)} м`);
          }
          const wd = ps.filter(q => q.kind === 'chunk'), angs = wd.map(q => q.ang - L.a), lat = wd.map(q => Math.abs(uv(L, q).v));
          const sd = a => { const m = a.reduce((x, y) => x + y, 0) / (a.length || 1); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length || 1)); };
          r.angSd = +sd(angs).toFixed(2); r.latSd = +sd(lat).toFixed(2);
          ok(wd.length < 3 || (r.angSd > 0.15 && r.latSd > 0.06), `9: ${tag}: чурки рядами (разброс поворота ${r.angSd}, отката ${r.latSd})`);
          r.bMax = +r.bMax.toFixed(2); r.wMax = +r.wMax.toFixed(2); r.beyond = +r.beyond.toFixed(2); return r;
        };
        const fresh = i => { base(); const t = pickTree(i), L = fellIt(t); let k = 0; while (L && L.f && k++ < 600) frame(); return L; };
        const off = (L, ps) => { const { S, k } = Tree.of(L); return ps.filter(q => q.kind === 'bough' || q.kind === 'branch').sort((a, b) => a.w - b.w || a.b - b.b).map(q => { const c = uv(L, q); return [c.u - (S.wh[q.w].z - L.hc) * k, c.v]; }); };
        const differ = (a, b) => { const n = Math.min(a.length, b.length); let m = 0; for (let i = 0; i < n; i++) if (Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) > 0.08) m++; return n ? m / n : 0; };
        info.lay = {};
        const L1 = fresh(6), keepL = JSON.parse(JSON.stringify(L1)), A1 = work(L1, 1); info.lay.t1r = check(L1, A1, 'дерево 1 справа');
        G.chunks = []; G.logs = [Object.assign({}, keepL)]; const L1b = G.logs[0], A2 = work(L1b, -1); info.lay.t1l = check(L1b, A2, 'дерево 1 слева');
        const ds = differ(off(L1, A1), off(L1b, A2)); info.lay.sideDiff = +ds.toFixed(2); ok(ds > 0.5, '9: удар с разных сторон — ветви легли так же: ' + ds.toFixed(2));
        const L2 = fresh(8), B1 = work(L2, 1); info.lay.t2 = check(L2, B1, 'дерево 2');
        const dt = differ(off(L1, A1), off(L2, B1)); info.lay.treeDiff = +dt.toFixed(2); ok(dt > 0.5, '9: два дерева — разлёт одинаковый: ' + dt.toFixed(2));
        G.chunks = []; G.logs = []; }
      // ---- 6б: старые стволы сверх 8 — заметаются, не исчезают ----
      base(); { for (let i = 0; i < 10; i++) { const t = pickTree(4 + i); if (!t) break; const L = fellIt(t); let k = 0; while (L && L.f && k++ < 600) frame(); }
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
