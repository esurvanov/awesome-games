// port of game/terrain_gfx.py
// Ground with relief: blending of types by masks (like AoE2's blendomatic), lifting by heights and slope light.
//
// The order of assembling the static ground surface (Game.build_terrain):
//   1) flat isometry: water (color by depth) - as before;
//   2) paint_ground - every land cell with its own texture (a diamond, the texture is a function of the world point, so
//      there are no seams), then on top - "overlaps" of neighbors with a higher priority (PRIORITY in game/terrain.py):
//      a mask per side (4) and per corner (4) with a noisy edge, the noise is periodic with the texture's period (4 cells) -
//      ready overlaps are cached by (type, side, x mod 4, y mod 4);
//   3) foam and other water details (naval_gfx.decorate);
//   4) relief - a vertical shift of each pixel column by the ground height (an inverse mapping over a
//      monotonic column) and multiplication by the slope light (normal . the sun at the upper right, like the sprite
//      renderer tools/render3d/camera.py SUN). Flat areas are skipped in blocks.
// The fog shift is the same, at the fog resolution (fog_rows).
//
// numpy -> typed-array loops with the same formulas (float32 storage like the numpy arrays). np.random.default_rng is
// deterministic but not numpy's PCG64 stream, so the procedural noise differs from Python's (visual only).
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as np from '../runtime/np.js';
import { TILE, HW, HH } from './data.js';
import * as tr from './terrain.js';

export { TILE, HW, HH, tr };

const f32 = Math.fround;

export const ZK = 32 * Math.sqrt(2) * Math.cos(math.radians(30));     // screen px per height cell at the sprite renderer (~39.2)
export const SUN = (() => {
    const v = Float32Array.from([0.5, -0.55, 1.5]);
    const n = f32(Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]));
    for (let i = 0; i < 3; i++) v[i] = v[i] / n;
    return v;
})();
export const LIGHT_K = 1.15;          // brightness per unit of steepness toward / away from the sun (DE slopes are noticeably contrasty)
export const LIGHT_STEEP = 0.15;
export const S = 4;                   // the step of the coarse shift grid (px)

// the atlas texture for a ground type (with fallbacks)
export const TEX = {
    'grass': ['grass'], 'grass2': ['grass2', 'grass'], 'grass3': ['grass3', 'grass'], 'dirt': ['dirt'],
    'dirt2': ['dirt2', 'dirt'], 'dirt3': ['dirt3', 'grass3', 'grass'], 'forest': ['forest'],
    'pine': ['pine', 'forest'], 'sand': ['sand'], 'beach': ['beach', 'sand'], 'shallow': ['shallow', 'sand'],
    'rocky': ['rocky', 'dirt'],
};
export const SHALLOW_TINT = [[88, 200, 220], 0.74];      // shallows: the sand of the bottom under turquoise water (the water color by the shore)
export const BLEED = { 'edge': 0.30, 'corner': 0.34 };      // how far a type with a higher priority enters its neighbor (cells)
export const JITTER = 0.75;
export const SOFT = 0.12;

export const _DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const DW = 2 * HW, DH = 2 * HH;       // the cell diamond sprite (64 x 32); per-pixel arrays are (x, y): index x * DH + y

// ============================================================ cell masks
export function _diamond() {
    // Local world coordinates (u, v) of the pixels of a 64x32 diamond (arrays (x, y)) and the "inside the cell" mask.
    const U = new Float32Array(DW * DH), V = new Float32Array(DW * DH), IN = new Uint8Array(DW * DH);
    for (let x = 0; x < DW; x++) {
        const i = f32(f32(x + 0.5) - HW);
        for (let y = 0; y < DH; y++) {
            const j = f32(y + 0.5);
            const u = f32(f32(f32(i / HW) + f32(j / HH)) * 0.5);
            const v = f32(f32(f32(j / HH) - f32(i / HW)) * 0.5);
            const k = x * DH + y;
            U[k] = u; V[k] = v;
            IN[k] = (u >= 0 && u < 1 && v >= 0 && v < 1) ? 1 : 0;
        }
    }
    return [U, V, IN];
}

export function _periodic_noise(n, cells, rng) {
    // Seamless n x n noise (the period = the size), 0..1. Returns a Float32Array [row * n + col].
    const g = Float32Array.from(rng.random([cells, cells]).data);
    const i0 = new Int32Array(n), i1 = new Int32Array(n), f = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const t = f32(f32(k * cells) / n);
        i0[k] = Math.trunc(t);
        let ff = f32(t - i0[k]);
        ff = f32(f32(ff * ff) * f32(3 - 2 * ff));
        f[k] = ff;
        i1[k] = (i0[k] + 1) % cells;
    }
    const out = new Float32Array(n * n);
    for (let r = 0; r < n; r++) {
        const ra = i0[r] * cells, rb = i1[r] * cells, fr = f[r];
        for (let c = 0; c < n; c++) {
            const fc = f[c];
            const a = f32(f32(g[ra + i0[c]] * f32(1 - fc)) + f32(g[ra + i1[c]] * fc));
            const b = f32(f32(g[rb + i0[c]] * f32(1 - fc)) + f32(g[rb + i1[c]] * fc));
            out[r * n + c] = f32(f32(a * f32(1 - fr)) + f32(b * fr));
        }
    }
    return out;
}

