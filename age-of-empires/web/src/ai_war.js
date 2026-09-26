// port of game/ai_war.py
// AI: waging war - gathering the army at the rally point, attack waves, marching with siege, choosing targets, retreat,
// base defense and the "sweep" (hunting the last villagers and buildings to finish the match).
//
// Used from ai.AI: this.war = new WarPlanner(ai); every half second AI.fight -> war.update(army, vils, threats).
// States: 'rally' -> 'march' -> 'engage' -> 'retreat' -> 'rally' (see the Python docstring).
// Allies are never touched: all targets go only through the hostility matrix w.hmat.
//
// id(obj)-keyed dicts of the Python (order_t, taken) are Maps keyed by the object itself.
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import { TILE, UNITS } from './data.js';
import { Unit, Building } from './world.js';

export const TOWERS = ['tower', 'guard_tower', 'keep', 'bombard_tower'];
export const FORTS = TOWERS.concat(['castle']);
export const ECO_BLDS = ['mill', 'lumber_camp', 'mining_camp', 'dock', 'market', 'town_center'];
export const _VAL = new Map();

export function value(kind) {
    // Unit cost (sum of resources) - a measure of "strength" for comparing armies.
    let v = _VAL.get(kind);
    if (v === undefined || v === null) {
        const d = UNITS[kind];
        v = 0;
        for (const x of Object.values(d['cost'])) v += x;
        if (d['cls'] === 'siege') {
            v *= (py.bool(py.get(d, 'bld_only')) || py.bool(py.get(d, 'pack'))) ? 0.35 : 0.8;
        } else if (py.get(d, 'monk')) {
            v *= 0.5;
        }
        v = Math.max(20.0, v);
        _VAL.set(kind, v);
    }
    return v;
}

export function strength(units) {
    let s = 0.0;
    for (const u of units) {
        s += value(u.kind) * (0.4 + 0.6 * u.hp / Math.max(1.0, u.max_hp));
    }
    return s;
}

export function is_fighter(u) {
    return u.cls !== 'vil' && !py.get(u.d, 'civil') && !u.naval;
}

export function siege_like(u) {
    return !!(py.bool(py.get(u.d, 'bld_only')) || py.bool(py.get(u.d, 'pack')));
}

export function bld_breaker(u) {
    // Siege able to break buildings (ram, trebuchet, bombard).
    return !!(py.bool(py.get(u.d, 'bld_only')) || py.bool(py.get(u.d, 'pack')) || u.kind === 'bombard_cannon');
}

export class WarPlanner {
    constructor(ai) {
        this.ai = ai;
        this.w = ai.w;
        this.state = 'rally';
        this.group = [];
        this.obj = null;
        this.flag = null;
        this.stage = null;
        this.v0 = 1.0;
        this.t_state = 0.0;
        this.next_wave = 0.0;
        this.ready_t = null;        // since when the army is "ready" but waits for siege
        this.wait_t = null;         // since when the army is large enough (patience is prof['patience'])
        this.waves = 0;
        this.order_t = new Map();   // unit -> time of the last order
        this.tick_n = 0;
        this.hunt = false;
        this.broken = false;
        this.broken_t = -99.0;
        this.avoid = [];            // enemy castles we do not approach without siege (sweep)
    }

    // ---- helpers
    set_state(s) {
        this.state = s;
        this.t_state = this.w.time;
    }

    order(a, now, gap = 2.5) {
        // Whether the unit may be ordered again (do not tug the path every half second).
        const t = this.order_t.has(a) ? this.order_t.get(a) : -99.0;
        if (now - t < gap) return false;
        this.order_t.set(a, now);
        return true;
    }

    rally_point() {
        const ai = this.ai;
        const [bx, by] = ai.base.center();
        if (ai.target == null) return [bx, by + 4 * TILE];
        const [ex, ey] = this.w.starts[ai.target];
        const dx = ex * TILE - bx, dy = ey * TILE - by;
        const d = math.hypot(dx, dy) || 1;
        return [bx + dx / d * 7 * TILE, by + dy / d * 7 * TILE];
    }

