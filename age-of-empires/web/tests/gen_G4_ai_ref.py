"""Reference values from the Python AI modules for web/tests/G4-ai.test.mjs.

Run: SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G4_ai_ref.py
Uses light mock objects (the same mocks are rebuilt in the JS test) - no World is needed.
"""
import json
import os
import random
import sys
from collections import Counter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, ROOT)
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')

from game import ai as ai_mod  # noqa: E402
from game import ai_war, ai_defense, eco_ai  # noqa: E402
from game.data import UNITS  # noqa: E402


class O:
    def __init__(self, **k):
        self.__dict__.update(k)


def mk_world(seed):
    W = H = 40
    terrain = [[1 if (x - 20) ** 2 + (y - 5) ** 2 < 30 else 0 for x in range(W)] for y in range(H)]
    occ = [[None] * W for _ in range(H)]
    floor = [[('f' if (x * 13 + y * 7) % 23 == 0 else None) for x in range(W)] for y in range(H)]

    def can_place(kind, tx, ty, pid, check_explored=True):
        return 0 <= tx < W - 3 and 0 <= ty < H - 3 and (tx * 7 + ty * 3) % 5 != 0
    return O(W=W, H=H, terrain=terrain, occ=occ, floor=floor, can_place=can_place, time=500.0)


def bare_ai(w, level):
    a = ai_mod.AI.__new__(ai_mod.AI)
    a.w = w
    a.pid = 1
    a.level = level
    a.diff = ai_mod.TIER_OF_LEVEL[level]
    a.prof = ai_mod.LEVELS[level]
    a.naval = None
    return a


def jsonable(x):
    if isinstance(x, dict):
        return {str(k): jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    return x


out = {}
out['LEVELS'] = jsonable(ai_mod.LEVELS)

# ---- find_spot (random.shuffle order, margin_ok)
res = []
for seed in (1, 2, 3):
    random.seed(seed)
    w = mk_world(seed)
    a = bare_ai(w, 3)
    for kind, cx, cy, rmin, rmax, margin in (('house', 20, 20, 4, 13, True), ('farm', 10, 30, 2, 7, False),
                                             ('town_center', 25, 25, 3, 6, True), ('mill', 5, 5, 1, 6, False),
                                             ('house', 20, 8, 0, 3, True)):
        res.append(a.find_spot(kind, cx, cy, rmin, rmax, margin=margin))
    res.append(random.random())
out['find_spot'] = jsonable(res)


# ---- plan_want
def cost_of(cat, name):
    return {'feudal': {'food': 500}, 'castle': {'food': 800, 'gold': 200},
            'imperial': {'food': 1000, 'gold': 800}}.get(name, {'wood': 50})


res = []
for level in range(6):
    for age in range(4):
        for nv in (8, 20, 40):
            for rsv in ({}, {'food': 800, 'gold': 200}):
                w = mk_world(0)
                w.time = 300.0 + 100 * age
                w.animals = [O(alive=True, owner=-1, x=600.0 + 10 * i, y=820.0, amount=100) for i in range(3)] + \
                    [O(alive=True, owner=0, x=900.0, y=900.0, amount=100)]
                w.nodes = [O(alive=True, kind='berries', tx=18, ty=24, amount=125),
                           O(alive=True, kind='gold', tx=21, ty=26, amount=800),
                           O(alive=False, kind='berries', tx=19, ty=24, amount=125)]
                a = bare_ai(w, level)
                a.p = O(age=age, res={'food': 120 + 300 * age, 'wood': 500, 'gold': 50 + 400 * age, 'stone': 900},
                        cost_of=cost_of)
                a.army = O(expected_cost=lambda: {'food': 0.4, 'wood': 0.2, 'gold': 0.4})
                a.base = O(center=lambda: (640.0, 800.0))
                a.max_vils = a.prof['vils'][age]
                a.blocked = {'wood': 150, 'stone': 100}
                a.blocked_t = w.time - 10 if nv == 20 else -99.0
                a.goal = {'food': 100, 'gold': 50} if age == 1 else {}
                count = Counter({'farm': 3, 'castle': 0, 'town_center': 1})
                res.append(a.plan_want(nv, rsv, [1, 2] if nv == 40 else [1], count))
out['plan_want'] = res

# ---- small helpers
out['centroid'] = [ai_war.WarPlanner.centroid([O(x=x, y=y) for x, y in pts]) for pts in
                   ([(1, 5), (3, 2), (2, 9)], [(4.5, 1.0), (0.5, 7.0), (2.0, 2.0), (9.0, 3.0)], [(7, 7)])]
out['ring_plan'] = jsonable(ai_defense.ring_plan(None, O(tx=10, ty=12, w=4, h=4)))
p = O(res={'food': 400, 'wood': 100, 'gold': 300, 'stone': 0}, afford=lambda c: all(p.res[k] >= v for k, v in c.items()))
out['invest'] = [eco_ai._invest_ok(p, c, r) for c, r in (({'food': 50}, {'food': 450}), ({'food': 50}, {'food': 360}),
                                                         ({'wood': 90}, {}), ({'wood': 190}, {}),
                                                         ({'gold': 100}, {'gold': 250}))]
out['spend'] = [eco_ai._spend_ok(p, c, r) for c, r in (({'food': 50}, {'food': 350}), ({'food': 50}, {'food': 351}))]


# ---- choose_obj (empty group -> strength 0, no siege)
def mk_bld(kind, owner, cx, cy, **d):
    return O(kind=kind, owner=owner, alive=True, d=d, center=(lambda cx=cx, cy=cy: (cx, cy)),
             dist_px=(lambda x, y, cx=cx, cy=cy: ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5))


blds = [mk_bld('house', 2, 1000.0, 1000.0), mk_bld('barracks', 2, 1100.0, 900.0, trains=['militia']),
        mk_bld('town_center', 2, 1500.0, 1500.0), mk_bld('tower', 2, 1400.0, 1300.0),
        mk_bld('farm', 2, 900.0, 950.0), mk_bld('mill', 3, 950.0, 950.0), mk_bld('palisade_wall', 2, 990.0, 990.0, wall=True)]
res = []
for tgt, cx, cy in ((2, 900.0, 900.0), (None, 900.0, 900.0), (2, 1450.0, 1350.0), (3, 0.0, 0.0)):
    w = O(hmat=[[0, 0, 1, 1], [0, 0, 1, 1]], players=[O(id=i, alive=True) for i in range(4)], buildings=blds,
          units=[], time=100.0)
    a = bare_ai(w, 3)
    a.target = tgt
    wp = ai_war.WarPlanner(a)
    obj = wp.choose_obj(cx, cy)
    res.append([blds.index(obj) if obj is not None else -1, wp.hunt])
out['choose_obj'] = res

out['value'] = {k: ai_war.value(k) for k in UNITS}

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'G4_ai.json')
with open(path, 'w') as f:
    json.dump(out, f)
print('wrote', path)