/** RGB bytes of a surface in (x, y) order: {w, h, px} with px[(x * h + y) * 3 + c] (pygame.surfarray.array3d). */
function _array3d(surf) {
    const [w, h] = surf.get_size();
    const rgba = pygame.image.tobytes(surf, 'RGBA');
    const px = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const s = (y * w + x) * 4, d = (x * h + y) * 3;
            px[d] = rgba[s]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s + 2];
        }
    }
    return { w, h, px };
}

export class _Painter {
    constructor(tiles) {
        // tiles - {ground type: a Surface of an isometric tile (a period of 4 cells)}.
        [this.U, this.V, this.IN] = _diamond();
        const rng = np.random.default_rng(17);
        const n1 = _periodic_noise(256, 12, rng);
        const n2 = _periodic_noise(256, 28, rng);
        const nz = new Float32Array(256 * 256);
        for (let i = 0; i < nz.length; i++) nz[i] = f32(f32(n1[i] * f32(0.65)) + f32(n2[i] * f32(0.35)));
        this.nz = nz;                          // [gy, gx] over 4x4 cells, 64 samples per cell
        this.src = {};
        for (const [g, surf] of Object.entries(tiles)) {
            this.src[g] = _array3d(surf);     // np.tile(a, (2, 2, 1)): cut-outs index modulo the tile (no wrapping seams)
        }
        this.tw = {};
        for (const [g, s] of Object.entries(tiles)) this.tw[g] = s.get_width();
        this.base = new Map();
        this.ovl = new Map();
    }

    _crop(g, a, b) {
        // The 64x32 cut-out of the (2x2-tiled) texture at the cell (a, b): Uint8Array [(x * 32 + y) * 3 + c].
        const tw = this.tw[g];
        const x = py.mod((a - b) * HW - HW, tw);
        const y = py.mod((a + b) * HH, Math.floor(tw / 2));
        const src = this.src[g];
        const out = new Uint8Array(DW * DH * 3);
        for (let i = 0; i < DW; i++) {
            const sx = (x + i) % src.w;
            for (let j = 0; j < DH; j++) {
                const sy = (y + j) % src.h;
                const s = (sx * src.h + sy) * 3, d = (i * DH + j) * 3;
                out[d] = src.px[s]; out[d + 1] = src.px[s + 1]; out[d + 2] = src.px[s + 2];
            }
        }
        return out;
    }

    base_tile(g, a, b) {
        const k = g + ',' + a + ',' + b;
        let s = this.base.get(k);
        if (s === undefined) {
            const c = this._crop(g, a, b);
            s = new pygame.Surface([DW, DH]);
            const view = pygame.surfarray.pixels3d(s);
            const d = view.data, [s0, s1, s2] = view.strides, off = view.offset;
            for (let i = 0; i < DW; i++) {
                for (let j = 0; j < DH; j++) {
                    const q = i * DH + j, o = off + i * s0 + j * s1;
                    if (this.IN[q]) { d[o] = c[q * 3]; d[o + s2] = c[q * 3 + 1]; d[o + 2 * s2] = c[q * 3 + 2]; }
                    else { d[o] = 255; d[o + s2] = 0; d[o + 2 * s2] = 255; }
                }
            }
            s.set_colorkey([255, 0, 255], pygame.RLEACCEL);
            this.base.set(k, s);
        }
        return s;
    }

