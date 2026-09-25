"""Garrison (rules of the original): capacity and who may enter. Logic - game/defense.py.

Town center - 15 (villagers, infantry, ranged units), watch towers - 5, castle - 20 (all land units).
Every villager or ranged unit inside adds an arrow to the building. Min. range of towers and castle - 1 tile
(removed by "Arrowslits", see towers.py).
"""
from ..data import BUILDINGS

FOOT = ('vil', 'inf', 'arch')

BUILDINGS['town_center'].update(garrison=15, garrison_cls=FOOT)
BUILDINGS['tower'].update(garrison=5, garrison_cls=FOOT, min_rng=1)
BUILDINGS['castle'].update(garrison=20, garrison_cls=FOOT + ('cav',), min_rng=1)
