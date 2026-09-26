// port of game/defense.py
// Defense: walls (lines of segments), gates, garrison, town bell, wall breaching, tower upgrades.
//
// Simulation logic without graphics; world.py calls hooks from here, the interface and AI use the API below.
//
// Walls and gates are ordinary buildings (BUILDINGS[...]['wall'] = True; gates also have 'gate' = True).
//   line_tiles(x0, y0, x1, y1)                    - tiles of a straight/diagonal line (like dragging in the original)
//   place_wall_line(w, kind, pid, x0, y0, x1, y1, builders)  - foundations along the line, paid per segment
//   gate_rect(tx, ty, horiz, span)  /  can_place_gate(...)  /  place_gate(...)  - a 4x1 or 1x4 gate;
//       placed on free ground or over own walls (segments are replaced)
//   Passability by owner: World.passable_for(x, y, owner), World.find_path(..., owner=...) -
//       gate tiles are passable only for the owner and allies (grid World.gate).
// Garrison (rules of the original): BUILDINGS[k]['garrison'] - capacity, ['garrison_cls'] - unit classes.
//   can_garrison(b, u) / Unit.cmd_garrison(b) / enter(w, u, b) / eject(w, b, units=None)
//   A unit inside: u.inside = the building, u.alive = False (it disappears from the map but counts toward the population), heals,
//   villagers and ranged units give the building +1 arrow. When the building is destroyed everyone comes out.
// Town bell: ring_bell(w, pid) - all villagers into the nearest buildings with room; all_clear(w, pid) - back to their tasks.
// Breach: breach_target(w, u, ent) - if the path to the target is blocked by enemy walls, the nearest blocking segment.
// Towers: upgrade_buildings(w, p, old, new) - all buildings old -> new (keeping the HP share), new ones are built as new.
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import * as i18n from './i18n.js';
import { TILE, BUILDINGS } from './data.js';
import { Building } from './world.js';

export const GARRISON_HEAL = 0.5;          // HP per game second for those sitting in a garrison
export const ARROW_CLS = ['vil', 'arch'];  // whoever is in the garrison adds an arrow
const _GARRISON_CLS = ['vil', 'inf', 'arch'];

export function is_wall(b) {
    return b instanceof Building && py.bool(py.get(b.d, 'wall', false));
}

export function is_gate(b) {
    return b instanceof Building && py.bool(py.get(b.d, 'gate', false));
}

// ============================================================ walls
/** Tiles of the line from (x0, y0) to (x1, y1) (8-connected, without gaps: diagonal joints are impassable). */
export function line_tiles(x0, y0, x1, y1) {
    const pts = [];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i < n + 1; i++) {
        const t = n ? i / n : 0.0;
        pts.push([py.round(x0 + (x1 - x0) * t), py.round(y0 + (y1 - y0) * t)]);
    }
    const out = [];
    for (const p of pts) {
        if (!out.length || !py.eq(out[out.length - 1], p)) out.push(p);
    }
    return out;
}

/** Which tiles of the line can be built on (occupied ones are skipped). */
export function wall_plan(w, kind, pid, tiles) {
    return tiles.filter(([x, y]) => w.can_place(kind, x, y, pid));
}

/** Lay a wall along a line. Pays for each segment while resources last.
 *  Builders go to the nearest segments and then build along the chain (the nearest next one).
 *  Returns the list of laid segments. */
export function place_wall_line(w, kind, pid, x0, y0, x1, y1, builders = []) {
    const p = w.players[pid];
    const placed = [];
    for (const [x, y] of wall_plan(w, kind, pid, line_tiles(x0, y0, x1, y1))) {
        if (!p.pay(p.cost_of('bld', kind))) {
            if (pid === w.human) w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
            break;
        }
        placed.push(w.place_building(kind, pid, x, y));
    }
    assign_builders(placed, builders);
    return placed;
}

/** To each builder - the segment nearest to it (evenly), then the chain in Unit.after_build. */
export function assign_builders(segs, builders) {
    segs = segs.filter(s => s.alive);
    if (!segs.length) return;
    const load = new Map();                 // segment -> builders  [Python: id(s)]
    for (const s of segs) load.set(s, 0);
    for (const u of builders) {
        if (u.kind !== 'villager') continue;
        const s = py.min(segs, s => [load.get(s), u.dist_to(s)]);
        load.set(s, load.get(s) + 1);
        u.cmd_build(s);
    }
}

// ============================================================ gates
/** (x, y, width, height) of a gate: horiz - along the x axis. */
export function gate_rect(tx, ty, horiz, span = 4) {
    return horiz ? [tx, ty, span, 1] : [tx, ty, 1, span];
}

export function gate_span(kind) {
    return py.get(BUILDINGS[kind], 'span', 4);
}

