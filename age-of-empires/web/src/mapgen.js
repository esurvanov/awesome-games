// port of game/mapgen.py
/* A random map generator by the rules of AoE II DE (our own code from the numbers in DE's map scripts -
docs/research/07_maps.md; no DE texts or files are in the game).

Common to all maps (as in DE):
  * size - match.MAP_SIZE (120/144/168/200/220/240), object counts scale with the area (x W*H/10 000);
  * starts - on a circle of radius 33-38 % of the side with a random rotation, allies nearby ("Team Together");
  * the player's set - identical amounts at identical distances (from the center of the TC to the nearest tile
    of the group), each with its own directions (like set_place_for_every_player + min/max_distance_to_players);
  * player forests and groves - solid patches, the map edges are open (except maps where the forest is the base);
  * wolves (>= 32 tiles from players), relics, single trees near the center.
Map recipes are the functions _arabia, _arena, _black_forest, _nomad, _islands, _mediterranean.

Entry point: generate(w) - from World.gen_map for maps from maps.MAPS (except the old 'land' / 'coast').
Randomness - the random module (World(...) after random.seed(n) is reproducible).
*/
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import { TILE, ANIMALS } from './data.js';
import * as terrain from './terrain.js';
import * as maps from './maps.js';
import { Node, Unit, Animal } from './world.js';

export const LAND = 0, WATER = 1, SHALLOW = 2, CLIFF = 3;
// flags of the generator's occupancy grid
export const F_FOREST = 1, F_RES = 2, F_CLEAR = 4, F_WALL = 8;

// DE: the radius of the start circle (a fraction of the side) by map size - Arabia.rms (tiny 32-34 %, ... huge 38 %)
export const RADIUS = [[120, 0.33], [144, 0.34], [168, 0.35], [200, 0.36], [220, 0.37], [240, 0.38]];
// DE: relics by map size (5/5/5/7/8/9)
export const RELICS = [[120, 5], [144, 5], [168, 5], [200, 7], [220, 8], [240, 9]];
export const STRAGGLER_WOOD = 125;        // a single tree (dat 410)

// tuple (x, y) keys for sets/dicts: a non-negative number, insertion order kept by Set/Map (as Python's dict)
const _O = 32768;
function _K(x, y) { return (x + _O) * 65536 + (y + _O); }
function _UK(k) { return [Math.floor(k / 65536) - _O, (k % 65536) - _O]; }
// Python's sort of (float, int, int) tuples
function _tcmp(a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; }
const _SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function _by_size(table, W) {
    let best = table[0][1];
    for (const [side, v] of table)
        if (W >= side - 6) best = v;
    return best;
}

export function circle_radius(W, extra = 0.0) {
    return W * (_by_size(RADIUS, W) + extra);
}


// ============================================================ generator
export class Gen {
    constructor(w) {
        this.w = w;
        this.W = w.W;
        this.H = w.H;
        this.T = w.terrain;
        this.n = w.players.length;
        this.flags = new Uint8Array(this.W * this.H);
        this.scale = this.W * this.H / 10000.0;
        this.mx = (this.W - 1) / 2;
        this.my = (this.H - 1) / 2;
        this.starts = [];
        this.angs = [];
        this.fwd = [];
    }

    // ---------------------------------------------------------------- basics
    inb(x, y, m = 0) {
        return m <= x && x < this.W - m && m <= y && y < this.H - m;
    }

    flag(x, y) {
        return this.flags[y * this.W + x];
    }

    setf(x, y, f) {
        this.flags[y * this.W + x] |= f;
    }

    dstart(x, y) {
        let m = Infinity;
        for (const [sx, sy] of this.starts) {
            const d = math.hypot(x - sx, y - sy);
            if (d < m) m = d;
        }
        return m;
    }

    /** Whether there is a tile with flag f within radius r (a square neighborhood). */
    near_flag(x, y, r, f) {
        const W = this.W, H = this.H;
        const fl = this.flags;
        const yb = Math.min(H, y + r + 1), xb = Math.min(W, x + r + 1);
        for (let yy = Math.max(0, y - r); yy < yb; yy++) {
            const row = yy * W;
            for (let xx = Math.max(0, x - r); xx < xb; xx++)
                if (fl[row + xx] & f) return true;
        }
        return false;
    }

    near_water(x, y, r) {
        const T = this.T;
        const yb = Math.min(this.H, y + r + 1), xb = Math.min(this.W, x + r + 1);
        for (let yy = Math.max(0, y - r); yy < yb; yy++)
            for (let xx = Math.max(0, x - r); xx < xb; xx++) {
                const t = T[yy][xx];
                if (t === WATER || t === SHALLOW) return true;
            }
        return false;
    }

    free_land(x, y) {
        return this.inb(x, y) && this.T[y][x] === LAND && this.w.occ[y][x] == null;
    }

    /** The land component number (for islands: the player's resource - on his island). */
    land_id(x, y) {
        const lab = this._land_lab;
        return lab != null ? lab[y * this.W + x] : 0;
    }

    label_land() {
        const W = this.W, H = this.H;
        const ok = new Array(W * H);
        for (let i = 0; i < W * H; i++) ok[i] = this.T[Math.floor(i / W)][i % W] !== WATER;
        [this._land_lab] = terrain._labels(W, H, ok);
    }

    // ---------------------------------------------------------------- starts
    /** A circle with a random rotation; allies - in neighboring places of the circle. */
    place_starts(frac_extra = 0.0, radius = null, jitter = 1.0) {
        const w = this.w, n = this.n;
        const R = radius != null ? radius : circle_radius(this.W, frac_extra);
        const base = random.uniform(0, math.tau);
        const together = py.get(w.settings, 'team_together', true);
        const order = py.sorted(py.range(n), pid => [py.bool(together) ? w.players[pid].team : 0, random.random()]);
        this.starts = new Array(n).fill(null);
        this.angs = new Array(n).fill(0.0);
        for (let slot = 0; slot < order.length; slot++) {
            const pid = order[slot];
            const a = base + slot * math.tau / n + random.uniform(-0.04, 0.04) * jitter;
            const r = R + random.uniform(-1.0, 1.0) * jitter;
            const x = py.round(this.mx + Math.cos(a) * r);
            const y = py.round(this.my + Math.sin(a) * r);
            this.starts[pid] = [Math.max(8, Math.min(this.W - 9, x)), Math.max(8, Math.min(this.H - 9, y))];
            this.angs[pid] = a;
        }
        this.fwd = this.angs.map(a => a + Math.PI);
        this.R = R;
        w.starts = this.starts;
        for (const [sx, sy] of this.starts)            // the center's site: no forest and no piles
            for (let y = sy - 4; y < sy + 5; y++)
                for (let x = sx - 4; x < sx + 5; x++)
                    if (this.inb(x, y)) this.setf(x, y, F_CLEAR);
    }

