// port of game/hud.py
/* The in-game interface (a mixin of ui.Game) in the AoE2 DE layout:

  top      - resources "wood · food · gold · stone" with the number of villagers on each, population, idle,
             the age (a progress bar during advancement), the coat of arms, 5 round buttons (objectives, chat, diplomacy,
             tech tree, menu); under it the control group icons and the global queue;
  bottom   - two panels with a window onto the world between them: the command panel (a 5x3 grid + the selection parchment)
             and the minimap panel (a diamond + 4 corner buttons), above it the player score (F4);
  tooltips - a dark plate at the left above the panel, with a delay.
Windows over the game - game/hud_windows.py. Graphics of the frame - game/uiskin.py. */
import * as py from '../runtime/py.js';
import { modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import {
    SCREEN_W, SCREEN_H, TOP_H, PANEL_H, TILE, GAME_SPEED, RES, RES_COLOR, AGE_NAMES,
    NODE_DEFS, TECHS, UNITS, BUILDINGS, ANIMALS, FARM_RATE, AGE_TECHS, BUILD_MENU, HOTKEYS,
    as_tuple, shade,
} from './data.js';
import { Unit, Building, Node, Animal } from './world.js';
import * as civ_ui from './civ_ui.js';
import * as hud_windows from './hud_windows.js';
import * as i18n from './i18n.js';
import * as S from './uiskin.js';
import * as themes from './themes.js';

// ---------------------------------------------------------------- layout (1280x800)
export const PY0 = SCREEN_H - PANEL_H;                               // top of the command panel
export const CMD_FULL = new pygame.Rect(0, PY0, 833, PANEL_H);       // command panel (DE: 1125/1920 at a height of 1080)
export const CMD_SMALL = new pygame.Rect(0, PY0, 262, PANEL_H);      // collapsed: the grid only
export const MAP_PANEL = new pygame.Rect(SCREEN_W - 367, SCREEN_H - 181, 367, 181);
export const MM_RECT = new pygame.Rect(MAP_PANEL.x + 29, MAP_PANEL.y + 13, 310, 155);   // minimap diamond 2 : 1
export const GRID_BOX = new pygame.Rect(6, PY0 + 8, 240, PANEL_H - 14);
export const INFO_BOX = new pygame.Rect(252, PY0 + 8, 550, PANEL_H - 14);
export const GRID_X = 14, GRID_Y = PY0 + 16, GRID_STEP = 45, BTN = 42;
export const COLLAPSE_FULL = new pygame.Rect(807, PY0 + 10, 20, 26);
export const COLLAPSE_SMALL = new pygame.Rect(238, PY0 + 10, 20, 26);
export const INFO_X = INFO_BOX.x + 10;
export const PORT = 56;                 // large portrait (~ 1/3 of the panel height, as in DE)
export const TX = INFO_X + PORT + 16;   // stats column
export const TOP_RES = ['wood', 'food', 'gold', 'stone'];            // DE order
// DE: objectives - a scroll with a red tick, chat - a horn, diplomacy - a wreath with a handshake, tree - a gear, menu - a scroll
// captions of buttons, modes, jobs and help are locale keys (hud.*, job.*, bonus.*, help.*)
export const TOP_BTNS = [['objectives', 'hud.objectives', ['portraits/de/top_objectives.png', 'victory']],
    ['chat', 'hud.chat', ['portraits/de/top_chat.png']],
    ['diplomacy', 'hud.diplomacy', ['portraits/de/top_diplomacy.png', 'diplomacy']],
    ['techtree', 'hud.techtree', ['portraits/de/top_techtree.png', 'upgrade']],
    ['menu', 'hud.menu', ['match-settings']]];
export const MM_BTNS = ['flare', 'score', 'colors', 'mode'];         // ↖ ↗ ↙ ↘
export const MM_MODES = ['hud.mm.normal', 'hud.mm.military', 'hud.mm.economy'];
export const TIP_DELAY = 350;           // ms before a tooltip appears
export const TEAM_COLORS = { 'me': [70, 130, 255], 'ally': [240, 215, 60], 'enemy': [225, 50, 40] };

// villager grid: two pages with fixed places (DE)
export const ECO_PAGE = {
    'house': 0, 'mill': 1, 'mining_camp': 2, 'lumber_camp': 3, 'dock': 4,
    'farm': 5, 'blacksmith': 6, 'market': 7, 'monastery': 8, 'university': 9,
    'town_center': 10, 'wonder': 11,
};
export const MIL_PAGE = {
    'barracks': 0, 'archery_range': 1, 'stable': 2, 'siege_workshop': 3,
    'outpost': 5, 'palisade_wall': 6, 'stone_wall': 7, 'tower': 8, 'bombard_tower': 9,
    'gate': 10, 'palisade_gate': 11, 'castle': 12,
};
// town center: villager Q, loom A, wheelbarrow S, town watch D, eject G, age Z, town bell B
export const TC_SLOTS = {
    'villager': 0, 'loom': 5, 'wheelbarrow': 6, 'hand_cart': 6, 'town_watch': 7, 'town_patrol': 7,
    'feudal': 10, 'castle': 10, 'imperial': 10,
};

export const X_ICONS = {
    'bell': 'bell_level2', 'clear': 'back-to-work', 'eject': 'garrison-out', 'shield': 'garrison',
    // DE trebuchet: packed / unpacked - a render of our model (tools/build_portraits.py --orders)
    'treb_pack': 'portraits/orders/treb_packed.png', 'treb_up': 'portraits/orders/treb_up.png',
};
// DE: attack - a sword, armor - a cuirass, range - a target with an arrow, speed - a boot (tools/ui_icon_art.py)
export const STAT_ICONS = {
    'atk': 'portraits/de/stat_atk.png', 'arm': 'portraits/de/stat_arm.png',
    'rng': 'portraits/de/stat_rng.png', 'spd': 'portraits/de/stat_spd.png',
};
export const STAT_ICONS_0AD = {
    'atk': 'portraits/technologies/sword_01.png', 'arm': 'portraits/technologies/armor_scale.png',
    'rng': 'portraits/technologies/arrow_01.png', 'spd': 'portraits/technologies/walk.png',
};
export const BONUS_NAMES = Object.fromEntries(['cav', 'arch', 'bld', 'inf', 'spear', 'siege', 'monk', 'camel', 'ship']
    .map(k => [k, 'bonus.' + k]));
export const VIL_JOB = Object.fromEntries(['wood', 'gold', 'stone', 'berries', 'farm', 'hunt', 'build', 'fish']
    .map(k => [k, 'job.' + k]));
export const ROMAN = ['I', 'II', 'III', 'IV'];
// help: (keys, action); keys are letters as they are, words (LMB, Shift + placement...) are help.k<n> keys
export const HELP_ROWS = [
    ['help.k1', 'help.v1'],
    ['help.k2', 'help.v2'],
    ['Q W E R T · A S D F G · Z X C V B', 'help.v3'],
    ['help.k4', 'help.v4'],
    ['help.k5', 'help.v5'],
    ['help.k6', 'help.v6'],
    ['help.k7', 'help.v7'],
    ['Ctrl + 1…9 / 1…9', 'help.v8'],
    ['H', 'help.v9'],
    ['.', 'help.v10'],
    ['help.k11', 'help.v11'],
    ['help.k12', 'help.v12'],
    ['+ / −', 'help.v13'],
    ['P / F3', 'help.v14'],
    ['F4 · F11', 'help.v15'],
    ['F5 · Enter', 'help.v16'],
    ['Delete', 'help.v17'],
    ['help.k18', 'help.v18'],
    ['help.k19', 'help.v19'],
    ['F2 · F10', 'help.v20'],
];
export const GAME_MENU = [['resume', 'gm.continue', 'call-to-arms'], ['help', 'gm.help', 'encyclopaedia'],
    ['civ', 'gm.civ', 'diplomacy'], ['quit', 'menu.to_main', 'cancel']];


export function _lum(c) {
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

// groups: {n: [units]} (controls.py) - an int-keyed dict, a Map in JS (a plain object is tolerated)
function _group_get(groups, n) {
    if (groups == null) return [];
    if (groups instanceof Map) return groups.has(n) ? groups.get(n) : [];
    return Object.hasOwn(groups, n) ? groups[n] : [];
}


export class HudUI {
    // ============================================================ state
    /** A new match: the default interface state. */
    hud_reset() {
        this.window = null;
        this.info_collapsed = false;
        this.build_page = null;
        this._bp_key = null;
        this.chat_log = [];             // (text, color)
        this.chat_text = '';
        this.chat_to = 'all';
        this.chat_replies = [];         // (time in ms, text, color) - allies' replies
        this.show_history = false;
        this.group_hits = [];
        this.gq_hits = [];
        this.top_btn_rects = [];
        this.mm_btn_rects = [];
        this._tip = [null, 0];
        this._score = [-1.0, new Map()];
        this.tt_civ = null;
        this.show_score = this.hud_opt('show_score', true);
        const f = this.fonts;
        py.setdefault(f, 'n', S.font('antiqua', 18, true));
        py.setdefault(f, 'age', S.font('antiqua', 18, true));
        py.setdefault(f, 'tip', S.font('antiqua', 13, true));
        py.setdefault(f, 'tipb', S.font('antiqua', 15, true));
    }

    /** An interface setting: game.settings (the "Settings" menu), then the sound settings, otherwise the default. */
    hud_opt(name, dflt = null) {
        for (const st of [py.getattr(this, 'settings', null), py.getattr(py.getattr(this, 'audio', null), 'settings', null)]) {
            if (st != null && py.is_dict(st) && py.contains(st, name)) return py.getitem(st, name);
        }
        return dflt;
    }

    cmd_rect() {
        return this.info_collapsed ? CMD_SMALL : CMD_FULL;
    }

    /** Interface rectangles covering the world (for clicks and the cursor). */
    hud_rects() {
        const rs = [new pygame.Rect(0, 0, SCREEN_W, TOP_H), civ_ui.top_emblem_rect(), this.cmd_rect(), MAP_PANEL];
        for (const [r] of this.group_hits) rs.push(r);
        for (const [r] of this.gq_hits) rs.push(r);
        if (this.window) rs.push(hud_windows.box(this.window));
        return rs;
    }

    /** A point on the world (not under the panels). */
    hud_view(pos) {
        if (!(TOP_H <= pos[1] && pos[1] < SCREEN_H && 0 <= pos[0] && pos[0] < SCREEN_W)) return false;
        return !this.hud_rects().some(r => r.collidepoint(pos));
    }

    // ============================================================ icons
    owner_civ_key(owner) {
        const w = this.world;
        if (w != null && 0 <= owner && owner < w.players.length) return w.players[owner].civ;
        return py.get(this.menu_cfg, 'civ', 'random');
    }

    /** A 0 A.D. portrait/icon for Game.icon or None (then a procedural one). */
    skin_icon(typ, name, owner, size) {
        if (typ === 'x') {
            const fn = py.get(X_ICONS, name, null);
            if (fn == null) return null;
            const full = fn.startsWith('portraits/');          // a picture filling the whole cell (DE)
            const ic = S.icon(fn, full ? size : Math.trunc(size * 0.86));
            if (ic == null) return null;
            const out = new pygame.Surface([size, size], pygame.SRCALPHA);
            out.blit(ic, ic.get_rect({ center: [py.floordiv(size, 2), py.floordiv(size, 2)] }));
            return out;
        }
        if (!['u', 'b', 't', 'n'].includes(typ)) return null;
        const civ = this.owner_civ_key(owner);
        let up = null;
        if (typ === 't') {
            const t = py.get(TECHS, name, {});
            if (py.bool(py.get(t, 'upgrade', null))) up = t['upgrade'][1];
        }
        return S.portrait(typ, name, civ, size, up);
    }

    res_icon(r, cx, cy, s = 7) {
        const size = 2 * s + 6;
        if (S.blit_icon(this.screen, r, [cx, cy], size)) return;
        const scr = this.screen;
        pygame.draw.circle(scr, py.get(RES_COLOR, r, [200, 200, 200]), [cx, cy], s);
        pygame.draw.circle(scr, [30, 24, 18], [cx, cy], s, 1);
    }

    pop_icon(cx, cy, size = 20) {
        if (S.blit_icon(this.screen, 'pop', [cx, cy], size)) return;
        pygame.draw.circle(this.screen, [230, 210, 170], [cx, cy - 4], 3);
        pygame.draw.rect(this.screen, [230, 210, 170], [cx - 4, cy, 8, 7], 0, 3);
    }

    /** A stat icon + a number; returns x after the label. */
    stat(x, y, kind, val) {
        const ic = stat_icon(kind, 18);
        if (ic != null) {
            const r0 = ic.get_rect({ midleft: [x, y] });
            this.screen.blit(ic, r0);
        }
        const r = this.text(val, [x + 24, y], 'b', undefined, 'midleft');
        return r.right + 16;
    }

    /** An age crest (DE: 4 different crests - round, kite-shaped, with a tower, quartered with a crown).
     *  dim - the age has not been reached yet (grey). */
    age_shield(cx, cy, age, h = 40, color = null, dim = false) {
        const scr = this.screen;
        let em = S.icon(`portraits/de/age_${Math.max(0, Math.min(3, age))}.png`, Math.trunc(h * 1.12));
        if (em != null) {
            if (dim) {
                em = pygame.transform.grayscale(em);
                em.fill([150, 150, 150], null, pygame.BLEND_RGB_MULT);
            }
            scr.blit(em, em.get_rect({ center: [cx, cy] }));
            return;
        }
        const wdt = Math.trunc(h * 0.8);
        const x0 = cx - py.floordiv(wdt, 2), y0 = cy - py.floordiv(h, 2);
        const pts = [[x0, y0], [x0 + wdt, y0], [x0 + wdt, y0 + h * 0.55], [cx, y0 + h], [x0, y0 + h * 0.55]];
        pygame.draw.polygon(scr, [20, 14, 8], pts.map(([px, py_]) => [px + 1, py_ + 2]));
        pygame.draw.polygon(scr, color || [120, 32, 28], pts);
        const half = [[cx, y0], [x0 + wdt, y0], [x0 + wdt, y0 + h * 0.55], [cx, y0 + h]];
        pygame.draw.polygon(scr, shade(color || [120, 32, 28], -35), half);
        pygame.draw.polygon(scr, S.GOLD, pts, 2);
        const img = S.gold_text(ROMAN[Math.max(0, Math.min(3, age))], h < 34 ? this.fonts['n'] : this.fonts['l']);
        scr.blit(img, img.get_rect({ center: [cx, cy - h * 0.06] }));
    }

    // ============================================================ top panel
    my_civ() {
        const w = py.getattr(this, 'world', null);
        return (w != null && w.players.length) ? w.players[0].civ : py.get(this.menu_cfg, 'civ', 'random');
    }

    top_bg() {
        let bg = py.getattr(this, '_top_bg', null);
        const civ = this.my_civ();
        if (bg != null && py.getattr(this, '_top_bg_civ', null) !== civ) bg = null;
        if (bg == null) {
            this._top_bg_civ = civ;
            bg = new pygame.Surface([SCREEN_W, TOP_H + 6], pygame.SRCALPHA);
            bg.blit(S.culture_panel([SCREEN_W, TOP_H], civ), [0, 0]);
            S.bevel(bg, [0, 0, SCREEN_W, TOP_H], undefined, undefined, 2);
            // the resource block and the button block are embossed, with a narrow bar between them
            for (const r of [new pygame.Rect(2, 2, 772, TOP_H - 4), new pygame.Rect(1038, 2, SCREEN_W - 1040, TOP_H - 4)]) {
                S.bevel(bg, r, undefined, undefined, 2);
                pygame.draw.rect(bg, [30, 20, 10], r, 1);
            }
            const plank = new pygame.Rect(776, 10, 260, TOP_H - 20);
            const s = new pygame.Surface(plank.size, pygame.SRCALPHA);
            s.fill([0, 0, 0, 80]);
            bg.blit(s, plank.topleft);
            pygame.draw.line(bg, [14, 10, 6], [0, TOP_H - 1], [SCREEN_W, TOP_H - 1], 1);
            S.trim_band(bg, [0, TOP_H - 6, SCREEN_W, 6], civ);          // culture border ornament
            for (let i = 0; i < 6; i++) {     // soft shadow on the map
                pygame.draw.line(bg, [0, 0, 0, 90 - i * 15], [0, TOP_H + i], [SCREEN_W, TOP_H + i]);
            }
            this._top_bg = bg;
        }
        return bg;
    }

    /** A dark square cell under a resource icon (as in DE). */
    icon_box(r) {
        pygame.draw.rect(this.screen, [12, 9, 6], r.inflate(2, 2));
        pygame.draw.rect(this.screen, [40, 32, 24], r);
        pygame.draw.rect(this.screen, [120, 98, 64], r, 1);
    }

    /** The player's villagers by job: {'wood'|'food'|'gold'|'stone'|'build'|'idle': n}. */
    vil_jobs() {
        const w = this.world;
        const cnt = { wood: 0, food: 0, gold: 0, stone: 0, build: 0, idle: 0 };
        for (const u of w.units) {
            if (u.owner !== 0 || u.cls !== 'vil') continue;
            const t = u.target;
            let r;
            if (u.state === 'gather' && t != null) {
                r = (t instanceof Building || t instanceof Animal) ? 'food' : py.getattr(t, 'res', 'food');
            } else if (u.state === 'return' && u.carry_res) {
                r = u.carry_res;
            } else if (u.state === 'build') {
                r = 'build';
            } else if (u.state === 'idle') {
                r = 'idle';
            } else {
                r = null;
            }
            if (r != null && Object.hasOwn(cnt, r)) cnt[r] += 1;
        }
        return cnt;
    }

    /** (next age, share) during advancement or None. */
    age_progress(p) {
        for (const b of this.world.buildings) {
            if (b.owner === p.id && b.queue.length && b.queue[0][0] === 'tech' && py.contains(AGE_TECHS, b.queue[0][1])) {
                const name = b.queue[0][1];
                return [name, Math.max(0.0, Math.min(1.0, b.qt / Math.max(0.01, p.time_of('tech', name))))];
            }
        }
        return null;
    }

    draw_top() {
        const scr = this.screen;
        const w = this.world;
        const p = w.players[0];
        this.hud_tick();
        scr.blit(this.top_bg(), [0, 0]);
        const mp = pygame.mouse.get_pos();
        const cy = py.floordiv(TOP_H, 2);
        const jobs = this.vil_jobs();
        let x = 6;
        for (const r of TOP_RES) {
            const ib = new pygame.Rect(x + 2, 5, 38, 38);
            this.icon_box(ib);
            S.blit_icon(scr, r, ib.center, 32) || this.res_icon(r, ib.centerx, ib.centery, 12);
            this.text(String(jobs[r]), [ib.right - 2, ib.bottom], 'bs', [255, 255, 255], 'bottomright');
            this.text(String(Math.trunc(p.res[r])), [ib.right + 8, cy], 'b', undefined, 'midleft');
            x += 89;
        }
        // population: an icon + the total number of villagers, "pop/cap" (blinks when capped and waiting for houses)
        let ib = new pygame.Rect(x + 2, 5, 38, 38);
        this.icon_box(ib);
        this.pop_icon(ib.centerx, ib.centery, 32);
        const nvil = w.units.filter(u => u.owner === 0 && u.cls === 'vil').length;
        this.text(String(nvil), [ib.right - 2, ib.bottom], 'bs', [255, 255, 255], 'bottomright');
        const housed = p.pop >= p.cap && w.buildings.some(b => b.queue.length && b.owner === 0 && b.housed);
        const flash = housed && py.mod(py.floordiv(pygame.time.get_ticks(), 400), 2);
        const popc = p.pop >= p.cap ? S.RED : S.TEXT;
        const pr = this.text(`${p.pop}/${p.cap}`, [ib.right + 8, cy], 'b', popc, 'midleft');
        if (flash) pygame.draw.rect(scr, [230, 70, 40], pr.inflate(8, 6), 2, 3);
        x += 104;
        // idle villagers - a yellow circle right after the population
        const idle = jobs['idle'];
        const c = [x + 20, cy];
        this.idle_rect = new pygame.Rect(c[0] - 19, c[1] - 19, 38, 38);
        pygame.draw.circle(scr, [20, 14, 8], [c[0] + 1, c[1] + 2], 18);
        pygame.draw.circle(scr, idle ? [228, 184, 36] : [130, 110, 60], c, 18);
        pygame.draw.circle(scr, [255, 232, 140], c, 18, 2);
        idle_figure(scr, c);
        if (idle) this.text(String(idle), [c[0] + 18, c[1] + 18], 'bs', [255, 255, 255], 'bottomright');
        if (this.idle_rect.collidepoint(mp)) pygame.draw.circle(scr, S.GOLD_HI, c, 20, 2);
        x += 44;
        // age: a shield with a numeral + a bar with the name; during advancement - a progress bar
        this.age_shield(x + 24, cy, p.age, 40, shade(p.color, -60));
        const bar = new pygame.Rect(x + 50, 8, 772 - x - 56, TOP_H - 16);
        pygame.draw.rect(scr, [18, 13, 8], bar);
        const prog = this.age_progress(p);
        let label;
        if (prog) {
            const [name, fr] = prog;
            pygame.draw.rect(scr, [60, 110, 40], [bar.x + 1, bar.y + 1, Math.trunc((bar.w - 2) * fr), bar.h - 2]);
            pygame.draw.line(scr, [130, 190, 90], [bar.x + 1, bar.y + 2], [bar.x + Math.trunc((bar.w - 2) * fr), bar.y + 2]);
            label = `${TECHS[name]['name']} · ${Math.trunc(fr * 100)}%`;
        } else {
            label = AGE_NAMES[p.age];
        }
        pygame.draw.rect(scr, [110, 88, 56], bar, 1);
        const img = S.gold_text(label, this.fonts['age']);
        scr.blit(img, img.get_rect({ center: bar.center }));
        // bar: sound and music
        this.audio.draw_icon(scr, 790, cy - 10);
        // the civilization's coat of arms - a banner before the buttons
        civ_ui.draw_top(this);
        // 5 round buttons
        this.top_btn_rects = [];
        TOP_BTNS.forEach(([act, , ic], i) => {
            const bc = [1062 + i * 46, cy];
            const r = new pygame.Rect(bc[0] - 19, bc[1] - 19, 38, 38);
            this.top_btn_rects.push([r, act]);
            const on = this.window === act || (act === 'menu' && this.help === 'menu');
            const h = r.collidepoint(mp);
            pygame.draw.circle(scr, [14, 10, 6], [bc[0] + 1, bc[1] + 2], 19);
            pygame.draw.circle(scr, !h ? [58, 44, 30] : [84, 64, 40], bc, 18);
            pygame.draw.circle(scr, (on || h) ? S.GOLD_HI : [150, 118, 70], bc, 18, 2);
            let drawn = false;
            for (const c2 of ic) {
                if (S.blit_icon(scr, c2, bc, c2.startsWith('portraits/') ? 28 : 24)) { drawn = true; break; }
            }
            if (!drawn) chat_icon(scr, bc);
        });
        this.menu_btn_rect = this.top_btn_rects[this.top_btn_rects.length - 1][0];
        // below the top: group icons, the global queue, the clock
        this.draw_groups();
        this.draw_global_queue();
        this.draw_clock();
    }

    draw_clock() {
        if (!this.clock_mode) return;
        const t = Math.trunc(this.world.time);
        const spc = this.speed !== GAME_SPEED ? [255, 220, 120] : [225, 215, 190];
        let s = `${py.floordiv(t, 3600)}:${py.fmt(py.mod(py.floordiv(t, 60), 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}  ×${py.fmt(this.speed, 'g')}`;
        if (this.clock_mode === 2) s += '  ' + i18n.t('hud.fps', { n: Math.trunc(this.clock.get_fps()) });
        const img = this.fonts['bs'].render(s, true, spc);
        const r = img.get_rect({ topright: [SCREEN_W - 8, TOP_H + 26] });
        S.shade_overlay(this.screen, r.inflate(10, 4), undefined, 110);
        this.screen.blit(img, r);
    }

    /** Control group icons 1...9, 0 under the resources: a number + the portrait of the most frequent kind + a count. */
    draw_groups() {
        this.group_hits = [];
        const groups = py.getattr(this, 'groups', null);
        let x = 6;
        for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
            const g = _group_get(groups, n).filter(u => u.alive);
            if (!g.length) continue;
            const kinds = new Map();
            for (const u of g) kinds.set(u.kind, (kinds.has(u.kind) ? kinds.get(u.kind) : 0) + 1);
            const k = py.max([...kinds.keys()], kk => kinds.get(kk));
            const r = new pygame.Rect(x, TOP_H + 4, 34, 34);
            const ic = this.icon(g[0] instanceof Unit ? 'u' : 'b', k, 0, 34);
            this.screen.blit(ic, r);
            S.icon_frame(this.screen, r, r.collidepoint(pygame.mouse.get_pos()) ? 'hover' : 'normal');
            this.text(String(n), [r.x + 3, r.y + 1], 'bs', [120, 255, 120]);
            if (g.length > 1) this.text(String(g.length), [r.right - 2, r.bottom], 's', [255, 255, 255], 'bottomright');
            this.group_hits.push([r, n]);
            x += 38;
        }
    }

    /** Global queue (DE: "Global Queue"): what is being trained/researched right now in all buildings. */
    draw_global_queue() {
        this.gq_hits = [];
        if (!this.hud_opt('global_queue', true)) return;
        const w = this.world;
        const p = w.players[0];
        let x = 6 + 38 * this.group_hits.length + (this.group_hits.length ? 14 : 0);
        for (const b of w.buildings) {
            if (b.owner !== 0 || !b.queue.length) continue;
            const [kind, nm] = b.queue[0];
            const r = new pygame.Rect(x, TOP_H + 4, 30, 30);
            const ic = this.icon(kind === 'unit' ? 'u' : 't', nm, 0, 30);
            this.screen.blit(ic, r);
            S.icon_frame(this.screen, r, r.collidepoint(pygame.mouse.get_pos()) ? 'hover' : 'normal');
            const fr = b.qt / Math.max(0.01, p.time_of(kind, nm));
            pygame.draw.rect(this.screen, [14, 10, 8], [r.x, r.bottom + 1, r.w, 5]);
            pygame.draw.rect(this.screen, [236, 200, 90], [r.x + 1, r.bottom + 2, Math.trunc((r.w - 2) * Math.min(1, fr)), 3]);
            if (b.queue.length > 1) {
                this.text(String(b.queue.length), [r.right - 1, r.bottom - 1], 's', [255, 255, 255],
                    'bottomright');
            }
            this.gq_hits.push([r, b]);
            x += 33;
            if (x > 740) break;
        }
    }

    // ============================================================ clicks and keys
    /** Left click on the top panel: idle villager, coat of arms, round buttons. */
    hud_top_click(pos) {
        if (this.idle_rect && this.idle_rect.collidepoint(pos)) {
            this.select_idle();
            return;
        }
        if (civ_ui.top_emblem_rect().collidepoint(pos)) {
            this.help = this.help === 'civ' ? false : 'civ';
            return;
        }
        for (const [r, act] of this.top_btn_rects) {
            if (r.collidepoint(pos)) {
                this.audio.click();
                if (act === 'menu') {
                    this.window = null;
                    this.help = this.help === 'menu' ? false : 'menu';
                } else {
                    this.toggle_window(act);
                }
                return;
            }
        }
    }

    toggle_window(name) {
        this.window = this.window === name ? null : name;
        if (name === 'techtree' && this.window) this.tt_civ = null;
    }

    /** Left click: True if the click was taken by the interface (the world does not get it). */
    hud_click(pos) {
        if (this.window) {
            if (hud_windows.box(this.window).collidepoint(pos)) {
                hud_windows.click(this, this.window, pos);
            } else if (pos[1] < TOP_H) {
                this.hud_top_click(pos);
            } else {
                this.window = null;
            }
            return true;
        }
        if (pos[1] < TOP_H || civ_ui.top_emblem_rect().collidepoint(pos)) {
            this.hud_top_click(pos);
            return true;
        }
        for (const [r, n] of this.group_hits) {
            if (r.collidepoint(pos)) {
                const g = _group_get(this.groups, n).filter(u => u.alive);
                if (g.length) {
                    if (py.eq(this.selected, g)) this.center_on(...g[0].center());
                    this.selected = g;
                }
                return true;
            }
        }
        for (const [r, b] of this.gq_hits) {
            if (r.collidepoint(pos)) {
                if (b.alive) {
                    if (py.eq(this.selected, [b])) this.center_on(...b.center());
                    this.selected = [b];
                }
                return true;
            }
        }
        if (MAP_PANEL.collidepoint(pos)) {
            for (const [r, act] of this.mm_btn_rects) {
                if (new pygame.Vector2(pos).sub(r.center).length() <= r.w / 2 + 1) {
                    this.minimap_button(act);
                    return true;
                }
            }
            if (this.mm_hit(pos)) {
                if (this.order_mode || (this.mods() & pygame.KMOD_ALT)) {
                    if (!this.order_mode) this.order_mode = 'flare';          // Alt+left click on the minimap - a signal to allies
                    this.order_click(pos, undefined, true);                  // controls.py: an order / signal via the minimap
                    return true;
                }
                this.mm_drag = true;
                this.minimap_jump(pos);
            }
            return true;
        }
        const cr = this.cmd_rect();
        if (cr.collidepoint(pos)) {
            const col = this.info_collapsed ? COLLAPSE_SMALL : COLLAPSE_FULL;
            if (col.collidepoint(pos)) {
                this.info_collapsed = !this.info_collapsed;
                this._panel_bg = null;
                this.audio.click();
                return true;
            }
            for (const bt of this.get_buttons()) {
                if (bt['rect'].collidepoint(pos)) {
                    this.press_button(bt);
                    return true;
                }
            }
            for (const [r, act] of this.panel_hits) {
                if (r.collidepoint(pos)) {
                    this.panel_hit(act);
                    return true;
                }
            }
            return true;
        }
        return false;
    }

    panel_hit(act) {
        const w = this.world;
        const p = w.players[0];
        const shift = this.mods() & pygame.KMOD_SHIFT;
        if (act[0] === 'cancel') {
            const b = act[1], idx = act[2];
            for (const i of py.sorted(idx, null, true).slice(0, !shift ? 1 : idx.length)) {
                if (b.alive && i < b.queue.length) {
                    const [kind, name] = py.pop(b.queue, i);
                    p.refund(p.cost_of(kind, name));
                    if (kind === 'tech') p.researching.delete(name);
                    if (i === 0) b.qt = 0;
                }
            }
        } else if (act[0] === 'ungarrison') {
            const defense = modules.defense;
            defense.eject(w, act[1], [act[2]]);
        } else if (act[0] === 'sel') {
            this.panel_select(act[1]);           // controls.py: Ctrl - remove, Shift - only the kind, Ctrl+Shift - remove the kind
        } else if (act[0] === 'stack') {
            const ents = act[1];
            const ctrl = this.mods() & (pygame.KMOD_CTRL | pygame.KMOD_META);
            if (ctrl && !shift) {
                this.panel_select(ents[ents.length - 1]);     // Ctrl - remove one from the stack
            } else if (ctrl || shift) {
                this.panel_select(ents[0].kind);
            } else {
                this.selected = ents.slice();      // a click on a stack - all of that kind
            }
        }
    }

    /** Right click: True if the click was taken by the interface. */
    hud_rclick(pos) {
        if (this.window) {
            this.window = null;
            return true;
        }
        if (MAP_PANEL.collidepoint(pos)) {
            if (this.mm_hit(pos)) this.command(...this.mm_to_world(pos), null);
            return true;
        }
        return !this.hud_view(pos);
    }

    /** Interface keys (before the regular ones): chat, F4, F5, F11, PgUp. True - the key was taken. */
    hud_key(e) {
        const k = e.key;
        if (this.window === 'chat') return hud_windows.chat_key(this, e);
        if (this.window && k === pygame.K_ESCAPE) {
            this.window = null;
            return true;
        }
        if (k === pygame.K_F4) {
            this.show_score = !this.show_score;
            return true;
        }
        if (k === pygame.K_F11) {
            this.clock_mode = (this.clock_mode + 1) % 3;
            return true;
        }
        if (k === pygame.K_F5) {
            this.toggle_window('techtree');
            return true;
        }
        if ((k === pygame.K_RETURN || k === pygame.K_KP_ENTER) && !this.help) {
            this.window = 'chat';
            return true;
        }
        if (k === pygame.K_PAGEUP || k === pygame.K_PAGEDOWN) {
            this.show_history = k === pygame.K_PAGEUP;
            return true;
        }
        return false;
    }

    /** Once per frame: allies' replies in chat (and to a signal - the 'flare' event from controls.py). */
    hud_tick() {
        const now = pygame.time.get_ticks();
        const w = this.world;
        for (const ev of py.getattr(this, 'events', [])) {
            if (ev[0] === 'flare' && ev[3] === 0) {
                const allies = w.players.slice(1).filter(q => q.alive && w.allied(0, q.id) && q.is_ai);
                allies.forEach((q, i) => {
                    this.chat_replies.push([now + 900 + i * 600,
                        `${q.name}: ${i18n.t(hud_windows.FLARE_REPLY[py.mod(q.id, 3)])}`,
                        shade(q.color, 60)]);
                });
            }
        }
        const due = this.chat_replies.filter(r => r[0] <= now);
        if (due.length) {
            this.chat_replies = this.chat_replies.filter(r => r[0] > now);
            for (const [, txt, col] of due) {
                this.chat_log.push([txt, col]);
                this.world.msg(txt, col);
            }
        }
    }

    // ============================================================ bottom panel
    panel_bg() {
        let bg = py.getattr(this, '_panel_bg', null);
        const civ = this.my_civ();
        if (bg != null && py.getattr(this, '_panel_bg_civ', null) === civ) return bg;
        this._panel_bg_civ = civ;
        const cul = S.culture(civ);
        const metal = cul['metal'];
        bg = new pygame.Surface([SCREEN_W, SCREEN_H - MAP_PANEL.y + 8], pygame.SRCALPHA);
        const oy = MAP_PANEL.y - 8;                    // screen y of the top of the surface
        const cmd = this.cmd_rect().move(0, -oy);
        const mp_ = MAP_PANEL.move(0, -oy);
        for (const body of [cmd, mp_]) {
            for (let i = 0; i < 8; i++) {                  // shadow above the panel
                pygame.draw.line(bg, [0, 0, 0, 20 + i * 12], [body.x, body.y - 8 + i], [body.right, body.y - 8 + i]);
            }
            bg.blit(S.culture_panel(body.size, civ), body.topleft);
            S.bevel(bg, body, undefined, undefined, 3);
            pygame.draw.rect(bg, [12, 8, 4], body, 2);
            S.trim_band(bg, [body.x + 2, body.y + 2, body.w - 4, 6], civ);
        }
        // the grid - dark stone, the selection - plain parchment with a pale coat of arms (DE)
        const gb = GRID_BOX.move(0, -oy);
        bg.blit(S.tiled('skin/stone_dark.png', gb.size, cul['grid_tint']), gb.topleft);
        S.vignette(bg, gb, 140);
        S.gold_frame(bg, gb, undefined, metal);
        S.corners(bg, gb, 6);
        if (!this.info_collapsed) {
            const ib = INFO_BOX.move(0, -oy);
            bg.blit(S.parchment_flat(ib.size, civ_ui.emblem(civ, 110, 130)), ib.topleft);
            pygame.draw.rect(bg, [60, 40, 20], ib, 2);
            S.gold_frame(bg, ib.inflate(4, 4), undefined, metal);
            S.corners(bg, ib.inflate(4, 4), 6);
        }
        // minimap: parchment in the corners, a dark diamond in a thick border
        const mr = MM_RECT.move(0, -oy);
        const inner = mp_.inflate(-12, -12);
        bg.blit(S.parchment_flat(inner.size), inner.topleft);
        S.gold_frame(bg, inner, undefined, metal);
        for (const [grow, col] of [[10, [16, 11, 6]], [7, [120, 86, 36]], [5, [240, 206, 130]], [3, [90, 62, 24]],
            [1, [10, 8, 6]]]) {
            const pts = [[mr.centerx, mr.top - grow], [mr.right + grow * 2, mr.centery], [mr.centerx, mr.bottom + grow],
                [mr.left - grow * 2, mr.centery]];
            pygame.draw.polygon(bg, col, pts);
        }
        this._panel_bg = bg;
        return bg;
    }

    draw_panel() {
        const scr = this.screen;
        scr.blit(this.panel_bg(), [0, MAP_PANEL.y - 8]);
        this.draw_minimap();
        this.draw_score();
        this.panel_hits = [];
        const mp = pygame.mouse.get_pos();
        const col = this.info_collapsed ? COLLAPSE_SMALL : COLLAPSE_FULL;
        S.slot(scr, col, col.collidepoint(mp) ? 'hover' : 'normal');
        const d = this.info_collapsed ? 1 : -1;
        const [cx, cy] = col.center;
        pygame.draw.polygon(scr, S.GOLD, [[cx - 4 * d, cy - 6], [cx + 4 * d, cy], [cx - 4 * d, cy + 6]]);
        if (!this.info_collapsed) {
            this.ink = true;
            try {
                this.draw_selection_info();
            } finally {
                this.ink = false;
            }
        }
        const pressed = pygame.mouse.get_pressed()[0];
        let hover = null;
        for (const bt of this.get_buttons()) {
            const r = bt['rect'];
            const h = r.collidepoint(mp);
            const state = !bt['ok'] ? this.btn_state(bt) : (h && pressed ? 'pressed' : h ? 'hover' : 'normal');
            this.draw_cmd_button(bt, r, state);
            if (h) hover = bt;
        }
        const now = pygame.time.get_ticks();
        const key = hover ? [hover['key'], hover['tip'][0]] : null;
        if (!py.eq(key, this._tip[0])) this._tip = [key, now];
        if (hover && now - this._tip[1] >= TIP_DELAY) this.draw_tooltip(hover);
    }

    /** An unavailable button (DE): 'poor' - only resources are missing (the icon is red), otherwise 'disabled' (grey). */
    btn_state(bt) {
        const tip0 = py.get(bt, 'tip', null);
        const tip = (tip0 && tip0.length) ? tip0 : [];
        if (tip.slice(2).some(x => Array.isArray(x) && x[0] === 'red')) return 'disabled';
        const cost = tip.length > 1 && py.is_dict(tip[1]) ? tip[1] : null;
        if (py.bool(cost) && !this.world.players[0].afford(cost)) return 'poor';
        return 'disabled';
    }

    draw_cmd_button(bt, r, state) {
        const scr = this.screen;
        const [typ, name] = bt['icon'];
        if (typ === 'draw') {
            S.slot(scr, r, state === 'hover' ? 'hover' : 'normal');
        } else {
            pygame.draw.rect(scr, [0, 0, 0], r);          // DE: an icon filling the whole cell on black
        }
        const inner = r.inflate(-2, -2);
        if (typ === 'stop') {
            S.blit_icon(scr, 'stop', r.center, 34) || pygame.draw.rect(scr, [200, 60, 50], r.inflate(-18, -18));
        } else if (typ === 'draw') {
            name(this, r, bt['ok']);     // the button draws itself (market, reseeding)
        } else if (typ === 'unload') {
            S.blit_icon(scr, 'garrison-out', r.center, 32);
            this.text(py.str(name), [r.x + 4, r.y + 2], 'bs', [255, 240, 200]);
        } else if (typ === 'page') {
            const [page, pages] = name;
            next_arrow(scr, r);
            for (let i = 0; i < pages; i++) {
                pygame.draw.circle(scr, i === page ? [255, 230, 150] : [110, 95, 70],
                    [r.centerx - (pages - 1) * 4 + i * 8, r.bottom - 6], 2);
            }
        } else if (typ === 'next') {
            next_arrow(scr, r);
        } else if (typ === 'back') {
            back_cross(scr, r);
        } else if (typ === 'bpage') {
            let ic = S.icon(`portraits/de/build_${name[0]}.png`, inner.w);     // DE: a hammer + coins / a hammer + a sword
            if (ic != null) {
                scr.blit(ic, ic.get_rect({ center: r.center }));
            } else {
                ic = this.icon('b', name[1], 0, inner.w);
                scr.blit(ic, ic.get_rect({ center: r.center }));
                hammer(scr, r.right - 12, r.y + 11, name[0] === 'eco' ? [240, 220, 160] : [240, 150, 120]);
            }
        } else {
            const ic = this.icon(typ, name, 0, inner.w);
            scr.blit(ic, ic.get_rect({ center: r.center }));
        }
        S.icon_frame(scr, typ !== 'draw' ? inner : r.inflate(-2, -2), state);
        if (this.hud_opt('show_hotkeys', false)) {
            this.text(bt['key'], [r.right - 3, r.bottom], 's', [255, 230, 150], 'bottomright');
        }
    }

    // ---- tooltip: a dark plate at the left above the panel (DE)
    /** A row of numbers under the description: [(icon, text)] for a unit / building. */
    tip_stats(bt) {
        const act0 = py.get(bt, 'act', null);
        const act = (act0 && act0.length) ? act0 : [];
        const p = this.world.players[0];
        let kind = null, cat;
        if (act.length && act[0] === 'train') {
            kind = p.current(act[2]); cat = 'u';
        } else if (act.length && act[0] === 'place') {
            kind = act[1]; cat = 'b';
        } else {
            return [];
        }
        const d = py.get(cat === 'u' ? UNITS : BUILDINGS, kind, null);
        if (!py.bool(d)) return [];
        const out = [['hp', String(Math.trunc(p.stat('hp', kind, py.get(d, 'hp', 0))))]];
        if (py.get(d, 'atk', null)) out.push(['atk', py.fmt(p.stat('atk', kind, d['atk']), 'g')]);
        const arm = py.get(d, 'arm', cat === 'u' ? [0, 0] : null);
        if (py.bool(arm)) {
            out.push(['arm', `${py.fmt(p.stat('arm_m', kind, arm[0]), 'g')}/${py.fmt(p.stat('arm_p', kind, arm[1]), 'g')}`]);
        }
        if (py.get(d, 'rng', null)) out.push(['rng', py.fmt(p.stat('rng', kind, d['rng']), 'g')]);
        return out;
    }

    draw_tooltip(bt) {
        this.draw_tip(bt['tip'], py.get(bt, 'key', null), this.tip_stats(bt));
    }

    /** tip = [name, cost, description, extra lines...]. anchor - (x, bottom) of the plate; by default at the left above the panel. */
    draw_tip(tip, key = null, stats = [], anchor = null) {
        const scr = this.screen;
        const name = tip[0], cost = tip[1] || {};
        const k = Math.max(50, Math.min(100, Math.trunc(this.hud_opt('tooltip_scale', 100) || 100))) / 100;
        const f = S.font('antiqua', Math.max(9, py.round(13 * k)), true), fb = S.font('antiqua', Math.max(10, py.round(15 * k)), true);
        const maxw = Math.trunc(440 * k);
        let lines = [];                                          // (text, color, font)
        for (const ex of tip.slice(2)) {
            if (Array.isArray(ex)) {
                const col = ex[0] === 'red' ? [255, 120, 100] : [200, 190, 165];
                lines = lines.concat(wrap(ex[1], f, maxw).map(s => [s, col, f]));
            } else {
                lines = lines.concat(wrap(ex, f, maxw).map(s => [s, [240, 235, 220], f]));
            }
        }
        const title_w = fb.size(name)[0];
        const cost_items = RES.filter(r => py.get(cost, r, null)).map(r => [r, cost[r]]);
        const cw = py.sum(cost_items.map(([, v]) => f.size(String(v))[0] + 26));
        const wdt = Math.min(maxw, Math.max(title_w + cw + 30, ...lines.map(([s]) => f.size(s)[0]))) + 20;
        const hgt = 26 + lines.length * 18 + (stats.length ? 24 : 0) + (key ? 18 : 0) + 6;
        let x, bottom;
        if (anchor == null) {
            x = 4; bottom = this.cmd_rect().y - 6;
        } else {
            [x, bottom] = anchor;
        }
        x = Math.max(2, Math.min(SCREEN_W - wdt - 2, x));
        const y = Math.max(TOP_H + 2, bottom - hgt);
        const box = new pygame.Rect(x, y, wdt, hgt);
        S.shade_overlay(scr, box, undefined, 200);            // DE: a black translucent plate without a frame
        let yy = y + 6;
        const r = S.text(scr, name, [x + 10, yy], fb, [255, 240, 200]);
        let cx = r.right + 10;
        const p = this.world.players[0];
        for (const [rk, v] of cost_items) {
            S.blit_icon(scr, rk, [cx + 9, yy + 9], 18) || this.res_icon(rk, cx + 9, yy + 9);
            const ok = p.res[rk] >= v;
            const img = S.text(scr, String(v), [cx + 20, yy + 9], f, ok ? [240, 235, 220] : [255, 110, 90], 'midleft');
            cx = img.right + 8;
        }
        yy += 22;
        for (const [s, col, ft] of lines) {
            S.text(scr, s, [x + 10, yy], ft, col);
            yy += 18;
        }
        if (stats.length) {
            let sx = x + 10;
            for (const [kind, val] of stats) {
                if (kind === 'hp') {
                    hp_glyph(scr, sx, yy + 10);
                } else {
                    const ic = stat_icon(kind, 16);
                    if (ic != null) scr.blit(ic, ic.get_rect({ midleft: [sx, yy + 10] }));
                }
                const r2 = S.text(scr, val, [sx + 19, yy + 10], f, [240, 235, 220], 'midleft');
                sx = r2.right + 12;
            }
            yy += 24;
        }
        if (key) S.text(scr, i18n.t('hud.hotkey', { key: key }), [x + 10, yy], f, [200, 190, 165]);
    }

    // ---- selection (on parchment)
    big_portrait(ic, hp_frac = null, owner = 0) {
        const scr = this.screen;
        const box = new pygame.Rect(INFO_X, INFO_BOX.y + 30, PORT, PORT);
        pygame.draw.rect(scr, [10, 7, 4], box.inflate(4, 4));
        if (!py.eq(ic.get_size(), box.size)) {
            const ic2 = new pygame.Surface(box.size, pygame.SRCALPHA);
            ic2.blit(S.tiled('skin/stone_dark.png', box.size, [120, 110, 100]), [0, 0]);
            ic2.blit(ic, ic.get_rect({ center: [py.floordiv(PORT, 2), py.floordiv(PORT, 2)] }));
            ic = ic2;
        }
        scr.blit(ic, box.topleft);
        pygame.draw.rect(scr, [40, 26, 12], box.inflate(4, 4), 2);
        if (hp_frac != null) {
            const hb = new pygame.Rect(box.x - 2, box.bottom + 4, PORT + 4, 8);
            pygame.draw.rect(scr, [14, 10, 8], hb);
            const c = owner >= 0 ? this.pcolor(owner) : [200, 60, 50];
            const fw = Math.trunc((hb.w - 2) * Math.max(0.0, Math.min(1.0, hp_frac)));
            pygame.draw.rect(scr, c, [hb.x + 1, hb.y + 1, fw, hb.h - 2]);
            pygame.draw.line(scr, shade(c, 60), [hb.x + 1, hb.y + 1], [hb.x + fw, hb.y + 1]);
        }
        return box;
    }

    name_line(name) {
        S.text(this.screen, name, [INFO_X + 2, INFO_BOX.y + 7], this.fonts['n'], S.INK, undefined, null);
    }

    hp_text(e) {
        this.text(`${Math.trunc(Math.max(0, e.hp))}/${Math.trunc(e.max_hp)}`, [INFO_X, INFO_BOX.y + 30 + PORT + 16], 'bs');
    }

    /** 'Name (Civilization)' in the player's color at the top right, below it - 'Enemy' / 'Ally' (DE). */
    owner_label(owner, x = null, y = null) {
        const w = this.world;
        const pl = w.players[owner];
        const right = INFO_BOX.right - 22;
        const y0 = INFO_BOX.y + 12;
        const img = S.text(this.screen, `${pl.name} (${civ_ui.civ_name(pl.civ)})`, [right, y0], this.fonts['bs'],
            _lum(pl.color) > 150 ? shade(pl.color, -50) : pl.color, 'topright', null);
        civ_ui.blit_emblem(this, pl.civ, [img.x - 18, y0 - 1, 14, 17]);
        const rel = this.relation(owner);
        if (rel === 'ally' || rel === 'enemy') {
            S.text(this.screen, i18n.t('rel.' + rel), [right, y0 + 18], this.fonts['bs'],
                rel === 'ally' ? [40, 110, 40] : [170, 30, 20], 'topright', null);
        }
    }

    /** A row of the stats column: an 18 px icon + a number. */
    stat_row(x, y, kind, val) {
        if (kind === 'hp') {
            // DE: health has no icon - only numbers
        } else if (Object.hasOwn(STAT_ICONS, kind)) {
            const ic = stat_icon(kind, 18);
            if (ic != null) this.screen.blit(ic, ic.get_rect({ midleft: [x, y] }));
        } else if (RES.includes(kind) || kind === 'pop' || kind === 'time') {
            S.blit_icon(this.screen, kind, [x + 9, y], 18);
        } else if (kind === 'work') {
            hammer(this.screen, x + 9, y, [90, 70, 50]);
        }
        this.text(val, [x + 26, y], 'b', undefined, 'midleft');
    }

    draw_selection_info() {
        const scr = this.screen;
        const w = this.world;
        const sel = this.selected.filter(e => e.alive);
        if (!sel.length) {
            this.draw_nothing();
            return;
        }
        if (sel.length > 1) {
            this.draw_stacks(sel);
            return;
        }
        const e = sel[0];
        const y0 = INFO_BOX.y + 30;
        const rows = [];                                       // (icon, text) - the column from top to bottom
        if (e instanceof Animal) {
            this.name_line(e.d['name'] + (e.dead ? ' ' + i18n.t('hud.carcass') : ''));
            this.big_portrait(this.icon('u', e.kind, 0, PORT), e.dead ? null : e.hp / e.max_hp, e.owner);
            if (e.owner >= 0) this.owner_label(e.owner);
            if (!e.dead) this.hp_text(e);
            rows.push(['food', String(Math.trunc(e.amount))]);
            this.stat_col(rows, y0);
            return;
        }
        if (e instanceof Node) {
            this.name_line(NODE_DEFS[e.kind]['name']);
            this.big_portrait(this.icon('n', e.kind, 0, PORT));
            this.stat_col([[e.res, String(Math.trunc(e.amount))]], y0);
            return;
        }
        const is_u = e instanceof Unit;
        let name = e.d['name'];
        if (is_u && e.cls === 'vil' && e.owner === 0) {
            const job = this.vil_job(e);
            if (job) name = Object.hasOwn(VIL_JOB, job) ? i18n.t(VIL_JOB[job]) : name;
        }
        this.name_line(name);
        const pbox = this.big_portrait(this.icon(is_u ? 'u' : 'b', e.kind, e.owner, PORT), e.hp / e.max_hp, e.owner);
        this.hp_text(e);
        if (e.owner >= 0) this.owner_label(e.owner);
        if (is_u) {
            if (e.cls === 'vil' && e.carry >= 1) {        // load icon on the portrait (DE)
                S.blit_icon(scr, e.carry_res, [pbox.right - 9, pbox.y + 9], 16);
            }
            rows.push(['atk', py.fmt(e.atk(), 'g')]);
            const [m, pc] = e.armor();
            rows.push(['arm', `${py.fmt(m, 'g')}/${py.fmt(pc, 'g')}`]);
            if (e.d['rng'] > 0) {
                const mn = py.get(e.d, 'minr', null) || 0;
                rows.push(['rng', py.fmt(e.rng_tiles(), 'g') + (mn ? `/${py.fmt(mn, 'g')}` : '')]);
            }
            if (e.cls === 'vil' && e.owner === 0) {
                const rate = this.gather_rate(e);
                if (rate) rows.push(['work', py.fmt(rate, '.1f')]);
                if (e.carry >= 1) rows.push([e.carry_res, `${Math.trunc(e.carry)}/${Math.trunc(e.capacity())}`]);
            }
            const col2 = [['spd', py.fmt(e.speed() / TILE, '.2f')]];
            if (py.bool(py.get(e.d, 'bonus', null))) {
                for (const [k2, v] of Object.entries(e.d['bonus']).slice(0, 2)) {
                    col2.push(['bonus', `+${py.str(v)} ${Object.hasOwn(BONUS_NAMES, k2) ? i18n.t(BONUS_NAMES[k2]) : k2}`]);
                }
            }
            this.stat_col(rows, y0);
            this.stat_col(col2, y0, TX + 120);
            if (py.get(e.d, 'monk', null)) {
                const full = 62.0 / e.p.stat('faith', e.kind, 1.0);
                const fr = w.time >= e.faith_t ? 1.0 : Math.max(0.0, 1 - (e.faith_t - w.time) / full);
                const bx = TX + 120;
                pygame.draw.rect(scr, [25, 20, 18], [bx, y0 + 34, 140, 8]);
                pygame.draw.rect(scr, [250, 230, 140], [bx, y0 + 34, Math.trunc(140 * fr), 8]);
                pygame.draw.rect(scr, [90, 62, 24], [bx, y0 + 34, 140, 8], 1);
            }
            if (e.naval && e.owner === 0) {
                if (e.cargo_cap()) {
                    for (let i = 0; i < e.cargo_cap(); i++) {
                        const r = new pygame.Rect(TX + 240 + (i % 5) * 34, y0 + Math.floor(i / 5) * 34, 30, 30);
                        S.slot(scr, r);
                        if (i < e.cargo.length) {
                            const ic = this.icon('u', e.cargo[i].kind, 0, 28);
                            scr.blit(ic, ic.get_rect({ center: r.center }));
                        }
                    }
                } else if (py.get(e.d, 'fisher', null) && e.carry >= 1) {
                    this.stat_row(TX + 120, y0 + 24, 'food', `${Math.trunc(e.carry)}/${Math.trunc(e.capacity())}`);
                }
            }
            if (py.get(e.d, 'panel', null)) e.d['panel'](this, e, TX + 240, y0);
            return;
        }
        // building
        if (!e.complete) {
            const bar = new pygame.Rect(TX, y0 + 8, 260, 16);
            pygame.draw.rect(scr, [40, 30, 20], bar);
            pygame.draw.rect(scr, [90, 140, 200], [bar.x + 1, bar.y + 1, Math.trunc((bar.w - 2) * e.progress), bar.h - 2]);
            pygame.draw.rect(scr, [60, 40, 20], bar, 1);
            S.text(scr, `${Math.trunc(e.progress * 100)}%`, bar.center, this.fonts['bs'], [255, 255, 255], 'center');
            return;
        }
        if (e.kind === 'farm') {
            this.stat_col([['food', String(Math.trunc(e.amount))]], y0);
            return;
        }
        if (py.get(e.d, 'atk', null)) {
            rows.push(['atk', py.fmt(e.atk(), 'g') + (py.get(e.d, 'arrows', null) ? ` ×${py.str(e.d['arrows'])}` : '')]);
        }
        const [m, pc] = e.armor();
        rows.push(['arm', `${py.fmt(m, 'g')}/${py.fmt(pc, 'g')}`]);
        if (py.get(e.d, 'atk', null)) rows.push(['rng', py.fmt(e.rng_tiles(), 'g')]);
        if (py.get(e.d, 'pop', null)) rows.push(['pop', `+${py.str(e.d['pop'])}`]);
        this.stat_col(rows, y0);
        const qx = TX + 130;
        if (e.queue.length && e.owner === 0) this.draw_queue(e, qx, y0 - 2);
        if (py.get(e.d, 'garrison', null)) this.draw_garrison_info(e, qx, y0 + 52);
        if (py.get(e.d, 'panel', null)) {           // a panel from content: fn(game, building, x, y) (market prices, reseeds)
            e.d['panel'](this, e, !e.queue.length ? TX + 4 : qx, INFO_BOX.bottom - 22);
        }
    }

    stat_col(rows, y0, x = TX) {
        rows.forEach(([k, v], i) => {
            if (k === 'bonus') {
                this.text(v, [x, y0 + 10 + i * 20], 'bs', [150, 60, 20], 'midleft');
            } else {
                this.stat_row(x, y0 + 10 + i * 20, k, v);
            }
        });
    }

    /** A building's queue: the first one large with a bar, then consecutive identical ones - one icon with a number. */
    draw_queue(e, x, y) {
        const scr = this.screen;
        const p = this.world.players[0];
        const mp = pygame.mouse.get_pos();
        const groups = [];                                    // [(kind, name, [indices])]
        e.queue.forEach(([kind, nm], i) => {
            const last = groups.length ? groups[groups.length - 1] : null;
            if (i > 0 && last && last[0] === kind && last[1] === nm && last[2][0] !== 0) {
                last[2].push(i);
            } else {
                groups.push([kind, nm, [i]]);
            }
        });
        let cx = x;
        groups.slice(0, 9).forEach(([kind, nm, idx], gi) => {
            const s = gi === 0 ? 44 : 34;
            const r = new pygame.Rect(cx, y + (gi === 0 ? 0 : 10), s, s);
            const ic = this.icon(kind === 'unit' ? 'u' : 't', nm, 0, s);
            scr.blit(ic, r);
            const hov = r.collidepoint(mp);
            S.icon_frame(scr, r, hov ? 'hover' : 'normal');
            if (hov) S.blit_icon(scr, 'cancel', r.center, Math.trunc(s * 0.7));
            if (idx.length > 1) S.text(scr, String(idx.length), [r.x + 3, r.y + 1], this.fonts['bs'], [255, 255, 255]);
            if (gi === 0) {
                const total = p.time_of(kind, nm);
                pygame.draw.rect(scr, [40, 30, 20], [r.x, r.bottom + 3, 44, 6]);
                pygame.draw.rect(scr, [60, 150, 60], [r.x + 1, r.bottom + 4, Math.trunc(42 * Math.min(1, e.qt / total)), 4]);
            }
            this.panel_hits.push([r, ['cancel', e, idx]]);
            cx = r.right + 4;
        });
        if (e.housed) {
            this.pop_icon(cx + 14, y + 27, 22);
            this.text(i18n.t('hud.need_houses'), [cx + 28, y + 27], 'bs', [170, 30, 20], 'midleft');
        }
    }

    /** Several selected: identical kinds - one icon with a number (DE), under it a shared HP bar. */
    draw_stacks(sel) {
        const scr = this.screen;
        const stacks = new py.TDict();
        for (const e of sel) {
            py.setdefault(stacks, [e.kind, e.owner, e instanceof Unit], []).push(e);
        }
        const mp = pygame.mouse.get_pos();
        const x0 = INFO_BOX.x + 10, y0 = INFO_BOX.y + 10;
        const per = 13;
        [...stacks].slice(0, per * 3).forEach(([[kind, owner, is_u], ents], i) => {
            const r = new pygame.Rect(x0 + (i % per) * 41, y0 + Math.floor(i / per) * 46, 38, 38);
            const ic = this.icon(is_u ? 'u' : 'b', kind, owner, 38);
            scr.blit(ic, r);
            S.icon_frame(scr, r, r.collidepoint(mp) ? 'hover' : 'normal');
            if (ents.length > 1) S.text(scr, String(ents.length), [r.x + 2, r.y], this.fonts['bs'], [255, 255, 255]);
            const frac = py.sum(ents.map(e => Math.max(0, e.hp))) / Math.max(1, py.sum(ents.map(e => e.max_hp)));
            pygame.draw.rect(scr, [25, 20, 20], [r.x, r.bottom + 1, r.w, 4]);
            pygame.draw.rect(scr, this.pcolor(owner), [r.x, r.bottom + 1, Math.trunc(r.w * frac), 4]);
            this.panel_hits.push([r, ents.length > 1 ? ['stack', ents] : ['sel', ents[0]]]);
        });
        this.text(`${sel.length}`, [INFO_BOX.right - 12, INFO_BOX.bottom - 6], 'b', undefined, 'bottomright');
    }

    /** Nothing selected: clean parchment with the civilization's coat of arms (DE). */
    draw_nothing() {
        const key = ['nothing', this.world.players[0].civ];
        let img = py.getattr(this, '_nothing', null) || [null, null];
        if (!py.eq(img[0], key)) {
            const em = civ_ui.emblem(this.world.players[0].civ, 70, 84).copy();
            em.fill([255, 255, 255, 60], null, pygame.BLEND_RGBA_MULT);
            img = [key, em];
            this._nothing = img;
        }
        this.screen.blit(img[1], img[1].get_rect({ center: INFO_BOX.center }));
    }

    vil_job(u) {
        const t = u.target;
        if (u.state === 'build') return 'build';
        if ((u.state === 'gather' || u.state === 'return') && t != null) {
            if (t instanceof Animal) return 'hunt';
            if (t instanceof Building) return t.kind === 'farm' ? 'farm' : null;
            if (t.kind === 'tree') return 'wood';
            if (['gold', 'stone', 'berries'].includes(t.kind)) return t.kind;
            return 'fish';
        }
        return null;
    }

    /** A villager's gather rate per minute (like the "work rate" in DE) or 0. */
    gather_rate(u) {
        const t = u.target;
        if (!(u.state === 'gather' || u.state === 'return') || t == null) return 0;
        let base, res, src;
        if (t instanceof Animal) {
            base = py.get(py.get(ANIMALS, t.kind, {}), 'rate', 0.4); res = 'food'; src = 'hunt';
        } else if (t instanceof Building) {
            if (t.kind !== 'farm') return 0;
            base = FARM_RATE; res = 'food'; src = 'farm';
        } else {
            base = py.get(py.get(NODE_DEFS, t.kind, {}), 'rate', 0.35); res = t.res; src = t.kind;
        }
        return u.p.stat('gather', u.kind, base, res, src) * 60;
    }

    // ============================================================ command grid
    grid_rect(slot) {
        return new pygame.Rect(GRID_X + (slot % 5) * GRID_STEP, GRID_Y + Math.floor(slot / 5) * GRID_STEP, BTN, BTN);
    }

    /** items / fixed - dict(icon, act, ok, tip[, slot]). Items with a 'slot' stand in their own place (DE),
     *  the rest fill the free cells; if they do not fit - paging (the last cell). */
    grid_layout(items, fixed = []) {
        const GRID = 15;
        const fixed_slots = new Map();
        const base = GRID - fixed.length;
        fixed.forEach((f, i) => { fixed_slots.set(py.get(f, 'slot', base + i), f); });
        const taken = new Map(fixed_slots);
        const free = [];
        for (const it of items) {
            const s = py.get(it, 'slot', null);
            if (s != null && !taken.has(s)) {
                taken.set(s, it);
            } else {
                free.push(it);
            }
        }
        const empty = [];
        for (let s = 0; s < GRID; s++) if (!taken.has(s)) empty.push(s);
        let slots = [];
        if (free.length <= empty.length) {
            slots = [...taken.entries(), ...py.zip(empty, free)];
        } else {
            // does not fit: everything in a row across pages, the fixed ones on every page
            const allit = [...py.sorted([...taken.keys()]).filter(s => !fixed_slots.has(s)).map(s => taken.get(s)), ...free];
            const per = GRID - fixed_slots.size - 1;
            const pages = py.floordiv(allit.length + per - 1, per);
            const page = py.mod(this.cmd_page, pages);
            const shown = allit.slice(page * per, (page + 1) * per);
            const open_slots = [];
            for (let s = 0; s < GRID - 1; s++) if (!fixed_slots.has(s)) open_slots.push(s);
            slots = [...py.zip(open_slots, shown), ...fixed_slots.entries()];
            slots.push([GRID - 1, {
                icon: ['page', [page, pages]], act: ['page', null], ok: true,
                tip: [i18n.t('hud.page', { n: page + 1, m: pages }), {}, i18n.t('hud.more_buttons')],
            }]);
        }
        const btns = [];
        for (const [slot, it] of slots) {
            btns.push({ ...it, rect: this.grid_rect(slot), key: HOTKEYS[slot] });
        }
        return btns;
    }

    set_build_page(page) {
        this.build_page = page;
    }

    /** The villager grid (DE): the main one - Q "economy", W "military"; pages with fixed places,
     *  V - to the other page, B - back. */
    villager_items(p) {
        const key = this.selected.slice(0, 3).map(e => py.id(e));
        if (!py.eq(key, this._bp_key)) {
            this._bp_key = key;
            this.build_page = null;
        }
        if (this.build_page == null) {
            return [{
                icon: ['bpage', ['eco', 'house']], act: ['call', g => g.set_build_page('eco')], ok: true,
                tip: [i18n.t('hud.build_eco'), {}, i18n.t('hud.build_eco_desc')], slot: 0,
            },
            {
                icon: ['bpage', ['mil', 'barracks']], act: ['call', g => g.set_build_page('mil')],
                ok: true, tip: [i18n.t('hud.build_mil'), {}, i18n.t('hud.build_mil_desc')], slot: 1,
            }];
        }
        const page = this.build_page === 'eco' ? ECO_PAGE : MIL_PAGE;
        const other = page === ECO_PAGE ? MIL_PAGE : ECO_PAGE;
        const items = [];
        const used = new Set();
        for (const k0 of BUILD_MENU) {
            const k = p.current(k0);
            if (Object.hasOwn(other, k0) || !p.allows(k0) || !p.allows(k)) continue;
            if (!Object.hasOwn(page, k0) && this.build_page !== 'eco') continue;   // unknown buildings - to the economy page
            const d = BUILDINGS[k];
            const cost = p.cost_of('bld', k);
            const locked = this.world.build_age(p, k) > p.age;
            const tip = [d['name'], cost, d['desc']];
            if (locked) tip.push(['red', i18n.t('msg.need_age', { age: AGE_NAMES[d['age']] })]);
            let s = py.get(page, k0, null);
            if (used.has(s)) s = null;
            used.add(s);
            items.push({ icon: ['b', k], act: ['place', k], ok: !locked && p.afford(cost), tip: tip, slot: s });
        }
        items.push({
            icon: ['next', null], act: ['call', g => g.set_build_page(g.build_page === 'eco' ? 'mil' : 'eco')], ok: true,
            tip: [i18n.t('hud.next_page'), {}, page === ECO_PAGE ? i18n.t('hud.mil_buildings') : i18n.t('hud.eco_buildings')],
            slot: 13,
        });
        items.push({
            icon: ['back', null], act: ['call', g => g.set_build_page(null)], ok: true,
            tip: [i18n.t('common.back'), {}, i18n.t('hud.back_to_villager')], slot: 14,
        });
        return items;
    }

    /** Fixed places of a building's buttons (DE): units - the top row, line upgrades - the second,
     *  other techs - the third; in the center - the DE layout (TC_SLOTS). Changes items in place. */
    building_slots(b, p, items) {
        if (b.kind === 'town_center') {
            for (const it of items) {
                const a = it['act'];
                let nm = (a[0] === 'train' || a[0] === 'research') ? a[2] : null;
                if (a[0] === 'train') {
                    const found = py.get(b.d, 'trains', []).find(k => p.current(k) === a[2]);
                    nm = found !== undefined ? found : a[2];
                }
                if (nm != null && Object.hasOwn(TC_SLOTS, nm)) {
                    it['slot'] = TC_SLOTS[nm];
                } else if (a[0] === 'bell' || a[0] === 'clear') {
                    it['slot'] = 14;
                } else if (a[0] === 'eject') {
                    it['slot'] = 9;
                }
            }
            return items;
        }
        const trains = py.get(b.d, 'trains', []).filter(k => p.allows(k, b.kind) && p.allows(p.current(k)));
        const chains = this.tech_chains(b, p);
        const has_units = trains.length > 0;
        const rows = { 0: 0, 1: 0, 2: 0 };
        const chain_slot = new Map();
        chains.forEach((chain, ci) => {
            const up = chain.some(t => py.bool(py.get(TECHS[t], 'upgrade', null)));
            const row = has_units ? (up ? 1 : 2) : null;
            if (row == null) {
                chain_slot.set(ci, ci < 15 ? ci : null);
            } else {
                chain_slot.set(ci, rows[row] < 5 ? row * 5 + rows[row] : null);
                rows[row] += 1;
            }
        });
        for (const it of items) {
            const a = it['act'];
            if (a[0] === 'train') {
                const j = trains.findIndex(k => p.current(k) === a[2]);
                const i = j >= 0 ? j : null;
                it['slot'] = i != null && i < 5 ? i : null;
            } else if (a[0] === 'research') {
                const j = chains.findIndex(ch => ch.includes(a[2]));
                const ci = j >= 0 ? j : null;
                it['slot'] = chain_slot.has(ci) ? chain_slot.get(ci) : null;
            }
        }
        return items;
    }

    /** A building's tech chains (the next one replaces the previous one in the same place). */
    tech_chains(b, p) {
        const key = py.tkey(['chains', b.kind, p.id, p.civ]);
        if (!Object.hasOwn(this, '_chains')) this._chains = new Map();
        const cache = this._chains;
        if (cache.has(key)) return cache.get(key);
        const techs = py.get(b.d, 'techs', []).filter(t => p.allows(t) && Object.hasOwn(TECHS, t) && !py.contains(AGE_TECHS, t));
        const chains = [];
        const where = new Map();
        for (const t of techs) {
            const reqs = py.list(as_tuple(py.get(TECHS[t], 'req', []))).filter(r => where.has(r));
            if (reqs.length) {
                const ch = where.get(reqs[0]);
                chains[ch].push(t);
                where.set(t, ch);
            } else {
                where.set(t, chains.length);
                chains.push([t]);
            }
        }
        cache.set(key, chains);
        return chains;
    }

    // ============================================================ minimap
    mm_color(owner) {
        if (!this.mm_team || owner < 0) return this.pcolor(owner);
        const rel = this.relation(owner);
        return TEAM_COLORS[Object.hasOwn(TEAM_COLORS, rel) ? rel : 'enemy'];
    }

    minimap_button(act) {
        this.audio.click();
        if (act === 'flare') {             // signal mode from controls.py: the next left click on the map or world
            this.order_mode = this.order_mode === 'flare' ? null : 'flare';
        } else if (act === 'score') {
            this.show_score = !this.show_score;
        } else if (act === 'colors') {
            this.mm_team = !this.mm_team;
            this.mm_img = null;
        } else if (act === 'mode') {
            this.mm_mode = (this.mm_mode + 1) % MM_MODES.length;
            this.mm_img = null;
        }
    }

    draw_minimap() {
        const scr = this.screen;
        const w = this.world;
        const r = this.mm_rect();
        this.mm_t -= 1;
        const mode = this.mm_mode;
        if (this.mm_img == null || this.mm_t <= 0) {
            this.mm_t = 10;
            const small = this.mm_base.copy();
            if (mode === 1) {                               // military: the ground is muted
                small.fill([70, 70, 70], null, pygame.BLEND_RGB_MULT);
            }
            const MAP_W = w.W, MAP_H = w.H;
            const arow = w.amat[0];
            const exp = w.explored, vis = w.vis;
            if (mode !== 1) {
                // DE object colors (game/themes.py): gold #FFC700, stone #919191, all food #A5C46C,
                // forest - the color of the landscape's forest floor
                const node_c = { 'tree': themes.forest_mm(w), 'gold': themes.MM_GOLD, 'stone': themes.MM_STONE };
                for (const n of w.nodes) {
                    if (n.alive && exp[n.ty * MAP_W + n.tx]) {
                        let c = py.get(node_c, n.kind, null) || (py.get(NODE_DEFS[n.kind], 'res', null) === 'food' ? themes.MM_FOOD
                            : py.get(NODE_DEFS[n.kind], 'mm', [255, 255, 255]));
                        if (mode === 2 && n.kind === 'tree') c = [60, 150, 60];
                        small.set_at([n.tx, n.ty], c);
                    }
                }
            }
            for (const b of w.buildings) {
                if (b.seen) {
                    if (mode === 2 && (py.bool(py.get(b.d, 'trains', null)) && !py.get(b.d, 'drop', null) && b.kind !== 'market')) continue;
                    small.fill(!b.walk ? this.mm_color(b.owner) : [190, 160, 90], [b.tx, b.ty, b.w, b.h]);
                }
            }
            const buf = new Uint8Array(MAP_W * MAP_H * 4);
            for (let i = 0; i < MAP_W * MAP_H; i++) {
                if (!exp[i]) {
                    buf[i * 4 + 3] = 255;
                } else if (!vis[i]) {
                    buf[i * 4 + 3] = 110;
                }
            }
            small.blit(pygame.image.frombuffer(buf, [MAP_W, MAP_H], 'RGBA'), [0, 0]);
            for (const u of w.units) {
                if ((mode === 1 && u.cls === 'vil') || (mode === 2 && u.cls !== 'vil')) continue;
                if (arow[u.owner] || w.visible_px(u.x, u.y)) {
                    small.set_at([Math.floor(u.x / TILE), Math.floor(u.y / TILE)], shade(this.mm_color(u.owner), 60));
                }
            }
            if (mode !== 1) {
                const rc = _relic_mm_color();
                for (const rl of py.getattr(w, 'relics', [])) {         // relics (game/relics.py): a white dot
                    const tx = Math.floor(rl.x / TILE), ty = Math.floor(rl.y / TILE);
                    if (0 <= tx && tx < MAP_W && 0 <= ty && ty < MAP_H && (rl.carrier == null ? exp[ty * MAP_W + tx]
                        : w.visible_px(rl.x, rl.y))) {
                        small.fill(rc, rl.holder == null ? [tx, ty, 2, 2] : [tx, ty, 1, 1]);
                    }
                }
                for (const a of w.animals) {
                    if ((arow[a.owner] || w.visible_px(a.x, a.y)) && !a.dead) {
                        const c = a.owner >= 0 ? shade(this.mm_color(a.owner), 60)
                            : (py.get(a.d, 'food', null) ? themes.MM_FOOD : themes.MM_WOLF);
                        small.set_at([Math.floor(a.x / TILE), Math.floor(a.y / TILE)], c);
                    }
                }
            }
            const sq = pygame.transform.scale(small.convert_alpha(), [MAP_W * 2, MAP_H * 2]);
            const rot = pygame.transform.rotate(sq, -45);
            this.mm_img = pygame.transform.smoothscale(rot, [r.w, r.h]);
        }
        scr.blit(this.mm_img, r);
        const tw = this.iso_tw, th = this.iso_th;
        const cam = new pygame.Rect(r.x + this.cam_x / tw * r.w, r.y + this.cam_y / th * r.h,
            this.view_w() / tw * r.w, this.view_h() / th * r.h);     // taking the scale into account
        scr.set_clip(r);
        pygame.draw.rect(scr, [255, 255, 255], cam, 1);
        scr.set_clip(null);
        for (const [x, y, t] of w.pings) {
            const a = py.mod(w.time - t, 1.0);
            const [mx, my] = this.world_to_mm(x, y);
            pygame.draw.circle(scr, [255, 80, 60], [Math.trunc(mx), Math.trunc(my)], Math.trunc(4 + a * 10), 2);
        }
        // 4 buttons in the corners
        this.mm_btn_rects = [];
        const mp = pygame.mouse.get_pos();
        const corners = [[MAP_PANEL.x + 24, MAP_PANEL.y + 24], [MAP_PANEL.right - 24, MAP_PANEL.y + 24],
            [MAP_PANEL.x + 24, MAP_PANEL.bottom - 24], [MAP_PANEL.right - 24, MAP_PANEL.bottom - 24]];
        for (const [act, c] of py.zip(MM_BTNS, corners)) {
            const br = new pygame.Rect(c[0] - 16, c[1] - 16, 32, 32);
            this.mm_btn_rects.push([br, act]);
            const on = (act === 'flare' && this.order_mode === 'flare') || (act === 'score' && this.show_score) ||
                (act === 'colors' && this.mm_team) || (act === 'mode' && this.mm_mode);
            const h = br.collidepoint(mp);
            pygame.draw.circle(scr, [14, 10, 6], [c[0] + 1, c[1] + 2], 16);
            pygame.draw.circle(scr, !h ? [46, 36, 26] : [80, 62, 40], c, 15);
            pygame.draw.circle(scr, (on || h) ? S.GOLD_HI : [150, 118, 70], c, 15, 2);
            mm_btn_icon(scr, act, c, this.mm_mode, this.pcolor(0));
            if (h) {
                const T = i18n.t;
                const tips = {
                    'flare': [T('hud.flare'), {}, T('hud.flare_desc')],
                    'score': [T('keys.score'), {}, 'F4'],
                    'colors': [T('hud.colors'), {}, !this.mm_team ? T('lobby.teams') : T('lobby.players')],
                    'mode': [T('hud.map_mode'), {}, T(MM_MODES[this.mm_mode])],
                }[act];
                this.draw_tip(tips, undefined, undefined, [MAP_PANEL.x - 200, MAP_PANEL.y - 4]);
            }
        }
    }

    // ---- score above the minimap (F4)
    draw_score() {
        if (!this.show_score) return;
        const w = this.world;
        const scores = hud_windows.scores(this);
        const team0 = w.players[0].team;
        const players = py.sorted(w.players, q => [q.team !== team0 ? 1 : 0, q.team, q.id]);
        // normal mode - points; military - the number of soldiers; economic - villagers (DE)
        const lines = [];
        for (const q of players) {
            let v;
            if (this.mm_mode === 0) {
                v = scores.get(q.id)['total'];
            } else {
                v = w.units.filter(u => u.owner === q.id && (u.cls === 'vil') === (this.mm_mode === 2)).length;
            }
            lines.push([q, v]);
        }
        const f = this.fonts['bs'];
        const wmax = Math.max(...lines.map(([q, s]) => f.size(`${q.name}: ${s}`)[0])) + 64;
        const y = MAP_PANEL.y - 6 - 20 * lines.length;
        const box = new pygame.Rect(SCREEN_W - wmax - 8, y - 4, wmax + 6, 20 * lines.length + 6);
        S.shade_overlay(this.screen, box, undefined, 130);
        if (this.mm_mode) {                                // mode icon to the left of the list
            const c = [box.x - 14, box.y + 12];
            pygame.draw.circle(this.screen, [40, 32, 24], c, 12);
            mm_btn_icon(this.screen, 'mode', c, this.mm_mode, this.pcolor(0));
        }
        lines.forEach(([q, s], i) => {
            const yy = y + i * 20 + 9;
            const col = q.alive ? q.color : [130, 120, 110];
            const tb = new pygame.Rect(box.x + 4, yy - 7, 14, 14);
            pygame.draw.rect(this.screen, col, tb);
            S.text(this.screen, String(q.team + 1), tb.center, this.fonts['s'], [255, 255, 255], 'center');
            const txt = `${q.name}: ${s}`;
            const r = S.text(this.screen, txt, [tb.right + 6, yy], f, shade(col, 50), 'midleft');
            if (!q.alive) pygame.draw.line(this.screen, [230, 90, 70], [r.x, r.centery], [r.right, r.centery], 1);
            this.age_shield(SCREEN_W - 16, yy, q.age, 16, shade(q.color, -50));
        });
    }

    // ============================================================ overlays
    dim(alpha = 160) {
        S.shade_overlay(this.screen, [0, 0, SCREEN_W, SCREEN_H], undefined, alpha);
    }

    /** Windows over the game: a window (objectives, chat, diplomacy, tree), then help / card / the match menu. */
    draw_overlays() {
        if (this.window) hud_windows.draw(this, this.window);
        if (this.show_history) hud_windows.draw_history(this);
        if (this.help === 'civ') {
            civ_ui.draw_overlay(this);
        } else if (this.help === 'menu') {
            this.draw_game_menu();
        } else if (this.help) {
            this.draw_help();
        }
    }

    /** A panel heading: a golden inscription in the center, ornamental lines on the sides. */
    title_bar(box, title, icon = null) {
        const scr = this.screen;
        const img = S.gold_text(title, this.fonts['h']);
        const r = img.get_rect({ center: [box.centerx, box.y + 30] });
        scr.blit(img, r);
        for (const side of [-1, 1]) {
            const x0 = side < 0 ? r.left - 16 : r.right + 16;
            const x1 = side < 0 ? box.x + 30 : box.right - 30;
            pygame.draw.line(scr, S.GOLD_DK, [x0, r.centery], [x1, r.centery], 2);
            pygame.draw.line(scr, [30, 20, 10], [x0, r.centery + 2], [x1, r.centery + 2], 1);
            const pts = [[x0, r.centery - 5], [x0 + 5 * -side, r.centery], [x0, r.centery + 5], [x0 + 5 * side, r.centery]];
            pygame.draw.polygon(scr, S.GOLD_HI, pts);
        }
        if (icon) S.blit_icon(scr, icon, [r.left - 40, r.centery], 30);
    }

    draw_help() {
        const scr = this.screen;
        this.dim(170);
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 360, 56, 720, 640);
        S.panel(scr, box, 'stone', undefined, undefined, true);
        this.title_bar(box, i18n.t('gm.help'), 'encyclopaedia');
        let y = box.y + 66;
        for (let [k, v] of HELP_ROWS) {
            k = k.startsWith('help.') ? i18n.t(k) : k;
            v = i18n.t(v);
            // keys - "pebbles"
            let kx = box.x + 34;
            for (const part of k.split(' · ')) {
                const img = this.fonts['bs'].render(part, true, [255, 232, 170]);
                const cap = new pygame.Rect(kx, y - 1, img.get_width() + 14, 22);
                S.slot(scr, cap);
                S.bevel(scr, cap, undefined, undefined, 1);
                scr.blit(img, img.get_rect({ center: cap.center }));
                kx = cap.right + 6;
            }
            const arrow = [[box.x + 368, y + 5], [box.x + 378, y + 10], [box.x + 368, y + 15]];
            pygame.draw.polygon(scr, S.GOLD_DK, arrow);
            this.text(v, [box.x + 392, y + 10], 'm', S.TEXT, 'midleft');
            y += 26;
        }
        const goal = new pygame.Rect(box.x + 30, box.bottom - 46, box.w - 60, 30);
        S.panel(scr, goal, 'parchment', false);
        S.blit_icon(scr, 'victory', [goal.x + 20, goal.centery], 24);
        S.text_fit(scr, i18n.t('hud.goal'), [goal.centerx + 10, goal.centery],
            this.fonts['b'], S.INK, 'center', null, goal.w - 60);
    }

    game_menu_rects() {
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 190, 170, 380, 110 + GAME_MENU.length * 66);
        return [box, GAME_MENU.map(([act, lbl, ic], i) => [new pygame.Rect(box.x + 40, box.y + 80 + i * 66, box.w - 80, 52), act, lbl, ic])];
    }

    draw_game_menu() {
        const scr = this.screen;
        this.dim(150);
        const [box, items] = this.game_menu_rects();
        S.panel(scr, box, 'stone', undefined, undefined, true);
        this.title_bar(box, i18n.t('keys.pause'));
        const mp = pygame.mouse.get_pos();
        for (const [r, act, lbl, ic] of items) {
            const h = r.collidepoint(mp);
            S.button(scr, r, h ? 'hover' : 'normal');
            S.blit_icon(scr, ic, [r.x + 30, r.centery], 30);
            S.text_fit(scr, i18n.t(lbl), [r.centerx + 12, r.centery], this.fonts['btn'],
                h ? [255, 236, 190] : [240, 222, 180], 'center', undefined, r.w - 70);
        }
    }

    /** Left click while an overlay is open (help, card, match menu). */
    overlay_click(pos) {
        if (this.help === 'menu') {
            const [box, items] = this.game_menu_rects();
            for (const [r, act] of items) {
                if (r.collidepoint(pos)) {
                    this.audio.click();
                    if (act === 'resume') {
                        this.help = false;
                    } else if (act === 'help') {
                        this.help = true;
                    } else if (act === 'civ') {
                        this.help = 'civ';
                    } else if (act === 'quit') {
                        this.help = false;
                        this.state = 'menu';
                        this.menu_screen = 'main';
                    }
                    return;
                }
            }
            if (!box.collidepoint(pos)) this.help = false;
            return;
        }
        this.help = false;
    }

    draw_gameover() {
        const scr = this.screen;
        const w = this.world;
        this.dim(150);
        const win = w.human_won();
        const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 280, 150, 560, 420);
        S.panel(scr, box, 'stone', undefined, undefined, true);
        S.blit_icon(scr, win ? 'victory' : 'defeat', [box.centerx, box.y + 60], 96);
        const img = S.gold_text(win ? i18n.t('end.victory_bang').toUpperCase() : i18n.t('end.defeat').toUpperCase(), this.fonts['xl'],
            ...(win ? [[255, 240, 170], [210, 150, 50]] : [[255, 170, 140], [160, 40, 30]]));
        scr.blit(img, img.get_rect({ center: [box.centerx, box.y + 140] }));
        const t = Math.trunc(w.time);
        const p = w.players[0];
        const tiles = [['time', `${py.fmt(py.floordiv(t, 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}`], ['age', AGE_NAMES[p.age]],
            ['economics', String(Math.trunc(py.sum(Object.values(p.gathered))))], ['kill', String(p.kills)]];
        const tw = py.floordiv(box.w - 60, tiles.length);
        tiles.forEach(([ic, val], i) => {
            const r = new pygame.Rect(box.x + 30 + i * tw, box.y + 190, tw - 12, 110);
            S.panel(scr, r, 'parchment', false);
            pygame.draw.rect(scr, [92, 62, 28], r, 1);
            if (ic === 'age') {
                const a = S.portrait('age', p.age, null, 44);
                if (a != null) scr.blit(a, a.get_rect({ center: [r.centerx, r.y + 36] }));
            } else if (ic === 'time') {
                hourglass(scr, r.centerx, r.y + 36, 18, S.INK);
            } else {
                S.blit_icon(scr, ic, [r.centerx, r.y + 36], 40);
            }
            const f = Array.from(val).length > 8 ? this.fonts['bs'] : this.fonts['l'];
            S.text(scr, val, [r.centerx, r.y + 84], f, S.INK, 'center', null);
        });
        const br = new pygame.Rect(box.centerx - 150, box.bottom - 84, 300, 54);
        const h = br.collidepoint(pygame.mouse.get_pos());
        S.button(scr, br, h ? 'hover' : 'normal');
        S.text_fit(scr, i18n.t('menu.to_main'), br.center, this.fonts['btn'], [255, 236, 190], 'center', undefined,
            br.w - 20);
    }

    // ============================================================ cursor
    update_cursor() {
        const cur = py.getattr(this, 'cursors', null);
        if (cur == null) return;
        if (this.state !== 'play') {
            cur.set('arrow');
            return;
        }
        this._cursor_t += 1;
        if (this._cursor_t % 3) return;
        cur.set(this.cursor_kind(pygame.mouse.get_pos()));
    }

    /** Cursor state by what is under the mouse (docs/research/08_cursor.md, DE). */
    cursor_kind(mp) {
        const w = this.world;
        if (this.help || w.winner != null || !this.in_view(mp)) return 'arrow';
        if (this.placing) return this.place_ok(mp) ? 'build' : 'no';
        const mode = py.getattr(this, 'order_mode', null);
        if (mode) return py.get(this.ORDER_CURSORS, mode, 'attack');      // waiting for a left click
        const units = this.selected.filter(u => u instanceof Unit && u.owner === 0 && u.alive);
        if (!units.length) {
            // a unit-training building is selected: right click sets a rally point - a flag (DE)
            if (this.selected.some(s => s instanceof Building && s.owner === 0 && s.complete && py.bool(py.get(s.d, 'trains', null)))) {
                return 'rally';
            }
            return 'arrow';
        }
        const e = this.entity_at(mp);
        const ships = units.filter(u => u.naval);
        const land = units.filter(u => !u.naval);
        if (e == null) {
            // a transport with passengers over land: unload
            if (ships.length && ships.some(s => py.bool(py.getattr(s, 'cargo', null))) && this.land_at(mp)) return 'unload';
            return 'arrow';
        }
        const vils = units.some(u => u.kind === 'villager');
        // a trade cart -> a market (own or allied, completed)
        if (e instanceof Building && e.kind === 'market' && e.complete && e.owner >= 0 &&
            w.allied(0, e.owner) && units.some(u => py.get(u.d, 'command', null))) {
            return 'trade';
        }
        // land units -> own transport: board
        if (land.length && e instanceof Unit && e.naval && e.owner === 0 &&
            (typeof e.cargo_cap === 'function' ? e.cargo_cap() : 0) > 0) {
            return 'board';
        }
        if (e instanceof Animal) {
            if (vils && e.den == null) return 'meat';
            return !e.dead ? 'attack' : 'arrow';
        }
        if (e.owner >= 0 && w.hostile(0, e.owner)) return 'attack';
        if (e instanceof Node && vils) {
            if (['tree', 'stone', 'gold', 'berries'].includes(e.kind)) return e.kind;
            return 'fish';
        }
        if (e instanceof Node && ships.length && ships.some(s => py.get(s.d, 'fisher', null))) return 'fish';
        if (e instanceof Unit && units.some(u => py.get(u.d, 'monk', null)) && w.allied(0, e.owner)
            && e.hp < e.max_hp) {
            return 'heal';
        }
        if (e instanceof Unit && vils && e.owner === 0 && ['siege', 'ship'].includes(e.cls) && e.hp < e.max_hp) return 'repair';
        if (e instanceof Building && e.owner === 0 && vils) {
            if (!e.complete) return 'build';
            if (e.kind === 'farm') return 'farm';
            if (py.get(e.d, 'drop', null) && units.some(u => u.carry > 0)) return 'drop';
            if (e.hp < e.max_hp) return 'repair';
        }
        if (e instanceof Building && e.owner === 0 && e.complete && py.get(e.d, 'water', null) && ships.length &&
            ships.some(s => s.carry > 0)) {
            return 'drop';
        }
        if (e instanceof Building && e.owner === 0 && e.complete && py.get(e.d, 'garrison', null) &&
            this.garrison_wanted(units, e)) {
            // right click on your own building with a garrison; DE: a villager without a load enters the center without Alt
            return this.garrison_room(e) > 0 ? 'garrison' : 'no';
        }
        return 'arrow';
    }

    /** Whether the selected building can be placed under the cursor (otherwise the "no" cursor). */
    place_ok(mp) {
        try {
            const [tx, ty] = this.place_tile(mp);
            return py.bool(this.world.can_place(this.placing, tx, ty, 0));
        } catch (e) {
            return true;
        }
    }

    land_at(mp) {
        const [wx, wy] = this.s2w(...mp);
        const w = this.world;
        const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
        return 0 <= tx && tx < w.W && 0 <= ty && ty < w.H && [0, 2].includes(w.terrain[ty][tx]);
    }

    /** Garrison by right click (defense_ui.garrison_command): the required class and - for villagers near a storage - empty hands
     *  or Alt. */
    garrison_wanted(units, b) {
        const allowed = py.get(b.d, 'garrison_cls', ['vil', 'inf', 'arch']);
        const cands = units.filter(u => py.contains(allowed, u.cls));
        if (!cands.length) return false;
        const vils = units.filter(u => u.kind === 'villager');
        if (py.get(b.d, 'drop', null) && vils.length && !(this.mods() & pygame.KMOD_ALT) && vils.some(u => u.carry > 0)) return false;
        return true;
    }

    garrison_room(b) {
        try {
            const defense = modules.defense;
            return defense.capacity(b) - b.garrison.length;
        } catch (e) {
            return 1;
        }
    }
}
py.classattrs(HudUI, {
    idle_rect: null,
    menu_btn_rect: null,
    _cursor_t: 0,
    ink: false,               // True - text is drawn on parchment (Game.text darkens light colors)
    window: null,             // open window: 'objectives' | 'chat' | 'diplomacy' | 'techtree'
    info_collapsed: false,
    build_page: null,         // villager building page: None | 'eco' | 'mil'
    show_score: true,
    clock_mode: 1,            // F11: 0 - hidden, 1 - time and speed, 2 - + frames per second
    mm_mode: 0,               // MM_MODES
    mm_team: false,           // team colors on the minimap
    show_history: false,
    // order mode (controls.order_mode) -> cursor (DE: each mode has its own icon)
    ORDER_CURSORS: {
        'flare': 'flare', 'patrol': 'patrol', 'guard': 'guard', 'follow': 'follow',
        'amove': 'amove', 'aground': 'aground',
    },
});


