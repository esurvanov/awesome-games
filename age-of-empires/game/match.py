"""Параметры партии (колонка «Параметры игры» в лобби, как Game Settings в AoE2 DE) и их действие на мир.

  OPTIONS            — [(ключ, подпись, [(значение, подпись)…], по умолчанию)] — строки колонки лобби
  defaults()         — словарь всех параметров по умолчанию
  normalize(s)       — дополнить словарь недостающими ключами
  map_side(s, n, mt) — сторона карты в клетках
  apply_start(w)     — после генерации карты: ресурсы, начальная эпоха, открытая карта, полное дерево…
  treaty_active(w)   — идёт ли перемирие (нападать на чужих нельзя)
  victory_check(w)   — особые условия победы (время, очки); вызывается из World.check_victory

Правила взяты из AoE2 (см. docs/research/02_menus.md, M15–M26): ресурсы Low/Medium/High/Ultra,
Death Match (20000/20000/10000/5000), население 25–200, начальная/конечная эпоха, перемирие 5–60 мин
(«нельзя нападать»), победа: стандарт / завоевание / лимит времени / очки.
"""
import random

from .data import AGE_TECHS, TECHS, BUILDINGS

M = 60.0

# ---- таблицы
RESOURCES = {       # еда, дерево, золото, камень
    'standard': None,                                   # стандартные (START_RES + бонусы цивилизаций)
    'low': (200, 200, 100, 200),
    'medium': (500, 500, 300, 300),
    'high': (1000, 1000, 700, 700),
    'ultra': (10000, 10000, 10000, 10000),
}
DEATHMATCH = (20000, 20000, 10000, 5000)
MAP_SIZE = {'tiny': 120, 'small': 144, 'medium': 168, 'normal': 200, 'large': 220, 'huge': 240}   # DE
AUTO_SIZE = {2: 'tiny', 3: 'small', 4: 'medium', 5: 'normal', 6: 'normal', 7: 'large', 8: 'large'}
AGE_IDX = {'standard': 0, 'dark': 0, 'feudal': 1, 'castle': 2, 'imperial': 3, 'post': 3}
POST_VILLAGERS = 20         # постимперская эпоха: жителей на старте (вместо 3)
ECO_HOSTS = ('town_center', 'mill', 'lumber_camp', 'mining_camp', 'market', 'dock')

OPTIONS = [
    ('mode', 'Режим игры', [('rm', 'Случайная карта'), ('dm', 'Смертельная схватка')], 'rm'),
    ('size', 'Размер карты', [('auto', 'Авто (по игрокам)'), ('tiny', 'Крошечная (2) · 120'),
                              ('small', 'Маленькая (3) · 144'), ('medium', 'Средняя (4) · 168'),
                              ('normal', 'Обычная (6) · 200'), ('large', 'Большая (8) · 220'),
                              ('huge', 'Огромная (8) · 240')], 'auto'),
    ('theme', 'Пейзаж', [('auto', 'Авто (по карте)'), ('grass', 'Луга'), ('desert', 'Пустыня'),
                         ('steppe', 'Степь'), ('snow', 'Снега'), ('tropical', 'Тропики'), ('autumn', 'Осень')],
     'auto'),                                   # Пустошь «Авто» — 1 из 6 пейзажей (как биомы Arabia DE)
    ('ai_all', 'Сложность ИИ', None, None),            # общий выбор: ставит уровень всем компьютерам
    ('resources', 'Ресурсы', [('standard', 'Стандарт'), ('low', 'Мало'), ('medium', 'Средне'),
                              ('high', 'Много'), ('ultra', 'Очень много')], 'standard'),
    ('pop', 'Население', [(v, str(v)) for v in range(25, 201, 25)], 200),
    ('speed', 'Скорость игры', [(1.0, 'Медленная'), (1.5, 'Спокойная'), (1.7, 'Нормальная'), (2.0, 'Быстрая')],
     1.7),
    ('reveal', 'Открытие карты', [('normal', 'Обычное'), ('explored', 'Разведана'), ('all', 'Всё видно')],
     'normal'),
    ('start_age', 'Начальная эпоха', [('standard', 'Стандарт'), ('dark', 'Тёмные века'), ('feudal', 'Феодальная'),
                                      ('castle', 'Замков'), ('imperial', 'Имперская'),
                                      ('post', 'Постимперская')], 'standard'),
    ('end_age', 'Конечная эпоха', [('standard', 'Стандарт'), ('dark', 'Тёмные века'), ('feudal', 'Феодальная'),
                                   ('castle', 'Замков'), ('imperial', 'Имперская')], 'standard'),
    ('treaty', 'Перемирие', [(0, 'Нет')] + [(m, f'{m} мин') for m in range(5, 61, 5)], 0),
    ('victory', 'Победа', [('standard', 'Стандарт'), ('conquest', 'Завоевание'), ('time', 'Лимит времени'),
                           ('score', 'Очки')], 'standard'),
    ('victory_time', 'Лимит времени', [(m, f'{m} мин') for m in (10, 15, 20, 30, 45, 60, 90, 120)], 30),
    ('victory_score', 'Цель по очкам', [(v, str(v)) for v in (1000, 2000, 4000, 6000, 8000, 10000, 15000)], 4000),
]
FLAGS = [   # флажки «Команды» и «Дополнительно»
    ('lock_teams', 'Закрепить команды', True),
    ('team_together', 'Команды рядом', True),
    ('lock_speed', 'Закрепить скорость', False),
    ('all_techs', 'Полное дерево технологий', False),
]
OPT = {k: (lbl, vals, d) for k, lbl, vals, d in OPTIONS}
LABEL = {k: lbl for k, lbl, _, _ in OPTIONS}
HIDDEN_UNLESS = {'victory_time': ('victory', 'time'), 'victory_score': ('victory', 'score')}

