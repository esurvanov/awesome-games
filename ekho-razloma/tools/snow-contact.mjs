#!/usr/bin/env node
/* snow-contact.mjs — invariants of SNOW-CONTACT.md: boot print under the boot, one print per plant, landing / roll /
 * animal prints, measured on the running game (both the old stamp build and the object-pressed contact build).
 *
 *   node tools/snow-contact.mjs <label> [--tests walk,land,landwalk,roll,stag,fox] [--quality high] [--size 1400x800]
 *        [--dsf 2] [--repeat 1] [--eval "<js>"]
 *   → stand/<label>/snowcontact.json  (+ console summary)
 * Takes the benchmark lock (tools/qa/hygiene.mjs). --dsf sets the device scale factor (Retina = 2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';

const argv = process.argv.slice(2);
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'snowcontact';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const tests = String(opt('tests', 'stand,walk,land,landwalk,roll,stag,fox')).split(',');
const shots = argv.includes('--shots');
const size = String(opt('size', '1400x800')).split('x').map(Number);
const dsf = Number(opt('dsf', 1)), repeat = Number(opt('repeat', 1));
const log = (...a) => console.log('[snow-contact]', ...a);
const dir = path.join(OUT, label); fs.mkdirSync(dir, { recursive: true });

const H = await openGame({ label: 'snow-contact ' + label, quality: opt('quality', 'high'), size, log, page: opt('page') });
const out = { label, date: new Date().toISOString(), quality: opt('quality', 'high'), size, dsf, gpu: H.gpu, runs: [] };
try {
  if (dsf !== 1) { await H.page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: dsf }); await sleep(800); }
  await H.newGame();
  await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'snowcontact-page.js'), 'utf8'));
  await sleep(2500);
  out.canvas = await H.page.evaluate(() => { const c = DBG.renderer.domElement; return { w: c.width, h: c.height, pr: DBG.renderer.getPixelRatio(), dpr: devicePixelRatio }; });
  if (opt('eval')) log('eval', JSON.stringify(await H.page.evaluate(opt('eval'))).slice(0, 4000));
  if (shots) {
    const sd = path.join(dir, 'shots'); fs.mkdirSync(sd, { recursive: true });
    const snap = async (name) => { await sleep(900); await H.page.evaluate(() => { DBG.G.pause = true; }); await sleep(250); await H.page.screenshot({ path: path.join(sd, name + '.png') }); await H.page.evaluate(() => { DBG.G.pause = false; }); log('shot', name); };
    await H.page.evaluate(() => { const cv = DBG.renderer.domElement; for (const el of document.body.children) if (!el.contains(cv)) el.style.visibility = 'hidden'; });
    // 1 walk on open snow, stop, gameplay camera behind the pilot (the trail lies between camera and pilot)
    await H.page.evaluate(async () => { const s = SC.openSnow(0.08, 0); const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); QA.place(s.x, s.z, { yaw }); DBG.cam.yaw = yaw; await QA.wait(1500);
      QA.keys(['KeyW'], true); await QA.wait(3000); QA.keys(['KeyW'], false); await QA.wait(1500); SC.frame(4.2, 0.3, 0); });
    await snap('walk_play');
    await H.page.evaluate(() => SC.frame(3.2, 0.45, 2.6)); await snap('walk_front');
    await H.page.evaluate(() => { const P = DBG.player, f = P.face, fx = -Math.sin(f), fz = -Math.cos(f); SC.lookAt([P.x + fx * 1.2 + fz * 0.8, P.y + 1.35, P.z + fz * 1.2 - fx * 0.8], [P.x - fx * 0.6, P.y + 0.05, P.z - fz * 0.6], 50); });
    await snap('boots');
    await H.page.evaluate(() => { const P = DBG.player, f = P.face, fx = -Math.sin(f), fz = -Math.cos(f); SC.lookAt([P.x - fx * 0.9 + fz * 0.5, P.y + 1.0, P.z - fz * 0.9 - fx * 0.5], [P.x - fx * 2.2, P.y - 0.05, P.z - fz * 2.2], 50); });
    await snap('trail_low');
    // 2 landing (jump while walking)
    await H.page.evaluate(async () => { DBG.camOv = null; DBG.camera.fov = 62; DBG.camera.updateProjectionMatrix(); const s = SC.openSnow(0.08, 2); const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); QA.place(s.x, s.z, { yaw }); DBG.cam.yaw = yaw; await QA.wait(1500);
      QA.keys(['KeyW'], true); await QA.wait(900); DBG.pressed.add('Space'); await QA.wait(450); QA.keys(['KeyW'], false); await QA.wait(1600); SC.frame(3.6, 0.42, 2.4); });
    await snap('land_play');
    // 3 roll
    await H.page.evaluate(async () => { const s = SC.openSnow(0.08, 4); const yaw = Math.atan2(-Math.sin(s.dirA), -Math.cos(s.dirA)); QA.place(s.x, s.z, { yaw }); DBG.cam.yaw = yaw; await QA.wait(1500);
      QA.keys(['KeyW'], true); await QA.wait(600); DBG.pressed.add('KeyC'); await QA.wait(900); QA.keys(['KeyW'], false); await QA.wait(1200); SC.frame(3.8, 0.45, 2.5); });
    await snap('roll_play');
    await H.page.evaluate(() => { DBG.camOv = null; DBG.camera.fov = 62; DBG.camera.updateProjectionMatrix(); });
  }
  for (let r = 0; r < repeat; r++) {
    const run = {};
    for (const t of tests) {
      const fn = { stand: 'SC.standTest({skip:' + r + '})', walk: 'SC.walkTest({skip:' + r + '})', land: 'SC.landTest({skip:' + r + '})', landwalk: 'SC.landTest({walk:true, skip:' + r + '})', roll: 'SC.rollTest({skip:' + r + '})', stag: "SC.animalTest('stag',{skip:" + r + '})', fox: "SC.animalTest('fox',{skip:" + r + '})' }[t];
      if (!fn) continue;
      try { run[t] = await H.page.evaluate(fn); } catch (e) { run[t] = { error: String(e.message).slice(0, 300) }; }
      log(t, JSON.stringify(run[t]).slice(0, 1500));
    }
    out.runs.push(run);
  }
  out.errors = H.errors.slice(0, 20);
} finally {
  fs.writeFileSync(path.join(dir, 'snowcontact.json'), JSON.stringify(out, null, 1));
  log('→', path.join(dir, 'snowcontact.json'), 'errors', (out.errors || []).length);
  await H.close();
}
