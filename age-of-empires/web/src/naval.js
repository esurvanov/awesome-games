// port of game/naval.py
// Water: map types, naval passability and pathfinding, ships, transport, fish, docks.
//
// The naval passability domain is separate from the land one (World.passable / World.find_path are not touched):
//   water_ok(w, x, y)        - a water tile, free (or occupied by a dock - ships enter the dock);
//   find_path_water(...)     - A* over water only (like World.find_path, but its own domain);
//   nearest_water_tile(...)  - the nearest water tile (optionally - in the same body of water);
//   comps(w)                 - connected components of land and water (the map is static, computed once);
//   shores(w)                - pairs (a land tile, a neighboring water tile) with component numbers - the shore.
// Ships are the class Ship(Unit): the same set of orders, but movement, target search, fishing and unloading are over water.
// Land units never enter water; a transport carries them across water (order_board / Ship.cmd_unload).
// Map types: MAP_TYPES - 'land' (a continent with lakes), 'coast' (a sea in the center), 'islands' (team islands).
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import * as i18n from './i18n.js';
import { TILE, DIRS, BUILDINGS, NODE_DEFS } from './data.js';
import { Unit, Building, Node, Projectile } from './world.js';
import * as maps from './maps.js';

export const MAP_TYPES = maps.ALL;           // the map list - game/maps.py (new ones by DE rules + the old land/coast)
export const MAP_NAMES = maps.NAMES;
export const FISH = py.items(NODE_DEFS).filter(([k, d]) => py.bool(py.get(d, 'water', null))).map(([k]) => k);

const SIDES4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ============================================================ water domain
export function water_ok(w, x, y) {
    if (!(0 <= x && x < w.W && 0 <= y && y < w.H) || w.terrain[y][x] !== 1) return false;
    const o = w.occ[y][x];
    return o == null || (o instanceof Building && py.bool(py.get(o.d, 'water', false)));
}

/** Water without anything (for ships to appear and land). */
export function water_free(w, x, y) {
    return 0 <= x && x < w.W && 0 <= y && y < w.H && w.terrain[y][x] === 1 && w.occ[y][x] == null;
}

export function water_px(w, x, y) {
    return water_ok(w, Math.floor(x / TILE), Math.floor(y / TILE));
}

/** (lc, wc, wsize): land / water component numbers for each tile (-1 - the wrong type), sizes of the bodies of water. */
export function comps(w) {
    let c = py.getattr(w, '_naval_comps', null);
    if (c == null) c = w._naval_comps = _compute_comps(w);
    return c;
}

export function _compute_comps(w) {
    const W = w.W, H = w.H;
    const lc = new Array(W * H).fill(-1);
    const wc = new Array(W * H).fill(-1);
    const wsize = new Map();
    let n_l = 0, n_w = 0;
    for (let s = 0; s < W * H; s++) {
        if (lc[s] >= 0 || wc[s] >= 0) continue;
        const x = s % W, y = Math.floor(s / W);
        const water = w.terrain[y][x] === 1;
        const arr = water ? wc : lc;
        const cid = water ? n_w : n_l;
        arr[s] = cid;
        const stack = [s];
        let cnt = 0;
        while (stack.length) {
            const c = stack.pop();
            cnt += 1;
            const cx = c % W, cy = Math.floor(c / W);
            for (const [dx, dy] of SIDES4) {
                const nx = cx + dx, ny = cy + dy;
                if (0 <= nx && nx < W && 0 <= ny && ny < H) {
                    const nc = ny * W + nx;
                    if (arr[nc] < 0 && (w.terrain[ny][nx] === 1) === water) {
                        arr[nc] = cid;
                        stack.push(nc);
                    }
                }
            }
        }
        if (water) {
            wsize.set(cid, cnt);
            n_w += 1;
        } else {
            n_l += 1;
        }
    }
    return [lc, wc, wsize];
}

export function land_comp(w, tx, ty) {
    if (0 <= tx && tx < w.W && 0 <= ty && ty < w.H) return comps(w)[0][ty * w.W + tx];
    return -1;
}

export function water_comp(w, tx, ty) {
    if (0 <= tx && tx < w.W && 0 <= ty && ty < w.H) return comps(w)[1][ty * w.W + tx];
    return -1;
}

export function same_land(w, a, b) {
    const la = land_comp(w, a[0], a[1]);
    return la >= 0 && la === land_comp(w, b[0], b[1]);
}

/** A list of (lx, ly, wx, wy, land component, water component): land adjacent (by a side) to water. */
export function shores(w) {
    let s = py.getattr(w, '_naval_shores', null);
    if (s == null) {
        const [lc, wc] = comps(w);
        const W = w.W;
        s = [];
        for (let y = 0; y < w.H; y++) {
            for (let x = 0; x < W; x++) {
                if (w.terrain[y][x] !== 0) continue;
                for (const [dx, dy] of SIDES4) {
                    const nx = x + dx, ny = y + dy;
                    if (0 <= nx && nx < W && 0 <= ny && ny < w.H && w.terrain[ny][nx] === 1) {
                        s.push([x, y, nx, ny, lc[y * W + x], wc[ny * W + nx]]);
                    }
                }
            }
        }
        w._naval_shores = s;
    }
    return s;
}

const _AROUND8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

export function ship_comp(w, s) {
    const [tx, ty] = s.tile();
    let c = water_comp(w, tx, ty);
    if (c < 0) {   // at the edge of a dock / shore - take the neighboring water
        for (const [dx, dy] of _AROUND8) {
            c = water_comp(w, tx + dx, ty + dy);
            if (c >= 0) break;
        }
    }
    return c;
}

export function nearest_water_tile(w, tx, ty, maxr = 16, comp = null, free = false) {
    const ok = free ? water_free : water_ok;
    const good = (x, y) => ok(w, x, y) && (comp == null || water_comp(w, x, y) === comp);
    if (good(tx, ty)) return [tx, ty];
    for (let r = 1; r < maxr; r++) {
        let best = null, bd = 1e9;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) === r && good(tx + dx, ty + dy)) {
                    const d = dx * dx + dy * dy;
                    if (d < bd) {
                        bd = d;
                        best = [tx + dx, ty + dy];
                    }
                }
            }
        }
        if (best) return best;
    }
    return [tx, ty];
}

/** A* over water (8 directions, no corner cutting across land). If the target cannot be reached -
 *  a path to the reached tile nearest by the heuristic (like World.find_path). */
