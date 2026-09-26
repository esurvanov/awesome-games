// port of game/ai.py
// Computer opponent.
//
// Development plan per age and difficulty level (PROFILES): how many villagers to keep in each age, at how many
// villagers and not before which minute to advance to the next age, how many production buildings and town centers,
// when to build a castle, when and with what force to attack. Town centers train villagers without pause; houses are built
// with a margin over the production rate; villagers are split across resources by needs for the next ~2 minutes (villagers,
// age, army, construction, stone for the castle, the tech being saved for). Surpluses go to the market (eco_ai).
// Army: composition and techs are in ai_army.ArmyPlanner, war (waves, targets, retreat, sweep) in ai_war.WarPlanner,
// defense (palisade, town bell, garrison) in ai_defense, navy in naval_ai.
//
// The Python id(obj)-keyed dicts (bad_nodes, vtrack) are Maps keyed by the object itself.
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import { TILE, RES, BUILDINGS, TECHS, AGE_TECHS, AGE_REQ, cost_add } from './data.js';
import { Building, Node } from './world.js';
import * as ai_defense from './ai_defense.js';
import * as eco_ai from './eco_ai.js';
import { ArmyPlanner, line_of } from './ai_army.js';
import { WarPlanner } from './ai_war.js';

export const M = 60.0;
// Difficulty levels: 0 - easy, 1 - normal, 2 - hard. Tuples are per age (0 - Dark Age ... 3 - Imperial).
export const PROFILES = new Map([
    [0, {
        vils: [18, 25, 32, 40], age_vils: [18, 25, 32], age_min: [15 * M, 31 * M, 52 * M], tc_extra: [0, 0],
        first_attack: 25 * M, ratio: 1.6, wave_min: [99, 99, 10, 14], wave_gap: 480, army_vils: [99, 18, 24, 28],
        castles: [0, 0, 0, 1], prod: [1, 2, 3, 4], workshops: [0, 0, 1, 1], spend: [0, 150, 450, 700], patience: 420, min_army: [0, 0, 6, 10], tech_gap: [0, 60, 120, 120],
        stone_early: false,
    }],
    [1, {
        vils: [21, 33, 50, 65], age_vils: [20, 28, 42], age_min: [11.5 * M, 24 * M, 40 * M], tc_extra: [1, 1],
        first_attack: 14 * M, ratio: 1.25, wave_min: [99, 6, 10, 14], wave_gap: 240, army_vils: [99, 20, 27, 32],
        castles: [0, 0, 1, 2], prod: [1, 2, 4, 6], workshops: [0, 0, 1, 1], spend: [0, 350, 900, 1400], patience: 240, min_army: [0, 0, 12, 20], tech_gap: [0, 40, 75, 75],
        stone_early: true,
    }],
    [2, {
        vils: [22, 36, 70, 95], age_vils: [21, 28, 40], age_min: [0, 0, 0], tc_extra: [1, 1],
        first_attack: 10.5 * M, ratio: 0.95, wave_min: [99, 5, 9, 14], wave_gap: 120, army_vils: [99, 19, 27, 34],
        castles: [0, 0, 1, 2], prod: [1, 3, 6, 8], workshops: [0, 0, 1, 2], spend: [0, 500, 1300, 2000], patience: 150, min_army: [0, 0, 14, 35], tech_gap: [0, 30, 55, 55],
        stone_early: true,
    }],
]);

export function _lerp(a, b, t) {
    if (typeof a === 'boolean') return t < 0.5 ? a : b;
    if (Array.isArray(a)) return a.map((x, i) => _lerp(x, b[i], t));
    if (py.is_dict(a)) {
        const out = {};
        for (const k of Object.keys(a)) out[k] = _lerp(a[k], b[k], t);
        return out;
    }
    const v = a + (b - a) * t;
    // Python: int(round(v)) when both ends are ints. JS cannot tell 900 from 900.0; every float pair in PROFILES
    // (M-multiples, ratios) interpolates to the same value either way (checked against Python in the tests).
    return Number.isInteger(a) && Number.isInteger(b) ? py.round(v) : v;
}

export function _stronger(base, ch = {}) {
    const d = { ...base };
    Object.assign(d, ch);
    return d;
}

// 6 levels as in AoE2 DE (lobby, match.AI_LEVELS): Easiest · Standard · Moderate · Hard · Hardest · Extreme.
// 0 = the former "easy", 2 = "normal", 3 = "hard"; 1 is between them; 4-5 are stronger than "hard"
// (attack earlier, more frequent waves, more villagers and production; gather bonus is match.LEVEL_GATHER).
export const LEVELS = [
    PROFILES.get(0),
    _lerp(PROFILES.get(0), PROFILES.get(1), 0.5),
    PROFILES.get(1),
    PROFILES.get(2),
    _stronger(PROFILES.get(2), {
        vils: [24, 40, 78, 105], age_vils: [20, 27, 38], first_attack: 9.5 * M, ratio: 0.85,
        wave_gap: 100, prod: [1, 3, 7, 9], spend: [0, 600, 1500, 2300], patience: 130, min_army: [0, 0, 16, 40],
        tech_gap: [0, 25, 45, 45], workshops: [0, 0, 2, 2],
    }),
    _stronger(PROFILES.get(2), {
        vils: [25, 42, 85, 115], age_vils: [20, 26, 36], first_attack: 8.5 * M, ratio: 0.75,
        wave_min: [99, 5, 8, 12], wave_gap: 80, prod: [2, 4, 8, 10], spend: [0, 700, 1800, 2600], patience: 110,
        min_army: [0, 0, 18, 45], tech_gap: [0, 20, 35, 35], workshops: [0, 0, 2, 3], castles: [0, 0, 1, 3],
    }),
];
export const LEVEL_OF_DIFF = new Map([[0, 0], [1, 2], [2, 3]]);
export const TIER_OF_LEVEL = [0, 0, 1, 2, 2, 2];      // for the old "diff >= 1 / 2" checks in ai_*.py, naval_ai.py

