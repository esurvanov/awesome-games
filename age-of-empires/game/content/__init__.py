"""Content registration: each module of this package appends its own entries to the tables in data.py.

How to add a feature without touching the shared files:
  1. Create game/content/<feature>.py (modules are loaded automatically, alphabetically).
  2. In the module import the helpers: `from . import add_unit, add_building, add_tech, add_trains, add_techs`
     (or the tables themselves: `from ..data import UNITS, TECHS, ...`) and register the entries.
  3. Set graphics right in the entry:
       unit  - 'art': {'helmet': ..., 'weapon': ..., 'shield': ...} (an infantryman figure, see gfx.draw_foot)
               or 'art': function(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
       building - 'art': function(painter: gfx.IsoPainter, surf, color, size); without 'art' a generic house is drawn;
       tech - 'icon': 'Ab' (text on the plate); for upgrades ('upgrade') the icon is a figure of the new unit.
     Import gfx inside functions (`from .. import gfx`), not at module level.
  4. Tech effects and civilization bonuses are lists of modifiers (the format is described in data.py above TECHS).
The load order is deterministic, so modules must not depend on each other.
"""
import importlib
import pkgutil

from ..data import UNITS, BUILDINGS, TECHS, BUILD_MENU


def add_unit(key, **d):
    """A new unit kind. Required fields are the same as for UNITS in data.py."""
    UNITS[key] = d
    return d


def add_building(key, menu=True, **d):
    """A new building; menu=True adds it to the villager build menu."""
    BUILDINGS[key] = d
    if menu and key not in BUILD_MENU:
        BUILD_MENU.append(key)
    return d


def add_tech(key, at=None, **d):
    """A new tech; at is the building (or a tuple of buildings) where it is researched."""
    TECHS[key] = d
    for b in (at if isinstance(at, (tuple, list)) else (at,) if at else ()):
        add_techs(b, key)
    return d


def add_trains(building, *units):
    lst = BUILDINGS[building].setdefault('trains', [])
    for u in units:
        if u not in lst:
            lst.append(u)


def add_techs(building, *techs):
    lst = BUILDINGS[building].setdefault('techs', [])
    for t in techs:
        if t not in lst:
            lst.append(t)


def _load_all():
    for m in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        if not m.name.startswith('_'):
            importlib.import_module(f'{__name__}.{m.name}')


_load_all()
