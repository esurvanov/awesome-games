"""Reference values for web/tests/test_G3-sim.mjs from the Python modules (naval, defense, orders, match, market,
stats, savegame). Run: SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G3-sim_ref.py"""
import json
import math
import os
import random
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, ROOT)
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')

import game.data  # noqa: E402,F401
from game import naval, defense, orders, match, market, stats, savegame  # noqa: E402


class P:
    def __init__(self, team):
        self.team = team


class FW:
    def __init__(self, W, H, map_type, teams):
        self.W, self.H = W, H
        self.map_type = map_type
        self.terrain = [[0] * W for _ in range(H)]
        self.occ = [[None] * W for _ in range(H)]
        self.players = [P(t) for t in teams]
        self.nodes = []


def water_case(seed, map_type, teams, W=90):
    random.seed(seed)
    w = FW(W, W, map_type, teams)
    n = len(teams)
    mx = my = (W - 1) / 2
    R = W / 2 - 8
    slot_ang = [i * math.tau / n + 0.3 for i in range(n)]
    starts = [(int(mx + math.cos(a) * R), int(my + math.sin(a) * R)) for a in slot_ang]
    fwd = [math.atan2(my - sy, mx - sx) for sx, sy in starts]
    naval.gen_water(w, starts, slot_ang, R)
    naval.place_fish(w, starts, fwd)
    lc, wc, wsize = naval.comps(w)
    sh = naval.shores(w)
    water = [(x, y) for y in range(W) for x in range(W) if naval.water_ok(w, x, y)]
    a, b = water[len(water) // 7], water[len(water) * 5 // 7]
    path = naval.find_path_water(w, a, [b], b[0], b[1])
    near = [naval.nearest_water_tile(w, x, y) for x, y in starts]
    return {
        'seed': seed, 'map_type': map_type, 'teams': teams, 'W': W, 'starts': starts, 'slot_ang': slot_ang,
        'fwd': fwd, 'R': R,
        'terrain': [''.join(str(v) for v in row) for row in w.terrain],
        'fish': [(nd.kind, nd.tx, nd.ty) for nd in w.nodes],
        'lc': lc, 'wc': wc, 'wsize': sorted(wsize.items()), 'shores': len(sh), 'shores_head': sh[:20],
        'a': a, 'b': b, 'path': path, 'near': near, 'after': random.random(),
    }


class U:
    def __init__(self, x, y, radius, cls, spd=1.0):
        self.x, self.y, self.radius, self.cls, self.spd = x, y, radius, cls, spd

    def speed(self):
        return self.spd


def layout_case(seed, n, form):
    rnd = random.Random(seed)
    clss = ['cav', 'inf', 'vil', 'arch', 'siege', 'monk']
    us = [U(rnd.uniform(0, 400), rnd.uniform(0, 400), rnd.choice((8, 10, 14)), rnd.choice(clss)) for _ in range(n)]
    out = orders.layout(us, 640.0, 320.0, form)
    return {'units': [(u.x, u.y, u.radius, u.cls) for u in us], 'form': form,
            'out': [(us.index(u), x, y) for u, x, y in out]}


class MP:
    def __init__(self):
        self.res = {'food': 1000, 'wood': 1000, 'gold': 5000, 'stone': 1000}
        self.id = 0

    def stat(self, stat, kind, base, res=None, src=None):
        return 0.15 if stat == 'market_fee' else base


def market_case():
    p = MP()
    seq = []
    for r in ('food', 'wood', 'stone', 'food', 'food'):
        seq.append((market.buy_price(p, r), market.sell_price(p, r)))
        market._shift(p, r, market.PRICE_STEP)
    for _ in range(40):
        market._shift(p, 'stone', -market.PRICE_STEP)
    seq.append((market.buy_price(p, 'stone'), market.sell_price(p, 'stone')))
    return {'seq': seq, 'tribute_cost': market.tribute_cost(p, 100), 'prices': market.prices(p)}


class SW:
    pass


class SU:
    def __init__(self, owner, x, y, los, kind='villager'):
        self.owner, self.x, self.y, self._los, self.kind = owner, x, y, los, kind
        self.d = {'civil': kind == 'trade_cart'}

    def los(self):
        return self._los


def stats_case():
    rnd = random.Random(5)
    w = SW()
    w.W = w.H = 70
    w.players = [0, 1, 2]
    w.human = 0
    w.time = 12.34
    w.units = [SU(rnd.randrange(3), rnd.uniform(0, 70 * 32), rnd.uniform(0, 70 * 32), rnd.choice((4, 6.5, 8)),
                  rnd.choice(('villager', 'knight', 'trade_cart'))) for _ in range(30)]
    w.buildings = []
    w.explored = bytearray(70 * 70)
    for i in range(0, 70 * 70, 3):
        w.explored[i] = 1
    stats.init(w)
    stats.explore(w)
    return {'units': [(u.owner, u.x, u.y, u._los, u.kind) for u in w.units],
            'stats': w.stats, 'grids': [list(g) for g in w.explore_grid]}


def teams_case():
    out = []
    for seed in range(6):
        random.seed(seed)
        out.append((seed, match.resolve_teams([5, 5, 5, 5]), match.resolve_teams([0, 5, 2, 5, 1]), random.random()))
    return out


ref = {
    'water': [water_case(s, mt, teams) for s, mt, teams in
              [(1, 'coast', [0, 1]), (2, 'coast', [0, 1, 2, 3]), (3, 'islands', [0, 1]),
               (4, 'islands', [0, 0, 1, 1]), (7, 'islands', [0, 1, 2])]],
    'line_tiles': [(a, defense.line_tiles(*a)) for a in [(0, 0, 7, 3), (5, 5, 1, 9), (2, 2, 2, 2), (0, 0, -6, -6), (3, 1, 10, 2)]],
    'layout': [layout_case(s, n, f) for s, n, f in [(1, 7, 'line'), (2, 12, 'box'), (3, 9, 'staggered'), (4, 16, 'flank'),
                                                    (5, 3, 'line'), (6, 25, 'line'), (7, 20, 'box')]],
    'rows': [(n, f, orders._rows(n, f)) for n in (1, 4, 5, 9, 17, 40) for f in ('line', 'box')],
    'market': market_case(),
    'stats': stats_case(),
    'teams': teams_case(),
    'teams_valid': [(r, match.teams_valid(r)) for r in ([1], [1, 1], [1, 2], [0, 1], [5, 5], [3, 3, 3])],
    'defaults': match.defaults(),
    'normalize': match.normalize({'pop': 75, 'bogus': 1, 'speed': 2.0}),
    'map_side': [(s, n, match.map_side(s, n)) for s, n in [({}, 2), ({'size': 'huge'}, 2), ({'size': 'auto'}, 9),
                                                          ({'size': 'x'}, 5)]],
    'ages': [(s, match.start_age(s), match.max_age(s)) for s in [{}, {'start_age': 'post', 'end_age': 'castle'},
                                                                 {'start_age': 'feudal', 'end_age': 'standard'}]],
    'slot_path': [(s, os.path.relpath(savegame.slot_path(s), savegame.SAVE_DIR)) for s in
                  ['autosave', 'my save!', 'Сохранение 1', '', 'x' * 60, 12]],
    'value': [(k, stats.value(k)) for k in ('villager', 'knight', 'castle', 'feudal', 'nope')],
}
with open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G3-sim_ref.json'), 'w') as f:
    json.dump(ref, f)
print('ok')
