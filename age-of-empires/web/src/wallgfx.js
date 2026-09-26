// port of game/wallgfx.py
// Procedural wall and gate graphics: segments connect to their neighbors (the defense.wall_mask mask).
// A palisade - pointed logs; a stone wall - blocks with battlements; a gate - two towers and leaves
// (open when own units are nearby). Sprites are cached by (kind, color, mask / orientation, open).
// They return (surface, ox, oy): (ox, oy) is the top corner of the base diamond inside the sprite.
import * as py from '../runtime/py.js';
import { math } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { BUILDINGS, HW, HH, shade } from './data.js';
import { DIR8 } from './defense.js';
import * as sprites3d from './sprites3d.js';

export { BUILDINGS, HW, HH, shade, DIR8, sprites3d };

export const _cache = new Map();

export const LOG = [146, 102, 58];
export const LOG_TIP = [196, 160, 112];
export const STONE = [178, 172, 160];
export const WOOD_DOOR = [122, 84, 50];

export const EXTRA = 74;          // a height margin above the cell's diamond

export function is_palisade(kind) {
    return kind.startsWith('palisade');
}

export function _canvas(w, h, extra = EXTRA) {
    const W = (w + h) * HW + 8;
    const Hh = (w + h) * HH + extra + 4;
    const surf = new pygame.Surface([W, Hh], pygame.SRCALPHA);
    return [surf, h * HW + 4, extra];
}

export class _P {
    // A mini-painter: cell coordinates (x, y) and height z in pixels.
    constructor(surf, ox, oy) {
        this.s = surf;
        this.ox = ox; this.oy = oy;
    }

    P(x, y, z = 0.0) {
        return [this.ox + (x - y) * HW, this.oy + (x + y) * HH - z];
    }

    poly(pts, color, outline = true) {
        const sp = pts.map(p => this.P(...p));
        pygame.draw.polygon(this.s, color, sp);
        if (outline) pygame.draw.polygon(this.s, shade(color, -60), sp, 1);
    }

    box(x0, y0, x1, y1, h, color, z0 = 0.0, top = true, mortar = false) {
        const rc = shade(color, -38);
        this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z0 + h], [x0, y1, z0 + h]], color);
        this.poly([[x1, y1, z0], [x1, y0, z0], [x1, y0, z0 + h], [x1, y1, z0 + h]], rc);
        if (mortar) {
            for (let z = Math.trunc(z0) + 7; z < Math.trunc(z0 + h) - 2; z += 7) {
                pygame.draw.line(this.s, shade(color, -24), this.P(x0, y1, z), this.P(x1, y1, z));
                pygame.draw.line(this.s, shade(rc, -24), this.P(x1, y1, z), this.P(x1, y0, z));
            }
        }
        if (top) this.poly([[x0, y0, z0 + h], [x1, y0, z0 + h], [x1, y1, z0 + h], [x0, y1, z0 + h]], shade(color, 22));
    }
}

// ============================================================ palisade
export function _log(p, x, y, h, r, band = null) {
    const [bx, by] = p.P(x, y, 0);
    const top = by - h;
    const s = p.s;
    pygame.draw.polygon(s, LOG, [[bx - r, by], [bx, by + 1], [bx, top + 1], [bx - r, top]]);
    pygame.draw.polygon(s, shade(LOG, -42), [[bx, by + 1], [bx + r, by], [bx + r, top], [bx, top + 1]]);
    pygame.draw.polygon(s, LOG_TIP, [[bx - r, top], [bx, top + 1], [bx + r, top], [bx, top - r * 1.9]]);
    pygame.draw.line(s, shade(LOG, -75), [bx - r, by], [bx - r, top], 1);
    pygame.draw.line(s, shade(LOG, -85), [bx + r, by], [bx + r, top], 1);
    if (band) pygame.draw.line(s, band, [bx - r + 1, top + 7], [bx + r - 1, top + 7], 2);
}

