"""Computer player defense: palisade around the base (hard level), town bell, garrison,
university and tower/wall techs when resources are plentiful.

AI.update calls tick() twice a second. The wall ring always has gates on every side
(or a gap if a gate did not fit) - the AI never locks itself in.
Breaching enemy walls is done by the units themselves (defense.breach_target from Unit.approach).
"""
import math

from .data import TILE, BUILDINGS
from . import defense

RING_R = 11                 # "radius" (Chebyshev) of the palisade ring around the center
BELL_R = 9 * TILE           # enemies closer than this are a reason for the town bell
CLEAR_T = 15.0              # how many seconds of quiet before "All clear"


def state(ai):
    st = getattr(ai, '_def', None)
    if st is None:
        st = ai._def = {'ring': None, 'side': 0, 'bell_t': 0.0, 'quiet': 0.0, 'uni_t': 0.0}
    return st


def tick(ai, vils, army, blds, tc, count):
    st = state(ai)
    threats = enemies_near(ai, tc, BELL_R) if tc is not None else []
    bell(ai, st, vils, army, tc, threats)
    shelter_archers(ai, army, threats)
    if ai.diff >= 2 and tc is not None:
        palisade_ring(ai, st, vils, tc)
    research(ai, blds, count, vils)


# ---- town bell
def enemies_near(ai, b, r):
    w = ai.w
    hrow = w.hmat[ai.pid]
    x0, y0 = b.tx * TILE, b.ty * TILE
    near = {u for u in w.units_in_rect(x0 - r, y0 - r, x0 + b.w * TILE + r, y0 + b.h * TILE + r,
                                       w.hostile_mask(hrow))
            if hrow[u.owner] and u.cls != 'vil' and u.kind != 'scout' and b.dist_px(u.x, u.y) < r}
    return [u for u in w.units if u in near] if near else []


def bell(ai, st, vils, army, tc, threats):
    w, p = ai.w, ai.p
    if tc is None:
        if getattr(p, 'bell', False):
            defense.all_clear(w, ai.pid)
        return
    ringing = getattr(p, 'bell', False)
    if not ringing:
        defenders = sum(1 for a in army if tc.dist_px(a.x, a.y) < BELL_R + 3 * TILE)
        hurt = any(w.time - v.hit_t < 3 for v in vils if tc.dist_px(v.x, v.y) < BELL_R + 4 * TILE)
        if len(threats) >= 3 and hurt and defenders < len(threats):
            defense.ring_bell(w, ai.pid)
            st['quiet'] = 0.0
        return
    if threats:
        st['quiet'] = 0.0
        # new villagers hide too
        for v in vils:
            if v.state not in ('garrison',) and getattr(v, 'bell_task', None) is None:
                v.bell_task = defense.snapshot(v)
                b = best_shelter(w, ai.pid, v)
                if b is not None:
                    v.cmd_garrison(b)
    else:
        st['quiet'] += 0.5
        if st['quiet'] >= CLEAR_T:
            defense.all_clear(w, ai.pid)


def best_shelter(w, pid, u):
    cands = [b for b in defense.garrison_buildings(w, pid, u.cls) if len(b.garrison) < defense.capacity(b)]
    if not cands:
        return None
    return min(cands, key=lambda b: u.dist_to(b))


def shelter_archers(ai, army, threats):
    """Ranged units garrison in towers/center when the enemy heavily outnumbers them - they shoot from there."""
    if not threats or len(threats) < 2 * max(1, len(army)):
        return
    w = ai.w
    for a in army:
        if a.cls != 'arch' or a.state == 'garrison':
            continue
        b = best_shelter(w, ai.pid, a)
        if b is not None and a.dist_to(b) < 8 * TILE:
            a.cmd_garrison(b)


# ---- palisade ring
def ring_plan(ai, tc):
    """The 4 sides of the square around the center: (wall line, gate in the middle)."""
    cx, cy = tc.tx + tc.w // 2, tc.ty + tc.h // 2
    R = RING_R
    x0, y0, x1, y1 = cx - R, cy - R, cx + R, cy + R
    sides = []
    # (start, end, gate horizontal?, gate tile)
    sides.append(((x0, y0), (x1, y0), True, (cx - 2, y0)))
    sides.append(((x1, y0), (x1, y1), False, (x1, cy - 2)))
    sides.append(((x1, y1), (x0, y1), True, (cx - 2, y1)))
    sides.append(((x0, y1), (x0, y0), False, (x0, cy - 2)))
    return sides


