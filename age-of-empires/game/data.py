"""Константы и таблицы игры.

Характеристики юнитов, зданий и технологий повторяют правила классической
исторической RTS (значения — игровые секунды, клетки, клетки в секунду).
Игровое время идёт в 1.7 раза быстрее реального, как «нормальная» скорость.
"""
import math

TITLE = 'Хроники Королевств'

# ---- мир
TILE = 32                  # логический размер клетки (симуляция идёт в квадратной сетке)
MAP_W = MAP_H = 96         # размер по умолчанию; настоящий размер — World.W / World.H
MAP_SIZES = {2: 120, 3: 144, 4: 168, 5: 200, 6: 200, 7: 220, 8: 220}   # сторона карты по числу игроков (DE)
MAX_PLAYERS = 8
GAME_SPEED = 1.7           # игровых секунд в реальной секунде

# ---- изометрия: клетка на экране — ромб 64×32
HW, HH = 32, 16
ISO_OX = MAP_H * HW        # сдвиг, чтобы левый угол карты был в x=0 (для карты по умолчанию)
ISO_TW = (MAP_W + MAP_H) * HW
ISO_TH = (MAP_W + MAP_H) * HH

# ---- экран
SCREEN_W, SCREEN_H = 1280, 800
# Интерфейс в пропорциях AoE2 DE (HUD 100 %, приведён к высоте 800): верх ≈ 6 % высоты,
# снизу две панели — команды (≈ 65 % ширины, 21 % высоты) и мини-карта (≈ 29 % × 23 %), между ними виден мир.
TOP_H = 48
PANEL_H = 168              # высота панели команд; мир рисуется до низа экрана (окно между панелями)
VIEW_H = SCREEN_H - TOP_H - PANEL_H   # «основное» окно камеры (над панелью команд)
FPS = 60

RES = ('food', 'wood', 'gold', 'stone')
RES_NAME = {'food': 'Еда', 'wood': 'Дерево', 'gold': 'Золото', 'stone': 'Камень'}
RES_COLOR = {'food': (215, 60, 50), 'wood': (150, 100, 55), 'gold': (240, 200, 40), 'stone': (165, 165, 175)}
START_RES = {'food': 200, 'wood': 200, 'gold': 100, 'stone': 200}

# 8 цветов игроков в порядке и оттенках AoE II DE (цвета спрайтов, aoe2-color-tool spritecolors.json):
# синий, красный, зелёный, жёлтый, бирюзовый, фиолетовый, серый, оранжевый
PLAYER_COLORS = [(0, 0, 255), (255, 0, 0), (0, 169, 27), (214, 214, 27),
                 (123, 239, 240), (138, 19, 247), (102, 102, 102), (255, 146, 5)]
COLOR_NAMES = ['Синий', 'Красный', 'Зелёный', 'Жёлтый', 'Бирюзовый', 'Фиолетовый', 'Серый', 'Оранжевый']
PLAYER_NAMES = ['Вы'] + COLOR_NAMES[1:]    # имя игрока по индексу (0 — человек)
GAIA = -1                                  # владелец «ничьих» объектов (природа)
AGE_NAMES = ['Тёмные века', 'Феодальная эпоха', 'Эпоха замков', 'Имперская эпоха']
DIFF_NAMES = ['Легко', 'Нормально', 'Сложно']

