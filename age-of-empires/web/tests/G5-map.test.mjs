// G5 map: terrain.js / mapgen.js against the Python modules (fixture: web/tests/gen_G5-map_ref.py) + map_assets load.
//   node --import ./web/tests/stub_loader.mjs --test web/tests/G5-map.test.mjs
// world.js / maps.js are replaced by web/tests/G5-map_mock_world.mjs (the same mock the fixture generator uses),
// so the test checks mapgen/terrain logic and the exact random stream independently of the world port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import { setup } from './node_env.mjs';

const MOCK = new URL('./G5-map_mock_world.mjs', import.meta.url).href;
module.registerHooks({
    resolve(spec, ctx, next) {
        if (ctx.parentURL && /\/web\/src\/mapgen\.js$/.test(ctx.parentURL) && (spec === './world.js' || spec === './maps.js'))
            return { url: MOCK, shortCircuit: true };
        return next(spec, ctx);
    },
});

await setup();
const py = await import('../runtime/py.js');
const { random } = py;
const terrain = await import('../src/terrain.js');
const mapgen = await import('../src/mapgen.js');
const mock = await import('./G5-map_mock_world.mjs');
const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/G5-map_ref.json', import.meta.url), 'utf8'));

// themes / relics / defense mocks (same as the Python fixture generator)
const TH = REF.grass_theme;
function pick_species(weights, tx, ty) {
    if (!weights.length) return null;
    let rx = py.floordiv(tx, 7), ry = py.floordiv(ty, 7);
    if (terrain._hash(tx, ty, 5) % 4 === 0) { rx = py.floordiv(tx + 3, 7); ry = py.floordiv(ty + 3, 7); }
    let tot = 0; for (const [, v] of weights) tot += v;
    let r = terrain._hash(rx, ry, 1) % tot;
    let sp = weights[weights.length - 1][0];
    for (const [n, v] of weights) { if (r < v) { sp = n; break; } r -= v; }
    if (terrain._hash(tx, ty, 9) % 5 === 0) sp = weights[terrain._hash(tx, ty, 11) % weights.length][0];
    return sp;
}
py.register_modules({
    maps: mock,
    themes: {
        THEMES: { grass: {}, desert: {}, steppe: {}, snow: {}, tropical: {}, autumn: {} },
        ARABIA_POOL: ['grass', 'desert', 'steppe', 'snow', 'tropical', 'autumn'],
        tree_species: (w, tx, ty) => pick_species(TH.species, tx, ty),
        is_conifer: (w, sp) => TH.conifer.includes(sp),
    },
    relics: {
        spawn(w, tx, ty) {
            if (!w.passable(tx, ty) || w.occ[ty][tx] != null) [tx, ty] = w.nearest_free_tile(tx, ty);
            w.relics.push([tx, ty]);
            return [tx, ty];
        },
    },
    defense: { is_wall: b => b.kind === 'stone_wall' || b.kind === 'gate' },
});

const r6 = v => Math.round(v * 1e6) / 1e6;
function diffArr(name, got, want, tol = 0) {
    assert.equal(got.length, want.length, name + ' length');
    for (let i = 0; i < want.length; i++) {
        const ok = tol ? Math.abs(got[i] - want[i]) <= tol : py.eq(got[i], want[i]);
        if (!ok) assert.fail(`${name}[${i}]: got ${JSON.stringify(got[i])} want ${JSON.stringify(want[i])}`);
    }
}

test('terrain._hash / tree_species match Python', () => {
    let i = 0;
    for (let x = -20; x < 260; x += 7)
        for (let y = -10; y < 250; y += 9) {
            const [a, b, h] = REF.species[i++];
            assert.equal(terrain.tree_species(x, y), a);
            assert.equal(terrain.tree_species(x, y, ['oak', 'pine']), b);
            assert.equal(terrain._hash(x, y, 3), h);
        }
});

