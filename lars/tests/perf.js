// Производительность под «слабую машину»: CPU ×4 (CDP), телефон и ноутбук, три масштаба, время ×16.
// Headless держит rAF ~60 Гц, поэтому меряем работу кадра (симуляция + отрисовка + HUD). fps ≈ 1000 / max(кадр, 16,7).
// node perf.js [throttle=4] [seconds=4]
import { chromium, devices } from 'playwright';
import { serve } from './serve.js';
const THR = +(process.argv[2] || 4), SEC = +(process.argv[3] || 4);
const { srv, url } = await serve();
const b = await chromium.launch({ headless: true, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-gl=angle', '--use-angle=' + (process.env.ANGLE || 'metal'), '--enable-unsafe-swiftshader'] });

async function run(name, ctxOpt, qual) {
  const ctx = await b.newContext(ctxOpt), pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url); await pg.evaluate(q => { localStorage.clear(); if (q) localStorage.setItem('lars-settings', JSON.stringify({ quality: q })); }, qual); await pg.reload();
  await pg.click('#st-new');
  await pg.waitForFunction(() => window.LARS && window.LARS.loop, null, { timeout: 60000 });
  // сцена: день пика, много машин вокруг
  await pg.evaluate(() => { const w = LARS.w; const t1 = w.clock.parse('2022-09-26 12:00'); while (w.clock.t < t1) w.step(30); LARS.pending.length = 0; LARS.Modal.closeAll(); LARS.w.player.sleeping = false; });
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
  await pg.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window); window.__f = []; window.__i = []; let last = 0;
    window.requestAnimationFrame = cb => raf(t => { const a = performance.now(); if (last) window.__i.push(a - last); last = a; cb(t); window.__f.push(performance.now() - a); });
  });
  const out = [];
  for (const [label, z, speed, mode] of [['3D пешком ×1', 0, 1, 'walk'], ['3D в машине ×4', 0, 2, 'car'], ['3D ночь ×16', 0, 3, 'walk'], ['карта близко ×1', 5, 1, 'map'], ['карта далеко ×16', 0.05, 3, 'map']]) {
    await pg.evaluate(([z, speed, night, mode]) => {
      const G = LARS; G.setMode(mode === 'map' ? 'map' : '3d'); G.w.player.inCar = mode !== 'walk'; if (mode === 'walk') { const c = G.w.pcar, q = G.w.road.at(c.s, -4.6); G.w.player.x = q.x; G.w.player.y = q.y; G.fp.yaw += 0.3; }
      G.input.follow = true; G.view.cam.z = z || 3; G.setSpeed(speed); G.pending.length = 0; G.Modal.closeAll();
      if (night) { const w = G.w, t1 = Math.floor(w.clock.t / 86400) * 86400 + 22 * 3600; while (w.clock.t < t1) w.step(30); }
      window.__f.length = 0;
      window.__i.length = 0;
    }, [z, speed, label.includes('ночь'), mode]);
    await pg.waitForTimeout(SEC * 1000);
    const r = await pg.evaluate(() => { const a = window.__f.slice(1).sort((x, y) => x - y); const avg = a.length ? a.reduce((s, x) => s + x, 0) / a.length : 9999; const iv = window.__i.slice(2); const ia = iv.reduce((s, x) => s + x, 0) / Math.max(1, iv.length); return { ms: avg, p95: a[Math.floor(a.length * 0.95)] ?? a[a.length - 1] ?? 9999, q: LARS.q.level, n: a.length, cars: LARS.w.queue.cars.length, real: 1000 / ia, rs: LARS.view3 ? LARS.view3.rs.toFixed(2) : '-' }; });
    out.push({ label, ...r, fps: 1000 / Math.max(r.ms, 16.7) });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ctx.close();
  return { name, out, errs };
}

let bad = 0;
for (const [name, opt, q] of [['ноутбук 1366×768, авто', { viewport: { width: 1366, height: 768 } }, null], ['ноутбук, низкое', { viewport: { width: 1366, height: 768 } }, 'low'], ['Pixel 7, авто', devices['Pixel 7'], null]]) {
  const r = await run(name, opt, q);
  console.log(`\n${r.name}  CPU ×${THR}`);
  for (const o of r.out) {
    const okk = o.fps >= 30; if (!okk) bad++;
    console.log(`  ${okk ? 'ok  ' : 'SLOW'} ${o.label.padEnd(16)} кадр ${o.ms.toFixed(1)} мс (p95 ${o.p95.toFixed(1)})  ≈ ${o.fps.toFixed(0)} fps (реально ${(o.real || 0).toFixed(0)})  качество ${o.q} · разрешение ${o.rs}`);
  }
  if (r.errs.length) { bad++; console.log('  ошибки:', r.errs.join(' | ')); }
}
await b.close(); srv.close();
console.log(bad ? `\n${bad} проблем` : '\nвсё ≥ 30 fps');
process.exit(bad ? 1 : 0);
