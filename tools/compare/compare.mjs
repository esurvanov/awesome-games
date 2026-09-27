#!/usr/bin/env node
/* compare.mjs — BEFORE | AFTER from the player's point of view.
 *
 *   node tools/compare/compare.mjs <label> --before <commit> --after <commit|WORKTREE> [--sides before,after] [--shots a,b] [--keep-wt]
 *   node tools/compare/compare.mjs <label> --page          rebuild index.html from the saved <side>.json files
 *
 * Each commit is checked out as a detached git worktree under stand/compare-wt/<sha> (WORKTREE = the live repo) and served
 * with the artifact CSP (same rules as tools/qa/harness.mjs). Both builds run the SAME script (tools/compare/cmp-page.js)
 * with the normal third-person follow camera at 1512×860 @2x (the user's Retina MacBook): new game, intro dialog closed,
 * seeded Math.random, real key input. Per shot: fps median (no capture running), a still (3024×1720 WebP), a clip
 * (CDP screencast → animated WebP), and for the menu / Orm's fire a black-frame count over every rendered frame
 * (in-page readPixels right after the game's own frame) plus over the screencast frames (what reached the screen).
 * → stand/compare-<label>/ {before,after}.json · <shot>.<side>.webp · <shot>.<side>.clip.webp · index.html
 * Takes the benchmark lock (tools/.stand.lock) for the whole run.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import puppeteer from 'puppeteer-core';   // resolves to tools/node_modules (worktrees have none; the tool always runs from the main repo)
import { acquireLock, quietCheck } from '../qa/hygiene.mjs';
import { renderPage } from './cmp-report.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const OUTD = path.join(ROOT, 'stand', 'compare-' + label);
const WT = path.join(ROOT, 'stand', 'compare-wt');
const log = (...a) => console.log('[compare]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
const [VW, VH, DPR] = [1512, 860, 2];
fs.mkdirSync(OUTD, { recursive: true });

if (opt('page')) { renderPage(OUTD); log('→', path.join(OUTD, 'index.html')); process.exit(0); }

// shot order + which still is the headline one ('pre' = right after setup, 'post' = after the scripted action)
const SHOTS = [
  { name: 'snow_walk', still: 'post', clip: true },
  { name: 'boots', still: 'post', clip: true },
  { name: 'jump_roll', still: 'post', clip: true },
  { name: 'boulder_lean', still: 'post', clip: true },
  { name: 'rock_close', still: 'pre', clip: false },
  { name: 'tufts', still: 'pre', clip: true },
  { name: 'forest_edge', still: 'post', clip: true },
  { name: 'forest_mid', still: 'pre', clip: true },
  { name: 'station_fire', still: 'pre', clip: true, black: true },
  { name: 'stags', still: 'pre', clip: true },
  { name: 'camp_tents', still: 'pre', clip: false },
  { name: 'wreck_side', still: 'pre', clip: false },
  { name: 'hab_close', still: 'pre', clip: false },
  { name: 'station_props', still: 'pre', clip: false },
];

/* ------------------------------------------------------------------ worktrees + server */
function checkout(ref) {
  if (ref === 'WORKTREE') return { root: ROOT, sha: git('rev-parse', 'HEAD') + '+dirty', ref, wt: false };
  const sha = git('rev-parse', ref + '^{commit}'), dir = path.join(WT, sha.slice(0, 10));
  if (!fs.existsSync(path.join(dir, 'open-world.html'))) { fs.mkdirSync(WT, { recursive: true }); git('worktree', 'add', '--detach', dir, sha); log('worktree', dir); }
  return { root: dir, sha, ref, wt: true, subject: git('log', '-1', '--format=%s', sha), date: git('log', '-1', '--format=%ci', sha) };
}
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
function serve(root) {
  const srv = http.createServer((q, res) => {
    const u = decodeURIComponent(q.url.split('?')[0].split('#')[0]);
    const p = path.join(root, u === '/' ? '/open-world.html' : u);
    if (!p.startsWith(root) || /[\\/](\.env|server)([\\/]|$)/.test(p.slice(root.length))) { res.writeHead(403).end(); return; }
    const ext = path.extname(p).toLowerCase();
    if (!MIME[ext] || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404, { 'Content-Security-Policy': CSP }).end('not served'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ------------------------------------------------------------------ in-page instrumentation (before any game script) */
const PRE = `(() => {
  let s = 20260927 >>> 0;   // seeded Math.random: both builds draw the same sequence
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const raf = window.requestAnimationFrame.bind(window);
  const M = window.__CMPM = { mode: null, frames: [], dts: [], last: 0 };
  // after the game's own frame callback: the drawing buffer still holds the frame about to be shown
  window.requestAnimationFrame = (cb) => raf((t) => {
    const r = window.DBG && window.DBG.renderer, f0 = r ? r.info.render.frame : -1; cb(t);
    if (!M.mode || !r || r.info.render.frame === f0) return;
    if (M.last) M.dts.push(t - M.last); M.last = t;
    if (M.mode !== 'black') return;
    const gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!M.buf || M.buf.length !== w * 4) M.buf = new Uint8Array(w * 4);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let sum = 0, dark = 0, zero = 0, n = 0;
    for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) { gl.readPixels(0, Math.floor(h * fy), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, M.buf);
      for (let i = 0; i < M.buf.length; i += 16) { const l = 0.2126 * M.buf[i] + 0.7152 * M.buf[i + 1] + 0.0722 * M.buf[i + 2]; sum += l; n++; if (l < 12) dark++; if (!M.buf[i] && !M.buf[i + 1] && !M.buf[i + 2]) zero++; } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    M.frames.push([+(sum / n).toFixed(1), +(dark / n).toFixed(3), +(zero / n).toFixed(3)]);
  });
  M.start = (mode) => { M.mode = mode; M.frames = []; M.dts = []; M.last = 0; };
  M.stop = () => { const o = { frames: M.frames, dts: M.dts }; M.mode = null; return o; };
})();`;

const median = (a) => { const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
function blackStats(lumas) {   // lumas: [mean, dark, zero] per frame
  lumas = lumas.filter(Boolean);
  if (!lumas.length) return { frames: 0, black: 0 };
  const med = median(lumas.map((l) => l[0]));
  const isBlack = (l) => l[1] > 0.85 || l[0] < Math.max(3, med * 0.25) || l[2] > 0.3;
  const bl = lumas.map((l, i) => [i, l]).filter(([, l]) => isBlack(l));
  return { frames: lumas.length, black: bl.length, medianLuma: +med.toFixed(1), minLuma: Math.min(...lumas.map((l) => l[0])), first: bl.slice(0, 6).map(([i, l]) => ({ i, l })) };
}
function fpsOf(dts) { const m = median(dts); return m ? +(1000 / m).toFixed(1) : null; }

/* ------------------------------------------------------------------ screencast clip → animated WebP */
async function startCast(page) {
  const cdp = await page.createCDPSession(), frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ data: Buffer.from(f.data, 'base64'), t: f.metadata.timestamp }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1008, maxHeight: 574, everyNthFrame: 1 });
  return async () => { await cdp.send('Page.stopScreencast').catch(() => {}); await sleep(100); await cdp.detach().catch(() => {}); return frames; };
}
function writeClip(frames, out, maxFrames = 90) {
  if (frames.length < 2) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmpclip-'));
  const step = Math.max(1, Math.ceil(frames.length / maxFrames)), files = [];
  for (let i = 0; i < frames.length; i += step) { const f = path.join(tmp, `f${String(files.length).padStart(4, '0')}.jpg`); fs.writeFileSync(f, frames[i].data); files.push(f); }
  const dur = (frames[frames.length - 1].t - frames[0].t) * 1000, dMs = Math.max(20, Math.round(dur / files.length));
  try { execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '55', '-m', '4', '-d', String(dMs), ...files, '-o', out], { stdio: 'pipe' }); }
  catch (e) { log('img2webp failed', String(e.stderr || e).slice(0, 200)); return null; }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { frames: files.length, castFrames: frames.length, durS: +(dur / 1000).toFixed(2), castFps: +(frames.length / Math.max(0.01, dur / 1000)).toFixed(1) };
}
// luma of every screencast frame (what reached the screen), via ffmpeg → 48×27 grey
function castLumas(frames) {
  const out = [];
  for (const f of frames) {
    try { const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-vf', 'scale=48:27,format=gray', '-f', 'rawvideo', '-'], { input: f.data, maxBuffer: 1 << 20 });
      let s = 0, d = 0, z = 0; for (const v of raw) { s += v; if (v < 12) d++; if (v === 0) z++; } out.push([+(s / raw.length).toFixed(1), +(d / raw.length).toFixed(3), +(z / raw.length).toFixed(3)]); }
    catch (e) { out.push(null); }
  }
  return out;
}

