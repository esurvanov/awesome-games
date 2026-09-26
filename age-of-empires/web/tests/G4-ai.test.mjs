// G4 ai: checks the JS ports of ai, ai_war, ai_defense, eco_ai against the Python modules (mock objects, no World).
// Reference: web/tests/fixtures/G4_ai.json (SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G4_ai_ref.py).
// Run: node --import ./web/tests/stub_loader.mjs --test web/tests/G4-ai.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './node_env.mjs';
import * as py from '../runtime/py.js';
import { random } from '../runtime/py.js';

await setup();
const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/G4_ai.json', import.meta.url), 'utf8'));
let data_ok = true;
try {
    await import('../src/_data_init.js');
} catch (e) {
    try {
        await import('../src/content/__init__.js');     // i18n not ported yet: labels are irrelevant here
    } catch (e2) {
        data_ok = false;   // content not ported yet: data-dependent checks are skipped
    }
}
const ai_mod = await import('../src/ai.js');
const ai_war = await import('../src/ai_war.js');
const ai_defense = await import('../src/ai_defense.js');
const eco_ai = await import('../src/eco_ai.js');
await import('../src/ai_army.js');
await import('../src/naval_ai.js');

const close = (a, b, msg) => {
    if (typeof a === 'number' && typeof b === 'number') {
        assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);
    } else if (Array.isArray(b)) {
        assert.equal(a.length, b.length, msg);
        b.forEach((x, i) => close(a[i], x, `${msg}[${i}]`));
    } else if (b !== null && typeof b === 'object') {
        assert.deepEqual(Object.keys(a), Object.keys(b), msg);
        for (const k of Object.keys(b)) close(a[k], b[k], `${msg}.${k}`);
    } else {
        assert.equal(a, b, msg);
    }
};

function mk_world() {
    const W = 40, H = 40;
    const terrain = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ((x - 20) ** 2 + (y - 5) ** 2 < 30 ? 1 : 0)));
    const occ = Array.from({ length: H }, () => new Array(W).fill(null));
    const floor = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => ((x * 13 + y * 7) % 23 === 0 ? 'f' : null)));
    const can_place = (kind, tx, ty, pid, check_explored = true) => 0 <= tx && tx < W - 3 && 0 <= ty && ty < H - 3 && (tx * 7 + ty * 3) % 5 !== 0;
    return { W, H, terrain, occ, floor, can_place, time: 500.0 };
}

function bare_ai(w, level) {
    const a = Object.create(ai_mod.AI.prototype);
    a.w = w;
    a.pid = 1;
    a.level = level;
    a.diff = ai_mod.TIER_OF_LEVEL[level];
    a.prof = ai_mod.LEVELS[level];
    a.naval = null;
    a.bad_nodes = new Map();
    return a;
}

test('LEVELS match Python (lerp, banker rounding, _stronger)', () => {
    close(ai_mod.LEVELS, REF.LEVELS, 'LEVELS');
});

test('find_spot: same spots and random stream', () => {
    const res = [];
    for (const seed of [1, 2, 3]) {
        random.seed(seed);
        const w = mk_world();
        const a = bare_ai(w, 3);
        for (const [kind, cx, cy, rmin, rmax, margin] of [['house', 20, 20, 4, 13, true], ['farm', 10, 30, 2, 7, false],
            ['town_center', 25, 25, 3, 6, true], ['mill', 5, 5, 1, 6, false], ['house', 20, 8, 0, 3, true]]) {
            res.push(a.find_spot(kind, cx, cy, rmin, rmax, margin));
        }
        res.push(random.random());
    }
    close(res, REF.find_spot, 'find_spot');
});