    // ---------------------------------------------------------------- shapes
    /** A solid patch of k tiles from seed (DE: create_terrain with clumping_factor): grows more often to where
     * a tile has more neighbors in the patch - the edges are uneven but without holes. */
    grow(seed, k, ok, clump = 0.75) {
        if (!ok(seed[0], seed[1])) return [];
        const cells = [seed];
        const got = new Set([_K(seed[0], seed[1])]);
        const front = new Map();

        const push = (c) => {
            const [x, y] = c;
            for (const d of _SIDES) {
                const nb = _K(x + d[0], y + d[1]);
                if (!got.has(nb)) front.set(nb, (front.get(nb) ?? 0) + 1);
            }
        };

        push(seed);
        const bad = new Set();
        while (cells.length < k && front.size) {
            const keys = Array.from(front.keys());
            let pool;
            if (random.random() < clump) {
                let mx = -Infinity;
                for (const c of keys) { const v = front.get(c); if (v > mx) mx = v; }
                const lim = mx - (mx > 2 ? 1 : 0);
                pool = keys.filter(c => front.get(c) >= lim);
            } else {
                pool = keys;
            }
            const ck = random.choice(pool);
            front.delete(ck);
            const c = _UK(ck);
            if (bad.has(ck) || !ok(c[0], c[1])) {
                bad.add(ck);
                continue;
            }
            got.add(ck);
            cells.push(c);
            push(c);
        }
        return cells;
    }

