// port of game/world.py
// Simulation: players, resources, buildings, units, projectiles, the map.
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import {
    TILE, MAP_SIZES, RES, START_RES, PLAYER_COLORS, PLAYER_NAMES, AGE_NAMES, NODE_DEFS,
    FARM_RATE, FARM_FOOD, CARRY, ANIMALS, UNITS, BUILDINGS, BUILDING_ARMOR, TECHS, AGE_TECHS, AGE_REQ,
    CIVS, WORLD_HOOKS, as_tuple,
} from './data.js';
import * as i18n from './i18n.js';
import * as match from './match.js';
import * as terrain from './terrain.js';
import * as gstats from './stats.js';
// Python imports defense, orders, naval, maps, mapgen at the very END of world.py (they import the classes from
// here). In JS those are late-bound through the module registry (modules.defense ...) to avoid ES-module cycles
// with uninitialised bindings (naval.js does `class Ship extends Unit` at top level).

// ---- local helpers (JS only)
const _has = (d, k) => k != null && Object.hasOwn(d, k);
/** Python negative indexing for list assignment targets (owner -1 -> the last element). */
const _ix = (i, n) => (i < 0 ? i + n : i);
/** The cache key of Player._mc (Python: a tuple (stat, kind, res, src, cls)). */
function _k5(a, b, c, d, e) {
    return a + '\x01' + b + '\x01' + c + '\x01' + d + '\x01' + (Array.isArray(e) ? e.join(',') : e);
}
/** hmat/amat rows are indexed with owner -1 (nature = the last row/column, Python negative indexing):
 *  give every row (and the matrix itself) a '-1' property aliasing the last element. JS only. */
function _neg_alias(rows) {
    if (!Array.isArray(rows)) return rows;
    for (const r of rows) if (Array.isArray(r)) r[-1] = r[r.length - 1];
    rows[-1] = rows[rows.length - 1];
    return rows;
}

// ============================================================ player
export const _TAGS = new Map();

export function unit_tags(kind) {
    /** Armor classes of a unit/building: the main cls + extra ones from 'ac' (see data.py, "armor classes"). */
    let t = _TAGS.get(kind);
    if (t === undefined) {
        const d = (_has(UNITS, kind) ? UNITS[kind] : null) || (_has(BUILDINGS, kind) ? BUILDINGS[kind] : null);
        if (d == null) return [];
        const base = _has(UNITS, kind) ? [d.cls] : ['bld'];
        t = base.slice();
        for (const c of py.get(d, 'ac', [])) if (!base.includes(c)) t.push(c);
        _TAGS.set(kind, t);
    }
    return t;
}

export function _entity_cls(kind) {
    /** Classes for modifier filters: units - cls + 'ac' from UNITS, buildings - 'bld' (+ 'ac'),
     *  techs - 'tech'. Always a tuple. */
    if (_has(UNITS, kind) || _has(BUILDINGS, kind)) return unit_tags(kind);
    if (_has(TECHS, kind)) return ['tech'];
    return [];
}

export const _BONUS_KEY = new Map();

export function _bonus_key(c) {
    /** The name of the stat modifier of the bonus against class c: 'bonus:cav' and so on. */
    const k = 'bonus:' + c;
    _BONUS_KEY.set(c, k);
    return k;
}

export function _hit(c, tags) {
    for (const x of as_tuple(c)) if (tags.includes(x)) return true;
    return false;
}

export function _matches(e, kind, cls, res, src) {
    const k = py.get(e, 'kind');
    if (k != null && !as_tuple(k).includes(kind)) return false;
    let c = py.get(e, 'cls');
    if (c != null && !_hit(c, cls)) return false;
    c = py.get(e, 'not_cls');
    if (c != null && _hit(c, cls)) return false;
    let r = py.get(e, 'res');
    if (r != null && !as_tuple(r).includes(res)) return false;
    r = py.get(e, 'src');
    if (r != null && !as_tuple(r).includes(src)) return false;
    return true;
}

export const _BANS = new Map();

export function civ_bans(civ, full = false) {
    /** What is unavailable to a civilization: its 'disabled', other civilizations' unique items ('civ' in the entry),
     *  the (building, unit) pairs from 'banned_at'; plus everything that depends on the unavailable (line upgrades, req
     *  chains). full=True - the "full tech tree" (lobby): only other civilizations' unique items.
     *  JS: a py.TSet (members are kind strings and [building, unit] pairs). */
    const bkey = civ + '\x01' + (full ? 1 : 0);
    let b = _BANS.get(bkey);
    if (b === undefined) {
        const c = py.get(CIVS, civ, CIVS['default']);
        b = new py.TSet();
        if (!full) {
            for (const x of py.get(c, 'disabled', [])) b.add(x);
            for (const x of py.get(c, 'banned_at', [])) b.add(x);
        }
        for (const tab of [UNITS, TECHS, BUILDINGS]) {
            for (const [k, d] of Object.entries(tab)) {
                const cv = py.get(d, 'civ');
                if (!(cv == null || cv === civ)) b.add(k);
            }
        }
        let grow = true;
        while (grow) {
            grow = false;
            for (const [k, d] of Object.entries(TECHS)) {
                if (b.has(k)) continue;
                const up = py.get(d, 'upgrade');
                if ((py.bool(up) && (b.has(up[0]) || b.has(up[1]))) ||
                        as_tuple(py.get(d, 'req', [])).some(r => b.has(r))) {
                    b.add(k);
                    if (py.bool(up)) b.add(up[1]);
                    grow = true;
                }
            }
            for (const [k, d] of Object.entries(UNITS)) {
                if (!b.has(k) && as_tuple(py.get(d, 'req', [])).some(r => b.has(r))) {
                    b.add(k);
                    grow = true;
                }
            }
        }
        _BANS.set(bkey, b);         // frozenset: never mutated
    }
    return new py.TSet(b);
}

export class Player {
    get name() {
        const key = this.name_key;
        if (key) return i18n.t(key);
        return this._name || '';
    }

    set name(v) {
        this.name_key = null;
        this._name = v;
    }

    constructor(pid, team = null, name = null, color = null, is_ai = false, civ = 'default') {
        this.id = pid;
        this.team = team == null ? pid : team;
        // name: as given, otherwise a locale key ("You" / color) - translated on display (language change, saves)
        this.name_key = name ? null : (pid === 0 ? 'player.you' : 'color.' + i18n.COLOR_KEYS[pid % 8]);
        this._name = name || PLAYER_NAMES[pid];
        this.color = color || PLAYER_COLORS[pid];
        this.is_ai = is_ai;
        this.alive = true;          // False - defeated (no center and no villagers)
        this.res = { ...START_RES };
        this.age = 0;
        this.techs = new Set();
        this.researching = new Set();
        this.pop = 0;
        this.cap = 0;
        this.gathered = {};
        for (const k of RES) this.gathered[k] = 0.0;
        this.kills = 0;
        this.kill_value = 0;        // the cost of what was killed and destroyed (the military score)
        this.effects = [];          // all active modifiers (techs + civilization + difficulty)
        this._mc = new Map();       // cache (stat, kind, res, src) -> (add, mul)
        this.ver = 0;               // grows on every change of effects (a key for the stat caches)
        this.alias = {};            // upgrade lines: base kind -> current (militia -> man_at_arms)
        this.banned = new py.TSet();    // what is unavailable to the civilization: kinds of units/techs/buildings, (building, unit)
        this.pop_bonus = 0;         // + to the population cap (and to the ceiling of 200)
        this.pop_keep = 0;          // + to the cap without raising the ceiling ("Nomads": the population of destroyed houses)
        this.pop_extra = {};        // building -> extra population (the center for some civilizations)
        this.civ = null;
        this.set_civ(civ);
    }

    get defeated() {
        return !this.alive;
    }

    // ---- modifiers
    set_civ(civ) {
        /** A civilization = permanent effects from the start of the match (CIVS in data.py), starting resources,
         *  unavailable units/techs ('disabled' + other civilizations' unique items, see civ_bans).
         *  'random' (or unknown) - a random one from the available. */
        if (!_has(CIVS, civ) || civ === 'random') {
            const ks = Object.keys(CIVS).filter(k => k !== 'default');
            civ = random.choice(ks.length ? ks : ['default']);
        }
        this.civ = civ;
        const c = CIVS[civ];
        this.add_effects(c.effects);
        this.banned = civ_bans(civ);
        for (const [r, v] of Object.entries(py.get(c, 'start', {}))) this.res[r] += v;
        this.pop_extra = { ...py.get(c, 'pop_extra', {}) };
    }

    allows(name, where = null) {
        /** Whether the kind/tech name is available to the civilization (where - the building where it is trained). */
        return !this.banned.has(name) && (where == null || !this.banned.has([where, name]));
    }

    add_effects(effects) {
        if (py.bool(effects)) {
            py.extend(this.effects, effects);
            this._mc.clear();
            this.ver += 1;
        }
    }

    mod(stat, kind = null, res = null, src = null, cls = null) {
        /** (the sum of add, the product of mul) of all the player's effects for the given stat and entity.
         *  cls is taken from the tables by kind by default. */
        const key = _k5(stat, kind, res, src, cls);
        let m = this._mc.get(key);
        if (m === undefined) {
            if (cls == null) cls = _entity_cls(kind);
            else if (typeof cls === 'string') {
                cls = (_has(UNITS, kind) && cls === UNITS[kind].cls) ? unit_tags(kind) : [cls];
            }
            let add = 0, mul = 1;
            for (const e of this.effects) {
                if (e.stat === stat && _matches(e, kind, cls, res, src)) {
                    add += py.get(e, 'add', 0);
                    mul *= py.get(e, 'mul', 1);
                }
            }
            m = [add, mul];
            this._mc.set(key, m);
        }
        return m;
    }

    stat(stat, kind, base, res = null, src = null) {
        /** The final value: (base + add) x mul. */
        const m = this._mc.get(_k5(stat, kind, res, src, null));
        const [add, mul] = m !== undefined ? m : this.mod(stat, kind, res, src);
        const v = base + add;
        return mul === 1 ? v : v * mul;
    }

    current(kind) {
        /** The unit's current kind taking the researched line upgrades into account. */
        return _has(this.alias, kind) ? this.alias[kind] : kind;
    }

    cost_of(cat, name) {
        /** The cost taking 'cost' effects into account. cat: 'unit' | 'bld' | 'tech' (as in the buildings' queue). */
        const key = 'cost!\x01' + cat + '\x01' + name;
        let c = this._mc.get(key);
        if (c === undefined) {
            const base = (cat === 'unit' ? UNITS : cat === 'bld' ? BUILDINGS : TECHS)[name].cost;
            const cls = cat === 'unit' ? UNITS[name].cls : cat;
            c = {};
            for (const [r, v] of Object.entries(base)) {
                const [add, mul] = this.mod('cost', name, r, null, cls);
                c[r] = Math.max(0, Math.trunc(py.round((v + add) * mul)));
            }
            this._mc.set(key, c);
        }
        return c;
    }

    time_of(cat, name) {
        const base = (cat === 'unit' ? UNITS : cat === 'bld' ? BUILDINGS : TECHS)[name].time;
        const [add, mul] = this.mod('time', name, null, null, cat === 'unit' ? UNITS[name].cls : cat);
        return (base + add) * mul;
    }

    // ---- resources
    afford(cost, reserve = null) {
        const rv = py.bool(reserve) ? reserve : {};
        for (const [k, v] of Object.entries(cost)) {
            if (this.res[k] - py.get(rv, k, 0) < v) return false;
        }
        return true;
    }

    pay(cost) {
        if (!this.afford(cost)) return false;
        for (const [k, v] of Object.entries(cost)) this.res[k] -= v;
        return true;
    }

    refund(cost) {
        for (const [k, v] of Object.entries(cost)) this.res[k] += v;
    }
}
py.register_class(Player, 'world.Player');

export const _hypot = math.hypot;

// the unit grid (World.units_in_rect): the cell size, the margin for a per-step shift, the largest unit radius
export const UG_CELL = 8 * TILE;
export const UG_PAD = TILE;
export const UG_MAXR = 24;

export const _FOG_SPANS = new Map();    // sight radius -> [(dy, the row's half-width)] for update_fog
export const _ONES = new Uint8Array(1024).fill(1);

// the sound of a villager's work by gather source (the 'work' event)
// how many seconds traces lie on the ground (AoE II DE: a body ~ 300 s, rubble 60 s - docs/research/04_graphics.md, 39-40)
export const DECAL_LIFE = { body: 300.0, rubble: 60.0, stump: 60.0 };
export const WORK_SOUND = { tree: 'chop', gold: 'mine', stone: 'mine', farm: 'farm', berries: 'forage', hunt: 'butcher' };


// ============================================================ entities
export class Node {
    /** A resource on the map: a tree, gold, stone, berries. */
    constructor(kind, tx, ty) {
        Node.serial += 1;
        this.kind = kind;
        this.tx = tx;
        this.ty = ty;
        this.w = this.h = 1;
        this.amount = NODE_DEFS[kind].amount;
        this.max_amount = this.amount;
        this.res = NODE_DEFS[kind].res;
        this.var = random.randrange(6);
        this.alive = true;
    }

    center() {
        return [(this.tx + 0.5) * TILE, (this.ty + 0.5) * TILE];
    }
}
// serial: how many nodes were created (the "nearest resource" caches are reset when new ones appear) - use Node.serial
py.classattrs(Node, { owner: -1, serial: 0 });
py.register_class(Node, 'world.Node');


export class Building {
    constructor(kind, owner, tx, ty, complete = false, player = null) {
        const d = BUILDINGS[kind];
        this.d = d;
        this.kind = kind;
        this.owner = owner;
        this.p = player;
        this.tx = tx;
        this.ty = ty;
        this.w = this.h = d.size;
        this.max_hp = player ? player.stat('hp', kind, d.hp) : d.hp;
        this.progress = complete ? 1.0 : 0.0;
        this.hp = complete ? this.max_hp : 1.0;
        this.queue = [];
        this.qt = 0.0;
        this.housed = false;
        this.rally = null;
        this.builders = 0;
        this.cool = 0.0;
        this.target = null;
        this.walk = py.get(d, 'walk', false);
        this.amount = FARM_FOOD;
        this.farmer = null;
        this.seen = owner === 0;    // the human player has already seen the building (World sets it for allies)
        this.alive = true;
        this.hit_t = -99;
        this.garrison = [];         // units inside (see game/defense.py)
    }

    get complete() {
        return this.progress >= 1.0;
    }

    center() {
        return [(this.tx + this.w / 2) * TILE, (this.ty + this.h / 2) * TILE];
    }

    armor() {
        let [m, pc] = this.complete ? py.get(this.d, 'arm', BUILDING_ARMOR) : [0, 2];
        if (this.p != null && this.complete) {
            [m, pc] = [this.p.stat('arm_m', this.kind, m), this.p.stat('arm_p', this.kind, pc)];
        }
        return [m, pc];
    }

    atk() {
        return this.p.stat('atk', this.kind, py.get(this.d, 'atk', 0));
    }

    rng_tiles() {
        return this.p.stat('rng', this.kind, py.get(this.d, 'rng', 0));
    }

    los() {
        return this.p.stat('los', this.kind, py.get(this.d, 'los', 4)) + Math.floor(this.w / 2);
    }

    dist_px(x, y) {
        // dist_point_rect(x, y, the building's rectangle), inlined: called millions of times
        const rx = this.tx * TILE;
        let dx = rx - x;
        if (dx < 0) {
            dx = x - rx - this.w * TILE;
            if (dx < 0) dx = 0;
        }
        const ry = this.ty * TILE;
        let dy = ry - y;
        if (dy < 0) {
            dy = y - ry - this.h * TILE;
            if (dy < 0) dy = 0;
        }
        if (!dx) return dy;
        if (!dy) return dx;
        return _hypot(dx, dy);
    }

