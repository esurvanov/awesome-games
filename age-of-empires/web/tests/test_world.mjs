// G2 world: compares web/src/world.js with the Python game/world.py (fixtures: gen_world_ref.py).
//   node --import ./web/tests/stub_loader.mjs --test web/tests/test_world.mjs      (while other modules are unported)
//   node --test web/tests/test_world.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ROOT } from './node_env.mjs';
import * as py from '../runtime/py.js';

await setup();
py.os.environ.KHRONIKI_LANG = 'en';     // gen_world_ref.py runs with the English UI
const src = m => path.join(ROOT, 'web', 'src', m + '.js');
const have = (...ms) => ms.every(m => fs.existsSync(src(m)));
// `import game.data` (with relabel) when i18n is ported; otherwise data + content only
if (have('i18n')) await import('../src/_data_init.js');
else { await import('../src/data.js'); await import('../src/content/__init__.js'); }
const world = await import('../src/world.js');
const data = await import('../src/data.js');
const { World, Unit, TILE } = { ...world, TILE: 32 };
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'tests', 'fixtures', 'world_ref.json'), 'utf8'));

function bare_world(desc) {
    const w = Object.create(World.prototype);
    w.W = desc.W;
    w.H = desc.H;
    w.terrain = desc.terrain.map(r => r.slice());
    w.occ = Array.from({ length: w.H }, () => new Array(w.W).fill(null));
    w.gate = Array.from({ length: w.H }, () => new Array(w.W).fill(null));
    w.floor = Array.from({ length: w.H }, () => new Array(w.W).fill(null));
    for (const [x, y] of desc.blocks) w.occ[y][x] = {};
    for (const [x, y, progress, owner] of desc.gates) {
        const g = { progress, owner };
        w.occ[y][x] = g;
        w.gate[y][x] = g;
    }
    w.players = desc.teams.map(t => ({ team: t }));
    w.time = 0.0;
    w.treaty_end = 0.0;
    w.update_teams();
    return w;
}

test('find_path / nearest_free_tile / passable_for / team matrices', () => {
    for (const c of REF.paths) {
        const w = bare_world(c.world);
        for (let a = -1; a < c.hmat.length - 1; a++) {
            for (let b = -1; b < c.hmat.length - 1; b++) {
                assert.equal(w.hmat[a][b], c.hmat.at(a).at(b));
                assert.equal(w.amat[a][b], c.amat.at(a).at(b));
            }
            assert.equal(w.beast_row[a], c.beast_row.at(a));
        }
        for (const q of c.queries) {
            const p = w.find_path(q.start, q.goals, q.h[0], q.h[1], q.limit, q.owner);
            assert.deepEqual(p, q.path, JSON.stringify(q.start) + ' -> ' + JSON.stringify(q.h));
            assert.equal(w.path_reached, q.reached);
        }
        for (const [x, y, o, want] of c.passable_for) assert.equal(!!w.passable_for(x, y, o), want, `${x},${y},${o}`);
    }
});

test('nearest_free_tile', () => {
    for (const c of REF.paths) {
        const w = bare_world(c.world);
        for (const [x, y, maxr, want] of c.nft) assert.deepEqual(w.nearest_free_tile(x, y, maxr), want, `${x},${y},${maxr}`);
    }
});

test('separate (push-apart, calm bookkeeping, random push order)', () => {
    for (const c of REF.separate) {
        const w = bare_world({ ...c.world, blocks: c.world.blocks, gates: [] });
        const units = c.units.map(d => {
            const u = Object.create(Unit.prototype);
            Object.assign(u, { x: d.x, y: d.y, radius: d.radius, owner: d.owner, state: d.state, path: d.path });
            if (!d.packed) u.packed = false;
            return u;
        });
        w.units = units;
        w.animals = [];
        w._sep_grid = null;
        w._sep_moved = null;
        w._sep_pass = 0;
        py.random.seed(c.seed);
        for (let k = 0; k < c.steps.length; k++) {
            w.separate();
            const want = c.steps[k];
            units.forEach((u, i) => {
                assert.ok(Math.abs(u.x - want[i][0]) < 1e-9 && Math.abs(u.y - want[i][1]) < 1e-9,
                    `step ${k} unit ${i}: ${u.x},${u.y} vs ${want[i]}`);
                assert.equal(u._sep_clear, want[i][2]);
            });
            if (k === 2) units[3].x += 5.0;
        }
    }
});