test('plan_want: villager shares', () => {
    const cost_of = (cat, name) => ({ feudal: { food: 500 }, castle: { food: 800, gold: 200 },
        imperial: { food: 1000, gold: 800 } })[name] ?? { wood: 50 };
    const res = [];
    for (let level = 0; level < 6; level++) {
        for (let age = 0; age < 4; age++) {
            for (const nv of [8, 20, 40]) {
                for (const rsv of [{}, { food: 800, gold: 200 }]) {
                    const w = mk_world();
                    w.time = 300.0 + 100 * age;
                    w.animals = [0, 1, 2].map(i => ({ alive: true, owner: -1, x: 600.0 + 10 * i, y: 820.0, amount: 100 }))
                        .concat([{ alive: true, owner: 0, x: 900.0, y: 900.0, amount: 100 }]);
                    w.nodes = [{ alive: true, kind: 'berries', tx: 18, ty: 24, amount: 125 },
                        { alive: true, kind: 'gold', tx: 21, ty: 26, amount: 800 },
                        { alive: false, kind: 'berries', tx: 19, ty: 24, amount: 125 }];
                    const a = bare_ai(w, level);
                    a.p = { age, res: { food: 120 + 300 * age, wood: 500, gold: 50 + 400 * age, stone: 900 }, cost_of };
                    a.army = { expected_cost: () => ({ food: 0.4, wood: 0.2, gold: 0.4 }) };
                    a.base = { center: () => [640.0, 800.0] };
                    a.max_vils = a.prof['vils'][age];
                    a.blocked = { wood: 150, stone: 100 };
                    a.blocked_t = nv === 20 ? w.time - 10 : -99.0;
                    a.goal = age === 1 ? { food: 100, gold: 50 } : {};
                    const count = new py.Counter({ farm: 3, castle: 0, town_center: 1 });
                    res.push(a.plan_want(nv, rsv, nv === 40 ? [1, 2] : [1], count));
                }
            }
        }
    }
    close(res, REF.plan_want, 'plan_want');
});

test('helpers: centroid, ring_plan, _invest_ok, _spend_ok', () => {
    const pts = [[[1, 5], [3, 2], [2, 9]], [[4.5, 1.0], [0.5, 7.0], [2.0, 2.0], [9.0, 3.0]], [[7, 7]]];
    close(pts.map(ps => ai_war.WarPlanner.centroid(ps.map(([x, y]) => ({ x, y })))), REF.centroid, 'centroid');
    close(ai_defense.ring_plan(null, { tx: 10, ty: 12, w: 4, h: 4 }), REF.ring_plan, 'ring_plan');
    const p = { res: { food: 400, wood: 100, gold: 300, stone: 0 } };
    p.afford = c => Object.entries(c).every(([k, v]) => p.res[k] >= v);
    close([[{ food: 50 }, { food: 450 }], [{ food: 50 }, { food: 360 }], [{ wood: 90 }, {}], [{ wood: 190 }, {}],
        [{ gold: 100 }, { gold: 250 }]].map(([c, r]) => eco_ai._invest_ok(p, c, r)), REF.invest, 'invest');
    close([[{ food: 50 }, { food: 350 }], [{ food: 50 }, { food: 351 }]].map(([c, r]) => eco_ai._spend_ok(p, c, r)), REF.spend, 'spend');
});

test('WarPlanner.choose_obj priorities and sweep', () => {
    const mk_bld = (kind, owner, cx, cy, d = {}) => ({ kind, owner, alive: true, d, center: () => [cx, cy],
        dist_px: (x, y) => ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 });
    const blds = [mk_bld('house', 2, 1000.0, 1000.0), mk_bld('barracks', 2, 1100.0, 900.0, { trains: ['militia'] }),
        mk_bld('town_center', 2, 1500.0, 1500.0), mk_bld('tower', 2, 1400.0, 1300.0),
        mk_bld('farm', 2, 900.0, 950.0), mk_bld('mill', 3, 950.0, 950.0), mk_bld('palisade_wall', 2, 990.0, 990.0, { wall: true })];
    const res = [];
    for (const [tgt, cx, cy] of [[2, 900.0, 900.0], [null, 900.0, 900.0], [2, 1450.0, 1350.0], [3, 0.0, 0.0]]) {
        const w = { hmat: [[0, 0, 1, 1], [0, 0, 1, 1]], players: [0, 1, 2, 3].map(i => ({ id: i, alive: true })),
            buildings: blds, units: [], time: 100.0 };
        const a = bare_ai(w, 3);
        a.target = tgt;
        const wp = new ai_war.WarPlanner(a);
        const obj = wp.choose_obj(cx, cy);
        res.push([obj != null ? blds.indexOf(obj) : -1, wp.hunt]);
    }
    close(res, REF.choose_obj, 'choose_obj');
});

test('ai_war.value for every unit (needs ported content)', { skip: !data_ok && 'content not ported yet' }, () => {
    for (const k of Object.keys(REF.value)) close(ai_war.value(k), REF.value[k], `value(${k})`);
});
