"""Match parameters (the "Game Settings" column in the lobby, like Game Settings in AoE2 DE) and their effect on the world.

  OPTIONS            - [(key, caption, [(value, caption)...], default)] - the rows of the lobby column
  defaults()         - a dict of all parameters by default
  normalize(s)       - complete a dict with the missing keys
  map_side(s, n, mt) - the map side in tiles
  apply_start(w)     - after map generation: resources, starting age, map reveal, the full tree...
  treaty_active(w)   - whether a treaty is in force (attacking others is not allowed)
  victory_check(w)   - special victory conditions (time, score); called from World.check_victory

The rules are taken from AoE2 (see docs/research/02_menus.md, M15-M26): resources Low/Medium/High/Ultra,
Death Match (20000/20000/10000/5000), population 25-200, starting/ending age, treaty 5-60 min
("no attacking"), victory: standard / conquest / time limit / score.
"""
import random

from .data import AGE_TECHS, TECHS, BUILDINGS
from . import i18n

M = 60.0

# ---- tables
RESOURCES = {       # food, wood, gold, stone
    'standard': None,                                   # standard (START_RES + civilization bonuses)
    'low': (200, 200, 100, 200),
    'medium': (500, 500, 300, 300),
    'high': (1000, 1000, 700, 700),
    'ultra': (10000, 10000, 10000, 10000),
}
DEATHMATCH = (20000, 20000, 10000, 5000)
MAP_SIZE = {'tiny': 120, 'small': 144, 'medium': 168, 'normal': 200, 'large': 220, 'huge': 240}   # DE
AUTO_SIZE = {2: 'tiny', 3: 'small', 4: 'medium', 5: 'normal', 6: 'normal', 7: 'large', 8: 'large'}
AGE_IDX = {'standard': 0, 'dark': 0, 'feudal': 1, 'castle': 2, 'imperial': 3, 'post': 3}
POST_VILLAGERS = 20         # post-imperial age: villagers at the start (instead of 3)
ECO_HOSTS = ('town_center', 'mill', 'lumber_camp', 'mining_camp', 'market', 'dock')

# The captions are locale keys (match.opt.<key>, match.val.<key>.<value>, match.flag.<key>, match.ai.<n>);
# the number of minutes - 'match.minutes' with {n}; population and score - the number itself. The text comes from value_label() / label().
OPTIONS = [
    ('mode', [('rm', 'match.val.mode.rm'), ('dm', 'match.val.mode.dm')], 'rm'),
    ('size', [('auto', 'match.val.size.auto'), ('tiny', 'match.val.size.tiny'), ('small', 'match.val.size.small'),
              ('medium', 'match.val.size.medium'), ('normal', 'match.val.size.normal'),
              ('large', 'match.val.size.large'), ('huge', 'match.val.size.huge')], 'auto'),
    ('theme', [('auto', 'match.val.theme.auto'), ('grass', 'match.val.theme.grass'),
               ('desert', 'match.val.theme.desert'), ('steppe', 'match.val.theme.steppe'),
               ('snow', 'match.val.theme.snow'), ('tropical', 'match.val.theme.tropical'),
               ('autumn', 'match.val.theme.autumn')], 'auto'),   # Wasteland "Auto" - 1 of 6 landscapes (the Arabia DE biomes)
    ('ai_all', None, None),            # a common choice: sets the level for all computers
    ('resources', [('standard', 'match.val.resources.standard'), ('low', 'match.val.resources.low'),
                   ('medium', 'match.val.resources.medium'), ('high', 'match.val.resources.high'),
                   ('ultra', 'match.val.resources.ultra')], 'standard'),
    ('pop', [(v, str(v)) for v in range(25, 201, 25)], 200),
    ('speed', [(1.0, 'match.val.speed.1.0'), (1.5, 'match.val.speed.1.5'), (1.7, 'match.val.speed.1.7'),
               (2.0, 'match.val.speed.2.0')], 1.7),
    ('reveal', [('normal', 'match.val.reveal.normal'), ('explored', 'match.val.reveal.explored'),
                ('all', 'match.val.reveal.all')], 'normal'),
    ('start_age', [('standard', 'match.val.age.standard'), ('dark', 'match.val.age.dark'),
                   ('feudal', 'match.val.age.feudal'), ('castle', 'match.val.age.castle'),
                   ('imperial', 'match.val.age.imperial'), ('post', 'match.val.age.post')], 'standard'),
    ('end_age', [('standard', 'match.val.age.standard'), ('dark', 'match.val.age.dark'),
                 ('feudal', 'match.val.age.feudal'), ('castle', 'match.val.age.castle'),
                 ('imperial', 'match.val.age.imperial')], 'standard'),
    ('treaty', [(0, 'match.val.treaty.0')] + [(m, 'match.minutes') for m in range(5, 61, 5)], 0),
    ('victory', [('standard', 'match.val.victory.standard'), ('conquest', 'match.val.victory.conquest'),
                 ('time', 'match.val.victory.time'), ('score', 'match.val.victory.score')], 'standard'),
    ('victory_time', [(m, 'match.minutes') for m in (10, 15, 20, 30, 45, 60, 90, 120)], 30),
    ('victory_score', [(v, str(v)) for v in (1000, 2000, 4000, 6000, 8000, 10000, 15000)], 4000),
]
FLAGS = [   # the "Teams" and "Advanced" checkboxes: (key, caption key, default)
    ('lock_teams', 'match.flag.lock_teams', True),
    ('team_together', 'match.flag.team_together', True),
    ('lock_speed', 'match.flag.lock_speed', False),
    ('all_techs', 'match.flag.all_techs', False),
]
OPT = {k: ('match.opt.' + k, vals, d) for k, vals, d in OPTIONS}
LABEL = {k: 'match.opt.' + k for k, _, _ in OPTIONS}
HIDDEN_UNLESS = {'victory_time': ('victory', 'time'), 'victory_score': ('victory', 'score')}

