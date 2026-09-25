#!/usr/bin/env python3
"""Постановочный бой для снимка: две армии из новых юнитов сходятся в центре карты.

  .venv/bin/python tools/battle_shot.py --out shots/battle_staged.png --seconds 6
"""
import argparse
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import TILE  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402

ARMY_A = ['champion'] * 5 + ['halberdier'] * 4 + ['arbalester'] * 5 + ['paladin'] * 3 + ['monk'] * 2 + \
    ['onager', 'trebuchet', 'bombard_cannon', 'siege_ram']
ARMY_B = ['two_handed_swordsman'] * 4 + ['elite_skirmisher'] * 4 + ['heavy_cavalry_archer'] * 3 + \
    ['hussar'] * 3 + ['heavy_camel_rider'] * 3 + ['hand_cannoneer'] * 4 + ['heavy_scorpion', 'mangonel', 'capped_ram']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/battle_staged.png')
    ap.add_argument('--seconds', type=float, default=6)
    ap.add_argument('--seed', type=int, default=2)
    a = ap.parse_args()
    random.seed(a.seed)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    g = Game()
    g.new_game(1, 1, False)
    w = g.world
    w.ais = []
    w.units = [u for u in w.units if u.kind == 'villager']
    cx, cy = w.W // 2, w.H // 2
    for y in range(cy - 10, cy + 10):
        for x in range(cx - 10, cx + 10):
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]
    for owner, army, side in ((0, ARMY_A, -1), (1, ARMY_B, 1)):
        for i, k in enumerate(army):
            row, col = divmod(i, 6)
            x = (cx + side * (2.5 + row * 1.1)) * TILE
            y = (cy - 3 + col * 1.1) * TILE
            u = Unit(k, owner, x, y, w)
            if u.d.get('pack'):
                u.packed = False
            w.units.append(u)
    for p in w.players:
        p.age = 3
    t = 0.0
    while t < a.seconds:
        w.update(0.034)
        w.events.clear()
        t += 0.034
    w.vis = bytearray(b'\x01' * (w.W * w.H))
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    w.fog_version += 1
    g.center_on(cx * TILE, cy * TILE)
    g.selected = [u for u in w.units if u.owner == 0 and u.kind == 'monk'][:1]
    g.draw()
    pygame.image.save(g.screen, a.out)
    print('сохранено', a.out)


if __name__ == '__main__':
    main()
