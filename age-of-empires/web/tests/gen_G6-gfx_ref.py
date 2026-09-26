"""Reference values for web/tests/G6-gfx.test.mjs and web/tests/G6-gfx.html (G6: gfx & sprites).

Run: SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G6-gfx_ref.py
Writes web/tests/fixtures/G6-gfx_ref.json (logic) and web/tests/fixtures/G6/*.png (drawn sprites, compared by eye / stats).
"""
import json
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402
import pygame  # noqa: E402

pygame.init()

from game import data  # noqa: E402,F401
from game import sprites3d, sprites_extra, naval_gfx, map_icons, civ_art, terrain_gfx, gfx, wallgfx  # noqa: E402
from game import terrain as tr  # noqa: E402

out = {}

# ---------------------------------------------------------------- hashes, species, directions
pts = [(x, y) for x in range(0, 230, 7) for y in range(0, 230, 11)] + [(123456, 98765), (2 ** 40, 5), (3, 2 ** 45)]
out['hash'] = [[x, y, s, sprites3d._hash(x, y, s)] for (x, y) in pts for s in (0, 1, 3, 5, 9, 11)]
out['species'] = [[x, y, sprites_extra.species(x, y)] for (x, y) in pts[:200]]
vecs = [(math.cos(a / 10.0), math.sin(a / 10.0)) for a in range(63)] + [(1, 0), (0, 1), (-1, 0), (0, -1), (0.5, 0.5),
                                                                         (-0.3, 0.9), (0, 0)]
out['face_dir'] = [[fx, fy, n, sprites3d.face_dir(fx, fy, n)] for (fx, fy) in vecs for n in (8, 16)]

# ---------------------------------------------------------------- atlas lookups
civs = ['britons', 'franks', 'teutons', 'mongols', 'byzantines', 'spanish', 'vikings', None, 'nosuch']
kinds = ['villager', 'militia', 'archer', 'knight', 'monk', 'spearman', 'scout', 'animal_sheep', 'trebuchet', 'nosuch',
         'longbowman', 'galley']
us = []
for k in kinds:
    for c in civs:
        for fem in (False, True):
            s = sprites3d.unit_set(k, c, fem)
            us.append([k, c, fem, None if s is None else [s.name, s.h, s.bh, s.ndir, s.rec['file'], s.rec.get('mask')]])
out['unit_set'] = us
brec = []
for k in ['house', 'town_center', 'castle', 'dock', 'barracks', 'wonder', 'nosuch', 'mill', 'farm']:
    for c in civs:
        r = sprites3d.building_rec(k, c)
        brec.append([k, c, None if r is None else r['file'], sprites3d.variants(k, c)])
out['building_rec'] = brec
out['civ_group'] = [[c, sprites3d.civ_group(c)] for c in civs]

# ---------------------------------------------------------------- water / maps
rnd = random.Random(5)


class FakeW:
    pass


def fake_world(W, H, seed):
    r = random.Random(seed)
    w = FakeW()
    w.W, w.H = W, H
    w.terrain = [[0] * W for _ in range(H)]
    for _ in range(6):
        cx, cy, rad = r.randint(0, W - 1), r.randint(0, H - 1), r.randint(2, 9)
        for y in range(H):
            for x in range(W):
                if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad:
                    w.terrain[y][x] = 1
    for _ in range(20):
        w.terrain[r.randint(0, H - 1)][r.randint(0, W - 1)] = r.choice((2, 3))
    w.ground = bytearray(r.randrange(len(tr.GROUNDS)) for _ in range(W * H))
    w.elev_map = bytearray(r.randint(0, 7) for _ in range(W * H))
    w.hz = [[max(0.0, r.uniform(-30, 120)) if 3 < x < W - 3 and 3 < y < H - 3 else 0.0 for x in range(W + 1)]
            for y in range(H + 1)]
    # smooth the heights a little (relief is continuous in the game)
    for _ in range(3):
        w.hz = [[(w.hz[y][x] + w.hz[max(0, y - 1)][x] + w.hz[min(H, y + 1)][x] + w.hz[y][max(0, x - 1)] +
                  w.hz[y][min(W, x + 1)]) / 5 for x in range(W + 1)] for y in range(H + 1)]
    w.relief = True
    return w


