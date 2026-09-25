"""Game constants and tables.

The stats of units, buildings and techs follow the rules of the classic
historical RTS (values are game seconds, tiles, tiles per second).
Game time runs 1.7 times faster than real time, like the "normal" speed.
"""
import math

TITLE = 'Chronicles of Kingdoms'       # window title; in the menu - i18n.t('app.title') in the player's language

# ---- world
TILE = 32                  # logical tile size (the simulation runs on a square grid)
MAP_W = MAP_H = 96         # default size; the real size is World.W / World.H
MAP_SIZES = {2: 120, 3: 144, 4: 168, 5: 200, 6: 200, 7: 220, 8: 220}   # map side by player count (DE)
MAX_PLAYERS = 8
GAME_SPEED = 1.7           # game seconds per real second

# ---- isometry: a tile on screen is a 64x32 diamond
HW, HH = 32, 16
ISO_OX = MAP_H * HW        # offset so that the left corner of the map is at x=0 (for the default map)
ISO_TW = (MAP_W + MAP_H) * HW
ISO_TH = (MAP_W + MAP_H) * HH

# ---- screen
SCREEN_W, SCREEN_H = 1280, 800
# The interface in AoE2 DE proportions (HUD 100%, scaled to a height of 800): top bar ~ 6% of the height,
# two panels at the bottom - commands (~65% of the width, 21% of the height) and the minimap (~29% x 23%), with the world visible between them.
TOP_H = 48
PANEL_H = 168              # height of the command panel; the world is drawn down to the bottom of the screen (a window between the panels)
VIEW_H = SCREEN_H - TOP_H - PANEL_H   # the "main" camera window (above the command panel)
FPS = 60

RES = ('food', 'wood', 'gold', 'stone')
RES_NAME = {r: r for r in RES}          # the captions are filled in by i18n.relabel() (res.food...)
RES_COLOR = {'food': (215, 60, 50), 'wood': (150, 100, 55), 'gold': (240, 200, 40), 'stone': (165, 165, 175)}
START_RES = {'food': 200, 'wood': 200, 'gold': 100, 'stone': 200}

# 8 player colors in the order and shades of AoE II DE (sprite colors, aoe2-color-tool spritecolors.json):
# blue, red, green, yellow, teal, purple, grey, orange
PLAYER_COLORS = [(0, 0, 255), (255, 0, 0), (0, 169, 27), (214, 214, 27),
                 (123, 239, 240), (138, 19, 247), (102, 102, 102), (255, 146, 5)]
# The captions below (colors, ages, difficulty) are filled in by i18n.relabel() from the locale (color.*, age.*, diff.*)
COLOR_NAMES = ['blue', 'red', 'green', 'yellow', 'cyan', 'purple', 'grey', 'orange']
PLAYER_NAMES = ['you'] + COLOR_NAMES[1:]   # player name by index (0 - the human)
GAIA = -1                                  # owner of "nobody's" objects (nature)
AGE_NAMES = ['dark', 'feudal', 'castle', 'imperial']
DIFF_NAMES = ['easy', 'normal', 'hard']

# ---- resources on the map (gather rate - units per game second); 'name' comes from the locale (node.*)
NODE_DEFS = {
    'tree':    {'res': 'wood',  'amount': 100, 'rate': 0.39},
    'berries': {'res': 'food',  'amount': 125, 'rate': 0.31},
    'gold':    {'res': 'gold',  'amount': 800, 'rate': 0.38},
    'stone':   {'res': 'stone', 'amount': 350, 'rate': 0.36},
}
# animals: hp, food in the carcass, butchering speed (units/s), running speed (tiles/s)
ANIMALS = {
    'sheep': dict(hp=7, food=100, rate=0.33, speed=0.7, radius=8, los=2, atk=0, arm=(0, 0)),
    'deer':  dict(hp=5, food=140, rate=0.41, speed=1.2, radius=9, los=3, atk=0, arm=(0, 0)),
    'boar':  dict(hp=75, food=340, rate=0.41, speed=1.2, radius=10, los=4, atk=8, arm=(0, 1)),
    # predator (AoE2 DE): gives no food, attacks players' units in sight on its own; hunt=False - not game
    'wolf':  dict(hp=25, food=0, rate=0.0, speed=1.2, radius=8, los=6, atk=3, arm=(0, 0),
                  hunt=False, predator=True),
}
FARM_RATE = 0.32
FARM_FOOD = 175
CARRY = 10

