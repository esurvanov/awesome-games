// port of game/naval_ai.py
// AI on water: a dock, fishing ships, a war fleet, shelling the shore, landings on islands.
//
// Attached to the regular AI (game/ai.py) only on water maps (World.map_type != 'land'):
//   update(...)   - every half second: docks, ships, dock techs, the behavior of the fleet and transports;
//   shore_fish(v) - shore fish for a villager (food next to a storage);
//   ferry_mode()  - whether the army must be ferried by sea (the enemy is on another island);
//   offense(army) - an offensive across water instead of a land one (boarding -> crossing -> landing -> combat).
//
// The Python id(transport)-keyed `ferry` dict is a Map keyed by the transport object itself.
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import { TILE, UNITS, TECHS } from './data.js';
import { Building } from './world.js';
import * as naval from './naval.js';

export class NavalAI {
    constructor(ai) {
        this.ai = ai;
        this.w = ai.w;
        this.pid = ai.pid;
        this.p = ai.p;
        this.dock_t = 0.0;
        this.home_lc = null;
        this.sea = null;
        this.raid = null;
        this.raid_t = 0.0;
        this.ferry = new Map();     // transport -> [state, squad, time]
        this.ferry_t = -99.0;
        this.ferry_need = false;
        this.wave = [];
    }

    // ---- geography
    geo(base) {
        const w = this.w;
        if (this.home_lc == null) {
            const [bx, by] = base.center();
            this.home_lc = naval.land_comp(w, Math.floor(bx / TILE), Math.floor(by / TILE));
            const wsize = naval.comps(w)[2];
            const seas = new Map();
            for (const [lx, ly, wx, wy, lc, wc] of naval.shores(w)) {
                if (lc === this.home_lc) seas.set(wc, (seas.has(wc) ? seas.get(wc) : 0) + 1);
            }
            this.sea = seas.size ? py.max(seas.keys(), c => py.get(wsize, c, 0)) : null;
            if (this.sea != null && py.get(wsize, this.sea, 0) < 60) this.sea = null;
        }
    }

    my_lc(u) {
        return naval.land_comp(this.w, Math.floor(u.x / TILE), Math.floor(u.y / TILE));
    }

    // ---- main step
    update(vils, ships, blds, reserve, tc) {
        const w = this.w;
        const base = this.ai.base;
        this.geo(base);
        if (this.sea == null) return;
        const docks = blds.filter(b => b.kind === 'dock');
        const ready = docks.filter(b => b.complete);
        this.build_docks(vils, docks, reserve);
        if (!ready.length) return;
        const fishers = ships.filter(s => py.get(s.d, 'fisher'));
        const navy = ships.filter(s => s.d['atk'] > 0);
        const transports = ships.filter(s => s.cargo_cap() > 0);
        this.train(ready, fishers, navy, transports, vils, reserve);
        this.research(ready, fishers, navy, reserve);
        for (const s of fishers) {
            if (s.state === 'idle') {
                const d = ready[0];
                const f = naval.find_fish(w, s, ...d.center(), 70);
                if (f != null) s.cmd_gather(f);
            }
        }
        this.fleet(navy, ready);
        for (const s of transports) {
            if (!this.ferry.has(s) && s.state === 'idle' && !py.bool(s.cargo) && random.random() < 0.05) {
                const [dx, dy] = ready[0].center();
                if (math.hypot(s.x - dx, s.y - dy) > 6 * TILE) {
                    const x = dx + random.uniform(-40, 40);
                    const y = dy + random.uniform(-40, 40);
                    s.cmd_move(x, y);
                }
            }
        }
    }

    // ---- docks
    build_docks(vils, docks, reserve) {
        const w = this.w, p = this.p;
        const nv = vils.length;
        let want = 0;
        if (nv >= 7) want = 1;
        if (p.age >= 2 && this.ai.diff >= 1 && nv >= 22) want = 2;
        if (docks.length >= want || docks.some(b => !b.complete) || w.time < this.dock_t) return;
        const cost = p.cost_of('bld', 'dock');
        if (!p.afford(cost, docks.length ? reserve : null)) return;
        this.dock_t = w.time + 8;
        const spot = this.dock_spot(docks);
        if (spot) this.ai.start_build('dock', spot, vils, !docks.length ? 2 : 1);
    }

