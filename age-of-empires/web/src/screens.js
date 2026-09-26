// port of game/screens.py
// Screens around a match (a mixin of ui.Game, placed before HudUI - overrides the match menu and the game end):
//
//   * the loading screen (lobby -> game): a map preview, players, a tip, a progress bar; the world is built in steps;
//   * the F10 menu: Return · Save · Load · Restart · Objectives · Controls · Civilization ·
//     Settings · Resign · Exit to menu · Exit game (dangerous ones - with confirmation);
//   * "Victory!/Defeat" -> "Achievements" (6 tabs: Summary, Military, Economy, Technology, Society, Timeline
//     with a population graph) -> "Play again" / "Main menu";
//   * autosave, quick save/load (F7/F8, game/keymap.py), "Lock speed".
// The settings and saves windows - game/settings_ui.py, game/saves_ui.py.
//
// Browser: unit sprite sheets are not preloaded (assets.js); before the loading screen switches to the match it also
// waits (without blocking - the step is simply not advanced) until the sheets of every player's starting units are in.
import * as py from '../runtime/py.js';
import { random, modules, time } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import { SCREEN_W, SCREEN_H, PLAYER_COLORS, AGE_NAMES } from './data.js';
import * as civ_ui from './civ_ui.js';
import * as i18n from './i18n.js';
import * as keymap from './keymap.js';
import * as match from './match.js';
import * as naval from './naval.js';
import * as savegame from './savegame.js';
import * as scoring from './scoring.js';
import * as S from './uiskin.js';
import * as W from './widgets.js';
import * as gsettings from './settings.js';
import { SettingsUI } from './settings_ui.js';
import { SavesUI } from './saves_ui.js';

// captions are locale keys (gm.*, confirm.*, tip.<n>, stats.*)
export const GAME_MENU = [['resume', 'gm.resume', 'call-to-arms'], ['save', 'gm.save', 'construction'],
    ['load', 'gm.load', 'upgrade'], ['restart', 'gm.restart', 'repair'],
    ['objectives', 'gm.objectives', 'victory'], ['help', 'gm.help', 'encyclopaedia'],
    ['civ', 'gm.civ', 'diplomacy'], ['settings', 'menu.settings', 'match-settings'],
    ['resign', 'gm.resign', 'defeat'], ['quit', 'gm.quit', 'cancel'],
    ['exit', 'gm.exit', 'cancel']];
export const CONFIRM = { 'restart': 'confirm.restart', 'resign': 'confirm.resign', 'quit': 'confirm.quit', 'exit': 'confirm.exit' };

export const TIPS = py.range(1, 13).map(i => py.percent('tip.%d', [i]));

export const STAT_TABS = [['score', 'stats.score', 'victory'], ['military', 'stats.military', 'kill'],
    ['economy', 'stats.economy', 'economics'], ['tech', 'stats.tech', 'upgrade'],
    ['society', 'stats.society', 'population'], ['timeline', 'stats.timeline', 'time']];


export function _clock(t) {
    if (t == null) return '—';
    t = Math.trunc(t);
    return t >= 3600
        ? `${py.floordiv(t, 3600)}:${py.fmt(py.mod(py.floordiv(t, 60), 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}`
        : `${py.fmt(py.floordiv(t, 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}`;
}

/** [(caption, icon, function(w, p, s, sc) -> a number or None, format)] for the achievements tab. */
export function stat_columns(tab) {
    const T = i18n.t;
    if (tab === 'score') {
        return [[T('score.military'), 'kill', (w, p, s, sc) => sc['military'], null],
            [T('score.economy'), 'economics', (w, p, s, sc) => sc['economy'], null],
            [T('score.technology'), 'upgrade', (w, p, s, sc) => sc['technology'], null],
            [T('score.society'), 'population', (w, p, s, sc) => sc['society'], null],
            [T('stats.total'), 'victory', (w, p, s, sc) => sc['total'], null]];
    }
    if (tab === 'military') {
        return [[T('stats.kills'), 'kill', (w, p, s, sc) => s['kills'], null],
            [T('stats.losses'), 'defeat', (w, p, s, sc) => s['losses'], null],
            [T('stats.razed'), 'repair', (w, p, s, sc) => s['razed'], null],
            [T('stats.bld_lost'), 'construction', (w, p, s, sc) => s['bld_lost'], null],
            [T('stats.converted'), 'heal', (w, p, s, sc) => s['converted'], null],
            [T('stats.army_max'), 'call-to-arms', (w, p, s, sc) => s['army_max'], null]];
    }
    if (tab === 'economy') {
        return [[T('res.food'), 'food', (w, p, s, sc) => Math.trunc(py.get(p.gathered, 'food', 0)), null],
            [T('res.wood'), 'wood', (w, p, s, sc) => Math.trunc(py.get(p.gathered, 'wood', 0)), null],
            [T('res.gold'), 'gold', (w, p, s, sc) => Math.trunc(py.get(p.gathered, 'gold', 0)), null],
            [T('res.stone'), 'stone', (w, p, s, sc) => Math.trunc(py.get(p.gathered, 'stone', 0)), null],
            [T('stats.trib_sent'), 'bribes', (w, p, s, sc) => Math.trunc(s['trib_sent']), null],
            [T('stats.trib_recv'), 'bribes', (w, p, s, sc) => Math.trunc(s['trib_recv']), null],
            [T('stats.trade'), 'economics', (w, p, s, sc) => Math.trunc(s['trade']), null]];
    }
    if (tab === 'tech') {
        return [[T('age.short.1'), null, (w, p, s, sc) => s['age_t'][1], 'time'],
            [T('age.short.2'), null, (w, p, s, sc) => s['age_t'][2], 'time'],
            [T('age.short.3'), null, (w, p, s, sc) => s['age_t'][3], 'time'],
            [T('stats.techs'), 'upgrade', (w, p, s, sc) => s['techs'], null],
            [T('stats.explored'), 'portraits/technologies/cartography.png',
                (w, p, s, sc) => Math.trunc(py.round(s['explored'] * 100)), '%']];
    }
    if (tab === 'society') {
        return [[T('stats.castles'), 'production', (w, p, s, sc) => s['castles'], null],
            [T('stats.vil_max'), 'economics', (w, p, s, sc) => s['vil_max'], null],
            [T('stats.pop_max'), 'population', (w, p, s, sc) => s['pop_max'], null],
            [T('stats.wonders'), 'victory', (w, p, s, sc) => null, null],
            [T('stats.relics'), 'heal', (w, p, s, sc) => null, null]];
    }
    return [];
}


