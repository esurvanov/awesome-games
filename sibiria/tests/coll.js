// Столкновения (js/content/footprints.js → World.solid):
//  A. инвариант подножий: для каждой вещи подножие внутри рамки картинки и закрывает ≥ 80 % непрозрачных точек нижней полосы
//     (рисунок вещи — теми же функциями, что рисует игра, на пустом холсте; тонкие — свой круг ≤ 6 px)
//  B. линии героя: сетка прямых через каждую вещь мира (места, объекты зон, мебель, транспорт, глыбы, деревья) —
//     шагами 4 и 10 px (пешком / «Буран») с World.solid; ни одна линия не проходит насквозь (центр героя ни разу внутри подножия)
//  C. ходоки: волки, медведь, колонисты, NPC, олени, зайцы — живой update() 60 с; ни один не заходит в ствол/глыбу/подножие,
//     NPC доходят до точек распорядка; расталкивание (r1 + r2) и укус волка на дистанции
//   cd tests && node coll.js            (COLL_SHOT=1 — ещё картинка подножий tests/shots/coll-foot.png)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function partA() {
  window.SNOW_OFF = 1;
  const env = { now: 0, night: 0, wind: 0, light() {}, glow() {} };
  const D = {
    mi8: g => ArtWorld.paintMi8(g), tail: g => ArtWorld.paintTail(g), chum: g => ArtWorld.paintChum(g), labaz: g => ArtWorld.paintLabaz(g),
    urkSled: g => ArtWorld.sled(g, 0, 0, 0, 1),
    stove: g => ArtWorld.hutStove(g, 0, 0, { fuel: 0, pipeTop: -40 }, env), bench: g => ArtWorld.hutBench(g, 0, 0, { bench: 1 }, env),
    chest: g => ArtWorld.hutChest(g, 0, 0), bed: g => ArtWorld.hutBed(g, 0, 0),
    vBuran: g => ArtZones.buran(g, { x: 0, y: 0, face: 1, fixed: 0 }, env, false), vDeer: g => ArtZones.deerSled(g, { x: 0, y: 0, face: 1 }, env),
    sleds: g => ArtZones.obj(g, { type: 'sleds', x: 0, y: 0 }, env), rock: g => ArtZones.rock(g, { x: 0, y: 0, s: 1, v: 0 }),
  };
  for (const id of ['sign', 'pennant', 'barrel', 'buran', 'lenin', 'pole']) D[id] = g => ArtWorld.inspect(g, { id, x: 0, y: 0 }, env);
  for (const k in ArtZones.OBJ) D[k] = g => ArtZones.obj(g, { type: k, x: 0, y: 0 }, env);
  const W0 = 440, H0 = 340, OX = 220, OY = 250, res = [], shots = {};
  const inShape = (s, x, y) => s.length === 3 ? (x - s[0]) ** 2 + (y - s[1]) ** 2 <= s[2] * s[2] : x >= s[0] && x <= s[2] && y >= s[1] && y <= s[3];
  const bbox = s => s.length === 3 ? [s[0] - s[2], s[1] - s[2], s[0] + s[2], s[1] + s[2]] : s;
  for (const key in FOOT) {
    const F = FOOT[key]; if (F.alias) continue;
    if (!D[key]) { res.push({ key, err: 'нет рисунка' }); continue; }
    const cv = document.createElement('canvas'); cv.width = W0; cv.height = H0; const g = cv.getContext('2d');
    g.translate(OX, OY); D[key](g);
    const px = g.getImageData(0, 0, W0, H0).data, shapes = F.fp.map(s => s.s || s);
    const inside = shapes.every(s => { const b = bbox(s); return b[0] >= F.img[0] && b[1] >= F.img[1] && b[2] <= F.img[2] && b[3] <= F.img[3]; });
    let n = 0, hit = 0;
    if (!F.thin) {
      const [bx0, by0, bx1, by1] = F.band;
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const X = x + OX, Y = y + OY; if (X < 0 || Y < 0 || X >= W0 || Y >= H0) continue;
        if (px[(Y * W0 + X) * 4 + 3] < 150) continue;
        n++; if (shapes.some(s => inShape(s, x + 0.5, y + 0.5))) hit++;
      }
    }
    const cover = F.thin ? null : n ? hit / n : 0;
    const thinOk = !F.thin || (shapes.length === 1 && shapes[0].length === 3 && shapes[0][2] <= 6);
    res.push({ key, inside, cover: cover == null ? null : +cover.toFixed(3), n, thin: !!F.thin, ok: inside && thinOk && (F.thin || cover >= 0.8) });
    // картинка: рисунок + полоса + подножие
    g.setTransform(1, 0, 0, 1, OX, OY); g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,255,0.8)'; g.strokeRect(F.img[0], F.img[1], F.img[2] - F.img[0], F.img[3] - F.img[1]);
    if (F.band) { g.strokeStyle = 'rgba(255,200,0,0.9)'; g.strokeRect(F.band[0], F.band[1], F.band[2] - F.band[0], F.band[3] - F.band[1]); }
    g.fillStyle = 'rgba(255,0,0,0.35)'; g.strokeStyle = '#f00';
    for (const s of shapes) { g.beginPath(); if (s.length === 3) g.arc(s[0], s[1], s[2], 0, 7); else g.rect(s[0], s[1], s[2] - s[0], s[3] - s[1]); g.fill(); g.stroke(); }
    shots[key] = cv.toDataURL();
  }
  return { res, shots };
}

