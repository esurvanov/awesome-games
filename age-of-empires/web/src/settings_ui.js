// port of game/settings_ui.py
// The "Settings" screen - 5 tabs as in AoE2 DE: Game · Graphics · Interface · Sound · Hotkeys.
// Opens from the main menu (gear, profile) and from the F10 menu in a match (an overlay over the game).
// Everything is saved in settings.json (game/settings.py; sound - via Audio, hotkeys - game/keymap.py).
import * as py from '../runtime/py.js';
import { modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { SCREEN_W, SCREEN_H } from './data.js';
import * as i18n from './i18n.js';
import * as keymap from './keymap.js';
import * as S from './uiskin.js';
import * as W from './widgets.js';
import * as gsettings from './settings.js';

export const TABS = [['game', 'settings.tab.game', 'match-settings'], ['graphics', 'settings.tab.graphics', 'repair'],
    ['interface', 'settings.tab.interface', 'encyclopaedia'], ['audio', 'settings.tab.audio', 'bell_level1'],
    ['keys', 'settings.tab.keys', 'production']];
export const BOX = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 460, 70, 920, 640);

// (type, key, caption key in the locale, parameters) - the rows of the tabs; the value captions are locale keys too
// (except numbers and language names - those are given as they are)
export const ROWS = {
    'game': [['choice', 'language', 'settings.language', i18n.available().map(([c, n]) => [c, n])],
        ['choice', 'game_speed', 'settings.game_speed',
            [[1.0, 'match.val.speed.1.0'], [1.5, 'match.val.speed.1.5'], [1.7, 'match.val.speed.1.7'],
                [2.0, 'match.val.speed.2.0']]],
        ['slider', 'scroll_speed', 'settings.scroll_speed', [0.5, 2.0]],
        ['toggle', 'edge_scroll', 'settings.edge_scroll', null],
        ['toggle', 'wheel_zoom', 'settings.wheel_zoom', null],
        ['choice', 'autosave', 'settings.autosave', [[0, 'settings.off'], [5, 'settings.every_5'],
            [10, 'settings.every_10'], [15, 'settings.every_15']]]],
    'graphics': [['toggle', 'fullscreen', 'settings.fullscreen', null],
        ['choice', 'fps_limit', 'settings.fps_limit', [[30, '30'], [60, '60'], [120, '120']]],
        ['toggle', 'live_menu_bg', 'settings.live_menu_bg', null]],
    'interface': [['text', 'player_name', 'settings.player_name', null],
        ['toggle', 'show_hotkeys', 'settings.show_hotkeys', null],
        ['toggle', 'show_score', 'settings.show_score', null],
        ['toggle', 'global_queue', 'settings.global_queue', null],
        ['choice', 'tooltip_scale', 'settings.tooltip_scale', [[50, '50%'], [75, '75%'], [100, '100%']]],
        ['toggle', 'cursor', 'settings.cursor', null],
        ['toggle', 'cursor_soft', 'settings.cursor_soft', null]],
    'audio': [['toggle', 'music', 'settings.music', null], ['toggle', 'sfx', 'settings.sfx', null],
        ['slider', 'music_vol', 'settings.music_vol', [0.0, 1.0]],
        ['slider', 'sfx_vol', 'settings.sfx_vol', [0.0, 1.0]],
        ['slider', 'voice_vol', 'settings.voice_vol', [0.0, 1.0]]],
};


/** A value caption: a locale key -> text, the rest (numbers, language names) - as it is. */
export function _lbl(s) {
    return (typeof s === 'string' && (s.startsWith('settings.') || s.startsWith('match.'))) ? i18n.t(s) : py.str(s);
}
export const AUDIO_KEYS = ['music', 'sfx', 'music_vol', 'sfx_vol', 'voice_vol'];


export class SettingsUI {
    open_settings(back = 'main', tab = null) {
        this.set_back = back;
        if (tab) this.set_tab = tab;
        this.set_drop = this.key_capture = this.text_edit = this.set_drag = null;
        if (this.state === 'menu') this.menu_screen = 'settings';
        else this.help = 'settings';
    }

