#!/usr/bin/env python3
"""Контакт-лист курсоров: наш (×4, красный крест — объявленная точка прицела, зелёный — визуальное «остриё»),
оригинал 0 A.D., эталон DE (shots/ref/cursors/de_rw_*.png, только локально). Игру не меняет.
  .venv/bin/python tools/research/cursor_sheet.py [--out shots/research_cursor/sheet.png]
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OURS = os.path.join(ROOT, 'assets', 'ui', 'cursors')
ORIG = os.path.join(ROOT, 'assets', '0ad_raw', 'public', 'art', 'textures', 'cursors')
REF = os.path.join(ROOT, 'shots', 'ref', 'cursors')
sys.path.insert(0, ROOT)

DE_REF = {'arrow': 'default', 'attack': 'attack', 'build': 'build', 'repair': 'repair', 'garrison': 'garrison',
          'heal': 'heal', 'tree': 'chop', 'gold': 'mine_gold', 'stone': 'mine_stone', 'berries': 'gather',
          'farm': 'gather', 'meat': 'gather_meat', 'fish': 'fish', 'drop': 'food', 'rally': 'flag', 'no': None,
          'trade': None, 'board': 'board', 'flare': 'flare', 'omode': 'patrol'}
# визуальное «остриё» — где игрок ждёт точку прицела (лог. px в картинке 32): для стрелки 0 A.D. — нижний-левый
# кончик, для сворда/молота/двери 0 A.D. — верхний-левый угол, для de_* — остриё уменьшенной стрелки
VIS_TIP = {'arrow-default-down': (0, 31), 'action-attack': (0, 0), 'action-build': (1, 1), 'action-repair': (1, 1),
           'action-garrison': (1, 1), 'cursor-rally': (5, 31), 'cursor-no': (13, 14)}


def cross(d, x, y, col, r=6):
    d.line((x - r, y, x + r, y), fill=col, width=1)
    d.line((x, y - r, x, y + r), fill=col, width=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'shots', 'research_cursor', 'sheet.png'))
    args = ap.parse_args()
    with open(os.path.join(ROOT, 'shots', 'research_cursor', 'static.json')) as f:
        st = json.load(f)
    K = 4
    cw = 32 * K + 12
    cols = [('наш ×4 (красн. = прицел, зел. = остриё)', cw * 1.9), ('0 A.D. оригинал', cw), ('DE (эталон)', cw)]
    W = int(sum(c[1] for c in cols)) + 8
    rows = [k for k in st if st[k].get('file')]
    rh = 32 * K + 22
    sh = Image.new('RGB', (W, rh * len(rows) + 24), (58, 58, 62))
    d = ImageDraw.Draw(sh)
    try:
        f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 12)
    except Exception:  # noqa
        f = ImageFont.load_default()
    x = 4
    for name, wdt in cols:
        d.text((x, 4), name, fill=(255, 240, 160), font=f)
        x += wdt
    for i, k in enumerate(rows):
        r = st[k]
        y = 24 + i * rh
        fn = r['file']
        im = Image.open(os.path.join(OURS, fn + '.png')).convert('RGBA')
        if im.width > 32:
            kk = 32 / im.width
            im = im.resize((32, round(im.height * kk)), Image.BILINEAR)
        big = im.resize((im.width * K, im.height * K), Image.NEAREST)
        sh.paste(big, (4, y + 2), big)
        hx, hy = r['hot_eff']
        cross(d, 4 + hx * K + K // 2, y + 2 + hy * K + K // 2, (255, 40, 40), 8)
        vt = VIS_TIP.get(fn, r['arrow_tip'])
        if vt:
            cross(d, 4 + vt[0] * K + K // 2, y + 2 + vt[1] * K + K // 2, (40, 255, 40), 8)
        d.text((4 + 32 * K + 6, y + 4), f"{k}\n{fn}\nприцел {tuple(r['hot_eff'])}\nостриё {tuple(vt) if vt else '-'}",
               fill=(230, 230, 230), font=f)
        x = 4 + int(cols[0][1])
        o = r.get('orig')
        if o:
            oi = Image.open(os.path.join(ORIG, o['file'] + '.png')).convert('RGBA')
            kk = 32 / max(oi.size)
            oi = oi.resize((round(oi.width * kk * K), round(oi.height * kk * K)), Image.NEAREST)
            sh.paste(oi, (x, y + 2), oi)
            d.text((x, y + 32 * K + 4), o['file'][:22], fill=(200, 200, 200), font=f)
        x += int(cols[1][1])
        ref = DE_REF.get(k)
        if ref and os.path.exists(os.path.join(REF, f'de_rw_{ref}.png')):
            ri = Image.open(os.path.join(REF, f'de_rw_{ref}.png')).convert('RGBA')
            ri = ri.resize((ri.width * 8 // 3, ri.height * 8 // 3), Image.NEAREST)  # 48 → 128
            sh.paste(ri, (x, y + 2), ri)
            d.text((x, y + 32 * K + 4), 'DE ' + ref, fill=(200, 200, 200), font=f)
        else:
            d.text((x, y + 40), 'нет эталона', fill=(150, 150, 150), font=f)
        d.line((0, y + rh - 1, W, y + rh - 1), fill=(90, 90, 90))
    sh.save(args.out)
    print('записано', args.out, sh.size)


if __name__ == '__main__':
    main()
