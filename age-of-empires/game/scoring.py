"""Счёт игроков по правилам AoE2 (экран достижений «Score», оверлей F4).

  score(world, pid) -> {'total', 'military', 'economy', 'technology', 'society'}   (целые)
  scores(world)     -> [score(world, pid) for pid]  — за один проход по юнитам и зданиям
  team_scores(world) -> {команда: сумма total живых игроков}

Формулы (AoE2, лист достижений «Score», см. docs/research/02_menus.md [S10]):
  военные     = 20 % ресурсной стоимости убитых вражеских юнитов (и обращённых) + 20 % стоимости
                разрушенных вражеских зданий;
  экономика   = 10 % ресурсов, которые у игрока есть сейчас и которые он отдал данью,
                + 20 % стоимости живых юнитов и стоящих зданий (кроме замков и чудес);
  технологии  = 20 % стоимости изученных технологий (с эпохами) + 10 очков за каждый 1 % разведанной карты;
  общество    = 20 % стоимости стоящих замков и чудес (+10 за реликвию — реликвий в игре нет).
Если в мире нет статистики (старый мир) — считаются только части, известные без неё.
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
