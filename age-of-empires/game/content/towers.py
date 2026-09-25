"""The tower line: Watch -> Guard (Castle Age) -> Keep (Imperial Age).

The upgrade turns all of the player's existing towers (the HP share is kept), new ones are built already
upgraded (World.place_building takes the kind with Player.alias in mind). Researched at the university.
Arrowslits remove the minimum range of towers and the castle; Murder Holes - +attack for towers.
"""
from . import add_building, add_tech
from ._uni import at_university
from ..data import BUILDINGS

FOOT = ('vil', 'inf', 'arch')
TOWERS = ('tower', 'guard_tower', 'keep')


def _upgrade(old, new):
    def apply(w, p):
        from ..defense import upgrade_buildings
        upgrade_buildings(w, p, old, new)
    return apply


def _tower_art(level):
    def art(p, surf, color, size):
        from .. import gfx
        stone = gfx.STONE if level == 1 else (170, 166, 158)
        top = 88 if level == 1 else 100
        w0 = 0.22 if level == 1 else 0.14
        p.box(w0, w0, 1 - w0, 1 - w0, top, stone, top=True, tex='stone')
        # cornice belt
        p.box(w0 - 0.07, w0 - 0.07, 1 - w0 + 0.07, 1 - w0 + 0.07, 7, gfx.shade(stone, 10), z0=top - 26)
        for z in (top * 0.45, top * 0.7):
            p.window_l(0.5, 1 - w0, z, 0.1, 9)
            p.window_r(1 - w0, 0.5, z, 0.1, 9)
        p.door(0.5, 1 - w0, 0.24, 13)
        p.banner_l(0.5, 1 - w0, top - 30, color, w=0.2, h=14)
        if level == 1:
            # guard: a hip roof over the battlements
            p.box(0.1, 0.1, 0.9, 0.9, 6, gfx.shade(stone, 8), z0=top)
            p.crenels(0.1, 0.1, 0.9, 0.9, top + 6, stone, step=0.25, sz=0.12)
            p.hip(0.2, 0.2, 0.8, 0.8, top + 12, 26, gfx.ROOF_SLATE, ov=0.04)
            p.flag(0.5, 0.5, top + 38, color, 16)
        else:
            # keep: a wide platform, battlements, corner turrets and a pavilion
            p.box(0.02, 0.02, 0.98, 0.98, 9, gfx.shade(stone, 8), z0=top)
            p.crenels(0.02, 0.02, 0.98, 0.98, top + 9, stone, step=0.24, sz=0.12, h=7)
            for (cx, cy) in ((0.02, 0.02), (0.78, 0.02), (0.02, 0.78)):
                p.box(cx, cy, cx + 0.2, cy + 0.2, 16, stone, z0=top + 9)
            p.box(0.3, 0.3, 0.7, 0.7, 22, stone, z0=top + 9, tex='stone')
            p.hip(0.28, 0.28, 0.72, 0.72, top + 31, 20, gfx.ROOF_SLATE, ov=0.03)
            p.box(0.78, 0.78, 0.98, 0.98, 16, stone, z0=top + 9)
            p.flag(0.5, 0.5, top + 51, color, 18)
    return art


base = BUILDINGS['tower']
add_building('guard_tower', menu=False, **dict(base, hp=1500, atk=6, arm=(1, 8),
                                               art=_tower_art(1), art_h=150, garrison=5, garrison_cls=FOOT,
                                               min_rng=1))
add_building('keep', menu=False, **dict(base, hp=2250, atk=7, arm=(2, 9),
                                        art=_tower_art(2), art_h=175, garrison=5, garrison_cls=FOOT,
                                        min_rng=1))

add_tech('guard_tower', cost={'food': 100, 'wood': 250}, time=30, age=2, on_apply=_upgrade('tower', 'guard_tower'))
add_tech('keep', cost={'food': 500, 'wood': 350}, time=75, age=3, req='guard_tower', on_apply=_upgrade('guard_tower', 'keep'))
add_tech('murder_holes', cost={'food': 200, 'stone': 100}, time=60, age=2, effects=[{'stat': 'min_rng', 'kind': TOWERS + ('castle',), 'mul': 0}])
add_tech('arrowslits', cost={'food': 250, 'wood': 250}, time=40, age=3, effects=[{'stat': 'atk', 'kind': 'tower', 'add': 1},
                  {'stat': 'atk', 'kind': 'guard_tower', 'add': 2},
                  {'stat': 'atk', 'kind': 'keep', 'add': 3}])

at_university('guard_tower', 'keep', 'murder_holes', 'arrowslits')
