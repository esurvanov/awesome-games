#!/usr/bin/env node
// Тяжёлая работа греет (TUNE.body.workK, Survival.rates): рубка — главное дело дня — не должна морозить быстрее ходьбы.
//   cd tests && node work-heat.js
//   1. каждое действие из workK: потеря тепла = стоя × work, плюс своё тепло workHeat (как лопата)
//   2. днём 1–6-го дня полного тепла хватает на работу топором ≥ WORK_MIN с (чистая работа на среднее дерево ~65 с, с обходом ~120 с)
//   3. днём работа топором тратит тепло медленнее ходьбы; ночью (без огня) работа всё равно не спасает — < NIGHT_MAX с
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const WORK_MIN = 180, NIGHT_MAX = 150;

function page({ WORK_MIN, NIGHT_MAX }) {
  const out = [], ok = (c, w) => { out.push((c ? 'ok   ' : 'FAIL ') + w); return c; };
  Director.tick = () => {};
  const B = TUNE.body, field = { x: HUT.x + 1400, y: HUT.y + 600, inside: false, moving: false };
  // секунд от 100 до 0: action — что делает (null — стоит), moving — идёт
  function secs(day, h, k, moving) {
    const p = Object.assign({}, field, { moving, action: k ? { k } : null }), t = tAt(day, h);
    const save = G.p; G.p = Object.assign({}, save, p);   // Depth.effort() смотрит на G.p — подставляем копию героя
    try {
      const { T } = Survival.air(p, t, 0, []), r = Survival.rates(p, T, 1 - daylight(h), false, 0, t);
      const net = r.loss - (k && B.workK.includes(k) ? B.workHeat : 0);
      return { loss: r.loss, net, s: net > 0 ? 100 / net : Infinity };
    } finally { G.p = save; }
  }
  const f = v => (v === Infinity ? '∞' : Math.round(v));
  // 1
  const stand = secs(1, 12, null, false);
  for (const k of B.workK) {
    const w = secs(1, 12, k, false);
    ok(Math.abs(w.loss - stand.loss * B.work) < 1e-9, `${k}: потеря ×${B.work}, тепло +${B.workHeat}/с · ${f(w.s)} с на полном тепле (стоя — ${f(stand.s)} с)`);
  }
  // 2–3
  for (let d = 1; d <= 6; d++) {
    const chop = secs(d, 12, 'chop', false), walk = secs(d, 12, null, true), night = secs(d, 23, 'chop', false);
    ok(chop.s >= WORK_MIN, `день ${d}, 12:00 · рубка ${f(chop.s)} с ≥ ${WORK_MIN}`);
    ok(chop.s > walk.s, `день ${d}, 12:00 · рубка (${f(chop.s)} с) теплее ходьбы (${f(walk.s)} с)`);
    ok(night.s < NIGHT_MAX, `день ${d}, 23:00 · рубка без огня ${f(night.s)} с < ${NIGHT_MAX} — ночь у огня`);
  }
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  let bad = 0;
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await pg.goto(URL, { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(800);
    await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await pg.click('#start'); await pg.waitForTimeout(400);
    const out = await pg.evaluate(page, { WORK_MIN, NIGHT_MAX });
    for (const l of out) { console.log(l); if (l.startsWith('FAIL')) bad++; }
    for (const e of errs) { console.log(e); bad++; }
  } finally { await b.close(); }
  console.log(bad ? `\nFAIL: work-heat · провалов ${bad}` : '\nOK: work-heat · тяжёлая работа греет, рубка днём по силам');
  process.exit(bad ? 1 : 0);
})();
