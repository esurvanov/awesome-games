// port of game/civ_ui.py
/* Civilization interface: the menu picker (coat-of-arms grid + bonus card), the coat of arms in the top panel,
   the civilization card (F2 / click on the coat of arms), the owner's civilization in the selection panel.

   Functions receive game (ui.Game) and draw on game.screen with its own fonts and icons. */
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { CIVS, UNITS, TECHS, SCREEN_W, SCREEN_H, TOP_H } from './data.js';
import * as civ_art from './civ_art.js';
import * as i18n from './i18n.js';
import * as uiskin from './uiskin.js';

export const CELL_W = 90, CELL_H = 88;
export const GRID_COLS = 3;
export const LEFT = new pygame.Rect(16, 246, GRID_COLS * CELL_W + 22, 5 * CELL_H + 46);
export const RIGHT = new pygame.Rect(SCREEN_W - 16 - 396, 246, 396, 5 * CELL_H + 46);
export const RANDOM_SPEC = { field: [[120, 110, 96], [90, 82, 72]], div: 'quarterly', charge: null };


export function playable() {
    return Object.keys(CIVS).filter(k => k !== 'default');
}


export function civ_name(key) {
    return key === 'random' ? i18n.t('civ.random.name') : py.get(CIVS, key, CIVS['default'])['name'];
}


export function emblem(key, w, h) {
    if (key === 'random' || !Object.hasOwn(CIVS, key) || !Object.hasOwn(CIVS[key], 'emblem')) {
        const img = civ_art.emblem('random', RANDOM_SPEC, w, h);
        return img;
    }
    return civ_art.emblem(key, CIVS[key]['emblem'], w, h);
}


export function blit_emblem(game, key, rect) {
    const r = new pygame.Rect(rect);
    game.screen.blit(emblem(key, r.w, r.h), r.topleft);
    if (key === 'random' || !Object.hasOwn(CIVS, key)) {
        game.text('?', [r.centerx, r.centery - py.floordiv(r.h, 14)], r.h > 40 ? 'xl' : 'b', [250, 235, 190],
            'center');
    }
}


export function unique_units(key) {
    return Object.entries(UNITS).filter(([k, d]) => py.get(d, 'civ', null) === key && !k.startsWith('elite_'))
        .map(([k]) => k);
}


export function unique_techs(key) {
    return py.sorted(Object.entries(TECHS).filter(([k, d]) => py.get(d, 'civ', null) === key && !py.bool(py.get(d, 'upgrade', null)))
        .map(([k]) => k), k => TECHS[k]['age']);
}


// ============================================================ menu
export function menu_items() {
    const items = [];
    const keys = [...playable(), 'random'];
    keys.forEach((k, i) => {
        const r = new pygame.Rect(LEFT.x + 12 + (i % GRID_COLS) * CELL_W, LEFT.y + 36 + Math.floor(i / GRID_COLS) * CELL_H,
            CELL_W - 6, CELL_H - 6);
        items.push([r, 'civ', k]);
    });
    return items;
}


export function draw_menu(game) {
    const scr = game.screen;
    const cfg = game.menu_cfg;
    const sel = py.get(cfg, 'civ', 'random');
    const mp = pygame.mouse.get_pos();
    _panel(scr, LEFT);
    _panel(scr, RIGHT);
    _flag_icon(scr, LEFT.x + 20, LEFT.y + 18);
    game.text(i18n.t('lobby.civ'), [LEFT.x + 34, LEFT.y + 18], 'b', [255, 225, 150], 'midleft');
    let hover = null;
    for (const [r, act, key] of menu_items()) {
        const h = r.collidepoint(mp);
        if (h) hover = key;
        const on = key === sel;
        const fill = on ? [150, 112, 52] : h ? [104, 84, 56] : [70, 58, 42];
        pygame.draw.rect(scr, fill, r, 0, 8);
        pygame.draw.rect(scr, on ? [240, 205, 120] : [130, 108, 74], r, 2, 8);
        blit_emblem(game, key, [r.centerx - 22, r.y + 6, 44, 52]);
        game.text(civ_name(key), [r.centerx, r.bottom - 14], 's', on ? [250, 240, 215] : [220, 208, 180],
            'center');
    }
    draw_card(game, hover || sel, RIGHT, true);
}


