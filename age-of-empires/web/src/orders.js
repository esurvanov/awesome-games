// port of game/orders.py
// Unit orders beyond the basic Unit.cmd_* (as in AoE2 DE): a queue of Shift orders (waypoints),
// patrol, guard, follow, attack-move, attack ground, repair, stances, formation and the group's shared speed,
// rally points (including into a garrison and several points).
//
// Unit fields (defaults are class attributes of Unit, see world.py):
//   stance     - 'aggressive' | 'defensive' | 'stand_ground' | 'no_attack'
//   orders     - a queue of the next orders [(kind, *args)], None - empty
//   mission    - a long-running order: ['amove', x, y, attempts] | ['patrol', points, i, attempts] |
//                ['guard', target] | ['follow', target]
//   home       - where the unit stood when it got into a fight on its own (defensive stance / stand ground)
//   auto       - the current attack was started by the unit itself (not by a player's order)
//   form_speed - the formation speed (px/s): the group moves at the speed of the slowest
//   gpt        - the "attack ground" point
//
// The AI uses only cmd_* and does not touch these fields: its units have an aggressive stance, an empty queue -
// the behavior is as before.
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import * as i18n from './i18n.js';
import { TILE } from './data.js';

export const STANCES = ['aggressive', 'defensive', 'stand_ground', 'no_attack'];
export const FORMATIONS = ['line', 'box', 'staggered', 'flank'];
export const PATROL_MAX = 10;          // DE: patrol and attack-move have up to 10 points
export const FLAGS_SHOWN = 10;         // DE: the queue is unlimited, but 10 flags are shown
export const DEF_CHASE = 5 * TILE;     // defensive stance: it does not pursue farther than this from the spot
export const REPAIR_HP_S = 750 / 60;   // building repair by one villager, HP/s (openage repair.md: 750 HP/min)
export const REPAIR_UNIT_K = 0.25;     // siege and ships are repaired four times slower
export const REPAIR_COST_K = 0.5;      // a full repair costs half of the construction (without gold)
export const SCAN_DT = 0.4;

// ============================================================ queue
/** A new direct order from the player: forget the queue, the long-running order, "home" and the formation. */
export function clear(u) {
    u.orders = null;
    u.mission = null;
    u.home = null;
    u.auto = false;
    u.form_speed = null;
}

export function busy(u) {
    return u.state !== 'idle' || py.bool(u.orders) || u.mission != null;
}

/** Give an order item = (kind, *args). queue - Shift: to the end of the queue (if the unit is busy with something). */
export function issue(u, w, item, queue = false) {
    if (queue && busy(u)) {
        if (u.orders == null) u.orders = [];
        u.orders.push(item);
        return true;
    }
    clear(u);
    return run(u, w, item);
}

export function _alive(t) {
    return t != null && py.bool(t.alive) && !py.getattr(t, 'dead', false);
}