export function find_path_water(w, start, goals, hx, hy, limit = 4000) {
    const W = w.W, H = w.H;
    const [sx, sy] = start;
    const s = sy * W + sx;
    const gset = new Set();
    for (const [x, y] of goals) gset.add(y * W + x);
    if (gset.has(s)) return [];
    const terr = w.terrain, occ = w.occ;

    const ok = (x, y) => {
        if (!(0 <= x && x < W && 0 <= y && y < H) || terr[y][x] !== 1) return false;
        const o = occ[y][x];
        return o == null || (o instanceof Building && py.bool(py.get(o.d, 'water', false)));
    };

    const openh = [[0.0, 0.0, s]];
    const g = new Map([[s, 0.0]]);
    const came = new Map([[s, -1]]);
    let best = s, besth = 1e9;
    let n = 0;
    while (openh.length && n < limit) {
        const [f, gc, c] = py.heappop(openh);
        if (gc > g.get(c)) continue;
        n += 1;
        if (gset.has(c)) {
            best = c;
            break;
        }
        const x = c % W, y = Math.floor(c / W);
        let ex = Math.abs(x - hx), ey = Math.abs(y - hy);
        const h = Math.max(ex, ey) + 0.414 * Math.min(ex, ey);
        if (h < besth) {
            besth = h;
            best = c;
        }
        // straight neighbors are counted once; a diagonal - only if both adjacent straights are open
        const e = ok(x + 1, y), wv = ok(x - 1, y), so = ok(x, y + 1), no = ok(x, y - 1);
        const orth = (dx, dy) => (dx === 1 ? e : dx === -1 ? wv : dy === 1 ? so : no);
        for (const [ddx, ddy, cost] of DIRS) {
            if (ddx && ddy) {
                if (!(orth(ddx, 0) && orth(0, ddy)) || !ok(x + ddx, y + ddy)) continue;
            } else if (!orth(ddx, ddy)) {
                continue;
            }
            const nx = x + ddx, ny = y + ddy;
            const nc = ny * W + nx;
            const ng = gc + cost;
            const old = g.get(nc);
            if (ng < (old === undefined ? 1e18 : old)) {
                g.set(nc, ng);
                came.set(nc, c);
                ex = Math.abs(nx - hx);
                ey = Math.abs(ny - hy);
                py.heappush(openh, [ng + Math.max(ex, ey) + 0.414 * Math.min(ex, ey), ng, nc]);
            }
        }
    }
    const path = [];
    let c = best;
    while (c !== s && c !== -1) {
        path.push([c % W, Math.floor(c / W)]);
        c = came.get(c);
    }
    path.reverse();
    return path;
}

function _ent_rect(e) {
    if (e instanceof Unit) {
        const cx = e.x / TILE, cy = e.y / TILE;
        return [cx, cy, cx, cy];
    }
    return [e.tx, e.ty, e.tx + e.w, e.ty + e.h];
}

/** A ship's path to an entity: the goals are tiles of its own body of water from which e is within rng tiles
 *  (by default - point blank). If there are none - an empty path (the target is unreachable from the water). */
export function path_to_entity_water(w, u, e, rng = null) {
    const comp = ship_comp(w, u);
    const [rx0, ry0, rx1, ry1] = _ent_rect(e);
    const r = Math.max(1.2, (rng || 0) + 0.3);
    const R = Math.trunc(Math.ceil(r));
    const goals = [];
    for (let y = Math.trunc(ry0) - R; y < Math.trunc(ry1) + R + 1; y++) {
        for (let x = Math.trunc(rx0) - R; x < Math.trunc(rx1) + R + 1; x++) {
            if (water_ok(w, x, y) && water_comp(w, x, y) === comp) {
                const dx = Math.max(rx0 - (x + 0.5), 0, (x + 0.5) - rx1);
                const dy = Math.max(ry0 - (y + 0.5), 0, (y + 0.5) - ry1);
                if (dx * dx + dy * dy <= r * r) goals.push([x, y]);
            }
        }
    }
    if (!goals.length) return [];
    const hx = Math.trunc((rx0 + rx1) / 2), hy = Math.trunc((ry0 + ry1) / 2);
    return find_path_water(w, u.tile(), goals, hx, hy, 3000);
}

/** Whether ship s can approach to attack distance of t: is there water of its body of water within reach. */
export function can_reach(w, s, t, extra = 1.0) {
    const comp = ship_comp(w, s);
    const r = (s.d['rng'] > 0 ? s.rng_tiles() : 0.6) + extra;
    const [rx0, ry0, rx1, ry1] = _ent_rect(t);
    const R = Math.trunc(Math.ceil(r));
    for (let y = Math.trunc(ry0) - R; y < Math.trunc(ry1) + R + 1; y++) {
        for (let x = Math.trunc(rx0) - R; x < Math.trunc(rx1) + R + 1; x++) {
            if (water_ok(w, x, y) && water_comp(w, x, y) === comp) {
                const dx = Math.max(rx0 - (x + 0.5), 0, (x + 0.5) - rx1);
                const dy = Math.max(ry0 - (y + 0.5), 0, (y + 0.5) - ry1);
                if (dx * dx + dy * dy <= r * r) return true;
            }
        }
    }
    return false;
}

// ============================================================ buildings on water
/** A dock: all tiles are free water, and at least one tile along a side of it is land. */
export function can_place_water(w, kind, tx, ty, pid, check_explored = true) {
    const s = BUILDINGS[kind]['size'];
    for (let y = ty; y < ty + s; y++) {
        for (let x = tx; x < tx + s; x++) {
            if (!(0 <= x && x < w.W && 0 <= y && y < w.H)) return false;
            if (w.terrain[y][x] !== 1 || w.occ[y][x] != null || w.floor[y][x] != null) return false;
            if (pid === w.human && check_explored && !w.explored[y * w.W + x]) return false;
        }
    }
    const ring = [];
    for (let x = tx; x < tx + s; x++) ring.push([x, ty - 1]);
    for (let x = tx; x < tx + s; x++) ring.push([x, ty + s]);
    for (let y = ty; y < ty + s; y++) ring.push([tx - 1, y]);
    for (let y = ty; y < ty + s; y++) ring.push([tx + s, y]);
    const inb = ring.filter(([x, y]) => 0 <= x && x < w.W && 0 <= y && y < w.H);
    if (!inb.some(([x, y]) => w.terrain[y][x] === 0)) return false;
    if (!inb.some(([x, y]) => w.terrain[y][x] === 1)) return false;
    for (const u of w.units) {
        if (u.owner !== pid && tx * TILE - 4 <= u.x && u.x <= (tx + s) * TILE + 4 && ty * TILE - 4 <= u.y && u.y <= (ty + s) * TILE + 4) {
            return false;
        }
    }
    return true;
}

