// Whole AI-vs-AI matches (World + AI) in lockstep with CPython: every STEP-th simulation step the state digest
// (random stream, exact unit coordinates and hp, resources) must hash to the value recorded by
// web/tests/gen_lockstep_ref.py. A mismatch means a behaviour difference in the simulation or the AI port.
//
// Transcendental functions (sin, cos, atan2, exp, ...) are not correctly rounded in libm nor in V8, so both sides round
// their results to float32 for this test (below, before any game module loads); every other operation is exact.
//   node --test web/tests/test_lockstep.mjs            (~30 s)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

for (const n of ['sin', 'cos', 'tan', 'atan2', 'atan', 'exp', 'log', 'log2', 'log10', 'acos', 'asin', 'sinh', 'cosh',
    'tanh', 'log1p', 'expm1']) {
    const f = Math[n];
    Math[n] = (...a) => Math.fround(f(...a));
}
// game modules are imported only after the patch (py.math captures Math.* when it is created)
const { setup } = await import('./node_env.mjs');
await setup();
await import('../src/_all.js');
const py = await import('../runtime/py.js');
const { World } = await import('../src/world.js');
const { AI } = await import('../src/ai.js');

const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/lockstep_ref.json', import.meta.url), 'utf8'));

const F = v => py.repr(v);

function digest(w) {
    const st = py.random.getstate()[1];
    let s = 0;
    for (let k = 0; k < 624; k++) s += st[k];
    const rs = (s + st[624] * 7) % 4294967296;
    const ux = w.units.map(u => `${u.kind}:${F(u.x)},${F(u.y)},${F(u.hp)}`).join(';');
    const res = [];
    for (const p of w.players) for (const v of Object.values(p.res)) res.push(F(py.round(v, 3)));
    return `${rs}|${w.units.length}|${w.buildings.length}|${ux}|${res.join(',')}`;
}

/** tools/sim.py make_world */
function make_world(n, mode, diff, map_type) {
    let teams;
    if (mode === 'teams') {
        const half = Math.max(1, Math.floor(n / 2));
        teams = py.range(n).map(i => (i < half ? 0 : 1));
    } else if (mode === 'vs' || mode === 'passive') teams = [0, ...new Array(n - 1).fill(1)];
    else teams = py.range(n);
    const ai_players = mode === 'passive' ? py.range(1, n) : py.range(n);
    const w = new World(diff, n, teams, py.range(1, n), new Array(n).fill('random'), null, map_type);
    w.ais = ai_players.map(pid => new AI(w, pid, diff));
    return w;
}

for (const sc of REF.scenarios) {
    test(`lockstep ${sc.name}: ${sc.players} players, ${sc.map}, ${sc.hashes.length} digests`, () => {
        py.random.seed(sc.seed);
        const w = make_world(sc.players, sc.mode, sc.diff, sc.map);
        let k = 0;
        for (let i = 0; i < sc.steps; i++) {
            w.update(0.034);
            w.events.length = 0;
            if (i % REF.step === 0) {
                const h = crypto.createHash('md5').update(digest(w)).digest('hex').slice(0, 12);
                assert.equal(h, sc.hashes[k], `state differs from Python at step ${i} (${(w.time / 60).toFixed(2)} game min)`);
                k++;
            }
            if (w.winner != null) break;
        }
        assert.equal(k, sc.hashes.length, 'the match ended at a different step');
    });
}