    close_settings() {
        this.set_drop = this.key_capture = this.text_edit = this.set_drag = null;
        if (this.state === 'menu') this.menu_screen = ['main', 'single'].includes(this.set_back) ? this.set_back : 'main';
        else this.help = 'menu';
    }

    // ---- values
    set_value(key) {
        const a = this.audio;
        if (AUDIO_KEYS.includes(key)) {
            const st = py.getattr(a, 'settings', null);
            return py.get(py.bool(st) ? st : {}, key, key.endsWith('vol') ? 0.8 : true);
        }
        if (key === 'cursor') return Boolean(py.getattr(py.getattr(this, 'cursors', null), 'enabled', false));
        if (key === 'cursor_soft') return Boolean(py.getattr(py.getattr(this, 'cursors', null), 'soft', false));
        if (key === 'language') return i18n.current();
        return gsettings.get(key);
    }

    put_value(key, v) {
        const a = this.audio;
        if (key === 'music' || key === 'sfx') {
            if (py.bool(this.set_value(key)) !== py.bool(v)) {
                if (key === 'music') a.toggle_music();
                else a.toggle_sfx();
            }
            return;
        }
        if (AUDIO_KEYS.includes(key)) {
            if (py.hasattr(a, 'set_volume')) a.set_volume(key.slice(0, -4), v);
            else a.settings[key] = v;
            const sound = modules.sound;
            sound.save_settings(a.settings);
            return;
        }
        if (key === 'cursor') {
            const cur = py.getattr(this, 'cursors', null);
            if (cur != null) {
                cur.enabled = py.bool(v);
                cur.cur = '?';
            }
            gsettings.put('cursor', py.bool(v));
            return;
        }
        if (key === 'cursor_soft') {
            const cur = py.getattr(this, 'cursors', null);
            if (cur != null) cur.set_soft(py.bool(v));
            gsettings.put('cursor_soft', py.bool(v));
        }
        if (key === 'language') {
            if (v !== i18n.current()) i18n.set_language(v);        // tables, fonts and caches - through subscribers (ui.Game.on_language)
            return;
        }
        gsettings.put(key, v);
        if (key === 'fullscreen') {
            try {
                if (py.bool(pygame.display.is_fullscreen()) !== py.bool(v)) pygame.display.toggle_fullscreen();
            } catch (e) { /* ignore */ }
        }
        if (key === 'live_menu_bg') this.menu_bg = null;
    }

    // ---- layout
    settings_rects() {
        const items = [];
        const tw = py.floordiv(BOX.w - 40, TABS.length);
        TABS.forEach(([tid], i) => {
            items.push([new pygame.Rect(BOX.x + 20 + i * tw, BOX.y + 64, tw - 6, 36), 'tab', tid]);
        });
        if (this.set_tab === 'keys') {
            keymap.ACTIONS.forEach(([act], i) => {
                const col = py.floordiv(i, 9), row = i % 9;
                items.push([new pygame.Rect(BOX.x + 300 + col * 440, BOX.y + 124 + row * 44, 120, 32), 'key', act]);
            });
            items.push([new pygame.Rect(BOX.x + 40, BOX.bottom - 60, 250, 40), 'keys_reset', null]);
        } else {
            ROWS[this.set_tab].forEach(([typ, key], i) => {
                items.push([new pygame.Rect(BOX.x + 470, BOX.y + 130 + i * 56, 380, 34), 'ctl', key]);
            });
        }
        if (this.state === 'menu')
            items.push([new pygame.Rect(BOX.centerx - 40, BOX.bottom - 60, 230, 40), 'credits', null]);
        items.push([new pygame.Rect(BOX.right - 260, BOX.bottom - 60, 220, 40), 'done', null]);
        return items;
    }

    row_of(key) {
        for (const [typ, k, lbl, par] of py.get(ROWS, this.set_tab, [])) {
            if (k === key) return [typ, lbl, par];
        }
        return [null, '', null];
    }

