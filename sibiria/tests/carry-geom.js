#!/usr/bin/env node
// Ноша — геометрия и порядок (js/carry.js, ArtPeople: длинное на плече, охапка, волок, подъём). Настоящие кадры: update() + GFX.render.
//   cd tests && node carry-geom.js
//   1. ноги: ни одна точка ноши, нарисованная после ног, не внутри выпуклой оболочки ног (8 направлений × идёт/стоит × плечо 1/2/4 м,
//      охапка, волок; подъём по фазам)
//   2. хват: точка ствола в кисти ≤ 1,5 ед. каждый кадр (плечо, подъём, снять); комель волока — в кисти (≤ 1,5 px, кроме предела скачка)
//   3. слои: отрезки за корпусом — до ног, перед корпусом — после торса, ближняя рука — поверх
//   4. одно состояние рук: поле = данные = нарисованное, вид = kind
//   5. рюкзак не надевается при охапке/плече/волоке: «положить → надеть → поднять»; на ходу с ношей — остаётся на снегу
//   6. надписи: 0 всплывашек над героем, отметка — не раньше прибытия, отказ — один тост
//   7. ноша не прыгает > 14 px за кадр (ход, развороты, подъём, волок)
//   8. подъём: длительность растёт с массой и длиной; походка под грузом короче; нарты отстают на старте 100–200 мс
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => { out.push((c ? 'ok   ' : 'FAIL ') + w); return c; }, info = w => out.push('     ' + w);
  UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {}; Story.tick = () => {}; Weather.tick = () => {};
  UI.closePanel();
  const DT = 1 / 60, f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2);
  const base = { x: HUT.x + 520, y: HUT.y + 320 };
  function fresh(h = 12) {
    Math.random = mulberry(5); newGame(); state = 'play'; G.chapter = 1; G.time = tAt(2, h); G.day = dayOf(); G.lastDawn = G.day;
    G.storm = null; G.wolves = []; G.bear = null; G.s.food = 100; G.s.warm = 100; G.s.hp = 1e6; G.s.tire = 0; input.mx = input.my = 0; input.act = false; Hero.bodyReset();
    G.hares = []; G.chunks = []; G.logs = []; if (G.col) for (const u of G.col.units) u.hidden = true;
    for (const t of G.trees) if (Math.hypot(t.x - base.x, t.y - base.y) < 300) t.wood = 0;   // открытое место: без силуэтов за деревьями
  }
  const at = (x, y, f) => { const p = G.p; p.x = x; p.y = y; if (f) p.face = f; p.inside = insideHut(x, y); p.lx = x; p.ly = y; p.sx = x - 30; p.sy = y; Hero.snap(); };
  // кадр героя: снимок с настоящего рисования (не силуэт за препятствием)
  let S = null; const D0 = ArtPeople.draw;
  ArtPeople.draw = function (g, o) {
    const r = D0.apply(this, arguments);
    if (o && o.key === G.p && o.onStep) {
      const Q = ArtPeople.H.P, d = ArtPeople.dbg, L = Q.lng;
      S = { st: o.load && o.load.st, kind: o.load && o.load.lg && o.load.lg.kind, ord: d.ord.slice(), seg: d.seg.map(s => s.slice()), lo: d.lo ? d.lo.slice() : null,
        lg: [Q.lg0.slice(0, 6), Q.lg1.slice(0, 6)], h: [[Q.h0x, Q.h0y, Q.hl0], [Q.h1x, Q.h1y, -Q.hl1]], H: L && L.H ? L.H.slice() : null, pins: L && L.pins ? L.pins.map(p => p.slice()) : null, hold: L ? L.hold : null,
        T: L && L.T ? L.T.slice() : null, B: L && L.B ? L.B.slice() : null, dir: L && L.T ? [(L.B[0] - L.T[0]) / L.Lr, (L.B[1] - L.T[1]) / L.Lr, (L.B[2] - L.T[2]) / L.Lr] : null, Lr: L && L.Lr, u: L ? L.u : null,
        anc: JSON.parse(JSON.stringify(ArtPeople.H.anc)), sh: !!(L && L.sh) };
    }
    return r;
  };
  const frame = () => { S = null; update(DT); now += DT; GFX.lookAt(G.p.x, G.p.y); GFX.render(DT, null); return S; };
  const run = (n, each) => { for (let i = 0; i < n; i++) { const s = frame(); if (each && s) each(s, i); } };
  // выпуклая оболочка (Эндрю) и точка внутри
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const inside = (H, p, m = 0.5) => { for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; if ((ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / l < m) return false; } return H.length >= 3; };
  const legHull = s => hull([0, 1].flatMap(i => [[s.lg[i][0], s.lg[i][1]], [s.lg[i][2], s.lg[i][3]], [s.lg[i][4], s.lg[i][5]]]));
  // точки отрезков ноши, нарисованных после ног (перед корпусом): ось и края по ширине
  function hits(s) {
    const H = legHull(s); let n = 0; const iL = s.ord.indexOf('legs');
    if (s.ord.indexOf('lngF') > iL) for (const [fr, x0, y0, x1, y1, w] of s.seg) if (fr) { const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2; for (let k = 0; k <= 4; k++) { const x = x0 + dx * k / 4, y = y0 + dy * k / 4; for (const q of [[x, y], [x + nx, y + ny], [x - nx, y - ny]]) if (inside(H, q)) n++; } }
    if (s.lo) for (let k = 0; k < 4; k++) if (inside(H, [s.lo[2 * k], s.lo[2 * k + 1]])) n++;
    return n;
  }
  // точки ствола волоком, которые рисуются после героя (отрезки южнее его опоры)
  function dragHits(s) {
    const L = Carry.dragL(); if (!L) return 0; const H = legHull(s); let n = 0; const p = G.p;
    for (const sg of Carry.logSegs(L)) { const key = sg.i && (sg.xb < p.x - 10 || sg.xa > p.x + 10) ? sg.y : Math.min(sg.y, p.y - 0.01); if (key <= p.y) continue;   // как сортирует gfx
      const len = Carry.logLen(L), ca = Math.cos(L.a), sa = Math.sin(L.a) * 0.6, z = L.z || 0;
      for (let k = 0; k <= 6; k++) { const u = (sg.i + k / 6) / sg.n, x = L.x + ca * len * u, y = L.y + sa * len * u - z * (1 - u); if (inside(H, [x, y])) n++; } }
    return n;
  }
  // хват: кисть на стволе (точка ствола под кистью ≤ 1,5 ед.)
  function gripErr(s) {
    if (!s || !s.T || !s.dir) return 0; let e = 0;
    const pinsHands = s.sh ? [s.hold] : (s.pins || []).map(p => p[0]);
    for (const i of pinsHands) { const h = s.h[i], T = s.T, d = s.dir, v = [h[0] - T[0], h[1] - T[1], h[2] - T[2]], t = Math.max(0, Math.min(s.Lr, v[0] * d[0] + v[1] * d[1] + v[2] * d[2])), q = [T[0] + d[0] * t, T[1] + d[1] * t, T[2] + d[2] * t];
      e = Math.max(e, Math.hypot(h[0] - q[0], h[1] - q[1], h[2] - q[2]) - 1.2); }   // кисть — снизу обхватом (≈ 1,1 ниже оси)
    return Math.max(0, e);
  }
  const order = s => { const o = s.ord, iL = o.indexOf('legs'), iT = o.indexOf('torso'), iA = o.lastIndexOf('arm0'), iB = o.indexOf('lngB'), iF = o.indexOf('lngF'); return (iB < 0 || iB < iL) && (iF < 0 || (iF > iT && iF < iA)); };
  // длинная часть дерева нужной длины/вида (масса и длина — заданные)
  let LONGS = null;
  function longPart(len, kg, kind) {
    if (!LONGS) { LONGS = []; for (const t of G.trees.filter(t => !t.wall).slice(0, 200)) { const Lg = Tree.ensure({ x: t.x, y: t.y, s: t.s, kind: t.kind, v: t.v }); LONGS = LONGS.concat(Tree.parts(Lg).filter(q => !q.fixed && (q.len || 0) > 0.8)); } }
    const q = LONGS.find(q => q.kind === kind) || LONGS[0];
    return Object.assign({}, q, { id: 9000 + (Math.random() * 999 | 0), len, mass: kg, t: G.time - 5 });
  }
  const DIRS = [['→', 1, 0], ['↘', 0.7, 0.7], ['↓', 0, 1], ['↙', -0.7, 0.7], ['←', -1, 0], ['↖', -0.7, -0.7], ['↑', 0, -1], ['↗', 0.7, -0.7]];
  const SH = [['плечо 1 м', 1, 2, 'top'], ['плечо 2 м', 2, 4, 'bough'], ['плечо 4 м', 4, 20, 'top']];
  let JW = '', CUR = '', GMX = 0; const jump = () => { let last = null, mx = 0, n = 0; return { step(s) { if (!s || !s.anc || !s.anc.lng) { last = null; return; } const A = s.anc.lng, c = [A.T[0], A.T[1], A.B[0], A.B[1]]; if (last) { const j = Math.max(Math.hypot(c[0] - last[0], c[1] - last[1]), Math.hypot(c[2] - last[2], c[3] - last[3])); if (j > mx) mx = j; if (j > GMX) { GMX = j; JW = CUR + ` кадр ${n} T ${last.slice(0, 2).map(f1)}→${c.slice(0, 2).map(f1)} B ${last.slice(2).map(f1)}→${c.slice(2).map(f1)} anim ${G.p.action ? G.p.action.s : Hero.pose().anim}`; } } last = c; n++; }, get max() { return mx; } }; };

  // ---------- 1–4, 7: длинное на плече и охапка: 8 направлений × идёт/стоит ----------
  try {
    const R = { hit: 0, frames: 0, grip: 0, ord: 0, st: 0, kind: 0, jump: 0, worst: '' };
    const LOADS = SH.map(([nm, len, kg, kind]) => [nm, () => { const q = longPart(len, kg, kind); Carry.hand().p = [q]; Carry.hand().st = 'shoulder'; return kind; }])
      .concat([['охапка', () => { Carry.hand().p = [0, 1, 2].map(i => Carry.partOf({ kg: 4 + i, l: 6 })); return null; }]]);
    for (const [nm, set] of LOADS) for (const [dn, dx, dy] of DIRS) for (const walk of [1, 0]) { CUR = nm + ' ' + dn + (walk ? ' идёт' : ' стоит');
      fresh(); at(base.x, base.y, dx < 0 ? -1 : 1); const kind = set(); const J = jump(); run(6);
      input.mx = dx; input.my = dy; const each = s => { R.frames++; const h = hits(s); if (h) { R.hit += h; R.worst = R.worst || `${nm} ${dn}`; } R.grip = Math.max(R.grip, gripErr(s)); if (!order(s)) R.ord++; if (s.st !== Carry.st() || Carry.st() !== Carry.stOf()) R.st++; if (kind && s.kind !== kind) R.kind++; J.step(s); };
      run(36, each); input.mx = input.my = 0; if (!walk) run(40, each);
      R.jump = Math.max(R.jump, J.max);
    }
    ok(R.hit === 0, `🦵 ноша не на ногах: ${R.hit} попаданий в оболочку ног за ${R.frames} кадров (плечо 1/2/4 м, охапка × 8 направлений × идёт/стоит)${R.worst ? ' · первое: ' + R.worst : ''}`);
    ok(R.grip <= 1.5, `✋ хват на плече: кисть от ствола ≤ ${f2(R.grip)} ед. (≤ 1,5)`);
    ok(R.ord === 0, `🧅 слои: за корпусом — до ног, перед — после торса, рука поверх (нарушений ${R.ord})`);
    ok(R.st === 0 && R.kind === 0, `🖐 одно состояние: поле = данные = нарисованное (расхождений ${R.st}), вид = kind (${R.kind})`);
    ok(R.jump <= 14, `📏 концы ноши за кадр ≤ ${f1(R.jump)} px (≤ 14)${R.jump > 14 ? ' · ' + JW : ''}`);
    // развороты: туда-обратно, ствол поворачивается с корпусом
    fresh(); at(base.x, base.y, 1); Carry.hand().p = [longPart(2, 4, 'bough')]; Carry.hand().st = 'shoulder'; run(6); const J = jump(); let g = 0, hh = 0;
    for (const d of [1, -1, 1, -1, 0, 0]) { input.mx = d; input.my = d ? 0 : 1; run(24, s => { J.step(s); g = Math.max(g, gripErr(s)); hh += hits(s); }); }
    input.mx = input.my = 0;
    ok(J.max <= 14 && g <= 1.5 && hh === 0, `🔄 развороты с 2 м на плече: скачок ≤ ${f1(J.max)} px, хват ≤ ${f2(g)}, на ногах ${hh}`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- подъём на плечо по фазам, снять, сбросить ----------
  try {
    const R = { hit: 0, grip: 0, ord: 0, jump: 0, st: 0, ph: [] };
    for (const [nm, len, kg, kind] of [['лапник 2 м', 2, 3.5, 'bough'], ['вершина 1 м', 1, 2, 'top'], ['4 м', 4, 18, 'top']]) {
      fresh(); const q = Object.assign(longPart(len, kg, kind), { x: base.x, y: base.y, ang: 0.4 }); G.chunks = [q]; at(base.x + 70, base.y + 20, -1);
      Carry.pick('part', q, []); const J = jump(), seen = new Set();
      for (let i = 0; i < 60 * 14; i++) {
        const s = frame(), a = G.p.action; if (!a && Carry.st() === 'shoulder') break;
        if (!s) continue; J.step(s);
        if (a && a.s === 'lift') { const f = a.t / a.dur; seen.add(Math.min(5, Math.floor(f * 6))); if (a.got && s.T) { R.hit += hits(s); const ge = gripErr(s); if (ge > R.grip) { R.grip = ge; R.gw = `${nm} подъём ${f2(a.t / a.dur)} h ${JSON.stringify(s.h.map(h => h.map(f1)))} pins ${JSON.stringify(s.pins)} T ${s.T.map(f1)} B ${s.B.map(f1)}`; } if (!order(s)) R.ord++; } if (a.got && Carry.st() !== 'lift') R.st++; }
      }
      R.ph.push(`${nm}: фаз ${seen.size}/6 → ${Carry.st()}`); if (Carry.st() !== 'shoulder') R.st++;
      run(20); Carry.put('ground', []);
      for (let i = 0; i < 120; i++) { const s = frame(), a = G.p.action; if (s) { J.step(s); if (a && a.s === 'put' && s.T) { R.hit += hits(s); const ge = gripErr(s); if (ge > R.grip) { R.grip = ge; R.gw = `${nm} снять ${f2(a.t / a.dur)}`; } } } if (!a && i > 10) break; }
      if (Carry.st() !== 'free' || !G.chunks.includes(q)) R.st++;
      R.jump = Math.max(R.jump, J.max);
    }
    ok(R.st === 0, `🌲 подъём: ${R.ph.join(' · ')}; снять — лёг на снег (ошибок состояния ${R.st})`);
    ok(R.hit === 0 && R.ord === 0, `🦵 подъём/снять: на ногах ${R.hit}, слои ${R.ord}`);
    ok(R.grip <= 1.5, `✋ хват при подъёме/снятии ≤ ${f2(R.grip)} ед.${R.grip > 1.5 ? ' · ' + R.gw : ''}`);
    ok(R.jump <= 14, `📏 подъём/снять: концы за кадр ≤ ${f1(R.jump)} px (переход от лежащего на снегу — без скачка)`);
    // сбросить: быстро, на снег, рядом
    fresh(); at(base.x, base.y, 1); const q2 = longPart(2, 4, 'bough'); Carry.hand().p = [q2]; Carry.hand().st = 'shoulder'; run(6); const t0 = G.time; Carry.dropAll([]); run(50);
    ok(Carry.st() === 'free' && G.chunks.includes(q2) && Math.hypot(q2.x - G.p.x, q2.y - G.p.y) < 60, `💥 сбросить: ствол на снегу рядом (${f1(Math.hypot(q2.x - G.p.x, q2.y - G.p.y))} px) за ${f2(G.time - t0)} с`);
    const D = [[1, 2], [1, 4], [2, 2], [2, 4], [3, 8], [4, 18]].map(([l, k]) => Carry.liftDur({ len: l, mass: k })), up = D.every((v, i) => !i || v > D[i - 1]);
    ok(up, `⏱ подъём растёт с длиной/массой: ${D.map(f2).join(' < ')} с (1 м 2 кг … 4 м 18 кг)`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- волок: комель в кисти, мимо ног, борозда ----------
  try {
    fresh(); const t = G.trees.filter(t => t.wood > 0 && !t.wall && t.kind === 0 && t.stage !== 1 && Math.abs(t.x - HUT.x) > 400).sort((a, b) => dist2(a, base) - dist2(b, base))[0];
    at(t.x + 60, t.y + 40, -1); const L = Actions.fell(t); run(240); for (let i = 0; i < 3 && Actions.logCut(L) < 1; i++) Tree.split(L, 'limb'); G.chunks = [];
    L.x = base.x; L.y = base.y; L.a = Math.PI; at(base.x - 30, base.y + 4, 1);
    Carry.dragStart(L); for (let i = 0; i < 300 && Carry.st() !== 'drag'; i++) frame();
    let hit = 0, gr = 0, jm = 0, fr = 0, g15 = 0, lx = L.x, ly = L.y; const hd = {};
    for (const [dn, dx, dy] of DIRS.concat(DIRS)) { input.mx = dx; input.my = dy; run(30, s => { fr++; const h = dragHits(s); if (h) { hd[dn] = (hd[dn] || 0) + h; if (!hd.dbg) hd.dbg = [s.anc.drag && [f1(s.anc.drag.dx), f1(s.anc.drag.dy), f1(s.anc.drag.z)], f1(L.x - G.p.x), f1(L.y - G.p.y), f2(L.a), G.p.face, JSON.stringify(s.lg.map(l => l.map(v => +(v - (0)).toFixed(0))))]; } hit += h; const A = s.anc.drag; if (A) { const e = Math.hypot(L.x - (G.p.x + A.dx), L.y - (G.p.y + A.dy)); if (e <= 1.5) g15++; if (e > gr) { gr = e; hd.gw = dn + " " + fr + " " + Hero.pose().anim + " L " + f1(L.x - G.p.x) + "," + f1(L.y - G.p.y) + " A " + f1(A.dx) + "," + f1(A.dy); } } jm = Math.max(jm, Math.hypot(L.x - lx, L.y - ly)); lx = L.x; ly = L.y; }); }
    input.mx = input.my = 0;
    ok(Carry.st() === 'drag' && hit === 0, `🪵 волок (${Math.round(Carry.logKg(L))} кг, 16 участков по 8 направлениям): ствол после героя на ногах — ${hit} точек за ${fr} кадров${hit ? ' ' + JSON.stringify(hd) : ''}`);
    ok(g15 / fr >= 0.95 && jm <= 14, `✋ комель в кисти: ≤ 1,5 px в ${Math.round(g15 / fr * 100)} % кадров (кисть из прошлого кадра рисования), худший ${f1(gr)} px (${hd.gw}); за кадр ≤ ${f1(jm)} px; борозда ${Carry.FUR.length} точек`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- рюкзак: не поверх ноши ----------
  try {
    const donAt = []; const H0 = Carry.hit; Carry.hit = function (a, i) { if (a.s === 'don') donAt.push(Carry.st()); return H0.apply(this, arguments); };
    // охапка и рюкзак снят: «надеть» = положить → надеть → поднять те же
    fresh(); at(base.x, base.y, 1); G.inv = { wpelt: 6 }; Carry.hand().p = [Carry.partOf({ kg: 4, l: 5 }), Carry.partOf({ kg: 4.5, l: 5.6 })]; const ids = Carry.parts().map(q => q.id);
    G.hand.off = { x: base.x + 13, y: base.y + 3, f: 1, open: 0, t: G.time }; const seq = []; let la = null;
    Carry.closeDon([]); for (let i = 0; i < 60 * 16; i++) { const a = G.p.action; if (a && a !== la && a.j === 'carry') seq.push(a.s); la = a; frame(); if (!G.p.action && i > 30 && !Carry.off()) break; }
    const back = Carry.parts().map(q => q.id).sort().join() === ids.sort().join();
    ok(!Carry.off() && back && donAt.every(s => s === 'free' || s === 'hold') && seq.indexOf('put') >= 0 && seq.indexOf('put') < seq.indexOf('don'), `🎒 с охапкой: ${seq.join(' → ')} · надел при «${donAt.join(',')}», охапка снова в руках: ${back}`);
    // на ходу с ношей — рюкзак остаётся на снегу; с пустыми руками — подхватил
    fresh(); at(base.x, base.y, 1); Carry.hand().p = [longPart(2, 4, 'bough')]; Carry.hand().st = 'shoulder'; G.hand.off = { x: base.x + 13, y: base.y + 3, f: 1, open: 0, t: G.time };
    input.mx = -1; run(60); input.mx = 0; run(20); const left = !!Carry.off();
    fresh(); at(base.x, base.y, 1); G.hand.off = { x: base.x + 13, y: base.y + 3, f: 1, open: 0, t: G.time }; input.mx = -1; run(10); input.mx = 0; run(10); const took = !Carry.off();
    ok(left && took && donAt.every(s => s === 'free' || s === 'hold'), `🎒 пошёл с плечом — рюкзак остался на снегу: ${left}; с пустыми руками — подхватил на ходу: ${took}`);
    Carry.hit = H0;
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- надписи: не раньше прибытия, не над героем, отказ — один тост ----------
  try {
    const FT = Fx.floatText, TO = Fx.toast; let over = 0; const toasts = [];
    Fx.floatText = function (x, y, t) { if (Math.abs(x - G.p.x) < 40 && y < G.p.y && y > G.p.y - 90) over++; return FT.apply(this, arguments); };
    Fx.toast = m => toasts.push(m);
    fresh(); at(base.x, base.y, 1); G.inv = {};
    const q = Tree.parts(Tree.ensure({ x: G.trees[0].x, y: G.trees[0].y, s: G.trees[0].s, kind: G.trees[0].kind, v: G.trees[0].v })).find(q => q.kind === 'chunk');
    const c = Object.assign({}, q, { id: 8001, x: base.x + 20, y: base.y + 2, ang: 0, t: G.time - 5 }); G.chunks = [c];
    Carry.pick('part', c, []); let early = 0, chipAt = null, endAt = null;
    for (let i = 0; i < 120; i++) { frame(); const a = G.p.action, ch = Carry.chip(); if (ch && chipAt == null) chipAt = i; if (a && a.s === 'pick' && ch && ch.k === 'arms') early++; if (!a && endAt == null && Carry.st() === 'arms') endAt = i; }
    // рубка/раскряжёвка: надписей у места реза нет (вещь видна сама) — над героем тоже
    ok(early === 0 && chipAt != null && chipAt >= endAt - 1, `🏷 отметка «🪵 1/4» — в кадре ${chipAt}, охапка у груди — в кадре ${endAt} (раньше прибытия: ${early})`);
    fresh(); at(base.x, base.y, 1); G.inv = { wpelt: 6 }; Inv.put(G.inv, 'wood', 2, 9, 11); G.inv.wo = 2; Carry.hand().p = [Carry.partOf({ kg: 4, l: 5 })]; toasts.length = 0; Carry.stow([]); run(30);
    const t1 = toasts.slice(); toasts.length = 0; Carry.hand().p = [longPart(2, 4, 'bough')]; Carry.hand().st = 'shoulder'; Carry.stow([]); run(30);
    info('тосты: ' + JSON.stringify(t1) + ' / ' + JSON.stringify(toasts)); const own = a => a.filter(m => !/Перегруз/.test(m)); t1.splice(0, t1.length, ...own(t1)); ok(t1.length === 1 && /в охапке/.test(t1[0]) && toasts.length <= 1 && !/в охапке/.test(toasts.join()), `🚫 отказ — один тост: «${t1[0]}» · с плеча: «${toasts[0] || '—'}»`);
    ok(over === 0, `🙅 всплывашек над героем: ${over}`);
    Fx.floatText = FT; Fx.toast = TO;
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }

  // ---------- походка под грузом, нарты ----------
  try {
    const g0 = ArtPeople.gaitFor('walk', 90, 0, 0), g1 = ArtPeople.gaitFor('walk', 90, 0, 1), c0 = 90 * g0.duty / g0.St, c1 = 90 * g1.duty / g1.St;
    ok(Math.abs(g1.St / g0.St - 0.85) < 1e-6, `🚶 полный груз: шаг ×${f2(g1.St / g0.St)}, частота ×${f2(c1 / c0)} (при ld 0,4: ×${f2(1 / (1 - 0.06))})`);
    fresh(); G.gear.sled = 1; Inv.put(G.sled, 'wood', 10, 50, 63); at(base.x, base.y, 1); input.mx = 1; run(60); input.mx = 0; run(60);   // шёл и встал: нарты доехали по инерции
    const s0 = { x: G.p.sx, y: G.p.sy }; input.mx = 1; let t = null, maxT = 0;
    for (let i = 0; i < 90; i++) { frame(); if (t == null && Math.hypot(G.p.sx - s0.x, G.p.sy - s0.y) > 1) t = (i + 1) / 60; maxT = Math.max(maxT, Carry.sledT()); }
    input.mx = 0; const d = Math.hypot(G.p.x - G.p.sx, G.p.y - G.p.sy);
    ok(t != null && t >= 0.1 && t <= 0.25 && d < 48, `🛷 нарты тронулись через ${t != null ? Math.round(t * 1000) : '—'} мс (100–200), верёвка ${f1(d)} px, натяжение до ${f2(maxT)}`);
  } catch (e) { ok(false, 'ERR ' + (e.stack || e).toString().split('\n').slice(0, 2).join(' ')); }
  ArtPeople.draw = D0;
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = []; let out = [];
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await pg.route(/^https?:/, r => r.abort());
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Carry !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); });
    out = await pg.evaluate(`(${page})()`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n').slice(0, 3).join(' ')); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: carry-geom · провалов ${bad}` : '\nOK: carry-geom · ноша: геометрия, хват, слои, состояние');
  process.exit(bad ? 1 : 0);
})();
