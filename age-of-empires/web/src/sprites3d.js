// port of game/sprites3d.py
// Pre-rendered sprites from 3D models of 0 A.D. and the Millennium A.D. mod (assets/gen/, built by tools/build_sprites.py).
//
// If the folder is missing or the atlas is unreadable - `available()` returns False and the game draws procedural graphics.
// Everything loads lazily and is cached: buildings - by (kind, civilization group, color, stage), nature - by file.
// Player color: pixel x (1 - m*(1 - color)), m - a mask from the alpha channel of the 0 A.D. texture (0 - not painted).
//
// Browser: buildings/nature/terrain/walls images and every JSON are preloaded (boot.js); UNIT SHEETS ARE NOT
// (2.3 GB decoded). USet._ensure() requests a sheet (assets.request) when it is not loaded yet and frame() returns a
// transparent 1x1 placeholder (not cached), so the unit appears as soon as the sheet arrives. The Python background
// thread (_pre_worker + pump) becomes promises: request() starts the fetch, pump() turns fetched sheets into
// surfaces. sheet_paths() gives the asset paths of a kind's sheet (screens / menu preload them).
import * as py from '../runtime/py.js';
import { math, os, time } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as terrain from './terrain.js';

export { terrain };

export const GEN = 'assets/gen';

export let _atlas = null;
export let _tried = false;
export const _img = new Map();
export const _bld = new Map();
export const _nat = new Map();
export const _tiles = new Map();

const _ck = c => (c && c.length ? py.tkey(Array.from(c)) : 'None');      // tuple(color) if color else None

function _read_json(rel) {
    // json.load(open(...)) with the (OSError, ValueError) -> None fallback of the callers
    try {
        return assets.read_json(os.path.join(GEN, rel));
    } catch (e) {
        if (e instanceof py.OSError || e instanceof SyntaxError) return undefined;
        throw e;
    }
}

export function atlas() {
    if (!_tried) {
        _tried = true;
        if (os.environ.NO_SPRITES3D) return null;
        const a = _read_json('atlas.json');
        _atlas = a === undefined ? null : a;
    }
    return _atlas;
}

export function available() {
    return atlas() != null;
}

export function _load(rel, alpha = true) {
    let s = _img.get(rel);
    if (s === undefined) {
        s = pygame.image.load(os.path.join(GEN, rel));
        if (pygame.display.get_surface() != null) s = alpha ? s.convert_alpha() : s.convert();
        _img.set(rel, s);
    }
    return s;
}

// Player color (DE): by the mask a pixel is replaced by the player's color of the same brightness as the texture's -
//   out = lerp(base, c*(TA + TB*L) + TD*L*255, m),  L - the pixel's brightness (0...1), m - the mask (0...1).
// The former "base x c" gave dark brown blotches (the cloth in 0 A.D. textures is brown, ~ (105, 94, 76)).
export const TA = 0.40, TB = 0.85, TD = 0.30;      // tuned to DE: purple on the knight ~ (112, 45, 150), DE (107, 50, 141)

export function _mask_rgb(mk) {
    // The mask as an opaque 32-bit RGB surface (for BLEND_RGB_*).
    if (mk.get_bitsize() !== 32 || (mk.get_flags() & pygame.SRCALPHA)) {
        const m = new pygame.Surface(mk.get_size());
        m.blit(pygame.display.get_surface() != null ? mk.convert() : mk, [0, 0]);
        mk = m;
    }
    return mk;
}

export function _tint_aux(base, mk) {
    // (brightness L, 255 - mask) for recoloring; compute once per sheet.
    const gray = new pygame.Surface(base.get_size());
    gray.blit(pygame.transform.grayscale(base), [0, 0]);
    const inv = new pygame.Surface(mk.get_size());
    inv.fill([255, 255, 255]);
    inv.blit(mk, [0, 0], null, pygame.BLEND_RGB_SUB);
    return [gray, inv];
}

export function recolor(base, mk, gray, inv, color) {
    // base (RGBA) with the mask area mk recolored to color while keeping brightness (gray, inv - _tint_aux).
    const t = gray.copy();
    t.fill(Array.from(color, c => Math.min(255, Math.trunc(c * TB + 255 * TD))), null, pygame.BLEND_RGB_MULT);
    t.fill(Array.from(color, c => Math.trunc(c * TA)), null, pygame.BLEND_RGB_ADD);
    t.blit(mk, [0, 0], null, pygame.BLEND_RGB_MULT);
    const out = base.copy();
    out.blit(inv, [0, 0], null, pygame.BLEND_RGB_MULT);
    out.blit(t, [0, 0], null, pygame.BLEND_RGB_ADD);
    return out;
}

