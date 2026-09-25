#!/usr/bin/env python3
"""A windowless match simulation: AI vs AI (or against a passive player 0).

Examples:
  .venv/bin/python tools/sim.py --players 2 --minutes 45 --seed 1
  .venv/bin/python tools/sim.py --players 4 --mode teams --minutes 30 --seed 3
  .venv/bin/python tools/sim.py --players 3 --mode passive --minutes 20
  .venv/bin/python tools/sim.py --players 2 --map coast --minutes 45 --seed 2     # a water map
  .venv/bin/python tools/sim.py --players 2 --civs franks,mongols                 # civilizations (random - a random one)

Modes:
  ai      - all players under the AI, everyone for themselves
  teams   - all under the AI, two teams: players 0,1 against the rest (for 4 - 2x2)
  vs      - all under the AI, player 0 alone against a team of the rest (like the "everyone against you" menu)
  passive - player 0 does nothing, the rest are the AI on one team
Exit with a nonzero code if the simulation crashed.
"""
import argparse
import os
import random
import sys
import time
import traceback

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import AGE_NAMES  # noqa: E402
from game.world import World  # noqa: E402
from game.ai import AI  # noqa: E402
from game.naval import MAP_TYPES  # noqa: E402

DT = 0.034          # the simulation step, game seconds (as in the interface)


def make_world(n, mode, diff, map_type='land', civs=None):
    if mode == 'teams':
        half = max(1, n // 2)
        teams = [0 if i < half else 1 for i in range(n)]
    elif mode in ('vs', 'passive'):
        teams = [0] + [1] * (n - 1)
    else:
        teams = list(range(n))
    ai_players = range(1, n) if mode == 'passive' else range(n)
    # the difficulty bonus - only to the "opponents" (as in a regular game)
    civs = (list(civs) + ['random'] * n)[:n] if civs else ['random'] * n
    w = World(diff, n, teams, ai_players=range(1, n), map_type=map_type, civs=civs)
    w.ais = [AI(w, pid, diff) for pid in ai_players]
    return w


def summary(w, detail=False):
    lines = []
    for p in w.players:
        units = [u for u in w.units if u.owner == p.id]
        vils = sum(1 for u in units if u.kind == 'villager')
        blds = sum(1 for b in w.buildings if b.owner == p.id)
        kinds = {}
        for u in units:
            if u.kind != 'villager':
                kinds[u.kind] = kinds.get(u.kind, 0) + 1
        army = ' '.join(f'{k}:{v}' for k, v in sorted(kinds.items()))
        res = ' '.join(f'{k[0]}{int(v)}' for k, v in p.res.items())
        st = '' if p.alive else ' [defeated]'
        lines.append(f'  P{p.id} t{p.team} {p.civ[:10]:10s} {AGE_NAMES[p.age][:12]:12s} vil {vils:3d} army {len(units) - vils:3d} tech {len(p.techs):2d} '
                     f'bld {blds:3d} kills {p.kills:4d} pop {p.pop}/{p.cap} [{res}] {army}{st}')
        if detail:
            bk = {}
            for b in w.buildings:
                if b.owner == p.id and b.kind not in ('house', 'farm'):
                    bk[b.kind] = bk.get(b.kind, 0) + 1
            lines.append('      buildings: ' + ' '.join(f'{k}:{v}' for k, v in sorted(bk.items())))
            lines.append('      techs: ' + ' '.join(sorted(p.techs)))
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--minutes', type=float, default=45)
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--mode', choices=('ai', 'teams', 'vs', 'passive'), default='ai')
    ap.add_argument('--diff', type=int, default=1, choices=(0, 1, 2))
    ap.add_argument('--map', default='land', choices=MAP_TYPES, help='map type')
    ap.add_argument('--every', type=float, default=5, help='summary interval, game minutes (0 - only the result)')
    ap.add_argument('--civs', default='random', help='civilizations separated by commas (random - a random one)')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--detail', action='store_true', help='in the end - buildings and researched techs')
    a = ap.parse_args()
    random.seed(a.seed)
    t0 = time.time()
    try:
        w = make_world(a.players, a.mode, a.diff, a.map, a.civs.split(','))
        print(f'seed {a.seed}, {a.players} players, mode {a.mode}, map {a.map} {w.W}×{w.H}, starts {w.starts}')
        end = a.minutes * 60
        nxt = a.every * 60 if a.every > 0 else end + 1
        events = {}
        trained = {}
        while w.time < end and w.winner is None:
            w.update(DT)
            for ev in w.events:
                events[ev[0]] = events.get(ev[0], 0) + 1
                if ev[0] == 'train_done' and ev[4] != 'villager':
                    trained[ev[4]] = trained.get(ev[4], 0) + 1
            w.events.clear()
            if w.time >= nxt:
                nxt += a.every * 60
                if not a.quiet:
                    print(f'[{int(w.time // 60):3d} min, {time.time() - t0:5.1f} s]')
                    print(summary(w))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
    print(f'=== result: {w.time / 60:.1f} game min in {time.time() - t0:.1f} s, '
          f'winner: {"no" if w.winner is None else "team " + str(w.winner)}')
    print(summary(w, a.detail))
    if a.detail:
        print('  trained by all (except villagers):', ' '.join(f'{k}:{v}' for k, v in sorted(trained.items())))
    print('  events:', ' '.join(f'{k}:{v}' for k, v in sorted(events.items())))


if __name__ == '__main__':
    main()
