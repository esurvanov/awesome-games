// port of game/ui.py
// The game screen: the isometric camera, drawing, input, panels.
import * as py from '../runtime/py.js';
import { math, random, time } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';

import {
    TILE, HW, HH, SCREEN_W, SCREEN_H, TOP_H, PANEL_H, VIEW_H,
    FPS, GAME_SPEED, PLAYER_COLORS, AGE_NAMES, NODE_DEFS,
    FARM_FOOD, ANIMALS, UNITS, BUILDINGS, TECHS, AGE_TECHS, HOTKEYS, shade, to_iso, from_iso,
    as_tuple,
} from './data.js';
import { World, Unit, Building, Node, Animal } from './world.js';
import { AI } from './ai.js';
import * as gfx from './gfx.js';
import * as naval from './naval.js';
import * as naval_gfx from './naval_gfx.js';
import * as sprites3d from './sprites3d.js';
import * as sprites_extra from './sprites_extra.js';
import * as terrain from './terrain.js';
import * as terrain_gfx from './terrain_gfx.js';
import * as map_assets from './map_assets.js';
import * as sound from './sound.js';
import { DefenseUI } from './defense_ui.js';
import { ControlsUI } from './controls.js';
import * as orders from './orders.js';
import * as controls_draw from './controls_draw.js';
import * as relics from './relics.js';
import { HudUI, MM_RECT } from './hud.js';
import { MenuUI } from './menu.js';
import { LobbyUI } from './lobby.js';
import { ScreensUI } from './screens.js';
import * as i18n from './i18n.js';
import * as uiskin from './uiskin.js';
import * as gsettings from './settings.js';

export const SPEEDS = [1.0, 1.5, GAME_SPEED, 2.0, 3.0];
export const ZOOMS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.12, 1.25, 1.4, 1.6];     // wheel zoom steps (1.0 - normal)
export const FOG_S = 8;          // how many times the fog is coarser than the screen
export const UNIT_K = 1.15;      // figure scale

export const _DEPTH_KEY = py.itemgetter(0, 1);      // drawing order: depth, then type (resource, building, unit, animal)
const _depth_cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);

// the unit figure cache (see Game.draw_unit_w): py.tkey(pose key) -> [surface, x offset, y offset]
export const _USPR = new Map();
export const _UCANVAS = [];
export const _TAU = math.tau;
export const _ANIM_Q = 16 / math.tau;
export const _U_OX = 56, _U_OY = 98, _U_W = 112, _U_H = 112;        // the "feet" point and the size of the scratch surface (the largest is the trebuchet)
// 8 look directions; x is never 0 - the figure's facing depends on the sign of x
export const _DIRS8 = py.range(8).map(i => [math.cos(i * math.tau / 8), math.sin(i * math.tau / 8)])
    .map(([x, y]) => [Math.abs(x) < 1e-9 ? 0.01 : x, y]);

const _int = Math.trunc;

/** A stand-in for CPython's id(obj) (a memory address) where the code uses its bits as a per-object hash
 *  (villager sex, animation phase, animal variant): py.id() is a small counter, so it is mixed into 31 bits. */
export function _addr(obj) {
    return Math.imul(py.id(obj), 0x9E3779B1) >>> 1;
}

/** The bounding box of the opaque part of a sprite (without the translucent cast shadow). */
export function _solid_rect(spr) {
    try {
        return spr.get_bounding_rect(128);
    } catch (e) {
        if (!(e instanceof TypeError || e instanceof py.TypeError)) throw e;
        return spr.get_bounding_rect();
    }
}

/** The number of the nearest of the 8 directions with the same sign of x as (fx, fy). */
export function _qface(fx, fy) {
    let i = py.mod(py.round(math.atan2(fy, fx) * (8 / math.tau)), 8);
    if (fx < 0) {                      // the vertical directions 2 and 6 "look right" - shift to the left
        if (i === 2) i = 3;
        else if (i === 6) i = 5;
    }
    return i;
}

// ---- units from 3D models (game/sprites3d.py USet): choosing the animation and frame by the unit's state
export const _GATHER_ANIM = {
    'tree': 'chop', 'gold': 'mine', 'stone': 'mine', 'farm': 'farm', 'berries': 'forage',
    'hunt': 'butcher', 'fish': 'forage',
};

/** A female or male villager: stable for the object (by its address). */
export function _female(u) {
    return u.kind === 'villager' && ((_addr(u) >> 5) & 1) === 1;
}

export function _uset(u, civ) {
    return sprites3d.unit_set(u.look(), civ, _female(u));
}

/** A frame of a looped animation at real pace; every unit has its own phase. */
export function _loop_k(a, t, u) {
    return _int((t / (a['dur'] || 1.0) + ((_addr(u) >> 4) % 97) / 97.0) * a['n']);
}

/** [animation name, frame number] for unit u with the frame set us at game time t. */
export function unit_pose(u, us, t, moving) {
    const A = us.anims;
    const st = u.state;
    if (moving) {
        let name = 'walk';
        const cr = u.carry_res;
        if (cr && u.carry >= 1 && py.contains(A, 'carry_' + cr)) {
            name = 'carry_' + cr;
        } else if (py.getattr(u, 'flee_t', 0) > t - 1.0 && py.contains(A, 'run')) {
            name = 'run';
        }
        const a = py.get(A, name, null);
        if (a == null) return ['idle', 0];
        if (a['n'] <= 1) return [name, 0];
        const stride = py.get(a, 'stride', null) || 0;
        let ph;
        if (stride > 4) {
            // the step is synchronized with the distance covered: anim grows by 12 per second of movement
            ph = u.anim * (u.d['speed'] * TILE / 12.0) / stride;
        } else {
            ph = t / (a['dur'] || 1.0);
        }
        return [name, _int(ph * a['n'])];
    }
    const tg = u.target;
    if (st === 'attack' || (st === 'gather' && tg instanceof Animal && !tg.dead)) {
        const a = py.get(A, 'attack', null);
        if (a == null) return ['idle', 0];
        let reload = py.get(u.d, 'reload', null) || 2.0;
        if (st === 'gather') reload = 1.5;
        const D = Math.min(a['dur'] || 1.0, Math.max(0.35, reload * 0.95));
        const e = py.get(a, 'event', 0.5);
        const since = reload - u.cool;
        let ph;
        if (0 <= since && since < D * (1 - e)) ph = e + since / D;
        else if (u.cool < D * e) ph = e - u.cool / D;
        else ph = 0.0;
        return ['attack', Math.min(a['n'] - 1, Math.max(0, _int(ph * a['n'])))];
    }
    if (st === 'heal' || st === 'convert') {
        const a = py.get(A, 'attack', null);
        if (a != null) return ['attack', _loop_k(a, t, u)];
        return ['idle', 0];
    }
    if (st === 'gather' && u.kind === 'villager') {
        const name = tg instanceof Animal ? 'butcher' : tg instanceof Building ? 'farm'
            : py.get(_GATHER_ANIM, u.gather_kind, 'forage');
        const a = py.get(A, name, null);
        if (a != null) return [name, _loop_k(a, t, u)];
    } else if (st === 'build') {
        const a = py.get(A, 'build', null);
        if (a != null) return ['build', _loop_k(a, t, u)];
    }
    const a = py.get(A, 'idle', null);
    if (a != null && a['n'] > 1) return ['idle', _loop_k(a, t, u)];          // lively idle: breathing, shifting from foot to foot (each with its own pace)
    return ['idle', 0];
}

export function _render_unit(key) {
    const [look, col, qf, qa, qs, carry, moving] = key;
    if (!_UCANVAS.length) _UCANVAS.push(new pygame.Surface([_U_W, _U_H], pygame.SRCALPHA));
    const cv = _UCANVAS[0];
    cv.fill([0, 0, 0, 0]);
    gfx.draw_unit(cv, look, col, _U_OX, _U_OY, _DIRS8[qf], qa / _ANIM_Q, qs * 0.03, UNIT_K, carry, moving);
    let r = cv.get_bounding_rect();
    let spr;
    if (r.w === 0 || r.h === 0) {
        spr = new pygame.Surface([1, 1], pygame.SRCALPHA);
        r = new pygame.Rect(_U_OX, _U_OY, 1, 1);
    } else {
        spr = cv.subsurface(r).copy();
    }
    if (_USPR.size > 6000) _USPR.clear();
    const hit = [spr, r.x - _U_OX, r.y - _U_OY];
    _USPR.set(py.tkey(key), hit);
    return hit;
}

export const _MASKS = new Map();

/** The mask of the opaque part of a sprite (without the cast shadow: its alpha ~ 107), cached by surface. */
export function _mask(surf, thr) {
    let m = _MASKS.get(surf);
    if (m == null) {
        if (_MASKS.size > 6000) _MASKS.clear();
        m = pygame.mask.from_surface(surf, thr);
        _MASKS.set(surf, m);
    }
    return m;
}

// fog: the visibility/exploration byte (0 or 1) -> alpha
export const _FOG_VIS = Uint8Array.from([0, 255, ...new Array(254).fill(255)]);
export const _FOG_EXP = Uint8Array.from([0, 130, ...new Array(254).fill(130)]);

export const _FISH_PICK = [null];

export class Game {
    constructor() {
        sound.pre_init();
        pygame.init();
        this.screen = pygame.display.set_mode([SCREEN_W, SCREEN_H], pygame.SCALED);
        pygame.display.set_caption(i18n.t('app.title'));
        this.clock = new pygame.time.Clock();
        this.fonts = uiskin.game_fonts();      // PT Serif (numbers, names), Cormorant SC (headings), FreeSans (text)
        this.cursors = new uiskin.Cursors();
        this.tcache = new Map();               // py.tkey([s, font, color]) -> Surface
        this._on_language_cb = (code = null) => this.on_language(code);
        i18n.on_change(this._on_language_cb);
        this.trees = py.range(6).map(i => gfx.make_tree(i));
        this.node_spr = {
            'gold': py.range(4).map(i => gfx.make_rocks([228, 188, 42], i, true)),
            'stone': py.range(4).map(i => gfx.make_rocks([150, 150, 158], i)),
            'berries': py.range(3).map(i => gfx.make_bush(i)),
        };
        for (const [k, d] of Object.entries(NODE_DEFS)) {      // resources from content with their own sprite (fish)
            if (py.get(d, 'sprite', null)) this.node_spr[k] = py.range(3).map(i => d['sprite'](i));
        }
        this.bspr = new Map();                 // py.tkey(key) -> [spr, ox, oy, bbox] | null
        this.fspr = new Map();
        this.icons = new Map();                // py.tkey([typ, name, owner, size]) -> Surface
        this.state = 'menu';
        this.world = null;
        this.running = true;
        this.help = false;
        this.menu_cfg = {};          // the lobby (game/lobby.py): player slots and match parameters
        this.cmd_page = 0;
        this.cmd_key = null;
        this.audio = new sound.Audio();
        this.zoom = this.zoom_to = 1.0;     // world scale (the mouse wheel)
        this.zoom_anchor = null;
        this.wheel_acc = 0.0;
        this._cv = false;                    // the world is being drawn onto the canvas (w2s/s2w - in canvas coordinates)
        this._canvas = null;
        this.drawn_u = [];                   // [canvas rect, unit/animal, frame] - a click by the body's pixels
        this._urect = new Map();             // unit -> the frame's rect on the canvas (the last frame)
        this._bbc = new Map();               // frame surface -> the bounding box of opaque pixels (health bar, ellipse)
        this.apply_startup_settings();       // screens.py: cursors, full screen (settings.json)
    }

    // ============================================================ sprites
    pcolor(owner) {
        const w = this.world;
        if (w != null && 0 <= owner && owner < w.players.length) return w.players[owner].color;
        return py.at(PLAYER_COLORS, owner);
    }

    /** 'me' | 'ally' | 'enemy' | 'gaia' - the owner's relation to the human player. */
    relation(owner) {
        if (owner === 0) return 'me';
        if (owner < 0) return 'gaia';
        return this.world.allied(0, owner) ? 'ally' : 'enemy';
    }

    civ_of(owner) {
        const w = this.world;
        if (w != null && 0 <= owner && owner < w.players.length) return w.players[owner].civ;
        return 'default';
    }

    /** [model variant, shore side] of the building on the cell (tx, ty): houses - 2-3 models by the cell's hash,
     *  a dock - its "house" toward the shore. */
    blook(kind, owner, tx, ty) {
        let var_ = 0;
        if (kind === 'house') {
            const n = sprites3d.variants(kind, this.civ_of(owner));
            if (n > 1) {
                // Python ints: (tx * 73856093) ^ (ty * 19349663) exceeds 32 bits - BigInt keeps it exact
                const h = (BigInt(tx) * 73856093n) ^ (BigInt(ty) * 19349663n);
                var_ = Number(((h ^ (h >> 13n)) & 0x7fffffffn) % BigInt(n));
            }
        }
        let land = null;
        if (kind === 'dock' && this.world != null) land = naval.dock_land(this.world, tx, ty, BUILDINGS[kind]['size']);
        return [var_, land];
    }

    /** [surface, ox, oy, bbox] - ox,oy: the top corner of the base inside the sprite.
     *  Buildings are taken from pre-rendered 3D models (game/sprites3d.py) by the owner's civilization,
     *  without them - procedural graphics. stage 0..2 - the construction stage (null if there is no such picture).
     *  var - the model variant (houses), land - the shore side (docks), see blook(). */
    bsprite(kind, owner, stage = null, var_ = 0, land = null) {
        const col = this.pcolor(owner);
        const civ = this.civ_of(owner);
        const key = py.tkey([kind, col, civ, stage, var_, land]);
        if (!this.bspr.has(key)) {
            let r = null;
            if (kind !== 'farm' && !py.get(BUILDINGS[kind], 'wall', null)) r = sprites3d.building(kind, civ, col, stage, var_, land);
            let spr, ox, oy;
            if (r != null) {
                [spr, ox, oy] = r;
            } else if (stage != null) {
                this.bspr.set(key, null);
                return null;
            } else if (kind === 'farm') {
                [spr, ox, oy] = this.farm_sprite(true, 4);
            } else if (py.get(BUILDINGS[kind], 'wall', null)) {
                [spr, ox, oy] = this.wall_sprite(kind, owner);
            } else {
                [spr, ox, oy] = gfx.make_building_sprite(kind, col);
            }
            // a box without the translucent shadow (for the health bar, icons and badges)
            this.bspr.set(key, [spr, ox, oy, _solid_rect(spr)]);
        }
        return this.bspr.get(key);
    }

