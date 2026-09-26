// port of game/terrain.py
/* Relief as in AoE II DE: heights 0-7, cliffs, shallows, ground types (no pygame - this is part of the world).

The world.terrain cell codes:  0 - land, 1 - water, 2 - shallows (foot units walk, ships do not sail, building
is not allowed), 3 - a cliff (impassable). Passability for foot units - an even code (t & 1 == 0).

Height is stored at the cell vertices: world.hz[(H+1)][(W+1)] - screen pixels (level x ZL); across a cell -
bilinearly, the way the ground draws it (game/terrain_gfx.py). The integer level of a cell (0..7, for the combat and
building rules) - world.elev_map[ty*W + tx] = the rounded mean of the four corners.

A single way of "world point -> screen with height" for all drawing code:
  terrain.ZL                    - screen pixels per level (16 = HH: 24 px in the classic at a 96 px tile, ours 64)
  World.z_at(x, y)              - the ground height under a world point (logical px) in screen pixels
  World.elev(tx, ty)            - the integer level of a cell
  data.to_iso(x, y, ox, z)      - world -> the isometric map, raised by z pixels
  Game.w2s(x, y, z=None)        - world -> screen; z by default - the ground height at the point
  Game.s2w(sx, sy)              - screen -> world taking relief into account (the ground point under the cursor)
*/
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import { TILE, HH } from './data.js';

export const ZL = HH;                 // screen pixels per height level
export const MAX_LEVEL = 7;
export const SLOPE = 0.7;             // the limit of the difference between neighboring vertices (levels per tile)
export const BUILD_SLOPE = 0.5;       // a building: the height difference of the base corners <= 1/2 level
export const HEIGHT_BONUS = 0.25;     // +-25 % damage from top to bottom / from bottom to top (AoE II DE)

export const LAND = 0, WATER = 1, SHALLOW = 2, CLIFF = 3;

// ground types (world.ground) - for textures and blending; the blending order is PRIORITY (higher - on top)
export const GROUNDS = ['grass', 'grass2', 'grass3', 'dirt', 'dirt2', 'dirt3', 'forest', 'pine', 'sand', 'beach',
    'shallow', 'water', 'rocky'];
export const G = Object.fromEntries(GROUNDS.map((n, i) => [n, i]));
export const PRIORITY = ['water', 'shallow', 'beach', 'sand', 'grass', 'grass2', 'grass3', 'dirt3', 'dirt2', 'dirt',
    'rocky', 'pine', 'forest'];
// the minimap color by type (as in AoE2: grass green, earth ochre, forest dark green, sand light)
export const MM_COLOR = {
    'grass': [98, 150, 62], 'grass2': [90, 140, 56], 'grass3': [112, 152, 64], 'dirt': [178, 142, 76],
    'dirt2': [190, 160, 96], 'dirt3': [140, 140, 70], 'forest': [40, 92, 36], 'pine': [36, 84, 40],
    'sand': [196, 180, 120], 'beach': [206, 190, 132], 'shallow': [96, 170, 180], 'water': [40, 90, 160],
    'rocky': [130, 118, 96],
};

export const _SPECIES_W = [['oak', 5], ['beech', 3], ['deci', 3], ['birch', 2], ['pine', 3], ['fir', 3], ['poplar', 1]];
export const CONIFERS = ['pine', 'fir'];

const _2_32 = 4294967296;

/** Python's (x*73856093 ^ y*19349663 ^ s*83492791), h ^ (h >> 13), & 0x7fffffff over unbounded ints. */
export function _hash(x, y, s = 0) {
    const p1 = x * 73856093, p2 = y * 19349663, p3 = s * 83492791;
    if (p1 >= 0 && p2 >= 0 && p3 >= 0 && p1 < 9007199254740992 && p2 < 9007199254740992 && p3 < 9007199254740992) {
        const lo = ((p1 % _2_32) ^ (p2 % _2_32) ^ (p3 % _2_32)) >>> 0;
        const hi = (Math.floor(p1 / _2_32) ^ Math.floor(p2 / _2_32) ^ Math.floor(p3 / _2_32)) >>> 0;
        const sh = ((lo >>> 13) | (hi << 19)) >>> 0;        // low 32 bits of h >> 13
        return ((lo ^ sh) & 0x7fffffff) >>> 0;
    }
    const h = (BigInt(x) * 73856093n) ^ (BigInt(y) * 19349663n) ^ (BigInt(s) * 83492791n);
    return Number((h ^ (h >> 13n)) & 0x7fffffffn);
}

