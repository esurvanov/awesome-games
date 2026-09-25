#!/usr/bin/env python3
"""Обзор всей карты «как миникарта» (docs/research/07_maps.md): земля по типам и высоте, лес, ресурсы,
животные, ЦГ — ромбом, как миникарта AoE2. Для сравнения с превью карт DE.

  .venv/bin/python tools/research/map_overview.py --out shots/research_maps
  → ours_<тип>_s<сид>.png, contact.png (все), blind/*.png (под случайными именами) + blind/key.json
Игра не меняется: только World(...) и те же цвета, что у миникарты (terrain_gfx.minimap_colors).
"""
import argparse
import json
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import pygame  # noqa: E402

from game.data import TILE, NODE_DEFS, PLAYER_COLORS  # noqa: E402
from game.world import World  # noqa: E402
from game import terrain_gfx, naval_gfx  # noqa: E402

try:
    from game import themes as _th  # noqa: E402
    GOLD, STONE, FOOD, RELIC, WOLF = _th.MM_GOLD, _th.MM_STONE, _th.MM_FOOD, _th.MM_RELIC, _th.MM_WOLF
except (ImportError, AttributeError):
    GOLD, STONE, FOOD, RELIC, WOLF = (255, 199, 0), (145, 145, 145), (165, 196, 108), (255, 255, 255), (210, 206, 196)
NODE_C = {'gold': GOLD, 'stone': STONE, 'berries': FOOD, 'shore_fish': FOOD, 'deep_fish': FOOD}
MAPS6 = ('arabia', 'arena', 'black_forest', 'nomad', 'islands', 'mediterranean')


def forest_color(w):
    try:
        return _th.forest_mm(w)
    except Exception:
        return (21, 118, 21)


def overview(w, px=400):
    W, H = w.W, w.H
    small = pygame.Surface((W, H), pygame.SRCALPHA)
    depth = naval_gfx.shore_dist(w)
    for y, row in enumerate(terrain_gfx.minimap_colors(w, naval_gfx.water_color, depth, de=True)):
        for x, c in enumerate(row):
            small.set_at((x, y), c)
    fc = forest_color(w)
    for n in w.nodes:
        c = fc if n.kind == 'tree' else NODE_C.get(n.kind) or NODE_DEFS[n.kind].get('mm', (255, 255, 255))
        small.set_at((n.tx, n.ty), c)
    for a in w.animals:
        c = PLAYER_COLORS[a.owner] if a.owner >= 0 else WOLF if a.kind == 'wolf' else FOOD
        small.set_at((int(a.x // TILE), int(a.y // TILE)), c)
    for r in getattr(w, 'relics', ()) or ():
        if getattr(r, 'free', True):
            small.fill(RELIC, (r.tx, r.ty, 1, 1))
    for b in w.buildings:
        small.fill(PLAYER_COLORS[b.owner], (b.tx, b.ty, b.w, b.h))
    for u in w.units:
        small.set_at((int(u.x // TILE), int(u.y // TILE)), PLAYER_COLORS[u.owner])
    sq = pygame.transform.scale(small, (W * 4, H * 4))
    rot = pygame.transform.rotate(sq, -45)
    out = pygame.Surface((px, px // 2))
    out.fill((0, 0, 0))
    rot = rot.convert_alpha()
    out.blit(pygame.transform.smoothscale(rot, (px, px // 2)), (0, 0))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/research_maps')
    ap.add_argument('--seeds', type=int, default=5)
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--types', default=','.join(MAPS6))
    ap.add_argument('--blind-seed', type=int, default=777)
    a = ap.parse_args()
    pygame.init()
    pygame.display.set_mode((1, 1))
    os.makedirs(os.path.join(a.out, 'blind'), exist_ok=True)
    types = tuple(a.types.split(','))
    imgs = []
    for mt in types:
        for s in range(1, a.seeds + 1):
            random.seed(s)
            w = World(1, a.players, map_type=mt)
            print(mt, s, 'пейзаж', getattr(w, 'theme', '-'))
            img = overview(w)
            p = os.path.join(a.out, f'ours_{mt}_s{s}.png')
            pygame.image.save(img, p)
            imgs.append((mt, s, img))
            print('сохранено', p)
    # общий лист
    font = pygame.font.SysFont(None, 22)
    cw, ch = 400, 220
    sheet = pygame.Surface((cw * a.seeds, ch * len(types)))
    sheet.fill((20, 20, 20))
    for i, (mt, s, img) in enumerate(imgs):
        x, y = (i % a.seeds) * cw, (i // a.seeds) * ch
        sheet.blit(img, (x, y + 20))
        sheet.blit(font.render(f'{mt} · seed {s}', True, (230, 230, 230)), (x + 6, y + 2))
    pygame.image.save(sheet, os.path.join(a.out, 'contact.png'))
    # слепой набор
    rnd = random.Random(a.blind_seed)
    order = list(range(len(imgs)))
    rnd.shuffle(order)
    key = {}
    for k, i in enumerate(order):
        name = f'map_{k:02d}.png'
        pygame.image.save(imgs[i][2], os.path.join(a.out, 'blind', name))
        key[name] = f'{imgs[i][0]}_s{imgs[i][1]}'
    with open(os.path.join(a.out, 'blind', 'key.json'), 'w') as f:
        json.dump(key, f, indent=1)
    print('сохранено', os.path.join(a.out, 'contact.png'))


if __name__ == '__main__':
    main()