    update(w, dt) {
        const d = this.d;
        if (this.progress >= 1.0 && !this.queue.length && !this.garrison.length && !d.atk) {
            return;         // completed, no queue, no garrison, not firing - nothing to do
        }
        const p = w.players.at(this.owner);
        if (!this.complete) {
            const n = this.builders;
            if (n > 0) {
                const inc = dt * (3 * n / (n + 2)) / p.time_of('bld', this.kind);
                this.progress = Math.min(1.0, this.progress + inc);
                this.hp = Math.min(this.max_hp, this.hp + inc * this.max_hp);
                if (this.progress >= 1.0) w.on_complete(this);
            }
            return;
        }
        if (this.queue.length) {
            const [kind, name] = this.queue[0];
            if (kind === 'unit' && p.pop >= p.cap) {
                if (!this.housed && this.owner === w.human) w.msg(i18n.t('msg.need_houses'), [255, 150, 90]);
                this.housed = true;
            } else {
                this.housed = false;
                const total = p.time_of(kind, name);
                this.qt += dt;
                if (this.qt >= total) {
                    this.qt = 0.0;
                    this.queue.shift();
                    const [cx, cy] = this.center();
                    if (kind === 'unit') {
                        const u = w.spawn(this, p.current(name));
                        p.pop += 1;
                        w.emit('train_done', u.x, u.y, this.owner, u.kind);
                    } else {
                        w.apply_tech(p, name);
                        w.emit('tech_done', cx, cy, this.owner, name);
                    }
                }
            }
        }
        const defense = modules.defense;
        if (this.garrison.length) defense.tick_garrison(w, this, dt);
        if (d.atk) {
            this.cool = Math.max(0.0, this.cool - dt);
            if (this.cool <= 0) {
                const rng = this.rng_tiles() * TILE;
                const minr = p.stat('min_rng', this.kind, py.get(d, 'min_rng', 0)) * TILE;
                let t = this.target;
                let bad = t == null || !t.alive;
                if (!bad) {
                    const dd = this.dist_px(t.x, t.y) - t.radius;
                    bad = !(minr <= dd && dd <= rng) || !w.hmat[this.owner][t.owner];
                }
                if (bad) t = w.nearest_enemy_unit_for_building(this, rng, minr);
                this.target = t;
                if (t != null) {
                    this.cool = p.stat('reload', this.kind, d.reload);
                    const [cx, cy] = this.center();
                    const nshots = py.get(d, 'arrows', 1) + Math.trunc(p.stat('arrows', this.kind, 0)) +
                        defense.bonus_arrows(this);
                    for (let i = 0; i < nshots; i++) {
                        const dmg = w.calc_damage(this, t, true);
                        const fx = cx + random.uniform(-8, 8);
                        const fy = cy - this.h * 10 + random.uniform(-6, 6);
                        w.fire(this, t, dmg, fx, fy, i * 0.12, i === 0);
                    }
                }
            }
        }
    }
}
py.classattrs(Building, { cls: 'bld' });
py.register_class(Building, 'world.Building');


const _SKIP = Symbol('world._SKIP');    // JS only: Animal's constructor does not run Unit.__init__ (Python neither)

export class Unit {
    constructor(kind, owner, x, y, world) {
        if (kind === _SKIP) return;
        const d = UNITS[kind];
        this.d = d;
        this.kind = kind;
        this.owner = owner;
        this.p = world.players.at(owner);
        this.x = x;
        this.y = y;
        this.cls = d.cls;
        this.radius = d.radius;
        this.max_hp = this.p.stat('hp', kind, d.hp);
        this.hp = this.max_hp;
        this.state = 'idle';
        this.target = null;
        this.drop = null;
        this.path = [];
        this.dest = null;
        this.pending = null;
        this.path_target = null;
        this.repath_t = 0.0;
        this.cool = 0.0;
        this.carry = 0.0;
        this.carry_res = null;
        this.gather_kind = null;
        this.face = [1.0, 0.0];
        this.anim = 0.0;
        this.swing = 0.0;
        this.work = 0.0;
        this.scan_t = random.random();
        this.alive = true;
        this.hit_t = -99;
    }

    // ---- stats (the base from UNITS + the player's modifiers, see Player.stat)
    atk() {
        return this.p.stat('atk', this.kind, this.d.atk);
    }

    armor() {
        const [m, pc] = this.d.arm;
        return [this.p.stat('arm_m', this.kind, m), this.p.stat('arm_p', this.kind, pc)];
    }

    rng_tiles() {
        const r = this.d.rng;
        return r > 0 ? this.p.stat('rng', this.kind, r) : 0;
    }

    rng_px() {
        const r = this.rng_tiles();
        return r > 0 ? r * TILE : 4;
    }

    reload() {
        return this.p.stat('reload', this.kind, this.d.reload);
    }

    speed() {
        const s = this.p.stat('speed', this.kind, this.d.speed) * TILE;
        const fs = this.form_speed;         // in a formation - at the speed of the slowest
        return fs != null && fs < s ? fs : s;
    }

    capacity() {
        return this.p.stat('carry', this.kind, CARRY, null, this.gather_kind);
    }

    los() {
        return this.p.stat('los', this.kind, this.d.los);
    }

    minr_px() {
        /** The minimum range (onager, trebuchet, bombard), pixels. */
        const m = py.get(this.d, 'minr', 0);
        return m ? m * TILE : 0;
    }

    acc() {
        return Math.min(1.0, this.p.stat('acc', this.kind, py.get(this.d, 'acc', 1.0)));
    }

    look() {
        /** The kind for drawing: an unpacked trebuchet is drawn as a separate "pose" (d['look_up']). */
        if (this.d.pack && (!this.packed) !== (this.pack_t > 0)) return py.get(this.d, 'look_up', this.kind);
        return this.kind;
    }

    start_pack(w, goal) {
        /** goal=True - pack (to move), False - unpack (to fire). */
        if (this.pack_t > 0 || this.packed === goal) return;
        this.pack_t = this.d.pack;
        w.emit('pack', this.x, this.y, this.owner, this.kind, goal);
    }

    set_kind(kind) {
        /** Turn a unit into another kind (a line upgrade), keeping the health share. */
        const frac = this.max_hp ? this.hp / this.max_hp : 1.0;
        const d = UNITS[kind];
        this.kind = kind;
        this.d = d;
        this.cls = d.cls;
        this.radius = d.radius;
        this.max_hp = this.p.stat('hp', kind, d.hp);
        this.hp = Math.max(1.0, this.max_hp * frac);
    }

    center() {
        return [this.x, this.y];
    }

    tile() {
        return [Math.floor(this.x / TILE), Math.floor(this.y / TILE)];
    }

    dist_to(e) {
        if (e instanceof Unit) return _hypot(e.x - this.x, e.y - this.y) - e.radius - this.radius;
        // dist_point_rect to the rectangle of e (a building / resource), inlined
        const x = this.x, y = this.y;
        const rx = e.tx * TILE;
        let dx = rx - x;
        if (dx < 0) {
            dx = x - rx - e.w * TILE;
            if (dx < 0) dx = 0;
        }
        const ry = e.ty * TILE;
        let dy = ry - y;
        if (dy < 0) {
            dy = y - ry - e.h * TILE;
            if (dy < 0) dy = 0;
        }
        if (!dx) return dy - this.radius;
        if (!dy) return dx - this.radius;
        return _hypot(dx, dy) - this.radius;
    }

    // ---- orders
    release() {
        this.form_speed = null;
        const t = this.target;
        if (t instanceof Building && t.kind === 'farm' && t.farmer === this) t.farmer = null;
    }

    stop() {
        this.release();
        this.state = 'idle';
        this.target = null;
        this.path = [];
        this.dest = null;
        this.pending = null;
    }

    cmd_move(x, y) {
        this.release();
        this.state = 'move';
        this.target = null;
        this.pending = [x, y];
        this.path = [];
        this.dest = null;
    }

    cmd_attack(t) {
        if (t == null) return;
        if (this.d.monk) {
            if (this.relic != null) return;     // a monk carrying a relic does not convert (AoE2)
            if (t instanceof Unit && !(t instanceof Animal)) {
                this.release();
                this.state = 'convert';
                this.target = t;
                this.path_target = null;
                this.conv_t = 0.0;
            }
            return;     // a monk does not convert buildings
        }
        if (this.d.bld_only && t instanceof Unit) {
            this.cmd_move(t.x, t.y);
            return;
        }
        this.release();
        this.state = 'attack';
        this.target = t;
        this.path_target = null;
    }

    cmd_heal(t) {
        /** A monk heals an allied unit. */
        if (!this.d.monk || !(t instanceof Unit) || this.relic != null) return;
        this.release();
        this.state = 'heal';
        this.target = t;
        this.path_target = null;
    }

    cmd_gather(t) {
        if (this.kind !== 'villager') {
            const [cx, cy] = t.center();
            this.cmd_move(cx, cy);
            return;
        }
        this.release();
        this.state = 'gather';
        this.target = t;
        if (t instanceof Animal) this.gather_kind = 'hunt';
        else this.gather_kind = t instanceof Building ? 'farm' : t.kind;
        this.path_target = null;
    }

    cmd_build(b) {
        if (this.kind !== 'villager') return;
        this.release();
        this.state = 'build';
        this.target = b;
        this.path_target = null;
    }

    cmd_return(b = null) {
        if (this.carry <= 0) return;
        this.drop = b;
        this.state = 'return';
        this.path_target = null;
    }

    // ---- movement
    step_toward(w, px, py_, dt) {
        const dx = px - this.x, dy = py_ - this.y;
        const d = math.hypot(dx, dy);
        if (d < 0.5) return;
        const s = Math.min(this.speed() * dt, d);
        const nx = this.x + dx / d * s, ny = this.y + dy / d * s;
        if (w.passable_px(nx, ny, this.owner)) {
            this.x = nx;
            this.y = ny;
        } else if (w.passable_px(nx, this.y, this.owner)) {
            this.x = nx;
        } else if (w.passable_px(this.x, ny, this.owner)) {
            this.y = ny;
        }
        this.face = [dx / d, dy / d];
        this.anim += dt * 12;
    }

    walk_path(w, dt) {
        let step = this.speed() * dt;
        let guard = 0;
        while (step > 0 && guard < 8) {
            guard += 1;
            let px, py_;
            if (this.path.length) {
                const [tx, ty] = this.path[0];
                px = (tx + 0.5) * TILE;
                py_ = (ty + 0.5) * TILE;
                if (this.path.length === 1 && this.dest != null) [px, py_] = this.dest;
            } else if (this.dest != null) {
                [px, py_] = this.dest;
            } else {
                return true;
            }
            const dx = px - this.x, dy = py_ - this.y;
            const d = math.hypot(dx, dy);
            if (d <= step) {
                this.x = px;
                this.y = py_;
                step -= d;
                if (this.path.length) {
                    this.path.shift();
                    if (!this.path.length) {
                        this.dest = null;
                        return true;
                    }
                } else {
                    this.dest = null;
                    return true;
                }
            } else {
                this.x += dx / d * step;
                this.y += dy / d * step;
                this.face = [dx / d, dy / d];
                this.anim += dt * 12;
                step = 0;
            }
        }
        return false;
    }

    approach(w, ent, rng, dt) {
        /** Move to ent until within rng. True - already in the zone. */
        if (this.dist_to(ent) <= rng) {
            this.path = [];
            return true;
        }
        if (this.d.pack && !this.packed) {
            this.start_pack(w, true);
            return false;
        }
        if (ent instanceof Unit && math.hypot(ent.x - this.x, ent.y - this.y) < 2.5 * TILE) {
            this.path = [];
            this.step_toward(w, ent.x, ent.y, dt);
            return false;
        }
        const need = this.path_target !== ent ||
            (w.time >= this.repath_t && (!this.path.length || ent instanceof Unit));
        if (need && w.path_budget > 0) {
            w.path_budget -= 1;
            this.repath_t = w.time + (ent instanceof Unit ? 0.8 : 2.5) + random.random() * 0.5;
            this.path_target = ent;
            this.path = w.path_to_entity(this, ent);
            this.dest = null;
            if (!w.path_reached && this.state === 'attack' && ent === this.target) {
                // the path to the target is blocked by walls - break the nearest wall/gate segment
                const wall = modules.defense.breach_target(w, this, ent);
                if (wall != null) {
                    this.target = wall;
                    this.path_target = null;
                    this.path = [];
                    return false;
                }
            }
        }
        if (this.path.length) {
            this.dest = null;
            this.walk_path(w, dt);
        } else {
            const [cx, cy] = ent.center();
            this.step_toward(w, cx, cy, dt);
        }
        return false;
    }

    face_to(e) {
        const [cx, cy] = e.center();
        const dx = cx - this.x, dy = cy - this.y;
        const d = math.hypot(dx, dy);
        if (d > 0.1) this.face = [dx / d, dy / d];
    }

    // ---- update
    update(w, dt) {
        this._px = this.x;
        this._py = this.y;
        let c = this.cool - dt;
        this.cool = c > 0.0 ? c : 0.0;
        c = this.swing - dt;
        this.swing = c > 0.0 ? c : 0.0;
        if (this.pack_t > 0) {
            // packing/unpacking is in progress - we do nothing else
            this.pack_t -= dt;
            if (this.pack_t <= 0) {
                this.pack_t = 0.0;
                this.packed = !this.packed;
            }
            return;
        }
        const orders = modules.orders;
        if (this.mission != null) orders.tick(this, w, dt);
        let st = this.state;
        if (st === 'idle' && (py.bool(this.orders) || this.mission != null || this.home != null)) {
            orders.on_idle(this, w);
            st = this.state;
        }
        const states = this.d.states;
        if (st === 'gather') this.do_gather(w, dt);
        else if (st === 'idle') {
            if (this.cls !== 'vil' && w.time >= this.scan_t) {
                this.scan_t = w.time + 0.5;
                this.idle_scan(w);
            }
        } else if (st === 'move') this.do_move(w, dt);
        else if (st === 'attack') this.do_attack(w, dt);
        else if (st === 'return') this.do_return(w, dt);
        else if (st === 'build') this.do_build(w, dt);
        else if (st === 'garrison') modules.defense.do_garrison(w, this, dt);
        else if (states != null && py.contains(states, st)) {
            // states from content: UNITS[kind]['states'][name](unit, world, dt) (e.g. 'trade' for a cart)
            (states instanceof Map ? states.get(st) : states[st])(this, w, dt);
        } else if (st === 'convert') this.do_convert(w, dt);
        else if (st === 'heal') this.do_heal(w, dt);
        else if (st === 'repair') orders.do_repair(this, w, dt);
        else if (st === 'aground') orders.do_attack_ground(this, w, dt);
    }

    cmd_garrison(b) {
        /** Walk to a building and enter the garrison (see game/defense.py). */
        this.release();
        this.state = 'garrison';
        this.target = b;
        this.path_target = null;
    }

    idle_scan(w) {
        const d = this.d;
        if (this.stance === 'no_attack') return;
        if (d.monk) {
            if (this.relic != null) return;     // carrying a relic - neither healing nor converting
            // a monk heals wounded allies nearby on his own and converts enemies that came within range
            const t = w.wounded_ally(this, this.los() * TILE);
            if (t != null) {
                this.cmd_heal(t);
                return;
            }
            if (w.time >= this.faith_t) {
                const e = w.nearest_enemy(this, this.rng_px(), false);
                if (e != null && w.convertible(this, e)) this.cmd_attack(e);
            }
            return;
        }
        if (d.pack && this.packed) return;      // a packed trebuchet stands and waits for an order
        const orders = modules.orders;
        const radius = orders.scan_radius(this);
        let e = w.nearest_enemy(this, radius, !!(d.bld_only || d.pack), this.minr_px(), !d.bld_only);
        if (e == null && !d.bld_only && !this.naval && this.owner >= 0) {
            e = w.nearest_beast(this, Math.min(radius, this.los() * TILE));     // wolves in view
        }
        if (e != null) orders.engage(this, e);
    }