export const PROD = ['barracks', 'archery_range', 'stable'];
export const DROPS = ['lumber_camp', 'mill', 'mining_camp'];

const _hyp = math.hypot;

// ============================================================ AI
export class AI {
    constructor(w, pid, diff, level = null) {
        // diff - the old 3 levels (0-2); level - the DE level 0-5 (takes precedence over diff when set).
        this.w = w;
        this.pid = pid;
        this.p = w.players[pid];
        if (level == null) level = LEVEL_OF_DIFF.has(diff) ? LEVEL_OF_DIFF.get(diff) : 2;
        this.level = Math.max(0, Math.min(LEVELS.length - 1, level));
        this.diff = TIER_OF_LEVEL[this.level];
        this.prof = LEVELS[this.level];
        this.tick = random.random();
        this.first_attack = this.prof['first_attack'];
        this.wave = this.prof['wave_min'][1];
        this.max_vils = this.prof['vils'][0];
        this.attacking = false;
        this.rebalance_t = 20.0;
        this.tower_done = false;
        this.target = null;         // the player being attacked (or about to be)
        this.age_need = 99;
        this.threat = false;
        this.base = null;
        this.want = null;           // villager shares per resource (plan_want), recomputed every 3 s
        this.want_t = 0.0;
        this.goal = {};             // cost of the tech being saved for (research)
        this.blocked = {};          // cost of planned buildings that could not be afforded (construct), and when that happened
        this.blocked_t = -99.0;
        this.save_t = null;         // since when we have been saving for the age
        this.mtech_t = 0.0;         // no new military tech is started before this time
        this.bad_nodes = new Map(); // resource -> until when not to pick it (unreachable - a villager got stuck)
        this.vtrack = new Map();    // villager -> [[x, y, load], time] - stuck-villager detection
        this.stuck_t = 5.0;
        // on water maps - the naval part of the AI (game/naval_ai.py)
        this.naval = null;
        const maps = modules.maps;
        if (maps.is_water(py.getattr(w, 'map_type', 'land'))) {
            const { NavalAI } = modules.naval_ai;
            this.naval = new NavalAI(this);
        }
        this.army = new ArmyPlanner(this);      // army composition, military techs, siege, monks
        this.war = new WarPlanner(this);        // attack waves, targets, retreat, sweep
    }

    update(dt) {
        this.tick -= dt;
        if (this.tick > 0) return;
        this.tick = 0.5;
        const w = this.w;
        const units = w.units.filter(u => u.owner === this.pid);
        const vils = units.filter(u => u.kind === 'villager');
        const army = units.filter(u => u.kind !== 'villager' && !py.get(u.d, 'civil') && !u.naval);
        const ships = units.filter(u => u.naval);
        let blds = w.buildings.filter(b => b.owner === this.pid);
        const tcs = blds.filter(b => b.kind === 'town_center' && b.complete);
        const tc = tcs.length ? tcs[0] : null;
        if (tc == null && vils.length && !blds.some(b => b.kind === 'town_center')) {
            this.nomad_tc(vils);                // nomad start (or the center was lost): a new center first
            blds = w.buildings.filter(b => b.owner === this.pid);
        }
        const base = tc || (blds.length ? blds[0] : null);
        if (base == null) {
            for (const a of army) {
                if (a.state === 'idle') a.cmd_attack(this.nearest_enemy_thing(a.x, a.y));
            }
            return;
        }
        if (this.target == null || !w.players[this.target].alive || !w.hostile(this.pid, this.target)) {
            this.target = this.pick_target(base);
        }
        this.base = base;
        const count = new py.Counter(blds.map(b => b.kind));
        const done = new py.Counter(blds.filter(b => b.complete).map(b => b.kind));
        this.max_vils = this.prof['vils'][this.p.age];
        const reserve = this.age_reserve(vils, done, tcs);
        this.economy(vils, tcs, blds, reserve, count);
        this.construct(vils, tc, blds, count, done, reserve);
        eco_ai.update(this, units, vils, blds, count, done, reserve, tc);
        this.train(vils, army, blds, reserve, tc);
        this.fight(army, vils);
        ai_defense.tick(this, vils, army, blds, tc, count);
        if (this.naval != null) this.naval.update(vils, ships, blds, reserve, tc);
    }

    // ---- ages
    age_reserve(vils, done, tcs) {
        const p = this.p, w = this.w;
        if (AGE_TECHS.some(a => py.contains(p.researching, a)) || p.age >= Math.min(3, py.getattr(w, 'max_age', 3))) return {};
        const name = AGE_TECHS[p.age];
        const need_v = this.prof['age_vils'][p.age];
        this.age_need = need_v;
        if (vils.length < need_v || w.time < this.prof['age_min'][p.age] - 60) return {};
        const cost = p.cost_of('tech', name);
        if (w.time < this.prof['age_min'][p.age]) return { ...cost };        // almost affordable - keep saving
        const [ok] = w.tech_state(p, name);
        const host = tcs.length ? py.min(tcs, b => b.queue.length) : null;
        if (ok && host != null && p.afford(cost) && host.queue.length <= 1) {
            p.pay(cost);
            host.queue.push(['tech', name]);
            p.researching.add(name);
            return {};
        }
        return { ...cost };
    }

