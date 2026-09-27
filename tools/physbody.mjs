#!/usr/bin/env node
/* physbody.mjs — PHYSBODY.md invariants and physics tests on the running game, one browser, under the benchmark lock.
 *
 *   node tools/physbody.mjs <label> [--tests walk,ik,contact,stand,push,bump,fall,nan,cost] [--repeat 2] [--no-wasm]
 *        [--throttle 4] [--quality high] [--size 1400x800]
 *   → stand/<label>/physbody.json (+ console summary)
 *
 *   walk     tools/qa/snowcontact-page.js walkTest (print centre ↔ flat-foot sole = "foot slide on stop", target < 3 cm)
 *   ik       INTERACTION.testIK(25)  (slope standing, worst ankle/ball error, target < 1 cm)
 *   contact  INTERACTION.testContact() (hand on a boulder, < 3 cm)
 *   stand    snowcontact standTest (print under the standing boot)
 *   push     PHYSBODY.testPush()  upper body after a push: peak angle, return ≤ 0.6 s, overshoot (no oscillation)
 *   bump     PHYSBODY.testBump()  walk shoulder-first along a rock: deflection seen, no NaN
 *   fall     PHYSBODY.testFall()  ledge fall → ragdoll (Rapier) or fall clip (no WASM) → get-up; penetration, duration
 *   cost     PHYSBODY.cost()      ms per frame of springs / upper body / ragdoll (with --throttle N: CDP CPU throttling)
 * --no-wasm: WebAssembly compile is made to fail like the artifact CSP does (the game runs its 2D fallback).
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';

const argv = process.argv.slice(2);
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'physbody';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const tests = String(opt('tests', 'walk,ik,contact,stand')).split(',');
const repeat = Number(opt('repeat', 1)), throttle = Number(opt('throttle', 0)), noWasm = !!opt('no-wasm');
const size = String(opt('size', '1400x800')).split('x').map(Number);
const log = (...a) => console.log('[physbody]', ...a);
const dir = path.join(OUT, label); fs.mkdirSync(dir, { recursive: true });

// the artifact CSP without 'wasm-unsafe-eval' makes every WebAssembly compile throw a CompileError — emulate exactly that
const blockWasm = async (page) => page.evaluateOnNewDocument(() => {
  const err = () => new WebAssembly.CompileError("WebAssembly.instantiate(): Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive");
  for (const k of ['instantiate', 'compile', 'instantiateStreaming', 'compileStreaming']) WebAssembly[k] = () => Promise.reject(err());
  const M = function () { throw err(); }; WebAssembly.Module = M; WebAssembly.Instance = function () { throw err(); };
});

const H = await openGame({ label: 'physbody ' + label, quality: opt('quality', 'high'), size, log, beforeLoad: noWasm ? blockWasm : undefined });
const out = { label, date: new Date().toISOString(), noWasm, throttle, gpu: H.gpu, runs: [] };
try {
  await H.newGame();
  await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'snowcontact-page.js'), 'utf8'));
  await sleep(2500);
  out.phys = await H.page.evaluate(() => ({ ok: DBG.PH.ok, physbody: !!window.PHYSBODY, mode: window.PHYSBODY && PHYSBODY.mode && PHYSBODY.mode() }));
  log('physics', JSON.stringify(out.phys));
  if (opt('eval')) log('eval', JSON.stringify(await H.page.evaluate(String(opt('eval')))).slice(0, 4000));
  let cdp = null;
  for (let r = 0; r < repeat; r++) {
    const run = {};
    for (const t of tests) {
      const fn = { walk: `SC.walkTest({skip:${r}})`, stand: `SC.standTest({skip:${r}})`, ik: 'INTERACTION.testIK(25)', contact: 'INTERACTION.testContact()',
        push: 'PHYSBODY.testPush()', bump: `PHYSBODY.testBump({skip:${r * 3}})`, fall: 'PHYSBODY.testFall()', hit: 'PHYSBODY.testHit()', slope: 'INTERACTION.testWalk(25)', stop: `PHYSBODY.testStop({skip:${r}})`, cost: 'PHYSBODY.cost()' }[t];
      if (!fn) continue;
      if (t === 'cost' && throttle > 1) { cdp = cdp || await H.page.target().createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
      try { run[t] = await H.page.evaluate(fn); } catch (e) { run[t] = { error: String(e.message).slice(0, 300) }; }
      if (t === 'cost' && cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const s = run[t] || {};
      const brief = t === 'walk' ? { centreErrCm: s.centreErrCm, bootCentreErrCm: s.bootCentreErrCm, stanceAvgErrCm: s.stanceAvgErrCm, printUnderBoot: s.printUnderBoot, bootWithPrint: s.bootWithPrint, printsPerPlant: s.printsPerPlant, plants: s.plants }
        : t === 'ik' ? { maxErrOn: s.maxErrOn, maxErrOff: s.maxErrOff, pass: s.pass, error: s.error } : s;
      log(t, JSON.stringify(brief).slice(0, 1800));
    }
    out.runs.push(run);
  }
  out.errors = H.errors.slice(0, 30);
} finally {
  fs.writeFileSync(path.join(dir, 'physbody.json'), JSON.stringify(out, null, 1));
  log('→', path.join(dir, 'physbody.json'), 'errors', (out.errors || []).length, (out.errors || []).slice(0, 5).join(' | ').slice(0, 600));
  await H.close();
}
