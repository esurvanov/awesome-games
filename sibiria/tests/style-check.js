#!/usr/bin/env node
// Общий словарь (js/style.js), гибрид: мягкая фактура прежней игры + то, что делает мир одним целым.
//   1. одно солнце: мягкая тень ели и тень героя ложатся по Style.SHV (вправо-вниз), ель освещена с той же стороны;
//   2. одна таблица времени суток: ночь умножает снег, избу и ели одним множителем (Style.ambientAt), без квантования в роли;
//   3. нет контуров: у героя и елей нет кольца туши (плоский режим C выключен);
//   4. кадр не дороже прежнего: гибрид vs словарь выключен ('old') — время рендера ≤ ×1.15.
// node style-check.js  (exit 1 при провале). Кадры — tests/shots/style-*.png
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), SHOTS = path.join(__dirname, 'shots');
const FREEZE = `(() => {
  let s = 12345;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__vrSeed = v => { s = v | 0; };
  let T = 1000; performance.now = () => T; const D0 = 1767225600000; Date.now = () => D0 + T;
  const q = []; window.requestAnimationFrame = f => { q.push(f); return q.length; }; window.cancelAnimationFrame = () => {};
  const tq = []; let tid = 0;
  window.setTimeout = (f, ms) => { tq.push({ f, at: T + (ms || 0), id: ++tid }); return tid; };
  window.clearTimeout = id => { const i = tq.findIndex(t => t.id === id); if (i >= 0) tq.splice(i, 1); };
  window.setInterval = () => 0; window.clearInterval = () => {};
  window.__vrStep = (n = 1, dtMs = 1000 / 60) => { for (let i = 0; i < n; i++) { T += dtMs;
    for (let j = 0; j < tq.length; j++) if (tq[j].at <= T) { const t = tq.splice(j--, 1)[0]; try { t.f(); } catch (e) {} }
    const fs = q.splice(0); for (const f of fs) f(T); } };
  try { localStorage.clear(); localStorage.setItem('sibir-quality', 'high'); } catch (e) {}
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });
})();`;
// одинокая ель в чистой тайге (без реки, избы, зон); соседи срублены — тень только её
const PRELUDE = `window.play = () => { newGame(); GFX.reset(); state = 'play'; G.s.hp = 1e9; G.wolves = []; G.bear = null; G.hares = [];
  for (const id of ['menu','chapter','dialog','over','pause','slots','panel','note']) { const e = document.getElementById(id); if (e) e.hidden = true; } UI.goalTarget = () => null; };
  window.clearSpot = () => {
    const far = (x, y) => Math.abs(riverX(y) - x) > 900 && Math.hypot(x - HUT.x, y - HUT.y) > 800 && !Zones.OBJS.some(o => Math.hypot(o.x - x, o.y - y) < 600);
    const plain = (x, y) => { for (let dx = -500; dx <= 500; dx += 125) for (let dy = -380; dy <= 380; dy += 95) { const k = Zones.terrainKey(x + dx, y + dy); if (k !== 'core' && k !== 'taiga') return false; } return true; };
    const c = G.trees.filter(t => t.kind === 0 && !t.wall && t.wood > 0 && t.s > 1 && far(t.x, t.y) && plain(t.x, t.y));
    c.sort((a, b) => a.x - b.x + (a.y - b.y) * 0.001); const t = c[Math.floor(c.length / 2)];
    for (const q of G.trees) if (q !== t && Math.hypot(q.x - t.x, q.y - t.y) < 420) q.wood = 0; return t;
  };`;
const VIEW = { width: 1000, height: 700 };

