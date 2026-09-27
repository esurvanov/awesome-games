// AI layer tests.  node tests/ai.test.mjs [--offline]
// Real-API part keeps total upstream calls < 60 and prints tokens / $ / latency. Results → tests/results.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.mjs';
import { loadKey, USD_PER_INPUT_TOKEN } from '../server/typesafe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const C = createRequire(import.meta.url)(path.join(ROOT, 'ai-content.js'));
const OFFLINE = process.argv.includes('--offline') || !loadKey();
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'eor-ai-' + n + '-'));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
let pass = 0, fail = 0; const R = { at: new Date().toISOString(), checks: [] };
const ok = (cond, name, extra) => { (cond ? pass++ : fail++); R.checks.push({ name, ok: !!cond, ...(extra ? { extra } : {}) }); console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + JSON.stringify(extra) : '')); };
const post = (port, body) => fetch(`http://127.0.0.1:${port}/api/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ fixtures */
const base = { stage: 4, echoes: [0, 3], parts: 1, fox: true, bossDead: false, ending: 'none' };
const ORM_CASES = [
  ['Привет, старик!', ['greet']],
  ['Кто такая Лидия?', ['lidia_who']],
  ['Почему ты не пошёл за ней?', ['lidia_guilt', 'lidia_where']],
  ['Куда мне теперь идти?', ['goal_spires', 'spires_where']],
  ['что это за штуки светятся в небе', ['aurora', 'spires']],
  ['расскажи про лису', ['fox_joined']],
  ['ты тупой', ['rude']],
  ['сколько будет 17 умножить на 23', ['dont_know', 'dont_understand']],
  ['фывапролд', ['dont_understand']],
  ['как мне починить корабль?', ['ship', 'ship_parts']],
];
const CMD_CASES = [
  ['открой карту', 'open_map'], ['позови скиммер', 'call_skimmer'], ['где костёр?', 'where_campfire'], ['куда идти дальше', 'where_objective'],
  ['выключи звук', 'mute'], ['игра тормозит', 'quality_low'], ['просканируй местность', 'scan'], ['Искра, ищи!', 'fox_seek'],
  ['поставь на паузу', 'pause'], ['какая сегодня погода в москве', 'none'],
];
const cmdCtx = { riding: false, nearOrm: false, nearFire: false, fox: true, skimmer: true, uiOpen: false };
const DIR_CASES = [
  { name: 'calm explorer', s: { hp: 5, hpMax: 5, stage: 4, storm: 'none', location: 'wilds', combat: false, deathsRecent: 0, sinceEvent: 240, idle: 0, riding: false, fox: true, allowed: ['blizzard', 'ambush_small', 'stag_herd', 'aurora_flare', 'echo_whisper', 'fox_find'] }, bad: [] },
  { name: 'hurt after death', s: { hp: 1, hpMax: 5, stage: 4, storm: 'none', location: 'wilds', combat: false, deathsRecent: 2, sinceEvent: 200, idle: 0, riding: false, fox: true, allowed: ['stag_herd', 'aurora_flare', 'supply_drop', 'blizzard'] }, bad: ['blizzard', 'ambush_small'] },
  { name: 'in combat', s: { hp: 4, hpMax: 5, stage: 4, storm: 'none', location: 'spireW', combat: true, deathsRecent: 0, sinceEvent: 30, idle: 0, riding: false, fox: true, allowed: ['stag_herd', 'aurora_flare', 'blizzard'] }, bad: ['blizzard', 'stag_herd'] },
];
const CREATURE_CASES = [
  { activity: 'running', hp: 5, armed: true, combat: false, creatures: [
    { id: 'c0', kind: 'stag', dist: 8, approaching: true, hurt: false }, { id: 'c1', kind: 'stag', dist: 55, approaching: false, hurt: false },
    { id: 'c2', kind: 'fox', dist: 4, approaching: false, hurt: false, shardNear: true }, { id: 'c3', kind: 'shardling', dist: 12, approaching: true, hurt: true, mates: 0 } ] },
  { activity: 'idle', hp: 5, armed: false, combat: false, creatures: [
    { id: 'c0', kind: 'stag', dist: 25, approaching: false, hurt: false }, { id: 'c1', kind: 'fox', dist: 3, approaching: false, hurt: false, shardNear: false },
    { id: 'c2', kind: 'shardling', dist: 45, approaching: false, hurt: false, mates: 2 }, { id: 'c3', kind: 'shardling', dist: 9, approaching: false, hurt: false, mates: 3 } ] },
];
const HINT_CASES = [
  { stage: 2, inStage: 600, idle: 10, trend: 'wandering', dist: 400, deaths: 2, riding: false, skimmer: false, echoes: 0, parts: 0, location: 'wilds' },
  { stage: 4, inStage: 40, idle: 0, trend: 'closer', dist: 150, deaths: 0, riding: true, skimmer: true, echoes: 2, parts: 1, location: 'wilds' },
];
const Q_CASES = [
  { name: 'struggling laptop', s: { fpsAvg: 24, fpsLow: 15, device: 'mid', mobile: false, activity: 'combat', storm: true, calls: 400, tris: 1500000, look: 'horizon', preset: 'high' }, want: ['low', 'med'] },
  { name: 'strong desktop', s: { fpsAvg: 118, fpsLow: 95, device: 'high', mobile: false, activity: 'exploring', storm: false, calls: 250, tris: 800000, look: 'horizon', preset: 'med' }, want: ['high', 'ultra'] },
  { name: 'phone ok', s: { fpsAvg: 52, fpsLow: 38, device: 'low', mobile: true, activity: 'driving', storm: false, calls: 150, tris: 400000, look: 'ground', preset: 'med' }, want: ['low', 'med'] },
];
const PRE_CASES = [
  { s: { stage: 2, at: 'station', heading: 'lake', riding: false, visited: ['crash', 'station'], zones: ['lake', 'spireN', 'spireW', 'spireE', 'rift'] }, want: ['lake'] },
  { s: { stage: 6, at: 'station', heading: 'rift', riding: true, visited: ['crash', 'station', 'lake', 'spireN', 'spireW', 'spireE'], zones: ['rift', 'crash'] }, want: ['rift'] },
];
const CONTACT_CASE = { surface: 'wall', height: 1.3, distance: 0.5, angleDeg: 0, speed: 0.1, state: 'idle', stamina: 0.9, cold: 0.1, animalsNear: 0, npcNear: false, onIce: false };
const CONTACT_CASES = [
  { name: 'idle at a rock face', s: { ...CONTACT_CASE }, want: ['rest_on_rock'] },
  { name: 'slow approach to a wall', s: { surface: 'wall', height: 1.4, distance: 0.9, angleDeg: 0, speed: 1.0, state: 'walking', stamina: 0.8, cold: 0.2, animalsNear: 0, npcNear: false, onIce: false }, want: ['touch_surface', 'rest_on_rock'] },
  { name: 'sprinting past a wall', s: { surface: 'wall', height: 1.4, distance: 0.8, angleDeg: 0, speed: 9, state: 'running', stamina: 0.6, cold: 0.2, animalsNear: 0, npcNear: false, onIce: false }, want: ['none'] },
  { name: 'low crate ahead, walking', s: { surface: 'obstacle_top', height: 0.45, distance: 0.9, angleDeg: 0, speed: 1.2, state: 'walking', stamina: 0.9, cold: 0.1, animalsNear: 0, npcNear: false, onIce: false }, want: ['cross_obstacle'] },
  { name: 'fighting next to a wall', s: { surface: 'wall', height: 1.3, distance: 0.5, angleDeg: 0, speed: 3, state: 'combat', stamina: 0.4, cold: 0.1, animalsNear: 0, npcNear: false, onIce: false }, want: ['none'] },
];

/* ------------------------------------------------------------------ 1. offline: content, validation, fallbacks */
console.log('\n[1] content & rule fallbacks (no network)');
ok(C.ORM.length >= 40, 'ORM replies ≥ 40', { n: C.ORM.length });
ok(C.CMD.length >= 25, 'commands ≥ 25', { n: C.CMD.length });
ok(C.ORM.every((r) => r.t.length <= 80), 'Orm lines short (≤80 chars)', { max: Math.max(...C.ORM.map((r) => r.t.length)) });
for (const id of Object.keys(C.SETS)) {
  const sample = { ORM_TALK: { phrase: 'привет', ...base }, DIRECTOR: DIR_CASES[0].s, CREATURE: CREATURE_CASES[0], COMMANDS: { text: 'карта', ...cmdCtx }, HINTS: HINT_CASES[0], QUALITY_DIRECTOR: Q_CASES[0].s, PRELOAD: PRE_CASES[0].s, CONTACT_INTENT: CONTACT_CASE }[id];
  const { set, s } = C.prepare(id, sample); const b = set.build(s);
  ok(Object.keys(b.questions).length > 0 && set.interpret(null, s) != null, `${id}: builds questions & rules fallback works`, { q: Object.keys(b.questions).length });
}
let threw = false; try { C.prepare('ORM_TALK', { phrase: 1, stage: 4 }); } catch { threw = true; } ok(threw, 'schema rejects malformed state');
threw = false; try { C.prepare('EVIL', {}); } catch { threw = true; } ok(threw, 'unknown set rejected');
const kwHits = ORM_CASES.filter(([p, want]) => want.includes(C.ormKeyword({ ...base, phrase: p }))).length;
const kwCmd = CMD_CASES.filter(([p, want]) => C.cmdKeyword(p) === want).length;
R.keywordBaseline = { orm: `${kwHits}/${ORM_CASES.length}`, commands: `${kwCmd}/${CMD_CASES.length}` };
console.log('  keyword baseline: orm', R.keywordBaseline.orm, '· commands', R.keywordBaseline.commands);

/* ------------------------------------------------------------------ 2. mocked upstream: backoff, circuit, rate limit, timeout, no key */
console.log('\n[2] server resilience (mocked upstream, no cost)');
{
  let n = 0; const seq = [429, 200];
  const fake = async () => { const st = seq[Math.min(n++, seq.length - 1)]; return new Response(JSON.stringify(st === 200 ? { model: 'fake', answers: { event: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.95 } } }, usage: { input_tokens: 100, output_tokens: 5 } } : { error: 'x' }), { status: st, headers: { 'retry-after': '0' } }); };
  const srv = startServer({ port: 0, key: 'test', fetchImpl: fake, cacheDir: tmp('m1'), quiet: true }); const port = await srv.ready;
  const [c1, j1] = await post(port, { set: 'DIRECTOR', state: DIR_CASES[0].s });
  ok(c1 === 200 && j1.meta.attempts === 2, '429 → exponential backoff retry succeeds', { attempts: j1.meta && j1.meta.attempts });
  const [c2, j2] = await post(port, { set: 'DIRECTOR', state: DIR_CASES[0].s });
  ok(c2 === 200 && j2.meta.cached, 'identical state → cache hit', { ms: j2.meta.ms });
  const [c3] = await post(port, { set: 'NOPE', state: {} }); ok(c3 === 400, 'non-whitelisted set → 400');
  const [c4] = await post(port, { set: 'ORM_TALK', state: { phrase: 'x'.repeat(50), stage: 99, echoes: 'bad' } }); ok(c4 === 422, 'bad state → 422');
  const r5 = await fetch(`http://127.0.0.1:${port}/api/decide`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' }); ok(r5.status === 403, 'foreign Origin → 403');
  const r6 = await fetch(`http://127.0.0.1:${port}/.env`); ok(r6.status === 404, '.env is never served');
  const r7 = await fetch(`http://127.0.0.1:${port}/server/cache/usage.json`); ok(r7.status === 404, 'server/ folder is never served');
  const r8 = await fetch(`http://127.0.0.1:${port}/ai.js`); ok(r8.status === 200 && !(await r8.text()).includes(loadKey() || '@@none@@'), 'ai.js served, contains no key');
  await srv.close();
}
{
  let calls = 0; const fake = async () => { calls++; return new Response('{}', { status: 529 }); };
  const srv = startServer({ port: 0, key: 'test', fetchImpl: fake, cacheDir: tmp('m2'), quiet: true }); const port = await srv.ready;
  const t0 = Date.now(); const [c1] = await post(port, { set: 'DIRECTOR', state: DIR_CASES[1].s }); const dt = Date.now() - t0;
  ok(c1 === 502 && dt < 1700, '529 persistent → fails fast (<1.7 s)', { ms: dt, upstreamCalls: calls });
  const t1 = Date.now(); const [c2, j2] = await post(port, { set: 'DIRECTOR', state: DIR_CASES[2].s });
  ok(c2 === 503 && j2.reason === 'cooldown' && Date.now() - t1 < 50, 'circuit breaker open → instant 503', { reason: j2.reason });
  ok(srv.stats().circuit.open, 'stats show circuit open');
  await srv.close();
}
{
  const fake = (url, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const srv = startServer({ port: 0, key: 'test', fetchImpl: fake, cacheDir: tmp('m3'), quiet: true }); const port = await srv.ready;
  const t0 = Date.now(); const [c] = await post(port, { set: 'HINTS', state: HINT_CASES[0] }); const dt = Date.now() - t0;
  ok(c === 502 && dt >= 1400 && dt < 1800, 'hung upstream → timeout at ~1.5 s', { ms: dt });
  await srv.close();
}
{
  const fake = async () => new Response(JSON.stringify({ answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200 });
  const srv = startServer({ port: 0, key: 'test', fetchImpl: fake, cacheDir: tmp('m4'), quiet: true, rlCap: 10, rlRate: 1 }); const port = await srv.ready;
  const codes = await Promise.all(Array.from({ length: 16 }, (_, i) => post(port, { set: 'COMMANDS', state: { text: 'команда ' + i, ...cmdCtx } }).then((r) => r[0])));
  ok(codes.filter((c) => c === 429).length >= 5, 'rate limit → 429 beyond burst', { ok: codes.filter((c) => c === 200).length, limited: codes.filter((c) => c === 429).length });
  await srv.close();
}
{
  const srv = startServer({ port: 0, key: '', cacheDir: tmp('m5'), quiet: true }); const port = await srv.ready;
  const st = await (await fetch(`http://127.0.0.1:${port}/api/stats`)).json();
  const [c] = await post(port, { set: 'DIRECTOR', state: DIR_CASES[0].s });
  ok(st.ai === false && c === 503, 'no key → stats.ai=false, decide 503 (client uses rules)');
  await srv.close();
}

/* ------------------------------------------------------------------ 3. client ai.js with the server down */
let VMAI = null;
console.log('\n[3] client fallback (ai.js in a VM, server down)');
{
  const listeners = {};
  const doc = { hidden: false, body: null, head: { appendChild() {} }, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, querySelector: () => null, addEventListener() {} }), pointerLockElement: null };
  const sandbox = { console, setTimeout, clearTimeout, AbortController, performance, Promise, JSON, Math, Date, Map, Set, URL,
    location: { search: '', protocol: 'http:', pathname: '/' }, navigator: { hardwareConcurrency: 8 }, matchMedia: () => ({ matches: false }), document: doc,
    addEventListener: (t, f) => { listeners[t] = f; }, fetch: (u) => fetch('http://127.0.0.1:9' + u) };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ai-content.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'ai.js'), 'utf8'), sandbox);
  const AI = sandbox.AI; VMAI = AI; const t0 = performance.now(); const avail = await AI.ready; const probeMs = performance.now() - t0;
  ok(avail === false && probeMs < 1000, 'probe detects missing server quickly', { ms: Math.round(probeMs) });
  const t1 = performance.now(); const a = await AI.decide('DIRECTOR', DIR_CASES[0].s); const d1 = performance.now() - t1;
  ok(a === null && d1 < 5, 'decide() resolves null instantly offline', { ms: +d1.toFixed(2) });
  const r = await AI.ask('ORM_TALK', { phrase: 'Кто такая Лидия?', ...base });
  ok(r && r.id === 'lidia_who' && r.src === 'rules', 'Orm talk falls back to keyword rules', { id: r && r.id });
  const toasts = [], applied = [];
  const G = { mode: 'play', stage: 4, pause: false, ui: null, deaths: 0, echoes: [], hasTool: true, parts: 1 };
  AI.init({ G, player: { x: 300, z: 0, hp: 2, hpMax: 5 }, POI: C.POIS.reduce((o, k, i) => (o[k] = { x: i * 1000, z: 0 }, o), {}), toast: (i, t) => toasts.push(t), events: { supply_drop: () => applied.push('supply_drop') }, WX: { target: 0, storm: 0 } });
  const t2 = performance.now(); for (let i = 0; i < 60 * 45; i++) AI.tick(1 / 60); const tickMs = (performance.now() - t2) / (60 * 45);
  await sleep(20);
  ok(applied.includes('supply_drop'), 'director rules fire offline (low HP → supply_drop)', { toasts });
  ok(tickMs < 0.05, 'AI.tick cost per frame', { ms: +tickMs.toFixed(4) });
  R.client = { probeMs: Math.round(probeMs), offlineDecideMs: +d1.toFixed(3), tickMs: +tickMs.toFixed(4) };
}
{ // hysteresis on the real client code: alternating advice must not flap the preset
  const AI = VMAI; const set = []; AI.ctx.setQuality = (n) => set.push(n); AI.quality.set('high', 0); set.length = 0;
  const s = { fpsAvg: 60, fpsLow: 55 };
  for (const w of ['ultra', 'high', 'ultra', 'high', 'ultra', 'high', 'ultra', 'high']) AI.quality._hyst(w, s, 'test');
  AI.cfg.quality.offlineRules = false; for (let i = 0; i < 60 * 30; i++) AI.tick(1 / 60); // 30 s dwell passes
  ok(set.length === 0, 'quality hysteresis: alternating advice → 0 changes', { changes: set.length });
  for (let i = 0; i < 3; i++) AI.quality._hyst('ultra', s, 'test');
  ok(set.join() === 'ultra', 'quality hysteresis: 3 consistent "up" samples → one step up', { set });
  AI.quality._hyst('low', { fpsAvg: 20, fpsLow: 12 }, 'test');
  ok(set.join() === 'ultra,high', 'quality hysteresis: fps 20 → immediate single step down (no jump to low)', { set });
}

