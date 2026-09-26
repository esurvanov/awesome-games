// port of game/naval_gfx.py
// Procedural water graphics: ships, the dock, fish, depth color, glints and foam.
// Everything is drawn by code. A ship is built as a volumetric hull in isometry: points are given in local
// coordinates (along the heading u, across v, height z) and are projected the same way as world tiles.
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { TILE, shade } from './data.js';

export { TILE, shade };

const _int = Math.trunc;

export const WOOD = [150, 104, 62];
export const WOOD_D = [104, 70, 42];
export const DECK = [186, 146, 96];
export const SAIL = [236, 228, 204];
export const ROPE = [70, 52, 36];
export const FOAM = [214, 234, 244];
// DE water (de_shore_naval.jpg): open sea ~ (50, 123, 154), nearer the shore ~ (81, 167, 183) - turquoise
export const DEEP = [48, 124, 156];
export const SHALLOW = [96, 196, 216];

// ============================================================ water on the map
export function shore_dist(w) {
    // Distance (in tiles, 8-connected) from each water tile to the nearest land; land - 0.
    const W = w.W, H = w.H;
    const INF = 99;
    const dist = [];
    for (let y = 0; y < H; y++) {
        const row = new Array(W);
        for (let x = 0; x < W; x++) row[x] = w.terrain[y][x] !== 1 ? 0 : INF;
        dist.push(row);
    }
    let frontier = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dist[y][x] === 0) frontier.push([x, y]);
    let d = 0;
    while (frontier.length) {
        d += 1;
        const nxt = [];
        for (const [x, y] of frontier) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < W && ny >= 0 && ny < H && dist[ny][nx] > d) {
                        dist[ny][nx] = d;
                        nxt.push([nx, ny]);
                    }
                }
            }
        }
        frontier = nxt;
    }
    // a map with no land at all - everything is deep
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dist[y][x] === INF) dist[y][x] = 8;
    return dist;
}

export function water_color(d, v = 0) {
    // Water color by distance from the shore: turquoise at the rim, dark blue farther out.
    let t = Math.min(1.0, Math.max(0.0, (d - 1) / 5.0));
    t = t * t * (3 - 2 * t);
    return [0, 1, 2].map(i => _int(SHALLOW[i] + (DEEP[i] - SHALLOW[i]) * t) + v);
}

export function decorate(big, w, dist, ox, rnd) {
    // Details over the isometric backing: foam along the shore and wet sand.
    for (let y = 0; y < w.H; y++) {
        for (let x = 0; x < w.W; x++) {
            if (w.terrain[y][x] !== 1 || dist[y][x] !== 1) continue;
            for (let i = 0; i < 2; i++) {
                const wx = (x + rnd.random()) * TILE;
                const wy = (y + rnd.random()) * TILE;
                const ix = wx - wy + ox, iy = (wx + wy) * 0.5;
                const L = rnd.randint(3, 8);
                pygame.draw.line(big, [214, 238, 232], [_int(ix), _int(iy)], [_int(ix + L), _int(iy)], 1);
            }
        }
    }
}

export class WaterFX {
    // Cheap water animation: short glints twinkling at their own rhythm (drawn only in the frame),
    // and foam at the shore.
    constructor(w, ox, dist) {
        const rnd = random.Random(11);
        const pts = [];
        for (let y = 0; y < w.H; y++) {
            for (let x = 0; x < w.W; x++) {
                if (w.terrain[y][x] !== 1) continue;
                const d = dist[y][x];
                const n = d <= 1 ? 2 : 1;
                for (let i = 0; i < n; i++) {
                    if (rnd.random() > (d <= 1 ? 0.9 : 0.45)) continue;
                    const wx = (x + rnd.random()) * TILE;
                    const wy = (y + rnd.random()) * TILE;
                    const ix = wx - wy + ox, iy = (wx + wy) * 0.5;
                    const ph = rnd.uniform(0, math.tau);
                    const sp = rnd.uniform(0.6, 1.4);
                    const L = rnd.randint(4, 10);
                    pts.push([iy, ix, ph, sp, L, d <= 1, water_color(d)]);
                }
            }
        }
        py.sort(pts);
        this.pts = pts;
        this.ys = pts.map(p => p[0]);
    }

