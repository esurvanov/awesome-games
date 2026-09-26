// port of game/map_icons.py
// Map icons for the lobby - our own, drawn from the real map generation (like DE's map choice icons:
// a map diamond on a square, forest as little trees, water with a shoal, walls, colored player diamonds).
//
//   icon(mt, size)   -> pygame.Surface size x size (an in-memory cache; generation takes ~0.2-0.5 s per map)
// No DE pictures: everything is drawn from the map that our generator produces (game/mapgen.py).
import * as py from '../runtime/py.js';
import { random, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { PLAYER_COLORS } from './data.js';

export { PLAYER_COLORS };

export const _cache = new Map();

// icon paints (muted, "hand-painted")
export const GRASS = {
    'grass': [104, 150, 62], 'desert': [222, 188, 118], 'steppe': [178, 164, 86], 'snow': [226, 230, 236],
    'tropical': [86, 158, 70], 'autumn': [150, 140, 66],
};
export const FOREST = {
    'grass': [34, 78, 34], 'desert': [86, 118, 52], 'steppe': [84, 98, 44], 'snow': [46, 74, 60],
    'tropical': [26, 92, 40], 'autumn': [120, 70, 30],
};
export const WATER = [40, 104, 176];
export const SHORE = [92, 170, 206];
export const BEACH = [214, 196, 140];
export const WALL = [150, 150, 150];
export const DIRT = [176, 140, 80];
export const BG = [24, 18, 12];
export const SEED = { 'arabia': 5, 'arena': 3, 'black_forest': 2, 'nomad': 4, 'islands': 3, 'mediterranean': 1 };
export const THEME = { 'arabia': 'desert' };         // the Wasteland icon is a desert landscape (as in DE)

export function _world(mt) {
    const { World } = modules.world;
    const state = random.getstate();
    try {
        random.seed(py.get(SEED, mt, 1));
        const s = { 'map': mt, 'theme': py.get(THEME, mt, 'auto'), 'team_together': true };
        // World(1, 4, [0, 0, 1, 1], map_type=mt, civs=['random'] * 4, settings=s, size=96)
        return new World(1, 4, [0, 0, 1, 1], undefined, ['random', 'random', 'random', 'random'], 96, mt, undefined, s);
    } finally {
        random.setstate(state);
    }
}

export function icon(mt, size) {
    const key = py.tkey([mt, size]);
    let s = _cache.get(key);
    if (s === undefined) {
        try {
            s = _draw(_world(mt), size);
        } catch (e) {
            console.warn('map_icons.icon', mt, e);
            s = new pygame.Surface([size, size]);
            s.fill(BG);
        }
        _cache.set(key, s);
    }
    return s;
}

export function draw(w, size) {
    // An icon from a ready world w (the loading screen).
    return _draw(w, size);
}

export function _draw(w, size) {
    const W = w.W, H = w.H;
    let theme = py.getattr(w, 'theme', 'grass');
    theme = Object.hasOwn(GRASS, theme) ? theme : 'grass';
    const k = 3;                                   // pixels per tile before rotation
    const top = new pygame.Surface([W * k, H * k]);
    top.fill(GRASS[theme]);
    const rnd = random.Random(3);
    const T = w.terrain;
    const near = _water_dist(w);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const t = T[y][x];
            let c;
            if (t === 1) c = near[y][x] > 1 ? WATER : SHORE;
            else if (t === 2) c = SHORE;
            else if (near[y][x] <= 1 && theme !== 'desert') c = BEACH;
            else {
                const v = rnd.randint(-6, 6);
                c = GRASS[theme].map(a => Math.max(0, Math.min(255, a + v)));
            }
            top.fill(c, [x * k, y * k, k, k]);
        }
    }
    // land at the starts
    for (const [sx, sy] of w.starts) pygame.draw.circle(top, DIRT, [(sx + 0.5) * k, (sy + 0.5) * k], 4 * k);
    // forest - "little trees" (circles with a shadow) densely across the forest tiles
    const fc = FOREST[theme];
    const dark = fc.map(a => Math.max(0, a - 26));
    const light = fc.map(a => Math.min(255, a + 28));
    const trees = Array.from(w.nodes).filter(n => n.kind === 'tree');
    for (const n of trees) top.fill(dark, [n.tx * k, n.ty * k, k, k]);
    for (const n of trees) {
        if (py.mod(n.tx * 7 + n.ty * 3, 2) === 0) {
            const cx = n.tx * k + Math.floor(k / 2), cy = n.ty * k + Math.floor(k / 2);
            pygame.draw.circle(top, fc, [cx, cy], k * 0.9);
            pygame.draw.circle(top, light, [cx - 1, cy - 1], k * 0.4);
        }
    }
    for (const n of w.nodes) {
        if (n.kind === 'gold') top.fill([240, 200, 50], [n.tx * k, n.ty * k, k, k]);
        else if (n.kind === 'stone') top.fill([170, 170, 170], [n.tx * k, n.ty * k, k, k]);
    }
    for (const b of w.buildings) {
        if (py.get(b.d, 'wall')) top.fill(WALL, [b.tx * k, b.ty * k, b.w * k, b.h * k]);
    }
    // rotation into a 1:1 diamond (like DE's map choice icons: a diamond on a square)
    const rot = pygame.transform.rotate(pygame.display.get_surface() ? top.convert_alpha() : top, -45);
    const d = size - 4;
    const dia = pygame.transform.smoothscale(rot, [d, d]);
    const out = new pygame.Surface([size, size]);
    out.fill(BG);
    // the square's corners - a continuation of the map edge, darker
    const edge = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [Math.floor(W / 2), 0], [0, Math.floor(H / 2)],
        [W - 1, Math.floor(H / 2)], [Math.floor(W / 2), H - 1]].map(([x, y]) => top.get_at([x * k, y * k]));
    const base = [0, 1, 2].map(i => Math.max(0, Math.trunc(edge.reduce((s, c) => s + c[i], 0) / edge.length) - 36));
    pygame.draw.rect(out, base, [2, 2, d, d]);
    const dy = 2;
    out.blit(dia, [2, dy]);
    // player diamonds
    const Wd = d, Hd = d;
    Array.from(w.starts).forEach(([sx, sy], pid) => {
        const u = (sx + 0.5) / W;
        const v = (sy + 0.5) / H;
        const px = 2 + (u - v + 1) * 0.5 * Wd;
        const pyy = dy + (u + v) * 0.5 * Hd;
        const col = PLAYER_COLORS[pid % PLAYER_COLORS.length];
        const r = Math.max(4, Math.floor(size / 18));
        const pts = [[px, pyy - r], [px + r, pyy], [px, pyy + r], [px - r, pyy]];
        pygame.draw.polygon(out, col, pts);
        pygame.draw.polygon(out, [20, 14, 8], pts, 2);
    });
    pygame.draw.rect(out, [120, 84, 40], out.get_rect(), 1);
    return out;
}

export function _water_dist(w) {
    // Distance (0, 1, 2+) to water among the 8 neighbors - for the shoal/beach edge.
    const W = w.W, H = w.H;
    const T = w.terrain;
    const out = Array.from({ length: H }, () => new Array(W).fill(3));
    const any = (pred) => {
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (pred(dx, dy)) return true;
        return false;
    };
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (T[y][x] === 1) {
                const land = any((dx, dy) => x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && T[y + dy][x + dx] !== 1);
                out[y][x] = land ? 1 : 3;
            } else {
                const wet = any((dx, dy) => x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && T[y + dy][x + dx] === 1);
                out[y][x] = wet ? 1 : 3;
            }
        }
    }
    return out;
}
