#!/usr/bin/env python3
"""Глобальные факторы «вида» юнитов: наши кадры vs эталоны DE → shots/research_units/metrics.json.

  .venv/bin/python tools/research/units_metrics.py
Цвет игрока — одинаковый классификатор «синий» для обеих сторон (наши кадры тонированы PLAYER_COLORS[0]);
тело — непрозрачные пиксели без запечённой тени. DE: портреты fandom (shots/ref/units/*.0.png, фон чёрный) и
кропы юнитов из игровых скринов DE (shots/ref/gfx/*.jpg, отделены от земли по медиане рамки)."""
import glob, json, os, sys, statistics as st
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from units_common import Q, OUT, REPO, frame, index, GRASS

REF = os.path.join(REPO, 'shots', 'ref')
if not os.path.isdir(REF):          # рабочее дерево (worktree): эталоны — в основной копии
    REF = os.path.abspath(os.path.join(REPO, '..', '..', '..', 'shots', 'ref'))
# (файл, x0, y0, x1, y1, подпись) — отдельные юниты на игровых скринах DE (1920×1080, масштаб по умолчанию)
DE_GAME = [
    ('gfx/de_river_army.jpg', 47, 818, 90, 867, 'рыцарь синий'),
    ('gfx/de_river_army.jpg', 90, 813, 137, 858, 'рыцарь синий'),
    ('gfx/de_river_army.jpg', 1243, 767, 1297, 817, 'рыцарь красный'),
    ('gfx/de_river_army.jpg', 1510, 830, 1547, 877, 'всадник синий'),
    ('gfx/de_river_army.jpg', 1113, 797, 1132, 828, 'пехотинец синий'),
    ('gfx/de_river_army.jpg', 1187, 830, 1227, 873, 'всадник синий'),
    ('gfx/de_castle_walls_battle.jpg', 505, 110, 535, 150, 'рыцарь фиолетовый'),
    ('gfx/de_castle_walls_battle.jpg', 560, 100, 595, 140, 'рыцарь фиолетовый'),
]


def is_blue(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (b > 80) & (b > r * 1.35 + 10) & (b > g * 1.2 + 10)


def hsv_stats(rgb):
    a = rgb.reshape(-1, 3) / 255
    mx, mn = a.max(1), a.min(1)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return float(v.mean()), float(s.mean())


def lum(rgb):
    return rgb[..., :3] @ np.array([0.299, 0.587, 0.114])


def body(img):
    a = img[..., 3]
    return (a > 200) | ((a > 40) & (img[..., :3].sum(-1) > 45))


def ours():
    rows = {}
    idx = index()['sets']
    gL = float(lum(np.array(GRASS, float)))
    for qq in Q:
        img, m, ax, ay = frame(qq['set'], qq['anim'], qq['frac'])
        bm = body(img)
        rgb = img[..., :3][bm]
        v, s = hsv_stats(rgb)
        L = lum(rgb)
        # контур: пиксели тела, у которых есть сосед-не-тело
        pad = np.pad(bm, 1)
        edge = bm & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
        eL = lum(img[..., :3][edge])
        rows[qq['key']] = dict(
            cls=qq['cls'], set=qq['set'], h=idx[qq['set']].get('h'), px=int(bm.sum()),
            pc_mask=float((m[bm] > 0.35).mean()), pc_blue=float(is_blue(rgb).mean()),
            white=float(((rgb.min(1) > 150) & (rgb.max(1) - rgb.min(1) < 40)).mean()),
            V=v, S=s, L=float(L.mean()), dL_grass=float(L.mean() - gL), edge_dL=float(np.abs(eL - gL).mean()),
            dark=float((L < 50).mean()))
    return rows


def de_icons():
    rows = {}
    for f in sorted(glob.glob(os.path.join(REF, 'units', '*.0.png'))):
        k = os.path.basename(f).split('.')[0]
        im = np.asarray(Image.open(f).convert('RGB')).astype(float)
        fg = im.max(-1) > 28
        rgb = im[fg]
        v, s = hsv_stats(rgb)
        rows[k] = dict(pc_blue=float(is_blue(rgb).mean()), V=v, S=s,
                       white=float(((rgb.min(1) > 150) & (rgb.max(1) - rgb.min(1) < 40)).mean()))
    return rows


def de_game():
    rows = []
    for f, x0, y0, x1, y1, lab in DE_GAME:
        im = np.asarray(Image.open(os.path.join(REF, f)).convert('RGB')).astype(float)[y0:y1, x0:x1]
        border = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]])
        bg = np.median(border, 0)
        fg = np.abs(im - bg).sum(-1) > 90
        rgb = im[fg]
        v, s = hsv_stats(rgb)
        L = lum(rgb)
        pc = is_blue(rgb) if 'синий' in lab else (
            (rgb[:, 0] > 120) & (rgb[:, 0] > rgb[:, 1] * 1.6) if 'красный' in lab else
            (rgb[:, 2] > 90) & (rgb[:, 0] > rgb[:, 1] * 1.3) & (rgb[:, 2] > rgb[:, 1] * 1.4))
        rows.append(dict(label=lab, h=int(np.ptp(fg.any(1).nonzero()[0]) + 1) if fg.any() else 0, px=int(fg.sum()),
                         pc=float(pc.mean()), V=v, S=s, L=float(L.mean()), bgL=float(lum(bg)),
                         white=float(((rgb.min(1) > 150) & (rgb.max(1) - rgb.min(1) < 40)).mean())))
    return rows