    overlay(g, d, a, b) {
        const k = g + ',' + d[0] + ',' + d[1] + ',' + a + ',' + b;
        let s = this.ovl.get(k);
        if (s === undefined) {
            const U = this.U, V = this.V, IN = this.IN, nz = this.nz;
            const [dx, dy] = d;
            const corner = !!(dx && dy);
            const bleed = corner ? BLEED['corner'] : BLEED['edge'];
            const c = this._crop(g, a, b);
            s = new pygame.Surface([DW, DH], pygame.SRCALPHA);
            const rgb = pygame.surfarray.pixels3d(s);
            const alp = pygame.surfarray.pixels_alpha(s);
            const rd = rgb.data, [r0, r1, r2] = rgb.strides, ro = rgb.offset;
            const ad = alp.data, [a0, a1] = alp.strides, ao = alp.offset;
            for (let i = 0; i < DW; i++) {
                for (let j = 0; j < DH; j++) {
                    const q = i * DH + j;
                    const u = U[q], v = V[q];
                    const ex = dx > 0 ? f32(1 - u) : u;
                    const ey = dy > 0 ? f32(1 - v) : v;
                    const dist = corner ? f32(Math.sqrt(f32(f32(ex * ex) + f32(ey * ey)))) : (dx ? ex : ey);
                    const gx = Math.trunc(f32(f32(a + Math.min(Math.max(u, 0), f32(0.999))) * 64)) % 256;
                    const gy = Math.trunc(f32(f32(b + Math.min(Math.max(v, 0), f32(0.999))) * 64)) % 256;
                    const n = f32(nz[gy * 256 + gx] - 0.5);
                    let al = (bleed + n * JITTER - dist) / SOFT + 0.5;
                    al = Math.min(1, Math.max(0, al)) * IN[q];
                    const o = ro + i * r0 + j * r1;
                    rd[o] = c[q * 3]; rd[o + r2] = c[q * 3 + 1]; rd[o + 2 * r2] = c[q * 3 + 2];
                    ad[ao + i * a0 + j * a1] = Math.trunc(al * 255);
                }
            }
            this.ovl.set(k, s);
        }
        return s;
    }
}

export function load_tiles(tile_fn) {
    // Texture tiles by ground types (tile_fn(name) -> Surface | None); None - no textures.
    const out = {};
    for (const [g, names] of Object.entries(TEX)) {
        let t = null;
        for (const n of names) {
            t = tile_fn(n);
            if (t != null) break;
        }
        if (t == null) {
            if (g === 'grass') return null;
            continue;
        }
        if (g === 'shallow') {
            t = t.copy();
            const tint = new pygame.Surface(t.get_size());
            tint.fill(SHALLOW_TINT[0]);
            tint.set_alpha(Math.trunc(255 * SHALLOW_TINT[1]));
            t.blit(tint, [0, 0]);
        }
        out[g] = t;
    }
    for (const g of Object.keys(TEX)) if (!Object.hasOwn(out, g)) out[g] = out['grass'];
    return out;
}

export const _AS_GRASS = ['grass2', 'grass3'];       // grass shades are not separate cells but smooth patches (paint_grass_tones)

export function paint_ground(big, w, ox, tiles) {
    // Land and shallows cells - with the texture of their own type; smooth grass shades; at the edges - overlaps of
    // neighbors with a higher priority (a side/corner, a noisy edge).
    const p = new _Painter(tiles);
    const W = w.W, H = w.H;
    const gr = w.ground;
    const names = Array.from(tr.GROUNDS);
    for (const n of _AS_GRASS) names[tr.G[n]] = 'grass';
    const water = tr.G['water'];
    const prio = new Array(names.length).fill(0);
    Array.from(tr.PRIORITY).forEach((n, i) => { prio[tr.G[n]] = i; });
    for (const n of _AS_GRASS) prio[tr.G[n]] = prio[tr.G['grass']];
    for (let ty = 0; ty < H; ty++) {
        const row = ty * W;
        const y0 = ty * HH;
        const x0 = ox - HW - ty * HW;
        for (let tx = 0; tx < W; tx++) {
            const g = gr[row + tx];
            if (g !== water) big.blit(p.base_tile(names[g], tx & 3, ty & 3), [x0 + tx * HW, y0 + tx * HH]);
        }
    }
    paint_grass_tones(big, w, ox, tiles);
    for (let ty = 0; ty < H; ty++) {
        const row = ty * W;
        for (let tx = 0; tx < W; tx++) {
            const pg = prio[gr[row + tx]];
            let hi = null;
            for (const d of _DIRS) {
                const nx = tx + d[0], ny = ty + d[1];
                if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                    const ng = gr[ny * W + nx];
                    if (prio[ng] > pg) {
                        if (hi === null) hi = new Map();
                        if (!hi.has(ng)) hi.set(ng, []);
                        hi.get(ng).push(d);
                    }
                }
            }
            if (hi === null) continue;
            const x0 = (tx - ty) * HW + ox - HW;
            const y0 = (tx + ty) * HH;
            const a = tx & 3, b = ty & 3;
            for (const ng of py.sorted(hi.keys(), k => prio[k])) {
                const ds = hi.get(ng);
                const name = names[ng];
                for (const d of ds) {
                    if (d[0] && d[1] && (ds.some(e => e[0] === d[0] && e[1] === 0) || ds.some(e => e[0] === 0 && e[1] === d[1]))) {
                        continue;                // the corner is already covered by overlaps from the sides
                    }
                    big.blit(p.overlay(name, d, a, b), [x0, y0]);
                }
            }
        }
    }
    // ripples on the shallows
    const rnd = random.Random(23);
    const shallow = tr.G['shallow'];
    for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
            if (gr[ty * W + tx] !== shallow) continue;
            for (let i = 0; i < 2; i++) {
                const wx = (tx + rnd.random()) * TILE;
                const wy = (ty + rnd.random()) * TILE;
                const ix = wx - wy + ox, iy = (wx + wy) * 0.5;
                const L = rnd.randint(4, 9);
                pygame.draw.line(big, [170, 222, 222], [Math.trunc(ix), Math.trunc(iy)], [Math.trunc(ix + L), Math.trunc(iy)], 1);
            }
        }
    }
    return true;
}

