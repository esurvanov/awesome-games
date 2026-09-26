// G3 sim: naval / defense / orders / match / market / stats / savegame against the Python modules
// (fixtures from web/tests/gen_G3-sim_ref.py), plus relics and a savegame round trip.
//   node --import ./web/tests/stub_loader.mjs --test web/tests/test_G3-sim.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ROOT } from './node_env.mjs';

await setup();
await import('../src/_data_init.js');
const py = await import('../runtime/py.js');
const naval = await import('../src/naval.js');
const defense = await import('../src/defense.js');
const orders = await import('../src/orders.js');
const match = await import('../src/match.js');
const market = await import('../src/market.js');
const stats = await import('../src/stats.js');
const savegame = await import('../src/savegame.js');
const relics = await import('../src/relics.js');
const world = await import('../src/world.js');
const data = await import('../src/data.js');
py.register_modules({ world, data, relics, defense, naval, orders, match, stats, savegame, market });

const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/tests/fixtures/G3-sim_ref.json'), 'utf8'));
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

class FW {
    constructor(W, H, map_type, teams) {
        this.W = W; this.H = H; this.map_type = map_type;
        this.terrain = Array.from({ length: H }, () => new Array(W).fill(0));
        this.occ = Array.from({ length: H }, () => new Array(W).fill(null));
        this.players = teams.map(t => ({ team: t }));
        this.nodes = [];
    }
}

test('naval: gen_water / place_fish / comps / shores / find_path_water match Python', () => {
    for (const c of REF.water) {
        py.random.seed(c.seed);
        const w = new FW(c.W, c.W, c.map_type, c.teams);
        naval.gen_water(w, c.starts, c.slot_ang, c.R);
        naval.place_fish(w, c.starts, c.fwd);
        const terr = w.terrain.map(r => r.join(''));
        let diff = 0;
        for (let y = 0; y < c.W; y++) for (let x = 0; x < c.W; x++) if (terr[y][x] !== c.terrain[y][x]) diff++;
        assert.equal(diff, 0, `terrain differs in ${diff} tiles (seed ${c.seed} ${c.map_type})`);
        assert.deepEqual(w.nodes.map(n => [n.kind, n.tx, n.ty]), c.fish, 'fish');
        const [lc, wc, wsize] = naval.comps(w);
        assert.deepEqual(lc, c.lc);
        assert.deepEqual(wc, c.wc);
        assert.deepEqual(Array.from(wsize.entries()).sort((a, b) => a[0] - b[0]), c.wsize);
        const sh = naval.shores(w);
        assert.equal(sh.length, c.shores);
        assert.deepEqual(sh.slice(0, 20), c.shores_head);
        assert.deepEqual(naval.find_path_water(w, c.a, [c.b], c.b[0], c.b[1]), c.path);
        assert.deepEqual(c.starts.map(([x, y]) => naval.nearest_water_tile(w, x, y)), c.near);
        assert.equal(py.random.random(), c.after, 'random stream position');
    }
});

test('defense.line_tiles', () => {
    for (const [a, want] of REF.line_tiles) assert.deepEqual(defense.line_tiles(...a), want);
});

test('orders.layout / _rows match Python', () => {
    for (const [n, f, want] of REF.rows) assert.equal(orders._rows(n, f), want);
    for (const c of REF.layout) {
        const us = c.units.map(([x, y, radius, cls]) => ({ x, y, radius, cls, speed: () => 1 }));
        const out = orders.layout(us, 640.0, 320.0, c.form);
        assert.equal(out.length, c.out.length, c.form);
        out.forEach(([u, x, y], i) => {
            const [wi, wx, wy] = c.out[i];
            assert.equal(us.indexOf(u), wi, `${c.form} unit order at ${i}`);
            assert.ok(close(x, wx) && close(y, wy), `${c.form} slot ${i}: ${x},${y} vs ${wx},${wy}`);
        });
    }
});

