// port of game/ai_defense.py
// Computer player defense: palisade around the base (hard level), town bell, garrison,
// university and tower/wall techs when resources are plentiful.
//
// AI.update calls tick() twice a second. The wall ring always has gates on every side
// (or a gap if a gate did not fit) - the AI never locks itself in.
// Breaching enemy walls is done by the units themselves (defense.breach_target from Unit.approach).
import * as py from '../runtime/py.js';
import { math } from '../runtime/py.js';
import { TILE, BUILDINGS } from './data.js';
import * as defense from './defense.js';

export const RING_R = 11;                 // "radius" (Chebyshev) of the palisade ring around the center
export const BELL_R = 9 * TILE;           // enemies closer than this are a reason for the town bell
export const CLEAR_T = 15.0;              // how many seconds of quiet before "All clear"

export function state(ai) {
    let st = py.getattr(ai, '_def', null);
    if (st == null) {
        st = ai._def = { ring: null, side: 0, bell_t: 0.0, quiet: 0.0, uni_t: 0.0 };
    }
    return st;
}

export function tick(ai, vils, army, blds, tc, count) {
    const st = state(ai);
    const threats = tc != null ? enemies_near(ai, tc, BELL_R) : [];
    bell(ai, st, vils, army, tc, threats);
    shelter_archers(ai, army, threats);
    if (ai.diff >= 2 && tc != null) palisade_ring(ai, st, vils, tc);
    research(ai, blds, count, vils);
}

// ---- town bell
export function enemies_near(ai, b, r) {
    const w = ai.w;
    const hrow = w.hmat[ai.pid];
    const x0 = b.tx * TILE, y0 = b.ty * TILE;
    const near = new Set();
    for (const u of w.units_in_rect(x0 - r, y0 - r, x0 + b.w * TILE + r, y0 + b.h * TILE + r,
                                    w.hostile_mask(hrow))) {
        if (hrow[u.owner] && u.cls !== 'vil' && u.kind !== 'scout' && b.dist_px(u.x, u.y) < r) near.add(u);
    }
    return near.size ? w.units.filter(u => near.has(u)) : [];
}

export function bell(ai, st, vils, army, tc, threats) {
    const w = ai.w, p = ai.p;
    if (tc == null) {
        if (py.getattr(p, 'bell', false)) defense.all_clear(w, ai.pid);
        return;
    }
    const ringing = py.getattr(p, 'bell', false);
    if (!ringing) {
        let defenders = 0;
        for (const a of army) if (tc.dist_px(a.x, a.y) < BELL_R + 3 * TILE) defenders += 1;
        const hurt = vils.some(v => tc.dist_px(v.x, v.y) < BELL_R + 4 * TILE && w.time - v.hit_t < 3);
        if (threats.length >= 3 && hurt && defenders < threats.length) {
            defense.ring_bell(w, ai.pid);
            st['quiet'] = 0.0;
        }
        return;
    }
    if (threats.length) {
        st['quiet'] = 0.0;
        // new villagers hide too
        for (const v of vils) {
            if (v.state !== 'garrison' && py.getattr(v, 'bell_task', null) == null) {
                v.bell_task = defense.snapshot(v);
                const b = best_shelter(w, ai.pid, v);
                if (b != null) v.cmd_garrison(b);
            }
        }
    } else {
        st['quiet'] += 0.5;
        if (st['quiet'] >= CLEAR_T) defense.all_clear(w, ai.pid);
    }
}

export function best_shelter(w, pid, u) {
    const cands = py.list(defense.garrison_buildings(w, pid, u.cls)).filter(b => py.len(b.garrison) < defense.capacity(b));
    if (!cands.length) return null;
    return py.min(cands, b => u.dist_to(b));
}

export function shelter_archers(ai, army, threats) {
    // Ranged units garrison in towers/center when the enemy heavily outnumbers them - they shoot from there.
    if (!threats.length || threats.length < 2 * Math.max(1, army.length)) return;
    const w = ai.w;
    for (const a of army) {
        if (a.cls !== 'arch' || a.state === 'garrison') continue;
        const b = best_shelter(w, ai.pid, a);
        if (b != null && a.dist_to(b) < 8 * TILE) a.cmd_garrison(b);
    }
}

// ---- palisade ring
export function ring_plan(ai, tc) {
    // The 4 sides of the square around the center: (wall line, gate in the middle).
    const cx = tc.tx + Math.floor(tc.w / 2), cy = tc.ty + Math.floor(tc.h / 2);
    const R = RING_R;
    const x0 = cx - R, y0 = cy - R, x1 = cx + R, y1 = cy + R;
    const sides = [];
    // (start, end, gate horizontal?, gate tile)
    sides.push([[x0, y0], [x1, y0], true, [cx - 2, y0]]);
    sides.push([[x1, y0], [x1, y1], false, [x1, cy - 2]]);
    sides.push([[x1, y1], [x0, y1], true, [cx - 2, y1]]);
    sides.push([[x0, y1], [x0, y0], false, [x0, cy - 2]]);
    return sides;
}

