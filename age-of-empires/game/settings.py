"""Настройки игры (экран «Настройки», 5 вкладок) — один файл ~/.cache/khroniki/settings.json.

Тот же файл пишет звук (game/sound.py: music, sfx, music_vol, sfx_vol, voice_vol) — сохранение всегда
дописывает поверх уже лежащих ключей, чужие ключи не теряются.

API:
  get(key, default=None)  — значение (из файла или DEFAULTS)
  put(key, value)         — записать и сохранить
  data()                  — весь словарь (живой; после правки — save())
Ключи: см. DEFAULTS. Интерфейс (hud.py) читает 'show_hotkeys'; клавиши — game/keymap.py ('keys').
"""
import json
import os

# KHRONIKI_HOME — другая папка (проверки не трогают настоящие настройки игрока)
HOME = os.environ.get('KHRONIKI_HOME') or os.path.join(os.path.expanduser('~'), '.cache', 'khroniki')
PATH = os.path.join(HOME, 'settings.json')

DEFAULTS = {
    # Игра
    'game_speed': 1.7,          # скорость новой партии по умолчанию (1.0 / 1.5 / 1.7 / 2.0)
    'scroll_speed': 1.0,        # множитель скорости прокрутки камеры (0.5–2.0)
    'edge_scroll': True,        # прокрутка краем экрана
    'wheel_zoom': True,         # колесо мыши — масштаб (DE); выкл. — колесо двигает карту
    'autosave': 0,              # минут между автосохранениями (0 — выкл.)
    # Графика
    'fullscreen': False,
    'fps_limit': 60,
    'live_menu_bg': True,       # фон меню — снимок настоящего города
    # Интерфейс
    'show_hotkeys': False,      # буквы горячих клавиш на кнопках панели (hud.py: hud_opt)
    'show_score': True,         # счёт игроков над мини-картой (F4)
    'global_queue': True,       # общая очередь производства (панель над командами)
    'tooltip_scale': 100,       # размер подсказок, %
    'hp_bars': 'selected',      # полоски здоровья: 'selected' | 'always'
    'team_colors': False,       # цвета «свой / союзник / враг» вместо цветов игроков
    'player_name': 'Игрок',
    # Звук (основные ключи ведёт sound.py)
    'voice_vol': 0.8,
    # Горячие клавиши: действие → имя клавиши pygame (см. keymap.ACTIONS)
    'keys': {},
    # последняя настройка лобби
    'lobby': None,
}

_data = None
_dirty = set()              # ключи, изменённые через put() (только их пишем поверх файла)


def _load():
    global _data
    d = {}
    try:
        with open(PATH, encoding='utf-8') as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            d = raw
    except (OSError, ValueError):
        pass
    _data = d
    return d


def data():
    return _data if _data is not None else _load()


def reload():
    return _load()


def get(key, default=None):
    d = data()
    if key in d:
        return d[key]
    if default is not None:
        return default
    v = DEFAULTS.get(key)
    return dict(v) if isinstance(v, dict) else v


def put(key, value):
    data()[key] = value
    _dirty.add(key)
    save()


def save():
    """Записать поверх файла, сохранив ключи, которые пишут другие (звук)."""
    try:
        cur = {}
        try:
            with open(PATH, encoding='utf-8') as f:
                cur = json.load(f)
            if not isinstance(cur, dict):
                cur = {}
        except (OSError, ValueError):
            pass
        d = data()
        for k in _dirty:
            if k in d:
                cur[k] = d[k]
        d.update(cur)
        os.makedirs(os.path.dirname(PATH), exist_ok=True)
        tmp = PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(cur, f, ensure_ascii=False)
        os.replace(tmp, PATH)
    except OSError:
        pass
