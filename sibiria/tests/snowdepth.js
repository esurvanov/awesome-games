#!/usr/bin/env node
// Глубокий снег и полынья (js/depth.js, js/ice.js):
//   1. глубина — детерминирована от seed (тот же seed → те же см; другой — другие), память сетки ≤ ~200 КБ, блоки лениво
//   2. у стволов мельче (приствольные ямы), в сугробах и подветренных наддувах вещей глубже, у костра — проталина, на льду реки — мало
//   3. скорость по глубине: по пояс ≤ 0.55 от мелкого, по грудь ≤ 0.35; провал до пояса (≥ 23 px) в глубоком месте; вход плавный
//   4. лыжи ≤ 20 % провала, снегоступы ≤ 40 %; «разгрести» (E) — мельче; траншея остаётся и утоптана (идти по ней — мельче)
//   5. звери вязнут: олень глубоко, заяц почти нет, волк по насту — меньше оленя; ИИ обходит глубокое (steer)
//   6. провал в полынью: герой на месте дыры (не телепорт), фазы по порядку (drop → water → grab → crawl → roll → up), кромка
//      обламывается, выползает в сторону, откуда пришёл; мокрый; дыра остаётся; шатун — та же схема (дыра под ним)
//   cd tests && node snowdepth.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => out.push((c ? 'ok   ' : 'FAIL ') + w), r1 = v => Math.round(v * 10) / 10;
  const fresh = seed => { Math.random = mulberry(seed); newGame(); state = 'play'; G.s.food = 100; G.s.warm = 90; G.time = tAt(1, 11); G.storm = null; };
  const put = (x, y) => { const p = G.p; p.x = x; p.y = y; p.lx = x; p.ly = y; p.vx = p.vy = 0; p.inside = insideHut(x, y); Hero.snap(); };
  const settle = (n = 12) => { for (let i = 0; i < n; i++) { G.time += 0.05; Depth.tickHero(0.05); } };
  const R = mulberry(99);
  const core = () => ({ x: WORLD.ox + 300 + R() * 3000, y: WORLD.oy + 300 + R() * 3000 });
  // место с нужным провалом героя (см)
  function find(lo, hi, kind = 'p', far = 400) {
    for (let k = 0; k < 60000; k++) {
      const q = core(); if (onIce(q.x, q.y) || World.blocked(q.x, q.y, 12) || Math.hypot(q.x - HUT.x, q.y - HUT.y) < far) continue;
      const s = Depth.sinkAt(q.x, q.y, kind); if (s >= lo && s <= hi) return q;
    }
    throw new Error(`нет места с провалом ${lo}–${hi} см (${kind})`);
  }

  // ---------- 1. детерминизм от seed ----------
  fresh(4242);
  const pts = []; for (let i = 0; i < 300; i++) pts.push({ x: 200 + R() * (W - 400), y: 200 + R() * (H - 400) });
  const sample = () => pts.map(q => Math.round(Depth.depthAt(q.x, q.y) * 10));
  const a1 = sample(); fresh(4242); const a2 = sample(); fresh(777); const a3 = sample();
  const same = a1.every((v, i) => v === a2[i]), diff = a1.filter((v, i) => v !== a3[i]).length;
  ok(same && diff > 150, `🎲 глубина от seed: тот же seed — 300/300 точек совпали (${same}), другой — отличаются ${diff}/300`);
  const st = Depth.stats();
  ok(st.maxKb <= 220 && st.kb < st.maxKb, `💾 сетка ${st.cell} px, Uint8, лениво: сейчас ${st.kb} КБ (${st.blocks} блоков), весь мир — ${st.maxKb} КБ`);
  fresh(4242);
  let sum = 0, n = 0, mx = 0; for (let i = 0; i < 3000; i++) { const q = core(); const d = Depth.depthAt(q.x, q.y); sum += d; n++; mx = Math.max(mx, d); }
  ok(sum / n > 35 && sum / n < 80 && mx > 150, `📏 участок: средний снег ${r1(sum / n)} см (тайга 50–80), максимум ${r1(mx)} см (наддувы 1.5–2 м)`);

  // ---------- 2. ямы у стволов, сугробы, наддувы, проталины ----------
  let near = 0, open = 0, m = 0;
  for (const t of G.trees) {
    if (m >= 150) break; if (t.wood <= 0 || t.wall || onIce(t.x, t.y)) continue;
    if (Space.drifts.near(t.x, t.y, 160).some(d => Math.abs(t.x - d.x) < d.rx + 60 && Math.abs(t.y - d.y) < d.ry + 60)) continue;
    near += Depth.depthAt(t.x + 7, t.y + 2); open += Depth.depthAt(t.x + 34, t.y + 18); m++;
  }
  ok(m > 50 && near / m < open / m * 0.6, `🌲 у ствола мельче: ${r1(near / m)} см против ${r1(open / m)} см в 38 px (${m} деревьев)`);
  const big = G.drifts.slice().sort((a, b) => b.rx - a.rx)[0], bd = Depth.depthAt(big.x, big.y), bo = Depth.depthAt(big.x, big.y + big.ry * 3);
  ok(bd > bo + 60 && bd > 130, `🏔 сугроб rx ${big.rx}: в гребне ${r1(bd)} см, рядом ${r1(bo)} см`);
  { // подветренный наддув хвоста Ми-8 (Snow): d = 0 → 1; у избы наддув отгребают (натоптано)
    const T = POI.tail, dir = Wind.at(T.x, T.y).dir, g = Snow.geo('tail', dir); Snow.set('tail', null, 0); G.time += 2;
    const lx = T.x + g.lee.x0 + Math.cos(dir) * 30, ly = T.y + g.lee.y0 + Math.sin(dir) * 30, d0 = Depth.depthAt(lx, ly);
    Snow.set('tail', null, 1); G.time += 2; const d1 = Depth.depthAt(lx, ly);
    ok(d1 > d0 + 30, `🚁 наддув за хвостом Ми-8 по ветру: ${r1(d0)} → ${r1(d1)} см при полном наносе`);
  }
  { const q = find(40, 90); const d0 = Depth.depthAt(q.x, q.y); G.fires.push({ x: q.x, y: q.y, fuel: 100, melt: 1 }); const d1 = Depth.depthAt(q.x + 4, q.y); G.fires.pop();
    ok(d1 < d0 * 0.3, `🔥 у костра проталина: ${r1(d0)} → ${r1(d1)} см`); }
  { const y = WORLD.oy + 2600, d = Depth.depthAt(riverX(y), y); ok(d < 15, `🧊 лёд реки выдут: ${r1(d)} см`); }
  { const d = Depth.depthAt(HUT.x, HUT_IN.y1 + 60); ok(d < 25, `👣 у избы натоптано: ${r1(d)} см`); }

  // ---------- 3. провал и скорость ----------
  const spd = q => { put(q.x, q.y); settle(); return { v: Hero.speed(), s: Depth.heroSink, px: Depth.heroSink * Depth.PX }; };
  const qA = find(5, 18), qK = find(44, 56), qW = find(95, 108), qC = find(125, 142);
  const A = spd(qA), Kn = spd(qK), Wa = spd(qW);
  const Ch = spd(qC); let chv = 0; for (let i = 0; i < 40; i++) { G.p.moving = true; G.p.x += (i & 1 ? 1 : -1) * 0.5; Depth.tickHero(0.02); chv += Hero.speed(); } chv /= 40; G.p.moving = false; for (let i = 0; i < 5; i++) Depth.tick(30, true); // рывки — среднее за 0.8 с; траншею — замести
  ok(A.v > Kn.v * 0.97 && Kn.v > Wa.v && Wa.v > chv, `🚶 скорость: щиколотка ${A.v | 0} · колено ${Kn.v | 0} · пояс ${Wa.v | 0} · грудь ${chv | 0} px/с`);
  ok(Wa.v / A.v <= 0.6 && chv / A.v <= 0.4, `🐢 по пояс ×${(Wa.v / A.v).toFixed(2)}, по грудь ×${(chv / A.v).toFixed(2)} (рывками) от мелкого`);
  ok(Wa.px >= 21 && Ch.px >= 28 && Ch.px <= 34, `📐 провал: колено ${r1(Kn.px)} px · пояс ${r1(Wa.px)} px · грудь ${r1(Ch.px)} px (рост ≈ 40 px, голова и плечи над снегом)`);
  { put(qA.x, qA.y); settle(20); put(qC.x, qC.y); Depth.tickHero(0.05); const s1 = Depth.heroSink; for (let i = 0; i < 5; i++) Depth.tickHero(0.05); const s6 = Depth.heroSink; settle(20);
    ok(s1 < Ch.s * 0.5 && s6 > Ch.s * 0.85, `⏱ вход плавный: 0.05 с — ${r1(s1)} см, 0.3 с — ${r1(s6)} из ${r1(Ch.s)} см`); }

  // ---------- 4. лыжи, снегоступы, разгрести, траншея ----------
  { put(qW.x, qW.y); settle(); const s0 = Depth.heroSink; G.gear.skis = 1; G.p.skiOff = 0; settle(20); const sk = Depth.heroSink; G.gear.skis = 0; G.gear.shoes = 1; settle(20); const sh = Depth.heroSink; G.gear.shoes = 0; settle(20);
    ok(sk <= s0 * 0.2, `🎿 лыжи: провал ${r1(sk)} из ${r1(s0)} см (${Math.round(sk / s0 * 100)} %)`);
    ok(sh <= s0 * 0.4 && sh > sk, `🥾 снегоступы: ${r1(sh)} см (${Math.round(sh / s0 * 100)} %), рецепт на верстаке: ${!!RECIPES.find(r => r.id === 'shoes')}`); }
  { let qD = qC; for (let k = 0; k < 50 && treesNear(qD.x, qD.y, 40).some(t => t.wood > 0 && Math.hypot(t.x - qD.x, t.y - qD.y) < 36); k++) qD = find(125, 142);
    put(qD.x, qD.y); settle(); const c = Actions.context(); const d0 = Depth.depthAt(qD.x, qD.y); for (let i = 0; i < 50; i++) Depth.dig(qD.x, qD.y, 0.05); const d1 = Depth.depthAt(qD.x, qD.y);
    ok(c && c.k === 'digout' && d1 < d0 * 0.4, `🧤 увяз по грудь (${r1(Depth.heroSink)} см) — E «${c && c.label}»: ${r1(d0)} → ${r1(d1)} см за 2.5 с`); }
  { const q = find(95, 142); put(q.x - 40, q.y); settle(); const n0 = Depth.trenchList.length, before = Depth.depthAt(q.x, q.y);
    for (let i = 0; i < 80; i++) { G.p.moving = true; G.p.x += 1; G.time += 0.02; Depth.tickHero(0.02); } G.p.moving = false;
    const made = Depth.trenchList.filter(t => t.k === 'p').length, after = Depth.depthAt(q.x, q.y);
    ok(Depth.trenchList.length > n0 + 8 && after < before * 0.5, `〰️ траншея: +${made} точек, по ней мельче ${r1(before)} → ${r1(after)} см`);
    for (let i = 0; i < 40; i++) Depth.tick(3, true); // пурга заметает
    ok(Depth.trenchList.filter(t => t.k === 'p').length === 0 && Depth.depthAt(q.x, q.y) > before * 0.9, `🌬 траншею замело пургой: снова ${r1(Depth.depthAt(q.x, q.y))} см`); }

  // ---------- 5. звери ----------
  { const q = find(60, 72, 'deer'); const d = G.deer[0], w = { x: q.x, y: q.y + 0.3, vx: 0, vy: 0, st: 'circle' }, h = G.hares[0];
    put(q.x - 300, q.y);
    d.x = q.x; d.y = q.y; h.x = q.x + 2; h.y = q.y - 1;
    for (let i = 0; i < 20; i++) { G.time += 0.05; d.x += 0.2; World.solid(d, 12, 'a'); h.x += 0.1; World.solid(h, 5, 'a'); w.x += 0.1; World.solid(w, 12, 'w'); }
    const sd = Depth.sinkOf(d, 'deer'), sh = Depth.sinkOf(h, 'hare'), sw = Depth.sinkOf(w, 'wolf');
    ok(sd > 55 && sh < 12 && sw < sd, `🦌 вязнут: олень ${r1(sd)} см · волк ${r1(sw)} см (наст держит) · заяц ${r1(sh)} см`);
    // шаг оленя в глубоком — короче
    const x0 = d.x; G.time += 0.05; d.x += 10; World.solid(d, 12, 'a'); const stepK = (d.x - x0) / 10;
    ok(stepK < 0.7, `🦌 шаг оленя в сугробе ×${r1(stepK * 100) / 100}`);
    // обход глубокого: цель за сугробом — ИИ уходит в сторону
    const bd2 = G.drifts.filter(d => d.rx < 40 && d.ry > 12 && Math.abs(d.x - riverX(d.y)) > 200 && Depth.sinkAt(d.x, d.y, 'n') > 100 && Depth.sinkAt(d.x + 50, d.y + d.ry, 'n') < 50)[0], u = { x: bd2.x, y: bd2.y + bd2.ry * 1.25 + 14 };
    const v = Depth.steer(u, 0, -1, 'n'), ah = Depth.sinkAt(u.x, u.y - 34, 'n'), sd2 = v ? Depth.sinkAt(u.x + v.x * 34, u.y + v.y * 34, 'n') : ah;
    const dbg = [0, 0.45, 0.9, 1.35, -0.45, -0.9, -1.35].map(a => r1(Depth.sinkAt(u.x + Math.sin(a) * 34, u.y - Math.cos(a) * 34, 'n'))).join('/');
    ok(!!v && Math.abs(v.x) > 0.3 && sd2 < ah * 0.7, `🧭 ИИ обходит сугроб (rx ${bd2.rx}, ${dbg}): прямо ${r1(ah)} см → курс ${v ? `(${r1(v.x)}, ${r1(v.y)}) ${r1(sd2)} см` : 'прямо'}`); }

  // ---------- 6. полынья ----------
  { fresh(4242); const P = POI.polynya, ent = { x: P.x - 20, y: P.y + 140 };
    put(ent.x, ent.y); World.thinIce(0.05);
    put(P.x - 20, P.y + 60); // шагнул на тонкий лёд с юга
    let t = 0, fall = null; while (t < 4 && !Ice.active()) { World.thinIce(0.05); t += 0.05; if (Ice.active()) fall = { x: G.p.x, y: G.p.y }; }
    ok(Ice.active() && fall && Math.abs(t - TUNE.ice.breakT) < 0.2, `💥 лёд проломился через ${r1(t)} с (трещал с ${TUNE.ice.creakT} с)`);
    const h = G.iceHoles[G.iceHoles.length - 1];
    ok(h && Math.hypot(h.x - fall.x, h.y - fall.y) < 3, `🕳 дыра во льду — под героем (${h ? Math.round(Math.hypot(h.x - fall.x, h.y - fall.y)) : '—'} px), не телепорт`);
    const seen = [], maxD = []; let steps = 0;
    input.mx = 0; input.my = 1; // жмёт к берегу, откуда пришёл (на юг)
    while (Ice.active() && steps < 600) { World.thinIce(0.05); steps++; if (Ice.phase && seen[seen.length - 1] !== Ice.phase) seen.push(Ice.phase); maxD.push(Math.hypot(G.p.x - fall.x, G.p.y - fall.y)); }
    input.mx = input.my = 0;
    const order = Ice.PH.join('>'), got = seen.join('>'), dur = steps * 0.05, far = Math.max(...maxD);
    ok(got === order, `🎬 фазы по порядку: ${got}`);
    ok(dur >= 5 && dur <= 12, `⏱ эпизод ${r1(dur)} с (жмёт к берегу)`);
    ok(far < 90 && far > 30, `📍 герой всё время у дыры: отполз на ${Math.round(far)} px (не телепорт на берег)`);
    const brk = Ice.log.filter(l => l.ph === 'break').length;
    ok(brk >= 1 && brk <= 2, `🧊 кромка обломилась ${brk} раз(а), дыра r ${h.r} px`);
    const ex = (G.p.x - fall.x) * (ent.x - fall.x) + (G.p.y - fall.y) * (ent.y - fall.y);
    ok(ex > 0 && G.p.y > fall.y + 30, `↩️ выполз на ту сторону, откуда пришёл (${Math.round(G.p.x - fall.x)}, ${Math.round(G.p.y - fall.y)})`);
    ok(G.p.wetT > 0 && G.s.warm <= TUNE.ice.warm && !World.onThinIce(G.p) || G.p.iceSafe > 0, `💧 мокрый (${Math.round(G.p.wetT)} с), тепло ${Math.round(G.s.warm)}`);
    ok(G.iceHoles.includes(h), '🕳 дыра осталась (затянется за ~сутки)');
    // бездействие — дольше
    fresh(4242); put(P.x - 20, P.y + 140); World.thinIce(0.05); put(P.x - 20, P.y + 60);
    while (!Ice.active()) World.thinIce(0.05);
    let s2 = 0; while (Ice.active() && s2 < 600) { World.thinIce(0.05); s2++; }
    ok(s2 * 0.05 > dur * 1.2 && s2 * 0.05 <= 14, `😶 без ввода дольше: ${r1(s2 * 0.05)} с против ${r1(dur)} с`);
    // шатун — та же схема упрощённо
    const nh = G.iceHoles.length; G.bear = { x: P.x, y: P.y, vx: 0, vy: 0, st: 'hunt', hp: 100, hp0: 100, t: 5, step: 0, pr: 0, face: 1 };
    Bear.tick(0.05, 23, 1);
    ok(!G.bear && G.flags.bearDead && G.iceHoles.length === nh + 1 && Ice.sinkers().length === 1, `🐻 шатун под лёд: дыра под ним, уходит в воду (${Ice.sinkers().length})`); }
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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Depth !== 'undefined' && typeof Ice !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); }); // модалка держит главный цикл на паузе
    out = await pg.evaluate(`(${page})()`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: snowdepth · провалов ${bad}` : `\nOK: snowdepth · ${out.length} проверок`);
  process.exit(bad ? 1 : 0);
})();
