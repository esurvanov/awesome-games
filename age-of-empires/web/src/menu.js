// port of game/menu.py
// The main menu (a mixin of ui.Game) - the AoE2 DE layout:
// a column on the left: the title, three illustrated tiles (Single Player · Multiplayer · Learn to Play), an ornament,
// "News", "Exit"; top right - settings gear, profile, volume; on the right - the news feed;
// at the bottom center - the version line. The tiles are drawn from the game's sprites (game/menu_art.py).
//
// Screens (menu_screen): 'main' · 'single' (the "Single Player" window: Skirmish, Campaigns, Scenarios, Load Game) ·
// 'setup' (the lobby, game/lobby.py) · 'learn' (tutorial) · 'news' · 'settings' (game/settings_ui.py) ·
// 'load' (game/saves_ui.py) · 'credits' (CREDITS.md with scrolling).
//
// Browser: `git` answers come from the asset manifest (assets.git); CREDITS.md is a preloaded asset. The live
// panorama is rebuilt once when the unit sheets it shows have arrived (they are downloaded on demand).
import * as py from '../runtime/py.js';
import { os, random, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import { SCREEN_W, SCREEN_H, TOP_H, VIEW_H, TILE } from './data.js';
import * as i18n from './i18n.js';
import * as menu_art from './menu_art.js';
import * as S from './uiskin.js';
import * as W from './widgets.js';
import * as gsettings from './settings.js';

// browser-only: hint shown by the Exit tile instead of closing the game (no locale key exists for it)
const WEB_EXIT_HINT = {
    'en': 'Close the browser tab to exit', 'ru': 'Чтобы выйти, закройте вкладку браузера',
    'de': 'Zum Beenden den Browser-Tab schließen', 'fr': "Fermez l'onglet du navigateur pour quitter",
    'es': 'Cierra la pestaña del navegador para salir', 'pt-BR': 'Feche a aba do navegador para sair',
    'it': 'Chiudi la scheda del browser per uscire',
};
function web_exit_hint() {
    return WEB_EXIT_HINT[i18n.current()] || WEB_EXIT_HINT['en'];
}


export const ROOT = '';

// ---- main menu
export const COL = new pygame.Rect(0, 0, 400, SCREEN_H);                 // a dark column on the left (~1/3 of the width, as in DE)
export const TILE_W = 300, TILE_H = 146;
export const MAIN_TILES = [['single', 'menu.single'], ['multi', 'menu.multi'], ['learn', 'menu.learn']];     // locale keys
// the "Single Player" window: (action, caption key, available)
export const SINGLE_TILES = [['skirmish', 'menu.skirmish', true], ['campaign', 'menu.campaigns', false],
    ['scenario', 'menu.scenarios', false], ['load_game', 'menu.load_game', true]];
export const SINGLE_BOX = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 380 + py.floordiv(COL.w, 2) - 60, 170, 760, 420);

export const NEWS_STATIC = ['menu_de', 'match_options', 'saves', 'ai_levels'];       // news.<key>.title / .body

// tutorial cards: (icon, key; the title is learn.<key>.title, the lines are learn.<key>.1...n)
export const LEARN_CARDS = [['economics', 'eco', 3], ['construction', 'build', 2], ['call-to-arms', 'army', 2],
    ['upgrade', 'ages', 2], ['kill', 'victory', 2], ['encyclopaedia', 'keys', 2]];


export function _git(...args) {
    try {
        return py.strip(assets.git(args));
    } catch (e) {
        return '';
    }
}


export let _VERSION = null;
export let _NEWS = null;


export function version_line() {
    if (_VERSION == null) {
        _VERSION = [_git('rev-list', '--count', 'HEAD') || '0', _git('log', '-1', '--format=%cd', '--date=short')];
    }
    const [n, d] = _VERSION;
    return i18n.t('menu.version', { v: '0.9.' + n }) + (d ? ' · ' + i18n.t('menu.build', { date: d }) : '');
}


