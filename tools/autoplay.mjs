#!/usr/bin/env node
/* autoplay.mjs — full story runs through the game's real code paths + save compatibility, with a Jev oracle.
 *
 *   node tools/autoplay.mjs [--out stand/autoplay] [--runs take,free] [--no-saves] [--no-oracle] [--headful]
 *
 * Each run: new game (intro advanced with E) → tool → Orm → lake cell → Orm → (free: 4 echoes) → 3 spires → Orm →
 * rift boss (hp boost cheat) → heart choice (dialog button click) → Kestrel → ending card. Movement is by teleport;
 * everything else is the real input: E on interaction prompts and dialog lines, a click on the choice button, F for bolts.
 * Deterministic checks per step: prompt shown, stage advanced, HUD counters = game state, objective sane, pilot in
 * bounds, dialog not stuck, no JS errors. Saves: pre-wave-2 format (v1) at every stage + partial / legacy saves
 * → reload → Continue → state restored, pilot on the ground, no errors.
 * Oracle: server/typesafe.mjs (key read from .env by Node only, never printed), ≤ 4 calls per invocation, classifies
 * each step snippet as ok / stuck / unreachable_objective / out_of_bounds / quest_counter_wrong / soft_lock.
 * → <out>/autoplay.json, <out>/trace-<run>.json, step screenshots <out>/<run>-NN.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep, OUT, ROOT } from './qa/harness.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const out = path.resolve(OUT, String(opt('out', 'autoplay')).replace(/^stand\//, ''));
fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log('[autoplay]', ...a);
const STORY_JS = fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-story.js'), 'utf8');

const H = await openGame({ label: 'autoplay', quality: 'med', headful: !!opt('headful'), log });
const page = H.page;
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const snap = () => ev(() => QAS.snap());
const report = { date: new Date().toISOString(), runs: [], saves: [], oracle: null };

async function fresh() {
  await ev(() => { try { localStorage.removeItem('eor-save'); } catch (e) { /* */ } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 120000, polling: 250 });
  await ev(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-page.js'), 'utf8')); await ev(STORY_JS);
}
// E through the real keydown handler until the dialog is closed or shows choices
async function advanceDialog(max = 40) {
  let n = 0;
  for (; n < max; n++) { const s = await ev(() => (DBG.Dialog.active ? (DBG.Dialog.choosing ? 'choice' : 'line') : null)); if (s !== 'line') return { presses: n, state: s }; await page.keyboard.press('KeyE'); await sleep(90); }
  return { presses: n, state: 'stuck' };
}
async function clickChoice(label) {
  const r = await ev((label) => { const b = [...document.querySelectorAll('#dChoices button')].find((x) => x.children[1] && x.children[1].textContent === label); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; }, label);
  await sleep(150); return r;
}
async function interact(label, timeout = 2500, retarget = null) {
  // wait for the expected prompt; if another interaction steals it (closest wins), walk around the target (≤ 6 angles)
  const conflicts = [];
  for (let k = 0; k < (retarget ? 6 : 1); k++) {
    if (k && retarget) { await retarget(k); await sleep(400); }
    const t0 = Date.now(); let seen = null;
    while (Date.now() - t0 < timeout / (k ? 2 : 1)) { seen = await ev(() => (document.getElementById('prompt').hidden ? null : document.getElementById('promptText').textContent)); if (seen === label) break; await sleep(100); }
    if (seen === label) { await page.keyboard.press('KeyE'); await sleep(250); return { ok: true, seen, conflicts }; }
    if (seen) conflicts.push(seen);
  }
  return { ok: false, seen: conflicts[conflicts.length - 1] || null, conflicts };
}

