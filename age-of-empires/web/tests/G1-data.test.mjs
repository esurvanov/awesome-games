// G1 data: data + content tables, i18n, settings, keymap, themes, maps, scoring vs CPython
// (fixture: KHRONIKI_LANG=en .venv/bin/python web/tests/gen_G1-data_ref.py)
//   node --import ./web/tests/stub_loader.mjs --test web/tests/G1-data.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ROOT } from './node_env.mjs';
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';

py.os.environ.KHRONIKI_LANG = 'en';
await setup();
const { data } = await import('../src/_data_init.js');
const i18n = await import('../src/i18n.js');
const themes = await import('../src/themes.js');
const maps = await import('../src/maps.js');
const keymap = await import('../src/keymap.js');
const settings = await import('../src/settings.js');
const scoring = await import('../src/scoring.js');
const civs = await import('../src/content/civs.js');
const civ_units = await import('../src/content/civ_units.js');
const uni = await import('../src/content/_uni.js');
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'tests', 'fixtures', 'G1-data_ref.json'), 'utf8'));

function norm(v) {
    if (typeof v === 'function') return '<fn>';
    if (v instanceof Map) return Array.from(v, ([k, x]) => [String(k), norm(x)]);
    if (v instanceof Set) return py.sorted(Array.from(v, norm));
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => [k, norm(x)]);
    return v;
}

function deq(got, want, where) {
    // deep compare with a readable path on mismatch (floats compared with a tiny tolerance)
    if (typeof want === 'number' && typeof got === 'number') {
        if (Math.abs(got - want) > 1e-12 * Math.max(1, Math.abs(want))) assert.fail(`${where}: ${got} != ${want}`);
        return;
    }
    if (Array.isArray(want)) {
        if (!Array.isArray(got)) assert.fail(`${where}: not an array: ${JSON.stringify(got)}`);
        if (got.length !== want.length) {
            assert.fail(`${where}: length ${got.length} != ${want.length}\n got ${JSON.stringify(got).slice(0, 600)}\nwant ${JSON.stringify(want).slice(0, 600)}`);
        }
        for (let i = 0; i < want.length; i++) deq(got[i], want[i], `${where}[${i}]`);
        return;
    }
    assert.deepEqual(got, want, where);
}

test('tables (content-extended, key order, names)', () => {
    for (const name of ['UNITS', 'BUILDINGS', 'TECHS', 'CIVS', 'NODE_DEFS', 'ANIMALS', 'BUILD_MENU', 'AGE_REQ', 'RES_NAME',
        'COLOR_NAMES', 'PLAYER_NAMES', 'AGE_NAMES', 'DIFF_NAMES', 'MAP_SIZES', 'WORLD_HOOKS']) {
        deq(norm(data[name]), REF[name], name);
    }
    deq(norm(civ_units.UNIQUE), REF.UNIQUE, 'UNIQUE');
    deq(norm(civ_units.UTECHS), REF.UTECHS, 'UTECHS');
    deq(civs.PLAYABLE, REF.PLAYABLE, 'PLAYABLE');
    deq(uni.PENDING, REF.PENDING, 'PENDING');
});

test('maps', () => {
    deq(norm(maps.MAPS), REF.MAPS, 'MAPS');
    deq(norm(maps.NAMES), REF.MAP_NAMES, 'NAMES');
    deq([...Object.keys(maps.MAPS), 'nope'].map(mt => [mt, maps.is_water(mt), maps.is_legacy(mt), maps.is_nomad(mt), maps.name(mt)]),
        REF.maps_fn, 'maps_fn');
});

test('data helpers', () => {
    const got = [];
    for (const c of [[10, 20, 30], [250, 5, 128, 77]]) for (const d of [-40, 0, 13, 300]) got.push(data.shade(c, d));
    deq(got, REF.shade, 'shade');
    deq([[0, 0, 3, 4, 2, 2], [5, 5, 0, 0, 10, 10], [20, 3, 0, 0, 10, 10], [-7.5, 30.25, 1, 2, 3, 4], [3, -9, 0, 0, 10, 10]]
        .map(a => data.dist_point_rect(...a)), REF.dist, 'dist');
    deq([data.to_iso(100, 37.5), data.to_iso(3, 4, 10, 2.5), data.from_iso(100, 50), data.from_iso(7, 9, 3)], REF.iso, 'iso');
    deq(data.cost_add({ food: 5, gold: 1 }, { wood: 3, food: 2 }), REF.cost_add, 'cost_add');
    assert.deepEqual(data.as_tuple('a'), ['a']);
    assert.deepEqual(data.as_tuple(['a', 'b']), ['a', 'b']);
});