    enemy_strength() {
        // Known enemy strength: the target's army plus a third of the other enemies' armies.
        const w = this.w, ai = this.ai;
        const hrow = w.hmat[ai.pid];
        let s = 0.0;
        for (const u of w.units) {
            if (hrow[u.owner] && is_fighter(u)) {
                s += value(u.kind) * (u.owner === ai.target ? 1.0 : 0.33);
            }
        }
        return s;
    }

    static centroid(units) {
        if (!units.length) return null;
        const xs = py.sorted(units.map(u => u.x));
        const ys = py.sorted(units.map(u => u.y));
        return [xs[Math.floor(xs.length / 2)], ys[Math.floor(ys.length / 2)]];
    }

    // ---- main step
    update(army, vils, threats) {
        const ai = this.ai, w = this.w;
        const now = w.time;
        this.tick_n += 1;
        const fighters = army.filter(a => is_fighter(a));
        let gset = new Set(this.group);
        this.group = fighters.filter(a => gset.has(a));
        gset = new Set(this.group);
        let home = fighters.filter(a => !gset.has(a));
        if (this.order_t.size > 600) {
            const alive = new Set(fighters);
            const nm = new Map();
            for (const [k, v] of this.order_t) if (alive.has(k)) nm.set(k, v);
            this.order_t = nm;
        }

        // ---- base defense
        if (threats.length) {
            const tv = strength(threats);
            if (['march', 'engage'].includes(this.state)) {
                const gs = strength(this.group);
                const hs = strength(home.filter(a => !siege_like(a)));
                const sieged = threats.some(u => bld_breaker(u));
                // recall the army only if it cannot be handled at home: a small raid - trading bases is more profitable
                if (tv > 1.2 * hs + 300 && (tv >= 0.5 * gs || sieged || this.state === 'march')) {
                    this.recall();
                }
            }
            if (this.state === 'retreat') home = home.concat(this.group);
            this.defend(home, vils, threats);
            ai.attacking = ['march', 'engage'].includes(this.state);
            if (!['march', 'engage'].includes(this.state)) return;
        } else {
            for (const v of vils) {
                if (v.state === 'attack' && (v.target == null || !v.target.alive || !(v.target instanceof Unit))) {
                    v.stop();
                }
            }
        }

        // ---- naval landing - handled by the naval part of the AI
        if (ai.naval != null && ai.naval.ferry_mode()) {
            this.group = [];
            this.set_state('rally');
            ai.naval.offense(fighters);
            return;
        }

        const st = this.state;
        if (st === 'rally') {
            this.gather(home, now);
            this.maybe_commit(home, now);
        } else if (st === 'march') {
            this.gather(home, now);
            this.march(now);
        } else if (st === 'engage') {
            this.reinforce(home, now);
            this.engage(now);
        } else if (st === 'retreat') {
            this.gather(home, now);
            const [rx, ry] = this.rally_point();
            let back = 0;
            for (const a of this.group) if (math.hypot(a.x - rx, a.y - ry) < 8 * TILE) back += 1;
            if (now - this.t_state > 40 || back >= 0.7 * this.group.length) {
                this.group = [];
                this.set_state('rally');
            }
        }
        ai.attacking = ['march', 'engage'].includes(this.state);
        ai.army.lead_monks(this.group.length ? this.group : home);
    }

