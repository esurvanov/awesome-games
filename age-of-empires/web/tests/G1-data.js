// G1 browser check: every procedural content art function (units, buildings, fish) draws without errors.
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';

const details = [];
function check(name, fn) {
    try { fn(); details.push({ name, ok: true }); } catch (e) { details.push({ name, ok: false, got: String(e && e.stack || e) }); }
}
try {
    await assets.init();
    await storage.init();
    await assets.load_group('boot');
    pygame.init();
    const scr = pygame.display.set_mode([1280, 800]);
    scr.fill([60, 90, 50]);
    const { data } = await import('../src/_data_init.js');
    const gfx = await import('../src/gfx.js');
    const naval_gfx = await import('../src/naval_gfx.js');
    py.register_modules({ gfx, naval_gfx, data });
    let i = 0;
    for (const [kind, d] of Object.entries(data.UNITS)) {
        if (typeof d.art !== 'function') continue;
        const x = 30 + (i % 20) * 62, y = 60 + Math.floor(i / 20) * 70;
        i++;
        check('unit ' + kind, () => {
            d.art(scr, kind, data.PLAYER_COLORS[i % 8], x, y, [1.0, 0.0], 0.5, 0.2, 1.0, 'gold', true);
            d.art(scr, kind, data.PLAYER_COLORS[i % 8], x + 25, y, [-1.0, 0.0], 0.0, 0.0, 1.0, null, false);
        });
    }
    if (typeof gfx.ART === 'object' && gfx.ART.trebuchet_up) check('trebuchet_up', () => gfx.ART.trebuchet_up(scr, 'trebuchet', [255, 0, 0], 1200, 380));
    let j = 0;
    for (const [kind, d] of Object.entries(data.BUILDINGS)) {
        if (typeof d.art !== 'function') continue;
        const ox = 120 + j * 160, oy = 520;
        j++;
        check('building ' + kind, () => {
            const p = new gfx.IsoPainter(scr, ox, oy);
            d.art(p, scr, data.PLAYER_COLORS[j % 8], d.size);
        });
    }
    for (const k of ['shore_fish', 'deep_fish']) {
        check('fish ' + k, () => {
            const s = data.NODE_DEFS[k].sprite(0);
            if (s) scr.blit(Array.isArray(s) ? s[0] : s, [100 + (k === 'deep_fish' ? 60 : 0), 740]);
            data.NODE_DEFS[k].anim(scr, { var: 1, kind: k, tx: 3, ty: 4 }, 300, 760, 1.0);
        });
    }
    pygame.display.flip();
} catch (e) {
    details.push({ name: 'setup', ok: false, got: String(e && e.stack || e) });
}
const fail = details.filter(d => !d.ok).length;
for (const d of details) if (!d.ok) console.warn('FAIL', d.name, d.got);
window.__results = { pass: details.length - fail, fail, details };