    do_move(w, dt) {
        if (this.d.pack && !this.packed) {
            this.start_pack(w, true);
            return;
        }
        if (this.pending != null) {
            if (w.path_budget <= 0) return;
            w.path_budget -= 1;
            const [x, y] = this.pending;
            this.pending = null;
            const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
            const goal = w.passable(gx, gy) ? [gx, gy] : w.nearest_free_tile(gx, gy);
            this.path = w.find_path(this.tile(), [goal], goal[0], goal[1], undefined, this.owner);
            const reached = (this.path.length && py.eq(this.path[this.path.length - 1], goal)) ||
                py.eq(this.tile(), goal);
            this.dest = reached && goal[0] === gx && goal[1] === gy ? [x, y] : null;
        }
        if (this.walk_path(w, dt)) {
            this.state = 'idle';
            this.form_speed = null;
        }
    }

    do_attack(w, dt) {
        let t = this.target;
        if (t != null && this.p != null && !(t instanceof Animal) && !w.hmat[this.owner][t.owner]) {
            t = null;       // the target was converted by a monk and became allied
        }
        if (t == null || !t.alive || py.getattr(t, 'dead', false)) {
            this.target = null;
            let e = null;
            if (py.bool(this.orders)) {
                this.state = 'idle';        // the target fell - to the next point of the queue (Shift)
                return;
            }
            if (this.cls !== 'vil' && this.p != null) {
                const d = this.d;
                const radius = modules.orders.scan_radius(this);
                e = w.nearest_enemy(this, radius, true, this.minr_px(), !d.bld_only);
            }
            if (e != null) this.cmd_attack(e);
            else this.state = 'idle';
            return;
        }
        if (this.auto && this.stance !== 'aggressive' && !modules.orders.may_chase(this, t)) {
            this.target = null;     // stance: we do not pursue farther
            this.state = 'idle';
            return;
        }
        const mr = this.minr_px();
        if (mr && this.dist_to(t) < mr) {
            // the target is closer than the minimum range: a trebuchet looks for another, the others back off
            if (this.d.pack) {
                const e = w.nearest_enemy(this, this.rng_px(), true, mr);
                if (e != null && e !== t) this.cmd_attack(e);
                else this.stop();
                return;
            }
            const [cx, cy] = t.center();
            const dx = this.x - cx, dy = this.y - cy;
            const dd = math.hypot(dx, dy) || 1;
            this.step_toward(w, this.x + dx / dd * TILE, this.y + dy / dd * TILE, dt);
            return;
        }
        if (this.approach(w, t, this.rng_px(), dt)) {
            this.face_to(t);
            if (this.d.pack && this.packed) {
                this.start_pack(w, false);
                return;
            }
            if (this.cool <= 0) {
                this.cool = this.reload();
                this.swing = 0.3;
                const ranged = this.d.rng > 0;
                const dmg = w.calc_damage(this, t, ranged);
                if (ranged) w.fire(this, t, dmg);
                else w.damage(t, this, dmg);
                if (_has(this.d, 'on_attack')) this.d.on_attack(this, w, t, dmg);    // content: a volley, trampling (unique units)
            }
        }
    }

    // ---- monk
    do_convert(w, dt) {
        const t = this.target;
        if (t == null || !t.alive || !w.convertible(this, t)) {
            this.state = 'idle';
            this.target = null;
            this.conv_t = 0.0;
            return;
        }
        if (w.time < this.faith_t) {
            // faith has not been restored yet - stay close
            this.approach(w, t, this.rng_px(), dt);
            return;
        }
        if (this.approach(w, t, this.rng_px(), dt)) {
            this.face_to(t);
            if (this.conv_t === 0.0) w.emit('convert_start', this.x, this.y, this.owner, t.kind);
            const prev = this.conv_t;
            this.conv_t += dt * this.p.stat('conv_speed', this.kind, 1.0) / t.p.stat('conv_resist', t.kind, 1.0);
            this.swing = py.mod(Math.trunc(this.conv_t * 2), 2) ? 0.3 : 0.0;
            // as in the original: not before 4 s, then every second a 28% chance, by 10 s - for certain
            if (this.conv_t >= 10.0 || (this.conv_t >= 4.0 && Math.trunc(this.conv_t) > Math.trunc(prev) &&
                    random.random() < 0.28)) {
                w.convert(t, this);
                this.conv_t = 0.0;
                this.faith_t = w.time + 62.0 / this.p.stat('faith', this.kind, 1.0);
                this.state = 'idle';
                this.target = null;
            }
        }
    }

    do_heal(w, dt) {
        const t = this.target;
        if (t == null || !t.alive || t.hp >= t.max_hp || !w.allied(this.owner, t.owner)) {
            this.state = 'idle';
            this.target = null;
            return;
        }
        if (this.approach(w, t, 4 * TILE, dt)) {
            this.face_to(t);
            t.hp = Math.min(t.max_hp, t.hp + this.p.stat('heal', this.kind, 1.0) * dt);
            this.swing = py.mod(Math.trunc(w.time * 2), 2) ? 0.3 : 0.0;
        }
    }

    gather_target_valid(t) {
        if (t == null || !t.alive) return false;
        if (t instanceof Building) {
            return t.kind === 'farm' && t.complete && t.owner === this.owner && (t.farmer == null || t.farmer === this);
        }
        if (t instanceof Animal) {
            if (t.den != null) return false;        // a wolf is not game
            return t.dead || t.kind !== 'sheep' || t.owner === -1 || t.owner === this.owner;
        }
        return true;
    }

    do_gather(w, dt) {
        const t = this.target;
        const tt = t != null ? t.constructor : null;
        // the frequent cases - a villager is already at a tree/mine/bush or on its own farm and gathers: a short path
        // doing exactly the same as the general path below for a target within reach
        if (tt === Node) {
            let near;
            if (t.alive && this.carry_res === t.res) {
                const x = this.x, y = this.y;
                const rx = t.tx * TILE;
                let dx = rx - x;
                if (dx < 0) {
                    dx = x - rx - t.w * TILE;
                    if (dx < 0) dx = 0;
                }
                const ry = t.ty * TILE;
                let dy = ry - y;
                if (dy < 0) {
                    dy = y - ry - t.h * TILE;
                    if (dy < 0) dy = 0;
                }
                near = (!dx ? dy : !dy ? dx : _hypot(dx, dy)) - this.radius <= 10;
            } else {
                near = false;
            }
            if (near) {
                const [cap, rate] = this._gather_stats(t, t.kind, t.res, NODE_DEFS[t.kind].rate);
                if (this.carry >= cap) {
                    this.cmd_return();
                    return;
                }
                this._gather_tick(w, t, dt, rate, t.res, t.kind);
                return;
            }
        } else if (tt === Building) {
            if (t.alive && t.kind === 'farm' && t.progress >= 1.0 && t.owner === this.owner &&
                    (t.farmer == null || t.farmer === this) && this.carry_res === 'food' &&
                    this.dist_to(t) <= 0.5 - this.radius) {
                const [cap, rate] = this._gather_stats(t, 'farm', 'food', FARM_RATE);
                if (this.carry >= cap) {
                    this.cmd_return();
                    return;
                }
                t.farmer = this;
                this._gather_tick(w, t, dt, rate, 'food', 'farm');
                return;
            }
        }
        if (!this.gather_target_valid(t)) {
            this.release();
            const nt = w.find_resource(this, this.gather_kind, this.x, this.y, 9);
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
        if (t instanceof Animal && !t.dead) {
            const rng = t.kind === 'deer' ? 3 * TILE : 10;
            if (this.approach(w, t, rng, dt)) {
                this.face_to(t);
                if (this.cool <= 0) {
                    this.cool = 1.5;
                    this.swing = 0.3;
                    const dmg = w.calc_damage(this, t, t.kind === 'deer');
                    if (t.kind === 'deer') {
                        w.projectiles.push(new Projectile(this.x, this.y - 10, t, dmg, this));
                        w.emit('arrow', this.x, this.y, this.owner, this.kind);
                    } else {
                        w.damage(t, this, dmg);
                    }
                }
            }
            return;
        }
        const res = (t instanceof Building || t instanceof Animal) ? 'food' : t.res;
        if (this.carry > 0 && this.carry_res !== res) this.carry = 0;
        if (this.carry >= this.capacity()) {
            this.cmd_return();
            return;
        }
        let rate, src;
        if (t instanceof Building) {
            t.farmer = this;
            if (!this.approach(w, t, -this.radius + 0.5, dt)) return;
            [rate, src] = [FARM_RATE, 'farm'];
        } else if (t instanceof Animal) {
            if (!this.approach(w, t, 10, dt)) return;
            [rate, src] = [ANIMALS[t.kind].rate, 'hunt'];
        } else {
            if (!this.approach(w, t, 10, dt)) return;
            [rate, src] = [NODE_DEFS[t.kind].rate, t.kind];
        }
        rate = this.p.stat('gather', this.kind, rate, res, src);
        this.face_to(t);
        this.work += dt;
        if (this.work > 1.0) {
            this.work = 0.0;
            this.swing = 0.3;
            w.emit('work', this.x, this.y, this.owner, py.get(WORK_SOUND, src, 'forage'));
        }
        const amt = Math.min(rate * dt, t.amount);
        t.amount -= amt;
        this.carry += amt;
        this.carry_res = res;
        if (t.amount <= 0) w.deplete(t);
    }

    _gather_stats(t, src, res, base_rate) {
        /** (capacity, gather rate) - the same capacity() and stat('gather', ...) as in the general path,
         *  but remembered until the target changes (and with it the gather kind), the unit kind, the player, its effects
         *  and the age. */
        const p = this.p;
        const c = this._gcache;
        if (c != null && c[0] === t && c[1] === p && c[2] === p.ver && c[3] === p.age && c[4] === this.kind) {
            return [c[5], c[6]];
        }
        const cap = this.capacity();
        const rate = p.stat('gather', this.kind, base_rate, res, src);
        this._gcache = [t, p, p.ver, p.age, this.kind, cap, rate];
        return [cap, rate];
    }

    _gather_tick(w, t, dt, rate, res, src) {
        /** Gathering at a target within reach (the end of the general do_gather path): the same as
         *  approach -> stat('gather') -> face_to -> ..., with face_to inlined (a hot path).
         *  rate - the final rate already (see _gather_stats). */
        this.path = [];
        const [cx, cy] = t.center();
        const dx = cx - this.x, dy = cy - this.y;
        const d = _hypot(dx, dy);
        if (d > 0.1) this.face = [dx / d, dy / d];
        this.work += dt;
        if (this.work > 1.0) {
            this.work = 0.0;
            this.swing = 0.3;
            w.emit('work', this.x, this.y, this.owner, py.get(WORK_SOUND, src, 'forage'));
        }
        let amt = rate * dt;
        if (amt > t.amount) amt = t.amount;
        t.amount -= amt;
        this.carry += amt;
        this.carry_res = res;
        if (t.amount <= 0) w.deplete(t);
    }

    do_return(w, dt) {
        if (this.carry <= 0) {
            this.resume_gather(w);
            return;
        }
        let d = this.drop;
        if (d == null || !d.alive || !d.complete || !py.contains(py.get(d.d, 'drop', []), this.carry_res)) {
            d = w.nearest_dropoff(this, this.carry_res);
            this.drop = d;
            this.path_target = null;
        }
        if (d == null) {
            this.state = 'idle';
            return;
        }
        if (this.approach(w, d, 10, dt)) {
            const amt = Math.trunc(this.carry + 0.001);
            this.p.res[this.carry_res] += amt;
            this.p.gathered[this.carry_res] += amt;
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
            const nt = w.find_resource(this, this.gather_kind, this.x, this.y, 10);
            if (nt != null) {
                this.cmd_gather(nt);
                return;
            }
        }
        this.state = 'idle';
        this.target = null;
    }

    do_build(w, dt) {
        const b = this.target;
        if (b == null || !b.alive) {
            this.state = 'idle';
            this.target = null;
            return;
        }
        if (b.complete) {
            this.after_build(w, b);
            return;
        }
        if (this.approach(w, b, 10, dt)) {
            this.face_to(b);
            b.builders += this.p.stat('build', this.kind, 1);
            this.work += dt;
            if (this.work > 0.8) {
                this.work = 0.0;
                this.swing = 0.3;
                w.emit('work', this.x, this.y, this.owner, 'build');
            }
        }
    }

    after_build(w, b) {
        this.target = null;
        if (py.bool(this.orders)) {
            this.state = 'idle';        // Shift queue of constructions: the next one in the order of laying
            return;
        }
        if (b.kind === 'farm' && b.farmer == null) {
            this.cmd_gather(b);
            return;
        }
        const pref = py.get({ lumber_camp: ['tree'], mining_camp: ['gold', 'stone'], mill: ['berries'] }, b.kind);
        if (py.bool(pref)) {
            const [cx, cy] = b.center();
            for (const k of pref) {
                const nt = w.find_resource(this, k, cx, cy, 8);
                if (nt != null) {
                    this.cmd_gather(nt);
                    return;
                }
            }
        }
        // the next construction is the nearest (walls are built segment by segment)
        let best = null, bd = 10 * TILE;
        for (const o of w.buildings) {
            if (o.owner === this.owner && !o.complete && o.alive) {
                const d = this.dist_to(o);
                if (d < bd) [bd, best] = [d, o];
            }
        }
        if (best != null) {
            this.cmd_build(best);
            return;
        }
        this.state = 'idle';
    }
}
py.classattrs(Unit, {
    inside: null,           // the building in which the unit sits in a garrison (then alive == False)
    naval: false,           // a ship (game/naval.py: Ship) - moves only on water
    // siege weapons with packing (a trebuchet): packed - can move, cannot fire; pack_t - (un)packing is in progress
    packed: true,
    pack_t: 0.0,
    faith_t: 0.0,           // monk: the game time when the faith will be restored (can convert)
    relic: null,            // monk: the carried relic (game/relics.py) - while carrying it he neither heals nor converts
    conv_t: 0.0,            // monk: how many seconds the current conversion has been going
    _px: 0.0, _py: 0.0,     // the position at the previous step (for leading a shot)
    _sep_x: null, _sep_y: null, _sep_r: null,   // World.separate: the position and radius at the start of the previous pushing-apart
    _sep_clear: false,      // ... and then it did not intersect anyone
    // orders beyond cmd_* (game/orders.py): a stance, a queue of Shift orders, a long-running order, a formation
    stance: 'aggressive',
    orders: null,
    mission: null,
    mis_t: 0.0,
    home: null,
    auto: false,
    form_speed: null,
    gpt: null,
    _gcache: null,
});
py.register_class(Unit, 'world.Unit');


export class Animal extends Unit {
    /** Sheep, deer, boars, wolves. A killed animal stays as a carcass that villagers butcher
     *  (a wolf gives no food: the carcass disappears after WOLF_ROT s). */
    constructor(kind, x, y, world, owner = -1) {
        super(_SKIP);
        const d = ANIMALS[kind];
        this.d = { ...d, reload: 2.0, rng: 0, cls: 'animal', cost: {}, desc: '' };
        this.kind = kind;
        this.owner = owner;
        this.p = null;
        this.x = x;
        this.y = y;
        this.cls = 'animal';
        this.radius = d.radius;
        this.max_hp = d.hp;
        this.hp = d.hp;
        this.state = 'idle';
        this.target = null;
        this.drop = null;
        this.path = [];
        this.dest = null;
        this.pending = null;
        this.path_target = null;
        this.repath_t = 0.0;
        this.cool = 0.0;
        this.carry = 0.0;
        this.carry_res = null;
        this.gather_kind = null;
        this.face = [1.0, 0.0];
        this.anim = 0.0;
        this.swing = 0.0;
        this.work = 0.0;
        this.scan_t = random.random();
        this.alive = true;
        this.hit_t = -99;
        this.dead = false;
        this.amount = d.food;
        this.res = 'food';
        this.flee_t = 0.0;
        this.wander_t = random.uniform(5, 20);
        if (d.predator) this.den = [x, y];
    }

    atk() {
        return this.d.atk;
    }

    armor() {
        return this.d.arm;
    }

    rng_tiles() {
        return 0;
    }

