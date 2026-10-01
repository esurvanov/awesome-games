#!/usr/bin/env node
// Словарь C (js/style.js) в живом кадре: переведённое (снег, тропа, ели, герой, тени, свет) рисуется ролями словаря.
//   1. палитра: день / ночь / пурга / ночь у костра — доля пикселей кадра (центр, без интерфейса), попавших в роли словаря
//      после перекраски этого состояния (у костра — ещё и дневные роли), и число заметных цветов после квантования;
//   2. контур: тушь у героя постоянной экранной толщины на зуме 1 и 2 (px слева от куртки до бумаги);
//   3. тени: центр тени одинокой ели — вправо-вниз от комля по направлению Style.SHV (то же солнце, что светит ели слева).
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
// место без реки, избы и вещей зон: одинокая ель в редколесье, герой рядом (детерминированно по seed)
const PRELUDE = `window.play = () => { newGame(); GFX.reset(); state = 'play'; G.s.hp = 1e9; G.wolves = []; G.bear = null; G.goal = null;
  for (const id of ['menu','chapter','dialog','over','pause','slots','panel','note']) { const e = document.getElementById(id); if (e) e.hidden = true; } };
  window.clearSpot = () => {
    const far = (x, y) => Math.abs(riverX(y) - x) > 900 && Math.hypot(x - HUT.x, y - HUT.y) > 800 && !Zones.OBJS.some(o => Math.hypot(o.x - x, o.y - y) < 600)
      && Math.hypot(x - POI.cockpit.x, y - POI.cockpit.y) > 700 && Math.hypot(x - POI.chum.x, y - POI.chum.y) > 600 && Math.hypot(x - POI.labaz.x, y - POI.labaz.y) > 500;
    const lone = t => !G.trees.some(q => q !== t && q.wood > 0 && Math.abs(q.x - t.x) < 110 && Math.abs(q.y - t.y) < 120);
    const plain = (x, y) => { for (let dx = -500; dx <= 500; dx += 125) for (let dy = -380; dy <= 380; dy += 95) { const k = Zones.terrainKey(x + dx, y + dy); if (k !== 'core' && k !== 'taiga') return false; } return true; };
    const c = G.trees.filter(t => t.kind === 0 && !t.wall && t.wood > 0 && t.s > 1 && far(t.x, t.y) && lone(t) && plain(t.x, t.y));
    c.sort((a, b) => a.x - b.x + (a.y - b.y) * 0.001); return c[Math.floor(c.length / 2)];
  };
  window.UIoff = () => { UI.goalTarget = () => null; };
  window.place = t => { G.p.x = t.x - 70; G.p.y = t.y + 50; Hero.snap(); GFX.setZoom(1); GFX.lookAt(t.x, t.y - 20); };`;
const VIEW = { width: 1000, height: 700 };
const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

