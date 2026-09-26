// G8 browser check: the HUD modules (hud, hud_windows, defense_ui, economy_ui, civ_ui) draw without exceptions on a
// fake Game (the real ui.Game is G7): top panel, bottom panel with minimap and selection, tooltips, windows, overlays,
// civilization card and picker, market / mill buttons, defense icons.
//   node web/tests/browser_check.mjs web/tests/G8-hud.html
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';

const details = [];
let pass = 0, fail = 0;
function ok(name, cond, got = '', want = '') {
    details.push({ name, ok: !!cond, got: String(got), want: String(want) });
    if (cond) pass++; else fail++;
}
async function check(name, fn) {
    try { const r = await fn(); if (r !== false) ok(name, true); else ok(name, false, 'false', 'true'); } catch (e) { ok(name, false, e && e.stack || e, 'no exception'); }
}

try {
    await assets.init();
    await storage.init();
    await assets.load_group('boot');
    await assets.load_group('buildings');
    await assets.load_group('portraits');
    pygame.init();
    const scr = pygame.display.set_mode([1280, 800]);
    scr.fill([60, 90, 50]);
    await import('../src/_data_init.js');
    const names = ['civ_art', 'data', 'defense', 'gfx', 'i18n', 'market', 'scoring', 'stats', 'sprites3d', 'themes', 'uiskin',
        'wallgfx', 'world', 'civ_ui', 'hud_windows', 'hud', 'defense_ui', 'economy_ui', 'relics', 'naval'];
    const reg = {};
    for (const n of names) reg[n] = await import(`../src/${n}.js`);
    py.register_modules(reg);
    const { data, world, hud, hud_windows, civ_ui, defense_ui, economy_ui, uiskin: S, gfx } = reg;

    // ---- a fake Game with the ui.py helpers the HUD relies on
    class FakeGame {
        constructor() {
            this.screen = scr;
            this.fonts = S.game_fonts();
            this.tcache = new Map();
            this.icons = new Map();
            this.menu_cfg = { civ: 'franks' };
            this.selected = [];
            this.groups = new Map();
            this.help = false;
            this.speed = data.GAME_SPEED;
            this.clock = new pygame.time.Clock();
            this.audio = { click() {}, draw_icon() {}, settings: {} };
            this.settings = { show_hotkeys: true };
            this.mm_img = null; this.mm_t = 0;
            this.iso_tw = 2000; this.iso_th = 1000; this.cam_x = 300; this.cam_y = 200;
            this.order_mode = null;
            this.panel_hits = [];
            this.events = [];
            this.markers = [];
            this.state = 'play';
        }
        text(s, pos, font = 'm', color = [240, 235, 220], anchor = 'topleft', sh = true) {
            if (this.ink) {
                sh = false;
                if (0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2] > 140) {
                    color = [Math.trunc(color[0] * 0.3), Math.trunc(color[1] * 0.26), Math.trunc(color[2] * 0.2)];
                }
            }
            const img = this.fonts[font].render(s, true, color);
            const r = img.get_rect({ [anchor]: pos });
            if (sh) this.screen.blit(this.fonts[font].render(s, true, [15, 12, 10]), [r.x + 1, r.y + 1]);
            this.screen.blit(img, r);
            return r;
        }
        icon(typ, name, owner = 0, size = 40) {
            const key = py.tkey([typ, name, owner, size]);
            if (this.icons.has(key)) return this.icons.get(key);
            let ic = this.skin_icon(typ, name, owner, size);
            if (ic == null) {
                ic = new pygame.Surface([size, size], pygame.SRCALPHA);
                if (typ === 'x') this.draw_x_icon(ic, name, size);
                else ic.fill([90, 80, 60]);
            }
            this.icons.set(key, ic);
            return ic;
        }
        pcolor(owner) { return owner >= 0 && owner < this.world.players.length ? this.world.players[owner].color : [200, 200, 200]; }
        relation(owner) { return owner === 0 ? 'me' : owner < 0 ? 'gaia' : (this.world.allied(0, owner) ? 'ally' : 'enemy'); }
        civ_of(owner) { return this.world.players[owner].civ; }
        mods() { return 0; }
        hpbar(x, y, w, frac, owner) { pygame.draw.rect(this.screen, this.pcolor(owner), [x, y, Math.trunc(w * frac), 3]); }
        mm_rect() { return hud.MM_RECT; }
        world_to_mm(x, y) { return [hud.MM_RECT.centerx, hud.MM_RECT.centery]; }
        view_w() { return 1280; }
        view_h() { return 600; }
        get_buttons() { return this._buttons || []; }
    }
    py.mixin(FakeGame, hud.HudUI, defense_ui.DefenseUI);

    const g = new FakeGame();
    const cols = [[70, 130, 255], [225, 50, 40], [240, 215, 60]];
    const players = [0, 1, 2].map(i => new world.Player(i, i === 2 ? 0 : i, 'P' + i, cols[i], i > 0,
        ['franks', 'britons', 'mongols'][i]));
    const W = 40, H = 40;
    const amat = [[true, false, true], [false, true, false], [true, false, true]];
    const w = {
        players, units: [], buildings: [], nodes: [], animals: [], relics: [], time: 3725.4, winner: null,
        W, H, explored: new Uint8Array(W * H).fill(1), vis: new Uint8Array(W * H).fill(1), amat,
        messages: [['hello', 3, [255, 255, 255]]], pings: [[100, 100, 3720]], map_theme: 'grass', theme: 'grass',
        allied: (a, b) => amat[a][b], hostile: (a, b) => !amat[a][b], human_won: () => false,
        msg(t, c) { this.messages.push([t, this.time, c]); }, visible_px: () => true,
        build_age: (p, k) => data.BUILDINGS[k].age,
    };
    g.world = w;
    for (let i = 0; i < W * H; i += 3) w.vis[i] = 0;
    g.mm_base = new pygame.Surface([W, H]);
    g.mm_base.fill([80, 120, 60]);
    for (let i = 0; i < 12; i++) w.nodes.push(new world.Node(['tree', 'gold', 'stone', 'berries'][i % 4], 3 + i * 2, 5 + i));
    g.hud_reset();

    await check('hud_reset + hud_rects', () => g.hud_rects().length >= 4);
    await check('draw_top', () => { g.groups.set(1, []); g.draw_top(); return g.top_btn_rects.length === 5; });
    await check('draw_panel (nothing selected + minimap + score)', () => { g.draw_panel(); return g.mm_img != null; });
    g.clock_mode = 2;
    await check('draw_clock mode 2', () => { g.draw_clock(); });
    for (const m of [1, 2]) {
        await check('draw_minimap mode ' + m, () => { g.mm_mode = m; g.mm_img = null; g.draw_minimap(); g.draw_score(); });
    }
    g.mm_mode = 0;
    await check('grid_layout + draw_cmd_button', () => {
        const items = g.villager_items(players[0]);
        g._buttons = g.grid_layout(items, []);
        g.build_page = 'eco';
        const eco = g.grid_layout(g.villager_items(players[0]), []);
        for (const bt of [...g._buttons, ...eco]) g.draw_cmd_button(bt, bt.rect, bt.ok ? 'normal' : g.btn_state(bt));
        return eco.length > 5;
    });
    await check('draw_tip', () => {
        g.draw_tip(['Castle', { stone: 650, gold: 10 }, 'A strong building with a long description that wraps over lines for sure',
            ['red', 'Needs castle age'], ['dim', 'dim line']], 'Q', [['hp', '4800'], ['atk', '11'], ['arm', '8/11'], ['rng', '8']]);
    });
    await check('stat / stat_row / age_shield / pop_icon / res_icon', () => {
        g.stat(300, 300, 'atk', '5');
        for (const k of ['hp', 'arm', 'food', 'pop', 'work']) g.stat_row(300, 330, k, '1');
        for (let a = 0; a < 4; a++) g.age_shield(400 + a * 40, 300, a, 30, [120, 30, 20], a > 1);
        g.pop_icon(600, 300); g.res_icon('gold', 620, 300);
    });
    await check('procedural icons', () => {
        for (const [i, act] of hud.MM_BTNS.entries()) hud.mm_btn_icon(scr, act, [700 + i * 30, 300], 0, [255, 0, 0]);
        for (const m of [1, 2]) hud.mm_btn_icon(scr, 'mode', [820 + m * 30, 300], m, [255, 0, 0]);
        hud.hourglass(scr, 900, 300, 18, S.INK); hud.heart(scr, 930, 300); hud.idle_figure(scr, [960, 300]);
        hud.hammer(scr, 990, 300, [200, 200, 200]); hud.chat_icon(scr, [1020, 300]);
        const r = new pygame.Rect(1040, 280, 42, 42); hud.next_arrow(scr, r); hud.back_cross(scr, r.move(50, 0));
        hud.hp_glyph(scr, 1150, 300);
        return hud.wrap('a bb ccc dddd eeeee', g.fonts['m'], 40).length > 1;
    });
    await check('defense icons', () => {
        for (const n of ['bell', 'clear', 'eject', 'shield']) {
            const s = new pygame.Surface([40, 40], pygame.SRCALPHA);
            g.draw_x_icon(s, n, 40);
            scr.blit(s, [300 + ['bell', 'clear', 'eject', 'shield'].indexOf(n) * 44, 360]);
        }
    });
    await check('civ_ui.draw_card / draw_menu', () => {
        civ_ui.draw_menu(g);
        civ_ui.draw_card(g, 'random', civ_ui.RIGHT, true);
        return civ_ui.owner_civ(g, 1, 500, 500) > 500;
    });
    await check('civ_ui.draw_overlay', () => { civ_ui.draw_overlay(g); });
    scr.fill([60, 90, 50]);
    for (const win of ['objectives', 'diplomacy', 'chat', 'techtree']) {
        await check('window ' + win, () => {
            g.window = win;
            g.chat_log = [['hi', [255, 255, 255]]];
            g.draw_overlays();
            hud_windows.click(g, win, [0, 0]);
        });
    }
    await check('chat keys + send_chat', () => {
        g.window = 'chat';
        g.chat_text = '';
        for (const ch of 'ab') hud_windows.chat_key(g, new pygame.event.Event(pygame.KEYDOWN, { key: 97, unicode: ch }));
        hud_windows.chat_key(g, new pygame.event.Event(pygame.KEYDOWN, { key: pygame.K_BACKSPACE, unicode: '' }));
        const t0 = g.chat_text;
        hud_windows.chat_key(g, new pygame.event.Event(pygame.KEYDOWN, { key: pygame.K_RETURN, unicode: '' }));
        return t0 === 'a' && g.window == null && g.chat_log.length === 2 && g.chat_replies.length >= 1;
    });
    await check('techtree civ arrows', () => {
        g.window = 'techtree';
        const [la, ra] = hud_windows.tt_arrows();
        hud_windows.click_techtree(g, la.center);
        hud_windows.draw(g, 'techtree');
        return g.tt_civ !== 'franks';
    });
    g.window = null;
    await check('history / help / menu / gameover', () => {
        g.show_history = true; g.draw_overlays(); g.show_history = false;
        g.help = true; g.draw_overlays();
        g.help = 'menu'; g.draw_overlays();
        const [, items] = g.game_menu_rects();
        g.overlay_click(items[0][0].center);
        g.draw_gameover();
        return g.help === false;
    });
    await check('hud_key', () => {
        const e = k => new pygame.event.Event(pygame.KEYDOWN, { key: k, unicode: '' });
        g.hud_key(e(pygame.K_F4)); g.hud_key(e(pygame.K_F11)); g.hud_key(e(pygame.K_F5));
        return g.window === 'techtree' && g.show_score === false;
    });
    await check('economy_ui buttons + panels', () => {
        const p = players[0];
        p.res = { food: 500, wood: 500, gold: 500, stone: 500 };
        const items = [...economy_ui.market_buttons(g, null, p), ...economy_ui.mill_buttons(g, null, p)];
        const btns = g.grid_layout(items, []);
        scr.fill([30, 30, 30], [0, 600, 400, 200]);
        for (const bt of btns) g.draw_cmd_button(bt, bt.rect, 'normal');
        economy_ui.market_panel(g, { owner: 0 }, 300, 700);
        economy_ui.mill_panel(g, { owner: 0 }, 300, 740);
        economy_ui.cart_panel(g, { carry: 20, state: 'idle' }, 600, 700);
        return items.length >= 7;
    });
    pygame.display.flip();
    window.__results = { pass, fail, details };
} catch (e) {
    console.error(e);
    window.__results = { pass, fail: fail + 1, details, error: String(e && e.stack || e) };
}