/** The tree species on a tile: 7x7 patches of one species with an admixture. names - the available species (by default all). */
export function tree_species(tx, ty, names = null) {
    const nm = names;
    names = _SPECIES_W.filter(([n, w]) => nm == null || py.contains(nm, n));
    if (!names.length) return null;
    let rx = py.floordiv(tx, 7), ry = py.floordiv(ty, 7);
    if (_hash(tx, ty, 5) % 4 === 0) {           // the patch borders are slightly uneven
        rx = py.floordiv(tx + 3, 7);
        ry = py.floordiv(ty + 3, 7);
    }
    let tot = 0;
    for (const [, w] of names) tot += w;
    let r = _hash(rx, ry, 1) % tot;
    let sp = names[names.length - 1][0];
    for (const [n, w] of names) {
        if (r < w) {
            sp = n;
            break;
        }
        r -= w;
    }
    if (_hash(tx, ty, 9) % 5 === 0)             // an admixture of another species
        sp = names[_hash(tx, ty, 11) % names.length][0];
    return sp;
}


// ============================================================ world state
/** Flat relief by default (old saves, test worlds before generation). */
export function ensure(w) {
    const W = w.W, H = w.H;
    if (py.getattr(w, 'hz', null) == null || w.hz.length !== H + 1)
        w.hz = Array.from({ length: H + 1 }, () => new Array(W + 1).fill(0.0));
    if (py.getattr(w, 'elev_map', null) == null || w.elev_map.length !== W * H)
        w.elev_map = new Uint8Array(W * H);
    if (py.getattr(w, 'ground', null) == null || w.ground.length !== W * H)
        w.ground = new Uint8Array(W * H);
    if (py.getattr(w, 'cliffs', null) == null)
        w.cliffs = [];
    if (!py.hasattr(w, 'relief') || w.relief === undefined)
        w.relief = false;
    if (!py.getattr(w, 'theme', null))
        w.theme = 'grass';          // landscape (game/themes.py); old saves - the former look
}

/** The ground height (screen px) under a world point (x, y in logical px) - bilinear across the vertices. */
export function z_at(w, x, y) {
    if (!w.relief) return 0.0;
    let fx = x / TILE;
    let fy = y / TILE;
    let ix = Math.trunc(fx);
    let iy = Math.trunc(fy);
    const W = w.W, H = w.H;
    if (ix < 0) {
        ix = 0; fx = 0.0;
    } else if (ix >= W) {
        ix = W - 1; fx = W;
    }
    if (iy < 0) {
        iy = 0; fy = 0.0;
    } else if (iy >= H) {
        iy = H - 1; fy = H;
    }
    const ax = fx - ix;
    const ay = fy - iy;
    const r0 = w.hz[iy];
    const r1 = w.hz[iy + 1];
    const a = r0[ix] + (r0[ix + 1] - r0[ix]) * ax;
    const b = r1[ix] + (r1[ix + 1] - r1[ix]) * ax;
    return a + (b - a) * ay;
}

export function elev(w, tx, ty) {
    if (0 <= tx && tx < w.W && 0 <= ty && ty < w.H)
        return w.elev_map[ty * w.W + tx];
    return 0;
}

export function elev_px(w, x, y) {
    return elev(w, Math.trunc(py.floordiv(x, TILE)), Math.trunc(py.floordiv(y, TILE)));
}

