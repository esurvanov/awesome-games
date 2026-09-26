// G6 gfx: pure-logic checks against CPython (fixtures from web/tests/gen_G6-gfx_ref.py).
//   node --import ./web/tests/stub_loader.mjs --test web/tests/G6-gfx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ROOT } from './node_env.mjs';
import * as py from '../runtime/py.js';

await setup();
await import('../src/_data_init.js');
const sprites3d = await import('../src/sprites3d.js');
const sprites_extra = await import('../src/sprites_extra.js');
const naval_gfx = await import('../src/naval_gfx.js');
const map_icons = await import('../src/map_icons.js');
const terrain_gfx = await import('../src/terrain_gfx.js');
const civ_art = await import('../src/civ_art.js');
const themes = await import('../src/themes.js');
py.register_modules({ sprites3d, sprites_extra, themes, gfx: await import('../src/gfx.js') });
// the other G6 modules must at least load
for (const m of ['gfx', 'wallgfx', 'menu_art']) await import(`../src/${m}.js`);

const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/tests/fixtures/G6-gfx_ref.json'), 'utf8'));

const close = (a, b, tol, what) => {
    assert.equal(a.length, b.length, what + ' length');
    let worst = 0, at = -1;
    for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (!(d <= worst)) { worst = d; at = i; }
    }
    assert.ok(worst <= tol, `${what}: max diff ${worst} at ${at} (${a[at]} vs ${b[at]})`);
};

test('_hash (both modules) = Python, incl. > 2^53 products', () => {
    for (const [x, y, s, h] of REF.hash) {
        assert.equal(sprites3d._hash(x, y, s), h, `sprites3d._hash(${x},${y},${s})`);
        assert.equal(sprites_extra._hash(x, y, s), h, `sprites_extra._hash(${x},${y},${s})`);
    }
});

test('species / face_dir', () => {
    for (const [x, y, sp] of REF.species) assert.equal(sprites_extra.species(x, y), sp, `species(${x},${y})`);
    for (const [fx, fy, n, d] of REF.face_dir) assert.equal(sprites3d.face_dir(fx, fy, n), d, `face_dir(${fx},${fy},${n})`);
});

test('atlas lookups: unit_set, building_rec, variants, civ_group', () => {
    for (const [c, g] of REF.civ_group) assert.equal(sprites3d.civ_group(c), g);
    for (const [k, c, fem, want] of REF.unit_set) {
        const s = sprites3d.unit_set(k, c, fem);
        const got = s == null ? null : [s.name, s.h, s.bh, s.ndir, s.rec.file, s.rec.mask ?? null];
        assert.deepEqual(got, want, `unit_set(${k},${c},${fem})`);
        if (s) assert.deepEqual(sprites3d.sheet_paths(k, c, fem), ['assets/gen/' + s.rec.file].concat(s.rec.mask ? ['assets/gen/' + s.rec.mask] : []));
    }
    for (const [k, c, file, nv] of REF.building_rec) {
        const r = sprites3d.building_rec(k, c);
        assert.equal(r == null ? null : r.file, file, `building_rec(${k},${c})`);
        assert.equal(sprites3d.variants(k, c), nv, `variants(${k},${c})`);
    }
});

function fakeWorld() {
    const f = REF.fake_world;
    return { W: f.W, H: f.H, terrain: f.terrain, ground: Uint8Array.from(f.ground), elev_map: Uint8Array.from(f.elev_map),
        hz: f.hz, relief: true };
}

test('water: shore_dist, water_color, map_icons._water_dist, minimap_colors', () => {
    const w = fakeWorld();
    const dist = naval_gfx.shore_dist(w);
    assert.deepEqual(dist, REF.shore_dist);
    for (const [d, v, c] of REF.water_color) assert.deepEqual(naval_gfx.water_color(d, v), c);
    assert.deepEqual(map_icons._water_dist(w), REF.water_dist);
    assert.deepEqual(terrain_gfx.minimap_colors(w, naval_gfx.water_color, dist), REF.minimap);
    assert.deepEqual(terrain_gfx.minimap_colors(w, naval_gfx.water_color, dist, true), REF.minimap_de);
});

test('terrain_gfx: _diamond, _vertex_light', () => {
    const [U, V, IN] = terrain_gfx._diamond();
    close(Array.from(U), REF.diamond.U, 0, 'U');
    close(Array.from(V), REF.diamond.V, 0, 'V');
    assert.deepEqual(Array.from(IN), REF.diamond.IN);
    const w = fakeWorld();
    const L = terrain_gfx._vertex_light(w.hz);
    close(Array.from(L.data), REF.vertex_light, 1e-5, 'vertex_light');
});

test('terrain_gfx: Relief D/L grid and fog_rows', () => {
    const w = fakeWorld();
    const R = REF.relief;
    const rel = new terrain_gfx.Relief(w, R.ox, R.tw, R.th);
    assert.equal(rel.flat, R.flat);
    assert.deepEqual(rel.D.shape, R.shape);
    close(Array.from(rel.D.data), R.D, 2e-3, 'D');
    close(Array.from(rel.L.data), R.L, 1e-4, 'L');
    const fr = rel.fog_rows(Math.floor(R.tw / 8), Math.floor(R.th / 8), 8);
    assert.deepEqual(fr.shape, REF.fog_rows.shape);
    let diff = 0;
    for (let i = 0; i < fr.data.length; i++) if (fr.data[i] !== REF.fog_rows.data[i]) diff++;
    assert.ok(diff <= fr.data.length * 0.001, `fog_rows differ in ${diff} cells`);
});

test('civ_art._shield_poly', () => {
    const got = civ_art._shield_poly([1, 1, 46, 54]);
    close(got.flat(), REF.shield_poly.flat(), 1e-9, 'shield_poly');
});