export function palisade_ring(ai, st, vils, tc) {
    const w = ai.w, p = ai.p;
    if (w.time < 420 || vils.length < 14) return;
    if (st['ring'] == null) st['ring'] = ring_plan(ai, tc);
    if (st['side'] >= st['ring'].length) return;
    // no more than one side in progress
    const wip = w.buildings.filter(b => b.owner === ai.pid && py.get(b.d, 'wall') && !b.complete);
    if (wip.length) {
        const builders = vils.filter(v => v.state === 'build' && wip.includes(v.target));
        if (builders.length < 2) {
            const free = py.sorted(vils.filter(v => ['idle', 'gather'].includes(v.state) &&
                                                     [null, 'wood'].includes(ai.vil_task(v))),
                                   v => v.dist_to(wip[0]));
            defense.assign_builders(wip, free.slice(0, 2 - builders.length));
        }
        return;
    }
    const [[sx, sy], [ex, ey], horiz, [gx, gy]] = st['ring'][st['side']];
    const span = defense.gate_span('palisade_gate');
    const gate_cost = p.cost_of('bld', 'palisade_gate');
    const seg_cost = p.cost_of('bld', 'palisade_wall');
    const n = py.len(defense.line_tiles(sx, sy, ex, ey));
    const need = {};
    for (const r of new Set([...Object.keys(gate_cost), ...Object.keys(seg_cost)])) {
        need[r] = py.get(gate_cost, r, 0) + py.get(seg_cost, r, 0) * n;
    }
    if (!p.afford(need)) return;
    st['side'] += 1;
    const [gx0, gy0, gw, gh] = defense.gate_rect(gx, gy, horiz, span);
    const gate_tiles = new Set();
    for (let y = gy0; y < gy0 + gh; y++) for (let x = gx0; x < gx0 + gw; x++) gate_tiles.add(py.tkey([x, y]));
    const free = py.sorted(vils.filter(v => ['idle', 'gather'].includes(v.state) &&
                                             [null, 'wood', 'food'].includes(ai.vil_task(v))),
                           v => math.hypot(v.x - sx * TILE, v.y - sy * TILE)).slice(0, 2);
    const gate = defense.place_gate(w, 'palisade_gate', ai.pid, gx, gy, horiz, free.slice(0, 1));
    // wall along the line except the gate tiles (if the gate did not fit, a gap remains there)
    const tiles = py.list(defense.line_tiles(sx, sy, ex, ey)).filter(t => !gate_tiles.has(py.tkey([t[0], t[1]])));
    const segs = [];
    for (const [x, y] of tiles) {
        if (!w.can_place('palisade_wall', x, y, ai.pid, false)) continue;
        if (near_resource_or_building(w, x, y)) continue;
        if (!p.pay(seg_cost)) break;
        segs.push(w.place_building('palisade_wall', ai.pid, x, y));
    }
    const rest = free.slice(1);
    defense.assign_builders(segs, gate == null ? free : (rest.length ? rest : free));
}

export function near_resource_or_building(w, x, y) {
    // Do not place a segment right next to resources/buildings - so as not to block access to them.
    for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
            const xx = x + dx, yy = y + dy;
            if (0 <= xx && xx < w.W && 0 <= yy && yy < w.H) {
                const o = w.occ[yy][xx];
                if (o != null && !defense.is_wall(o)) return true;
                if (w.floor[yy][xx] != null) return true;
            }
        }
    }
    return false;
}

// ---- university and techs
export const DEF_TECHS = ['masonry', 'guard_tower', 'murder_holes', 'fortified_wall', 'treadmill_crane', 'keep',
                          'architecture', 'arrowslits'];

export function research(ai, blds, count, vils) {
    const w = ai.w, p = ai.p;
    if (p.age < 2 || !Object.hasOwn(BUILDINGS, 'university')) return;
    const rich = p.res['food'] > 900 && p.res['wood'] > 700;
    if (py.get(count, 'university', 0) < 1) {
        if (rich && vils.length >= 25 && ai.diff >= 1 && p.afford(p.cost_of('bld', 'university'))) {
            const [bx, by] = ai.base.center();
            const spot = ai.find_spot('university', Math.floor(bx / TILE), Math.floor(by / TILE), 5, 16);
            if (spot) ai.start_build('university', spot, vils, 2);
        }
        return;
    }
    if (!rich) return;
    const have_towers = blds.some(b => ['tower', 'guard_tower', 'keep'].includes(b.kind));
    const have_walls = blds.some(b => b.kind === 'stone_wall');
    for (const name of DEF_TECHS) {
        if (['guard_tower', 'keep', 'murder_holes', 'arrowslits'].includes(name) && !have_towers) continue;
        if (name === 'fortified_wall' && !have_walls) continue;
        const [ok] = w.tech_state(p, name);
        if (!ok) continue;
        const host = blds.find(b => b.complete && py.get(b.d, 'techs', []).includes(name) && !b.queue.length);
        if (host === undefined) continue;
        const cost = p.cost_of('tech', name);
        if (p.pay(cost)) {
            host.queue.push(['tech', name]);
            p.researching.add(name);
        }
        break;
    }
}
