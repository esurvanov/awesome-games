#!/usr/bin/env python3
"""Windowless screenshots: the menu and the game (optionally after N minutes where the AI plays for you too).

Examples:
  .venv/bin/python tools/shot.py --out shots                       # the menu + the start of 2 players
  .venv/bin/python tools/shot.py --players 4 --out shots/p4        # the start of 4 players
  .venv/bin/python tools/shot.py --players 3 --ally --minutes 20 --out shots/mid
Files: menu.png, game.png (the camera at your center), battle.png (where the most fighters are),
starts.png (a grid of the starts of all players, if --starts), map.png (the whole map reduced, if --map).
"""
import argparse
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import TILE, SCREEN_W, VIEW_H, TOP_H  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402
from game.naval import MAP_TYPES  # noqa: E402


def battle_spot(w):
    """The point with the most hostile units nearby (or None)."""
    best, bn = None, 0
    units = [u for u in w.units if u.cls != 'vil']
    for u in units[::max(1, len(units) // 60)]:
        n = sum(1 for o in units if w.hostile(u.owner, o.owner) and abs(o.x - u.x) + abs(o.y - u.y) < 8 * TILE)
        if n > bn:
            bn, best = n, (u.x, u.y)
    return best


def snap(g, path, select=None):
    g.selected = select or []
    g.draw()
    pygame.image.save(g.screen, path)
    print('saved', path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--players', type=int, default=2, help='total players, 2-4')
    ap.add_argument('--ally', action='store_true', help='player 1 is your ally (with 3-4 players)')
    ap.add_argument('--diff', type=int, default=1, choices=(0, 1, 2))
    ap.add_argument('--minutes', type=float, default=0, help='how many game minutes to play (the AI plays for you too)')
    ap.add_argument('--starts', action='store_true', help='a screenshot of each player\'s start')
    ap.add_argument('--map', action='store_true', help='a screenshot of the whole map without fog')
    ap.add_argument('--maptype', default='arabia', choices=MAP_TYPES, help='the map (game/maps.py)')
    ap.add_argument('--water', action='store_true', help='a screenshot by the sea nearest to you (water.png)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(a.seed)
    g = Game()
    g.menu_cfg.update(opp=a.players - 1, ally=a.ally, diff=a.diff, map=a.maptype)
    g.draw_menu()
    pygame.image.save(g.screen, os.path.join(a.out, 'menu.png'))
    print('saved', os.path.join(a.out, 'menu.png'))
    g.new_game(a.diff, a.players - 1, a.ally, ai_human=a.minutes > 0, map_type=a.maptype)
    w = g.world
    while w.time < a.minutes * 60 and w.winner is None:
        w.update(0.034)
        w.events.clear()
    w.update_fog()
    tc = next((b for b in w.buildings if b.owner == 0 and b.kind == 'town_center'), None)
    if tc is not None:
        g.center_on(*tc.center())
    else:
        g.center_on(w.starts[0][0] * TILE, w.starts[0][1] * TILE)
    vil = next((u for u in w.units if u.owner == 0 and u.kind == 'villager'), None)
    snap(g, os.path.join(a.out, 'game.png'), [vil] if vil else [])
    spot = battle_spot(w)
    if spot:
        g.center_on(*spot)
        army = [u for u in w.units if u.owner == 0 and isinstance(u, Unit) and u.cls != 'vil'][:20]
        snap(g, os.path.join(a.out, 'battle.png'), army)
    if a.starts or a.map:
        # no fog: everything is visible
        w.vis = bytearray(b'\x01' * (w.W * w.H))
        w.explored = bytearray(b'\x01' * (w.W * w.H))
        for b in w.buildings:
            b.seen = True
        w.fog_version += 1
        w.amat[0] = [True] * len(w.amat[0])    # so that all units are drawn
    if a.water:
        w.vis = bytearray(b'\x01' * (w.W * w.H))
        w.explored = bytearray(b'\x01' * (w.W * w.H))
        for b in w.buildings:
            b.seen = True
        w.fog_version += 1
        w.amat[0] = [True] * len(w.amat[0])
        # a frame on the water where there are the most ships (or the water nearest to you)
        ships = [u for u in w.units if u.naval]
        if ships:
            s = max(ships, key=lambda s: sum(1 for o in ships if abs(o.x - s.x) + abs(o.y - s.y) < 8 * TILE))
            g.center_on(s.x, s.y)
            sel = [o for o in ships if o.owner == 0][:6]
        else:
            sx, sy = w.starts[0]
            water = [(abs(x - sx) + abs(y - sy), x, y) for y in range(w.H) for x in range(w.W) if w.terrain[y][x] == 1]
            if water:
                _, x, y = min(water)
                g.center_on(x * TILE, y * TILE)
            sel = []
        snap(g, os.path.join(a.out, 'water.png'), sel)
    if a.starts:
        tiles = []
        for pid, (sx, sy) in enumerate(w.starts):
            g.center_on(sx * TILE, sy * TILE)
            g.draw()
            tiles.append(g.screen.subsurface((0, TOP_H, SCREEN_W, VIEW_H)).copy())
        cols = 2
        rows = (len(tiles) + 1) // 2
        sheet = pygame.Surface((SCREEN_W // 2 * cols, VIEW_H // 2 * rows))
        for i, t in enumerate(tiles):
            sheet.blit(pygame.transform.smoothscale(t, (SCREEN_W // 2, VIEW_H // 2)),
                       ((i % cols) * SCREEN_W // 2, (i // cols) * VIEW_H // 2))
        pygame.image.save(sheet, os.path.join(a.out, 'starts.png'))
        print('saved', os.path.join(a.out, 'starts.png'))
    if a.map:
        g.mm_img = None
        g.draw_minimap()
        r = g.mm_rect()
        img = pygame.transform.smoothscale(g.screen.subsurface(r.inflate(12, 12)).copy(), (r.w * 3, r.h * 3))
        pygame.image.save(img, os.path.join(a.out, 'map.png'))
        print('saved', os.path.join(a.out, 'map.png'))
    pygame.quit()


if __name__ == '__main__':
    main()