    farm_sprite(done, level) {
        const key = py.tkey([done, level]);
        if (!this.fspr.has(key)) {
            const r3 = sprites3d.farm(done ? level : 0);
            if (r3 != null) {
                let [surf, ox, oy] = r3;
                if (!done) {
                    surf = surf.copy();
                    surf.set_alpha(170);
                }
                this.fspr.set(key, [surf, ox, oy]);
                return this.fspr.get(key);
            }
            const s = 3;
            const surf = new pygame.Surface([s * 2 * HW + 4, s * 2 * HH + 16], pygame.SRCALPHA);
            const ox = s * HW + 2, oy = 10;
            gfx.draw_farm(surf, ox, oy, s, done ? 1.0 : 0.0, level / 4);
            this.fspr.set(key, [surf, ox, oy]);
        }
        return this.fspr.get(key);
    }

    icon(typ, name, owner = 0, size = 40) {
        const key = py.tkey([typ, name, owner, size]);
        let ic = this.icons.get(key);
        if (ic != null) return ic;
        ic = this.skin_icon(typ, name, owner, size);      // a 0 A.D. portrait (hud.py), otherwise a procedural one
        if (ic != null) {
            this.icons.set(key, ic);
            return ic;
        }
        ic = new pygame.Surface([size, size], pygame.SRCALPHA);
        if (typ === 'u' && Object.hasOwn(ANIMALS, name)) {
            gfx.draw_animal(ic, name, size / 2, size * 0.8, undefined, undefined, undefined, undefined, undefined, size / 26);
        } else if (typ === 'u') {
            gfx.draw_unit(ic, name, this.pcolor(owner), size / 2, size * 0.86, undefined, undefined, undefined,
                size / 27 * py.get(py.get(UNITS, name, {}), 'icon_k', 1.0));
        } else if (typ === 'b') {
            let [spr, , , bb] = this.bsprite(name, owner);
            spr = spr.subsurface(bb);
            const [sw, sh] = spr.get_size();
            const sc = Math.min((size - 2) / sw, (size - 2) / sh);
            const img = pygame.transform.smoothscale(spr, [Math.max(1, _int(sw * sc)), Math.max(1, _int(sh * sc))]);
            if (sprites3d.available()) img.fill([16, 15, 12], null, pygame.BLEND_RGB_ADD);    // the render is a bit dark for a plate
            ic.blit(img, img.get_rect({ center: [py.floordiv(size, 2), py.floordiv(size, 2)] }));
        } else if (typ === 't') {
            const t = TECHS[name];
            const bg = AGE_TECHS.includes(name) ? [150, 115, 40] : !py.get(t, 'upgrade', null) ? [70, 95, 130] : [60, 110, 70];
            pygame.draw.rect(ic, bg, [3, 3, size - 6, size - 6], 0, 6);
            pygame.draw.rect(ic, shade(bg, 60), [3, 3, size - 6, size - 6], 2, 6);
            if (py.get(t, 'upgrade', null)) {
                // a line upgrade: a figure of the new unit and an up arrow
                gfx.draw_unit(ic, t['upgrade'][1], this.pcolor(owner), size * 0.45, size * 0.84, undefined, undefined, undefined,
                    size / 32 * py.get(UNITS[t['upgrade'][1]], 'icon_k', 1.0));
                const ax = size * 0.78, ay = size * 0.3;
                pygame.draw.polygon(ic, [255, 230, 120], [[ax, ay - 7], [ax - 6, ay], [ax - 2, ay], [ax - 2, ay + 7],
                    [ax + 2, ay + 7], [ax + 2, ay], [ax + 6, ay]]);
            } else {
                const f = Array.from(py.get(t, 'icon', '')).length <= 2 ? this.fonts['l'] : this.fonts['b'];
                const img = f.render(py.get(t, 'icon', '?'), true, [255, 250, 235]);
                ic.blit(img, img.get_rect({ center: [py.floordiv(size, 2), py.floordiv(size, 2)] }));
            }
        } else if (typ === 'x') {
            this.draw_x_icon(ic, name, size);
        } else if (typ === 'ctl') {
            controls_draw.draw_ctl_icon(ic, name, size);
        } else if (typ === 'n') {
            const r3 = ['tree', 'gold', 'stone', 'berries'].includes(name) ? sprites3d.icon_rec(name) : null;
            let spr = r3 ? r3[0] : name === 'tree' ? this.trees[0] : this.node_spr[name][0];
            const bb = _solid_rect(spr);
            spr = spr.subsurface(bb);
            const sc = Math.min((size - 2) / bb.w, (size - 2) / bb.h);
            const img = pygame.transform.smoothscale(spr, [_int(bb.w * sc), _int(bb.h * sc)]);
            ic.blit(img, img.get_rect({ center: [py.floordiv(size, 2), py.floordiv(size, 2)] }));
        }
        this.icons.set(key, ic);
        return ic;
    }

    /** Language change (Settings -> Game): fonts (Latin <-> ideographs) and all caches with text - anew. */
    on_language(code = null) {
        uiskin.reset_fonts();
        this.fonts = uiskin.game_fonts();
        this.tcache.clear();
        this.icons.clear();                       // tech plates with letters
        for (const attr of ['_credits', '_nothing', '_panel_bg']) {
            if (py.hasattr(this, attr)) this[attr] = null;
        }
        if (py.getattr(this, 'world', null) != null && py.getattr(this, 'hud_reset', null) && this.state === 'play') {
            const f = this.fonts;
            py.setdefault(f, 'n', uiskin.font('antiqua', 18, true));
            py.setdefault(f, 'age', uiskin.font('antiqua', 18, true));
            py.setdefault(f, 'tip', uiskin.font('antiqua', 13, true));
            py.setdefault(f, 'tipb', uiskin.font('antiqua', 15, true));
        }
        try {
            pygame.display.set_caption(i18n.t('app.title'));
        } catch (e) {
            if (!(e instanceof pygame.error)) throw e;
        }
    }