    // ---- actions
    settings_action(act, val, pos = null) {
        if (act === 'tab') {
            this.set_tab = val;
            this.set_drop = this.key_capture = this.text_edit = null;
        } else if (act === 'done') {
            this.close_settings();
        } else if (act === 'credits') {
            this.menu_screen = 'credits';
            this.credits_scroll = 0;
        } else if (act === 'keys_reset') {
            keymap.reset();
        } else if (act === 'key') {
            this.key_capture = val;
        } else if (act === 'ctl') {
            const [typ, , par] = this.row_of(val);
            if (typ === 'toggle') {
                this.put_value(val, !py.bool(this.set_value(val)));
            } else if (typ === 'choice') {
                const anchor = this.settings_rects().find(([r, a, v]) => a === 'ctl' && v === val)[0];
                const vals = par.map(([v]) => v);
                const cur = this.set_value(val);
                this.set_drop = [anchor, val, vals, par.map(([, lb]) => _lbl(lb)),
                    py.contains(vals, cur) ? py.index(vals, cur) : null];
            } else if (typ === 'slider' && pos != null) {
                this.slide_to(val, pos[0]);
                this.set_drag = val;
            } else if (typ === 'text') {
                this.text_edit = val;
            }
        }
    }

    slide_to(key, x) {
        const [typ, , [lo, hi]] = this.row_of(key);
        const r = this.settings_rects().find(([r, a, v]) => a === 'ctl' && v === key)[0];
        const frac = Math.max(0.0, Math.min(1.0, (x - r.x - 10) / Math.max(1, r.w - 80)));
        this.put_value(key, py.round(lo + (hi - lo) * frac, 2));
    }

    /** An event for the settings screen; True - handled. */
    settings_event(e) {
        if (this.key_capture != null && e.type === pygame.KEYDOWN) {
            if (e.key !== pygame.K_ESCAPE) keymap.set_key(this.key_capture, e.key);
            this.key_capture = null;
            return true;
        }
        if (this.text_edit != null && e.type === pygame.KEYDOWN) {
            const cur = py.str(py.or_(gsettings.get(this.text_edit), ''));
            if ([pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_ESCAPE].includes(e.key)) {
                this.text_edit = null;
            } else if (e.key === pygame.K_BACKSPACE) {
                gsettings.put(this.text_edit, cur.slice(0, -1));
            } else if (e.unicode && py.isprintable(e.unicode) && cur.length < 20) {
                gsettings.put(this.text_edit, cur + e.unicode);
            }
            return true;
        }
        if (e.type === pygame.KEYDOWN && e.key === pygame.K_ESCAPE) {
            if (this.set_drop != null) this.set_drop = null;
            else this.close_settings();
            return true;
        }
        if (e.type === pygame.MOUSEBUTTONUP && e.button === 1) {
            this.set_drag = null;
            return false;
        }
        if (e.type === pygame.MOUSEMOTION && this.set_drag != null) {
            this.slide_to(this.set_drag, e.pos[0]);
            return true;
        }
        if (e.type === pygame.MOUSEBUTTONDOWN && e.button === 1) {
            if (this.set_drop != null) {
                const [anchor, key, vals, lbls] = this.set_drop;
                this.set_drop = null;
                for (const [r, i] of W.list_rects(SCREEN_H, anchor, lbls.length)) {
                    if (r.collidepoint(e.pos)) {
                        this.audio.click();
                        this.put_value(key, vals[i]);
                    }
                }
                return true;
            }
            this.text_edit = null;
            for (const [r, act, val] of this.settings_rects()) {
                if (r.collidepoint(e.pos)) {
                    this.audio.click();
                    this.settings_action(act, val, e.pos);
                    return true;
                }
            }
            return this.state !== 'menu';
        }
        return false;
    }

    // ---- drawing
    /** The settings screen in the menu (over the menu background). */
    draw_settings_screen() {
        S.shade_overlay(this.screen, [0, 0, SCREEN_W, SCREEN_H], [10, 6, 2], 140);
        this.draw_settings_panel();
    }