/** recolor() computed on the CPU in one pass (the same pygame integer arithmetic as the chain of grayscale /
 *  BLEND_RGB_SUB / BLEND_RGB_MULT / BLEND_RGB_ADD blits in recolor + _tint_aux): reads the frame and its mask once
 *  and uploads the result once. The blit chain reads pixels back from canvases five times per frame, which on a
 *  GPU-accelerated canvas stalls for milliseconds each time (a battle recolors dozens of new frames per second).
 *  color == [255, 255, 255] with flash=true: the hit flash (base + 90 on RGB). */
export function _rt_recolor(base, mk, color, flash = false) {
    const w = base.get_width(), h = base.get_height();
    const out = new pygame.Surface([w, h], pygame.SRCALPHA);
    if (!w || !h) return out;
    const img = base._readRegion(base._ox, base._oy, w, h), B = img.data;
    if (flash) {
        for (let i = 0; i < B.length; i += 4) { B[i] = Math.min(255, B[i] + 90); B[i + 1] = Math.min(255, B[i + 1] + 90); B[i + 2] = Math.min(255, B[i + 2] + 90); }
    } else {
        const M = mk._readRegion(mk._ox, mk._oy, w, h).data;
        const c1 = Array.from(color, c => Math.min(255, Math.trunc(c * TB + 255 * TD)));
        const c2 = Array.from(color, c => Math.trunc(c * TA));
        for (let i = 0; i < B.length; i += 4) {
            const a = B[i + 3];
            // gray: grayscale(base) alpha-blitted onto black (pygame: (s * (a + 1)) >> 8)
            const G = ((0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2]) | 0) * (a + 1) >> 8;
            for (let k = 0; k < 3; k++) {
                const m = M[i + k];
                let t = (G * c1[k] + 255) >> 8;                   // t.fill(c1, BLEND_RGB_MULT)
                t = Math.min(255, t + c2[k]);                     // t.fill(c2, BLEND_RGB_ADD)
                t = (t * m + 255) >> 8;                           // t.blit(mk, BLEND_RGB_MULT)
                const o = (B[i + k] * (255 - m) + 255) >> 8;      // out.blit(inv = 255 - mk, BLEND_RGB_MULT)
                B[i + k] = Math.min(255, o + t);                  // out.blit(t, BLEND_RGB_ADD)
            }
        }
    }
    out._writeRegion(img, 0, 0);
    return out;
}

export function _tinted(rec, color) {
    // An RGBA sprite of an atlas entry, recolored to the player's color by the mask.
    const base = _load(rec['file']);
    if (!py.get(rec, 'mask') || color == null) return base;
    const mk = _mask_rgb(_load(rec['mask'], false));
    return _rt_recolor(base, mk, color);          // = recolor(base, mk, ..._tint_aux(base, mk), color)
}

// ------------------------------------------------------------------ buildings
export function civ_group(civ) {
    const a = atlas() || {};
    const cg = py.get(a, 'civ_groups', {});
    return py.get(cg, civ || 'default') || py.get(cg, 'default', 'caro');
}

export function building_rec(kind, civ) {
    const a = atlas();
    if (a == null) return null;
    const bl = py.get(a, 'buildings', {});
    const g = civ_group(civ);
    let rec = py.get(py.get(bl, g, {}), kind);
    if (rec == null) rec = py.get(py.get(bl, py.get(py.get(a, 'civ_groups', {}), 'default', 'caro'), {}), kind);
    return rec;
}

export function variants(kind, civ) {
    // The number of variants of a building model (houses: 2-3, chosen by tile).
    const rec = building_rec(kind, civ);
    return rec ? ((py.get(rec, 'variants') || []).length || 1) : 1;
}