test('themes', () => {
    const h = [];
    for (const x of [0, 1, 7, 99, 219, 12345]) for (const y of [0, 3, 150, 218]) for (const s of [0, 1, 5, 9, 11]) h.push(themes._hash(x, y, s));
    deq(h, REF.hash, 'hash');
    deq([themes._hash(-3, 5, 1), themes._hash(4, -100, 9), themes._hash(-1, -1, -1)], REF.hash_neg, 'hash_neg');
    for (const [key, th] of Object.entries(themes.THEMES)) {
        const got = [];
        for (let ty = 0; ty < 60; ty += 3) for (let tx = 0; tx < 60; tx += 2) got.push(themes.pick_species(th.species.slice(), tx, ty));
        deq(got, REF.species[key], 'species ' + key);
    }
    assert.equal(themes.pick_species([], 3, 4), REF.species_empty);
    const W = { theme: 'snow' };
    const got = [];
    for (let tx = 0; tx < 40; tx++) got.push(themes.tree_species(W, tx, 7, new Set(['fir_winter', 'winter_tree'])));
    deq(got, REF.tree_species_avail, 'tree_species');
    deq(['grass', 'water', 'nope', 'forest'].map(g => themes.mm_color(W, g)), REF.mm, 'mm');
});

test('i18n', () => {
    deq([null, '', 'ru_RU.UTF-8', 'pt', 'PT_br', 'zh_TW', 'de-AT', 'en@euro', 'xx', 'it_IT', 'ja_JP', 'fr'].map(i18n.match_code),
        REF.match_code, 'match_code');
    deq([i18n.t('unit.knight.name'), i18n.t('no.such.key'), i18n.t('menu.version', { v: '0.9.1' }),
        i18n.name_of('tech', 'loom'), i18n.desc_of('building', 'castle'), i18n.has('unit.knight.name'),
        i18n.has('x.y'), i18n.player_name()], REF.t, 't');
    deq(REF.t_fmt.map(([k]) => [k, i18n.t(k, { n: 3, name: 'Bob', v: 'x', a: 1, b: 2, x: 5, count: 7 })]), REF.t_fmt, 't_fmt');
    // language switch round trip
    let seen = null;
    i18n.on_change(c => { seen = c; });
    assert.equal(i18n.set_language('ru_RU', false), 'ru');
    assert.equal(seen, 'ru');
    assert.notEqual(data.UNITS.knight.name, 'Knight');
    i18n.set_language('en', false);
    assert.equal(data.UNITS.knight.name, REF.t[0]);
});

test('keymap + settings', () => {
    deq(keymap.ACTIONS.map(([a]) => [a, keymap.key_for(a), keymap.default_code(a), keymap.name_for(a), keymap.label(a),
        keymap.pretty(keymap.name_for(a))]), REF.keymap, 'keymap');
    deq([keymap.matches('pause', pygame.K_p), keymap.matches('pause', pygame.K_F3),
        keymap.matches('speed_up', pygame.K_KP_PLUS), keymap.matches('speed_up', pygame.K_a)], REF.matches, 'matches');
    keymap.set_key('pause', pygame.K_F4);
    deq([keymap.name_for('pause'), keymap.name_for('score'), keymap.translate(pygame.K_F4),
        keymap.translate(pygame.K_F3), keymap.translate(pygame.K_p), keymap.translate(pygame.K_a),
        keymap.matches('pause', pygame.K_p)], REF.after_set, 'after_set');
    keymap.reset();
    assert.equal(keymap.name_for('pause'), REF.after_reset);
    // settings persistence + merge with keys written by others
    settings.put('game_speed', 2.0);
    settings.reload();
    assert.equal(settings.get('game_speed'), 2.0);
    assert.equal(settings.get('fps_limit'), 60);
    assert.equal(settings.get('nope', 5), 5);
    const k = settings.get('keys'); k.x = 1;
    assert.deepEqual(settings.DEFAULTS.keys, {});
});

test('scoring', () => {
    const P = (id, team, techs, res, alive = true) => ({ id, team, techs: new Set(techs), res, alive });
    const w = {
        players: [P(0, 0, ['loom', 'feudal'], { food: 100, wood: 50, gold: 0, stone: 10 }), P(1, 1, [], { food: 0, wood: 0, gold: 0, stone: 0 }),
            P(2, 0, [], { food: 1, wood: 1, gold: 1, stone: 1 })],
        units: [{ owner: 0, kind: 'villager' }, { owner: 1, kind: 'knight' }, { owner: -1, kind: 'sheep' }],
        buildings: [{ owner: 0, kind: 'castle', complete: true, garrison: [{ kind: 'archer' }] },
            { owner: 1, kind: 'house', complete: true, garrison: [] }, { owner: 1, kind: 'barracks', complete: false, garrison: [] }],
    };
    const sc = scoring.scores(w);
    // no stats: tech = 0.2 * (50 + 500) = 110; eco p0 = 0.1*160 + 0.2*(50 + 70 [archer in castle]) = 40
    assert.deepEqual(sc[0], { military: 0, economy: 40, technology: 110, society: 130, total: 280 });
    const ts = scoring.team_scores(w);
    assert.equal(ts.get(0), sc[0].total + sc[2].total);
    w.stats = [{ killed_value: 100, razed_value: 50, trib_sent: 0, tech_value: 10, explored: 0.5 }, {}, {}];
    assert.deepEqual(scoring.score(w, 0), { military: 30, economy: 40, technology: 502, society: 130, total: 702 });
});
