#!/usr/bin/env node
/* tools/rockgallery/run.mjs — rock interaction gallery: every rock place × 4 sides × 5 scenarios, ~6 timed frames each,
 * plus automatic checks measured in the page (tools/rockgallery/page.js). Writes tools/rockgallery/out/<label>/:
 * frames (jpg), result.json, index.html (the review page: mark each card natural / not, notes, download marks).
 *
 *   node tools/rockgallery/run.mjs <label> [--spots boulder,gap] [--sides 0,1,2,3] [--scen walk,run,along,holdw,jump]
 *        [--size 960x600] [--init "<js before load>"]   (e.g. --init 'window.INTERACT_OFF=true' for an A/B)
 *        [--lab]   the ?rocklab test ground (modules/rock-lab.js): copies of every rock kind + gap + seat + slope on open
 *                  ground, fixed profile cameras set from the contact face, a close-up and a view from above per card
 * One browser, the shared benchmark lock (tools/qa/harness.mjs) — waits its turn behind other runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame, ROOT } from '../qa/harness.mjs';
import { writeReport } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const list = (k, d) => { const v = opt(k, null); return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d; };
const size = String(opt('size', '960x600')).split('x').map(Number);
const dir = path.join(HERE, 'out', label); fs.mkdirSync(dir, { recursive: true });
const init = opt('init', null);
const LAB = argv.includes('--lab');

let H = null;
const out = { label, at: new Date().toISOString(), gpu: null, loadMs: null, spots: [], cards: [], errors: [], restarts: [] };
const save = () => { fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(out, null, 1)); writeReport(dir, out); };
// one game page: load, new game, the page scripts, the frame hook, the HUD hidden. Called again after the tab crashes.
async function boot() {
  H = await openGame({ label: 'rockgallery ' + label, quality: opt('quality', 'high'), size, dpr: 1, query: LAB ? '?rocklab' : '',
    beforeLoad: init ? (page) => page.evaluateOnNewDocument(init) : undefined });
  out.gpu = H.gpu; out.loadMs = out.loadMs || H.loadMs;
  await H.newGame();
  for (const f of ['tools/interact/page.js', 'tools/rockgallery/page.js']) await H.page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await H.page.exposeFunction('__nodeShot', async (name) => { await H.page.screenshot({ path: path.join(dir, name + '.jpg'), type: 'jpeg', quality: 72 }); return name; });
  // hide the HUD for the frames (the gallery is about the pilot and the rock)
  if (LAB) {   // the test ground builds once the rock models are in (async loads)
    const lab = await H.page.evaluate(async () => { for (let i = 0; i < 240 && !(window.ROCKLAB && (ROCKLAB.ready || ROCKLAB.err)); i++) await RG.wait(250); return window.ROCKLAB ? { ready: ROCKLAB.ready, err: ROCKLAB.err, version: ROCKLAB.version, hash: ROCKLAB.hash, stats: ROCKLAB.stats } : null; });
    if (!lab || !lab.ready) throw new Error('rocklab not ready: ' + JSON.stringify(lab));
    await H.page.evaluate(() => RG.useLab());
    // a restarted page must rebuild the SAME frozen lab, else the cards after the restart are not comparable
    if (out.lab && out.lab.hash !== lab.hash) out.errors.push('lab changed after a restart: ' + out.lab.hash + ' → ' + lab.hash);
    if (!out.lab) out.lab = lab;
  }
  await H.page.evaluate(() => { const s = document.createElement('style'); s.textContent = '#hud,#toasts,#prompt,#compass,#mini,#touch,#hurt{visibility:hidden!important}'; document.head.appendChild(s); });
}
const dead = (e) => /Target closed|detached Frame|Session closed|crash|Execution context was destroyed|Protocol error/i.test(String(e && e.message || e));
try {
  await boot();
  out.brain = await H.page.evaluate(() => !!window.ROCKBRAIN);
  out.spots = await H.page.evaluate(() => RG.spots());
  out.selfTest = await H.page.evaluate(() => RG.selfTest());
  H.log('self-test: ' + JSON.stringify(out.selfTest));
  const want = list('spots', null), sides = list('sides', ['0', '1', '2', '3']).map(Number), scArg = list('scen', null), BASE = ['walk', 'run', 'along', 'holdw', 'jump'];
  // a spot's own extra scenarios (seat: sit, drop: down) come on top of the base five
  const scensOf = (s) => { const all = BASE.concat(s.scens || []); return scArg ? all.filter((x) => scArg.includes(x)) : all; };
  const spots = out.spots.filter((s) => !s.missing && (!want || want.some((w) => s.id.startsWith(w))));
  H.log('spots: ' + out.spots.map((s) => s.id + (s.missing ? ' (missing)' : '')).join(', ') + ' · brain: ' + out.brain);
  if (LAB) H.log('lab ' + out.lab.version + ' ' + out.lab.hash);
  for (const s of spots) for (const side of sides) for (const sc of scensOf(s)) {
    const id = (s.id.replace(/[^a-z0-9]+/gi, '_') + '_' + side + '_' + sc).toLowerCase();
    let r = null;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      const t0 = Date.now();
      try { r = await H.page.evaluate((a, b, c, d) => RG.card(a, b, c, d), s.id, side, sc, id); }
      catch (e) {
        if (dead(e) && attempt === 0) {
          // the tab died: note what it was doing, restart the page and try this card once more
          out.restarts.push({ card: id, error: String(e.message).slice(0, 200), at: new Date().toISOString() });
          console.log(`  ${id.padEnd(34)} tab died (${String(e.message).slice(0, 60)}) — restarting the page`);
          try { await H.close(); } catch (e2) { /* already gone */ }
          try { await boot(); await H.page.evaluate(() => RG.spots()); } catch (e3) { out.errors.push('restart: ' + String(e3 && e3.message || e3).slice(0, 300)); }
          continue;
        }
        r = { spot: s.id, side, scen: sc, error: String(e.message).slice(0, 300) };
      }
      if (r) {
        try { r.heapMB = await H.page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null); } catch (e) { r.heapMB = null; }
        const j = r.judge || {};
        console.log(`  ${id.padEnd(34)} ${r.error ? 'ERR ' + r.error.slice(0, 80) : `${(r.actions || []).slice(0, 2).join('+') || '—'} · 🤝 ${j.contactS}s · 🧱 ${j.penCm}cm ${j.penPart || ''} · ✋air ${j.airS}s · 🧍 ${j.idleNearS}s · ⚡ ${j.teleports}/${j.jerks}/${j.snaps} · 🎞 ${j.clipsPerS}/s`} · heap ${r.heapMB} MB (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
    }
    r.id = id; out.cards.push(r);
    save();
  }
} catch (e) { out.errors.push(String(e && e.stack || e).slice(0, 2000)); console.error(e); }
finally {
  out.pageErrors = H ? H.errors.slice(0, 30) : [];
  save(); try { await H.close(); } catch (e) { /* gone */ }
  console.log('→ ' + path.join(dir, 'index.html'));
}