def palisade_ring(ai, st, vils, tc):
    w, p = ai.w, ai.p
    if w.time < 420 or len(vils) < 14:
        return
    if st['ring'] is None:
        st['ring'] = ring_plan(ai, tc)
    if st['side'] >= len(st['ring']):
        return
    # no more than one side in progress
    wip = [b for b in w.buildings if b.owner == ai.pid and b.d.get('wall') and not b.complete]
    if wip:
        builders = [v for v in vils if v.state == 'build' and v.target in wip]
        if len(builders) < 2:
            free = sorted([v for v in vils if v.state in ('idle', 'gather') and ai.vil_task(v) in (None, 'wood')],
                          key=lambda v: v.dist_to(wip[0]))
            defense.assign_builders(wip, free[:2 - len(builders)])
        return
    (sx, sy), (ex, ey), horiz, (gx, gy) = st['ring'][st['side']]
    span = defense.gate_span('palisade_gate')
    gate_cost = p.cost_of('bld', 'palisade_gate')
    seg_cost = p.cost_of('bld', 'palisade_wall')
    n = len(defense.line_tiles(sx, sy, ex, ey))
    need = {r: gate_cost.get(r, 0) + seg_cost.get(r, 0) * n for r in set(gate_cost) | set(seg_cost)}
    if not p.afford(need):
        return
    st['side'] += 1
    gx0, gy0, gw, gh = defense.gate_rect(gx, gy, horiz, span)
    gate_tiles = {(x, y) for y in range(gy0, gy0 + gh) for x in range(gx0, gx0 + gw)}
    free = sorted([v for v in vils if v.state in ('idle', 'gather') and ai.vil_task(v) in (None, 'wood', 'food')],
                  key=lambda v: math.hypot(v.x - sx * TILE, v.y - sy * TILE))[:2]
    gate = defense.place_gate(w, 'palisade_gate', ai.pid, gx, gy, horiz, free[:1])
    # wall along the line except the gate tiles (if the gate did not fit, a gap remains there)
    tiles = [t for t in defense.line_tiles(sx, sy, ex, ey) if t not in gate_tiles]
    segs = []
    for (x, y) in tiles:
        if not w.can_place('palisade_wall', x, y, ai.pid, check_explored=False):
            continue
        if near_resource_or_building(w, x, y):
            continue
        if not p.pay(seg_cost):
            break
        segs.append(w.place_building('palisade_wall', ai.pid, x, y))
    defense.assign_builders(segs, free if gate is None else free[1:] or free)


def near_resource_or_building(w, x, y):
    """Do not place a segment right next to resources/buildings - so as not to block access to them."""
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            xx, yy = x + dx, y + dy
            if 0 <= xx < w.W and 0 <= yy < w.H:
                o = w.occ[yy][xx]
                if o is not None and not defense.is_wall(o):
                    return True
                if w.floor[yy][xx] is not None:
                    return True
    return False


# ---- university and techs
DEF_TECHS = ('masonry', 'guard_tower', 'murder_holes', 'fortified_wall', 'treadmill_crane', 'keep',
             'architecture', 'arrowslits')


def research(ai, blds, count, vils):
    w, p = ai.w, ai.p
    if p.age < 2 or 'university' not in BUILDINGS:
        return
    rich = p.res['food'] > 900 and p.res['wood'] > 700
    if count.get('university', 0) < 1:
        if rich and len(vils) >= 25 and ai.diff >= 1 and p.afford(p.cost_of('bld', 'university')):
            bx, by = ai.base.center()
            spot = ai.find_spot('university', int(bx // TILE), int(by // TILE), 5, 16)
            if spot:
                ai.start_build('university', spot, vils, 2)
        return
    if not rich:
        return
    have_towers = any(b.kind in ('tower', 'guard_tower', 'keep') for b in blds)
    have_walls = any(b.kind == 'stone_wall' for b in blds)
    for name in DEF_TECHS:
        if name in ('guard_tower', 'keep', 'murder_holes', 'arrowslits') and not have_towers:
            continue
        if name == 'fortified_wall' and not have_walls:
            continue
        ok, _ = w.tech_state(p, name)
        if not ok:
            continue
        host = next((b for b in blds if b.complete and name in b.d.get('techs', []) and not b.queue), None)
        if host is None:
            continue
        cost = p.cost_of('tech', name)
        if p.pay(cost):
            host.queue.append(('tech', name))
            p.researching.add(name)
        break