def anim_stats():
    idx = index()['sets']
    out = {}
    for an in ('idle', 'walk', 'attack', 'death'):
        ns = [r['anims'][an]['n'] for r in idx.values() if an in r['anims']]
        ds = [r['anims'][an]['dur'] for r in idx.values() if an in r['anims']]
        out[an] = dict(n_med=st.median(ns), n_min=min(ns), n_max=max(ns), dur_med=st.median(ds))
    out['dirs'] = sorted({r.get('dirs') or 8 for r in idx.values()})
    return out


def main():
    res = dict(ours=ours(), de_icons=de_icons(), de_game=de_game(), anims=anim_stats())
    json.dump(res, open(os.path.join(OUT, 'metrics.json'), 'w'), ensure_ascii=False, indent=1)
    o = res['ours']
    def med(key, sel=lambda r: r['cls'] not in ('флот', 'осадные', 'звери')):
        return st.median([r[key] for r in o.values() if sel(r)])
    print('OURS people/cav median: pc_mask %.3f pc_blue %.3f white %.3f V %.3f S %.3f L %.1f dL %.1f edge %.1f dark %.3f' % tuple(
        med(k) for k in ('pc_mask', 'pc_blue', 'white', 'V', 'S', 'L', 'dL_grass', 'edge_dL', 'dark')))
    di = res['de_icons']
    people = [k for k in di if k in o and o[k]['cls'] not in ('флот', 'осадные', 'звери')]
    print('DE icons people median: pc_blue %.3f white %.3f V %.3f S %.3f' % tuple(
        st.median([di[k][x] for k in people]) for x in ('pc_blue', 'white', 'V', 'S')))
    print('ours same units: pc_blue %.3f white %.3f V %.3f S %.3f' % tuple(
        st.median([o[k][x] for k in people]) for x in ('pc_blue', 'white', 'V', 'S')))
    for r in res['de_game']:
        print('DE game', r)
    print(res['anims'])
    for k in people:
        print(f"{k:22} DE pc {di[k]['pc_blue']:.2f} wh {di[k]['white']:.2f} | ours pc {o[k]['pc_blue']:.2f} mask {o[k]['pc_mask']:.2f} wh {o[k]['white']:.2f} V {o[k]['V']:.2f}")


if __name__ == '__main__':
    main()
