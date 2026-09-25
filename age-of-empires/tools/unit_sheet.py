#!/usr/bin/env python3
"""Contact sheets of units from assets/gen/units/ (see tools/build_units.py) - for checking by eye.

  .venv/bin/python tools/unit_sheet.py --out shots/units                 # a sheet per set
  .venv/bin/python tools/unit_sheet.py --out shots/units --sets vil_m.britons,knight.britons --anims walk,attack
  .venv/bin/python tools/unit_sheet.py --out shots/units --overview      # one frame of each set on one sheet
  .venv/bin/python tools/unit_sheet.py --out shots/units --lines         # rank lines side by side by group, ships

A set's sheet: a block per animation; rows - 8 directions (0 - looking along the world's +X, clockwise on screen),
columns - frames. The yellow cross is the "feet" point (the anchor), the red line is the health bar height.
The player color is blue (like player 1).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GEN = os.path.join(REPO, 'assets', 'gen')
BG = (98, 140, 62, 255)
TEAM = (45, 115, 235)


def load_index():
    with open(os.path.join(GEN, 'units', 'index.json'), encoding='utf-8') as f:
        return json.load(f)


def tinted_sheet(rec, color=TEAM):
    im = np.asarray(Image.open(os.path.join(GEN, rec['file'])).convert('RGBA')).astype(np.float32)
    if rec.get('mask'):
        m = np.asarray(Image.open(os.path.join(GEN, rec['mask'])).convert('L')).astype(np.float32)[..., None] / 255
        c = np.array(color, np.float32)[None, None] / 255
        im[..., :3] *= 1 - m * (1 - c)
    return Image.fromarray(np.clip(im, 0, 255).astype(np.uint8))


def frames(rec):
    with open(os.path.join(GEN, rec['meta']), encoding='utf-8') as f:
        return json.load(f)['frames']


def set_sheet(name, rec, anims=None, cell=None):
    sheet = tinted_sheet(rec)
    fr = frames(rec)
    blocks = []
    for an, a in rec['anims'].items():
        if anims and an not in anims:
            continue
        n = a['n']
        nd = rec.get('dirs') or 8
        crops = [[None] * n for _ in range(nd)]
        cw = 0
        up = dn = 0
        for d in range(nd):
            for k in range(n):
                x, y, w, h, ax, ay = fr[a['i0'] + d * n + k]
                crops[d][k] = (sheet.crop((x, y, x + w, y + h)), ax, ay)
                cw = max(cw, ax, w - ax)
                up = max(up, ay)
                dn = max(dn, h - ay)
        CW, CH = 2 * cw + 8, up + dn + 8
        blk = Image.new('RGBA', (CW * n + 60, CH * nd + 18), (40, 40, 40, 255))
        d0 = ImageDraw.Draw(blk)
        d0.text((4, 2), f'{an}  n={n} dur={a["dur"]} stride={a.get("stride", "-")} event={a.get("event", "-")}',
                fill=(255, 255, 255))
        for d in range(nd):
            for k in range(n):
                im, ax, ay = crops[d][k]
                c = Image.new('RGBA', (CW, CH), BG)
                px, py = CW // 2, up + 4
                c.alpha_composite(im, (px - ax, py - ay))
                dr = ImageDraw.Draw(c)
                dr.line((px - 3, py, px + 3, py), fill=(255, 255, 0))
                dr.line((px, py - 3, px, py + 3), fill=(255, 255, 0))
                if rec.get('h'):
                    dr.line((px - 6, py - rec['h'], px + 6, py - rec['h']), fill=(255, 60, 60))
                blk.paste(c, (60 + k * CW, 18 + d * CH))
            d0.text((4, 18 + d * CH + CH // 2 - 6), f'd{d}', fill=(255, 255, 255))
        blocks.append(blk)
    if not blocks:
        return None
    W = max(b.size[0] for b in blocks)
    H = sum(b.size[1] for b in blocks) + 20
    out = Image.new('RGBA', (W, H), (25, 25, 25, 255))
    ImageDraw.Draw(out).text((4, 4), f'{name}  ←  {rec.get("actor")}  scale={rec.get("scale")} h={rec.get("h")}',
                             fill=(255, 255, 0))
    y = 20
    for b in blocks:
        out.paste(b, (0, y))
        y += b.size[1]
    return out


def overview(idx, dirs=(1, 3)):
    tiles = []
    for name, rec in sorted(idx['sets'].items()):
        sheet = tinted_sheet(rec)
        fr = frames(rec)
        a = rec['anims'].get('walk') or rec['anims']['idle']
        ims = []
        for d in dirs:
            x, y, w, h, ax, ay = fr[a['i0'] + d * a['n']]
            ims.append((sheet.crop((x, y, x + w, y + h)), ax, ay))
        up = max(ay for _, _, ay in ims)
        dn = max(im.size[1] - ay for im, _, ay in ims)
        cw = max(max(ax, im.size[0] - ax) for im, ax, _ in ims)
        CW = 2 * cw + 6
        t = Image.new('RGBA', (max(CW * len(ims), 90), up + dn + 20), BG)
        for i, (im, ax, ay) in enumerate(ims):
            t.alpha_composite(im, (i * CW + CW // 2 - ax, up + 4 - ay))
        ImageDraw.Draw(t).text((2, t.size[1] - 12), name[:18], fill=(255, 255, 255))
        tiles.append(t)
    rows, row, x = [], [], 0
    for t in tiles:
        if x + t.size[0] > 1800 and row:
            rows.append(row)
            row, x = [], 0
        row.append(t)
        x += t.size[0]
    rows.append(row)
    W = max(sum(t.size[0] for t in r) for r in rows)
    H = sum(max(t.size[1] for t in r) for r in rows)
    out = Image.new('RGBA', (W, H), (25, 25, 25, 255))
    y = 0
    for r in rows:
        x = 0
        for t in r:
            out.paste(t, (x, y))
            x += t.size[0]
        y += max(t.size[1] for t in r)
    return out


LINES = {
    'swords': ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion'],
    'spears': ['spearman', 'pikeman', 'halberdier', 'skirmisher', 'elite_skirmisher'],
    'archers': ['archer', 'crossbowman', 'arbalester', 'hand_cannoneer', 'cavalry_archer', 'heavy_cavalry_archer'],
    'cavalry': ['scout', 'light_cavalry', 'hussar', 'knight', 'cavalier', 'paladin', 'camel_rider',
                'heavy_camel_rider'],
    'uniques': ['throwing_axeman', 'elite_throwing_axeman', 'longbowman', 'elite_longbowman', 'berserk',
                'elite_berserk', 'huskarl', 'elite_huskarl', 'teutonic_knight', 'elite_teutonic_knight',
                'woad_raider', 'elite_woad_raider', 'samurai', 'elite_samurai', 'chu_ko_nu', 'elite_chu_ko_nu'],
    'uniques2': ['janissary', 'elite_janissary', 'conquistador', 'elite_conquistador', 'mangudai', 'elite_mangudai',
                 'cataphract', 'elite_cataphract', 'mameluke', 'elite_mameluke', 'war_elephant', 'elite_war_elephant'],
    'siege': ['ram', 'capped_ram', 'siege_ram', 'mangonel', 'onager', 'siege_onager', 'scorpion', 'heavy_scorpion',
              'bombard_cannon', 'trebuchet'],
    'villagers': ['villager', 'villager_f', 'monk', 'trade_cart'],
}


def _cell(sheet, fr, rec, anim, d, k, zoom):
    a = rec['anims'].get(anim) or rec['anims']['idle']
    x, y, w, h, ax, ay = fr[a['i0'] + d * a['n'] + (k % a['n'])]
    im = sheet.crop((x, y, x + w, y + h))
    if zoom != 1:
        im = im.resize((w * zoom, h * zoom), Image.NEAREST)
    return im, ax * zoom, ay * zoom


def lines(idx, out, groups=None):
    """Rank lines: rows - civilization groups, columns - ranks (a walk and an attack frame, 1x and 2x).
    The red dash is the health bar height (bh)."""
    groups = groups or ['caro', 'anglo', 'norse', 'rus', 'byz', 'umay', 'han']
    cache = {}
    paths = []
    for ln, kinds in LINES.items():
        rows = []
        seen = set()
        for g in groups:
            names = tuple((idx['units'].get(k) or {}).get(g) or (idx['units'].get(k) or {}).get('*') for k in kinds)
            if names in seen:
                continue            # the group has the same sets as the previous one (shared units '*')
            seen.add(names)
            tiles = []
            for kind in kinds:
                m = idx['units'].get(kind) or {}
                name = m.get(g) or m.get('*')
                if not name or name not in idx['sets']:
                    continue
                rec = idx['sets'][name]
                if name not in cache:
                    cache[name] = (tinted_sheet(rec), frames(rec))
                sheet, fr = cache[name]
                ims = [_cell(sheet, fr, rec, 'walk', 1, 2, 1), _cell(sheet, fr, rec, 'attack', 3, 5, 1),
                       _cell(sheet, fr, rec, 'walk', 3, 2, 2)]
                up = max(ay for _, _, ay in ims) + 4
                dn = max(im.size[1] - ay for im, _, ay in ims) + 14
                W = sum(max(2 * max(ax, im.size[0] - ax), 20) + 4 for im, ax, _ in ims)
                t = Image.new('RGBA', (max(W, 60), up + dn), BG)
                x = 0
                dr = ImageDraw.Draw(t)
                for im, ax, ay in ims:
                    cw = max(2 * max(ax, im.size[0] - ax), 20) + 4
                    t.alpha_composite(im, (x + cw // 2 - ax, up - ay))
                    z = 2 if im is ims[2][0] else 1
                    bh = rec.get('bh') or rec.get('h')
                    dr.line((x + cw // 2 - 6, up - bh * z - 10 * z, x + cw // 2 + 6, up - bh * z - 10 * z),
                            fill=(255, 60, 60))
                    x += cw
                dr.text((2, t.size[1] - 12), name[:24], fill=(255, 255, 255))
                tiles.append(t)
            row, x = [], 0          # long lines wrap
            for t in tiles:
                if row and x + t.size[0] > 1900:
                    rows.append(row)
                    row, x = [], 0
                row.append(t)
                x += t.size[0]
            if row:
                rows.append(row)
        if not rows:
            continue
        W = max(sum(t.size[0] for t in r) for r in rows)
        H = sum(max(t.size[1] for t in r) for r in rows)
        o = Image.new('RGBA', (W, H), (25, 25, 25, 255))
        y = 0
        for r in rows:
            x = 0
            for t in r:
                o.paste(t, (x, y))
                x += t.size[0]
            y += max(t.size[1] for t in r)
        p = os.path.join(out, f'line_{ln}.png')
        o.save(p)
        paths.append(p)
    return paths


def ships(idx, out):
    """Ships: 8 frames of movement (oars, sails) in directions 1 and 3."""
    names = sorted(n for n in idx['sets'] if n.startswith('ship.'))
    rows = []
    for n in names:
        rec = idx['sets'][n]
        sheet, fr = tinted_sheet(rec), frames(rec)
        a = rec['anims'].get('walk') or rec['anims']['idle']
        cells = [_cell(sheet, fr, rec, 'walk' if 'walk' in rec['anims'] else 'idle', d, k, 1)
                 for d in (1, 3) for k in range(a['n'])]
        up = max(ay for _, _, ay in cells) + 4
        dn = max(im.size[1] - ay for im, _, ay in cells) + 4
        cw = max(2 * max(ax, im.size[0] - ax) for im, ax, _ in cells) + 4
        t = Image.new('RGBA', (cw * len(cells) + 150, up + dn), BG)
        for i, (im, ax, ay) in enumerate(cells):
            t.alpha_composite(im, (150 + i * cw + cw // 2 - ax, up - ay))
        ImageDraw.Draw(t).text((2, 4), f'{n[5:]}\nn={a["n"]}', fill=(255, 255, 255))
        rows.append(t)
    W = max(r.size[0] for r in rows)
    o = Image.new('RGBA', (W, sum(r.size[1] for r in rows)), (25, 25, 25, 255))
    y = 0
    for r in rows:
        o.paste(r, (0, y))
        y += r.size[1]
    p = os.path.join(out, 'ships.png')
    o.save(p)
    return p


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/units')
    ap.add_argument('--sets', default='')
    ap.add_argument('--anims', default='')
    ap.add_argument('--overview', action='store_true')
    ap.add_argument('--lines', action='store_true', help='rank lines by group + ships')
    a = ap.parse_args(argv)
    idx = load_index()
    os.makedirs(a.out, exist_ok=True)
    if a.lines:
        for p in lines(idx, a.out) + [ships(idx, a.out)]:
            print('sheet', p)
        return
    if a.overview:
        p = os.path.join(a.out, 'overview.png')
        overview(idx).save(p)
        print('sheet', p)
        return
    want = [s for s in a.sets.split(',') if s]
    anims = [s for s in a.anims.split(',') if s] or None
    for name, rec in sorted(idx['sets'].items()):
        if want and name not in want:
            continue
        im = set_sheet(name, rec, anims)
        if im is not None:
            p = os.path.join(a.out, f'{name}.png')
            im.save(p)
            print('sheet', p)


if __name__ == '__main__':
    sys.exit(main())
