"""Hotkeys with remapping (Settings -> "Hotkeys").

  key_for(action, default=None) -> a pygame key code
      The key assigned by the player to the action; otherwise default (if passed), otherwise - the default key
      from ACTIONS. Game input can ask like this: `if k == keymap.key_for('pause', pygame.K_p)`.
  matches(action, key) -> bool - the pressed key belongs to the action (taking spare keys into account).
  translate(key) - for game input (screens.overlay_event): the assigned key -> the default key.
  set_key(action, key) / reset() - save to settings.json ('keys': {action: key name}).
Key names are stored as pygame.key.name() strings - the file is human-readable.
"""
import pygame

from . import i18n
from . import settings

# (action, locale caption key, default key, spare keys) - order = the order in the settings list
ACTIONS = [
    ('menu', 'keys.menu', 'f10', ()),
    ('help', 'keys.help', 'f1', ()),
    ('civ', 'keys.civ', 'f2', ()),
    ('pause', 'keys.pause', 'f3', ('p', 'pause')),
    ('score', 'keys.score', 'f4', ()),
    ('objectives', 'keys.objectives', 'f5', ()),
    ('quick_save', 'keys.quick_save', 'f7', ()),
    ('quick_load', 'keys.quick_load', 'f8', ()),
    ('idle_villager', 'keys.idle_villager', '.', ()),
    ('idle_military', 'keys.idle_military', ',', ()),
    ('town_center', 'keys.town_center', 'h', ()),
    ('go_selected', 'keys.go_selected', 'space', ()),
    ('delete', 'keys.delete', 'delete', ()),
    ('speed_up', 'keys.speed_up', '=', ('+', '[+]')),
    ('speed_down', 'keys.speed_down', '-', ('[-]',)),
    ('music', 'keys.music', 'm', ()),
    ('sfx', 'keys.sfx', 'n', ()),
]
LABEL = {a: lbl for a, lbl, _, _ in ACTIONS}     # locale keys; the caption is label(action)
DEFAULT = {a: k for a, _, k, _ in ACTIONS}
ALT = {a: alt for a, _, _, alt in ACTIONS}


def label(action):
    """The action's caption in the player's language."""
    return i18n.t(LABEL.get(action, action))


def _code(name):
    try:
        return pygame.key.key_code(name)
    except (ValueError, pygame.error, AttributeError):
        return None


def name_for(action):
    """The name of the assigned key (a pygame string)."""
    return (settings.get('keys') or {}).get(action) or DEFAULT.get(action, '')


def key_for(action, default=None):
    kn = (settings.get('keys') or {}).get(action)
    if kn:
        c = _code(kn)
        if c is not None:
            return c
    if default is not None:
        return default
    return _code(DEFAULT.get(action, '')) if action in DEFAULT else None


def matches(action, key):
    if key == key_for(action):
        return True
    if (settings.get('keys') or {}).get(action):
        return False            # remapped - the spare default keys no longer work
    return any(_code(n) == key for n in ALT.get(action, ()))


def default_code(action):
    return _code(DEFAULT.get(action, ''))


def translate(key):
    """Remapping for game input: the pressed key -> the default key code of its action (if the action
    is remapped to it), 'swallow' - the default key of an action that is remapped to another key,
    None - leave alone. This way input written for default keys obeys the settings."""
    keys = settings.get('keys') or {}
    if not keys:
        return None
    for a, kn in keys.items():
        if kn and a in DEFAULT and kn != DEFAULT[a] and _code(kn) == key:
            return _code(DEFAULT[a])
    for a, kn in keys.items():
        if kn and a in DEFAULT and kn != DEFAULT[a] and (_code(DEFAULT[a]) == key or
                                                        any(_code(x) == key for x in ALT.get(a, ()))):
            return 'swallow'
    return None


def set_key(action, key):
    """Assign a key (a pygame code). If the key is already taken by another action, that
    action's keys are swapped (as in DE: no two actions on one key)."""
    keys = dict(settings.get('keys') or {})
    kn = pygame.key.name(key)
    old = name_for(action)
    for a, _, _, _ in ACTIONS:
        if a != action and name_for(a) == kn:
            keys[a] = old
    keys[action] = kn
    settings.put('keys', keys)


def reset():
    settings.put('keys', {})


def pretty(kn):
    """A key name for a caption: 'f10' -> 'F10', 'space' -> "Space" in the player's language."""
    names = {'space': i18n.t('key.space'), 'delete': 'Delete', 'backspace': 'Backspace', 'return': 'Enter',
             'escape': 'Esc', 'tab': 'Tab', 'pause': 'Pause'}
    if kn in names:
        return names[kn]
    return kn.upper() if len(kn) <= 3 else kn.capitalize()