    /** A patch of k tiles of an uneven elongated shape (a forest belt / pond / islet): an ellipse with a random
     * rotation and a noisy rim; tiles are taken by "radius" from the center and only connected to those already taken. */
    blob(seed, k, ok, aspect = [1.0, 2.5], rough = 0.35) {
        if (!ok(seed[0], seed[1])) return [];
        const asp = random.uniform(aspect[0], aspect[1]);
        const a = Math.sqrt(k * asp / Math.PI);
        const b = Math.max(1.0, k / (Math.PI * a));
        const ang = random.uniform(0, Math.PI);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const ph = [];
        for (let i = 0; i < 4; i++) ph.push(random.uniform(0, math.tau));
        const fr0 = random.randint(2, 4);
        const fr1 = random.randint(5, 8);
        const R = Math.trunc(a * 1.6) + 3;
        const [cx, cy] = seed;
        const cand = [];
        for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
                const u = (dx * ca + dy * sa) / a;
                const v = (-dx * sa + dy * ca) / b;
                const t = Math.atan2(v, u);
                const r = math.hypot(u, v) / (1 + rough * (0.6 * Math.sin(fr0 * t + ph[0]) +
                    0.4 * Math.sin(fr1 * t + ph[1])));
                cand.push([r + random.uniform(0, 0.08), cx + dx, cy + dy]);
            }
        }
        cand.sort(_tcmp);
        const got = new Set([_K(seed[0], seed[1])]);
        const cells = [seed];
        let pending = cand.filter(c => !(c[1] === seed[0] && c[2] === seed[1]));
        for (let _ = 0; _ < 6; _++) {                  // several passes: a tile is taken when it has a neighbor in the patch
            const rest = [];
            for (const c of pending) {
                const [, x, y] = c;
                if (cells.length >= k) break;
                if (!(got.has(_K(x + 1, y)) || got.has(_K(x - 1, y)) || got.has(_K(x, y + 1)) || got.has(_K(x, y - 1)))) {
                    rest.push(c);
                    continue;
                }
                if (!ok(x, y)) continue;
                got.add(_K(x, y));
                cells.push([x, y]);
            }
            if (cells.length >= k || !rest.length) break;
            pending = rest;
        }
        return cells;
    }

    /** A tight pile (DE set_tight_grouping): the k tiles nearest to the center with a small spread, connected. */
    tight(cx, cy, k, ok) {
        const cand = [];
        const r = Math.trunc(Math.sqrt(k)) + 2;
        for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++)
                cand.push([math.hypot(dx, dy) + random.uniform(0, 0.9), cx + dx, cy + dy]);
        cand.sort(_tcmp);
        const got = [];
        const gs = new Set();
        for (const [, x, y] of cand) {
            if (got.length >= k) break;
            if (!ok(x, y)) continue;
            if (got.length && !(gs.has(_K(x + 1, y)) || gs.has(_K(x - 1, y)) || gs.has(_K(x, y + 1)) || gs.has(_K(x, y - 1))))
                continue;
            got.push([x, y]);
            gs.add(_K(x, y));
        }
        return got.length === k ? got : null;
    }

    // ---------------------------------------------------------------- objects
    put_node(kind, x, y, amount = null) {
        const nd = new Node(kind, x, y);
        if (amount != null) nd.amount = nd.max_amount = amount;
        this.w.nodes.push(nd);
        this.w.occ[y][x] = nd;
        this.setf(x, y, kind === 'tree' ? F_FOREST : F_RES);
        return nd;
    }

    /** A tile for a resource pile: land, free, not by the water, away from other piles and forest. */
    res_ok(x, y, gap = 3, forest_gap = 2) {
        if (!this.inb(x, y, 2) || this.T[y][x] !== LAND || this.w.occ[y][x] != null) return false;
        if (this.flag(x, y) & (F_CLEAR | F_WALL)) return false;
        if (gap && this.near_flag(x, y, gap, F_RES)) return false;
        if (forest_gap && this.near_flag(x, y, forest_gap, F_FOREST)) return false;
        return !this.near_water(x, y, 1);
    }

    /** A random point at a distance [dmin, dmax] from the start of pid, closer to it than to others'
     * (own - a margin in tiles), on the same land. None - not found. */
    spot(pid, dmin, dmax, ok, own = 0.0, edge = 3, tries = 160, ang = null) {
        const [sx, sy] = this.starts[pid];
        const home = this.land_id(sx, sy);
        for (let _ = 0; _ < tries; _++) {
            const a = ang == null ? random.uniform(0, math.tau) : ang + random.uniform(-0.5, 0.5);
            const d = random.uniform(dmin, dmax);
            const x = py.round(sx + Math.cos(a) * d), y = py.round(sy + Math.sin(a) * d);
            if (!this.inb(x, y, edge)) continue;
            if (!ok(x, y)) continue;
            if (this.land_id(x, y) !== home) continue;
            if (own != null) {
                let bad = false;
                for (let q = 0; q < this.starts.length; q++) {
                    if (q === pid) continue;
                    const [ox, oy] = this.starts[q];
                    if (math.hypot(x - ox, y - oy) < d + own) { bad = true; break; }
                }
                if (bad) continue;
            }
            return [x, y];
        }
        return null;
    }

    /** A pile of k tiles of player pid's resource: the nearest tile is at a distance d +- spread from the start. */
    pile(pid, kind, k, d, spread = 1.5, gap = 3, own = 2.0, edge = 4, amount = null, land_any = false) {
        const [sx, sy] = this.starts[pid];

        const ok = (x, y) => this.res_ok(x, y, gap);      // eslint-disable-line no-unused-vars

        for (let attempt = 0; attempt < 4; attempt++) {
            const sp = spread + attempt * 1.5;
            const g = Math.max(1, gap - attempt);
            const own_a = attempt < 3 ? own : null;

            const okg = (x, y) => this.res_ok(x, y, g);

            for (let _ = 0; _ < 60; _++) {
                const c = this.spot(pid, d - sp + 1, d + sp + 1.5, okg, own_a, edge, 20);
                if (c == null) continue;
                const cells = this.tight(c[0], c[1], k, okg);
                if (!cells) continue;
                let dn = Infinity;
                for (const [x, y] of cells) {
                    const v = math.hypot(x - sx, y - sy);
                    if (v < dn) dn = v;
                }
                if (Math.abs(dn - d) > sp) continue;
                if (!land_any && new Set(cells.map(([x, y]) => this.land_id(x, y))).size > 1) continue;
                for (const [x, y] of cells) this.put_node(kind, x, y, amount);
                return cells;
            }
        }
        return null;
    }

    /** A herd of k animals (sheep, deer) at a distance d +- spread; a boar - k = 1. */
    herd(pid, kind, k, d, spread = 2.0, owner = -1, gap = 2) {
        const ok = (x, y) => this.free_land(x, y) && !(this.flag(x, y) & (F_WALL | F_FOREST)) &&
            !this.near_flag(x, y, 1, F_FOREST | F_RES);

        for (let attempt = 0; attempt < 3; attempt++) {
            const c = this.spot(pid, d - spread - attempt * 2, d + spread + attempt * 2, ok,
                attempt < 2 ? 2.0 : null, 3);
            if (c == null) continue;
            const placed = [];
            for (let i = 0; i < k; i++) {
                let x = c[0] + (i % 2), y = c[1] + Math.floor(i / 2);
                if (!ok(x, y)) [x, y] = this.w.nearest_free_tile(c[0], c[1]);
                placed.push([x, y]);
            }
            for (const [x, y] of placed) this.animal(kind, x, y, owner);
            return placed;
        }
        return null;
    }

    animal(kind, x, y, owner = -1) {
        if (!py.contains(ANIMALS, kind)) return null;
        const a = new Animal(kind, (x + 0.5) * TILE, (y + 0.5) * TILE, this.w, owner);
        this.w.animals.push(a);
        return a;
    }

    // ---------------------------------------------------------------- forest
    forest_ok(x, y, keep = null) {
        if (!this.inb(x, y) || this.T[y][x] !== LAND || this.w.occ[y][x] != null) return false;
        if (this.flag(x, y) & (F_CLEAR | F_WALL | F_RES)) return false;
        if (keep != null && this.dstart(x, y) < keep) return false;
        return true;
    }

    forest(seed, k, keep = null, clump = 0.6, gap = 1, aspect = [1.3, 3.2]) {
        const ok = (x, y) => {
            if (!this.forest_ok(x, y, keep)) return false;
            return !(gap && this.near_flag(x, y, gap, F_RES));
        };
        const cells = aspect ? this.blob(seed, k, ok, aspect) : this.grow(seed, k, ok, clump);
        for (const [x, y] of cells) this.put_node('tree', x, y);
        return cells;
    }

    /** Player forests (DE PLAYER_FOREST): cnt = (from, to) forests of size = (from, to) tiles at dist = (from, to). */
    player_forests(cnt, size, dist, keep = 8.5) {
        const k = random.randint(cnt[0], cnt[1]);
        const sizes = [];
        for (let i = 0; i < k; i++) sizes.push(random.randint(size[0], size[1]));
        for (let pid = 0; pid < this.n; pid++) {
            const used = [];
            for (const s of sizes) {
                for (let _ = 0; _ < 40; _++) {
                    const c = this.spot(pid, dist[0], dist[1],
                        (x, y) => this.forest_ok(x, y, keep) && !this.near_flag(x, y, 3, F_RES),
                        3.0, 2, 10);
                    if (c == null) continue;
                    if (used.some(([ux, uy]) => math.hypot(c[0] - ux, c[1] - uy) < 9)) continue;
                    this.forest(c, s, keep);
                    used.push(c);
                    break;
                }
            }
        }
    }

    /** Groves across the map far from players (DE: N groves of M tiles, avoid players). */
    groves(count, size, keep = 15, sep = 10) {
        const placed = [];
        for (let _i = 0; _i < count; _i++) {
            for (let _ = 0; _ < 60; _++) {
                const x = random.randrange(3, this.W - 3), y = random.randrange(3, this.H - 3);
                if (!this.forest_ok(x, y, keep) || this.near_flag(x, y, 3, F_RES)) continue;
                if (placed.some(([a, b]) => math.hypot(x - a, y - b) < sep)) continue;
                this.forest([x, y], random.randint(size[0], size[1]), keep, undefined, undefined, [1.0, 2.4]);
                placed.push([x, y]);
                break;
            }
        }
        return placed;
    }

    /** Single trees near the center (DE stragglers.inc: 5 of them, >= 5 tiles from the TC, 125 wood). */
    stragglers(k = 5, dmin = 5.5, dmax = 8.5) {
        for (const [sx, sy] of this.starts) {
            const got = [];
            for (let _ = 0; _ < 200; _++) {
                if (got.length >= k) break;
                const a = random.uniform(0, math.tau);
                const d = random.uniform(dmin, dmax);
                const x = py.round(sx + Math.cos(a) * d), y = py.round(sy + Math.sin(a) * d);
                if (!this.inb(x, y, 2) || this.T[y][x] !== LAND || this.w.occ[y][x] != null) continue;
                if ((this.flag(x, y) & (F_WALL | F_RES)) || this.near_flag(x, y, 1, F_RES | F_FOREST)) continue;
                if (got.some(([gx, gy]) => Math.abs(x - gx) + Math.abs(y - gy) < 3)) continue;
                this.put_node('tree', x, y, STRAGGLER_WOOD);
                got.push([x, y]);
            }
        }
    }

    // ---------------------------------------------------------------- the player's standard set
    /** pk - a list of (kind, count, distance[, options]); the order is as in DE: the big ones first. */
    package(pk) {
        for (const item of pk) {
            const [kind, k, d] = item;
            const opt = item.length > 3 ? item[3] : {};
            for (let pid = 0; pid < this.n; pid++) {
                if (kind === 'gold' || kind === 'stone' || kind === 'berries') {
                    this.pile(pid, kind, k, d, opt.spread, opt.gap, opt.own, opt.edge, opt.amount, opt.land_any);
                } else if (kind === 'sheep_own') {
                    this.herd(pid, 'sheep', k, d, 1.0, pid);
                } else {
                    const kk = Array.isArray(k) ? random.randint(k[0], k[1]) : k;
                    this.herd(pid, kind, kk, d, opt.spread, opt.owner, opt.gap);
                }
            }
        }
    }

    // ---------------------------------------------------------------- far objects
    /** count objects what(x, y) across the map: >= min_players from all starts, >= sep from each other. */
    scatter(what, count, min_players, sep, ok = null, edge = 10) {
        const placed = [];
        ok = ok || ((x, y) => this.free_land(x, y) && !(this.flag(x, y) & (F_FOREST | F_RES | F_WALL)));
        for (let i = 0; i < count; i++) {
            for (let attempt = 0; attempt < 300; attempt++) {
                const lim = min_players * (attempt < 200 ? 1.0 : 0.75);
                const x = random.randrange(edge, this.W - edge), y = random.randrange(edge, this.H - edge);
                if (!ok(x, y) || this.dstart(x, y) < lim) continue;
                if (placed.some(([a, b]) => math.hypot(x - a, y - b) < sep)) continue;
                if (what(x, y) === false) continue;
                placed.push([x, y]);
                break;
            }
        }
        return placed;
    }

    wolves(per_area = 4.0, min_players = 32, sep = 16) {
        if (!py.contains(ANIMALS, 'wolf') || per_area <= 0) return [];
        const k = Math.max(2, py.round(per_area * this.scale));
        return this.scatter((x, y) => this.animal('wolf', x, y), k, min_players, sep);
    }

    relics(min_players = 32, sep = 20, count = null, open_r = 1) {
        const relics = modules.relics;
        if (!relics) return [];
        const k = count != null ? count : _by_size(RELICS, this.W);

        const put = (x, y) => {
            relics.spawn(this.w, x, y);
            this.setf(x, y, F_RES);
        };

        const ok = (x, y) => this.free_land(x, y) && !(this.flag(x, y) & (F_FOREST | F_RES | F_WALL)) &&
            !(open_r && this.near_flag(x, y, open_r, F_FOREST));
        let got = this.scatter(put, k, min_players, sep, ok, 6);
        if (got.length < k)        // did not fit - closer to the players (but not right at the center)
            got = got.concat(this.scatter(put, k - got.length, min_players * 0.6, sep * 0.6, ok, 4));
        return got;
    }

    /** A far pile (DE: 3 gold at 46, >= 10 from the edge) - one per player. */
    far_piles(kind, k, d, spread = 5, edge = 10) {
        for (let pid = 0; pid < this.n; pid++)
            this.pile(pid, kind, k, d, spread, undefined, -6.0, edge);
    }

    // ---------------------------------------------------------------- start: TC, villagers, scout
    start_units(tc = true) {
        const w = this.w;
        for (let pid = 0; pid < this.starts.length; pid++) {
            const [cx, cy] = this.starts[pid];
            const fwd = this.fwd[pid];
            const ox = Math.cos(fwd) >= 0 ? 1 : -1;
            const oy = Math.sin(fwd) >= 0 ? 1 : -1;
            let spots, scout;
            if (tc) {
                const b = w.place_building('town_center', pid, cx - 2, cy - 2, true);
                b.rally = null;
                spots = [[cx + 3 * ox, cy], [cx, cy + 3 * oy], [cx + 3 * ox, cy + 3 * oy]];
                scout = [cx - 3 * ox, cy + 3 * oy];
            } else {
                // nomad: three villagers scattered along the start circle (DE nomad: far from each other)
                const a = this.angs[pid];
                spots = [[cx, cy]];
                for (const s of [-1, 1]) {
                    const b2 = a + s * 15.0 / Math.max(10.0, this.R);
                    spots.push([py.round(this.mx + Math.cos(b2) * this.R),
                        py.round(this.my + Math.sin(b2) * this.R)]);
                }
                scout = [cx + ox * 2, cy + oy * 2];
            }
            for (let [tx, ty] of spots) {
                [tx, ty] = w.nearest_free_tile(tx, ty);
                w.units.push(new Unit('villager', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w));
            }
            const [tx, ty] = w.nearest_free_tile(scout[0], scout[1]);
            w.units.push(new Unit('scout', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w));
        }
    }

    // ---------------------------------------------------------------- water
    /** A pond of k tiles (DE: create_land/terrain WATER small). */
    pond(cx, cy, k) {
        const ok = (x, y) => this.inb(x, y, 3) && this.T[y][x] === LAND && this.dstart(x, y) > 16 &&
            !(this.flag(x, y) & (F_CLEAR | F_WALL));
        const cells = this.blob([cx, cy], k, ok, [1.0, 2.2], 0.3);
        for (const [x, y] of cells) this.T[y][x] = WATER;
        return cells;
    }

    /** Fish equally: shore = (schools, fish per school) at the nearest shore, deep - deep-water fish farther out. */
    fish(shore = [2, 3], deep = 3, dmax = 40, extra_deep = 0) {
        const w = this.w;
        const W = this.W, H = this.H;
        const T = this.T;

        const water_free = (x, y) => this.inb(x, y) && T[y][x] === WATER && w.occ[y][x] == null;

        const coast = (x, y) => water_free(x, y) && _SIDES.some(([dx, dy]) =>
            this.inb(x + dx, y + dy) && (T[y + dy][x + dx] === LAND || T[y + dy][x + dx] === SHALLOW));

        const open_ = (x, y) => {
            if (!water_free(x, y)) return false;
            for (let dx = -2; dx <= 2; dx++)
                for (let dy = -2; dy <= 2; dy++)
                    if (!(this.inb(x + dx, y + dy) && T[y + dy][x + dx] === WATER)) return false;
            return true;
        };

        const put = (kind, x, y) => {
            const nd = new Node(kind, x, y);
            w.nodes.push(nd);
            w.occ[y][x] = nd;
        };

        let taken = [];
        for (let pid = 0; pid < this.starts.length; pid++) {
            const [sx, sy] = this.starts[pid];
            const home = this.land_id(sx, sy);
            const ring = [];
            for (let y = Math.max(0, sy - dmax); y < Math.min(H, sy + dmax + 1); y++) {
                for (let x = Math.max(0, sx - dmax); x < Math.min(W, sx + dmax + 1); x++) {
                    const d = math.hypot(x - sx, y - sy);
                    if (7 <= d && d <= dmax && coast(x, y) && this.dstart(x, y) >= d - 0.5) {
                        // the shore of one's own land (islands)
                        if (_SIDES.some(([dx, dy]) => this.inb(x + dx, y + dy) && T[y + dy][x + dx] === LAND &&
                                this.land_id(x + dx, y + dy) === home))
                            ring.push([d + random.uniform(0, 6), x, y]);
                    }
                }
            }
            ring.sort(_tcmp);
            const schools = [];
            for (const [, x, y] of ring) {
                if (schools.length >= shore[0]) break;
                if (schools.concat(taken).some(([a, b]) => math.hypot(x - a, y - b) < 7)) continue;
                const cells = [[x, y]];
                const near = [];
                for (const [, x2, y2] of ring) {
                    const dd = math.hypot(x2 - x, y2 - y);
                    if (0 < dd && dd <= 2.3) near.push([dd, x2, y2]);
                }
                near.sort(_tcmp);
                for (const [, x2, y2] of near) {
                    if (cells.length >= shore[1]) break;
                    cells.push([x2, y2]);
                }
                if (cells.length < shore[1]) continue;
                for (const [cx, cy] of cells)
                    if (water_free(cx, cy)) put('shore_fish', cx, cy);
                schools.push([x, y]);
            }
            taken = taken.concat(schools);
            // deep-water: open water farther from the shore, equally
            const deep_c = [];
            for (let y = Math.max(0, sy - dmax - 8); y < Math.min(H, sy + dmax + 9); y++) {
                for (let x = Math.max(0, sx - dmax - 8); x < Math.min(W, sx + dmax + 9); x++) {
                    const d = math.hypot(x - sx, y - sy);
                    if (12 <= d && d <= dmax + 8 && open_(x, y) && this.dstart(x, y) >= d - 0.5)
                        deep_c.push([d + random.uniform(0, 10), x, y]);
                }
            }
            deep_c.sort(_tcmp);
            let got = 0;
            for (const [, x, y] of deep_c) {
                if (got >= deep) break;
                if (taken.some(([a, b]) => math.hypot(x - a, y - b) < 5)) continue;
                put('deep_fish', x, y);
                taken.push([x, y]);
                got += 1;
            }
        }
        // shared deep-water fish in the open sea
        for (let _i = 0; _i < extra_deep; _i++) {
            for (let _ = 0; _ < 200; _++) {
                const x = random.randrange(3, W - 3), y = random.randrange(3, H - 3);
                if (open_(x, y) && !taken.some(([a, b]) => math.hypot(x - a, y - b) < 6)) {
                    put('deep_fish', x, y);
                    taken.push([x, y]);
                    break;
                }
            }
        }
    }

    // ---------------------------------------------------------------- relief and result
    relief(share, peak = [4, 7], cliffs = [0, 0], no_cliff = 0.2, pond_shallows = true) {
        const w = this.w;
        const pk = random.randint(peak[0], peak[1]);
        const cl = random.randint(cliffs[0], cliffs[1]);
        w.gen_opts = { hill_share: share, peak: pk, cliffs: cl, no_cliff: no_cliff, ponds_shallow: pond_shallows };
        terrain.gen_shallows(w, this.starts);
        terrain.gen_heights(w, this.starts);
    }

    finish(dirt = true) {
        const w = this.w;
        terrain.gen_cliffs(w, this.starts);
        terrain.gen_ground(w, dirt ? this.starts : []);       // nomad: there is no land at the start point
        paint_roads(w, py.getattr(this, 'roads', []));
        w._naval_comps = null;
        w._naval_shores = null;
    }
}
py.classattrs(Gen, { _land_lab: null });