# AI levels as in DE (0...5) - PROFILES in game/ai.py; captions - match.ai.0...5
AI_LEVELS = ['match.ai.%d' % i for i in range(6)]


def label(key):
    """A lobby parameter's caption in the player's language."""
    return i18n.t(LABEL.get(key, key))


def ai_level_name(level):
    return i18n.t(AI_LEVELS[max(0, min(len(AI_LEVELS) - 1, int(level)))])
LEVEL_OF_DIFF = {0: 0, 1: 2, 2: 3}      # the old 3 levels (Easy/Normal/Hard) -> DE levels
TIER_OF_LEVEL = (0, 0, 1, 2, 2, 2)      # DE level -> the "step" of the old AI code (comparisons diff >= 1/2)
LEVEL_GATHER = (0.85, 0.92, 1.0, 1.3, 1.45, 1.6)    # the computer's gather bonus (as before: 0.85/1.0/1.3)


def defaults():
    d = {k: dflt for k, vals, dflt in OPTIONS if vals is not None}
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
    """A parameter value's caption in the player's language (the number of minutes - "{n} min")."""
    vals = OPT[key][1] or []
    for val, lbl in vals:
        if val == v:
            if lbl == 'match.minutes':
                return i18n.t(lbl, n=val)
            return i18n.t(lbl) if lbl.startswith('match.') else lbl
    return str(v)


def value_labels(key):
    """[caption] of all values of a parameter in the OPT order (for the lobby list)."""
    return [value_label(key, v) for v, _ in (OPT[key][1] or [])]


def map_side(s, n, map_type='arabia'):
    """The DE map side by size (tiny 120 ... huge 240); "auto" - by the number of players, as in DE."""
    size = s.get('size', 'auto')
    if size == 'auto' or size not in MAP_SIZE:
        size = AUTO_SIZE.get(n, 'large')
    return MAP_SIZE[size]


def start_age(s):
    return AGE_IDX.get(s.get('start_age', 'standard'), 0)


def max_age(s):
    e = s.get('end_age', 'standard')
    return 3 if e == 'standard' else AGE_IDX.get(e, 3)


# ============================================================ match start
def apply_start(w):
    """After map generation and content hooks (the civilizations' starting units)."""
    s = w.settings
    w.pop_limit = int(s.get('pop', 200))
    w.max_age = max_age(s)
    w.treaty_end = float(s.get('treaty', 0) or 0) * M
    w.reveal = s.get('reveal', 'normal')
    # resources: Death Match - its own numbers; standard - as before (with civilization bonuses)
    table = DEATHMATCH if s.get('mode') == 'dm' else RESOURCES.get(s.get('resources', 'standard'))
    if table is not None:
        for p in w.players:
            civ_add = _civ_start(p.civ)
            for r, v in zip(('food', 'wood', 'gold', 'stone'), table):
                p.res[r] = max(0, v + civ_add.get(r, 0))
    # the full tech tree: lift the civilization bans (except foreign unique ones)
    if s.get('all_techs'):
        from .world import civ_bans
        for p in w.players:
            p.banned = civ_bans(p.civ, full=True)
    # starting age
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
    # map reveal
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
    """Post-Imperial Age (AoE2): Imperial + the economic techs researched, 20 villagers."""
    from .world import Unit
    from .data import TILE
    for host in ECO_HOSTS:
        for t in BUILDINGS.get(host, {}).get('techs', ()):
            if t in TECHS and t not in AGE_TECHS and t not in p.techs and p.allows(t) \
                    and TECHS[t].get('age', 0) <= 3:
                ok = all(r in p.techs for r in _req(t))
                if ok:
                    w.apply_tech(p, t)
    # a second pass - the chains (req) got researched in order
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


# ============================================================ treaty
def treaty_active(w):
    return w.time < getattr(w, 'treaty_end', 0.0)


def treaty_left(w):
    return max(0.0, getattr(w, 'treaty_end', 0.0) - w.time)


# ============================================================ victory
def victory_check(w, teams):
    """Special conditions: a time limit (the team with the highest score wins) and score (the first team
    to reach the target). teams - the living teams. Returns the winning team's number or None."""
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
    """Lobby slot teams -> world team numbers. raw: 0 - "-" (on one's own), 1-4, 5 - "?" (random).
    "?" is chosen so that at least two teams remain in the match."""
    rnd = rnd or random
    n = len(raw)
    for _ in range(40):
        t = []
        for i, v in enumerate(raw):
            if v == 0:
                t.append(10 + i)            # "-": one's own team
            elif v == 5:
                t.append(rnd.randint(1, 4))
            else:
                t.append(v)
        if len(set(t)) >= 2 or n < 2:
            break
    # dense numbers 0...
    order = []
    for x in t:
        if x not in order:
            order.append(x)
    return [order.index(x) for x in t]


def teams_valid(raw):
    """Whether the match can start: there is a "?" / "-" or at least two different teams."""
    if len(raw) < 2:
        return False
    if any(v in (0, 5) for v in raw):
        return True
    return len(set(raw)) >= 2