    // ---- defense
    defend(home, vils, threats) {
        const now = this.w.time;
        for (const a of home) {
            if (siege_like(a) || py.get(a.d, 'monk')) continue;
            if (['attack', 'convert'].includes(a.state) && threats.includes(a.target)) continue;
            if (a.state === 'garrison') continue;
            if (!this.order(a, now, 1.0)) continue;
            const t = py.min(threats, o => (o.x - a.x) ** 2 + (o.y - a.y) ** 2);
            a.cmd_attack(t);
        }
        // mangonels/scorpions at home also shoot at the crowd
        for (const a of home) {
            if (siege_like(a) || !py.get(a.d, 'rng') || a.cls !== 'siege') continue;
            if (a.state !== 'attack' && this.order(a, now, 2.0)) {
                const t = py.min(threats, o => (o.x - a.x) ** 2 + (o.y - a.y) ** 2);
                a.cmd_attack(t);
            }
        }
        let n_def = 0;
        for (const a of home) if (!siege_like(a)) n_def += 1;
        if (n_def < 2 && threats.length <= 3) {
            for (const t of threats) {
                const near = vils.filter(v => (v.x - t.x) ** 2 + (v.y - t.y) ** 2 < (4 * TILE) ** 2);
                for (const v of near.slice(0, 4)) {
                    if (v.state !== 'attack') v.cmd_attack(t);
                }
            }
        }
    }

    recall() {
        const [rx, ry] = this.rally_point();
        const [bx, by] = this.ai.base.center();
        for (const a of this.group) {
            if (py.get(a.d, 'pack')) {
                a.cmd_move(rx, ry);
                continue;
            }
            const x = bx + random.uniform(-60, 60);
            const y = by + random.uniform(-60, 60);
            a.cmd_move(x, y);
        }
        this.set_state('retreat');
        this.next_wave = this.w.time + 30;
    }

    // ---- gathering
    gather(home, now) {
        const [rx, ry] = this.rally_point();
        for (const a of home) {
            if (a.state === 'idle' && math.hypot(a.x - rx, a.y - ry) > 5 * TILE && this.order(a, now, 4.0)) {
                const x = rx + random.uniform(-50, 50);
                const y = ry + random.uniform(-50, 50);
                a.cmd_move(x, y);
            }
        }
    }

    maybe_commit(home, now) {
        const ai = this.ai, p = this.ai.p;
        const prof = ai.prof;
        if (now < ai.first_attack || now < this.next_wave || ai.target == null) return;
        const combat = home.filter(a => !py.get(a.d, 'monk'));
        const n = combat.filter(a => !siege_like(a)).length;
        let minw = prof['wave_min'][p.age];
        // the target has neither a center nor a castle left - a small squad is enough to finish it
        if (this.enemy_broken()) minw = Math.min(minw, 4);
        if (n < minw) {
            this.ready_t = null;
            this.wait_t = null;
            return;
        }
        if (this.wait_t == null) this.wait_t = now;
        const my = strength(combat);
        const en = this.enemy_strength();
        const maxed = p.pop >= Math.min(p.cap, 200 + p.pop_bonus) - 4 && p.pop >= 120;
        const big = n >= 3 * minw && my >= 0.6 * en;
        // we have been standing "ready" for long with no advantage - go with comparable forces
        const patient = now - this.wait_t > prof['patience'] && my >= 0.65 * en;
        const broken = this.enemy_broken() && my >= 0.5 * en;
        if (!(my >= prof['ratio'] * en || maxed || big || patient || broken)) {
            this.ready_t = null;
            return;
        }
        // in the Castle Age and later we wait for a siege weapon (no longer than 100 s) if a workshop exists
        if (p.age >= 2 && !combat.some(a => bld_breaker(a))) {
            const has_ws = this.w.buildings.some(b => b.owner === ai.pid && b.complete &&
                ['siege_workshop', 'castle'].includes(b.kind));
            if (has_ws && !maxed) {
                if (this.ready_t == null) this.ready_t = now;
                if (now - this.ready_t < 100) return;
            }
        }
        this.ready_t = null;
        this.wait_t = null;
        this.launch(combat.concat(home.filter(a => py.get(a.d, 'monk'))), now);
    }