/** Roads (Black Forest: to allies) - ground lighter than grass. */
export function paint_roads(w, cells) {
    if (!cells || !cells.length) return;
    const g = terrain.G['dirt2'];
    for (const [x, y] of cells)
        if (0 <= x && x < w.W && 0 <= y && y < w.H && w.terrain[y][x] === LAND)
            w.ground[y * w.W + x] = g;
}


// ============================================================ map recipes
// The Arabia player set (DE starting_resources.inc, herdable*.inc, lureable.inc): (kind, count, distance)
export const PK_ARABIA = [
    ['gold', 7, 12], ['stone', 5, 16], ['berries', 6, 12],
    ['gold', 4, 22], ['stone', 4, 22], ['gold', 4, 28],
    ['sheep_own', 4, 8],
    ['sheep', 2, 22], ['sheep', 2, 22], ['sheep', 2, 34],
    ['deer', [2, 4], 24, { 'spread': 4 }], ['deer', [2, 4], 38, { 'spread': 2 }],
    ['boar', 1, 18], ['boar', 1, 18], ['boar', 1, 36], ['boar', 1, 36],
];


export function _arabia(g) {
    g.place_starts();
    if (random.random() < 0.15) {              // DE: a pond in 15 % of games, up to 2 small ones
        const n = random.randint(1, 2);
        for (let _ = 0; _ < n; _++) {
            const c = g.scatter((x, y) => null, 1, 24, 0, undefined, 14);
            if (c.length) g.pond(c[0][0], c[0][1], random.randint(8, 30));
        }
    }
    g.relief(random.uniform(0.11, 0.31), undefined, [0, 5], 0.2);
    g.package(PK_ARABIA.slice(0, 6));
    g.player_forests([2, 5], [55, 100], [10, 24]);
    g.groves(py.round(12 * g.scale), [40, 80], 18);
    g.stragglers();
    g.far_piles('gold', 3, 46);
    g.far_piles('stone', 3, 46);
    g.start_units();
    g.package(PK_ARABIA.slice(6));
    g.wolves();
    g.relics();
    g.finish();
}