    dock_spot(docks) {
        const w = this.w;
        const [bx, by] = this.ai.base.center();
        const btx = bx / TILE, bty = by / TILE;
        const cands = [];
        for (const [lx, ly, wx, wy, lc, wc] of naval.shores(w)) {
            if (lc === this.home_lc && wc === this.sea && w.passable(lx, ly)) {
                cands.push([math.hypot(lx - btx, ly - bty), lx, ly, wx, wy]);
            }
        }
        py.sort(cands);
        for (const [d, lx, ly, wx, wy] of cands.slice(0, 160)) {
            if (d < 6) continue;
            if (docks.some(o => math.hypot(o.tx - wx, o.ty - wy) < 10)) continue;
            for (let tx = wx - 2; tx < wx + 1; tx++) {
                for (let ty = wy - 2; ty < wy + 1; ty++) {
                    if (w.can_place('dock', tx, ty, this.pid, false)) return [tx, ty];
                }
            }
        }
        return null;
    }

    // ---- training
    train(ready, fishers, navy, transports, vils, reserve) {
        const w = this.w, p = this.p;
        if (p.pop >= p.cap) return;
        const free = ready.filter(d => d.queue.length < 2);
        if (!free.length) return;
        const queued = {};
        for (const d of ready) {
            for (const [kind, name] of d.queue) {
                if (kind === 'unit') queued[name] = py.get(queued, name, 0) + 1;
            }
        }
        let comp_fish = 0;
        for (const n of w.nodes) {
            if (n.alive && naval.FISH.includes(n.kind) && naval.fish_reachable(w, n, this.sea)) comp_fish += 1;
        }
        const want_f = Math.min(comp_fish, [5, 8, 10, 10][p.age] + this.ai.diff);
        const nf = fishers.length + py.get(queued, 'fishing_ship', 0);
        const dock = py.min(free, d => d.queue.length);
        // a transport - if the army has to be carried (after the first fishers - earlier than new fishers)
        if (this.ferry_need && (nf >= 4 || p.age >= 1)) {
            const nt = transports.length + py.get(queued, 'transport_ship', 0);
            if (nt < Math.min(3, 1 + Math.floor(Math.max(this.wave.length, this.ai.wave) / 6))) {
                const cost = p.cost_of('unit', 'transport_ship');
                if (p.afford(cost)) {
                    p.pay(cost);
                    dock.queue.push(['unit', 'transport_ship']);
                    return;
                }
            }
        }
        if (nf < want_f) {
            const cost = p.cost_of('unit', 'fishing_ship');
            if (p.afford(cost, vils.length >= this.ai.age_need ? reserve : null)) {
                p.pay(cost);
                dock.queue.push(['unit', 'fishing_ship']);
                return;
            }
        }
        if (p.age < 1 || vils.length < 14) return;
        const hrow = w.hmat[this.pid];
        const enemy_navy = w.units.filter(u => hrow[u.owner] && u.naval && u.d['atk'] > 0);
        let want_n = Math.trunc([0, 5, 9, 14][p.age] * [0.6, 1.0, 1.3][this.ai.diff]) + Math.floor(enemy_navy.length / 2);
        if (this.ferry_need) want_n = Math.max(3, Math.floor(want_n / 2));
        let nn = navy.length;
        for (const [k, v] of Object.entries(queued)) if (UNITS[k]['atk'] > 0) nn += v;
        if (nn >= Math.min(want_n, 30)) return;
        const opts = py.get(dock.d, 'trains', []).filter(u => UNITS[u]['atk'] > 0 && UNITS[p.current(u)]['age'] <= p.age
            && p.allows(u) && p.allows(p.current(u)));
        if (!opts.length) return;
        let galleys = 0;
        for (const u of enemy_navy) if (u.kind.includes('galley') || u.kind === 'galleon') galleys += 1;
        const weights = {
            galley: 4, fire_galley: 1 + galleys * 0.4, demolition_ship: 0.4 + galleys * 0.1,
            cannon_galleon: 2.0,
        };
        const pick = p.current(random.choices(opts, opts.map(o => py.get(weights, o, 1)))[0]);
        const cost = p.cost_of('unit', pick);
        if (p.afford(cost, reserve)) {
            p.pay(cost);
            dock.queue.push(['unit', pick]);
        }
    }

