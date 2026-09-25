"""Monastery and monk: heals allies, converts enemies (4-10 s at range 9, then 62 s to restore
faith). Monastery techs - DE values."""
from . import add_unit, add_building, add_tech
from . import _army_art as art

add_building('monastery', size=3, hp=2100, cost={'wood': 175}, time=40, age=2, los=6,
             trains=['monk'], art=art.monastery, art_h=100)

add_unit('monk', hp=30, atk=0, rng=9, reload=1.0, arm=(0, 0), speed=0.7, los=11,
         cost={'gold': 100}, time=51, age=2, cls='monk', monk=True, radius=7, unconvertible=False,
         art=art.monk)

MONK = {'kind': 'monk'}
add_tech('sanctity', at='monastery', cost={'gold': 120}, time=60, age=2, effects=[dict(MONK, stat='hp', add=15)])
add_tech('fervor', at='monastery', cost={'gold': 140}, time=50, age=2, effects=[dict(MONK, stat='speed', mul=1.15)])
add_tech('atonement', at='monastery', cost={'gold': 325}, time=40, age=2, effects=[dict(MONK, stat='convert_monk', add=1)])
add_tech('redemption', at='monastery', cost={'gold': 475}, time=50, age=2, effects=[dict(MONK, stat='convert_siege', add=1)])
add_tech('block_printing', at='monastery', cost={'gold': 200}, time=55, age=3, effects=[dict(MONK, stat='rng', add=3)])
add_tech('illumination', at='monastery', cost={'gold': 120}, time=65, age=3, effects=[dict(MONK, stat='faith', mul=1.5)])
