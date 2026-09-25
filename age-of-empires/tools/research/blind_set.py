#!/usr/bin/env python3
"""Слепой тест узнаваемости значков (исследование).
  blind_set.py make  [--src shots/research_ui/items] [--out shots/research_ui/blind] [--seed N]
      — копирует вырезки под случайными номерами, ключ — в <out>/_key.json (не открывать до записи догадок),
        листы для просмотра <out>/sheet_NN.png (в каждой ячейке: номер, родной размер и ×2).
  blind_set.py score <guesses.json> — сверка догадок {номер: догадка} с ключом (ручная разметка верно/нет — в json).
Можно подать и эталонный набор DE (--src shots/research_ui/de_items) — для контроля «потолка» узнаваемости.
"""
import argparse
import json
import os
import random
import shutil

from PIL import Image, ImageDraw, ImageFont

SKIP_PREFIX = ('cmd__army1.', 'cmd__treb.', 'state__', 'cmd__vileco.back', 'cmd__vilmil.', 'stat__hp.')
KEEP_TREB = ('cmd__treb.aground.png', 'cmd__treb.treb_up.png')
KEEP_MARKET = ('cmd__market.market_Купить: еда.png', 'cmd__market.market_Продать: дерево.png')


def pick(src):
    out = []
    for f in sorted(os.listdir(src)):
        if not f.endswith('.png'):
            continue
        if f in KEEP_TREB or f in KEEP_MARKET:
            out.append(f)
            continue
        if f.startswith('cmd__market.'):
            continue
        if f.startswith(SKIP_PREFIX):
            continue
        out.append(f)
    return out


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def make(a):
    files = pick(a.src)
    rnd = random.Random(a.seed)
    nums = rnd.sample(range(100, 1000), len(files))
    os.makedirs(a.out, exist_ok=True)
    key = {}
    for f, n in zip(files, nums):
        shutil.copy(os.path.join(a.src, f), os.path.join(a.out, f'{n}.png'))
        key[str(n)] = f
    with open(os.path.join(a.out, '_key.json'), 'w') as fh:
        json.dump(key, fh, ensure_ascii=False, indent=1)
    order = sorted(key, key=int)
    per, cols, cw, ch = 30, 6, 200, 150
    fnt = font(18)
    for si in range(0, len(order), per):
        chunk = order[si:si + per]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * cw, rows * ch), (70, 70, 70))
        d = ImageDraw.Draw(sheet)
        for i, n in enumerate(chunk):
            im = Image.open(os.path.join(a.out, f'{n}.png')).convert('RGBA')
            x, y = (i % cols) * cw, (i // cols) * ch
            d.text((x + 4, y + 2), n, fill=(255, 255, 0), font=fnt)
            k = min(2.0, 120 / max(im.size))
            big = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
            sheet.paste(im, (x + 4, y + 26), im)
            sheet.paste(big, (x + 12 + min(im.width, 60), y + 22), big)
        sheet.save(os.path.join(a.out, f'sheet_{si // per:02d}.png'))
    print(len(files), 'вырезок →', a.out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd')
    ap.add_argument('--src', default='shots/research_ui/items')
    ap.add_argument('--out', default='shots/research_ui/blind')
    ap.add_argument('--seed', type=int, default=20260925)
    make(ap.parse_args())