    launch(units, now) {
        this.group = Array.from(units);
        this.v0 = Math.max(1.0, strength(this.group));
        this.waves += 1;
        this.ai.wave = Math.min(this.ai.wave + 4, 40);
        this.ai.target = this.ai.pick_target(this.ai.base);
        const ns = this.group.filter(a => !siege_like(a));
        const c = this.centroid(ns.length ? ns : this.group);
        this.obj = this.choose_obj(...c);
        if (this.obj == null) {
            this.group = [];
            return;
        }
        this.flag = c;
        this.set_state('march');
        this.prog_t = now;
    }

    enemy_broken() {
        // The target has neither a center nor a castle (recomputed every 5 s).
        const w = this.w;
        if (w.time - this.broken_t < 5) return this.broken;
        this.broken_t = w.time;
        const owners = new Set(this.target_players());
        this.broken = owners.size > 0 && !w.buildings.some(b => owners.has(b.owner) && b.kind === 'town_center');
        return this.broken;
    }

    // ---- target choice
    target_players() {
        const w = this.w, ai = this.ai;
        const hrow = w.hmat[ai.pid];
        if (ai.target != null && hrow[ai.target] && w.players[ai.target].alive) return [ai.target];
        return w.players.filter(p => hrow[p.id] && p.alive).map(p => p.id);
    }

    choose_obj(cx, cy) {
        const w = this.w, ai = this.ai;
        const hrow = w.hmat[ai.pid];
        const owners = new Set(this.target_players());
        if (!owners.size) return null;
        let siege = 0;
        for (const a of this.group) if (bld_breaker(a)) siege += 1;
        const gs = strength(this.group);
        const blds = w.buildings.filter(b => owners.has(b.owner) && b.alive && !py.get(b.d, 'wall')
            && !py.get(b.d, 'water'));
        // the enemy's "backbone": centers and castles
        // without centers the enemy loses as soon as the villagers run out - hunt them (walk around a castle without siege)
        const core = blds.filter(b => b.kind === 'town_center' || (b.kind === 'castle' && siege >= 2));
        this.hunt = !core.length;
        this.avoid = blds.filter(b => b.kind === 'castle' && siege < 2);
        if (this.hunt) {
            let vils = w.units.filter(u => owners.has(u.owner) && hrow[u.owner] && u.cls === 'vil' && !u.naval);
            vils = vils.filter(u => !this.avoid.some(c => c.dist_px(u.x, u.y) < 9 * TILE));
            let cands = vils.length ? vils : blds.filter(b => b.kind !== 'farm' && !this.avoid.includes(b));
            if (!cands.length) {
                cands = blds.slice();
                if (!cands.length) cands = w.units.filter(u => owners.has(u.owner) && !u.naval);
            }
            if (!cands.length) return null;
            return py.min(cands, e => (e.center()[0] - cx) ** 2 + (e.center()[1] - cy) ** 2);
        }
        let best = null, bs = 1e18;
        for (const b of blds) {
            const [bx, by] = b.center();
            const d = math.hypot(bx - cx, by - cy) / TILE;
            const k = b.kind;
            let pri;
            if (TOWERS.includes(k)) pri = d < 16 ? 0 : 4;
            else if (k === 'castle') pri = (siege >= 2 || (siege >= 1 && gs > 2500)) ? 1 : 9;
            else if (k === 'town_center') pri = (siege >= 1 || gs > 2000) ? 1 : 3;
            else if (py.bool(py.get(b.d, 'trains')) && d < 14) pri = 2;
            else if (ECO_BLDS.includes(k)) pri = 3;
            else if (k === 'farm') pri = 6;
            else pri = 5;
            const s = pri * 30 + d;
            if (s < bs) {
                bs = s;
                best = b;
            }
        }
        return best;
    }