# speed - tiles per second; rng, los - tiles; time - training seconds
UNITS = {
    'villager':   dict(hp=25, atk=3, rng=0, reload=2.0, arm=(0, 0), speed=0.8, los=4,
                       cost={'food': 50}, time=25, age=0, cls='vil', radius=7),
    'militia':    dict(hp=40, atk=4, rng=0, reload=2.0, arm=(0, 1), speed=0.9, los=4,
                       cost={'food': 60, 'gold': 20}, time=21, age=0, cls='inf', radius=8),
    'spearman':   dict(hp=45, atk=3, rng=0, reload=3.0, arm=(0, 0), speed=1.0, los=4,
                       cost={'food': 35, 'wood': 25}, time=22, age=1, cls='inf', radius=8, bonus={'cav': 15}),
    'archer':     dict(hp=30, atk=4, rng=4, reload=2.0, arm=(0, 0), speed=0.96, los=6,
                       cost={'wood': 25, 'gold': 45}, time=35, age=1, cls='arch', radius=7),
    'skirmisher': dict(hp=30, atk=2, rng=4, reload=3.0, arm=(0, 3), speed=0.96, los=6,
                       cost={'food': 25, 'wood': 35}, time=22, age=1, cls='arch', radius=7, bonus={'arch': 3}),
    'scout':      dict(hp=45, atk=3, rng=0, reload=2.0, arm=(0, 2), speed=1.55, los=6,
                       cost={'food': 80}, time=30, age=1, cls='cav', radius=11),
    'knight':     dict(hp=100, atk=10, rng=0, reload=1.8, arm=(2, 2), speed=1.35, los=4,
                       cost={'food': 60, 'gold': 75}, time=30, age=2, cls='cav', radius=11),
    'ram':        dict(hp=175, atk=2, rng=0, reload=5.0, arm=(0, 180), speed=0.5, los=3,
                       cost={'wood': 160, 'gold': 75}, time=36, age=2, cls='siege', radius=13, bonus={'bld': 125}),
}

# size - the square's side in tiles; time - build seconds for one villager
BUILDINGS = {
    'town_center':    dict(size=4, hp=2400, cost={'wood': 275, 'stone': 100}, time=150,
                           age=2, pop=5, drop=('food', 'wood', 'gold', 'stone'), trains=['villager'],
                           techs=['feudal', 'castle', 'imperial', 'loom', 'wheelbarrow'],
                           atk=5, rng=6, reload=2.0, los=8, arm=(3, 5)),
    'house':          dict(size=2, hp=550, cost={'wood': 25}, time=25, age=0, pop=5, los=2),
    'mill':           dict(size=2, hp=600, cost={'wood': 100}, time=35, age=0, drop=('food',),
                           techs=['horse_collar']),
    'lumber_camp':    dict(size=2, hp=600, cost={'wood': 100}, time=35, age=0, drop=('wood',),
                           techs=['double_bit']),
    'mining_camp':    dict(size=2, hp=600, cost={'wood': 100}, time=35, age=0,
                           drop=('gold', 'stone'), techs=['gold_mining']),
    'farm':           dict(size=3, hp=480, cost={'wood': 60}, time=15, age=0, walk=True, los=1),
    'barracks':       dict(size=3, hp=1200, cost={'wood': 175}, time=50, age=0,
                           trains=['militia', 'spearman'], los=5),
    'archery_range':  dict(size=3, hp=1500, cost={'wood': 175}, time=50, age=1,
                           trains=['archer', 'skirmisher'], los=5),
    'stable':         dict(size=3, hp=1500, cost={'wood': 175}, time=50, age=1,
                           trains=['scout', 'knight'], los=5),
    'blacksmith':     dict(size=3, hp=2100, cost={'wood': 150}, time=40, age=1,
                           techs=['forging', 'fletching', 'scale_armor'], los=5),
    'tower':          dict(size=1, hp=1020, cost={'wood': 25, 'stone': 125}, time=80,
                           age=1, atk=5, rng=8, reload=2.0, los=10, arm=(1, 7)),
    'siege_workshop': dict(size=4, hp=2100, cost={'wood': 200}, time=40, age=2,
                           trains=['ram'], los=5),
    'castle':         dict(size=4, hp=4800, cost={'stone': 650}, time=200, age=2, pop=20,
                           atk=11, rng=8, reload=2.0, arrows=4, los=11, arm=(8, 11)),
}
BUILDING_ARMOR = (0, 7)