    research(ready, fishers, navy, reserve) {
        const w = this.w, p = this.p;
        const order = [];
        if (fishers.length >= 4) order.push('gillnets');
        if (navy.length >= 4) order.push('careening', 'dry_dock');
        if (fishers.length >= 6 && p.age >= 3) order.push('shipwright');
        for (const name of order) {
            if (!Object.hasOwn(TECHS, name)) continue;
            const [ok] = w.tech_state(p, name);
            if (!ok) continue;
            const host = ready.find(d => py.get(d.d, 'techs', []).includes(name) && d.queue.length < 2);
            if (host === undefined) continue;
            const cost = p.cost_of('tech', name);
            if (p.afford(cost, reserve)) {
                p.pay(cost);
                host.queue.push(['tech', name]);
                p.researching.add(name);
                return;
            }
        }
    }

    // ---- fleet
    fleet(navy, ready) {
        const w = this.w;
        if (!navy.length) return;
        const hrow = w.hmat[this.pid];
        const sea = this.sea;
        const enemy_ships = w.units.filter(u => hrow[u.owner] && u.naval && u.alive
                                                && naval.water_comp(w, ...u.tile()) === sea);
        const mine = w.units.filter(s => s.owner === this.pid && s.naval && s.d['atk'] <= 0);
        // protect the docks, transports with people and fishers (no more than 6)
        const my_stuff = ready.map(d => d.center())
            .concat(mine.filter(s => py.bool(s.cargo) || this.ferry.has(s)).map(s => [s.x, s.y]))
            .concat(mine.filter(s => py.get(s.d, 'fisher')).map(s => [s.x, s.y]).slice(0, 6));
        // threats: enemy ships near our docks / fishers
        const threats = enemy_ships.filter(e => my_stuff.some(([x, y]) => math.hypot(e.x - x, e.y - y) < 12 * TILE));
        if (w.time >= this.raid_t || (this.raid != null && !this.raid.alive)) {
            this.raid_t = w.time + 10;
            this.raid = this.pick_raid(navy, enemy_ships, ready);
        }
        const strong = navy.length >= [3, 4, 5][this.ai.diff] + (this.p.age >= 2 ? 1 : 0);
        for (const s of navy) {
            if (s.state === 'attack' && s.target != null && s.target.alive) {
                if (!py.getattr(s.target, 'naval', false) && threats.length && !py.get(s.d, 'siege')) {
                    // strike the shore, but our own ships are in danger - the threat first
                    s.cmd_attack(py.min(threats, e => (e.x - s.x) ** 2 + (e.y - s.y) ** 2));
                }
                continue;
            }
            if (threats.length && !py.get(s.d, 'siege')) {
                s.cmd_attack(py.min(threats, e => (e.x - s.x) ** 2 + (e.y - s.y) ** 2));
            } else if (strong && this.raid != null && this.raid.alive) {
                s.cmd_attack(this.raid);
            } else if (s.state === 'idle') {
                const [dx, dy] = ready[0].center();
                const [gx, gy] = this.guard_point(dx, dy);
                if (math.hypot(s.x - gx, s.y - gy) > 4 * TILE) {
                    const x = gx + random.uniform(-50, 50);
                    const y = gy + random.uniform(-50, 50);
                    s.cmd_move(x, y);
                }
            }
        }
    }

    guard_point(dx, dy) {
        // A point at sea in front of the dock (toward the center of the body of water).
        const w = this.w;
        const tx = Math.floor(dx / TILE), ty = Math.floor(dy / TILE);
        let best = naval.nearest_water_tile(w, tx, ty, undefined, this.sea, true);
        const mx = w.W / 2, my = w.H / 2;
        const ang = math.atan2(my - ty, mx - tx);
        for (const d of [6, 5, 4, 3]) {
            const x = Math.trunc(tx + math.cos(ang) * d), y = Math.trunc(ty + math.sin(ang) * d);
            if (naval.water_free(w, x, y) && naval.water_comp(w, x, y) === this.sea) {
                best = [x, y];
                break;
            }
        }
        return [(best[0] + 0.5) * TILE, (best[1] + 0.5) * TILE];
    }

