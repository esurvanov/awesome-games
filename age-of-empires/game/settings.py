"""Game settings (the "Settings" screen, 5 tabs) - one file ~/.cache/khroniki/settings.json.

The same file is written by the sound (game/sound.py: music, sfx, music_vol, sfx_vol, voice_vol) - saving always
writes over the keys already there, other keys are not lost.

API:
  get(key, default=None)  - the value (from the file or DEFAULTS)
  put(key, value)         - write and save
  data()                  - the whole dict (live; after editing - save())
Keys: see DEFAULTS. The interface (hud.py) reads 'show_hotkeys'; keys - game/keymap.py ('keys').
"""
import json
import os

# KHRONIKI_HOME - another folder (checks do not touch the player's real settings)
HOME = os.environ.get('KHRONIKI_HOME') or os.path.join(os.path.expanduser('~'), '.cache', 'khroniki')
PATH = os.path.join(HOME, 'settings.json')

DEFAULTS = {
    # Game
    'language': None,           # language code (game/i18n.py LANGS); None - detect by the system locale
    'game_speed': 1.7,          # the default speed of a new match (1.0 / 1.5 / 1.7 / 2.0)
    'scroll_speed': 1.0,        # camera scroll speed multiplier (0.5-2.0)
    'edge_scroll': True,        # scrolling by the screen edge
    'wheel_zoom': True,         # mouse wheel - zoom (DE); off - the wheel moves the map
    'autosave': 0,              # minutes between autosaves (0 - off)
    # Graphics
    'fullscreen': False,
    'fps_limit': 60,
    'live_menu_bg': True,       # menu background - a snapshot of a real town
    # Interface
    'show_hotkeys': False,      # hotkey letters on the panel buttons (hud.py: hud_opt)
    'show_score': True,         # player score above the minimap (F4)
    'global_queue': True,       # the global production queue (a panel above the commands)
    'tooltip_scale': 100,       # tooltip size, %
    'cursor_soft': None,        # software cursor (crisp on Retina): None - auto (Retina -> on)
    'hp_bars': 'selected',      # health bars: 'selected' | 'always'
    'team_colors': False,       # "own / ally / enemy" colors instead of the players' colors
    'player_name': '',          # empty - "Player" in the player's language (i18n.player_name())
    # Sound (the main keys are driven by sound.py)
    'voice_vol': 0.8,
    # Hotkeys: action -> a pygame key name (see keymap.ACTIONS)
    'keys': {},
    # the last lobby setup
    'lobby': None,
}

_data = None
_dirty = set()              # keys changed through put() (only they are written over the file)


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
    """Write over the file, keeping the keys that others write (sound)."""
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
