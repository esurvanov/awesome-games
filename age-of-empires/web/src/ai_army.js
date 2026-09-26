// port of game/ai_army.py
// AI: army composition (counter units), military techs, siege and monks.
// Used from ai.AI: this.army = new ArmyPlanner(ai). All costs go through Player.cost_of.
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import { TILE, UNITS, TECHS, CIVS, BUILDINGS } from './data.js';
import { unit_tags } from './world.js';

// military techs per age; line upgrades are taken only if the AI trains those lines
export const ARMY_TECHS = [
    // Feudal
    'man_at_arms', 'forging', 'fletching', 'scale_armor', 'padded_archer_armor', 'scale_barding', 'bloodlines',
    // Castle Age
    'crossbowman', 'long_swordsman', 'pikeman', 'elite_skirmisher', 'light_cavalry', 'iron_casting',
    'bodkin_arrow', 'chain_mail', 'chain_barding', 'leather_archer_armor', 'husbandry', 'thumb_ring',
    'ballistics', 'squires', 'sanctity', 'fervor', 'supplies',
    // Imperial
    'chemistry', 'cavalier', 'arbalester', 'two_handed_swordsman', 'capped_ram', 'halberdier', 'blast_furnace',
    'bracer', 'plate_mail', 'plate_barding', 'ring_archer_armor', 'onager', 'champion', 'heavy_cavalry_archer',
    'siege_engineers', 'paladin', 'hussar', 'siege_ram', 'parthian_tactics', 'heavy_camel_rider',
    'illumination', 'heavy_scorpion', 'siege_onager', 'redemption', 'arson',
];
// monastery techs - only when there are already several monks
export const MONK_TECHS = new Set(['sanctity', 'fervor', 'illumination', 'redemption', 'block_printing', 'atonement']);
// how many siege units/monks to keep (by the line's base kind)
export const CAPS = { ram: 3, mangonel: 2, scorpion: 2, bombard_cannon: 2, trebuchet: 3, monk: 3 };

export function line_of(kind) {
    return py.get(UNITS[kind], 'line', kind);
}

export class ArmyPlanner {
    constructor(ai) {
        this.ai = ai;
        this.mix = new py.Counter();
        this.mix_t = -99.0;
        this.order = null;      // (base kind, since when we save) - see train()
        this.ec = null;         // resource shares in army spending (expected_cost), cache
        this.ec_t = -99.0;
    }

    // ---- scouting the enemy composition
    enemy_mix() {
        const w = this.ai.w;
        if (w.time - this.mix_t < 5) return this.mix;
        this.mix_t = w.time;
        const hrow = w.hmat[this.ai.pid];
        const c = new py.Counter();
        for (const u of w.units) {
            if (!hrow[u.owner] || u.cls === 'vil') continue;
            const tags = unit_tags(u.kind);
            c.inc('all');
            if (tags.includes('cav') && !tags.includes('arch')) c.inc('cav');
            if (tags.includes('arch') && !tags.includes('gunpowder')) c.inc('arch');
            if (tags.includes('inf')) c.inc('inf');
            if (tags.includes('spear')) c.inc('spear');
            if (tags.includes('skirm')) c.inc('skirm');
            if (tags.includes('siege')) c.inc('siege');
            if (tags.includes('monk')) c.inc('monk');
        }
        this.mix = c;
        return c;
    }

