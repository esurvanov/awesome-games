"""Горячие клавиши с переназначением (Настройки → «Горячие клавиши»).

  key_for(action, default=None) -> код клавиши pygame
      Назначенная игроком клавиша действия; иначе default (если передан), иначе — клавиша по умолчанию
      из ACTIONS. Ввод игры может спрашивать так: `if k == keymap.key_for('pause', pygame.K_p)`.
  matches(action, key) -> bool — нажатая клавиша относится к действию (с учётом запасных клавиш).
  translate(key) — для ввода игры (screens.overlay_event): назначенная клавиша → клавиша по умолчанию.
  set_key(action, key) / reset() — сохранить в settings.json ('keys': {действие: имя клавиши}).
Имена клавиш хранятся строками pygame.key.name() — файл читается человеком.
"""
import pygame

from . import settings

# (действие, подпись, клавиша по умолчанию, запасные клавиши) — порядок = порядок в списке настроек
ACTIONS = [
    ('menu', 'Меню игры', 'f10', ()),
    ('help', 'Управление (справка)', 'f1', ()),
    ('civ', 'Карточка цивилизации', 'f2', ()),
    ('pause', 'Пауза', 'f3', ('p', 'pause')),
    ('score', 'Счёт игроков', 'f4', ()),
    ('objectives', 'Задачи', 'f5', ()),
    ('quick_save', 'Быстрое сохранение', 'f7', ()),
    ('quick_load', 'Быстрая загрузка', 'f8', ()),
    ('idle_villager', 'Праздный житель', '.', ()),
    ('idle_military', 'Праздный воин', ',', ()),
    ('town_center', 'Городской центр', 'h', ()),
    ('go_selected', 'К выделенному', 'space', ()),
    ('delete', 'Удалить', 'delete', ()),
    ('speed_up', 'Быстрее', '=', ('+', '[+]')),
    ('speed_down', 'Медленнее', '-', ('[-]',)),
    ('music', 'Музыка вкл/выкл', 'm', ()),
    ('sfx', 'Звуки вкл/выкл', 'n', ()),
]
LABEL = {a: lbl for a, lbl, _, _ in ACTIONS}
DEFAULT = {a: k for a, _, k, _ in ACTIONS}
ALT = {a: alt for a, _, _, alt in ACTIONS}


def _code(name):
    try:
        return pygame.key.key_code(name)
    except (ValueError, pygame.error, AttributeError):
        return None


def name_for(action):
    """Имя назначенной клавиши (строка pygame)."""
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
        return False            # переназначено — запасные клавиши по умолчанию больше не действуют
    return any(_code(n) == key for n in ALT.get(action, ()))


def default_code(action):
    return _code(DEFAULT.get(action, ''))


def translate(key):
    """Переназначение для ввода игры: нажатая клавиша → код клавиши по умолчанию её действия (если действие
    переназначено на неё), 'swallow' — клавиша по умолчанию действия, которое переназначено на другую,
    None — не трогать. Так ввод, написанный под клавиши по умолчанию, слушается настроек."""
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
    """Назначить клавишу (код pygame). Если клавиша уже занята другим действием — у того
    действия меняются местами (как в DE: без двух действий на одной клавише)."""
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
    """Имя клавиши для подписи: 'f10' → 'F10', 'space' → 'Пробел'."""
    t = {'space': 'Пробел', 'delete': 'Delete', 'backspace': 'Backspace', 'return': 'Enter', 'escape': 'Esc',
         'tab': 'Tab', 'pause': 'Pause'}
    if kn in t:
        return t[kn]
    return kn.upper() if len(kn) <= 3 else kn.capitalize()