/** The side of the dock (dx, dy) with the most land along the base: the sprite's "house" faces there. */
export function dock_land(w, tx, ty, s) {
    let best = [-1, 0], bn = -1;
    const cells = (f) => { const out = []; for (let i = 0; i < s; i++) out.push(f(i)); return out; };
    const sides = [
        [[0, -1], cells(i => [tx + i, ty - 1])],
        [[-1, 0], cells(i => [tx - 1, ty + i])],
        [[0, 1], cells(i => [tx + i, ty + s])],
        [[1, 0], cells(i => [tx + s, ty + i])],
    ];
    for (const [d, cl] of sides) {
        let n = 0;
        for (const [x, y] of cl) if (0 <= x && x < w.W && 0 <= y && y < w.H && w.terrain[y][x] !== 1) n += 1;
        if (n > bn) {
            best = d;
            bn = n;
        }
    }
    return best;
}

export function dock_comp(w, b) {
    for (let y = b.ty - 1; y < b.ty + b.h + 1; y++) {
        for (let x = b.tx - 1; x < b.tx + b.w + 1; x++) {
            const c = water_comp(w, x, y);
            if (c >= 0) return c;
        }
    }
    return -1;
}

export function nearest_dock(w, s) {
    const comp = ship_comp(w, s);
    let best = null, bd = 1e18;
    for (const b of w.buildings) {
        if (b.owner === s.owner && b.alive && b.complete && py.bool(py.get(b.d, 'water', null)) &&
                py.contains(py.get(b.d, 'drop', []), 'food')) {
            if (dock_comp(w, b) !== comp) continue;
            const d = s.dist_to(b);
            if (d < bd) {
                bd = d;
                best = b;
            }
        }
    }
    return best;
}

export function spawn_ship(w, b, kind) {
    const comp = null;
    const cand = [];
    for (let y = b.ty - 1; y < b.ty + b.h + 1; y++) {
        for (let x = b.tx - 1; x < b.tx + b.w + 1; x++) {
            if (!(b.tx <= x && x < b.tx + b.w && b.ty <= y && y < b.ty + b.h) && water_free(w, x, y)) {
                // toward open water (a larger body of water), then "from below", like buildings on land
                const ws = comps(w)[2].get(water_comp(w, x, y));
                cand.push([-(ws === undefined ? 0 : ws), -(y - b.ty) * 2 - (x - b.tx), x, y]);
            }
        }
    }
    let tx, ty;
    if (cand.length) {
        cand.sort((a, c) => (a[0] - c[0]) || (a[1] - c[1]) || (a[2] - c[2]) || (a[3] - c[3]));
        [, , tx, ty] = cand[0];
    } else {
        [tx, ty] = nearest_water_tile(w, b.tx + Math.floor(b.w / 2), b.ty + Math.floor(b.h / 2), undefined, comp, true);
    }
    const s = new Ship(kind, b.owner, (tx + 0.5) * TILE + random.uniform(-3, 3), (ty + 0.5) * TILE + random.uniform(-3, 3), w);
    w.units.push(s);
    const r = b.rally;
    if (r != null) {
        if (Array.isArray(r)) {
            s.cmd_move(r[0], r[1]);
        } else if (r.alive) {
            if (r instanceof Node && FISH.includes(r.kind) && py.bool(py.get(s.d, 'fisher', null))) {
                s.cmd_gather(r);
            } else if (w.hostile(r.owner, s.owner)) {
                s.cmd_attack(r);
            } else {
                s.cmd_move(...r.center());
            }
        }
    }
    return s;
}

// ============================================================ fish search
export function fish_reachable(w, n, comp) {
    for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
            if ((dx || dy) && water_free(w, n.tx + dx, n.ty + dy) && water_comp(w, n.tx + dx, n.ty + dy) === comp) return true;
        }
    }
    return false;
}

export function find_fish(w, s, x, y, radius) {
    const comp = ship_comp(w, s);
    let best = null, bd = radius * TILE;
    for (const n of w.nodes) {
        if (!n.alive || !FISH.includes(n.kind)) continue;
        const [cx, cy] = n.center();
        const d = math.hypot(cx - x, cy - y);
        if (d < bd && fish_reachable(w, n, comp)) {
            bd = d;
            best = n;
        }
    }
    return best;
}

// ============================================================ ship
export class Ship extends Unit {
    constructor(kind, owner, x, y, world) {
        super(kind, owner, x, y, world);
        this.w = world;
        this.cargo = [];             // transport passengers (outside World.units, alive=False, aboard=the ship)
        this.to_load = [];           // whom we wait for to board
        this.load_t = 0.0;
        this.unload_pt = null;
        this.landing = null;
        this.ignore = new Map();     // target -> until when not to touch it (unreachable from the water)  [Python: id(target)]
        this.prog = [0.0, 1e18];     // progress-toward-target measurement: (time, distance)
    }

    // ---- stats
    capacity() {
        return this.p.stat('carry', this.kind, py.get(this.d, 'carry', 15));
    }

    cargo_cap() {
        return Math.trunc(this.p.stat('cargo', this.kind, py.get(this.d, 'cargo', 0)));
    }

    release() {
        super.release();
        if (!this.alive && this.cargo.length) {
            // the transport sank - the passengers die
            for (const c of this.cargo) {
                c.aboard = null;
                c.alive = false;
                this.w.emit('death', this.x, this.y, c.owner, c.kind);
            }
            this.cargo = [];
        }
    }

    // ---- orders
    cmd_gather(t) {
        if (!py.bool(py.get(this.d, 'fisher', null)) || !(t instanceof Node) || !FISH.includes(t.kind)) {
            this.cmd_move(...t.center());
            return;
        }
        this.release();
        this.state = 'gather';
        this.target = t;
        this.gather_kind = t.kind;
        this.path_target = null;
    }

    cmd_build(b) {
    }

    /** Sail to the shore near the point (x, y) and unload the passengers. */
    cmd_unload(x, y) {
        this.release();
        this.state = 'unload';
        this.target = null;
        this.unload_pt = [x, y];
        this.landing = null;
        this.path = [];
        this.pending = null;
    }

