#!/usr/bin/env node
// Сводка контекста (js/context.js) и то, что её читает: реплики, тосты, рендер, ветер, звук с местом.
//   1. в избе у горящей печи реплика сумерек — не «пора к огню»; у костра — тоже; в поле — «к огню»
//   2. «След свежий. Утренний.» — только утром; в 15:00 другая
//   3. тост о вое — по дистанции до стаи: стая в 10 м — не «далеко»; стаи нет — «далеко»
//   4. одинаковые тосты склеиваются в один «×2»
//   5. снегопад не рисуется внутри избы (пиксели комнаты не меняются от слоя погоды), снаружи — рисуется
//   6. ветер меняет направление за часы игры (медленно: за минуту игры — почти нет), пурга доворачивает к фронту
//   7. звук с местом: источник слева — панорама влево; далеко — тише; за стеной избы — тише и глуше
//   8. ночью у героя без источника света нет «светлого круга»: свет — только от огня/факела/окна
//   cd tests && node context.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');

function page() {
  const out = [], ok = (c, w) => out.push((c ? 'ok   ' : 'FAIL ') + w);
  const fresh = seed => { Math.random = mulberry(seed); newGame(); state = 'play'; G.s.food = 100; G.s.warm = 80; Ctx.reset(); };
  const put = (x, y) => { const p = G.p; p.x = x; p.y = y; p.lx = x; p.ly = y; p.vx = p.vy = 0; p.inside = insideHut(x, y); Ctx.reset(); };
  const inHut = () => put(SPOT.stove.x + 40, SPOT.stove.y + 20);
  const has = (L, re) => (L || []).some(t => re.test(t));

  // ---------- 1. реплики сумерек ----------
  fresh(11); G.time = tAt(1, 18.6);
  inHut(); G.hut.fuel = 300;
  let L = Barks.linesFor('dusk');
  ok(Ctx.now().byStove && !has(L, /к огню/i), `🗨 в избе у горящей печи: «${L}» — не «пора к огню»`);
  G.hut.fuel = 0; Ctx.reset(); L = Barks.linesFor('dusk');
  ok(!has(L, /к огню/i) && has(L, /печь/i), `🗨 в избе, печь холодная: «${L}»`);
  put(HUT.x + 600, HUT.y + 400); G.fires.push({ x: G.p.x + 50, y: G.p.y, fuel: 200 }); Ctx.reset(); L = Barks.linesFor('dusk');
  ok(Ctx.now().atFire && !has(L, /к огню/i), `🗨 у костра: «${L}»`);
  G.fires.length = 0; Ctx.reset(); L = Barks.linesFor('dusk');
  ok(has(L, /к огню/i), `🗨 в поле без огня: «${L}»`);
  G.s.warm = 20; inHut(); G.hut.fuel = 300; Ctx.reset(); L = Barks.linesFor('cold');
  ok(!has(L, /к огню бы/i), `🥶 замёрз, но у печи: «${L.join(' / ')}»`);
  G.hut.fuel = 0;

  // ---------- 2. «утренний» след ----------
  const evenk = { o: { type: 'evenk' }, rec: {} };
  G.time = tAt(1, 15); Ctx.reset(); const w15 = Barks.workLines(evenk);
  G.time = tAt(2, 8.5); Ctx.reset(); const w8 = Barks.workLines(evenk);
  ok(!has(w15, /Утренний/) && has(w8, /Утренний/), `🦌 эвенк в 15:00: «${w15[0]}», в 08:30: «${w8[0]}»`);

  // ---------- 3. тост о вое по дистанции ----------
  fresh(12); put(HUT.x + 700, HUT.y + 500); G.time = tAt(1, 23);
  const E1 = EVENTS.find(e => e.id === 'E1'), tFar = E1.do[0].toast(G);
  G.wolves.length = 0; Wolves.at(0, 100, {}); Ctx.reset();
  const tNear = E1.do[0].toast(G);
  ok(/Далеко/.test(tFar) && !/Далеко/.test(tNear), `🐺 стаи нет: «${tFar}» · стая в 10 м: «${tNear}»`);
  const src = E1.do[1].at(G);
  ok(Math.hypot(src.x - G.wolves[0].x, src.y - G.wolves[0].y) < 1, `🐺 вой звучит оттуда, где волк (${Math.round(src.x - G.p.x)}, ${Math.round(src.y - G.p.y)})`);
  G.wolves.length = 0;

  // ---------- 4. склейка тостов ----------
  const box = document.getElementById('toasts'); box.innerHTML = '';
  UI.toast(':storm: Пурга!'); UI.toast(':storm: Пурга!'); UI.toast(':wood: Дрова');
  ok(box.children.length === 2 && /×2/.test(box.children[0].textContent + box.children[1].textContent), `🔔 два одинаковых тоста → один «×2» (плашек ${box.children.length})`);
  box.innerHTML = '';

  // ---------- 5. снег не идёт в избе ----------
  {
    const was = window.QUALITY; window.QUALITY = 'low'; // без зерна плёнки (оно сдвигается каждый кадр)
    fresh(13); G.time = tAt(1, 13); G.storm = { a: G.time - 50, b: G.time + 200 }; G.hut.fuel = 0; G.hut.door = 1; inHut();
    GFX.setZoom(1); GFX.recenter(); for (let i = 0; i < 40; i++) GFX.render(0.05, null);
    const cv = document.getElementById('game'), g = cv.getContext('2d'), W0 = cv.width, H0 = cv.height;
    const grab = () => g.getImageData(0, 0, W0, H0).data;
    const wd = FX.weather.draw;
    GFX.render(0, null); const a = grab();
    FX.weather.draw = () => {}; GFX.render(0, null); const b = grab(); FX.weather.draw = wd;
    window.QUALITY = was;
    const diff = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0 | 0; y < y1; y += 2) for (let x = x0 | 0; x < x1; x += 2) { const i = (y * W0 + x) * 4; s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n++; } return s / n; };
    const k = W0 / innerWidth, cxp = W0 / 2, cyp = H0 / 2; // герой в центре кадра — в комнате
    const inRoom = diff(cxp - 40 * k, cyp - 60 * k, cxp + 40 * k, cyp), outside = diff(0, 0, 120 * k, 120 * k);
    ok(inRoom < 0.5 && outside > 3, `❄ пурга, герой в избе: снег в комнате ${inRoom.toFixed(2)} (≈0), снаружи ${outside.toFixed(1)}`);
  }

  // ---------- 6. ветер: направление ----------
  fresh(14); G.storm = null;
  let maxD = 0, maxStep = 0;
  const ad = (a, b) => { let d = b - a; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return Math.abs(d); };
  for (let h = 0; h < 72; h += 0.25) {
    const t = tAt(1, 6 + h), d0 = Wind.dirAt(t);
    maxStep = Math.max(maxStep, ad(d0, Wind.dirAt(t + CYCLE / 1440))); // одна минута игры
    maxD = Math.max(maxD, ad(d0, Wind.dirAt(t + CYCLE / 4))); // шесть часов игры
  }
  ok(maxD > 0.4 && maxStep < 0.01, `🧭 направление за 6 ч игры меняется до ${maxD.toFixed(2)} рад, за минуту — ≤ ${maxStep.toFixed(4)} рад`);
  G.time = tAt(1, 12); const calmD = Wind.dirAt(G.time);
  G.storm = { a: G.time + 10, b: G.time + 300 }; const stD = Wind.dirAt(G.time + 100), stD2 = Wind.dirAt(G.time + 150);
  ok(ad(calmD, stD) > 0.05 && ad(stD, stD2) < 0.05, `🌨 пурга: ветер доворачивает к фронту (${calmD.toFixed(2)} → ${stD.toFixed(2)} рад) и держит направление`);
  G.storm = { a: G.time - 5, b: G.time + 300 }; G.p.inside = false;
  put(HUT.x + 900, HUT.y + 600); const w = Wind.at(G.p.x, G.p.y);
  const walk = storm => { put(HUT.x + 900, HUT.y + 600); const x0 = G.p.x, y0 = G.p.y; input.mx = 0; input.my = 0.5; for (let i = 0; i < 30; i++) Hero.move(0.05, storm); input.my = 0; return [G.p.x - x0, G.p.y - y0]; };
  const a0 = walk(false), a1 = walk(true), mvx = a1[0] - a0[0] * 0.8, mvy = a1[1] - a0[1] * 0.8; // в пургу шаг ×0.8 (TUNE.hero.storm) + снос
  const dirOk = (mvx * w.dx + mvy * w.dy) > 0;
  ok(dirOk && Math.abs(mvx * w.dx + mvy * w.dy) > 5, `🌬 снос героя в пургу — по ветру (снос ${mvx.toFixed(0)}, ${mvy.toFixed(0)}; ветер ${w.dx.toFixed(2)}, ${w.dy.toFixed(2)})`);
  G.storm = null;

  // ---------- 7. звук с местом ----------
  fresh(15); put(HUT.x + 800, HUT.y + 500);
  const p = G.p, L1 = Sound.spatial(p.x - 300, p.y), R1 = Sound.spatial(p.x + 300, p.y), N = Sound.spatial(p.x + 80, p.y), F = Sound.spatial(p.x + 1500, p.y);
  ok(L1.pan < -0.5 && R1.pan > 0.5, `🔊 слева — панорама ${L1.pan.toFixed(2)}, справа — ${R1.pan.toFixed(2)}`);
  ok(F.g < N.g * 0.35 && F.lp < N.lp, `🔊 рядом g=${N.g.toFixed(2)}, за 150 м g=${F.g.toFixed(2)} и глуше (${F.lp | 0} Гц)`);
  const Hw = Sound.spatial(p.x + 1500, p.y, 'howl');
  ok(Hw.g > F.g, `🐺 вой (громкий источник) за 150 м слышнее хруста: ${Hw.g.toFixed(2)} > ${F.g.toFixed(2)}`);
  inHut(); const out1 = Sound.spatial(HUT.x + 200, HUT.y + 200), put2 = () => put(HUT.x + 200, HUT.y + 120); put2(); const out2 = Sound.spatial(HUT.x + 200, HUT.y + 200);
  ok(out1.g < out2.g * 0.5 && out1.lp <= 700, `🏠 из избы звук снаружи тише (${out1.g.toFixed(2)} против ${out2.g.toFixed(2)}) и глуше (${out1.lp | 0} Гц)`);
  put(HUT.x + 800, HUT.y + 500); Wind.force({ ms: 18 }); const Ws = Sound.spatial(p.x + 600, p.y); Wind.force({ ms: 1 }); const Wc = Sound.spatial(p.x + 600, p.y); Wind.force(null);
  ok(Ws.g < Wc.g * 0.7, `🌬 в пургу дальний звук тонет в ветре (${Ws.g.toFixed(2)} против ${Wc.g.toFixed(2)})`);
  let got = null; const bu = Sound.place.bind(Sound); Sound.at(p.x - 400, p.y, () => { got = bu(1, 0); });
  ok(got && got.pan < -0.5 && got.vol < 1, `🔊 Sound.at: звук внутри берёт место (vol ${got && got.vol.toFixed(2)}, pan ${got && got.pan.toFixed(2)})`);

  // ---------- 8. ночью без огня — нет светлого круга ----------
  fresh(16); put(HUT.x + 900, HUT.y + 700); G.time = tAt(1, 23); G.fires.length = 0; G.p.torch = 0; Ctx.reset();
  ok(Ctx.now().light < 0.2, `🌙 ночь, в поле без огня: свет у героя ${Ctx.now().light.toFixed(2)} (только луна)`);
  G.fires.push({ x: G.p.x + 40, y: G.p.y, fuel: 200 }); Ctx.reset();
  ok(Ctx.now().light > 0.6, `🔥 ночь у костра: свет ${Ctx.now().light.toFixed(2)}`);
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
    await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Ctx !== 'undefined' && typeof GFX !== 'undefined');
    await pg.evaluate(() => { localStorage.clear(); UI.openChest(); }); // модалка держит главный цикл на паузе
    out = await pg.evaluate(`(${page})()`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: context · провалов ${bad}` : '\nOK: context · сводка, реплики, тосты, снег, ветер, звук');
  process.exit(bad ? 1 : 0);
})();
