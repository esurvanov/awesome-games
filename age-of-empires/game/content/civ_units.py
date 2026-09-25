"""Уникальные юниты цивилизаций (обучаются в замке, элитное улучшение там же) и уникальные технологии
(замковая и имперская). Числа — значения Definitive Edition, приведённые к шкалам игры
(скорость — клетки/с, перезарядка и время — игровые секунды).

Запись юнита/технологии с полем 'civ' доступна только этой цивилизации (см. world.civ_bans).
Особые приёмы — через хуки:
  'on_attack'(unit, world, target, dmg) — после каждого удара/выстрела (залп чо-ко-ну, топтание);
  'regen' — ОЗ в секунду (берсерк; тик в WORLD_HOOKS), стат 'regen' умножает (Берсеркганг).
Классы брони: все уникальные юниты — доп. класс 'unique' (против него бонус у самурая).
"""
import math
import random

from . import add_unit, add_tech, add_trains
from .. import civ_art as art
from ..data import TILE, UNITS, BUILDINGS, WORLD_HOOKS

UNIQUE = {}         # цивилизация → [базовые виды уникальных юнитов]
UTECHS = {}         # цивилизация → [замковая, имперская]


# ============================================================ особые приёмы
def _volley(u, w, t, dmg):
    """Чо-ко-ну: кроме основной стрелы — ещё n стрел по 'volley_atk' урона в цель и рядом."""
    n, a = u.d['volley']
    hrow = w.hmat[u.owner]
    near = [o for o in w.units if hrow[o.owner] and o.alive and abs(o.x - t.x) < 1.6 * TILE
            and abs(o.y - t.y) < 1.6 * TILE] if hasattr(t, 'radius') else []
    for i in range(n):
        tt = random.choice(near) if near and random.random() < 0.6 else t
        if not tt.alive:
            continue
        pa = tt.armor()[1]
        w.fire(u, tt, max(1, a - pa), delay=0.05 * (i + 1), sound=False)


def _trample(u, w, t, dmg):
    """Топтание: урон по врагам вокруг цели (боевой слон — всегда; катафракт — с Логистикой)."""
    frac, flat = u.d.get('trample', (0.0, 0))
    flat += u.p.stat('trample', u.kind, 0)
    if frac <= 0 and flat <= 0:
        return
    if not hasattr(t, 'radius'):
        return          # по зданиям не топчет
    r = 0.6 * TILE
    tx, ty = t.x, t.y
    hrow = w.hmat[u.owner]
    for o in w.units:
        if o is t or not o.alive or not hrow[o.owner] or getattr(o, 'naval', False):
            continue
        if abs(o.x - tx) > r + o.radius or abs(o.y - ty) > r + o.radius:
            continue
        if math.hypot(o.x - tx, o.y - ty) <= r + o.radius:
            w.damage(o, u, max(1, int(dmg * frac + flat)))


_regen_t = [0.0]


def _regen_tick(w, dt):
    """Раз в секунду: юниты с 'regen' (берсерки) восстанавливают здоровье."""
    _regen_t[0] -= dt
    if _regen_t[0] > 0:
        return
    _regen_t[0] = 1.0
    for u in w.units:
        r = u.d.get('regen')
        if r and u.hp < u.max_hp and u.alive:
            u.hp = min(u.max_hp, u.hp + r * u.p.stat('regen', u.kind, 1.0))


WORLD_HOOKS['tick'].append(_regen_tick)


# ============================================================ регистрация
def unique(civ, key, elite, up_cost, look, elite_look, **d):
    """Уникальный юнит key и его элитная версия. elite — поля, отличающиеся у элиты (name, hp, atk…)."""
    d.setdefault('radius', 8)
    d.setdefault('age', 2)
    ac = tuple(d.pop('ac', ())) + ('unique',)
    base = dict(d, civ=civ, ac=ac, line=key, art=look)
    add_unit(key, **base)
    ek = 'elite_' + key
    e = dict(base, art=elite_look, age=3, **{k: v for k, v in elite.items() if k != 'name'})
    e['name'] = elite['name']
    add_unit(ek, **e)
    add_tech(ek, at='castle', name=e['name'], cost=up_cost, time=60, age=3, civ=civ,
             upgrade=(key, ek), desc=elite.get('udesc', f'{d["name"]} → элита'))
    add_trains('castle', key)
    UNIQUE.setdefault(civ, []).append(key)


