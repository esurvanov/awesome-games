"""Линия башен: Сторожевая → Караульная (эпоха замков) → Крепостная (имперская).

Улучшение превращает все существующие башни игрока (доля ОЗ сохраняется), новые строятся сразу
улучшенными (World.place_building берёт вид с учётом Player.alias). Изучается в университете.
Бойницы снимают минимальную дальность башен и замка; Стрелковые щели — +атака башням.
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
        # пояс-карниз
        p.box(w0 - 0.07, w0 - 0.07, 1 - w0 + 0.07, 1 - w0 + 0.07, 7, gfx.shade(stone, 10), z0=top - 26)
        for z in (top * 0.45, top * 0.7):
            p.window_l(0.5, 1 - w0, z, 0.1, 9)
            p.window_r(1 - w0, 0.5, z, 0.1, 9)
        p.door(0.5, 1 - w0, 0.24, 13)
        p.banner_l(0.5, 1 - w0, top - 30, color, w=0.2, h=14)
        if level == 1:
            # караульная: шатровая крыша над зубцами
            p.box(0.1, 0.1, 0.9, 0.9, 6, gfx.shade(stone, 8), z0=top)
            p.crenels(0.1, 0.1, 0.9, 0.9, top + 6, stone, step=0.25, sz=0.12)
            p.hip(0.2, 0.2, 0.8, 0.8, top + 12, 26, gfx.ROOF_SLATE, ov=0.04)
            p.flag(0.5, 0.5, top + 38, color, 16)
        else:
            # крепостная: широкая площадка, зубцы, угловые башенки и шатёр
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
add_building('guard_tower', menu=False, **dict(base, name='Караульная башня', hp=1500, atk=6, arm=(1, 8),
                                               art=_tower_art(1), art_h=150, garrison=5, garrison_cls=FOOT,
                                               min_rng=1, desc='Улучшенная башня'))
add_building('keep', menu=False, **dict(base, name='Крепостная башня', hp=2250, atk=7, arm=(2, 9),
                                        art=_tower_art(2), art_h=175, garrison=5, garrison_cls=FOOT,
                                        min_rng=1, desc='Мощная башня'))

add_tech('guard_tower', name='Караульная башня', cost={'food': 100, 'wood': 250}, time=30, age=2, icon='Б2',
         desc='Башни: 1500 ОЗ, 6 атака, 1/8 броня', on_apply=_upgrade('tower', 'guard_tower'))
add_tech('keep', name='Крепостная башня', cost={'food': 500, 'wood': 350}, time=75, age=3, icon='Б3',
         req='guard_tower', desc='Башни: 2250 ОЗ, 7 атака, 2/9 броня', on_apply=_upgrade('guard_tower', 'keep'))
add_tech('murder_holes', name='Бойницы', cost={'food': 200, 'stone': 100}, time=60, age=2, icon='Бо',
         desc='Башни и замок бьют и вплотную',
         effects=[{'stat': 'min_rng', 'kind': TOWERS + ('castle',), 'mul': 0}])
add_tech('arrowslits', name='Стрелковые щели', cost={'food': 250, 'wood': 250}, time=40, age=3, icon='Щ',
         desc='Башни: +1 / +2 / +3 атака',
         effects=[{'stat': 'atk', 'kind': 'tower', 'add': 1},
                  {'stat': 'atk', 'kind': 'guard_tower', 'add': 2},
                  {'stat': 'atk', 'kind': 'keep', 'add': 3}])

at_university('guard_tower', 'keep', 'murder_holes', 'arrowslits')