# ---- ресурсы на карте (скорость добычи — единиц в игровую секунду)
NODE_DEFS = {
    'tree':    {'res': 'wood',  'amount': 100, 'rate': 0.39, 'name': 'Дерево'},
    'berries': {'res': 'food',  'amount': 125, 'rate': 0.31, 'name': 'Ягодный куст'},
    'gold':    {'res': 'gold',  'amount': 800, 'rate': 0.38, 'name': 'Золотая жила'},
    'stone':   {'res': 'stone', 'amount': 350, 'rate': 0.36, 'name': 'Каменная залежь'},
}
# животные: hp, еда в туше, скорость разделки (ед/с), скорость бега (клетки/с)
ANIMALS = {
    'sheep': dict(name='Овца', hp=7, food=100, rate=0.33, speed=0.7, radius=8, los=2, atk=0, arm=(0, 0)),
    'deer':  dict(name='Олень', hp=5, food=140, rate=0.41, speed=1.2, radius=9, los=3, atk=0, arm=(0, 0)),
    'boar':  dict(name='Кабан', hp=75, food=340, rate=0.41, speed=1.2, radius=10, los=4, atk=8, arm=(0, 1)),
    # хищник (AoE2 DE): не даёт еды, сам нападает на юнитов игроков в обзоре; hunt=False — не добыча
    'wolf':  dict(name='Волк', hp=25, food=0, rate=0.0, speed=1.2, radius=8, los=6, atk=3, arm=(0, 0),
                  hunt=False, predator=True),
}
FARM_RATE = 0.32
FARM_FOOD = 175
CARRY = 10

# speed — клеток в секунду; rng, los — клетки; time — секунды обучения
UNITS = {
    'villager':   dict(name='Житель', hp=25, atk=3, rng=0, reload=2.0, arm=(0, 0), speed=0.8, los=4,
                       cost={'food': 50}, time=25, age=0, cls='vil', radius=7,
                       desc='Добывает ресурсы и строит'),
    'militia':    dict(name='Ополченец', hp=40, atk=4, rng=0, reload=2.0, arm=(0, 1), speed=0.9, los=4,
                       cost={'food': 60, 'gold': 20}, time=21, age=0, cls='inf', radius=8,
                       desc='Пехота ближнего боя'),
    'spearman':   dict(name='Копейщик', hp=45, atk=3, rng=0, reload=3.0, arm=(0, 0), speed=1.0, los=4,
                       cost={'food': 35, 'wood': 25}, time=22, age=1, cls='inf', radius=8, bonus={'cav': 15},
                       desc='Силён против конницы'),
    'archer':     dict(name='Лучник', hp=30, atk=4, rng=4, reload=2.0, arm=(0, 0), speed=0.96, los=6,
                       cost={'wood': 25, 'gold': 45}, time=35, age=1, cls='arch', radius=7,
                       desc='Стреляет издалека'),
    'skirmisher': dict(name='Застрельщик', hp=30, atk=2, rng=4, reload=3.0, arm=(0, 3), speed=0.96, los=6,
                       cost={'food': 25, 'wood': 35}, time=22, age=1, cls='arch', radius=7, bonus={'arch': 3},
                       desc='Силён против лучников'),
    'scout':      dict(name='Разведчик', hp=45, atk=3, rng=0, reload=2.0, arm=(0, 2), speed=1.55, los=6,
                       cost={'food': 80}, time=30, age=1, cls='cav', radius=11,
                       desc='Быстрая лёгкая конница'),
    'knight':     dict(name='Рыцарь', hp=100, atk=10, rng=0, reload=1.8, arm=(2, 2), speed=1.35, los=4,
                       cost={'food': 60, 'gold': 75}, time=30, age=2, cls='cav', radius=11,
                       desc='Тяжёлая конница'),
    'ram':        dict(name='Таран', hp=175, atk=2, rng=0, reload=5.0, arm=(0, 180), speed=0.5, los=3,
                       cost={'wood': 160, 'gold': 75}, time=36, age=2, cls='siege', radius=13, bonus={'bld': 125},
                       desc='Рушит здания, стрелы не берут'),
}