/** Carry out an order now. False - the target is gone, the order was skipped. */
export function run(u, w, item) {
    const k = item[0];
    if (k === 'move') {
        u.cmd_move(item[1], item[2]);
        if (item.length > 3 && item[3]) u.form_speed = item[3];
    } else if (k === 'attack') {
        if (!_alive(item[1]) && !(py.getattr(item[1], 'dead', false) && u.kind === 'villager')) return false;
        u.cmd_attack(item[1]);
    } else if (k === 'gather') {
        if (!item[1].alive) return false;
        u.cmd_gather(item[1]);
    } else if (k === 'build') {
        if (!item[1].alive || item[1].complete) return false;
        u.cmd_build(item[1]);
    } else if (k === 'return') {
        u.cmd_return(item[1]);
    } else if (k === 'garrison') {
        if (!item[1].alive) return false;
        u.cmd_garrison(item[1]);
    } else if (k === 'heal') {
        u.cmd_heal(item[1]);
    } else if (k === 'repair') {
        return cmd_repair(u, item[1]);
    } else if (k === 'patrol') {
        const pts = [[u.x, u.y]].concat(py.list(item[1]).slice(0, PATROL_MAX));
        u.mission = ['patrol', pts, 1, 0];
        u.cmd_move(pts[1][0], pts[1][1]);
    } else if (k === 'amove') {
        u.mission = ['amove', item[1], item[2], 0];
        u.cmd_move(item[1], item[2]);
    } else if (k === 'guard') {
        if (!_alive(item[1])) return false;
        u.mission = ['guard', item[1]];
        u.mis_t = 0.0;
    } else if (k === 'follow') {
        if (!_alive(item[1])) return false;
        u.mission = ['follow', item[1]];
        u.mis_t = 0.0;
    } else if (k === 'aground') {
        return cmd_attack_ground(u, item[1], item[2]);
    } else if (k === 'rally') {
        rally_order(w, u, item[1]);
    } else if (k === 'stop') {
        u.stop();
    } else if (k === 'relic' || k === 'relic_in') {          // monk: pick up a relic / carry it to the monastery (game/relics.py)
        const relics = modules.relics;
        return k === 'relic' ? relics.cmd_pick(u, w, item[1]) : relics.cmd_deposit(u, w, item[1]);
    } else {
        return false;
    }
    return true;
}

export function near(u, x, y, r = 0.9 * TILE) {
    return Math.abs(u.x - x) <= r && Math.abs(u.y - y) <= r;
}

/** The unit stands idle, but it has a queue / a long-running order / a place to return to. */
export function on_idle(u, w) {
    const m = u.mission;
    if (m != null) {
        const k = m[0];
        if (k === 'amove') {
            if (near(u, m[1], m[2], 1.5 * TILE) || m[3] >= 3) {
                u.mission = null;
            } else {
                m[3] += 1;
                u.cmd_move(m[1], m[2]);
                return;
            }
        } else if (k === 'patrol') {
            const pts = m[1];
            if (near(u, pts[m[2]][0], pts[m[2]][1], 1.5 * TILE) || m[3] >= 2) {
                m[2] = (m[2] + 1) % pts.length;
                m[3] = 0;
            } else {
                m[3] += 1;
            }
            u.cmd_move(pts[m[2]][0], pts[m[2]][1]);
            return;
        } else {
            return;          // guard / follow - in tick
        }
    }
    while (py.bool(u.orders) && u.state === 'idle') run(u, w, u.orders.shift());
    if (u.state === 'idle' && u.home != null && u.stance !== 'aggressive') {
        const [hx, hy] = u.home;
        if (!near(u, hx, hy, 0.6 * TILE) && w.time >= py.getattr(u, '_ret_t', 0.0)) {
            u._ret_t = w.time + 2.0;
            u.cmd_move(hx, hy);
        }
    }
}

// ============================================================ long-running orders
/** An enemy nearby by the stance (for attack-move / patrol / guard). */
export function scan(u, w) {
    const r = scan_radius(u);
    if (r <= 0 || u.cls === 'vil' || py.bool(py.get(u.d, 'monk', null))) return null;
    const d = u.d;
    return w.nearest_enemy(u, r, py.bool(py.get(d, 'bld_only', null)) || py.bool(py.get(d, 'pack', null)) || u.mission[0] === 'amove',
        u.minr_px(), !py.bool(py.get(d, 'bld_only', null)));
}

