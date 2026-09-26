// port of game/saves_ui.py
// The "Save Game" / "Load Game" window (the F10 menu in a match; "Single Player" -> "Load Game").
// On the left - slots (a thumbnail, name, date, civilization, match time), on the right - a large thumbnail and data,
// at the bottom - the save name (when saving), the buttons "Save"/"Load", "Delete", "Cancel".
// Files - game/savegame.py.
import * as py from '../runtime/py.js';
import { modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { SCREEN_W, SCREEN_H, TOP_H, VIEW_H } from './data.js';
import * as i18n from './i18n.js';
import * as naval from './naval.js';
import * as savegame from './savegame.js';
import * as S from './uiskin.js';
import * as W from './widgets.js';
import * as storage from '../runtime/storage.js';

// browser-only: the browser storage refused the save (quota full) - no locale key exists for it
const WEB_SAVE_FAILED = {
    'en': 'Not saved: browser storage is full - delete old saves', 'ru': 'Не сохранено: хранилище браузера заполнено - удалите старые сохранения',
    'de': 'Nicht gespeichert: Browser-Speicher voll - alte Spielstände löschen', 'fr': 'Non sauvegardé : stockage du navigateur plein - supprimez d’anciennes sauvegardes',
    'es': 'No guardado: almacenamiento del navegador lleno - borra partidas antiguas', 'pt-BR': 'Não salvo: armazenamento do navegador cheio - apague jogos antigos',
    'it': 'Non salvato: memoria del browser piena - elimina vecchi salvataggi',
};

export const BOX = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 470, 60, 940, 660);
export const LIST = new pygame.Rect(BOX.x + 24, BOX.y + 70, 520, 480);
export const ROW = 68;


export function _clock(t) {
    t = Math.trunc(t);
    return t >= 3600
        ? `${py.floordiv(t, 3600)}:${py.fmt(py.mod(py.floordiv(t, 60), 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}`
        : `${py.fmt(py.floordiv(t, 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}`;
}

/** The name of a save's civilization in the player's language (by the 'civ' key; old files - as written). */
export function _civ_name(meta) {
    const civ_ui = modules.civ_ui;
    const civ = py.get(meta, 'civ');
    return civ ? civ_ui.civ_name(civ) : py.get(meta, 'civ_name', '');
}

// the control groups (Python dict with int keys): always a Map {group number: list} - ui/controls/hud use
// .get/.has/.set; a plain object (older saves) is converted with numeric keys
function _rt_map_groups(groups, fn) {
    const out = new Map();
    if (groups instanceof Map) {
        for (const [k, v] of groups) out.set(k, fn(v));
    } else if (groups != null) {
        for (const k of Object.keys(groups)) out.set(Number(k), fn(groups[k]));
    }
    return out;
}


export class SavesUI {
    open_saves(mode, back = 'main') {
        this.saves_mode = mode;
        this.saves_back = back;
        this.saves_list = savegame.list_slots();
        this.saves_scroll = 0;
        this.saves_msg = null;
        this._thumbs = new Map();
        this.saves_sel = mode === 'save' ? null : (this.saves_list.length ? this.saves_list[0][0] : null);
        if (mode === 'save' && this.world != null) {
            const { civ_name } = modules.civ_ui;
            const p = this.world.players[this.world.human];
            this.save_name = `${civ_name(p.civ)} · ${_clock(this.world.time)}`;
            this._shot = this.game_snapshot();
        }
        if (this.state === 'menu') this.menu_screen = 'load';
        else this.help = mode;
    }

    close_saves() {
        if (this.state === 'menu')
            this.menu_screen = ['main', 'single'].includes(this.saves_back) ? this.saves_back : 'main';
        else this.help = 'menu';
    }

    /** A game frame without overlays (for the save thumbnail). */
    game_snapshot() {
        const keep = this.help;
        try {
            this.help = false;
            this.draw();
            return this.screen.subsurface([0, TOP_H, SCREEN_W, VIEW_H]).copy();
        } catch (e) {
            return null;
        } finally {
            this.help = keep;
        }
    }