/** (min, max) of the heights of the corners of the base cells (levels). */
export function footprint_range(w, tx, ty, sw, sh) {
    let lo = 1e9, hi = -1e9;
    const y1 = Math.min(w.H, ty + sh) + 1, x1 = Math.min(w.W, tx + sw) + 1;
    for (let y = Math.max(0, ty); y < y1; y++) {
        const row = w.hz[y];
        for (let x = Math.max(0, tx); x < x1; x++) {
            const v = row[x];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    }
    if (lo > hi) return [0.0, 0.0];
    return [lo / ZL, hi / ZL];
}

/** Whether a building can be placed: the height difference across the base <= BUILD_SLOPE levels. */
export function slope_ok(w, tx, ty, sw, sh = null) {
    if (!w.relief) return true;
    const [lo, hi] = footprint_range(w, tx, ty, sw, sh == null ? sw : sh);
    return hi - lo <= BUILD_SLOPE + 1e-6;
}

/** The damage multiplier for height: x1.25 from top to bottom, x0.75 from bottom to top. */
export function height_mult(w, att, target) {
    if (!w.relief) return 1.0;
    const [ax, ay] = att.center();
    const [bx, by] = target.center();
    const ea = elev_px(w, ax, ay);
    const eb = elev_px(w, bx, by);
    if (ea > eb) return 1.0 + HEIGHT_BONUS;
    if (ea < eb) return 1.0 - HEIGHT_BONUS;
    return 1.0;
}

/** The average height of the base corners (px) - the building stands at it (cached: the relief does not change). */
export function footprint_z(w, tx, ty, sw, sh) {
    if (!w.relief) return 0.0;
    let cache = Object.hasOwn(w, '_bz') ? w._bz : null;
    if (cache == null) cache = w._bz = new Map();
    const k = tx + ',' + ty + ',' + sw + ',' + sh;
    let z = cache.get(k);
    if (z == null) {
        let tot = 0, n = 0;
        const y1 = Math.min(w.H, ty + sh) + 1, x1 = Math.min(w.W, tx + sw) + 1;
        for (let y = Math.max(0, ty); y < y1; y++) {
            const row = w.hz[y];
            for (let x = Math.max(0, tx); x < x1; x++) {
                tot += row[x];
                n += 1;
            }
        }
        z = n ? tot / n : 0.0;
        cache.set(k, z);
    }
    return z;
}

export function building_z(w, b) {
    return footprint_z(w, b.tx, b.ty, b.w, b.h);
}

/** A screen without the camera offset (ix, iy - isometry raised by the relief) -> a world ground point (x, y).
 * We look for the point of the column whose iy_flat - z = iy: the iteration iy_flat = iy + z (slopes < 1 -> it converges). */
export function ground_at(w, ix, iy, ox) {
    ix -= ox;
    if (!w.relief)
        return [(ix + 2 * iy) * 0.5, (2 * iy - ix) * 0.5];
    let fy = iy;
    let z = 0.0;
    for (let _ = 0; _ < 12; _++) {
        const x = (ix + 2 * fy) * 0.5;
        const y = (2 * fy - ix) * 0.5;
        const z2 = z_at(w, x, y);
        if (Math.abs(z2 - z) < 0.05) break;
        z = _ > 5 ? z * 0.3 + z2 * 0.7 : z2;
        fy = iy + z;
    }
    return [(ix + 2 * fy) * 0.5, (2 * fy - ix) * 0.5];
}


// ============================================================ generation
export function _rng(w, starts, salt) {
    // 48-bit mixing overflows 2^53 -> BigInt (Python ints are unbounded)
    let s = BigInt(w.W * 7919 + salt * 104729 + starts.length * 31 + w.map_type.length);
    let i = 0;
    for (const [x, y] of starts) {
        s = (s * 1000003n + BigInt(x) * 131n + BigInt(y) * 17n + BigInt(i)) & 0xffffffffffffn;
        i++;
    }
    return random.Random(s);
}

/** Smooth value noise (H rows x W columns, 0..1). */
export function _noise(W, H, cell, rng) {
    const gw = py.floordiv(W, cell) + 3, gh = py.floordiv(H, cell) + 3;
    const g = [];
    for (let j = 0; j < gh; j++) {
        const r = new Array(gw);
        for (let i = 0; i < gw; i++) r[i] = rng.random();
        g.push(r);
    }
    const out = [];
    for (let y = 0; y < H; y++) {
        const fy = y / cell;
        const y0 = Math.trunc(fy);
        let ty = fy - y0;
        ty = ty * ty * (3 - 2 * ty);
        const ga = g[y0], gb = g[y0 + 1];
        const row = new Array(W);
        for (let x = 0; x < W; x++) {
            const fx = x / cell;
            const x0 = Math.trunc(fx);
            let tx = fx - x0;
            tx = tx * tx * (3 - 2 * tx);
            const a = ga[x0] + (ga[x0 + 1] - ga[x0]) * tx;
            const b = gb[x0] + (gb[x0 + 1] - gb[x0]) * tx;
            row[x] = a + (b - a) * ty;
        }
        out.push(row);
    }
    return out;
}

/** Connected components (by sides) of cells where ok[i] is true: [labels (-1 - the wrong cell), count]. */
export function _labels(W, H, ok) {
    const N = W * H;
    const lab = new Array(N).fill(-1);
    let n = 0;
    for (let s = 0; s < N; s++) {
        if (lab[s] >= 0 || !ok[s]) continue;
        lab[s] = n;
        const st = [s];
        while (st.length) {
            const c = st.pop();
            const x = c % W;
            if (x + 1 < W && lab[c + 1] < 0 && ok[c + 1]) {
                lab[c + 1] = n;
                st.push(c + 1);
            }
            if (x > 0 && lab[c - 1] < 0 && ok[c - 1]) {
                lab[c - 1] = n;
                st.push(c - 1);
            }
            if (c + W < N && lab[c + W] < 0 && ok[c + W]) {
                lab[c + W] = n;
                st.push(c + W);
            }
            if (c >= W && lab[c - W] < 0 && ok[c - W]) {
                lab[c - W] = n;
                st.push(c - W);
            }
        }
        n += 1;
    }
    return [lab, n];
}

function _count_labels(lab) {
    const m = new Map();
    for (const v of lab)
        if (v >= 0) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
}

/** Shallows: part of the rim of lakes and shores (foot units cross, ships do not). Straits are not blocked,
 * islands are not joined, the connectivity of the water is not broken. */
export function gen_shallows(w, starts) {
    const rng = _rng(w, starts, 1);
    const W = w.W, H = w.H;
    const T = w.terrain;
    const flat = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) flat.push(T[y][x]);
    if (!flat.includes(WATER)) return 0;
    const [land_lab, nl] = _labels(W, H, flat.map(t => t !== WATER));
    const [water_lab, nw] = _labels(W, H, flat.map(t => t === WATER));
    const wsize = _count_labels(water_lab);
    const noise = _noise(W, H, 5, rng);
    const opts = py.bool(py.getattr(w, 'gen_opts', null)) ? w.gen_opts : {};
    const lakes = py.get(opts, 'ponds_shallow', w.map_type === 'land');
    const pond = new Set();
    for (const [c, s] of wsize)
        if (py.bool(lakes) && s <= 26 && rng.random() < 0.45) pond.add(c);
    const thr = py.bool(lakes) ? 0.5 : 0.6;
    let conv = [];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (flat[i] !== WATER) continue;
            let near_start = false;
            for (const [sx, sy] of starts) if (math.hypot(x - sx, y - sy) < 13) { near_start = true; break; }
            if (near_start) continue;
            if (pond.has(water_lab[i])) {
                conv.push(i);
                continue;
            }
            // rim: land by a side; enough water around (not a narrow strait); only one land nearby
            if (!(flat[i + 1] === LAND || flat[i - 1] === LAND || flat[i + W] === LAND || flat[i - W] === LAND))
                continue;
            const comps = new Set();
            let wet = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (0 <= xx && xx < W && 0 <= yy && yy < H) {
                        const j = yy * W + xx;
                        if (flat[j] === WATER) wet += 1;
                        else comps.add(land_lab[j]);
                    }
                }
            }
            if (comps.size > 1 || wet < 12) continue;
            if (noise[y][x] > thr) conv.push(i);
        }
    }
    if (!conv.length) return 0;
    for (const i of conv) flat[i] = SHALLOW;
    // puddles of water cut off by the shallows - shallows too
    const [lab2] = _labels(W, H, flat.map(t => t === WATER));
    const size2 = _count_labels(lab2);
    for (let i = 0; i < lab2.length; i++) {
        const v = lab2[i];
        if (v >= 0 && size2.get(v) < 12 && wsize.get(water_lab[i]) > size2.get(v)) {
            flat[i] = SHALLOW;
            conv.push(i);
        }
    }
    // check: land does not merge (islands), water does not split (except ponds that became fully shallow)
    const [, nl2] = _labels(W, H, flat.map(t => t !== WATER));
    const [, nw2] = _labels(W, H, flat.map(t => t === WATER));
    if (nl2 !== nl || nw2 > nw - pond.size) {
        if (nl2 !== nl) return 0;
        // the water splits - keep only the ponds
        conv = conv.filter(i => pond.has(water_lab[i]));
    }
    for (const i of conv) T[Math.floor(i / W)][i % W] = SHALLOW;
    w._naval_comps = null;
    w._naval_shores = null;
    return conv.length;
}