def utech(civ, key, age, **d):
    add_tech(key, at='castle', age=age, time=d.pop('time', 60), civ=civ, **d)
    UTECHS.setdefault(civ, []).append(key)


FOOT_ARCH = ('archer', 'crossbowman', 'arbalester', 'longbowman', 'elite_longbowman',
             'chu_ko_nu', 'elite_chu_ko_nu')

# ---- Франки: метатель топоров (дальний «ближний» урон)
unique('franks', 'throwing_axeman', dict(name='Элитный метатель топоров', hp=70, atk=8, rng=4, arm=(1, 0), los=6,
                                          udesc='70 ОЗ, 8 атака, дальность 4'),
       {'food': 1000, 'gold': 850}, art.axeman(False), art.axeman(True),
       name='Метатель топоров', hp=60, atk=7, rng=3, reload=2.0, arm=(0, 0), speed=1.0, los=5,
       cost={'food': 55, 'gold': 25}, time=17, cls='inf', dtype='melee', shot='javelin', shot_speed=240,
       bonus={'bld': 1}, desc='Бросает топоры: ближний урон издалека')
utech('franks', 'bearded_axe', 2, name='Бородовидный топор', cost={'food': 400, 'gold': 400}, icon='Бт',
      desc='Метатели топоров: +1 дальность',
      effects=[{'stat': 'rng', 'kind': ('throwing_axeman', 'elite_throwing_axeman'), 'add': 1}])
utech('franks', 'chivalry', 3, name='Рыцарство', cost={'food': 400, 'gold': 400}, icon='Ры',
      desc='Конюшня обучает на 40% быстрее',
      effects=[{'stat': 'time', 'kind': ('scout', 'light_cavalry', 'hussar', 'knight', 'cavalier', 'paladin',
                                         'camel_rider', 'heavy_camel_rider'), 'mul': 1 / 1.4}])

# ---- Британцы: длинный лук
unique('britons', 'longbowman', dict(name='Элитный длинный лук', hp=40, atk=7, rng=6, los=8, acc=0.9,
                                      udesc='40 ОЗ, 7 атака, дальность 6'),
       {'food': 850, 'gold': 850}, art.longbow(False), art.longbow(True),
       name='Длинный лук', hp=35, atk=6, rng=5, reload=2.0, arm=(0, 1), speed=0.96, los=7, acc=0.8,
       cost={'wood': 35, 'gold': 40}, time=18, cls='arch', ac=('foot_arch',), bonus={'spear': 3},
       desc='Стрелок, дальность 5')
utech('britons', 'yeomen', 2, name='Йомены', cost={'wood': 750, 'gold': 450}, icon='Йо',
      desc='Пешие лучники +1 дальность, башни +2 атака',
      effects=[{'stat': 'rng', 'kind': FOOT_ARCH, 'add': 1},
               {'stat': 'atk', 'kind': ('tower', 'guard_tower', 'keep'), 'add': 2}])
utech('britons', 'warwolf', 3, name='Волк войны', cost={'wood': 800, 'gold': 400}, icon='Вв',
      desc='Требушеты: 100% точность, +20% по зданиям',
      effects=[{'stat': 'acc', 'kind': 'trebuchet', 'add': 1},
               {'stat': 'bonus:bld', 'kind': 'trebuchet', 'mul': 1.2}])

# ---- Монголы: мангудай (конный лучник против осады)
unique('mongols', 'mangudai', dict(name='Элитный мангудай', hp=65, atk=8, arm=(1, 0), bonus={'siege': 5, 'spear': 1},
                                    udesc='65 ОЗ, 8 атака, +5 против осады'),
       {'food': 1100, 'gold': 675}, art.mangudai(False), art.mangudai(True),
       name='Мангудай', hp=60, atk=6, rng=4, reload=2.1, arm=(0, 0), speed=1.43, los=6, acc=0.95,
       cost={'wood': 55, 'gold': 65}, time=26, cls='cav', ac=('arch', 'cav_arch'), bonus={'siege': 3, 'spear': 1},
       radius=11, desc='Конный лучник, +3 против осады')