    // ---- economy: villager shares per resource
    plan_want(nv, reserve, tcs, count) {
        // Villager shares per resource from the needs of the next ~2 minutes.
        const p = this.p, prof = this.prof, age = this.p.age;
        const need = {};
        for (const r of RES) need[r] = 0.0;
        const H = 120.0;
        if (nv < this.max_vils) need['food'] += Math.max(1, tcs.length) * H / 25 * 50;
        if (py.bool(reserve)) {
            for (const [r, v] of Object.entries(reserve)) need[r] += 0.7 * v;
        } else if (age < 3 && nv >= prof['age_vils'][age] - 6) {
            for (const [r, v] of Object.entries(p.cost_of('tech', AGE_TECHS[age]))) need[r] += 0.5 * v;
        }
        const spend = prof['spend'][age];
        if (spend && nv >= prof['army_vils'][age] - 4) {
            for (const [r, f] of Object.entries(this.army.expected_cost())) need[r] += spend * f;
        }
        // wood: houses, construction and farms - for when the natural food near the center (sheep, deer, berries) runs out
        need['wood'] += [170, 300, 400, 400][age] + 30 * Math.max(0, tcs.length - 1);
        const fv = Math.trunc((age === 0 ? 0.55 : 0.45) * nv);
        const farms_need = Math.max(0, fv - count.get('farm') - Math.trunc(this.natural_food() / 250));
        need['wood'] += 60 * Math.min(8, farms_need);
        // buildings from the plan that cannot be afforded right now (including those needed for the next age)
        if (this.w.time - this.blocked_t < 15) {
            for (const [r, v] of Object.entries(this.blocked)) need[r] += v;
        }
        for (const [r, v] of Object.entries(this.goal)) need[r] += 0.6 * v;
        const want = {};
        for (const r of RES) want[r] = Math.max(0.0, need[r] - p.res[r]) + 0.25 * need[r];
        // long-term goals: stone for the castle (saved from the Feudal Age, once the economy is up), town centers in the Castle Age
        if (age >= 1 && prof['castles'][2] && count.get('castle') < prof['castles'][Math.max(2, age)] &&
            (age >= 2 || (prof['stone_early'] && nv >= prof['age_vils'][1] - 2))) {
            const eta = age === 1 ? 420.0 : 90.0;
            want['stone'] += Math.max(0.0, 650 - p.res['stone']) * H / eta;
        }
        if (age >= 2 && count.get('town_center') < 1 + prof['tc_extra'][0]) {
            want['stone'] += Math.max(0.0, 100 - p.res['stone']);
        }
        if (age === 0 && nv < 12) {
            want['gold'] = want['stone'] = 0.0;
        }
        let tot = _sumv(want) || 1.0;
        let frac = {};
        for (const [r, v] of Object.entries(want)) frac[r] = v / tot;
        const floor = {
            food: age === 0 ? 0.45 : 0.3, wood: nv >= 8 ? 0.3 : 0.22,
            gold: 0.0, stone: 0.0,
        };
        const cap = { food: age === 0 ? 0.65 : 0.7, wood: 0.55, gold: 0.4, stone: age < 2 ? 0.1 : 0.25 };
        for (let i = 0; i < 2; i++) {
            for (const r of RES) frac[r] = Math.min(cap[r], Math.max(floor[r], frac[r]));
            tot = _sumv(frac) || 1.0;
            const nf = {};
            for (const [r, v] of Object.entries(frac)) nf[r] = v / tot;
            frac = nf;
        }
        if (this.naval != null) this.naval.adjust_want(frac, nv);     // fishing ships provide food - more villagers can go to wood
        // what is in surplus in the stockpile - fewer villagers go there
        for (const k of RES) {
            const extra = p.res[k] - py.get(reserve, k, 0);
            if (extra > Math.max(300.0, 1.5 * need[k])) frac[k] *= 0.5;
            if (extra > 800) frac[k] *= 0.4;
            if (p.res[k] - py.get(reserve, k, 0) > 1500) frac[k] *= 0.3;
        }
        tot = _sumv(frac) || 1.0;
        const out = {};
        for (const [k, v] of Object.entries(frac)) out[k] = v / tot;
        return out;
    }

    natural_food() {
        // How much food is left near the main center without farms: sheep, carcasses, deer, boars, berries, shore fish.
        const w = this.w;
        const [bx, by] = this.base.center();
        const R = 14 * TILE;
        let s = 0.0;
        for (const a of w.animals) {
            if (a.alive && (a.owner === -1 || a.owner === this.pid) && Math.abs(a.x - bx) < R && Math.abs(a.y - by) < R) {
                s += a.amount;
            }
        }
        for (const n of w.nodes) {
            if (n.alive && (n.kind === 'berries' || n.kind === 'shore_fish') && Math.abs((n.tx + .5) * TILE - bx) < R &&
                Math.abs((n.ty + .5) * TILE - by) < R) {
                s += n.amount;
            }
        }
        return s;
    }

    vil_task(v) {
        if (v.state === 'gather' && v.target != null) return v.target instanceof Building ? 'food' : v.target.res;
        if (v.state === 'return') return v.carry_res;
        return null;
    }

    economy(vils, tcs, blds, reserve, count) {
        const p = this.p, w = this.w;
        let nq = 0;
        for (const tc of tcs) for (const q of tc.queue) if (q[1] === 'villager') nq += 1;
        const vcost = p.cost_of('unit', 'villager');
        // save for the age without stopping villager production; stop only when food is nearly enough (or in the Dark Age)
        let vres = null;
        if (py.bool(reserve) && vils.length >= this.age_need &&
            (p.age === 0 || p.res['food'] >= 0.65 * py.get(reserve, 'food', 0))) {
            vres = reserve;
        }
        for (const tc of tcs) {
            let in_q = 0;
            for (const q of tc.queue) if (q[1] === 'villager') in_q += 1;
            if (vils.length + nq < this.max_vils && in_q < 2 && tc.queue.length < 2
                && p.afford(vcost, vres)) {
                p.pay(vcost);
                tc.queue.push(['unit', 'villager']);
                nq += 1;
            }
        }
        if (!vils.length) return;
        const n = vils.length;
        if (this.want == null || w.time >= this.want_t) {
            this.want_t = w.time + 3.0;
            this.want = this.plan_want(n, reserve, tcs, count);
        }
        const want = this.want;
        const cur = new py.Counter();
        for (const v of vils) {
            const r = this.vil_task(v);
            if (r) cur.inc(r);
        }
        this.unstick(vils);
        for (const v of vils) {
            if (v.state !== 'idle') continue;
            const order = py.sorted(RES, k => -(want[k] * n - cur.get(k)));
            for (const r of order) {
                if (this.assign(v, r)) {
                    cur.inc(r);
                    break;
                }
            }
        }
        this.rebalance_t -= 0.5;
        if (this.rebalance_t <= 0) {
            this.rebalance_t = 4.0;
            for (let i = 0; i < Math.max(1, Math.floor(n / 25)); i++) {
                const over = py.max(RES, k => cur.get(k) - want[k] * n);
                const under = py.min(RES, k => cur.get(k) - want[k] * n);
                if (cur.get(over) - want[over] * n > 1.5 && want[under] * n - cur.get(under) > 1.5) {
                    let moved = false;
                    for (const v of vils) {
                        if (this.vil_task(v) === over && v.carry < 3 && v.state === 'gather') {
                            if (this.assign(v, under)) {
                                cur.inc(over, -1);
                                cur.inc(under);
                                moved = true;
                            }
                            break;
                        }
                    }
                    if (!moved) break;
                } else {
                    break;
                }
            }
        }
    }