export function building(kind, civ, color, stage = null, vr = 0, land = null) {
    // (surface, ox, oy) of a finished building (stage=None) or construction stage 0..2; None - no sprite.
    // var - the model variant number (houses), land - (dx, dy) the shore side of a dock.
    let rec = building_rec(kind, civ);
    if (rec == null) return null;
    if (land != null && py.bool(py.get(rec, 'dirs'))) rec = py.get(rec['dirs'], `${Math.trunc(land[0])},${Math.trunc(land[1])}`, rec);
    if (stage == null && py.bool(py.get(rec, 'variants'))) rec = rec['variants'][py.mod(vr, rec['variants'].length)];
    if (stage != null) {
        const st = py.get(rec, 'stages') || [];
        if (!st.length) return null;
        rec = st[Math.max(0, Math.min(st.length - 1, stage))];
    }
    const key = rec['file'] + '\u0000' + _ck(color);
    let hit = _bld.get(key);
    if (hit === undefined) {
        hit = [_tinted(rec, color), rec['ox'], rec['oy']];
        _bld.set(key, hit);
    }
    return hit;
}

// ------------------------------------------------------------------ nature
export function _nat_list(kind) {
    const a = atlas();
    if (a == null) return null;
    const v = py.get(py.get(a, 'nature', {}), kind);
    return py.bool(v) ? v : null;
}

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

export function tree(tx, ty, vr) {
    // (surface, ox, oy) of a tree on a tile: species grow in patches (7x7 tiles), inside a patch - a mix of variants
    // (species - game.terrain.tree_species: under conifers - a conifer floor).
    const trees = _nat_list('trees');
    if (!trees) return null;
    const names = new Set(Object.keys(trees).filter(n => py.bool(trees[n])));
    const sp = terrain.tree_species(tx, ty, names);
    const lst = trees[sp];
    const rec = lst[py.mod(_hash(tx, ty, 3) + vr, lst.length)];
    let hit = _green.get(rec['file']);
    if (hit === undefined) {
        const [surf, ox, oy] = _nat_sprite(rec);
        hit = [_greener(surf), ox, oy];
        _green.set(rec['file'], hit);
    }
    return hit;
}

// DE foliage (de_forest_town.jpg): hue ~ 85-92 deg, saturation ~ 0.5, brightness ~ 0.36; our trees'
// (0 A.D. light) - 62-82 deg, 0.65-0.8, 0.2-0.5 - look yellowish. Correction on load: hue toward GREEN_H, saturation softer.
export const GREEN_H = 90.0, GREEN_K = 0.7, GREEN_S = 0.82, GREEN_V = 1.15;
export const _green = new Map();

export function _greener(surf) {
    // A copy of a tree sprite with the foliage shifted from yellow to green (bark and shadows barely change).
    // numpy float32 pipeline -> a per-pixel loop with the same formulas (float32 inputs via Math.fround).
    const f32 = Math.fround;
    const out = surf.copy();
    const rgb = pygame.surfarray.pixels3d(out);           // (x, y, 3) view: data, strides, offset
    const [W, H] = [rgb.shape[0], rgb.shape[1]];
    const [s0, s1, s2] = rgb.strides;
    const d8 = rgb.data, off = rgb.offset;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const o = off + x * s0 + y * s1;
            const r = f32(d8[o] / 255.0), g = f32(d8[o + s2] / 255.0), b = f32(d8[o + 2 * s2] / 255.0);
            const mx = Math.max(r, g, b);
            const mn = Math.min(r, g, b);
            const d = f32(mx - mn);
            // hue in degrees only for greenish-yellow pixels (the maximum is the green channel or red close to it)
            let h;
            if (mx === g) h = f32(120.0 + f32(60.0 * f32(b - r) / d));
            else h = f32(60.0 * py.mod(f32(f32(g - b) / d), 6));
            if (Number.isNaN(h)) h = 0.0;
            else if (h === Infinity) h = 3.4028234663852886e38;
            else if (h === -Infinity) h = -3.4028234663852886e38;
            const sat = mx > 0 ? f32(d / Math.max(mx, f32(1e-6))) : 0.0;
            const leaf = (d > f32(0.04)) && (h >= 40.0) && (h <= 115.0) && (g >= f32(r * f32(0.8)));
            const w = leaf ? Math.min(1.0, Math.max(0.0, (sat - 0.15) / 0.25)) : 0.0;   // grey/brown pixels (bark) - no shift
            if (!(w > 0)) continue;
            const h2 = h + (GREEN_H - h) * GREEN_K * w;
            const sat2 = sat * (1.0 + (GREEN_S - 1.0) * w);
            const v2 = Math.min(1.0, mx * (1.0 + (GREEN_V - 1.0) * w));
            // HSV -> RGB
            const c = v2 * sat2;
            const hp = py.mod(h2 / 60.0, 6);
            const xx = c * (1 - Math.abs(py.mod(hp, 2) - 1));
            const m = v2 - c;
            const z = 0;
            const sec = Math.trunc(hp);
            const rr = [c, xx, z, z, xx, c][sec];
            const gg = [xx, c, c, xx, z, z][sec];
            const bb = [z, z, xx, c, c, xx][sec];
            d8[o] = Math.trunc(Math.min(255, Math.max(0, f32(f32(rr + m) * 255.0 + 0.5))));
            d8[o + s2] = Math.trunc(Math.min(255, Math.max(0, f32(f32(gg + m) * 255.0 + 0.5))));
            d8[o + 2 * s2] = Math.trunc(Math.min(255, Math.max(0, f32(f32(bb + m) * 255.0 + 0.5))));
        }
    }
    return out;
}