    rng_px() {
        return 4;
    }

    reload() {
        return this.d.reload;
    }

    speed() {
        return this.d.speed * TILE;
    }

    los() {
        return this.d.los;
    }

    release() {
    }

    on_hit(w, attacker) {
        if ((this.kind === 'boar' || this.kind === 'wolf') && attacker instanceof Unit && attacker.alive &&
                this.state !== 'attack') {
            this.state = 'attack';
            this.target = attacker;
            this.path_target = null;
        } else if (this.kind === 'deer') {
            this.flee(w, attacker.x, attacker.y, true);
        }
    }

    on_death() {
        this.dead = true;
        this.hp = 0;
        this.state = 'idle';
        this.path = [];
        this.target = null;
        this.owner = -1;
    }

    flee(w, fx, fy, force = false) {
        if (w.time < this.flee_t && !force) return;
        this.flee_t = w.time + 1.5;
        const dx = this.x - fx, dy = this.y - fy;
        const d = math.hypot(dx, dy) || 1;
        let tx = this.x + dx / d * 4 * TILE, ty = this.y + dy / d * 4 * TILE;
        tx = Math.max(TILE, Math.min((w.W - 1) * TILE, tx));
        ty = Math.max(TILE, Math.min((w.H - 1) * TILE, ty));
        this.cmd_move(tx, ty);
    }

    prey(w, radius) {
        /** A predator: the nearest player unit on land within a radius (px), or None. */
        let best = null, bd = radius;
        for (const u of w.units_near(this.x, this.y, radius)) {
            if (!u.alive || u.owner < 0 || u.naval) continue;
            const d = math.hypot(u.x - this.x, u.y - this.y);
            if (d < bd) [bd, best] = [d, u];
        }
        return best;
    }

    update(w, dt) {
        if (this.dead) {
            if (this.den != null && w.time - this.dead_t > this.WOLF_ROT) {
                this.alive = false;         // a wolf's carcass is not needed (no food) - remove it
            }
            return;
        }
        let c = this.cool - dt;
        this.cool = c > 0.0 ? c : 0.0;
        c = this.swing - dt;
        this.swing = c > 0.0 ? c : 0.0;
        if (w.time >= this.scan_t) {
            this.scan_t = w.time + 0.5;
            let near = [];
            for (const u of w.units_near(this.x, this.y, 4 * TILE)) {
                if (Math.abs(u.x - this.x) < 4 * TILE && Math.abs(u.y - this.y) < 4 * TILE) {
                    near.push([math.hypot(u.x - this.x, u.y - this.y), u]);
                }
            }
            near = near.filter(([d]) => d < 3.5 * TILE);
            if (this.kind === 'sheep' && near.length) {
                const owners = new Set(near.map(([, u]) => u.owner));
                if (this.owner === -1 || !owners.has(this.owner)) {
                    this.owner = py.min(near, t => t[0])[1].owner;
                }
            } else if (this.kind === 'deer' && near.length) {
                const [d, u] = py.min(near, t => t[0]);
                if (d < 2.5 * TILE) this.flee(w, u.x, u.y);
            }
            if (this.den != null && this.state !== 'attack') {
                // a wolf: it rushes at any player unit in view if it has not gone far from the den
                const [hx, hy] = this.den;
                if (math.hypot(this.x - hx, this.y - hy) < this.LEASH * TILE) {
                    const u = this.prey(w, this.los() * TILE);
                    if (u != null) {
                        this.state = 'attack';
                        this.target = u;
                        this.path_target = null;
                    }
                }
            }
        }
        if (this.state === 'attack') {
            const t = this.target;
            const far = this.den != null && math.hypot(this.x - this.den[0], this.y - this.den[1]) > this.LEASH * TILE;
            if (t == null || !t.alive || math.hypot(t.x - this.x, t.y - this.y) > 10 * TILE || far ||
                    py.getattr(t, 'naval', false)) {
                this.state = 'idle';
                this.target = null;
                if (far) this.cmd_move(...this.den);    // it went away from the den - it returns
            } else {
                Unit.prototype.do_attack.call(this, w, dt);
            }
        } else if (this.state === 'move') {
            this.do_move(w, dt);
        } else if (this.owner === -1 || this.kind !== 'sheep') {
            this.wander_t -= dt;
            if (this.wander_t <= 0) {
                this.wander_t = random.uniform(8, 25);
                const a = random.uniform(0, math.tau);
                if (this.den != null) {         // a wolf roams near the den
                    const r = random.uniform(0, 3) * TILE;
                    this.cmd_move(this.den[0] + Math.cos(a) * r, this.den[1] + Math.sin(a) * r);
                    return;
                }
                this.cmd_move(this.x + Math.cos(a) * TILE * 1.2, this.y + Math.sin(a) * TILE * 1.2);
            }
        }
    }
}
py.classattrs(Animal, {
    dead_t: -99.0,          // the game time of death (for the falling animation)
    den: null,              // a predator: the point where it lives (it does not pursue farther than LEASH tiles)
    WOLF_ROT: 15.0,
    LEASH: 12.0,            // tiles from the den
});
py.register_class(Animal, 'world.Animal');


export class Projectile {
    /** A projectile. point=None - homing on the target (hunting); otherwise it flies to the point point - where it was
     *  aimed: if the target managed to move away, the projectile misses and may hit another enemy near the landing point.
     *  blast - the blast radius in pixels (mangonel, trebuchet, bombard): damage to everyone in the radius, own units too.
     *  pierce - a scorpion's bolt: it hits all enemies along the flight line. */
    constructor(x, y, target, dmg, src, delay = 0.0, point = null, blast = 0.0, pierce = false, shape = null) {
        this.x = x;
        this.y = y;
        this.sx = x;
        this.sy = y;
        this.target = target;
        this.dmg = dmg;
        this.src = src;
        this.owner = src.owner;
        this.delay = delay;
        this.alive = true;
        this.point = point;
        this.blast = blast;
        this.pierce = pierce;
        this.hit = new Set();
        const d = src instanceof Unit ? src.d : {};
        // the projectile kind for drawing: 'arrow' | 'javelin' | 'bolt' | 'stone' | 'ball'
        this.shape = shape || py.get(d, 'shot') || 'arrow';
        this.javelin = this.shape === 'javelin';
        this.speed = py.get(d, 'shot_speed', 260);
    }

    aim() {
        if (this.point != null) return [this.point[0], this.point[1] - 6];
        const t = this.target;
        if (t instanceof Unit) return [t.x, t.y - 6];
        return t.center();
    }

    update(w, dt) {
        if (this.delay > 0) {
            this.delay -= dt;
            return;
        }
        if (this.point == null && !this.target.alive) {
            this.alive = false;
            return;
        }
        const [tx, ty] = this.aim();
        const dx = tx - this.x, dy = ty - this.y;
        const d = math.hypot(dx, dy);
        const step = this.speed * dt;
        if (this.pierce) w.pierce_hits(this);
        if (d <= step + 4) {
            this.alive = false;
            if (this.point == null) w.damage(this.target, this.src, this.dmg);
            else w.impact(this);
        } else {
            this.x += dx / d * step;
            this.y += dy / d * step;
        }
    }
}
py.register_class(Projectile, 'world.Projectile');


// ---- A* open list: CPython heapq over (f, g, cell) number triples (the same algorithm -> the same pop order on ties)
function _hlt(a, b) {
    return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
}
function _hsiftdown(heap, startpos, pos) {
    const newitem = heap[pos];
    while (pos > startpos) {
        const parentpos = (pos - 1) >> 1;
        const parent = heap[parentpos];
        if (_hlt(newitem, parent)) {
            heap[pos] = parent;
            pos = parentpos;
            continue;
        }
        break;
    }
    heap[pos] = newitem;
}
function _hsiftup(heap, pos) {
    const endpos = heap.length, startpos = pos, newitem = heap[pos];
    let childpos = 2 * pos + 1;
    while (childpos < endpos) {
        const rightpos = childpos + 1;
        if (rightpos < endpos && !_hlt(heap[childpos], heap[rightpos])) childpos = rightpos;
        heap[pos] = heap[childpos];
        pos = childpos;
        childpos = 2 * pos + 1;
    }
    heap[pos] = newitem;
    _hsiftdown(heap, startpos, pos);
}
function _heappush(heap, item) {
    heap.push(item);
    _hsiftdown(heap, 0, heap.length - 1);
}
function _heappop(heap) {
    const last = heap.pop();
    if (heap.length) {
        const ret = heap[0];
        heap[0] = last;
        _hsiftup(heap, 0);
        return ret;
    }
    return last;
}


// ============================================================ world
export class World {
    /** The match's world. Player 0 is always the human (or the AI in his place in tools), -1 - nature (gaia).
     *
     *  Events for sound/effects accumulate in self.events (tuples (type, x, y, owner, kind, ...));
     *  the consumer (the interface) takes and clears the list every frame. Types:
     *    'hit'          x, y, the target's owner, the attacker's kind, the target's kind
     *    'death'        x, y, owner, the unit's/animal's kind
     *    'destroy'      x, y, owner, the building's kind
     *    'arrow'        x, y, the shooter's owner, the shooter's kind (a shot)
     *    'work'         x, y, owner, the sound: 'chop' | 'mine' | 'farm' | 'forage' | 'butcher' | 'build'
     *    'build_done'   x, y, owner, the building's kind
     *    'place'        x, y, owner, the building's kind (a foundation was laid)
     *    'train_done'   x, y, owner, the unit's kind
     *    'tech_done'    x, y, owner, the tech
     *    'age_up'       x, y, owner, the age number
     *    'attack_alert' x, y, owner (who was attacked), the target's kind - no more than once per 10 s per player
     *    'defeat'       x, y, owner, None
     *    'game_over'    0, 0, the winning team (-1 - nobody), None
     *    'convert_start' x, y, the monk's owner, the target's kind (a monk started converting)
     *    'convert'      x, y, the new owner, the unit's kind, the old owner
     *    'pack'         x, y, owner, kind, True - packing / False - unpacking (a trebuchet)
     *    'blast'        x, y, the shooter's owner, its kind (a mangonel/trebuchet/bombard projectile explosion)
     *    the interface adds 'select' / 'command' (x, y, 0, kind / order). */

    constructor(difficulty = 1, nplayers = 2, teams = null, ai_players = null, civs = null, size = null,
        map_type = 'land', ai_levels = null, settings = null) {
        /** teams - the team number for each player (by default everyone on their own);
         *  ai_players - which players get the difficulty bonus (by default all except 0);
         *  map_type - 'land' (a continent with lakes) | 'coast' (a sea in the center) | 'islands' (see naval.MAP_TYPES);
         *  ai_levels - the AI level (0...5, as in DE: match.AI_LEVELS) per player; by default - from difficulty;
         *  settings - the match parameters from the lobby (game/match.py: resources, population, ages, treaty, victory...). */
        const maps = modules.maps;
        this.difficulty = difficulty;
        this.map_type = map_type;
        this.settings = match.normalize(settings);
        this.settings.map = map_type;
        const n = Math.max(2, Math.min(PLAYER_COLORS.length, nplayers));
        if (size == null && py.bool(settings)) size = match.map_side(this.settings, n, map_type);
        const sizes = maps.is_legacy(map_type) ? maps.LEGACY_SIZES : MAP_SIZES;     // old types - the former sizes
        const skeys = sizes instanceof Map ? Array.from(sizes.keys()) : Object.keys(sizes).map(Number);
        this.W = this.H = size || py.get(sizes, n, py.get(sizes, Math.max(...skeys)));
        this.pop_limit = 200;
        this.max_age = 3;
        this.treaty_end = 0.0;
        this.reveal = 'normal';
        const lv0 = py.get(match.LEVEL_OF_DIFF, difficulty, 2);
        this.ai_levels = [];
        for (let i = 0; i < n; i++) {
            this.ai_levels.push(py.bool(ai_levels) && i < ai_levels.length && ai_levels[i] != null ? ai_levels[i] : lv0);
        }
        const W = this.W, H = this.H;
        this.time = 0.0;
        this.terrain = Array.from({ length: H }, () => new Array(W).fill(0));
        terrain.ensure(this);       // relief (game/terrain.py): heights, cliffs, shallows, ground types
        this.occ = Array.from({ length: H }, () => new Array(W).fill(null));
        this.floor = Array.from({ length: H }, () => new Array(W).fill(null));
        this.gate = Array.from({ length: H }, () => new Array(W).fill(null));     // gates: passable for the owner and allies
        this.path_reached = true;                       // whether the last find_path reached the target
        this.nodes = [];
        this.units = [];
        this.animals = [];
        this.buildings = [];
        this.projectiles = [];
        this.decals = [];
        this.events = [];
        teams = py.bool(teams) ? py.list(teams) : py.range(n);
        ai_players = ai_players == null ? new Set(py.range(1, n)) : new Set(ai_players);
        this.players = [];
        for (let pid = 0; pid < n; pid++) {
            const p = new Player(pid, teams[pid], undefined, undefined, ai_players.has(pid),
                (py.bool(civs) && pid < civs.length ? civs[pid] : 'default'));
            if (p.is_ai) {
                // difficulty - a gather bonus for computer players (the same mechanism as for techs)
                p.add_effects([{ stat: 'gather', mul: match.LEVEL_GATHER[this.ai_levels[pid]] }]);
            }
            this.players.push(p);
        }
        this.human = 0;
        this.update_teams();
        this.vis = new Uint8Array(W * H);
        this.explored = new Uint8Array(W * H);
        this.fog_version = 0;
        this._fog_srcs = null;      // the vision sources at the previous fog recomputation
        this.fog_t = 0.0;
        this.messages = [];
        this.pings = [];
        this.alert_t = new Array(n).fill(-99.0);
        this.path_budget = 0;
        this.dt = 0.0;
        this.winner = null;         // the number of the winning team (-1 - nobody); None - the game is on
        this.victory_t = 0.0;
        this.nodes_dirty = false;
        this._ug = new Map();       // the unit grid (see units_in_rect); built lazily once per step
        this._ug_src = null;
        this._ug_n = 0;
        this._ug_mask = new Map();
        this._hm_cache = new Map();
        this._sep_grid = null;      // a flat grid for separate (reused between steps)
        this._sep_moved = null;
        this._sep_pass = 0;
        this.gen_map();
        for (const f of WORLD_HOOKS.init) f(this);     // content: team bonuses, the civilizations' starting units...
        gstats.init(this);          // statistics for the achievements screen and the score
        match.apply_start(this);    // resources, age, population, map reveal, treaty (lobby)
        this.recount();
        this.update_fog();
        this.ais = [];
    }

    // ---- saving (game/savegame.py): caches are not written - they rebuild themselves
    __getstate__() {
        const d = { ...this };
        for (const k of this._NOSAVE) delete d[k];
        d.events = [];
        return d;
    }

    __setstate__(d) {
        Object.assign(this, d);
        this._ug = new Map();
        this._ug_src = null;
        this._ug_mask = new Map();
        this._hm_cache = new Map();
        this._sep_grid = null;
        this._sep_moved = null;
        this._fog_srcs = null;
        terrain.ensure(this);
        for (const [k, v] of [['settings', match.defaults()], ['pop_limit', 200], ['max_age', 3], ['treaty_end', 0.0],
            ['reveal', 'normal']]) {
            if (!Object.hasOwn(this, k)) this[k] = v;
        }
        if (!Object.hasOwn(this, 'stats')) gstats.init(this);
        // JS only: the '-1' (nature) aliases of the matrix rows are not saved - restore them
        _neg_alias(this.hmat);
        _neg_alias(this.amat);
        if (Array.isArray(this.beast_row)) this.beast_row[-1] = this.beast_row[this.beast_row.length - 1];
    }