test('market prices', () => {
    const p = { res: { food: 1000, wood: 1000, gold: 5000, stone: 1000 }, id: 0,
        stat: (stat, kind, base) => (stat === 'market_fee' ? 0.15 : base) };
    const seq = [];
    for (const r of ['food', 'wood', 'stone', 'food', 'food']) {
        seq.push([market.buy_price(p, r), market.sell_price(p, r)]);
        market._shift(p, r, market.PRICE_STEP);
    }
    for (let i = 0; i < 40; i++) market._shift(p, 'stone', -market.PRICE_STEP);
    seq.push([market.buy_price(p, 'stone'), market.sell_price(p, 'stone')]);
    assert.deepEqual(seq, REF.market.seq);
    assert.equal(market.tribute_cost(p, 100), REF.market.tribute_cost);
    assert.deepEqual(market.prices(p), REF.market.prices);
});

test('stats: init / explore / sample / value', () => {
    const c = REF.stats;
    const w = { W: 70, H: 70, players: [0, 1, 2], human: 0, time: 12.34, buildings: [] };
    w.units = c.units.map(([owner, x, y, los, kind]) => ({ owner, x, y, kind, los: () => los, d: { civil: kind === 'trade_cart' } }));
    w.explored = new Uint8Array(70 * 70);
    for (let i = 0; i < 70 * 70; i += 3) w.explored[i] = 1;
    stats.init(w);
    stats.explore(w);
    assert.deepEqual(w.explore_grid.map(g => Array.from(g)), c.grids);
    w.stats.forEach((s, i) => {
        const want = c.stats[i];
        for (const k of Object.keys(want)) {
            if (k === 'explored') assert.ok(close(s[k], want[k]), k);
            else assert.deepEqual(s[k], want[k], k);
        }
    });
    for (const [k, v] of REF.value) assert.equal(stats.value(k), v, k);
});

test('match: teams, defaults, map side, ages', () => {
    for (const [seed, a, b, after] of REF.teams) {
        py.random.seed(seed);
        assert.deepEqual(match.resolve_teams([5, 5, 5, 5]), a);
        assert.deepEqual(match.resolve_teams([0, 5, 2, 5, 1]), b);
        assert.equal(py.random.random(), after);
    }
    for (const [r, v] of REF.teams_valid) assert.equal(match.teams_valid(r), v);
    assert.deepEqual(match.defaults(), REF.defaults);
    assert.deepEqual(match.normalize({ pop: 75, bogus: 1, speed: 2.0 }), REF.normalize);
    for (const [s, n, v] of REF.map_side) assert.equal(match.map_side(s, n), v);
    for (const [s, a, m] of REF.ages) {
        assert.equal(match.start_age(s), a);
        assert.equal(match.max_age(s), m);
    }
    assert.equal(py.get(match.LEVEL_OF_DIFF, 1, 2), 2);
});

test('savegame: slot_path, registry, round trip', () => {
    for (const [s, rel] of REF.slot_path) assert.equal(savegame.slot_path(s), savegame.SAVE_DIR + '/' + rel);
    // static tables are saved by address and resolved to the same objects
    const u = data.UNITS.villager;
    const obj = { d: u, hooks: data.WORLD_HOOKS.tick, own: { a: [1, 2, { b: 3 }] }, fn: relics.tick, cls: world.Unit };
    obj.self = obj;
    const back = savegame.loads(savegame.dumps(obj));
    assert.equal(back.d, u);
    assert.equal(back.hooks, data.WORLD_HOOKS.tick);
    assert.equal(back.fn, relics.tick);
    assert.equal(back.cls, world.Unit);
    assert.equal(back.self, back);
    assert.deepEqual(back.own, obj.own);
    // relics are registered classes
    const r = new relics.Relic(100.5, 40);
    const r2 = savegame.loads(savegame.dumps({ r })).r;
    assert.ok(r2 instanceof relics.Relic);
    assert.equal(r2.tx, 3);
    assert.equal(r2.kind, 'relic');
    assert.ok(r2.free);
    assert.deepEqual(savegame.list_slots(), []);
});

test('relics.register hooks into the tables', () => {
    relics.register();
    assert.ok(data.WORLD_HOOKS.tick.includes(relics.tick));
    assert.equal(data.UNITS.monk.states.relic_pick, relics._st_pick);
});