    unstick(vils) {
        // Villagers stuck at an unreachable resource (path blocked) go to another resource.
        const w = this.w;
        this.stuck_t -= 0.5;
        if (this.stuck_t > 0) return;
        this.stuck_t = 5.0;
        const now = w.time;
        const seen = new Map();
        for (const v of vils) {
            const prev = this.vtrack.has(v) ? this.vtrack.get(v) : null;
            const key = [v.x, v.y, v.carry];
            seen.set(v, [key, prev && py.eq(prev[0], key) ? prev[1] : now]);
            if (prev == null || !py.eq(prev[0], key)) continue;
            if (v.state === 'gather' && (v.target instanceof Node || v.target instanceof Building) && now - prev[1] >= 10) {
                const t = v.target;
                this.bad_nodes.set(t, now + 240);
                const r = this.vil_task(v);
                v.stop();
                if (r == null || !this.assign(v, r)) {
                    for (const r2 of RES) {
                        if (this.assign(v, r2)) break;
                    }
                }
                seen.set(v, [null, now]);
            }
        }
        this.vtrack = seen;
        if (this.bad_nodes.size > 200) {
            const nb = new Map();
            for (const [k, t] of this.bad_nodes) if (t > now) nb.set(k, t);
            this.bad_nodes = nb;
        }
    }

    _bad(n) {
        return this.bad_nodes.has(n) ? this.bad_nodes.get(n) : 0;
    }

    find_res(v, kind, x, y, radius) {
        // World.find_resource, but skipping resources that villagers could not reach.
        const n = this.w.find_resource(v, kind, x, y, radius);
        if (n == null || this._bad(n) < this.w.time) return n;
        const w = this.w;
        let best = null, bd = radius * TILE;
        for (const m of w.nodes) {
            if (m.kind !== kind || !m.alive || this._bad(m) >= w.time) continue;
            const d = _hyp((m.tx + 0.5) * TILE - x, (m.ty + 0.5) * TILE - y);
            if (d < bd && w.exposed(m)) {
                bd = d;
                best = m;
            }
        }
        return best;
    }

    assign(v, r) {
        const w = this.w;
        const [bx, by] = this.base.center();
        if (r === 'food') {
            // carcasses and own sheep near the center, then deer nearby
            for (const a of w.animals) {
                if (a.alive && a.dead && a.amount > 0 && _hyp(a.x - bx, a.y - by) < 10 * TILE) {
                    let k = 0;
                    for (const o of w.units) if (o.target === a) k += 1;
                    if (k < 5) {
                        v.cmd_gather(a);
                        return true;
                    }
                }
            }
            const sheep = w.animals.filter(a => a.alive && !a.dead && a.kind === 'sheep' && a.owner === this.pid
                && _hyp(a.x - bx, a.y - by) < 6 * TILE);
            if (sheep.length) {
                v.cmd_gather(py.min(sheep, a => _hyp(a.x - v.x, a.y - v.y)));
                return true;
            }
            const deer = w.animals.filter(a => a.alive && !a.dead && a.kind === 'deer'
                && _hyp(a.x - bx, a.y - by) < 11 * TILE);
            if (deer.length && !w.units.some(o => o.owner === this.pid && deer.includes(o.target))) {
                v.cmd_gather(py.min(deer, a => _hyp(a.x - v.x, a.y - v.y)));
                return true;
            }
            let n = this.naval != null ? this.naval.shore_fish(v, bx, by) : null;
            if (n != null) {
                v.cmd_gather(n);
                return true;
            }
            n = this.find_res(v, 'berries', bx, by, 16);
            if (n != null && this.has_drop_near('food', ...n.center(), 5)) {
                v.cmd_gather(n);
                return true;
            }
            const f = w.find_resource(v, 'farm', v.x, v.y, 40);
            if (f != null && this._bad(f) < w.time) {
                v.cmd_gather(f);
                return true;
            }
            for (const b of w.buildings) {
                if (b.owner === this.pid && b.kind === 'farm' && !b.complete && b.alive) {
                    if (!w.units.some(o => o.owner === this.pid && o.state === 'build' && o.target === b)) {
                        v.cmd_build(b);
                        return true;
                    }
                }
            }
            const fcost = this.p.cost_of('bld', 'farm');
            if (this.p.afford(fcost)) {
                let spot = null;
                // around centers (free spots), near mills, then farther from the main center
                for (const c of w.buildings.filter(b => b.owner === this.pid && b.kind === 'town_center' && b.complete)) {
                    const [cx, cy] = c.center();
                    spot = this.find_spot('farm', Math.trunc(py.floordiv(cx, TILE)), Math.trunc(py.floordiv(cy, TILE)), 2, 7, false);
                    if (spot) break;
                }
                const mills = spot ? [] : w.buildings.filter(m => m.owner === this.pid && m.kind === 'mill' && m.complete);
                for (const m of mills) {
                    spot = this.find_spot('farm', m.tx + 1, m.ty + 1, 2, 5, false);
                    if (spot) break;
                }
                spot = spot || this.find_spot('farm', Math.trunc(py.floordiv(bx, TILE)), Math.trunc(py.floordiv(by, TILE)), 8, 18, false);
                if (spot) {
                    this.p.pay(fcost);
                    const b = w.place_building('farm', this.pid, ...spot);
                    v.cmd_build(b);
                    return true;
                }
            }
            return false;
        }
        const kind = { wood: 'tree', gold: 'gold', stone: 'stone' }[r];
        const drops = [];
        for (const b of w.buildings) {
            if (b.owner === this.pid && b.complete && py.contains(py.get(b.d, 'drop', []), r)) {
                drops.push([b.kind !== 'town_center' ? v.dist_to(b) : 1e9, b]);
            }
        }
        py.sort(drops, t => t[0]);
        const pts = drops.slice(0, 3).map(([, b]) => b.center()).concat([[bx, by]]);
        for (const [cx, cy] of pts) {
            const n = this.find_res(v, kind, cx, cy, 28);
            if (n != null) {
                v.cmd_gather(n);
                return true;
            }
        }
        return false;
    }