    cmd_attack(t) {
        if (t == null || this.d['atk'] <= 0) return;
        super.cmd_attack(t);
        this.prog = [this.w.time, 1e18];
    }

    // ---- movement (water only)
    step_toward(w, px, py_, dt) {
        const dx = px - this.x, dy = py_ - this.y;
        const d = math.hypot(dx, dy);
        if (d < 0.5) return;
        const s = Math.min(this.speed() * dt, d);
        const nx = this.x + dx / d * s, ny = this.y + dy / d * s;
        if (water_px(w, nx, ny)) {
            this.x = nx;
            this.y = ny;
        } else if (water_px(w, nx, this.y)) {
            this.x = nx;
        } else if (water_px(w, this.x, ny)) {
            this.y = ny;
        }
        this.face = [dx / d, dy / d];
        this.anim += dt * 12;
    }

    do_move(w, dt) {
        if (this.pending != null) {
            if (w.path_budget <= 0) return;
            w.path_budget -= 1;
            const [x, y] = this.pending;
            this.pending = null;
            const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
            const comp = ship_comp(w, this);
            let goal;
            if (water_ok(w, gx, gy) && water_comp(w, gx, gy) === comp) goal = [gx, gy];
            else goal = nearest_water_tile(w, gx, gy, undefined, comp);
            this.path = find_path_water(w, this.tile(), [goal], goal[0], goal[1]);
            const reached = (this.path.length && py.eq(this.path[this.path.length - 1], goal)) || py.eq(this.tile(), goal);
            this.dest = (reached && goal[0] === gx && goal[1] === gy) ? [x, y] : null;
        }
        if (this.walk_path(w, dt)) this.state = 'idle';
    }

    approach(w, ent, rng, dt) {
        if (this.dist_to(ent) <= rng) {
            this.path = [];
            return true;
        }
        if (ent instanceof Unit && math.hypot(ent.x - this.x, ent.y - this.y) < 2.0 * TILE) {
            this.path = [];
            this.step_toward(w, ent.x, ent.y, dt);
            return false;
        }
        const need = this.path_target !== ent || (w.time >= this.repath_t && (!py.bool(this.path) || ent instanceof Unit));
        if (need && w.path_budget > 0) {
            w.path_budget -= 1;
            this.repath_t = w.time + (ent instanceof Unit ? 1.5 : 3.0) + random.random() * 0.5;
            this.path_target = ent;
            this.path = path_to_entity_water(w, this, ent, rng / TILE);
            this.dest = null;
        }
        if (py.bool(this.path)) {
            this.dest = null;
            this.walk_path(w, dt);
        } else {
            const [cx, cy] = ent.center();
            this.step_toward(w, cx, cy, dt);
        }
        return false;
    }

    // ---- update
    update(w, dt) {
        if (this.to_load.length) this.load_tick(w);
        const st = this.state;
        if (st === 'idle') {
            this.cool = Math.max(0.0, this.cool - dt);
            this.swing = Math.max(0.0, this.swing - dt);
            if (this.d['atk'] > 0 && w.time >= this.scan_t) {
                this.scan_t = w.time + 0.6;
                const e = this.find_target(w, this.los() * TILE, py.bool(py.get(this.d, 'siege', null)));
                if (e != null) this.cmd_attack(e);
            }
            return;
        }
        if (st === 'unload') {
            this.do_unload(w, dt);
            return;
        }
        super.update(w, dt);
    }

    find_target(w, radius, buildings = true) {
        const hrow = w.hmat[this.owner];
        const fogged = this.owner === w.human;
        const now = w.time;
        let best = null, bd = radius;
        const ign = (o) => { const v = this.ignore.get(o); return (v === undefined ? 0 : v) > now; };
        if (!py.bool(py.get(this.d, 'siege', null))) {
            for (const o of w.units) {
                if (!hrow[o.owner] || !o.alive || ign(o)) continue;
                if (Math.abs(o.x - this.x) + Math.abs(o.y - this.y) > bd * 1.5) continue;
                if (fogged && !w.visible_px(o.x, o.y)) continue;
                const d = math.hypot(o.x - this.x, o.y - this.y);
                if (d < bd && (o.naval || can_reach(w, this, o))) {
                    bd = d;
                    best = o;
                }
            }
            if (best != null) return best;
        }
        if (buildings) {
            bd = radius;
            for (const b of w.buildings) {
                if (!hrow[b.owner] || !b.alive || b.kind === 'farm' || ign(b)) continue;
                if (fogged && !b.seen) continue;
                const d = this.dist_to(b);
                if (d < bd && can_reach(w, this, b)) {
                    bd = d;
                    best = b;
                }
            }
        }
        return best;
    }

    give_up(w, t) {
        this.ignore.set(t, w.time + 25);
        if (this.ignore.size > 40) {
            const keep = new Map();
            for (const [k, v] of this.ignore) if (v > w.time) keep.set(k, v);
            this.ignore = keep;
        }
        this.target = null;
        this.path = [];
        this.state = 'idle';
    }

    do_attack(w, dt) {
        const t = this.target;
        if (t == null || !t.alive || py.getattr(t, 'dead', false) || t instanceof Node) {
            this.target = null;
            const e = this.find_target(w, this.los() * TILE, true);
            if (e != null) this.cmd_attack(e);
            else this.state = 'idle';
            return;
        }
        const d = this.dist_to(t);
        // are we making progress toward the target? every 3 s: if not and the target is out of reach from the water - give up
        const [pt, pd] = this.prog;
        if (w.time - pt > 3.0) {
            if (d > this.rng_px() && d > pd - 6 && !(t instanceof Unit ? t.naval : false) && !can_reach(w, this, t)) {
                this.give_up(w, t);
                return;
            }
            this.prog = [w.time, d];
        }
        const blast = py.get(this.d, 'blast', null);
        const rng = py.bool(blast) ? 6 : this.rng_px();
        const minr = py.get(this.d, 'minrng', 0) * TILE;
        if (minr && d < minr) {
            // too close for cannons - back off
            const ang = math.atan2(this.y - t.center()[1], this.x - t.center()[0]);
            this.step_toward(w, this.x + math.cos(ang) * TILE, this.y + math.sin(ang) * TILE, dt);
            return;
        }
        if (!this.approach(w, t, rng, dt)) return;
        this.face_to(t);
        if (this.cool > 0) return;
        this.cool = this.reload();
        this.swing = 0.35;
        if (py.bool(blast)) {
            this.explode(w);
            return;
        }
        if (py.bool(py.get(this.d, 'fire', null))) {
            w.damage(t, this, w.calc_damage(this, t, false));
            return;
        }
        const siege = py.bool(py.get(this.d, 'siege', null));
        const dmg = w.calc_damage(this, t, !siege);
        const pr = new Projectile(this.x, this.y - 14, t, dmg, this);
        if (siege) {
            pr.ball = true;
            pr.speed = 300;
        }
        w.projectiles.push(pr);
        w.emit('arrow', this.x, this.y, this.owner, this.kind);
    }

