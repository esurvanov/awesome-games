#!/usr/bin/env python3
"""Исследование карт (docs/research/07_maps.md): безоконно генерирует карты и меряет на игрока
то, что в AoE2 DE задаётся RMS-скриптом — число объектов, расстояния от ЦГ, лес, вода, холмы.

  .venv/bin/python tools/research/map_stats.py                  # 6 карт DE × сиды 1–10, 2 игрока
  .venv/bin/python tools/research/map_stats.py --types land,coast   # старые типы
  .venv/bin/python tools/research/map_stats.py --players 4 --seeds 5 --json out.json

Игра не меняется: только World(...) и чтение его полей.
«Своё» = ближе к старту этого игрока, чем к чужому (диаграмма Вороного).
Группы золота/камня/ягод/леса — связные компоненты (8-соседство) клеток одного вида.
Расстояние — от центра ЦГ (клетка старта) до ближайшей клетки группы, в клетках (евклид).
"""
import argparse
import json
import math
import os
import random
import statistics as st
import sys
from collections import defaultdict

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from game.data import TILE  # noqa: E402
from game.world import World  # noqa: E402


def groups(cells):
    """Связные компоненты множества клеток (8-соседство)."""
    cells = set(cells)
    out = []
    while cells:
        s = cells.pop()
        comp, stack = [s], [s]
        while stack:
            x, y = stack.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    c = (x + dx, y + dy)
                    if c in cells:
                        cells.remove(c)
                        comp.append(c)
                        stack.append(c)
        out.append(comp)
    return out


