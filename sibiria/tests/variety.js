// Инвариант разнообразия: соседние копии одного типа не штамп — различаются хотя бы по 2 признакам из
// (размер, вариант/форма, поворот/зеркало, поза, цвет). Классы: ёлки края мира (стена), кочки мари, зайцы.
// Плюс: край мира держит героя (clamp) — после прогона к краю герой внутри.
//   cd tests && NODE_PATH=… node variety.js
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(500);
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await pg.click('#start'); await pg.waitForTimeout(1500);
  const out = await pg.evaluate(() => {
    const res = {};
    // признаки: у каждого — функция, дающая «значение» признака (разные значения = отличие)
    const CLS = {
      wallTrees: { list: G.trees.filter(t => t.wall), R: 60, f: { size: t => Math.round(t.s / 0.15), variant: t => t.kind * 8 + t.v, color: t => t.dk | 0 } },
      tussocks: { list: G.tussocks, R: 26, f: { size: t => Math.round(t.s / 0.2), variant: t => t.v, turn: t => (t.m || 1) + ':' + Math.round((t.rot || 0) / 0.15), color: t => t.c } },
      hares: { list: G.hares, R: 120, f: { size: h => Math.round(h.sz / 0.02), color: h => h.coat, pose: h => h.pose, turn: h => h.face } },
    };
    for (const [k, C] of Object.entries(CLS)) {
      const L = C.list, keys = Object.keys(C.f), vals = L.map(o => keys.map(q => C.f[q](o)));
      let pairs = 0, bad = 0, ex = null; const used = keys.map(() => new Set());
      vals.forEach(v => v.forEach((x, i) => used[i].add(x)));
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const dx = L[i].x - L[j].x; if (Math.abs(dx) > C.R) continue;
        const dy = L[i].y - L[j].y; if (dx * dx + dy * dy > C.R * C.R) continue;
        pairs++; const d = keys.reduce((n, q, qi) => n + (vals[i][qi] !== vals[j][qi]), 0);
        if (d < 2) { bad++; if (!ex) ex = [L[i], L[j]].map(o => ({ x: o.x, y: o.y, ...Object.fromEntries(keys.map(q => [q, C.f[q](o)])) })); }
      }
      res[k] = { n: L.length, pairs, bad, kinds: Object.fromEntries(keys.map((q, i) => [q, used[i].size])), ex };
    }
    // край: пробуем уйти за мир
    G.p.x = 5; G.p.y = 5; World.solid(G.p, 10, 'p'); res.edge = { x: G.p.x, y: G.p.y, inside: G.p.x >= 40 && G.p.y >= 40 };
    return res;
  });
  let ok = !errs.length;
  for (const k of ['wallTrees', 'tussocks', 'hares']) {
    const r = out[k], pass = r.n > 0 && r.bad === 0 && Object.values(r.kinds).filter(n => n > 1).length >= 2;
    ok = ok && pass;
    console.log(`${pass ? '✅' : '❌'} ${k}: ${r.n} шт, пар соседей ${r.pairs}, штампов ${r.bad}, значений признаков ${JSON.stringify(r.kinds)}${r.ex ? ' пример ' + JSON.stringify(r.ex) : ''}`);
  }
  console.log(`${out.edge.inside ? '✅' : '❌'} край держит героя: (${out.edge.x}, ${out.edge.y})`); ok = ok && out.edge.inside;
  if (errs.length) console.log('ошибки страницы:', errs);
  console.log(ok ? 'VARIETY OK' : 'VARIETY FAIL');
  await b.close(); process.exit(ok ? 0 : 1);
})();