    /** Detonation: damage to all non-allies in the radius (ships, units, buildings), the ship itself sinks. */
    explode(w) {
        const R = this.d['blast'] * TILE;
        for (const o of w.units.slice()) {
            if (o === this || !o.alive || w.allied(o.owner, this.owner)) continue;
            if (math.hypot(o.x - this.x, o.y - this.y) - o.radius <= R) w.damage(o, this, w.calc_damage(this, o, false));
        }
        for (const b of w.buildings.slice()) {
            if (b.alive && !w.allied(b.owner, this.owner) && b.dist_px(this.x, this.y) <= R) {
                w.damage(b, this, w.calc_damage(this, b, false));
            }
        }
        w.emit('explode', this.x, this.y, this.owner, this.kind);
        w.decals.push(['blast', this.x, this.y, this.owner, w.time]);
        w.damage(this, this, this.hp + 1);
    }

    // ---- fishing
    gather_target_valid(t) {
        return t != null && t.alive && t instanceof Node && FISH.includes(t.kind);
    }

    do_gather(w, dt) {
        const t = this.target;
        if (!this.gather_target_valid(t)) {
            const nt = find_fish(w, this, this.x, this.y, 12);
            if (nt != null) {
                this.target = nt;
                this.path_target = null;
                return;
            }
            this.target = null;
            if (this.carry > 0) this.cmd_return();
            else this.state = 'idle';
            return;
        }
        if (this.carry > 0 && this.carry_res !== 'food') this.carry = 0;
        if (this.carry >= this.capacity()) {
            this.cmd_return();
            return;
        }
        if (!this.approach(w, t, 14, dt)) return;
        const rate = this.p.stat('gather', this.kind, py.get(NODE_DEFS[t.kind], 'ship_rate', 0.49), 'food', 'fish');
        this.face_to(t);
        this.work += dt;
        if (this.work > 1.5) {
            this.work = 0.0;
            this.swing = 0.3;
            w.emit('work', this.x, this.y, this.owner, 'fish');
        }
        const amt = Math.min(rate * dt, t.amount);
        t.amount -= amt;
        this.carry += amt;
        this.carry_res = 'food';
        if (t.amount <= 0) w.deplete(t);
    }

    do_return(w, dt) {
        if (this.carry <= 0) {
            this.resume_gather(w);
            return;
        }
        let d = this.drop;
        if (d == null || !d.alive || !d.complete || !py.bool(py.get(d.d, 'water', null))) {
            d = nearest_dock(w, this);
            this.drop = d;
            this.path_target = null;
        }
        if (d == null) {
            this.state = 'idle';
            return;
        }
        if (this.approach(w, d, 14, dt)) {
            const amt = Math.trunc(this.carry + 0.001);
            this.p.res['food'] += amt;
            this.p.gathered['food'] += amt;
            this.carry = 0;
            this.drop = null;
            this.resume_gather(w);
        }
    }

    resume_gather(w) {
        const t = this.target;
        if (this.gather_kind && this.gather_target_valid(t)) {
            this.state = 'gather';
            this.path_target = null;
            return;
        }
        if (this.gather_kind) {
            const nt = find_fish(w, this, this.x, this.y, 14);
            if (nt != null) {
                this.cmd_gather(nt);
                return;
            }
        }
        this.state = 'idle';
        this.target = null;
    }

    // ---- transport
    load_tick(w) {
        const cap = this.cargo_cap();
        const keep = [];
        for (const u of this.to_load) {
            if (!u.alive || u.owner !== this.owner || this.cargo.length >= cap) continue;
            if (math.hypot(u.x - this.x, u.y - this.y) <= this.radius + u.radius + 1.6 * TILE) {
                this.board(w, u);
                continue;
            }
            keep.push(u);
        }
        this.to_load = w.time - this.load_t < 60 ? keep : [];
    }

    board(w, u) {
        u.stop();
        u.alive = false;             // outside the world while it sails (the general filter will remove it from World.units)
        u.aboard = this;
        u.path = [];
        this.cargo.push(u);
        w.emit('board', this.x, this.y, this.owner, u.kind);
    }

    do_unload(w, dt) {
        if (!this.cargo.length || this.unload_pt == null) {
            this.state = 'idle';
            this.unload_pt = null;
            return;
        }
        if (this.landing == null) {
            if (w.path_budget <= 0) return;
            w.path_budget -= 1;
            this.landing = landing_spot(w, this, this.unload_pt[0], this.unload_pt[1]);
            if (this.landing == null) {
                this.state = 'idle';
                return;
            }
            const [, , wx, wy] = this.landing;
            this.path = find_path_water(w, this.tile(), [[wx, wy]], wx, wy);
            this.dest = null;
        }
        const [lx, ly] = this.landing;
        const cx = (lx + 0.5) * TILE, cy = (ly + 0.5) * TILE;
        if (math.hypot(cx - this.x, cy - this.y) <= this.radius + 1.4 * TILE) {
            this.unload(w, lx, ly);
            return;
        }
        if (this.walk_path(w, dt)) {
            if (math.hypot(cx - this.x, cy - this.y) <= this.radius + 2.2 * TILE) {
                this.unload(w, lx, ly);
            } else {
                this.step_toward(w, cx, cy, dt);
                if (w.time > this.repath_t) {
                    this.repath_t = w.time + 2.0;
                    this.landing = null;
                }
            }
        }
    }