# size — сторона квадрата в клетках; time — секунды стройки одним жителем
BUILDINGS = {
    'town_center':    dict(name='Городской центр', size=4, hp=2400, cost={'wood': 275, 'stone': 100}, time=150,
                           age=2, pop=5, drop=('food', 'wood', 'gold', 'stone'), trains=['villager'],
                           techs=['feudal', 'castle', 'imperial', 'loom', 'wheelbarrow'],
                           atk=5, rng=6, reload=2.0, los=8, arm=(3, 5), desc='Жители, эпохи, склад'),
    'house':          dict(name='Дом', size=2, hp=550, cost={'wood': 25}, time=25, age=0, pop=5, los=2,
                           desc='+5 к населению'),
    'mill':           dict(name='Мельница', size=2, hp=600, cost={'wood': 100}, time=35, age=0, drop=('food',),
                           techs=['horse_collar'], desc='Склад еды'),
    'lumber_camp':    dict(name='Лесопилка', size=2, hp=600, cost={'wood': 100}, time=35, age=0, drop=('wood',),
                           techs=['double_bit'], desc='Склад дерева'),
    'mining_camp':    dict(name='Шахта', size=2, hp=600, cost={'wood': 100}, time=35, age=0,
                           drop=('gold', 'stone'), techs=['gold_mining'], desc='Склад золота и камня'),
    'farm':           dict(name='Ферма', size=3, hp=480, cost={'wood': 60}, time=15, age=0, walk=True, los=1,
                           desc='Возобновляемая еда'),
    'barracks':       dict(name='Казармы', size=3, hp=1200, cost={'wood': 175}, time=50, age=0,
                           trains=['militia', 'spearman'], los=5, desc='Пехота'),
    'archery_range':  dict(name='Стрельбище', size=3, hp=1500, cost={'wood': 175}, time=50, age=1,
                           trains=['archer', 'skirmisher'], los=5, desc='Стрелки'),
    'stable':         dict(name='Конюшня', size=3, hp=1500, cost={'wood': 175}, time=50, age=1,
                           trains=['scout', 'knight'], los=5, desc='Конница'),
    'blacksmith':     dict(name='Кузница', size=3, hp=2100, cost={'wood': 150}, time=40, age=1,
                           techs=['forging', 'fletching', 'scale_armor'], los=5, desc='Улучшения армии'),
    'tower':          dict(name='Сторожевая башня', size=1, hp=1020, cost={'wood': 25, 'stone': 125}, time=80,
                           age=1, atk=5, rng=8, reload=2.0, los=10, arm=(1, 7), desc='Стреляет по врагам'),
    'siege_workshop': dict(name='Осадная мастерская', size=4, hp=2100, cost={'wood': 200}, time=40, age=2,
                           trains=['ram'], los=5, desc='Тараны'),
    'castle':         dict(name='Замок', size=4, hp=4800, cost={'stone': 650}, time=200, age=2, pop=20,
                           atk=11, rng=8, reload=2.0, arrows=4, los=11, arm=(8, 11), desc='Мощная крепость'),
}
BUILDING_ARMOR = (0, 7)

# ---- модификаторы (технологии, бонусы цивилизаций, сложность)
# Эффект — словарь {'stat': ..., фильтры..., 'add': n, 'mul': k}; итог = (база + сумма add) × произведение mul.
# stat: 'atk', 'arm_m' (броня ближн.), 'arm_p' (броня дальн.), 'rng', 'speed', 'hp', 'los', 'reload',
#       'carry' (груз жителя), 'gather' (скорость добычи), 'farm_food' (еды в новой ферме),
#       'build' (скорость стройки), 'cost' (цена, по ресурсу 'res'), 'time' (время обучения/изучения),
#       армия: 'bonus:<класс>' (бонус урона против класса брони, напр. 'bonus:bld'), 'acc' (точность),
#       'lead' (>0 — стрельба с упреждением), 'faith' (скорость восстановления веры монаха), 'heal',
#       'convert_monk' / 'convert_siege' (>0 — монах обращает монахов / осадные). Классы брони — game/content/army_base.py.
# фильтры (все необязательны): 'kind' — вид юнита/здания/технологии (строка или кортеж),
#       'cls' / 'not_cls' — класс ('vil', 'inf', 'arch', 'cav', 'siege', 'monk', 'bld' — здания, 'tech' — технологии;
#       проверяются и доп. классы брони юнита из 'ac': 'spear', 'cav_arch', 'gunpowder', 'ram'…),
#       'res' — ресурс ('food', 'wood', 'gold', 'stone'), 'src' — источник добычи
#       ('tree', 'berries', 'gold', 'stone', 'farm', 'hunt').
# Игрок держит список активных эффектов и кэш по ключу — см. Player.mod() / Player.stat() в world.py.