/** [(date, title)] - from the git history (if any), otherwise the built-in list. */
export function news() {
    if (_NEWS == null) {
        const raw = _git('log', '--no-merges', '--format=%cd|%s', '--date=short', '-14');
        const items = [];
        for (const ln of py.splitlines(raw)) {
            if (ln.includes('|')) {
                const [d, s] = py.split(ln, '|', 1);
                if (py.startswith(s.toLowerCase(), ['merge', 'слияние'])) continue;    // service commits
                items.push([d, s]);
            }
        }
        _NEWS = items;
    }
    return _NEWS.length ? _NEWS
        : NEWS_STATIC.map(k => ['', `${i18n.t('news.' + k + '.title')}: ${i18n.t('news.' + k + '.body')}`]);
}


export function _wrap(f, s, width) {
    const out = [];
    let cur = '';
    for (const wd of s.split(' ')) {
        const t = py.strip(cur + ' ' + wd);
        if (f.size(t)[0] > width && cur) {
            out.push(cur);
            cur = wd;
        } else {
            cur = t;
        }
    }
    if (cur) out.push(cur);
    return out;
}


export class MenuUI {
    // ============================================================ layout
    /** [(rect, action, caption)] of the main menu. */
    main_rects() {
        const items = [];
        const x = COL.centerx - py.floordiv(TILE_W, 2);
        MAIN_TILES.forEach(([act, lbl], i) => {
            items.push([new pygame.Rect(x, 150 + i * (TILE_H + 14), TILE_W, TILE_H), act, lbl]);
        });
        items.push([new pygame.Rect(x, 668, TILE_W, 36), 'news', 'menu.news']);
        items.push([new pygame.Rect(x, 714, TILE_W, 36), 'quit', 'menu.quit']);
        items.push([new pygame.Rect(SCREEN_W - 316, 10, 40, 40), 'settings', 'menu.settings']);
        items.push([new pygame.Rect(SCREEN_W - 268, 10, 200, 40), 'profile', 'menu.profile']);
        items.push([new pygame.Rect(SCREEN_W - 196, SCREEN_H - 96, 180, 32), 'credits', 'menu.credits']);
        return items;
    }

    single_rects() {
        const b = SINGLE_BOX;
        const items = [];
        const tw = 164, th = 250;
        SINGLE_TILES.forEach(([act, lbl, ok], i) => {
            items.push([new pygame.Rect(b.x + 24 + i * (tw + 16), b.y + 70, tw, th), act, ok]);
        });
        items.push([new pygame.Rect(b.centerx - 110, b.bottom - 62, 220, 40), 'back', true]);
        return items;
    }

    learn_rects() {
        const cx = py.floordiv(COL.right + SCREEN_W, 2);
        const items = [[new pygame.Rect(cx - 280, SCREEN_H - 90, 260, 44), 'tutorial', null],
            [new pygame.Rect(cx + 20, SCREEN_H - 90, 260, 44), 'back', null]];
        return items;
    }

    /** [(rect, action, value)] - the active elements of the current menu screen. */
    menu_items() {
        const scr = this.menu_screen;
        if (scr === 'setup') {
            if (this.picker != null) return this.picker_rects()[1];
            return this.setup_rects();
        }
        if (scr === 'single') return this.single_rects().map(([r, act, ok]) => [r, act, ok]);
        if (scr === 'learn') return this.learn_rects();
        if (scr === 'credits' || scr === 'news')
            return [[new pygame.Rect(py.floordiv(SCREEN_W, 2) - 110, SCREEN_H - 70, 220, 44), 'back', null]];
        if (scr === 'settings') return this.settings_rects();
        if (scr === 'load') return this.saves_rects();
        return this.main_rects().map(([r, act]) => [r, act, null]);
    }

    // ============================================================ actions
    menu_action(act, val) {
        this.audio.click();
        if (act === 'single') {
            this.menu_screen = 'single';
        } else if (act === 'profile') {
            this.open_settings(this.menu_screen, 'interface');
        } else if (act === 'multi') {
            this.menu_toast = [i18n.t('menu.multi_later'), pygame.time.get_ticks()];
        } else if (act === 'learn') {
            this.menu_screen = 'learn';
        } else if (act === 'tutorial') {
            this.start_tutorial();
        } else if (act === 'news') {
            this.menu_screen = 'news';
            this.news_scroll = 0;
        } else if (act === 'skirmish') {
            this.menu_screen = 'setup';
            this.picker = null;
            this.dropdown = null;
        } else if (act === 'campaign' || act === 'scenario') {
            this.menu_toast = [i18n.t('menu.campaigns_soon'), pygame.time.get_ticks()];
        } else if (act === 'load_game') {
            this.open_saves('load', 'single');
        } else if (act === 'settings') {
            this.open_settings(this.menu_screen);
        } else if (act === 'credits') {
            this.menu_screen = 'credits';
            this.credits_scroll = 0;
        } else if (act === 'back') {
            this.menu_screen = py.get({ 'setup': 'single', 'single': 'main' }, this.menu_screen, 'main');
            this.picker = null;
            this.dropdown = null;
        } else if (act === 'quit') {
            // browser: there is no desktop to quit to; closing the page would only force a full reload
            this.menu_toast = [web_exit_hint(), pygame.time.get_ticks()];
        } else if (this.menu_screen === 'setup') {
            this.lobby_action(act, val);
        } else if (this.menu_screen === 'settings') {
            this.settings_action(act, val);
        } else if (this.menu_screen === 'load') {
            this.saves_action(act, val);
        }
    }