    /** Unload everyone onto free land near (lx, ly) and send them to the order point. */
    unload(w, lx, ly) {
        const comp = land_comp(w, lx, ly);
        const spots = [];
        for (let r = 0; r < 5; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const x = lx + dx, y = ly + dy;
                    if (w.passable(x, y) && land_comp(w, x, y) === comp) spots.push([x, y]);
                }
            }
            if (spots.length >= this.cargo.length) break;
        }
        if (!spots.length) {
            this.state = 'idle';
            return;
        }
        const [px, py_] = this.unload_pt;
        const ptx = Math.floor(px / TILE), pty = Math.floor(py_ / TILE);
        const dest_ok = w.passable(ptx, pty) && land_comp(w, ptx, pty) === comp;
        for (let i = 0; i < this.cargo.length; i++) {
            const u = this.cargo[i];
            const [x, y] = spots[i % spots.length];
            u.x = (x + 0.5) * TILE + random.uniform(-5, 5);
            u.y = (y + 0.5) * TILE + random.uniform(-5, 5);
            u.aboard = null;
            u.alive = true;
            u.stop();
            w.units.push(u);
            if (dest_ok && math.hypot(px - u.x, py_ - u.y) > 2 * TILE) {
                u.cmd_move(px + random.uniform(-20, 20), py_ + random.uniform(-20, 20));
            }
        }
        w.emit('unload', this.x, this.y, this.owner, this.kind);
        this.cargo = [];
        this.unload_pt = null;
        this.landing = null;
        this.state = 'idle';
    }
}
py.classattrs(Ship, { naval: true });
py.register_class(Ship, 'naval.Ship');

/** Where to dock for unloading near the point (x, y): (land x, y, water x, y) - the shore of the ship's body of water
 *  nearest to the point (and on the same island if the point is on land). */
export function landing_spot(w, s, x, y) {
    const comp = ship_comp(w, s);
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const lc = land_comp(w, tx, ty);
    let best = null, bd = 1e18;
    for (const [lx, ly, wx, wy, l, c] of shores(w)) {
        if (c !== comp || (lc >= 0 && l !== lc) || !w.passable(lx, ly) || !water_free(w, wx, wy)) continue;
        const d = (lx - tx) ** 2 + (ly - ty) ** 2;
        if (d < bd) {
            bd = d;
            best = [lx, ly, wx, wy];
        }
    }
    return best;
}

/** Boarding: the transport goes to the shore by the squad, the squad - to the transport; those who arrive board. */
export function order_board(w, units, ship) {
    units = units.filter(u => !u.naval && u.alive && u.owner === ship.owner);
    const room = ship.cargo_cap() - ship.cargo.length;
    if (!units.length || room <= 0) return false;
    units = units.slice(0, room);
    const comp = ship_comp(w, ship);
    const ux = py.sum(units.map(u => u.x)) / units.length;          // sum(): compensated, like CPython
    const uy = py.sum(units.map(u => u.y)) / units.length;
    const t0 = units[0].tile();
    const lc = land_comp(w, t0[0], t0[1]);
    let best = null, bd = 1e18;
    for (const [lx, ly, wx, wy, l, c] of shores(w)) {
        if (c !== comp || l !== lc || !w.passable(lx, ly) || !water_free(w, wx, wy)) continue;
        const d = math.hypot((lx + 0.5) * TILE - ux, (ly + 0.5) * TILE - uy) +
            0.5 * math.hypot((wx + 0.5) * TILE - ship.x, (wy + 0.5) * TILE - ship.y);
        if (d < bd) {
            bd = d;
            best = [lx, ly, wx, wy];
        }
    }
    if (best == null) return false;
    const [lx, ly, wx, wy] = best;
    ship.stop();
    ship.cmd_move((wx + 0.5) * TILE, (wy + 0.5) * TILE);
    units.forEach((u, i) => {
        u.cmd_move((lx + 0.5) * TILE + (i % 3 - 1) * 8, (ly + 0.5) * TILE + (Math.floor(i / 3) - 1) * 8);
    });
    ship.to_load = ship.to_load.filter(u => u.alive && !units.includes(u)).concat(units);
    ship.load_t = w.time;
    return true;
}

// ============================================================ ship collisions
export function separate_ships(w) {
    const ships = w.units.filter(u => u.naval);
    if (ships.length < 2) return;
    const C = 2 * TILE;
    const grid = new Map();          // 'cx,cy' -> [ships]
    const cells = [];                // [cx, cy] in insertion order
    const keys = [];
    for (const s of ships) {
        const cx = Math.floor(s.x / C), cy = Math.floor(s.y / C);
        const k = cx + ',' + cy;
        keys.push(k);
        const lst = grid.get(k);
        if (lst === undefined) {
            grid.set(k, [s]);
            cells.push([cx, cy, k]);
        } else {
            lst.push(s);
        }
    }
    const nbc = new Map();
    for (const [cx, cy, k] of cells) {
        let nb = [];
        for (const dx of [-1, 0, 1]) {
            for (const dy of [-1, 0, 1]) {
                const lst = grid.get((cx + dx) + ',' + (cy + dy));
                if (lst !== undefined) nb = nb.concat(lst);
            }
        }
        nbc.set(k, nb.length > 1 ? nb : null);
    }
    for (let i = 0; i < ships.length; i++) {
        const s = ships[i];
        const nb = nbc.get(keys[i]);
        if (nb == null) continue;                // nobody nearby - nobody to jostle with
        let px = 0.0, py_ = 0.0;
        for (const o of nb) {
            if (o === s) continue;
            let ddx = s.x - o.x, ddy = s.y - o.y;
            const mind = s.radius + o.radius - 4;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < mind * mind) {
                let d = Math.sqrt(d2);
                if (d < 0.01) {
                    const a = random.uniform(0, math.tau);
                    ddx = math.cos(a);
                    ddy = math.sin(a);
                    d = 1.0;
                }
                const push = (mind - d) * 0.35;
                px += ddx / d * push;
                py_ += ddy / d * push;
            }
        }
        if (px || py_) {
            if (s.state === 'gather' && !py.bool(s.path)) {
                px *= 0.3;
                py_ *= 0.3;
            }
            const nx = s.x + px, ny = s.y + py_;
            if (water_px(w, nx, ny)) {
                s.x = nx;
                s.y = ny;
            }
        }
    }
}

// ============================================================ map generation
/** Carve out water before resources are placed. coast - a sea in the center, equally far from everyone;
 *  islands - all water, each player has their own island (allies are joined by an isthmus). */
