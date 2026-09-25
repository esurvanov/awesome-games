"""Кузница — полный набор: атака пехоты/конницы, атака стрелков (и башен/центра/замка), броня пехоты,
конницы и стрелков. Цены, время, эпохи и цепочки (req) — как в DE."""
from . import add_tech
from ..data import BUILDINGS

MELEE = {'cls': ('inf', 'cav'), 'not_cls': ('arch',)}             # пехота и конница (без конных лучников)
ARCH = {'cls': 'arch', 'not_cls': ('gunpowder',)}                   # лучники, застрельщики, конные лучники
INF = {'cls': 'inf'}
CAV = {'cls': 'cav', 'not_cls': ('arch',)}
ARCH_ARMOR = {'cls': 'arch'}


def _atk(f, n):
    return [dict(f, stat='atk', add=n)]


def _arm(f, m, p):
    return [dict(f, stat='arm_m', add=m), dict(f, stat='arm_p', add=p)]


def _arrows(n):
    # стрелы лучников, а также городского центра, башен и замка: +1 атака, +1 дальность
    return [dict(ARCH, stat='atk', add=n), dict(ARCH, stat='rng', add=1),
            {'stat': 'atk', 'cls': 'bld', 'add': n}, {'stat': 'rng', 'cls': 'bld', 'add': 1}]


T = dict(at='blacksmith')
# атака ближнего боя
add_tech('forging', name='Ковка', cost={'food': 150}, time=50, age=1, icon='К1',
         desc='+1 атака пехоте и коннице', effects=_atk(MELEE, 1), **T)
add_tech('iron_casting', name='Литьё железа', cost={'food': 220, 'gold': 120}, time=75, age=2, icon='К2',
         req='forging', desc='+1 атака пехоте и коннице', effects=_atk(MELEE, 1), **T)
add_tech('blast_furnace', name='Доменная печь', cost={'food': 275, 'gold': 225}, time=100, age=3, icon='К3',
         req='iron_casting', desc='+2 атака пехоте и коннице', effects=_atk(MELEE, 2), **T)
# стрелы
add_tech('fletching', name='Оперение', cost={'food': 100, 'gold': 50}, time=30, age=1, icon='С1',
         desc='+1 атака и дальность стрелкам и башням', effects=_arrows(1), **T)
add_tech('bodkin_arrow', name='Бронебойная стрела', cost={'food': 200, 'gold': 100}, time=35, age=2, icon='С2',
         req='fletching', desc='+1 атака и дальность стрелкам и башням', effects=_arrows(1), **T)
add_tech('bracer', name='Наруч', cost={'food': 300, 'gold': 200}, time=40, age=3, icon='С3',
         req='bodkin_arrow', desc='+1 атака и дальность стрелкам и башням', effects=_arrows(1), **T)
# броня пехоты
add_tech('scale_armor', name='Чешуйчатый доспех', cost={'food': 100}, time=40, age=1, icon='П1',
         desc='Пехота: +1/+1 броня', effects=_arm(INF, 1, 1), **T)
add_tech('chain_mail', name='Кольчуга', cost={'food': 200, 'gold': 100}, time=55, age=2, icon='П2',
         req='scale_armor', desc='Пехота: +1/+1 броня', effects=_arm(INF, 1, 1), **T)
add_tech('plate_mail', name='Латы', cost={'food': 300, 'gold': 150}, time=70, age=3, icon='П3',
         req='chain_mail', desc='Пехота: +1/+2 броня', effects=_arm(INF, 1, 2), **T)
# броня конницы
add_tech('scale_barding', name='Чешуйчатая попона', cost={'food': 150}, time=45, age=1, icon='Л1',
         desc='Конница: +1/+1 броня', effects=_arm(CAV, 1, 1), **T)
add_tech('chain_barding', name='Кольчужная попона', cost={'food': 250, 'gold': 150}, time=60, age=2, icon='Л2',
         req='scale_barding', desc='Конница: +1/+1 броня', effects=_arm(CAV, 1, 1), **T)
add_tech('plate_barding', name='Латная попона', cost={'food': 350, 'gold': 200}, time=75, age=3, icon='Л3',
         req='chain_barding', desc='Конница: +1/+2 броня', effects=_arm(CAV, 1, 2), **T)
# броня стрелков
add_tech('padded_archer_armor', name='Стёганка лучника', cost={'food': 100}, time=40, age=1, icon='Б1',
         desc='Стрелки: +1/+1 броня', effects=_arm(ARCH_ARMOR, 1, 1), **T)
add_tech('leather_archer_armor', name='Кожаный доспех лучника', cost={'food': 150, 'gold': 150}, time=55, age=2,
         icon='Б2', req='padded_archer_armor', desc='Стрелки: +1/+1 броня', effects=_arm(ARCH_ARMOR, 1, 1), **T)
add_tech('ring_archer_armor', name='Кольчуга лучника', cost={'food': 250, 'gold': 250}, time=70, age=3, icon='Б3',
         req='leather_archer_armor', desc='Стрелки: +1/+2 броня', effects=_arm(ARCH_ARMOR, 1, 2), **T)

# порядок кнопок в кузнице: по рядам (атака, стрелы, броня пехоты, конницы, стрелков)
_ORDER = ['forging', 'iron_casting', 'blast_furnace', 'fletching', 'bodkin_arrow',
          'bracer', 'scale_armor', 'chain_mail', 'plate_mail', 'scale_barding',
          'chain_barding', 'plate_barding', 'padded_archer_armor', 'leather_archer_armor', 'ring_archer_armor']
BUILDINGS['blacksmith']['techs'] = _ORDER + [t for t in BUILDINGS['blacksmith']['techs'] if t not in _ORDER]
