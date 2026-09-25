"""Университет (Эпоха замков) и его военные технологии: Баллистика, Химия, Осадные инженеры.

Другие модули добавляют сюда свои технологии: add_techs('university', ...) или add_tech(..., at='university')
(например, стены/башни: Каменная кладка, Архитектура, Бойницы, Караульная башня)."""
from . import add_building, add_tech
from . import _army_art as art

add_building('university', name='Университет', size=4, hp=2100, cost={'wood': 200}, time=60, age=2, los=6,
             desc='Наука: баллистика, химия', art=art.university, art_h=110)

add_tech('ballistics', at='university', name='Баллистика', cost={'wood': 300, 'gold': 175}, time=60, age=2,
         icon='Бл', desc='Стрелы с упреждением по движущимся',
         effects=[{'stat': 'lead', 'add': 1}])
add_tech('chemistry', at='university', name='Химия', cost={'food': 300, 'gold': 200}, time=100, age=3, icon='Хм',
         desc='+1 атака стрелкам и осаде, открывает порох',
         effects=[{'stat': 'atk', 'cls': ('arch', 'siege', 'bld'), 'not_cls': ('gunpowder', 'ram'), 'add': 1}])
add_tech('siege_engineers', at='university', name='Осадные инженеры', cost={'food': 500, 'wood': 600}, time=45,
         age=3, icon='Ои', desc='Осада: +1 дальность, +20% по зданиям',
         effects=[{'stat': 'rng', 'kind': ('mangonel', 'onager', 'siege_onager', 'scorpion', 'heavy_scorpion',
                                           'bombard_cannon'), 'add': 1},
                  {'stat': 'bonus:bld', 'cls': 'siege', 'mul': 1.2}])
