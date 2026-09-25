#!/usr/bin/env python3
"""Быстрое превью юнитов без сборки листов: рендер кадра прямо из описания набора (tools/build_units.py)
рядом с эталоном DE (shots/ref/units/, только для сравнения; в репозиторий не входит).

  .venv/bin/python tools/research/units_preview.py knight,militia,vil_m_chop --out shots/prev.png
  .venv/bin/python tools/research/units_preview.py all --out shots/prev_all.png     # все кванты теста
Ключи — как в units_common.Q (кванты слепого теста). Колонки: покой ×3, атака/работа ×3, ×1, DE.
"""
import argparse, os, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from units_common import Q, REPO, BLUE, TA, TB, TD, on_grass  # noqa: E402
from units_side_by_side import de_img, font  # noqa: E402

QK = {q['key']: q for q in Q}


def tint(spr, color=BLUE):
    im = spr.rgba.astype(np.float32)
    m = spr.mask.astype(np.float32)[..., None] / 255
    g = (im[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    c = np.array(color, np.float32)[None, None]
    t = np.clip(g * np.minimum(255, c * TB + 255 * TD) / 255 + c * TA, 0, 255)
    im[..., :3] = im[..., :3] * (1 - m) + t * m
    return im


def render(sname, spec, anim, frac, d, r):
    from tools import build_units as bu
    from tools.render3d import Renderer, animactor as aa
    rec = next((a for a in spec['anims'] if a[0] == anim), None) or spec['anims'][0]
    tree = bu.spec_tree(spec, rec[1], rec[2])
    if spec.get('ship') and anim == 'walk':
        bu._calm_sails(tree, spec.get('seed', 0))
    sc = bu.spec_scale(spec)
    items = Renderer.build_items(aa.evaluate(tree, frac) + bu.extra_parts(spec), bu._place(sc, d))
    return bu.shoot(r, items, spec)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('keys')
    ap.add_argument('--out', default=os.path.join(REPO, 'shots', 'prev.png'))
    ap.add_argument('--d', type=int, default=3)
    ap.add_argument('--k', type=int, default=3, help='увеличение')
    a = ap.parse_args()
    from tools import build_units as bu
    sets, _ = bu.plan()
    keys = [q['key'] for q in Q] if a.keys == 'all' else a.keys.split(',')
    r = bu._renderer()
    rows = []
    f = font(12)
    for k in keys:
        q = QK.get(k)
        sname, anim, frac = (q['set'], q['anim'], q['frac']) if q else (k, 'idle', 0.0)
        if sname.startswith('@'):
            sname = bu.unit_spec(sname[1:])[0]
        spec = sets[sname]
        tiles = []
        s0 = render(sname, spec, anim, frac, a.d, r)
        g = on_grass(tint(s0))
        tiles.append(g.resize((g.size[0] * a.k, g.size[1] * a.k), Image.NEAREST))
        an2 = 'attack' if anim == 'idle' else 'idle'
        if any(x[0] == an2 for x in spec['anims']):
            s1 = render(sname, spec, an2, 0.45, a.d, r)
            g1 = on_grass(tint(s1))
            tiles.append(g1.resize((g1.size[0] * a.k, g1.size[1] * a.k), Image.NEAREST))
        tiles.append(g)
        de = de_img(k) if q else None
        H = max(t.size[1] for t in tiles)
        if de is not None:
            de = de.convert('RGB')
            de = de.resize((int(de.size[0] * 150 / de.size[1]), 150))
            tiles.append(de)
            H = max(H, 150)
        W = sum(t.size[0] + 6 for t in tiles)
        row = Image.new('RGB', (max(W, 200), H + 16), (30, 30, 30))
        x = 0
        for t in tiles:
            row.paste(t, (x, 16 + H - t.size[1]))
            x += t.size[0] + 6
        ImageDraw.Draw(row).text((2, 1), f'{k}  [{sname}]', fill=(255, 230, 0), font=f)
        rows.append(row)
    cols = 2 if len(rows) > 6 else 1
    per = (len(rows) + cols - 1) // cols
    colw = [max((rr.size[0] for rr in rows[c * per:(c + 1) * per]), default=0) for c in range(cols)]
    colh = [sum(rr.size[1] + 4 for rr in rows[c * per:(c + 1) * per]) for c in range(cols)]
    out = Image.new('RGB', (sum(colw) + 10 * cols, max(colh)), (20, 20, 20))
    x = 0
    for c in range(cols):
        y = 0
        for rr in rows[c * per:(c + 1) * per]:
            out.paste(rr, (x, y))
            y += rr.size[1] + 4
        x += colw[c] + 10
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out.save(a.out)
    print(a.out, out.size)


if __name__ == '__main__':
    main()
