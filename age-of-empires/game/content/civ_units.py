"""Unique units of the civilizations (trained in the castle, the elite upgrade there too) and unique techs
(castle and imperial). The numbers are Definitive Edition values converted to the game's scales
(speed - tiles/s, reload and time - game seconds).

A unit/tech entry with a 'civ' field is available only to that civilization (see world.civ_bans).
Special tricks go through hooks:
  'on_attack'(unit, world, target, dmg) - after every hit/shot (Chu Ko Nu volley, trampling);
  'regen' - HP per second (berserk; tick in WORLD_HOOKS), the 'regen' stat multiplies (Berserkergang).
Armor classes: all unique units get the extra class 'unique' (the samurai has a bonus against it).
"""
import math
import random

from . import add_unit, add_tech, add_trains
from .. import civ_art as art
from ..data import TILE, UNITS, BUILDINGS, WORLD_HOOKS

UNIQUE = {}         # civilization -> [base kinds of unique units]
UTECHS = {}         # civilization -> [castle tech, imperial tech]


# ============================================================ special tricks
def _volley(u, w, t, dmg):
    """Chu Ko Nu: besides the main arrow - n more arrows of 'volley_atk' damage at the target and nearby."""
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
    """Trampling: damage to enemies around the target (war elephant - always; cataphract - with Logistica)."""
    frac, flat = u.d.get('trample', (0.0, 0))
    flat += u.p.stat('trample', u.kind, 0)
    if frac <= 0 and flat <= 0:
        return
    if not hasattr(t, 'radius'):
        return          # does not trample buildings
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
    """Once a second: units with 'regen' (berserks) restore health."""
    _regen_t[0] -= dt
    if _regen_t[0] > 0:
        return
    _regen_t[0] = 1.0
    for u in w.units:
        r = u.d.get('regen')
        if r and u.hp < u.max_hp and u.alive:
            u.hp = min(u.max_hp, u.hp + r * u.p.stat('regen', u.kind, 1.0))


WORLD_HOOKS['tick'].append(_regen_tick)


# ============================================================ registration
def unique(civ, key, elite, up_cost, look, elite_look, **d):
    """Unique unit key and its elite version. elite - the fields that differ for the elite (hp, atk...);
    names and descriptions come from the locale (unit.<key>.name, unit.elite_<key>.name, tech.elite_<key>.desc)."""
    d.setdefault('radius', 8)
    d.setdefault('age', 2)
    ac = tuple(d.pop('ac', ())) + ('unique',)
    base = dict(d, civ=civ, ac=ac, line=key, art=look)
    add_unit(key, **base)
    ek = 'elite_' + key
    e = dict(base, art=elite_look, age=3, **elite)
    add_unit(ek, **e)
    add_tech(ek, at='castle', cost=up_cost, time=60, age=3, civ=civ, upgrade=(key, ek))
    add_trains('castle', key)
    UNIQUE.setdefault(civ, []).append(key)


def utech(civ, key, age, **d):
    add_tech(key, at='castle', age=age, time=d.pop('time', 60), civ=civ, **d)
    UTECHS.setdefault(civ, []).append(key)


FOOT_ARCH = ('archer', 'crossbowman', 'arbalester', 'longbowman', 'elite_longbowman',
             'chu_ko_nu', 'elite_chu_ko_nu')

# ---- Franks: throwing axeman (ranged "melee" damage)
unique('franks', 'throwing_axeman', dict(hp=70, atk=8, rng=4, arm=(1, 0), los=6),
       {'food': 1000, 'gold': 850}, art.axeman(False), art.axeman(True),
       hp=60, atk=7, rng=3, reload=2.0, arm=(0, 0), speed=1.0, los=5,
       cost={'food': 55, 'gold': 25}, time=17, cls='inf', dtype='melee', shot='javelin', shot_speed=240,
       bonus={'bld': 1})
utech('franks', 'bearded_axe', 2, cost={'food': 400, 'gold': 400}, effects=[{'stat': 'rng', 'kind': ('throwing_axeman', 'elite_throwing_axeman'), 'add': 1}])
utech('franks', 'chivalry', 3, cost={'food': 400, 'gold': 400}, effects=[{'stat': 'time', 'kind': ('scout', 'light_cavalry', 'hussar', 'knight', 'cavalier', 'paladin',
                                         'camel_rider', 'heavy_camel_rider'), 'mul': 1 / 1.4}])