/** Every SCAN_DT: attack-move / patrol look for enemies along the way, guard stays near the target, follow - after the target. */
export function tick(u, w, dt) {
    if (w.time < u.mis_t) return;
    u.mis_t = w.time + SCAN_DT;
    const m = u.mission;
    const k = m[0];
    const st = u.state;
    if (k === 'amove' || k === 'patrol') {
        if (st === 'move' && u.stance !== 'no_attack') {
            const e = scan(u, w);
            if (e != null) {
                u.cmd_attack(e);
                u.auto = true;
            }
        }
        return;
    }
    const t = m[1];
    if (!_alive(t) || (py.hasattr(t, 'owner') && t.owner !== u.owner && !w.allied(u.owner, t.owner) && k === 'guard')) {
        u.mission = null;
        return;
    }
    if (st !== 'idle' && st !== 'move') return;
    const [tx, ty] = t.center();
    if (k === 'guard') {
        if (u.stance !== 'no_attack' && u.cls !== 'vil') {
            const e = w.nearest_enemy(u, u.los() * TILE, false, undefined, true);
            if (e != null && math.hypot(e.x - tx, e.y - ty) <= 6 * TILE) {
                u.cmd_attack(e);
                u.auto = true;
                return;
            }
        }
    }
    const lim = py.hasattr(t, 'radius') ? 2.5 * TILE : (Math.max(t.w, t.h) / 2 + 2) * TILE;
    if (math.hypot(tx - u.x, ty - u.y) > lim) {
        const a = math.atan2(u.y - ty, u.x - tx);
        const rr = lim * 0.6;
        u.cmd_move(tx + math.cos(a) * rr, ty + math.sin(a) * rr);
    }
}

// ============================================================ stances
export function scan_radius(u) {
    const st = u.stance;
    if (st === 'no_attack') return 0;
    if (st === 'stand_ground' || py.bool(py.get(u.d, 'pack', null))) return u.rng_px() + (u.d['rng'] <= 0 ? 0.4 * TILE : 0);
    return u.los() * TILE;
}

/** The unit gets into a fight with e on its own (saw it in view / answered a blow) - by the stance. True - it attacks. */
export function engage(u, e) {
    const st = u.stance;
    if (st === 'no_attack') return false;
    if (st === 'stand_ground' && u.dist_to(e) > u.rng_px() + 0.4 * TILE) return false;
    u.cmd_attack(e);
    u.auto = true;
    if (st !== 'aggressive' && u.home == null) u.home = [u.x, u.y];
    return true;
}

/** Does a unit that got into a fight on its own still pursue t? (defensive - not far, stand ground - only in the zone). */
export function may_chase(u, t) {
    const st = u.stance;
    if (st === 'stand_ground') return u.dist_to(t) <= u.rng_px() + 0.4 * TILE;
    if (st === 'defensive' && u.home != null) {
        const [tx, ty] = t.center();
        return math.hypot(tx - u.home[0], ty - u.home[1]) <= DEF_CHASE + u.rng_px();
    }
    return st !== 'no_attack';
}

export function set_stance(units, st) {
    for (const u of units) {
        u.stance = st;
        if (st === 'aggressive') u.home = null;
        else if (u.home == null) u.home = [u.x, u.y];
        if (st === 'no_attack' && u.state === 'attack' && u.auto) u.stop();
    }
}

// ============================================================ repair
/** Villager u can repair t: an own completed damaged building, own siege or ship. */
export function repairable(u, t) {
    if (u.kind !== 'villager' || t == null || !t.alive || t.owner !== u.owner || t.hp >= t.max_hp) return false;
    if (py.hasattr(t, 'radius')) return (t.cls === 'siege' || t.cls === 'ship') && !py.getattr(t, 'dead', false);
    return py.bool(t.complete) && t.kind !== 'farm';
}

export function cmd_repair(u, t) {
    if (!repairable(u, t)) return false;
    u.release();
    u.state = 'repair';
    u.target = t;
    u.path_target = null;
    return true;
}

export function _repair_cost(p, t) {
    const unit = py.hasattr(t, 'radius');
    const cost = p.cost_of(unit ? 'unit' : 'bld', t.kind);
    const out = {};
    for (const [r, v] of py.items(cost)) {
        if (v && r !== 'gold') out[r] = v * REPAIR_COST_K / Math.max(1.0, t.max_hp);
    }
    return out;
}

