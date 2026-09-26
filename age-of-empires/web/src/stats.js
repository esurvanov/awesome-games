// port of game/stats.py
// Match statistics for the achievements screen (6 tabs) and the score (game/scoring.py).
//
// World keeps w.stats - a list of dicts, one per player (see new_stats). The world calls the hooks:
//   on_death(w, target, attacker, is_building) - a unit was killed / a building destroyed
//   on_convert(w, unit, old, new)   - a monk converted a unit
//   on_tech(w, p, name)             - a tech was researched (ages - with a timestamp)
//   on_complete(w, b)               - a building was completed (castles are counted)
//   on_tribute(w, frm, to, amt)     - tribute (market.tribute), on_trade(w, pid, gold) - trade income
//   tick(w, dt)                     - every 30 s - a sample for the "Timeline" graph, every 5 s - exploration
import * as py from '../runtime/py.js';
import { UNITS, BUILDINGS, TECHS, AGE_TECHS, TILE } from './data.js';

export const SAMPLE = 30.0;           // the graph sampling period, game seconds
export const EXPLORE_T = 5.0;
export const CELL = 4;                // a cell of the exploration grid (in map tiles)

export function new_stats() {
    return {
        'kills': 0, 'losses': 0, 'razed': 0, 'bld_lost': 0, 'converted': 0, 'lost_conv': 0,
        'killed_value': 0.0, 'razed_value': 0.0, 'army_max': 0, 'vil_max': 0, 'pop_max': 0,
        'trib_sent': 0.0, 'trib_recv': 0.0, 'trade': 0.0, 'tech_value': 0.0, 'techs': 0,
        'age_t': [0.0, null, null, null], 'castles': 0, 'explored': 0.0, 'samples': [],
        'defeat_t': null,
    };
}

/** The resource cost of a unit/building/tech kind (the sum of the price). */
export function value(kind) {
    const d = py.or_(py.get(UNITS, kind, null), py.get(BUILDINGS, kind, null), py.get(TECHS, kind, null), {});
    let s = 0;
    for (const v of py.values(py.or_(py.get(d, 'cost', null), {}))) s += v;
    return s;
}

export function init(w) {
    w.stats = w.players.map(() => new_stats());
    w.stats_t = 0.0;
    w.explore_t = 0.0;
    const cw = Math.floor((w.W + CELL - 1) / CELL), ch = Math.floor((w.H + CELL - 1) / CELL);
    w.explore_grid = w.players.map(() => new Uint8Array(cw * ch));
    sample(w);
}

export function _st(w, pid) {
    const st = py.getattr(w, 'stats', null);
    if (st == null || !(0 <= pid && pid < st.length)) return null;
    return st[pid];
}

export function on_death(w, target, attacker, is_b) {
    const to = target.owner;
    const ao = py.getattr(attacker, 'owner', -1);
    const v = value(target.kind);
    const s = _st(w, to);
    if (s != null) {
        if (is_b) s['bld_lost'] += 1;
        else s['losses'] += 1;
    }
    if (ao != null && ao >= 0 && ao !== to && to >= 0) {
        const a = _st(w, ao);
        if (a != null && !w.allied(ao, to)) {
            if (is_b) {
                a['razed'] += 1;
                a['razed_value'] += v;
            } else {
                a['kills'] += 1;
                a['killed_value'] += v;
            }
        }
    }
}

export function on_convert(w, unit, old, new_) {
    const a = _st(w, new_), b = _st(w, old);
    if (a != null) {
        a['converted'] += 1;
        a['killed_value'] += value(unit.kind);
    }
    if (b != null) b['lost_conv'] += 1;
}

export function on_tech(w, p, name) {
    const s = _st(w, p.id);
    if (s == null) return;
    s['techs'] += 1;
    s['tech_value'] += value(name);
    if (AGE_TECHS.includes(name)) {
        const i = AGE_TECHS.indexOf(name) + 1;
        if (s['age_t'][i] == null) s['age_t'][i] = w.time;
    }
}