export function _smooth_noise(W, H, cell, seed) {
    // -> np.NDArray float32 (H, W)
    const rng = np.random.default_rng(seed);
    const gh = Math.floor(H / cell) + 3, gw = Math.floor(W / cell) + 3;
    const g = Float32Array.from(rng.random([gh, gw]).data);
    const x0 = new Int32Array(W), fx = new Float32Array(W);
    for (let x = 0; x < W; x++) {
        const xs = f32(x / cell);
        x0[x] = Math.trunc(xs);
        const f = f32(xs - x0[x]);
        fx[x] = f32(f32(f * f) * f32(3 - 2 * f));
    }
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        const ys = f32(y / cell);
        const y0 = Math.trunc(ys);
        let fy = f32(ys - y0);
        fy = f32(f32(fy * fy) * f32(3 - 2 * fy));
        const r0 = y0 * gw, r1 = (y0 + 1) * gw;
        for (let x = 0; x < W; x++) {
            const a = x0[x], f = fx[x];
            const top = f32(f32(g[r0 + a] * f32(1 - f)) + f32(g[r0 + a + 1] * f));
            const bot = f32(f32(g[r1 + a] * f32(1 - f)) + f32(g[r1 + a + 1] * f));
            out[y * W + x] = f32(f32(top * f32(1 - fy)) + f32(bot * fy));
        }
    }
    return new np.NDArray(out, [H, W]);
}

export function _iso_mask(a, size) {
    // A per-cell field (H, W) 0..1 -> an isometric alpha mask of size size (rotation and squeeze, like the minimap).
    const [H, W] = a.shape;
    const src = np.ascontiguousarray(a).data;
    const bytes = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
        const v = Math.trunc(f32(Math.min(1, Math.max(0, src[i])) * 255));
        bytes[i * 3] = bytes[i * 3 + 1] = bytes[i * 3 + 2] = v;
    }
    const s = pygame.image.frombuffer(bytes, [W, H], 'RGB');
    const sq = pygame.transform.smoothscale(s, [W * 6, H * 6]);
    const rot = pygame.transform.rotate(sq, -45);
    return pygame.transform.smoothscale(rot, size);
}

/** layer.blit(alpha, (0, 0), special_flags=BLEND_RGBA_MULT) for an alpha source whose RGB is white: equal to scaling
 * the destination alpha (pygame: (d * 255 + 255) >> 8 == d for the color) - done by canvas composition instead of
 * reading two full-map surfaces back into memory. Falls back to the pixel blend for anything else. */
function _rt_mul_alpha(layer, alpha) {
    if (typeof layer._wctx !== 'function' || typeof alpha._src !== 'function' || layer.get_size()[0] !== alpha.get_size()[0]
        || layer.get_size()[1] !== alpha.get_size()[1] || layer.get_parent() || alpha.get_parent()) {
        layer.blit(alpha, [0, 0], null, pygame.BLEND_RGBA_MULT);
        return;
    }
    const ctx = layer._wctx();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(alpha._src(), 0, 0);
    ctx.restore();
    layer._wrote();
}