    pick_raid(navy, enemy_ships, ready) {
        // Raid target: enemy ships, then docks, then buildings by the water within reach.
        const w = this.w;
        const [dx, dy] = ready[0].center();
        if (enemy_ships.length) return py.min(enemy_ships, e => (e.x - dx) ** 2 + (e.y - dy) ** 2);
        const hrow = w.hmat[this.pid];
        const probe = py.max(navy, s => s.rng_tiles());
        const blds = w.buildings.filter(b => hrow[b.owner] && b.alive && b.kind !== 'farm');
        py.sort(blds, b => [!py.get(b.d, 'water'), (b.center()[0] - dx) ** 2 + (b.center()[1] - dy) ** 2]);
        for (const b of blds.slice(0, 40)) {
            if (naval.can_reach(w, probe, b)) return b;
        }
        return null;
    }

    adjust_want(want, nv) {
        let fishers = 0;
        for (const u of this.w.units) if (u.owner === this.pid && u.naval && py.get(u.d, 'fisher')) fishers += 1;
        if (nv > 0 && fishers) {
            const shift = Math.min(want['food'] * 0.6, fishers * 0.8 / nv);
            want['food'] -= shift;
            want['wood'] += shift;
        }
        // the fleet and transports eat wood: excess gold - into the forest
        if (this.p.res['gold'] > 400 && this.p.res['wood'] < 300) {
            const shift = want['gold'] * 0.5;
            want['gold'] -= shift;
            want['wood'] += shift;
        }
    }

    // ---- villagers by the shore
    shore_fish(v, bx, by) {
        const w = this.w;
        const n = w.find_resource(v, 'shore_fish', bx, by, 18);
        if (n == null || !this.ai.has_drop_near('food', ...n.center(), 5)) return null;
        let k = 0;
        for (const o of w.units) if (o.target === n) k += 1;
        if (k >= 2) return null;
        return n;
    }

    // ---- landings
    ferry_mode() {
        // The enemy is unreachable by land - the army must be ferried (recomputed every 10 s).
        const w = this.w;
        if (w.time - this.ferry_t < 10) return this.ferry_need;
        this.ferry_t = w.time;
        if (this.home_lc == null || this.sea == null) {
            this.ferry_need = false;
            return false;
        }
        const hrow = w.hmat[this.pid];
        const tgt = this.ai.target;
        let reach = false;
        for (const b of w.buildings) {
            if (hrow[b.owner] && (tgt == null || b.owner === tgt)) {
                const cx = b.tx + Math.floor(b.w / 2), cy = b.ty + Math.floor(b.h / 2);
                for (const [x, y] of [[b.tx - 1, cy], [b.tx + b.w, cy], [cx, b.ty - 1], [cx, b.ty + b.h]]) {
                    if (naval.land_comp(w, x, y) === this.home_lc) {
                        reach = true;
                        break;
                    }
                }
            }
            if (reach) break;
        }
        this.ferry_need = !reach;
        return this.ferry_need;
    }

    enemy_goal() {
        // Where to land: the target's main center (or any building).
        const w = this.w;
        const hrow = w.hmat[this.pid];
        const tgt = this.ai.target;
        let blds = w.buildings.filter(b => hrow[b.owner] && (tgt == null || b.owner === tgt));
        if (!blds.length) blds = w.buildings.filter(b => hrow[b.owner]);
        if (!blds.length) return null;
        const tc = blds.filter(b => b.kind === 'town_center');
        return (tc.length ? tc : blds)[0];
    }