async function runStory(kind) {
  log(`run "${kind}"`);
  await fresh();
  const run = { name: kind, steps: [], anomalies: [], cheats: ['pilot hp 99', 'boss hp boosted to 3'], ok: false, reached: '' };
  const errs0 = H.errors.length; let shot = 0;
  const step = async (name, fn, expect) => {
    const t0 = Date.now(), e0 = H.errors.length, before = await snap();
    let r = {}; try { r = (await fn()) || {}; } catch (e) { r = { error: e.message }; }
    await sleep(200);
    const after = await snap(), counters = await ev(() => QAS.counterCheck()), objective = await ev(() => QAS.objectiveCheck());
    const s = { i: run.steps.length, name, ms: Date.now() - t0, before, after, r, counters, objective, errors: H.errors.slice(e0) };
    const A = (kind2, what) => run.anomalies.push({ step: name, kind: kind2, what, at: after.pos, stage: after.stage });
    if (r.prompt && r.prompt.ok && r.prompt.conflicts && r.prompt.conflicts.length) A('prompt_conflict', `another prompt ("${[...new Set(r.prompt.conflicts)].join('", "')}") wins next to the "${r.prompt.expect}" target`);
    if (r.prompt && !r.prompt.ok) A('soft_lock', `prompt "${r.prompt.expect}" not shown near the target (saw "${r.prompt.seen}")`);
    if (r.dialog && r.dialog.state === 'stuck') A('soft_lock', 'dialog did not close after 40 × E');
    if (expect && !expect(after, before)) A('stuck', `expected progress did not happen (stage ${before.stage} → ${after.stage}, parts ${after.parts}, echoes ${after.echoes})`);
    if (counters.length) A('quest_counter_wrong', counters.join('; '));
    if (objective.length && after.mode === 'play') A('unreachable_objective', objective.join('; '));
    if (!after.pos.every(Number.isFinite) || Math.hypot(after.pos[0], after.pos[2]) > 440 || after.pos[1] < after.ground - 2) A('out_of_bounds', `pilot at ${after.pos} (ground ${after.ground})`);
    if (s.errors.length) A('js_error', s.errors.slice(0, 2).join(' | '));
    run.steps.push(s);
    await page.screenshot({ path: path.join(out, `${kind}-${String(++shot).padStart(2, '0')}.png`) });
    log(`  ${name.padEnd(22)} stage ${before.stage}→${after.stage} · ${s.ms} ms${run.anomalies.filter((a) => a.step === name).map((a) => ' · ' + a.kind).join('')}`);
    return s;
  };
  const around = (tgt, r, i) => (k) => ev((a) => QAS.goNear(a.i === null ? QAS.targets[a.t]() : QAS.targets[a.t](a.i), a.r, 0.6 + a.k * 1.05), { t: tgt, r, i: i === undefined ? null : i, k });
  const stagedTalk = (label, tgt) => async () => { await ev((t) => { QAS.goNear(QAS.targets[t](), 2.2); }, tgt); await sleep(500); const p = await interact(label, 2500, around(tgt, 2.2)); const d = await advanceDialog(); return { prompt: Object.assign(p, { expect: label }), dialog: d }; };
  await step('new game + intro', async () => { await ev(() => { DBG.newGame(); }); await sleep(900); const d = await advanceDialog(); await ev(() => QAS.cheat.hp()); return { dialog: d }; }, (a) => a.mode === 'play' && a.stage === 0 && !a.dialog);
  await step('take tool', stagedTalk('Открыть контейнер', 'crate'), (a) => a.stage === 1 && a.hasTool);
  await step('meet Orm', stagedTalk('Говорить', 'orm'), (a) => a.stage === 2);
  await step('lake cell', async () => { await ev(() => { QAS.goNear(QAS.targets.cell(), 2); QAS.cheat.hp(); }); await sleep(900); await advanceDialog(); await ev(() => QAS.goNear(QAS.targets.cell(), 2)); await sleep(500);
    const p = await interact('Взять ячейку', 2500, around('cell', 2)); const d = await advanceDialog(); return { prompt: Object.assign(p, { expect: 'Взять ячейку' }), dialog: d }; }, (a) => a.stage === 3 && a.hasCell);
  await step('cell to Orm', stagedTalk('Говорить', 'orm'), (a) => a.stage === 4);
  if (kind === 'free') for (let i = 0; i < 4; i++) await step(`echo ${i + 1}`, async () => { await ev((i) => QAS.goNear(QAS.targets.echo(i), 2), i); await sleep(500); const p = await interact('Слушать эхо', 2500, around('echo', 2, i)); const d = await advanceDialog(); return { prompt: Object.assign(p, { expect: 'Слушать эхо' }), dialog: d }; }, (a, b) => a.echoes === b.echoes + 1);
  for (let i = 0; i < 3; i++) await step(`spire ${['N', 'W', 'E'][i]}`, async () => { await ev((i) => { QAS.goNear(QAS.targets.spire(i), 2); QAS.cheat.hp(); }, i); await sleep(700); await advanceDialog(); await ev((i) => QAS.goNear(QAS.targets.spire(i), 2), i); await sleep(500);
    const p = await interact('Извлечь деталь', 2500, around('spire', 2, i)); const d = await advanceDialog(); return { prompt: Object.assign(p, { expect: 'Извлечь деталь' }), dialog: d }; }, (a, b) => a.parts === b.parts + 1 && (a.parts < 3 || a.stage === 5));
  await step('Orm, the Rift', stagedTalk('Говорить', 'orm'), (a) => a.stage === 6);
  await step('rift boss', async () => {
    await ev(() => { const r = DBG.POI.rift; QAS.cheat.hp(); DBG.teleport(r.x + 3, r.z + 26); });
    for (let i = 0; i < 40; i++) { if (await ev(() => DBG.boss.active)) break; await sleep(150); }
    const d0 = await advanceDialog();
    await ev(() => QAS.cheat.bossHp(3));
    let fired = 0; const pitches = [0.08, -0.05, -0.2, 0.2];
    for (let k = 0; k < 140 && !(await ev(() => DBG.boss.dead)); k++) {
      await ev((p) => { const b = DBG.boss, r = DBG.POI.rift, d = Math.hypot(DBG.player.x - b.x, DBG.player.z - b.z); if (d < 12 || d > 30) DBG.teleport(b.x + (DBG.player.x - b.x) / (d || 1) * 18, b.z + (DBG.player.z - b.z) / (d || 1) * 18); QAS.aimAt(b.x, b.y + 3.6, b.z, p); QAS.cheat.hp(); }, pitches[Math.floor(k / 12) % pitches.length]);
      await page.keyboard.press('KeyF'); fired++; await sleep(260); await advanceDialog(3);
    }
    await sleep(1600); const d1 = await advanceDialog();
    return { fired, dialog: d1, introDialog: d0 };
  }, (a) => a.bossDead && a.stage === 7);
  const choice = kind === 'take' ? 'Забрать Сердце' : 'Отпустить Хранителей';
  await step('heart choice', async () => {
    await ev(() => { const h = QAS.targets.heart(); QAS.goNear({ x: h.x, z: h.z }, 3); }); await sleep(600);
    const p = await interact('Коснуться Сердца'); const d = await advanceDialog(); const choices = (await snap()).hud.choices; const c = await clickChoice(choice); const d2 = await advanceDialog();
    return { prompt: Object.assign(p, { expect: 'Коснуться Сердца' }), dialog: d2, choices, click: c };
  }, (a) => a.stage === 8 && a.ending === kind);
  await step('Kestrel, take off', async () => { await ev(() => QAS.goNear(QAS.targets.kestrel(), 6)); await sleep(600); const p = await interact('«Кестрел»'); const d = await advanceDialog(); await sleep(8600);
    const end = await ev(() => ({ card: !document.getElementById('ending').hidden, title: document.getElementById('endTitle').textContent, endings: JSON.parse(localStorage.getItem('eor-endings') || '[]'), save: localStorage.getItem('eor-save') }));
    return { prompt: Object.assign(p, { expect: '«Кестрел»' }), dialog: d, end };
  }, (a) => a.mode === 'ending');
  const last = run.steps[run.steps.length - 1];
  if (last.r.end) { if (!last.r.end.card) run.anomalies.push({ step: last.name, kind: 'soft_lock', what: 'ending card not shown after 8.6 s' }); if (!last.r.end.endings.includes(kind)) run.anomalies.push({ step: last.name, kind: 'quest_counter_wrong', what: 'ending not recorded in eor-endings' }); if (last.r.end.save) run.anomalies.push({ step: last.name, kind: 'quest_counter_wrong', what: 'save not cleared after the ending' }); }
  run.reached = last.after.mode === 'ending' ? `ending "${last.r.end && last.r.end.title}"` : `stage ${last.after.stage}`;
  run.ok = run.anomalies.filter((a) => a.kind !== 'prompt_conflict').length === 0 && last.after.mode === 'ending';
  run.jsErrors = H.errors.slice(errs0);
  fs.writeFileSync(path.join(out, `trace-${kind}.json`), JSON.stringify(run, null, 1));
  return run;
}