    draw(scr, cam_x, cam_y, top, view_w, view_h, t) {
        const i0 = py.bisect_left(this.ys, cam_y - 4);
        const i1 = py.bisect_right(this.ys, cam_y + view_h + 4);
        const line = pygame.draw.line;
        for (let j = i0; j < i1; j++) {
            const [iy, ix, ph, sp, L, shore, base] = this.pts[j];
            const sx = ix - cam_x;
            if (sx < -12 || sx > view_w + 12) continue;
            const s = Math.sin(t * sp * 1.6 + ph);
            if (s < 0.35) continue;
            const sy = iy - cam_y + top;
            const drift = Math.sin(t * 0.7 + ph) * 3;
            if (shore) {
                const c = [205 + _int(45 * s), 232 + _int(20 * s), 228 + _int(22 * s)];       // foam at the shore
                line(scr, c, [sx + drift, sy], [sx + drift + L * 0.8, sy], 1);
            } else {
                const c = shade(base, _int(20 + 45 * s));
                line(scr, c, [sx + drift, sy], [sx + drift + L * s, sy], 1);
            }
        }
    }
}
py.register_class(WaterFX, 'naval_gfx.WaterFX');

// ============================================================ fish
export function make_fish(kind, vr) {
    // Fish silhouettes under water (dark backs) - a sprite centered in the middle of the tile.
    const rnd = random.Random(vr * 131 + (kind === 'deep_fish' ? 7 : 3));
    const s = new pygame.Surface([48, 30], pygame.SRCALPHA);
    const deep = kind === 'deep_fish';
    const n = deep ? 1 : 3;
    for (let i = 0; i < n; i++) {
        const cx = 24 + (!deep ? rnd.uniform(-9, 9) : 0);
        const cy = 15 + (!deep ? rnd.uniform(-5, 5) : 0);
        const L = deep ? 20 : rnd.uniform(8, 11);
        const dirx = rnd.random() < 0.5 ? 1 : -1;
        const body = deep ? [22, 44, 76, 230] : [40, 72, 98, 210];
        pygame.draw.ellipse(s, body, [cx - L / 2, cy - L / 5, L, L / 2.5]);
        const tx = cx - dirx * L / 2;
        pygame.draw.polygon(s, body, [[tx, cy], [tx - dirx * L / 3.2, cy - L / 5], [tx - dirx * L / 3.2, cy + L / 5]]);
        if (deep) {
            pygame.draw.polygon(s, [30, 52, 80, 220], [[cx - 2, cy - L / 5], [cx + 3 * dirx, cy - L / 2.6],
                [cx + 5 * dirx, cy - L / 5]]);
        }
        pygame.draw.line(s, [150, 200, 225, 170], [cx - L / 4, cy - L / 8], [cx + L / 4, cy - L / 8], 1);
    }
    return s;
}

export function fish_ripple(scr, n, sx, sy, t) {
    // Expanding rings and an occasional jumping fish.
    const ph = py.mod(t * 0.55 + n.var * 0.37 + n.tx * 0.13, 1.0);
    const r = 4 + ph * 12;
    const c = [_int(120 + 110 * (1 - ph)), _int(170 + 70 * (1 - ph)), 230];
    pygame.draw.ellipse(scr, c, [sx - r, sy - r / 2, 2 * r, r], 1);
    const jp = py.mod(t * 0.23 + n.var * 0.61 + n.ty * 0.17, 1.0);
    if (jp < 0.12) {
        const a = jp / 0.12;
        const fx = sx - 8 + 16 * a;
        const fy = sy - Math.sin(a * Math.PI) * 12;
        const ang = Math.cos(a * Math.PI);
        const pts = [[fx - 4, fy + ang * 2], [fx + 4, fy - ang * 2]];
        pygame.draw.line(scr, [200, 215, 225], pts[0], pts[1], 3);
        pygame.draw.circle(scr, [240, 248, 255], [_int(sx - 8), _int(sy)], 2, 1);
        pygame.draw.circle(scr, [240, 248, 255], [_int(sx + 8), _int(sy)], 2, 1);
    }
}

// ============================================================ ships
/**
 * Projection of the ship's local coordinates (u - along the heading, v - across, z - height) onto the screen.
 * Python's instance is callable (P(u, v, z)): the constructor returns a callable function object that carries the
 * attributes and methods of _Proj.
 */
