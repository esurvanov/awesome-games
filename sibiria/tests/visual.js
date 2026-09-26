#!/usr/bin/env node
// Визуальные регрессии canvas (C9, SPEC-art §4): 16 эталонных сцен.
//   node visual.js            — снять сцены и сравнить с tests/visual-baseline/*.png (exit 1 при регрессии)
//   node visual.js --update   — переснять эталоны (только вместе с принятой правкой арта!)
//   VR_SCENES=menu,night node visual.js  — только выбранные сцены
// Детерминизм снаружи, код игры не трогаем: Math.random → mulberry32 с seed, виртуальные часы
// (performance.now / Date.now), своя очередь rAF и setTimeout, quality=high, dpr фиксирован, сеть выключена.
// Снимается только canvas (#game или #finale) — DOM-HUD и шрифты не влияют.
// Отличия → tests/visual-diff/<сцена>-diff.png (+ <сцена>-current.png).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
let pixelmatch = require('pixelmatch'); if (pixelmatch.default) pixelmatch = pixelmatch.default;

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(__dirname, 'visual-baseline'), DIFF = path.join(__dirname, 'visual-diff');
const VIEW = { width: 960, height: 600 };
const THRESH = 0.1;      // допуск цвета pixelmatch (YIQ), 0..1
// доля отличающихся пикселей на сцену (0.1 %), выше — регрессия. Повтор даёт ровно 0 px, поэтому можно строже:
// VR_MAX=0.0002 (0.02 %) ловит и сдвиг героя на 6 px ночью (≈0.08 %), который 0.1 % пропускает.
const MAX_DIFF = +(process.env.VR_MAX || 0.001);

const FREEZE = dpr => `(() => {
  let s = 12345; // mulberry32
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__vrSeed = v => { s = v | 0; };
  let T = 1000; // виртуальные часы, мс
  performance.now = () => T; const D0 = 1767225600000; Date.now = () => D0 + T;
  const q = []; window.requestAnimationFrame = f => { q.push(f); return q.length; }; window.cancelAnimationFrame = () => {};
  const tq = []; let tid = 0;
  window.setTimeout = (f, ms) => { tq.push({ f, at: T + (ms || 0), id: ++tid }); return tid; };
  window.clearTimeout = id => { const i = tq.findIndex(t => t.id === id); if (i >= 0) tq.splice(i, 1); };
  window.setInterval = () => 0; window.clearInterval = () => {};
  window.__vrStep = (n = 1, dtMs = 1000 / 60) => { for (let i = 0; i < n; i++) { T += dtMs;
    for (let j = 0; j < tq.length; j++) if (tq[j].at <= T) { const t = tq.splice(j--, 1)[0]; try { t.f(); } catch (e) {} }
    const fs = q.splice(0); for (const f of fs) f(T); } };
  try { localStorage.clear(); localStorage.setItem('sibir-quality', 'high'); } catch (e) {}
  Object.defineProperty(window, 'devicePixelRatio', { get: () => ${dpr} });
})();`;

// play(): новая игра без карточки главы и диалогов; далее сцена настраивает мир
const PRELUDE = `window.play = () => { newGame(); GFX.reset(); state = 'play';
  for (const id of ['menu','chapter','dialog','over','pause','slots','panel','note']) { const e = document.getElementById(id); if (e) e.hidden = true; } };`;

// 16 сцен SPEC-art §4: fn выполняется в странице (seed 777), потом frames шагов по 1/60 с
const SCENES = {
  menu:     { frames: 60, fn: null },                                           // 1 диорама у избы, сияние
  day:      { frames: 90, fn: () => { play(); G.time = tAt(1, 12); } },         // 2 палитра, короткие тени
  dawn:     { frames: 90, fn: () => { play(); G.time = tAt(1, 7); } },          // 3 длинные тени
  dusk:     { frames: 90, fn: () => { play(); G.time = tAt(1, 18.5); G.fires.push({ x: G.p.x + 60, y: G.p.y + 20, fuel: 9999 }); } }, // 4 тёплый свет, искры
  night:    { frames: 90, fn: () => { play(); G.time = tAt(1, 23); G.aurora = 1; } },  // 5 ночной грейд, сияние
  storm:    { frames: 90, fn: () => { play(); G.time = tAt(1, 13); G.storm = { a: G.time - 5, b: G.time + 60 }; } }, // 6 пурга
  hut:      { frames: 90, fn: () => { play(); G.time = tAt(1, 21); G.hut.walls = G.hut.door = 1; G.hut.fuel = 400; G.p.x = HUT.x; G.p.y = HUT.y; } }, // 7 печь, окна
  forest:   { frames: 90, fn: () => { play(); G.time = tAt(1, 11); const t = G.trees.find(t => !t.wall); G.p.x = t.x + 30; G.p.y = t.y + 10; } }, // 8 лес
  wolves:   { frames: 60, fn: () => { play(); G.time = tAt(1, 22); G.s.hp = 1e9; Wolves.spawnPack(4, true);
    for (const w of G.wolves) { w.x = G.p.x + (Math.random() - .5) * 300; w.y = G.p.y + (Math.random() - .5) * 200; } } }, // 9 стая
  wreck:    { frames: 90, fn: () => { play(); G.time = tAt(1, 15); G.p.x = POI.cockpit.x; G.p.y = POI.cockpit.y + 90; } }, // 10 Ми-8, реквизит
  stormNight: { frames: 90, fn: () => { play(); G.time = tAt(1, 23); G.storm = { a: G.time - 5, b: G.time + 60 }; } }, // 11 L1, L7
  fireBehindHut: { frames: 90, fn: () => { play(); G.time = tAt(1, 23); G.s.hp = 1e9; G.hut.walls = G.hut.door = 1;
    G.fires.push({ x: HUT.x + 20, y: HUT_IN.y0 - 60, fuel: 9999 }); G.p.x = HUT.x + 120; G.p.y = HUT_IN.y1 + 90; } }, // 12 L3
  riverZoom: { frames: 90, dpr: 2, fn: () => { play(); G.time = tAt(1, 12); G.p.y = 1500; G.p.x = riverX(G.p.y) - 140; GFX.setZoom(1.6); GFX.recenter(); } }, // 13 L2, Z1, Z2
  chumSled: { frames: 90, fn: () => { play(); G.time = tAt(1, 14); G.gear.sled = 1; G.p.x = POI.chum.x + 80; G.p.y = POI.chum.y + 100; } }, // 14 опорная линия
  village:  { frames: 90, fn: () => { play(); G.time = tAt(1, 22.5); G.s.hp = 1e9; G.p.x = HUT.x + 60; G.p.y = HUT.y + 200;
    const put = (t, x, y) => { G.col.ghost = { type: t, x, y }; Colony.place(); };
    put('balok', HUT.x + 260, HUT.y + 40); put('woodshed', HUT.x - 300, HUT.y + 120); put('smoke', HUT.x + 260, HUT.y + 200);
    put('tower', HUT.x + 60, HUT.y + 300); put('balok', HUT.x - 260, HUT.y + 260);
    G.col.ghost = null; for (const b of G.col.builds) { b.prog = 1; b.done = 1; if (b.type === 'tower') b.fuel = 60; }
    const types = ['bich', 'bich', 'bich', 'bich', 'evenk', 'evenk', 'evenk', 'laika', 'laika', 'strelok', 'strelok', 'bich'];
    types.forEach((t, i) => { const a = i / types.length * Math.PI * 2; Colony.spawn(t, { x: G.p.x + Math.cos(a) * 160, y: G.p.y + 40 + Math.sin(a) * 90 }); });
    G.col.sel = G.col.units.slice(0, 3).map(u => u.id); } }, // 15 посёлок ночью, 12 юнитов
  finale:   { frames: 180, canvas: 'finale', fn: () => { play(); Finale.play('A', { pop: 8, vera: true, urk: true, day: 9 }, () => {}); } }, // 16 финал, 3 с
};