    draw_settings_panel() {
        const scr = this.screen;
        S.panel(scr, BOX, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], BOX, 2);
        W.plate(scr, [BOX.centerx, BOX.y + 30], i18n.t('menu.settings'), this.fonts['h'], 300);
        const mp = pygame.mouse.get_pos();
        const modal = this.set_drop != null;
        const f = this.fonts['m'], fb = this.fonts['b'];
        const rects = this.settings_rects();
        for (const [r, act, val] of rects) {
            const h = r.collidepoint(mp) && !modal;
            if (act === 'tab') {
                const [tid, lbl, ic] = TABS.find(tb => tb[0] === val);
                W.tab(scr, r, i18n.t(lbl), fb, this.set_tab === val, h, ic);
            } else if (act === 'ctl') {
                const [typ, lbl, par] = this.row_of(val);
                S.text_fit(scr, i18n.t(lbl), [BOX.x + 60, r.centery], this.fonts['l'], W.INK, 'midleft', null,
                    r.x - BOX.x - 70);
                const v = this.set_value(val);
                if (typ === 'toggle') {
                    W.checkbox(scr, new pygame.Rect(r.x, r.y, 200, r.h), py.bool(v),
                        py.bool(v) ? i18n.t('settings.on') : i18n.t('settings.off'), fb, h);
                } else if (typ === 'choice') {
                    const hit = par.find(([vv]) => py.eq(vv, v));
                    const lb = hit !== undefined ? _lbl(hit[1]) : py.str(v);
                    W.field(scr, r.inflate(0, -6), lb, fb, h);
                } else if (typ === 'slider') {
                    const [lo, hi] = par;
                    const frac = hi > lo ? (Number(v) - lo) / (hi - lo) : 0;
                    W.slider(scr, new pygame.Rect(r.x + 10, r.y, r.w - 80, r.h), Math.max(0.0, Math.min(1.0, frac)), h);
                    const txt = hi <= 1.0 ? `${Math.trunc(py.round(Number(v) * 100))}%` : `×${py.fmt(Number(v), '.2f')}`;
                    S.text(scr, txt, [r.right - 8, r.centery], fb, W.INK, 'midright', null);
                } else if (typ === 'text') {
                    const edit = this.text_edit === val;
                    const s = py.str(py.or_(v, '')) + ((edit && py.mod(py.floordiv(pygame.time.get_ticks(), 400), 2)) ? '|' : '');
                    W.field(scr, r.inflate(0, -6), s, fb, h || edit, false);
                }
            } else if (act === 'key') {
                const i = keymap.ACTIONS.map(([a]) => a).indexOf(val);
                const col = py.floordiv(i, 9);
                S.text_fit(scr, keymap.label(val), [BOX.x + 40 + col * 440, r.centery], f, W.INK, 'midleft',
                    null, 250);
                const cap = this.key_capture === val;
                W.field(scr, r, cap ? i18n.t('settings.press_key') : keymap.pretty(keymap.name_for(val)), fb, h || cap,
                    false);
            } else if (act === 'keys_reset') {
                W.red_button(scr, r, i18n.t('settings.keys_reset'), fb, h ? 'hover' : 'normal');
            } else if (act === 'credits') {
                W.red_button(scr, r, i18n.t('menu.credits'), fb, h ? 'hover' : 'normal');
            } else if (act === 'done') {
                W.red_button(scr, r, i18n.t('common.done'), fb, h ? 'hover' : 'normal');
            }
        }
        if (this.set_tab === 'audio') {
            S.text(scr, i18n.t('settings.voices_hint'), [BOX.x + 60, BOX.y + 130 + 5 * 56 + 6], f,
                [110, 80, 50], 'midleft', null);
        }
        if (this.set_drop != null) {
            const [anchor, key, vals, lbls, idx] = this.set_drop;
            const rs = W.list_rects(SCREEN_H, anchor, lbls.length);
            const found = rs.find(([r]) => r.collidepoint(mp));
            const hi = found !== undefined ? found[1] : null;
            W.dropdown_list(scr, anchor, lbls, f, idx, hi);
        }
    }
}
py.classattrs(SettingsUI, {
    set_tab: 'game',
    set_back: 'main',
    set_drop: null,             // (anchor, key, values, captions, index)
    key_capture: null,          // an action waiting for a key press
    text_edit: null,            // the key of the field being edited
    set_drag: null,             // the key of the slider being dragged
});
