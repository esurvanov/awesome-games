// port of game/lobby.py
// Skirmish lobby (a mixin of ui.Game) - like "Standard Game" in AoE2 DE.
//
// On the left - 8 player rows: a number-color (colors in DE order), the player (You / AI with level 0-5 / Closed),
// the civilization (a crest; a picker window with a description and "Confirm"), the team ("-", 1-4, "?"); below - "Players: N"
// and the terrain with a map preview. On the right - the "Game Settings" column (game/match.py: mode, map size, AI
// difficulty, resources, population, speed, map reveal, starting/ending age, treaty, victory) and the checkboxes
// "Teams" / "Advanced", the buttons "Randomize" and "Reset". At the bottom - "Main Menu" and "Start Game".
//
// The lobby setup is remembered in settings.json ('lobby') when a match starts.
import * as py from '../runtime/py.js';
import { random, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { SCREEN_W, SCREEN_H, PLAYER_COLORS } from './data.js';
import * as civ_ui from './civ_ui.js';
import * as maps from './maps.js';
import * as match from './match.js';
import * as S from './uiskin.js';
import * as W from './widgets.js';
import * as i18n from './i18n.js';
import * as gsettings from './settings.js';

export const MAX_SLOTS = 8;
export const DE_COLOR_KEYS = ['blue', 'red', 'green', 'yellow', 'cyan', 'purple', 'grey', 'orange'];
export const TEAM_LBL = ['–', '1', '2', '3', '4', '?'];

export const SHEET = new pygame.Rect(24, 12, SCREEN_W - 48, SCREEN_H - 24);
export const PLAYERS = new pygame.Rect(56, 100, 724, 432);
export const MAPBOX = new pygame.Rect(56, 544, 724, 170);
export const SETBOX = new pygame.Rect(796, 100, 428, 614);
export const ROW_Y0 = PLAYERS.y + 46;
export const ROW_H = 40;
export const SET_Y0 = SETBOX.y + 46;
export const SET_H = 29;


/** PLAYER_COLORS indices in DE order: blue, red, green, yellow, cyan, purple, grey, orange. */
export function de_colors() {
    const out = DE_COLOR_KEYS.filter(n => i18n.COLOR_KEYS.includes(n)).map(n => i18n.COLOR_KEYS.indexOf(n));
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!out.includes(i)) out.push(i);
    return out;
}

export function default_slots() {
    const order = de_colors();
    const slots = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
        slots.push({
            'kind': i === 0 ? 'human' : i === 1 ? 'ai' : 'closed', 'civ': 'random',
            'color': order[i % order.length], 'team': 0, 'level': 2,
        });
    }
    return slots;
}


export class LobbyUI {
    // ============================================================ model
    cfg_defaults() {
        const cfg = this.menu_cfg;
        if (!Object.hasOwn(cfg, 'slots')) {
            const saved = gsettings.get('lobby');
            if (py.is_dict(saved) && py.len(py.get(saved, 'slots', [])) === MAX_SLOTS) {
                cfg['slots'] = saved['slots'].map(s => ({ ...s }));
                cfg['opts'] = match.normalize(py.get(saved, 'opts'));
            } else {
                cfg['slots'] = default_slots();
                cfg['opts'] = match.defaults();
                cfg['opts']['speed'] = gsettings.get('game_speed', 1.7);
            }
        }
        py.setdefault(cfg, 'opts', match.defaults());
        if (!maps.LOBBY.includes(py.get(cfg['opts'], 'map'))) {     // old saved "land/coast"
            cfg['opts']['map'] = maps.DEFAULT;
        }
        return cfg;
    }

    slots() {
        return this.cfg_defaults()['slots'];
    }

    opts() {
        return this.cfg_defaults()['opts'];
    }

    active_slots() {
        const out = [];
        this.slots().forEach((s, i) => { if (s['kind'] !== 'closed') out.push(i); });
        return out;
    }

    slot_civ(i) {
        return this.slots()[i]['civ'];
    }

    set_slot_civ(i, key) {
        this.slots()[i]['civ'] = key;
    }

    teams_ok() {
        return match.teams_valid(this.active_slots().map(i => this.slots()[i]['team']));
    }