    offense(army) {
        const w = this.w, ai = this.ai;
        const home = [], landed = [];
        for (const a of army) (this.my_lc(a) === this.home_lc ? home : landed).push(a);
        // those who landed - into combat on the spot
        for (const a of landed) {
            const busy = a.state === 'attack' && a.target != null && a.target.alive &&
                !py.getattr(a.target, 'naval', false);
            if (!busy && !py.bool(a.pending) && a.state !== 'move') {
                const t = this.nearest_enemy_on(a, this.my_lc(a));
                if (t != null) a.cmd_attack(t);
            }
        }
        // a wave: as soon as enough have gathered at home - carry everyone while there is someone at home to carry
        if (!this.wave.length) {
            if (w.time >= ai.first_attack && home.length >= ai.wave) {
                ai.wave = Math.min(ai.wave + 4, 40);
                this.wave = home.slice();
            }
        } else {
            const add = home.filter(a => !this.wave.includes(a));
            this.wave = this.wave.concat(add);
        }
        ai.attacking = !!(this.wave.length || landed.length);
        if (!this.wave.length) return;
        const goal = this.enemy_goal();
        this.wave = this.wave.filter(a => a.alive || py.getattr(a, 'aboard', null) != null);
        const transports = w.units.filter(s => s.owner === this.pid && s.naval && s.cargo_cap() > 0);
        const waiting = this.wave.filter(a => a.alive && this.my_lc(a) === this.home_lc);
        const assigned = new Set();
        for (const st of this.ferry.values()) for (const u of st[1]) assigned.add(u);
        for (const s of transports) {
            let st = this.ferry.has(s) ? this.ferry.get(s) : null;
            if (st == null) {
                if (py.bool(s.cargo)) {
                    st = ['load', py.list(s.cargo), w.time - 100];
                    this.ferry.set(s, st);
                } else {
                    const group = waiting.filter(a => !assigned.has(a)).slice(0, s.cargo_cap());
                    if (!group.length || goal == null) continue;
                    if (naval.order_board(w, group, s)) {
                        this.ferry.set(s, ['load', group, w.time]);
                        for (const a of group) assigned.add(a);
                    }
                    continue;
                }
            }
            const [state, group, t0] = st;
            if (state === 'load') {
                if (w.time - t0 > 12 && py.mod(Math.trunc(w.time * 2), 20) === 0) {
                    // those who got distracted (combat, a crowd) - to the transport again
                    const lost = group.filter(a => a.alive && a.state === 'idle' && !s.to_load.includes(a));
                    if (lost.length) {
                        naval.order_board(w, lost.concat(s.to_load.filter(a => a.alive)), s);
                    }
                }
                let boarded = 0, alive = 0;
                for (const a of group) if (py.getattr(a, 'aboard', null) === s) boarded += 1;
                for (const a of group) if (a.alive || py.getattr(a, 'aboard', null) === s) alive += 1;
                if (py.bool(s.cargo) && (boarded >= alive || w.time - t0 > 50)) {
                    if (goal == null) continue;
                    s.to_load = [];
                    s.cmd_unload(...goal.center());
                    st[0] = 'sail';
                    st[2] = w.time;
                } else if (!py.bool(s.cargo) && w.time - t0 > 50) {
                    this.ferry.delete(s);
                }
            } else if (state === 'sail') {
                if (!py.bool(s.cargo)) {
                    st[0] = 'back';
                    st[2] = w.time;
                    const d = w.buildings.find(b => b.owner === this.pid && b.kind === 'dock' && b.complete) ?? null;
                    if (d != null) s.cmd_move(...d.center());
                } else if (s.state === 'idle' || w.time - st[2] > 150) {
                    if (goal != null) {
                        s.cmd_unload(...goal.center());
                        st[2] = w.time;
                    }
                }
            } else if (state === 'back') {
                if (s.state === 'idle' || w.time - st[2] > 90) this.ferry.delete(s);
            }
        }
        const tset = new Set(transports);
        for (const k of Array.from(this.ferry.keys()).filter(k => !tset.has(k))) this.ferry.delete(k);
        // the wave is over: everyone was carried off (or died), nobody on the way
        if (waiting.length < 3 && !Array.from(this.ferry.values()).some(st => ['load', 'sail'].includes(st[0]))) {
            this.wave = [];
        }
    }

    nearest_enemy_on(a, lc) {
        const w = this.w;
        const hrow = w.hmat[this.pid];
        let best = null, bd = 1e18;
        for (const u of w.units) {
            if (hrow[u.owner] && !u.naval && naval.land_comp(w, Math.floor(u.x / TILE), Math.floor(u.y / TILE)) === lc) {
                const d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2;
                if (d < bd) {
                    bd = d;
                    best = u;
                }
            }
        }
        if (best != null && bd < (10 * TILE) ** 2) return best;
        for (const b of w.buildings) {
            if (!hrow[b.owner] || !(b instanceof Building) || py.get(b.d, 'water')) continue;
            if (naval.land_comp(w, b.tx, b.ty) !== lc) continue;
            const [cx, cy] = b.center();
            const d = (cx - a.x) ** 2 + (cy - a.y) ** 2;
            if (d < bd) {
                bd = d;
                best = b;
            }
        }
        return best;
    }
}
py.register_class(NavalAI, 'naval_ai.NavalAI');