for (const c of REF.cases) {
    test(`mapgen ${c.mt} W=${c.W} teams=${c.teams} seed=${c.seed}`, () => {
        random.seed(c.seed);
        const w = new mock.FWorld(c.W, c.mt, c.teams);
        mapgen.generate(w);
        const o = c.out;
        assert.equal(w.theme, o.theme);
        diffArr('starts', w.starts, o.starts);
        diffArr('terrain', w.terrain.flat(), o.terrain);
        diffArr('nodes', w.nodes.map(n => [n.kind, n.tx, n.ty, n.amount, n.var]), o.nodes);
        diffArr('units', w.units.map(u => [u.kind, u.owner, u.x, u.y]), o.units);
        diffArr('animals', w.animals.map(a => [a.kind, a.owner, a.x, a.y]), o.animals);
        diffArr('buildings', w.buildings.map(b => [b.kind, b.owner, b.tx, b.ty, b.w, b.h]), o.buildings);
        diffArr('relics', w.relics, o.relics);
        diffArr('cliffs', w.cliffs, o.cliffs);
        diffArr('elev', Array.from(w.elev_map), o.elev);
        diffArr('ground', Array.from(w.ground), o.ground);
        diffArr('hz', w.hz.flat(), o.hz, 2e-6);
        assert.equal(w.relief, o.relief);
        assert.equal(!!w.nomad, o.nomad);
        diffArr('wood', w.players.map(p => p.res.wood), o.wood);
        assert.deepEqual(w.gen_opts, o.gen_opts);
        assert.equal(random.random(), o.next_random, 'random stream position after generation');
    });
}

for (const L of REF.legacy) {
    test(`terrain legacy ${L.mt} seed=${L.seed}`, () => {
        random.seed(L.seed);
        const w = new mock.FWorld(96, L.mt, [1, 2]);
        for (let y = 0; y < 96; y++)
            for (let x = 0; x < 96; x++)
                if ((L.mt === 'coast' && x > 70) || (x - 30) ** 2 + (y - 60) ** 2 < 60) w.terrain[y][x] = 1;
        const starts = [[20, 20], [60, 30]];
        w.starts = starts;
        for (let i = 0; i < 300; i++) {
            const x = random.randrange(96), y = random.randrange(96);
            if (w.terrain[y][x] === 0 && w.occ[y][x] == null) {
                const nd = new mock.Node(random.choice(['tree', 'tree', 'gold', 'stone']), x, y);
                w.nodes.push(nd);
                w.occ[y][x] = nd;
            }
        }
        w.gen_opts = null;
        const a = terrain.gen_shallows(w, starts);
        const b = terrain.gen_heights(w, starts);
        const cc = terrain.gen_cliffs(w, starts);
        terrain.gen_ground(w, starts);
        assert.equal(a, L.ret[0]);
        assert.ok(Math.abs(b - L.ret[1]) < 1e-8);
        assert.equal(cc, L.ret[2]);
        diffArr('terrain', w.terrain.flat(), L.terrain);
        diffArr('ground', Array.from(w.ground), L.ground);
        diffArr('elev', Array.from(w.elev_map), L.elev);
        diffArr('hz', w.hz.flat(), L.hz, 2e-6);
        diffArr('cliffs', w.cliffs, L.cliffs);
        const z = [];
        for (let x = 0; x < 400; x += 37) for (let y = 0; y < 400; y += 41) z.push(terrain.z_at(w, x * 7.3, y * 11.1));
        diffArr('z_at', z, L.z, 2e-6);
        const gat = [];
        for (let ix = -300; ix < 300; ix += 77) for (let iy = 0; iy < 1500; iy += 133) gat.push(...terrain.ground_at(w, ix, iy, 100));
        diffArr('ground_at', gat, L.gat.flat(), 2e-6);
        const fz = [];
        for (let x = 0; x < 90; x += 13) for (let y = 0; y < 90; y += 11) fz.push(terrain.footprint_z(w, x, y, 3, 2));
        diffArr('footprint_z', fz, L.fz, 2e-6);
        const sl = [];
        for (let x = 0; x < 90; x += 9) for (let y = 0; y < 90; y += 9) sl.push(terrain.slope_ok(w, x, y, 2));
        diffArr('slope_ok', sl, L.slope);
        terrain.flatten(w, 10, 10, 20, 14, 3);
        diffArr('flatten', w.hz.flat(), L.flat_hz, 2e-6);
    });
}

test('map_assets loads and reads maps.json', async () => {
    const ma = await import('../src/map_assets.js');
    const ix = ma.index();
    assert.ok(ix === null || typeof ix === 'object');
    if (ix) assert.ok('terrain' in ix || 'trees' in ix || 'animals' in ix || 'relic' in ix);
});