test('update_fog', () => {
    for (const c of REF.fog) {
        const w = bare_world({ ...c.world, blocks: [], gates: [] });
        w.human = 0;
        w.explored = new Uint8Array(w.W * w.H);
        w.vis = new Uint8Array(w.W * w.H);
        w._fog_srcs = null;
        w.fog_version = 0;
        w.reveal = 'normal';
        w.units = c.units.map(d => ({ x: d.x, y: d.y, owner: d.owner, los: () => d.los }));
        w.buildings = c.buildings.map(d => ({ ...d, seen: false, los: () => d.los }));
        const L = c.buildings.map(d => d.los);
        w.buildings.forEach((b, i) => { b.los = () => L[i]; });
        w.animals = c.animals.map(d => ({ ...d, los: () => d.los }));
        w.update_fog();
        assert.deepEqual(Array.from(w.vis), c.vis1);
        assert.deepEqual(Array.from(w.explored), c.exp1);
        assert.deepEqual(w.buildings.map(b => b.seen), c.seen1);
        w.units.forEach((u, i) => { u.x = c.moved_x[i]; });
        w.update_fog();
        assert.deepEqual(Array.from(w.vis), c.vis2);
        assert.deepEqual(Array.from(w.explored), c.exp2);
        assert.deepEqual(w.buildings.map(b => b.seen), c.seen2);
        assert.equal(w.fog_version, c.fog_version);
    }
});

const content_complete = fs.readdirSync(path.join(ROOT, 'game', 'content'))
    .filter(f => f.endsWith('.py') && f !== '__init__.py')
    .every(f => fs.existsSync(path.join(ROOT, 'web', 'src', 'content', f.replace('.py', '.js'))));

test('civ_bans', { skip: !content_complete && 'content/* not fully ported yet' }, () => {
    const key = x => JSON.stringify(x);
    for (const [name, want] of Object.entries(REF.civ_bans)) {
        assert.deepEqual(py.sorted(Array.from(world.civ_bans(name), key)), want.bans, name);
        assert.deepEqual(py.sorted(Array.from(world.civ_bans(name, true), key)), want.full, name + ' full');
    }
});

test('Player: civ effects, cost_of, time_of, stat, unit_tags', { skip: !(content_complete && have('i18n')) && 'content/i18n not ported yet' }, () => {
    for (const [name, want] of Object.entries(REF.player)) {
        py.random.seed(1);
        const p = new world.Player(1, undefined, undefined, undefined, true, name);
        p.add_effects([{ stat: 'gather', mul: 1.3 }]);
        const tabs = [['unit', data.UNITS], ['bld', data.BUILDINGS], ['tech', data.TECHS]];
        const got = { civ: p.civ, res: p.res, name: p.name, cost: {}, time: {}, hp: {}, atk: {}, gather: {}, tags: {} };
        for (const [cat, tab] of tabs) {
            for (const [k, d] of Object.entries(tab)) {
                if ('cost' in d && (cat !== 'unit' || 'cls' in d)) got.cost[cat + ':' + k] = p.cost_of(cat, k);
                if ('time' in d && (cat !== 'unit' || 'cls' in d)) got.time[cat + ':' + k] = p.time_of(cat, k);
            }
        }
        for (const [k, d] of Object.entries(data.UNITS)) {
            if ('hp' in d) got.hp[k] = p.stat('hp', k, d.hp);
            got.atk[k] = p.stat('atk', k, py.get(d, 'atk', 0));
        }
        for (const r of ['food', 'wood', 'gold', 'stone']) {
            for (const s of ['farm', 'tree', 'hunt', 'berries', 'gold', 'stone', 'fish']) got.gather[r + ':' + s] = p.stat('gather', 'villager', 1.0, r, s);
        }
        for (const k of [...Object.keys(data.UNITS), ...Object.keys(data.BUILDINGS)]) got.tags[k] = world.unit_tags(k);
        close(got, want, name);
        assert.deepEqual(Object.keys(got.cost).sort(), Object.keys(want.cost).sort());
    }
});

// ---- whole worlds: legacy map generation + 600 simulation steps (needs every module the World touches)
const DEPS = ['i18n', 'match', 'terrain', 'stats', 'defense', 'orders', 'naval', 'maps', 'mapgen', 'market', 'relics',
    'themes', 'scoring', 'settings'];
const world_ready = (have(...DEPS) || process.env.WORLD_FORCE) && content_complete;