export function paint_grass_tones(big, w, ox, tiles) {
    // Grass shades (grass2 - darker, grass3 - drier) in smooth patches over grass far from other types.
    const W = w.W, H = w.H;
    const g = w.ground;
    const gset = [tr.G['grass'], tr.G['grass2'], tr.G['grass3']];
    const grassy = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) grassy[i] = gset.includes(g[i]) ? 1 : 0;
    // only deep inside the grass: overlaps of neighboring types are laid on top later
    const inner = grassy.slice();
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let v = inner[i];
            if (y >= 1) v *= grassy[i - W];
            if (y < H - 1) v *= grassy[i + W];
            if (x >= 1) v *= grassy[i - 1];
            if (x < W - 1) v *= grassy[i + 1];
            inner[i] = v;
        }
    }
    const [tw, th] = big.get_size();
    const qs = [Math.floor(tw / 4), Math.floor(th / 4)];
    for (const [name, cell, seed, lo] of [['grass2', 9, 31, 0.5], ['grass3', 6, 32, 0.56]]) {
        const tile = py.get(tiles, name);
        if (tile == null || tile === py.get(tiles, 'grass')) continue;
        const n = _smooth_noise(W, H, cell, seed).data;
        const a = new Float32Array(W * H);
        let amax = -Infinity;
        for (let i = 0; i < W * H; i++) {
            a[i] = f32(Math.min(0.85, Math.max(0, f32(f32(n[i] - lo) * 4.0))) * inner[i]);
            if (a[i] > amax) amax = a[i];
        }
        if (amax <= 0.02) continue;
        const m = _iso_mask(new np.NDArray(a, [H, W]), qs);
        const layer = new pygame.Surface([tw, th], pygame.SRCALPHA);
        const [tw0, th0] = tile.get_size();
        const x0 = py.mod(ox, tw0) - tw0;                      // the same world anchoring as the _Painter cut-outs
        for (let y = 0; y < th; y += th0) {
            for (let x = x0; x < tw; x += tw0) layer.blit(tile, [x, y]);
        }
        const alpha = new pygame.Surface(qs, pygame.SRCALPHA);
        alpha.fill([255, 255, 255, 0]);
        const av = pygame.surfarray.pixels_alpha(alpha), mv = pygame.surfarray.pixels3d(m);
        for (let x = 0; x < qs[0]; x++) {
            for (let y = 0; y < qs[1]; y++) {
                av.data[av.offset + x * av.strides[0] + y * av.strides[1]] = mv.data[mv.offset + x * mv.strides[0] + y * mv.strides[1]];
            }
        }
        _rt_mul_alpha(layer, pygame.transform.smoothscale(alpha, [tw, th]));
        big.blit(layer, [0, 0]);
    }
}

// ============================================================ relief and light
function _grid(a) {
    // a numpy-like 2-D float32 grid from a list of lists / NDArray: {data: Float32Array, rows, cols}
    if (a instanceof np.NDArray) {
        const c = np.ascontiguousarray(a);
        return { data: c.data instanceof Float32Array ? c.data : Float32Array.from(c.data), rows: c.shape[0], cols: c.shape[1] };
    }
    const rows = a.length, cols = rows ? a[0].length : 0;
    const data = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) { const row = a[r]; for (let c = 0; c < cols; c++) data[r * cols + c] = row[c]; }
    return { data, rows, cols };
}

export function _vertex_light(hz) {
    // The light multiplier at vertices: 1 - flat ground, > 1 - a slope toward the sun, < 1 - away from it.
    // Like AoE2's lighting maps: brightness linear in steepness along the sun's horizontal direction
    // (the upper right of the screen), with a small contribution of steepness in general (any slope is slightly darker than a plain).
    const G = _grid(hz);
    const R = G.rows, C = G.cols, hd = G.data;
    const h = new Float32Array(R * C);
    for (let i = 0; i < R * C; i++) h[i] = hd[i] / ZK;                  // height in cells
    const gx = new Float32Array(R * C), gy = new Float32Array(R * C);
    for (let r = 0; r < R; r++) for (let c = 1; c < C - 1; c++) gx[r * C + c] = (h[r * C + c + 1] - h[r * C + c - 1]) * 0.5;
    for (let r = 1; r < R - 1; r++) for (let c = 0; c < C; c++) gy[r * C + c] = (h[(r + 1) * C + c] - h[(r - 1) * C + c]) * 0.5;
    const lx = SUN[0], ly = SUN[1];
    const k = 1.0 / math.hypot(lx, ly);
    const out = new Float32Array(R * C);
    for (let i = 0; i < R * C; i++) {
        const toward = -(gx[i] * lx + gy[i] * ly) * k;         // > 0 - the slope faces the sun
        const steep = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
        out[i] = Math.min(1.45, Math.max(0.5, 1.0 + LIGHT_K * toward - LIGHT_STEEP * steep));
    }
    return new np.NDArray(out, [R, C]);
}

export function _bilinear(grid, fx, fy) {
    // Sampling the vertex grid (H+1, W+1) at the points (fx, fy) (cells), beyond the edge - the edge.
    // grid - NDArray (Hh, Ww); fx, fy - NDArrays of one shape (or numbers) -> NDArray float32 of that shape.
    const G = _grid(grid);
    const Hh = G.rows, Ww = G.cols, gd = G.data;
    const scalar = typeof fx === 'number';
    const X = scalar ? [fx] : np.ascontiguousarray(fx).data, Y = scalar ? [fy] : np.ascontiguousarray(fy).data;
    const out = new Float32Array(X.length);
    for (let i = 0; i < X.length; i++) out[i] = _bil1(gd, Ww, Hh, X[i], Y[i]);
    return scalar ? out[0] : new np.NDArray(out, fx.shape.slice());
}

