#!/usr/bin/env python3
"""Бок о бок: наш юнит (покой ×3, атака/работа ×3, как в игре ×1) | эталон DE (портрет fandom, только для сравнения).

  .venv/bin/python tools/research/units_side_by_side.py --keys knight,militia --out shots/research_units/x.png
  .venv/bin/python tools/research/units_side_by_side.py --worst 30      # по score.json → side_by_side.png
"""
import argparse, glob, json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from units_common import Q, OUT, REPO, frame, on_grass, index

REF = os.path.join(REPO, 'shots', 'ref', 'units')
if not os.path.isdir(REF):          # рабочее дерево (worktree): эталоны лежат в основной копии
    REF = os.path.abspath(os.path.join(REPO, '..', '..', '..', 'shots', 'ref', 'units'))
QK = {q['key']: q for q in Q}
DE_KEY = {'villager_m': 'villager.0', 'villager_f': 'villager.1', 'trebuchet_up': 'trebuchet.1',
          'elite_teutonic_knight': 'teutonic_knight.1', 'elite_samurai': 'samurai.1', 'elite_woad_raider': 'woad_raider.1'}
TXT = {'ru': None}


def font(sz):
    for f in ('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def de_img(key):
    base = key[6:] if key.startswith('elite_') else key
    if key.startswith('vil_m'):
        base, name = 'villager', 'villager.0'
    elif key.startswith('vil_f'):
        name = 'villager.1'
    else:
        name = DE_KEY.get(key, base + '.0')
    fs = glob.glob(os.path.join(REF, name + '.*'))
    if key == 'mangudai' or key == 'elite_mangudai':
        fs = [os.path.join(REF, 'lq_mangudai.png')]
    return Image.open(fs[0]).convert('RGB') if fs else None


def ours(key, H):
    q = QK[key]
    anims = index()['sets'][q['set']]['anims']
    act = q['anim'] if q['anim'] != 'idle' else ('attack' if 'attack' in anims else 'walk')
    raw = []
    for an, fr in ((q['anim'], q['frac']), (act, 0.5)):
        img, m, ax, ay = frame(q['set'], an, fr)
        raw.append(on_grass(img, pad=3))
    k = max(1, min(6, (H - 4) // max(r.size[1] for r in raw)))
    tiles = [(f'×{k}', r.resize((r.size[0] * k, r.size[1] * k), Image.NEAREST)) for r in raw]
    tiles.append(('×1', raw[0]))
    return tiles


def row(key, note, H=200):
    t = ours(key, H)
    de = de_img(key)
    W = max(sum(x.size[0] for _, x in t) + 30 + H + 10, 640)
    out = Image.new('RGB', (W, H + 44), (28, 28, 28))
    d = ImageDraw.Draw(out)
    f15, f12 = font(15), font(12)
    x = 6
    for lab, im in t:
        if im.size[1] > H - 4:
            s_ = (H - 4) / im.size[1]
            im = im.resize((int(im.size[0] * s_), int(im.size[1] * s_)), Image.NEAREST)
        out.paste(im, (x, 42 + H - im.size[1]))
        d.text((x + 2, 42 + H - im.size[1] - 14), lab, fill=(200, 200, 200), font=f12)
        x += im.size[0] + 6
    x = W - H - 6
    d.line((x - 8, 42, x - 8, H + 42), fill=(200, 200, 200), width=2)
    if de:
        out.paste(de.resize((H, H)), (x, 42))
        d.text((x + 4, 44), 'DE', fill=(160, 200, 255), font=f15)
    d.text((6, 2), key, fill=(255, 230, 90), font=f15)
    d.text((6, 21), note, fill=(255, 150, 130), font=f12)
    return out


def stack(rows, cols=2):
    W = max(r.size[0] for r in rows)
    H = max(r.size[1] for r in rows)
    n = (len(rows) + cols - 1) // cols
    out = Image.new('RGB', (W * cols + 10 * (cols - 1), n * (H + 6)), (15, 15, 15))
    for i, r in enumerate(rows):
        out.paste(r, ((i % cols) * (W + 10), (i // cols) * (H + 6)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys')
    ap.add_argument('--worst', type=int)
    ap.add_argument('--notes', help='json {key: подпись}')
    ap.add_argument('--out')
    a = ap.parse_args()
    notes = json.load(open(a.notes)) if a.notes else {}
    if a.worst:
        keys = list(notes)[:a.worst]
        out = a.out or os.path.join(OUT, 'side_by_side.png')
    else:
        keys = a.keys.split(',')
        out = a.out
    stack([row(k, notes.get(k, '')) for k in keys]).save(out)
    print(out)


if __name__ == '__main__':
    main()
