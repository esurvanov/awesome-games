"""Монастырь и монах: лечит союзников, обращает врагов (4–10 с на дальности 9, потом 62 с восстанавливает
веру). Технологии монастыря — значения DE."""
from . import add_unit, add_building, add_tech
from . import _army_art as art

add_building('monastery', name='Монастырь', size=3, hp=2100, cost={'wood': 175}, time=40, age=2, los=6,
             trains=['monk'], desc='Монахи', art=art.monastery, art_h=100)

add_unit('monk', name='Монах', hp=30, atk=0, rng=9, reload=1.0, arm=(0, 0), speed=0.7, los=11,
         cost={'gold': 100}, time=51, age=2, cls='monk', monk=True, radius=7, unconvertible=False,
         desc='Лечит своих, обращает врагов', art=art.monk)

MONK = {'kind': 'monk'}
add_tech('sanctity', at='monastery', name='Святость', cost={'gold': 120}, time=60, age=2, icon='Св',
         desc='+15 ОЗ монахам', effects=[dict(MONK, stat='hp', add=15)])
add_tech('fervor', at='monastery', name='Рвение', cost={'gold': 140}, time=50, age=2, icon='Рв',
         desc='+15% скорость монахов', effects=[dict(MONK, stat='speed', mul=1.15)])
add_tech('atonement', at='monastery', name='Искупление', cost={'gold': 325}, time=40, age=2, icon='Ис',
         desc='Можно обращать монахов', effects=[dict(MONK, stat='convert_monk', add=1)])
add_tech('redemption', at='monastery', name='Искупление грехов', cost={'gold': 475}, time=50, age=2, icon='ИГ',
         desc='Можно обращать осадные орудия', effects=[dict(MONK, stat='convert_siege', add=1)])
add_tech('block_printing', at='monastery', name='Книгопечатание', cost={'gold': 200}, time=55, age=3, icon='Кп',
         desc='+3 дальность обращения', effects=[dict(MONK, stat='rng', add=3)])
add_tech('illumination', at='monastery', name='Озарение', cost={'gold': 120}, time=65, age=3, icon='Оз',
         desc='Вера восстанавливается на 50% быстрее', effects=[dict(MONK, stat='faith', mul=1.5)])
