// G8 hud: civ_ui / hud_windows / hud pure-logic parts vs CPython
// (fixture: KHRONIKI_LANG=en SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G8-hud_ref.py)
// Run: node --import ./web/tests/stub_loader.mjs --test web/tests/G8-hud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ROOT } from './node_env.mjs';
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';

await setup();
py.os.environ.KHRONIKI_LANG = 'en';
await import('../src/_data_init.js');
const data = await import('../src/data.js');
const world = await import('../src/world.js');
const civ_ui = await import('../src/civ_ui.js');
const hud_windows = await import('../src/hud_windows.js');
const hud = await import('../src/hud.js');
await import('../src/defense_ui.js');
await import('../src/economy_ui.js');
py.register_modules({ world, civ_ui, hud_windows, hud });

const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'tests', 'fixtures', 'G8-hud_ref.json'), 'utf8'));

function J(x) {
    if (x instanceof pygame.Rect) return [x.x, x.y, x.w, x.h];
    if (x instanceof world.Building) return 'bld';
    if (typeof x === 'function') return 'fn';
    if (Array.isArray(x)) return x.map(J);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, J(v)]));
    return x;
}
const deq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(J(a))), b, m);

class Stub {
    constructor(page = 0) { this.cmd_page = page; this.selected = []; this._bp_key = null; }
}
py.mixin(Stub, hud.HudUI);

test('civ_ui', () => {
    deq(civ_ui.playable(), REF.playable, 'playable');
    const civs = [...civ_ui.playable(), 'random'];
    deq(Object.fromEntries(civs.map(k => [k, civ_ui.civ_name(k)])), REF.civ_names, 'civ_name');
    deq(Object.fromEntries(civs.map(k => [k, civ_ui.unique_units(k)])), REF.unique_units, 'unique_units');
    deq(Object.fromEntries(civs.map(k => [k, civ_ui.unique_techs(k)])), REF.unique_techs, 'unique_techs');
    deq(civ_ui.menu_items(), REF.menu_items, 'menu_items');
});

test('hud_windows', () => {
    deq(hud_windows.civ_list(), REF.civ_list, 'civ_list');
    deq(Object.fromEntries(civ_ui.playable().map(k => [k, hud_windows.tt_items(k)])), REF.tt_items, 'tt_items');
    deq(hud_windows.BOXES, REF.boxes, 'boxes');
    deq(hud_windows.TAUNTS, REF.taunts, 'taunts');
    for (const civ of Object.keys(REF.tt_layout)) {
        const g = new Stub();
        g.tt_civ = civ;
        deq(hud_windows.tt_layout(g), REF.tt_layout[civ], 'tt_layout ' + civ);
    }
});

test('grid_layout', () => {
    const item = (i, slot = null) => {
        const d = { icon: ['u', 'u' + i], act: ['x', i], ok: true, tip: ['t' + i, {}] };
        if (slot != null) d.slot = slot;
        return d;
    };
    const cases = [
        [[item(0), item(1, 3), item(2, 3), item(3)], []],
        [py.range(12).map(i => item(i)), [item(100), item(101, 4)]],
        [py.range(20).map(i => item(i, i % 4)), [item(200)]],
        [py.range(30).map(i => item(i)), [item(300), item(301)]],
    ];
    const got = [];
    for (const page of [0, 1, 2, 5]) {
        for (const [items, fixed] of cases) got.push(new Stub(page).grid_layout(items, fixed));
    }
    deq(got, REF.grid_layout, 'grid_layout');
});

test('building_slots, tech_chains, villager_items', () => {
    const { BUILDINGS, TECHS } = data;
    for (const civ of civ_ui.playable()) {
        const p = new world.Player(0, undefined, undefined, undefined, undefined, civ);
        p.res = { food: 10000, wood: 10000, gold: 10000, stone: 10000 };
        const g = new Stub();
        g.world = { players: [p], buildings: [], build_age: (pp, kind) => BUILDINGS[kind].age };
        for (const kind of ['barracks', 'archery_range', 'stable', 'blacksmith', 'town_center', 'university', 'monastery',
            'castle', 'dock', 'mill', 'lumber_camp', 'market', 'siege_workshop']) {
            const d = BUILDINGS[kind];
            const items = [];
            for (const k of py.get(d, 'trains', [])) items.push({ act: ['train', null, p.current(k)] });
            for (const t of py.get(d, 'techs', [])) if (Object.hasOwn(TECHS, t)) items.push({ act: ['research', null, t] });
            if (kind === 'town_center') items.push({ act: ['bell'] }, { act: ['eject', null] });
            deq(g.tech_chains({ kind, d }, p), REF.tech_chains[civ + ':' + kind], 'chains ' + civ + ':' + kind);
            deq(g.building_slots({ kind, d }, p, items).map(it => Object.hasOwn(it, 'slot') ? it.slot : 'none'),
                REF.building_slots[civ + ':' + kind], 'slots ' + civ + ':' + kind);
        }
        const rows = [];
        for (const page of [null, 'eco', 'mil']) {
            g.build_page = page;
            g._bp_key = [];
            rows.push(g.villager_items(p).map(it => [it.icon[0], it.icon[1], it.act[0], it.ok, it.tip,
                Object.hasOwn(it, 'slot') ? it.slot : null]));
        }
        deq(rows, REF.villager_items[civ], 'villager_items ' + civ);
    }
});

test('small helpers', () => {
    const g = new Stub();
    // vil_job / gather_rate on plain targets
    const node = new world.Node('gold', 3, 4);
    assert.equal(g.vil_job({ state: 'gather', target: node }), 'gold');
    assert.equal(g.vil_job({ state: 'build', target: null }), 'build');
    assert.equal(g.vil_job({ state: 'idle', target: null }), null);
    assert.equal(hud._lum([100, 200, 50]), 0.3 * 100 + 0.59 * 200 + 0.11 * 50);
    g.settings = { show_hotkeys: true };
    assert.equal(g.hud_opt('show_hotkeys', false), true);
    assert.equal(g.hud_opt('nope', 7), 7);
});