function partB() {
  const out = [], fails = [];
  const p = G.p, save = { x: p.x, y: p.y, inside: p.inside };
  const R = 10;
  // все преграды: подножия (World.COLL + транспорт) + выборка глыб и деревьев
  const list = World.COLL.filter(c => !(c.o && c.o.need && !Zones.here(c.o))).map(c => ({ name: c.key + (c.o && c.o.id ? ':' + c.o.id : ''), sh: c.sh, bb: [c.x0, c.y0, c.x1, c.y1] }));
  for (const v of World.vehFoot()) list.push({ name: v.key, sh: v.sh, bb: [v.x0, v.y0, v.x1, v.y1] });
  const rocks = G.rocks.filter((q, i) => i % Math.max(1, (G.rocks.length / 30) | 0) === 0).slice(0, 30);
  for (const q of rocks) { const c = World.rockFoot(q); list.push({ name: 'rock', sh: c.sh, bb: [c.x0, c.y0, c.x1, c.y1] }); }
  const trees = G.trees.filter(t => t.wood > 0 && !t.wall);
  for (let i = 0; i < 40; i++) { const t = trees[(i * 7919) % trees.length], r = World.trunkR(t); list.push({ name: 'tree', sh: [{ t: 1, cx: t.x, cy: t.y, cr: r }], bb: [t.x - r, t.y - r, t.x + r, t.y + r] }); }
  const inAny = (sh, x, y) => sh.some(s => s.t === 1 ? (x - s.cx) ** 2 + (y - s.cy) ** 2 < (s.cr - 0.5) ** 2 : x > s.x0 + 0.5 && x < s.x1 - 0.5 && y > s.y0 + 0.5 && y < s.y1 - 0.5);
  // отрезок пересекает внутренность фигуры (сжатой на 0.5 px)?
  function segHits(sh, ax, ay, bx, by) {
    for (const s of sh) {
      if (s.t === 1) {
        const dx = bx - ax, dy = by - ay, fx = ax - s.cx, fy = ay - s.cy, l2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, -(fx * dx + fy * dy) / l2)), qx = fx + dx * t, qy = fy + dy * t;
        if (qx * qx + qy * qy < (s.cr - 0.5) ** 2) return true;
      } else {
        let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay, x0 = s.x0 + 0.5, x1 = s.x1 - 0.5, y0 = s.y0 + 0.5, y1 = s.y1 - 0.5;
        const clip = (pp, q) => { if (Math.abs(pp) < 1e-9) return q >= 0; const r = q / pp; if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
        if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 < t1) return true;
      }
    }
    return false;
  }
  let lines = 0, through = 0;
  for (const L of list) {
    const [x0, y0, x1, y1] = L.bb, w = x1 - x0, h = y1 - y0;
    const paths = [];
    for (let k = 0; k <= 6; k++) { const y = y0 + h * k / 6, x = x0 + w * k / 6; paths.push([x0 - 40, y, x1 + 40, y], [x1 + 40, y, x0 - 40, y], [x, y0 - 40, x, y1 + 40], [x, y1 + 40, x, y0 - 40]); }
    for (const step of [4, 10]) for (const [ax, ay, bx, by] of paths) {
      lines++;
      p.x = ax; p.y = ay; World.solid(p, R, 'p');
      const d = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / d, uy = (by - ay) / d; let bad = false;
      let px0 = p.x, py0 = p.y;
      for (let s = 0; s < d / step + 10; s++) {
        p.x += ux * step; p.y += uy * step; World.solid(p, R, 'p');
        // насквозь: центр героя внутри подножия или путь центра за шаг (после выталкивания) пересёк подножие
        if (inAny(L.sh, p.x, p.y) || segHits(L.sh, px0, py0, p.x, p.y)) { bad = true; break; }
        px0 = p.x; py0 = p.y;
      }
      if (bad) { through++; if (fails.length < 12) fails.push(`${L.name} ${step}px ${[ax, ay, bx, by].map(Math.round)} → ${Math.round(p.x)},${Math.round(p.y)}`); }
    }
  }
  p.x = save.x; p.y = save.y; p.inside = save.inside;
  return { objects: list.length, lines, through, fails };
}