TECHS = {
    'feudal':       dict(name='Феодальная эпоха', cost={'food': 500}, time=130, age=0, icon='II',
                         desc='Новые здания и войска'),
    'castle':       dict(name='Эпоха замков', cost={'food': 800, 'gold': 200}, time=160, age=1, icon='III',
                         desc='Рыцари, тараны, замки'),
    'imperial':     dict(name='Имперская эпоха', cost={'food': 1000, 'gold': 800}, time=190, age=2, icon='IV',
                         desc='+1 атака всем войскам',
                         effects=[{'stat': 'atk', 'not_cls': ('vil',), 'add': 1}]),
    'loom':         dict(name='Ткацкий станок', cost={'gold': 50}, time=25, age=0, icon='Тк',
                         desc='Жители: +15 ОЗ, +1/+2 броня',
                         effects=[{'stat': 'hp', 'kind': 'villager', 'add': 15},
                                  {'stat': 'arm_m', 'kind': 'villager', 'add': 1},
                                  {'stat': 'arm_p', 'kind': 'villager', 'add': 2}]),
    'wheelbarrow':  dict(name='Тачка', cost={'food': 175, 'wood': 50}, time=75, age=1, icon='Тч',
                         desc='Жители: +10% скорость, +25% груз',
                         effects=[{'stat': 'speed', 'kind': 'villager', 'mul': 1.1},
                                  {'stat': 'carry', 'kind': 'villager', 'mul': 1.25}]),
    'double_bit':   dict(name='Двуручный топор', cost={'food': 100, 'wood': 50}, time=25, age=1, icon='Т+',
                         desc='+20% добыча дерева',
                         effects=[{'stat': 'gather', 'res': 'wood', 'mul': 1.2}]),
    'gold_mining':  dict(name='Добыча золота', cost={'food': 100, 'wood': 75}, time=30, age=1, icon='З+',
                         desc='+15% добыча золота',
                         effects=[{'stat': 'gather', 'res': 'gold', 'mul': 1.15}]),
    'horse_collar': dict(name='Хомут', cost={'food': 75, 'wood': 75}, time=20, age=1, icon='Х',
                         desc='+75 еды на новых фермах',
                         effects=[{'stat': 'farm_food', 'add': 75}]),
    'forging':      dict(name='Ковка', cost={'food': 150}, time=50, age=1, icon='А+',
                         desc='+1 атака пехоте и коннице',
                         effects=[{'stat': 'atk', 'cls': ('inf', 'cav'), 'add': 1}]),
    'fletching':    dict(name='Оперение', cost={'food': 100, 'gold': 50}, time=30, age=1, icon='Л+',
                         desc='+1 атака и дальность стрелкам',
                         effects=[{'stat': 'atk', 'cls': 'arch', 'add': 1},
                                  {'stat': 'rng', 'cls': 'arch', 'add': 1}]),
    'scale_armor':  dict(name='Чешуйчатая броня', cost={'food': 100}, time=40, age=1, icon='Б+',
                         desc='+1/+1 броня войскам',
                         effects=[{'stat': 'arm_m', 'cls': ('inf', 'cav', 'arch'), 'add': 1},
                                  {'stat': 'arm_p', 'cls': ('inf', 'cav', 'arch'), 'add': 1}]),
}
# Линии улучшений: технология с 'upgrade': (старый, новый) по завершении превращает всех юнитов
# старого вида в новый, а здания обучают новый вид (Player.current()). 'req' — нужные технологии.