/* ------------------------------------------------------------------ save compatibility */
async function saveTests() {
  const pos = { crash: [-23, 210], station: [180, 118], lake: [-178, 60], rift: [4, -10], spireW: [-262, -80] };
  const V1 = (stage, extra = {}) => Object.assign({ v: 1, stage, hasTool: stage >= 1, hasCell: stage >= 3, parts: [stage >= 5, stage >= 5, stage >= 5], shards: [0, 3, 7], echoes: stage >= 6 ? [0, 1, 2, 3] : [0], cleared: stage >= 3 ? ['lake'] : [],
    deaths: 2, fox: stage >= 2, time: 600 + stage * 120, pos: stage <= 1 ? pos.crash : stage <= 3 ? pos.station : pos.rift, sk: stage >= 4, bossDead: stage >= 7, ending: stage >= 8 ? 'take' : null, cp: stage >= 2 ? 'station' : 'crash' }, extra);
  const cases = [];
  for (let st = 0; st <= 8; st++) cases.push({ name: `v1 stage ${st}`, save: V1(st) });
  cases.push({ name: 'v1 stage 4, 2 parts, W spire pos', save: V1(4, { parts: [true, false, true], pos: pos.spireW }) });
  cases.push({ name: 'legacy: no cp / cleared / ending keys', save: (({ cp, cleared, ending, ...s }) => s)(V1(2)) });
  cases.push({ name: 'legacy: pos inside the station (pre-wave-2 layout)', save: V1(3, { pos: [180, 105] }) });
  cases.push({ name: 'free ending pending (stage 8)', save: V1(8, { ending: 'free' }) });
  const res = [];
  for (const c of cases) {
    const e0 = H.errors.length;
    await ev((s) => { localStorage.setItem('eor-save', JSON.stringify(s)); }, c.save);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const l = document.getElementById('loader'); return l && l.hidden && window.DBG; }, { timeout: 120000, polling: 250 });
    await ev(fs.readFileSync(path.join(ROOT, 'tools', 'qa', 'qa-page.js'), 'utf8')); await ev(STORY_JS);
    const btn = await ev(() => !document.getElementById('bContinue').hidden);
    if (btn) await page.click('#bContinue'); await sleep(2500);
    const s = await snap(), counters = await ev(() => QAS.counterCheck());
    const problems = [];
    if (!btn) problems.push('Continue button hidden');
    if (s.stage !== c.save.stage) problems.push(`stage ${s.stage} ≠ ${c.save.stage}`);
    if (s.mode !== 'play') problems.push('mode ' + s.mode);
    if (Math.hypot(s.pos[0] - c.save.pos[0], s.pos[2] - c.save.pos[1]) > 3) problems.push(`pilot at ${s.pos} (saved ${c.save.pos})`);
    if (s.pos[1] < s.ground - 0.5 || s.pos[1] > s.ground + 8) problems.push(`pilot ${Math.round((s.pos[1] - s.ground) * 100) / 100} m from the ground`);
    if (s.parts !== (c.save.parts || []).filter(Boolean).length) problems.push(`parts ${s.parts}`);
    problems.push(...counters);
    const errs = H.errors.slice(e0).filter((e) => !/api\/stats/.test(e)); if (errs.length) problems.push('JS: ' + errs.slice(0, 2).join(' | '));
    res.push({ name: c.name, ok: problems.length === 0, detail: problems.join('; ') || `stage ${s.stage} · parts ${s.parts} · echoes ${s.echoes} · ${s.text}`, snap: s });
    log(`  save ${c.name.padEnd(46)} ${problems.length ? 'FAIL ' + problems.join('; ') : 'ok'}`);
  }
  await ev(() => localStorage.removeItem('eor-save'));
  return res;
}