/** Browser addition: asset paths of the unit sheets the world's current units and animals are drawn with
 *  (villagers - both looks), for waiting on them before a match starts / before the menu panorama is cached. */
export function _rt_sheet_paths(game, w) {
    const sprites3d = modules.sprites3d;
    const out = new Set();
    const add = lst => { for (const p of lst) out.add(p); };
    for (const u of w.units) {
        const civ = game.civ_of(u.owner);
        add(sprites3d.sheet_paths(u.look(), civ, false));
        if (u.kind === 'villager') add(sprites3d.sheet_paths(u.look(), civ, true));
    }
    for (const a of (w.animals || [])) add(sprites3d.sheet_paths('animal_' + a.kind, null));
    return Array.from(out);
}

export const _RT_SHEET_WAIT = 30.0;      // seconds: never hold the loading screen longer than this for sprites


export class ScreensUI {
    apply_startup_settings() {
        this.settings = gsettings.data();        // the live settings dict (hud.py reads it through hud_opt)
        const cur = py.getattr(this, 'cursors', null);
        if (cur != null) {
            cur.enabled = py.bool(gsettings.get('cursor', true));
            let soft = gsettings.get('cursor_soft');
            if (soft == null) {                    // auto: on Retina (window scale > 1) - the software cursor
                soft = S.backing_scale() > 1.0;
            }
            cur.set_soft(py.bool(soft));
        }
        if (gsettings.get('fullscreen')) {
            try {
                pygame.display.toggle_fullscreen();
            } catch (e) { /* ignore */ }
        }
    }

    // ============================================================ loading
    begin_loading(args) {
        this.load_args = { ...args };
        this.load_step = 0;
        this.load_t0 = pygame.time.get_ticks();
        this.load_tip = random.choice(TIPS);
        this.load_prev = null;
        this.picker = null;
        this.dropdown = null;
        this.state = 'loading';
        this._rt_sheets = null;
    }

    /** One step of the loading screen: draw, then carry out the next step of building the match. */
    loading_frame(fast = false) {
        const steps = ['load.step1', 'load.step2', 'load.step3', 'load.done'];
        this.draw_loading(this.load_step / (steps.length - 1), i18n.t(steps[Math.min(this.load_step, steps.length - 1)]));
        const st = this.load_step;
        if (st === 1) {
            this.last_start = { ...this.load_args };
            const a = this.load_args;
            this.make_world(a.diff, a.opponents, a.ally, a.ai_human, a.map_type, a.civ, a.civs, a.teams, a.colors,
                a.levels, a.settings);
            this.load_prev = this.world_preview(this.world, [440, 290]);
            this._rt_request_sheets();
        } else if (st === 2) {
            this.attach_world();
            this.state = 'loading';
        } else if (st >= 3) {
            if (fast || (pygame.time.get_ticks() - this.load_t0 > 900 && this._rt_sheets_ready())) {
                this.state = 'play';
                this.audio.click();
            }
            return;
        }
        this.load_step += 1;
    }

    /** Browser: start downloading the sheets of the starting units (the world has just been made). */
    _rt_request_sheets() {
        const job = { done: false, t0: time.monotonic() };
        this._rt_sheets = job;
        let paths = [];
        try {
            paths = _rt_sheet_paths(this, this.world).filter(p => !assets.is_loaded(p));
        } catch (e) {
            console.warn('unit sheet list failed', e);
        }
        if (!paths.length) {
            job.done = true;
            return;
        }
        Promise.allSettled(paths.map(p => assets.request([p]))).then(() => { job.done = true; });
    }