async function shoot(browser, name, sc) {
  const dpr = sc.dpr || 1;
  const pg = await browser.newPage({ viewport: VIEW, deviceScaleFactor: dpr });
  try {
    await pg.route(/^https?:/, r => r.abort()); // шрифты из сети не нужны
    await pg.addInitScript(FREEZE(dpr));
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load' });
    await pg.evaluate(PRELUDE);
    await pg.evaluate(() => window.__vrStep(2));
    if (sc.fn) await pg.evaluate(`window.__vrSeed(777); (${sc.fn.toString()})()`);
    await pg.evaluate(n => window.__vrStep(n), sc.frames);
    const b64 = await pg.evaluate(id => document.getElementById(id).toDataURL('image/png').split(',')[1], sc.canvas || 'game');
    return { png: Buffer.from(b64, 'base64'), errs };
  } finally { await pg.close(); }
}

function compare(bufA, bufB) {
  const A = PNG.sync.read(bufA), B = PNG.sync.read(bufB);
  if (A.width !== B.width || A.height !== B.height) return { n: -1, ratio: 1, size: `${A.width}×${A.height} ≠ ${B.width}×${B.height}` };
  const D = new PNG({ width: A.width, height: A.height });
  const n = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: THRESH, includeAA: false, alpha: 0.3 });
  return { n, ratio: n / (A.width * A.height), diff: n ? PNG.sync.write(D) : null };
}

(async () => {
  const update = process.argv.includes('--update');
  const only = process.env.VR_SCENES ? process.env.VR_SCENES.split(',') : Object.keys(SCENES);
  fs.mkdirSync(BASE, { recursive: true }); fs.mkdirSync(DIFF, { recursive: true });
  for (const f of fs.readdirSync(DIFF)) if (f.endsWith('.png') && only.some(n => f.startsWith(n + '-'))) fs.unlinkSync(path.join(DIFF, f));
  let fail = 0, browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--force-color-profile=srgb'] });
    for (const name of only) {
      const sc = SCENES[name]; if (!sc) { console.log(`FAIL ${name}: нет такой сцены`); fail++; continue; }
      const t0 = Date.now(); const { png, errs } = await shoot(browser, name, sc);
      const ms = Date.now() - t0;
      if (errs.length) { console.log(`FAIL ${name}: PAGEERR ${errs.join(' | ')}`); fail++; }
      const bf = path.join(BASE, name + '.png');
      if (update) { fs.writeFileSync(bf, png); console.log(`base ${name.padEnd(14)} ${ms} мс`); continue; }
      if (!fs.existsSync(bf)) { console.log(`FAIL ${name}: нет эталона (node visual.js --update)`); fail++; continue; }
      const r = compare(fs.readFileSync(bf), png);
      const bad = r.ratio > MAX_DIFF; fail += bad;
      if (r.n) { fs.writeFileSync(path.join(DIFF, name + '-current.png'), png); if (r.diff) fs.writeFileSync(path.join(DIFF, name + '-diff.png'), r.diff); }
      console.log(`${bad ? 'FAIL' : 'ok  '} ${name.padEnd(14)} ${r.size || r.n + ' px ' + (r.ratio * 100).toFixed(3) + ' %'}  ${ms} мс`);
    }
  } finally { if (browser) await browser.close(); }
  console.log(fail ? `\nвизуальных регрессий: ${fail} (см. tests/visual-diff/)` : '\nвсе сцены совпали с эталоном');
  process.exit(fail ? 1 : 0);
})();