export function _relic_mm_color() {
    try {
        const themes_ = modules.themes;
        return py.getattr(themes_, 'MM_RELIC', [255, 255, 255]);
    } catch (e) {
        return [255, 255, 255];
    }
}


// ================================================================ procedural icons
/** A stat icon (the DE dictionary, otherwise a 0 A.D. portrait). */
export function stat_icon(kind, size) {
    return S.icon(STAT_ICONS[kind], size) || S.icon(STAT_ICONS_0AD[kind], size);
}


export function wrap(s, f, maxw) {
    const out = [];
    let cur = '';
    for (const word of py.split(s)) {
        const t = py.strip(cur + ' ' + word);
        if (f.size(t)[0] > maxw && cur) {
            out.push(cur);
            cur = word;
        } else {
            cur = t;
        }
    }
    if (cur) out.push(cur);
    return out;
}


/** A villager silhouette with an axe (the idle button, DE). */
export function idle_figure(scr, c) {
    const [cx, cy] = c;
    const col = [40, 28, 14];
    pygame.draw.circle(scr, col, [cx - 1, cy - 9], 4);
    pygame.draw.polygon(scr, col, [[cx - 6, cy - 4], [cx + 4, cy - 4], [cx + 6, cy + 5], [cx - 7, cy + 5]]);
    pygame.draw.line(scr, col, [cx - 4, cy + 5], [cx - 5, cy + 12], 3);
    pygame.draw.line(scr, col, [cx + 3, cy + 5], [cx + 4, cy + 12], 3);
    pygame.draw.line(scr, col, [cx + 4, cy - 2], [cx + 11, cy - 10], 2);
    pygame.draw.polygon(scr, col, [[cx + 9, cy - 13], [cx + 14, cy - 11], [cx + 12, cy - 7]]);
}