async function frame(b, setup, opt = {}) {
  const pg = await b.newPage({ viewport: VIEW, deviceScaleFactor: 1 });
  await pg.route(/^https?:/, r => r.abort());
  await pg.addInitScript(FREEZE);
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load' });
  await pg.evaluate(PRELUDE); await pg.evaluate(() => __vrStep(2));
  const info = await pg.evaluate(`(() => { __vrSeed(777); play(); UIoff(); const t = clearSpot(); const r = (${setup.toString()})(t) || {}; __vrStep(${opt.frames || 40});
    const T = Style.table(); return Object.assign(r, { tree: { x: t.x, y: t.y }, cam: { x: cam.x, y: cam.y }, zoom: GFX.zoom, table: T, on: Style.on }); })()`);
  const b64 = await pg.evaluate(() => document.getElementById('game').toDataURL('image/png').split(',')[1]);
  const buf = Buffer.from(b64, 'base64'); if (opt.name) fs.writeFileSync(path.join(SHOTS, 'style-' + opt.name + '.png'), buf);
  const px = await pg.evaluate(() => { const c = document.getElementById('game'), g = c.getContext('2d'); return Array.from(g.getImageData(0, 0, c.width, c.height).data); });
  await pg.close();
  return { info, px, w: VIEW.width, h: VIEW.height, errs };
}
// доля пикселей рамки, близких (RGB ≤ tol) к одному из цветов set; заметные цвета — ячейки 8³ с долей ≥ 1 %
function palette(F, set, rect, tol = 22) {
  const [x0, y0, x1, y1] = rect, bins = new Map(); let n = 0, hit = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * F.w + x) * 4, r = F.px[o], g = F.px[o + 1], b = F.px[o + 2]; n++;
    let ok = false; for (const c of set) if (Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol) { ok = true; break; }
    if (ok) hit++;
    const k = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5); bins.set(k, (bins.get(k) || 0) + 1);
  }
  const top = [...bins.entries()].filter(([, v]) => v / n >= 0.01).sort((a, b) => b[1] - a[1]);
  if (process.env.DEBUG) console.log(top.map(([k, v]) => `${((k >> 6) << 5) + 16},${(((k >> 3) & 7) << 5) + 16},${((k & 7) << 5) + 16}:${(v / n * 100).toFixed(1)}%`).join(' '));
  return { cover: hit / n, major: top.length };
}
const near = (p, c, tol = 26) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;
const at = (F, x, y) => { const o = (y * F.w + x) * 4; return [F.px[o], F.px[o + 1], F.px[o + 2]]; };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-color-profile=srgb'] });
  let fail = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };
  const CROP = [150, 110, 850, 590];
  // ---------- 1. палитра ----------
  const scenes = {
    day: t => { G.time = tAt(1, 12); place(t); },
    night: t => { G.time = tAt(1, 23); G.aurora = 0; place(t); },
    storm: t => { G.time = tAt(1, 13); G.storm = { a: G.time - 30, b: G.time + 600 }; place(t); },
    fire: t => { G.time = tAt(1, 23); G.aurora = 0; place(t); G.fires.push({ x: t.x - 30, y: t.y + 70, fuel: 9999 }); },
  };
  console.log('палитра (доля кадра в ролях словаря · заметных цветов):');
  for (const [name, fn] of Object.entries(scenes)) {
    const F = await frame(b, fn, { name, frames: name === 'storm' ? 200 : 40 });
    if (F.errs.length) ok(false, name + ': ошибки страницы ' + F.errs[0]);
    if (!F.info.on) { ok(false, 'словарь выключен (Style.on = false)'); break; }
    const M = F.info.table.mood, mood = name === 'fire' ? 'night' : name;
    const set = Object.values(M[mood]).concat(name === 'fire' ? Object.values(M.nightFire).concat(Object.values(M.nightRing), [hex(F.info.table.roles.ochre)]) : []);
    const r = palette(F, set, CROP);
    // пурга: снег идёт поверх всего — роли те же, но штрихи снега дают полутона
    const need = { day: 0.9, night: 0.9, storm: 0.85, fire: 0.8 }[name], maxC = { day: 9, night: 9, storm: 10, fire: 14 }[name];
    ok(r.cover >= need && r.major <= maxC, `${name.padEnd(6)} ${(r.cover * 100).toFixed(1)} % в ролях (≥ ${need * 100}) · ${r.major} цветов (≤ ${maxC}; ролей 7)`);
  }
  // ---------- 2. контур героя на зуме 1 и 2 ----------
  console.log('контур героя (тушь слева от куртки, px экрана):');
  const inkW = [];
  for (const z of [1, 2]) {
    const F = await frame(b, new Function('t', `G.time = tAt(1, 12); G.p.x = t.x - 260; G.p.y = t.y + 160; Hero.snap(); GFX.setZoom(${z}); GFX.lookAt(G.p.x, G.p.y - 20);`), { name: 'hero-z' + z, frames: 20 });
    const T = F.info.table.roles, red = hex(T.red), ink = hex(T.ink), paper = hex(T.paper), runs = [];
    for (let y = 0; y < F.h; y++) for (const sd of [-1, 1]) {   // тушь между бумагой и курткой (не штаны, не рюкзак) — с обеих сторон
      let x = sd < 0 ? 0 : F.w - 1; while (x >= 0 && x < F.w && !near(at(F, x, y), red)) x -= sd; if (x < 14 || x > F.w - 14) continue;
      // от последнего пикселя куртки до первого пикселя бумаги — тёмные (тушь + полпикселя сглаживания с каждой стороны)
      let k = 0, dark = true; while (k < 9 && !near(at(F, x + sd * (1 + k), y), paper, 34)) { const c = at(F, x + sd * (1 + k), y); if (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11 > 150) dark = false; k++; }
      if (k > 0 && k < 9 && dark) runs.push(k);
    }
    if (process.env.DEBUG) console.log('runs', runs.join(',')); runs.sort((a, c) => a - c); const med = runs.length ? runs[runs.length >> 1] : 0; inkW.push(med);
    ok(runs.length >= 4, `зум ${z}: ${runs.length} строк с кромкой, медиана ${med} px`);
  }
  ok(inkW[0] > 0 && Math.abs(inkW[0] - inkW[1]) <= 1, `толщина туши постоянна на экране: ${inkW[0]} px (зум 1) ↔ ${inkW[1]} px (зум 2)`);
  // ---------- 3. тени по направлению света ----------
  console.log('тени и свет:');
  {
    const F = await frame(b, t => { for (const q of G.trees) if (q !== t && Math.hypot(q.x - t.x, q.y - t.y) < 420) q.wood = 0; G.time = tAt(1, 12); G.p.x = t.x - 300; G.p.y = t.y + 200; Hero.snap(); GFX.setZoom(1); GFX.lookAt(t.x, t.y - 40); }, { name: 'shadow', frames: 20 });
    const T = F.info.table, shade = hex(T.roles.shade), pine = hex(T.roles.pine), ink = hex(T.roles.ink), z = F.info.zoom;
    const bx = Math.round((F.info.tree.x - F.info.cam.x) * z), by = Math.round((F.info.tree.y - F.info.cam.y) * z);
    let sx = 0, sy = 0, sn = 0, px = 0, pn = 0, ix = 0, inn = 0;
    for (let y = Math.max(0, by - 180); y < by - 20; y++) for (let x = Math.max(0, bx - 160); x < Math.min(F.w, bx + 220); x++) {
      const c = at(F, x, y); if (near(c, pine, 14)) { px += x; pn++; } else if (near(c, ink, 14)) { ix += x; inn++; }
    }
    // тень ели — связное пятно тона тени от комля (штрихи земли того же тона, но отдельно)
    const seen = new Set(), Q = []; let best = null, bd = 1e9;
    for (let y = by - 6; y < by + 12; y++) for (let x = bx - 6; x < bx + 30; x++) if (near(at(F, x, y), shade, 12)) { const d = Math.hypot(x - bx, y - by); if (d < bd) { bd = d; best = [x, y]; } }
    if (best) { Q.push(best); seen.add(best[1] * F.w + best[0]); }
    while (Q.length) { const [x, y] = Q.pop(); sx += x - bx; sy += y - by; sn++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, k = Y * F.w + X; if (X < 0 || Y < 0 || X >= F.w || Y >= F.h || seen.has(k) || Math.abs(X - bx) > 260 || Y < by - 40 || Y > by + 160) continue; if (near(at(F, X, Y), shade, 12)) { seen.add(k); Q.push([X, Y]); } } }
    const ang = Math.atan2(sy / sn, sx / sn), want = Math.atan2(T.shadow.y, T.shadow.x), d = Math.abs(ang - want) * 180 / Math.PI;
    ok(sn > 200 && sx > 0 && sy > 0 && d < 25, `тень ели: ${sn} px, центр (${(sx / sn).toFixed(0)}, ${(sy / sn).toFixed(0)}) от комля, угол ${(ang * 180 / Math.PI).toFixed(0)}° ↔ солнце ${(want * 180 / Math.PI).toFixed(0)}° (±25°)`);
    ok(pn > 50 && inn > 50 && px / pn < ix / inn, `крона: свет (хвоя) левее тени (тушь): ${(px / pn - bx).toFixed(1)} < ${(ix / inn - bx).toFixed(1)} px — свет слева, тень вправо`);
    ok(T.shadow.x > 0 && T.shadow.y > 0 && T.sun[0] < 0 && T.sun[2] > 0, `одно солнце: к свету (${T.sun.map(v => v.toFixed(2)).join(', ')}), тень на 1 px высоты (${T.shadow.x.toFixed(2)}, ${T.shadow.y.toFixed(2)})`);
  }
  await b.close();
  console.log(fail ? `FAIL ${fail}` : 'style-check: всё ок');
  process.exit(fail ? 1 : 0);
})();