    ai_level_all() {
        const lv = new Set();
        for (const i of this.active_slots()) if (this.slots()[i]['kind'] === 'ai') lv.add(this.slots()[i]['level']);
        return lv.size === 1 ? lv.values().next().value : null;
    }

    set_players(n) {
        n = Math.max(2, Math.min(MAX_SLOTS, n));
        this.slots().forEach((s, i) => {
            if (i === 0) return;
            if (i < n && s['kind'] === 'closed') {
                s['kind'] = 'ai';
                s['level'] = this.ai_level_all() != null ? this.ai_level_all() : 2;
            } else if (i >= n) {
                s['kind'] = 'closed';
            }
        });
        this.fix_colors();
    }

    /** Colors without repeats among the open slots. */
    fix_colors() {
        const used = new Set();
        const order = de_colors();
        for (const i of this.active_slots()) {
            const s = this.slots()[i];
            if (used.has(s['color'])) {
                const c = order.find(c => !used.has(c));
                if (c === undefined) throw new py.StopIteration();
                s['color'] = c;
            }
            used.add(s['color']);
        }
    }

    // ============================================================ layout
    /** [(rect, action, value)] of the lobby. */
    setup_rects() {
        const items = [];
        this.slots().forEach((s, i) => {
            const y = ROW_Y0 + i * ROW_H;
            if (s['kind'] !== 'closed') items.push([new pygame.Rect(PLAYERS.x + 16, y + 4, 30, 30), 'color', i]);
            if (i > 0) items.push([new pygame.Rect(PLAYERS.x + 56, y + 5, 262, 28), 'player', i]);
            if (s['kind'] !== 'closed') {
                items.push([new pygame.Rect(PLAYERS.x + 330, y + 3, 262, 32), 'slot_civ', i]);
                items.push([new pygame.Rect(PLAYERS.x + 604, y + 5, 44, 28), 'team', i]);
            }
        });
        items.push([new pygame.Rect(PLAYERS.x + 150, ROW_Y0 + MAX_SLOTS * ROW_H + 6, 110, 28), 'nplayers', null]);
        // terrain - map tiles with icons (game/map_icons.py)
        maps.LOBBY.forEach((mt, j) => {
            items.push([new pygame.Rect(MAPBOX.x + 12 + j * 118, MAPBOX.y + 30, 112, 134), 'map', mt]);
        });
        // parameters column
        for (const [key, y] of this.setting_rows())
            items.push([new pygame.Rect(SETBOX.x + 200, y + 2, 212, 25), 'opt', key]);
        const fy = this.flags_y();
        match.FLAGS.forEach(([key], j) => {
            const col = py.floordiv(j, 2), row = j % 2;
            items.push([new pygame.Rect(SETBOX.x + 18 + col * 206, fy + 26 + row * 26, 196, 24), 'flag', key]);
        });
        items.push([new pygame.Rect(SETBOX.x + 16, SETBOX.bottom - 48, 190, 34), 'randomize', null]);
        items.push([new pygame.Rect(SETBOX.right - 206, SETBOX.bottom - 48, 190, 34), 'reset', null]);
        items.push([new pygame.Rect(56, SCREEN_H - 70, 250, 42), 'back', null]);
        items.push([new pygame.Rect(530, SCREEN_H - 70, 250, 42), 'play', null]);
        return items;
    }

    /** [(key, y)] of the visible rows of the parameters column: first the terrain, then match.OPTIONS. */
    setting_rows() {
        const o = this.opts();
        const keys = ['map'].concat(match.OPTIONS.map(([k]) => k).filter(k => match.visible(o, k)));
        return keys.map((k, i) => [k, SET_Y0 + i * SET_H]);
    }

    flags_y() {
        return SET_Y0 + this.setting_rows().length * SET_H + 6;
    }

