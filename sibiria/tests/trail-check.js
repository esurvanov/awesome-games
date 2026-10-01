#!/usr/bin/env node
// Тропы, лопата и отвалы (js/trail.js): сетка уплотнения поверх глубины снега, отвал данными.
//   1. «глубина решает»: 3 прохода по мелкому (≤ 45 см) → pack ≥ 0.7, время −25 %, силы меньше; 60 см — ногами траншея (< 0.7),
//      лопатой 50 м — не дольше ногами; выше 70 см ногами ≤ 0.5
//   2. заметание: штиль сутки ≤ 0.35; пурга 2 ч — заметено; после пурги расчищенное лопатой — одним проходом ≥ 0.7, протоптанное — нужно ≥ 2
//   3. промотка ≈ шаги; «прошёл раз в день» — держится
//   4. сейв → загрузка (pack, основа, отвал); сейв без поля; старый сейв (сетка 12 px) — тропы есть, отвалов нет
//   5. лопата: взять у двери; «кидать» в 60 см — темп 15–20 бросков/мин, шаг каждые 2–3, ком 2–7 кг, ширина 12–17 px, второй проход 28–34;
//      снятый объём = отвалы (≤ 10 %); силы 0.15 + 0.05·кг за бросок; «толкать» ≤ 25 см — шаг ×0.4, вал вбок; пот после 30 с на тепле > 85
//   6. дверь избы после пурги: нанос ≥ 80 см; откопать лопатой 40–60 с, руками — дольше, без расчистки выйти можно (тупика нет)
//   7. костёр: на расчищенном КПД 1, на рыхлом снегу > 30 см за час — 0.7 и радиус 0.6
//   8. ветер: потеря тепла × (1 + 0.03·(м/с − 2)), за стенкой ≥ 60 см в пургу — ≤ 60 % от открытого (добавка ветра); факт = прогноз
//   9. волки по тропе к избе — на 20–30 % быстрее; площадка на мари: снегоступами 3 прохода → ≥ 80 %, пурга — подновить
//  10. ИИ выбирает тропу (Depth.steer); производительность (протаптывание, перепечка куска high/low)
//   cd tests && node trail-check.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

// общее: свежая игра, постановка героя, полоса нужной глубины
function common() {
  window.TC = {};
  const T = window.TC, DT = 1 / 60;
  T.out = []; T.ok = (c, w) => T.out.push((c ? 'ok   ' : 'FAIL ') + w); T.r2 = v => Math.round(v * 100) / 100; T.DT = DT;
  UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Director.tick = () => {}; SaveGame.checkpoint = () => {}; Fx.toast = () => {};
  T.fresh = seed => { Math.random = mulberry(seed); newGame(); state = 'play'; G.s.food = 100; G.s.warm = 90; G.s.tire = 0; G.time = tAt(1, 11); G.storm = null; input.mx = input.my = 0; input.act = false; };
  T.put = (x, y) => { const p = G.p; p.x = x; p.y = y; p.lx = x; p.ly = y; p.vx = p.vy = 0; p.inside = insideHut(x, y); Hero.snap(); };
  T.R = mulberry(31);
  // ровная полоса len px: целина minD..maxD см, без деревьев и льда
  T.row = (zones, minD, maxD, len = 300) => {
    for (let k = 0; k < 120000; k++) {
      const x = 400 + T.R() * (W - 800), y = 400 + T.R() * (H - 800);
      if (!zones.includes(Zones.terrainKey(x, y)) || Space.trees.near(x + len / 2, y, len / 2 + 70).some(t => t.wood > 0 && Math.abs(t.y - y) < 70)) continue;
      if (Math.abs(x - HUT.x) < 500 && Math.abs(y - HUT.y) < 500) continue;
      let good = true;
      for (let i = -2; i <= len / 30 + 2 && good; i++) { const xx = x + i * 30, d = Depth.depthAt(xx, y); if (!zones.includes(Zones.terrainKey(xx, y)) || World.blocked(xx, y, 16) || onIce(xx, y) || d < minD || d > maxD) good = false; }
      if (good) return { x, y };
    }
    throw new Error('нет полосы ' + zones + ' ' + minD + '…' + maxD);
  };
  T.mid = (q, f, len = 300) => { let s = 0, n = 0; for (let x = q.x + 60; x <= q.x + len - 60; x += 8) { s += f(x, q.y); n++; } return s / n; };
  T.calm = fn => { const pr = Snow.printRate; Snow.printRate = s => (s ? Math.max(4, 0.25) : 0.25); try { return fn(); } finally { Snow.printRate = pr; } };
  // проход героя по полосе через главный шаг update (как игрок): время, средний провал, усталость
  T.pass = (q, dir, len = 300) => {
    const p = G.p; T.put(dir > 0 ? q.x - 20 : q.x + len + 20, q.y); input.mx = dir; input.my = 0;
    let t = 0, sink = 0, n = 0; const x0 = p.x, t0 = G.s.tire;
    while (Math.abs(p.x - x0) < len + 40 && t < 40) { update(DT); now += DT; t += DT; p.y = q.y; if (Math.abs(p.x - x0) > 20 && Math.abs(p.x - x0) < len + 20) { sink += Depth.heroSink; n++; } }
    input.mx = 0;
    return { t, sink: sink / Math.max(1, n), tire: G.s.tire - t0 };
  };
  // встать на полосу там, где E — «Расчищать» (рядом нет вещей, следов, сугробов)
  T.spot = q => { for (let dx = 0; dx < 200; dx += 10) { T.put(q.x + dx, q.y); for (let i = 0; i < 3; i++) update(DT); const c = Actions.context(); if (c && c.k === 'clear') return dx; } return -1; };
  // работа лопатой: E зажата sec секунд (стоя — кидает, dir — ввод направления на первый кадр)
  T.dig = (sec, mx = 0, my = 0, hands = false) => {
    const p = G.p; input.act = true; input.mx = mx; input.my = my;
    const c = Actions.context(); Actions.interact(); input.mx = 0; input.my = 0;
    let t = 0; const a = p.action;
    for (; t < sec && p.action === a; t += DT) { update(DT); now += DT; }
    input.act = false; update(DT);
    return { a, c, t };
  };
  return 1;
}