utech('mongols', 'nomads', 2, name='Кочевники', cost={'wood': 300}, icon='Кч',
      desc='Разрушенные дома не уменьшают лимит населения')
utech('mongols', 'drill', 3, name='Муштра', cost={'food': 500, 'gold': 450}, icon='Му',
      desc='Осадные орудия +50% скорость',
      effects=[{'stat': 'speed', 'cls': 'siege', 'not_cls': ('ship',), 'mul': 1.5}])

# ---- Византийцы: катафракт
unique('byzantines', 'cataphract', dict(name='Элитный катафракт', hp=150, atk=12, bonus={'inf': 16},
                                         udesc='150 ОЗ, 12 атака, +16 против пехоты'),
       {'food': 1600, 'gold': 800}, art.cataphract(False), art.cataphract(True),
       name='Катафракт', hp=110, atk=9, rng=0, reload=1.7, arm=(2, 1), speed=1.35, los=4,
       cost={'food': 70, 'gold': 75}, time=20, cls='cav', bonus={'inf': 12}, carm={'cav': 12},
       on_attack=_trample, radius=12, desc='Тяжёлая конница, +12 против пехоты')
utech('byzantines', 'greek_fire', 2, name='Греческий огонь', cost={'food': 250, 'gold': 300}, icon='Гр',
      desc='Брандеры +1 дальность',
      effects=[{'stat': 'rng', 'kind': ('fire_galley', 'fire_ship', 'fast_fire_ship'), 'add': 1}])
utech('byzantines', 'logistica', 3, name='Логистика', cost={'food': 800, 'gold': 600}, icon='Лг',
      desc='Катафракты топчут (5 урона вокруг), +6 против пехоты',
      effects=[{'stat': 'trample', 'kind': ('cataphract', 'elite_cataphract'), 'add': 5},
               {'stat': 'bonus:inf', 'kind': ('cataphract', 'elite_cataphract'), 'add': 6}])

# ---- Тевтоны: тевтонский рыцарь
unique('teutons', 'teutonic_knight', dict(name='Элитный тевтонский рыцарь', hp=100, atk=17, arm=(10, 2),
                                           udesc='100 ОЗ, 17 атака, 10/2 броня'),
       {'food': 1200, 'gold': 600}, art.teutonic(False), art.teutonic(True),
       name='Тевтонский рыцарь', hp=80, atk=12, rng=0, reload=2.0, arm=(5, 2), speed=0.8, los=3,
       cost={'food': 85, 'gold': 40}, time=12, cls='inf', bonus={'bld': 4}, desc='Медленная латная пехота')
utech('teutons', 'ironclad', 2, name='Броненосцы', cost={'wood': 400, 'gold': 350}, icon='Бр',
      desc='Осадные орудия +4 ближняя броня',
      effects=[{'stat': 'arm_m', 'cls': 'siege', 'not_cls': ('ship',), 'add': 4}])
utech('teutons', 'crenellations', 3, name='Бойницы с зубцами', cost={'food': 600, 'stone': 400}, icon='Зу',
      desc='Замки +3 дальность',
      effects=[{'stat': 'rng', 'kind': 'castle', 'add': 3}])

# ---- Японцы: самурай (против уникальных юнитов)
unique('japanese', 'samurai', dict(name='Элитный самурай', hp=80, atk=12, bonus={'unique': 12, 'bld': 2},
                                    udesc='80 ОЗ, 12 атака, +12 против уникальных'),
       {'food': 950, 'gold': 875}, art.samurai(False), art.samurai(True),
       name='Самурай', hp=60, atk=8, rng=0, reload=1.45, arm=(1, 1), speed=1.0, los=4,
       cost={'food': 60, 'gold': 30}, time=9, cls='inf', bonus={'unique': 10, 'bld': 2},
       desc='Быстрые удары, +10 против уникальных')