export function _panel(scr, r) {
    uiskin.panel(scr, r, 'stone', undefined, 240, true);
}


export function _flag_icon(scr, x, y) {
    pygame.draw.line(scr, [200, 180, 140], [x - 6, y + 9], [x - 6, y - 9], 2);
    pygame.draw.polygon(scr, [200, 60, 50], [[x - 5, y - 9], [x + 7, y - 6], [x - 5, y - 2]]);
}


/** Bonus row icon: ('u'|'b'|'t', kind) or ('r', resource). (x, y) - top left. */
export function _icon(game, spec, x, y, size = 28) {
    const [typ, name] = spec;
    pygame.draw.rect(game.screen, [62, 52, 40], [x, y, size, size], 0, 5);
    if (typ === 'r') {
        game.res_icon(name, x + py.floordiv(size, 2), y + py.floordiv(size, 2), 8);
        return;
    }
    let ic;
    try {
        ic = game.icon(typ, name, 0, size);
    } catch (e) {
        // Python: except (KeyError, AttributeError) - in JS a missing key/attribute surfaces as a TypeError
        if (!(e instanceof py.KeyError || e instanceof py.AttributeError || e instanceof TypeError)) throw e;
        return;
    }
    game.screen.blit(ic, [x, y]);
}


/** Civilization card: coat of arms, name, direction, bonuses with icons, team bonus,
 *  unique unit and techs, unavailable items (crossed-out icons). */
export function draw_card(game, key, box, compact = false, player = null) {
    const scr = game.screen;
    const x = box.x + 16;
    let y = box.y + 14;
    blit_emblem(game, key, [x, y, 56, 66]);
    game.text(civ_name(key), [x + 70, y + 14], 'l', [255, 225, 150], 'midleft');
    if (key === 'random' || !Object.hasOwn(CIVS, key)) {
        game.text(i18n.t('civui.random_hint'), [x + 70, y + 42], 'm', [215, 205, 180], 'midleft');
        // mini coats of arms of all
        playable().forEach((k, i) => {
            const gx = box.x + 18 + (i % 7) * 52;
            const gy = box.y + 110 + Math.floor(i / 7) * 64;
            blit_emblem(game, k, [gx, gy, 40, 48]);
        });
        return;
    }
    const c = CIVS[key];
    const tag = py.get(c, 'style', '');
    const r = game.text(tag, [x + 72, y + 44], 'b', [20, 16, 12], 'midleft', false);
    pygame.draw.rect(scr, [220, 190, 110], r.inflate(12, 4), 0, 9);
    game.text(tag, [x + 72, y + 44], 'b', [40, 30, 18], 'midleft', false);
    y += 80;
    for (const [spec, txt] of py.get(c, 'bonus', [])) {
        _icon(game, spec, x, y);
        game.text(txt, [x + 38, y + 14], 'm', [235, 228, 210], 'midleft');
        y += 32;
    }
    // team bonus
    const [spec, txt] = py.get(c, 'team_desc', [null, '']);
    if (py.bool(spec)) {
        pygame.draw.line(scr, [100, 84, 60], [x, y + 2], [box.right - 16, y + 2], 1);
        y += 8;
        _team_icon(scr, x + 14, y + 14);
        _icon(game, spec, x + 32, y);
        game.text(txt, [x + 70, y + 14], 'm', [170, 225, 160], 'midleft');
        y += 34;
    }
    // unique unit and techs
    pygame.draw.line(scr, [100, 84, 60], [x, y + 2], [box.right - 16, y + 2], 1);
    y += 8;
    for (const u of unique_units(key)) {
        pygame.draw.rect(scr, [92, 70, 38], [x, y, 44, 44], 0, 6);
        pygame.draw.rect(scr, [230, 190, 90], [x, y, 44, 44], 2, 6);
        const ic = game.icon('u', u, player != null ? player : 0, 44);
        scr.blit(ic, [x, y]);
        game.text(UNITS[u]['name'], [x + 54, y + 12], 'b', [255, 220, 140], 'midleft');
        game.text(UNITS[u]['desc'], [x + 54, y + 32], 's', [215, 205, 180], 'midleft');
        y += 50;
    }
    for (const t of unique_techs(key)) {
        const d = TECHS[t];
        _icon(game, ['t', t], x, y, 28);
        game.text((d['age'] === 2 ? 'III ' : 'IV ') + d['name'], [x + 38, y + 7], 'b', [240, 225, 180],
            'midleft');
        game.text(d['desc'], [x + 38, y + 22], 's', [205, 195, 170], 'midleft');
        y += 34;
    }
    if (compact && y > box.bottom - 50) return;
    // unavailable
    const dis = py.list(py.get(c, 'disabled', [])).filter(k => Object.hasOwn(UNITS, k) || Object.hasOwn(TECHS, k));
    if (dis.length) {
        y += 4;
        game.text(i18n.t('civui.disabled'), [x, y + 14], 's', [200, 150, 130], 'midleft');
        let xx = x + 30;
        for (const k of dis.slice(0, 8)) {
            const spec2 = Object.hasOwn(UNITS, k) ? ['u', k] : ['t', k];
            _icon(game, spec2, xx, y, 28);
            pygame.draw.line(scr, [220, 60, 50], [xx + 3, y + 3], [xx + 25, y + 25], 3);
            xx += 32;
        }
    }
}


