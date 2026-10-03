// Browser-free test of modules/progress.js (the save format). node tools/refactor/progress.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const plain = (x) => JSON.parse(JSON.stringify(x));   // objects made inside the vm context differ by prototype only
const win = {}; vm.runInNewContext(fs.readFileSync(new URL('../../modules/progress.js', import.meta.url), 'utf8'), { window: win });
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
console.log('progress: 12 checks pass');