utech('japanese', 'yasama', 2, name='Ясама', cost={'food': 300, 'wood': 300}, icon='Яс',
      desc='Башни: +2 стрелы',
      effects=[{'stat': 'arrows', 'kind': ('tower', 'guard_tower', 'keep'), 'add': 2}])
utech('japanese', 'kataparuto', 3, name='Катапаруто', cost={'wood': 550, 'gold': 600}, icon='Кт',
      desc='Требушеты стреляют на 33% быстрее',
      effects=[{'stat': 'reload', 'kind': 'trebuchet', 'mul': 1 / 1.33}])

# ---- Китайцы: чо-ко-ну (залп из нескольких стрел)
unique('chinese', 'chu_ko_nu', dict(name='Элитный чо-ко-ну', hp=50, volley=(4, 3),
                                     udesc='50 ОЗ, залп из 5 стрел'),
       {'food': 760, 'gold': 760}, art.chukonu(False), art.chukonu(True),
       name='Чо-ко-ну', hp=45, atk=8, rng=4, reload=3.0, arm=(0, 0), speed=0.96, los=6, acc=0.85,
       cost={'wood': 40, 'gold': 35}, time=19, cls='arch', ac=('foot_arch',), bonus={'spear': 3},
       volley=(2, 3), on_attack=_volley, shot='bolt', desc='Залп из 3 стрел')
utech('chinese', 'great_wall', 2, name='Великая стена', cost={'wood': 400, 'stone': 200}, icon='Вс',
      desc='Стены и башни +30% ОЗ',
      effects=[{'stat': 'hp', 'kind': ('palisade_wall', 'palisade_gate', 'stone_wall', 'gate', 'tower',
                                       'guard_tower', 'keep'), 'mul': 1.3}])
utech('chinese', 'rocketry', 3, name='Ракеты', cost={'wood': 750, 'gold': 750}, icon='Рк',
      desc='Чо-ко-ну +2 атака, скорпионы +4',
      effects=[{'stat': 'atk', 'kind': ('chu_ko_nu', 'elite_chu_ko_nu'), 'add': 2},
               {'stat': 'atk', 'kind': ('scorpion', 'heavy_scorpion'), 'add': 4}])

# ---- Персы: боевой слон (огромный, топчет)
unique('persians', 'war_elephant', dict(name='Элитный боевой слон', hp=600, atk=20, arm=(1, 3),
                                         udesc='600 ОЗ, 20 атака'),
       {'food': 1600, 'gold': 1200}, art.elephant(False), art.elephant(True),
       name='Боевой слон', hp=450, atk=15, rng=0, reload=2.0, arm=(1, 2), speed=0.6, los=4,
       cost={'food': 120, 'gold': 70}, time=25, cls='cav', ac=('elephant',), bonus={'bld': 7},
       trample=(0.25, 0), on_attack=_trample, radius=17, bar_h=52, icon_k=0.52, desc='Огромный, топчет всех вокруг')
utech('persians', 'kamandaran', 2, name='Камандаран', cost={'food': 400, 'gold': 300}, icon='Км',
      desc='Лучники: золото в цене заменено деревом',
      effects=[{'stat': 'cost', 'kind': ('archer', 'crossbowman', 'arbalester'), 'res': 'gold', 'mul': 0},
               {'stat': 'cost', 'kind': ('archer', 'crossbowman', 'arbalester'), 'res': 'wood', 'add': 45}])
utech('persians', 'mahouts', 3, name='Махауты', cost={'food': 300, 'gold': 300}, icon='Мх',
      desc='Боевые слоны +30% скорость',
      effects=[{'stat': 'speed', 'kind': ('war_elephant', 'elite_war_elephant'), 'mul': 1.3}])

# ---- Сарацины: мамлюк (верблюд, бьёт саблей с 3 клеток)
unique('saracens', 'mameluke', dict(name='Элитный мамлюк', hp=80, atk=9, arm=(1, 0), bonus={'cav': 12},
                                     udesc='80 ОЗ, 9 атака, +12 против конницы'),
       {'food': 600, 'gold': 500}, art.mameluke(False), art.mameluke(True),
       name='Мамлюк', hp=65, atk=7, rng=3, reload=2.0, arm=(0, 0), speed=1.4, los=5,
       cost={'food': 55, 'gold': 85}, time=23, cls='cav', ac=('camel',), dtype='melee', shot='javelin',
       bonus={'cav': 9}, radius=11, bar_h=40, desc='Верблюд, ближний урон с 3 клеток, +9 против конницы')