export class _Proj {
    constructor(x, y, face, k) {
        const P = function (u, v, z = 0.0) { return P.__call__(u, v, z); };
        Object.setPrototypeOf(P, _Proj.prototype);
        const [sx, sy] = face;
        const a = (sx + 2 * sy) / 2, b = (2 * sy - sx) / 2;    // screen direction -> world
        const d = math.hypot(a, b) || 1.0;
        P.hx = a / d; P.hy = b / d;
        P.px = -P.hy; P.py = P.hx;
        P.x = x; P.y = y; P.k = k * 0.78;
        return P;
    }

    __call__(u, v, z = 0.0) {
        const wx = u * this.hx + v * this.px;
        const wy = u * this.hy + v * this.py;
        const k = this.k;
        return [this.x + (wx - wy) * k, this.y + (wx + wy) * 0.5 * k - z * k * 1.6];
    }

    facing(nu, nv) {
        // Whether a face with the outer normal (nu, nv) looks toward the viewer (to the south-east of the world).
        return (nu * this.hx + nv * this.px) + (nu * this.hy + nv * this.py);
    }

    side_front() {
        // +1 if the side v > 0 faces the viewer, otherwise -1.
        return this.px + this.py > 0 ? 1 : -1;
    }
}

export function _hull_outline(L, B, bow = 1.25, stern = 0.85) {
    const pts = [[L * bow, 0], [L * 0.55, B], [-L * 0.55, B], [-L * stern, B * 0.72],
        [-L * stern, -B * 0.72], [-L * 0.55, -B], [L * 0.55, -B]];
    return pts;
}

export function _hull(surf, P, L, B, H, wood, deck = DECK, stripe = null) {
    const top = _hull_outline(L, B);
    const bot = top.map(([u, v]) => [u * 0.86, v * 0.72]);
    const n = top.length;
    const faces = [];
    for (let i = 0; i < n; i++) {
        const [u0, v0] = top[i];
        const [u1, v1] = top[(i + 1) % n];
        const eu = u1 - u0, ev = v1 - v0;
        const nu = ev, nv = -eu;            // outer normal for the clockwise traversal (in local coordinates)
        const f = P.facing(nu, nv);
        if (f > 0) faces.push([f, i]);
    }
    for (const [f, i] of faces) {
        const j = (i + 1) % n;
        const quad = [P(...bot[i], 0), P(...bot[j], 0), P(...top[j], H), P(...top[i], H)];
        const c = shade(wood, _int(-30 + 30 * Math.min(1.0, f / 30.0)));
        pygame.draw.polygon(surf, c, quad);
        pygame.draw.polygon(surf, shade(c, -45), quad, 1);
        if (stripe) {
            const a = P(...[0, 1].map(q => (bot[i][q] + top[i][q]) / 2), H * 0.62);
            const b = P(...[0, 1].map(q => (bot[j][q] + top[j][q]) / 2), H * 0.62);
            pygame.draw.line(surf, stripe, a, b, 2);
        }
    }
    const dk = top.map(([u, v]) => P(u, v, H));
    pygame.draw.polygon(surf, deck, dk);
    pygame.draw.polygon(surf, shade(wood, -50), dk, 1);
    // deck planks
    for (const t of [-0.45, 0.0, 0.45]) {
        pygame.draw.line(surf, shade(deck, -22), P(-L * 0.8, B * t, H), P(L * 0.9, B * t * 0.8, H), 1);
    }
}

export function _wake(surf, P, L, B, anim, moving, k) {
    if (moving) {
        const ph = py.mod(anim * 0.25, 1.0);
        for (const s of [-1, 1]) {
            const a = P(-L * 0.8, s * B * 0.7);
            const b = P(-L * 0.8 - 26, s * (B + 12));
            pygame.draw.line(surf, FOAM, a, b, Math.max(1, _int(2 * k)));
            for (let q = 0; q < 3; q++) {
                const t = py.mod(ph + q / 3.0, 1.0);
                const c = P(-L * 0.8 - 26 * t, s * (B * 0.7 + (12 + B * 0.3) * t));
                pygame.draw.circle(surf, [236, 246, 250], [_int(c[0]), _int(c[1])], Math.max(1, _int(2 * k * (1 - t)) + 1));
            }
        }
        // bow wave
        for (const s of [-1, 1]) pygame.draw.line(surf, FOAM, P(L * 1.25, 0), P(L * 0.9, s * (B + 3)), 1);
    } else {
        const pts = _hull_outline(L * 1.18, B * 1.5).map(([u, v]) => P(u, v));
        pygame.draw.polygon(surf, [120, 170, 210], pts, 1);
    }
}

