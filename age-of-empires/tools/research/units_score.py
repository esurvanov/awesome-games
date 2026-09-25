#!/usr/bin/env python3
"""Подсчёт слепого теста: guess_{sil,1x,3x}.txt против _key.json → shots/research_units/blind/score.json.

Строго — точный юнит; «линия» — угадана линия улучшений (ополченец…чемпион, рыцарь…паладин, элитный = обычный,
житель любой позы = житель)."""
import json, os, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
from units_common import Q, OUT

B = os.environ.get('UNITS_BLIND_DIR') or os.path.join(OUT, 'blind')
LINES = [
    ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion'],
    ['spearman', 'pikeman', 'halberdier'], ['archer', 'crossbowman', 'arbalester'], ['skirmisher', 'elite_skirmisher'],
    ['scout', 'light_cavalry', 'hussar'], ['knight', 'cavalier', 'paladin'], ['cavalry_archer', 'heavy_cavalry_archer'],
    ['camel_rider', 'heavy_camel_rider'], ['ram', 'capped_ram', 'siege_ram'], ['mangonel', 'onager', 'siege_onager'],
    ['scorpion', 'heavy_scorpion'], ['trebuchet', 'trebuchet_up'], ['galley', 'war_galley', 'galleon'],
    ['fire_galley', 'fire_ship', 'fast_fire_ship'], ['demolition_ship', 'heavy_demolition_ship'],
]


def line(k):
    if k.startswith('vil'):
        return 'villager'
    k = k[6:] if k.startswith('elite_') else k
    for L in LINES:
        if k in L:
            return L[0]
    return k


def main():
    key = json.load(open(os.path.join(B, '_key.json')))
    cls = {q['key']: q['cls'] for q in Q}
    res = collections.defaultdict(dict)
    for mode, kk in (('sil', 'sil'), ('1x', 'tex'), ('3x', 'tex')):
        for ln in open(os.path.join(B, f'guess_{mode}.txt')):
            if not ln.strip():
                continue
            i, g = ln.split()
            t = key[kk][i]
            res[t][mode] = dict(guess=g, exact=g == t, line=line(g) == line(t))
    summ = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0]))
    for t, r in res.items():
        for c in (cls[t], 'ВСЕГО'):
            for mode, v in r.items():
                s = summ[c][mode]
                s[0] += v['exact']; s[1] += v['line']; s[2] += 1
    out = dict(per_unit=res, summary={c: {m: dict(exact=v[0], line=v[1], n=v[2]) for m, v in d.items()} for c, d in summ.items()})
    json.dump(out, open(os.path.join(B, 'score.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'{"класс":12} ' + '  '.join(f'{m:>14}' for m in ('sil', '1x', '3x')))
    for c, d in summ.items():
        print(f'{c:12} ' + '  '.join(f'{d[m][0]:2}/{d[m][2]:<2} л{d[m][1]:2} {100*d[m][0]/d[m][2]:3.0f}%' for m in ('sil', '1x', '3x')))
    print()
    for t, r in res.items():
        print(f'{t:24} ' + '  '.join(f'{m}:{"✓" if r[m]["exact"] else ("~" if r[m]["line"] else "✗")} {r[m]["guess"]:22}' for m in ('sil', '1x', '3x')))


if __name__ == '__main__':
    main()


# грубый тип силуэта: пеший ближнего боя / пеший стрелок / конный / осадное / корабль / житель / зверь / прочее
FOOT_R = {'archer', 'crossbowman', 'arbalester', 'skirmisher', 'elite_skirmisher', 'hand_cannoneer', 'throwing_axeman',
          'longbowman', 'chu_ko_nu', 'janissary'}
MOUNT = {'scout', 'light_cavalry', 'hussar', 'knight', 'cavalier', 'paladin', 'cavalry_archer', 'heavy_cavalry_archer',
         'camel_rider', 'heavy_camel_rider', 'mangudai', 'cataphract', 'mameluke', 'conquistador', 'war_elephant'}


def coarse(k):
    if k.startswith('vil'):
        return 'житель'
    b = k[6:] if k.startswith('elite_') else k
    if b in FOOT_R:
        return 'пеший стрелок'
    if b in MOUNT:
        return 'конный'
    c = {q['key']: q['cls'] for q in Q}.get(k, '')
    if c in ('осадные', 'флот', 'звери'):
        return c
    if b in ('monk', 'trade_cart', 'fire_ship', 'fast_fire_ship'):
        return {'monk': 'монах', 'trade_cart': 'повозка'}.get(b, 'флот')
    if b == 'trebuchet_up':
        return 'осадные'
    return 'пеший ближний'


def coarse_report():
    s = json.load(open(os.path.join(B, 'score.json')))
    tot = collections.defaultdict(lambda: collections.Counter())
    for t, r in s['per_unit'].items():
        for m, v in r.items():
            tot[coarse(t)][m, 'n'] += 1
            tot[coarse(t)][m, 'ok'] += coarse(v['guess']) == coarse(t)
    for c, d in tot.items():
        print(f'{c:14}', '  '.join(f"{m}: {d[m, 'ok']}/{d[m, 'n']}" for m in ('sil', '1x', '3x')))
    return tot


if __name__ == '__main__' and '--coarse' in sys.argv:
    coarse_report()