function _bil1(gd, Ww, Hh, fx, fy) {
    fx = f32(Math.min(Math.max(fx, 0), Ww - 1.001));
    fy = f32(Math.min(Math.max(fy, 0), Hh - 1.001));
    const x0 = Math.trunc(fx), y0 = Math.trunc(fy);
    const ax = f32(fx - x0), ay = f32(fy - y0);
    const r0 = y0 * Ww, r1 = r0 + Ww;
    const a = gd[r0 + x0] * (1 - ax) + gd[r0 + x0 + 1] * ax;
    const b = gd[r1 + x0] * (1 - ax) + gd[r1 + x0 + 1] * ax;
    return a * (1 - ay) + b * ay;
}

export function _to_tiles(ix, iy, ox) {
    // Isometry (flat) -> world cells. Numbers or broadcastable NDArrays.
    if (typeof ix === 'number' && typeof iy === 'number') {
        const x = (ix - ox + 2 * iy) * 0.5;
        const y = (2 * iy - (ix - ox)) * 0.5;
        return [x / TILE, y / TILE];
    }
    const d = np.subtract(ix, ox);
    const x = np.multiply(np.add(d, np.multiply(iy, 2)), 0.5);
    const y = np.multiply(np.subtract(np.multiply(iy, 2), d), 0.5);
    return [np.divide(x, TILE), np.divide(y, TILE)];
}

// np.interp(x, xp, fp) for one x (numpy's algorithm: the last j with xp[j] <= x; exact hits return fp[j])
function _interp1(x, xp, fp, n, stride, off) {
    const X = i => xp[off + i * stride];
    if (x < X(0)) return fp[0];
    if (x > X(n - 1)) return fp[n - 1];
    let lo = 0, hi = n;                       // bisect_right
    while (lo < hi) { const mid = (lo + hi) >> 1; if (x < X(mid)) hi = mid; else lo = mid + 1; }
    const j = lo - 1;
    if (j >= n - 1) return fp[n - 1];
    const xj = X(j);
    if (xj === x) return fp[j];
    const slope = (fp[j + 1] - fp[j]) / (X(j + 1) - xj);
    let r = slope * (x - xj) + fp[j];
    if (Number.isNaN(r)) r = slope * (x - X(j + 1)) + fp[j + 1];
    return r;
}

export class Relief {
    // A coarse inverse-shift grid: for a screen point (x, sy) - the flat-isometry row iy = sy + D.
    constructor(w, ox, tw, th) {
        this.tw = tw; this.th = th;
        const hzg = _grid(w.hz);
        let hzmax = -Infinity;
        for (const v of hzg.data) if (v > hzmax) hzmax = v;
        this.flat = !py.bool(w.relief) || hzmax <= 0.01;
        const nc = Math.floor(tw / S) + 2;
        const nr = Math.floor(th / S) + 2;
        this.D = np.zeros([nr, nc], 'float32');
        this.L = np.ones([nr, nc], 'float32');
        if (this.flat) return;
        const hz = new np.NDArray(hzg.data, [hzg.rows, hzg.cols]);
        const light = _grid(_vertex_light(hz));
        const HR = hzg.rows, HC = hzg.cols;
        const ny = nr + Math.floor(Math.trunc(hzmax) / S) + 4;
        const X = new Float32Array(nc), Y = new Float32Array(ny), T = new Float32Array(nr);
        for (let c = 0; c < nc; c++) X[c] = c * S;
        for (let r = 0; r < ny; r++) Y[r] = r * S;
        for (let r = 0; r < nr; r++) T[r] = r * S;
        // sy = maximum.accumulate(Y[:, None] - z, axis=0), column-major here: sy[c * ny + r]
        const sy = new Float32Array(nc * ny);
        for (let c = 0; c < nc; c++) {
            let run = -Infinity;
            for (let r = 0; r < ny; r++) {
                const ix = X[c], iy = Y[r];
                const fx = f32(f32(f32(ix - ox) + f32(2 * iy)) * 0.5 / TILE);
                const fy = f32(f32(f32(2 * iy) - f32(ix - ox)) * 0.5 / TILE);
                const z = f32(_bil1(hzg.data, HC, HR, fx, fy));
                const v = f32(Y[r] - z);
                if (v > run) run = v;
                sy[c * ny + r] = run;
            }
        }
        const D = this.D.data, L = this.L.data;
        for (let c = 0; c < nc; c++) {
            for (let r = 0; r < nr; r++) {
                const iy = f32(_interp1(T[r], sy, Y, ny, 1, c * ny));
                D[r * nc + c] = iy - T[r];
                const ix = X[c];
                const fx = f32(f32(f32(ix - ox) + f32(2 * iy)) * 0.5 / TILE);
                const fy = f32(f32(f32(2 * iy) - f32(ix - ox)) * 0.5 / TILE);
                L[r * nc + c] = _bil1(light.data, light.cols, light.rows, fx, fy);
            }
        }
    }

