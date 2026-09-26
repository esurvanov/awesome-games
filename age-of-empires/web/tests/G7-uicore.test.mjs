// G7 ui core: pure-logic checks against CPython (fixtures/G7-uicore.json from gen_G7-uicore_ref.py).
//   node --import ./web/tests/stub_loader.mjs --test web/tests/G7-uicore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, ROOT } from './node_env.mjs';
await setup();
const py = await import('../runtime/py.js');
await import('../src/_data_init.js');
const data = await import('../src/data.js');
const i18n = await import('../src/i18n.js');
py.register_modules({ data, i18n });
const M = await import('../src/uiskin_map.js');
const S = await import('../src/uiskin.js');
const widgets = await import('../src/widgets.js');
const controls = await import('../src/controls.js');
const ui = await import('../src/ui.js');
const ref = JSON.parse(fs.readFileSync(ROOT + '/web/tests/fixtures/G7-uicore.json', 'utf8'));

const norm = v => JSON.parse(JSON.stringify(v));

test('uiskin_map tables equal Python', () => {
    for (const [k, v] of Object.entries(ref.map)) {
        const js = M[k];
        assert.ok(js !== undefined, k);
        let got;
        if (js instanceof Map) got = Array.from(js.entries()).map(([a, b]) => [String(a), b]).sort();
        else if (Array.isArray(js)) got = js;
        else got = Object.entries(js).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        const want = js instanceof Map ? v.map(([a, b]) => [String(a), b]).sort() : v;
        assert.deepEqual(norm(got), want, k);
    }
});

test('portrait_path equals Python for every unit/building/tech/age x civ', () => {
    let n = 0;
    for (const [typ, name, civ, want] of ref.portrait_path) {
        assert.equal(S.portrait_path(typ, name, civ), want, `${typ} ${name} ${civ}`);
        n++;
    }
    assert.ok(n > 2000);
});

test('unique ages, cursor files, civ groups', () => {
    assert.deepEqual(S._unique_age(), ref.unique_age);
    assert.deepEqual(norm(S.CURSOR_FILES), ref.cursor_files);
    for (const [c, g] of Object.entries(ref.civ_group)) assert.equal(S.civ_group(c === 'None' ? null : c), g);
});

test('game_fonts kinds and sizes', () => {
    const f = S.game_fonts();
    for (const [k, [kind, size, bold]] of Object.entries(ref.font_sizes)) {
        const info = S._font_info.get(f[k]);
        assert.deepEqual([info[0], info[1], !!info[2]], [kind, size, !!bold], k);
    }
});

test('widgets.list_rects', () => {
    const got = widgets.list_rects(800, [100, 700, 80, 24], 5).concat(widgets.list_rects(800, [100, 100, 200, 30], 3, 30));
    assert.deepEqual(got.map(([r, i]) => [[r.x, r.y, r.w, r.h], i]), ref.list_rects);
});

test('controls: line roots, line_of, common', () => {
    assert.deepEqual(controls._line_roots(), ref.line_roots);
    class G {}
    py.mixin(G, controls.ControlsUI);
    const g = new G();
    for (const [k, v] of Object.entries(ref.line_of)) assert.equal(g.line_of(k), v, k);
    assert.equal(controls.ControlsUI.common([], 'x', 1), ref.common[0]);
    assert.equal(g.common([{ stance: 'a' }, { stance: 'a' }], 'stance', 'b'), 'a');
    assert.equal(g.common([{ stance: 'a' }, {}], 'stance', 'b'), null);
    assert.equal(g.formation_of([{ formation: 'box' }, {}, { formation: 'box' }]), 'box');
    assert.equal(g.formation_of([{ formation: 'box' }, {}]), 'box');      // tie: the first counted wins (Python max)
});

test('ui: _qface and _DIRS8', () => {
    for (const [fx, fy, want] of ref.qface) assert.equal(ui._qface(fx, fy), want, `${fx},${fy}`);
    ref.dirs8.forEach(([x, y], i) => {
        assert.ok(Math.abs(ui._DIRS8[i][0] - x) < 1e-12 && Math.abs(ui._DIRS8[i][1] - y) < 1e-12);
    });
});

test('ui: Game mixin wiring', () => {
    const G = ui.Game;
    for (const m of ['ctl_key', 'army_buttons', 'order_click', 'draw_world', 'entity_at', 'text', 'icon', 'run'])
        assert.equal(typeof G.prototype[m], 'function', m);
    assert.equal(G.prototype.GRID, 15);
    assert.equal(G.node_stage({ kind: 'tree' }), 0);
    assert.equal(G.prototype.order_mode, null);
});