    // ---- teams and hostility
    update_teams() {
        /** Recompute the hostility/alliance matrices. Call after changing teams.
         *  The matrices are (n+1) x (n+1): the last row/column is nature (-1), so
         *  self.hmat[a][b] works for owner == -1 too without checks. (JS: via a '-1' alias property per row.) */
        const n = this.players.length;
        const tm = this.players.map(p => p.team);
        // treaty (lobby): until it ends, other teams are not enemies - nobody attacks (neither the AI nor you)
        const war = !(this.time < py.getattr(this, 'treaty_end', 0.0));
        const hm = [], am = [];
        for (let a = 0; a <= n; a++) {
            const hr = [], ar = [];
            for (let b = 0; b <= n; b++) {
                hr.push(war && a < n && b < n && !py.eq(tm[a], tm[b]));
                ar.push(a < n && b < n && py.eq(tm[a], tm[b]));
            }
            hm.push(hr);
            am.push(ar);
        }
        this.hmat = _neg_alias(hm);
        this._hm_cache = new Map();
        this.amat = _neg_alias(am);
        // whom an animal (a boar) attacks: any player
        const br = new Array(n).fill(true);
        br.push(false);
        br[-1] = false;
        this.beast_row = br;
    }

    hostile(a, b) {
        /** Whether owners a and b are enemies (both real players from different teams). Nature (-1) is not an enemy. */
        return this.hmat[a][b];
    }

    allied(a, b) {
        /** One team (including oneself); nature (-1) is not an ally. */
        return this.amat[a][b];
    }

    ally_of_human(owner) {
        return this.amat[this.human][owner];
    }

    team_players(team) {
        return this.players.filter(p => py.eq(p.team, team));
    }

    // ---- messages and events
    msg(text, color = [240, 235, 220]) {
        this.messages.push([text, this.time, color]);
        this.messages = this.messages.slice(-6);
    }

    emit(...ev) {
        this.events.push(ev);
    }

    // ---- map
    gen_map() {
        const maps = modules.maps, naval = modules.naval;
        if (!maps.is_legacy(this.map_type)) {
            modules.mapgen.generate(this);      // maps by DE rules (game/mapgen.py)
            return;
        }
        const W = this.W, H = this.H;
        const n = this.players.length;
        const mx = (W - 1) / 2, my = (H - 1) / 2;
        // starts on a circle; the rotation is chosen so that everyone stands as far from the center as possible
        const margin = 14;
        let best = null;
        for (let _ = 0; _ < 32; _++) {
            const base = random.uniform(0, math.tau);
            const angs = [];
            for (let i = 0; i < n; i++) angs.push(base + i * math.tau / n);
            let R = Infinity;
            for (const a of angs) {
                const v = Math.min((W / 2 - margin) / Math.max(Math.abs(Math.cos(a)), 1e-6),
                    (H / 2 - margin) / Math.max(Math.abs(Math.sin(a)), 1e-6));
                if (v < R) R = v;
            }
            if (best == null || R > best[0] + 0.01) best = [R, angs];
        }
        const [R, angs] = best;
        // allies - in neighboring places of the circle
        const together = py.get(this.settings, 'team_together', true);     // lobby: "Team Together"
        const order = py.sorted(py.range(n), pid => [py.bool(together) ? this.players[pid].team : 0, random.random()]);
        const slot_ang = new Array(n).fill(0.0);
        const starts = new Array(n).fill(null);
        for (const [slot, pid] of order.entries()) {
            const a = angs[slot];
            slot_ang[pid] = a;
            starts[pid] = [Math.trunc(py.round(mx + Math.cos(a) * R)), Math.trunc(py.round(my + Math.sin(a) * R))];
        }
        this.starts = starts;
        // "forward" for each player - toward the center of the map; the starting set is built in this coordinate system
        const fwd = slot_ang.map(a => a + Math.PI);

        const far = (x, y, d) => {
            for (const [sx, sy] of starts) if (!(math.hypot(x - sx, y - sy) >= d)) return false;
            return true;
        };
        const inb = (x, y) => 0 <= x && x < W && 0 <= y && y < H;
        const put = (kind, x, y) => {
            if (inb(x, y) && this.terrain[y][x] === 0 && this.occ[y][x] == null && far(x, y, 5.5)) {
                const nd = new Node(kind, x, y);
                this.nodes.push(nd);
                this.occ[y][x] = nd;
            }
        };
        const blob_shape = (r, prob) => {
            const cells = [];
            for (let y = Math.trunc(-r - 1); y < Math.trunc(r + 2); y++) {
                for (let x = Math.trunc(-r - 1); x < Math.trunc(r + 2); x++) {
                    if (math.hypot(x, y) <= r + random.uniform(-0.7, 0.5) && random.random() < prob) cells.push([x, y]);
                }
            }
            return cells;
        };
        const cluster_shape = (k) => {
            const cells = [[0, 0]];
            const placed = new Set(['0,0']);
            let tries = 0;
            while (placed.size < k && tries < 200) {
                tries += 1;
                const [x, y] = random.choice(cells);
                const [dx, dy] = random.choice([[1, 0], [-1, 0], [0, 1], [0, -1]]);
                const c = [x + dx, y + dy];
                const ck = c[0] + ',' + c[1];
                if (!placed.has(ck)) {
                    placed.add(ck);
                    cells.push(c);
                }
            }
            return cells;
        };
        const stamp = (kind, cx, cy, shape) => {
            for (const [dx, dy] of shape) put(kind, cx + dx, cy + dy);
        };
        const fits = (cx, cy, shape) => {
            for (const [dx, dy] of shape) {
                if (!(inb(cx + dx, cy + dy) && this.terrain[cy + dy][cx + dx] === 0 &&
                    this.occ[cy + dy][cx + dx] == null && far(cx + dx, cy + dy, 5.5))) return false;
            }
            return true;
        };
        const stamp_fit = (kind, cx, cy, shape) => {
            /** Place a figure as a whole (identically for all players, for fairness), shifting it by 1-3 tiles
             *  if something is in the way. */
            for (let r = 0; r < 4; r++) {
                for (let dy = -r; dy < r + 1; dy++) {
                    for (let dx = -r; dx < r + 1; dx++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && fits(cx + dx, cy + dy, shape)) {
                            stamp(kind, cx + dx, cy + dy, shape);
                            return;
                        }
                    }
                }
            }
            stamp(kind, cx, cy, shape);
        };
        const at = (pid, rel, d) => {
            /** A tile at distance d from the player's start in the direction fwd + rel. */
            const [sx, sy] = starts[pid];
            const a = fwd[pid] + rel;
            const x = Math.trunc(py.round(sx + Math.cos(a) * d));
            const y = Math.trunc(py.round(sy + Math.sin(a) * d));
            return [Math.max(2, Math.min(W - 3, x)), Math.max(2, Math.min(H - 3, y))];
        };

