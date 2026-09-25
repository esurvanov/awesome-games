"""Army: armor classes and bonuses of the base units from data.py (rules of the original, DE values).

Format (see World.calc_damage):
  'cls'   - the main class ('inf', 'arch', 'cav', 'siege', 'monk', 'vil'); techs are filtered by it;
  'ac'    - extra armor classes: 'spear', 'skirm', 'cav_arch', 'camel', 'gunpowder', 'ram', 'light_cav'...
            (the tech filters cls/not_cls check them too);
  'bonus' - {target class: +damage}; 'carm' - {class: armor against that class's bonus};
  'dtype' - 'melee' | 'pierce' (default: melee attack - melee, a shot - pierce);
  'acc'   - accuracy (0...1), 'minr' - min. range (tiles), 'blast' - blast radius (tiles),
  'pierce' - the projectile pierces the formation, 'shot' - projectile kind, 'bld_only' - attacks only buildings,
  'pack'  - seconds to pack/unpack (trebuchet), 'look_up' - the kind drawn when unpacked,
  'monk'  - a monk (converts and heals), 'req' - required techs, 'bar_h' - health bar height.
"""
from ..data import UNITS, TECHS

MILITIA_LINE = ('militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion')

UNITS['militia'].update(line='militia')
UNITS['spearman'].update(ac=('spear',), bonus={'cav': 15}, line='spearman')
UNITS['archer'].update(ac=('foot_arch',), bonus={'spear': 3}, acc=0.8, line='archer')
UNITS['skirmisher'].update(ac=('skirm', 'foot_arch'), bonus={'arch': 3, 'spear': 3}, acc=0.9, shot='javelin',
                           line='skirmisher')
UNITS['scout'].update(ac=('light_cav',), line='scout')
UNITS['knight'].update(line='knight')
UNITS['ram'].update(ac=('ram',), bonus={'bld': 125, 'siege': 40}, bld_only=True, bar_h=34,
                    line='ram')

# "Imperial Age" gives troops no attack in the original - remove the simplification from data.py
TECHS['imperial'].pop('effects', None)