/** Vertices touching water/shallows or the map edge - height 0. */
export function _wet_vertices(w) {
    const W = w.W, H = w.H;
    const T = w.terrain;
    const wt = t => t === WATER || t === SHALLOW;
    const wet = Array.from({ length: H + 1 }, () => new Array(W + 1).fill(false));
    for (let y = 0; y <= H; y++) {
        for (let x = 0; x <= W; x++) {
            if (x === 0 || y === 0 || x === W || y === H) {
                wet[y][x] = true;
                continue;
            }
            if (wt(T[y - 1][x - 1]) || wt(T[y - 1][x]) || wt(T[y][x - 1]) || wt(T[y][x]))
                wet[y][x] = true;
        }
    }
    return wet;
}

/** The upper envelope: h[v] <= h[u] + S*distance (two passes, 8 neighbors). */
export function _lipschitz(h, S, W1, H1, rows = null) {
    const D = S * 1.4142;
    for (let y = 0; y < H1; y++) {
        const r = h[y];
        const p = y ? h[y - 1] : null;
        for (let x = 0; x < W1; x++) {
            let v = r[x];
            if (x && r[x - 1] + S < v) v = r[x - 1] + S;
            if (p !== null) {
                if (p[x] + S < v) v = p[x] + S;
                if (x && p[x - 1] + D < v) v = p[x - 1] + D;
                if (x + 1 < W1 && p[x + 1] + D < v) v = p[x + 1] + D;
            }
            r[x] = v;
        }
    }
    for (let y = H1 - 1; y >= 0; y--) {
        const r = h[y];
        const n = y + 1 < H1 ? h[y + 1] : null;
        for (let x = W1 - 1; x >= 0; x--) {
            let v = r[x];
            if (x + 1 < W1 && r[x + 1] + S < v) v = r[x + 1] + S;
            if (n !== null) {
                if (n[x] + S < v) v = n[x] + S;
                if (x + 1 < W1 && n[x + 1] + D < v) v = n[x + 1] + D;
                if (x && n[x - 1] + D < v) v = n[x - 1] + D;
            }
            r[x] = v;
        }
    }
}