    weights(own) {
        // Selection weights by the line's base kind. own - Counter of the own army's base lines.
        const p = this.ai.p;
        const age = p.age;
        let m = this.enemy_mix();
        const n = Math.max(4, m.get('all'));
        const cav = m.get('cav') / n, arch = m.get('arch') / n, inf = m.get('inf') / n;
        const spear = m.get('spear') / n, skirm = m.get('skirm') / n;
        const wts = {
            militia: [3.0, 1.5, 1.5, 2.5][age] + 2 * skirm,
            spearman: 0.6 + 7 * cav,
            archer: [3.0, 3.0, 2.6, 2.2][age] * Math.max(0.3, 1 - 2 * skirm),
            skirmisher: 0.4 + 7 * arch,
            cavalry_archer: [0, 0, 1.0, 1.6][age] * Math.max(0.3, 1 - 2 * skirm),
            hand_cannoneer: 1.0 + 5 * inf,
            scout: [2.0, 2.0, 0.6, 0.6][age] + 3 * m.get('monk') / n + 2 * arch,
            knight: 4.0 * Math.max(0.25, 1 - 2.5 * spear),
            camel_rider: 0.4 + 6 * cav,
            ram: 2.0,
            mangonel: 0.6 + 5 * (inf + arch),
            scorpion: 0.5 + 2 * inf,
            bombard_cannon: 1.5,
            trebuchet: 3.0,
            monk: 1.5,
        };
        // civilization: its strengths (CIVS[civ]['ai'] - multipliers; unique units are there too)
        const civd = py.get(CIVS, p.civ, {});
        for (const [k, mm] of Object.entries(py.get(civd, 'ai', {}))) {
            wts[k] = py.get(wts, k, 1.0) * mm;
        }
        // the civilization's unique units are a strength: from the Castle Age on there are noticeably more of them in the army
        for (const k of Object.keys(UNITS)) {
            if (py.get(UNITS[k], 'civ') === p.civ && py.get(UNITS[k], 'line', k) === k) {
                wts[k] = py.get(wts, k, 1.0) * (age >= 2 ? 1.6 : 1.0);
            }
        }
        const caps = { ...CAPS };
        if (age >= 3) {
            // Imperial: trebuchets against enemy castles and towers
            const forts = this.enemy_forts();
            caps['trebuchet'] = this.ai.diff >= 1 ? 2 + Math.min(4, forts) : 2;
            wts['trebuchet'] = py.get(wts, 'trebuchet', 1.0) * (1 + 0.5 * Math.min(4, forts));
            caps['ram'] = this.ai.diff >= 2 ? 5 : 3;
        }
        if (age >= 2 && this.ai.diff >= 1 && own.get('ram') < 2) {
            wts['ram'] = py.get(wts, 'ram', 1.0) * 2.5;        // without a ram the Castle Age wave will not take the center
        }
        for (const [k, cap] of Object.entries(caps)) {
            if (own.get(k) >= cap) wts[k] = 0;
        }
        return wts;
    }

    enemy_forts() {
        const w = this.ai.w;
        const hrow = w.hmat[this.ai.pid];
        // castles, towers and centers - what trebuchets break from afar
        let s = 0;
        for (const b of w.buildings) {
            if (hrow[b.owner] && ['castle', 'keep', 'guard_tower', 'tower', 'bombard_tower', 'town_center'].includes(b.kind)) s += 1;
        }
        return s;
    }

    expected_cost() {
        // Resource shares in expected army spending (by the weights of available lines) - for villager distribution.
        const p = this.ai.p, w = this.ai.w;
        if (w.time - this.ec_t < 15 && py.bool(this.ec)) return this.ec;
        this.ec_t = w.time;
        const wts = this.weights(new py.Counter());
        const tot = new py.Counter();
        for (const [k, wt] of Object.entries(wts)) {
            if (wt <= 0 || !Object.hasOwn(UNITS, k) || !p.allows(k)) continue;
            const cur = p.current(k);
            if (UNITS[cur]['age'] > Math.max(1, p.age)) continue;
            for (const [r, v] of Object.entries(p.cost_of('unit', cur))) tot.inc(r, wt * v);
        }
        const s = py.sum(tot.values()) || 1.0;
        const ec = {};
        for (const [r, v] of tot) ec[r] = v / s;
        this.ec = py.bool(ec) ? ec : { food: 0.5, gold: 0.5 };
        return this.ec;
    }

    prod_pref() {
        // Production building preference: sum of the weights of the lines trained there.
        const p = this.ai.p;
        const wts = this.weights(new py.Counter());
        const out = {};
        for (const b of ['barracks', 'archery_range', 'stable']) {
            let s = 0.0;
            for (const u of py.get(BUILDINGS[b], 'trains', [])) {
                if (p.allows(u, b) && UNITS[p.current(u)]['age'] <= Math.max(1, p.age) && !py.get(UNITS[u], 'civil')) {
                    s += py.get(wts, u, 1.0);
                }
            }
            out[b] = s;
        }
        return out;
    }