# ---- Britons: longbowman
unique('britons', 'longbowman', dict(hp=40, atk=7, rng=6, los=8, acc=0.9),
       {'food': 850, 'gold': 850}, art.longbow(False), art.longbow(True),
       hp=35, atk=6, rng=5, reload=2.0, arm=(0, 1), speed=0.96, los=7, acc=0.8,
       cost={'wood': 35, 'gold': 40}, time=18, cls='arch', ac=('foot_arch',), bonus={'spear': 3})
utech('britons', 'yeomen', 2, cost={'wood': 750, 'gold': 450}, effects=[{'stat': 'rng', 'kind': FOOT_ARCH, 'add': 1},
               {'stat': 'atk', 'kind': ('tower', 'guard_tower', 'keep'), 'add': 2}])
utech('britons', 'warwolf', 3, cost={'wood': 800, 'gold': 400}, effects=[{'stat': 'acc', 'kind': 'trebuchet', 'add': 1},
               {'stat': 'bonus:bld', 'kind': 'trebuchet', 'mul': 1.2}])

# ---- Mongols: mangudai (cavalry archer against siege)
unique('mongols', 'mangudai', dict(hp=65, atk=8, arm=(1, 0), bonus={'siege': 5, 'spear': 1}),
       {'food': 1100, 'gold': 675}, art.mangudai(False), art.mangudai(True),
       hp=60, atk=6, rng=4, reload=2.1, arm=(0, 0), speed=1.43, los=6, acc=0.95,
       cost={'wood': 55, 'gold': 65}, time=26, cls='cav', ac=('arch', 'cav_arch'), bonus={'siege': 3, 'spear': 1},
       radius=11)
utech('mongols', 'nomads', 2, cost={'wood': 300})
utech('mongols', 'drill', 3, cost={'food': 500, 'gold': 450}, effects=[{'stat': 'speed', 'cls': 'siege', 'not_cls': ('ship',), 'mul': 1.5}])

# ---- Byzantines: cataphract
unique('byzantines', 'cataphract', dict(hp=150, atk=12, bonus={'inf': 16}),
       {'food': 1600, 'gold': 800}, art.cataphract(False), art.cataphract(True),
       hp=110, atk=9, rng=0, reload=1.7, arm=(2, 1), speed=1.35, los=4,
       cost={'food': 70, 'gold': 75}, time=20, cls='cav', bonus={'inf': 12}, carm={'cav': 12},
       on_attack=_trample, radius=12)
utech('byzantines', 'greek_fire', 2, cost={'food': 250, 'gold': 300}, effects=[{'stat': 'rng', 'kind': ('fire_galley', 'fire_ship', 'fast_fire_ship'), 'add': 1}])
utech('byzantines', 'logistica', 3, cost={'food': 800, 'gold': 600}, effects=[{'stat': 'trample', 'kind': ('cataphract', 'elite_cataphract'), 'add': 5},
               {'stat': 'bonus:inf', 'kind': ('cataphract', 'elite_cataphract'), 'add': 6}])

# ---- Teutons: teutonic knight
unique('teutons', 'teutonic_knight', dict(hp=100, atk=17, arm=(10, 2)),
       {'food': 1200, 'gold': 600}, art.teutonic(False), art.teutonic(True),
       hp=80, atk=12, rng=0, reload=2.0, arm=(5, 2), speed=0.8, los=3,
       cost={'food': 85, 'gold': 40}, time=12, cls='inf', bonus={'bld': 4})
utech('teutons', 'ironclad', 2, cost={'wood': 400, 'gold': 350}, effects=[{'stat': 'arm_m', 'cls': 'siege', 'not_cls': ('ship',), 'add': 4}])
utech('teutons', 'crenellations', 3, cost={'food': 600, 'stone': 400}, effects=[{'stat': 'rng', 'kind': 'castle', 'add': 3}])

# ---- Japanese: samurai (against unique units)
unique('japanese', 'samurai', dict(hp=80, atk=12, bonus={'unique': 12, 'bld': 2}),
       {'food': 950, 'gold': 875}, art.samurai(False), art.samurai(True),
       hp=60, atk=8, rng=0, reload=1.45, arm=(1, 1), speed=1.0, los=4,
       cost={'food': 60, 'gold': 30}, time=9, cls='inf', bonus={'unique': 10, 'bld': 2})
utech('japanese', 'yasama', 2, cost={'food': 300, 'wood': 300}, effects=[{'stat': 'arrows', 'kind': ('tower', 'guard_tower', 'keep'), 'add': 2}])
utech('japanese', 'kataparuto', 3, cost={'wood': 550, 'gold': 600}, effects=[{'stat': 'reload', 'kind': 'trebuchet', 'mul': 1 / 1.33}])

