#!/usr/bin/env python3
"""Замер силы ИИ: пакет безоконных партий параллельно, сводка по эпохам, жителям, замкам,
уникальным юнитам/технологиям и исходу.

  .venv/bin/python tools/ai_bench.py duel --diff 2 --seeds 1-6 --minutes 60        # ИИ против ИИ, 2 игрока
  .venv/bin/python tools/ai_bench.py passive --diff 0,1,2 --seeds 1-3 --minutes 60  # ИИ против пассивного игрока
  .venv/bin/python tools/ai_bench.py teams --players 4 --map coast --seeds 1-2      # команды, водная карта
Выход с ненулевым кодом, если хоть одна партия упала.
"""
import argparse
import os
import random
import sys
import time
import traceback
from multiprocessing import Pool

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

DT = 0.034


def run(args):
    mode, n, diff, map_type, seed, minutes = args
    from game.world import World
    from game.ai import AI
    from game.data import UNITS, TECHS
    random.seed(seed)
    if mode == 'teams':
        half = max(1, n // 2)
        teams = [0 if i < half else 1 for i in range(n)]
    elif mode == 'passive':
        teams = [0] + [1] * (n - 1)
    else:
        teams = list(range(n))
    ais = list(range(1, n)) if mode == 'passive' else list(range(n))
    w = World(diff, n, teams, ai_players=range(1, n) if mode == 'passive' else ais, map_type=map_type,
              civs=['random'] * n)
    w.ais = [AI(w, pid, diff) for pid in ais]
    st = {pid: {'age': [None, None, None], 'uu': 0, 'castles': 0, 'vmax': 0, 'vil_at': {}, 'defeat': None}
          for pid in range(n)}
    t0 = time.time()
    marks = (15, 25, 35, 45)
    try:
        while w.time < minutes * 60 and w.winner is None:
            w.update(DT)
            for ev in w.events:
                k = ev[0]
                if k == 'age_up':
                    st[ev[3]]['age'][ev[4] - 1] = w.time / 60
                elif k == 'train_done' and UNITS.get(ev[4], {}).get('civ'):
                    st[ev[3]]['uu'] += 1
                elif k == 'build_done' and ev[4] == 'castle':
                    st[ev[3]]['castles'] += 1
                elif k == 'defeat':
                    st[ev[3]]['defeat'] = w.time / 60
            w.events.clear()
            if int(w.time) % 30 == 0 and int(w.time) != int(w.time - DT):
                vc = {}
                for u in w.units:
                    if u.kind == 'villager':
                        vc[u.owner] = vc.get(u.owner, 0) + 1
                for pid in range(n):
                    st[pid]['vmax'] = max(st[pid]['vmax'], vc.get(pid, 0))
                    for m in marks:
                        if abs(w.time - m * 60) < 1:
                            st[pid]['vil_at'][m] = vc.get(pid, 0)
    except Exception:
        return dict(args=args, error=traceback.format_exc())
    for p in w.players:
        st[p.id]['fin'] = (sum(1 for b in w.buildings if b.owner == p.id and b.kind == 'town_center'),
                           sum(1 for u in w.units if u.owner == p.id and u.kind == 'villager'),
                           sum(1 for u in w.units if u.owner == p.id and u.kind != 'villager' and not u.naval),
                           p.pop)
        st[p.id]['utech'] = sum(1 for t in p.techs if TECHS[t].get('civ'))
        st[p.id]['civ'] = p.civ
        st[p.id]['alive'] = p.alive
    return dict(args=args, winner=w.winner, end=w.time / 60, st=st, wall=time.time() - t0)


def fmt(x):
    return '  -  ' if x is None else f'{x:5.1f}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mode', choices=('duel', 'passive', 'teams', 'ffa'))
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--diff', default='2')
    ap.add_argument('--map', default='land')
    ap.add_argument('--seeds', default='1-6')
    ap.add_argument('--minutes', type=float, default=60)
    ap.add_argument('--jobs', type=int, default=6)
    a = ap.parse_args()
    if '-' in a.seeds:
        s0, s1 = map(int, a.seeds.split('-'))
        seeds = list(range(s0, s1 + 1))
    else:
        seeds = [int(s) for s in a.seeds.split(',')]
    mode = {'duel': 'ai', 'ffa': 'ai'}.get(a.mode, a.mode)
    tasks = [(mode, a.players, int(d), a.map, s, a.minutes) for d in a.diff.split(',') for s in seeds]
    with Pool(min(a.jobs, len(tasks))) as pool:
        res = pool.map(run, tasks)
    errors = 0
    decided = 0
    agg = {}
    for r in res:
        mode_, n, diff, mp, seed, _ = r['args']
        if 'error' in r:
            errors += 1
            print(f'!! diff {diff} seed {seed}: ОШИБКА\n{r["error"]}')
            continue
        if r['winner'] is not None:
            decided += 1
        print(f'diff {diff} {mp} seed {seed}: победитель {r["winner"]}, конец {r["end"]:.1f} мин '
              f'({r["wall"]:.0f} с)')
        for pid, s in r['st'].items():
            if mode_ == 'passive' and pid == 0:
                print(f'   P0 пассивный: разгромлен {fmt(s["defeat"])} мин')
                agg.setdefault(diff, {}).setdefault('kill', []).append(s['defeat'])
                continue
            va = ' '.join(f'{m}м:{v}' for m, v in sorted(s['vil_at'].items()))
            print(f'   P{pid} {s["civ"][:10]:10s} эпохи II {fmt(s["age"][0])} III {fmt(s["age"][1])} '
                  f'IV {fmt(s["age"][2])} | жит макс {s["vmax"]:3d} [{va}] | замков {s["castles"]} '
                  f'уник.юн {s["uu"]:3d} уник.тех {s["utech"]} | итог центры/жит/армия/нас {s["fin"]}' + ('' if s['alive'] else f' [побеждён {fmt(s["defeat"])}]'))
            g = agg.setdefault(diff, {})
            for i in range(3):
                if s['age'][i] is not None:
                    g.setdefault(f'age{i}', []).append(s['age'][i])
            g.setdefault('vmax', []).append(s['vmax'])
            g.setdefault('uu', []).append(s['uu'])
            g.setdefault('castles', []).append(s['castles'])
            g.setdefault('utech', []).append(s['utech'])
            g.setdefault('np', []).append(1)
    print('\n=== сводка')
    for diff, g in sorted(agg.items()):
        def avg(k):
            v = [x for x in g.get(k, []) if x is not None]
            return (sum(v) / len(v)) if v else None
        if 'kill' in g:
            ks = g['kill']
            print(f'diff {diff}: пассивный разгромлен в {sum(1 for k in ks if k is not None)}/{len(ks)} партий, '
                  f'среднее {fmt(avg("kill"))} мин, по партиям: {" ".join(fmt(k) for k in ks)}')
        if 'np' in g:
            npl = len(g['np'])
            print(f'diff {diff}: эпохи II {fmt(avg("age0"))} ({len(g.get("age0", []))}/{npl}) '
                  f'III {fmt(avg("age1"))} ({len(g.get("age1", []))}/{npl}) IV {fmt(avg("age2"))} '
                  f'({len(g.get("age2", []))}/{npl}) | жит макс {avg("vmax"):.0f} | замков {avg("castles"):.1f} '
                  f'| уник.юн {avg("uu"):.1f} | уник.тех {avg("utech"):.1f}')
    print(f'партий с победителем: {decided}/{len(res) - errors}, ошибок: {errors}')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