/* ------------------------------------------------------------------ Jev oracle */
async function oracle(runs, saves) {
  const { systemOne, loadKey } = await import(path.join(ROOT, 'server', 'typesafe.mjs'));
  const key = loadKey(); if (!key) return { calls: 0, summary: 'no TYPESAFE_API_KEY (skipped)' };
  const KINDS = { ok: 'the step worked: the story advanced as intended and nothing looks wrong', stuck: 'the player is stuck: the expected progress did not happen', unreachable_objective: 'the objective marker points somewhere the player cannot reach (outside the island, buried, under a solid, in the air)',
    out_of_bounds: 'the player ended outside the playable area, under the ground or at an invalid position', quest_counter_wrong: 'a quest counter or objective text on the HUD disagrees with the game state', soft_lock: 'the game waits for something that never comes (prompt missing, dialog never closes, no enabled choice)' };
  const result = { calls: 0, tokens: 0, verdicts: [], flags: 0 };
  const describe = (s) => `step "${s.name}": stage ${s.before.stage} ("${s.before.text}") → ${s.after.stage} ("${s.after.text}"); took ${s.ms} ms; objective target ${JSON.stringify(s.before.target)} at ${s.before.targetDist} m before;
 pilot at ${s.after.pos} (ground ${s.after.ground}); prompt ${s.r.prompt ? (s.r.prompt.ok ? 'shown' : 'NOT shown, saw ' + s.r.prompt.seen) : 'n/a'}; dialog ${s.r.dialog ? s.r.dialog.state + ' after ' + s.r.dialog.presses + ' presses' : 'n/a'};
 HUD objective "${s.after.hud.objective}", parts icons ${s.after.hud.partsOn} (game ${s.after.parts}), echoes ${s.after.hud.cEchoes} (game ${s.after.echoes}); counter checks: ${s.counters.join('; ') || 'none'}; objective checks: ${s.objective.join('; ') || 'none'}; JS errors ${s.errors.length}`;
  const call = async (label, items) => {
    if (result.calls >= 4 || !items.length) return;
    const state = { game: 'story-driven 3D exploration game; a QA bot plays it by teleporting between objectives and pressing the interaction key', steps: Object.fromEntries(items.map((s, k) => ['s' + k, describe(s)])) };
    const questions = Object.fromEntries(items.map((s, k) => ['s' + k, { type: 'choice', instructions: `Classify QA step \`steps.s${k}\`. Pick the single anomaly that best describes it, or ok.`, criteria: KINDS }]));
    try { const r = await systemOne({ key, state, questions, deadlineMs: 12000, maxRetries: 2 }); result.calls++; result.tokens += (r.usage && r.usage.input_tokens) || 0;
      items.forEach((s, k) => { const a = r.answers['s' + k]; if (a) result.verdicts.push({ run: label, step: s.name, kind: a.choice, confidence: a.confidence }); });
    } catch (e) { result.calls++; result.error = String(e.message).replace(key, '***').slice(0, 200); }
  };
  for (const run of runs) {
    // every flagged step + two unflagged controls, ≤ 10 per call
    const flagged = run.steps.filter((s) => run.anomalies.some((a) => a.step === s.name)), normal = run.steps.filter((s) => !flagged.includes(s)).slice(0, 2);
    await call(run.name, [...flagged, ...normal].slice(0, 10));
  }
  const badSaves = saves.filter((c) => !c.ok);
  if (badSaves.length) await call('saves', badSaves.slice(0, 6).map((c) => ({ name: c.name, ms: 0, before: c.snap, after: c.snap, r: {}, counters: [c.detail], objective: [], errors: [] })));
  result.flags = result.verdicts.filter((v) => v.kind !== 'ok' && v.confidence >= 0.5).length;
  result.usd = +(result.tokens * 42 / 1e9).toFixed(5);
  result.summary = `${result.calls} calls · ${result.flags} steps classified as anomalies` + (result.error ? ' · error ' + result.error : '');
  return result;
}