# ---- Chinese: chu ko nu (a volley of several arrows)
unique('chinese', 'chu_ko_nu', dict(hp=50, volley=(4, 3)),
       {'food': 760, 'gold': 760}, art.chukonu(False), art.chukonu(True),
       hp=45, atk=8, rng=4, reload=3.0, arm=(0, 0), speed=0.96, los=6, acc=0.85,
       cost={'wood': 40, 'gold': 35}, time=19, cls='arch', ac=('foot_arch',), bonus={'spear': 3},
       volley=(2, 3), on_attack=_volley, shot='bolt')
utech('chinese', 'great_wall', 2, cost={'wood': 400, 'stone': 200}, effects=[{'stat': 'hp', 'kind': ('palisade_wall', 'palisade_gate', 'stone_wall', 'gate', 'tower',
                                       'guard_tower', 'keep'), 'mul': 1.3}])
utech('chinese', 'rocketry', 3, cost={'wood': 750, 'gold': 750}, effects=[{'stat': 'atk', 'kind': ('chu_ko_nu', 'elite_chu_ko_nu'), 'add': 2},
               {'stat': 'atk', 'kind': ('scorpion', 'heavy_scorpion'), 'add': 4}])

# ---- Persians: war elephant (huge, tramples)
unique('persians', 'war_elephant', dict(hp=600, atk=20, arm=(1, 3)),
       {'food': 1600, 'gold': 1200}, art.elephant(False), art.elephant(True),
       hp=450, atk=15, rng=0, reload=2.0, arm=(1, 2), speed=0.6, los=4,
       cost={'food': 120, 'gold': 70}, time=25, cls='cav', ac=('elephant',), bonus={'bld': 7},
       trample=(0.25, 0), on_attack=_trample, radius=17, bar_h=52, icon_k=0.52)
utech('persians', 'kamandaran', 2, cost={'food': 400, 'gold': 300}, effects=[{'stat': 'cost', 'kind': ('archer', 'crossbowman', 'arbalester'), 'res': 'gold', 'mul': 0},
               {'stat': 'cost', 'kind': ('archer', 'crossbowman', 'arbalester'), 'res': 'wood', 'add': 45}])
utech('persians', 'mahouts', 3, cost={'food': 300, 'gold': 300}, effects=[{'stat': 'speed', 'kind': ('war_elephant', 'elite_war_elephant'), 'mul': 1.3}])

# ---- Saracens: mameluke (a camel, hits with a sabre from 3 tiles)
unique('saracens', 'mameluke', dict(hp=80, atk=9, arm=(1, 0), bonus={'cav': 12}),
       {'food': 600, 'gold': 500}, art.mameluke(False), art.mameluke(True),
       hp=65, atk=7, rng=3, reload=2.0, arm=(0, 0), speed=1.4, los=5,
       cost={'food': 55, 'gold': 85}, time=23, cls='cav', ac=('camel',), dtype='melee', shot='javelin',
       bonus={'cav': 9}, radius=11, bar_h=40)
utech('saracens', 'bimaristan', 2, cost={'wood': 300, 'gold': 200}, effects=[{'stat': 'heal', 'kind': 'monk', 'mul': 3}])
utech('saracens', 'zealotry', 3, cost={'food': 750, 'gold': 800}, effects=[{'stat': 'hp', 'cls': 'camel', 'add': 20}])

# ---- Turks: janissary (gunpowder)
unique('turks', 'janissary', dict(hp=44, atk=22, arm=(2, 0), acc=0.65),
       {'food': 850, 'gold': 750}, art.janissary(False), art.janissary(True),
       hp=35, atk=17, rng=8, reload=3.45, arm=(1, 0), speed=0.96, los=10, acc=0.5,
       cost={'food': 60, 'gold': 55}, time=17, cls='arch', ac=('gunpowder',), shot='ball', shot_speed=420)
utech('turks', 'sipahi', 2, cost={'food': 350, 'gold': 150}, effects=[{'stat': 'hp', 'kind': ('cavalry_archer', 'heavy_cavalry_archer'), 'add': 20}])
utech('turks', 'artillery', 3, cost={'wood': 500, 'gold': 450}, effects=[{'stat': 'rng', 'kind': ('bombard_cannon', 'cannon_galleon'), 'add': 2}])

