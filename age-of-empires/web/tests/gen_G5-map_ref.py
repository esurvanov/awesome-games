"""Reference fixture for web/tests/G5-map.test.mjs: runs game/mapgen.py + game/terrain.py on a minimal fake
world (the same mock the JS test uses), dumps the resulting map as JSON.
  SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G5-map_ref.py"""
import json
import os
import random
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')

from game import mapgen, terrain, relics, defense, themes, maps  # noqa: E402


class FNode:
    def __init__(self, kind, tx, ty):
        self.kind = kind
        self.tx, self.ty = tx, ty
        self.amount = self.max_amount = 100
        self.var = random.randrange(6)
        self.alive = True


class FUnit:
    def __init__(self, kind, owner, x, y, world):
        self.kind, self.owner, self.x, self.y = kind, owner, x, y


class FAnimal:
    def __init__(self, kind, x, y, world, owner=-1):
        self.kind, self.owner, self.x, self.y = kind, owner, x, y


class FBuilding:
    def __init__(self, kind, owner, tx, ty, w, h):
        self.kind, self.owner, self.tx, self.ty, self.w, self.h = kind, owner, tx, ty, w, h
        self.rally = (0, 0)


class FPlayer:
    def __init__(self, team):
        self.team = team
        self.res = {'wood': 200, 'food': 200, 'gold': 100, 'stone': 200}


class FWorld:
    def __init__(self, W, map_type, teams, theme='grass'):
        self.W = self.H = W
        self.map_type = map_type
        self.players = [FPlayer(t) for t in teams]
        self.settings = {'team_together': True, 'theme': theme}
        self.terrain = [[0] * W for _ in range(W)]
        self.occ = [[None] * W for _ in range(W)]
        self.nodes, self.units, self.animals, self.buildings, self.relics = [], [], [], [], []
        terrain.ensure(self)

    def passable(self, x, y):
        return 0 <= x < self.W and 0 <= y < self.H and not self.terrain[y][x] & 1 and self.occ[y][x] is None

    def nearest_free_tile(self, tx, ty, maxr=12):
        if self.passable(tx, ty):
            return tx, ty
        for r in range(1, maxr):
            best = None
            bd = 1e9
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    if self.passable(tx + dx, ty + dy):
                        d = dx * dx + dy * dy
                        if d < bd:
                            bd, best = d, (tx + dx, ty + dy)
            if best:
                return best
        return tx, ty

    def place_building(self, kind, pid, tx, ty, complete=False, size=None):
        s = {'town_center': 4}.get(kind, 1)
        w, h = size or (s, s)
        b = FBuilding(kind, pid, tx, ty, w, h)
        for y in range(ty, ty + h):
            for x in range(tx, tx + w):
                self.occ[y][x] = b
        self.buildings.append(b)
        return b


def f_spawn(w, tx, ty):
    if not w.passable(tx, ty) or w.occ[ty][tx] is not None:
        tx, ty = w.nearest_free_tile(tx, ty)
    w.relics.append((tx, ty))
    return (tx, ty)


mapgen.Node, mapgen.Unit, mapgen.Animal = FNode, FUnit, FAnimal
relics.spawn = f_spawn
defense.is_wall = lambda b: b.kind in ('stone_wall', 'gate')


def dump(w, g):
    return {
        'terrain': [t for r in w.terrain for t in r],
        'ground': list(w.ground),
        'elev': list(w.elev_map),
        'hz': [round(v, 6) for r in w.hz for v in r],
        'relief': w.relief,
        'cliffs': [list(c) for c in w.cliffs],
        'starts': [list(s) for s in w.starts],
        'nodes': [[n.kind, n.tx, n.ty, n.amount, n.var] for n in w.nodes],
        'units': [[u.kind, u.owner, u.x, u.y] for u in w.units],
        'animals': [[a.kind, a.owner, a.x, a.y] for a in w.animals],
        'buildings': [[b.kind, b.owner, b.tx, b.ty, b.w, b.h] for b in w.buildings],
        'relics': [list(r) for r in w.relics],
        'theme': w.theme,
        'nomad': getattr(w, 'nomad', False),
        'wood': [p.res['wood'] for p in w.players],
        'gen_opts': w.gen_opts,
        'next_random': random.random(),
    }