/** A gate can be placed on free ground and over own walls (not gates). */
export function can_place_gate(w, kind, tx, ty, horiz, pid, check_explored = true) {
    const [x0, y0, gw, gh] = gate_rect(tx, ty, horiz, gate_span(kind));
    for (let y = y0; y < y0 + gh; y++) {
        for (let x = x0; x < x0 + gw; x++) {
            if (!(0 <= x && x < w.W && 0 <= y && y < w.H)) return false;
            if (w.terrain[y][x] !== 0 || w.floor[y][x] != null) return false;
            const o = w.occ[y][x];
            if (o != null && !(is_wall(o) && !is_gate(o) && o.owner === pid)) return false;
            if (pid === w.human && check_explored && !w.explored[y * w.W + x]) return false;
        }
    }
    for (const u of w.units) {
        if (u.owner !== pid && x0 * TILE - 4 <= u.x && u.x <= (x0 + gw) * TILE + 4 &&
                y0 * TILE - 4 <= u.y && u.y <= (y0 + gh) * TILE + 4) {
            return false;
        }
    }
    return true;
}

/** Gate orientation at a point: along its own wall if there is one; otherwise prefer. */
export function gate_orient(w, kind, tx, ty, pid, prefer = true) {
    const span = gate_span(kind);
    let best = null;
    for (const horiz of [prefer, !prefer]) {
        const [x0, y0, gw, gh] = gate_rect(tx, ty, horiz, span);
        let walls = 0;
        for (let y = y0; y < y0 + gh; y++) {
            for (let x = x0; x < x0 + gw; x++) {
                if (0 <= x && x < w.W && 0 <= y && y < w.H && is_wall(w.occ[y][x]) && w.occ[y][x].owner === pid) walls += 1;
            }
        }
        if (best == null || walls > best[0]) best = [walls, horiz];
    }
    return best[1];
}

/** Lay a gate (the own wall segments under it are demolished). None - impossible/not enough resources. */
export function place_gate(w, kind, pid, tx, ty, horiz, builders = [], pay = true) {
    const p = w.players[pid];
    if (!can_place_gate(w, kind, tx, ty, horiz, pid)) return null;
    if (pay && !p.pay(p.cost_of('bld', kind))) return null;
    const [x0, y0, gw, gh] = gate_rect(tx, ty, horiz, gate_span(kind));
    const old = [];
    for (let y = y0; y < y0 + gh; y++) {
        for (let x = x0; x < x0 + gw; x++) {
            const o = w.occ[y][x];
            if (is_wall(o)) old.push(o);
        }
    }
    for (const o of old) w.remove_building(o, false);
    const b = w.place_building(kind, pid, x0, y0, undefined, [gw, gh]);
    for (const u of builders) {
        if (u.kind === 'villager') u.cmd_build(b);
    }
    return b;
}

/** Whether a gate is open: an own/allied unit is nearby (for drawing only). */
export function gate_open(w, b) {
    if (!b.complete) return false;
    const x0 = (b.tx - 1) * TILE, y0 = (b.ty - 1) * TILE;
    const x1 = (b.tx + b.w + 1) * TILE, y1 = (b.ty + b.h + 1) * TILE;
    const arow = w.amat[b.owner];
    for (const u of w.units) {
        if (x0 <= u.x && u.x <= x1 && y0 <= u.y && u.y <= y1 && arow[u.owner]) return true;
    }
    return false;
}

/** Mask of neighboring walls (for neat joints): bits by the DIR8 directions. */
export function wall_mask(w, b) {
    return mask_at(w, b.tx, b.ty, b.owner, undefined, b);
}

/** Mask of connections of the tile (x0, y0) with own walls/gates and the extra tiles (the line's ghost).
 *  A diagonal connects only if there is no corner path through the straight neighbors. */
export function mask_at(w, x0, y0, owner, extra = [], exclude = null) {
    const occ = w.occ;
    const has_extra = py.bool(extra);

    const wall = (x, y) => {
        if (has_extra && py.contains(extra, [x, y])) return true;
        if (0 <= x && x < w.W && 0 <= y && y < w.H) {
            const o = occ[y][x];
            return o != null && o !== exclude && is_wall(o) && o.owner === owner;
        }
        return false;
    };

    let m = 0;
    for (let i = 0; i < DIR8.length; i++) {
        const [dx, dy] = DIR8[i];
        if (wall(x0 + dx, y0 + dy)) {
            if (dx && dy && (wall(x0 + dx, y0) || wall(x0, y0 + dy))) continue;
            m |= 1 << i;
        }
    }
    return m;
}

export const DIR8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