export const PK_ARENA = [
    ['gold', 7, 10], ['stone', 5, 10], ['berries', 6, 10], ['gold', 4, 12],
    ['sheep_own', 4, 7], ['sheep', 2, 14], ['sheep', 2, 14],
    ['deer', [3, 4], 13, { 'spread': 1.5 }], ['boar', 1, 12], ['boar', 1, 12],
];


export function _octagon(cx, cy, h, c) {
    return (x, y) => {
        const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
        return dx <= h && dy <= h && dx + dy <= 2 * h - c;
    };
}

export function _arena(g) {
    const w = g.w;
    g.place_starts(0.05);
    const W = g.W, H = g.H;
    const h = g.W < 150 ? 19 : 20;
    const regions = g.starts.map(([sx, sy]) => _octagon(sx, sy, h, 3));
    // the wall ring: a tile inside that has an outside neighbor across a side (the map edge is not a wall)
    const wall = [];
    for (let i = 0; i < g.n; i++) wall.push([]);
    const owner_of = new Map();
    for (let pid = 0; pid < g.starts.length; pid++) {
        const [sx, sy] = g.starts[pid];
        const ins = regions[pid];
        for (let y = Math.max(1, sy - h); y < Math.min(H - 1, sy + h + 1); y++) {
            for (let x = Math.max(1, sx - h); x < Math.min(W - 1, sx + h + 1); x++) {
                if (!ins(x, y) || owner_of.has(_K(x, y))) continue;
                let edge = false;
                for (const [dx, dy] of _SIDES) {
                    const nx = x + dx, ny = y + dy;
                    if (1 <= nx && nx < W - 1 && 1 <= ny && ny < H - 1 && !ins(nx, ny)) edge = true;
                }
                if (edge) {
                    wall[pid].push([x, y]);
                    owner_of.set(_K(x, y), pid);
                }
            }
        }
    }
    const inside_any = [];
    for (let y = 0; y < H; y++) {
        const r = new Array(W);
        for (let x = 0; x < W; x++) r[x] = regions.some(rg => rg(x, y));
        inside_any.push(r);
    }
    for (const k of owner_of.keys()) {
        const [x, y] = _UK(k);
        g.setf(x, y, F_WALL);
    }
    // at the wall inside and outside - a passage (no forest and no piles)
    for (const k of owner_of.keys()) {
        const [x, y] = _UK(k);
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
                if (g.inb(x + dx, y + dy)) g.setf(x + dx, y + dy, F_CLEAR);
    }
    g.relief(random.uniform(0.06, 0.16), [3, 5], [0, 0], 1.0);
    // the player's set - inside the walls
    for (const item of PK_ARENA.slice(0, 4)) {
        const [kind, k, d] = item;
        for (let pid = 0; pid < g.n; pid++)
            g.pile(pid, kind, k, d, 2.0, undefined, 2.0, 3);
    }
    // forest inside the wall at the back side (DE Arena: everyone has their own forest behind the base)
    for (let pid = 0; pid < g.starts.length; pid++) {
        const [sx, sy] = g.starts[pid];
        const back = g.angs[pid];
        for (const rel of [-0.9, 0.9]) {
            const a = back + rel;
            const x = py.round(sx + Math.cos(a) * (h - 5)), y = py.round(sy + Math.sin(a) * (h - 5));
            g.forest([x, y], random.randint(45, 70), 7);
        }
    }
    // beyond the walls - solid forest; an open center
    const Rc = g.R * random.uniform(0.9, 1.02);        // the open center reaches the walls (DE: a cross-shaped clearing)
    const ph = [];
    for (let i = 0; i < 3; i++) ph.push(random.uniform(0, math.tau));
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (inside_any[y][x] || (g.flag(x, y) & (F_CLEAR | F_WALL))) continue;
            const a = Math.atan2(y - g.my, x - g.mx);
            const r = Rc + 4 * Math.sin(g.n * a + ph[0] - g.n * g.angs[0]) + 3 * Math.sin(5 * a + ph[1]) +
                1.5 * Math.sin(9 * a + ph[2]);
            if (math.hypot(x - g.mx, y - g.my) < r) continue;
            if (g.T[y][x] === LAND && w.occ[y][x] == null) g.put_node('tree', x, y);
        }
    }
    // paths to the center from the gates are not needed: the gates face the open center
    for (let pid = 0; pid < g.n; pid++) {
        g.pile(pid, 'gold', 4, h + 7, 3, undefined, 0.0, 4);
        g.pile(pid, 'stone', 4, h + 7, 3, undefined, 0.0, 4);
    }
    g.stragglers(3);
    g.start_units();
    g.package(PK_ARENA.slice(4));
    _arena_walls(g, wall);
    g.relics(h + 6, 12);
    g.wolves(0);
    g.finish();
}