function saveBlack(frames, lumas, name) {   // the darkest screen frame, if it counts as black
  const st = blackStats(lumas); if (!st.black) return null;
  let k = -1; lumas.forEach((l, i) => { if (l && (k < 0 || l[0] < lumas[k][0])) k = i; });
  fs.writeFileSync(path.join(OUTD, name), frames[k].data); return name;
}

/* ------------------------------------------------------------------ one build */
async function runSide(side, ref, onlyShots) {
  // the AFTER side stands exactly where the BEFORE side stood (spot pickers read vegetation etc. that differ per build)
  let prevB = null; try { prevB = side === 'after' ? JSON.parse(fs.readFileSync(path.join(OUTD, 'before.json'), 'utf8')) : null; } catch (e) { /* none */ }
  const fixOf = (n) => { const st = prevB && prevB.shots[n] && prevB.shots[n].setup; return st && st.x != null ? { x: st.x, z: st.z, yaw: st.yaw } : null; };
  const co = checkout(ref);
  const srv = await serve(co.root), port = srv.address().port;
  const load = quietCheck();
  const res = { side, ref, sha: co.sha, subject: co.subject || '', date: co.date || '', root: path.relative(ROOT, co.root) || '.', started: new Date().toISOString(),
    size: [VW, VH, DPR], machine: { quiet: load.quiet, reasons: load.reasons, cpuPct: load.cpuPct, load1: load.load1 }, shots: {}, errors: [] };
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', `--window-size=${VW},${VH}`, '--autoplay-policy=no-user-gesture-required'];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args, protocolTimeout: 900000, defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR } });
  const dir = OUTD;
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) res.errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => res.errors.push('pageerror: ' + (e && e.message)));
    await page.evaluateOnNewDocument(PRE);
    const url = `http://127.0.0.1:${port}/open-world.html#dbg`;
    log(side, ref, co.sha.slice(0, 8), url);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 180000, polling: 250 });
    res.loadMs = Date.now() - t0;
    res.gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    const lockQ = () => page.evaluate(() => { if (window.AI && AI.quality && AI.quality.set) AI.quality.set('high', 1e7); else if (DBG.setQuality) DBG.setQuality('high'); return DBG.Q && DBG.Q.name; });
    res.qualityAtLoad = await page.evaluate(() => DBG.Q && DBG.Q.name); res.quality = await lockQ();
    const still = (name) => page.screenshot({ path: path.join(dir, name), type: 'webp', quality: 82 });

    /* the menu: 10 s, every rendered frame + every screen frame checked for black */
    if (!onlyShots || onlyShots.includes('menu')) {
      await sleep(1500);
      await still(`menu.${side}.webp`);
      await page.evaluate(() => window.__CMPM.start('black'));
      const stop = await startCast(page); await sleep(10000); const frames = await stop();
      const m = await page.evaluate(() => window.__CMPM.stop());
      const sl = castLumas(frames);
      res.shots.menu = { rendered: blackStats(m.frames), screen: blackStats(sl), blackFrame: saveBlack(frames, sl, `menu.${side}.black.jpg`), fps: fpsOf(m.dts), clip: writeClip(frames, path.join(dir, `menu.${side}.clip.webp`), 60), mode: await page.evaluate(() => DBG.G.mode) };
      log(side, 'menu', JSON.stringify({ r: res.shots.menu.rendered.black + '/' + res.shots.menu.rendered.frames, s: res.shots.menu.screen.black + '/' + res.shots.menu.screen.frames }));
    }

    /* new game, intro dialog closed */
    await page.evaluate(() => { if (DBG.newGame) DBG.newGame(); else document.getElementById('bNew').click(); });
    await sleep(1500);
    await page.evaluate(() => { DBG.Dialog.active = false; document.getElementById('dialog').hidden = true; DBG.G.pause = false; const p = document.getElementById('pause'); if (p) p.hidden = true; });
    await page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'compare', 'cmp-page.js'), 'utf8'));
    await sleep(3000);
    await page.evaluate(() => CMP.closeDialogs());
    await lockQ(); res.info = await page.evaluate(() => CMP.info());
    log(side, 'info', JSON.stringify(res.info));

    for (const S of SHOTS) {
      if (onlyShots && !onlyShots.includes(S.name)) continue;
      const r = { still: S.still };
      try {
        r.setup = await page.evaluate((n, fix) => { const s = CMP.shots[n]; CMP.fix = fix; try { return s ? s.setup() : { skip: 'shot missing' }; } finally { CMP.fix = null; } }, S.name, fixOf(S.name));
        if (r.setup && r.setup.skip) { res.shots[S.name] = r; log(side, S.name, 'skip', r.setup.skip); continue; }
        await sleep(2200);   // streaming rings / snow patch settle around the new spot
        await page.evaluate(() => CMP.closeDialogs());
        await page.evaluate(() => window.__CMPM.start('fps')); await sleep(1500); r.fpsIdle = fpsOf((await page.evaluate(() => window.__CMPM.stop())).dts);
        await still(`${S.name}.${side}.pre.webp`);
        const hasRun = await page.evaluate((n) => !!CMP.shots[n].run, S.name);
        if (hasRun) {
          await page.evaluate((b) => window.__CMPM.start(b ? 'black' : 'fps'), !!S.black);
          const stop = S.clip ? await startCast(page) : null;
          r.run = await page.evaluate((n) => CMP.shots[n].run(), S.name);
          const frames = stop ? await stop() : [];
          const m = await page.evaluate(() => window.__CMPM.stop());
          r.fpsRun = fpsOf(m.dts);
          if (S.black) { const sl = castLumas(frames); r.rendered = blackStats(m.frames); r.screen = blackStats(sl); r.blackFrame = saveBlack(frames, sl, `${S.name}.${side}.black.jpg`); }
          if (frames.length) r.clip = writeClip(frames, path.join(dir, `${S.name}.${side}.clip.webp`));
        }
        const hasPost = await page.evaluate((n) => !!CMP.shots[n].post, S.name);
        if (hasPost) { r.post = await page.evaluate((n) => CMP.shots[n].post(), S.name); await sleep(1000); await still(`${S.name}.${side}.post.webp`); }
        else if (hasRun) { await still(`${S.name}.${side}.post.webp`); }
        r.headline = `${S.name}.${side}.${hasPost || S.still === 'post' ? S.still : 'pre'}.webp`;
        if (!fs.existsSync(path.join(dir, r.headline))) r.headline = `${S.name}.${side}.pre.webp`;
        await page.evaluate(() => CMP.release());
      } catch (e) { r.error = String(e && e.message || e).slice(0, 300); }
      res.shots[S.name] = r;
      log(side, S.name, JSON.stringify({ setup: r.setup, run: r.run, fps: [r.fpsIdle, r.fpsRun], black: r.rendered && [r.rendered.black, r.rendered.frames, r.screen.black, r.screen.frames], err: r.error }));
    }
  } finally {
    try { await browser.close(); } catch (e) { /* */ }
    srv.close();
  }
  res.finished = new Date().toISOString();
  return res;
}

/* ------------------------------------------------------------------ main */
const refs = { before: opt('before'), after: opt('after') };
const sides = String(opt('sides', 'before,after')).split(',');
const onlyShots = opt('shots') ? String(opt('shots')).split(',') : null;
for (const s of sides) if (!refs[s] || refs[s] === true) { console.error(`need --${s} <commit|WORKTREE>`); process.exit(2); }
const release = await acquireLock('compare ' + label, { log });
try {
  for (const side of sides) {
    const res = await runSide(side, refs[side], onlyShots);
    const f = path.join(OUTD, side + '.json');
    if (onlyShots && fs.existsSync(f)) { const old = JSON.parse(fs.readFileSync(f, 'utf8')); if (old.sha === res.sha) { res.shots = Object.assign(old.shots, res.shots); } }
    fs.writeFileSync(f, JSON.stringify(res, null, 1));
    log('→', f);
  }
} finally { release(); }
if (!opt('keep-wt')) for (const d of fs.existsSync(WT) ? fs.readdirSync(WT) : []) { try { git('worktree', 'remove', '--force', path.join(WT, d)); log('worktree removed', d); } catch (e) { log('worktree remove failed', d); } }
renderPage(OUTD);
log('→', path.join(OUTD, 'index.html'));