    pick(b, opts, own) {
        // What to train in building b from opts (base kinds). None - nothing.
        const p = this.ai.p;
        const w = this.ai.w;
        const wts = this.weights(own);
        opts = opts.filter(o => w.unit_state(p, p.current(o))[0] && py.get(wts, o, 1) > 0);
        if (!opts.length) return null;
        // train() saves for the order; here - from what is affordable
        let ok = opts.filter(o => p.afford(p.cost_of('unit', p.current(o))));
        if (!ok.length) ok = opts;
        return random.choices(ok, ok.map(o => py.get(wts, o, 1)))[0];
    }

    train(blds, keep, own) {
        // Army training. One "order" (a kind picked by weights among all free buildings) is saved for up to 30 s:
        // the other buildings train only if the order is still affordable after them - so expensive units
        // (knights, trebuchets) are not crowded out by cheap ones.
        const p = this.ai.p, w = this.ai.w;
        if (p.pop >= p.cap) return;
        const idle = [];
        for (const b of blds) {
            if (b.complete && !b.queue.length) {
                if (py.get(b.d, 'water')) continue;    // docks belong to the naval part of the AI
                const opts = py.get(b.d, 'trains', []).filter(u => u !== 'villager' && !py.get(UNITS[u], 'civil')
                    && p.allows(u, b.kind) && w.unit_state(p, p.current(u))[0]);
                if (opts.length) idle.push([b, opts]);
            }
        }
        if (!idle.length) return;
        // an idle castle trains the civilization's unique unit (a strength) if affordable, without touching reserves
        for (const entry of idle.slice()) {
            const [b, opts] = entry;
            if (b.kind !== 'castle' || p.pop >= p.cap) continue;
            let uq = opts.filter(u => py.get(UNITS[u], 'civ') === p.civ);
            // in the Imperial Age trebuchets first against castles/towers
            if (p.age >= 3 && opts.includes('trebuchet') && this.enemy_forts() &&
                own.get('trebuchet') < (this.ai.diff >= 1 ? 2 + Math.min(3, this.enemy_forts()) : 1)) {
                uq = ['trebuchet'];
            }
            if (uq.length && own.get(uq[0]) < 40) {
                const c = p.cost_of('unit', p.current(uq[0]));
                if (p.afford(c, keep)) {
                    p.pay(c);
                    b.queue.push(['unit', p.current(uq[0])]);
                    own.inc(uq[0]);
                    idle.splice(idle.indexOf(entry), 1);
                }
            }
        }
        if (!idle.length) return;
        const wts = this.weights(own);
        if (this.order != null && (w.time - this.order[1] > 30 ||
                                   !idle.some(([, o]) => o.includes(this.order[0])))) {
            this.order = null;
        }
        if (this.order == null) {
            const cs = new Set();
            for (const [, o] of idle) for (const u of o) if (py.get(wts, u, 1) > 0) cs.add(u);
            const cands = py.sorted(cs);
            if (!cands.length) return;
            this.order = [random.choices(cands, cands.map(u => py.get(wts, u, 1)))[0], w.time];
        }
        const base = this.order[0];
        const cost = p.cost_of('unit', p.current(base));
        const hent = idle.find(([, o]) => o.includes(base));
        if (hent === undefined) throw new py.StopIteration();
        const host = hent[0];
        let hold;
        if (p.afford(cost, keep)) {
            p.pay(cost);
            host.queue.push(['unit', p.current(base)]);
            own.inc(base);
            this.order = null;
            hold = keep;
        } else {
            hold = {};
            for (const k of new Set([...Object.keys(keep), ...Object.keys(cost)])) {
                hold[k] = py.get(keep, k, 0) + py.get(cost, k, 0);
            }
        }
        for (const [b, opts] of idle) {
            if (b === host || b.queue.length || p.pop >= p.cap) continue;
            const ob = this.pick(b, opts, own);
            if (ob == null) continue;
            const c = p.cost_of('unit', p.current(ob));
            if (p.afford(c, hold)) {
                p.pay(c);
                b.queue.push(['unit', p.current(ob)]);
                own.inc(ob);
            }
        }
    }

