"""Стрельбище: лучники, застрельщики, конные лучники, ручная пушка; Кольцо лучника, Парфянская тактика."""
from . import add_unit, add_tech, add_trains
from . import _army_art as art
from ..data import UNITS

UNITS['archer']['art'] = art.foot('hood', 'bow')
UNITS['skirmisher']['art'] = art.foot('hood', 'javelin')

# ---- линия лучника
add_unit('crossbowman', name='Арбалетчик', hp=35, atk=5, rng=5, reload=2.0, arm=(0, 0), speed=0.96, los=7,
         cost={'wood': 25, 'gold': 45}, time=27, age=2, cls='arch', ac=('foot_arch',), bonus={'spear': 3}, acc=0.85,
         radius=7, line='archer', shot='bolt', desc='Стрелок, дальность 5',
         art=art.foot('cap', 'crossbow'))
add_tech('crossbowman', at='archery_range', name='Арбалетчик', cost={'food': 125, 'gold': 75}, time=35, age=2,
         upgrade=('archer', 'crossbowman'), desc='Лучники → арбалетчики: 5 атака, дальность 5')

add_unit('arbalester', name='Аркебалист', hp=40, atk=6, rng=5, reload=2.0, arm=(0, 0), speed=0.96, los=7,
         cost={'wood': 25, 'gold': 45}, time=27, age=3, cls='arch', ac=('foot_arch',), bonus={'spear': 3}, acc=0.9,
         radius=7, line='archer', shot='bolt', desc='Лучший стрелок, 90% точность',
         art=art.foot('sallet', 'crossbow', plate=True))
add_tech('arbalester', at='archery_range', name='Аркебалист', cost={'food': 350, 'gold': 300}, time=50, age=3,
         req='crossbowman', upgrade=('crossbowman', 'arbalester'), desc='Арбалетчики → аркебалисты: 40 ОЗ, 6 атака')

# ---- застрельщики
add_unit('elite_skirmisher', name='Элитный застрельщик', hp=35, atk=3, rng=5, reload=3.0, arm=(0, 4), speed=0.96,
         los=8, cost={'food': 25, 'wood': 35}, time=22, age=2, cls='arch', ac=('skirm', 'foot_arch'),
         bonus={'arch': 4, 'spear': 3}, acc=0.9, shot='javelin', radius=7, line='skirmisher',
         desc='+4 против стрелков', art=art.foot('iron', 'javelin', shield=True))
add_tech('elite_skirmisher', at='archery_range', name='Элитный застрельщик', cost={'wood': 230, 'gold': 130},
         time=50, age=2, upgrade=('skirmisher', 'elite_skirmisher'), desc='Застрельщики: 0/4 броня, дальность 5')

# ---- конные лучники
add_unit('cavalry_archer', name='Конный лучник', hp=50, atk=6, rng=4, reload=2.0, arm=(0, 0), speed=1.4, los=5,
         cost={'wood': 40, 'gold': 70}, time=34, age=2, cls='cav', ac=('arch', 'cav_arch'), bonus={'spear': 2},
         acc=0.5, radius=11, line='cavalry_archer', desc='Быстрый стрелок, 50% точность',
         art=art.rider(horse=(150, 110, 70), head='cap', weapon='bow'))
add_tech('heavy_cavalry_archer', at='archery_range', name='Тяжёлый конный лучник', cost={'food': 900, 'gold': 500},
         time=50, age=3, upgrade=('cavalry_archer', 'heavy_cavalry_archer'),
         desc='Конные лучники: 60 ОЗ, 7 атака, 1/0')
add_unit('heavy_cavalry_archer', name='Тяжёлый конный лучник', hp=60, atk=7, rng=4, reload=2.0, arm=(1, 0),
         speed=1.4, los=6, cost={'wood': 40, 'gold': 70}, time=27, age=3, cls='cav', ac=('arch', 'cav_arch'),
         bonus={'spear': 2}, acc=0.5, radius=11, line='cavalry_archer', desc='Бронированный конный стрелок',
         art=art.rider(horse=(95, 72, 55), bard='cloth', head='helm', weapon='bow'))

# ---- ручная пушка (Имперская эпоха, нужна Химия)
add_unit('hand_cannoneer', name='Ручная пушка', hp=40, atk=17, rng=7, reload=3.45, arm=(1, 0), speed=0.96, los=9,
         cost={'food': 45, 'gold': 50}, time=34, age=3, req='chemistry', cls='arch', ac=('gunpowder',),
         bonus={'inf': 10, 'spear': 1, 'ram': 2}, acc=0.75, shot='ball', shot_speed=420, radius=7,
         desc='+10 против пехоты, порох', art=art.foot('brim', 'handcannon'))

add_trains('archery_range', 'cavalry_archer', 'hand_cannoneer')

# ---- технологии стрельбища
add_tech('thumb_ring', at='archery_range', name='Кольцо лучника', cost={'food': 300, 'wood': 250}, time=45, age=2,
         icon='Кл', desc='Лучники: 100% точность, +18% скорострельность',
         effects=[{'stat': 'acc', 'cls': 'arch', 'not_cls': ('gunpowder',), 'add': 1},
                  {'stat': 'reload', 'cls': 'arch', 'not_cls': ('gunpowder',), 'mul': 1 / 1.18}])
add_tech('parthian_tactics', at='archery_range', name='Парфянская тактика', cost={'food': 200, 'gold': 250},
         time=65, age=3, icon='Пт', desc='Конные лучники: +1/+2 броня, +4 против копейщиков',
         effects=[{'stat': 'arm_m', 'cls': 'cav_arch', 'add': 1},
                  {'stat': 'arm_p', 'cls': 'cav_arch', 'add': 2},
                  {'stat': 'bonus:spear', 'cls': 'cav_arch', 'add': 4}])