/** Two figures side by side - a "team". */
export function _team_icon(scr, cx, cy) {
    for (const [dx, c] of [[-4, [170, 225, 160]], [4, [120, 190, 120]]]) {
        pygame.draw.circle(scr, c, [cx + dx, cy - 5], 3);
        pygame.draw.rect(scr, c, [cx + dx - 4, cy - 1, 8, 8], 0, 3);
    }
}


// ============================================================ in game
/** Banner coat of arms at the top right, before the round buttons (DE); hangs below the top panel. */
export function top_emblem_rect() {
    return new pygame.Rect(986, 2, 44, TOP_H + 10);
}


export function draw_top(game) {
    const p = game.world.players[0];
    blit_emblem(game, p.civ, top_emblem_rect());
}


/** The coat of arms and civilization name of the owner after the player's name. Returns the right edge. */
export function owner_civ(game, owner, x, y) {
    const p = game.world.players[owner];
    blit_emblem(game, p.civ, [x, y - 1, 14, 17]);
    const r = game.text(civ_name(p.civ), [x + 18, y], 's', [215, 200, 165]);
    return r.right;
}


/** Card of your own civilization + the coats of arms of all players in the match. */
export function draw_overlay(game) {
    const scr = game.screen;
    const w = game.world;
    const ov = new pygame.Surface([SCREEN_W, SCREEN_H], pygame.SRCALPHA);
    ov.fill([0, 0, 0, 160]);
    scr.blit(ov, [0, 0]);
    const box = new pygame.Rect(py.floordiv(SCREEN_W, 2) - 220, 70, 440, 530);
    _panel(scr, box);
    const p = w.players[0];
    draw_card(game, p.civ, box, undefined, 0);
    // players in the match
    const y = box.bottom - 70;
    pygame.draw.line(scr, [100, 84, 60], [box.x + 16, y - 8], [box.right - 16, y - 8], 1);
    let x = box.x + 16;
    for (const q of w.players) {
        blit_emblem(game, q.civ, [x, y, 30, 36]);
        pygame.draw.rect(scr, q.color, [x, y + 40, 30, 5]);
        const rel = q.id === 0 ? 'you' : (w.allied(0, q.id) ? 'ally' : 'enemy');
        game.text(civ_name(q.civ), [x + 36, y + 8], 's', [235, 225, 200]);
        game.text(i18n.t('rel.' + rel).toLowerCase(), [x + 36, y + 24], 's',
            rel !== 'enemy' ? [170, 225, 160] : [240, 140, 120]);
        x += 104;
    }
    game.text('F2 / Esc', [box.right - 14, box.y + 16], 's', [190, 175, 150], 'topright');
}
