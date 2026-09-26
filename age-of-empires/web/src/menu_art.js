// port of game/menu_art.py
// Illustrations of the main menu tiles and the "Single Player" window - from the game's own sprites (0 A.D. / Millennium A.D.,
// CC BY-SA), toned "ink sepia" on parchment, like DE's sketches (their art is Microsoft's property, we do not take it).
//
//   tile_art(kind, (w, h)) -> Surface     kind: 'single' | 'multi' | 'learn' | 'skirmish' | 'campaign' |
//                                                 'scenario' | 'load'
//
// Browser: the scenes draw unit sheets that are downloaded on demand; preload() requests them (main.js awaits it
// before the menu), and a tile drawn while a sheet was still missing is not cached (it is redrawn next time).
import * as py from '../runtime/py.js';
import { random } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as sprites3d from './sprites3d.js';
import * as gfx from './gfx.js';
import * as S from './uiskin.js';

export { sprites3d, gfx, S };

export const _cache = new Map();
export const INK_TINT = [250, 222, 168];
export const BLUE = [60, 90, 170], RED = [170, 50, 40];

let _incomplete = false;          // a unit frame was a download placeholder while drawing the current tile

export function _zoom(spr, k) {
    // Uniform scaling with smoothing (rotozoom: smoothscale gives stripes on frames from sheets).
    return pygame.transform.rotozoom(spr.copy(), 0, k);
}

export function _unit(kind, civ, d, anim = 'idle', k = 0, color = BLUE, scale = 1.0) {
    const us = sprites3d.units_index() != null ? sprites3d.unit_set(kind, civ) : null;
    if (us != null && Object.hasOwn(us.anims, anim)) {
        try {
            let [spr, ax, ay] = us.frame(us.index(anim, d, k), color);
            if (spr === sprites3d._blank()) _incomplete = true;
            if (scale !== 1.0) {
                spr = _zoom(spr, scale);
                ax = Math.trunc(ax * scale); ay = Math.trunc(ay * scale);
            }
            return [spr, ax, ay];
        } catch (e) {
            // pass (the procedural figure below)
        }
    }
    const surf = new pygame.Surface([60, 70], pygame.SRCALPHA);
    gfx.draw_unit(surf, kind, color, 30, 62, [[0, 1, 7].includes(d) ? 1 : -1, 0.3], 0.0, 0.0, 1.6 * scale);
    return [surf, 30, 62];
}

export function _building(kind, civ, color = BLUE, scale = 1.0) {
    const r = sprites3d.available() ? sprites3d.building(kind, civ, color) : null;
    let spr, ox, oy;
    if (r == null) [spr, ox, oy] = gfx.make_building_sprite(kind, color);
    else [spr, ox, oy] = r;
    if (scale !== 1.0) {
        spr = _zoom(spr, scale);
        ox = Math.trunc(ox * scale); oy = Math.trunc(oy * scale);
    }
    return [spr, ox, oy];
}

export function _paper(size) {
    // A clean sheet: the middle of the parchment texture (without torn edges), stretched to the tile.
    const src = S.image('skin/parchment.png');
    if (src == null) {
        const base = new pygame.Surface(size);
        base.fill([226, 204, 160]);
        return base;
    }
    const [w, h] = src.get_size();
    const crop = src.subsurface([Math.floor(w / 4), Math.floor(h / 4), Math.floor(w / 2), Math.floor(h / 2)]);
    const base = new pygame.Surface(size);
    base.blit(pygame.transform.smoothscale(crop, size), [0, 0]);
    return base;
}

export function _ink(surf) {
    // A color picture -> sepia (grey x the parchment tone).
    const g = surf.copy();
    const rgb = pygame.surfarray.pixels3d(g);
    const [W, H] = [rgb.shape[0], rgb.shape[1]];
    const d = rgb.data, [s0, s1, s2] = rgb.strides, off = rgb.offset;
    const k = INK_TINT.map(t => t / 255.0);
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const o = off + x * s0 + y * s1;
            let lum = d[o] * 0.3 + d[o + s2] * 0.59 + d[o + 2 * s2] * 0.11;
            lum = Math.min(255, Math.max(0, (lum - 25) * 1.6));                 // contrast: shadows darker, lights brighter
            for (let i = 0; i < 3; i++) d[o + i * s2] = Math.trunc(lum * k[i]);
        }
    }
    return g;
}

