#!/usr/bin/env python3
"""Печать дерева виджетов AoE2 DE widgetui/*.json (из UI-модов): тип, имя, координаты, размер.
  python3 tools/research/widget_tree.py path/to/resourcepanel.json [--depth N]
"""
import json
import sys


def walk(ws, d, maxd):
    if d > maxd:
        return
    for c in ws:
        x = c.get('Widget', c)
        vp = x.get('ViewPort', {})
        print('  ' * d + f"{x.get('Type')}:{x.get('Name')} [{vp.get('xorigin')},{vp.get('yorigin')} "
              f"{vp.get('width')}x{vp.get('height')} {vp.get('alignment', '')}]")
        walk(x.get('ChildWidgets', []), d + 1, maxd)


if __name__ == '__main__':
    maxd = int(sys.argv[sys.argv.index('--depth') + 1]) if '--depth' in sys.argv else 99
    c = json.load(open(sys.argv[1]))['Collection']
    print(c['Name'], c.get('ViewPort'))
    walk(c['Widgets'], 0, maxd)