    /** (values, captions, current index) for a list. */
    option_values(key) {
        const o = this.opts();
        let vals, lbls, cur;
        if (key === 'map') {
            vals = Array.from(maps.LOBBY);
            lbls = vals.map(m => maps.name(m));
            cur = py.get(o, 'map', maps.DEFAULT);
        } else if (key === 'ai_all') {
            vals = py.range(match.AI_LEVELS.length);
            lbls = vals.map(i => match.ai_level_name(i));
            cur = this.ai_level_all();
        } else if (key === 'player') {
            vals = py.range(match.AI_LEVELS.length).map(lv => ['ai', lv]).concat([['closed', null]]);
            lbls = py.range(match.AI_LEVELS.length).map(i => i18n.t('lobby.ai_slot', { level: match.ai_level_name(i) }))
                .concat([i18n.t('lobby.closed')]);
            cur = null;
        } else if (key === 'nplayers') {
            vals = py.range(2, MAX_SLOTS + 1);
            lbls = vals.map(v => String(v));
            cur = this.active_slots().length;
        } else {
            vals = match.OPT[key][1].map(([v]) => v);
            lbls = match.value_labels(key);
            cur = py.get(o, key);
        }
        const idx = py.contains(vals, cur) ? py.index(vals, cur) : null;
        return [vals, lbls, idx];
    }

    picker_rects() {
        const keys = ['random'].concat(civ_ui.playable());
        const box = new pygame.Rect(90, 60, SCREEN_W - 180, SCREEN_H - 120);
        const cw = 112, ch = 104;
        const items = [];
        keys.forEach((k, i) => {
            items.push([new pygame.Rect(box.x + 28 + (i % 5) * (cw + 6), box.y + 70 + py.floordiv(i, 5) * (ch + 8), cw, ch),
                'pick', k]);
        });
        items.push([new pygame.Rect(box.right - 440, box.bottom - 58, 200, 40), 'pick_ok', null]);
        items.push([new pygame.Rect(box.right - 226, box.bottom - 58, 200, 40), 'pick_cancel', null]);
        return [box, items];
    }

    // ============================================================ actions
    lobby_action(act, val) {
        const o = this.opts();
        const sl = this.slots();
        if (act === 'color') {
            const used = new Set(this.active_slots().filter(j => j !== val).map(j => sl[j]['color']));
            const order = de_colors();
            const c = sl[val]['color'];
            let i = order.includes(c) ? order.indexOf(c) : 0;
            for (let k = 0; k < order.length; k++) {
                i = (i + 1) % order.length;
                if (!used.has(order[i])) break;
            }
            sl[val]['color'] = order[i];
        } else if (act === 'team') {
            sl[val]['team'] = (sl[val]['team'] + 1) % TEAM_LBL.length;
        } else if (act === 'player' || act === 'opt' || act === 'nplayers') {
            const key = act !== 'opt' ? act : val;
            const [vals, lbls, idx] = this.option_values(key);
            const hit = this.setup_rects().find(([r, a, v]) => a === act && v === val);
            if (hit === undefined) throw new py.StopIteration();
            const anchor = hit[0];
            this.dropdown = [anchor, key, val, vals, lbls, idx];
        } else if (act === 'choose') {
            this.apply_choice(...val);
        } else if (act === 'flag') {
            o[val] = !py.bool(py.get(o, val));
        } else if (act === 'map') {
            o['map'] = val;
        } else if (act === 'slot_civ') {
            this.picker = val;
            this.picker_sel = this.slot_civ(val);
        } else if (act === 'pick') {
            this.picker_sel = val;
        } else if (act === 'pick_ok') {
            if (this.picker != null && this.picker_sel != null) this.set_slot_civ(this.picker, this.picker_sel);
            this.picker = null;
        } else if (act === 'pick_cancel') {
            this.picker = null;
        } else if (act === 'randomize') {
            o['map'] = random.choice(maps.LOBBY);
            for (const i of this.active_slots()) sl[i]['civ'] = random.choice(civ_ui.playable());
        } else if (act === 'reset') {
            this.menu_cfg['slots'] = default_slots();
            this.menu_cfg['opts'] = match.defaults();
        } else if (act === 'play') {
            if (this.teams_ok()) this.start_from_menu();
        }
    }