try {
  const runs = String(opt('runs', 'take,free')).split(',');
  for (const k of runs) report.runs.push(await runStory(k));
  if (!opt('no-saves')) { log('save compatibility'); report.saves = await saveTests(); }
  if (!opt('no-oracle')) { log('oracle'); report.oracle = await oracle(report.runs, report.saves); log('  ' + report.oracle.summary); for (const v of report.oracle.verdicts) if (v.kind !== 'ok') log(`  oracle: ${v.run} · ${v.step} → ${v.kind} (${v.confidence})`); }
} catch (e) { report.crash = String(e.stack || e.message); log('FAILED', e.stack || e.message); }
finally {
  report.jsErrors = H.errors.filter((e) => !/api\/stats/.test(e)).slice(0, 40);
  // reproducible steps for every anomaly
  report.repro = report.runs.flatMap((r) => r.anomalies.map((a) => ({ run: r.name, ...a, repro: `node tools/autoplay.mjs --runs ${r.name} (step "${a.step}", stage ${a.stage}, pilot at ${a.at})` })));
  fs.writeFileSync(path.join(out, 'autoplay.json'), JSON.stringify(report, (k, v) => (k === 'before' || k === 'snap' ? undefined : v), 1));
  await H.close();
  log(`runs: ${report.runs.map((r) => `${r.name} ${r.ok ? 'ok' : 'FAIL'} (${r.reached}, ${r.anomalies.length} anomalies)`).join(' · ')} · saves ${report.saves.filter((s) => s.ok).length}/${report.saves.length} · wrote ${path.join(out, 'autoplay.json')}`);
}
