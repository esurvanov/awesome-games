"""Localization: all game texts come from assets/locale/<code>.json (flat keys like 'unit.knight.name').

  t(key, **fmt)        - a string in the current language; no key - English, not there either - the key itself.
                         Substitutions are {n}, {name}... via str.format (KHRONIKI_LANG=xx - the language for tools).
  set_language(code)   - switch the language: rewrite the names in the data.py tables (relabel), reset fonts
                         and subscriber caches (on_change), remember it in settings.json ('language').
  available()          - [(code, name in its own language)] - the list for the settings.
  current()            - the current language code; is_cjk() - a font with ideographs is needed (zh-CN, ja).
  name_of(kind, key)   - a table entry's name: name_of('unit', 'knight'); desc_of - the description.
  player_name()        - the human's name from the settings or "Player" in the current language.
The language at the first launch - by the system locale (locale.getlocale / LANG), the nearest of LANGS.

The data.py tables (UNITS, BUILDINGS, TECHS, CIVS, ANIMALS, NODE_DEFS, RES_NAME, AGE_NAMES, COLOR_NAMES...) and maps.MAPS
keep only keys in code; the 'name' / 'desc' / 'icon' fields in them are filled in by relabel() from the locale - at load and on
every language change, so the rest of the code reads d['name'] as before.
"""
import json
import locale
import os

from . import settings

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'locale')
LANGS = [('en', 'English'), ('ru', 'Русский'), ('de', 'Deutsch'), ('fr', 'Français'), ('es', 'Español'),
         ('pt-BR', 'Português (Brasil)'), ('it', 'Italiano'), ('pl', 'Polski'), ('tr', 'Türkçe'),
         ('zh-CN', '简体中文'), ('ja', '日本語')]
CODES = [c for c, _ in LANGS]
CJK = ('zh-CN', 'ja')
DEFAULT = 'en'
COLOR_KEYS = ['blue', 'red', 'green', 'yellow', 'cyan', 'purple', 'grey', 'orange']

_tables = {}
_lang = None
_cur = {}
_en = {}
_listeners = []


def load(code):
    """A language dictionary from a file (cached); no file - empty."""
    d = _tables.get(code)
    if d is None:
        d = {}
        try:
            with open(os.path.join(DIR, code + '.json'), encoding='utf-8') as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                d = {str(k): str(v) for k, v in raw.items()}
        except (OSError, ValueError):
            pass
        _tables[code] = d
    return d


def available():
    return list(LANGS)


def is_cjk(code=None):
    return (code or current()) in CJK


def current():
    if _lang is None:
        init()
    return _lang


def t(key, **fmt):
    if _lang is None:
        init()
    s = _cur.get(key)
    if s is None:
        s = _en.get(key)
        if s is None:
            return key
    if fmt:
        try:
            s = s.format(**fmt)
        except (KeyError, IndexError, ValueError):
            pass
    return s


def has(key):
    if _lang is None:
        init()
    return key in _cur or key in _en


def name_of(kind, key):
    return t(f'{kind}.{key}.name')


def desc_of(kind, key):
    return t(f'{kind}.{key}.desc')


def player_name():
    return settings.get('player_name') or t('player.default_name')


# ============================================================ language choice
def detect():
    """The language code by the system locale (or KHRONIKI_LANG), the nearest of CODES."""
    cands = [os.environ.get('KHRONIKI_LANG')]
    try:
        cands.append(locale.getlocale()[0])
    except (ValueError, TypeError):
        pass
    for var in ('LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE'):
        cands.append(os.environ.get(var))
    for c in cands:
        code = match_code(c)
        if code:
            return code
    return DEFAULT


def match_code(raw):
    if not raw:
        return None
    s = str(raw).split('.')[0].split('@')[0].replace('_', '-')
    if s in CODES:
        return s
    low = s.lower()
    for c in CODES:
        if c.lower() == low:
            return c
    base = low.split('-')[0]
    if base == 'zh':
        return 'zh-CN'
    if base == 'pt':
        return 'pt-BR'
    for c in CODES:
        if c.lower().split('-')[0] == base:
            return c
    return None


def init():
    """The language from the settings; at the first launch - by the system locale (and remembered)."""
    if _lang is not None:
        return _lang
    forced = match_code(os.environ.get('KHRONIKI_LANG'))
    saved = match_code(settings.get('language'))
    code = forced or saved or detect()
    _apply(code)
    if saved != code and not forced:
        try:
            settings.put('language', code)
        except Exception:
            pass
    return _lang


def _apply(code):
    global _lang, _cur, _en
    _en = load(DEFAULT)
    _cur = load(code) if code != DEFAULT else _en
    _lang = code
    relabel()


def set_language(code, persist=True):
    """Switch the language (in the game and in the menu right away): tables, fonts, subscriber caches."""
    code = match_code(code) or DEFAULT
    _apply(code)
    for fn in list(_listeners):
        try:
            fn(code)
        except Exception:
            pass
    if persist:
        try:
            settings.put('language', code)
        except Exception:
            pass
    return code


def on_change(fn):
    """Subscribe to language changes (resetting caches with text): fn(code)."""
    if fn not in _listeners:
        _listeners.append(fn)
    return fn


# ============================================================ tables
def relabel():
    """Fill in 'name' / 'desc' / 'icon' of the data.py and maps.py tables from the current locale."""
    import sys
    data = sys.modules.get(__package__ + '.data')
    if data is None or not hasattr(data, 'CIVS'):
        return
    for k, d in data.UNITS.items():
        d['name'] = t(f'unit.{k}.name')
        d['desc'] = t(f'unit.{k}.desc')
    for k, d in data.BUILDINGS.items():
        d['name'] = t(f'building.{k}.name')
        d['desc'] = t(f'building.{k}.desc')
    for k, d in data.TECHS.items():
        d['name'] = t(f'tech.{k}.name')
        d['desc'] = t(f'tech.{k}.desc')
        if has(f'tech.{k}.icon'):
            d['icon'] = t(f'tech.{k}.icon')
    for k, d in data.CIVS.items():
        d['name'] = t(f'civ.{k}.name')
        if 'style' in d or has(f'civ.{k}.style'):
            d['style'] = t(f'civ.{k}.style')
        icons = d.get('bonus_icons')
        if icons is not None:
            d['bonus'] = [(spec, t(f'civ.{k}.bonus{i + 1}')) for i, spec in enumerate(icons)]
        if d.get('team_icon') is not None:
            d['team_desc'] = (d['team_icon'], t(f'civ.{k}.team'))
    for k, d in data.ANIMALS.items():
        d['name'] = t(f'animal.{k}.name')
    for k, d in data.NODE_DEFS.items():
        d['name'] = t(f'node.{k}.name')
    for r in data.RES:
        data.RES_NAME[r] = t(f'res.{r}')
    data.COLOR_NAMES[:] = [t(f'color.{c}') for c in COLOR_KEYS]
    data.PLAYER_NAMES[:] = [t('player.you')] + data.COLOR_NAMES[1:]
    data.AGE_NAMES[:] = [t(f'age.{i}') for i in range(4)]
    data.DIFF_NAMES[:] = [t(f'diff.{k}') for k in ('easy', 'normal', 'hard')]
    maps = sys.modules.get(__package__ + '.maps')
    if maps is not None:
        for k, d in maps.MAPS.items():
            d['name'] = t(f'map.{k}.name')
            d['desc'] = t(f'map.{k}.desc')
            maps.NAMES[k] = d['name']