# ---- modifiers (techs, civilization bonuses, difficulty)
# An effect is a dict {'stat': ..., filters..., 'add': n, 'mul': k}; the result = (base + sum of add) x product of mul.
# stat: 'atk', 'arm_m' (melee armor), 'arm_p' (pierce armor), 'rng', 'speed', 'hp', 'los', 'reload',
#       'carry' (villager load), 'gather' (gather rate), 'farm_food' (food in a new farm),
#       'build' (build speed), 'cost' (cost, per resource 'res'), 'time' (training/research time),
#       army: 'bonus:<class>' (bonus damage against an armor class, e.g. 'bonus:bld'), 'acc' (accuracy),
#       'lead' (>0 - fires with lead), 'faith' (monk faith recovery speed), 'heal',
#       'convert_monk' / 'convert_siege' (>0 - a monk converts monks / siege). Armor classes - game/content/army_base.py.
# filters (all optional): 'kind' - unit/building/tech kind (a string or a tuple),
#       'cls' / 'not_cls' - a class ('vil', 'inf', 'arch', 'cav', 'siege', 'monk', 'bld' - buildings, 'tech' - techs;
#       the unit's extra armor classes from 'ac' are checked too: 'spear', 'cav_arch', 'gunpowder', 'ram'...
#       'res' - a resource ('food', 'wood', 'gold', 'stone'), 'src' - the gather source
#       ('tree', 'berries', 'gold', 'stone', 'farm', 'hunt').
# A player keeps a list of active effects and a cache by key - see Player.mod() / Player.stat() in world.py.

