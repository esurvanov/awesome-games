// Скриншоты рендера: node tests/render-shot.mjs [--quick]
// Поднимает статический node-сервер на :8130, снимает tests/render-harness.html во всех поворотах × зумах × режимах стен,
// плюс ночь/вечер/призраки/этаж; проверяет пикинг и консоль. Выход: tests/shots/render-*.png, render-report.json.
import { chromium } from 'playwright';
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8130, quick = process.argv.includes('--quick');
mkdirSync(path.join(ROOT, 'tests/shots'), { recursive: true });

const report = { shots: [], errors: [], pick: null, perf: null };
let fail = 0;
// Статический сервер на node (у python http.server очередь 5 — рвёт соединения при пачке ES-модулей)
function serve(root, port) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
  const s = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  return new Promise(r => s.listen(port, '127.0.0.1', () => r(s)));
}
const srv = await serve(ROOT, PORT);
try {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // CDN через node (браузер в песочнице может не видеть сеть) + дисковый кэш + 3 попытки
  const CACHE = path.join(os.tmpdir(), 'zhitie-cdn'); mkdirSync(CACHE, { recursive: true });
  const openPage = async (errs) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('https://cdn.jsdelivr.net/**', async (route) => {
      const url = route.request().url(), f = path.join(CACHE, url.replace(/[^a-z0-9.]+/gi, '_'));
      for (let i = 0; i < 3; i++) {
        try {
          if (!existsSync(f)) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(r.status); writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
          return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } });
        } catch (e) { if (i === 2) return route.abort(); }
      }
    });
    page.on('pageerror', e => errs.push('pageerror: ' + e));
    page.on('response', r => { if (r.status() >= 400 && !/\/data\/text\//.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on('console', m => {
      const t = m.text();
      if (process.env.DEBUG) console.log('[console]', m.type(), t);
      if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 404/.test(t)) errs.push(t);
    });
    return page;
  };
  const page = await openPage(report.errors);
  await page.goto(`http://127.0.0.1:${PORT}/tests/render-harness.html?still=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

  const shot = async (name, view, extra) => {
    await page.evaluate(([v, e]) => { window.setView(v); if (e) eval(e); }, [view, extra || null]);
    await page.waitForTimeout(quick ? 250 : 400);
    const file = path.join(ROOT, `tests/shots/render-${name}.png`);
    await page.screenshot({ path: file, timeout: 120000 });
    report.shots.push(name); console.log('📸', name);
  };
  const rots = quick ? [0, 1] : [0, 1, 2, 3], zooms = quick ? [1] : [0, 1, 2], walls = ['up', 'cutaway', 'down'];
  for (const rot of rots) for (const zoom of zooms) for (const wall of walls) await shot(`r${rot}-z${zoom}-${wall}`, { rot, zoom, wall, hour: 14 });
  await shot('evening', { rot: 0, zoom: 1, wall: 'cutaway', hour: 19.5 });
  await shot('night', { rot: 0, zoom: 1, wall: 'cutaway', hour: 23 });
  await shot('night-far', { rot: 1, zoom: 0, wall: 'up', hour: 1 });
  await shot('close-live', { rot: 0, zoom: 2, wall: 'cutaway', hour: 10 }, "R.focus(15, 19, true); R.snap()");
  await shot('ghosts', { rot: 0, zoom: 1, wall: 'cutaway', hour: 12 },
    "R.focus(18, 18, true); R.setGhost({defId:'armchair',x:11,y:19,rot:1,level:0,ok:true}); R.setWallGhost({x0:22,y0:13,x1:26,y1:17,level:0,ok:false,room:true}); R.setFloorGhost({x0:22,y0:19,x1:25,y1:21,level:0,ok:true,floorId:2}); R.snap()");
  await shot('level1', { rot: 0, zoom: 1, wall: 'cutaway', hour: 12, level: 1 }, "R.setGhost(null); R.setWallGhost(null); R.setFloorGhost(null)");

  // — Волна 2: этажи/крыша/огонь/НПС — отдельные загрузки стенда со сценой —
  const scenePage = async (name, qs, view, extra) => {
    let sp;
    for (let a = 0; a < 2; a++) { // 2 попытки: headless иногда не успевает (CDN/CPU)
      sp = await openPage(report.errors);
      await sp.goto(`http://127.0.0.1:${PORT}/tests/render-harness.html?still=1&${qs}`, { waitUntil: 'commit' });
      const ok = await sp.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }).then(() => true, () => false);
      if (ok) break; await sp.close(); if (a) throw new Error('scene timeout ' + name);
    }
    await sp.waitForTimeout(2500);
    await sp.evaluate(([v, e]) => { window.setView(v); if (e) eval(e); }, [view, extra || null]);
    await sp.waitForTimeout(600);
    await sp.screenshot({ path: path.join(ROOT, `tests/shots/render-${name}.png`), timeout: 120000 });
    report.shots.push(name); console.log('📸', name);
    await sp.close();
  };
  if (!quick) {
    await scenePage('w2-roof-gable', 'scene=storey', { rot: 0, zoom: 1, wall: 'up', hour: 12 }, 'R.focus(14,17,true);R.snap()');
    await scenePage('w2-roof-hip', 'scene=storey&roof=hip', { rot: 1, zoom: 1, wall: 'up', hour: 12 }, 'R.focus(14,17,true);R.snap()');
    await scenePage('w2-roof-flat', 'scene=storey&roof=flat', { rot: 2, zoom: 1, wall: 'up', hour: 12 }, 'R.focus(14,17,true);R.snap()');
    await scenePage('w2-level1', 'scene=storey', { rot: 0, zoom: 1, wall: 'cutaway', hour: 12, level: 1 }, 'R.focus(14,16,true);R.snap()');
    await scenePage('w2-stairs', 'scene=storey', { rot: 3, zoom: 2, wall: 'cutaway', hour: 12, level: 1 }, 'R.focus(8,15,true);R.snap()');
    await scenePage('w2-fire-night', 'scene=fire', { rot: 0, zoom: 2, wall: 'cutaway', hour: 22 }, 'R.focus(17,19,true);R.snap()');
    await scenePage('w2-npc', 'scene=npc,fire', { rot: 0, zoom: 1, wall: 'cutaway', hour: 21 }, 'R.focus(16,21,true);R.snap()');
    // — Волна 3 —
    await scenePage('w3-hood', 'scene=hood', { rot: 0, zoom: 0, wall: 'up', hour: 12 }, 'R.showHood(state);R.snap()');
    await scenePage('w3-hood-night', 'scene=hood', { rot: 1, zoom: 1, wall: 'up', hour: 22 }, 'R.showHood(state);R.zoom(1);R.snap()');
    await scenePage('w3-park', 'scene=park', { rot: 0, zoom: 0, wall: 'cutaway', hour: 12 }, 'R.focus(15,15,true);R.snap()');
    await scenePage('w3-park-night', 'scene=park', { rot: 0, zoom: 0, wall: 'cutaway', hour: 22 }, 'R.focus(15,15,true);R.snap()');
    await scenePage('w3-cafe', 'scene=cafe', { rot: 0, zoom: 1, wall: 'cutaway', hour: 18 }, 'R.focus(15,13,true);R.snap()');
    await scenePage('w3-rich', 'scene=rich', { rot: 0, zoom: 0, wall: 'cutaway', hour: 16 }, 'R.focus(16,17,true);R.snap()');
    await scenePage('w3-cas', 'scene=cas', { rot: 0, zoom: 1, wall: 'cutaway', hour: 12 }, 'void 0');
    await scenePage('w3-variants', 'scene=variants', { rot: 0, zoom: 0, wall: 'cutaway', hour: 12 }, 'R.rig.setView({bounds:[-3,-3,63,66],zooms:[70,32,20]});R.zoom(1);R.focus(20,14,true);R.snap()');
  }

  // пикинг: центр жителя, предмет, стена, пол
  report.pick = await page.evaluate(() => {
    window.setView({ rot: 0, zoom: 1, wall: 'cutaway', hour: 12 }); R.focus(15.5, 17.5, true); R.snap(); R.frame(0.016);
    const out = {};
    const simA = state.sims[0], p = R.simScreenPos(simA.id, -0.9);
    out.sim = R.pick(p.x, p.y);
    const fr = state.objects.find(o => o.def === 'dresser'); const q = R.screenPos(fr.x + 0.5, 0.6, fr.y + 0.4);
    out.object = R.pick(q.x, q.y); out.objectWant = fr.id;
    const w = R.screenPos(9.0, 2.5, 14.5); out.wall = R.pick(w.x, w.y); // западная стена спальни (задняя → поднята)
    const g = R.screenPos(25.5, 0, 25.5); out.tile = R.pick(g.x, g.y);
    return out;
  });
  const P = report.pick;
  const ok = { sim: P.sim.kind === 'sim', object: P.object.kind === 'object' && P.object.id === P.objectWant, wall: P.wall.kind === 'wall', tile: P.tile.kind === 'tile' && P.tile.x === 25 && P.tile.y === 25 };
  console.log('🎯 pick', ok);
  for (const [k, v] of Object.entries(ok)) if (!v) { fail++; report.errors.push('pick ' + k + ' → ' + JSON.stringify(P[k])); }

  // производительность: 120 кадров «живого» режима (swiftshader — только ориентир)
  report.perf = await page.evaluate(async () => {
    window.setView({ rot: 0, zoom: 1, wall: 'cutaway', hour: 14 });
    const t0 = performance.now(); for (let i = 0; i < 60; i++) R.frame(1 / 60); const ms = (performance.now() - t0) / 60;
    return { msPerFrameSoftware: +ms.toFixed(2), calls: R.renderer.info.render.calls, tris: R.renderer.info.render.triangles, objects: state.objects.length, sims: state.sims.length };
  });
  console.log('⏱', report.perf);

  // 🎮 настоящая игра: index.html + js/main.js, 4 поворота × 3 режима стен
  await page.close();
  report.game = { errors: [], shots: [] };
  const gp = await openPage(report.game.errors);
  await gp.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'commit' });
  await gp.waitForFunction(() => window.zhitie?.render, null, { timeout: 120000 });
  await gp.waitForTimeout(10000);
  report.game.fps = await gp.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(+(n / 3).toFixed(1)); }; requestAnimationFrame(f); }));
  report.game.renderMs = await gp.evaluate(() => { const R = zhitie.render, t0 = performance.now(); for (let i = 0; i < 30; i++) R.frame(1 / 60); return +((performance.now() - t0) / 30).toFixed(2); });
  for (const [nm, lvl, wall] of [['roof-on-l0', 0, 'up'], ['roof-off-l0', 0, 'cutaway'], ['roof-on-l1', 1, 'up'], ['l1-cutaway', 1, 'cutaway']]) {
    await gp.evaluate(([lvl, wall]) => { const R = zhitie.render; while (R.rotation !== 0) R.rotate(1); R.setLevel(lvl); R.setWallMode(wall); R.focus(17, 17, true); R.snap(); }, [lvl, wall]);
    await gp.waitForTimeout(600);
    await gp.screenshot({ path: path.join(ROOT, `tests/shots/render-game-${nm}.png`), timeout: 120000 });
    report.game.shots.push(nm); console.log('🎮', nm);
  }
  await gp.evaluate(() => { const R = zhitie.render; R.setLevel(0); R.showHood?.(); R.snap(); });
  await gp.waitForTimeout(800);
  await gp.screenshot({ path: path.join(ROOT, `tests/shots/render-game-hood.png`), timeout: 120000 }); report.game.shots.push('hood'); console.log('🎮 hood');
  await gp.evaluate(() => { const R = zhitie.render; R.showLot?.(); R.snap(); });
  for (let rot = 0; rot < 4; rot++) for (const wall of ['up', 'cutaway', 'down']) {
    await gp.evaluate(([rot, wall]) => { const R = zhitie.render; while (R.rotation !== rot) R.rotate(1); R.setWallMode(wall); R.snap(); }, [rot, wall]);
    await gp.waitForTimeout(600);
    await gp.screenshot({ path: path.join(ROOT, `tests/shots/render-game-r${rot}-${wall}.png`), timeout: 120000 });
    report.game.shots.push(`r${rot}-${wall}`); console.log('🎮', rot, wall);
  }
  console.log('🎮 fps (swiftshader)', report.game.fps, 'render ms', report.game.renderMs, 'errors', report.game.errors.length);
  report.errors.push(...report.game.errors.map(e => 'game: ' + e));
  await browser.close();
} catch (e) { report.errors.push(String(e)); fail++; }
finally { srv.close(); }
writeFileSync(path.join(ROOT, 'tests/shots/render-report.json'), JSON.stringify(report, null, 1));
if (report.errors.length) { console.log('❌ errors:\n' + report.errors.join('\n')); process.exit(1); }
console.log('✅ ok', report.shots.length, 'shots');
