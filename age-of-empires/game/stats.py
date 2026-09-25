"""Match statistics for the achievements screen (6 tabs) and the score (game/scoring.py).

World keeps w.stats - a list of dicts, one per player (see new_stats). The world calls the hooks:
  on_death(w, target, attacker, is_building) - a unit was killed / a building destroyed
  on_convert(w, unit, old, new)   - a monk converted a unit
  on_tech(w, p, name)             - a tech was researched (ages - with a timestamp)
  on_complete(w, b)               - a building was completed (castles are counted)
  on_tribute(w, frm, to, amt)     - tribute (market.tribute), on_trade(w, pid, gold) - trade income
  tick(w, dt)                     - every 30 s - a sample for the "Timeline" graph, every 5 s - exploration
"""
from .data import UNITS, BUILDINGS, TECHS, AGE_TECHS

SAMPLE = 30.0           # the graph sampling period, game seconds
EXPLORE_T = 5.0
CELL = 4                # a cell of the exploration grid (in map tiles)


def new_stats():
    return {
        'kills': 0, 'losses': 0, 'razed': 0, 'bld_lost': 0, 'converted': 0, 'lost_conv': 0,
        'killed_value': 0.0, 'razed_value': 0.0, 'army_max': 0, 'vil_max': 0, 'pop_max': 0,
        'trib_sent': 0.0, 'trib_recv': 0.0, 'trade': 0.0, 'tech_value': 0.0, 'techs': 0,
        'age_t': [0.0, None, None, None], 'castles': 0, 'explored': 0.0, 'samples': [],
        'defeat_t': None,
    }


def value(kind):
    """The resource cost of a unit/building/tech kind (the sum of the price)."""
    d = UNITS.get(kind) or BUILDINGS.get(kind) or TECHS.get(kind) or {}
    return float(sum((d.get('cost') or {}).values()))


def init(w):
    w.stats = [new_stats() for _ in w.players]
    w.stats_t = 0.0
    w.explore_t = 0.0
    cw, ch = (w.W + CELL - 1) // CELL, (w.H + CELL - 1) // CELL
    w.explore_grid = [bytearray(cw * ch) for _ in w.players]
    sample(w)


def _st(w, pid):
    st = getattr(w, 'stats', None)
    if st is None or not (0 <= pid < len(st)):
        return None
    return st[pid]


def on_death(w, target, attacker, is_b):
    to = target.owner
    ao = getattr(attacker, 'owner', -1)
    v = value(target.kind)
    s = _st(w, to)
    if s is not None:
        if is_b:
            s['bld_lost'] += 1
        else:
            s['losses'] += 1
    if ao is not None and ao >= 0 and ao != to and to >= 0:
        a = _st(w, ao)
        if a is not None and not w.allied(ao, to):
            if is_b:
                a['razed'] += 1
                a['razed_value'] += v
            else:
                a['kills'] += 1
                a['killed_value'] += v


def on_convert(w, unit, old, new):
    a, b = _st(w, new), _st(w, old)
    if a is not None:
        a['converted'] += 1
        a['killed_value'] += value(unit.kind)
    if b is not None:
        b['lost_conv'] += 1


def on_tech(w, p, name):
    s = _st(w, p.id)
    if s is None:
        return
    s['techs'] += 1
    s['tech_value'] += value(name)
    if name in AGE_TECHS:
        i = AGE_TECHS.index(name) + 1
        if s['age_t'][i] is None:
            s['age_t'][i] = w.time


def on_complete(w, b):
    s = _st(w, b.owner)
    if s is not None and b.kind == 'castle':
        s['castles'] += 1


def on_tribute(w, frm, to, amt):
    a, b = _st(w, frm), _st(w, to)
    if a is not None:
        a['trib_sent'] += amt
    if b is not None:
        b['trib_recv'] += amt


def on_trade(w, pid, gold):
    s = _st(w, pid)
    if s is not None:
        s['trade'] += gold


def on_defeat(w, pid):
    s = _st(w, pid)
    if s is not None and s['defeat_t'] is None:
        s['defeat_t'] = w.time


def tick(w, dt):
    if getattr(w, 'stats', None) is None:
        return
    w.stats_t += dt
    w.explore_t += dt
    if w.explore_t >= EXPLORE_T:
        w.explore_t = 0.0
        explore(w)
    if w.stats_t >= SAMPLE:
        w.stats_t -= SAMPLE
        sample(w)


def counts(w):
    """{pid: (population, army, villagers)} over living units."""
    n = len(w.players)
    pop = [0] * n
    army = [0] * n
    vils = [0] * n
    for u in w.units:
        o = u.owner
        if 0 <= o < n:
            pop[o] += 1
            if u.kind == 'villager':
                vils[o] += 1
            elif not u.d.get('civil'):
                army[o] += 1
    for b in w.buildings:
        for u in b.garrison:
            if 0 <= b.owner < n:
                pop[b.owner] += 1
                if u.kind == 'villager':
                    vils[b.owner] += 1
    return pop, army, vils


def sample(w):
    pop, army, vils = counts(w)
    for pid, s in enumerate(w.stats):
        s['samples'].append((round(w.time, 1), pop[pid], army[pid], vils[pid]))
        s['army_max'] = max(s['army_max'], army[pid])
        s['vil_max'] = max(s['vil_max'], vils[pid])
        s['pop_max'] = max(s['pop_max'], pop[pid])


def explore(w):
    """The explored share of the map per player (a coarse CELL x CELL grid by the view of units and buildings)."""
    cw = (w.W + CELL - 1) // CELL
    ch = (w.H + CELL - 1) // CELL
    grids = w.explore_grid
    from .data import TILE
    seen = set()
    for e in w.units:
        o = e.owner
        if not (0 <= o < len(grids)):
            continue
        cx, cy = int(e.x // TILE) // CELL, int(e.y // TILE) // CELL
        r = int(e.los()) // CELL + 1
        key = (o, cx, cy, r)
        if key in seen:
            continue
        seen.add(key)
        g = grids[o]
        for y in range(max(0, cy - r), min(ch, cy + r + 1)):
            a = y * cw
            x0, x1 = max(0, cx - r), min(cw - 1, cx + r)
            if x1 >= x0:
                g[a + x0:a + x1 + 1] = b'\x01' * (x1 - x0 + 1)
    for pid, s in enumerate(w.stats):
        if pid == w.human and getattr(w, 'explored', None) is not None:
            s['explored'] = sum(w.explored) / max(1, len(w.explored))
        else:
            g = grids[pid]
            s['explored'] = sum(g) / max(1, len(g))