/** Health in a tooltip: a bar like under the portrait (DE), no heart. */
export function hp_glyph(scr, x, cy) {
    pygame.draw.rect(scr, [10, 10, 10], [x, cy - 4, 16, 8]);
    pygame.draw.rect(scr, [60, 200, 60], [x + 1, cy - 3, 14, 6]);
    pygame.draw.line(scr, [160, 250, 150], [x + 1, cy - 3], [x + 14, cy - 3]);
}


export function heart(scr, cx, cy, col = [210, 30, 30]) {
    pygame.draw.circle(scr, col, [cx - 3, cy - 2], 4);
    pygame.draw.circle(scr, col, [cx + 3, cy - 2], 4);
    pygame.draw.polygon(scr, col, [[cx - 7, cy - 1], [cx + 7, cy - 1], [cx, cy + 7]]);
}


export function hammer(scr, cx, cy, col) {
    pygame.draw.line(scr, [20, 14, 8], [cx - 5, cy + 6], [cx + 3, cy - 2], 4);
    pygame.draw.line(scr, [150, 100, 50], [cx - 5, cy + 6], [cx + 3, cy - 2], 2);
    pygame.draw.polygon(scr, [20, 14, 8], [[cx - 1, cy - 8], [cx + 8, cy + 1], [cx + 5, cy + 4], [cx - 4, cy - 5]]);
    pygame.draw.polygon(scr, col, [[cx, cy - 7], [cx + 7, cy], [cx + 5, cy + 2], [cx - 2, cy - 5]]);
}