    // ---- march
    march(now) {
        const w = this.w;
        const grp = this.group;
        if (grp.length < 2) {
            this.end_wave(now);
            return;
        }
        if (this.obj == null || !this.obj.alive) {
            const c = this.centroid(grp);
            this.obj = this.choose_obj(...c);
            if (this.obj == null) {
                this.end_wave(now);
                return;
            }
        }
        const [ox, oy] = this.obj.center();
        let [fx, fy] = this.flag;
        const [bx, by] = this.ai.base.center();
        const dx = ox - bx, dy = oy - by;
        const d = math.hypot(dx, dy) || 1;
        const stx = ox - dx / d * 9 * TILE, sty = oy - dy / d * 9 * TILE;
        // enemies near the squad - into combat
        const ns = grp.filter(a => !siege_like(a));
        const c = this.centroid(ns.length ? ns : grp);
        const hrow = w.hmat[this.ai.pid];
        const mask = w.hostile_mask(hrow);
        for (const u of w.units_in_rect(c[0] - 8 * TILE, c[1] - 8 * TILE, c[0] + 8 * TILE, c[1] + 8 * TILE, mask)) {
            if (hrow[u.owner] && u.alive && !u.naval) {
                this.set_state('engage');
                return;
            }
        }
        const rest = math.hypot(stx - fx, sty - fy);
        if (rest < TILE || now - this.t_state > 240) {
            this.set_state('engage');
            return;
        }
        let near = 0;
        for (const a of grp) if (math.hypot(a.x - fx, a.y - fy) < 5 * TILE) near += 1;
        if (near >= 0.6 * grp.length || now - this.prog_t > 30) {
            let mn = Infinity;
            for (const a of grp) mn = Math.min(mn, a.speed());
            const spd = mn * 0.9;
            let step = Math.min(rest, spd * 0.5 + (near === grp.length ? 2 * TILE : 0));
            if (now - this.prog_t > 30) step = Math.min(rest, 6 * TILE);
            fx += (stx - fx) / rest * step;
            fy += (sty - fy) / rest * step;
            this.flag = [fx, fy];
            this.prog_t = now;
        }
        for (const a of grp) {
            if (math.hypot(a.x - fx, a.y - fy) > 2.5 * TILE && ['idle', 'move', 'attack'].includes(a.state)
                && this.order(a, now, 3.0)) {
                const x = fx + random.uniform(-45, 45);
                const y = fy + random.uniform(-45, 45);
                a.cmd_move(x, y);
            }
        }
    }

    // ---- combat
    reinforce(home, now) {
        const n = home.filter(a => !py.get(a.d, 'monk'));
        // reinforcements - in a batch and only to a living wave; a dwindled wave is not fed one by one.
        // Clear advantage (or an enemy without an army) - press on: everything new goes forward at once
        const gs = strength(this.group);
        const ahead = gs + strength(n) >= 2.0 * this.enemy_strength();
        if (n.length >= (this.hunt || ahead ? 2 : 5) && (this.hunt || ahead || gs >= 0.45 * this.v0)) {
            this.group = this.group.concat(n);
            this.v0 = Math.max(this.v0, strength(this.group));
        }
    }

    end_wave(now) {
        const [rx, ry] = this.rally_point();
        for (const a of this.group) {
            if (a.alive && a.state === 'idle') {
                const x = rx + random.uniform(-50, 50);
                const y = ry + random.uniform(-50, 50);
                a.cmd_move(x, y);
            }
        }
        this.group = [];
        this.obj = null;
        this.set_state('rally');
        // the wave reached the end of the target and the enemy cannot answer - the next one almost immediately
        const quick = this.enemy_strength() < 0.5 * Math.max(1.0, strength(this.group));
        this.next_wave = now + this.ai.prof['wave_gap'] * (quick ? 0.15 : 0.5);
    }