    _rt_sheets_ready() {
        const job = py.getattr(this, '_rt_sheets', null);
        return job == null || job.done || time.monotonic() - job.t0 > _RT_SHEET_WAIT;
    }

    /** Run the loading to the end at once (tools, checks). */
    finish_loading() {
        for (let i = 0; i < 10; i++) {
            if (this.state !== 'loading') break;
            this.loading_frame(true);
        }
    }

    draw_loading(prog, label) {
        const scr = this.screen;
        scr.fill([18, 12, 6]);
        S.panel(scr, new pygame.Rect(24, 12, SCREEN_W - 48, SCREEN_H - 24), 'parchment', false);
        const a = py.bool(this.load_args) ? this.load_args : {};
        const o = match.normalize(py.get(a, 'settings'));
        const mt = py.get(a, 'map_type', 'land');
        const n = 1 + Math.max(1, Math.min(7, py.get(a, 'opponents', 1)));
        W.plate(scr, [py.floordiv(SCREEN_W, 2), 54], `${py.get(naval.MAP_NAMES, mt, mt)} · ${match.map_side(o, n, mt)}×`
            + `${match.map_side(o, n, mt)}`,
        this.fonts['h'], 420);
        // map preview
        const pv = new pygame.Rect(70, 110, 460, 310);
        W.box(scr, pv, 60);
        const img = this.load_prev != null ? this.load_prev : this.map_preview(mt, [440, 290]);
        scr.blit(img, [pv.x + 10, pv.y + 10]);
        // parameters
        const T = i18n.t;
        const rows = [['match-settings', match.value_label('mode', o['mode'])],
            ['economics', T('match.opt.resources') + ': ' + match.value_label('resources', o['resources'])],
            ['population', T('match.opt.pop') + `: ${o['pop']}`],
            ['upgrade', T('load.age') + ': ' + match.value_label('start_age', o['start_age'])],
            ['victory', T('match.opt.victory') + ': ' + match.value_label('victory', o['victory'])],
            ['time', T('match.opt.treaty') + ': ' + match.value_label('treaty', o['treaty'])]];
        rows.forEach(([ic, txt], i) => {
            const x = 80 + (i % 2) * 230, y = pv.bottom + 26 + py.floordiv(i, 2) * 30;
            S.blit_icon(scr, ic, [x + 10, y], 22);
            S.text_fit(scr, txt, [x + 28, y], this.fonts['b'], W.INK, 'midleft', null, 200);
        });
        // players
        const pl = new pygame.Rect(570, 110, 640, 420);
        W.box(scr, pl, 60);
        S.text(scr, T('lobby.players'), [pl.centerx, pl.y + 22], this.fonts['l'], W.INK, 'center', null);
        const civs = Array.from(py.get(a, 'civs') || []);
        const cols = Array.from(py.get(a, 'colors') || []);
        const teams = Array.from(py.get(a, 'teams') || []);
        const levels = Array.from(py.get(a, 'levels') || []);
        for (let i = 0; i < n; i++) {
            const y = pl.y + 52 + i * 44;
            const col = (i < cols.length && cols[i] != null) ? PLAYER_COLORS[cols[i]] : PLAYER_COLORS[i];
            W.color_badge(scr, [pl.x + 16, y + 4, 30, 30], col, i + 1, this.fonts['b']);
            let civ = i < civs.length ? civs[i] : 'random';
            if (this.world != null && i < this.world.players.length && this.load_step >= 2)
                civ = this.world.players[i].civ;
            civ_ui.blit_emblem(this, civ, [pl.x + 60, y + 2, 30, 34]);
            const who = i === 0 ? i18n.player_name() : T('lobby.ai_slot', {
                level: match.ai_level_name(
                    (i < levels.length && levels[i] != null) ? levels[i] : 2),
            });
            S.text_fit(scr, who, [pl.x + 100, y + 19], this.fonts['b'], W.INK, 'midleft', null, 250);
            S.text_fit(scr, civ_ui.civ_name(civ), [pl.x + 360, y + 19], this.fonts['b'], [110, 40, 20],
                'midleft', null, 170);
            if (i < teams.length) {
                S.text(scr, T('win.team_n', { n: teams[i] + 1 }), [pl.right - 20, y + 19], this.fonts['m'], W.INK,
                    'midright', null);
            }
        }
        // tip
        const tip = new pygame.Rect(70, 560, SCREEN_W - 140, 80);
        W.box(scr, tip, 40);
        S.blit_icon(scr, 'encyclopaedia', [tip.x + 34, tip.centery], 40);
        S.text(scr, T('load.tip'), [tip.x + 70, tip.y + 20], this.fonts['bs'], [140, 40, 20], 'midleft', null);
        S.text_fit(scr, T(py.getattr(this, 'load_tip', TIPS[0])), [tip.x + 70, tip.y + 48], this.fonts['m'], W.INK,
            'midleft', null, tip.w - 90);
        // progress
        const bar = new pygame.Rect(70, 680, SCREEN_W - 140, 26);
        pygame.draw.rect(scr, [60, 40, 20], bar);
        pygame.draw.rect(scr, [180, 40, 26], [bar.x + 2, bar.y + 2, Math.trunc((bar.w - 4) * Math.min(1.0, prog)), bar.h - 4]);
        pygame.draw.rect(scr, [230, 184, 96], bar, 2);
        S.text(scr, `${label}  ${Math.trunc(Math.min(1.0, prog) * 100)}%`, bar.center, this.fonts['b'], [255, 240, 210],
            'center');
    }