    /** Tutorial match: one "Easiest" opponent, a 20-minute treaty, normal speed. */
    start_tutorial() {
        const st = { treaty: 20, speed: 1.5 };
        this.begin_loading({
            diff: 0, opponents: 1, map_type: 'land', civs: ['franks', 'britons'], teams: [0, 1],
            colors: null, levels: [null, 0], settings: st,
        });
    }

    menu_event(e) {
        const scr = this.menu_screen;
        if (scr === 'settings' && this.settings_event(e)) return;
        if (scr === 'load' && this.saves_event(e)) return;
        if (e.type === pygame.MOUSEBUTTONDOWN && e.button === 1) {
            if (scr === 'setup' && this.lobby_click(e.pos)) return;
            for (const [r, act, val] of this.menu_items()) {
                if (r.collidepoint(e.pos)) {
                    this.menu_action(act, val);
                    return;
                }
            }
            if (scr === 'single' && !SINGLE_BOX.collidepoint(e.pos)) this.menu_screen = 'main';
        } else if (e.type === pygame.MOUSEWHEEL && (scr === 'credits' || scr === 'news')) {
            if (scr === 'credits') this.credits_scroll -= e.y * 60;
            else this.news_scroll -= e.y * 60;
        } else if (e.type === pygame.MOUSEBUTTONDOWN && (e.button === 4 || e.button === 5) && scr === 'credits') {
            this.credits_scroll += e.button === 5 ? 60 : -60;
        } else if (e.type === pygame.KEYDOWN) {
            const k = e.key;
            if (k === pygame.K_ESCAPE) {
                if (scr === 'setup' && (this.picker != null || this.dropdown != null)) {
                    this.picker = null;
                    this.dropdown = null;
                } else if (scr !== 'main') {
                    this.menu_action('back', null);
                }
                // browser: Esc on the main menu does nothing (Python quits the app here)
            } else if ([pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE].includes(k)) {
                if (scr === 'main') this.menu_action('single', null);
                else if (scr === 'single') this.menu_action('skirmish', null);
                else if (scr === 'setup' && this.picker == null && this.dropdown == null) this.menu_action('play', null);
            } else if (scr === 'credits' && [pygame.K_DOWN, pygame.K_UP, pygame.K_PAGEDOWN, pygame.K_PAGEUP].includes(k)) {
                const step = new Map([[pygame.K_DOWN, 40], [pygame.K_UP, -40], [pygame.K_PAGEDOWN, 400], [pygame.K_PAGEUP, -400]]).get(k);
                this.credits_scroll += step;
            }
        }
    }

    // ============================================================ background
    menu_background() {
        let bg = py.getattr(this, 'menu_bg', null);
        if (bg != null) return bg;
        bg = null;
        if (gsettings.get('live_menu_bg', true)) {
            try {
                bg = this.render_vista();
            } catch (e) {           // the background is decoration: on any error - a stone wall
                console.warn('menu panorama failed', e);
                bg = null;
                this.world = null;
            }
        }
        if (bg == null) bg = S.tiled('skin/stone_dark.png', [SCREEN_W, SCREEN_H], [150, 140, 128]).copy();
        const tint = new pygame.Surface([SCREEN_W, SCREEN_H], pygame.SRCALPHA);
        tint.fill([40, 22, 6, 50]);
        bg.blit(tint, [0, 0]);
        this.menu_bg = bg;
        this._rt_vista_refresh(bg);
        return bg;
    }