    apply(surf, block = 64) {
        // Shift and light the ground surface in place (top to bottom: rows are taken only from below).
        // Python works on pixels3d of the whole surface; here each block reads the rows it needs (tobytes of a
        // subsurface) and writes its result back - the same numbers, without holding the full map in memory twice.
        if (this.flat) return;
        const tw = this.tw, th = this.th;
        const [sw, sh] = surf.get_size();
        const opaque = !(surf.get_flags() & pygame.SRCALPHA);
        const nc = this.D.shape[1], nr = this.D.shape[0];
        const D = this.D.data, L = this.L.data;
        const bs = Math.floor(block / S);
        for (let y0 = 0; y0 < th; y0 += block) {
            const y1 = Math.min(th, y0 + block);
            const r0 = Math.floor(y0 / S);
            for (let x0 = 0; x0 < tw; x0 += block * 4) {
                const x1 = Math.min(tw, x0 + block * 4);
                const c0 = Math.floor(x0 / S);
                const c1 = Math.min(nc - 1, Math.floor((x1 - 1) / S) + 1);
                const r1 = Math.min(nr - 1, r0 + bs);
                let dmax = -Infinity, lmax = 0;
                for (let r = r0; r <= r1; r++) {
                    for (let c = c0; c <= c1; c++) {
                        const dv = D[r * nc + c], lv = Math.abs(L[r * nc + c] - 1);
                        if (dv > dmax) dmax = dv;
                        if (lv > lmax) lmax = lv;
                    }
                }
                if (dmax < 0.5 && lmax < 0.01) continue;
                const bh = r1 - r0 + 1, bw = c1 - c0 + 1;       // dblk shape (bh, bw)
                const bxw = x1 - x0, byh = y1 - y0;
                // per-pixel shift d and light lt (x, y), float32 like numpy
                const dd = new Float32Array(bxw * byh), ll = new Float32Array(bxw * byh);
                const srcRow = new Int32Array(bxw * byh), frac = new Float32Array(bxw * byh);
                let smin = Infinity, smax = -Infinity;
                for (let xi = 0; xi < bxw; xi++) {
                    const cx = f32(f32((x0 + xi) / S) - c0);
                    const ix0 = Math.min(Math.trunc(cx), bw - 2);
                    const fx = f32(cx - ix0);
                    for (let yi = 0; yi < byh; yi++) {
                        const ry = f32(f32((y0 + yi) / S) - r0);
                        const iy0 = Math.min(Math.trunc(ry), bh - 2);
                        const fy = f32(ry - iy0);
                        const q00 = (r0 + iy0) * nc + c0 + ix0, q01 = q00 + nc;
                        const d = f32((D[q00] * (1 - fx) + D[q00 + 1] * fx) * (1 - fy) + (D[q01] * (1 - fx) + D[q01 + 1] * fx) * fy);
                        const lt = f32((L[q00] * (1 - fx) + L[q00 + 1] * fx) * (1 - fy) + (L[q01] * (1 - fx) + L[q01 + 1] * fx) * fy);
                        const sf = f32((y0 + yi) + d);
                        const src = Math.min(Math.trunc(sf), th - 2);
                        const k = xi * byh + yi;
                        dd[k] = d; ll[k] = lt;
                        srcRow[k] = src;
                        frac[k] = Math.min(1, Math.max(0, f32(sf - src)));
                        if (src < smin) smin = src;
                        if (src + 1 > smax) smax = src + 1;
                    }
                }
                // the source rows smin..smax of columns x0..x1 (unmodified yet: rows below, or this block - buffered)
                const rs = Math.max(0, smin), re = Math.min(sh - 1, smax);
                const rows = re - rs + 1;
                const region = pygame.image.tobytes(surf.subsurface([x0, rs, bxw, rows]), 'RGBA');
                const outb = new Uint8Array(bxw * byh * 4);
                for (let xi = 0; xi < bxw; xi++) {
                    for (let yi = 0; yi < byh; yi++) {
                        const k = xi * byh + yi;
                        const src = srcRow[k], f = frac[k], lt = ll[k];
                        const a = ((src - rs) * bxw + xi) * 4, b = a + bxw * 4;
                        const o = (yi * bxw + xi) * 4;
                        for (let ch = 0; ch < 3; ch++) {
                            let p = region[a + ch];
                            p = f32(p + f32((region[b + ch] - p) * f));
                            p = f32(p * lt);
                            outb[o + ch] = Math.trunc(Math.min(255, Math.max(0, p)));
                        }
                        outb[o + 3] = 255;
                    }
                }
                if (opaque) {
                    surf.blit(pygame.image.frombuffer(outb, [bxw, byh], 'RGBX'), [x0, y0]);
                } else {
                    // pixels3d writes only the color: keep the destination alpha
                    const view = pygame.surfarray.pixels3d(surf.subsurface([x0, y0, bxw, byh]));
                    const vd = view.data, [v0, v1, v2] = view.strides, vo = view.offset;
                    for (let xi = 0; xi < bxw; xi++) {
                        for (let yi = 0; yi < byh; yi++) {
                            const o = (yi * bxw + xi) * 4, q = vo + xi * v0 + yi * v1;
                            vd[q] = outb[o]; vd[q + v2] = outb[o + 1]; vd[q + 2 * v2] = outb[o + 2];
                        }
                    }
                }
            }
        }
    }