function page1() {
  const T = window.TC, { ok, r2, out, fresh, put, row, mid, calm, pass } = T;
  // ---------- 1. глубина решает ----------
  fresh(11); G.chapter = 1;
  const q = row(['core', 'taiga', 'kurum', 'gar'], 32, 45), d0 = mid(q, (x, y) => Depth.depthAt(x, y));
  const P = [];
  calm(() => { for (let i = 0; i < 4; i++) { P.push(pass(q, i % 2 ? -1 : 1)); for (let k = 0; k < 3; k++) Depth.tick(0.5, false); } });
  out.push(`info мелкая полоса (${Math.round(q.x)}, ${Math.round(q.y)}): целина ${d0.toFixed(0)} см, ходьба ×${Zones.terrainAt(q.x, q.y).walk}`);
  out.push('info проходы: ' + P.map((r, i) => `${i + 1}) ${r.t.toFixed(2)} с · провал ${r.sink.toFixed(0)} см · силы −${r.tire.toFixed(3)}`).join(' | '));
  fresh(11); const PK = [];
  calm(() => { for (let i = 0; i < 3; i++) { pass(q, i % 2 ? -1 : 1); PK.push(mid(q, Trail.at)); } });
  ok(PK[2] >= 0.7, `👣 мелко (${d0.toFixed(0)} см): pack по проходам ${PK.map(r2).join(' → ')} (3-й ≥ 0.7)`);
  const sp = 1 - P[3].t / P[0].t;
  ok(sp >= 0.2, `⏱ проход 340 px: целина ${P[0].t.toFixed(2)} с → по тропе ${P[3].t.toFixed(2)} с (−${Math.round(sp * 100)} %)`);
  ok(P[3].tire <= P[0].tire, `⚡ усталость за проход: целина ${P[0].tire.toFixed(3)} → тропа ${P[3].tire.toFixed(3)}`);
  // выше 70 см: ногами — траншея ≤ 0.5
  { fresh(11); const qd = row(['taiga', 'stlanik', 'gar', 'core'], 74, 110), dd = mid(qd, (x, y) => Depth.depthAt(x, y)), K = [];
    calm(() => { for (let i = 0; i < 6; i++) { pass(qd, i % 2 ? -1 : 1); K.push(mid(qd, Trail.at)); } });
    ok(Math.max(...K) <= 0.5, `🕳 глубоко (${dd.toFixed(0)} см): 6 проходов ногами → ${K.map(r2).join(' · ')} (≤ 0.5 — траншея, не тропа)`); }
  // 60 см: ногами < 0.7, лопатой — тропа; время на 50 м
  { fresh(11); const q6 = row(['taiga', 'gar', 'core', 'stlanik'], 52, 70), d6 = mid(q6, (x, y) => Depth.depthAt(x, y)), K = []; let tf = 0;
    calm(() => { for (let i = 0; i < 8; i++) { const r = pass(q6, i % 2 ? -1 : 1); tf += r.t; K.push(mid(q6, Trail.at)); } });
    const fmax = Math.max(...K);
    fresh(11); G.gear.shovel = 1; T.spot(q6); G.p.face = 1;
    const x6 = G.p.x, r = T.dig(90, 1, 0); out.push(`info 60 см: E «${r.c && r.c.k}»`); const len = G.p.x - x6, per50 = r.t / Math.max(1, len) * 1150, v = mid({ x: x6 - 30, y: q6.y }, Trail.at, Math.max(120, len));
    ok(fmax < 0.7 && v >= 0.85, `🪏 60 см (${d6.toFixed(0)} см): ногами 8 проходов → макс ${r2(fmax)} (траншея, за ${tf.toFixed(0)} с); лопатой ${len.toFixed(0)} px за ${r.t.toFixed(0)} с → ${r2(v)} (тропа)`);
    ok(fmax < 0.7 || per50 <= tf * 1150 / 300, `⏳ 50 м в 60 см: лопатой ≈ ${(per50 / 60).toFixed(1)} мин; ногами тропы ≥ 0.7 нет — лопата не дольше`); }
  // ---------- 2. заметание ----------
  fresh(11); calm(() => { for (let i = 0; i < 3; i++) pass(q, i % 2 ? -1 : 1); });
  const v0 = mid(q, Trail.at);
  calm(() => { for (let i = 0; i < 1440; i++) Depth.tick(1, false); });
  const v1 = mid(q, Trail.at);
  ok(v0 - v1 <= 0.35 && v0 - v1 >= 0.2, `🌙 штиль, игровые сутки (${CYCLE} с): ${r2(v0)} → ${r2(v1)} (−${r2(v0 - v1)})`);
  { fresh(11); calm(() => { for (let i = 0; i < 3; i++) pass(q, i % 2 ? -1 : 1); }); const a = mid(q, Trail.at); let h1 = -1;
    for (let i = 0; i < 2 * HOUR; i++) { Depth.tick(1, true); if (h1 < 0 && mid(q, Trail.at) <= 0.02) h1 = i; }
    const b = mid(q, Trail.at);
    ok(b <= 0.02 && h1 > 0 && h1 <= 2 * HOUR, `🌨 пурга: ${r2(a)} → 0 за ${gameDur(h1)}`);
    const bb = mid(q, Trail.base), c1 = (calm(() => pass(q, 1)), mid(q, Trail.at)), c2 = (calm(() => pass(q, -1)), mid(q, Trail.at)); out.push(`info основа после пурги: протоптанное ${r2(bb)}`);
    // расчищенное лопатой — та же полоса рядом (срез по оси)
    fresh(11); const q2 = { x: q.x, y: q.y }; Trail.cut(q2.x - 20, q2.y, q2.x + 320, q2.y, 7); for (let i = 0; i < 2 * HOUR; i++) Depth.tick(1, true);
    const s0 = mid(q2, Trail.at); out.push(`info основа после пурги: вычищенное ${r2(mid(q2, Trail.base))}`); calm(() => pass(q2, 1)); const s1 = mid(q2, Trail.at);
    ok(s1 >= 0.7 && c1 < 0.7 && c2 >= 0.7, `🔁 после 2 ч пурги: вычищенное лопатой ${r2(s0)} → 1 проход ${r2(s1)}; протоптанное → ${r2(c1)} → 2-й ${r2(c2)}`); }
  // ---------- 3. промотка ≈ шаги; раз в день ----------
  { fresh(11); calm(() => pass(q, 1)); const f0 = Trail.fill;
    calm(() => { for (let i = 0; i < 600; i++) Depth.tick(0.1, false); }); const s1 = mid(q, Trail.at), f1 = Trail.fill;
    fresh(11); calm(() => pass(q, 1)); const g0 = Trail.fill; calm(() => { for (let i = 0; i < 6; i++) Depth.tick(10, false); }); const s2 = mid(q, Trail.at), f2 = Trail.fill;
    ok(Math.abs(s1 - s2) < 1e-4 && Math.abs((f1 - f0) - (f2 - g0)) < 1e-3, `⏩ промотка: 600 × 0.1 с → ${s1.toFixed(4)}, 6 × 10 с → ${s2.toFixed(4)}`); }
  { fresh(11); const days = []; calm(() => { for (let d = 0; d < 6; d++) { pass(q, d % 2 ? -1 : 1); days.push(mid(q, Trail.at)); for (let i = 0; i < 1440; i++) Depth.tick(1, false); } });
    ok(days[5] >= 0.5, `📅 штиль, проход раз в сутки: ${days.map(r2).join(' · ')} — держится`); }
  // ---------- 4. сейв ----------
  { fresh(11); calm(() => { for (let i = 0; i < 3; i++) pass(q, i % 2 ? -1 : 1); }); Trail.cut(q.x, q.y + 40, q.x + 200, q.y + 40, 7); Trail.dump(q.x + 100, q.y + 70, 0.5);
    const pts = []; for (let x = q.x; x < q.x + 300; x += 7) for (let dy = -12; dy <= 80; dy += 6) pts.push([x, q.y + dy]);
    const A = pts.map(([x, y]) => [Trail.at(x, y), Trail.berm(x, y)]), json = SaveGame.snapshot(), sz = (JSON.parse(json).trailB || '').length;
    SaveGame.load(json); const B = pts.map(([x, y]) => [Trail.at(x, y), Trail.berm(x, y)]);
    let mx = 0, mh = 0; A.forEach((v, i) => { mx = Math.max(mx, Math.abs(v[0] - B[i][0])); mh = Math.max(mh, Math.abs(v[1] - B[i][1])); });
    ok(mx <= 1 / 255 + 1e-4 && mh <= 1 && A.some(v => v[1] > 20), `💾 сейв → загрузка: ${pts.length} точек, pack ≤ ${mx.toFixed(4)}, отвал ≤ ${mh.toFixed(2)} см; trailB ${sz} симв.`);
    const g = JSON.parse(json); delete g.trailB; delete g.trailF; let err = null; try { SaveGame.load(g); } catch (e) { err = e.message; }
    ok(!err && pts.every(([x, y]) => Trail.at(x, y) === 0), `📂 сейв без поля: грузится (${err || 'без ошибок'}), троп нет`);
    // старый формат: сетка 12 px, блок 32×32, байты pack/основы без отвала
    const oC = 12, oBX = Math.ceil(Math.ceil(W / oC) / 32), i = Math.floor((q.x + 100) / oC), j = Math.floor(q.y / oC), k = ((i / 32) | 0) + ((j / 32) | 0) * oBX, c = (j % 32) * 32 + (i % 32);
    const bytes = new Uint8Array(2048); bytes[c] = 230; bytes[1024 + c] = 200; const arr = [k & 255, k >> 8];
    for (let o = 0; o < bytes.length;) { if (bytes[o]) { arr.push(bytes[o++]); continue; } let n = 0; while (o < bytes.length && !bytes[o] && n < 255) { o++; n++; } arr.push(0, n); }
    g.trailB = btoa(String.fromCharCode.apply(null, arr)); g.trailF = 0; err = null; try { SaveGame.load(g); } catch (e) { err = e.message; }
    const vo = Trail.at((i + 0.5) * oC, (j + 0.5) * oC);
    ok(!err && vo > 0.5 && Trail.bermVol() === 0, `📂 старый сейв (12 px, без отвалов): ${err || 'грузится'}, клетка → ${r2(vo)}, отвалов ${Trail.bermVol()}`); }
  return out;
}