/** A map with a sea: land rises from the shore, the beach is wider (the old "coast", islands, the DE sea). */
export function water_rise(w) {
    const maps = modules.maps;
    return w.map_type !== 'land' && py.bool(maps.is_water(w.map_type));
}

/** Hills by noise: plains and gentle hills up to 4-6 levels; around the starts - flat sites; by the water and
 * the map edge - 0; on coastal maps the land rises from the shore. */
export function gen_heights(w, starts) {
    const rng = _rng(w, starts, 2);
    const W = w.W, H = w.H;
    const W1 = W + 1, H1 = H + 1;
    const amp = py.get({ 'land': 1.0, 'coast': 0.85, 'islands': 0.55 }, w.map_type, 1.0);
    const opts = py.bool(py.getattr(w, 'gen_opts', null)) ? w.gen_opts : {};
    const share = py.get(opts, 'hill_share');          // DE maps: the share of cells on hills (Arabia 11-31 %)
    const coastal = water_rise(w) && share == null;    // the old "coast": land rises from the shore
    const n1 = _noise(W1, H1, 12, rng);
    const n2 = _noise(W1, H1, 6, rng);
    const n3 = _noise(W1, H1, 21, rng);
    const wet = _wet_vertices(w);
    // the distance from water (in vertices) - coastal maps rise from the shore
    const INF = 10 ** 6;
    const dist = [];
    for (let y = 0; y < H1; y++) {
        const r = new Array(W1);
        for (let x = 0; x < W1; x++) r[x] = (wet[y][x] && 0 < x && x < W && 0 < y && y < H) ? 0 : INF;
        dist.push(r);
    }
    if (coastal) _lipschitz(dist, 1.0, W1, H1);
    const h = Array.from({ length: H1 }, () => new Array(W1).fill(0.0));
    let raw = null, q = 0, top = 0, peak = 0;
    if (share != null) {
        // the noise threshold for the given share of hills: the top share*k vertices rise, slopes will widen them
        raw = [];
        for (let y = 0; y < H1; y++) {
            const r = new Array(W1);
            for (let x = 0; x < W1; x++)
                r[x] = (0.62 * n1[y][x] + 0.38 * n2[y][x]) * Math.min(1.0, Math.max(0.0, (n3[y][x] - 0.12) * 2.0));
            raw.push(r);
        }
        const flat = [];
        for (const r of raw) for (const v of r) flat.push(v);
        flat.sort((a, b) => a - b);
        q = flat[Math.max(0, Math.min(flat.length - 1, Math.trunc(flat.length * (1.0 - share * 1.1))))];
        top = flat[flat.length - 1];
        peak = Number(py.get(opts, 'peak', 5));
    }
    for (let y = 0; y < H1; y++) {
        for (let x = 0; x < W1; x++) {
            let lv;
            if (share != null) {
                const v = raw[y][x];
                lv = Math.max(0.0, v - q) / Math.max(1e-6, top - q) * peak * 2.2 + (v > q ? 0.6 : 0.0);
            } else {
                const v = 0.62 * n1[y][x] + 0.38 * n2[y][x];
                const hill = Math.max(0.0, v - 0.46) / 0.54;
                const mask = Math.min(1.0, Math.max(0.0, (n3[y][x] - 0.22) * 2.5));       // where hills exist at all
                lv = hill * 11.0 * mask * amp;       // slopes will be limited by SLOPE: hills with flat tops, as in AoE2
            }
            if (coastal && dist[y][x] < INF)
                lv += Math.min(2.2, Math.max(0.0, dist[y][x] - 2) * 0.16);
            h[y][x] = lv;
        }
    }
    // flat sites at the starts (the center - at its own level, not above 2)
    for (const [sx, sy] of starts) {
        const cx = sx + 0.5, cy = sy + 0.5;
        const P = Math.min(2, py.round(h[Math.min(H, sy)][Math.min(W, sx)]));
        const yb = Math.min(H1, Math.trunc(cy + 17)), xb = Math.min(W1, Math.trunc(cx + 17));
        for (let y = Math.max(0, Math.trunc(cy - 16)); y < yb; y++) {
            for (let x = Math.max(0, Math.trunc(cx - 16)); x < xb; x++) {
                const d = math.hypot(x - cx, y - cy);
                let t = Math.min(1.0, Math.max(0.0, (d - 9.0) / 6.0));
                t = t * t * (3 - 2 * t);
                h[y][x] = P + (h[y][x] - P) * t;
            }
        }
    }
    for (let y = 0; y < H1; y++) {
        for (let x = 0; x < W1; x++) {
            if (wet[y][x]) h[y][x] = 0.0;
            else if (h[y][x] > MAX_LEVEL) h[y][x] = MAX_LEVEL;
        }
    }
    _lipschitz(h, SLOPE, W1, H1);
    peak = -Infinity;
    for (const r of h) for (const v of r) if (v > peak) peak = v;
    w.hz = h.map(r => r.map(v => v * ZL));
    _recount(w);
    return peak;
}