    fog_rows(fw, fh, fs) {
        // For fog at 1/fs resolution: the source row (fw, fh) of each fog pixel (or None).
        // -> np.NDArray int32 of shape (fw, fh) - (x, y) like pixels_alpha.
        if (this.flat) return null;
        const k = Math.floor(fs / S);
        const nr = this.D.shape[0], nc = this.D.shape[1], D = this.D.data;
        const dr = Math.min(fh, Math.ceil(nr / k)), dc = Math.min(fw, Math.ceil(nc / k));   // D[::k, ::k][:fh, :fw]
        const full = new Float32Array(fh * fw);
        for (let r = 0; r < dr; r++) {
            for (let c = 0; c < dc; c++) full[r * fw + c] = f32(r + f32(D[(r * k) * nc + c * k] / fs));
        }
        if (dr < fh || dc < fw) {
            for (let r = dr; r < fh; r++) for (let c = 0; c < fw; c++) full[r * fw + c] = r;
        }
        const out = new Int32Array(fw * fh);
        for (let x = 0; x < fw; x++) {
            for (let y = 0; y < fh; y++) out[x * fh + y] = Math.min(Math.trunc(f32(full[y * fw + x] + 0.5)), fh - 1);
        }
        return new np.NDArray(out, [fw, fh]);
    }
}

export function warp_fog(fog, rows) {
    // Shift the fog alpha up along the relief (rows - from Relief.fog_rows).
    if (rows == null) return;
    const a = pygame.surfarray.pixels_alpha(fog);
    if (!py.eq(a.shape, rows.shape)) return;
    const [fw, fh] = a.shape;
    const d = a.data, [s0, s1] = a.strides, o = a.offset;
    const rd = np.ascontiguousarray(rows).data;
    const col = new Uint8Array(fh);
    for (let x = 0; x < fw; x++) {
        const base = o + x * s0;
        for (let y = 0; y < fh; y++) col[y] = d[base + y * s1];
        for (let y = 0; y < fh; y++) d[base + y * s1] = col[rd[x * fh + y]];
    }
}

// ============================================================ minimap
export function minimap_colors(w, water_color, depth, de = false) {
    // Cell colors by ground type, lighter at higher levels (as in AoE2), water - by depth.
    // de=False - the world backing under the textures (the former palette, in which the world's water is visible too);
    // de=True - the minimap in the AoE II DE palette taking the landscape into account (game/themes.py): grass #00A900,
    // water #004ABB, shallows #305DB6, cliff #714B33.
    const themes = modules.themes;
    const W = w.W, H = w.H;
    const out = [];
    const gr = w.ground;
    const em = w.elev_map;
    const names = tr.GROUNDS;
    const pal = de ? Array.from(names, n => themes.mm_color(w, n)) : Array.from(names, n => tr.MM_COLOR[n]);
    for (let y = 0; y < H; y++) {
        const row = [];
        for (let x = 0; x < W; x++) {
            const t = w.terrain[y][x];
            if (t === tr.WATER) {
                if (de) row.push(depth[y][x] <= 1 ? themes.MM_WATER_NEAR : themes.MM_WATER);
                else row.push(water_color(depth[y][x]));
                continue;
            }
            let c = pal[gr[y * W + x]];
            if (t === tr.CLIFF) c = de ? themes.MM_CLIFF : [116, 100, 82];
            const k = 1.0 + (de ? 0.04 : 0.06) * em[y * W + x];
            row.push(Array.from(c, v => Math.max(0, Math.min(255, Math.trunc(v * k)))));
        }
        out.push(row);
    }
    return out;
}
