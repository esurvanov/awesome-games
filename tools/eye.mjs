#!/usr/bin/env node
/* eye.mjs — player-eye stand: what the player actually sees and how things move.
 *
 *   node tools/eye.mjs <label> [--views a,b|none] [--motions a,b|none] [--no-feet] [--no-placed] [--size 1400x800] [--quality high] [--headful]
 *
 * Writes stand/<label>/eye/: <view>.png (with HUD, real over-the-shoulder camera), <view>.backfaces.png (mask),
 * motion/<take>.sheet.png + <take>.webp, feet/<spot>.png, eye.json (all numbers). Every invariant prints PASS/FAIL.
 * Invariants (tools/qa/qa-page.js): facing vs motion · foot sliding + stride ratio · pelvis continuity · feet on the
 * visible surface (GPU height map) · placed objects floating/buried · back faces on screen (ID pass) · v1 primitives
 * on screen · untextured / flat-colour areas · black / NaN frames · camera inside geometry.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';
import { animatedWebp, dataUrlBuffer } from './qa/webp.mjs';

const P = (ok) => (ok === null || ok === undefined ? 'n/a ' : ok ? 'PASS' : 'FAIL');
export const writeData = (file, url) => { if (url) fs.writeFileSync(file, dataUrlBuffer(url)); };

export async function injectViews(H) { await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-views.js'), 'utf8')); }

export async function runViews(H, dir, names, log) {
  fs.mkdirSync(dir, { recursive: true });
  const page = H.page, out = {};
  const list = names || await page.evaluate(() => QAV.viewOrder);
  for (const v of list) {
    const info = await page.evaluate((v) => { QAV.cleanup(); const r = QAV.views[v] ? QAV.views[v]() : { skip: 'unknown view' }; window.__after = r && r.after; return { note: r.note, feet: r.feet || [], skip: r.skip }; }, v);
    if (info.skip) { out[v] = { skip: info.skip }; log(`  view ${v}: skipped (${info.skip})`); continue; }
    await sleep(1700);
    await page.evaluate(() => { QA.closeDialogs(); DBG.G.pause = true; });
    await sleep(250);
    await page.screenshot({ path: path.join(dir, v + '.png') });
    const c = await page.evaluate(async (feet) => {
      const r = await QA.viewChecks({ magenta: true });
      r.feet = feet.length ? QA.feetOnSurface(QA.actors({ only: feet }).filter((a) => a.g.position.distanceTo(DBG.camera.position) < 60)) : [];
      r.player = { x: DBG.player.x, y: DBG.player.y, z: DBG.player.z, onGround: DBG.player.onGround };
      return r;
    }, info.feet);
    writeData(path.join(dir, v + '.backfaces.png'), c.backfaces.mask); delete c.backfaces.mask;
    await page.evaluate(() => { try { if (window.__after) window.__after(); } catch (e) { /* */ } QAV.cleanup(); });
    out[v] = Object.assign({ note: info.note }, c);
    const feetBad = c.feet.filter((f) => f.pass === false);
    log(`  view ${v.padEnd(14)} backfaces ${String(c.backfaces.px).padStart(5)} px ${P(c.backfaces.pass)} · primitives ${c.primitives.visible.length} ${P(!c.primitives.visible.length)} · untextured ${c.untextured.length} · pixels ${P(c.pixels.pass)} (luma ${c.pixels.mean}, zero ${c.pixels.zero}) · dark ${c.dark.frac} · camera ${P(c.camera.pass)} · feet ${feetBad.length ? 'FAIL ' + feetBad.map((f) => f.id + ' ' + f.worst).join(', ') : c.feet.length ? 'PASS' : 'n/a'}`);
  }
  return out;
}

export async function runFeet(H, dir, log) {
  fs.mkdirSync(dir, { recursive: true });
  const page = H.page, out = {};
  const spots = await page.evaluate(() => QAV.feetOrder);
  for (const s of spots) {
    const note = await page.evaluate((s) => { QAV.cleanup(); const n = QAV.feet[s](); return n; }, s);
    if (!note) { out[s] = { skip: 'no spot' }; log(`  feet ${s}: no spot`); continue; }
    await sleep(1500);
    await page.evaluate(() => { DBG.cam.dist = 2.6; DBG.cam.boom = 2.6; DBG.cam.pitch = 0.35; DBG.cam.yaw = DBG.player.face + 1.3; });
    await sleep(700);
    await page.evaluate(() => { DBG.G.pause = true; }); await sleep(200);
    await page.screenshot({ path: path.join(dir, s + '.png') });
    const r = await page.evaluate(() => { const r = QA.feetOnSurface(QA.actors({ only: ['player'] }), { size: 3, res: 300 })[0]; return Object.assign(r || {}, { onGround: DBG.player.onGround, surface: DBG.MODCTX.surfaceAt ? DBG.MODCTX.surfaceAt(DBG.player.x, DBG.player.z, DBG.player.y) : null, snow: DBG.MODCTX.snowDepthAt ? +DBG.MODCTX.snowDepthAt(DBG.player.x, DBG.player.z).toFixed(3) : null }); });
    await page.evaluate(() => QAV.cleanup());
    out[s] = Object.assign({ note }, r);
    log(`  feet ${s.padEnd(13)} ${P(r.pass)} worst ${r.worst} m (${(r.feet || []).map((f) => f.bone + ' ' + f.clearance).join(', ')}) · ${note} · loose snow ${r.snow} m`);
  }
  // animals idle where they are (stags grazing, fox sitting)
  const animals = await page.evaluate(async () => {
    QAV.cleanup(); const s0 = DBG.STAGS[0]; const res = [];
    for (const s of DBG.STAGS) { s.st = 'graze'; s.t = 30; }
    if (s0) { QA.place(s0.x + 28, s0.z + 12, { look: [s0.x, DBG.groundH(s0.x, s0.z), s0.z] }); await QA.wait(1500); DBG.G.pause = true; await QA.wait(150); res.push(...QA.feetOnSurface(QA.actors({ only: ['stag'] }).filter((a) => a.g.position.distanceTo(DBG.camera.position) < 80), { size: 7, res: 280 })); DBG.G.pause = false; }
    const f = DBG.fox; f.st = 'wild'; QA.place(f.x + 4, f.z + 3, { look: [f.x, DBG.groundH(f.x, f.z), f.z] }); await QA.wait(1500); DBG.G.pause = true; await QA.wait(150); res.push(...QA.feetOnSurface(QA.actors({ only: ['fox'] }), { size: 3, res: 300 })); DBG.G.pause = false;
    QAV.cleanup(); return res;
  });
  for (const a of animals) log(`  feet ${a.id.padEnd(13)} ${P(a.pass)} worst ${a.worst} m (${a.feet.map((f) => f.bone + ' ' + f.clearance).join(', ')}) · state ${a.state}`);
  out.animals = animals;
  return out;
}

