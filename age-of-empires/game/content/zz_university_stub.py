"""University stub: registers only if the real university does not exist yet.

Then it attaches the defense techs to the university (see _uni.py) - this is needed in both cases.
"""
from . import add_building, add_techs
from ._uni import PENDING
from ..data import BUILDINGS

if 'university' not in BUILDINGS:
    add_building('university', size=3, hp=2100, cost={'wood': 200}, time=60, age=2,
                 los=6, techs=[])
add_techs('university', *PENDING)