export function gen_water(w, starts, slot_ang, R) {
    const W = w.W, H = w.H;
    const mx = (W - 1) / 2, my = (H - 1) / 2;
    const n = starts.length;
    const ph = [];
    for (let i = 0; i < 4; i++) ph.push(random.uniform(0, math.tau));
    const T = w.terrain;
    if (w.map_type === 'coast') {
        const Rs = Math.max(10.0, R - 18);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const a = math.atan2(y - my, x - mx);
                const r = Rs + 1.6 * math.sin(3 * a + ph[0]) + 1.1 * math.sin(5 * a + ph[1]) +
                    0.7 * math.sin(n * 2 * a + ph[2]);
                if (math.hypot(x - mx, y - my) < r + random.uniform(-0.4, 0.4)) T[y][x] = 1;
            }
        }
        // every player gets an identical bay, shifted sideways from the direction to the center
        const off = random.choice([-1, 1]) * random.uniform(0.35, 0.6);
        for (const a of slot_ang) {
            const b = a + off / 3;
            const cx = mx + math.cos(b) * (Rs + 2), cy = my + math.sin(b) * (Rs + 2);
            for (let y = Math.trunc(cy) - 6; y < Math.trunc(cy) + 7; y++) {
                for (let x = Math.trunc(cx) - 6; x < Math.trunc(cx) + 7; x++) {
                    if (0 <= x && x < W && 0 <= y && y < H && math.hypot(x - cx, y - cy) < 4.2) T[y][x] = 1;
                }
            }
        }
    } else {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) T[y][x] = 1;
        // the island's radius - so that a strait remains between foreign islands
        let D = null;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (w.players[i].team !== w.players[j].team) {
                    const v = math.hypot(starts[i][0] - starts[j][0], starts[i][1] - starts[j][1]);
                    if (D == null || v < D) D = v;
                }
            }
        }
        if (D == null) D = 60;
        const SH = 5;                                  // the island is shifted slightly from the edge toward the center of the map
        const Ri = Math.max(13.0, Math.min(24.0, D / 2 - SH - 5));
        starts.forEach(([sx0, sy0], pid) => {
            const a0 = slot_ang[pid];
            const sx = sx0 - math.cos(a0) * SH, sy = sy0 - math.sin(a0) * SH;
            for (let y = Math.trunc(sy - Ri - 4); y < Math.trunc(sy + Ri + 5); y++) {
                for (let x = Math.trunc(sx - Ri - 4); x < Math.trunc(sx + Ri + 5); x++) {
                    if (!(0 <= x && x < W && 0 <= y && y < H)) continue;
                    const a = math.atan2(y - sy, x - sx) - a0;
                    const r = Ri + 1.5 * math.sin(3 * a + ph[0]) + 1.0 * math.sin(5 * a + ph[1]);
                    if (math.hypot(x - sx, y - sy) < r) T[y][x] = 0;
                }
            }
        });
        // isthmuses between allies
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (w.players[i].team !== w.players[j].team) continue;
                const [x0, y0] = starts[i], [x1, y1] = starts[j];
                const L = Math.max(1, Math.trunc(math.hypot(x1 - x0, y1 - y0)));
                for (let q = 0; q < L + 1; q++) {
                    const cx = x0 + (x1 - x0) * q / L, cy = y0 + (y1 - y0) * q / L;
                    for (let y = Math.trunc(cy) - 5; y < Math.trunc(cy) + 6; y++) {
                        for (let x = Math.trunc(cx) - 5; x < Math.trunc(cx) + 6; x++) {
                            if (0 <= x && x < W && 0 <= y && y < H && math.hypot(x - cx, y - cy) < 4.5) T[y][x] = 0;
                        }
                    }
                }
            }
        }
        // water along the map edge (islands do not touch the edge)
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (Math.min(x, y, W - 1 - x, H - 1 - y) < 2) T[y][x] = 1;
            }
        }
    }
    // single water/land tiles are smoothed out
    for (let it = 0; it < 2; it++) {
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const s = T[y][x + 1] + T[y][x - 1] + T[y + 1][x] + T[y - 1][x];
                if (T[y][x] === 1 && s <= 1) T[y][x] = 0;
                else if (T[y][x] === 0 && s >= 3) T[y][x] = 1;
            }
        }
    }
    // the starting site is not flooded
    for (const [sx, sy] of starts) {
        for (let y = sy - 6; y < sy + 7; y++) {
            for (let x = sx - 6; x < sx + 7; x++) {
                if (0 <= x && x < W && 0 <= y && y < H) T[y][x] = 0;
            }
        }
    }
}

/** Fish - equally for each player: schools by the shore and deep-water fish farther out to sea.
 *  The directions are the same relative to "forward" (toward the center of the map), like the other resources. */
export function place_fish(w, starts, fwd) {
    const n = starts.length;

    const put = (kind, x, y) => {
        if (water_free(w, x, y) && starts.every(([sx, sy]) => math.hypot(x - sx, y - sy) > 6)) {
            const nd = new Node(kind, x, y);
            w.nodes.push(nd);
            w.occ[y][x] = nd;
            return true;
        }
        return false;
    };

    const coast_tile = (x, y) => water_free(w, x, y) && SIDES4.some(([dx, dy]) =>
        0 <= x + dx && x + dx < w.W && 0 <= y + dy && y + dy < w.H && (w.terrain[y + dy][x + dx] === 0 || w.terrain[y + dy][x + dx] === 2));

    const open_tile = (x, y) => {
        if (!water_free(w, x, y)) return false;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (!(0 <= x + dx && x + dx < w.W && 0 <= y + dy && y + dy < w.H && w.terrain[y + dy][x + dx] === 1)) return false;
            }
        }
        return true;
    };

    /** The first water tile along the ray from the start (and the corner itself). */
    const ray = (pid, rel) => {
        const [sx, sy] = starts[pid];
        const a = fwd[pid] + rel;
        for (let d = 5; d < 40; d++) {
            const x = py.round(sx + math.cos(a) * d), y = py.round(sy + math.sin(a) * d);
            if (!(0 <= x && x < w.W && 0 <= y && y < w.H)) return null;
            if (w.terrain[y][x] === 1) return [x, y, a];
        }
        return null;
    };

    if (w.map_type !== 'islands') {
        _place_fish_sea(w, starts, fwd, put, coast_tile, open_tile);
        return;
    }
    const rels = [random.uniform(0, math.tau)];
    rels.push(rels[0] + math.tau / 3 + random.uniform(-0.4, 0.4), rels[0] - math.tau / 3 + random.uniform(-0.4, 0.4));
    rels.forEach((rel, gi) => {
        const k_shore = gi < 2 ? 3 : 2;
        for (let pid = 0; pid < n; pid++) {
            const r = ray(pid, rel);
            if (r == null) continue;
            const [x0, y0, a] = r;
            _shore_school(x0, y0, k_shore, put, coast_tile);
            // deep-water - farther along the same ray, 3-4 tiles apart
            let placed = 0, nxt = 4;
            for (let d = 4; d < 24; d++) {
                if (placed >= 2) break;
                if (d < nxt) continue;
                const x = py.round(x0 + math.cos(a) * d), y = py.round(y0 + math.sin(a) * d);
                for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
                    if (open_tile(x + ox, y + oy) && put('deep_fish', x + ox, y + oy)) {
                        placed += 1;
                        nxt = d + 4;
                        break;
                    }
                }
            }
        }
    });
}