/** Stone walls (ready-made) and a 4-tile gate on the side facing the center of the map. */
export function _arena_walls(g, wall) {
    const w = g.w;
    const defense = modules.defense;
    for (let pid = 0; pid < wall.length; pid++) {
        const cells = wall[pid];
        const [sx, sy] = g.starts[pid];
        const fx = Math.cos(g.fwd[pid]), fy = Math.sin(g.fwd[pid]);
        const cs = new Set(cells.map(([x, y]) => _K(x, y)));
        // gate: 4 tiles of the straight side nearest to the "forward" ray
        let best = null;
        for (const [x, y] of cells) {
            for (const horiz of [true, false]) {
                const run = [];
                for (let i = 0; i < 4; i++) run.push(horiz ? [x + i, y] : [x, y + i]);
                if (!run.every(c => cs.has(_K(c[0], c[1])))) continue;
                let smx = 0, smy = 0;
                for (const c of run) { smx += c[0]; smy += c[1]; }
                const mx = smx / 4 - sx;
                const my = smy / 4 - sy;
                const L = math.hypot(mx, my) || 1;
                const score = (mx * fx + my * fy) / L;
                if (best === null || score > best[0]) best = [score, run, horiz];
            }
        }
        const gate_cells = best ? new Set(best[1].map(c => _K(c[0], c[1]))) : new Set();
        for (const [x, y] of cells) {
            if (gate_cells.has(_K(x, y)) || w.occ[y][x] != null) continue;
            if (w.terrain[y][x] !== LAND) continue;
            w.place_building('stone_wall', pid, x, y, true);
        }
        if (best) {
            const run = best[1], horiz = best[2];
            if (run.every(([x, y]) => w.occ[y][x] == null && w.terrain[y][x] === LAND))
                w.place_building('gate', pid, run[0][0], run[0][1], true, horiz ? [4, 1] : [1, 4]);
        }
    }
    py.sort(w.buildings, b => (defense.is_wall(b) ? 0 : 1));     // walls - after the centers (drawing order)
}


export function _black_forest(g) {
    const w = g.w;
    g.place_starts(0.01);
    const W = g.W, H = g.H;
    const rc = Math.max(18.0, Math.min(28.0, Math.sqrt(0.30 * W * H / g.n / Math.PI)));
    const ph = [];
    for (let i = 0; i < g.n; i++) {
        const p = [];
        for (let j = 0; j < 3; j++) p.push(random.uniform(0, math.tau));
        ph.push(p);
    }
    const clear = new Uint8Array(W * H);

    const disc = (cx, cy, r, val = 1) => {
        const yb = Math.min(H, Math.trunc(cy + r + 2)), xb = Math.min(W, Math.trunc(cx + r + 2));
        for (let y = Math.max(0, Math.trunc(cy - r - 1)); y < yb; y++)
            for (let x = Math.max(0, Math.trunc(cx - r - 1)); x < xb; x++)
                if (math.hypot(x - cx, y - cy) <= r) clear[y * W + x] = val;
    };

    for (let pid = 0; pid < g.starts.length; pid++) {
        const [sx, sy] = g.starts[pid];
        const p = ph[pid];
        const yb = Math.min(H, Math.trunc(sy + rc + 6)), xb = Math.min(W, Math.trunc(sx + rc + 6));
        for (let y = Math.max(0, Math.trunc(sy - rc - 5)); y < yb; y++) {
            for (let x = Math.max(0, Math.trunc(sx - rc - 5)); x < xb; x++) {
                const a = Math.atan2(y - sy, x - sx);
                const r = rc + 2.5 * Math.sin(3 * a + p[0]) + 1.6 * Math.sin(5 * a + p[1]) + 1.0 * Math.sin(7 * a + p[2]);
                if (math.hypot(x - sx, y - sy) <= r) clear[y * W + x] = 1;
            }
        }
    }
    // center: a clearing (+ a pond in half of the games)
    disc(g.mx, g.my, 9 + g.n * 0.7);
    const roads = [];

    const lane = (a, b, width, road = false) => {
        const [x0, y0] = a, [x1, y1] = b;
        const L = Math.max(1, Math.trunc(math.hypot(x1 - x0, y1 - y0)));
        const wob = random.uniform(0, math.tau);
        for (let i = 0; i <= L; i++) {
            const t = i / L;
            const off = Math.sin(t * Math.PI) * 4 * Math.sin(wob + t * 5);
            const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
            const cx = x0 + (x1 - x0) * t + nx * off;
            const cy = y0 + (y1 - y0) * t + ny * off;
            disc(cx, cy, width / 2);
            if (road) roads.push([py.round(cx), py.round(cy)]);
        }
    };

    for (const s of g.starts)          // a 3-tile lane from each to the center
        lane(s, [g.mx, g.my], 4.2);
    for (let i = 0; i < g.n; i++)                        // roads to neighboring allies
        for (let j = i + 1; j < g.n; j++)
            if (py.eq(w.players[i].team, w.players[j].team))
                lane(g.starts[i], g.starts[j], 3.2, true);
    g.roads = roads;
    if (random.random() < 0.5)
        g.pond(Math.trunc(g.mx), Math.trunc(g.my), 32);
    g.relief(random.uniform(0.18, 0.3), [5, 7], [0, 1], 0.6);
    // the player's set - in the clearing
    for (const [kind, k, d] of [['gold', 7, 12], ['stone', 5, 14], ['berries', 6, 12], ['gold', 4, 16],
        ['stone', 4, 20], ['gold', 4, 21]])
        for (let pid = 0; pid < g.n; pid++)
            g.pile(pid, kind, k, d, 2.0);
    g.stragglers();
    // everything that is not a clearing or a lane is forest
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (clear[y * W + x] || g.T[y][x] !== LAND || w.occ[y][x] != null) continue;
            if (g.flag(x, y) & (F_CLEAR | F_RES)) continue;
            if (g.near_flag(x, y, 1, F_RES)) continue;
            g.put_node('tree', x, y);
        }
    }
    // in the clearings - a couple of forest "islets" near the player (DE: player forests in the clearing)
    g.player_forests([1, 2], [25, 45], [12, rc - 2], 9);
    // far piles @36 - in forest pockets (the forest around is cut down)
    for (const [kind, k] of [['gold', 4], ['stone', 4]])
        for (let pid = 0; pid < g.n; pid++)
            _pocket_pile(g, pid, kind, k, 36);
    g.start_units();
    g.package([['sheep_own', 4, 8], ['sheep', 2, 16], ['sheep', 2, 18], ['deer', [3, 4], 19, { 'spread': 3 }],
        ['boar', 1, 16], ['boar', 1, 17]]);
    for (let pid = 0; pid < g.n; pid++)
        _pocket_herd(g, pid, 'boar', 38);
    g.wolves(3, 38);
    g.relics(24, 16, undefined, 0);
    g.finish();
}


