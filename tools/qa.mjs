#!/usr/bin/env node
/* qa.mjs — one command for the whole verification system.
 *
 *   node tools/qa.mjs [--label qa-2026-09-25] [--no-stand] [--no-eye] [--no-motion] [--autoplay] [--views a,b] [--motions a,b] [--headful]
 *
 * Holds the benchmark lock for the whole run (tools/.stand.lock), then:
 *   1. stand      tools/stand.mjs (8 distant views, fps repeat-median, --quiet-check, collision tests) as a child
 *   2. inventory  every drawable → inventory.json / inventory.html
 *   3. eye        ~25 player-eye views with invariants (back faces, v1 primitives, untextured, black/NaN, camera, feet)
 *   4. feet       pilot idle on 7 surface types + animals, GPU visible-surface height map
 *   5. placed     every Passport object: floating > 10 cm / buried > 30 %
 *   6. motion     12 takes (walk, run, climbs, ride, fox, stags, shardlings, boss): facing, foot sliding, continuity,
 *                 black frames, camera; contact sheets + animated WebP
 *   7. autoplay   (--autoplay) tools/autoplay.mjs: both endings through the real story code + save compatibility
 * → stand/<label>/index.html (PASS/FAIL table, thumbnails, sheets) + qa.json. Typical runtime 8–12 min.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock, quietCheck } from './qa/hygiene.mjs';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';
import { injectViews, runViews, runFeet, runMotions, runPlaced } from './eye.mjs';
import { collectInventory, writeInventory, summarize } from './inventory.mjs';
import { page as htmlPage, esc, ICON, tile, status, bar } from './qa/report-kit.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const label = String(opt('label', 'qa-' + stamp));
const dir = path.join(OUT, label); fs.mkdirSync(dir, { recursive: true });
const log = (...a) => console.log('[qa]', ...a);
const t0 = Date.now();

function child(script, args) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools', script), ...args], { cwd: ROOT, env: Object.assign({}, process.env, { STAND_LOCK_PARENT: String(process.pid) }), stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => process.stdout.write(d)); p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('close', (code) => res(code));
  });
}

const release = await acquireLock('qa ' + label, { log });
const res = { label, date: new Date().toISOString(), machineStart: quietCheck() };
log('machine:', res.machineStart.quiet ? 'quiet' : 'busy — ' + res.machineStart.reasons.join('; '));

// 1. stand (its own browser, lock inherited)
if (!opt('no-stand')) {
  log('stand (8 views, fps × 3, collisions)');
  const code = await child('stand.mjs', [label + '/stand', '--quiet-check', '--repeat', '3']);
  try { res.stand = JSON.parse(fs.readFileSync(path.join(dir, 'stand', 'result.json'), 'utf8')); } catch (e) { res.stand = { error: 'stand exited ' + code }; }
}

// 2–6. one browser for inventory + eye + feet + placed + motion
let H = null;
try {
  H = await openGame({ label: 'qa ' + label, quality: 'high', lock: false, headful: !!opt('headful'), log });
  res.gpu = H.gpu; res.loadMs = H.loadMs; res.loader = H.loader;
  await H.newGame(); await injectViews(H); await sleep(1500);
  log('inventory');
  const rows = await collectInventory(H); writeInventory(rows, path.join(dir, 'inventory'), { date: res.date, gpu: H.gpu }); res.inventory = summarize(rows);
  log(`  ${res.inventory.visible} visible objects · v1 primitives ${res.inventory.leftovers.length} · untextured ${res.inventory.untextured.length}`);
  const pick = (k) => { const v = opt(k); return v === 'none' ? [] : v ? String(v).split(',') : null; };
  if (!opt('no-eye')) {
    log('eye views'); res.views = await runViews(H, path.join(dir, 'eye'), pick('views'), log);
    log('feet on the visible surface'); res.feet = await runFeet(H, path.join(dir, 'eye', 'feet'), log);
    log('placed objects'); res.placed = await runPlaced(H, log);
  }
  if (!opt('no-motion')) { log('motion takes'); res.motions = await runMotions(H, path.join(dir, 'eye', 'motion'), pick('motions'), log); }
} catch (e) { log('FAILED', e.stack || e.message); res.crash = String(e.stack || e.message); }
finally { if (H) { res.errors = H.errors.slice(0, 50); res.failed = H.failed.slice(0, 50); await H.close(); } }

// 7. autoplay (optional)
if (opt('autoplay')) {
  log('autoplay (both endings + save compatibility)');
  await child('autoplay.mjs', ['--out', path.join(label, 'autoplay')]);
  try { res.autoplay = JSON.parse(fs.readFileSync(path.join(dir, 'autoplay', 'autoplay.json'), 'utf8')); } catch (e) { res.autoplay = { error: 'no autoplay.json' }; }
}
res.machineEnd = quietCheck(); res.minutes = +((Date.now() - t0) / 60e3).toFixed(1);

/* ------------------------------------------------------------------ verdicts */
const V = []; const add = (group, check, subject, value, pass, extra = {}) => V.push(Object.assign({ group, check, subject, value, pass }, extra));
const G = { motion: 'движение', feet: 'опора', back: 'изнанка', prim: 'примитивы v1', black: 'чёрные кадры', tex: 'текстуры', cam: 'камера', perf: 'производительность', story: 'сюжет' };
for (const [m, r] of Object.entries(res.motions || {})) {
  if (r.skip) { add(G.motion, 'take', m, r.skip, null); continue; }
  for (const f of r.facing) add(G.motion, 'facing ↔ motion', `${m} · ${f.id}`, `bad ${Math.round((f.badFrac || 0) * 100)} % · min dot ${f.minDot} · run ${f.worstRunS} s · max ${f.maxSpeed} m/s`, f.pass, { img: `eye/motion/${m}.sheet.png` });
  for (const f of r.feet) add(G.motion, 'foot sliding', `${m} · ${f.id}`, `drift ${f.medDrift} m/step (p90 ${f.p90Drift}) · stride ratio ${f.medRatio} · ${f.steady}/${f.steps} steady steps · ${f.speed} m/s`, f.pass, { img: `eye/motion/${m}.sheet.png` });
  for (const c of r.continuity) add(G.motion, 'pose continuity', `${m} · ${c.id}`, `pelvis ${c.maxLocalPelvisSpeed} m/s @${c.at.t}s${c.at.clip ? ' (' + c.at.clip + ')' : ''} · root ${c.maxRootSpeed} m/s`, c.pass, { img: `eye/motion/${m}.sheet.png` });
  add(G.black, 'black / NaN frames', `take ${m}`, `${r.pixels.blackFrames}/${r.pixels.frames} frames · min luma ${r.pixels.minLuma} · max zero-px ${r.pixels.maxZero}`, r.pixels.pass, { img: `eye/motion/${m}.sheet.png` });
  add(G.cam, 'camera in geometry', `take ${m}`, `${r.camera.bad}/${r.camera.checked} frames`, r.camera.pass);
  if (r.extra && r.extra.climbed === false) add(G.motion, 'climb happened', m, 'no climb', false);
}
for (const [v, r] of Object.entries(res.views || {})) {
  if (r.skip) { add(G.back, 'view', v, r.skip, null); continue; }
  const img = `eye/${v}.png`;
  add(G.back, 'back faces on screen (holes = FAIL, two-sided back = WARN)', v, `${r.backfaces.px} px (${(r.backfaces.frac * 100).toFixed(2)} %) · holes ${r.backfaces.holes} · two-sided ${r.backfaces.dsBack}` + (r.backfaces.top.length ? ' · ' + r.backfaces.top.slice(0, 3).map((t) => `${t.name} ${t.px}`).join(', ') : ''), r.backfaces.pass, { img, mask: `eye/${v}.backfaces.png` });
  add(G.prim, 'v1 primitives visible', v, r.primitives.visible.length ? r.primitives.visible.map((p) => `${p.name}·${p.geo.replace('Geometry', '')} ${p.px}px`).join(', ') : '0', !r.primitives.visible.length, { img });
  add(G.black, 'black / NaN pixels', v, `luma ${r.pixels.mean} · zero ${(r.pixels.zero * 100).toFixed(2)} % · dark ${(r.pixels.dark * 100).toFixed(1)} %`, r.pixels.pass, { img });
  const blackObj = (r.dark && r.dark.top || []).filter((d) => d.ofObject > 0.5 && d.px >= 300 && d.owner);
  if (blackObj.length) add(G.black, 'near-black objects', v, blackObj.map((d) => `${d.name} ${Math.round(d.ofObject * 100)} % black`).join(', '), 'warn', { img });
  if (r.untextured.length) add(G.tex, 'untextured on screen', v, r.untextured.map((u) => `${u.name} ${(u.frac * 100).toFixed(1)} %${u.flat ? ' flat' : ''}`).join(', '), 'warn', { img });
  add(G.cam, 'camera', v, r.camera.pass ? 'ok' : [r.camera.underground && 'underground', r.camera.inside && 'inside mesh', r.camera.blocked && 'sight blocked by ' + r.camera.blocked.by, r.camera.blockedView && `view ${Math.round(r.nearCover * 100)} % covered < 1.2 m`, r.camera.nearest && r.camera.nearest.d < 0.15 && 'near-plane clip'].filter(Boolean).join(', '), r.camera.pass, { img });
  for (const f of r.feet || []) add(G.feet, 'feet on visible surface', `${v} · ${f.id}`, `worst ${f.worst} m · ` + f.feet.map((q) => `${q.bone} ${q.clearance}`).join(', '), f.pass, { img });
}
for (const [s, r] of Object.entries(res.feet || {})) {
  if (s === 'animals') { for (const a of r) add(G.feet, 'feet on visible surface', `idle · ${a.id}`, `worst ${a.worst} m · ` + a.feet.map((q) => `${q.bone} ${q.clearance}`).join(', '), a.pass); continue; }
  if (r.skip) { add(G.feet, 'feet on visible surface', s, r.skip, null); continue; }
  add(G.feet, 'feet on visible surface', `pilot · ${r.note}`, `worst ${r.worst} m · ` + (r.feet || []).map((q) => `${q.bone} ${q.clearance}`).join(', ') + ` · loose snow ${r.snow} m`, r.pass, { img: `eye/feet/${s}.png` });
}
if (res.placed) {
  add(G.feet, 'placed objects floating > 10 cm', `${res.placed.checked} objects`, res.placed.floatingByKind.map((k) => `${k.kind} ×${k.n} (worst ${k.worst.float} m @ ${k.worst.pos.map(Math.round)})`).join(', ') || '0', !res.placed.floating);
  add(G.feet, 'placed objects buried > 30 %', `${res.placed.checked} objects`, res.placed.buriedByKind.map((k) => `${k.kind} ×${k.n} (worst ${Math.round(k.worst.buried * 100)} %)`).join(', ') || '0', !res.placed.buried);
}
if (res.inventory) {
  add(G.prim, 'v1 primitives in the scene', `${res.inventory.visible} visible objects`, res.inventory.leftovers.map((r) => `${r.path}·${r.geo.replace('Geometry', '')}`).join(', ') || '0', !res.inventory.leftovers.length);
  add(G.tex, 'untextured meshes in the scene', `${res.inventory.visible} visible objects`, `${res.inventory.untextured.length}: ` + res.inventory.untextured.slice(0, 12).map((r) => r.path).join(', '), res.inventory.untextured.length ? 'warn' : true);
}
if (res.stand && res.stand.summary) {
  const S = res.stand.summary;
  add(G.perf, 'fps (8 distant views, median of 3)', 'stand', `median ${S.fpsMedian} · min ${S.fpsMin} · noisy views ${S.noisyViews} · ${S.fpsVerdict}`, /^PASS/.test(S.fpsVerdict) ? true : /^FAIL/.test(S.fpsVerdict) ? false : null);
  add(G.perf, 'collision tests', 'stand', `${S.collisionsOk}/${S.collisions}`, S.collisionsOk === S.collisions, { detail: (res.stand.collisions || []).filter((c) => !c.ok).map((c) => c.name).join(', ') });
  add(G.perf, 'black frames (distant views)', 'stand', String(S.blackFrames), !S.blackFrames);
}
add(G.perf, 'JS errors', 'qa browser', String((res.errors || []).length) + ((res.errors || []).length ? ' · ' + res.errors.slice(0, 2).join(' | ').slice(0, 200) : ''), !(res.errors || []).length);
if (res.loader) add(G.perf, 'loader modules', 'qa browser', `${res.loader.filter((m) => m.ok).length}/${res.loader.length}`, res.loader.every((m) => m.ok));
if (res.autoplay) {
  for (const run of res.autoplay.runs || []) add(G.story, 'story run', run.name, `${run.reached} · ${run.steps.length} steps · ${run.anomalies.length} anomalies` + (run.anomalies.length ? ' · ' + run.anomalies.slice(0, 3).map((a) => a.kind + ': ' + a.what).join('; ') : ''), run.ok);
  for (const c of res.autoplay.saves || []) add(G.story, 'save compatibility', c.name, c.detail, c.ok);
  if (res.autoplay.oracle) add(G.story, 'oracle (Jev)', `${res.autoplay.oracle.calls} calls`, res.autoplay.oracle.summary || '', res.autoplay.oracle.flags ? 'warn' : true);
}
res.verdicts = V;
const groups = Object.values(G).map((g) => { const rows = V.filter((v) => v.group === g); return { g, fail: rows.filter((r) => r.pass === false).length, warn: rows.filter((r) => r.pass === 'warn').length, pass: rows.filter((r) => r.pass === true).length, n: rows.length }; }).filter((x) => x.n);
res.groups = groups;
fs.writeFileSync(path.join(dir, 'qa.json'), JSON.stringify(res, null, 1));