    /** Browser: the panorama was drawn while some unit sheets were still downloading (placeholders) - fetch them and
     *  rebuild the background once they are in (once per session, only if the same background is still shown). */
    _rt_vista_refresh(bg) {
        const paths = py.getattr(this, '_rt_vista_paths', null);
        this._rt_vista_paths = null;
        if (!paths || py.getattr(this, '_rt_vista_retried', false)) return;
        const missing = paths.filter(p => !assets.is_loaded(p));
        if (!missing.length) return;
        this._rt_vista_retried = true;
        Promise.allSettled(missing.map(p => assets.request([p]))).then(() => {
            if (this.menu_bg === bg && this.state === 'menu') this.menu_bg = null;
        });
    }

    /** A panorama: a small town on the game's map (real sprites), softly blurred. */
    render_vista() {
        const state = random.getstate();
        const saved = [this.state, { ...this.menu_cfg }];
        const zoom = this.zoom;
        this.zoom = this.zoom_to = 1.0;     // the panorama is always at the normal scale
        try {
            random.seed(11);
            this.new_game(1, 1, undefined, undefined, 'coast', undefined, ['britons', 'franks']);
            const w = this.world;
            const p = w.players[0];
            for (const t of ['feudal', 'castle']) w.apply_tech(p, t);
            const [sx, sy] = w.starts[0];
            const plan = ['castle', 'market', 'barracks', 'monastery', 'house', 'house', 'blacksmith', 'house', 'stable',
                'house', 'archery_range', 'house', 'mill', 'farm', 'farm', 'tower', 'house', 'lumber_camp'];
            for (const kind of plan) {
                let done = false;
                for (let r = 4; r < 14; r++) {
                    for (let dx = -r; dx < r + 1; dx++) {
                        for (const dy of [-r, r, dx]) {
                            if (!done && w.can_place(kind, sx + dx, sy + dy, 0, false)
                                    && random.random() < 0.35) {
                                w.place_building(kind, 0, sx + dx, sy + dy, true);
                                done = true;
                            }
                        }
                    }
                    if (done) break;
                }
            }
            w.ais = [];
            for (let i = 0; i < 160; i++) w.update(0.05);
            w.events.length = 0;
            w.vis = new Uint8Array(w.W * w.H).fill(1);
            w.explored = new Uint8Array(w.W * w.H).fill(1);
            for (const b of w.buildings) b.seen = true;
            w.fog_version += 1;
            this.selected = [];
            this.center_on(sx * TILE + 2 * TILE, sy * TILE + 2 * TILE);
            try {
                this._rt_vista_paths = modules.screens._rt_sheet_paths(this, w);
            } catch (e) {
                this._rt_vista_paths = null;
            }
            const cx = this.cam_x - 200, cy = this.cam_y - (SCREEN_H - VIEW_H) / 2;
            const out = new pygame.Surface([SCREEN_W, SCREEN_H]);
            let y = 0;
            while (y < SCREEN_H) {
                [this.cam_x, this.cam_y] = [cx, cy + y];
                this.screen.fill([0, 0, 0]);
                this.draw_world();
                const h = Math.min(VIEW_H, SCREEN_H - y);
                out.blit(this.screen, [0, y], [0, TOP_H, SCREEN_W, h]);
                y += h;
            }
            const small = pygame.transform.smoothscale(out, [py.floordiv(SCREEN_W, 2), py.floordiv(SCREEN_H, 2)]);
            return pygame.transform.smoothscale(small, [SCREEN_W, SCREEN_H]);
        } finally {
            random.setstate(state);
            this.zoom = this.zoom_to = zoom;
            this.world = null;
            const [st, cfg] = saved;
            this.state = st;
            for (const k of Object.keys(this.menu_cfg)) delete this.menu_cfg[k];
            Object.assign(this.menu_cfg, cfg);
        }
    }

