#!/usr/bin/env python3
"""Civilization balance: AI vs AI, all pairs (each pair - at both starting positions), in parallel.

  .venv/bin/python tools/civ_balance.py --minutes 45 --jobs 7
  .venv/bin/python tools/civ_balance.py --civs franks,britons,mongols --seeds 3

Victory - crushing the opponent; if nobody was crushed in the allotted time - by score
(kills + gathered/100 + buildings x2 + techs x3 + age x20). The result is a table of wins by civilization.
"""
import argparse
import itertools
import os
import random
import sys
import time
from multiprocessing import Pool

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

DT = 0.034


def score(w, p):
    blds = sum(1 for b in w.buildings if b.owner == p.id and b.kind not in ('house', 'farm'))
    return p.kills + sum(p.gathered.values()) / 100 + blds * 2 + len(p.techs) * 3 + p.age * 20


def game(args):
    a, b, seed, minutes = args
    from game.world import World
    from game.ai import AI
    random.seed(seed)
    w = World(1, 2, [0, 1], ai_players=[0, 1], civs=[a, b])
    w.ais = [AI(w, 0, 1), AI(w, 1, 1)]
    t0 = time.time()
    try:
        while w.time < minutes * 60 and w.winner is None:
            w.update(DT)
            w.events.clear()
    except Exception as e:      # noqa: BLE001 - we count a crash separately
        import traceback
        return a, b, seed, 'error', repr(e) + '\n' + traceback.format_exc(), 0, 0, time.time() - t0, {}
    uu = {}
    for u in w.units:
        if UNIQUE_KIND(u.kind):
            uu[u.kind] = uu.get(u.kind, 0) + 1
    if w.winner is not None:
        win = a if w.winner == 0 else b
        how = 'crush'
    else:
        sa, sb = score(w, w.players[0]), score(w, w.players[1])
        win = a if sa >= sb else b
        how = 'score'
    return (a, b, seed, win, how, score(w, w.players[0]), score(w, w.players[1]), time.time() - t0,
            {'techs': sorted(t for p in w.players for t in p.techs if _civ_tech(t)), 'uu': uu})


def UNIQUE_KIND(kind):
    from game.data import UNITS
    return bool(UNITS[kind].get('civ'))


def _civ_tech(t):
    from game.data import TECHS
    return bool(TECHS[t].get('civ'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--minutes', type=float, default=45)
    ap.add_argument('--jobs', type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument('--civs', default='', help='comma-separated (all by default)')
    ap.add_argument('--seeds', type=int, default=1, help='matches per pair and side')
    a = ap.parse_args()
    from game.data import CIVS
    civs = a.civs.split(',') if a.civs else [k for k in CIVS if k != 'default']
    tasks = []
    for i, (x, y) in enumerate(itertools.combinations(civs, 2)):
        for s in range(a.seeds):
            tasks.append((x, y, 1000 + i * 10 + s, a.minutes))
            tasks.append((y, x, 1000 + i * 10 + s, a.minutes))
    print(f'{len(tasks)} matches of {a.minutes:g} min, {a.jobs} processes')
    t0 = time.time()
    stats = {c: {'g': 0, 'w': 0, 'rout': 0, 'lost_rout': 0, 'uu': 0} for c in civs}
    errors = []
    uts = {}
    with Pool(a.jobs) as pool:
        for n, r in enumerate(pool.imap_unordered(game, tasks), 1):
            x, y, seed, win, how, sa, sb, dt, extra = r
            if win == 'error':
                errors.append(r)
                print('ERROR', r[:3], r[4])
                continue
            for c in (x, y):
                stats[c]['g'] += 1
            stats[win]['w'] += 1
            if how == 'crush':
                stats[win]['rout'] += 1
                stats[y if win == x else x]['lost_rout'] += 1
            for k, v in extra.get('uu', {}).items():
                from game.data import UNITS
                stats[UNITS[k]['civ']]['uu'] += v
            for t in extra.get('techs', []):
                uts[t] = uts.get(t, 0) + 1
            if n % 10 == 0:
                print(f'  {n}/{len(tasks)} in {time.time() - t0:.0f} s')
    from game.data import CIVS as C
    print(f'\nDone in {time.time() - t0:.0f} s; errors: {len(errors)}')
    print(f'{"civilization":14s} matches  wins  win%  crushed  was crushed  unique units (alive)')
    for c in sorted(civs, key=lambda c: -stats[c]['w'] / max(1, stats[c]['g'])):
        s = stats[c]
        print(f'{C[c]["name"]:14s} {s["g"]:6d} {s["w"]:6d} {100 * s["w"] / max(1, s["g"]):6.0f}% {s["rout"]:9d} '
              f'{s["lost_rout"]:11d} {s["uu"]:8d}')
    print('unique techs/elite researched (times):', ' '.join(f'{k}:{v}' for k, v in sorted(uts.items())))
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