export function _palisade_piece(p, mask, color) {
    const logs = [[0.5, 0.5, 29, 4.5]];
    DIR8.forEach(([dx, dy], i) => {
        if (!(mask & (1 << i))) return;
        const L = 0.5 * math.hypot(dx, dy);
        const n = Math.max(2, Math.trunc(py.round(L / 0.13)));
        for (let k = 1; k < n + 1; k++) {
            const t = 0.5 * k / n;
            const h = 24 + ((k * 5 + i) % 3) * 2;
            logs.push([0.5 + dx * t, 0.5 + dy * t, h, 3.6]);
        }
    });
    if (!mask) logs.push([0.3, 0.5, 25, 3.6], [0.7, 0.5, 26, 3.6], [0.5, 0.3, 24, 3.6], [0.5, 0.7, 25, 3.6]);
    py.sort(logs, l => [l[0] + l[1], l[0] - l[1]]);
    for (const [x, y, h, r] of logs) _log(p, x, y, h, r, color);
}

// ============================================================ stone
export function _slab(p, ax, ay, bx, by, t, H, color, band) {
    let ux = bx - ax, uy = by - ay;
    const L = math.hypot(ux, uy);
    if (L < 1e-6) return;
    ux = ux / L; uy = uy / L;
    const nx = -uy, ny = ux;
    const a1 = [ax + nx * t / 2, ay + ny * t / 2];
    const b1 = [bx + nx * t / 2, by + ny * t / 2];
    const a2 = [ax - nx * t / 2, ay - ny * t / 2];
    const b2 = [bx - nx * t / 2, by - ny * t / 2];

    const lit = (fx, fy) => {
        const px = Math.max(0.0, fx), pyy = Math.max(0.0, fy);
        return shade(color, Math.trunc(-38 * px / (px + pyy + 1e-9)));
    };

    const faces = [];
    for (const [c, d, fx, fy] of [[a1, b1, nx, ny], [a2, b2, -nx, -ny]]) {
        if (fx + fy > 1e-6) faces.push([c, d, fx, fy]);
    }
    for (const [c, d, fx, fy] of faces) {
        const col = lit(fx, fy);
        p.poly([[c[0], c[1], 0], [d[0], d[1], 0], [d[0], d[1], H], [c[0], c[1], H]], col);
        for (let z = 7; z < H - 2; z += 7) pygame.draw.line(p.s, shade(col, -22), p.P(c[0], c[1], z), p.P(d[0], d[1], z));
        // staggered vertical seams
        const n = Math.max(1, Math.trunc(L / 0.22));
        for (let k = 1; k < n; k++) {
            const f = k / n;
            const x = c[0] + (d[0] - c[0]) * f;
            const y = c[1] + (d[1] - c[1]) * f;
            const z0 = 7 * (k % 2);
            for (let z = z0; z < H - 7; z += 14) pygame.draw.line(p.s, shade(col, -22), p.P(x, y, z), p.P(x, y, z + 7));
        }
        if (band) pygame.draw.line(p.s, band, p.P(c[0], c[1], H - 3), p.P(d[0], d[1], H - 3), 2);
    }
    if (ux + uy > 1e-6) {
        const col = lit(ux, uy);
        p.poly([[b1[0], b1[1], 0], [b2[0], b2[1], 0], [b2[0], b2[1], H], [b1[0], b1[1], H]], col);
    }
    p.poly([[a1[0], a1[1], H], [b1[0], b1[1], H], [b2[0], b2[1], H], [a2[0], a2[1], H]], shade(color, 20));
    // battlements
    const n = Math.max(1, Math.trunc(py.round(L / 0.25)));
    const sz = 0.13;
    for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        if (k % 2 === 0) p.box(x - sz / 2, y - sz / 2, x + sz / 2, y + sz / 2, 6, color, H);
    }
}

export function _stone_piece(p, mask, pcolor) {
    const color = STONE;
    const dirs = DIR8.filter((d, i) => mask & (1 << i)).map(([dx, dy]) => [dx, dy]);
    const straight = dirs.length === 2 && dirs[0][0] === -dirs[1][0] && dirs[0][1] === -dirs[1][1];
    const post = !straight;
    const ph = 0.25;
    const t = 0.42, H = 30;
    const back = py.sorted(dirs.filter(d => d[0] + d[1] < 0), d => d[0] + d[1]);
    const side = dirs.filter(d => d[0] + d[1] === 0);
    const front = py.sorted(dirs.filter(d => d[0] + d[1] > 0), d => d[0] + d[1]);

    const seg = (d) => {
        const [dx, dy] = d;
        const L = math.hypot(dx, dy);
        const s0 = post ? (ph * (dx && dy ? 1.414 : 1.0)) : 0.0;
        const ax = 0.5 + dx / L * s0, ay = 0.5 + dy / L * s0;
        _slab(p, ax, ay, 0.5 + dx * 0.5, 0.5 + dy * 0.5, t, H, color, pcolor);
    };

    for (const d of back.concat(side)) seg(d);
    if (post) {
        p.box(0.5 - ph, 0.5 - ph, 0.5 + ph, 0.5 + ph, H + 8, color, undefined, undefined, true);
        for (const [cx, cy] of [[0.5 - ph, 0.5 - ph], [0.5 + ph - 0.13, 0.5 - ph], [0.5 - ph, 0.5 + ph - 0.13],
            [0.5 + ph - 0.13, 0.5 + ph - 0.13]]) {
            p.box(cx, cy, cx + 0.13, cy + 0.13, 6, color, H + 8);
        }
    }
    for (const d of front) seg(d);
}