    // ---- construction
    find_spot(kind, cx, cy, rmin, rmax, margin = true) {
        const w = this.w;
        const s = BUILDINGS[kind]['size'];
        const h = Math.floor(s / 2);
        for (let r = rmin; r < rmax + 1; r++) {
            const cands = [];
            for (let dy = -r; dy < r + 1; dy++) {
                for (let dx = -r; dx < r + 1; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) === r) cands.push([cx + dx - h, cy + dy - h]);
                }
            }
            random.shuffle(cands);
            for (const [tx, ty] of cands) {
                if (!w.can_place(kind, tx, ty, this.pid, false)) continue;
                if (margin && !this.margin_ok(tx, ty, s)) continue;
                return [tx, ty];
            }
        }
        return null;
    }

    margin_ok(tx, ty, s) {
        const w = this.w;
        for (let y = ty - 1; y < ty + s + 1; y++) {
            for (let x = tx - 1; x < tx + s + 1; x++) {
                if (tx <= x && x < tx + s && ty <= y && y < ty + s) continue;
                if (!(0 <= x && x < w.W && 0 <= y && y < w.H)) return false;
                const o = w.occ[y][x];
                if (w.terrain[y][x] !== 0 || o instanceof Building || w.floor[y][x] != null) return false;
            }
        }
        return true;
    }

    nearest_node(kind, x, y, maxd = 30) {
        // Resources only disappear (new nodes appear only during map generation, counter Node.serial),
        // so the nearest one stays the nearest while it lives: cache keyed by (kind, point, radius).
        const key = py.tkey([kind, x, y, maxd]);
        if (this._nn_cache === undefined) this._nn_cache = new Map();
        const cache = this._nn_cache;
        const hit = cache.get(key);
        if (hit != null && hit[1] === Node.serial && (hit[0] == null || hit[0].alive) &&
            (hit[0] == null || this._bad(hit[0]) < this.w.time)) {
            return hit[0];
        }
        let best = null, bd = maxd * TILE;
        for (const n of this.w.nodes) {
            if (n.kind === kind && n.alive && this._bad(n) < this.w.time) {
                const d = _hyp((n.tx + 0.5) * TILE - x, (n.ty + 0.5) * TILE - y);
                if (d < bd) {
                    bd = d;
                    best = n;
                }
            }
        }
        if (cache.size > 64) cache.clear();
        cache.set(key, [best, Node.serial]);
        return best;
    }

    has_drop_near(res, x, y, r) {
        for (const b of this.w.buildings) {
            if (b.owner === this.pid && py.contains(py.get(b.d, 'drop', []), res) && b.dist_px(x, y) < r * TILE) return true;
        }
        return false;
    }

    enemy_dir() {
        // Unit vector from the base to the target (for the castle, rally point).
        const [bx, by] = this.base.center();
        if (this.target == null) return [0.0, 0.0];
        const [ex, ey] = this.w.starts[this.target];
        const dx = ex * TILE - bx, dy = ey * TILE - by;
        const d = _hyp(dx, dy) || 1;
        return [dx / d, dy / d];
    }

    construct(vils, tc, blds, count, done, reserve) {
        const p = this.p, prof = this.prof;
        if (!vils.length) return;
        const [bx, by] = this.base.center();
        const btx = Math.trunc(py.floordiv(bx, TILE)), bty = Math.trunc(py.floordiv(by, TILE));
        const nv = vils.length;
        const age = p.age;
        const building_now = blds.filter(b => !b.complete && b.kind !== 'farm' && !py.get(b.d, 'wall'));
        // houses: population margin by production rate (centers + busy military buildings)
        const houses_wip = building_now.filter(b => b.kind === 'house').length;
        const producers = blds.filter(b => b.complete && b.queue.length && py.bool(py.get(b.d, 'trains'))).length +
            blds.filter(b => b.kind === 'town_center' && b.complete).length;
        const margin = 3 + 2 * producers + (age >= 2 ? 2 : 0);
        const room = p.cap + 5 * houses_wip - p.pop;
        if (p.cap < 200 + p.pop_bonus && room <= margin && houses_wip < 1 + Math.floor(producers / 3)) {
            if (p.afford(p.cost_of('bld', 'house'))) {
                const spot = this.find_spot('house', btx, bty, 4, 13) || this.find_spot('house', btx, bty, 14, 22);
                if (spot) {
                    this.start_build('house', spot, vils, 1);
                    return;
                }
            }
        }
        // abandoned constructions - send a builder back
        for (const b of building_now) {
            if (!vils.some(v => v.state === 'build' && v.target === b)) {
                const free = vils.filter(v => ['idle', 'gather'].includes(v.state) && [null, 'wood'].includes(this.vil_task(v)));
                if (free.length) {
                    const [cx, cy] = b.center();
                    py.min(free, v => _hyp(v.x - cx, v.y - cy)).cmd_build(b);
                    return;
                }
            }
        }
        if (building_now.filter(b => b.kind !== 'house').length >= Math.max(2, Math.floor(nv / 14))) return;
        let plan = [];
        const castles_want = prof['castles'][age];
        if (count.get('castle') < castles_want) {
            plan.push(['castle', true, null]);          // castle - the first thing in the Castle Age
        }
        // buildings without which the next age cannot be reached - as soon as there are almost enough villagers
        if (1 <= age && age < 3 && nv >= prof['age_vils'][age] - 5) {
            const [need, cnt] = AGE_REQ[AGE_TECHS[age]];
            const have = py.list(need).filter(k => count.get(k));
            if (have.length < cnt) {
                for (const k of ['blacksmith', 'archery_range', 'market', 'stable', 'siege_workshop', 'castle']) {
                    if (py.contains(need, k) && !count.get(k) && p.allows(k)) {
                        plan.push([k, true, null]);
                        break;
                    }
                }
            }
        }
        let tree = this.nearest_node('tree', bx, by);
        const wood_vils = vils.filter(v => this.vil_task(v) === 'wood' && v.target != null);
        const far = wood_vils.filter(v => !this.has_drop_near('wood', ...v.target.center(), 3));
        if (far.length && far.length * 2 >= wood_vils.length && count.get('lumber_camp') < 2 + Math.floor(nv / 10)) {
            tree = far[0].target;
            plan.push(['lumber_camp', nv >= 5, tree]);
        } else if (tree && !this.has_drop_near('wood', ...tree.center(), 3)) {
            plan.push(['lumber_camp', nv >= 5 && count.get('lumber_camp') < 1 + Math.floor(nv / 10), tree]);
        }
        const berries = this.nearest_node('berries', bx, by, 16);
        if (berries && !this.has_drop_near('food', ...berries.center(), 4)) {
            plan.push(['mill', nv >= 7 && count.get('mill') < 2, berries]);
        }
        const gold = this.nearest_node('gold', bx, by);
        if (gold && !this.has_drop_near('gold', ...gold.center(), 4)) {
            plan.push(['mining_camp', nv >= (this.diff >= 2 ? 13 : 11) || age >= 1, gold]);
        } else {
            const gv = vils.filter(v => this.vil_task(v) === 'gold' && v.target != null);
            const gfar = gv.filter(v => !this.has_drop_near('gold', ...v.target.center(), 4));
            if (gfar.length && gfar.length * 2 >= gv.length && count.get('mining_camp') < 4) {
                plan.push(['mining_camp', true, gfar[0].target]);
            }
        }
        const stone = this.nearest_node('stone', bx, by);
        if (stone && !this.has_drop_near('stone', ...stone.center(), 4)) {
            plan.push(['mining_camp', age >= 1 && (nv >= 18 || !!prof['stone_early']), stone]);
        }
        plan.push(['barracks', nv >= 12 && count.get('barracks') < 1, null]);
        if (age >= 1) plan.push(['blacksmith', count.get('blacksmith') < 1 && nv >= 18, null]);
        if (age >= 2) {
            plan.push(['town_center', tc == null, null]);
            plan.push(['siege_workshop', count.get('siege_workshop') < prof['workshops'][age], null]);
            if (nv >= 30 && count.get('town_center') < 1 + prof['tc_extra'][age - 2]) {
                plan.push(['town_center', true, 'far']);
            }
        }
        plan = plan.concat(this.prod_plan(count, nv));
        if (age >= 1) {
            const stone_ok = count.get('castle') >= 1 || p.res['stone'] >= 800 || !prof['castles'][2];
            plan.push(['tower', this.diff >= 1 && !this.tower_done && nv >= 20 && stone_ok, null]);
        }
        if (age >= 2) {
            plan.push(['university', count.get('university') < 1 && nv >= 30, null]);
            plan.push(['monastery', count.get('monastery') < 1 && nv >= 34 && this.diff >= 1, null]);
        }
        let blocked = {};
        let nblk = 0;
        const castle_cost = count.get('castle') < castles_want ? p.cost_of('bld', 'castle') : null;
        for (const [kind, cond, near] of plan) {
            if (!cond) continue;
            const cost = p.cost_of('bld', kind);
            if (!p.afford(cost, !DROPS.includes(kind) ? reserve : null)) {
                if (nblk < 2) {
                    nblk += 1;
                    blocked = cost_add(blocked, cost);
                    this.blocked = blocked;
                    this.blocked_t = this.w.time;
                }
                continue;
            }
            if (kind !== 'castle' && py.get(cost, 'stone') && py.bool(castle_cost) &&
                p.res['stone'] - cost['stone'] < castle_cost['stone']) {
                continue;           // stone is being saved for the castle
            }
            let spot;
            if (near === 'far') {
                spot = this.tc_spot(btx, bty);
            } else if (near != null) {
                spot = this.find_spot(kind, near.tx, near.ty, 1, 6, false);
            } else if (kind === 'tower') {
                spot = this.find_spot(kind, btx, bty, 5, 8);
            } else if (kind === 'castle') {
                const [ex, ey] = this.enemy_dir();
                spot = this.find_spot(kind, Math.trunc(btx + ex * 14), Math.trunc(bty + ey * 14), 0, 6) ||
                    this.find_spot(kind, btx, bty, 5, 16);
            } else {
                spot = this.find_spot(kind, btx, bty, 5, 16);
            }
            if (spot == null && near == null) {
                // the center is crowded (farms, houses, palisade) - go farther out; no room at all - drop the plan
                spot = this.far_spot(kind, btx, bty);
            }
            if (spot) {
                if (kind === 'tower') this.tower_done = true;
                const nb = (near != null && near !== 'far') ? 1 : py.get({ castle: 5, town_center: 4 }, kind, 2);
                this.start_build(kind, spot, vils, nb);
                return;
            }
        }
    }

    far_spot(kind, btx, bty) {
        // A spot away from the center (17-30 tiles); failed searches are not repeated more often than once per 20 s.
        if (this._far_fail === undefined) this._far_fail = {};
        const fs = this._far_fail;
        if (this.w.time < py.get(fs, kind, -99)) return null;
        const spot = this.find_spot(kind, btx, bty, 17, 30);
        if (spot == null) fs[kind] = this.w.time + 20;
        return spot;
    }

    prod_plan(count, nv) {
        // Next production building (barracks/archery range/stable) by army weights.
        const p = this.p, prof = this.prof;
        const age = p.age;
        const total = prof['prod'][age];
        let have = 0;
        for (const k of PROD) have += count.get(k);
        if (age === 0 || have >= total || nv < prof['army_vils'][age] - 6) return [];
        const pref = this.army.prod_pref();
        const opts = PROD.filter(k => BUILDINGS[k]['age'] <= age && p.allows(k));
        if (age >= 1) {
            // in the Feudal Age - at least one archery range and one stable (needed for the Castle Age)
            for (const k of ['archery_range', 'stable']) {
                if (opts.includes(k) && count.get(k) < 1) return [[k, true, null]];
            }
        }
        const best = py.max(opts, k => py.get(pref, k, 0.1) / (1 + count.get(k)));
        return [[best, true, null]];
    }

    tc_spot(btx, bty) {
        // A spot for a new center: near gold/forest, away from the main center.
        const w = this.w;
        const cands = [];
        for (const n of w.nodes) {
            if ((n.kind === 'gold' || n.kind === 'stone' || n.kind === 'tree') && n.alive) {
                const d = _hyp(n.tx - btx, n.ty - bty);
                if (12 <= d && d <= 24 && !this.has_drop_near(n.kind !== 'tree' ? 'gold' : 'wood',
                                                               (n.tx + .5) * TILE, (n.ty + .5) * TILE, 6)) {
                    cands.push([d + (n.kind === 'gold' ? 0 : 4) + random.random() * 3, n]);
                }
            }
        }
        py.sort(cands, t => t[0]);
        for (const [, n] of cands.slice(0, 6)) {
            const spot = this.find_spot('town_center', n.tx, n.ty, 3, 6);
            if (spot) return spot;
        }
        return this.find_spot('town_center', btx, bty, 12, 20);
    }

    nomad_tc(vils) {
        // No center (Nomad map): a spot near gold and berries close to the villagers; everyone builds.
        const w = this.w, p = this.p;
        if (!p.afford(p.cost_of('bld', 'town_center'))) return;
        if (w.time < py.getattr(this, '_tc_try', -1)) return;
        this._tc_try = w.time + 5;
        const cx = py.sum(vils.map(v => v.x)) / vils.length / TILE;        // sum(): compensated, like CPython
        const cy = py.sum(vils.map(v => v.y)) / vils.length / TILE;
        const near = py.min(vils, v => _hyp(v.x / TILE - cx, v.y / TILE - cy));
        const vx = near.x / TILE, vy = near.y / TILE;
        let best = null;
        for (const n of w.nodes) {
            if ((n.kind !== 'gold' && n.kind !== 'berries') || !n.alive) continue;
            const d = _hyp(n.tx - vx, n.ty - vy);
            if (d > 26) continue;
            // right next to gold and berries: the more food and gold nearby, the better
            if (best == null || d < best[0]) best = [d, n];
        }
        const [tx, ty] = best ? [best[1].tx, best[1].ty] : [Math.trunc(vx), Math.trunc(vy)];
        const spot = this.find_spot('town_center', tx, ty, 4, 9) || this.find_spot('town_center', Math.trunc(vx), Math.trunc(vy), 0, 14);
        if (spot) this.start_build('town_center', spot, vils, vils.length);
    }

    start_build(kind, spot, vils, nb) {
        const w = this.w, p = this.p;
        if (!p.pay(p.cost_of('bld', kind))) return;
        const b = w.place_building(kind, this.pid, ...spot);
        const [cx, cy] = b.center();
        const cands = py.sorted(vils.filter(v => v.state !== 'build'), v => [v.state !== 'idle',
                                                                              !['wood', null].includes(this.vil_task(v)),
                                                                              _hyp(v.x - cx, v.y - cy)]);
        for (const v of cands.slice(0, nb)) v.cmd_build(b);
    }

    // ---- army
    train(vils, army, blds, reserve, tc) {
        const w = this.w, p = this.p;
        const econ_ok = vils.length >= this.prof['army_vils'][p.age] || w.time > 2400 || this.threat;
        // techs first; the army saves for the first needed one (no more than SAVE_MAX) instead of spending everything on units
        const goal = this.research(blds, reserve);
        this.goal = goal;
        const own = new py.Counter(army.map(a => line_of(a.kind)));
        // while villagers are few - the army does not eat the food meant for the next villager
        const vres = vils.length < this.max_vils && !this.threat ? { food: 50 } : {};
        // the age reserve holds the army back by only half for the first minute and a half - troops are needed during
        // saving too; after that fully, so the advance is not postponed forever
        if (!py.bool(reserve)) this.save_t = null;
        else if (this.save_t == null) this.save_t = w.time;
        const halve = () => {
            const o = {};
            for (const [k, v] of Object.entries(reserve)) o[k] = py.floordiv(v, 2);
            return o;
        };
        const half = py.bool(reserve) && w.time - this.save_t < 90 ? halve() : reserve;
        let keep = !this.threat ? cost_add(cost_add(half, vres), goal) : {};      // attacked - all resources go to troops
        if (army.length < this.prof['min_army'][p.age]) {
            // the minimum army (pressure, defense) matters more than techs; the age reserve applies by only half
            keep = cost_add(halve(), vres);
        }
        // stone is saved for the castle - the army does not touch it (units hardly cost any stone), and the castle needs no wood either
        if (econ_ok) this.army.train(blds, keep, own);
    }

    research(blds, reserve) {
        // Research one tech if affordable; otherwise return the cost of the one worth saving for.
        const w = this.w, p = this.p;
        // economic basics, then military ones (blacksmith, line upgrades - ai_army.ArmyPlanner.tech_order)
        const eco = ['loom', 'wheelbarrow', 'double_bit', 'horse_collar', 'gold_mining'];
        // military techs - no more often than once per prof['tech_gap'] s (unique ones are unrestricted),
        // otherwise they eat everything and the army buildings sit idle
        const mil_ok = w.time >= this.mtech_t;
        const order = eco.concat(this.army.tech_order(blds).filter(t => mil_ok || py.bool(py.get(TECHS[t], 'civ'))));
        let goal = {};
        for (const name of order) {
            const [ok] = w.tech_state(p, name);
            if (!ok) continue;
            const host = blds.find(b => b.complete && py.get(b.d, 'techs', []).includes(name) && b.queue.length < 2);
            if (host === undefined) continue;
            const cost = p.cost_of('tech', name);
            // line upgrades and unique techs strengthen the army at once - they do not wait for the age reserve
            const civ_t = py.bool(py.get(TECHS[name], 'civ'));
            const need = py.bool(py.get(TECHS[name], 'upgrade')) || civ_t ? cost : cost_add(cost, reserve);
            if (p.afford(need) && (name !== 'loom' || w.time > 120)) {
                p.pay(cost);
                host.queue.push(['tech', name]);
                p.researching.add(name);
                if (!eco.includes(name) && !civ_t) this.mtech_t = w.time + this.prof['tech_gap'][p.age];
                return {};
            }
            if (!py.bool(goal) && (_sumv(cost) <= this.SAVE_MAX || civ_t) && name !== 'loom' &&
                (eco.includes(name) || civ_t || p.age <= 1)) {
                goal = { ...cost };
            }
        }
        return goal;
    }

    pick_target(base) {
        // Attack target: an enemy that allied AIs are already attacking, otherwise the nearest living hostile player.
        const w = this.w;
        const [bx, by] = base.center();
        const cands = w.players.filter(p => w.hostile(this.pid, p.id));
        let alive = cands.filter(p => p.alive);
        if (!alive.length) alive = cands;
        if (!alive.length) return null;
        for (const ai of py.getattr(w, 'ais', [])) {
            if (ai !== this && w.allied(this.pid, ai.pid) && ai.attacking && ai.target != null
                && w.hostile(this.pid, ai.target) && w.players[ai.target].alive) {
                return ai.target;
            }
        }
        return py.min(alive, p => _hyp(w.starts[p.id][0] * TILE - bx, w.starts[p.id][1] * TILE - by)).id;
    }

    nearest_enemy_thing(x, y, buildings_only = false, owner = null) {
        // Nearest hostile unit/building; owner - only that player's.
        const w = this.w;
        const hrow = w.hmat[this.pid];
        let best = null, bd = 1e18;
        if (!buildings_only) {
            for (const u of w.units) {
                if (hrow[u.owner] && (owner == null || u.owner === owner) && !u.naval) {
                    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
                    if (d < bd) {
                        bd = d;
                        best = u;
                    }
                }
            }
        }
        for (const b of w.buildings) {
            if (hrow[b.owner] && (owner == null || b.owner === owner) && !py.get(b.d, 'wall')) {
                const [cx, cy] = b.center();
                const d = (cx - x) ** 2 + (cy - y) ** 2;
                if (d < bd) {
                    bd = d;
                    best = b;
                }
            }
        }
        return best;
    }

    herd(army) {
        const w = this.w;
        const [bx, by] = this.base.center();
        for (const a of w.animals) {
            if (a.kind === 'sheep' && a.owner === this.pid && !a.dead && a.state === 'idle') {
                if (_hyp(a.x - bx, a.y - by) > 5 * TILE) {
                    const x = bx + random.uniform(-2, 2) * TILE;
                    const y = by + 3 * TILE + random.uniform(-1, 1) * TILE;
                    a.cmd_move(x, y);
                }
            }
        }
        // at the start the scout circles the surroundings and collects sheep
        if (w.time < 600) {
            for (const s of army) {
                if (s.kind === 'scout' && s.state === 'idle') {
                    const ang = random.uniform(0, math.tau);
                    const d = random.uniform(8, w.time < 300 ? 20 : 30) * TILE;
                    const x = Math.max(TILE, Math.min((w.W - 2) * TILE, bx + math.cos(ang) * d));
                    const y = Math.max(TILE, Math.min((w.H - 2) * TILE, by + math.sin(ang) * d));
                    s.cmd_move(x, y);
                }
            }
        }
    }

    fight(army, vils) {
        const w = this.w;
        this.herd(army);
        const my_blds = w.buildings.filter(b => b.owner === this.pid && b.kind !== 'farm' && !py.get(b.d, 'wall'));
        const hrow = w.hmat[this.pid];
        // enemies (not ships - those are for the navy and towers, naval_ai) closer than 7 tiles to any own building;
        // candidates come from the unit grid around each building, the order matches w.units
        const R = 7 * TILE;
        const near = new Set();
        const hmask = w.hostile_mask(hrow);
        for (const b of my_blds) {
            const x0 = b.tx * TILE, y0 = b.ty * TILE;
            for (const u of w.units_in_rect(x0 - R, y0 - R, x0 + b.w * TILE + R, y0 + b.h * TILE + R, hmask)) {
                if (!near.has(u) && hrow[u.owner] && !u.naval && b.dist_px(u.x, u.y) < R) near.add(u);
            }
        }
        let threats = near.size ? w.units.filter(u => near.has(u)) : [];
        // a lone scout near the base is no reason to pull the army off an attack
        this.threat = threats.length > 0 && !threats.every(u => u.kind === 'scout');
        if (!this.threat && ['march', 'engage'].includes(this.war.state)) threats = [];
        army = army.filter(a => !(w.time < 600 && a.kind === 'scout' && !threats.length));
        this.war.update(army, vils, threats);
    }
}
py.classattrs(AI, { SAVE_MAX: 900 });   // the army does not save for a tech more expensive than this (sum of resources)
py.register_class(AI, 'ai.AI');

function _sumv(d) {
    return py.sum(Object.values(d));       // sum(d.values()) - compensated float summation like CPython
}