    // ============================================================ drawing
    draw_menu() {
        const scr = this.screen;
        scr.blit(this.menu_background(), [0, 0]);
        const s = this.menu_screen;
        if (s === 'setup') {
            this.draw_setup();
        } else if (s === 'credits') {
            this.draw_credits();
        } else if (s === 'settings') {
            this.draw_settings_screen();
        } else if (s === 'load') {
            this.draw_saves();
        } else {
            this.draw_main();
            if (s === 'single') this.draw_single();
            else if (s === 'news') this.draw_news();
            else if (s === 'learn') this.draw_learn();
        }
        const toast = py.getattr(this, 'menu_toast', null);
        if (toast && pygame.time.get_ticks() - toast[1] < 2200) {
            const r = new pygame.Rect(0, 0, 420, 44);
            r.center = [py.floordiv(SCREEN_W, 2) + 180, SCREEN_H - 90];
            W.box(scr, r, 200);
            S.text(scr, toast[0], r.center, this.fonts['b'], [255, 236, 190], 'center');
        }
        if (s !== 'setup') this.audio.draw_icon(scr, SCREEN_W - 58, 20);
    }

    draw_main() {
        const scr = this.screen;
        // column: dark stone + a golden edge on the right
        const col = S.tiled('skin/stone_dark.png', COL.size, [170, 150, 128]);
        scr.blit(col, COL.topleft);
        S.vignette(scr, COL, 120);
        pygame.draw.line(scr, [20, 12, 6], [COL.right, 0], [COL.right, SCREEN_H], 4);
        pygame.draw.line(scr, S.GOLD_DK, [COL.right - 3, 0], [COL.right - 3, SCREEN_H], 2);
        // title
        py.split(i18n.t('app.title').toUpperCase(), ' ', 1).forEach((part, i) => {
            const img = S.gold_text(part, this.fonts['xl']);
            scr.blit(img, img.get_rect({ center: [COL.centerx, 50 + i * 48] }));
        });
        const mp = pygame.mouse.get_pos();
        const pressed = pygame.mouse.get_pressed()[0];
        const modal = this.menu_screen !== 'main';
        for (let [r, act, lbl] of this.main_rects()) {
            lbl = i18n.t(lbl);
            const h = r.collidepoint(mp) && !modal;
            if (act === 'single' || act === 'multi' || act === 'learn') {
                const art = menu_art.tile_art(act, [r.w, r.h - 30]);
                scr.blit(art, r.topleft);
                const strip = new pygame.Rect(r.x, r.bottom - 30, r.w, 30);
                W.red_button(scr, strip, lbl, act !== 'multi' ? this.fonts['btn'] : this.fonts['l'],
                    h ? 'hover' : 'normal');
                pygame.draw.rect(scr, h ? S.GOLD_HI : [120, 90, 50], r, 2);
                if (act === 'multi') {
                    S.shade_overlay(scr, r, [30, 24, 20], 110);
                    S.text(scr, i18n.t('menu.soon'), [r.right - 40, r.y + 18], this.fonts['bs'], [250, 230, 190],
                        'center');
                }
            } else if (act === 'credits') {
                W.red_button(scr, r, lbl, this.fonts['bs'], h ? 'hover' : 'normal');
            } else if (act === 'news' || act === 'quit') {
                W.red_button(scr, r, lbl, this.fonts['btn'], (h && pressed) ? 'pressed' : h ? 'hover' : 'normal');
            } else if (act === 'settings') {
                S.slot(scr, r, h ? 'hover' : 'normal');
                S.blit_icon(scr, 'match-settings', r.center, 30);
                S.icon_frame(scr, r, h ? 'hover' : 'normal');
            } else if (act === 'profile') {
                W.red_button(scr, r, '', this.fonts['b'], h ? 'hover' : 'normal');
                const civ_ui = modules.civ_ui;
                civ_ui.blit_emblem(this, this.cfg_defaults()['slots'][0]['civ'], [r.x + 4, r.y + 3, 30, 34]);
                S.text_fit(scr, i18n.player_name(), [r.x + 42, r.y + 12], this.fonts['b'],
                    [255, 240, 205], 'midleft', [30, 8, 4], r.w - 50);
                S.text_fit(scr, i18n.t('menu.single_mode'), [r.x + 42, r.y + 29], this.fonts['s'], [230, 200, 170],
                    'midleft', null, r.w - 50);
            }
        }
        // ornament above "News"
        const y = 648;
        pygame.draw.line(scr, S.GOLD_DK, [COL.centerx - 120, y], [COL.centerx + 120, y], 2);
        const pts = [[COL.centerx, y - 8], [COL.centerx + 8, y], [COL.centerx, y + 8], [COL.centerx - 8, y]];
        pygame.draw.polygon(scr, S.GOLD, pts);
        // the news feed on the right (like DE's event feed)
        if (this.menu_screen === 'main') this.draw_feed(new pygame.Rect(SCREEN_W - 400, 70, 380, 330));
        // version at the bottom center
        S.text(scr, version_line(), [py.floordiv(COL.right + SCREEN_W, 2), SCREEN_H - 34], this.fonts['bs'],
            [240, 226, 196], 'center');
        S.text_fit(scr, i18n.t('menu.credits_line'), [py.floordiv(COL.right + SCREEN_W, 2), SCREEN_H - 16], this.fonts['s'],
            [200, 188, 160], 'center', undefined, SCREEN_W - COL.right - 20);
    }