export function cliff(vr) {
    // (surface, ox, oy) of a cliff boulder (tools/build_nature.py build_cliffs) or None.
    const lst = _nat_list('cliffs');
    if (!lst) return null;
    return _nat_sprite(lst[py.mod(vr, lst.length)]);
}

export function _nat_sprite(rec, color = null) {
    const key = rec['file'] + '\u0000' + _ck(color);
    let hit = _nat.get(key);
    if (hit === undefined) {
        hit = [_tinted(rec, color), rec['ox'], rec['oy']];
        _nat.set(key, hit);
    }
    return hit;
}

export const _NODE_STAGE = [1.0, 0.86, 0.72];          // the ore vein's scale by stage: > 66 %, > 33 %, the remainder (DE: n_mine_*_66 / _33)
export const _node_st = new Map();

export function node(kind, vr, stage = 0) {
    // (surface, ox, oy) of a resource; stage 1..2 - a depleted vein (a smaller pile, as in DE at 66 % and 33 %).
    const lst = _nat_list(kind);
    if (!lst) return null;
    const base = _nat_sprite(lst[py.mod(vr, lst.length)]);
    if (!stage) return base;
    const key = py.tkey([kind, py.mod(vr, lst.length), stage]);
    let hit = _node_st.get(key);
    if (hit === undefined) {
        const [surf, ox, oy] = base;
        const k = _NODE_STAGE[Math.min(stage, 2)];
        const w = Math.max(1, py.round(surf.get_width() * k)), h = Math.max(1, py.round(surf.get_height() * k));
        // scale around the tile's center on the ground (ox, oy + 16): the pile settles in place
        const cx = ox, cy = oy + 16;
        hit = [pygame.transform.smoothscale(surf, [w, h]), py.round(cx * k), py.round(cy * k) - 16];
        _node_st.set(key, hit);
    }
    return hit;
}

export function animal(kind, vr, face, color = null) {
    // A static animal sprite; face - the direction (fx, fy) in world coordinates.
    const an = _nat_list('animals');
    if (!an || !py.bool(py.get(an, kind))) return null;
    const vs = an[kind];
    const dirs = vs[py.mod(vr, vs.length)];
    const d = py.mod(Math.trunc(py.round(Math.atan2(face[1], face[0]) / (Math.PI / 4))), 8);
    return _nat_sprite(dirs[py.mod(d, dirs.length)], color);
}

export function farm(level) {
    // A 3x3 field: level 0 - plowed, 4 - a full harvest.
    const lst = _nat_list('farm');
    if (!lst) return null;
    return _nat_sprite(lst[Math.max(0, Math.min(lst.length - 1, level))]);
}

export function icon_rec(kind) {
    // An entry for a natural resource icon (the first tree, the first mine...).
    if (kind === 'tree') {
        const t = _nat_list('trees');
        if (t) return _nat_sprite(py.get(t, 'oak', Object.values(t)[0])[0]);
        return null;
    }
    return node(kind, 0);
}

// ------------------------------------------------------------------ terrain
export function terrain_tile(name) {
    const a = atlas();
    if (a == null) return null;
    const rec = py.get(py.get(a, 'terrain', {}), name);
    if (rec == null) return null;
    let t = _tiles.get(name);
    if (t === undefined) {
        t = _load(rec['file'], false);
        _tiles.set(name, t);
    }
    return t;
}

// terrain type blending, relief and slope light - game/terrain_gfx.py