    apply_choice(key, slot, value) {
        const o = this.opts();
        const sl = this.slots();
        if (key === 'player') {
            const [kind, lv] = value;
            sl[slot]['kind'] = kind;
            if (kind === 'ai') sl[slot]['level'] = lv;
            if (this.active_slots().length < 2) sl[slot]['kind'] = 'ai';
            this.fix_colors();
        } else if (key === 'nplayers') {
            this.set_players(value);
        } else if (key === 'ai_all') {
            for (const i of this.active_slots()) {
                if (sl[i]['kind'] === 'ai') sl[i]['level'] = value;
            }
        } else if (key === 'mode') {
            o['mode'] = value;
        } else {
            o[key] = value;
        }
    }

    /** Left click in the lobby: an open list -> the civilization picker window -> the screen's elements. */
    lobby_click(pos) {
        if (this.dropdown != null) {
            const [anchor, key, slot, vals, lbls, idx] = this.dropdown;
            this.dropdown = null;
            for (const [r, i] of W.list_rects(SCREEN_H, anchor, lbls.length)) {
                if (r.collidepoint(pos)) {
                    this.audio.click();
                    this.apply_choice(key, slot, vals[i]);
                    return true;
                }
            }
            return true;
        }
        if (this.picker != null) {
            const [box, items] = this.picker_rects();
            for (const [r, act, val] of items) {
                if (r.collidepoint(pos)) {
                    this.menu_action(act, val);
                    return true;
                }
            }
            if (!box.collidepoint(pos)) this.picker = null;
            return true;
        }
        return false;
    }

    start_from_menu() {
        const cfg = this.cfg_defaults();
        const sl = cfg['slots'];
        const act = this.active_slots();
        const n = act.length;
        const civs = act.map(i => sl[i]['civ']);
        const colors = act.map(i => sl[i]['color']);
        const levels = act.map(i => sl[i]['kind'] === 'human' ? null : sl[i]['level']);
        const teams = match.resolve_teams(act.map(i => sl[i]['team']));
        const o = { ...cfg['opts'] };
        try {
            gsettings.put('lobby', { 'slots': sl, 'opts': cfg['opts'] });
        } catch (e) { /* ignore */ }
        const args = {
            diff: 1, opponents: n - 1, map_type: py.get(o, 'map', maps.DEFAULT), civs: civs, teams: teams, colors: colors,
            levels: levels, settings: o,
        };
        this.begin_loading(args);            // screens.py: the loading screen -> the match
    }