utech('saracens', 'bimaristan', 2, name='Бимаристан', cost={'wood': 300, 'gold': 200}, icon='Би',
      desc='Монахи лечат втрое быстрее',
      effects=[{'stat': 'heal', 'kind': 'monk', 'mul': 3}])
utech('saracens', 'zealotry', 3, name='Фанатизм', cost={'food': 750, 'gold': 800}, icon='Фн',
      desc='Верблюды и мамлюки +20 ОЗ',
      effects=[{'stat': 'hp', 'cls': 'camel', 'add': 20}])

# ---- Турки: янычар (порох)
unique('turks', 'janissary', dict(name='Элитный янычар', hp=44, atk=22, arm=(2, 0), acc=0.65,
                                   udesc='44 ОЗ, 22 атака'),
       {'food': 850, 'gold': 750}, art.janissary(False), art.janissary(True),
       name='Янычар', hp=35, atk=17, rng=8, reload=3.45, arm=(1, 0), speed=0.96, los=10, acc=0.5,
       cost={'food': 60, 'gold': 55}, time=17, cls='arch', ac=('gunpowder',), shot='ball', shot_speed=420,
       desc='Ружьё: 17 урона, дальность 8')
utech('turks', 'sipahi', 2, name='Сипахи', cost={'food': 350, 'gold': 150}, icon='Си',
      desc='Конные лучники +20 ОЗ',
      effects=[{'stat': 'hp', 'kind': ('cavalry_archer', 'heavy_cavalry_archer'), 'add': 20}])
utech('turks', 'artillery', 3, name='Артиллерия', cost={'wood': 500, 'gold': 450}, icon='Ар',
      desc='Бомбарды и пушечные галеоны +2 дальность',
      effects=[{'stat': 'rng', 'kind': ('bombard_cannon', 'cannon_galleon'), 'add': 2}])

# ---- Викинги: берсерк (лечится сам)
unique('vikings', 'berserk', dict(name='Элитный берсерк', hp=62, atk=14, arm=(2, 1),
                                   udesc='62 ОЗ, 14 атака, 2/1 броня'),
       {'food': 1300, 'gold': 550}, art.berserk(False), art.berserk(True),
       name='Берсерк', hp=54, atk=9, rng=0, reload=2.0, arm=(0, 1), speed=1.05, los=3,
       cost={'food': 65, 'gold': 25}, time=14, cls='inf', regen=40 / 60, bonus={'bld': 2},
       desc='Сам восстанавливает здоровье')
utech('vikings', 'chieftains', 2, name='Вожди', cost={'food': 400, 'gold': 300}, icon='Вж',
      desc='Пехота +5 против конницы',
      effects=[{'stat': 'bonus:cav', 'cls': 'inf', 'add': 5}])
utech('vikings', 'berserkergang', 3, name='Берсеркганг', cost={'food': 850, 'gold': 400}, icon='Бг',
      desc='Берсерки лечатся вдвое быстрее',
      effects=[{'stat': 'regen', 'kind': ('berserk', 'elite_berserk'), 'mul': 2}])

# ---- Готы: хускарл (стрелы почти не берут); «Анархия» открывает его в казармах
unique('goths', 'huskarl', dict(name='Элитный хускарл', hp=70, atk=12, arm=(0, 8), bonus={'arch': 10, 'bld': 3},
                                 udesc='70 ОЗ, 0/8 броня, +10 против стрелков'),
       {'food': 1200, 'gold': 550}, art.huskarl(False), art.huskarl(True),
       name='Хускарл', hp=60, atk=10, rng=0, reload=2.0, arm=(0, 6), speed=1.05, los=3,
       cost={'food': 52, 'gold': 26}, time=16, cls='inf', bonus={'arch': 6, 'bld': 2},
       desc='Щит от стрел, +6 против стрелков')