// ------------------------------------------------------------------ walls
export const _WALL = new Map();

export function _wall_set(kind, civ) {
    const a = atlas();
    if (a == null) return null;
    const wk = kind.startsWith('palisade') ? 'palisade' : 'stone';
    const wl = py.get(a, 'walls', {});
    const grp = py.get(wl, civ_group(civ)) || py.get(wl, py.get(py.get(a, 'civ_groups', {}), 'default', 'caro')) || {};
    return py.get(grp, wk);
}

export function wall_piece(kind, civ, color, mask, dirs) {
    // A 1x1 wall segment from "arms" toward neighbors and a post: (surface, ox, oy) or None.
    // dirs - a list of directions (dx, dy) by the mask bits (the order of game.defense.DIR8).
    const ws = _wall_set(kind, civ);
    if (ws == null) return null;
    const key = py.tkey([kind, civ_group(civ), mask]);
    let hit = _WALL.get(key);
    if (hit !== undefined) return hit;
    const ds = dirs.filter((d, i) => mask & (1 << i));
    const straight = ds.length === 2 && ds[0][0] === -ds[1][0] && ds[0][1] === -ds[1][1];
    const back = py.sorted(ds.filter(d => d[0] + d[1] < 0), d => d[0] + d[1]);
    const side = ds.filter(d => d[0] + d[1] === 0);
    const front = py.sorted(ds.filter(d => d[0] + d[1] > 0), d => d[0] + d[1]);
    const recs = back.concat(side).map(([dx, dy]) => ws['arms'][`${dx},${dy}`]);
    if (!straight) recs.push(ws['post']);
    for (const [dx, dy] of front) recs.push(ws['arms'][`${dx},${dy}`]);
    const l = Math.min(...recs.map(r => -r['ox']));
    const t = Math.min(...recs.map(r => -r['oy']));
    const rgt = Math.max(...recs.map(r => r['w'] - r['ox']));
    const btm = Math.max(...recs.map(r => r['h'] - r['oy']));
    const surf = new pygame.Surface([rgt - l, btm - t], pygame.SRCALPHA);
    for (const r of recs) surf.blit(_load(r['file']), [-l - r['ox'], -t - r['oy']]);
    hit = [surf, -l, -t];
    _WALL.set(key, hit);
    return hit;
}

export function wall_build(kind, civ, part) {
    // A wall-segment construction sprite: part = 'fndn' (foundation) | 'scaf' (scaffolding); (surface, ox, oy) or None.
    const ws = _wall_set(kind, civ);
    if (ws == null || !Object.hasOwn(ws, part)) return null;
    return _nat_sprite(ws[part]);
}

export function gate(kind, civ, color, horiz, opened) {
    const ws = _wall_set(kind, civ);
    if (ws == null || !Object.hasOwn(ws, 'gate')) return null;
    const rec = py.get(ws['gate'], `${horiz ? 'h' : 'v'}${opened ? 1 : 0}`);
    if (rec == null) return null;
    return _nat_sprite(rec, color);
}

// ------------------------------------------------------------------ units (tools/build_units.py)
// Frame sheets are loaded lazily: the index - at the first unit in a frame, a set's sheet - at its first frame,
// recoloring to the player's color - frame by frame on first display (cache by (set, frame, color)).
export let _uidx = null;
export let _utried = false;
export const _usets = new Map();
export const _uset_of = new Map();
export const _UT_MAX = 12000;

export function units_index() {
    if (!_utried) {
        _utried = true;
        if (os.environ.NO_SPRITES3D || os.environ.NO_UNIT_SPRITES) return null;
        const u = _read_json(os.path.join('units', 'index.json'));
        _uidx = u === undefined ? null : u;
    }
    return _uidx;
}

let _blank_surf = null;
/** The transparent 1x1 placeholder frame shown while a unit sheet is still downloading (never cached). */
export function _blank() {
    if (_blank_surf === null) _blank_surf = new pygame.Surface([1, 1], pygame.SRCALPHA);
    return _blank_surf;
}

export class USet {
    // A set of frames of one model: animations x directions (16, 8 in old builds) x frames.
    constructor(name, rec) {
        this.name = name;
        this.rec = rec;
        this.anims = rec['anims'];
        this.h = py.get(rec, 'h') || 40;
        // "body height" - to the crown (for spearmen h - to the spear tip): the health bar, selection
        this.bh = py.get(rec, 'bh') || this.h;
        this.ndir = py.get(rec, 'dirs') || 8;
        this.sheet = null;
        this.mask = null;
        this.rects = null;
        this.tinted = new Map();
        this.plain = new Map();
    }

