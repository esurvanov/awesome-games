"""Стены и ворота (числа — как в оригинале, Definitive Edition).

Стены ставятся протяжкой линии (1×1 сегменты, оплата за сегмент), ворота — 4 клетки в линию,
на свободную землю или поверх своей стены. Свои и союзные юниты проходят через ворота, враги — нет.
Графика — game/wallgfx.py (сегменты соединяются с соседями). Логика — game/defense.py.
Технологии университета: Кладка, Архитектура, Укреплённые стены, Подъёмный кран.
"""
from . import add_building, add_tech
from ._uni import at_university

WALL = dict(size=1, los=2, wall=True)

add_building('palisade_wall', name='Частокол', hp=250, cost={'wood': 2}, time=5, age=0, arm=(2, 5),
             line=True, desc='Протяните линию мышью', **WALL)
add_building('palisade_gate', name='Ворота частокола', hp=400, cost={'wood': 30}, time=30, age=0, arm=(2, 2),
             gate=True, span=4, desc='Свои проходят, враги нет · Tab', **WALL)
add_building('stone_wall', name='Каменная стена', hp=1800, cost={'stone': 5}, time=8, age=1, arm=(8, 10),
             line=True, desc='Протяните линию мышью', **WALL)
add_building('gate', name='Ворота', hp=2750, cost={'stone': 30}, time=70, age=1, arm=(6, 6),
             gate=True, span=4, desc='Свои проходят, враги нет · Tab', **WALL)

add_tech('masonry', name='Каменная кладка', cost={'wood': 175, 'stone': 150}, time=50, age=2, icon='Кл',
         desc='Здания: +10% ОЗ, +1/+1 броня',
         effects=[{'stat': 'hp', 'cls': 'bld', 'mul': 1.1},
                  {'stat': 'arm_m', 'cls': 'bld', 'add': 1},
                  {'stat': 'arm_p', 'cls': 'bld', 'add': 1}])
add_tech('architecture', name='Архитектура', cost={'wood': 200, 'stone': 300}, time=70, age=3, icon='Ар',
         req='masonry', desc='Здания: +10% ОЗ, +1/+1 броня',
         effects=[{'stat': 'hp', 'cls': 'bld', 'mul': 1.1},
                  {'stat': 'arm_m', 'cls': 'bld', 'add': 1},
                  {'stat': 'arm_p', 'cls': 'bld', 'add': 1}])
add_tech('fortified_wall', name='Укреплённые стены', cost={'food': 200, 'stone': 100}, time=50, age=2, icon='Ус',
         desc='Каменные стены: 3000 ОЗ, 12/12 броня',
         effects=[{'stat': 'hp', 'kind': 'stone_wall', 'add': 1200},
                  {'stat': 'arm_m', 'kind': 'stone_wall', 'add': 4},
                  {'stat': 'arm_p', 'kind': 'stone_wall', 'add': 2}])
add_tech('treadmill_crane', name='Подъёмный кран', cost={'wood': 300, 'stone': 200}, time=40, age=2, icon='Кр',
         desc='Жители строят на 20% быстрее',
         effects=[{'stat': 'build', 'kind': 'villager', 'mul': 1.2}])

at_university('masonry', 'architecture', 'fortified_wall', 'treadmill_crane')
