#!/usr/bin/env python3
"""Статический разбор курсоров (исследование, игру не меняет).
Для каждого курсора из assets/ui/cursors и его оригинала 0 A.D.:
рамка непрозрачных пикселей, «остриё» (крайняя точка по диагонали), доминирующая диагональ,
сравнение с оригиналом и с его зеркальными/перевёрнутыми копиями, объявленная точка прицела.
  .venv/bin/python tools/research/cursor_static.py [--json out.json] [--preview shots/research_cursor/preview.png]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, ROOT)
OURS = os.path.join(ROOT, 'assets', 'ui', 'cursors')
ORIG = os.path.join(ROOT, 'assets', '0ad_raw', 'public', 'art', 'textures', 'cursors')

from game.uiskin import CURSOR_FILES  # noqa: E402

# Все состояния курсора, которые выбирает hud.cursor_kind / controls.order_mode
STATES = [('arrow', 'стрелка'), ('attack', 'атака'), ('build', 'строить'), ('repair', 'чинить'),
          ('garrison', 'гарнизон'), ('heal', 'лечить'), ('tree', 'дерево'), ('gold', 'золото'),
          ('stone', 'камень'), ('berries', 'ягоды'), ('farm', 'ферма'), ('meat', 'охота'), ('fish', 'рыба'),
          ('drop', 'сдать ресурс'), ('rally', 'сбор'), ('no', 'нельзя'),
          ('trade', 'торговля'), ('board', 'на борт/выгрузить'), ('flare', 'сигнал'),
          ('omode', 'режим приказа (патруль/охрана/…)')]
# Чем эти состояния показываются у нас на деле (hud.cursor_kind):
STATE_TO_KIND = {'trade': None, 'board': None, 'flare': 'arrow', 'omode': 'attack'}


def alpha(im):
    return np.asarray(im.convert('RGBA'))[..., 3]


def tip_metrics(a, thr=64):
    """Крайние непрозрачные точки по четырём диагоналям + рамка."""
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return None
    s, d = xs + ys, xs - ys
    ul = (int(xs[s.argmin()]), int(ys[s.argmin()]))
    lr = (int(xs[s.argmax()]), int(ys[s.argmax()]))
    ur = (int(xs[d.argmax()]), int(ys[d.argmax()]))
    ll = (int(xs[d.argmin()]), int(ys[d.argmin()]))
    cx, cy = xs.mean(), ys.mean()
    # доминирующая диагональ: где масса относительно центра рамки
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    bw, bh = bbox[2] - bbox[0] + 1, bbox[3] - bbox[1] + 1
    return dict(bbox=bbox, bw=bw, bh=bh, ul=ul, lr=lr, ur=ur, ll=ll, centroid=(round(float(cx), 1), round(float(cy), 1)),
                n=int(len(xs)))


def arrow_tip(a, thr=64):
    """Остриё стрелки «вверх-влево»: непрозрачный пиксель с минимальным x+y (при равенстве — верхний)."""
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return None
    s = xs + ys
    m = s.min()
    idx = np.nonzero(s == m)[0]
    i = idx[np.argmin(ys[idx])]
    return int(xs[i]), int(ys[i])


def diff(a, b):
    """Средняя абсолютная разница альфы (0..255) двух изображений одного размера."""
    if a.shape != b.shape:
        return None
    return round(float(np.abs(a.astype(int) - b.astype(int)).mean()), 2)


def flips(im):
    return {'as-is': im, 'mirror-x': ImageOps.mirror(im), 'flip-y': ImageOps.flip(im),
            'rot180': im.rotate(180)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=os.path.join(ROOT, 'shots', 'research_cursor', 'static.json'))
    ap.add_argument('--preview', default=os.path.join(ROOT, 'shots', 'research_cursor', 'preview.png'))
    args = ap.parse_args()
    with open(os.path.join(OURS, 'hotspots.json')) as f:
        hot = json.load(f)
    out = {}
    cells = []
    for state, ru in STATES:
        kind = STATE_TO_KIND.get(state, state)
        fn = CURSOR_FILES.get(kind) if kind else None
        rec = dict(state=state, ru=ru, kind=kind, file=fn)
        if fn is None:
            rec['note'] = 'состояния нет в игре' if kind is None else 'файла нет'
            out[state] = rec
            continue
        im = Image.open(os.path.join(OURS, fn + '.png')).convert('RGBA')
        rec['size'] = im.size
        rec['hot_declared'] = hot.get(fn, [1, 1])
        # как в Cursors.get: >32 px → 32
        eff = im
        hx, hy = rec['hot_declared']
        if im.width > 32:
            k = 32 / im.width
            eff = im.resize((32, round(im.height * k)), Image.BILINEAR)
            hx, hy = int(hx * k), int(hy * k)
        rec['size_eff'] = eff.size
        rec['hot_eff'] = [hx, hy]
        a = alpha(eff)
        rec['metrics'] = tip_metrics(a)
        rec['arrow_tip'] = arrow_tip(a)
        # оригинал 0 A.D. (для de_* — стрелка 0 A.D. как база)
        base = fn if not fn.startswith('de_') else 'arrow-default-down'
        op = os.path.join(ORIG, base + '.png')
        if os.path.exists(op):
            o = Image.open(op).convert('RGBA')
            rec['orig'] = dict(file=base, size=o.size, metrics=tip_metrics(alpha(o)), arrow_tip=arrow_tip(alpha(o)))
            ot = os.path.join(ORIG, base + '.txt')
            rec['orig']['hot'] = [int(v) for v in open(ot).read().split()[:2]] if os.path.exists(ot) else None
            if not fn.startswith('de_'):
                oa = alpha(o)
                ia = alpha(im)
                rec['vs_orig'] = {k: diff(alpha(v), ia) for k, v in flips(o).items()}
        out[state] = rec
        cells.append((state, fn, im, eff, rec))
    os.makedirs(os.path.dirname(args.json), exist_ok=True)
    with open(args.json, 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1, default=str)
    # превью ×4: наш (эфф.), оригинал 0 A.D.
    K = 4
    cw, ch = 32 * K + 8, 32 * K + 8
    sh = Image.new('RGBA', (cw * 2, ch * len(cells)), (60, 60, 60, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sh)
    for i, (state, fn, im, eff, rec) in enumerate(cells):
        y = i * ch
        big = eff.resize((eff.width * K, eff.height * K), Image.NEAREST)
        sh.alpha_composite(big, (4, y + 4))
        hx, hy = rec['hot_eff']
        d.line((4 + hx * K - 6, y + 4 + hy * K, 4 + hx * K + 6, y + 4 + hy * K), fill=(255, 0, 0, 255))
        d.line((4 + hx * K, y + 4 + hy * K - 6, 4 + hx * K, y + 4 + hy * K + 6), fill=(255, 0, 0, 255))
        if rec.get('orig'):
            o = Image.open(os.path.join(ORIG, rec['orig']['file'] + '.png')).convert('RGBA')
            k2 = min(1.0, 32 / max(o.size))
            o = o.resize((round(o.width * k2 * K), round(o.height * k2 * K)), Image.NEAREST)
            sh.alpha_composite(o, (cw + 4, y + 4))
        d.text((6, y + ch - 14), f'{state} {fn} hot={rec["hot_eff"]} tip={rec["arrow_tip"]}', fill=(255, 255, 0, 255))
    sh.convert('RGB').save(args.preview)
    print('записано', args.json, args.preview)
    for state, rec in out.items():
        m = rec.get('metrics')
        print(f"{state:8} {str(rec.get('file')):22} size={rec.get('size')} hot={rec.get('hot_eff')} "
              f"tip={rec.get('arrow_tip')} bbox={m and m['bbox']} vs_orig={rec.get('vs_orig')}")


if __name__ == '__main__':
    main()