export function do_repair(u, w, dt) {
    const t = u.target;
    if (!repairable(u, t)) {
        u.state = 'idle';
        u.target = null;
        return;
    }
    let near_ok;
    if (py.hasattr(t, 'radius')) near_ok = u.approach(w, t, 12, dt);
    else near_ok = u.approach(w, t, 10, dt);
    if (!near_ok) return;
    u.face_to(t);
    // how many villagers are repairing t in this step: the first - full speed, each next +50%
    if (py.getattr(t, '_rep_t', null) !== w.time) {
        t._rep_prev = py.getattr(t, '_rep_cur', 1);
        t._rep_cur = 0;
        t._rep_t = w.time;
    }
    t._rep_cur += 1;
    const n = Math.max(1, t._rep_prev, t._rep_cur);
    const base = REPAIR_HP_S * (py.hasattr(t, 'radius') ? REPAIR_UNIT_K : 1.0);
    const rate = base * (1 + 0.5 * (n - 1)) / n * u.p.stat('build', u.kind, 1);
    const dh = Math.min(rate * dt, t.max_hp - t.hp);
    const p = u.p;
    let debt = py.getattr(p, 'rep_debt', null);
    if (debt == null) debt = p.rep_debt = {};
    for (const [r, per] of Object.entries(_repair_cost(p, t))) {
        let v = py.get(debt, r, 0.0) + per * dh;
        if (v >= 1.0) {
            const n_int = Math.trunc(v);
            if (py.get(p.res, r, 0) < n_int) {
                if (p === w.players[w.human]) w.msg(i18n.t('msg.no_resources_repair'), [255, 150, 90]);
                u.state = 'idle';
                u.target = null;
                return;
            }
            p.res[r] -= n_int;
            v -= n_int;
        }
        debt[r] = v;
    }
    t.hp = Math.min(t.max_hp, t.hp + dh);
    u.work += dt;
    if (u.work > 0.8) {
        u.work = 0.0;
        u.swing = 0.3;
        w.emit('work', u.x, u.y, u.owner, 'build');
    }
}

// ============================================================ attack ground
export function can_attack_ground(u) {
    return py.get(u.d, 'blast', 0) > 0 && !u.naval && u.d['atk'] > 0;
}

export function cmd_attack_ground(u, x, y) {
    if (!can_attack_ground(u)) return false;
    u.release();
    u.state = 'aground';
    u.gpt = [x, y];
    u.target = null;
    u.path = [];
    u.dest = null;
    u.path_target = null;
    return true;
}

export function do_attack_ground(u, w, dt) {
    const { Projectile } = modules.world;
    const [x, y] = u.gpt;
    const d = math.hypot(x - u.x, y - u.y);
    const rng = u.rng_px();
    const mr = u.minr_px();
    if (d > rng) {
        if (py.bool(py.get(u.d, 'pack', null)) && !u.packed) {
            u.start_pack(w, true);
            return;
        }
        if (u.path_target !== 'ground' || (!py.bool(u.path) && w.time >= u.repath_t)) {
            if (w.path_budget <= 0) return;
            w.path_budget -= 1;
            u.path_target = 'ground';
            u.repath_t = w.time + 2.0;
            const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
            const goal = w.passable(gx, gy) ? [gx, gy] : w.nearest_free_tile(gx, gy);
            u.path = w.find_path(u.tile(), [goal], goal[0], goal[1], undefined, u.owner);
            u.dest = null;
        }
        if (py.bool(u.path)) u.walk_path(w, dt);
        else u.step_toward(w, x, y, dt);
        return;
    }
    u.path = [];
    if (mr && d < mr) {
        u.state = 'idle';
        return;
    }
    const dx = x - u.x, dy = y - u.y;
    if (d > 0.1) u.face = [dx / d, dy / d];
    if (py.bool(py.get(u.d, 'pack', null)) && u.packed) {
        u.start_pack(w, false);
        return;
    }
    if (u.cool <= 0) {
        u.cool = u.reload();
        u.swing = 0.3;
        let px = x, py_ = y;
        const acc = u.acc();
        if (acc < 1.0 && random.random() > acc) {
            const a = random.uniform(0, math.tau);
            const r = random.uniform(0.5, 1.3) * TILE;
            px = px + math.cos(a) * r;
            py_ = py_ + math.sin(a) * r;
        }
        w.projectiles.push(new Projectile(u.x, u.y - 10, null, u.atk(), u, 0.0, [px, py_],
            py.get(u.d, 'blast', 0) * TILE, false));
        w.emit('arrow', u.x, u.y, u.owner, u.kind);
    }
}

