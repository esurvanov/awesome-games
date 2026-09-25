#!/usr/bin/env python3
"""Сборка docs/research/06_units_recognition.md и shots/research_units/side_by_side.png из
score.json (units_score.py), metrics.json (units_metrics.py) и units_notes.N."""
import json, os, subprocess, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
from units_common import Q, OUT
from units_notes import N

B = os.path.join(OUT, 'blind')
PTS = lambda v: 1.0 if v['exact'] else (0.5 if v['line'] else 0.0)
MARK = lambda v: '✓' if v['exact'] else ('≈' if v['line'] else '✗')


# частота на поле (грубо, по опыту игры): чем раньше в списке, тем важнее узнавание
FREQ = ['villager_m', 'villager_f', 'militia', 'archer', 'skirmisher', 'scout', 'knight', 'spearman', 'man_at_arms',
        'crossbowman', 'long_swordsman', 'pikeman', 'light_cavalry', 'monk', 'mangonel', 'ram', 'cavalry_archer',
        'hussar', 'two_handed_swordsman', 'hand_cannoneer', 'trebuchet', 'fishing_ship', 'galley', 'war_galley',
        'transport_ship', 'fire_galley', 'camel_rider', 'heavy_cavalry_archer', 'teutonic_knight', 'huskarl',
        'janissary', 'mangudai', 'cataphract', 'longbowman', 'chu_ko_nu', 'mameluke', 'berserk', 'samurai',
        'woad_raider', 'conquistador', 'throwing_axeman', 'heavy_scorpion', 'heavy_demolition_ship', 'heavy_camel_rider']


def base(k):
    if k.startswith('vil_m'):
        return 'villager_m'
    if k.startswith('vil_f'):
        return 'villager_f'
    return k[6:] if k.startswith('elite_') else k


def verdict(r, cost):
    p = 0.2 * PTS(r['sil']) + 0.4 * PTS(r['1x']) + 0.4 * PTS(r['3x'])
    if r['3x']['exact'] and r['1x']['line']:
        v = '✅'
    elif p >= 0.3:
        v = '⚠️'
    else:
        v = '🚫' if cost == '🔴' else '❌'
    return v, p


def main():
    sc = json.load(open(os.path.join(B, 'score.json')))
    key = json.load(open(os.path.join(B, '_key.json')))
    inv = {v: k for k, v in key['tex'].items()}
    met = json.load(open(os.path.join(OUT, 'metrics.json')))
    rows = []
    for q in Q:
        k = q['key']
        r = sc['per_unit'][k]
        de, ours, conf, fix, cost = N[k]
        v, p = verdict(r, cost)
        rows.append(dict(k=k, cls=q['cls'], r=r, v=v, p=p, de=de, ours=ours, conf=conf, fix=fix, cost=cost,
                         crop=f'blind/tex/{inv[k]}_3x.png', set=q['set']))
    json.dump([{x: y for x, y in r.items() if x != 'r'} for r in rows],
              open(os.path.join(OUT, 'verdicts.json'), 'w'), ensure_ascii=False, indent=1)
    cnt = collections.Counter(r['v'] for r in rows)
    order = sorted(rows, key=lambda r: (r['p'], FREQ.index(base(r['k'])) if base(r['k']) in FREQ else 99, r['k']))
    seen, worst = set(), []
    for r in order:
        b = base(r['k'])
        if r['cls'] != 'звери' and b not in seen:
            seen.add(b)
            worst.append(b if r['k'].startswith('elite_') and b in N else r['k'])
    worst30 = worst[:30]
    notes = {k: next(r['conf'] for r in rows if r['k'] == k) for k in worst30}
    npath = os.path.join(OUT, '_worst_notes.json')
    json.dump(notes, open(npath, 'w'), ensure_ascii=False)
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'units_side_by_side.py'),
                    '--worst', '30', '--notes', npath], check=True)
    print(cnt, worst30[:15])
    return rows, cnt, order, met, sc


if __name__ == '__main__':
    main()
