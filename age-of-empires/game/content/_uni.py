"""University techs from the defense modules.

Another module (or the zz_university_stub.py stub if there is none) may register the University:
at_university() adds the techs at once if the building already exists, and in any case remembers them -
zz_university_stub.py (loaded last) attaches the remembered ones once more (add_techs does not duplicate).
"""
from ..data import BUILDINGS

PENDING = []


def at_university(*techs):
    if 'university' in BUILDINGS:
        from . import add_techs
        add_techs('university', *techs)
    PENDING.extend(techs)
