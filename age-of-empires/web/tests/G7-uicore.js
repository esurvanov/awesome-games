// Browser check for G7 (ui, widgets, uiskin, uiskin_map, controls, controls_draw): draws every widget/skin element,
// every army icon, then builds a Game, starts a match and runs frames with input (click-select, box-select, keys,
// command, zoom). Sets window.__results for web/tests/browser_check.mjs.
import '../src/_all.js';
import * as pygame from '../runtime/pygame.js';
import * as S from '../src/uiskin.js';
import * as W from '../src/widgets.js';
import * as CD from '../src/controls_draw.js';
import { Game } from '../src/ui.js';
import { Unit } from '../src/world.js';

const details = [];
const check = (name, fn) => {
    try {
        const r = fn();
        const ok = r === undefined ? true : !!r;
        details.push({ name, ok, got: String(r), want: 'truthy' });
    } catch (e) {
        details.push({ name, ok: false, got: String(e && e.stack || e), want: 'no exception' });
    }
};

const surf = new pygame.Surface([640, 480]);
const f = S.font('antiqua', 15, true);
check('widgets', () => {
    W.red_button(surf, [10, 10, 180, 36], 'Start', f, 'hover', 'food');
    W.field(surf, [10, 60, 180, 28], 'A very long field caption that must be cut', f, true);
    W.dropdown_list(surf, [10, 60, 180, 28], ['One', 'Two', 'Three'], f, 1, 2);
    W.checkbox(surf, [10, 200, 180, 24], true, 'Check', f);
    W.tab(surf, [200, 10, 120, 30], 'Tab', f, false, true, 'wood');
    const tr = W.slider(surf, [200, 60, 160, 20], 0.4, true);
    W.plate(surf, [400, 120], 'Standard Game', f, 260);
    W.box(surf, [200, 160, 200, 80]);
    W.color_badge(surf, [420, 160, 24, 24], [255, 0, 0], 3, f, true);
    const c = surf.get_at([100, 28]);
    return tr.w === 160 && c[0] > c[2];
});
check('uiskin panels/buttons', () => {
    for (const st of ['stone', 'light', 'wood', 'parchment']) S.panel(surf, [10, 250, 200, 100], st, true, null, st === 'wood');
    for (const st of ['normal', 'hover', 'pressed', 'disabled', 'on']) S.button(surf, [220, 250, 120, 40], st);
    for (const st of ['normal', 'hover', 'pressed', 'disabled', 'on', 'poor']) { S.slot(surf, [360, 250, 44, 44], st); S.icon_frame(surf, [360, 250, 44, 44], st); }
    S.gold_frame(surf, [420, 250, 100, 60], true, [170, 176, 190]);
    S.bevel(surf, [10, 360, 100, 40]);
    S.trim_band(surf, [120, 360, 300, 16], 'teutons');
    const g = S.gold_text('Chronicles', S.font('title', 40, true));
    const pf = S.parchment_flat([200, 120], g);
    surf.blit(S.culture_panel([100, 60], 'persians'), [430, 360]);
    return g.get_width() > 50 && pf.get_width() === 200 && S.available();
});
check('uiskin icons/portraits/cursors', () => {
    const a = S.icon('food', 24), b = S.portrait('u', 'knight', 'franks', 48), c = S.portrait('t', 'loom', null, 40);
    const d = S.portrait('b', 'house', 'britons', 40), e = S.portrait('age', 2, null, 40);
    const cur = new S.Cursors();
    const rec = cur.load('attack');
    cur.set('arrow');
    cur.set_soft(true);
    cur.set('attack');
    cur.draw(surf);
    return a && b && c && d && e && rec && rec[0].get_width() <= 32 && S.culture('mongols').key === 'asia';
});
check('ctl icons', () => {
    for (const n of ['patrol', 'guard', 'follow', 'amove', 'aground', 'aggressive', 'defensive', 'stand_ground', 'no_attack',
        'line', 'box', 'staggered', 'flank']) {
        for (const a of ['', '*']) {
            const ic = new pygame.Surface([40, 40], pygame.SRCALPHA);
            CD.draw_ctl_icon(ic, n + a, 40);
        }
    }
    return true;
});

let g = null;
check('Game()', () => { g = new Game(); return g.state === 'menu'; });
let frames = 0;
if (g) {
    check('new_game + frames', () => {
        g.new_game(1, 1, false, false, 'land', 'franks');
        for (let i = 0; i < 5; i++) { g.update(0.033); g.draw(); frames++; }
        return g.state === 'play' && g.terrain_surf && g.world.units.length > 0;
    });
    check('selection/buttons/commands', () => {
        const w = g.world;
        const vils = w.units.filter(u => u.owner === 0 && u.kind === 'villager');
        g.click_select(vils[0], 0, 0, false);
        const b1 = g.get_buttons();
        g.selected = vils.slice();
        const [sx, sy] = g.w2s(vils[0].x, vils[0].y);
        g.command(vils[0].x + 60, vils[0].y + 40, null);
        g.update(0.05);
        const r = new pygame.Rect(0, 60, 1280, 560);
        g.box_select(r, 0);
        g.ctl_key(pygame.K_PERIOD);
        g.ctl_key(pygame.K_h);
        g.group_key(1, pygame.KMOD_CTRL, 0);
        const e = g.entity_at([sx, sy]);
        const scout = w.units.find(u => u.owner === 0 && !(u.kind === 'villager'));
        let army = [];
        if (scout) { g.selected = [scout]; army = g.get_buttons(); g.start_order('patrol'); g.order_click([sx + 30, sy + 30]); }
        g.set_zoom(0.7, [640, 400]);
        g.update(0.05); g.draw(); frames++;
        g.zoom_step(3, [600, 380]);
        for (let i = 0; i < 20; i++) { g.update(0.033); g.draw(); frames++; }
        return b1.length > 0 && g.groups.get(1).length > 0 && (scout == null || army.length > 5) && g.zoom !== 0.7;
    });
    check('entity_at + fog + icons', () => {
        g.draw_fog();
        const ic = g.icon('t', 'loom', 0, 40), ic2 = g.icon('ctl', 'box*', 0, 40), ic3 = g.icon('n', 'tree', 0, 40);
        return ic && ic2 && ic3 && g.fog_full;
    });
}
const pass = details.filter(d => d.ok).length;
window.__results = { pass, fail: details.length - pass, details, frames };
console.log('G7', JSON.stringify(details.filter(d => !d.ok)).slice(0, 4000));
// show the result
const scr = pygame.display.get_surface() || pygame.display.set_mode([1280, 800]);
if (g && g.state === 'play') { g.draw(); } else scr.blit(surf, [0, 0]);
pygame.display.flip();