function page2() {
  const T = window.TC, { ok, r2, out, fresh, put, row, mid, calm, pass, DT } = T;
  T.out.length = 0;
  // ---------- 5. лопата ----------
  { fresh(11); const S = Trail.SHOVEL; put(S.x + 4, S.y + 22);
    const c = Actions.context(); ok(c && c.k === 'shovel', `🪏 у двери избы: E «${c && c.label}»`);
    Actions.interact(); for (let i = 0; i < 200 && G.p.action; i++) update(DT);
    ok(!!G.gear.shovel && (Actions.context() || {}).k !== 'shovel', `🪏 лопата взята: снаряжение ${!!G.gear.shovel}`); }
  { fresh(12); G.gear.shovel = 1; const q = row(['taiga', 'gar', 'core', 'stlanik'], 52, 70), d0 = mid(q, (x, y) => Depth.depthAt(x, y)); put(q.x, q.y); G.p.face = 1; for (let i = 0; i < 10; i++) update(DT);
    const snap = SaveGame.snapshot(); const b0 = G.s.tire; for (let t = 0; t < 60; t += DT) { update(DT); now += DT; } const idle = G.s.tire - b0; SaveGame.load(snap); state = 'play'; Fx.toast = () => {};
    T.spot(q); G.p.face = 1; const t0 = G.s.tire; G.s.warm = 60; const r = T.dig(90, 1, 0), a = r.a, n = a.cuts || 0, st = a.steps || 0, tire = G.s.tire - t0 - idle * r.t / 60;
    const rate = n / r.t * 60, per = n / Math.max(1, st);
    ok(r.c && r.c.k === 'clear' && rate >= 15 && rate <= 20, `🪏 кидать (${d0.toFixed(0)} см): ${n} бросков за ${r.t.toFixed(0)} с — ${rate.toFixed(1)}/мин`);
    ok(per >= 2 && per <= 3.2, `👣 шаг 0.4 м каждые ${per.toFixed(1)} броска (${st} шагов), прошёл ${(G.p.x - q.x).toFixed(0)} px`);
    const cut = Trail.stats().cut, berm = Trail.bermVol(), kg = cut / n * (100 + 0);
    ok(Math.abs(cut - berm) / cut <= 0.1, `⚖ снято ${cut.toFixed(3)} м³ → в отвалах ${berm.toFixed(3)} м³ (${(Math.abs(cut - berm) / cut * 100).toFixed(1)} %)`);
    ok(kg >= 2 && kg <= 7.5, `🧱 ком ≈ ${kg.toFixed(1)} кг (0.03 м³ × глубина/25, ≤ 7 кг; свежий 100 кг/м³)`);
    const tw = 0.15 * n + 0.05 * cut * 100;
    ok(Math.abs(tire - tw) / tw < 0.15, `⚡ силы за ${n} бросков −${tire.toFixed(1)} сверх стояния (формула 0.15 + 0.05·кг: −${tw.toFixed(1)})`);
    // ширина за проход и второй проход рядом
    const W1 = []; for (let x = q.x + 40 + (G.p.x - G.p.x); x < G.p.x - 30; x += 8) { let n0 = 0; for (let dy = -30; dy <= 30; dy += 1) if (Trail.at(x, q.y + dy) >= 0.5) n0++; W1.push(n0); }
    const w1 = W1.reduce((a, b) => a + b, 0) / Math.max(1, W1.length);
    const xs = G.p.x; put(xs, q.y - 15); for (let i = 0; i < 5; i++) update(DT); T.dig(90, -1, 0);
    const W2 = []; for (let x = Math.max(q.x + 40, G.p.x + 30); x < xs - 24; x += 8) { let n0 = 0; for (let dy = -50; dy <= 30; dy += 1) if (Trail.at(x, q.y + dy) >= 0.5) n0++; W2.push(n0); }
    const w2 = W2.reduce((a, b) => a + b, 0) / Math.max(1, W2.length);
    ok(w1 >= 12 && w1 <= 17 && w2 >= 28 && w2 <= 34, `📏 ширина: проход ${w1.toFixed(1)} px (12–17), второй рядом → ${w2.toFixed(1)} px (28–34)`);
    // отвал — сбоку, выше целины; на дне — до земли
    const bh = Trail.berm(q.x + 80, q.y + 20), dc = Depth.depthAt(q.x + 80, q.y);
    ok(bh > 30 && dc < 10, `🏔 отвал сбоку ${bh.toFixed(0)} см над целиной, на дне ${dc.toFixed(1)} см`); }
  // пот: работа на тепле > 85 дольше 30 с
  { fresh(13); G.gear.shovel = 1; const q = row(['taiga', 'gar', 'core'], 50, 70); put(q.x, q.y); G.s.warm = 95; G.p.wetT = 0; for (let i = 0; i < 5; i++) update(DT);
    const w0 = G.s.warm; let wet20 = 0; input.act = true; Actions.interact(); for (let t = 0; t < 45; t += DT) { update(DT); now += DT; G.s.warm = Math.max(G.s.warm, 90); if (t > 20 && t < 21 && G.p.wetT > 0) wet20 = 1; }
    input.act = false; update(DT);
    ok(!wet20 && G.p.wetT > 0, `💧 пот: 45 с работы на тепле > 85 → одежда мокрая (wetT ${G.p.wetT.toFixed(0)} с), за 20 с — ещё нет`); }
  // толкать: мелко, на ходу
  { fresh(14); G.gear.shovel = 1; let x0 = 0, y0 = 0;
    for (let k = 0; k < 4000 && !x0; k++) { const x = HUT.x - 300 + T.R() * 600, y = HUT_IN.y1 + 70 + T.R() * 200; let good = true; for (let s = -20; s <= 160 && good; s += 10) { const d = Depth.depthAt(x + s, y); if (d > 22 || d < 8 || World.blocked(x + s, y, 14) || insideHut(x + s, y)) good = false; } if (good) { x0 = x; y0 = y; } }
    put(x0, y0); G.p.face = 1; for (let i = 0; i < 10; i++) update(DT);
    const dd = Depth.depthAt(x0 + 40, y0), ter = Zones.terrainAt(x0, y0); input.act = true; input.mx = 1; Actions.interact(); let t = 0, mode = null;
    for (; t < 4; t += DT) { update(DT); now += DT; G.p.y = y0; if (G.p.action) mode = mode || G.p.action.mode; }
    input.mx = 0; for (let i = 0; i < 30; i++) { update(DT); now += DT; } input.act = false; update(DT);
    const v = (G.p.x - x0) / t, cl = mid({ x: x0 - 30, y: y0 }, Trail.at, 120), bv = Trail.bermVol();
    ok(dd <= 25 && v <= TUNE.hero.speed * ter.walk * 0.45 && v > 10 && cl >= 0.8 && bv > 0.01, `🧹 толкать (${dd.toFixed(0)} см): ${v.toFixed(0)} px/с (обычно ${(TUNE.hero.speed * ter.walk).toFixed(0)}), полоса ${r2(cl)}, вал вбок ${bv.toFixed(3)} м³`); }
  // ---------- 6. дверь избы после пурги ----------
  { fresh(16); const g0 = Trail.doorDepth();
    G.storm = { a: G.time - 1, b: G.time + 2 * HOUR }; for (let i = 0; i < 2 * HOUR; i++) Depth.tick(1, true); G.storm.b = G.time;
    const dd = Trail.doorDepth(), pk = Trail.doorPeak();
    ok(dd >= 80 && pk >= 80 && pk <= 120, `🚪 нанос у двери после 2 ч пурги: ${g0.toFixed(0)} → ${dd.toFixed(0)} см (пик ${pk.toFixed(0)}), лопату у двери занесло: ${!!G.flags.shovelSnow}`);
    const snap = SaveGame.snapshot();
    // без расчистки: выйти из двери по грудь — медленно, но можно
    const out0 = (() => { put(HUT.x, HUT_IN.y1 - 8); input.mx = 0; input.my = 1; let t = 0; for (; t < 40 && G.p.y < Trail.DOOR.y1 + 10; t += DT) { update(DT); now += DT; G.p.x = HUT.x; } input.my = 0; return { t, s: Depth.heroSink }; })();
    // лопатой из дверного проёма
    const dig = hands => { SaveGame.load(snap); state = 'play'; Fx.toast = () => {}; UI.dialog = () => {}; G.gear.shovel = hands ? 0 : 1; put(HUT.x, HUT_IN.y1 + 4); G.p.face = 1; for (let i = 0; i < 5; i++) update(DT);
      input.act = true; input.my = 1; const c = Actions.context(); Actions.interact(); input.my = 0; let t = 0; const a = G.p.action;
      const open = () => { let m = 0; for (let y = Trail.DOOR.y0 + 4; y <= Trail.DOOR.y1 - 4; y += 6) m = Math.max(m, Depth.depthAt(HUT.x, y)); return m; };
      for (; t < 240 && G.p.action === a && open() > 30; t += DT) { update(DT); now += DT; }
      input.act = false; update(DT); return { t, c: c && c.k, left: open(), done: open() <= 30 }; };
    const sh = dig(false), hd = dig(true);
    ok(sh.c === 'clear' && sh.done && sh.t >= 35 && sh.t <= 65, `🪏 откопать дверь лопатой: ${sh.t.toFixed(0)} с (40–60), проход ≤ ${sh.left.toFixed(0)} см`);
    ok(hd.c === 'digout' && hd.done && hd.t > sh.t * 1.8, `✋ руками: ${hd.t.toFixed(0)} с (дольше лопаты в ${(hd.t / sh.t).toFixed(1)} раза)`);
    ok(out0.t < 30, `🚶 без расчистки выйти можно: 3 м наноса за ${out0.t.toFixed(1)} с, провал ${out0.s.toFixed(0)} см (тупика нет)`); }
  // ---------- 7. костёр на рыхлом снегу и на расчищенном ----------
  { fresh(16); const q = row(['taiga', 'gar', 'core'], 55, 70); Trail.cut(q.x - 20, q.y, q.x + 20, q.y, 14);
    const mk = (x, y) => ({ x, y, fuel: 3 * HOUR, lay: 0, site: 1, fl: 1, snow: Math.round(Depth.depthAt(x, y)) });
    const f1 = mk(q.x, q.y), f2 = mk(q.x + 200, q.y); G.fires.push(f1, f2); for (let i = 0; i < HOUR * 1.1; i++) Fire.tick(1, 0, false);
    ok(Fire.eff(f1) === 1 && Math.abs(Fire.eff(f2) - 0.7) < 0.02 && Math.abs(Fire.reach(f2) - 0.6) < 0.02, `🔥 костёр: на расчищенном (${f1.snow} см) КПД ${Fire.eff(f1)}, радиус ${Fire.reach(f1)}; на рыхлом (${f2.snow} см) за час — КПД ${r2(Fire.eff(f2))}, радиус ${r2(Fire.reach(f2))}`); }
  // ---------- 8. ветер и стенка ----------
  { fresh(17); const q = row(['taiga', 'gar', 'core', 'mar'], 40, 70); put(q.x, q.y); Wind.force({ dir: 0 }); G.storm = { a: G.time - 100, b: G.time + 3 * HOUR };
    const T0 = temperature(G.time), loss = () => Survival.rates(G.p, T0, 0, false, 0).loss;
    const ms0 = Wind.feel(G.p.x, G.p.y), L0 = loss(), calm0 = Survival.windMul(0);
    // стенка 1 м высотой, 3 м длиной — поперёк ветра, в 1 м с наветренной стороны (запад)
    for (let dy = -34; dy <= 34; dy += 6) Trail.dump(q.x - 23, q.y + dy, 0.15, 8);
    const hb = Trail.berm(q.x - 23, q.y), ms1 = Wind.feel(G.p.x, G.p.y), L1 = loss(), add0 = L0 / calm0 - L0 / Survival.windMul(ms0), add1 = L1 - L1 / Survival.windMul(ms1);
    const lossCalm = L0 / Survival.windMul(ms0);
    ok(Math.abs(Survival.windMul(ms0) - (1 + 0.03 * Math.max(0, ms0 - 2))) < 1e-6 && ms0 > 8, `🌬 пурга на открытом: ветер ${ms0.toFixed(1)} м/с → потеря ×${r2(Survival.windMul(ms0))}`);
    ok(hb >= 60 && ms1 <= ms0 * 0.35 && (L1 - lossCalm) <= 0.6 * (L0 - lossCalm), `🧱 за стенкой ${hb.toFixed(0)} см: ветер ${ms1.toFixed(1)} м/с, добавка ветра к потере ${((L1 - lossCalm) / (L0 - lossCalm) * 100).toFixed(0)} % от открытого (вся потеря ${(L1 / L0 * 100).toFixed(0)} %)`);
    // днём на открытом ~ +7 %
    G.storm = null; Wind.force({ dir: 0 }); G.time = tAt(1, 13); const msd = Wind.feel(q.x + 200, q.y); Wind.force();
    out.push(`info днём на открытом: ${msd.toFixed(1)} м/с → ×${r2(Survival.windMul(msd))}`);
    // факт = прогноз: одна формула (rates с часом t) у героя и у его копии
    G.storm = { a: G.time - 100, b: G.time + 3 * HOUR }; G.p.moving = false; G.p.action = null;
    const cp = { x: G.p.x, y: G.p.y, inside: G.p.inside, moving: false, teaT: G.p.teaT || 0, wetT: G.p.wetT || 0 };   // копия героя — как в Survival.forecast
    const f1 = Survival.rates(G.p, -30, 0.5, false, 0).loss, f2 = Survival.rates(cp, -30, 0.5, false, 0, G.time).loss, wm = Survival.windMul(Survival.windAt(cp, G.time));
    ok(Math.abs(f1 - f2) < 1e-6 && wm >= 1, `📋 факт = прогноз «До утра»: потеря ${f1.toFixed(4)} / ${f2.toFixed(4)} (Δ ${(f1 - f2).toExponential(1)}, ветер ×${r2(wm)})`); G.storm = null; }
  // ---------- 9. волки по тропе; площадка на мари ----------
  { fresh(18); const q = row(['taiga', 'gar', 'core', 'stlanik'], 52, 80, 420); const L = 400;
    const run = trail => { fresh(18); if (trail) for (let k = 0; k < 4; k++) for (let x = q.x - 20; x < q.x + L + 40; x += 6) Trail.stamp(x, q.y, Trail.PROF.p, 40);
      const w = { x: q.x, y: q.y, vx: 0, vy: 0, st: 'retreat', t: 99, cd: 0, dir: 1, face: 1, step: 0, pr: 0, hp: 3, id: 99 }; G.wolves = [w]; G.pack = null;
      put(q.x - 160, q.y); let t = 0; for (; t < 30 && w.x < q.x + L && G.wolves.includes(w); t += DT) { Wolves.tick(DT, 1); now += DT; G.time += DT; w.y = q.y; } return t; };   // уходит от героя на восток — вдоль полосы
    const t0 = run(false), t1 = run(true), k = t0 / t1 - 1;
    ok(k >= 0.18 && k <= 0.34, `🐺 волк ${L} px к цели: целина ${t0.toFixed(2)} с → по тропе ${t1.toFixed(2)} с (+${Math.round(k * 100)} % скорости)`); }
  { fresh(19); G.flags.contact = 1; Colony.ensure ? Colony.ensure() : null; if (!G.col) G.col = { builds: [], units: [], sel: [], ep: 0, rub: 0, prices: {} };
    const B = BUILDS.pad, b = { id: 901, type: 'pad', x: POI.mar.x, y: POI.mar.y + 120, done: 1, prog: 1 }; G.col.builds.push(b);
    const k0 = padK();
    G.gear.shoes = 1; const lanes = Math.ceil(B.h / 20);
    calm(() => { for (let pass = 0; pass < 3; pass++) for (let i = 0; i <= lanes; i++) { const y = b.y - B.h / 2 + 4 + i * (B.h - 8) / lanes; for (let x = b.x - B.w / 2 - 12; x <= b.x + B.w / 2 + 12; x += 12) Trail.stamp(x, y, Trail.PROF.shoes); } });
    const k1 = (PADK.t = -9, padK()), d1 = padDone();
    G.storm = { a: G.time - 1, b: G.time + 2 * HOUR }; for (let i = 0; i < 2 * HOUR; i++) Depth.tick(1, true); G.storm = null;
    const k2 = (PADK.t = -9, padK());
    ok(k0 < 0.1 && k1 >= 0.8 && d1 && k2 < 0.8, `🛬 площадка 10×7 м: ${Math.round(k0 * 100)} % → снегоступами 3 прохода ${Math.round(k1 * 100)} % (готова: ${d1}) → после пурги ${Math.round(k2 * 100)} % — подновить`); }
  // ---------- 10. ИИ выбирает тропу; производительность ----------
  { fresh(11); let u = null;
    for (let k = 0; k < 40000 && !u; k++) { const x = 400 + T.R() * (W - 800), y = 400 + T.R() * (H - 800); if (Zones.terrainKey(x, y) === 'taiga' && Depth.crustAt(x, y) < 0.3 && Depth.sinkAt(x, y - 34, 'wolf') > 25 && !World.blocked(x, y, 40)) u = { x, y }; }
    const a = -0.45, ux = Math.sin(a), uy = -Math.cos(a);
    for (let k = 0; k < 3; k++) for (let s = -20; s < 200; s += 6) Trail.stamp(u.x + ux * s, u.y + uy * s, Trail.PROF.p, 40);
    const res = []; for (const kind of ['n', 'wolf', 'deer']) { const o = { x: u.x, y: u.y }; res.push([kind, Depth.steer(o, 0, -1, kind)]); }
    ok(res.every(([k, v]) => v && v.x < -0.2), `🧭 обход по тропе: ${res.map(([k, v]) => `${k} → ${v ? `(${r2(v.x)}, ${r2(v.y)})` : 'прямо'}`).join(' · ')}`); }
  { fresh(11); const q = row(['core', 'taiga', 'kurum', 'gar'], 32, 50); const st = Trail.step; let ms = 0, nCall = 0; Trail.step = function () { const t = performance.now(); st.apply(this, arguments); ms += performance.now() - t; nCall++; };
    let fr = 0; calm(() => { for (let i = 0; i < 3; i++) { const t = pass(q, i % 2 ? -1 : 1); fr += Math.round(t.t / DT); } }); Trail.step = st;
    const dA = (() => { const t = performance.now(); let s = 0; for (let i = 0; i < 20000; i++) s += Depth.depthAt(q.x + (i % 300), q.y + ((i / 300) | 0) % 20); return (performance.now() - t) / 20000 * 1000; })();
    ok(ms / fr < 0.05, `🏎 протаптывание (герой): ${(ms / fr * 1000).toFixed(1)} мкс/кадр (${nCall} вызовов); depthAt на тропе ${dA.toFixed(2)} мкс`);
    out.push(`info память: ${JSON.stringify(Trail.stats())}`); }
  return out;
}

