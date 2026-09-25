#!/usr/bin/env python3
"""Дерево деталей набора (актор, меш, текстура, материал, стиль перекраски) — для отладки правок build_units.

  .venv/bin/python tools/research/units_tree.py pikeman.caro [anim]
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    from tools import build_units as bu
    from tools.render3d import assets
    sets, _ = bu.plan()
    name = sys.argv[1]
    anim = sys.argv[2] if len(sys.argv) > 2 else 'idle'
    spec = sets[name]
    rec = next((a for a in spec['anims'] if a[0] == anim), spec['anims'][0])
    tree = bu.spec_tree(spec, rec[1], rec[2])

    def walk(nd, ap='', d=0):
        tex = nd.textures.get('baseTex')
        ok = '' if not tex or tex.startswith('@') or assets.texture(tex) is not None else '  !нет текстуры'
        an = nd.anim['file'] if nd.anim else ''
        print('  ' * d + f'[{ap}] {nd.actor}  mesh={nd.mesh}  tex={tex}{ok}  mat={nd.material}'
              f'{"  paint=" + nd.paint if nd.paint else ""}  anim={an}')
        for p, ch, k in nd.props:
            walk(ch, p + ('' if k == 1.0 else f' ×{k}'), d + 1)
    walk(tree)


if __name__ == '__main__':
    main()