    // ============================================================ autosave and "hot" windows
    after_update(dt) {
        const mins = gsettings.get('autosave', 0) || 0;
        const w = this.world;
        if (!mins || w == null || w.winner != null) return;
        this.autosave_t += dt;
        if (this.autosave_t >= mins * 60) {
            this.autosave_t = 0.0;
            try {
                savegame.save_world(w, savegame.AUTOSAVE, i18n.t('saves.autosave'),
                    this.ui_state(),
                    this.screen.copy());
                w.msg(i18n.t('saves.autosave'), [170, 200, 230]);
            } catch (e) {
                console.warn('autosave failed', e);
            }
        }
    }

    /** Events before the game's regular input: the open F10 windows, quick keys, the locked speed. */
    overlay_event(e) {
        const h = this.help;
        if (h === 'settings') {
            if (this.settings_event(e)) return true;
            return e.type === pygame.KEYDOWN || e.type === pygame.MOUSEBUTTONDOWN;
        }
        if (h === 'save' || h === 'load') {
            this.saves_event(e);
            return [pygame.KEYDOWN, pygame.MOUSEBUTTONDOWN, pygame.MOUSEWHEEL].includes(e.type);
        }
        if (h === 'confirm' && e.type === pygame.KEYDOWN) {
            if ([pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_y].includes(e.key)) this.confirm_yes();
            else if ([pygame.K_ESCAPE, pygame.K_n].includes(e.key)) this.help = 'menu';
            return true;
        }
        if (e.type === pygame.KEYDOWN && !py.getattr(this, '_kbypass', false) &&
                !(['save', 'load', 'settings'].includes(h) || py.getattr(this, 'window', null) === 'chat')) {
            const tr = keymap.translate(e.key);        // remapped keys (Settings -> Hotkeys)
            if (tr === 'swallow') return true;
            if (tr != null) {
                this._kbypass = true;
                try {
                    this.on_event(new pygame.event.Event(pygame.KEYDOWN, {
                        key: tr, mod: py.getattr(e, 'mod', 0), unicode: '', scancode: 0,
                    }));
                } finally {
                    this._kbypass = false;
                }
                return true;
            }
        }
        if (e.type === pygame.KEYDOWN && !h) {
            const byp = py.getattr(this, '_kbypass', false);

            const act = name =>              // after remapping the input arrives with the default key
                byp ? e.key === keymap.default_code(name) : keymap.matches(name, e.key);
            if (act('quick_save')) {
                this.do_save('quicksave', i18n.t('saves.quicksave'));
                return true;
            }
            if (act('quick_load')) {
                if (savegame.list_slots().some(([s]) => s === 'quicksave')) this.do_load('quicksave');
                return true;
            }
            const w = this.world;
            if (w != null && py.get(w.settings, 'lock_speed') &&
                    (act('speed_up') || act('speed_down'))) {
                w.msg(i18n.t('msg.speed_locked'), [230, 200, 150]);
                return true;
            }
        }
        return false;
    }