export function _scene(kind, size) {
    const [w, h] = size;
    const canvas = new pygame.Surface([w * 2, h * 2], pygame.SRCALPHA);
    const W2 = w * 2, H2 = h * 2;
    const rnd = random.Random(kind);

    const put = (item, x, y) => {
        const [spr, ax, ay] = item;
        canvas.blit(spr, [Math.trunc(x) - ax, Math.trunc(y) - ay]);
    };

    if (kind === 'single' || kind === 'campaign') {
        const spr = _building('castle', 'britons', BLUE, 1.0);
        put([spr[0], spr[1] + Math.floor(spr[0].get_width() / 2) - spr[1], spr[2]], W2 * 0.62, H2 * 0.30);
        for (let i = 0; i < 3; i++) {
            put(_unit('knight', 'franks', 3, 'idle', 0, BLUE, 1.5), W2 * (0.12 + i * 0.13), H2 * (0.78 + (i % 2) * 0.1));
        }
        put(_unit('archer', 'britons', 3, 'idle', 0, BLUE, 1.4), W2 * 0.5, H2 * 0.92);
    } else if (kind === 'multi' || kind === 'skirmish') {
        for (let row = 0; row < 2; row++) {
            for (let i = 0; i < 5; i++) {
                const side = i < 2;
                const kindu = ['knight', 'spearman', 'militia', 'archer', 'militia'][(i + row) % 5];
                const d = side ? 0 : 4;
                const col = side ? BLUE : RED;
                const x = W2 * (0.12 + i * 0.19) + rnd.uniform(-8, 8);
                const y = H2 * (0.55 + row * 0.3) + rnd.uniform(-6, 6);
                put(_unit(kindu, side ? 'teutons' : 'mongols', d, 'attack', 3, col, 1.45), x, y);
            }
        }
    } else if (kind === 'learn') {
        const spr = _building('house', 'franks', BLUE, 1.0);
        put([spr[0], spr[1] + Math.floor(spr[0].get_width() / 2) - spr[1], spr[2]], W2 * 0.64, H2 * 0.34);
        [['build', 1], ['idle', 3], ['build', 7]].forEach(([anim, d], i) => {
            put(_unit('villager', 'franks', d, anim, 2, BLUE, 1.6), W2 * (0.18 + i * 0.16), H2 * (0.68 + (i % 2) * 0.18));
        });
    } else if (kind === 'scenario') {
        const spr = _building('town_center', 'teutons', BLUE, 0.6);
        put([spr[0], spr[1] + Math.floor(spr[0].get_width() / 2) - spr[1], spr[2]], W2 * 0.5, H2 * 0.2);
    } else if (kind === 'load') {
        const spr = _building('monastery', 'byzantines', BLUE, 0.7);
        put([spr[0], spr[1] + Math.floor(spr[0].get_width() / 2) - spr[1], spr[2]], W2 * 0.5, H2 * 0.24);
        put(_unit('monk', 'byzantines', 2, 'idle', 0, BLUE, 1.5), W2 * 0.2, H2 * 0.85);
    }
    const bb = canvas.get_bounding_rect();
    if (bb.w === 0) return null;
    let fig = canvas.subsurface(bb).copy();
    const k = Math.min((w - 12) / bb.w, (h - 10) / bb.h);
    fig = _zoom(fig, k);
    return fig;
}

export function tile_art(kind, size) {
    const key = py.tkey([kind, size[0], size[1]]);
    const got = _cache.get(key);
    if (got !== undefined) return got;
    _incomplete = false;
    const out = _paper(size);
    let fig;
    try {
        fig = _scene(kind, size);
    } catch (e) {
        fig = null;
    }
    if (fig != null) {
        fig = _ink(fig);
        out.blit(fig, fig.get_rect({ midbottom: [Math.floor(size[0] / 2), size[1] - 2] }));
    }
    // a soft vignette at the edges - a "drawing on a sheet"
    const v = new pygame.Surface(size, pygame.SRCALPHA);
    for (let i = 0; i < 10; i++) {
        pygame.draw.rect(v, [90, 60, 20, Math.trunc(60 * (1 - i / 10))], [i, i, size[0] - 2 * i, size[1] - 2 * i], 1);
    }
    out.blit(v, [0, 0]);
    if (!_incomplete) _cache.set(key, out);     // drawn with a sheet still downloading: redraw next time
    return out;
}

/** The unit kinds the tile scenes draw: [kind, civ]. */
export const _SCENE_UNITS = [
    ['knight', 'franks'], ['archer', 'britons'],
    ['knight', 'teutons'], ['spearman', 'teutons'], ['militia', 'teutons'], ['archer', 'teutons'],
    ['knight', 'mongols'], ['spearman', 'mongols'], ['militia', 'mongols'], ['archer', 'mongols'],
    ['villager', 'franks'], ['monk', 'byzantines'],
];

/** Browser addition: download the unit sheets the menu tiles draw (main.js awaits it before showing the menu). */
export function preload() {
    if (sprites3d.units_index() == null) return Promise.resolve();
    const paths = new Set();
    for (const [kind, civ] of _SCENE_UNITS) for (const p of sprites3d.sheet_paths(kind, civ)) paths.add(p);
    return assets.request(Array.from(paths));
}