/* ------------------------------------------------------------------ 4. real API */
if (OFFLINE) { console.log('\n[4] real API skipped (no key / --offline)'); }
else {
  console.log('\n[4] real TypeSafe API (budget < 60 calls)');
  const cacheDir = tmp('real'); const srv = startServer({ port: 0, cacheDir, quiet: true }); const port = await srv.ready;
  const lat = [], tokens = [], per = {}; let calls = 0;
  const call = async (set, state) => { const [c, j] = await post(port, { set, state }); if (j.ok && !j.meta.cached) { calls++; lat.push(j.meta.ms); tokens.push(j.meta.tokens.in); (per[set] ||= []).push(j.meta.tokens.in); } return [c, j]; };
  // ORM
  let ormHits = 0; const ormRows = [];
  for (const [p, want] of ORM_CASES) {
    const s = { phrase: p, ...base }; const [, j] = await call('ORM_TALK', s);
    const r = C.SETS.ORM_TALK.interpret(j.ok ? j.answers : null, C.prepare('ORM_TALK', s).s);
    const hit = want.includes(r.id); ormHits += hit; ormRows.push({ phrase: p, got: r.id, src: r.src, top: j.answers && j.answers.reply && j.answers.reply.probabilities[j.answers.reply.choice], conf: j.answers && j.answers.reply && j.answers.reply.confidence, mood: r.mood, lidia: +(r.lidia || 0).toFixed(2), hit });
  }
  ok(ormHits >= 8, `ORM_TALK accuracy ${ormHits}/${ORM_CASES.length}`, { keywordBaseline: R.keywordBaseline.orm });
  // COMMANDS
  let cmdHits = 0; const cmdRows = [];
  for (const [p, want] of CMD_CASES) {
    const s = { text: p, ...cmdCtx }; const [, j] = await call('COMMANDS', s);
    const r = C.SETS.COMMANDS.interpret(j.ok ? j.answers : null, C.prepare('COMMANDS', s).s); const hit = r.id === want; cmdHits += hit;
    cmdRows.push({ text: p, want, got: r.id, conf: +(r.conf || 0).toFixed(2), src: r.src, hit });
  }
  ok(cmdHits >= 8, `COMMANDS accuracy ${cmdHits}/${CMD_CASES.length} (gate ≥0.6)`, { keywordBaseline: R.keywordBaseline.commands });
  // DIRECTOR
  const dirRows = [];
  for (const c of DIR_CASES) { const [, j] = await call('DIRECTOR', c.s); const r = C.SETS.DIRECTOR.interpret(j.ok ? j.answers : null, C.prepare('DIRECTOR', c.s).s); dirRows.push({ case: c.name, event: r.event, conf: j.answers && +j.answers.event.confidence.toFixed(2), tension: r.tension, src: r.src }); ok(!c.bad.includes(r.event), `DIRECTOR "${c.name}" → ${r.event} (tension ${r.tension})`); }
  // CREATURE (batched: 4 creatures per call)
  const crRows = [];
  for (const c of CREATURE_CASES) { const [, j] = await call('CREATURE', c); const r = C.SETS.CREATURE.interpret(j.ok ? j.answers : null, C.prepare('CREATURE', c).s); crRows.push(Object.fromEntries(c.creatures.map((x) => [x.id + ':' + x.kind + '@' + x.dist, r[x.id].act + (r[x.id].src === 'rules' ? '*' : '')]))); }
  ok(crRows[0]['c0:stag@8'] && crRows[0]['c0:stag@8'].startsWith('flee'), 'CREATURE: stag 8 m from running armed player flees', crRows[0]);
  // HINTS
  const hintRows = [];
  for (const c of HINT_CASES) { const [, j] = await call('HINTS', c); const r = C.SETS.HINTS.interpret(j.ok ? j.answers : null, C.prepare('HINTS', c).s); hintRows.push({ stage: c.stage, stuck: r.stuck, noul: j.answers && j.answers.stuck && +j.answers.stuck.noul.toFixed(2), id: r.id }); }
  ok(hintRows[0].stuck && !hintRows[1].stuck, 'HINTS: stuck detection (10 min + 2 deaths = stuck; progressing = not)', hintRows);
  // QUALITY
  const qRows = [];
  for (const c of Q_CASES) { const [, j] = await call('QUALITY_DIRECTOR', c.s); const r = C.SETS.QUALITY_DIRECTOR.interpret(j.ok ? j.answers : null, C.prepare('QUALITY_DIRECTOR', c.s).s); qRows.push({ case: c.name, preset: r.preset, focus: r.focus, src: r.src }); ok(c.want.includes(r.preset), `QUALITY "${c.name}" → ${r.preset}/${r.focus}`); }
  // PRELOAD
  const pRows = [];
  for (const c of PRE_CASES) { const [, j] = await call('PRELOAD', c.s); const r = C.SETS.PRELOAD.interpret(j.ok ? j.answers : null, C.prepare('PRELOAD', c.s).s); pRows.push({ stage: c.s.stage, zone: r.zone, src: r.src }); ok(c.want.includes(r.zone), `PRELOAD stage ${c.s.stage} → ${r.zone}`); }
  // CONTACT_INTENT (INT-CONTACT)
  const ctRows = []; let ctHits = 0;
  for (const c of CONTACT_CASES) {
    const [, j] = await call('CONTACT_INTENT', c.s); const r = C.SETS.CONTACT_INTENT.interpret(j.ok ? j.answers : null, C.prepare('CONTACT_INTENT', c.s).s);
    const hit = c.want.includes(r.intent); ctHits += hit;
    ctRows.push({ case: c.name, intent: r.intent, conf: j.answers && j.answers.intent && +j.answers.intent.confidence.toFixed(2), src: r.src, hit });
  }
  ok(ctHits >= 4, `CONTACT_INTENT accuracy ${ctHits}/${CONTACT_CASES.length}`, ctRows);
  // cache replay (0 upstream calls)
  const before = calls, hitLat = [];
  for (const [p] of ORM_CASES.slice(0, 5)) { const [, j] = await post(port, { set: 'ORM_TALK', state: { phrase: p + '  ', ...base } }); if (j.meta && j.meta.cached) hitLat.push(j.meta.ms); }
  ok(hitLat.length === 5 && calls === before, 'cache: 5/5 replays served from cache (phrase normalised)', { p50ms: pct(hitLat, 0.5) });
  // parallel burst (director + creature + quality at once, like one busy frame)
  const t0 = Date.now();
  await Promise.all([call('DIRECTOR', { ...DIR_CASES[0].s, sinceEvent: 400 }), call('CREATURE', { ...CREATURE_CASES[1], activity: 'walking' }), call('QUALITY_DIRECTOR', { ...Q_CASES[1].s, preset: 'high' })]);
  const burst = Date.now() - t0;
  await sleep(2200); srv.flushCache();
  const st = srv.stats();
  const inTok = tokens.reduce((a, b) => a + b, 0);
  R.real = {
    upstreamCalls: calls, inputTokens: inTok, usd: +(inTok * USD_PER_INPUT_TOKEN).toFixed(6), latencyMs: { p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: Math.max(...lat) }, cacheHitMs: { p50: pct(hitLat, 0.5) }, parallelBurstMs: burst,
    tokensPerCall: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)])),
    usdPerCall: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length * USD_PER_INPUT_TOKEN).toFixed(7)])),
    orm: ormRows, commands: cmdRows, director: dirRows, creature: crRows, hints: hintRows, quality: qRows, preload: pRows, contact: ctRows, serverStats: st.sets,
  };
  console.log(`\n  upstream calls ${calls} · input tokens ${inTok} · $${R.real.usd} · p50 ${R.real.latencyMs.p50} ms · p95 ${R.real.latencyMs.p95} ms · cache hit p50 ${R.real.cacheHitMs.p50} ms · 3-set burst ${burst} ms`);
  console.log('  tokens/call', R.real.tokensPerCall);
  await srv.close();
}

const outFile = R.real ? 'results.json' : 'results-offline.json'; // never clobber the real-API record with an offline run
fs.writeFileSync(path.join(HERE, outFile), JSON.stringify(R, null, 1));
console.log(`\n${pass} passed, ${fail} failed → tests/${outFile}`);
process.exit(fail ? 1 : 0);