TECHS = {
    'feudal':       dict(cost={'food': 500}, time=130, age=0, icon='II'),
    'castle':       dict(cost={'food': 800, 'gold': 200}, time=160, age=1, icon='III'),
    'imperial':     dict(cost={'food': 1000, 'gold': 800}, time=190, age=2, icon='IV',
                         effects=[{'stat': 'atk', 'not_cls': ('vil',), 'add': 1}]),
    'loom':         dict(cost={'gold': 50}, time=25, age=0, effects=[{'stat': 'hp', 'kind': 'villager', 'add': 15},
                                  {'stat': 'arm_m', 'kind': 'villager', 'add': 1},
                                  {'stat': 'arm_p', 'kind': 'villager', 'add': 2}]),
    'wheelbarrow':  dict(cost={'food': 175, 'wood': 50}, time=75, age=1, effects=[{'stat': 'speed', 'kind': 'villager', 'mul': 1.1},
                                  {'stat': 'carry', 'kind': 'villager', 'mul': 1.25}]),
    'double_bit':   dict(cost={'food': 100, 'wood': 50}, time=25, age=1, effects=[{'stat': 'gather', 'res': 'wood', 'mul': 1.2}]),
    'gold_mining':  dict(cost={'food': 100, 'wood': 75}, time=30, age=1, effects=[{'stat': 'gather', 'res': 'gold', 'mul': 1.15}]),
    'horse_collar': dict(cost={'food': 75, 'wood': 75}, time=20, age=1, effects=[{'stat': 'farm_food', 'add': 75}]),
    'forging':      dict(cost={'food': 150}, time=50, age=1, effects=[{'stat': 'atk', 'cls': ('inf', 'cav'), 'add': 1}]),
    'fletching':    dict(cost={'food': 100, 'gold': 50}, time=30, age=1, effects=[{'stat': 'atk', 'cls': 'arch', 'add': 1},
                                  {'stat': 'rng', 'cls': 'arch', 'add': 1}]),
    'scale_armor':  dict(cost={'food': 100}, time=40, age=1, effects=[{'stat': 'arm_m', 'cls': ('inf', 'cav', 'arch'), 'add': 1},
                                  {'stat': 'arm_p', 'cls': ('inf', 'cav', 'arch'), 'add': 1}]),
}
# Upgrade lines: a tech with 'upgrade': (old, new) turns all units of the old kind into the new one on completion,
# and buildings train the new kind (Player.current()). 'req' - required techs.

# ---- civilizations: permanent effects, given to a player at the start of a match (Player.set_civ)
# Entry fields (except name/effects all are optional; filled in by game/content/civs.py):
#   'team' - the team bonus (effects for all allies, including yourself; identical civilizations do not stack),
#   'start' - {resource: +n} added to the starting ones, 'start_units' - {kind: +n} extra units at the center,
#   'ages' - {age 1..3: [effects]} - given on reaching the age ("per age" prices, building HP...),
#   'free' - {age: [techs]} - researched for free on reaching the age,
#   'pop_bonus' - {age: +n} to the population cap, 'pop_extra' - {building: +n population},
#   'disabled' - unavailable kinds of units/techs/buildings (the tech tree; dependents too, see world.civ_bans),
#   'banned_at' - (building, unit) pairs: where a unit is not trained until a tech lifts the ban.
# Unique units and techs are marked with 'civ': a civilization key - they are unavailable to other civilizations.
CIVS = {
    'default': dict(effects=[]),
}
# World hooks for content: 'init' - fn(world) after map generation; 'tick' - fn(world, dt) every step.
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


# ---- utilities
_SHADE = {}


def shade(c, d):
    """Color c (RGB[A]) shifted in brightness by d; the result is an RGB tuple. Memoized: in unit drawing
    it is called hundreds of times per frame with the same colors."""
    try:
        return _SHADE[c, d]
    except KeyError:
        r = _SHADE[c, d] = tuple(max(0, min(255, v + d)) for v in c[:3])
        if len(_SHADE) > 20000:
            _SHADE.clear()
        return r
    except TypeError:       # unhashable color (a list, pygame.Color) - no cache
        return tuple(max(0, min(255, v + d)) for v in c[:3])


def dist_point_rect(px, py, rx, ry, rw, rh):
    # the same as hypot(max(rx - px, 0, px - rx - rw), max(...)), but without max() - a hot path
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
    """World logical pixels -> pixels of the isometric map (ox = H * HW for a map of height H);
    z - lift above the plane in screen pixels (ground height: World.z_at, game/terrain.py)."""
    return x - y + ox, (x + y) * 0.5 - z


def from_iso(ix, iy, ox=ISO_OX):
    ix -= ox
    return (ix + 2 * iy) * 0.5, (2 * iy - ix) * 0.5


def as_tuple(v):
    return v if isinstance(v, tuple) else (v,)


# ---- content: the game/content/* modules append to the tables above (see game/content/__init__.py).
# The import is at the very end so that all the tables already exist. Then the locale fills in names and descriptions.
__import__(__package__ + '.content')
__import__(__package__ + '.i18n').i18n.relabel()
