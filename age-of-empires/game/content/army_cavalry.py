"""Конюшня: линии разведчика и рыцаря, верблюды; Родословная, Животноводство. Значения — DE."""
from . import add_unit, add_tech, add_trains
from . import _army_art as art

# ---- линия разведчика
add_unit('light_cavalry', name='Лёгкая конница', hp=60, atk=7, rng=0, reload=2.0, arm=(0, 2), speed=1.5, los=8,
         cost={'food': 80}, time=30, age=2, cls='cav', ac=('light_cav',), bonus={'monk': 10}, radius=11,
         line='scout', desc='Дешёвая быстрая конница',
         art=art.rider(horse=(150, 104, 62), head='helm', weapon='sabre'))
add_tech('light_cavalry', at='stable', name='Лёгкая конница', cost={'food': 150, 'gold': 50}, time=45, age=2,
         upgrade=('scout', 'light_cavalry'), desc='Разведчики → лёгкая конница: 60 ОЗ, 7 атака')

add_unit('hussar', name='Гусар', hp=75, atk=7, rng=0, reload=1.9, arm=(0, 2), speed=1.5, los=10,
         cost={'food': 80}, time=30, age=3, cls='cav', ac=('light_cav',), bonus={'monk': 12}, radius=11,
         line='scout', desc='Лёгкая конница, +12 против монахов',
         art=art.rider(horse=(200, 190, 175), bard='cloth', head='cap', weapon='sabre'))
add_tech('hussar', at='stable', name='Гусар', cost={'food': 500, 'gold': 600}, time=50, age=3,
         req='light_cavalry', upgrade=('light_cavalry', 'hussar'), desc='Лёгкая конница → гусары: 75 ОЗ')

# ---- линия рыцаря
add_unit('cavalier', name='Кавалер', hp=120, atk=12, rng=0, reload=1.8, arm=(2, 2), speed=1.35, los=4,
         cost={'food': 60, 'gold': 75}, time=30, age=3, cls='cav', radius=11, line='knight',
         desc='Тяжёлая конница, 120 ОЗ',
         art=art.rider(horse=(70, 58, 52), bard='plate', head='great', weapon='lance'))
add_tech('cavalier', at='stable', name='Кавалер', cost={'food': 300, 'gold': 300}, time=100, age=3,
         upgrade=('knight', 'cavalier'), desc='Рыцари → кавалеры: 120 ОЗ, 12 атака')

add_unit('paladin', name='Паладин', hp=160, atk=14, rng=0, reload=1.9, arm=(2, 3), speed=1.35, los=5,
         cost={'food': 60, 'gold': 75}, time=30, age=3, cls='cav', radius=12, line='knight',
         desc='Лучшая тяжёлая конница', bar_h=40,
         art=art.rider(horse=(235, 232, 225), bard='gold', head='gold', weapon='lance', plume=True, big=True))
add_tech('paladin', at='stable', name='Паладин', cost={'food': 1300, 'gold': 750}, time=170, age=3,
         req='cavalier', upgrade=('cavalier', 'paladin'), desc='Кавалеры → паладины: 160 ОЗ, 14 атака, 2/3')

# ---- верблюды
add_unit('camel_rider', name='Верблюжий всадник', hp=100, atk=6, rng=0, reload=2.0, arm=(0, 0), speed=1.45, los=5,
         cost={'food': 55, 'gold': 60}, time=22, age=2, cls='cav', ac=('camel',), bonus={'cav': 9}, radius=11,
         line='camel_rider', desc='+9 против конницы', bar_h=40,
         art=art.rider(horse=(206, 170, 112), head='turban', weapon='sabre', camel=True))
add_unit('heavy_camel_rider', name='Тяжёлый верблюжий всадник', hp=120, atk=7, rng=0, reload=2.0, arm=(0, 0),
         speed=1.45, los=5, cost={'food': 55, 'gold': 60}, time=22, age=3, cls='cav', ac=('camel',),
         bonus={'cav': 18}, radius=11, line='camel_rider', desc='+18 против конницы', bar_h=40,
         art=art.rider(horse=(186, 150, 96), bard='cloth', head='helm', weapon='lance', camel=True))
add_tech('heavy_camel_rider', at='stable', name='Тяжёлый верблюжий всадник', cost={'food': 325, 'gold': 360},
         time=125, age=3, upgrade=('camel_rider', 'heavy_camel_rider'), desc='Верблюды: 120 ОЗ, +18 против конницы')

add_trains('stable', 'camel_rider')

# ---- технологии конюшни
add_tech('bloodlines', at='stable', name='Родословная', cost={'food': 150, 'gold': 100}, time=50, age=1, icon='Рд',
         desc='+20 ОЗ коннице', effects=[{'stat': 'hp', 'cls': 'cav', 'add': 20}])
add_tech('husbandry', at='stable', name='Животноводство', cost={'food': 150}, time=40, age=2, icon='Жв',
         desc='+10% скорость коннице', effects=[{'stat': 'speed', 'cls': 'cav', 'mul': 1.1}])