    // ---- techs
    tech_order(blds) {
        // Military techs worth researching (in order of importance).
        const p = this.ai.p;
        const trains = new Set();
        for (const b of blds) {
            if (b.complete) for (const u of py.get(b.d, 'trains', [])) trains.add(u);
        }
        // lines that can be trained; upgrades of other lines are not bought
        const lines = new Set();
        for (const k of trains) lines.add(line_of(p.current(k)));
        for (const k of trains) lines.add(line_of(k));
        let monks = 0;
        for (const u of this.ai.w.units) if (u.owner === this.ai.pid && py.get(u.d, 'monk')) monks += 1;
        let out = [];
        for (const t of ARMY_TECHS) {
            const d = py.get(TECHS, t);
            if (d == null || d['age'] > p.age || (MONK_TECHS.has(t) && monks < 2)) continue;
            const up = py.get(d, 'upgrade');
            if (py.bool(up) && !lines.has(line_of(up[0]))) continue;
            out.push(t);
        }
        // line upgrades added by other modules
        const extra = [];
        for (const t of Object.keys(TECHS)) {
            if (py.bool(py.get(TECHS[t], 'upgrade')) && !out.includes(t) && TECHS[t]['age'] <= p.age
                && lines.has(line_of(TECHS[t]['upgrade'][0]))) extra.push(t);
        }
        out = out.concat(extra);
        // the civilization's unique techs (castle) come among the first: they are its strengths
        const uniq = [];
        for (const [t, d] of Object.entries(TECHS)) {
            if (py.get(d, 'civ') === p.civ && !py.bool(py.get(d, 'upgrade')) && d['age'] <= p.age && !out.includes(t)) uniq.push(t);
        }
        out = uniq.concat(out);
        // first the upgrades of lines that are already numerous in the army
        const own = new py.Counter();
        for (const u of this.ai.w.units) if (u.owner === this.ai.pid) own.inc(line_of(u.kind));
        const rank = new Map();
        out.forEach((t, i) => rank.set(t, i));    // later duplicates win, like the dict comprehension

        const key = t => {
            const up = py.get(TECHS[t], 'upgrade');
            return [py.bool(up) && own.get(line_of(up[0])) >= 4 ? 0 : 1, rank.get(t)];
        };
        return py.sorted(out, key);
    }

    // ---- combat: siege and monks
    siege_like(a) {
        return !!(py.bool(py.get(a.d, 'bld_only')) || py.bool(py.get(a.d, 'pack')));
    }

    lead_monks(army) {
        // Monks stay with the army; with full faith they convert the nearest enemies.
        const w = this.ai.w;
        const monks = army.filter(a => py.get(a.d, 'monk'));
        if (!monks.length) return;
        const fighters = army.filter(a => !py.get(a.d, 'monk') && !this.siege_like(a));
        if (!fighters.length) return;
        const cx = py.sum(fighters.map(a => a.x)) / fighters.length;       // sum(): compensated, like CPython
        const cy = py.sum(fighters.map(a => a.y)) / fighters.length;
        const hrow = w.hmat[this.ai.pid];
        for (const m of monks) {
            if (!['idle', 'move'].includes(m.state)) continue;
            if (w.time >= m.faith_t) {
                let best = null, bd = (12 * TILE) ** 2;
                for (const u of w.units) {
                    if (hrow[u.owner] && (u.x - m.x) ** 2 + (u.y - m.y) ** 2 < bd && w.convertible(m, u)) {
                        bd = (u.x - m.x) ** 2 + (u.y - m.y) ** 2;
                        best = u;
                    }
                }
                if (best != null) {
                    m.cmd_attack(best);
                    continue;
                }
            }
            if (m.state === 'idle' && math.hypot(m.x - cx, m.y - cy) > 4 * TILE) {
                const x = cx + random.uniform(-30, 30);
                const y = cy + random.uniform(-30, 30);
                m.cmd_move(x, y);
            }
        }
    }
}
py.register_class(ArmyPlanner, 'ai_army.ArmyPlanner');