export function _shadow(surf, P, L, B) {
    const pts = _hull_outline(L, B * 0.9).map(([u, v]) => P(u + 3, v + 3));
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const mnx = Math.min(...xs), mny = Math.min(...ys);
    const w = _int(Math.max(...xs) - mnx) + 2, h = _int(Math.max(...ys) - mny) + 2;
    const s = new pygame.Surface([w, h], pygame.SRCALPHA);
    pygame.draw.polygon(s, [10, 30, 60, 70], pts.map(p => [p[0] - mnx, p[1] - mny]));
    surf.blit(s, [mnx, mny]);
}

export function _mast(surf, P, u, H, M, k) {
    pygame.draw.line(surf, ROPE, P(u, 0, H), P(u, 0, H + M), Math.max(2, _int(2.4 * k)));
}

export function _square_sail(surf, P, u, H, M, S, color, k, cross = true, billow = 4) {
    const z0 = H + M * 0.3, z1 = H + M * 0.92;
    const pts = [P(u, -S, z1), P(u + billow * 0.4, 0, z1 + 1), P(u, S, z1), P(u + billow, S * 0.95, z0),
        P(u + billow * 1.6, 0, z0 - 2), P(u + billow, -S * 0.95, z0)];
    pygame.draw.polygon(surf, color, pts);
    pygame.draw.polygon(surf, shade(color, -70), pts, 1);
    if (cross) pygame.draw.line(surf, shade(color, 45), P(u + billow * 0.5, 0, z1 - 2), P(u + billow * 1.3, 0, z0 + 1), 2);
    pygame.draw.line(surf, ROPE, P(u, -S - 2, z1), P(u, S + 2, z1), Math.max(1, _int(2 * k)));
}

export function _lateen(surf, P, u, H, M, S, color) {
    const pts = [P(u, 0, H + M), P(u - S * 1.2, 0, H + 4), P(u + S * 0.4, 0, H + 3)];
    pygame.draw.polygon(surf, color, pts);
    pygame.draw.polygon(surf, shade(color, -70), pts, 1);
}

export function _oars(surf, P, L, B, H, anim, moving, side, n, k) {
    const sw = Math.sin(anim * 0.8) * (moving ? 5 : 1);
    for (let i = 0; i < n; i++) {
        const u = -L * 0.5 + L * 1.0 * i / Math.max(1, n - 1);
        const a = P(u, side * B * 0.9, H * 0.7);
        const b = P(u - 3 + sw, side * (B + 9), 0);
        pygame.draw.line(surf, [120, 86, 50], a, b, Math.max(1, _int(1.4 * k)));
    }
}

export function _flag(surf, P, u, z, color, k) {
    const [bx, by] = P(u, 0, z);
    pygame.draw.polygon(surf, color, [[bx, by], [bx + 9 * k, by + 2 * k], [bx, by + 5 * k]]);
}

export function _fire(surf, P, u, z, k, big = false) {
    const t = pygame.time.get_ticks() / 1000.0;
    const [bx, by] = P(u, 0, z);
    const n = !big ? 3 : 5;
    for (let i = 0; i < n; i++) {
        const fl = Math.sin(t * 13 + i * 2.1) * 2;
        const r = (4 - i * 0.6) * k * (big ? 1.3 : 1.0);
        const c = [[255, 90, 30], [255, 160, 40], [255, 230, 120], [255, 120, 30], [255, 200, 80]][i];
        pygame.draw.circle(surf, c, [_int(bx + fl * 0.6), _int(by - i * 3 * k - 2)], Math.max(1, _int(r)));
    }
}