// ============================================================ breach
/** No path to ent found: the enemy wall/gate segment near the end of the path, nearest to the target. */
export function breach_target(w, u, ent) {
    if (is_wall(ent) || !w.hostile(u.owner, ent.owner)) return null;
    let ex, ey;
    if (py.bool(u.path)) [ex, ey] = u.path[u.path.length - 1];
    else [ex, ey] = u.tile();
    const [cx, cy] = ent.center();
    let best = null, bd = 1e18;
    const hrow = w.hmat[u.owner];
    const seen = new Set();                 // [Python: id(o)]
    for (let y = ey - 3; y < ey + 4; y++) {
        for (let x = ex - 3; x < ex + 4; x++) {
            if (0 <= x && x < w.W && 0 <= y && y < w.H) {
                const o = w.occ[y][x];
                if (o == null || seen.has(o) || !is_wall(o) || !hrow[o.owner]) continue;
                seen.add(o);
                const [ox, oy] = o.center();
                const d = math.hypot(ox - cx, oy - cy) + 0.5 * math.hypot(ox - u.x, oy - u.y);
                if (d < bd) {
                    bd = d;
                    best = o;
                }
            }
        }
    }
    return best;
}

// ============================================================ garrison
export function capacity(b) {
    return b.complete ? py.get(b.d, 'garrison', 0) : 0;
}

/** Whether unit u may enter building b (own, completed, has room, a suitable class). */
export function can_garrison(b, u) {
    return (b.alive && b.complete && b.owner === u.owner && b.garrison.length < capacity(b)
            && py.contains(py.get(b.d, 'garrison_cls', _GARRISON_CLS), u.cls));
}

/** A unit enters a building: it disappears from the map (alive=False) but stays in the population. */
export function enter(w, u, b) {
    u.release();
    u.inside = b;
    u.alive = false;
    u.state = 'idle';
    u.target = null;
    u.path = [];
    u.dest = null;
    u.pending = null;
    b.garrison.push(u);
    const [cx, cy] = b.center();
    w.emit('garrison', cx, cy, b.owner, u.kind);
}

/** The 'garrison' unit state: walk to the building and enter. */
export function do_garrison(w, u, dt) {
    const b = u.target;
    if (b == null || !can_garrison(b, u)) {
        u.state = 'idle';
        u.target = null;
        return;
    }
    if (u.approach(w, b, 12, dt)) enter(w, u, b);
}

/** Up to n free tiles around the building (nearest to the "facade" first). */
export function exit_tiles(w, b, n, owner) {
    let out = [];
    for (let r = 1; r < 6; r++) {
        const ring = [];
        for (let y = b.ty - r; y < b.ty + b.h + r; y++) {
            for (let x = b.tx - r; x < b.tx + b.w + r; x++) {
                if (b.tx - r < x && x < b.tx + b.w + r - 1 && b.ty - r < y && y < b.ty + b.h + r - 1) continue;
                if (w.passable(x, y)) ring.push([-(y - b.ty) - (x - b.tx) * 0.5, x, y]);
            }
        }
        ring.sort((a, c) => (a[0] - c[0]) || (a[1] - c[1]) || (a[2] - c[2]));
        out = out.concat(ring.map(([, x, y]) => [x, y]));
        if (out.length >= n) break;
    }
    return out.length ? out : [w.nearest_free_tile(b.tx + Math.floor(b.w / 2), b.ty + b.h)];
}

/** Eject the garrison (all or the list units) around the building. Returns the ejected units. */
export function eject(w, b, units = null, rally = true) {
    units = (units == null ? b.garrison : units).slice();
    if (!units.length) return [];
    const tiles = exit_tiles(w, b, units.length, b.owner);
    const out = [];
    for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (!b.garrison.includes(u)) continue;
        b.garrison.splice(b.garrison.indexOf(u), 1);
        const [tx, ty] = tiles[i % tiles.length];
        u.x = (tx + 0.5) * TILE + random.uniform(-5, 5);
        u.y = (ty + 0.5) * TILE + random.uniform(-5, 5);
        u.inside = null;
        u.alive = true;
        u.state = 'idle';
        u.target = null;
        u.path = [];
        u.path_target = null;
        w.units.push(u);
        out.push(u);
        if (rally && b.alive && Array.isArray(b.rally)) u.cmd_move(b.rally[0], b.rally[1]);
    }
    const [cx, cy] = b.center();
    w.emit('eject', cx, cy, b.owner, out.length);
    return out;
}

/** Healing of those sitting inside (slowly, as in the original). */
export function tick_garrison(w, b, dt) {
    for (const u of b.garrison) {
        if (u.hp < u.max_hp) u.hp = Math.min(u.max_hp, u.hp + GARRISON_HEAL * dt);
    }
}

/** +1 arrow for each villager or ranged unit in the garrison. */
export function bonus_arrows(b) {
    if (!b.garrison.length) return 0;
    let n = 0;
    for (const u of b.garrison) if (ARROW_CLS.includes(u.cls)) n += 1;
    return n;
}