    thumb(slot, path, size) {
        const key = py.tkey([slot, size]);
        let img = this._thumbs != null ? (this._thumbs.get(key) ?? null) : null;
        if (img == null && path) {
            try {
                img = pygame.transform.smoothscale(pygame.image.load(path), size);
            } catch (e) {
                img = null;
            }
            if (this._thumbs != null) this._thumbs.set(key, img);
        }
        return img;
    }

    // ---- layout
    saves_rects() {
        const items = [];
        const rows = (this.saves_mode === 'save' ? [[null, null, null]] : []).concat(Array.from(this.saves_list));
        rows.forEach(([slot, meta, th], i) => {
            const r = new pygame.Rect(LIST.x + 4, LIST.y + 4 + i * ROW - this.saves_scroll, LIST.w - 8, ROW - 6);
            if (r.bottom > LIST.y && r.y < LIST.bottom) items.push([r, 'slot', slot]);
        });
        const y = BOX.bottom - 58;
        if (this.saves_mode === 'save')
            items.push([new pygame.Rect(LIST.x, LIST.bottom + 16, LIST.w, 34), 'name', null]);
        items.push([new pygame.Rect(BOX.right - 690, y, 210, 42), 'do', null]);
        items.push([new pygame.Rect(BOX.right - 466, y, 210, 42), 'delete', null]);
        items.push([new pygame.Rect(BOX.right - 242, y, 210, 42), 'cancel', null]);
        return items;
    }

    // ---- actions
    saves_action(act, val) {
        if (act === 'slot') {
            this.saves_sel = val;
            if (val != null && this.saves_mode === 'save') {
                const hit = this.saves_list.find(([s]) => s === val);
                const meta = hit !== undefined ? hit[1] : null;
                if (py.bool(meta)) this.save_name = py.get(meta, 'name', this.save_name);
            }
        } else if (act === 'cancel') {
            this.close_saves();
        } else if (act === 'delete') {
            if (this.saves_sel != null) {
                savegame.delete_slot(this.saves_sel);
                this.saves_list = savegame.list_slots();
                this.saves_sel = this.saves_mode === 'save' ? null : (
                    this.saves_list.length ? this.saves_list[0][0] : null);
            }
        } else if (act === 'do') {
            if (this.saves_mode === 'save') {
                this.do_save(this.saves_sel || savegame.new_slot_name(), this.save_name);
                this.saves_msg = i18n.t('saves.saved');
                this.help = false;
            } else if (this.saves_sel != null) {
                this.do_load(this.saves_sel);
            }
        }
    }

    do_save(slot, name = null) {
        const w = this.world;
        const ui = this.ui_state();
        const shot = this._shot != null ? this._shot : this.game_snapshot();
        this._shot = null;
        const before = storage.last_error;
        const path = savegame.save_world(w, slot, name, ui, shot);
        w.msg(i18n.t('saves.game_saved', { name: name || slot }), [170, 230, 150]);
        // persistence is asynchronous: if the browser rejected the write, say so and drop the in-memory copy
        // (otherwise the slot would be listed now and silently vanish after a reload)
        storage.flush().then(() => {
            const err = storage.last_error;
            if (err && err !== before && py.os.path.normpath(err.path).startsWith(py.os.path.normpath(path).replace(/\.[^.\/]*$/, ''))) {
                const png = savegame.slot_path(slot, '.png');
                Promise.all([path, path + '.tmp', png].map(p => storage.revert(p))).then(() => {
                    // no older save in this slot -> its fresh thumbnail (which may have fit) is an orphan
                    if (!storage.exists(path) && storage.exists(png)) storage.remove(png);
                });
                w.msg(WEB_SAVE_FAILED[i18n.current()] || WEB_SAVE_FAILED['en'], [240, 120, 100]);
            }
        });
        return path;
    }

    /** What of the interface is saved together with the world: the camera, speed, groups (references to the world's units). */
    ui_state() {
        const groups = py.getattr(this, 'groups', null);
        return {
            'cam_x': this.cam_x, 'cam_y': this.cam_y, 'zoom': this.zoom, 'speed': this.speed,
            'groups': _rt_map_groups(groups, v => Array.from(v)),
        };
    }

