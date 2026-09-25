"""Заглушка университета: регистрируется, только если настоящего университета ещё нет.

Затем привязывает к университету технологии обороны (см. _uni.py) — это нужно в обоих случаях.
"""
from . import add_building, add_techs
from ._uni import PENDING
from ..data import BUILDINGS

if 'university' not in BUILDINGS:
    add_building('university', name='Университет', size=3, hp=2100, cost={'wood': 200}, time=60, age=2,
                 los=6, techs=[], desc='Технологии обороны и стройки')
add_techs('university', *PENDING)