# уровни ИИ как в DE (0…5) — PROFILES в game/ai.py
AI_LEVELS = ['Легчайший', 'Стандартный', 'Средний', 'Сложный', 'Сложнейший', 'Экстрим']
LEVEL_OF_DIFF = {0: 0, 1: 2, 2: 3}      # старые 3 уровня (Легко/Нормально/Сложно) → уровни DE
TIER_OF_LEVEL = (0, 0, 1, 2, 2, 2)      # уровень DE → «ступень» старого кода ИИ (сравнения diff >= 1/2)
LEVEL_GATHER = (0.85, 0.92, 1.0, 1.3, 1.45, 1.6)    # бонус к добыче компьютера (как раньше: 0.85/1.0/1.3)


def defaults():
    d = {k: dflt for k, _, vals, dflt in OPTIONS if vals is not None}
    d.update({k: v for k, _, v in FLAGS})
    d['map'] = 'arabia'
    return d


def normalize(s):
    d = defaults()
    if s:
        d.update({k: v for k, v in s.items() if k in d})
    return d


def visible(s, key):
    cond = HIDDEN_UNLESS.get(key)
    return cond is None or s.get(cond[0]) == cond[1]


def value_label(key, v):
    vals = OPT[key][1] or []
    for val, lbl in vals:
        if val == v:
            return lbl
    return str(v)


def map_side(s, n, map_type='arabia'):
    """Сторона карты DE по размеру (tiny 120 … huge 240); «авто» — по числу игроков, как в DE."""
    size = s.get('size', 'auto')
    if size == 'auto' or size not in MAP_SIZE:
        size = AUTO_SIZE.get(n, 'large')
    return MAP_SIZE[size]


def start_age(s):
    return AGE_IDX.get(s.get('start_age', 'standard'), 0)


def max_age(s):
    e = s.get('end_age', 'standard')
    return 3 if e == 'standard' else AGE_IDX.get(e, 3)


# ============================================================ начало партии
def apply_start(w):
    """После генерации карты и хуков контента (стартовые юниты цивилизаций)."""
    s = w.settings
    w.pop_limit = int(s.get('pop', 200))
    w.max_age = max_age(s)
    w.treaty_end = float(s.get('treaty', 0) or 0) * M
    w.reveal = s.get('reveal', 'normal')
    # ресурсы: Death Match — свои числа; стандарт — как было (с бонусами цивилизаций)
    table = DEATHMATCH if s.get('mode') == 'dm' else RESOURCES.get(s.get('resources', 'standard'))
    if table is not None:
        for p in w.players:
            civ_add = _civ_start(p.civ)
            for r, v in zip(('food', 'wood', 'gold', 'stone'), table):
                p.res[r] = max(0, v + civ_add.get(r, 0))
    # полное дерево технологий: снять запреты цивилизаций (кроме чужих уникальных)
    if s.get('all_techs'):
        from .world import civ_bans
        for p in w.players:
            p.banned = civ_bans(p.civ, full=True)
    # начальная эпоха
    age = min(start_age(s), w.max_age)
    if age > 0:
        for p in w.players:
            for t in AGE_TECHS[:age]:
                if t not in p.techs:
                    w.apply_tech(p, t)
        if s.get('start_age') == 'post':
            for p in w.players:
                _post_imperial(w, p)
        w.messages.clear()
        w.events.clear()
        w.recount()
    # открытая карта
    if w.reveal in ('explored', 'all'):
        w.explored[:] = b'\x01' * (w.W * w.H)
        for b in w.buildings:
            b.seen = True
        w.fog_version += 1
    w.update_teams()


