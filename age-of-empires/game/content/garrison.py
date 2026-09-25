"""Гарнизон (правила оригинала): вместимость и кто может сесть. Логика — game/defense.py.

Городской центр — 15 (жители, пехота, стрелки), сторожевые башни — 5, замок — 20 (все сухопутные).
Каждый житель или стрелок внутри добавляет зданию стрелу. Мин. дальность башен и замка — 1 клетка
(снимается «Бойницами», см. towers.py).
"""
from ..data import BUILDINGS

FOOT = ('vil', 'inf', 'arch')

BUILDINGS['town_center'].update(garrison=15, garrison_cls=FOOT)
BUILDINGS['tower'].update(garrison=5, garrison_cls=FOOT, min_rng=1)
BUILDINGS['castle'].update(garrison=20, garrison_cls=FOOT + ('cav',), min_rng=1)