function dump_world(w, full = false) {
    return {
        W: w.W, H: w.H,
        terrain: full ? w.terrain.flat() : null,
        starts: w.starts,
        nodes: w.nodes.map(n => [n.kind, n.tx, n.ty, n.var, n.amount]),
        units: w.units.map(u => [u.kind, u.owner, u.x, u.y, u.state, u.hp]),
        animals: w.animals.map(a => [a.kind, a.owner, a.x, a.y, a.state, a.hp, a.dead]),
        buildings: w.buildings.map(b => [b.kind, b.owner, b.tx, b.ty, b.w, b.h, b.hp, b.progress]),
        players: w.players.map(p => ({ civ: p.civ, res: p.res, pop: p.pop, cap: p.cap, age: p.age, team: p.team,
            gathered: p.gathered })),
        explored: w.explored.reduce((a, b) => a + b, 0), vis: w.vis.reduce((a, b) => a + b, 0),
        rand: py.random.random(),
    };
}
function close(a, b, where) {
    if (typeof a === 'number' && typeof b === 'number') {
        assert.ok(a === b || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${where}: ${a} vs ${b}`);
    } else if (Array.isArray(b)) {
        assert.ok(Array.isArray(a) && a.length === b.length, `${where}: length ${a && a.length} vs ${b.length}`);
        b.forEach((x, i) => close(a[i], x, where + '[' + i + ']'));
    } else if (b !== null && typeof b === 'object') {
        for (const k of Object.keys(b)) close(a[k], b[k], where + '.' + k);
    } else {
        assert.equal(a, b, where);
    }
}

async function register_deps() {
    const mods = {};
    for (const m of [...DEPS, 'data']) {
        if (fs.existsSync(src(m))) mods[m] = await import(src(m));
    }
    // WORLD_FORCE=1 before G1's themes.js exists: ground types are not compared, a fixed species is enough
    if (!mods.themes) mods.themes = { tree_species: () => 'oak', is_conifer: () => false, THEMES: {}, ARABIA_POOL: ['grass'] };
    mods.world = world;
    py.register_modules(mods);
}

test('World: legacy map generation and simulation match Python', { skip: !world_ready && 'dependencies not ported yet' }, async () => {
    await register_deps();
    for (const c of REF.worlds) {
        py.random.seed(c.seed);
        const k = c.kw;
        const w = new World(undefined, k.nplayers, k.teams ?? null, undefined, k.civs ?? null, undefined, k.map_type);
        close(dump_world(w, true), c.init, `seed ${c.seed} init`);
        for (const p of w.players) {
            const vils = w.units.filter(u => u.owner === p.id && u.kind === 'villager');
            const trees = w.nodes.filter(n => n.kind === 'tree');
            vils.forEach((v, i) => {
                if (i === 0 && trees.length) v.cmd_gather(py.min(trees, n => Math.abs(n.tx * TILE - v.x) + Math.abs(n.ty * TILE - v.y)));
                else if (i === 1) {
                    const sheep = w.animals.filter(a => a.kind === 'sheep' && a.owner === p.id);
                    if (sheep.length) v.cmd_gather(sheep[0]);
                }
            });
            const tc = w.buildings.find(b => b.owner === p.id && b.kind === 'town_center');
            tc.queue.push(['unit', 'villager']);
        }
        const scouts = w.units.filter(u => u.kind === 'scout');
        if (scouts.length >= 2) scouts[0].cmd_move(scouts[1].x, scouts[1].y);
        let si = 0;
        for (let step = 0; step < 2000; step++) {
            w.update(0.05);
            if (step % 400 === 399) {
                close(dump_world(w), c.snaps[si], `seed ${c.seed} step ${step}`);
                si++;
            }
        }
        close(w.events.slice(-30).map(e => e.map(x => (x == null || typeof x !== 'object') ? x : String(x))), c.events_tail,
            `seed ${c.seed} events`);
    }
});

test('World save round trip (pickle.js, __getstate__/__setstate__)', { skip: !world_ready && 'dependencies not ported yet' }, async () => {
    await register_deps();
    const pickle = await import('../runtime/pickle.js');
    const c = REF.worlds[0];
    py.random.seed(c.seed);
    const w = new World(undefined, c.kw.nplayers, null, undefined, c.kw.civs, undefined, c.kw.map_type);
    for (let i = 0; i < 100; i++) w.update(0.05);
    const w2 = pickle.loads(pickle.dumps(w));
    assert.ok(w2 instanceof World && w2 !== w);
    assert.equal(w2.hmat[-1], w2.hmat[w2.hmat.length - 1]);
    assert.equal(w2.amat[0][-1], false);
    assert.equal(w2.units[0].p, w2.players[w2.units[0].owner]);
    const st = py.random.getstate();
    for (let i = 0; i < 200; i++) w.update(0.05);
    const a = dump_world(w);
    py.random.setstate(st);
    for (let i = 0; i < 200; i++) w2.update(0.05);
    close(dump_world(w2), a, 'restored world');
});
