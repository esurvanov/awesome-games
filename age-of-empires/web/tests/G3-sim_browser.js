// Browser checks for group G3 (relics drawing, savegame to browser storage with a thumbnail).
// node web/tests/browser_check.mjs web/tests/G3-sim.html
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';
import * as py from '../runtime/py.js';

const results = { pass: 0, fail: 0, details: [] };
function check(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    const ok = g === w;
    results[ok ? 'pass' : 'fail']++;
    results.details.push({ name, ok, got: g, want: w });
}

async function main() {
    await assets.init();
    await storage.init();
    await assets.load_group('boot');
    pygame.init();
    const scr = pygame.display.set_mode([320, 200]);
    await import('../src/_data_init.js');
    const mods = {};
    // every ported module whose static imports are all present (other groups port in parallel; the directory
    // listing of python http.server tells what exists, so nothing 404s)
    const listing = await (await fetch(new URL('../src/', import.meta.url))).text();
    const have = new Set(Array.from(listing.matchAll(/href="([\w]+)\.js"/g), m => m[1]));
    const deps = {};
    for (const f of have) {
        const src = await (await fetch(new URL(`../src/${f}.js`, import.meta.url))).text();
        deps[f] = Array.from(src.matchAll(/^import .* from '\.\/([\w]+)\.js'/gm), m => m[1]);
    }
    const ok = f => { const seen = new Set(); const st = [f]; while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); if (!have.has(x)) return false; st.push(...deps[x]); } return true; };
    for (const f of have) {
        if (f.startsWith('_') || !ok(f)) continue;
        try { mods[f] = await import(`../src/${f}.js`); } catch (e) { console.warn('skip', f, String(e)); }
    }
    if (!mods.civ_ui) mods.civ_ui = { civ_name: c => String(c) };
    py.register_modules(mods);
    const { relics, savegame, world, naval } = mods;

    // ---- relics drawing
    const [s, ax, ay] = relics._chest(1.0);
    check('chest size', s.get_size(), [26, 22]);
    check('chest anchor', [ax, ay], [13, 18]);
    check('chest has gold', s.get_at([12, 10]).slice(0, 3).some(v => v > 100), true);
    const spr = relics.sprite();
    check('sprite tuple', [spr[0] instanceof pygame.Surface, typeof spr[1], typeof spr[2]], [true, 'number', 'number']);
    const small = relics.sprite(true);
    check('small sprite smaller', small[0].get_width() <= spr[0].get_width(), true);
    const g = { screen: scr, drawn: [] };
    relics.draw_ground(g, { x: 1, y: 1 }, 100, 100);
    relics.draw_carried(g, {}, 100, 100);
    check('drawn rect', g.drawn.length === 1 && g.drawn[0][0] instanceof pygame.Rect, true);

    // ---- savegame round trip in browser storage (IndexedDB) with a thumbnail
    py.random.seed(11);
    const w = new world.World(1, 2, null, null, null, null, 'islands');
    const n_units = w.units.length, n_nodes = w.nodes.length;
    scr.fill([40, 90, 160]);
    const path = savegame.save_world(w, 'G3 test slot', null, { cam: [10, 20] }, scr);
    check('save path', path, 'home/saves/G3_test_slot.sav');
    const slots = savegame.list_slots();
    check('slots', slots.map(([sl, m, th]) => [sl, m.name, m.players, m.size, th]),
        [['G3_test_slot', 'G3 test slot', 2, w.W, 'home/saves/G3_test_slot.png']]);
    const th = pygame.image.load(slots[0][2]);
    check('thumb size', th.get_size(), [240, 150]);
    const r1 = py.random.random();
    py.random.seed(99);
    const [w2, ui, meta] = savegame.load_world('G3_test_slot');
    check('random restored', py.random.random(), r1);
    check('loaded world', [w2.W, w2.map_type, w2.units.length, w2.nodes.length, w2 instanceof world.World], [w.W, 'islands', n_units, n_nodes, true]);
    check('ui', ui, { cam: [10, 20] });
    check('fish kept', w2.nodes.filter(n => naval.FISH.includes(n.kind)).length > 0, true);
    for (let i = 0; i < 20; i++) w2.update(0.05);
    check('loaded world runs', w2.time > 0.9, true);
    await storage.flush();
    savegame.delete_slot('G3_test_slot');
    check('deleted', savegame.list_slots().length, 0);
}

main().then(() => {
    window.__results = results;
    document.getElementById('out').textContent = JSON.stringify(results, null, 1);
}, e => {
    results.fail++;
    results.details.push({ name: 'exception', ok: false, got: String(e && e.stack || e), want: '' });
    window.__results = results;
    document.getElementById('out').textContent = String(e && e.stack || e);
});