export function _clear_trees(g, cx, cy, r) {
    const w = g.w;
    for (let y = cy - r; y < cy + r + 1; y++) {
        for (let x = cx - r; x < cx + r + 1; x++) {
            if (g.inb(x, y) && math.hypot(x - cx, y - cy) <= r + 0.3) {
                const o = w.occ[y][x];
                if (o instanceof Node && o.kind === 'tree') {
                    w.occ[y][x] = null;
                    o.alive = false;
                    g.flags[y * g.W + x] &= ~F_FOREST;
                }
            }
        }
    }
    w.nodes = w.nodes.filter(n => n.alive);
}


/** A path ~2 wide from a pocket to the start - up to the first clearing tile (no trees around). */
export function _dig(g, x, y, tx, ty) {
    const L = Math.max(1, Math.trunc(math.hypot(tx - x, ty - y)));
    for (let i = 4; i < L; i++) {
        const cx = py.round(x + (tx - x) * i / L);
        const cy = py.round(y + (ty - y) * i / L);
        if (!g.near_flag(cx, cy, 2, F_FOREST)) break;
        _clear_trees(g, cx, cy, 1);
    }
}


/** A pile in the forest: a pocket of radius 3 around it, connected to the nearest clearing by a short lane. */
export function _pocket_pile(g, pid, kind, k, d) {
    const [sx, sy] = g.starts[pid];
    for (let _ = 0; _ < 80; _++) {
        const a = random.uniform(0, math.tau);
        const x = py.round(sx + Math.cos(a) * d), y = py.round(sy + Math.sin(a) * d);
        if (!g.inb(x, y, 5) || g.T[y][x] !== LAND) continue;
        if (g.starts.some(([ox, oy], q) => q !== pid && math.hypot(x - ox, y - oy) < d + 2)) continue;
        if (g.near_flag(x, y, 5, F_RES)) continue;
        _clear_trees(g, x, y, 3);
        const cells = g.tight(x, y, k, (a2, b2) => g.res_ok(a2, b2, 0, 0));
        if (cells) {
            for (const [cx, cy] of cells) g.put_node(kind, cx, cy);
            _dig(g, x, y, sx, sy);
            return cells;
        }
    }
    return null;
}


export function _pocket_herd(g, pid, kind, d) {
    const [sx, sy] = g.starts[pid];
    for (let _ = 0; _ < 60; _++) {
        const a = random.uniform(0, math.tau);
        const x = py.round(sx + Math.cos(a) * d), y = py.round(sy + Math.sin(a) * d);
        if (!g.inb(x, y, 4) || g.T[y][x] !== LAND) continue;
        if (g.starts.some(([ox, oy], q) => q !== pid && math.hypot(x - ox, y - oy) < d)) continue;
        _clear_trees(g, x, y, 2);
        _dig(g, x, y, sx, sy);
        if (g.free_land(x, y)) {
            g.animal(kind, x, y);
            return [x, y];
        }
    }
    return null;
}


export function _nomad(g) {
    const w = g.w;
    const W = g.W, H = g.H;
    // water along the map edge (DE nomad: 25-40 % of the map), land in the center; players closer to the water
    const E = W * random.uniform(0.075, 0.1);
    const ph = [];
    for (let i = 0; i < 4; i++) ph.push(random.uniform(0, math.tau));
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const e = Math.min(x, y, W - 1 - x, H - 1 - y);
            const a = Math.atan2(y - (H - 1) / 2, x - (W - 1) / 2);
            const wob = 3.5 * Math.sin(4 * a + ph[0]) + 2.5 * Math.sin(7 * a + ph[1]) + 1.5 * Math.sin(11 * a + ph[2]);
            if (e < E + wob) g.T[y][x] = WATER;
        }
    }
    g.place_starts(0.0);
    for (const [sx, sy] of g.starts)                  // for nomad the start is not right at the water
        for (let y = sy - 7; y < sy + 8; y++)
            for (let x = sx - 7; x < sx + 8; x++)
                if (g.inb(x, y, 1) && math.hypot(x - sx, y - sy) < 7.5) g.T[y][x] = LAND;
    g.label_land();
    if (random.random() < 0.5)                // a pond in half of the games
        g.pond(Math.trunc(g.mx), Math.trunc(g.my), Math.trunc(0.04 * W * H / 4));
    g.label_land();
    g.relief(random.uniform(0.12, 0.25), undefined, [0, 2], 0.5);
    // resources - around the player's point, but farther than usual (there is no center: you choose the place yourself)
    for (const [kind, k, d] of [['gold', 7, 15], ['stone', 5, 18], ['berries', 6, 14], ['gold', 4, 24], ['stone', 4, 26],
        ['gold', 4, 30]])
        for (let pid = 0; pid < g.n; pid++)
            g.pile(pid, kind, k, d, 3.0);
    g.player_forests([3, 4], [50, 90], [9, 26], 6);
    g.groves(py.round(10 * g.scale), [35, 70], 16);
    g.stragglers(3, 4, 8);
    g.start_units(false);
    g.package([['sheep', 4, 10], ['sheep', 2, 20], ['sheep', 2, 26], ['deer', [3, 4], 22, { 'spread': 3 }],
        ['boar', 1, 18], ['boar', 1, 20]]);
    g.fish([3, 3], 3, 38, Math.trunc(10 * g.scale));
    g.wolves(2);
    g.relics(26, 18);
    g.finish(false);
    for (const p of w.players)                      // on the center: wood as in DE (275 on top)
        p.res['wood'] += 275;
}


