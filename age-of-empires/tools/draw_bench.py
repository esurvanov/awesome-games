#!/usr/bin/env python3
"""A windowless drawing measurement: the frame time of Game.draw() on a busy scene (~200 units in the frame).

Examples:
  .venv/bin/python tools/draw_bench.py                     # 3 players, 15 game minutes, 200 units in the frame
  .venv/bin/python tools/draw_bench.py --units 300 --frames 300
  .venv/bin/python tools/draw_bench.py --profile           # + cProfile of the drawing (top functions)
The scene: the AI plays for everyone for N minutes, then units of different players land at your center
(they fight - there are projectiles, health bars, corpses), no fog. Every frame - a world step + draw().
"""
import argparse
import cProfile
import os
import pstats
import random
import sys
import time

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402

KINDS = ['militia', 'archer', 'spearman', 'scout', 'knight', 'crossbowman', 'skirmisher', 'villager', 'monk',
         'mangonel', 'cavalry_archer', 'long_swordsman']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=3)
    ap.add_argument('--players', type=int, default=3)
    ap.add_argument('--minutes', type=float, default=15)
    ap.add_argument('--units', type=int, default=200, help='how many units should be in the frame')
    ap.add_argument('--frames', type=int, default=200)
    ap.add_argument('--maptype', default='land')
    ap.add_argument('--profile', action='store_true')
    ap.add_argument('--zoom', type=float, default=1.0, help='world scale (the mouse wheel), 0.6-1.6')
    a = ap.parse_args()
    random.seed(a.seed)
    g = Game()
    g.new_game(1, a.players - 1, False, ai_human=True, map_type=a.maptype)
    w = g.world
    while w.time < a.minutes * 60 and w.winner is None:
        w.update(0.034)
        w.events.clear()
    tc = next((b for b in w.buildings if b.owner == 0 and b.kind == 'town_center'), None)
    cx, cy = tc.center() if tc else (w.starts[0][0] * TILE, w.starts[0][1] * TILE)
    g.zoom = g.zoom_to = a.zoom
    g.center_on(cx, cy)
    # no fog - everything is visible
    w.explored[:] = b'\x01' * len(w.explored)
    w.amat[0] = [True] * len(w.amat[0])
    for b in w.buildings:
        b.seen = True

    def in_view():
        return [u for u in w.units if g.on_screen(u)] if hasattr(g, 'on_screen') else w.units

    kinds = [k for k in KINDS if k in __import__('game.data', fromlist=['UNITS']).UNITS]
    rnd = random.Random(1)
    tries = 0
    while len(in_view()) < a.units and tries < 5000:
        tries += 1
        x = cx + rnd.uniform(-9, 9) * TILE
        y = cy + rnd.uniform(-9, 9) * TILE
        if not w.passable_px(x, y):
            continue
        owner = rnd.randrange(len(w.players))
        u = Unit(rnd.choice(kinds), owner, x, y, w)
        w.units.append(u)
    w.recount()
    print(f'units in the frame: {len(in_view())}, total {len(w.units)}, buildings {len(w.buildings)}')
    # warm-up (sprites, caches)
    for _ in range(10):
        w.update(0.034)
        g.events = w.events[:]
        w.events.clear()
        g.draw()
    times = []
    prof = cProfile.Profile() if a.profile else None
    for _ in range(a.frames):
        w.update(0.034)
        w.vis[:] = b'\x01' * len(w.vis)
        g.events = w.events[:]
        w.events.clear()
        t0 = time.perf_counter()
        if prof:
            prof.enable()
        g.draw()
        if prof:
            prof.disable()
        times.append(time.perf_counter() - t0)
    times.sort()
    n = len(times)
    print(f'scale x{g.zoom}: draw() frame: mean {1000 * sum(times) / n:.2f} ms, median {1000 * times[n // 2]:.2f} ms, '
          f'95% {1000 * times[int(n * 0.95)]:.2f} ms, units in the frame {len(in_view())}')
    if prof:
        pstats.Stats(prof).strip_dirs().sort_stats('tottime').print_stats(25)


if __name__ == '__main__':
    main()