/** Recompute the integer levels of cells and the relief flag from the vertices. */
export function _recount(w) {
    const W = w.W, H = w.H;
    const em = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        const a = w.hz[y], b = w.hz[y + 1];
        for (let x = 0; x < W; x++)
            em[y * W + x] = Math.max(0, Math.min(MAX_LEVEL, py.round((a[x] + a[x + 1] + b[x] + b[x + 1]) * 0.25 / ZL)));
    }
    w.elev_map = em;
    let mx = -Infinity;
    for (const r of w.hz) for (const v of r) if (v > mx) mx = v;
    w.relief = mx > 0.05 * ZL;
    w._bz = new Map();
}

/** Set the vertex heights by the function fn(x, y) -> level (for tests and scenarios), then smooth the slopes. */
export function set_heights(w, fn) {
    const h = [];
    for (let y = 0; y < w.H + 1; y++) {
        const r = new Array(w.W + 1);
        for (let x = 0; x < w.W + 1; x++) r[x] = Number(fn(x, y));
        h.push(r);
    }
    w.hz = h.map(r => r.map(v => v * ZL));
    _recount(w);
}

/** Make the rectangle of cells [x0, x1) x [y0, y1) flat at the level level; the surroundings are smoothed
 * (slopes no steeper than SLOPE). For tests and sites. */
export function flatten(w, x0, y0, x1, y1, level = 0) {
    const W1 = w.W + 1, H1 = w.H + 1;
    const h = w.hz.map(r => r.map(v => v / ZL));
    const yb = Math.min(H1, y1 + 1), xb = Math.min(W1, x1 + 1);
    for (let y = Math.max(0, y0); y < yb; y++)
        for (let x = Math.max(0, x0); x < xb; x++)
            h[y][x] = Number(level);
    _lipschitz(h, SLOPE, W1, H1);
    w.hz = h.map(r => r.map(v => v * ZL));
    _recount(w);
}