    engage(now) {
        const w = this.w, ai = this.ai;
        const grp = this.group;
        const combat = grp.filter(a => !py.get(a.d, 'monk'));
        if (!combat.length || (combat.filter(a => !siege_like(a)).length === 0 &&
                               !combat.some(a => bld_breaker(a)))) {
            this.end_wave(now);
            return;
        }
        const ns = combat.filter(a => !siege_like(a));
        const c = this.centroid(ns.length ? ns : combat);
        const hrow = w.hmat[ai.pid];
        const mask = w.hostile_mask(hrow);
        // retreat: the army has dwindled and a stronger enemy is near it
        const gs = strength(combat);
        if (now - this.t_state > 10 && gs < 0.4 * this.v0 && !this.hunt) {
            const local = [];
            for (const u of w.units_in_rect(c[0] - 10 * TILE, c[1] - 10 * TILE, c[0] + 10 * TILE,
                                            c[1] + 10 * TILE, mask)) {
                if (hrow[u.owner] && u.alive && is_fighter(u)) local.push(u);
            }
            let forts = 0;
            for (const b of w.buildings) {
                if (hrow[b.owner] && FORTS.includes(b.kind) && b.complete && b.dist_px(...c) < 10 * TILE) forts += 1;
            }
            const en = this.enemy_strength();
            if (strength(local) + forts * 500 > 1.2 * gs || (gs < 0.25 * this.v0 && gs < 2.0 * en)) {
                // losing (or almost nothing is left of the wave) - back to save up the next one
                this.recall();
                this.next_wave = now + ai.prof['wave_gap'];
                return;
            }
        }
        if (this.obj == null || !this.obj.alive || py.getattr(this.obj, 'dead', false) ||
            !hrow[this.obj.owner] || (this.tick_n % 20 === 0)) {
            this.obj = this.choose_obj(...c);
            if (this.obj == null) {
                ai.target = ai.pick_target(ai.base);
                this.obj = this.choose_obj(...c);
            }
            if (this.obj == null) {
                this.end_wave(now);
                return;
            }
        }
        const obj = this.obj;
        const taken = new Map();
        const bk = combat.filter(a => bld_breaker(a));
        const breakers = bk.length ? this.centroid(bk) : null;
        for (const a of combat) {
            if (!this.order(a, now, 1.5)) continue;
            const t = a.state === 'attack' ? a.target : null;
            const alive_t = t != null && t.alive && !py.getattr(t, 'dead', false) && !!hrow[t.owner];
            if (bld_breaker(a)) {
                if (alive_t && t instanceof Building && (FORTS.includes(t.kind) || t === obj)) continue;
                const b = this.siege_target(a, obj, c);
                if (b != null && b !== t) a.cmd_attack(b);
                continue;
            }
            if (a.cls === 'siege') {
                // mangonels, scorpions: at units nearby, otherwise behind the squad
                const e = this.near_enemy(a, 9 * TILE, mask, hrow, true);
                if (e != null) {
                    if (!alive_t) a.cmd_attack(e);
                } else if (math.hypot(a.x - c[0], a.y - c[1]) > 4 * TILE && a.state !== 'attack') {
                    const x = c[0] + random.uniform(-40, 40);
                    const y = c[1] + random.uniform(-40, 40);
                    a.cmd_move(x, y);
                }
                continue;
            }
            if (alive_t && t instanceof Unit && !t.naval) continue;
            const e = this.near_enemy(a, 7 * TILE, mask, hrow, true) ||
                this.near_enemy(a, 6 * TILE, mask, hrow, false);
            if (e != null) {
                a.cmd_attack(e);
                continue;
            }
            if (this.hunt) {
                const h = this.hunt_target(a, taken);
                if (h != null) {
                    if (h !== t) a.cmd_attack(h);
                    continue;
                }
            }
            const far = math.hypot(a.x - c[0], a.y - c[1]) > 14 * TILE;
            if (far && math.hypot(a.x - obj.center()[0], a.y - obj.center()[1]) > 12 * TILE) {
                const x = c[0] + random.uniform(-40, 40);
                const y = c[1] + random.uniform(-40, 40);
                a.cmd_move(x, y);
                continue;
            }
            if (FORTS.includes(obj.kind) && obj instanceof Building && breakers) {
                // a castle/tower is broken by siege; the rest cover it without exposing themselves to arrows
                const [sx, sy] = breakers;
                if (alive_t && t instanceof Building && FORTS.includes(t.kind)) {
                    const x = sx + random.uniform(-50, 50);
                    const y = sy + random.uniform(-50, 50);
                    a.cmd_move(x, y);
                } else if (math.hypot(a.x - sx, a.y - sy) > 4 * TILE && a.state !== 'attack') {
                    const x = sx + random.uniform(-50, 50);
                    const y = sy + random.uniform(-50, 50);
                    a.cmd_move(x, y);
                }
                continue;
            }
            if (alive_t && t instanceof Building && (t === obj || TOWERS.includes(t.kind))) continue;
            a.cmd_attack(obj);
        }
    }