        const water_map = this.map_type !== 'land';
        if (water_map) {
            // sea / islands (game/naval.py); after that resources are placed only on land
            naval.gen_water(this, starts, slot_ang, R);
        }
        // lakes - away from all starts
        const nlakes = water_map ? 0 : 3 + n;
        for (let _ = 0; _ < nlakes; _++) {
            const cx = random.randrange(10, W - 10), cy = random.randrange(10, H - 10);
            if (!far(cx, cy, 20)) continue;
            const r = random.uniform(2.5, 4.5);
            for (let y = Math.trunc(cy - r - 2); y < Math.trunc(cy + r + 3); y++) {
                for (let x = Math.trunc(cx - r - 2); x < Math.trunc(cx + r + 3); x++) {
                    if (inb(x, y) && math.hypot(x - cx, y - cy) <= r + random.uniform(-0.8, 0.8) && far(x, y, 16)) {
                        this.terrain[y][x] = 1;
                    }
                }
            }
        }
        terrain.gen_shallows(this, starts);     // shallows along the rim of lakes and shores
        terrain.gen_heights(this, starts);      // hills (the starts are on flat sites)
        // the starting set: an identical layout rotated toward the center of the map for each player
        const base = random.uniform(0, math.tau);
        const rel = [];
        for (let i = 0; i < 5; i++) rel.push(base + i * math.tau / 5);
        random.shuffle(rel);
        const package_ = [];
        package_.push(['tree', rel[0], 10, blob_shape(3.5, 0.9)]);
        package_.push(['tree', rel[0] + 0.5, 13, blob_shape(3.0, 0.9)]);
        package_.push(['gold', rel[1], 9, cluster_shape(7)]);
        package_.push(['stone', rel[2], 10, cluster_shape(5)]);
        package_.push(['berries', rel[3], 7, cluster_shape(6)]);
        package_.push(['gold', rel[4], 16, cluster_shape(6)]);
        for (const [kind, ra, d, shape] of package_) {
            for (let pid = 0; pid < n; pid++) stamp_fit(kind, ...at(pid, ra, d), shape);
        }
        // resources "ahead" of each player (toward the center of the map) - also identical for all
        // (on water maps ahead there is sea - place them closer and to the sides)
        const [d0, d1, fr, spread] = water_map ? [11, 17, 10, 2.6] : [19, 27, 16, 1.1];
        for (const [kind, k] of [['gold', 6], ['gold', 5], ['stone', 5], ['berries', 5]]) {
            const shape = cluster_shape(k);
            for (let _ = 0; _ < 30; _++) {
                const ra = random.uniform(-spread, spread), d = random.uniform(d0, d1);
                const pts = [];
                for (let pid = 0; pid < n; pid++) pts.push(at(pid, ra, d));
                if (pts.every(([x, y]) => far(x, y, fr) && this.terrain[y][x] === 0 && this.occ[y][x] == null)) {
                    for (const [x, y] of pts) stamp_fit(kind, x, y, shape);
                    break;
                }
            }
        }
        // forest across the map (density - as on a 96x96 map)
        let land;
        if (water_map) {
            land = 0;
            for (const row of this.terrain) for (const v of row) if (v === 0) land += 1;
        } else {
            land = W * H;
        }
        const isl = this.map_type === 'islands';     // on islands the forest is denser - otherwise there will not be enough wood for the navy
        const nforest = Math.trunc(26 * land / (96 * 96) * (isl ? 3.0 : 1));
        for (let _ = 0; _ < nforest; _++) {
            let cx = random.randrange(W), cy = random.randrange(H);
            for (let __ = 0; __ < (water_map ? 12 : 0); __++) {
                if (this.terrain[cy][cx] === 0) break;
                cx = random.randrange(W);
                cy = random.randrange(H);
            }
            if (far(cx, cy, isl ? 8.5 : 11)) stamp('tree', cx, cy, blob_shape(random.uniform(1.5, 4.5), 0.85));
        }
        // forest along the edges
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const e = Math.min(x, y, W - 1 - x, H - 1 - y);
                if (e < 2 && random.random() < 0.55 && far(x, y, 9)) put('tree', x, y);
            }
        }
        terrain.gen_cliffs(this, starts);       // cliffs (do not split the map)
        // starting buildings and units
        for (const [pid, [cx, cy]] of starts.entries()) {
            const tc = this.place_building('town_center', pid, cx - 2, cy - 2, true);
            const ox = Math.cos(fwd[pid]) >= 0 ? 1 : -1;
            const oy = Math.sin(fwd[pid]) >= 0 ? 1 : -1;
            const spots = [[cx + 3 * ox, cy], [cx, cy + 3 * oy], [cx + 3 * ox, cy + 3 * oy]];
            for (const [sx0, sy0] of spots) {
                const [tx, ty] = this.nearest_free_tile(sx0, sy0);
                this.units.push(new Unit('villager', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, this));
            }
            const [tx, ty] = this.nearest_free_tile(cx - 3 * ox, cy + 3 * oy);
            this.units.push(new Unit('scout', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, this));
            tc.rally = null;
        }

        // animals: 4 own sheep by the center, pairs of sheep, deer, boars - identical for all
        const free_near = (x, y) => {
            x = Math.trunc(py.round(Math.max(2, Math.min(W - 3, x))));
            y = Math.trunc(py.round(Math.max(2, Math.min(H - 3, y))));
            return this.nearest_free_tile(x, y);
        };

        const herd = [];    // (kind, own?, angle, distance, x offset, y offset)
        const sheep_a = random.uniform(-2.2, 2.2);
        for (let i = 0; i < 4; i++) herd.push(['sheep', true, sheep_a, 4.5, i % 2, Math.floor(i / 2)]);
        const groups = [[0.4, 13, 'sheep', 2], [1.3, 15, 'sheep', 2], [2.6, 12, 'sheep', 2]];
        groups.push([random.uniform(0, 6.28), 16, 'deer', 3]);
        groups.push([random.uniform(0, 6.28), 14, 'boar', 1]);
        groups.push([random.uniform(0, 6.28), 17, 'boar', 1]);
        for (const [ra, dist, kind, k] of groups) {
            for (let i = 0; i < k; i++) herd.push([kind, false, ra, dist, i % 2, Math.floor(i / 2)]);
        }
        for (const [kind, own, ra, dist, ddx, ddy] of herd) {
            for (let pid = 0; pid < n; pid++) {
                const [sx, sy] = starts[pid];
                const a = fwd[pid] + ra;
                let [tx, ty] = free_near(sx + Math.cos(a) * dist + ddx, sy + Math.sin(a) * dist + ddy);
                if (water_map && !naval.same_land(this, [tx, ty], starts[pid])) {
                    [tx, ty] = free_near(sx + Math.cos(a) * dist * 0.5 + ddx, sy + Math.sin(a) * dist * 0.5 + ddy);
                }
                this.animals.push(new Animal(kind, (tx + 0.5) * TILE, (ty + 0.5) * TILE, this, own ? pid : -1));
            }
        }
        if (water_map) naval.place_fish(this, starts, fwd);
        terrain.gen_ground(this, starts);       // ground types for textures and blending
    }

    // ---- relief (game/terrain.py)
    z_at(x, y) {
        /** The ground height under a world point (logical px) in screen pixels. */
        return this.relief ? terrain.z_at(this, x, y) : 0.0;
    }

    elev(tx, ty) {
        /** The integer height level of a cell (0..7). */
        return terrain.elev(this, tx, ty);
    }

    // ---- passability
    passable(x, y) {
        // land and shallows (codes 0, 2) are passable, water and cliff (1, 3) are not
        return 0 <= x && x < this.W && 0 <= y && y < this.H && !(this.terrain[y][x] & 1) && this.occ[y][x] == null;
    }

    passable_px(x, y, owner = null) {
        if (owner == null) return this.passable(Math.floor(x / TILE), Math.floor(y / TILE));
        return this.passable_for(Math.floor(x / TILE), Math.floor(y / TILE), owner);
    }

    passable_for(x, y, owner) {
        /** Passability for a unit of owner owner: own and allied completed gates are open. */
        if (this.passable(x, y)) return true;
        if (0 <= x && x < this.W && 0 <= y && y < this.H) {
            const g = this.gate[y][x];
            return g != null && g === this.occ[y][x] && g.progress >= 1.0 && this.amat[owner][g.owner];
        }
        return false;
    }

    nearest_free_tile(tx, ty, maxr = 12) {
        if (this.passable(tx, ty)) return [tx, ty];
        for (let r = 1; r < maxr; r++) {
            let best = null;
            let bd = 1e9;
            for (let dy = -r; dy < r + 1; dy++) {
                for (let dx = -r; dx < r + 1; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    if (this.passable(tx + dx, ty + dy)) {
                        const d = dx * dx + dy * dy;
                        if (d < bd) [bd, best] = [d, [tx + dx, ty + dy]];
                    }
                }
            }
            if (best) return best;
        }
        return [tx, ty];
    }

    find_path(start, goals, hx, hy, limit = 1800, owner = null) {
        /** A*; owner - whose unit is walking (own/allied gates are passable). self.path_reached - whether it reached the
         *  target. The passability of the four straight neighbors is computed once per expansion, a diagonal - only if
         *  both adjacent straight cells are open (the result is the same as when checking by DIRS). */
        const W = this.W, H = this.H;
        const [sx, sy] = start;
        const s = sy * W + sx;
        const gset = new Set();
        for (const [x, y] of goals) gset.add(y * W + x);
        this.path_reached = true;
        if (gset.has(s)) return [];
        const terr = this.terrain;
        const occ = this.occ;
        const gate = this.gate;
        const arow = owner != null ? this.amat[owner] : null;

        const gate_ok = (x, y, o) => {
            const g = gate[y][x];
            return g === o && g.progress >= 1.0 && arow[g.owner];
        };

        const openh = [[0.0, 0.0, s]];
        const g = new Map([[s, 0.0]]);
        const came = new Map([[s, -1]]);
        let best = s;
        let besth = 1e9;
        let n = 0;
        const D = 1.414;
        let rs = null, os_ = null, rn = null, on = null;
        while (openh.length && n < limit) {
            const [, gc, c] = _heappop(openh);
            if (gc > g.get(c)) continue;
            n += 1;
            if (gset.has(c)) {
                best = c;
                break;
            }
            const y = Math.floor(c / W), x = c - y * W;
            let ex = x - hx;
            if (ex < 0) ex = -ex;
            let ey = y - hy;
            if (ey < 0) ey = -ey;
            const h = ex >= ey ? ex + 0.414 * ey : ey + 0.414 * ex;
            if (h < besth) [besth, best] = [h, c];
            // straight neighbors: E, W, S, N
            const trow = terr[y], orow = occ[y];
            const e = x + 1 < W && !(trow[x + 1] & 1) && (orow[x + 1] == null ||
                (arow != null && !!gate_ok(x + 1, y, orow[x + 1])));
            const wv = x > 0 && !(trow[x - 1] & 1) && (orow[x - 1] == null ||
                (arow != null && !!gate_ok(x - 1, y, orow[x - 1])));
            let so, no;
            if (y + 1 < H) {
                rs = terr[y + 1];
                os_ = occ[y + 1];
                so = !(rs[x] & 1) && (os_[x] == null || (arow != null && !!gate_ok(x, y + 1, os_[x])));
            } else {
                so = false;
            }
            if (y > 0) {
                rn = terr[y - 1];
                on = occ[y - 1];
                no = !(rn[x] & 1) && (on[x] == null || (arow != null && !!gate_ok(x, y - 1, on[x])));
            } else {
                no = false;
            }
            const cand = [];
            if (e) cand.push([x + 1, y, 1.0]);
            if (wv) cand.push([x - 1, y, 1.0]);
            if (so) cand.push([x, y + 1, 1.0]);
            if (no) cand.push([x, y - 1, 1.0]);
            // a diagonal: both adjacent straights are open (so the indices are within the map too)
            if (e && so && !(rs[x + 1] & 1) && (os_[x + 1] == null ||
                    (arow != null && gate_ok(x + 1, y + 1, os_[x + 1])))) cand.push([x + 1, y + 1, D]);
            if (e && no && !(rn[x + 1] & 1) && (on[x + 1] == null ||
                    (arow != null && gate_ok(x + 1, y - 1, on[x + 1])))) cand.push([x + 1, y - 1, D]);
            if (wv && so && !(rs[x - 1] & 1) && (os_[x - 1] == null ||
                    (arow != null && gate_ok(x - 1, y + 1, os_[x - 1])))) cand.push([x - 1, y + 1, D]);
            if (wv && no && !(rn[x - 1] & 1) && (on[x - 1] == null ||
                    (arow != null && gate_ok(x - 1, y - 1, on[x - 1])))) cand.push([x - 1, y - 1, D]);
            for (const [nx, ny, cost] of cand) {
                const nc = ny * W + nx;
                const ng = gc + cost;
                const og = g.get(nc);
                if (ng < (og === undefined ? 1e18 : og)) {
                    g.set(nc, ng);
                    came.set(nc, c);
                    let ex2 = nx - hx;
                    if (ex2 < 0) ex2 = -ex2;
                    let ey2 = ny - hy;
                    if (ey2 < 0) ey2 = -ey2;
                    // (ng + max) + 0.414*min - the same order of addition as before (the same floats)
                    _heappush(openh, [ex2 >= ey2 ? ng + ex2 + 0.414 * ey2 : ng + ey2 + 0.414 * ex2, ng, nc]);
                }
            }
        }
        this.path_reached = gset.has(best);
        const path = [];
        let c = best;
        while (c !== s && c !== -1) {
            path.push([c % W, Math.floor(c / W)]);
            c = came.get(c);
        }
        path.reverse();
        return path;
    }

    path_to_entity(u, e) {
        if (e instanceof Unit) {
            const g = e.tile();
            return this.find_path(u.tile(), [g], g[0], g[1], undefined, u.owner);
        }
        const hx = e.tx + Math.floor(e.w / 2), hy = e.ty + Math.floor(e.h / 2);
        const goals = [];
        if (py.getattr(e, 'walk', false)) {
            for (let x = e.tx; x < e.tx + e.w; x++) for (let y = e.ty; y < e.ty + e.h; y++) goals.push([x, y]);
        } else {
            for (let y = e.ty - 1; y < e.ty + e.h + 1; y++) {
                for (let x = e.tx - 1; x < e.tx + e.w + 1; x++) {
                    const inside = e.tx <= x && x < e.tx + e.w && e.ty <= y && y < e.ty + e.h;
                    if (!inside && this.passable(x, y)) goals.push([x, y]);
                }
            }
        }
        return this.find_path(u.tile(), goals, hx, hy, undefined, u.owner);
    }

    // ---- buildings
    can_place(kind, tx, ty, pid, check_explored = true) {
        if (BUILDINGS[kind].water) return modules.naval.can_place_water(this, kind, tx, ty, pid, check_explored);
        const s = BUILDINGS[kind].size;
        for (let y = ty; y < ty + s; y++) {
            for (let x = tx; x < tx + s; x++) {
                if (!(0 <= x && x < this.W && 0 <= y && y < this.H)) return false;
                if (this.terrain[y][x] !== 0 || this.occ[y][x] != null || this.floor[y][x] != null) return false;
                if (pid === this.human && check_explored && !this.explored[y * this.W + x]) return false;
            }
        }
        if (this.relief && !terrain.slope_ok(this, tx, ty, s)) {
            return false;               // a slope steeper than a level per base (AoE2: gentle slopes are allowed)
        }
        if (kind !== 'farm') {
            for (const u of this.units) {
                if (u.owner !== pid && tx * TILE - 4 <= u.x && u.x <= (tx + s) * TILE + 4 &&
                        ty * TILE - 4 <= u.y && u.y <= (ty + s) * TILE + 4) return false;
            }
        }
        return true;
    }

    place_building(kind, pid, tx, ty, complete = false, size = null) {
        /** size - (width, height) for non-square buildings (gates 4x1 / 1x4).
         *  The kind is taken with the player's upgrades in mind (watch tower -> guard tower -> keep). */
        kind = this.players.at(pid).current(kind);
        const b = new Building(kind, pid, tx, ty, complete, this.players.at(pid));
        if (py.bool(size)) [b.w, b.h] = size;
        b.seen = this.ally_of_human(pid);
        const is_gate = py.get(b.d, 'gate', false);
        for (let y = ty; y < ty + b.h; y++) {
            for (let x = tx; x < tx + b.w; x++) {
                if (b.walk) {
                    this.floor[y][x] = b;
                } else {
                    this.occ[y][x] = b;
                    if (is_gate) this.gate[y][x] = b;
                }
            }
        }
        this.buildings.push(b);
        if (!b.walk) {
            for (const u of this.units.concat(this.animals)) {
                const [ux, uy] = u.tile();
                if (tx <= ux && ux < tx + b.w && ty <= uy && uy < ty + b.h) {
                    const [fx, fy] = u.naval ? modules.naval.nearest_water_tile(this, ux, uy) : this.nearest_free_tile(ux, uy);
                    u.x = (fx + 0.5) * TILE;
                    u.y = (fy + 0.5) * TILE;
                    this._ug_src = null;    // a unit jumped - rebuild the unit grid
                    u.path = [];
                    u.path_target = null;
                }
            }
        }
        if (!complete) {
            const [cx, cy] = b.center();
            this.emit('place', cx, cy, pid, kind);
        }
        return b;
    }

    remove_building(b, rubble = true) {
        if (!b.alive) return;
        b.alive = false;
        for (let y = b.ty; y < b.ty + b.h; y++) {
            for (let x = b.tx; x < b.tx + b.w; x++) {
                if (this.occ[y][x] === b) this.occ[y][x] = null;
                if (this.floor[y][x] === b) this.floor[y][x] = null;
            }
        }
        if (rubble) this.decals.push(['rubble', b.tx, b.ty, b.w, this.time, b.kind]);
        if (_has(b.d, 'on_remove')) b.d.on_remove(this, b);     // content (e.g. "Nomads": a house does not take population away)
        const p = this.players.at(b.owner);
        for (const [kind, name] of b.queue) {
            if (kind === 'tech') p.researching.delete(name);
            p.refund(p.cost_of(kind, name));
        }
        b.queue = [];
        if (b.garrison.length) modules.defense.eject(this, b);
    }

    on_complete(b) {
        const p = this.players.at(b.owner);
        if (b.kind === 'farm') b.amount = p.stat('farm_food', 'farm', FARM_FOOD);
        const [cx, cy] = b.center();
        gstats.on_complete(this, b);
        this.emit('build_done', cx, cy, b.owner, b.kind);
        if (b.owner === this.human) this.msg(i18n.t('msg.built', { name: b.d.name }), [170, 230, 150]);
    }

    spawn(b, kind) {
        if (UNITS[kind].naval) return modules.naval.spawn_ship(this, b, kind);
        // a free cell around the building (from below first)
        const cand = [];
        for (let y = b.ty - 1; y < b.ty + b.h + 1; y++) {
            for (let x = b.tx - 1; x < b.tx + b.w + 1; x++) {
                if (!(b.tx <= x && x < b.tx + b.w && b.ty <= y && y < b.ty + b.h) && this.passable(x, y)) {
                    cand.push([-(y - b.ty) * 2 - (x - b.tx), x, y]);
                }
            }
        }
        let tx, ty;
        if (cand.length) {
            cand.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]) || (p[2] - q[2]));
            [, tx, ty] = cand[0];
        } else {
            [tx, ty] = this.nearest_free_tile(b.tx + Math.floor(b.w / 2), b.ty + b.h);
        }
        const ux = (tx + 0.5) * TILE + random.uniform(-4, 4);
        const uy = (ty + 0.5) * TILE + random.uniform(-4, 4);
        const u = new Unit(kind, b.owner, ux, uy, this);
        this.units.push(u);
        modules.orders.apply_rally(this, b, u);
        return u;
    }

    apply_tech(p, name) {
        const t = TECHS[name];
        p.techs.add(name);
        p.researching.delete(name);
        gstats.on_tech(this, p, name);
        if (AGE_TECHS.includes(name)) {
            p.age += 1;
            const tc = this.buildings.find(b => b.owner === p.id && b.kind === 'town_center') ?? null;
            const [cx, cy] = tc ? tc.center() : [0, 0];
            this.emit('age_up', cx, cy, p.id, p.age);
            if (p.id === this.human) {
                this.msg(i18n.t('msg.you_reached', { age: AGE_NAMES[p.age] }), [255, 220, 120]);
            } else {
                const col = this.allied(this.human, p.id) ? [150, 230, 160] : [255, 150, 130];
                this.msg(i18n.t('msg.reached', { name: p.name, age: AGE_NAMES[p.age] }), col);
            }
        } else if (p.id === this.human) {
            this.msg(i18n.t('msg.researched', { name: t.name }), [170, 230, 150]);
        }
        if (py.bool(py.get(t, 'upgrade'))) this.upgrade_line(p, ...t.upgrade);
        if (py.bool(py.get(t, 'effects'))) {
            p.add_effects(t.effects);
            if (t.effects.some(e => e.stat === 'hp')) this.refresh_hp(p);
        }
        if (py.get(t, 'on_apply')) t.on_apply(this, p);     // an arbitrary content action (e.g. turning towers into others)
    }

    upgrade_line(p, old, new_) {
        /** A line upgrade: all units old -> new, buildings train new (and everything that used to lead to old).
         *  Units converted by a monk for other players stay of their own kind (as in the original). */
        for (const [k, v] of Object.entries(p.alias)) {
            if (v === old) p.alias[k] = new_;
        }
        p.alias[old] = new_;
        for (const u of this.units) {
            if (u.owner === p.id && u.kind === old) u.set_kind(new_);
        }
    }

    refresh_hp(p) {
        /** After effects on 'hp': raise the maximum health (and the current one by the same amount). */
        for (const e of this.units) {
            if (e.owner === p.id) {
                const m = p.stat('hp', e.kind, e.d.hp);
                if (m !== e.max_hp) {
                    e.hp = Math.max(1.0, e.hp + m - e.max_hp);
                    e.max_hp = m;
                }
            }
        }
        for (const b of this.buildings) {
            if (b.owner === p.id) {
                const m = p.stat('hp', b.kind, b.d.hp);
                if (m !== b.max_hp) {
                    if (b.complete) b.hp = Math.max(1.0, b.hp + m - b.max_hp);
                    b.max_hp = m;
                }
            }
        }
    }

    tech_state(p, name, b = null) {
        /** (is_allowed, reason) */
        const t = TECHS[name];
        const T = i18n.t;
        if (p.techs.has(name)) return [false, T('msg.already_researched')];
        if (!p.allows(name)) return [false, T('msg.civ_unavailable')];
        if (p.researching.has(name)) return [false, T('msg.researching')];
        if (AGE_TECHS.includes(name)) {
            if (p.age >= py.getattr(this, 'max_age', 3)) return [false, T('msg.final_age')];
            if (p.age !== t.age) return [false, T('msg.need_previous_age')];
            if (AGE_TECHS.some(a => p.researching.has(a))) return [false, T('msg.age_in_progress')];
            const [need, cnt] = AGE_REQ[name];
            const have = new Set();
            for (const x of this.buildings) {
                if (x.owner === p.id && x.complete && py.contains(need, x.kind)) have.add(x.kind);
            }
            if (have.size < cnt) {
                const names = py.sorted(need).map(k => BUILDINGS[k].name).join(', ');
                return [false, T('msg.need_n_of', { n: cnt, names })];
            }
        } else if (p.age < t.age) {
            return [false, T('msg.need_age', { age: AGE_NAMES[t.age] })];
        }
        for (const r of as_tuple(py.get(t, 'req', []))) {
            if (!p.techs.has(r)) return [false, T('msg.requires', { name: TECHS[r].name })];
        }
        return [true, ''];
    }

    // ---- resources
    deplete(t) {
        t.alive = false;
        if (t instanceof Node) {
            this.nodes_dirty = true;
            if (this.occ[t.ty][t.tx] === t) this.occ[t.ty][t.tx] = null;
            if (t.kind === 'tree') this.decals.push(['stump', t.tx, t.ty, 1, this.time]);
        } else if (t instanceof Building) {
            const farmer = t.farmer;
            t.farmer = null;
            t.alive = true;                 // remove_building skips already removed ones - free the farm's cells
            this.remove_building(t, false);
            if (t.kind === 'farm') {
                const { farm_expired } = modules.market;     // the farm reseed queue
                farm_expired(this, t, farmer);
            }
        }
    }

    exposed(n) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.passable(n.tx + dx, n.ty + dy)) return true;
        }
        return false;
    }

    find_resource(u, kind, x, y, radius) {
        if (kind == null) return null;
        let best = null;
        let bd = radius * TILE;
        if (kind === 'hunt') {
            for (const pri of [0, 1]) {
                for (const a of this.animals) {
                    if (!a.alive || (a.kind === 'boar' && !a.dead) || a.den != null) continue;
                    if (pri === 0 && !a.dead) continue;
                    if (!a.dead && a.kind === 'sheep' && !(a.owner === -1 || a.owner === u.owner)) continue;
                    const d = math.hypot(a.x - x, a.y - y);
                    if (d < bd) [bd, best] = [d, a];
                }
                if (best != null) return best;
            }
            return null;
        }
        if (kind === 'farm') {
            for (const b of this.buildings) {
                if (b.alive && b.kind === 'farm' && b.owner === u.owner && b.complete &&
                        (b.farmer == null || b.farmer === u)) {
                    const [cx, cy] = b.center();
                    const d = math.hypot(cx - x, cy - y);
                    if (d < bd) [bd, best] = [d, b];
                }
            }
            return best;
        }
        for (const n of this.nodes) {
            if (n.kind !== kind || !n.alive) continue;
            const cx = (n.tx + 0.5) * TILE, cy = (n.ty + 0.5) * TILE;
            const d = Math.abs(cx - x) + Math.abs(cy - y);
            if (d < bd * 1.3 && math.hypot(cx - x, cy - y) < bd && this.exposed(n)) {
                [bd, best] = [math.hypot(cx - x, cy - y), n];
            }
        }
        return best;
    }

    nearest_dropoff(u, res) {
        let best = null;
        let bd = 1e18;
        for (const b of this.buildings) {
            if (b.owner === u.owner && b.alive && b.complete && py.contains(py.get(b.d, 'drop', []), res)) {
                const d = u.dist_to(b);
                if (d < bd) [bd, best] = [d, b];
            }
        }
        return best;
    }

    // ---- combat
    calc_damage(att, target, ranged = null) {
        /** Damage by the rules of the original: max(1, sum over attack classes of max(0, attack - armor of the same
         *  class)). The main attack is melee or ranged (d['dtype'] 'melee' | 'pierce'; by default ranged if
         *  it is a shot). Bonuses d['bonus'] = {the target's armor class: +damage} work if the target has that class
         *  (unit_tags: cls + 'ac'); the target's armor against a class - its d['carm'] = {class: armor}.
         *  'bonus:<class>' modifiers (techs) change the bonuses, including adding new ones. */
        const d = att.d;
        const atk = att.atk();
        const [ma, pa] = target.armor();
        const dt = py.get(d, 'dtype') || (ranged ? 'pierce' : 'melee');
        let total = Math.max(0, atk - (dt === 'pierce' ? pa : ma));
        const p = att.p;
        if (target instanceof Animal) return Math.max(1, total);
        const bmap = py.get(d, 'bonus') || {};
        const carm = py.get(target.d, 'carm') || {};
        for (const c of unit_tags(target.kind)) {
            let v = py.get(bmap, c, 0);
            if (p != null) v = p.stat(_BONUS_KEY.get(c) || _bonus_key(c), att.kind, v);
            if (v > 0) total += Math.max(0, v - py.get(carm, c, 0));
        }
        if (this.relief) {
            const m = terrain.height_mult(this, att, target);       // +-25 % for height (DE)
            if (m !== 1.0) return Math.max(1, total) * m;
        }
        return Math.max(1, total);
    }

    // ---- shots, misses, explosions
    fire(src, t, dmg, x = null, y = null, delay = 0.0, sound = true) {
        /** Fire a projectile src at target t. Arrows fly to the point where the target was (or will be - with the lead
         *  'lead', the "Ballistics" tech); with probability 1 - accuracy ('acc') - they miss, to the side. */
        if (x == null) [x, y] = [src.x, src.y - 10];
        const d = src.d;
        let point;
        if (t instanceof Animal) {
            point = null;
        } else {
            let px, py_;
            if (t instanceof Unit) {
                [px, py_] = [t.x, t.y];
                const p = src.p;
                if (p != null && p.stat('lead', src.kind, 0) > 0 && this.dt > 0) {
                    const vx = (t.x - t._px) / this.dt, vy = (t.y - t._py) / this.dt;
                    const fl = math.hypot(px - x, py_ - y) / py.get(d, 'shot_speed', 260);
                    [px, py_] = [px + vx * fl, py_ + vy * fl];
                }
            } else {
                [px, py_] = t.center();
            }
            const acc = src instanceof Unit ? src.acc() : 1.0;
            if (acc < 1.0 && random.random() > acc) {
                const a = random.uniform(0, math.tau);
                const r = random.uniform(0.5, 1.3) * TILE;
                [px, py_] = [px + Math.cos(a) * r, py_ + Math.sin(a) * r];
            }
            point = [px, py_];
        }
        this.projectiles.push(new Projectile(x, y, t, dmg, src, delay, point, py.get(d, 'blast', 0) * TILE,
            py.get(d, 'pierce', false)));
        if (sound) this.emit('arrow', x, y, src.owner, src.kind);
    }

    impact(pr) {
        /** A projectile reached the aim point. */
        const [px, py_] = pr.point;
        const t = pr.target, src = pr.src;
        if (pr.blast > 0) {
            this.blast(src, px, py_, pr.blast, t, pr.dmg);
            return;
        }
        if (t.alive && !pr.hit.has(t)) {
            if (t instanceof Unit) {
                if (math.hypot(t.x - px, t.y - py_) <= t.radius + 5) {
                    this.damage(t, src, pr.dmg);
                    return;
                }
            } else if (t.dist_px(px, py_) <= 6) {
                this.damage(t, src, pr.dmg);
                return;
            }
        }
        if (pr.pierce) return;
        // a miss: an arrow may hit another enemy at the landing point
        const hrow = this.hmat[pr.owner];
        for (const u of this.units) {
            if (hrow[u.owner] && u.alive && Math.abs(u.x - px) <= u.radius + 3 && Math.abs(u.y - py_) <= u.radius + 3) {
                this.damage(u, src, this.calc_damage(src, u, true));
                return;
            }
        }
    }

    blast(src, x, y, r, primary = null, dmg = null) {
        /** An explosion of radius r (pixels): damage to all units in the radius - foreign and own (like mangonels
         *  in the original), plus the target building and enemy buildings in the radius. */
        this.emit('blast', x, y, src.owner, src.kind);
        for (const u of this.units) {
            if (u === src || !u.alive) continue;
            const rr = r + u.radius;
            if (Math.abs(u.x - x) > rr || Math.abs(u.y - y) > rr || math.hypot(u.x - x, u.y - y) > rr) continue;
            this.damage(u, src, u === primary && dmg != null ? dmg : this.calc_damage(src, u, true));
        }
        const hrow = this.hmat[src.owner];
        for (const b of this.buildings) {
            if (b.alive && !b.walk && (b === primary || hrow[b.owner]) && b.dist_px(x, y) <= r) {
                this.damage(b, src, b === primary && dmg != null ? dmg : this.calc_damage(src, b, true));
            }
        }
    }

    pierce_hits(pr) {
        /** A scorpion's bolt pierces the enemies along the flight line (each one - once). */
        const hrow = this.hmat[pr.owner];
        for (const u of this.units) {
            if (!hrow[u.owner] || u === pr.target || !u.alive) continue;
            if (Math.abs(u.x - pr.x) <= u.radius && Math.abs(u.y - 8 - pr.y) <= u.radius + 2 && !pr.hit.has(u)) {
                pr.hit.add(u);
                this.damage(u, pr.src, this.calc_damage(pr.src, u, true));
            }
        }
    }

    // ---- monks
    convertible(m, t) {
        /** Whether monk m can convert t: a hostile unit; monks - after "Redemption" (the effect
         *  'convert_monk'), siege - after "Atonement" ('convert_siege'); buildings - no. */
        if (!(t instanceof Unit) || t instanceof Animal || !t.alive || !this.hmat[m.owner][t.owner]) return false;
        if (t.d.unconvertible) return false;
        const p = m.p;
        if (t.d.monk && p.stat('convert_monk', m.kind, 0) <= 0) return false;
        if (unit_tags(t.kind).includes('siege') && p.stat('convert_siege', m.kind, 0) <= 0) return false;
        return true;
    }

    convert(t, m) {
        /** Unit t passes to monk m's owner (queue, targets, population - everything is recomputed). */
        const old = t.owner, new_ = m.owner;
        t.stop();
        t.owner = new_;
        this._ug_src = null;        // the owner masks in the unit grid are stale
        t.p = this.players.at(new_);
        const frac = t.max_hp ? t.hp / t.max_hp : 1.0;
        t.max_hp = t.p.stat('hp', t.kind, t.d.hp);
        t.hp = Math.max(1.0, t.max_hp * frac);
        t.faith_t = this.time + 62.0;
        t.conv_t = 0.0;
        t.scan_t = this.time + 1.0;
        this.recount();
        gstats.on_convert(this, t, old, new_);
        this.emit('convert', t.x, t.y, new_, t.kind, old);
        if (old === this.human) {
            this.msg(i18n.t('msg.converted_lost', { name: t.d.name }), [255, 110, 90]);
            this.pings.push([t.x, t.y, this.time]);
        } else if (new_ === this.human) {
            this.msg(i18n.t('msg.converted_gained', { name: t.d.name }), [170, 230, 150]);
        }
    }

    wounded_ally(m, radius) {
        /** The nearest wounded allied unit (not siege) for a monk to heal. */
        let best = null, bd = radius;
        const arow = this.amat[m.owner];
        for (const u of this.units) {
            if (u === m || !arow[u.owner] || u.hp >= u.max_hp || !u.alive || u.cls === 'siege') continue;
            if (Math.abs(u.x - m.x) > bd || Math.abs(u.y - m.y) > bd) continue;
            const d = math.hypot(u.x - m.x, u.y - m.y);
            if (d < bd) [bd, best] = [d, u];
        }
        return best;
    }

    build_age(p, kind) {
        /** From which age player p may lay a building kind. Nomad (AoE2): the first center - already in the Dark Age. */
        const age = BUILDINGS[kind].age;
        if (kind === 'town_center' && py.getattr(this, 'nomad', false) &&
                !this.buildings.some(b => b.kind === 'town_center' && b.owner === p.id && b.alive)) return 0;
        return age;
    }

    unit_state(p, kind) {
        /** (can_train, reason): the age and the needed techs (UNITS[kind]['req']). */
        const d = UNITS[kind];
        if (!p.allows(kind)) return [false, i18n.t('msg.civ_unavailable')];
        if (d.age > p.age) return [false, i18n.t('msg.need_age', { age: AGE_NAMES[d.age] })];
        for (const r of as_tuple(py.get(d, 'req', []))) {
            if (!p.techs.has(r)) return [false, i18n.t('msg.requires', { name: TECHS[r].name })];
        }
        return [true, ''];
    }

    damage(target, attacker, dmg) {
        if (!target.alive) return;
        if (target instanceof Animal) {
            if (target.dead) return;
            target.hp -= dmg;
            target.hit_t = this.time;
            this.emit('hit', target.x, target.y, target.owner, attacker.kind, target.kind);
            target.on_hit(this, attacker);
            if (target.hp <= 0) {
                this.emit('death', target.x, target.y, target.owner, target.kind);
                target.on_death();
                target.dead_t = this.time;
            }
            return;
        }
        target.hp -= dmg;
        target.hit_t = this.time;
        const [cx, cy] = target.center();
        this.emit('hit', cx, cy, target.owner, attacker.kind, target.kind);
        const to = target.owner;
        if (this.hostile(to, attacker.owner) && this.time - this.alert_t.at(to) > 10) {
            this.alert_t[_ix(to, this.alert_t.length)] = this.time;
            this.emit('attack_alert', cx, cy, to, target.kind);
            if (to === this.human) {
                this.msg(i18n.t('msg.under_attack'), [255, 110, 90]);
                this.pings.push([cx, cy, this.time]);
            }
        }
        if (target instanceof Unit && target.cls !== 'vil' && target.state === 'idle' && attacker.alive &&
                attacker !== target && !this.allied(to, attacker.owner)) {
            if (!((target.d.bld_only && attacker instanceof Unit) || target.d.pack) &&
                    !(py.getattr(attacker, 'naval', false) && !target.naval && target.d.rng <= 0)) {
                modules.orders.engage(target, attacker);
            }
        }
        if (target.hp <= 0) {
            if (attacker.owner >= 0 && attacker.owner !== to) {
                this.players[attacker.owner].kills += 1;
                this.players[attacker.owner].kill_value += py.sum(Object.values(py.get(target.d, 'cost', {})));
            }
            gstats.on_death(this, target, attacker, !(target instanceof Unit));
            if (target instanceof Unit) {
                target.alive = false;
                target.release();
                // the unit itself - for drawing the death animation (kind, look, civilization)
                this.decals.push(['body', target.x, target.y, target.owner, this.time, target]);
                this.emit('death', target.x, target.y, to, target.kind);
            } else {
                this.remove_building(target);
                this.emit('destroy', cx, cy, to, target.kind);
                if (to === this.human) this.msg(i18n.t('msg.destroyed', { name: target.d.name }), [255, 110, 90]);
            }
        }
    }

    // ---- the unit grid: a fast "who is nearby" search instead of walking all units
    _build_ugrid() {
        const g = new Map();
        const masks = new Map();    // cell -> a bit mask of the owners of the units in it (bit owner + 1; nature - bit 0)
        const units = this.units;
        const C = UG_CELL;
        for (const u of units) {
            const k = Math.floor(u.y / C) * 4096 + Math.floor(u.x / C);
            const lst = g.get(k);
            if (lst === undefined) {
                g.set(k, [u]);
                masks.set(k, 1 << (u.owner + 1));
            } else {
                lst.push(u);
                masks.set(k, masks.get(k) | (1 << (u.owner + 1)));
            }
        }
        this._ug = g;
        this._ug_mask = masks;
        this._ug_src = units;
        this._ug_n = units.length;
    }

    hostile_mask(row) {
        /** A bit mask of the owners for which row[owner] is true (a row of hmat / beast_row). */
        const c = this._hm_cache.get(row);
        if (c !== undefined) return c;
        let m = 0;
        for (let o = -1; o < row.length - 1; o++) {
            if (row.at(o)) m |= 1 << (o + 1);
        }
        this._hm_cache.set(row, m);
        return m;
    }

    units_in_rect(x0, y0, x1, y1, mask = null) {
        /** Candidates - units that MAY be in the rectangle [x0, x1] x [y0, y1] (pixels).
         *  mask - only cells that contain units of these owners (see hostile_mask), e.g. enemies.
         *  The exact check (alive, whose, distance) is done by the caller with the current coordinates.
         *  The grid is built lazily and rebuilt when the self.units list changes (it is reassembled
         *  at the end of every step), on a monk's conversion and when a building pushes units aside;
         *  per step units move by a couple of pixels - the UG_PAD margin.
         *  Units added after the grid was built (trained, landed) are always returned. */
        const units = this.units;
        if (this._ug_src !== units) this._build_ugrid();
        const g = this._ug;
        const C = UG_CELL;
        const cx0 = Math.floor((x0 - UG_PAD) / C);
        const cx1 = Math.floor((x1 + UG_PAD) / C);
        const cy0 = Math.floor((y0 - UG_PAD) / C), cy1 = Math.floor((y1 + UG_PAD) / C);
        const out = [];
        if (mask == null) {
            for (let cy = cy0; cy < cy1 + 1; cy++) {
                const base = cy * 4096;
                for (let k = base + cx0; k < base + cx1 + 1; k++) {
                    const lst = g.get(k);
                    if (lst !== undefined) for (let i = 0; i < lst.length; i++) out.push(lst[i]);
                }
            }
        } else {
            const ms = this._ug_mask;
            for (let cy = cy0; cy < cy1 + 1; cy++) {
                const base = cy * 4096;
                for (let k = base + cx0; k < base + cx1 + 1; k++) {
                    const m = ms.get(k);
                    if (m !== undefined && (m & mask)) {
                        const lst = g.get(k);
                        for (let i = 0; i < lst.length; i++) out.push(lst[i]);
                    }
                }
            }
        }
        if (units.length > this._ug_n) {
            for (let i = this._ug_n; i < units.length; i++) out.push(units[i]);
        }
        return out;
    }

    units_near(x, y, r, mask = null) {
        /** Candidates in a square +-r around a point (see units_in_rect). */
        return this.units_in_rect(x - r, y - r, x + r, y + r, mask);
    }

    nearest_enemy(u, radius, buildings = true, minr = 0, units = true) {
        /** The nearest enemy within a radius; minr - no closer than this (the minimum range of siege),
         *  units=False - only buildings (rams). */
        let best = null;
        let bd = radius;
        const hrow = u.owner >= 0 ? this.hmat[u.owner] : this.beast_row;
        const fogged = u.owner === this.human;
        if (units) {
            for (const o of this.units_near(u.x, u.y, radius * 1.5, this.hostile_mask(hrow))) {
                if (!hrow[o.owner] || !o.alive) continue;
                if (o.naval && !u.naval && u.d.rng <= 0) continue;     // ships cannot be reached by infantry and cavalry
                let d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y);
                if (d > bd * 1.5) continue;
                if (fogged && !this.visible_px(o.x, o.y)) continue;
                d = math.hypot(o.x - u.x, o.y - u.y);
                if (d < bd && d >= minr) [bd, best] = [d, o];
            }
            if (best != null) return best;
        }
        if (buildings) {
            bd = radius;
            for (const b of this.buildings) {
                if (!hrow[b.owner] || !b.alive || b.kind === 'farm' || b.d.wall) continue;
                if (fogged && !b.seen) continue;
                const d = u.dist_to(b);
                if (d < bd && d >= minr) [bd, best] = [d, b];
            }
        }
        return best;
    }

    nearest_beast(u, radius) {
        /** The nearest living predator (a wolf) within a radius (px) - soldiers attack it on their own. */
        let best = null, bd = radius;
        for (const a of this.animals) {
            if (a.den == null || a.dead || !a.alive) continue;
            let d = Math.abs(a.x - u.x) + Math.abs(a.y - u.y);
            if (d > bd * 1.5) continue;
            d = math.hypot(a.x - u.x, a.y - u.y);
            if (d < bd && (u.owner !== this.human || this.visible_px(a.x, a.y))) [bd, best] = [d, a];
        }
        return best;
    }

    nearest_enemy_unit_for_building(b, rng, minr = 0) {
        let best = null;
        let bd = rng;
        const hrow = this.hmat[b.owner];
        const x0 = b.tx * TILE, y0 = b.ty * TILE;
        const pad = rng + UG_MAXR;
        for (const o of this.units_in_rect(x0 - pad, y0 - pad, x0 + b.w * TILE + pad, y0 + b.h * TILE + pad,
            this.hostile_mask(hrow))) {
            if (!hrow[o.owner] || !o.alive) continue;
            const d = b.dist_px(o.x, o.y) - o.radius;
            if (d < bd && d >= minr) [bd, best] = [d, o];
        }
        return best;
    }

    // ---- fog of war (for the human: everything his team sees is visible)
    visible_px(x, y) {
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (0 <= tx && tx < this.W && 0 <= ty && ty < this.H) return this.vis[ty * this.W + tx] === 1;
        return false;
    }

    update_fog() {
        const W = this.W, H = this.H;
        const arow = this.amat[this.human];
        // (cell x, cell y, radius): identical sources are counted once (JS: a Map keyed by 'x,y,r')
        const srcs = new Map();
        const add = (cx, cy, r) => {
            const k = cx + ',' + cy + ',' + r;
            if (!srcs.has(k)) srcs.set(k, [cx, cy, r]);
        };
        for (const u of this.units) {
            if (arow[u.owner]) add(Math.floor(u.x / TILE), Math.floor(u.y / TILE), Math.trunc(u.los()));
        }
        for (const b of this.buildings) {
            if (arow[b.owner]) add(b.tx + Math.floor(b.w / 2), b.ty + Math.floor(b.h / 2), Math.trunc(b.los()));
        }
        for (const a of this.animals) {
            if (arow[a.owner] && !a.dead) add(Math.floor(a.x / TILE), Math.floor(a.y / TILE), a.los());
        }
        const prev = this._fog_srcs;
        let same = prev != null && prev.size === srcs.size;
        if (same) for (const k of srcs.keys()) if (!prev.has(k)) { same = false; break; }
        if (!same) {
            // the vision sources moved (by cells) - recompute the visibility
            this._fog_srcs = srcs;
            let vis = new Uint8Array(W * H);
            const exp = this.explored;
            const spans = _FOG_SPANS;
            for (const [cx, cy, r] of srcs.values()) {
                let sp = spans.get(r);
                if (sp === undefined) {
                    const r2 = (r + 0.5) ** 2;
                    sp = [];
                    for (let dy = -r; dy < r + 1; dy++) sp.push([dy, Math.trunc(Math.sqrt(Math.max(0.0, r2 - dy * dy)))]);
                    spans.set(r, sp);
                }
                for (const [dy, span] of sp) {
                    const y = cy + dy;
                    if (y < 0 || y >= H) continue;
                    let x0 = cx - span;
                    if (x0 < 0) x0 = 0;
                    let x1 = cx + span;
                    if (x1 > W - 1) x1 = W - 1;
                    const n = x1 - x0 + 1;
                    if (n > 0) {
                        const a = y * W + x0;
                        vis.fill(1, a, a + n);     // vis[a:a + n] = ones[:n]
                    }
                }
            }
            // explored |= visible - one operation over the whole map (0/1 bytes)
            if (py.getattr(this, 'reveal', 'normal') === 'all') vis = new Uint8Array(W * H).fill(1);  // lobby: "reveal all"
            for (let i = 0; i < W * H; i++) exp[i] |= vis[i];
            this.vis = vis;
            this.fog_version += 1;
        }
        const vis = this.vis;
        for (const b of this.buildings) {
            if (!b.seen) {
                outer: for (let y = b.ty; y < b.ty + b.h; y++) {
                    const a = y * W + b.tx;
                    for (let i = a; i < a + b.w && i < vis.length; i++) {
                        if (vis[i]) {
                            b.seen = true;
                            break outer;
                        }
                    }
                }
            }
        }
    }

    // ---- simulation step
    recount() {
        const players = this.players;
        const np = players.length;
        const pop = new Array(np).fill(0);
        const cap = new Array(np).fill(0);
        for (const u of this.units) {
            if (u.alive) pop[_ix(u.owner, np)] += u.naval ? 1 + u.cargo.length : 1;     // + transport passengers
        }
        for (const b of this.buildings) {
            if (b.garrison.length) pop[_ix(b.owner, np)] += b.garrison.length;
            if (b.progress >= 1.0) {
                const pl = players.at(b.owner);
                cap[_ix(b.owner, np)] += py.get(b.d, 'pop', 0) + (py.bool(pl.pop_extra) ? py.get(pl.pop_extra, b.kind, 0) : 0);
            }
        }
        for (let i = 0; i < np; i++) {
            const p = players[i], a = pop[i], c = cap[i];
            p.pop = a;
            p.cap = Math.min(this.pop_limit + p.pop_bonus, c + p.pop_bonus + p.pop_keep);
        }
    }

    separate() {
        /** Pushing apart overlapping units (and living animals; ships - naval.separate_ships).
         *  The grid is by map cells (a flat list, living between steps); a cell's neighbors (3x3 cells)
         *  are gathered once per cell and only if needed; lone units are skipped.
         *  A "calm" unit stands where it stood at the start of the previous push-apart, with the same radius, and then
         *  it intersected nobody. If all units of the 3x3 cells around are calm and none of them has yet
         *  moved in this pass, the distances to the neighbors are the same as last time - no intersections,
         *  the check is skipped. The traversal order and arithmetic are as before (the result is the same). */
        const W = this.W, H = this.H;
        const R = W + 2;        // a grid row is wider than the map by 2 - neighbors by x do not "wrap around" to another row
        const size = R * (H + 2);
        let grid = this._sep_grid;
        if (grid == null || grid.length !== size) {
            grid = this._sep_grid = new Array(size).fill(null);
            this._sep_moved = new Array(size).fill(0);
        }
        const moved = this._sep_moved;      // moved[k] == pid - somebody moved in the 3x3 neighborhood of cell k
        const pid = this._sep_pass = this._sep_pass + 1;
        const movers = this.units.filter(u => !u.naval);
        for (const a of this.animals) if (!a.dead) movers.push(a);
        const keys = [];
        const occupied = [];
        const calm = new Map();     // cell -> all its units are calm
        for (const u of movers) {
            const x = u.x, y = u.y;
            let cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
            if (!(0 <= cx && cx < W && 0 <= cy && cy < H)) {
                cx = Math.min(Math.max(cx, 0), W - 1);
                cy = Math.min(Math.max(cy, 0), H - 1);
            }
            const k = (cy + 1) * R + cx + 1;
            keys.push(k);
            const r = u.radius;
            const still = x === u._sep_x && y === u._sep_y && u._sep_clear && r === u._sep_r;
            u._sep_x = x;
            u._sep_y = y;
            u._sep_r = r;
            const lst = grid[k];
            if (lst == null) {
                grid[k] = [u];
                occupied.push(k);
                calm.set(k, still);
            } else {
                lst.push(u);
                if (!still) calm.set(k, false);
            }
        }
        const offs = [-1 - R, -1, -1 + R, -R, 0, R, 1 - R, 1, 1 + R];   // the (dx, dy) order as in the old code
        const nbc = new Map();      // cell -> 3x3 neighbors (None - the unit is alone in the neighborhood)
        const calm3 = new Map();    // cell -> all units of the 3x3 around are calm
        const sqrt = Math.sqrt;
        const terr = this.terrain, occ = this.occ;
        for (let i = 0; i < movers.length; i++) {
            const u = movers[i], k = keys[i];
            let c3 = calm3.get(k);
            if (c3 === undefined) {
                c3 = true;
                for (const o of offs) {
                    if (calm.get(k + o) === false) {
                        c3 = false;
                        break;
                    }
                }
                calm3.set(k, c3);
            }
            if (c3 && moved[k] !== pid) {
                u._sep_clear = true;
                continue;
            }
            let nb;
            if (nbc.has(k)) {
                nb = nbc.get(k);
            } else {
                nb = [];
                for (const o of offs) {
                    const lst = grid[k + o];
                    if (lst != null) for (let j = 0; j < lst.length; j++) nb.push(lst[j]);
                }
                if (nb.length < 2) nb = null;
                nbc.set(k, nb);
            }
            if (nb == null) {
                u._sep_clear = true;
                continue;
            }
            const ux = u.x, uy = u.y;
            const ur = u.radius;
            let px = 0.0, py_ = 0.0;
            let clear = true;
            for (const o of nb) {
                if (o === u) continue;
                let ddx = ux - o.x;
                let ddy = uy - o.y;
                const mind = ur + o.radius - 3;
                const d2 = ddx * ddx + ddy * ddy;
                if (d2 < mind * mind) {
                    clear = false;
                    let d = sqrt(d2);
                    if (d < 0.01) {
                        const ang = random.uniform(0, math.tau);
                        [ddx, ddy, d] = [Math.cos(ang), Math.sin(ang), 1.0];
                    }
                    let push = (mind - d) * 0.22;
                    if (o.owner === u.owner) {
                        // own units give way to a walking one: a standing one steps aside, a walking one is barely deflected
                        const um = u.state === 'move';
                        if (um !== (o.state === 'move')) push *= um ? 0.15 : 2.0;
                    }
                    px += ddx / d * push;
                    py_ += ddy / d * push;
                }
            }
            u._sep_clear = clear;
            if ((px || py_) && !(u.pack_t > 0 || !u.packed)) {
                if ((u.state === 'gather' || u.state === 'build') && Array.isArray(u.path) && u.path.length === 0) {
                    px *= 0.3;
                    py_ *= 0.3;
                }
                const nx = ux + px, ny = uy + py_;
                const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
                if ((0 <= tx && tx < W && 0 <= ty && ty < H && !(terr[ty][tx] & 1) && occ[ty][tx] == null) ||
                        this.passable_for(tx, ty, u.owner)) {
                    u.x = nx;
                    u.y = ny;
                    for (const o of offs) moved[k + o] = pid;
                }
            }
        }
        for (const k of occupied) grid[k] = null;
    }

    update(dt) {
        if (this.winner != null) return;
        if (this.events.length > 4000) {    // nobody takes the events (headless) - do not accumulate forever
            this.events.splice(0, this.events.length - 500);
        }
        this.time += dt;
        this.dt = dt;
        this.path_budget = 10;
        for (const b of this.buildings) b.builders = 0;
        for (const u of this.units) if (u.alive) u.update(this, dt);
        for (const a of this.animals) if (a.alive) a.update(this, dt);
        this.separate();
        modules.naval.separate_ships(this);
        this.recount();
        for (const b of this.buildings) if (b.alive) b.update(this, dt);
        for (const pr of this.projectiles) pr.update(this, dt);
        this.projectiles = this.projectiles.filter(p => p.alive);
        this.units = this.units.filter(u => u.alive);
        this.animals = this.animals.filter(a => a.alive);
        this.buildings = this.buildings.filter(b => b.alive);
        if (this.nodes_dirty) {
            this.nodes_dirty = false;
            this.nodes = this.nodes.filter(n => n.alive);
        }
        const life = DECAL_LIFE;
        this.decals = this.decals.filter(d => this.time - d[4] < py.get(life, d[0], 25));
        this.pings = this.pings.filter(p => this.time - p[2] < 4);
        this.fog_t -= dt;
        if (this.fog_t <= 0) {
            this.fog_t = 0.2;
            this.update_fog();
        }
        for (const f of WORLD_HOOKS.tick) f(this, dt);
        for (const ai of this.ais) ai.update(dt);
        gstats.tick(this, dt);
        if (this.treaty_end && this.time - dt < this.treaty_end && this.treaty_end <= this.time) {
            this.update_teams();
            this.msg(i18n.t('msg.treaty_over'), [255, 200, 120]);
        }
        this.victory_t -= dt;
        if (this.victory_t <= 0) {
            this.victory_t = 1.0;
            this.check_victory();
        }
    }

    check_victory() {
        /** A player is defeated when he has neither a town center nor villagers.
         *  The match ends when one team is left. */
        const has = new Set();
        for (const b of this.buildings) {
            if (b.kind === 'town_center') has.add(b.owner);
            if (b.garrison.some(u => u.kind === 'villager')) has.add(b.owner);
        }
        for (const u of this.units) {
            if (u.kind === 'villager' || (u.naval && u.cargo.some(c => c.kind === 'villager'))) has.add(u.owner);
        }
        for (const p of this.players) {
            if (p.alive && !has.has(p.id)) {
                p.alive = false;
                gstats.on_defeat(this, p.id);
                const [sx, sy] = this.starts[p.id];
                this.emit('defeat', sx * TILE, sy * TILE, p.id, null);
                if (p.id === this.human) {
                    this.msg(i18n.t('msg.you_defeated'), [255, 110, 90]);
                } else {
                    const col = this.allied(this.human, p.id) ? [255, 150, 130] : [170, 230, 150];
                    this.msg(i18n.t('msg.defeated', { name: p.name }), col);
                }
            }
        }
        const teams = new Set();
        for (const p of this.players) if (p.alive) teams.add(p.team);
        const special = match.victory_check(this, teams);      // time limit / score (lobby)
        if (special != null) {
            this.winner = special;
            this.emit('game_over', 0, 0, this.winner, null);
            return;
        }
        if (teams.size <= 1) {
            this.winner = teams.size ? teams.values().next().value : -1;
            this.emit('game_over', 0, 0, this.winner, null);
        }
    }

    resign(pid) {
        /** A player resigns (the F10 menu -> "Resign"): he is defeated at once; his army and buildings stay on the map. */
        const p = this.players[pid];
        if (!p.alive) return;
        p.alive = false;
        p.resigned = true;
        gstats.on_defeat(this, pid);
        const [sx, sy] = this.starts[pid];
        this.emit('defeat', sx * TILE, sy * TILE, pid, null);
        this.msg(pid === this.human ? i18n.t('msg.you_resigned') : i18n.t('msg.resigned', { name: p.name }), [255, 110, 90]);
        this.victory_t = 0.0;
        this.check_victory();
    }

    human_won() {
        return this.winner != null && py.eq(this.winner, this.players[this.human].team);
    }
}
py.classattrs(World, {
    _NOSAVE: ['_ug', '_ug_src', '_ug_mask', '_hm_cache', '_sep_grid', '_sep_moved', '_fog_srcs', '_bz'],
});
py.register_class(World, 'world.World');