export function _islands(g) {
    const W = g.W, H = g.H;
    const n = g.n;
    const area = 0.40 * W * H / n;                  // the players' land - 35 % of the map (+ a rim cut off by the edge)
    let r0 = Math.sqrt(area / Math.PI);
    // a strait between the islands >= 7 tiles
    let R = circle_radius(W, 0.01);
    const chord = n > 1 ? 2 * R * Math.sin(Math.PI / n) : W;
    r0 = Math.min(r0 * 1.08, (chord - 8) / 2 / 1.18);
    R = Math.min(R, W / 2 - r0 * 0.6 - 3);             // an island may touch the map edge (a water rim of 3)
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            g.T[y][x] = WATER;
    g.place_starts(undefined, R, 0.3);
    for (let pid = 0; pid < g.starts.length; pid++) {
        const [sx, sy] = g.starts[pid];
        const p = [];
        for (let i = 0; i < 3; i++) p.push(random.uniform(0, math.tau));
        const yb = Math.min(H, Math.trunc(sy + r0 * 1.3) + 1), xb = Math.min(W, Math.trunc(sx + r0 * 1.3) + 1);
        for (let y = Math.max(0, Math.trunc(sy - r0 * 1.3)); y < yb; y++) {
            for (let x = Math.max(0, Math.trunc(sx - r0 * 1.3)); x < xb; x++) {
                const a = Math.atan2(y - sy, x - sx);
                const r = r0 * (1 + 0.1 * Math.sin(3 * a + p[0]) + 0.06 * Math.sin(5 * a + p[1]));
                if (math.hypot(x - sx, y - sy) < r && Math.min(x, y, W - 1 - x, H - 1 - y) >= 3)
                    g.T[y][x] = LAND;
            }
        }
    }
    _smooth(g);
    // neutral islets with gold and stone (DE: 1-2 % of the map)
    const small = [];
    const cnt = Math.max(3, n + 1 + Math.trunc(g.scale));
    for (let i = 0; i < cnt; i++) {
        for (let _ = 0; _ < 200; _++) {
            const x = random.randrange(8, W - 8), y = random.randrange(8, H - 8);
            let land = false;
            for (let yy = y - 8; yy < y + 9 && !land; yy++)
                for (let xx = x - 8; xx < x + 9; xx++)
                    if (g.inb(xx, yy) && g.T[yy][xx] !== WATER) { land = true; break; }
            if (land) continue;
            if (small.some(([a, b]) => math.hypot(x - a, y - b) < 16)) continue;
            const cells = g.blob([x, y], random.randint(70, 140), (a, b) => _isle_ok(g, a, b, r0), [1.0, 2.2]);
            for (const [a, b] of cells) g.T[b][a] = LAND;
            small.push([x, y]);
            break;
        }
    }
    g.label_land();
    g.relief(random.uniform(0.08, 0.16), [3, 5], [0, 0], 1.0);
    for (const [kind, k, d] of [['gold', 7, 12], ['stone', 4, 14], ['berries', 6, 11], ['gold', 4, 13], ['stone', 3, 17],
        ['gold', 3, 19], ['stone', 3, 19]])
        for (let pid = 0; pid < n; pid++)
            g.pile(pid, kind, k, d, 2.5, undefined, null);
    // forest: 450 tiles per island in 9 groves (x the island area / the reference 100^2*35 %/2)
    const k_isl = area / (0.35 * 10000 / 2);
    const per = Math.max(20, Math.trunc(450 * Math.min(1.6, k_isl) / 9));
    for (let pid = 0; pid < n; pid++) {
        for (let _ = 0; _ < 9; _++) {
            const c = g.spot(pid, 9, r0 * 0.95, (x, y) => g.forest_ok(x, y, 8) &&
                !g.near_flag(x, y, 2, F_RES | F_FOREST), null, 3, 80);
            if (c) g.forest(c, per, 8);
        }
    }
    g.stragglers();
    for (const [x, y] of small) {
        const kind = random.choice(['gold', 'gold', 'stone']);
        const cells = g.tight(x, y, random.randint(5, 10), (a, b) => g.res_ok(a, b, 0, 0));
        for (const [a, b] of (cells || [])) g.put_node(kind, a, b);
        g.forest([x + 3, y + 3], 12, null);
    }
    g.start_units();
    g.package([['sheep_own', 4, 8], ['sheep', 2, 14], ['sheep', 2, 16], ['deer', [3, 4], 16, { 'spread': 3 }]]);
    g.fish([3, 3], 4, 34, Math.trunc(12 * g.scale));
    const ok = (x, y) => g.free_land(x, y) && !(g.flag(x, y) & (F_FOREST | F_RES));
    _relics_any(g, ok);
    g.finish();
}


/** A tile of a neutral islet: water far from the players' islands (a strait >= 5 tiles). */
export function _isle_ok(g, a, b, r0) {
    if (!g.inb(a, b, 4) || g.T[b][a] !== WATER) return false;
    if (g.dstart(a, b) < r0 * 1.25 + 6) return false;
    return true;
}


/** Relics on islands: first the neutral islets, then the far sides of the players' islands. */
export function _relics_any(g, ok) {
    const relics = modules.relics;
    if (!relics) return;
    const k = _by_size(RELICS, g.W);

    const put = (x, y) => {
        relics.spawn(g.w, x, y);
        g.setf(x, y, F_RES);
    };

    const got = g.scatter(put, k, 16, 14, ok, 4);
    if (got.length < k)
        g.scatter(put, k - got.length, 10, 8, ok, 3);
}


export function _smooth(g) {
    const T = g.T;
    const W = g.W, H = g.H;
    for (let _ = 0; _ < 2; _++) {
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const s = (T[y][x + 1] === WATER) + (T[y][x - 1] === WATER) + (T[y + 1][x] === WATER) + (T[y - 1][x] === WATER);
                if (T[y][x] === WATER && s <= 1) T[y][x] = LAND;
                else if (T[y][x] === LAND && s >= 3) T[y][x] = WATER;
            }
        }
    }
}


export function _mediterranean(g) {
    const W = g.W, H = g.H;
    g.place_starts(0.0);
    // sea: 80 % of the inner area (rim ~ 14 % of the side), no closer than 12 tiles from the starts
    const half = W / 2 - W * 0.14;
    const ph = [];
    for (let i = 0; i < 5; i++) ph.push(random.uniform(0, math.tau));
    const amp = [random.uniform(0.04, 0.09), random.uniform(0.03, 0.06), random.uniform(0.01, 0.03)];
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const dx = Math.abs(x - g.mx) / half, dy = Math.abs(y - g.my) / half;
            const rr = (dx ** 3 + dy ** 3) ** (1 / 3);            // a rounded square (the sea follows the shape of the map)
            const a = Math.atan2(y - g.my, x - g.mx);
            const lim = 1.0 - amp[0] * (1 + Math.sin(3 * a + ph[0])) - amp[1] * (1 + Math.sin(5 * a + ph[1])) -
                amp[2] * (1 + Math.sin(11 * a + ph[2]));
            if (rr < lim && g.dstart(x, y) > 12 + 1.5 * Math.sin(4 * a + ph[3]))
                g.T[y][x] = WATER;
        }
    }
    _smooth(g);
    g.label_land();
    g.relief(random.uniform(0.1, 0.2), undefined, [0, 2], 0.5);
    g.package(PK_ARABIA.slice(0, 6));
    // forest: 9 % of the land in 12 groves + smaller player forests
    g.player_forests([2, 3], [45, 80], [9, 20]);
    let land = 0;
    for (const row of g.T) for (const t of row) if (t === LAND) land++;
    const k = py.round(12 * g.scale);
    g.groves(k, [Math.max(20, Math.trunc(0.09 * land / k * 0.6)), Math.max(30, Math.trunc(0.09 * land / k * 1.2))], 15);
    g.stragglers();
    g.start_units();
    g.package([['sheep_own', 4, 8], ['sheep', 2, 20], ['sheep', 2, 22], ['sheep', 3, 35], ['sheep', 3, 35],
        ['deer', [3, 4], 22, { 'spread': 4 }], ['boar', 1, 18], ['boar', 1, 18]]);
    g.fish([2, 3], 4, 34, Math.trunc(8 * g.scale));
    g.wolves(2, 28);
    g.relics(26, 16);
    g.finish();
}


/** Landscape: Arabia - 1 of a pool (like DE's 11 biomes), the others have their own. */
export function _theme(w, mt) {
    const forced = py.hasattr(w, 'settings') && w.settings != null ? py.get(w.settings, 'theme') : null;
    const themes = modules.themes;
    if (!themes) return 'grass';
    if (forced && py.contains(themes.THEMES, forced)) return forced;
    if (mt === 'arabia') return random.choice(themes.ARABIA_POOL);
    return py.get({
        'arena': 'grass', 'black_forest': 'grass', 'nomad': 'grass', 'islands': 'tropical',
        'mediterranean': 'grass',
    }, mt, 'grass');
}


export const RECIPES = {
    'arabia': _arabia, 'arena': _arena, 'black_forest': _black_forest, 'nomad': _nomad,
    'islands': _islands, 'mediterranean': _mediterranean,
};


/** Generate the map w.map_type (from RECIPES) in an empty world w. */
export function generate(w) {
    const g = new Gen(w);
    w.theme = _theme(w, w.map_type);
    py.get(RECIPES, w.map_type, _arabia)(g);
    if (maps.is_nomad(w.map_type)) w.nomad = true;
    return g;
}