/* ------------------------------------------------------------------ HTML */
const GI = { [G.motion]: ICON.run, [G.feet]: ICON.feet, [G.back]: ICON.back, [G.prim]: ICON.prim, [G.black]: ICON.frame, [G.tex]: ICON.tex, [G.cam]: ICON.cam, [G.perf]: ICON.perf, [G.story]: ICON.story };
const row = (v) => `<tr><td>${status(v.pass)}</td><td>${esc(v.check)}</td><td>${esc(v.subject)}</td><td class="mono">${esc(v.value)}${v.detail ? '<br><span class="muted">' + esc(v.detail) + '</span>' : ''}</td><td>${v.img ? `<img src="${esc(v.img)}" loading="lazy" style="width:120px;border-radius:4px">` : ''}</td></tr>`;
const viewCards = Object.entries(res.views || {}).filter(([, r]) => !r.skip).map(([v, r]) => { const bad = V.filter((x) => x.subject === v || x.subject.startsWith(v + ' ·')).filter((x) => x.pass === false);
  return `<div class="card" id="v-${esc(v)}"><div class="im"><img src="eye/${esc(v)}.png" loading="lazy" alt="${esc(v)}"><img class="mask" src="eye/${esc(v)}.backfaces.png" alt=""></div>
<div class="cb"><b>${esc(v)}</b>${bad.length ? bad.map((x) => `<span class="st bad" title="${esc(x.value)}">${GI[x.group] || ''}${esc(x.group)}</span>`).join('') : status(true)}
<button onclick="this.closest('.card').classList.toggle('showmask')" title="изнанка">${ICON.back}</button></div></div>`; }).join('');
const sheets = Object.entries(res.motions || {}).filter(([, r]) => !r.skip).map(([m, r]) => { const bad = V.filter((x) => x.subject.startsWith(m + ' ·') || x.subject === 'take ' + m).filter((x) => x.pass === false);
  return `<div class="card sheet"><img src="eye/motion/${esc(m)}.sheet.png" loading="lazy" alt="${esc(m)}"><div class="cb"><b>${esc(m)}</b>${bad.length ? bad.map((x) => `<span class="st bad" title="${esc(x.value)}">${GI[x.group] || ''}${esc(x.check)}</span>`).join('') : status(true)}
${fs.existsSync(path.join(dir, 'eye', 'motion', m + '.webp')) ? `<a class="chip" href="eye/motion/${esc(m)}.webp">${ICON.run}webp</a>` : ''}</div></div>`; }).join('');
const failN = V.filter((v) => v.pass === false).length, warnN = V.filter((v) => v.pass === 'warn').length;
const mach = res.machineStart.quiet && res.machineEnd.quiet;
const body = `<h1>${ICON.eye}QA · Эхо Разлома <span class="chip">${esc(label)}</span><span class="chip">${res.minutes} мин</span><span class="chip" style="color:var(--${mach ? 'ok' : 'warn'})">${ICON.lock}${mach ? 'машина свободна' : 'машина занята'}</span></h1>
<div class="tiles">${tile(ICON.bad, failN, 'FAIL', failN ? 'bad' : 'ok')}${tile(ICON.warn, warnN, 'WARN', warnN ? 'warn' : 'ok')}${tile(ICON.ok, V.filter((v) => v.pass === true).length, 'PASS', 'ok')}
${groups.map((g) => tile(GI[g.g] || ICON.list, `${g.fail} / ${g.n}`, g.g + (g.warn ? ` · warn ${g.warn}` : ''), g.fail ? 'bad' : g.warn ? 'warn' : 'ok')).join('')}</div>
${groups.filter((g) => g.fail || g.warn).map((g) => `<h2>${GI[g.g] || ''}${esc(g.g)} <span class="chip">FAIL ${g.fail}</span>${g.warn ? `<span class="chip">WARN ${g.warn}</span>` : ''}</h2>
<div class="tw"><table class="sort"><thead><tr><th></th><th>проверка</th><th>где</th><th>числа</th><th>кадр</th></tr></thead><tbody>${V.filter((v) => v.group === g.g && (v.pass === false || v.pass === 'warn')).map(row).join('')}</tbody></table></div>`).join('')}
<h2>${ICON.eye}Глазами игрока <span class="chip">${Object.keys(res.views || {}).length} видов</span></h2><div class="grid">${viewCards}</div>
<h2>${ICON.run}Движение <span class="chip">${Object.keys(res.motions || {}).length} дублей</span></h2><div class="grid" style="grid-template-columns:1fr">${sheets}</div>
<h2>${ICON.list}Все проверки</h2><div class="tw"><table class="sort"><thead><tr><th></th><th>проверка</th><th>где</th><th>числа</th><th>кадр</th></tr></thead><tbody>${V.map(row).join('')}</tbody></table></div>
<p><a class="chip" href="inventory.html">${ICON.list}инвентарь</a> <a class="chip" href="qa.json">${ICON.list}qa.json</a> ${res.stand && res.stand.views ? `<a class="chip" href="stand/result.json">${ICON.perf}stand</a>` : ''}</p>`;
fs.writeFileSync(path.join(dir, 'index.html'), htmlPage('QA · ' + label, body));
release();
log(`done in ${res.minutes} min · FAIL ${failN} · WARN ${warnN} · ${path.join(dir, 'index.html')}`);
for (const g of groups) log(`  ${g.g.padEnd(20)} FAIL ${g.fail} / ${g.n}${g.warn ? ' · WARN ' + g.warn : ''}`);
process.exit(0);
