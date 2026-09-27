// Производительность под «слабую машину»: зал в пик (21:30, ~25 человек), CPU ×4 (CDP), ноутбук и телефон.
// Два прогона:
//   gpu  — настоящая видеокарта (ANGLE/Metal). Headless держит rAF ~60 Гц, поэтому меряем работу кадра
//          (симуляция + люди + отрисовка + интерфейс): fps ≈ 1000 / max(кадр, 16,7).
//   soft — программная отрисовка SwiftShader (как ноутбук без видеокарты / слабая встройка): растеризует CPU,
//          поэтому кадр = max(работа кадра на CPU ×4, отрисовка с ожиданием растеризации); печатаем и настоящие
//          интервалы rAF (на занятой машине они ниже — процесс GPU делит ядра; STRICT=1 проверяет и их).
//          Проверки: на низком ≥ 30 кадров/с; авто само приходит к подходящему уровню за ≤ 3 с после старта
//          в пике и потом не скачет (и по устройству, и «вслепую» — только по замерам кадров).
// Замечание: CDP ×4 замедляет только поток страницы; SwiftShader считает в процессе GPU на полной скорости машины.
// node perf.js [gpu|soft|all=all] [throttle=4] [seconds=5]
import { devices } from 'playwright';
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { launch, watch, enterHall, skipTo } from './game.js';
const MODE = process.argv[2] && /^[a-z]+$/.test(process.argv[2]) ? process.argv[2] : 'all';
const num = process.argv.slice(2).filter(a => /^[\d.]+$/.test(a)).map(Number);
const THR = num[0] || 4, SEC = num[1] || 5, STRICT = !!process.env.STRICT;   // STRICT=1 — проверять и настоящие кадры/с
const SOFT = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const { srv, url } = await serve();
let bad = 0;
const fail = msg => { bad++; console.log('  ✗', msg); };

async function open(b, ctxOpt, qual) {
  const ctx = await b.newContext(ctxOpt), pg = await ctx.newPage();
  pg.setDefaultTimeout(120000); pg.setDefaultNavigationTimeout(120000);
  const errs = []; watch(pg, errs);
  await pg.goto(url + '?seed=3');
  await pg.evaluate(q => { localStorage.clear(); if (q) localStorage.setItem('skhodka-settings', JSON.stringify({ quality: q })); }, qual);
  await pg.reload();
  await enterHall(pg);
  await skipTo(pg, 21.5);
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
  await pg.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window); window.__f = []; window.__i = []; let last = 0;
    window.requestAnimationFrame = cb => raf(t => { const a = performance.now(); if (last) window.__i.push(a - last); last = a; cb(t); window.__f.push(performance.now() - a); });
  });
  return { ctx, pg, cdp, errs };
}
const SETUPS = [
  ['пик, общий вид', () => { SKHODKA.sc.ctl.home(); }],
  ['пик, разговор', () => { const w = SKHODKA.w, P = w.player; let best = null, bd = 1e9; for (const n of w.list) { if (!n.present || n.state === 'talk') continue; const d = Math.hypot(n.x - P.x, n.z - P.z); if (d < bd) { bd = d; best = n; } } if (best) w.act({ type: 'approach', id: best.id }); }],
];
const measure = pg => pg.evaluate(() => {
  const a = window.__f.slice(1).sort((x, y) => x - y), avg = a.length ? a.reduce((s, x) => s + x, 0) / a.length : 9999;
  const iv = window.__i.slice(2), ia = iv.reduce((s, x) => s + x, 0) / Math.max(1, iv.length), G = SKHODKA, q = G.sc.quality;
  const is = iv.slice().sort((x, y) => x - y);
  return { ms: avg, p95: a[Math.floor(a.length * 0.95)] ?? 9999, real: 1000 / ia, low5: 1000 / (is[Math.floor(is.length * 0.95)] || 1e9), q: q.level, rs: q.rs,
    dpr: G.sc.renderer.getPixelRatio(), n: G.pp.map.size, calls: G.sc.renderer.info.render.calls, tris: G.sc.renderer.info.render.triangles, sim: G.w.perf.ms };
});
// время отрисовки кадра целиком (с ожиданием растеризации: readPixels ждёт, пока SwiftShader дорисует):
// 12 заходов по 3 кадра с паузами, берём лучший — машину, на которой идёт тест, делят и другие процессы
const gpuFrame = async pg => {
  let best = 1e9;
  for (let k = 0; k < 12; k++) {
    best = Math.min(best, await pg.evaluate(() => {
      const sc = SKHODKA.sc, R = sc.renderer, gl = R.getContext(), px = new Uint8Array(4); let b = 1e9;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 3; i++) { const t0 = performance.now(); R.render(sc.scene, sc.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); b = Math.min(b, performance.now() - t0); }
      return b;
    }));
    await pg.waitForTimeout(250);
  }
  return best;
};
const fmtQ = o => `${o.q}×${o.rs.toFixed(2)} (dpr ${o.dpr.toFixed(2)})`;