w = fake_world(40, 30, 7)
out['fake_world'] = {'W': w.W, 'H': w.H, 'terrain': w.terrain, 'ground': list(w.ground), 'elev_map': list(w.elev_map),
                     'hz': w.hz}
dist = naval_gfx.shore_dist(w)
out['shore_dist'] = dist
out['water_color'] = [[d, v, list(naval_gfx.water_color(d, v))] for d in range(0, 10) for v in (0, 5, -3)]
out['water_dist'] = map_icons._water_dist(w)
out['minimap'] = [[list(c) for c in row] for row in terrain_gfx.minimap_colors(w, naval_gfx.water_color, dist)]
out['minimap_de'] = [[list(c) for c in row] for row in terrain_gfx.minimap_colors(w, naval_gfx.water_color, dist, de=True)]

# ---------------------------------------------------------------- terrain_gfx numerics
U, V, IN = terrain_gfx._diamond()
out['diamond'] = {'U': U.ravel().tolist(), 'V': V.ravel().tolist(), 'IN': IN.astype(int).ravel().tolist()}
light = terrain_gfx._vertex_light(np.asarray(w.hz, np.float32))
out['vertex_light'] = light.ravel().tolist()
ox = w.H * data.HW
tw, th = (w.W + w.H) * data.HW, (w.W + w.H) * data.HH
rel = terrain_gfx.Relief(w, ox, tw, th)
out['relief'] = {'ox': ox, 'tw': tw, 'th': th, 'flat': rel.flat, 'shape': list(rel.D.shape),
                 'D': rel.D.ravel().tolist(), 'L': rel.L.ravel().tolist()}