export function _band(p, color, mask) {
    // The owner's pennant on a post.
    const [bx, by] = p.P(0.5, 0.5, mask != null ? 44 : 40);
    pygame.draw.line(p.s, [70, 50, 35], [bx, by], [bx, by - 14], 2);
    pygame.draw.polygon(p.s, color, [[bx + 1, by - 14], [bx + 10, by - 11], [bx + 1, by - 7]]);
}

export function piece_sprite(kind, color, mask, civ = null) {
    // A wall-segment sprite taking connections into account (mask - DIR8 bits). With civ - from 3D renders (if any).
    if (civ != null) {
        const r3 = sprites3d.wall_piece(kind, civ, color, mask, DIR8);
        if (r3 != null) return r3;
    }
    const key = py.tkey(['w', kind, color, mask]);
    let spr = _cache.get(key);
    if (spr === undefined) {
        const [surf, ox, oy] = _canvas(1, 1);
        const p = new _P(surf, ox, oy);
        // shadow
        const sh = new pygame.Surface(surf.get_size(), pygame.SRCALPHA);
        pygame.draw.polygon(sh, [0, 0, 0, 45], [[ox + 6 - HW * 0.6, oy + HH + 2], [ox + 6, oy + HH * 0.4 + 2],
            [ox + 6 + HW * 0.6, oy + HH + 2], [ox + 6, oy + HH * 1.6 + 2]]);
        surf.blit(sh, [0, 0]);
        if (is_palisade(kind)) {
            _palisade_piece(p, mask, color);
        } else {
            _stone_piece(p, mask, color);
            const dirs = DIR8.filter((d, i) => mask & (1 << i));
            if (dirs.length !== 2 || dirs[0][0] !== -dirs[1][0] || dirs[0][1] !== -dirs[1][1]) _band(p, color, mask);
        }
        spr = [surf, ox, oy];
        _cache.set(key, spr);
    }
    return spr;
}

