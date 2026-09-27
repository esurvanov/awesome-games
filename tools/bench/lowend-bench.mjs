#!/usr/bin/env node
/* lowend-bench.mjs — measurements for the weak-laptop profile (LOWEND.md). One browser at a time, under the shared
 * benchmark lock (tools/qa/hygiene.mjs), closed at the end. Emulates the MacBook Air 2020 screen: 1280×800 CSS @2x.
 *
 *   node tools/bench/lowend-bench.mjs smoke                       boot with ?q=air: errors, preset, passes, one still
 *   node tools/bench/lowend-bench.mjs perf [--presets air,low,high] [--views forest,snow,camp] [--throttle 1,4] [--secs 6]
 *        fps median / 1 % low (real drawn-frame intervals), GPU+CPU ms per frame (stage profiler, gl.finish split),
 *        render scale, work per second (GPU ms × fps) — per preset × view × CPU throttle
 *   node tools/bench/lowend-bench.mjs settle [--secs 36] [--sim 1,8]   dynamic resolution in the deep forest, as-is and
 *        with the GPU time scaled ×N (LowEnd.simGpuX: the controller's decisions for an N× slower GPU)
 *   node tools/bench/lowend-bench.mjs shots [--subjects forest_mid,snow_open,boulder,tree_close] [--presets air,high]
 *        look-gate framings at 1280×800 @2x → stand/lowend-shots/<subject>.<preset>.png (+ 3× crops)
 *   node tools/bench/lowend-bench.mjs ab                           high: HEAD open-world.html vs working tree, 2 views
 *   node tools/bench/lowend-bench.mjs bench [--q air] [--throttle 4]   the real bench page (no #dbg), result card JSON
 * → stand/lowend-<mode>/result.json (+ images)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { acquireLock, quietCheck } from '../qa/hygiene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const argv = process.argv.slice(2), mode = argv[0] || 'smoke';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const list = (k, d) => String(opt(k, d)).split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[lowend]', ...a);
const OUT = path.join(ROOT, 'stand', 'lowend-' + mode); fs.mkdirSync(OUT, { recursive: true });
const [VW, VH, DPR] = [1280, 800, 2];

function serve(over = {}) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (over[u] != null) { res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }); res.end(over[u]); return; }
    const p = path.join(ROOT, u === '/' ? '/open-world.html' : u), ext = path.extname(p).toLowerCase();
    if (!p.startsWith(ROOT) || /[\\/](\.env|server)([\\/]|$)/.test(p.slice(ROOT.length)) || !MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, { 'Content-Security-Policy': CSP }).end('not served'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }); fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
let browser = null, srv = null, release = () => {};
async function open(query, { hash = '#dbg', over, wait = true } = {}) {
  if (!srv) srv = await serve(over);
  if (!browser) browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 900000, defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR },
    userDataDir: path.join(ROOT, 'tools', '.chrome-profile'),
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { const s = m.text(); if (m.type() === 'error' && !/^Failed to load resource/.test(s)) errors.push(s); if (/\[quality\]|\[lowend\]|\[bench\]/.test(s)) log('page:', s.slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const url = `http://127.0.0.1:${srv.address().port}/open-world.html${query}${hash}`; log('open', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (wait) await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 150000, polling: 250 });
  const cdp = await page.target().createCDPSession();
  return { page, errors, cdp, throttle: (r) => cdp.send('Emulation.setCPUThrottlingRate', { rate: r }) };
}
async function newGame(page) {
  for (const f of ['tools/qa/qa-page.js', 'tools/qa/qa-views.js']) await page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await page.evaluate(() => DBG.newGame()); await sleep(1200);
  await page.evaluate(() => { QA.closeDialogs(); DBG.G.pause = false; document.getElementById('pause').hidden = true; DBG.player.hp = DBG.player.hpMax = 99; });
  await sleep(300); await page.evaluate(() => QA.closeDialogs());
  // drawn-frame intervals (the game's own loop: with the 30 fps cap this is the real presented rate)
  await page.evaluate(() => { if (!window.LowEnd) return; const f = LowEnd.frame; window.__ft = []; LowEnd.frame = function (now, info) { if (info.playing) window.__ft.push(info.dt * 1000); return f.apply(this, arguments); }; });
}
const place = {
  forest: () => QAV.views.forest(),
  camp: () => { const f = DBG.WORLD.stationW(3, 11); QA.place(f.x + 4, f.z + 3, { look: [f.x, DBG.groundH(f.x, f.z) + 0.6, f.z], pitch: 0.2, dist: 6 }); return { note: 'station fire, 5 m' }; },
  snow: () => { const c = DBG.POI.crash; QA.place(c.x - 10, c.z + 25, { yaw: 0, pitch: 0.85, dist: 3.2 }); return { note: 'snow close-up' }; },
};
async function measure(page, secs) {
  await page.evaluate(() => { window.__ft.length = 0; });
  await sleep(secs * 1000);
  const r = await page.evaluate(() => {
    const a = window.__ft.slice().sort((x, y) => x - y), q = (p) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
    return { n: a.length, fps: +(1000 / q(0.5)).toFixed(1), low1: +(1000 / q(0.99)).toFixed(1), late40: +(a.filter((x) => x > 40).length / Math.max(1, a.length) * 100).toFixed(1), rs: DBG.RS.s, q: DBG.Q.name };
  });
  // GPU work per frame: the stage profiler with gl.finish at each stage boundary (wall ≈ GPU time; perturbs fps, so separate)
  // + whole-frame busy time: gl.finish() before and after one frame (LOOP.probe) = CPU + GPU serialised; minus the
  // CPU part (measured in the same frames up to the last GL call) ≈ the GPU's own work per frame
  await page.evaluate(() => { DBG.LOOP.probe = []; }); await sleep(1500);
  const b = await page.evaluate(() => { const a = DBG.LOOP.probe; DBG.LOOP.probe = null; const md = (k) => { const v = a.map((x) => x[k]).sort((x, y) => x - y); return v[v.length >> 1]; }; return { busy: md('busy'), cpu: md('cpu'), n: a.length }; });
  const g = null;
  r.busyMs = +b.busy.toFixed(1); r.cpuMs = +b.cpu.toFixed(1); r.gpuMs = +Math.max(0, b.busy - b.cpu).toFixed(1); r.stages = g;
  r.workPerSec = Math.round(r.busyMs * r.fps); r.gpuPerSec = Math.round(r.gpuMs * r.fps);
  const ft = await page.evaluate(() => DBG.frameTimer.ok); r.timerQuery = ft;
  return r;
}
function done(res) { fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res, null, 1)); log('→', path.relative(ROOT, path.join(OUT, 'result.json'))); }

async function main() {
  release = await acquireLock('lowend ' + mode, { log });
  const load = quietCheck(); log('machine:', load.quiet ? 'quiet' : 'BUSY — ' + load.reasons.join('; '));
  const res = { mode, date: new Date().toISOString(), machine: load, size: [VW, VH, DPR] };
  try {
    if (mode === 'smoke') {
      const S = await open('?q=air');
      await newGame(S.page); await S.page.evaluate(place.forest); await sleep(5000);
      res.state = await S.page.evaluate(() => ({ q: DBG.Q.name, rs: DBG.RS.s, pr: DBG.renderer.getPixelRatio(), canvas: [DBG.renderer.domElement.width, DBG.renderer.domElement.height],
        passes: DBG.MODCTX.composer.passes.map((p) => (p.name || p.constructor.name) + (p.enabled ? '' : '(off)')), sceneRT: [DBG.post.sceneRT.width, DBG.post.sceneRT.height, DBG.post.sceneRT.samples],
        fsrOut: [DBG.RS.fsr.out.w, DBG.RS.fsr.out.h], lowend: LowEnd.stats(), loop: { drawn: DBG.LOOP.drawn, skipped: DBG.LOOP.skipped }, gpu: LowEnd.gpuName }));
      await S.page.screenshot({ path: path.join(OUT, 'air-forest.png') });
      // idle: pause → one frame, then the loop stops; resume on input
      res.idle = await S.page.evaluate(async () => { const L = DBG.LOOP; L.idleOK = true; DBG.setPause(true); await new Promise((r) => setTimeout(r, 500)); const d0 = L.drawn; await new Promise((r) => setTimeout(r, 2000));
        const paused = L.drawn - d0, running = L.running; document.getElementById('bResume').click(); await new Promise((r) => setTimeout(r, 1000)); const d1 = L.drawn; await new Promise((r) => setTimeout(r, 1000));
        return { drawnWhilePaused2s: paused, loopRunningWhilePaused: running, drawnAfterResume1s: L.drawn - d1 }; });
      log('idle', JSON.stringify(res.idle));
      res.errors = S.errors; log(JSON.stringify(res.state)); log('errors', S.errors.length, S.errors.slice(0, 5));
    }
    if (mode === 'perf') {
      const S = await open('?q=air'); await newGame(S.page);
      const secs = +opt('secs', 6), rows = [];
      for (const q of list('presets', 'air,low,high')) {
        await S.page.evaluate((q) => { DBG.setQuality(q); if (q === 'air') DBG.setRenderScale(0.55); }, q);
        for (const v of list('views', 'forest,snow,camp')) {
          await S.page.evaluate(`(${place[v].toString()})()`);
          for (const th of list('throttle', '1,4').map(Number)) {
            await S.throttle(th); await sleep(3500);
            const r = await measure(S.page, secs); await S.throttle(1);
            Object.assign(r, { preset: q, view: v, throttle: th }); rows.push(r);
            log(`${q.padEnd(5)} ${v.padEnd(6)} cpu×${th}  ${r.fps} fps · 1% ${r.low1} · >40ms ${r.late40}% · busy ${r.busyMs} ms (GPU≈${r.gpuMs} CPU ${r.cpuMs}) · rs ${r.rs} · work ${r.workPerSec} ms/s · GPU ${r.gpuPerSec} ms/s`);
          }
        }
      }
      res.rows = rows; res.errors = S.errors;
    }
    if (mode === 'variants') {
      // interleaved A/B/C… in one view (rounds), so drift of the machine / other agents' files hits every variant alike
      const S = await open('?q=air'); await newGame(S.page);
      const v = opt('view', 'forest'); await S.page.evaluate(`(${place[v].toString()})()`); await sleep(3000);
      const VAR = {
        'air rs.50 FSR→2x': { q: 'air', pr: 2, rs: 0.5, fsr: true },
        'air rs.50 bilinear→2x': { q: 'air', pr: 2, rs: 0.5, fsr: false },
        'air rs.75 FSR→1x': { q: 'air', pr: 1, rs: 0.75, fsr: true },
        'air 1x no FSR': { q: 'air', pr: 1, rs: 1, fsr: false },
        low: { q: 'low' }, high: { q: 'high' },
      };
      if (opt('uncapped')) { for (const k of Object.keys(VAR)) if (VAR[k].q === 'air') VAR[k].uncap = true; }
      const rows = {};
      for (let round = 0; round < +opt('rounds', 3); round++) for (const [name, V] of Object.entries(VAR)) {
        await S.page.evaluate((V) => {
          DBG.QUALITY.air.pixelRatio = V.pr || 2; DBG.setQuality(V.q === 'air' ? 'low' : 'air'); DBG.setQuality(V.q);
          if (V.q === 'air') { DBG.setRenderScale(V.rs); DBG.RS.s = V.rs; window.dispatchEvent(new Event('resize')); DBG.RS.fsr.setEnabled(V.fsr); LowEnd.warm(600); if (V.uncap) DBG.Q.fpsCap = 0; }
        }, V);
        await sleep(2500);
        const r = await measure(S.page, 3); (rows[name] = rows[name] || []).push(r);
        log(`${name.padEnd(24)} r${round} ${r.fps} fps · GPU≈${r.gpuMs} · CPU ${r.cpuMs} · rs ${r.rs}`);
      }
      await S.page.evaluate(() => { DBG.QUALITY.air.pixelRatio = 2; });
      const md = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      res.summary = Object.fromEntries(Object.entries(rows).map(([k, a]) => [k, { fps: md(a.map((x) => x.fps)), gpuMs: md(a.map((x) => x.gpuMs)), cpuMs: md(a.map((x) => x.cpuMs)), busyMs: md(a.map((x) => x.busyMs)) }]));
      res.rows = rows; res.view = v; res.errors = S.errors; log(JSON.stringify(res.summary, null, 1));
    }
    if (mode === 'settle') {
      // dynamic resolution on a fill-limited GPU: a test-only pass (inserted from here, not part of the game) burns N
      // iterations per scene pixel, so its cost scales with rs² like the real fill cost. Trace rs every 2 s.
      const S = await open('?q=air'); await newGame(S.page);
      await S.page.evaluate(`(${place.forest.toString()})()`); await sleep(2000);
      await S.page.evaluate(() => {
        const T = DBG.THREE, m = new T.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uN: { value: 0 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
          fragmentShader: 'uniform sampler2D tDiffuse; uniform float uN; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); float a = 0.; for (int i = 0; i < 4096; i++) { if (float(i) >= uN) break; a += sin(a * 1.37 + vUv.x * float(i)) * cos(vUv.y + a); } gl_FragColor = c + vec4(a * 1e-12); }' });
        const P = new T.ShaderPass(m); P.name = 'burn'; const comp = DBG.MODCTX.composer; comp.insertPass(P, 1); window.__burn = m.uniforms.uN;
      });
      res.runs = [];
      for (const n of list('burn', '0,1200').map(Number)) for (const th of list('throttle', '1').map(Number)) {
        await S.throttle(th);
        await S.page.evaluate((n) => { window.__burn.value = n; DBG.setRenderScale(0.75); LowEnd.warm(2); }, n);
        const trace = [];
        for (let t = 0; t < +opt('secs', 60); t += 2) { await sleep(2000); trace.push(await S.page.evaluate(() => ({ rs: DBG.RS.s, st: LowEnd.stats().state, h: LowEnd.stats().history.slice(-1)[0] || null }))); }
        await S.throttle(1);
        const rsT = trace.map((x) => x.rs), changes = rsT.filter((x, i) => i && x !== rsT[i - 1]).length;
        const tail = trace.slice(-10).map((x) => x.h).filter(Boolean);
        res.runs.push({ burn: n, throttle: th, final: rsT[rsT.length - 1], changes, tailFps: tail.map((h) => h.fps), tailMiss: tail.map((h) => h.miss), trace });
        log(`burn ${n} cpu×${th}: rs ${rsT.map((x) => x.toFixed(2)).join(' ')} · ${changes} changes · last fps ${tail.map((h) => h.fps).join(' ')}`);
      }
      await S.page.evaluate(() => { window.__burn.value = 0; });
      res.errors = S.errors;
    }
    if (mode === 'shots') {
      const subs = list('subjects', 'forest_mid,snow_open,boulder,tree_close');
      const S = await open('?q=air'); await newGame(S.page);
      for (const f of ['tools/look/lg-page.js', 'tools/look/lg-snow.js']) await S.page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      await S.page.evaluate(() => LG.hud(false));
      res.shots = {};
      // --variants 'name:k=v;k=v|name2:…' — air variants (QUALITY.air knobs, sharp = RCAS stops) shot next to each other
      const vars = opt('variants') ? String(opt('variants')).split('|').map((x) => { const [n, kv] = x.split(':'); return { n, kv: Object.fromEntries((kv || '').split(';').filter(Boolean).map((e) => { const [k, v] = e.split('='); return [k, +v]; })) }; }) : null;
      const runs = vars ? vars.map((v) => ({ q: 'air', tag: v.n, kv: v.kv })) : list('presets', 'air,high').map((q) => ({ q, tag: q, kv: {} }));
      for (const { q, tag, kv } of runs) {
        await S.page.evaluate((q, kv) => { const base = window.__airBase || (window.__airBase = Object.assign({}, DBG.QUALITY.air)); Object.assign(DBG.QUALITY.air, base);
          for (const k in kv) if (k !== 'sharp') DBG.QUALITY.air[k] = kv[k]; DBG.setQuality(q === 'air' ? 'low' : 'air'); DBG.setQuality(q); DBG.RS.fsr.out.sharp = kv.sharp !== undefined ? kv.sharp : 0.25; }, q, kv);
        for (const s of subs) {
          const r = await S.page.evaluate(async (n) => { LG.cleanup(); await QA.wait(150); const r = await LG.shots[n](); if (r && !r.skip) LG.cam(r.pos, r.look, r.fov); return r ? { note: r.note, skip: r.skip } : { skip: 'none' }; }, s);
          if (r.skip) { log(s, 'skip', r.skip); continue; }
          if (q === 'air') await S.page.evaluate((x) => { DBG.setRenderScale(x); LowEnd.warm(60); }, +opt('rs', 0.5));   // the Air's scale, controller frozen
          await sleep(2600);
          await S.page.evaluate(() => { QA.closeDialogs(); DBG.G.pause = true; }); await sleep(400);
          const file = path.join(OUT, `${s}.${tag}.png`); await S.page.screenshot({ path: file });
          await S.page.evaluate(() => { DBG.G.pause = false; });
          res.shots[s + '.' + tag] = { rs: await S.page.evaluate(() => DBG.RS.s), note: r.note }; log(s, q, 'ok');
        }
      }
      res.errors = S.errors;
    }
    if (mode === 'ab') {
      const head = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:open-world.html'], { encoding: 'utf8', maxBuffer: 64 << 20 });
      res.shots = {};
      for (const side of ['before', 'after']) {
        if (srv) { srv.close(); srv = null; }
        srv = await serve(side === 'before' ? { '/open-world.html': head } : {});
        const S = await open('?q=high'); await newGame(S.page);
        await S.page.evaluate(() => { Math.random = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); });
        for (const v of ['forest', 'camp']) {
          await S.page.evaluate(`(${place[v].toString()})()`); await sleep(3000);
          await S.page.evaluate(() => { DBG.G.pause = true; }); await sleep(500);
          const file = path.join(OUT, `${v}.${side}.png`); await S.page.screenshot({ path: file });
          await S.page.evaluate(() => { DBG.G.pause = false; });
          res.shots[`${v}.${side}`] = await S.page.evaluate(() => ({ q: DBG.Q.name, pr: DBG.renderer.getPixelRatio(), passes: DBG.MODCTX.composer.passes.filter((p) => p.enabled).length }));
        }
        res[side + 'Errors'] = S.errors;
        await S.page.close();
      }
    }
    if (mode === 'bench') {
      const q = opt('q', 'air'), th = +opt('throttle', 1);
      const S = await open('?bench=1' + (q && q !== 'auto' ? '&q=' + q : ''), { hash: '', wait: false });
      if (th > 1) await S.throttle(th);
      await S.page.waitForFunction(() => window.BENCH && window.BENCH.result, { timeout: 420000, polling: 1000 });
      res.result = await S.page.evaluate(() => window.BENCH.result); res.throttle = th; res.errors = S.errors;
      await S.page.screenshot({ path: path.join(OUT, `card-${q}-x${th}.png`) });
      log(JSON.stringify({ fps: res.result.fps, low1: res.result.low1, rs: res.result.rs, menu: res.result.menu, verdict: res.result.verdict, phases: res.result.phases.map((p) => p.name + ' ' + p.fps) }));
    }
  } finally {
    done(res);
    try { if (browser) await browser.close(); } catch (e) { /* closed */ }
    try { if (srv) srv.close(); } catch (e) { /* */ }
    release();
  }
}
main().catch((e) => { console.error(e); try { if (browser) browser.close(); } catch (x) { /* */ } release(); process.exit(1); });