    draw_feed(box) {
        const scr = this.screen;
        let y = box.y;
        for (const [d, s] of news().slice(0, 4)) {
            const hdr = new pygame.Rect(box.x, y, box.w, 26);
            W.red_button(scr, hdr, d || i18n.t('menu.new'), this.fonts['bs']);
            let lines = _wrap(this.fonts['m'], s, box.w - 20);
            if (lines.length > 2) {
                lines = lines.slice(0, 2);
                lines[1] = py.rstrip(lines[1], ' ,.:;—') + '…';
            }
            const body = new pygame.Rect(box.x, hdr.bottom, box.w, 8 + 18 * lines.length);
            S.shade_overlay(scr, body, [10, 6, 2], 170);
            lines.forEach((ln, j) => {
                S.text(scr, ln, [body.centerx, body.y + 13 + j * 18], this.fonts['m'], [240, 230, 206],
                    'center');
            });
            y = body.bottom + 8;
            if (y > box.bottom) break;
        }
    }

    // ---- the "Single Player" window
    draw_single() {
        const scr = this.screen;
        S.shade_overlay(scr, [COL.right, 0, SCREEN_W - COL.right, SCREEN_H], undefined, 120);
        const b = SINGLE_BOX;
        S.panel(scr, b, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], b, 2);
        W.plate(scr, [b.centerx, b.y + 30], i18n.t('menu.single'), this.fonts['h'], 340);
        const mp = pygame.mouse.get_pos();
        const art_of = { 'skirmish': 'skirmish', 'campaign': 'campaign', 'scenario': 'scenario', 'load_game': 'load' };
        for (const [r, act, ok] of this.single_rects()) {
            const h = r.collidepoint(mp);
            if (act === 'back') {
                W.red_button(scr, r, i18n.t('common.cancel'), this.fonts['b'], h ? 'hover' : 'normal');
                continue;
            }
            const lbl = i18n.t(SINGLE_TILES.find(([a]) => a === act)[1]);
            const art = menu_art.tile_art(art_of[act], [r.w, r.h - 34]);
            scr.blit(art, r.topleft);
            W.red_button(scr, new pygame.Rect(r.x, r.bottom - 34, r.w, 34), lbl, this.fonts['b'],
                !ok ? 'disabled' : h ? 'hover' : 'normal');
            pygame.draw.rect(scr, (h && ok) ? S.GOLD_HI : [120, 84, 40], r, 2);
            if (!ok) {
                S.shade_overlay(scr, new pygame.Rect(r.x, r.y, r.w, r.h - 34), [60, 50, 40], 90);
                S.text(scr, i18n.t('menu.soon'), [r.centerx, r.y + 22], this.fonts['b'], [255, 240, 210], 'center');
            }
        }
    }

    // ---- tutorial
    draw_learn() {
        const scr = this.screen;
        S.shade_overlay(scr, [COL.right, 0, SCREEN_W - COL.right, SCREEN_H], undefined, 150);
        const box = new pygame.Rect(COL.right + 30, 40, SCREEN_W - COL.right - 60, SCREEN_H - 140);
        S.panel(scr, box, 'parchment', false);
        W.plate(scr, [box.centerx, box.y + 32], i18n.t('menu.learn_title'), this.fonts['h'], 380);
        const cw = py.floordiv(box.w - 60, 3), ch = 250;
        LEARN_CARDS.forEach(([ic, key, n], i) => {
            const r = new pygame.Rect(box.x + 20 + (i % 3) * (cw + 10), box.y + 70 + py.floordiv(i, 3) * (ch + 12), cw, ch);
            W.box(scr, r, 40);
            S.blit_icon(scr, ic, [r.centerx, r.y + 48], 64);
            S.text_fit(scr, i18n.t(`learn.${key}.title`), [r.centerx, r.y + 100], this.fonts['l'], W.INK, 'center',
                null, r.w - 20);
            let y = r.y + 130;
            for (let j = 0; j < n; j++) {
                const row = i18n.t(`learn.${key}.${j + 1}`);
                for (const ln of _wrap(this.fonts['m'], row, r.w - 24)) {
                    S.text(scr, ln, [r.centerx, y], this.fonts['m'], W.INK, 'center', null);
                    y += 19;
                }
                y += 6;
            }
        });
        const mp = pygame.mouse.get_pos();
        for (const [r, act] of this.learn_rects()) {
            W.red_button(scr, r, act === 'tutorial' ? i18n.t('menu.tutorial') : i18n.t('common.back'), this.fonts['b'],
                r.collidepoint(mp) ? 'hover' : 'normal', act === 'tutorial' ? 'call-to-arms' : null);
        }
    }

    // ---- news
    draw_news() {
        const scr = this.screen;
        S.shade_overlay(scr, [COL.right, 0, SCREEN_W - COL.right, SCREEN_H], undefined, 150);
        const box = new pygame.Rect(COL.right + 60, 40, SCREEN_W - COL.right - 120, SCREEN_H - 130);
        S.panel(scr, box, 'parchment', false);
        W.plate(scr, [box.centerx, box.y + 32], i18n.t('menu.news'), this.fonts['h'], 300);
        const view = new pygame.Rect(box.x + 30, box.y + 70, box.w - 60, box.h - 90);
        const items = news();
        const total = items.length * 56;
        this.news_scroll = Math.max(0, Math.min(Math.max(0, total - view.h), this.news_scroll));
        const clip = scr.get_clip();
        scr.set_clip(view);
        let y = view.y - this.news_scroll;
        for (const [d, s] of items) {
            S.blit_icon(scr, 'upgrade', [view.x + 16, y + 20], 26);
            S.text(scr, d, [view.x + 40, y + 8], this.fonts['bs'], [140, 40, 20], undefined, null);
            const lines = _wrap(this.fonts['m'], s, view.w - 60).slice(0, 2);
            lines.forEach((ln, j) => {
                S.text(scr, ln, [view.x + 40, y + 26 + j * 17], this.fonts['m'], W.INK, undefined, null);
            });
            y += 56;
        }
        scr.set_clip(clip);
        const mp = pygame.mouse.get_pos();
        for (const [r] of this.menu_items()) {
            W.red_button(scr, r, i18n.t('common.back'), this.fonts['b'], r.collidepoint(mp) ? 'hover' : 'normal');
        }
    }

    // ---- credits
    /** CREDITS.md -> [(style, text)]; styles: h1 h2 h3 p li q tr. */
    credits_lines() {
        if (this._credits != null) return this._credits;
        const lines = [];
        let raw;
        try {
            raw = py.splitlines(assets.read_text(os.path.join(ROOT, 'CREDITS.md')));
        } catch (e) {
            raw = ['# Credits', i18n.t('menu.credits_missing')];
        }
        const merged = [];
        for (const ln of raw) {
            const st = py.strip(ln);
            const plain = st && !py.startswith(st, ['#', '- ', '* ', '|', '>']);
            if (plain && merged.length && py.strip(merged[merged.length - 1])
                    && !py.startswith(py.lstrip(merged[merged.length - 1]), ['#', '|'])) {
                merged[merged.length - 1] = py.rstrip(merged[merged.length - 1]) + ' ' + st;
            } else {
                merged.push(ln);
            }
        }
        raw = merged;
        const wrap_w = 900;
        for (const ln of raw) {
            let s = py.rstrip(ln);
            if (!py.strip(s)) {
                lines.push(['gap', '']);
                continue;
            }
            let style = 'p';
            if (s.startsWith('### ')) {
                [style, s] = ['h3', s.slice(4)];
            } else if (s.startsWith('## ')) {
                [style, s] = ['h2', s.slice(3)];
            } else if (s.startsWith('# ')) {
                [style, s] = ['h1', s.slice(2)];
            } else if (py.startswith(py.lstrip(s), ['- ', '* '])) {
                [style, s] = ['li', py.lstrip(s).slice(2)];
            } else if (s.startsWith('>')) {
                [style, s] = ['q', py.lstrip(s, '> ')];
            } else if (s.startsWith('|')) {
                if (Array.from(py.strip(s.replaceAll('|', ''))).every(c => '-: '.includes(c))) continue;
                [style, s] = ['tr', py.strip(s, '|').split('|').map(c => py.strip(c)).join('  ·  ')];
            }
            s = s.replace(/\*\*(.+?)\*\*/g, '$1');
            s = s.replace(/`(.+?)`/g, '$1');
            s = s.replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
            s = s.replaceAll('<', '').replaceAll('>', '');
            const f = this.credits_font(style);
            const words = s.split(' ');
            let cur = '';
            let first = true;
            for (const wd of words) {
                const t = py.strip(cur + ' ' + wd);
                if (f.size(t)[0] > wrap_w - (style === 'li' ? 24 : 0) && cur) {
                    lines.push([first ? style : style + '+', cur]);
                    first = false;
                    cur = wd;
                } else {
                    cur = t;
                }
            }
            lines.push([first ? style : style + '+', cur]);
        }
        this._credits = lines;
        return lines;
    }

    credits_font(style) {
        style = py.rstrip(style, '+');
        return py.get({ 'h1': this.fonts['h'], 'h2': this.fonts['l'], 'h3': this.fonts['btn'] },
            style, style === 'tr' ? this.fonts['s'] : this.fonts['m']);
    }

    draw_credits() {
        const scr = this.screen;
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 500, 40, 1000, SCREEN_H - 130);
        S.panel(scr, box, 'parchment', false);
        const view = box.inflate(-80, -60);
        const lines = this.credits_lines();
        const heights = [];
        for (const [style] of lines) {
            const st = py.rstrip(style, '+');
            heights.push(py.get({ 'gap': 8, 'h1': 40, 'h2': 32, 'h3': 28 }, st, 19));
        }
        const total = py.sum(heights);
        this.credits_scroll = Math.max(0, Math.min(Math.max(0, total - view.h), this.credits_scroll));
        const clip = scr.get_clip();
        scr.set_clip(view);
        let y = view.y - this.credits_scroll;
        lines.forEach(([style, s], idx) => {
            const h = heights[idx];
            if (y + h >= view.y && y <= view.bottom) {
                const st = py.rstrip(style, '+');
                const f = this.credits_font(style);
                let x = view.x;
                let col = S.INK;
                if (st === 'h1' || st === 'h2') {
                    col = [110, 40, 20];
                } else if (st === 'h3') {
                    col = [90, 50, 20];
                } else if (st === 'q') {
                    col = [80, 60, 30];
                    x += 20;
                    pygame.draw.line(scr, [150, 110, 60], [view.x + 6, y], [view.x + 6, y + h], 3);
                } else if (st === 'li') {
                    x += 24;
                    if (!style.endsWith('+')) pygame.draw.circle(scr, [120, 70, 30], [view.x + 10, y + 9], 3);
                } else if (st === 'tr') {
                    x += 12;
                }
                if (st !== 'gap') S.text(scr, s, [x, y], f, col, undefined, null);
                if ((st === 'h1' || st === 'h2') && !style.endsWith('+'))
                    pygame.draw.line(scr, [150, 110, 60], [view.x, y + h - 6], [view.right, y + h - 6], 1);
            }
            y += h;
        });
        scr.set_clip(clip);
        if (total > view.h) {
            const track = new pygame.Rect(box.right - 24, view.y, 8, view.h);
            pygame.draw.rect(scr, [150, 120, 80], track, 0, 4);
            const th = Math.max(30, Math.trunc(view.h * view.h / total));
            const ty = view.y + Math.trunc((view.h - th) * this.credits_scroll / Math.max(1, total - view.h));
            pygame.draw.rect(scr, [100, 60, 24], [track.x, ty, 8, th], 0, 4);
        }
        const mp = pygame.mouse.get_pos();
        for (const [r] of this.menu_items()) {
            W.red_button(scr, r, i18n.t('common.back'), this.fonts['b'], r.collidepoint(mp) ? 'hover' : 'normal');
        }
    }
}
py.classattrs(MenuUI, {
    menu_screen: 'main',
    credits_scroll: 0,
    news_scroll: 0,
    _credits: null,
});
