"""Siege: the ram, mangonel and scorpion lines, the bombard (workshop); the trebuchet (castle). Values are DE.

Mangonels hit an area (blast) and also hit their own units; mangonels, the bombard and the trebuchet have a minimum
range (minr); the trebuchet fires only when unpacked and moves only when packed (pack - seconds)."""
from . import add_unit, add_tech, add_trains
from . import _army_art as art
from .. import gfx

# ---- rams
add_unit('capped_ram', hp=200, atk=3, rng=0, reload=5.0, arm=(0, 190), speed=0.5, los=3,
         cost={'wood': 160, 'gold': 75}, time=36, age=3, cls='siege', ac=('ram',), bonus={'bld': 150, 'siege': 50},
         bld_only=True, radius=13, line='ram', bar_h=34, art=art.ram('hide'))
add_tech('capped_ram', at='siege_workshop', cost={'food': 300}, time=50, age=3,
         upgrade=('ram', 'capped_ram'))
add_unit('siege_ram', hp=270, atk=4, rng=0, reload=5.0, arm=(0, 195), speed=0.6, los=3,
         cost={'wood': 160, 'gold': 75}, time=36, age=3, cls='siege', ac=('ram',), bonus={'bld': 200, 'siege': 65},
         bld_only=True, radius=14, line='ram', bar_h=36, art=art.ram('iron', big=True))
add_tech('siege_ram', at='siege_workshop', cost={'food': 1000, 'gold': 800}, time=75, age=3,
         req='capped_ram', upgrade=('capped_ram', 'siege_ram'))

# ---- mangonels: melee damage (dtype melee) over an area
MANG = dict(rng=7, reload=6.0, speed=0.6, cls='siege', dtype='melee', minr=3, shot='stone', shot_speed=190,
            radius=13, bar_h=34, line='mangonel')
add_unit('mangonel', hp=50, atk=40, arm=(0, 6), los=9, blast=0.5, bonus={'bld': 35},
         cost={'wood': 160, 'gold': 135}, time=46, age=2, art=art.mangonel(0), **MANG)
add_unit('onager', hp=60, atk=50, arm=(0, 7), los=10, blast=0.75, bonus={'bld': 45},
         cost={'wood': 160, 'gold': 135}, time=46, age=3, art=art.mangonel(1), **dict(MANG, rng=8))
add_unit('siege_onager', hp=70, atk=75, arm=(0, 8), los=10, blast=0.75, bonus={'bld': 60},
         cost={'wood': 160, 'gold': 135}, time=46, age=3, art=art.mangonel(2), **dict(MANG, rng=8))
add_tech('onager', at='siege_workshop', cost={'food': 800, 'gold': 500}, time=75, age=3,
         upgrade=('mangonel', 'onager'))
add_tech('siege_onager', at='siege_workshop', cost={'food': 1450, 'gold': 1000}, time=150,
         age=3, req='onager', upgrade=('onager', 'siege_onager'))

# ---- scorpions: the bolt pierces the formation
SCORP = dict(rng=7, reload=3.6, speed=0.65, los=9, cls='siege', minr=2, pierce=True, shot='bolt', shot_speed=300,
             radius=12, bar_h=30, line='scorpion')
add_unit('scorpion', hp=40, atk=12, arm=(0, 7), cost={'wood': 75, 'gold': 75}, time=30, age=2,
         art=art.scorpion(False), **SCORP)
add_unit('heavy_scorpion', hp=50, atk=16, arm=(0, 7), cost={'wood': 75, 'gold': 75},
         time=30, age=3, art=art.scorpion(True), **SCORP)
add_tech('heavy_scorpion', at='siege_workshop', cost={'food': 1000, 'wood': 1100},
         time=50, age=3, upgrade=('scorpion', 'heavy_scorpion'))

# ---- bombard (Imperial Age, needs Chemistry)
add_unit('bombard_cannon', hp=80, atk=40, rng=12, reload=6.5, arm=(2, 5), speed=0.7, los=14,
         cost={'wood': 225, 'gold': 225}, time=56, age=3, req='chemistry', cls='siege', ac=('gunpowder',),
         bonus={'bld': 200, 'siege': 40}, dtype='melee', minr=5, blast=0.5, acc=0.92, shot='ball', shot_speed=380,
         radius=13, bar_h=32, art=art.bombard)

add_trains('siege_workshop', 'mangonel', 'scorpion', 'bombard_cannon')

# ---- trebuchet (castle, Imperial Age): 4 s to pack/unpack
add_unit('trebuchet', hp=150, atk=200, rng=16, reload=10.0, arm=(2, 150), speed=0.8, los=19,
         cost={'wood': 200, 'gold': 200}, time=50, age=3, cls='siege', bonus={'bld': 250}, dtype='melee',
         minr=4, blast=0.5, acc=0.85, pack=4.0, look_up='trebuchet_up', shot='stone', shot_speed=230,
         radius=16, bar_h=40, art=art.trebuchet_packed)
gfx.ART['trebuchet_up'] = art.trebuchet_up
add_trains('castle', 'trebuchet')
