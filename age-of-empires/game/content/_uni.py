"""Технологии университета из модулей обороны.

Университет может регистрировать другой модуль (или заглушка zz_university_stub.py, если его нет):
at_university() сразу добавляет технологии, если здание уже есть, и в любом случае запоминает их —
zz_university_stub.py (грузится последним) привязывает запомненное ещё раз (add_techs не дублирует).
"""
from ..data import BUILDINGS

PENDING = []


def at_university(*techs):
    if 'university' in BUILDINGS:
        from . import add_techs
        add_techs('university', *techs)
    PENDING.extend(techs)