/** A red "next page" arrow (DE). */
export function next_arrow(scr, r) {
    const [cx, cy] = r.center;
    const pts = [[cx - 12, cy - 5], [cx + 1, cy - 5], [cx + 1, cy - 11], [cx + 13, cy], [cx + 1, cy + 11], [cx + 1, cy + 5],
        [cx - 12, cy + 5]];
    pygame.draw.polygon(scr, [200, 40, 24], pts);
    pygame.draw.polygon(scr, [255, 150, 110], pts, 1);
}


/** A red "back" cross (DE). */
export function back_cross(scr, r) {
    const [cx, cy] = r.center;
    for (const d of [1, -1]) {
        pygame.draw.line(scr, [60, 10, 6], [cx - 11, cy - 11 * d], [cx + 11, cy + 11 * d], 7);
        pygame.draw.line(scr, [220, 40, 30], [cx - 10, cy - 10 * d], [cx + 10, cy + 10 * d], 4);
    }
}


/** A speech bubble (the "Chat" button). */
export function chat_icon(scr, c) {
    const [cx, cy] = c;
    pygame.draw.ellipse(scr, [235, 225, 200], [cx - 11, cy - 9, 22, 15]);
    pygame.draw.polygon(scr, [235, 225, 200], [[cx - 5, cy + 4], [cx - 8, cy + 10], [cx + 1, cy + 5]]);
    for (const dx of [-5, 0, 5]) pygame.draw.circle(scr, [80, 60, 40], [cx + dx, cy - 2], 2);
}