// ============================================================ formation
export const _ROLE = { cav: 0, inf: 1, vil: 1, arch: 2 };      // front to back: cavalry, infantry, ranged units, siege/monks

export function role(u) {
    return py.get(_ROLE, u.cls, 3);
}

/** The formation step - by the widest unit (openage formations.md). */
export function spacing(units) {
    let m = -Infinity;
    for (const u of units) m = Math.max(m, 2 * u.radius);
    return m + 6;
}

/** How many units in a row: the formation is wider than deep. */
export function _rows(n, form) {
    if (n <= 4) return n;
    const per = Math.trunc(Math.ceil(Math.sqrt(n * (form !== 'box' ? 3.0 : 1.0))));
    return Math.max(1, Math.min(n, per));
}

/** [(unit, x, y)] - places in the formation around the point (wx, wy); heading - the (dx, dy) direction of movement. */
export function layout(units, wx, wy, form = 'line', heading = null) {
    const n = units.length;
    if (n === 0) return [];
    if (n === 1) return [[units[0], wx, wy]];
    if (heading == null) {
        // sum() of floats: CPython's compensated summation (py.sum), as in Python
        const cx = py.sum(units.map(u => u.x)) / n;
        const cy = py.sum(units.map(u => u.y)) / n;
        heading = [wx - cx, wy - cy];
    }
    let [hx, hy] = heading;
    let hl = math.hypot(hx, hy);
    if (hl < 1e-3) {
        hx = 1.0;
        hy = 1.0;
        hl = Math.sqrt(2);
    }
    const fx = hx / hl, fy = hy / hl;          // forward
    const sx = -fy, sy = fx;                   // right
    let sp = spacing(units);
    if (form === 'staggered') sp *= 1.7;
    const groups = [[], [], [], []];
    for (const u of units) groups[role(u)].push(u);
    const slots = [];                         // (sideways, back, group)
    if (form === 'box') {
        // box: melee along the perimeter of the square, ranged units and siege - inside
        const melee = groups[0].concat(groups[1]);
        const inner = groups[2].concat(groups[3]);
        let side = 3;
        while (4 * (side - 1) < melee.length || (side - 2) ** 2 < inner.length) side += 1;
        const ring = [];
        for (let c = 0; c < side; c++) ring.push([c, 0]);
        for (let r = 1; r < side; r++) ring.push([side - 1, r]);
        for (let c = side - 2; c > -1; c--) ring.push([c, side - 1]);
        for (let r = side - 2; r > 0; r--) ring.push([0, r]);
        const step = ring.length / Math.max(1, melee.length);
        const half = (side - 1) / 2;
        melee.forEach((u, i) => {
            const [c, r] = ring[Math.trunc(i * step)];
            slots.push([u, (c - half) * sp, (r - half) * sp]);
        });
        const k = side - 2;
        inner.forEach((u, i) => {
            const [r, c] = py.divmod(i, k);
            slots.push([u, (c + 1 - half) * sp, (r + 1 - half) * sp]);
        });
        return _assign(slots, wx, wy, fx, fy, sx, sy);
    }
    let back = 0.0;
    let biggest = -Infinity;
    for (const g of groups) if (g.length) biggest = Math.max(biggest, g.length);
    const row_len = _rows(biggest, form);
    groups.forEach((g, gi) => {
        if (!g.length) return;
        const per = Math.min(row_len, g.length);
        const nrows = Math.trunc(Math.ceil(g.length / per));
        for (let r = 0; r < nrows; r++) {
            const cnt = Math.min(per, g.length - r * per);
            for (let c = 0; c < cnt; c++) {
                let lat = (c - (cnt - 1) / 2) * sp;
                if (form === 'staggered' && r % 2) lat += sp / 2;
                if (form === 'flank') {
                    const gap = 2.0 * TILE;
                    lat += c >= cnt / 2 ? gap / 2 : -gap / 2;
                }
                slots.push([gi, lat, back + r * sp]);
            }
        }
        back += nrows * sp;
    });
    // the center of the formation - at the order point
    const mid = back / 2 - sp / 2;
    let out = [];
    groups.forEach((g, gi) => {
        const mine = slots.filter(([gg]) => gg === gi).map(([, lat, b]) => [lat, b - mid]);
        out = out.concat(_match(g, mine, wx, wy, fx, fy, sx, sy));
    });
    return out;
}

