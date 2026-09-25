#!/usr/bin/env python3
"""Исследование «перевёрнутое и не туда указывает» (docs/research/09_flipped_and_pointing.md), часть A/B:
контактный лист «16 направлений × эталонные юниты» со стрелкой направления движения на экране
(куда юнит идёт, если world.face = (cos d·22.5°, sin d·22.5°)) и замеры по кадрам: низ тела − якорь,
центр тела − якорь, сторона падающей тени. Ничего в игре не меняет.

  .venv/bin/python tools/research/flip_sheet.py            # shots/research_flip/sheet_dirs.png + числа в stdout
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def font(size=12):
    """Шрифт с кириллицей для подписей (PIL по умолчанию — без неё)."""
    for p in (os.path.join(REPO, 'assets', 'fonts', 'PTSerif-Italic.ttf'),
              '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()
GEN = os.path.join(REPO, 'assets', 'gen')
OUT = os.path.join(REPO, 'shots', 'research_flip')
BG = (98, 140, 62, 255)
TEAM = (0, 0, 255)
K = 2                                   # увеличение кадра на листе
CELL = 96

# (подпись, набор | '@вид', анимация, доля цикла)
ROWS = [
    ('копейщик walk', 'spearman.caro', 'walk', 0.3),
    ('рыцарь walk', 'knight.caro', 'walk', 0.3),
    ('лучник attack', 'archer.caro', 'attack', 0.55),
    ('житель carry_wood', 'vil_m.caro', 'carry_wood', 0.3),
    ('галера walk', '@galley', 'walk', 0.3),
    ('таран walk', '@ram', 'walk', 0.3),
    ('олень walk', '@animal_deer', 'walk', 0.3),
    ('требушет idle', '@trebuchet', 'idle', 0.0),
]


def load_index():
    with open(os.path.join(GEN, 'units', 'index.json'), encoding='utf-8') as f:
        return json.load(f)


def set_name(idx, name):
    if name.startswith('@'):
        m = idx['units'][name[1:]]
        return m.get('caro') or m.get('*') or next(iter(m.values()))
    return name


def sheet_of(idx, name, color=TEAM):
    rec = idx['sets'][name]
    im = np.asarray(Image.open(os.path.join(GEN, rec['file'])).convert('RGBA')).astype(np.float32)
    if rec.get('mask'):
        m = np.asarray(Image.open(os.path.join(GEN, rec['mask'])).convert('L')).astype(np.float32)[..., None] / 255
        c = np.array(color, np.float32)[None, None] / 255
        im[..., :3] *= 1 - m * (1 - c)
    with open(os.path.join(GEN, rec['meta']), encoding='utf-8') as f:
        frames = json.load(f)['frames']
    return rec, np.clip(im, 0, 255).astype(np.uint8), frames


def frame_rgba(sheet, frames, i):
    x, y, w, h, ax, ay = frames[i]
    return sheet[y:y + h, x:x + w], ax, ay


def measure(fr, ax, ay):
    """Низ тела − ay, центр тела по x − ax, сдвиг центра тени относительно тела (px)."""
    a = fr[..., 3]
    body = a >= 128
    sh = (a > 40) & (a < 128)
    if not body.any():
        return None
    ys, xs = np.nonzero(body)
    res = dict(bottom=int(ys.max()) - ay + 1, cx=float(xs.mean()) - ax, top=int(ys.min()) - ay)
    if sh.sum() > 20:
        sy, sx = np.nonzero(sh)
        res['shadow'] = (float(sx.mean() - xs.mean()), float(sy.mean() - ys.mean()))
    else:
        res['shadow'] = None
    return res


def screen_dir(d, n=16):
    a = d * math.tau / n
    fx, fy = math.cos(a), math.sin(a)
    ex, ey = fx - fy, (fx + fy) / 2          # экран: x − y, (x + y)/2
    L = math.hypot(ex, ey) or 1
    return ex / L, ey / L


def main():
    os.makedirs(OUT, exist_ok=True)
    idx = load_index()
    W = CELL * 16 + 160
    H = CELL * len(ROWS) + 40
    img = Image.new('RGBA', (W, H), BG)
    dr = ImageDraw.Draw(img)
    F = font(12)
    for d in range(16):
        dr.text((160 + d * CELL + 30, 4), f'd={d} ({d * 22.5:g}°)', fill=(255, 255, 200, 255), font=F)
    report = {}
    for r, (label, name, anim, frac) in enumerate(ROWS):
        sname = set_name(idx, name)
        rec, sheet, frames = sheet_of(idx, sname)
        a = rec['anims'].get(anim) or rec['anims']['idle']
        nd = rec.get('dirs') or 8
        k = int(frac * a['n']) % a['n']
        y0 = 40 + r * CELL
        dr.text((6, y0 + 6), label, fill=(255, 255, 255, 255), font=F)
        dr.text((6, y0 + 20), sname, fill=(220, 220, 220, 255), font=font(10))
        dr.text((6, y0 + 34), f'{anim} k={k} dirs={nd}', fill=(220, 220, 220, 255), font=font(10))
        rows = []
        for d in range(16):
            dd = d * nd // 16
            i = a['i0'] + (dd % nd) * a['n'] + k
            fr, ax, ay = frame_rgba(sheet, frames, i)
            m = measure(fr, ax, ay)
            rows.append(m)
            x0 = 160 + d * CELL
            # якорь в клетке: центр по x, ноги на 2/3 высоты
            px, py = x0 + CELL // 2, y0 + int(CELL * 0.68)
            fim = Image.fromarray(fr).resize((fr.shape[1] * K, fr.shape[0] * K), Image.NEAREST)
            img.alpha_composite(fim, (px - ax * K, py - ay * K))
            # стрелка направления движения на экране
            ex, ey = screen_dir(d)
            L = 26
            dr.line([(px, py), (px + ex * L, py + ey * L)], fill=(255, 60, 60, 255), width=2)
            ang = math.atan2(ey, ex)
            for s in (+0.5, -0.5):
                dr.line([(px + ex * L, py + ey * L),
                         (px + ex * L - 9 * math.cos(ang + s), py + ey * L - 9 * math.sin(ang + s))],
                        fill=(255, 60, 60, 255), width=2)
            dr.ellipse((px - 2, py - 2, px + 2, py + 2), fill=(255, 255, 0, 255))
            if m and m['shadow']:
                sx, sy = m['shadow']
                dr.line([(px, py + 8), (px + sx * 2, py + 8 + sy * 2)], fill=(40, 40, 40, 255), width=1)
        report[label] = dict(set=sname, anim=anim, rows=rows)
    path = os.path.join(OUT, 'sheet_dirs.png')
    img.save(path)
    print('лист:', path)
    print(f'{"ряд":<22} {"низ−якорь min..max":<20} {"cx−якорь min..max":<20} тень (dx, dy) среднее')
    for label, rep in report.items():
        rows = [m for m in rep['rows'] if m]
        bot = [m['bottom'] for m in rows]
        cx = [m['cx'] for m in rows]
        sh = [m['shadow'] for m in rows if m['shadow']]
        shm = (np.mean([s[0] for s in sh]), np.mean([s[1] for s in sh])) if sh else None
        shs = f'({shm[0]:+.1f}, {shm[1]:+.1f}) n={len(sh)}' if shm else '—'
        print(f'{label:<22} {min(bot):+d}..{max(bot):+d}{"":<12} {min(cx):+.1f}..{max(cx):+.1f}{"":<9} {shs}')
    with open(os.path.join(OUT, 'sheet_dirs.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