    /** Asset paths of the sheet and its mask (repo-root relative). */
    _paths() {
        const rec = this.rec;
        const out = [os.path.join(GEN, rec['file'])];
        if (py.get(rec, 'mask')) out.push(os.path.join(GEN, rec['mask']));
        return out;
    }

    /** Python loads the sheet synchronously here. Browser: true when the sheet is ready; otherwise the download is
     * started (once) and false is returned - the caller shows a placeholder. */
    _ensure() {
        if (this.sheet != null) return true;
        const rec = this.rec;
        if (this.rects == null) this.rects = assets.read_json(os.path.join(GEN, rec['meta']))['frames'];
        if (!this._paths().every(p => assets.is_loaded(p))) {
            _pre_start(this);
            return false;
        }
        if (py.get(rec, 'mask')) {
            const mk = _load(rec['mask'], false);
            this.mask = _mask_rgb(mk);
        }
        this.sheet = _load(rec['file']);           // last: the "ready" flag
        return true;
    }

    frame(i, color) {
        // (surface, ax, ay) of frame i recolored to color (None - no recoloring).
        const key = i + '\u0000' + _ck(color);
        let hit = this.tinted.get(key);
        if (hit !== undefined) return hit;
        if (!this._ensure()) {
            const [, , , , ax, ay] = this.rects[i];
            return [_blank(), ax, ay];              // the sheet is still downloading: not cached
        }
        const [x, y, w, h, ax, ay] = this.rects[i];
        const base = this.sheet.subsurface([x, y, w, h]);
        let surf;
        if (this.mask == null || color == null) {
            surf = base;
        } else if (py.eq(Array.from(color), [255, 255, 255])) {          // hit flash: the whole silhouette is lighter
            surf = _rt_recolor(base, null, color, true);      // = base.copy() + fill((90, 90, 90), BLEND_RGB_ADD)
        } else {
            const mk = this.mask.subsurface([x, y, w, h]);
            surf = _rt_recolor(base, mk, color);      // = recolor(base, mk, *_tint_aux(base, mk), color); cached below
        }
        if (this.tinted.size > _UT_MAX) this.tinted.clear();
        hit = [surf, ax, ay];
        this.tinted.set(key, hit);
        return hit;
    }

    face(fx, fy) {
        // The set's direction number by the look vector (fx, fy) in world coordinates.
        return face_dir(fx, fy, this.ndir);
    }

    index(anim, d, k) {
        // d - the set's direction number (see face).
        const a = this.anims[anim];
        const n = a['n'];
        return a['i0'] + py.mod(d, this.ndir) * n + py.mod(k, n);
    }
}

export function unit_set(kind, civ, female = false) {
    // USet for a unit kind (or 'animal_<kind>') and the owner's civilization; None - no sprites.
    const key = py.tkey([kind, civ, !!female]);
    if (_uset_of.has(key)) return _uset_of.get(key);
    const idx = units_index();
    let s = null;
    if (idx != null) {
        const m = py.get(idx['units'], female && kind === 'villager' ? 'villager_f' : kind);
        if (m && py.bool(m)) {
            const dg = py.get(idx, 'default', 'caro');
            const g = py.get(idx['groups'], civ_group(civ), dg);
            const name = py.get(m, g) || py.get(m, '*') || py.get(m, dg) || Object.values(m)[0];
            if (Object.hasOwn(idx['sets'], name)) {
                s = _usets.get(name);
                if (s === undefined) {
                    s = new USet(name, idx['sets'][name]);
                    _usets.set(name, s);
                }
            }
        }
    }
    _uset_of.set(key, s);
    return s;
}

export function face_dir(fx, fy, n = 8) {
    // Direction number 0..n-1 (angle d*360/n deg in world coordinates) by the look vector.
    return py.mod(Math.trunc(py.round(Math.atan2(fy, fx) * (n / math.tau))), n);
}

/** Browser addition: the asset paths ([sheet, mask]) of a kind's unit sheet; [] - no sprites. */
export function sheet_paths(kind, civ, female = false) {
    const s = unit_set(kind, civ, female);
    return s == null ? [] : s._paths();
}