# ---- цивилизации: постоянные эффекты, выдаются игроку в начале партии (Player.set_civ)
# Поля записи (кроме name/effects — все необязательны; наполняет game/content/civs.py):
#   'team' — командный бонус (эффекты всем союзникам, включая себя; одинаковые цивилизации не складываются),
#   'start' — {ресурс: +n} к стартовым, 'start_units' — {вид: +n} доп. юнитов у центра,
#   'ages' — {эпоха 1..3: [эффекты]} — выдаются при достижении эпохи (цены «по эпохам», ОЗ зданий…),
#   'free' — {эпоха: [технологии]} — изучаются бесплатно при достижении эпохи,
#   'pop_bonus' — {эпоха: +n} к лимиту населения, 'pop_extra' — {здание: +n населения},
#   'disabled' — недоступные виды юнитов/технологий/зданий (дерево технологий; зависимое — тоже, см. world.civ_bans),
#   'banned_at' — пары (здание, юнит): где юнит не обучается, пока технология не снимет запрет.
# Уникальные юниты и технологии помечаются 'civ': ключ цивилизации — другим цивилизациям они недоступны.
CIVS = {
    'default': dict(name='Королевство', effects=[]),
}
# Хуки мира для контента: 'init' — fn(world) после генерации карты; 'tick' — fn(world, dt) каждый шаг.
WORLD_HOOKS = {'init': [], 'tick': []}
AGE_TECHS = ('feudal', 'castle', 'imperial')
AGE_REQ = {
    'feudal': ({'mill', 'lumber_camp', 'mining_camp', 'barracks'}, 2),
    'castle': ({'archery_range', 'stable', 'blacksmith'}, 2),
    'imperial': ({'siege_workshop', 'castle'}, 1),
}

BUILD_MENU = ['house', 'mill', 'lumber_camp', 'mining_camp', 'farm',
              'barracks', 'archery_range', 'stable', 'blacksmith', 'tower',
              'siege_workshop', 'castle', 'town_center']
HOTKEYS = 'QWERTASDFGZXCVB'

DIRS = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
        (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)]


# ---- утилиты
_SHADE = {}


def shade(c, d):
    """Цвет c (RGB[A]), сдвинутый по яркости на d; результат — RGB-кортеж. Запоминается: в отрисовке
    юнитов вызывается сотни раз за кадр с одними и теми же цветами."""
    try:
        return _SHADE[c, d]
    except KeyError:
        r = _SHADE[c, d] = tuple(max(0, min(255, v + d)) for v in c[:3])
        if len(_SHADE) > 20000:
            _SHADE.clear()
        return r
    except TypeError:       # нехэшируемый цвет (список, pygame.Color) — без кэша
        return tuple(max(0, min(255, v + d)) for v in c[:3])


def dist_point_rect(px, py, rx, ry, rw, rh):
    # то же, что hypot(max(rx - px, 0, px - rx - rw), max(...)), но без max() — горячий путь
    dx = rx - px
    if dx < 0:
        dx = px - rx - rw
        if dx < 0:
            dx = 0
    dy = ry - py
    if dy < 0:
        dy = py - ry - rh
        if dy < 0:
            dy = 0
    if not dx:
        return float(dy)
    if not dy:
        return float(dx)
    return math.hypot(dx, dy)


def cost_add(a, b):
    return {k: a.get(k, 0) + b.get(k, 0) for k in RES}


def to_iso(x, y, ox=ISO_OX, z=0.0):
    """Логические пиксели мира → пиксели изометрической карты (ox = H * HW для карты высотой H);
    z — подъём над плоскостью в пикселях экрана (высота земли: World.z_at, game/terrain.py)."""
    return x - y + ox, (x + y) * 0.5 - z


def from_iso(ix, iy, ox=ISO_OX):
    ix -= ox
    return (ix + 2 * iy) * 0.5, (2 * iy - ix) * 0.5


def as_tuple(v):
    return v if isinstance(v, tuple) else (v,)


# ---- контент: модули game/content/* дописывают таблицы выше (см. game/content/__init__.py).
# Импорт стоит в самом конце, чтобы все таблицы уже существовали.
__import__(__package__ + '.content')