# ---- Vikings: berserk (heals itself)
unique('vikings', 'berserk', dict(hp=62, atk=14, arm=(2, 1)),
       {'food': 1300, 'gold': 550}, art.berserk(False), art.berserk(True),
       hp=54, atk=9, rng=0, reload=2.0, arm=(0, 1), speed=1.05, los=3,
       cost={'food': 65, 'gold': 25}, time=14, cls='inf', regen=40 / 60, bonus={'bld': 2})
utech('vikings', 'chieftains', 2, cost={'food': 400, 'gold': 300}, effects=[{'stat': 'bonus:cav', 'cls': 'inf', 'add': 5}])
utech('vikings', 'berserkergang', 3, cost={'food': 850, 'gold': 400}, effects=[{'stat': 'regen', 'kind': ('berserk', 'elite_berserk'), 'mul': 2}])

# ---- Goths: huskarl (arrows barely hurt it); "Anarchy" unlocks it in the barracks
unique('goths', 'huskarl', dict(hp=70, atk=12, arm=(0, 8), bonus={'arch': 10, 'bld': 3}),
       {'food': 1200, 'gold': 550}, art.huskarl(False), art.huskarl(True),
       hp=60, atk=10, rng=0, reload=2.0, arm=(0, 6), speed=1.05, los=3,
       cost={'food': 52, 'gold': 26}, time=16, cls='inf', bonus={'arch': 6, 'bld': 2})
add_trains('barracks', 'huskarl')


def _anarchy(w, p):
    p.banned.discard(('barracks', 'huskarl'))


utech('goths', 'anarchy', 2, cost={'food': 450, 'gold': 250}, on_apply=_anarchy)
utech('goths', 'perfusion', 3, cost={'wood': 400, 'gold': 600}, effects=[{'stat': 'time', 'kind': tuple(BUILDINGS['barracks']['trains']) + (
          'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion', 'pikeman', 'halberdier',
          'elite_huskarl'), 'mul': 0.5}])

# ---- Celts: woad raider (very fast)
unique('celts', 'woad_raider', dict(hp=80, atk=13, arm=(0, 1)),
       {'food': 1000, 'gold': 800}, art.woad(False), art.woad(True),
       hp=65, atk=8, rng=0, reload=2.0, arm=(0, 1), speed=1.38, los=5,
       cost={'food': 65, 'gold': 25}, time=10, cls='inf', bonus={'bld': 2})
utech('celts', 'stronghold', 2, cost={'food': 250, 'gold': 200}, effects=[{'stat': 'reload', 'kind': ('castle', 'tower', 'guard_tower', 'keep'), 'mul': 0.8}])
utech('celts', 'furor_celtica', 3, cost={'food': 750, 'gold': 450}, effects=[{'stat': 'hp', 'cls': 'siege', 'not_cls': ('ship',), 'mul': 1.4}])

# ---- Spanish: conquistador (a mounted gunner)
unique('spanish', 'conquistador', dict(hp=70, atk=18, acc=0.7),
       {'food': 1200, 'gold': 600}, art.conquistador(False), art.conquistador(True),
       hp=55, atk=16, rng=6, reload=2.9, arm=(2, 2), speed=1.3, los=6, acc=0.65,
       cost={'food': 60, 'gold': 70}, time=24, cls='cav', ac=('gunpowder',), shot='ball', shot_speed=420,
       radius=11)
utech('spanish', 'inquisition', 2, cost={'food': 100, 'gold': 300}, effects=[{'stat': 'conv_speed', 'kind': 'monk', 'mul': 1.6}])
utech('spanish', 'supremacy', 3, cost={'food': 400, 'gold': 250}, effects=[{'stat': 'atk', 'kind': 'villager', 'add': 6},
               {'stat': 'arm_m', 'kind': 'villager', 'add': 2},
               {'stat': 'arm_p', 'kind': 'villager', 'add': 2},
               {'stat': 'hp', 'kind': 'villager', 'add': 40}])


# ---- "Nomads": a house with the tech does not take population away when destroyed
def _house_removed(w, b):
    p = b.p
    if p is not None and b.complete and 'nomads' in p.techs:
        p.pop_keep += b.d.get('pop', 0)


BUILDINGS['house']['on_remove'] = _house_removed

# in the castle: unique units first, the trebuchet last
_tr = BUILDINGS['castle']['trains']
if 'trebuchet' in _tr:
    _tr.remove('trebuchet')
    _tr.append('trebuchet')
assert all(UNITS[k].get('civ') for c in UNIQUE.values() for k in c)