export function mm_btn_icon(scr, act, c, mode, color) {
    const [cx, cy] = c;
    if (act === 'flare') {                    // flash
        for (let i = 0; i < 8; i++) {
            const v = new pygame.Vector2(0, -10).rotate(i * 45);
            pygame.draw.line(scr, [255, 220, 120], [cx, cy], [cx + v.x, cy + v.y], 2);
        }
        pygame.draw.circle(scr, [255, 250, 220], c, 4);
    } else if (act === 'score') {                  // score columns
        [[8, [220, 60, 50]], [14, [70, 120, 230]], [11, [235, 235, 235]]].forEach(([h, col], i) => {
            pygame.draw.rect(scr, col, [cx - 9 + i * 7, cy + 7 - h, 5, h]);
        });
    } else if (act === 'colors') {                 // DE: a globe (team colors)
        pygame.draw.circle(scr, [40, 96, 190], c, 10);
        for (const [dx, dy, r] of [[-3, -3, 4], [3, 2, 3], [-2, 4, 2], [5, -4, 2]]) {
            pygame.draw.circle(scr, [70, 160, 70], [cx + dx, cy + dy], r);
        }
        pygame.draw.ellipse(scr, [190, 220, 250], [cx - 4, cy - 10, 8, 20], 1);
        pygame.draw.line(scr, [190, 220, 250], [cx - 10, cy], [cx + 10, cy], 1);
        pygame.draw.circle(scr, [20, 14, 8], c, 10, 1);
    } else {                                 // mode: normal - ground, military - a sword, economic - a sack
        if (mode === 1) {
            pygame.draw.line(scr, [220, 220, 230], [cx - 7, cy + 7], [cx + 7, cy - 7], 3);
            pygame.draw.line(scr, [160, 110, 50], [cx - 6, cy + 1], [cx - 1, cy + 6], 3);
        } else if (mode === 2) {
            pygame.draw.circle(scr, [240, 200, 40], [cx, cy + 2], 7);
            pygame.draw.rect(scr, [240, 200, 40], [cx - 3, cy - 8, 6, 5]);
        } else {                             // DE: sunset - the sun over the horizon
            for (let i = 0; i < 20; i++) {
                const t = i / 19;
                const col = [Math.trunc(250 - 60 * t), Math.trunc(200 - 150 * t), Math.trunc(90 - 50 * t)];
                const w = Math.trunc(Math.pow(100 - (i - 10) ** 2, 0.5));
                pygame.draw.line(scr, col, [cx - w, cy - 10 + i], [cx + w, cy - 10 + i]);
            }
            // draw_top_left=True, draw_top_right=True (pygame order: top_right, top_left, bottom_left, bottom_right)
            pygame.draw.circle(scr, [255, 240, 170], [cx, cy + 2], 5, 0, true, true);
            pygame.draw.line(scr, [60, 30, 20], [cx - 9, cy + 3], [cx + 9, cy + 3], 2);
            pygame.draw.circle(scr, [20, 14, 8], c, 10, 1);
        }
    }
}


/** An hourglass (the time icon) - an outline in color col. */
export function hourglass(scr, cx, cy, s, col) {
    const top = [[cx - s * 0.6, cy - s], [cx + s * 0.6, cy - s], [cx, cy]];
    const bot = [[cx - s * 0.6, cy + s], [cx + s * 0.6, cy + s], [cx, cy]];
    pygame.draw.polygon(scr, [200, 160, 90], [[cx - s * 0.3, cy - s * 0.5], [cx + s * 0.3, cy - s * 0.5], [cx, cy]]);
    pygame.draw.polygon(scr, [200, 160, 90], [[cx - s * 0.5, cy + s * 0.9], [cx + s * 0.5, cy + s * 0.9],
        [cx, cy + s * 0.4]]);
    pygame.draw.polygon(scr, col, top, 2);
    pygame.draw.polygon(scr, col, bot, 2);
    for (const y of [cy - s - 2, cy + s + 2]) {
        pygame.draw.line(scr, col, [cx - s * 0.8, y], [cx + s * 0.8, y], 4);
    }
}