def _civ_start(civ):
    from .data import CIVS
    return CIVS.get(civ, {}).get('start', {})


def _post_imperial(w, p):
    """Постимперская эпоха (AoE2): Имперская + изучены экономические технологии, 20 жителей."""
    from .world import Unit
    from .data import TILE
    for host in ECO_HOSTS:
        for t in BUILDINGS.get(host, {}).get('techs', ()):
            if t in TECHS and t not in AGE_TECHS and t not in p.techs and p.allows(t) \
                    and TECHS[t].get('age', 0) <= 3:
                ok = all(r in p.techs for r in _req(t))
                if ok:
                    w.apply_tech(p, t)
    # второй проход — цепочки (req) изучились по порядку
    for host in ECO_HOSTS:
        for t in BUILDINGS.get(host, {}).get('techs', ()):
            if t in TECHS and t not in AGE_TECHS and t not in p.techs and p.allows(t) \
                    and all(r in p.techs for r in _req(t)):
                w.apply_tech(p, t)
    tc = next((b for b in w.buildings if b.owner == p.id and b.kind == 'town_center'), None)
    if tc is None:
        return
    have = sum(1 for u in w.units if u.owner == p.id and u.kind == 'villager')
    cx, cy = tc.tx + tc.w // 2, tc.ty + tc.h // 2
    for i in range(max(0, POST_VILLAGERS - have)):
        tx, ty = w.nearest_free_tile(cx + (i % 5) - 2, cy + tc.h // 2 + 2 + i // 5)
        w.units.append(Unit('villager', p.id, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w))


def _req(t):
    r = TECHS[t].get('req', ())
    return r if isinstance(r, tuple) else (r,)


# ============================================================ перемирие
def treaty_active(w):
    return w.time < getattr(w, 'treaty_end', 0.0)


def treaty_left(w):
    return max(0.0, getattr(w, 'treaty_end', 0.0) - w.time)


# ============================================================ победа
def victory_check(w, teams):
    """Особые условия: лимит времени (побеждает команда с наибольшим счётом) и счёт (первая команда,
    набравшая цель). teams — живые команды. Возвращает номер команды-победителя или None."""
    s = w.settings
    v = s.get('victory', 'standard')
    if v not in ('time', 'score') or len(teams) <= 1:
        return None
    from .scoring import team_scores
    if v == 'time':
        if w.time < float(s.get('victory_time', 30)) * M:
            return None
        sc = team_scores(w)
        best = max((t for t in teams), key=lambda t: sc.get(t, 0))
        return best
    target = float(s.get('victory_score', 4000))
    sc = team_scores(w)
    for t in sorted(teams, key=lambda t: -sc.get(t, 0)):
        if sc.get(t, 0) >= target:
            return t
    return None


def resolve_teams(raw, rnd=None):
    """Команды слотов лобби → номера команд мира. raw: 0 — «–» (сам за себя), 1–4, 5 — «?» (случайная).
    «?» подбирается так, чтобы в партии осталось хотя бы две команды."""
    rnd = rnd or random
    n = len(raw)
    for _ in range(40):
        t = []
        for i, v in enumerate(raw):
            if v == 0:
                t.append(10 + i)            # «–»: своя команда
            elif v == 5:
                t.append(rnd.randint(1, 4))
            else:
                t.append(v)
        if len(set(t)) >= 2 or n < 2:
            break
    # плотные номера 0…
    order = []
    for x in t:
        if x not in order:
            order.append(x)
    return [order.index(x) for x in t]


def teams_valid(raw):
    """Можно ли начинать: есть «?» / «–» или хотя бы две разные команды."""
    if len(raw) < 2:
        return False
    if any(v in (0, 5) for v in raw):
        return True
    return len(set(raw)) >= 2