async function frame(b, setup, opt = {}) {
  const pg = await b.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
  await pg.route(/^https?:/, r => r.abort());
  await pg.addInitScript(FREEZE);
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load' });
  await pg.evaluate(PRELUDE); await pg.evaluate(() => __vrStep(2));
  const info = await pg.evaluate(`(() => { __vrSeed(777); play(); const t = clearSpot(); const r = (${setup.toString()})(t) || {}; __vrStep(${opt.frames || 30});
    return Object.assign(r, { tree: { x: t.x, y: t.y }, cam: { x: cam.x, y: cam.y }, zoom: GFX.zoom, p: { x: G.p.x, y: G.p.y }, table: Style.table(), on: Style.on, flat: Style.flat }); })()`);
  const b64 = await pg.evaluate(() => document.getElementById('game').toDataURL('image/png').split(',')[1]);
  if (opt.name) fs.writeFileSync(path.join(SHOTS, 'style-' + opt.name + '.png'), Buffer.from(b64, 'base64'));
  const px = await pg.evaluate(() => { const c = document.getElementById('game'), g = c.getContext('2d'); return Array.from(g.getImageData(0, 0, c.width, c.height).data); });
  await pg.close();
  return { info, px, w: VIEW.width, h: VIEW.height, errs };
}
const at = (F, x, y) => { const o = (y * F.w + x) * 4; return [F.px[o], F.px[o + 1], F.px[o + 2]]; };
const luma = c => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
// тень: пиксели, ставшие темнее (A против B без предмета) ниже опоры, — центр относительно опоры (bx, by)
function shadowDir(A, B, bx, by, rx, ry) {
  let sx = 0, sy = 0, n = 0;
  for (let y = by + 3; y < Math.min(A.h, by + ry); y++) for (let x = Math.max(0, bx - rx); x < Math.min(A.w, bx + rx); x++) {
    const d = luma(at(B, x, y)) - luma(at(A, x, y)); if (d > 6) { sx += (x - bx) * d; sy += (y - by) * d; n += d; }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-color-profile=srgb'] });
  let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
  const deg = v => (v * 180 / Math.PI).toFixed(0);
  // ---------- 1. одно солнце ----------
  console.log('одно солнце:');
  const view = `G.time = tAt(1, 12); G.p.x = t.x - 150; G.p.y = t.y + 120; Hero.snap(); GFX.setZoom(1.5); GFX.lookAt(t.x - 60, t.y + 20);`;
  const A = await frame(b, new Function('t', view), { name: 'sun' });
  const Bt = await frame(b, new Function('t', view + ' t.wood = 0;'));
  const Bh = await frame(b, new Function('t', view + ' G.p.x += 2000;'));
  ok(!A.errs.length, 'кадр без ошибок' + (A.errs.length ? ': ' + A.errs[0] : ''));
  ok(A.info.on && !A.info.flat, `словарь — гибрид (on ${A.info.on}, плоский C ${A.info.flat})`);
  const T = A.info.table, want = Math.atan2(T.shadow.y, T.shadow.x), z = A.info.zoom, toS = (x, y) => [Math.round((x - A.info.cam.x) * z), Math.round((y - A.info.cam.y) * z)];
  const [tx, ty] = toS(A.info.tree.x, A.info.tree.y), st = shadowDir(A, Bt, tx, ty, 260, 220);
  ok(st && st.x > 0 && st.y > 0 && Math.abs(Math.atan2(st.y, st.x) - want) < 0.45, `тень ели: центр (${st ? st.x.toFixed(0) : '-'}, ${st ? st.y.toFixed(0) : '-'}) от комля, ${st ? deg(Math.atan2(st.y, st.x)) : '-'}° ↔ солнце ${deg(want)}° (±25°)`);
  const [hx, hy] = toS(A.info.p.x, A.info.p.y), sh = shadowDir(A, Bh, hx, hy, 90, 70);
  ok(sh && sh.x > 0 && sh.y > 0 && Math.abs(Math.atan2(sh.y, sh.x) - want) < 0.6, `тень героя: (${sh ? sh.x.toFixed(0) : '-'}, ${sh ? sh.y.toFixed(0) : '-'}), ${sh ? deg(Math.atan2(sh.y, sh.x)) : '-'}° ↔ солнце ${deg(want)}°`);
  const LD = await (async () => { const pg = await b.newPage(); await pg.goto('file://' + path.join(ROOT, 'index.html')); const v = await pg.evaluate(() => Tree.LD); await pg.close(); return v; })();
  ok(LD && LD.every((v, k) => Math.abs(v - T.sun[k]) < 1e-9), `свет модели ели = солнце словаря (${LD && LD.map(v => v.toFixed(2)).join(', ')})`);
  ok(T.sun[0] < 0 && T.sun[2] > 0 && T.shadow.x > 0 && T.shadow.y > 0, `солнце (${T.sun.map(v => v.toFixed(2)).join(', ')}), тень на 1 px высоты (${T.shadow.x.toFixed(2)}, ${T.shadow.y.toFixed(2)})`);
  // ---------- 2. одна таблица времени суток ----------
  console.log('одна таблица времени суток:');
  const hutView = h => new Function('t', `G.time = tAt(1, ${h}); G.storm = null; G.p.x = HUT.x - 200; G.p.y = HUT.y + 260; Hero.snap(); GFX.setZoom(1); GFX.lookAt(HUT.x, HUT.y + 40);`);
  const D = await frame(b, hutView(12), { name: 'day' }), N = await frame(b, hutView(23), { name: 'night' });
  const amb = (await (async () => { const pg = await b.newPage(); await pg.goto('file://' + path.join(ROOT, 'index.html')); const v = await pg.evaluate(() => Style.ambientAt(23, false)); await pg.close(); return v; })());
  // области кадра: крыша избы, сруб, снег, ели (по яркости дня)
  const regions = { snow: [], roof: [], tree: [] };
  for (let y = 40; y < D.h - 40; y += 3) for (let x = 40; x < D.w - 40; x += 3) {
    const d = at(D, x, y), n = at(N, x, y), L = luma(d); if (L < 20) continue; const k = luma(n) / L;
    const inHut = Math.abs(x - D.w / 2) < 150 && y < D.h / 2 - 20 && y > D.h / 2 - 260;
    if (inHut && L > 200) regions.roof.push(k); else if (!inHut && L > 215) regions.snow.push(k); else if (!inHut && L < 120 && d[1] >= d[0]) regions.tree.push(k);
  }
  const ks = Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, med(v)])), K = luma(amb) / 255;
  ok(Object.values(regions).every(v => v.length > 40), `выборки: снег ${regions.snow.length}, крыша ${regions.roof.length}, ели ${regions.tree.length}`);
  const spread = Math.max(...Object.values(ks)) / Math.min(...Object.values(ks));
  ok(spread < 1.45, `ночь/день: снег ${ks.snow.toFixed(2)}, крыша избы ${ks.roof.toFixed(2)}, ели ${ks.tree.toFixed(2)} — один множитель (разброс ×${spread.toFixed(2)} < 1.45; таблица ${K.toFixed(2)})`);
  // ---------- 3. нет контуров ----------
  console.log('без контуров:');
  {
    const F = await frame(b, new Function('t', `G.time = tAt(1, 12); G.p.x = t.x - 260; G.p.y = t.y + 160; Hero.snap(); GFX.setZoom(2); GFX.lookAt(G.p.x, G.p.y - 20);`), { name: 'hero-z2' });
    // справа от куртки героя: тёмная кромка (тушь) ≥ 2 px подряд перед снегом — признак контура
    const sx = Math.round((F.info.p.x - F.info.cam.x) * F.info.zoom), sy = Math.round((F.info.p.y - F.info.cam.y) * F.info.zoom); let rows = 0, ink = 0;
    for (let y = sy - 70; y < sy - 20; y++) { let x = sx + 40; while (x > sx - 30 && luma(at(F, x, y)) > 190) x--; if (x <= sx - 30) continue; rows++;
      let k = 0; while (k < 6 && luma(at(F, x - k, y)) < 60) k++; if (k >= 2) ink++; }
    ok(rows > 10 && ink / rows < 0.3, `герой: кромка тушью в ${ink} из ${rows} строк (< 30 %)`);
    ok(!F.info.flat, 'плоский режим C выключен (2 тона, тушь, ореол — только при sibir-style = flat)');
  }
  // ---------- 4. стоимость кадра ----------
  console.log('стоимость кадра (гибрид / словарь выключен):');
  {
    const cost = async style => {
      const pg = await b.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
      await pg.addInitScript(s => { window.STYLE = s; try { localStorage.setItem('sibir-quality', 'high'); } catch (e) {} }, style);
      await pg.goto('file://' + path.join(ROOT, 'index.html')); await pg.waitForTimeout(400);
      const r = await pg.evaluate(() => { newGame(); GFX.reset(); state = 'play'; G.time = tAt(1, 11); G.p.x = HUT.x + 40; G.p.y = HUT.y + 220;
        for (let i = 0; i < 60; i++) GFX.render(1 / 60); const best = [];
        for (let k = 0; k < 6; k++) { const a = performance.now(); for (let i = 0; i < 20; i++) GFX.render(1 / 60); best.push((performance.now() - a) / 20); }
        return Math.min(...best); });
      await pg.close(); return r;
    };
    const runs = []; for (let i = 0; i < 2; i++) runs.push([await cost('hyb'), await cost('old')]);
    const hy = Math.min(...runs.map(r => r[0])), od = Math.min(...runs.map(r => r[1]));
    ok(hy <= od * 1.15 + 0.3, `кадр ${hy.toFixed(2)} мс ↔ ${od.toFixed(2)} мс (≤ ×1.15)`);
  }
  await b.close();
  console.log(fail ? `FAIL ${fail}` : 'style-check: всё ок');
  process.exit(fail ? 1 : 0);
})();
