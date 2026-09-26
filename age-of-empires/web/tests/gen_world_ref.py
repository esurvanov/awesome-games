"""Reference values from the Python game/world.py for web/tests/test_world.mjs.
Run: SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_world_ref.py  -> web/tests/fixtures/world_ref.json"""
import json
import os
import random
import sys
from types import SimpleNamespace

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
os.environ.setdefault('KHRONIKI_LANG', 'en')

from game import world as W  # noqa: E402
from game.data import TILE, CIVS, UNITS, BUILDINGS, TECHS  # noqa: E402

out = {}


def bare_world(w, h, seed, wall_p=0.25, gates=True):
    r = random.Random(seed)
    wd = object.__new__(W.World)
    wd.W, wd.H = w, h
    wd.terrain = [[(1 if r.random() < wall_p else (2 if r.random() < 0.1 else 0)) for _ in range(w)] for _ in range(h)]
    wd.occ = [[None] * w for _ in range(h)]
    wd.gate = [[None] * w for _ in range(h)]
    wd.floor = [[None] * w for _ in range(h)]
    blocks, gl = [], []
    for _ in range(w * h // 12):
        x, y = r.randrange(w), r.randrange(h)
        if wd.terrain[y][x] == 0 and wd.occ[y][x] is None:
            if gates and r.random() < 0.3:
                g = SimpleNamespace(progress=1.0 if r.random() < 0.8 else 0.5, owner=r.randrange(3))
                wd.occ[y][x] = g
                wd.gate[y][x] = g
                gl.append([x, y, g.progress, g.owner])
            else:
                wd.occ[y][x] = SimpleNamespace()
                blocks.append([x, y])
    wd.players = [SimpleNamespace(team=t) for t in (0, 1, 0)]
    wd.time = 0.0
    wd.treaty_end = 0.0
    wd.update_teams()
    return wd, {'W': w, 'H': h, 'terrain': wd.terrain, 'blocks': blocks, 'gates': gl, 'teams': [0, 1, 0]}


# ---- A. pathfinding / nearest_free_tile
cases = []
for seed in range(6):
    wd, desc = bare_world(36, 30, seed)
    r = random.Random(1000 + seed)
    qs = []
    for _ in range(25):
        sx, sy = r.randrange(wd.W), r.randrange(wd.H)
        gx, gy = r.randrange(wd.W), r.randrange(wd.H)
        owner = r.choice([None, 0, 1])
        limit = r.choice([1800, 1800, 200])
        goals = [(gx, gy)] if r.random() < 0.6 else [(gx + dx, gy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
        path = wd.find_path((sx, sy), goals, gx, gy, limit=limit, owner=owner)
        qs.append({'start': [sx, sy], 'goals': [list(g) for g in goals], 'h': [gx, gy], 'owner': owner,
                   'limit': limit, 'path': [list(p) for p in path], 'reached': wd.path_reached})
    nft = []
    for _ in range(20):
        x, y = r.randrange(-2, wd.W + 2), r.randrange(-2, wd.H + 2)
        mr = r.choice([12, 3])
        nft.append([x, y, mr, list(wd.nearest_free_tile(x, y, mr))])
    pf = [[x, y, o, wd.passable_for(x, y, o)] for x in range(-1, wd.W + 1, 3) for y in range(-1, wd.H + 1, 2) for o in (0, 1, -1)]
    cases.append({'world': desc, 'queries': qs, 'nft': nft, 'passable_for': pf,
                  'hmat': wd.hmat, 'amat': wd.amat, 'beast_row': wd.beast_row})
out['paths'] = cases


# ---- B. separate
def sep_case(seed):
    wd, desc = bare_world(30, 24, seed + 50, wall_p=0.08, gates=False)
    r = random.Random(seed)
    units, udesc = [], []
    for i in range(70):
        u = object.__new__(W.Unit)
        if i % 9 == 0 and units:
            o = units[-1]
            u.x, u.y = o.x, o.y       # coincident -> the random push
        else:
            u.x, u.y = r.uniform(3 * TILE, 12 * TILE), r.uniform(3 * TILE, 10 * TILE)
        u.radius = r.choice([8, 10, 12, 14])
        u.owner = r.randrange(3)
        u.state = r.choice(['idle', 'move', 'gather', 'build'])
        u.path = [] if r.random() < 0.7 else [(1, 1)]
        if r.random() < 0.1:
            u.packed = False
        units.append(u)
        udesc.append({'x': u.x, 'y': u.y, 'radius': u.radius, 'owner': u.owner, 'state': u.state,
                      'path': [list(p) for p in u.path], 'packed': u.packed})
    wd.units = units
    wd.animals = []
    wd._sep_grid = None
    wd._sep_moved = None
    wd._sep_pass = 0
    random.seed(seed + 7)
    steps = []
    for k in range(6):
        wd.separate()
        steps.append([[u.x, u.y, u._sep_clear] for u in units])
        if k == 2:
            units[3].x += 5.0           # one moves - the calm bookkeeping must be the same
    return {'world': desc, 'units': udesc, 'seed': seed + 7, 'steps': steps}


out['separate'] = [sep_case(s) for s in range(3)]


# ---- C. update_fog
def fog_case(seed):
    wd, desc = bare_world(40, 32, seed + 90, wall_p=0.0, gates=False)
    r = random.Random(seed)
    wd.human = 0
    wd.explored = bytearray(wd.W * wd.H)
    wd.vis = bytearray(wd.W * wd.H)
    wd._fog_srcs = None
    wd.fog_version = 0
    wd.reveal = 'normal'
    us, bs, an = [], [], []
    for _ in range(12):
        los = r.randint(2, 9)
        u = SimpleNamespace(x=r.uniform(0, wd.W * TILE), y=r.uniform(0, wd.H * TILE), owner=r.randrange(3), los=(lambda v=los: v + 0.4))
        u.L = los + 0.4
        us.append(u)
    for _ in range(8):
        los = r.randint(3, 8)
        b = SimpleNamespace(tx=r.randrange(wd.W - 3), ty=r.randrange(wd.H - 3), w=r.choice([1, 2, 3, 4]), h=r.choice([1, 2, 3]),
                            owner=r.randrange(3), seen=False, los=(lambda v=los: v))
        b.L = los
        bs.append(b)
    for _ in range(4):
        los = r.randint(2, 4)
        a = SimpleNamespace(x=r.uniform(0, wd.W * TILE), y=r.uniform(0, wd.H * TILE), owner=r.choice([0, -1]), dead=r.random() < 0.3,
                            los=(lambda v=los: v))
        a.L = los
        an.append(a)
    wd.units, wd.buildings, wd.animals = us, bs, an
    udesc = [{'x': u.x, 'y': u.y, 'owner': u.owner, 'los': u.L} for u in us]
    wd.update_fog()
    v1, e1, s1 = list(wd.vis), list(wd.explored), [b.seen for b in bs]
    for u in us:
        u.x = (u.x + 300) % (wd.W * TILE)
    wd.update_fog()
    return {'world': desc,
            'units': udesc,
            'moved_x': [u.x for u in us],
            'buildings': [{'tx': b.tx, 'ty': b.ty, 'w': b.w, 'h': b.h, 'owner': b.owner, 'los': b.L} for b in bs],
            'animals': [{'x': a.x, 'y': a.y, 'owner': a.owner, 'dead': a.dead, 'los': a.L} for a in an],
            'vis1': v1, 'exp1': e1, 'seen1': s1,
            'vis2': list(wd.vis), 'exp2': list(wd.explored), 'seen2': [b.seen for b in bs], 'fog_version': wd.fog_version}


out['fog'] = [fog_case(s) for s in range(3)]

# ---- D. civ bans, player stats
civ = {}
for name in CIVS:
    b = W.civ_bans(name)
    bf = W.civ_bans(name, full=True)
    key = lambda x: json.dumps(x if isinstance(x, str) else list(x), separators=(',', ':'))  # noqa: E731
    civ[name] = {'bans': sorted(key(x) for x in b), 'full': sorted(key(x) for x in bf)}
out['civ_bans'] = civ

stats = {}
for name in CIVS:
    random.seed(1)
    p = W.Player(1, civ=name, is_ai=True)
    p.add_effects([{'stat': 'gather', 'mul': 1.3}])
    stats[name] = {
        'civ': p.civ, 'res': dict(p.res), 'name': p.name,
        'cost': {cat + ':' + k: p.cost_of(cat, k) for cat, tab in (('unit', UNITS), ('bld', BUILDINGS), ('tech', TECHS))
                 for k in tab if 'cost' in tab[k] and (cat != 'unit' or 'cls' in tab[k])},
        'time': {cat + ':' + k: p.time_of(cat, k) for cat, tab in (('unit', UNITS), ('bld', BUILDINGS), ('tech', TECHS))
                 for k in tab if 'time' in tab[k] and (cat != 'unit' or 'cls' in tab[k])},
        'hp': {k: p.stat('hp', k, d['hp']) for k, d in UNITS.items() if 'hp' in d},
        'atk': {k: p.stat('atk', k, d.get('atk', 0)) for k, d in UNITS.items()},
        'gather': {r + ':' + s: p.stat('gather', 'villager', 1.0, r, s) for r in ('food', 'wood', 'gold', 'stone')
                   for s in ('farm', 'tree', 'hunt', 'berries', 'gold', 'stone', 'fish')},
        'tags': {k: list(W.unit_tags(k)) for k in list(UNITS) + list(BUILDINGS)},
    }
out['player'] = stats


def dump_world(w, full=False):
    return {
        'W': w.W, 'H': w.H,
        'terrain': [v for row in w.terrain for v in row] if full else None,
        'starts': [list(s) for s in w.starts],
        'nodes': [[n.kind, n.tx, n.ty, n.var, n.amount] for n in w.nodes],
        'units': [[u.kind, u.owner, u.x, u.y, u.state, u.hp] for u in w.units],
        'animals': [[a.kind, a.owner, a.x, a.y, a.state, a.hp, a.dead] for a in w.animals],
        'buildings': [[b.kind, b.owner, b.tx, b.ty, b.w, b.h, b.hp, b.progress] for b in w.buildings],
        'players': [{'civ': p.civ, 'res': dict(p.res), 'pop': p.pop, 'cap': p.cap, 'age': p.age, 'team': p.team,
                     'gathered': dict(p.gathered)} for p in w.players],
        'explored': sum(w.explored), 'vis': sum(w.vis),
        'rand': random.random(),
    }


def world_case(seed, **kw):
    random.seed(seed)
    w = W.World(**kw)
    d0 = dump_world(w, True)
    # a few orders so that villagers gather/build, soldiers fight, animals wander
    rs = random.Random(seed)
    for p in w.players:
        vils = [u for u in w.units if u.owner == p.id and u.kind == 'villager']
        trees = [n for n in w.nodes if n.kind == 'tree']
        for i, v in enumerate(vils):
            if i == 0 and trees:
                v.cmd_gather(min(trees, key=lambda n: abs(n.tx * TILE - v.x) + abs(n.ty * TILE - v.y)))
            elif i == 1:
                sheep = [a for a in w.animals if a.kind == 'sheep' and a.owner == p.id]
                if sheep:
                    v.cmd_gather(sheep[0])
        tc = next(b for b in w.buildings if b.owner == p.id and b.kind == 'town_center')
        tc.queue.append(('unit', 'villager'))
    scouts = [u for u in w.units if u.kind == 'scout']
    if len(scouts) >= 2:
        scouts[0].cmd_move(scouts[1].x, scouts[1].y)
    snaps = []
    for step in range(2000):
        w.update(0.05)
        if step % 400 == 399:
            snaps.append(dump_world(w))
    return {'seed': seed, 'kw': kw, 'init': d0, 'snaps': snaps, 'events_tail': [[x if isinstance(x, (str, int, float, bool)) or x is None else str(x) for x in e] for e in w.events[-30:]]}


out['worlds'] = [world_case(3, nplayers=2, map_type='land', civs=['britons', 'franks']),
                 world_case(11, nplayers=3, map_type='land', teams=[0, 1, 1]),
                 world_case(5, nplayers=2, map_type='coast', civs=['vikings', 'mongols'])]

path = os.path.join(os.path.dirname(__file__), 'fixtures', 'world_ref.json')
with open(path, 'w') as f:
    json.dump(out, f)
print('wrote', path)
