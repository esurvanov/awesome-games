#!/usr/bin/env python3
"""Исследование «перевёрнутое и не туда указывает» (docs/research/09_flipped_and_pointing.md), части B/C/E:
по атласам (без игры) — сторона падающей тени у всех наборов юнитов, зданий, деревьев, жил, обрывов, туш;
привязка спрайтов к земле: низ тела − якорь у юнитов, низ ствола дерева − центр клетки, основание здания −
ромб основания; снаряды — лист «16 направлений стрелы + ожидаемое направление» и туши 8 направлений.

  .venv/bin/python tools/research/flip_shadows.py        # shots/research_flip/{proj_dirs,carcass_dirs}.png + числа
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GEN = os.path.join(REPO, 'assets', 'gen')
OUT = os.path.join(REPO, 'shots', 'research_flip')
HW, HH = 32, 16
BG = (98, 140, 62, 255)


def rgba(path):
    return np.asarray(Image.open(os.path.join(GEN, path)).convert('RGBA'))


def shadow_side(a, body_thr=128, lo=30):
    """(dx, dy) центра полупрозрачных пикселей (тень) относительно центра тела; None — тени нет."""
    body = a >= body_thr
    sh = (a >= lo) & (a < body_thr)
    if body.sum() < 10 or sh.sum() < 20:
        return None
    by, bx = np.nonzero(body)
    sy, sx = np.nonzero(sh)
    return float(sx.mean() - bx.mean()), float(sy.mean() - by.mean()), int(sh.sum())


def alpha_hist(a):
    h = np.bincount(a.ravel(), minlength=256)
    mid = h[30:128].sum()
    return int(h[128:].sum()), int(mid)


# ============================================================ юниты: все наборы
def units():
    with open(os.path.join(GEN, 'units', 'index.json'), encoding='utf-8') as f:
        idx = json.load(f)
    rows = []
    for name, rec in sorted(idx['sets'].items()):
        sheet = rgba(rec['file'])[..., 3]
        with open(os.path.join(GEN, rec['meta']), encoding='utf-8') as f:
            frames = json.load(f)['frames']
        a = rec['anims'].get('idle') or next(iter(rec['anims'].values()))
        nd = rec.get('dirs') or 8
        dxs, bots, cxs = [], [], []
        for d in range(nd):
            x, y, w, h, ax, ay = frames[a['i0'] + d * a['n']]
            fr = sheet[y:y + h, x:x + w]
            s = shadow_side(fr)
            if s:
                dxs.append(s[0])
            body = fr >= 128
            if body.any():
                ys, xs = np.nonzero(body)
                bots.append(int(ys.max()) + 1 - ay)
                cxs.append(float(xs.mean()) - ax)
        rows.append((name, np.mean(dxs) if dxs else None, np.mean(bots) if bots else None,
                     (min(bots), max(bots)) if bots else None, np.mean(np.abs(cxs)) if cxs else None))
    return rows


# ============================================================ здания, природа
def atlas_items():
    with open(os.path.join(GEN, 'atlas.json'), encoding='utf-8') as f:
        at = json.load(f)
    rows = []
    for grp, bl in at['buildings'].items():
        for kind, rec in bl.items():
            recs = [rec] + list(rec.get('variants') or [])
            for r in recs:
                im = rgba(r['file'])
                a = im[..., 3]
                s = shadow_side(a)
                size = rec.get('size') or r.get('size')
                # ромб основания в спрайте: верхний угол (ox, oy); нижний — (ox, oy + 2·size·HH)
                body = a >= 128
                ys, xs = np.nonzero(body)
                # низ спрайта у нижнего угла ромба (столбец ox ± 6)
                col = body[:, max(0, r['ox'] - 6):r['ox'] + 6]
                cy = np.nonzero(col.any(1))[0]
                bottom = int(cy.max()) + 1 - (r['oy'] + 2 * size * HH) if len(cy) else None
                rows.append(('building', f'{grp}/{kind}', s, bottom, size))
    for kind, lst in at['nature'].items():
        if kind == 'animals':
            continue
        entries = lst.items() if isinstance(lst, dict) else [(kind, lst)]
        for sp, recs in entries:
            for r in recs[:3]:
                im = rgba(r['file'])
                a = im[..., 3]
                s = shadow_side(a)
                body = a >= 128
                ys, xs = np.nonzero(body)
                if not len(xs):
                    continue
                # низ ствола: самые нижние 3 строки тела — центр по x относительно ox, низ относительно oy + HH
                yb = ys.max()
                base = xs[ys >= yb - 2]
                rows.append((kind, f'{sp}:{os.path.basename(r["file"])}', s, int(yb) + 1 - (r['oy'] + HH),
                             float(base.mean()) - r['ox']))
    return rows


# ============================================================ снаряды и туши: листы
def proj_sheet():
    with open(os.path.join(GEN, 'nature_extra.json'), encoding='utf-8') as f:
        g = json.load(f)['groups']
    names = [n for n in ('proj_arrow', 'proj_bolt', 'proj_javelin') if n in g]
    CELL = 64
    img = Image.new('RGBA', (CELL * 16 + 120, CELL * len(names) + 30), BG)
    dr = ImageDraw.Draw(img)
    tips = {}
    for r, n in enumerate(names):
        sheet = rgba(g[n]['file'])
        nd = g[n]['dirs']
        dr.text((6, 30 + r * CELL + 24), n, fill=(255, 255, 255, 255))
        agree = 0
        for i in range(nd):
            x, y, w, h, ax, ay = g[n]['frames'][i]
            fr = sheet[y:y + h, x:x + w]
            th = 2 * math.pi * i / nd
            ex, ey = math.cos(th), math.sin(th)
            px, py = 120 + i * CELL + CELL // 2, 30 + r * CELL + CELL // 2
            fim = Image.fromarray(fr).resize((w * 3, h * 3), Image.NEAREST)
            img.alpha_composite(fim, (px - ax * 3, py - ay * 3))
            dr.line([(px - ex * 28, py - ey * 28), (px - ex * 22, py - ey * 22)], fill=(255, 60, 60, 255), width=2)
            dr.ellipse((px + ex * 26 - 2, py + ey * 26 - 2, px + ex * 26 + 2, py + ey * 26 + 2), fill=(255, 60, 60, 255))
            if r == 0:
                dr.text((px - 20, 8), f'{i}: {math.degrees(th):g}°', fill=(255, 255, 200, 255))
            # «острие» — самый далёкий непрозрачный пиксель вдоль ожидаемого направления
            a = fr[..., 3] >= 128
            ys, xs = np.nonzero(a)
            if len(xs):
                proj = (xs - ax) * ex + (ys - ay) * ey
                agree += proj.max() >= -proj.min()        # спрайт вытянут вперёд не меньше, чем назад
        tips[n] = agree / nd
    path = os.path.join(OUT, 'proj_dirs.png')
    img.save(path)
    return path, tips


def carcass_sheet():
    with open(os.path.join(GEN, 'nature_extra.json'), encoding='utf-8') as f:
        g = json.load(f)['groups']
    names = [n for n in g if n.startswith('carcass_')]
    CELL = 72
    img = Image.new('RGBA', (CELL * 8 + 120, CELL * len(names) + 30), BG)
    dr = ImageDraw.Draw(img)
    sh = []
    for r, n in enumerate(names):
        sheet = rgba(g[n]['file'])
        nd = g[n]['dirs']
        dr.text((6, 30 + r * CELL + 30), n, fill=(255, 255, 255, 255))
        for d in range(nd):
            x, y, w, h, ax, ay = g[n]['frames'][d]
            fr = sheet[y:y + h, x:x + w]
            a = d * math.tau / nd
            fx, fy = math.cos(a), math.sin(a)
            ex, ey = fx - fy, (fx + fy) / 2
            L = math.hypot(ex, ey)
            ex, ey = ex / L * 24, ey / L * 24
            px, py = 120 + d * CELL + CELL // 2, 30 + r * CELL + CELL // 2
            fim = Image.fromarray(fr).resize((w * 2, h * 2), Image.NEAREST)
            img.alpha_composite(fim, (px - ax * 2, py - ay * 2))
            dr.line([(px, py), (px + ex, py + ey)], fill=(255, 60, 60, 255), width=2)
            if r == 0:
                dr.text((px - 10, 8), f'd={d}', fill=(255, 255, 200, 255))
            s = shadow_side(fr[..., 3])
            if s:
                sh.append(s[0])
    path = os.path.join(OUT, 'carcass_dirs.png')
    img.save(path)
    return path, (np.mean(sh) if sh else None)


def main():
    os.makedirs(OUT, exist_ok=True)
    print('== юниты (idle, все направления): тень dx (− влево), низ тела − якорь')
    rows = units()
    dxs = [r[1] for r in rows if r[1] is not None]
    bots = [r[2] for r in rows if r[2] is not None]
    cxs = [r[4] for r in rows if r[4] is not None]
    print(f'наборов {len(rows)}: тень dx среднее {np.mean(dxs):+.1f} px, вправо (dx>0) у {sum(d > 0 for d in dxs)}; '
          f'низ−якорь среднее {np.mean(bots):+.1f}, |cx−якорь| среднее {np.mean(cxs):.1f}')
    bad = [r for r in rows if r[1] is not None and r[1] > 0]
    for r in bad[:20]:
        print('  тень вправо:', r[0], f'{r[1]:+.1f}')
    far = sorted((r for r in rows if r[3]), key=lambda r: -max(abs(r[3][0]), abs(r[3][1])))[:12]
    for r in far:
        print(f'  низ−якорь {r[3][0]:+d}..{r[3][1]:+d}  {r[0]}')
    print('== здания / природа: тень dx, низ спрайта − нижний угол ромба (здания) / низ ствола − центр клетки')
    items = atlas_items()
    by = {}
    for kind, name, s, bottom, extra in items:
        by.setdefault(kind, []).append((name, s, bottom, extra))
    for kind, lst in by.items():
        dx = [s[0] for _, s, _, _ in lst if s]
        bt = [b for _, _, b, _ in lst if b is not None]
        ex = [e for _, _, _, e in lst if isinstance(e, float)]
        print(f'{kind:<10} n={len(lst)} тень dx {np.mean(dx) if dx else float("nan"):+.1f} (вправо у {sum(d > 0 for d in dx)}/{len(dx)}); '
              f'низ−ромб/центр: mean {np.mean(bt) if bt else float("nan"):+.1f} min {min(bt) if bt else 0:+d} max {max(bt) if bt else 0:+d}'
              + (f'; ствол cx−ox mean {np.mean(ex):+.1f} max|{max(abs(e) for e in ex):.0f}|' if ex else ''))
        if kind == 'building':
            for name, s, b, size in sorted(lst, key=lambda r: -abs(r[2] or 0))[:6]:
                print(f'   {name:<28} низ−ромб {b:+d} (size {size})')
    p, tips = proj_sheet()
    print('== снаряды:', p, '— доля направлений, где спрайт вытянут вперёд:', {k: f'{v:.2f}' for k, v in tips.items()})
    p, sh = carcass_sheet()
    print('== туши:', p, f'тень dx {sh:+.1f}' if sh is not None else '')


if __name__ == '__main__':
    main()