    restore_groups(groups) {
        if (groups instanceof Map || py.is_dict(groups)) {
            this.groups = _rt_map_groups(groups, v => v.filter(u => py.getattr(u, 'alive', false) || py.getattr(u, 'inside', null)));
        }
    }

    do_load(slot) {
        let w, ui, meta;
        try {
            [w, ui, meta] = savegame.load_world(slot);
        } catch (ex) {          // a broken/old file - report it, do not crash
            console.warn('load failed', ex);
            this.saves_msg = i18n.t('saves.load_failed', { err: (ex && ex.constructor && ex.constructor.name) || 'Error' });
            return false;
        }
        this.attach_world(w, ui);
        this.help = false;
        this.last_start = py.getattr(this, 'last_start', null);
        w.msg(i18n.t('saves.loaded', { name: py.get(meta, 'name', slot) }), [170, 230, 150]);
        return true;
    }

    saves_event(e) {
        if (e.type === pygame.KEYDOWN) {
            if (e.key === pygame.K_ESCAPE) {
                this.close_saves();
                return true;
            }
            if (this.saves_mode === 'save') {
                if (e.key === pygame.K_RETURN || e.key === pygame.K_KP_ENTER) this.saves_action('do', null);
                else if (e.key === pygame.K_BACKSPACE) this.save_name = this.save_name.slice(0, -1);
                else if (e.unicode && py.isprintable(e.unicode) && this.save_name.length < 40) this.save_name += e.unicode;
                return true;
            }
            if (e.key === pygame.K_RETURN || e.key === pygame.K_KP_ENTER) {
                this.saves_action('do', null);
                return true;
            }
            return this.state !== 'menu';
        }
        if (e.type === pygame.MOUSEWHEEL) {
            const n = this.saves_list.length + (this.saves_mode === 'save' ? 1 : 0);
            this.saves_scroll = Math.max(0, Math.min(Math.max(0, n * ROW - LIST.h + 8), this.saves_scroll - e.y * 40));
            return true;
        }
        if (e.type === pygame.MOUSEBUTTONDOWN && e.button === 1) {
            for (const [r, act, val] of this.saves_rects()) {
                if (r.collidepoint(e.pos)) {
                    if (act === 'slot' && !LIST.collidepoint(e.pos)) continue;
                    this.audio.click();
                    this.saves_action(act, val);
                    return true;
                }
            }
            return true;
        }
        return false;
    }