add_trains('barracks', 'huskarl')


def _anarchy(w, p):
    p.banned.discard(('barracks', 'huskarl'))


utech('goths', 'anarchy', 2, name='Анархия', cost={'food': 450, 'gold': 250}, icon='Ан',
      desc='Хускарлы обучаются в казармах', on_apply=_anarchy)
utech('goths', 'perfusion', 3, name='Перфузия', cost={'wood': 400, 'gold': 600}, icon='Пф',
      desc='Казармы обучают вдвое быстрее',
      effects=[{'stat': 'time', 'kind': tuple(BUILDINGS['barracks']['trains']) + (
          'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion', 'pikeman', 'halberdier',
          'elite_huskarl'), 'mul': 0.5}])

# ---- Кельты: вайдовый воин (очень быстрый)
unique('celts', 'woad_raider', dict(name='Элитный вайдовый воин', hp=80, atk=13, arm=(0, 1),
                                     udesc='80 ОЗ, 13 атака'),
       {'food': 1000, 'gold': 800}, art.woad(False), art.woad(True),
       name='Вайдовый воин', hp=65, atk=8, rng=0, reload=2.0, arm=(0, 1), speed=1.38, los=5,
       cost={'food': 65, 'gold': 25}, time=10, cls='inf', bonus={'bld': 2}, desc='Быстрая пехота')
utech('celts', 'stronghold', 2, name='Твердыня', cost={'food': 250, 'gold': 200}, icon='Тв',
      desc='Замки и башни стреляют на 25% быстрее',
      effects=[{'stat': 'reload', 'kind': ('castle', 'tower', 'guard_tower', 'keep'), 'mul': 0.8}])
utech('celts', 'furor_celtica', 3, name='Кельтская ярость', cost={'food': 750, 'gold': 450}, icon='Кя',
      desc='Осадные орудия +40% ОЗ',
      effects=[{'stat': 'hp', 'cls': 'siege', 'not_cls': ('ship',), 'mul': 1.4}])

# ---- Испанцы: конкистадор (конный стрелок с ружьём)
unique('spanish', 'conquistador', dict(name='Элитный конкистадор', hp=70, atk=18, acc=0.7,
                                        udesc='70 ОЗ, 18 атака'),
       {'food': 1200, 'gold': 600}, art.conquistador(False), art.conquistador(True),
       name='Конкистадор', hp=55, atk=16, rng=6, reload=2.9, arm=(2, 2), speed=1.3, los=6, acc=0.65,
       cost={'food': 60, 'gold': 70}, time=24, cls='cav', ac=('gunpowder',), shot='ball', shot_speed=420,
       radius=11, desc='Всадник с ружьём, 16 урона')
utech('spanish', 'inquisition', 2, name='Инквизиция', cost={'food': 100, 'gold': 300}, icon='Ин',
      desc='Монахи обращают быстрее',
      effects=[{'stat': 'conv_speed', 'kind': 'monk', 'mul': 1.6}])
utech('spanish', 'supremacy', 3, name='Превосходство', cost={'food': 400, 'gold': 250}, icon='Пр',
      desc='Жители: +6 атака, +2/+2 броня, +40 ОЗ',
      effects=[{'stat': 'atk', 'kind': 'villager', 'add': 6},
               {'stat': 'arm_m', 'kind': 'villager', 'add': 2},
               {'stat': 'arm_p', 'kind': 'villager', 'add': 2},
               {'stat': 'hp', 'kind': 'villager', 'add': 40}])


# ---- «Кочевники»: дом с технологией не уносит население при разрушении
def _house_removed(w, b):
    p = b.p
    if p is not None and b.complete and 'nomads' in p.techs:
        p.pop_keep += b.d.get('pop', 0)


BUILDINGS['house']['on_remove'] = _house_removed

# в замке: сначала уникальные юниты, требушет — последним
_tr = BUILDINGS['castle']['trains']
if 'trebuchet' in _tr:
    _tr.remove('trebuchet')
    _tr.append('trebuchet')
assert all(UNITS[k].get('civ') for c in UNIQUE.values() for k in c)