// ------------------------------------------------------------------ background preloading of unit sheets
// Python: a thread decodes the PNGs of kinds players can train right now, the main thread turns the bytes into surfaces
// in strips within a frame budget. Browser: request() starts the download (assets.request - decoding happens off the
// main thread in createImageBitmap), pump() makes the fetched sheets ready (cheap: the bitmap is wrapped, not copied).
export const _pre_q = new Set();          // USets being downloaded (the queue.Queue of the thread)
export const _pre_ready = [];             // downloaded jobs waiting for pump() (collections.deque)
export const _pre_seen = new Set();
export const _pre_thread = [null];        // the promise chain of the last started download (the thread)
export const _STRIP = 24;                 // sheet rows per copy step (Python's strip copying; kept for _strips)
export const _pre_busy = { locked: false, acquire(blocking = true) { if (this.locked) return false; this.locked = true; return true; }, release() { this.locked = false; } };

export class _Pre {
    constructor(uset) {
        this.uset = uset;
        this.rects = this.sheet = this.mask = this.size = this.msize = this.surf = this.msurf = null;
        this.row = this.mrow = 0;
        this.failed = false;
    }
}

/** The download of one set's sheet (Python's thread body for one queue item). */
export async function _pre_worker(s) {
    const job = new _Pre(s);
    try {
        job.rects = assets.read_json(os.path.join(GEN, s.rec['meta']))['frames'];
        await assets.request(s._paths());
        job.failed = !s._paths().every(p => assets.is_loaded(p));    // failed - the sheet stays a placeholder
    } catch (e) {
        job.failed = true;
    } finally {
        _pre_q.delete(s);
    }
    if (!job.failed) {
        _pre_fails.delete(s.name);
        _pre_ready.push(job);
    } else {
        // Browser addition: a failed download (network drop) is retried later with a growing pause (2, 4, 8 .. 30 s)
        // instead of leaving the units invisible for the rest of the session.
        const n = (_pre_fails.get(s.name)?.n || 0) + 1;
        _pre_fails.set(s.name, { n, at: Date.now() + Math.min(30000, 1000 * 2 ** n) });
        _pre_seen.delete(s.name);
    }
}

/** Browser addition: name -> {n: failed attempts, at: Date.now() of the next allowed attempt}. */
export const _pre_fails = new Map();

function _pre_start(s) {
    if (s.sheet != null || _pre_seen.has(s.name)) return;
    const f = _pre_fails.get(s.name);
    if (f && Date.now() < f.at) return;     // waiting before the next retry
    _pre_seen.add(s.name);
    _pre_q.add(s);
    _pre_thread[0] = _pre_worker(s);
}

export function request(kind, civ, female = false) {
    // Put a kind's sheet in the background preload queue (if not yet loaded).
    const s = unit_set(kind, civ, female);
    if (s == null || s.sheet != null || _pre_seen.has(s.name)) return;
    _pre_start(s);
}

export function _strips(job, data, size, rows_done, surf, mode, bpp, t_end) {
    const [w, h] = size;
    while (rows_done < h && time.perf_counter() < t_end) {
        const n = Math.min(_STRIP, h - rows_done);
        const part = pygame.image.frombuffer(data.subarray(rows_done * w * bpp, (rows_done + n) * w * bpp), [w, n], mode);
        surf.blit(part, [0, rows_done]);
        rows_done += n;
    }
    return rows_done;
}

export function pump(budget = 0.002) {
    // The main thread, once per frame: turns ready sheets into surfaces, no longer than budget seconds.
    if (!_pre_ready.length || !_pre_busy.acquire(false)) return;
    try {
        _pump(budget);
    } finally {
        _pre_busy.release();
    }
}

export function _pump(budget) {
    const t_end = time.perf_counter() + budget;
    while (_pre_ready.length && time.perf_counter() < t_end) {
        const job = _pre_ready[0];
        const s = job.uset;
        if (s.sheet != null) {             // managed to load the usual way
            _pre_ready.shift();
            continue;
        }
        if (s.rects == null) s.rects = job.rects;
        s._ensure();                        // the sheet is downloaded: wraps it (sheet is set last)
        _pre_ready.shift();
    }
}

export function preload_pending() {
    // How many sheets are still in progress (for tests).
    return _pre_q.size + _pre_ready.length;
}