/** A school by the shore: the k rim tiles nearest to (x0, y0). */
export function _shore_school(x0, y0, k, put, coast_tile) {
    const cand = [];
    for (let y = y0 - 4; y < y0 + 5; y++) {
        for (let x = x0 - 4; x < x0 + 5; x++) {
            if (coast_tile(x, y)) cand.push([(x - x0) ** 2 + (y - y0) ** 2, x, y]);
        }
    }
    cand.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
    let placed = 0;
    for (const [, x, y] of cand) {
        if (placed >= k) break;
        if (put('shore_fish', x, y)) placed += 1;
    }
}

/** A sea in the center: rays from the center of the map at equal angles to each player -
 *  schools by the shore in front of the player, deep-water fish in the open sea. */
export function _place_fish_sea(w, starts, fwd, put, coast_tile, open_tile) {
    const mx = (w.W - 1) / 2, my = (w.H - 1) / 2;
    const n = starts.length;
    const s = random.choice([-1, 1]);
    const dmax_ = Math.max(w.W, w.H);
    for (let pid = 0; pid < n; pid++) {
        const base = fwd[pid] + math.pi;          // the player's angle as seen from the center
        for (const [rel, k] of [[s * 0.22, 3], [-s * 0.3, 3], [s * 0.55, 2]]) {
            const a = base + rel;
            let last = null;
            for (let d = 2; d < dmax_; d++) {
                const x = py.round(mx + math.cos(a) * d), y = py.round(my + math.sin(a) * d);
                if (!(0 <= x && x < w.W && 0 <= y && y < w.H) || w.terrain[y][x] !== 1) break;
                last = [x, y, d];
            }
            if (last == null) continue;
            const [x0, y0] = last;
            _shore_school(x0, y0, k, put, coast_tile);
        }
        // deep-water: two or three fish in the open sea in front of the player
        for (const [rel, frac] of [[0.0, 0.62], [s * 0.4, 0.45], [-s * 0.5, 0.75]]) {
            const a = base + rel;
            let last = 0;
            for (let d = 2; d < dmax_; d++) {
                const x = py.round(mx + math.cos(a) * d), y = py.round(my + math.sin(a) * d);
                if (!(0 <= x && x < w.W && 0 <= y && y < w.H) || w.terrain[y][x] !== 1) break;
                last = d;
            }
            const d = Math.trunc(last * frac);
            const x = py.round(mx + math.cos(a) * d), y = py.round(my + math.sin(a) * d);
            for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
                if (open_tile(x + ox, y + oy) && put('deep_fish', x + ox, y + oy)) break;
            }
        }
    }
}

// ============================================================ interface: orders, buttons
/** Orders involving ships (right click). True - the order was handled here. */
export function ui_command(g, w, units, wx, wy, target) {
    const ships = units.filter(u => u.naval);
    const land = units.filter(u => !u.naval);
    // land units -> right click on their own transport: boarding
    if (land.length && target instanceof Ship && target.owner === 0 && target.cargo_cap() > 0) {
        if (order_board(w, land, target)) {
            g.markers.push([wx, wy, [120, 200, 255], w.time]);
            w.emit('command', wx, wy, 0, 'board');
        }
        return true;
    }
    if (!ships.length) return false;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const on_land = 0 <= tx && tx < w.W && 0 <= ty && ty < w.H && (w.terrain[ty][tx] === 0 || w.terrain[ty][tx] === 2);
    const rest = [];
    for (const s of ships) {
        if (target != null && w.hostile(0, py.getattr(target, 'owner', -1)) && s.d['atk'] > 0) {
            s.cmd_attack(target);
        } else if (target instanceof Node && FISH.includes(target.kind) && py.bool(py.get(s.d, 'fisher', null))) {
            s.cmd_gather(target);
        } else if (target instanceof Building && target.owner === 0 && py.bool(py.get(target.d, 'water', null)) && s.carry > 0) {
            s.cmd_return(target);
        } else if (s.cargo.length && on_land && !(target instanceof Unit)) {
            s.cmd_unload(wx, wy);
        } else {
            rest.push(s);
        }
    }
    if (rest.length) g.group_move(rest, wx, wy);
    if (land.length) return _land_part(g, w, land, wx, wy, target);
    const col = (target != null && w.hostile(0, py.getattr(target, 'owner', -1))) ? [255, 80, 60] : [255, 255, 255];
    g.markers.push([wx, wy, col, w.time]);
    w.emit('command', wx, wy, 0, 'move');
    return true;
}

/** Mixed selection: the ships already got the order, the land units - the interface's usual way. */
export function _land_part(g, w, land, wx, wy, target) {
    const keep = g.selected;
    g.selected = land;
    try {
        g.command(wx, wy, target);
    } finally {
        g.selected = keep;
    }
    return true;
}

/** Extra buttons for selected ships: unloading at the nearest shore. */
export function unit_buttons(w, units) {
    const items = [];
    const tr = units.filter(u => u.naval && u.cargo.length);
    if (tr.length) {
        let n = 0;
        for (const u of tr) n += u.cargo.length;
        items.push({
            icon: ['unload', n], act: ['unload', null], ok: true,
            tip: [i18n.t('naval.unload'), {}, i18n.t('naval.unload_desc', { n: n })],
        });
    }
    return items;
}

export function press_unload(w, units) {
    for (const s of units) {
        if (s.naval && s.cargo.length) {
            const best = landing_spot(w, s, s.x, s.y);
            if (best) {
                const [lx, ly] = best;
                s.cmd_unload((lx + 0.5) * TILE, (ly + 0.5) * TILE);
            }
        }
    }
}