export function garrison_buildings(w, pid, cls = 'vil') {
    return w.buildings.filter(b => b.owner === pid && b.alive && b.complete && capacity(b) > 0
        && py.contains(py.get(b.d, 'garrison_cls', _GARRISON_CLS), cls));
}

// ============================================================ town bell
/** Remember a villager's task so as to restore it after "All clear". */
export function snapshot(u) {
    const st = u.state;
    if ((st === 'gather' || st === 'return') && u.gather_kind) return ['gather', u.target, u.gather_kind];
    if (st === 'build' && u.target != null) return ['build', u.target, null];
    return ['pos', [u.x, u.y], null];
}

/** Town bell: all of the player's villagers run to the nearest buildings with room (center, towers, castle). */
export function ring_bell(w, pid) {
    const p = w.players[pid];
    p.bell = true;
    const blds = garrison_buildings(w, pid);
    const room = new Map();                 // building -> free places  [Python: id(b)]
    for (const b of blds) room.set(b, capacity(b) - b.garrison.length);
    const vils = w.units.filter(u => u.owner === pid && u.kind === 'villager' && u.alive);
    let n = 0;
    for (const u of vils) {
        if (py.getattr(u, 'bell_task', null) == null) u.bell_task = snapshot(u);
        const cands = blds.filter(b => room.get(b) > 0);
        if (!cands.length) continue;
        // the center takes priority if it is not much farther
        const b = py.min(cands, b => u.dist_to(b) * (b.kind === 'town_center' ? 0.7 : 1.0));
        room.set(b, room.get(b) - 1);
        u.cmd_garrison(b);
        n += 1;
    }
    let cx, cy;
    if (blds.length) [cx, cy] = blds[0].center();
    else [cx, cy] = [w.starts[pid][0] * TILE, w.starts[pid][1] * TILE];
    w.emit('bell', cx, cy, pid, n);
    if (pid === w.human) w.msg(i18n.t('msg.bell'), [255, 200, 110]);
    return n;
}

/** 'All clear': villagers come out and return to their previous tasks. */
export function all_clear(w, pid) {
    const p = w.players[pid];
    p.bell = false;
    let back = [];
    for (const b of w.buildings.slice()) {
        if (b.owner === pid && b.garrison.length) {
            const vs = b.garrison.filter(u => u.kind === 'villager' && py.getattr(u, 'bell_task', null) != null);
            back = back.concat(eject(w, b, vs, false));
        }
    }
    for (const u of w.units) {
        if (u.owner === pid && u.kind === 'villager' && py.getattr(u, 'bell_task', null) != null) {
            if (!back.includes(u)) back.push(u);
        }
    }
    for (const u of back) restore(w, u);
    if (pid === w.human) w.msg(i18n.t('msg.all_clear'), [170, 230, 150]);
    return back.length;
}

export function restore(w, u) {
    const task = u.bell_task;
    u.bell_task = null;
    if (task == null) return;
    const [kind, t, extra] = task;
    if (kind === 'gather') {
        if (t != null && u.gather_target_valid(t)) {
            u.cmd_gather(t);
            return;
        }
        const nt = w.find_resource(u, extra, u.x, u.y, 14);
        if (nt != null) {
            u.cmd_gather(nt);
            return;
        }
        u.gather_kind = extra;
        u.state = 'idle';
    } else if (kind === 'build') {
        if (t.alive && !t.complete) u.cmd_build(t);
    } else {
        u.cmd_move(t[0], t[1]);
    }
}

// ============================================================ towers
/** All buildings old of player p -> new (the HP share is kept), later ones are built as new right away. */
export function upgrade_buildings(w, p, old, new_) {
    const alias = p.alias;
    const set = (k, v) => { if (alias instanceof Map) alias.set(k, v); else alias[k] = v; };
    for (const [k, v] of py.items(alias)) {
        if (v === old) set(k, new_);
    }
    set(old, new_);
    const d = BUILDINGS[new_];
    for (const b of w.buildings) {
        if (b.owner === p.id && b.kind === old && b.alive) {
            const frac = b.max_hp ? b.hp / b.max_hp : 1.0;
            b.kind = new_;
            b.d = d;
            b.max_hp = p.stat('hp', new_, d['hp']);
            b.hp = Math.max(1.0, b.max_hp * frac);
            const [cx, cy] = b.center();
            w.emit('upgrade', cx, cy, p.id, new_);
        }
    }
}

/** For techs: TECHS[...]['on_apply'] = building_upgrade('tower', 'guard_tower'). */
export function building_upgrade(old, new_) {
    function apply(w, p) {
        upgrade_buildings(w, p, old, new_);
    }
    return apply;
}