// ============================================================ gates
export function gate_sprite(kind, color, horiz, opened, civ = null) {
    if (civ != null) {
        const r3 = sprites3d.gate(kind, civ, color, horiz, opened);
        if (r3 != null) return r3;
    }
    const key = py.tkey(['g', kind, color, !!horiz, !!opened]);
    let spr = _cache.get(key);
    if (spr !== undefined) return spr;
    const span = py.get(BUILDINGS[kind], 'span', 4);
    const [w, h] = horiz ? [span, 1] : [1, span];
    const [surf, ox, oy] = _canvas(w, h, 90);
    const p = new _P(surf, ox, oy);

    const M = (u, v) => (horiz ? [u, v] : [v, u]);

    const ubox = (u0, v0, u1, v1, hh, col, z0 = 0.0, top = true, mortar = false) => {
        const [x0, y0] = M(u0, v0);
        const [x1, y1] = M(u1, v1);
        p.box(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), hh, col, z0, top, mortar);
    };

    // shadow
    const sh = new pygame.Surface(surf.get_size(), pygame.SRCALPHA);
    const pts = [p.P(...M(0.1, 0.2)), p.P(...M(span - 0.1, 0.2)), p.P(...M(span - 0.1, 0.9)), p.P(...M(0.1, 0.9))];
    pygame.draw.polygon(sh, [0, 0, 0, 50], pts.map(([x, y]) => [x + 8, y + 2]));
    surf.blit(sh, [0, 0]);
    const e = span - 1.0;
    if (is_palisade(kind)) {
        const logs = [];
        for (const u0 of [0.0, e]) {
            for (const [a, b] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.5]]) {
                logs.push([...M(u0 + a, b), (a === 0.5 && b === 0.5) ? 36 : 32, 4.6]);
            }
        }
        if (!opened) {
            const n = Math.trunc((e - 1.0) / 0.13);
            for (let k = 0; k < n + 1; k++) logs.push([...M(1.0 + (e - 1.0) * k / n, 0.5), 22 + (k % 3) * 2, 3.6]);
        } else {
            for (const [u0, sgn] of [[1.05, 1], [e - 0.05, -1]]) {
                for (let k = 0; k < 4; k++) logs.push([...M(u0 + sgn * 0.02, 0.55 + k * 0.12), 22, 3.4]);
            }
        }
        py.sort(logs, l => [l[0] + l[1], l[0] - l[1]]);
        for (const [x, y, hh, r] of logs) _log(p, x, y, hh, r, color);
        ubox(0.8, 0.42, e + 0.2, 0.58, 5, shade(LOG, -10), 30);
        for (const u0 of [0.5, e + 0.5]) {
            const [x, y] = M(u0, 0.5);
            const [bx, by] = p.P(x, y, 40);
            pygame.draw.line(surf, [70, 50, 35], [bx, by], [bx, by - 14], 2);
            pygame.draw.polygon(surf, color, [[bx + 1, by - 14], [bx + 10, by - 11], [bx + 1, by - 7]]);
        }
    } else {
        const H = 52;
        const TOWER = [[0.05, 0.08], [0.8, 0.08], [0.05, 0.77], [0.8, 0.77], [0.42, 0.08], [0.05, 0.42],
            [0.8, 0.42], [0.42, 0.77]];
        ubox(0.05, 0.08, 0.95, 0.92, H, STONE, undefined, undefined, true);
        for (const [a, b] of TOWER) ubox(a, b, a + 0.15, b + 0.15, 7, STONE, H);
        if (!opened) {
            ubox(0.95, 0.44, e + 0.05, 0.56, 34, WOOD_DOOR);
            for (let k = 1; k < 8; k++) {
                const u = 0.95 + (e - 0.9) * k / 8;
                const [x, y] = M(u, 0.56);
                pygame.draw.line(surf, shade(WOOD_DOOR, -35), p.P(x, y, 1), p.P(x, y, 33));
            }
        }
        ubox(0.95, 0.22, e + 0.05, 0.78, 14, STONE, 34, undefined, true);
        for (let k = 0; k < 8; k++) {
            if (k % 2 === 0) {
                const u = 1.0 + (e - 1.0) * (k + 0.5) / 8;
                ubox(u - 0.07, 0.3, u + 0.07, 0.44, 6, STONE, 48);
                ubox(u - 0.07, 0.56, u + 0.07, 0.7, 6, STONE, 48);
            }
        }
        if (opened) {
            ubox(0.95, 0.6, 1.05, 1.0, 30, WOOD_DOOR);
            ubox(e - 0.05, 0.6, e + 0.05, 1.0, 30, WOOD_DOOR);
        }
        ubox(e + 0.05, 0.08, e + 0.95, 0.92, H, STONE, undefined, undefined, true);
        for (const [a, b] of TOWER) ubox(e + a, b, e + a + 0.15, b + 0.15, 7, STONE, H);
        for (const u0 of [0.5, e + 0.5]) {
            const [x, y] = M(u0, 0.92);
            const [bx, by] = p.P(x, y, H - 6);
            pygame.draw.polygon(surf, color, [[bx - 5, by], [bx + 5, by], [bx + 5, by + 14], [bx, by + 18],
                [bx - 5, by + 14]]);
            pygame.draw.polygon(surf, shade(color, -60), [[bx - 5, by], [bx + 5, by], [bx + 5, by + 14],
                [bx, by + 18], [bx - 5, by + 14]], 1);
        }
    }
    spr = [surf, ox, oy];
    _cache.set(key, spr);
    return spr;
}

export function kind_sprite(kind, color, civ = null) {
    // The default sprite (icons, the construction ghost): a straight segment / a closed gate along x.
    if (py.get(BUILDINGS[kind], 'gate')) return gate_sprite(kind, color, true, false, civ);
    return piece_sprite(kind, color, (1 << 0) | (1 << 2), civ);
}
