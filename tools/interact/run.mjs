#!/usr/bin/env node
/* tools/interact/run.mjs — one browser (benchmark lock held via harness.openGame), evaluate page scripts, save JSON.
 *   node tools/interact/run.mjs <label> [--page-js a.js,b.js] [--eval "<expr>"]... [--throttle 4] [--size 1512x860] [--dpr 2] [--no-new]
 * Every --eval is awaited in order; results → stand/interact-<label>/result.json (and printed, truncated).
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, ROOT, OUT, sleep } from '../qa/harness.mjs';
const argv = process.argv.slice(2), label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'probe';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const evals = []; argv.forEach((a, i) => { if (a === '--eval') evals.push(argv[i + 1]); });
const size = String(opt('size', '1400x800')).split('x').map(Number);
const dir = path.join(OUT, 'interact-' + label); fs.mkdirSync(dir, { recursive: true });
const init = opt('init', null);
const H = await openGame({ label: 'interact ' + label, quality: opt('quality', 'high'), size, dpr: Number(opt('dpr', 1)), query: opt('query', ''),
  beforeLoad: init ? (page) => page.evaluateOnNewDocument(init) : undefined });
const out = { label, gpu: H.gpu, loadMs: H.loadMs, results: [] };
try {
  if (!argv.includes('--no-new')) await H.newGame();
  for (const f of String(opt('page-js', 'tools/interact/page.js')).split(',').filter(Boolean)) await H.page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const thr = Number(opt('throttle', 0));
  if (thr > 1) { const cdp = await H.page.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); H.log('CPU throttle ×' + thr); }
  globalThis.__shot = async (name) => { await H.page.screenshot({ path: path.join(dir, name + '.png') }); return name; };
  await H.page.exposeFunction('__nodeShot', (name) => globalThis.__shot(name));
  // --test <regex>: IX.testKinds one kind per evaluate (keeps each call short), rows merged into one result
  const testRe = opt('test', null);
  if (testRe) {
    const keys = await H.page.evaluate((re) => [...IX.kinds(re).keys()].sort(), testRe); const rows = [];
    for (const k of keys) {
      const t0 = Date.now(); let r;
      try { r = await H.page.evaluate((kk, o) => IX.testKinds('^' + kk.replace(/[|]/g, '\\|') + '$', o), k, JSON.parse(opt('test-opts', '{}'))); } catch (e) { r = [{ kind: k, error: String(e.message).slice(0, 300) }]; }
      rows.push(...r); const x = r[0] || {}; console.log(`  ${k.padEnd(32)} ${x.engaged} worst ${x.worstCm} med ${x.medCm} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      fs.writeFileSync(path.join(dir, 'kinds.json'), JSON.stringify(rows, null, 1));
    }
    out.kinds = rows;
  }
  for (const ex of evals) {
    const t0 = Date.now(); let r;
    try { r = await H.page.evaluate(ex); } catch (e) { r = { error: String(e.message).slice(0, 1500) }; }
    out.results.push({ ex: ex.slice(0, 200), ms: Date.now() - t0, r });
    console.log('>>', ex.slice(0, 100), `(${Date.now() - t0} ms)\n`, JSON.stringify(r).slice(0, Number(opt('print', 3000))));
  }
  out.errors = H.errors.slice(0, 20); out.failed = H.failed.slice(0, 20);
  console.log('errors', out.errors.slice(0, 6), 'failed', out.failed.slice(0, 4));
} finally { fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 1)); await H.close(); }
