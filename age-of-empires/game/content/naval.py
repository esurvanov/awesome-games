"""Флот: док, корабли, рыба и морские технологии (значения — как в классической исторической RTS).

Логика кораблей — в game/naval.py (класс Ship: движение только по воде, рыбалка, транспорт, бой),
графика — в game/naval_gfx.py. Юнит с 'naval': True создаётся как Ship (World.spawn → naval.spawn_ship).
Дополнительные поля записей:
  юнит  — 'carry' (улов рыбацкого корабля), 'cargo' (мест в транспорте), 'fisher' (ловит рыбу),
          'fire' (огонь вблизи, урон как ближний), 'blast' (подрыв: радиус в клетках), 'minrng' (мёртвая зона),
          'siege' (ядра: урон по ближней броне), 'bar' (высота полоски здоровья над корпусом);
  здание — 'water': True (ставится на воду у берега, см. naval.can_place_water);
  ресурс — 'ship_rate' (скорость ловли кораблём), 'sprite' / 'anim' / 'anchor' / 'mm' — вид в интерфейсе.
Классы для бонусов: у всех кораблей cls='ship'.
"""
from . import add_unit, add_building, add_tech
from ..data import NODE_DEFS


def _art(kind):
    def draw(surf, k_, color, x, y, face, anim, swing, k, carry_res, moving):
        from .. import naval_gfx
        naval_gfx.draw_ship(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
    return draw


def _dock_art(p, surf, color, size):
    from .. import naval_gfx
    naval_gfx.draw_dock(p, surf, color, size)


def _fish_sprite(kind):
    def make(var):
        from .. import naval_gfx
        return naval_gfx.make_fish(kind, var)
    return make


def _fish_anim(scr, n, sx, sy, t):
    from .. import naval_gfx
    naval_gfx.fish_ripple(scr, n, sx, sy, t)


# ---- рыба: у берега её ловят и жители (с суши), и рыбацкие корабли; глубоководную — только корабли
NODE_DEFS['shore_fish'] = dict(res='food', amount=200, rate=0.43, ship_rate=0.49, name='Рыба у берега', water=True,
                               sprite=_fish_sprite('shore_fish'), anim=_fish_anim, anchor='center', mm=(150, 210, 235))
NODE_DEFS['deep_fish'] = dict(res='food', amount=225, rate=0.0, ship_rate=0.49, name='Глубоководная рыба', water=True,
                              deep=True, sprite=_fish_sprite('deep_fish'), anim=_fish_anim, anchor='center',
                              mm=(200, 235, 250))

# ---- корабли (скорость — клеток в секунду, время — секунды)
SHIP = dict(cls='ship', naval=True, rng=0, reload=2.0)

add_unit('fishing_ship', **SHIP, name='Рыбацкий корабль', hp=60, atk=0, arm=(0, 4), speed=1.26, los=5,
         cost={'wood': 75}, time=40, age=0, radius=13, carry=15, fisher=True, bar=30,
         desc='Ловит рыбу, везёт улов в док', art=_art('fishing_ship'))
add_unit('transport_ship', **dict(SHIP, rng=0), name='Транспорт', hp=100, atk=0, arm=(4, 8), speed=1.45, los=5,
         cost={'wood': 125}, time=46, age=0, radius=16, cargo=5, bar=32,
         desc='Перевозит 5 воинов: ПКМ по нему — посадка, ПКМ по берегу — высадка', art=_art('transport_ship'))

add_unit('galley', **dict(SHIP, rng=5, reload=3.0), name='Галера', hp=120, atk=6, arm=(0, 6), speed=1.43, los=7,
         cost={'wood': 90, 'gold': 30}, time=60, age=1, radius=15, bonus={'ship': 6}, bar=40,
         desc='Боевой корабль со стрелками', art=_art('galley'))
add_unit('war_galley', **dict(SHIP, rng=6, reload=3.0), name='Боевая галера', hp=135, atk=7, arm=(0, 6), speed=1.43,
         los=8, cost={'wood': 90, 'gold': 30}, time=36, age=2, radius=16, bonus={'ship': 7}, bar=44,
         desc='Боевой корабль со стрелками', art=_art('war_galley'))
add_unit('galleon', **dict(SHIP, rng=7, reload=3.0), name='Галеон', hp=165, atk=8, arm=(0, 8), speed=1.43, los=9,
         cost={'wood': 90, 'gold': 30}, time=36, age=3, radius=17, bonus={'ship': 8}, bar=50,
         desc='Тяжёлый боевой корабль', art=_art('galleon'))

add_unit('fire_galley', **dict(SHIP, rng=2.5, reload=0.25), name='Огненная галера', hp=100, atk=1, arm=(0, 6),
         speed=1.30, los=5, cost={'wood': 75, 'gold': 45}, time=65, age=1, radius=15, fire=True,
         bonus={'ship': 2, 'bld': 1}, bar=38, desc='Жжёт корабли вблизи', art=_art('fire_galley'))
add_unit('fire_ship', **dict(SHIP, rng=2.5, reload=0.25), name='Брандер', hp=120, atk=2, arm=(0, 6), speed=1.35,
         los=6, cost={'wood': 75, 'gold': 45}, time=36, age=2, radius=16, fire=True,
         bonus={'ship': 3, 'bld': 1}, bar=40, desc='Жжёт корабли вблизи', art=_art('fire_ship'))
add_unit('fast_fire_ship', **dict(SHIP, rng=2.5, reload=0.25), name='Быстрый брандер', hp=140, atk=3, arm=(0, 8),
         speed=1.43, los=6, cost={'wood': 75, 'gold': 45}, time=36, age=3, radius=16, fire=True,
         bonus={'ship': 4, 'bld': 2}, bar=40, desc='Жжёт корабли вблизи', art=_art('fast_fire_ship'))

add_unit('demolition_ship', **SHIP, name='Корабль-подрывник', hp=60, atk=110, arm=(0, 3), speed=1.6, los=6,
         cost={'wood': 70, 'gold': 50}, time=31, age=2, radius=14, blast=2.5, bonus={'bld': 180}, bar=30,
         desc='Взрывается у цели, бьёт по площади', art=_art('demolition_ship'))
add_unit('heavy_demolition_ship', **SHIP, name='Тяжёлый подрывник', hp=70, atk=140, arm=(0, 5), speed=1.6, los=6,
         cost={'wood': 70, 'gold': 50}, time=31, age=3, radius=15, blast=2.5, bonus={'bld': 180}, bar=30,
         desc='Взрывается у цели, бьёт по площади', art=_art('heavy_demolition_ship'))

# (в классике ещё нужна «Химия»; такой технологии пока нет — открывается Имперской эпохой)
add_unit('cannon_galleon', **dict(SHIP, rng=13, reload=10.0), name='Пушечный галеон', hp=120, atk=35, arm=(0, 6),
         speed=1.1, los=15, cost={'wood': 200, 'gold': 150}, time=46, age=3, radius=18, minrng=3, siege=True,
         bonus={'bld': 40}, bar=50, desc='Ядрами рушит здания издалека', art=_art('cannon_galleon'))

# ---- док
add_building('dock', name='Док', size=3, hp=1800, cost={'wood': 150}, time=35, age=0, water=True, los=6,
             drop=('food',), arm=(0, 7), art=_dock_art, art_h=90,
             trains=['fishing_ship', 'transport_ship', 'galley', 'fire_galley', 'demolition_ship', 'cannon_galleon'],
             desc='Корабли, склад рыбы; строится на воде у берега')

# ---- технологии дока
SHIPS = 'ship'
add_tech('gillnets', at='dock', name='Сети', cost={'food': 150, 'wood': 200}, time=40, age=1, icon='Се',
         desc='+25% улов рыбацких кораблей',
         effects=[{'stat': 'gather', 'kind': 'fishing_ship', 'mul': 1.25}])
add_tech('war_galley', at='dock', name='Боевая галера', cost={'food': 230, 'gold': 100}, time=50, age=2,
         upgrade=('galley', 'war_galley'), desc='Галеры → боевые галеры: 135 ОЗ, 7 атака, 6 дальность')
add_tech('fire_ship', at='dock', name='Брандер', cost={'food': 230, 'gold': 100}, time=50, age=2,
         upgrade=('fire_galley', 'fire_ship'), desc='Огненные галеры → брандеры')
add_tech('careening', at='dock', name='Кренгование', cost={'food': 250, 'gold': 150}, time=60, age=2, icon='Кр',
         desc='Корабли: +1 броня от стрел; транспорт +5 мест',
         effects=[{'stat': 'arm_p', 'cls': SHIPS, 'add': 1}, {'stat': 'cargo', 'kind': 'transport_ship', 'add': 5}])
add_tech('dry_dock', at='dock', name='Сухой док', cost={'food': 600, 'gold': 400}, time=60, age=2, icon='СД',
         desc='Корабли: +15% скорость; транспорт +10 мест',
         effects=[{'stat': 'speed', 'cls': SHIPS, 'mul': 1.15}, {'stat': 'cargo', 'kind': 'transport_ship', 'add': 10}])
add_tech('galleon', at='dock', name='Галеон', cost={'food': 400, 'wood': 315}, time=65, age=3, req='war_galley',
         upgrade=('war_galley', 'galleon'), desc='Боевые галеры → галеоны: 165 ОЗ, 8 атака, 7 дальность')
add_tech('fast_fire_ship', at='dock', name='Быстрый брандер', cost={'wood': 280, 'gold': 250}, time=50, age=3,
         req='fire_ship', upgrade=('fire_ship', 'fast_fire_ship'), desc='Брандеры → быстрые брандеры')
add_tech('heavy_demolition_ship', at='dock', name='Тяжёлый подрывник', cost={'wood': 200, 'gold': 300}, time=50,
         age=3, upgrade=('demolition_ship', 'heavy_demolition_ship'), desc='Подрывники: 140 атака')
add_tech('shipwright', at='dock', name='Корабельщики', cost={'food': 1000, 'gold': 300}, time=60, age=3, icon='Кб',
         desc='Корабли на 20% дешевле по дереву',
         effects=[{'stat': 'cost', 'cls': SHIPS, 'res': 'wood', 'mul': 0.8}])