def measure(w):
    W, H = w.W, w.H
    starts = w.starts
    n = len(starts)

    def owner_of(x, y):
        return min(range(n), key=lambda p: math.hypot(x - starts[p][0], y - starts[p][1]))

    def dist(p, x, y):
        return math.hypot(x - starts[p][0], y - starts[p][1])

    per = [defaultdict(list) for _ in range(n)]
    bykind = defaultdict(list)
    for nd in w.nodes:
        bykind[nd.kind].append((nd.tx, nd.ty))
    tot = W * H
    res = {'side': W, 'players': n}
    # группы ресурсов
    for kind in ('gold', 'stone', 'berries', 'shore_fish', 'deep_fish'):
        for g in groups(bykind.get(kind, [])):
            cx = sum(c[0] for c in g) / len(g)
            cy = sum(c[1] for c in g) / len(g)
            p = owner_of(cx, cy)
            d = min(dist(p, x, y) for x, y in g)
            per[p][kind].append((len(g), round(d, 1)))
    # лес: группы деревьев; одиночки/мелкие (≤3) — «отбившиеся» деревья
    trees = bykind.get('tree', [])
    tg = groups(trees)
    forest_sizes = sorted((len(g) for g in tg), reverse=True)
    res['trees'] = len(trees)
    res['tree_share'] = round(len(trees) / tot, 3)
    res['forests_ge20'] = sum(1 for s in forest_sizes if s >= 20)
    res['forest_top'] = forest_sizes[:6]
    for g in tg:
        if len(g) <= 3:
            for x, y in g:
                p = owner_of(x, y)
                if dist(p, x, y) <= 12:
                    per[p]['straggler'].append(round(dist(p, x, y), 1))
    # ближайший лес (группа ≥ 20) — расстояние от старта
    for p in range(n):
        ds = [min(dist(p, x, y) for x, y in g) for g in tg if len(g) >= 20]
        per[p]['wood_near'] = round(min(ds), 1) if ds else None
        per[p]['trees_r15'] = sum(1 for x, y in trees if dist(p, x, y) <= 15)
        # леса игрока: группы 20–400 клеток, ближайшая клетка ≤ 25 от своего старта (размер)
        per[p]['pforest'] = [len(g) for g in tg if 20 <= len(g) <= 400 and
                             min(dist(p, x, y) for x, y in g) <= 25 and
                             owner_of(*g[0]) == p]
    # животные
    for a in w.animals:
        tx, ty = int(a.x // TILE), int(a.y // TILE)
        p = a.owner if a.owner >= 0 else owner_of(tx, ty)
        key = a.kind + ('_own' if a.owner >= 0 else '')
        per[p][key].append(round(dist(p, tx, ty), 1))
    # реликвии, волки (на карту), пейзаж
    rl = list(getattr(w, 'relics', ()) or ())
    res['relics'] = len(rl)
    res['relic_min_dist'] = round(min((min(dist(p, r.tx, r.ty) for p in range(n)) for r in rl), default=0), 1)
    wolves = [a for a in w.animals if a.kind == 'wolf']
    res['wolves'] = len(wolves)
    res['wolf_min_dist'] = round(min((min(dist(p, int(a.x // TILE), int(a.y // TILE)) for p in range(n))
                                      for a in wolves), default=0), 1)
    res['theme'] = getattr(w, 'theme', '-')
    res['walls'] = sum(1 for b in w.buildings if b.d.get('wall'))
    # стартовые юниты
    for u in w.units:
        per[u.owner]['unit_' + u.kind].append(1)
    for b in w.buildings:
        per[b.owner]['bld_' + b.kind].append(1)
    # вода, мелководье, обрывы, высоты
    T = w.terrain
    cnt = defaultdict(int)
    for row in T:
        for t in row:
            cnt[t] += 1
    res['water_share'] = round(cnt[1] / tot, 3)
    res['shallow_share'] = round(cnt[2] / tot, 3)
    res['cliff_tiles'] = cnt[3]
    res['cliff_segments'] = len(getattr(w, 'cliffs', []) or [])
    em = getattr(w, 'elev_map', None)
    if em is not None:
        levels = defaultdict(int)
        for v in em:
            levels[v] += 1
        res['elev_hist'] = {k: round(v / tot, 3) for k, v in sorted(levels.items())}
        res['hill_share'] = round(sum(v for k, v in levels.items() if k >= 1) / tot, 3)
        res['elev_max'] = max(levels)
    # озёра: компоненты воды
    wc = groups([(x, y) for y in range(H) for x in range(W) if T[y][x] == 1])
    res['water_bodies'] = len(wc)
    res['water_body_sizes'] = sorted((len(c) for c in wc), reverse=True)[:6]
    # старт-старт
    dd = [math.hypot(starts[i][0] - starts[j][0], starts[i][1] - starts[j][1])
          for i in range(n) for j in range(i + 1, n)]
    res['start_dist_min'] = round(min(dd), 1)
    res['start_edge'] = [min(x, y, W - 1 - x, H - 1 - y) for x, y in starts]
    res['start_radius_pct'] = round(100 * st.mean(math.hypot(x - (W - 1) / 2, y - (H - 1) / 2) for x, y in starts) / W, 1)
    # типы земли
    gr = getattr(w, 'ground', None)
    if gr is not None:
        from game.terrain import GROUNDS
        gc = defaultdict(int)
        for v in gr:
            gc[GROUNDS[v]] += 1
        res['ground'] = {k: round(v / tot, 3) for k, v in sorted(gc.items(), key=lambda kv: -kv[1])}
    res['per_player'] = [{k: v for k, v in d.items()} for d in per]
    return res


def summarize(rows):
    """Средние по игрокам и картам."""
    agg = defaultdict(list)
    for r in rows:
        for pp in r['per_player']:
            for k, v in pp.items():
                if isinstance(v, list) and k == 'pforest':
                    agg['pforest_n'].append(len(v))
                    agg['pforest_size'].extend(v)
                elif isinstance(v, list):
                    if k in ('gold', 'stone', 'berries', 'shore_fish', 'deep_fish'):
                        agg[k + '_groups'].append(len(v))
                        agg[k + '_tiles'].append(sum(s for s, _ in v))
                        agg[k + '_nearest'].append(min((d for _, d in v), default=None))
                        for s, d in v:
                            agg[k + '_group_sizes'].append(s)
                            agg[k + '_dists'].append(d)
                    else:
                        agg[k].append(len(v))
                        if v and not k.startswith(('unit_', 'bld_')):
                            agg[k + '_dist'].extend(v)
                elif v is not None:
                    agg[k].append(v)
    out = {}
    for k, v in sorted(agg.items()):
        v = [x for x in v if x is not None]
        if not v:
            continue
        if k.endswith(('_group_sizes',)):
            hist = defaultdict(int)
            for x in v:
                hist[x] += 1
            out[k] = dict(sorted(hist.items()))
        else:
            out[k] = {'mean': round(st.mean(v), 2), 'min': min(v), 'max': max(v)}
    for k in ('water_share', 'shallow_share', 'tree_share', 'hill_share', 'cliff_segments', 'cliff_tiles',
              'water_bodies', 'forests_ge20', 'start_dist_min', 'side', 'elev_max', 'trees', 'relics',
              'relic_min_dist', 'wolves', 'wolf_min_dist', 'walls', 'start_radius_pct'):
        v = [r[k] for r in rows if k in r]
        if v:
            out['map_' + k] = {'mean': round(st.mean(v), 3), 'min': min(v), 'max': max(v)}
    g = defaultdict(list)
    for r in rows:
        for k, v in r.get('ground', {}).items():
            g[k].append(v)
    th = defaultdict(int)
    for r in rows:
        th[r.get('theme', '-')] += 1
    out['map_themes'] = dict(th)
    out['map_ground'] = {k: round(sum(v) / len(rows), 3) for k, v in sorted(g.items(), key=lambda kv: -sum(kv[1]))}
    return out


def gen(mt, seed, players):
    random.seed(seed)
    return World(1, players, map_type=mt)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--types', default='arabia,arena,black_forest,nomad,islands,mediterranean')
    ap.add_argument('--seeds', type=int, default=10)
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    report = {}
    for mt in a.types.split(','):
        rows = []
        for s in range(1, a.seeds + 1):
            rows.append(measure(gen(mt, s, a.players)))
        report[mt] = {'summary': summarize(rows), 'maps': rows}
        print('==', mt, f'{a.players} игр., {a.seeds} карт')
        print(json.dumps(report[mt]['summary'], ensure_ascii=False, indent=None)
              .replace('}, "', '},\n "'))
    if a.json:
        with open(a.json, 'w') as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
        print('сохранено', a.json)


if __name__ == '__main__':
    main()