/** Cliffs: 1-N segments along hill slopes far from the starts; each is checked - the map is not split. */
export function gen_cliffs(w, starts) {
    const rng = _rng(w, starts, 3);
    const W = w.W, H = w.H;
    const T = w.terrain, occ = w.occ;
    w.cliffs = [];
    const opts = py.bool(py.getattr(w, 'gen_opts', null)) ? w.gen_opts : {};
    if (rng.random() < py.get(opts, 'no_cliff', 0.25))             // on some maps there are no cliffs
        return 0;
    const n = starts.length;
    // all three randint calls happen (a dict literal), in order
    const wd = {
        'land': rng.randint(2, 3 + n), 'coast': rng.randint(1, 2 + py.floordiv(n, 2)),
        'islands': rng.randint(0, py.floordiv(n, 2)),
    };
    let want = py.get(wd, w.map_type, 2);
    if (Object.hasOwn(opts, 'cliffs')) {
        want = py.round(opts['cliffs'] * Math.max(1.0, w.W * w.H / 14400.0) ** 0.5);
        if (want <= 0) return 0;
    }

    const free = (x, y) => 3 <= x && x < W - 3 && 3 <= y && y < H - 3 && T[y][x] === LAND && occ[y][x] == null;

    const ok_cell = (x, y) => {
        if (!free(x, y)) return false;
        for (const [sx, sy] of starts) if (math.hypot(x - sx, y - sy) < 15) return false;
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
                const t = T[y + dy][x + dx];
                if (t === WATER || t === SHALLOW) return false;
            }
        return true;
    };

    const grad = (x, y) => {
        const hz = w.hz;
        const gx = (hz[y][x + 1] + hz[y + 1][x + 1]) - (hz[y][x] + hz[y + 1][x]);
        const gy = (hz[y + 1][x] + hz[y + 1][x + 1]) - (hz[y][x] + hz[y][x + 1]);
        return [gx, gy];
    };

    const walkable = (x, y) => 0 <= x && x < W && 0 <= y && y < H && !(T[y][x] & 1) && occ[y][x] == null;

    /** All the passable neighbors of a segment are connected to each other (first - in the surrounding window, otherwise - across the map). */
    const connected = (cells) => {
        const cs = new Set(cells.map(([x, y]) => y * W + x));
        const ring = new Set();
        for (const [x, y] of cells) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const cx = x + dx, cy = y + dy;
                    if (!cs.has(cy * W + cx) && walkable(cx, cy)) ring.add(cy * W + cx);
                }
            }
        }
        if (!ring.size) return true;
        for (const pad of [7, null]) {
            let x0, y0, x1, y1;
            if (pad === null) {
                x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1;
            } else {
                let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
                for (const [x, y] of cells) {
                    if (x < mnx) mnx = x;
                    if (y < mny) mny = y;
                    if (x > mxx) mxx = x;
                    if (y > mxy) mxy = y;
                }
                x0 = Math.max(0, mnx - pad);
                y0 = Math.max(0, mny - pad);
                x1 = Math.min(W - 1, mxx + pad);
                y1 = Math.min(H - 1, mxy + pad);
            }
            const first = ring.values().next().value;
            const seen = new Set([first]);
            const st = [first];
            while (st.length) {
                const k = st.pop();
                const cx = k % W, cy = Math.floor(k / W);
                for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
                    const nk = ny * W + nx;
                    if (x0 <= nx && nx <= x1 && y0 <= ny && ny <= y1 && !seen.has(nk) && walkable(nx, ny)) {
                        seen.add(nk);
                        st.push(nk);
                    }
                }
            }
            let all = true;
            for (const k of ring) if (!seen.has(k)) { all = false; break; }
            if (all) return true;
        }
        return false;
    };

    let placed = 0;
    for (let _i = 0; _i < want * 12; _i++) {
        if (placed >= want) break;
        // start - on a slope (the steepest of several random ones), along the contour line
        let best = null;
        for (let _j = 0; _j < 12; _j++) {
            const x = rng.randrange(4, W - 4), y = rng.randrange(4, H - 4);
            if (!ok_cell(x, y)) continue;
            const [gx, gy] = grad(x, y);
            const g = math.hypot(gx, gy) + rng.random() * 2;
            if (best === null || g > best[0]) best = [g, x, y, gx, gy];
        }
        if (best === null) continue;
        const [, x, y, gx, gy] = best;
        let ang = (gx || gy) ? math.atan2(gy, gx) + Math.PI / 2 : rng.uniform(0, math.tau);
        const L = rng.randint(6, 13);
        const cells = [];
        let fx = x + 0.5, fy = y + 0.5;
        for (let _k = 0; _k < L; _k++) {
            const c = [Math.trunc(fx), Math.trunc(fy)];
            if (!ok_cell(c[0], c[1])) break;
            if (!cells.some(e => e[0] === c[0] && e[1] === c[1])) {
                if (cells.length && Math.abs(c[0] - cells[cells.length - 1][0]) + Math.abs(c[1] - cells[cells.length - 1][1]) === 2) {
                    // a diagonal step - add a corner cell so that the line is solid
                    const k = [c[0], cells[cells.length - 1][1]];
                    if (ok_cell(k[0], k[1])) cells.push(k);
                }
                cells.push(c);
            }
            ang += rng.uniform(-0.35, 0.35);
            fx += Math.cos(ang);
            fy += Math.sin(ang);
        }
        if (cells.length < 3) continue;
        for (const [cx, cy] of cells) T[cy][cx] = CLIFF;
        if (!connected(cells)) {
            for (const [cx, cy] of cells) T[cy][cx] = LAND;
            continue;
        }
        for (const [cx, cy] of cells) w.cliffs.push([cx, cy, rng.randrange(64)]);
        _cliff_step(w, cells, gx, gy);
        placed += 1;
    }
    if (placed) _recount(w);
    w._naval_comps = null;
    w._naval_shores = null;
    return placed;
}

export const CLIFF_STEP = 1.3;        // by how many levels the upper side of a cliff is higher than the lower

/** A step at a cliff (as in AoE2: a cliff separates levels): the side where the ground rises is higher by
 * CLIFF_STEP right at the wall and fades smoothly over 4 tiles and beyond the segment's ends. */
export function _cliff_step(w, cells, gx, gy) {
    const [ax, ay] = cells[0], [bx, by] = cells[cells.length - 1];
    const dx = bx - ax, dy = by - ay;
    const L = math.hypot(dx, dy) || 1.0;
    const ux = dx / L, uy = dy / L;
    let nx = -uy, ny = ux;
    if (nx * gx + ny * gy < 0) {
        nx = -nx; ny = -ny;
    }
    const cx0 = ax + 0.5, cy0 = ay + 0.5;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const [x, y] of cells) {
        if (x < mnx) mnx = x;
        if (y < mny) mny = y;
        if (x > mxx) mxx = x;
        if (y > mxy) mxy = y;
    }
    const x0 = Math.max(1, mnx - 6);
    const x1 = Math.min(w.W - 1, mxx + 7);
    const y0 = Math.max(1, mny - 6);
    const y1 = Math.min(w.H - 1, mxy + 7);
    const WW = w.W + 2;
    const key = (x, y) => (y + 1) * WW + (x + 1);
    const wet = new Set();
    for (let y = y0 - 1; y < y1 + 1; y++)
        for (let x = x0 - 1; x < x1 + 1; x++)
            if (0 <= x && x < w.W && 0 <= y && y < w.H && (w.terrain[y][x] === WATER || w.terrain[y][x] === SHALLOW))
                wet.add(key(x, y));
    for (let y = y0; y <= y1; y++) {
        const row = w.hz[y];
        for (let x = x0; x <= x1; x++) {
            if (wet.has(key(x, y)) || wet.has(key(x - 1, y)) || wet.has(key(x, y - 1)) || wet.has(key(x - 1, y - 1)))
                continue;
            const px = x - cx0, py_ = y - cy0;
            const along = px * ux + py_ * uy;
            const side = px * nx + py_ * ny;
            if (side <= -0.2) continue;
            let d = Infinity;
            for (const [cx, cy] of cells) {
                const v = math.hypot(x - cx - 0.5, y - cy - 0.5);
                if (v < d) d = v;
            }
            const k = Math.max(0.0, Math.min(1.0, 1.0 - (d - 0.8) / 4.0));
            const out = Math.max(-along, along - L, 0.0);
            const e = Math.max(0.0, 1.0 - out / 2.5);
            const t = Math.min(1.0, (side + 0.2) / 0.6);
            const v = CLIFF_STEP * k * e * t;
            if (v > 0) row[x] = Math.min(MAX_LEVEL * ZL, row[x] + v * ZL);
        }
    }
}

