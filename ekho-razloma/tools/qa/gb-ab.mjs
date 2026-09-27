#!/usr/bin/env node
/* gb-ab.mjs — GROUNDBLEND cost, measured as an interleaved in-page A/B (same page, same views, alternating on/off),
 * so a busy machine shifts both arms alike instead of deciding the result.
 *   node tools/qa/gb-ab.mjs [--quality high] [--size 1400x800] [--dpr 1] [--rounds 3] [--shots rock_close,hab_close,...]
 * Per shot and arm: median frame time over --ms (vsync off), rounds interleaved (on, off, on, off …) → stand/gb-ab-<q>-<w>x<h>@<dpr>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep } from './harness.mjs';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const q = opt('quality', 'high'), size = opt('size', '1400x800').split('x').map(Number), dpr = Number(opt('dpr', 1)), rounds = Number(opt('rounds', 3)), ms = Number(opt('ms', 1500));
const shots = opt('shots', 'rock_close,hab_close,heather_close,station_night,forest_mid,boulder').split(',');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const H = await openGame({ label: 'gb-ab', quality: q, size, dpr, unlimited: true });
const out = { quality: q, size, dpr, rounds, ms, gpu: H.gpu, shots: {} };
try {
  await H.newGame();
  for (const f of ['tools/qa/qa-views.js', 'tools/look/lg-page.js']) await H.page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await H.page.evaluate(() => LG.hud(false));
  await sleep(2000);
  const frameMs = (t) => H.page.evaluate((t) => new Promise((ok) => { const d = []; let last = performance.now(); const t0 = last;
    const f = (now) => { d.push(now - last); last = now; if (now - t0 < t) requestAnimationFrame(f); else { d.sort((a, b) => a - b); ok({ med: d[d.length >> 1], p90: d[Math.floor(d.length * 0.9)], n: d.length }); } }; requestAnimationFrame(f); }), t);
  for (const s of shots) {
    const r = await H.page.evaluate(async (n) => { LG.cleanup(); await QA.wait(150); const r = LG.shots[n] ? await LG.shots[n]() : { skip: 'unknown' }; if (r && !r.skip) LG.cam(r.pos, r.look, r.fov); return r && r.skip ? { skip: r.skip } : { ok: 1 }; }, s);
    if (r.skip) { console.log(s, 'skipped', r.skip); continue; }
    await sleep(2500);
    const arms = { on: [], off: [] };
    for (let k = 0; k < rounds; k++) for (const arm of ['on', 'off']) {
      await H.page.evaluate((on) => { window.GroundBlend.setOn(on); }, arm === 'on'); await sleep(1800);   // recompile + settle
      arms[arm].push(await frameMs(ms));
    }
    const med = (a) => { const v = a.map((x) => x.med).sort((x, y) => x - y); return +v[v.length >> 1].toFixed(2); };
    out.shots[s] = { onMs: med(arms.on), offMs: med(arms.off), deltaMs: +(med(arms.on) - med(arms.off)).toFixed(2), on: arms.on, off: arms.off };
    console.log(s.padEnd(14), 'on', out.shots[s].onMs, 'ms · off', out.shots[s].offMs, 'ms · Δ', out.shots[s].deltaMs, 'ms');
  }
  out.gb = await H.page.evaluate(() => ({ stats: GroundBlend.stats, verify: GroundBlend.verify() }));
  out.errors = H.errors;
} finally { await H.close(); }
const f = path.join(ROOT, 'stand', `gb-ab-${q}-${size.join('x')}@${dpr}.json`); fs.writeFileSync(f, JSON.stringify(out, null, 1)); console.log('→', f, 'errors', out.errors.length);
