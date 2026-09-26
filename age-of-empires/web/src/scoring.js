// port of game/scoring.py
// The player score by AoE2 rules (the "Score" achievements screen, the F4 overlay).
//   score(world, pid) -> {total, military, economy, technology, society}   (integers)
//   scores(world)     -> [score(world, pid) for pid]  - in one pass over units and buildings
//   team_scores(world) -> Map{team: the sum of total of living players}
// Formulas: see game/scoring.py.
import * as py from '../runtime/py.js';
import { value } from './stats.js';

export const SOCIETY_KINDS = ['castle', 'wonder'];


export function _values(w) {
    const n = w.players.length;
    const alive_v = new Array(n).fill(0.0);
    const soc_v = new Array(n).fill(0.0);
    for (const u of w.units) {
        if (0 <= u.owner && u.owner < n) alive_v[u.owner] += value(u.kind);
    }
    for (const b of w.buildings) {
        if (0 <= b.owner && b.owner < n && b.complete) {
            if (SOCIETY_KINDS.includes(b.kind)) {
                soc_v[b.owner] += value(b.kind);
            } else {
                alive_v[b.owner] += value(b.kind);
            }
            for (const u of b.garrison) {
                alive_v[b.owner] += value(u.kind);
            }
        }
    }
    return [alive_v, soc_v];
}


export function scores(w) {
    const [alive_v, soc_v] = _values(w);
    const stats = py.getattr(w, 'stats', null);
    const out = [];
    for (const p of w.players) {
        const s = py.bool(stats) ? stats[p.id] : {};
        const mil = 0.2 * (py.get(s, 'killed_value', 0.0) + py.get(s, 'razed_value', 0.0));
        const eco = 0.1 * (py.sum(Object.values(p.res)) + py.get(s, 'trib_sent', 0.0)) + 0.2 * alive_v[p.id];
        let tech_v = py.get(s, 'tech_value');
        if (tech_v == null) {
            tech_v = 0;
            for (const t of p.techs) tech_v += value(t);
        }
        const tech = 0.2 * tech_v + 10 * 100 * py.get(s, 'explored', 0.0);
        const soc = 0.2 * soc_v[p.id];
        const parts = { military: Math.trunc(mil), economy: Math.trunc(eco), technology: Math.trunc(tech), society: Math.trunc(soc) };
        parts['total'] = parts.military + parts.economy + parts.technology + parts.society;
        out.push(parts);
    }
    return out;
}


export function score(w, pid) {
    return scores(w)[pid];
}


/** Map{team: the sum of total of living players} (int keys -> Map). */
export function team_scores(w) {
    const t = new Map();
    const sc = scores(w);
    for (let i = 0; i < Math.min(w.players.length, sc.length); i++) {
        const p = w.players[i];
        if (p.alive) t.set(p.team, (t.has(p.team) ? t.get(p.team) : 0) + sc[i]['total']);
    }
    return t;
}