/** Ground types by cell: grass of three shades in patches, earth by the starts and mines, patches of dry earth,
 * forest floor under trees (conifer - under pines/firs), sand by the water, stones under cliffs. */
export function gen_ground(w, starts) {
    const rng = _rng(w, starts, 4);
    const W = w.W, H = w.H;
    const T = w.terrain;
    const gr = new Uint8Array(W * H);
    const n1 = _noise(W, H, 9, rng);
    const n3 = _noise(W, H, 11, rng);
    const n4 = _noise(W, H, 4, rng);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const t = T[y][x];
            const i = y * W + x;
            if (t === WATER) {
                gr[i] = G['water'];
                continue;
            }
            if (t === SHALLOW) {
                gr[i] = G['shallow'];
                continue;
            }
            let g = 'grass';             // grass shades - in smooth patches at draw time (terrain_gfx)
            if (n3[y][x] > 0.7 && n4[y][x] > 0.5)
                g = (n3[y][x] < 0.78 || n1[y][x] < 0.55) ? 'dirt3' : 'dirt2';
            gr[i] = G[g];
        }
    }
    // earth around the starts (the foundation of the center) and mines
    for (const [sx, sy] of starts) {
        for (let y = sy - 8; y < sy + 9; y++) {
            for (let x = sx - 8; x < sx + 9; x++) {
                if (0 <= x && x < W && 0 <= y && y < H && T[y][x] === LAND) {
                    const d = math.hypot(x - sx, y - sy) + (n4[y][x] - 0.5) * 2.5;
                    if (d < 4.2) gr[y * W + x] = G['dirt'];
                    else if (d < 6.3) gr[y * W + x] = gr[y * W + x] !== G['dirt'] ? G['dirt2'] : gr[y * W + x];
                }
            }
        }
    }
    for (const nd of w.nodes) {
        if (nd.kind === 'gold' || nd.kind === 'stone') {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = nd.tx + dx, y = nd.ty + dy;
                    if (0 <= x && x < W && 0 <= y && y < H && T[y][x] === LAND && ((dx === 0 && dy === 0) || rng.random() < 0.8))
                        gr[y * W + x] = nd.kind === 'gold' ? G['dirt2'] : G['dirt3'];
                }
            }
        }
    }
    const themes = modules.themes;            // landscape: tree species and the conifer floor under them
    for (const nd of w.nodes) {
        if (nd.kind === 'tree' && 0 <= nd.tx && nd.tx < W && 0 <= nd.ty && nd.ty < H) {
            const sp = themes.tree_species(w, nd.tx, nd.ty);
            gr[nd.ty * W + nd.tx] = themes.is_conifer(w, sp) ? G['pine'] : G['forest'];
        }
    }
    // sand by the water (the beach is wider by the sea)
    const wide = water_rise(w);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (T[y][x] !== LAND && T[y][x] !== CLIFF) continue;
            let near = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (0 <= xx && xx < W && 0 <= yy && yy < H && (T[yy][xx] === WATER || T[yy][xx] === SHALLOW))
                        near = Math.max(near, 3 - Math.max(Math.abs(dx), Math.abs(dy)));
                }
            }
            if (near >= 2 || (near === 1 && wide && n4[y][x] > 0.4)) {
                const g = gr[y * W + x];
                if (g !== G['forest'] && g !== G['pine'])
                    gr[y * W + x] = wide ? G['beach'] : G['sand'];
            }
        }
    }
    for (const [x, y] of w.cliffs) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (0 <= xx && xx < W && 0 <= yy && yy < H && (T[yy][xx] === LAND || T[yy][xx] === CLIFF) &&
                        ((dx === 0 && dy === 0) || rng.random() < 0.3))
                    gr[yy * W + xx] = G['rocky'];
            }
        }
    }
    w.ground = gr;
}
