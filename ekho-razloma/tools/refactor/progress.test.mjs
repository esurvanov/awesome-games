// Browser-free test of modules/progress.js (the save format). node tools/refactor/progress.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const plain = (x) => JSON.parse(JSON.stringify(x));   // objects made inside the vm context differ by prototype only
const win = {}; vm.runInNewContext(fs.readFileSync(new URL('../../modules/progress.js', import.meta.url), 'utf8'), { window: win, console: { warn() {} } });
const P = win.Progress;
const G = { mode: 'play', stage: 4, hasTool: true, hasCell: true, shards: [1, 5, 9], echoes: [0, 2], cleared: ['lake'], deaths: 2, time: 123.5, checkpoint: 'station', ending: null };
const scene = { parts: [true, false, true], fox: true, pos: [10.5, -20.25], sk: true, bossDead: false };
const rec = P.record(G, scene);
assert.deepEqual(plain(Object.keys(rec)), ['v', 'stage', 'hasTool', 'hasCell', 'parts', 'shards', 'echoes', 'cleared', 'deaths', 'fox', 'time', 'pos', 'sk', 'bossDead', 'ending', 'cp']);   // the v1 format, same key order as before the move
assert.equal(rec.v, 1); assert.equal(rec.cp, 'station'); assert.deepEqual(plain(rec.parts), [true, false, true]);
// round trip
const H = { mode: 'menu', stage: 0, hasTool: false, hasCell: false, shards: [], echoes: [], cleared: [], deaths: 0, time: 0, checkpoint: null, ending: 'x' };
const back = P.apply(H, JSON.parse(JSON.stringify(rec)));
assert.deepEqual(plain({ ...H, mode: G.mode }), plain(G)); assert.deepEqual(plain(back), { parts: [true, false, true], fox: true, sk: true, bossDead: false, pos: [10.5, -20.25] });
// legacy save without cp / cleared / ending / pos / parts
const old = {}; const L = { stage: 0, hasTool: false, hasCell: false };
const lb = P.apply(L, { v: 1, stage: 3, hasTool: true, hasCell: true, shards: [2] });
assert.equal(L.stage, 3); assert.equal(L.checkpoint, 'crash'); assert.equal(L.ending, null); assert.deepEqual(plain(L.cleared), []); assert.equal(L.deaths, 0); assert.equal(L.time, 0);
assert.deepEqual(plain(lb), { parts: [], fox: false, sk: false, bossDead: false, pos: null });
// rules
assert.equal(P.hpMax([]), 5); assert.equal(P.hpMax(new Array(5)), 5); assert.equal(P.hpMax(new Array(6)), 6); assert.equal(P.hpMax(new Array(24)), 9);
assert.equal(P.canSave({ mode: 'play', stage: 8 }), true); assert.equal(P.canSave({ mode: 'play', stage: 9 }), false); assert.equal(P.canSave({ mode: 'menu', stage: 2 }), false);
assert.equal(P.KEY, 'eor-save'); assert.equal(P.ENDINGS_KEY, 'eor-endings');
// state: progress and session behind one object
const S = P.createState();
assert.equal(S.mode, 'menu'); assert.equal(S.stage, 0); assert.equal(S.aurora, 1); assert.equal(S.echoRead, -1); assert.equal(S.checkpoint, undefined);
S.stage = 4; S.riding = true; S.heartRise = true; S.shards.push(3);
assert.equal(S.progress.stage, 4); assert.equal(S.session.riding, true); assert.equal(S.session.heartRise, true); assert.equal(S.progress.riding, undefined); assert.deepEqual(plain(S.progress.shards), [3]);
assert.deepEqual(plain(P.unclassified(S)), []); S.surprise = 1; assert.deepEqual(plain(P.unclassified(S)), ['surprise']);
const rec2 = P.record(S, { parts: [], fox: false, pos: [0, 0], sk: false, bossDead: false });
for (const k of P.SESSION_KEYS) assert.ok(!(k in rec2), 'session key in the save: ' + k);   // the save never carries session state
assert.equal(new Set([...P.PROGRESS_KEYS, ...P.SESSION_KEYS]).size, P.PROGRESS_KEYS.length + P.SESSION_KEYS.length);   // a key is in one list only
// persist registry: owners register what they save and load; record merges, restore runs in order, a failing loader does not stop the others
const trace = []; const Q = win.Progress;
Q.persist('pos', { order: 50, save: () => [1.5, 2.5], load: (v) => trace.push('pos:' + JSON.stringify(v)) });
Q.persist('fox', { order: 10, save: () => true, load: (v) => trace.push('fox:' + v) });
Q.persist('parts', { order: 20, save: () => [true, false, true], load: (v) => trace.push('parts:' + JSON.stringify(v)) });
Q.persist('boom', { order: 15, load: () => { throw new Error('x'); } });
Q.persist('sk', { order: 10, save: () => false, load: (v) => trace.push('sk:' + v) });
Q.persist('bossDead', { order: 10, save: () => true, load: (v) => trace.push('boss:' + v) });
Q.persist('hpMax', { order: 40, load: () => trace.push('hp') });
const coll = Q.collect(); assert.deepEqual(Object.keys(plain(coll)).sort(), ['bossDead', 'fox', 'parts', 'pos', 'sk']);
const rec3 = Q.record(Q.createState());   // default scene = collect()
assert.deepEqual(plain(Object.keys(rec3)), ['v', 'stage', 'hasTool', 'hasCell', 'parts', 'shards', 'echoes', 'cleared', 'deaths', 'fox', 'time', 'pos', 'sk', 'bossDead', 'ending', 'cp']);
assert.deepEqual(plain(rec3.parts), [true, false, true]); assert.equal(rec3.fox, true); assert.deepEqual(plain(rec3.pos), [1.5, 2.5]); assert.equal(rec3.sk, false); assert.equal(rec3.bossDead, true);
const H3 = Q.createState(); Q.restore(H3, plain(rec3));
assert.deepEqual(trace, ['fox:true', 'sk:false', 'boss:true', 'parts:[true,false,true]', 'hp', 'pos:[1.5,2.5]']);   // by order, then registration; the failing one in between was skipped quietly
console.log('progress: 12 checks + 8 state checks + 8 owner checks pass');
