"""Регистрация контента: каждый модуль этого пакета дописывает свои записи в таблицы data.py.

Как добавить фичу, не трогая общие файлы:
  1. Создайте game/content/<фича>.py (модули грузятся автоматически, по алфавиту).
  2. В модуле импортируйте помощники: `from . import add_unit, add_building, add_tech, add_trains, add_techs`
     (или сами таблицы: `from ..data import UNITS, TECHS, ...`) и зарегистрируйте записи.
  3. Графику задавайте прямо в записи:
       юнит  — 'art': {'helmet': ..., 'weapon': ..., 'shield': ...} (фигурка пехотинца, см. gfx.draw_foot)
               или 'art': функция(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
       здание — 'art': функция(painter: gfx.IsoPainter, surf, color, size); без 'art' рисуется типовой дом;
       технология — 'icon': 'Аб' (текст на плашке); у улучшений ('upgrade') иконка — фигурка нового юнита.
     gfx импортируйте внутри функций (`from .. import gfx`), не на уровне модуля.
  4. Эффекты технологий и бонусы цивилизаций — списки модификаторов (формат описан в data.py над TECHS).
Порядок загрузки детерминирован, поэтому модули не должны зависеть друг от друга.
"""
import importlib
import pkgutil

from ..data import UNITS, BUILDINGS, TECHS, BUILD_MENU


def add_unit(key, **d):
    """Новый вид юнита. Обязательные поля — как у UNITS в data.py."""
    UNITS[key] = d
    return d


def add_building(key, menu=True, **d):
    """Новое здание; menu=True — добавить в меню стройки жителя."""
    BUILDINGS[key] = d
    if menu and key not in BUILD_MENU:
        BUILD_MENU.append(key)
    return d


def add_tech(key, at=None, **d):
    """Новая технология; at — здание (или кортеж зданий), где её изучают."""
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