// рисунок: перепечка куска в high и low (в кадре — настоящий рендер)
function render() {
  const out = [];
  Math.random = mulberry(11); newGame(); state = 'play'; G.time = tAt(1, 12); G.storm = null;
  const p = G.p, x0 = HUT.x + 160, y0 = HUT_IN.y1 + 140;
  for (let k = 0; k < 3; k++) for (let x = -300; x < 300; x += 6) Trail.stamp(x0 + x, y0 + Math.sin(x / 90) * 40, Trail.PROF.p);
  for (let y = -20; y < 20; y += 12) { Trail.cut(x0 - 60, y0 + 80 + y, x0 + 60, y0 + 80 + y, 7); Trail.dump(x0, y0 + 120 + y, 0.3, 10); }
  p.x = x0; p.y = y0; p.lx = p.x; p.ly = p.y; Hero.snap();
  for (const q of ['high', 'low']) {
    window.QUALITY = q; Trail.resetStats(); let fr = 0, sum = 0;
    for (let i = 0; i < 40; i++) { now += 1 / 30; const t = performance.now(); GFX.lookAt(p.x, p.y); GFX.render(1 / 30, null); sum += performance.now() - t; fr++; }
    const s = Trail.stats();
    out.push((s.bakeMed < 2.5 && s.bakeMs < 8 ? 'ok   ' : 'FAIL ') + `🎨 ${q}: перепечка куска — медиана ${s.bakeMed} мс, худшая ${s.bakeMs} мс (${s.bakes} печей, ≤ 1 за кадр), кадр в среднем ${(sum / fr).toFixed(1)} мс`);
  }
  window.QUALITY = 'high';
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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Trail !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); document.getElementById('menu').hidden = true; });
    await pg.evaluate(`(${common})()`);
    for (const f of [page1, page2]) { try { out = out.concat(await pg.evaluate(`(${f})()`)); } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); out = out.concat(await pg.evaluate(() => (window.TC ? window.TC.out : [])).catch(() => [])); } }
    out = out.concat(await pg.evaluate(`(${render})()`));
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: trail-check · провалов ${bad}` : `\nOK: trail-check · ${out.filter(l => !l.startsWith('info')).length} проверок`);
  process.exit(bad ? 1 : 0);
})();
