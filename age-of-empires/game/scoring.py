"""The player score by AoE2 rules (the "Score" achievements screen, the F4 overlay).

  score(world, pid) -> {'total', 'military', 'economy', 'technology', 'society'}   (integers)
  scores(world)     -> [score(world, pid) for pid]  - in one pass over units and buildings
  team_scores(world) -> {team: the sum of total of living players}

Formulas (AoE2, the "Score" achievements sheet, see docs/research/02_menus.md [S10]):
  military    = 20 % of the resource cost of killed enemy units (and converted ones) + 20 % of the cost of
                destroyed enemy buildings;
  economy     = 10 % of the resources the player has now and gave as tribute,
                + 20 % of the cost of living units and standing buildings (except castles and wonders);
  technology  = 20 % of the cost of researched techs (with ages) + 10 points for every 1 % of the explored map;
  society     = 20 % of the cost of standing castles and wonders (+10 for a relic - there are no relics in the game).
If the world has no statistics (an old world) - only the parts known without them are counted.
"""
from .stats import value

SOCIETY_KINDS = ('castle', 'wonder')


def _values(w):
    n = len(w.players)
    alive_v = [0.0] * n
    soc_v = [0.0] * n
    for u in w.units:
        if 0 <= u.owner < n:
            alive_v[u.owner] += value(u.kind)
    for b in w.buildings:
        if 0 <= b.owner < n and b.complete:
            if b.kind in SOCIETY_KINDS:
                soc_v[b.owner] += value(b.kind)
            else:
                alive_v[b.owner] += value(b.kind)
            for u in b.garrison:
                alive_v[b.owner] += value(u.kind)
    return alive_v, soc_v


def scores(w):
    alive_v, soc_v = _values(w)
    stats = getattr(w, 'stats', None)
    out = []
    for p in w.players:
        s = stats[p.id] if stats else {}
        mil = 0.2 * (s.get('killed_value', 0.0) + s.get('razed_value', 0.0))
        eco = 0.1 * (sum(p.res.values()) + s.get('trib_sent', 0.0)) + 0.2 * alive_v[p.id]
        tech_v = s.get('tech_value')
        if tech_v is None:
            tech_v = sum(value(t) for t in p.techs)
        tech = 0.2 * tech_v + 10 * 100 * s.get('explored', 0.0)
        soc = 0.2 * soc_v[p.id]
        parts = dict(military=int(mil), economy=int(eco), technology=int(tech), society=int(soc))
        parts['total'] = sum(parts.values())
        out.append(parts)
    return out


def score(w, pid):
    return scores(w)[pid]


def team_scores(w):
    t = {}
    for p, sc in zip(w.players, scores(w)):
        if p.alive:
            t[p.team] = t.get(p.team, 0) + sc['total']
    return t