    // ---- drawing
    draw_saves() {
        const scr = this.screen;
        S.shade_overlay(scr, [0, 0, SCREEN_W, SCREEN_H], [10, 6, 2], 150);
        S.panel(scr, BOX, 'parchment', false);
        pygame.draw.rect(scr, [120, 84, 40], BOX, 2);
        W.plate(scr, [BOX.centerx, BOX.y + 30],
            this.saves_mode === 'save' ? i18n.t('saves.save_game') : i18n.t('saves.load_game'),
            this.fonts['h'], 360);
        W.box(scr, LIST, 40);
        const mp = pygame.mouse.get_pos();
        const f = this.fonts['m'], fb = this.fonts['b'];
        const clip = scr.get_clip();
        const rects = this.saves_rects();
        scr.set_clip(LIST.inflate(-4, -4));
        const metas = new Map();
        for (const [s, m, th] of this.saves_list) metas.set(s, [m, th]);
        for (const [r, act, slot] of rects) {
            if (act !== 'slot') continue;
            const on = slot === this.saves_sel;
            const h = r.collidepoint(mp);
            pygame.draw.rect(scr, on ? [250, 236, 200] : h ? [232, 214, 174] : [220, 200, 158], r);
            pygame.draw.rect(scr, on ? [190, 40, 26] : [140, 104, 60], r, on ? 2 : 1);
            if (slot == null) {
                S.blit_icon(scr, 'construction', [r.x + 50, r.centery], 40);
                S.text_fit(scr, i18n.t('saves.new'), [r.x + 110, r.centery], this.fonts['l'], W.INK, 'midleft',
                    null, r.right - r.x - 120);
                continue;
            }
            const [meta, th] = metas.has(slot) ? metas.get(slot) : [{}, null];
            const img = this.thumb(slot, th, [96, 60]);
            if (img != null) scr.blit(img, [r.x + 4, r.y + 2]);
            else pygame.draw.rect(scr, [60, 50, 40], [r.x + 4, r.y + 2, 96, 60]);
            S.text(scr, py.get(meta, 'name', slot), [r.x + 110, r.y + 16], fb, W.INK, 'midleft', null);
            S.text_fit(scr, `${py.get(meta, 'date', '')}  ·  ${_civ_name(meta)}  ·  ${_clock(py.get(meta, 'time', 0))}`,
                [r.x + 110, r.y + 42], f, [100, 70, 40], 'midleft', null, r.right - r.x - 120);
        }
        scr.set_clip(clip);
        if (!this.saves_list.length && this.saves_mode === 'load') {
            S.text_fit(scr, i18n.t('saves.empty'), LIST.center, this.fonts['l'], [110, 80, 50], 'center',
                null, LIST.w - 20);
        }
        // on the right - the selection
        const right = new pygame.Rect(LIST.right + 20, LIST.y, BOX.right - LIST.right - 44, LIST.h);
        W.box(scr, right, 40);
        const sel = metas.has(this.saves_sel) ? metas.get(this.saves_sel) : null;
        if (sel != null || this.saves_mode === 'save') {
            const [meta, th] = sel != null ? sel : [{}, null];
            const tsz = [right.w - 20, Math.trunc((right.w - 20) * 0.625)];
            const img = sel != null ? this.thumb(this.saves_sel, th, tsz) : (
                this._shot != null ? pygame.transform.smoothscale(this._shot, tsz) : null);
            if (img != null) scr.blit(img, [right.x + 10, right.y + 10]);
            let y = right.y + tsz[1] + 30;
            let rows;
            if (sel != null) {
                rows = [['time', _clock(py.get(meta, 'time', 0))], ['diplomacy', _civ_name(meta)],
                    ['population', i18n.t('saves.players_n', { n: py.get(meta, 'players', 0) })],
                    ['portraits/technologies/cartography.png',
                        `${py.get(naval.MAP_NAMES, py.get(meta, 'map'), '')} · ${py.get(meta, 'size', '')}²`],
                    ['encyclopaedia', py.get(meta, 'date', '')]];
            } else {
                const w = this.world;
                rows = [['time', _clock(w.time)], ['population', i18n.t('saves.players_n', { n: w.players.length })]];
            }
            for (const [ic, txt] of rows) {
                S.blit_icon(scr, ic, [right.x + 26, y], 24);
                S.text_fit(scr, txt, [right.x + 48, y], fb, W.INK, 'midleft', null, right.w - 60);
                y += 32;
            }
        }
        for (const [r, act] of rects) {
            const h = r.collidepoint(mp);
            if (act === 'name') {
                const caret = py.mod(py.floordiv(pygame.time.get_ticks(), 400), 2) ? '|' : '';
                S.text(scr, i18n.t('saves.name'), [r.x - 4, r.y - 10], this.fonts['bs'], W.INK, undefined, null);
                W.field(scr, r, this.save_name + caret, fb, true, false);
            } else if (act === 'do') {
                const ok = this.saves_mode === 'save' || this.saves_sel != null;
                W.red_button(scr, r, this.saves_mode === 'save' ? i18n.t('gm.save') : i18n.t('gm.load'), fb,
                    !ok ? 'disabled' : h ? 'hover' : 'normal');
            } else if (act === 'delete') {
                W.red_button(scr, r, i18n.t('common.delete'), fb,
                    this.saves_sel == null ? 'disabled' : h ? 'hover' : 'normal');
            } else if (act === 'cancel') {
                W.red_button(scr, r, i18n.t('common.cancel'), fb, h ? 'hover' : 'normal');
            }
        }
        if (this.saves_msg) {
            S.text(scr, this.saves_msg, [BOX.centerx, BOX.bottom - 76], fb, [170, 30, 20], 'center', null);
        }
    }
}
py.classattrs(SavesUI, {
    saves_mode: 'load',
    saves_list: [],
    saves_sel: null,
    saves_scroll: 0,
    save_name: '',
    saves_back: 'main',
    saves_msg: null,
    _thumbs: null,
    _shot: null,
});