function partC() {
  const p = G.p, out = {};
  const inFoot = (x, y) => {
    for (const c of World.COLL) {
      if (c.o && c.o.need && !Zones.here(c.o)) continue;
      if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) continue;
      for (const q of c.sh) if (q.t ? (x - q.cx) ** 2 + (y - q.cy) ** 2 < (q.cr - 0.5) ** 2 : x > q.x0 + 0.5 && x < q.x1 - 0.5 && y > q.y0 + 0.5 && y < q.y1 - 0.5) return c.key;
    }
    return null;
  };
  const inTrunk = (x, y) => { for (const t of treesNear(x, y, 30)) if (t.wood > 0 && (x - t.x) ** 2 + (y - t.y) ** 2 < (World.trunkR(t) - 0.5) ** 2) return t; return null; };
  const inRock = (x, y) => { for (const q of Space.rocks.near(x, y, 50)) for (const s of World.rockFoot(q).sh) if (x > s.x0 + 0.5 && x < s.x1 - 0.5 && y > s.y0 + 0.5 && y < s.y1 - 0.5) return q; return null; };
  // лесное место: больше всего стволов в радиусе 250, вдали от избы
  let best = null, bn = -1;
  for (let i = 0; i < 400; i++) {
    // вдали от избы и от края мира: у края — стена ёлок (t.wall, не рубятся) с подлеском, плотнее любого леса, но там герой упирается
    // в край мира (clamp), а олени/медведь теста ставятся за край — это уже не «ходоки в лесу»
    const t = G.trees[(i * 104729) % G.trees.length]; if (t.wall || Math.hypot(t.x - HUT.x, t.y - HUT.y) < 900 || Math.min(t.x, t.y, W - t.x, H - t.y) < 500) continue;
    const n = treesNear(t.x, t.y, 250).filter(q => q.wood > 0 && !q.wall).length; if (n > bn) { bn = n; best = t; }
  }
  const spot = World.freeNear(best.x + 30, best.y + 30, 12);
  p.x = spot.x; p.y = spot.y; p.inside = false; Hero.snap();
  G.time = tAt(2, 23); G.storm = null;
  G.wolves = []; G.D = G.D || {}; G.D.dir = 0; Wolves.spawnPack(4, false);
  G.bear = { x: p.x + 260, y: p.y + 60, hp: 999, hp0: 999, st: 'hunt', t: 3, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0, finalStand: true };
  for (let i = 0; i < 6; i++) G.deer.push({ x: p.x - 200 + i * 40, y: p.y - 120, vx: 0, vy: 0, t: 0, face: 1, ph: i, hx: p.x + 300, hy: p.y + 200 });
  for (let i = 0; i < 12; i++) Fauna.spawnHare(false);
  let bites = 0, frames = 0, bad = [], minGap = 1e9, gapWho = '';
  const sb = Sound.bite; Sound.bite = function () { bites++; return sb.apply(this, arguments); };
  const walkers = () => {
    const a = [];
    for (const w of G.wolves) a.push(['волк', w, 12]); if (G.bear) a.push(['медведь', G.bear, 20]);
    for (const d of G.deer) a.push(['олень', d, 12]); for (const h of G.hares) a.push(['заяц', h, 5]);
    if (G.col) for (const u of G.col.units) if (!u.hidden) a.push(['посёлок', u, 7]);
    for (const n of Npc.list()) if (n.st && n.st.x != null && !(n.id === 'urk' && n.st.state === 'away') && n.st.state !== 'dead') a.push(['npc ' + n.id, n.st, 9]);
    return a;
  };
  const DT = 1 / 30;
  for (let f = 0; f < 60 * 30; f++) {
    G.s.hp = 1e9; G.s.warm = 100; G.s.food = 100;
    if (G.bear) { G.bear.hp = 999; if (G.bear.st === 'flee' || G.bear.st === 'fleeHurt') G.bear.st = 'hunt'; }
    if (!G.wolves.length) { G.D.dir = f; Wolves.spawnPack(3, false); }
    update(DT); frames++;
    if (f < 5) continue;
    for (const [k, o, r] of walkers()) {
      const t = inTrunk(o.x, o.y), q = !t && inRock(o.x, o.y), c = !t && !q && inFoot(o.x, o.y);
      if ((t || q || c) && bad.length < 12) bad.push(`${k} в ${t ? 'стволе' : q ? 'глыбе' : c} @${Math.round(o.x)},${Math.round(o.y)}`);
      if (t || q || c) out.cnt = (out.cnt || 0) + 1;
    }
    // зазор героя с телами: не меньше r1 + r2 (допуск 2.5 px: герой зажат между телом и стволом)
    for (const [k, o, r] of walkers()) { const g = Math.hypot(o.x - p.x, o.y - p.y) - (r === 20 ? 18 : r) - 10; if (g < minGap) { minGap = g; gapWho = k; } }
  }
  Sound.bite = sb;
  out.frames = frames; out.inside = out.cnt || 0; out.bad = bad; out.bites = bites; out.minGap = +minGap.toFixed(2); out.gapWho = gapWho; out.trees = bn;
  // NPC: сюжетные подходы и распорядок — дойти до точки у вещей (≤ 60 с)
  const trips = [];
  const tgts = [['к двери избы', HUT.x, HUT_IN.y1 + 30], ['к Ми-8', POI.cockpit.x, POI.cockpit.y], ['к хвосту', POI.tail.x, POI.tail.y], ['к чуму', POI.chum.x, POI.chum.y + 40], ['к лабазу', POI.labaz.x, POI.labaz.y]];
  for (const o of Zones.OBJS) if (o.foot && !o.foot.o.need && ['lodge', 'zaimka', 'meteoHouse', 'factory', 'ural', 'rig', 'balokSkid', 'burntBalok', 'booth', 'mast'].includes(o.type)) tgts.push(['к ' + o.id, o.x, o.y + 34]);
  for (const [name, tx, ty] of tgts) {
    const u = { x: 0, y: 0, face: 1, step: 0, state: 'go' }, st0 = World.freeNear(tx - 260, ty - 220, 12);
    u.x = st0.x; u.y = st0.y;
    const b = { to: () => ({ x: tx, y: ty }), speed: 60, arrive: 'done' };
    let t = 0; for (; t < 60 && u.state !== 'done'; t += DT) { G.time += DT; Npc.MOVES.goto(u, b, DT); }
    const fr = World.freeNear(tx, ty, 9);
    trips.push({ name, ok: u.state === 'done' && Math.hypot(u.x - fr.x, u.y - fr.y) < 60, t: +t.toFixed(1), left: Math.round(Math.hypot(u.x - fr.x, u.y - fr.y)) });
  }
  out.trips = trips;
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
  const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await pg.goto(URL); await pg.waitForTimeout(400);
  await pg.click('#start'); await pg.waitForTimeout(1200);
  let fail = 0;
  // ---- A ----
  const A = await pg.evaluate(partA);
  for (const r of A.res) {
    if (!r.ok) fail++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} A ${r.key.padEnd(11)} ${r.err || (r.thin ? 'тонкая' : 'полоса ' + Math.round(r.cover * 100) + '%') + (r.inside ? '' : ' · вне рамки картинки')}`);
  }
  if (process.env.COLL_SHOT) {
    const html = '<body style="background:#6a8;margin:0">' + Object.entries(A.shots).map(([k, u]) => `<div style="display:inline-block;position:relative;margin:2px"><img src="${u}" width=440 height=340><b style="position:absolute;left:4px;top:2px;font:12px sans-serif">${k}</b></div>`).join('') + '</body>';
    const f = path.join(__dirname, 'shots', 'coll-foot.html'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html);
    const p2 = await b.newPage({ viewport: { width: 1790, height: 900 } }); await p2.goto('file://' + f); await p2.screenshot({ path: path.join(__dirname, 'shots', 'coll-foot.png'), fullPage: true }); await p2.close();
  }
  // ---- B ----
  await pg.evaluate(() => { Story.tick = () => {}; Director.tick = () => {}; document.querySelectorAll('#dialog,#note,#chapter').forEach(e => e.hidden = true); G.s.hp = 1e9; });
  const B = await pg.evaluate(partB);
  console.log(`${B.through ? 'FAIL' : 'ok  '} B линии героя: ${B.objects} вещей · ${B.lines} линий · насквозь ${B.through}`);
  for (const f of B.fails) console.log('       ' + f);
  if (B.through) fail++;
  // ---- C ----
  const C = await pg.evaluate(partC);
  const cOk = !C.inside, gOk = C.minGap > -2.5, bOk = C.bites > 0;
  console.log(`${cOk ? 'ok  ' : 'FAIL'} C ходоки в лесу (${C.trees} стволов рядом, ${C.frames} кадров): внутри ствола/глыбы/вещи ${C.inside}`);
  for (const f of C.bad) console.log('       ' + f);
  console.log(`${gOk ? 'ok  ' : 'FAIL'} C зазор героя с телами ≥ r1 + r2 (−2.5 px — зажат между телом и стволом): мин ${C.minGap} px (${C.gapWho})`);
  console.log(`${bOk ? 'ok  ' : 'FAIL'} C укусы/удары волков и медведя: ${C.bites}`);
  for (const t of C.trips) console.log(`${t.ok ? 'ok  ' : 'FAIL'} C NPC ${t.name.padEnd(18)} ${t.ok ? t.t + ' с' : 'не дошёл, осталось ' + t.left + ' px'}`);
  fail += !cOk + !gOk + !bOk + C.trips.filter(t => !t.ok).length;
  if (errs.length) { console.log('PAGEERR ' + errs.slice(0, 3).join(' | ')); fail++; }
  await b.close();
  console.log(fail ? `\nFAIL: ${fail}` : '\nвсё ok');
  process.exit(fail ? 1 : 0);
})();