export async function runMotions(H, dir, names, log, { webp = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const page = H.page, out = {};
  const list = names || await page.evaluate(() => QAV.motionOrder);
  for (const m of list) {
    const r = await page.evaluate((m) => QAV.take(m), m);
    if (r.skip) { out[m] = { skip: r.skip }; log(`  take ${m}: skipped (${r.skip})`); continue; }
    const sheet = await page.evaluate((t, title) => QAV.sheet(t, title), r.thumbs, `${m} · ${r.note || ''} · ${r.dur.toFixed(1)} s · ${r.frames} frames`);
    writeData(path.join(dir, m + '.sheet.png'), sheet);
    if (webp && r.thumbs.length > 1) { try { const bufs = r.thumbs.map((t) => dataUrlBuffer(t.url)); fs.writeFileSync(path.join(dir, m + '.webp'), animatedWebp(bufs, { width: 320, height: 183, durationMs: Math.round(r.dur / r.thumbs.length * 1000) })); } catch (e) { log('  webp failed', e.message); } }
    r.thumbCount = r.thumbs.length; delete r.thumbs;
    out[m] = r;
    const fac = r.facing.map((f) => `${f.id} ${P(f.pass)} bad ${f.badFrac} min ${f.minDot} run ${f.worstRunS}s`).join(' · ');
    const ft = r.feet.map((f) => `${f.id} ${P(f.pass)} drift ${f.medDrift}/${f.p90Drift} ratio ${f.medRatio}`).join(' · ');
    const cn = r.continuity.filter((c) => !c.pass).map((c) => `${c.id} pelvis ${c.maxLocalPelvisSpeed} m/s @${c.at.t}s root ${c.maxRootSpeed}`).join(' · ');
    log(`  take ${m.padEnd(13)} ${r.frames} fr · facing: ${fac || 'n/a'} · feet: ${ft || 'n/a'} · continuity ${cn ? 'FAIL ' + cn : 'PASS'} · black ${P(r.pixels.pass)} (${r.pixels.blackFrames}) · camera ${P(r.camera.pass)} (${r.camera.bad}/${r.camera.checked})`);
  }
  return out;
}

export async function runPlaced(H, log) {
  const r = await H.page.evaluate(() => QA.placedCheck());
  log(`  placed objects: ${r.checked} checked · floating > 10 cm: ${r.floating} ${P(!r.floating)} · buried > 30 %: ${r.buried} ${P(!r.buried)}`);
  for (const k of r.floatingByKind.slice(0, 8)) log(`    floating ${k.kind} ×${k.n} worst ${k.worst.float} m at ${k.worst.pos}`);
  for (const k of r.buriedByKind.slice(0, 8)) log(`    buried ${k.kind} ×${k.n} worst ${Math.round(k.worst.buried * 100)} % at ${k.worst.pos}`);
  return r;
}

/* ------------------------------------------------------------------ CLI */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
  const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'eye-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const log = (...a) => console.log('[eye]', ...a);
  const dir = path.join(OUT, label, 'eye');
  const H = await openGame({ label: 'eye ' + label, quality: opt('quality', 'high'), size: String(opt('size', '1400x800')).split('x').map(Number), headful: !!opt('headful'), log });
  const res = { label, date: new Date().toISOString(), gpu: H.gpu, load: H.load };
  try {
    await H.newGame(); await injectViews(H);
    const pick = (k) => { const v = opt(k); return v === 'none' ? [] : v ? String(v).split(',') : null; };
    const vs = pick('views'); if (!vs || vs.length) { log('eye views'); res.views = await runViews(H, dir, vs, log); }
    if (!opt('no-feet')) { log('feet on the visible surface'); res.feet = await runFeet(H, path.join(dir, 'feet'), log); }
    if (!opt('no-placed')) { log('placed objects'); res.placed = await runPlaced(H, log); }
    const ms = pick('motions'); if (!ms || ms.length) { log('motion takes'); res.motions = await runMotions(H, path.join(dir, 'motion'), ms, log); }
  } finally {
    res.errors = H.errors; res.failed = H.failed;
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'eye.json'), JSON.stringify(res, null, 1));
    await H.close();
  }
  log('wrote', path.join(dir, 'eye.json'), '· JS errors', res.errors.length);
}
