"""University (Castle Age) and its military techs: Ballistics, Chemistry, Siege Engineers.

Other modules add their techs here: add_techs('university', ...) or add_tech(..., at='university')
(for example walls/towers: Masonry, Architecture, Arrowslits, Guard Tower)."""
from . import add_building, add_tech
from . import _army_art as art

add_building('university', size=4, hp=2100, cost={'wood': 200}, time=60, age=2, los=6,
             art=art.university, art_h=110)

add_tech('ballistics', at='university', cost={'wood': 300, 'gold': 175}, time=60, age=2,
         effects=[{'stat': 'lead', 'add': 1}])
add_tech('chemistry', at='university', cost={'food': 300, 'gold': 200}, time=100, age=3, effects=[{'stat': 'atk', 'cls': ('arch', 'siege', 'bld'), 'not_cls': ('gunpowder', 'ram'), 'add': 1}])
add_tech('siege_engineers', at='university', cost={'food': 500, 'wood': 600}, time=45,
         age=3, effects=[{'stat': 'rng', 'kind': ('mangonel', 'onager', 'siege_onager', 'scorpion', 'heavy_scorpion',
                                           'bombard_cannon'), 'add': 1},
                  {'stat': 'bonus:bld', 'cls': 'siege', 'mul': 1.2}])