fr = rel.fog_rows(tw // 8, th // 8, 8)
out['fog_rows'] = {'shape': list(fr.shape), 'data': fr.ravel().tolist()}
# apply on a deterministic gradient surface
surf = pygame.Surface((tw, th))
arr = pygame.surfarray.pixels3d(surf)
xs = np.arange(tw)[:, None]
ys = np.arange(th)[None, :]
arr[..., 0] = (xs * 7 + ys * 3) % 256
arr[..., 1] = (xs * 2 + ys * 5) % 256
arr[..., 2] = (xs ^ ys) % 256
del arr
rel.apply(surf)
a = pygame.surfarray.array3d(surf)
out['relief_apply'] = {'sum': int(a.sum()), 'rows': [a[:, y, :].ravel().tolist() for y in (0, 37, 101, th // 2, th - 1)]}

# ---------------------------------------------------------------- civ_art shield outline, crenels order
out['shield_poly'] = [list(p) for p in civ_art._shield_poly((1, 1, 46, 54))]

# ---------------------------------------------------------------- drawn sprites (browser test compares stats)
FIX = os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G6')
os.makedirs(FIX, exist_ok=True)
stats = {}


def save(name, s):
    pygame.image.save(s, os.path.join(FIX, name + '.png'))
    a = pygame.surfarray.array_alpha(s) if s.get_flags() & pygame.SRCALPHA else None
    rgb = pygame.surfarray.array3d(s)
    bb = s.get_bounding_rect()
    stats[name] = {'size': list(s.get_size()), 'bbox': [bb.x, bb.y, bb.w, bb.h],
                   'opaque': int((a >= 128).sum()) if a is not None else s.get_width() * s.get_height(),
                   'mean': [float(rgb[..., i][a >= 128].mean()) if a is not None and (a >= 128).any() else float(rgb[..., i].mean())
                            for i in range(3)]}


for kind in ['house', 'mill', 'lumber_camp', 'mining_camp', 'town_center', 'barracks', 'blacksmith', 'archery_range',
             'stable', 'tower', 'siege_workshop', 'castle']:
    s, ox_, oy_ = gfx.make_building_sprite(kind, (200, 40, 40))
    save('bld_' + kind, s)
    stats['bld_' + kind]['o'] = [ox_, oy_]
for seed in (0, 1, 2, 5):
    save('tree_%d' % seed, gfx.make_tree(seed))
save('rocks', gfx.make_rocks((150, 150, 156), 3, True))
save('bush', gfx.make_bush(4))
for kind in ['villager', 'militia', 'spearman', 'archer', 'skirmisher', 'scout', 'knight', 'ram']:
    s = pygame.Surface((60, 60), pygame.SRCALPHA)
    gfx.draw_unit(s, kind, (40, 90, 200), 30, 50, (1.0, 0.2), 0.7, 0.2, 1.4, 'wood' if kind == 'villager' else None, True)
    save('unit_' + kind, s)
for kind in ['sheep', 'deer', 'wolf', 'boar']:
    s = pygame.Surface((50, 40), pygame.SRCALPHA)
    gfx.draw_animal(s, kind, 25, 32, (-1.0, 0.0), 1.1, True, False, (255, 0, 0), 1.3)
    save('animal_' + kind, s)
s = pygame.Surface((200, 120), pygame.SRCALPHA)
gfx.draw_farm(s, 100, 10, 3, 1, 0.6)
save('farm', s)
for kind in ['fishing_ship', 'transport_ship', 'galley', 'war_galley', 'fire_ship', 'galleon', 'demolition_ship',
             'cannon_galleon', 'boat']:
    s = pygame.Surface((110, 90), pygame.SRCALPHA)
    naval_gfx.draw_ship(s, kind, (40, 90, 200), 55, 60, (0.8, 0.3), 1.0, 0.0, 1.0, 'food', True)
    save('ship_' + kind, s)
for kind, v in (('shore_fish', 0), ('deep_fish', 3)):
    save('fish_%s' % kind, naval_gfx.make_fish(kind, v))
for mask in (0, 1 | 4, 2 | 8, 1 | 2, 16 | 64, 0xff):
    for kind in ('palisade_wall', 'stone_wall'):
        s, ox_, oy_ = wallgfx.piece_sprite(kind, (40, 90, 200), mask)
        save('wall_%s_%d' % (kind, mask), s)
for kind in ('palisade_gate', 'gate'):
    if kind in data.BUILDINGS:
        for horiz in (True, False):
            for op in (False, True):
                s, ox_, oy_ = wallgfx.gate_sprite(kind, (40, 90, 200), horiz, op)
                save('gate_%s_%d%d' % (kind, horiz, op), s)
emb_specs = {k: v['emblem'] for k, v in data.CIVS.items() if isinstance(v, dict) and v.get('emblem')}
for k, spec in sorted(emb_specs.items()):
    save('emblem_' + k, civ_art.emblem(k, spec, 48, 56))
for kind in ['longbowman', 'throwing_axeman', 'teutonic_knight', 'samurai', 'chu_ko_nu', 'war_elephant', 'mameluke',
             'janissary', 'berserk', 'huskarl', 'woad_raider', 'conquistador', 'mangudai', 'cataphract']:
    if kind in data.UNITS and callable(data.UNITS[kind].get('art')):
        s = pygame.Surface((80, 80), pygame.SRCALPHA)
        gfx.draw_unit(s, kind, (200, 40, 40), 40, 70, (-1.0, 0.2), 0.3, 0.25, 1.4, None, True)
        save('civ_' + kind, s)
out['draw_stats'] = stats

with open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G6-gfx_ref.json'), 'w') as f:
    json.dump(out, f)
print('ok', len(stats), 'sprites')