export function on_complete(w, b) {
    const s = _st(w, b.owner);
    if (s != null && b.kind === 'castle') s['castles'] += 1;
}

export function on_tribute(w, frm, to, amt) {
    const a = _st(w, frm), b = _st(w, to);
    if (a != null) a['trib_sent'] += amt;
    if (b != null) b['trib_recv'] += amt;
}

export function on_trade(w, pid, gold) {
    const s = _st(w, pid);
    if (s != null) s['trade'] += gold;
}

export function on_defeat(w, pid) {
    const s = _st(w, pid);
    if (s != null && s['defeat_t'] == null) s['defeat_t'] = w.time;
}

export function tick(w, dt) {
    if (py.getattr(w, 'stats', null) == null) return;
    w.stats_t += dt;
    w.explore_t += dt;
    if (w.explore_t >= EXPLORE_T) {
        w.explore_t = 0.0;
        explore(w);
    }
    if (w.stats_t >= SAMPLE) {
        w.stats_t -= SAMPLE;
        sample(w);
    }
}

/** {pid: (population, army, villagers)} over living units. */
export function counts(w) {
    const n = w.players.length;
    const pop = new Array(n).fill(0);
    const army = new Array(n).fill(0);
    const vils = new Array(n).fill(0);
    for (const u of w.units) {
        const o = u.owner;
        if (0 <= o && o < n) {
            pop[o] += 1;
            if (u.kind === 'villager') vils[o] += 1;
            else if (!py.bool(py.get(u.d, 'civil', null))) army[o] += 1;
        }
    }
    for (const b of w.buildings) {
        for (const u of b.garrison) {
            if (0 <= b.owner && b.owner < n) {
                pop[b.owner] += 1;
                if (u.kind === 'villager') vils[b.owner] += 1;
            }
        }
    }
    return [pop, army, vils];
}

export function sample(w) {
    const [pop, army, vils] = counts(w);
    w.stats.forEach((s, pid) => {
        s['samples'].push([py.round(w.time, 1), pop[pid], army[pid], vils[pid]]);
        s['army_max'] = Math.max(s['army_max'], army[pid]);
        s['vil_max'] = Math.max(s['vil_max'], vils[pid]);
        s['pop_max'] = Math.max(s['pop_max'], pop[pid]);
    });
}

function _sum(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
}

/** The explored share of the map per player (a coarse CELL x CELL grid by the view of units and buildings). */
export function explore(w) {
    const cw = Math.floor((w.W + CELL - 1) / CELL);
    const ch = Math.floor((w.H + CELL - 1) / CELL);
    const grids = w.explore_grid;
    const seen = new Set();
    for (const e of w.units) {
        const o = e.owner;
        if (!(0 <= o && o < grids.length)) continue;
        const cx = Math.floor(Math.floor(e.x / TILE) / CELL), cy = Math.floor(Math.floor(e.y / TILE) / CELL);
        const r = Math.floor(Math.trunc(e.los()) / CELL) + 1;
        const key = o + ',' + cx + ',' + cy + ',' + r;
        if (seen.has(key)) continue;
        seen.add(key);
        const g = grids[o];
        for (let y = Math.max(0, cy - r); y < Math.min(ch, cy + r + 1); y++) {
            const a = y * cw;
            const x0 = Math.max(0, cx - r), x1 = Math.min(cw - 1, cx + r);
            if (x1 >= x0) g.fill(1, a + x0, a + x1 + 1);
        }
    }
    w.stats.forEach((s, pid) => {
        const explored = py.getattr(w, 'explored', null);
        if (pid === w.human && explored != null) {
            s['explored'] = _sum(explored) / Math.max(1, explored.length);
        } else {
            const g = grids[pid];
            s['explored'] = _sum(g) / Math.max(1, g.length);
        }
    });
}
