#!/usr/bin/env python3
"""Безоконная симуляция партии: ИИ против ИИ (или против пассивного игрока 0).

Примеры:
  .venv/bin/python tools/sim.py --players 2 --minutes 45 --seed 1
  .venv/bin/python tools/sim.py --players 4 --mode teams --minutes 30 --seed 3
  .venv/bin/python tools/sim.py --players 3 --mode passive --minutes 20
  .venv/bin/python tools/sim.py --players 2 --map coast --minutes 45 --seed 2     # водная карта
  .venv/bin/python tools/sim.py --players 2 --civs franks,mongols                 # цивилизации (random — случайная)

Режимы:
  ai      — все игроки под ИИ, каждый сам за себя
  teams   — все под ИИ, две команды: игроки 0,1 против остальных (для 4 — 2×2)
  vs      — все под ИИ, игрок 0 один против команды остальных (как в меню «все против вас»)
  passive — игрок 0 ничего не делает, остальные — ИИ в одной команде
Выход с ненулевым кодом, если симуляция упала.
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

DT = 0.034          # шаг симуляции, игровые секунды (как в интерфейсе)


def make_world(n, mode, diff, map_type='land', civs=None):
    if mode == 'teams':
        half = max(1, n // 2)
        teams = [0 if i < half else 1 for i in range(n)]
    elif mode in ('vs', 'passive'):
        teams = [0] + [1] * (n - 1)
    else:
        teams = list(range(n))
    ai_players = range(1, n) if mode == 'passive' else range(n)
    # бонус сложности — только «противникам» (как в обычной игре)
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
        st = '' if p.alive else ' [побеждён]'
        lines.append(f'  P{p.id} t{p.team} {p.civ[:10]:10s} {AGE_NAMES[p.age][:12]:12s} vil {vils:3d} army {len(units) - vils:3d} tech {len(p.techs):2d} '
                     f'bld {blds:3d} kills {p.kills:4d} pop {p.pop}/{p.cap} [{res}] {army}{st}')
        if detail:
            bk = {}
            for b in w.buildings:
                if b.owner == p.id and b.kind not in ('house', 'farm'):
                    bk[b.kind] = bk.get(b.kind, 0) + 1
            lines.append('      здания: ' + ' '.join(f'{k}:{v}' for k, v in sorted(bk.items())))
            lines.append('      технологии: ' + ' '.join(sorted(p.techs)))
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--minutes', type=float, default=45)
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--mode', choices=('ai', 'teams', 'vs', 'passive'), default='ai')
    ap.add_argument('--diff', type=int, default=1, choices=(0, 1, 2))
    ap.add_argument('--map', default='land', choices=MAP_TYPES, help='тип карты')
    ap.add_argument('--every', type=float, default=5, help='интервал сводки, игровых минут (0 — только итог)')
    ap.add_argument('--civs', default='random', help='цивилизации через запятую (random — случайная)')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--detail', action='store_true', help='в итоге — здания и изученные технологии')
    a = ap.parse_args()
    random.seed(a.seed)
    t0 = time.time()
    try:
        w = make_world(a.players, a.mode, a.diff, a.map, a.civs.split(','))
        print(f'seed {a.seed}, {a.players} игроков, режим {a.mode}, карта {a.map} {w.W}×{w.H}, старты {w.starts}')
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
                    print(f'[{int(w.time // 60):3d} мин, {time.time() - t0:5.1f} с]')
                    print(summary(w))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
    print(f'=== итог: {w.time / 60:.1f} игровых мин за {time.time() - t0:.1f} с, '
          f'победитель: {"нет" if w.winner is None else "команда " + str(w.winner)}')
    print(summary(w, a.detail))
    if a.detail:
        print('  обучено всеми (кроме жителей):', ' '.join(f'{k}:{v}' for k, v in sorted(trained.items())))
    print('  события:', ' '.join(f'{k}:{v}' for k, v in sorted(events.items())))


if __name__ == '__main__':
    main()