    near_enemy(a, r, mask, hrow, military = true) {
        let best = null, bd = r * r;
        const w = this.w;
        for (const u of w.units_in_rect(a.x - r, a.y - r, a.x + r, a.y + r, mask)) {
            if (!hrow[u.owner] || !u.alive || u.naval || py.getattr(u, 'inside', null) != null) continue;
            if (military && !is_fighter(u)) continue;
            if (!military && u.cls !== 'vil' && !py.get(u.d, 'civil')) continue;
            const d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2;
            if (d < bd) {
                bd = d;
                best = u;
            }
        }
        return best;
    }

    siege_target(a, obj, c) {
        // Target of a ram/trebuchet: nearby towers and castles, then the wave's target, then the nearest building.
        const w = this.w;
        const hrow = w.hmat[this.ai.pid];
        let best = null, bs = 1e18;
        const rng = py.get(a.d, 'pack') ? 18 * TILE : 10 * TILE;
        for (const b of w.buildings) {
            if (!hrow[b.owner] || !b.alive || py.get(b.d, 'wall') || b.kind === 'farm' || py.get(b.d, 'water')) continue;
            const d = b.dist_px(a.x, a.y);
            if (d > 30 * TILE) continue;
            let s;
            if (FORTS.includes(b.kind) && d < rng) s = d - 40 * TILE;
            else if (b === obj) s = d - 20 * TILE;
            else if (['town_center', 'castle'].includes(b.kind)) s = d - 10 * TILE;
            else s = d;
            if (s < bs) {
                bs = s;
                best = b;
            }
        }
        if (best == null && obj instanceof Building) best = obj;
        return best;
    }

    hunt_target(a, taken) {
        // Sweep: the nearest enemy villager (no more than 4 hunters per one), otherwise a building.
        const w = this.w;
        const hrow = w.hmat[this.ai.pid];
        let best = null, bd = 1e18;
        for (const u of w.units) {
            if (hrow[u.owner] && u.alive && !u.naval && (u.cls === 'vil' || py.get(u.d, 'civil'))) {
                if ((taken.has(u) ? taken.get(u) : 0) >= 4) continue;
                if (this.avoid.some(c => c.dist_px(u.x, u.y) < 9 * TILE)) continue;
                const d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2;
                if (d < bd) {
                    bd = d;
                    best = u;
                }
            }
        }
        if (best == null) {
            for (const b of w.buildings) {
                if (hrow[b.owner] && b.alive && !py.get(b.d, 'wall') && b.kind !== 'farm' && !py.get(b.d, 'water')) {
                    if ((taken.has(b) ? taken.get(b) : 0) >= 8) continue;
                    const d = (b.center()[0] - a.x) ** 2 + (b.center()[1] - a.y) ** 2;
                    if (d < bd) {
                        bd = d;
                        best = b;
                    }
                }
            }
        }
        if (best != null) taken.set(best, (taken.has(best) ? taken.get(best) : 0) + 1);
        return best;
    }
}
py.statics(WarPlanner, 'centroid');
py.register_class(WarPlanner, 'ai_war.WarPlanner');