export function draw_ship(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null,
    moving = false) {
    const P = new _Proj(x, y, face, k);
    const side = P.side_front();
    const kk = k;
    if (kind === 'fishing_ship') {
        const L = 13, B = 5.5, H = 5;
        _shadow(surf, P, L, B);
        _wake(surf, P, L, B, anim, moving, kk);
        // a net overboard
        const ns = -side;
        for (let i = 0; i < 5; i++) {
            const a = P(-L * 0.3 + i * 3, ns * (B + 1), 0);
            const b = P(-L * 0.3 + i * 3 + 2, ns * (B + 8), 0);
            pygame.draw.line(surf, [190, 185, 165], a, b, 1);
        }
        pygame.draw.line(surf, [200, 60, 50], P(-L * 0.3, ns * (B + 8)), P(L * 0.3, ns * (B + 8)), 2);
        _hull(surf, P, L, B, H, [160, 118, 72]);
        if (carry_res) {
            for (let i = 0; i < 4; i++) {
                const c = P(-4 + i * 2.5, (i % 2) * 2 - 1, H + 1);
                pygame.draw.ellipse(surf, [170, 190, 205], [c[0] - 3, c[1] - 1.5, 6, 3]);
            }
        }
        _mast(surf, P, 2, H, 22, kk);
        _lateen(surf, P, 2, H, 22, 11, color);
        pygame.draw.line(surf, ROPE, P(2, 0, H + 20), P(-L * 0.4, ns * (B + 6), 0), 1);
        return;
    }
    if (kind === 'transport_ship') {
        const L = 17, B = 9, H = 6;
        _shadow(surf, P, L, B);
        _wake(surf, P, L, B, anim, moving, kk);
        _hull(surf, P, L, B, H, [138, 98, 60], undefined, color);
        for (const [u, v] of [[-8, -4], [-8, 3], [-3, -4], [8, 2]]) {
            const c = P(u, v, H);
            pygame.draw.rect(surf, [150, 112, 70], [c[0] - 4, c[1] - 7, 8, 7]);
            pygame.draw.rect(surf, [90, 64, 40], [c[0] - 4, c[1] - 7, 8, 7], 1);
        }
        _mast(surf, P, 3, H, 30, kk);
        _square_sail(surf, P, 3, H, 30, 12, color, kk);
        _flag(surf, P, 3, H + 31, color, kk);
        return;
    }
    if (['galley', 'war_galley', 'fire_galley', 'fire_ship', 'fast_fire_ship'].includes(kind)) {
        const big = ['war_galley', 'fire_ship', 'fast_fire_ship'].includes(kind);
        const [L, B, H] = big ? [22, 6.5, 6] : [19, 6, 5];
        const fire = kind.includes('fire');
        const wood = fire ? [120, 78, 48] : [142, 96, 56];
        _shadow(surf, P, L, B);
        _wake(surf, P, L, B, anim, moving, kk);
        _oars(surf, P, L, B, H, anim, moving, -side, big ? 6 : 5, kk);
        _hull(surf, P, L, B, H, wood, undefined, color);
        _oars(surf, P, L, B, H, anim, moving, side, big ? 6 : 5, kk);
        // shields along the side
        for (let i = 0; i < 5; i++) {
            const c = P(-L * 0.5 + i * L * 0.25, side * B * 0.95, H + 2);
            pygame.draw.circle(surf, shade(color, i % 2 ? -10 : 25), [_int(c[0]), _int(c[1])], Math.max(2, _int(2.4 * kk)));
        }
        // a ram on the bow
        pygame.draw.line(surf, [150, 150, 160], P(L * 1.2, 0, 1), P(L * 1.5, 0, 1), Math.max(2, _int(3 * kk)));
        const M = big ? 30 : 26;
        _mast(surf, P, 1, H, M, kk);
        _square_sail(surf, P, 1, H, M, big ? 11 : 10, !fire ? color : shade(color, -25), kk);
        if (kind === 'war_galley') {
            _mast(surf, P, -L * 0.55, H, 18, kk);
            _lateen(surf, P, -L * 0.55, H, 18, 8, SAIL);
        }
        _flag(surf, P, 1, H + M + 1, color, kk);
        if (fire) {
            // a brazier and a siphon on the bow
            const [bx, by] = P(L * 0.95, 0, H);
            pygame.draw.rect(surf, [70, 60, 55], [bx - 4, by - 6, 8, 6]);
            _fire(surf, P, L * 0.95, H + 6, kk, swing > 0 || kind === 'fast_fire_ship');
            if (swing > 0) {
                const a = P(L * 1.2, 0, H + 2);
                const b = P(L * 2.4, 0, H - 2);
                pygame.draw.line(surf, [255, 150, 40], a, b, 4);
                pygame.draw.line(surf, [255, 230, 130], a, b, 2);
            }
        }
        return;
    }
    if (kind === 'galleon') {
        const L = 24, B = 8, H = 9;
        _shadow(surf, P, L, B);
        _wake(surf, P, L, B, anim, moving, kk);
        _hull(surf, P, L, B, H, [122, 80, 46], [176, 136, 88], [210, 180, 90]);
        // the stern superstructure
        const top = [[-L * 0.85, -B * 0.7], [-L * 0.4, -B * 0.9], [-L * 0.4, B * 0.9], [-L * 0.85, B * 0.7]];
        pygame.draw.polygon(surf, [132, 88, 52], top.map(([u, v]) => P(u, v, H + 7)));
        pygame.draw.polygon(surf, [80, 52, 30], top.map(([u, v]) => P(u, v, H + 7)), 1);
        for (const u of [-L * 0.4, -L * 0.85]) {
            for (const v of [-B * 0.8, B * 0.8]) pygame.draw.line(surf, [80, 52, 30], P(u, v, H), P(u, v, H + 7), 1);
        }
        for (const [u, M, S] of [[L * 0.45, 30, 11], [-2, 40, 14], [-L * 0.55, 26, 9]]) {
            _mast(surf, P, u, H, M, kk);
            _square_sail(surf, P, u, H, M, S, u !== -2 ? SAIL : color, kk);
        }
        _flag(surf, P, -2, H + 41, color, kk);
        return;
    }
    if (kind === 'demolition_ship' || kind === 'heavy_demolition_ship') {
        const heavy = kind === 'heavy_demolition_ship';
        const [L, B, H] = heavy ? [16, 7, 4] : [14, 6, 4];
        _shadow(surf, P, L, B);
        _wake(surf, P, L, B, anim, moving, kk);
        _hull(surf, P, L, B, H, [110, 84, 60], [150, 120, 86], color);
        const kegs = [[-6, -2.5], [-6, 2.5], [-1, 0], [4, -2.5], [4, 2.5]].concat(heavy ? [[9, 0]] : []);
        for (const [u, v] of kegs) {
            const c = P(u, v, H);
            const r = _int(4 * kk);
            pygame.draw.ellipse(surf, [96, 60, 34], [c[0] - r, c[1] - 2 * r, 2 * r, 2 * r]);
            pygame.draw.line(surf, [60, 40, 25], [c[0] - r, c[1] - r * 1.4], [c[0] + r, c[1] - r * 1.4], 1);
            pygame.draw.line(surf, [60, 40, 25], [c[0] - r, c[1] - r * 0.5], [c[0] + r, c[1] - r * 0.5], 1);
        }
        // a fuse with a spark
        const c = P(-1, 0, H);
        const t = pygame.time.get_ticks() / 90;
        pygame.draw.line(surf, [40, 30, 20], [c[0], c[1] - 8 * kk], [c[0] + 3, c[1] - 13 * kk], 1);
        pygame.draw.circle(surf, [255, py.mod(_int(t), 2) ? 220 : 140, 60], [_int(c[0] + 3), _int(c[1] - 13 * kk)], 2);
        _mast(surf, P, -L * 0.6, H, 16, kk);
        _lateen(surf, P, -L * 0.6, H, 16, 7, color);
        return;
    }
    if (kind === 'cannon_galleon') {
        const L = 25, B = 8.5, H = 9;
        _shadow(surf, P, L, B);
        _wake(surf, P, L, B, anim, moving, kk);
        _hull(surf, P, L, B, H, [96, 70, 48], [160, 124, 84], [40, 36, 34]);
        // gun ports along the side
        for (let i = 0; i < 5; i++) {
            const u = -L * 0.55 + i * L * 0.27;
            const c = P(u, side * B * 0.9, H * 0.55);
            pygame.draw.rect(surf, [25, 22, 20], [c[0] - 2, c[1] - 2, 4, 4]);
        }
        // a gun on the bow
        pygame.draw.line(surf, [50, 50, 55], P(L * 0.8, 0, H + 3), P(L * 1.25, 0, H + 4), Math.max(3, _int(4 * kk)));
        for (const [u, M, S] of [[L * 0.35, 34, 12], [-L * 0.4, 30, 11]]) {
            _mast(surf, P, u, H, M, kk);
            _square_sail(surf, P, u, H, M, S, u > 0 ? color : SAIL, kk);
        }
        _flag(surf, P, L * 0.35, H + 35, color, kk);
        if (swing > 0) {
            const c = P(L * 1.3, 0, H + 4);
            for (let i = 0; i < 3; i++) {
                pygame.draw.circle(surf, [200, 196, 190], [_int(c[0] + i * 5), _int(c[1] - i * 2)], _int(4 + i * 2), 0);
            }
        }
        return;
    }
    // unknown ship - a simple boat
    const L = 14, B = 6, H = 5;
    _wake(surf, P, L, B, anim, moving, kk);
    _hull(surf, P, L, B, H, WOOD);
    _mast(surf, P, 0, H, 20, kk);
    _square_sail(surf, P, 0, H, 20, 8, color, kk);
}