    // ============================================================ F10 menu
    game_menu_rects() {
        const bh = 44, gap = 6;
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 200, 56, 400, 90 + GAME_MENU.length * (bh + gap));
        return [box, GAME_MENU.map(([act, lbl, ic], i) =>
            [new pygame.Rect(box.x + 40, box.y + 70 + i * (bh + gap), box.w - 80, bh), act, lbl, ic])];
    }

    draw_game_menu() {
        const scr = this.screen;
        this.dim(150);
        const [box, items] = this.game_menu_rects();
        S.panel(scr, box, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], box, 2);
        W.plate(scr, [box.centerx, box.y + 32], i18n.t('hud.menu'), this.fonts['h'], 220);
        const mp = pygame.mouse.get_pos();
        for (const [r, act, lbl, ic] of items) {
            const h = r.collidepoint(mp);
            W.red_button(scr, r, i18n.t(lbl), this.fonts['b'], h ? 'hover' : 'normal', ic);
        }
    }

    game_menu_action(act) {
        const w = this.world;
        if (act === 'resume') {
            this.help = false;
        } else if (act === 'save') {
            this.open_saves('save');
        } else if (act === 'load') {
            this.open_saves('load');
        } else if (act === 'objectives') {
            if (py.hasattr(this, 'toggle_window')) {          // hud.py: the "Objectives" window (hud_windows.draw_objectives)
                this.help = false;
                this.window = 'objectives';
            } else {
                this.help = 'objectives';
            }
        } else if (act === 'help') {
            this.help = true;
        } else if (act === 'civ') {
            this.help = 'civ';
        } else if (act === 'settings') {
            this.open_settings('game');
        } else if (Object.hasOwn(CONFIRM, act)) {
            if (act === 'resign' && !w.players[w.human].alive) return;
            this.confirm = act;
            this.help = 'confirm';
        }
    }

    confirm_yes() {
        const act = this.confirm;
        this.confirm = null;
        this.help = false;
        const w = this.world;
        if (act === 'restart' && py.bool(this.last_start)) {
            this.begin_loading(this.last_start);
        } else if (act === 'resign') {
            w.resign(w.human);
        } else if (act === 'quit') {
            this.open_stats();
        } else if (act === 'exit') {
            // browser: nothing to quit to; leave the match for the main menu instead of closing the page
            this.state = 'menu';
            this.menu_screen = 'main';
        }
    }

    confirm_rects() {
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 240, 280, 480, 180);
        return [box, [[new pygame.Rect(box.x + 40, box.bottom - 64, 180, 42), 'yes'],
            [new pygame.Rect(box.right - 220, box.bottom - 64, 180, 42), 'no']]];
    }

    /** Left click while a window is open (the F10 menu, a confirmation, objectives; the rest - as in hud.py). */
    overlay_click(pos) {
        const h = this.help;
        if (h === 'menu') {
            const [box, items] = this.game_menu_rects();
            for (const [r, act] of items) {
                if (r.collidepoint(pos)) {
                    this.audio.click();
                    this.game_menu_action(act);
                    return;
                }
            }
            if (!box.collidepoint(pos)) this.help = false;
            return;
        }
        if (h === 'confirm') {
            const [box, items] = this.confirm_rects();
            for (const [r, act] of items) {
                if (r.collidepoint(pos)) {
                    this.audio.click();
                    if (act === 'yes') this.confirm_yes();
                    else this.help = 'menu';
                }
            }
            return;
        }
        if (h === 'objectives') {
            this.help = false;
            return;
        }
        const sup = py.super_method(ScreensUI, this, 'overlay_click');
        if (sup != null) sup(pos);
        else this.help = false;
    }

    draw_help() {
        const h = this.help;
        if (h === 'settings') {
            this.dim(140);
            this.draw_settings_panel();
        } else if (h === 'save' || h === 'load') {
            this.draw_saves();
        } else if (h === 'confirm') {
            this.draw_game_menu();
            this.draw_confirm();
        } else if (h === 'objectives') {
            this.draw_objectives();
        } else {
            py.super_method(ScreensUI, this, 'draw_help')();
        }
    }

    draw_confirm() {
        const scr = this.screen;
        S.shade_overlay(scr, [0, 0, SCREEN_W, SCREEN_H], undefined, 90);
        const [box, items] = this.confirm_rects();
        S.panel(scr, box, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], box, 2);
        S.text_fit(scr, i18n.t(py.get(CONFIRM, this.confirm, '?')), [box.centerx, box.y + 52], this.fonts['l'], W.INK,
            'center', null, box.w - 30);
        const mp = pygame.mouse.get_pos();
        for (const [r, act] of items) {
            W.red_button(scr, r, act === 'yes' ? i18n.t('common.yes') : i18n.t('common.no'), this.fonts['b'],
                r.collidepoint(mp) ? 'hover' : 'normal');
        }
    }

    /** The fallback "Objectives" window (if hud has none of its own): the goal and match parameters. */
    draw_objectives() {
        const scr = this.screen;
        const w = this.world;
        this.dim(150);
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 300, 150, 600, 420);
        S.panel(scr, box, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], box, 2);
        const T = i18n.t;
        W.plate(scr, [box.centerx, box.y + 32], T('gm.objectives'), this.fonts['h'], 260);
        const o = w.settings;
        const v = py.get(o, 'victory', 'standard');
        const goals = {
            'time': T('obj.goal_time', { n: py.get(o, 'victory_time') }),
            'score': T('obj.goal_score', { n: py.get(o, 'victory_score') }),
        };
        const goal = Object.hasOwn(goals, v) ? goals[v] : T('obj.goal_conquest');
        const rows = [['victory', goal],
            ['portraits/technologies/cartography.png', `${py.get(naval.MAP_NAMES, w.map_type, '')} · ${w.W}²`],
            ['match-settings', match.value_label('mode', py.get(o, 'mode'))],
            ['time', T('match.opt.treaty') + ': ' + (match.treaty_active(w) ? _clock(match.treaty_left(w))
                : T('common.none'))],
            ['population', T('match.opt.pop') + `: ${w.pop_limit}`],
            ['upgrade', T('match.opt.end_age') + ': ' + AGE_NAMES[w.max_age]]];
        rows.forEach(([ic, txt], i) => {
            const y = box.y + 90 + i * 48;
            S.blit_icon(scr, ic, [box.x + 44, y], 30);
            S.text_fit(scr, txt, [box.x + 74, y], this.fonts['b'], W.INK, 'midleft', null,
                box.right - box.x - 90);
        });
    }

    // ============================================================ end of the match
    gameover_rects() {
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 280, 170, 560, 360);
        return [box, [['stats', 'end.stats'], ['stay', 'end.stay'], ['menu', 'menu.main']].map(([act, lbl], i) =>
            [new pygame.Rect(box.centerx - 150, box.y + 196 + i * 50, 300, 42), act, lbl])];
    }

    draw_gameover() {
        const w = this.world;
        if (this.gameover_seen) {           // "Stay on the map" - only the plate at the top
            const win = w.human_won();
            this.text(win ? i18n.t('end.victory').toUpperCase() : i18n.t('end.defeat').toUpperCase(),
                [py.floordiv(SCREEN_W, 2), 60], 'h', win ? [255, 230, 150] : [255, 160, 130], 'center');
            return;
        }
        const scr = this.screen;
        this.dim(150);
        const win = w.human_won();
        const [box, items] = this.gameover_rects();
        S.panel(scr, box, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], box, 2);
        S.blit_icon(scr, win ? 'victory' : 'defeat', [box.centerx, box.y + 60], 90);
        const img = S.gold_text(win ? i18n.t('end.victory_bang').toUpperCase() : i18n.t('end.defeat').toUpperCase(),
            this.fonts['xl'], ...(win ? [[255, 240, 170], [210, 150, 50]] : [[255, 170, 140], [160, 40, 30]]));
        scr.blit(img, img.get_rect({ center: [box.centerx, box.y + 140] }));
        const mp = pygame.mouse.get_pos();
        for (const [r, act, lbl] of items) {
            W.red_button(scr, r, i18n.t(lbl), this.fonts['b'], r.collidepoint(mp) ? 'hover' : 'normal');
        }
    }

    gameover_event(e) {
        if (e.type === pygame.KEYDOWN && [pygame.K_RETURN, pygame.K_SPACE, pygame.K_KP_ENTER].includes(e.key)) {
            this.open_stats();
        } else if (e.type === pygame.KEYDOWN && e.key === pygame.K_ESCAPE) {
            this.gameover_seen = true;
        } else if (e.type === pygame.MOUSEBUTTONDOWN && e.button === 1) {
            const [, items] = this.gameover_rects();
            for (const [r, act] of items) {
                if (r.collidepoint(e.pos)) {
                    this.audio.click();
                    if (act === 'stats') {
                        this.open_stats();
                    } else if (act === 'stay') {
                        this.gameover_seen = true;
                    } else {
                        this.state = 'menu';
                        this.menu_screen = 'main';
                    }
                }
            }
        }
    }

    // ============================================================ achievements
    open_stats() {
        this.help = false;
        this.stats_tab = 'score';
        this.state = 'stats';
    }

    stats_rects() {
        const items = [];
        const tw = py.floordiv(SCREEN_W - 120, STAT_TABS.length);
        STAT_TABS.forEach(([tid], i) => {
            items.push([new pygame.Rect(60 + i * tw, SCREEN_H - 118, tw - 8, 40), 'tab', tid]);
        });
        items.push([new pygame.Rect(SCREEN_W - 540, SCREEN_H - 66, 230, 42), 'again', null]);
        items.push([new pygame.Rect(SCREEN_W - 290, SCREEN_H - 66, 230, 42), 'menu', null]);
        return items;
    }

    screen_event(e) {
        if (this.state === 'loading') return;
        if (e.type === pygame.KEYDOWN) {
            if ([pygame.K_ESCAPE, pygame.K_RETURN, pygame.K_KP_ENTER].includes(e.key)) {
                this.state = 'menu';
                this.menu_screen = 'main';
            } else if ([pygame.K_LEFT, pygame.K_RIGHT, pygame.K_TAB].includes(e.key)) {
                const ids = STAT_TABS.map(([t]) => t);
                const i = py.index(ids, this.stats_tab) + (e.key === pygame.K_LEFT ? -1 : 1);
                this.stats_tab = ids[py.mod(i, ids.length)];
            }
        } else if (e.type === pygame.MOUSEBUTTONDOWN && e.button === 1) {
            for (const [r, act, val] of this.stats_rects()) {
                if (r.collidepoint(e.pos)) {
                    this.audio.click();
                    if (act === 'tab') {
                        this.stats_tab = val;
                    } else if (act === 'again' && py.bool(this.last_start)) {
                        this.begin_loading(this.last_start);
                    } else if (act === 'menu') {
                        this.state = 'menu';
                        this.menu_screen = 'main';
                    }
                }
            }
        }
    }

    draw_stats() {
        const scr = this.screen;
        const w = this.world;
        scr.fill([18, 12, 6]);
        const sheet = new pygame.Rect(24, 12, SCREEN_W - 48, SCREEN_H - 24);
        S.panel(scr, sheet, 'parchment', false);
        const title = i18n.t(STAT_TABS.find(([t]) => t === this.stats_tab)[1]);
        W.plate(scr, [py.floordiv(SCREEN_W, 2), 50], i18n.t('end.stats') + ' · ' + title, this.fonts['h'], 460);
        S.text(scr, _clock(w.time), [SCREEN_W - 60, 50], this.fonts['l'], W.INK, 'midright', null);
        const win = w.winner;
        if (win != null) {
            S.text(scr, w.human_won() ? i18n.t('end.victory_bang') : i18n.t('end.defeat'), [70, 50], this.fonts['l'],
                w.human_won() ? [40, 120, 40] : [160, 30, 20], 'midleft', null);
        }
        const mp = pygame.mouse.get_pos();
        const area = new pygame.Rect(50, 90, SCREEN_W - 100, SCREEN_H - 230);
        if (this.stats_tab === 'timeline') this.draw_timeline(area);
        else this.draw_stat_table(area);
        for (const [r, act, val] of this.stats_rects()) {
            const h = r.collidepoint(mp);
            if (act === 'tab') {
                const [tid, lbl, ic] = STAT_TABS.find(t => t[0] === val);
                W.tab(scr, r, i18n.t(lbl), this.fonts['b'], this.stats_tab === val, h, ic);
            } else if (act === 'again') {
                W.red_button(scr, r, i18n.t('end.play_again'), this.fonts['b'],
                    !py.bool(this.last_start) ? 'disabled' : h ? 'hover' : 'normal');
            } else {
                W.red_button(scr, r, i18n.t('menu.main'), this.fonts['b'], h ? 'hover' : 'normal');
            }
        }
    }

    /** The player ribbon on the left (color, name, civilization) - like flags on the achievements sheet. */
    banner(r, p) {
        const scr = this.screen;
        const col = p.color;
        const pts = [[r.x, r.y], [r.right - 18, r.y], [r.right, r.centery], [r.right - 18, r.bottom], [r.x, r.bottom]];
        pygame.draw.polygon(scr, [30, 18, 8], pts.map(([x, y]) => [x + 2, y + 2]));
        pygame.draw.polygon(scr, col, pts);
        pygame.draw.polygon(scr, [240, 220, 180], pts, 1);
        civ_ui.blit_emblem(this, p.civ, [r.x + 6, r.y + 4, 26, r.h - 8]);
        const name = p.id === this.world.human ? i18n.player_name() : p.name;
        S.text_fit(scr, name, [r.x + 40, r.y + 14], this.fonts['b'], [255, 255, 255], 'midleft',
            [0, 0, 0], r.w - 60);
        S.text(scr, civ_ui.civ_name(p.civ), [r.x + 40, r.y + 32], this.fonts['s'], [250, 240, 220],
            'midleft', [0, 0, 0]);
    }

    draw_stat_table(area) {
        const scr = this.screen;
        const w = this.world;
        const cols = stat_columns(this.stats_tab);
        const scs = scoring.scores(w);
        const n = w.players.length;
        const rh = Math.min(62, py.floordiv(area.h - 50, Math.max(1, n)));
        const x0 = area.x + 250;
        const cw = py.floordiv(area.right - 90 - x0, Math.max(1, cols.length));
        const vals = w.players.map(p => cols.map(([, , fn]) => fn(w, p, w.stats[p.id], scs[p.id])));
        cols.forEach(([lbl, ic, fn, fmt], j) => {
            const cx = x0 + j * cw + py.floordiv(cw, 2);
            if (ic) {
                S.blit_icon(scr, ic, [cx, area.y + 14], 24);
            } else if (j < 3 && this.stats_tab === 'tech') {
                const a = S.portrait('age', j + 1, null, 26);
                if (a != null) scr.blit(a, a.get_rect({ center: [cx, area.y + 14] }));
            }
            S.text_fit(scr, lbl, [cx, area.y + 38], this.fonts['bs'], W.INK, 'center', null, cw - 6);
            const col_vals = vals.map(v => v[j]).filter(v => v != null);
            const best = col_vals.length ? (fmt === 'time' ? py.min(col_vals) : py.max(col_vals)) : null;
            const bar_max = (col_vals.length && fmt !== 'time') ? py.max(col_vals) : 0;
            w.players.forEach((p, i) => {
                const v = vals[i][j];
                const y = area.y + 56 + i * rh;
                let txt;
                if (fmt === 'time') txt = v ? _clock(v) : (v == null ? '—' : '00:00');
                else if (v == null) txt = '—';
                else txt = fmt === '%' ? `${v}%` : py.str(v);
                const hi = v != null && v === best && col_vals.length > 1 && (fmt === 'time' || v > 0);
                S.text(scr, txt, [cx, y + py.floordiv(rh, 2) - 6], this.fonts['l'], hi ? [170, 30, 20] : W.INK,
                    'center', null);
                if (bar_max && v) {
                    const bw = Math.trunc((cw - 30) * v / bar_max);
                    pygame.draw.rect(scr, p.color, [cx - py.floordiv(cw - 30, 2), y + py.floordiv(rh, 2) + 10, bw, 5]);
                }
            });
            pygame.draw.line(scr, [170, 130, 80], [x0 + j * cw, area.y + 4], [x0 + j * cw, area.y + 56 + n * rh], 1);
        });
        w.players.forEach((p, i) => {
            const y = area.y + 56 + i * rh;
            this.banner(new pygame.Rect(area.x, y + 4, 236, Math.min(48, rh - 8)), p);
            const tx = area.right - 50;
            S.text(scr, i18n.t('stats.team_short', { n: p.team + 1 }), [tx, y + py.floordiv(rh, 2) - 4], this.fonts['b'], W.INK,
                'center', null);
            if (w.winner != null && p.team === w.winner) S.blit_icon(scr, 'victory', [tx + 28, y + py.floordiv(rh, 2) - 4], 22);
            else if (!p.alive) S.blit_icon(scr, 'defeat', [tx + 28, y + py.floordiv(rh, 2) - 4], 20);
        });
        S.text_fit(scr, i18n.t('lobby.team'), [area.right - 50, area.y + 38], this.fonts['bs'], W.INK, 'center',
            null, 96);
    }

    /** A population graph of all players by samples every 30 s + marks of ages (II, III, IV) and defeats. */
    draw_timeline(area) {
        const scr = this.screen;
        const w = this.world;
        W.box(scr, area, 30);
        const g = area.inflate(-120, -80).move(30, 6);
        const tmax = Math.max(60.0, w.time);
        let pmax = 10;
        for (const s of w.stats) {
            for (const smp of s['samples']) pmax = Math.max(pmax, smp[1]);
        }
        pmax = Math.trunc(py.floordiv(pmax + 9, 10) * 10);
        // grid
        for (let k = 0; k < 5; k++) {
            const y = g.bottom - g.h * k / 4;
            pygame.draw.line(scr, [190, 160, 110], [g.x, y], [g.right, y], 1);
            S.text(scr, String(Math.trunc(pmax * k / 4)), [g.x - 8, y], this.fonts['s'], W.INK, 'midright', null);
        }
        const step = 60 * Math.max(1, Math.trunc(tmax / 60 / 8));
        let t = 0;
        while (t <= tmax) {
            const x = g.x + g.w * t / tmax;
            pygame.draw.line(scr, [200, 176, 130], [x, g.y], [x, g.bottom], 1);
            S.text(scr, i18n.t('stats.min_short', { n: Math.trunc(py.floordiv(t, 60)) }), [x, g.bottom + 12], this.fonts['s'], W.INK,
                'center', null);
            t += step;
        }
        pygame.draw.rect(scr, [120, 84, 40], g, 2);
        S.text(scr, i18n.t('match.opt.pop'), [g.x, g.y - 16], this.fonts['bs'], W.INK, 'midleft', null);
        for (const p of w.players) {
            const s = w.stats[p.id];
            const pts = s['samples'].map(smp => [g.x + g.w * smp[0] / tmax, g.bottom - g.h * smp[1] / pmax]);
            if (pts.length >= 2) {
                pygame.draw.lines(scr, [30, 20, 10], false, pts.map(([x, y]) => [x + 1, y + 1]), 3);
                pygame.draw.lines(scr, p.color, false, pts, 3);
            }
            // ages - diamonds with a number
            s['age_t'].slice(1).forEach((ta, k) => {
                const a = k + 1;
                if (ta == null || ta <= 0) return;
                const x = g.x + g.w * ta / tmax;
                const y = g.bottom - g.h * this._pop_at(s, ta) / pmax;
                const pts2 = [[x, y - 8], [x + 7, y], [x, y + 8], [x - 7, y]];
                pygame.draw.polygon(scr, p.color, pts2);
                pygame.draw.polygon(scr, [20, 10, 4], pts2, 1);
                S.text(scr, ['II', 'III', 'IV'][a - 1], [x, y - 16], this.fonts['s'], W.INK, 'center',
                    null);
            });
            if (py.get(s, 'defeat_t') != null) {
                const x = g.x + g.w * s['defeat_t'] / tmax;
                const y = g.bottom - g.h * this._pop_at(s, s['defeat_t']) / pmax;
                pygame.draw.line(scr, [160, 20, 10], [x - 6, y - 6], [x + 6, y + 6], 3);
                pygame.draw.line(scr, [160, 20, 10], [x - 6, y + 6], [x + 6, y - 6], 3);
            }
        }
        // the legend - a line above the graph
        w.players.forEach((p, i) => {
            const lx = g.x + 150 + (i % 4) * 230;
            const ly = area.y + 10 + py.floordiv(i, 4) * 16;
            pygame.draw.rect(scr, p.color, [lx, ly - 4, 22, 8]);
            const name = p.id === w.human ? i18n.player_name() : p.name;
            S.text_fit(scr, `${name} · ${civ_ui.civ_name(p.civ)}`, [lx + 28, ly], this.fonts['s'], W.INK,
                'midleft', null, 196);
        });
    }

    static _pop_at(s, t) {
        let best = 0;
        for (const smp of s['samples']) {
            if (smp[0] <= t) best = smp[1];
        }
        return best;
    }
}
py.statics(ScreensUI, '_pop_at');
py.classattrs(ScreensUI, {
    load_args: null,
    load_step: 0,
    stats_tab: 'score',
    confirm: null,
    autosave_t: 0.0,
    gameover_seen: false,
    last_start: null,
});
py.mixin(ScreensUI, SettingsUI, SavesUI);
