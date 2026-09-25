"""Пехота казарм: линия ополченца (после Воина), линия копейщика, технологии казарм. Значения — DE."""
from . import add_unit, add_tech
from . import _army_art as art
from ..data import UNITS

MILITIA_LINE = ('militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion')

UNITS['militia']['art'] = art.foot('iron', 'sword')

# ---- линия ополченца (Воин — в man_at_arms.py)
add_unit('long_swordsman', name='Мечник', hp=60, atk=9, rng=0, reload=2.0, arm=(0, 1), speed=0.9, los=4,
         cost={'food': 60, 'gold': 20}, time=21, age=2, cls='inf', radius=8, line='militia',
         desc='Пехота ближнего боя', art=art.foot('sallet', 'longsword', shield=True))
add_tech('long_swordsman', at='barracks', name='Мечник', cost={'food': 150, 'gold': 65}, time=45, age=2,
         req='man_at_arms', upgrade=('man_at_arms', 'long_swordsman'), desc='Воины → мечники: 60 ОЗ, 9 атака')

add_unit('two_handed_swordsman', name='Двуручник', hp=60, atk=12, rng=0, reload=2.0, arm=(0, 1), speed=0.9, los=5,
         cost={'food': 60, 'gold': 20}, time=21, age=3, cls='inf', radius=8, line='militia',
         desc='Тяжёлый меч, 12 атака', art=art.foot('great', 'greatsword'))
add_tech('two_handed_swordsman', at='barracks', name='Двуручник', cost={'food': 300, 'gold': 100}, time=75, age=3,
         req='long_swordsman', upgrade=('long_swordsman', 'two_handed_swordsman'),
         desc='Мечники → двуручники: 12 атака')

add_unit('champion', name='Чемпион', hp=70, atk=13, rng=0, reload=2.0, arm=(1, 1), speed=0.9, los=5,
         cost={'food': 60, 'gold': 20}, time=21, age=3, cls='inf', radius=8, line='militia',
         desc='Лучший мечник, 13 атака', art=art.foot('great', 'greatsword', plate=True, plume=True, cape=True))
add_tech('champion', at='barracks', name='Чемпион', cost={'food': 750, 'gold': 350}, time=100, age=3,
         req='two_handed_swordsman', upgrade=('two_handed_swordsman', 'champion'),
         desc='Двуручники → чемпионы: 70 ОЗ, 13 атака, 1/1')

# ---- линия копейщика
UNITS['spearman']['art'] = art.foot('iron', 'spear')
add_unit('pikeman', name='Пикинёр', hp=55, atk=4, rng=0, reload=3.0, arm=(0, 0), speed=1.0, los=4,
         cost={'food': 35, 'wood': 25}, time=22, age=2, cls='inf', ac=('spear',), bonus={'cav': 22}, radius=8,
         line='spearman', desc='+22 против конницы', art=art.foot('kettle', 'pike'))
add_tech('pikeman', at='barracks', name='Пикинёр', cost={'food': 215, 'gold': 90}, time=45, age=2,
         upgrade=('spearman', 'pikeman'), desc='Копейщики → пикинёры: +22 против конницы')

add_unit('halberdier', name='Алебардщик', hp=60, atk=6, rng=0, reload=3.0, arm=(1, 0), speed=1.0, los=4,
         cost={'food': 35, 'wood': 25}, time=22, age=3, cls='inf', ac=('spear',), bonus={'cav': 32}, radius=8,
         line='spearman', desc='+32 против конницы', art=art.foot('sallet', 'halberd', plate=True))
add_tech('halberdier', at='barracks', name='Алебардщик', cost={'food': 300, 'gold': 600}, time=50, age=3,
         req='pikeman', upgrade=('pikeman', 'halberdier'), desc='Пикинёры → алебардщики: +32 против конницы')

# ---- технологии казарм
add_tech('supplies', at='barracks', name='Снабжение', cost={'food': 150, 'gold': 100}, time=35, age=1, icon='Сн',
         desc='Мечники дешевле на 15 еды',
         effects=[{'stat': 'cost', 'kind': MILITIA_LINE, 'res': 'food', 'add': -15}])
add_tech('squires', at='barracks', name='Оруженосцы', cost={'food': 200}, time=40, age=2, icon='Ор',
         desc='+10% скорость пехоты',
         effects=[{'stat': 'speed', 'cls': 'inf', 'mul': 1.1}])
add_tech('arson', at='barracks', name='Поджог', cost={'food': 150, 'gold': 50}, time=25, age=2, icon='Пж',
         desc='Пехота: +2 против зданий',
         effects=[{'stat': 'bonus:bld', 'cls': 'inf', 'add': 2}])