// ============================================================ dock
export function draw_dock(p, surf, color, s) {
    // A wooden pier on piles with a shed and a crane. p - gfx.IsoPainter, s - the side in tiles (3).
    // piles in the water (visible along the front edges)
    for (let i = 0; i < 7; i++) {
        const t = 0.2 + (s - 0.4) * i / 6;
        for (const [x, y] of [[t, s - 0.12], [s - 0.12, t]]) {
            p.box(x - 0.05, y - 0.05, x + 0.05, y + 0.05, 10, [84, 58, 36], -6, false);
        }
    }
    // decking
    p.box(0.1, 0.1, s - 0.1, s - 0.1, 5, [150, 110, 70], 4, undefined, 'wood');
    for (let i = 1; i < 12; i++) {
        const t = 0.1 + (s - 0.2) * i / 12;
        p.line([t, 0.1, 9], [t, s - 0.1, 9], [126, 90, 56]);
    }
    // a shed at the far corner
    p.box(0.3, 0.3, 1.5, 1.3, 20, [178, 140, 96], 9, false, 'wood');
    p.gable(0.3, 0.3, 1.5, 1.3, 29, 14, [120, 82, 50], [178, 140, 96], 'x');
    p.door(0.9, 1.3, 0.3, 11 + 9);
    // barrels and nets
    for (const [x, y] of [[1.9, 0.5], [2.2, 0.55], [2.05, 0.85]]) {
        const [cx, cy] = p.P(x, y, 9);
        pygame.draw.ellipse(surf, [110, 72, 40], [cx - 5, cy - 11, 10, 12]);
        pygame.draw.line(surf, [70, 46, 28], [cx - 5, cy - 7], [cx + 5, cy - 7], 1);
    }
    for (let i = 0; i < 4; i++) {
        const a = p.P(0.6 + i * 0.25, 2.2, 9);
        pygame.draw.line(surf, [200, 196, 176], a, [a[0] + 4, a[1] + 8], 1);
    }
    // a crane: a mast and a boom with a load over the water
    const base = p.P(2.3, 2.3, 9);
    const top = [base[0], base[1] - 44];
    pygame.draw.line(surf, [92, 64, 40], base, top, 4);
    const tip = p.P(3.3, 2.9, 9 + 42);
    pygame.draw.line(surf, [92, 64, 40], [top[0], top[1] + 6], tip, 3);
    pygame.draw.line(surf, ROPE, top, tip, 1);
    pygame.draw.line(surf, ROPE, tip, [tip[0], tip[1] + 20], 1);
    pygame.draw.rect(surf, [140, 100, 60], [tip[0] - 5, tip[1] + 20, 10, 8]);
    pygame.draw.rect(surf, [80, 56, 34], [tip[0] - 5, tip[1] + 20, 10, 8], 1);
    p.flag(1.5, 0.3, 42, color);
    p.banner_l(0.55, 1.3, 26, color);
}
