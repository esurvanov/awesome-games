#!/usr/bin/env node
/* look-gate.mjs — visual acceptance gate: game views framed like the reference photos, judged by eye (LOOKGATE.md).
 *
 *   node tools/look-gate.mjs run [label] [--subjects a,b] [--size 1200x800] [--quality high] [--headful]
 *        → stand/lookgate-<label>/  <shot>.png · <subject>.pair.jpg (game | crop-matched photos) · <subject>.vs.jpg
 *          (accepted | now) · <motion>.strip.jpg + .webp · ref/<id>.jpg · run.json · review.template.json · index.html
 *   node tools/look-gate.mjs page <label>       rebuild index.html (after review.json is written)
 *   node tools/look-gate.mjs check <label>      validate review.json + HARD RULES vs the accepted run → check.json, exit 1 on reject
 *   node tools/look-gate.mjs accept <label> [--by name] [--force]
 *        promote to stand/lookgate-accepted/ (ONLY the user or the main agent). Refuses unless `check` passes; --force = user override.
 *   node tools/look-gate.mjs status             which run is accepted, history
 * Numeric QA (tools/qa.mjs) is never read here: a visual reject cannot be overridden by numbers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SUBJECTS, CRITERIA, ANTI, criteriaOf } from './look/subjects.mjs';
import './look/subjects-snow.mjs';   // SNOW-CONTACT: + snow_contact (player-camera boots / prints)
import './look/subjects-body.mjs';   // PHYSBODY: body_stop / body_bump / body_push / body_fall / body_slope (gameplay camera)
import './look/subjects-interact.mjs';   // INTERACT: + pilot_wall / pilot_wreck / pilot_tree / pilot_push (player camera)
import './look/subjects-camp.mjs';   // CAMP: + camp_fire / tents (player-camera framings, lg-camp.js)

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'stand');
const ACC = process.env.LOOKGATE_ACCEPTED ? path.resolve(process.env.LOOKGATE_ACCEPTED) : path.join(OUT, 'lookgate-accepted');   // env override = dry-run tests only
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const pos1 = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const dirOf = (label) => path.join(OUT, 'lookgate-' + label);
const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const accMeta = () => readJ(path.join(ACC, 'meta.json'));
const log = (...a) => console.log('[look-gate]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ run */
async function run() {
  const { openGame } = await import('./qa/harness.mjs');
  const { animatedWebp, dataUrlBuffer } = await import('./qa/webp.mjs');
  const label = pos1 || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = dirOf(label); fs.mkdirSync(dir, { recursive: true });
  const want = opt('subjects') ? String(opt('subjects')).split(',') : null;
  const subs = SUBJECTS.filter((s) => !want || want.includes(s.name));
  const size = String(opt('size', '1200x800')).split('x').map(Number);
  const { acquireLock } = await import('./qa/hygiene.mjs');
  const release = await acquireLock('look-gate ' + label, { log });   // one lock for the whole run, browser relaunches inside it
  const meta = { label, date: new Date().toISOString(), size, quality: opt('quality', 'high'), git: gitHead(), accepted: (accMeta() || {}).label || null, shots: {}, motions: {}, crashes: [] };
  let H = null;
  const boot = async () => {
    if (H) await H.close().catch(() => {});
    H = await openGame({ label: 'look-gate ' + label, lock: false, quality: opt('quality', 'high'), size, dpr: Number(opt('dpr', 1)), headful: !!opt('headful'), log });
    meta.gpu = H.gpu;
    await H.newGame();
    for (const f of ['tools/qa/qa-views.js', 'tools/look/lg-page.js', 'tools/look/lg-snow.js', 'tools/look/lg-interact.js', 'tools/look/lg-camp.js']) await H.page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    await H.page.evaluate(fs.readFileSync(path.join(ROOT, 'tools/look/lg-body.js'), 'utf8'));   // PHYSBODY framings
    await H.page.evaluate(() => LG.hud(false));
    await sleep(2500);
  };
  const shotOnce = async (s, shot) => {
    const r = await H.page.evaluate(async (n) => { LG.cleanup(); await QA.wait(150); const r = await LG.shots[n](); if (r && !r.skip) LG.cam(r.pos, r.look, r.fov); return r ? { pos: r.pos, look: r.look, fov: r.fov, note: r.note, skip: r.skip } : { skip: 'no result' }; }, shot);
    if (r.skip) { log(`  ${shot}: skipped (${r.skip})`); meta.shots[shot] = { skip: r.skip }; return; }
    await sleep(2400);
    await H.page.evaluate(() => { QA.closeDialogs(); DBG.G.pause = true; }); await sleep(300);
    await H.page.screenshot({ path: path.join(dir, shot + '.png') });
    await H.page.evaluate(() => { DBG.G.pause = false; });
    meta.shots[shot] = r; log(`  ${s.icon} ${shot.padEnd(14)} fov ${r.fov} · ${r.note}`);
  };
  const motionOnce = async (s, m) => {
    const r = await H.page.evaluate((n) => LG.take(n), m);
    if (r.skip) { log(`  ${m}: skipped (${r.skip})`); meta.motions[m] = { skip: r.skip }; return; }
    const fd = path.join(dir, 'motion', m); fs.rmSync(fd, { recursive: true, force: true }); fs.mkdirSync(fd, { recursive: true });
    const frames = r.thumbs.map((t, i) => { const file = `f${String(i).padStart(2, '0')}.webp`; fs.writeFileSync(path.join(fd, file), dataUrlBuffer(t.url)); return { file, t: t.t }; });
    fs.writeFileSync(path.join(fd, 'frames.json'), JSON.stringify({ frames }, null, 1));
    try { fs.writeFileSync(path.join(dir, m + '.webp'), animatedWebp(r.thumbs.map((t) => dataUrlBuffer(t.url)), { width: 480, height: 320, durationMs: Math.max(40, Math.round(r.dur / Math.max(1, r.thumbs.length) * 1000)) })); } catch (e) { log('  webp failed', e.message); }
    delete r.thumbs; meta.motions[m] = r; log(`  ${s.icon} ${m.padEnd(14)} ${frames.length} frames / ${r.dur.toFixed(1)} s · ${r.note}`);
  };
  // a crashed tab (GPU reset on a loaded machine) → relaunch and retry that item once
  const guarded = async (what, fn) => {
    for (let k = 0; k < 2; k++) {
      try { if (!H) await boot(); await fn(); return; } catch (e) {
        log(`  ✗ ${what}: ${String(e.message).split('\n')[0]}`); meta.crashes.push({ what, err: String(e.message).slice(0, 200) });
        await (H ? H.close().catch(() => {}) : null); H = null;
      }
    }
  };
  try {
    for (const s of subs) {
      for (const shot of s.shots) await guarded(shot, () => shotOnce(s, shot));
      for (const m of s.motions || []) await guarded(m, () => motionOnce(s, m));
    }
    meta.errors = H ? H.errors.slice(0, 20) : [];
  } finally { if (H) await H.close().catch(() => {}); release(); }
  const old = want && readJ(path.join(dir, 'run.json'));   // partial re-run: keep the other subjects' framing records
  if (old) { meta.shots = Object.assign(old.shots || {}, meta.shots); meta.motions = Object.assign(old.motions || {}, meta.motions); meta.partial = (old.partial || []).concat([{ date: meta.date, subjects: want }]); meta.date = old.date; }
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 1));
  const all = SUBJECTS.filter((s) => s.shots.some((sh) => fs.existsSync(path.join(dir, sh + '.png'))));
  compose(dir, all);
  fs.writeFileSync(path.join(dir, 'review.template.json'), JSON.stringify(template(label, all), null, 1));
  page(label);
  log('done →', path.join(dir, 'index.html'));
}
const gitHead = () => { try { return execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%h %s']).toString().trim().slice(0, 120); } catch (e) { return null; } };

function compose(dir, subs) {
  const refs = new Map();
  for (const s of subs) for (const [id, crop] of [...s.refs, ...(s.mrefs || [])]) refs.set(id + '', { id, crop });
  const acc = fs.existsSync(path.join(ACC, 'meta.json')) ? ACC : null;
  const job = { out: dir, W: 900, H: 600, refs: [...refs.values()], accepted: acc, subjects: subs.map((s) => ({ name: s.name, shots: s.shots, refs: s.refs.map((r) => r[0]), motions: s.motions || [] })) };
  const jf = path.join(dir, 'compose.json'); fs.writeFileSync(jf, JSON.stringify(job));
  execFileSync('python3', ['-B', path.join(ROOT, 'tools', 'look', 'compose.py'), jf], { stdio: 'inherit' });
}

function template(label, subs) {
  const acc = accMeta();
  return { label, reviewer: '', date: '', baseline: acc ? acc.label : null, blind: 'score from the pair sheets FIRST, then open the vs sheets',
    subjects: Object.fromEntries(subs.map((s) => [s.name, { scores: Object.fromEntries(criteriaOf(s).map((k) => [k, [0, '']])), anti: Object.fromEntries(s.anti.map((a) => [a, null])), vsAccepted: acc ? '' : 'n/a', note: '' }])),
    verdict: '', reason: '' };
}

/* ------------------------------------------------------------------ check (HARD RULES) */
function check(label, { quiet = false } = {}) {
  const dir = dirOf(label), rv = readJ(path.join(dir, 'review.json'));
  const res = { label, ok: false, errors: [], regressions: [], rows: [], verdict: 'reject' };
  if (!rv) { res.errors.push('no review.json — copy review.template.json and fill it (LOOKGATE.md)'); return finish(); }
  const acc = accMeta(), accRv = acc ? readJ(path.join(ACC, 'review.json')) : null;
  for (const s of SUBJECTS) {
    const run = readJ(path.join(dir, 'run.json')) || { shots: {} };
    if (!s.shots.some((sh) => fs.existsSync(path.join(dir, sh + '.png')))) continue;   // subject not in this run
    const r = rv.subjects && rv.subjects[s.name];
    if (!r) { res.errors.push(`${s.name}: not reviewed`); continue; }
    const ks = criteriaOf(s), sc = {};
    for (const k of ks) { const v = r.scores && r.scores[k]; if (!Array.isArray(v) || !(v[0] >= 1 && v[0] <= 5) || !String(v[1] || '').trim()) res.errors.push(`${s.name}.${k}: needs [1–5, "one-line reason"]`); else sc[k] = v[0]; }
    const an = r.anti || {};
    for (const a of Object.keys(an)) if (!ANTI[a]) res.errors.push(`${s.name}: unknown anti-pattern "${a}"`);
    for (const a of s.anti) if (!(an[a] === false || (typeof an[a] === 'string' && an[a].trim()))) res.errors.push(`${s.name}: anti-pattern ${a} not checked (false = absent, "where / what" = seen)`);
    const vals = Object.values(sc), min = vals.length ? Math.min(...vals) : 0, mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const row = { name: s.name, icon: s.icon, title: s.title, scores: sc, min, mean: +mean.toFixed(2), anti: Object.keys(an).filter((a) => an[a]), vs: r.vsAccepted || 'n/a', note: r.note || '' };
    // HARD RULE 1: any regression vs the accepted run on any subject = reject
    if (acc) {
      if (!['better', 'same', 'worse'].includes(r.vsAccepted)) res.errors.push(`${s.name}: vsAccepted must be better / same / worse (accepted run ${acc.label} exists)`);
      if (r.vsAccepted === 'worse') res.regressions.push(`${s.name}: reviewer marked it worse than accepted ${acc.label}`);
      const ar = accRv && accRv.subjects && accRv.subjects[s.name];
      if (ar) {
        for (const k of ks) { const old = ar.scores && ar.scores[k] && ar.scores[k][0]; if (old && sc[k] && sc[k] < old) res.regressions.push(`${s.name}.${k}: ${old} → ${sc[k]}`); }
        for (const a of row.anti) if (!(ar.anti || {})[a]) res.regressions.push(`${s.name}: new anti-pattern ${a}`);
      }
    }
    res.rows.push(row);
  }
  res.rows.sort((a, b) => a.min - b.min || a.mean - b.mean);
  if (!['accept', 'reject'].includes(rv.verdict)) res.errors.push('verdict must be accept / reject');
  const computed = res.errors.length || res.regressions.length ? 'reject' : 'accept';
  // HARD RULE 2: the reviewer may reject what the rules allow, never accept what they reject; numbers are not consulted
  res.verdict = rv.verdict === 'reject' ? 'reject' : computed;
  if (rv.verdict === 'accept' && computed === 'reject') res.errors.push('reviewer said accept, but HARD RULES reject');
  res.ok = res.verdict === 'accept';
  return finish();
  function finish() {
    fs.writeFileSync(path.join(dir, 'check.json'), JSON.stringify(res, null, 1));
    if (!quiet) {
      console.log(`\n${res.ok ? '✅ ACCEPTABLE' : '⛔ REJECT'} · ${label}`);
      for (const e of res.errors) console.log('  ✗', e);
      for (const e of res.regressions) console.log('  ↓ regression', e);
      if (res.rows.length) {
        console.log('\n  subject        min  mean  ' + CRITERIA.map((c) => c[0].slice(0, 5).padEnd(6)).join('') + ' anti');
        for (const r of res.rows) console.log(`  ${(r.icon + ' ' + r.name).padEnd(15)} ${r.min}   ${r.mean.toFixed(1).padStart(4)}  ${CRITERIA.map(([k]) => String(r.scores[k] || '·').padEnd(6)).join('')} ${r.anti.join(',')}`);
      }
    }
    return res;
  }
}

/* ------------------------------------------------------------------ accept / status */
function accept(label) {
  const dir = dirOf(label);
  if (!fs.existsSync(path.join(dir, 'run.json'))) { console.error('no run', dir); process.exit(2); }
  const c = check(label);
  if (!c.ok && !opt('force')) { console.error('\nrefused: the run does not pass the gate (use --force only on the user\'s explicit say-so)'); process.exit(1); }
  const prev = accMeta();
  const hist = readJ(path.join(ACC, 'history.json')) || [];
  fs.rmSync(ACC, { recursive: true, force: true }); fs.mkdirSync(ACC, { recursive: true });
  for (const f of fs.readdirSync(dir)) { if (f === 'index.html' || f === 'ref') continue; fs.cpSync(path.join(dir, f), path.join(ACC, f), { recursive: true }); }
  const meta = { label, acceptedAt: new Date().toISOString(), by: opt('by', process.env.USER || 'unknown'), forced: !!opt('force'), previous: prev ? prev.label : null, verdict: c.verdict };
  hist.push(meta);
  fs.writeFileSync(path.join(ACC, 'meta.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(ACC, 'history.json'), JSON.stringify(hist, null, 1));
  log(`accepted ${label} → ${ACC}` + (prev ? ` (was ${prev.label})` : ''));
}
function status() { const m = accMeta(); console.log(m ? `accepted: ${m.label} (${m.acceptedAt}, by ${m.by}${m.forced ? ', forced' : ''})` : 'no accepted run yet');
  for (const h of readJ(path.join(ACC, 'history.json')) || []) console.log('  ', h.acceptedAt, h.label, h.by);
  for (const d of fs.readdirSync(OUT).filter((d) => d.startsWith('lookgate-') && d !== 'lookgate-accepted')) { const c = readJ(path.join(OUT, d, 'check.json')); console.log('  run', d.slice(9), c ? (c.ok ? '✅' : '⛔') : '· unreviewed'); } }

/* ------------------------------------------------------------------ page */
function page(label) {
  const dir = dirOf(label), run = readJ(path.join(dir, 'run.json')) || { shots: {}, motions: {} };
  const rv = readJ(path.join(dir, 'review.json')), c = rv ? check(label, { quiet: true }) : null;
  const acc = accMeta(), accRel = path.relative(dir, ACC);
  const rows = c ? Object.fromEntries(c.rows.map((r) => [r.name, r])) : {};
  const color = (v) => (v >= 4 ? 'var(--ok)' : v >= 3 ? 'var(--mid)' : 'var(--bad)');
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const order = c ? [...c.rows.map((r) => r.name), ...SUBJECTS.map((s) => s.name).filter((n) => !rows[n])] : SUBJECTS.map((s) => s.name);
  let h = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Look gate ${esc(label)}</title>
<style>:root{--bg:#0d111b;--card:#161c2a;--tx:#e3e8f2;--mut:#8a95ab;--ok:#46c985;--mid:#e8b04a;--bad:#f06464;--ln:#263049}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f3f5f9;--card:#fff;--tx:#141a26;--mut:#5d6880;--ln:#dfe4ee}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:13px/1.35 system-ui,sans-serif;padding:12px 16px}
h1{font-size:16px;margin:0 0 10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.chip{padding:2px 8px;border-radius:99px;background:var(--card);border:1px solid var(--ln);font-size:12px}
.sum{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-bottom:12px}.sum a{display:flex;gap:6px;align-items:center;background:var(--card);border-radius:8px;padding:6px 8px;color:var(--tx);text-decoration:none}
.bar{flex:1;height:6px;border-radius:3px;background:var(--ln);overflow:hidden}.bar i{display:block;height:100%}
.s{background:var(--card);border-radius:10px;padding:10px;margin:0 0 12px}.s h2{font-size:14px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}.g figure{margin:0;position:relative}.g img{width:100%;display:block;border-radius:6px;aspect-ratio:3/2;object-fit:cover}
figcaption{position:absolute;left:4px;top:4px;background:#000a;color:#fff;font-size:11px;padding:1px 6px;border-radius:4px}
.cmp{position:relative;aspect-ratio:3/2;border-radius:6px;overflow:hidden}.cmp img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.cmp .now{clip-path:inset(0 0 0 var(--x,50%))}
.cmp input{position:absolute;left:0;right:0;bottom:6px;width:96%;margin:0 2%}.cmp .ln{position:absolute;top:0;bottom:0;left:var(--x,50%);width:2px;background:#fff}
.sc{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.sc span{padding:2px 7px;border-radius:5px;background:var(--bg);border:1px solid var(--ln);font-size:12px}
.anti{display:flex;flex-wrap:wrap;gap:4px}.anti span{font-size:11px;padding:1px 6px;border-radius:5px;border:1px solid var(--ln);color:var(--mut)}.anti span.hit{border-color:var(--bad);color:var(--bad)}
.mut{color:var(--mut)}</style></head><body>
<h1>🎯 Look gate · ${esc(label)} <span class="chip">${c ? (c.ok ? '✅ acceptable' : '⛔ reject') : '⏳ unreviewed'}</span> <span class="chip">📌 accepted: ${acc ? esc(acc.label) : '—'}</span> <span class="chip mut">${esc(run.date || '').slice(0, 16)} · ${esc(run.git || '')}</span></h1>`;
  if (c) {
    h += '<div class="sum">' + order.filter((n) => rows[n]).map((n) => { const r = rows[n]; return `<a href="#${n}">${r.icon} ${esc(n)} <span class="bar"><i style="width:${r.min * 20}%;background:${color(r.min)}"></i></span><b>${r.min}</b></a>`; }).join('') + '</div>';
    if (c.regressions.length || c.errors.length) h += `<div class="s">${c.regressions.map((e) => `<div>↓ ${esc(e)}</div>`).join('')}${c.errors.map((e) => `<div class="mut">✗ ${esc(e)}</div>`).join('')}</div>`;
  }
  for (const n of order) {
    const s = SUBJECTS.find((x) => x.name === n), r = rows[n], rs = rv && rv.subjects && rv.subjects[n];
    if (!s.shots.some((sh) => fs.existsSync(path.join(dir, sh + '.png')))) continue;
    h += `<div class="s" id="${n}"><h2>${s.icon} ${esc(s.title)}${r ? ` <span class="chip" style="color:${color(r.min)}">min ${r.min} · ⌀ ${r.mean}</span> <span class="chip">vs 📌 ${esc(r.vs)}</span>` : ''}</h2>`;
    if (rs) h += '<div class="sc">' + criteriaOf(s).map((k) => { const v = (rs.scores || {})[k] || [0, '']; const cr = CRITERIA.find((x) => x[0] === k); return `<span title="${esc(v[1])}">${cr[1]} <b style="color:${color(v[0])}">${v[0]}</b> ${esc(v[1])}</span>`; }).join('') + '</div>';
    h += '<div class="g">';
    for (const sh of s.shots) {
      if (!fs.existsSync(path.join(dir, sh + '.png'))) continue;
      const a = acc && fs.existsSync(path.join(ACC, sh + '.png'));
      h += a ? `<figure><div class="cmp" style="--x:50%"><img src="${accRel}/${sh}.png" alt="accepted"><img class="now" src="${sh}.png" alt="now"><span class="ln"></span><input type="range" min="0" max="100" value="50" oninput="this.parentNode.style.setProperty('--x',this.value+'%')"></div><figcaption>🎮 ${sh} · ◀ 📌 accepted | now ▶</figcaption></figure>`
        : `<figure><a href="${sh}.png"><img src="${sh}.png" alt="${sh}"></a><figcaption>🎮 ${sh} · fov ${(run.shots[sh] || {}).fov || ''}</figcaption></figure>`;
    }
    for (const [id] of s.refs) h += `<figure><img src="ref/${id}.jpg" alt="${id}"><figcaption>📷 ${id}</figcaption></figure>`;
    for (const m of s.motions || []) {
      if (fs.existsSync(path.join(dir, m + '.webp'))) h += `<figure><img src="${m}.webp" alt="${m}"><figcaption>🎞 ${m}</figcaption></figure>`;
      if (acc && fs.existsSync(path.join(ACC, m + '.webp'))) h += `<figure><img src="${accRel}/${m}.webp" alt="${m} accepted"><figcaption>📌 ${m} accepted</figcaption></figure>`;
    }
    for (const [id] of s.mrefs || []) h += `<figure><img src="ref/${id}.jpg" alt="${id}"><figcaption>📷 ${id}</figcaption></figure>`;
    h += '</div>';
    for (const m of s.motions || []) if (fs.existsSync(path.join(dir, m + '.strip.jpg'))) h += `<div style="margin-top:6px"><a href="${m}.strip.jpg"><img src="${m}.strip.jpg" alt="${m} strip" style="width:100%;border-radius:6px"></a></div>`;
    h += '<div class="anti" style="margin-top:6px">' + s.anti.map((a) => { const hit = rs && rs.anti && rs.anti[a]; return `<span class="${hit ? 'hit' : ''}" title="${esc(hit || ANTI[a])}">${esc(ANTI[a].split(' — ')[0])}${hit ? ' · ' + esc(hit) : ''}</span>`; }).join('') + '</div>';
    if (rs && rs.note) h += `<div class="mut" style="margin-top:4px">→ ${esc(rs.note)}</div>`;
    h += '</div>';
  }
  h += '</body></html>';
  fs.writeFileSync(path.join(dir, 'index.html'), h);
  return path.join(dir, 'index.html');
}

/* ------------------------------------------------------------------ CLI */
if (cmd === 'run') await run();
else if (cmd === 'page') { if (!pos1) throw new Error('label?'); log(page(pos1)); }
else if (cmd === 'check') { if (!pos1) throw new Error('label?'); const r = check(pos1); page(pos1); process.exit(r.ok ? 0 : 1); }
else if (cmd === 'accept') { if (!pos1) throw new Error('label?'); accept(pos1); }
else if (cmd === 'status') status();
else console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0]);