// ─── gpu: работа кадра ───
async function gpu() {
  const b = await launch(['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  for (const [name, opt, q] of [
    ['ноутбук 1366×768, авто', { viewport: { width: 1366, height: 768 } }, null],
    ['ноутбук 1366×768, низкое', { viewport: { width: 1366, height: 768 } }, 'low'],
    ['телефон Pixel 7, авто', devices['Pixel 7'], null],
  ]) {
    const { ctx, pg, errs } = await open(b, opt, q);
    console.log(`\nGPU · ${name}  CPU ×${THR}`);
    for (const [label, setup] of SETUPS) {
      await pg.evaluate(setup); await pg.waitForTimeout(1500);
      await pg.evaluate(() => { window.__f.length = 0; window.__i.length = 0; });
      await pg.waitForTimeout(SEC * 1000);
      const o = await measure(pg), fps = 1000 / Math.max(o.ms, 16.7);
      if (fps < 30) bad++;
      console.log(`  ${fps >= 30 ? 'ok  ' : 'SLOW'} ${label.padEnd(16)} кадр ${o.ms.toFixed(1)} мс (p95 ${o.p95.toFixed(1)}) ≈ ${fps.toFixed(0)} fps (реально ${o.real.toFixed(0)})  людей ${o.n} · вызовов ${o.calls} · треуг. ${(o.tris / 1000).toFixed(0)}k · сим ${o.sim.toFixed(2)} мс · ${fmtQ(o)}`);
    }
    if (errs.length) fail('ошибки: ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
}

// ─── soft: программная отрисовка, настоящие кадры/с и сходимость авто ───
async function soft() {
  const b = await chromium.launch({ headless: true, args: SOFT });
  const ren = await (async () => { const p = await b.newPage(); const r = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }); await p.close(); return r; })();
  console.log(`\nпрограммная отрисовка: ${ren}`);
  for (const [name, opt, q] of [
    ['ноутбук 1366×768, низкое', { viewport: { width: 1366, height: 768 } }, 'low'],
    ['ноутбук 1366×768, авто', { viewport: { width: 1366, height: 768 } }, null],
    ['телефон Pixel 7, низкое', devices['Pixel 7'], 'low'],
    ['телефон Pixel 7, авто', devices['Pixel 7'], null],
  ]) {
    const { ctx, pg, errs } = await open(b, opt, q);
    console.log(`\nSOFT · ${name}  CPU ×${THR}`);
    if (!q) {
      // сходимость: авто стартует заново (как при входе) прямо в пике; следим за уровнем 10 с.
      // «по устройству» — как в игре (программная отрисовка узнаётся сразу → low); «вслепую» — без этой подсказки,
      // от высокого, только по замерам кадров
      for (const blind of [false, true]) {
        const res = await pg.evaluate(async blind => {
          const Q = SKHODKA.sc.quality, soft = Q.soft;
          if (blind) Q.soft = false;
          const c0 = window.__i.length;
          Q.reset(); SKHODKA.sc.applyQuality(); Q.soft = soft;
          SKHODKA.sc.ctl.home();
          // отсчёт — с первого кадра после сброса (сам сброс перестраивает шейдеры — пауза, которой в игре нет:
          // там стартовый уровень собирается ещё на заставке)
          const tr0 = performance.now(), log = [];
          while (window.__i.length <= c0 + 1 && performance.now() - tr0 < 30000) await new Promise(r => setTimeout(r, 20));
          const t0 = performance.now(), stall = (t0 - tr0) / 1000;
          let prev = '';
          while (performance.now() - t0 < 10000) {
            const k = Q.level + '×' + Q.rs.toFixed(2);
            if (k !== prev) { log.push([(performance.now() - t0) / 1000, k, Q.rung]); prev = k; }
            await new Promise(r => setTimeout(r, 50));
          }
          return { log, stall };
        }, blind);
        const { log: tr, stall } = res;
        const settle = tr[tr.length - 1][0], ups = tr.slice(1).filter((x, i) => x[2] > tr[i][2]).length;
        console.log(`  авто ${blind ? 'вслепую     ' : 'по устройству'}: ${tr.map(([t, k]) => `${t.toFixed(1)}с ${k}`).join(' → ')}  (первый кадр после сброса через ${stall.toFixed(1)} с)`);
        if (settle > 3.2) fail(`авто${blind ? ' вслепую' : ''} сходится долго: последнее изменение на ${settle.toFixed(1)} с`);
        if (ups) fail(`авто${blind ? ' вслепую' : ''} скачет: ${ups} подъёмов за 10 с`);
      }
    }
    for (const [label, setup] of SETUPS) {
      await pg.evaluate(setup); await pg.waitForTimeout(1500);
      await pg.evaluate(() => { window.__f.length = 0; window.__i.length = 0; });
      await pg.waitForTimeout(SEC * 1000);
      const o = await measure(pg), g = await gpuFrame(pg), est = 1000 / Math.max(o.ms, g, 1000 / 60);
      const ok = (STRICT ? Math.min(est, o.real) : est) >= 30;
      if (!ok) fail(`${name}, ${label}: ${est.toFixed(0)} кадров/с (реально ${o.real.toFixed(0)})`);
      console.log(`  ${ok ? 'ok  ' : 'SLOW'} ${label.padEnd(16)} ≈ ${est.toFixed(0)} кадров/с (кадр на CPU ${o.ms.toFixed(1)} мс · отрисовка ${g.toFixed(1)} мс; реально ${o.real.toFixed(0)}, худшие 5% ${o.low5.toFixed(0)})  вызовов ${o.calls} · треуг. ${(o.tris / 1000).toFixed(0)}k · ${fmtQ(o)}`);
    }
    if (errs.length) fail('ошибки: ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
}

if (MODE === 'gpu' || MODE === 'all') await gpu();
if (MODE === 'soft' || MODE === 'all') await soft();
srv.close();
console.log(bad ? `\n${bad} проблем` : '\nвсё ≥ 30 fps, авто сходится');
process.exit(bad ? 1 : 0);