    // ============================================================ drawing
    draw_setup() {
        const scr = this.screen;
        const cfg = this.cfg_defaults();
        const o = cfg['opts'];
        const sl = cfg['slots'];
        S.shade_overlay(scr, [0, 0, SCREEN_W, SCREEN_H], [20, 10, 4], 120);
        S.panel(scr, SHEET, 'parchment', false);
        W.plate(scr, [py.floordiv(SCREEN_W, 2), 54], i18n.t('menu.skirmish'), this.fonts['h'], 320);
        const mp = pygame.mouse.get_pos();
        const modal = this.dropdown != null || this.picker != null;
        const hov = modal ? (r => false) : (r => r.collidepoint(mp));
        const f = this.fonts['m'], fb = this.fonts['b'];
        // ---- players
        W.box(scr, PLAYERS);
        for (const [x, lbl] of [[PLAYERS.x + 120, i18n.t('lobby.player')], [PLAYERS.x + 460, i18n.t('lobby.civ')],
            [PLAYERS.x + 626, i18n.t('lobby.team')]]) {
            S.text_fit(scr, lbl, [x, PLAYERS.y + 22], this.fonts['l'], W.INK, 'center', null, 200);
        }
        const rects = this.setup_rects();
        for (const [r, act, val] of rects) {
            const h = hov(r);
            if (act === 'color') {
                W.color_badge(scr, r, PLAYER_COLORS[sl[val]['color']], val + 1, fb, h);
            } else if (act === 'player') {
                const s = sl[val];
                const lbl = s['kind'] === 'closed' ? i18n.t('lobby.closed')
                    : i18n.t('lobby.ai_slot', { level: match.ai_level_name(s['level']) });
                W.field(scr, r, lbl, f, h, undefined, s['kind'] !== 'closed' ? W.INK : [120, 100, 76]);
                if (s['kind'] === 'ai') {
                    for (let k = 0; k < 6; k++) {
                        const c = k <= s['level'] ? [190, 50, 30] : [170, 150, 116];
                        pygame.draw.circle(scr, c, [r.right - 90 + k * 11, r.centery], 4);
                    }
                }
            } else if (act === 'slot_civ') {
                const key = sl[val]['civ'];
                W.red_button(scr, r, civ_ui.civ_name(key), fb, h ? 'hover' : 'normal');
                civ_ui.blit_emblem(this, key, [r.x + 6, r.y + 2, 24, 28]);
            } else if (act === 'team') {
                W.field(scr, r, '', f, h, false);
                S.text(scr, TEAM_LBL[sl[val]['team']], r.center, this.fonts['l'], W.INK, 'center', null);
            } else if (act === 'nplayers') {
                S.text_fit(scr, i18n.t('lobby.players'), [PLAYERS.x + 50, r.centery], this.fonts['btn'], W.INK,
                    'midleft', null, r.x - PLAYERS.x - 58);
                W.field(scr, r, String(this.active_slots().length), fb, h);
            } else if (act === 'map') {
                const on = py.get(o, 'map', maps.DEFAULT) === val;
                const prev = this.map_preview(val, r.w - 8);
                pygame.draw.rect(scr, [40, 26, 12], r);
                scr.blit(prev, [r.x + 4, r.y + 4]);
                const fnt = this.fonts['bs'].size(maps.name(val))[0] <= r.w - 6 ? this.fonts['bs'] : this.fonts['s'];
                S.text(scr, maps.name(val), [r.centerx, r.bottom - 12], fnt,
                    on ? [255, 240, 200] : [230, 214, 178], 'center');
                pygame.draw.rect(scr, on ? [200, 40, 26] : h ? [230, 184, 96] : [120, 84, 40], r,
                    on ? 3 : 1);
            }
        }
        // "You" in the first row
        const r0 = new pygame.Rect(PLAYERS.x + 56, ROW_Y0 + 5, 262, 28);
        W.field(scr, r0, i18n.t('lobby.you', { name: i18n.player_name() }), fb, false, false);
        // terrain
        W.box(scr, MAPBOX);
        S.text(scr, i18n.t('lobby.map'), [MAPBOX.x + 16, MAPBOX.y + 15], this.fonts['l'], W.INK, 'midleft', null);
        const side = match.map_side(o, this.active_slots().length, py.get(o, 'map', maps.DEFAULT));
        S.text(scr, `${side}×${side} · ` + i18n.t('lobby.players_n', { n: this.active_slots().length }),
            [MAPBOX.right - 16, MAPBOX.y + 15], fb, W.INK, 'midright', null);
        // ---- parameters
        W.box(scr, SETBOX);
        S.text(scr, i18n.t('lobby.game_settings'), [SETBOX.centerx, SETBOX.y + 22], this.fonts['l'], W.INK, 'center',
            null);
        for (const [key, y] of this.setting_rows()) {
            const lbl = key === 'map' ? i18n.t('lobby.map') : match.label(key);
            S.text_fit(scr, lbl + ':', [SETBOX.x + 18, y + 15], fb, W.INK, 'midleft', null, 176);
        }
        for (const [r, act, val] of rects) {
            const h = hov(r);
            if (act === 'opt') {
                const [vals, lbls, idx] = this.option_values(val);
                const txt = idx != null ? lbls[idx] : i18n.t('lobby.mixed');
                if (val === 'map') {
                    W.red_button(scr, r, txt, fb, h ? 'hover' : 'normal');
                } else {
                    const dm = val === 'resources' && py.get(o, 'mode') === 'dm';
                    W.field(scr, r, dm ? i18n.t('match.val.mode.dm') : txt, f, h, undefined, undefined, !dm);
                }
            } else if (act === 'flag') {
                const fl = match.FLAGS.find(([k]) => k === val);
                if (fl === undefined) throw new py.StopIteration();
                const lbl = i18n.t(fl[1]);
                W.checkbox(scr, r, py.get(o, val), lbl, f, h);
            } else if (act === 'randomize' || act === 'reset') {
                W.red_button(scr, r, act === 'randomize' ? i18n.t('lobby.randomize') : i18n.t('lobby.reset'), fb,
                    h ? 'hover' : 'normal');
            } else if (act === 'back') {
                W.red_button(scr, r, i18n.t('menu.to_main'), fb, h ? 'hover' : 'normal');
            } else if (act === 'play') {
                const ok = this.teams_ok();
                W.red_button(scr, r, i18n.t('lobby.start'), fb, !ok ? 'disabled' : h ? 'hover' : 'normal');
                if (!ok) {
                    S.text(scr, i18n.t('lobby.need_two_teams'), [r.centerx, r.y - 12], fb, [170, 30, 20],
                        'center', null);
                }
            }
        }
        const fy = this.flags_y();
        S.text(scr, i18n.t('lobby.teams'), [SETBOX.x + 18, fy + 10], fb, [120, 30, 20], 'midleft', null);
        S.text(scr, i18n.t('lobby.advanced'), [SETBOX.x + 224, fy + 10], fb, [120, 30, 20], 'midleft', null);
        if (this.picker != null) this.draw_picker();
        if (this.dropdown != null) {
            const [anchor, key, slot, vals, lbls, idx] = this.dropdown;
            const rs = W.list_rects(SCREEN_H, anchor, lbls.length);
            const found = rs.find(([r]) => r.collidepoint(mp));
            const hi = found !== undefined ? found[1] : null;
            W.dropdown_list(scr, anchor, lbls, f, idx, hi);
        }
    }

