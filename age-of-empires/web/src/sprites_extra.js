// port of game/sprites_extra.py
// Small world graphics from 0 A.D. (assets/gen/decals/, the index assets/gen/nature_extra.json - tools/build_decals.py):
// fish and circles on the water, carcasses, stumps, rubble, fire and smoke, explosions, projectiles.
//
// Each function returns (surface, ax, ay) - a frame and the pixel of the "point on the ground" in it (draw at sx - ax, sy - ay)
// or None if there are no sprites (then the game draws the former procedural graphics).
import * as py from '../runtime/py.js';
import { math, os, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';

export const GEN = 'assets/gen';

export let _idx = null;
export let _tried = false;
export const _sheets = new Map();
export const _frames = new Map();
export const _faded = new Map();
export const _FADED_MAX = 4000;

export function index() {
    if (!_tried) {
        _tried = true;
        if (os.environ.NO_SPRITES3D || os.environ.NO_SPRITES_EXTRA) return null;
        try {
            _idx = assets.read_json(os.path.join(GEN, 'nature_extra.json'))['groups'] || null;
            if (_idx && !Object.keys(_idx).length) _idx = null;
        } catch (e) {
            if (!(e instanceof py.OSError) && !(e instanceof SyntaxError)) throw e;
            _idx = null;
        }
    }
    return _idx;
}

export function group(name) {
    const ix = index();
    return ix ? py.get(ix, name) : null;
}

export function frame(name, i) {
    // (surface, ax, ay) of frame i of group name; None - no such group.
    const key = name + '\u0000' + i;
    let hit = _frames.get(key);
    if (hit !== undefined) return hit;
    const g = group(name);
    if (g == null) return null;
    let sh = _sheets.get(name);
    if (sh === undefined) {
        sh = pygame.image.load(os.path.join(GEN, g['file']));
        if (pygame.display.get_surface() != null) sh = sh.convert_alpha();
        _sheets.set(name, sh);
    }
    const fr = g['frames'];
    const [x, y, w, h, ax, ay] = fr[py.mod(i, fr.length)];
    hit = [sh.subsurface([x, y, w, h]), ax, ay];
    _frames.set(key, hit);
    return hit;
}

export function faded(name, i, alpha) {
    // A frame with an overall transparency alpha (0..255, quantized by 16) - for fading rubble, stumps, fish.
    const a = Math.max(0, Math.min(255, Math.trunc(alpha))) & ~15;
    if (a >= 240) return frame(name, i);
    const key = name + '\u0000' + i + '\u0000' + a;
    let hit = _faded.get(key);
    if (hit === undefined) {
        const f = frame(name, i);
        if (f == null) return null;
        const s = f[0].copy();
        s.fill([255, 255, 255, a], null, pygame.BLEND_RGBA_MULT);
        if (_faded.size > _FADED_MAX) _faded.clear();
        hit = [s, f[1], f[2]];
        _faded.set(key, hit);
    }
    return hit;
}

export function blit(scr, fr, sx, sy) {
    if (fr != null) {
        const [s, ax, ay] = fr;
        scr.blit(s, [Math.trunc(sx) - ax, Math.trunc(sy) - ay]);
    }
}

// ------------------------------------------------------------------ fish and water
export function fish(kind, vr, t, alpha = 255) {
    // A fish frame: kind 'shore_fish' | 'deep_fish'; the swimming animation is looped.
    const name = kind === 'deep_fish' ? 'fish_deep' : 'fish_shore';
    const g = group(name);
    if (g == null) return null;
    const n = g['n'], nv = g['vars'];
    const k = py.mod(Math.trunc((t / g['dur']) * n + vr * 3), n);
    return faded(name, py.mod(vr, nv) * n + k, alpha);
}

export function ripple(t) {
    const g = group('ripple');
    if (g == null) return null;
    return frame('ripple', py.mod(Math.trunc(t / g['dur'] * g['n']), g['n']));
}

// ------------------------------------------------------------------ carcasses
export function carcass(kind, frac, fx, fy) {
    // A carcass by the share of meat left frac: > 2/3 - whole, > 1/3 - butchered, otherwise - a skeleton;
    // the direction - by the look (fx, fy) and the group's number of directions (16, 8 in old builds).
    const name = 'carcass_' + kind;
    const g = group(name);
    if (g == null) return null;
    const { face_dir } = modules.sprites3d;
    const st = frac > 0.67 ? 0 : frac > 0.34 ? 1 : 2;
    return frame(name, st * g['dirs'] + face_dir(fx, fy, g['dirs']));
}

// ------------------------------------------------------------------ stumps
export const _SPECIES_W = [['oak', 5], ['beech', 3], ['deci', 3], ['birch', 2], ['pine', 3], ['fir', 3], ['poplar', 1]];

export function _hash(x, y, s = 0) {
    // Python ints are unbounded: (x * 73856093) ^ ... may exceed 2^53. Only bits 0..43 of h reach the 31-bit result,
    // so a fast exact path works on the products mod 2^44 (as two 32-bit halves); BigInt otherwise.
    const a = x * 73856093, b = y * 19349663, c = s * 83492791;
    if (a >= 0 && b >= 0 && c >= 0 && a <= Number.MAX_SAFE_INTEGER && b <= Number.MAX_SAFE_INTEGER && c <= Number.MAX_SAFE_INTEGER) {
        const hi = ((Math.floor(a / 4294967296) ^ Math.floor(b / 4294967296) ^ Math.floor(c / 4294967296)) & 0xfff);
        const lo = ((a % 4294967296) ^ (b % 4294967296) ^ (c % 4294967296)) >>> 0;
        return ((lo & 0x7fffffff) ^ (((hi << 19) | (lo >>> 13)) & 0x7fffffff)) >>> 0;
    }
    const h = (BigInt(x) * 73856093n) ^ (BigInt(y) * 19349663n) ^ (BigInt(s) * 83492791n);
    return Number((h ^ (h >> 13n)) & 0x7fffffffn);
}

export function species(tx, ty) {
    // The tile's tree species - the same patch layout as game.sprites3d.tree.
    let rx = py.floordiv(tx, 7), ry = py.floordiv(ty, 7);
    if (_hash(tx, ty, 5) % 4 === 0) {
        rx = py.floordiv(tx + 3, 7); ry = py.floordiv(ty + 3, 7);
    }
    const tot = _SPECIES_W.reduce((a, [, w]) => a + w, 0);
    let r = _hash(rx, ry, 1) % tot;
    let sp = _SPECIES_W[0][0];
    for (const [n, w] of _SPECIES_W) {
        if (r < w) {
            sp = n;
            break;
        }
        r -= w;
    }
    if (_hash(tx, ty, 9) % 5 === 0) sp = _SPECIES_W[_hash(tx, ty, 11) % _SPECIES_W.length][0];
    return sp;
}

export function stump(tx, ty, alpha = 255) {
    const g = group('stump');
    if (g == null) return null;
    const sp = species(tx, ty);
    const names = g['species'];
    const si = names.includes(sp) ? names.indexOf(sp) : 0;
    return faded('stump', si * g['vars'] + _hash(tx, ty, 3) % g['vars'], alpha);
}

// ------------------------------------------------------------------ rubble, fire, explosion
export const WOOD = new Set(['house', 'mill', 'lumber_camp', 'mining_camp', 'farm', 'dock', 'palisade_wall', 'palisade_gate',
    'stable']);

export function rubble(size, kind = null, alpha = 255) {
    const name = WOOD.has(kind) ? 'rubble_wood' : 'rubble_stone';
    const g = group(name);
    if (g == null) return null;
    const sizes = g['sizes'];
    const i = py.min(py.range(sizes.length), j => Math.abs(sizes[j] - size));
    return faded(name, i, alpha);
}

export function _loop(name, t, phase = 0.0, alpha = 255) {
    const g = group(name);
    if (g == null) return null;
    const k = py.mod(Math.trunc((t / g['dur'] + phase) * g['n']), g['n']);
    return alpha < 240 ? faded(name, k, alpha) : frame(name, k);
}

export function flame(t, phase = 0.0, alpha = 255) {
    return _loop('flame', t, phase, alpha);
}

export function smoke(t, phase = 0.0, alpha = 255) {
    return _loop('smoke', t, phase, alpha);
}

export function blast(age) {
    // An explosion frame after age seconds; None - the explosion is over (or there are no sprites).
    const g = group('blast');
    if (g == null || age < 0 || age >= g['dur']) return null;
    return frame('blast', Math.trunc(age / g['dur'] * g['n']));
}

// ------------------------------------------------------------------ projectiles
export function projectile(shape, dx, dy, t = 0.0) {
    // A projectile flying across the screen in the direction (dx, dy): 'arrow' | 'bolt' | 'javelin' - by direction,
    // 'stone' | 'ball' | 'shot' - a tumbling stone/cannonball.
    const name = 'proj_' + shape;
    const g = group(name);
    if (g == null) return null;
    if (Object.hasOwn(g, 'dirs')) {
        const n = g['dirs'];
        return frame(name, py.mod(Math.trunc(py.round(Math.atan2(dy, dx) / (2 * Math.PI) * n)), n));
    }
    return frame(name, py.mod(Math.trunc(t * 12), g['n']));
}