cases = []
for mt, W, teams, seed in [('arabia', 120, [1, 2], 1), ('arabia', 144, [1, 1, 2, 2], 7), ('arena', 120, [1, 2], 3),
                           ('black_forest', 120, [1, 1, 2, 2], 4), ('nomad', 120, [1, 2, 3], 5),
                           ('islands', 120, [1, 2], 6), ('mediterranean', 144, [1, 2, 3, 4], 8),
                           ('arabia', 120, [1, 2], 11), ('arabia', 120, [1, 2], 12), ('arabia', 120, [1, 2], 29), ('arabia', 120, [1, 2], 42)]:
    random.seed(seed)
    w = FWorld(W, mt, teams)
    g = mapgen.generate(w)
    cases.append({'mt': mt, 'W': W, 'teams': teams, 'seed': seed, 'out': dump(w, g)})

# legacy-style terrain generation (no gen_opts): coast/land heights, shallows, cliffs, ground
legacy = []
for mt, seed in [('land', 21), ('coast', 22)]:
    random.seed(seed)
    w = FWorld(96, mt, [1, 2])
    for y in range(96):
        for x in range(96):
            if (mt == 'coast' and x > 70) or (x - 30) ** 2 + (y - 60) ** 2 < 60:
                w.terrain[y][x] = 1
    starts = [(20, 20), (60, 30)]
    w.starts = starts
    for i in range(300):
        x, y = random.randrange(96), random.randrange(96)
        if w.terrain[y][x] == 0 and w.occ[y][x] is None:
            nd = FNode(random.choice(('tree', 'tree', 'gold', 'stone')), x, y)
            w.nodes.append(nd)
            w.occ[y][x] = nd
    w.gen_opts = None
    a = terrain.gen_shallows(w, starts)
    b = terrain.gen_heights(w, starts)
    c = terrain.gen_cliffs(w, starts)
    terrain.gen_ground(w, starts)
    legacy.append({'mt': mt, 'seed': seed, 'ret': [a, round(b, 9), c],
                   'terrain': [t for r in w.terrain for t in r], 'ground': list(w.ground), 'elev': list(w.elev_map),
                   'hz': [round(v, 6) for r in w.hz for v in r], 'cliffs': [list(q) for q in w.cliffs],
                   'z': [round(terrain.z_at(w, x * 7.3, y * 11.1), 6) for x in range(0, 400, 37) for y in range(0, 400, 41)],
                   'gat': [[round(v, 6) for v in terrain.ground_at(w, ix, iy, 100)] for ix in range(-300, 300, 77)
                           for iy in range(0, 1500, 133)],
                   'fz': [round(terrain.footprint_z(w, x, y, 3, 2), 6) for x in range(0, 90, 13) for y in range(0, 90, 11)],
                   'slope': [terrain.slope_ok(w, x, y, 2) for x in range(0, 90, 9) for y in range(0, 90, 9)]})
    terrain.flatten(w, 10, 10, 20, 14, 3)
    legacy[-1]['flat_hz'] = [round(v, 6) for r in w.hz for v in r]

species = [[terrain.tree_species(x, y), terrain.tree_species(x, y, ('oak', 'pine')), terrain._hash(x, y, 3)]
           for x in range(-20, 260, 7) for y in range(-10, 250, 9)]
grass = themes.THEMES['grass']
json.dump({'cases': cases, 'legacy': legacy, 'species': species,
           'grass_theme': {'species': [list(s) for s in grass['species']], 'conifer': list(grass['conifer'])},
           'maps': {k: [bool(v.get('water')), bool(v.get('nomad', False))] for k, v in maps.MAPS.items()}},
          open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G5-map_ref.json'), 'w'), separators=(',', ':'))
print('ok', len(cases))