/** The group's units -> its places: the front units - into the front row, within the row - by the lateral coordinate,
 *  so that paths do not cross. */
export function _match(units, slots, wx, wy, fx, fy, sx, sy) {
    const rows = new Map();
    for (const [lat, bk] of slots) {
        const key = py.round(bk, 3);
        let lst = rows.get(key);
        if (lst === undefined) rows.set(key, lst = []);
        lst.push([lat, bk]);
    }
    let rest = py.sorted(units, u => -((u.x - wx) * fx + (u.y - wy) * fy));
    const out = [];
    const rkeys = Array.from(rows.keys()).sort((a, b) => a - b);
    for (const key of rkeys) {
        const row = rows.get(key).slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
        const take = rest.slice(0, row.length);
        rest = rest.slice(row.length);
        py.sort(take, u => (u.x - wx) * sx + (u.y - wy) * sy);
        const m = Math.min(take.length, row.length);
        for (let i = 0; i < m; i++) {
            const u = take[i];
            const [lat, bk] = row[i];
            out.push([u, wx + sx * lat - fx * bk, wy + sy * lat - fy * bk]);
        }
    }
    return out;
}

export function _assign(slots, wx, wy, fx, fy, sx, sy) {
    return slots.map(([u, lat, bk]) => [u, wx + sx * lat - fx * bk, wy + sy * lat - fy * bk]);
}

/** The formation speed - by the slowest (px/s). */
export function group_speed(units) {
    if (!units.length) return null;
    let m = Infinity;
    for (const u of units) m = Math.min(m, u.speed());
    return m;
}

// ============================================================ rally points
/** A new unit carries out the rally point r: ground / resource / construction / farm / garrison / enemy / building. */
export function rally_order(w, u, r) {
    const { Building, Node } = modules.world;
    const defense = modules.defense;
    if (r == null) return;
    if (Array.isArray(r)) {
        u.cmd_move(r[0], r[1]);
        return;
    }
    if (!r.alive) return;
    const kind = u.kind;
    if (r instanceof Node && kind === 'villager') {
        u.cmd_gather(r);
    } else if (r instanceof Building && r.owner === u.owner) {
        if (!r.complete && kind === 'villager') {
            u.cmd_build(r);
        } else if (r.kind === 'farm' && kind === 'villager') {
            u.cmd_gather(r);
        } else if (defense.capacity(r) > 0 && py.contains(py.get(r.d, 'garrison_cls', ['vil', 'inf', 'arch']), u.cls)) {
            u.cmd_garrison(r);
        } else if (kind === 'villager' && repairable(u, r)) {
            cmd_repair(u, r);
        } else {
            u.cmd_move(...r.center());
        }
    } else if (py.getattr(r, 'owner', -1) >= 0 && w.hostile(r.owner, u.owner)) {
        u.cmd_attack(r);
    } else {
        u.cmd_move(...r.center());
    }
}

/** World.spawn: a new unit follows the rally points of building b (several - DE, Shift+right click). */
export function apply_rally(w, b, u) {
    const r = b.rally;
    if (r == null) return;
    const pts = py.getattr(b, 'rally_pts', null);
    if (py.bool(pts)) {
        u.cmd_move(pts[0][0], pts[0][1]);
        u.orders = pts.slice(1).map(([x, y]) => ['move', x, y]).concat([['rally', r]]);
    } else {
        rally_order(w, u, r);
    }
}