    draw_picker() {
        const scr = this.screen;
        S.shade_overlay(scr, [0, 0, SCREEN_W, SCREEN_H], undefined, 150);
        const [box, items] = this.picker_rects();
        S.panel(scr, box, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], box, 2);
        const who = this.picker === 0 ? i18n.t('lobby.your_civ') : i18n.t('lobby.civ_of_player', { n: this.picker + 1 });
        W.plate(scr, [box.centerx, box.y + 30], who, this.fonts['h'], 420);
        const mp = pygame.mouse.get_pos();
        const sel = this.picker_sel;
        for (const [r, act, key] of items) {
            const h = r.collidepoint(mp);
            if (act === 'pick') {
                const on = key === sel;
                pygame.draw.rect(scr, !on ? [230, 212, 170] : [250, 236, 200], r);
                civ_ui.blit_emblem(this, key, [r.centerx - 26, r.y + 8, 52, 60]);
                S.text(scr, civ_ui.civ_name(key), [r.centerx, r.bottom - 14], this.fonts['bs'], W.INK,
                    'center', null);
                pygame.draw.rect(scr, on ? [190, 40, 26] : h ? [230, 184, 96] : [140, 104, 60], r,
                    on ? 3 : 1);
            } else {
                W.red_button(scr, r, act === 'pick_ok' ? i18n.t('common.confirm') : i18n.t('common.cancel'), this.fonts['b'],
                    h ? 'hover' : 'normal');
            }
        }
        const card = new pygame.Rect(box.x + 28 + 5 * 118 + 16, box.y + 70, box.right - (box.x + 28 + 5 * 118 + 16) - 28,
            box.h - 150);
        civ_ui.draw_card(this, sel || 'random', card, true);
    }

    /** A map icon (our own, from the real generation - game/map_icons.py): size - a side or (w, h). */
    map_preview(mt, size) {
        const map_icons = modules.map_icons;
        if (typeof size === 'number') return map_icons.icon(mt, size);
        return _fit(map_icons.icon(mt, Math.min(...size)), size);
    }

    /** A preview of an already created map (the loading screen) - with the same drawing as the lobby icons. */
    world_preview(w, size) {
        const map_icons = modules.map_icons;
        return _fit(map_icons.draw(w, Math.min(...size)), size);
    }
}
py.classattrs(LobbyUI, {
    dropdown: null,         // open list: (anchor, key, values, captions, current index)
    picker: null,           // the slot number for which the civilization picker is open
    picker_sel: null,       // the civilization highlighted in the picker window (until "Confirm")
});


export function _fit(img, size) {
    const out = new pygame.Surface(size);
    out.fill([20, 16, 12]);
    out.blit(img, [py.floordiv(size[0] - img.get_width(), 2), py.floordiv(size[1] - img.get_height(), 2)]);
    return out;
}