    text(s, pos, font = 'm', color = [240, 235, 220], anchor = 'topleft', sh = true) {
        if (this.ink) {                    // on parchment (hud.py): light - into dark ink, no shadow
            sh = false;
            if (0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2] > 140)
                color = [_int(color[0] * 0.3), _int(color[1] * 0.26), _int(color[2] * 0.2)];
        }
        const key = py.tkey([s, font, color]);
        let img = this.tcache.get(key);
        if (img == null) {
            if (this.tcache.size > 1500) this.tcache.clear();
            img = this.fonts[font].render(s, true, color);
            this.tcache.set(key, img);
        }
        const r = img.get_rect({ [anchor]: pos });
        if (sh) {
            const skey = py.tkey([s, font, 'sh']);
            let simg = this.tcache.get(skey);
            if (simg == null) {
                simg = this.fonts[font].render(s, true, [15, 12, 10]);
                this.tcache.set(skey, simg);
            }
            this.screen.blit(simg, [r.x + 1, r.y + 1]);
        }
        this.screen.blit(img, r);
        return r;
    }

    // ============================================================ new game
    /** opponents - the number of computer players (1-7); ally - player 1 is on your team (with >= 2 opponents),
     *  otherwise all computers are on one team against you. ai_human - the AI plays for you too (for tools).
     *  map_type - the map type (naval.MAP_TYPES). civ - your civilization ('random' - random);
     *  civs - the civilizations of all players (otherwise the computers' are random).
     *  teams / colors - the team (0...) and the color number (PLAYER_COLORS) of each player (lobby);
     *  levels - the AI level 0-5 per player (match.AI_LEVELS); settings - match parameters (game/match.py). */
    new_game(diff, opponents = 1, ally = false, ai_human = false, map_type = 'land', civ = 'random', civs = null,
        teams = null, colors = null, levels = null, settings = null) {
        this.last_start = { diff, opponents, ally, ai_human, map_type, civ, civs, teams, colors, levels, settings };
        const a = this.last_start;
        this.make_world(a.diff, a.opponents, a.ally, a.ai_human, a.map_type, a.civ, a.civs, a.teams, a.colors, a.levels,
            a.settings);
        this.attach_world();
    }

    /** Create the match's world (without preparing the screen - see attach_world). */
    make_world(diff, opponents = 1, ally = false, ai_human = false, map_type = 'land', civ = 'random', civs = null,
        teams = null, colors = null, levels = null, settings = null) {
        const n = 1 + Math.max(1, Math.min(7, opponents));
        if (!py.bool(teams) || teams.length < n) {
            teams = [0].concat(new Array(n - 1).fill(1));
            if (ally && n >= 3) teams[1] = 0;
        }
        teams = py.list(teams).slice(0, n);
        civs = py.bool(civs) ? py.list(civs) : [civ].concat(new Array(n - 1).fill('random'));
        this.world = new World(diff, n, teams, undefined, civs, undefined, map_type, levels, settings);
        const w = this.world;
        (colors || []).slice(0, n).forEach((ci, pid) => {
            w.players[pid].color = PLAYER_COLORS[ci];
            if (pid) w.players[pid].name_key = 'color.' + i18n.COLOR_KEYS[ci];
        });
        w.ais = [];
        for (let pid = ai_human ? 0 : 1; pid < n; pid++)
            w.ais.push(new AI(w, pid, diff, (py.bool(levels) && pid < levels.length) ? levels[pid] : null));
        return w;
    }

    /** Prepare the screen for the world this.world (a new match or a loaded one): ground, camera, state. */
    attach_world(w = null, ui = null) {
        if (w != null) this.world = w;
        w = this.world;
        this.icons.clear();
        this.iso_ox = w.H * HW;
        this.iso_tw = (w.W + w.H) * HW;
        this.iso_th = (w.W + w.H) * HH;
        this.zoom_anchor = null;
        this.zoom_to = this.zoom;
        const [cx, cy] = w.starts[0];
        this.center_on(cx * TILE, cy * TILE);
        this.selected = [];
        this.placing = null;
        this.groups = new Map();
        this.drag = null;
        this.mm_drag = false;
        this.mid_drag = false;
        this.markers = [];
        this.last_click = [0, null];
        this.last_group = [null, 0];
        this.paused = false;
        this.speed = py.bool(py.getattr(w, 'settings', null)) ? Number(py.get(w.settings, 'speed', GAME_SPEED)) : GAME_SPEED;
        this.help = false;
        this.idle_idx = 0;
        this.idle_rect = null;
        this.drawn = [];
        this.panel_hits = [];
        this.build_terrain();
        this.fog_full = null;
        this.fog_full_ver = -1;
        this.fog_view = null;
        this.mm_t = 0;
        this.mm_img = null;
        this.events = [];
        this.cmd_page = 0;
        this.cmd_key = null;
        this.ctl_init();
        this.hud_reset();
        this.autosave_t = 0.0;
        this.gameover_seen = false;
        if (py.bool(ui)) {
            this.zoom = this.zoom_to = Number(py.get(ui, 'zoom', 1.0));
            this.cam_x = py.get(ui, 'cam_x', this.cam_x);
            this.cam_y = py.get(ui, 'cam_y', this.cam_y);
            this.speed = py.get(ui, 'speed', this.speed);
            this.clamp_cam();
            this.restore_groups(py.get(ui, 'groups', null));       // screens.py: Ctrl+digit groups
        }
        this.state = 'play';
    }

    build_terrain() {
        const w = this.world;
        const MAP_W = w.W, MAP_H = w.H;
        const ISO_TW = this.iso_tw, ISO_TH = this.iso_th;
        const small = new pygame.Surface([MAP_W, MAP_H]);
        const rnd = new random.Random(5);
        const depth = naval_gfx.shore_dist(w);
        // the world backing: ground type, lighter at higher levels; water - by depth (its color - the world's water)
        {
            let y = 0;
            for (const row of terrain_gfx.minimap_colors(w, naval_gfx.water_color, depth)) {
                let x = 0;
                for (const c of row) small.set_at([x++, y], c);
                y++;
            }
        }
        // the minimap - in the DE palette taking the landscape into account (game/themes.py)
        const mm = new pygame.Surface([MAP_W, MAP_H]);
        {
            let y = 0;
            for (const row of terrain_gfx.minimap_colors(w, naval_gfx.water_color, depth, true)) {
                let x = 0;
                for (const c of row) mm.set_at([x++, y], c);
                y++;
            }
        }
        this.mm_base = mm;
        const sq = pygame.transform.smoothscale(small.convert_alpha(), [MAP_W * 24, MAP_H * 24]);
        const rot = pygame.transform.rotate(sq, -45);
        const iso = pygame.transform.smoothscale(rot, [ISO_TW, ISO_TH]);
        const big = new pygame.Surface([ISO_TW, ISO_TH]);
        big.fill([0, 0, 0]);
        big.blit(iso, [0, 0]);
        // grass and water details (with the textured 0 A.D. ground - only glints on the water)
        const textured = sprites3d.available() && sprites3d.terrain_tile('grass') != null;
        for (let i = 0; i < 26000; i++) {
            const x = rnd.uniform(0, MAP_W * TILE);
            const y = rnd.uniform(0, MAP_H * TILE);
            let [ix, iy] = to_iso(x, y, this.iso_ox);
            ix = _int(ix);
            iy = _int(iy);
            const t = w.terrain[_int(py.floordiv(y, TILE))][_int(py.floordiv(x, TILE))];
            if (t === 1) {
                if (rnd.random() < 0.3) {
                    const c = shade(naval_gfx.water_color(depth[_int(py.floordiv(y, TILE))][_int(py.floordiv(x, TILE))]), 22);
                    pygame.draw.line(big, c, [ix, iy], [ix + rnd.randint(4, 10), iy], 1);
                }
            } else if (!textured) {
                const c = big.get_at([ix, iy]);
                const d = rnd.choice([-22, -14, 14]);
                pygame.draw.line(big, shade(c, d), [ix, iy], [ix + rnd.randint(-2, 2), iy - rnd.randint(2, 5)], 1);
            }
        }
        for (let i = 0, n = textured ? 0 : 1500; i < n; i++) {
            const x = rnd.uniform(0, MAP_W * TILE);
            const y = rnd.uniform(0, MAP_H * TILE);
            if (w.terrain[_int(py.floordiv(y, TILE))][_int(py.floordiv(x, TILE))] === 0) {
                const [ix, iy] = to_iso(x, y, this.iso_ox);
                const c = rnd.choice([[230, 220, 90], [240, 240, 240], [200, 120, 200]]);
                pygame.draw.circle(big, c, [_int(ix), _int(iy)], 1);
            }
        }
        const tiles = textured ? terrain_gfx.load_tiles(map_assets.tile_fn(w)) : null;     // the match's landscape
        if (py.bool(tiles)) {
            // ground types by cell with blending by masks (game/terrain_gfx.py)
            terrain_gfx.paint_ground(big, w, this.iso_ox, tiles);
        }
        naval_gfx.decorate(big, w, depth, this.iso_ox, rnd);
        // relief: lifting by heights and slope light; the same shift - for the fog
        const relief = new terrain_gfx.Relief(w, this.iso_ox, ISO_TW, ISO_TH);
        relief.apply(big);
        this.fog_rows = relief.fog_rows(py.floordiv(ISO_TW, FOG_S), py.floordiv(ISO_TH, FOG_S), FOG_S);
        this.terrain_surf = big.convert();
        this.water_fx = new naval_gfx.WaterFX(w, this.iso_ox, depth);
    }

    // ============================================================ camera
    // Zoom (DE, mouse wheel): the world is drawn at scale 1.0 onto a "canvas" of the size view/zoom and stretched
    // onto the screen. Canvas coordinates are the former ones (w2c); w2s/s2w are screen ones (taking zoom into account), and while
    // the world is being drawn (this._cv) - canvas coordinates, so all the drawing code does not know about the scale.
    view_w() {
        return SCREEN_W / this.zoom;
    }

    view_h() {
        return VIEW_H / this.zoom;
    }

    clamp_cam() {
        this.cam_x = Math.max(0, Math.min(this.iso_tw - this.view_w(), this.cam_x));
        this.cam_y = Math.max(0, Math.min(this.iso_th - this.view_h(), this.cam_y));
    }

    center_on(x, y) {
        const [ix, iy] = to_iso(x, y, this.iso_ox, this.world.z_at(x, y));
        this.cam_x = ix - this.view_w() / 2;
        this.cam_y = iy - this.view_h() / 2;
        this.clamp_cam();
    }

    // Height (game/terrain.py): a world point is raised by h = world.z_at(x, y) pixels (or by an explicit h -
    // buildings stand at the base's average height). This is the only "world -> screen" path (like data.to_iso(..., z)).
    /** World -> canvas (scale 1.0; the top of the world - at TOP_H), raised by the ground height.
     *  The camera is an integer (like the ground, blit with int(cam)): objects and ground are on one grid. */
    w2c(x, y, h = null) {
        if (h == null) h = this.world.z_at(x, y);
        return [x - y + this.iso_ox - _int(this.cam_x), (x + y) * 0.5 - h - _int(this.cam_y) + TOP_H];
    }

    w2s(x, y, h = null) {
        if (h == null) h = this.world.z_at(x, y);
        const z = this.zoom;
        const cx = _int(this.cam_x), cy = _int(this.cam_y);
        if (z === 1.0 || this._cv) return [x - y + this.iso_ox - cx, (x + y) * 0.5 - h - cy + TOP_H];
        return [(x - y + this.iso_ox - cx) * z, ((x + y) * 0.5 - h - cy) * z + TOP_H];
    }

    /** Screen -> the ground point under the cursor (taking relief into account). */
    s2w(sx, sy) {
        if (!this._cv) [sx, sy] = this.to_canvas([sx, sy]);
        return terrain.ground_at(this.world, sx + _int(this.cam_x), sy - TOP_H + _int(this.cam_y), this.iso_ox);
    }

    /** The top corner of a building's base on the screen - at the base's average height. */
    b2s(b) {
        return this.w2s(b.tx * TILE, b.ty * TILE, terrain.building_z(this.world, b));
    }

    /** Screen -> canvas. */
    to_canvas(pos) {
        const z = this.zoom;
        if (z === 1.0) return [pos[0], pos[1]];
        return [pos[0] / z, TOP_H + (pos[1] - TOP_H) / z];
    }

    /** Zoom z around the screen point anchor (the world point under it stays in place). */
    set_zoom(z, anchor = null) {
        z = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
        const [ax, ay] = anchor != null ? anchor : [SCREEN_W / 2, TOP_H + VIEW_H / 2];
        const ix = this.cam_x + ax / this.zoom;
        const iy = this.cam_y + (ay - TOP_H) / this.zoom;
        this.zoom = Math.abs(z - 1.0) < 1e-3 ? 1.0 : z;
        this.cam_x = ix - ax / this.zoom;
        this.cam_y = iy - (ay - TOP_H) / this.zoom;
        this.clamp_cam();
    }

    /** A step along the ZOOMS ladder (n > 0 - closer). The smooth transition is in update (zoom_tick). */
    zoom_step(n, anchor = null) {
        const cur = this.zoom_to;
        let i = py.min(py.range(ZOOMS.length), j => Math.abs(ZOOMS[j] - cur));
        i = Math.max(0, Math.min(ZOOMS.length - 1, i + n));
        this.zoom_to = ZOOMS[i];
        this.zoom_anchor = anchor;
    }

    zoom_tick(dt) {
        if (this.zoom === this.zoom_to) return;
        const z = this.zoom, t = this.zoom_to;
        // exponentially toward the target (~0.12 s), in the logarithm - equally fast both ways
        const k = 1.0 - math.exp(-dt / 0.045);
        let nz = math.exp(math.log(z) + (math.log(t) - math.log(z)) * k);
        if (Math.abs(nz - t) < 0.004) nz = t;
        this.set_zoom(nz, this.zoom_anchor);
    }

    /** Wheel: up/down - zoom around the cursor (DE); a sideways shift (trackpad) - scrolling. */
    on_wheel(e) {
        if (this.ctl_wheel(e)) return;           // Ctrl+wheel - rotate the gate
        if (!gsettings.get('wheel_zoom', true)) {
            this.cam_x -= e.x * 40 / this.zoom;
            this.cam_y -= e.y * 40 / this.zoom;
            this.clamp_cam();
            return;
        }
        if (e.x) {
            this.cam_x -= e.x * 40 / this.zoom;
            this.clamp_cam();
        }
        let dy = py.getattr(e, 'precise_y', e.y) || 0.0;
        if (py.getattr(e, 'flipped', false)) dy = -dy;
        this.wheel_acc = ((this.wheel_acc > 0) === (dy > 0) ? this.wheel_acc : 0.0) + dy;
        const n = _int(this.wheel_acc);         // a trackpad sends fractions - a step per every full "notch"
        if (n) {
            this.wheel_acc -= n;
            this.zoom_step(n, pygame.mouse.get_pos());
        }
    }

    // ============================================================ loop
    /** The main loop: one frame per animation frame (pygame.run_loop); returns the loop's promise. */
    run() {
        return pygame.run_loop(() => {
            if (!this.running) {
                pygame.quit();
                return false;
            }
            const dt = Math.min(this.clock.tick(_int(gsettings.get('fps_limit', FPS) || FPS)) / 1000.0, 0.05);
            for (const e of pygame.event.get()) this.on_event(e);
            if (this.state === 'menu') {
                this.draw_menu();
            } else if (this.state === 'loading') {
                this.loading_frame();        // screens.py: the loading screen (the world is built in steps)
            } else if (this.state === 'stats') {
                this.draw_stats();           // screens.py: the achievements after the match
            } else {
                this.update(dt);
                this.after_update(dt);       // screens.py: autosave
                this.draw();
            }
            this.update_cursor();
            this.audio.update(this, dt);
            this.audio.draw_popup(this.screen);
            this.cursors.draw(this.screen);      // the software cursor - last, by the current mouse position
            pygame.display.flip();
            return true;
        });
    }

    update(dt) {
        const w = this.world;
        // world events per frame (sound/effects hook in here)
        this.events = w.events.slice();
        w.events.length = 0;
        this.ctl_update();
        this.zoom_tick(dt);
        this.scroll(dt);
        if (!this.paused && !this.help && w.winner == null) {
            const sdt = dt * this.speed;
            const steps = Math.max(1, _int(math.ceil(sdt / 0.034)));
            for (let i = 0; i < steps; i++) w.update(sdt / steps);
        }
        this.selected = this.selected.filter(e => e.alive);
        this.markers = this.markers.filter(m => w.time - m[3] < 1.0);
    }

    scroll(dt) {
        const keys = pygame.key.get_pressed();
        // the on-screen scroll speed is the same at any zoom
        const sp = 1000 * dt * Number(gsettings.get('scroll_speed', 1.0)) / this.zoom;
        const [mx, my] = pygame.mouse.get_pos();
        const focused = pygame.mouse.get_focused() && gsettings.get('edge_scroll', true);
        if (keys[pygame.K_LEFT] || (focused && mx <= 2)) this.cam_x -= sp;
        if (keys[pygame.K_RIGHT] || (focused && mx >= SCREEN_W - 3)) this.cam_x += sp;
        if (keys[pygame.K_UP] || (focused && my <= 2)) this.cam_y -= sp;
        if (keys[pygame.K_DOWN] || (focused && my >= SCREEN_H - 3)) this.cam_y += sp;
        this.clamp_cam();
    }

    // ============================================================ input
    on_event(e) {
        if (e.type === pygame.QUIT) {
            this.running = false;
            return;
        }
        // M / N toggle music / sound only when no text field (or key capture) owns the keyboard
        if (!(e.type === pygame.KEYDOWN && this.keyboard_captured()) && this.audio.handle(e)) return;
        if (this.state === 'menu') {
            this.menu_event(e);          // menu.py: the main menu, match setup, credits
            return;
        }
        if (this.state === 'loading' || this.state === 'stats') {
            this.screen_event(e);        // screens.py: the loading screen, achievements
            return;
        }
        const w = this.world;
        if (w.winner != null && !this.gameover_seen) {
            this.gameover_event(e);      // screens.py: "Victory/Defeat" -> achievements
            return;
        }
        if (this.overlay_event(e)) return;       // screens.py: F10 windows (save, load, settings...)
        if (e.type === pygame.KEYDOWN) {
            this.on_key(e);
        } else if (e.type === pygame.MOUSEBUTTONDOWN) {
            if (this.help) {
                if (e.button === 1) this.overlay_click(e.pos);       // hud.py: the match menu / close help
                else this.help = false;
                return;
            }
            if (e.button === 1) this.on_ldown(e.pos);
            else if (e.button === 3) this.on_rdown(e.pos);
            else if (e.button === 2) this.mid_drag = true;
        } else if (e.type === pygame.MOUSEBUTTONUP) {
            if (e.button === 1) this.on_lup(e.pos);
            else if (e.button === 2) this.mid_drag = false;
        } else if (e.type === pygame.MOUSEWHEEL) {
            this.on_wheel(e);
        } else if (e.type === pygame.MOUSEMOTION) {
            if (this.mid_drag) {
                this.cam_x -= e.rel[0] / this.zoom;
                this.cam_y -= e.rel[1] / this.zoom;
                this.clamp_cam();
            }
            if (this.mm_drag) this.minimap_jump(e.pos);
        }
    }

    mods() {
        return pygame.key.get_mods();
    }

    /** Browser-port addition: a text field (chat, save name, player name), key rebinding or a yes/no
     * confirmation takes the keyboard, so letter keys such as M / N reach it instead of the audio toggles. */
    keyboard_captured() {
        if (this.text_edit != null || this.key_capture != null) return true;
        if (this.state === 'menu' || this.state === 'loading' || this.state === 'stats') return false;
        const h = this.help;
        if (h === 'save' && this.saves_mode === 'save') return true;
        if (h === 'confirm') return true;
        return !h && this.window === 'chat';
    }

    on_key(e) {
        if (this.hud_key(e)) return;             // hud.py: chat, F4 score, F5 tree, F11 clock, PgUp history
        const k = e.key;
        if (k === pygame.K_F1) {
            this.help = this.help !== true;
            return;
        }
        if (k === pygame.K_F2) {
            this.help = this.help === 'civ' ? false : 'civ';
            return;
        }
        if (k === pygame.K_F10) {
            this.help = this.help === 'menu' ? false : 'menu';
            return;
        }
        if (this.ctl_key(k)) return;             // controls.py: groups, idle, jumps, Del, Backspace, F3
        if (k === pygame.K_ESCAPE) {        // DE: Esc does not pause (pause - F3)
            this.line_start = null;
            if (this.help) this.help = false;
            else if (this.placing) this.placing = null;
            else if (this.selected.length) this.selected = [];
            return;
        }
        if (this.defense_key(k)) return;
        if (k === pygame.K_p || k === pygame.K_PAUSE) {
            this.paused = !this.paused;
            return;
        }
        if ([pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS, pygame.K_MINUS, pygame.K_KP_MINUS].includes(k)) {
            let i = py.min(py.range(SPEEDS.length), j => Math.abs(SPEEDS[j] - this.speed));
            i += [pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS].includes(k) ? 1 : -1;
            this.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))];
            return;
        }
        if (k === pygame.K_SPACE) {
            if (this.selected.length) this.jump_to(...this.selected[0].center());
            return;
        }
        const name = pygame.key.name(k).toUpperCase();
        if (name.length === 1 && HOTKEYS.includes(name)) {
            for (const bt of this.get_buttons()) {
                if (bt['key'] === name) {
                    this.press_button(bt);
                    return;
                }
            }
        }
    }

    in_view(pos) {
        return this.hud_view(pos);       // the world is visible between the bottom panels too (hud.py)
    }

    // ---- minimap (diamond)
    mm_rect() {
        return MM_RECT;
    }

    mm_to_world(pos) {
        const r = this.mm_rect();
        const w = this.world;
        const ix = (pos[0] - r.left) / r.w * this.iso_tw;
        const iy = (pos[1] - r.top) / r.h * this.iso_th;
        const [x, y] = from_iso(ix, iy, this.iso_ox);
        return [Math.max(0, Math.min(w.W * TILE - 1, x)), Math.max(0, Math.min(w.H * TILE - 1, y))];
    }

    world_to_mm(x, y) {
        const r = this.mm_rect();
        const [ix, iy] = to_iso(x, y, this.iso_ox);
        return [r.left + ix / this.iso_tw * r.w, r.top + iy / this.iso_th * r.h];
    }

    mm_hit(pos) {
        const r = this.mm_rect();
        const dx = Math.abs(pos[0] - r.centerx) / (r.w / 2);
        const dy = Math.abs(pos[1] - r.centery) / (r.h / 2);
        return dx + dy <= 1.0;
    }

    minimap_jump(pos) {
        this.center_on(...this.mm_to_world(pos));
    }

    // ---- mouse
    on_ldown(pos) {
        if (this.hud_click(pos)) return;         // hud.py: top, panels, minimap, windows, signal
        if (this.order_mode) {
            this.order_click(pos);       // controls.py: patrol, guard, follow, attack-move / attack ground
            return;
        }
        if (this.placing) {
            if (!this.place_down(pos)) this.try_place(pos);
            return;
        }
        this.drag = pos;
    }

    on_lup(pos) {
        this.mm_drag = false;
        if (this.line_start != null) {
            this.place_up(pos);
            return;
        }
        if (this.drag == null) return;
        const w = this.world;
        const [x0, y0] = this.drag;
        this.drag = null;
        const m = this.mods();
        const shift = m & pygame.KMOD_SHIFT;
        const ctrl = m & (pygame.KMOD_CTRL | pygame.KMOD_META);
        if (Math.abs(pos[0] - x0) < 5 && Math.abs(pos[1] - y0) < 5) {
            const e = this.entity_at(pos);
            const now = pygame.time.get_ticks();
            const dbl = now - this.last_click[0] < 350 && e === this.last_click[1];
            this.last_click = [now, e];
            this.click_select(e, shift, ctrl, dbl);      // controls.py: Shift/Ctrl - add/remove, double - a line
            if (e != null) w.emit('select', ...e.center(), 0, e.kind);
        } else {
            const r = new pygame.Rect(Math.min(x0, pos[0]), Math.min(y0, pos[1]), Math.abs(pos[0] - x0), Math.abs(pos[1] - y0));
            const first = this.box_select(r, shift);           // controls.py: top to bottom, up to 60
            if (first != null) w.emit('select', first.x, first.y, 0, first.kind);
        }
    }

    on_screen(u) {
        const [sx, sy] = this.w2s(u.x, u.y);
        return 0 <= sx && sx < SCREEN_W && TOP_H <= sy && sy < SCREEN_H - PANEL_H;
    }

    entity_at(pos) {
        const w = this.world;
        const spos = pos;
        pos = this.to_canvas(pos);       // comparison with figures and sprites - in canvas coordinates (scale 1)
        // units and animals - by the opaque pixels of the drawn frame (DE: a click on the body), front to back;
        // an own unit in an overlap outweighs a foreign one (09 - #41-45)
        const px = _int(pos[0]), py_ = _int(pos[1]);
        let enemy = null;
        for (let i = this.drawn_u.length - 1; i >= 0; i--) {
            const [rect, u, surf] = this.drawn_u[i];
            if (rect.collidepoint(pos)) {
                let a;
                try {
                    a = surf.get_at([px - rect.x, py_ - rect.y])[3];
                } catch (e) {
                    if (!(e instanceof py.IndexError)) throw e;
                    continue;
                }
                if (a > 120) {
                    if (u.owner === 0) return u;
                    if (enemy == null) enemy = u;
                }
            }
        }
        if (enemy != null) return enemy;
        let best = null, bd = 1e9;
        const arow = w.amat[0];
        const urect = this._urect;
        for (const u of w.units.concat(w.animals)) {
            if (!arow[u.owner] && !w.visible_px(u.x, u.y)) continue;
            let [sx, sy] = this.w2c(u.x, u.y);
            const us = u instanceof Animal ? null : _uset(u, this.civ_of(u.owner));
            if (us != null) {
                // margin: a "radius x height" column around the feet, but no farther than +-4 px from the drawn frame
                let fr = urect.get(u);
                if (fr != null) {
                    fr = new pygame.Rect(sx + fr[0], sy + fr[1], fr[2], fr[3]);
                    if (!fr.inflate(8, 8).collidepoint(pos)) continue;
                    sx = fr.centerx;
                }
                const h = us.bh + 4;
                const up = sy - pos[1];
                const hw = Math.max(u.radius * 1.1 + 4, h * 0.28);
                if (fr != null || (-8 <= up && up <= h + 4 && Math.abs(pos[0] - sx) <= hw)) {
                    let d = Math.abs(pos[0] - sx) + Math.abs(up - h * 0.5) * 0.3;
                    if (u.owner !== 0) d += 1e5;        // DE: an own unit in an overlap always outweighs a foreign one
                    if (d < bd) [bd, best] = [d, u];
                }
                continue;
            }
            let d = math.hypot(sx - pos[0], sy - 10 - pos[1]);
            if (d < u.radius * 1.2 + 8) {
                if (u.owner !== 0) d += 1e5;
                if (d < bd) [bd, best] = [d, u];
            }
        }
        if (best) return best;
        // sprites of buildings and resources - front to back, by pixels
        for (let i = this.drawn.length - 1; i >= 0; i--) {
            const [rect, ent, surf] = this.drawn[i];
            if (rect.collidepoint(pos)) {
                const lx = _int(pos[0] - rect.x), ly = _int(pos[1] - rect.y);
                if (surf.get_at([lx, ly])[3] > 120) return ent;      // a translucent shadow does not catch a click
            }
        }
        const [wx, wy] = this.s2w(...spos);
        const tx = _int(py.floordiv(wx, TILE)), ty = _int(py.floordiv(wy, TILE));
        if (0 <= tx && tx < w.W && 0 <= ty && ty < w.H) {
            const b = w.floor[ty][tx];
            if (b != null && b.seen) return b;
        }
        return null;
    }

    on_rdown(pos) {
        if (this.order_mode) {             // right click cancels the order mode
            this.order_mode = null;
            this.order_pts = [];
            return;
        }
        if (this.placing) {
            this.placing = null;
            this.line_start = null;
            return;
        }
        if (this.hud_rclick(pos)) return;        // hud.py: right click on the minimap - an order, on the panels - nothing
        const [wx, wy] = this.s2w(...pos);
        this.command(wx, wy, this.entity_at(pos));
    }

    /** Right click on the map / minimap. Shift - an order into the queue (waypoints, chains of tasks). */
    command(wx, wy, target) {
        const units = this.selected.filter(u => u instanceof Unit && u.owner === 0 && u.alive);
        const queue = this.queue_mode();
        if (!queue) for (const u of units) orders.clear(u);
        this._queue = queue;
        try {
            this._command(units, wx, wy, target);
        } finally {
            this._queue = false;
        }
    }

    _command(units, wx, wy, target) {
        const w = this.world;
        const o = (u, item) => this.o(u, item);
        if (units.length && naval.ui_command(this, w, units, wx, wy, target)) return;
        // units with their own order (the trade cart): d['command'](unit, world, target, x, y)
        const special = units.filter(u => py.get(u.d, 'command', null));
        if (special.length) {
            for (const u of special) u.d['command'](u, w, target, wx, wy);
            units = units.filter(u => !py.get(u.d, 'command', null));
            if (!units.length) {
                this.markers.push([wx, wy, [255, 220, 90], w.time]);
                w.emit('command', wx, wy, 0, 'move');
                return;
            }
        }
        if (units.length) {
            if (target instanceof Animal) {
                for (const u of units) {
                    if (target.den != null) {          // a wolf: not game - only to be hit
                        o(u, !target.dead ? ['attack', target] : ['move', target.x, target.y]);
                    } else if (u.kind === 'villager') {
                        o(u, ['gather', target]);
                    } else if (!target.dead && (target.kind !== 'sheep' || w.hostile(0, target.owner))) {
                        o(u, ['attack', target]);
                    } else {
                        o(u, ['move', target.x, target.y]);
                    }
                }
                this.markers.push([wx, wy, [120, 255, 120], w.time]);
                w.emit('command', wx, wy, 0, 'gather');
                return;
            }
            if (this.relic_command(units, target, wx, wy)) return;       // monks: a relic (game/relics.py)
            if (this.repair_command(units, target, wx, wy)) return;      // controls.py: repair by villagers
            if (this.garrison_command(units, target, wx, wy)) return;
            const monks = units.filter(u => py.get(u.d, 'monk', null));
            if (monks.length && target instanceof Unit && target.owner >= 0 && w.allied(0, target.owner)
                && target.hp < target.max_hp) {
                for (const u of monks) o(u, ['heal', target]);
                this.markers.push([wx, wy, [120, 255, 120], w.time]);
                w.emit('command', wx, wy, 0, 'heal');
                units = units.filter(u => !py.get(u.d, 'monk', null));
                if (!units.length) return;
            }
            if (target != null && w.hostile(0, target.owner)) {
                for (const u of units) o(u, ['attack', target]);
                this.markers.push([wx, wy, [255, 80, 60], w.time]);
                w.emit('command', wx, wy, 0, 'attack');
                return;
            }
            const vils = units.filter(u => u.kind === 'villager');
            const rest = units.filter(u => u.kind !== 'villager');
            if (target instanceof Node && vils.length) {
                for (const u of vils) o(u, ['gather', target]);
                this.markers.push([wx, wy, [120, 255, 120], w.time]);
                this.group_move(rest, wx, wy);
                w.emit('command', wx, wy, 0, 'gather');
                return;
            }
            if (target instanceof Building && target.owner === 0 && vils.length) {
                if (!target.complete) {
                    for (const u of vils) o(u, ['build', target]);
                } else if (target.kind === 'farm') {
                    o(vils[0], ['gather', target]);
                    this.group_move(vils.slice(1), wx, wy);
                } else if (py.get(target.d, 'drop', null)) {
                    for (const u of vils) {
                        if (u.carry > 0 && py.contains(target.d['drop'], u.carry_res)) o(u, ['return', target]);
                        else o(u, ['move', wx, wy]);
                    }
                } else {
                    this.group_move(vils, wx, wy);
                }
                this.markers.push([wx, wy, [120, 255, 120], w.time]);
                this.group_move(rest, wx, wy);
                w.emit('command', wx, wy, 0, 'work');
                return;
            }
            this.group_move(units, wx, wy);
            this.markers.push([wx, wy, [255, 255, 255], w.time]);
            w.emit('command', wx, wy, 0, 'move');
        } else {
            // the rally point of all selected buildings; Shift - one more point (DE: several rally points)
            for (const b of this.selected.filter(s => s instanceof Building && s.owner === 0 && py.get(s.d, 'trains', null))) {
                const new_ = target != null ? target : [wx, wy];
                if (this._queue && b.rally != null) {
                    const prev = Array.isArray(b.rally) ? b.rally : b.rally.center();
                    b.rally_pts = (py.getattr(b, 'rally_pts', null) || []).concat([prev]);
                } else {
                    b.rally_pts = null;
                }
                b.rally = new_;
                this.markers.push([wx, wy, [255, 220, 90], w.time]);
            }
        }
    }

    group_move(units, wx, wy) {
        this.form_move(units, wx, wy);           // controls.py: formation and shared speed
    }

    // ---- construction
    place_tile(pos) {
        const [wx, wy] = this.s2w(...pos);
        const s = BUILDINGS[this.placing]['size'];
        return [py.round(wx / TILE - s / 2), py.round(wy / TILE - s / 2)];
    }

    try_place(pos) {
        const w = this.world;
        const p = w.players[0];
        const kind = this.placing;
        const [tx, ty] = this.place_tile(pos);
        if (!w.can_place(kind, tx, ty, 0)) {
            w.msg(i18n.t('msg.cannot_build_here'), [255, 150, 90]);
            return;
        }
        if (!p.pay(p.cost_of('bld', kind))) {
            w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
            this.placing = null;
            return;
        }
        const b = w.place_building(kind, 0, tx, ty);
        const shift = this.mods() & pygame.KMOD_SHIFT;
        for (const u of this.selected) {
            if (u instanceof Unit && u.kind === 'villager' && u.owner === 0) {
                // Shift: constructions - in the order of laying (a queue), the first one - at once
                const q = !!shift && (u.state === 'build' || (u.orders || []).some(it => it[0] === 'build'));
                orders.issue(u, w, ['build', b], q);
            }
        }
        if (!(this.mods() & pygame.KMOD_SHIFT) || !p.afford(p.cost_of('bld', kind))) this.placing = null;
    }

    // ---- buttons
    // The 5x3 command grid (hotkeys HOTKEYS). If there are more items than fit, the last
    // cell is a "page" button (it flips), and the permanent buttons (stop) stand before it on every page.
    /** items / fixed - lists of dict(icon, act, ok, tip[, slot]). Returns buttons with rect and key (hud.grid_layout). */
    layout_buttons(items, fixed = []) {
        return this.grid_layout(items, fixed);
    }

    get_buttons() {
        const w = this.world;
        const p = w.players[0];
        const sel = this.selected.filter(e => e.alive && e.owner === 0);
        if (!sel.length) return [];
        // the selection changed - flip from the first page
        const key = [sel[0].kind, sel[0] instanceof Unit];
        if (!py.eq(key, this.cmd_key)) {
            this.cmd_key = key;
            this.cmd_page = 0;
        }
        const units = sel.filter(e => e instanceof Unit);
        let items = [];
        if (units.length) {
            if (this.army_selection(units)) {
                // army: the DE grid (orders, stances, stop, formations) - controls.py
                const extra = naval.unit_buttons(w, units);
                const packs = units.filter(u => py.get(u.d, 'pack', null));
                if (packs.length) {
                    const goal = !packs.every(u => u.packed);
                    extra.push({
                        icon: ['x', goal ? 'treb_pack' : 'treb_up'],
                        act: ['pack', goal], ok: true,
                        tip: [goal ? i18n.t('hud.pack') : i18n.t('hud.unpack'), {},
                            goal ? i18n.t('hud.pack_desc') : i18n.t('hud.unpack_desc')],
                    });
                }
                return this.army_buttons(units, extra);
            }
            const vil = units.some(u => u.kind === 'villager');
            if (vil) {
                items = items.concat(this.villager_items(p));     // hud.py: the "economy" / "military" pages (DE)
                if (this.build_page) return this.layout_buttons(items);
            }
            items = items.concat(naval.unit_buttons(w, units));
            const packs = units.filter(u => py.get(u.d, 'pack', null));
            if (packs.length) {
                // trebuchet: pack (to move) / unpack (to fire)
                items.push({ icon: ['x', 'treb_pack'], act: ['pack', true], ok: true,
                    tip: [i18n.t('hud.pack'), {}, i18n.t('hud.pack_desc')] });
                items.push({ icon: ['x', 'treb_up'], act: ['pack', false], ok: true,
                    tip: [i18n.t('hud.unpack'), {}, i18n.t('hud.unpack_desc')] });
            }
            const stop = { icon: ['stop', null], act: ['stop', null], ok: true, tip: [i18n.t('hud.stop'), {}, i18n.t('hud.stop_desc')] };
            if (vil) stop['slot'] = 9;
            return this.layout_buttons(items, [stop]);
        }
        const b = sel[0];
        if (!(b instanceof Building) || !b.complete) return [];
        for (const base_kind of py.get(b.d, 'trains', [])) {
            const uk = p.current(base_kind);
            if (!p.allows(base_kind, b.kind) || !p.allows(uk)) continue;        // foreign unique units and what the civilization cannot use - not shown
            const d = UNITS[uk];
            const cost = p.cost_of('unit', uk);
            const [can, why] = w.unit_state(p, uk);
            const locked = !can;
            const tip = [d['name'], cost, d['desc'], ['dim', i18n.t('hud.shift_5')]];
            if (locked) tip.push(['red', why]);
            items.push({ icon: ['u', uk], act: ['train', b, uk], ok: !locked && p.afford(cost) && b.queue.length < 15, tip });
        }
        for (const tk of py.get(b.d, 'techs', [])) {
            if (py.contains(p.techs, tk) || !p.allows(tk)) continue;
            if (AGE_TECHS.includes(tk) && TECHS[tk]['age'] !== p.age && !py.contains(p.researching, tk)) continue;
            const t = TECHS[tk];
            // the next step of a chain (req) appears when the previous one is researched or being researched
            if (as_tuple(py.get(t, 'req', [])).some(r => !py.contains(p.techs, r) && !py.contains(p.researching, r))) continue;
            const cost = p.cost_of('tech', tk);
            const [ok, why] = w.tech_state(p, tk);
            const tip = [t['name'], cost, t['desc']];
            if (!ok) tip.push(['red', why]);
            items.push({ icon: ['t', tk], act: ['research', b, tk], ok: !!ok && p.afford(cost), tip });
        }
        items = items.concat(this.defense_buttons(b));
        const extra = py.get(b.d, 'buttons', null);     // buttons from content: fn(game, building, player) -> items (market, mill)
        if (extra) items = items.concat(extra(this, b, p));
        return this.layout_buttons(this.building_slots(b, p, items));    // hud.py: button places as in DE
    }

    press_button(bt) {
        this.audio.click();
        const w = this.world;
        const p = w.players[0];
        const act = bt['act'];
        if (this.army_press(act) || this.defense_press(act)) return;     // controls.py: stop, stances, formations, orders
        if (act[0] === 'page') {
            this.cmd_page += 1;
        } else if (act[0] === 'call') {
            act[1](this);
        } else if (act[0] === 'place') {
            const d = BUILDINGS[act[1]];
            if (w.build_age(p, act[1]) > p.age) {
                w.msg(i18n.t('msg.need_age', { age: AGE_NAMES[d['age']] }), [255, 150, 90]);
            } else if (!p.afford(p.cost_of('bld', act[1]))) {
                w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
            } else {
                this.placing = act[1];
            }
        } else if (act[0] === 'unload') {
            naval.press_unload(w, this.selected.filter(u => u instanceof Unit && u.owner === 0));
        } else if (act[0] === 'train') {
            const b = act[1], uk = p.current(act[2]);
            const [can, why] = w.unit_state(p, uk);
            if (!can) {
                w.msg(why, [255, 150, 90]);
                return;
            }
            const n = (this.mods() & pygame.KMOD_SHIFT) ? 5 : 1;
            for (let i = 0; i < n; i++) {
                if (b.queue.length >= 15) break;
                if (!p.pay(p.cost_of('unit', uk))) {
                    w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
                    break;
                }
                b.queue.push(['unit', uk]);
            }
        } else if (act[0] === 'research') {
            const b = act[1], tk = act[2];
            const [ok, why] = w.tech_state(p, tk);
            if (!ok) {
                w.msg(why, [255, 150, 90]);
            } else if (!p.pay(p.cost_of('tech', tk))) {
                w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
            } else {
                b.queue.push(['tech', tk]);
                p.researching.add(tk);
            }
        }
    }

    // ============================================================ drawing
    /** Sheets of sprites of kinds that players can train right now - into background preloading (without a hitch on
     *  a unit's first appearance). Once per _PRELOAD_EVERY seconds of real time; conversion into surfaces -
     *  sprites3d.pump() no longer than 2 ms per frame. */
    preload_units() {
        const now = time.perf_counter();
        if (now >= py.getattr(this, '_preload_t', 0.0)) {
            this._preload_t = now + this._PRELOAD_EVERY;
            const w = this.world;
            const seen = new Set();
            for (const b of w.buildings) {
                const key = b.owner + '|' + b.kind;
                if (seen.has(key) || !b.complete || b.owner < 0 || b.owner >= w.players.length) continue;
                seen.add(key);
                const p = w.players[b.owner];
                const civ = p.civ;
                for (const base_kind of py.get(b.d, 'trains', [])) {
                    const uk = p.current(base_kind);
                    if (!p.allows(base_kind, b.kind) || !p.allows(uk)) continue;
                    sprites3d.request(uk, civ);
                    if (uk === 'villager') sprites3d.request(uk, civ, true);
                }
            }
        }
        sprites3d.pump(0.002);
    }

    draw() {
        this.screen.fill([0, 0, 0]);
        if (sprites3d.units_index() != null) this.preload_units();
        this.draw_world();
        this.draw_top();
        this.draw_panel();
        controls_draw.draw_panel_overlay(this);     // signals on the minimap, the order-mode hint
        this.draw_messages();
        this.draw_overlays();            // hud.py: windows (objectives, chat, diplomacy, tree), help, the match menu
        if (this.world.winner != null) {
            this.draw_gameover();
        } else if (this.paused) {
            this.text(i18n.t('keys.pause').toUpperCase(), [py.floordiv(SCREEN_W, 2), TOP_H + 60], 'xl', [255, 240, 200], 'center');
        }
    }

    diamond(tx, ty, w, h) {
        return [this.w2s(tx * TILE, ty * TILE), this.w2s((tx + w) * TILE, ty * TILE),
            this.w2s((tx + w) * TILE, (ty + h) * TILE), this.w2s(tx * TILE, (ty + h) * TILE)];
    }

    /** The world under the panels. At a scale != 1 - onto a canvas view/zoom (in the former coordinates), then stretched. */
    draw_world() {
        const z = this.zoom;
        const mp = pygame.mouse.get_pos();
        if (z === 1.0) {
            this._draw_world_at(this.screen, SCREEN_W, SCREEN_H - TOP_H, mp);
        } else {
            const cw = Math.max(1, _int(py.round(SCREEN_W / z)));
            const ch = Math.max(1, _int(py.round((SCREEN_H - TOP_H) / z)));
            let cv = this._canvas;
            if (cv == null || !py.eq(cv.get_size(), [cw, TOP_H + ch])) {
                cv = this._canvas = new pygame.Surface([cw, TOP_H + ch]).convert(this.screen);
            }
            const real = this.screen;
            [this.screen, this._cv] = [cv, true];
            try {
                if (this.iso_tw < cw || this.iso_th < ch) cv.fill([0, 0, 0]);     // the map is smaller than the view - the margins around are black
                this._draw_world_at(cv, cw, ch, this.to_canvas(mp));
            } finally {
                [this.screen, this._cv] = [real, false];
            }
            const dst = real.subsurface([0, TOP_H, SCREEN_W, SCREEN_H - TOP_H]);
            // zooming out - with smoothing (otherwise it shimmers); zooming in - with smoothing too, it is cheap (the canvas is smaller than the screen).
            // Stretch exactly by a factor z (otherwise near the screen edge objects drift by <= 1.2 px from w2s)
            const sw = _int(py.round(cw * z)), sh = _int(py.round(ch * z));
            if (py.eq([sw, sh], dst.get_size())) {
                pygame.transform.smoothscale(cv.subsurface([0, TOP_H, cw, ch]), dst.get_size(), dst);
            } else {
                dst.fill([0, 0, 0]);
                dst.blit(pygame.transform.smoothscale(cv.subsurface([0, TOP_H, cw, ch]), [sw, sh]), [0, 0]);
            }
        }
        // the selection box - in screen coordinates, over the stretched world
        if (this.drag) {
            const r = new pygame.Rect(Math.min(this.drag[0], mp[0]), Math.min(this.drag[1], mp[1]),
                Math.abs(mp[0] - this.drag[0]), Math.abs(mp[1] - this.drag[1]));
            if (r.w > 4 || r.h > 4) {
                this.screen.set_clip(new pygame.Rect(0, TOP_H, SCREEN_W, SCREEN_H - TOP_H));
                pygame.draw.rect(this.screen, [240, 240, 240], r, 1);
                this.screen.set_clip(null);
            }
        }
    }

    /** The world on scr: view width vw, height wh (below TOP_H); cmp - the cursor in scr coordinates. */
    _draw_world_at(scr, vw, wh, cmp) {
        const w = this.world;
        [this._vw, this._vh] = [vw, wh];
        const view = new pygame.Rect(0, TOP_H, vw, wh);
        scr.set_clip(view);
        scr.blit(this.terrain_surf, [0, TOP_H], new pygame.Rect(_int(this.cam_x), _int(this.cam_y), vw, wh));
        this.water_fx.draw(scr, _int(this.cam_x), _int(this.cam_y), TOP_H, vw, wh, w.time);
        const exp = w.explored;
        const vx0 = -80, vy0 = TOP_H - 140, vx1 = vw + 80, vy1 = TOP_H + wh + 60;
        this.drawn = [];
        this.drawn_u = [];
        this._urect = new Map();

        const onscr = (sx, sy) => vx0 < sx && sx < vx1 && vy0 < sy && sy < vy1;

        // traces on the ground
        for (const d of w.decals) {
            if (d[0] === 'rubble') {
                const tx = d[1], ty = d[2], s = d[3];
                const [sx, sy] = this.w2s((tx + s / 2) * TILE, (ty + s / 2) * TILE);
                if (!onscr(sx, sy)) continue;
                if (this.draw_rubble(d, sx, sy)) continue;
                const rr = new random.Random(tx * 99 + ty);
                for (let i = 0; i < s * s * 6; i++) {
                    const [x, y] = this.w2s((tx + rr.random() * s) * TILE, (ty + rr.random() * s) * TILE);
                    const col = rr.random() < 0.6 ? [92, 86, 78] : [60, 45, 35];
                    pygame.draw.circle(scr, col, [x, y], rr.randint(2, 5));
                }
            } else if (d[0] === 'stump') {
                const [, tx, ty] = d;
                const [x, y] = this.w2s((tx + 0.5) * TILE, (ty + 0.5) * TILE);
                if (!onscr(x, y)) continue;
                const st = sprites_extra.stump(tx, ty, Math.min(255, (60 - (w.time - d[4])) * 64));
                if (st != null) {
                    sprites_extra.blit(scr, st, x, y);
                } else {
                    pygame.draw.ellipse(scr, [95, 70, 40], [x - 6, y - 3, 12, 7]);
                    pygame.draw.ellipse(scr, [160, 125, 80], [x - 4, y - 2, 8, 4]);
                }
            } else if (d[0] === 'blast') {
                const [, x, y, owner, t] = d;
                const a = w.time - t;
                if (a < 1.2 && w.visible_px(x, y)) {
                    const [sx, sy] = this.w2s(x, y);
                    if (sprites_extra.group('blast') != null) continue;                // explosion frames - over objects, after projectiles
                    const r = 10 + a * 60;
                    pygame.draw.ellipse(scr, a < 0.3 ? [255, 200, 90] : [230, 230, 220], [sx - r, sy - r / 2, 2 * r, r], 3);
                    if (a < 0.4) pygame.draw.circle(scr, [255, 150, 40], [_int(sx), _int(sy - 10)], _int(18 - a * 30));
                }
            } else if (d[0] === 'body') {
                const x = d[1], y = d[2], owner = d[3], t = d[4];
                if (d.length > 5 && w.visible_px(x, y) && this.draw_body(d[5], x, y, owner, w.time - t, onscr)) continue;
                if (w.time - t < 20 && w.visible_px(x, y)) {
                    const [sx, sy] = this.w2s(x, y);
                    pygame.draw.ellipse(scr, shade(this.pcolor(owner), -60), [sx - 8, sy - 3, 16, 6]);
                    pygame.draw.circle(scr, [225, 215, 195], [_int(sx + 7), _int(sy - 1)], 2);
                }
            }
        }
        // farms - the ground layer
        const sel = new Set(this.selected);
        for (const b of w.buildings) {
            if (b.kind !== 'farm' || !b.seen) continue;
            const [sx, sy] = this.b2s(b);
            if (!onscr(sx, sy + 48)) continue;
            const level = b.complete ? Math.max(0, Math.min(4, _int(math.ceil(b.amount / Math.max(FARM_FOOD + 75, b.amount) * 4)))) : 0;
            const [spr, ox, oy] = this.farm_sprite(b.complete, level);
            scr.blit(spr, [sx - ox, sy - oy]);
            if (sel.has(b)) pygame.draw.polygon(scr, [255, 255, 255], this.diamond(b.tx, b.ty, b.w, b.h), 1);
            if (!b.complete) this.hpbar(sx - 30, sy + 40, 60, b.progress, 0);
        }
        // objects by depth
        const items = [];
        const W = w.W;
        const arow = w.amat[0];
        for (const n of w.nodes) {
            if (!n.alive || !exp[n.ty * W + n.tx]) continue;
            const [sx, sy] = this.w2s((n.tx + 0.5) * TILE, (n.ty + 0.5) * TILE);
            if (onscr(sx, sy)) items.push([(n.tx + n.ty + 1) * TILE, 0, n, sx, sy]);
        }
        for (const b of w.buildings) {
            if (b.walk || !b.seen) continue;
            const [sx, sy] = this.b2s(b);
            if (-300 < sx && sx < vw + 300 && TOP_H - 300 < sy && sy < TOP_H + wh) items.push([(b.tx + b.ty + (b.w + b.h) / 2) * TILE, 1, b, sx, sy]);
        }
        for (const u of w.units) {
            if (!arow[u.owner] && !w.visible_px(u.x, u.y)) continue;
            const [sx, sy] = this.w2s(u.x, u.y);
            if (onscr(sx, sy)) items.push([u.x + u.y, 2, u, sx, sy]);
        }
        for (const a of w.animals) {
            if (!arow[a.owner] && !w.visible_px(a.x, a.y)) continue;
            const [sx, sy] = this.w2s(a.x, a.y);
            if (onscr(sx, sy)) items.push([a.x + a.y - (a.dead ? 40 : 0), 3, a, sx, sy]);
        }
        for (const r of py.getattr(w, 'relics', [])) {      // relics on the ground (game/relics.py) - where explored
            if (r.carrier == null && r.holder == null && exp[r.ty * W + r.tx]) {
                const [sx, sy] = this.w2s(r.x, r.y);
                if (onscr(sx, sy)) items.push([r.x + r.y, 0, r, sx, sy]);
            }
        }
        for (const c of w.cliffs) {                  // cliffs - rock boulders by cells (game/terrain.py)
            if (exp[c[1] * W + c[0]]) {
                const [sx, sy] = this.w2s((c[0] + 0.5) * TILE, (c[1] + 0.5) * TILE);
                if (onscr(sx, sy)) items.push([(c[0] + c[1] + 1) * TILE, 0, c, sx, sy]);
            }
        }
        items.sort(_depth_cmp);
        const drawn_units = [];           // [how many objects are already in this.drawn, [sprite, x, y], color] - for silhouettes
        for (const [, typ, e, sx, sy] of items) {
            if (typ === 0) {
                if (Array.isArray(e)) {
                    this.draw_cliff(e, sx, sy);
                    continue;
                }
                if (e instanceof relics.Relic) {
                    relics.draw_ground(this, e, sx, sy);
                    continue;
                }
                this.draw_node(e, sx, sy, sel.has(e));
            } else if (typ === 1) {
                this.draw_building(e, sx, sy, sel.has(e));
            } else if (typ === 2) {
                this._ublit = null;
                this.draw_unit_w(e, sx, sy, sel.has(e));
                if (e.relic != null) relics.draw_carried(this, e, sx, sy);
                if (this._ublit != null) drawn_units.push([this.drawn.length, this._ublit, this.pcolor(e.owner)]);
            } else {
                if (sel.has(e)) {
                    const rw = e.radius * 2.4 + 8;
                    pygame.draw.ellipse(this.screen, [255, 255, 255], [sx - rw / 2, sy - rw / 4, rw, rw / 2], 1);
                }
                const [fx, fy] = e.face;
                const col = e.owner >= 0 ? this.pcolor(e.owner) : null;
                const us = sprites3d.unit_set('animal_' + e.kind, null);
                if (us != null) {
                    const dd = us.face(fx, fy);
                    if (e.dead) {
                        const a = py.get(us.anims, 'death', null);
                        if (a != null) {
                            const k = Math.min(a['n'] - 1, _int((w.time - e.dead_t) / (a['dur'] || 1.0) * a['n']));
                            if (k >= a['n'] - 1 && this.draw_carcass(e, fx, fy, sx, sy)) continue;
                            const [spr, ax, ay] = us.frame(us.index('death', dd, Math.max(0, k)), null);
                            scr.blit(spr, [_int(sx) - ax, _int(sy) - ay]);
                            continue;
                        }
                    } else {
                        const [name, k] = unit_pose(e, us, w.time, e.state === 'move' && (py.bool(e.path) || py.bool(e.dest)));
                        const [spr, ax, ay] = us.frame(us.index(name, dd, k), col);
                        scr.blit(spr, [_int(sx) - ax, _int(sy) - ay]);
                        this.note_unit(e, spr, _int(sx) - ax, _int(sy) - ay, sx, sy);
                        continue;
                    }
                }
                if (e.dead && this.draw_carcass(e, fx, fy, sx, sy)) continue;
                const r3 = e.dead ? null : (sprites3d.animal(e.kind, _addr(e) >> 4, e.face, col) ||
                    map_assets.animal(e.kind, _addr(e) >> 4, e.face));
                if (r3 != null) {
                    const [spr, ox, oy] = r3;
                    scr.blit(spr, [_int(sx - ox), _int(sy - HH - oy)]);
                    continue;
                }
                gfx.draw_animal(this.screen, e.kind, sx, sy, [fx - fy, 0], e.anim, e.state === 'move', e.dead, col, UNIT_K);
            }
        }
        if (drawn_units.length) this.draw_silhouettes(drawn_units);
        // projectiles
        for (const pr of w.projectiles) {
            if (pr.delay > 0 || !w.visible_px(pr.x, pr.y)) continue;
            const [tx, ty] = pr.aim();
            const total = math.hypot(tx - pr.sx, ty - pr.sy) || 1;
            const left = math.hypot(tx - pr.x, ty - pr.y);
            const prog = Math.max(0.0, Math.min(1.0, 1 - left / Math.max(total, left)));
            const arc = math.sin(prog * math.pi) * Math.min(40, total * 0.2);
            let [x, y] = this.w2s(pr.x, pr.y);
            const [x2, y2] = this.w2s(tx, ty);
            const dx = x2 - x, dy = y2 - y;
            const d = math.hypot(dx, dy) || 1;
            const shape = py.getattr(pr, 'shape', null);
            if (arc > 3 && !py.getattr(pr, 'ball', false) && shape !== 'stone' && shape !== 'ball') {
                // the arrow's shadow on the ground (DE: p_arrow_shadow) - a short dark stroke under the projectile
                const ux = dx / d * 4, uy = dy / d * 4;
                pygame.draw.line(scr, [52, 44, 28], [x - ux, y - uy], [x + ux, y + uy], 2);
            }
            y -= arc + 10;
            if (this.draw_projectile(pr, shape, x, y, prog, total, tx, ty)) continue;
            if (py.getattr(pr, 'ball', false) || shape === 'stone' || shape === 'ball') {
                // a mangonel/trebuchet stone, a cannon or ship cannonball
                const r = shape === 'stone' ? 4 : (py.getattr(pr, 'ball', false) ? 3 : 2);
                pygame.draw.circle(scr, shape !== 'stone' ? [60, 55, 50] : [120, 112, 100], [_int(x), _int(y)], r);
                continue;
            }
            const L = pr.javelin ? 12 : shape === 'bolt' ? 7 : 9;
            pygame.draw.line(scr, [60, 40, 25], [x - dx / d * L, y - dy / d * L], [x, y], 2);
            pygame.draw.line(scr, [230, 230, 230], [x - dx / d * 2, y - dy / d * 2], [x, y], 1);
        }
        // explosions - over objects
        if (sprites_extra.group('blast') != null) {
            for (const d of w.decals) {
                if (d[0] === 'blast' && w.time - d[4] < 1.2 && w.visible_px(d[1], d[2])) {
                    const [sx, sy] = this.w2s(d[1], d[2]);
                    if (onscr(sx, sy)) sprites_extra.blit(scr, sprites_extra.blast(w.time - d[4]), sx, sy);
                }
            }
        }
        this.draw_fog();
        // health bars
        for (const u of w.units) {
            if ((sel.has(u) || u.hp < u.max_hp) && (arow[u.owner] || w.visible_px(u.x, u.y))) {
                const [sx, sy] = this.w2s(u.x, u.y);
                if (onscr(sx, sy)) this.hpbar(sx - 12, sy - this.unit_top(u), 24, u.hp / u.max_hp, u.owner);
            }
        }
        for (const b of w.buildings) {
            if (b.walk || !((sel.has(b) || b.hp < b.max_hp) && b.seen && b.complete)) continue;
            const [sx, sy] = this.b2s(b);
            const [, , oy, bb] = this.bsprite_for(b);
            const bw = Math.min(90, Math.max(b.w, b.h) * 30);
            this.hpbar(sx - bw / 2, Math.max(TOP_H + 2, sy - oy + bb.top - 8), bw, b.hp / b.max_hp, b.owner);
        }
        // order markers
        for (const [mx, my, c, t] of this.markers) {
            const a = (w.time - t) / 1.0;
            const r = _int(12 * (1 - a)) + 3;
            const [sx, sy] = this.w2s(mx, my);
            pygame.draw.ellipse(scr, c, [sx - r, sy - r / 2, 2 * r, r], 2);
        }
        // rally point
        for (const s of this.selected) {
            if (s instanceof Building && s.owner === 0 && s.rally != null) {
                const r = s.rally;
                const [rx, ry] = Array.isArray(r) ? r : r.center();
                const a = this.w2s(...s.center());
                const b2 = this.w2s(rx, ry);
                pygame.draw.line(scr, [255, 230, 120], a, b2, 1);
                pygame.draw.line(scr, [80, 60, 40], b2, [b2[0], b2[1] - 18], 2);
                pygame.draw.polygon(scr, this.pcolor(0), [[b2[0], b2[1] - 18], [b2[0] + 11, b2[1] - 14],
                    [b2[0], b2[1] - 10]]);
            }
        }
        controls_draw.draw_world_overlay(this);     // group numbers, route flags, patrol, signals
        // building placement
        if (this.placing) {
            if (this.in_view(pygame.mouse.get_pos())) this.draw_ghost(cmp);
        }
        scr.set_clip(null);
    }

    draw_ghost(mp) {
        if (this.draw_defense_ghost(mp)) return;
        const scr = this.screen;
        const w = this.world;
        const kind = this.placing;
        const [tx, ty] = this.place_tile(mp);
        const s = BUILDINGS[kind]['size'];
        const ok = w.can_place(kind, tx, ty, 0);
        const [sx, sy] = this.w2s(tx * TILE, ty * TILE, terrain.footprint_z(w, tx, ty, s, s));
        const [spr, ox, oy] = this.bsprite(kind, 0, null, ...this.blook(kind, 0, tx, ty));
        const ghost = spr.copy();
        ghost.set_alpha(150);
        scr.blit(ghost, [sx - ox, sy - oy]);
        const pts = this.diamond(tx, ty, s, s);          // the corners - at their own height (a diamond along the slope)
        const minx = Math.min(...pts.map(p => p[0]));
        const miny = Math.min(...pts.map(p => p[1]));
        const ov = new pygame.Surface([_int(Math.max(...pts.map(p => p[0])) - minx) + 2, _int(Math.max(...pts.map(p => p[1])) - miny) + 2],
            pygame.SRCALPHA);
        pygame.draw.polygon(ov, ok ? [60, 255, 60, 80] : [255, 50, 50, 100], pts.map(p => [p[0] - minx, p[1] - miny]));
        scr.blit(ov, [minx, miny]);
        const rng = py.get(BUILDINGS[kind], 'rng', null) && w.players[0].stat('rng', kind, BUILDINGS[kind]['rng']);
        if (rng) {
            const [cx, cy] = this.w2s((tx + s / 2) * TILE, (ty + s / 2) * TILE);
            const R = (rng + s / 2) * TILE;
            pygame.draw.ellipse(scr, [255, 255, 255], [cx - R * 1.414, cy - R * 0.707, R * 2.828, R * 1.414], 1);
        }
    }

    draw_fog() {
        const w = this.world;
        if (this.fog_full_ver !== w.fog_version) {
            const MAP_W = w.W, MAP_H = w.H;
            this.fog_full_ver = w.fog_version;
            const n = MAP_W * MAP_H;
            const buf = new Uint8Array(n * 4);
            // we build the "visibility" (255 - visible, 130 - explored), beyond the map it is 0 -> solid darkness;
            // bytes 0/1 -> 0/255 and 0/130, then a bitwise OR (255 | 130 == 255) - per byte (the Python version ORs big ints)
            const vis = w.vis, ex = w.explored;
            for (let i = 0; i < n; i++) buf[i * 4 + 3] = _FOG_VIS[vis[i]] | _FOG_EXP[ex[i]];
            const small = pygame.image.frombuffer(buf, [MAP_W, MAP_H], 'RGBA');
            const sq = pygame.transform.smoothscale(small, [MAP_W * 4, MAP_H * 4]);
            const rot = pygame.transform.rotate(sq, -45);
            const fog = new pygame.Surface([py.floordiv(this.iso_tw, FOG_S), py.floordiv(this.iso_th, FOG_S)], pygame.SRCALPHA);
            fog.fill([0, 0, 0, 255]);
            fog.blit(pygame.transform.smoothscale(rot, fog.get_size()), [0, 0], null, pygame.BLEND_RGBA_SUB);
            terrain_gfx.warp_fog(fog, py.getattr(this, 'fog_rows', null));       // fog raised along the relief
            this.fog_full = fog;
            this.fog_view = null;
        }
        const rx = _int(py.floordiv(this.cam_x, FOG_S)), ry = _int(py.floordiv(this.cam_y, FOG_S));
        const vw = py.getattr(this, '_vw', SCREEN_W), vh = py.getattr(this, '_vh', SCREEN_H - TOP_H);
        const key = [rx, ry, this.fog_full_ver, vw, vh];
        if (this.fog_view == null || !py.eq(this.fog_view[0], key)) {
            const [fw, fh] = this.fog_full.get_size();
            const rw = Math.min(py.floordiv(_int(vw), FOG_S) + 2, fw - rx);
            const rh = Math.min(py.floordiv(_int(vh), FOG_S) + 2, fh - ry);
            const sub = this.fog_full.subsurface([rx, ry, rw, rh]);
            this.fog_view = [key, pygame.transform.smoothscale(sub, [rw * FOG_S, rh * FOG_S])];
        }
        this.screen.blit(this.fog_view[1], [rx * FOG_S - this.cam_x, ry * FOG_S - this.cam_y + TOP_H]);
    }

    hpbar(x, y, wdt, frac, owner) {
        frac = Math.max(0.0, Math.min(1.0, frac));
        pygame.draw.rect(this.screen, [25, 20, 20], [x - 1, y - 1, wdt + 2, 5]);
        const c = this.REL_BAR[this.relation(owner)];
        pygame.draw.rect(this.screen, c, [x, y, _int(wdt * frac), 3]);
    }

    /** A 0 A.D. fish: a school/large fish under water, rings spread above them; fading as it is depleted. */
    draw_fish(n, sx, sy, selected) {
        const t = this.world.time + n.var * 0.37 + n.tx * 0.13;
        const full = py.get(NODE_DEFS[n.kind], 'amount', null) || 1;
        const fr = sprites_extra.fish(n.kind, n.var + n.tx + n.ty, t, 110 + 145 * Math.min(1.0, n.amount / full));
        if (fr == null) return false;
        const scr = this.screen;
        if (selected) pygame.draw.polygon(scr, [255, 255, 255], this.diamond(n.tx, n.ty, 1, 1), 1);
        sprites_extra.blit(scr, sprites_extra.ripple(t), sx, sy);
        sprites_extra.blit(scr, fr, sx, sy);
        // a click is caught by the cell's diamond (the fish is translucent - it cannot be hit by pixels)
        let pk = _FISH_PICK[0];
        if (pk == null) {
            pk = _FISH_PICK[0] = new pygame.Surface([56, 28], pygame.SRCALPHA);
            pygame.draw.polygon(pk, [255, 255, 255, 255], [[28, 0], [56, 14], [28, 28], [0, 14]]);
        }
        this.drawn.push([new pygame.Rect(_int(sx) - 28, _int(sy) - 14, 56, 28), n, pk]);
        return true;
    }

    /** The depletion stage of a gold/stone vein: 0 - > 66 % of the stock, 1 - > 33 %, 2 - less. */
    static node_stage(n) {
        if (n.kind !== 'gold' && n.kind !== 'stone') return 0;
        const f = n.amount / (py.get(NODE_DEFS[n.kind], 'amount', null) || 1);
        return f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
    }

    /** A cliff boulder on the cell (tx, ty, variant); without the atlas - a procedural rock. */
    draw_cliff(c, sx, sy) {
        const r3 = sprites3d.cliff(c[2]);
        if (r3 != null) {
            const [spr, ox, oy] = r3;
            this.screen.blit(spr, [_int(sx - ox), _int(sy - HH - oy)]);
            return;
        }
        const rr = new random.Random(c[2]);
        const pts = [[sx - 30, sy + 6]];
        pts.push([sx - 22 + rr.randint(-4, 4), sy - 22]);
        pts.push([sx - 4, sy - 38 + rr.randint(-6, 6)]);
        pts.push([sx + 14, sy - 30 + rr.randint(-6, 6)]);
        pts.push([sx + 30, sy + 4], [sx, sy + 16]);
        pygame.draw.polygon(this.screen, [122, 108, 90], pts);
        pygame.draw.polygon(this.screen, [150, 136, 112], pts.slice(2, 5).concat([[sx + 4, sy]]));
        pygame.draw.lines(this.screen, [70, 60, 50], true, pts, 1);
    }

    draw_node(n, sx, sy, selected) {
        if (py.get(NODE_DEFS[n.kind], 'water', null) && this.draw_fish(n, sx, sy, selected)) return;
        const scr = this.screen;
        const r3 = n.kind === 'tree'
            ? (map_assets.tree(this.world, n.tx, n.ty, n.var) || sprites3d.tree(n.tx, n.ty, n.var))
            : ['gold', 'stone', 'berries'].includes(n.kind) ? sprites3d.node(n.kind, n.var, this.node_stage(n)) : null;
        let spr, pos;
        if (r3 != null) {
            let ox, oy;
            [spr, ox, oy] = r3;
            pos = [_int(sx - ox), _int(sy - HH - oy)];      // (ox, oy) - the top corner of the cell's diamond
        } else if (n.kind === 'tree') {
            spr = this.trees[n.var];
            const [ax, ay] = gfx.TREE_ANCHOR;
            pos = [_int(sx - ax), _int(sy - ay + 4)];
        } else {
            spr = this.node_spr[n.kind][py.mod(n.var, this.node_spr[n.kind].length)];
            if (py.get(NODE_DEFS[n.kind], 'anchor', null) === 'center') {
                pos = [_int(sx - spr.get_width() / 2), _int(sy - spr.get_height() / 2)];
            } else {
                pos = [_int(sx - spr.get_width() / 2), _int(sy - spr.get_height() + 12)];
            }
        }
        if (selected) pygame.draw.polygon(scr, [255, 255, 255], this.diamond(n.tx, n.ty, 1, 1), 1);
        const anim = py.get(NODE_DEFS[n.kind], 'anim', null);
        if (anim) anim(scr, n, sx, sy, this.world.time);
        scr.blit(spr, pos);
        this.drawn.push([new pygame.Rect(pos, spr.get_size()), n, spr]);
    }

    draw_building(b, sx, sy, selected) {
        const scr = this.screen;
        const [spr, ox, oy, bb] = this.bsprite_for(b);
        const x = sx - ox, y = sy - oy;
        if (selected) {
            const c = this.REL_SEL[this.relation(b.owner)];
            pygame.draw.polygon(scr, c, this.diamond(b.tx, b.ty, b.w, b.h), 1);
        }
        if (b.complete) {
            scr.blit(spr, [x, y]);
            this.drawn.push([new pygame.Rect(x, y, ...spr.get_size()), b, spr]);
            if (b.hit_t > 0 && this.world.time - b.hit_t < 0.1)
                pygame.draw.polygon(scr, [255, 255, 255], this.diamond(b.tx, b.ty, b.w, b.h), 1);
            if (b.hp <= b.max_hp * 0.75 && !this.draw_fire(b, sx, y + bb.top, bb.height) && b.hp < b.max_hp * 0.5) {
                const t = this.world.time;
                const cx = sx;
                const top = y + bb.top;
                for (let i = 0, n = b.hp > b.max_hp * 0.25 ? 2 : 4; i < n; i++) {
                    const fx = cx + (i - 1.5) * b.w * 9;
                    const fy = top + 20 + i * 6 - py.mod(t * 20 + i * 13, 20);
                    pygame.draw.circle(scr, [255, 140 + i * 20, 40], [_int(fx), _int(fy)], 5 - (i % 2));
                    pygame.draw.circle(scr, [90, 90, 90], [_int(fx + 3), _int(fy - 12)], 4);
                }
            }
            if (py.bool(b.garrison)) this.draw_garrison_badge(b, sx, y + bb.top);
        } else if (py.get(b.d, 'wall', null) && this.draw_wall_build(b, sx, sy, spr, ox, oy, bb)) {
            // drawn by defense_ui
        } else if (!py.get(b.d, 'wall', null) && this.bsprite(b.kind, b.owner, Math.min(2, _int(b.progress * 3)), 0,
            this.blook(b.kind, b.owner, b.tx, b.ty)[1]) != null) {
            // construction stages from 3D: foundation -> a third in scaffolding -> two thirds in scaffolding
            const [st, sox, soy] = this.bsprite(b.kind, b.owner, Math.min(2, _int(b.progress * 3)), 0,
                this.blook(b.kind, b.owner, b.tx, b.ty)[1]);
            scr.blit(st, [sx - sox, sy - soy]);
            this.drawn.push([new pygame.Rect(sx - sox, sy - soy, ...st.get_size()), b, st]);
            const pts = this.diamond(b.tx, b.ty, b.w, b.h);
            this.hpbar(sx - 30, pts[2][1] - 8, 60, b.progress, 0);
        } else {
            pygame.draw.polygon(scr, [140, 108, 70], this.diamond(b.tx, b.ty, b.w, b.h));
            pygame.draw.polygon(scr, [95, 70, 44], this.diamond(b.tx, b.ty, b.w, b.h), 2);
            const h = spr.get_height();
            const vis_h = _int((h - bb.top) * (0.08 + 0.92 * b.progress));
            if (vis_h > 0) {
                const part = spr.subsurface([0, h - vis_h, spr.get_width(), vis_h]).copy();
                part.set_alpha(200);
                scr.blit(part, [x, y + h - vis_h]);
            }
            const pts = this.diamond(b.tx, b.ty, b.w, b.h);
            const ph = 20 + 50 * b.progress;
            for (const p of pts.slice(1)) pygame.draw.line(scr, [160, 120, 70], p, [p[0], p[1] - ph], 3);
            pygame.draw.line(scr, [160, 120, 70], [pts[3][0], pts[3][1] - ph * 0.6],
                [pts[2][0], pts[2][1] - ph * 0.6], 2);
            pygame.draw.line(scr, [160, 120, 70], [pts[2][0], pts[2][1] - ph * 0.6],
                [pts[1][0], pts[1][1] - ph * 0.6], 2);
            this.drawn.push([new pygame.Rect(x, y, ...spr.get_size()), b, spr]);
            this.hpbar(sx - 30, pts[2][1] - 8, 60, b.progress, 0);
        }
    }

    // ---- small graphics from 0 A.D. (game/sprites_extra.py); false - no sprites, draw the old way
    /** Rubble: a heap by the building's size and material, for the first seconds it still burns, at the end it melts away. */
    draw_rubble(d, sx, sy) {
        const age = this.world.time - d[4];
        const kind = d.length > 5 ? d[5] : null;
        const s = d[3];
        const fr = sprites_extra.rubble(s, kind, Math.min(255, (this.RUBBLE_LIFE - age) / this.RUBBLE_FADE * 255));
        if (fr == null) return false;
        const scr = this.screen;
        sprites_extra.blit(scr, fr, sx, sy);
        if (age < this.RUBBLE_BURN) {
            const k = 1.0 - age / this.RUBBLE_BURN;
            const t = this.world.time;
            const rr = new random.Random(d[1] * 131 + d[2]);
            for (let i = 0; i < 1 + s; i++) {
                const ox = (rr.random() - 0.5) * s * 30;
                const oy = (rr.random() - 0.5) * s * 12;
                const ph = rr.random();
                if (i === 0) sprites_extra.blit(scr, sprites_extra.smoke(t, ph, 200 * k), sx + ox, sy + oy - 4);
                sprites_extra.blit(scr, sprites_extra.flame(t, ph, 255 * Math.min(1.0, k * 1.6)), sx + ox, sy + oy);
            }
        }
        return true;
    }

    /** A burning building, 3 stages as in DE: <= 75 % health - a small fire, <= 50 % - a medium one with smoke,
     *  <= 25 % - a strong one (the center has 6 seats of fire). */
    draw_fire(b, sx, top, height) {
        if (sprites_extra.group('flame') == null) return false;
        const t = this.world.time;
        const f = b.hp / Math.max(1, b.max_hp);
        const stage = f <= 0.25 ? 3 : f <= 0.5 ? 2 : 1;
        const big = (b.w >= 3 ? 1 : 0) + (b.w >= 4 && stage === 3 ? 1 : 0);
        const n = [1, 2, 4][stage - 1] + big;
        const rr = new random.Random(b.tx * 977 + b.ty * 31);
        const pts = [];
        for (let i = 0; i < n; i++) {
            const ox = (rr.random() - 0.5) * b.w * 26;
            const oy = top + height * (0.22 + rr.random() * 0.3);
            pts.push([sx + ox, oy, rr.random()]);
        }
        const scr = this.screen;
        if (stage >= 2) {
            for (const [x, y, ph] of pts.slice(0, stage - 1)) sprites_extra.blit(scr, sprites_extra.smoke(t, ph, 210), x, y - 6);
        }
        const a = stage === 1 ? 170 : 255;
        for (const [x, y, ph] of pts) sprites_extra.blit(scr, sprites_extra.flame(t, ph, a), x, y);
        return true;
    }

    /** A killed animal's carcass: whole -> butchered -> a skeleton as meat is taken from it. */
    draw_carcass(e, fx, fy, sx, sy) {
        const full = py.get(py.get(ANIMALS, e.kind, {}), 'food', null) || 1;
        const fr = sprites_extra.carcass(e.kind, e.amount / full, fx, fy);
        if (fr == null) return false;
        sprites_extra.blit(this.screen, fr, sx, sy);
        return true;
    }

    // ---- a unit's frame: box, height, the click list
    /** Remember a unit's drawn frame (a click by the body's pixels, a margin of +-4 px): the rect on the canvas and its
     *  offset from the feet point (the unit could have moved between the frame and the click). */
    note_unit(u, spr, x, y, sx, sy) {
        const r = new pygame.Rect(x, y, spr.get_width(), spr.get_height());
        this.drawn_u.push([r, u, spr]);
        this._urect.set(u, [x - sx, y - sy, r.w, r.h]);
    }

    /** The bounding box of a frame's opaque pixels (cached by surface - the sets' frames live in the USet cache). */
    frame_bbox(spr) {
        let bb = this._bbc.get(spr);
        if (bb == null) {
            if (this._bbc.size > 4096) this._bbc.clear();
            bb = spr.get_bounding_rect(128);
            this._bbc.set(spr, bb);
        }
        return bb;
    }

    /** [frame, ax, ay] of a unit in its current pose or null (no 3D set). */
    unit_frame(u) {
        const us = _uset(u, this.civ_of(u.owner));
        if (us == null) return null;
        let moving = u.state === 'move' || py.bool(u.path);
        moving = u.naval ? moving : (u.x !== u._px || u.y !== u._py);
        const [name, k] = unit_pose(u, us, this.world.time, moving);
        return us.frame(us.index(name, us.face(...u.face), k), this.pcolor(u.owner));
    }

    /** The height of the crown above the feet point in the current frame (health bar, group number): by the box of this
     *  direction's frame, not by the set's maximum (09 - #24-25: trebuchet +30, a fisher in a sail). */
    unit_top(u, pad = 6) {
        const fr = this.unit_frame(u);
        if (fr == null) return py.get(u.d, 'bar', null) || py.get(u.d, 'bar_h', null) || (u.cls === 'cav' ? 36 : 30);
        const [spr, ax, ay] = fr;
        const bb = this.frame_bbox(spr);
        if (bb.w === 0) return ay + pad;
        return ay - bb.top + pad;
    }

    /** A projectile sprite: an arrow/bolt/javelin is rotated along the tangent to the flight arc, stones and cannonballs tumble. */
    draw_projectile(pr, shape, x, y, prog, total, tx, ty) {
        let key;
        if (py.getattr(pr, 'ball', false)) key = 'ball';
        else if (shape === 'ball') key = 'shot';
        else key = ['stone', 'bolt', 'javelin'].includes(shape) ? shape : 'arrow';
        // the tangent to the screen trajectory: the straight line from the start to the target minus the arc sin(pi*prog)*A
        const [x0, y0] = this.w2s(pr.sx, pr.sy);
        const [x1, y1] = this.w2s(tx, ty);
        const amp = Math.min(40, total * 0.2);
        const dx = x1 - x0;
        const dy = y1 - y0 - amp * math.pi * math.cos(prog * math.pi);
        const fr = sprites_extra.projectile(key, dx, dy, this.world.time + (_addr(pr) & 7) * 0.1);
        if (fr == null) return false;
        sprites_extra.blit(this.screen, fr, x, y);
        return true;
    }

    /** A fallen unit: the death animation, then the last frame lies and melts. Machines and ships without a
     *  death animation settle and dissolve. true - drawn (or already melted). */
    draw_body(u, x, y, owner, age, onscr) {
        const us = _uset(u, this.civ_of(owner));
        if (us == null) return false;
        const [sx, sy] = this.w2s(x, y);
        if (!onscr(sx, sy)) return true;
        const d8 = us.face(...u.face);
        const a = py.get(us.anims, 'death', null);
        const col = this.pcolor(owner);
        let spr, ax, ay, alpha, sink;
        if (a != null) {
            const k = Math.min(a['n'] - 1, _int(age / (a['dur'] || 1.0) * a['n']));
            [spr, ax, ay] = us.frame(us.index('death', d8, k), col);
            alpha = age < this.BODY_HOLD ? 255 : _int(255 * Math.max(0.0, 1 - (age - this.BODY_HOLD) / this.BODY_FADE));
            sink = 0;
        } else {
            [spr, ax, ay] = us.frame(us.index('idle', d8, 0), col);
            const f = Math.min(1.0, age / 2.5);
            alpha = _int(255 * (1 - f));
            sink = _int(f * (u.naval ? 14 : 4));
        }
        if (alpha <= 0) return true;
        if (alpha < 255 || sink) {
            const h = spr.get_height() - sink;
            if (h <= 0) return true;
            spr = spr.subsurface([0, 0, spr.get_width(), h]).copy();
            spr.set_alpha(alpha);
        }
        this.screen.blit(spr, [_int(sx) - ax, _int(sy) - ay + sink]);
        return true;
    }

    /** A foam trail behind a moving ship (under the sprite). */
    ship_wake(u, us, sx, sy) {
        const [fx, fy] = u.face;
        const ex = fx - fy, ey = (fx + fy) / 2;
        const L = us.h * 0.9 + 10;
        const t = this.world.time;
        for (let i = 0; i < 3; i++) {
            const f = py.mod(t * 1.5 + i / 3, 1.0);
            const cx = sx - ex * L * (0.3 + f * 0.9), cy = sy - ey * L * (0.3 + f * 0.9);
            const r = 6 + f * 16;
            pygame.draw.ellipse(this.screen, [225, 238, 245], [cx - r, cy - r / 2, 2 * r, r], 1);
        }
    }

    /** A muzzle flash for firearm units and cannon ships, a jet of fire for fire ships. */
    shot_fx(u, us, sx, sy) {
        const d = u.d;
        const fire = py.get(d, 'fire', null);
        if (!(fire || py.get(d, 'shot', null) === 'ball' || py.get(d, 'siege', null))) return;
        const [fx, fy] = u.face;
        let ex = fx - fy, ey = (fx + fy) / 2;
        const n = math.hypot(ex, ey) || 1.0;
        ex = ex / n;
        ey = ey / n;
        const a = Math.min(1.0, u.swing / 0.3);
        const bh = us.bh;
        let reach, lift;
        if (u.naval) [reach, lift] = [us.h * 0.8 + 12, us.h * 0.35];
        else if (py.get(d, 'siege', null)) [reach, lift] = [us.h * 0.55 + 6, us.h * 0.45];
        else if (u.cls === 'cav') [reach, lift] = [bh * 0.55, bh * 0.86];         // a rider's musket at the shoulder
        else [reach, lift] = [bh * 0.6, bh * 0.84];           // the muzzle of an arquebus/hand cannon at the shoulder, a barrel length forward
        const x0 = sx + ex * reach, y0 = sy + ey * reach * (u.naval ? 0.8 : 0.5) - lift;
        const scr = this.screen;
        if (fire) {
            const x1 = x0 + ex * 34, y1 = y0 + ey * 22;
            pygame.draw.line(scr, [255, 150, 40], [x0, y0], [x1, y1], 5);
            pygame.draw.line(scr, [255, 235, 140], [x0, y0], [x1, y1], 2);
            return;
        }
        // smoke: puffs spread from the muzzle and rise
        for (let i = 0; i < 3; i++) {
            const r = _int(3 + (1 - a) * 8 + i * 2);
            const c = _int(170 + 60 * a);
            pygame.draw.circle(scr, [c, c - 4, c - 10], [_int(x0 + ex * i * 5), _int(y0 - i * 3 * (1 - a))], r);
        }
        if (a > 0.55) {
            // flash: a tongue of flame elongated along the barrel + a white core
            const k = (a - 0.55) / 0.45;
            const L = 6 + 10 * k;
            const px = -ey, py_ = ex;
            const tip = [x0 + ex * L, y0 + ey * L * 0.8];
            const w = 2.5 + 2.5 * k;
            pygame.draw.polygon(scr, [255, 170, 50], [[x0 + px * w, y0 + py_ * w], tip, [x0 - px * w, y0 - py_ * w]]);
            pygame.draw.circle(scr, [255, 235, 150], [_int(x0), _int(y0)], _int(2 + 2 * k));
            pygame.draw.circle(scr, [255, 255, 235], [_int(x0), _int(y0)], 1 + _int(k));
        }
    }

    draw_unit_w(u, sx, sy, selected) {
        const scr = this.screen;
        let moving = u.state === 'move' || py.bool(u.path);
        let col = this.pcolor(u.owner);
        if (u.hit_t > 0 && this.world.time - u.hit_t < 0.1) col = [255, 255, 255];
        const us = _uset(u, this.civ_of(u.owner));
        if (us != null) {
            // a ship at rest does not update _px - for it "moving" = a move order
            moving = u.naval ? moving : (u.x !== u._px || u.y !== u._py);
            const [name, k] = unit_pose(u, us, this.world.time, moving);
            const [fx, fy] = u.face;
            const [spr, ax, ay] = us.frame(us.index(name, us.face(fx, fy), k), col);
            const x = _int(sx) - ax, y = _int(sy) - ay;
            if (selected) {
                // selection ellipse: for machines and ships the origin of the 0 A.D. model is not at the body's center - by the frame's center
                let ex = sx;
                if (u.naval || u.cls === 'siege') {
                    const bb = this.frame_bbox(spr);
                    ex = x + (bb.left + bb.right) / 2;
                }
                const c = u.owner === 0 ? [120, 255, 120] : this.REL_SEL[this.relation(u.owner)];
                const rw = u.radius * 2.4 + 8;
                pygame.draw.ellipse(scr, c, [ex - rw / 2, sy - rw / 4, rw, rw / 2], 1);
            }
            if (u.naval && moving) this.ship_wake(u, us, sx, sy);
            scr.blit(spr, [x, y]);
            this._ublit = [spr, x, y];
            this.note_unit(u, spr, x, y, sx, sy);
            if (u.swing > 0) this.shot_fx(u, us, sx, sy);
            return;
        }
        if (selected) {
            const c = u.owner === 0 ? [120, 255, 120] : this.REL_SEL[this.relation(u.owner)];
            const rw = u.radius * 2.4 + 8;
            pygame.draw.ellipse(scr, c, [sx - rw / 2, sy - rw / 4, rw, rw / 2], 1);
        }
        const [fx, fy] = u.face;
        const face = [fx - fy, (fx + fy) / 2];
        const carry = u.carry >= 1 ? u.carry_res : null;
        if (u.naval) {
            gfx.draw_unit(scr, u.look(), col, sx, sy, face, u.anim, u.swing, UNIT_K, carry, moving);
            return;
        }
        // a figure from the cache: the pose is quantized (8 directions, 16 step phases, 10 swing steps) - we draw
        // the figure once onto a separate surface and then only copy it (otherwise ~20 draw calls per unit)
        const qf = _qface(face[0], face[1]);
        const qa = moving ? py.mod(py.round(py.mod(u.anim, _TAU) * _ANIM_Q), 16) : 0;
        const sw = u.swing;
        const qs = sw > 0 ? -_int(py.floordiv(-sw, 0.03)) : 0;          // upward: any swing > 0 stays a swing
        const key = [u.look(), col, qf, qa, qs, carry, moving];
        let hit = _USPR.get(py.tkey(key));
        if (hit == null) hit = _render_unit(key);
        const [spr, dx, dy] = hit;
        scr.blit(spr, [_int(sx) + dx, _int(sy) + dy]);
    }

    /** Units behind buildings and trees (DE): where a unit's body is covered by a sprite drawn later
     *  (closer to the viewer) - a translucent silhouette in the player's color. Intersections are found by boxes
     *  (Rect.collidelistall), per pixel - only for units that are really overlapped; masks are cached. */
    draw_silhouettes(drawn_units) {
        const rects = [], occ = [];
        this.drawn.forEach(([r, e, spr], i) => {
            if (e instanceof Building || (e instanceof Node && e.kind === 'tree')) {
                rects.push(r);
                occ.push([i, spr]);
            }
        });
        if (!rects.length) return;
        const scr = this.screen;
        for (const [i0, [spr, x, y], col] of drawn_units) {
            const hits = new pygame.Rect(x, y, ...spr.get_size()).collidelistall(rects);
            if (!hits.length) continue;
            let cover = null;
            let um = null;
            for (const h of hits) {
                const [j, ospr] = occ[h];
                if (j < i0) continue;            // drawn before the unit - behind it
                if (um == null) um = _mask(spr, 150);
                const r = rects[h];
                const m = um.overlap_mask(_mask(ospr, 128), [r.x - x, r.y - y]);
                if (cover == null) cover = m;
                else cover.draw(m, [0, 0]);
            }
            if (cover != null && cover.count()) {
                scr.blit(cover.to_surface(null, null, null, [...col.slice(0, 3), 150], [0, 0, 0, 0]), [x, y]);
            }
        }
    }

    draw_messages() {
        // on the left under the group icons, on a dark backing (DE)
        const w = this.world;
        let y = TOP_H + 44;
        for (const [txt, t, col] of w.messages) {
            if (w.time - t < 10 && !this.show_history) {
                const img = this.fonts['b'].render(txt, true, col);
                uiskin.shade_overlay(this.screen, [8, y - 1, img.get_width() + 12, 20], undefined, 110);
                this.text(txt, [14, y], 'b', col);
                y += 21;
            }
        }
    }
}
py.classattrs(Game, {
    GRID: 15,
    _PRELOAD_EVERY: 1.5,
    REL_BAR: { 'me': [70, 220, 80], 'ally': [90, 190, 230], 'enemy': [230, 70, 60], 'gaia': [230, 70, 60] },
    REL_SEL: { 'me': [255, 255, 255], 'ally': [150, 220, 255], 'enemy': [255, 120, 100], 'gaia': [255, 255, 255] },
    RUBBLE_LIFE: 60.0, RUBBLE_FADE: 10.0, RUBBLE_BURN: 9.0,      // DE: rubble 60 s (world.DECAL_LIFE)
    BODY_HOLD: 285.0, BODY_FADE: 15.0,        // DE: a body ~ 300 s (world.DECAL_LIFE)
});
py.statics(Game, 'node_stage');
py.mixin(Game, ScreensUI, HudUI, MenuUI, LobbyUI, DefenseUI, ControlsUI);
